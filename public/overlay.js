'use strict';

(() => {
  const counter = document.getElementById('counter');
  const winText = document.getElementById('wins');
  const lossText = document.getElementById('losses');
  const allowedFonts = new Set(['Segoe UI', 'Arial', 'Consolas', 'Trebuchet MS']);
  let streamOpen = false;
  let pollPending = false;
  let displayedDay = null;
  let displayedTimeZone = 'America/Sao_Paulo';

  function dayNow() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: displayedTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const value = (type) => parts.find((part) => part.type === type).value;
    return `${value('year')}-${value('month')}-${value('day')}`;
  }

  function fit() {
    counter.style.transform = 'none';
    const width = Math.max(counter.offsetWidth, 1);
    const height = Math.max(counter.offsetHeight, 1);
    const scale = Math.min(1, window.innerWidth / width, window.innerHeight / height);
    counter.style.transform = `scale(${Math.max(scale, 0.01)})`;
  }

  function clearOldDay() {
    if (displayedDay && displayedDay !== dayNow()) {
      winText.textContent = '—';
      lossText.textContent = '—';
      counter.setAttribute('aria-label', 'Aguardando contagem do novo dia');
      fit();
    }
  }

  function update(state) {
    if (!state || typeof state !== 'object') return;
    if (typeof state.timeZone === 'string') {
      try { new Intl.DateTimeFormat('en-CA',{timeZone:state.timeZone}).format(); displayedTimeZone=state.timeZone; }
      catch { winText.textContent='—';lossText.textContent='—';return; }
    }
    const style = state.style || {};
    if (allowedFonts.has(style.fontFamily)) counter.style.setProperty('--counter-font', `"${style.fontFamily}"`);
    const size = Number(style.fontSize);
    if (Number.isFinite(size) && size >= 16 && size <= 160) counter.style.setProperty('--counter-size', `${size}px`);
    for (const [key, variable] of [['winColor', '--win-color'], ['lossColor', '--loss-color'], ['textColor', '--text-color']]) {
      if (/^#[\da-f]{6}$/i.test(style[key] || '')) counter.style.setProperty(variable, style[key]);
    }
    displayedDay = state.day;
    const known = state.known === true && Number.isInteger(state.wins) && Number.isInteger(state.losses) && state.wins >= 0 && state.losses >= 0 && state.day === dayNow();
    winText.textContent = known ? state.wins : '—';
    lossText.textContent = known ? state.losses : '—';
    counter.setAttribute('aria-label', known ? `${state.wins} vitórias e ${state.losses} derrotas` : 'Contagem ainda indisponível');
    fit();
  }

  async function poll() {
    if (pollPending) return;
    pollPending = true;
    try {
      const response = await fetch('/api/state', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (response.ok) update(await response.json());
    } catch { /* Retain the last same-day valid total while the local server reconnects. */ }
    finally { pollPending = false; clearOldDay(); }
  }

  function connect() {
    if (typeof EventSource !== 'function') return;
    const events = new EventSource('/api/events');
    events.onopen = () => { streamOpen = true; };
    events.onerror = () => { streamOpen = false; };
    events.addEventListener('state', (event) => {
      try { update(JSON.parse(event.data)); } catch { /* Ignore malformed events; retry automatically. */ }
    });
    window.addEventListener('pagehide', () => events.close(), { once: true });
  }

  window.addEventListener('resize', fit);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void poll(); });
  window.addEventListener('pageshow', (event) => { if (event.persisted) { connect(); void poll(); } });
  setInterval(() => { clearOldDay(); if (!streamOpen) void poll(); }, 5000);
  void poll();
  connect();
  fit();
})();
