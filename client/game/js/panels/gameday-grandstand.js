// Gameday · Grandstand: Deadball's park in 3-D (GLASS 2), behind a flag while it's built.
//
// The same five methods as gameday.js and gameday-rink.js ({ apply, clear, setCaption,
// showIdle, showCard }), so tv.js mounts it for baseball and changes nothing else.
//
// ⚠ WITH THE FLAG OFF IT IS THE 2-D GAMEDAY. `createGrandstandView` hands back
// `createGamedayView(host)` and nothing in this file runs. The flag is the localStorage key
// `deadball.grandstand` set to '1' (docs/systems-broadcast.md says how to turn it on).
//
// With it on, the park draws through gl/ballpark.js, and the 2-D view takes over whenever the
// 3-D one can't: no WebGL2, no float target, a shader that won't build, or a lost context. The
// last payload and the booth's line go with it.
//
// What's built (Phase 1a of docs/proposals/deadball-glass2.md): the park from the venue's
// defaults through the batting view, the scoreboard lit with the game, a score bug with the
// count, the outs and the bases, the booth's line and the cards. The players, the pitch and
// the ball in play are later phases. Until then the count ticks through each at-bat's pitches
// on the 2-D view's clock (GAMEDAY_CLOCK), so the held line lands when the 2-D view would
// land it and the booth never calls a play the picture hasn't reached.
//
// The sim on the server decides everything. Nothing here can change a score.

import { createGamedayView, GAMEDAY_CLOCK, GAMEDAY_CARDS } from './gameday.js';

export const GRANDSTAND_FLAG = 'deadball.grandstand';
export function grandstandOn(win) {
  try { return win?.localStorage?.getItem(GRANDSTAND_FLAG) === '1'; } catch { return false; }
}

function _esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// The ads round the bowl behind the plate.
const ADS = ['KSAB-TV', 'DEADBALL', 'COLDWATER', 'KSAB-TV'];

const { REVEAL_STEP_MS, REVEAL_MAX_MS, OUTCOME_GAP_MS, T_PITCH, T_THROW, T_FLY, T_HOMER } = GAMEDAY_CLOCK;
const GROUND = new Set(['groundout', 'doubleplay', 'tripleplay', 'productout', 'error']);
// How long after the play is decided the 2-D view says it has landed, by what was hit.
function flightOf(kind) {
  if (kind === 'strikeout' || kind === 'walk' || kind === 'hitbypitch') return 200;
  if (kind === 'homerun') return T_HOMER;
  return GROUND.has(kind) ? T_THROW * 2 : T_FLY;
}

export function createGrandstandView(host, opts = {}) {
  const doc = host ? host.ownerDocument : null;
  const win = doc ? doc.defaultView : null;
  if (!opts.force && !grandstandOn(win)) return createGamedayView(host);

  let flat = null;              // the 2-D view, once the 3-D one has given way to it
  let R = null, canvas = null, mounted = false, modsP = null, mods = null, ro = null, raf = 0;
  let last = null, caption = '', pendingCaption = null, pendingCard = null, playing = false;
  let timers = [], cardTimer = null, shot = opts.shot || 'high';
  // what the bug and the board show: the count, the outs, the bags and the score
  const S = { away: '', home: '', aScore: 0, hScore: 0, inning: 0, half: '', balls: 0, strikes: 0, outs: 0, bases: [false, false, false], batter: '', pitcher: '', line: null, desc: '' };

  const later = (ms, fn) => { timers.push(setTimeout(fn, Math.max(0, ms))); };
  const stopTimers = () => { timers.forEach(clearTimeout); timers = []; };

  function loadMods() {
    return (modsP ??= import('./gl/ballpark.js').then((m) => (mods = m)));
  }

  // ── the 2-D view, when the 3-D one can't draw ──────────────────────────────
  function fallback(why) {
    if (flat) return;
    if (why) console.warn('[grandstand] drawing in 2-D:', why);
    stopTimers(); stopLoop();
    try { R?.dispose(); } catch { /* already gone */ }
    R = null; canvas = null; mounted = false;
    ro?.disconnect(); ro = null;
    if (cardTimer) { clearTimeout(cardTimer); cardTimer = null; }
    host.innerHTML = '';
    flat = createGamedayView(host);
    // the line first, so the replayed play picks up a held one and lands it with itself
    if (pendingCaption) flat.setCaption(pendingCaption.text, { held: true, speak: pendingCaption.speak });
    else if (caption) flat.setCaption(caption);
    pendingCaption = null;
    if (last) flat.apply(last); else flat.showIdle();
  }

  // ── the page ──────────────────────────────────────────────────────────────
  function shell() {
    return `<div class="gds-wrap">` +
      `<div class="gds-park"><canvas class="gds-canvas" role="img" aria-label="The ballpark"></canvas><div class="gds-bug"></div></div>` +
      `<div class="gds-cap"><span class="gds-cap-tag">◆ Chip Vega</span><span class="gds-cap-text">${_esc(caption)}</span></div>` +
    `</div>`;
  }
  function mount() {
    if (mounted || flat) return !flat;
    host.innerHTML = shell();
    canvas = host.querySelector('.gds-canvas');
    size();
    R = mods.createBallparkRenderer(canvas, { ads: opts.ads || ADS, preserve: !!opts.preserve, crowd: opts.crowd });
    if (!R) { fallback('no WebGL2 or float target'); return false; }
    mounted = true;
    const box = host.querySelector('.gds-park');
    if (win?.ResizeObserver && box) { ro = new win.ResizeObserver(() => { if (size()) draw(); }); ro.observe(box); }
    return true;
  }
  // The backing store follows the box at the device's pixel ratio, capped by the renderer's rung.
  function size() {
    if (!canvas) return false;
    const box = canvas.parentElement;
    const k = Math.min(win?.devicePixelRatio || 1, R?.quality?.dpr || 2);
    const w = Math.max(1, Math.round((box?.clientWidth || 400) * k)), h = Math.max(1, Math.round((box?.clientHeight || 300) * k));
    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w; canvas.height = h;
    return true;
  }

  // ── drawing ────────────────────────────────────────────────────────────────
  // The park only moves when the game does, so a frame is drawn when something changes and
  // the GPU sits idle between pitches.
  function draw() {
    if (!R || raf || !win) return;
    raf = win.requestAnimationFrame(() => {
      raf = 0;
      if (!R || !canvas?.isConnected) return;
      if (R.lost) { fallback('the WebGL context was lost'); return; }
      size();
      if (!R.render(shot) && R.lost) fallback('the WebGL context was lost');
    });
  }
  function stopLoop() { if (raf && win) win.cancelAnimationFrame(raf); raf = 0; }
  function setShot(s) { shot = s; draw(); }

  function paint() {
    const el = host?.querySelector('.gds-bug');
    if (el) {
      const outs = [0, 1, 2].map((i) => `<i class="gds-out${i < S.outs ? ' on' : ''}"></i>`).join('');
      const bag = (n) => `<i class="gds-bag b${n}${S.bases[n - 1] ? ' on' : ''}"></i>`;
      el.innerHTML = S.half
        ? `<span class="gds-team${S.aScore > S.hScore ? ' lead' : ''}"><b>${_esc(S.away || 'AWY')}</b><em>${S.aScore | 0}</em></span>` +
          `<span class="gds-team${S.hScore > S.aScore ? ' lead' : ''}"><b>${_esc(S.home || 'HOM')}</b><em>${S.hScore | 0}</em></span>` +
          `<span class="gds-inn">${S.half === 'top' ? '▲' : '▼'}${S.inning | 0}</span>` +
          `<span class="gds-bags">${bag(2)}${bag(3)}${bag(1)}</span>` +
          `<span class="gds-count">${S.balls | 0}-${S.strikes | 0}</span><span class="gds-outs">${outs}</span>`
        : '';
    }
    R?.setBoard(S);
    draw();
  }

  // ── the booth's line and the cards ─────────────────────────────────────────
  function showCaption(text) {
    caption = String(text || '');
    const el = host?.querySelector('.gds-cap-text');
    if (el) { el.textContent = caption; el.classList.remove('in'); void el.offsetWidth; el.classList.add('in'); }
  }
  // The play landed: the held line and any held card go up now.
  function land() {
    playing = false;
    if (pendingCaption) { const p = pendingCaption; pendingCaption = null; showCaption(p.text); p.speak?.(); }
    if (pendingCard) { const c = pendingCard; pendingCard = null; renderCard(c); }
  }
  function renderCard(fx) {
    if (!host || !fx || !GAMEDAY_CARDS[fx.kind]) return;
    const m = GAMEDAY_CARDS[fx.kind](fx);
    const wrap = host.querySelector('.gds-park') || host;
    let el = host.querySelector('.gds-jumbo');
    if (!el) { el = doc.createElement('div'); el.className = 'gds-jumbo'; wrap.appendChild(el); }
    el.innerHTML = `<div class="gds-jumbo-title">${_esc(m.title)}</div>${m.sub ? `<div class="gds-jumbo-sub">${_esc(m.sub)}</div>` : ''}`;
    el.className = `gds-jumbo ${m.cls}`; void el.offsetWidth; el.classList.add('in');
    if (cardTimer) clearTimeout(cardTimer);
    cardTimer = setTimeout(() => el && el.classList.remove('in'), (fx.duration || 3.5) * 1000);
  }
  function clearCard() { if (cardTimer) { clearTimeout(cardTimer); cardTimer = null; } host?.querySelector('.gds-jumbo')?.remove(); }

  // ── a payload ─────────────────────────────────────────────────────────────
  function sides(p) {
    const top = p.half === 'top';
    S.away = top ? p.battingAbbr : p.fieldingAbbr; S.home = top ? p.fieldingAbbr : p.battingAbbr;
    S.aScore = Number.isFinite(p.awayScore) ? p.awayScore : S.aScore;
    S.hScore = Number.isFinite(p.homeScore) ? p.homeScore : S.hScore;
    S.inning = p.inning | 0; S.half = p.half || ''; S.pitcher = p.pitcher || '';
    if (p.line) S.line = p.line;
  }
  function stage(p) {
    stopTimers();
    const pend = pendingCaption;
    if (p.phase === 'half') {
      // a fresh half: nobody on, nobody out
      sides(p);
      Object.assign(S, { balls: 0, strikes: 0, outs: 0, bases: [false, false, false], batter: '', desc: '' });
      shot = opts.shot || 'high';
      paint();
      renderCard({ kind: 'half', inningOrd: p.inningOrd, half: p.half, batting: p.battingTeam, duration: 3.4 });
      // a changeover has no ball to land, so its line goes up a beat in
      pendingCaption = null;
      if (pend) later(420, () => { showCaption(pend.text); pend.speak?.(); });
      return;
    }
    const before = Array.isArray(p.basesBefore) ? p.basesBefore : [false, false, false];
    const outsAfter = Math.max(0, Math.min(3, p.outs | 0));
    const outsBy = p.kind === 'tripleplay' ? 3 : p.kind === 'doubleplay' ? 2 : 1;
    const outsBefore = Math.max(0, outsAfter - (p.out ? outsBy : 0));
    // the score before the play, so the bug doesn't call it early
    const runs = Number.isFinite(p.runs) ? p.runs : (p.rbi | 0);
    const aAfter = p.awayScore, hAfter = p.homeScore;
    sides(p);
    if (p.half === 'top') S.aScore = Math.max(0, (aAfter | 0) - runs); else S.hScore = Math.max(0, (hAfter | 0) - runs);
    Object.assign(S, { bases: before.slice(), outs: outsBefore, batter: p.batter || '', desc: p.desc || '' });
    shot = opts.shot || 'bat';
    playing = true;
    const settle = () => {
      Object.assign(S, { bases: (p.basesAfter || [false, false, false]).slice(), outs: outsAfter, aScore: aAfter | 0, hScore: hAfter | 0 });
      paint();
    };
    if (p.phase === 'run') {
      // a play on the bases while he's up: no pitches of its own
      paint();
      const landAt = p.kind === 'pickoff' || p.kind === 'throwover' ? 260 + T_THROW : T_PITCH + T_THROW;
      later(landAt, () => { settle(); land(); });
      return;
    }
    const pitches = Array.isArray(p.pitches) ? p.pitches : [];
    const N = pitches.length;
    Object.assign(S, { balls: 0, strikes: 0 });
    paint();
    const step = N > 1 ? Math.min(REVEAL_STEP_MS, REVEAL_MAX_MS / (N - 1)) : REVEAL_STEP_MS;
    for (let k = 1; k < N; k++) later((k - 1) * step, () => { S.balls = pitches[k - 1].balls; S.strikes = pitches[k - 1].strikes; paint(); });
    const outMs = Math.max(0, N - 1) * step + OUTCOME_GAP_MS;
    later(outMs, settle);
    later(outMs + flightOf(p.kind), land);
  }

  function apply(p) {
    if (!host || !p) return;
    if (flat) { flat.apply(p); return; }
    last = p;
    const go = () => {
      if (last !== p || flat) return;
      if (!mount()) return;
      host.querySelector('.gds-idle')?.remove();
      stage(p);
    };
    if (mods) go(); else loadMods().then(go).catch((err) => fallback(err && err.message));
  }
  function setCaption(text, o) {
    if (flat) { flat.setCaption(text, o); return; }
    const speak = o && o.speak;
    if (o && o.held) pendingCaption = { text: String(text || ''), speak };
    else { showCaption(text); speak?.(); }
  }
  function showCard(fx) {
    if (flat) { flat.showCard(fx); return; }
    if (!host || !fx || !GAMEDAY_CARDS[fx.kind]) return;
    if (playing) pendingCard = fx; else renderCard(fx);
  }
  // Opened before a beat arrived: the park from high behind the plate, and a word over it.
  function showIdle() {
    if (flat) { flat.showIdle(); return; }
    if (!host) return;
    clearCard();
    const go = () => {
      if (flat || !mount()) return;
      if (!last) { shot = opts.shot || 'high'; paint(); }
      if (host.querySelector('.gds-idle')) return;
      const veil = doc.createElement('div');
      veil.className = 'gds-idle';
      veil.innerHTML = `<div class="gds-idle-title">DEADBALL</div><div class="gds-idle-sub">Waiting for the first pitch…</div>`;
      host.querySelector('.gds-park')?.appendChild(veil);
    };
    if (mods) go(); else loadMods().then(go).catch((err) => fallback(err && err.message));
  }
  function clear() {
    if (flat) { flat.clear(); flat = null; }
    stopTimers(); stopLoop(); clearCard();
    ro?.disconnect(); ro = null;
    try { R?.dispose(); } catch { /* already gone */ }
    if (host) host.innerHTML = '';
    R = null; canvas = null; mounted = false;
    last = null; caption = ''; pendingCaption = null; pendingCard = null; playing = false;
  }

  return {
    apply, clear, setCaption, showIdle, showCard,
    // for the sandbox and the gates
    setShot, ready: () => loadMods(),
    get renderer() { return R; }, get flat() { return flat; }, get state() { return S; },
    busy: () => playing,
  };
}
