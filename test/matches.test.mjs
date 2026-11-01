import test from 'node:test';
import assert from 'node:assert/strict';
import { countMatches, dayKey } from '../src/matches.mjs';
import { match, NOW, PUUID } from './fixtures/v4.mjs';
const count = matches => countMatches(matches, { puuid: PUUID, now: NOW, day: '2026-10-31' });

test('documented v4 winner and loser fields produce correct daily totals', () => {
  const result = count([match(), match({ id:'loss', win:false })]);
  assert.equal(result.wins,1); assert.equal(result.losses,1); assert.equal(result.uncertain,0);
});
test('only competitive queue counts; casual, Swiftplay, deathmatch and Premier are ignored', () => {
  for (const queue of ['unrated','swiftplay','deathmatch','premier','spikerush','custom']) assert.equal(count([match({queue})]).wins,0);
  const premier=match();premier.metadata.premier={id:'premier'};assert.equal(count([premier]).ignored,1);
});
test('unique match ID prevents duplicate counting', () => {
  const result=count([match(),match()]);assert.equal(result.wins,1);assert.equal(result.ignored,1);assert.equal(result.uncertain,0);
});
test('contradictory duplicate invalidates the result',()=>{assert.equal(count([match(),match({win:false})]).uncertain,1);});
test('yesterday ignored, today included using real start timestamp in Belem',()=>{
  assert.equal(count([match({start:'2026-10-31T02:59:59Z'})]).wins,0);
  assert.equal(count([match({start:'2026-10-31T03:00:00Z'})]).wins,1);
  assert.equal(count([match({start:'2026-10-31T00:00:00-03:00'})]).wins,1);
});
test('day changes exactly at midnight Belem independently of host timezone',()=>{
  assert.equal(dayKey('2026-11-01T02:59:59Z'),'2026-10-31');assert.equal(dayKey('2026-11-01T03:00:00Z'),'2026-11-01');
});
test('timezone changes which day a real start timestamp belongs to',()=>{
  const start='2026-10-31T23:30:00Z';const now=Date.parse('2026-11-01T02:00:00Z');
  const game=match({start});
  assert.equal(dayKey(start,'America/Sao_Paulo'),'2026-10-31');
  assert.equal(dayKey(start,'Asia/Tokyo'),'2026-11-01');
  assert.equal(countMatches([game],{puuid:PUUID,now,day:'2026-10-31',timeZone:'America/Sao_Paulo'}).wins,1);
  assert.equal(countMatches([game],{puuid:PUUID,now,day:'2026-11-01',timeZone:'Asia/Tokyo'}).wins,1);
  assert.equal(countMatches([game],{puuid:PUUID,now,day:'2026-10-31',timeZone:'Asia/Tokyo'}).ignored,1);
});
test('games belong to start day even if they finish after midnight',()=>{
  const m=match({start:'2026-10-31T02:45:00Z'});assert.equal(count([m]).ignored,1);
});
test('unfinished matches never count',()=>{assert.equal(count([match({completed:false})]).ignored,1);});
test('canceled short matches and remakes never increment',()=>{
  for(const scores of [[0,0],[2,1],[3,1]]) assert.equal(count([match({scores})]).ignored,1);
});
test('completed draw is ignored without marking history uncertain',()=>{
  const m=match({scores:[14,14]});m.teams.forEach(t=>t.won=false);const result=count([m]);assert.equal(result.ignored,1);assert.equal(result.uncertain,0);
});
test('malformed or inconsistent results cannot become confirmed counts',()=>{
  const bad=[];let m=match();m.teams[1].won=true;bad.push(m);
  m=match();m.teams[0].rounds.lost=7;bad.push(m);
  m=match();m.players=[];bad.push(m);
  m=match();m.metadata.started_at='2026-10-31 12:00';bad.push(m);
  m=match();delete m.metadata.is_completed;bad.push(m);
  m=match();m.metadata.started_at='2026-10-31T19:00:00Z';bad.push(m);
  m=match();m.metadata.started_at='2026-11-01T19:00:00Z';bad.push(m);
  m=match();m.teams.forEach(t=>t.won=false);bad.push(m);
  for(const item of bad) assert.equal(count([item]).uncertain,1);
});
