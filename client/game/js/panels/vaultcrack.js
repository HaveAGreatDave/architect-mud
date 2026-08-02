// VAULT CRACK — a safecracker's reinterpretation of cracking a vendor safe's
// combination lock. The lock is a stack of WHEELS; each has a hidden CONTACT
// POINT somewhere on the 0-99 dial. You spin the dial (drag it, or ◀ ▶ / arrow
// keys) and read the CONTACT gauge — a contact-mic amplitude that swells the
// closer the dial sits to the active wheel's true contact point (a stethoscope
// on the door). Land inside the resonance band and SET to drop that tumbler and
// advance; guess wrong and the drive cam slips, spiking the TAMPER meter. Drop
// every wheel before TAMPER tops out → the bolt retracts; let TAMPER fill → the
// lock re-seats and your rig is flagged.
//
// A cosmetic overlay launched from `hack`-ing a vendor safe (see
// plugins/vendor-safe/index.js → dispatch.js's `vault_crack` route). The
// win/lose result is reported via opts.onResult; the caller fires the real
// server command (`safecrackresolve`), which is authoritative for the outcome
// and the payout. The board weighs the player's real effective hacking skill
// against the safe's difficulty: the gap (edge = skill - difficulty) drives
// wheel count, resonance-band width, sensing range, gauge noise and the ambient
// tamper trickle — an outclassed cracker gets a vague, jittery signal and a
// tight window, not a cosmetic difference.

import { sfx, clampInt, clampNum, esc, mountOverlay, ensureChassisStyles, deviceHeader, bezelScrews, reticleCorners, deckStrip, setDeckLevel } from './minigame-common.js';

// Shortest distance between two dial positions on the 0-99 ring.
const circDist = (a, b) => { const d = Math.abs(a - b) % 100; return Math.min(d, 100 - d); };
const normDial = (v) => ((Math.round(v) % 100) + 100) % 100;

let _overlay = null;
let _close = null;
let _state = null;
let _opts = null;
let _raf = 0;
let _lastT = 0;
let _drag = null; // { startAngle, startDial } while spinning the dial

// ── Audio ─────────────────────────────────────────────────────────────────
// Cues resolve through window.SFXCatalog by id ('vault-entry', 'vault-tick', …);
// the synth defs live in client/shared/sfx-catalog.js so they're editable in the
// dev panel's Sounds tab (Interface / Game SFX). Guarded — silent if audio isn't up.

// ── Styles ──────────────────────────────────────────────────────────────────
function ensureStyles() {
  if (document.getElementById('vaultcrack-styles')) return;
  const s = document.createElement('style');
  s.id = 'vaultcrack-styles';
  s.textContent = `
    #vaultcrack-overlay { --vc-accent:#3fe3ff; --mg-accent:#3fe3ff; position:fixed; inset:0; z-index:9200; display:flex; align-items:center; justify-content:center;
      background:rgba(2,4,6,0.78); backdrop-filter:blur(3px); font-family:'Courier New',monospace; }
    /* Moulded titanium-terminal chassis — top-lit multi-stop gunmetal body (ATM #atm-box). */
    #vaultcrack-overlay .vc-panel { width:min(500px,94vw); color:var(--vc-accent);
      background:linear-gradient(180deg, #3b424a 0%, #2c333a 7%, #1d2329 12%, #0e1215 100%);
      padding:14px 16px 16px; animation:vc-boot .3s ease-out; }
    @keyframes vc-boot { 0%{opacity:0;transform:scale(.985)} 100%{opacity:1;transform:scale(1)} }
    #vaultcrack-overlay .vc-hud { display:flex; gap:16px; align-items:center; padding:8px 2px; font-size:12px; color:#8b97a2; letter-spacing:1px; flex-wrap:wrap; }
    #vaultcrack-overlay .vc-hud b { color:var(--vc-accent); font-weight:bold; }
    #vaultcrack-overlay .vc-pips { letter-spacing:3px; font-size:14px; }
    #vaultcrack-overlay .vc-heat-wrap { display:inline-flex; align-items:center; gap:6px; margin-left:auto; }
    #vaultcrack-overlay .vc-heat-bar { display:inline-block; width:120px; height:8px; background:#12161a; border:1px solid #3a424a; border-radius:3px; overflow:hidden; }
    #vaultcrack-overlay .vc-heat-fill { display:block; height:100%; width:0%; background:#46e05a; transition:width .1s linear, background .2s; }
    /* The dial sits on a dark faceplate inside the shared .mg-bezel (which
       supplies the recessed frame + corner screws). */
    #vaultcrack-overlay .vc-dialwrap { display:block; position:relative; background:radial-gradient(120% 120% at 50% 40%, #06090d, #010305 80%);
      border-radius:8px; padding:6px 4px; }
    #vaultcrack-overlay .vc-dialwrap svg { display:block; width:100%; height:auto; touch-action:none; }
    #vaultcrack-overlay .vc-disc { cursor:grab; }
    #vaultcrack-overlay .vc-disc.vc-grabbing { cursor:grabbing; }
    #vaultcrack-overlay .vc-gauge-row { display:flex; align-items:center; gap:8px; padding:6px 2px 2px; font-size:11px; color:#8b97a2; letter-spacing:1px; }
    #vaultcrack-overlay .vc-gauge { position:relative; flex:1; height:16px; background:#12161a; border:1px solid #3a424a; border-radius:3px; overflow:hidden; }
    #vaultcrack-overlay .vc-gauge-band { position:absolute; top:0; bottom:0; right:0; background:rgba(70,224,90,0.16); border-left:1px dashed #46e05a; }
    #vaultcrack-overlay .vc-gauge-fill { position:absolute; top:0; bottom:0; left:0; width:0%; background:linear-gradient(90deg,#5a636c,var(--vc-accent)); }
    #vaultcrack-overlay .vc-status { min-height:22px; padding:8px 2px 2px; font-size:13px; letter-spacing:1px; font-weight:bold; }
    #vaultcrack-overlay .vc-status .vc-win { color:#46e05a; }
    #vaultcrack-overlay .vc-status .vc-lose { color:#ff4a5b; }
    #vaultcrack-overlay .vc-status .vc-warn { color:#ffb23e; }
    #vaultcrack-overlay .vc-actions { display:flex; gap:8px; margin-top:8px; }
    #vaultcrack-overlay .vc-btn { flex:1; padding:9px 6px; background:#171b1f; color:#b8c2cc; border:1px solid #3a424a;
      border-radius:2px; cursor:pointer; font-family:'Courier New',monospace; font-size:12px; font-weight:bold; letter-spacing:2px;
      text-transform:uppercase; box-shadow:inset 0 -2px 0 rgba(0,0,0,0.5); transition:all .12s; }
    #vaultcrack-overlay .vc-btn:hover { transform:translateY(1px); color:var(--vc-accent); border-color:var(--vc-accent); }
    #vaultcrack-overlay .vc-btn-turn { flex:0 0 56px; font-size:15px; }
    #vaultcrack-overlay .vc-btn-set { flex:1.4; }
    #vaultcrack-overlay .vc-btn-abort:hover { color:#ff4a5b; border-color:#ff4a5b; }
    @keyframes vc-flare { 0%{opacity:0.85} 100%{opacity:0} }
    #vaultcrack-overlay .vc-flare-on { animation:vc-flare .2s ease-out; }
  `;
  document.head.appendChild(s);
}

// ── Generation ──────────────────────────────────────────────────────────────
function generate(skill, difficulty) {
  const edge = skill - difficulty;
  const n = clampInt(2 + difficulty / 3, 2, 4);                       // wheels to solve
  const tolerance = clampInt(5 + edge * 0.5, 2, 9);                   // dial units you must land within
  const senseRange = clampInt(16 + skill * 1.8, 12, 46);             // how far out the gauge reacts
  const noise = clampNum(0.30 - skill * 0.02 + difficulty * 0.02, 0.03, 0.45); // gauge jitter
  const sharpen = clampNum(2.2 - skill * 0.12, 0.9, 2.4);            // <1 broad/clear, >1 only-when-close
  const heatTrickle = clampNum(0.018 + difficulty * 0.006 - skill * 0.004, 0.005, 0.055); // per sec
  const slipPenalty = clampNum(0.16 - edge * 0.015, 0.07, 0.36);

  const wheels = [];
  for (let i = 0; i < n; i++) wheels.push({ target: Math.floor(Math.random() * 100), set: false, setAt: null });

  return {
    wheels, active: 0, dial: 0, heat: 0, gauge: 0,
    tolerance, senseRange, noise, sharpen, heatTrickle, slipPenalty,
    over: false, won: false,
  };
}

// True proximity amplitude (0..1) for the active wheel, before noise.
function baseAmp(st) {
  const w = st.wheels[st.active];
  if (!w) return 0;
  const d = circDist(st.dial, w.target);
  if (d >= st.senseRange) return 0;
  return Math.pow(1 - d / st.senseRange, st.sharpen);
}
// The green resonance band on the gauge = the amplitude at the tolerance edge.
// Landing the (noisy) needle into it is the cue that a SET will drop the tumbler.
function bandFloor(st) { return Math.pow(1 - Math.min(1, st.tolerance / st.senseRange), st.sharpen); }

// ── The SKIN seam ────────────────────────────────────────────────────────────
// Everything above is the SAFE — wheel count, tolerance, sensing range, gauge
// noise, the sharpen curve and the tamper trickle, all scaled off
// skill-vs-difficulty. Everything below is one way of drawing it.
//
// textvault.js installs a skin and cracks the identical safe in characters. The
// hunt is unchanged: the same hidden contact points, the same noisy gauge, the
// same tolerance. Only the dial stops being a thing you drag and becomes a number
// you step — which is arguably the more honest safecracking interface anyway.
let _skin = null;
export function setVaultSkin(skin) { _skin = skin; }

export function startVaultGame(opts) {
  _opts = { skill: 4, difficulty: 5, deviceName: 'VENDOR SAFE', onResult: null, ...opts };
  _state = generate(_opts.skill, _opts.difficulty);
  _lastT = performance.now();
  _raf = requestAnimationFrame(tick);
  return _state;
}
export function stopVaultGame() {
  if (_raf) cancelAnimationFrame(_raf);
  _raf = 0; _state = null;
}
// The two actions and the two read-only curves a skin needs to draw the gauge.
export { turn as vaultTurn, trySet as vaultSet, baseAmp as vaultAmp, bandFloor as vaultBand };

// ── Render ──────────────────────────────────────────────────────────────────
const DIAL_CX = 150, DIAL_CY = 150, DIAL_R = 120;
const angleOf = (v) => (v / 100) * 360 - 90;                          // 0 at top, clockwise (deg)

function buildDial() {
  // The lock is a holographic ring display, not a metal dial: a dark glass face
  // carrying a glowing graduation ring that rotates with your input, concentric
  // luminous rings, and a digital core readout. The rotating group (#vc-disc-spin),
  // marks, readout and pointer keep their IDs so the drag/paint/flare code is
  // unchanged — only the look moved from milled brass to glowing glass.
  let ticks = '';
  for (let v = 0; v < 100; v++) {
    const major = v % 5 === 0;
    const a = angleOf(v) * Math.PI / 180;
    const r1 = DIAL_R - (major ? 13 : 6), r2 = DIAL_R - 1;
    const x1 = DIAL_CX + Math.cos(a) * r1, y1 = DIAL_CY + Math.sin(a) * r1;
    const x2 = DIAL_CX + Math.cos(a) * r2, y2 = DIAL_CY + Math.sin(a) * r2;
    ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--vc-accent)" stroke-width="${major ? 1.8 : 1}" opacity="${major ? 0.95 : 0.38}"/>`;
    if (major) {
      const rt = DIAL_R - 27;
      const tx = DIAL_CX + Math.cos(a) * rt, ty = DIAL_CY + Math.sin(a) * rt;
      ticks += `<text x="${tx.toFixed(1)}" y="${(ty + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="var(--vc-accent)" opacity="0.85" transform="rotate(${(v / 100) * 360} ${tx.toFixed(1)} ${ty.toFixed(1)})">${v}</text>`;
    }
  }
  return `
    <svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg" font-family="'Courier New',monospace">
      <defs>
        <radialGradient id="vc-face" cx="50%" cy="44%" r="66%"><stop offset="0%" stop-color="#0a1017"/><stop offset="70%" stop-color="#04070b"/><stop offset="100%" stop-color="#010305"/></radialGradient>
        <radialGradient id="vc-core" cx="50%" cy="44%" r="62%"><stop offset="0%" stop-color="#0e1a24"/><stop offset="100%" stop-color="#03070c"/></radialGradient>
        <filter id="vc-glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <filter id="vc-glowR" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <filter id="vc-drop" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity="0.6"/></filter>
        <pattern id="vc-scan" width="4" height="3" patternUnits="userSpaceOnUse"><rect width="4" height="1" y="2" fill="#000" opacity="0.35"/></pattern>
        <clipPath id="vc-clip"><circle cx="${DIAL_CX}" cy="${DIAL_CY}" r="131"/></clipPath>
      </defs>
      <!-- dark glass lock face + cast shadow + faint holo scanlines -->
      <circle cx="${DIAL_CX}" cy="${DIAL_CY}" r="133" fill="#010305" stroke="#0c1116" stroke-width="2" filter="url(#vc-drop)"/>
      <circle cx="${DIAL_CX}" cy="${DIAL_CY}" r="131" fill="url(#vc-face)"/>
      <circle cx="${DIAL_CX}" cy="${DIAL_CY}" r="131" fill="url(#vc-scan)" opacity="0.5" clip-path="url(#vc-clip)"/>
      <!-- glowing outer rim -->
      <circle cx="${DIAL_CX}" cy="${DIAL_CY}" r="126" fill="none" stroke="var(--vc-accent)" stroke-opacity="0.55" stroke-width="1" filter="url(#vc-glowR)"/>
      <!-- concentric holo rings, slowly counter-rotating -->
      <circle cx="${DIAL_CX}" cy="${DIAL_CY}" r="104" fill="none" stroke="var(--vc-accent)" stroke-opacity="0.22" stroke-width="1" stroke-dasharray="3 8">
        <animateTransform attributeName="transform" type="rotate" from="0 ${DIAL_CX} ${DIAL_CY}" to="360 ${DIAL_CX} ${DIAL_CY}" dur="30s" repeatCount="indefinite"/>
      </circle>
      <circle cx="${DIAL_CX}" cy="${DIAL_CY}" r="60" fill="none" stroke="var(--vc-accent)" stroke-opacity="0.20" stroke-width="1" stroke-dasharray="2 9">
        <animateTransform attributeName="transform" type="rotate" from="360 ${DIAL_CX} ${DIAL_CY}" to="0 ${DIAL_CX} ${DIAL_CY}" dur="24s" repeatCount="indefinite"/>
      </circle>
      <!-- the rotating glowing graduation ring (the "dial") -->
      <g class="vc-disc" id="vc-disc">
        <circle cx="${DIAL_CX}" cy="${DIAL_CY}" r="${DIAL_R + 2}" fill="transparent" pointer-events="all"/>
        <g id="vc-disc-spin" filter="url(#vc-glowR)">${ticks}</g>
      </g>
      <!-- set-wheel glowing markers (redrawn per set) -->
      <g id="vc-marks" filter="url(#vc-glow)"></g>
      <!-- digital core + glowing readout -->
      <circle cx="${DIAL_CX}" cy="${DIAL_CY}" r="44" fill="url(#vc-core)" stroke="var(--vc-accent)" stroke-opacity="0.5" stroke-width="1" filter="url(#vc-glowR)"/>
      <circle cx="${DIAL_CX}" cy="${DIAL_CY}" r="38" fill="none" stroke="var(--vc-accent)" stroke-opacity="0.25" stroke-width="1"/>
      <text id="vc-readout" x="${DIAL_CX}" y="${DIAL_CY + 9}" text-anchor="middle" font-size="30" font-weight="bold" fill="var(--vc-accent)" filter="url(#vc-glow)">00</text>
      <!-- glowing index pointer + tick-flare -->
      <circle id="vc-flare" cx="${DIAL_CX}" cy="26" r="12" fill="var(--vc-accent)" opacity="0" filter="url(#vc-glow)"/>
      <g filter="url(#vc-glow)"><path d="M${DIAL_CX - 7},13 L${DIAL_CX + 7},13 L${DIAL_CX},29 Z" fill="var(--vc-accent)"/><line x1="${DIAL_CX}" y1="29" x2="${DIAL_CX}" y2="40" stroke="var(--vc-accent)" stroke-width="2"/></g>
    </svg>`;
}

// Flash the index pointer as the dial clicks past a graduation.
function flarePointer() {
  const el = _overlay?.querySelector('#vc-flare');
  if (!el) return;
  el.classList.remove('vc-flare-on');
  void el.getBoundingClientRect();   // force reflow so the animation restarts
  el.classList.add('vc-flare-on');
}

function paintDial() {
  if (_skin) return _skin.board(_state);
  const spin = _overlay.querySelector('#vc-disc-spin');
  if (spin) spin.setAttribute('transform', `rotate(${(-_state.dial / 100) * 360} ${DIAL_CX} ${DIAL_CY})`);
  const ro = _overlay.querySelector('#vc-readout');
  if (ro) ro.textContent = String(_state.dial).padStart(2, '0');
  // Green pips at each set wheel's contact point.
  const marks = _overlay.querySelector('#vc-marks');
  if (marks) {
    marks.innerHTML = _state.wheels.filter(w => w.set).map(w => {
      const a = angleOf(w.setAt) * Math.PI / 180;
      const rr = DIAL_R - 5;
      const x = DIAL_CX + Math.cos(a) * rr, y = DIAL_CY + Math.sin(a) * rr;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="#5cff86"/>`;
    }).join('');
  }
}

function renderHud() {
  if (_skin) return _skin.hud(_state);
  const pips = _overlay.querySelector('#vc-pips');
  if (pips) pips.innerHTML = _state.wheels.map(w => w.set ? '<span style="color:#46e05a">&#9673;</span>' : '<span style="color:#4a525a">&#9711;</span>').join(' ');
  const fill = _overlay.querySelector('#vc-heat-fill');
  const pct = Math.round(_state.heat * 100);
  fill.style.width = `${pct}%`;
  fill.style.background = pct > 75 ? '#ff4a5b' : pct > 45 ? '#ffb23e' : '#46e05a';
}

function renderGauge() {
  if (_skin) return _skin.frame(_state);
  const fill = _overlay.querySelector('#vc-gauge-fill');
  if (fill) fill.style.width = `${Math.round(_state.gauge * 100)}%`;
}

function setStatus(html) {
  if (_skin) return _skin.status(html);
  _overlay.querySelector('#vc-status').innerHTML = html;
}

// ── Loop ──────────────────────────────────────────────────────────────────
function tick(t) {
  if (!_state || _state.over) return;
  const dt = Math.min(0.05, (t - _lastT) / 1000 || 0);
  _lastT = t;

  // Ambient tamper creep — the safe's seismic sensor slowly homes in.
  _state.heat = clampNum(_state.heat + _state.heatTrickle * dt, 0, 1);

  // Contact gauge: true amplitude plus skill-scaled jitter, smoothed so the
  // needle swells and flickers rather than snapping.
  const target = clampNum(baseAmp(_state) + (Math.random() * 2 - 1) * _state.noise, 0, 1);
  _state.gauge += (target - _state.gauge) * 0.35;
  renderGauge();
  if (!_skin) { renderHud(); setDeckLevel(_overlay, _state.heat); }

  if (_state.heat >= 1) { finish(false); return; }
  _raf = requestAnimationFrame(tick);
}

// ── Actions ─────────────────────────────────────────────────────────────────
function turn(delta) {
  if (!_state || _state.over) return;
  _state.dial = normDial(_state.dial + delta);
  sfx('vault-tick');
  paintDial();
  flarePointer();
}

function trySet() {
  if (!_state || _state.over) return;
  const w = _state.wheels[_state.active];
  if (!w || w.set) return;
  const d = circDist(_state.dial, w.target);
  if (d <= _state.tolerance) {
    w.set = true; w.setAt = _state.dial;
    sfx('vault-set');
    paintDial();
    const next = _state.wheels.findIndex(x => !x.set);
    if (next === -1) { finish(true); return; }
    _state.active = next;
    renderHud();
    setStatus('<span class="vc-warn">&#9679; Tumbler dropped. Hunt the next contact.</span>');
  } else {
    _state.heat = clampNum(_state.heat + _state.slipPenalty, 0, 1);
    sfx('vault-slip');
    setStatus('<span class="vc-warn">Wrong contact — the cam slips and the tamper sensor spikes.</span>');
    renderHud();
    if (_state.heat >= 1) finish(false);
  }
}

function finish(won) {
  if (_state.over) return;
  _state.over = true; _state.won = won;
  cancelAnimationFrame(_raf); _raf = 0;
  sfx(won ? 'vault-win' : 'vault-lose');
  setStatus(won
    ? '<span class="vc-win">&#9673; BOLT RETRACTED — safe open.</span>'
    : '<span class="vc-lose">&#10007; LOCK RE-SEATED — rig flagged.</span>');
  const cb = _opts?.onResult;
  // A skin owns its own teardown — the character board is in the area pane.
  if (_skin) { _skin.finish?.(_state, won); if (cb) cb({ won }); return; }
  if (won) {
    setTimeout(() => { close(); cb && cb({ won: true }); }, 1100);
  } else {
    if (cb) cb({ won: false });
  }
}

// ── Dial spinning (drag) ─────────────────────────────────────────────────────
function pointerAngle(e) {
  const svg = _overlay.querySelector('.vc-dialwrap svg');
  const r = svg.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width * 300;
  const py = (e.clientY - r.top) / r.height * 300;
  return Math.atan2(py - DIAL_CY, px - DIAL_CX) * 180 / Math.PI;
}
function onDragStart(e) {
  if (!_state || _state.over) return;
  e.preventDefault();
  _drag = { startAngle: pointerAngle(e), startDial: _state.dial };
  _overlay.querySelector('#vc-disc')?.classList.add('vc-grabbing');
}
function onDragMove(e) {
  if (!_drag || !_state || _state.over) return;
  let delta = pointerAngle(e) - _drag.startAngle;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  const prev = _state.dial;
  _state.dial = normDial(_drag.startDial + delta / 360 * 100);
  if (_state.dial !== prev) { sfx('vault-tick'); paintDial(); flarePointer(); }
}
function onDragEnd() {
  if (!_drag) return;
  _drag = null;
  _overlay.querySelector('#vc-disc')?.classList.remove('vc-grabbing');
}

// ── Public API ────────────────────────────────────────────────────────────────
export function openVaultCrack(opts = {}) {
  ensureStyles();
  ensureChassisStyles();
  close();
  _opts = { skill: 4, difficulty: 5, deviceName: 'VENDOR SAFE', onResult: null, ...opts };
  _state = generate(_opts.skill, _opts.difficulty);

  const html =
    `<div class="vc-panel mg-chassis">
      ${deviceHeader('&#9673;', 'VAULT CRACK', 'TARGET &middot; ' + esc(_opts.deviceName).toUpperCase())}
      <div class="vc-hud">
        <span>WHEELS <b class="vc-pips" id="vc-pips"></b></span>
        <span class="vc-heat-wrap">TAMPER <span class="vc-heat-bar"><span class="vc-heat-fill" id="vc-heat-fill"></span></span></span>
      </div>
      <div class="mg-bezel">${bezelScrews()}<div class="vc-dialwrap">${buildDial()}${reticleCorners()}</div></div>
      <div class="vc-gauge-row">CONTACT
        <span class="vc-gauge"><span class="vc-gauge-band" id="vc-gauge-band"></span><span class="vc-gauge-fill" id="vc-gauge-fill"></span></span>
      </div>
      <div class="vc-status" id="vc-status"></div>
      <div class="vc-actions">
        <button class="vc-btn vc-btn-turn" data-turn="-1" title="Turn left">&#9664;</button>
        <button class="vc-btn vc-btn-set" title="Set the wheel (Space)">Set &#9251;</button>
        <button class="vc-btn vc-btn-turn" data-turn="1" title="Turn right">&#9654;</button>
        <button class="vc-btn vc-btn-abort">Abort</button>
      </div>
      ${deckStrip('VAULT DRIVE', 'TAMPER')}
    </div>`;

  const mounted = mountOverlay({
    id: 'vaultcrack-overlay',
    html,
    onKey: (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); turn(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); turn(1); }
      else if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') { e.preventDefault(); trySet(); }
    },
    onClose: () => {
      if (_raf) { cancelAnimationFrame(_raf); _raf = 0; }
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', onDragEnd);
      _state = null;
      _drag = null;
    },
  });
  const overlay = mounted.overlay;
  _overlay = overlay;
  _close = mounted.close;
  overlay.querySelector('.mg-close').addEventListener('click', close);
  overlay.querySelector('.vc-btn-abort').addEventListener('click', close);
  overlay.querySelector('.vc-btn-set').addEventListener('click', trySet);
  overlay.querySelectorAll('[data-turn]').forEach(b =>
    b.addEventListener('click', () => turn(parseInt(b.getAttribute('data-turn'), 10))));

  const disc = overlay.querySelector('#vc-disc');
  disc.addEventListener('pointerdown', onDragStart);
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);

  window.AudioEngine?.init?.();
  sfx('vault-entry');

  // Position the green resonance band on the gauge (top slice above the
  // tolerance-edge amplitude) and paint the initial state.
  const floor = bandFloor(_state);
  overlay.querySelector('#vc-gauge-band').style.width = `${Math.round((1 - floor) * 100)}%`;
  paintDial();
  renderHud();
  renderGauge();
  setStatus('<span style="color:#8b97a2">Spin the dial (drag / &#9664; &#9654;) to find each wheel\'s contact — SET when CONTACT peaks into the green. Beat the TAMPER meter.</span>');
  _lastT = performance.now();
  _raf = requestAnimationFrame(tick);
}

function close() {
  if (_close) { _close(); _close = null; }
  _overlay = null;
}
