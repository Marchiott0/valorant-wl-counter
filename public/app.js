'use strict';

const $ = (id) => document.getElementById(id);
const allowedFonts = new Set(['Segoe UI', 'Arial', 'Consolas', 'Trebuchet MS']);
let config = null;
let currentState = null;
let streamOpen = false;
let busy = false;
let pollPending = false;
let toastTimer;

function fillTimeZones(selected) {
  const control = $('timezone');
  const preferred = [
    ['America/Sao_Paulo','Brasília / São Paulo'], ['America/Belem','Belém'],
    ['America/Manaus','Manaus'], ['America/Rio_Branco','Rio Branco'],
    ['America/Noronha','Fernando de Noronha'], ['UTC','UTC']
  ];
  const available = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const values = new Set();
  control.replaceChildren();
  for (const [value,label] of [...preferred,...available.map(value=>[value,value])]) {
    if (values.has(value)) continue;
    try { new Intl.DateTimeFormat('pt-BR',{timeZone:value}).format(); } catch { continue; }
    const option = document.createElement('option'); option.value=value; option.textContent=label; control.append(option); values.add(value);
  }
  if (selected && !values.has(selected)) {
    try { new Intl.DateTimeFormat('pt-BR',{timeZone:selected}).format(); const option=document.createElement('option');option.value=selected;option.textContent=selected;control.append(option); } catch { /* Backend validates zones too. */ }
  }
  control.value=selected || 'America/Sao_Paulo';
}

async function api(path, body) {
  const options = { cache: 'no-store', signal: AbortSignal.timeout(90000) };
  if (body !== undefined) {
    options.method = 'POST';
    options.headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'valorant-wl' };
    options.body = JSON.stringify(body);
  }
  let response;
  try { response = await fetch(path, options); }
  catch { throw new Error('Não foi possível falar com o aplicativo. Verifique se ele continua aberto.'); }
  let result;
  try { result = await response.json(); }
  catch { throw new Error('O aplicativo retornou uma resposta inválida. Tente novamente.'); }
  if (!response.ok) {
    const message = typeof result.error === 'string' ? result.error : typeof result.message === 'string' ? result.message : 'Não foi possível concluir. Verifique os dados e tente novamente.';
    throw new Error(message);
  }
  return result;
}

function styleValues() {
  return {
    fontFamily: $('font-family').value,
    fontSize: Number($('font-size').value),
    winColor: $('win-color').value,
    lossColor: $('loss-color').value,
    textColor: $('text-color').value
  };
}

function applyStyle(element, style = {}) {
  if (allowedFonts.has(style.fontFamily)) element.style.setProperty('--counter-font', `"${style.fontFamily}"`);
  const size = Number(style.fontSize);
  if (Number.isFinite(size) && size >= 16 && size <= 160) element.style.setProperty('--counter-size', `${size}px`);
  for (const [property, cssName] of [['winColor', '--win-color'], ['lossColor', '--loss-color'], ['textColor', '--text-color']]) {
    if (/^#[\da-f]{6}$/i.test(style[property] || '')) element.style.setProperty(cssName, style[property]);
  }
  fitPreview();
}

function fitPreview() {
  const preview = $('preview-counter');
  const stage = preview.parentElement;
  preview.style.transform = 'none';
  const available = Math.max(0, stage.clientWidth - 40);
  const scale = Math.min(1, available / Math.max(preview.offsetWidth, 1), (stage.clientHeight - 40) / Math.max(preview.offsetHeight, 1));
  preview.style.transform = `scale(${Math.max(scale, 0.01)})`;
}

function updateColorLabels() {
  for (const id of ['win-color', 'loss-color', 'text-color']) $(id + '-value').textContent = $(id).value.toUpperCase();
}

function fillConfig(next) {
  config = next;
  $('riot-id').value = next.riotId || '';
  $('region').value = next.region || 'br';
  $('platform').value = next.platform || 'pc';
  fillTimeZones(next.timeZone || 'America/Sao_Paulo');
  const pollValue = String(Number(next.pollSeconds) || 60);
  if (![...$('poll-seconds').options].some(option=>option.value===pollValue)) {
    const option=document.createElement('option');option.value=pollValue;option.textContent=`${pollValue} segundos`; $('poll-seconds').append(option);
  }
  $('poll-seconds').value = pollValue;
  $('api-key').value = '';
  $('api-key').placeholder = next.hasApiKey ? 'Chave salva · deixe vazio para manter' : 'Cole sua chave aqui';
  $('key-help').textContent = next.hasApiKey ? 'Chave já salva no servidor local. Cole outra somente para substituí-la.' : 'No painel HenrikDev: API Keys → Generate New Key. A chave fica no servidor local.';
  if (next.style) {
    if (allowedFonts.has(next.style.fontFamily)) $('font-family').value = next.style.fontFamily;
    if (Number.isFinite(next.style.fontSize)) $('font-size').value = next.style.fontSize;
    for (const [property, id] of [['winColor', 'win-color'], ['lossColor', 'loss-color'], ['textColor', 'text-color']]) {
      if (/^#[\da-f]{6}$/i.test(next.style[property] || '')) $(id).value = next.style[property];
    }
  }
  updateColorLabels();
  applyStyle($('preview-counter'), styleValues());
  $('poll-frequency').textContent = `${Number(next.pollSeconds) || 60} segundos`;
}

function timeText(timestamp, empty, timeZone) {
  if (!timestamp) return empty;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return empty;
  return new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
}

function updateState(state) {
  if (!state || typeof state !== 'object') return;
  currentState = state;
  const known = state.known === true && Number.isInteger(state.wins) && Number.isInteger(state.losses) && state.wins >= 0 && state.losses >= 0;
  $('preview-wins').textContent = known ? state.wins : '—';
  $('preview-losses').textContent = known ? state.losses : '—';
  $('preview-counter').setAttribute('aria-label', known ? `${state.wins} vitórias e ${state.losses} derrotas` : 'Contagem ainda indisponível');
  if (typeof state.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(state.day)) $('day-label').textContent = state.day.split('-').reverse().join(' / ');
  const timeZone = state.timeZone || 'America/Sao_Paulo';
  $('timezone-day-label').textContent = timeZone;
  $('last-success').textContent = timeText(state.lastSuccess, 'Ainda não atualizou',timeZone);
  $('next-poll').textContent = timeText(state.nextPoll, state.configured ? 'Aguardando consulta' : 'Aguardando configuração',timeZone);
  $('status-message').textContent = state.message || (state.configured ? 'Aguardando a próxima atualização.' : 'Informe sua conta e a chave da API para começar.');
  const raw = String(state.status || '').toLowerCase();
  let label = 'Aguardando', tone = 'setup';
  if (!state.configured || ['setup', 'unconfigured', 'needs_config'].includes(raw)) { label = 'Configurar'; }
  else if (['syncing', 'loading', 'updating'].includes(raw)) { label = 'Consultando'; tone = 'syncing'; }
  else if (['error', 'failed', 'unauthorized'].includes(raw)) { label = 'Verifique a conexão'; tone = 'error'; }
  else if (raw === 'rate_limited') { label = 'Limite da API'; tone = 'warning'; }
  else if (raw === 'stale') { label = 'Desatualizado'; tone = 'warning'; }
  else if (!state.complete || raw === 'incomplete') { label = 'Histórico incompleto'; tone = 'warning'; }
  else if (known) { label = 'Sincronizado'; tone = 'ok'; }
  $('status-badge').textContent = label;
  $('status-badge').dataset.status = tone;
  $('incomplete-note').hidden = !state.configured || (state.complete && tone !== 'error' && tone !== 'warning');
  $('incomplete-note').textContent = known ? 'Exibindo a última contagem válida. Os resultados podem estar desatualizados até a próxima sincronização completa.' : 'O contador só exibirá números quando o histórico do dia puder ser confirmado.';
  fitPreview();
}

function formMessage(message, kind = 'success') {
  $('form-message').textContent = message;
  $('form-message').dataset.kind = kind;
}

function setBusy(value) {
  busy = value;
  for (const id of ['save-button', 'test-button', 'save-style-button']) $(id).disabled = value;
  $('settings-form').setAttribute('aria-busy', String(value));
}

async function connect(testOnly) {
  if (busy || !$('settings-form').reportValidity()) return;
  const riotId = $('riot-id').value.trim();
  const splitAt = riotId.lastIndexOf('#');
  if (splitAt <= 0 || splitAt === riotId.length - 1) {
    formMessage('Informe o Riot ID no formato Nome#TAG.', 'error');
    $('riot-id').focus();
    return;
  }
  const apiKey = $('api-key').value.trim();
  if (!apiKey && !config?.hasApiKey) {
    formMessage('Insira uma chave HenrikDev para conectar sua conta.', 'error');
    $('api-key').focus();
    return;
  }
  setBusy(true);
  formMessage('Salvando configurações e consultando a API…');
  try {
    const payload = { riotId, region: $('region').value, platform: $('platform').value, timeZone: $('timezone').value, pollSeconds: Number($('poll-seconds').value), style: styleValues() };
    if (apiKey) payload.apiKey = apiKey;
    await api('/api/config', payload);
    $('api-key').value = '';
    const saved = await api('/api/config');
    fillConfig(saved);
    const state = await api('/api/refresh', {});
    updateState(state);
    const failed = ['error', 'stale', 'rate_limited'].includes(state.status) || !state.complete;
    formMessage(state.message || (testOnly ? 'Teste concluído. Veja o status da sincronização.' : 'Configuração salva. O contador será atualizado automaticamente.'), failed ? 'error' : 'success');
  } catch (error) {
    formMessage(error.message, 'error');
  } finally { setBusy(false); }
}

async function saveAppearance() {
  if (busy || !$('font-size').reportValidity()) return;
  setBusy(true);
  formMessage('Salvando aparência…');
  try {
    await api('/api/config', { style: styleValues() });
    if (config) config.style = styleValues();
    updateState(await api('/api/state'));
    formMessage('Aparência salva. O overlay no OBS recebe a alteração automaticamente.');
  } catch (error) { formMessage(error.message, 'error'); }
  finally { setBusy(false); }
}

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
}

async function pollState() {
  if (pollPending) return;
  pollPending = true;
  try { updateState(await api('/api/state')); }
  catch {
    $('status-badge').textContent = 'Servidor desconectado';
    $('status-badge').dataset.status = 'error';
    $('status-message').textContent = 'O aplicativo local não está respondendo. Abra iniciar.bat; a reconexão será automática.';
    $('incomplete-note').hidden = !currentState?.known;
    $('incomplete-note').textContent = 'Exibindo a última contagem recebida. Os dados podem estar desatualizados.';
  } finally { pollPending = false; }
}

function startEvents() {
  if (typeof EventSource !== 'function') return;
  const events = new EventSource('/api/events');
  events.onopen = () => { streamOpen = true; };
  events.onerror = () => { streamOpen = false; };
  events.addEventListener('state', (event) => {
    try { updateState(JSON.parse(event.data)); } catch { /* A later event or poll recovers malformed messages. */ }
  });
  window.addEventListener('pagehide', () => events.close(), { once: true });
}

$('settings-form').addEventListener('submit', (event) => { event.preventDefault(); void connect(false); });
$('test-button').addEventListener('click', () => { void connect(true); });
$('save-style-button').addEventListener('click', () => { void saveAppearance(); });
for (const id of ['font-family', 'font-size', 'win-color', 'loss-color', 'text-color']) {
  $(id).addEventListener('input', () => { updateColorLabels(); applyStyle($('preview-counter'), styleValues()); });
}
$('overlay-url').value = `${location.origin}/overlay`;
$('copy-url').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('overlay-url').value); toast('URL copiada. Cole na fonte de Navegador do OBS.'); }
  catch { $('overlay-url').focus(); $('overlay-url').select(); toast('URL selecionada. Pressione Ctrl+C para copiar.'); }
});
window.addEventListener('resize', fitPreview);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void pollState(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) { startEvents(); void pollState(); } });

async function initialize() {
  const [configResult, stateResult] = await Promise.allSettled([api('/api/config'), api('/api/state')]);
  if (configResult.status === 'fulfilled') fillConfig(configResult.value);
  else formMessage(configResult.reason.message, 'error');
  if (stateResult.status === 'fulfilled') updateState(stateResult.value);
  else await pollState();
  startEvents();
  setInterval(() => { if (!streamOpen) void pollState(); }, 5000);
}
void initialize();
