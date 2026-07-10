// COCKPIT — the flight instrument panel + the flight minigame decks.
//
// This is the showpiece surface of the game. While you're aboard, the top area
// pane becomes a live, animated glass cockpit: a brushed-metal-and-glass panel
// carrying an artificial horizon, an expanded heading-up RADAR, per-engine
// temperature gauges (run these up before you roll), a compass that spins to your
// heading, the real minimap, and digital dials — all eased every frame by a local
// requestAnimationFrame loop, not just snapped on each server tick. Engine drone,
// slipstream, and airframe creaks come from engine-audio.js.
//
// Decks (focused overlays, server-authoritative): openTakeoff / openGlideslope /
// openTargeting report { won } → the server resolve command decides the outcome.

import { setAreaPane } from '../render.js';
import { sfx, clampInt, clampNum, esc, mountOverlay, ensureChassisStyles, deviceHeader, bezelScrews, crtOverlays, deckStrip, setDeckLevel } from './minigame-common.js';
import { updateEngineAudio, stopEngineAudio, creak, spoolUp, spoolDown, groundFx, flapWhir, stallHorn, gearFx, gunFx, aaWarn, tracerFx, hitFx } from './engine-audio.js';
import { ensureWindshieldStyles, windshieldHTML, paintWindshield, disposeWindshield, RENDER_TUNE, buildingHeightZ, climbOutClear, VISIBLE_NEAR_F, VISIBLE_FAR_F, CLIMBOUT_MAX_F, CLIMBOUT_LAT_IN, CLIMBOUT_LAT_OUT } from './windshield.js';
import { suppressWeatherFx } from './weather-fx.js';
import { createState, step, readout, TYPES } from './flight-model.js';
import { applyFlightDrugFx, clearFlightDrugFx } from './flight-drugfx.js';
import { sendCmdSilent } from '../net.js';
import { hex2rgb } from './aircraft3d.js';

// Theme accent for the canvas-drawn instruments (the CSS chrome uses var(--accent)
// directly; canvas can't, so we sample it once when the cockpit opens).
let ACCENT = '#8fd0ff', ACCENT_RGB = [143, 208, 255];
function refreshAccent() {
  try {
    const c = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    if (c) { ACCENT = c; const m = c.match(/^#?([0-9a-fA-F]{6})$/); if (m) { const n = parseInt(m[1], 16); ACCENT_RGB = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; } }
  } catch {}
}
const accA = (a) => `rgba(${ACCENT_RGB[0]},${ACCENT_RGB[1]},${ACCENT_RGB[2]},${a})`;

function csfx(id, fallback) {
  const cat = window.SFXCatalog;
  if (cat && typeof cat.get === 'function' && cat.get(id)) sfx(id);
  else if (fallback) sfx(fallback);
}

const HDG_GLYPH = { n: '▲', ne: '◥', e: '▶', se: '◢', s: '▼', sw: '◣', w: '◀', nw: '◤' };
// Shortest signed angular delta a→b (deg), range −180..180.
function angDelta(a, b) { let d = (b - a) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; }

// Per-class cockpit theme — accent colour + chrome character. The LAYOUT itself
// is driven by capabilities (engines/hardpoints/cargo/VTOL/size); the theme sets
// the palette + a few flourishes so a gunship panel reads military-red while a
// heavy freighter reads industrial-amber and a wreck reads degraded.
const CLASS_THEME = {
  ultralight: { acc: '#7fd6ff', chrome: 'minimal',   radar: 'sm' },
  heli:       { acc: '#4fe0a0', chrome: 'rotor',      radar: 'md' },
  prop:       { acc: '#4fb8e0', chrome: 'analog',     radar: 'md' },
  heavy:      { acc: '#ffb23e', chrome: 'industrial', radar: 'lg' },
  gunship:    { acc: '#ff6b5b', chrome: 'military',    radar: 'lg' },
  wreck:      { acc: '#9bd06a', chrome: 'degraded',    radar: 'sm' },
};
const themeFor = (cls) => CLASS_THEME[cls] || CLASS_THEME.prop;

// The cockpit's accent colour — normally just the class theme above — becomes a
// blend of the craft's own paint-bay livery when one's on file: primary (base),
// secondary (trim), and the cabin/upholstery colour, so a paint job actually reads
// inside the cockpit chrome instead of only on the hangar model. Falls back to the
// class theme accent if no livery is present.
function liveryAccent(livery, fallbackHex) {
  const b = livery && hex2rgb(livery.base), t = livery && hex2rgb(livery.trim), c = livery && hex2rgb(livery.cabin);
  if (!b && !t && !c) return fallbackHex;
  const mix = (i, w) => (b ? b[i] * w.b : 0) + (t ? t[i] * w.t : 0) + (c ? c[i] * w.c : 0);
  const w = { b: b ? 0.5 : 0, t: t ? 0.3 : 0, c: c ? 0.2 : 0 };
  const wsum = w.b + w.t + w.c || 1;
  const rgb = [0, 1, 2].map(i => Math.round(mix(i, w) / wsum));
  return '#' + rgb.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. THE GLASS COCKPIT (area-pane HUD)
// ══════════════════════════════════════════════════════════════════════════════

let _target = null;     // latest server state
let _prev = null;       // previous state (event detection)
let _anim = null;       // eased animation values
let _raf = 0;
let _sig = '';          // mounted layout signature (rebuild when capabilities change)
let _lastT = 0;
// Server-tick aircraft (charter autopilot, ordinary piloted flight) push a new
// world position every couple of seconds rather than streaming it — without help
// the world would visibly jump on every push. `_moveFrom` interpolates the
// displayed position across the gap between the last two pushes (estimating the
// gap's length from how far apart they actually landed) so it reads as continuous
// travel, the same way heading/pitch/bank are already eased below.
let _moveFrom = null;   // { fx, fy, t, dur, toFx, toFy }
let _lastPushT = 0;
// The ground scene (airport/runway) and the airborne Mode-7 world are two entirely
// different renderers; the server only tells us which one applies via a boolean
// (`airborne`) that flips the instant the wheels leave/touch the strip. Cutting
// straight to that boolean reads as a jump-cut mid-takeoff/landing. Instead we
// ease a continuous "height" and only swap scenes once it's climbed clear of the
// ground (or sunk back down to it) — so the swap lands during the climb-out/flare,
// not the instant of liftoff/touchdown. `_lastGround`/`_lastMap`/`_lastBiome` cache
// the last real values so the lingering scene has something to draw with during
// the brief window where the server's payload has already moved on.
let _lastGround = null, _lastMap = null, _lastBiome = null;

// Passenger cabin choreography (bank/pitch/height ramp on climb-out and descent).
// Vertical-motion tuning: CLIMB_SEC governs how long the climb/descent portion of
// that choreography runs — bumped a couple of times per later requests to let the
// nose-up/nose-down segment breathe instead of rushing past in a few seconds.
const GROUND_LEAD = 3.5, CLIMB_SEC = 9, BANK_ANGLE = 25, CLIMB_PITCH = 6, CRUISE_HEIGHT = 0.35;

// Passenger cabin look direction — Q/E hold-to-look forward (into the cockpit, past
// the charter pilot at the yoke) / rear, mirroring the pilot's own Q/E/S scheme.
// Release either key and the view drops back to the default side window.
let _paxView = 'side';       // 'side' | 'forward' | 'rear'
let _paxKeyHandlers = null;  // [onKeyDown, onKeyUp] once bound, so we can unbind cleanly

function updatePaxViewTag() {
  const tag = document.getElementById('ck-pax-viewtag'); if (!tag) return;
  const cockpit = document.getElementById('ck-pax-cockpit');
  if (cockpit) cockpit.classList.toggle('show', _paxView === 'forward');
  const LABEL = { forward: '▲ COCKPIT VIEW', rear: '▼ REAR VIEW' };
  tag.textContent = LABEL[_paxView] || '';
  tag.classList.toggle('show', _paxView !== 'side');
}
function bindPaxKeys() {
  if (_paxKeyHandlers) return;
  const onKeyDown = (e) => {
    const tg = (e.target && e.target.tagName) || '';
    if (tg === 'INPUT' || tg === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
    const k = (e.key || '').toLowerCase();
    if (k !== 'q' && k !== 'e') return;
    e.preventDefault();
    _paxView = k === 'q' ? 'forward' : 'rear';
    updatePaxViewTag();
  };
  const onKeyUp = (e) => {
    const k = (e.key || '').toLowerCase();
    if (k === 'q' || k === 'e') { _paxView = 'side'; updatePaxViewTag(); }
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  _paxKeyHandlers = [onKeyDown, onKeyUp];
}
function unbindPaxKeys() {
  if (!_paxKeyHandlers) return;
  const [onKeyDown, onKeyUp] = _paxKeyHandlers;
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  _paxKeyHandlers = null; _paxView = 'side';
}

export function updateCockpit(state) {
  if (isFlightSimActive()) return;   // the continuous cockpit owns the pane — don't mount the glass HUD over it
  ensureHudStyles();
  const now = performance.now();
  _target = state || {};
  updateEngineAudio(_target);

  // Event-driven audio + creaks (compare to previous push).
  if (_prev) {
    if (_prev.bandIndex !== _target.bandIndex) creak('creak');
    if (Math.abs(angDelta(_prev.headingDeg || 0, _target.headingDeg || 0)) > 30) creak('creak');
    if (_target.warn === 'STALL' && _prev.warn !== 'STALL') creak('stress');
    if (_target.warn === 'WEATHER' && _prev.warn !== 'WEATHER') creak('gust');
    if (!_prev.runup && _target.runup) spoolUp(_target.class);           // start-up spool (per class)
    if (_prev.engineOn && !_target.engineOn) spoolDown(_target.class);   // shutdown spool-down
  } else if (_target.runup) spoolUp(_target.class);
  _prev = _target;
  if (_target.ground) _lastGround = _target.ground;
  if (_target.map) _lastMap = _target.map;
  if (_target.biomeBelow) _lastBiome = _target.biomeBelow;

  // Rebuild the panel only when the aircraft's capability layout (or seat) changes.
  const sig = `${_target.seat}|${_target.class}|${_target.engines?.length || 1}|${(_target.hardpoints || 0) > 0}|${(_target.cargoCap || 0) > 0}|${!!_target.vtol}`;
  const root = document.getElementById('ck-hud-root');
  if (!root || _sig !== sig) { mountHud(_target); _sig = sig; }

  if (!_anim) _anim = { hdg: _target.headingDeg || 0, pitch: 0, roll: 0, sweep: 0, eng: _target.engines?.map(e => e.pct) || [0], fuel: _target.fuelPct || 0, thr: _target.throttle || 0, hull: _target.hullPct || 100, spd: _target.spd || 0, fx: _target.fx ?? 0, fy: _target.fy ?? 0 };
  else if (_target.fx != null && _target.fy != null) {
    _moveFrom = { fx: _anim.fx, fy: _anim.fy, t: now, dur: _lastPushT ? clampNum(now - _lastPushT, 400, 6000) : 3000, toFx: _target.fx, toFy: _target.fy };
  }
  _lastPushT = now;
  if (!_raf) { _lastT = performance.now(); _raf = requestAnimationFrame(hudFrame); }
  applyText(_target);
}

export function closeCockpit() {
  closeFlightSim();       // the continuous cockpit, if it owns the pane
  if (_raf) cancelAnimationFrame(_raf); _raf = 0;
  _anim = null; _prev = null; _sig = ''; _moveFrom = null; _lastPushT = 0;
  _lastGround = null; _lastMap = null; _lastBiome = null;
  unbindPaxKeys();
  stopEngineAudio();
}

// ── The per-frame animation loop ──────────────────────────────────────────────
function hudFrame(t) {
  const root = document.getElementById('ck-hud-root');
  if (!root || !_target) { _raf = 0; return; }
  const dt = Math.min(0.05, (t - _lastT) / 1000 || 0); _lastT = t;
  const s = _target, a = _anim;

  // Heading — ease along the shortest arc (the compass "spins" to the bearing).
  const hd = angDelta(a.hdg, s.headingDeg || 0);
  const turnRate = hd * Math.min(1, dt * 3.2);
  a.hdg = (a.hdg + turnRate + 360) % 360;
  a.sweep = (a.sweep + dt * 55) % 360;
  // Eased needles.
  a.fuel += ((s.fuelPct || 0) - a.fuel) * Math.min(1, dt * 4);
  a.thr += ((s.throttle || 0) - a.thr) * Math.min(1, dt * 6);
  a.hull += ((s.hullPct ?? 100) - a.hull) * Math.min(1, dt * 4);
  a.spd += ((s.spd || 0) - a.spd) * Math.min(1, dt * 4);

  // ── Takeoff/landing choreography ──────────────────────────────────────────
  // A fixed, scripted sequence — NOT tied to real altitude bands — timed off the
  // moment the server flips `airborne`:
  //   ground (GROUND_LEAD, flat, throttle winding up) → climb (CLIMB_SEC, held
  //   bank+diagonal climb) → level cruise, and the mirror on the way down. Bank —
  //   not pitch — is the dominant "climb" tilt: it rotates the WHOLE scene
  //   (paintWindshield rotates the canvas by `bank`), so the passenger's SIDE
  //   window shows the horizon tilt over just as clearly as the pilot's forward
  //   view does, banked toward the direction of travel. The climb and the
  //   descent bank opposite ways ("reverse on the other side").
  // CRUISE_HEIGHT caps how "high" the scene ever reads as. The Mode-7 camera adds
  // eye-height as height*climbLift (climbLift=7 — a steep multiplier tuned for
  // real high-altitude flight), so ramping height all the way to 1 made the climb
  // read as shooting straight up. A shallow cruise height keeps the eye-height
  // rise modest, so it's forward motion + bank that sell the climb, not a
  // near-vertical camera lift.
  const vtol = !!s.vtol;   // helicopters lift straight up to altitude, THEN go forward — no bank/dive climb-out
  if (a._wasAirborne == null) a._wasAirborne = !!s.airborne;
  if (!a._wasAirborne && s.airborne) { a._liftT = t; a._landT = null; }
  if (a._wasAirborne && !s.airborne) { a._landT = t; a._liftT = null; }
  a._wasAirborne = !!s.airborne;

  let targetBank = 0, targetPitch = 0, targetHeight = a.height ?? (s.airborne ? CRUISE_HEIGHT : 0);
  if (a._liftT != null) {
    const el = (t - a._liftT) / 1000;
    if (el < GROUND_LEAD) { targetHeight = 0; }
    else if (el < GROUND_LEAD + CLIMB_SEC) {
      if (!vtol) { targetBank = BANK_ANGLE; targetPitch = CLIMB_PITCH; }
      targetHeight = clampNum((el - GROUND_LEAD) / CLIMB_SEC, 0, 1) * CRUISE_HEIGHT;
    } else { targetHeight = CRUISE_HEIGHT; a._liftT = null; }   // sequence done — level cruise
  } else if (a._landT != null) {
    const el = (t - a._landT) / 1000;
    if (el < CLIMB_SEC) {
      if (!vtol) { targetBank = -BANK_ANGLE; targetPitch = -CLIMB_PITCH; }
      targetHeight = clampNum(1 - el / CLIMB_SEC, 0, 1) * CRUISE_HEIGHT;
    }
    else if (el < CLIMB_SEC + GROUND_LEAD) { targetHeight = 0; }
    else { targetHeight = 0; a._landT = null; }     // sequence done — settled on the deck
  } else {
    targetHeight = s.airborne ? CRUISE_HEIGHT : 0;   // steady state, no sequence running
  }
  // Turning bank still applies OUTSIDE a scripted sequence (ordinary cruise turns).
  if (a._liftT == null && a._landT == null) targetBank = clampNum(hd * 0.5, -22, 22);
  // Bank/pitch ease in GRADUALLY (a real bank takes a couple of seconds to roll
  // into, not half a second) then hold — this is the slow, deliberate roll-in
  // the passenger actually sees, rather than a quick snap to 25°.
  a.roll += (targetBank - a.roll) * Math.min(1, dt * 0.8);
  a.pitch += (targetPitch - a.pitch) * Math.min(1, dt * 0.8);
  // Height is NOT eased — `targetHeight` above is already the exact scripted ramp
  // (flat / linear climb / flat), so assigning it directly is what keeps the
  // profile's corners sharp ( ___/‾‾‾\___ ) instead of rounding them off.
  a.height = targetHeight;

  // Scene swap — hysteresis around the ground/airborne cut so it lands once the
  // eased height has actually cleared the deck (climb-out) or sunk back to it
  // (flare), not the instant the server toggles `airborne`.
  if (a._scenePhase == null) a._scenePhase = s.airborne ? 'cruise' : 'ground';
  else if (a._scenePhase === 'ground' && a.height > 0.06) a._scenePhase = 'cruise';
  else if (a._scenePhase === 'cruise' && a.height < 0.025) a._scenePhase = 'ground';
  // Ground-roll distance (cosmetic — the server doesn't track it): while the deck
  // scene is up, accumulate "how far down the strip" from throttle (a proxy for
  // ground speed, since `s.spd` reads 0 until wheels-up). Resets at the start of
  // each fresh on-deck episode — a takeoff roll or a landing roll-out — so the
  // strip is never picked up mid-slide from the PREVIOUS episode. Rate is a
  // quarter of what it was ("slow down the pace... by 400%") for a slower roll.
  if (a._prevScenePhase !== a._scenePhase) { if (a._scenePhase === 'ground') a.rwyRoll = 0; a._prevScenePhase = a._scenePhase; }
  if (a._scenePhase === 'ground') a.rwyRoll = (a.rwyRoll || 0) + (a.thr / 100) * dt * 0.225;
  // Position: linear interpolation across the last push-to-push gap (not an ease-
  // decay like the needles above) so ground speed reads constant instead of
  // slowing into each new push.
  if (_moveFrom) {
    const mt = Math.min(1, (t - _moveFrom.t) / _moveFrom.dur);
    a.fx = _moveFrom.fx + (_moveFrom.toFx - _moveFrom.fx) * mt;
    a.fy = _moveFrom.fy + (_moveFrom.toFy - _moveFrom.fy) * mt;
  }
  const engs = s.engines || [{ pct: 0 }];
  for (let i = 0; i < engs.length; i++) { a.eng[i] = (a.eng[i] ?? 0) + ((engs[i].pct || 0) - (a.eng[i] ?? 0)) * Math.min(1, dt * 3); }

  paintADI(a, s);
  paintRadar(a, s);
  paintCompass(a, s);
  paintEngines(a, s);
  paintDials(a, s);
  paintWindow('ck-ws', a, s);
  _raf = requestAnimationFrame(hudFrame);
}

// The out-the-front-window view — driven from the same eased HUD state. The
// passenger looks out the SIDE by default, or holds Q/E to look forward (into
// the cockpit, past the charter pilot) / rear.
function paintWindow(id, a, s) {
  if (!document.getElementById(id)) return;
  const speedFrac = clampNum((a.spd || 0) / 200, 0, 1);
  const pax = s.seat === 'passenger';
  const paxView = pax ? _paxView : 'side';
  const onGround = (a._scenePhase || (s.airborne ? 'cruise' : 'ground')) === 'ground';
  // Continuous ground↔air crossfade weight, straight off the same eased `a.height` the
  // scene-phase hysteresis above already tracks — so the airport scenery and the Mode-7
  // world actually blend across the climb-out/flare instead of swapping in one frame the
  // instant `_scenePhase` flips.
  const worldBlend = clampNum(((a.height ?? 0) - 0.02) / 0.08, 0, 1);
  // Fractional world offset from the eased position above vs. the map window's
  // (integer) centre — slides the Mode-7 camera smoothly between pushes instead
  // of snapping a tile at a time.
  const mapOffset = worldBlend > 0 && a.fx != null ? { x: a.fx - (s.x ?? a.fx), y: a.fy - (s.y ?? a.fy) } : undefined;
  paintWindshield(id, {
    pitch: a.pitch, bank: a.roll, height: a.height ?? 0, speed: speedFrac,
    hour: s.sky?.hour, weather: s.sky?.weather, wind: s.sky?.wind, heading: a.hdg,
    // Both scenes' data are passed unconditionally (falling back to the last real values
    // once the server's own payload has moved on) — `worldBlend` above decides how much
    // of each windshield.js actually paints, not which one is available.
    map: s.map || _lastMap,
    phase: onGround ? 'ground' : 'cruise',
    worldBlend,
    airport: s.ground?.theme || _lastGround?.theme,
    biomeBelow: s.biomeBelow ?? _lastBiome,
    roll: a.rwyRoll || 0,   // ground-roll distance — how far down the strip you've travelled
    side: paxView === 'side', viewYaw: paxView === 'rear' ? 180 : 0,
    windowClass: pax ? (s.class || 'prop') : undefined,
    livery: pax ? s.livery : undefined,   // hull skin punched by the window = the craft's own paint
    mapOffset,
  });
  if (pax) paintPaxControls(a);
}

// Forward view (Q, held): the charter pilot's own yoke + throttle, worked by the
// same choreography that banks/pitches the cabin — so the passenger watches the
// controls move on their own, flown by nobody they can see. Reuses the pilot
// cockpit's yoke art; harmless to share DOM ids with the real flight-sim cockpit
// since the two panels are never mounted at the same time.
function paintPaxControls(a) {
  const yk = document.getElementById('fsim-yoke-svg');
  const aileronEq = clampNum((a.roll || 0) / BANK_ANGLE, -1, 1);
  const elevatorEq = clampNum((a.pitch || 0) / CLIMB_PITCH, -1, 1);
  if (yk) yk.style.transform = `translateX(${aileronEq * 7}px) translateY(${elevatorEq * 18}px) rotateX(${-elevatorEq * 34}deg) rotateZ(${aileronEq * 30}deg)`;
  const lever = document.getElementById('ck-pax-thr-lever');
  if (lever) lever.style.bottom = (10 + clampNum((a.thr || 0) / 100, 0, 1) * 70) + '%';
}

const $ = (id) => document.getElementById(id);

// ── Instruments ───────────────────────────────────────────────────────────────
function paintADI(a, s) {
  const g = $('ck-adi-h'); if (g) g.setAttribute('transform', `translate(0 ${a.pitch * 2.2}) rotate(${-a.roll} 100 100)`);
  const bank = $('ck-adi-bank'); if (bank) bank.setAttribute('transform', `rotate(${-a.roll} 100 100)`);
}
function paintRadar(a, s) {
  const world = $('ck-radar-world');
  if (world) world.setAttribute('transform', `rotate(${-a.hdg} 130 130)`);
  const sweep = $('ck-radar-sweep'); if (sweep) sweep.setAttribute('transform', `rotate(${a.sweep} 130 130)`);
  // Fuel guide arrow → bearing to nearest field, in the heading-up frame.
  const guide = $('ck-radar-guide');
  if (guide) {
    if (s.guide) { guide.style.display = ''; guide.setAttribute('transform', `rotate(${angDelta(a.hdg, s.guide.bearing)} 130 130)`); }
    else guide.style.display = 'none';
  }
}
function paintCompass(a, s) {
  const card = $('ck-compass-card'); if (card) card.setAttribute('transform', `rotate(${-a.hdg} 60 60)`);
}
function paintEngines(a, s) {
  const engs = s.engines || [];
  for (let i = 0; i < engs.length; i++) {
    const fill = $(`ck-eng-fill-${i}`); if (fill) { const h = (a.eng[i] ?? 0) / 100 * 96; fill.setAttribute('y', 118 - h); fill.setAttribute('height', h); fill.setAttribute('fill', engs[i].stable ? '#46e05a' : (a.eng[i] > 62 ? '#ff5b5b' : '#ffb23e')); }
    const nd = $(`ck-eng-need-${i}`); if (nd) nd.setAttribute('y', 118 - (a.eng[i] ?? 0) / 100 * 96);
  }
}
function paintDials(a, s) {
  setSeven('ck-d-fuel', Math.round(a.fuel), s.fuelPct <= 20 ? 'r' : s.fuelPct <= 40 ? 'a' : 'g');
  setSeven('ck-d-thr', Math.round(a.thr), 'c');
  setSeven('ck-d-hull', Math.round(a.hull), s.hullPct <= 25 ? 'r' : s.hullPct <= 55 ? 'a' : 'g');
  setSeven('ck-d-spd', Math.round(a.spd), 'c');
}
function setSeven(id, val, tone) {
  const el = $(id); if (!el) return;
  el.textContent = String(val).padStart(3, '0');
  el.className = `ck-seg ck-seg-${tone}`;
}

// ── Text/structural updates (only on server push, not per-frame) ──────────────
function applyText(s) {
  const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  const html = (id, v) => { const e = $(id); if (e) e.innerHTML = v; };
  // Passenger cabin strip (present only in the passenger layout).
  if ($('ck-pax-dest')) {
    set('ck-pax-dest', s.surface || (s.airborne ? 'in flight' : 'on the ramp'));
    set('ck-pax-alt', s.bandLabel || 'GND');
    set('ck-pax-spd', String(s.spd || 0));
    set('ck-pax-hdg', String(s.headingDeg ?? 0).padStart(3, '0') + '°');
  }
  set('ck-hdg-num', String(s.headingDeg ?? 0).padStart(3, '0') + '°');
  set('ck-hdg-card', (s.heading || 'n').toUpperCase());
  set('ck-alt-band', s.bandLabel || 'GND');
  set('ck-surface', s.surface || (s.airborne ? 'open air' : '—'));
  set('ck-tail', s.tail || 'CRAFT');
  set('ck-class', (s.class || '').toUpperCase());
  // Interior livery: a cabin-trim swatch in the titlebar (paint you only see aboard).
  const cab = $('ck-cabin');
  if (cab) { if (s.livery) { cab.style.display = ''; cab.style.background = s.livery.cabin; cab.title = `cabin · ${s.livery.uphol}`; } else cab.style.display = 'none'; }
  // Status line + phase.
  const phase = !s.airborne
    ? (s.runup ? '<span class="ck-amber">RUN-UP — warming engines</span>' : s.engineOn ? '<span class="ck-green">READY — throttle up &amp; takeoff</span>' : '<span class="ck-dim">COLD — startup to begin</span>')
    : s.enginesStable === false && s.warn === 'FIRE' ? '<span class="ck-red">ENGINE FIRE</span>'
    : `AIRBORNE · ${s.bandLabel}`;
  html('ck-phase', phase);
  // Guide label.
  html('ck-guide-label', s.guide ? `<span class="ck-amber">◈ ${esc(s.guide.name)} ${String(s.guide.bearing).padStart(3, '0')}° · ${s.guide.dist}mi</span>` : '');
  // Warning strip.
  const warnEl = $('ck-warn');
  if (warnEl) {
    const W = { STARVATION: ['ENGINE OUT — DEAD STICK — LAND NOW', 'r'], BINGO: ['BINGO FUEL — DIVERT', 'a'],
      STALL: ['STALL — RECOVER', 'r'], FIRE: ['ENGINE FIRE — EXTINGUISH', 'r'], WEATHER: ['SEVERE TURBULENCE', 'a'] };
    const w = W[s.warn];
    warnEl.style.display = w ? '' : 'none';
    if (w) { warnEl.textContent = '⚠ ' + w[0]; warnEl.className = `ck-warn ck-warn-${w[1]}`; }
  }
  // Armed pip.
  const arm = $('ck-arm'); if (arm) { arm.style.display = s.hardpoints > 0 ? '' : 'none'; arm.textContent = s.armed ? '● ARMED' : '○ SAFE'; arm.className = s.armed ? 'ck-pip ck-red' : 'ck-pip ck-dim'; }
  // Cargo pip.
  const cargo = $('ck-cargo'); if (cargo) { cargo.style.display = s.cargo > 0 ? '' : 'none'; cargo.textContent = `⬒ ${s.cargo}/${s.maxTOW}kg`; }
  // Capability panels (present only on craft that have them).
  const wa = $('ck-wpn-arm'); if (wa) { wa.textContent = s.armed ? '● ARMED' : '○ SAFE'; wa.className = s.armed ? 'ck-wpn-arm ck-red' : 'ck-wpn-arm ck-dim'; }
  const lf = $('ck-load-fill');
  if (lf) {
    const cap = s.cargoCap || 1, frac = (s.cargo || 0) / cap;
    lf.style.width = `${Math.min(100, frac * 100)}%`;
    lf.style.background = s.cargo > s.maxTOW ? '#ff5b5b' : frac > 1 ? '#ffb23e' : 'var(--acc)';
    const lt = $('ck-load-txt'); if (lt) lt.innerHTML = `${s.cargo || 0} / ${cap} kg${s.cargo > s.maxTOW ? ' <span class="ck-red">⚠ OVER</span>' : ''}`;
  }
  const hl = $('ck-hover-lamp'); if (hl) { hl.classList.toggle('ck-lit', !!s.hover); hl.textContent = s.hover ? 'HOVER' : (s.airborne ? 'FWD' : 'GND'); }
  const vn = $('ck-vsi-need'); if (vn) { const yy = 91 - (s.bandIndex || 0) * 27; vn.setAttribute('points', `14,${yy} 26,${yy - 5} 26,${yy + 5}`); }
  // Real minimap + radar blips (refresh each push; the layer is rotated per-frame).
  renderMini(s.minimap);
  paintRadarWorld(s);
  // Engine labels/stable state.
  (s.engines || []).forEach((e, i) => { const lbl = $(`ck-eng-lbl-${i}`); if (lbl) { lbl.textContent = e.stable ? 'OK' : (s.runup ? '···' : 'CHK'); lbl.setAttribute('fill', e.stable ? '#46e05a' : '#ffb23e'); } });
}

// The real minimap — actual surrounding zones (getMinimapData) with danger colour.
function renderMini(nodes) {
  const box = $('ck-mini'); if (!box) return;
  if (!nodes || !nodes.length) { box.innerHTML = '<div class="ck-mini-empty">— no ground contact —</div>'; return; }
  const cur = nodes.find(n => n.is_current) || nodes[0];
  if (cur.grid_x == null) { box.innerHTML = '<div class="ck-mini-empty">—</div>'; return; }
  let minx = 99, maxx = -99, miny = 99, maxy = -99;
  for (const n of nodes) { if (n.grid_x == null) continue; minx = Math.min(minx, n.grid_x); maxx = Math.max(maxx, n.grid_x); miny = Math.min(miny, n.grid_y); maxy = Math.max(maxy, n.grid_y); }
  const byXY = new Map(nodes.filter(n => n.grid_x != null).map(n => [`${n.grid_x},${n.grid_y}`, n]));
  const danger = (d) => d >= 5 ? '#ff5b5b' : d >= 3 ? '#ffb23e' : d >= 1 ? '#8fd0ff' : '#46e05a';
  let rows = '';
  for (let y = miny; y <= maxy; y++) {
    let cells = '';
    for (let x = minx; x <= maxx; x++) {
      const n = byXY.get(`${x},${y}`);
      if (!n) { cells += '<span class="ck-mini-c"></span>'; continue; }
      const isC = n.is_current;
      cells += `<span class="ck-mini-c" style="color:${isC ? '#ffcf3e' : danger(n.danger_rating || 0)}" title="${esc(n.name)}">${isC ? '◉' : (n.marker || '▪')}</span>`;
    }
    rows += `<div class="ck-mini-row">${cells}</div>`;
  }
  box.innerHTML = rows;
}

// ── Instrument builders (composed per aircraft) ───────────────────────────────
function adiInst() {
  return `<div class="ck-inst ck-inst-adi"><div class="ck-inst-lbl">ATTITUDE</div>
    <svg viewBox="0 0 200 200" class="ck-svg">
      <defs>
        <clipPath id="ck-adi-clip"><circle cx="100" cy="100" r="86"/></clipPath>
        <linearGradient id="ck-adi-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e4c78"/><stop offset="1" stop-color="#1a6fa8"/></linearGradient>
        <linearGradient id="ck-adi-gnd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a3f18"/><stop offset="1" stop-color="#2a1d0a"/></linearGradient>
        <radialGradient id="ck-glass" cx="34%" cy="24%" r="80%"><stop offset="0" stop-color="rgba(255,255,255,0.22)"/><stop offset="42%" stop-color="rgba(255,255,255,0.02)"/><stop offset="100%" stop-color="rgba(0,0,0,0.55)"/></radialGradient>
      </defs>
      <circle cx="100" cy="100" r="94" class="ck-bezel-ring"/>
      <g clip-path="url(#ck-adi-clip)"><g id="ck-adi-h">
        <rect x="-140" y="-160" width="480" height="260" fill="url(#ck-adi-sky)"/>
        <rect x="-140" y="100" width="480" height="260" fill="url(#ck-adi-gnd)"/>
        <line x1="-140" y1="100" x2="340" y2="100" stroke="#eaf6ff" stroke-width="2"/>
        ${[-3, -2, -1, 1, 2, 3].map(k => `<line x1="${100 - (4 - Math.abs(k)) * 7}" y1="${100 + k * 17}" x2="${100 + (4 - Math.abs(k)) * 7}" y2="${100 + k * 17}" stroke="rgba(255,255,255,0.5)" stroke-width="1.3"/>`).join('')}
      </g><rect x="6" y="6" width="188" height="188" fill="url(#ck-glass)"/></g>
      <g id="ck-adi-bank">${[-60, -30, -20, -10, 10, 20, 30, 60].map(deg => { const r = deg * Math.PI / 180; const inner = Math.abs(deg) % 30 === 0 ? 74 : 80; return `<line x1="${100 + Math.sin(r) * inner}" y1="${100 - Math.cos(r) * inner}" x2="${100 + Math.sin(r) * 86}" y2="${100 - Math.cos(r) * 86}" stroke="#8fd0ff" stroke-width="${Math.abs(deg) % 30 === 0 ? 2 : 1}"/>`; }).join('')}<polygon points="100,12 94,24 106,24" fill="#ffcf3e"/></g>
      <path d="M58,100 L86,100 M114,100 L142,100" stroke="#ffcf3e" stroke-width="4" stroke-linecap="round"/>
      <rect x="94" y="94" width="12" height="12" fill="none" stroke="#ffcf3e" stroke-width="2.5"/>
      <circle cx="100" cy="100" r="94" fill="none" class="ck-bezel-glass"/>
    </svg></div>`;
}
function radarInst(size) {
  return `<div class="ck-inst ck-inst-radar ck-radar-${size}"><div class="ck-inst-lbl">RADAR · HDG-UP</div>
    <svg viewBox="0 0 260 260" class="ck-svg">
      <circle cx="130" cy="130" r="126" class="ck-bezel-ring"/><circle cx="130" cy="130" r="118" fill="#03151b"/>
      ${[30, 60, 90, 118].map(r => `<circle cx="130" cy="130" r="${r}" fill="none" stroke="#0e3a44" stroke-width="1"/>`).join('')}
      <g id="ck-radar-world"></g>
      <g id="ck-radar-sweep"><path d="M130,130 L130,12 A118,118 0 0,1 210,44 Z" fill="url(#ck-sweepgrad)" opacity="0.5"/></g>
      <defs><linearGradient id="ck-sweepgrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="rgba(79,224,160,0.5)"/><stop offset="1" stop-color="rgba(79,224,160,0)"/></linearGradient></defs>
      <polygon points="130,116 122,142 130,136 138,142" fill="#ffcf3e"/><polygon points="130,8 124,18 136,18" fill="#8fd0ff"/>
      <g id="ck-radar-guide" style="display:none"><polygon points="130,26 122,44 130,38 138,44" fill="#ffb23e"><animate attributeName="opacity" values="1;0.35;1" dur="1s" repeatCount="indefinite"/></polygon></g>
      <circle cx="130" cy="130" r="126" fill="none" class="ck-bezel-glass"/>
    </svg><div class="ck-guide-label" id="ck-guide-label"></div></div>`;
}
function compassInst() {
  return `<div class="ck-inst ck-inst-compass"><div class="ck-inst-lbl">HDG</div>
    <svg viewBox="0 0 120 120" class="ck-svg">
      <circle cx="60" cy="60" r="56" class="ck-bezel-ring"/><circle cx="60" cy="60" r="50" fill="#04121a"/>
      <g id="ck-compass-card">${Array.from({ length: 12 }, (_, i) => { const deg = i * 30; const r = (deg - 90) * Math.PI / 180; const maj = deg % 90 === 0; const L = maj ? { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[deg] : (deg / 10); return `<line x1="${60 + Math.cos(r) * (maj ? 38 : 42)}" y1="${60 + Math.sin(r) * (maj ? 38 : 42)}" x2="${60 + Math.cos(r) * 48}" y2="${60 + Math.sin(r) * 48}" stroke="${maj ? '#8fd0ff' : '#3f6d8c'}" stroke-width="${maj ? 2 : 1}"/><text x="${60 + Math.cos(r) * 30}" y="${60 + Math.sin(r) * 30 + 3}" fill="${deg === 0 ? '#ff5b5b' : '#8fd0ff'}" font-size="${maj ? 10 : 7}" text-anchor="middle" font-family="monospace">${L}</text>`; }).join('')}</g>
      <polygon points="60,6 55,16 65,16" fill="#ffcf3e"/><circle cx="60" cy="60" r="56" fill="none" class="ck-bezel-glass"/>
    </svg><div class="ck-hdg-readout"><span id="ck-hdg-num" class="ck-seg ck-seg-c">000°</span><span id="ck-hdg-card" class="ck-hdg-card">N</span></div></div>`;
}
function engInst(n) {
  const bars = Array.from({ length: n }, (_, i) => `<g transform="translate(${18 + i * 30} 0)">
      <rect x="0" y="20" width="20" height="100" rx="3" class="ck-eng-tube"/><rect x="2" y="24" width="16" height="${96 * 0.72}" class="ck-eng-band"/>
      <rect id="ck-eng-fill-${i}" x="2" y="118" width="16" height="0" fill="#ffb23e"/><line id="ck-eng-need-${i}" x1="0" y1="118" x2="20" y2="118" stroke="#fff" stroke-width="1.4"/>
      <text x="10" y="134" id="ck-eng-lbl-${i}" fill="#ffb23e" font-size="9" text-anchor="middle" font-family="monospace">···</text>
      <text x="10" y="15" fill="#5f8299" font-size="8" text-anchor="middle" font-family="monospace">${n > 1 ? i + 1 : 'ENG'}</text></g>`).join('');
  return `<div class="ck-inst ck-inst-eng"><div class="ck-inst-lbl">${n > 1 ? n + '× ENGINE' : 'ENGINE'} TEMP</div><svg viewBox="0 0 ${18 + n * 30 + 6} 140" class="ck-svg">${bars}</svg></div>`;
}
function miniInst() {
  return `<div class="ck-inst ck-inst-mini"><div class="ck-inst-lbl">MAP</div>
    <div class="ck-mini" id="ck-mini"><div class="ck-mini-empty">—</div></div>
    <div class="ck-surface-row">⌖ <b id="ck-surface">—</b> · <span id="ck-alt-band">GND</span></div></div>`;
}
function hoverInst() {   // VTOL: a vertical altitude tape + HOVER lamp
  return `<div class="ck-inst ck-inst-hover"><div class="ck-inst-lbl">VERT</div>
    <svg viewBox="0 0 64 130" class="ck-svg">
      <rect x="26" y="10" width="12" height="108" rx="3" class="ck-eng-tube"/>
      ${[10, 37, 64, 91, 118].map((y, i) => `<line x1="20" y1="${y}" x2="44" y2="${y}" stroke="#2b4a60" stroke-width="1"/><text x="48" y="${y + 3}" fill="#5f8299" font-size="7" font-family="monospace">${['HI', 'CR', 'LO', 'GND', ''][i] || ''}</text>`).join('')}
      <polygon id="ck-vsi-need" points="14,118 26,113 26,123" fill="#4fe0a0"/>
    </svg><div class="ck-hover-lamp" id="ck-hover-lamp">HOVER</div></div>`;
}
function wpnInst(hp) {
  return `<div class="ck-inst ck-inst-wpn"><div class="ck-inst-lbl">ARMAMENT</div>
    <div class="ck-wpn-arm ck-dim" id="ck-wpn-arm">○ SAFE</div>
    <div class="ck-wpn-pips" id="ck-wpn-pips">${'◆'.repeat(hp)}</div>
    <div class="ck-wpn-note">${hp} HARDPOINT${hp > 1 ? 'S' : ''}</div></div>`;
}
function cargoInst() {
  return `<div class="ck-inst ck-inst-cargo"><div class="ck-inst-lbl">LOAD · W&amp;B</div>
    <div class="ck-load"><div class="ck-load-fill" id="ck-load-fill"></div></div>
    <div class="ck-load-txt" id="ck-load-txt">0 kg</div></div>`;
}

// ── The passenger cabin: a big window + a slim readout strip, nothing to fly ──
function mountPassenger(s) {
  const th = themeFor(s.class);
  const acc = liveryAccent(s.livery, th.acc);
  const html = `<div id="ck-hud-root" class="ck-hud ck-pax ck-chrome-${th.chrome}" style="--acc:${acc}">
    <div class="ck-titlebar">
      <span class="ck-tmark">✈</span><span class="ck-t-name" id="ck-tail">CABIN</span>
      <span class="ck-t-class" id="ck-class"></span><span class="ck-cabin" id="ck-cabin" title="cabin"></span>
      <span class="ck-phase" id="ck-phase">Enjoy the flight.</span>
    </div>
    <div class="ck-pax-window">${windshieldHTML('ck-ws', 'CABIN WINDOW')}
      <div class="ck-pax-viewtag" id="ck-pax-viewtag"></div>
      <div class="ck-pax-cockpit" id="ck-pax-cockpit">
        <div class="ck-pax-yoke">${YOKE_SVG}</div>
        <div class="ck-pax-thr"><div class="ck-pax-thr-track"></div><div class="ck-pax-thr-lever" id="ck-pax-thr-lever"></div></div>
        <span class="ck-pax-yoke-lbl">${esc((s.tail || s.craft || 'THE PILOT').toUpperCase())} FLIES HANDS-ON</span>
      </div>
    </div>
    <div class="ck-pax-strip">
      <span>◈ <b id="ck-pax-dest">—</b></span>
      <span>ALT <b id="ck-pax-alt">GND</b></span>
      <span>SPD <b id="ck-pax-spd">0</b> kt</span>
      <span>HDG <b id="ck-pax-hdg">000°</b></span>
    </div>
    <div class="ck-warn" id="ck-warn" style="display:none"></div>
    <div class="ck-pax-hint">Hold <b>Q</b> for the cockpit view · <b>E</b> for rear</div>
  </div>`;
  setAreaPane(html);
  bindPaxKeys();
}

// ── Compose the DOM from the aircraft's capabilities + size ───────────────────
function mountHud(s) {
  ensureWindshieldStyles();
  if (s.seat === 'passenger') return mountPassenger(s);
  const n = Math.max(1, s.engines?.length || 1);
  const th = themeFor(s.class);
  const acc = liveryAccent(s.livery, th.acc);
  const hasWpn = (s.hardpoints || 0) > 0, hasCargo = (s.cargoCap || 0) > 0, isVtol = !!s.vtol;

  // Row 2: compass + engines, plus a hover tape for VTOL.
  const row2 = [compassInst(), engInst(n), isVtol ? hoverInst() : ''].filter(Boolean).join('');
  // Row 3: the minimap, plus capability panels (cargo / weapons).
  const row3 = [miniInst(), hasCargo ? cargoInst() : '', hasWpn ? wpnInst(s.hardpoints) : ''].filter(Boolean).join('');

  const html = `<div id="ck-hud-root" class="ck-hud ck-chrome-${th.chrome}" style="--acc:${acc}">
    <div class="ck-titlebar">
      <span class="ck-tmark">✈</span><span class="ck-t-name" id="ck-tail">CRAFT</span>
      <span class="ck-t-class" id="ck-class"></span><span class="ck-cabin" id="ck-cabin" title="cabin"></span>
      <span class="ck-phase" id="ck-phase"></span>
      <span class="ck-pip ck-dim" id="ck-arm" style="display:none"></span>
      <span class="ck-pip ck-dim" id="ck-cargo" style="display:none"></span>
    </div>
    <div class="ck-canopy">${windshieldHTML('ck-ws', 'FWD VIEW')}</div>
    <div class="ck-grid">
      <div class="ck-row ck-row-top">${adiInst()}${radarInst(th.radar)}</div>
      <div class="ck-row">${row2}</div>
      <div class="ck-row">${row3}</div>
    </div>
    <div class="ck-dials">
      <div class="ck-dial"><div class="ck-dial-lbl">FUEL</div><div class="ck-seg ck-seg-g" id="ck-d-fuel">000</div><div class="ck-dial-u">%</div></div>
      <div class="ck-dial"><div class="ck-dial-lbl">THR</div><div class="ck-seg ck-seg-c" id="ck-d-thr">000</div><div class="ck-dial-u">%</div></div>
      <div class="ck-dial"><div class="ck-dial-lbl">HULL</div><div class="ck-seg ck-seg-g" id="ck-d-hull">100</div><div class="ck-dial-u">%</div></div>
      <div class="ck-dial"><div class="ck-dial-lbl">ASPD</div><div class="ck-seg ck-seg-c" id="ck-d-spd">000</div><div class="ck-dial-u">kt</div></div>
    </div>
    <div class="ck-warn" id="ck-warn" style="display:none"></div>
  </div>`;
  setAreaPane(html);
  paintRadarWorld(s);
}

// Radar blips: land/field/nofly cells from the coarse map window, plotted N-up
// (the parent group is rotated to heading-up each frame).
function paintRadarWorld(s) {
  const g = $('ck-radar-world'); if (!g) return;
  if (!s.map) { g.innerHTML = ''; return; }
  const R = (s.map.length - 1) / 2, step = 108 / (R + 0.5);
  let out = '';
  for (let ry = 0; ry < s.map.length; ry++) for (let rx = 0; rx < s.map[ry].length; rx++) {
    const cell = s.map[ry][rx]; if (cell.kind === 'air' || cell.kind === 'craft') continue;
    const cx = 130 + (rx - R) * step, cy = 130 + (ry - R) * step;
    if (cell.kind === 'field') out += `<rect x="${cx - 4}" y="${cy - 4}" width="8" height="8" fill="none" stroke="#46e05a" stroke-width="1.5"/><circle cx="${cx}" cy="${cy}" r="1.5" fill="#46e05a"/>`;
    else if (cell.kind === 'nofly') out += `<path d="M${cx - 4},${cy - 4} L${cx + 4},${cy + 4} M${cx + 4},${cy - 4} L${cx - 4},${cy + 4}" stroke="#ff5b5b" stroke-width="1.5"/>`;
    else out += `<circle cx="${cx}" cy="${cy}" r="2.4" fill="#2f6d4a"/>`;
  }
  g.innerHTML = out;
}

function ensureHudStyles() {
  if (document.getElementById('cockpit-hud-styles')) return;
  const st = document.createElement('style'); st.id = 'cockpit-hud-styles';
  st.textContent = `
    /* Fill the whole top pane and scale with it — the HUD is a flex column whose
       instrument grid grows to eat all available height. */
    #area-content:has(.ck-hud) { height:100%; }
    .ck-hud { --acc:#4fb8e0; font-family:'Courier New',monospace; color:#a9d4ec; padding:6px;
      height:100%; box-sizing:border-box; display:flex; flex-direction:column; overflow:hidden;
      background:
        linear-gradient(180deg, rgba(90,110,130,0.10), transparent 30%),
        repeating-linear-gradient(102deg, #20272e 0px, #20272e 2px, #262e37 3px, #20272e 4px),
        linear-gradient(160deg, #232b33, #12171c 60%, #0a0e12);
      border:1px solid #05080b; border-radius:8px;
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.06), inset 0 0 40px rgba(0,0,0,0.6); }
    .ck-titlebar { display:flex; align-items:center; gap:10px; padding:2px 6px 6px; border-bottom:1px solid #2a3540; letter-spacing:1px; font-size:12px; }
    .ck-tmark { color:var(--acc); text-shadow:0 0 10px rgba(79,184,224,0.8); animation:ck-br 3.2s ease-in-out infinite; }
    @keyframes ck-br { 50% { text-shadow:0 0 18px rgba(79,184,224,1); } }
    .ck-t-name { color:#eaf6ff; font-weight:bold; letter-spacing:2px; }
    .ck-t-class { color:#5f8299; font-size:10px; }
    .ck-cabin { display:inline-block; width:12px; height:12px; border-radius:3px; border:1px solid rgba(0,0,0,0.45); box-shadow:inset 0 0 3px rgba(0,0,0,0.6); vertical-align:middle; }
    .ck-phase { margin-left:auto; font-size:11px; letter-spacing:1px; }
    .ck-pip { font-size:10px; padding:1px 6px; border:1px solid #2a3540; border-radius:3px; background:rgba(0,0,0,0.3); }
    /* Out-the-window canopy band (pilot) — sits above the instrument grid. */
    .ck-canopy { flex:1.15 1 0; min-height:82px; margin:8px 2px 0; }
    .ck-canopy .ws-wrap { height:100%; }
    /* Passenger cabin: the window IS the panel. */
    .ck-pax .ck-pax-window { flex:1 1 auto; min-height:0; margin:8px 4px 0; position:relative; }
    .ck-pax .ck-pax-window .ws-wrap { height:100%; }
    .ck-pax-strip { display:flex; justify-content:space-around; gap:10px; padding:8px 6px 4px; font-size:11px; letter-spacing:1px; color:#7fae99; }
    .ck-pax-strip b { color:#eaf6ff; }
    .ck-pax-hint { text-align:center; font-size:9px; letter-spacing:1px; color:#4d6a76; padding:0 6px 4px; }
    .ck-pax-hint b { color:#7fae99; }
    /* Q/E look-direction tag — mirrors the pilot's own fsim-viewtag styling. */
    .ck-pax-viewtag { position:absolute; top:8px; left:50%; transform:translateX(-50%); font:10px monospace;
      letter-spacing:2px; color:#ffcf3e; background:rgba(6,12,18,0.6); border:1px solid rgba(255,207,62,0.4);
      padding:2px 10px; border-radius:3px; opacity:0; pointer-events:none; transition:opacity .15s; z-index:2; }
    .ck-pax-viewtag.show { opacity:1; }
    /* Forward view (Q held): the pilot's own yoke + throttle, worked by nobody the
       passenger can see — the charter autopilot flying the choreography above. */
    .ck-pax-cockpit { position:absolute; left:0; right:0; bottom:6px; display:flex; align-items:flex-end;
      justify-content:center; gap:10px; opacity:0; pointer-events:none; transition:opacity .2s; z-index:2; }
    .ck-pax-cockpit.show { opacity:1; }
    .ck-pax-yoke { width:78px; filter:drop-shadow(0 3px 6px rgba(0,0,0,0.6)); }
    .ck-pax-yoke svg { width:100%; display:block; transition:transform .1s linear; }
    .ck-pax-thr { position:relative; width:14px; height:60px; }
    .ck-pax-thr-track { position:absolute; inset:0; border-radius:4px; background:linear-gradient(180deg,#171b20,#0a0c0e); border:1px solid #2a3540; }
    .ck-pax-thr-lever { position:absolute; left:-3px; right:-3px; height:9px; bottom:10%; border-radius:2px;
      background:linear-gradient(180deg,#3aa8e0,#0b2a3c); border:1px solid #05121a; transition:bottom .1s linear; }
    .ck-pax-yoke-lbl { position:absolute; bottom:-13px; left:0; right:0; text-align:center; font-size:8px;
      letter-spacing:1px; color:#4d6a76; white-space:nowrap; }
    /* Capability-driven flex layout: rows of instrument cards. Which cards exist,
       and the radar's size, are chosen per aircraft in mountHud(). */
    .ck-grid { display:flex; flex-direction:column; gap:8px; padding:8px 2px 2px; flex:1 1 auto; min-height:0; }
    .ck-row { display:flex; gap:8px; align-items:stretch; flex:1 1 0; min-height:0; }
    .ck-row-top { flex:1.5 1 0; }
    .ck-row-top .ck-inst-adi { flex:1 1 40%; }
    .ck-row > .ck-inst { flex:1 1 0; min-width:0; }
    .ck-radar-sm { flex:1.1 1 0 !important; } .ck-radar-md { flex:1.5 1 0 !important; } .ck-radar-lg { flex:2 1 0 !important; }
    .ck-inst { position:relative; padding:6px; border-radius:8px; display:flex; flex-direction:column; min-height:0;
      background:linear-gradient(160deg, #2a333c, #161c22 70%);
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.05), inset 0 0 0 1px rgba(0,0,0,0.5), 0 3px 8px rgba(0,0,0,0.5); }
    .ck-inst-lbl { position:absolute; top:5px; left:9px; font-size:8px; letter-spacing:2px; color:#5f8299; z-index:2; }
    /* SVG instruments scale to fill their card (aspect preserved via viewBox meet). */
    .ck-svg { display:block; width:100%; height:100%; flex:1 1 0; min-height:0; }
    .ck-inst-radar .ck-svg { max-height:none; }
    .ck-inst-mini, .ck-inst-cargo, .ck-inst-wpn { justify-content:center; }
    .ck-bezel-ring { fill:none; stroke:#39434d; stroke-width:6; filter:drop-shadow(0 1px 1px rgba(0,0,0,0.7)); }
    .ck-bezel-glass { stroke:rgba(180,220,255,0.10); stroke-width:2; }
    .ck-eng-tube { fill:#0a1620; stroke:#2b4a60; stroke-width:1; }
    .ck-eng-band { fill:rgba(70,224,90,0.14); }
    .ck-green,.ck-seg-g { color:#46e05a; } .ck-amber,.ck-seg-a { color:#ffb23e; } .ck-red,.ck-seg-r { color:#ff5b5b; } .ck-seg-c { color:#4fb8e0; } .ck-dim { color:#5f8299; }
    /* Digital seven-segment style */
    .ck-seg { font-family:'Courier New',monospace; font-weight:bold; letter-spacing:3px; font-size:18px;
      text-shadow:0 0 8px currentColor, 0 0 2px currentColor; background:#050b0f; padding:2px 6px; border-radius:3px;
      border:1px solid #1a2730; box-shadow:inset 0 0 8px rgba(0,0,0,0.9); }
    .ck-hdg-readout { display:flex; align-items:center; justify-content:center; gap:6px; margin-top:4px; }
    .ck-hdg-card { color:#eaf6ff; font-weight:bold; letter-spacing:1px; }
    .ck-mini { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0; padding:14px 4px 2px; min-height:70px; background:#04121c; border-radius:5px; box-shadow:inset 0 0 16px rgba(0,0,0,0.7); }
    .ck-mini-row { display:flex; line-height:1.1; }
    .ck-mini-c { width:13px; text-align:center; font-size:12px; }
    .ck-mini-empty { color:#3f5666; font-size:10px; letter-spacing:1px; }
    .ck-surface-row { text-align:center; font-size:10px; color:#7fae99; padding:4px 2px 0; letter-spacing:1px; }
    .ck-surface-row b { color:#a9e6c6; }
    .ck-guide-label { text-align:center; font-size:10px; letter-spacing:1px; min-height:13px; padding-top:2px; }
    .ck-dials { display:flex; gap:8px; padding:8px 4px 2px; justify-content:space-between; }
    .ck-dial { flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; padding:6px 2px;
      border-radius:6px; background:linear-gradient(160deg, #2a333c, #12171c);
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.05), 0 2px 5px rgba(0,0,0,0.5); }
    .ck-dial-lbl { font-size:8px; letter-spacing:2px; color:#5f8299; }
    .ck-dial-u { font-size:8px; color:#5f8299; }
    .ck-warn { margin:6px 2px 0; padding:5px; text-align:center; font-weight:bold; letter-spacing:1px; border-radius:5px;
      background:rgba(255,91,91,0.10); animation:ck-fl 1s steps(2) infinite; }
    .ck-warn-a { color:#ffb23e; background:rgba(255,178,62,0.10); } .ck-warn-r { color:#ff5b5b; }
    @keyframes ck-fl { 50% { opacity:0.4; } }
    /* Capability panels (present only on craft that carry them) */
    .ck-inst-hover { flex:0.5 1 0 !important; }
    .ck-hover-lamp { text-align:center; font-size:9px; letter-spacing:2px; margin-top:2px; color:#5f8299; border:1px solid #223; border-radius:3px; padding:1px; }
    .ck-hover-lamp.ck-lit { color:#04101a; background:#4fe0a0; border-color:#4fe0a0; }
    .ck-inst-wpn { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; }
    .ck-wpn-arm { font-size:15px; font-weight:bold; letter-spacing:2px; text-shadow:0 0 8px currentColor; }
    .ck-wpn-pips { letter-spacing:4px; font-size:16px; color:#ff6b5b; text-shadow:0 0 8px rgba(255,107,91,0.7); }
    .ck-wpn-note { font-size:8px; letter-spacing:2px; color:#5f8299; }
    .ck-inst-cargo { display:flex; flex-direction:column; justify-content:center; gap:6px; }
    .ck-load { height:16px; background:#0a1620; border:1px solid #2b4a60; border-radius:4px; overflow:hidden; box-shadow:inset 0 0 8px rgba(0,0,0,0.8); }
    .ck-load-fill { height:100%; width:0%; background:var(--acc); transition:width .3s, background .3s; }
    .ck-load-txt { text-align:center; font-size:11px; letter-spacing:1px; color:#a9d4ec; }
    /* Accent-driven bits so each class palette reads through */
    .ck-tmark { color:var(--acc) !important; }
    .ck-seg-c { color:var(--acc); }
    /* Per-class chrome flourishes */
    .ck-chrome-military .ck-titlebar { border-bottom-color:#5a2a2a; }
    .ck-chrome-military .ck-inst-radar { box-shadow:inset 0 1px 0 rgba(255,255,255,0.05), inset 0 0 0 1px rgba(0,0,0,0.5), 0 0 14px rgba(255,107,91,0.18); }
    .ck-chrome-industrial .ck-inst { border-left:2px solid rgba(255,178,62,0.28); }
    .ck-chrome-minimal .ck-inst { background:linear-gradient(160deg,#242c33,#141a1f 70%); }
    .ck-chrome-minimal .ck-titlebar::after { content:'ULTRALIGHT · MINIMAL PANEL'; margin-left:6px; font-size:9px; letter-spacing:2px; color:#3f5666; }
    .ck-chrome-rotor .ck-inst-hover { flex:0.6 1 0 !important; }
    /* Wreck: salvaged, degraded avionics — flicker + desaturation + a warning tag */
    .ck-chrome-degraded .ck-inst { animation:ck-glitch 5s infinite steps(60); filter:saturate(0.55) contrast(0.92) brightness(0.95); }
    .ck-chrome-degraded .ck-inst-adi { position:relative; }
    .ck-chrome-degraded .ck-inst-adi::after { content:'⚠ AVIONICS DEGRADED'; position:absolute; inset:auto 0 8px 0; text-align:center; font-size:9px; letter-spacing:2px; color:#ffb23e; text-shadow:0 0 6px rgba(0,0,0,0.9); }
    .ck-chrome-degraded .ck-titlebar { border-bottom-color:#4a5a2a; }
    @keyframes ck-glitch { 0%,90%,100%{opacity:1} 92%{opacity:0.72} 94%{opacity:1} 96%{opacity:0.85} }
    @media (max-width:560px) { .ck-row { flex-wrap:wrap; } .ck-row-top .ck-inst-adi, .ck-row-top .ck-inst-radar { flex:1 1 100% !important; } }
  `;
  document.head.appendChild(st);
}

// ══════════════════════════════════════════════════════════════════════════════
// MINIGAME CHASSIS (shared styling for the focused decks)
// ══════════════════════════════════════════════════════════════════════════════
function ensureMgStyles() {
  if (document.getElementById('cockpit-mg-styles')) return;
  const s = document.createElement('style'); s.id = 'cockpit-mg-styles';
  s.textContent = `
    #cockpit-overlay { --mg-accent:#4fb8e0; position:fixed; inset:0; z-index:9200; display:flex; align-items:center; justify-content:center;
      background:rgba(0,4,7,0.82); backdrop-filter:blur(3px); font-family:'Courier New',monospace; }
    #cockpit-overlay .ck-panel { width:min(560px,95vw); color:#a9d4ec;
      background:
        repeating-linear-gradient(102deg, rgba(255,255,255,0.02) 0 2px, transparent 2px 4px),
        linear-gradient(180deg,#2b3a48 0%,#1c2833 8%,#111c26 13%,#070f16 100%);
      padding:14px 16px 16px; border-radius:14px; animation:ck-boot .3s ease-out;
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.07), 0 20px 50px rgba(0,0,0,0.75); }
    @keyframes ck-boot { 0%{opacity:0;transform:scale(.985)} 100%{opacity:1;transform:scale(1)} }
    #cockpit-overlay .ck-hud2 { display:flex; gap:16px; align-items:center; padding:8px 2px; font-size:12px; color:#7f93a4; letter-spacing:1px; flex-wrap:wrap; }
    #cockpit-overlay .ck-hud2 b { color:#4fb8e0; font-weight:bold; }
    #cockpit-overlay .ck-asi-wrap { display:inline-flex; align-items:center; gap:6px; margin-left:auto; }
    #cockpit-overlay .ck-asi-bar { position:relative; display:inline-block; width:130px; height:9px; background:#0a1620; border:1px solid #2b4a60; border-radius:3px; overflow:hidden; }
    #cockpit-overlay .ck-asi-fill { display:block; height:100%; width:0%; background:linear-gradient(90deg,#2a7fa8,#4fb8e0); transition:width .08s linear; }
    #cockpit-overlay .ck-asi-vr { position:absolute; top:-2px; bottom:-2px; width:2px; background:#46e05a; box-shadow:0 0 6px #46e05a; }
    #cockpit-overlay .ck-scr { background:radial-gradient(130% 130% at 50% 40%, rgba(79,184,224,0.08) 55%, #01060a 100%); }
    #cockpit-overlay .ck-scr svg { display:block; width:100%; height:auto; }
    #cockpit-overlay .ck-status2 { min-height:22px; padding:8px 2px 2px; font-size:13px; letter-spacing:1px; font-weight:bold; }
    #cockpit-overlay .ck-win { color:#46e05a; } #cockpit-overlay .ck-lose { color:#ff5b5b; } #cockpit-overlay .ck-hint { color:#7fae99; font-weight:normal; } #cockpit-overlay .ck-call { color:#ffcf3e; }
    #cockpit-overlay .ck-actions { display:flex; gap:8px; margin-top:8px; }
    #cockpit-overlay .ck-btn { flex:1; padding:11px 6px; background:linear-gradient(180deg,#16283a,#0f1c28); color:#8fc4e0; border:1px solid #2b4a60; border-radius:4px;
      cursor:pointer; font-family:'Courier New',monospace; font-size:12px; font-weight:bold; letter-spacing:2px; text-transform:uppercase;
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -2px 0 rgba(0,0,0,0.5); transition:all .12s; user-select:none; -webkit-user-select:none; touch-action:none; }
    #cockpit-overlay .ck-btn:hover { color:#4fb8e0; border-color:#4fb8e0; }
    #cockpit-overlay .ck-btn.ck-down { color:#04101a; background:#4fb8e0; border-color:#4fb8e0; box-shadow:inset 0 2px 4px rgba(0,0,0,0.4); }
    #cockpit-overlay .ck-btn.ck-lit { color:#04101a; background:#46e05a; border-color:#46e05a; }
    #cockpit-overlay .ck-btn-abort:hover { color:#ff5b5b; border-color:#ff5b5b; }
    #cockpit-overlay .ck-btn-flare { flex:1.3; background:#2a1a06; color:#ffb23e; border-color:#7a5310; }
    #cockpit-overlay .ck-btn-flare.ck-armed { animation:ck-flare-pulse 0.5s steps(2) infinite; color:#04101a; background:#ffb23e; border-color:#ffcf3e; }
    @keyframes ck-flare-pulse { 50% { opacity:0.55; } }
  `;
  document.head.appendChild(s);
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. TAKEOFF — run-up → roll → V-speeds → rotate → gear up
// ══════════════════════════════════════════════════════════════════════════════
// Lever + big-message styling for the takeoff deck (injected once).
function ensureTakeoffStyles() {
  if (document.getElementById('cockpit-takeoff-styles')) return;
  const s = document.createElement('style'); s.id = 'cockpit-takeoff-styles';
  s.textContent = `
    #cockpit-overlay .ck-scr-wrap { position:relative; }
    #cockpit-overlay .ck-bigmsg { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none;
      font-weight:bold; letter-spacing:2px; font-size:22px; text-align:center; text-shadow:0 0 12px currentColor, 0 2px 4px #000; }
    #cockpit-overlay .ck-levers { display:flex; gap:10px; margin-top:10px; align-items:stretch; }
    #cockpit-overlay .ck-lever { position:relative; flex:1; height:140px; border-radius:8px; cursor:grab; touch-action:none; user-select:none;
      background:linear-gradient(180deg,#0c1826,#050b12); border:1px solid #2b4a60; box-shadow:inset 0 0 14px rgba(0,0,0,0.8); }
    #cockpit-overlay .ck-lever.ck-grab { cursor:grabbing; }
    #cockpit-overlay .ck-lever-fill { position:absolute; left:0; right:0; bottom:0; height:0%; border-radius:0 0 8px 8px; background:linear-gradient(180deg,rgba(79,184,224,0.35),rgba(79,184,224,0.12)); }
    #cockpit-overlay .ck-lever-knob { position:absolute; left:4px; right:4px; height:20px; border-radius:5px; background:linear-gradient(180deg,#d6e8f5,#7f9bb0);
      box-shadow:0 2px 4px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.5); }
    #cockpit-overlay .ck-lever-mid { position:absolute; left:0; right:0; top:50%; height:1px; background:#2b4a60; }
    #cockpit-overlay .ck-lever-v1 { position:absolute; left:0; right:0; height:2px; background:#46e05a; box-shadow:0 0 6px #46e05a; }
    #cockpit-overlay .ck-lever-lbl { position:absolute; top:4px; left:0; right:0; text-align:center; font-size:9px; letter-spacing:2px; color:#7f93a4; pointer-events:none; }
    #cockpit-overlay .ck-lever-lbl b { display:block; color:#4fb8e0; font-size:14px; margin-top:2px; }
    #cockpit-overlay .ck-deck-canopy { height:72px; margin:2px 0 6px; }
    #cockpit-overlay .ck-deck-canopy .ws-wrap { height:100%; min-height:0; }
  `;
  document.head.appendChild(s);
}

// TAKEOFF — a hand-flown departure on two controls: a THROTTLE lever (drag to set
// 0–100%, holds where you leave it) and a CONTROL COLUMN (drag up = push forward =
// pitch down; drag down = pull back = pitch up; holds). Roll begins once the
// throttle's up; at 80% of runway with ≥60% throttle you get V1 — ROTATE, and a
// GENTLE pull-back (≈20–30%) lifts you off. Over-rotate → STALL (level out or
// crash); nose-down → crash nose-first; no rotation before the end → overrun.
// ══════════════════════════════════════════════════════════════════════════════
// 2.5. THE CONTINUOUS COCKPIT (client-sim + server-reconcile)  — Phase 1 slice
// ══════════════════════════════════════════════════════════════════════════════
// A persistent, always-live cockpit that runs the real flight-model.js physics at
// 60fps in the area pane. Draggable yoke/throttle/flaps (Pointer Events, mouse +
// touch). It streams state to the server via `flightsync`, reports wheels-up and
// touchdown via `flightevent`, and consumes `flight_ctx` for authoritative fuel +
// the world below. The yoke is physically inverted (pull DOWN = nose up). Retires
// the modal takeoff/glideslope decks for continuous craft (currently the Mayfly).

let _fsim = null;
const lerpN = (a, b, t) => a + (b - a) * t;
// Air-to-air (Phase A): tighten flightsync when traffic is within this many tiles,
// and dead-reckon a contact's position at most this long before its next relay.
const FAST_SYNC_RANGE = 5, CONTACT_DR_MAX = 2.0;
// Air-to-air guns (Phase B): the client's gun-solution envelope (tiles + half-cone deg),
// the alt→world-z scale (mirrors windshield CONTACT_ALT_K) for the vertical aim term, and
// the burst cadence while the trigger's held (the server enforces its own harder cap).
const GUN_RANGE = 2.2, GUN_CONE = 11, GUN_ALT_K = 1 / 600, GUN_FIRE_MS = 130;
// ── Building collision (CFIT) ─────────────────────────────────────────────────
// The windshield draws one deterministic building per built-up tile (buildingHeightZ in
// windshield.js is the shared source of truth); the sim collision-checks that SAME geometry
// so flying into a tower you can see out the glass hurts. Building heights are in the render's
// world-z units — CFIT_FT_PER_Z converts to feet AGL (matched to the contact-altitude scale,
// 1/600, so a rooftop sits at the height a contact aircraft would show at the same z). A shallow
// clip of the roofline is survivable damage; going deep into the structure (or hitting fast) is a
// write-off. All four are eyeball-tuning knobs for the live pass.
const CFIT_FT_PER_Z = 600;    // render world-z → feet AGL
const CFIT_FOOT = 0.12;       // building collision half-width around the tile centre (tile units) — tight, pixel-precise
const CFIT_CRASH_PEN = 110;   // ft below the roofline that means you're INTO the structure → crash
const CFIT_SWEEP = 4;         // sub-samples along the frame's ground track (anti-tunnel for fast craft)

// Test the aircraft's path THIS frame against the buildings on the tiles it crosses. Returns
// null (clear), or { severe, roofFt } — severe = a solid hit (write-off), else a survivable clip.
function buildingCollisionAt(F, s) {
  const map = F.map;
  if (!map || !map.length || s.onGround) return null;
  const R = (map.length - 1) / 2, mc = F.mapCenter || { x: 0, y: 0 };
  const prev = F.cfitPrev || { x: F.pos.x, y: F.pos.y };
  const hd = (s.heading || 0) * Math.PI / 180, sinh = Math.sin(hd), cosh = Math.cos(hd);
  const height = Math.min(1, Math.sqrt(Math.max(0, s.altitude) / 3000));   // matches windshield's v.height
  let worst = null;
  for (let i = 1; i <= CFIT_SWEEP; i++) {
    const t = i / CFIT_SWEEP;
    const px = prev.x + (F.pos.x - prev.x) * t, py = prev.y + (F.pos.y - prev.y) * t;
    const wx = Math.round(px), wy = Math.round(py);   // one building per tile, at integer coords
    if (Math.abs(px - wx) > CFIT_FOOT || Math.abs(py - wy) > CFIT_FOOT) continue;   // outside the footprint
    const rx = Math.round(wx - mc.x + R), ry = Math.round(wy - mc.y + R);
    if (ry < 0 || ry >= map.length || rx < 0 || rx >= map[ry].length) continue;
    const hz = buildingHeightZ(wx, wy, map[ry][rx]);
    if (hz <= 0) continue;
    const dx = wx - px, dy = wy - py, f = dx * sinh - dy * cosh, lat = dx * cosh + dy * sinh;
    // Must be inside the renderer's own near/far visibility window — a building the windshield
    // wouldn't actually be drawing (too close under the nose, or still fading in from FAR out)
    // can't hurt you either. Same climb-out corridor rule on top of that: a building the
    // windshield culls dead-ahead-and-low right off the runway can't be collided with.
    if (f <= VISIBLE_NEAR_F || f > VISIBLE_FAR_F) continue;
    if (!climbOutClear(f, lat, height)) continue;
    // Departure climb-out: while still within the takeoff corridor (CLIMBOUT_MAX_F tiles of
    // where we lifted off), a building we haven't yet out-climbed is flown THROUGH, not hit.
    // The visual world-scroll deliberately stalls forward tile-progress as altitude builds, so
    // a weak climber off a field boxed in by towers (the Mayfly at Coldwater Regional) reaches
    // an adjacent rooftop still far below it — every time. climbOutClear's fixed <120ft/f>0.1
    // window releases right at that moment; this covers the rest of the low climb-out. Anchored
    // to F.depPos (set at liftoff), so CFIT is untouched for any low pass elsewhere in the city.
    if (F.depPos && Math.hypot(F.pos.x - F.depPos.x, F.pos.y - F.depPos.y) < CLIMBOUT_MAX_F
        && f > 0 && f < CLIMBOUT_MAX_F && Math.abs(lat) < CLIMBOUT_LAT_IN + CLIMBOUT_LAT_OUT
        && s.altitude < hz * CFIT_FT_PER_Z) continue;
    const pen = hz * CFIT_FT_PER_Z - s.altitude;   // >0 ⇒ below the roofline ⇒ contact
    if (pen > 0 && (!worst || pen > worst.pen)) worst = { pen, roofFt: hz * CFIT_FT_PER_Z };
  }
  if (!worst) return null;
  return { severe: worst.pen >= CFIT_CRASH_PEN || s.airspeed >= (F.P?.vne || 200) * 0.6, roofFt: worst.roofFt };
}
// Live-tunable render knobs exposed as in-cockpit sliders (⚙). RENDER_TUNE is shared
// with windshield.js so a slider change takes effect on the very next frame.
const FSIM_TUNE = [
  ['worldPace', 'Ground speed', 0, 0.001, 0.00005],
  ['groundBoost', 'Ground boost', 1, 20, 0.5],
  ['groundDecay', 'Ground fade', 8, 200, 2],
  ['eh', 'Horizon compress', 0, 1, 0.01],
  ['climbLift', 'Climb lift', 0, 20, 0.5],
  ['tile', 'Floor tiles', 0.1, 3, 0.05],
  ['pixel', 'Pixel size', 1, 10, 1],
  ['bldgH', 'Bldg height', 0.05, 3, 0.05],
  ['bldgFoot', 'Bldg width', 0.05, 1.5, 0.05],
  ['texRes', 'Texture res', 0.3, 4, 0.25],
  ['haze', 'Distance haze', 0.3, 3, 0.05],
  ['rwl', 'Runway length', 1, 8, 0.2],
  ['rwyRecede', 'Runway recede', 0.5, 6, 0.2],
  ['fov', 'Tunnel (FOV)', 0.5, 1.6, 0.02],
];

// Live-tunable FLIGHT-MODEL knobs — every per-airframe characteristic in flightmodel
// TYPES. These mutate the current plane's params object (F.P), which step() reads fresh
// every frame, so a drag re-tunes the feel on the next frame. Session-scoped, per plane.
const PHYS_TUNE = [
  ['mass', 'Mass', 0.5, 6, 0.1],
  ['thrustMax', 'Thrust', 5, 60, 0.5],
  ['engineLag', 'Engine lag', 0.5, 3, 0.1],
  ['vr', 'Rotate spd', 25, 110, 1],
  ['vs0', 'Stall spd', 18, 90, 1],
  ['cruise', 'Cruise spd', 55, 220, 5],
  ['vne', 'Never-exceed', 100, 360, 5],
  ['pitchRate', 'Pitch rate', 3, 18, 0.5],
  ['pitchTau', 'Pitch lag', 0.3, 1.5, 0.05],
  ['pitchStable', 'Pitch stable', 0.4, 1.4, 0.05],
  ['rollRate', 'Roll rate', 15, 110, 1],
  ['rollTau', 'Roll lag', 0.3, 1.5, 0.05],
  ['rollStable', 'Roll stable', 0.5, 1.4, 0.05],
  ['dragP', 'Drag', 0.0005, 0.0016, 0.00005],
  ['liftScale', 'Lift scale', 0.8, 1.2, 0.05],
  ['aoaCrit', 'Crit AoA', 12, 24, 0.5],
  ['flapDrag', 'Flap drag', 0.3, 0.9, 0.05],
  ['flapLift', 'Flap lift', 0.2, 0.6, 0.05],
  ['flapVs', 'Flap stall', 0.1, 0.3, 0.01],
  ['vsMax', 'Climb rate', 300, 2500, 50],
  ['vsGain', 'Climb gain', 1200, 2200, 50],
  ['vsTau', 'Climb inertia', 0.6, 1.8, 0.05],
  ['rollFric', 'Roll friction', 0.8, 2.5, 0.1],
  ['brake', 'Brakes', 3, 9, 0.5],
  ['groundSteer', 'Ground steer', 8, 40, 1],
];
// Value formatter: decimals inferred from the slider step (so 0.00005 shows 5 places).
const decOf = (stp) => { const i = String(stp).indexOf('.'); return i < 0 ? 0 : String(stp).length - i - 1; };
const fmtStp = (v, stp) => (+v).toFixed(decOf(stp));

// Per-craft cockpit SKIN for the continuous sim. Sets a body class (`fsim-theme-<id>`,
// styled below) plus the canvas-instrument accent (PFD/MFD/gauges can't read CSS vars),
// so each airframe's flightdeck reads its own. No entry ⇒ the default light-cyan cabin
// (the Mayfly). The Mule is a cyberpunk carbon-fibre freighter in violet/magenta neon.
const FSIM_SKIN = {
  mule: { id: 'mule', acc: '#a874ff', rgb: [168, 116, 255] },
  leviathan: { id: 'leviathan', acc: '#3fd6c0', rgb: [63, 214, 192] },   // Soviet An-124 turquoise flightdeck
  reaper: { id: 'reaper', acc: '#ff9a38', rgb: [255, 154, 56] },   // A-10 Warthog: olive-drab armour + gunsight amber
  dragonfly: { id: 'dragonfly', acc: '#8fe36b', rgb: [143, 227, 107] },   // Mini 500: a light, exposed kit-heli bubble
};

function ensureFlightSimStyles() {
  if (document.getElementById('fsim-styles')) return;
  const s = document.createElement('style'); s.id = 'fsim-styles';
  s.textContent = `
    .fsim{ display:flex; flex-direction:column; gap:6px; font-family:var(--font,monospace); --cy:var(--accent,#8fd0ff); --mg:#ff4a9a; --gr:#5fe0a0; }
    .fsim-view{ position:relative; height:clamp(150px,26vh,300px); border-radius:8px; overflow:hidden; box-shadow:inset 0 0 0 2px #0f1c28, 0 0 12px rgba(0,0,0,.6); }
    .fsim-lamp{ position:absolute; top:8px; left:50%; transform:translateX(-50%); font:11px/1 monospace; letter-spacing:2px; z-index:3;
      color:#ff5a5b; background:rgba(40,4,6,.7); border:1px solid #ff5a5b; border-radius:5px; padding:3px 9px; opacity:0; transition:opacity .12s; }
    /* transient action toast (flap/gear/jettison confirmations) */
    .fsim-toast{ position:absolute; top:38%; left:50%; transform:translateX(-50%); font:11px/1 monospace; letter-spacing:2px; z-index:5;
      color:var(--cy); background:rgba(6,12,18,.82); border:1px solid var(--cy); border-radius:5px; padding:4px 11px; opacity:0; transition:opacity .18s; pointer-events:none; white-space:nowrap; }
    .fsim-toast.show{ opacity:1; }
    /* landing report card — big graded touchdown feedback flashed over the glass */
    .fsim-card{ position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) scale(.7); z-index:8;
      display:flex; flex-direction:column; align-items:center; gap:1px; padding:12px 26px; pointer-events:none; text-align:center;
      background:rgba(6,12,18,.86); border:1px solid #16303f; border-radius:12px; opacity:0; font-family:monospace;
      transition:opacity .3s ease, transform .3s cubic-bezier(.2,1.3,.4,1); }
    .fsim-card.show{ opacity:1; transform:translate(-50%,-50%) scale(1); }
    .fsim-card-hd{ font-size:10px; letter-spacing:3px; color:#8aa0b2; }
    .fsim-card-grade{ font-size:52px; font-weight:900; line-height:1; text-shadow:0 0 14px currentColor; }
    .fsim-card-fpm{ font-size:13px; letter-spacing:1px; color:#cfe0ee; }
    .fsim-card-txt{ font-size:11px; color:#9fb4c4; margin-top:3px; max-width:230px; }
    .fsim-card.butter .fsim-card-grade{ color:#5fe0a0; }
    .fsim-card.good .fsim-card-grade{ color:#8fd0ff; }
    .fsim-card.mid .fsim-card-grade{ color:#ffd24a; }
    .fsim-card.bad .fsim-card-grade{ color:#ff8a3a; }
    .fsim-card.crash{ border-color:#ff4a5a; }
    .fsim-card.crash .fsim-card-grade{ color:#ff4a5a; }
    /* look-direction tag (Q/E/S hold-to-look) */
    .fsim-viewtag{ position:absolute; bottom:8px; left:50%; transform:translateX(-50%); font:10px/1 monospace; letter-spacing:2px; z-index:5;
      color:var(--cy); background:rgba(6,12,18,.7); border:1px solid #16303f; border-radius:4px; padding:2px 8px; opacity:0; transition:opacity .12s; pointer-events:none; }
    .fsim-viewtag.show{ opacity:.9; }
    /* fuel chip (always shown) + a REFUEL button that appears only when parked on a fuelled strip */
    .fsim-fuel{ position:absolute; left:8px; top:22px; z-index:6; display:flex; align-items:center; gap:5px;
      font:bold 10px/1 monospace; letter-spacing:1px; color:#8fe0a8; background:rgba(6,12,18,.72);
      border:1px solid #16303f; border-radius:5px; padding:3px 7px; }
    .fsim-fuel-ic{ font-size:11px; filter:saturate(.85); }
    .fsim-fuel-pct{ min-width:30px; }
    .fsim-fuel.low .fsim-fuel-pct{ color:#ffb23e; }
    .fsim-fuel.bingo .fsim-fuel-pct{ color:#ff5b5b; }
    .fsim-refuel{ display:none; font:bold 8px/1 monospace; letter-spacing:1px; cursor:pointer; padding:4px 7px; border-radius:4px;
      background:linear-gradient(180deg,#12321f,#08160d); border:1px solid #2a6a44; color:#6fe0a0; }
    .fsim-refuel:active{ transform:translateY(1px); }
    .fsim-fuel.can-fuel .fsim-refuel{ display:inline-block; }
    .fsim-fuel.can-fuel.full .fsim-refuel{ opacity:.45; }
    /* weapons (gunship): master-arm + fire strip, and a centre gun reticle when hot */
    .fsim-weap{ position:absolute; left:8px; bottom:8px; z-index:5; display:none; align-items:center; gap:6px;
      background:rgba(10,8,6,.74); border:1px solid #3a2a12; border-radius:6px; padding:4px 6px; }
    .fsim-weap.show{ display:flex; }
    .fsim-weap-arm,.fsim-weap-fire{ font:8px/1 monospace; letter-spacing:1px; padding:5px 9px; border-radius:4px; cursor:pointer;
      background:linear-gradient(180deg,#2a2416,#14100a); border:1px solid #4a3a18; color:#c8b070; }
    .fsim-weap-arm:active,.fsim-weap-fire:active{ transform:translateY(1px); }
    .fsim-weap-arm.hot{ color:#ff6a5b; border-color:#ff5a5b; background:linear-gradient(180deg,#3a1414,#1a0a0a); box-shadow:0 0 7px rgba(255,90,91,.5); }
    .fsim-weap-fire{ color:#ff6a3a; border-color:#5a2a10; opacity:.4; pointer-events:none; }
    .fsim-weap-fire.ready{ opacity:1; pointer-events:auto; text-shadow:0 0 6px rgba(255,106,58,.6); }
    .fsim-weap-pips{ font-size:10px; color:#c8b070; letter-spacing:2px; }
    .fsim-reticle{ position:absolute; left:50%; top:46%; width:34px; height:34px; margin:-17px 0 0 -17px; z-index:4; opacity:0; transition:opacity .15s; pointer-events:none; }
    .fsim-reticle.on{ opacity:.85; }
    /* firing solution up → the pipper flips from amber to a green lock */
    .fsim-reticle.lock svg{ filter:drop-shadow(0 0 5px rgba(80,255,140,.9)) hue-rotate(96deg) saturate(1.5); }
    .fsim-reticle.lock{ opacity:1; }
    .fsim-reticle svg{ width:100%; height:100%; filter:drop-shadow(0 0 3px rgba(255,106,58,.6)); }
    /* glass panel row: PFD | MFD (Diamond DA42-inspired) */
    .fsim-glass{ display:flex; gap:6px; height:clamp(150px,23vh,212px); }
    .fsim-pfd,.fsim-mfd,.fsim-gauges{ position:relative; flex:1 1 0; background:#060c12; border:1px solid #16303f; border-radius:8px; overflow:hidden;
      box-shadow:inset 0 0 10px rgba(0,0,0,.7), 0 0 0 1px rgba(95,208,255,.08); }
    .fsim-pfd{ flex:0.6 1 0; }        /* left PFD */
    .fsim-mfd{ flex:0.6 1 0; }        /* right MFD squeezed to the SAME width as the PFD */
    .fsim-gauges{ flex:2 1 0; }       /* wide centre: gauges hug its edges, the yoke rises up its middle */
    .fsim-rightctl{ flex:0 0 140px; display:flex; gap:6px; }   /* throttle + start + flaps, to the right of the MFD */
    .fsim-pfd canvas,.fsim-mfd canvas,.fsim-gauges canvas{ width:100%; height:100%; display:block; image-rendering:pixelated; }
    .fsim-mfd-tog{ position:absolute; top:5px; right:5px; z-index:2; background:rgba(6,14,22,.8); border:1px solid var(--cy); color:var(--cy);
      border-radius:4px; font:8px monospace; padding:2px 5px; letter-spacing:1px; cursor:pointer; }
    .fsim-mfd-lbl{ position:absolute; top:6px; left:7px; z-index:2; font:8px monospace; letter-spacing:1px; color:var(--cy); opacity:.85; }
    /* controls: full yoke + throttle quadrant */
    /* control row: badge (bottom-left) | YOKE (aligned under gauges) | transponder (bottom-right) */
    .fsim-ctl{ display:flex; gap:6px; align-items:stretch; height:120px; }
    /* ── bottom-left placard: a bolted, brushed-metal maker's plate ──────────── */
    .fsim-placard{ position:relative; flex:0.6 1 0; justify-content:center; gap:3px; padding:10px 13px; overflow:hidden;
      border-radius:8px; border:1px solid #10161c;
      /* four hex-head bolts at the corners, over a brushed-metal field */
      background:
        radial-gradient(circle at 10px 10px, #d6dade 0 1.4px, #9098a0 1.4px 2.6px, #565e66 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at calc(100% - 10px) 10px, #d6dade 0 1.4px, #9098a0 1.4px 2.6px, #565e66 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at 10px calc(100% - 10px), #d6dade 0 1.4px, #9098a0 1.4px 2.6px, #565e66 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at calc(100% - 10px) calc(100% - 10px), #d6dade 0 1.4px, #9098a0 1.4px 2.6px, #565e66 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        repeating-linear-gradient(92deg, rgba(255,255,255,.035) 0 1px, rgba(0,0,0,.05) 1px 2px),
        linear-gradient(157deg, #4c545c 0%, #6b747c 22%, #3a4147 46%, #575f67 68%, #363c42 100%);
      box-shadow:inset 0 1px 0 rgba(255,255,255,.28), inset 0 -2px 5px rgba(0,0,0,.55), 0 2px 5px rgba(0,0,0,.5); }
    /* scene-reactive sheen: a diagonal glint whose opacity is driven by --sheen (bright day → 1, night → 0) */
    .fsim-plac-sheen{ position:absolute; inset:0; pointer-events:none; opacity:var(--sheen,0); transition:opacity .5s linear;
      background:linear-gradient(133deg, rgba(255,255,255,0) 30%, rgba(255,255,255,.5) 46%, rgba(255,255,255,.08) 52%, rgba(255,255,255,0) 66%); }
    .fsim-placard>*{ position:relative; z-index:1; }
    .fsim-plac-title{ font-size:8px; letter-spacing:2px; color:#20262c; text-shadow:0 1px 0 rgba(255,255,255,.3); }
    .fsim-plac-reg{ font-size:16px; font-weight:bold; letter-spacing:2px; color:#14181c; text-shadow:0 1px 0 rgba(255,255,255,.35); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .fsim-plac-own{ font-size:10px; letter-spacing:1px; color:#2a3037; text-shadow:0 1px 0 rgba(255,255,255,.25); }
    .fsim-plac-own.rented{ color:#7a3410; text-shadow:0 1px 0 rgba(255,255,255,.25); }
    /* cabin-occupancy readout: engraved label + a row of seat "LED" pips on the plate */
    .fsim-plac-seats{ display:flex; align-items:center; gap:3px; margin-top:3px; }
    .fsim-plac-seats .lbl{ font-size:8px; letter-spacing:1px; color:#20262c; text-shadow:0 1px 0 rgba(255,255,255,.28); margin-right:2px; }
    .fsim-plac-seats .pip{ width:8px; height:8px; border-radius:50%; box-shadow:inset 0 1px 1px rgba(255,255,255,.4), inset 0 -1px 1px rgba(0,0,0,.4), 0 1px 2px rgba(0,0,0,.5); }
    /* ── bottom-right radio: transponder + COM/NAV with an LCD, buttons and knobs ── */
    .fsim-xpdr{ flex:1 1 0; display:flex; flex-direction:column; gap:5px; padding:7px 9px; overflow:hidden;
      border-radius:8px; border:1px solid #161c22;
      background:linear-gradient(180deg,#20262c 0%,#161b20 48%,#0c1116 100%);
      box-shadow:inset 0 1px 0 rgba(255,255,255,.14), inset 0 -2px 6px rgba(0,0,0,.6), 0 2px 5px rgba(0,0,0,.5); }
    .fsim-xpdr-title{ font-size:8px; letter-spacing:2px; color:#5a6672; }
    .fsim-radio-lcd{ background:linear-gradient(180deg,#0a2018,#06140e); border:1px solid #0c1a14; border-radius:4px; padding:4px 6px;
      box-shadow:inset 0 0 8px rgba(0,0,0,.8); display:flex; flex-direction:column; gap:1px; }
    .fsim-radio-frow{ display:flex; align-items:baseline; gap:6px; font-family:monospace; line-height:1.15; }
    .fsim-radio-frow .k{ font-size:8px; letter-spacing:1px; color:#3e7a5e; flex:0 0 26px; }
    .fsim-radio-frow b{ font-size:13px; font-weight:bold; letter-spacing:1px; color:#57e6a0; text-shadow:0 0 5px rgba(87,230,160,.5); }
    .fsim-radio-frow i{ font-size:9px; font-style:normal; color:#2f7d5a; margin-left:auto; }
    .fsim-radio-frow.sq b{ letter-spacing:3px; }
    .fsim-radio-frow i.mode{ color:#e0b23e; text-shadow:0 0 5px rgba(224,178,62,.4); }
    .fsim-radio-frow.tgt{ align-items:center; gap:4px; }
    .fsim-radio-frow.tgt b{ font-size:9px; letter-spacing:.5px; flex:1; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .fsim-tgt-btn{ font:9px/1 monospace; color:#57e6a0; background:linear-gradient(180deg,#0e2419,#081711); border:1px solid #14322a; border-radius:3px; padding:1px 4px; cursor:pointer; flex:0 0 auto; }
    .fsim-tgt-btn:active{ transform:translateY(1px); }
    .fsim-radio-deck{ display:flex; align-items:center; justify-content:space-between; gap:6px; margin-top:auto; }
    .fsim-radio-btns{ display:grid; grid-template-columns:1fr 1fr; gap:3px; }
    .fsim-radio-btn{ font:7px/1 monospace; letter-spacing:.5px; color:#9fb0bd; padding:3px 5px; min-width:24px; cursor:pointer;
      background:linear-gradient(180deg,#2b333b,#171d23); border:1px solid #0c1116; border-radius:3px;
      box-shadow:0 1px 0 rgba(255,255,255,.12) inset, 0 2px 3px rgba(0,0,0,.5); }
    .fsim-radio-btn:active{ transform:translateY(1px); box-shadow:inset 0 2px 4px rgba(0,0,0,.6); }
    .fsim-radio-btn.on{ color:var(--cy); border-color:var(--cy); box-shadow:0 0 6px var(--cy), inset 0 1px 0 rgba(255,255,255,.1); }
    .fsim-radio-knobs{ display:flex; gap:7px; }
    .fsim-radio-knob{ position:relative; width:26px; height:26px; border-radius:50%; cursor:pointer;
      background:radial-gradient(circle at 50% 34%, #444c54, #20262c 70%, #0c1116);
      border:1px solid #0a0e12; box-shadow:0 2px 4px rgba(0,0,0,.6), inset 0 1px 1px rgba(255,255,255,.18);
      background-image:radial-gradient(circle at 50% 34%,#444c54,#20262c 70%,#0c1116), repeating-conic-gradient(from 0deg, rgba(0,0,0,.35) 0 6deg, rgba(255,255,255,.05) 6deg 12deg); }
    .fsim-radio-knob i{ position:absolute; left:50%; top:3px; width:2px; height:9px; margin-left:-1px; border-radius:1px; background:var(--cy); box-shadow:0 0 4px var(--cy); }
    /* ── panel/instrument lights toggle (dash switch) ───────────────────────── */
    .fsim-nightsw{ flex:0 0 auto; align-self:center; display:flex; align-items:center; gap:4px; padding:3px 8px; cursor:pointer; user-select:none;
      font:8px/1 monospace; letter-spacing:1.5px; color:#6f8698; border-radius:5px;
      background:linear-gradient(180deg,#141b21,#0a0f14); border:1px solid #16303f; box-shadow:inset 0 1px 0 rgba(255,255,255,.08); }
    .fsim-nightsw-led{ width:6px; height:6px; border-radius:50%; background:#243038; box-shadow:inset 0 0 2px #000; }
    .fsim-nightsw.on{ color:var(--cy); border-color:var(--cy); }
    .fsim-nightsw.on .fsim-nightsw-led{ background:var(--cy); box-shadow:0 0 6px var(--cy); }
    /* instrument night lighting: an accent wash over the glass panels + a lit edge */
    .fsim-nightlit .fsim-pfd,.fsim-nightlit .fsim-mfd,.fsim-nightlit .fsim-gauges{ box-shadow:inset 0 0 14px var(--cy-dim,rgba(95,208,255,.16)), 0 0 6px var(--cy-dim,rgba(95,208,255,.12)); border-color:var(--cy); }
    .fsim-nightlit .fsim-mfd-lbl,.fsim-nightlit .fsim-mfd-tog{ text-shadow:0 0 6px var(--cy); }
    .fsim-yoke{ position:relative; flex:2 1 0; background:radial-gradient(circle at 50% 26%,#0e1a24,#070d13); border:1px solid #16303f;
      border-radius:12px; touch-action:none; cursor:grab; overflow:visible; perspective:1000px; box-shadow:inset 0 0 14px rgba(0,0,0,.7); }
    .fsim-yoke.drag{ cursor:grabbing; }
    /* Big yoke anchored HIGH: it rises up into the centre of the gauges panel (between the
       edge gauges) and its pull-down never drags it off the bottom of the frame. */
    .fsim-yoke-svg{ position:absolute; left:17%; top:-120%; width:66%; height:194%; transform-style:preserve-3d; will-change:transform;
      transform-origin:50% 66%; pointer-events:none; filter:drop-shadow(0 7px 10px rgba(0,0,0,.65)); }
    /* aircraft name across the yoke hub, in the themed accent (per-craft, set on mount) */
    .fsim-yoke-name{ fill:var(--cy); font:bold 8px monospace; letter-spacing:.5px; }
    .fsim-climbmark{ position:absolute; left:10%; right:10%; top:66%; height:0; border-top:1px dashed rgba(95,224,160,0.55); pointer-events:none; }
    .fsim-climbmark::after{ content:'BEST CLIMB'; position:absolute; right:1px; top:-9px; font-size:7px; letter-spacing:1px; color:var(--gr); }
    .fsim-throttle{ position:relative; flex:0 0 56px; background:linear-gradient(180deg,#0c141c,#080e14); border:1px solid #16303f;
      border-radius:10px; touch-action:none; cursor:ns-resize; overflow:hidden; }
    .fsim-thr-slot{ position:absolute; left:50%; top:12px; bottom:22px; width:8px; margin-left:-4px; background:#04080c; border:1px solid #16303f; border-radius:4px; box-shadow:inset 0 0 4px #000; }
    .fsim-thr-notch{ position:absolute; left:8px; width:7px; height:1px; background:rgba(120,150,175,.4); }
    .fsim-thr-lever{ position:absolute; left:6px; right:6px; height:20px; }
    .fsim-thr-grip{ position:absolute; inset:0; border-radius:6px; background:linear-gradient(180deg,#3a6f8f 0%,#1a3d52 55%,#0e2130 100%);
      border:1px solid var(--cy); box-shadow:0 2px 6px rgba(0,0,0,.6), inset 0 1px 2px rgba(255,255,255,.35); }
    .fsim-thr-grip::after{ content:''; position:absolute; left:22%; right:22%; top:8px; height:4px; background:repeating-linear-gradient(90deg,#0e2130 0 2px,rgba(95,208,255,.25) 2px 4px); }
    .fsim-thr-val{ position:absolute; bottom:4px; left:0; right:0; text-align:center; font:9px monospace; color:var(--cy); }
    .fsim-side{ flex:1 1 auto; display:flex; flex-direction:column; gap:8px; align-items:stretch; }
    /* engine master: a round accent button with a power glyph that recesses when running */
    .fsim-engbtn{ flex:0 0 auto; align-self:center; width:52px; height:52px; border-radius:50%; border:2px solid var(--cy); color:var(--cy);
      background:radial-gradient(circle at 50% 34%,#0e2230,#06121c); font-size:22px; line-height:1; cursor:pointer; user-select:none;
      display:flex; align-items:center; justify-content:center; box-shadow:0 3px 0 rgba(0,0,0,.55), 0 5px 9px rgba(0,0,0,.5); transition:transform .09s, box-shadow .09s, text-shadow .12s; }
    .fsim-engbtn:active{ transform:translateY(2px); }
    .fsim-engbtn.on{ transform:translateY(3px); box-shadow:inset 0 3px 9px rgba(0,0,0,.85); text-shadow:0 0 10px var(--cy); }
    /* flaps: a 3-position switch (UP / ½ / FULL) — click the track to snap to a detent */
    .fsim-flapsw{ flex:1 1 auto; display:flex; gap:7px; align-items:stretch; }
    .fsim-flapsw-track{ position:relative; flex:0 0 20px; background:#04080c; border:1px solid #16303f; border-radius:6px; cursor:pointer; box-shadow:inset 0 0 5px #000; touch-action:none; }
    .fsim-flapsw-knob{ position:absolute; left:2px; right:2px; height:28%; top:2%; border-radius:4px; background:linear-gradient(180deg,#d6e8f5,#7f9bb0); box-shadow:0 2px 5px rgba(0,0,0,.6); transition:top .12s; }
    .fsim-flapsw-lbls{ flex:1 1 auto; display:flex; flex-direction:column; justify-content:space-between; font:9px monospace; letter-spacing:1px; color:#6f8698; padding:1px 0; }
    .fsim-flapsw-lbls span.on{ color:var(--cy); text-shadow:0 0 5px var(--cy); }
    .fsim-tunebtn{ position:absolute; top:6px; right:8px; z-index:4; background:rgba(6,12,18,.7); border:1px solid #16303f; color:var(--cy);
      border-radius:6px; width:24px; height:22px; font-size:12px; line-height:1; cursor:pointer; }
    .fsim-fsbtn{ position:absolute; top:6px; right:36px; z-index:4; background:rgba(6,12,18,.7); border:1px solid #16303f; color:var(--cy);
      border-radius:6px; width:24px; height:22px; font-size:13px; line-height:1; cursor:pointer; }
    .fsim-fsbtn.on{ background:var(--cy); color:#05141f; border-color:var(--cy); }
    .fsim-hidebtn{ position:absolute; top:6px; right:64px; z-index:4; background:rgba(6,12,18,.7); border:1px solid #16303f; color:var(--cy);
      border-radius:6px; width:24px; height:22px; font-size:12px; line-height:1; cursor:pointer; }
    .fsim-hidebtn.on{ background:var(--cy); color:#05141f; border-color:var(--cy); }
    .fsim-tune{ position:absolute; top:32px; right:8px; z-index:4; width:186px; max-height:72vh; overflow-y:auto; overscroll-behavior:contain; background:rgba(8,14,20,.94); border:1px solid #14212d; border-radius:8px; padding:8px; }
    .fsim-tune .thdr{ font-size:9px; letter-spacing:1px; color:var(--cy); border-bottom:1px solid #16303f; padding-bottom:3px; margin:2px 0 6px; position:sticky; top:-8px; background:rgba(8,14,20,.98); }
    .fsim-tune .thdr:not(:first-child){ margin-top:9px; }
    .fsim-tune .trow{ display:flex; align-items:center; gap:5px; margin-bottom:5px; font-size:9px; }
    .fsim-tune .trow label{ flex:0 0 64px; color:#6f8698; letter-spacing:.5px; }
    .fsim-tune .trow input{ flex:1; min-width:0; }
    .fsim-tune .tv{ flex:0 0 34px; text-align:right; color:var(--cy); font-variant-numeric:tabular-nums; }

    /* ══ MULE flightdeck skin — a Grand-Caravan-scale glass cockpit, but cyberpunk: ══
       carbon-fibre chrome, violet+magenta neon, an aggressive glareshield. All the
       var(--cy) chrome (radios, knobs, engine master, throttle, night wash, MFD labels)
       retints for free; below we reskin the hard panels off the brushed-steel/tan look. */
    .fsim-theme-mule{ --cy:#a874ff; --mg:#ff4a9a; --gr:#7dff9e; --cy-dim:rgba(168,116,255,.20); }
    /* deeper glass bezels + a violet-lit windshield surround */
    .fsim-theme-mule .fsim-view{ box-shadow:inset 0 0 0 2px #2a1840, inset 0 4px 20px rgba(168,116,255,.14), 0 0 14px rgba(0,0,0,.72); }
    /* glareshield lip: a dark carbon brow across the top of the forward view */
    .fsim-theme-mule .fsim-view::after{ content:''; position:absolute; left:0; right:0; top:0; height:15px; z-index:2; pointer-events:none;
      background:linear-gradient(180deg,#151019 0%,#0c0a10 58%,rgba(12,10,16,0) 100%); border-bottom:1px solid rgba(168,116,255,.4); box-shadow:0 1px 9px rgba(168,116,255,.28); }
    .fsim-theme-mule .fsim-pfd,.fsim-theme-mule .fsim-mfd,.fsim-theme-mule .fsim-gauges{ border-color:#3a2a5a; box-shadow:inset 0 0 10px rgba(0,0,0,.78), 0 0 0 1px rgba(168,116,255,.16); }
    /* maker's plate → carbon-fibre weave with a violet etch (kills the brushed-steel tan) */
    .fsim-theme-mule .fsim-placard{ border-color:#241832;
      background:
        radial-gradient(circle at 10px 10px, #b79bff 0 1.4px, #6a52a0 1.4px 2.6px, #34285a 2.6px 3.6px, rgba(0,0,0,.55) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at calc(100% - 10px) 10px, #b79bff 0 1.4px, #6a52a0 1.4px 2.6px, #34285a 2.6px 3.6px, rgba(0,0,0,.55) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at 10px calc(100% - 10px), #b79bff 0 1.4px, #6a52a0 1.4px 2.6px, #34285a 2.6px 3.6px, rgba(0,0,0,.55) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at calc(100% - 10px) calc(100% - 10px), #b79bff 0 1.4px, #6a52a0 1.4px 2.6px, #34285a 2.6px 3.6px, rgba(0,0,0,.55) 3.6px 4.4px, transparent 4.6px),
        repeating-linear-gradient(45deg, rgba(168,116,255,.06) 0 3px, rgba(0,0,0,.30) 3px 6px),
        repeating-linear-gradient(-45deg, rgba(255,255,255,.03) 0 3px, rgba(0,0,0,.24) 3px 6px),
        linear-gradient(157deg,#171122 0%,#241738 42%,#120c1c 100%);
      box-shadow:inset 0 1px 0 rgba(168,116,255,.24), inset 0 -2px 6px rgba(0,0,0,.62), 0 2px 5px rgba(0,0,0,.5); }
    .fsim-theme-mule .fsim-plac-title{ color:#a874ff; text-shadow:0 0 6px rgba(168,116,255,.5); }
    .fsim-theme-mule .fsim-plac-reg{ color:#ece2ff; text-shadow:0 0 9px rgba(168,116,255,.5); }
    .fsim-theme-mule .fsim-plac-own{ color:#9686bc; text-shadow:none; }
    .fsim-theme-mule .fsim-plac-own.rented{ color:#ff4a9a; text-shadow:0 0 6px rgba(255,74,154,.4); }
    /* the day-sheen glint reads violet on the carbon */
    .fsim-theme-mule .fsim-plac-sheen{ background:linear-gradient(133deg, rgba(184,150,255,0) 30%, rgba(184,150,255,.42) 46%, rgba(184,150,255,.06) 52%, rgba(184,150,255,0) 66%); }
    /* radio/transponder deck → carbon */
    .fsim-theme-mule .fsim-xpdr{ border-color:#241832; background:linear-gradient(180deg,#1c1428 0%,#140e1e 48%,#0a0710 100%); box-shadow:inset 0 1px 0 rgba(168,116,255,.16), inset 0 -2px 6px rgba(0,0,0,.62), 0 2px 5px rgba(0,0,0,.5); }
    .fsim-theme-mule .fsim-xpdr-title{ color:#8a6ab0; }
    /* yoke well + throttle body → carbon-violet, grip goes neon */
    .fsim-theme-mule .fsim-yoke{ border-color:#3a2a5a; background:radial-gradient(circle at 50% 26%,#1b1230,#0a0712); }
    .fsim-theme-mule .fsim-throttle{ border-color:#3a2a5a; background:linear-gradient(180deg,#161028,#0a0712); }
    .fsim-theme-mule .fsim-thr-grip{ background:linear-gradient(180deg,#8a5ae0 0%,#3f1f74 55%,#1a0e30 100%); }
    .fsim-theme-mule .fsim-thr-grip::after{ background:repeating-linear-gradient(90deg,#1a0e30 0 2px,rgba(168,116,255,.32) 2px 4px); }

    /* ══ LEVIATHAN flightdeck skin — an Antonov An-124 Ruslan: the iconic Soviet turquoise ══
       instrument panels, riveted alloy plates, a deep teal glow. Utilitarian, vast, brutal. */
    .fsim-theme-leviathan{ --cy:#3fd6c0; --mg:#ff8a3a; --gr:#8dffb4; --cy-dim:rgba(63,214,192,.20); }
    .fsim-theme-leviathan .fsim-view{ box-shadow:inset 0 0 0 2px #123a34, inset 0 4px 20px rgba(63,214,192,.13), 0 0 14px rgba(0,0,0,.72); }
    /* glareshield lip: a dark brow with a teal-lit sill */
    .fsim-theme-leviathan .fsim-view::after{ content:''; position:absolute; left:0; right:0; top:0; height:15px; z-index:2; pointer-events:none;
      background:linear-gradient(180deg,#0e1a18 0%,#081210 58%,rgba(8,18,16,0) 100%); border-bottom:1px solid rgba(63,214,192,.4); box-shadow:0 1px 9px rgba(63,214,192,.26); }
    .fsim-theme-leviathan .fsim-pfd,.fsim-theme-leviathan .fsim-mfd,.fsim-theme-leviathan .fsim-gauges{ border-color:#1f4a43; box-shadow:inset 0 0 10px rgba(0,0,0,.78), 0 0 0 1px rgba(63,214,192,.16); }
    /* maker's plate → riveted turquoise alloy (a stamped Soviet data plate) */
    .fsim-theme-leviathan .fsim-placard{ border-color:#123330;
      background:
        radial-gradient(circle at 10px 10px, #cdd6d2 0 1.4px, #8f9a96 1.4px 2.6px, #4a5652 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at calc(100% - 10px) 10px, #cdd6d2 0 1.4px, #8f9a96 1.4px 2.6px, #4a5652 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at 10px calc(100% - 10px), #cdd6d2 0 1.4px, #8f9a96 1.4px 2.6px, #4a5652 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at calc(100% - 10px) calc(100% - 10px), #cdd6d2 0 1.4px, #8f9a96 1.4px 2.6px, #4a5652 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        repeating-linear-gradient(92deg, rgba(190,230,220,.05) 0 1px, rgba(0,0,0,.06) 1px 2px),
        linear-gradient(157deg,#264c46 0%,#315a52 22%,#1e3d38 46%,#2b514a 68%,#173029 100%);
      box-shadow:inset 0 1px 0 rgba(190,230,220,.22), inset 0 -2px 5px rgba(0,0,0,.55), 0 2px 5px rgba(0,0,0,.5); }
    .fsim-theme-leviathan .fsim-plac-title{ color:#0c211d; text-shadow:0 1px 0 rgba(180,230,220,.32); }
    .fsim-theme-leviathan .fsim-plac-reg{ color:#08110f; text-shadow:0 1px 0 rgba(180,230,220,.38); }
    .fsim-theme-leviathan .fsim-plac-own{ color:#1c3833; text-shadow:0 1px 0 rgba(180,230,220,.22); }
    .fsim-theme-leviathan .fsim-plac-own.rented{ color:#b0500f; text-shadow:0 1px 0 rgba(180,230,220,.22); }
    .fsim-theme-leviathan .fsim-plac-sheen{ background:linear-gradient(133deg, rgba(180,240,228,0) 30%, rgba(180,240,228,.4) 46%, rgba(180,240,228,.06) 52%, rgba(180,240,228,0) 66%); }
    /* radio/transponder deck → turquoise alloy */
    .fsim-theme-leviathan .fsim-xpdr{ border-color:#123330; background:linear-gradient(180deg,#274c46 0%,#1a3833 48%,#0e211d 100%); box-shadow:inset 0 1px 0 rgba(63,214,192,.16), inset 0 -2px 6px rgba(0,0,0,.6), 0 2px 5px rgba(0,0,0,.5); }
    .fsim-theme-leviathan .fsim-xpdr-title{ color:#5aa89a; }
    /* yoke well + throttle body → turquoise-grey, grip goes teal */
    .fsim-theme-leviathan .fsim-yoke{ border-color:#1f4a43; background:radial-gradient(circle at 50% 26%,#173832,#0a1210); }
    .fsim-theme-leviathan .fsim-throttle{ border-color:#1f4a43; background:linear-gradient(180deg,#153230,#0a1210); }
    .fsim-theme-leviathan .fsim-thr-grip{ background:linear-gradient(180deg,#3fd6c0 0%,#1d7a6c 55%,#0e302b 100%); }
    .fsim-theme-leviathan .fsim-thr-grip::after{ background:repeating-linear-gradient(90deg,#0e302b 0 2px,rgba(63,214,192,.32) 2px 4px); }

    /* ══ REAPER flightdeck skin — a Fairchild A-10 Warthog: olive-drab armour plate, ══
       gunmetal, gunsight-amber instruments, a red master-arm. Built around the gun. */
    .fsim-theme-reaper{ --cy:#ff9a38; --mg:#ff4a3a; --gr:#8de24a; --cy-dim:rgba(255,154,56,.20); }
    .fsim-theme-reaper .fsim-view{ box-shadow:inset 0 0 0 2px #2e2a16, inset 0 4px 20px rgba(255,154,56,.12), 0 0 14px rgba(0,0,0,.72); }
    .fsim-theme-reaper .fsim-view::after{ content:''; position:absolute; left:0; right:0; top:0; height:15px; z-index:2; pointer-events:none;
      background:linear-gradient(180deg,#171509 0%,#0f0d06 58%,rgba(15,13,6,0) 100%); border-bottom:1px solid rgba(255,154,56,.4); box-shadow:0 1px 9px rgba(255,154,56,.26); }
    .fsim-theme-reaper .fsim-pfd,.fsim-theme-reaper .fsim-mfd,.fsim-theme-reaper .fsim-gauges{ border-color:#4a4426; box-shadow:inset 0 0 10px rgba(0,0,0,.78), 0 0 0 1px rgba(255,154,56,.16); }
    /* maker's plate → olive-drab armour plate w/ steel bolts (mil-spec stencil) */
    .fsim-theme-reaper .fsim-placard{ border-color:#33301a;
      background:
        radial-gradient(circle at 10px 10px, #cdd0c2 0 1.4px, #909480 1.4px 2.6px, #52543e 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at calc(100% - 10px) 10px, #cdd0c2 0 1.4px, #909480 1.4px 2.6px, #52543e 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at 10px calc(100% - 10px), #cdd0c2 0 1.4px, #909480 1.4px 2.6px, #52543e 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at calc(100% - 10px) calc(100% - 10px), #cdd0c2 0 1.4px, #909480 1.4px 2.6px, #52543e 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        repeating-linear-gradient(92deg, rgba(210,220,180,.04) 0 1px, rgba(0,0,0,.06) 1px 2px),
        linear-gradient(157deg,#3a3a22 0%,#454528 22%,#2c2c18 46%,#3f3f24 68%,#212112 100%);
      box-shadow:inset 0 1px 0 rgba(210,220,180,.18), inset 0 -2px 5px rgba(0,0,0,.55), 0 2px 5px rgba(0,0,0,.5); }
    .fsim-theme-reaper .fsim-plac-title{ color:#1a1808; text-shadow:0 1px 0 rgba(210,220,180,.28); }
    .fsim-theme-reaper .fsim-plac-reg{ color:#100e04; text-shadow:0 1px 0 rgba(210,220,180,.32); }
    .fsim-theme-reaper .fsim-plac-own{ color:#33301a; text-shadow:0 1px 0 rgba(210,220,180,.2); }
    .fsim-theme-reaper .fsim-plac-own.rented{ color:#b03010; text-shadow:0 1px 0 rgba(210,220,180,.2); }
    .fsim-theme-reaper .fsim-plac-sheen{ background:linear-gradient(133deg, rgba(255,210,150,0) 30%, rgba(255,210,150,.36) 46%, rgba(255,210,150,.06) 52%, rgba(255,210,150,0) 66%); }
    .fsim-theme-reaper .fsim-xpdr{ border-color:#33301a; background:linear-gradient(180deg,#3a3a22 0%,#26260f 48%,#141406 100%); box-shadow:inset 0 1px 0 rgba(255,154,56,.14), inset 0 -2px 6px rgba(0,0,0,.6), 0 2px 5px rgba(0,0,0,.5); }
    .fsim-theme-reaper .fsim-xpdr-title{ color:#b08a4a; }
    .fsim-theme-reaper .fsim-yoke{ border-color:#4a4426; background:radial-gradient(circle at 50% 26%,#2a2814,#0f0d06); }
    .fsim-theme-reaper .fsim-throttle{ border-color:#4a4426; background:linear-gradient(180deg,#26260f,#0f0d06); }
    .fsim-theme-reaper .fsim-thr-grip{ background:linear-gradient(180deg,#ff9a38 0%,#8a5210 55%,#301c08 100%); }
    .fsim-theme-reaper .fsim-thr-grip::after{ background:repeating-linear-gradient(90deg,#301c08 0 2px,rgba(255,154,56,.32) 2px 4px); }`;
  document.head.appendChild(s);
}

// A full control yoke (cyberpunk-industrial): a horned control wheel with side grips
// and a lit centre boss. It's transformed live (roll + a 3-D pull toward/away) in the
// frame loop so the wheel feels like it's coming toward you as you pull back.
// Cessna-Caravan-style control yoke: rounded ram-horn wheel sweeping out to two chunky
// grips (PTT/trim nubs on top), a coiled cable dropping from the column, and a central
// hub placard carrying the aircraft name in the themed accent colour (`#fsim-yoke-name`,
// set per-craft on mount). The green/red centre LEDs (best-climb / stall) are retained.
const YOKE_SVG = `<svg class="fsim-yoke-svg" id="fsim-yoke-svg" viewBox="0 0 100 74" preserveAspectRatio="xMidYMid meet">
  <defs>
    <linearGradient id="ykblk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3d42"/><stop offset="0.16" stop-color="#191b1f"/><stop offset="0.6" stop-color="#0c0d10"/><stop offset="1" stop-color="#050506"/></linearGradient>
    <linearGradient id="ykgr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2e34"/><stop offset="0.14" stop-color="#131418"/><stop offset="1" stop-color="#040405"/></linearGradient>
    <linearGradient id="ykhub" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2d33"/><stop offset="0.5" stop-color="#141519"/><stop offset="1" stop-color="#090a0c"/></linearGradient>
    <radialGradient id="ykgloss" cx="0.4" cy="0.18" r="0.75"><stop offset="0" stop-color="rgba(255,255,255,0.32)"/><stop offset="0.45" stop-color="rgba(255,255,255,0.04)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/></radialGradient>
    <radialGradient id="ykgreen" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#9dffc8"/><stop offset="0.5" stop-color="#3ad07a"/><stop offset="1" stop-color="#0d3a22"/></radialGradient>
    <radialGradient id="ykblue" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#cfeeff"/><stop offset="0.5" stop-color="#3aa8e0"/><stop offset="1" stop-color="#0b2a3c"/></radialGradient>
    <radialGradient id="ykred" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffb6b8"/><stop offset="0.5" stop-color="#e0403a"/><stop offset="1" stop-color="#3a0d0d"/></radialGradient>
  </defs>
  <!-- coiled control cable dropping from the column -->
  <path d="M50,52 q7,3.5 0,7 q-7,3.5 0,7 q7,3.5 0,7" fill="none" stroke="#0b0c0f" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M50,52 q7,3.5 0,7 q-7,3.5 0,7 q7,3.5 0,7" fill="none" stroke="#22242a" stroke-width="1.1" stroke-linecap="round"/>
  <!-- column stub -->
  <rect x="45" y="44" width="10" height="12" rx="3.5" fill="url(#ykblk)" stroke="#000" stroke-width="0.5"/>
  <!-- ram-horn wheel: sweeps up and out to the grips -->
  <path d="M11,45 Q7,21 25,17 Q39,12 50,18 Q61,12 75,17 Q93,21 89,45 L80,45 Q83,27 66,23 Q58,20 50,26 Q42,20 34,23 Q17,27 20,45 Z" fill="url(#ykblk)" stroke="#000" stroke-width="0.8"/>
  <!-- rounded grips + PTT/trim nubs on top -->
  <rect x="6" y="38" width="17" height="29" rx="8" fill="url(#ykgr)" stroke="#000" stroke-width="0.8"/>
  <rect x="77" y="38" width="17" height="29" rx="8" fill="url(#ykgr)" stroke="#000" stroke-width="0.8"/>
  <rect x="9" y="33.5" width="11" height="6" rx="2" fill="#191b1f" stroke="#000" stroke-width="0.4"/>
  <rect x="80" y="33.5" width="11" height="6" rx="2" fill="#191b1f" stroke="#000" stroke-width="0.4"/>
  <path d="M11,45 Q7,21 25,17 Q39,12 50,18 Q61,12 75,17 Q93,21 89,45 L80,45 Q83,27 66,23 Q58,20 50,26 Q42,20 34,23 Q17,27 20,45 Z" fill="url(#ykgloss)"/>
  <!-- centre hub placard: aircraft name (accent) over the status LEDs -->
  <rect x="31" y="25" width="38" height="24" rx="4" fill="url(#ykhub)" stroke="#2c2f35" stroke-width="0.7"/>
  <rect x="32" y="26" width="36" height="22" rx="3.4" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="0.5"/>
  <text id="fsim-yoke-name" class="fsim-yoke-name" x="50" y="35.5" text-anchor="middle" textLength="30" lengthAdjust="spacingAndGlyphs">MULE</text>
  <circle id="fsim-yk-green" cx="44.5" cy="43" r="2.7" fill="url(#ykgreen)" opacity="0.2"/>
  <circle id="fsim-yk-red" cx="55.5" cy="43" r="2.7" fill="url(#ykred)" opacity="0.2"/>
</svg>`;

// Cabin-occupancy readout on the aircraft placard: one pip per seat — pilot in the accent,
// riders in green, empty seats dim — with a hover title naming who's aboard.
function renderSeats(F) {
  const el = document.getElementById('fsim-seats'); if (!el) return;
  const list = (F.occupants && F.occupants.length) ? F.occupants : new Array(Math.max(1, F.seats || 1)).fill(null);
  const occ = list.filter(Boolean).length;
  let html = `<span class="lbl">CABIN ${occ}/${list.length}</span>`;
  list.forEach((seat, i) => {
    const role = seat && seat.role, who = i === 0 ? 'Pilot' : 'Seat ' + (i + 1);
    const col = role === 'pilot' ? 'var(--cy)' : role === 'pax' ? 'var(--gr)' : 'rgba(120,132,144,.28)';
    html += `<span class="pip" style="background:${col}" title="${esc(who + ': ' + (seat ? seat.name : 'empty'))}"></span>`;
  });
  el.innerHTML = html;
}

export function openFlightSim(opts = {}) {
  closeFlightSim();          // clear any prior
  closeCockpit();            // stop the glass HUD loop; the continuous cockpit owns the pane
  suppressWeatherFx(true);   // kill the outdoor overlay immediately so rain never flashes over the cockpit on embark
  ensureWindshieldStyles(); ensureFlightSimStyles(); refreshAccent();
  const skin = FSIM_SKIN[opts.craftType] || null;   // per-craft flightdeck theme
  if (skin) { ACCENT = skin.acc; ACCENT_RGB = skin.rgb; }   // retint the canvas instruments to match the CSS chrome
  const P = TYPES[opts.craftType] || TYPES.mayfly;
  const s = createState(P);
  s.heading = (((opts.heading || 0) % 360) + 360) % 360;

  const F = {
    P, s, cls: opts.craftClass || 'ultralight',
    input: { elevator: 0, aileron: 0, throttle: 0, flaps: 0, pedal: 0 },
    // A helicopter (Dragonfly/Mini 500) flies the hover model: the throttle lever is the
    // COLLECTIVE, the yoke is the CYCLIC, and Q/E work the tail-rotor PEDALS (yaw). heli flag
    // drives the control remap + instrument set below.
    heli: opts.craftClass === 'heli' || !!(TYPES[opts.craftType] && TYPES[opts.craftType].heli),
    pedalKey: 0,
    pos: { x: opts.gx || 0, y: opts.gy || 0 },
    mapCenter: { x: Math.round(opts.gx || 0), y: Math.round(opts.gy || 0) }, rollDist: 0, travel: 0,
    rwOrigin: { x: opts.gx || 0, y: opts.gy || 0 }, rwHdg: (((opts.heading || 0) % 360) + 360) % 360,   // world-fixed departure runway anchor
    airport: opts.airport || 'default',
    reg: opts.registration || (opts.deviceName || 'MAYFLY').toUpperCase(), owner: opts.owner || 'RENTED',
    fuel: opts.fuel ?? 100, fuelCap: opts.fuelCap || 100, warn: null,
    map: opts.map || null, sky: opts.sky || { hour: 12, weather: 'clear', wind: 0 }, biomeBelow: opts.biomeBelow ?? null,
    minimap: opts.minimap || null, mfdMode: 'local', fields: opts.fields || [],
    deadStick: false, reportedAirborne: false, rolling: false, stopHinted: false,
    engineOn: !!opts.engineOn,
    yokeDrag: false, thrDrag: false,
    viewYaw: 0, throttleKey: 0, flapIdx: 0,          // keyboard: hold-to-look yaw, A/Z throttle ramp, flap detent
    gearRetract: !!opts.gearRetract, gearUp: false, cargoKg: opts.cargoKg || 0,   // gear (G) + jettison (J) — capabilities per airframe (Mayfly: none)
    hardpoints: opts.hardpoints || 0, armed: false,  // weapons (gunship): master-arm + fire
    nightLight: false,                               // instrument panel lights (PANEL switch)
    raf: 0, last: 0, syncAcc: 0, hornBeat: 0, audioAcc: 0,
    temp: 40, battery: 100,          // cosmetic engine-temp (°C) + battery charge (%) for the gauge cluster
    engines: Math.max(1, opts.engines || 1), seats: Math.max(1, opts.seats || 1), occupants: opts.occupants || [],
    // Powerplant class → engine-instrument labelling/scales (piston RPM · turboprop TQ/ITT ·
    // turbofan N1/EGT). Mule = twin turboprop; Reaper (A-10/TF34) + Leviathan (An-124) = jets.
    engStyle: { mule: 'turboprop', reaper: 'turbofan', leviathan: 'turbofan', dragonfly: 'heli' }[opts.craftType] || 'piston',
    temps: [], rpms: [], engWander: 0,   // per-engine gauge state (twins get 2 RPM + 2 temp dials)

    disp: { ias: 0, alt: 0, vs: 0, hdg: s.heading, rpm: 0, pitch: 0, bank: 0 },
    contacts: [],   // air-to-air traffic, refreshed by flight_contacts
    gunSolution: null, firing: false, hull: 100, hitFlashT: 0,   // Phase B: guns + battle damage
    listeners: [],
  };
  _fsim = F;

  const html = `<div id="fsim-root" class="fsim${skin ? ' fsim-theme-' + skin.id : ''}">
    <div class="fsim-view">${windshieldHTML('fsim-ws', 'FWD VIEW · ' + esc((opts.deviceName || P.name).toUpperCase()))}<div class="fsim-lamp" id="fsim-lamp">⚠ STALL</div><div class="fsim-toast" id="fsim-toast"></div><div class="fsim-viewtag" id="fsim-viewtag"></div><div class="fsim-fuel" id="fsim-fuel"><span class="fsim-fuel-ic">⛽</span><span class="fsim-fuel-pct" id="fsim-fuel-pct">--%</span><button class="fsim-refuel" id="fsim-refuel" title="refuel at this field" tabindex="-1">REFUEL</button></div><div class="fsim-reticle" id="fsim-reticle"><svg viewBox="0 0 34 34"><circle cx="17" cy="17" r="12" fill="none" stroke="#ff6a3a" stroke-width="1"/><line x1="17" y1="1" x2="17" y2="7" stroke="#ff6a3a"/><line x1="17" y1="27" x2="17" y2="33" stroke="#ff6a3a"/><line x1="1" y1="17" x2="7" y2="17" stroke="#ff6a3a"/><line x1="27" y1="17" x2="33" y2="17" stroke="#ff6a3a"/><circle cx="17" cy="17" r="1.5" fill="#ff6a3a"/></svg></div><div class="fsim-weap" id="fsim-weap"><button class="fsim-weap-arm" id="fsim-arm" tabindex="-1">◈ SAFE</button><button class="fsim-weap-fire" id="fsim-fire" tabindex="-1">FIRE</button><span class="fsim-weap-pips" id="fsim-weap-pips"></span></div><button class="fsim-fsbtn" id="fsim-fsbtn" title="fullscreen">⛶</button><button class="fsim-hidebtn" id="fsim-hidebtn" title="hide the text panel — more outside view">⊟</button><button class="fsim-tunebtn" id="fsim-tunebtn" title="render tuning">⚙</button><div class="fsim-tune" id="fsim-tune" style="display:none"></div></div>
    <div class="fsim-glass">
      <div class="fsim-pfd"><canvas id="fsim-pfd"></canvas></div>
      <div class="fsim-gauges"><canvas id="fsim-gauges"></canvas></div>
      <div class="fsim-mfd"><canvas id="fsim-mfd"></canvas><span class="fsim-mfd-lbl" id="fsim-mfd-lbl">LOCAL</span><button class="fsim-mfd-tog" id="fsim-mfd-tog">NAV ▸</button></div>
      <div class="fsim-rightctl">
        <div class="fsim-throttle" id="fsim-thr">
          <div class="fsim-thr-slot"></div>
          <div class="fsim-thr-notch" style="top:16px"></div><div class="fsim-thr-notch" style="top:42%"></div><div class="fsim-thr-notch" style="bottom:28px"></div>
          <div class="fsim-thr-lever" id="fsim-thr-lever"><div class="fsim-thr-grip"></div></div>
          <span class="fsim-thr-val" id="fsim-thrv">0%</span>
        </div>
        <div class="fsim-side">
          <button class="fsim-engbtn" id="fsim-eng" title="engine master">⏻</button>
          <button class="fsim-nightsw" id="fsim-nightsw" title="instrument panel lights" tabindex="-1"><span class="fsim-nightsw-led"></span>PANEL</button>
          <div class="fsim-flapsw">
            <div class="fsim-flapsw-track" id="fsim-flapsw-track"><div class="fsim-flapsw-knob" id="fsim-flapsw-knob"></div></div>
            <div class="fsim-flapsw-lbls"><span class="on">UP</span><span>½</span><span>FULL</span></div>
          </div>
        </div>
      </div>
    </div>
    <div class="fsim-ctl">
      <div class="fsim-placard">
        <div class="fsim-plac-sheen" id="fsim-plac-sheen"></div>
        <div class="fsim-plac-title">◈ AIRCRAFT</div>
        <div class="fsim-plac-reg" id="fsim-reg">—</div>
        <div class="fsim-plac-own" id="fsim-own">—</div>
        <div class="fsim-plac-seats" id="fsim-seats"></div>
      </div>
      <div class="fsim-yoke" id="fsim-yoke">${YOKE_SVG}</div>
      <div class="fsim-xpdr">
        <div class="fsim-xpdr-title">XPDR · COM/NAV</div>
        <div class="fsim-radio-lcd">
          <div class="fsim-radio-frow"><span class="k">COM</span><b>118.00</b><i>121.50</i></div>
          <div class="fsim-radio-frow"><span class="k">NAV</span><b>112.30</b><i>110.90</i></div>
          <div class="fsim-radio-frow sq"><span class="k">SQWK</span><b id="fsim-sq">1200</b><i class="mode">ALT</i></div>
          <div class="fsim-radio-frow"><span class="k">TILE</span><b id="fsim-tile" style="font-size:9px;letter-spacing:0;">—</b></div>
          <div class="fsim-radio-frow tgt"><span class="k">TGT</span><button class="fsim-tgt-btn" id="fsim-tgt-prev" title="previous field ([)" tabindex="-1">◂</button><b id="fsim-tgt-name">—</b><button class="fsim-tgt-btn" id="fsim-tgt-next" title="next field (])" tabindex="-1">▸</button></div>
        </div>
        <div class="fsim-radio-deck">
          <div class="fsim-radio-btns">
            <button class="fsim-radio-btn" tabindex="-1">SBY</button>
            <button class="fsim-radio-btn on" tabindex="-1">ALT</button>
            <button class="fsim-radio-btn" tabindex="-1">↔</button>
            <button class="fsim-radio-btn" tabindex="-1">ID</button>
          </div>
          <div class="fsim-radio-knobs">
            <span class="fsim-radio-knob" title="COM"><i></i></span>
            <span class="fsim-radio-knob" title="NAV"><i></i></span>
          </div>
        </div>
      </div>
    </div>
  </div>`;
  setAreaPane(html);
  const root = document.getElementById('fsim-root');
  if (!root) { _fsim = null; return; }
  const q = (sel) => root.querySelector(sel);
  const add = (t, ty, fn, op) => { if (!t) return; t.addEventListener(ty, fn, op); F.listeners.push([t, ty, fn, op]); };

  // Yoke — 2D pad, springs to centre. Physically inverted: drag DOWN = pull = nose up.
  const pad = q('#fsim-yoke');
  const padTo = (e) => { const r = pad.getBoundingClientRect(); F.input.aileron = clampNum(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1); F.input.elevator = clampNum(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1); };
  add(pad, 'pointerdown', (e) => { F.yokeDrag = true; pad.classList.add('drag'); try { pad.setPointerCapture(e.pointerId); } catch {} padTo(e); });
  add(pad, 'pointermove', (e) => { if (F.yokeDrag) padTo(e); });
  add(window, 'pointerup', () => { F.yokeDrag = false; pad.classList.remove('drag'); });

  // Throttle — vertical lever, holds where you leave it.
  const thr = q('#fsim-thr');
  const thrTo = (e) => { const r = thr.getBoundingClientRect(); F.input.throttle = clampNum(1 - (e.clientY - r.top) / r.height, 0, 1); };
  add(thr, 'pointerdown', (e) => { F.thrDrag = true; try { thr.setPointerCapture(e.pointerId); } catch {} thrTo(e); });
  add(thr, 'pointermove', (e) => { if (F.thrDrag) thrTo(e); });
  add(window, 'pointerup', () => { F.thrDrag = false; });

  // Aircraft placard (bottom-left): registration + owner (RENTED if none).
  const regEl = q('#fsim-reg'), ownEl = q('#fsim-own');
  if (regEl) regEl.textContent = F.reg;
  if (ownEl) { ownEl.textContent = F.owner; ownEl.classList.toggle('rented', F.owner === 'RENTED'); }
  // Stamp the aircraft name across the yoke hub (themed accent via CSS) + the cabin readout.
  const yokeName = q('#fsim-yoke-name'); if (yokeName) yokeName.textContent = String(opts.deviceName || P.name || 'AIRCRAFT').toUpperCase();
  renderSeats(F);

  // Flaps — a 3-position switch (UP / ½ / FULL). Click the track to snap to the nearest detent.
  const flapTrack = q('#fsim-flapsw-track'), flapKnob = q('#fsim-flapsw-knob');
  const flapLbls = root.querySelectorAll('.fsim-flapsw-lbls span');
  const FLAP_VAL = [0, 0.5, 1], FLAP_TOP = ['2%', '36%', '70%'];
  const setFlap = (i) => { F.flapIdx = i; F.input.flaps = FLAP_VAL[i]; if (flapKnob) flapKnob.style.top = FLAP_TOP[i]; flapLbls.forEach((s2, j) => s2.classList.toggle('on', j === i)); };
  add(flapTrack, 'pointerdown', (e) => { const r = flapTrack.getBoundingClientRect(); const f = (e.clientY - r.top) / r.height; const i = f < 0.34 ? 0 : f < 0.67 ? 1 : 2; if (FLAP_VAL[i] !== F.input.flaps) { setFlap(i); flapWhir(); } });
  setFlap(0);

  // Transient action toast (flap/gear/jettison feedback). Auto-hides ~1.1s.
  const toastEl = q('#fsim-toast');
  const fsimToast = (txt) => {
    if (!toastEl) return;
    toastEl.textContent = txt; toastEl.classList.add('show');
    if (F.toastT) clearTimeout(F.toastT);
    F.toastT = setTimeout(() => toastEl.classList.remove('show'), 1100);
  };
  F.toast = fsimToast;   // so the frame loop (touchdown/rollout prompts) can raise toasts too

  // ── Keyboard flight controls ────────────────────────────────────────────────
  // A/Z throttle · Q/E/S hold-to-look (release → forward) · W forward · R/F flaps ·
  // G gear (if retractable) · J jettison cargo. Ignored while typing in a text field.
  const VIEW_TAG = { '-90': '◀ LEFT VIEW', '90': 'RIGHT VIEW ▶', '180': '▲ REAR VIEW' };
  const viewTagEl = q('#fsim-viewtag');
  const setView = (yaw) => {
    F.viewYaw = yaw;
    if (viewTagEl) { viewTagEl.textContent = VIEW_TAG[String(yaw)] || ''; viewTagEl.classList.toggle('show', yaw !== 0); }
  };
  const stepFlap = (d) => { const i = clampNum(F.flapIdx + d, 0, 2); if (i !== F.flapIdx) { setFlap(i); flapWhir(); } };
  const toggleGear = () => {
    if (!F.gearRetract) { fsimToast('— FIXED GEAR —'); return; }
    F.gearUp = !F.gearUp;
    try { gearFx(F.gearUp ? 'retract' : 'extend'); } catch {}
    fsimToast(F.gearUp ? 'GEAR UP' : 'GEAR DOWN');
  };
  const jettison = () => {
    if (!F.cargoKg) { fsimToast('— NO CARGO —'); return; }
    F.cargoKg = 0; sendCmdSilent('jettison'); fsimToast('CARGO JETTISONED');
  };
  // Airport target guide — [ / ] (and the radio ◂/▸ buttons) step the field the target ring /
  // Home waypoint locks onto. Keyed by airfield id so the choice survives the list re-sorting.
  const cycleApTarget = (dir) => {
    const list = Array.isArray(F.fields) ? F.fields : [];
    if (!list.length) { fsimToast('— NO FIELDS IN RANGE —'); return; }
    let i = list.findIndex((f) => f.id === F.apTargetId);
    i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    F.apTargetId = list[i].id;
    fsimToast(`◎ ${(list[i].name || 'FIELD').toUpperCase()} · ${list[i].dist}mi`);
  };
  const KEYS = new Set(['a', 'z', 'q', 'w', 'e', 's', 'r', 'f', 'g', 'j', ' ', '[', ']']);
  const onKeyDown = (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
    const k = (e.key || '').toLowerCase();
    if (!KEYS.has(k)) return;
    e.preventDefault();
    switch (k) {
      case 'a': F.throttleKey = 1; break;
      case 'z': F.throttleKey = -1; break;
      // On the heli, Q/E are the tail-rotor PEDALS (yaw) — you pedal-turn to point the nose,
      // so side-look is dropped; S still looks back. Fixed-wing keeps Q/E as hold-to-look.
      case 'q': if (F.heli) F.pedalKey = -1; else setView(-90); break;
      case 'e': if (F.heli) F.pedalKey = 1; else setView(90); break;
      case 's': setView(180); break;
      case 'w': setView(0); break;
      case 'r': if (!e.repeat) stepFlap(1); break;
      case 'f': if (!e.repeat) stepFlap(-1); break;
      case 'g': if (!e.repeat) toggleGear(); break;
      case 'j': if (!e.repeat) jettison(); break;
      case '[': if (!e.repeat) cycleApTarget(-1); break;   // cycle target airport
      case ']': if (!e.repeat) cycleApTarget(1); break;
      case ' ': F.firing = true; break;   // hold to fire guns (frame loop squirts bursts)
    }
  };
  const onKeyUp = (e) => {
    const k = (e.key || '').toLowerCase();
    if (k === 'a' || k === 'z') F.throttleKey = 0;
    else if ((k === 'q' || k === 'e') && F.heli) F.pedalKey = 0;   // release pedal → centres
    else if (k === 'q' || k === 'e' || k === 's') setView(0);      // release hold-to-look → forward
    else if (k === ' ') F.firing = false;                         // release trigger
  };
  add(window, 'keydown', onKeyDown);
  add(window, 'keyup', onKeyUp);

  // Engine master — a round accent button that recesses while running. Off→on any time;
  // on→off only parked and stopped (you can't kill the engine in the air).
  const engBtn = q('#fsim-eng');
  if (F.engineOn) engBtn.classList.add('on');
  add(engBtn, 'click', () => {
    if (!F.engineOn) {
      F.engineOn = true; engBtn.classList.add('on');
      try { spoolUp(F.cls); } catch {}
      sendCmdSilent('flightevent engineon');
    } else if (s.onGround && s.airspeed < 5) {
      if (F.rolling) { finishLanding(F, s); return; }   // rolled to a stop → park (opens the hangar at a field)
      F.engineOn = false; engBtn.classList.remove('on');
      try { spoolDown(F.cls); } catch {}
      sendCmdSilent('flightevent engineoff');
    }
  });

  // Instrument panel lights — a dash switch that backlights the glass panels + dials
  // in the accent colour (for night flying). Independent of the badge's external sheen.
  root.style.setProperty('--cy-dim', accA(0.16));
  const nightSw = q('#fsim-nightsw');
  add(nightSw, 'click', () => {
    F.nightLight = !F.nightLight;
    nightSw.classList.toggle('on', F.nightLight);
    root.classList.toggle('fsim-nightlit', F.nightLight);
  });

  // Weapons (gunship only): master-arm toggle + FIRE (a gun pass — resolved inline by the
  // server against an AA site in range). Space also fires. Reticle glows when armed.
  const weapEl = q('#fsim-weap'), reticleEl = q('#fsim-reticle');
  const armBtn = q('#fsim-arm'), fireBtn = q('#fsim-fire'), pipsEl = q('#fsim-weap-pips');
  if (F.hardpoints > 0) {
    if (weapEl) weapEl.classList.add('show');
    if (pipsEl) pipsEl.textContent = '◆'.repeat(F.hardpoints);
    const setArmed = (on) => {
      F.armed = on;
      if (armBtn) { armBtn.textContent = on ? '● ARMED' : '◈ SAFE'; armBtn.classList.toggle('hot', on); }
      if (fireBtn) fireBtn.classList.toggle('ready', on);
      if (reticleEl) reticleEl.classList.toggle('on', on);
    };
    add(armBtn, 'click', () => { setArmed(!F.armed); sendCmdSilent(F.armed ? 'arm' : 'safe'); });
    // FIRE is a HELD trigger (touch/mouse): the frame loop squirts bursts while down.
    const holdFire = (on) => (e) => { if (e) e.preventDefault(); F.firing = on; };
    if (fireBtn) {
      add(fireBtn, 'pointerdown', holdFire(true));
      add(window, 'pointerup', holdFire(false));
      add(fireBtn, 'pointerleave', holdFire(false));
    }
  }

  // MFD map toggle — real local minimap ↔ aerial biome nav map.
  const mfdTog = q('#fsim-mfd-tog'), mfdLbl = q('#fsim-mfd-lbl');
  add(mfdTog, 'click', () => {
    F.mfdMode = F.mfdMode === 'local' ? 'nav' : 'local';
    if (mfdLbl) mfdLbl.textContent = F.mfdMode === 'local' ? 'LOCAL' : 'NAV';
    if (mfdTog) mfdTog.textContent = F.mfdMode === 'local' ? 'NAV ▸' : '◂ LOCAL';
  });

  // Live tuning sliders (⚙). Two groups: the current plane's flight-model params (F.P,
  // per-airframe feel) and the shared world-render knobs (RENDER_TUNE). Both take effect
  // on the next frame. Physics changes are session-scoped to this plane's TYPES entry.
  const tuneBtn = q('#fsim-tunebtn'), tunePanel = q('#fsim-tune');
  const physRow = ([k, lbl, lo, hi, stp]) =>
    `<div class="trow"><label>${lbl}</label><input type="range" data-pk="${k}" min="${lo}" max="${hi}" step="${stp}" value="${F.P[k]}"><span class="tv" id="fsim-pv-${k}">${fmtStp(F.P[k], stp)}</span></div>`;
  const rndRow = ([k, lbl, lo, hi, stp]) =>
    `<div class="trow"><label>${lbl}</label><input type="range" data-k="${k}" min="${lo}" max="${hi}" step="${stp}" value="${RENDER_TUNE[k]}"><span class="tv" id="fsim-tv-${k}">${fmtStp(RENDER_TUNE[k], stp)}</span></div>`;
  tunePanel.innerHTML =
    `<div class="thdr">✈ ${esc(F.P.name || 'AIRCRAFT')} · FEEL</div>` + PHYS_TUNE.map(physRow).join('') +
    `<div class="thdr">▦ WORLD RENDER</div>` + FSIM_TUNE.map(rndRow).join('');
  tunePanel.querySelectorAll('input[data-pk]').forEach((inp) => add(inp, 'input', () => {
    const k = inp.dataset.pk; F.P[k] = parseFloat(inp.value);
    const tv = document.getElementById('fsim-pv-' + k); if (tv) tv.textContent = fmtStp(F.P[k], inp.step);
  }));
  tunePanel.querySelectorAll('input[data-k]').forEach((inp) => add(inp, 'input', () => {
    const k = inp.dataset.k; RENDER_TUNE[k] = parseFloat(inp.value);
    const tv = document.getElementById('fsim-tv-' + k); if (tv) tv.textContent = fmtStp(RENDER_TUNE[k], inp.step);
  }));
  add(tuneBtn, 'click', () => { tunePanel.style.display = tunePanel.style.display === 'none' ? 'block' : 'none'; });

  // Fullscreen: expand the sim over the whole output column, pushing the text log + command
  // pane down out of the way for an immersive view. Toggling it off restores the split.
  const fsBtn = q('#fsim-fsbtn');
  add(fsBtn, 'click', () => {
    const on = document.body.classList.toggle('fsim-fullscreen');
    if (fsBtn) fsBtn.classList.toggle('on', on);
    if (on) { document.body.classList.remove('fsim-hidepanel'); q('#fsim-hidebtn')?.classList.remove('on'); }   // fullscreen supersedes hide-panel
  });

  // Hide-panel — folds away just the scrollback log (keeps the command box) and grows the
  // outside view; the cockpit instrument rows keep their fixed height, so the panel stays put.
  const hideBtn = q('#fsim-hidebtn');
  add(hideBtn, 'click', () => {
    const on = document.body.classList.toggle('fsim-hidepanel');
    if (hideBtn) hideBtn.classList.toggle('on', on);
    if (on) { document.body.classList.remove('fsim-fullscreen'); fsBtn?.classList.remove('on'); }
  });

  // Refuel — shown only when parked on a fuelled strip (the frame loop toggles it). Fires the
  // same `refuel` verb the command line uses; the server tops the tank and pushes fuel back.
  add(q('#fsim-refuel'), 'click', (e) => { e.stopPropagation(); sendCmdSilent('refuel'); fsimToast('REFUELLING…'); });

  // Radio target-cycle buttons — the panel twin of the [ / ] keys.
  add(q('#fsim-tgt-prev'), 'click', () => cycleApTarget(-1));
  add(q('#fsim-tgt-next'), 'click', () => cycleApTarget(1));

  // Focus model: the sim pane owns the keyboard by default on embark (so A/Z/Q/E/S…
  // drive the plane immediately). Clicking anywhere on the pane takes focus off the
  // command box; clicking the command box directly gives it back to typing.
  root.tabIndex = -1;
  const cmdInput = document.getElementById('cmd-input');
  const focusSim = () => { try { if (document.activeElement === cmdInput) cmdInput.blur(); root.focus({ preventScroll: true }); } catch {} };
  add(root, 'pointerdown', focusSim);
  focusSim();

  F.last = performance.now();
  F.raf = requestAnimationFrame(fsimFrame);
}

// Sample the atmosphere at the aircraft from the live weather (the "wind is the foundation"
// layer). Returns a steady-plus-gusting wind vector + a turbulence intensity, both scaled by
// weather severity. The prevailing wind direction is derived deterministically from the hour
// (no wind field in the world yet) so it's stable within a flight but varies across the day.
const WX_SEV = { clear: 0, cloudy: 0.22, fog: 0.12, rain: 0.5, snow: 0.4, storm: 1.0 };
function weatherAtmos(F, now) {
  const wx = (F.sky?.weather || 'clear').toLowerCase();
  const sev = WX_SEV[wx] ?? 0.2;
  const t = now * 0.001;
  const gust = 1 + 0.45 * sev * Math.sin(t * 0.6) + 0.2 * sev * Math.sin(t * 1.7 + 1.1);   // slow swell over the steady wind
  const windKt = ((F.sky?.wind || 0) * 0.28 + sev * 13) * gust;   // reported windKph→kt + weather baseline
  const windDir = (((F.sky?.hour || 12) * 17 + 40) % 360 + 360) % 360;
  return { sev, windKt, windDir, turb: sev };
}

// Off-map guard: if the tiles right under us are void (the endless-desert buffer beyond
// the built world), return the compass heading back toward the centroid of real terrain
// so the HUD can say "TURN xxx°". null = we're over the map, no warning. Heading convention
// matches the renderer: 0°=−y (north), 90°=+x (east).
function offMapHeading(F) {
  const map = F.map; if (!map || !map.length) return null;
  const R = (map.length - 1) / 2;
  const cx = R + (F.pos.x - F.mapCenter.x), cy = R + (F.pos.y - F.mapCenter.y);
  const at = (x, y) => { const row = map[Math.round(y)]; return row ? row[Math.round(x)] : null; };
  const real = (c) => c && c.kind !== 'air' && c.biome && c.biome !== 'water';
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (real(at(cx + dx, cy + dy))) return null;  // still over the world
  let sx = 0, sy = 0, n = 0;
  for (let ry = 0; ry < map.length; ry++) for (let rx = 0; rx < map[ry].length; rx++) if (real(map[ry][rx])) { sx += rx; sy += ry; n++; }
  if (!n) return null;
  const bx = (sx / n) - cx, by = (sy / n) - cy;
  return (Math.round(Math.atan2(bx, -by) * 180 / Math.PI) + 360) % 360;
}

// Landing report card — grades the touchdown by sink rate (fpm at contact) and flashes a big
// letter grade + the fpm + a wisecrack over the windshield for a couple of seconds. ~200 fpm is
// a good arrival; 600 fpm is the gear-breaking crash threshold; everything between is graded.
const LANDING_GRADES = [
  [50,  'A+', 'butter', '🧈 BUTTER. Absolutely greased it.'],
  [100, 'A',  'butter', 'Silky. The passengers applauded.'],
  [150, 'A-', 'good',   'Smooth. Barely a bump.'],
  [200, 'B+', 'good',   'Nice one — textbook touchdown.'],
  [260, 'B',  'good',   "Solid. The coffee didn't spill."],
  [320, 'B-', 'mid',    'Firm, but perfectly fine.'],
  [380, 'C+', 'mid',    'Ooh — felt that one.'],
  [440, 'C',  'mid',    'That was an arrival, not a landing.'],
  [500, 'C-', 'bad',    'Ouch. Better check the struts.'],
  [560, 'D',  'bad',    'The tower is filing paperwork.'],
  [600, 'F-', 'bad',    'The landing gear is openly weeping.'],
];
function landingGrade(fpm) {
  for (const [lim, grade, cls, txt] of LANDING_GRADES) if (fpm <= lim) return { grade, cls, txt };
  return { grade: 'F-', cls: 'bad', txt: 'The landing gear is openly weeping.' };
}
function showLandingCard(root, fpm, crashed) {
  const view = root && root.querySelector('.fsim-view'); if (!view) return;
  const f = Math.round(Math.max(0, fpm));
  const g = crashed ? { grade: 'F', cls: 'crash', txt: 'You wear this one. 💀' } : landingGrade(f);
  const old = view.querySelector('.fsim-card'); if (old) old.remove();
  const card = document.createElement('div');
  card.className = 'fsim-card ' + g.cls;
  card.innerHTML = `<div class="fsim-card-hd">${crashed ? 'CRASHED' : 'TOUCHDOWN'}</div>`
    + `<div class="fsim-card-grade">${g.grade}</div>`
    + `<div class="fsim-card-fpm">${f} fpm</div>`
    + `<div class="fsim-card-txt">${g.txt}</div>`;
  view.appendChild(card);
  requestAnimationFrame(() => card.classList.add('show'));
  setTimeout(() => { card.classList.remove('show'); setTimeout(() => { try { card.remove(); } catch {} }, 400); }, crashed ? 2600 : 2200);
}

// Full-stop landing → cut the engine, report grounded+stopped, and park. The server
// disembarks everyone at a real airfield, so we open straight into the hangar bay for
// this airport; off-field (a VTOL set-down) we just hand the pane back to the room view.
function finishLanding(F, s) {
  if (F.landed) return;   // once per touchdown
  F.landed = true; F.rolling = false;
  F.engineOn = false;
  const eb = document.getElementById('fsim-eng'); if (eb) eb.classList.remove('on');
  try { spoolDown(F.cls); } catch {}
  sendCmdSilent(`flightsync ${F.pos.x.toFixed(2)} ${F.pos.y.toFixed(2)} 0 0 ${Math.round(s.heading)} 0 0 1 0`);
  sendCmdSilent(`flightevent land ${F.landGrade || 'F-'} ${Math.round(F.landFpm || 0)}`);
  const toHangar = !!F.onField;
  setTimeout(() => { closeFlightSim(); sendCmdSilent(toHangar ? 'hangar' : 'look'); }, 600);
}

function fsimFrame(now) {
  const F = _fsim; if (!F) return;
  const root = document.getElementById('fsim-root');
  if (!root) { closeFlightSim(); return; }
  const dt = clampNum((now - F.last) / 1000, 0, 0.05); F.last = now;
  const { s, P, input } = F;

  // Yoke springs to centre when released.
  if (!F.yokeDrag) { input.elevator = lerpN(input.elevator, 0, Math.min(1, dt * 6)); input.aileron = lerpN(input.aileron, 0, Math.min(1, dt * 6)); }
  // Keyboard throttle (A/Z held) ramps the lever ~2s full-sweep.
  if (F.throttleKey) input.throttle = clampNum(input.throttle + F.throttleKey * dt * 0.5, 0, 1);
  // Heli tail-rotor pedals (Q/E held): ramp toward the held side, spring to centre on release.
  if (F.heli) input.pedal = F.pedalKey ? clampNum(input.pedal + F.pedalKey * dt * 3, -1, 1) : lerpN(input.pedal, 0, Math.min(1, dt * 8));
  // Effective throttle: the lever always moves, but there's no thrust unless the
  // engine master switch is on and the tank isn't dry (dead stick).
  const thr = (F.engineOn && !F.deadStick) ? input.throttle : 0;

  step(s, { elevator: input.elevator, aileron: input.aileron, throttle: thr, flaps: input.flaps, pedal: input.pedal }, P, dt);

  // Sample the atmosphere from the live weather → wind vector + turbulence intensity.
  const atmos = F.atmos = weatherAtmos(F, now);
  // Turbulence: the air disturbs the AIRCRAFT (you correct it), it never cheats the physics.
  // Deterministic summed-sine "noise" (no RNG) rolls/pitches you and bumps lift, ∝ severity.
  if (atmos.turb > 0.01 && !s.onGround) {
    const t = now * 0.001, g = atmos.turb;
    const nRoll = Math.sin(t * 3.1) + 0.6 * Math.sin(t * 7.7 + 2) + 0.8 * Math.sin(t * 1.3);
    const nPitch = Math.sin(t * 2.3 + 1.5) + 0.6 * Math.sin(t * 5.1 + 0.7);
    s.bank = clampNum(s.bank + nRoll * g * 5.5 * dt, -70, 70);
    s.pitch = clampNum(s.pitch + nPitch * g * 3.5 * dt, -35, 35);
    s.vs += nRoll * g * 130 * dt;                              // gusty lift / ballooning
  }

  // Move through the world whenever rolling or flying — the takeoff roll translates
  // you forward down the runway (buildings grow and pass); liftoff just adds altitude.
  if (s.airspeed > 0.5) {
    // Ground pace is quick so you actually roll down the runway, then decays FAST with altitude
    // (exp, groundDecay-ft e-fold) to the slow cruise pace (worldPace) so the sky doesn't rush past.
    const pace = RENDER_TUNE.worldPace * (1 + (RENDER_TUNE.groundBoost - 1) * Math.exp(-Math.max(0, s.altitude) / (RENDER_TUNE.groundDecay || 25)));
    const d = s.airspeed * pace * dt, hr = s.heading * Math.PI / 180;
    // Ground track = air velocity + wind (airborne only — on the wheels the gear holds you to
    // the ground). A crosswind drifts you off the runway centreline; a head/tailwind slows/speeds
    // your progress over the ground while airspeed (through the air) is unchanged.
    let vx = Math.sin(hr) * s.airspeed, vy = -Math.cos(hr) * s.airspeed;
    if (!s.onGround && atmos.windKt > 0.2) { const wr = atmos.windDir * Math.PI / 180; vx += Math.sin(wr) * atmos.windKt; vy += -Math.cos(wr) * atmos.windKt; }
    F.pos.x += vx * pace * dt; F.pos.y += vy * pace * dt;
    F.travel += d;
    if (F.engineOn) F.rollDist += d;
  }

  // ── Building collision (CFIT) — flying into a tower you can see out the glass ─────
  // Checks the aircraft's swept path this frame against the deterministic building geometry
  // the windshield is drawing. A deep/fast hit writes her off (crash cfit); a shallow clip of
  // the roofline is a hard jolt + real hull damage you fly out of (clip). Debounced so one
  // rooftop doesn't bill every frame; suppressed once she's already gone in.
  if (!s.onGround && !(F.cfitCd > 0)) {
    const hit = buildingCollisionAt(F, s);
    if (hit && hit.severe) {
      F.cfitCd = 9999; F.reportedAirborne = false; F.rolling = false;
      groundFx('touchdownHard'); csfx('flight-crash', 'hololock-lose');
      F.shake = 20;
      sendCmdSilent('flightevent crash cfit');
      if (F.toast) F.toast('CRASH — you flew into a building');
    } else if (hit) {
      // Glancing clip of the rooftops: real damage + a jolt, but you bounce off the top and fly out.
      F.cfitCd = 1.6;
      F.hull = Math.max(0, (F.hull || 100) - 20); F.hitFlashT = performance.now();
      s.airspeed *= 0.72; s.altitude = hit.roofFt + 25; s.vs = Math.max(s.vs, 40);
      s.bank = clampNum(s.bank + (s.bank >= 0 ? 14 : -14), -70, 70);
      groundFx('touchdownHard'); csfx('flight-touchdown', 'hololock-lose');
      F.shake = 13;
      sendCmdSilent('flightevent clip');
      if (F.toast) F.toast('⚠ You clipped a rooftop!');
    }
  }
  if (F.cfitCd > 0 && F.cfitCd < 9999) F.cfitCd = Math.max(0, F.cfitCd - dt);
  F.cfitPrev = { x: F.pos.x, y: F.pos.y };

  // Transitions → tell the server. Track descent rate while airborne so touchdown knows
  // how hard the arrival was (soft squeak vs firm thump).
  if (!s.onGround) { F.touchVs = s.vs; F.peakAltSinceLift = Math.max(F.peakAltSinceLift || 0, s.altitude); }
  if (!s.onGround && !F.reportedAirborne) { F.reportedAirborne = true; F.rolling = false; F.peakAltSinceLift = s.altitude; F.depPos = { x: F.pos.x, y: F.pos.y }; groundFx('liftoff'); sendCmdSilent('flightevent takeoff'); }
  if (s.onGround && F.reportedAirborne) {
    F.reportedAirborne = false;
    F.depPos = null;   // climb-out over — a later low pass gets normal CFIT
    const sinkFpm = -(F.touchVs || 0);   // descent rate at contact (ft/min; +ve = sinking)
    // A shaky rotation can hop the aircraft a few feet up and straight back down before it's
    // really established a climb — that's a rejected-takeoff bounce, not a hard landing, so
    // don't let its (very real, very fast) sink rate write the plane off. Only arm the
    // hard-landing crash check once she's actually climbed clear of the ground.
    const establishedClimb = (F.peakAltSinceLift || 0) >= 25;
    sendCmdSilent(`flightsync ${F.pos.x.toFixed(2)} ${F.pos.y.toFixed(2)} 0 ${Math.round(s.airspeed)} ${Math.round(s.heading)} ${Math.round(thr * 100)} 0 1 0`);
    if (sinkFpm > 600 && establishedClimb) {
      // Slammed it in — a touchdown sinking faster than 600 fpm breaks the gear/airframe.
      // Report a crash: the server destroys the craft and closes the sim (cockpit_close).
      F.rolling = false;
      groundFx('touchdownHard'); csfx('flight-crash', 'hololock-lose');
      F.shake = 18;   // slammed it in — a big jolt
      showLandingCard(root, sinkFpm, true);   // crash card
      sendCmdSilent('flightevent crash hardlanding');
      if (F.toast) F.toast('CRASH — you slammed it in too hard');
    } else {
      // Touchdown → keep the sim open and ROLL OUT. We don't park yet: chop the throttle
      // and hold the yoke back to brake to a stop, then cut the ENGINE to taxi into the
      // hangar and disembark — or power back up for a touch-and-go. The tile is reported
      // above so the server marks us grounded (no overfly noise / airspace rules taxiing).
      // Reuse the same park-on-shutdown flow. A heli sets down vertically (no rollout), so it's
      // already "stopped" — hint the shutdown straight away; a fixed-wing rolls out first.
      F.rolling = true; F.stopHinted = !!F.heli; F.landed = false;
      groundFx((F.touchVs || 0) < -500 ? 'touchdownHard' : 'touchdown');   // squeak/thump on contact
      F.shake = clampNum(sinkFpm / 55, 0, 14);   // jolt scales with how hard the wheels hit
      F.landGrade = landingGrade(sinkFpm).grade; F.landFpm = Math.round(sinkFpm);   // reported to the server for landing IP
      showLandingCard(root, sinkFpm);   // graded report card flashes over the glass
      if (F.toast) F.toast(F.heli ? 'DOWN — cut the ENGINE to shut down & park' : 'ROLL OUT — brake to a stop, then cut the ENGINE to park');
    }
  }
  // Rolled to a stop on the ground → prompt the shutdown that taxis you into the hangar.
  if (F.rolling && s.onGround && s.airspeed < 5) {
    // Rolled to a stop AT an airfield → shut down and taxi into the hangar automatically
    // (no manual engine-cut). Off-field (a VTOL that flared onto open ground) we still
    // prompt the shutdown, so the pilot can choose to power back up and lift off again.
    if (F.onField) finishLanding(F, s);
    else if (!F.stopHinted) { F.stopHinted = true; if (F.toast) F.toast('STOPPED — cut the ENGINE to shut down & park'); }
  }

  // Stall horn (intermittent → continuous).
  fsimHorn(F, dt);

  const r = readout(s, P), d = F.disp;
  d.ias = lerpN(d.ias, r.airspeed, Math.min(1, dt * 6)); d.alt = lerpN(d.alt, r.altitude, Math.min(1, dt * 5));
  d.vs = lerpN(d.vs, r.vs, Math.min(1, dt * 4)); d.rpm = lerpN(d.rpm, r.rpm, Math.min(1, dt * 6));
  d.pitch = lerpN(d.pitch, r.pitch, Math.min(1, dt * 10)); d.bank = lerpN(d.bank, r.bank, Math.min(1, dt * 10));
  const dh = ((r.heading - d.hdg + 540) % 360) - 180; d.hdg = (d.hdg + dh * Math.min(1, dt * 6) + 360) % 360;

  // PFD (attitude + speed/altitude tapes + heading + VSI) and MFD (map).
  paintPFD(document.getElementById('fsim-pfd'), {
    pitch: d.pitch, bank: d.bank, ias: d.ias, alt: d.alt, vs: d.vs, hdg: d.hdg,
    vr: P.vr, vne: P.vne, vs0: P.vs0, sm: s.stallMargin, fuelPct: Math.round(F.fuel / (F.fuelCap || 1) * 100),
    warn: r.stalled || s.stallMargin < 0.35, bingo: F.fuel <= 0 || F.warn === 'BINGO', night: F.nightLight,
  });
  paintMFD(document.getElementById('fsim-mfd'), F, d);

  // Bottom-left badge sheen tracks the outside light: a bright midday glints off the
  // metal (--sheen→1), dusk dims it, night kills it. Overcast/precip damps the glint.
  if (root) {
    const hr = F.sky?.hour ?? 12;
    const day = clampNum(Math.sin(clampNum((hr - 6) / 12, 0, 1) * Math.PI), 0, 1);
    const wx = (F.sky?.weather || 'clear').toLowerCase();
    const wxMul = wx === 'clear' ? 1 : wx === 'cloudy' ? 0.5 : wx === 'fog' ? 0.28 : 0.4;
    root.style.setProperty('--sheen', (day * wxMul).toFixed(2));
  }

  // Cosmetic engine gauges: the sim runs a single rpm, so fan it out across the airframe's
  // engine count (a slow per-engine wander — real engines never sync perfectly) and give
  // each its own thermal lag. Twins thus read two live RPM + two temp dials. Dials only.
  const nEng = Math.max(1, F.engines || 1);
  if (F.rpms.length !== nEng) F.rpms = new Array(nEng).fill(0);
  if (F.temps.length !== nEng) F.temps = new Array(nEng).fill(F.temp || 40);
  F.engWander += dt;
  const engRunning = F.engineOn && s.rpm > 0.02;
  for (let i = 0; i < nEng; i++) {
    const wob = engRunning ? Math.sin(F.engWander * 1.3 + i * 2.2) * 0.02 : 0;
    F.rpms[i] = clampNum(s.rpm * (1 + wob), 0, 1);
    F.temps[i] = lerpN(F.temps[i], 40 + F.rpms[i] * 175 + i * 7, Math.min(1, dt * 0.35));   // downstream engines run a touch hotter
  }
  F.temp = F.temps[0];   // keep the single field in sync for legacy readers
  F.battery = clampNum(F.battery + ((F.engineOn && s.rpm > 0.2) ? 5 : -1.1) * dt, 0, 100);
  paintGauges(document.getElementById('fsim-gauges'), {
    engines: nEng, rpms: F.rpms, temps: F.temps, eng: F.engStyle,
    rpm: F.rpms[0], temp: F.temps[0], ias: r.airspeed, vr: P.vr, vne: P.vne, vs0: P.vs0,
    fuelPct: Math.round(F.fuel / (F.fuelCap || 1) * 100), battery: F.battery,
    stall: r.stalled, warn: r.stalled || s.stallMargin < 0.35, hornBeat: F.hornBeat, night: F.nightLight,
    lowNr: !!s.lowNr, vrs: !!s.vrs,   // heli: low-rotor-RPM + settling-with-power annunciators
  });

  // Full yoke: roll with aileron + a 3-D pull toward/away with elevator (capped so it
  // stays in frame). Green light glows near best-climb pull; red light glows on stall.
  const yk = document.getElementById('fsim-yoke-svg');
  if (yk) yk.style.transform = `translateX(${input.aileron * 7}px) translateY(${input.elevator * 18}px) rotateX(${-input.elevator * 34}deg) rotateZ(${input.aileron * 30}deg) scale(${1 + Math.max(0, input.elevator) * 0.2})`;
  const gL = document.getElementById('fsim-yk-green'), rL = document.getElementById('fsim-yk-red');
  const atClimb = input.elevator > 0.40 && input.elevator < 0.66;
  const stalling = r.stalled || s.stallMargin < 0.35;
  // The left LED does double duty: GREEN near a best-climb pull, and — when you're gliding
  // dead-stick (little/no power, airborne) at the type's best-glide speed — it turns BLUE, so an
  // engine-out pilot just flies the blue light for max range. Best-glide takes the LED when both apply.
  const bg = P.bestGlide || 0;
  const atGlide = !s.onGround && thr < 0.15 && bg > 0 && Math.abs(s.airspeed - bg) <= Math.max(3, bg * 0.06);
  if (gL) {
    if (atGlide) { gL.setAttribute('fill', 'url(#ykblue)'); gL.style.opacity = '1'; gL.style.filter = 'drop-shadow(0 0 5px #4fb8e0)'; }
    else if (atClimb) { gL.setAttribute('fill', 'url(#ykgreen)'); gL.style.opacity = '1'; gL.style.filter = 'drop-shadow(0 0 4px #3ad07a)'; }
    else { gL.setAttribute('fill', 'url(#ykgreen)'); gL.style.opacity = '0.2'; gL.style.filter = 'none'; }
  }
  if (rL) { rL.style.opacity = stalling ? '1' : '0.2'; rL.style.filter = stalling ? 'drop-shadow(0 0 5px #e0403a)' : 'none'; }

  // Throttle quadrant lever.
  const lever = document.getElementById('fsim-thr-lever'), tv = document.getElementById('fsim-thrv');
  if (lever) lever.style.bottom = (10 + input.throttle * 70) + '%';
  if (tv) tv.textContent = Math.round(input.throttle * 100) + '%';

  // Fuel chip (always on) + REFUEL button (only when parked on an airfield tile with the
  // wheels down; the server rejects a wrong-fuel field with its own message).
  const fuelWrap = document.getElementById('fsim-fuel');
  if (fuelWrap) {
    const pct = Math.max(0, Math.round(F.fuel / (F.fuelCap || 1) * 100));
    const pctEl = document.getElementById('fsim-fuel-pct'); if (pctEl) pctEl.textContent = pct + '%';
    fuelWrap.classList.toggle('low', pct <= 30 && pct > 15);
    fuelWrap.classList.toggle('bingo', pct <= 15);
    fuelWrap.classList.toggle('can-fuel', s.onGround && !!F.onField);
    fuelWrap.classList.toggle('full', pct >= 100);
  }

  const back = F.reportedAirborne ? offMapHeading(F) : null;
  // Landing guide: show the glideslope gates once airborne, low, and within reach of the
  // departure runway (so it appears as you turn back to land).
  const rwDist = Math.hypot(F.rwOrigin.x - F.pos.x, F.rwOrigin.y - F.pos.y);
  const landGuide = (F.reportedAirborne && r.altitude < 1600 && rwDist < 16) ? { alt: r.altitude } : null;

  // ── Air-to-air traffic (Phase A: see-only) ──────────────────────────────────
  // Dead-reckon each relayed contact from its last-known heading/speed, express it
  // relative to us (world tiles + altitude delta), and designate the one nearest the
  // boresight so the windshield can bracket it. `contactNear` drives the sync cadence.
  let contactView = null, designated = null, contactNear = Infinity;
  if (F.contacts && F.contacts.length && F.reportedAirborne) {
    contactView = [];
    let bestBore = Infinity;
    for (const c of F.contacts) {
      const drS = Math.min(CONTACT_DR_MAX, (now - (c.t || now)) / 1000);
      const spd = (c.ias || 0) * RENDER_TUNE.worldPace, hr = (c.hdg || 0) * Math.PI / 180;
      const cx = c.x + Math.sin(hr) * spd * drS, cy = c.y - Math.cos(hr) * spd * drS;
      const dx = cx - F.pos.x, dy = cy - F.pos.y, rng = Math.hypot(dx, dy);
      if (rng < contactNear) contactNear = rng;
      const brg = Math.atan2(dx, -dy) * 180 / Math.PI;                    // bearing to contact
      const bore = Math.abs(((brg - s.heading + 540) % 360) - 180);       // off our nose
      const cv = { id: c.id, dx, dy, altDiff: (c.alt || 0) - s.altitude, rng, bore, reg: c.reg, hullPct: c.hullPct, cls: c.cls, hdg: c.hdg, bank: c.bank, pitch: c.pitch, livery: c.livery };
      contactView.push(cv);
      if (bore < bestBore) { bestBore = bore; designated = cv; }
    }
    if (designated) designated.designated = true;
  }
  F.designatedId = designated ? designated.id : null;   // so the MFD can ring the same contact

  // Gun solution (Phase B, manual pipper): how close the designated bogey is to the
  // boresight (horizontal bore + vertical elevation off our own nose) inside gun range.
  // aimQuality 0..1 falls off with the total cone angle; the server takes it on faith
  // within its own lenient gate and rolls the defender's jink against it.
  F.gunSolution = null;
  if (designated && F.hardpoints > 0 && F.armed) {
    const elev = Math.atan2((designated.altDiff || 0) * GUN_ALT_K, Math.max(0.1, designated.rng)) * 180 / Math.PI;
    const totalOff = Math.hypot(designated.bore, elev - (s.pitch || 0));
    const inRange = designated.rng <= GUN_RANGE;
    const aimQ = inRange ? Math.max(0, 1 - totalOff / GUN_CONE) : 0;
    F.gunSolution = { id: designated.id, aimQuality: aimQ, ready: inRange && aimQ > 0.02 };
  }
  const solReady = !!(F.gunSolution && F.gunSolution.ready);

  // Trigger held → squirt cannon bursts at the client cadence (the server enforces its
  // own harder cap + validates the shot). With a solution it's air-to-air; without one,
  // an armed craft still falls back to the ground-AA strafe pass.
  if (F.firing && F.armed && F.reportedAirborne && (!F.lastFireMs || now - F.lastFireMs >= GUN_FIRE_MS)) {
    F.lastFireMs = now;
    if (solReady) { sendCmdSilent(`airfire guns ${F.gunSolution.id} ${F.gunSolution.aimQuality.toFixed(2)}`); F.muzzleT = now; try { gunFx(); } catch {} }
    else if (F.hardpoints > 0) { sendCmdSilent('fire'); try { gunFx(); } catch {} }
  }
  // Reticle turns from amber (armed) to a green lock when a firing solution is up.
  const retEl = document.getElementById('fsim-reticle');
  if (retEl) retEl.classList.toggle('lock', solReady);

  // Airport target guide — the selected field (default: the nearest) resolved to a live
  // tile-offset from the craft, for the windshield's in-view accent ring / off-screen Home
  // waypoint. Tracked by airfield id; falls back to the nearest whenever the target drops out.
  let apTarget = null;
  const fieldList = Array.isArray(F.fields) ? F.fields : [];
  if (fieldList.length) {
    if (!F.apTargetId || !fieldList.some((f) => f.id === F.apTargetId)) F.apTargetId = fieldList[0].id;
    const tgt = fieldList.find((f) => f.id === F.apTargetId) || fieldList[0];
    if (tgt.gx != null) {
      const adx = tgt.gx - F.pos.x, ady = tgt.gy - F.pos.y;
      apTarget = { dx: adx, dy: ady, name: tgt.name, dist: Math.round(Math.hypot(adx, ady)) };
    }
    const nmEl = document.getElementById('fsim-tgt-name');
    if (nmEl) nmEl.textContent = (tgt.name || 'FIELD').slice(0, 10).toUpperCase();
  }

  paintWindshield('fsim-ws', {
    pitch: d.pitch, bank: d.bank,
    // Render height fraction (drives eye-height/compression). Referenced to 3000ft with a
    // sqrt curve so it ramps HARD off the deck — by ~500ft you're visibly above the buildings.
    height: Math.min(1, Math.sqrt(Math.max(0, r.altitude) / 3000)), speed: clampNum(r.airspeed / (P.vne || 120), 0, 1),
    hour: F.sky?.hour, weather: F.sky?.weather, wind: F.sky?.wind, heading: d.hdg,
    map: F.map, mapCenter: F.mapCenter, phase: 'cruise', airport: F.airport, biomeBelow: F.biomeBelow,
    mapOffset: { x: F.pos.x - F.mapCenter.x, y: F.pos.y - F.mapCenter.y }, travel: F.travel,
    // World-fixed runway: its origin + heading in the world, offset from the craft — so it
    // stays put and recedes/rotates naturally as you fly away (not glued ahead of the nose).
    runway: { ox: F.rwOrigin.x - F.pos.x, oy: F.rwOrigin.y - F.pos.y, hdg: F.rwHdg, alt: clampNum(r.altitude / 320, 0, 1) },
    landGuide,
    hud: true, navWarn: back == null ? null : `⚠ TURN ${String(back).padStart(3, '0')}° — RETURN TO MAP`,
    threat: (F.aa && F.reportedAirborne) ? F.aa : null,   // AA envelope telegraph → pulsing banner + tape chevron
    airports: F.fields, apTarget, apTargetId: F.apTargetId, viewYaw: F.viewYaw,
    // Looking off the nose (Q/E/S) → frame the view as a side cabin window instead of the
    // forward windscreen. The real, rotated Mode-7 world still renders behind the pane.
    windowClass: F.viewYaw ? F.cls : undefined,
    windVec: (atmos.windKt > 1 && F.reportedAirborne) ? { dir: atmos.windDir, kt: atmos.windKt } : null,
    contacts: contactView, designated,
    // Phase B guns: tracer/muzzle when firing on solution, a hull readout, and a red
    // battle-damage flash that fades over ~0.4s after taking a hit.
    firing: !!(F.firing && solReady), muzzle: F.muzzleT && (now - F.muzzleT < 90),
    hull: F.hull, hitFlash: F.hitFlashT ? clampNum(1 - (now - F.hitFlashT) / 400, 0, 1) : 0,
    // Incoming ground-AA tracer: bearing it's arriving from + a 0..1 progress fraction
    // (streak animates in over AA_TRACER_MS, then clears).
    aaTracer: (F.aaTracerT && (now - F.aaTracerT) < AA_TRACER_MS)
      ? { bearing: F.aaTracerBearing, t: (now - F.aaTracerT) / AA_TRACER_MS } : null,
  });

  // Drug/booze impairment: warp the out-the-window view if the pilot is flying loaded.
  applyFlightDrugFx(root.querySelector('.fsim-view'), document.getElementById('fsim-ws'), dt);

  // Stream state to the server while flying AND during the ground roll-out — the server
  // needs the fresh onGround flag to suppress overfly noise / airspace rules as we taxi.
  // Cadence tightens to ~3 Hz when traffic is close (the dogfight bubble), 1.2s otherwise.
  const syncEvery = contactNear <= FAST_SYNC_RANGE ? 0.33 : 1.2;
  F.syncAcc += dt; F.audioAcc += dt;
  if ((F.reportedAirborne || F.rolling) && F.syncAcc >= syncEvery) {
    F.syncAcc = 0;
    sendCmdSilent(`flightsync ${F.pos.x.toFixed(2)} ${F.pos.y.toFixed(2)} ${Math.round(s.altitude)} ${Math.round(s.airspeed)} ${Math.round(s.heading)} ${Math.round(thr * 100)} ${Math.round(s.vs)} ${s.onGround ? 1 : 0} ${s.stalled ? 1 : 0} ${Math.round(s.bank || 0)} ${Math.round(s.pitch || 0)}`);
    // NB: mapCenter is NOT advanced here — it stays paired with the map the server sends back
    // (updated in flightSimContext), so buildings never jump/re-seed on a window recenter.
  }
  if (F.audioAcc >= 0.25) {
    F.audioAcc = 0;
    updateEngineAudio({ continuous: true, airborne: F.reportedAirborne, engineOn: F.engineOn, class: F.cls, throttle: Math.round(thr * 100), spd: Math.round(s.airspeed), engines: [{ pct: Math.round(s.rpm * 100) }], bandIndex: s.altitude > 500 ? 1 : 0, sky: F.sky, atmos: F.atmos,
      rpm: s.rpm, airspeed: s.airspeed, vs: s.vs, altitude: s.altitude, onGround: s.onGround, groundSpeed: s.onGround ? s.airspeed : 0,
      stallMargin: s.stallMargin, stalled: s.stalled, flaps: input.flaps });
  }

  // Impact screen-shake — a decaying jitter on the whole panel, kicked by the sink rate at
  // touchdown (or a crash/clip). Bigger arrival = bigger jolt; settles in ~0.15s.
  if (F.shake > 0.2) {
    const m = F.shake;
    root.style.transform = `translate(${(Math.random() * 2 - 1) * m}px, ${(Math.random() * 2 - 1) * m}px)`;
    F.shake *= Math.exp(-dt * 9);
    F.shakeOn = true;
  } else if (F.shakeOn) { root.style.transform = ''; F.shake = 0; F.shakeOn = false; }

  F.raf = requestAnimationFrame(fsimFrame);
}

function fsimHorn(F, dt) {
  const lamp = document.getElementById('fsim-lamp'); if (!lamp) return;
  const { s } = F;
  // The lamp + audible horn: continuous in the stall, pulsing on the approach, silent otherwise.
  if (s.onGround) { lamp.style.opacity = 0; stallHorn(0); return; }   // no warning parked/rolling
  // On the heli the same lamp/horn channel warns of low rotor RPM + settling-with-power; the
  // fixed-wing uses it for the stall. stallMargin carries the danger level for either.
  if (F.heli) {
    if (s.lowNr || s.vrs) { lamp.textContent = s.vrs ? '⚠ SETTLING WITH POWER' : '⚠ LOW ROTOR RPM'; lamp.style.opacity = 1; stallHorn(0.6); }
    else if (s.stallMargin < 0.35) { F.hornBeat = (F.hornBeat + dt * (2 + (0.35 - s.stallMargin) * 10)) % 1; const on = F.hornBeat < 0.5; lamp.textContent = '⚠ LOW ROTOR RPM'; lamp.style.opacity = on ? 1 : 0; stallHorn(on ? 0.4 : 0); }
    else { lamp.style.opacity = 0; stallHorn(0); }
    return;
  }
  if (s.stalled) { lamp.textContent = '⚠ STALL'; lamp.style.opacity = 1; stallHorn(0.6); }
  else if (s.stallMargin < 0.35) { F.hornBeat = (F.hornBeat + dt * (2 + (0.35 - s.stallMargin) * 10)) % 1; const on = F.hornBeat < 0.5; lamp.style.opacity = on ? 1 : 0; stallHorn(on ? 0.4 : 0); }
  else { lamp.style.opacity = 0; stallHorn(0); }
}

// ── PFD (attitude + speed/altitude tapes + heading + VSI) ─────────────────────
function pfdTape(ctx, x, w, H, val, step, count, warn, marks) {
  const cy = H / 2, ppu = (H * 0.9) / (step * count), left = x < 4;
  ctx.save(); ctx.beginPath(); ctx.rect(x, 0, w, H); ctx.clip();
  ctx.fillStyle = 'rgba(6,14,22,0.82)'; ctx.fillRect(x, 0, w, H);
  ctx.font = '7px monospace'; ctx.textBaseline = 'middle';
  const base = Math.round(val / step) * step;
  for (let i = -count; i <= count; i++) {
    const tv = base + i * step; if (tv < 0) continue;
    const yy = cy - (tv - val) * ppu; if (yy < -4 || yy > H + 4) continue;
    ctx.strokeStyle = 'rgba(150,190,220,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(left ? x + w - 4 : x, yy); ctx.lineTo(left ? x + w : x + 4, yy); ctx.stroke();
    ctx.fillStyle = ACCENT; ctx.textAlign = left ? 'right' : 'left'; ctx.fillText(String(tv), left ? x + w - 6 : x + 6, yy);
  }
  if (marks) for (const m of marks) { const yy = cy - (m.v - val) * ppu; if (yy < 0 || yy > H) continue; ctx.strokeStyle = m.col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(left ? x + w - 5 : x, yy); ctx.lineTo(left ? x + w : x + 5, yy); ctx.stroke(); }
  ctx.fillStyle = '#0b1219'; ctx.strokeStyle = warn ? '#ff5a5b' : ACCENT; ctx.lineWidth = 1;
  ctx.fillRect(x, cy - 8, w, 16); ctx.strokeRect(x, cy - 8, w, 16);
  ctx.fillStyle = warn ? '#ff5a5b' : ACCENT; ctx.textAlign = 'center'; ctx.fillText(String(Math.round(val)), x + w / 2, cy);
  ctx.restore();
}

// Instrument night lighting: an accent backlight bloom over the glass + a lit accent
// rim just inside the bezel, so the dials read as edge-lit in the dark. Drawn last.
function nightGlow(ctx, W, H) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.12, W / 2, H / 2, Math.max(W, H) * 0.62);
  g.addColorStop(0, accA(0.10)); g.addColorStop(0.6, accA(0.04)); g.addColorStop(1, accA(0));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowColor = ACCENT; ctx.shadowBlur = 5; ctx.strokeStyle = accA(0.5); ctx.lineWidth = 1;
  ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
  ctx.restore();
}

function paintPFD(cv, s) {
  if (!cv || !cv.getContext) return;
  const cw = cv.clientWidth, ch = cv.clientHeight; if (!cw || !ch) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
  const ctx = cv.getContext('2d'); ctx.save(); ctx.scale(dpr, dpr);
  const W = cw, H = ch; ctx.clearRect(0, 0, W, H);
  const TAPE = Math.min(30, W * 0.2), cx = W / 2, cy = H * 0.47, aL = TAPE, aR = W - TAPE, ppd = 2.0;
  ctx.save(); ctx.beginPath(); ctx.rect(aL, 0, aR - aL, H); ctx.clip();
  ctx.save(); ctx.translate((aL + aR) / 2, cy); ctx.rotate(-(s.bank || 0) * Math.PI / 180);
  const ph = (s.pitch || 0) * ppd;
  ctx.fillStyle = '#12466a'; ctx.fillRect(-W, -H * 2 + ph, W * 2, H * 2);
  ctx.fillStyle = '#4a3720'; ctx.fillRect(-W, ph, W * 2, H * 2);
  ctx.strokeStyle = '#dff0ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-W, ph); ctx.lineTo(W, ph); ctx.stroke();
  ctx.strokeStyle = 'rgba(200,230,255,0.6)'; ctx.font = '6px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let dd = -30; dd <= 30; dd += 10) { if (!dd) continue; const yy = ph - dd * ppd; const wln = Math.abs(dd) >= 20 ? 14 : 9; ctx.beginPath(); ctx.moveTo(-wln, yy); ctx.lineTo(wln, yy); ctx.stroke(); }
  ctx.restore(); ctx.restore();
  ctx.strokeStyle = '#ffcf3e'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx - 15, cy); ctx.lineTo(cx - 6, cy); ctx.lineTo(cx - 6, cy + 3); ctx.moveTo(cx + 15, cy); ctx.lineTo(cx + 6, cy); ctx.lineTo(cx + 6, cy + 3); ctx.stroke();
  ctx.fillStyle = '#ffcf3e'; ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
  ctx.beginPath(); ctx.moveTo(cx, 5); ctx.lineTo(cx - 4, 11); ctx.lineTo(cx + 4, 11); ctx.closePath(); ctx.fillStyle = '#dff0ff'; ctx.fill();
  pfdTape(ctx, 0, TAPE, H, s.ias || 0, 10, 5, s.warn, [{ v: s.vr, col: '#5fe0a0' }, { v: s.vne, col: '#ff5a5b' }, { v: s.vs0, col: '#ff5a5b' }]);
  pfdTape(ctx, W - TAPE, TAPE, H, s.alt || 0, 100, 5, false, null);
  ctx.fillStyle = '#0b1219'; ctx.strokeStyle = ACCENT; ctx.lineWidth = 1; ctx.fillRect(cx - 17, 0, 34, 12); ctx.strokeRect(cx - 17, 0, 34, 12);
  ctx.fillStyle = ACCENT; ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(Math.round(s.hdg || 0)).padStart(3, '0') + '°', cx, 6);
  const vy = clampNum(cy - (s.vs || 0) / 2000 * (H * 0.42), 6, H - 6);
  ctx.fillStyle = (s.vs || 0) >= 0 ? '#5fe0a0' : '#ffb23e'; ctx.fillRect(W - TAPE - 4, Math.min(cy, vy), 3, Math.abs(vy - cy));
  ctx.fillStyle = s.bingo ? '#ff5a5b' : '#6f8698'; ctx.font = '7px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('FUEL ' + (s.fuelPct | 0) + '%', TAPE + 3, H - 2);
  if (s.night) nightGlow(ctx, W, H);
  ctx.restore();
}

// ── Engine gauge cluster (RPM · temp · speed · fuel · battery + stall lamp) ────
// A high-fidelity 270° instrument dial: recessed face + machined bezel with a rim
// catch-light, tick marks, coloured zone marks, a glowing value arc, a tapered white
// needle on a metallic hub, a label above and a recessed digital read-out below.
function arcGauge(ctx, cx, cy, r, frac, label, val, opts) {
  opts = opts || {};
  const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25, sweep = A1 - A0, lw = Math.max(2, r * 0.16);
  frac = clampNum(frac, 0, 1);
  const col = opts.col || '#5fe0a0';
  ctx.lineCap = 'round'; ctx.textAlign = 'center';
  // Recessed instrument face + machined bezel ring with a top rim catch-light.
  const face = ctx.createRadialGradient(cx, cy - r * 0.35, r * 0.15, cx, cy, r * 1.25);
  face.addColorStop(0, '#182028'); face.addColorStop(0.72, '#0b1218'); face.addColorStop(1, '#05090d');
  ctx.fillStyle = face; ctx.beginPath(); ctx.arc(cx, cy, r * 1.2, 0, 7); ctx.fill();
  ctx.lineWidth = Math.max(1.4, r * 0.1); ctx.strokeStyle = 'rgba(58,74,90,0.6)'; ctx.beginPath(); ctx.arc(cx, cy, r * 1.2, 0, 7); ctx.stroke();
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(190,215,235,0.10)'; ctx.beginPath(); ctx.arc(cx, cy, r * 1.2, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
  // Background track.
  ctx.strokeStyle = 'rgba(52,72,88,0.55)'; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(cx, cy, r, A0, A1); ctx.stroke();
  // Tick marks (major every other) just outside the track.
  for (let i = 0; i <= 8; i++) {
    const a = A0 + sweep * (i / 8), major = i % 2 === 0, r0 = r + lw * 0.55, r1 = r0 + (major ? 3 : 1.6);
    ctx.strokeStyle = major ? 'rgba(150,180,205,0.55)' : 'rgba(120,150,175,0.32)'; ctx.lineWidth = major ? 1.2 : 0.7;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
  }
  // Coloured zone marks (redline / Vr / Vs0 …).
  if (opts.marks) for (const m of opts.marks) { const a = A0 + sweep * clampNum(m.v, 0, 1); ctx.strokeStyle = m.col; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(cx, cy, r, a - 0.05, a + 0.05); ctx.stroke(); }
  // Value arc with a soft glow in its own colour.
  const va = A0 + sweep * frac;
  ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = Math.max(2, r * 0.22); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(cx, cy, r, A0, va); ctx.stroke(); ctx.restore();
  // Tapered needle (dark underlay → bright top) on a metallic hub.
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(va);
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.moveTo(-r * 0.17, -1.4); ctx.lineTo(r * 0.86, -0.2); ctx.lineTo(r * 0.86, 1.0); ctx.lineTo(-r * 0.17, 1.6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#eef4fb'; ctx.beginPath(); ctx.moveTo(-r * 0.17, -0.9); ctx.lineTo(r * 0.84, -0.4); ctx.lineTo(r * 0.84, 0.4); ctx.lineTo(-r * 0.17, 0.9); ctx.closePath(); ctx.fill();
  ctx.restore();
  const hub = ctx.createRadialGradient(cx - 1, cy - 1, 0.4, cx, cy, 3.2);
  hub.addColorStop(0, '#d2dde6'); hub.addColorStop(1, '#39454f');
  ctx.fillStyle = hub; ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, 7); ctx.fill();
  // Label above.
  ctx.fillStyle = '#93a7b7'; ctx.font = '6px monospace'; ctx.textBaseline = 'alphabetic'; ctx.fillText(label, cx, cy - r - 5);
  // Recessed digital read-out pill below the hub.
  const vy = cy + r * 0.56, pw = Math.max(18, r), ph = 9, px0 = cx - pw / 2, py0 = vy - ph / 2, rr = 2;
  ctx.beginPath(); ctx.moveTo(px0 + rr, py0); ctx.arcTo(px0 + pw, py0, px0 + pw, py0 + ph, rr); ctx.arcTo(px0 + pw, py0 + ph, px0, py0 + ph, rr); ctx.arcTo(px0, py0 + ph, px0, py0, rr); ctx.arcTo(px0, py0, px0 + pw, py0, rr); ctx.closePath();
  ctx.fillStyle = 'rgba(3,8,12,0.85)'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.6; ctx.stroke();
  ctx.fillStyle = opts.valcol || ACCENT; ctx.font = 'bold 7px monospace'; ctx.textBaseline = 'middle'; ctx.fillText(String(val), cx, vy + 0.5);
}

// STALL annunciator — a red warning lamp in a matching bezel: dim when clear, pulses with
// the horn on approach, solid + glowing in the stall.
function stallLamp(ctx, x, y, r, g) {
  // On a heli there's no aerodynamic stall: this bezel becomes the LOW-Nr / settling lamp.
  const heli = g.eng === 'heli';
  const label = heli ? (g.vrs ? 'SETTLE' : 'LO NR') : 'STALL';
  const alarm = heli ? (g.lowNr || g.vrs) : g.stall;
  const on = alarm ? 1 : (g.warn ? (g.hornBeat < 0.5 ? 1 : 0.28) : 0.16);
  const face = ctx.createRadialGradient(x, y - r * 0.3, r * 0.15, x, y, r * 1.2);
  face.addColorStop(0, '#170b0b'); face.addColorStop(1, '#05090d');
  ctx.fillStyle = face; ctx.beginPath(); ctx.arc(x, y, r * 1.2, 0, 7); ctx.fill();
  ctx.lineWidth = Math.max(1.4, r * 0.1); ctx.strokeStyle = 'rgba(94,62,62,0.6)'; ctx.beginPath(); ctx.arc(x, y, r * 1.2, 0, 7); ctx.stroke();
  if (on > 0.5) { ctx.shadowColor = '#e0403a'; ctx.shadowBlur = 12; }
  ctx.fillStyle = `rgba(224,64,58,${on})`; ctx.beginPath(); ctx.arc(x, y, r * 0.82, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,120,116,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r * 0.82, 0, 7); ctx.stroke();
  ctx.fillStyle = on > 0.5 ? '#fff' : '#7a3a38'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x, y);
}

function paintGauges(cv, g) {
  if (!cv || !cv.getContext) return;
  const cw = cv.clientWidth, ch = cv.clientHeight; if (!cw || !ch) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
  const ctx = cv.getContext('2d'); ctx.save(); ctx.scale(dpr, dpr);
  const W = cw, H = ch; ctx.clearRect(0, 0, W, H);
  const colL = W * 0.12, colR = W * 0.88, vne = g.vne || 120;
  const rpms = g.rpms || [g.rpm || 0], temps = g.temps || [g.temp || 40], nEng = Math.max(1, g.engines || 1);
  // spec[2] carries the engine index (1-based; 0 = single-engine, no suffix) — the draw
  // cases below label it per powerplant (piston RPM/TEMP · turboprop TQ/ITT · jet N1/EGT).
  const rpmSpec = (i) => ['rpm', rpms[i] || 0, nEng > 1 ? i + 1 : 0];
  const tempSpec = (i) => ['temp', temps[i] || 40, nEng > 1 ? i + 1 : 0];
  const eng = g.eng || 'piston';
  const suffix = (n) => (n ? ' ' + n : '');
  // Column layout: a single-engine craft keeps the classic Mayfly panel; twin+ splits the
  // engines across the two edge columns (a 4-engine heavy fills both with two engines each —
  // a real wing-by-wing cluster), with fuel + the stall lamp anchoring the column bottoms.
  let leftCol, rightCol;
  if (nEng === 1) {
    leftCol = [rpmSpec(0), ['spd'], ['batt']];
    rightCol = [tempSpec(0), ['fuel'], ['stall']];
  } else {
    const half = Math.ceil(nEng / 2);
    leftCol = []; for (let i = 0; i < half; i++) leftCol.push(rpmSpec(i), tempSpec(i)); leftCol.push(['fuel']);
    rightCol = []; for (let i = half; i < nEng; i++) rightCol.push(rpmSpec(i), tempSpec(i)); rightCol.push(['stall']);
  }
  const rows = Math.max(3, leftCol.length, rightCol.length), chd = H / rows;
  const r = Math.min(W * 0.088, chd * 0.40, chd * 0.5 - 6);   // last term keeps the top label off the panel edge
  const yAt = (i) => (i + 0.5) * chd;
  const draw = (spec, x, y) => {
    switch (spec[0]) {
      case 'rpm': {
        // Primary power dial, labelled + scaled per powerplant: piston reads RPM (×100),
        // turboprop reads TORQUE %, turbofan/jet reads N1 % (fan speed). Same 0..1 frac.
        const lbl = (eng === 'turboprop' ? 'TQ' : eng === 'turbofan' ? 'N1' : eng === 'heli' ? 'ROTOR' : 'RPM') + suffix(spec[2]);
        const val = eng === 'piston' ? Math.round(spec[1] * 100) : Math.round(spec[1] * 100) + '%';
        // A heli's rotor RPM has a green governed band and reds at BOTH ends (droop + overspeed).
        const marks = eng === 'heli' ? [{ v: 0.55, col: '#ff5a5b' }, { v: 0.6, col: '#5fe0a0' }, { v: 1, col: '#5fe0a0' }] : [{ v: 0.92, col: '#ff5a5b' }];
        arcGauge(ctx, x, y, r, spec[1], lbl, val, { col: eng === 'heli' && spec[1] < 0.6 ? '#ff5a5b' : ACCENT, marks }); break;
      }
      case 'temp': {
        // Thermal dial: piston oil TEMP, turboprop ITT, turbofan EGT — turbines run far
        // hotter, so map the same 0..1 thermal frac onto realistic turbine-gas ranges.
        const tf = clampNum((spec[1] - 40) / 175, 0, 1);
        const lbl = (eng === 'turboprop' ? 'ITT' : eng === 'turbofan' ? 'EGT' : eng === 'heli' ? 'CHT' : 'TEMP') + suffix(spec[2]);
        const val = eng === 'turboprop' ? Math.round(300 + tf * 520) + '°'
          : eng === 'turbofan' ? Math.round(380 + tf * 470) + '°'
            : Math.round(spec[1]) + '°';
        arcGauge(ctx, x, y, r, tf, lbl, val, { col: tf > 0.82 ? '#ff5a5b' : tf > 0.6 ? '#ffb23e' : '#5fe0a0', marks: [{ v: 0.82, col: '#ff5a5b' }] }); break;
      }
      case 'spd': arcGauge(ctx, x, y, r, g.ias / vne, 'SPD', Math.round(g.ias), { col: g.warn ? '#ff5a5b' : '#5fe0a0', valcol: g.warn ? '#ff5a5b' : ACCENT, marks: [{ v: g.vs0 / vne, col: '#ff5a5b' }, { v: g.vr / vne, col: '#5fe0a0' }, { v: 1, col: '#ff5a5b' }] }); break;
      case 'batt': arcGauge(ctx, x, y, r, g.battery / 100, 'BATT', Math.round(g.battery) + '%', { col: g.battery <= 20 ? '#ff5a5b' : '#5fe0a0' }); break;
      case 'fuel': arcGauge(ctx, x, y, r, g.fuelPct / 100, 'FUEL', g.fuelPct + '%', { col: g.fuelPct <= 15 ? '#ff5a5b' : '#ffb23e', valcol: g.fuelPct <= 15 ? '#ff5a5b' : ACCENT, marks: [{ v: 0.15, col: '#ff5a5b' }] }); break;
      case 'stall': stallLamp(ctx, x, y, r, g); break;
    }
  };
  leftCol.forEach((s, i) => draw(s, colL, yAt(i)));
  rightCol.forEach((s, i) => draw(s, colR, yAt(i)));
  if (g.night) nightGlow(ctx, W, H);
  ctx.restore();
}

// ── MFD (switchable: real local minimap ↔ aerial biome nav map) ───────────────
const MFD_DCOL = { safe: '#2f6d4a', low: '#2b5f7a', medium: '#8a6a2a', high: '#8a4a2a', lethal: '#7a2a2a' };
const MFD_BCOL = { water: '#22506e', badlands: '#8a6a48', industrial: '#484440', freight: '#4a4e56', ruins: '#5a6a3a', oldcoldwater: '#3a3632', uptown: '#38445a', civic: '#42423c', marquee: '#3e3242', citycore: '#3a3c42', parkland: '#3a5c34', docks: '#3c4850', infra: '#464a50', airport: '#3c403c' };

function paintMFD(cv, F, d) {
  if (!cv || !cv.getContext) return;
  const cw = cv.clientWidth, ch = cv.clientHeight; if (!cw || !ch) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
  const ctx = cv.getContext('2d'); ctx.save(); ctx.scale(dpr, dpr);
  const W = cw, H = ch; ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#050a10'; ctx.fillRect(0, 0, W, H);
  const ox = F.pos.x - F.mapCenter.x, oy = F.pos.y - F.mapCenter.y, hdgRad = (d.hdg || 0) * Math.PI / 180;
  // TRACK-UP minimap: the map ROTATES so your direction of travel is always toward the top;
  // the aircraft marker stays fixed pointing up. A north pointer swings round to show North.
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-hdgRad); ctx.translate(-W / 2, -H / 2);
  if (F.mfdMode === 'nav') paintNav(ctx, W, H, F, ox, oy); else paintLocal(ctx, W, H, F, ox, oy);
  // Air-to-air traffic blips, plotted north-up inside the track-up frame (Phase A).
  const cellPx = F.mfdMode === 'nav' ? Math.hypot(W, H) / ((F.map?.length || 9)) * 1.1 : Math.min(W, H) / 5;
  paintMfdContacts(ctx, W, H, F, cellPx);
  ctx.restore();
  // Fixed aircraft marker — always points up (= where you're heading).
  ctx.save(); ctx.translate(W / 2, H / 2);
  ctx.fillStyle = '#ffcf3e'; ctx.strokeStyle = '#1a1200'; ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  // North pointer — sits toward North on the rotated map (opposite your heading offset).
  const rr = Math.min(W, H) * 0.4, nx = W / 2 - Math.sin(hdgRad) * rr, ny = H / 2 - Math.cos(hdgRad) * rr;
  ctx.fillStyle = accA(0.8); ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', nx, ny);
  if (F.nightLight) nightGlow(ctx, W, H);
  ctx.restore();
}

// Full 5×5 tiles centred on the craft, straight from the always-complete map window —
// no fog of war, every cell shown (off-window cells read as neutral, never blank).
function paintLocal(ctx, W, H, F, ox, oy) {
  const map = F.map;
  if (!map || !map.length) { ctx.fillStyle = '#456'; ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('NO MAP', W / 2, H / 2); return; }
  const R = (map.length - 1) / 2, cell = Math.min(W, H) / 5;   // 5 tiles visible across the panel
  const drawHalf = 3;                                         // draw 7×7 so track-up rotation still fills the corners
  const ccx = R + ox, ccy = R + oy, bx = Math.round(ccx), by = Math.round(ccy);
  const fx = ccx - bx, fy = ccy - by;                        // sub-tile offset → smooth scroll
  for (let dy = -drawHalf; dy <= drawHalf; dy++) for (let dx = -drawHalf; dx <= drawHalf; dx++) {
    const c = (map[by + dy] && map[by + dy][bx + dx]) || null;
    const sx = W / 2 + (dx - fx) * cell, sy = H / 2 + (dy - fy) * cell;
    const col = !c ? '#12202c' : c.kind === 'air' ? '#0a1119' : c.kind === 'field' ? '#5fe0a0' : c.kind === 'nofly' ? '#7a2a2a' : (MFD_BCOL[c.biome] || '#2a3540');
    ctx.fillStyle = col; ctx.fillRect(sx - cell / 2, sy - cell / 2, cell - 1, cell - 1);
    if (c && c.road) { ctx.fillStyle = 'rgba(150,150,120,0.5)'; ctx.fillRect(sx - cell / 2, sy - 1.5, cell - 1, 3); }
    ctx.strokeStyle = accA(0.14); ctx.lineWidth = 1; ctx.strokeRect(sx - cell / 2, sy - cell / 2, cell - 1, cell - 1);
  }
}

// Traffic blips on the track-up MFD: each contact is a red dart pointing along its own
// heading (relative to ours, since the frame is already track-up rotated), dead-reckoned
// like the windshield. Off-panel contacts clamp to the edge as a hollow marker. Drawn
// inside the rotated frame, so north-up tile offsets land track-up automatically.
function paintMfdContacts(ctx, W, H, F, cell) {
  const cs = F.contacts; if (!cs || !cs.length) return;
  const now = performance.now(), lim = Math.min(W, H) * 0.46;
  for (const c of cs) {
    const drS = Math.min(CONTACT_DR_MAX, (now - (c.t || now)) / 1000);
    const spd = (c.ias || 0) * RENDER_TUNE.worldPace, hr = (c.hdg || 0) * Math.PI / 180;
    const cx = c.x + Math.sin(hr) * spd * drS, cy = c.y - Math.cos(hr) * spd * drS;
    let px = (cx - F.pos.x) * cell, py = (cy - F.pos.y) * cell;
    const mag = Math.hypot(px, py); let edge = false;
    if (mag > lim) { const k = lim / mag; px *= k; py *= k; edge = true; }
    const des = c.id && c.id === F.designatedId;
    // Fill the dart in the bogey's livery base (paint identification); a thin red edge +
    // red designator ring keep hostility legible on the radar.
    const baseHex = c.livery && /^#[0-9a-fA-F]{6}$/.test(c.livery.base || '') ? c.livery.base : '#c85050';
    ctx.save(); ctx.translate(W / 2 + px, H / 2 + py);
    if (des) { ctx.strokeStyle = '#ff5b5b'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, 7); ctx.stroke(); }
    ctx.rotate(hr);   // world heading; the frame's -ownHdg rotation makes it read track-up
    ctx.globalAlpha = edge ? 0.55 : 1;
    ctx.fillStyle = baseHex; ctx.strokeStyle = 'rgba(255,91,91,0.85)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(3, 4); ctx.lineTo(0, 2); ctx.lineTo(-3, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}

function paintNav(ctx, W, H, F, ox, oy) {
  const map = F.map;
  if (!map || !map.length) { ctx.fillStyle = '#456'; ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('NO MAP', W / 2, H / 2); return; }
  // Overscan: size cells so the whole 9×9 window spans the panel DIAGONAL — then track-up
  // rotation never reveals empty corners (the outer rings just run off the visible edges).
  const R = (map.length - 1) / 2, cell = Math.hypot(W, H) / map.length * 1.1;
  for (let ry = 0; ry < map.length; ry++) for (let rx = 0; rx < map[ry].length; rx++) {
    const c = map[ry][rx];
    const sx = W / 2 + (rx - R - ox) * cell, sy = H / 2 + (ry - R - oy) * cell;
    const col = !c ? '#0e1a24' : c.kind === 'air' ? '#0a1119' : c.kind === 'field' ? '#5fe0a0' : c.kind === 'nofly' ? '#7a2a2a' : (MFD_BCOL[c.biome] || '#2a3540');
    ctx.fillStyle = col; ctx.fillRect(sx - cell / 2, sy - cell / 2, cell, cell);
    if (c && c.kind === 'nofly') { ctx.strokeStyle = '#ff5a5b'; ctx.lineWidth = 1; ctx.strokeRect(sx - cell / 2, sy - cell / 2, cell, cell); }
  }
  ctx.strokeStyle = accA(0.18); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.min(W, H) * 0.32, 0, 7); ctx.stroke();
}

// Server context push (authoritative fuel + the world below).
export function flightSimContext(msg) {
  const F = _fsim; if (!F || !msg) return;
  if (msg.fuel != null) F.fuel = msg.fuel;
  if (msg.fuelCap != null) F.fuelCap = msg.fuelCap;
  // Update the map AND its window centre together so they stay paired (no recenter jump).
  if (msg.map) { F.map = msg.map; if (msg.mapX != null) F.mapCenter = { x: msg.mapX, y: msg.mapY }; }
  if (msg.minimap) F.minimap = msg.minimap;
  if (msg.fields) F.fields = msg.fields;
  if ('onField' in msg) F.onField = !!msg.onField;   // rolled onto a real airfield → auto-park + open the hangar on full stop
  if (msg.occupants) { F.occupants = msg.occupants; if (msg.seats) F.seats = msg.seats; renderSeats(F); }   // cabin readout keeps pace with boarding
  if ('cargo' in msg) F.cargoKg = msg.cargo;   // current hold weight (drives the J jettison bind)
  if (msg.sky) F.sky = msg.sky;
  if ('biomeBelow' in msg) F.biomeBelow = msg.biomeBelow;
  if ('surface' in msg) { F.surface = msg.surface; const tEl = document.getElementById('fsim-tile'); if (tEl) tEl.textContent = (msg.surface || '—').toUpperCase(); }
  if (typeof msg.hull === 'number') F.hull = msg.hull;   // authoritative hull for the cockpit readout
  F.warn = msg.warn || null;
  const wasExposed = !!(F.aa && F.aa.exposed);
  F.aa = msg.aa || null;       // AA engagement-envelope telegraph (drives the windshield threat banner)
  if (F.aa && F.aa.exposed && !wasExposed) aaWarn();   // RWR "deedle" the instant you enter the envelope
  F.deadStick = F.fuel <= 0;   // dead-stick when dry; clears once refuelled
}

// Air-to-air hit feedback (Phase B). `taken` → red battle-damage flash + hull update +
// warning toast; `dealt` → a brief hit confirmation. Purely feedback; the hull/kill
// consequences are already authoritative on the server.
export function flightSimAirHit(msg) {
  const F = _fsim; if (!F || !msg) return;
  if (msg.role === 'taken') {
    F.hitFlashT = performance.now();
    if (typeof msg.hullPct === 'number') F.hull = msg.hullPct;
    if (F.toast) F.toast(`⚠ TAKING FIRE${msg.by ? ' · ' + msg.by : ''} — HULL ${msg.hullPct}%`);
    try { hitFx(); } catch {}
  } else if (msg.role === 'dealt') {
    if (F.toast) F.toast('GUNS · HITS');
  }
}

// Incoming ground-AA tracer: purely visual, no damage here (that's the `air_hit` push if it
// connects) — just draws where the fire is coming from so it isn't invisible/undodgeable.
const AA_TRACER_MS = 550;
export function flightSimAaTracer(msg) {
  const F = _fsim; if (!F || !msg) return;
  F.aaTracerT = performance.now();
  F.aaTracerBearing = msg.bearing || 0;
  try { tracerFx(msg.near ?? 0.5); } catch {}
}

// Air-to-air traffic relay (Phase A: see-only). Each contact carries world position +
// heading/speed so the frame loop can dead-reckon it smoothly between relays. Stamped
// with receipt time for the dead-reckon window.
export function flightSimContacts(msg) {
  const F = _fsim; if (!F || !msg) return;
  const now = performance.now();
  F.contacts = (msg.contacts || []).map(c => ({ ...c, t: now }));
}

// True while the continuous cockpit owns the area pane — dispatch uses this to stop
// room `look`/`move` renders from clobbering the cockpit out from under the pilot.
export function isFlightSimActive() { return !!_fsim; }

// True while the discrete cockpit HUD (charter passengers, and any non-continuous
// aircraft occupant) owns the area pane — same purpose as isFlightSimActive() above,
// for the OTHER cockpit renderer. Without this, a `refresh`-flagged zone_event (e.g.
// touchdown landing the passenger's zone before they've disembarked) schedules a
// debounced silent `look` that clobbers the HUD with plain room text mid-landing.
export function isCockpitHudActive() { return !!document.getElementById('ck-hud-root'); }

// Read-only snapshot of the live flight position + window centre. The real game feeds
// fresh map windows from the server (flightSimContext); the login-less flightsim.html
// test page has no server, so it reads this each frame to know when the aircraft has
// crossed far enough from the current window centre to regenerate a procedural window
// and push it back through flightSimContext — the exact seam the server uses. Returns
// null when no sim is active. Never called in the real game.
export function flightSimSnapshot() {
  const F = _fsim; if (!F) return null;
  return {
    pos: { x: F.pos.x, y: F.pos.y },
    mapCenter: { x: F.mapCenter.x, y: F.mapCenter.y },
    heading: F.s.heading, airborne: !!F.reportedAirborne,
  };
}

export function closeFlightSim() {
  const F = _fsim; if (!F) return;
  _fsim = null;
  if (F.raf) cancelAnimationFrame(F.raf);
  if (F.toastT) clearTimeout(F.toastT);
  for (const [t, ty, fn, op] of F.listeners) { try { t.removeEventListener(ty, fn, op); } catch {} }
  try { disposeWindshield('fsim-ws'); } catch {}
  try { clearFlightDrugFx(document.getElementById('fsim-root')?.querySelector('.fsim-view'), document.getElementById('fsim-ws')); } catch {}
  stopEngineAudio();
  document.body.classList.remove('fsim-fullscreen');   // drop the immersive layout if it was on
  document.body.classList.remove('fsim-hidepanel');    // …and the lighter hide-panel layout
  suppressWeatherFx(false);   // back to the room view — let the outdoor overlay resume
}

export function openTakeoff(opts = {}) {
  if (opts.vtol) return openVtolLift(opts, 'takeoff');   // helicopters lift vertically
  ensureMgStyles(); ensureChassisStyles(); ensureTakeoffStyles(); ensureWindshieldStyles();
  const o = { skill: 4, difficulty: 5, vtol: false, deviceName: 'CRAFT', onResult: null, ...opts };
  const edge = o.skill - o.difficulty;
  const ROLL = clampNum(0.16 + edge * 0.01, 0.10, 0.24);   // runway consumed per sec at full speed
  const STALL_BAND = clampNum(0.58 - edge * 0.02, 0.46, 0.66);   // stick past this = stall (skill widens margin)

  let throttle = 0, stick = 0, pitch = 0, speed = 0, roll = 0, alt = 0;
  let airborne = false, v1 = false, over = false, stallT = 0, raf = 0, last = 0, dash = 0;
  const listeners = [];
  const add = (t, ty, fn, op) => { t.addEventListener(ty, fn, op); listeners.push([t, ty, fn, op]); };

  // Side-view attitude: sky/ground, a scrolling runway, the aircraft pitching +
  // climbing, and a runway-remaining bar with a V1 gate.
  const scr = `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id="ck-to-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e4c78"/><stop offset="1" stop-color="#1a6fa8"/></linearGradient>
      <linearGradient id="ck-to-gnd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f3a20"/><stop offset="1" stop-color="#161c10"/></linearGradient>
    </defs>
    <rect x="0" y="0" width="300" height="128" fill="url(#ck-to-sky)"/>
    <rect x="0" y="128" width="300" height="42" fill="url(#ck-to-gnd)"/>
    <rect x="0" y="122" width="300" height="10" fill="#3a4a2a"/>
    <line id="ck-to-rwline" x1="-40" y1="127" x2="340" y2="127" stroke="#cfe8d6" stroke-width="2" stroke-dasharray="16 14"/>
    <g id="ck-to-plane" transform="translate(96 118)">
      <path d="M-16,2 L10,-1 L16,2 L10,5 L-16,3 Z M-4,-2 L2,-9 L4,-2 Z M-16,3 L-20,-3 L-13,0 Z" fill="#eaf6ff" stroke="#4fb8e0" stroke-width="0.8"/>
    </g>
    <rect x="24" y="150" width="252" height="10" rx="3" fill="#0a1620" stroke="#2b4a60"/>
    <rect id="ck-to-rwrem" x="26" y="152" width="248" height="6" rx="2" fill="#2f6d4a"/>
    <line x1="${26 + 248 * 0.8}" y1="148" x2="${26 + 248 * 0.8}" y2="162" stroke="#46e05a" stroke-width="2"/>
    <text x="${26 + 248 * 0.8}" y="147" fill="#46e05a" font-size="7" text-anchor="middle" font-family="monospace">V1</text>
  </svg>`;

  const html = `<div class="ck-panel mg-chassis">
    ${deviceHeader('&#9992;', o.vtol ? 'LIFT-OFF' : 'TAKEOFF', 'DEPARTURE &middot; ' + esc(o.deviceName).toUpperCase())}
    <div class="ck-deck-canopy">${windshieldHTML('ck-ws-to', 'FWD VIEW')}</div>
    <div class="ck-hud2"><span>ASPD <b id="ck-to-asi">0</b></span><span>PITCH <b id="ck-to-pit">0°</b></span><span>GEAR <b id="ck-gear">DOWN</b></span>
      <span class="ck-asi-wrap">THR <span class="ck-asi-bar"><span class="ck-asi-fill" id="ck-to-thrbar" style="background:linear-gradient(90deg,#7a5310,#ffb23e)"></span></span></span></div>
    <div class="mg-bezel">${bezelScrews()}<div class="ck-scr-wrap"><div class="ck-scr mg-screen" style="--mg-sweep-h:170px">${scr}${crtOverlays()}</div><div class="ck-bigmsg" id="ck-bigmsg"></div></div></div>
    ${deckStrip('CONTROL BUS', 'RWY USED')}
    <div class="ck-status2" id="ck-status"><span class="ck-hint">Drag the <b>THROTTLE</b> up to roll. At <b>V1</b>, gently pull the <b>COLUMN</b> back to rotate.</span></div>
    <div class="ck-levers">
      <div class="ck-lever" id="ck-thr"><div class="ck-lever-fill" id="ck-thr-fill"></div><div class="ck-lever-v1" style="bottom:60%"></div><div class="ck-lever-knob" id="ck-thr-knob" style="bottom:0%"></div><div class="ck-lever-lbl">THROTTLE<b id="ck-thr-val">0%</b></div></div>
      <div class="ck-lever" id="ck-col"><div class="ck-lever-mid"></div><div class="ck-lever-knob" id="ck-col-knob" style="bottom:50%"></div><div class="ck-lever-lbl">COLUMN<b id="ck-col-val">NEUTRAL</b></div></div>
    </div>
    <div class="ck-actions"><button class="ck-btn ck-btn-abort">Abort</button></div>
  </div>`;

  const mounted = mountOverlay({ id: 'cockpit-overlay', html, closeOnBackdrop: false,
    onClose: () => { if (raf) cancelAnimationFrame(raf); for (const [t, ty, fn, op] of listeners) t.removeEventListener(ty, fn, op); } });
  const overlay = mounted.overlay; const q = (s) => overlay.querySelector(s);
  const setStatus = (h) => { const el = q('#ck-status'); if (el) el.innerHTML = h; };
  const big = (h, color) => { const el = q('#ck-bigmsg'); if (el) { el.innerHTML = h || ''; el.style.color = color || '#ffcf3e'; } };

  const finish = (won, why) => {
    if (over) return; over = true; if (raf) cancelAnimationFrame(raf); raf = 0;
    csfx(won ? 'flight-rotate' : 'flight-crash', won ? 'hololock-win' : 'hololock-lose');
    disposeWindshield('ck-ws-to');
    if (!won) creak('stress');
    big(won ? '◇ AIRBORNE' : '✕ ' + (why || 'CRASH'), won ? '#46e05a' : '#ff5b5b');
    setStatus(won ? '<span class="ck-win">◇ POSITIVE RATE — gear up, climbing out.</span>' : `<span class="ck-lose">✕ ${why || 'CRASH'}.</span>`);
    setTimeout(() => { mounted.close(); if (o.onResult) o.onResult({ won }); }, 1150);
  };

  // ── Drag a lever; sets a 0..1 fraction from the pointer's Y within the track ──
  function bindLever(id, onFrac) {
    const el = q('#' + id); if (!el) return;
    let dragging = false;
    const setFromY = (clientY) => { const r = el.getBoundingClientRect(); onFrac(clampNum(1 - (clientY - r.top) / r.height, 0, 1)); };
    add(el, 'pointerdown', (e) => { dragging = true; el.classList.add('ck-grab'); try { el.setPointerCapture(e.pointerId); } catch {} setFromY(e.clientY); });
    add(el, 'pointermove', (e) => { if (dragging) setFromY(e.clientY); });
    const end = () => { dragging = false; el.classList.remove('ck-grab'); };
    add(el, 'pointerup', end); add(el, 'pointercancel', end);
  }
  bindLever('ck-thr', (f) => { throttle = f; q('#ck-thr-knob').style.bottom = `${f * 100}%`; q('#ck-thr-fill').style.height = `${f * 100}%`; const v = q('#ck-thr-val'); if (v) { v.textContent = `${Math.round(f * 100)}%`; v.style.color = f >= 0.6 ? '#46e05a' : '#4fb8e0'; } });
  bindLever('ck-col', (f) => { stick = (f - 0.5) * 2; q('#ck-col-knob').style.bottom = `${f * 100}%`; const v = q('#ck-col-val'); if (v) v.textContent = stick > 0.1 ? `BACK ${Math.round(stick * 100)}%` : stick < -0.1 ? `FWD ${Math.round(-stick * 100)}%` : 'NEUTRAL'; });

  const tick = (t) => {
    if (over) return; const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    // Airspeed builds toward the throttle setting; roll eats runway while grounded.
    speed = clampNum(speed + (throttle - speed) * dt * 1.1, 0, 1);
    if (!airborne && throttle > 0) roll = clampNum(roll + speed * ROLL * dt, 0, 1);
    pitch += (stick - pitch) * Math.min(1, dt * 7);

    if (!v1 && roll >= 0.8 && throttle >= 0.6) { v1 = true; big('V1 — ROTATE!', '#ffcf3e'); csfx('flight-lock'); }

    if (!airborne) {
      if (roll >= 1 && !v1) { finish(false, 'OVERRUN — off the end of the strip'); return; }
      if (v1 && stick > 0.12) {
        if (stick > STALL_BAND) { big('⚠ OVER-ROTATE — EASE OFF', '#ff5b5b'); stallT += dt; if (stallT > 1.2) { finish(false, 'STALL on rotation'); return; } }
        else { airborne = true; stallT = 0; big('POSITIVE RATE — CLIMB', '#46e05a'); gearFx('retract'); q('#ck-gear').textContent = 'UP'; q('#ck-gear').style.color = '#46e05a'; }
      } else if (roll > 0.9 && stick < -0.15) { finish(false, 'NOSE-FIRST — you drove it into the ground'); return; }
      else if (stallT > 0 && stick <= STALL_BAND) { stallT = 0; big(v1 ? 'V1 — ROTATE!' : ''); }
    } else {
      // Airborne: hold gentle back-pressure to climb out.
      if (stick > STALL_BAND) { big('STALL! LEVEL OUT', '#ff5b5b'); stallT += dt; alt = clampNum(alt - 0.4 * dt, 0, 1); if (stallT > 1.4 || alt <= 0) { finish(false, 'STALL — you dropped it'); return; } }
      else if (stick < -0.05 && alt < 0.65) { big('NOSE DOWN — PULL UP', '#ff8a3e'); alt = clampNum(alt - 0.55 * dt, 0, 1); if (alt <= 0) { finish(false, 'NOSE-FIRST into the deck'); return; } }
      else { stallT = 0; if (alt < 1) big('CLIMB', '#46e05a'); alt = clampNum(alt + clampNum(stick, -0.15, 0.55) * 0.55 * dt, 0, 1); }
      if (alt >= 1) { finish(true); return; }
    }

    // Render.
    dash = (dash + speed * 220 * dt) % 30;
    q('#ck-to-rwline').setAttribute('stroke-dashoffset', `${dash}`);
    const px = 96, py = 118 - alt * 92;
    q('#ck-to-plane').setAttribute('transform', `translate(${px} ${py}) rotate(${-pitch * 22})`);
    q('#ck-to-rwrem').setAttribute('width', `${248 * (1 - roll)}`);
    q('#ck-to-rwrem').setAttribute('fill', roll > 0.85 ? '#ff5b5b' : roll > 0.6 ? '#ffb23e' : '#2f6d4a');
    q('#ck-to-asi').textContent = Math.round(speed * 160);
    q('#ck-to-pit').textContent = `${Math.round(pitch * 22)}°`;
    q('#ck-to-thrbar').style.width = `${Math.round(throttle * 100)}%`;
    setDeckLevel(overlay, roll);
    paintWindshield('ck-ws-to', { pitch: pitch * 22, bank: 0, height: alt, speed, hour: _target?.sky?.hour, weather: _target?.sky?.weather, wind: _target?.sky?.wind, phase: 'takeoff', airport: o.airport || _target?.ground?.theme });
    raf = requestAnimationFrame(tick);
  };

  q('.mg-close').addEventListener('click', () => finish(false, 'ABORT'));
  q('.ck-btn-abort').addEventListener('click', () => finish(false, 'ABORT'));
  window.AudioEngine?.init?.(); csfx('flight-roll', 'hololock-entry');
  last = performance.now(); raf = requestAnimationFrame(tick);
}

// Shared vertical-lever drag: sets a 0..1 fraction from the pointer's Y in the track.
function levDrag(overlay, add, id, onFrac) {
  const el = overlay.querySelector('#' + id); if (!el) return;
  let dragging = false;
  const setY = (cy) => { const r = el.getBoundingClientRect(); onFrac(clampNum(1 - (cy - r.top) / r.height, 0, 1)); };
  add(el, 'pointerdown', (e) => { dragging = true; el.classList.add('ck-grab'); try { el.setPointerCapture(e.pointerId); } catch {} setY(e.clientY); });
  add(el, 'pointermove', (e) => { if (dragging) setY(e.clientY); });
  const end = () => { dragging = false; el.classList.remove('ck-grab'); };
  add(el, 'pointerup', end); add(el, 'pointercancel', end);
}

// ══════════════════════════════════════════════════════════════════════════════
// VTOL LIFT — the helicopter/Dragonfly minigame (collective + cyclic). mode
// 'takeoff' climbs off the pad to altitude; 'landing' settles gently back onto it.
// Raise/lower the COLLECTIVE for vertical rate; nudge ◀ ▶ (cyclic) to hold station
// over the pad against wind. Drift off the pad, or thump it down too hard, and you
// wreck it.
// ══════════════════════════════════════════════════════════════════════════════
export function openVtolLift(opts, mode) {
  ensureMgStyles(); ensureChassisStyles(); ensureTakeoffStyles(); ensureWindshieldStyles();
  const o = { skill: 4, difficulty: 5, deviceName: 'PAD', onResult: null, ...opts };
  const edge = o.skill - o.difficulty;
  const wind = clampNum(0.28 + o.difficulty * 0.05 - o.skill * 0.02, 0.12, 0.8);
  const HOVER = 0.5, takeoff = mode === 'takeoff';
  let coll = takeoff ? 0 : HOVER, cyc = 0, drift = 0, driftV = 0, alt = takeoff ? 0 : 1, vs = 0, over = false, raf = 0, last = 0;
  const listeners = [];
  const add = (t, ty, fn, op) => { t.addEventListener(ty, fn, op); listeners.push([t, ty, fn, op]); };

  const scr = `<svg viewBox="0 0 300 200" preserveAspectRatio="xMidYMid meet">
    <rect x="0" y="0" width="300" height="200" fill="#04121c"/>
    <line x1="150" y1="18" x2="150" y2="184" stroke="#153040" stroke-width="1" stroke-dasharray="3 6"/>
    <ellipse cx="150" cy="180" rx="46" ry="9" fill="#0c1a12" stroke="#3f8a5c" stroke-width="1.5"/>
    <text x="150" y="183" fill="#3f8a5c" font-size="9" text-anchor="middle" font-family="monospace">H</text>
    <rect x="150" y="${takeoff ? 24 : 172}" width="0" height="8" x2="0"/>
    <line x1="118" y1="${takeoff ? 28 : 176}" x2="182" y2="${takeoff ? 28 : 176}" stroke="#46e05a" stroke-width="1.5" stroke-dasharray="4 4"/>
    <text x="186" y="${takeoff ? 31 : 179}" fill="#46e05a" font-size="7" font-family="monospace">${takeoff ? 'ALT' : 'PAD'}</text>
    <g id="ck-vt-craft"><circle cx="0" cy="0" r="7" fill="none" stroke="#4fe0a0" stroke-width="2"/><line x1="-12" y1="0" x2="12" y2="0" stroke="#4fe0a0" stroke-width="2"/><line x1="0" y1="-9" x2="0" y2="5" stroke="#4fe0a0" stroke-width="2"/></g>
    <rect x="284" y="20" width="8" height="160" rx="3" fill="#0a1620" stroke="#2b4a60"/>
    <rect id="ck-vt-tape" x="286" y="180" width="4" height="0" fill="#4fe0a0"/>
  </svg>`;

  const html = `<div class="ck-panel mg-chassis">
    ${deviceHeader('&#128757;', takeoff ? 'VERTICAL LIFT' : 'VERTICAL LANDING', 'VTOL &middot; ' + esc(o.deviceName).toUpperCase())}
    <div class="ck-deck-canopy">${windshieldHTML('ck-ws-vt', 'FWD VIEW')}</div>
    <div class="ck-hud2"><span>ALT <b id="ck-vt-altn">0%</b></span><span>DRIFT <b id="ck-vt-drift">0</b></span><span>V/S <b id="ck-vt-vs">0</b></span></div>
    <div class="mg-bezel">${bezelScrews()}<div class="ck-scr-wrap"><div class="ck-scr mg-screen" style="--mg-sweep-h:200px">${scr}${crtOverlays()}</div><div class="ck-bigmsg" id="ck-bigmsg"></div></div></div>
    ${deckStrip('ROTOR BUS', 'DRIFT')}
    <div class="ck-status2" id="ck-status"><span class="ck-hint">${takeoff ? 'Raise the <b>COLLECTIVE</b> to lift off; hold it over the pad (◀ ▶) and climb out.' : 'Ease the <b>COLLECTIVE</b> down to settle gently onto the pad; stay centred (◀ ▶).'}</span></div>
    <div class="ck-levers">
      <button class="ck-btn ck-btn-l" style="flex:0.5">◀</button>
      <div class="ck-lever" id="ck-coll"><div class="ck-lever-fill" id="ck-coll-fill" style="height:${coll * 100}%"></div><div class="ck-lever-v1" style="bottom:50%"></div><div class="ck-lever-knob" id="ck-coll-knob" style="bottom:${coll * 100}%"></div><div class="ck-lever-lbl">COLLECTIVE<b id="ck-coll-val">${Math.round(coll * 100)}%</b></div></div>
      <button class="ck-btn ck-btn-r" style="flex:0.5">▶</button>
    </div>
    <div class="ck-actions"><button class="ck-btn ck-btn-abort">Abort</button></div>
  </div>`;

  const mounted = mountOverlay({ id: 'cockpit-overlay', html, closeOnBackdrop: false,
    onClose: () => { if (raf) cancelAnimationFrame(raf); for (const [t, ty, fn, op] of listeners) t.removeEventListener(ty, fn, op); } });
  const overlay = mounted.overlay; const q = (s) => overlay.querySelector(s);
  const setStatus = (h) => { const el = q('#ck-status'); if (el) el.innerHTML = h; };
  const big = (h, c) => { const el = q('#ck-bigmsg'); if (el) { el.innerHTML = h || ''; el.style.color = c || '#ffcf3e'; } };

  const finish = (won, why) => {
    if (over) return; over = true; if (raf) cancelAnimationFrame(raf); raf = 0;
    csfx(won ? (takeoff ? 'flight-rotate' : 'flight-touchdown') : 'flight-crash', won ? 'hololock-win' : 'hololock-lose');
    disposeWindshield('ck-ws-vt');
    if (!won) creak('stress'); else creak('gear');
    big(won ? (takeoff ? '◇ AIRBORNE' : '◇ ON THE PAD') : '✕ ' + (why || 'CRASH'), won ? '#46e05a' : '#ff5b5b');
    setStatus(won ? `<span class="ck-win">◇ ${takeoff ? 'Clean lift-off — climbing away.' : 'Soft touchdown — skids down.'}</span>` : `<span class="ck-lose">✕ ${why || 'CRASH'}.</span>`);
    setTimeout(() => { mounted.close(); if (o.onResult) o.onResult({ won }); }, 1100);
  };

  levDrag(overlay, add, 'ck-coll', (f) => { coll = f; q('#ck-coll-knob').style.bottom = `${f * 100}%`; q('#ck-coll-fill').style.height = `${f * 100}%`; const v = q('#ck-coll-val'); if (v) v.textContent = `${Math.round(f * 100)}%`; });
  const lb = q('.ck-btn-l'), rb = q('.ck-btn-r');
  add(lb, 'pointerdown', (e) => { e.preventDefault(); cyc = -1; }); add(lb, 'pointerup', () => cyc = 0);
  add(rb, 'pointerdown', (e) => { e.preventDefault(); cyc = 1; }); add(rb, 'pointerup', () => cyc = 0);
  add(window, 'keydown', (e) => { const k = e.key.toLowerCase(); if (k === 'a' || k === 'arrowleft') cyc = -1; else if (k === 'd' || k === 'arrowright') cyc = 1; });
  add(window, 'keyup', (e) => { const k = e.key.toLowerCase(); if (['a', 'd', 'arrowleft', 'arrowright'].includes(k)) cyc = 0; });
  q('.mg-close').addEventListener('click', () => finish(false, 'ABORT'));
  q('.ck-btn-abort').addEventListener('click', () => finish(false, 'ABORT'));

  const tick = (t) => {
    if (over) return; const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    driftV += ((Math.random() - 0.5) * wind - cyc * 1.5) * dt; driftV *= 0.9; drift = clampNum(drift + driftV * dt, -1, 1);
    vs = (coll - HOVER) * 1.3;
    alt = clampNum(alt + vs * dt, 0, 1.05);
    if (Math.abs(drift) >= 1) { finish(false, takeoff ? 'DRIFTED OFF — clipped something' : 'DRIFTED OFF the pad'); return; }
    if (Math.abs(drift) > 0.55) big('DRIFTING — CENTRE IT', '#ff8a3e');
    else if (!takeoff && alt < 0.25 && vs < -0.24) big('TOO FAST — RAISE COLLECTIVE', '#ff5b5b');
    else big(takeoff ? (alt > 0.05 ? 'CLIMB' : '') : 'EASE IT DOWN', takeoff ? '#46e05a' : '#8fd0ff');
    if (takeoff && alt >= 1) { finish(Math.abs(drift) < 0.5); return; }
    if (!takeoff && alt <= 0.02) { finish(Math.abs(vs) < 0.2 && Math.abs(drift) < 0.4, Math.abs(vs) >= 0.2 ? 'HARD LANDING — dropped it on the pad' : 'OFF THE PAD'); return; }
    // render
    q('#ck-vt-craft').setAttribute('transform', `translate(${150 + drift * 90} ${180 - alt * 150})`);
    q('#ck-vt-tape').setAttribute('height', `${alt * 158}`); q('#ck-vt-tape').setAttribute('y', `${180 - alt * 158}`);
    q('#ck-vt-altn').textContent = `${Math.round(alt * 100)}%`;
    q('#ck-vt-drift').textContent = Math.abs(drift) < 0.1 ? 'CTR' : (drift < 0 ? '◀' : '▶') + Math.round(Math.abs(drift) * 100);
    q('#ck-vt-vs').textContent = (vs >= 0 ? '+' : '') + Math.round(vs * 500);
    setDeckLevel(overlay, Math.abs(drift));
    paintWindshield('ck-ws-vt', { pitch: vs * 30, bank: -drift * 10, height: alt, speed: 0.12, drift, hour: _target?.sky?.hour, weather: _target?.sky?.weather, wind: _target?.sky?.wind, phase: 'vtol' });
    raf = requestAnimationFrame(tick);
  };
  window.AudioEngine?.init?.(); csfx(takeoff ? 'flight-roll' : 'flight-approach', 'hololock-entry');
  last = performance.now(); raf = requestAnimationFrame(tick);
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. APPROACH — unified with takeoff: THROTTLE lever + CONTROL COLUMN, then flare
// ══════════════════════════════════════════════════════════════════════════════
export function openGlideslope(opts = {}) {
  if (opts.vtol) return openVtolLift(opts, 'landing');   // helicopters set down vertically
  ensureMgStyles(); ensureChassisStyles(); ensureTakeoffStyles(); ensureWindshieldStyles();
  const o = { skill: 4, difficulty: 5, emergency: false, deviceName: 'FIELD', onResult: null, ...opts };
  const edge = o.skill - o.difficulty;
  const STALL_BAND = clampNum(0.58 - edge * 0.02, 0.46, 0.66);
  const descentRate = o.emergency ? 0.10 : 0.075;    // approach clock 0→1
  const gustF = clampNum(0.3 + o.difficulty * 0.04 - o.skill * 0.02 + (o.emergency ? 0.25 : 0), 0.1, 0.9);

  let throttle = o.emergency ? 0 : 0.4, stick = 0, pitch = 0, height = 1, descent = 0, sink = 0.1, over = false, raf = 0, last = 0, dash = 0, flared = false;
  const listeners = [];
  const add = (t, ty, fn, op) => { t.addEventListener(ty, fn, op); listeners.push([t, ty, fn, op]); };

  const scr = `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id="ck-la-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e4c78"/><stop offset="1" stop-color="#1a6fa8"/></linearGradient>
      <linearGradient id="ck-la-gnd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f3a20"/><stop offset="1" stop-color="#161c10"/></linearGradient>
    </defs>
    <rect x="0" y="0" width="300" height="128" fill="url(#ck-la-sky)"/>
    <rect x="0" y="128" width="300" height="42" fill="url(#ck-la-gnd)"/>
    <polygon id="ck-la-rw" points="120,168 180,168 165,132 135,132" fill="#2a3420" stroke="#3f8a5c" stroke-width="1"/>
    <line id="ck-la-cl" x1="150" y1="168" x2="150" y2="132" stroke="#cfe8d6" stroke-width="1.5" stroke-dasharray="8 8"/>
    <!-- glideslope scale (right): keep the diamond centred -->
    <line x1="284" y1="20" x2="284" y2="150" stroke="#2b4a60" stroke-width="1.5"/>
    ${[20, 52, 85, 118, 150].map(y => `<circle cx="284" cy="${y}" r="3" fill="none" stroke="#5f8fa8" stroke-width="1"/>`).join('')}
    <polygon id="ck-la-gs" points="284,78 290,85 284,92 278,85" fill="#4fb8e0"/>
    <text x="284" y="14" fill="#5f8fa8" font-size="7" text-anchor="middle" font-family="monospace">G/S</text>
    <g id="ck-la-plane" transform="translate(70 40)"><path d="M-16,2 L10,-1 L16,2 L10,5 L-16,3 Z M-4,-2 L2,-9 L4,-2 Z M-16,3 L-20,-3 L-13,0 Z" fill="#eaf6ff" stroke="#4fb8e0" stroke-width="0.8"/></g>
  </svg>`;

  const html = `<div class="ck-panel mg-chassis">
    ${deviceHeader('&#128758;', o.emergency ? 'DEAD STICK' : 'APPROACH', 'LANDING &middot; ' + esc(o.deviceName).toUpperCase())}
    <div class="ck-deck-canopy">${windshieldHTML('ck-ws-la', 'FWD VIEW')}</div>
    <div class="ck-hud2"><span>ALT <b id="ck-la-alt">—</b></span><span>SINK <b id="ck-la-sink">0</b></span><span>G/S <b id="ck-la-gsr">—</b></span>
      <span class="ck-asi-wrap">THR <span class="ck-asi-bar"><span class="ck-asi-fill" id="ck-la-thrbar" style="background:linear-gradient(90deg,#7a5310,#ffb23e)"></span></span></span></div>
    <div class="mg-bezel">${bezelScrews()}<div class="ck-scr-wrap"><div class="ck-scr mg-screen" style="--mg-sweep-h:170px">${scr}${crtOverlays()}</div><div class="ck-bigmsg" id="ck-bigmsg"></div></div></div>
    ${deckStrip('CONTROL BUS', 'DEVIATION')}
    <div class="ck-status2" id="ck-status"><span class="ck-hint">${o.emergency ? 'No power — glide it down on the COLUMN.' : 'THROTTLE for energy, COLUMN for pitch. Hold the glidepath; FLARE at the threshold.'}</span></div>
    <div class="ck-levers">
      <div class="ck-lever" id="ck-la-thr"><div class="ck-lever-fill" id="ck-la-thrfill" style="height:${throttle * 100}%"></div><div class="ck-lever-knob" id="ck-la-thrknob" style="bottom:${throttle * 100}%"></div><div class="ck-lever-lbl">THROTTLE<b id="ck-la-thrval">${Math.round(throttle * 100)}%</b></div></div>
      <div class="ck-lever" id="ck-la-col"><div class="ck-lever-mid"></div><div class="ck-lever-knob" id="ck-la-colknob" style="bottom:50%"></div><div class="ck-lever-lbl">COLUMN<b id="ck-la-colval">NEUTRAL</b></div></div>
    </div>
    <div class="ck-actions"><button class="ck-btn ck-btn-abort">${o.emergency ? 'Bail' : 'Go Around'}</button></div>
  </div>`;

  const mounted = mountOverlay({ id: 'cockpit-overlay', html, closeOnBackdrop: false,
    onClose: () => { if (raf) cancelAnimationFrame(raf); for (const [t, ty, fn, op] of listeners) t.removeEventListener(ty, fn, op); } });
  const overlay = mounted.overlay; const q = (s) => overlay.querySelector(s);
  gearFx('extend');   // gear comes down as the approach begins
  const setStatus = (h) => { const el = q('#ck-status'); if (el) el.innerHTML = h; };
  const big = (h, c) => { const el = q('#ck-bigmsg'); if (el) { el.innerHTML = h || ''; el.style.color = c || '#ffcf3e'; } };

  const finish = (won, why) => {
    if (over) return; over = true; if (raf) cancelAnimationFrame(raf); raf = 0;
    csfx(won ? 'flight-touchdown' : 'flight-crash', won ? 'hololock-win' : 'hololock-lose');
    disposeWindshield('ck-ws-la');
    if (!won) creak('stress');
    big(won ? '◇ TOUCHDOWN' : '✕ ' + (why || 'CRASH'), won ? '#46e05a' : '#ff5b5b');
    setStatus(won ? '<span class="ck-win">◇ Mains, nose, brakes — down safe.</span>' : `<span class="ck-lose">✕ ${why || 'CRASH'}.</span>`);
    setTimeout(() => { mounted.close(); if (o.onResult) o.onResult({ won }); }, 1150);
  };

  levDrag(overlay, add, 'ck-la-thr', (f) => { throttle = f; q('#ck-la-thrknob').style.bottom = `${f * 100}%`; q('#ck-la-thrfill').style.height = `${f * 100}%`; const v = q('#ck-la-thrval'); if (v) v.textContent = `${Math.round(f * 100)}%`; });
  levDrag(overlay, add, 'ck-la-col', (f) => { stick = (f - 0.5) * 2; q('#ck-la-colknob').style.bottom = `${f * 100}%`; const v = q('#ck-la-colval'); if (v) v.textContent = stick > 0.1 ? `BACK ${Math.round(stick * 100)}%` : stick < -0.1 ? `FWD ${Math.round(-stick * 100)}%` : 'NEUTRAL'; });
  q('.mg-close').addEventListener('click', () => finish(false, 'GO-AROUND'));
  q('.ck-btn-abort').addEventListener('click', () => finish(false, 'GO-AROUND'));

  const tick = (t) => {
    if (over) return; const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    pitch += (stick - pitch) * Math.min(1, dt * 7);
    descent = clampNum(descent + descentRate * dt, 0, 1.05);
    // Sink rate: pull back (pitch up) + power reduce it; nose-down + idle steepen it.
    sink = clampNum(0.12 - stick * 0.10 - (throttle - 0.45) * 0.06 + (Math.random() - 0.5) * gustF * 0.03, 0, 0.30);
    height = clampNum(height - sink * dt, 0, 1);
    const dev = height - (1 - descent);   // >0 HIGH, <0 LOW
    // Fail modes.
    if (stick > STALL_BAND && throttle < 0.4) { big('STALL — NOSE DOWN, ADD POWER', '#ff5b5b'); if (height <= 0.5) { finish(false, 'STALL on final'); return; } }
    else if (stick < -0.25 && height < 0.22) { big('NOSE DOWN — PULL UP', '#ff8a3e'); if (height <= 0.03) { finish(false, 'NOSE-FIRST into the threshold'); return; } }
    else if (descent >= 0.85) { flared = flared || stick > 0.12; big('FLARE — EASE IT ON', '#ffcf3e'); }
    else if (dev > 0.18) big('HIGH — reduce power / nose down', '#ffb23e');
    else if (dev < -0.18) big('LOW — add power / nose up', '#ffb23e');
    else big('ON GLIDEPATH', '#46e05a');
    // Touchdown.
    if (height <= 0.02 || descent >= 1) {
      if (descent < 0.8) { finish(false, 'landed short — you dropped it in early'); return; }
      const onGs = Math.abs(dev) < 0.16, soft = sink < 0.14, gentle = stick > 0.05 && stick <= STALL_BAND;
      finish(onGs && soft && gentle && flared, !soft ? 'HARD LANDING — too much sink' : !onGs ? 'off the glidepath at the threshold' : 'you forgot to flare');
      return;
    }
    // Render.
    dash = (dash + (1 - descent) * 60 * dt) % 16;
    const g = Math.min(1, descent), half = 15 + g * 40, topY = 132 - g * 24, cx = 150;
    q('#ck-la-rw').setAttribute('points', `${cx - half},168 ${cx + half},168 ${cx + half * 0.55},${topY} ${cx - half * 0.55},${topY}`);
    q('#ck-la-cl').setAttribute('y2', `${topY}`); q('#ck-la-cl').setAttribute('stroke-dashoffset', `${dash}`);
    q('#ck-la-plane').setAttribute('transform', `translate(70 ${40 + (1 - height) * 78}) rotate(${-pitch * 20})`);
    const gy = clampNum(85 - dev * 260, 20, 150); const gs = q('#ck-la-gs'); gs.setAttribute('points', `284,${gy - 7} 290,${gy} 284,${gy + 7} 278,${gy}`); gs.setAttribute('fill', Math.abs(dev) < 0.16 ? '#46e05a' : '#ff8a3e');
    q('#ck-la-alt').textContent = `${Math.round(height * (o.emergency ? 300 : 600))}ft`;
    q('#ck-la-sink').textContent = `-${Math.round(sink * 900)}`;
    q('#ck-la-gsr').textContent = Math.abs(dev) < 0.16 ? 'ON' : dev > 0 ? 'HIGH' : 'LOW';
    q('#ck-la-thrbar').style.width = `${Math.round(throttle * 100)}%`;
    setDeckLevel(overlay, Math.min(1, Math.abs(dev) / 0.3));
    paintWindshield('ck-ws-la', { pitch: pitch * 20, bank: 0, height, speed: 0.32 + throttle * 0.4, hour: _target?.sky?.hour, weather: _target?.sky?.weather, phase: 'landing', airport: o.airport });
    raf = requestAnimationFrame(tick);
  };
  window.AudioEngine?.init?.(); csfx('flight-approach', 'hololock-entry');
  last = performance.now(); raf = requestAnimationFrame(tick);
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. TARGETING — the gun-pass reticle deck
// ══════════════════════════════════════════════════════════════════════════════
export function openTargeting(opts = {}) {
  ensureMgStyles(); ensureChassisStyles();
  const o = { skill: 4, difficulty: 6, deviceName: 'TARGET', onResult: null, ...opts };
  const edge = o.skill - o.difficulty;
  const lockRadius = clampNum(0.16 + edge * 0.014, 0.08, 0.28);
  const jink = clampNum(0.5 + o.difficulty * 0.06 - o.skill * 0.02, 0.3, 1.4);
  const lockRate = clampNum(0.55 + edge * 0.04, 0.3, 1.0);
  const TIME = 8;

  let ret = { x: 0.5, y: 0.5 }, tgt = { x: 0.5, y: 0.28 }, tgtT = 0, lock = 0, locked = false;
  let t0 = 0, over = false, raf = 0, last = 0;
  const listeners = [];
  const add = (t, ty, fn, op) => { t.addEventListener(ty, fn, op); listeners.push([t, ty, fn, op]); };

  const scr = `<svg viewBox="0 0 220 220" preserveAspectRatio="xMidYMid meet" id="ck-tgt-svg">
    <defs><radialGradient id="ck-tgt-bg" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="#06202a"/><stop offset="1" stop-color="#01080c"/></radialGradient></defs>
    <rect x="8" y="8" width="204" height="204" rx="10" fill="url(#ck-tgt-bg)" stroke="#22465a" stroke-width="2"/>
    ${[40, 70, 100].map(r => `<circle cx="110" cy="110" r="${r}" fill="none" stroke="#1c3a4a" stroke-width="1"/>`).join('')}
    <line x1="110" y1="14" x2="110" y2="206" stroke="#153040" stroke-width="1"/><line x1="14" y1="110" x2="206" y2="110" stroke="#153040" stroke-width="1"/>
    <g id="ck-tgt"><rect x="-9" y="-9" width="18" height="18" fill="none" stroke="#ff8a3e" stroke-width="2"/><circle cx="0" cy="0" r="2.5" fill="#ff8a3e"/></g>
    <g id="ck-ret"><circle cx="0" cy="0" r="16" fill="none" stroke="#4fb8e0" stroke-width="1.5"/>
      <line x1="-22" y1="0" x2="-8" y2="0" stroke="#4fb8e0" stroke-width="2"/><line x1="8" y1="0" x2="22" y2="0" stroke="#4fb8e0" stroke-width="2"/>
      <line x1="0" y1="-22" x2="0" y2="-8" stroke="#4fb8e0" stroke-width="2"/><line x1="0" y1="8" x2="0" y2="22" stroke="#4fb8e0" stroke-width="2"/></g>
  </svg>`;

  const html = `<div class="ck-panel mg-chassis">
    ${deviceHeader('&#127919;', 'TARGETING', 'GUN PASS &middot; ' + esc(o.deviceName).toUpperCase())}
    <div class="ck-hud2"><span>TGT <b>${esc(o.deviceName)}</b></span><span class="ck-asi-wrap">LOCK <span class="ck-asi-bar"><span class="ck-asi-fill" id="ck-lock" style="background:linear-gradient(90deg,#7a5310,#ffb23e)"></span></span></span></div>
    <div class="mg-bezel">${bezelScrews()}<div class="ck-scr mg-screen" style="--mg-sweep-h:220px">${scr}${crtOverlays()}</div></div>
    ${deckStrip('GUN BUS', 'LOCK')}
    <div class="ck-status2" id="ck-status"><span class="ck-hint">Move the pipper onto the target and hold it to LOCK — then FIRE (space / click).</span></div>
    <div class="ck-actions"><button class="ck-btn ck-btn-fire">Fire &#9251;</button><button class="ck-btn ck-btn-abort">Break Off</button></div>
  </div>`;

  const mounted = mountOverlay({ id: 'cockpit-overlay', html, closeOnBackdrop: false,
    onClose: () => { if (raf) cancelAnimationFrame(raf); for (const [t, ty, fn, op] of listeners) t.removeEventListener(ty, fn, op); } });
  const overlay = mounted.overlay; const svg = overlay.querySelector('#ck-tgt-svg');
  const setStatus = (h) => { const el = overlay.querySelector('#ck-status'); if (el) el.innerHTML = h; };

  const finish = (won) => {
    if (over) return; over = true; if (raf) cancelAnimationFrame(raf); raf = 0;
    csfx(won ? 'flight-guns' : 'flight-abort', won ? 'hololock-win' : 'hololock-lose');
    setStatus(won ? '<span class="ck-win">◇ SPLASH — target destroyed.</span>' : '<span class="ck-lose">✕ No hits — you overfly the target.</span>');
    setTimeout(() => { mounted.close(); if (o.onResult) o.onResult({ won }); }, 950);
  };
  const fire = () => { if (over) return; finish(!!locked); };
  const svgXY = (e) => { const r = svg.getBoundingClientRect(); return { x: clampNum((e.clientX - r.left) / r.width, 0, 1), y: clampNum((e.clientY - r.top) / r.height, 0, 1) }; };
  add(svg, 'pointermove', (e) => { ret = svgXY(e); });
  add(window, 'keydown', (e) => { const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') ret.x = clampNum(ret.x - 0.05, 0, 1); else if (k === 'arrowright' || k === 'd') ret.x = clampNum(ret.x + 0.05, 0, 1);
    else if (k === 'arrowup' || k === 'w') ret.y = clampNum(ret.y - 0.05, 0, 1); else if (k === 'arrowdown' || k === 's') ret.y = clampNum(ret.y + 0.05, 0, 1);
    else if (k === ' ' || k === 'spacebar') { e.preventDefault(); fire(); } });
  overlay.querySelector('.ck-btn-fire').addEventListener('click', fire);
  overlay.querySelector('.ck-btn-abort').addEventListener('click', () => finish(false));
  overlay.querySelector('.mg-close').addEventListener('click', () => finish(false));

  const tick = (t) => {
    if (over) return; const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t; if (!t0) t0 = t;
    tgtT -= dt; if (tgtT <= 0) { tgt.tx = 0.2 + Math.random() * 0.6; tgt.ty = 0.15 + Math.random() * 0.5; tgtT = 0.4 + Math.random() / jink; }
    tgt.x += ((tgt.tx ?? 0.5) - tgt.x) * Math.min(1, jink * dt * 2); tgt.y += ((tgt.ty ?? 0.3) - tgt.y) * Math.min(1, jink * dt * 2);
    const d = Math.hypot(ret.x - tgt.x, ret.y - tgt.y), on = d <= lockRadius;
    lock = clampNum(lock + (on ? lockRate : -lockRate * 1.3) * dt, 0, 1);
    const wasLocked = locked; locked = lock >= 1; if (locked && !wasLocked) csfx('flight-lock');
    const px = (v) => 14 + v * 192;
    overlay.querySelector('#ck-ret').setAttribute('transform', `translate(${px(ret.x)} ${px(ret.y)})`);
    overlay.querySelector('#ck-tgt').setAttribute('transform', `translate(${px(tgt.x)} ${px(tgt.y)})`);
    overlay.querySelector('#ck-ret').style.stroke = locked ? '#46e05a' : on ? '#ffb23e' : '#4fb8e0';
    overlay.querySelector('#ck-lock').style.width = `${Math.round(lock * 100)}%`;
    setDeckLevel(overlay, lock);
    if (locked && !wasLocked) setStatus('<span style="color:#46e05a">LOCK — FIRE!</span>');
    if ((t - t0) / 1000 >= TIME) { finish(false); return; }
    raf = requestAnimationFrame(tick);
  };
  window.AudioEngine?.init?.(); csfx('flight-approach', 'hololock-entry');
  last = performance.now(); raf = requestAnimationFrame(tick);
}
