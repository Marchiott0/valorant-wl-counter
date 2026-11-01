const formatters = new Map();

export function dayKey(value = Date.now(), timeZone = 'America/Sao_Paulo') {
  if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }));
  const formatter = formatters.get(timeZone);
  const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function matchStart(match) {
  const value = match?.metadata?.started_at;
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return NaN;
  return Date.parse(value);
}

function classify(match, { puuid, day, now, timeZone }) {
  const meta = match?.metadata;
  if (!meta || typeof meta.match_id !== 'string' || !meta.match_id) return 'uncertain';
  const start = matchStart(match);
  if (!Number.isFinite(start)) return 'uncertain';
  if (start > now) return 'uncertain';
  if (dayKey(start, timeZone) !== day) return 'ignored';
  if (typeof meta.queue?.id !== 'string') return 'uncertain';
  if (meta.queue.id.toLowerCase() !== 'competitive' || meta.premier != null) return 'ignored';
  if (meta.is_completed === false) return 'ignored';
  if (meta.is_completed !== true || !Number.isFinite(meta.game_length_in_ms) || meta.game_length_in_ms < 0 || start + meta.game_length_in_ms > now + 30000) return 'uncertain';
  if (!Array.isArray(match.players) || !Array.isArray(match.teams) || match.teams.length !== 2) return 'uncertain';
  const players = match.players.filter(player => player?.puuid === puuid);
  if (players.length !== 1) return 'uncertain';
  const [a, b] = match.teams;
  if (!a || !b || typeof a.team_id !== 'string' || typeof b.team_id !== 'string' || a.team_id === b.team_id || ![a.team_id, b.team_id].includes(players[0].team_id)) return 'uncertain';
  for (const team of [a, b]) {
    if (typeof team.won !== 'boolean' || !Number.isSafeInteger(team.rounds?.won) || team.rounds.won < 0 || !Number.isSafeInteger(team.rounds?.lost) || team.rounds.lost < 0) return 'uncertain';
  }
  if (a.rounds.won !== b.rounds.lost || b.rounds.won !== a.rounds.lost) return 'uncertain';
  const rounds = a.rounds.won + b.rounds.won;
  // The documented v4 schema has no remake flag. Short aborted games cannot
  // produce a normal competitive result, and must never increment W/L.
  if (rounds <= 4) return 'ignored';
  if (!a.won && !b.won && a.rounds.won === b.rounds.won) return 'ignored';
  if (a.won === b.won || (a.won && a.rounds.won <= b.rounds.won) || (b.won && b.rounds.won <= a.rounds.won)) return 'uncertain';
  const mine = a.team_id === players[0].team_id ? a : b;
  return mine.won ? 'win' : 'loss';
}

export function countMatches(matches, { puuid, day, now = Date.now(), timeZone = 'America/Sao_Paulo' } = {}) {
  day ??= dayKey(now,timeZone);
  const result = { wins: 0, losses: 0, ignored: 0, uncertain: 0, records: [] };
  if (!Array.isArray(matches) || typeof puuid !== 'string' || !puuid) return { ...result, uncertain: 1 };
  const seen = new Map();
  for (const match of matches) {
    const outcome = classify(match, { puuid, day, now, timeZone });
    const id = match?.metadata?.match_id;
    if (id && seen.has(id)) {
      result.ignored++;
      if (seen.get(id) !== outcome) result.uncertain++;
      continue;
    }
    if (id) seen.set(id, outcome);
    if (outcome === 'win') result.wins++;
    else if (outcome === 'loss') result.losses++;
    else result[outcome]++;
    if (id && (outcome === 'win' || outcome === 'loss')) result.records.push({ id, result: outcome, startedAt: match.metadata.started_at });
  }
  return result;
}
