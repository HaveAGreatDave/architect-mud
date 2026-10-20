// REEL — a two-stage fishing minigame. First you place the cast, then you fight
// whatever takes it.
//
// STAGE 1 — THE CAST: pick your water. A horizontal AIM tick sweeps left↔right
// across the surface — TAP (button / the tube / Space) to lock the angle, and
// keep HOLDING to charge a vertical POWER meter (SHALLOW↔DEEP). RELEASE to fire.
// Power sets how far out / how deep the line lands; angle sets which lane it
// drops into. Where you cast decides what's on the line: deep water hides the
// better catches, while angling off the straight line raises the odds of the
// off-line specials. The cast (power + angle) is reported to the server via
// opts.onCast; the server picks the catch from that and arms the fight (see
// dispatch.js's `fishing_fight` route → armFishFight). A shallow cast also buys
// a fuller CREEL head-start into the fight — deep water is high risk, high reward.
//
// STAGE 2 — THE REEL: a vertical GAFF slides up while you REEL (hold the button
// / the tube / Space) and sinks when you let go; the hooked catch darts up and
// down the water column on its own, a taut line shivering above it as the
// tension climbs. Keep the gaff overlapping the catch to fill the CREEL meter;
// lose the overlap and the LINE tension climbs and the creel bleeds back down.
// Fill the creel before the catch throws the hook (creel empties) → it's landed.
//
// A cosmetic overlay armed server-side by the fishing plugin on a bite (see
// plugins/fishing/index.js). The win/lose result is reported via opts.onResult;
// the caller fires the real server command (`fishresolve`), which is
// authoritative — it validates the anti-spoof token + posture + carried rod,
// then applies the catch, spawns a hooked monster, or snaps the rod. The board
// weighs the player's real Fishing skill against the catch's difficulty: the gap
// (edge = skill - difficulty) drives the gaff size, how wildly the catch fights,
// and how fast the creel fills — an outclassed angler faces a genuinely brutal
// fight. Difficulty also stokes the silhouette: the harder the catch, the bigger
// and darker the shape you're wrestling out of the black water.

import { sfx, clampInt, clampNum, esc, mountOverlay, ensureChassisStyles, deviceHeader, bezelScrews, crtOverlays, deckStrip, setDeckLevel } from './minigame-common.js';
import { loadCss } from '../../../shared/dom.js';

// fishing.css ships beside this file and is fetched when the module loads, so ensureStyles
// still applies it synchronously on first open. See loadCss in client/shared/dom.js.
const FISHING_CSS = await loadCss(new URL('./fishing.css', import.meta.url));

let _overlay = null;
let _close = null;
let _state = null;
let _opts = null;
let _raf = 0;
let _lastT = 0;
let _hold = false;
let _listeners = [];
let _timers = [];

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

// Deferred timers, all tracked so close() can flush them mid-sequence.
function schedule(fn, ms) { const t = setTimeout(fn, ms); _timers.push(t); return t; }
function clearTimers() { for (const t of _timers) clearTimeout(t); _timers = []; }

// ── Styles ──────────────────────────────────────────────────────────────────
function ensureStyles() {
  if (document.getElementById('fishing-styles')) return;
  const s = document.createElement('style');
  s.id = 'fishing-styles';
  s.textContent = FISHING_CSS;
  document.head.appendChild(s);
}

// A meaner, more detailed predator silhouette: forked tail (wiggles on its own),
// dorsal + anal fins, a gill slit, a lit eye, and a hint of jaw. Faces left,
// into the pull. currentColor is the dark body; the accent lights the eye.
const FISH_SVG = `<svg viewBox="0 0 44 22" xmlns="http://www.w3.org/2000/svg">` +
  `<g class="fs-tail"><path fill="currentColor" d="M38 11 L44 4 Q41 11 44 18 Z"/></g>` +
  `<path fill="currentColor" d="M2 11 Q9 4 20 5 Q32 6 39 11 Q32 16 20 17 Q9 18 2 11 Z"/>` +
  `<path fill="currentColor" d="M17 5 L24 -1 L27 6 Z"/>` +
  `<path fill="currentColor" d="M18 16 L23 21 L27 16 Z"/>` +
  `<path fill="currentColor" d="M2 11 L8 8 Q6 11 8 14 Z"/>` +
  `<path fill="none" stroke="color-mix(in srgb, var(--fs-accent) 40%, transparent)" stroke-width="1" d="M11 7 Q9 11 11 15"/>` +
  `<circle cx="7" cy="10.4" r="1.7" fill="var(--fs-accent)"/>` +
  `<circle cx="7" cy="10.4" r="0.7" fill="#02110b"/>` +
  `<path fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" d="M2.4 12.4 Q5 13.6 8 13"/>` +
  `</svg>`;

// A little chevron/arrowhead for the aim tick — points down into the water.
const AIM_SVG = `<svg viewBox="0 0 14 13" xmlns="http://www.w3.org/2000/svg">` +
  `<path fill="currentColor" d="M7 13 L1 3 Q7 6 13 3 Z"/>` +
  `<rect x="6.2" y="0" width="1.6" height="5" fill="currentColor"/></svg>`;

// A baited J-hook — the eye/shank up the middle, a curl to a barbed point, and a
// speck of bait on the barb (hidden once it's set in a catch). Faces the shank up.
const HOOK_SVG = `<svg viewBox="0 0 12 18" xmlns="http://www.w3.org/2000/svg">` +
  `<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M6 0 V9 A3.4 3.4 0 1 1 2.6 9.4"/>` +
  `<path fill="currentColor" d="M2.6 9.4 L1.1 7.2 L4.4 7.6 Z"/>` +
  `<circle class="fs-bait" cx="2.7" cy="10.2" r="2"/></svg>`;

// ── Generation ──────────────────────────────────────────────────────────────
// The cast stage is generated up front from a nominal difficulty (the server
// doesn't know which catch it is yet — the cast decides). The fight stage is
// generated later, in armFishFight(), once the server has picked the catch and
// sent its real difficulty.
function generateCast(skill, castDifficulty) {
  return {
    phase: 'aim',   // 'aim' → 'charging' → 'await' (server) → 'fight' (reel physics)
    // ── Aim: a tick sweeps left↔right across the surface; lock to pick a lane. ──
    aim: 0.5, aimDir: 1,
    aimSpeed: clampNum(0.72 + castDifficulty * 0.03, 0.72, 1.3), // twitchier aim for a livelier spot
    angle: 0.5,
    // ── Power: charges 0 (shallow) .. 1 (deep) while held, ping-ponging so you
    //    can settle on a depth rather than just mash to the top. ──
    power: 0, powerDir: 1,
    powerSpeed: clampNum(0.62 + castDifficulty * 0.03, 0.62, 1.15),
    castPower: 0,
    // Fight params get merged in later; nothing fight-related is live yet.
    fightReady: false, castAnimDone: false, fightParams: null,
    menace: 1, creel: 0, tension: 0, over: false, won: false,
    gaff: 0.5, gaffVel: 0, gaffH: 0.25, fish: 0.5, fishTarget: 0.5, fishTimer: 0,
  };
}

// The fight board: skill vs. the real catch difficulty. A shallow cast (low
// power) buys a fuller creel head-start — deep water is riskier to work in.
function generateFight(skill, difficulty, castPower) {
  const edge = skill - difficulty;
  return {
    gaff: 0.5, gaffVel: 0,
    gaffH: clampNum(0.22 + edge * 0.02, 0.11, 0.40),   // gaff band height (fraction) — skill widens it
    fish: 0.5, fishTarget: 0.5, fishTimer: 0,
    fishSpeed: clampNum(0.4 + difficulty * 0.055 - skill * 0.02, 0.22, 1.5), // how fast it chases its target
    dartChance: clampNum(0.4 + difficulty * 0.06 - skill * 0.03, 0.2, 1.6),  // darts/sec toward an extreme
    fillRate: clampNum(0.44 + edge * 0.03, 0.26, 0.85), // creel gain/sec while bracketed
    drainRate: clampNum(0.30 - edge * 0.02, 0.14, 0.6), // creel loss/sec while not
    menace: clampNum(0.82 + difficulty * 0.05, 0.82, 1.5), // silhouette scale — bigger = scarier catch
    creel: clampNum(0.45 - castPower * 0.20, 0.22, 0.5),   // shallow casts start fuller
    tension: 0,
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

// Sweep the aim tick left↔right; ping-pong the power meter while charging.
function stepCast(s, dt) {
  if (s.phase === 'aim') {
    s.aim += s.aimDir * s.aimSpeed * dt;
    if (s.aim >= 1) { s.aim = 1; s.aimDir = -1; }
    if (s.aim <= 0) { s.aim = 0; s.aimDir = 1; }
  } else if (s.phase === 'charging') {
    s.power += s.powerDir * s.powerSpeed * dt;
    if (s.power >= 1) { s.power = 1; s.powerDir = -1; }
    if (s.power <= 0) { s.power = 0; s.powerDir = 1; }
  }
}

// ── Render ──────────────────────────────────────────────────────────────────
// ── The SKIN seam ────────────────────────────────────────────────────────────
// Everything above is the GAME — the sweeping aim, the charging power, the
// darting fish, the gaff physics, the creel/tension race, all scaled off
// skill-vs-difficulty. Everything below is one way of drawing it.
//
// textfishing.js installs a skin and fishes the identical water in characters:
// the same rAF loop, the same LIFT/GRAVITY/DAMP on the gaff, the same dart
// chance. It stays a reflex game, which is the point of the middle rung.
let _skin = null;
export function setFishingSkin(skin) { _skin = skin; }

// The two inputs are ONE input at both stages — press and release — so a skin
// wires one control and the stage decides what it means.
export { primaryDown as fishingDown, primaryUp as fishingUp };

function render() {
  if (_skin) return _skin.frame(_state);
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
  fish.classList.toggle('fs-hooked', bracketed);

  // The taut line trails the catch and shivers as tension bites.
  const line = _overlay.querySelector('#fs-line');
  if (line) { line.style.height = `${_state.fish * h}px`; line.classList.toggle('fs-strain', _state.tension > 0.5); }

  // The hook is set in the catch — it rides the fish up and down the column.
  const hook = _overlay.querySelector('#fs-hook');
  if (hook) hook.style.top = `${_state.fish * h - 6}px`;

  const creel = _overlay.querySelector('#fs-creel-fill');
  const pct = Math.round(_state.creel * 100);
  creel.style.width = `${pct}%`;
  creel.style.background = pct > 66 ? '#46e05a' : pct > 33 ? '#ffb23e' : '#ff4a5b';

  const tfill = _overlay.querySelector('#fs-tension-fill');
  if (tfill) tfill.style.height = `${Math.round(_state.tension * 100)}%`;
}

// Position the sweeping aim tick, its lane guide, and the charging power fill.
function renderCast() {
  if (_skin) return _skin.frame(_state);
  const col = _overlay.querySelector('#fs-column');
  const w = col ? col.clientWidth : 74;
  const x = (_state.phase === 'charging' ? _state.angle : _state.aim) * w;
  const aim = _overlay.querySelector('#fs-aim');
  if (aim) aim.style.left = `${x}px`;
  const lane = _overlay.querySelector('#fs-lane');
  if (lane) lane.style.left = `${x}px`;
  const fill = _overlay.querySelector('#fs-castfill');
  if (fill) {
    const p = _state.phase === 'charging' ? _state.power : _state.castPower;
    fill.style.height = `${Math.round(p * 100)}%`;
    // Cool as it deepens: warm amber at the shallows → brine-green → cold blue deep.
    fill.style.background = p > 0.66 ? 'linear-gradient(180deg,#3ec6ff,#46e05a)'
      : p > 0.33 ? 'linear-gradient(180deg,#46e05a,#8fe0a0)'
      : 'linear-gradient(180deg,#ffb23e,#ffd07a)';
  }
}

// Depth reading in fathoms-ish feet — pure flavour, tracks the power meter.
function depthFt(power) { return Math.round(power * 60); }

// The phase stepper + live readout in the HUD. `label` overrides the readout.
function renderHud(label) {
  if (_skin) return;   // the character board draws board and HUD in one pass
  if (!_overlay) return;
  const active = _state?.phase === 'fight' ? 'reel'
    : _state?.phase === 'charging' ? 'charge'
    : _state?.phase === 'aim' ? 'aim'
    : _state?.phase === 'await' ? 'reel' : 'aim';
  const order = ['aim', 'charge', 'reel'];
  const ai = order.indexOf(active);
  _overlay.querySelectorAll('.fs-ph').forEach(el => {
    const i = order.indexOf(el.dataset.ph);
    el.classList.toggle('on', i === ai);
    el.classList.toggle('done', i < ai);
  });
  const read = _overlay.querySelector('#fs-read');
  if (read && label != null) read.innerHTML = label;
}

function setStatus(html) {
  if (_skin) return _skin.status(html);
  const el = _overlay.querySelector('#fs-status'); if (el) el.innerHTML = html;
}

// ── Stage 1: aim + charge the cast ─────────────────────────────────────────────
function startCast() {
  const meter = _overlay.querySelector('#fs-castmeter');
  if (meter) meter.classList.add('fs-live');
  const aim = _overlay.querySelector('#fs-aim');
  if (aim) aim.classList.add('fs-live');
  const ruler = _overlay.querySelector('#fs-ruler');
  if (ruler) ruler.classList.add('fs-live');
  const lane = _overlay.querySelector('#fs-lane');
  if (lane) lane.classList.add('fs-live');
  _overlay.querySelectorAll('.fs-castcap').forEach(c => c.classList.add('fs-live'));
  const btn = _overlay.querySelector('.fs-btn-reel');
  if (btn) { btn.textContent = 'Aim'; btn.classList.add('fs-cast'); btn.removeAttribute('disabled'); }
  renderCast();
  renderHud('PICK YOUR LANE');
  setStatus('<span style="color:#7fae99">TAP to lock your aim, then HOLD to charge, deep water hides the better catches.</span>');
  fsfx('fishing-reel', 'hololock-entry');   // a single reel click — the tackle's ready
  // Safety net: auto-cast with a middling cast if the player never engages.
  schedule(() => { if (_state && _state.phase === 'aim') { beginCharge(); } }, 6000);
  schedule(() => { if (_state && _state.phase === 'charging') fireCast(); }, 7200);
  _lastT = performance.now();
  _raf = requestAnimationFrame(castTick);
}

function castTick(t) {
  if (!_state || (_state.phase !== 'aim' && _state.phase !== 'charging')) return;
  const dt = Math.min(0.05, (t - _lastT) / 1000 || 0);
  _lastT = t;
  stepCast(_state, dt);
  renderCast();
  if (_state.phase === 'charging') renderHud(`DEPTH <b>${depthFt(_state.power)} ft</b>`);
  _raf = requestAnimationFrame(castTick);
}

// TAP locks the aim (angle) and hands straight over to charging power.
function beginCharge() {
  if (!_state || _state.phase !== 'aim') return;
  _state.angle = _state.aim;
  _state.phase = 'charging';
  _state.power = 0; _state.powerDir = 1;
  const aim = _overlay.querySelector('#fs-aim');
  if (aim) aim.classList.add('fs-lock');
  const lane = _overlay.querySelector('#fs-lane');
  if (lane) lane.classList.add('fs-lock');
  const meter = _overlay.querySelector('#fs-castmeter');
  if (meter) meter.classList.add('fs-charging');
  const btn = _overlay.querySelector('.fs-btn-reel');
  if (btn) btn.textContent = 'Charge…';
  fsfx('fishing-charge', 'hololock-tick');   // reel ratchet winding up
  renderHud('DEPTH <b>0 ft</b>');
  setStatus('<span style="color:#7fae99">RELEASE to cast: the higher you charge, the deeper it lands.</span>');
}

// RELEASE fires the cast: capture power (depth) + angle, report to the server,
// and run the pay-out animation while the server picks the catch.
function fireCast() {
  if (!_state || _state.phase !== 'charging') return;
  _state.castPower = _state.power;
  _state.phase = 'await';
  cancelAnimationFrame(_raf); _raf = 0;
  _hold = false;

  const btn = _overlay.querySelector('.fs-btn-reel');
  if (btn) { btn.classList.remove('fs-cast'); btn.setAttribute('disabled', ''); }
  const meter = _overlay.querySelector('#fs-castmeter');
  if (meter) meter.classList.remove('fs-charging');

  const depth = _state.castPower > 0.66 ? 'deep' : _state.castPower > 0.33 ? 'a fair way out' : 'short';
  renderHud(`CAST <b>${depthFt(_state.castPower)} ft</b>`);
  setStatus(`<span style="color:#8fe0a0">Line away: ${depth}.</span>`);
  fsfx('fishing-cast', 'hololock-tick');   // the whip of the line paying out

  // Report the cast; the server chooses the catch and arms the fight.
  if (_opts?.onCast) _opts.onCast({ power: _state.castPower, angle: _state.angle });

  // Fade the cast furniture, then fly the bobber out to the chosen spot.
  schedule(() => {
    if (meter) { meter.classList.remove('fs-live'); meter.classList.add('fs-done'); }
    _overlay.querySelectorAll('.fs-castcap').forEach(c => c.classList.remove('fs-live'));
    ['#fs-aim', '#fs-ruler', '#fs-lane'].forEach(sel => _overlay.querySelector(sel)?.classList.remove('fs-live', 'fs-lock'));
  }, 220);
  schedule(() => runCastSplash(tryStartFight), 380);

  // Client-side backstop: if the server never arms the fight (it timed the bite
  // out), don't leave the overlay hanging.
  schedule(() => { if (_state && _state.phase === 'await') close(); }, 8000);
}

// The bobber pays out to the cast's lane (angle) and depth (power), settles,
// then is yanked under — the bite lands. onDone hands to the fight.
function runCastSplash(onDone) {
  const line = _overlay.querySelector('#fs-castline');
  const bobber = _overlay.querySelector('#fs-bobber');
  const ripple = _overlay.querySelector('#fs-ripple');
  const banner = _overlay.querySelector('#fs-onbanner');
  const col = _overlay.querySelector('#fs-column');
  const w = col ? col.clientWidth : 74;
  const h = col ? col.clientHeight : 250;
  // Angle → horizontal offset; power → how deep the float rides.
  const dx = Math.round((_state.angle - 0.5) * w * 0.72);
  const restY = Math.round(h * (0.30 + _state.castPower * 0.42));

  const hook = _overlay.querySelector('#fs-hook');
  if (bobber) { bobber.style.opacity = '1'; }
  void (bobber && bobber.offsetHeight);
  if (line) { line.style.height = `${restY + 6}px`; line.style.transform = `translateX(${dx}px)`; }   // dead vertical so the hook lands on the line's tip
  if (bobber) { bobber.style.top = `${restY}px`; bobber.style.transform = `translateX(${dx}px)`; }
  // The baited hook hangs on the leader just below the float.
  if (hook) { hook.style.opacity = '1'; hook.style.transform = `translateX(${dx}px)`; hook.style.top = `${restY + 14}px`; }

  schedule(() => {
    fsfx('fishing-splash', 'hololock-tick');
    if (ripple) { ripple.style.top = `${restY + 4}px`; ripple.style.transform = `translateX(${dx}px) scale(.4)`; ripple.classList.remove('fs-go'); void ripple.offsetHeight; ripple.classList.add('fs-go'); }
    if (bobber) bobber.classList.add('fs-bob');
    setStatus('<span style="color:#7fae99">The float settles on the black water&hellip;</span>');
  }, 520);

  schedule(() => {
    const sinkY = Math.round(h * Math.min(0.82, 0.42 + _state.castPower * 0.42));
    if (bobber) { bobber.classList.remove('fs-bob'); bobber.style.top = `${sinkY}px`; }
    if (hook) hook.style.top = `${sinkY + 14}px`;   // the take drags the hook under with the float
    if (line) line.style.height = `${sinkY}px`;
    if (ripple) { ripple.classList.remove('fs-go'); void ripple.offsetHeight; ripple.classList.add('fs-go'); }
    if (banner) { banner.textContent = 'FISH ON!'; banner.classList.add('fs-go'); }
    fsfx('fishing-bite', 'hololock-win');
  }, 1180);

  schedule(() => {
    if (line) line.style.opacity = '0';
    if (bobber) bobber.style.opacity = '0';
    onDone();
  }, 1680);
}

// ── Cast → fight handoff ────────────────────────────────────────────────────────
// The pay-out animation and the server's fight-arm race each other. Whichever
// lands second kicks off the fight.
function tryStartFight() {
  if (!_state || _state.over) return;
  _state.castAnimDone = true;
  if (_state.fightReady) startFight();
  else setStatus('<span style="color:#7fae99">Setting the hook&hellip;</span>');
}

// Called from dispatch.js when the server's `fishing_fight` message arrives with
// the chosen catch's real difficulty. Builds the fight board and, if the cast
// animation has already finished, starts the fight.
export function armFishFight({ skill = 4, difficulty = 5 } = {}) {
  if (!_state || _state.over) return;
  _state.fightParams = generateFight(skill, difficulty, _state.castPower || 0);
  _state.fightReady = true;
  const fishEl = _overlay?.querySelector('#fs-fish');
  if (fishEl) fishEl.style.setProperty('--fs-menace', String(_state.fightParams.menace));
  if (_state.castAnimDone) startFight();
}

// ── Stage 2: the reel ─────────────────────────────────────────────────────────
function tick(t) {
  if (!_state || _state.over || _state.phase !== 'fight') return;
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

function startFight() {
  if (!_state || _state.over || _state.phase === 'fight') return;
  Object.assign(_state, _state.fightParams);
  _state.phase = 'fight';
  const gaff = _overlay.querySelector('#fs-gaff');
  const fish = _overlay.querySelector('#fs-fish');
  const line = _overlay.querySelector('#fs-line');
  if (gaff) gaff.style.opacity = '1';
  if (fish) { fish.style.opacity = '1'; fish.style.setProperty('--fs-menace', String(_state.menace)); }
  if (line) line.style.opacity = '1';
  // The hook is now set in the catch: eat the bait, drop the drop-lag, ride the fish.
  const hook = _overlay.querySelector('#fs-hook');
  if (hook) { hook.classList.add('fs-set'); hook.style.transform = 'none'; hook.style.opacity = '1'; }
  const reelBtn = _overlay.querySelector('.fs-btn-reel');
  if (reelBtn) { reelBtn.textContent = 'Reel In ␣'; reelBtn.removeAttribute('disabled'); }
  render();
  renderHud('ON THE LINE');
  setStatus('<span style="color:#7fae99">HOLD to reel the gaff up over the catch. Bracket it to fill the CREEL, mind the TENSION.</span>');
  _lastT = performance.now();
  _raf = requestAnimationFrame(tick);
}

function finish(won) {
  if (_state.over) return;
  _state.over = true; _state.won = won;
  cancelAnimationFrame(_raf); _raf = 0;
  fsfx(won ? 'fishing-land' : 'fishing-snap', won ? 'hololock-win' : 'hololock-lose');
  setStatus(won
    ? '<span class="fs-win">◇ LANDED: it\'s yours.</span>'
    : '<span class="fs-lose">✕ LINE SNAPPED: it threw the hook.</span>');
  const cb = _opts?.onResult;
  // A skin owns its own teardown — the character board lives in the area pane,
  // not an overlay, so close() here would tear down the wrong thing.
  if (_skin) { _skin.finish?.(_state, won); if (cb) cb({ won }); return; }
  schedule(() => { close(); if (cb) cb({ won }); }, 1100);
}

// ── Input wiring ───────────────────────────────────────────────────────────────
// One primary input drives every stage: during aim it locks the angle and starts
// charging; releasing fires the cast; during the fight it reels the gaff up.
function primaryDown() {
  if (!_state) return;
  if (_state.phase === 'aim') { beginCharge(); return; }
  if (_state.phase === 'fight') { setHold(true); return; }
}
function primaryUp() {
  if (!_state) return;
  if (_state.phase === 'charging') { fireCast(); return; }
  if (_state.phase === 'fight') { setHold(false); return; }
}
function setHold(on) {
  if (on && (!_state || _state.phase !== 'fight')) return;
  if (on && !_hold) fsfx('fishing-reel', 'hololock-tick');   // ratchet bites as you start winding
  _hold = on;
  const btn = _overlay?.querySelector('.fs-btn-reel');
  if (btn) btn.classList.toggle('fs-down', on);
}
function addListener(target, type, fn, opts) { target.addEventListener(type, fn, opts); _listeners.push([target, type, fn, opts]); }
function clearListeners() { for (const [t, ty, fn, o] of _listeners) t.removeEventListener(ty, fn, o); _listeners = []; }

// ── Public API ────────────────────────────────────────────────────────────────

// Drive the whole two-stage game with no overlay mounted, for a skin that draws
// elsewhere. Shares generateCast so the difficulty scaling cannot diverge.
export function startFishingGame(opts) {
  _opts = { skill: 4, difficulty: 5, deviceName: 'THE LINE', onResult: null, onCast: null, ...opts };
  _state = generateCast(_opts.skill, _opts.difficulty);
  _lastT = performance.now();
  startCast();
  return _state;
}
export function stopFishingGame() {
  if (_raf) cancelAnimationFrame(_raf);
  _raf = 0; clearTimers(); _hold = false; _state = null;
}
export function openFishing(opts = {}) {
  ensureStyles();
  ensureChassisStyles();
  close();
  _opts = { skill: 4, difficulty: 5, deviceName: 'THE LINE', onResult: null, onCast: null, ...opts };
  const bubbles = [
    '<span class="fs-bubble" style="left:18%;animation-delay:0s"></span>',
    '<span class="fs-bubble" style="left:34%;animation-delay:2.1s"></span>',
    '<span class="fs-bubble" style="left:58%;animation-delay:1.5s"></span>',
    '<span class="fs-bubble" style="left:44%;animation-delay:3.4s"></span>',
    '<span class="fs-bubble" style="left:72%;animation-delay:2.8s"></span>',
    '<span class="fs-bubble" style="left:84%;animation-delay:4.1s"></span>',
  ].join('');
  // Marine snow — slow motes drifting down the shaft, deterministic (no RNG so
  // the layout is stable across opens); durations/positions hand-scattered.
  const snowSpecs = [[12, 9, 0], [28, 12, 3.5], [46, 8, 1.8], [63, 13, 5.2], [79, 10, 2.6], [90, 11, 4.4], [21, 14, 6.1], [55, 9, 7.3]];
  const snow = snowSpecs.map(([l, d, delay]) =>
    `<span class="fs-snow" style="left:${l}%;animation-duration:${d}s;animation-delay:${delay}s"></span>`).join('');
  // Fathom depth scale — surface (0) at the top, the deep at the bottom. Pure
  // numbers; the shaft's own zone captions name the strata where they sit.
  const scale =
    `<div class="fs-scale">
      <div class="fs-scale-mark">0 ft</div>
      <div class="fs-scale-zone"></div>
      <div class="fs-scale-mark">20</div>
      <div class="fs-scale-zone"></div>
      <div class="fs-scale-mark">40</div>
      <div class="fs-scale-zone"></div>
      <div class="fs-scale-mark">60 ft</div>
    </div>`;
  const html =
    `<div class="fs-panel mg-chassis">
      ${deviceHeader('&#127907;', 'REEL', 'ON THE LINE &middot; ' + esc(_opts.deviceName).toUpperCase())}
      <div class="fs-hud">
        <span class="fs-phases">
          <span class="fs-ph" data-ph="aim">AIM</span><span class="fs-ph-sep">&#8250;</span>
          <span class="fs-ph" data-ph="charge">CHARGE</span><span class="fs-ph-sep">&#8250;</span>
          <span class="fs-ph" data-ph="reel">REEL</span>
        </span>
        <span class="fs-read" id="fs-read">READY</span>
        <span class="fs-creel-wrap">CREEL <span class="fs-creel-bar"><span class="fs-creel-fill" id="fs-creel-fill"></span></span></span>
      </div>
      <div class="fs-bezel mg-bezel">${bezelScrews()}<div class="fs-screen mg-screen" style="--mg-sweep-h:440px">
        <div class="fs-rig">
          ${scale}
          <div class="fs-column" id="fs-column">
            <div class="fs-surface"></div>
            <div class="fs-ruler" id="fs-ruler"></div>
            <div class="fs-lane" id="fs-lane"></div>
            ${snow}
            ${bubbles}
            <span class="fs-zonecap fs-zonecap-1">SHALLOWS</span>
            <span class="fs-zonecap fs-zonecap-2">THE MURK</span>
            <span class="fs-zonecap fs-zonecap-3">THE DEEP</span>
            <div class="fs-castcap fs-castcap-top">DEEP</div>
            <div class="fs-castcap fs-castcap-bot">SHALLOW</div>
            <div class="fs-aim" id="fs-aim">${AIM_SVG}</div>
            <div class="fs-castmeter" id="fs-castmeter"><div class="fs-castfill" id="fs-castfill"></div></div>
            <div class="fs-line" id="fs-line"></div>
            <div class="fs-hook" id="fs-hook">${HOOK_SVG}</div>
            <div class="fs-castline" id="fs-castline"></div>
            <div class="fs-gaff" id="fs-gaff"></div>
            <div class="fs-fish" id="fs-fish">${FISH_SVG}</div>
            <div class="fs-ripple" id="fs-ripple"></div>
            <div class="fs-bobber" id="fs-bobber"></div>
            <div class="fs-onbanner" id="fs-onbanner"></div>
          </div>
          <div class="fs-tension"><div class="fs-tension-fill" id="fs-tension-fill"></div><span class="fs-tension-label">TENSION</span></div>
        </div>
        ${crtOverlays()}
      </div></div>
      ${deckStrip('DRAG BUS', 'TENSION')}
      <div class="fs-status" id="fs-status"></div>
      <div class="fs-actions">
        <button class="fs-btn fs-btn-reel">Aim</button>
        <button class="fs-btn fs-btn-abort">Cut Line</button>
      </div>
    </div>`;
  const mounted = mountOverlay({
    id: 'fishing-overlay',
    html,
    closeOnBackdrop: false,   // don't let a stray click abandon an active cast/fight
    onClose: () => { if (_raf) { cancelAnimationFrame(_raf); _raf = 0; } clearTimers(); clearListeners(); _hold = false; _state = null; },
  });
  _overlay = mounted.overlay;
  _close = mounted.close;
  _overlay.querySelector('.mg-close').addEventListener('click', close);
  _overlay.querySelector('.fs-btn-abort').addEventListener('click', close);

  // Primary input: the button, the water column, and Space. Press locks the aim
  // and charges; release fires the cast; in the fight, hold reels the gaff up.
  const reelBtn = _overlay.querySelector('.fs-btn-reel');
  const column = _overlay.querySelector('#fs-column');
  const down = (e) => { e.preventDefault(); primaryDown(); };
  const up = () => primaryUp();
  addListener(reelBtn, 'pointerdown', down);
  addListener(column, 'pointerdown', down);
  addListener(window, 'pointerup', up);
  addListener(window, 'pointercancel', up);
  addListener(window, 'keydown', (e) => { if ((e.key === ' ' || e.key === 'Spacebar') && !e.repeat) { e.preventDefault(); primaryDown(); } });
  addListener(window, 'keyup', (e) => { if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); primaryUp(); } });

  window.AudioEngine?.init?.();

  _state = generateCast(_opts.skill, _opts.difficulty);
  render();
  startCast();
}

function close() {
  if (_close) { _close(); _close = null; }
  _overlay = null;
}
