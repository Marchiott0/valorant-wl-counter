import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../public/overlay.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/overlay.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/overlay.html', import.meta.url), 'utf8');

function browserFixture() {
  // This is a simulated browser. Actual OBS rendering is a separate manual check.
  let timestamp = Date.parse('2026-10-31T18:00:00.000Z');
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [timestamp])); } static now() { return timestamp; } }
  const makeElement = () => ({ textContent: '—', offsetWidth: 400, offsetHeight: 60, attributes: {}, style: { setProperty(name, value) { this[name] = value; } }, setAttribute(name, value) { this.attributes[name] = value; } });
  const elements = { counter: makeElement(), wins: makeElement(), losses: makeElement() };
  const intervals = [];
  const sources = [];
  let fetches = 0;
  let fail = false;
  let responseState = { day: '2026-10-31', known: false, wins: 0, losses: 0 };
  class Events {
    constructor(url) { this.url = url; this.listeners = {}; sources.push(this); }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    close() { this.closed = true; }
    emit(state) { this.listeners.state({ data: JSON.stringify(state) }); }
  }
  const context = vm.createContext({
    Date: Clock, Intl, Number, Math, JSON, Set,
    document: { getElementById: (id) => elements[id], addEventListener() {}, hidden: false },
    window: { innerWidth: 800, innerHeight: 180, addEventListener() {} },
    EventSource: Events,
    AbortSignal: { timeout: () => undefined },
    setInterval(fn, delay) { intervals.push({ fn, delay }); },
    fetch: async () => { fetches++; if (fail) throw new Error('offline'); return { ok: true, json: async () => responseState }; }
  });
  vm.runInContext(script, context);
  return {
    elements, intervals, sources, context,
    flush: () => new Promise((resolve) => setImmediate(resolve)),
    get fetches() { return fetches; },
    set fail(value) { fail = value; },
    set responseState(value) { responseState = value; },
    set timestamp(value) { timestamp = value; }
  };
}

test('overlay receives real-state-shaped SSE messages without reloading', async () => {
  const browser = browserFixture();
  await browser.flush();
  assert.equal(browser.elements.wins.textContent, '—');
  assert.equal(browser.sources[0].url, '/api/events');
  browser.sources[0].emit({ day: '2026-10-31', known: true, wins: 2, losses: 1, style: { fontFamily: 'Consolas', fontSize: 64, winColor: '#00ff00', lossColor: '#ff0000', textColor: '#eeeeee' } });
  assert.equal(browser.elements.wins.textContent, 2);
  assert.equal(browser.elements.losses.textContent, 1);
  assert.equal(browser.elements.counter.style['--counter-size'], '64px');
  assert.equal(browser.elements.counter.style['--win-color'], '#00ff00');
  assert.equal(browser.elements.counter.attributes['aria-label'], '2 vitórias e 1 derrotas');
});

test('overlay polling is a fallback and never requests HenrikDev directly', async () => {
  const browser = browserFixture();
  await browser.flush();
  assert.equal(browser.fetches, 1);
  browser.sources[0].onopen();
  browser.intervals[0].fn();
  await browser.flush();
  assert.equal(browser.fetches, 1);
  browser.sources[0].onerror();
  browser.responseState = { day: '2026-10-31', known: true, wins: 3, losses: 2 };
  browser.intervals[0].fn();
  await browser.flush();
  assert.equal(browser.fetches, 2);
  assert.equal(browser.elements.wins.textContent, 3);
  assert.equal(browser.intervals[0].delay, 5000);
  assert.ok(!script.includes('api.henrikdev.xyz'));
});

test('overlay preserves last same-day totals on local connection failure', async () => {
  const browser = browserFixture();
  await browser.flush();
  browser.sources[0].emit({ day: '2026-10-31', known: true, wins: 4, losses: 1 });
  browser.fail = true;
  browser.intervals[0].fn();
  await browser.flush();
  assert.equal(browser.elements.wins.textContent, 4);
  assert.equal(browser.elements.losses.textContent, 1);
});

test('overlay clears yesterday at Belém midnight even while server is unavailable', async () => {
  const browser = browserFixture();
  await browser.flush();
  browser.sources[0].emit({ day: '2026-10-31', known: true, wins: 4, losses: 1 });
  browser.fail = true;
  browser.timestamp = Date.parse('2026-11-01T02:59:59Z');
  browser.intervals[0].fn();
  await browser.flush();
  assert.equal(browser.elements.wins.textContent, 4);
  browser.timestamp = Date.parse('2026-11-01T03:00:00Z');
  browser.intervals[0].fn();
  await browser.flush();
  assert.equal(browser.elements.wins.textContent, '—');
  assert.equal(browser.elements.losses.textContent, '—');
});
test('overlay uses the configured timezone for midnight even when offline', async () => {
  const browser=browserFixture();await browser.flush();
  browser.timestamp=Date.parse('2026-10-31T14:59:59Z');
  browser.sources[0].emit({day:'2026-10-31',timeZone:'Asia/Tokyo',known:true,wins:2,losses:1});
  browser.fail=true;browser.intervals[0].fn();await browser.flush();assert.equal(browser.elements.wins.textContent,2);
  browser.timestamp=Date.parse('2026-10-31T15:00:00Z');browser.intervals[0].fn();await browser.flush();
  assert.equal(browser.elements.wins.textContent,'—');assert.equal(browser.elements.losses.textContent,'—');
});

test('overlay hides unknown/invalid/day-mismatched totals and rejects invalid style values', async () => {
  const browser = browserFixture();
  await browser.flush();
  for (const state of [
    { day: '2026-10-31', known: false, wins: 2, losses: 1 },
    { day: '2026-10-31', known: true, wins: -1, losses: 1 },
    { day: '2026-10-31', known: true, wins: '2', losses: 1 },
    { day: '2026-10-30', known: true, wins: 2, losses: 1 }
  ]) {
    browser.sources[0].emit({ ...state, style: { fontSize: 99999, winColor: 'url(https://bad.test/)', fontFamily: 'untrusted' } });
    assert.equal(browser.elements.wins.textContent, '—');
    assert.equal(browser.elements.counter.style['--win-color'], undefined);
    assert.equal(browser.elements.counter.style['--counter-font'], undefined);
    assert.equal(browser.elements.counter.style['--counter-size'], undefined);
  }
});

test('overlay fits small browser-source dimensions and serves transparent content', async () => {
  const browser = browserFixture();
  await browser.flush();
  browser.context.window.innerWidth = 200;
  browser.sources[0].emit({ day: '2026-10-31', known: true, wins: 2, losses: 1 });
  assert.equal(browser.elements.counter.style.transform, 'scale(0.5)');
  assert.match(css, /background:transparent!important/);
  assert.match(html, /W = /);
  assert.match(html, /L = /);
  assert.ok(!html.includes('apiKey'));
  assert.ok(!html.includes('<button'));
});
