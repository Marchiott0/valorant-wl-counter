import { setTimeout as delay } from 'node:timers/promises';
import { dayKey, matchStart } from './matches.mjs';

const BASE = 'https://api.henrikdev.xyz';
const REGIONS = new Set(['br', 'latam', 'na', 'eu', 'ap', 'kr']);
const MESSAGES = {
  400: 'A API recusou a consulta. Confira o Riot ID e a região.',
  401: 'A chave HenrikDev não foi aceita. Confira a chave no painel.',
  403: 'A API negou acesso. Confira a chave e as permissões da conta.',
  404: 'A conta ou o histórico não foi encontrado. Confira o Riot ID e a região.',
  429: 'O limite da API foi atingido. A próxima consulta respeitará o tempo de espera.'
};

export class ApiError extends Error {
  constructor(message, { status = 0, retryAfterMs = 0 } = {}) {
    super(message); this.name = 'ApiError'; this.status = status; this.retryAfterMs = retryAfterMs;
  }
}

function retryDelay(headers, now) {
  const retry = headers?.get('retry-after');
  let retryMs = 0;
  if (retry) retryMs = /^\d+(\.\d+)?$/.test(retry.trim()) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - now) || 0;
  const reset = Number(headers?.get('x-ratelimit-reset'));
  const resetMs = Number.isFinite(reset) && reset > 0 ? reset * 1000 : 0;
  return Math.max(retryMs, resetMs);
}

export class HenrikClient {
  constructor({ apiKey, fetchImpl = globalThis.fetch, sleep = delay, now = Date.now, timeoutMs = 12000, maxRetries = 2, pageSize = 10, maxPages = 10 } = {}) {
    this.apiKey = apiKey; this.fetchImpl = fetchImpl; this.sleep = sleep; this.now = now;
    this.timeoutMs = timeoutMs; this.maxRetries = maxRetries; this.pageSize = pageSize; this.maxPages = maxPages; this.blockedUntil = 0;
  }

  async request(path, query = {}) {
    if (!this.apiKey) throw new ApiError('Informe sua chave HenrikDev no painel.');
    const url = new URL(path, BASE);
    if (url.origin !== BASE || !url.pathname.startsWith('/valorant/')) throw new ApiError('Endereço de consulta inválido.');
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    if (this.blockedUntil > this.now()) throw new ApiError(MESSAGES[429], { status: 429, retryAfterMs: this.blockedUntil - this.now() });
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let response;
      let body;
      try {
        response = await this.fetchImpl(url, { headers: { Authorization: this.apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error' });
        if (response.ok) {
          if (Number(response.headers.get('content-length')) > 16 * 1024 * 1024) throw new ApiError('A resposta da API excedeu o limite seguro.');
          const raw = await response.text();
          if (raw.length > 16 * 1024 * 1024) throw new ApiError('A resposta da API excedeu o limite seguro.');
          try { body = JSON.parse(raw); } catch { throw new ApiError('A API retornou uma resposta inválida.'); }
          if (body?.status !== 200 || !Object.hasOwn(body, 'data')) throw new ApiError('A API retornou dados incompletos ou inválidos.');
          if (response.headers.get('x-ratelimit-remaining') === '0') this.blockedUntil = this.now() + Math.max(1000, retryDelay(response.headers, this.now()));
          return body.data;
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (attempt < this.maxRetries) { await this.sleep(1000 * 2 ** attempt); continue; }
        throw new ApiError('Não foi possível acessar a API. Verifique a internet; uma nova tentativa será feita automaticamente.');
      }
      const status = response.status;
      const wait = status === 429 ? Math.max(1000 * 2 ** attempt, retryDelay(response.headers, this.now())) : 1000 * 2 ** attempt;
      // Never expose upstream response bodies, URLs or credentials in errors.
      await response.body?.cancel().catch(() => {});
      if (status === 429) this.blockedUntil = this.now() + wait;
      if ((status === 429 || status >= 500) && attempt < this.maxRetries && wait <= 5000) {
        await this.sleep(wait); this.blockedUntil = 0; continue;
      }
      throw new ApiError(MESSAGES[status] || 'A API está indisponível. A última contagem válida foi preservada.', { status, retryAfterMs: status === 429 ? wait : 0 });
    }
  }

  async getAccount(name, tag) {
    const account = await this.request(`/valorant/v1/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
    if (!account || typeof account.puuid !== 'string' || !account.puuid) throw new ApiError('A API não retornou uma identificação válida para a conta.');
    return { puuid: account.puuid, name: account.name, tag: account.tag, region: account.region };
  }

  async getDailyMatches({ name, tag, region, platform = 'pc', timeZone = 'America/Sao_Paulo', puuid, now = this.now() }) {
    if (!REGIONS.has(region) || !['pc','console'].includes(platform) || !puuid) throw new ApiError('Confira a região, plataforma e identificação da conta.');
    const day = dayKey(now,timeZone), matches = [], seen = new Set();
    let previousTime = Infinity;
    for (let page = 0; page < this.maxPages; page++) {
      const data = await this.request(`/valorant/v4/matches/${region}/${platform}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`, { mode: 'competitive', size: this.pageSize, start: page * this.pageSize });
      if (!Array.isArray(data)) throw new ApiError('A API retornou um histórico inválido.');
      let boundary = false, newIds = 0;
      for (const match of data) {
        const start = matchStart(match), id = match?.metadata?.match_id;
        if (!Number.isFinite(start) || typeof id !== 'string' || !id) return { matches, complete: false, reason: 'invalid_history' };
        if (start > previousTime) return { matches, complete: false, reason: 'unstable_pagination' };
        previousTime = start;
        if (seen.has(id)) return { matches, complete: false, reason: 'overlapping_history' };
        seen.add(id); newIds++;
        matches.push(match);
        if (dayKey(start,timeZone) < day) boundary = true;
      }
      // v4 provides neither a total nor an exhaustion flag. A short or empty
      // page cannot prove that all results exist (new accounts, truncation,
      // cache gaps). Keep the last known total rather than claim completeness.
      if (data.length !== this.pageSize) return { matches, complete: false, reason: 'unconfirmed_history_end' };
      if (!newIds) return { matches, complete: false, reason: 'repeated_page' };
      if (boundary) return { matches, complete: true, reason: 'day_boundary' };
    }
    return { matches, complete: false, reason: 'history_limit' };
  }
}
