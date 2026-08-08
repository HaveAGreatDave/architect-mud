// HOLOLOCK BYPASS — an electronic reinterpretation of a pin-tumbler lockpick.
// The lock is a stack of tumbler CHANNELS; each has a scanner sweeping left↔right
// across a hidden-until-lit SWEET ZONE. You work one channel at a time: SET the
// active pin (Space / click) while the scanner is inside its sweet zone and the
// pin locks green and you advance to the next. Miss and the pin springs back and
// the FEEDBACK meter climbs. Set every pin before FEEDBACK fills → the lock
// disengages; let FEEDBACK top out → the sequence resets and your deck is flagged.
//
// A cosmetic overlay launched from `hack`-ing a hololock door (see
// server/engine/commands/doors.js → dispatch.js's `hololock_game` route). The
// win/lose result is reported via opts.onResult; the caller fires the real
// server command (`hackresolve`), which is authoritative for the outcome. The
// board weighs the player's real effective hacking skill against the lock's
// difficulty: the gap (edge = skill - difficulty) drives pin count, sweet-zone
// width, scanner speed, miss penalty, and the ambient feedback trickle — an
// outclassed cracker faces a genuinely brutal lock, not a cosmetic difference.

import { sfx, clampInt, clampNum, esc, mountOverlay, ensureChassisStyles, deviceHeader, bezelScrews, crtOverlays, deckStrip, setDeckLevel } from './minigame-common.js';

let _overlay = null;
let _close = null;
let _state = null;
let _opts = null;
let _raf = 0;
let _lastT = 0;

// ── Audio ─────────────────────────────────────────────────────────────────
// Cues resolve through window.SFXCatalog by id ('hololock-entry', …); the synth
// defs live in client/shared/sfx-catalog.js so they're editable in the dev
// panel's Sounds tab (Interface / Game SFX). Guarded — silent if audio isn't up.

// ── Styles ──────────────────────────────────────────────────────────────────
function ensureStyles() {
  if (document.getElementById('hololock-styles')) return;
  const s = document.createElement('style');
  s.id = 'hololock-styles';
  s.textContent = `
    #hololock-overlay { --hl-accent:#6db3ff; --mg-accent:#6db3ff; position:fixed; inset:0; z-index:9200; display:flex; align-items:center; justify-content:center;
      background:rgba(0,3,8,0.78); backdrop-filter:blur(3px); font-family:'Courier New',monospace; }
    /* Moulded blue chassis — top-lit multi-stop body (matches the ATM #atm-box). */
    #hololock-overlay .hl-panel { width:min(560px,94vw); color:var(--hl-accent);
      background:linear-gradient(180deg, #1b2735 0%, #131d29 7%, #0c141d 12%, #060b12 100%);
      padding:14px 16px 16px; animation:hl-boot .3s ease-out; }
    @keyframes hl-boot { 0%{opacity:0;transform:scale(.985)} 100%{opacity:1;transform:scale(1)} }
    #hololock-overlay .hl-hud { display:flex; gap:16px; align-items:center; padding:8px 2px; font-size:12px; color:#7f93ad; letter-spacing:1px; flex-wrap:wrap; }
    #hololock-overlay .hl-hud b { color:var(--hl-accent); font-weight:bold; }
    #hololock-overlay .hl-fb-wrap { display:inline-flex; align-items:center; gap:6px; margin-left:auto; }
    #hololock-overlay .hl-fb-bar { display:inline-block; width:120px; height:8px; background:#0c1622; border:1px solid #2b3f5a; border-radius:3px; overflow:hidden; }
    #hololock-overlay .hl-fb-fill { display:block; height:100%; width:0%; background:#46e05a; transition:width .1s linear, background .2s; }
    /* The screen is the shared bulged-glass CRT (.mg-screen); give it the ATM's
       accent-tinted tube glow so the channels float on lit glass. */
    #hololock-overlay .hl-bezel { margin:4px 0 2px; }
    #hololock-overlay .hl-screen { background:radial-gradient(130% 130% at 50% 42%, color-mix(in srgb, var(--hl-accent) 11%, #030a12) 55%, #01040a 100%); }
    #hololock-overlay .hl-channels { position:relative; z-index:2; display:flex; flex-direction:column; gap:9px; padding:15px 13px; }
    #hololock-overlay .hl-ch { position:relative; height:28px; border:1px solid #223349; border-radius:4px; overflow:hidden; opacity:0.4; transition:opacity .15s, box-shadow .15s;
      background:linear-gradient(180deg,#12202f,#0a1420 55%,#060d16);
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -2px 5px rgba(0,0,0,0.6); }
    #hololock-overlay .hl-ch::before { content:''; position:absolute; left:6px; right:6px; top:50%; height:1px; transform:translateY(-0.5px);
      background:rgba(0,0,0,0.55); box-shadow:0 1px 0 rgba(255,255,255,0.04); }
    #hololock-overlay .hl-ch.hl-active { opacity:1; border-color:var(--hl-accent); cursor:pointer;
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.07), 0 0 16px color-mix(in srgb, var(--hl-accent) 34%, transparent); }
    #hololock-overlay .hl-ch.hl-set { opacity:1; border-color:#46e05a; background:linear-gradient(180deg,#0e2417,#0a1c12); }
    #hololock-overlay .hl-sweet { position:absolute; top:1px; bottom:1px; display:none;
      background:color-mix(in srgb, var(--hl-accent) 20%, transparent);
      border-left:1px solid var(--hl-accent); border-right:1px solid var(--hl-accent);
      box-shadow:inset 0 0 12px color-mix(in srgb, var(--hl-accent) 32%, transparent); }
    #hololock-overlay .hl-ch.hl-active .hl-sweet { display:block; }
    #hololock-overlay .hl-ch.hl-set .hl-sweet { display:block; background:rgba(70,224,90,0.16); border-color:#46e05a; box-shadow:inset 0 0 12px rgba(70,224,90,0.28); }
    #hololock-overlay .hl-scan { position:absolute; top:-2px; bottom:-2px; width:2px; display:none;
      background:linear-gradient(180deg, rgba(255,255,255,0.55), #fff 45%, rgba(255,255,255,0.55));
      box-shadow:0 0 6px #fff, 0 0 14px color-mix(in srgb, var(--hl-accent) 85%, #fff), 0 0 24px color-mix(in srgb, var(--hl-accent) 55%, transparent); }
    #hololock-overlay .hl-ch.hl-active .hl-scan { display:block; }
    #hololock-overlay .hl-ch.hl-set::after { content:'●'; position:absolute; right:7px; top:50%; transform:translateY(-50%); color:#46e05a; font-size:11px; text-shadow:0 0 6px rgba(70,224,90,0.7); }
    #hololock-overlay .hl-status { min-height:22px; padding:8px 2px 2px; font-size:13px; letter-spacing:1px; font-weight:bold; }
    #hololock-overlay .hl-status .hl-win { color:#46e05a; }
    #hololock-overlay .hl-status .hl-lose { color:#ff4a5b; }
    #hololock-overlay .hl-actions { display:flex; gap:8px; margin-top:8px; }
    #hololock-overlay .hl-btn { flex:1; padding:9px 6px; background:#0c1622; color:#8fa9c4; border:1px solid #2b3f5a;
      border-radius:2px; cursor:pointer; font-family:'Courier New',monospace; font-size:12px; font-weight:bold; letter-spacing:2px;
      text-transform:uppercase; box-shadow:inset 0 -2px 0 rgba(0,0,0,0.5); transition:all .12s; }
    #hololock-overlay .hl-btn:hover { transform:translateY(1px); color:var(--hl-accent); border-color:var(--hl-accent); }
    #hololock-overlay .hl-btn-abort:hover { color:#ff4a5b; border-color:#ff4a5b; }
  `;
  document.head.appendChild(s);
}

// ── Generation ──────────────────────────────────────────────────────────────
function generate(skill, difficulty) {
  const edge = skill - difficulty;
  const n = clampInt(3 + difficulty / 2.5, 3, 6);
  const sweet = clampNum(0.24 + edge * 0.03, 0.09, 0.42);       // sweet-zone width (fraction)
  // ⚠ Do NOT add a player-facing "slow the sweep" accessibility option here.
  // It was tried (2026-08-07) and reverted the same day.
  //
  // It wasn't needed in the first place: the `log` Display Mode rung never opens
  // this board at all — server/engine/minigame.js `resolveForLogRung` settles the
  // lock with one 2d8−2d8 skill check against the same difficulty, through the
  // same resolve verb. An untimed route already exists, for every minigame.
  //
  // And it was actively harmful:
  //
  //   • The minigame's result IS the outcome — doors.js: "That outcome is
  //     authoritative (winning the minigame is the gate)". It isn't theatre.
  //   • Dividing this speed multiplies the scanner's dwell time inside the sweet
  //     zone, which cuts MISSES. Misses cost `missPenalty` (0.08–0.40 each) and
  //     they are the dominant term; the longer run accrues more `trickle`
  //     (0.004–0.055/sec), but nowhere near enough to pay for the misses saved.
  //     So it is a straightforward difficulty reduction, not a timing
  //     accommodation, whatever a comment claims.
  //   • A free, self-selected difficulty slider on a competitive skill in a
  //     shared economy gets picked by everybody: winning here unlocks somebody
  //     else's apartment AND pays hacking XP (awardSkillUse on the breach).
  //
  // The rule it left behind: an accessibility option may move the INTERFACE
  // freely; it may not move the ODDS on a contested outcome. See
  // docs/systems-display-mode.md § Why there is no "slow it down" option.
  const baseSpd = clampNum(0.55 + difficulty * 0.10 - skill * 0.05, 0.40, 1.9); // sweeps/sec
  const missPenalty = clampNum(0.15 - edge * 0.02, 0.08, 0.40);
  const trickle = clampNum(0.015 + difficulty * 0.005 - skill * 0.003, 0.004, 0.055); // feedback/sec

  const pins = [];
  for (let i = 0; i < n; i++) {
    pins.push({
      center: sweet / 2 + Math.random() * (1 - sweet),   // sweet-zone centre
      width: sweet,
      speed: baseSpd * (0.85 + Math.random() * 0.4),     // per-channel jitter
      phase: Math.random() * 2,                          // 0..2 bounce phase
      dir: 1,
      set: false,
    });
  }
  return { pins, active: 0, feedback: 0, missPenalty, trickle, over: false, won: false };
}

// Triangle-bounce position 0..1 from a 0..2 phase.
function posOf(pin) { return pin.phase <= 1 ? pin.phase : 2 - pin.phase; }

// ── The SKIN seam ────────────────────────────────────────────────────────────
// Everything above is the LOCK — pin count, sweet-zone width, scanner speed, miss
// penalty and the ambient trickle, all scaled off skill-vs-difficulty. Everything
// below is one way of drawing it.
//
// A skin supplies { board, hud, status, frame, finish } and gets the same state.
// texthololock.js installs one and plays the identical lock in characters at the
// same frame rate — which is the point of the middle Display Mode rung: the
// scanner still sweeps and you still have to hit it. A text mode that turned this
// into a dice roll would be a different, easier game wearing the same name.
let _skin = null;
export function setHololockSkin(skin) { _skin = skin; }

// Drive the lock without mounting the overlay — for a skin that draws elsewhere.
// Shares generate() so the difficulty scaling cannot diverge.
export function startHololockGame(opts) {
  _opts = { skill: 4, difficulty: 5, deviceName: 'HOLOLOCK', onResult: null, ...opts };
  _state = generate(_opts.skill, _opts.difficulty);
  _lastT = performance.now();
  _raf = requestAnimationFrame(tick);
  return _state;
}
export function stopHololockGame() {
  if (_raf) cancelAnimationFrame(_raf);
  _raf = 0; _state = null;
}
// The one action, exposed so a skin's key/click handler is the same code path.
export { trySet as hololockSet, posOf as hololockPos };

// ── Render ──────────────────────────────────────────────────────────────────
function renderChannels() {
  if (_skin) return _skin.board(_state);
  const wrap = _overlay.querySelector('#hl-channels');
  wrap.innerHTML = '';
  _state.pins.forEach((pin, i) => {
    const ch = document.createElement('div');
    ch.className = 'hl-ch' + (pin.set ? ' hl-set' : (i === _state.active ? ' hl-active' : ''));
    const sweet = document.createElement('div');
    sweet.className = 'hl-sweet';
    sweet.style.left = `${(pin.center - pin.width / 2) * 100}%`;
    sweet.style.width = `${pin.width * 100}%`;
    const scan = document.createElement('div');
    scan.className = 'hl-scan';
    ch.appendChild(sweet); ch.appendChild(scan);
    if (i === _state.active && !pin.set) ch.addEventListener('click', trySet);
    wrap.appendChild(ch);
  });
}

function renderHud() {
  if (_skin) return _skin.hud(_state);
  const set = _state.pins.filter(p => p.set).length;
  _overlay.querySelector('#hl-pins').textContent = `${set}/${_state.pins.length}`;
  const fill = _overlay.querySelector('#hl-fb-fill');
  const pct = Math.round(_state.feedback * 100);
  fill.style.width = `${pct}%`;
  fill.style.background = pct > 75 ? '#ff4a5b' : pct > 45 ? '#ffb23e' : '#46e05a';
}

function setStatus(html) {
  if (_skin) return _skin.status(html);
  _overlay.querySelector('#hl-status').innerHTML = html;
}

// ── Loop ──────────────────────────────────────────────────────────────────
function tick(t) {
  if (!_state || _state.over) return;
  const dt = Math.min(0.05, (t - _lastT) / 1000 || 0);
  _lastT = t;

  // Advance every unset channel's scanner (they all sweep; only the active one
  // is shown/settable — the others keep moving so re-focus never lands static).
  for (const pin of _state.pins) {
    if (pin.set) continue;
    pin.phase += pin.speed * dt;
    while (pin.phase >= 2) pin.phase -= 2;
  }
  // Ambient tension — the lock's IDS slowly homes in even if you stall.
  _state.feedback = clampNum(_state.feedback + _state.trickle * dt, 0, 1);

  // Position the active scanner. A skin draws its whole frame instead — the
  // character board repaints the track every frame rather than nudging one
  // element, which is what `paintRow` exists to make affordable.
  if (_skin) {
    _skin.frame(_state);
  } else {
    const active = _state.pins[_state.active];
    if (active && !active.set) {
      const scan = _overlay.querySelectorAll('.hl-ch')[_state.active]?.querySelector('.hl-scan');
      if (scan) scan.style.left = `${posOf(active) * 100}%`;
    }
    renderHud();
    setDeckLevel(_overlay, _state.feedback);
  }

  if (_state.feedback >= 1) { finish(false); return; }
  _raf = requestAnimationFrame(tick);
}

// ── Actions ─────────────────────────────────────────────────────────────────
function trySet() {
  if (!_state || _state.over) return;
  const pin = _state.pins[_state.active];
  if (!pin || pin.set) return;
  const pos = posOf(pin);
  if (Math.abs(pos - pin.center) <= pin.width / 2) {
    pin.set = true;
    sfx('hololock-set');
    const next = _state.pins.findIndex(p => !p.set);
    if (next === -1) { renderChannels(); finish(true); return; }
    _state.active = next;
    renderChannels();
    setStatus('<span style="color:#7f93ad">Pin set. Next channel armed.</span>');
  } else {
    _state.feedback = clampNum(_state.feedback + _state.missPenalty, 0, 1);
    sfx('hololock-miss');
    setStatus('<span style="color:#ffb23e">Missed the window — feedback spikes.</span>');
    if (_state.feedback >= 1) finish(false);
  }
}

function finish(won) {
  if (_state.over) return;
  _state.over = true; _state.won = won;
  cancelAnimationFrame(_raf); _raf = 0;
  sfx(won ? 'hololock-win' : 'hololock-lose');
  setStatus(won
    ? '<span class="hl-win">◇ LOCK DISENGAGED — access granted.</span>'
    : '<span class="hl-lose">✕ SEQUENCE RESET — deck flagged.</span>');
  const cb = _opts?.onResult;
  // A skin owns its own teardown — the character board lives in the area pane,
  // not an overlay, so close() here would tear down the wrong thing.
  if (_skin) { _skin.finish?.(_state, won); if (cb) cb({ won }); return; }
  if (won) {
    setTimeout(() => { close(); cb && cb({ won: true }); }, 1100);
  } else {
    if (cb) cb({ won: false });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
export function openHololock(opts = {}) {
  ensureStyles();
  ensureChassisStyles();
  close();
  _opts = { skill: 4, difficulty: 5, deviceName: 'HOLOLOCK', onResult: null, ...opts };
  const html =
    `<div class="hl-panel mg-chassis">
      ${deviceHeader('&#9670;', 'HOLOLOCK BYPASS', 'TARGET &middot; ' + esc(_opts.deviceName).toUpperCase())}
      <div class="hl-hud">
        <span>PINS <b id="hl-pins">0/0</b></span>
        <span class="hl-fb-wrap">FEEDBACK <span class="hl-fb-bar"><span class="hl-fb-fill" id="hl-fb-fill"></span></span></span>
      </div>
      <div class="hl-bezel mg-bezel">${bezelScrews()}<div class="hl-screen mg-screen" style="--mg-sweep-h:250px"><div class="hl-channels" id="hl-channels"></div>${crtOverlays()}</div></div>
      ${deckStrip('LOCK BUS', 'FEEDBACK')}
      <div class="hl-status" id="hl-status"></div>
      <div class="hl-actions">
        <button class="hl-btn hl-btn-set">Set Pin &#9251;</button>
        <button class="hl-btn hl-btn-abort">Abort</button>
      </div>
    </div>`;
  const mounted = mountOverlay({
    id: 'hololock-overlay',
    html,
    onKey: (e) => { if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); trySet(); } },
    onClose: () => { if (_raf) { cancelAnimationFrame(_raf); _raf = 0; } _state = null; },
  });
  _overlay = mounted.overlay;
  _close = mounted.close;
  _overlay.querySelector('.mg-close').addEventListener('click', close);
  _overlay.querySelector('.hl-btn-abort').addEventListener('click', close);
  _overlay.querySelector('.hl-btn-set').addEventListener('click', trySet);
  window.AudioEngine?.init?.();
  sfx('hololock-entry');

  _state = generate(_opts.skill, _opts.difficulty);
  renderChannels();
  renderHud();
  setStatus('<span style="color:#7f93ad">SET each pin while the scanner is in the lit window. Beat the FEEDBACK meter.</span>');
  _lastT = performance.now();
  _raf = requestAnimationFrame(tick);
}

function close() {
  if (_close) { _close(); _close = null; }
  _overlay = null;
}
