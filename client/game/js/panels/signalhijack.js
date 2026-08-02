// SIGNAL HIJACK — a real-time carrier-capture minigame. You overpower a station's
// broadcast carrier with your own pirate transmitter: a bright peak DRIFTS across
// the spectrum band and periodically FREQUENCY-HOPS to a new spot; DECOY harmonics
// mimic it. Slide your tuner window over the REAL carrier and hold the lock to fill
// CAPTURE past three notches (AUDIO → VIDEO → SCHEDULER) before the station's IDS
// fills TRACE. Two tactical tools: SWEEP (spend a little TRACE to tag the true
// carrier + dim decoys ~2s) and OVERDRIVE (hold — CAPTURE fills much faster but
// TRACE climbs faster and the lock window narrows).
//
// A cosmetic overlay launched from `pirate`-ing a media deck (see the broadcast
// plugin via dispatch.js's `signal_hijack` route). The win/lose result is reported
// via opts.onResult; the caller fires `pirateresolve`, which is authoritative —
// the real hacking skillCheck decides the seizure. The board weighs the player's
// real effective hacking skill against the deck's difficulty: the gap
// (edge = skill − difficulty) drives lock width, drift/hop rate, decoy count,
// capture fill-vs-drain, and the TRACE rate — an outclassed pirate faces a
// genuinely brutal board, not a cosmetic difference.

import { sfx, clampInt, clampNum, esc, mountOverlay, ensureChassisStyles, deviceHeader, bezelScrews, crtOverlays, deckStrip, setDeckLevel } from './minigame-common.js';

const W = 600, H = 200;          // canvas user units
const SEGS = ['AUDIO', 'VIDEO', 'SCHED'];

let _overlay = null;
let _close = null;
let _state = null;
let _opts = null;
let _raf = 0;
let _lastT = 0;
let _ctx = null;

const rnd = (a, b) => a + Math.random() * (b - a);

// ── Styles ──────────────────────────────────────────────────────────────────
function ensureStyles() {
  if (document.getElementById('signal-hijack-styles')) return;
  const s = document.createElement('style');
  s.id = 'signal-hijack-styles';
  s.textContent = `
    #signal-hijack-overlay { --sh-accent:#ff5f8a; --mg-accent:#ff5f8a; position:fixed; inset:0; z-index:9200; display:flex; align-items:center; justify-content:center;
      background:rgba(8,2,6,0.78); backdrop-filter:blur(3px); font-family:'Courier New',monospace; }
    #signal-hijack-overlay .sh-panel { width:min(660px,95vw); color:var(--sh-accent);
      background:linear-gradient(180deg, #2a1420 0%, #1f0e18 7%, #12070d 12%, #08040a 100%);
      padding:14px 16px 16px; animation:sh-boot .3s ease-out; }
    @keyframes sh-boot { 0%{opacity:0;transform:scale(.985)} 100%{opacity:1;transform:scale(1)} }
    #signal-hijack-overlay .sh-hud { display:flex; gap:16px; align-items:center; padding:8px 2px; font-size:12px; color:#a06678; letter-spacing:1px; flex-wrap:wrap; }
    #signal-hijack-overlay .sh-hud b { font-weight:bold; }
    #signal-hijack-overlay .sh-cap { color:#46e05a; }
    #signal-hijack-overlay .sh-lock { color:#7a5866; }
    #signal-hijack-overlay .sh-lock.on { color:#46e05a; }
    #signal-hijack-overlay .sh-bezel { margin:4px 0 2px; }
    #signal-hijack-overlay .sh-screen { background:radial-gradient(130% 130% at 50% 42%, color-mix(in srgb, var(--sh-accent) 11%, #100309) 55%, #05010a 100%); }
    #signal-hijack-overlay .sh-canvas { display:block; width:100%; height:200px; cursor:none; touch-action:none; }
    #signal-hijack-overlay .sh-status { min-height:22px; padding:8px 2px 2px; font-size:13px; letter-spacing:1px; font-weight:bold; color:#a06678; }
    #signal-hijack-overlay .sh-status .sh-win { color:#46e05a; }
    #signal-hijack-overlay .sh-status .sh-lose { color:#ff4a5b; }
    #signal-hijack-overlay .sh-status .sh-warn { color:#ffb23e; }
    #signal-hijack-overlay .sh-actions { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; }
    #signal-hijack-overlay .sh-btn { flex:1; min-width:96px; padding:9px 6px; background:#1a0c14; color:#c98aa0; border:1px solid #4a2030;
      border-radius:2px; cursor:pointer; font-family:'Courier New',monospace; font-size:12px; font-weight:bold; letter-spacing:2px;
      text-transform:uppercase; box-shadow:inset 0 -2px 0 rgba(0,0,0,0.5); transition:all .12s; }
    #signal-hijack-overlay .sh-btn:hover { transform:translateY(1px); color:#ff8fb0; border-color:#ff8fb0; }
    #signal-hijack-overlay .sh-btn-over:hover { color:#ffb23e; border-color:#5a3a1a; }
    #signal-hijack-overlay .sh-btn-over.armed { color:#0a0406; background:#ffb23e; border-color:#ffb23e; }
    #signal-hijack-overlay .sh-btn-abort:hover { color:#ff4a5b; border-color:#ff4a5b; }
  `;
  document.head.appendChild(s);
}

// ── Generation (edge = skill − difficulty scaling) ────────────────────────────
function mkPeak(fake) { return { x: rnd(80, W - 80), vx: rnd(-1, 1), fake: !!fake, hop: rnd(2.5, 5) }; }

function generate(skill, difficulty) {
  const edge = skill - difficulty;
  const tol = clampNum(46 + edge * 6, 22, 92);                          // lock window width (px)
  const driftSpeed = clampNum(34 + difficulty * 9 - skill * 5, 18, 92);  // px/sec
  const hopEvery = clampNum(5.2 - difficulty * 0.4 + skill * 0.18, 2.0, 6.0); // sec between hops
  const decoyN = clampInt(difficulty / 2 - skill / 4, 0, 3);
  const capFill = clampNum(20 + skill * 2 - difficulty, 12, 42);         // %/sec while locked
  const capDrain = clampNum(11 + difficulty * 1.4 - skill, 7, 30);       // %/sec off-target
  const traceRate = clampNum(3.6 + difficulty * 1.2 - skill * 0.8, 2.2, 13); // %/sec

  const decoys = [];
  for (let i = 0; i < decoyN; i++) decoys.push(mkPeak(true));
  return {
    carrier: mkPeak(false), decoys, tuner: W / 2, tol, baseTol: tol,
    driftSpeed, hopEvery, capFill, capDrain, traceRate,
    cap: 0, trace: 0, over: false, swept: 0, keyNudge: 0,
    over_active: false, done: 0,
  };
}

function drift(p, dt, speed) {
  p.x += p.vx * speed * dt;
  if (p.x < 60) { p.x = 60; p.vx = Math.abs(p.vx); }
  if (p.x > W - 60) { p.x = W - 60; p.vx = -Math.abs(p.vx); }
  p.hop -= dt;
  if (p.hop <= 0) { p.x = rnd(70, W - 70); p.vx = rnd(-1.4, 1.4); p.hop = rnd(0.6, 1.4) * (p._he || 4); }
}

// ── Loop ──────────────────────────────────────────────────────────────────
function tick(t) {
  const s = _state;
  if (!s) return;
  const dt = Math.min(0.05, (t - _lastT) / 1000 || 0);
  _lastT = t;

  if (!s.done) {
    s.carrier._he = s.hopEvery;
    drift(s.carrier, dt, s.driftSpeed);
    for (const d of s.decoys) { d._he = s.hopEvery; drift(d, dt, s.driftSpeed * 0.9); }
    if (s.keyNudge) { s.tuner = clampNum(s.tuner + s.keyNudge, 0, W); s.keyNudge = 0; }
    if (s.swept > 0) s.swept -= dt;

    const tol = s.over ? s.baseTol * 0.66 : s.baseTol;
    s.tol = tol;
    const locked = Math.abs(s.tuner - s.carrier.x) < tol / 2;
    if (locked) s.cap = Math.min(100, s.cap + (s.over ? s.capFill * 1.9 : s.capFill) * dt);
    else s.cap = Math.max(0, s.cap - s.capDrain * dt);
    s.trace = Math.min(100, s.trace + (s.traceRate + (s.over ? s.traceRate * 1.1 : 0)) * dt);

    s.locked = locked;   // a skin reads this rather than a DOM node
    if (!_skin) {
      const lockEl = _overlay.querySelector('.sh-lock');
      if (lockEl) { lockEl.textContent = locked ? 'LOCKED' : '—'; lockEl.classList.toggle('on', locked); }
    }

    if (s.cap >= 100) return finish(true, 'CARRIER OVERPOWERED — STATION SEIZED');
    if (s.trace >= 100) return finish(false, 'TRACE COMPLETE — TRANSMITTER BURNED');
  }

  if (_skin) { _skin.frame(s); }
  else {
    const capEl = _overlay.querySelector('.sh-cap');
    if (capEl) capEl.textContent = Math.round(s.cap) + '%';
    setDeckLevel(_overlay, s.trace / 100);
    render();
  }
  _raf = requestAnimationFrame(tick);
}

// ── The SKIN seam ────────────────────────────────────────────────────────────
// Everything above is the HIJACK — lock width, drift speed, hop rate, decoy
// count, capture fill/drain and the TRACE rate, all scaled off skill-vs-
// difficulty. Everything below is one way of drawing it.
//
// textsignal.js installs a skin and runs the identical capture in characters: the
// same carrier drifting and hopping, the same decoys mimicking it, the same lock
// tolerance. A spectrum band is a row of cells; the tuner window is a pair of
// brackets. It stays a real-time tracking game, which is the point of the middle
// rung.
let _skin = null;
export function setSignalSkin(skin) { _skin = skin; }

export function startSignalGame(opts) {
  _opts = { skill: 4, difficulty: 5, stationName: 'STATION', onResult: null, ...opts };
  _state = generate(_opts.skill, _opts.difficulty);
  _lastT = performance.now();
  _raf = requestAnimationFrame(tick);
  return _state;
}
export function stopSignalGame() {
  if (_raf) cancelAnimationFrame(_raf);
  _raf = 0; _state = null;
}
// The band width, so a skin can map cells onto the same coordinate space the
// carrier drifts in — otherwise the two renderers disagree about where it is.
export const SIGNAL_W = W;
export { sweep as signalSweep, setOver as signalOverdrive };
export function signalTune(delta) { if (_state) _state.keyNudge = (_state.keyNudge || 0) + delta; }

// ── Render ──────────────────────────────────────────────────────────────────
function drawPeak(ctx, x, amp, col, tag) {
  ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = -46; i <= 46; i += 2) {
    const y = H - 16 - amp * Math.exp(-(i * i) / 300);
    if (i === -46) ctx.moveTo(x + i, y); else ctx.lineTo(x + i, y);
  }
  ctx.stroke();
  if (tag) { ctx.fillStyle = col; ctx.font = '9px "Courier New",monospace'; ctx.textAlign = 'center'; ctx.fillText('◆ CARRIER', x, H - 16 - amp - 8); }
}

function render() {
  const s = _state, ctx = _ctx;
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(140,187,160,0.22)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, H - 16); ctx.lineTo(W, H - 16); ctx.stroke();

  const reveal = s.swept > 0;
  for (const d of s.decoys) drawPeak(ctx, d.x, reveal ? 24 : 50, reveal ? '#5a3a48' : '#b06a82', false);
  drawPeak(ctx, s.carrier.x, 62, '#ff5f8a', true);

  const lx = s.tuner - s.tol / 2;
  const locked = Math.abs(s.tuner - s.carrier.x) < s.tol / 2;
  ctx.fillStyle = locked ? 'rgba(70,224,90,0.14)' : 'rgba(255,95,138,0.10)';
  ctx.fillRect(lx, 0, s.tol, H);
  ctx.strokeStyle = locked ? '#46e05a' : '#ff8fb0'; ctx.lineWidth = 1.5;
  ctx.strokeRect(lx, 2, s.tol, H - 4);
  ctx.setLineDash([4, 4]); ctx.strokeStyle = locked ? '#46e05a' : '#ffffff';
  ctx.beginPath(); ctx.moveTo(s.tuner, 0); ctx.lineTo(s.tuner, H); ctx.stroke(); ctx.setLineDash([]);

  ctx.font = '9px "Courier New",monospace'; ctx.textAlign = 'left';
  for (let i = 0; i < SEGS.length; i++) {
    const on = s.cap >= (i + 1) * (100 / SEGS.length);
    ctx.fillStyle = on ? '#46e05a' : '#5a3a48';
    ctx.fillText((on ? '■ ' : '□ ') + SEGS[i], 8 + i * 74, 16);
  }
}

// ── Actions ─────────────────────────────────────────────────────────────────
function setStatus(html) {
  if (_skin) return _skin.status(html);
  const el = _overlay?.querySelector('.sh-status'); if (el) el.innerHTML = html;
}

function sweep() {
  const s = _state;
  if (!s || s.done) return;
  if (!s.decoys.length) { setStatus('<span class="sh-warn">No decoys on this band — SWEEP does nothing.</span>'); return; }
  s.swept = 2.2; s.trace = Math.min(100, s.trace + 5);
  sfx('hijack-sweep');
  setStatus('<span class="sh-warn">◎ SWEEP — decoys suppressed, carrier tagged (2s).</span>');
}

function setOver(v) {
  const s = _state;
  if (!s || s.done) v = false;
  if (s) s.over = v;
  const btn = _overlay?.querySelector('.sh-btn-over');
  if (btn) btn.classList.toggle('armed', v);
}

function finish(won, text) {
  const s = _state;
  if (!s || s.done) return;
  s.done = won ? 1 : -1;
  cancelAnimationFrame(_raf); _raf = 0;
  s.over = false;
  if (!_skin) render();
  sfx(won ? 'hijack-win' : 'hijack-lose');
  setStatus(`<span class="${won ? 'sh-win' : 'sh-lose'}">&gt;&gt; ${text}</span>`);
  const cb = _opts?.onResult;
  // A skin owns its own teardown — the character board is in the area pane.
  if (_skin) { _skin.finish?.(s, won, text); if (cb) cb({ won }); return; }
  if (won) setTimeout(() => { close(); cb && cb({ won: true }); }, 1100);
  else if (cb) cb({ won: false });
}

function setTuner(clientX) {
  const s = _state;
  const cv = _overlay?.querySelector('.sh-canvas');
  if (!s || !cv) return;
  const r = cv.getBoundingClientRect();
  s.tuner = clampNum((clientX - r.left) / r.width * W, 0, W);
}

// ── Public API ────────────────────────────────────────────────────────────────
function newRun() {
  _state = generate(Math.max(0, _opts.skill), Math.max(1, _opts.difficulty));
  setStatus('<span style="color:#a06678">Ride the bright carrier to fill CAPTURE. SWEEP to tag it, OVERDRIVE to push — beat the TRACE meter.</span>');
  _lastT = performance.now();
  cancelAnimationFrame(_raf);
  _raf = requestAnimationFrame(tick);
}

export function openSignalHijack(opts = {}) {
  ensureStyles();
  ensureChassisStyles();
  close();
  _opts = { skill: 4, difficulty: 5, stationName: 'STATION', accent: '#ff5f8a', onResult: null, ...opts };
  const html =
    `<div class="sh-panel mg-chassis">
      ${deviceHeader('&#9678;', 'SIGNAL HIJACK', 'TARGET &middot; ' + esc(_opts.stationName).toUpperCase())}
      <div class="sh-hud">
        <span>CAPTURE <b class="sh-cap">0%</b></span>
        <span>LOCK <b class="sh-lock">&mdash;</b></span>
      </div>
      <div class="sh-bezel mg-bezel">${bezelScrews()}<div class="sh-screen mg-screen" style="--mg-sweep-h:230px"><canvas class="sh-canvas" width="${W}" height="${H}"></canvas>${crtOverlays()}</div></div>
      ${deckStrip('CARRIER BUS', 'TRACE')}
      <div class="sh-status"></div>
      <div class="sh-actions">
        <button class="sh-btn sh-btn-sweep" title="Spend a little TRACE to tag the real carrier and dim decoys">&#9678; Sweep</button>
        <button class="sh-btn sh-btn-over" title="Hold: CAPTURE fills faster but TRACE climbs faster and the lock window narrows">&#9650; Overdrive</button>
        <button class="sh-btn sh-btn-rejack">&#8635; Re-Jack</button>
        <button class="sh-btn sh-btn-abort">Abort</button>
      </div>
    </div>`;
  const mounted = mountOverlay({
    id: 'signal-hijack-overlay',
    html,
    onKey: (e) => {
      if (!_state || _state.done) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); _state.keyNudge -= 26; }
      else if (e.key === 'ArrowRight') { e.preventDefault(); _state.keyNudge += 26; }
    },
    onClose: () => { if (_raf) { cancelAnimationFrame(_raf); _raf = 0; } _state = null; _ctx = null; },
  });
  _overlay = mounted.overlay;
  _close = mounted.close;
  _overlay.style.setProperty('--sh-accent', _opts.accent);
  _overlay.style.setProperty('--mg-accent', _opts.accent);
  const cv = _overlay.querySelector('.sh-canvas');
  _ctx = cv.getContext('2d');
  cv.addEventListener('mousemove', (e) => setTuner(e.clientX));
  cv.addEventListener('touchmove', (e) => { if (e.touches[0]) { setTuner(e.touches[0].clientX); e.preventDefault(); } }, { passive: false });
  _overlay.querySelector('.mg-close').addEventListener('click', close);
  _overlay.querySelector('.sh-btn-abort').addEventListener('click', close);
  _overlay.querySelector('.sh-btn-sweep').addEventListener('click', sweep);
  _overlay.querySelector('.sh-btn-rejack').addEventListener('click', () => { window.AudioEngine?.init?.(); newRun(); });
  const overBtn = _overlay.querySelector('.sh-btn-over');
  overBtn.addEventListener('mousedown', () => setOver(true));
  overBtn.addEventListener('mouseup', () => setOver(false));
  overBtn.addEventListener('mouseleave', () => setOver(false));
  overBtn.addEventListener('touchstart', (e) => { setOver(true); e.preventDefault(); }, { passive: false });
  overBtn.addEventListener('touchend', () => setOver(false));
  window.AudioEngine?.init?.();
  sfx('hijack-entry');
  newRun();
}

function close() {
  if (_close) { _close(); _close = null; }
  _overlay = null;
}
