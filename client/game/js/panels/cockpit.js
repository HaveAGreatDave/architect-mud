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
// Deck (focused overlay, server-authoritative): openTargeting reports { won } → the
// server resolve command decides the outcome. Takeoff and landing are NOT decks — they
// are flown in the continuous cockpit below.

import { setAreaPane } from '../render.js';
import { state } from '../state.js';
import { sfx, clampInt, clampNum, esc, mountOverlay, ensureChassisStyles, deviceHeader, bezelScrews, crtOverlays, deckStrip, setDeckLevel } from './minigame-common.js';
import { updateEngineAudio, stopEngineAudio, creak, spoolUp, spoolDown, groundFx, flapWhir, stallHorn, gearFx, visorFx, gunFx, aaWarn, tracerFx, aaGunFx, hitFx, lockTone, mslWarble, missileFx, missileRippleFx, flareFx, spraySfx } from './engine-audio.js';
import { ensureWindshieldStyles, windshieldHTML, paintWindshield, disposeWindshield, RENDER_TUNE, buildingRoofFt, BUILDING_FOOT, climbOutClear, VISIBLE_NEAR_F, VISIBLE_FAR_F, CLIMBOUT_MAX_F, CLIMBOUT_LAT_IN, CLIMBOUT_LAT_OUT, pushLightningStrike, surfaceBreakup } from './windshield.js';
import { suppressWeatherFx } from './weather-fx.js';
import { createState, step, readout, TYPES } from './flight-model.js';
import { applyFlightDrugFx, clearFlightDrugFx } from './flight-drugfx.js';
import { sendCmdSilent } from '../net.js';
import { hex2rgb, visorSpecFor } from './aircraft3d.js';

// Touch-primary devices (phones/tablets) have no keyboard for rudder pedals, so their fin
// auto-coordinates with the roll input; desktops (a fine pointer + keys) fly the rudder by hand
// on the rudder pedals (,/. or X/C). Evaluated once — the input class doesn't change mid-session.
const _touchPrimary = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

// Resting elevation ANGLE of the external chase camera's orbit arc (rad) — the behind-and-slightly-
// above pose. Derived from the same chaseUp/chaseBack the renderer uses, so a ⟲ reset returns to the
// exact default cam. The middle-drag orbit and the reset swing both work in this angle.
const REST_PITCH = Math.asin(RENDER_TUNE.chaseUp / RENDER_TUNE.chaseBack);

// Effective "speed of sound" (kt) for the orbit-cam engine doppler. Real sound is ~660 kt, which
// bends the pitch far too hard at flight speeds; this softer constant keeps the chase-cam doppler a
// gentle, chill wobble (clamped to ±~10% at the call site) rather than a jet-flyby shriek.
const DOPPLER_C = 1300;

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
  grasshopper:{ acc: '#9ad46a', chrome: 'minimal',   radar: 'sm' },   // olive-drab liaison scout
  locust:     { acc: '#ffd24a', chrome: 'analog',    radar: 'sm' },   // crop-duster / ag-plane
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

// The aircraft name printed on the yoke's name-plate is coloured by the craft's
// EXTERIOR paint (base) — but a dark paint would vanish against the dark plate, so
// we lift it toward white until it clears a brightness floor while keeping its hue.
// Returns null when there's no paint on file (leave the airframe's themed accent).
function legibleInk(hex) {
  const rgb = hex2rgb(hex);
  if (!rgb) return null;
  let [r, g, b] = rgb;
  const lum = () => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  for (let i = 0; i < 24 && lum() < 150; i++) { r += (255 - r) * 0.18; g += (255 - g) * 0.18; b += (255 - b) * 0.18; }
  return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}
const _hx = (rgb) => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
// Multiply a colour's brightness (m<1 darker, m>1 lighter) — builds the panel's gradient stops.
function shadeRgb(rgb, m) { return _hx(rgb.map(v => v * m)); }
// Blend a colour toward `to` by t (0..1) — lifts the cabin colour to a legible panel edge.
function mixRgb(rgb, to, t) { return _hx(rgb.map((v, i) => v + (to[i] - v) * t)); }

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
let _lastGround = null, _lastMap = null, _lastBiome = null, _lastRegions = null;

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
  if (_target.regions) _lastRegions = _target.regions;   // spatial regions → windshield region atmosphere grade

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
  document.body.classList.remove('ck-fullscreen', 'ck-hidepanel');   // drop the cabin immersive layouts if either was on
  stopEngineAudio();
}

// Engine sound for an occupant WALKING a walkable cabin (the Leviathan) — they're in a
// real MUD room, not on the cockpit HUD, so this drives ONLY the engine-audio loops
// (idle/power/wind, throttle- and speed-reactive) without mounting any panel over the
// room view. Fed the slim `cabin_audio` payload each flight tick; stopped by the
// `cockpit_close` the landing/disembark flow already sends (closeCockpit → stopEngineAudio).
export function cabinAudio(s) {
  if (isFlightSimActive() || isCockpitHudActive()) return;   // the pilot's cockpit / an open window overlay already owns the bus
  updateEngineAudio(s || {});
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
  // Unified Mode-7 world: the sim flies AND takes off in the real world — real runway tiles,
  // markings, PAPI and real buildings — so there's no separate hand-drawn airport scene to
  // crossfade from. worldBlend is pinned to 1 for pilot and passenger alike; the world is always
  // fully drawn, parked on the deck and aloft. (The legacy modal takeoff/landing decks still pass
  // their own fractional blend and keep the old airport scene.)
  const worldBlend = 1;
  // Fractional world offset from the eased position above vs. the map window's (integer) centre —
  // slides the Mode-7 camera smoothly between pushes instead of snapping a tile at a time. Set on
  // the deck too now, so the camera tracks the aircraft the moment it starts to roll.
  const mapOffset = a.fx != null ? { x: a.fx - (s.x ?? a.fx), y: a.fy - (s.y ?? a.fy) } : undefined;
  paintWindshield(id, {
    pitch: a.pitch, bank: a.roll, height: a.height ?? 0, speed: speedFrac,
    hour: s.sky?.hour, weather: s.sky?.weather, wind: s.sky?.wind, heading: a.hdg,
    event: s.sky?.event,   // named hero event — outranks `weather` for the canopy grade
    wxField: s.sky?.field, acX: a.fx, acY: a.fy,   // spatial weather cells + our world position
    // Both scenes' data are passed unconditionally (falling back to the last real values
    // once the server's own payload has moved on) — `worldBlend` above decides how much
    // of each windshield.js actually paints, not which one is available.
    map: s.map || _lastMap,
    phase: onGround ? 'ground' : 'cruise',
    worldBlend,
    airport: s.ground?.theme || _lastGround?.theme,
    helipad: s.ground?.helipad ?? _lastGround?.helipad ?? false,
    biomeBelow: s.biomeBelow ?? _lastBiome,
    roll: a.rwyRoll || 0,   // ground-roll distance — how far down the strip you've travelled
    regions: s.regions ?? _lastRegions,   // drives the windshield region atmosphere grade (The Reach dust, …)
    side: paxView === 'side', viewYaw: paxView === 'rear' ? 180 : 0,
    // Framed hull-cutout for the side/rear cabin windows only. Looking FORWARD (Q held) you're
    // seeing past the pilot out the windscreen — no cabin porthole frame — so the clean forward
    // canopy view (skyline glow, speed streaks, instrument reflection) reads under the yoke/throttle.
    windowClass: pax && paxView !== 'forward' ? (s.class || 'prop') : undefined,
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
      STALL: ['STALL — NOSE DOWN', 'r'], FIRE: ['ENGINE FIRE — EXTINGUISH', 'r'], WEATHER: ['SEVERE TURBULENCE', 'a'] };
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
  // Inferred danger enum → tint. (Was a numeric compare against the old string
  // rating — dead logic that always fell through to green.)
  const DANGER_TINT = { lethal: '#ff5b5b', high: '#ff5b5b', medium: '#ffb23e', low: '#8fd0ff', safe: '#46e05a' };
  const danger = (d) => DANGER_TINT[d] || '#46e05a';
  let rows = '';
  for (let y = miny; y <= maxy; y++) {
    let cells = '';
    for (let x = minx; x <= maxx; x++) {
      const n = byXY.get(`${x},${y}`);
      if (!n) { cells += '<span class="ck-mini-c"></span>'; continue; }
      const isC = n.is_current;
      cells += `<span class="ck-mini-c" style="color:${isC ? '#ffcf3e' : danger(n.danger)}" title="${esc(n.name)}">${isC ? '◉' : (n.marker || '▪')}</span>`;
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
      <button class="ck-pax-fsbtn" id="ck-pax-fsbtn" title="fullscreen" tabindex="-1">⛶</button>
      <button class="ck-pax-hidebtn" id="ck-pax-hidebtn" title="hide the text panel — more window" tabindex="-1">⊟</button>
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
  wirePaxChrome();
}

// Fullscreen / hide-panel + keyboard-focus, matching the flight-sim + hangar chrome. The cabin
// pane owns the keyboard by default (so Q/E swivel the view immediately instead of typing into
// chat); clicking the pane takes focus off the command box, clicking the command box gives it back.
function wirePaxChrome() {
  const root = document.getElementById('ck-hud-root'); if (!root) return;
  const fsBtn = document.getElementById('ck-pax-fsbtn');
  const hideBtn = document.getElementById('ck-pax-hidebtn');
  fsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const on = document.body.classList.toggle('ck-fullscreen');
    fsBtn.classList.toggle('on', on);
    if (on) { document.body.classList.remove('ck-hidepanel'); hideBtn?.classList.remove('on'); }   // fullscreen supersedes hide-panel
  });
  hideBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const on = document.body.classList.toggle('ck-hidepanel');
    hideBtn.classList.toggle('on', on);
    if (on) { document.body.classList.remove('ck-fullscreen'); fsBtn?.classList.remove('on'); }
  });
  root.tabIndex = -1;
  const cmdInput = document.getElementById('cmd-input');
  const focusPax = () => { try { if (document.activeElement === cmdInput) cmdInput.blur(); root.focus({ preventScroll: true }); } catch {} };
  root.addEventListener('pointerdown', focusPax);
  focusPax();
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
    const cell = s.map[ry][rx]; if (cell.kind === 'air' || cell.self) continue;
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
    /* Fullscreen / hide-panel toggles — the cabin twin of the flight-sim ⛶ / ⊟ chrome. */
    .ck-pax-fsbtn, .ck-pax-hidebtn { position:absolute; top:8px; z-index:3; background:rgba(6,12,18,.7);
      border:1px solid #16303f; color:var(--acc); width:24px; height:24px; border-radius:5px; cursor:pointer;
      font-size:13px; line-height:1; display:flex; align-items:center; justify-content:center; padding:0; }
    .ck-pax-fsbtn { right:8px; } .ck-pax-hidebtn { right:36px; }
    .ck-pax-fsbtn.on, .ck-pax-hidebtn.on { background:var(--acc); color:#05141f; border-color:var(--acc); }
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
    /* Looking off the nose (Q/E/S): hide the forward instrument panel + dials so the
       banked side/rear view out the glass gets the whole pane. The canopy flexes to fill. */
    .ck-hud.ck-looking .ck-grid, .ck-hud.ck-looking .ck-dials { display:none; }
    .ck-hud.ck-looking .ck-canopy { flex:1 1 auto; margin-bottom:8px; }
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
// 1.5. THE CONTINUOUS COCKPIT (client-sim + server-reconcile)  — Phase 1 slice
// ══════════════════════════════════════════════════════════════════════════════
// A persistent, always-live cockpit that runs the real flight-model.js physics at
// 60fps in the area pane. Draggable yoke/throttle/flaps (Pointer Events, mouse +
// touch). It streams state to the server via `flightsync`, reports wheels-up and
// touchdown via `flightevent`, and consumes `flight_ctx` for authoritative fuel +
// the world below. The yoke is physically inverted (pull DOWN = nose up). Retires
// the modal takeoff/glideslope decks for continuous craft (currently the Mayfly).

let _fsim = null;
const lerpN = (a, b, t) => a + (b - a) * t;

// Checkride guidance: highlight key (from the server's clientView) → the cockpit control
// it spotlights. Renders the persistent instruction card and glows the target control(s).
// cr = the server checkride clientView (null = not on a ride → tear the card + glows down).
const CKRIDE_GLOW = { engine: 'fsim-eng', throttle: 'fsim-thr', yoke: 'fsim-yoke' };
// Every control the tour or the plain card can spotlight — cleared as a set on any redraw so
// a stale glow (e.g. flaps/trim, which the plain-card highlight map doesn't know) never lingers.
const GLOW_IDS = ['fsim-eng', 'fsim-thr', 'fsim-yoke', 'fsim-flap', 'fsim-trim'];
function fsimClearGlows() { for (const id of GLOW_IDS) document.getElementById(id)?.classList.remove('ck-glow'); }

// ── Flight-school tour ────────────────────────────────────────────────────────
// The STARTUP stage of the checkride is taught with a self-paced, dismissable walkthrough
// (centred over the glass) instead of the plain top-left card: one step per control, each
// spotlighting the real cockpit widget with mobile/desktop-aware copy. Steps are pure UI
// teaching (client-only); the server checkride stays telemetry-paced and takes over its
// top-left cards from TAKEOFF on. `_touchPrimary` (pointer:coarse) picks the touch copy.
// `.k` = a keycap accent. Bodies allow inline HTML.
const TOUR_STEPS = [
  { id: 'fsim-yoke', title: 'THE YOKE', body: (m) => m
    ? 'The <b>yoke</b> is your control column — drag it with your <b>finger</b>. Left/right banks the wings into a turn. It\'s <b>inverted</b> like the real thing: drag <b>DOWN</b> to pull back and <b>climb</b>, drag up to descend.'
    : 'The <b>yoke</b> is your control column — steer it with the <span class="k">mouse</span>. Drag <b>left/right</b> to bank the wings into a turn. It\'s <b>inverted</b> like the real thing: drag <b>DOWN</b> to pull back and <b>climb</b>, push <b>up</b> to descend.' },
  { id: 'fsim-thr', title: 'THROTTLE', body: (m) => m
    ? 'The <b>throttle</b> sets engine power — <b>drag the lever</b> up for more, down for less. Run it <b>full</b> for takeoff, and ease it back to bleed off speed for landing.'
    : 'The <b>throttle</b> sets engine power. Tap <span class="k">A</span> to add power, <span class="k">Z</span> to cut it — or drag the lever. Run it <b>full</b> for takeoff, and ease it back to bleed off speed for landing.' },
  { id: 'fsim-flap', title: 'FLAPS', body: (m) => m
    ? '<b>Flaps</b> add lift so you can fly slower and steeper. <b>Drag the flap knob</b> down a notch or two for takeoff and landing; leave them <b>UP</b> for cruise.'
    : '<b>Flaps</b> add lift so you can fly slower and steeper. Drag the flap knob, or tap <span class="k">Y</span> to extend / <span class="k">H</span> to retract — a notch or two for takeoff and landing; <b>UP</b> for cruise.' },
  { id: 'fsim-trim', title: 'TRIM', body: (m) => m
    ? '<b>Trim</b> takes the load off the yoke so you don\'t have to hold a climb by hand. <b>Drag the wheel</b> to the <b>T/O</b> mark for takeoff. Up = nose down, down = nose up.'
    : '<b>Trim</b> takes the load off the yoke so you don\'t have to hold a climb by hand. Drag the wheel, or roll the <span class="k">mouse&nbsp;wheel</span> over it, to the <b>T/O</b> mark for takeoff. Up = nose down, down = nose up.' },
  { id: 'fsim-eng', title: 'TAKEOFF', body: () =>
    '<b>Takeoff:</b> full throttle straight down the runway. As the speed tape comes alive and she gets light on the wheels, ease the <b>yoke back</b> to lift the nose and climb away — keep the wings level. Then chase the glowing rings.<br><br>Flip the glowing <b>ENGINE&nbsp;master</b> (<span class="k">⏻</span>) to fire her up and begin.' },
];

function renderTour(F) {
  const tour = document.getElementById('fsim-tour');
  if (!tour) return;
  if (F.tourStep == null) F.tourStep = 0;
  tour.classList.add('show');
  if (F.tourRenderedStep === F.tourStep) return;   // already drawn this step — idempotent per tick
  F.tourRenderedStep = F.tourStep;
  const i = F.tourStep, total = TOUR_STEPS.length, st = TOUR_STEPS[i], last = i === total - 1;
  const dots = TOUR_STEPS.map((_, k) => `<span class="fsim-tour-dot${k === i ? ' on' : ''}"></span>`).join('');
  tour.innerHTML =
    `<button class="fsim-tour-x" id="fsim-tour-x" title="skip the tour" tabindex="-1">✕</button>` +
    `<div class="fsim-tour-hd">✈ FLIGHT SCHOOL · ${i + 1}/${total} — ${st.title}</div>` +
    `<div class="fsim-tour-body">${st.body(_touchPrimary)}</div>` +
    `<div class="fsim-tour-dots">${dots}</div>` +
    `<div class="fsim-tour-nav">` +
      `<button class="fsim-tour-btn" id="fsim-tour-back"${i === 0 ? ' disabled' : ''} tabindex="-1">‹ Back</button>` +
      `<button class="fsim-tour-btn fsim-tour-skip" id="fsim-tour-skip" tabindex="-1">Skip</button>` +
      `<button class="fsim-tour-btn fsim-tour-next" id="fsim-tour-next" tabindex="-1">${last ? 'Let\'s fly ▸' : 'Next ›'}</button>` +
    `</div>`;
  fsimClearGlows();
  document.getElementById(st.id)?.classList.add('ck-glow');
  tour.classList.remove('flash'); void tour.offsetWidth; tour.classList.add('flash');
  const dismiss = () => {   // ✕ / Skip / "Let's fly": tear the tour down and fall back to the
    F.tourDismissed = true; tour.classList.remove('show');   // plain STARTUP card + engine glow so
    F.checkrideStage = null;                                 // they still know to flip the engine
    if (F.checkride) renderCheckride(F, F.checkride);
  };
  document.getElementById('fsim-tour-x').onclick = dismiss;
  document.getElementById('fsim-tour-skip').onclick = dismiss;
  document.getElementById('fsim-tour-back').onclick = () => { if (F.tourStep > 0) { F.tourStep--; renderTour(F); } };
  document.getElementById('fsim-tour-next').onclick = () => { if (F.tourStep < total - 1) { F.tourStep++; renderTour(F); } else dismiss(); };
}

function renderCheckride(F, cr) {
  const card = document.getElementById('fsim-ckride');
  const tour = document.getElementById('fsim-tour');
  if (!card) return;
  if (!cr) {   // ride over (passed/blown/never started): hide card + tour, clear every glow, reset tour
    card.classList.remove('show'); tour?.classList.remove('show'); F.checkrideStage = null;
    F.tourStep = null; F.tourRenderedStep = null; F.tourDismissed = false;
    fsimClearGlows();
    return;
  }
  // STARTUP → the self-paced flight-school tour, unless the player skipped it (then fall through)
  if (cr.stageNum === 1 && !F.tourDismissed) { card.classList.remove('show'); renderTour(F); return; }
  tour?.classList.remove('show');   // TAKEOFF onward (or tour skipped): the plain top-left card takes over
  card.classList.add('show');
  if (cr.stage === F.checkrideStage) return;   // same stage → card + glow already right; nothing to redo
  F.checkrideStage = cr.stage;
  const n = cr.stageNum || 1, total = cr.stageTotal || 4;
  card.innerHTML = '<div class="fsim-ckride-hd"></div><div class="fsim-ckride-body"></div>';
  card.querySelector('.fsim-ckride-hd').textContent = `✈ CHECKRIDE · STEP ${n}/${total}${cr.stageName ? ' — ' + cr.stageName : ''}`;
  card.querySelector('.fsim-ckride-body').textContent = cr.instruction || '';
  card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');   // restart the attention pulse
  fsimClearGlows();
  for (const key of (cr.highlight || [])) document.getElementById(CKRIDE_GLOW[key])?.classList.add('ck-glow');
}

// ── Flaps control — per-airframe style ────────────────────────────────────────
// The detents map evenly onto the model's 0..1 `flaps` input; only the graphic + labels
// differ. `johnson` = a Cessna-style white wing-flaps lever (light craft); `quadrant` = an
// airliner detented flap lever, 0/1/2/3/FULL (the heavy); `switch` = the compact 3-position
// toggle (military/utility). A helicopter has NO flaps (the control is hidden entirely).
const FLAP_STYLES = {
  johnson:  { cap: 'WING FLAPS', detents: [{ v: 0, l: 'UP' }, { v: 0.33, l: '10°' }, { v: 0.67, l: '20°' }, { v: 1, l: 'FULL' }] },
  quadrant: { cap: 'FLAPS',      detents: [{ v: 0, l: '0' }, { v: 0.25, l: '1' }, { v: 0.5, l: '2' }, { v: 0.75, l: '3' }, { v: 1, l: 'FULL' }] },
  switch:   { cap: '',           detents: [{ v: 0, l: 'UP' }, { v: 0.5, l: '½' }, { v: 1, l: 'FULL' }] },
};
const FLAP_BY_CRAFT = { mayfly: 'johnson', mule: 'johnson', leviathan: 'quadrant', reaper: 'switch', carcass: 'switch', dragonfly: null, viper: null, grasshopper: 'johnson', locust: 'johnson' };
function flapStyleFor(craftType) {
  const key = craftType in FLAP_BY_CRAFT ? FLAP_BY_CRAFT[craftType] : 'switch';
  return key ? { key, ...FLAP_STYLES[key] } : null;   // null ⇒ no flaps (heli)
}
function buildFlapHtml(st) {
  if (!st) return '';   // heli — no flaps control at all
  const lbls = st.detents.map((d, i) => `<span data-fd="${i}"${i === 0 ? ' class="on"' : ''}>${d.l}</span>`).join('');
  const dual = st.key === 'quadrant';   // the airliner quadrant reads its scale down BOTH gate rails
  return `<div class="fsim-flap fsim-flap-${st.key}" id="fsim-flap">
    <div class="fsim-flap-body">
      <div class="fsim-flap-scale">${lbls}</div>
      <div class="fsim-flapsw-track" id="fsim-flapsw-track"><div class="fsim-flapsw-knob" id="fsim-flapsw-knob"></div></div>
      ${dual ? `<div class="fsim-flap-scale right">${lbls}</div>` : ''}
    </div>
    ${st.cap ? `<div class="fsim-flap-cap">${st.cap}</div>` : ''}
  </div>`;
}
// Air-to-air (Phase A): tighten flightsync when traffic is within this many tiles,
// and dead-reckon a contact's position at most this long before its next relay.
const FAST_SYNC_RANGE = 5, CONTACT_DR_MAX = 2.0;
// Air-to-air guns (Phase B): the client's gun-solution envelope (tiles + half-cone deg),
// the alt→world-z scale (mirrors windshield CONTACT_ALT_K) for the vertical aim term, and
// the burst cadence while the trigger's held (the server enforces its own harder cap).
const GUN_RANGE = 2.2, GUN_CONE = 11, GUN_ALT_K = 1 / 600, GUN_FIRE_MS = 120;   // ~8.3 rounds/s — the driving M2-Browning .50 cadence: one heavy thud + one tracer round per shot (audio, muzzle flash & tracer all fire on this cadence)
// The FX cadence above is for feel; the *network* burst command is paced separately. The
// server only resolves one gun burst per GUN_COOLDOWN_MS (550 air / 650 ground in
// plugins/flight/state.js + combat.js) and drops the rest — but every dropped command still
// spends a token in the connection's command rate-limiter (5/s, server/index.js), so sending
// at the 120ms visual cadence drains the bucket in ~4.5s and trips the "sending commands too
// fast" throttle. Pace the send to just above the server's burst window: FX stay at 120ms,
// the command goes out at ~1.5/s.
const GUN_CMD_AIR_MS = 600;      // > server A2A GUN_COOLDOWN_MS (550)
const GUN_CMD_GROUND_MS = 700;   // > server GROUND_GUN_COOLDOWN_MS (650)
// Air-to-air missiles (Phase C): the seeker envelope (range tiles + half-cone deg off the
// nose), the hold-to-lock time, and the min gap between launches. Mirror the server's
// MISSILE_* tunables in state.js — the server gate is deliberately a shade more lenient.
const MSL_RANGE = 8, MSL_CONE = 25, MSL_LOCK_MS = 2500, MSL_FIRE_MS = 1600;
// Swarm airframe (Viper): no lock — a bogey inside a wide forward cone is a valid ripple shot.
// Client cone kept just under the server's SWARM_CONE (45°) so we only greenlight shots it'll take.
const SWARM_CONE = 40, SWARM_FIRE_MS = 2300;
// The Viper's chin turret is a LIGHT machine gun, not the Reaper's cannon: it runs at roughly
// double the cadence for a fraction of the punch (the airframe's `gun_mult` 0.5 does the damage
// half server-side). Fires from ONE muzzle under the nose rather than a pair under the wings.
const GUN_FIRE_MS_LIGHT = 62;

// ── Missiles in the air (the shot you actually watch) ─────────────────────────
// Rounds off the rails are flown CLIENT-SIDE purely as a visual: the server owns the outcome
// (it resolves each inbound MISSILE_FLIGHT_MS after launch and prints the result), we just fly
// the things leaving the aircraft. A swarm ripples off one rail at a time on the server's own
// 120 ms stagger, alternating sides, so you see four separate launches, not one puff.
//
// They fly DRUNK on purpose. A no-lock ripple is a barrage of dumb seekers — that's what
// SWARM_PK_MULT (half the kill probability of a locked shot) means in the fiction — so each one
// leaves the rail on its own heading, wanders through a slow weave while the seeker gathers,
// and only settles onto the target late in the flight. A single LOCKED missile (Reaper) is
// launched through the same path with far less wander: it knows where it's going.
const MSL_STAGGER_MS = 120;     // matches the server's per-seeker resolve stagger
const MSL_LIFE_MS = 5200;       // how long we keep drawing one before it's out of the picture
const MSL_TRAIL = 16;           // smoke-trail samples kept per missile
const MSL_SPEED = 1.25;         // terminal speed (world tiles/s) — several × the airframe's own pace
const MSL_BOOST_S = 0.55;       // motor burn: launch speed → MSL_SPEED over this long
const MSL_TURN = 150;           // seeker authority (deg/s of heading correction)

// Where a no-target salvo goes: the point on the ground the boresight is pointed at. Mirrors the
// gun's ground convergence (windshield drawGunTracers) — nose down and the missiles walk in close,
// nose level and they run out ahead. Clamped so a level/nose-up shot still has somewhere to land.
function groundAim(F, s) {
  const hr = s.heading * Math.PI / 180;
  const pit = Math.min(-1.5, s.pitch || 0) * Math.PI / 180;         // treat level-or-up as a shallow dive
  const R = clampNum(Math.max(0.6, s.altitude / 600) / Math.tan(-pit), 0.8, 6);   // tiles ahead where the line meets the ground
  return { x: F.pos.x + Math.sin(hr) * R, y: F.pos.y - Math.cos(hr) * R, alt: 0 };
}
// Ripple `n` missiles off the rails at `tgt` — either { id } (track a live contact) or
// { x, y, alt } (a fixed point on the ground). `wander` scales the drunkenness.
function launchShots(F, now, n, tgt, wander) {
  F.shots = F.shots || [];
  for (let i = 0; i < n; i++) {
    F.shots.push({
      t0: now + i * MSL_STAGGER_MS, live: false, seed: Math.random() * 6.283,
      side: i % 2 ? 1 : -1, wander, tgt, trail: [], boomT: 0,
    });
  }
}
// Fly every shot forward one frame and return the windshield's view of them (offsets from us).
// Each missile: ignite on the aircraft's own vector (kicked off its rail to the side), boost to
// speed, then steer toward the target at a limited turn rate with a decaying sinusoidal weave
// laid over the top. It dies on proximity (a small burst) or when its life runs out.
function stepShots(F, now, dt, s) {
  if (!F.shots || !F.shots.length) return null;
  const view = [];
  for (const m of F.shots) {
    if (now < m.t0) continue;
    const age = (now - m.t0) / 1000;
    if (!m.live) {
      // Off the rail on our vector, angled out to its own side — the fan of a ripple launch.
      // Ignites a little ahead of and beside us (the stub-wing rails, not the pilot's lap) so
      // the motor doesn't light up in the middle of the cockpit view on the first frame.
      m.live = true;
      const lr = s.heading * Math.PI / 180;
      m.x = F.pos.x + Math.sin(lr) * 0.06 + Math.cos(lr) * 0.03 * m.side;
      m.y = F.pos.y - Math.cos(lr) * 0.06 + Math.sin(lr) * 0.03 * m.side;
      m.alt = s.altitude - 3;
      m.hdg = s.heading + m.side * (5 + m.wander * 12);
      m.spd = Math.max(0.12, Math.abs(s.airspeed) * RENDER_TUNE.worldPace);
    }
    if (m.boomT) { if (now - m.boomT > 420) m.dead = true; }
    else {
      // Live target: a contact keeps moving, so re-aim at it every frame (that's the seeker).
      let tx = m.tgt.x, ty = m.tgt.y, talt = m.tgt.alt;
      if (m.tgt.id && F.contacts) {
        const c = F.contacts.find(k => k.id === m.tgt.id);
        if (c) { tx = c.x; ty = c.y; talt = c.alt || 0; }
      }
      const dx = tx - m.x, dy = ty - m.y, rng = Math.hypot(dx, dy);
      // Seeker: turn toward the target, but only so fast — and add the weave. The wander decays
      // over the flight, so a missile that starts out drunk sobers up as it closes.
      const want = Math.atan2(dx, -dy) * 180 / Math.PI;
      const drunk = m.wander * Math.exp(-age / 1.6) * 26 * Math.sin(age * 3.1 + m.seed);
      let err = ((want + drunk - m.hdg + 540) % 360) - 180;
      m.hdg += clampNum(err, -MSL_TURN * dt, MSL_TURN * dt);
      m.spd += (MSL_SPEED - m.spd) * Math.min(1, dt / MSL_BOOST_S);
      const hr = m.hdg * Math.PI / 180;
      m.x += Math.sin(hr) * m.spd * dt; m.y += -Math.cos(hr) * m.spd * dt;
      m.alt += clampNum((talt - m.alt), -900 * dt, 900 * dt);
      if (rng < 0.14 || age > MSL_LIFE_MS / 1000) m.boomT = now;
    }
    m.trail.push([m.x, m.y, m.alt]);
    if (m.trail.length > MSL_TRAIL) m.trail.shift();
    view.push({
      dx: m.x - F.pos.x, dy: m.y - F.pos.y, altDiff: m.alt - s.altitude, hdg: m.hdg, age,
      boom: m.boomT ? clampNum((now - m.boomT) / 420, 0, 1) : 0,
      trail: m.trail.map(p => [p[0] - F.pos.x, p[1] - F.pos.y, p[2] - s.altitude]),
    });
  }
  F.shots = F.shots.filter(m => !m.dead);
  return view.length ? view : null;
}
// ── Building collision (CFIT) ─────────────────────────────────────────────────
// The windshield draws one deterministic building per built-up tile from its floor count; the sim
// collision-checks that SAME building so flying into a tower you can see out the glass hurts. The
// shared source of truth is the FLOOR COUNT, not the render's world-z: the renderer extrudes floors
// into a stylised world-z (bldgStretch etc.) and the camera eye-height rises as a √-compressed
// function of altitude, so world-z can't be both visually pretty AND linear in real feet. So the
// collision works in real feet off the floors (buildingRoofFt in windshield.js) — a shop tops out
// ~12 ft, a 22-storey tower ~264 ft — instead of the old flat hz·600 that put a 3-storey's roof at
// 353 ft and made you CFIT with wide-open air out the window. Shallow clip = damage; deep = write-off.
// Building collision half-width = the SAME footprint the windshield draws (BUILDING_FOOT),
// scaled by the live bldgFoot knob, so a plane hits a tower's visible mass — not a tiny box
// at the tile centre. (Was a fixed 0.12 back when buildings drew as thin spikes.)
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
  const foot = BUILDING_FOOT * (RENDER_TUNE.bldgFoot || 1);   // collision footprint tracks the drawn one
  let worst = null;
  for (let i = 1; i <= CFIT_SWEEP; i++) {
    const t = i / CFIT_SWEEP;
    const px = prev.x + (F.pos.x - prev.x) * t, py = prev.y + (F.pos.y - prev.y) * t;
    const wx = Math.round(px), wy = Math.round(py);   // one building per tile, at integer coords
    if (Math.abs(px - wx) > foot || Math.abs(py - wy) > foot) continue;   // outside the footprint
    const rx = Math.round(wx - mc.x + R), ry = Math.round(wy - mc.y + R);
    if (ry < 0 || ry >= map.length || rx < 0 || rx >= map[ry].length) continue;
    const roofFt = buildingRoofFt(wx, wy, map[ry][rx]);   // roof altitude in real feet (floors × storey)
    if (roofFt <= 0) continue;
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
        && s.altitude < roofFt) continue;
    const pen = roofFt - s.altitude;   // >0 ⇒ below the roofline ⇒ contact
    if (pen > 0 && (!worst || pen > worst.pen)) worst = { pen, roofFt };
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
  ['fog', 'Fog (N64)', 0, 1, 0.05],
  ['vlight', 'Vertex light', 0, 1.5, 0.05],
  ['coastWarp', 'Coast wobble', 0, 1.5, 0.05],
  ['bldgH', 'Bldg height', 0.05, 3, 0.05],
  ['bldgStretch', 'Vert stretch', 1, 15, 0.5],
  ['bldgFoot', 'Bldg width', 0.05, 1.5, 0.05],
  ['texRes', 'Texture res', 0.3, 4, 0.25],
  ['haze', 'Distance haze', 0.3, 3, 0.05],
  ['rwl', 'Runway length', 1, 8, 0.2],
  ['rwyRecede', 'Runway recede', 0.5, 6, 0.2],
  ['fov', 'Tunnel (FOV)', 0.5, 1.6, 0.02],
  ['treeDensity', 'Trees', 0, 2, 0.05],
  ['treeForest', 'Forest clump', 0.2, 0.9, 0.02],
  ['chaseBack', 'Chase dist', 0.5, 5, 0.1],
  ['chaseUp', 'Chase height', 0, 2, 0.05],
  ['chaseSink', 'Sit height', -0.2, 0.5, 0.01],
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
// (the Carcass wreck). The Mule is a cyberpunk carbon-fibre freighter in violet/magenta neon.
const FSIM_SKIN = {
  mayfly: { id: 'mayfly', acc: '#5fe0e6', rgb: [95, 224, 230] },   // ultralight trainer: bright daytime sky-aqua, plexi & bare alloy
  mule: { id: 'mule', acc: '#a874ff', rgb: [168, 116, 255] },
  leviathan: { id: 'leviathan', acc: '#3fd6c0', rgb: [63, 214, 192] },   // Soviet An-124 turquoise flightdeck
  reaper: { id: 'reaper', acc: '#ff9a38', rgb: [255, 154, 56] },   // A-10 Warthog: olive-drab armour + gunsight amber
  dragonfly: { id: 'dragonfly', acc: '#8fe36b', rgb: [143, 227, 107] },   // Mini 500: a light, exposed kit-heli bubble
  viper: { id: 'viper', acc: '#5fe6c0', rgb: [95, 230, 192] },   // attack-heli glass cockpit: black composite + cyan-green HUD, threat-red weapons
  // The two light singles each carry their own flightdeck now: the Grasshopper an olive-drab
  // L-4 liaison deck (khaki plates, lime dials), the Locust a gloss-black hot-rod sport deck
  // (amber dials, racing-red master).
  grasshopper: { id: 'grasshopper', acc: '#9ad46a', rgb: [154, 212, 106] },
  locust: { id: 'locust', acc: '#ffd24a', rgb: [255, 210, 74] },
};

function ensureFlightSimStyles() {
  if (document.getElementById('fsim-styles')) return;
  const s = document.createElement('style'); s.id = 'fsim-styles';
  s.textContent = `
    .fsim{ display:flex; flex-direction:column; gap:6px; font-family:var(--font,monospace); --cy:var(--accent,#8fd0ff); --mg:#ff4a9a; --gr:#5fe0a0; }
    .fsim-view{ position:relative; height:clamp(215px,40vh,460px); border-radius:8px; overflow:hidden; box-shadow:inset 0 0 0 2px #0f1c28, 0 0 12px rgba(0,0,0,.6); }
    .fsim-lamp{ position:absolute; top:8px; left:50%; transform:translateX(-50%); font:11px/1 monospace; letter-spacing:2px; z-index:3;
      color:#ff5a5b; background:rgba(40,4,6,.7); border:1px solid #ff5a5b; border-radius:5px; padding:3px 9px; opacity:0; transition:opacity .12s; }
    /* transient action toast (flap/gear/jettison confirmations) */
    .fsim-toast{ position:absolute; top:38%; left:50%; transform:translateX(-50%); font:11px/1 monospace; letter-spacing:2px; z-index:5;
      color:var(--cy); background:rgba(6,12,18,.82); border:1px solid var(--cy); border-radius:5px; padding:4px 11px; opacity:0; transition:opacity .18s; pointer-events:none; white-space:nowrap; }
    .fsim-toast.show{ opacity:1; }
    /* CHECKRIDE guidance card — the persistent instruction panel during a checkride. Sits
       top-left (clear of the centre rings), stays up the whole stage, and re-pulses on a
       stage change so the eye catches the new brief. Paired with .ck-glow spotlighting the
       control this stage wants (engine/throttle/yoke). */
    .fsim-ckride{ position:absolute; top:8px; left:8px; max-width:264px; z-index:6; padding:8px 10px;
      background:rgba(6,14,20,.88); border:1px solid var(--cy); border-radius:6px; box-shadow:0 3px 14px rgba(0,0,0,.6);
      color:#cfe9f2; font:10px/1.55 monospace; opacity:0; transform:translateY(-5px);
      transition:opacity .25s, transform .25s; pointer-events:none; }
    .fsim-ckride.show{ opacity:1; transform:none; }
    .fsim-ckride-hd{ color:var(--cy); font-weight:bold; letter-spacing:1px; font-size:9px; margin-bottom:4px; text-shadow:0 0 6px var(--cy); }
    .fsim-ckride.flash{ animation:ckflash .7s ease-out; }
    @keyframes ckflash{ 0%{ box-shadow:0 0 0 2px var(--cy), 0 3px 14px rgba(0,0,0,.6); } 100%{ box-shadow:0 0 0 0 rgba(0,0,0,0), 0 3px 14px rgba(0,0,0,.6); } }
    /* the pulsing spotlight on whichever control the current checkride stage points at */
    .ck-glow{ animation:ckpulse 1.15s ease-in-out infinite; }
    @keyframes ckpulse{ 0%,100%{ box-shadow:0 0 0 0 rgba(120,220,255,0); } 50%{ box-shadow:0 0 15px 3px rgba(120,220,255,.85); } }
    /* FLIGHT-SCHOOL TOUR — the self-paced STARTUP walkthrough. Big, centred over the glass,
       dismissable (✕ / Skip), one control per step with Back/Next paging. Replaces the small
       checkride card for the ground-teaching phase; in-flight cards stay top-left, clear of the rings. */
    .fsim-tour{ position:absolute; top:50%; left:50%; transform:translate(-50%,calc(-50% - 6px)); width:min(90%,460px); z-index:12;
      background:linear-gradient(180deg,rgba(8,18,26,.95),rgba(5,11,17,.95)); border:1px solid var(--cy); border-radius:10px;
      box-shadow:0 8px 42px rgba(0,0,0,.7), 0 0 22px rgba(95,208,255,.22); color:#daf0f7; font:13px/1.6 monospace;
      padding:16px 18px 14px; opacity:0; pointer-events:none; transition:opacity .28s, transform .28s;
      -webkit-backdrop-filter:blur(4px); backdrop-filter:blur(4px); }
    .fsim-tour.show{ opacity:1; transform:translate(-50%,-50%); pointer-events:auto; }
    .fsim-tour.flash{ animation:ckflash .7s ease-out; }
    .fsim-tour-hd{ color:var(--cy); font-weight:bold; letter-spacing:1px; font-size:12px; margin-bottom:9px; text-shadow:0 0 8px var(--cy); }
    .fsim-tour-body{ font-size:13px; line-height:1.65; color:#dbeef6; min-height:82px; }
    .fsim-tour-body b{ color:#fff; }
    .fsim-tour-body .k{ display:inline-block; color:var(--cy); font-weight:bold; border:1px solid rgba(95,208,255,.5); border-radius:4px; padding:0 4px; background:rgba(95,208,255,.08); }
    .fsim-tour-dots{ display:flex; gap:6px; justify-content:center; margin:13px 0 11px; }
    .fsim-tour-dot{ width:7px; height:7px; border-radius:50%; background:rgba(120,150,175,.35); }
    .fsim-tour-dot.on{ background:var(--cy); box-shadow:0 0 6px var(--cy); }
    .fsim-tour-nav{ display:flex; gap:8px; align-items:center; }
    .fsim-tour-btn{ font:bold 12px monospace; letter-spacing:.5px; padding:8px 15px; border-radius:6px; cursor:pointer;
      background:rgba(10,22,30,.8); color:#bfe0ee; border:1px solid rgba(95,208,255,.4); }
    .fsim-tour-btn:hover{ border-color:var(--cy); color:#fff; }
    .fsim-tour-btn:disabled{ opacity:.35; cursor:default; }
    #fsim-tour-back{ margin-right:auto; }
    .fsim-tour-next{ background:rgba(20,60,80,.72); border-color:var(--cy); color:#eaffff; }
    .fsim-tour-skip{ opacity:.75; }
    .fsim-tour-x{ position:absolute; top:8px; right:9px; width:23px; height:23px; border-radius:50%; border:1px solid rgba(120,150,175,.4);
      background:rgba(6,12,18,.7); color:#9fb8c8; font:12px monospace; line-height:1; cursor:pointer; }
    .fsim-tour-x:hover{ color:#fff; border-color:var(--cy); }
    /* KILL FEED — big, loud confirmation stack across the top of the glass. Each kill
       slams in, holds, then fades; the whole column is anchored top-centre above the HUD. */
    .fsim-killfeed{ position:absolute; top:6px; left:50%; transform:translateX(-50%); z-index:9;
      display:flex; flex-direction:column; align-items:center; gap:5px; pointer-events:none; width:max-content; max-width:92%; }
    .fsim-kill{ font:900 clamp(15px,3.4vw,26px)/1.05 monospace; letter-spacing:2px; text-align:center; white-space:nowrap;
      color:#5fe0a0; text-shadow:0 0 10px rgba(95,224,160,.9), 0 0 22px rgba(95,224,160,.5), 0 2px 3px rgba(0,0,0,.8);
      background:linear-gradient(180deg, rgba(8,26,18,.92), rgba(6,16,12,.86)); border:2px solid #5fe0a0; border-radius:7px;
      padding:6px 18px; box-shadow:0 0 18px rgba(95,224,160,.55), inset 0 0 12px rgba(95,224,160,.18);
      animation:fsimKillIn .28s cubic-bezier(.15,1.5,.4,1) both, fsimKillOut .5s ease 2.6s forwards; }
    .fsim-kill b{ color:#eaffef; }
    @keyframes fsimKillIn{ 0%{ opacity:0; transform:scale(.5) translateY(-8px); } 60%{ opacity:1; transform:scale(1.12); } 100%{ opacity:1; transform:scale(1); } }
    @keyframes fsimKillOut{ from{ opacity:1; } to{ opacity:0; transform:scale(.94); } }
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
    /* missile seeker building a lock — the reticle pulses amber until the tone goes green */
    .fsim-reticle.seek{ opacity:1; animation:fsimSeek .5s ease-in-out infinite; }
    @keyframes fsimSeek{ 0%,100%{ transform:scale(1); } 50%{ transform:scale(1.18); } }
    .fsim-reticle svg{ width:100%; height:100%; filter:drop-shadow(0 0 3px rgba(255,106,58,.6)); }
    /* glass panel row: PFD | MFD (Diamond DA42-inspired) */
    .fsim-glass{ display:flex; gap:6px; height:clamp(138px,19vh,196px); }
    .fsim-pfd,.fsim-mfd,.fsim-gauges{ position:relative; flex:1 1 0; background:#060c12; border:1px solid #16303f; border-radius:8px; overflow:hidden;
      box-shadow:inset 0 0 10px rgba(0,0,0,.7), 0 0 0 1px rgba(95,208,255,.08); }
    .fsim-pfd{ flex:0.6 1 0; }        /* left PFD */
    .fsim-mfd{ flex:0.6 1 0; }        /* right MFD squeezed to the SAME width as the PFD */
    .fsim-gauges{ flex:2 1 0; }       /* wide centre: gauges hug its edges, the yoke rises up its middle */
    .fsim-rightctl{ flex:0 0 158px; display:flex; gap:6px; }   /* throttle + start + flaps (roomier gate), to the right of the MFD */
    .fsim-pfd canvas,.fsim-mfd canvas,.fsim-gauges canvas{ width:100%; height:100%; display:block; image-rendering:pixelated; }
    .fsim-mfd-tog{ position:absolute; top:5px; right:5px; z-index:2; background:rgba(6,14,22,.8); border:1px solid var(--cy); color:var(--cy);
      border-radius:4px; font:8px monospace; padding:2px 5px; letter-spacing:1px; cursor:pointer; }
    .fsim-mfd-lbl{ position:absolute; top:6px; left:7px; z-index:2; font:8px monospace; letter-spacing:1px; color:var(--cy); opacity:.85; }
    /* controls: full yoke + throttle quadrant */
    /* control row: badge (bottom-left) | YOKE (aligned under gauges) | transponder (bottom-right) */
    /* min-height (not a fixed height): the radio deck on the right is taller than 120px, so a
       hard height clipped its bottom row (buttons + knobs) — worst in fullscreen, which only grows
       the view, never this band. Letting the row grow to its content shows the whole radio. */
    .fsim-ctl{ display:flex; gap:6px; align-items:stretch; min-height:120px; }
    /* ── bottom-left placard: a bolted, brushed-metal maker's plate ──────────── */
    /* display:flex is load-bearing, not cosmetic: as a plain block this flex-item computed a
       runaway intrinsic height that dragged the whole control band tall (and left justify-content
       inert). A real flex column packs the stamped lines and lets the band size to the radio. */
    .fsim-placard{ position:relative; display:flex; flex-direction:column; flex:0.6 1 0; justify-content:center; align-items:center; text-align:center; gap:3px; padding:11px 15px; overflow:hidden;
      border-radius:8px; border:1px solid #10161c;
      /* four hex-head bolts at the corners, over a brushed-metal field */
      background:
        radial-gradient(circle at 10px 10px, #ffffff 0 0.6px, #d6dade 0.6px 1.4px, #9098a0 1.4px 2.6px, #565e66 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at calc(100% - 10px) 10px, #ffffff 0 0.6px, #d6dade 0.6px 1.4px, #9098a0 1.4px 2.6px, #565e66 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at 10px calc(100% - 10px), #ffffff 0 0.6px, #d6dade 0.6px 1.4px, #9098a0 1.4px 2.6px, #565e66 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at calc(100% - 10px) calc(100% - 10px), #ffffff 0 0.6px, #d6dade 0.6px 1.4px, #9098a0 1.4px 2.6px, #565e66 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        repeating-linear-gradient(92deg, rgba(255,255,255,.035) 0 1px, rgba(0,0,0,.05) 1px 2px),
        linear-gradient(157deg, #4c545c 0%, #6b747c 22%, #3a4147 46%, #575f67 68%, #363c42 100%);
      box-shadow:inset 0 1px 0 rgba(255,255,255,.28), inset 0 -2px 5px rgba(0,0,0,.55), 0 2px 5px rgba(0,0,0,.5); }
    /* scene-reactive sheen: a diagonal glint whose opacity is driven by --sheen (bright day → 1, night → 0) */
    .fsim-plac-sheen{ position:absolute; inset:0; pointer-events:none; opacity:var(--sheen,0); transition:opacity .5s linear;
      background:linear-gradient(133deg, rgba(255,255,255,0) 34%, rgba(255,255,255,.26) 47%, rgba(255,255,255,.04) 52%, rgba(255,255,255,0) 62%); }
    /* engine-turned inner frame — a hairline bevel a few px in from the bolts, so the plate reads
       as a stamped bezel rather than a flat panel. Themes retint the border via their own rule. */
    .fsim-placard::before{ content:''; position:absolute; inset:6px; border-radius:5px; pointer-events:none; z-index:1;
      border:1px solid rgba(255,255,255,.10); box-shadow:inset 0 1px 0 rgba(255,255,255,.07), inset 0 -1px 0 rgba(0,0,0,.42), inset 0 0 20px rgba(0,0,0,.24); }
    .fsim-placard>*{ position:relative; z-index:2; }
    /* machined corner rivets — a domed steel head (off-centre catchlight) seated in the plate,
       its drive slot canted a different way at each corner. Sits over the theme's flat bolt dot. */
    .fsim-plac-rivet{ position:absolute; width:11px; height:11px; border-radius:50%; z-index:3; pointer-events:none;
      background:radial-gradient(circle at 35% 28%, #f7f9fb 0 8%, #d2d8de 28%, #8b939d 60%, #474d55 86%, #2a2f36 100%);
      box-shadow:0 1px 2px rgba(0,0,0,.6), inset 0 -1.5px 2px rgba(0,0,0,.5), inset 0 1px 1px rgba(255,255,255,.75), 0 0 0 1px rgba(0,0,0,.42); }
    .fsim-plac-rivet::after{ content:''; position:absolute; inset:2.5px; border-radius:1px; border-top:1.5px solid rgba(0,0,0,.42); transform:rotate(var(--r,32deg)); }
    .fsim-plac-rivet.tl{ top:6px; left:6px } .fsim-plac-rivet.tr{ top:6px; right:6px }
    .fsim-plac-rivet.bl{ bottom:6px; left:6px } .fsim-plac-rivet.br{ bottom:6px; right:6px }
    /* every label is engraved into the plate: a dark recessed top edge + a lit lower lip, so the
       text reads as cut metal, never printed on top (matches the die-struck registration). */
    .fsim-plac-title{ font-size:9px; letter-spacing:2.5px; color:#20262c; text-shadow:0 -1px 1px rgba(0,0,0,.42), 0 1px 0 rgba(255,255,255,.4); }
    /* die-struck registration: the hero stamp — big, wide-tracked, and punched INTO the plate with a
       recessed top edge + a lit lower lip + a soft cast shadow below the character. */
    .fsim-plac-reg{ font-size:27px; font-weight:800; letter-spacing:5px; line-height:.98; color:#101418;
      text-shadow:0 -1px 1px rgba(0,0,0,.78), 0 1px 0 rgba(255,255,255,.62), 0 2px 2px rgba(0,0,0,.55), 0 3px 7px rgba(0,0,0,.34);
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .fsim-plac-model{ font-size:10px; letter-spacing:1.4px; color:#3c434a; text-shadow:0 -1px 1px rgba(0,0,0,.42), 0 1px 0 rgba(255,255,255,.42); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .fsim-plac-own{ font-size:11px; letter-spacing:1.2px; color:#2a3037; text-shadow:0 -1px 1px rgba(0,0,0,.42), 0 1px 0 rgba(255,255,255,.42); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    /* engraved field labels (REG / MODEL / OWNER) — the small caps to the left of each value, so the plate reads like a real registration certificate */
    .fsim-plac-k{ font-size:7px; letter-spacing:1.5px; color:#20262c; text-shadow:0 -1px 1px rgba(0,0,0,.38), 0 1px 0 rgba(255,255,255,.4); opacity:.75; margin-right:5px; }
    .fsim-plac-own.rented{ color:#7a3410; text-shadow:0 -1px 1px rgba(0,0,0,.4), 0 1px 0 rgba(255,255,255,.3); }
    /* cabin-occupancy readout: engraved label + a row of seat "LED" pips on the plate */
    .fsim-plac-seats{ display:flex; align-items:center; justify-content:center; gap:3px; margin-top:3px; }
    .fsim-plac-seats .lbl{ font-size:8px; letter-spacing:1px; color:#20262c; text-shadow:0 -1px 1px rgba(0,0,0,.4), 0 1px 0 rgba(255,255,255,.38); margin-right:2px; }
    .fsim-plac-seats .pip{ width:8px; height:8px; border-radius:50%; box-shadow:inset 0 1px 1px rgba(255,255,255,.4), inset 0 -1px 1px rgba(0,0,0,.4), 0 1px 2px rgba(0,0,0,.5); }
    /* ── engine-turned (guilloché) face: overlapping spun-metal arcs, blended so it reads on any theme skin ── */
    .fsim-plac-guilloche{ position:absolute; inset:0; pointer-events:none; opacity:.16; mix-blend-mode:overlay;
      background:
        repeating-radial-gradient(circle at 22% 46%, rgba(255,255,255,.5) 0 0.5px, rgba(0,0,0,.5) 0.5px 2.4px),
        repeating-radial-gradient(circle at 78% 54%, rgba(255,255,255,.45) 0 0.5px, rgba(0,0,0,.45) 0.5px 2.4px),
        repeating-radial-gradient(circle at 50% 128%, rgba(255,255,255,.4) 0 0.5px, rgba(0,0,0,.4) 0.5px 3px); }
    /* ── engraved data strip: a barcode ETCHED into the plate — each bar is a groove (dark recess
       wall + a lit lower lip), tone-matched so it reads as cut metal on any skin, not printed ink ── */
    .fsim-plac-barcode{ display:flex; align-items:center; justify-content:center; gap:6px; margin-top:4px; }
    .fsim-plac-barcode .bars{ height:10px; width:80px; border-radius:1px;
      background:repeating-linear-gradient(90deg,
        rgba(0,0,0,.55) 0 1px, rgba(255,255,255,.34) 1px 1.6px, transparent 1.6px 3px,
        rgba(0,0,0,.55) 3px 4.3px, rgba(255,255,255,.34) 4.3px 4.9px, transparent 4.9px 6px,
        rgba(0,0,0,.55) 6px 6.7px, rgba(255,255,255,.34) 6.7px 7.3px, transparent 7.3px 9px); }
    .fsim-plac-barcode .sn{ font:7px/1 monospace; letter-spacing:1.5px; color:#20262c; text-shadow:0 -1px 1px rgba(0,0,0,.5), 0 1px 0 rgba(255,255,255,.4); white-space:nowrap; }
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
    /* switch thrown ON: it lights up hard — accent border, a lit legend, an inner+outer accent bloom
       and a bright twin-ring LED. Reads as a real backlit rocker snapping on. */
    .fsim-nightsw.on{ color:var(--cy-lit,var(--cy)); border-color:var(--cy-lit,var(--cy));
      background:linear-gradient(180deg, var(--cy-lit-dim,rgba(95,208,255,.24)), #0a0f14 72%);
      box-shadow:inset 0 1px 0 rgba(255,255,255,.16), inset 0 0 8px var(--cy-lit-dim,rgba(95,208,255,.24)), 0 0 11px var(--cy-lit,var(--cy)), 0 0 24px var(--cy-lit-dim,rgba(95,208,255,.24));
      text-shadow:0 0 7px var(--cy-lit,var(--cy)); }
    .fsim-nightsw.on .fsim-nightsw-led{ background:var(--cy-lit,var(--cy)); box-shadow:0 0 5px var(--cy-lit,var(--cy)), 0 0 11px var(--cy-lit,var(--cy)), inset 0 0 2px rgba(255,255,255,.7); }
    /* no engine = no power to the light circuits: the switches read dead until the master's on */
    .fsim-nightsw.nopwr{ opacity:.4; cursor:not-allowed; }
    /* ── PANEL lights ON: the flightdeck backlights in --cy-lit (the airframe's VIVID stock accent,
       not the muted paint) — glass panels bloom from within, legends + titles glow, LCD haloes ── */
    .fsim-nightlit .fsim-pfd,.fsim-nightlit .fsim-mfd,.fsim-nightlit .fsim-gauges{ box-shadow:inset 0 0 32px var(--cy-lit-dim,rgba(95,208,255,.22)), inset 0 0 7px var(--cy-lit,var(--cy)), 0 0 22px var(--cy-lit-dim,rgba(95,208,255,.18)); border-color:var(--cy-lit,var(--cy)); }
    .fsim-nightlit .fsim-mfd-lbl,.fsim-nightlit .fsim-mfd-tog{ color:var(--cy-lit,var(--cy)); text-shadow:0 0 9px var(--cy-lit,var(--cy)), 0 0 3px var(--cy-lit,var(--cy)); }
    .fsim-nightlit .fsim-radio-lcd{ box-shadow:inset 0 0 8px rgba(0,0,0,.85), 0 0 15px var(--cy-lit-dim,rgba(95,208,255,.2)); }
    .fsim-nightlit .fsim-xpdr-title{ color:var(--cy-lit,var(--cy)); text-shadow:0 0 6px var(--cy-lit,var(--cy)); }
    .fsim-nightlit .fsim-thr-slot{ box-shadow:inset 0 0 4px #000, 0 0 9px var(--cy-lit-dim,rgba(95,208,255,.2)); }
    .fsim-yoke{ position:relative; flex:2 1 0; background:radial-gradient(circle at 50% 26%,#0e1a24,#070d13); border:1px solid #16303f;
      border-radius:12px; touch-action:none; cursor:grab; overflow:visible; perspective:1000px; box-shadow:inset 0 0 14px rgba(0,0,0,.7); }
    .fsim-yoke.drag{ cursor:grabbing; }
    /* Big yoke anchored HIGH: it rises up into the centre of the gauges panel (between the
       edge gauges) and its pull-down never drags it off the bottom of the frame. Seated so the
       hub nameplate sits at the glass/band seam — not floating mid-gauges. */
    .fsim-yoke-svg{ position:absolute; left:17%; top:-82%; width:66%; height:188%; transform-style:preserve-3d; will-change:transform;
      transform-origin:50% 66%; pointer-events:auto; filter:drop-shadow(0 7px 10px rgba(0,0,0,.65)); }
    /* the stick art rises up out of the yoke well; letting its painted shapes catch pointer
       events (they bubble to the #fsim-yoke pad) means you can grab it anywhere, not just the base */
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
    .fsim-side{ flex:1 1 auto; min-height:0; display:flex; flex-direction:column; gap:6px; align-items:stretch; }
    /* flaps + trim share one horizontal row so they sit side by side instead of stacking/overlapping */
    .fsim-ft-row{ flex:1 1 auto; min-height:0; display:flex; gap:6px; align-items:stretch; }
    /* engine master: a round accent button with a power glyph that recesses when running */
    .fsim-engbtn{ flex:0 0 auto; align-self:center; width:52px; height:52px; border-radius:50%; border:2px solid var(--cy); color:var(--cy);
      background:radial-gradient(circle at 50% 34%,#0e2230,#06121c); font-size:22px; line-height:1; cursor:pointer; user-select:none;
      display:flex; align-items:center; justify-content:center; box-shadow:0 3px 0 rgba(0,0,0,.55), 0 5px 9px rgba(0,0,0,.5); transition:transform .09s, box-shadow .09s, text-shadow .12s; }
    .fsim-engbtn:active{ transform:translateY(2px); }
    .fsim-engbtn.on{ transform:translateY(3px); box-shadow:inset 0 3px 9px rgba(0,0,0,.85); text-shadow:0 0 10px var(--cy); }
    /* ── Flaps — per-airframe graphic; drag/click the gate to the nearest notch. Bigger +
       translucent (glassy), so it reads as a real unit and ghosts nicely over the external view. ── */
    .fsim-flap{ flex:1 1 auto; display:flex; flex-direction:column; gap:3px; min-height:0; overflow:hidden; }
    .fsim-flap-body{ flex:1 1 auto; display:flex; gap:6px; align-items:stretch; min-height:46px; }
    .fsim-flap-scale{ flex:0 0 auto; display:flex; flex-direction:column; justify-content:space-between; font:9.5px monospace; letter-spacing:.5px; color:#8aa0b2; padding:2px 0; }
    .fsim-flap-scale span.on{ color:var(--cy); text-shadow:0 0 6px var(--cy); }
    .fsim-flapsw-track{ position:relative; flex:0 0 26px; background:rgba(4,8,12,.5); border:1px solid rgba(120,150,175,.35); border-radius:6px; cursor:pointer; box-shadow:inset 0 0 6px rgba(0,0,0,.6); touch-action:none; }
    .fsim-flapsw-knob{ position:absolute; left:3px; right:3px; height:28%; top:6%; border-radius:5px; background:linear-gradient(180deg,#d6e8f5,#7f9bb0); box-shadow:0 2px 6px rgba(0,0,0,.6); transition:top .1s; }
    .fsim-flap-cap{ flex:0 0 auto; text-align:center; font:8.5px monospace; letter-spacing:1.5px; color:#93aabc; }
    /* Johnson bar (Cessna / light craft) — a chunky WHITE wing-flaps lever in a smoked-glass case. */
    .fsim-flap-johnson{ background:rgba(10,13,17,.5); border:1px solid rgba(120,140,150,.3); border-radius:7px; padding:4px 6px; -webkit-backdrop-filter:blur(5px); backdrop-filter:blur(5px); }
    .fsim-flap-johnson .fsim-flapsw-track{ background:rgba(6,9,12,.55); border-color:rgba(120,140,150,.3); }
    .fsim-flap-johnson .fsim-flapsw-knob{ height:32%; background:linear-gradient(180deg,#fbfbfb,#c6cacc); border:1px solid #9aa0a2; }
    .fsim-flap-johnson .fsim-flap-cap{ color:#bcc2c6; }
    /* Airliner quadrant (the heavy) — a dark gated lever on a translucent brushed-metal plate. */
    .fsim-flap-quadrant{ background:linear-gradient(180deg,rgba(70,76,84,.55),rgba(30,34,40,.55)); border:1px solid rgba(150,160,170,.4); border-radius:6px; padding:4px 6px; box-shadow:inset 0 1px 0 rgba(255,255,255,.1); -webkit-backdrop-filter:blur(5px); backdrop-filter:blur(5px); }
    .fsim-flap-quadrant .fsim-flap-body{ gap:4px; }
    .fsim-flap-quadrant .fsim-flapsw-track{ background:rgba(8,10,12,.6); border-color:rgba(0,0,0,.6); }
    .fsim-flap-quadrant .fsim-flapsw-knob{ height:20%; background:linear-gradient(180deg,#34393e,#101315); border:1px solid #000; box-shadow:0 2px 5px rgba(0,0,0,.7); }
    .fsim-flap-quadrant .fsim-flap-scale{ color:#d2d6d8; }
    .fsim-flap-quadrant .fsim-flap-cap{ color:#d2d6d8; }
    /* elevator trim: NOSE DOWN (top) ↔ NOSE UP (bottom), a scrolling bead-chain wheel with a
       T/O (take-off / neutral) detent and a bright position handle. drag/roll/click to set. */
    .fsim-trim{ flex:1 1 auto; display:flex; flex-direction:column; align-items:center; gap:3px; min-height:0; }
    .fsim-trim-end{ font:6px monospace; line-height:1.05; letter-spacing:.5px; text-align:center; opacity:.85; }
    .fsim-trim-nd{ color:#e79364; }   /* nose-down warm */
    .fsim-trim-nu{ color:#5fd0e0; }   /* nose-up cool */
    .fsim-trim-wheel{ position:relative; flex:1 1 auto; width:26px; min-height:64px; border-radius:8px; overflow:hidden; cursor:ns-resize; touch-action:none;
      background:linear-gradient(90deg,#03070b,#0c1620 45%,#0c1620 55%,#03070b); border:1px solid #16303f; box-shadow:inset 0 0 8px #000, 0 1px 2px rgba(255,255,255,.15); }
    /* the bead chain — a vertical run of glossy beads tiled every 20px, scrolled by trim */
    .fsim-trim-drum{ position:absolute; left:50%; margin-left:-8px; width:16px; top:-50%; height:200%; will-change:transform;
      background-image:radial-gradient(circle at 50% 42%,#8fccff 0 4.4px,#3f86e0 4.4px 6px,rgba(60,120,220,.22) 6px 7.2px,transparent 7.2px);
      background-size:100% 20px; background-repeat:repeat-y; filter:drop-shadow(0 0 3px rgba(95,180,255,.5)); }
    .fsim-trim-detent{ position:absolute; left:0; right:0; top:50%; height:0; pointer-events:none; }
    .fsim-trim-detent::before{ content:''; position:absolute; left:0; right:0; top:-1px; height:2px; background:var(--cy); box-shadow:0 0 5px var(--cy); opacity:.8; }
    .fsim-trim-detent span{ position:absolute; left:1px; top:0; transform:translateY(-50%); font:5px monospace; letter-spacing:.3px; color:#a7bccb; background:rgba(4,10,16,.72); padding:0 1px; border-radius:1px; }
    .fsim-trim-handle{ position:absolute; left:1px; right:1px; height:6px; margin-top:-3px; border-radius:3px; pointer-events:none; transition:top .06s linear;
      background:linear-gradient(#f0f7ff,#9fbfe0); box-shadow:0 0 6px var(--cy),0 1px 2px rgba(0,0,0,.6); }
    .fsim-trim-val{ font:9px monospace; color:#6f8698; letter-spacing:.5px; }
    .fsim-trim-val.set{ color:var(--yellow,#ffb43a); text-shadow:0 0 5px var(--yellow,#ffb43a); }
    .fsim-tunebtn{ position:absolute; top:6px; right:8px; z-index:4; background:rgba(6,12,18,.82); border:1px solid #35586e; color:#eef6ff; text-shadow:0 1px 2px rgba(0,0,0,.75);
      border-radius:6px; width:24px; height:22px; font-size:12px; line-height:1; cursor:pointer; }
    .fsim-fsbtn{ position:absolute; top:6px; right:36px; z-index:4; background:rgba(6,12,18,.82); border:1px solid #35586e; color:#eef6ff; text-shadow:0 1px 2px rgba(0,0,0,.75);
      border-radius:6px; width:24px; height:22px; font-size:13px; line-height:1; cursor:pointer; }
    .fsim-fsbtn.on{ background:var(--cy); color:#05141f; border-color:var(--cy); }
    .fsim-hidebtn{ position:absolute; top:6px; right:64px; z-index:4; background:rgba(6,12,18,.82); border:1px solid #35586e; color:#eef6ff; text-shadow:0 1px 2px rgba(0,0,0,.75);
      border-radius:6px; width:24px; height:22px; font-size:12px; line-height:1; cursor:pointer; }
    .fsim-hidebtn.on{ background:var(--cy); color:#05141f; border-color:var(--cy); }
    /* Abort button — top-left, red so it reads as an exit hatch, not a normal control. */
    .fsim-abortbtn{ position:absolute; top:6px; left:8px; z-index:6; height:22px; padding:0 8px; border-radius:5px; font-size:10px; letter-spacing:1px; line-height:20px; cursor:pointer;
      background:rgba(40,10,10,.72); border:1px solid #7a3a3a; color:#ff8a5b; }
    .fsim-abortbtn:hover{ border-color:#ff8a5b; box-shadow:0 0 8px rgba(255,120,80,.4); }
    .fsim-abortbtn:active{ transform:translateY(1px); }
    .fsim-abortbtn.armed{ background:var(--warn,#ff5b5b); color:#160404; border-color:var(--warn,#ff5b5b); }
    /* Disembark button — sits below the fuel gauge (which occupies the row under ABORT), green so it reads as a safe exit. Hidden unless on the ground. */
    .fsim-disembarkbtn{ display:none; position:absolute; top:44px; left:8px; z-index:6; height:22px; padding:0 8px; border-radius:5px; font-size:10px; letter-spacing:1px; line-height:20px; cursor:pointer;
      background:rgba(8,32,20,.72); border:1px solid #1c6a44; color:#57e6a0; }
    .fsim-disembarkbtn.on{ display:block; }
    .fsim-disembarkbtn:hover{ border-color:#57e6a0; box-shadow:0 0 8px rgba(70,224,120,.4); }
    .fsim-disembarkbtn:active{ transform:translateY(1px); }
    /* Crop-duster SPRAY button (ag-planes only) — sits at the lower-left, chem-green. */
    .fsim-spraybtn{ position:absolute; bottom:8px; left:8px; z-index:6; height:24px; padding:0 10px; border-radius:5px;
      font:bold 10px/22px monospace; letter-spacing:1px; cursor:pointer;
      background:rgba(12,34,16,.78); border:1px solid #3c7a2e; color:#b6f26a; }
    .fsim-spraybtn:hover{ border-color:#b6f26a; box-shadow:0 0 10px rgba(150,220,90,.45); }
    .fsim-spraybtn:active{ transform:translateY(1px); }
    /* Spray mist FX — a fine chemical haze that drifts down the lower windshield on a dusting pass. */
    .fsim-spray-mist{ position:absolute; left:0; right:0; bottom:0; height:46%; z-index:4; pointer-events:none; opacity:0;
      background:linear-gradient(180deg, rgba(196,230,150,0) 0%, rgba(196,230,150,.16) 55%, rgba(210,240,170,.34) 100%); }
    .fsim-spray-mist.on{ animation:fsim-spray 1.7s ease-out; }
    @keyframes fsim-spray{ 0%{ opacity:0; transform:translateY(-8%); } 22%{ opacity:1; } 100%{ opacity:0; transform:translateY(4%); } }
    /* Crop-duster hopper rig — a schematic of the plane's belly: on a dusting pass the clamshell
       bay doors swing open and the booms fan atomised spray. Bottom-centre, one pass then closes. */
    .fsim-sprayrig{ position:absolute; left:50%; bottom:7%; transform:translateX(-50%); width:min(48%,230px); z-index:5; pointer-events:none; opacity:0; }
    .fsim-sprayrig.on{ animation:sr-show 1.9s ease-out; }
    @keyframes sr-show{ 0%{ opacity:0; } 8%{ opacity:1; } 82%{ opacity:1; } 100%{ opacity:0; } }
    .fsim-sprayrig svg{ width:100%; height:auto; overflow:visible; filter:drop-shadow(0 0 4px rgba(120,200,80,.4)); }
    .fsim-sprayrig .sr-boom{ stroke:#8fce62; stroke-width:2.4; stroke-linecap:round; }
    .fsim-sprayrig .sr-noz line{ stroke:#8fce62; stroke-width:1.6; }
    .fsim-sprayrig .sr-hopper{ fill:rgba(18,40,18,.9); stroke:#7fbf55; stroke-width:1.6; }
    .fsim-sprayrig .sr-hatch{ stroke:#5c8f3c; stroke-width:1.4; }
    .fsim-sprayrig .sr-door{ fill:rgba(26,52,24,.95); stroke:#b6f26a; stroke-width:1.4; transform-box:fill-box; }
    .fsim-sprayrig .sr-door-l{ transform-origin:left center; }
    .fsim-sprayrig .sr-door-r{ transform-origin:right center; }
    .fsim-sprayrig.on .sr-door-l{ animation:sr-door-l 1.9s ease-in-out; }
    .fsim-sprayrig.on .sr-door-r{ animation:sr-door-r 1.9s ease-in-out; }
    @keyframes sr-door-l{ 0%{ transform:rotate(0); } 16%{ transform:rotate(84deg); } 84%{ transform:rotate(84deg); } 100%{ transform:rotate(0); } }
    @keyframes sr-door-r{ 0%{ transform:rotate(0); } 16%{ transform:rotate(-84deg); } 84%{ transform:rotate(-84deg); } 100%{ transform:rotate(0); } }
    .fsim-sprayrig .sr-drop{ stroke:#c6ee8c; stroke-width:2; stroke-linecap:round; opacity:0; }
    .fsim-sprayrig.on .sr-drop{ animation:sr-drop .7s ease-in infinite; }
    @keyframes sr-drop{ 0%{ opacity:0; transform:translateY(0); } 20%{ opacity:.9; } 100%{ opacity:0; transform:translateY(30px); } }
    .fsim-sprayrig .sr-tag{ display:block; text-align:center; margin-top:2px; font:bold 9px monospace; letter-spacing:2px; color:#b6f26a; text-shadow:0 0 5px rgba(0,0,0,.8); }
    /* Admin-only rewind button — bottom of the left exit column (under ABORT + fuel + DISEMBARK), deliberately red so it never reads as a normal control. */
    .fsim-adminbtn{ position:absolute; top:70px; left:8px; z-index:6; width:26px; height:22px; border-radius:5px; font-size:12px; cursor:pointer;
      background:rgba(40,10,10,.72); border:1px solid #7a3a3a; color:#ff8a5b; }
    .fsim-adminbtn:hover{ border-color:#ff8a5b; box-shadow:0 0 8px rgba(255,120,80,.4); }
    .fsim-adminbtn:active{ transform:translateY(1px); }
    .fsim-viewbtn{ position:absolute; top:6px; right:92px; z-index:4; background:rgba(6,12,18,.82); border:1px solid #35586e; color:#eef6ff; text-shadow:0 1px 2px rgba(0,0,0,.75);
      border-radius:6px; height:22px; padding:0 7px; font-size:10px; letter-spacing:1px; line-height:20px; cursor:pointer; }
    .fsim-viewbtn.on{ background:var(--cy); color:#05141f; border-color:var(--cy); }
    /* Orbit-camera reset (⟲) — only meaningful in external view, so hidden until then. Sits just left of ◎ EXT. */
    .fsim-orbitreset{ display:none; position:absolute; top:6px; right:132px; z-index:4; background:rgba(6,12,18,.82); border:1px solid #35586e; color:#eef6ff; text-shadow:0 1px 2px rgba(0,0,0,.75);
      border-radius:6px; height:22px; width:24px; padding:0; font-size:13px; line-height:20px; text-align:center; cursor:pointer; }
    .fsim-orbitreset:hover{ background:var(--cy); color:#05141f; border-color:var(--cy); }
    body.fsim-external .fsim-orbitreset{ display:block; }
    /* Rudder pedals — a pair of angled steel foot plates, centred at the base of the view so they
       flank the flight stick like real rudder pedals. Each plate is a perspective-tilted trapezoid
       with grip ridges; it tips FORWARD proportional to the live deflection via --d (driven per
       frame, 0..1), and .act lights the plate in the accent while that side is deflected. The pair
       is centred with a wide gap so the two plates straddle the flight stick — L to its left, R to
       its right — instead of sitting as a tight pair beneath it, and floats above the scene so it
       reads the same in both views. */
    .fsim-pedals{ position:absolute; left:50%; transform:translateX(-50%); bottom:26px; z-index:7; display:flex; gap:150px; pointer-events:none; perspective:210px; }
    .fsim-pedal{ pointer-events:auto; touch-action:none; user-select:none; -webkit-user-select:none; -webkit-tap-highlight-color:transparent;
      width:38px; height:38px; padding:0; border:0; background:none; cursor:pointer; opacity:.82; transition:opacity .15s; }
    .fsim-pedal:hover{ opacity:1; }
    /* the foot plate itself: wider at the base, tilted back in perspective, ridged for grip */
    .fsim-pedal-face{ display:flex; align-items:flex-end; justify-content:center; height:100%; will-change:transform;
      transform-origin:50% 100%; transform:rotateX(calc(22deg + var(--d,0) * 30deg)) translateY(calc(var(--d,0) * 2px));
      clip-path:polygon(20% 0, 80% 0, 100% 100%, 0 100%);
      background:repeating-linear-gradient(0deg, rgba(0,0,0,.34) 0 2px, rgba(255,255,255,.04) 2px 5px), linear-gradient(180deg,#41525f,#131c24);
      border-bottom:2px solid #05233a; box-shadow:inset 0 1px 0 rgba(255,255,255,.16), 0 2px 5px rgba(0,0,0,.55);
      color:#dbeaf6; font:bold 11px/1 monospace; letter-spacing:.5px; padding-bottom:3px; text-shadow:0 1px 1px rgba(0,0,0,.7); }
    .fsim-pedal.act .fsim-pedal-face{ background:repeating-linear-gradient(0deg, rgba(0,0,0,.28) 0 2px, rgba(255,255,255,.06) 2px 5px), linear-gradient(180deg,var(--cy),#123246);
      color:#04141f; border-bottom-color:var(--cy); box-shadow:inset 0 1px 0 rgba(255,255,255,.25), 0 0 9px var(--cy); }
    /* External view: the chase-cam world fills the WHOLE pane and the flying controls
       (throttle + cyclic + master/flaps) float over it on TRANSPARENT backgrounds — no black
       instrument slab. The dashboard (PFD/gauges/MFD, placard, transponder) is dropped, and so
       is the PANEL lights switch (nothing to light out here). The pane growth is in styles.css. */
    body.fsim-external .fsim{ position:relative; }
    body.fsim-external .fsim-view{ position:absolute; inset:0; height:auto; z-index:0; }
    body.fsim-external .fsim-pfd, body.fsim-external .fsim-gauges, body.fsim-external .fsim-mfd,
    body.fsim-external .fsim-placard, body.fsim-external .fsim-xpdr,
    body.fsim-external .fsim-nightsw, body.fsim-external .fsim-reticle { display:none; }   /* external view draws the two-part gunsight on the canvas instead */
    /* control rows → transparent overlays pinned over the bottom of the view */
    body.fsim-external .fsim-glass{ position:absolute; left:8px; bottom:8px; width:auto; height:150px; gap:6px; z-index:6; background:transparent; }
    body.fsim-external .fsim-rightctl{ flex:0 0 auto; }
    body.fsim-external .fsim-throttle,
    body.fsim-external #fsim-root.fsim-painted .fsim-throttle{ background:rgba(6,12,18,.34); border-color:rgba(120,150,175,.4); }   /* keep the throttle a faint translucent overlay out here — don't let the painted-dashboard rule fill it with the solid cabin colour */
    /* Weapons/flare strip lifted clear of the throttle + trim wheel (the glass sits at bottom:8px, ~150px tall). */
    body.fsim-external .fsim-weap{ bottom:166px; }
    body.fsim-external .fsim-ctl{ position:absolute; left:0; right:0; bottom:18px; height:120px; z-index:5; background:transparent; pointer-events:none; justify-content:center; }
    body.fsim-external .fsim-yoke,
    body.fsim-external #fsim-root.fsim-painted .fsim-yoke{ background:transparent; border-color:transparent; box-shadow:none; flex:0 0 140px; pointer-events:auto; }   /* the stick floats over the scene — no interior yoke-well slab out here, even on a painted craft (the painted-dashboard rule must not leak the cabin colour into the exterior view). The grab pad is only 140px (±70) so it clears the rudder pedals that straddle it at ±75px — out here the pad sits ON TOP of the pedals (its .fsim-ctl row is z-index:5, the pedals are trapped in the z-index:0 .fsim-view), so a wide pad would swallow every pedal press. */
    /* External view: the yoke/stick sits a bit higher now (the chase cam rides the craft
       higher/more centred, leaving room below it), a touch bigger. The SVG is scaled UP and
       re-centred so the visible stick keeps its old size/position despite the narrower pad
       (it overflows the pad, which is fine — overflow:visible), and it no longer captures
       pointers itself: the grab region is exactly the 140px pad, so a wide wheel's rim can't
       reach over the pedals either. */
    body.fsim-external .fsim-yoke-svg{ top:2%; left:-29%; width:159%; height:150%; pointer-events:none; }
    /* A couple of BIG important gauges, relocated to the bottom-right of the outside view. */
    .fsim-extg{ position:absolute; right:10px; bottom:10px; z-index:5; display:none; flex-direction:column; gap:7px; align-items:flex-end; pointer-events:none; }
    body.fsim-external .fsim-extg{ display:flex; }
    .fsim-extg-row{ display:flex; align-items:baseline; gap:8px; background:rgba(6,12,18,.66); border:1px solid #1c3a4c; border-radius:9px; padding:5px 14px; min-width:172px; justify-content:flex-end; box-shadow:0 2px 10px rgba(0,0,0,.4); }
    .fsim-extg-lbl{ color:var(--cy); font-size:13px; letter-spacing:2px; }
    .fsim-extg-row b{ color:#e8f4ff; font-size:38px; line-height:1; font-variant-numeric:tabular-nums; min-width:92px; text-align:right; }
    .fsim-extg-u{ color:#6f8fa4; font-size:13px; }
    .fsim-tune{ position:absolute; top:32px; right:8px; z-index:4; width:186px; max-height:72vh; overflow-y:auto; overscroll-behavior:contain; background:rgba(8,14,20,.94); border:1px solid #14212d; border-radius:8px; padding:8px; }
    .fsim-tune-drag{ font-size:9px; letter-spacing:1px; color:var(--cy); background:rgba(20,33,45,.98); border:1px solid #16303f; border-radius:5px; padding:4px 6px; margin:-2px 0 6px; cursor:move; user-select:none; touch-action:none; position:sticky; top:-8px; z-index:1; }
    .fsim-tune .thdr{ font-size:9px; letter-spacing:1px; color:var(--cy); border-bottom:1px solid #16303f; padding-bottom:3px; margin:2px 0 6px; position:sticky; top:-8px; background:rgba(8,14,20,.98); }
    .fsim-tune .thdr:not(:first-child){ margin-top:9px; }
    .fsim-tune .trow{ display:flex; align-items:center; gap:5px; margin-bottom:5px; font-size:9px; }
    .fsim-tune .trow label{ flex:0 0 64px; color:#6f8698; letter-spacing:.5px; }
    .fsim-tune .trow input{ flex:1; min-width:0; }
    .fsim-tune .tv{ flex:0 0 34px; text-align:right; color:var(--cy); font-variant-numeric:tabular-nums; }

    /* ══ PAINTED DASHBOARD — when the craft has a paint job, the whole instrument-panel
       surround takes the interior CABIN / UPHOLSTERY colour, overriding the per-craft
       flightdeck skin. ID-scoped (#fsim-root) so it beats the class-only .fsim-theme-*
       backgrounds. The black glass screens keep their dark faces — only their bezels and
       the physical slabs (yoke well, throttle body, radio deck, master/panel switches)
       retint. The --panel-* vars are set on mount from the cabin hex. ══ */
    #fsim-root.fsim-painted .fsim-yoke{ border-color:var(--panel-edge); background:radial-gradient(circle at 50% 26%,var(--panel-hi),var(--panel-lo)); }
    #fsim-root.fsim-painted .fsim-throttle{ border-color:var(--panel-edge); background:linear-gradient(180deg,var(--panel-hi),var(--panel-lo)); }
    #fsim-root.fsim-painted .fsim-xpdr{ border-color:var(--panel-edge); background:linear-gradient(180deg,var(--panel-hi) 0%,var(--panel-mid) 48%,var(--panel-lo) 100%); }
    #fsim-root.fsim-painted .fsim-pfd,#fsim-root.fsim-painted .fsim-mfd,#fsim-root.fsim-painted .fsim-gauges{ border-color:var(--panel-edge); }
    #fsim-root.fsim-painted .fsim-engbtn{ background:radial-gradient(circle at 50% 34%,var(--panel-hi),var(--panel-lo)); }
    #fsim-root.fsim-painted .fsim-nightsw{ background:linear-gradient(180deg,var(--panel-hi),var(--panel-lo)); }
    #fsim-root.fsim-painted .fsim-nightsw.on{ background:linear-gradient(180deg, var(--cy-lit-dim,rgba(95,208,255,.24)), var(--panel-lo) 72%); }
    /* The maker's plate is dashboard too: take the upholstery metal + the paint accent, so EVERY
       painted airframe gets the stamped plate — not a Mule-only look. Bolts stay steel hardware. */
    #fsim-root.fsim-painted .fsim-placard{ border-color:var(--panel-edge);
      background:
        radial-gradient(circle at 11px 11px, #d6dade 0 1.3px, #9098a0 1.3px 2.5px, #565e66 2.5px 3.7px, rgba(0,0,0,.6) 3.7px 4.6px, transparent 4.8px),
        radial-gradient(circle at calc(100% - 11px) 11px, #d6dade 0 1.3px, #9098a0 1.3px 2.5px, #565e66 2.5px 3.7px, rgba(0,0,0,.6) 3.7px 4.6px, transparent 4.8px),
        radial-gradient(circle at 11px calc(100% - 11px), #d6dade 0 1.3px, #9098a0 1.3px 2.5px, #565e66 2.5px 3.7px, rgba(0,0,0,.6) 3.7px 4.6px, transparent 4.8px),
        radial-gradient(circle at calc(100% - 11px) calc(100% - 11px), #d6dade 0 1.3px, #9098a0 1.3px 2.5px, #565e66 2.5px 3.7px, rgba(0,0,0,.6) 3.7px 4.6px, transparent 4.8px),
        repeating-linear-gradient(96deg, rgba(255,255,255,.055) 0 1px, rgba(0,0,0,.14) 1px 2px),
        linear-gradient(158deg, var(--panel-hi) 0%, var(--panel-mid) 40%, var(--panel-lo) 78%, var(--panel-hi) 100%);
      box-shadow:inset 0 1px 0 rgba(255,255,255,.24), inset 0 0 0 1px rgba(0,0,0,.32), inset 0 -3px 8px rgba(0,0,0,.58), 0 2px 6px rgba(0,0,0,.5); }
    #fsim-root.fsim-painted .fsim-placard::before{ border-color:rgba(255,255,255,.16); }
    /* light engraved inks clear the (typically dark) upholstery metal; the reg glows in the paint accent */
    #fsim-root.fsim-painted .fsim-plac-title{ color:var(--cy); text-shadow:0 1px 0 rgba(0,0,0,.5); }
    #fsim-root.fsim-painted .fsim-plac-reg{ color:#f6f2ff; text-shadow:0 -1px 1px rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.28), 0 2px 3px rgba(0,0,0,.6), 0 0 8px var(--cy); }
    #fsim-root.fsim-painted .fsim-plac-model, #fsim-root.fsim-painted .fsim-plac-own{ color:#e6eaf3; text-shadow:0 -1px 1px rgba(0,0,0,.85), 0 1px 0 rgba(255,255,255,.14); }
    #fsim-root.fsim-painted .fsim-plac-k, #fsim-root.fsim-painted .fsim-plac-seats .lbl{ color:#c2cadb; text-shadow:0 -1px 1px rgba(0,0,0,.8), 0 1px 0 rgba(255,255,255,.12); }
    /* etched serial (the base engraved barcode applies to painted plates too) */
    #fsim-root.fsim-painted .fsim-plac-barcode .sn{ color:#c2cadb; text-shadow:0 -1px 1px rgba(0,0,0,.7); }

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
        radial-gradient(circle at 11px 11px, #ffffff 0 0.6px, #cbb6ff 0.6px 1.3px, #7a63b4 1.3px 2.5px, #2a1e48 2.5px 3.7px, rgba(0,0,0,.6) 3.7px 4.6px, transparent 4.8px),
        radial-gradient(circle at calc(100% - 11px) 11px, #ffffff 0 0.6px, #cbb6ff 0.6px 1.3px, #7a63b4 1.3px 2.5px, #2a1e48 2.5px 3.7px, rgba(0,0,0,.6) 3.7px 4.6px, transparent 4.8px),
        radial-gradient(circle at 11px calc(100% - 11px), #ffffff 0 0.6px, #cbb6ff 0.6px 1.3px, #7a63b4 1.3px 2.5px, #2a1e48 2.5px 3.7px, rgba(0,0,0,.6) 3.7px 4.6px, transparent 4.8px),
        radial-gradient(circle at calc(100% - 11px) calc(100% - 11px), #ffffff 0 0.6px, #cbb6ff 0.6px 1.3px, #7a63b4 1.3px 2.5px, #2a1e48 2.5px 3.7px, rgba(0,0,0,.6) 3.7px 4.6px, transparent 4.8px),
        repeating-linear-gradient(96deg, rgba(200,170,255,.05) 0 1px, rgba(0,0,0,.16) 1px 2px),
        linear-gradient(158deg,#241a38 0%,#312247 34%,#1a1228 72%,#241a38 100%);
      box-shadow:inset 0 1px 0 rgba(198,166,255,.30), inset 0 0 0 1px rgba(0,0,0,.35), inset 0 -3px 8px rgba(0,0,0,.6), 0 2px 6px rgba(0,0,0,.55); }
    .fsim-theme-mule .fsim-placard::before{ border-color:rgba(198,166,255,.14); }
    .fsim-theme-mule .fsim-plac-title{ color:#a874ff; text-shadow:0 1px 0 rgba(255,255,255,.12), 0 -1px 0 rgba(0,0,0,.5); }
    /* die-struck into the carbon: deep recessed top edge, a violet-lit lower lip, and an etch-glow rising from the groove */
    .fsim-theme-mule .fsim-plac-reg{ color:#efe7ff;
      text-shadow:0 -1px 1px rgba(0,0,0,.92), 0 1px 0 rgba(198,166,255,.42), 0 2px 3px rgba(0,0,0,.58), 0 0 8px rgba(168,116,255,.32); }
    /* supporting text engraved into the carbon too: recess above + a faint violet-lit lip below */
    .fsim-theme-mule .fsim-plac-own{ color:#b3a4d6; text-shadow:0 -1px 1px rgba(0,0,0,.85), 0 1px 0 rgba(198,166,255,.16); }
    .fsim-theme-mule .fsim-plac-model{ color:#b3a4d6; text-shadow:0 -1px 1px rgba(0,0,0,.85), 0 1px 0 rgba(198,166,255,.16); }
    .fsim-theme-mule .fsim-plac-k{ color:#8f7dbe; text-shadow:0 -1px 1px rgba(0,0,0,.8), 0 1px 0 rgba(198,166,255,.14); }
    .fsim-theme-mule .fsim-plac-own.rented{ color:#ff4a9a; text-shadow:0 -1px 1px rgba(0,0,0,.7); }
    /* etched serial (the base engraved barcode applies on the carbon too) */
    .fsim-theme-mule .fsim-plac-barcode .sn{ color:#9686bc; text-shadow:0 -1px 1px rgba(0,0,0,.6); }
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
    .fsim-theme-reaper .fsim-thr-grip::after{ background:repeating-linear-gradient(90deg,#301c08 0 2px,rgba(255,154,56,.32) 2px 4px); }

    /* ══ VIPER flightdeck skin — a modern attack-heli GLASS COCKPIT: black composite armour, a ══
       cool cyan-green phosphor HUD glow, threat-red weapons accents. Sleek and menacing — a gunship
       deck built around the missile-swarm sight, not a bubble you sightsee from. */
    .fsim-theme-viper{ --cy:#5fe6c0; --mg:#ff5a6a; --gr:#7dffcf; --cy-dim:rgba(95,230,192,.20); }
    .fsim-theme-viper .fsim-view{ box-shadow:inset 0 0 0 2px #10231e, inset 0 4px 22px rgba(95,230,192,.13), 0 0 14px rgba(0,0,0,.78); }
    .fsim-theme-viper .fsim-view::after{ content:''; position:absolute; left:0; right:0; top:0; height:16px; z-index:2; pointer-events:none;
      background:linear-gradient(180deg,#0a1512 0%,#060d0b 62%,rgba(6,13,11,0) 100%); border-bottom:1px solid rgba(95,230,192,.5); box-shadow:0 1px 10px rgba(95,230,192,.3); }
    .fsim-theme-viper .fsim-pfd,.fsim-theme-viper .fsim-mfd,.fsim-theme-viper .fsim-gauges{ border-color:#1c3a33; box-shadow:inset 0 0 12px rgba(0,0,0,.82), 0 0 0 1px rgba(95,230,192,.18); }
    /* maker's plate → black carbon-composite w/ a fine cyan etch grain + corner bolts */
    .fsim-theme-viper .fsim-placard{ border-color:#132a24;
      background:
        radial-gradient(circle at 10px 10px, #9feada 0 1.4px, #3f7a6e 1.4px 2.6px, #123028 2.6px 3.6px, rgba(0,0,0,.55) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at calc(100% - 10px) 10px, #9feada 0 1.4px, #3f7a6e 1.4px 2.6px, #123028 2.6px 3.6px, rgba(0,0,0,.55) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at 10px calc(100% - 10px), #9feada 0 1.4px, #3f7a6e 1.4px 2.6px, #123028 2.6px 3.6px, rgba(0,0,0,.55) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at calc(100% - 10px) calc(100% - 10px), #9feada 0 1.4px, #3f7a6e 1.4px 2.6px, #123028 2.6px 3.6px, rgba(0,0,0,.55) 3.6px 4.4px, transparent 4.6px),
        repeating-linear-gradient(45deg, rgba(95,230,192,.05) 0 1px, rgba(0,0,0,.16) 1px 3px),
        linear-gradient(157deg,#16302a 0%,#1d3e36 24%,#0e211d 48%,#183a32 70%,#0a1c18 100%);
      box-shadow:inset 0 1px 0 rgba(160,240,220,.16), inset 0 -2px 5px rgba(0,0,0,.6), 0 2px 5px rgba(0,0,0,.55); }
    .fsim-theme-viper .fsim-plac-title{ color:#0a201b; text-shadow:0 1px 0 rgba(150,240,215,.3); }
    .fsim-theme-viper .fsim-plac-reg{ color:#04120e; text-shadow:0 1px 0 rgba(150,240,215,.34); }
    .fsim-theme-viper .fsim-plac-own{ color:#173a32; text-shadow:0 1px 0 rgba(150,240,215,.22); }
    .fsim-theme-viper .fsim-plac-own.rented{ color:#c0304a; text-shadow:0 1px 0 rgba(150,240,215,.22); }
    .fsim-theme-viper .fsim-plac-sheen{ background:linear-gradient(133deg, rgba(150,240,215,0) 30%, rgba(150,240,215,.42) 46%, rgba(150,240,215,.07) 52%, rgba(150,240,215,0) 66%); }
    .fsim-theme-viper .fsim-xpdr{ border-color:#132a24; background:linear-gradient(180deg,#1a3630 0%,#102420 48%,#080f0d 100%); box-shadow:inset 0 1px 0 rgba(95,230,192,.16), inset 0 -2px 6px rgba(0,0,0,.62), 0 2px 5px rgba(0,0,0,.5); }
    .fsim-theme-viper .fsim-xpdr-title{ color:#4fbfa4; }
    .fsim-theme-viper .fsim-yoke{ border-color:#1c3a33; background:radial-gradient(circle at 50% 26%,#122a24,#070f0c); }
    .fsim-theme-viper .fsim-throttle{ border-color:#1c3a33; background:linear-gradient(180deg,#102420,#070f0c); }
    .fsim-theme-viper .fsim-thr-grip{ background:linear-gradient(180deg,#5fe6c0 0%,#1d8a72 55%,#0c2e26 100%); }
    .fsim-theme-viper .fsim-thr-grip::after{ background:repeating-linear-gradient(90deg,#0c2e26 0 2px,rgba(95,230,192,.34) 2px 4px); }

    /* ══ MAYFLY flightdeck skin — an ultralight trainer: bright daytime plexiglass, ══
       bare riveted alloy, a clean sky-aqua glow. The lightest, friendliest deck — no
       carbon, no armour, just an honest little bubble you learn to fly in. */
    .fsim-theme-mayfly{ --cy:#5fe0e6; --mg:#59c8ff; --gr:#7dffb0; --cy-dim:rgba(95,224,230,.20); }
    /* airy plexi surround — a pale, sunlit windshield frame instead of a dark bezel */
    .fsim-theme-mayfly .fsim-view{ box-shadow:inset 0 0 0 2px #1c4750, inset 0 4px 20px rgba(95,224,230,.16), 0 0 14px rgba(0,0,0,.6); }
    /* a thin light glareshield brow — much softer than the transport/gunship lips */
    .fsim-theme-mayfly .fsim-view::after{ content:''; position:absolute; left:0; right:0; top:0; height:12px; z-index:2; pointer-events:none;
      background:linear-gradient(180deg,#16242a 0%,#0e181c 60%,rgba(14,24,28,0) 100%); border-bottom:1px solid rgba(95,224,230,.42); box-shadow:0 1px 8px rgba(95,224,230,.24); }
    .fsim-theme-mayfly .fsim-pfd,.fsim-theme-mayfly .fsim-mfd,.fsim-theme-mayfly .fsim-gauges{ border-color:#1f5058; box-shadow:inset 0 0 10px rgba(0,0,0,.72), 0 0 0 1px rgba(95,224,230,.16); }
    /* maker's plate → bare riveted aluminium (an unpainted trainer's data plate) */
    .fsim-theme-mayfly .fsim-placard{ border-color:#2a4a50;
      background:
        radial-gradient(circle at 10px 10px, #eef4f6 0 1.4px, #b6c4c8 1.4px 2.6px, #6c7c80 2.6px 3.6px, rgba(0,0,0,.4) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at calc(100% - 10px) 10px, #eef4f6 0 1.4px, #b6c4c8 1.4px 2.6px, #6c7c80 2.6px 3.6px, rgba(0,0,0,.4) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at 10px calc(100% - 10px), #eef4f6 0 1.4px, #b6c4c8 1.4px 2.6px, #6c7c80 2.6px 3.6px, rgba(0,0,0,.4) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at calc(100% - 10px) calc(100% - 10px), #eef4f6 0 1.4px, #b6c4c8 1.4px 2.6px, #6c7c80 2.6px 3.6px, rgba(0,0,0,.4) 3.6px 4.4px, transparent 4.6px),
        repeating-linear-gradient(92deg, rgba(230,244,246,.06) 0 1px, rgba(0,0,0,.05) 1px 2px),
        linear-gradient(157deg,#516a6f 0%,#61797d 24%,#3f5459 48%,#57706f 70%,#33474b 100%);
      box-shadow:inset 0 1px 0 rgba(230,244,246,.26), inset 0 -2px 5px rgba(0,0,0,.5), 0 2px 5px rgba(0,0,0,.5); }
    .fsim-theme-mayfly .fsim-plac-title{ color:#0c2226; text-shadow:0 1px 0 rgba(200,240,244,.34); }
    .fsim-theme-mayfly .fsim-plac-reg{ color:#08161a; text-shadow:0 1px 0 rgba(200,240,244,.4); }
    .fsim-theme-mayfly .fsim-plac-own{ color:#1c3a3f; text-shadow:0 1px 0 rgba(200,240,244,.24); }
    .fsim-theme-mayfly .fsim-plac-own.rented{ color:#0f7f88; text-shadow:0 1px 0 rgba(200,240,244,.24); }
    .fsim-theme-mayfly .fsim-plac-sheen{ background:linear-gradient(133deg, rgba(200,244,246,0) 30%, rgba(200,244,246,.44) 46%, rgba(200,244,246,.07) 52%, rgba(200,244,246,0) 66%); }
    /* radio/transponder deck → light alloy */
    .fsim-theme-mayfly .fsim-xpdr{ border-color:#2a4a50; background:linear-gradient(180deg,#3a5459 0%,#26383c 48%,#141d20 100%); box-shadow:inset 0 1px 0 rgba(95,224,230,.16), inset 0 -2px 6px rgba(0,0,0,.55), 0 2px 5px rgba(0,0,0,.5); }
    .fsim-theme-mayfly .fsim-xpdr-title{ color:#5aa8b0; }
    /* yoke well + throttle body → pale alloy, grip goes sky-aqua */
    .fsim-theme-mayfly .fsim-yoke{ border-color:#1f5058; background:radial-gradient(circle at 50% 26%,#173238,#0a1214); }
    .fsim-theme-mayfly .fsim-throttle{ border-color:#1f5058; background:linear-gradient(180deg,#153034,#0a1214); }
    .fsim-theme-mayfly .fsim-thr-grip{ background:linear-gradient(180deg,#5fe0e6 0%,#1d7a80 55%,#0e2e30 100%); }
    .fsim-theme-mayfly .fsim-thr-grip::after{ background:repeating-linear-gradient(90deg,#0e2e30 0 2px,rgba(95,224,230,.32) 2px 4px); }

    /* ══ GRASSHOPPER flightdeck skin — a Piper L-4 liaison: olive-drab fabric-and-tube, ══
       khaki stencilled data plates, a lime instrument glow. Spartan military-observation deck. */
    .fsim-theme-grasshopper{ --cy:#9ad46a; --mg:#d7c24a; --gr:#b6ff8a; --cy-dim:rgba(154,212,106,.20); }
    .fsim-theme-grasshopper .fsim-view{ box-shadow:inset 0 0 0 2px #2c3a1c, inset 0 4px 20px rgba(154,212,106,.13), 0 0 14px rgba(0,0,0,.66); }
    .fsim-theme-grasshopper .fsim-view::after{ content:''; position:absolute; left:0; right:0; top:0; height:13px; z-index:2; pointer-events:none;
      background:linear-gradient(180deg,#1a1f10 0%,#12160b 60%,rgba(18,22,11,0) 100%); border-bottom:1px solid rgba(154,212,106,.4); box-shadow:0 1px 8px rgba(154,212,106,.22); }
    .fsim-theme-grasshopper .fsim-pfd,.fsim-theme-grasshopper .fsim-mfd,.fsim-theme-grasshopper .fsim-gauges{ border-color:#3a4a24; box-shadow:inset 0 0 10px rgba(0,0,0,.74), 0 0 0 1px rgba(154,212,106,.16); }
    /* maker's plate → stencilled olive-drab data plate w/ steel bolts */
    .fsim-theme-grasshopper .fsim-placard{ border-color:#2c3618;
      background:
        radial-gradient(circle at 10px 10px, #c6cdae 0 1.4px, #8b9470 1.4px 2.6px, #4c5432 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at calc(100% - 10px) 10px, #c6cdae 0 1.4px, #8b9470 1.4px 2.6px, #4c5432 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at 10px calc(100% - 10px), #c6cdae 0 1.4px, #8b9470 1.4px 2.6px, #4c5432 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at calc(100% - 10px) calc(100% - 10px), #c6cdae 0 1.4px, #8b9470 1.4px 2.6px, #4c5432 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        repeating-linear-gradient(92deg, rgba(200,220,160,.04) 0 1px, rgba(0,0,0,.06) 1px 2px),
        linear-gradient(157deg,#3c4522 0%,#47512a 24%,#2e3618 48%,#414a26 70%,#232a12 100%);
      box-shadow:inset 0 1px 0 rgba(200,220,160,.18), inset 0 -2px 5px rgba(0,0,0,.55), 0 2px 5px rgba(0,0,0,.5); }
    .fsim-theme-grasshopper .fsim-plac-title{ color:#18200a; text-shadow:0 1px 0 rgba(200,220,160,.28); }
    .fsim-theme-grasshopper .fsim-plac-reg{ color:#0f1405; text-shadow:0 1px 0 rgba(200,220,160,.32); }
    .fsim-theme-grasshopper .fsim-plac-own{ color:#2c3618; text-shadow:0 1px 0 rgba(200,220,160,.2); }
    .fsim-theme-grasshopper .fsim-plac-own.rented{ color:#9a7a10; text-shadow:0 1px 0 rgba(200,220,160,.2); }
    .fsim-theme-grasshopper .fsim-plac-sheen{ background:linear-gradient(133deg, rgba(210,230,170,0) 30%, rgba(210,230,170,.38) 46%, rgba(210,230,170,.06) 52%, rgba(210,230,170,0) 66%); }
    .fsim-theme-grasshopper .fsim-xpdr{ border-color:#2c3618; background:linear-gradient(180deg,#3a4522 0%,#26300f 48%,#141a06 100%); box-shadow:inset 0 1px 0 rgba(154,212,106,.14), inset 0 -2px 6px rgba(0,0,0,.58), 0 2px 5px rgba(0,0,0,.5); }
    .fsim-theme-grasshopper .fsim-xpdr-title{ color:#8ab05a; }
    .fsim-theme-grasshopper .fsim-yoke{ border-color:#3a4a24; background:radial-gradient(circle at 50% 26%,#232c14,#0c0f07); }
    .fsim-theme-grasshopper .fsim-throttle{ border-color:#3a4a24; background:linear-gradient(180deg,#26300f,#0c0f07); }
    .fsim-theme-grasshopper .fsim-thr-grip{ background:linear-gradient(180deg,#9ad46a 0%,#4d7a2c 55%,#1e3010 100%); }
    .fsim-theme-grasshopper .fsim-thr-grip::after{ background:repeating-linear-gradient(90deg,#1e3010 0 2px,rgba(154,212,106,.32) 2px 4px); }

    /* ══ LOCUST flightdeck skin — a crop-duster / ag-plane: a workmanlike deck in scuffed ══
       safety-yellow, chem-stained enamel and worn alloy, amber-lit dials. Honest and utilitarian —
       built to fly low passes all day, not to look pretty. */
    .fsim-theme-locust{ --cy:#ffd24a; --mg:#ff8a3a; --gr:#a6ff6a; --cy-dim:rgba(255,210,74,.20); }
    .fsim-theme-locust .fsim-view{ box-shadow:inset 0 0 0 2px #3a2e0e, inset 0 4px 20px rgba(255,210,74,.12), 0 0 14px rgba(0,0,0,.7); }
    .fsim-theme-locust .fsim-view::after{ content:''; position:absolute; left:0; right:0; top:0; height:14px; z-index:2; pointer-events:none;
      background:linear-gradient(180deg,#191307 0%,#100c04 60%,rgba(16,12,4,0) 100%); border-bottom:1px solid rgba(255,210,74,.42); box-shadow:0 1px 9px rgba(255,210,74,.24); }
    .fsim-theme-locust .fsim-pfd,.fsim-theme-locust .fsim-mfd,.fsim-theme-locust .fsim-gauges{ border-color:#4a3c14; box-shadow:inset 0 0 10px rgba(0,0,0,.78), 0 0 0 1px rgba(255,210,74,.16); }
    /* maker's plate → scuffed chem-stained ag enamel w/ steel bolts (a workhorse data plate) */
    .fsim-theme-locust .fsim-placard{ border-color:#3a3416;
      background:
        radial-gradient(circle at 10px 10px, #d9cf9e 0 1.4px, #9c9166 1.4px 2.6px, #57502c 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at calc(100% - 10px) 10px, #d9cf9e 0 1.4px, #9c9166 1.4px 2.6px, #57502c 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at 10px calc(100% - 10px), #d9cf9e 0 1.4px, #9c9166 1.4px 2.6px, #57502c 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        radial-gradient(circle at calc(100% - 10px) calc(100% - 10px), #d9cf9e 0 1.4px, #9c9166 1.4px 2.6px, #57502c 2.6px 3.6px, rgba(0,0,0,.5) 3.6px 4.4px, transparent 4.6px),
        repeating-linear-gradient(92deg, rgba(225,215,150,.05) 0 1px, rgba(0,0,0,.06) 1px 2px),
        linear-gradient(157deg,#b9a94e 0%,#c8b95e 24%,#8f8236 48%,#b0a24a 70%,#6f6528 100%);
      box-shadow:inset 0 1px 0 rgba(235,225,160,.22), inset 0 -2px 5px rgba(0,0,0,.5), 0 2px 5px rgba(0,0,0,.5); }
    .fsim-theme-locust .fsim-plac-title{ color:#2a2408; text-shadow:0 1px 0 rgba(235,225,160,.3); }
    .fsim-theme-locust .fsim-plac-reg{ color:#1a1604; text-shadow:0 1px 0 rgba(235,225,160,.34); }
    .fsim-theme-locust .fsim-plac-own{ color:#4a4218; text-shadow:0 1px 0 rgba(235,225,160,.2); }
    .fsim-theme-locust .fsim-plac-own.rented{ color:#9a5010; text-shadow:0 1px 0 rgba(235,225,160,.2); }
    .fsim-theme-locust .fsim-plac-sheen{ background:linear-gradient(133deg, rgba(240,232,180,0) 30%, rgba(240,232,180,.36) 46%, rgba(240,232,180,.06) 52%, rgba(240,232,180,0) 66%); }
    .fsim-theme-locust .fsim-xpdr{ border-color:#231c08; background:linear-gradient(180deg,#2a2010 0%,#1a1408 48%,#0c0904 100%); box-shadow:inset 0 1px 0 rgba(255,210,74,.16), inset 0 -2px 6px rgba(0,0,0,.62), 0 2px 5px rgba(0,0,0,.5); }
    .fsim-theme-locust .fsim-xpdr-title{ color:#b08a3a; }
    .fsim-theme-locust .fsim-yoke{ border-color:#4a3c14; background:radial-gradient(circle at 50% 26%,#1f1808,#0c0904); }
    .fsim-theme-locust .fsim-throttle{ border-color:#4a3c14; background:linear-gradient(180deg,#1a1408,#0c0904); }
    .fsim-theme-locust .fsim-thr-grip{ background:linear-gradient(180deg,#ffd24a 0%,#8a6410 55%,#301c08 100%); }
    .fsim-theme-locust .fsim-thr-grip::after{ background:repeating-linear-gradient(90deg,#301c08 0 2px,rgba(255,210,74,.32) 2px 4px); }

    /* ══ MOBILE — pare the cockpit to flyable essentials so it fits a phone ══════════
       On a narrow screen the dashboard is too cramped to fly. We drop the pure-flavour
       transponder/COM-NAV radio and the maker's-plate placard, and the nav-map MFD (the
       Tablet has maps) + the PFD — leaving TWO clear gauges: the engine/fuel dial cluster
       (widened to fill the freed space) and a big, legible SPEED + ALTITUDE overlay pinned
       over the view (kept live in interior view on mobile — see the frame loop). Throttle,
       flaps and trim stay grouped on the right; the flight stick + rudder pedals stay. The
       stick drops into its own full-width bottom band (the same treatment flightsim.html
       uses) instead of rising up through the gauges. 720px = the client's phone breakpoint. */
    @media (max-width: 720px){
      /* Give the out-the-window view as much height as we can; the instrument band and the
         stick band below it stay compact so the window dominates the screen. */
      .fsim-view{ height: clamp(240px, 58vh, 560px); }
      .fsim-glass{ height: 128px; }                     /* compact instrument + control band */
      .fsim-ctl{ height: 104px; }                       /* compact stick band */
      /* Drop the flavour radio + maker's-plate placard, and the nav-map screen + PFD: that
         leaves TWO clear gauges (the engine/fuel dial cluster + the big speed/alt overlay) and
         hands the whole bottom band to just the flight stick. */
      .fsim-pfd, .fsim-mfd, .fsim-placard, .fsim-xpdr{ display:none; }
      .fsim-gauges{ min-width:0; }                       /* let the gauge cluster shrink to the phone width (its canvas has a 300px intrinsic min) so the row never overflows */
      .fsim-rightctl{ flex:0 0 140px; }                 /* throttle · engine · flaps + trim (need room to sit side by side without overflowing) */
      .fsim-yoke{ flex:1 1 auto; }                      /* just the flight stick fills the bottom band */
      .fsim-yoke-svg{ left:7%; top:2%; width:86%; height:96%; transform-origin:50% 58%; }   /* dropped into its own band, clear of the gauges */
      .fsim-climbmark{ top:60%; }
      /* big readable speed + altitude, over the view (normally external-view only) */
      .fsim-extg{ display:flex; right:8px; bottom:8px; gap:5px; }
      .fsim-extg-row{ min-width:0; padding:3px 10px; gap:6px; }
      .fsim-extg-row b{ font-size:24px; min-width:50px; }
      .fsim-extg-lbl, .fsim-extg-u{ font-size:11px; }
    }`;
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
  <rect id="fsim-yoke-plate" x="31" y="25" width="38" height="24" rx="4" fill="url(#ykhub)" stroke="#2c2f35" stroke-width="0.7"/>
  <rect x="32" y="26" width="36" height="22" rx="3.4" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="0.5"/>
  <text id="fsim-yoke-name" class="fsim-yoke-name" x="50" y="35.5" text-anchor="middle" textLength="30" lengthAdjust="spacingAndGlyphs">MULE</text>
  <circle id="fsim-yk-green" cx="44.5" cy="43" r="2.7" fill="url(#ykgreen)" opacity="0.2"/>
  <circle id="fsim-yk-red" cx="55.5" cy="43" r="2.7" fill="url(#ykred)" opacity="0.2"/>
</svg>`;

// ── Per-plane controls ────────────────────────────────────────────────────────
// Each airframe carries its own control art, matched to type: a light tube yoke
// (Mayfly), the caravan ram-horn wheel above (Mule + fallback), a broad Soviet
// ram's-horn wheel (Leviathan), an A-10 combat centre stick (Reaper), and a heli
// cyclic (Dragonfly). Every one keeps the SAME contract so the frame loop drives
// it unchanged: viewBox `0 0 100 74`, the `fsim-yoke-svg` id/class, the name text
// (`#fsim-yoke-name`, set on mount) and the two status LEDs (`#fsim-yk-green` /
// `#fsim-yk-red` → best-climb/glide/stall). The green/blue/red LED gradients the
// LED logic fills by url() are shared below so every control lights identically.
const YK_LED_DEFS = `
  <radialGradient id="ykgreen" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#9dffc8"/><stop offset="0.5" stop-color="#3ad07a"/><stop offset="1" stop-color="#0d3a22"/></radialGradient>
  <radialGradient id="ykblue" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#cfeeff"/><stop offset="0.5" stop-color="#3aa8e0"/><stop offset="1" stop-color="#0b2a3c"/></radialGradient>
  <radialGradient id="ykred" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffb6b8"/><stop offset="0.5" stop-color="#e0403a"/><stop offset="1" stop-color="#3a0d0d"/></radialGradient>`;

// MAYFLY — an ultralight trainer's skeletal control: a thin aluminium grip tube on
// two exposed posts with foam end-grips and a tiny hub plate. Light, minimal, honest.
const YOKE_MAYFLY = `<svg class="fsim-yoke-svg" id="fsim-yoke-svg" viewBox="0 0 100 74" preserveAspectRatio="xMidYMid meet">
  <defs>${YK_LED_DEFS}
    <linearGradient id="mftube" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6eef3"/><stop offset="0.5" stop-color="#9fb0bc"/><stop offset="1" stop-color="#59686f"/></linearGradient>
    <radialGradient id="mfhub" cx="0.5" cy="0.34" r="0.72"><stop offset="0" stop-color="#3a444c"/><stop offset="1" stop-color="#0d1216"/></radialGradient>
  </defs>
  <!-- column stub + light cable -->
  <rect x="46" y="46" width="8" height="16" rx="3" fill="url(#mfhub)" stroke="#000" stroke-width="0.5"/>
  <path d="M50,50 q5,3 0,6 q-5,3 0,6 q5,3 0,6" fill="none" stroke="#39434b" stroke-width="1.3" stroke-linecap="round"/>
  <!-- support posts up to the grip tube -->
  <rect x="30" y="26" width="4" height="19" rx="2" fill="url(#mftube)" stroke="#39434b" stroke-width="0.5"/>
  <rect x="66" y="26" width="4" height="19" rx="2" fill="url(#mftube)" stroke="#39434b" stroke-width="0.5"/>
  <!-- horizontal grip tube -->
  <rect x="16" y="20.5" width="68" height="6.5" rx="3.25" fill="url(#mftube)" stroke="#39434b" stroke-width="0.6"/>
  <!-- foam end-grips -->
  <rect x="8" y="17.5" width="16" height="12.5" rx="6" fill="#191c20" stroke="#000" stroke-width="0.7"/>
  <rect x="76" y="17.5" width="16" height="12.5" rx="6" fill="#191c20" stroke="#000" stroke-width="0.7"/>
  <rect x="10" y="14.5" width="9" height="4" rx="1.6" fill="#101216"/>
  <rect x="81" y="14.5" width="9" height="4" rx="1.6" fill="#101216"/>
  <!-- small central hub plate: name + LEDs -->
  <rect id="fsim-yoke-plate" x="37" y="29.5" width="26" height="16" rx="3" fill="url(#mfhub)" stroke="#2c343a" stroke-width="0.6"/>
  <text id="fsim-yoke-name" class="fsim-yoke-name" x="50" y="37" text-anchor="middle" textLength="21" lengthAdjust="spacingAndGlyphs">MAYFLY</text>
  <circle id="fsim-yk-green" cx="45" cy="41.5" r="2.3" fill="url(#ykgreen)" opacity="0.2"/>
  <circle id="fsim-yk-red" cx="55" cy="41.5" r="2.3" fill="url(#ykred)" opacity="0.2"/>
</svg>`;

// LEVIATHAN — an Antonov An-124 control wheel: a broad, heavy ram's-horn yoke with
// chunky riveted grips and a big stamped data hub. Wider and beefier than the Mule's.
const YOKE_LEVIATHAN = `<svg class="fsim-yoke-svg" id="fsim-yoke-svg" viewBox="0 0 100 74" preserveAspectRatio="xMidYMid meet">
  <defs>${YK_LED_DEFS}
    <linearGradient id="lvblk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#33433f"/><stop offset="0.18" stop-color="#1a2725"/><stop offset="1" stop-color="#060b0a"/></linearGradient>
    <linearGradient id="lvgrip" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#38524d"/><stop offset="0.16" stop-color="#182927"/><stop offset="1" stop-color="#040807"/></linearGradient>
    <radialGradient id="lvhub" cx="0.5" cy="0.32" r="0.75"><stop offset="0" stop-color="#2c3c39"/><stop offset="0.5" stop-color="#152220"/><stop offset="1" stop-color="#080d0c"/></radialGradient>
    <radialGradient id="lvgloss" cx="0.4" cy="0.18" r="0.75"><stop offset="0" stop-color="rgba(180,240,228,0.24)"/><stop offset="0.45" stop-color="rgba(180,240,228,0.03)"/><stop offset="1" stop-color="rgba(0,0,0,0)"/></radialGradient>
  </defs>
  <!-- heavy column + coiled cable -->
  <path d="M50,52 q8,3.5 0,7 q-8,3.5 0,7 q8,3.5 0,7" fill="none" stroke="#0a100f" stroke-width="3.4" stroke-linecap="round"/>
  <path d="M50,52 q8,3.5 0,7 q-8,3.5 0,7 q8,3.5 0,7" fill="none" stroke="#26332f" stroke-width="1.1" stroke-linecap="round"/>
  <rect x="43" y="44" width="14" height="13" rx="4" fill="url(#lvblk)" stroke="#000" stroke-width="0.7"/>
  <!-- broad ram's-horn wheel -->
  <path d="M7,50 Q3,19 22,14 Q36,8 50,16 Q64,8 78,14 Q97,19 93,50 L83,50 Q86,25 66,20 Q57,17 50,24 Q43,17 34,20 Q14,25 17,50 Z" fill="url(#lvblk)" stroke="#000" stroke-width="0.9"/>
  <!-- chunky riveted grips -->
  <rect x="2" y="39" width="19" height="31" rx="7.5" fill="url(#lvgrip)" stroke="#000" stroke-width="0.8"/>
  <rect x="79" y="39" width="19" height="31" rx="7.5" fill="url(#lvgrip)" stroke="#000" stroke-width="0.8"/>
  ${[[24, 18], [34, 14.5], [66, 14.5], [76, 18]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.1" fill="#0a100f" stroke="#3a544f" stroke-width="0.4"/>`).join('')}
  <path d="M7,50 Q3,19 22,14 Q36,8 50,16 Q64,8 78,14 Q97,19 93,50 L83,50 Q86,25 66,20 Q57,17 50,24 Q43,17 34,20 Q14,25 17,50 Z" fill="url(#lvgloss)"/>
  <!-- big stamped data hub -->
  <rect id="fsim-yoke-plate" x="29" y="26" width="42" height="24" rx="3.5" fill="url(#lvhub)" stroke="#2c3c39" stroke-width="0.7"/>
  <rect x="30.5" y="27.5" width="39" height="21" rx="2.8" fill="none" stroke="rgba(180,240,228,0.07)" stroke-width="0.5"/>
  <text id="fsim-yoke-name" class="fsim-yoke-name" x="50" y="36" text-anchor="middle" textLength="33" lengthAdjust="spacingAndGlyphs">LEVIATHAN</text>
  <circle id="fsim-yk-green" cx="44" cy="43" r="2.7" fill="url(#ykgreen)" opacity="0.2"/>
  <circle id="fsim-yk-red" cx="56" cy="43" r="2.7" fill="url(#ykred)" opacity="0.2"/>
</svg>`;

// REAPER — an A-10 combat centre stick: a rubber-booted floor stick with a molded
// pistol grip, a coolie top-hat, a weapons button and a red gun trigger. Pivots low.
const STICK_REAPER = `<svg class="fsim-yoke-svg" id="fsim-yoke-svg" viewBox="0 0 100 74" preserveAspectRatio="xMidYMid meet">
  <defs>${YK_LED_DEFS}
    <linearGradient id="rpshaft" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4d44"/><stop offset="0.5" stop-color="#24261e"/><stop offset="1" stop-color="#0c0d08"/></linearGradient>
    <linearGradient id="rpgrip" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#57603b"/><stop offset="0.5" stop-color="#33381f"/><stop offset="1" stop-color="#14160b"/></linearGradient>
  </defs>
  <!-- floor mount + rubber boot -->
  <ellipse cx="50" cy="71" rx="23" ry="4.5" fill="#0a0d07"/>
  <path d="M39,70 L45,42 L55,42 L61,70 Z" fill="#15180e" stroke="#000" stroke-width="0.6"/>
  <path d="M41,64 H59 M42,58 H58 M43,52 H57 M44,47 H56" stroke="#2a2e1b" stroke-width="0.8" fill="none"/>
  <!-- shaft + name plate -->
  <rect x="46" y="22" width="8" height="21" rx="2.5" fill="url(#rpshaft)" stroke="#000" stroke-width="0.6"/>
  <rect id="fsim-yoke-plate" x="42" y="34" width="16" height="7" rx="1.5" fill="#0c0f08" stroke="#2a2e1b" stroke-width="0.5"/>
  <text id="fsim-yoke-name" class="fsim-yoke-name" x="50" y="39.4" text-anchor="middle" textLength="13" lengthAdjust="spacingAndGlyphs">REAPER</text>
  <!-- molded pistol grip -->
  <path d="M43,26 Q42,7 49,6 L55,6 Q61,7 60,15 L58,27 Q57,31 50,31 Q44,31 43,26 Z" fill="url(#rpgrip)" stroke="#000" stroke-width="0.7"/>
  <path d="M45,10 H57 M45,14 H58 M45,18 H58 M45,22 H57" stroke="rgba(0,0,0,0.4)" stroke-width="0.7" fill="none"/>
  <!-- coolie top-hat + weapons button -->
  <circle cx="51" cy="7" r="3.6" fill="#20241a" stroke="#000" stroke-width="0.5"/>
  <path d="M51,4.4 V9.6 M48.4,7 H53.6" stroke="#8de24a" stroke-width="0.7"/>
  <circle cx="56.5" cy="11" r="1.7" fill="#e0403a" stroke="#3a0d0d" stroke-width="0.4"/>
  <!-- red gun trigger on the front -->
  <path d="M43,20 q-4.5,1.5 -3.5,6.5 q3.5,2 4.5,-1.5 Z" fill="#c0392b" stroke="#000" stroke-width="0.5"/>
  <!-- status LEDs on the grip collar -->
  <circle id="fsim-yk-green" cx="47.5" cy="29" r="1.9" fill="url(#ykgreen)" opacity="0.2"/>
  <circle id="fsim-yk-red" cx="52.5" cy="29" r="1.9" fill="url(#ykred)" opacity="0.2"/>
</svg>`;

// DRAGONFLY — a Mini-500 kit-helicopter cyclic: a thin exposed floor stick on a
// gimbal with a bulbous grip head, a 4-way trim hat and a cargo-release trigger. Pivots low.
const CYCLIC_DRAGONFLY = `<svg class="fsim-yoke-svg" id="fsim-yoke-svg" viewBox="0 0 100 74" preserveAspectRatio="xMidYMid meet">
  <defs>${YK_LED_DEFS}
    <linearGradient id="dfshaft" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9d6cf"/><stop offset="0.5" stop-color="#71857c"/><stop offset="1" stop-color="#2b322e"/></linearGradient>
    <radialGradient id="dfgrip" cx="0.42" cy="0.28" r="0.8"><stop offset="0" stop-color="#3b4a42"/><stop offset="0.6" stop-color="#1a231e"/><stop offset="1" stop-color="#0a0f0c"/></radialGradient>
  </defs>
  <!-- floor gimbal + thin exposed shaft -->
  <ellipse cx="50" cy="71" rx="16" ry="4" fill="#0a120c"/>
  <rect x="47" y="30" width="6" height="40" rx="2.4" fill="url(#dfshaft)" stroke="#1a231e" stroke-width="0.5"/>
  <circle cx="50" cy="60" r="4.4" fill="#18211b" stroke="#0a120c" stroke-width="0.7"/>
  <circle cx="50" cy="60" r="1.5" fill="#0a120c"/>
  <!-- name plate clamped across the shaft (wider than the shaft so the long name reads) -->
  <rect id="fsim-yoke-plate" x="33" y="40.5" width="34" height="8" rx="1.8" fill="#0c140e" stroke="#2a3a30" stroke-width="0.5"/>
  <text id="fsim-yoke-name" class="fsim-yoke-name" x="50" y="46.4" text-anchor="middle" textLength="28" lengthAdjust="spacingAndGlyphs">DRAGONFLY</text>
  <!-- bulbous grip head -->
  <ellipse cx="50" cy="18" rx="9.5" ry="13" fill="url(#dfgrip)" stroke="#000" stroke-width="0.7"/>
  <ellipse cx="46.5" cy="12" rx="3" ry="4.5" fill="rgba(180,240,200,0.14)"/>
  <!-- 4-way trim hat -->
  <circle cx="50" cy="8" r="3.2" fill="#16201a" stroke="#000" stroke-width="0.5"/>
  <path d="M50,5.2 V10.8 M47.2,8 H52.8" stroke="#8fe36b" stroke-width="0.7"/>
  <!-- cargo-release trigger -->
  <path d="M42,17 q-4,1.4 -3,6 q3.2,1.8 4,-1.6 Z" fill="#3ad07a" stroke="#0a2a18" stroke-width="0.5"/>
  <!-- status LEDs on the grip -->
  <circle id="fsim-yk-green" cx="47.5" cy="23.5" r="1.9" fill="url(#ykgreen)" opacity="0.2"/>
  <circle id="fsim-yk-red" cx="52.5" cy="23.5" r="1.9" fill="url(#ykred)" opacity="0.2"/>
</svg>`;

// VIPER — a futuristic attack-heli COMBAT CYCLIC: a low-pivot black-carbon pistol grip with a
// coolie trim-hat, a red master/weapons trigger on the front, and a 2×2 cluster of cyan SWARM
// launch pips on the grip face — the ripple made physical. Aggressive, glass-cockpit tactical.
const CYCLIC_VIPER = `<svg class="fsim-yoke-svg" id="fsim-yoke-svg" viewBox="0 0 100 74" preserveAspectRatio="xMidYMid meet">
  <defs>${YK_LED_DEFS}
    <linearGradient id="vpshaft" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3a35"/><stop offset="0.5" stop-color="#16211d"/><stop offset="1" stop-color="#080d0b"/></linearGradient>
    <linearGradient id="vpgrip" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2e4640"/><stop offset="0.5" stop-color="#182722"/><stop offset="1" stop-color="#0a120f"/></linearGradient>
  </defs>
  <!-- floor gimbal + carbon shaft boot -->
  <ellipse cx="50" cy="71" rx="20" ry="4.4" fill="#070d0b"/>
  <path d="M44,70 L46,40 L54,40 L56,70 Z" fill="#0e1613" stroke="#000" stroke-width="0.6"/>
  <path d="M45.5,64 H54.5 M46,58 H54 M46.5,52 H53.5" stroke="#1c2b26" stroke-width="0.8" fill="none"/>
  <!-- shaft + name plate -->
  <rect x="46" y="22" width="8" height="20" rx="2.5" fill="url(#vpshaft)" stroke="#000" stroke-width="0.6"/>
  <rect id="fsim-yoke-plate" x="40" y="33" width="20" height="7" rx="1.5" fill="#0a120f" stroke="#20423a" stroke-width="0.5"/>
  <text id="fsim-yoke-name" class="fsim-yoke-name" x="50" y="38.4" text-anchor="middle" textLength="16" lengthAdjust="spacingAndGlyphs">VIPER</text>
  <!-- molded combat pistol grip, canted forward -->
  <path d="M43,26 Q41,7 49,5.5 L55,5.5 Q62,7 60,16 L58,27 Q57,31 50,31 Q44,31 43,26 Z" fill="url(#vpgrip)" stroke="#000" stroke-width="0.7"/>
  <path d="M45,11 H58 M45,15 H59 M45,19 H58 M45,23 H57" stroke="rgba(0,0,0,0.42)" stroke-width="0.7" fill="none"/>
  <!-- coolie trim-hat -->
  <circle cx="51" cy="6.5" r="3.5" fill="#122019" stroke="#000" stroke-width="0.5"/>
  <path d="M51,4 V9 M48.5,6.5 H53.5" stroke="#5fe6c0" stroke-width="0.7"/>
  <!-- 2x2 cyan SWARM launch pips on the grip face -->
  ${[[47, 15], [52, 15], [47, 20], [52, 20]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.15" fill="#0a120f" stroke="#5fe6c0" stroke-width="0.5"/>`).join('')}
  <!-- red master/weapons trigger on the front -->
  <path d="M43,20 q-4.5,1.5 -3.5,6.5 q3.5,2 4.5,-1.5 Z" fill="#e0403a" stroke="#000" stroke-width="0.5"/>
  <!-- status LEDs on the grip collar -->
  <circle id="fsim-yk-green" cx="47.5" cy="29" r="1.9" fill="url(#ykgreen)" opacity="0.2"/>
  <circle id="fsim-yk-red" cx="52.5" cy="29" r="1.9" fill="url(#ykred)" opacity="0.2"/>
</svg>`;

// GRASSHOPPER — a Piper L-4 Cub's bare bent-tube joystick: a slim olive-drab aluminium tube
// rising from a floor socket to a single plain rubber ball grip. No buttons, no trim hat — the
// most honest, spartan control in the fleet, matched to the fabric-and-tube liaison scout.
const STICK_GRASSHOPPER = `<svg class="fsim-yoke-svg" id="fsim-yoke-svg" viewBox="0 0 100 74" preserveAspectRatio="xMidYMid meet">
  <defs>${YK_LED_DEFS}
    <linearGradient id="ghtube" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7c8a55"/><stop offset="0.5" stop-color="#4d5733"/><stop offset="1" stop-color="#232a15"/></linearGradient>
    <radialGradient id="ghball" cx="0.4" cy="0.3" r="0.75"><stop offset="0" stop-color="#3b4033"/><stop offset="0.6" stop-color="#181c12"/><stop offset="1" stop-color="#080a06"/></radialGradient>
  </defs>
  <!-- floor socket -->
  <ellipse cx="50" cy="71" rx="15" ry="4" fill="#0b0f07"/>
  <ellipse cx="50" cy="70" rx="7" ry="2.4" fill="#1a2012" stroke="#0b0f07" stroke-width="0.5"/>
  <!-- slim tube shaft: rises then kinks slightly forward to the grip (a Cub's bent stick) -->
  <path d="M47.5,69 L48.6,34 Q49,26 52,22" fill="none" stroke="url(#ghtube)" stroke-width="5" stroke-linecap="round"/>
  <path d="M48.4,66 L49.2,36" fill="none" stroke="rgba(220,230,180,0.22)" stroke-width="1" stroke-linecap="round"/>
  <!-- name plate clamped low on the shaft -->
  <rect id="fsim-yoke-plate" x="33" y="44" width="34" height="7.5" rx="1.6" fill="#10160b" stroke="#2f3a1e" stroke-width="0.5"/>
  <text id="fsim-yoke-name" class="fsim-yoke-name" x="50" y="49.6" text-anchor="middle" textLength="28" lengthAdjust="spacingAndGlyphs">GRASSHOPPER</text>
  <!-- plain rubber ball grip -->
  <circle cx="52.5" cy="18" r="9.5" fill="url(#ghball)" stroke="#000" stroke-width="0.7"/>
  <ellipse cx="49" cy="13.5" rx="2.6" ry="3.6" fill="rgba(210,230,170,0.12)"/>
  <!-- status LEDs on the collar -->
  <circle id="fsim-yk-green" cx="47.5" cy="28.5" r="1.9" fill="url(#ykgreen)" opacity="0.2"/>
  <circle id="fsim-yk-red" cx="52.8" cy="28.5" r="1.9" fill="url(#ykred)" opacity="0.2"/>
</svg>`;

// LOCUST — a crop-duster's stout utility centre stick: a thick worn shaft into a plain molded
// grip with a green spray-boom arming toggle on the head. Workmanlike and honest — no aerobatic
// contours, just a hand-filling grip you fly low passes with all day.
const STICK_LOCUST = `<svg class="fsim-yoke-svg" id="fsim-yoke-svg" viewBox="0 0 100 74" preserveAspectRatio="xMidYMid meet">
  <defs>${YK_LED_DEFS}
    <linearGradient id="lcshaft" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b7b39c"/><stop offset="0.5" stop-color="#6d6a54"/><stop offset="1" stop-color="#2e2c20"/></linearGradient>
    <radialGradient id="lcgrip" cx="0.42" cy="0.3" r="0.8"><stop offset="0" stop-color="#4a4636"/><stop offset="0.6" stop-color="#232016"/><stop offset="1" stop-color="#0d0b06"/></radialGradient>
  </defs>
  <!-- floor mount + rubber boot -->
  <ellipse cx="50" cy="71" rx="19" ry="4.4" fill="#0a0906"/>
  <path d="M42,70 L45.5,44 L54.5,44 L58,70 Z" fill="#181509" stroke="#000" stroke-width="0.6"/>
  <path d="M44,64 H56 M44.5,58 H55.5 M45,52 H55 M45.5,47 H54.5" stroke="#2b2818" stroke-width="0.8" fill="none"/>
  <!-- stout shaft + name plate -->
  <rect x="46" y="22" width="8" height="23" rx="2.6" fill="url(#lcshaft)" stroke="#000" stroke-width="0.5"/>
  <rect id="fsim-yoke-plate" x="37" y="33" width="26" height="7.5" rx="1.6" fill="#12100a" stroke="#3a3418" stroke-width="0.5"/>
  <text id="fsim-yoke-name" class="fsim-yoke-name" x="50" y="38.6" text-anchor="middle" textLength="20" lengthAdjust="spacingAndGlyphs">LOCUST</text>
  <!-- plain molded utility grip -->
  <path d="M43,26 Q42,8 50,6.5 Q58,8 57,26 Q56,31 50,31 Q44,31 43,26 Z" fill="url(#lcgrip)" stroke="#000" stroke-width="0.7"/>
  <path d="M45,22 H55 M45,18 H55 M45.5,14 H54.5" stroke="rgba(0,0,0,0.38)" stroke-width="0.7" fill="none"/>
  <ellipse cx="47.5" cy="12" rx="2.4" ry="3.4" fill="rgba(220,235,180,0.12)"/>
  <!-- green spray-boom arming toggle on the head -->
  <rect x="53.5" y="9" width="4.6" height="8" rx="2.2" fill="#0f2416" stroke="#000" stroke-width="0.5"/>
  <circle cx="55.8" cy="11.4" r="1.9" fill="#3ad07a" stroke="#0a2a18" stroke-width="0.5"/>
  <!-- status LEDs on the collar -->
  <circle id="fsim-yk-green" cx="47.5" cy="29.5" r="1.9" fill="url(#ykgreen)" opacity="0.2"/>
  <circle id="fsim-yk-red" cx="52.5" cy="29.5" r="1.9" fill="url(#ykred)" opacity="0.2"/>
</svg>`;

// Pick the control art for a craft type (Mule + anything unlisted → the caravan wheel).
function yokeSvgFor(t) {
  // The light singles each fly their analogue's centre stick: the Grasshopper a Cub bent-tube
  // joystick, the Locust a sport aerobatic stick. Only the Mayfly keeps the skeletal tube-yoke.
  return { mayfly: YOKE_MAYFLY, grasshopper: STICK_GRASSHOPPER, locust: STICK_LOCUST, leviathan: YOKE_LEVIATHAN, reaper: STICK_REAPER, dragonfly: CYCLIC_DRAGONFLY, viper: CYCLIC_VIPER }[t] || YOKE_SVG;
}

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
  window.dispatchEvent(new Event('flightsim:open'));   // let the WASD walk-mode owner disarm — those keys are flight controls now
  suppressWeatherFx(true);   // kill the outdoor overlay immediately so rain never flashes over the cockpit on embark
  ensureWindshieldStyles(); ensureFlightSimStyles(); refreshAccent();
  const skin = FSIM_SKIN[opts.craftType] || null;   // per-craft flightdeck theme
  if (skin) { ACCENT = skin.acc; ACCENT_RGB = skin.rgb; }   // retint the canvas instruments to match the CSS chrome
  const P = TYPES[opts.craftType] || TYPES.mayfly;
  const s = createState(P);
  s.heading = (((opts.heading || 0) % 360) + 360) % 360;

  const F = {
    P, s, cls: opts.craftClass || 'ultralight', livery: opts.livery || opts.craftLivery,
    input: { elevator: 0, aileron: 0, throttle: 0, flaps: 0, pedal: 0, trim: 0 },
    // A helicopter (Dragonfly/Mini 500) flies the hover model: the throttle lever is the
    // COLLECTIVE, the yoke is the CYCLIC, and the rudder pedals (,/. or X/C) work the tail
    // rotor (yaw) — same keys as the fixed-wings. heli flag drives the instrument set below.
    heli: opts.craftClass === 'heli' || !!(TYPES[opts.craftType] && TYPES[opts.craftType].heli),
    yachtDeparted: true,   // auto-land armed by default; a set-down on the Echelon disarms it until you leave her (see the capture gate)
    pedalKey: 0,
    // Start the craft exactly where it's parked (no forward hop onto the strip). The takeoff
    // rolls out from the parked spot down the runway.
    pos: { x: opts.gx || 0, y: opts.gy || 0 },
    mapCenter: { x: Math.round(opts.gx || 0), y: Math.round(opts.gy || 0) },
    rollDist: 0, travel: 0,
    // World-fixed departure runway anchor. When the server sends a runway pose derived
    // from the map's centreline tiles (opts.runway), use it so the drawn runway sits on
    // the real tiles; otherwise fall back to the craft's parked spot + heading.
    rwOrigin: { x: opts.runway?.ox ?? opts.gx ?? 0, y: opts.runway?.oy ?? opts.gy ?? 0 },
    rwHdg: opts.runway ? opts.runway.hdg : ((((opts.heading || 0) % 360) + 360) % 360),
    rwLen: opts.runway?.len || null,
    airport: opts.airport || 'default',
    helipad: !!opts.helipad,     // a VTOL-only field draws a circle-H pad, not a strip
    reg: opts.registration || (opts.deviceName || 'MAYFLY').toUpperCase(), owner: opts.owner || 'RENTED', rented: !!opts.rented,
    fuel: opts.fuel ?? 100, fuelCap: opts.fuelCap || 100, warn: null,
    map: opts.map || null, sky: opts.sky || { hour: 12, weather: 'clear', wind: 0 }, biomeBelow: opts.biomeBelow ?? null,
    minimap: opts.minimap || null, mfdMode: 'local', fields: opts.fields || [],
    checkride: opts.checkride || null, checkrideStage: null,   // guided-checkride clientView (instruction + ring gates) + last-rendered stage (null off a checkride)
    tourStep: null, tourRenderedStep: null, tourDismissed: false,   // flight-school tour: current step, last-drawn step, and whether the player skipped it

    deadStick: false, reportedAirborne: false, rolling: false, stopHinted: false,
    engineOn: !!opts.engineOn,
    yokeDrag: false, thrDrag: false,
    viewYaw: 0, throttleKey: 0, flapIdx: 0,          // keyboard: hold-to-look yaw, A/Z throttle ramp, flap detent
    gearRetract: !!opts.gearRetract, gearUp: false, gearAnim: 1, external: false, extZoom: 1, cargoKg: opts.cargoKg || 0,   // gear (G) + jettison (J) + external view (V) — capabilities per airframe (Mayfly: none)
    craftType: opts.craftType,                       // airframe id (drives the reaper-only gun/stores panel)
    sprayer: !!opts.sprayer,                          // ag-plane crop-duster (Locust): shows the SPRAY button
    hardpoints: opts.hardpoints || 0, armed: false,  // weapons (gunship): master-arm + fire
    salvo: opts.salvo || 0,                          // swarm airframe (Viper): >1 → MSL fires a no-lock ripple
    // An armed heli's gun is a CHIN turret — one light, fast-firing barrel under the nose, where
    // the fixed-wing gunship carries a heavy pair under the wings. Drives the muzzle station, the
    // firing cadence and the report.
    chinGun: opts.craftClass === 'heli' && (opts.hardpoints || 0) > 0,
    gunMs: (opts.craftClass === 'heli' && (opts.hardpoints || 0) > 0) ? GUN_FIRE_MS_LIGHT : GUN_FIRE_MS,
    shots: [],                                       // missiles currently in the air (visual only — see stepShots)
    gunCap: 1174, gunRounds: 1174,                   // GAU-8 ammo drum (cosmetic; counts down as the gun squirts)
    nightLight: false, landingLight: false,          // instrument-panel backlight (PANEL) + exterior landing/taxi lights (LIGHTS) — both need engine power
    raf: 0, last: 0, syncAcc: 0, hornBeat: 0, audioAcc: 0,
    temp: 40, battery: 100,          // cosmetic engine-temp (°C) + battery charge (%) for the gauge cluster
    engines: Math.max(1, opts.engines || 1), seats: Math.max(1, opts.seats || 1), occupants: opts.occupants || [],
    // Powerplant class → engine-instrument labelling/scales (piston RPM · turboprop TQ/ITT ·
    // turbofan N1/EGT). Mule = twin turboprop; Reaper (A-10/TF34) + Leviathan (An-124) = jets.
    engStyle: { mule: 'turboprop', reaper: 'turbofan', leviathan: 'turbofan', dragonfly: 'heli', viper: 'heli' }[opts.craftType] || 'piston',
    temps: [], rpms: [], engWander: 0,   // per-engine gauge state (twins get 2 RPM + 2 temp dials)

    disp: { ias: 0, alt: 0, vs: 0, hdg: s.heading, rpm: 0, pitch: 0, bank: 0 },
    contacts: [],   // air-to-air traffic, refreshed by flight_contacts
    aaSites: [],    // active ground AA emplacements (world tiles), refreshed by flight_aasites
    fireworks: [],  // active admin fireworks bursts (world tiles + spawn time), fed by fireworks_sim
    gunSolution: null, firing: false, fireHeld: false, hull: 100, hitFlashT: 0,   // Phase B: guns + battle damage
    // Phase C: weapon select (guns ↔ missiles), the seeker lock cycle, rail count, RWR state.
    weapon: 'guns', msl: opts.hardpoints || 0, seekId: null, lockProg: 0, lockId: null, mslWarnT: 0,
    listeners: [],
  };
  _fsim = F;

  const flapStyle = flapStyleFor(opts.craftType);   // per-airframe flaps graphic (null = heli, hidden)
  const isAdmin = ['admin', 'dev', 'builder', 'designer'].includes(state.myRole);
  const adminBtn = isAdmin ? '<button class="fsim-adminbtn" id="fsim-rewindbtn" title="ADMIN — rewind to the hangar you departed, with the plane (test)">⏪</button>' : '';
  // Rudder pedals — a pair of angled foot plates centred at the base of the view, flanking the
  // flight stick like the real thing (left plate = left rudder, right = right). Held to yaw —
  // equivalent to the ,/. — X/C keys, and the only rudder input touch devices have. Each plate
  // tips forward proportional to the LIVE pedal deflection every frame (via the --d var), so
  // keyboard use animates them too and they spring back with the input. Shown in both views.
  const PEDALS_HTML = `<div class="fsim-pedals" id="fsim-pedals">
      <button class="fsim-pedal fsim-pedal-l" id="fsim-pedal-l" title="left rudder / yaw (hold — , or X)" tabindex="-1" aria-label="left rudder"><span class="fsim-pedal-face"><span class="fsim-pedal-lbl">L</span></span></button>
      <button class="fsim-pedal fsim-pedal-r" id="fsim-pedal-r" title="right rudder / yaw (hold — . or C)" tabindex="-1" aria-label="right rudder"><span class="fsim-pedal-face"><span class="fsim-pedal-lbl">R</span></span></button>
    </div>`;
  const html = `<div id="fsim-root" class="fsim${skin ? ' fsim-theme-' + skin.id : ''}">
    <div class="fsim-view">${adminBtn}${windshieldHTML('fsim-ws', 'FWD VIEW · ' + esc((opts.deviceName || P.name).toUpperCase()))}<div class="fsim-lamp" id="fsim-lamp">⚠ STALL</div><div class="fsim-killfeed" id="fsim-killfeed"></div><div class="fsim-toast" id="fsim-toast"></div><div class="fsim-ckride" id="fsim-ckride"></div><div class="fsim-tour" id="fsim-tour"></div><div class="fsim-viewtag" id="fsim-viewtag"></div><div class="fsim-fuel" id="fsim-fuel"><span class="fsim-fuel-ic">⛽</span><span class="fsim-fuel-pct" id="fsim-fuel-pct">--%</span><button class="fsim-refuel" id="fsim-refuel" title="refuel at this field" tabindex="-1">REFUEL</button></div><div class="fsim-reticle" id="fsim-reticle"><svg viewBox="0 0 34 34"><circle cx="17" cy="17" r="12" fill="none" stroke="#ff6a3a" stroke-width="1"/><line x1="17" y1="1" x2="17" y2="7" stroke="#ff6a3a"/><line x1="17" y1="27" x2="17" y2="33" stroke="#ff6a3a"/><line x1="1" y1="17" x2="7" y2="17" stroke="#ff6a3a"/><line x1="27" y1="17" x2="33" y2="17" stroke="#ff6a3a"/><circle cx="17" cy="17" r="1.5" fill="#ff6a3a"/></svg></div><div class="fsim-weap" id="fsim-weap"><button class="fsim-weap-arm" id="fsim-arm" tabindex="-1">◈ SAFE</button><button class="fsim-weap-arm" id="fsim-wpn" tabindex="-1" title="weapon select — 1 guns / 2 missiles">GUN</button><button class="fsim-weap-fire" id="fsim-fire" tabindex="-1">FIRE</button><span class="fsim-weap-pips" id="fsim-weap-pips"></span><button class="fsim-weap-arm" id="fsim-flarebtn" tabindex="-1" title="countermeasures (X)">FLARE</button></div><div class="fsim-spray-mist" id="fsim-spray"></div><div class="fsim-sprayrig" id="fsim-sprayrig" aria-hidden="true"><svg viewBox="0 0 200 96" preserveAspectRatio="xMidYMid meet"><line class="sr-boom" x1="14" y1="42" x2="186" y2="42"/><g class="sr-noz"><line x1="30" y1="42" x2="30" y2="47"/><line x1="54" y1="42" x2="54" y2="47"/><line x1="78" y1="42" x2="78" y2="47"/><line x1="122" y1="42" x2="122" y2="47"/><line x1="146" y1="42" x2="146" y2="47"/><line x1="170" y1="42" x2="170" y2="47"/></g><rect class="sr-hopper" x="80" y="16" width="40" height="26" rx="3"/><line class="sr-hatch" x1="86" y1="24" x2="114" y2="24"/><rect class="sr-door sr-door-l" x="80" y="42" width="20" height="6" rx="1.5"/><rect class="sr-door sr-door-r" x="100" y="42" width="20" height="6" rx="1.5"/><g class="sr-spray"><line class="sr-drop" x1="30" y1="48" x2="30" y2="58" style="animation-delay:.30s"/><line class="sr-drop" x1="54" y1="48" x2="54" y2="58" style="animation-delay:.42s"/><line class="sr-drop" x1="90" y1="50" x2="90" y2="60" style="animation-delay:.26s"/><line class="sr-drop" x1="100" y1="50" x2="100" y2="60" style="animation-delay:.36s"/><line class="sr-drop" x1="110" y1="50" x2="110" y2="60" style="animation-delay:.30s"/><line class="sr-drop" x1="122" y1="48" x2="122" y2="58" style="animation-delay:.46s"/><line class="sr-drop" x1="146" y1="48" x2="146" y2="58" style="animation-delay:.34s"/><line class="sr-drop" x1="170" y1="48" x2="170" y2="58" style="animation-delay:.40s"/></g></svg><span class="sr-tag">◊ BOOMS OPEN</span></div><button class="fsim-spraybtn" id="fsim-spraybtn" tabindex="-1" title="crop-duster — open the spray booms on a LOW pass" style="display:none">◊ SPRAY</button><button class="fsim-abortbtn" id="fsim-abortbtn" title="abort the flight — a recovery crew tows the aircraft back to a field and bills you">⤫ ABORT</button><button class="fsim-disembarkbtn" id="fsim-disembarkbtn" title="climb out of the aircraft (on the ground only)">⏏ DISEMBARK</button><button class="fsim-fsbtn" id="fsim-fsbtn" title="fullscreen">⛶</button><button class="fsim-viewbtn" id="fsim-viewbtn" title="external / cockpit view (V)">◎ EXT</button><button class="fsim-orbitreset" id="fsim-orbitreset" title="reset orbit camera to behind the craft">⟲</button><button class="fsim-hidebtn" id="fsim-hidebtn" title="hide the text panel — more outside view">⊟</button><button class="fsim-tunebtn" id="fsim-tunebtn" title="render tuning">⚙</button><div class="fsim-tune" id="fsim-tune" style="display:none"></div><div class="fsim-extg" id="fsim-extg"><div class="fsim-extg-row"><span class="fsim-extg-lbl">IAS</span><b id="fsim-extg-ias">0</b><span class="fsim-extg-u">kt</span></div><div class="fsim-extg-row"><span class="fsim-extg-lbl">ALT</span><b id="fsim-extg-alt">0</b><span class="fsim-extg-u">ft</span></div></div>${PEDALS_HTML}</div>
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
          <button class="fsim-nightsw" id="fsim-nightsw" title="instrument panel lights (needs engine power)" tabindex="-1"><span class="fsim-nightsw-led"></span>PANEL</button>
          <button class="fsim-nightsw" id="fsim-landsw" title="exterior landing / taxi lights (needs engine power)" tabindex="-1"><span class="fsim-nightsw-led"></span>LIGHTS</button>
          <div class="fsim-ft-row">
            ${buildFlapHtml(flapStyle)}
            <div class="fsim-trim" id="fsim-trim" title="ELEVATOR TRIM — drag or roll the wheel; up = NOSE DOWN, down = NOSE UP">
              <span class="fsim-trim-end fsim-trim-nd">NOSE<br>DOWN</span>
              <div class="fsim-trim-wheel" id="fsim-trim-wheel">
                <div class="fsim-trim-drum" id="fsim-trim-drum"></div>
                <div class="fsim-trim-detent"><span>T/O</span></div>
                <div class="fsim-trim-handle" id="fsim-trim-handle"></div>
              </div>
              <span class="fsim-trim-end fsim-trim-nu">NOSE<br>UP</span>
              <span class="fsim-trim-val" id="fsim-trim-val">0</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="fsim-ctl">
      <div class="fsim-placard">
        <div class="fsim-plac-sheen" id="fsim-plac-sheen"></div>
        <div class="fsim-plac-guilloche"></div>
        <span class="fsim-plac-rivet tl" style="--r:22deg"></span><span class="fsim-plac-rivet tr" style="--r:-38deg"></span><span class="fsim-plac-rivet bl" style="--r:64deg"></span><span class="fsim-plac-rivet br" style="--r:8deg"></span>
        <div class="fsim-plac-title">◈ REGISTRATION</div>
        <div class="fsim-plac-reg" id="fsim-reg">—</div>
        <div class="fsim-plac-model"><span class="fsim-plac-k">MAKE</span><span id="fsim-model">—</span></div>
        <div class="fsim-plac-own" id="fsim-own"><span class="fsim-plac-k" id="fsim-own-k">OWNER</span><span id="fsim-own-name">—</span></div>
        <div class="fsim-plac-seats" id="fsim-seats"></div>
        <div class="fsim-plac-barcode"><span class="bars"></span><span class="sn" id="fsim-plac-sn">S/N —</span></div>
      </div>
      <div class="fsim-yoke" id="fsim-yoke">${yokeSvgFor(opts.craftType)}</div>
      <div class="fsim-xpdr">
        <div class="fsim-xpdr-title">XPDR · COM/NAV</div>
        <div class="fsim-radio-lcd">
          <div class="fsim-radio-frow"><span class="k">COM</span><b>118.00</b><i>121.50</i></div>
          <div class="fsim-radio-frow"><span class="k">NAV</span><b>112.30</b><i>110.90</i></div>
          <div class="fsim-radio-frow sq"><span class="k">SQWK</span><b id="fsim-sq">1200</b><i class="mode">ALT</i></div>
          <div class="fsim-radio-frow"><span class="k">TILE</span><b id="fsim-tile" style="font-size:9px;letter-spacing:0;">—</b></div>
          <div class="fsim-radio-frow tgt"><span class="k">TGT</span><button class="fsim-tgt-btn" id="fsim-tgt-prev" title="previous target ([)" tabindex="-1">◂</button><b id="fsim-tgt-name">—</b><button class="fsim-tgt-btn" id="fsim-tgt-next" title="next target (])" tabindex="-1">▸</button><button class="fsim-tgt-btn" id="fsim-tgt-clear" title="clear all waypoints (\\)" tabindex="-1">✕</button></div>
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
  // In the external chase view the grab pad floats ON TOP of the rudder pedals (higher stacking
  // context), so a press meant for a pedal gets swallowed by the pad and grabs the stick. Before
  // grabbing, hit-test the pedal boxes and, if the press landed on one, drive that pedal instead —
  // the pad defers to the pedals so they never interfere, whatever the exact overlap.
  const pedalHit = (e) => {
    for (const el of [F.pedalL, F.pedalR]) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return el === F.pedalR ? 1 : -1;
    }
    return 0;
  };
  add(pad, 'pointerdown', (e) => {
    if (e.button) return;
    const pd = pedalHit(e);
    if (pd) { F.pedalKey = pd; F.padPedal = pd; try { pad.setPointerCapture(e.pointerId); } catch {} e.preventDefault(); return; }
    F.yokeDrag = true; pad.classList.add('drag'); try { pad.setPointerCapture(e.pointerId); } catch {} padTo(e);
  });
  add(pad, 'pointermove', (e) => { if (F.yokeDrag) padTo(e); });
  add(window, 'pointerup', () => { F.yokeDrag = false; pad.classList.remove('drag'); if (F.padPedal) { if (F.pedalKey === F.padPedal) F.pedalKey = 0; F.padPedal = 0; } });

  // Rudder pedals — press-and-hold, exactly like the ,/. (X/C) keys: each drives F.pedalKey to a
  // side and releases to centre. Pointer capture means sliding a thumb off the pad still lets go.
  // The frame loop paints the depression from the live deflection, so no visual work here.
  F.pedalL = q('#fsim-pedal-l'); F.pedalR = q('#fsim-pedal-r');
  F.pedalLFace = F.pedalL && F.pedalL.querySelector('.fsim-pedal-face');
  F.pedalRFace = F.pedalR && F.pedalR.querySelector('.fsim-pedal-face');
  const wirePedal = (el, dir) => {
    if (!el) return;
    const press = (e) => { if (e.button) return; F.pedalKey = dir; try { el.setPointerCapture(e.pointerId); } catch {} e.preventDefault(); };
    const release = () => { if (F.pedalKey === dir) F.pedalKey = 0; };
    add(el, 'pointerdown', press);
    add(el, 'pointerup', release);
    add(el, 'pointercancel', release);
    add(el, 'lostpointercapture', release);
  };
  wirePedal(F.pedalL, -1);
  wirePedal(F.pedalR, 1);

  // Throttle — vertical lever, holds where you leave it.
  const thr = q('#fsim-thr');
  const thrTo = (e) => { const r = thr.getBoundingClientRect(); F.input.throttle = clampNum(1 - (e.clientY - r.top) / r.height, 0, 1); };
  add(thr, 'pointerdown', (e) => { F.thrDrag = true; try { thr.setPointerCapture(e.pointerId); } catch {} thrTo(e); });
  add(thr, 'pointermove', (e) => { if (F.thrDrag) thrTo(e); });
  add(window, 'pointerup', () => { F.thrDrag = false; });

  // External-view orbit — hold the MIDDLE mouse button and drag to orbit the chase camera around
  // the aircraft on a turntable arc (drag left/right = spin around, up/down = rise over the top to
  // look down / swing under the belly to look up). The camera LOCKS wherever you leave it — no
  // spring-back — so you can fly and watch from any angle. The ⟲ reset button SWINGS it back to just
  // behind and above the craft. Only in external view.
  const viewEl = q('.fsim-view');
  if (viewEl) {
    let ox = 0, oy = 0;
    add(viewEl, 'pointerdown', (e) => {
      if (e.button !== 1 || !F.external) return;
      F.orbitDrag = true; ox = e.clientX; oy = e.clientY; e.preventDefault();
      try { viewEl.setPointerCapture(e.pointerId); } catch {}
    });
    add(window, 'pointermove', (e) => {
      if (!F.orbitDrag) return;
      F.orbitResetting = false;                                                        // a manual drag cancels a running reset swing
      F.extOrbit = (F.extOrbit || 0) + (e.clientX - ox) * 0.4;                          // horizontal yaw (deg), unbounded — spins all the way around
      F.extPitch = clampNum((F.extPitch ?? REST_PITCH) - (e.clientY - oy) * 0.006, -1.1, 1.15);   // vertical orbit angle (rad): drag up = over the top (look down), drag down = under the belly (look up). Bounds kept short of the poles (~66°) so the near-vertical view can't stretch the model into a spindle. The renderer also stops the under-swing at the terrain.
      ox = e.clientX; oy = e.clientY;
    });
    add(window, 'pointerup', (e) => { if (e.button === 1) F.orbitDrag = false; });
    add(viewEl, 'auxclick', (e) => { if (e.button === 1) e.preventDefault(); });   // no middle-click autoscroll inside the view
    // External-view zoom — mouse wheel pulls the chase camera in/out (scale on chaseBack).
    // Down/away = zoom out (bigger back), up/toward = zoom in. Clamped so you can't clip
    // into the model or drift so far the plane's a dot. Only live in the external chase view.
    add(viewEl, 'wheel', (e) => {
      if (!F.external) return;
      e.preventDefault();
      F.extZoom = clampNum((F.extZoom || 1) * (e.deltaY > 0 ? 1.1 : 0.9), 0.45, 2.4);
    }, { passive: false });
  }

  // Aircraft placard (bottom-left) — a certificate of registration: tail number, make/model,
  // and the registered owner (your name if it's yours; the hangar/operator it's rented from).
  const regEl = q('#fsim-reg'), ownEl = q('#fsim-own'), ownNameEl = q('#fsim-own-name'), ownKEl = q('#fsim-own-k'), modelEl = q('#fsim-model');
  if (regEl) regEl.textContent = F.reg;
  const snEl = q('#fsim-plac-sn');
  if (snEl) snEl.textContent = 'S/N ' + String(F.reg || '—') + '·' + String(opts.craftType || '').replace(/^ac_/, '').slice(0, 4).toUpperCase();
  if (modelEl) modelEl.textContent = String(opts.deviceName || P.name || 'AIRCRAFT').toUpperCase();
  if (ownNameEl) ownNameEl.textContent = F.owner;
  if (ownKEl) ownKEl.textContent = F.rented ? 'OPER' : 'OWNER';
  if (ownEl) ownEl.classList.toggle('rented', F.rented);
  // Stamp the aircraft name across the yoke hub (themed accent via CSS) + the cabin readout.
  const yokeName = q('#fsim-yoke-name'); if (yokeName) yokeName.textContent = String(opts.deviceName || P.name || 'AIRCRAFT').toUpperCase();
  // Paint reads on the control itself: the name-plate PANEL takes the interior
  // cabin/upholstery colour, and the aircraft name PRINTED on it takes the exterior
  // paint colour (lifted to stay legible on the dark plate). No paint on file
  // (rentals) → leave the airframe's stock themed plate + accent lettering.
  if (F.livery) {
    const plate = q('#fsim-yoke-plate');
    if (plate && /^#[0-9a-fA-F]{6}$/.test(F.livery.cabin || '')) plate.setAttribute('fill', F.livery.cabin);
    const ink = legibleInk(F.livery.base);
    if (yokeName && ink) yokeName.style.fill = ink;
    // Retint the whole dashboard surround from the cabin colour: a lit edge + a
    // three-stop gradient the panel slabs share. Only when there's a valid cabin hex.
    const cab = hex2rgb(F.livery.cabin);
    if (cab) {
      root.style.setProperty('--panel-hi', shadeRgb(cab, 1.5));
      root.style.setProperty('--panel-mid', shadeRgb(cab, 1.0));
      root.style.setProperty('--panel-lo', shadeRgb(cab, 0.55));
      root.style.setProperty('--panel-edge', mixRgb(cab, [255, 255, 255], 0.32));
      root.classList.add('fsim-painted');
    }
  }
  // Cockpit chrome accent follows the paint bay, not the game UI accent: blend the exterior
  // paint (base + trim) and the upholstery (cabin) into --cy, which drives the radios, knobs,
  // LEDs, night wash and the canvas instruments. No paint on file → fall back to the airframe's
  // stock class accent — never the global --accent theme colour.
  const stockAcc = (skin && skin.acc) || themeFor(F.cls).acc;
  const chromeAcc = liveryAccent(F.livery, stockAcc);
  const chromeRgb = hex2rgb(chromeAcc);
  if (chromeRgb) { ACCENT = chromeAcc; ACCENT_RGB = chromeRgb; }   // canvas instruments (accA/ACCENT read the globals)
  root.style.setProperty('--cy', chromeAcc);                       // beats the .fsim-theme-* class --cy (inline > class)
  // --cy-lit is the BACKLIGHT colour: the airframe's vivid stock accent, NOT the (possibly muted)
  // paint blend — so the panel/landing lights glow bright at night on any paint job. Chrome still
  // follows --cy (paint); only the lit night-lighting reads --cy-lit.
  const litRgb = hex2rgb(stockAcc) || chromeRgb;
  root.style.setProperty('--cy-lit', stockAcc);
  if (litRgb) root.style.setProperty('--cy-lit-dim', `rgba(${litRgb[0]},${litRgb[1]},${litRgb[2]},.24)`);
  // Floor-mounted controls (Reaper combat stick, Dragonfly cyclic) pivot near their
  // base, not the wheel-column mid-point the CSS default (50% 66%) assumes — so the
  // frame-loop lean rotates the whole stick about its boot instead of its shaft.
  const yokeSvgEl = q('#fsim-yoke-svg');
  if (yokeSvgEl && (opts.craftType === 'reaper' || opts.craftType === 'dragonfly' || opts.craftType === 'viper')) yokeSvgEl.style.transformOrigin = '50% 92%';
  renderSeats(F);

  // Flaps — a per-airframe lever (Cessna Johnson bar / airliner quadrant / switch), or absent
  // on the heli. Detents map evenly onto the model's 0..1 flaps input; drag or click the gate
  // to the nearest notch. Exposed on F so the R/F keys and any external caller can step it.
  const flapTrack = q('#fsim-flapsw-track'), flapKnob = q('#fsim-flapsw-knob');
  if (flapStyle && flapTrack) {
    const detents = flapStyle.detents, n = detents.length;
    const flapLbls = root.querySelectorAll('.fsim-flap-scale span');
    const topFor = (i) => `${(4 + (i / (n - 1)) * 66).toFixed(1)}%`;   // knob top inside the gate (leaves room for the lever height at FULL)
    const setFlap = (i) => {
      i = clampInt(i, 0, n - 1); F.flapIdx = i; F.input.flaps = detents[i].v;
      if (flapKnob) flapKnob.style.top = topFor(i);
      flapLbls.forEach((s2) => s2.classList.toggle('on', +s2.dataset.fd === i));
    };
    const pick = (e) => { const r = flapTrack.getBoundingClientRect(); return Math.round(clampNum((e.clientY - r.top) / r.height, 0, 1) * (n - 1)); };
    let flapDrag = false;
    const toDetent = (i) => { if (i !== F.flapIdx) { setFlap(i); flapWhir(); } };
    add(flapTrack, 'pointerdown', (e) => { flapDrag = true; flapTrack.setPointerCapture?.(e.pointerId); toDetent(pick(e)); });
    add(flapTrack, 'pointermove', (e) => { if (flapDrag) toDetent(pick(e)); });
    add(flapTrack, 'pointerup', () => { flapDrag = false; });
    add(flapTrack, 'pointercancel', () => { flapDrag = false; });
    F._setFlap = setFlap; F._flapN = n;
    setFlap(0);
  } else {
    F.input.flaps = 0; F._flapN = 0;   // heli / no flaps — leave the input clean
  }

  // Elevator trim — a console wheel that biases the yoke's neutral so you can hold an attitude
  // hands-off (trim adds to elevator in the model). Mouse-wheel to roll it; click the top half
  // for nose-up, the bottom half for nose-down. Capped well short of full deflection so it
  // assists rather than flies for you. Helis have no elevator trim — the block is hidden.
  const TRIM_STEP = 0.04, TRIM_MAX = 0.6;
  const trimEl = q('#fsim-trim'), trimWheel = q('#fsim-trim-wheel'), trimDrum = q('#fsim-trim-drum'), trimVal = q('#fsim-trim-val'), trimHandle = q('#fsim-trim-handle');
  const setTrim = (t) => {
    F.input.trim = clampNum(t, -TRIM_MAX, TRIM_MAX);
    // +trim = NOSE UP → handle rides toward the BOTTOM; −trim = NOSE DOWN → toward the top.
    const frac = (F.input.trim + TRIM_MAX) / (2 * TRIM_MAX);          // 0 (nose down/top) .. 1 (nose up/bottom)
    if (trimDrum) trimDrum.style.transform = `translateY(${F.input.trim / TRIM_MAX * 12}px)`;   // chain scrolls with trim
    if (trimHandle) trimHandle.style.top = `${frac * 100}%`;
    if (trimVal) {
      const n = Math.round(F.input.trim / TRIM_STEP);
      trimVal.textContent = n === 0 ? '0' : (n > 0 ? '▲' : '▼') + Math.abs(n);
      trimVal.classList.toggle('set', n !== 0);
    }
  };
  // Helis get a cyclic trim wheel too (not realistic on a real Mini-500, but a big usability win):
  // roll in forward trim and she holds a nose-down cruise attitude hands-off instead of needing
  // constant forward stick. Relabel the ends FWD/AFT since on a heli nose-down = accelerate forward.
  if (F.heli) {
    const nd = trimEl && trimEl.querySelector('.fsim-trim-nd'), nu = trimEl && trimEl.querySelector('.fsim-trim-nu');
    if (nd) nd.innerHTML = 'NOSE<br>FWD';
    if (nu) nu.innerHTML = 'NOSE<br>AFT';
    if (trimEl) trimEl.title = 'CYCLIC TRIM — drag or roll the wheel; up = NOSE FWD (cruise), down = NOSE AFT';
  }
  if (trimWheel) {
    // Spatially consistent everywhere: moving toward NOSE UP (down) raises trim, toward NOSE
    // DOWN (up) lowers it. Wheel + click step; a vertical drag rolls it continuously.
    add(trimWheel, 'wheel', (e) => { e.preventDefault(); setTrim(F.input.trim + (e.deltaY > 0 ? TRIM_STEP : -TRIM_STEP)); }, { passive: false });
    let dragY = null, dragBase = 0, moved = false;
    add(trimWheel, 'pointerdown', (e) => { trimWheel.setPointerCapture(e.pointerId); dragY = e.clientY; dragBase = F.input.trim; moved = false; });
    add(trimWheel, 'pointermove', (e) => { if (dragY == null) return; const dy = e.clientY - dragY; if (Math.abs(dy) > 3) moved = true; setTrim(dragBase + dy / 60 * TRIM_MAX); });   // drag down → nose up
    const endDrag = (e) => {
      if (dragY != null && !moved) { const r = trimWheel.getBoundingClientRect(); setTrim(F.input.trim + ((e.clientY - r.top) < r.height / 2 ? -TRIM_STEP : TRIM_STEP)); }   // tap top = nose down, bottom = nose up
      dragY = null;
    };
    add(trimWheel, 'pointerup', endDrag);
    add(trimWheel, 'pointercancel', () => { dragY = null; });
  }
  setTrim(0);

  // Transient action toast (flap/gear/jettison feedback). Auto-hides ~1.1s.
  const toastEl = q('#fsim-toast');
  const fsimToast = (txt) => {
    if (!toastEl) return;
    toastEl.textContent = txt; toastEl.classList.add('show');
    if (F.toastT) clearTimeout(F.toastT);
    F.toastT = setTimeout(() => toastEl.classList.remove('show'), 1100);
  };
  F.toast = fsimToast;   // so the frame loop (touchdown/rollout prompts) can raise toasts too
  if (F.checkride) renderCheckride(F, F.checkride);   // opening checkride card + control glows

  // ── Keyboard flight controls ────────────────────────────────────────────────
  // A/Z throttle · Q/E/S hold-to-look (release → forward) · W forward · R/F flaps ·
  // G gear (if retractable) · J jettison cargo · SPACE fire (hold) · 1/2 weapon select ·
  // X flares. Ignored while typing in a text field.
  const VIEW_TAG = { '-90': '◀ LEFT VIEW', '90': 'RIGHT VIEW ▶', '180': '▲ REAR VIEW' };
  const viewTagEl = q('#fsim-viewtag');
  const setView = (yaw) => {
    F.viewYaw = yaw;
    if (viewTagEl) { viewTagEl.textContent = VIEW_TAG[String(yaw)] || ''; viewTagEl.classList.toggle('show', yaw !== 0); }
    // Looking off the nose (Q/E/S): drop the forward instrument panel so the side/rear view
    // fills the glass — you're not looking at your gauges when you're checking your six.
    const hudRoot = document.getElementById('ck-hud-root');
    if (hudRoot) hudRoot.classList.toggle('ck-looking', yaw !== 0);
  };
  const stepFlap = (d) => { if (!F._flapN || !F._setFlap) return; const i = clampInt(F.flapIdx + d, 0, F._flapN - 1); if (i !== F.flapIdx) { F._setFlap(i); flapWhir(); } };
  const toggleGear = () => {
    if (!F.gearRetract) { fsimToast('— FIXED GEAR —'); return; }
    F.gearUp = !F.gearUp;
    try { gearFx(F.gearUp ? 'retract' : 'extend'); } catch {}
    // Raise the gear with weight on the wheels and she drops onto her belly: a grinding
    // crunch, a jolt, and the mains are gone — she won't roll or take off until you put the
    // wheels back down (or hit ABORT for a tow). Play stupid games…
    if (F.gearUp && F.s.onGround) {
      F.shake = 14;
      try { groundFx('touchdownHard'); } catch {}
      fsimToast('⚠ GEAR UP ON THE GROUND — she settles onto her belly');
      return;
    }
    fsimToast(F.gearUp ? 'GEAR UP' : 'GEAR DOWN');
  };
  const jettison = () => {
    if (!F.cargoKg) { fsimToast('— NO CARGO —'); return; }
    F.cargoKg = 0; sendCmdSilent('jettison'); fsimToast('CARGO JETTISONED');
  };
  // Target guide — [ / ] (and the radio ◂/▸ buttons) step the destination the target ring /
  // Home waypoint locks onto: airfields, named landmarks (Precinct 9, the Embassy…) AND spatial
  // regions (Coldwater Basin, The Reach…), so you can point the guide at any real place. Keyed
  // by id so the choice survives the list re-sort. ✕ (radio button / \ key) clears it entirely.
  const targetList = () => [...(Array.isArray(F.fields) ? F.fields : []), ...(Array.isArray(F.landmarks) ? F.landmarks : []), ...(Array.isArray(F.regions) ? F.regions : [])];
  const cycleApTarget = (dir) => {
    const list = targetList();
    if (!list.length) { fsimToast('— NO DESTINATIONS IN RANGE —'); return; }
    F.apCleared = false;   // stepping the guide re-arms it after a clear
    let i = list.findIndex((f) => f.id === F.apTargetId);
    i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    F.apTargetId = list[i].id;
    fsimToast(`◎ ${(list[i].name || 'FIELD').toUpperCase()} · ${list[i].dist}mi`);
  };
  // Clear all waypoints — drop the target so no ring / Home marker is drawn, and hold that
  // cleared state (the per-frame resolve won't auto-snap back to the nearest field) until the
  // pilot picks a new target with [ / ] or the radio ◂/▸.
  const clearApTarget = () => {
    F.apTargetId = null; F.apCleared = true;
    const nmEl = document.getElementById('fsim-tgt-name');
    if (nmEl) nmEl.textContent = '—';
    fsimToast('◎ WAYPOINTS CLEARED');
  };
  let setExternal = () => {};   // assigned when the ◎ EXT button is wired below; V key + button share it
  let setWeapon = () => {};     // assigned in the weapons wiring below; 1/2 keys + WPN button share it
  const KEYS = new Set(['a', 'z', 'q', 'w', 'e', 's', 'y', 'h', 'f', 'g', 'j', 'v', 'x', 'c', '1', '2', ' ', '[', ']', '\\', ',', '.']);
  const onKeyDown = (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
    const k = (e.key || '').toLowerCase();
    if (!KEYS.has(k)) return;
    e.preventDefault();
    switch (k) {
      case 'a': F.throttleKey = 1; break;
      case 'z': F.throttleKey = -1; break;
      // Q/E are hold-to-look (side views) on every craft, heli included — the tail-rotor
      // yaw lives on the rudder pedals below, same as the fixed-wings.
      case 'q': setView(-90); break;
      case 'e': setView(90); break;
      // Rudder/yaw pedals, held — on the heli these pedal the tail rotor. ,/. and X/C are
      // interchangeable alternatives (some keyboards make ,/. awkward).
      case ',': case 'x': F.pedalKey = -1; break;   // left rudder / pedal
      case '.': case 'c': F.pedalKey = 1; break;    // right rudder / pedal
      case 's': setView(180); break;
      case 'w': setView(0); break;
      case 'y': if (!e.repeat) stepFlap(1); break;   // flaps extend
      case 'h': if (!e.repeat) stepFlap(-1); break;  // flaps retract
      case 'g': if (!e.repeat) toggleGear(); break;
      case 'v': if (!e.repeat) setExternal(!F.external); break;
      case 'j': if (!e.repeat) jettison(); break;
      case 'f': if (!e.repeat && F.reportedAirborne) sendCmdSilent('flares'); break;   // countermeasures (server confirms via air_threat)
      case '1': if (!e.repeat) setWeapon('guns'); break;   // weapon select
      case '2': if (!e.repeat) setWeapon('msl'); break;
      case '[': if (!e.repeat) cycleApTarget(-1); break;   // cycle target (fields / landmarks / regions)
      case ']': if (!e.repeat) cycleApTarget(1); break;
      case '\\': if (!e.repeat) clearApTarget(); break;    // clear all waypoints
      case ' ': F.firing = true; break;   // hold to fire guns (frame loop squirts bursts)
    }
  };
  const onKeyUp = (e) => {
    const k = (e.key || '').toLowerCase();
    if (k === 'a' || k === 'z') F.throttleKey = 0;
    else if (k === ',' || k === '.' || k === 'x' || k === 'c') F.pedalKey = 0;   // release pedal → centres
    else if (k === 'q' || k === 'e' || k === 's') setView(0);      // release hold-to-look → forward
    else if (k === ' ') F.firing = false;                         // release trigger
  };
  add(window, 'keydown', onKeyDown);
  add(window, 'keyup', onKeyUp);

  // Engine master — a round accent button that recesses while running. Off→on any time;
  // on→off only parked and stopped (you can't kill the engine in the air).
  // Instrument panel lights — a dash switch that backlights the glass panels + dials in the
  // accent colour (for night flying) — and the exterior LIGHTS switch (landing/taxi lamps). Both
  // draw off the engine: no master, no power, so cutting the engine drops every light (nav lamps
  // included, out on the model) and the switches read dead until it's running again.
  root.style.setProperty('--cy-dim', accA(0.16));
  const nightSw = q('#fsim-nightsw'), landSw = q('#fsim-landsw');
  const syncLights = () => {
    if (!F.engineOn) { F.nightLight = false; F.landingLight = false; }   // engine off → all circuits dead
    nightSw.classList.toggle('on', F.nightLight);
    root.classList.toggle('fsim-nightlit', F.nightLight);
    nightSw.classList.toggle('nopwr', !F.engineOn);
    if (landSw) { landSw.classList.toggle('on', F.landingLight); landSw.classList.toggle('nopwr', !F.engineOn); }
  };

  const engBtn = q('#fsim-eng');
  if (F.engineOn) engBtn.classList.add('on');
  add(engBtn, 'click', () => {
    if (!F.engineOn) {
      F.engineOn = true; engBtn.classList.add('on');
      // Start at IDLE — the engine coming alive must never surge the plane forward. You
      // advance the throttle yourself to taxi up to the runway (the lever visual follows
      // input.throttle each frame, so zeroing it here also drops the lever to idle).
      F.input.throttle = 0; F.throttleKey = 0;
      try { spoolUp(F.cls); } catch {}
      if (F.hasVisor && F.noseVisor > 0.02) { try { visorFx('close'); } catch {} }   // nose visor lowers home under power
      sendCmdSilent('flightevent engineon');
      syncLights();   // power restored — switches come live again (lights stay off until switched on)
    } else if (s.onGround && s.airspeed < 5) {
      if (F.rolling && !F.heli) { finishLanding(F, s); return; }   // fixed-wing rolled to a stop → park (opens the hangar at a field)
      F.engineOn = false; engBtn.classList.remove('on');
      try { spoolDown(F.cls); } catch {}
      if (F.hasVisor) { try { visorFx('open'); } catch {} }   // shut down on the ramp → the nose yawns open
      sendCmdSilent('flightevent engineoff');
      syncLights();   // master off → kill instrument backlight + exterior lamps
      // A helicopter never auto-parks/leaves the sim on shutdown — it stays put so the pilot can
      // spin back up or look around; the only way out is typing `disembark` (climb out).
      if (F.heli && F.rolling) { F.rolling = false; if (F.toast) F.toast('SHUT DOWN — type disembark to climb out'); }
    }
  });

  add(nightSw, 'click', () => { if (!F.engineOn) return; F.nightLight = !F.nightLight; syncLights(); });
  add(landSw, 'click', () => { if (!F.engineOn) return; F.landingLight = !F.landingLight; syncLights(); });
  syncLights();   // set the initial switch/LED state to match the engine at mount (usually cold + dark)

  // Weapons (gunship only): master-arm toggle + FIRE (a gun pass — resolved inline by the
  // server against an AA site in range). Space also fires. Reticle glows when armed.
  const weapEl = q('#fsim-weap'), reticleEl = q('#fsim-reticle');
  const armBtn = q('#fsim-arm'), fireBtn = q('#fsim-fire'), pipsEl = q('#fsim-weap-pips');
  const wpnBtn = q('#fsim-wpn'), flareBtn = q('#fsim-flarebtn');
  // Ammo pips: hardpoint diamonds with guns selected, missiles-remaining darts with MSL.
  const paintPips = () => {
    if (!pipsEl) return;
    pipsEl.textContent = F.weapon === 'msl' ? (F.msl > 0 ? '▲'.repeat(F.msl) : '—') : '◆'.repeat(F.hardpoints);
  };
  F.paintPips = paintPips;   // flight_ctx refreshes the rail count → repaint
  if (F.hardpoints > 0) {
    if (weapEl) weapEl.classList.add('show');
    paintPips();
    const setArmed = (on) => {
      F.armed = on;
      if (armBtn) { armBtn.textContent = on ? '● ARMED' : '◈ SAFE'; armBtn.classList.toggle('hot', on); }
      if (fireBtn) fireBtn.classList.toggle('ready', on);
      if (reticleEl) reticleEl.classList.toggle('on', on);
    };
    add(armBtn, 'click', () => { setArmed(!F.armed); sendCmdSilent(F.armed ? 'arm' : 'safe'); });
    // Weapon select (guns ↔ missiles) — the WPN button and the 1/2 keys share this.
    setWeapon = (w) => {
      if (w === F.weapon) return;
      F.weapon = w;
      if (wpnBtn) { wpnBtn.textContent = w === 'msl' ? 'MSL' : 'GUN'; wpnBtn.classList.toggle('hot', w === 'msl'); }
      paintPips();
      fsimToast(w === 'msl' ? `▲ MISSILES · ${F.msl} ON THE RAILS` : '◆ GUNS');
    };
    add(wpnBtn, 'click', () => setWeapon(F.weapon === 'msl' ? 'guns' : 'msl'));
    add(flareBtn, 'click', () => { if (F.reportedAirborne) sendCmdSilent('flares'); });
    // FIRE is a HELD trigger (touch/mouse): the frame loop squirts bursts while down.
    const holdFire = (on) => (e) => { if (e) e.preventDefault(); F.firing = on; };
    if (fireBtn) {
      add(fireBtn, 'pointerdown', holdFire(true));
      add(window, 'pointerup', holdFire(false));
      add(fireBtn, 'pointerleave', holdFire(false));
    }
  }

  // Crop-duster SPRAY (ag-planes only — the Locust): a low-pass dust that lays a mist over
  // the tile below. The button both fires the server pass and pulses the local mist FX; the server
  // gates it to a LOW pass and rate-limits, so a spam-click just no-ops.
  const sprayBtn = q('#fsim-spraybtn'), sprayMist = q('#fsim-spray'), sprayRig = q('#fsim-sprayrig');
  if (F.sprayer && sprayBtn) {
    sprayBtn.style.display = '';
    const pulse = (el, ms) => { if (!el) return; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); setTimeout(() => el.classList.remove('on'), ms); };
    const doSpray = () => {
      if (!F.reportedAirborne) { fsimToast('◊ AIRBORNE + LOW TO DUST'); return; }
      sendCmdSilent('spray');
      fsimToast('◊ CROP-DUSTING');
      spraySfx();                       // hopper bay doors thunk open + pressurised chemical hiss
      pulse(sprayMist, 1700);           // haze drifting down the windshield
      pulse(sprayRig, 1900);            // belly-hopper schematic: clamshell doors open, booms fan spray
    };
    add(sprayBtn, 'click', doSpray);
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
  // Vertex-light colour pickers (key/sky/shadow × day/night) — write hex straight into RENDER_TUNE.
  const VLIGHT_COLORS = [
    ['vlKeyDay', 'Key · day'], ['vlKeyNight', 'Key · night'],
    ['vlSkyDay', 'Sky · day'], ['vlSkyNight', 'Sky · night'],
    ['vlShadowDay', 'Shadow · day'], ['vlShadowNight', 'Shadow · night'],
  ];
  const colRow = ([k, lbl]) =>
    `<div class="trow"><label>${lbl}</label><input type="color" data-ck="${k}" value="${RENDER_TUNE[k]}"><span class="tv"></span></div>`;
  tunePanel.innerHTML =
    `<div class="fsim-tune-drag" id="fsim-tune-drag">⠿ TUNING — drag to move</div>` +
    `<div class="thdr">✈ ${esc(F.P.name || 'AIRCRAFT')} · FEEL</div>` + PHYS_TUNE.map(physRow).join('') +
    `<div class="thdr">▦ WORLD RENDER</div>` + FSIM_TUNE.map(rndRow).join('') +
    `<div class="thdr">◧ VERTEX LIGHT COLOURS</div>` + VLIGHT_COLORS.map(colRow).join('');
  // Drag the tuning window by its header. Switches to left/top positioning (relative to the
  // view) on first grab so it can move anywhere; the sliders below keep their own pointer events.
  const dragH = q('#fsim-tune-drag');
  if (dragH) {
    let dragging = false, px = 0, py = 0, baseL = 0, baseT = 0;
    add(dragH, 'pointerdown', (e) => {
      const r = tunePanel.getBoundingClientRect();
      const pr = (tunePanel.offsetParent || tunePanel.parentElement).getBoundingClientRect();
      baseL = r.left - pr.left; baseT = r.top - pr.top;
      tunePanel.style.left = baseL + 'px'; tunePanel.style.top = baseT + 'px'; tunePanel.style.right = 'auto';
      px = e.clientX; py = e.clientY; dragging = true; e.preventDefault();
    });
    add(window, 'pointermove', (e) => { if (!dragging) return; tunePanel.style.left = (baseL + e.clientX - px) + 'px'; tunePanel.style.top = (baseT + e.clientY - py) + 'px'; });
    add(window, 'pointerup', () => { dragging = false; });
  }
  tunePanel.querySelectorAll('input[data-pk]').forEach((inp) => add(inp, 'input', () => {
    const k = inp.dataset.pk; F.P[k] = parseFloat(inp.value);
    const tv = document.getElementById('fsim-pv-' + k); if (tv) tv.textContent = fmtStp(F.P[k], inp.step);
  }));
  tunePanel.querySelectorAll('input[data-k]').forEach((inp) => add(inp, 'input', () => {
    const k = inp.dataset.k; RENDER_TUNE[k] = parseFloat(inp.value);
    const tv = document.getElementById('fsim-tv-' + k); if (tv) tv.textContent = fmtStp(RENDER_TUNE[k], inp.step);
  }));
  tunePanel.querySelectorAll('input[data-ck]').forEach((inp) => add(inp, 'input', () => { RENDER_TUNE[inp.dataset.ck] = inp.value; }));
  add(tuneBtn, 'click', () => { tunePanel.style.display = tunePanel.style.display === 'none' ? 'block' : 'none'; });

  // Admin ⏪ rewind — set the plane back down at the departure hangar and reopen it (test tool).
  // The server (airhome) parks her + disembarks; we then close the sim and open the hangar bay.
  const rewindBtn = q('#fsim-rewindbtn');
  if (rewindBtn) add(rewindBtn, 'click', () => {
    sendCmdSilent('airhome');
    fsimToast('⏪ REWIND — back to the hangar');
    setTimeout(() => { closeFlightSim(); sendCmdSilent('hangar'); }, 450);
  });

  // Abort — bail out of the flight from anywhere. The server dispatches a recovery crew that
  // tows the craft back to a field and bills a retrieval fee (same as an off-strip tow), then
  // sets you on the ground. Two-tap armed so a stray click doesn't cost you credits.
  const abortBtn = q('#fsim-abortbtn');
  let abortArm = 0;
  add(abortBtn, 'click', () => {
    if (F.last - abortArm > 3000) {
      abortArm = F.last;
      abortBtn?.classList.add('armed');
      fsimToast('⤫ ABORT? — tap again to bail (aircraft recovered at cost)');
      setTimeout(() => abortBtn?.classList.remove('armed'), 3000);
      return;
    }
    abortArm = 0;
    abortBtn?.classList.remove('armed');
    sendCmdSilent('flightevent abort');
    fsimToast('⤫ ABORTING — recovery crew inbound');
    setTimeout(() => { closeFlightSim(); sendCmdSilent('look'); }, 600);
  });

  // Disembark — climb out where you're parked. Shown by the frame loop only while on the
  // ground (the server rejects it airborne anyway); fires the same `disembark` verb the command
  // line uses, then closes the sim so the room look takes over.
  const disembarkBtn = q('#fsim-disembarkbtn');
  add(disembarkBtn, 'click', () => {
    sendCmdSilent('disembark');
    fsimToast('⏏ CLIMBING OUT…');
    setTimeout(() => { closeFlightSim(); sendCmdSilent('look'); }, 400);
  });

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

  // External / cockpit view toggle — the ◎ EXT button mirrors the V key; both call setExternal
  // so the button's lit state and F.external stay in sync however you flip it.
  const viewBtn = q('#fsim-viewbtn');
  setExternal = (on) => { F.external = on; if (viewBtn) viewBtn.classList.toggle('on', on); document.body.classList.toggle('fsim-external', on); fsimToast(on ? '◎ EXTERNAL VIEW' : '◎ COCKPIT VIEW'); };
  F.setExternalView = setExternal;   // the crash death-cam borrows it to force the external view
  add(viewBtn, 'click', () => setExternal(!F.external));

  // ⟲ Reset — SWING the orbit camera from wherever it is back to just behind and above the craft
  // (the frame loop eases yaw/elevation/zoom to rest; a manual drag cancels it mid-swing).
  add(q('#fsim-orbitreset'), 'click', () => { F.orbitResetting = true; fsimToast('⟲ CAMERA RESET'); });

  // Refuel — shown only when parked on a fuelled strip (the frame loop toggles it). Fires the
  // same `refuel` verb the command line uses; the server tops the tank and pushes fuel back.
  add(q('#fsim-refuel'), 'click', (e) => { e.stopPropagation(); sendCmdSilent('refuel'); fsimToast('REFUELLING…'); });

  // Radio target-cycle buttons — the panel twin of the [ / ] / \ keys.
  add(q('#fsim-tgt-prev'), 'click', () => cycleApTarget(-1));
  add(q('#fsim-tgt-next'), 'click', () => cycleApTarget(1));
  add(q('#fsim-tgt-clear'), 'click', () => clearApTarget());

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
// weather severity. The prevailing wind direction comes from the weather field (the same wind that
// drifts the clouds/rain/storm cells), falling back to a per-hour bearing when the field is absent.
const WX_SEV = { clear: 0, cloudy: 0.22, fog: 0.12, rain: 0.5, snow: 0.4, storm: 1.0 };
function weatherAtmos(F, now) {
  const wx = (F.sky?.weather || 'clear').toLowerCase();
  const sev = WX_SEV[wx] ?? 0.2;
  const t = now * 0.001;
  const gust = 1 + 0.45 * sev * Math.sin(t * 0.6) + 0.2 * sev * Math.sin(t * 1.7 + 1.1);   // slow swell over the steady wind
  const windKt = ((F.sky?.wind || 0) * 0.28 + sev * 13) * gust;   // reported windKph→kt + weather baseline
  // The prevailing wind that drifts the weather cells, so the arrow points where the clouds go.
  // Falls back to the old per-hour bearing only when the field isn't plumbed.
  const windDir = F.sky?.field?.wind?.dir ?? ((((F.sky?.hour || 12) * 17 + 40) % 360 + 360) % 360);
  return { sev, windKt, windDir, turb: sev };
}

// Off-map guard: if the tiles right under us are void (the endless-desert buffer beyond
// Landing report card — grades the touchdown by sink rate (fpm at contact) and flashes a big
// letter grade + the fpm + a wisecrack over the windshield for a couple of seconds. ~200 fpm is
// a good arrival; 800 fpm is the gear-breaking crash threshold; everything between is graded.
const LANDING_GRADES = [
  [60,  'A+', 'butter', '🧈 BUTTER. Absolutely greased it.'],
  [120, 'A',  'butter', 'Silky. The passengers applauded.'],
  [180, 'A-', 'good',   'Smooth. Barely a bump.'],
  [250, 'B+', 'good',   'Nice one — textbook touchdown.'],
  [330, 'B',  'good',   "Solid. The coffee didn't spill."],
  [420, 'B-', 'mid',    'Firm, but perfectly fine.'],
  [510, 'C+', 'mid',    'Ooh — felt that one.'],
  [600, 'C',  'mid',    'That was an arrival, not a landing.'],
  [680, 'C-', 'bad',    'Ouch. Better check the struts.'],
  [750, 'D',  'bad',    'The tower is filing paperwork.'],
  [800, 'F-', 'bad',    'The landing gear is openly weeping.'],
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
  F.engineOn = false; F.nightLight = false; F.landingLight = false;   // engine cut on park → all lights out
  const eb = document.getElementById('fsim-eng'); if (eb) eb.classList.remove('on');
  try { spoolDown(F.cls); } catch {}
  // A deck-cam landing reports the ECHELON's own tile (captured when she grabbed us), not our smooth
  // position — which can round a tile off her hull and make the server treat it as an off-field
  // set-down (towing the craft back to the origin airfield). Reporting her tile lands us squarely on
  // her helipad so she parks on the pad and disembarks us onto her deck.
  const px = F.deckLandTile ? F.deckLandTile[0] : F.pos.x, py = F.deckLandTile ? F.deckLandTile[1] : F.pos.y;
  sendCmdSilent(`flightsync ${px.toFixed(2)} ${py.toFixed(2)} 0 0 ${Math.round(s.heading)} 0 0 1 0`);
  // Carry the landing tile IN the land event too: the server processes this and the flightsync above
  // concurrently (the ws message handler doesn't serialize a player's commands), so `land` must not
  // depend on flightsync having landed first — otherwise it reads the stale airborne position, resolves
  // off the Echelon, and tows the heli away instead of parking it in her hangar (the intermittent miss).
  sendCmdSilent(`flightevent land ${F.landGrade || 'F-'} ${Math.round(F.landFpm || 0)} ${px.toFixed(2)} ${py.toFixed(2)}`);
  // A deck-cam (yacht) landing is flagged by deckLandTile — more reliable than F.onYacht, which the
  // server may have cleared by the time the cinematic ends. It opens the helipad bay and holds the
  // quiet, rotors-stopped frame a few beats before the hangar pops; a normal field landing hands off
  // promptly as before.
  const deckLanding = !!F.deckLandTile;
  const toHangar = !!F.onField || deckLanding;
  setTimeout(() => { closeFlightSim(); sendCmdSilent(toHangar ? 'hangar' : 'look'); }, deckLanding ? DECK_HANDOFF_MS : 600);
}

// ── Deck-cam auto-land cinematic ────────────────────────────────────────────────────────────
// When the Echelon captures a hovering heli, we take the windshield over with a spectator camera
// around her and fly the helicopter down onto the pad, the camera tracking it as it settles —
// then hand off to the normal park (finishLanding → hangar bay). Reuses the flight renderer
// wholesale (paintWindshield with external + hideOwnShip — the same trick the Helm chase view
// uses), drawing the descending heli as a world CONTACT whose altitude eases to zero.

// A small open-water window with the Echelon at its centre, built once per cinematic.
function deckLandingWindow(F) {
  if (F._deckMap) return F._deckMap;
  const RAD = 8, map = [];
  for (let y = -RAD; y <= RAD; y++) { const row = []; for (let x = -RAD; x <= RAD; x++) row.push({ kind: 'land', biome: 'water', road: 0 }); map.push(row); }
  map[RAD][RAD] = { kind: 'land', biome: 'water', road: 0, mark: 'yacht', heading: F.deckCine ? F.deckCine.hdg : 0, wake: { spd: 0 } };
  F._deckMap = map;
  return map;
}

// Cinematic timeline: a wide APPROACH shot as she comes in, dolly down to a CLOSE helipad shot for
// the descent, then a SETTLE hold on the pad where the engine spools down before we hand off to the
// park. The camera pose is value-continuous across the shots AND (via the ease-in-out `smooth` below)
// velocity-continuous, so the dolly glides smoothly between shots with no speed jump at the seams.
// The HOLD stays with her until the rotors fully stop (DECK_SPINDOWN) and then a further DECK_LINGER
// (2s) on the still, quiet heli before the hand-off.
// WIDE: a long, dramatic fly-in from out over the Basin, descending toward the pad. DROP: dolly down
// to a close-up on the deck IN FRONT of her, tracking the last ~50ft down. HOLD: same close-up while
// the rotors spin down and she goes quiet — a few beats before the hangar.
const DECK_WIDE = 4000, DECK_DROP = 3000;
const DECK_SPINDOWN = 1900;   // rotors wind from full-speed to a dead stop over this stretch of the HOLD
const DECK_LINGER = 2000;     // then we STAY with her, camera settled on the still heli, for 2 more seconds
const DECK_HOLD = DECK_SPINDOWN + DECK_LINGER;   // HOLD = spin-down + the 2s linger
const DECK_TOTAL = DECK_WIDE + DECK_DROP + DECK_HOLD;
const DECK_HANDOFF_MS = 600;   // the 2s live linger now carries the post-shutdown stillness, so hand off promptly after
// Overall size of the Echelon's 3D model — a uniform shrink of her whole yacht-local frame. KEEP IN
// SYNC with YACHT_SCALE in windshield.js: every yacht-local constant here (the pad at fore-aft 0.28,
// the deck floor z, the catch radius) is multiplied by it so the deck-landing capture + cinematic
// stay square on the (scaled) pad.
const YACHT_SCALE = 0.4;
const DECK_PAD_Z = 0.085 * 1.7 * YACHT_SCALE;   // world-z of the Echelon's FLUSH helipad floor (drawYacht pad pZ1 = DECKZ 0.085 × YACHT_H 1.7 × YACHT_SCALE) — the heli rests ON the deck; gear square on the pad
const DECK_DROP_FT = 75;    // the close "standing on deck" shot picks her up here and watches her drop in almost on top of you

// Auto-land catch zone: how close (tiles, from the pad centre) + how low (ft) you must be for her to
// grab you. Matches the drawn catch volume — radius a hair beyond its (now scaled) footprint so entering
// the ring captures, ceiling = the column top (PAD_CATCH_CEIL 0.5 × CONTACT_ALT_K⁻¹ 600 ≈ 300ft).
const YACHT_CATCH_RADIUS = 0.7 * YACHT_SCALE, YACHT_CATCH_CEIL_FT = 300;

// Real-time distance to the Echelon's helipad from our smooth position (not the laggy server flag):
// find her cell in the streamed window → her hull-centre world tile (+ any sub-tile glide) → rotate
// the local pad offset (oy +0.28) into the world → distance from us. Returns { dist (tiles), hdg }
// or null when she isn't in the window. The pad centre matches the drawn catch volume + the deck-cam.
function yachtProximity(F) {
  const map = F.map; if (!Array.isArray(map) || !map.length || !F.mapCenter || !F.pos) return null;
  const R = (map.length - 1) / 2;
  for (let ry = 0; ry < map.length; ry++) {
    const row = map[ry]; if (!row) continue;
    for (let rx = 0; rx < row.length; rx++) {
      const c = row[rx]; if (!c || c.mark !== 'yacht') continue;
      const sub = c.sub || { x: 0, y: 0 };
      const yx = F.mapCenter.x + (rx - R) + sub.x, yy = F.mapCenter.y + (ry - R) + sub.y;   // hull-centre world tile
      const hr = (c.heading || 0) * Math.PI / 180;
      const PAD_OY = 0.28 * YACHT_SCALE;   // aft helipad offset, shrunk with the hull
      const px = yx - PAD_OY * Math.sin(hr), py = yy + PAD_OY * Math.cos(hr);                 // aft helipad centre
      // tile = her COMMITTED grid tile (no sub-tile render lead), so surfaceAt resolves her zone.
      // hull = her hull-centre world tile, so the deck-cam can express our capture position in her
      // local frame and fly the cinematic in from where we ACTUALLY are.
      return { dist: Math.hypot(px - F.pos.x, py - F.pos.y), hdg: c.heading || 0, tile: [Math.round(F.mapCenter.x + (rx - R)), Math.round(F.mapCenter.y + (ry - R))], hull: [yx, yy] };
    }
  }
  return null;
}

function startDeckLanding(F, s, now, prox) {
  // Her real heading (frames the deck-cam the way the sim just did) + her hull tile (so we report the
  // landing AT the Echelon, not at our smooth position — which can round a tile off her and get the
  // craft towed off as an "off-field" landing). Both from the proximity probe that armed the capture.
  const hdg = prox?.hdg || 0;
  // Our ACTUAL position at the instant of capture, in her local frame (beam ox, fore-aft oy), so the
  // fly-in starts from where we really are instead of snapping out to a canned start pose. Inverse of
  // `loc` (rotate the world offset from her hull centre by −heading). Falls back to the canned start
  // if the hull probe is missing.
  const hr = hdg * Math.PI / 180, sh = Math.sin(hr), ch = Math.cos(hr);
  let start = null;
  if (prox?.hull && F.pos) {
    const wx = F.pos.x - prox.hull[0], wy = F.pos.y - prox.hull[1];
    start = [wx * ch + wy * sh, -wx * sh + wy * ch];
  }
  // Real helideck procedure: approach on the OPPOSITE heading to the ship, then pedal-turn to align with
  // her before touchdown. So the fly-in holds hdg+180 and swings round to her heading over the descent.
  const hdg0 = (hdg + 180) % 360;
  // Carry the REAL capture altitude into the start (only floored enough to leave room to descend), so the
  // fly-in begins at the heli's actual height — the 3D position she was really at, not a canned one.
  F.deckCine = { t0: now, hdg, hdg0, alt0: Math.max(DECK_DROP_FT + 20, s.altitude), start, done: false, seg: -1 };
  F.deckLandTile = prox?.tile || null;   // the Echelon's tile — finishLanding reports her here so she parks on the pad
  F._deckMap = null;
  F.landGrade = 'A'; F.landFpm = Math.round(Math.max(0, -(s.vs || 0)));   // a guided set-down grades clean
  if (F.toast) F.toast('The Echelon has you — coming in to land.');
}

// Shortest-path angular interpolation (deg) — so a yaw from, say, 350°→10° swings +20° across north,
// not −340° the long way round.
function lerpAngle(a, b, t) {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}
// ── Crash break-up death-cam ──────────────────────────────────────────────────
// A severe write-off snaps to the external chase view and tumbles the wreck while a wing
// (plus a tailplane and the fin) shear off; the fuselage falls, SLAMS into the ground at IMPACT_T
// where the shed parts scatter and settle INDEPENDENTLY, crumpling onto the deck, then the crash is
// reported to the server (which destroys the craft + kills every occupant + closes the sim). The
// report is deferred by BREAKUP_MS so the player always sees her come apart — the death is inevitable.
const BREAKUP_MS = 3400;   // fall → impact → settle-and-burn beat before the crash is reported
const IMPACT_T = 0.42;     // fraction of the timeline where the wreck reaches the ground

// Plain-English surface names for the "she's coming apart" battle-damage toast.
const SHEAR_TOAST = { leftWing: 'LEFT WING', rightWing: 'RIGHT WING', tail: 'TAILPLANE', rudder: 'RUDDER' };

function beginCrashBreakup(F, reason) {
  if (F.crashCine) return;                               // already coming apart
  F.rolling = false; F.reportedAirborne = false;
  if (F.setExternalView) F.setExternalView(true);        // force the death cam
  const h0 = Math.min(1, Math.sqrt(Math.max(0, F.s?.altitude || 0) / 3000));
  F.crashCine = { t0: performance.now(), reason, reported: false,
    bank0: F.s?.bank || 0, pitch0: F.s?.pitch || 0, hdg: F.s?.heading || 0, h0 };
}

function stepCrashBreakup(F, now) {
  const C = F.crashCine, root = document.getElementById('fsim-root');
  const t = clampNum((now - C.t0) / BREAKUP_MS, 0, 1);
  // FALL: 0 at break-up → 1 at ground impact (IMPACT_T). She accelerates down under "gravity".
  const fall = clampNum(t / IMPACT_T, 0, 1);
  const eFall = fall * fall;
  // POST: 0 at impact → 1 at the report. Drives the settle: a small dead-cat bounce, and the
  // fuselage easing from its tumbling attitude into a fixed crashed pose (rolled onto a wing,
  // nose buried) — it STOPS cartwheeling once it's on the deck.
  const post = clampNum((t - IMPACT_T) / (1 - IMPACT_T), 0, 1);
  const bounce = post > 0 ? Math.sin(post * Math.PI) * 0.05 * (1 - post) : 0;
  const height = C.h0 * (1 - eFall) + C.h0 * bounce;      // the ground rises to meet her, then a settle hop
  // FUSELAGE: it tumbles as it drops, then the tumble DAMPS OUT and it settles roughly flat on its
  // belly (a slight cant) — it STOPS moving once it's down, so the frame the pieces sit in is
  // ground-aligned rather than rolled onto a wing (which used to drag every shed part into the cant).
  const settle = 1 - Math.pow(1 - post, 3);              // 0 at impact → 1 fully at rest
  const tumbleB = C.bank0 + 96 * fall, tumbleP = C.pitch0 - 42 * fall;
  const bank = tumbleB * (1 - settle) + 16 * settle;     // settles slightly canted onto one side
  const pitch = tumbleP * (1 - settle) + -6 * settle;    // nose just into the ground
  // Debris: each shed part flies on its OWN clock — it tears free, tumbles on all three axes about
  // its OWN centroid, scatters out across the deck, and comes to rest FLAT (roll+pitch damp to zero)
  // where it lands. Staggered `land` times keep the pieces off lockstep. The renderer draws these
  // decoupled from the fuselage's attitude (heading-only), so instead of one rigid shape spreading
  // you see the wing cartwheeling one way, the tail spinning another, each crumpling onto the ground.
  const debris = ({ roles, side, fRange, cen, dir, spin, mag, land }) => {
    const air = clampNum(t / land, 0, 1);                       // 0 → 1 at this piece's ground contact
    const rest = clampNum((t - land) / (1 - land), 0, 1);       // 0 → 1 after it lands
    const ao = 1 - Math.pow(1 - air, 2);                        // ease-out flight → freezes at landing
    const flat = 1 - rest;                                      // 1 airborne → 0 once settled on the deck
    const hop = rest > 0 ? Math.sin(rest * Math.PI) * 0.08 * (1 - rest) : 0;   // a shallow bounce that dies out
    return {
      roles, side, fRange, ballistic: true, cen, hop,
      scatter: [dir[0] * mag * ao, dir[1] * mag * ao],          // fan out in the ground plane, ease to rest
      rot: [spin[0] * ao * flat, spin[1] * ao * flat, spin[2] * ao],   // roll+pitch go flat; yaw is kept (any heading down)
    };
  };
  const parts = [
    debris({ roles: ['wing', 'aileron', 'flap'], side: 1,    cen: [-0.1,  0.8, -0.02], dir: [-0.4,  1.3], spin: [ 6.5,  1.4,  1.6], mag: 1.0, land: 0.42 }),   // right wing cartwheels off to starboard
    debris({ roles: ['stab', 'elevator'],        side: -1,   cen: [-1.4, -0.4, -0.02], dir: [-1.1, -0.8], spin: [ 4.6, -2.2,  2.6], mag: 1.0, land: 0.48 }),   // left tailplane spins off to port
    debris({ roles: ['fin', 'rudder'],           side: null, cen: [-1.5,  0.0,  0.30], dir: [-1.2,  0.3], spin: [ 2.0,  3.8,  1.4], mag: 0.9, land: 0.46 }),   // fin snapped off aft
    debris({ roles: ['body'], fRange: [ 0.30,  9], side: null, cen: [ 1.0,  0.0,  0.00], dir: [ 1.4,  0.2], spin: [ 3.2,  2.6,  1.0], mag: 1.1, land: 0.52 }),   // nose cone forward
    debris({ roles: ['body'], fRange: [-9, -0.35], side: null, cen: [-1.3,  0.0,  0.05], dir: [-1.3, -0.3], spin: [ 3.8, -1.8,  2.2], mag: 1.1, land: 0.50 }),   // tail cone aft
  ];
  const wreckFx = null;                                   // no fire/smoke — she just comes apart and crumples
  paintWindshield('fsim-ws', {
    external: true, hideOwnShip: false, phase: 'cruise', worldBlend: 1,
    cls: F.cls, heading: C.hdg, bank, pitch, livery: F.livery, gearAnim: F.gearAnim ?? 1,
    enginePct: 0, engineOn: false, breakup: { t, parts }, wreckFx,
    extYaw: (F.extOrbit || 0) + 26 * t, extPitch: F.extPitch ?? REST_PITCH, extZoom: F.extZoom || 1,
    height, speed: 0, hour: F.sky?.hour, weather: F.sky?.weather, wxField: F.sky?.field,
    map: F.map, mapCenter: F.mapCenter, mapOffset: { x: F.pos.x - F.mapCenter.x, y: F.pos.y - F.mapCenter.y },
    acX: F.pos.x, acY: F.pos.y, biomeBelow: F.biomeBelow || 'default', airport: F.airport || 'default', helipad: !!F.helipad,
  });
  if (t >= 1 && !C.reported) {
    C.reported = true;
    if (root) showLandingCard(root, 900, true);            // the F / CRASHED climax card
    sendCmdSilent(`flightevent crash ${C.reason}`);        // server destroys the craft + closes the sim
  }
}

function stepDeckLanding(F, now) {
  const C = F.deckCine; if (!C) return;
  const el = now - C.t0;
  const ease = (t) => 1 - Math.pow(1 - t, 2.2);
  // Ease-IN-OUT for the CAMERA dolly: velocity is zero at BOTH ends of every shot, so where one shot's
  // camera move hands to the next the pan has no velocity jump — the dolly glides smoothly between shots
  // instead of snapping speed at each seam (the heli's own motion keeps the ease-out `ease` above).
  const smooth = (t) => { const c = clampNum(t, 0, 1); return c * c * (3 - 2 * c); };
  const hr = C.hdg * Math.PI / 180, sinh = Math.sin(hr), cosh = Math.cos(hr);
  // yacht-local (beam ox +stbd, fore-aft oy +aft) → world offset from the hull, the same transform
  // drawYacht uses — so a local point tracks the deck whatever way she's pointing.
  const loc = (ox, oy) => [-oy * sinh + ox * cosh, oy * cosh + ox * sinh];
  // Work in her LOCAL frame (beam ox, fore-aft oy) and convert to world with `loc` exactly ONCE
  // (at the projection below) — the pad/start were being loc()'d twice, which slid the touchdown off
  // the pad ("left of the pad") whenever her heading wasn't due north.
  const PAD = [0, 0.28 * YACHT_SCALE];   // helipad centre (local), on the scaled hull
  // Fly in from where the pilot ACTUALLY was at capture (interpolated in), so the cinematic is
  // continuous with the approach — no teleport. Fall back to the canned starboard-quarter pose (also
  // scaled with the hull, so a smaller Echelon frames the fly-in proportionally).
  const START = C.start || [1.0 * YACHT_SCALE, 1.7 * YACHT_SCALE];   // fly-in start (local): captured real position, or the canned pose
  const padWorld = loc(PAD[0], PAD[1]);  // pad centre as a WORLD offset from the hull — the close-up centres here
  // `lookAt` is the ground point the camera centres on (mapOffset). WIDE frames the whole ship as she
  // flies in; the close-up re-aims onto the PAD and sits IN FRONT of her (extYaw ~180 = dead ahead of
  // the nose, looking back at her face) low on the deck, tracking the last 50ft + the shutdown.
  let phase, ox, oy, alt, power = 0.8, propSpin = 1, landing = false, cam, lookAt = [0, 0], dome = false;
  if (el < DECK_WIDE) {
    // SHOT 1 — the fly-in, from an ON-DECK camera standing FORWARD of the pad (at the base of the
    // deckhouse) looking AFT over the pad, so the deckhouse is BEHIND the camera and out of frame and
    // she flies in over the open water toward you. Not a view of the whole boat — you're on her deck.
    phase = 'wide'; const lp = ease(el / DECK_WIDE), clp = smooth(el / DECK_WIDE);
    ox = START[0] + (PAD[0] - START[0]) * lp; oy = START[1] + (PAD[1] - START[1]) * lp;   // fly IN
    alt = C.alt0 + (DECK_DROP_FT - C.alt0) * lp;
    landing = lp > 0.75; dome = true;
    cam = { yaw: 180, pitch: 0.14, zoom: 0.85 - clp * 0.40 };   // looking AFT down the deck over the pad — reads her 3D fly-in, dollying toward the DROP
    lookAt = padWorld;
  } else if (el < DECK_WIDE + DECK_DROP) {
    // SHOT 2 — the same ON-DECK vantage (standing at the deckhouse, looking AFT over the pad), holding
    // low as she drops the last 75ft straight down in front of you onto the pad, open sea behind her.
    // No crane, no orbit — you stay planted on the deck and she comes down to you.
    phase = 'drop'; const lp = ease((el - DECK_WIDE) / DECK_DROP), clp = smooth((el - DECK_WIDE) / DECK_DROP);
    ox = PAD[0]; oy = PAD[1]; alt = DECK_DROP_FT * (1 - lp); landing = true;
    cam = { yaw: 180, pitch: 0.14 - clp * 0.02, zoom: 0.45 - clp * 0.15 };   // hold the deck-level aft-looking view, dollying RIGHT onto the pad (down to 0.30) as she settles in
    lookAt = padWorld;
  } else {
    // SHOT 3 — she's down; the camera arcs round from dead-ahead to a three-quarter broadside and
    // GROWS her into a big on-pad "inspect" close-up (like the hangar walkaround — right on top of
    // the helipad so she fills the frame) while the rotors spin down, before the hand-off to the hangar.
    phase = 'hold'; const hEl = el - DECK_WIDE - DECK_DROP;
    ox = PAD[0]; oy = PAD[1]; alt = 0; landing = true;
    const spin = Math.min(1, hEl / DECK_SPINDOWN);   // 0 = full-speed → 1 = dead stop at DECK_SPINDOWN, then we linger
    power = 0.5 * (1 - spin); propSpin = 1 - spin;   // rotors fully stopped when the spin-down completes
    const ip = smooth(hEl / DECK_SPINDOWN);   // settle the tight framing AS the rotors wind down, then hold it through the 2s linger
    // Dolly the CAMERA in (zoom 0.30→0.16) and swing to a three-quarter broadside — the heli AND the
    // pad scale together, a true zoom to a tight on-pad crop (NOT an enlarged model). Her real size
    // never changes; the camera just gets right on top of her. Pitch eases hard DOWN (→ -0.42) so the
    // eye-height drops to the heli's OWN mid-height — a level, close, water-skimming side shot (this is
    // a Mode-7 cam: no tilt, so dropping EH to her height IS looking level across at her, not down).
    cam = { yaw: lerpAngle(180, 110, ip), pitch: 0.12 - 0.54 * ip, zoom: 0.30 - 0.14 * ip };
    lookAt = padWorld;
    if (C.seg !== 2) { C.seg = 2; if (F.toast) F.toast('Skids down — winding down.'); }
  }
  const [hx, hy] = loc(ox, oy);
  // Yaw from our captured heading round to HERS over the approach + drop, so she lines up with the
  // deck as PART of the fly-in (no snap) and is square by the time she settles. No time pressure —
  // the ~7s of WIDE+DROP carries the whole turn.
  // Hold the OPPOSITE approach heading through the WIDE fly-in, then swing round to HER heading over the
  // DROP so she's square with the deck by touchdown — "turn to it before landing".
  const rot = ease(clampNum((el - DECK_WIDE) / DECK_DROP, 0, 1));
  const heliHdg = lerpAngle(C.hdg0 ?? C.hdg, C.hdg, rot);
  // Attitude: nose gently down on the way in, a nose-UP FLARE as she nears the deck (she rears back
  // to arrest the sink), then eases level as she settles onto the pad and winds down.
  let heliPitch;
  if (phase === 'wide') heliPitch = -2 * clampNum(alt / 30, 0, 1);
  else if (phase === 'drop') heliPitch = -2 + 8 * ease(clampNum((DECK_DROP_FT - alt) / DECK_DROP_FT, 0, 1));
  else heliPitch = 6 * (1 - ease(clampNum((el - DECK_WIDE - DECK_DROP) / (DECK_SPINDOWN * 0.6), 0, 1)));
  const heli = {
    id: 'deck-heli', dx: hx - lookAt[0], dy: hy - lookAt[1],
    // groundZ pins her gear to the physical helipad deck (its world-z in drawYacht), so `altDiff` is
    // her height in FEET ABOVE the pad — skids square on the deck at 0, not floating at eye height.
    groundZ: DECK_PAD_Z, altDiff: alt,
    cls: F.cls, hdg: heliHdg, bank: 0, pitch: heliPitch,
    livery: F.livery, sizeMul: 1.9, power, propSpin, propDisc: propSpin > 0.15 ? 1 : 0,
    lights: true, landing,
  };
  paintWindshield('fsim-ws', {
    external: true, hideOwnShip: true, phase: 'cruise', worldBlend: 1,
    heading: C.hdg, extYaw: cam.yaw, extPitch: cam.pitch, extZoom: cam.zoom,
    height: 0, speed: 0, hour: F.sky?.hour, weather: F.sky?.weather, wxField: F.sky?.field,
    map: deckLandingWindow(F), mapCenter: { x: 0, y: 0 }, mapOffset: { x: lookAt[0], y: lookAt[1] },
    acX: 0, acY: 0, biomeBelow: 'water', airport: 'default',
    contacts: [heli], padDome: dome ? { armed: true } : null,   // bubble shown during the wide approach, gone once on deck
  });
  if (el >= DECK_TOTAL && !C.done) { C.done = true; F.deckCine = null; F._deckMap = null; finishLanding(F, F.s); }
}

function fsimFrame(now) {
  const F = _fsim; if (!F) return;
  const root = document.getElementById('fsim-root');
  if (!root) { closeFlightSim(); return; }
  // Frame delta — drives per-frame input sampling + display smoothing below. The flight
  // model itself integrates in fixed sub-steps (see the accumulator further down), so a
  // slightly bigger cap here is safe: it just widens how much sim time one frame may catch up.
  const dt = clampNum((now - F.last) / 1000, 0, 0.25); F.last = now;
  const { s, P, input } = F;

  // Auto-land cinematic: once the Echelon has captured a hovering heli, we hand the whole view over
  // to a deck-cam that flies her down onto the pad (physics + controls are frozen). Runs its own
  // render + schedules the next frame, then bails out of the live sim step.
  if (F.deckCine) { stepDeckLanding(F, now); F.raf = requestAnimationFrame(fsimFrame); return; }
  // Crash death-cam: physics is frozen; the cinematic drives its own external render + reports the
  // crash at the end (which closes the sim). Holds the last frame until the server tears us down.
  if (F.crashCine) { stepCrashBreakup(F, now); F.raf = requestAnimationFrame(fsimFrame); return; }
  // After the cinematic ends (F.landed) we must NOT resume the live sim for the hand-off beat — that
  // would repaint the real (still-airborne) craft for a frame and flash "the heli flying after it
  // landed". Hold the last deck-cam frame (she's on the pad, rotors stopped) until closeFlightSim.
  if (F.landed) { F.raf = requestAnimationFrame(fsimFrame); return; }

  // Yoke springs to centre when released.
  if (!F.yokeDrag) { input.elevator = lerpN(input.elevator, 0, Math.min(1, dt * 6)); input.aileron = lerpN(input.aileron, 0, Math.min(1, dt * 6)); }
  // External-view orbit LOCKS wherever you left it (no spring-back). The ⟲ reset SWINGS it home:
  // ease the yaw/elevation/zoom back to the resting behind-and-above pose, then settle exactly.
  if (F.orbitResetting) {
    const k = Math.min(1, dt * 6);
    F.extOrbit = lerpN(F.extOrbit || 0, 0, k);
    F.extPitch = lerpN(F.extPitch ?? REST_PITCH, REST_PITCH, k);
    F.extZoom = lerpN(F.extZoom || 1, 1, k);
    if (Math.abs(F.extOrbit) < 0.3 && Math.abs((F.extPitch ?? REST_PITCH) - REST_PITCH) < 0.005 && Math.abs((F.extZoom || 1) - 1) < 0.01) {
      F.extOrbit = 0; F.extPitch = REST_PITCH; F.extZoom = 1; F.orbitResetting = false;
    }
  }
  // Keyboard throttle (A/Z held) ramps the lever ~2s full-sweep.
  if (F.throttleKey) input.throttle = clampNum(input.throttle + F.throttleKey * dt * 0.5, 0, 1);
  // Pedals held (,/. or X/C): ramp toward the held side, spring to centre on release. The heli
  // tail rotor yaws the nose in the flight model; on a fixed-wing the model ignores pedal, so this
  // only swings the rudder surface on the external view. Same ramp either way.
  input.pedal = F.pedalKey ? clampNum(input.pedal + F.pedalKey * dt * 2.2, -1, 1) : lerpN(input.pedal, 0, Math.min(1, dt * 12));
  // Belly-down: gear stowed with weight on the wheels. She's grinding on her keel — no wheels to
  // roll on, so no thrust reaches the ground and she can't move or take off until the gear's back
  // down (or you ABORT for a tow). This is the punishment for raising the gear parked/rolling.
  const bellyDown = s.onGround && F.gearRetract && F.gearUp;
  // Visor lock: the Leviathan can't ROLL until its cargo nose is closed and locked forward. The
  // engines still light, spool and rev while it's open (the lock only severs the thrust force via
  // `noThrust` below) — you start up, run the ~5s close, and only then can you taxi. (No visor →
  // always "locked".)
  const visorLocked = !F.hasVisor || (F.noseVisor ?? 0) <= 0.02;
  // Effective throttle: the lever always moves, but there's no thrust unless the
  // engine master switch is on and the tank isn't dry (dead stick) — and never on the belly.
  const thr = (F.engineOn && !F.deadStick && !bellyDown) ? input.throttle : 0;

  // Sample the atmosphere from the live weather → wind vector + turbulence intensity.
  // (Sampled once per rendered frame and held across the fixed sub-steps below.)
  const atmos = F.atmos = weatherAtmos(F, now);

  // ── Fixed-timestep physics ────────────────────────────────────────────────────
  // The flight model + turbulence + world translation advance in fixed 1/60 s slices, so
  // handling is identical at 30/60/144 fps and the sim stays deterministic (which helps
  // server reconciliation). Input + weather are sampled once per frame (above); collision,
  // phase transitions and rendering happen once per frame (below, on the settled state).
  // Leftover time carries in F.acc, capped at 0.5 s and 8 steps so a long tab-stall drains
  // instead of spiralling.
  const FIXED = 1 / 60;
  F.acc = Math.min((F.acc || 0) + dt, 0.5);
  let nSteps = 0;
  while (F.acc >= FIXED && nSteps < 8) {
    const h = FIXED;
    // gear: extended fraction of RETRACTABLE gear (1 = down/locked, 0 = up) — feeds the model's
    // gear-drag term so leaving the wheels down bleeds speed. Fixed-gear craft report 0 (their
    // gear drag is already baked into dragP), so they take no extra penalty.
    // collRaw + power let the heli model autorotate: the collective lever keeps working with the
    // engine dead (power=false), so a rotor-out descent is flyable to a flared touchdown. Fixed-wing
    // ignores both. power gates on engine master / dead-stick / belly (same conditions that gate thr).
    step(s, { elevator: input.elevator, aileron: input.aileron, throttle: thr, collRaw: input.throttle, power: (F.engineOn && !F.deadStick && !bellyDown), noThrust: !visorLocked, flaps: input.flaps, pedal: input.pedal, trim: input.trim, gear: F.gearRetract ? (F.gearAnim ?? 1) : 0, dmgSurf: F.surfaces || null }, P, h);

    // Turbulence: the air disturbs the AIRCRAFT (you correct it), it never cheats the physics.
    // Deterministic summed-sine "noise" (no RNG) rolls/pitches you and bumps lift, ∝ severity.
    if (atmos.turb > 0.01 && !s.onGround) {
      const t = now * 0.001, g = atmos.turb;
      const nRoll = Math.sin(t * 3.1) + 0.6 * Math.sin(t * 7.7 + 2) + 0.8 * Math.sin(t * 1.3);
      const nPitch = Math.sin(t * 2.3 + 1.5) + 0.6 * Math.sin(t * 5.1 + 0.7);
      s.bank = clampNum(s.bank + nRoll * g * 5.5 * h, -70, 70);
      s.pitch = clampNum(s.pitch + nPitch * g * 3.5 * h, -35, 35);
      s.vs += nRoll * g * 130 * h;                              // gusty lift / ballooning
    }

    // Move through the world whenever rolling or flying — the takeoff roll translates
    // you forward down the runway (buildings grow and pass); liftoff just adds altitude.
    // Guard on |airspeed| so a heli backing up (aft cyclic → negative airspeed) actually
    // slides rearward: the velocity below already carries the sign, so this gate just has
    // to admit it. Without the abs a nose-up hover pitches back but never moves.
    if (Math.abs(s.airspeed) > 0.5) {
      // Ground pace is quick so you actually roll down the runway, then decays FAST with altitude
      // (exp, groundDecay-ft e-fold) to the slow cruise pace (worldPace) so the sky doesn't rush past.
      const pace = RENDER_TUNE.worldPace * (P.worldPaceMult || 1) * (1 + (RENDER_TUNE.groundBoost - 1) * Math.exp(-Math.max(0, s.altitude) / (RENDER_TUNE.groundDecay || 25)));
      const d = Math.abs(s.airspeed) * pace * h, hr = s.heading * Math.PI / 180;   // odometer distance is magnitude — backing up shouldn't wind travel/rollDist backwards
      // Ground track = air velocity + wind (airborne only — on the wheels the gear holds you to
      // the ground). A crosswind drifts you off the runway centreline; a head/tailwind slows/speeds
      // your progress over the ground while airspeed (through the air) is unchanged.
      let vx = Math.sin(hr) * s.airspeed, vy = -Math.cos(hr) * s.airspeed;
      if (!s.onGround && atmos.windKt > 0.2) { const wr = atmos.windDir * Math.PI / 180; vx += Math.sin(wr) * atmos.windKt; vy += -Math.cos(wr) * atmos.windKt; }
      F.pos.x += vx * pace * h; F.pos.y += vy * pace * h;
      F.travel += d;
      if (F.engineOn) F.rollDist += d;
    }
    F.acc -= FIXED; nSteps++;
  }

  // Gear position eases toward its target (0 = up/stowed, 1 = down/locked) over ~1.6s so the
  // external view shows it swinging out and tucking away, not snapping.
  if (F.gearRetract) { const tgt = F.gearUp ? 0 : 1; F.gearAnim = lerpN(F.gearAnim ?? 1, tgt, Math.min(1, dt / 1.6)); }
  else F.gearAnim = 1;

  // Leviathan cargo visor nose: parked with the engine shut down the whole forward section hinges
  // fully UP (~90°), exposing the hold + ramp; powering on lowers it home. LINEAR travel over a
  // full 5s (a big hydraulic visor is slow, and it must read as a deliberate ~5s close after you
  // hit power), so both the external model and the cockpit camera swing at a steady rate, not an
  // ease-out that finishes early. Only the heavy (Leviathan) mesh has a visor.
  if (F.hasVisor === undefined) F.hasVisor = !!visorSpecFor(F.cls);
  if (F.hasVisor) {
    const tgt = (!F.engineOn && s.onGround && s.airspeed < 5) ? 1 : 0;
    if (F.noseVisor === undefined) F.noseVisor = tgt;   // already raised if you board her cold — no start-up sweep
    const stepV = dt / 5;                               // 0→1 (or 1→0) in five seconds flat
    F.noseVisor = F.noseVisor < tgt ? Math.min(tgt, F.noseVisor + stepV) : Math.max(tgt, F.noseVisor - stepV);
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
      beginCrashBreakup(F, 'cfit');   // death cam: she comes apart before the crash is reported
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
    // The Echelon sits on a water tile (her district is water), so a set-down on OR alongside her
    // reads as "over water" — but that's the helipad, not a ditching. F.onYacht suppresses the
    // ditch so the touchdown rolls through to the auto-land path below (server snaps it to the pad).
    const overWater = F.biomeBelow === 'water' && !F.onYacht;
    sendCmdSilent(`flightsync ${F.pos.x.toFixed(2)} ${F.pos.y.toFixed(2)} 0 ${Math.round(s.airspeed)} ${Math.round(s.heading)} ${Math.round(thr * 100)} 0 1 0`);
    if (overWater && establishedClimb) {
      // Touched down on open water — nothing in the fleet floats, so it's an instant ditching,
      // not a landing. (Only once she's actually flown, so a bounce over a bay tile on the
      // takeoff roll doesn't count.) The server sinks the craft + closes the sim.
      F.rolling = false;
      groundFx('touchdownHard'); csfx('flight-crash', 'hololock-lose');
      F.shake = 16;
      beginCrashBreakup(F, 'ditched');   // death cam shows her break up, then reports + shows the card
      if (F.toast) F.toast('CRASH — you ditched in the water');
    } else if (sinkFpm > 800 && establishedClimb) {
      // Slammed it in — a touchdown sinking faster than 800 fpm breaks the gear/airframe. (Raised
      // from 600 to make landings more forgiving: a firm arrival now rolls out instead of writing her off.)
      // Report a crash: the server destroys the craft and closes the sim (cockpit_close).
      F.rolling = false;
      groundFx('touchdownHard'); csfx('flight-crash', 'hololock-lose');
      F.shake = 18;   // slammed it in — a big jolt
      beginCrashBreakup(F, 'hardlanding');   // death cam shows her break up, then reports + shows the card
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
      // GRADE + flash the report card ONLY for a real arrival. A low hop during the takeoff
      // roll (never climbed clear) is a rejected-takeoff bounce, not a landing — no grade card,
      // and landGrade stays null so a shutdown here reports no landing.
      if (establishedClimb) {
        F.landGrade = landingGrade(sinkFpm).grade; F.landFpm = Math.round(sinkFpm);   // reported to the server for landing IP
        showLandingCard(root, sinkFpm);   // graded report card flashes over the glass
        if (F.toast) F.toast(F.heli ? 'DOWN — lift off again, or type disembark to climb out' : 'ROLL OUT — brake to a stop, then cut the ENGINE to park');
      } else { F.landGrade = null; F.landFpm = 0; }
    }
  }
  // Rolled to a stop on the ground → prompt the shutdown that taxis you into the hangar.
  if (F.rolling && s.onGround && s.airspeed < 5) {
    // A FIXED-WING that's rolled to a stop AT an airfield shuts down and taxis into the hangar
    // automatically (no manual engine-cut). A HELICOPTER never auto-parks/leaves the sim on
    // landing — it stays put so the pilot can lift off again or look around, and leaves only by
    // typing `disembark`. Off-field (a VTOL flared onto open ground) we just prompt the shutdown.
    // The one exception is the Echelon: a Dragonfly setting down alongside her auto-lands on the
    // helipad (F.onYacht), so you don't hunt for her exact tile or have to type disembark.
    if ((F.onField && !F.heli) || (F.heli && F.onYacht)) finishLanding(F, s);
    else if (!F.stopHinted) { F.stopHinted = true; if (F.toast) F.toast(F.heli ? 'DOWN — type disembark to climb out' : 'STOPPED — cut the ENGINE to shut down & park'); }
  }

  // Client-side proximity to the pad (real-time, from our smooth position + the streamed window),
  // so a fast fly-through registers the instant we're over the zone — unlike the server `onYacht`
  // flag, which arrives on the HUD cadence and lags a quick pass right out of the catch.
  const prox = yachtProximity(F);
  const nearPad = !!(prox && prox.dist <= YACHT_CATCH_RADIUS);

  // Departure latch: after setting down (or being parked) on the Echelon you must actually LEAVE
  // her before the auto-land can grab you again — otherwise lifting off her pad instantly re-
  // triggers the capture. You've "departed" once you climb just clear of the catch ceiling OR fly out
  // of the catch radius. Sitting on her deck disarms it; a fresh airborne approach is armed by default.
  const YACHT_REARM_FT = YACHT_CATCH_CEIL_FT + 50;   // just above the ~300ft catch ceiling (buffer avoids re-grab chatter at the lip)
  if (s.onGround && nearPad) F.yachtDeparted = false;              // on her deck → disarm re-grab
  else if (!nearPad || s.altitude > YACHT_REARM_FT) { F.yachtDeparted = true; F.autoLandNoticed = false; }   // flew clear / climbed just above the catch ceiling — re-arm

  // Early heads-up just above the drawn catch volume (its top is ~300ft), so the hand-off is never
  // a surprise.
  if (F.heli && nearPad && F.yachtDeparted && !s.onGround && !F.landed && !F.deckCine && F.reportedAirborne
      && s.altitude <= 440 && s.altitude > YACHT_CATCH_CEIL_FT && !F.autoLandNoticed) {
    F.autoLandNoticed = true;
    if (F.toast) F.toast('⚠ AUTO-LAND ARMING — drop into the green zone over the pad and she\'ll bring you down.');
  }
  // Capture the MOMENT you fly into the drawn catch volume — over the pad (nearPad) and below its
  // ~300ft ceiling. NO speed or vertical-rate gate: run straight through it and she takes you. The
  // only guard is the departure latch (so a takeoff off her own pad doesn't instantly re-grab you).
  if (F.heli && nearPad && F.yachtDeparted && !s.onGround && !F.landed && !F.deckCine && F.reportedAirborne
      && s.altitude <= YACHT_CATCH_CEIL_FT) {
    startDeckLanding(F, s, now, prox);
  }

  // Stall horn (intermittent → continuous).
  fsimHorn(F, dt);

  const r = readout(s, P), d = F.disp;
  d.ias = lerpN(d.ias, r.airspeed, Math.min(1, dt * 6)); d.alt = lerpN(d.alt, r.altitude, Math.min(1, dt * 5));
  // Feed the two big bottom-right gauges. They're shown in external view (the dashboard is
  // hidden there) and on mobile (the interior dashboard is pared down — these are the legible
  // speed/altitude readout). Hidden otherwise, so the writes are a harmless no-op on desktop.
  {
    const ig = document.getElementById('fsim-extg-ias'); if (ig) ig.textContent = Math.round(d.ias);
    const ag = document.getElementById('fsim-extg-alt'); if (ag) ag.textContent = Math.round(d.alt);
  }
  d.vs = lerpN(d.vs, r.vs, Math.min(1, dt * 4)); d.rpm = lerpN(d.rpm, r.rpm, Math.min(1, dt * 6));
  d.pitch = lerpN(d.pitch, r.pitch, Math.min(1, dt * 10)); d.bank = lerpN(d.bank, r.bank, Math.min(1, dt * 10));
  const dh = ((r.heading - d.hdg + 540) % 360) - 180; d.hdg = (d.hdg + dh * Math.min(1, dt * 6) + 360) % 360;

  // PFD (attitude + speed/altitude tapes + heading + VSI) and MFD (map).
  paintPFD(document.getElementById('fsim-pfd'), {
    pitch: d.pitch, bank: d.bank, ias: d.ias, alt: d.alt, vs: d.vs, hdg: d.hdg, slip: r.slip || 0,
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
    root.style.setProperty('--sheen', (day * wxMul * 0.42).toFixed(2));   // a restrained glint — the plate reads matte-stamped, not glossy
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
    lowNr: !!s.lowNr, vrs: !!s.vrs, autorot: !!s.autorot,   // heli: low-rotor-RPM + settling-with-power + autorotation annunciators
    // Extra panel furniture (annunciator strip · secondary bar gauges · reaper gun/stores):
    craft: F.craftType, engineOn: F.engineOn, airborne: F.reportedAirborne, prpm: F.rpms[0] || 0,
    gear: F.gearRetract ? (F.gearUp ? 'up' : 'down') : 'fixed',
    hardpoints: F.hardpoints, armed: F.armed, weapon: F.weapon, msl: F.msl,
    gunRounds: F.gunRounds, gunCap: F.gunCap,
    avionicsOut: !!F.avionicsOut,   // EMP — the whole panel is dark
  });

  // Full yoke: roll with aileron + a 3-D pull toward/away with elevator (capped so it
  // stays in frame). Green light glows near best-climb pull; red light glows on stall.
  const yk = document.getElementById('fsim-yoke-svg');
  if (yk) yk.style.transform = `translateX(${input.aileron * 7}px) translateY(${input.elevator * 18}px) rotateX(${-input.elevator * 34}deg) rotateZ(${input.aileron * 30}deg) scale(${1 + Math.max(0, input.elevator) * 0.2})`;
  // Rudder pedals tip forward with the live deflection (left plate on <0, right on >0) — the --d
  // var (0..1) feeds the plate's perspective tilt in CSS, so keyboard + touch read alike.
  const pd = input.pedal || 0;
  if (F.pedalLFace) F.pedalLFace.style.setProperty('--d', Math.max(0, -pd).toFixed(3));
  if (F.pedalRFace) F.pedalRFace.style.setProperty('--d', Math.max(0, pd).toFixed(3));
  if (F.pedalL) F.pedalL.classList.toggle('act', pd < -0.04);
  if (F.pedalR) F.pedalR.classList.toggle('act', pd > 0.04);
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

  // Disembark button — only offered while on the ground (you can't climb out mid-air).
  document.getElementById('fsim-disembarkbtn')?.classList.toggle('on', !!s.onGround);

  // Landing guide: show the glideslope gates once airborne, low, and within reach of the
  // departure runway (so it appears as you turn back to land). FIXED-WING ONLY — a helicopter/VTOL
  // descends vertically onto a helipad, so the Star Fox glideslope boxes make no sense for it; it's
  // guided by the auto-land catcher dome (padDome) instead.
  const rwDist = Math.hypot(F.rwOrigin.x - F.pos.x, F.rwOrigin.y - F.pos.y);
  const landGuide = (F.reportedAirborne && !F.heli && r.altitude < 1600 && rwDist < 16) ? { alt: r.altitude } : null;

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
      // A ground contact (taxiing / on its takeoff roll) pins its gear to the world ground plane
      // (groundZ 0 = the runway the viewer sees), so it rolls along the strip instead of floating at
      // our eye level. Airborne contacts stay camera-relative on their altitude delta as before.
      const brk = surfaceBreakup(c.surfaces);   // a battle-damaged bogey renders its sheared wing/tail GONE, not pristine
      const cv = c.onGround
        ? { id: c.id, dx, dy, groundZ: 0, altDiff: 0, rng, bore, reg: c.reg, hullPct: c.hullPct, cls: c.cls, armed: c.armed, hdg: c.hdg, bank: c.bank, pitch: c.pitch, livery: c.livery, firing: c.firing, breakup: brk }
        : { id: c.id, dx, dy, altDiff: (c.alt || 0) - s.altitude, rng, bore, reg: c.reg, hullPct: c.hullPct, cls: c.cls, armed: c.armed, hdg: c.hdg, bank: c.bank, pitch: c.pitch, livery: c.livery, firing: c.firing, breakup: brk };
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
  if (designated && F.hardpoints > 0 && F.armed && F.weapon !== 'msl') {
    const elev = Math.atan2((designated.altDiff || 0) * GUN_ALT_K, Math.max(0.1, designated.rng)) * 180 / Math.PI;
    const totalOff = Math.hypot(designated.bore, elev - (s.pitch || 0));
    const inRange = designated.rng <= GUN_RANGE;
    const aimQ = inRange ? Math.max(0, 1 - totalOff / GUN_CONE) : 0;
    F.gunSolution = { id: designated.id, aimQuality: aimQ, ready: inRange && aimQ > 0.02 };
  }
  const solReady = !!(F.gunSolution && F.gunSolution.ready);

  // Missile seeker (Phase C): with MSL selected, holding the designated bogey inside the
  // seeker envelope builds a lock over MSL_LOCK_MS; full bar → ask the server (`airlock`),
  // which owns the lock and warns the target's RWR. Wander out and the lock decays off.
  F.swarmReady = null;
  if (F.salvo > 1 && F.weapon === 'msl' && F.armed && F.hardpoints > 0 && F.reportedAirborne) {
    // Swarm airframe (Viper): NO lock cycle — point the nose at a bogey inside the forward
    // envelope and a ripple shot is live immediately. No seeker tone, no RWR lock warning.
    if (designated && designated.rng <= MSL_RANGE && designated.bore <= SWARM_CONE) F.swarmReady = designated.id;
  } else if (F.weapon === 'msl' && F.armed && F.hardpoints > 0 && designated && F.reportedAirborne) {
    if (F.seekId !== designated.id) { F.seekId = designated.id; F.lockProg = 0; }   // new bogey → start over
    const inEnv = designated.rng <= MSL_RANGE && designated.bore <= MSL_CONE;
    if (inEnv) {
      F.lockProg = Math.min(1, F.lockProg + dt * 1000 / MSL_LOCK_MS);
      if (F.lockProg >= 1 && F.lockId !== designated.id) {
        F.lockId = designated.id;
        sendCmdSilent(`airlock ${designated.id}`);
        try { lockTone(); } catch {}
        if (F.toast) F.toast('◉ LOCK — FIRE WHEN READY');
      }
    } else {
      F.lockProg = Math.max(0, F.lockProg - dt * 1.5);
      if (F.lockId && F.lockProg <= 0) { sendCmdSilent('airunlock'); F.lockId = null; if (F.toast) F.toast('LOCK LOST'); }
    }
  } else if (F.lockId || F.lockProg > 0 || F.seekId) {
    if (F.lockId) sendCmdSilent('airunlock');   // weapon deselected / target gone → drop it server-side too
    F.lockId = null; F.lockProg = 0; F.seekId = null;
  }

  // Trigger held → guns squirt bursts at the client cadence (the server enforces its own
  // harder cap + validates the shot); missiles are a single launch per squeeze off a full
  // lock. With no air solution, an armed craft still falls back to the ground-AA strafe pass.
  if (F.firing && F.armed && F.reportedAirborne) {
    if (F.weapon === 'msl' && F.salvo > 1) {
      // Swarm: one ripple per squeeze, no lock required. A bogey under the nose takes it;
      // with nothing in the air the salvo goes to the GROUND — the attack heli's real job
      // (a standoff strike on what's ahead, rather than the gun pass's overfly).
      if (!F.fireHeld && F.msl > 0 && (!F.lastMslMs || now - F.lastMslMs >= SWARM_FIRE_MS)) {
        F.lastMslMs = now;
        const n = Math.min(F.salvo, F.msl);       // the rails can't ripple more than they're holding
        F.msl = Math.max(0, F.msl - F.salvo);     // optimistic; flight_ctx refreshes the authoritative count
        sendCmdSilent(F.swarmReady ? `airfire swarm ${F.swarmReady}` : 'airfire swarm ground');
        F.muzzleT = now;
        // Fly the ripple you just fired: at the bogey if there's one under the nose, otherwise
        // at the ground point the boresight is pointed at (the standoff strike).
        launchShots(F, now, n, F.swarmReady ? { id: F.swarmReady } : groundAim(F, s), 1);
        try { missileRippleFx(n, F.external); } catch {}
        if (F.paintPips) F.paintPips();
      }
    } else if (F.weapon === 'msl') {
      if (!F.fireHeld && F.lockId && F.msl > 0 && (!F.lastMslMs || now - F.lastMslMs >= MSL_FIRE_MS)) {
        F.lastMslMs = now;
        F.msl = Math.max(0, F.msl - 1);   // optimistic; flight_ctx refreshes the authoritative count
        sendCmdSilent(`airfire missile ${F.lockId}`);
        F.muzzleT = now;
        launchShots(F, now, 1, { id: F.lockId }, 0.15);   // a locked shot flies straight — it knows where it's going
        try { missileFx(); } catch {}
        if (F.paintPips) F.paintPips();
      }
    } else if (!F.lastFireMs || now - F.lastFireMs >= F.gunMs) {
      F.lastFireMs = now;
      F.muzzleT = now;                                  // flash + tracers show whenever the trigger's down, solution or not
      // FX every squirt for feel, but only fire the actual command at the server's burst
      // cadence — anything faster is a server-side no-op that still burns rate-limit budget.
      const cmdGap = solReady ? GUN_CMD_AIR_MS : GUN_CMD_GROUND_MS;
      if (!F.lastGunCmdMs || now - F.lastGunCmdMs >= cmdGap) {
        F.lastGunCmdMs = now;
        if (solReady) sendCmdSilent(`airfire guns ${F.gunSolution.id} ${F.gunSolution.aimQuality.toFixed(2)}`);
        else if (F.hardpoints > 0) sendCmdSilent('fire');
      }
      // Rounds/squirt scales with the cadence, so the light chin gun eats its belt at a
      // believable rate rather than a cannon's (the drum readout is cosmetic either way).
      F.gunRounds = Math.max(0, F.gunRounds - (F.chinGun ? 30 : 65));
      try { gunFx(F.external, F.chinGun); } catch {}
    }
  }
  F.fireHeld = F.firing;   // edge detect: one missile per trigger squeeze
  // Reticle: amber when armed, pulsing while the seeker builds, green on a firing solution
  // (guns on target, or a full missile lock).
  const retEl = document.getElementById('fsim-reticle');
  if (retEl) {
    retEl.classList.toggle('lock', solReady || !!F.lockId || !!F.swarmReady);
    retEl.classList.toggle('seek', F.weapon === 'msl' && F.lockProg > 0 && !F.lockId);
  }

  // Airport target guide — the selected field (default: the nearest) resolved to a live
  // tile-offset from the craft, for the windshield's in-view accent ring / off-screen Home
  // waypoint. Tracked by airfield id; falls back to the nearest whenever the target drops out.
  let apTarget = null;
  // Destinations = airfields + named landmarks + spatial regions (same shape), so the guide can
  // lock onto any of them. When the pilot has cleared all waypoints (F.apCleared) we resolve
  // nothing and leave the readout blank — no auto-snap back to the nearest field.
  const fieldList = [...(Array.isArray(F.fields) ? F.fields : []), ...(Array.isArray(F.landmarks) ? F.landmarks : []), ...(Array.isArray(F.regions) ? F.regions : [])];
  const nmEl = document.getElementById('fsim-tgt-name');
  if (F.apCleared) {
    if (nmEl) nmEl.textContent = '—';
  } else if (fieldList.length) {
    if (!F.apTargetId || !fieldList.some((f) => f.id === F.apTargetId)) F.apTargetId = fieldList[0].id;
    const tgt = fieldList.find((f) => f.id === F.apTargetId) || fieldList[0];
    if (tgt.gx != null) {
      const adx = tgt.gx - F.pos.x, ady = tgt.gy - F.pos.y;
      apTarget = { dx: adx, dy: ady, name: tgt.name, dist: Math.round(Math.hypot(adx, ady)) };
    }
    // Name + live distance-to-run (tiles), matching the windshield field list's "NAME 42".
    if (nmEl) nmEl.textContent = (tgt.name || 'FIELD').slice(0, 8).toUpperCase() + (apTarget ? '  ' + apTarget.dist : '');
  }

  // Checkride pilot-wings rings — resolve absolute gate tiles to live offsets for the
  // windshield, and detect a fly-through of the ACTIVE ring (the client owns the plane's
  // world position), reporting it to the server which advances the ride.
  let gateView = null;
  const cr = F.checkride;
  if (cr && Array.isArray(cr.gates) && cr.gates.length) {
    gateView = { active: cr.gateIdx, rings: cr.gates.map((g) => ({ dx: g.gx - F.pos.x, dy: g.gy - F.pos.y, altDiff: g.alt - s.altitude, r: g.r })) };
    const g = cr.gates[cr.gateIdx];
    if (g && F.lastGateSent !== cr.gateIdx) {
      const gdx = g.gx - F.pos.x, gdy = g.gy - F.pos.y;
      if (Math.hypot(gdx, gdy) < g.r && Math.abs(s.altitude - g.alt) < g.altTol) {
        F.lastGateSent = cr.gateIdx;   // one report per gate; re-arms when the server advances gateIdx
        sendCmdSilent(`flightevent gate ${cr.gateIdx}`);
      }
    }
  }

  // Prop/rotor spool choreography for the external chase model. BLADES: F.propSpin rises when the
  // engine is on (idling even at zero throttle) and winds DOWN to a dead stop a beat after shutdown
  // — spin-up brisk, wind-down lazy. F.propPhase accumulates the actual rotation angle at a rate
  // that scales with the spool, so the blades visibly slow to rest instead of snapping to a halt.
  // DISC: propDisc is keyed to real rpm/throttle, so the translucent blur fades IN only as you power
  // up and fades OUT first on shutdown (blades still turning under it). Reverses the startup order.
  // WINDMILL: with the engine dead (out of fuel/power) the prop hangs stopped — but the airflow of
  // a dive can still drive it. Past cruise the blades freewheel, winding up toward Vne; below cruise
  // there's not enough bite so it settles to a complete rest. (Helis autorotate differently — left
  // to wind fully down.) No disc under it (propDisc rides real rpm ≈ 0), so it reads as a slow
  // free-spinning prop, not powered.
  const windmill = (!F.heli && !F.engineOn)
    ? clampNum((r.airspeed - P.cruise) / Math.max(1, (P.vne || 120) - P.cruise), 0, 1) * 0.55
    : 0;
  const propTgt = F.engineOn ? 0.20 + 0.80 * clampNum(s.rpm, 0, 1) : windmill;
  F.propSpin = lerpN(F.propSpin || 0, propTgt, Math.min(1, dt * (propTgt > (F.propSpin || 0) ? 2.2 : 1.0)));
  // The lerp only ever ASYMPTOTES toward zero, so without a deadband the blades creep forever and
  // the prop never actually parks. Snap the last sliver to a dead stop, and freeze the angle there.
  if (propTgt <= 0 && F.propSpin < 0.02) F.propSpin = 0;
  F.propPhase = (F.propPhase || 0) + dt * F.propSpin * 34;   // rev rate ∝ spool → frozen at rest
  const propDisc = clampNum((d.rpm - 0.12) / 0.45, 0, 1);    // no disc at idle; fully in by ~57% rpm

  paintWindshield('fsim-ws', {
    gates: gateView,
    pitch: d.pitch, bank: d.bank,
    // Render height fraction (drives eye-height/compression). Referenced to 3000ft with a
    // sqrt curve so it ramps HARD off the deck — by ~500ft you're visibly above the buildings.
    // Use the RAW s.altitude, not the whole-foot-rounded readout: the sqrt is steepest just off
    // the deck, so feeding rounded feet made the eye-height jump in visible steps on the climb-out
    // (worst on slow climbers). The raw float climbs continuously.
    height: Math.min(1, Math.sqrt(Math.max(0, s.altitude) / 3000)), speed: clampNum(r.airspeed / (P.vne || 120), 0, 1),
    // Big IAS/ALT/VSI readouts over the glass — the two numbers the eye needs most, boxed large so
    // they read at a glance in every cockpit. vne feeds the tape a redline warn when the speed reddens.
    ias: Math.round(r.airspeed), alt: Math.round(r.altitude), vsi: Math.round(s.vs), vne: P.vne, vs0: P.vs0,
    // Use the RAW s.heading, not the whole-degree-rounded readout the PFD tape eases toward
    // (d.hdg). readout() quantises heading to integer degrees; easing the WORLD toward that
    // stair-stepped target stutters the pan, and a 1° step throws distant horizon features
    // several pixels sideways — the "horizon jumps around when you yaw". The raw float yaws
    // continuously. (Same reason height uses raw s.altitude above.) d.hdg stays for the HUD.
    hour: F.sky?.hour, weather: F.sky?.weather, wind: F.sky?.wind, heading: s.heading,
    // Spatial weather cells + our absolute world position → real clouds/rain out the canopy.
    wxField: F.sky?.field, acX: F.pos.x, acY: F.pos.y,
    map: F.map, mapCenter: F.mapCenter, phase: 'cruise', airport: F.airport, helipad: !!F.helipad, biomeBelow: F.biomeBelow,
    regions: F.regions,   // drives the windshield region atmosphere grade (The Reach dust, …)
    mapOffset: { x: F.pos.x - F.mapCenter.x, y: F.pos.y - F.mapCenter.y }, travel: F.travel,
    // World-fixed runway: its origin + heading in the world, offset from the craft — so it
    // stays put and recedes/rotates naturally as you fly away (not glued ahead of the nose).
    runway: { ox: F.rwOrigin.x - F.pos.x, oy: F.rwOrigin.y - F.pos.y, hdg: F.rwHdg, len: F.rwLen, alt: clampNum(s.altitude / 320, 0, 1) },
    landGuide,
    hud: true,
    threat: (F.aa && F.reportedAirborne) ? F.aa : null,   // AA envelope telegraph → pulsing banner + tape chevron
    airports: F.fields, apTarget, apTargetId: F.apTargetId, viewYaw: F.viewYaw, extYaw: F.extOrbit || 0, extPitch: F.extPitch ?? REST_PITCH,
    // Looking off the nose (Q/E/S) → frame the view as a side cabin window instead of the
    // forward windscreen. The real, rotated Mode-7 world still renders behind the pane.
    windowClass: F.viewYaw ? F.cls : undefined,
    windVec: (atmos.windKt > 1 && F.reportedAirborne) ? { dir: atmos.windDir, kt: atmos.windKt } : null,
    contacts: contactView, designated,
    // Phase B guns: tracers stream out whenever the trigger's held (armed, airborne,
    // gun selected) — solution or not — so you can SEE where you're shooting and walk
    // the rounds onto the bogey. A hull readout + a red battle-damage flash on a hit.
    firing: !!(F.firing && F.armed && F.reportedAirborne && F.weapon !== 'msl'), muzzle: F.muzzleT && (now - F.muzzleT < 60), muzzleT: F.muzzleT || 0, gunMs: F.gunMs,
    chinGun: F.chinGun,   // gun station: one barrel under the nose (heli) vs a pair under the wings
    // Missiles in the air right now — flown client-side (stepShots), drawn as real world objects.
    missiles: stepShots(F, now, dt, s),
    // Two-part gunsight: shown while the guns are armed + airborne (aiming, not only firing). Also
    // aligns the chase camera dead-astern so the boresight runs up the screen centre (windshield.js).
    reticle: !!(F.armed && F.reportedAirborne && F.weapon !== 'msl'),
    hull: F.hull, hitFlash: F.hitFlashT ? clampNum(1 - (now - F.hitFlashT) / 400, 0, 1) : 0,
    breakup: surfaceBreakup(F.surfaces),   // sheared structural surfaces → the external/chase view shows the wing simply GONE (live, not the crash cinematic)
    // Incoming ground-AA tracer: bearing it's arriving from + a 0..1 progress fraction
    // (volley animates in over AA_TRACER_MS, then clears). dx/dy = the firing site's live
    // tile-offset from us (recomputed each frame so the volley stays anchored to the gun
    // while we move) → the windshield's 3D world tracers; null falls back to the 2D streak.
    aaTracer: (F.aaTracerT && (now - F.aaTracerT) < AA_TRACER_MS)
      ? { bearing: F.aaTracerBearing, t: (now - F.aaTracerT) / AA_TRACER_MS,
          dx: F.aaTracerX != null ? F.aaTracerX - F.pos.x : null,
          dy: F.aaTracerY != null ? F.aaTracerY - F.pos.y : null,
          hit: !!F.aaTracerHit,   // hit → rounds walk onto the cockpit; miss → streak wide
          seed: F.aaTracerSeed || 1 } : null,
    // Active ground AA emplacements as 3D world models. Server sends absolute site
    // tiles; we resolve them to a live offset from our own smooth position each frame
    // (same anchoring trick as the AA tracer) so the turrets sit still on the ground.
    aaSites: (F.aaSites && F.aaSites.length && F.pos)
      ? F.aaSites.map(s => ({ dx: s.x - F.pos.x, dy: s.y - F.pos.y, name: s.name })) : null,
    // Admin fireworks bursts: absolute launch tiles resolved to a live offset each frame
    // (same anchoring trick as aaSites), carrying a 0..1 life fraction so the windshield can
    // animate each burst's expand-and-fade. Expired bursts drop out here.
    fireworks: (F.fireworks && F.fireworks.length && F.pos)
      ? F.fireworks.filter(b => now - b.t0 < FIREWORK_MS)
          .map(b => ({ dx: b.x - F.pos.x, dy: b.y - F.pos.y, t: (now - b.t0) / FIREWORK_MS, rgb: b.rgb, seed: b.seed })) : null,
    // External chase view (V): draw the ship from behind with its gear, animating up/down.
    // Prop/rotor spin is driven by engine RPM (spooled fraction of throttle → reacts to the
    // engine being on and to throttle, with spool lag), NOT airspeed — so she turns at idle on
    // the ramp and winds up with the throttle instead of only spinning once she's moving.
    external: F.external, extZoom: F.extZoom || 1, cls: F.cls, armed: F.cls === 'heli' && F.hardpoints > 0, livery: F.livery, enginePct: d.rpm,
    engineOn: F.engineOn, landingLight: F.landingLight,   // nav/strobe/beacon die with the engine; landing lamps add a bright forward set
    panelLight: F.nightLight,   // PANEL switch → richer warm instrument glow reflected up onto the lower canopy

    propPhase: F.propPhase, propSpin: F.propSpin, propDisc,   // external prop/rotor spool choreography (blades spin up → disc fades in; reversed on shutdown)
    // Live control-surface deflection for the external chase model: ailerons/elevator/flaps
    // swing to the pilot's own inputs (elevator folds in trim, which the flight model also adds).
    // rudder: desktop flies it by hand on the ,/. pedals (F.input.pedal); touch devices have no
    // keyboard, so their fin auto-coordinates — a half-throw deflection INTO the roll as you bank.
    ctrl: F.external ? { aileron: F.input.aileron, elevator: clampNum(F.input.elevator + (F.input.trim || 0), -1, 1), flaps: F.input.flaps, rudder: clampNum((F.input.pedal || 0) + (_touchPrimary ? 0.5 * F.input.aileron : 0), -1, 1) } : null,
    gearAnim: F.gearRetract ? clampNum(F.gearAnim ?? 1, 0, 1) : 1,   // fixed-gear craft are always down
    noseVisor: F.hasVisor ? clampNum(F.noseVisor ?? 0, 0, 1) : 0,   // Leviathan cargo visor: raised when parked/cold, lowered under power (drives the external model swing)
    cockpitTilt: F.hasVisor ? clampNum(F.noseVisor ?? 0, 0, 1) : 0,   // …and pitches the first-person camera up to match the raised nose (cockpit view only)
    onGround: !!r.onGround,
    // Auto-land guidance dome over the Echelon's helipad — shown whenever you're flying a heli
    // near her (the dome only draws if a yacht cell is actually in the world window). It ARMS
    // (brightens/quickens) the moment you're inside the capture window (F.onYacht), telling you
    // she's about to take you. Cleared during the deck-cam cinematic (that view draws its own).
    padDome: (F.heli && F.reportedAirborne && !F.deckCine) ? { armed: !!F.onYacht } : null,
  });

  // Drug/booze impairment: warp the out-the-window view if the pilot is flying loaded.
  applyFlightDrugFx(root.querySelector('.fsim-view'), document.getElementById('fsim-ws'), dt);

  // Stream state to the server while flying AND during any ground roll — the landing
  // roll-out (F.rolling) and, just as importantly, the PRE-TAKEOFF taxi: without this the
  // plane rolls across the apron on screen while the server still has her sat at the gate,
  // so taxiing never moved her (and other pilots never saw the ground contact).
  // Cadence tightens to ~3 Hz when traffic is close (the dogfight bubble), 1.2s otherwise.
  const taxiing = s.onGround && F.engineOn;
  const syncEvery = contactNear <= FAST_SYNC_RANGE ? 0.33 : 1.2;
  F.syncAcc += dt; F.audioAcc += dt;
  if ((F.reportedAirborne || F.rolling || taxiing) && F.syncAcc >= syncEvery) {
    F.syncAcc = 0;
    sendCmdSilent(`flightsync ${F.pos.x.toFixed(2)} ${F.pos.y.toFixed(2)} ${Math.round(s.altitude)} ${Math.round(s.airspeed)} ${Math.round(s.heading)} ${Math.round(thr * 100)} ${Math.round(s.vs)} ${s.onGround ? 1 : 0} ${s.stalled ? 1 : 0} ${Math.round(s.bank || 0)} ${Math.round(s.pitch || 0)}`);
    // NB: mapCenter is NOT advanced here — it stays paired with the map the server sends back
    // (updated in flightSimContext), so buildings never jump/re-seed on a window recenter.
  }
  if (F.audioAcc >= 0.25) {
    F.audioAcc = 0;
    // Perspective: external chase view = you're OUTSIDE the airframe → the full, bright
    // exterior mix; cockpit view = you're in the cabin → the muffled interior mix (engine-audio
    // rolls the highs/wind off + drops the tone filter when perspective isn't 'exterior').
    // Doppler is only meaningful from the orbit cam: the engine sits at the aircraft, the camera
    // trails it, so pitch bends with the airspeed component along the aircraft→camera line —
    // receding (lower) when the cam is behind, approaching (higher) when you swing it out front,
    // neutral abeam. Inside the cabin you ride with the engine, so no doppler (1).
    let doppler = 1;
    if (F.external) {
      const vlos = -(s.airspeed || 0) * Math.cos(((F.extOrbit || 0)) * Math.PI / 180);   // >0 = closing on the cam
      doppler = clampNum(1 / (1 - vlos / DOPPLER_C), 0.92, 1.1);
    }
    updateEngineAudio({ continuous: true, airborne: F.reportedAirborne, engineOn: F.engineOn, class: F.cls, throttle: Math.round(thr * 100), spd: Math.round(s.airspeed), engines: [{ pct: Math.round(s.rpm * 100) }], bandIndex: s.altitude > 500 ? 1 : 0, sky: F.sky, atmos: F.atmos, acX: F.pos.x, acY: F.pos.y,
      rpm: s.rpm, airspeed: s.airspeed, vs: s.vs, altitude: s.altitude, onGround: s.onGround, groundSpeed: s.onGround ? s.airspeed : 0,
      stallMargin: s.stallMargin, stalled: s.stalled, flaps: input.flaps,
      perspective: F.external ? 'exterior' : 'interior', doppler });
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
  // Slip/skid ball (inclinometer): a ball in a curved tube below the attitude ball. Centred when
  // coordinated; a FORWARD SLIP (crossed controls) shoves it toward the LOW wing — glowing amber with
  // a SLIP legend — so you can read the slip you're holding to salvage a high/hot approach.
  const slip = clampNum(s.slip || 0, 0, 1), half = 22, yB = Math.min(H - 8, cy + 30);
  const off = slip * Math.sign(s.bank || 0) * (half - 5);
  ctx.save();
  ctx.fillStyle = 'rgba(10,18,26,0.9)'; ctx.strokeStyle = 'rgba(120,150,175,0.5)'; ctx.lineWidth = 1;
  ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(cx - half, yB - 4, half * 2, 8, 4); else ctx.rect(cx - half, yB - 4, half * 2, 8); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = 'rgba(200,230,255,0.55)'; ctx.beginPath(); ctx.moveTo(cx - 4.5, yB - 4); ctx.lineTo(cx - 4.5, yB + 4); ctx.moveTo(cx + 4.5, yB - 4); ctx.lineTo(cx + 4.5, yB + 4); ctx.stroke();
  const active = slip > 0.05;
  if (active) { ctx.shadowColor = '#ffb23e'; ctx.shadowBlur = 5; }
  ctx.fillStyle = active ? '#ffb23e' : '#cfe0ee'; ctx.beginPath(); ctx.arc(cx + off, yB, 3, 0, 7); ctx.fill();
  ctx.restore();
  if (active) { ctx.fillStyle = '#ffb23e'; ctx.font = '6px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('SLIP', cx, yB - 6); }
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
  // Label above — font scales with the dial so a big gauge reads big.
  const lblF = Math.max(6, Math.round(r * 0.32)), valF = Math.max(7, Math.round(r * 0.4));
  ctx.fillStyle = '#a3b7c7'; ctx.font = `${lblF}px monospace`; ctx.textBaseline = 'alphabetic'; ctx.fillText(label, cx, cy - r - Math.max(3, r * 0.12));
  // Recessed digital read-out pill below the hub.
  const vy = cy + r * 0.56, pw = Math.max(20, r * 1.15), ph = Math.max(9, r * 0.52), px0 = cx - pw / 2, py0 = vy - ph / 2, rr = 2;
  ctx.beginPath(); ctx.moveTo(px0 + rr, py0); ctx.arcTo(px0 + pw, py0, px0 + pw, py0 + ph, rr); ctx.arcTo(px0 + pw, py0 + ph, px0, py0 + ph, rr); ctx.arcTo(px0, py0 + ph, px0, py0, rr); ctx.arcTo(px0, py0, px0 + pw, py0, rr); ctx.closePath();
  ctx.fillStyle = 'rgba(3,8,12,0.85)'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.6; ctx.stroke();
  ctx.fillStyle = opts.valcol || ACCENT; ctx.font = `bold ${valF}px monospace`; ctx.textBaseline = 'middle'; ctx.fillText(String(val), cx, vy + 0.5);
}


// ── Extra gauge-panel furniture ──────────────────────────────────────────────
// The engine dials only fill two narrow columns at the panel's edges; the wide bands
// between them and the centre stick used to be dead black. These fill that space with
// an annunciator tile grid, slim secondary bar instruments, and (reaper only) a GAU-8
// ammo/stores block — all kept clear of the stick so they never sit under it at rest.
function fsPill(ctx, x, y, w, h, rr) {
  rr = Math.min(rr, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr); ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr); ctx.arcTo(x, y, x + w, y, rr); ctx.closePath();
}
// A grid of caution/annunciator lamps: dim when nominal, glowing in their alarm colour when lit.
function annunTiles(ctx, x0, y0, x1, y1, tiles) {
  if (!tiles.length || x1 - x0 < 30) return;
  const cols = (x1 - x0) > 92 ? 2 : 1, rowsN = Math.ceil(tiles.length / cols), gap = 3;
  const tw = (x1 - x0 - gap * (cols - 1)) / cols, th = Math.min(15, (y1 - y0 - gap * (rowsN - 1)) / rowsN);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  tiles.forEach((t, i) => {
    const c = i % cols, rw = Math.floor(i / cols), x = x0 + c * (tw + gap), y = y0 + rw * (th + gap);
    fsPill(ctx, x, y, tw, th, 3);
    ctx.fillStyle = t.on ? t.col : 'rgba(10,16,22,0.72)'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = t.on ? t.col : 'rgba(70,92,110,0.4)';
    if (t.on) { ctx.save(); ctx.shadowColor = t.col; ctx.shadowBlur = 6; ctx.stroke(); ctx.restore(); } else ctx.stroke();
    ctx.fillStyle = t.on ? '#06121c' : 'rgba(140,165,185,0.6)';
    ctx.font = `bold ${Math.min(8, th * 0.56)}px monospace`; ctx.fillText(t.lbl, x + tw / 2, y + th / 2 + 0.5);
  });
}
// Slim bottom-anchored bar instruments (oil pressure / fuel flow / hydraulics) with a caption.
function barCluster(ctx, x0, x1, H, items) {
  const yTop = H * 0.16, yBot = H * 0.80, n = items.length, slot = (x1 - x0) / n, bw = Math.min(13, slot * 0.52);
  items.forEach((it, i) => {
    const cx = x0 + slot * (i + 0.5), h = yBot - yTop;
    fsPill(ctx, cx - bw / 2, yTop, bw, h, 3); ctx.fillStyle = 'rgba(6,12,18,0.82)'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(90,120,145,0.3)'; ctx.stroke();
    const fh = h * clampNum(it.frac, 0, 1);
    ctx.save(); ctx.beginPath(); ctx.rect(cx - bw / 2, yBot - fh, bw, fh); ctx.clip();
    fsPill(ctx, cx - bw / 2, yTop, bw, h, 3); ctx.fillStyle = it.col; ctx.globalAlpha = 0.9; ctx.fill(); ctx.restore();
    ctx.fillStyle = '#8aa0b2'; ctx.font = '7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(it.lbl, cx, yBot + 3);
  });
}
// Reaper-only GAU-8 gun/stores block: a rotary-odometer rounds counter + depletion bar,
// a master-ARM lamp and the selected-weapon readout.
function gunStores(ctx, x0, x1, yTop, yBot, g) {
  const cx = (x0 + x1) / 2, w = Math.min(x1 - x0, 128), bx0 = cx - w / 2;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillStyle = '#b08a4a'; ctx.font = 'bold 8px monospace'; ctx.fillText('◈ GAU-8 · STORES', cx, yTop);
  const ly = yTop + 12, lh = 20;
  fsPill(ctx, bx0, ly, w, lh, 4); ctx.fillStyle = 'rgba(3,9,6,0.9)'; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
  const rounds = Math.max(0, g.gunRounds | 0);
  ctx.fillStyle = rounds < 200 ? '#ff5a5b' : '#ff9a38'; ctx.font = 'bold 15px monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(String(rounds).padStart(4, '0'), bx0 + 7, ly + lh / 2 + 0.5);
  ctx.fillStyle = '#6b7a5a'; ctx.font = '7px monospace'; ctx.textAlign = 'right'; ctx.fillText('RDS', bx0 + w - 6, ly + lh / 2 + 0.5);
  const dy = ly + lh + 4, df = rounds / (g.gunCap || 1174);
  fsPill(ctx, bx0, dy, w, 4, 2); ctx.fillStyle = 'rgba(6,12,10,0.85)'; ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.rect(bx0, dy, w * df, 4); ctx.clip();
  fsPill(ctx, bx0, dy, w, 4, 2); ctx.fillStyle = df < 0.2 ? '#ff5a5b' : '#8de24a'; ctx.fill(); ctx.restore();
  const ry = dy + 9, rh = 16, gp = 5, half = (w - gp) / 2, armed = !!g.armed;
  fsPill(ctx, bx0, ry, half, rh, 3); ctx.fillStyle = armed ? '#c0392b' : 'rgba(10,16,22,0.72)'; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = armed ? '#ff5a3a' : 'rgba(70,92,110,0.4)';
  if (armed) { ctx.save(); ctx.shadowColor = '#ff5a3a'; ctx.shadowBlur = 6; ctx.stroke(); ctx.restore(); } else ctx.stroke();
  ctx.fillStyle = armed ? '#ffe0d0' : 'rgba(140,165,185,0.6)'; ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(armed ? '● ARM' : '○ SAFE', bx0 + half / 2, ry + rh / 2 + 0.5);
  fsPill(ctx, bx0 + half + gp, ry, half, rh, 3); ctx.fillStyle = 'rgba(10,16,22,0.72)'; ctx.fill();
  ctx.strokeStyle = 'rgba(70,92,110,0.4)'; ctx.stroke();
  ctx.fillStyle = '#8de24a'; ctx.fillText(g.weapon === 'msl' ? 'MSL ' + (g.msl || 0) : 'GUN', bx0 + half + gp + half / 2, ry + rh / 2 + 0.5);
}

function paintGauges(cv, g) {
  if (!cv || !cv.getContext) return;
  const cw = cv.clientWidth, ch = cv.clientHeight; if (!cw || !ch) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
  const ctx = cv.getContext('2d'); ctx.save(); ctx.scale(dpr, dpr);
  const W = cw, H = ch; ctx.clearRect(0, 0, W, H);
  const rpms = g.rpms || [g.rpm || 0], temps = g.temps || [g.temp || 40], nEng = Math.max(1, g.engines || 1);
  // spec[2] carries the engine index (1-based; 0 = single-engine, no suffix) — the draw
  // cases below label it per powerplant (piston RPM/TEMP · turboprop TQ/ITT · jet N1/EGT).
  const rpmSpec = (i) => ['rpm', rpms[i] || 0, nEng > 1 ? i + 1 : 0];
  const tempSpec = (i) => ['temp', temps[i] || 40, nEng > 1 ? i + 1 : 0];
  const eng = g.eng || 'piston';
  const suffix = (n) => (n ? ' ' + n : '');
  // FAT, READABLE cluster: only the primary powerplant dials + the L/R fuel pair live here now.
  // Airspeed reads off the PFD tape and the STALL / LOW-ROTOR lamp lives over the view, so those
  // redundant dials are dropped — which lets a single-engine craft run just TWO rows of big dials
  // flanking the yoke (twins fill three, a 4-engine heavy five). Fuel is a proper L/R tank pair.
  let leftCol, rightCol;
  if (nEng === 1) {
    leftCol = [rpmSpec(0), ['fuel', 'L']];
    rightCol = [tempSpec(0), ['fuel', 'R']];
  } else {
    const half = Math.ceil(nEng / 2);
    leftCol = []; for (let i = 0; i < half; i++) leftCol.push(rpmSpec(i), tempSpec(i)); leftCol.push(['fuel', 'L']);
    rightCol = []; for (let i = half; i < nEng; i++) rightCol.push(rpmSpec(i), tempSpec(i)); rightCol.push(['fuel', 'R']);
  }
  const rows = Math.max(2, leftCol.length, rightCol.length), chd = H / rows;
  // Radius is as big as the row height allows (leaving room for the label above + read-out below)
  // and capped by the width so a dial never crowds the yoke rising up the centre.
  const r = Math.min(chd * 0.38, W * 0.19);
  const col = Math.max(r * 1.28, W * 0.04), colL = col, colR = W - col;
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
      case 'fuel': arcGauge(ctx, x, y, r, g.fuelPct / 100, 'FUEL' + (spec[1] ? ' ' + spec[1] : ''), g.fuelPct + '%', { col: g.fuelPct <= 15 ? '#ff5a5b' : '#ffb23e', valcol: g.fuelPct <= 15 ? '#ff5a5b' : ACCENT, marks: [{ v: 0.15, col: '#ff5a5b' }] }); break;
    }
  };
  leftCol.forEach((s, i) => draw(s, colL, yAt(i)));
  rightCol.forEach((s, i) => draw(s, colR, yAt(i)));

  // ── Fill the dead bands between the dial columns and the centre stick ──────────
  const dialHalf = r * 1.22, innerL = colL + dialHalf + 8, innerR = colR - dialHalf - 8;
  const koL = W * 0.35, koR = W * 0.65;   // centre keep-out (the stick lives here at rest)
  // Left band → secondary bar instruments (cosmetic, driven off the primary powerplant).
  if (koL - innerL > 40) barCluster(ctx, innerL, koL, H, [
    { lbl: 'OIL', frac: g.engineOn ? 0.5 + g.prpm * 0.45 : 0.05, col: '#5fe0a0' },
    { lbl: 'FLOW', frac: g.engineOn ? Math.max(0.05, g.prpm) : 0, col: '#ffb23e' },
    { lbl: 'HYD', frac: g.engineOn ? 0.68 + g.prpm * 0.28 : 0.08, col: '#5fd0ff' },
  ]);
  // Right band → annunciator lamps, with the reaper's GAU-8 stores block stacked above them.
  if (innerR - koR > 40) {
    const gun = g.craft === 'reaper' && g.hardpoints > 0;
    const tiles = [
      { lbl: 'GEAR', on: g.gear === 'up', col: '#ffb23e' },
      { lbl: 'FUEL', on: g.fuelPct <= 15, col: '#ff5a5b' },
      { lbl: 'GEN', on: g.battery < 20, col: '#ff5a5b' },
      { lbl: 'STALL', on: !!g.stall, col: '#ff5a5b' },
    ];
    if (eng === 'heli') tiles.push({ lbl: 'AUTO', on: !!g.autorot, col: '#ffb23e' }, { lbl: 'LO NR', on: !!g.lowNr, col: '#ff5a5b' }, { lbl: 'VRS', on: !!g.vrs, col: '#ff5a5b' });
    if (g.hardpoints > 0 && !gun) tiles.push({ lbl: 'ARM', on: !!g.armed, col: '#ff5a3a' });
    if (gun) { gunStores(ctx, koR, innerR, H * 0.10, H * 0.52, g); annunTiles(ctx, koR, H * 0.58, innerR, H * 0.9, tiles); }
    else annunTiles(ctx, koR, H * 0.14, innerR, H * 0.86, tiles);
  }
  if (g.night) nightGlow(ctx, W, H);
  // EMP: the dials are drawn and then buried. Painting them first and covering
  // them is deliberate — a faint ghost of the needles behind dead glass reads as
  // hardware that has lost power, where an empty canvas would just look broken.
  if (g.avionicsOut) {
    ctx.fillStyle = 'rgba(4,7,10,0.93)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ff5a5b';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('AVIONICS OUT', W / 2, H / 2 - 7);
    ctx.fillStyle = 'rgba(255,90,91,0.55)';
    ctx.font = '9px monospace';
    ctx.fillText('FLY THE AIRCRAFT', W / 2, H / 2 + 8);
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }
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
  if (msg.landmarks) F.landmarks = msg.landmarks;   // named buildings the target guide can lock onto (cycled alongside fields)
  if (msg.regions) F.regions = msg.regions;   // spatial world-map places (Coldwater Basin…) the guide can lock onto (cycled alongside fields/landmarks)
  if ('onField' in msg) F.onField = !!msg.onField;   // rolled onto a real airfield → auto-park + open the hangar on full stop
  if ('onYacht' in msg) F.onYacht = !!msg.onYacht;   // a VTOL set down alongside the Echelon → auto-land on her helipad
  if (msg.occupants) { F.occupants = msg.occupants; if (msg.seats) F.seats = msg.seats; renderSeats(F); }   // cabin readout keeps pace with boarding
  if ('cargo' in msg) F.cargoKg = msg.cargo;   // current hold weight (drives the J jettison bind)
  if (msg.sky) F.sky = msg.sky;
  if ('avionicsOut' in msg) F.avionicsOut = !!msg.avionicsOut;   // EMP pulse — the panel is dead until the boards reboot
  if ('biomeBelow' in msg) F.biomeBelow = msg.biomeBelow;
  if ('surface' in msg) { F.surface = msg.surface; const tEl = document.getElementById('fsim-tile'); if (tEl) tEl.textContent = (msg.surface || '—').toUpperCase(); }
  if (typeof msg.hull === 'number') F.hull = msg.hull;   // authoritative hull for the cockpit readout
  if ('surfaces' in msg) F.surfaces = msg.surfaces || null;   // authoritative sheared-surface state → asymmetric physics + live breakup model (null = intact/repaired)
  if (typeof msg.msl === 'number' && msg.msl !== F.msl) { F.msl = msg.msl; if (F.paintPips) F.paintPips(); }   // authoritative rail count
  F.warn = msg.warn || null;
  // Guided checkride: store the current instruction + ring gates, and refresh the
  // persistent guidance card + control spotlight. renderCheckride redraws only on a stage
  // change, so this is cheap to call every tick.
  if ('checkride' in msg) {
    F.checkride = msg.checkride;
    renderCheckride(F, msg.checkride);
  }
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
    // A structural shear this hit: record the lost surface immediately (the flight_ctx that
    // follows carries the full authoritative map, but this makes the wing let go on the same
    // frame as the flash) → asymmetric physics kicks in + the live breakup model shows it gone.
    if (msg.sheared) {
      F.surfaces = { ...(F.surfaces || {}), [msg.sheared]: 0 };
      F.shake = Math.max(F.shake || 0, 30);   // a wing coming off throws the whole panel, harder than any ordinary hit
      if (F.toast) F.toast(`💥 STRUCTURAL FAILURE — ${SHEAR_TOAST[msg.sheared] || 'SURFACE'} GONE`);
    } else {
      // Impact shake scaled by how hard the hit bit into the hull (msg.dmg = hull % lost) —
      // a graze rattles, a heavy burst/missile throws the whole panel. `max` so a big jolt
      // isn't softened by a lingering one; the frame loop decays it.
      F.shake = Math.max(F.shake || 0, clampNum((msg.dmg ?? 8) * 0.9, 5, 28));
      if (F.toast) F.toast(`⚠ TAKING FIRE${msg.by ? ' · ' + msg.by : ''} — HULL ${msg.hullPct}%`);
    }
    try { hitFx(); } catch {}
  } else if (msg.role === 'dealt') {
    if (F.toast) F.toast('GUNS · HITS');
  }
}

// Confirmed-kill banner: the server pushes `flight_kill` whenever this pilot cuts down a
// target (strafe on the ground, or an air-to-air splash). We slam a big, loud entry across
// the top of the glass so a kill reads even with the text pane hidden. Entries stack and
// self-remove once their fade animation is done; the list is capped so a burst can't pile up.
export function flightSimKill(msg) {
  const F = _fsim; if (!F || !msg) return;
  const feed = document.getElementById('fsim-killfeed'); if (!feed) return;
  const el = document.createElement('div');
  el.className = 'fsim-kill';
  const name = String(msg.name || 'target').replace(/[<>]/g, '');
  el.innerHTML = `★ KILL — <b>${name}</b>`;
  feed.appendChild(el);
  while (feed.childElementCount > 4) feed.removeChild(feed.firstChild);   // cap the visible stack
  setTimeout(() => el.remove(), 3300);   // outlasts the in+hold+out CSS animation
  try { hitFx(); } catch {}
}

// RWR / countermeasure pushes (Phase C). `lock` = someone's seeker has you; `missile` = a
// launch warning (warble + a hard toast — flares are the answer); `flares` = your own burst
// confirmed by the server (play the launch FX); `clear`/`lockbreak` = the threat picture
// relaxed. All feedback — every consequence is already authoritative server-side.
export function flightSimAirThreat(msg) {
  const F = _fsim; if (!F || !msg) return;
  switch (msg.kind) {
    case 'lock':
      if (F.toast) F.toast(`⚠ RWR — MISSILE LOCK${msg.by ? ' · ' + msg.by : ''}`);
      try { aaWarn(); } catch {}
      break;
    case 'missile':
      F.mslWarnT = performance.now() + (msg.ms || 4000);
      if (F.toast) F.toast('⚠ MISSILE INBOUND — FLARES (X) + BREAK');
      try { mslWarble(); } catch {}
      break;
    case 'flares':
      if (F.toast) F.toast('FLARES AWAY');
      try { flareFx(); } catch {}
      break;
    case 'lockbreak':
      F.lockId = null; F.lockProg = 0; F.seekId = null;   // the server dropped our seeker lock
      if (F.toast) F.toast('LOCK LOST');
      break;
    case 'clear':
      F.mslWarnT = 0;
      if (F.toast) F.toast('RWR CLEAR');
      break;
  }
}

// Incoming ground-AA tracer: purely visual, no damage here (that's the `air_hit` push if it
// connects) — just draws where the fire is coming from so it isn't invisible/undodgeable.
// Carries the emplacement's world tile (msg.x/y) so the windshield can raise the volley
// from the actual gun in 3D; 900ms gives the rounds time to visibly climb from the ground.
const AA_TRACER_MS = 900;
export function flightSimAaTracer(msg) {
  const F = _fsim; if (!F || !msg) return;
  F.aaTracerT = performance.now();
  F.aaTracerBearing = msg.bearing || 0;
  F.aaTracerX = Number.isFinite(msg.x) ? msg.x : null;   // site world tile (null → screen-space fallback)
  F.aaTracerY = Number.isFinite(msg.y) ? msg.y : null;
  F.aaTracerHit = !!msg.hit;                             // server's hit/miss → tracer geometry
  F.aaTracerSeed = Math.random() * 100;                  // stable per-volley spread pattern
  const near = msg.near ?? 0.5;
  try { aaGunFx(near); } catch {}   // the gun's heavy report from below…
  try { tracerFx(near); } catch {}  // …and the round whipping past you
}

// Admin fireworks burst. The server pushes the launch tile (x,y) + colour; we stamp it with
// receipt time and let the windshield animate the expand-and-fade over FIREWORK_MS, anchored
// to the world tile like an AA site. The boom rides along in the payload — played here scaled
// by our distance from the launch, so a far-off pilot hears only a faint pop.
const FIREWORK_MS = 1700;
export function flightSimFireworks(msg) {
  const F = _fsim; if (!F || !msg) return;
  if (!F.fireworks) F.fireworks = [];
  F.fireworks.push({ x: msg.x, y: msg.y, t0: performance.now(), rgb: Array.isArray(msg.rgb) ? msg.rgb : [255, 220, 120], seed: Math.random() * 100 });
  if (F.fireworks.length > 24) F.fireworks.splice(0, F.fireworks.length - 24);   // cap the live list
  if (msg.sfx && F.pos) {
    const d = Math.max(Math.abs(msg.x - F.pos.x), Math.abs(msg.y - F.pos.y));   // chebyshev tiles
    const gain = Math.max(0, 1 - d / 40);
    if (gain > 0.05) { try { window.AudioEngine?.playSfx(msg.sfx, gain); } catch {} }
  }
}

// Storm lightning relayed from the server. The engine's stormTick is the single
// strike authority; each located strike (world tile + intensity) is handed to the
// windshield, which renders it as a 3-D bolt out the canopy when it's within view.
export function flightSimLightning(msg) {
  if (!msg) return;
  pushLightningStrike(msg.gx, msg.gy, msg.intensity);
}

// Air-to-air traffic relay (Phase A: see-only). Each contact carries world position +
// heading/speed so the frame loop can dead-reckon it smoothly between relays. Stamped
// with receipt time for the dead-reckon window.
export function flightSimContacts(msg) {
  const F = _fsim; if (!F || !msg) return;
  const now = performance.now();
  F.contacts = (msg.contacts || []).map(c => ({ ...c, t: now }));
}

// Active ground AA emplacements (world tiles) for the 3D windshield. Refreshed ~1Hz —
// the ground doesn't move, so no dead-reckon; the frame loop just re-offsets them from
// our own smooth position each render.
export function flightSimAASites(msg) {
  const F = _fsim; if (!F || !msg) return;
  F.aaSites = Array.isArray(msg.sites) ? msg.sites : [];
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
  document.body.classList.remove('fsim-external');     // …and the external chase-cam layout
  suppressWeatherFx(false);   // back to the room view — let the outdoor overlay resume
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. TARGETING — the gun-pass reticle deck
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
