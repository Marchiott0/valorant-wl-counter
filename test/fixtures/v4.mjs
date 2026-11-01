// Synthetic fixture using the official MatchesV4Data schema, NOT a live match.
// https://docs.henrikdev.xyz/api-reference/valorant/get-matches-by-name-v4
export const NOW = Date.parse('2026-10-31T18:00:00Z');
export const PUUID = 'test-puuid';
export function match({ id = 'match-1', start = '2026-10-31T12:00:00Z', win = true, queue = 'competitive', completed = true, scores = win ? [13, 8] : [8, 13] } = {}) {
  return {
    metadata: { match_id: id, map: { id: 'test-map', name: 'Ascent' }, game_version: 'test', game_length_in_ms: 1800000, started_at: start, is_completed: completed, queue: { id: queue, name: 'Competitive' }, season: { id: 'test', short: 'test' }, platform: 'pc', party_rr_penaltys: [], premier: null, region: 'br' },
    players: [{ puuid: PUUID, name: 'Tester', tag: 'BR1', team_id: 'Red', platform: 'pc', party_id: 'test', agent: { id: 'test', name: 'Jett' }, stats: { score: 2000, kills: 10, deaths: 10, assists: 5, headshots: 10, bodyshots: 20, legshots: 0, damage: { dealt: 2000, received: 2000 } }, ability_casts: {}, tier: { id: 20, name: 'Diamond' }, customization: { card: 'test', title: 'test' }, account_level: 100, session_playtime_in_ms: 1800000, behavior: { afk_rounds: 0, friendly_fire: { incoming: 0, outgoing: 0 }, rounds_in_spawn: 0 }, economy: { spent: { overall: 10000, average: 500 }, loadout_value: { overall: 10000, average: 500 } } }],
    teams: [{ team_id: 'Red', won: win, rounds: { won: scores[0], lost: scores[1] } }, { team_id: 'Blue', won: !win, rounds: { won: scores[1], lost: scores[0] } }],
    rounds: [], observers: [], coaches: [], kills: []
  };
}

export function page(startIndex, { date = '2026-10-31', size = 10 } = {}) {
  return Array.from({ length: size }, (_, i) => match({ id: `match-${startIndex+i}`, start: `${date}T${String(17-Math.floor((startIndex+i)/60)).padStart(2,'0')}:${String(59-(startIndex+i)%60).padStart(2,'0')}:00Z` }));
}
