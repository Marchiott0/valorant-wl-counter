import test from 'node:test';
import assert from 'node:assert/strict';
import { CounterEngine } from '../src/engine.mjs';
import { DEFAULT_CONFIG } from '../src/storage.mjs';

const beforeMidnight = Date.parse('2026-11-01T02:59:59Z');
const midnight = Date.parse('2026-11-01T03:00:00Z');
const priorState = () => ({ identity: JSON.stringify(['br','pc','America/Sao_Paulo','tester#br1']), day: '2026-10-31', wins: 2, losses: 1, known: true, complete: true, lastSuccess: new Date(beforeMidnight - 60000).toISOString() });

function memory() {
  return {
    config: { ...structuredClone(DEFAULT_CONFIG), riotId: 'Tester#BR1' },
    key: 'simulated-key', saved: priorState(), saves: [],
    async init() {}, async loadConfig() { return this.config; }, async loadKey() { return this.key; }, async loadState() { return this.saved; },
    async saveConfig(config, key) { this.config = config; if (key) this.key = key; },
    async saveState(state) { this.saved = structuredClone(state); this.saves.push(this.saved); }
  };
}

const baseClient = { async getAccount() { return { puuid: 'test-puuid' }; }, async getDailyMatches() { return { matches: [], complete: true }; } };
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('midnight while history is inflight discards old response before persisting', async () => {
  let now = beforeMidnight;
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  let requests = 0;
  const client = { ...baseClient, async getDailyMatches() { requests++; if (requests === 1) await waiting; return { matches: [], complete: true }; } };
  const store = memory();
  const engine = await new CounterEngine(store, { now: () => now, clientFactory: () => client }).init();
  const oldRequest = engine.refresh();
  await flush();
  assert.equal(requests, 1);
  now = midnight;
  assert.equal(engine.getState().day, '2026-11-01');
  assert.equal(engine.getState().known, false);
  release();
  await oldRequest;
  assert.equal(store.saves.length, 0);
  assert.equal(engine.getState().day, '2026-11-01');
  assert.equal(engine.getState().known, false);
  await engine.refresh();
  assert.equal(requests, 2);
  assert.equal(engine.getState().known, true);
  assert.equal(engine.getState().wins, 0);
  assert.equal(store.saved.day, '2026-11-01');
  const restarted = await new CounterEngine(store, { now: () => now, clientFactory: () => baseClient }).init();
  assert.equal(restarted.getState().known, true);
  assert.equal(restarted.getState().wins, 0);
  assert.equal(restarted.getState().day, '2026-11-01');
});

test('midnight during persistence never publishes or restores prior-day totals', async () => {
  let now = beforeMidnight;
  let releaseWrite;
  const pendingWrite = new Promise((resolve) => { releaseWrite = resolve; });
  const store = memory();
  const realSave = store.saveState.bind(store);
  let writes = 0;
  store.saveState = async (state) => { writes++; if (writes === 1) await pendingWrite; await realSave(state); };
  const engine = await new CounterEngine(store, { now: () => now, clientFactory: () => baseClient }).init();
  const events = [];
  engine.on('state', (state) => events.push(state));
  const oldRequest = engine.refresh();
  await flush();
  assert.equal(writes, 1);
  now = midnight;
  assert.equal(engine.getState().known, false);
  const resetIndex = events.findIndex((event) => event.day === '2026-11-01');
  releaseWrite();
  await oldRequest;
  assert.equal(engine.getState().known, false);
  assert.ok(events.slice(resetIndex).every((event) => event.day === '2026-11-01' && !event.known));
  // A write that began yesterday may finish on disk, but restart must reject it.
  assert.equal(store.saved.day, '2026-10-31');
  const restarted = await new CounterEngine(store, { now: () => now, clientFactory: () => baseClient }).init();
  assert.equal(restarted.getState().day, '2026-11-01');
  assert.equal(restarted.getState().known, false);
  await engine.refresh();
  assert.equal(store.saved.day, '2026-11-01');
  assert.equal(engine.getState().known, true);
  assert.equal(engine.getState().wins, 0);
});
