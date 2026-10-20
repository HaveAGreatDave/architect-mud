// COCKPIT: the flight instrument panel, the continuous flight sim and the targeting deck.
// openTargeting reports { won } and the server's resolve command decides the outcome.

import { setAreaPane } from '../render.js';
import { state } from '../state.js';
import { sfx, clampInt, clampNum, esc, mountOverlay, ensureChassisStyles, deviceHeader, bezelScrews, crtOverlays, deckStrip, setDeckLevel } from './minigame-common.js';
import { updateBoatContacts, stopBoatContacts, KT_TO_MPH } from './boat-audio.js';
import { tweenOrbit } from './camera-tween.js';
import { internMap } from './map-intern.js';
import { seatSpot } from './seat-audio.js';
import { playCabinAudio, updateEngineAudio, stopEngineAudio, creak, spoolUp, spoolDown, groundFx, flapWhir, stallHorn, varioTick, gearFx, quackStart, QUACK_SQUEEZE_MS, visorFx, detentFx, gunFx, aaWarn, tracerFx, aaGunFx, hitFx, lockTone, mslWarble, missileFx, missileRippleFx, flareFx, spraySfx, diveSiren } from './engine-audio.js';
import { navHomeHTML, drawNavHome } from './nav-home.js';   // the HOME arrow on the water, boat or sub
import { drakeWaterFrame, judgeWaterTouchdown, seaRough, drakeFeetAnim, BOAT_MAX_KT, SUB_MAX_KT } from './drake-water.js';   // the Drake on the water: hull landings, boat and sub modes
import { depthMAt } from './seabed-scene.js';
import { loadCss } from '../../../shared/dom.js';

// Fetched at module load so ensureFlightSimStyles / ensureHudStyles can apply them synchronously.
const FSIM_CSS = await loadCss(new URL('./cockpit-fsim.css', import.meta.url));
const HUD_CSS = await loadCss(new URL('./cockpit-hud.css', import.meta.url));
// Mirrors MIN_WATER in plugins/submersible/sub.js; only lights the SUB gate.
const SUB_MIN_WATER_M = 3;
import { subCrossing, interiorHotspots, glWorldInstalled, glDecision, glLastError, lastViewState, lastFloorState, lastOwnShipMask, yachtPadZ, ensureWindshieldStyles, windshieldHTML, paintWindshield, disposeWindshield, panelControlRects, RENDER_TUNE, navMarks, buildingRoofFtAt, curtainRoofFtAt, modelTopZAt, altForRoofZ, altRestingOnZ, seaAmpsNow, hullSeaGains, ROOF_CATCH_R, ROOF_CATCH_CEIL_Z, MODEL_MAX_EXTENT, BUILDING_FOOT, VISIBLE_NEAR_F, VISIBLE_FAR_F, pushLightningStrike, surfaceBreakup, perfBegin, perfEnd, perfTick } from './windshield.js';
import { padCatchStep } from './pad-catch.js';
// ── GLASS 2 ────────────────────────────────────────────────────────────────
// Installed here, not in windshield.js, because the cold open and the smoke suite load that file without a GPU.
import { installGL, glCapabilities, glLastFrame } from './gl/install.js';
installGL();
// ⚠ GLASS 2 turns itself off silently on failure; __glass2() in the console reports why.
if (typeof window !== 'undefined') {
  window.__glass2 = () => {
    let caps = null;
    try { caps = glCapabilities(); } catch (e) { caps = { error: String(e && e.message || e) }; }
    return { caps, installed: glWorldInstalled(), gl: RENDER_TUNE.gl, frame: glLastFrame(), lastError: glLastError(), view: lastViewState(), decision: glDecision(), floor: lastFloorState(), shipMask: lastOwnShipMask() };
  };
}
import { suppressWeatherFx } from './weather-fx.js';
import { createState, step, readout, TYPES } from './flight-model.js';
import { thermalLift, heatOfCell } from '../../../shared/thermals.js';
import { windGust, windVeer, stormOf } from '../../../shared/wind-gust.js';
import { applyFlightDrugFx, clearFlightDrugFx } from './flight-drugfx.js';
import { sendCmd, sendCmdSilent } from '../net.js';
import { MURMUR_MEASURED } from './murmur.js';
import { hex2rgb, visorSpecFor, VIPER_SCALE } from './aircraft3d.js';
import { createFreeCam, bindFreeCamPointer, bindFreeCamIdle } from './freecam.js';
import { bindTouchGestures } from './touch-gestures.js';
import { bindBigScreenButton, exitBigScreen, BIGSCREEN_GLYPH, BIGSCREEN_TITLE } from './bigscreen.js';
import { claimSeatKeyboard, endSeatKeyboard } from './seat-keys.js';
import { MOUSE_STICK, STICK_TUNE, STICK_HINT_ON, STICK_HINT_OFF, createMouseStick, bindMouseStick } from './mousestick.js';
import { compactHidePanel, seatHidePanel } from '../../../shared/compact-view.js';
import { DRAKE_WHEEL } from '../../../shared/interior-drake.js';

// Touch devices have no rudder keys, so their fin auto-coordinates with roll.
const _touchPrimary = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

// Resting elevation of the chase camera's orbit (rad), from the renderer's own chaseUp/chaseBack.
const REST_PITCH = Math.asin(RENDER_TUNE.chaseUp / RENDER_TUNE.chaseBack);

// Doppler "speed of sound" (kt), twice the real figure so the orbit-cam shift stays gentle.
const DOPPLER_C = 1300;

// Canvas can't read var(--accent), so it's sampled when the cockpit opens.
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

// Per-class palette and chrome. Layout comes from capabilities, not class.
const CLASS_THEME = {
  ultralight: { acc: '#7fd6ff', chrome: 'minimal',   radar: 'sm' },
  grasshopper:{ acc: '#9ad46a', chrome: 'minimal',   radar: 'sm' },   // olive-drab liaison scout
  locust:     { acc: '#ffd24a', chrome: 'analog',    radar: 'sm' },   // crop-duster / ag-plane
  heli:       { acc: '#4fe0a0', chrome: 'rotor',      radar: 'md' },
  prop:       { acc: '#4fb8e0', chrome: 'analog',     radar: 'md' },
  heavy:      { acc: '#ffb23e', chrome: 'industrial', radar: 'lg' },
  gunship:    { acc: '#ff6b5b', chrome: 'military',    radar: 'lg' },
  divebomber: { acc: '#ff5cb0', chrome: 'military',    radar: 'md' },   // matches the tile crosshair she aims with
  wreck:      { acc: '#9bd06a', chrome: 'degraded',    radar: 'sm' },
};
const themeFor = (cls) => CLASS_THEME[cls] || CLASS_THEME.prop;

// Accent blended from the livery (base, trim, cabin), else the class accent.
function liveryAccent(livery, fallbackHex) {
  const b = livery && hex2rgb(livery.base), t = livery && hex2rgb(livery.trim), c = livery && hex2rgb(livery.cabin);
  if (!b && !t && !c) return fallbackHex;
  const mix = (i, w) => (b ? b[i] * w.b : 0) + (t ? t[i] * w.t : 0) + (c ? c[i] * w.c : 0);
  const w = { b: b ? 0.5 : 0, t: t ? 0.3 : 0, c: c ? 0.2 : 0 };
  const wsum = w.b + w.t + w.c || 1;
  const rgb = [0, 1, 2].map(i => Math.round(mix(i, w) / wsum));
  return '#' + rgb.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

// Yoke name-plate ink: base paint lifted toward white until it reads on the dark plate. Null with no paint.
function legibleInk(hex) {
  const rgb = hex2rgb(hex);
  if (!rgb) return null;
  let [r, g, b] = rgb;
  const lum = () => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  for (let i = 0; i < 24 && lum() < 150; i++) { r += (255 - r) * 0.18; g += (255 - g) * 0.18; b += (255 - b) * 0.18; }
  return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}
const _hx = (rgb) => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
function shadeRgb(rgb, m) { return _hx(rgb.map(v => v * m)); }
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
// Server-tick flight pushes position every few seconds; _moveFrom interpolates across the gap.
let _moveFrom = null;   // { fx, fy, t, dur, toFx, toFy }
let _lastPushT = 0;
// Last real values, so the scene can still draw once the payload has moved on.
let _lastGround = null, _lastMap = null, _lastBiome = null, _lastRegions = null;

// Passenger cabin choreography (bank/pitch/height ramp on climb-out and descent).
const GROUND_LEAD = 3.5, CLIMB_SEC = 9, BANK_ANGLE = 25, CLIMB_PITCH = 6, CRUISE_HEIGHT = 0.35;

// Passenger look direction: hold Q (forward) or E (rear); release for the side window.
let _paxView = 'side';       // 'side' | 'forward' | 'rear'
let _paxKeyHandlers = null;  // [onKeyDown, onKeyUp] once bound, so we can unbind cleanly
const freeCam = createFreeCam();
// Free-cam chrome is a body class. ⚠ It must hide the yoke, throttle and pedals: pointer capture covers
// .fsim-view only, so they could still fly a held aircraft. The corner buttons fade via bindFreeCamIdle.
let freeIdle = null;
function setFreeCamChrome(on) { document.body.classList.toggle('fsim-freecam', !!on); freeIdle?.wake(); }

// Mouse as control column (mousestick.js); K arms, ESC or K releases.
// ⚠ `read` starts the column at the current deflection; without it arming snaps both surfaces to neutral.
const mouseStick = createMouseStick({ key: 'k', read: () => [_fsim?.input?.aileron || 0, _fsim?.input?.elevator || 0] });
let stickUnbind = null;
// ⚠ Toast on the arm state, never the key: focus loss and lock loss release it too.
mouseStick.onArm((on) => fsimToast(on ? STICK_HINT_ON : STICK_HINT_OFF));

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
  if (isFlightSimActive()) return;   // the continuous cockpit owns the pane
  ensureHudStyles();
  const now = performance.now();
  _target = state || {};
  updateEngineAudio(_target);

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
  document.body.classList.remove('ck-fullscreen', 'ck-hidepanel');
  exitBigScreen();
  endSeatKeyboard();
  stopEngineAudio(); stopBoatContacts();
}

// Engine loops for someone walking a cabin room (the Leviathan): audio only, no panel.
export function cabinAudio(s) {
  if (isFlightSimActive() || isCockpitHudActive()) return;   // the pilot's cockpit / an open window overlay already owns the bus
  playCabinAudio(s);
}

// ── The per-frame animation loop ──────────────────────────────────────────────
// ⚠ A throwing frame must not end the loop: log once and re-arm (a stale _raf also blocks the restart).
const _frameFaults = new Set();
function frameFault(where, err) {
  if (_frameFaults.has(where)) return;
  _frameFaults.add(where);
  console.error(`[cockpit] ${where} frame threw; the loop carries on:`, err);
}
function hudFrame(t) {
  try { hudFrameBody(t); }
  catch (err) {
    frameFault('hud', err);
    _raf = document.getElementById('ck-hud-root') && _target ? requestAnimationFrame(hudFrame) : 0;
  }
}
function hudFrameBody(t) {
  const root = document.getElementById('ck-hud-root');
  if (!root || !_target) { _raf = 0; return; }
  const dt = Math.min(0.05, (t - _lastT) / 1000 || 0); _lastT = t;
  const s = _target, a = _anim;

  const hd = angDelta(a.hdg, s.headingDeg || 0);
  const turnRate = hd * Math.min(1, dt * 3.2);
  a.hdg = (a.hdg + turnRate + 360) % 360;
  a.sweep = (a.sweep + dt * 55) % 360;
  a.fuel += ((s.fuelPct || 0) - a.fuel) * Math.min(1, dt * 4);
  a.thr += ((s.throttle || 0) - a.thr) * Math.min(1, dt * 6);
  a.hull += ((s.hullPct ?? 100) - a.hull) * Math.min(1, dt * 4);
  a.spd += ((s.spd || 0) - a.spd) * Math.min(1, dt * 4);

  // ── Takeoff/landing choreography ──────────────────────────────────────────
  // Scripted off the moment `airborne` flips: ground roll, banked climb, cruise, and the mirror down.
  // Bank carries the climb because it tilts the passenger's side window too. CRUISE_HEIGHT stays
  // low because Mode-7 eye height is height*climbLift (7), which reads as shooting straight up.
  const vtol = !!s.vtol;   // helicopters lift straight up, no banked climb-out
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
    } else { targetHeight = CRUISE_HEIGHT; a._liftT = null; }
  } else if (a._landT != null) {
    const el = (t - a._landT) / 1000;
    if (el < CLIMB_SEC) {
      if (!vtol) { targetBank = -BANK_ANGLE; targetPitch = -CLIMB_PITCH; }
      targetHeight = clampNum(1 - el / CLIMB_SEC, 0, 1) * CRUISE_HEIGHT;
    }
    else if (el < CLIMB_SEC + GROUND_LEAD) { targetHeight = 0; }
    else { targetHeight = 0; a._landT = null; }
  } else {
    targetHeight = s.airborne ? CRUISE_HEIGHT : 0;
  }
  if (a._liftT == null && a._landT == null) targetBank = clampNum(hd * 0.5, -22, 22);
  a.roll += (targetBank - a.roll) * Math.min(1, dt * 0.8);
  a.pitch += (targetPitch - a.pitch) * Math.min(1, dt * 0.8);
  // Not eased: targetHeight is already the scripted ramp, and easing would round its corners.
  a.height = targetHeight;

  // Scene swap with hysteresis on height, so it lands mid climb-out or flare.
  if (a._scenePhase == null) a._scenePhase = s.airborne ? 'cruise' : 'ground';
  else if (a._scenePhase === 'ground' && a.height > 0.06) a._scenePhase = 'cruise';
  else if (a._scenePhase === 'cruise' && a.height < 0.025) a._scenePhase = 'ground';
  // Cosmetic ground roll from throttle (s.spd is 0 until wheels-up); resets each on-deck episode.
  if (a._prevScenePhase !== a._scenePhase) { if (a._scenePhase === 'ground') a.rwyRoll = 0; a._prevScenePhase = a._scenePhase; }
  if (a._scenePhase === 'ground') a.rwyRoll = (a.rwyRoll || 0) + (a.thr / 100) * dt * 0.225;
  // Linear, so ground speed reads constant between pushes.
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

// The window view, from the eased HUD state.
function paintWindow(id, a, s) {
  if (!document.getElementById(id)) return;
  const speedFrac = clampNum((a.spd || 0) / 200, 0, 1);
  const pax = s.seat === 'passenger';
  const paxView = pax ? _paxView : 'side';
  const onGround = (a._scenePhase || (s.airborne ? 'cruise' : 'ground')) === 'ground';
  const worldBlend = 1;
  // Fractional offset from the map window's integer centre, so the camera slides between pushes.
  const mapOffset = a.fx != null ? { x: a.fx - (s.x ?? a.fx), y: a.fy - (s.y ?? a.fy) } : undefined;
  paintWindshield(id, {
    pitch: a.pitch, bank: a.roll, height: a.height ?? 0, speed: speedFrac,
    hour: s.sky?.hour, moon: s.sky?.moon, weather: s.sky?.weather, wind: s.sky?.wind, heading: a.hdg,
    event: s.sky?.event,   // outranks `weather` for the canopy grade
    wxField: s.sky?.field, wxGround: s.sky?.ground, acX: a.fx, acY: a.fy,   // spatial weather cells, the ground they have already soaked, and our world position
    map: s.map || _lastMap,
    skyline: s.skyline,   // the tall towers outside the window; windshield.js keeps every one it has been sent
    phase: onGround ? 'ground' : 'cruise',
    worldBlend,
    airport: s.ground?.theme || _lastGround?.theme,
    helipad: s.ground?.helipad ?? _lastGround?.helipad ?? false,
    biomeBelow: s.biomeBelow ?? _lastBiome,
    roll: a.rwyRoll || 0,   // ground-roll distance
    regions: s.regions ?? _lastRegions,   // drives the windshield region atmosphere grade (The Reach dust, …)
    side: paxView === 'side', viewYaw: paxView === 'rear' ? 180 : 0,
    // Porthole frame for side/rear only; forward looks out through the windscreen.
    windowClass: pax && paxView !== 'forward' ? (s.class || 'prop') : undefined,
    livery: pax ? s.livery : undefined,   // hull skin punched by the window = the craft's own paint
    mapOffset,
  });
  if (pax) paintPaxControls(a);
}

// Forward view: the charter pilot's yoke and throttle, moved by the cabin choreography.
// Shares DOM ids with the flight sim, which is never mounted at the same time.
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
  // Bearing to the nearest field, heading-up.
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
  const cab = $('ck-cabin');
  if (cab) { if (s.livery) { cab.style.display = ''; cab.style.background = s.livery.cabin; cab.title = `cabin · ${s.livery.uphol}`; } else cab.style.display = 'none'; }
  const phase = !s.airborne
    ? (s.runup ? '<span class="ck-amber">RUN-UP: warming engines</span>' : s.engineOn ? '<span class="ck-green">READY: throttle up &amp; takeoff</span>' : '<span class="ck-dim">COLD: startup to begin</span>')
    : s.enginesStable === false && s.warn === 'FIRE' ? '<span class="ck-red">ENGINE FIRE</span>'
    : `AIRBORNE · ${s.bandLabel}`;
  html('ck-phase', phase);
  html('ck-guide-label', s.guide ? `<span class="ck-amber">◈ ${esc(s.guide.name)} ${String(s.guide.bearing).padStart(3, '0')}° · ${s.guide.dist}mi</span>` : '');
  const warnEl = $('ck-warn');
  if (warnEl) {
    const W = { STARVATION: ['ENGINE OUT. DEAD STICK. LAND NOW', 'r'], BINGO: ['BINGO FUEL: DIVERT', 'a'],
      STALL: ['STALL: NOSE DOWN', 'r'], FIRE: ['ENGINE FIRE: EXTINGUISH', 'r'], WEATHER: ['SEVERE TURBULENCE', 'a'] };
    const w = W[s.warn];
    warnEl.style.display = w ? '' : 'none';
    if (w) { warnEl.textContent = '⚠ ' + w[0]; warnEl.className = `ck-warn ck-warn-${w[1]}`; }
  }
  const arm = $('ck-arm'); if (arm) { arm.style.display = s.hardpoints > 0 ? '' : 'none'; arm.textContent = s.armed ? '● ARMED' : '○ SAFE'; arm.className = s.armed ? 'ck-pip ck-red' : 'ck-pip ck-dim'; }
  const cargo = $('ck-cargo'); if (cargo) { cargo.style.display = s.cargo > 0 ? '' : 'none'; cargo.textContent = `⬒ ${s.cargo}/${s.maxTOW}kg`; }
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
  renderMini(s.minimap);
  paintRadarWorld(s);
  (s.engines || []).forEach((e, i) => { const lbl = $(`ck-eng-lbl-${i}`); if (lbl) { lbl.textContent = e.stable ? 'OK' : (s.runup ? '···' : 'CHK'); lbl.setAttribute('fill', e.stable ? '#46e05a' : '#ffb23e'); } });
}

// Surrounding zones (getMinimapData) tinted by danger.
function renderMini(nodes) {
  const box = $('ck-mini'); if (!box) return;
  if (!nodes || !nodes.length) { box.innerHTML = '<div class="ck-mini-empty">no ground contact</div>'; return; }
  const cur = nodes.find(n => n.is_current) || nodes[0];
  if (cur.grid_x == null) { box.innerHTML = '<div class="ck-mini-empty">—</div>'; return; }
  let minx = 99, maxx = -99, miny = 99, maxy = -99;
  for (const n of nodes) { if (n.grid_x == null) continue; minx = Math.min(minx, n.grid_x); maxx = Math.max(maxx, n.grid_x); miny = Math.min(miny, n.grid_y); maxy = Math.max(maxy, n.grid_y); }
  const byXY = new Map(nodes.filter(n => n.grid_x != null).map(n => [`${n.grid_x},${n.grid_y}`, n]));
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
      <button class="ck-pax-bigbtn" id="ck-pax-bigbtn" title="${esc(BIGSCREEN_TITLE)}" tabindex="-1">${BIGSCREEN_GLYPH}</button>
      <button class="ck-pax-fsbtn" id="ck-pax-fsbtn" title="fullscreen" tabindex="-1">⛶</button>
      <button class="ck-pax-hidebtn" id="ck-pax-hidebtn" title="hide the text panel, more window" tabindex="-1">⊟</button>
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

// Fullscreen / hide-panel buttons. Keyboard ownership goes through seat-keys.js; don't rebind it here.
function wirePaxChrome() {
  const root = document.getElementById('ck-hud-root'); if (!root) return;
  const fsBtn = document.getElementById('ck-pax-fsbtn');
  const hideBtn = document.getElementById('ck-pax-hidebtn');
  bindBigScreenButton(document.getElementById('ck-pax-bigbtn'));
  fsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const on = document.body.classList.toggle('ck-fullscreen');
    fsBtn.classList.toggle('on', on);
    if (on) { document.body.classList.remove('ck-hidepanel'); hideBtn?.classList.remove('on'); }
  });
  hideBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const on = document.body.classList.toggle('ck-hidepanel');
    hideBtn.classList.toggle('on', on);
    if (on) { document.body.classList.remove('ck-fullscreen'); fsBtn?.classList.remove('on'); }
  });
  // On a phone the panel starts folded, through its own toggle so the button reads as pressed.
  seatHidePanel('ck-hidepanel', hideBtn);
  claimSeatKeyboard(root, { label: 'CABIN' });
}

// ── Compose the DOM from the aircraft's capabilities + size ───────────────────
function mountHud(s) {
  ensureWindshieldStyles();
  if (s.seat === 'passenger') return mountPassenger(s);
  const n = Math.max(1, s.engines?.length || 1);
  const th = themeFor(s.class);
  const acc = liveryAccent(s.livery, th.acc);
  const hasWpn = (s.hardpoints || 0) > 0, hasCargo = (s.cargoCap || 0) > 0, isVtol = !!s.vtol;

  const row2 = [compassInst(), engInst(n), isVtol ? hoverInst() : ''].filter(Boolean).join('');
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

// Radar blips plotted north-up; the parent group is rotated each frame.
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
  st.textContent = HUD_CSS;
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
// 1.5. THE CONTINUOUS COCKPIT (client sim, server reconcile)
// ══════════════════════════════════════════════════════════════════════════════
// Runs flight-model.js in the pane, streams state with `flightsync`, reports wheels-up and
// touchdown with `flightevent`, and takes fuel and the world below from `flight_ctx`.
// The yoke is inverted: drag down for nose up.

let _fsim = null;
const lerpN = (a, b, t) => a + (b - a) * t;
const ENGINE_START_MS = 2600;

// Checkride highlight key (server clientView) to the control it glows.
const CKRIDE_GLOW = { engine: 'fsim-eng', throttle: 'fsim-thr', yoke: 'fsim-yoke' };
// Cleared as a set on every redraw, so a tour glow the card's map doesn't know never lingers.
const GLOW_IDS = ['fsim-eng', 'fsim-thr', 'fsim-yoke', 'fsim-flap', 'fsim-trim'];
function fsimClearGlows() { for (const id of GLOW_IDS) document.getElementById(id)?.classList.remove('ck-glow'); }

// ── Flight-school tour ────────────────────────────────────────────────────────
// Client-only walkthrough for the checkride's STARTUP stage; the server's cards take over from TAKEOFF.
// Bodies are HTML; the argument picks touch copy.
const TOUR_STEPS = [
  { id: 'fsim-yoke', title: 'THE YOKE', body: (m) => m
    ? 'The <b>yoke</b> is your control column, drag it with your <b>finger</b>. Left/right banks the wings into a turn. It\'s <b>inverted</b> like the real thing: drag <b>DOWN</b> to pull back and <b>climb</b>, drag up to descend.'
    : 'The <b>yoke</b> is your control column, steer it with the <span class="k">mouse</span>. Drag <b>left/right</b> to bank the wings into a turn. It\'s <b>inverted</b> like the real thing: drag <b>DOWN</b> to pull back and <b>climb</b>, push <b>up</b> to descend.<br><br>Or press <span class="k">K</span> and fly her <b>on the mouse</b>: move it and the column moves with it, and <b>stays where you leave it</b>. <span class="k">ESC</span> or <span class="k">K</span> hands the mouse back.' },
  { id: 'fsim-thr', title: 'THROTTLE', body: (m) => m
    ? 'The <b>throttle</b> sets engine power: <b>drag the lever</b> up for more, down for less. Run it <b>full</b> for takeoff, and ease it back to bleed off speed for landing.'
    : 'The <b>throttle</b> sets engine power. Tap <span class="k">A</span> to add power, <span class="k">Z</span> to cut it: or drag the lever. Run it <b>full</b> for takeoff, and ease it back to bleed off speed for landing.' },
  { id: 'fsim-flap', title: 'FLAPS', body: (m) => m
    ? '<b>Flaps</b> add lift so you can fly slower and steeper. <b>Drag the flap knob</b> down a notch or two for takeoff and landing; leave them <b>UP</b> for cruise.'
    : '<b>Flaps</b> add lift so you can fly slower and steeper. Drag the flap knob, or tap <span class="k">Y</span> to extend / <span class="k">H</span> to retract: a notch or two for takeoff and landing; <b>UP</b> for cruise.' },
  { id: 'fsim-trim', title: 'TRIM', body: (m) => m
    ? '<b>Trim</b> takes the load off the yoke so you don\'t have to hold a climb by hand. <b>Drag the wheel</b> to the <b>T/O</b> mark for takeoff. Up = nose down, down = nose up.'
    : '<b>Trim</b> takes the load off the yoke so you don\'t have to hold a climb by hand. Drag the wheel, or roll the <span class="k">mouse&nbsp;wheel</span> over it, to the <b>T/O</b> mark for takeoff. Up = nose down, down = nose up.' },
  { id: 'fsim-eng', title: 'TAKEOFF', body: () =>
    '<b>Takeoff:</b> full throttle straight down the runway. As the speed tape comes alive and she gets light on the wheels, ease the <b>yoke back</b> to lift the nose and climb away, keep the wings level. Then chase the glowing rings.<br><br>Press <span class="k">I</span> for the <b>ignition</b>, or click the engine key or master switch on the panel in front of you, to fire her up and begin.' },
];

function renderTour(F) {
  const tour = document.getElementById('fsim-tour');
  if (!tour) return;
  if (F.tourStep == null) F.tourStep = 0;
  tour.classList.add('show');
  if (F.tourRenderedStep === F.tourStep) return;
  F.tourRenderedStep = F.tourStep;
  const i = F.tourStep, total = TOUR_STEPS.length, st = TOUR_STEPS[i], last = i === total - 1;
  const dots = TOUR_STEPS.map((_, k) => `<span class="fsim-tour-dot${k === i ? ' on' : ''}"></span>`).join('');
  tour.innerHTML =
    `<button class="fsim-tour-x" id="fsim-tour-x" title="skip the tour" tabindex="-1">✕</button>` +
    `<div class="fsim-tour-hd">✈ FLIGHT SCHOOL · ${i + 1}/${total}: ${st.title}</div>` +
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
  const dismiss = () => {   // falls back to the plain STARTUP card and engine glow
    F.tourDismissed = true; tour.classList.remove('show');
    F.checkrideStage = null;
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
  if (!cr) {   // not on a ride
    card.classList.remove('show'); tour?.classList.remove('show'); F.checkrideStage = null;
    F.tourStep = null; F.tourRenderedStep = null; F.tourDismissed = false;
    fsimClearGlows();
    return;
  }
  if (cr.stageNum === 1 && !F.tourDismissed) { card.classList.remove('show'); renderTour(F); return; }
  tour?.classList.remove('show');
  card.classList.add('show');
  if (cr.stage === F.checkrideStage) return;
  F.checkrideStage = cr.stage;
  const n = cr.stageNum || 1, total = cr.stageTotal || 4;
  card.innerHTML = '<div class="fsim-ckride-hd"></div><div class="fsim-ckride-body"></div>';
  card.querySelector('.fsim-ckride-hd').textContent = `✈ CHECKRIDE · STEP ${n}/${total}${cr.stageName ? ': ' + cr.stageName : ''}`;
  card.querySelector('.fsim-ckride-body').textContent = cr.instruction || '';
  card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
  fsimClearGlows();
  for (const key of (cr.highlight || [])) document.getElementById(CKRIDE_GLOW[key])?.classList.add('ck-glow');
}

// ── Flaps, per airframe ──────────────────────────────────────────────────────
// Detents map onto the model's 0..1 `flaps`. johnson: Cessna lever; quadrant: airliner gate;
// switch: 3-position toggle. null: no flaps.
const FLAP_STYLES = {
  johnson:  { cap: 'WING FLAPS', detents: [{ v: 0, l: 'UP' }, { v: 0.33, l: '10°' }, { v: 0.67, l: '20°' }, { v: 1, l: 'FULL' }] },
  quadrant: { cap: 'FLAPS',      detents: [{ v: 0, l: '0' }, { v: 0.25, l: '1' }, { v: 0.5, l: '2' }, { v: 0.75, l: '3' }, { v: 1, l: 'FULL' }] },
  switch:   { cap: '',           detents: [{ v: 0, l: 'UP' }, { v: 0.5, l: '½' }, { v: 1, l: 'FULL' }] },
};
const FLAP_BY_CRAFT = { mayfly: 'johnson', mule: 'johnson', leviathan: 'quadrant', reaper: 'switch', carcass: 'switch', dragonfly: null, viper: null, drake: null, grasshopper: 'johnson', locust: 'johnson',
  // The Shrike's flap lever also drives her dive brakes, so it gets the quadrant.
  shrike: 'quadrant' };
function flapStyleFor(craftType) {
  const key = craftType in FLAP_BY_CRAFT ? FLAP_BY_CRAFT[craftType] : 'switch';
  return key ? { key, ...FLAP_STYLES[key] } : null;
}
function buildFlapHtml(st) {
  if (!st) return '';
  const lbls = st.detents.map((d, i) => `<span data-fd="${i}"${i === 0 ? ' class="on"' : ''}>${d.l}</span>`).join('');
  const dual = st.key === 'quadrant';   // scale on both gate rails
  return `<div class="fsim-flap fsim-flap-${st.key}" id="fsim-flap">
    <div class="fsim-flap-body">
      <div class="fsim-flap-scale">${lbls}</div>
      <div class="fsim-flapsw-track" id="fsim-flapsw-track"><div class="fsim-flapsw-knob" id="fsim-flapsw-knob"></div></div>
      ${dual ? `<div class="fsim-flap-scale right">${lbls}</div>` : ''}
    </div>
    ${st.cap ? `<div class="fsim-flap-cap">${st.cap}</div>` : ''}
  </div>`;
}
// Tighten flightsync with traffic inside this many tiles; dead-reckon a contact at most this long (s).
const FAST_SYNC_RANGE = 5, CONTACT_DR_MAX = 2.0;
// Tiles per knot-second at a height: worldPace, plus the runway rush, plus the cruise stretch
// (AIR_PACE), which is near zero below 150 ft. Own ship, missiles, flares and contacts all read it.
const AIR_PACE = 2, AIR_PACE_RISE_FT = 500;
function paceAt(altFt, mult = 1) {
  const a = Math.max(0, altFt || 0);
  const rush = (RENDER_TUNE.groundBoost - 1) * Math.exp(-a / (RENDER_TUNE.groundDecay || 25));
  const cruise = (AIR_PACE - 1) * (1 - Math.exp(-((a / AIR_PACE_RISE_FT) ** 2)));
  return RENDER_TUNE.worldPace * mult * (1 + rush + cruise);
}
// Gun envelope (tiles, half-cone deg), alt-to-z scale (mirrors windshield CONTACT_ALT_K), and FX cadence.
const GUN_RANGE = 2.2, GUN_CONE = 11, GUN_ALT_K = 1 / 600, GUN_FIRE_MS = 120;   // ~8.3 rounds/s, .50 cal
// The Drake's gun convergence range (tiles), set on the CONV knob. Client-side only.
const DRAKE_CONV_STEPS = [0.6, 1.0, 1.4, 1.8, 2.2];
function drakeConv() { return _fsim?.gunConv ?? 1.2; }
function setDrakeConv(x) { if (_fsim) _fsim.gunConv = Math.round(Math.max(0.5, Math.min(GUN_RANGE, x)) * 10) / 10; }
// ⚠ The burst command is paced just above the server's gun cooldown: a dropped command still
// spends a rate-limiter token (5/s), so sending at FX cadence trips the throttle.
const GUN_CMD_AIR_MS = 600;      // > server A2A GUN_COOLDOWN_MS (550)
const GUN_CMD_GROUND_MS = 700;   // > server GROUND_GUN_COOLDOWN_MS (650)
// Seeker envelope, lock time and launch gap. Mirror MISSILE_* in state.js (the server is a shade more lenient).
const MSL_RANGE = 8, MSL_CONE = 25, MSL_LOCK_MS = 2500, MSL_FIRE_MS = 1600;
// Swarm (Viper): no lock, any bogey in the cone. Kept under the server's SWARM_CONE (45°).
const SWARM_CONE = 40, SWARM_FIRE_MS = 2300;
// The Viper's single chin LMG: double cadence; gun_mult halves its damage server-side.
const GUN_FIRE_MS_LIGHT = 62;

// ── Missiles in the air (the shot you actually watch) ─────────────────────────
// Visual only: the server resolves each missile. Unlocked swarm rounds wander on purpose
// (they're dumb seekers); a locked missile flies the same path with little wander.
const MSL_STAGGER_MS = 120;     // matches the server's per-seeker resolve stagger
const MSL_LIFE_MS = 5200;       // how long we keep drawing one before it's out of the picture
const MSL_TRAIL = 16;           // smoke-trail samples kept per missile
const MSL_SPEED = 1.25;         // terminal speed (world tiles/s)
const MSL_BOOST_S = 0.55;       // motor burn: launch speed → MSL_SPEED over this long
const MSL_TURN = 150;           // seeker authority (deg/s of heading correction)

// A no-target salvo goes where the boresight meets the ground (as drawGunTracers); clamped for level shots.
function groundAim(F, s) {
  const hr = s.heading * Math.PI / 180;
  const pit = Math.min(-1.5, s.pitch || 0) * Math.PI / 180;         // treat level-or-up as a shallow dive
  const R = clampNum(Math.max(0.6, s.altitude / 600) / Math.tan(-pit), 0.8, 6);   // tiles ahead where the line meets the ground
  return { x: F.pos.x + Math.sin(hr) * R, y: F.pos.y - Math.cos(hr) * R, alt: 0 };
}
// `tgt` is { id } (a live contact) or { x, y, alt } (a ground point). `wander` scales the weave.
function launchShots(F, now, n, tgt, wander) {
  F.shots = F.shots || [];
  for (let i = 0; i < n; i++) {
    F.shots.push({
      t0: now + i * MSL_STAGGER_MS, live: false, seed: Math.random() * 6.283,
      side: i % 2 ? 1 : -1, wander, tgt, trail: [], boomT: 0,
    });
  }
}
// Steps every shot one frame; returns offsets from us for the windshield.
function stepShots(F, now, dt, s) {
  if (!F.shots || !F.shots.length) return null;
  const view = [];
  for (const m of F.shots) {
    if (now < m.t0) continue;
    const age = (now - m.t0) / 1000;
    if (!m.live) {
      // Ignites ahead of and beside us, so the motor doesn't light up mid-cockpit on frame one.
      m.live = true;
      const lr = s.heading * Math.PI / 180;
      m.x = F.pos.x + Math.sin(lr) * 0.06 + Math.cos(lr) * 0.03 * m.side;
      m.y = F.pos.y - Math.cos(lr) * 0.06 + Math.sin(lr) * 0.03 * m.side;
      m.alt = s.altitude - 3;
      m.hdg = s.heading + m.side * (5 + m.wander * 12);
      m.spd = Math.max(0.12, Math.abs(s.airspeed) * paceAt(s.altitude));
    }
    if (m.boomT) { if (now - m.boomT > 420) m.dead = true; }
    else {
      let tx = m.tgt.x, ty = m.tgt.y, talt = m.tgt.alt;
      if (m.tgt.id && F.contacts) {
        const c = F.contacts.find(k => k.id === m.tgt.id);
        if (c) { tx = c.x; ty = c.y; talt = c.alt || 0; }
      }
      const dx = tx - m.x, dy = ty - m.y, rng = Math.hypot(dx, dy);
      // Rate-limited turn plus a weave that decays over the flight.
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
// ── Flares ──────────────────────────────────────────────────────────────────────
// Visual only, on a server-confirmed `air_threat` 'flares'.
const FLARE_COUNT = 10;          // pellets per burst (a salvo of 5 a side)
const FLARE_LIFE_MS = 3200;      // burn time
const FLARE_TRAIL = 12;          // smoke-trail samples per pellet
function launchFlares(F, s) {
  if (!F.pos || !s) return;
  const now = performance.now(), hr = s.heading * Math.PI / 180;
  const pace = Math.max(0.05, Math.abs(s.airspeed) * paceAt(s.altitude));
  F.flares = F.flares || [];
  for (let i = 0; i < FLARE_COUNT; i++) {
    const side = i % 2 ? 1 : -1, k = Math.floor(i / 2);
    const out = 0.10 + Math.random() * 0.10, back = 0.04 + Math.random() * 0.08;
    F.flares.push({
      t0: now + k * 90,   // rippled out in pairs
      x: F.pos.x - Math.sin(hr) * 0.02, y: F.pos.y + Math.cos(hr) * 0.02, alt: s.altitude - 4,
      vx: Math.sin(hr) * (pace - back) + Math.cos(hr) * out * side,
      vy: -Math.cos(hr) * (pace - back) + Math.sin(hr) * out * side,
      vz: -20 - Math.random() * 40,   // ft/s, ejected downward
      seed: Math.random() * 100, trail: [],
    });
  }
}
function stepFlares(F, now, dt, s) {
  if (!F.flares || !F.flares.length || !F.pos) return null;
  const view = [], drag = Math.exp(-1.4 * dt);
  for (const f of F.flares) {
    if (now < f.t0) continue;
    const age = now - f.t0;
    if (age > FLARE_LIFE_MS) { f.dead = true; continue; }
    f.vx *= drag; f.vy *= drag;
    f.vz = f.vz * drag - 70 * dt;   // gravity, with drag capping the fall
    f.x += f.vx * dt; f.y += f.vy * dt; f.alt += f.vz * dt;
    f.trail.push([f.x, f.y, f.alt]);
    if (f.trail.length > FLARE_TRAIL) f.trail.shift();
    view.push({
      dx: f.x - F.pos.x, dy: f.y - F.pos.y, altDiff: f.alt - s.altitude,
      life: age / FLARE_LIFE_MS, seed: f.seed,
      trail: f.trail.map(p => [p[0] - F.pos.x, p[1] - F.pos.y, p[2] - s.altitude]),
    });
  }
  F.flares = F.flares.filter(f => !f.dead);
  return view.length ? view : null;
}
// ── Building collision (CFIT) ─────────────────────────────────────────────────
// Collides with the shape the renderer draws: buildingRoofFtAt answers in real feet per point from
// the captured segments. See docs/reference/building-shapes.md.
const CFIT_BOUNCE_KT = 18;    // at or below this a building contact bounces; above it, a write-off
const CFIT_SWEEP = 4;         // sub-samples along the frame's ground track (anti-tunnel for fast craft)

// This frame's path against the buildings it crosses: null, or { severe, roofFt }.
function buildingCollisionAt(F, s) {
  const map = F.map;
  if (!map || !map.length || s.onGround) return null;
  const R = (map.length - 1) / 2, mc = F.mapCenter || { x: 0, y: 0 };
  const prev = F.cfitPrev || { x: F.pos.x, y: F.pos.y };
  const hd = (s.heading || 0) * Math.PI / 180, sinh = Math.sin(hd), cosh = Math.cos(hd);
  // Cheap reject only; must stay generous enough never to reject a point the model occupies.
  const foot = MODEL_MAX_EXTENT * (RENDER_TUNE.bldgFoot || 1);
  let worst = null;
  for (let i = 1; i <= CFIT_SWEEP; i++) {
    const t = i / CFIT_SWEEP;
    const px = prev.x + (F.pos.x - prev.x) * t, py = prev.y + (F.pos.y - prev.y) * t;
    const wx = Math.round(px), wy = Math.round(py);   // one building per tile, at integer coords
    if (Math.abs(px - wx) > foot || Math.abs(py - wy) > foot) continue;
    const rx = Math.round(wx - mc.x + R), ry = Math.round(wy - mc.y + R);
    if (ry < 0 || ry >= map.length || rx < 0 || rx >= map[ry].length) continue;
    // Roof under this point, maxed with the Curtain so every rule below reaches the wall too.
    // ⚠ The Curtain is only ~27 ft in the altitude frame. That's correct: it stops flying through it, not over it.
    const roofFt = Math.max(buildingRoofFtAt(wx, wy, map[ry][rx], px, py),
                            curtainRoofFtAt(wx, wy, map[ry][rx], px, py));
    if (roofFt <= 0) continue;
    const dx = wx - px, dy = wy - py, f = dx * sinh - dy * cosh;
    // Only buildings inside the renderer's near/far window can hit you. ⚠ The tile you're over skips
    // that test (f passes through zero there); 0.62 is the renderer's own corner half-width.
    const overhead = Math.abs(dx) <= 0.62 && Math.abs(dy) <= 0.62;
    if (!overhead && (f <= VISIBLE_NEAR_F || f > VISIBLE_FAR_F)) continue;
    const pen = roofFt - s.altitude;   // >0 is contact
    if (pen > 0 && (!worst || pen > worst.pen)) worst = { pen, roofFt };
  }
  if (!worst) return null;
  // A speed rule on purpose, never depth: a slow nudge bounces, any real energy is a write-off.
  return { severe: s.airspeed > CFIT_BOUNCE_KT, roofFt: worst.roofFt };
}
// Render knobs on the ⚙ sliders; RENDER_TUNE is shared with windshield.js. For most toggles 0 is the old renderer.
const FSIM_TUNE = [
  ['worldPace', 'Ground speed', 0, 0.001, 0.00005],
  ['groundBoost', 'Ground boost', 1, 20, 0.5],
  ['groundDecay', 'Ground fade', 8, 200, 2],
  ['eh', 'Horizon compress', 0, 1, 0.01],
  ['climbLift', 'Climb lift', 0, 20, 0.5],
  ['tile', 'Floor tiles', 0.1, 3, 0.05],
  // Moon angular radius (deg). Real is 0.26; 3 ships so the phase reads.
  ['moonSize', 'Moon size', 1, 8, 0.25],
  ['pixel', 'Pixel size', 1, 10, 1],
  ['perfDS', 'Adaptive chunk', 0, 1, 1],   // 0 pins 'Pixel size' under load
  ['fog', 'Fog (N64)', 0, 1, 0.05],
  ['vlight', 'Vertex light', 0, 1.5, 0.05],
  // GLASS 2: city mass in WebGL2 under the canvas. 0 asks for no context; a throw sets it back to 0.
  ['gl', 'GLASS 2 (WebGL)', 0, 1, 1],
  // Adornments (masts, rails, dishes...) in the depth buffer; 0 paints them on the canvas, through walls.
  ['glDeco', 'GL adornments', 0, 1, 1],
  // Moving building parts (cranes, gantries, vats); 0 parks each at its home pose.
  ['motion', 'Moving parts', 0, 1, 1],
  // Scales the weather-integrated snow depth (SNOW_NOW); snowForce pins depth but still passes through this.
  ['glSnow', 'Snow cover', 0, 1, 0.05],
  // Wheel tracks in the snow: the stateful part, whose cost scales with nearby vehicles.
  ['glTracks', 'Wheel tracks', 0, 1, 1],
  // Near plane solved from the camera (1) or fixed at 0.06 tiles (0). Only matters for an eye under ~0.1 tile.
  ['nearFit', 'Fit near plane to seat', 0, 1, 1],
  // ── THE SEA ──────────────────────────────────────────────────────────────────────────────────
  // Facet normal and specular on water; 0 is the flat tint.
  ['glSeaLit', 'Lit water', 0, 1, 1],
  // Sea as a displaced mesh. ⚠ GLASS 2 only: with gl or glFloor at 0 the sea is flat regardless.
  ['glSwell', 'Sea as geometry', 0, 1, 1],
  // ⚠ -1 lets the weather drive it (JONSWAP, built up over minutes). 0..1 pins it: 0 a mirror, 1 Force 9.
  ['glSeaState', 'Sea state (-1 = weather)', -1, 1, 0.05],
  // Effective fetch (km); wave height goes as its square root.
  ['glSeaFetch', 'Fetch (km)', 2, 200, 1],
  // 1.0 is physical. ⚠ Capped at 2.2: past that the waves exceed Stokes breaking steepness and the mesh folds.
  ['glSeaGain', 'Wave height x', 0, 2.2, 0.05],
  ['glWakeAmp', 'Wake depth', 0, 0.2, 0.005],
  // Sea reflection on the road's 0..32 scale (32 is Fresnel).
  ['glSeaRefl', 'Sea reflections', 0, 32, 1],
  // Reflection offset by the wave normal, in pixels (the same normal the specular uses).
  ['glSeaReflBend', 'Reflection ripple', 0, 80, 1],
  // Rain only under cloud base and local cover. 0 is the mutation control the headless gate uses.
  ['rainGate', 'Rain under cloud only', 0, 1, 1],
  // Range (tiles) at which sign lettering decals are still emitted.
  ['signFar', 'Sign lettering range', 0, 24, 1],
  // MSAA is a creation attribute: changing it rebuilds the context (one hitch).
  ['glMsaa', 'GL antialias', 0, 1, 1],
  // FXAA smooths what MSAA misses (specular sparkle, lattice edges). Off: it softens sign lettering.
  ['glFxaa', 'FXAA', 0, 1, 1],
  // Sun depth-pass strength; ground hulls are the separate 'Shape shadows'.
  ['glShadow', 'Sun shadows', 0, 1, 0.05],
  ['glAO', 'Contact occlusion', 0, 1, 0.02],
  // ⚠ A frequency: higher means more, smaller pools.
  ['glPuddle', 'Puddle density', 0.6, 9, 0.05],
  // Puddles in the crown, gutter and ruts; 0 is isotropic noise.
  ['glPudRoad', 'Puddles follow the road', 0, 1, 0.05],
  // How much puddles grow over a storm; 0 fills them within seconds.
  ['glPondGrow', 'Puddles fill over time', 0, 1, 0.05],
  ['glMirrorMass', 'Buildings in water', 0, 1, 1],
  // Real sky in puddle reflections; 0 is one flat colour.
  ['glMirrorSky', 'Sky in water', 0, 1, 1],
  // Contrast under the reflection, not its strength.
  ['glWetDark', 'Wet road darkness', 0, 0.9, 0.01],
  ['glRipple', 'Puddle ripple', 0, 8, 0.1],
  // Lamps reflected in the water.
  ['glGlint', 'Puddle glint', 0, 160, 2],
  ['glGroundBias', 'Road depth bias', -64, 0, 1],
  ['glBeam', 'Headlight pool', 0, 0.6, 0.01],
  // How much of the screen-space headlight glare pool a wet road removes.
  ['hlWetPool', 'Glare off wet road', 0, 1, 0.05],
  ['glShip', 'Rig in the depth buffer', 0, 1, 1],
  ['glBay', 'Depot in the depth buffer', 0, 1, 1],
  // Geese and air contacts write depth, so the cloud deck sorts against them.
  ['glAirDepth', 'What flies in the depth buffer', 0, 1, 1],
  // Raymarched clouds: -1 auto (off for the session if frame time stays high), 0 cards, 1 forced.
  ['glCloudVol', 'Volumetric clouds (-1 auto)', -1, 1, 1],
  ['cloudVolRes', 'Cloud volume resolution', 0.125, 1, 0.125],
  ['cloudVolSteps', 'Cloud volume ray steps', 16, 128, 8],
  ['cloudVolTemporal', 'Cloud volume history blend', 0, 0.95, 0.05],
  ['cloudVolGlow', 'Cloud volume city underglow', 0, 2, 0.1],
  ['occlude', 'Occlusion cull', 0, 1, 1],
  ['shapeShadow', 'Shape shadows', 0, 1, 1],
  // Hero model's per-pixel shadow and lamp spill (model-raster.js), as strengths.
  ['modelShadow', 'Model shadow', 0, 1, 0.05],
  ['modelLights', 'Model lamps', 0, 1, 0.05],
  ['shapeWire', 'Shape wire', 0, 1, 1],
  ['lodAdorn', 'LOD lights', 0, 2, 1],
  ['lodNear', 'LOD start', 0, 40, 1],
  ['lodFar', 'LOD full', 4, 60, 1],
  ['wallLodPx', 'Wall LOD (px)', 0, 400, 10],
  ['decoFar', 'Deco distance', 0, 40, 1],
  ['shadowFar', 'Shadow distance', 0, 40, 1],
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
  ['geese', 'Geese', 0, 3, 0.1],
  ['chaseBack', 'Chase dist', 0.5, 5, 0.1],
  ['chaseUp', 'Chase height', 0, 2, 0.05],
  ['chaseSink', 'Sit height', -0.2, 0.5, 0.01],
];

// Flight-model knobs: mutate this plane's F.P for the session; step() reads it each frame.
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
// Decimals inferred from the slider step.
const decOf = (stp) => { const i = String(stp).indexOf('.'); return i < 0 ? 0 : String(stp).length - i - 1; };
const fmtStp = (v, stp) => (+v).toFixed(decOf(stp));

// Per-craft skin: body class `fsim-theme-<id>` plus the canvas accent. No entry is the default cabin.
const FSIM_SKIN = {
  mayfly: { id: 'mayfly', acc: '#5fe0e6', rgb: [95, 224, 230] },
  mule: { id: 'mule', acc: '#a874ff', rgb: [168, 116, 255] },
  leviathan: { id: 'leviathan', acc: '#3fd6c0', rgb: [63, 214, 192] },
  reaper: { id: 'reaper', acc: '#ff9a38', rgb: [255, 154, 56] },
  dragonfly: { id: 'dragonfly', acc: '#8fe36b', rgb: [143, 227, 107] },
  viper: { id: 'viper', acc: '#5fe6c0', rgb: [95, 230, 192] },
  drake: { id: 'drake', acc: '#e89a3a', rgb: [232, 154, 58] },
  grasshopper: { id: 'grasshopper', acc: '#9ad46a', rgb: [154, 212, 106] },
  locust: { id: 'locust', acc: '#ffd24a', rgb: [255, 210, 74] },
  // Magenta matches her tile crosshair.
  shrike: { id: 'shrike', acc: '#ff5cb0', rgb: [255, 92, 176] },
};

function ensureFlightSimStyles() {
  if (document.getElementById('fsim-styles')) return;
  const s = document.createElement('style'); s.id = 'fsim-styles';
  s.textContent = FSIM_CSS;
  document.head.appendChild(s);
}

// Default ram-horn yoke (Mule and fallback). The frame loop transforms it live.
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
// ⚠ Every control SVG keeps one contract for the frame loop: viewBox 0 0 100 74, id fsim-yoke-svg,
// #fsim-yoke-name, and the #fsim-yk-green / #fsim-yk-red LEDs filled from the shared gradients.
const YK_LED_DEFS = `
  <radialGradient id="ykgreen" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#9dffc8"/><stop offset="0.5" stop-color="#3ad07a"/><stop offset="1" stop-color="#0d3a22"/></radialGradient>
  <radialGradient id="ykblue" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#cfeeff"/><stop offset="0.5" stop-color="#3aa8e0"/><stop offset="1" stop-color="#0b2a3c"/></radialGradient>
  <radialGradient id="ykred" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffb6b8"/><stop offset="0.5" stop-color="#e0403a"/><stop offset="1" stop-color="#3a0d0d"/></radialGradient>`;

// MAYFLY: ultralight tube yoke.
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

// LEVIATHAN: An-124 ram's-horn wheel.
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

// REAPER: A-10 centre stick. Pivots low.
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

// DRAGONFLY: kit-heli cyclic. Pivots low.
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

// VIPER: attack-heli combat cyclic with the four SWARM pips.
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

// GRASSHOPPER: a Cub's bent-tube joystick.
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

// LOCUST: crop-duster's utility stick with the spray-boom toggle.
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

// Control art per craft type; anything unlisted gets the default wheel.
function yokeSvgFor(t) {
  return { mayfly: YOKE_MAYFLY, grasshopper: STICK_GRASSHOPPER, locust: STICK_LOCUST, leviathan: YOKE_LEVIATHAN, reaper: STICK_REAPER, shrike: STICK_REAPER, dragonfly: CYCLIC_DRAGONFLY, viper: CYCLIC_VIPER }[t] || YOKE_SVG;
}

// One pip per seat on the placard.
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

const smooth01 = (x) => { const t = clampNum(x, 0, 1); return t * t * (3 - 2 * t); };
// The Drake's feet tear off on the water and stay gone until a hangar refits them (the server persists it).
function drakeSnapFeet(F) {
  if (!F.dk || F.dk.feetGone) return;
  F.dk.feetGone = true;
  sendCmdSilent('flightevent footsnap');
  try { gearFx('splash'); } catch {}
  F.shake = Math.max(F.shake || 0, 14); F.hitFlashT = performance.now();
  if (F.toast) F.toast('⚠ THE FEET TORE OFF: she is on her hull');
}
// The sea under the Drake, gated as the water mesh gates it there, so a harbour is as calm as it's drawn.
function drakeSeaAmps(F) {
  const a = seaAmpsNow(), c = F.mapCenter || { x: 0, y: 0 };
  const g = hullSeaGains(F.pos.x - c.x, F.pos.y - c.y, c.x, c.y, a.roll, a.wind);
  return { roll: a.roll * g.swell, wind: a.wind * g.swell, chop: a.chop * g.chop };
}
// The Drake's shape on the wire (wings, rotor fold, ramp, gear, ski, 0..100, then boat). Empty for other aircraft.
function drakeSyncTail(F) {
  if (!F.dk) return '';
  const a = drakeAnim(F.dk), p = (x) => Math.round(clampNum(x, 0, 1) * 100);
  return ` ${p(a.wings)} ${p(a.rotorFold)} ${p(a.ramp)} ${p(F.gearRetract ? (F.gearAnim ?? 1) : 1)} ${p(a.ski || 0)} ${F.dk.onWater && (F.dk.boat || F.dk.submerged > 0) ? 1 : 0}`;   // ⚠ last field (boat) gates a dive in plugins/submersible
}
// Fields in range, or only the locked GPS destination. Bearing matches the server's bearingDeg.
function navFields(F) {
  const d = F.gpsDest;
  if (!d || F.apTargetId !== 'gps') return F.fields;
  const dx = d.gx - (F.pos?.x || 0), dy = d.gy - (F.pos?.y || 0);
  return [{ id: 'gps', name: d.name, gx: d.gx, gy: d.gy, dist: Math.round(Math.hypot(dx, dy)),
    bearing: Math.round(((Math.atan2(dx, -dy) * 180 / Math.PI) % 360 + 360) % 360) }];
}
// Feed for the Drake's GPS screen (interior-drake.js), relative tiles, nearest first and capped.
function drakeGps(F) {
  const px = F.pos?.x || 0, py = F.pos?.y || 0, near = (a) => a.sort((p, q) => p.d - q.d);
  const contacts = near((F.contacts || []).map((c) => ({ dx: (c.x ?? 0) - px, dy: (c.y ?? 0) - py, hdg: c.hdg || 0,
    ground: c.cls === 'truck' || !!c.onGround, d: Math.hypot((c.x ?? 0) - px, (c.y ?? 0) - py) }))).slice(0, 24);
  const fields = near((navFields(F) || []).filter((f) => f.gx != null).map((f) => ({ dx: f.gx - px, dy: f.gy - py, d: Math.hypot(f.gx - px, f.gy - py) }))).slice(0, 12);
  return { mode: F.dk?.gpsMode || 0, hdg: F.disp?.hdg || 0, contacts, fields, hull: F.hull ?? 100, surf: F.surfaces || null,
    ammo: F.gunRounds || 0, ammoCap: F.gunCap || 1, msl: F.msl || 0 };
}
// Dash compartments ease open/shut over ~0.6 s.
function dkEase(D, k) {
  const now = performance.now(), dt = Math.min(100, now - (D[k + 'T'] || now)), a = D[k + 'A'] || 0, to = D[k] ? 1 : 0;
  D[k + 'T'] = now;
  return (D[k + 'A'] = a + Math.sign(to - a) * Math.min(Math.abs(to - a), dt / 600));
}
// Wings sweep over the first 60% of conversion, the rotor folds over the last 60%. On the water
// the wings tuck in whatever the lever says. The wing brake scales by the spread so it can't fight a fold.
function drakeAnim(D) { const wings = smooth01(D.conv / 0.6) * (1 - smooth01(D.floatVis || 0)), ft = drakeFeetAnim(D); return { wings, rotorFold: Math.max(smooth01((D.conv - 0.4) / 0.6), smooth01(D.floatVis || 0)), ramp: D.ramp, boat: smooth01(D.floatVis || 0), ...ft, brake: ft.brake * wings }; }

export function openFlightSim(opts = {}) {
  closeFlightSim();
  closeCockpit();
  window.dispatchEvent(new Event('flightsim:open'));   // WASD walk mode disarms; those keys fly now
  suppressWeatherFx(true, 'cockpit');   // now, so rain never flashes over the cockpit on embark
  ensureWindshieldStyles(); ensureFlightSimStyles(); refreshAccent();
  const skin = FSIM_SKIN[opts.craftType] || null;
  if (skin) { ACCENT = skin.acc; ACCENT_RGB = skin.rgb; }
  const P = TYPES[opts.craftType] || TYPES.mayfly;
  const s = createState(P);
  s.heading = (((opts.heading || 0) % 360) + 360) % 360;

  const F = {
    P, s, cls: opts.craftClass || 'ultralight', livery: opts.livery || opts.craftLivery,
    aircraftId: opts.aircraftId || null,   // handed back in `flightresume` (resumeFlightAfterLogin)
    input: { elevator: 0, aileron: 0, throttle: 0, flaps: 0, pedal: 0, trim: 0 },
    // Heli: throttle is the collective, yoke the cyclic, pedals the tail rotor.
    heli: opts.craftClass === 'heli' || !!(TYPES[opts.craftType] && TYPES[opts.craftType].heli),
    yachtDeparted: true,   // a set-down on the Echelon disarms auto-land until you leave her
    pedalKey: 0,
    pos: { x: opts.gx || 0, y: opts.gy || 0 },
    home: { x: opts.gx || 0, y: opts.gy || 0 },   // the HOME marker's target
    mapCenter: { x: Math.round(opts.gx || 0), y: Math.round(opts.gy || 0) },
    rollDist: 0, travel: 0,
    // Departure runway: the server's pose from the centreline tiles, else the parked spot and heading.
    rwOrigin: { x: opts.runway?.ox ?? opts.gx ?? 0, y: opts.runway?.oy ?? opts.gy ?? 0 },
    rwHdg: opts.runway ? opts.runway.hdg : ((((opts.heading || 0) % 360) + 360) % 360),
    rwLen: opts.runway?.len || null,
    airport: opts.airport || 'default',
    helipad: !!opts.helipad,
    reg: opts.registration || (opts.deviceName || 'MAYFLY').toUpperCase(), owner: opts.owner || 'RENTED', rented: !!opts.rented,
    fuel: opts.fuel ?? 100, fuelCap: opts.fuelCap || 100, warn: null,
    map: opts.map || null, sky: opts.sky || { hour: 12, weather: 'clear', wind: 0 }, biomeBelow: opts.biomeBelow ?? null,
    minimap: opts.minimap || null, mfdMode: 'local', fields: opts.fields || [],
    checkride: opts.checkride || null, checkrideStage: null,
    tourStep: null, tourRenderedStep: null, tourDismissed: false,

    deadStick: false, reportedAirborne: false, rolling: false, stopHinted: false,
    engineOn: !!opts.engineOn, powered: !!opts.engineOn,   // master switch vs current on the busbars (derived per frame)
    yokeDrag: false, thrDrag: false,
    viewYaw: 0, throttleKey: 0, flapIdx: 0,
    gearRetract: !!opts.gearRetract, gearUp: false, gearAnim: 1, external: false, extZoom: 1, cargoKg: opts.cargoKg || 0,
    craftType: opts.craftType,
    // A convertible (the Drake): `conv` runs 0 (rotor) to 1 (wing); the flight model swaps at 0.5.
    dk: TYPES[opts.craftType]?.convert ? { conv: 0, wing: false, boat: false, ramp: 0, rampOpen: false, nv: false, quackT: -9, gunsArmed: false,
      rotorP: TYPES[opts.craftType], wingP: TYPES[TYPES[opts.craftType].convert] } : null,
    sprayer: !!opts.sprayer,
    hardpoints: opts.hardpoints || 0, armed: false,
    salvo: opts.salvo || 0,                          // >1: MSL fires a no-lock ripple
    bombs: 0, bombCap: 0,                            // counts arrive on flight_ctx
    bursts: [],                                      // live bomb explosions, world-anchored
    drops: [],                                       // bombs released and resolved but not yet arrived
    // An armed heli's gun is a single chin turret.
    chinGun: opts.craftClass === 'heli' && (opts.hardpoints || 0) > 0,
    gunMs: (opts.craftClass === 'heli' && (opts.hardpoints || 0) > 0) ? GUN_FIRE_MS_LIGHT : GUN_FIRE_MS,
    shots: [],                                       // missiles in the air (visual only)
    gunCap: 1174, gunRounds: 1174,                   // cosmetic ammo count
    nightLight: false, landingLight: false,          // PANEL and LIGHTS; both need engine power
    raf: 0, last: 0, syncAcc: 0, hornBeat: 0, audioAcc: 0,
    temp: 40, battery: 100,          // cosmetic
    engines: Math.max(1, opts.engines || 1), seats: Math.max(1, opts.seats || 1), occupants: opts.occupants || [],
    // Powerplant class picks the engine gauges' labels and scales.
    engStyle: { mule: 'turboprop', reaper: 'turbofan', leviathan: 'turbofan', shrike: 'turboprop', dragonfly: 'heli', viper: 'heli', drake: 'heli' }[opts.craftType] || 'piston',
    temps: [], rpms: [], engWander: 0,

    disp: { ias: 0, alt: 0, vs: 0, hdg: s.heading, rpm: 0, pitch: 0, bank: 0 },
    contacts: [],   // refreshed by flight_contacts
    gunSolution: null, firing: false, fireHeld: false, hull: 100, hitFlashT: 0,
    weapon: 'guns', msl: opts.hardpoints || 0, seekId: null, lockProg: 0, lockId: null, mslWarnT: 0,
    listeners: [],
  };
  // Parked on a rooftop pad: the ground is the roof (parkedDeck).
  const deck = parkedDeck(F);
  if (deck) {
    F.padDeck = deck;
    s.altitude = deck.ft; s.groundFt = deck.ft; s.onGround = true;
    F.disp.alt = deck.ft;
    // ⚠ Latched, or the climb-out is caught by this pad's own catch column and set back down.
    F.roofDeparted = false;
  }
  _fsim = F;
  // ⚠ Without pane:claimed a phone keeps the pane shut. See docs/reference/mobile-layout.md.
  document.body.classList.add('fsim-active');
  window.dispatchEvent(new Event('pane:claimed'));

  const flapStyle = flapStyleFor(opts.craftType);
  const isAdmin = ['admin', 'dev', 'builder', 'designer'].includes(state.myRole);
  const adminBtn = isAdmin ? '<button class="fsim-adminbtn" id="fsim-rewindbtn" title="ADMIN, rewind to the hangar you departed, with the plane (test)">⏪</button>' : '';
  // Rudder pedals: hold to yaw, as ,/. or X/C. The only rudder touch has. The frame loop tips them via --d.
  const PEDALS_HTML = `<div class="fsim-pedals" id="fsim-pedals">
      <button class="fsim-pedal fsim-pedal-l" id="fsim-pedal-l" title="left rudder / yaw (hold: comma, or X)" tabindex="-1" aria-label="left rudder"><span class="fsim-pedal-face"><span class="fsim-pedal-lbl">L</span></span></button>
      <button class="fsim-pedal fsim-pedal-r" id="fsim-pedal-r" title="right rudder / yaw (hold: full stop, or C)" tabindex="-1" aria-label="right rudder"><span class="fsim-pedal-face"><span class="fsim-pedal-lbl">R</span></span></button>
    </div>`;
  // The Drake's controls for the external view, where there's no cockpit to click.
  const DKX_HTML = `<div class="dkx" id="dkx" aria-label="Drake controls">
      <div class="dkx-strip">
        <button class="dkx-btn dkx-pwr" data-dk="power" title="power (engine master)" tabindex="-1">POWER</button>
        <button class="dkx-btn" data-dk="lights" title="exterior lights" tabindex="-1">LIGHTS</button>
        <button class="dkx-btn" data-dk="cabin" title="cabin light" tabindex="-1">CABIN</button>
        <button class="dkx-btn" data-dk="gear" title="gear (G)" tabindex="-1">GEAR</button>
      </div>
      <canvas class="dkx-wheel" id="dkx-wheel" width="260" height="140" title="yoke: drag left/right to bank, up/down to pitch"></canvas>
      <div class="dkx-strip">
        <button class="dkx-btn dkx-quack" data-dk="quack" title="quack (T)" tabindex="-1">QUACK</button>
        <button class="dkx-btn" data-dk="guns" title="guns master arm" tabindex="-1">GUNS</button>
        <button class="dkx-btn" data-dk="nv" title="night vision (N)" tabindex="-1">NV</button>
        <button class="dkx-btn" data-dk="mode0" title="mode: heli" tabindex="-1">HELI</button>
        <button class="dkx-btn dkx-wings" data-dk="mode1" title="mode: plane (K)" tabindex="-1">PLANE</button>
        <button class="dkx-btn" data-dk="mode2" title="mode: boat, on the water (L)" tabindex="-1">BOAT</button>
        <button class="dkx-btn" data-dk="mode3" title="mode: sub" tabindex="-1">SUB</button>
      </div>
      <div class="dkx-levers"><div class="dkx-thr" id="dkx-thr" title="throttle: drag up for more"><div class="dkx-thr-slot"></div><div class="dkx-thr-knob" id="dkx-thr-knob"></div><span class="dkx-thr-lbl">THR</span></div>
      <div class="dkx-trim" id="dkx-trim" title="trim: drag up for nose down, down for nose up"><span class="dkx-trim-val" id="dkx-trim-val">0</span><div class="dkx-trim-drum" id="dkx-trim-drum"><div class="dkx-trim-ridges" id="dkx-trim-ridges"></div></div><div class="dkx-trim-mark" id="dkx-trim-mark"></div><span class="dkx-thr-lbl">TRIM</span></div></div>
    </div>`;
  const html = `<div id="fsim-root" class="fsim${skin ? ' fsim-theme-' + skin.id : ''}${TYPES[opts.craftType]?.convert ? ' fsim-dkx' : ''}">
    <div class="fsim-view">${adminBtn}${windshieldHTML('fsim-ws', 'FWD VIEW · ' + esc((opts.deviceName || P.name).toUpperCase()))}<div class="fsim-lamp" id="fsim-lamp">⚠ STALL</div><div class="fsim-dive" id="fsim-dive" style="opacity:0"></div><div class="fsim-killfeed" id="fsim-killfeed"></div><div class="fsim-toast" id="fsim-toast"></div><div class="fsim-ckride" id="fsim-ckride"></div><div class="fsim-tour" id="fsim-tour"></div><div class="fsim-viewtag" id="fsim-viewtag"></div><div class="fsim-fuel" id="fsim-fuel"><span class="fsim-fuel-ic">⛽</span><span class="fsim-fuel-pct" id="fsim-fuel-pct">--%</span><button class="fsim-refuel" id="fsim-refuel" title="refuel at this field" tabindex="-1">REFUEL</button></div><div class="fsim-reticle" id="fsim-reticle"><svg viewBox="0 0 34 34"><circle cx="17" cy="17" r="12" fill="none" stroke="#ff6a3a" stroke-width="1"/><line x1="17" y1="1" x2="17" y2="7" stroke="#ff6a3a"/><line x1="17" y1="27" x2="17" y2="33" stroke="#ff6a3a"/><line x1="1" y1="17" x2="7" y2="17" stroke="#ff6a3a"/><line x1="27" y1="17" x2="33" y2="17" stroke="#ff6a3a"/><circle cx="17" cy="17" r="1.5" fill="#ff6a3a"/></svg></div><div class="fsim-weap" id="fsim-weap"><button class="fsim-weap-arm" id="fsim-arm" tabindex="-1">◈ SAFE</button><button class="fsim-weap-arm" id="fsim-wpn" tabindex="-1" title="weapon select, 1 guns / 2 missiles">GUN</button><button class="fsim-weap-fire" id="fsim-fire" tabindex="-1">FIRE</button><span class="fsim-weap-pips" id="fsim-weap-pips"></span><button class="fsim-weap-arm" id="fsim-flarebtn" tabindex="-1" title="countermeasures (X)">FLARE</button><button class="fsim-weap-arm" id="fsim-bombbtn" tabindex="-1" title="select the bomb rack (3), opens the dive sight" style="display:none">◎ BOMBS</button><button class="fsim-weap-arm" id="fsim-divebtn" tabindex="-1" title="dive computer (B), pushes over to the attack angle, then flies the pull-out at the release" style="display:none">⤵ DIVE</button></div><div class="fsim-spray-mist" id="fsim-spray"></div><div class="fsim-sprayrig" id="fsim-sprayrig" aria-hidden="true"><svg viewBox="0 0 200 96" preserveAspectRatio="xMidYMid meet"><line class="sr-boom" x1="14" y1="42" x2="186" y2="42"/><g class="sr-noz"><line x1="30" y1="42" x2="30" y2="47"/><line x1="54" y1="42" x2="54" y2="47"/><line x1="78" y1="42" x2="78" y2="47"/><line x1="122" y1="42" x2="122" y2="47"/><line x1="146" y1="42" x2="146" y2="47"/><line x1="170" y1="42" x2="170" y2="47"/></g><rect class="sr-hopper" x="80" y="16" width="40" height="26" rx="3"/><line class="sr-hatch" x1="86" y1="24" x2="114" y2="24"/><rect class="sr-door sr-door-l" x="80" y="42" width="20" height="6" rx="1.5"/><rect class="sr-door sr-door-r" x="100" y="42" width="20" height="6" rx="1.5"/><g class="sr-spray"><line class="sr-drop" x1="30" y1="48" x2="30" y2="58" style="animation-delay:.30s"/><line class="sr-drop" x1="54" y1="48" x2="54" y2="58" style="animation-delay:.42s"/><line class="sr-drop" x1="90" y1="50" x2="90" y2="60" style="animation-delay:.26s"/><line class="sr-drop" x1="100" y1="50" x2="100" y2="60" style="animation-delay:.36s"/><line class="sr-drop" x1="110" y1="50" x2="110" y2="60" style="animation-delay:.30s"/><line class="sr-drop" x1="122" y1="48" x2="122" y2="58" style="animation-delay:.46s"/><line class="sr-drop" x1="146" y1="48" x2="146" y2="58" style="animation-delay:.34s"/><line class="sr-drop" x1="170" y1="48" x2="170" y2="58" style="animation-delay:.40s"/></g></svg><span class="sr-tag">◊ BOOMS OPEN</span></div><button class="fsim-spraybtn" id="fsim-spraybtn" tabindex="-1" title="crop-duster, open the spray booms on a LOW pass" style="display:none">◊ SPRAY</button><button class="fsim-hopbtn" id="fsim-hopbtn" tabindex="-1" title="load the chemical hopper, pour a container in on the ground" style="display:none">⬗ HOPPER</button><div class="fsim-hop" id="fsim-hop"></div><button class="fsim-abortbtn" id="fsim-abortbtn" title="abort the flight, a recovery crew tows the aircraft back to a field and bills you">⤫ ABORT</button><button class="fsim-disembarkbtn" id="fsim-disembarkbtn" title="climb out of the aircraft (on the ground only)">⏏ DISEMBARK</button><button class="fsim-fsbtn" id="fsim-fsbtn" title="fullscreen">⛶</button><button class="fsim-bigbtn" id="fsim-bigbtn" title="${esc(BIGSCREEN_TITLE)}">${BIGSCREEN_GLYPH}</button><button class="fsim-viewbtn" id="fsim-viewbtn" title="external / cockpit view (V)">◎ EXT</button><button class="fsim-orbitreset" id="fsim-orbitreset" title="reset orbit camera to behind the craft">⟲</button><button class="fsim-glassbtn on" id="fsim-glassbtn" title="show / hide the 2-D instrument panel">▤</button><button class="fsim-hidebtn" id="fsim-hidebtn" title="hide the text panel, more outside view">⊟</button><button class="fsim-tunebtn" id="fsim-tunebtn" title="render tuning">⚙</button><div class="fsim-tune" id="fsim-tune" style="display:none"></div><div class="fsim-extg" id="fsim-extg"><div class="fsim-extg-row"><span class="fsim-extg-lbl">IAS</span><b id="fsim-extg-ias">0</b><span class="fsim-extg-u">kt</span></div><div class="fsim-extg-row"><span class="fsim-extg-lbl">ALT</span><b id="fsim-extg-alt">0</b><span class="fsim-extg-u">ft</span></div></div><div class="fsim-sub" id="fsim-sub" style="display:none"><div class="fsim-subgauge" aria-hidden="true"><div class="fsim-subscale" id="fsim-subscale"><div class="fsim-subrating" id="fsim-subrating"></div><div class="fsim-subfloor" id="fsim-subfloor"></div><div class="fsim-subnow" id="fsim-subnow"><span id="fsim-subnowtxt"></span></div></div><div class="fsim-subtanks" title="ballast"><div class="fsim-subtank"><div class="fsim-subfill" id="fsim-subfill-l"></div></div><div class="fsim-subtank"><div class="fsim-subfill" id="fsim-subfill-r"></div></div></div></div><div class="fsim-subcol"><button class="fsim-subbtn" id="fsim-subdive" tabindex="-1" title="flood the ballast and dive, or blow it and surface. Under water the stick flies the depth (PgDn / PgUp step it)">⬇ DIVE</button><span class="fsim-subbal" id="fsim-subbal"></span><span class="fsim-subread" id="fsim-subread"></span></div></div>${PEDALS_HTML}${TYPES[opts.craftType]?.convert ? DKX_HTML : ''}</div>
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
          <button class="fsim-nightsw" id="fsim-visorsw" title="CARGO NOSE, raise the visor to load. Only on the ground, and she won't roll with it open." tabindex="-1" style="display:none"><span class="fsim-nightsw-led"></span>NOSE</button>
          <div class="fsim-ft-row">
            ${buildFlapHtml(flapStyle)}
            <div class="fsim-trim" id="fsim-trim" title="ELEVATOR TRIM, drag or roll the wheel; up = NOSE DOWN, down = NOSE UP">
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

  // Yoke pad, inverted: drag down for nose up.
  const pad = q('#fsim-yoke');
  const padTo = (e) => { const r = pad.getBoundingClientRect(); F.input.aileron = clampNum(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1); F.input.elevator = clampNum(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1); };
  // ⚠ In the external view the pad sits over the pedals, so it hit-tests them and defers.
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

  const thr = q('#fsim-thr');
  const thrTo = (e) => { const r = thr.getBoundingClientRect(); F.input.throttle = clampNum(1 - (e.clientY - r.top) / r.height, 0, 1); };
  add(thr, 'pointerdown', (e) => { F.thrDrag = true; try { thr.setPointerCapture(e.pointerId); } catch {} thrTo(e); });
  add(thr, 'pointermove', (e) => { if (F.thrDrag) thrTo(e); });
  add(window, 'pointerup', () => { F.thrDrag = false; });

  // External view: middle-drag orbits the chase camera and it holds where left; ⟲ swings it back.
  const viewEl = q('.fsim-view');
  // ⚠ Bound before the yoke and orbit, on capture, so a detached camera takes the drag from the yoke.
  bindFreeCamPointer(viewEl, freeCam, { toggleKey: 'o', canToggle: () => !!F.external });
  // Listens on the window; closeFlightSim releases it.
  freeIdle?.unbind();
  freeIdle = bindFreeCamIdle(freeCam);
  // ⚠ The stick binds after the camera, on bubble, and is off while the free camera is out.
  stickUnbind?.();
  stickUnbind = bindMouseStick(viewEl, mouseStick, { enabled: () => !freeCam.active });
  if (viewEl) {
    let ox = 0, oy = 0;
    add(viewEl, 'pointerdown', (e) => {
      if (e.button !== 1 || !F.external) return;
      F.orbitDrag = true; ox = e.clientX; oy = e.clientY; e.preventDefault();
      try { viewEl.setPointerCapture(e.pointerId); } catch {}
    });
    add(window, 'pointermove', (e) => {
      if (!F.orbitDrag) return;
      F.orbitResetting = false;                                                        // a drag cancels a reset swing
      F.extOrbit = (F.extOrbit || 0) + (e.clientX - ox) * 0.4;                          // yaw (deg), unbounded
      F.extPitch = clampNum((F.extPitch ?? REST_PITCH) - (e.clientY - oy) * 0.006, -1.1, 1.15);   // rad; short of the poles so the model can't stretch into a spindle
      ox = e.clientX; oy = e.clientY;
    });
    // ── In the seat the middle button leans the head ──────────────────────────
    // A lean translates the eye (makeCam reads lookLean). ⚠ Absolute cursor position, never a delta.
    add(viewEl, 'pointerdown', (e) => {
      if (e.button !== 1 || F.external) return;
      // The look holds on release; the next middle press recentres and does nothing else.
      if (F.freeLook) {
        F.freeLook = false; F.look = { x: 0, y: 0 }; F.looking = false;
        e.preventDefault(); return;
      }
      F.freeLook = true;
      F.looking = true; leanFrom(e);
      try { viewEl.setPointerCapture(e.pointerId); } catch {}
      e.preventDefault();
    });
    function leanFrom(e) {
      const b = viewEl.getBoundingClientRect(); if (!b.width) return;
      F.look = F.look || { x: 0, y: 0 };
      F.look.x = clampNum(((e.clientX - b.left) / b.width - 0.5) * 2, -1, 1);
      F.look.y = clampNum(((e.clientY - b.top) / b.height - 0.5) * 2, -1, 1);
    }
    add(window, 'pointermove', (e) => { if (F.looking) leanFrom(e); });
    add(window, 'pointerup', (e) => { if (e.button === 1) { F.orbitDrag = false; F.looking = false; } });
    add(window, 'pointercancel', () => { F.looking = false; });
    add(viewEl, 'auxclick', (e) => { if (e.button === 1) e.preventDefault(); });   // no autoscroll
    // External-view wheel zoom on chaseBack.
    add(viewEl, 'wheel', (e) => {
      if (!F.external) return;
      e.preventDefault();
      // in as far as the renderer's standoff
      const lv = lastViewState(), lo = lv && lv.external && lv.chaseZoomFloor > 0 ? lv.chaseZoomFloor : 0.45;
      F.extZoom = clampNum((F.extZoom || 1) * (e.deltaY > 0 ? 1.1 : 0.9), lo, 2.4);
    }, { passive: false });
    // Touch: one finger orbits, two pinch. Not while the free camera is out.
    bindTouchGestures(viewEl, {
      enabled: () => F.external && !freeCam.active,
      drag: (dx, dy) => {
        F.orbitResetting = false;
        F.extOrbit = (F.extOrbit || 0) + dx * 0.4;
        F.extPitch = clampNum((F.extPitch ?? REST_PITCH) - dy * 0.006, -1.1, 1.15);
      },
      pinch: (f) => {
        const lv = lastViewState(), lo = lv && lv.external && lv.chaseZoomFloor > 0 ? lv.chaseZoomFloor : 0.45;
        F.extZoom = clampNum((F.extZoom || 1) / f, lo, 2.4);
      },
    });
  }

  // Registration placard.
  const regEl = q('#fsim-reg'), ownEl = q('#fsim-own'), ownNameEl = q('#fsim-own-name'), ownKEl = q('#fsim-own-k'), modelEl = q('#fsim-model');
  if (regEl) regEl.textContent = F.reg;
  const snEl = q('#fsim-plac-sn');
  if (snEl) snEl.textContent = 'S/N ' + String(F.reg || '—') + '·' + String(opts.craftType || '').replace(/^ac_/, '').slice(0, 4).toUpperCase();
  if (modelEl) modelEl.textContent = String(opts.deviceName || P.name || 'AIRCRAFT').toUpperCase();
  if (ownNameEl) ownNameEl.textContent = F.owner;
  if (ownKEl) ownKEl.textContent = F.rented ? 'OPER' : 'OWNER';
  if (ownEl) ownEl.classList.toggle('rented', F.rented);
  const yokeName = q('#fsim-yoke-name'); if (yokeName) yokeName.textContent = String(opts.deviceName || P.name || 'AIRCRAFT').toUpperCase();
  // Name plate takes the cabin colour, its lettering the exterior paint. Rentals keep the stock plate.
  if (F.livery) {
    const plate = q('#fsim-yoke-plate');
    if (plate && /^#[0-9a-fA-F]{6}$/.test(F.livery.cabin || '')) plate.setAttribute('fill', F.livery.cabin);
    const ink = legibleInk(F.livery.base);
    if (yokeName && ink) yokeName.style.fill = ink;
    // Dashboard surround retinted from the cabin colour.
    const cab = hex2rgb(F.livery.cabin);
    if (cab) {
      root.style.setProperty('--panel-hi', shadeRgb(cab, 1.5));
      root.style.setProperty('--panel-mid', shadeRgb(cab, 1.0));
      root.style.setProperty('--panel-lo', shadeRgb(cab, 0.55));
      root.style.setProperty('--panel-edge', mixRgb(cab, [255, 255, 255], 0.32));
      root.classList.add('fsim-painted');
    }
  }
  // Chrome accent (--cy) follows the livery, else the airframe's stock accent; never the UI --accent.
  const stockAcc = (skin && skin.acc) || themeFor(F.cls).acc;
  const chromeAcc = liveryAccent(F.livery, stockAcc);
  const chromeRgb = hex2rgb(chromeAcc);
  if (chromeRgb) { ACCENT = chromeAcc; ACCENT_RGB = chromeRgb; }
  root.style.setProperty('--cy', chromeAcc);                       // inline beats the .fsim-theme-* class
  // --cy-lit is the backlight: the stock accent, so night lighting stays bright on a muted paint job.
  const litRgb = hex2rgb(stockAcc) || chromeRgb;
  root.style.setProperty('--cy-lit', stockAcc);
  if (litRgb) root.style.setProperty('--cy-lit-dim', `rgba(${litRgb[0]},${litRgb[1]},${litRgb[2]},.24)`);
  // Floor sticks pivot at the boot, not the CSS default.
  const yokeSvgEl = q('#fsim-yoke-svg');
  if (yokeSvgEl && (opts.craftType === 'reaper' || opts.craftType === 'dragonfly' || opts.craftType === 'viper')) yokeSvgEl.style.transformOrigin = '50% 92%';
  renderSeats(F);

  // Flaps: drag or click the gate to the nearest detent.
  const flapTrack = q('#fsim-flapsw-track'), flapKnob = q('#fsim-flapsw-knob');
  if (flapStyle && flapTrack) {
    const detents = flapStyle.detents, n = detents.length;
    const flapLbls = root.querySelectorAll('.fsim-flap-scale span');
    const topFor = (i) => `${(4 + (i / (n - 1)) * 66).toFixed(1)}%`;   // leaves room for the lever at FULL
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
    F.input.flaps = 0; F._flapN = 0;
  }

  // Elevator trim, capped well short of full deflection so it assists rather than flies.
  const TRIM_STEP = 0.04, TRIM_MAX = 0.6;
  const trimEl = q('#fsim-trim'), trimWheel = q('#fsim-trim-wheel'), trimDrum = q('#fsim-trim-drum'), trimVal = q('#fsim-trim-val'), trimHandle = q('#fsim-trim-handle');
  const setTrim = (t) => {
    F.input.trim = clampNum(t, -TRIM_MAX, TRIM_MAX);
    const frac = (F.input.trim + TRIM_MAX) / (2 * TRIM_MAX);          // 0 nose down (top) .. 1 nose up (bottom)
    if (trimDrum) trimDrum.style.transform = `translateY(${F.input.trim / TRIM_MAX * 12}px)`;
    if (trimHandle) trimHandle.style.top = `${frac * 100}%`;
    if (trimVal) {
      const n = Math.round(F.input.trim / TRIM_MAX * 100);
      trimVal.textContent = n === 0 ? '0' : (n > 0 ? '+' : '−') + Math.abs(n);
      trimVal.classList.toggle('set', n !== 0);
    }
  };
  F.setTrim = setTrim; F.TRIM_MAX = TRIM_MAX;
  // Helis get cyclic trim too, so a forward cruise attitude holds hands-off.
  if (F.heli) {
    const nd = trimEl && trimEl.querySelector('.fsim-trim-nd'), nu = trimEl && trimEl.querySelector('.fsim-trim-nu');
    if (nd) nd.innerHTML = 'NOSE<br>FWD';
    if (nu) nu.innerHTML = 'NOSE<br>AFT';
    if (trimEl) trimEl.title = 'CYCLIC TRIM: drag or roll the wheel; up = NOSE FWD (cruise), down = NOSE AFT';
  }
  if (trimWheel) {
    add(trimWheel, 'wheel', (e) => { e.preventDefault(); setTrim(F.input.trim + (e.deltaY > 0 ? TRIM_STEP : -TRIM_STEP)); }, { passive: false });
    let dragY = null, dragBase = 0, moved = false;
    add(trimWheel, 'pointerdown', (e) => { trimWheel.setPointerCapture(e.pointerId); dragY = e.clientY; dragBase = F.input.trim; moved = false; });
    add(trimWheel, 'pointermove', (e) => { if (dragY == null) return; const dy = e.clientY - dragY; if (Math.abs(dy) > 3) moved = true; setTrim(dragBase + dy / 60 * TRIM_MAX); });    const endDrag = (e) => {
      if (dragY != null && !moved) { const r = trimWheel.getBoundingClientRect(); setTrim(F.input.trim + ((e.clientY - r.top) < r.height / 2 ? -TRIM_STEP : TRIM_STEP)); }      dragY = null;
    };
    add(trimWheel, 'pointerup', endDrag);
    add(trimWheel, 'pointercancel', () => { dragY = null; });
  }
  setTrim(0);

  const toastEl = q('#fsim-toast');
  const fsimToast = (txt) => {
    if (!toastEl) return;
    toastEl.textContent = txt; toastEl.classList.add('show');
    if (F.toastT) clearTimeout(F.toastT);
    F.toastT = setTimeout(() => toastEl.classList.remove('show'), 1100);
  };
  F.toast = fsimToast;
  if (F.checkride) renderCheckride(F, F.checkride);

  // ── Keyboard flight controls ────────────────────────────────────────────────
  const VIEW_TAG = { '-90': '◀ LEFT VIEW', '90': 'RIGHT VIEW ▶', '180': '▲ REAR VIEW' };
  const viewTagEl = q('#fsim-viewtag');
  const setView = (yaw) => {
    F.viewYaw = yaw;
    if (viewTagEl) { viewTagEl.textContent = VIEW_TAG[String(yaw)] || ''; viewTagEl.classList.toggle('show', yaw !== 0); }
    // Looking off the nose hides the forward panel.
    const hudRoot = document.getElementById('ck-hud-root');
    if (hudRoot) hudRoot.classList.toggle('ck-looking', yaw !== 0);
  };
  const stepFlap = (d) => { if (!F._flapN || !F._setFlap) return; const i = clampInt(F.flapIdx + d, 0, F._flapN - 1); if (i !== F.flapIdx) { F._setFlap(i); flapWhir(); } };
  const toggleGear = () => {
    if (!F.gearRetract) { fsimToast('FIXED GEAR'); return; }
    // ⚠ The Drake's gear can't reverse mid-cycle.
    if (F.dk && F.gearAnim > 0.01 && F.gearAnim < 0.99) { fsimToast('GEAR IN TRANSIT: wait for the lock'); return; }
    if (F.dk && F.dk.feetGone) { fsimToast('NO FEET: a hangar can fit new ones'); return; }
    F.gearUp = !F.gearUp;
    try { gearFx(F.dk ? (F.gearUp ? 'drakeUp' : 'drakeDown') : (F.gearUp ? 'retract' : 'extend')); } catch {}
    // Gear up on the ground drops her on her belly. ⚠ Not a Drake on the water: she floats on her hull.
    if (F.gearUp && F.s.onGround && !(F.dk && F.waterBelow)) {
      F.shake = 14;
      try { groundFx('touchdownHard'); } catch {}
      fsimToast('⚠ GEAR UP ON THE GROUND: she settles onto her belly');
      return;
    }
    fsimToast(F.gearUp ? 'GEAR UP' : 'GEAR DOWN');
  };
  // The canvas gear lever and flap gate call these; keep one implementation of each.
  F.toggleGear = toggleGear; F.stepFlap = stepFlap;
  // ── THE DRAKE'S SWITCHES ──────────────────────────────────────────────────
  // To wing needs 55 kt airborne; back to rotor needs under 150 kt. A conversion in progress can reverse.
  const drakeConvert = () => {
    const D = F.dk, ias = F.disp?.ias || 0;
    if (!D.wing && (F.s.onGround || ias < 55)) { fsimToast('CONVERSION: needs 55 kt and air under you'); return; }
    if (D.wing && ias > 150) { fsimToast('CONVERSION: slow below 150 kt to deploy the rotor'); return; }
    D.wing = !D.wing;
    if (D.wing) setTrim(0);
    try { gearFx('drakeConvert'); } catch {}
    fsimToast(D.wing ? '⇄ CONVERTING: WING' : '⇄ CONVERTING: ROTOR');
  };
  const drakeRamp = () => {
    const D = F.dk;
    if (!D.rampOpen && !F.s.onGround && (F.disp?.ias || 0) > 40) { fsimToast('RAMP: not above 40 kt'); return; }
    D.rampOpen = !D.rampOpen;
    try { gearFx('drakeRamp'); } catch {}
    fsimToast(D.rampOpen ? 'RAMP DOWN' : 'RAMP UP');
  };
  // Mode selector HELI/PLANE/BOAT/SUB. Only BOAT is stored; the rest derives from existing state.
  const drakeUnder = () => F.dk.submerged > 0 && !(F.dk.subBlowLocal ?? F.dk.subBlow ?? true);
  const drakeModeNow = () => drakeUnder() ? 3 : F.dk.boat ? 2 : (F.dk.conv || 0) >= 0.5 || F.dk.wing ? 1 : 0;
  F.drakeModeNow = drakeModeNow;
  const drakeDepthM = () => depthMAt(F.pos.x + 0.5, F.pos.y + 0.5);
  // Why a gate cannot be taken now, or '' when it can.
  const drakeModeBlock = (t) => {
    const D = F.dk, cur = drakeModeNow(), ias = F.disp?.ias || 0;
    const gearMoving = F.gearAnim > 0.01 && F.gearAnim < 0.99;
    if (t === cur) return '';
    if (t === 0) {
      if (cur === 3) return 'HELI: surface first (BOAT)';
      if (cur === 1 && ias > 150) return 'HELI: slow below 150 kt to deploy the rotor';
      return '';
    }
    if (t === 1) {
      if (cur >= 2) return 'PLANE: lift off in HELI first';
      if (F.s.onGround || ias < 55) return 'PLANE: needs 55 kt and air under you';
      return '';
    }
    if (t === 2) {
      if (cur === 3) return '';
      if (!D.onWater && !(F.waterBelow && !F.onYacht && ((F.s.altitude || 0) - (F.s.groundFt || 0)) < 6)) return 'BOAT: get down onto the water first, gear up';
      if (gearMoving) return 'BOAT: gear in transit, wait for the lock';
      return '';
    }
    if (cur !== 2) return 'SUB: switch to BOAT first';
    const d = drakeDepthM();
    if (d == null) return 'SUB: no depth reading';
    if (d < SUB_MIN_WATER_M) return `SUB: ${d.toFixed(1)} m under her, needs ${SUB_MIN_WATER_M} m`;
    return '';
  };
  F.drakeModeReady = (t) => !drakeModeBlock(t);
  const drakeMode = (t) => {
    const D = F.dk; if (!D) return;
    const cur = drakeModeNow();
    if (t === cur) { detentFx(1); return; }
    const why = drakeModeBlock(t);
    if (why) { fsimToast(why); return; }
    detentFx(Math.abs(t - cur));
    if (cur === 3) F.subSurface?.();
    if (t === 3) { if (!drakeUnder()) F.subToggle?.(); return; }
    if (t === 2) {
      // BOAT tucks the feet.
      if (F.gearRetract && !F.gearUp && !D.feetGone) { F.gearUp = true; try { gearFx('drakeUp'); } catch {} }
      D.boat = true; fsimToast('⚓ BOAT: feet up, tail rotor to the pusher'); return;
    }
    if (D.boat) { D.boat = false; if (t === 0) fsimToast('HELI: collective up to lift off the water'); }
    const wing = (D.conv || 0) >= 0.5 || !!D.wing;
    if ((t === 1) !== wing) drakeConvert();
    else if (t === 0) fsimToast('HELI: rotor lift');
  };
  // The quack lasts while held; the server hears one throttled `quack` per press.
  let quackEnd = null;
  const drakeQuackUp = () => { const e = quackEnd; quackEnd = null; if (F.dk) F.dk.quackHeld = false; e?.(); };
  const drakeQuackDown = () => {
    const D = F.dk; if (!D || quackEnd) return;
    D.quackHeld = true; D.quackT = performance.now();
    quackEnd = quackStart();
    if (D.quackT - (D.quackSentT ?? -1e9) >= 700) { D.quackSentT = D.quackT; sendCmdSilent('quack'); }
  };
  const drakeQuack = () => { drakeQuackDown(); drakeQuackUp(); };
  add(window, 'blur', drakeQuackUp);
  const jettison = () => {
    if (!F.cargoKg) { fsimToast('NO CARGO'); return; }
    F.cargoKg = 0; sendCmdSilent('jettison'); fsimToast('CARGO JETTISONED');
  };
  // Target guide over GPS pick, tablet waypoint, fields, landmarks and regions. Keyed by id to survive re-sorts.
  const targetList = () => [...(F.gpsDest ? [F.gpsDest] : []), ...(F.waypoint ? [F.waypoint] : []), ...(Array.isArray(F.fields) ? F.fields : []), ...(Array.isArray(F.landmarks) ? F.landmarks : []), ...(Array.isArray(F.regions) ? F.regions : [])];
  const cycleApTarget = (dir) => {
    const list = targetList();
    if (!list.length) { fsimToast('NO DESTINATIONS IN RANGE'); return; }
    F.apCleared = false;
    let i = list.findIndex((f) => f.id === F.apTargetId);
    i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    F.apTargetId = list[i].id;
    fsimToast(`◎ ${(list[i].name || 'FIELD').toUpperCase()} · ${list[i].dist}mi`);
  };
  // Cleared holds (no snap back to the nearest field) until a new target is picked.
  const clearApTarget = () => {
    // ⚠ A tile designation must be cleared on the server too, or the next push restores it.
    if (F.apTargetId === 'wp') { F.waypoint = null; F._wpKey = ''; sendCmdSilent('flightwaypoint clear'); }
    F.apTargetId = null; F.apCleared = true;
    const nmEl = document.getElementById('fsim-tgt-name');
    if (nmEl) nmEl.textContent = '—';
    fsimToast('◎ WAYPOINTS CLEARED');
  };
  // ── THE GPS PICKER ──────────────────────────────────────────────────────────
  // Regions nearest first, opening onto their airfields. A pick locks the guide to it alone. Any other
  // target choice moves apTargetId off 'gps' and the frame drops F.gpsDest. Directory fetched once per flight.
  let gpsEl = null, gpsOpenKey = null;
  const gpsClose = () => { gpsEl?.remove(); gpsEl = null; F.gpsRender = null; };
  F.gpsClose = gpsClose;
  const gpsDist = (p) => (p.gx == null ? null : Math.round(Math.hypot(p.gx - (F.pos?.x || 0), p.gy - (F.pos?.y || 0))));
  const gpsPick = (p) => {
    F.gpsDest = { id: 'gps', name: p.name, gx: p.gx, gy: p.gy };
    F.apTargetId = 'gps'; F.apCleared = false;
    fsimToast(`◈ GPS: ${String(p.name).toUpperCase()} · ${gpsDist(p)}`);
    gpsClose();
  };
  const gpsClear = () => {
    F.gpsDest = null;
    if (F.apTargetId === 'gps') F.apTargetId = null;
    fsimToast('◈ GPS CLEARED');
    gpsClose();
  };
  const gpsBtn = (cls, html, fn) => {
    const b = document.createElement('button');
    b.className = cls; b.tabIndex = -1; b.innerHTML = html;
    // No focus, or Space (fire) would press it again.
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', fn);
    return b;
  };
  const gpsEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const gpsRender = () => {
    if (!gpsEl) return;
    const body = gpsEl.querySelector('.fsim-gps-body'), cur = gpsEl.querySelector('.fsim-gps-cur');
    const locked = F.gpsDest && F.apTargetId === 'gps';
    cur.replaceChildren();
    if (locked) {
      const s = document.createElement('span');
      s.innerHTML = `TO <b>${gpsEsc(F.gpsDest.name)}</b> · ${gpsDist(F.gpsDest)}`;
      cur.append(s, gpsBtn('fsim-gps-clr', 'CLEAR', gpsClear));
    } else cur.textContent = 'Pick a destination. The guide shows it and nothing else.';
    body.replaceChildren();
    const note = (t) => { const d = document.createElement('div'); d.className = 'fsim-gps-note'; d.textContent = t; body.append(d); };
    if (!F.gpsDir) { note('ACQUIRING…'); return; }
    const far = (p) => gpsDist(p) ?? Infinity;
    const regs = F.gpsDir.filter((g) => g.gx != null || g.fields?.length).slice().sort((a, b) => far(a) - far(b));
    if (!regs.length) { note('NO CHARTS'); return; }
    if (gpsOpenKey == null) gpsOpenKey = regs[0].id ?? '_';
    for (const g of regs) {
      const key = g.id ?? '_', open = key === gpsOpenKey, n = g.fields?.length || 0;
      body.append(gpsBtn('fsim-gps-reg' + (open ? ' open' : ''),
        `<i>${open ? '▾' : '▸'}</i><span>${gpsEsc(g.name)}</span><em>${n} field${n === 1 ? '' : 's'}</em><b>${g.gx == null ? '' : gpsDist(g)}</b>`,
        () => { gpsOpenKey = open ? '' : key; gpsRender(); }));
      if (!open) continue;
      if (g.gx != null) body.append(gpsBtn('fsim-gps-f ctr', `<span>◎ ${gpsEsc(g.name)}</span><b>${gpsDist(g)}</b>`, () => gpsPick(g)));
      const fs = (g.fields || []).slice().sort((a, b) => far(a) - far(b));
      for (const f of fs) body.append(gpsBtn('fsim-gps-f', `<span>✈ ${gpsEsc(f.name)}${f.pad ? ' <em>PAD</em>' : ''}</span><b>${gpsDist(f)}</b>`, () => gpsPick(f)));
      if (!fs.length) note('No airfields here.');
    }
  };
  const gpsOpen = () => {
    if (gpsEl) { gpsClose(); return; }
    if (F.avionicsOut) { fsimToast('GPS: no signal while the boards reboot'); return; }
    if (!F.powered) { fsimToast(F.engineOn ? 'GPS: no power on the bus' : 'GPS: no power, start the engine first'); return; }
    mouseStick.setArmed(false);
    gpsEl = document.createElement('div');
    gpsEl.className = 'fsim-gps';
    gpsEl.innerHTML = '<div class="fsim-gps-hd"><b>GPS · DESTINATION</b></div><div class="fsim-gps-cur"></div><div class="fsim-gps-body"></div>';
    gpsEl.querySelector('.fsim-gps-hd').append(gpsBtn('fsim-gps-x', '✕', gpsClose));
    document.body.appendChild(gpsEl);
    F.gpsRender = gpsRender;
    gpsRender();
    if (!F.gpsDir) sendCmdSilent('flightgps');
  };
  let setExternal = () => {};   // assigned below
  let setWeapon = () => {};     // assigned below
  // ── THE AUTOMATIC DIVE ──────────────────────────────────────────────────────
  // Push-over, then pull-out at the release, written only to the elevator input.
  // ⚠ Any pilot stick input disengages it. See docs/systems-flight.md#the-shrikes-automatic-dive
  const DIVE_AUTO_DEG = 68;
  function toggleDiveAuto() {
    if (!F.bombCap) { fsimToast('◇ NO DIVE COMPUTER ON THIS AIRFRAME'); return; }
    if (F.diveAuto) { F.diveAuto = null; fsimToast('◇ DIVE COMPUTER OFF'); return; }
    if (!F.reportedAirborne) { fsimToast('◇ NOT FROM THE GROUND'); return; }
    F.diveAuto = 'push';
    fsimToast(`◈ DIVE COMPUTER: over the top to ${DIVE_AUTO_DEG}°, then it flies the pull-out`);
  }
  F.toggleDiveAuto = toggleDiveAuto;
  // Called by the frame loop before the model steps.
  F.flyDiveAuto = (s, input, dt) => {
    if (!F.diveAuto) return;
    if (!F.reportedAirborne || s.onGround) { F.diveAuto = null; return; }
    const down = -(s.pitch || 0);
    if (F.diveAuto === 'push') {
      // Gentle on the way over; a full-stick bunt throws the aircraft.
      const err = DIVE_AUTO_DEG - down;
      input.elevator = clampNum(-err / 42, -0.55, 0.35);
    } else {
      // Pull-out: eases off as the nose rises, lets go once climbing.
      input.elevator = clampNum(0.35 + down / 55, 0, 0.95);
      if (down < -4) { F.diveAuto = null; fsimToast('◇ RECOVERED'); }
    }
  };
  // ── UNDER THE WATER (plugins/submersible) ─────────────────────────────────
  // The server owns depth; every control is a typeable verb. PgDn/PgUp send one order after the key settles.
  const subOrder = (m) => {
    if (!F.dk) return;
    if (m <= 0) { sendCmdSilent('surface'); return; }
    sendCmdSilent('submerge ' + Math.round(m));
  };
  const subDepthKey = (dir) => {
    if (!F.dk) return;
    const base = F.dk.subWant ?? F.dk.submerged ?? 0;
    // Under, 1 m is the shallowest; only BOAT surfaces her.
    F.dk.subWant = Math.max(F.dk.submerged > 0 ? 1 : 0, Math.min(1200, base + dir * 3));
    fsimToast(F.dk.subWant > 0 ? '⬇ DEPTH ' + F.dk.subWant + ' m' : '⬆ SURFACE');
    clearTimeout(F.dk.subSendTimer);
    F.dk.subSendTimer = setTimeout(() => subOrder(F.dk.subWant), 350);
  };
  F.subDive = () => { if (!F.dk) return; if (F.dk.submerged > 0) subDepthKey(1); else { F.dk.subWant = 5; try { gearFx('flood'); } catch {} sendCmdSilent('submerge'); } };
  F.subSurface = () => { if (!F.dk) return; F.dk.subWant = 0; clearTimeout(F.dk.subSendTimer); if (F.dk.submerged > 0) { F.dk.subBlowLocal = true; try { gearFx('blow'); } catch {} } sendCmdSilent('surface'); };
  // The dive button: floods and dives, or re-floods during a blow. Depth between is on the stick.
  F.subToggle = () => {
    if (!F.dk) return;
    const under = F.dk.submerged > 0, blowing = F.dk.subBlowLocal ?? F.dk.subBlow ?? true;
    if (under && !blowing) { fsimToast('SUB: switch to BOAT to blow ballast and surface'); return; }
    if (!under && F.drakeModeReady && !F.drakeModeReady(3)) { fsimToast(F.dk.boat ? 'SUB: not deep enough to dive' : 'SUB: switch to BOAT first'); return; }
    F.dk.subBlowLocal = false;
    F.dk.subWant = Math.max(5, Math.round(F.dk.submerged || 0));
    try { gearFx('flood'); } catch {}
    // ⚠ The server dives only from BOAT, which it learns from flightsync, so the order rides the next sync.
    F.dk.subPending = under ? 'submerge ' + F.dk.subWant : 'submerge';
    F.dk.subAskAt = performance.now();
    F.syncAcc = 99;
  };
  const KEYS = new Set(['a', 'z', 'q', 'w', 'e', 's', 'y', 'h', 'f', 'g', 'j', 'v', 'x', 'c', '1', '2', '3', ' ', '[', ']', '\\', ',', '.', 'k', 'l', 'r', 't', 'i', 'n', 'b', 'p']);
  const onKeyDown = (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
    const k = (e.key || '').toLowerCase();
    if (k === 'escape' && gpsEl) { e.preventDefault(); gpsClose(); return; }
    // ── The free camera ─────────────────────────────────────────────────────
    // Ahead of the KEYS allowlist. Detaching releases stick and pedal keys, so the aircraft flies on.
    // ⚠ O needs the external view to enter and must never need it to leave, or a stuck camera eats the controls.
    if (k === 'o' && !e.repeat && (F.external || freeCam.active)) {
      e.preventDefault();
      const on = freeCam.toggle({ yaw: (F.hdg || 0) + (F.extOrbit || 0), z: 0.55 });
      // ⚠ Disarm the mouse stick too, or the frame loop keeps writing its last deflection.
      if (on) { F.throttleKey = 0; F.pedalKey = 0; F.firing = false; mouseStick.setArmed(false); }
      setFreeCamChrome(on);
      fsimToast(on ? '◎ FREE CAMERA: mouse looks, MMB orbit, LMB/RMB up-down, WASD move, U frees the mouse, O to stow' : '◎ CHASE CAMERA');
      return;
    }
    // M toggles the nav marks; works with the free camera out too.
    if (k === 'm' && !e.repeat) {
      e.preventDefault();
      fsimToast(navMarks() ? '◈ NAV MARKS ON' : '◈ NAV MARKS OFF');
      return;
    }
    if (freeCam.onKey(k, true)) { e.preventDefault(); return; }
    if (freeCam.active) return;   // detached: the airframe hears nothing
    // Mouse stick: after the free-camera check, since the camera owns the mouse while it's out.
    if (mouseStick.onKey(k, true, e.repeat)) { e.preventDefault(); return; }
    if ((k === 'pagedown' || k === 'pageup') && F.dk) { e.preventDefault(); subDepthKey(k === 'pagedown' ? 1 : -1); return; }
    if (!KEYS.has(k)) return;
    e.preventDefault();
    switch (k) {
      case 'a': F.throttleKey = 1; break;
      case 'z': F.throttleKey = -1; break;
      case 'q': setView(-90); break;
      case 'e': setView(90); break;
      case ',': case 'x': F.pedalKey = -1; break;   // rudder, held
      case '.': case 'c': F.pedalKey = 1; break;
      case 's': setView(180); break;
      case 'w': setView(0); break;
      case 'y': if (!e.repeat) stepFlap(1); break;
      case 'h': if (!e.repeat) stepFlap(-1); break;
      case 'g': if (!e.repeat) toggleGear(); break;
      // ⚠ I is the ignition on every aircraft: the 2-D rows (and ⏻) open folded.
      case 'i': if (!e.repeat) F.ckMaster?.(); break;
      // The Drake's own keys.
      case 'k': if (!e.repeat && F.dk) drakeConvert(); break;
      case 'l': if (!e.repeat && F.dk) drakeMode(2); break;   // BOAT
      case 'r': if (!e.repeat && F.dk) drakeRamp(); break;
      case 't': if (!e.repeat && F.dk) drakeQuackDown(); break;
      case 'n': if (!e.repeat && F.dk) { F.dk.nv = !F.dk.nv; fsimToast(F.dk.nv ? '◉ NIGHT VISION: centre screen' : '◉ NIGHT VISION OFF'); } break;
      case 'v': if (!e.repeat) setExternal(!F.external); break;
      case 'j': if (!e.repeat) jettison(); break;
      case 'f': if (!e.repeat && F.reportedAirborne) sendCmdSilent('flares'); break;   // server confirms via air_threat
      case '1': if (!e.repeat) setWeapon('guns'); break;
      case '2': if (!e.repeat) setWeapon('msl'); break;
      // ⚠ Gated: with 'bomb' selected the trigger skips the guns, so no rack would mean unarmed.
      case '3': if (!e.repeat) { if (F.bombCap > 0) setWeapon('bomb'); else fsimToast('◇ NO BOMB RACK ON THIS AIRFRAME'); } break;
      // B: the Drake's buoyancy control on the water, else the automatic dive.
      case 'b': if (!e.repeat) { if (F.dk && F.dk.onWater) { F.dk.stab = F.dk.stab === false; fsimToast(F.dk.stab ? '⚓ BUOYANCY CONTROL: trim tanks steadying her' : '⚓ BUOYANCY CONTROL OFF: riding the swell'); } else toggleDiveAuto(); } break;
      case '[': if (!e.repeat) cycleApTarget(-1); break;
      case ']': if (!e.repeat) cycleApTarget(1); break;
      case '\\': if (!e.repeat) clearApTarget(); break;
      case 'p': if (!e.repeat) gpsOpen(); break;
      case ' ': F.firing = true; break;   // held
    }
  };
  const onKeyUp = (e) => {
    const k = (e.key || '').toLowerCase();
    if (freeCam.onKey(k, false)) return;
    if (k === 'a' || k === 'z') F.throttleKey = 0;
    else if (k === ',' || k === '.' || k === 'x' || k === 'c') F.pedalKey = 0;   // release pedal → centres
    else if (k === 'q' || k === 'e' || k === 's') setView(0);      // release hold-to-look → forward
    else if (k === ' ') F.firing = false;                         // release trigger
    else if (k === 't') drakeQuackUp();                           // let go of the quack
  };
  add(window, 'keydown', onKeyDown);
  add(window, 'keyup', onKeyUp);

  // Engine master (off only when parked and stopped), PANEL and LIGHTS. Every light needs power.
  root.style.setProperty('--cy-dim', accA(0.16));
  const nightSw = q('#fsim-nightsw'), landSw = q('#fsim-landsw');
  // ⚠ Reads F.powered, never F.engineOn: the master isn't the only way power dies. The frame loop re-runs it.
  const syncLights = F.syncLights = () => {
    if (!F.powered) { F.nightLight = false; F.landingLight = false; F.domeLight = false; }
    nightSw.classList.toggle('on', F.nightLight);
    root.classList.toggle('fsim-nightlit', F.nightLight);
    nightSw.classList.toggle('nopwr', !F.powered);
    if (landSw) { landSw.classList.toggle('on', F.landingLight); landSw.classList.toggle('nopwr', !F.powered); }
  };

  // CARGO NOSE: opens the hold with engines live. Ground only; the thrust interlock still stops a taxi.
  const visorBtn = q('#fsim-visorsw');
  if (visorBtn) {
    if (F.hasVisor === undefined) F.hasVisor = !!visorSpecFor(F.cls);
    if (F.hasVisor) visorBtn.style.display = '';
    add(visorBtn, 'click', () => {
      if (!F.hasVisor) return;
      if (F.reportedAirborne || F.rolling) { if (F.toast) F.toast('NOSE: only on the ground, stopped.'); return; }
      F.visorWant = (F.visorWant ?? ((F.noseVisor ?? 0) > 0.5 ? 1 : 0)) > 0.5 ? 0 : 1;
      try { visorFx(F.visorWant ? 'open' : 'close'); } catch {}
      if (F.toast) F.toast(F.visorWant ? 'NOSE OPENING: cargo visor coming up.' : 'NOSE CLOSING: ~5s to the lock.');
    });
  }
  // ── Clicks on the canvas flight panel ──────────────────────────────────────
  // Hit-tests the rects the renderer recorded; never recompute the layout here.
  // ⚠ Capture phase (the camera drag is on the same element), and it only swallows a hit.
  // ⚠ The dash canvas is pointer-events:none and assumed to share the world canvas's box.
  {
    const wsEl = document.getElementById('fsim-ws');
    if (wsEl) wsEl.addEventListener('pointerdown', (e) => {
      // ⚠ Primary button only, or a middle-button lean throws switches.
      if (e.button !== 0) return;
      if (F.external || F.viewYaw) return;
      const rects = panelControlRects();
      if (!rects || !rects.length) return;
      const b = wsEl.getBoundingClientRect();
      if (!b.width || !b.height) return;
      const px = e.clientX - b.left, py = e.clientY - b.top;
      const hit = rects.find((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
      if (!hit) return;
      switch (hit.key) {
        case 'bat': case 'alt': F.toggleMaster(); break;
        case 'land': F.toggleLand(); break;
        case 'panel': F.toggleNight(); break;
        case 'gear': F.toggleGear(); break;
        // The half you press is the direction: top toward UP, bottom toward FULL.
        case 'flaps': F.stepFlap(py < hit.y + hit.h * 0.5 ? -1 : 1); break;
        default: return;
      }
      e.preventDefault(); e.stopPropagation();
    }, true);
  }
  const engBtn = q('#fsim-eng');
  if (F.engineOn) engBtn.classList.add('on');
  add(engBtn, 'click', () => {
    if (!F.engineOn) {
      F.engineOn = true; engBtn.classList.add('on');
      F.engStartT = performance.now();
      // Start at idle so the engine never surges the plane forward.
      F.input.throttle = 0; F.throttleKey = 0;
      try { spoolUp(F.cls); } catch {}
      // The visor closes on start-up; tell the pilot, since she won't taxi until it locks.
      if (F.hasVisor && F.noseVisor > 0.02) {
        try { visorFx('close'); } catch {}
        if (F.toast) F.toast('NOSE OPEN: cargo visor lowering, ~5s. No taxi until it locks.');
      }
      sendCmdSilent('flightevent engineon');
      syncLights();
    } else if (s.onGround && s.airspeed < 5) {
      if (F.rolling && !F.heli) { finishLanding(F, s); return; }   // park
      F.engineOn = false; engBtn.classList.remove('on');
      try { spoolDown(F.cls); } catch {}
      if (F.hasVisor) { try { visorFx('open'); } catch {} }
      sendCmdSilent('flightevent engineoff');
      syncLights();
      // A helicopter never auto-parks on shutdown; `disembark` is the way out.
      if (F.heli && F.rolling) { F.rolling = false; if (F.toast) F.toast('SHUT DOWN: type disembark to climb out'); }
    }
  });

  // On F so the canvas panel and 3-D cockpits share one implementation.
  F.toggleNight = () => { if (!F.powered) return; F.nightLight = !F.nightLight; syncLights(); };
  F.toggleLand = () => { if (!F.powered) return; F.landingLight = !F.landingLight; syncLights(); };
  add(nightSw, 'click', () => F.toggleNight());
  add(landSw, 'click', () => F.toggleLand());
  // ⚠ Routes to the button's click; never reimplement the start sequence.
  F.toggleMaster = () => { try { engBtn.click(); } catch (e) {} };
  syncLights();

  // Weapons: master arm, select and fire.
  const weapEl = q('#fsim-weap'), reticleEl = q('#fsim-reticle');
  const armBtn = q('#fsim-arm'), fireBtn = q('#fsim-fire'), pipsEl = q('#fsim-weap-pips');
  const wpnBtn = q('#fsim-wpn'), flareBtn = q('#fsim-flarebtn');
  const paintPips = () => {
    if (!pipsEl) return;
    pipsEl.textContent = F.weapon === 'bomb' ? (F.bombs > 0 ? '●'.repeat(F.bombs) : '—')
      : F.weapon === 'msl' ? (F.msl > 0 ? '▲'.repeat(F.msl) : '—') : '◆'.repeat(F.hardpoints);
  };
  F.paintPips = paintPips;   // flight_ctx repaints
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
    setWeapon = (w) => {
      if (w === F.weapon) return;
      F.weapon = w;
      if (wpnBtn) { wpnBtn.textContent = w === 'bomb' ? 'BMB' : w === 'msl' ? 'MSL' : 'GUN'; wpnBtn.classList.toggle('hot', w !== 'guns'); }
      paintPips();
      fsimToast(w === 'bomb' ? `● BOMBS · ${F.bombs} ON THE RACK` : w === 'msl' ? `▲ MISSILES · ${F.msl} ON THE RAILS` : '◆ GUNS');
    };
    // Cycles through whatever this airframe carries.
    add(wpnBtn, 'click', () => {
      const ring = ['guns', ...(F.bombCap > 0 ? ['bomb'] : []), ...(F.msl > 0 || F.salvo > 1 ? ['msl'] : [])];
      setWeapon(ring[(ring.indexOf(F.weapon) + 1) % ring.length] || 'guns');
    });
    add(flareBtn, 'click', () => { if (F.reportedAirborne) sendCmdSilent('flares'); });
    // BOMBS and DIVE buttons; hidden without a rack (revealBombKit).
    add(q('#fsim-bombbtn'), 'click', () => setWeapon('bomb'));
    add(q('#fsim-divebtn'), 'click', () => toggleDiveAuto());
    add(q('#fsim-subdive'), 'click', () => F.subToggle?.());
    // FIRE is held; the frame loop fires while down.
    const holdFire = (on) => (e) => { if (e) e.preventDefault(); F.firing = on; };
    if (fireBtn) {
      add(fireBtn, 'pointerdown', holdFire(true));
      add(window, 'pointerup', holdFire(false));
      add(fireBtn, 'pointerleave', holdFire(false));
    }
  }

  // SPRAY: the server gates it to a low pass and rate-limits.
  const sprayBtn = q('#fsim-spraybtn'), sprayMist = q('#fsim-spray'), sprayRig = q('#fsim-sprayrig');
  if (F.sprayer && sprayBtn) {
    sprayBtn.style.display = '';
    const pulse = (el, ms) => { if (!el) return; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); setTimeout(() => el.classList.remove('on'), ms); };
    const doSpray = () => {
      if (!F.reportedAirborne) { fsimToast('◊ AIRBORNE + LOW TO DUST'); return; }
      sendCmdSilent('spray');
      F.sprayT = performance.now();     // interior-locust.js's valve handle rides this
      fsimToast('◊ CROP-DUSTING');
      spraySfx();
      pulse(sprayMist, 1700);
      pulse(sprayRig, 1900);
    };
    add(sprayBtn, 'click', doSpray);
  }

  // HOPPER only asks (`hopperbay`); flightSimHopper's rows send `loadhopper with <name>`. Legality is the server's.
  const hopBtn = q('#fsim-hopbtn');
  if (F.sprayer && hopBtn) {
    hopBtn.style.display = '';
    add(hopBtn, 'click', () => {
      const card = document.getElementById('fsim-hop');
      if (card && card.classList.contains('on')) { card.classList.remove('on'); return; }
      sendCmdSilent('hopperbay');
    });
  }

  const mfdTog = q('#fsim-mfd-tog'), mfdLbl = q('#fsim-mfd-lbl');
  add(mfdTog, 'click', () => {
    F.mfdMode = F.mfdMode === 'local' ? 'nav' : 'local';
    if (mfdLbl) mfdLbl.textContent = F.mfdMode === 'local' ? 'LOCAL' : 'NAV';
    if (mfdTog) mfdTog.textContent = F.mfdMode === 'local' ? 'NAV ▸' : '◂ LOCAL';
  });

  // Tuning sliders (⚙).
  const tuneBtn = q('#fsim-tunebtn'), tunePanel = q('#fsim-tune');
  const physRow = ([k, lbl, lo, hi, stp]) =>
    `<div class="trow"><label>${lbl}</label><input type="range" data-pk="${k}" min="${lo}" max="${hi}" step="${stp}" value="${F.P[k]}"><span class="tv" id="fsim-pv-${k}">${fmtStp(F.P[k], stp)}</span></div>`;
  const rndRow = ([k, lbl, lo, hi, stp]) =>
    `<div class="trow"><label>${lbl}</label><input type="range" data-k="${k}" min="${lo}" max="${hi}" step="${stp}" value="${RENDER_TUNE[k]}"><span class="tv" id="fsim-tv-${k}">${fmtStp(RENDER_TUNE[k], stp)}</span></div>`;
  const VLIGHT_COLORS = [
    ['vlKeyDay', 'Key · day'], ['vlKeyNight', 'Key · night'],
    ['vlSkyDay', 'Sky · day'], ['vlSkyNight', 'Sky · night'],
    ['vlShadowDay', 'Shadow · day'], ['vlShadowNight', 'Shadow · night'],
  ];
  const colRow = ([k, lbl]) =>
    `<div class="trow"><label>${lbl}</label><input type="color" data-ck="${k}" value="${RENDER_TUNE[k]}"><span class="tv"></span></div>`;
  const stkRow = ([k, lbl, lo, hi, stp]) =>
    `<div class="trow"><label>${lbl}</label><input type="range" data-sk="${k}" min="${lo}" max="${hi}" step="${stp}" value="${MOUSE_STICK[k]}"><span class="tv" id="fsim-sv-${k}">${fmtStp(MOUSE_STICK[k], stp)}</span></div>`;
  // Collapsible sections, remembered across flights.
  const SEC_LS = 'fsimTuneSections';
  let secOpen = {};
  try { secOpen = JSON.parse(localStorage.getItem(SEC_LS) || '{}') || {}; } catch { secOpen = {}; }
  const isOpen = (id, dflt) => (typeof secOpen[id] === 'boolean' ? secOpen[id] : dflt);
  const section = (id, title, rows, dflt) => {
    const open = isOpen(id, dflt), cl = open ? '' : ' collapsed';
    return `<div class="thdr${cl}" data-sec="${id}"><span class="car">▼</span><span>${title}</span><span class="cnt">${rows.length}</span></div>`
      + `<div class="tsec${cl}" data-secbody="${id}">${rows.join('')}</div>`;
  };
  tunePanel.innerHTML =
    `<div class="fsim-tune-drag" id="fsim-tune-drag">⠿ TUNING: drag to move · edge to resize</div>` +
    section('phys', `✈ ${esc(F.P.name || 'AIRCRAFT')} · FEEL`, PHYS_TUNE.map(physRow), false) +
    section('stick', '✋ MOUSE STICK', STICK_TUNE.map(stkRow), false) +
    section('world', '▦ WORLD RENDER', FSIM_TUNE.map(rndRow), true) +
    section('vlight', '◧ VERTEX LIGHT COLOURS', VLIGHT_COLORS.map(colRow), false);
  tunePanel.querySelectorAll('.thdr[data-sec]').forEach((h) => add(h, 'click', () => {
    const id = h.dataset.sec, body = tunePanel.querySelector(`[data-secbody="${id}"]`);
    const nowOpen = h.classList.contains('collapsed');
    h.classList.toggle('collapsed', !nowOpen); if (body) body.classList.toggle('collapsed', !nowOpen);
    secOpen[id] = nowOpen;
    try { localStorage.setItem(SEC_LS, JSON.stringify(secOpen)); } catch { /* private mode: still folds */ }
  }));
  // Drag by the header; switches to left/top positioning on first grab.
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
  tunePanel.querySelectorAll('input[data-sk]').forEach((inp) => add(inp, 'input', () => {
    const k = inp.dataset.sk; MOUSE_STICK[k] = parseFloat(inp.value);
    const tv = document.getElementById('fsim-sv-' + k); if (tv) tv.textContent = fmtStp(MOUSE_STICK[k], inp.step);
    // Turning the scheme off must disarm the stick too.
    if (k === 'mode' && MOUSE_STICK.mode === 0) mouseStick.setArmed(false);
  }));
  add(tuneBtn, 'click', () => { tunePanel.style.display = tunePanel.style.display === 'none' ? 'block' : 'none'; });

  // Admin rewind to the departure hangar (test tool).
  const rewindBtn = q('#fsim-rewindbtn');
  if (rewindBtn) add(rewindBtn, 'click', () => {
    sendCmdSilent('airhome');
    fsimToast('⏪ REWIND: back to the hangar');
    setTimeout(() => { closeFlightSim(); sendCmdSilent('hangar'); }, 450);
  });

  // Abort: a billed recovery tow. Two taps, so a stray click costs nothing.
  const abortBtn = q('#fsim-abortbtn');
  let abortArm = 0;
  add(abortBtn, 'click', () => {
    if (F.last - abortArm > 3000) {
      abortArm = F.last;
      abortBtn?.classList.add('armed');
      fsimToast('⤫ ABORT?: tap again to bail (aircraft recovered at cost)');
      setTimeout(() => abortBtn?.classList.remove('armed'), 3000);
      return;
    }
    abortArm = 0;
    abortBtn?.classList.remove('armed');
    sendCmdSilent('flightevent abort');
    fsimToast('⤫ ABORTING: recovery crew inbound');
    setTimeout(() => { closeFlightSim(); sendCmdSilent('look'); }, 600);
  });

  // Disembark; the frame loop shows it only on the ground.
  const disembarkBtn = q('#fsim-disembarkbtn');
  add(disembarkBtn, 'click', () => {
    sendCmdSilent('disembark');
    fsimToast('⏏ CLIMBING OUT…');
    setTimeout(() => { closeFlightSim(); sendCmdSilent('look'); }, 400);
  });

  const fsBtn = q('#fsim-fsbtn');
  add(fsBtn, 'click', () => {
    const on = document.body.classList.toggle('fsim-fullscreen');
    if (fsBtn) fsBtn.classList.toggle('on', on);
    if (on) { document.body.classList.remove('fsim-hidepanel'); q('#fsim-hidebtn')?.classList.remove('on'); }
  });

  // bigscreen.js owns the state; Esc and the browser can leave it without this button.
  bindBigScreenButton(q('#fsim-bigbtn'));

  const hideBtn = q('#fsim-hidebtn');
  add(hideBtn, 'click', () => {
    const on = document.body.classList.toggle('fsim-hidepanel');
    if (hideBtn) hideBtn.classList.toggle('on', on);
    if (on) { document.body.classList.remove('fsim-fullscreen'); fsBtn?.classList.remove('on'); }
  });
  // Folded by default on a phone.
  seatHidePanel('fsim-hidepanel', hideBtn);

  // The 2-D instrument rows. Folded by default, so the seat opens with the view filling the pane.
  const glassBtn = q('#fsim-glassbtn');
  document.body.classList.add('fsim-noglass');
  add(glassBtn, 'click', () => {
    const hidden = document.body.classList.toggle('fsim-noglass');
    glassBtn?.classList.toggle('on', hidden);
  });

  // ── 3-D cockpit clicks and the Drake's external overlay ──
  // One action table, each calling the existing key/panel action. ⚠ Serves every 3-D cockpit:
  // the Drake's ids, and kit cockpits' 'ck:*' switches (interior-cockpit-kit.js).
  {
    F.toggleDome = () => { if (!F.powered) return; F.domeLight = !F.domeLight; F.syncLights?.(); };
    const ckFlap = () => { const before = F.input.flaps; F.stepFlap?.(1); if (F.input.flaps === before) F.stepFlap?.(-9); };
    // ⚠ A refusing control must toast why, or it reads as broken.
    const ckMaster = () => {
      if (F.engineOn && !(s.onGround && s.airspeed < 5)) { fsimToast('ENGINE: shut down on the ground, stopped'); return; }
      q('#fsim-eng')?.click();
    };
    const needsPower = (fn) => () => {
      if (!F.powered) { fsimToast(F.engineOn ? 'NO POWER: nothing on the bus' : 'NO POWER: start the engine first'); return; }
      fn();
    };
    F.ckMaster = ckMaster;   // the I key
    const DK_ACT = {
      'ck:master': ckMaster,
      'ck:land': needsPower(() => F.toggleLand?.()), 'ck:taxi': needsPower(() => F.toggleLand?.()),
      'ck:panel': needsPower(() => F.toggleNight?.()),
      'ck:dome': needsPower(() => F.toggleDome()),
      'ck:flaps': () => ckFlap(),
      'ck:gear': () => toggleGear(),
      'ck:arm': () => q('#fsim-arm')?.click(),
      'ck:gps': () => gpsOpen(),
      power: ckMaster,
      lights: () => F.toggleLand?.(),
      cabin: () => F.toggleDome(),
      gear: () => toggleGear(),
      quack: () => drakeQuack(),
      guns: () => q('#fsim-arm')?.click(),
      gps: () => { F.dk.gpsMode = ((F.dk.gpsMode || 0) + 1) % 4; fsimToast('◈ ' + ['MAP', 'RADAR', 'DAMAGE', 'AMMO'][F.dk.gpsMode]); },
      // The GPS bezel's four tabs, one per mode (interior-drake.js GPS_TAB_NAMES).
      gps0: () => { F.dk.gpsMode = 0; }, gps1: () => { F.dk.gpsMode = 1; }, gps2: () => { F.dk.gpsMode = 2; }, gps3: () => { F.dk.gpsMode = 3; },
      conv: () => { const P = DRAKE_CONV_STEPS, i = P.findIndex((x) => x > drakeConv() + 1e-6); setDrakeConv(P[i < 0 ? 0 : i]); fsimToast('◎ GUNS CONVERGE AT ' + drakeConv().toFixed(1)); },
      nv: () => { F.dk.nv = !F.dk.nv; fsimToast(F.dk.nv ? '◉ NIGHT VISION: centre screen' : '◉ NIGHT VISION OFF'); },
      wings: () => drakeConvert(),
      convlever: () => drakeConvert(),
      mode0: () => drakeMode(0), mode1: () => drakeMode(1), mode2: () => drakeMode(2), mode3: () => drakeMode(3),
      modelever: () => drakeMode((drakeModeNow() + 1) % 4),
      boatlever: () => drakeMode(2), sublever: () => drakeMode(3),
      lean: () => drakeMode(2),
      ramp: () => drakeRamp(),
      dive: () => F.subToggle?.(),
      // Dash compartments: the container panel's close/fold events shut the door (drake-store-close/open).
      // Bucket: click drinks, shift-click pours for everyone aboard.
      bucket: (e) => sendCmd(e?.shiftKey ? 'champagne pour' : 'champagne drink'),
      pantry: () => { F.dk.pantry = !F.dk.pantry; if (F.dk.pantry) sendCmdSilent('pantry view'); },
      locker: () => { F.dk.locker = !F.dk.locker; if (F.dk.locker) sendCmdSilent('locker view'); },
    };
    if (!window.__drakeStoreClose) {
      window.__drakeStoreClose = true;
      window.addEventListener('drake-store-close', (e) => { const G = _fsim; if (G?.dk && (e.detail === 'pantry' || e.detail === 'locker')) G.dk[e.detail] = false; });
      window.addEventListener('drake-store-open', (e) => { const G = _fsim; if (G?.dk && (e.detail === 'pantry' || e.detail === 'locker')) G.dk[e.detail] = true; });
    }
    const clamp1 = (x) => clampNum(x, -1, 1);
    let dkDrag = null;   // { kind, x0, y0, rect, a0, e0, t0 }
    const dragMove = (e) => {
      if (!dkDrag) return;
      const dx = e.clientX - dkDrag.x0, dy = e.clientY - dkDrag.y0;
      if (dkDrag.kind === 'yoke') { F.input.aileron = clamp1(dx / dkDrag.span); F.input.elevator = clamp1(dy / (dkDrag.span * 0.7)); }
      else if (dkDrag.kind === 'throttle') F.input.throttle = clampNum(dkDrag.t0 - dy / dkDrag.span, 0, 1);
      // Down is nose up.
      else if (dkDrag.kind === 'trim') F.setTrim?.(dkDrag.tr0 + (dy / dkDrag.span) * (F.TRIM_MAX || 0.6) * 2);
    };
    const dragEnd = () => {
      if (F.dkRudHold) { if (F.pedalKey === F.dkRudHold) F.pedalKey = 0; F.dkRudHold = 0; }
      if (F.dkQuackHold) { F.dkQuackHold = false; drakeQuackUp(); }
      if (!dkDrag) return;
      if (dkDrag.kind === 'yoke') F.yokeDrag = false;
      if (dkDrag.kind === 'throttle') F.thrDrag = false;
      dkDrag = null; q('#dkx-wheel')?.classList.remove('drag');
      const v0 = q('.fsim-view'); if (v0) v0.style.cursor = F.dkHover ? 'grab' : '';
    };
    const dragStart = (kind, e, span) => {
      dkDrag = { kind, x0: e.clientX, y0: e.clientY, span, t0: F.input.throttle || 0, tr0: F.input.trim || 0 };
      if (kind === 'yoke') F.yokeDrag = true; else if (kind === 'throttle') F.thrDrag = true;
    };
    add(window, 'pointermove', dragMove);
    add(window, 'pointerup', dragEnd);
    add(window, 'pointercancel', dragEnd);

    // 3-D cockpit: hit-test interiorHotspots on capture, before the mouse stick and free camera.
    const view = q('.fsim-view'), ws = q('#fsim-ws');
    // One hit test for press and hover, so the cursor never promises a control the click misses.
    const hotAt = (e) => {
      if (F.external || !ws) return null;
      const hs = interiorHotspots();
      if (!hs || !hs.list.length) return null;
      const r = ws.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      const x = (e.clientX - r.left) * (hs.W / r.width), y = (e.clientY - r.top) * (hs.H / r.height);
      let best = null, bd = Infinity;
      for (const h of hs.list) { const d = Math.hypot(x - h.x, y - h.y); if (d <= h.r && d < bd) { bd = d; best = h; } }
      return best;
    };
    // Hover: cursor, halo (F.dkHover) and a DOM tooltip naming the control and its state.
    const tip = document.createElement('div');
    tip.className = 'dk-tip'; tip.setAttribute('aria-hidden', 'true');
    tip.style.cssText = 'position:fixed;z-index:60;pointer-events:none;display:none;padding:3px 8px;border-radius:4px;'
      + 'background:rgba(12,14,18,.92);border:1px solid rgba(214,176,112,.55);color:#f2e6cf;font:11px/1.35 monospace;'
      + 'letter-spacing:.5px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.5)';
    document.body.appendChild(tip);
    F.dkTipEl = tip;
    const onOff = (b) => (b ? 'ON' : 'OFF');
    const DK_TIP = {
      'ck:master': () => ['ENGINE', F.engineOn ? 'running · click to shut down (on the ground, stopped)' : 'off · click or press I to start'],
      'ck:land': () => ['LANDING LIGHTS', onOff(!!F.landingLight)],
      'ck:taxi': () => ['TAXI LIGHTS', `on the landing-light circuit · ${onOff(!!F.landingLight)}`],
      'ck:panel': () => ['PANEL LIGHTS', `instrument lighting · ${onOff(!!F.nightLight)}`],
      'ck:dome': () => ['DOME', `cabin light · ${onOff(!!F.domeLight)}`],
      'ck:flaps': () => ['FLAPS', `${['UP', '1', '2', 'FULL'][Math.round(clampNum(F.input.flaps || 0, 0, 1) * 3)]} · click for the next notch`],
      'ck:gear': () => ['GEAR', F.gearUp ? 'up · click to lower' : 'down · click to raise'],
      'ck:arm': () => ['MASTER ARM', F.armed ? 'ARMED · click to make safe' : 'SAFE · click to arm'],
      'ck:gps': () => ['GPS', F.gpsDest && F.apTargetId === 'gps' ? `to ${F.gpsDest.name} · click to change` : 'click to pick a destination (P)'],
      power: () => ['POWER', `engine master · ${onOff(!!F.engineOn)}`],
      lights: () => ['LIGHTS', `landing lights · ${onOff(!!F.landingLight)}`],
      cabin: () => ['CABIN', `dome light · ${onOff(!!F.domeLight)}`],
      gear: () => ['GEAR', 'raise / lower the feet'],
      quack: () => ['QUACK', 'the horn'],
      guns: () => ['GUNS', `arm the miniguns · ${F.armed ? 'ARMED' : 'SAFE'}`],
      nv: () => ['NIGHT VISION', `centre screen · ${onOff(!!F.dk?.nv)}`],
      gps0: () => ['GPS · MAP', 'nearest fields, heading up'], gps1: () => ['GPS · RADAR', 'traffic'],
      gps2: () => ['GPS · DAMAGE', 'hull plan'], gps3: () => ['GPS · AMMO', 'rounds and missiles'],
      conv: () => ['CONVERGENCE', `guns meet at ${drakeConv().toFixed(1)} · click to step, wheel to fine-tune`],
      pantry: () => ['PANTRY', 'stasis larder · click to open'],
      bucket: () => ['CHAMPAGNE', DK_CHAMPAGNE === 0 ? 'empty · refilled when you refuel' : `${DK_CHAMPAGNE ?? 6} glasses · click to drink, shift-click to pour for passengers`],
      locker: () => ['WEAPONS LOCKER', 'dry storage · click to open'],
      ramp: () => ['RAMP', 'rear loading ramp'],
      throttle: () => ['THROTTLE', `${Math.round((F.input.throttle || 0) * 100)}% · drag up and down`],
      mode0: () => ['HELI', 'rotor flight'], mode1: () => ['PLANE', 'wings out, forward flight'],
      mode2: () => ['BOAT', 'feet up, sit on the hull (over water)'], mode3: () => ['SUB', 'flood the ballast and dive (on the water)'],
      modelever: () => ['MODE', `${['HELI', 'PLANE', 'BOAT', 'SUB'][drakeModeNow()]} · click a gate, or the knob for the next`],
      sublever: () => { const d = F.dk || {}; const up = d.submerged > 0 && !(d.subBlowLocal ?? d.subBlow ?? true); return ['SUB', up ? 'submerged · take BOAT to blow ballast and surface' : 'click to flood ballast and dive (on the water)']; },
      convlever: () => ['CONVERSION LEVER', 'ROTOR aft · WING forward · click to convert'],
      trim: () => ['TRIM', 'drag or scroll'],
      yoke: () => ['YOKE', 'drag: roll and pitch'],
      rudderL: () => ['LEFT PEDAL', 'hold for left rudder ( , )'], rudderR: () => ['RIGHT PEDAL', 'hold for right rudder ( . )'],
    };
    const showTip = (h, e) => {
      const d = h && DK_TIP[h.id]?.();
      if (!d) { tip.style.display = 'none'; return; }
      tip.innerHTML = `<b style="color:#ffcf6e">${d[0]}</b> <span style="opacity:.8">${d[1]}</span>`;
      tip.style.display = 'block';
      const tw = tip.offsetWidth, x = Math.min(window.innerWidth - tw - 6, e.clientX + 14);
      tip.style.left = x + 'px'; tip.style.top = Math.max(4, e.clientY - 30) + 'px';
    };
    add(view, 'pointermove', (e) => {
      if (dkDrag) { view.style.cursor = 'grabbing'; tip.style.display = 'none'; return; }
      const h = hotAt(e);
      F.dkHover = h ? h.id : null;
      view.style.cursor = h ? (h.kind === 'click' ? 'pointer' : 'grab') : '';
      showTip(h, e);
    });
    add(view, 'pointerleave', () => { F.dkHover = null; tip.style.display = 'none'; if (!dkDrag) view.style.cursor = ''; });
    add(view, 'pointerdown', (e) => {
      if (e.button) return;
      const best = hotAt(e);
      if (!best) return;
      e.preventDefault(); e.stopImmediatePropagation();
      F.dkPress = { id: best.id, t: performance.now() };
      if (best.kind !== 'click') view.style.cursor = 'grabbing';
      // The quack is held until pointerup (dragEnd).
      if (best.id === 'quack') { F.dkQuackHold = true; drakeQuackDown(); }
      else if (best.kind === 'click') DK_ACT[best.id]?.(e);
      else if (best.kind === 'rudder') { F.dkRudHold = best.id === 'rudderL' ? -1 : 1; F.pedalKey = F.dkRudHold; }
      else dragStart(best.kind, e, best.kind === 'yoke' ? 110 : 90);
    }, true);
    // Mouse wheel turns the 3-D trim wheel and convergence knob.
    add(view, 'wheel', (e) => {
      const h = hotAt(e);
      if (!h || (h.kind !== 'trim' && h.id !== 'conv')) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const dir = e.deltaY > 0 ? 1 : -1;
      if (h.kind === 'trim') F.setTrim?.((F.input.trim || 0) + dir * 0.04);
      else { setDrakeConv(drakeConv() - dir * 0.1); fsimToast('◎ GUNS CONVERGE AT ' + drakeConv().toFixed(1)); }
      F.dkPress = { id: h.id, t: performance.now() };
    }, { capture: true, passive: false });
    let dkHover = false;
    add(view, 'pointermove', (e) => {
      if (!ws || dkDrag) return;
      let over = false;
      const hs = !F.external && interiorHotspots();
      if (hs && hs.list.length) {
        const r = ws.getBoundingClientRect();
        if (r.width && r.height) {
          const x = (e.clientX - r.left) * (hs.W / r.width), y = (e.clientY - r.top) * (hs.H / r.height);
          for (const h of hs.list) if (Math.hypot(x - h.x, y - h.y) <= h.r) { over = true; break; }
        }
      }
      if (over !== dkHover) { dkHover = over; ws.style.cursor = over ? 'pointer' : ''; }
    });

    const dkx = q('#dkx');
    if (dkx) {
      for (const b of dkx.querySelectorAll('[data-dk]')) {
        if (b.dataset.dk === 'quack') {   // held
          add(b, 'pointerdown', (e) => { if (e.button) return; e.preventDefault(); drakeQuackDown(); });
          for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) add(b, ev, drakeQuackUp);
        } else add(b, 'click', () => DK_ACT[b.dataset.dk]?.());
      }
      const wheel = q('#dkx-wheel'), thrEl = q('#dkx-thr'), knob = q('#dkx-thr-knob');
      add(wheel, 'pointerdown', (e) => { if (e.button) return; e.preventDefault(); wheel.classList.add('drag'); dragStart('yoke', e, 90); });
      add(thrEl, 'pointerdown', (e) => { if (e.button) return; e.preventDefault(); dragStart('throttle', e, 90); });
      const trimEl2 = q('#dkx-trim'), trimMark = q('#dkx-trim-mark'), trimRidges = q('#dkx-trim-ridges'), trimVal2 = q('#dkx-trim-val');
      add(trimEl2, 'pointerdown', (e) => { if (e.button) return; e.preventDefault(); dragStart('trim', e, 90); });
      add(trimEl2, 'wheel', (e) => { e.preventDefault(); F.setTrim?.((F.input.trim || 0) + (e.deltaY > 0 ? 0.04 : -0.04)); }, { passive: false });
      const g = wheel.getContext('2d');
      const drawWheel = () => {
        const W = wheel.width, H = wheel.height, ail = F.input.aileron || 0, elev = F.input.elevator || 0;
        g.clearRect(0, 0, W, H);
        g.save(); g.translate(W / 2, H / 2 + elev * 10); g.rotate(ail * 1.0);
        // ⚠ Drawn from DRAKE_WHEEL (interior-drake.js) so it matches the cockpit's; never redraw it here.
        const DW = DRAKE_WHEEL, k = 640, oy = 0.029;
        const P = (x, y) => [x * k, -(y + oy) * k];
        const rgb = (c, m = 1) => `rgb(${c.map((v) => Math.round(Math.min(255, v * m))).join(',')})`;
        const poly = (pts, fill, dx = 0, dy = 0) => {
          g.beginPath(); pts.forEach(([x, y], i) => { const [px, py] = P(x, y); g[i ? 'lineTo' : 'moveTo'](px + dx, py + dy); });
          g.closePath(); g.fillStyle = fill; g.fill();
        };
        const disc = (x, y, r, fill, dx = 0, dy = 0) => { const [px, py] = P(x, y); g.beginPath(); g.arc(px + dx, py + dy, r * k, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); };
        const grips = [1, -1].map((sx) => DW.grip.map(([x, y]) => [x * sx, y]));
        for (const p of DW.body) poly(p, '#0b0c0e', 3, 4);
        for (const p of grips) poly(p, '#1c1b1b', 4, 5);
        for (const p of DW.body) {
          const [, y0] = P(0, 0.06), [, y1] = P(0, -0.068);
          const cf = g.createLinearGradient(0, y0, 0, y1); cf.addColorStop(0, rgb(DW.weave)); cf.addColorStop(1, rgb(DW.carbon));
          poly(p, cf);
        }
        g.save(); g.beginPath();
        for (const p of DW.body) p.forEach(([x, y], i) => { const [px, py] = P(x, y); g[i ? 'lineTo' : 'moveTo'](px, py); });
        g.clip(); g.strokeStyle = 'rgba(120,128,140,.22)'; g.lineWidth = 1.5;
        for (let x = -140; x < 140; x += 5) { g.beginPath(); g.moveTo(x, -60); g.lineTo(x + 70, 60); g.stroke(); }
        g.restore();
        for (const p of grips) {
          const [gx] = P(Math.min(...p.map((q) => q[0])), 0), [gx1] = P(Math.max(...p.map((q) => q[0])), 0);
          const gr = g.createLinearGradient(gx, 0, gx1, 0); gr.addColorStop(0, rgb(DW.rubber, 0.8)); gr.addColorStop(0.5, rgb(DW.rubber, 1.5)); gr.addColorStop(1, rgb(DW.rubber, 0.7));
          poly(p, gr);
        }
        for (const t of DW.wheels) { const [px, py] = P(t.x, t.y); g.fillStyle = rgb(t.rgb, 0.55); g.fillRect(px - 5, py - 4, 10, 10); g.fillStyle = rgb(t.rgb); g.fillRect(px - 5, py - 6, 10, 9); }
        const lit = (F.powered ? (F.input.throttle || 0) : 0) * DW.leds.n;
        for (let i = 0; i < DW.leds.n; i++) {
          const f = i / (DW.leds.n - 1), col = f < 0.4 ? '70,230,110' : f < 0.75 ? '255,190,60' : '255,70,60';
          disc(DW.leds.x0 + i * DW.leds.dx, DW.leds.y, 0.0045, i < lit ? `rgb(${col})` : `rgba(${col},.18)`);
        }
        const [s0, s1, s2, s3] = DW.screen, [ax, ay] = P(s0, s3), [bx, by] = P(s2, s1);
        g.beginPath(); g.roundRect(ax - 3, ay - 3, bx - ax + 6, by - ay + 6, 4); g.fillStyle = '#28292e'; g.fill();
        g.beginPath(); g.roundRect(ax, ay, bx - ax, by - ay, 3); g.fillStyle = F.powered ? '#1e4634' : '#0a100c'; g.fill();
        g.fillStyle = F.powered ? '#aaffc8' : '#2a4a34'; g.font = 'bold 20px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(F.powered ? String(Math.round(F.disp?.ias || 0)).padStart(3, '0') : '---', (ax + bx) / 2, (ay + by) / 2 - 2);
        for (const b of DW.buttons) { disc(b.x, b.y, b.r, rgb(b.rgb, 0.45), 1.5, 2); disc(b.x, b.y, b.r, rgb(b.rgb)); }
        for (const kn of DW.knobs) {
          disc(kn.x, kn.y, kn.r * 1.25, '#1e2024', 1, 1);
          disc(kn.x, kn.y, kn.r, rgb(kn.rgb, 0.45), 2, 3); disc(kn.x, kn.y, kn.r, rgb(kn.rgb));
          const [px, py] = P(kn.x, kn.y); g.fillStyle = '#fff'; g.fillRect(px - 1, py - kn.r * k, 2, kn.r * k * 0.8);
        }
        g.restore();
      };
      const tick = () => {
        if (!dkx.isConnected) return;
        if (document.body.classList.contains('fsim-external')) {
          drawWheel();
          if (knob) knob.style.top = (6 + (1 - (F.input.throttle || 0)) * 82) + 'px';
          const tf = ((F.input.trim || 0) / (F.TRIM_MAX || 0.6) + 1) / 2;
          if (trimMark) trimMark.style.top = (6 + tf * 82) + 'px';
          const trm = F.input.trim || 0, tmax = F.TRIM_MAX || 0.6;
          if (trimRidges) trimRidges.style.transform = 'translateY(' + (trm / tmax * 24).toFixed(1) + 'px)';
          if (trimVal2) { const n = Math.round(trm / tmax * 100); trimVal2.textContent = n === 0 ? '0' : (n > 0 ? '+' : '−') + Math.abs(n); trimVal2.classList.toggle('set', n !== 0); }
          const conv = F.dk.conv || 0, wb = dkx.querySelector('.dkx-wings');
          if (wb) wb.classList.toggle('moving', conv > 0.01 && conv < 0.99);   // pulses while converting
          const st = { power: F.powered, lights: F.landingLight, cabin: F.domeLight, gear: !F.gearUp, guns: F.armed, nv: F.dk.nv, wings: (F.dk.conv || 0) >= 0.99, mode0: drakeModeNow() === 0, mode1: drakeModeNow() === 1, mode2: drakeModeNow() === 2, mode3: drakeModeNow() === 3 };
          for (const b of dkx.querySelectorAll('[data-dk]')) {
            const id = b.dataset.dk;
            if (id in st) b.classList.toggle('on', !!st[id]);
            if (id === 'lights' || id === 'cabin') b.classList.toggle('nopwr', !F.powered);
            if (/^mode[0-3]$/.test(id)) { const k = +id[4], cur = drakeModeNow() === k, ok = !cur && F.drakeModeReady(k); b.classList.toggle('rdy', ok); b.classList.toggle('nordy', !cur && !ok); }
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }

  const viewBtn = q('#fsim-viewbtn');
  // ⚠ Going back inside stows the free camera, or it holds the keyboard with nothing on screen.
  setExternal = (on) => {
    if (!on && freeCam.active) { freeCam.close(); setFreeCamChrome(false); }
    F.external = on; if (viewBtn) viewBtn.classList.toggle('on', on); document.body.classList.toggle('fsim-external', on); fsimToast(on ? '◎ EXTERNAL VIEW' : '◎ COCKPIT VIEW');
  };
  F.setExternalView = setExternal;   // the crash death-cam uses it
  add(viewBtn, 'click', () => setExternal(!F.external));

  // ⟲ The frame loop eases the orbit back to rest; a drag cancels it.
  add(q('#fsim-orbitreset'), 'click', () => { F.orbitResetting = true; fsimToast('⟲ CAMERA RESET'); });

  // Refuel: shown only when parked on a fuelled strip.
  add(q('#fsim-refuel'), 'click', (e) => { e.stopPropagation(); sendCmdSilent('refuel'); fsimToast('REFUELLING…'); });

  add(q('#fsim-tgt-prev'), 'click', () => cycleApTarget(-1));
  add(q('#fsim-tgt-next'), 'click', () => cycleApTarget(1));
  add(q('#fsim-tgt-clear'), 'click', () => clearApTarget());
  add(q('#fsim-tgt-name'), 'click', () => gpsOpen());

  // The pane owns the keyboard on embark (seat-keys.js).
  claimSeatKeyboard(root, { label: 'SIM' });

  F.last = performance.now();
  F.raf = requestAnimationFrame(fsimFrame);
}

// Wind (with gusts) and turbulence at the aircraft from the live weather.
const WX_SEV = { clear: 0, cloudy: 0.22, fog: 0.12, rain: 0.5, snow: 0.4, storm: 1.0 };
function weatherAtmos(F, now) {
  const wx = (F.sky?.weather || 'clear').toLowerCase();
  const sev = WX_SEV[wx] ?? 0.2;
  const t = now * 0.001;
  // ⚠ Gusts come off the wall clock (shared/wind-gust.js) so every client agrees.
  // ⚠ No weather baseline: F.sky.wind already includes the storm cell, so adding one counts it twice.
  const wallNow = Date.now(), storm = stormOf(F.sky?.weather);
  const windKt = (F.sky?.wind || 0) * 0.28 * windGust(wallNow, storm);   // the flight model's kph-to-kt scale
  // The weather field's wind, so the arrow points where the clouds go; a per-hour bearing if absent.
  const windDir = ((F.sky?.field?.wind?.dir ?? ((((F.sky?.hour || 12) * 17 + 40) % 360 + 360) % 360))
    + windVeer(wallNow, storm) + 360) % 360;
  return { sev, windKt, windDir, turb: sev };
}

// The flight map cell at absolute tile (x, y), or null outside the window.
function mapCellAt(F, x, y) {
  const map = F.map; if (!Array.isArray(map) || !map.length || !F.mapCenter) return null;
  const R = (map.length - 1) / 2;
  const row = map[y - F.mapCenter.y + R];
  return row ? row[x - F.mapCenter.x + R] || null : null;
}

// Landing card graded by sink rate at contact; 800 fpm breaks the gear.
const LANDING_GRADES = [
  [60,  'A+', 'butter', '🧈 BUTTER. Absolutely greased it.'],
  [120, 'A',  'butter', 'Silky. The passengers applauded.'],
  [180, 'A-', 'good',   'Smooth. Barely a bump.'],
  [250, 'B+', 'good',   'Nice one: textbook touchdown.'],
  [330, 'B',  'good',   "Solid. The coffee didn't spill."],
  [420, 'B-', 'mid',    'Firm, but perfectly fine.'],
  [510, 'C+', 'mid',    'Ooh, felt that one.'],
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

// Full stop: cut the engine, report, park. At a field (or the Echelon) open the hangar; else look.
function finishLanding(F, s) {
  if (F.landed) return;
  F.landed = true; F.rolling = false;
  F.engineOn = false; F.nightLight = false; F.landingLight = false;
  const eb = document.getElementById('fsim-eng'); if (eb) eb.classList.remove('on');
  try { spoolDown(F.cls); } catch {}
  // ⚠ A deck landing reports the Echelon's tile; our own position can round off her hull into a tow.
  const px = F.deckLandTile ? F.deckLandTile[0] : F.pos.x, py = F.deckLandTile ? F.deckLandTile[1] : F.pos.y;
  sendCmdSilent(`flightsync ${px.toFixed(2)} ${py.toFixed(2)} 0 0 ${Math.round(s.heading)} 0 0 1 0`);
  // ⚠ The tile rides in `land` too: the server doesn't serialize a player's commands, so it can't rely on the sync.
  sendCmdSilent(`flightevent land ${F.landGrade || 'F-'} ${Math.round(F.landFpm || 0)} ${px.toFixed(2)} ${py.toFixed(2)}`);
  // deckLandTile, not F.onYacht, which the server may have cleared by now.
  const deckLanding = !!F.deckLandTile;
  const toHangar = !!F.onField || deckLanding;
  setTimeout(() => { closeFlightSim(); sendCmdSilent(toHangar ? 'hangar' : 'look'); }, deckLanding ? DECK_HANDOFF_MS : 600);
}

// ── Deck-cam auto-land cinematic ────────────────────────────────────────────────────────────
// When the Echelon captures a hovering heli, a spectator camera flies it down onto the pad, then
// finishLanding parks it. The heli is drawn as a contact (external + hideOwnShip, as the Helm does).

// A small open-water window with the Echelon at its centre, built once per cinematic.
function deckLandingWindow(F) {
  if (F._deckMap) return F._deckMap;
  const RAD = 8, map = [];
  for (let y = -RAD; y <= RAD; y++) { const row = []; for (let x = -RAD; x <= RAD; x++) row.push({ kind: 'land', biome: 'water', road: 0 }); map.push(row); }
  map[RAD][RAD] = { kind: 'land', biome: 'water', road: 0, mark: 'yacht', heading: F.deckCine ? F.deckCine.hdg : 0, wake: { spd: 0 } };
  F._deckMap = map;
  return map;
}

// Shots: WIDE fly-in, DROP to a close-up for the last ~50 ft, HOLD while the rotors stop and a beat after.
// The pose is value- and velocity-continuous across the seams.
const DECK_WIDE = 4000, DECK_DROP = 3000;
const DECK_SPINDOWN = 1900;
const DECK_LINGER = 2000;
const DECK_HOLD = DECK_SPINDOWN + DECK_LINGER;
const DECK_TOTAL = DECK_WIDE + DECK_DROP + DECK_HOLD;
const DECK_HANDOFF_MS = 600;
// ⚠ Keep in sync with YACHT_SCALE in windshield.js; every yacht-local constant here is scaled by it.
const YACHT_SCALE = 0.4;
// The deck heaves, so its height comes from yachtPadZ(), never a constant.
const DECK_DROP_FT = 75;    // height the close-up shot picks her up at

// Auto-land catch zone; matches the drawn catch volume.
const YACHT_CATCH_RADIUS = 0.7 * YACHT_SCALE, YACHT_CATCH_CEIL_FT = 300;

// Distance to the Echelon's helipad from our smooth position: { dist, hdg, tile, hull } or null.
function yachtProximity(F) {
  const map = F.map; if (!Array.isArray(map) || !map.length || !F.mapCenter || !F.pos) return null;
  const R = (map.length - 1) / 2;
  for (let ry = 0; ry < map.length; ry++) {
    const row = map[ry]; if (!row) continue;
    for (let rx = 0; rx < row.length; rx++) {
      const c = row[rx]; if (!c || c.mark !== 'yacht') continue;
      const sub = c.sub || { x: 0, y: 0 };
      const yx = F.mapCenter.x + (rx - R) + sub.x, yy = F.mapCenter.y + (ry - R) + sub.y;
      const hr = (c.heading || 0) * Math.PI / 180;
      const PAD_OY = 0.28 * YACHT_SCALE;
      const px = yx - PAD_OY * Math.sin(hr), py = yy + PAD_OY * Math.cos(hr);
      // tile: her committed grid tile, so surfaceAt resolves her zone. hull: for the deck-cam's start.
      return { dist: Math.hypot(px - F.pos.x, py - F.pos.y), hdg: c.heading || 0, tile: [Math.round(F.mapCenter.x + (rx - R)), Math.round(F.mapCenter.y + (ry - R))], hull: [yx, yy] };
    }
  }
  return null;
}

// ── Helipads: the Solenne's roof, and the three on the ground ────────────────────────────────
// ⚠ The catch window is the drawn column: radius and ceiling come from the renderer, and the ceiling is
// derived per pad through altRestingOnZ (z to feet isn't linear), so the ring you see is the ring that grabs.
const padCeilFt = (padZ, padFt) => Math.max(60, altRestingOnZ(padZ + ROOF_CATCH_CEIL_Z) - padFt);
const ROOF_LAND_MS = 2800;

// Nearest helipad: a rooftop pad (field + building, deck from the captured geometry) or a ground pad
// (field marked `pad`, deck at zero). ⚠ Both catch; never test only "field and building".
function padProximity(F) {
  const map = F.map; if (!Array.isArray(map) || !map.length || !F.mapCenter || !F.pos) return null;
  const R = (map.length - 1) / 2;
  let best = null;
  for (let ry = 0; ry < map.length; ry++) {
    const row = map[ry]; if (!row) continue;
    for (let rx = 0; rx < row.length; rx++) {
      const c = row[rx]; if (!c || c.kind !== 'field' || !(c.bt || c.pad)) continue;
      const wx = F.mapCenter.x + (rx - R), wy = F.mapCenter.y + (ry - R);
      const dist = Math.hypot(wx - F.pos.x, wy - F.pos.y);
      if (dist > 4 || (best && dist >= best.dist)) continue;
      // ⚠ Ask the tile first: a height of 0 is a real ground pad, not a missing one.
      // ⚠ padFt is where the skids rest (altRestingOnZ), never altForRoofZ.
      const padZ = c.bt ? modelTopZAt(wx, wy, c, wx, wy) : 0;
      const padFt = altRestingOnZ(padZ);
      if (c.bt ? padZ > 0 : !!c.pad) best = { dist, padFt, padZ, tile: [wx, wy] };
    }
  }
  return best;
}

// One cell of the streamed window by world tile.
function windowCellAt(F, wx, wy) {
  const map = F.map;
  if (!Array.isArray(map) || !map.length || !F.mapCenter) return null;
  const R = (map.length - 1) / 2;
  const ry = Math.round(wy - F.mapCenter.y + R), rx = Math.round(wx - F.mapCenter.x + R);
  const row = map[ry];
  return row ? (row[rx] || null) : null;
}

// ── Parked on a rooftop pad ──────────────────────────────────────────────────────────────────
// ⚠ A rooftop pad shares its tile with the street, so a parked heli needs the roof as its ground or it
// spawns inside the tower. Deck from modelTopZAt (as CFIT), converted through altRestingOnZ, never altForRoofZ.
function parkedDeck(F) {
  if (!F.heli || !F.pos) return null;
  const tx = Math.round(F.pos.x), ty = Math.round(F.pos.y);
  const c = windowCellAt(F, tx, ty);
  if (!c || c.kind !== 'field' || !c.bt) return null;
  const z = modelTopZAt(tx, ty, c, tx, ty);
  if (!(z > 0)) return null;
  return { tile: [tx, ty], ft: altRestingOnZ(z), left: false };
}

// The floor this frame: zero, or the deck we started on until we leave it.
// ⚠ The `left` latch only closes; reopening it would snap a low pass onto the roof and skip CFIT.
function deckFloorFt(F, s) {
  if (F.roofLock) return F.roofLock.padFt;
  const d = F.padDeck;
  if (!d || d.left) return 0;
  const c = windowCellAt(F, d.tile[0], d.tile[1]);
  const z = c ? modelTopZAt(d.tile[0], d.tile[1], c, F.pos.x, F.pos.y) : 0;
  if (z > 0) return altRestingOnZ(z);
  // No roof: airborne means we've left; on the skids the probe just can't answer, so hold the height.
  if (!s.onGround) { d.left = true; return 0; }
  return d.ft;
}

// Pad capture: fly the last few seconds onto the pad centre. No cinematic.
function startRoofLanding(F, s, now, prox) {
  F.roofLock = { t0: now, padFt: prox.padFt, tile: prox.tile,
    from: { x: F.pos.x, y: F.pos.y, alt: s.altitude, hdg: s.heading } };
  F.roofDeparted = false;   // must leave the window before it can grab again
  F.landGrade = 'A'; F.landFpm = Math.round(Math.max(0, -(s.vs || 0)));
  if (F.toast) F.toast('PAD LOCK: the deck has you. Coming down.');
}

function stepRoofLanding(F, s, now) {
  const L = F.roofLock, t = clampNum((now - L.t0) / ROOF_LAND_MS, 0, 1);
  const ease = (x) => x * x * (3 - 2 * x);
  const e = ease(t);
  F.pos.x = L.from.x + (L.tile[0] - L.from.x) * e;
  F.pos.y = L.from.y + (L.tile[1] - L.from.y) * e;
  s.altitude = L.from.alt + (L.padFt - L.from.alt) * e;
  s.airspeed = Math.max(0, s.airspeed * (1 - e));
  s.vs = (L.padFt - L.from.alt) / Math.max(0.001, ROOF_LAND_MS / 1000) * 60 * (1 - e);
  s.bank = 0; s.pitch = 6 * e;
  if (t < 1) return;
  F.roofLock = null;
  // ⚠ Hand the floor to the deck, or she drops off the roof before the hangar hand-off.
  F.padDeck = { tile: L.tile, ft: L.padFt, left: false };
  F.deckLandTile = L.tile;
  finishLanding(F, s);
}

function startDeckLanding(F, s, now, prox) {
  const hdg = prox?.hdg || 0;
  // Our capture position in her local frame (inverse of `loc`), so the fly-in starts where we are.
  const hr = hdg * Math.PI / 180, sh = Math.sin(hr), ch = Math.cos(hr);
  let start = null;
  if (prox?.hull && F.pos) {
    const wx = F.pos.x - prox.hull[0], wy = F.pos.y - prox.hull[1];
    start = [wx * ch + wy * sh, -wx * sh + wy * ch];
  }
  // Approach on the reciprocal heading, then turn to hers during the drop (helideck procedure).
  const hdg0 = (hdg + 180) % 360;
  F.deckCine = { t0: now, hdg, hdg0, alt0: Math.max(DECK_DROP_FT + 20, s.altitude), start, done: false, seg: -1 };
  F.deckLandTile = prox?.tile || null;
  F._deckMap = null;
  F.landGrade = 'A'; F.landFpm = Math.round(Math.max(0, -(s.vs || 0)));
  if (F.toast) F.toast('The Echelon has you, coming in to land.');
}

// Shortest-path angle lerp (deg).
function lerpAngle(a, b, t) {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}
// ── Crash break-up death-cam ──────────────────────────────────────────────────
// A severe write-off forces the external view and breaks the aircraft up; the crash is reported
// to the server only after BREAKUP_MS, so the player always sees it.
const BREAKUP_MS = 3400;
const IMPACT_T = 0.42;     // fraction of the timeline where the wreck reaches the ground

const SHEAR_TOAST = { leftWing: 'LEFT WING', rightWing: 'RIGHT WING', tail: 'TAILPLANE', rudder: 'RUDDER' };

function beginCrashBreakup(F, reason) {
  if (F.crashCine) return;
  F.rolling = false; F.reportedAirborne = false;
  if (F.setExternalView) F.setExternalView(true);
  const h0 = Math.min(1, Math.sqrt(Math.max(0, F.s?.altitude || 0) / 3000));
  F.crashCine = { t0: performance.now(), reason, reported: false,
    bank0: F.s?.bank || 0, pitch0: F.s?.pitch || 0, hdg: F.s?.heading || 0, h0 };
}

function stepCrashBreakup(F, now) {
  const C = F.crashCine, root = document.getElementById('fsim-root');
  const t = clampNum((now - C.t0) / BREAKUP_MS, 0, 1);
  const fall = clampNum(t / IMPACT_T, 0, 1);
  const eFall = fall * fall;
  // POST: 0 at impact to 1 at the report; a small bounce, then the tumble damps to a resting pose.
  const post = clampNum((t - IMPACT_T) / (1 - IMPACT_T), 0, 1);
  const bounce = post > 0 ? Math.sin(post * Math.PI) * 0.05 * (1 - post) : 0;
  const height = C.h0 * (1 - eFall) + C.h0 * bounce;
  // The fuselage settles roughly flat so the pieces' frame is ground-aligned.
  const settle = 1 - Math.pow(1 - post, 3);
  const tumbleB = C.bank0 + 96 * fall, tumbleP = C.pitch0 - 42 * fall;
  const bank = tumbleB * (1 - settle) + 16 * settle;
  const pitch = tumbleP * (1 - settle) + -6 * settle;
  // Each piece has its own clock, fall (`drop`) and resting pose; the renderer grounds its lowest vertex.
  // ⚠ Every face needs an owner or it rides the hull. Order matters: shedPartFor takes the first match.
  // `seed` varies the scatter per crash; the whole thing stays a pure function of t.
  const seed = C.seed ?? (C.seed = ((Math.sin(C.hdg * 12.9898 + C.bank0 * 78.233) * 43758.5453) % 1 + 1) % 1);
  const jit = (k, amt) => 1 + amt * (Math.sin((seed + k) * 91.7) );
  const debris = ({ roles, side, fRange, dir, spin, mag, land, rest: restRot = [0, 0] }, k) => {
    const air = clampNum(t / land, 0, 1);
    const rest = clampNum((t - land) / (1 - land), 0, 1);
    const ao = 1 - Math.pow(1 - air, 2);
    const hop = rest > 0 ? Math.sin(rest * Math.PI) * 0.06 * (1 - rest) : 0;
    const m = mag * jit(k, 0.25);
    // Ease to the nearest equivalent of the resting pose rather than unwinding.
    const settleTo = (a, r) => r + 2 * Math.PI * Math.round((a - r) / (2 * Math.PI));
    const e = 1 - Math.pow(1 - rest, 3);
    const rx = spin[0] * jit(k + 3, 0.2), ry = spin[1] * jit(k + 5, 0.2);
    const rot = [
      rx * ao + (settleTo(rx, restRot[0]) - rx) * e,
      ry * ao + (settleTo(ry, restRot[1]) - ry) * e,
      spin[2] * ao,
    ];
    return {
      roles, side, fRange, ballistic: true, hop,
      drop: 1 - air * air,
      scatter: [dir[0] * m * ao, dir[1] * m * ao],
      rot,
    };
  };
  const H = Math.PI / 2, P = Math.PI;
  const parts = [
    { roles: ['body', 'glass', 'window', 'interior', 'gun'], fRange: [ 0.30,  9], side: null, dir: [ 1.4,  0.2], spin: [ 3.2,  2.6,  1.0], mag: 1.1, land: 0.52 },            // nose section forward
    { roles: ['body', 'glass', 'window', 'interior', 'gun'], fRange: [-9, -0.35], side: null, dir: [-1.3, -0.3], spin: [ 3.8, -1.8,  2.2], mag: 1.1, land: 0.50 },            // tail section aft
    { roles: ['wing', 'aileron', 'flap'],   side: 1,    dir: [-0.4,  1.3], spin: [ 6.5,  1.4,  1.6], mag: 1.0, land: 0.44, rest: [P, 0] },   // right wing cartwheels off, lands upside down
    { roles: ['wing', 'aileron', 'flap'],   side: -1,   dir: [ 0.2, -0.6], spin: [-2.2,  0.6, -0.8], mag: 0.6, land: 0.43 },                  // left wing folds off close by
    { roles: ['stab', 'elevator'],          side: -1,   dir: [-1.1, -0.8], spin: [ 4.6, -2.2,  2.6], mag: 1.0, land: 0.48 },                  // left tailplane spins off to port
    { roles: ['stab', 'elevator'],          side: 1,    dir: [-0.9,  0.7], spin: [-3.4,  1.8, -1.9], mag: 0.8, land: 0.47, rest: [P, 0] },
    { roles: ['fin', 'rudder'],             side: null, dir: [-1.2,  0.3], spin: [ 2.0,  3.8,  1.4], mag: 0.9, land: 0.46, rest: [H, 0] },   // fin snaps off aft and lies on its side
    { roles: ['nacelle', 'prop', 'strut'],  side: 1,    dir: [ 0.6,  1.0], spin: [ 3.0,  2.2,  1.2], mag: 0.9, land: 0.45, rest: [H, 0] },   // engines roll away
    { roles: ['nacelle', 'prop', 'strut'],  side: -1,   dir: [ 0.7, -1.0], spin: [-2.6,  2.0, -1.0], mag: 0.8, land: 0.45, rest: [-H, 0] },
    { roles: ['gear'],                      side: null, dir: [-0.2,  0.1], spin: [ 1.2,  0.8,  0.4], mag: 0.4, land: 0.43, rest: [H, 0] },   // gear torn off under her
  ].map(debris);
  const wreckFx = null;
  paintWindshield('fsim-ws', {
    external: true, hideOwnShip: false, phase: 'cruise', worldBlend: 1,
    // ⚠ Pass the livery variant: a Drake variant is a different mesh.
    cls: F.cls, armed: F.cls === 'heli' && F.hardpoints > 0, heading: C.hdg, bank, pitch, livery: F.livery,
    ...(F.cls === 'drake' && F.livery?.variant && F.livery.variant !== 'stock' ? { variant: F.livery.variant } : {}),
    gearAnim: F.gearAnim ?? 1, enginePct: 0, engineOn: false, breakup: { t, parts, state: C }, wreckFx,
    extYaw: (F.extOrbit || 0) + 26 * t, extPitch: F.extPitch ?? REST_PITCH, extZoom: F.extZoom || 1,
    height, speed: 0, hour: F.sky?.hour, moon: F.sky?.moon, weather: F.sky?.weather, wxField: F.sky?.field, wxGround: F.sky?.ground,
    map: F.map, skyline: F.skyline, mapCenter: F.mapCenter, mapOffset: { x: F.pos.x - F.mapCenter.x, y: F.pos.y - F.mapCenter.y },
    acX: F.pos.x, acY: F.pos.y, biomeBelow: F.biomeBelow || 'default', airport: F.airport || 'default', helipad: !!F.helipad,
  });
  if (t >= 1 && !C.reported) {
    C.reported = true;
    if (root) showLandingCard(root, 900, true);
    sendCmdSilent(`flightevent crash ${C.reason}`);
  }
}

function stepDeckLanding(F, now) {
  const C = F.deckCine; if (!C) return;
  const el = now - C.t0;
  const ease = (t) => 1 - Math.pow(1 - t, 2.2);
  // Ease-in-out for the camera so there's no speed jump at the shot seams.
  const smooth = (t) => { const c = clampNum(t, 0, 1); return c * c * (3 - 2 * c); };
  const hr = C.hdg * Math.PI / 180, sinh = Math.sin(hr), cosh = Math.cos(hr);
  // Yacht-local (beam ox, fore-aft oy) to world, as drawYacht does.
  const loc = (ox, oy) => [-oy * sinh + ox * cosh, oy * cosh + ox * sinh];
  // ⚠ Work in her local frame and apply `loc` exactly once, or the touchdown slides off the pad.
  const PAD = [0, 0.28 * YACHT_SCALE];
  const START = C.start || [1.0 * YACHT_SCALE, 1.7 * YACHT_SCALE];   // captured position, or a canned pose
  const padWorld = loc(PAD[0], PAD[1]);
  // `lookAt` is the ground point the camera centres on (mapOffset).
  let phase, ox, oy, alt, power = 0.8, propSpin = 1, landing = false, cam, lookAt = [0, 0], dome = false;
  if (el < DECK_WIDE) {
    // Shot 1: on-deck camera forward of the pad, looking aft as she flies in over the water.
    phase = 'wide'; const lp = ease(el / DECK_WIDE), clp = smooth(el / DECK_WIDE);
    ox = START[0] + (PAD[0] - START[0]) * lp; oy = START[1] + (PAD[1] - START[1]) * lp;
    alt = C.alt0 + (DECK_DROP_FT - C.alt0) * lp;
    landing = lp > 0.75; dome = true;
    cam = { yaw: 180, pitch: 0.14, zoom: 0.85 - clp * 0.40 };
    lookAt = padWorld;
  } else if (el < DECK_WIDE + DECK_DROP) {
    // Shot 2: same vantage, dollying in as she drops the last 75 ft.
    phase = 'drop'; const lp = ease((el - DECK_WIDE) / DECK_DROP), clp = smooth((el - DECK_WIDE) / DECK_DROP);
    ox = PAD[0]; oy = PAD[1]; alt = DECK_DROP_FT * (1 - lp); landing = true;
    cam = { yaw: 180, pitch: 0.14 - clp * 0.02, zoom: 0.45 - clp * 0.15 };
    lookAt = padWorld;
  } else {
    // Shot 3: arc to a three-quarter close-up while the rotors spin down.
    phase = 'hold'; const hEl = el - DECK_WIDE - DECK_DROP;
    ox = PAD[0]; oy = PAD[1]; alt = 0; landing = true;
    const spin = Math.min(1, hEl / DECK_SPINDOWN);
    power = 0.5 * (1 - spin); propSpin = 1 - spin;
    const ip = smooth(hEl / DECK_SPINDOWN);
    // A camera zoom, never a bigger model. Mode-7 has no tilt, so the low pitch drops the eye to her height.
    cam = { yaw: lerpAngle(180, 110, ip), pitch: 0.12 - 0.54 * ip, zoom: 0.30 - 0.14 * ip };
    lookAt = padWorld;
    if (C.seg !== 2) { C.seg = 2; if (F.toast) F.toast('Skids down: winding down.'); }
  }
  const [hx, hy] = loc(ox, oy);
  // Hold the reciprocal through WIDE, turn to her heading over DROP.
  const rot = ease(clampNum((el - DECK_WIDE) / DECK_DROP, 0, 1));
  const heliHdg = lerpAngle(C.hdg0 ?? C.hdg, C.hdg, rot);
  // Nose down on the way in, flare near the deck, level on the pad.
  let heliPitch;
  if (phase === 'wide') heliPitch = -2 * clampNum(alt / 30, 0, 1);
  else if (phase === 'drop') heliPitch = -2 + 8 * ease(clampNum((DECK_DROP_FT - alt) / DECK_DROP_FT, 0, 1));
  else heliPitch = 6 * (1 - ease(clampNum((el - DECK_WIDE - DECK_DROP) / (DECK_SPINDOWN * 0.6), 0, 1)));
  const heli = {
    id: 'deck-heli', dx: hx - lookAt[0], dy: hy - lookAt[1],
    // groundZ is the pad deck, so altDiff is feet above it. ⚠ The deck heaves: ask yachtPadZ, never a constant.
    groundZ: yachtPadZ(0, 0, C.hdg), altDiff: alt,
    // ⚠ `armed` picks the airframe mesh (Viper vs Dragonfly), not the master-arm state.
    cls: F.cls, armed: F.cls === 'heli' && F.hardpoints > 0, hdg: heliHdg, bank: 0, pitch: heliPitch,
    // Divide out VIPER_SCALE so both helis frame the same.
    livery: F.livery, sizeMul: (F.cls === 'heli' && F.hardpoints > 0) ? 1.9 / VIPER_SCALE : 1.9,
    power, propSpin, propDisc: propSpin > 0.15 ? 1 : 0,
    lights: true, landing,
  };
  paintWindshield('fsim-ws', {
    external: true, hideOwnShip: true, phase: 'cruise', worldBlend: 1,
    heading: C.hdg, extYaw: cam.yaw, extPitch: cam.pitch, extZoom: cam.zoom,
    height: 0, speed: 0, hour: F.sky?.hour, moon: F.sky?.moon, weather: F.sky?.weather, wxField: F.sky?.field, wxGround: F.sky?.ground,
    map: deckLandingWindow(F), mapCenter: { x: 0, y: 0 }, mapOffset: { x: lookAt[0], y: lookAt[1] },
    acX: 0, acY: 0, biomeBelow: 'water', airport: 'default',
    contacts: [heli], padDome: dome ? { armed: true } : null,
  });
  if (el >= DECK_TOTAL && !C.done) { C.done = true; F.deckCine = null; F._deckMap = null; finishLanding(F, F.s); }
}

// ⚠ Module-level twin of the setup closure's fsimToast, so a call from fsimFrame isn't a ReferenceError.
function fsimToast(txt) { try { _fsim?.toast?.(txt); } catch {} }

// Dive gauge, scaled so the rating line, the seabed and some overrun all fit.
function drawSubGauge(D) {
  const el = (id) => document.getElementById(id);
  const depth = D.subVis || 0, rating = D.subRating || 25, floor = D.subFloor;
  const span = Math.max(rating * 1.3, (floor || 0) * 1.05, depth * 1.1, 10);
  const pct = (m) => Math.max(0, Math.min(100, m / span * 100)) + '%';
  const now = el('fsim-subnow'); if (now) { now.style.top = pct(depth); now.classList.toggle('over', depth > rating); }
  const nt = el('fsim-subnowtxt'); if (nt) nt.textContent = depth > 0.05 ? depth.toFixed(depth < 10 ? 1 : 0) + ' m' : '0 m';
  const rt = el('fsim-subrating'); if (rt) rt.style.top = pct(rating);
  const fl = el('fsim-subfloor');
  if (fl) { fl.style.display = floor > 0 ? '' : 'none'; if (floor > 0) fl.style.top = pct(floor); }
  const b = D.ballastVis || 0;
  const moving = (D.ventFlood || 0) + (D.ventBlow || 0);
  const slosh = moving > 0.05 ? Math.sin(performance.now() / 140) * 3 * moving : 0;
  for (const [id, k] of [['fsim-subfill-l', 1], ['fsim-subfill-r', -1]]) {
    const f = el(id); if (!f) continue;
    f.style.height = (b * 100) + '%';
    f.style.transform = `skewY(${(slosh * k).toFixed(2)}deg)`;
    f.classList.toggle('moving', moving > 0.05);
  }
  const bal = el('fsim-subbal');
  if (bal) {
    const blowing = D.subBlowLocal ?? D.subBlow ?? true;
    bal.textContent = D.ventFlood > 0.05 ? '◢ FLOODING ' + Math.round(b * 100) + '%'
      : D.ventBlow > 0.05 ? '◤ BLOWING ' + Math.round(b * 100) + '%'
      : D.submerged > 0 && !blowing ? (D.planesVis ? (D.planesVis > 0 ? '▼ PLANES DOWN' : '▲ PLANES UP') : '◆ HOLDING DEPTH')
      : 'BALLAST EMPTY';
  }
  const btn = el('fsim-subdive');
  if (btn && _fsim?.dk) btn.style.display = 'none';
  else if (btn) {
    const surfaceNext = D.submerged > 0 && !(D.subBlowLocal ?? D.subBlow ?? true);
    const txt = surfaceNext ? '⬆ SURFACE' : '⬇ DIVE';
    if (btn.textContent !== txt) btn.textContent = txt;
  }
}

// See frameFault: the wrapper re-arms only when the body threw.
function fsimFrame(now) {
  try { fsimFrameBody(now); }
  catch (err) {
    frameFault('flight', err);
    if (_fsim && document.getElementById('fsim-root')) _fsim.raf = requestAnimationFrame(fsimFrame);
  }
}
function fsimFrameBody(now) {
  const F = _fsim; if (!F) return;
  const root = document.getElementById('fsim-root');
  if (!root) { closeFlightSim(); return; }
  const dt = clampNum((now - F.last) / 1000, 0, 0.25); F.last = now;
  const { s, P, input } = F;

  // The cinematics freeze physics and render themselves.
  if (F.deckCine) { stepDeckLanding(F, now); F.raf = requestAnimationFrame(fsimFrame); return; }
  if (F.crashCine) { stepCrashBreakup(F, now); F.raf = requestAnimationFrame(fsimFrame); return; }
  // ⚠ Once landed, hold the last frame; resuming the sim would flash the craft airborne again.
  if (F.landed) { F.raf = requestAnimationFrame(fsimFrame); return; }

  // ⚠ Opened after the early returns above, or each cinematic frame leaks an unclosed perf entry.
  perfBegin('frame');

  mouseStick.step(dt);
  // Yoke springs to centre when released. ⚠ An armed stick counts as a hand on it, or the spring fights the mouse.
  const stickOn = mouseStick.armed && !F.yokeDrag;
  if (!F.yokeDrag && !stickOn) { input.elevator = lerpN(input.elevator, 0, Math.min(1, dt * 6)); input.aileron = lerpN(input.aileron, 0, Math.min(1, dt * 6)); }
  // ⚠ The yoke pad wins over the armed stick.
  if (stickOn) { input.aileron = mouseStick.x; input.elevator = mouseStick.y; }
  freeCam.step(dt);
  // Dive computer: after the spring, before the model. ⚠ A deflected stick cancels it; merely armed doesn't.
  const handOn = F.yokeDrag || mouseStick.deflected;
  if (F.diveAuto && !handOn) F.flyDiveAuto(F.s, input, dt);
  else if (F.diveAuto && handOn) { F.diveAuto = null; fsimToast('◇ DIVE COMPUTER OFF: you have it'); }
  // The button follows the state, which changes on its own.
  if (F.diveAuto !== F._diveBtnState) {
    F._diveBtnState = F.diveAuto;
    const db = document.getElementById('fsim-divebtn');
    if (db) { db.classList.toggle('hot', !!F.diveAuto); db.textContent = F.diveAuto === 'pull' ? '⤴ PULL' : '⤵ DIVE'; }
  }
  if (F.orbitResetting) {
    const k = Math.min(1, dt * 6);
    F.extOrbit = lerpN(F.extOrbit || 0, 0, k);
    F.extPitch = lerpN(F.extPitch ?? REST_PITCH, REST_PITCH, k);
    F.extZoom = lerpN(F.extZoom || 1, 1, k);
    if (Math.abs(F.extOrbit) < 0.3 && Math.abs((F.extPitch ?? REST_PITCH) - REST_PITCH) < 0.005 && Math.abs((F.extZoom || 1) - 1) < 0.01) {
      F.extOrbit = 0; F.extPitch = REST_PITCH; F.extZoom = 1; F.orbitResetting = false;
    }
  }
  if (F.throttleKey) input.throttle = clampNum(input.throttle + F.throttleKey * dt * 0.5, 0, 1);
  input.pedal = F.pedalKey ? clampNum(input.pedal + F.pedalKey * dt * 2.2, -1, 1) : lerpN(input.pedal, 0, Math.min(1, dt * 12));
  // Gear up on the ground: no thrust until it's down. ⚠ Not a Drake on the water.
  const bellyDown = s.onGround && F.gearRetract && F.gearUp && !(F.dk && F.dk.onWater);
  // Open cargo nose: the throttle is baulked at idle (noThrust is the backstop).
  const visorLocked = !F.hasVisor || (F.noseVisor ?? 0) <= 0.02;
  if (!visorLocked) {
    if ((input.throttle > 0.02 || F.throttleKey > 0) && !(F.visorBaulkT > 0)) {
      F.visorBaulkT = 2.5;                       // one toast per held key
      if (F.toast) F.toast('THROTTLE BAULKED: cargo nose is open.');
    }
    input.throttle = 0; F.throttleKey = 0;
  }
  if (F.visorBaulkT > 0) F.visorBaulkT = Math.max(0, F.visorBaulkT - dt);
  const thr = (F.engineOn && !F.deadStick && !bellyDown) ? input.throttle : 0;

  // Weather and thermals are sampled once per frame and held across the sub-steps.
  const atmos = F.atmos = weatherAtmos(F, now);
  // Thermal lift uses the same field the server bounds engine-off climb with. Vario only when soaring.
  varioTick(s.vs, !s.onGround && (!F.engineOn || F.deadStick || (F.input?.throttle ?? 1) <= 0.25));
  F.lift = s.onGround ? 0 : thermalLift(F.pos.x, F.pos.y, s.altitude || 0, Date.now(), F.sky, (x, y) => heatOfCell(mapCellAt(F, x, y)));
  window.__thermalHere = { lift: F.lift, alt: s.altitude || 0, vs: s.vs || 0, at: Date.now() };   // read by `thermals`
  if (F.lift) atmos.turb = Math.min(1, atmos.turb + Math.min(0.28, Math.abs(F.lift) / 2200));

  // ── Fixed-timestep physics ────────────────────────────────────────────────────
  // Fixed 1/60 s steps so handling is frame-rate independent; capped at 0.5 s and 8 steps after a stall.
  const FIXED = 1 / 60;
  s.groundFt = deckFloorFt(F, s);
  F.acc = Math.min((F.acc || 0) + dt, 0.5);
  let nSteps = 0;
  perfBegin('sim:physics');
  while (F.acc >= FIXED && nSteps < 8) {
    const h = FIXED;
    // gear: fixed gear reports 0 (its drag is in dragP). collRaw and power let a heli autorotate.
    step(s, { lift: F.lift || 0, elevator: input.elevator, aileron: input.aileron, throttle: thr, collRaw: input.throttle, power: (F.engineOn && !F.deadStick && !bellyDown), noThrust: !visorLocked, flaps: input.flaps, pedal: input.pedal, trim: input.trim, gear: F.gearRetract ? (F.gearAnim ?? 1) : 0, dmgSurf: F.surfaces || null }, P, h);
    // BOAT / SUB: the tail rotor pushes, the throttle sets speed, pedals and stick steer.
    if (F.dk?.boat && (F.dk.onWater || F.waterBelow) && F.engineOn && !F.deadStick) {
      const under = F.dk.submerged > 0, vmax = under ? SUB_MAX_KT : BOAT_MAX_KT;
      s.onGround = true; s.vs = 0; s.altitude = s.groundFt || 0; s.bank = 0;
      // Under water the yoke points the nose and it holds; the vertical part of travel becomes the
      // ballast order (D.subVz), so the pilot never works the tanks.
      const D = F.dk;
      if (under) D.subPitch = clampNum((D.subPitch || 0) + (input.elevator || 0) * 55 * h, -75, 75);
      else D.subPitch = (D.subPitch || 0) * Math.max(0, 1 - h * 2);
      s.pitch = D.subPitch;
      const pr = D.subPitch * Math.PI / 180, v = (input.throttle || 0) * vmax;
      // Nose down on the seabed: she slides along it.
      const onBottom = under && D.subPitch < 0 && D.subFloor != null && D.submerged >= D.subFloor - 1.1;
      const along = under ? (onBottom ? 1 : Math.cos(pr)) : 1;
      s.airspeed += (v * along - s.airspeed) * Math.min(1, h * (under ? 0.8 : 0.5));
      D.subVz = under ? v * 0.514 * Math.sin(pr) : 0;
      const steer = clampNum((input.pedal || 0) + (input.aileron || 0), -1, 1);
      // Submerged she turns on the spot; on the surface she needs way on.
      const bite = under ? 1 : Math.min(1, (Math.abs(s.airspeed) + 3) / 14);
      s.heading = ((s.heading + steer * (under ? 40 : 34) * bite * h) % 360 + 360) % 360;
    }

    for (const ev of (s.events || [])) {
      if (ev.type === 'overg') { creak('stress'); F.overGLamp = 1.4; F.shake = Math.max(F.shake, 5); }
    }
    if (F.overGLamp > 0) F.overGLamp = Math.max(0, F.overGLamp - h);

    // Turbulence disturbs the attitude, never the physics. Deterministic sines, no RNG.
    if (atmos.turb > 0.01 && !s.onGround) {
      const t = now * 0.001, g = atmos.turb;
      const nRoll = Math.sin(t * 3.1) + 0.6 * Math.sin(t * 7.7 + 2) + 0.8 * Math.sin(t * 1.3);
      const nPitch = Math.sin(t * 2.3 + 1.5) + 0.6 * Math.sin(t * 5.1 + 0.7);
      s.bank = clampNum(s.bank + nRoll * g * 5.5 * h, -70, 70);
      s.pitch = clampNum(s.pitch + nPitch * g * 3.5 * h, -35, 35);
      s.vs += nRoll * g * 130 * h;
    }

    // |airspeed|, so a heli backing up moves rearward.
    if (Math.abs(s.airspeed) > 0.5) {
      const pace = paceAt(s.altitude, P.worldPaceMult || 1);
      const d = Math.abs(s.airspeed) * pace * h, hr = s.heading * Math.PI / 180;   // odometer is magnitude
      // Wind drifts the ground track only when airborne.
      let vx = Math.sin(hr) * s.airspeed, vy = -Math.cos(hr) * s.airspeed;
      if (!s.onGround && atmos.windKt > 0.2) { const wr = atmos.windDir * Math.PI / 180; vx += Math.sin(wr) * atmos.windKt; vy += -Math.cos(wr) * atmos.windKt; }
      F.pos.x += vx * pace * h; F.pos.y += vy * pace * h;
      F.travel += d;
      if (F.engineOn) F.rollDist += d;
    }
    F.acc -= FIXED; nSteps++;
  }
  perfEnd();   // sim:physics

  // Gear eases 0 (up) to 1 (down).
  if (F.gearRetract && F.dk) {
    // The Drake's runs at a constant 3 s so the mesh sequence matches the sound.
    const tgt = F.gearUp ? 0 : 1, g0 = F.gearAnim ?? 1;
    F.gearAnim = g0 + clampNum(tgt - g0, -dt / 3, dt / 3);
  } else if (F.gearRetract) { const tgt = F.gearUp ? 0 : 1; F.gearAnim = lerpN(F.gearAnim ?? 1, tgt, Math.min(1, dt / 1.6)); }
  if (F.dk) {
    const D = F.dk;
    D.conv += clampNum((D.wing ? 1 : 0) - D.conv, -dt / 7, dt / 7);      // 7 s end to end
    D.ramp += clampNum((D.rampOpen ? 1 : 0) - D.ramp, -dt / 4, dt / 4);
    const want = D.conv >= 0.5 ? D.wingP : D.rotorP;
    if (want && F.P !== want) { F.P = want; F.heli = !!want.heli; }
  }
  else F.gearAnim = 1;

  // Leviathan cargo visor: open when cold and parked, linear 5 s travel.
  if (F.hasVisor === undefined) F.hasVisor = !!visorSpecFor(F.cls);
  if (F.hasVisor) {
    // The switch wins while parked; any movement drops the override.
    const parked = s.onGround && s.airspeed < 5;
    if (!parked) F.visorWant = null;
    const tgt = (parked && F.visorWant != null) ? F.visorWant : ((!F.engineOn && parked) ? 1 : 0);
    if (F.noseVisor === undefined) F.noseVisor = tgt;   // no sweep on boarding
    const stepV = dt / 5;
    const wasOpen = F.noseVisor > 0.02;
    F.noseVisor = F.noseVisor < tgt ? Math.min(tgt, F.noseVisor + stepV) : Math.max(tgt, F.noseVisor - stepV);
    if (wasOpen && F.noseVisor <= 0.02) { if (F.toast) F.toast('NOSE LOCKED: cleared to taxi.'); }
    // The LED follows the visor, not the request.
    if (F._visorBtn === undefined) F._visorBtn = document.getElementById('fsim-visorsw');
    if (F._visorBtn) F._visorBtn.classList.toggle('on', F.noseVisor > 0.02);
    if (F._thrBox === undefined) F._thrBox = document.getElementById('fsim-thr');
    if (F._thrBox) F._thrBox.classList.toggle('baulked', F.noseVisor > 0.02);
  }

  // ── Rooftop helideck auto-land ────────────────────────────────────────────────────
  // Fly into the catch column and the deck brings you down; CFIT is suppressed during the lock.
  const roofProx = (F.heli && !F.landed && !F.deckCine && F.reportedAirborne) ? padProximity(F) : null;
  const roofCeil = roofProx ? padCeilFt(roofProx.padZ, roofProx.padFt) : 0;
  // The arrive/depart decision lives in pad-catch.js, under a headless gate.
  const roofStep = padCatchStep(F.roofDeparted, roofProx, roofCeil, s, ROOF_CATCH_R);
  F.roofDeparted = roofStep.departed;
  const roofArmed = roofStep.armed;
  F.roofPadShow = !!(roofProx && roofProx.dist <= 3.5);
  F.roofPadArmed = roofArmed;   // lit only when it will take you
  if (roofProx && !F.roofLock && !roofArmed && !F.roofNoticed && F.roofDeparted === true
      && roofProx.dist <= ROOF_CATCH_R * 1.6 && s.altitude > roofProx.padFt + roofCeil
      && s.altitude <= roofProx.padFt + roofCeil + 160) {
    F.roofNoticed = true;
    if (F.toast) F.toast('⚠ PAD GUIDANCE: descend into the green column and the deck will bring you down.');
  }
  if (roofArmed && !F.roofLock) startRoofLanding(F, s, now, roofProx);
  if (F.roofLock) { stepRoofLanding(F, s, now); F.cfitCd = Math.max(F.cfitCd || 0, 1); }
  else if (!roofProx) F.roofNoticed = false;

  // ── Building collision (CFIT) ─────────────────────────────────────────────
  perfBegin('sim:cfit');
  if (!s.onGround && !(F.cfitCd > 0)) {
    const hit = buildingCollisionAt(F, s);
    if (hit && hit.severe) {
      F.cfitCd = 9999; F.reportedAirborne = false; F.rolling = false;
      groundFx('touchdownHard'); csfx('flight-crash', 'hololock-lose');
      F.shake = 20;
      beginCrashBreakup(F, 'cfit');
      if (F.toast) F.toast('CRASH: you flew into a building');
    } else if (hit) {
      // A slow contact bounces: shoved back along the track, never popped up onto the roof.
      F.cfitCd = 1.6;
      F.hull = Math.max(0, (F.hull || 100) - 6); F.hitFlashT = performance.now();
      const hd = (s.heading || 0) * Math.PI / 180;
      F.pos.x -= Math.sin(hd) * 0.16; F.pos.y += Math.cos(hd) * 0.16;
      s.airspeed = 0; s.vs = Math.min(s.vs, 0);
      s.bank = clampNum(s.bank + (s.bank >= 0 ? 6 : -6), -70, 70);
      groundFx('touchdownHard'); csfx('flight-touchdown', 'hololock-lose');
      F.shake = 8;
      sendCmdSilent('flightevent clip');
      if (F.toast) F.toast('⚠ You bumped the wall, back it off.');
    }
  }
  if (F.cfitCd > 0 && F.cfitCd < 9999) F.cfitCd = Math.max(0, F.cfitCd - dt);
  F.cfitPrev = { x: F.pos.x, y: F.pos.y };
  perfEnd();   // sim:cfit
  // ⚠ No early returns until this phase closes.
  perfBegin('sim:systems');

  // The Drake on the water (drake-water.js).
  if (F.dk) {
    // ⚠ Water by the server's biome OR the client's seabed depth: past the map edge the biome says nothing.
    { const dm = depthMAt(F.pos.x + 0.5, F.pos.y + 0.5); F.waterBelow = F.biomeBelow === 'water' || (dm != null && dm > 0.3); }
    const pace = RENDER_TUNE.worldPace * (P.worldPaceMult || 1) * RENDER_TUNE.groundBoost;
    const wr = drakeWaterFrame(F, s, dt, Date.now(), drakeSeaAmps(F), pace);
    F.dk.ride = wr.ride;
    F.dk.flarePitch = wr.flare;
    // The surface crossing: subVis eases toward the server's per-second depth, slowly in the top 2 m.
    // Where the eye crosses is windshield.js's call (subCrossing).
    {
      const D = F.dk, SLOW_M = 2.0;
      const target = D.submerged || 0;
      let vis = D.subVis || 0;
      const nearTop = vis < SLOW_M;
      vis += clampNum(target - vis, -(nearTop ? 0.55 : 3.2) * dt, (nearTop ? 0.4 : 2.4) * dt);
      if (target <= 0 && vis < 0.01) vis = 0;
      D.subVis = vis;
      // Afloat she sits down in the water and the gun stubs swing up ('boat' channel).
      D.floatVis = (D.floatVis || 0) + clampNum((D.onWater || D.boat || vis > 0 || (F.waterBelow && !F.onYacht && (s.altitude || 0) - (s.groundFt || 0) < 4) ? 1 : 0) - (D.floatVis || 0), -dt * 0.8, dt * 0.8);
      const cr = subCrossing(), eyeUnder = !!cr.under, was = !!D.eyeUnder;
      // Plunge/breach sounds come off the 'sea:crossing' event (engine-audio.js crossingFx).
      D.eyeUnder = eyeUnder;
      D.uw = (D.uw || 0) + clampNum((eyeUnder ? 1 : 0) - (D.uw || 0), -dt * 1.5, dt * 2.5);
    }
    // Ballast animates at the server's rates between reports; a report off by more than a quarter snaps it.
    {
      const D = F.dk;
      // A dive request with no answer was refused.
      if (D.subBlowLocal === false && !(D.submerged > 0) && D.subAskAt && performance.now() - D.subAskAt > 3000) {
        D.subBlowLocal = null; D.subAskAt = 0; D.subPending = null;
        fsimToast(F.engineOn ? 'SUB: she would not go under' : 'SUB: start the engine first');
      }
      const blowing = D.subBlowLocal ?? D.subBlow ?? true;
      const want = blowing ? 0 : 1;
      let b = D.ballastVis ?? 0;
      if (!D.subPending && !(D.subBlowLocal === false && !(D.submerged > 0)) && Math.abs(b - (D.subBallast || 0)) > 0.25) b = D.subBallast || 0;
      const prev = b;
      b += clampNum(want - b, -dt / (D.subBlowS || 3), dt / (D.subFloodS || 4));
      D.ballastVis = b;
      // Vent flow 0..1; the 3-D view hangs bubbles off it.
      D.ventFlood = b > prev ? Math.min(1, (b - prev) / dt * (D.subFloodS || 4)) : 0;
      D.ventBlow = b < prev ? Math.min(1, (prev - b) / dt * (D.subBlowS || 3)) : 0;
    }
    // Dive planes. ⚠ Resent every second while held: the server drops an unrenewed order (PLANES_STALE_S).
    {
      const D = F.dk;
      const flooded = D.submerged > 0 && !(D.subBlowLocal ?? D.subBlow ?? true);
      // Trim sets the dive or rise rate, plus the vertical share of the yoke-pointed travel.
      // Trimming down with the tanks blown floods them again.
      const under = D.submerged > 0;
      // Mirrors PLANE_MS in plugins/submersible (m/s).
      const PL_MS = 5;
      const yokePl = clampNum(-(D.subVz || 0) / PL_MS, -1, 1);
      let pl = under ? clampNum(-clampNum((input.trim || 0) / (F.TRIM_MAX || 0.6), -1, 1) + yokePl, -1, 1) : 0;
      if (Math.abs(pl) < 0.08) pl = 0;
      if (under && !flooded && pl > 0 && performance.now() - (D.refloodAt || 0) > 1500) {
        D.refloodAt = performance.now(); D.subBlowLocal = false;
        try { gearFx('flood'); } catch {}
        sendCmdSilent('submerge ' + Math.max(5, Math.round((D.submerged || 0) + 3)));
      }
      pl = Math.round(pl * 20) / 20;
      const nowT = performance.now();
      const last = D.planesSent ?? 0;
      if (flooded && (Math.abs(pl - last) >= 0.1 || (pl !== last && pl === 0) || (pl !== 0 && nowT - (D.planesAt || 0) > 1000))) {
        sendCmdSilent('submerge planes ' + pl.toFixed(2));
        D.planesSent = pl; D.planesAt = nowT;
      } else if (!flooded) D.planesSent = 0;
      D.planesVis = pl;
    }
    {
      const box = document.getElementById('fsim-sub');
      const inWater = F.dk.onWater || F.dk.submerged > 0;
      if (box) box.style.display = inWater ? '' : 'none';
      if (inWater) drawSubGauge(F.dk);
      {
        let hm = document.getElementById('fsim-navhome');
        if (!hm && inWater && box?.parentElement) { box.parentElement.insertAdjacentHTML('beforeend', navHomeHTML()); hm = box.parentElement.lastElementChild; hm.id = 'fsim-navhome'; }
        drawNavHome(hm, { x: F.pos.x, y: F.pos.y, heading: s.heading, homeX: F.home.x, homeY: F.home.y, show: inWater });
      }
      const rd = inWater && document.getElementById('fsim-subread');
      if (rd) {
        const air = F.dk.subAir, max = F.dk.subAirMax;
        const airTxt = air != null && max ? ' · AIR ' + Math.round(air / max * 100) + '%' : '';
        rd.textContent = (F.dk.submerged > 0 ? '▼ ' + F.dk.submerged.toFixed(1) + ' m' + (F.dk.subRating ? ' / ' + F.dk.subRating : '') : 'SURFACE') + airTxt;
        rd.classList.toggle('low', air != null && max ? air / max < 0.25 : false);
      }
    }
    if (wr.drag && s.onGround && s.airspeed > 0) s.airspeed = Math.max(0, s.airspeed - wr.drag * dt);
    F.dk.gearWarnT = (F.dk.gearWarnT || 0) - dt;
    if (wr.gearWarn && F.dk.gearWarnT <= 0) { F.dk.gearWarnT = 6; if (F.toast) F.toast('⚠ GEAR DOWN OVER WATER: raise it, she lands on her hull'); }
    if (F.dk.boat && !F.waterBelow && !(F.dk.submerged > 0)) F.dk.boat = false;
    // Setting down on water never changes mode; BOAT is the pilot's call.
    if (wr.snap) drakeSnapFeet(F);
    // Feet up over land: warn, never lower them for the pilot.
    F.dk.feetWarnT = (F.dk.feetWarnT || 0) - dt;
    if (wr.autoGearDown && F.dk.feetWarnT <= 0) { F.dk.feetWarnT = 6; if (F.toast) F.toast('⚠ FEET UP OVER LAND: lower the gear'); }
    if (wr.hullPct) {
      sendCmdSilent('flightevent wave ' + wr.hullPct);
      F.hitFlashT = performance.now(); F.shake = Math.max(F.shake || 0, 4 + wr.hullPct * 0.4);
      try { gearFx('splash'); } catch {}
    }
  }

  // Transitions to the server; sink rate is tracked for the touchdown.
  if (!s.onGround) { F.touchVs = s.vs; F.peakAltSinceLift = Math.max(F.peakAltSinceLift || 0, s.altitude); }
  if (!s.onGround && !F.reportedAirborne) { F.reportedAirborne = true; F.rolling = false; F.peakAltSinceLift = s.altitude; F.liftFloorFt = s.groundFt || 0; groundFx('liftoff'); sendCmdSilent('flightevent takeoff'); }
  if (s.onGround && F.reportedAirborne) {
    F.reportedAirborne = false;
    const sinkFpm = -(F.touchVs || 0);   // ft/min, positive sinking
    // A takeoff bounce isn't a landing: the crash checks arm only after 25 ft of climb.
    // ⚠ Measured above the deck she left, never absolute altitude (rooftop pads).
    const establishedClimb = (F.peakAltSinceLift || 0) - (F.liftFloorFt || 0) >= 25;
    // Water is a ditching, except at the Echelon (F.onYacht) and for the Drake, judged by drake-water.js.
    const dkWater = !!(F.dk && (F.waterBelow ?? F.biomeBelow === 'water') && !F.onYacht);
    const dkV = dkWater ? judgeWaterTouchdown({ sinkFpm, kt: s.airspeed, gearDown: !F.gearRetract || !F.gearUp, feetGone: !!F.dk.feetGone, rough: seaRough(drakeSeaAmps(F)) }) : null;
    const overWater = F.biomeBelow === 'water' && !F.onYacht && !(dkV && !dkV.ditch);
    if (dkV && !dkV.ditch && establishedClimb) {
      try { gearFx('splash'); } catch {}
      if (dkV.snap) drakeSnapFeet(F);
      if (dkV.hullPct) sendCmdSilent('flightevent wave ' + dkV.hullPct);
      const feet = (!F.gearRetract || !F.gearUp) && !F.dk.feetGone;
      if (F.toast) F.toast(dkV.snap ? '⚠ FEET TORN OFF: land on the water gear up' : feet ? 'ON THE WATER: feet out, raise the gear' : 'ON THE WATER: on her hull · BOAT to drive');
    }
    sendCmdSilent(`flightsync ${F.pos.x.toFixed(2)} ${F.pos.y.toFixed(2)} 0 ${Math.round(s.airspeed)} ${Math.round(s.heading)} ${Math.round(thr * 100)} 0 1 0`);
    if (overWater && establishedClimb) {
      F.rolling = false;
      groundFx('touchdownHard'); csfx('flight-crash', 'hololock-lose');
      F.shake = 16;
      beginCrashBreakup(F, 'ditched');
      if (F.toast) F.toast('CRASH: you ditched in the water');
    } else if (sinkFpm > 800 && establishedClimb && !dkWater) {
      F.rolling = false;
      groundFx('touchdownHard'); csfx('flight-crash', 'hololock-lose');
      F.shake = 18;
      beginCrashBreakup(F, 'hardlanding');
      if (F.toast) F.toast('CRASH: you slammed it in too hard');
    } else {
      // Touchdown: the sim stays open for the roll-out (or a touch-and-go).
      F.rolling = true; F.stopHinted = !!F.heli; F.landed = false;
      groundFx((F.touchVs || 0) < -500 ? 'touchdownHard' : 'touchdown');
      F.shake = clampNum(sinkFpm / 55, 0, 14);
      // Graded only for a real arrival; a takeoff bounce reports no landing.
      if (establishedClimb) {
        F.landGrade = landingGrade(sinkFpm).grade; F.landFpm = Math.round(sinkFpm);
        showLandingCard(root, sinkFpm);
        if (F.toast) F.toast(F.heli ? 'DOWN: lift off again, or type disembark to climb out' : 'ROLL OUT: brake to a stop, then cut the ENGINE to park');
      } else { F.landGrade = null; F.landFpm = 0; }
    }
  }
  // Stopped: a fixed-wing at a field parks itself; a heli parks only on the Echelon, else prompt.
  if (F.rolling && s.onGround && s.airspeed < 5) {
    if ((F.onField && !F.heli) || (F.heli && F.onYacht)) finishLanding(F, s);
    else if (!F.stopHinted) { F.stopHinted = true; if (F.toast) F.toast(F.heli ? 'DOWN: type disembark to climb out' : 'STOPPED: cut the ENGINE to shut down & park'); }
  }

  // Client-side, because the server's onYacht lags a fast pass out of the catch.
  const prox = yachtProximity(F);
  const nearPad = !!(prox && prox.dist <= YACHT_CATCH_RADIUS);

  // ⚠ Departure latch: leave the radius or climb past the ceiling before she can grab you again.
  const YACHT_REARM_FT = YACHT_CATCH_CEIL_FT + 50;   // buffer against chatter at the lip
  if (s.onGround && nearPad) F.yachtDeparted = false;
  else if (!nearPad || s.altitude > YACHT_REARM_FT) { F.yachtDeparted = true; F.autoLandNoticed = false; }

  if (F.heli && nearPad && F.yachtDeparted && !s.onGround && !F.landed && !F.deckCine && F.reportedAirborne
      && s.altitude <= 440 && s.altitude > YACHT_CATCH_CEIL_FT && !F.autoLandNoticed) {
    F.autoLandNoticed = true;
    if (F.toast) F.toast('⚠ AUTO-LAND ARMING: drop into the green zone over the pad and she\'ll bring you down.');
  }
  // Capture on entry, with no speed or sink gate.
  if (F.heli && nearPad && F.yachtDeparted && !s.onGround && !F.landed && !F.deckCine && F.reportedAirborne
      && s.altitude <= YACHT_CATCH_CEIL_FT) {
    startDeckLanding(F, s, now, prox);
  }

  fsimHorn(F, dt);

  const r = readout(s, P), d = F.disp;
  d.ias = lerpN(d.ias, r.airspeed, Math.min(1, dt * 6)); d.alt = lerpN(d.alt, r.altitude, Math.min(1, dt * 5));
  // The big IAS/ALT gauges show in the external view and on mobile.
  {
    const ig = document.getElementById('fsim-extg-ias'); if (ig) ig.textContent = Math.round(d.ias);
    const ag = document.getElementById('fsim-extg-alt'); if (ag) ag.textContent = Math.round(d.alt);
  }
  d.vs = lerpN(d.vs, r.vs, Math.min(1, dt * 4)); d.rpm = lerpN(d.rpm, r.rpm, Math.min(1, dt * 6));
  d.pitch = lerpN(d.pitch, r.pitch, Math.min(1, dt * 10)); d.bank = lerpN(d.bank, r.bank, Math.min(1, dt * 10));
  const dh = ((r.heading - d.hdg + 540) % 360) - 180; d.hdg = (d.hdg + dh * Math.min(1, dt * 6) + 360) % 360;

  paintPFD(document.getElementById('fsim-pfd'), {
    // A Drake on the water rocks with the sea.
    pitch: d.pitch + (F.dk?.onWater && F.dk.ride ? F.dk.ride.pitch : 0) + (F.dk?.flarePitch || 0), bank: d.bank + (F.dk?.onWater && F.dk.ride ? F.dk.ride.roll : 0), ias: d.ias, alt: d.alt, vs: d.vs, hdg: d.hdg, slip: r.slip || 0,
    vr: P.vr, vne: P.vne, vs0: P.vs0, sm: s.stallMargin, fuelPct: Math.round(F.fuel / (F.fuelCap || 1) * 100),
    warn: r.stalled || s.stallMargin < 0.35, bingo: F.fuel <= 0 || F.warn === 'BINGO', night: F.nightLight,
  });
  paintMFD(document.getElementById('fsim-mfd'), F, d);

  // Placard sheen tracks daylight and weather.
  if (root) {
    const hr = F.sky?.hour ?? 12;
    const day = clampNum(Math.sin(clampNum((hr - 6) / 12, 0, 1) * Math.PI), 0, 1);
    const wx = (F.sky?.weather || 'clear').toLowerCase();
    const wxMul = wx === 'clear' ? 1 : wx === 'cloudy' ? 0.5 : wx === 'fog' ? 0.28 : 0.4;
    root.style.setProperty('--sheen', (day * wxMul * 0.42).toFixed(2));
  }

  // Cosmetic: the one sim rpm fanned out per engine with a little wander and thermal lag.
  const nEng = Math.max(1, F.engines || 1);
  if (F.rpms.length !== nEng) F.rpms = new Array(nEng).fill(0);
  if (F.temps.length !== nEng) F.temps = new Array(nEng).fill(F.temp || 40);
  F.engWander += dt;
  const engRunning = F.engineOn && s.rpm > 0.02;
  for (let i = 0; i < nEng; i++) {
    const wob = engRunning ? Math.sin(F.engWander * 1.3 + i * 2.2) * 0.02 : 0;
    F.rpms[i] = clampNum(s.rpm * (1 + wob), 0, 1);
    F.temps[i] = lerpN(F.temps[i], 40 + F.rpms[i] * 175 + i * 7, Math.min(1, dt * 0.35));
  }
  F.temp = F.temps[0];
  F.battery = clampNum(F.battery + ((F.engineOn && s.rpm > 0.2) ? 5 : -1.1) * dt, 0, 100);
  paintGauges(document.getElementById('fsim-gauges'), {
    engines: nEng, rpms: F.rpms, temps: F.temps, eng: F.engStyle,
    rpm: F.rpms[0], temp: F.temps[0], ias: r.airspeed, vr: P.vr, vne: P.vne, vs0: P.vs0,
    fuelPct: Math.round(F.fuel / (F.fuelCap || 1) * 100), battery: F.battery,
    stall: r.stalled, warn: r.stalled || s.stallMargin < 0.35, hornBeat: F.hornBeat, night: F.nightLight,
    lowNr: !!s.lowNr, vrs: !!s.vrs, autorot: !!s.autorot,   // heli annunciators
    craft: F.craftType, engineOn: F.engineOn, airborne: F.reportedAirborne, prpm: F.rpms[0] || 0,
    gear: F.gearRetract ? (F.gearUp ? 'up' : 'down') : 'fixed',
    hasVisor: !!F.hasVisor, noseVisor: F.noseVisor ?? 0,

    hardpoints: F.hardpoints, armed: F.armed, weapon: F.weapon, msl: F.msl,
    gunRounds: F.gunRounds, gunCap: F.gunCap,
    avionicsOut: !!F.avionicsOut,   // EMP: the panel is dark
  });

  const yk = document.getElementById('fsim-yoke-svg');
  if (yk) yk.style.transform = `translateX(${input.aileron * 7}px) translateY(${input.elevator * 18}px) rotateX(${-input.elevator * 34}deg) rotateZ(${input.aileron * 30}deg) scale(${1 + Math.max(0, input.elevator) * 0.2})`;
  const pd = input.pedal || 0;
  if (F.pedalLFace) F.pedalLFace.style.setProperty('--d', Math.max(0, -pd).toFixed(3));
  if (F.pedalRFace) F.pedalRFace.style.setProperty('--d', Math.max(0, pd).toFixed(3));
  if (F.pedalL) F.pedalL.classList.toggle('act', pd < -0.04);
  if (F.pedalR) F.pedalR.classList.toggle('act', pd > 0.04);
  const gL = document.getElementById('fsim-yk-green'), rL = document.getElementById('fsim-yk-red');
  const atClimb = input.elevator > 0.40 && input.elevator < 0.66;
  const stalling = r.stalled || s.stallMargin < 0.35;
  // Left LED: green near a best-climb pull, blue at best-glide speed with little power (glide wins).
  const bg = P.bestGlide || 0;
  const atGlide = !s.onGround && thr < 0.15 && bg > 0 && Math.abs(s.airspeed - bg) <= Math.max(3, bg * 0.06);
  if (gL) {
    if (atGlide) { gL.setAttribute('fill', 'url(#ykblue)'); gL.style.opacity = '1'; gL.style.filter = 'drop-shadow(0 0 5px #4fb8e0)'; }
    else if (atClimb) { gL.setAttribute('fill', 'url(#ykgreen)'); gL.style.opacity = '1'; gL.style.filter = 'drop-shadow(0 0 4px #3ad07a)'; }
    else { gL.setAttribute('fill', 'url(#ykgreen)'); gL.style.opacity = '0.2'; gL.style.filter = 'none'; }
  }
  if (rL) { rL.style.opacity = stalling ? '1' : '0.2'; rL.style.filter = stalling ? 'drop-shadow(0 0 5px #e0403a)' : 'none'; }

  const lever = document.getElementById('fsim-thr-lever'), tv = document.getElementById('fsim-thrv');
  if (lever) lever.style.bottom = (10 + input.throttle * 70) + '%';
  if (tv) tv.textContent = Math.round(input.throttle * 100) + '%';

  const fuelWrap = document.getElementById('fsim-fuel');
  if (fuelWrap) {
    const pct = Math.max(0, Math.round(F.fuel / (F.fuelCap || 1) * 100));
    const pctEl = document.getElementById('fsim-fuel-pct'); if (pctEl) pctEl.textContent = pct + '%';
    fuelWrap.classList.toggle('low', pct <= 30 && pct > 15);
    fuelWrap.classList.toggle('bingo', pct <= 15);
    fuelWrap.classList.toggle('can-fuel', s.onGround && !!F.onField);
    fuelWrap.classList.toggle('full', pct >= 100);
  }

  document.getElementById('fsim-disembarkbtn')?.classList.toggle('on', !!s.onGround);

  // Glideslope guide near the departure runway, fixed-wing only.
  const rwDist = Math.hypot(F.rwOrigin.x - F.pos.x, F.rwOrigin.y - F.pos.y);
  const landGuide = (F.reportedAirborne && !F.heli && r.altitude < 1600 && rwDist < 16) ? { alt: r.altitude, boxes: !!F.checkride } : null;   // boxes on a checkride; alt drives the PAPI

  // ── Air traffic ─────────────────────────────────────────────────────────────
  // Dead-reckon contacts and designate the one nearest the boresight. contactNear drives the sync cadence.
  let contactView = null, designated = null, contactNear = Infinity;
  if (F.contacts && F.contacts.length && F.reportedAirborne) {
    contactView = [];
    let bestBore = Infinity;
    for (const c of F.contacts) {
      const drS = Math.min(CONTACT_DR_MAX, (now - (c.t || now)) / 1000);
      const spd = (c.ias || 0) * paceAt(c.alt), hr = (c.hdg || 0) * Math.PI / 180;
      const cx = c.x + Math.sin(hr) * spd * drS, cy = c.y - Math.cos(hr) * spd * drS;
      const dx = cx - F.pos.x, dy = cy - F.pos.y, rng = Math.hypot(dx, dy);
      if (rng < contactNear) contactNear = rng;
      const brg = Math.atan2(dx, -dy) * 180 / Math.PI;
      const bore = Math.abs(((brg - s.heading + 540) % 360) - 180);
      // A ground contact pins to groundZ 0; airborne ones use the altitude delta.
      const brk = surfaceBreakup(c.surfaces);
      const cv = c.onGround
        ? { id: c.id, dx, dy, groundZ: 0, altDiff: 0, ias: c.ias || 0, rng, bore, reg: c.reg, hullPct: c.hullPct, cls: c.cls, armed: c.armed, hdg: c.hdg, bank: c.bank, pitch: c.pitch, livery: c.livery, ...(c.cls === 'drake' && c.livery?.variant && c.livery.variant !== 'stock' ? { variant: c.livery.variant } : {}), firing: c.firing, breakup: brk, anim: c.anim || null, gearAnim: c.gear }
        : { id: c.id, dx, dy, altDiff: (c.alt || 0) - s.altitude, rng, bore, reg: c.reg, hullPct: c.hullPct, cls: c.cls, armed: c.armed, hdg: c.hdg, bank: c.bank, pitch: c.pitch, livery: c.livery, ...(c.cls === 'drake' && c.livery?.variant && c.livery.variant !== 'stock' ? { variant: c.livery.variant } : {}), firing: c.firing, breakup: brk, anim: c.anim || null, gearAnim: c.gear };
      contactView.push(cv);
      if (bore < bestBore) { bestBore = bore; designated = cv; }
    }
    if (designated) designated.designated = true;
  }
  F.designatedId = designated ? designated.id : null;

  // Gun solution: aimQuality 0..1 off the cone angle; the server trusts it within its own gate.
  F.gunSolution = null;
  if (designated && F.hardpoints > 0 && F.armed && F.weapon !== 'msl') {
    const elev = Math.atan2((designated.altDiff || 0) * GUN_ALT_K, Math.max(0.1, designated.rng)) * 180 / Math.PI;
    const totalOff = Math.hypot(designated.bore, elev - (s.pitch || 0));
    const inRange = designated.rng <= GUN_RANGE;
    let aimQ = inRange ? Math.max(0, 1 - totalOff / GUN_CONE) : 0;
    // Drake convergence weighting, never below 0.7.
    if (F.dk) aimQ *= 0.7 + 0.3 * Math.exp(-(((designated.rng - drakeConv()) / 0.6) ** 2));
    F.gunSolution = { id: designated.id, aimQuality: aimQ, ready: inRange && aimQ > 0.02 };
  }
  const solReady = !!(F.gunSolution && F.gunSolution.ready);

  // Seeker: holding a bogey in the envelope builds a lock; the server owns it (`airlock`).
  F.swarmReady = null;
  if (F.salvo > 1 && F.weapon === 'msl' && F.armed && F.hardpoints > 0 && F.reportedAirborne) {
    // Swarm: no lock cycle.
    if (designated && designated.rng <= MSL_RANGE && designated.bore <= SWARM_CONE) F.swarmReady = designated.id;
  } else if (F.weapon === 'msl' && F.armed && F.hardpoints > 0 && designated && F.reportedAirborne) {
    if (F.seekId !== designated.id) { F.seekId = designated.id; F.lockProg = 0; }
    const inEnv = designated.rng <= MSL_RANGE && designated.bore <= MSL_CONE;
    if (inEnv) {
      F.lockProg = Math.min(1, F.lockProg + dt * 1000 / MSL_LOCK_MS);
      if (F.lockProg >= 1 && F.lockId !== designated.id) {
        F.lockId = designated.id;
        sendCmdSilent(`airlock ${designated.id}`);
        try { lockTone(); } catch {}
        if (F.toast) F.toast('◉ LOCK: FIRE WHEN READY');
      }
    } else {
      F.lockProg = Math.max(0, F.lockProg - dt * 1.5);
      if (F.lockId && F.lockProg <= 0) { sendCmdSilent('airunlock'); F.lockId = null; if (F.toast) F.toast('LOCK LOST'); }
    }
  } else if (F.lockId || F.lockProg > 0 || F.seekId) {
    if (F.lockId) sendCmdSilent('airunlock');
    F.lockId = null; F.lockProg = 0; F.seekId = null;
  }

  // Trigger: guns burst at the client cadence (server caps), missiles one per squeeze, else a ground strafe.
  if (F.firing && F.armed && F.reportedAirborne) {
    if (F.weapon === 'bomb') {
      // One bomb per squeeze. The dive check here is only feel; the server decides.
      if (!F.fireHeld && F.bombs > 0 && (!F.lastBombMs || now - F.lastBombMs >= 2500)) {
        if (diveQuality(s) > 0) {
          F.lastBombMs = now;
          F.bombs = Math.max(0, F.bombs - 1);   // optimistic
          sendCmdSilent('bomb');
          if (F.paintPips) F.paintPips();
        } else if (!F.bombNagMs || now - F.bombNagMs > 1500) {
          F.bombNagMs = now;
          fsimToast("✜ NOSE DOWN: the rack won't release out of a dive");
        }
      }
    } else if (F.weapon === 'msl' && F.salvo > 1) {
      // Swarm: one ripple per squeeze, at a bogey or else the ground ahead.
      if (!F.fireHeld && F.msl > 0 && (!F.lastMslMs || now - F.lastMslMs >= SWARM_FIRE_MS)) {
        F.lastMslMs = now;
        const n = Math.min(F.salvo, F.msl);
        F.msl = Math.max(0, F.msl - F.salvo);     // optimistic
        sendCmdSilent(F.swarmReady ? `airfire swarm ${F.swarmReady}` : 'airfire swarm ground');
        F.muzzleT = now;
        launchShots(F, now, n, F.swarmReady ? { id: F.swarmReady } : groundAim(F, s), 1);
        try { missileRippleFx(n, F.external); } catch {}
        if (F.paintPips) F.paintPips();
      }
    } else if (F.weapon === 'msl') {
      if (!F.fireHeld && F.lockId && F.msl > 0 && (!F.lastMslMs || now - F.lastMslMs >= MSL_FIRE_MS)) {
        F.lastMslMs = now;
        F.msl = Math.max(0, F.msl - 1);   // optimistic
        sendCmdSilent(`airfire missile ${F.lockId}`);
        F.muzzleT = now;
        launchShots(F, now, 1, { id: F.lockId }, 0.15);   // locked: little wander
        try { missileFx(); } catch {}
        if (F.paintPips) F.paintPips();
      }
    } else if (!F.lastFireMs || now - F.lastFireMs >= F.gunMs) {
      F.lastFireMs = now;
      F.muzzleT = now;
      // FX every squirt; the command only at the server's burst cadence (see GUN_CMD_AIR_MS).
      const cmdGap = solReady ? GUN_CMD_AIR_MS : GUN_CMD_GROUND_MS;
      if (!F.lastGunCmdMs || now - F.lastGunCmdMs >= cmdGap) {
        F.lastGunCmdMs = now;
        if (solReady) sendCmdSilent(`airfire guns ${F.gunSolution.id} ${F.gunSolution.aimQuality.toFixed(2)}`);
        else if (F.hardpoints > 0) sendCmdSilent('fire');
      }
      F.gunRounds = Math.max(0, F.gunRounds - (F.chinGun ? 30 : 65));
      try { gunFx(F.external, F.chinGun); } catch {}
    }
  }
  F.fireHeld = F.firing;   // edge detect: one missile per squeeze
  const retEl = document.getElementById('fsim-reticle');
  if (retEl) {
    retEl.classList.toggle('lock', solReady || !!F.lockId || !!F.swarmReady);
    retEl.classList.toggle('seek', F.weapon === 'msl' && F.lockProg > 0 && !F.lockId);
  }

  // Target guide: the selected destination as a live offset; falls back to the first when it drops out.
  let apTarget = null;
  // A GPS destination lasts only while the guide is on it.
  if (F.gpsDest && F.apTargetId !== 'gps') F.gpsDest = null;
  const fieldList = [...(F.gpsDest ? [F.gpsDest] : []), ...(F.waypoint ? [F.waypoint] : []), ...(Array.isArray(F.fields) ? F.fields : []), ...(Array.isArray(F.landmarks) ? F.landmarks : []), ...(Array.isArray(F.regions) ? F.regions : [])];
  const nmEl = document.getElementById('fsim-tgt-name');
  if (F.apCleared) {
    if (nmEl) nmEl.textContent = '—';
  } else if (fieldList.length) {
    if (!F.apTargetId || !fieldList.some((f) => f.id === F.apTargetId)) F.apTargetId = fieldList[0].id;
    const tgt = fieldList.find((f) => f.id === F.apTargetId) || fieldList[0];
    if (tgt.gx != null) {
      const adx = tgt.gx - F.pos.x, ady = tgt.gy - F.pos.y;
      // `kind` 'tile' picks the crosshair over the airfield ring.
      apTarget = { dx: adx, dy: ady, name: tgt.name, dist: Math.round(Math.hypot(adx, ady)), kind: tgt.kind || 'place', gx: tgt.gx, gy: tgt.gy };
    }
    if (nmEl) nmEl.textContent = (tgt.name || 'FIELD').slice(0, 8).toUpperCase() + (apTarget ? '  ' + apTarget.dist : '');
  }

  // Checkride rings: the client detects a fly-through of the active ring and reports it.
  let gateView = null;
  const cr = F.checkride;
  if (cr && Array.isArray(cr.gates) && cr.gates.length) {
    gateView = { active: cr.gateIdx, rings: cr.gates.map((g) => ({ dx: g.gx - F.pos.x, dy: g.gy - F.pos.y, altDiff: g.alt - s.altitude, r: g.r })) };
    const g = cr.gates[cr.gateIdx];
    if (g && F.lastGateSent !== cr.gateIdx) {
      const gdx = g.gx - F.pos.x, gdy = g.gy - F.pos.y;
      if (Math.hypot(gdx, gdy) < g.r && Math.abs(s.altitude - g.alt) < g.altTol) {
        F.lastGateSent = cr.gateIdx;   // one report per gate
        sendCmdSilent(`flightevent gate ${cr.gateIdx}`);
      }
    }
  }

  // ⚠ Electrical power, derived once: a dry tank or an EMP kills it too, not only the master.
  const wasPowered = F.powered;
  F.powered = F.engineOn && !F.deadStick && !F.avionicsOut;
  if (F.powered !== wasPowered && F.syncLights) F.syncLights();

  // Prop spool for the external model: spins up brisk, winds down lazy, windmills past cruise when
  // the engine is dead. The blur disc follows real rpm.
  const engLive = F.engineOn && !F.deadStick;
  const windmill = (!F.heli && !engLive)
    ? clampNum((r.airspeed - P.cruise) / Math.max(1, (P.vne || 120) - P.cruise), 0, 1) * 0.55
    : 0;
  const propTgt = engLive ? 0.20 + 0.80 * clampNum(s.rpm, 0, 1) : windmill;
  F.propSpin = lerpN(F.propSpin || 0, propTgt, Math.min(1, dt * (propTgt > (F.propSpin || 0) ? 2.2 : 1.0)));
  // Deadband, or the lerp never quite parks the prop.
  if (propTgt <= 0 && F.propSpin < 0.02) F.propSpin = 0;
  F.propPhase = (F.propPhase || 0) + dt * F.propSpin * 34;
  const propDisc = clampNum((d.rpm - 0.12) / 0.45, 0, 1);    // none at idle, full by ~57% rpm

  perfEnd();   // sim:systems
  perfBegin('sim:paint');
  // Bombs: the server resolves the release at once; the client plays back the fall and spawns the
  // burst on arrival. Playback only, it decides nothing.
  if (F.drops.length) {
    const tNow = performance.now();
    for (const d2 of F.drops) {
      if (tNow - d2.t0 < d2.fall) continue;
      F.bursts.push({ gx: d2.gx, gy: d2.gy, t0: tNow, life: 2600, scale: d2.scale });
      if (F.bursts.length > 6) F.bursts.shift();
      try { hitFx(); } catch {}
      d2.done = true;
    }
    F.drops = F.drops.filter((d2) => !d2.done);
  }
  if (F.bursts.length) {
    const tNow = performance.now();
    F.bursts = F.bursts.filter((b) => tNow - b.t0 < b.life);
  }
  const burstView = F.bursts.length
    ? F.bursts.map((b) => ({ dx: b.gx - F.pos.x, dy: b.gy - F.pos.y, age: (performance.now() - b.t0) / b.life, scale: b.scale }))
    : null;
  // Falling stores: `t` 0..1; the windshield owns the height. Straight ground track to the aim point.
  const dropView = F.drops.length
    ? F.drops.map((b) => {
      const t = clampNum((performance.now() - b.t0) / b.fall, 0, 1);
      return { dx: (b.x0 + (b.gx - b.x0) * t) - F.pos.x, dy: (b.y0 + (b.gy - b.y0) * t) - F.pos.y, t };
    })
    : null;
  // ⚠ The bombsight must pick the tile cmdBomb will: keep in step with BOMB_RANGE/BOMB_REACH/BOMB_CONE.
  let bombsight = null;
  if (F.bombCap > 0 && F.weapon === 'bomb' && F.reportedAirborne) {
    const th = (s.heading || 0) * Math.PI / 180;
    let bx = F.pos.x + Math.sin(th) * 1, by = F.pos.y - Math.cos(th) * 1;
    const wp = F.waypoint;
    if (wp) {
      const d = Math.max(Math.abs(wp.gx - F.pos.x), Math.abs(wp.gy - F.pos.y));
      const off = Math.abs((((Math.atan2(wp.gx - F.pos.x, -(wp.gy - F.pos.y)) * 180 / Math.PI) - (s.heading || 0) + 540) % 360) - 180);
      if (d <= 3 && off <= 50) { bx = wp.gx; by = wp.gy; }
    }
    const q = diveQuality(s);
    bombsight = { dx: bx - F.pos.x, dy: by - F.pos.y, q, ready: q > 0 && F.bombs > 0 && F.armed };
  }
  paintWindshield('fsim-ws', {
    gates: gateView,
    bursts: burstView,
    drops: dropView,
    bombsight,
    pitch: d.pitch + (F.dk?.onWater && F.dk.ride ? F.dk.ride.pitch : 0) + (F.dk?.flarePitch || 0), bank: d.bank + (F.dk?.onWater && F.dk.ride ? F.dk.ride.roll : 0),
    // ⚠ The flight deck is anchored to the airframe heading, never the eye's, or it turns with your head.
    ownHdg: s.heading,
    stick: { x: clampNum(F.input.aileron || 0, -1, 1), y: clampNum(F.input.elevator || 0, -1, 1) },
    trim: F.input.trim || 0,
    gunConv: F.dk ? drakeConv() : null,
    // The master arm (`armed` is the airframe).
    gunsLive: !!F.armed,
    drakeVent: F.dk ? { flood: F.dk.ventFlood || 0, blow: F.dk.ventBlow || 0 } : null, subHull: F.dk?.subVis || 0, drakeWater: !!(F.dk && (F.dk.onWater || F.dk.submerged > 0 || F.dk.subVis > 0)),
    // Her model sinks with her (SEA_TILE_M is 7 m).
    ...(F.dk?.subVis > 0 ? { rideZ: -F.dk.subVis / 7 } : {}),
    drakeFloat: F.dk?.floatVis || 0,
    // ⚠ Raw s.altitude, never the rounded readout: the sqrt is steepest off the deck and rounding steps the eye.
    height: Math.min(1, Math.sqrt(Math.max(0, s.altitude) / 3000)), speed: clampNum(r.airspeed / (P.vne || 120), 0, 1),
    ias: Math.round(r.airspeed), alt: Math.round(r.altitude), vsi: Math.round(s.vs), vne: P.vne, vs0: P.vs0,
    // ── Panel feed ──
    // ⚠ The panel must read these live values, and only what the sim models; never feed a gauge a plausible constant.
    rpmFrac: F.rpms[0] || 0,
    oilTemp: clampNum((((F.temps && F.temps[0]) || 40) - 40) / 175, 0, 1),
    fuel: clampNum((s.fuelPct ?? 100) / 100, 0, 1),
    hull: clampNum((s.hullPct ?? 100) / 100, 0, 1),
    throttle: clampNum(F.input.throttle ?? 0, 0, 1),
    // The lever is a gate: the 0..1 input quantised to its notches.
    flapNotch: Math.round(clampNum(F.input.flaps || 0, 0, 1) * 3),
    rudder: clampNum(F.input.pedal || 0, -1, 1),
    // Fixed gear draws no lever.
    gearFixed: !F.gearRetract,
    gearDown: !F.gearRetract || !F.gearUp,
    stall: !!(s.stalled || s.stallMargin < 0.35),
    bingo: !!(F.fuel <= 0 || F.warn === 'BINGO'),
    powered: !!F.powered, altOn: !!F.engineOn,
    // Off the start timer, not rpm (which reads 0 at idle).
    starting: !!(F.engineOn && F.engStartT && performance.now() - F.engStartT < ENGINE_START_MS),
    landingLight: !!F.landingLight, panelLight: !!F.nightLight,
    // Head look: decays back when released, off in the chase view and side views.
    ...(() => {
      F.look = F.look || { x: 0, y: 0 };
      if (F.external || F.viewYaw) { F.look.x = 0; F.look.y = 0; F.looking = false; return {}; }
      if (!F.looking && !F.freeLook) {
        F.look.x *= 0.78; F.look.y *= 0.78;
        if (Math.abs(F.look.x) < 0.002) F.look.x = 0;
        if (Math.abs(F.look.y) < 0.002) F.look.y = 0;
      }
      if (!(F.look.x || F.look.y)) return {};
      // With a 3-D deck the drag turns the head, with a small lean; the painted panel only leans.
      return RENDER_TUNE.cockpit3d
        ? { lookYaw: F.look.x * 150, lookPitch: -F.look.y * 70,   /* screen y is down, pitch is up */ lookLean: { x: F.look.x * 0.14, y: F.look.y * 0.14 } }
        : { lookLean: { x: F.look.x, y: F.look.y } };
    })(),
    // ⚠ Raw s.heading, never the integer readout, or the horizon steps as you yaw.
    hour: F.sky?.hour, moon: F.sky?.moon, weather: F.sky?.weather, wind: F.sky?.wind, heading: s.heading,
    wxField: F.sky?.field, wxGround: F.sky?.ground, acX: F.pos.x, acY: F.pos.y,
    map: F.map, skyline: F.skyline, mapCenter: F.mapCenter, roads: F.roads, phase: 'cruise', airport: F.airport, helipad: !!F.helipad, biomeBelow: F.biomeBelow,
    actors: F.actors,   // drawn only on a low pass
    regions: F.regions,
    mapOffset: { x: F.pos.x - F.mapCenter.x, y: F.pos.y - F.mapCenter.y }, travel: F.travel,
    runway: { ox: F.rwOrigin.x - F.pos.x, oy: F.rwOrigin.y - F.pos.y, hdg: F.rwHdg, len: F.rwLen, alt: clampNum(s.altitude / 320, 0, 1) },
    landGuide,
    hud: true,
    threat: (F.aa && F.reportedAirborne) ? F.aa : null,
    airports: navFields(F), apTarget, apTargetId: F.apTargetId,
    // For a cockpit GPS screen (panelGps).
    gpsTo: apTarget ? { rel: (((Math.atan2(apTarget.dx, -apTarget.dy) * 180 / Math.PI) - s.heading) % 360 + 540) % 360 - 180, dist: apTarget.dist } : null, viewYaw: F.viewYaw, extYaw: F.extOrbit || 0, extPitch: F.extPitch ?? REST_PITCH,
    windowClass: F.viewYaw ? F.cls : undefined,
    windVec: (atmos.windKt > 1 && F.reportedAirborne) ? { dir: atmos.windDir, kt: atmos.windKt } : null,
    contacts: contactView, designated,
    // Tracers whenever the trigger is held, solution or not.
    firing: !!(F.firing && F.armed && F.reportedAirborne && F.weapon !== 'msl'), muzzle: F.muzzleT && (now - F.muzzleT < 60), muzzleT: F.muzzleT || 0, gunMs: F.gunMs,
    chinGun: F.chinGun,
    missiles: stepShots(F, now, dt, s),
    flares: stepFlares(F, now, dt, s),
    // The gunsight also aligns the chase camera dead astern (windshield.js).
    reticle: !!(F.armed && F.reportedAirborne && F.weapon !== 'msl'),
    hull: F.hull, hitFlash: F.hitFlashT ? clampNum(1 - (now - F.hitFlashT) / 400, 0, 1) : 0,
    breakup: surfaceBreakup(F.surfaces),   // sheared surfaces drawn gone
    // Incoming AA volley; dx/dy anchor it to the gun each frame, null falls back to the 2-D streak.
    aaTracer: (F.aaTracerT && (now - F.aaTracerT) < AA_TRACER_MS)
      ? { bearing: F.aaTracerBearing, t: (now - F.aaTracerT) / AA_TRACER_MS,
          dx: F.aaTracerX != null ? F.aaTracerX - F.pos.x : null,
          dy: F.aaTracerY != null ? F.aaTracerY - F.pos.y : null,
          hit: !!F.aaTracerHit,
          seed: F.aaTracerSeed || 1 } : null,
    external: F.external, extZoom: F.extZoom || 1, freeCam: freeCam.view(), cls: F.cls, armed: F.cls === 'heli' && F.hardpoints > 0, livery: LIVERY_PREVIEW || F.livery, ...(F.cls === 'drake' && (LIVERY_PREVIEW || F.livery)?.variant && (LIVERY_PREVIEW || F.livery).variant !== 'stock' ? { variant: (LIVERY_PREVIEW || F.livery).variant } : {}), enginePct: d.rpm,
    // For the modelled cockpits. ⚠ Not `armed`, which picks the Viper airframe.
    weaponsArmed: !!F.armed, weapon: F.weapon, bombs: F.bombs, missiles: F.msl, ammo: F.gunRounds,
    diveBrake: F.diveAuto ? 1 : 0, siren: F.bombCap > 0 && diveQuality(F.s) > 0,
    spraying: !!(F.sprayT && performance.now() - F.sprayT < 1900),
    ckHover: F.dkHover || null, ckPress: F.dkPress && performance.now() - F.dkPress.t < 220 ? F.dkPress.id : null,
    engineOn: F.powered, landingLight: F.landingLight, dome: !!(F.domeLight && F.powered),   // nav lights follow power, not the master
    panelLight: F.nightLight,

    propPhase: F.propPhase, propSpin: F.propSpin, propDisc,
    // Surface deflection for the external model; touch auto-coordinates the rudder into the roll.
    ctrl: F.external ? { aileron: F.input.aileron, elevator: clampNum(F.input.elevator + (F.input.trim || 0), -1, 1), flaps: F.input.flaps, rudder: clampNum((F.input.pedal || 0) + (_touchPrimary ? 0.5 * F.input.aileron : 0), -1, 1) } : null,
    gearAnim: F.gearRetract ? clampNum(F.gearAnim ?? 1, 0, 1) : 1,
    anim: F.dk ? drakeAnim(F.dk) : undefined,
    drakeCab: F.dk ? { ...drakeAnim(F.dk), ramp: F.dk.ramp, nv: F.dk.nv, gunsArmed: F.armed, gear: F.gearRetract ? clampNum(F.gearAnim ?? 1, 0, 1) : 1,
      quack: !!F.dk.quackHeld || performance.now() - F.dk.quackT < 400, champagne: DK_CHAMPAGNE, quackP: F.dk.quackHeld ? Math.min(1, (performance.now() - F.dk.quackT) / QUACK_SQUEEZE_MS) : 0, ammo: F.gunRounds, convert: F.dk.conv, wingTarget: !!F.dk.wing,
      hover: F.dkHover || null, press: F.dkPress && performance.now() - F.dkPress.t < 220 ? F.dkPress.id : null,
      gps: drakeGps(F), plate: F.livery?.plate || '', trim: F.livery?.itrim || (F.livery?.variant === 'noir' || F.livery?.variant === 'quackhawk' ? F.livery.variant : 'stock'), mode: F.drakeModeNow ? F.drakeModeNow() : 0, ready: [0, 1, 2, 3].map((k) => F.drakeModeReady ? F.drakeModeReady(k) : false), dive: { boat: !!F.dk.boat && (!!F.dk.onWater && !(F.dk.submerged > 0)), under: F.dk.submerged > 0 && !(F.dk.subBlowLocal ?? F.dk.subBlow ?? true), moving: (F.dk.ventFlood || 0) > 0.05 || (F.dk.ventBlow || 0) > 0.05 }, pantry: dkEase(F.dk, 'pantry'), locker: dkEase(F.dk, 'locker') } : null,
    noseVisor: F.hasVisor ? clampNum(F.noseVisor ?? 0, 0, 1) : 0,
    cockpitTilt: F.hasVisor ? clampNum(F.noseVisor ?? 0, 0, 1) : 0,   // first-person camera pitches with the raised nose
    onGround: !!r.onGround,
    // Echelon guidance dome, armed inside the capture window.
    padDome: (F.heli && F.reportedAirborne && !F.deckCine) ? { armed: !!F.onYacht } : null,
    roofPad: (F.heli && F.reportedAirborne && !F.deckCine && F.roofPadShow) ? { armed: !!(F.roofPadArmed || F.roofLock) } : null,
  });
  perfEnd();   // sim:paint

  perfBegin('sim:drugfx');
  applyFlightDrugFx(root.querySelector('.fsim-view'), document.getElementById('fsim-ws'), dt);
  perfEnd();

  // Sync while flying, rolling out and ⚠ taxiing, or the server keeps her at the gate. ~3 Hz near traffic.
  const taxiing = s.onGround && F.engineOn;
  const syncEvery = contactNear <= FAST_SYNC_RANGE ? 0.33 : 1.2;
  F.syncAcc += dt; F.audioAcc += dt;
  if ((F.reportedAirborne || F.rolling || taxiing) && F.syncAcc >= syncEvery) {
    F.syncAcc = 0;
    sendCmdSilent(`flightsync ${F.pos.x.toFixed(2)} ${F.pos.y.toFixed(2)} ${Math.round(s.altitude)} ${Math.round(s.airspeed)} ${Math.round(s.heading)} ${Math.round(thr * 100)} ${Math.round(s.vs)} ${s.onGround ? 1 : 0} ${s.stalled ? 1 : 0} ${Math.round(s.bank || 0)} ${Math.round((s.pitch || 0) + (F.dk?.flarePitch || 0))}${drakeSyncTail(F)}`);
    if (F.dk?.subPending) { sendCmdSilent(F.dk.subPending); F.dk.subPending = null; }
    // Our measured murmurations, so the server's bird strike hits the cloud we see.
    F.flockAcc = (F.flockAcc || 0) + syncEvery;
    if (F.flockAcc >= 2 && MURMUR_MEASURED.size) {
      F.flockAcc = 0;
      const parts = [];
      for (const [k, o] of MURMUR_MEASURED) {
        const m = /^([a-z]+):(-?\d+),(-?\d+)$/.exec(k);
        if (!m || Math.hypot(+m[2] - F.pos.x, +m[3] - F.pos.y) > 40) continue;
        parts.push(k, o.dx.toFixed(2), o.dy.toFixed(2), o.dz.toFixed(2));
        if (parts.length >= 32) break;
      }
      if (parts.length) sendCmdSilent('flocksync ' + parts.join(' '));
    }
    // ⚠ Never advance mapCenter here; it stays paired with the server's map (flightSimContext).
  }
  if (F.audioAcc >= 0.25) {
    F.audioAcc = 0;
    // Exterior or muffled interior mix; doppler only from the orbit camera.
    let doppler = 1;
    if (F.external) {
      const vlos = -(s.airspeed || 0) * Math.cos(((F.extOrbit || 0)) * Math.PI / 180);   // >0 closing
      doppler = clampNum(1 / (1 - vlos / DOPPLER_C), 0.92, 1.1);
    }
    updateEngineAudio({ continuous: true, airborne: F.reportedAirborne, engineOn: F.engineOn, class: F.cls, throttle: Math.round(thr * 100), spd: Math.round(s.airspeed), engines: [{ pct: Math.round(s.rpm * 100) }], bandIndex: s.altitude > 500 ? 1 : 0, sky: F.sky, atmos: F.atmos, acX: F.pos.x, acY: F.pos.y,
      rpm: s.rpm, airspeed: s.airspeed, vs: s.vs, altitude: s.altitude, onGround: s.onGround, groundSpeed: s.onGround ? s.airspeed : 0,
      stallMargin: s.stallMargin, stalled: s.stalled, flaps: input.flaps,
      perspective: F.external ? 'exterior' : 'interior', doppler, underwater: F.dk?.uw || 0 });
    // Boats below, from the existing contacts feed (no new request). ⚠ Knots to mph here.
    updateBoatContacts({ x: F.pos.x, y: F.pos.y, hdg: F.hdg || 0, speed: (s.airspeed || 0) * KT_TO_MPH },
      F.contacts || []);
  }

  // Impact shake decays; stall buffet is sustained and warns before the horn.
  const buffet = (F.s && !F.s.onGround) ? (F.s.buffet || 0) : 0;
  const shakeAmt = Math.max(F.shake || 0, buffet * 2.8);
  if (shakeAmt > 0.2) {
    const m = shakeAmt;
    root.style.transform = `translate(${(Math.random() * 2 - 1) * m}px, ${(Math.random() * 2 - 1) * m}px)`;
    F.shake *= Math.exp(-dt * 9);
    F.shakeOn = true;
  } else if (F.shakeOn) { root.style.transform = ''; F.shake = 0; F.shakeOn = false; }

  perfEnd();    // frame
  perfTick();
  F.raf = requestAnimationFrame(fsimFrame);
}

// ── The dive gate (the Shrike) ────────────────────────────────────────────────
// The server's cmdBomb holds the authoritative copy; these only drive what you see and hear.
const DIVE_MIN_DEG = 35;    // nose-down angle the release needs
const DIVE_IAS_MIN = 140;   // and the speed it needs with it
const DIVE_BEST_DEG = 80;   // a dive this steep is as good as it gets
// 0..1, the same shape the server scores accuracy on.
function diveQuality(s) {
  if (!s || s.onGround || !s.airborne) return 0;
  const down = -(s.pitch || 0);
  const ang = Math.max(0, Math.min(1, (down - DIVE_MIN_DEG) / (DIVE_BEST_DEG - DIVE_MIN_DEG)));
  const spd = Math.max(0, Math.min(1.3, (s.ias || 0) / DIVE_IAS_MIN));
  return Math.max(0, Math.min(1, ang * spd));
}
// The Shrike's dive siren starts from about 20° down, before the release gate opens.
function fsimSiren(F) {
  if (F.craftType !== 'shrike') return;
  const s = F.s;
  const down = s && s.airborne && !s.onGround ? -(s.pitch || 0) : 0;
  const lean = Math.max(0, Math.min(1, (down - 20) / (DIVE_BEST_DEG - 20)));
  const spd = Math.max(0, Math.min(1, (s?.ias || 0) / DIVE_IAS_MIN));
  diveSiren(lean * spd);
}

// Dive angle, speed and rack readout; bomb carriers only.
function fsimDiveLadder(F) {
  const el = document.getElementById('fsim-dive'); if (!el) return;
  const s = F.s;
  if (!F.bombCap || !s || s.onGround || !s.airborne) { el.style.opacity = '0'; return; }
  const down = -(s.pitch || 0), ias = s.ias || 0;
  const angOk = down >= DIVE_MIN_DEG, spdOk = ias >= DIVE_IAS_MIN;
  const ready = angOk && spdOk && F.bombs > 0 && F.armed;
  el.style.opacity = down > 8 || ready ? '1' : '0.34';
  el.className = 'fsim-dive' + (ready ? ' ready' : angOk || spdOk ? ' near' : '');
  el.innerHTML = `<span class="fd-ang${angOk ? ' ok' : ''}">${down > 0 ? '▼' : '▲'} ${Math.abs(Math.round(down))}°</span>`
    + `<span class="fd-spd${spdOk ? ' ok' : ''}">${Math.round(ias)} kt</span>`
    + `<span class="fd-rack">${F.bombs > 0 ? '●'.repeat(F.bombs) : 'EMPTY'}</span>`
    + (ready ? '<span class="fd-cue">RELEASE</span>' : '');
  // Chimes once per dive as the gate opens.
  if (ready && !F._diveCue) { F._diveCue = true; try { lockTone(); } catch {} }
  if (!angOk) F._diveCue = false;
}

function fsimHorn(F, dt) {
  fsimSiren(F);
  fsimDiveLadder(F);
  const lamp = document.getElementById('fsim-lamp'); if (!lamp) return;
  const { s } = F;
  // Continuous in the stall, pulsing on the approach. A heli uses it for low rotor RPM and VRS.
  if (s.onGround) { lamp.style.opacity = 0; stallHorn(0); return; }
  if (F.heli) {
    if (s.lowNr || s.vrs) { lamp.textContent = s.vrs ? '⚠ SETTLING WITH POWER' : '⚠ LOW ROTOR RPM'; lamp.style.opacity = 1; stallHorn(0.6); }
    else if (s.stallMargin < 0.35) { F.hornBeat = (F.hornBeat + dt * (2 + (0.35 - s.stallMargin) * 10)) % 1; const on = F.hornBeat < 0.5; lamp.textContent = '⚠ LOW ROTOR RPM'; lamp.style.opacity = on ? 1 : 0; stallHorn(on ? 0.4 : 0); }
    else { lamp.style.opacity = 0; stallHorn(0); }
    return;
  }
  if (s.stalled) { lamp.textContent = '⚠ STALL'; lamp.style.opacity = 1; stallHorn(0.6); }
  else if (F.overGLamp > 0) { lamp.textContent = '⚠ OVER G'; lamp.style.opacity = 1; stallHorn(0); }
  else if (s.stallMargin < 0.35) { lamp.textContent = '⚠ STALL'; F.hornBeat = (F.hornBeat + dt * (2 + (0.35 - s.stallMargin) * 10)) % 1; const on = F.hornBeat < 0.5; lamp.style.opacity = on ? 1 : 0; stallHorn(on ? 0.4 : 0); }
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

// Night panel lighting: accent bloom and a lit rim. Drawn last.
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
  // Slip ball: a forward slip pushes it toward the low wing and lights it amber.
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
// A 270° dial.
function arcGauge(ctx, cx, cy, r, frac, label, val, opts) {
  opts = opts || {};
  const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25, sweep = A1 - A0, lw = Math.max(2, r * 0.16);
  frac = clampNum(frac, 0, 1);
  const col = opts.col || '#5fe0a0';
  ctx.lineCap = 'round'; ctx.textAlign = 'center';
  const face = ctx.createRadialGradient(cx, cy - r * 0.35, r * 0.15, cx, cy, r * 1.25);
  face.addColorStop(0, '#182028'); face.addColorStop(0.72, '#0b1218'); face.addColorStop(1, '#05090d');
  ctx.fillStyle = face; ctx.beginPath(); ctx.arc(cx, cy, r * 1.2, 0, 7); ctx.fill();
  ctx.lineWidth = Math.max(1.4, r * 0.1); ctx.strokeStyle = 'rgba(58,74,90,0.6)'; ctx.beginPath(); ctx.arc(cx, cy, r * 1.2, 0, 7); ctx.stroke();
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(190,215,235,0.10)'; ctx.beginPath(); ctx.arc(cx, cy, r * 1.2, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
  ctx.strokeStyle = 'rgba(52,72,88,0.55)'; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(cx, cy, r, A0, A1); ctx.stroke();
  for (let i = 0; i <= 8; i++) {
    const a = A0 + sweep * (i / 8), major = i % 2 === 0, r0 = r + lw * 0.55, r1 = r0 + (major ? 3 : 1.6);
    ctx.strokeStyle = major ? 'rgba(150,180,205,0.55)' : 'rgba(120,150,175,0.32)'; ctx.lineWidth = major ? 1.2 : 0.7;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
  }
  if (opts.marks) for (const m of opts.marks) { const a = A0 + sweep * clampNum(m.v, 0, 1); ctx.strokeStyle = m.col; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(cx, cy, r, a - 0.05, a + 0.05); ctx.stroke(); }
  const va = A0 + sweep * frac;
  ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = Math.max(2, r * 0.22); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(cx, cy, r, A0, va); ctx.stroke(); ctx.restore();
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(va);
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.moveTo(-r * 0.17, -1.4); ctx.lineTo(r * 0.86, -0.2); ctx.lineTo(r * 0.86, 1.0); ctx.lineTo(-r * 0.17, 1.6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#eef4fb'; ctx.beginPath(); ctx.moveTo(-r * 0.17, -0.9); ctx.lineTo(r * 0.84, -0.4); ctx.lineTo(r * 0.84, 0.4); ctx.lineTo(-r * 0.17, 0.9); ctx.closePath(); ctx.fill();
  ctx.restore();
  const hub = ctx.createRadialGradient(cx - 1, cy - 1, 0.4, cx, cy, 3.2);
  hub.addColorStop(0, '#d2dde6'); hub.addColorStop(1, '#39454f');
  ctx.fillStyle = hub; ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, 7); ctx.fill();
  const lblF = Math.max(6, Math.round(r * 0.32)), valF = Math.max(7, Math.round(r * 0.4));
  ctx.fillStyle = '#a3b7c7'; ctx.font = `${lblF}px monospace`; ctx.textBaseline = 'alphabetic'; ctx.fillText(label, cx, cy - r - Math.max(3, r * 0.12));
  const vy = cy + r * 0.56, pw = Math.max(20, r * 1.15), ph = Math.max(9, r * 0.52), px0 = cx - pw / 2, py0 = vy - ph / 2, rr = 2;
  ctx.beginPath(); ctx.moveTo(px0 + rr, py0); ctx.arcTo(px0 + pw, py0, px0 + pw, py0 + ph, rr); ctx.arcTo(px0 + pw, py0 + ph, px0, py0 + ph, rr); ctx.arcTo(px0, py0 + ph, px0, py0, rr); ctx.arcTo(px0, py0, px0 + pw, py0, rr); ctx.closePath();
  ctx.fillStyle = 'rgba(3,8,12,0.85)'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.6; ctx.stroke();
  ctx.fillStyle = opts.valcol || ACCENT; ctx.font = `bold ${valF}px monospace`; ctx.textBaseline = 'middle'; ctx.fillText(String(val), cx, vy + 0.5);
}


// ── Extra gauge-panel furniture ──────────────────────────────────────────────
// Annunciators, bar gauges and the Reaper's stores block, kept clear of the centre stick.
function fsPill(ctx, x, y, w, h, rr) {
  rr = Math.min(rr, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr); ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr); ctx.arcTo(x, y, x + w, y, rr); ctx.closePath();
}
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
// Reaper GAU-8 stores block.
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
  // spec[2] is the 1-based engine index, 0 for a single engine.
  const rpmSpec = (i) => ['rpm', rpms[i] || 0, nEng > 1 ? i + 1 : 0];
  const tempSpec = (i) => ['temp', temps[i] || 40, nEng > 1 ? i + 1 : 0];
  const eng = g.eng || 'piston';
  const suffix = (n) => (n ? ' ' + n : '');
  // Only the powerplant dials and the L/R fuel pair, so the dials can be big.
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
  const r = Math.min(chd * 0.38, W * 0.19);
  const col = Math.max(r * 1.28, W * 0.04), colL = col, colR = W - col;
  const yAt = (i) => (i + 0.5) * chd;
  const draw = (spec, x, y) => {
    switch (spec[0]) {
      case 'rpm': {
        const lbl = (eng === 'turboprop' ? 'TQ' : eng === 'turbofan' ? 'N1' : eng === 'heli' ? 'ROTOR' : 'RPM') + suffix(spec[2]);
        const val = eng === 'piston' ? Math.round(spec[1] * 100) : Math.round(spec[1] * 100) + '%';
        const marks = eng === 'heli' ? [{ v: 0.55, col: '#ff5a5b' }, { v: 0.6, col: '#5fe0a0' }, { v: 1, col: '#5fe0a0' }] : [{ v: 0.92, col: '#ff5a5b' }];
        arcGauge(ctx, x, y, r, spec[1], lbl, val, { col: eng === 'heli' && spec[1] < 0.6 ? '#ff5a5b' : ACCENT, marks }); break;
      }
      case 'temp': {
        // Turbines map the same 0..1 onto turbine-gas ranges.
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

  const dialHalf = r * 1.22, innerL = colL + dialHalf + 8, innerR = colR - dialHalf - 8;
  const koL = W * 0.35, koR = W * 0.65;   // centre keep-out for the stick
  if (koL - innerL > 40) barCluster(ctx, innerL, koL, H, [
    { lbl: 'OIL', frac: g.engineOn ? 0.5 + g.prpm * 0.45 : 0.05, col: '#5fe0a0' },
    { lbl: 'FLOW', frac: g.engineOn ? Math.max(0.05, g.prpm) : 0, col: '#ffb23e' },
    { lbl: 'HYD', frac: g.engineOn ? 0.68 + g.prpm * 0.28 : 0.08, col: '#5fd0ff' },
  ]);
  if (innerR - koR > 40) {
    const gun = g.craft === 'reaper' && g.hardpoints > 0;
    const tiles = [
      { lbl: 'GEAR', on: g.gear === 'up', col: '#ffb23e' },
      { lbl: 'FUEL', on: g.fuelPct <= 15, col: '#ff5a5b' },
      { lbl: 'GEN', on: g.battery < 20, col: '#ff5a5b' },
      { lbl: 'STALL', on: !!g.stall, col: '#ff5a5b' },
    ];
    if (g.hasVisor) tiles.push({ lbl: 'NOSE', on: (g.noseVisor || 0) > 0.02, col: '#ff5a5b' });
    if (eng === 'heli') tiles.push({ lbl: 'AUTO', on: !!g.autorot, col: '#ffb23e' }, { lbl: 'LO NR', on: !!g.lowNr, col: '#ff5a5b' }, { lbl: 'VRS', on: !!g.vrs, col: '#ff5a5b' });
    if (g.hardpoints > 0 && !gun) tiles.push({ lbl: 'ARM', on: !!g.armed, col: '#ff5a3a' });
    if (gun) { gunStores(ctx, koR, innerR, H * 0.10, H * 0.52, g); annunTiles(ctx, koR, H * 0.58, innerR, H * 0.9, tiles); }
    else annunTiles(ctx, koR, H * 0.14, innerR, H * 0.86, tiles);
  }
  if (g.night) nightGlow(ctx, W, H);
  // EMP: drawn, then covered, so a ghost of the needles reads as dead hardware.
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
  // Track-up.
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-hdgRad); ctx.translate(-W / 2, -H / 2);
  if (F.mfdMode === 'nav') paintNav(ctx, W, H, F, ox, oy); else paintLocal(ctx, W, H, F, ox, oy);
  const cellPx = F.mfdMode === 'nav' ? Math.hypot(W, H) / ((F.map?.length || 9)) * 1.1 : Math.min(W, H) / 5;
  paintMfdContacts(ctx, W, H, F, cellPx);
  ctx.restore();
  ctx.save(); ctx.translate(W / 2, H / 2);
  ctx.fillStyle = '#ffcf3e'; ctx.strokeStyle = '#1a1200'; ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  const rr = Math.min(W, H) * 0.4, nx = W / 2 - Math.sin(hdgRad) * rr, ny = H / 2 - Math.cos(hdgRad) * rr;
  ctx.fillStyle = accA(0.8); ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', nx, ny);
  if (F.nightLight) nightGlow(ctx, W, H);
  ctx.restore();
}

// 5×5 tiles around the craft; off-window cells read neutral.
function paintLocal(ctx, W, H, F, ox, oy) {
  const map = F.map;
  if (!map || !map.length) { ctx.fillStyle = '#456'; ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('NO MAP', W / 2, H / 2); return; }
  const R = (map.length - 1) / 2, cell = Math.min(W, H) / 5;
  const drawHalf = 3;                                         // 7×7, so track-up rotation fills the corners
  const ccx = R + ox, ccy = R + oy, bx = Math.round(ccx), by = Math.round(ccy);
  const fx = ccx - bx, fy = ccy - by;
  for (let dy = -drawHalf; dy <= drawHalf; dy++) for (let dx = -drawHalf; dx <= drawHalf; dx++) {
    const c = (map[by + dy] && map[by + dy][bx + dx]) || null;
    const sx = W / 2 + (dx - fx) * cell, sy = H / 2 + (dy - fy) * cell;
    // Runways read `rwy` (deriveSurfaceCell), never `road`.
    const col = !c ? '#12202c' : c.kind === 'air' ? '#0a1119' : c.kind === 'field' || c.rwy === 'ns' || c.rwy === 'ew' ? '#5fe0a0'
      : c.rwy === 'pad' ? '#3c8a68' : c.kind === 'nofly' ? '#7a2a2a' : (MFD_BCOL[c.biome] || '#2a3540');
    ctx.fillStyle = col; ctx.fillRect(sx - cell / 2, sy - cell / 2, cell - 1, cell - 1);
    if (c && c.road) { ctx.fillStyle = 'rgba(150,150,120,0.5)'; ctx.fillRect(sx - cell / 2, sy - 1.5, cell - 1, 3); }
    ctx.strokeStyle = accA(0.14); ctx.lineWidth = 1; ctx.strokeRect(sx - cell / 2, sy - cell / 2, cell - 1, cell - 1);
  }
}

// Traffic darts, dead-reckoned and clamped to the edge, drawn inside the rotated frame.
function paintMfdContacts(ctx, W, H, F, cell) {
  const cs = F.contacts; if (!cs || !cs.length) return;
  const now = performance.now(), lim = Math.min(W, H) * 0.46;
  for (const c of cs) {
    const drS = Math.min(CONTACT_DR_MAX, (now - (c.t || now)) / 1000);
    const spd = (c.ias || 0) * paceAt(c.alt), hr = (c.hdg || 0) * Math.PI / 180;
    const cx = c.x + Math.sin(hr) * spd * drS, cy = c.y - Math.cos(hr) * spd * drS;
    let px = (cx - F.pos.x) * cell, py = (cy - F.pos.y) * cell;
    const mag = Math.hypot(px, py); let edge = false;
    if (mag > lim) { const k = lim / mag; px *= k; py *= k; edge = true; }
    const des = c.id && c.id === F.designatedId;
    const baseHex = c.livery && /^#[0-9a-fA-F]{6}$/.test(c.livery.base || '') ? c.livery.base : '#c85050';
    ctx.save(); ctx.translate(W / 2 + px, H / 2 + py);
    if (des) { ctx.strokeStyle = '#ff5b5b'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, 7); ctx.stroke(); }
    ctx.rotate(hr);
    ctx.globalAlpha = edge ? 0.55 : 1;
    ctx.fillStyle = baseHex; ctx.strokeStyle = 'rgba(255,91,91,0.85)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(3, 4); ctx.lineTo(0, 2); ctx.lineTo(-3, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}

function paintNav(ctx, W, H, F, ox, oy) {
  const map = F.map;
  if (!map || !map.length) { ctx.fillStyle = '#456'; ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('NO MAP', W / 2, H / 2); return; }
  // Overscan to the panel diagonal so track-up rotation never shows empty corners.
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

// A bomb release the server resolved: anchored to its world tile; `q` sizes the burst a little.
export function flightBurst(msg) {
  const F = _fsim; if (!F || !msg || !Number.isFinite(msg.gx)) return;
  const now = performance.now();
  // The bomb falls for a fixed time first; the frame loop spawns the burst on arrival.
  F.drops.push({ gx: msg.gx, gy: msg.gy, x0: F.pos.x, y0: F.pos.y, t0: now, fall: 1500,
    scale: 0.85 + 0.35 * (msg.q || 0) });
  // The confirmed release switches the dive computer to the pull-out; a refused one keeps diving.
  if (F.diveAuto === 'push') F.diveAuto = 'pull';
  if (F.drops.length > 6) F.drops.shift();
}

// Glasses left in the Drake's champagne; null draws a full bottle.
let DK_CHAMPAGNE = null;
export function drakeChampagne(n) { DK_CHAMPAGNE = Number.isFinite(n) ? n : null; }
// ⚠ Its own message, not a flight_ctx field: a partial flight_ctx would wipe roads and actors.
export function drakeSubmerged(msg) {
  const F = _fsim; if (!F?.dk || !msg) return;
  // A refused dive: stop the tanks now and say why.
  if (msg.refused) {
    F.dk.subBlowLocal = null; F.dk.subAskAt = 0; F.dk.subPending = null;
    fsimToast('SUB: ' + msg.refused);
    return;
  }
  F.dk.submerged = Math.max(0, +msg.depth || 0);
  F.dk.subAir = msg.air ?? null;
  F.dk.subAirMax = msg.airMax ?? null;
  if (!(F.dk.submerged > 0) && F.dk.subWant > 0 && msg.depth === 0 && msg.surfaced) F.dk.subWant = 0;
  F.dk.subRating = msg.rating ?? null;
  F.dk.subBallast = +msg.ballast || 0;
  F.dk.subBlow = msg.blow !== false;
  F.dk.subBlowLocal = null;            // the server's word wins now
  F.dk.subAskAt = 0;
  if (msg.floodS) F.dk.subFloodS = +msg.floodS;
  if (msg.blowS) F.dk.subBlowS = +msg.blowS;
  F.dk.subFloor = msg.floor ?? null;
}

// The GPS directory, answering flightgps.
export function flightSimGps(msg) {
  const F = _fsim; if (!F || !msg) return;
  F.gpsDir = Array.isArray(msg.regions) ? msg.regions : [];
  F.gpsRender?.();
}

// Server context push: fuel and the world below.
export function flightSimContext(msg) {
  const F = _fsim; if (!F || !msg) return;
  if (msg.fuel != null) F.fuel = msg.fuel;
  if (msg.fuelCap != null) F.fuelCap = msg.fuelCap;
  // ⚠ Map and centre update together. Interned so GLASS keeps its per-building caches (map-intern.js).
  if (msg.map) { F.map = internMap(F.map, F.mapCenter?.x, F.mapCenter?.y, msg.map, msg.mapX, msg.mapY); if (msg.mapX != null) F.mapCenter = { x: msg.mapX, y: msg.mapY }; }
  if (msg.skyline) F.skyline = msg.skyline;
  // ⚠ roads and actors: null or empty is a real answer, never "no news".
  if (msg.roads !== undefined) F.roads = msg.roads;
  if (msg.actors !== undefined) F.actors = msg.actors;
  if (msg.minimap) F.minimap = msg.minimap;
  if (msg.fields) F.fields = msg.fields;
  if (msg.landmarks) F.landmarks = msg.landmarks;
  if (msg.regions) F.regions = msg.regions;
  // The tablet waypoint auto-selects. ⚠ Only on a change of coords, or [ / ] snaps back every push.
  {
    const wp = msg.waypoint || null;
    const key = wp ? wp.gx + ',' + wp.gy : '';
    if (key !== F._wpKey) {
      F._wpKey = key;
      if (wp) { F.apTargetId = 'wp'; F.apCleared = false; }
      else if (F.apTargetId === 'wp') { F.apTargetId = null; }
    }
    F.waypoint = wp;
  }
  if ('onField' in msg) F.onField = !!msg.onField;
  if ('onYacht' in msg) F.onYacht = !!msg.onYacht;
  if (msg.occupants) { F.occupants = msg.occupants; if (msg.seats) F.seats = msg.seats; renderSeats(F); }
  if ('cargo' in msg) F.cargoKg = msg.cargo;
  if (msg.sky) F.sky = msg.sky;
  if ('avionicsOut' in msg) F.avionicsOut = !!msg.avionicsOut;   // EMP
  if ('biomeBelow' in msg) F.biomeBelow = msg.biomeBelow;
  if ('surface' in msg) { F.surface = msg.surface; const tEl = document.getElementById('fsim-tile'); if (tEl) tEl.textContent = (msg.surface || '—').toUpperCase(); }
  if (typeof msg.hull === 'number') F.hull = msg.hull;
  if ('feetGone' in msg && F.dk) F.dk.feetGone = !!msg.feetGone;
  if ('surfaces' in msg) F.surfaces = msg.surfaces || null;   // sheared surfaces; null is intact
  if (typeof msg.msl === 'number' && msg.msl !== F.msl) { F.msl = msg.msl; if (F.paintPips) F.paintPips(); }
  if (typeof msg.bombCap === 'number') {
    F.bombCap = msg.bombCap;
    // The rack count arrives only here, so the bomber buttons are built hidden and revealed now.
    for (const id of ['#fsim-bombbtn', '#fsim-divebtn']) {
      const b = document.querySelector(id); if (b) b.style.display = F.bombCap > 0 ? '' : 'none';
    }
  }
  if (typeof msg.bombs === 'number' && msg.bombs !== F.bombs) { F.bombs = msg.bombs; if (F.paintPips) F.paintPips(); }
  F.warn = msg.warn || null;
  if ('checkride' in msg) {
    F.checkride = msg.checkride;
    renderCheckride(F, msg.checkride);
  }
  const wasExposed = !!(F.aa && F.aa.exposed);
  F.aa = msg.aa || null;       // AA envelope
  if (F.aa && F.aa.exposed && !wasExposed) aaWarn();
  F.deadStick = F.fuel <= 0;
}

// Hit feedback only; the consequences are the server's.
export function flightSimAirHit(msg) {
  const F = _fsim; if (!F || !msg) return;
  if (msg.role === 'taken') {
    F.hitFlashT = performance.now();
    if (typeof msg.hullPct === 'number') F.hull = msg.hullPct;
    // Record a shear now so the wing goes with the flash; flight_ctx follows with the full map.
    if (msg.sheared) {
      F.surfaces = { ...(F.surfaces || {}), [msg.sheared]: 0 };
      F.shake = Math.max(F.shake || 0, 30);
      if (F.toast) F.toast(`💥 STRUCTURAL FAILURE: ${SHEAR_TOAST[msg.sheared] || 'SURFACE'} GONE`);
    } else {
      // Shake scales with hull lost (msg.dmg).
      F.shake = Math.max(F.shake || 0, clampNum((msg.dmg ?? 8) * 0.9, 5, 28));
      if (F.toast) F.toast(`⚠ TAKING FIRE${msg.by ? ' · ' + msg.by : ''}, HULL ${msg.hullPct}%`);
    }
    try { hitFx(); } catch {}
  } else if (msg.role === 'dealt') {
    if (F.toast) F.toast('GUNS · HITS');
  }
}

// Kill banner on `flight_kill`, capped at four.
export function flightSimKill(msg) {
  const F = _fsim; if (!F || !msg) return;
  const feed = document.getElementById('fsim-killfeed'); if (!feed) return;
  const el = document.createElement('div');
  el.className = 'fsim-kill';
  const name = String(msg.name || 'target').replace(/[<>]/g, '');
  el.innerHTML = `★ KILL: <b>${name}</b>`;
  feed.appendChild(el);
  while (feed.childElementCount > 4) feed.removeChild(feed.firstChild);
  setTimeout(() => el.remove(), 3300);   // outlasts the CSS animation
  try { hitFx(); } catch {}
}

// RWR and countermeasure pushes; feedback only.
export function flightSimAirThreat(msg) {
  const F = _fsim; if (!F || !msg) return;
  switch (msg.kind) {
    case 'lock':
      if (F.toast) F.toast(`⚠ RWR: MISSILE LOCK${msg.by ? ' · ' + msg.by : ''}`);
      try { aaWarn(); } catch {}
      break;
    case 'missile':
      F.mslWarnT = performance.now() + (msg.ms || 4000);
      if (F.toast) F.toast('⚠ MISSILE INBOUND: FLARES (X) + BREAK');
      try { mslWarble(); } catch {}
      break;
    case 'flares':
      if (F.toast) F.toast('FLARES AWAY');
      try { flareFx(); } catch {}
      launchFlares(F, F.s);
      break;
    case 'lockbreak':
      F.lockId = null; F.lockProg = 0; F.seekId = null;
      if (F.toast) F.toast('LOCK LOST');
      break;
    case 'clear':
      F.mslWarnT = 0;
      if (F.toast) F.toast('RWR CLEAR');
      break;
  }
}

// Incoming AA tracer, visual only (damage is `air_hit`); raised from the gun's world tile.
const AA_TRACER_MS = 900;
export function flightSimAaTracer(msg) {
  const F = _fsim; if (!F || !msg) return;
  F.aaTracerT = performance.now();
  F.aaTracerBearing = msg.bearing || 0;
  F.aaTracerX = Number.isFinite(msg.x) ? msg.x : null;   // null falls back to screen space
  F.aaTracerY = Number.isFinite(msg.y) ? msg.y : null;
  F.aaTracerHit = !!msg.hit;
  F.aaTracerSeed = Math.random() * 100;
  const near = msg.near ?? 0.5;
  try { aaGunFx(near, seatSpot(msg.x, msg.y)); } catch {}
  try { tracerFx(near); } catch {}
}

// Fireworks boom for a pilot, by distance; the burst itself is drawn from world-feed.js.
export function flightSimFireworks(msg) {
  const F = _fsim; if (!F || !msg) return;
  if (msg.sfx && F.pos) {
    const d = Math.max(Math.abs(msg.x - F.pos.x), Math.abs(msg.y - F.pos.y));
    const gain = Math.max(0, 1 - d / 40);
    const at = seatSpot(msg.x, msg.y);
    if (gain > 0.05) { try { window.AudioEngine?.playSfx(msg.sfx, gain, at ? { position: at, rolloff: 0, doppler: false } : {}); } catch {} }
  }
}

// Storm lightning from the server's stormTick.
export function flightSimLightning(msg) {
  if (!msg) return;
  pushLightningStrike(msg.gx, msg.gy, msg.intensity, !!msg.cc);
}

// The hopper card, answering `hopperbay`. A can of another fluid shows disabled with the reason, never hidden.
export function flightSimHopper(msg) {
  const F = _fsim; if (!F || !msg) return;
  const card = document.getElementById('fsim-hop'); if (!card) return;
  const cap = Math.max(1, msg.cap || 1), amt = clampNum(msg.amount || 0, 0, cap);
  const pct = Math.round(amt / cap * 100);
  const sub = msg.airborne
    ? 'Pouring chemical is a ground job, land first.'
    : amt <= 0 ? 'Empty. Pour a container in to load her.'
    : `${amt} of ${cap} units of ${esc(msg.fluid || 'fluid')} aboard.`;
  const cans = Array.isArray(msg.cans) ? msg.cans : [];
  const rows = cans.map((k) => {
    const clash = amt > 0 && msg.fluid && k.fluid !== msg.fluid;
    const off = clash || msg.airborne;
    return `<button class="hop-can" data-can="${esc(k.name)}"${off ? ' disabled' : ''}>`
      + `<b>${esc(k.name)}</b>${k.count > 1 ? ` <span style="display:inline">×${k.count}</span>` : ''}`
      + `<span>${clash ? `holds ${esc(k.fluid)}, but she's loaded with ${esc(msg.fluid)}`
        : `${k.amount} units of ${esc(k.fluid)}`}</span></button>`;
  }).join('');
  card.innerHTML = `<button class="hop-close" id="fsim-hop-x" title="close">✕</button>`
    + `<h4>⬗ HOPPER · ${pct}%</h4><div class="hop-sub">${sub}</div>`
    + `<div class="hop-gauge"><div class="hop-fill" style="width:${pct}%"></div></div>`
    + (rows || '<div class="hop-none">Nothing in your hands is holding liquid. Fill a container first.</div>');
  card.classList.add('on');
  card.querySelector('#fsim-hop-x')?.addEventListener('click', () => card.classList.remove('on'));
  card.querySelectorAll('.hop-can').forEach((b) => b.addEventListener('click', () => {
    sendCmdSilent(`loadhopper with ${b.getAttribute('data-can')}`);
    sendCmdSilent('hopperbay');   // answered in order, so it reads the tank after the pour
  }));
}

// Traffic relay, stamped with receipt time for dead reckoning.
export function flightSimContacts(msg) {
  const F = _fsim; if (!F || !msg) return;
  const now = performance.now();
  F.contacts = (msg.contacts || []).map(c => ({ ...c, t: now }));
}

// Dispatch uses this to keep room renders off the cockpit.
export function isFlightSimActive() { return !!_fsim; }

// On every login: ⚠ the sim outlives the socket, so ask for the seat back after a server restart
// and re-report wheels-up (the server ignores a duplicate).
export function resumeFlightAfterLogin() {
  const F = _fsim;
  if (!F || !F.aircraftId) return;
  sendCmdSilent('flightresume ' + F.aircraftId);
  if (F.reportedAirborne) sendCmdSilent('flightevent takeoff');
}

// ── THE HANGAR'S HOOKS ───────────────────────────────────────────────────────
// For the hangar bench (hangar-bay.js), so it never reaches into F.
export function cockpitServiceHost() { return _fsim ? document.querySelector('#fsim-root .fsim-view') : null; }
// ⚠ A preview over F.livery in the chase view only; never the paint itself.
let LIVERY_PREVIEW = null;
export function cockpitPreview({ livery = null } = {}) { LIVERY_PREVIEW = livery || null; }
/** Read the view ('ext' or 'cab') with no argument; set it with one. */
export function cockpitView(mode, { quarter = false } = {}) {
  const F = _fsim; if (!F) return null;
  if (mode === 'ext' || mode === 'cab') F.setExternalView?.(mode === 'ext');
  if (quarter && mode === 'ext') {
    // Front-right three-quarter, zoomed to the renderer's standoff.
    F.orbitResetting = false;
    F.extOrbit = ((225 - (RENDER_TUNE.chaseYaw || 0)) % 360 + 360) % 360;
    F.extPitch = 0.32; F.extZoom = 0.01;
  }
  return F.external ? 'ext' : 'cab';
}
/**
 * Whether she has left the spot she was serviced on: in the air, rolling out, or taxiing at more
 * than a walk. An engine run-up on the hangar floor is not leaving, so the engine alone is not.
 */
export function cockpitRolling() {
  const F = _fsim; if (!F?.s) return false;
  return !!(F.reportedAirborne || F.rolling || (F.s.onGround && F.engineOn && Math.abs(F.s.airspeed || 0) > 4));
}
/**
 * Swing the chase camera onto a shot (camera-tween.js SHOTS). See cab-view cabFrame. Inside a GLASS
 * hangar the bench passes a zoom under the standoff, which windshield.js clamps to it.
 */
export function cockpitFrame(shot, ms = 700) {
  const F = _fsim; if (!F || !shot) return;
  if (!F.external) F.setExternalView?.(true);
  F.orbitResetting = false;
  tweenOrbit(F, { yaw: 'extOrbit', pitch: 'extPitch', zoom: 'extZoom' },
    { yaw: shot.yaw - (RENDER_TUNE.chaseYaw || 0), pitch: shot.pitch, zoom: shot.zoom }, ms);
}

// As isFlightSimActive, for the glass HUD: ⚠ without it a `refresh` zone_event clobbers it mid-landing.
export function isCockpitHudActive() { return !!document.getElementById('ck-hud-root'); }

// For the server-less flightsim.html test page, which regenerates map windows itself. Unused in the game.
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
  LIVERY_PREVIEW = null;
  window.dispatchEvent(new Event('fsim:closed'));
  if (F.raf) cancelAnimationFrame(F.raf);
  if (F.toastT) clearTimeout(F.toastT);
  F.dkTipEl?.remove();   // these two live on <body>
  F.gpsClose?.();
  for (const [t, ty, fn, op] of F.listeners) { try { t.removeEventListener(ty, fn, op); } catch {} }
  try { disposeWindshield('fsim-ws'); } catch {}
  try { clearFlightDrugFx(document.getElementById('fsim-root')?.querySelector('.fsim-view'), document.getElementById('fsim-ws')); } catch {}
  stopEngineAudio(); stopBoatContacts();
  document.body.classList.remove('fsim-fullscreen');
  document.body.classList.remove('fsim-hidepanel');
  document.body.classList.remove('fsim-noglass');
  document.body.classList.remove('fsim-external');
  exitBigScreen();
  endSeatKeyboard();
  // ⚠ The free camera and mouse stick are module-scoped and listen on the window: release both,
  // or the next aircraft opens with the keyboard taken and the cursor hidden.
  freeCam.close();
  document.body.classList.remove('fsim-freecam');
  freeIdle?.unbind(); freeIdle = null;
  stickUnbind?.(); stickUnbind = null;
  document.body.classList.remove('fsim-active');
  window.dispatchEvent(new Event('pane:released'));
  suppressWeatherFx(false, 'cockpit');
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. TARGETING: the gun-pass reticle deck
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
    <div class="ck-status2" id="ck-status"><span class="ck-hint">Move the pipper onto the target and hold it to LOCK, then FIRE (space / click).</span></div>
    <div class="ck-actions"><button class="ck-btn ck-btn-fire">Fire &#9251;</button><button class="ck-btn ck-btn-abort">Break Off</button></div>
  </div>`;

  const mounted = mountOverlay({ id: 'cockpit-overlay', html, closeOnBackdrop: false,
    onClose: () => { if (raf) cancelAnimationFrame(raf); for (const [t, ty, fn, op] of listeners) t.removeEventListener(ty, fn, op); } });
  const overlay = mounted.overlay; const svg = overlay.querySelector('#ck-tgt-svg');
  const setStatus = (h) => { const el = overlay.querySelector('#ck-status'); if (el) el.innerHTML = h; };

  const finish = (won) => {
    if (over) return; over = true; if (raf) cancelAnimationFrame(raf); raf = 0;
    csfx(won ? 'flight-guns' : 'flight-abort', won ? 'hololock-win' : 'hololock-lose');
    setStatus(won ? '<span class="ck-win">◇ SPLASH: target destroyed.</span>' : '<span class="ck-lose">✕ No hits: you overfly the target.</span>');
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
    if (locked && !wasLocked) setStatus('<span style="color:#46e05a">LOCK: FIRE!</span>');
    if ((t - t0) / 1000 >= TIME) { finish(false); return; }
    raf = requestAnimationFrame(tick);
  };
  window.AudioEngine?.init?.(); csfx('flight-approach', 'hololock-entry');
  last = performance.now(); raf = requestAnimationFrame(tick);
}
