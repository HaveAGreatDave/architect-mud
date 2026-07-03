// REEL — a tension-bar fishing minigame. Something's on the line and fighting.
// A vertical GAFF slides up while you REEL (hold Space / the button / the tube)
// and sinks when you let go; the hooked catch darts up and down the water column
// on its own. Keep the gaff overlapping the catch to fill the CREEL meter; lose
// the overlap and the LINE tension climbs and the creel bleeds back down. Fill
// the creel before the catch throws the hook (creel empties) → it's landed.
//
// A cosmetic overlay armed server-side by the fishing plugin on a bite (see
// plugins/fishing/index.js → dispatch.js's `fishing_game` route). The win/lose
// result is reported via opts.onResult; the caller fires the real server command
// (`fishresolve`), which is authoritative — it validates the anti-spoof token +
// posture + carried rod, then applies the catch, spawns a hooked monster, or
// snaps the rod. The board weighs the player's real Fishing skill against the
// catch's difficulty: the gap (edge = skill - difficulty) drives the gaff size,
// how wildly the catch fights, and how fast the creel fills — an outclassed
// angler faces a genuinely brutal fight, not a cosmetic difference.

import { sfx, clampInt, clampNum, esc, mountOverlay, ensureChassisStyles, deviceHeader, bezelScrews, crtOverlays, deckStrip, setDeckLevel } from './minigame-common.js';

let _overlay = null;
let _close = null;
let _state = null;
let _opts = null;
let _raf = 0;
let _lastT = 0;
let _hold = false;
let _listeners = [];

// ── Audio ─────────────────────────────────────────────────────────────────
// Cues resolve through window.SFXCatalog by id ('fishing-cast', …); the synth
// defs live in client/shared/sfx-catalog.js so they're editable in the dev
// panel's Sounds tab. Guarded — silent if audio isn't up. Falls back to the
// hololock cues if a fishing cue isn't catalogued yet.
function fsfx(id, fallback) {
  const cat = window.SFXCatalog;
  if (cat && typeof cat.get === 'function' && cat.get(id)) sfx(id);
  else if (fallback) sfx(fallback);
}

// ── Styles ──────────────────────────────────────────────────────────────────
function ensureStyles() {
  if (document.getElementById('fishing-styles')) return;
  const s = document.createElement('style');
  s.id = 'fishing-styles';
  s.textContent = `
    #fishing-overlay { --fs-accent:#4fe0a0; --mg-accent:#4fe0a0; position:fixed; inset:0; z-index:9200; display:flex; align-items:center; justify-content:center;
      background:rgba(0,6,7,0.80); backdrop-filter:blur(3px); font-family:'Courier New',monospace; }
    /* Moulded brine-green chassis — top-lit multi-stop body (matches the ATM #atm-box). */
    #fishing-overlay .fs-panel { width:min(540px,94vw); color:var(--fs-accent);
      background:linear-gradient(180deg, #16302a 0%, #0f231e 7%, #091712 12%, #040d0a 100%);
      padding:14px 16px 16px; animation:fs-boot .3s ease-out; }
    @keyframes fs-boot { 0%{opacity:0;transform:scale(.985)} 100%{opacity:1;transform:scale(1)} }
    #fishing-overlay .fs-hud { display:flex; gap:16px; align-items:center; padding:8px 2px; font-size:12px; color:#7fae99; letter-spacing:1px; flex-wrap:wrap; }
    #fishing-overlay .fs-hud b { color:var(--fs-accent); font-weight:bold; }
    #fishing-overlay .fs-creel-wrap { display:inline-flex; align-items:center; gap:6px; margin-left:auto; }
    #fishing-overlay .fs-creel-bar { display:inline-block; width:120px; height:8px; background:#0a1a16; border:1px solid #2b5040; border-radius:3px; overflow:hidden; }
    #fishing-overlay .fs-creel-fill { display:block; height:100%; width:35%; background:#46e05a; transition:width .1s linear, background .2s; }
    #fishing-overlay .fs-bezel { margin:4px 0 2px; }
    #fishing-overlay .fs-screen { background:radial-gradient(130% 130% at 50% 42%, color-mix(in srgb, var(--fs-accent) 11%, #02100b) 55%, #01070a 100%); }
    /* The play area: a tall water column (the tube) with a controllable gaff band
       and the hooked catch drifting inside it. */
    #fishing-overlay .fs-rig { position:relative; z-index:2; display:flex; gap:12px; padding:14px 16px; align-items:stretch; justify-content:center; }
    #fishing-overlay .fs-column { position:relative; width:74px; height:250px; border:1px solid #22463a; border-radius:6px; overflow:hidden; cursor:pointer;
      background:linear-gradient(180deg,#0a221c 0%,#08211e 40%,#061a1a 100%);
      box-shadow:inset 0 2px 6px rgba(0,0,0,0.7), inset 0 0 22px color-mix(in srgb, var(--fs-accent) 12%, transparent); }
    /* Drifting caustic light bands in the water. */
    #fishing-overlay .fs-column::before { content:''; position:absolute; inset:-40% 0; pointer-events:none;
      background:repeating-linear-gradient(0deg, transparent 0 16px, color-mix(in srgb, var(--fs-accent) 8%, transparent) 16px 18px);
      animation:fs-caustic 5.5s linear infinite; }
    @keyframes fs-caustic { 0%{transform:translateY(0)} 100%{transform:translateY(34px)} }
    /* The gaff — the band you drive up/down to bracket the catch. */
    #fishing-overlay .fs-gaff { position:absolute; left:3px; right:3px; border-radius:5px;
      background:linear-gradient(180deg, color-mix(in srgb, var(--fs-accent) 46%, transparent), color-mix(in srgb, var(--fs-accent) 20%, transparent));
      border:1px solid var(--fs-accent);
      box-shadow:0 0 12px color-mix(in srgb, var(--fs-accent) 45%, transparent), inset 0 0 8px color-mix(in srgb, var(--fs-accent) 30%, transparent);
      transition:background .12s, box-shadow .12s; }
    #fishing-overlay .fs-gaff.fs-locked { background:linear-gradient(180deg, rgba(70,224,90,0.5), rgba(70,224,90,0.24)); border-color:#46e05a; box-shadow:0 0 16px rgba(70,224,90,0.5), inset 0 0 8px rgba(70,224,90,0.35); }
    /* The hooked catch — a silhouette that fights up and down the column. */
    #fishing-overlay .fs-fish { position:absolute; left:50%; width:30px; height:16px; margin-left:-15px; margin-top:-8px; pointer-events:none;
      color:#0a1a14; filter:drop-shadow(0 0 6px color-mix(in srgb, var(--fs-accent) 60%, transparent)); }
    #fishing-overlay .fs-fish svg { display:block; width:100%; height:100%; }
    /* Tension rope on the right of the column. */
    #fishing-overlay .fs-tension { position:relative; width:12px; height:250px; border:1px solid #22463a; border-radius:6px; overflow:hidden; background:#081712; }
    #fishing-overlay .fs-tension-fill { position:absolute; left:0; right:0; bottom:0; height:0%; background:linear-gradient(180deg,#ff4a5b,#ffb23e); transition:height .12s linear, opacity .2s; opacity:0.85; }
    #fishing-overlay .fs-tension-label { position:absolute; top:4px; left:50%; transform:translateX(-50%); font-size:7px; letter-spacing:1px; color:#7fae99; writing-mode:vertical-rl; }
    #fishing-overlay .fs-status { min-height:22px; padding:8px 2px 2px; font-size:13px; letter-spacing:1px; font-weight:bold; }
    #fishing-overlay .fs-status .fs-win { color:#46e05a; }
    #fishing-overlay .fs-status .fs-lose { color:#ff4a5b; }
    #fishing-overlay .fs-actions { display:flex; gap:8px; margin-top:8px; }
    #fishing-overlay .fs-btn { flex:1; padding:11px 6px; background:#0a1a16; color:#8fc4ab; border:1px solid #2b5040;
      border-radius:2px; cursor:pointer; font-family:'Courier New',monospace; font-size:12px; font-weight:bold; letter-spacing:2px;
      text-transform:uppercase; box-shadow:inset 0 -2px 0 rgba(0,0,0,0.5); transition:all .12s; user-select:none; -webkit-user-select:none; touch-action:none; }
    #fishing-overlay .fs-btn-reel.fs-down { color:#040d0a; background:var(--fs-accent); border-color:var(--fs-accent); box-shadow:inset 0 2px 4px rgba(0,0,0,0.4); }
    #fishing-overlay .fs-btn-abort:hover { color:#ff4a5b; border-color:#ff4a5b; }
  `;
  document.head.appendChild(s);
}

const FISH_SVG = `<svg viewBox="0 0 30 16" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M2 8 L10 3 Q20 0 27 6 Q28 8 27 10 Q20 16 10 13 Z"/><path fill="currentColor" d="M0 8 L6 4 L6 12 Z"/><circle cx="22" cy="7" r="1.4" fill="var(--fs-accent)"/></svg>`;

// ── Generation ──────────────────────────────────────────────────────────────
function generate(skill, difficulty) {
  const edge = skill - difficulty;
  return {
    // Positions are 0 (top) .. 1 (bottom) of the column.
    gaff: 0.5, gaffVel: 0,
    gaffH: clampNum(0.22 + edge * 0.02, 0.11, 0.40),   // gaff band height (fraction) — skill widens it
    fish: 0.5, fishTarget: 0.5, fishTimer: 0,
    fishSpeed: clampNum(0.4 + difficulty * 0.055 - skill * 0.02, 0.22, 1.5), // how fast it chases its target
    dartChance: clampNum(0.4 + difficulty * 0.06 - skill * 0.03, 0.2, 1.6),  // darts/sec toward an extreme
    fillRate: clampNum(0.44 + edge * 0.03, 0.26, 0.85), // creel gain/sec while bracketed
    drainRate: clampNum(0.30 - edge * 0.02, 0.14, 0.6), // creel loss/sec while not
    creel: 0.35,     // progress toward landing (win at 1, snap at 0)
    tension: 0,      // strain readout (drives the deck LEDs) — climbs off-bracket
    over: false, won: false,
  };
}

// ── Physics ─────────────────────────────────────────────────────────────────
const LIFT = 1.9, GRAVITY = 1.25, DAMP = 0.86;
function stepGaffStable(s, dt) {
  const accel = _hold ? -LIFT : GRAVITY;         // up is negative
  s.gaffVel = (s.gaffVel + accel * dt) * DAMP;
  let np = s.gaff + s.gaffVel * dt;
  const lo = s.gaffH / 2, hi = 1 - s.gaffH / 2;
  if (np < lo) { np = lo; s.gaffVel = 0; }
  if (np > hi) { np = hi; s.gaffVel = 0; }
  s.gaff = np;
}

function stepFish(s, dt) {
  s.fishTimer -= dt;
  if (s.fishTimer <= 0) {
    // Pick a new target; occasionally dart to an extreme (the fight).
    if (Math.random() < s.dartChance * 0.5) s.fishTarget = Math.random() < 0.5 ? 0.08 : 0.92;
    else s.fishTarget = 0.12 + Math.random() * 0.76;
    s.fishTimer = 0.35 + Math.random() * 0.9 / Math.max(0.4, s.dartChance);
  }
  const dir = Math.sign(s.fishTarget - s.fish);
  s.fish = clampNum(s.fish + dir * s.fishSpeed * dt, 0.05, 0.95);
}

// ── Render ──────────────────────────────────────────────────────────────────
function render() {
  const col = _overlay.querySelector('#fs-column');
  const gaff = _overlay.querySelector('#fs-gaff');
  const fish = _overlay.querySelector('#fs-fish');
  if (!col || !gaff || !fish) return;
  const h = col.clientHeight;
  const gh = _state.gaffH * h;
  gaff.style.height = `${gh}px`;
  gaff.style.top = `${_state.gaff * h - gh / 2}px`;
  fish.style.top = `${_state.fish * h}px`;
  const bracketed = Math.abs(_state.fish - _state.gaff) <= _state.gaffH / 2;
  gaff.classList.toggle('fs-locked', bracketed);

  const creel = _overlay.querySelector('#fs-creel-fill');
  const pct = Math.round(_state.creel * 100);
  creel.style.width = `${pct}%`;
  creel.style.background = pct > 66 ? '#46e05a' : pct > 33 ? '#ffb23e' : '#ff4a5b';

  const tfill = _overlay.querySelector('#fs-tension-fill');
  if (tfill) tfill.style.height = `${Math.round(_state.tension * 100)}%`;
}

function setStatus(html) { const el = _overlay.querySelector('#fs-status'); if (el) el.innerHTML = html; }

// ── Loop ──────────────────────────────────────────────────────────────────
function tick(t) {
  if (!_state || _state.over) return;
  const dt = Math.min(0.05, (t - _lastT) / 1000 || 0);
  _lastT = t;

  stepGaffStable(_state, dt);
  stepFish(_state, dt);

  const bracketed = Math.abs(_state.fish - _state.gaff) <= _state.gaffH / 2;
  if (bracketed) {
    _state.creel = clampNum(_state.creel + _state.fillRate * dt, 0, 1);
    _state.tension = clampNum(_state.tension - 1.4 * dt, 0, 1);
  } else {
    _state.creel = clampNum(_state.creel - _state.drainRate * dt, 0, 1);
    _state.tension = clampNum(_state.tension + 0.9 * dt, 0, 1);
  }

  render();
  setDeckLevel(_overlay, _state.tension);

  if (_state.creel >= 1) { finish(true); return; }
  if (_state.creel <= 0) { finish(false); return; }
  _raf = requestAnimationFrame(tick);
}

function finish(won) {
  if (_state.over) return;
  _state.over = true; _state.won = won;
  cancelAnimationFrame(_raf); _raf = 0;
  fsfx(won ? 'fishing-land' : 'fishing-snap', won ? 'hololock-win' : 'hololock-lose');
  setStatus(won
    ? '<span class="fs-win">◇ LANDED — it\'s yours.</span>'
    : '<span class="fs-lose">✕ LINE SNAPPED — it threw the hook.</span>');
  const cb = _opts?.onResult;
  setTimeout(() => { close(); if (cb) cb({ won }); }, 1100);
}

// ── Hold wiring ───────────────────────────────────────────────────────────────
function setHold(on) {
  _hold = on;
  const btn = _overlay?.querySelector('.fs-btn-reel');
  if (btn) btn.classList.toggle('fs-down', on);
}
function addListener(target, type, fn, opts) { target.addEventListener(type, fn, opts); _listeners.push([target, type, fn, opts]); }
function clearListeners() { for (const [t, ty, fn, o] of _listeners) t.removeEventListener(ty, fn, o); _listeners = []; }

// ── Public API ────────────────────────────────────────────────────────────────
export function openFishing(opts = {}) {
  ensureStyles();
  ensureChassisStyles();
  close();
  _opts = { skill: 4, difficulty: 5, deviceName: 'THE LINE', onResult: null, ...opts };
  const html =
    `<div class="fs-panel mg-chassis">
      ${deviceHeader('&#127907;', 'REEL', 'ON THE LINE &middot; ' + esc(_opts.deviceName).toUpperCase())}
      <div class="fs-hud">
        <span>DEPTH <b>&#8597;</b></span>
        <span class="fs-creel-wrap">CREEL <span class="fs-creel-bar"><span class="fs-creel-fill" id="fs-creel-fill"></span></span></span>
      </div>
      <div class="fs-bezel mg-bezel">${bezelScrews()}<div class="fs-screen mg-screen" style="--mg-sweep-h:280px">
        <div class="fs-rig">
          <div class="fs-column" id="fs-column">
            <div class="fs-gaff" id="fs-gaff"></div>
            <div class="fs-fish" id="fs-fish">${FISH_SVG}</div>
          </div>
          <div class="fs-tension"><div class="fs-tension-fill" id="fs-tension-fill"></div><span class="fs-tension-label">TENSION</span></div>
        </div>
        ${crtOverlays()}
      </div></div>
      ${deckStrip('DRAG BUS', 'TENSION')}
      <div class="fs-status" id="fs-status"></div>
      <div class="fs-actions">
        <button class="fs-btn fs-btn-reel">Reel In &#9251;</button>
        <button class="fs-btn fs-btn-abort">Cut Line</button>
      </div>
    </div>`;
  const mounted = mountOverlay({
    id: 'fishing-overlay',
    html,
    closeOnBackdrop: false,   // don't let a stray click abandon an active fight
    onClose: () => { if (_raf) { cancelAnimationFrame(_raf); _raf = 0; } clearListeners(); _hold = false; _state = null; },
  });
  _overlay = mounted.overlay;
  _close = mounted.close;
  _overlay.querySelector('.mg-close').addEventListener('click', close);
  _overlay.querySelector('.fs-btn-abort').addEventListener('click', close);

  // Hold-to-reel: the button, the water column, and Space all pull the gaff up.
  const reelBtn = _overlay.querySelector('.fs-btn-reel');
  const column = _overlay.querySelector('#fs-column');
  const down = (e) => { e.preventDefault(); setHold(true); };
  const up = () => setHold(false);
  addListener(reelBtn, 'pointerdown', down);
  addListener(column, 'pointerdown', down);
  addListener(window, 'pointerup', up);
  addListener(window, 'pointercancel', up);
  addListener(window, 'keydown', (e) => { if ((e.key === ' ' || e.key === 'Spacebar') && !e.repeat) { e.preventDefault(); setHold(true); } });
  addListener(window, 'keyup', (e) => { if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); setHold(false); } });

  window.AudioEngine?.init?.();
  fsfx('fishing-cast', 'hololock-entry');

  _state = generate(_opts.skill, _opts.difficulty);
  render();
  setStatus('<span style="color:#7fae99">HOLD to reel the gaff up over the catch. Bracket it to fill the CREEL — mind the TENSION.</span>');
  _lastT = performance.now();
  _raf = requestAnimationFrame(tick);
}

function close() {
  if (_close) { _close(); _close = null; }
  _overlay = null;
}
