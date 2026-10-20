// THE LONG HAUL: the cab.
//
// The world isn't drawn here. It's handed to 'paintWindshield' with 'height: 0', which drops the
// eye to the ground. 'hud', 'airport', 'windowClass' and 'external' are deliberately not passed.
// Simulate locally at 60fps, report to the server and let it clamp (reconcileTruck in
// plugins/trucking/state.js); the server never re-simulates.

import { paintWindshield, windshieldHTML, ensureWindshieldStyles, disposeWindshield,
  groundObstructionAt, MODEL_MAX_EXTENT, TRUCK_STEP_Z, RENDER_TUNE, navMarks, cabTrim, cabWheelHub, cabWheelGeom, cabGpsRect, cabControlRects, cabDashCanvas , ROAD_RIG_MUL, interiorHotspots,
  perfBegin, perfEnd, perfTick, lastViewState } from './windshield.js';
import { TYPES, IDLE, createTruckState, truckReadout, step, truckShift, truckSplit, truckSelectGear, bestGear } from './flight-model.js';
import { createFreeCam, freeCamHint, bindFreeCamPointer, bindFreeCamIdle } from './freecam.js';
import { internMap } from './map-intern.js';
import { bindTouchGestures } from './touch-gestures.js';
import { tweenOrbit } from './camera-tween.js';
import { bindBigScreenButton, exitBigScreen, BIGSCREEN_GLYPH, BIGSCREEN_TITLE } from './bigscreen.js';
import { claimSeatKeyboard, endSeatKeyboard, grabSeatKeys } from './seat-keys.js';
import { updateBoatContacts, stopBoatContacts } from './boat-audio.js';
import { updateEngineAudio, stopEngineAudio, damageCue, damageBed, stopDamageBed, airHornOn, airHornOff, lockKlaxon } from './engine-audio.js';
// The cab draws its own weather, so the pane's overlay stands down while it owns the pane.
import { suppressWeatherFx } from './weather-fx.js';
import { createHelmWheel, TRUCK_LOCK_TURNS, TRUCK_LOCK_RAD } from './helm-wheel.js';
import { truckLivery } from './aircraft3d.js';   // stored paint → renderer livery, the one conversion
import { sendCmdSilent } from '../net.js';
import { CAB_VIEW_TUNE } from '../../../shared/cab-render-tune.js';   // this view's own load-shedding numbers (see that file)
import { TILES_PER_MILE } from '../../../shared/road-units.js';   // the one tiles→miles conversion, shared with the server
import { cbRadioHTML, wireCbRadio, cbTabKey } from './cb-radio.js';
import { makeDraggable } from './confirm.js';
// Hunger and thirst are already on the live player object, so reading them costs no request.
import { state as gameState } from '../state.js';
import { seatHidePanel, TOUCH_MQ, isTouchView } from '../../../shared/compact-view.js';
import { makeContactTrack } from './world-feed.js';
import { loadCss } from '../../../shared/dom.js';

const CAB_CSS = await loadCss(new URL('./cab-view.css', import.meta.url));

// ── THE TOUCH SHELF ───────────────────────────────────────────────────────────
// On touch the shelf carries only what a leg needs, on one line; the automatic always drives there.
// ⚠ Reverse stays: the automatic never picks it. ⚠ TOUCH_MQ is the one definition, shared with the
// stylesheet, or a manual box loses its gearbox. Elsewhere the shelf is visually hidden, never
// deleted: screen readers and the keyboard operate it, and the painted dash ends at its handlers.
const cabTouch = isTouchView;

// Telemetry: fast while rolling, a heartbeat when stopped. The server derives the odometer itself.
// Peek: how far the eye turns at full deflection, and how fast it springs back.
const CAB_PEEK_YAW = 26, CAB_PEEK_DECAY = 0.78;
// Free look is the peek's middle-drag gesture, unlatched: wider, and it holds.
const CAB_LOOK_YAW = 180, CAB_LOOK_PITCH = 74;
// ⚠ 74° pitch sits inside the horizon solver's 77° limit, where the shift goes infinite.
const SYNC_MS = 500;              // rolling
const IDLE_SYNC_MS = 2500;        // stationary: a heartbeat
// ⚠ Mirrors the server's floor (MIN_SYNC_MS in plugins/trucking/state.js): a packet inside it is dropped unread.
const MIN_SYNC_MS = 120;
// Mirrors re-render four times a second.
const REAR_MS = 250;
// ⚠ The mirror takes a 13x13 slice of the map window: its cost is tiles, not canvas size.
// GLASS 2 stays on for it; the 2-D painter is slower at the same window.
const REAR_R = 6;
const rearMap = (map) => {
  if (!map || !map.length) return map;
  const R = (map.length - 1) / 2;
  if (!(R > REAR_R)) return map;
  const lo = R - REAR_R, hi = R + REAR_R;
  return map.slice(lo, hi + 1).map((row) => row.slice(lo, hi + 1));
};
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

let P = TYPES.hauler;
// The type id, which picks the mesh silhouette; 'P' holds only the numbers.
let TYPE_ID = 'hauler';
// Whatever the depot sprayed on it, in the truck paint vocabulary (`truck:` patterns, aircraft3d).
let PAINT = null;
// The fitting suffix in the mesh grammar ('^ab.cd'), handed back to the renderer as-is.
let FITS = '';
// Interior trim '{ mat, col }', or null for stock. setParams runs before the dash, which reads it.
let TRIM = null;
// Catalogue ids of what's fitted inside the cab ('custom_data.cab').
let CABFITS = [];
// A bench horn id (client/shared/truck-horns.js), or null for the factory horn.
let HORN = null;
const setParams = (ctx) => {
  P = (ctx && ctx.params) || TYPES[ctx && ctx.typeId] || TYPES.hauler;
  if (ctx && ctx.typeId) TYPE_ID = ctx.typeId;
  if (ctx && 'paint' in ctx) PAINT = ctx.paint || null;
  if (ctx && 'fits' in ctx) FITS = ctx.fits || '';
  if (ctx && 'trim' in ctx) TRIM = ctx.trim || null;
  if (ctx && 'cab' in ctx) CABFITS = Array.isArray(ctx.cab) ? ctx.cab : [];
  if (ctx && 'horn' in ctx) HORN = ctx.horn || null;
};

// The type's 'tier' picks the interior. ⚠ The ladder adds instruments, never assistance: if a
// dearer truck drove better for a reason outside 'effTruckParams', the physics would have two homes.
const CAB_KIT = {
  0: { tach: false, best: false, brakeTemp: false, trailerAngle: false, label: 'KRELL BARROW' },
  1: { tach: true,  best: false, brakeTemp: false, trailerAngle: false, label: 'OSTREK COURIER' },
  2: { tach: true,  best: true,  brakeTemp: true,  trailerAngle: false, label: 'VACHON DRAYMAN' },
  3: { tach: true,  best: true,  brakeTemp: true,  trailerAngle: true,  label: 'ORLOV CONTINENTAL' },
};
const kitFor = (p) => CAB_KIT[p?.tier] || CAB_KIT[1];

// ── THE CONTROLS, IN ONE PLACE ───────────────────────────────────────────────
// The legend the ? card renders.
const CONTROLS = [
  ['Drag the wheel', "Steer. Take hold of the wheel on the dash anywhere on it and turn it, or put a hand anywhere else on the glass and drag sideways. It walks back to centre when you let go. In the chase view the same drag orbits the camera instead, the middle button does too, if that's the hand you have, and the scroll wheel dollies it."],
  ['X / C or ← →', 'Steer. X and C are the flight sim rudder keys, so the hand that flies already knows them; the arrows do the same thing. One full turn of the wheel is full lock.'],
  ['Centre boss', 'The horn. Press the middle of the wheel.'],
  ['GPS screen', "Tap it. The map is the road you're actually on; tapping opens the fork, with the distance and whether your tank reaches. Picking one runs the ordinary route command, so it obeys the same rules typing it would."],
  ['Lever', "The gear lever, in an H-gate. Drag the knob into a slot, or just click the slot. The knob sits in whatever gear you're actually in."],
  ['LO / HI', 'Range. The box is a four-by-two: the same four slots are gears 1-4 in LO and 5-8 in HI, and changing range in gear takes four ratios with it.'],
  ['A / THROTTLE', 'Throttle. Held. The engine takes a moment to come up on boost, and longer in a low gear.'],
  ['Z', 'Service brakes. They heat, and hot brakes fade.'],
  ['SPACE / CLUTCH', "Clutch. Held, or TAP the pedal to latch it in, which is how you shift with one hand on a mouse. The box isn't synchronised: a gear only goes in with the clutch in, and trying it without grinds the box into neutral. It's also how you restart a stalled engine."],
  ['J / JAKE', "Engine brake. Held. Free retardation on a descent. It doesn't heat the drums."],
  ['↑ ↓', 'Shift up / down, on the same cluster the wheel is on: ← → steers, ↑ ↓ works the box.'],
  ['. and ,', 'Shift up / down, the other way round. Gear 0 is neutral.'],
  ['K / KEY', 'The ignition. Off stops the engine; on cranks it, and it only catches with the clutch in or the box in neutral, same rule as restarting a stall.'],
  ['M / AUTO', "Automatic shifting. It works the clutch and the lever for you and you can watch it do it: the stick goes out through neutral and into the slot, the pedal goes in and comes up. It never chooses reverse, and it has no authority you do not: it can lug the engine and it can be fluffed, because it's a hand on the same controls."],
  ['SHIFT+M / A-CLU', "Automatic clutch, for manual. On (the default) the clutch works itself: a gear goes in wherever you put the lever and the pedal holds itself in at a stop so you can't stall. Off, the pedal is yours and the box grinds without it. Click the gearstick on the dash to open the gearshift, where you also pick your knob."],
  ['G / CRUISE', "Cruise control. Locks the speed you're doing, the brake, the clutch or dropping out of gear cancels it. It works the throttle and nothing else, so a hill still beats you in the wrong gear."],
  ['/', 'Splitter: half a gear.'],
  ['R', 'Reverse. Only from a standstill.'],
  ['H', 'Air horn. The room hears it.'],
  ['L / LAMPS', 'Headlights. They default on, because a rig runs lit, switching them off is a thing you chose, and other drivers see your actual lamps.'],
  ['I / CAB', "The dome lamp over your head. Off, the panel lamps stay lit and everything else in the cab goes dark, which is what a night shift looks like from the seat; there's still enough of the dash to find a knob by."],
  ['W / the stalk', 'Wipers. The stalk is on the column beside the wheel and it wears its own setting, off, intermittent, low, high.'],
  ['Q / E / S', "Look left, right, and over your shoulder. Held: you look, then you come back. There's no dash behind the side glass, so the view out of it is clear."],
  ['V', 'External view: a chase camera behind the rig, on the same key the cockpit uses. Dolly right in and it settles flat to the road so you can see ahead of you; you can still orbit right round at any distance. (F still works.)'],
  ['Y / LATCH', "The cab door latches. They start OPEN, which is what makes the button worth finding: stop on the corridor beside somebody with their hand out and they will let themselves into the passenger seat. Locked, nobody gets in and you pick people up on purpose with pickup. It's remembered per truck."],
  ['T / GALLEY', "What's in the cab to eat or drink, with your food and water bars over it. Every row runs the ordinary eat or drink command, so it does exactly what typing would. This is a flap, not a second way to eat."],
  ['D', 'Damage. Four bars: engine, wheels, body, and the trailer if you have one. The strip in the corner is always there; this opens it out.'],
  ['N', "Nav marks. The red chevrons that point at traffic you can't see and the mark on your waypoint, off, and the glass is just the road. Remembered. The free camera hides them regardless, because they point the way the TRUCK is facing and it isn't on the truck."],
  ['⊟ / ⛶ / ⤢', "Three rungs of the same ladder. Hide the text panel for more road; fullscreen takes the command box with it; big screen takes the whole page, no sidebar, no panels, nothing on the glass but the road. Esc comes back from the last one."],
];

// Damage HUD words; the numbers and bands are the server's (damage.js). Each note names the consequence.
const DMG_PARTS = [
  { key: 'engine',  short: 'ENG', label: 'ENGINE',  note: 'pull' },
  { key: 'wheels',  short: 'WHL', label: 'WHEELS',  note: 'grip and stopping' },
  { key: 'body',    short: 'BDY', label: 'BODY',    note: "what it's worth" },
  { key: 'trailer', short: 'TRL', label: 'TRAILER', note: 'the box behind you' },
];

// The chase camera's resting elevation in radians; it is the real elevation at every zoom.
// 'chaseAmt' overrides the pitch when dollied in close, so this only sets the resting shot.
const EXT_REST_PITCH = 0.43;
// ── DOLLYING IN DROPS THE CAMERA TO THE ROAD ──────────
// ⚠ It must never touch yaw: a close-up turntable is the point of the external view. The player's
// pitch is overridden while close, never overwritten.
const CHASE_FROM = 0.62;          // where the camera starts coming down
const CHASE_FULL = 0.34;          // ...and where it is flat on the road
const CHASE_PITCH = 0.07;         // road level, looking along the lane rather than down on the roof
const chaseAmt = (zoom) => Math.max(0, Math.min(1, (CHASE_FROM - zoom) / (CHASE_FROM - CHASE_FULL)));

// ── THE PICTOGRAMS ───────────────────────────────────────────────────────────
// Line art on a 24×24 grid, stroked in currentColor so each inherits its key's state. Stroke only,
// nothing finer than ~2px at render size.
const ICON = {
  wiper: '<path d="M2.5 20h19"/><path d="M6.5 20 14 8.2"/><path d="M12.4 7.1 16.9 9.9"/>'
    + '<path d="M5.2 15.6a9.5 9.5 0 0 1 13-4.6" stroke-dasharray="2.4 2.2"/>',
  jake: '<rect x="3.5" y="9.5" width="10" height="8" rx="1.4"/><path d="M6.2 9.5V7.2M10.8 9.5V7.2"/>'
    + '<path d="M18.5 7.5v8.4"/><path d="M15.6 13.2l2.9 3 2.9-3"/>',
  horn: '<path d="M3.5 10.2h3l6-4.2v12l-6-4.2h-3z" stroke-linejoin="round"/>'
    + '<path d="M16 9.2a4.4 4.4 0 0 1 0 5.6"/><path d="M18.8 6.9a8 8 0 0 1 0 10.2"/>',
  split: '<path d="M4 8.5h16M4 15.5h16" stroke-dasharray="2.6 2.4"/><path d="M12 5.4v13.2"/>'
    + '<path d="M9.4 8 12 5.4 14.6 8"/><path d="M9.4 16 12 18.6 14.6 16"/>',
  range: '<path d="M5 18V11"/><path d="M12 18V7"/><path d="M19 18V3.4"/><path d="M3 20.5h18"/>',
  mirrorL: '<rect x="3" y="7.5" width="8" height="6.4" rx="1.2"/><path d="M11 10.7h4.4"/><path d="M15.4 5.5v12"/>',
  mirrorR: '<rect x="13" y="7.5" width="8" height="6.4" rx="1.2"/><path d="M13 10.7H8.6"/><path d="M8.6 5.5v12"/>',
  mirrorC: '<rect x="3.5" y="8" width="17" height="6" rx="1.6"/><path d="M12 8V4.5"/><path d="M9.6 4.5h4.8"/>',
  steerL: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.1"/><path d="M12 4v2.4M5.6 15.6l2-1.2M18.4 15.6l-2-1.2"/><path d="M7.2 7.6 4.6 8.4l.8-2.7"/>',
  steerR: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.1"/><path d="M12 4v2.4M5.6 15.6l2-1.2M18.4 15.6l-2-1.2"/><path d="M16.8 7.6l2.6.8-.8-2.7"/>',
};
// aria-hidden: every icon sits in a button that already has a name.
const svgIcon = (k) => '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"'
  + ' stroke-width="1.7" stroke-linecap="round">' + (ICON[k] || '') + '</svg>';


// ── THE GATE ─────────────────────────────────────────────────────────────────
// Plate positions in 0..1 and a slot (1-4); gear = slot + range*4. Reverse and neutral carry a gear.
// ⚠ WIPE_POS is module scope: the hoisted paintWipers reads it early in the mount, and a const
// inside openCab threw in its temporal dead zone.
const WIPE_POS = ['OFF', 'INT', 'LOW', 'HIGH'];
const CAB_GATE = [
  { x: 0.24, y: 0.15, slot: 1 },
  { x: 0.24, y: 0.85, slot: 2 },
  { x: 0.52, y: 0.15, slot: 3 },
  { x: 0.52, y: 0.85, slot: 4 },
  { x: 0.80, y: 0.85, gear: -1, label: 'R' },     // reverse, on its own dogleg
  { x: 0.38, y: 0.50, gear: 0, label: 'N' },      // neutral, the crossgate
];

// ── WHAT IS ON THE BOARD, AND WHERE ──────────────────────────────────────────
// One row per control, naming the shelf button it is.
// ⚠ State is read off that button, never kept here: the painted dash is a view of the shelf, and a
// press ends at the button's own click. Left bank is the truck, right is the rig and cab.
const CAB_CTL = [
  { key: 'key',     sel: '.cab-keybarrel', bank: 'left',  kind: 'barrel', label: 'KEY' },
  { key: 'jake',    sel: '.cab-jake',      bank: 'left',  kind: 'rocker', label: 'JAKE',   col: '#e8c07a' },
  { key: 'heads',   sel: '.cab-heads',     bank: 'left',  kind: 'rocker', label: 'LAMPS',  col: '#e8c07a' },
  { key: 'dome',    sel: '.cab-dome',      bank: 'left',  kind: 'rocker', label: 'CAB',    col: '#d8cca4' },
  { key: 'horn',    sel: '.cab-horn',      bank: 'left',  kind: 'rocker', label: 'HORN',   col: '#d2603f' },
  { key: 'cruise',  sel: '.cab-cruise',    bank: 'left',  kind: 'rocker', label: 'CRUISE', col: '#8fe0a0' },
  // The collars live with the gate: everything that decides the gear is in one place.
  { key: 'range',   sel: '.cab-range',     bank: 'right', kind: 'rocker', label: 'RANGE' },
  { key: 'split',   sel: '.cab-splitbtn',  bank: 'right', kind: 'rocker', label: 'SPLIT' },
  { key: 'auto',    sel: '.cab-auto',      bank: 'right', kind: 'rocker', label: 'AUTO',   col: '#8fe0a0' },
  { key: 'clu',     sel: '.cab-autoclu',   bank: 'right', kind: 'rocker', label: 'AUTO CLU', col: '#e8c07a' },
  { key: 'rev',     sel: '.cab-revbtn',    bank: 'right', kind: 'rocker', label: 'REV',    col: '#d2603f' },
  { key: 'trailer', sel: '.cab-hitchbtn',  bank: 'right', kind: 'knob',   label: 'TRAILER AIR',
    rgb: [186, 64, 54], rgbOff: [104, 48, 42], sides: 8 },
  { key: 'park',    sel: '.cab-parkbtn',   bank: 'right', kind: 'knob',   label: 'PARK' },
  { key: 'pump',    sel: '.cab-pumpbtn',   bank: 'right', kind: 'knob',   label: 'PUMP',
    rgb: [214, 168, 38], inWord: 'HOLD', outWord: 'HOLD' },
  { key: 'latch',   sel: '.cab-latchbtn',  bank: 'right', kind: 'rocker', label: 'DOORS' },
  { key: 'galley',  sel: '.cab-galleybtn', bank: 'right', kind: 'rocker', label: 'GALLEY' },
  { key: 'exit',    sel: '.cab-exitbtn',   bank: 'right', kind: 'plate',  label: 'EXIT', face: 'OPEN' },
];
// The gearbox controls a touch screen doesn't get, because the automatic drives there (setAuto).
const TOUCH_AUTO_CTL = new Set(['range', 'split', 'auto', 'clu']);

// Whether anything is falling on the glass. Acid rain and ion storms are events over a 'rain' word.
function cabWet(s) {
  const ev = s?.wxEvent?.type;
  return ['rain', 'storm', 'snow'].includes(s?.weather) || ev === 'acid_rain' || ev === 'ion_storm';
}
// On touch the wipers are automatic (no W key, no stalk on the shelf). Only ever writes what the stalk would.
function touchWipers(s) {
  if (!s || !cabTouch()) return;
  const ev = s.wxEvent?.type;
  const want = !cabWet(s) ? 0 : (s.weather === 'storm' || ev === 'ion_storm') ? 3 : 2;
  if ((s.wipers | 0) === want) return;
  s.wipers = want;
  s.paintWipers?.();
}

// The gearbox switch, remembered across mounts. Default on; see setAuto.
const AUTO_KEY = 'truckAutoShift';
function autoPref() {
  try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch { return true; }
}
// The driver's shift knob: a name drawShiftKnob in windshield.js knows how to draw.
const SHIFT_KNOBS = [['ball', 'Black ball'], ['eightball', '8-ball'], ['skull', 'Skull'], ['chrome', 'Chrome'],
  ['crystal', 'Crystal'], ['walnut', 'Walnut'], ['dice', 'Die']];
const KNOB_KEY = 'truckShiftKnob';
function knobPref() {
  try { const k = localStorage.getItem(KNOB_KEY); return SHIFT_KNOBS.some(([id]) => id === k) ? k : 'ball'; } catch { return 'ball'; }
}
const AUTOCLU_KEY = 'truckAutoClutch';
function autoCluPref() {
  try { return localStorage.getItem(AUTOCLU_KEY) !== '0'; } catch { return true; }
}

let st = null;
// One camera, module-scoped like 'st', so the key handler and the paint call reach the same object.
const freeCam = createFreeCam();
// The idle timer that clears the chrome off the glass; bound and released with the cab.
let freeIdle = null;
// Free-camera chrome: a one-line hint, and the shelf hidden.
// ⚠ Hidden with display:none, never faded: bindFreeCamPointer captures only the glass, so a visible
// shelf could still drive the truck the mode says it's holding.
function paintFreeCamChrome() {
  const host = st?.container?.querySelector('.cab-wrap') || st?.container;
  if (!host) return;
  // ⚠ The CSS hides the shelf's children around '.cab-sr', so the screen-reader readout survives.
  host.classList?.toggle('cab-freecam', freeCam.active);
  freeIdle?.wake();
  host.querySelector('.cab-freecam-hint')?.remove();
  if (!freeCam.active) return;
  const el = document.createElement('div');
  el.className = 'cab-freecam-hint';
  el.textContent = freeCamHint(false);
  host.appendChild(el);
}

// The N switch reports in the log, the one rung Display Mode guarantees.
// ⚠ Loaded on demand: a static import of render.js closes a cycle through the boot chain.
function markSwitchTold(on) {
  import('../render.js').then((r) => r.appendHtml(
    on ? 'Nav marks back on the glass.' : 'Nav marks off the glass, the traffic chevrons and the waypoint mark. <b>N</b> puts them back.',
    'msg-system')).catch(() => { /* the marks themselves are the feedback; the line is the second surface */ });
}

export function isCabActive() { return !!st; }

// ── THE SERVICE BAY'S THREE HOOKS ────────────────────────────────────────────
// The depot bench (truck-depot.js, service mode) mounts over this glass and needs only these hooks:
// a host, a livery/trim preview, and the camera.
export function cabServiceHost() { return st ? document.querySelector('.cab-wrap') : null; }
// ⚠ A preview, never the paint: drawn only in the chase livery, cleared when the bay closes.
let PAINT_PREVIEW = null;
// The same for a retrim held on the bench. Each key is set only when passed.
let TRIM_PREVIEW = null;
export function cabPreview(o = {}) {
  if ('paint' in o) PAINT_PREVIEW = o.paint || null;
  if ('trim' in o) TRIM_PREVIEW = o.trim || null;
}
/** Read the view ('ext' or 'cab') with no argument; set it with one. */
export function cabView(mode, { quarter = false } = {}) {
  if (!st) return null;
  if (mode === 'ext' || mode === 'cab') st.setExternal?.(mode === 'ext');
  // The workshop's opening shot is a 3/4 off her front-right. The renderer adds 'chaseYaw', hence 225 net.
  if (quarter && mode === 'ext') st.extYaw = ((225 - (RENDER_TUNE.chaseYaw || 0)) % 360 + 360) % 360;
  return st.external ? 'ext' : 'cab';
}
/**
 * Swing the chase camera onto a shot (camera-tween.js SHOTS) over a moment. The bay asks for one
 * per tab so the part being bought is the part in frame. Outside view only; the player's own drag
 * or wheel takes the camera back mid-move.
 */
export function cabFrame(shot, ms = 700) {
  if (!st || !shot) return;
  if (!st.external) st.setExternal?.(true);
  tweenOrbit(st, { yaw: 'extYaw', pitch: 'extPitch', zoom: 'extZoom' },
    { yaw: shot.yaw - (RENDER_TUNE.chaseYaw || 0), pitch: shot.pitch, zoom: shot.zoom }, ms);
}
/**
 * A blip of throttle for the ear only: the bay revs the engine when a tune or a kit goes on, the way
 * a garage does. The sim's rpm is untouched; the voice is handed rpm + kick for half a second and
 * the throttle drop at the end gives the backfire for free. Nothing happens with the engine off.
 * Returns whether it revved.
 */
export function cabRev(amount = 0.55) {
  if (!st || st.sim.stalled || st.dry || st.broken) return false;
  st.revAt = performance.now(); st.revAmt = amount;
  return true;
}
// The rev's shape: up in a tenth of a second, then down over the next half.
function revKick(now) {
  if (!st.revAt) return 0;
  const t = (now - st.revAt) / 1000;
  if (t > 0.9) { st.revAt = 0; return 0; }
  return (st.revAmt || 0) * (t < 0.1 ? t / 0.1 : Math.exp(-(t - 0.1) / 0.22));
}

// ── THE SHELF IS THE BOTTOM OF THE SAME BOARD ────────────────────────────────
// ⚠ Its colours come from the trim row the renderer paints with ('cabTrim'), never a second palette,
// so a retrimmed cab retrims the shelf too. 'dash' is the fascia's three stops, 'lip' the moulding
// highlight, 'rim'/'rimHi' the bezel edge.
const mixHex = (hex, k) => {
  const h = String(hex || '#000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  if (!Number.isFinite(n)) return hex;
  const t = k < 0 ? 0 : 255, a = Math.abs(k);
  const ch = (sh) => Math.round(((n >> sh) & 255) * (1 - a) + t * a);
  return 'rgb(' + ch(16) + ',' + ch(8) + ',' + ch(0) + ')';
};
function cabBoardVars(T) {
  const d = T?.dash || ['#3b414a', '#1e2228', '#0d0f12'];
  return [
    '--cab-glow:' + (T?.glow || '#e8c07a'),
    // The shelf starts at the fascia's middle tone (a lower panel catches more light), meeting it at one tone.
    '--cab-seam:' + mixHex(d[2], -0.30),
    '--cab-board-hi:' + mixHex(d[1], -0.02),
    '--cab-board-lo:' + mixHex(d[2], -0.22),
    '--cab-lip:' + (T?.lip || 'rgba(190,205,225,0.16)'),
    '--cab-rim:' + (T?.rim || 'rgba(28,31,36,0.95)'),
    '--cab-rim-hi:' + (T?.rimHi || 'rgba(150,165,185,0.13)'),
    // ⚠ A recess is derived from the board, never from 'face': a hole is darker than its surround.
    '--cab-recess-hi:' + mixHex(d[2], -0.55),
    '--cab-recess-lo:' + mixHex(d[2], -0.8),
  ].join(';');
}

export function openCab(ctx = {}) {
  const container = ctx.mount || document.getElementById('area-content');
  if (!container) return null;
  closeCab();
  suppressWeatherFx(true, 'cab');
  ensureWindshieldStyles();
  ensureCabStyles();
  const id = 'cab';
  setParams(ctx);                                  // before the dash is built
  const kit = kitFor(P);
  // ⚠ No newline after the backtick: leading whitespace becomes a text node with a line box, and
  // the 100%-tall wrap then overflows the pane by that much.
  container.innerHTML = `<div class="cab-wrap cab-t${P.tier ?? 1}" style="${cabBoardVars(cabTrim(P.tier, TRIM))}">
      ${windshieldHTML(id, kit.label)}
      <!-- ── WHAT IS BEHIND YOU ──────────────────────────────────────────────
           The mirrors show the world, and the world is what the renderer draws, so this is a
           SECOND WINDSCREEN pointed the other way: the same 'paintWindshield' over the same map
           at heading + 180, with 'bare' set so it contains no cab, no surround and no badge.
           drawCabMirror blits it into the glass.

           ⚠ IT IS A REAL ELEMENT WITH A REAL BOX, not a detached canvas: paintWindshield's first
           two lines are a getElementById and a clientWidth/clientHeight check, so 'display:none'
           makes it return without drawing and the mirrors stay stubs with nothing to say why.
           'visibility:hidden' keeps the box and takes it off the screen.

           ⚠ AND ONE CANVAS, NOT TWO. A canvas id is a SCENE, and with GLASS 2 a scene is a WebGL
           context — the browser caps those at 16 and starts force-losing the oldest, which is the
           seat you are driving. Two mirrors sharing one rear render costs one context; one each
           would cost two for a picture nobody can tell apart at this size. -->
      <canvas id="${id}-rear" class="cab-rearcam" aria-hidden="true"></canvas>
      <!-- ── THE GLASS CHROME, AND WHAT IT IS FOR ────────────────────────────
           THE CORNER IS THE SYSTEM CORNER. Every panel in this client puts the same things in the
           top right and nothing else: how big the picture is, which camera it's from, and where
           the legend lives — fullscreen, hide-panel, view, help. That's a consistent place
           precisely because its contents are consistent, and a player who has flown already knows
           what's up there without reading it.
           ⚠ SO THE LATCH AND THE GALLEY ARE NOT UP HERE ANY MORE. They were, on the argument that
           the dash is the truck and neither the doors nor a bunk full of sandwiches is a thing the
           truck has — true, and beside the point. They aren't things the SCREEN has either, which
           is what this corner is for: everything else in it changes how you're LOOKING at the cab,
           and those two reach into the cab and operate it. Two controls in a row of window
           furniture read as window furniture. They're switches on the panel now, in the cab group
           beside the radio — see THE CAB'S OWN GROUP down on the shelf. The classes didn't change,
           so the Y and T keys, the click handlers and paintLatch all still find them. -->
      <div class="cab-chrome">
        <button class="cab-cbtn cab-viewbtn" title="external / cab view (F)">◎ EXT</button>
        <!-- Only in the chase view, and only because a turntable you can spin is a turntable you
             can get lost on. Same glyph the flight sim's orbit reset uses. -->
        <button class="cab-cbtn cab-orbitreset" title="point the camera back down the road" hidden>⟲</button>
        <button class="cab-cbtn cab-helpbtn" title="controls (?)">?</button>
        <!-- HIDE-PANEL, THEN FULLSCREEN, THEN BIG SCREEN, in that order — they're one ladder and
             it should read as one, with the biggest rung at the end of the row nearest the corner.
             ⊟ takes the log, ⛶ takes the command box with it, ⤢ takes the whole page: no sidebar,
             no header, and nothing on the glass but the road. Esc comes back from that one; it's
             the only rung that isn't its own toggle, because in it the button is gone. -->
        <button class="cab-cbtn cab-hidebtn" title="hide the text panel, more road">⊟</button>
        <button class="cab-cbtn cab-fsbtn" title="fullscreen">⛶</button>
        <button class="cab-cbtn cab-bigbtn" title="${BIGSCREEN_TITLE}">${BIGSCREEN_GLYPH}</button>
      </div>
      <!-- THE DAMAGE STRIP. Small by default and small on purpose: four letters and four coloured
           pips is enough to tell a driver at a glance that something is wrong and which thing, and
           anything larger is a panel competing with the road for the same eyes. Clicking it opens
           the full read — labelled bars, percentages, and what each one costs you — which is the
           thing you look at while parked, not while moving. One control, two densities.
           The bars are the SERVER's numbers (cabContext.dmg); nothing here computes a band. -->
      <div class="cab-dmg" role="group" aria-label="Damage">
        <button class="cab-dmg-strip" aria-expanded="false" title="damage (D)"></button>
        <div class="cab-dmg-full" hidden></div>
      </div>
      <!-- ── THE FUEL GAUGE ON THE GLASS ──────────────────────────────────────
           The dash already has a fuel dial, and it isn't enough on its own for the two moments
           that matter. In the EXTERNAL view there's no dash at all — drawCabInterior is gated on
           'not external' inside the renderer — so a driver orbiting the rig has no fuel reading of
           any kind at all. And
           while the handle is down, the thing you're watching is a needle creeping across a
           40-pixel dial with a number changing on a button somewhere else.
           So: one gauge, on the view rather than on the truck, shown in BOTH views. Always up
           outside the cab (nothing else there reads out anything); in the cab it comes up when
           there's something to watch — at a pump, or when the tank is low enough to be a decision.
           It's HTML rather than a second canvas instrument deliberately: it inherits the theme,
           it can be read aloud, and it doesn't need the renderer to know it exists. -->
      <div class="cab-fuel" hidden role="group" aria-label="Fuel">
        <div class="cab-fuel-top"><span class="cab-fuel-lb">FUEL</span><span class="cab-fuel-pct">--</span></div>
        <div class="cab-fuel-bar"><i class="cab-fuel-fill"></i><i class="cab-fuel-warn"></i></div>
        <div class="cab-fuel-ends"><span>E</span><span class="cab-fuel-note"></span><span>F</span></div>
      </div>
      <!-- ── THE BAND, AND WHY IT IS SILENT MOST OF THE TIME ──────────────────
           Starvation and dehydration are the only two things in the game that will kill a driver
           who is doing everything else right, and until now the cab said nothing about either: the
           damage strip covers the TRUCK, the fuel gauge covers the TANK, and the person in the
           seat had no readout at all. A driver could die of thirst looking at a full set of
           instruments.
           Two rungs, and the split is deliberate. AMBER is early — it appears while there's still
           road left to do something about it, which is the whole point of a warning. RED is when
           the resource-tick is actually taking HP, and it flashes, because at that point it's no
           longer information, it's an interruption.
           It reads 'HUNGER'/'THIRST' rather than a percentage on purpose: a number on the glass is
           something you monitor, and a word is something you act on. The bars, for anyone who
           wants the number, are in the galley. -->
      <div class="cab-vitband" hidden aria-live="polite"></div>
      <!-- WHAT IS IN THE CAB. Filled by the 'galley' verb's own reply, so the panel is a skin over
           exactly what the log prints — no second source, and no gameplay logic on this side of
           the wire (the preparation HUD's rule; see plugins/workspace/). -->
      <div class="cab-galley" hidden role="group" aria-label="Galley">
        <div class="cab-galley-hd"><b>GALLEY</b><button class="cab-galley-x" aria-label="Close">&times;</button></div>
        <div class="cab-galley-vit">
          <div class="cab-galley-row"><span>FOOD</span><i class="cab-galley-bar"><u data-v="hunger"></u></i><b data-p="hunger">--</b></div>
          <div class="cab-galley-row"><span>WATER</span><i class="cab-galley-bar"><u data-v="thirst"></u></i><b data-p="thirst">--</b></div>
        </div>
        <div class="cab-galley-body"><i class="cab-galley-wait">…</i></div>
      </div>
      <!-- SOMEBODY ON THE SHOULDER. The figure is drawn out on the road by the renderer; this is
           the part that survives you looking somewhere else for four seconds. It stands while they
           are in front of you and goes the moment they're aboard or behind you, and the button
           sends the plain 'pickup' verb — including for the fugitive, whose sleeper/trailer choice
           is the VERB's to ask, not this panel's to pre-empt. -->
      <div class="cab-hitchalert" hidden role="status"></div>
      <div class="cab-help" hidden></div>
      <!-- THE ROUTE PICKER. Opened by tapping the GPS screen on the dash; every row sends the
           ordinary 'route &lt;key&gt;' verb, which is what actually decides. -->
      <!-- ── THE GPS, WHICH IS A LITTLE TABLET ────────────────────────────────
           It was one screen that did one thing: tap the dash unit, get a route picker. But a
           screen in a dash is a screen, and a driver who wants to know what the truck's condition
           is shouldn't have to leave the windscreen to find out — the damage was already a payload
           the cab receives and a panel the cab renders, so it's an APP on this thing rather than a
           second surface with its own way in.
           And it POPS OUT. A 5-inch unit painted into the dash is the right size when you are
           driving and the wrong size when you're reading it, so the same panel detaches into a
           floating window you can put where you like and drag around. Same DOM, same renderers,
           one class — a second copy for the popped-out state is a second copy to keep in step. -->
      <div class="cab-routes" hidden>
        <div class="cab-gps-hd">
          <b class="cab-gps-tabs">
            <button class="cab-gps-tab on" data-app="route">ROUTE</button>
            <button class="cab-gps-tab" data-app="map">MAP</button>
            <button class="cab-gps-tab" data-app="damage">RIG</button>
          </b>
          <button class="cab-gps-pop" title="Pop out into its own window" aria-label="Pop out">&#9082;</button>
          <button class="cab-gps-x" title="Close" aria-label="Close">&times;</button>
        </div>
        <div class="cab-gps-body"></div>
      </div>
      <!-- WHERE THE KEYS ARE GOING. The cab reads A/Z/X/C/,/./R off the WINDOW, and the command
           bar is an ordinary text input sitting three inches below it — so a driver who had ever
           clicked the log was driving a truck and typing "aaazzzx" into the chat box at the same
           time, with no way to tell which of the two had the keyboard. This says which, and
           clicking it hands the keyboard back to the cab. -->
      <button class="cab-focustag" title="click here (or the windscreen) to give the keyboard back to the cab">⌨ KEYS: CAB</button>
      <div class="cab-controls">
        <!-- ── THE COLUMN ──────────────────────────────────────────────────────
             THERE IS NO WHEEL DOWN HERE ANY MORE, and that's the change. There were two: a canvas
             widget on this shelf that you turned, and an arc of rim painted up on the glass for the
             look of it — two wheels in one cab, and the one in front of the driver was the picture.
             The scene draws the real one now (drawCabWheel in windshield.js) and you turn it by
             dragging the road, or by these arrows, or with the arrow keys; all three wind the same
             helm-wheel state, which is still the only place a steering angle exists. -->
        <div class="cab-col cab-col-wheel">
          <div class="cab-steer cab-touch" role="group" aria-label="Steering">
            <button class="cab-btn cab-left" aria-label="Steer left" title="Steer left (←)"><b>${svgIcon('steerL')}</b><em>STEER</em></button>
            <button class="cab-btn cab-right" aria-label="Steer right" title="Steer right (→)"><b>${svgIcon('steerR')}</b><em>STEER</em></button>
          </div>
        </div>

        <!-- ── THE RECORD ──────────────────────────────────────────────────────
             The instruments moved onto the painted dash, where a dash is. These are the same
             numbers in words, and they're kept — VISUALLY hidden, never removed — because they
             are what a screen reader reads and what the log rung of the display ladder has always
             had. A canvas gauge isn't an accessible instrument; a canvas gauge WITH this behind
             it is. The frame loop writes them exactly as it always did. -->
        <div class="cab-col cab-col-digital cab-sr">
          <div class="cab-gauges">
            <div class="cab-readout"><b class="cab-mph">0</b><span>MPH</span></div>
            <div class="cab-readout"><b class="cab-odo">0</b><span>TILES TO GO</span></div>
            <div class="cab-readout"><b class="cab-surface">ROAD</b><span>SURFACE</span></div>
            <div class="cab-readout cab-gearbox"><b class="cab-gear">N</b><span class="cab-gearhint">GEAR &middot; , .</span></div>
          </div>
          <div class="cab-readout cab-rig"><b class="cab-brakes">COLD</b><span class="cab-riginfo">BRAKES</span></div>
        </div>

        <!-- ── THE GATE ────────────────────────────────────────────────────────
             AN H, BECAUSE THE BOX IS A 4×2. Every truck in the fleet runs eight forward ratios
             (flight-model TYPES: 'gears' is nine long, index 0 being neutral), and eight isn't a
             ladder you climb — it's four slots in an H with a RANGE lever that does them twice.
             That's what a real range-change box is and it's why the shifter is a tree rather than
             a line: LO gives you 1-4 in the four slots, HI gives you 5-8 in the same four, and your
             hand learns one shape instead of eight positions.
             The lever it replaces was a THROW — drag up, it clunks one gear, springs back. Honest
             for a sequential box and wrong for this one: it made the eight ratios a queue you had to
             walk, so downshifting three gears for a hill was three drags, and the control told you
             nothing about where you were. A gate is also a DISPLAY — the knob sits in the slot you
             are in, which is most of what a gearstick is for.
             Reverse has its own dogleg, as it does on the real thing, and neutral is the crossgate
             everything passes through.
             ⚠ EVERY SLOT IS A REAL BUTTON, and that's what let the ▲▼ pair go. They existed only
             because a lever you can work solely by dragging is a lever a keyboard user does not
             have — so the answer was never a second control beside it, it was making the lever
             itself operable. Tab to a slot and press it and you're in that gear; the drag is now
             the shortcut rather than the only way in. -->
        <div class="cab-col cab-col-gate">
          <div class="cab-gate" role="group" aria-label="Gear lever">
            <i class="cab-gate-rail cab-rail-l"></i>
            <i class="cab-gate-rail cab-rail-r"></i>
            <i class="cab-gate-rail cab-rail-x"></i>
            <i class="cab-gate-rail cab-rail-rev"></i>
            ${CAB_GATE.map((g, i) => `<button class="cab-slot" data-gi="${i}" style="left:${g.x * 100}%;top:${g.y * 100}%"></button>`).join('')}
            <!-- ── THE STICK ────────────────────────────────────────────────
                 ⚠ THE LEVER COMES UP OUT OF THE SLOT IT IS IN, and that's the whole of this
                 element. The first version drew the shaft from a fixed pivot BELOW the plate up to
                 the knob, on the theory that a gear lever comes through the floor — true of the
                 real object, and wrong for this picture, because the picture isn't a side view of
                 a cab. It's a small isometric plate seen from above and in front, so the only
                 thing that can be "below" it's the edge of the panel: what you actually got was a
                 rod running off the bottom of the frame that grew and shrank as you moved through
                 the gate, which reads as a pointer to the knob rather than as the knob's own stem.
                 Now the base of the stick IS the slot position. The whole assembly — collar, rod,
                 knob — translates as one object, so the lever passes THROUGH the gate the way a
                 real one passes through its slot, at a fixed length and a fixed lean. There's no
                 geometry left to solve: nothing measures a rect, nothing stretches, and the knob
                 can never disagree with the stick about which gear it's in because it's bolted
                 to the top of it. -->
            <div class="cab-lever" title="Throw the lever into a slot, or press one. The collar doubles the four slots into eight gears.">
              <i class="cab-boot" aria-hidden="true"></i>
              <i class="cab-shaft" aria-hidden="true"><s></s><b class="cab-knob"><s></s></b></i>
            </div>
          </div>
          <!-- THE KNOB COLLARS. On a real range-change box both of these live ON the shift knob
               under your thumb, never as a position you put the lever in — so they're two small
               switches beside the gate rather than two more keys in a row of keys. -->
          <div class="cab-collars" role="group" aria-label="Gearbox collars">
            <button class="cab-btn cab-range" aria-label="Range" title="Range collar, LO is gears 1-4, HI is 5-8"><i class="cab-rangeic">${svgIcon('range')}</i><b>LO</b><em>RANGE</em></button>
            <button class="cab-btn cab-splitbtn" aria-label="Splitter" title="Splitter collar (/), half a gear"><b>${svgIcon('split')}</b><em>SPLIT</em></button>
            <!-- AUTO. Not an automatic gearbox — there's no such truck in this fleet. It's a
                 hand on the same lever and the same pedal, and you can watch it work: the stick
                 goes through neutral, the clutch goes in, the gear goes home. Which is the point
                 of showing it rather than swapping the number silently — a driver who leaves it on
                 for a leg learns the pattern, and the day they switch it off they already know
                 where second is.
                 ⚠ IT SITS WITH THE GEARBOX, NOT ON THE DASH. It began life among the rockers with
                 the horn and the wipers, which is where a switch goes on a real truck and exactly
                 the wrong place here: everything else that decides which gear you're in — the
                 gate, the range collar, the splitter — is in this group, and the one control that
                 does all three of those jobs for you was across the cab from them. The class is
                 unchanged, so the M key, the click handler and the lamp painter all still find it. -->
            <button class="cab-btn cab-rocker cab-auto" aria-pressed="false" aria-label="Automatic shifting" title="Automatic shifting (M), works the clutch and the lever for you. Watch the stick: it shifts the way you would."><i></i><u><span>AUTO</span></u></button>
            <!-- REVERSE, AND IT EXISTS BECAUSE OF THE BUTTON NEXT TO IT. The automatic deliberately
                 never chooses reverse for you (which way a truck is pointed when it moves is the
                 one decision that stays with the person who can see out of the window), so a driver
                 who has left AUTO on has no hand on the lever and no way into it. The R key always
                 worked; a key isn't a control you can find with a mouse.
                 It runs the SAME shift sequence the automatic uses, which is what makes it neutral
                 first and reverse second rather than a gear change nobody watched happen: the
                 clutch goes in, the stick comes out to neutral, there's a pause you can see, and
                 then it goes across. Pressing it again brings it back to neutral. -->
            <!-- THE LEFT FOOT. On (the default) the clutch is worked for you in manual: a gear goes in
                 wherever you put the lever, and the pedal holds itself in at a stop so the engine
                 never stalls. Off is the full sim — the pedal is yours and the box grinds without it. -->
            <button class="cab-btn cab-rocker cab-autoclu" aria-pressed="true" aria-label="Automatic clutch" title="Automatic clutch (Shift+M), on: the clutch works itself in manual. Off: the pedal is yours."><i></i><u><span>A-CLU</span></u></button>
            <button class="cab-btn cab-rocker cab-revbtn" aria-pressed="false" aria-label="Reverse" title="Reverse (R), clutch in, through neutral, into reverse. Only at a standstill. Press again for neutral."><i></i><u><span>REV</span></u></button>
          </div>
        </div>

        <!-- ── THE COLUMN STALK ────────────────────────────────────────────────
             WIPERS ARE NOT A DASH SWITCH. On every truck ever built they're a stalk on the
             steering column, and the reason that matters isn't authenticity for its own sake — it
             is that a stalk tells you its state by WHERE IT IS POINTING, from the corner of your
             eye, without a lamp or a word. A rocker can only say on or off; this has four
             positions and wears them.
             It stays one control that cycles, so the input path, the V key and the hint animation
             are all untouched — what changed is that the thing on screen is now the thing a driver
             would reach for. -->
        <div class="cab-col cab-col-stalk">
          <button class="cab-stalk cab-wipe" aria-label="Wipers"
            title="Wiper stalk (W): off / intermittent / low / high">
            <i class="cab-stalk-mount"></i>
            <i class="cab-stalk-arm"><b>${svgIcon('wiper')}</b></i>
            <em class="cab-stalk-pos">OFF</em>
          </button>
        </div>

        <!-- ── THE SWITCH PANEL ────────────────────────────────────────────────
             The things that are switches on a real dash are switches here: a rocker rocks, a lamp
             above it lights, and the label is the state. Every one of them is still an ordinary
             <button> underneath, so tab, Space and a screen reader are unchanged. -->
        <div class="cab-col cab-col-switch">
          <div class="cab-rockers" role="group" aria-label="Dash switches">
            <!-- ── THE KEY ────────────────────────────────────────────────────
                 A truck you can't switch OFF is a truck that's always on, and every other
                 system in this cab is built around the engine being a thing with a state:
                 the lifters' wash says it's running, the stall says it stopped, the depot
                 lets you sit in it. The only thing missing was the driver's own decision.
                 It's a KEY BARREL rather than a rocker — the one control on the panel you
                 turn instead of press — and it routes through the same 'starter' input the
                 stall restart uses, so there's exactly one way an engine comes back to
                 life and both of them are it. -->
            <!-- ⚠ THE ONE CONTROL IN THE CAB THAT IS NOT A SWITCH, and it's worth the extra
                 markup. Everything on this panel is a rocker with a lamp, which is right for a
                 Jake or a set of wipers and wrong for the ignition: a key is the only thing here
                 you TURN, it's the first thing you touch and the last, and as a rocker it read as
                 one more toggle in a row of toggles. So it's a barrel with a blade in it, and it
                 rotates — OFF, ON, and held round to START against a spring, exactly like the
                 thing it's a picture of. Held isn't decoration either: the starter runs for as
                 long as you hold it (see startCrank), so a rig that doesn't catch first time is
                 cranked until it does, which is what the model's 'input.starter' always wanted and
                 the 900ms timer was standing in for. (⚠ SINGLE QUOTES: this comment is inside a
                 template literal, and a backtick here ends the string mid-sentence — see the
                 client:smoke note in CLAUDE.md, which exists because of exactly this file.) -->
            <div class="cab-key" role="group" aria-label="Ignition">
              <button class="cab-keybarrel" aria-label="Ignition key" aria-pressed="true" title="Ignition (K), turn and HOLD to crank. Off kills the engine; it only catches with the clutch in or the box in neutral."><s></s><b></b></button>
              <u><span>KEY</span></u>
            </div>

            <!-- THE JAKE is a rocker rather than a pedal, because that's what it's in the cab:
                 a switch on the dash you flick on for a descent. It's still HELD (see hold()). -->
            <button class="cab-btn cab-rocker cab-jake" aria-label="Jake brake" title="Jacobs engine brake (J), held. Holds you back on a descent so the service brakes stay cold."><i></i><u><span>JAKE</span></u></button>

            <!-- THE HORN. A VERB ('horn', plugins/trucking) rather than a local sound, because the
                 whole point of a horn is that the room hears it and you aren't the room. -->
            <button class="cab-btn cab-rocker cab-horn cab-touch" aria-label="Air horn" title="Air horn (H), the room hears it"><i></i><u><span>HORN</span></u></button>

            <!-- ── THE HEADLIGHTS ──────────────────────────────────────────────
                 A LATCHING rocker, and the reason it exists at all is that the lamps used to be
                 a lie the renderer told on the driver's behalf: 'landingLight' was hardcoded true
                 and the beam appeared whenever the renderer decided it was dark enough. That's a
                 sensible default and it isn't a control — there was no way to drive dark, no way
                 to forget your lights, and nothing on the panel that said whether they were on.

                 It DEFAULTS ON, because a rig runs lit and the old behaviour is the one nobody
                 should have to rediscover; switching them off is now a thing you chose. The state
                 rides the telemetry packet's lamp field (see the note on 'lamps' in the sync
                 below), so it costs no query, no column and no new route — and other drivers see
                 your actual lamps rather than an assumption about them. -->
            <button class="cab-btn cab-rocker cab-heads on" aria-label="Headlights" aria-pressed="true"
              title="Headlights (L): beam on the road ahead. Other drivers see them."><i></i><u><span>LAMPS</span></u></button>

            <!-- THE DOME LAMP. The other light switch, and the one that points inward: it lights
                 the CAB, not the road, and it's deliberately next to the headlights because a hand
                 reaching for one is usually deciding between the two.

                 It defaults ON, and switching it off is the interesting state rather than a
                 penalty: the panel lamps are a separate circuit on a truck and they stay lit, so a
                 dark cab is a cab where the only thing you can see is the instruments, glowing on a
                 board you can still just make out. That's what a night shift looks like from the
                 seat, and it's why the flood over the vinyl is wound DOWN rather than off (see
                 THE DOME LAMP in windshield.js). Purely local, like the headlights — but unlike
                 them it isn't on the telemetry packet, because nobody outside the cab can see it. -->
            <button class="cab-btn cab-rocker cab-dome on" aria-label="Cab light" aria-pressed="true"
              title="Cab light (I): the dome lamp over your head. Switched off, the panel still glows and the rest of the dash goes dark."><i></i><u><span>CAB</span></u></button>

            <!-- CRUISE. A LATCHING switch, not a held one, and the only rocker on this panel whose
                 label is a NUMBER when it's on: what a driver wants back off cruise control is
                 confirmation of the speed it took, and the lamp alone can't say that. -->
            <!-- HITCH. The one control in this cab that isn't always there: it appears when the fifth
                 wheel is actually under a pin and names the box it would take, and it's gone the
                 rest of the time. A permanently visible button that answers "not here" is a button
                 you learn to ignore; one that only exists when it'll work is an instrument.
                 ⚠ It's a HINT, never an authority — pressing it runs the ordinary 'hitch' verb,
                 which re-checks distance, angle and speed for itself.

                 IT IS NOT A ROCKER, because the thing a driver actually operates to take or drop a
                 box isn't a switch: it's the RED OCTAGONAL TRAILER AIR SUPPLY KNOB, the one
                 push-pull control on a truck dash that's shaped differently from everything around
                 it so a hand finds it without looking. Push it in and the trailer has air and is
                 yours; pull it out and the box stays where it is. So the knob's own state is the
                 rig's state, and the word stamped on it is what your hand does next — which is why
                 the legend reads PUSH and PULL rather than HITCH and DROP. -->
            <button class="cab-btn cab-hitchbtn" hidden aria-label="Trailer air supply" title="Back under the trailer and couple (hitch)"><i></i><b class="cab-knobface"><s></s><em>PUSH</em></b><u><span>TRAILER AIR</span></u></button>

            <button class="cab-btn cab-rocker cab-cruise" aria-pressed="false" aria-label="Cruise control" title="Cruise control (G), locks the speed you're doing. The brake, the clutch or dropping out of gear cancels it."><i></i><u><span>CRUISE</span></u></button>

            <!-- THE PARK BRAKE, and it's a KNOB because that's what it's on a truck: a big
                 yellow diamond you pull out and push in, next to the trailer's red one. It is
                 shaped like the trailer air valve above for exactly that reason — a hand finds
                 both of them without looking, and they're the same gesture. Spring brakes hold
                 the rig with no air and no engine, which is why this is the one control that still
                 does something with the key off. -->
            <button class="cab-btn cab-parkbtn" aria-pressed="false" aria-label="Park brake" title="Park brake (P), the spring brakes. Holds the rig with the engine off; it won't let you pull away. Pull it with the key off and the rig stopped and you climb down."><i></i><b class="cab-knobface cab-parkface"><s></s><em>PULL</em></b><u><span>PARK</span></u></button>

            <!-- EXIT CAB. Not a control on the truck — the door. It's disabled until the spring
                 brakes are set and the rig is stopped, so it's a legible sequence rather than a
                 rule you get told off by: the button lights when you have finished parking. It
                 sends the same 'park' verb the knob does, which is what closes this panel and hands
                 the room back. -->
            <button class="cab-btn cab-exitbtn" disabled aria-label="Exit cab" title="Exit cab, climb down. Set the park brake at a standstill first."><i></i><u><span>EXIT CAB</span></u></button>

            <!-- THE PUMP HANDLE. Hidden until the server says there's a pump under the nose — the
                 same 'a control appears because the world affords it' rule the trailer air valve
                 follows, and for the same reason: a dead button on the panel everywhere else in
                 the world is worse than no button.

                 IT IS HELD, and that's the entire design. A driver who wants twenty credits of
                 diesel because that's what they have takes it by letting go, which is what a
                 pump handle is FOR — the alternative was a dialog asking how much, and nobody has
                 ever wanted a form in a truck. The readout is the running total in credits, so the
                 number you're watching is the number you're about to pay; it stops climbing when
                 the tank is full or the money runs out, and the handle clicks off exactly there. -->
            <button class="cab-btn cab-pumpbtn" hidden aria-label="Fuel pump, hold to fill" title="Fuel, HOLD the handle. It fills while you hold it and charges you when you let go; it clicks off when the tank is full or you have spent what you have."><i></i><b class="cab-knobface cab-pumpface"><s></s><em class="cab-pumpread">FUEL</em></b><u><span>PUMP</span></u></button>

          </div>

          <!-- ── THE CAB'S OWN GROUP ──────────────────────────────────────────
               The radio, the door latches and the galley flap, on one line under the switches.
               The split is the honest one and it's worth keeping legible: the rockers above are
               the TRUCK — the key, the engine brake, the lamps, the valves — and this row is the
               CAB, the room you're sitting in. A radio is bolted to the roof of it, the doors are
               either side of you, and the food is behind the seat.
               ⚠ THE LATCH IS A STATE READOUT AS MUCH AS A SWITCH. The failure it exists to prevent
               is a driver who doesn't know the door beside them is open, so the word on the paddle
               says what the doors ARE and the tell-tale above it lights when they're shut — which
               is exactly what every other switch on this panel already does, and is the reason it
               reads as a control here and read as a caption up in the corner. -->
          <div class="cab-cabrow">
            <!-- THE CB. The set is a VIEW of server state (cb-radio.js) and decides nothing: the
                 dial sends 'cb <n>' and moves when the answer comes back, exactly as the hitch
                 button runs the real verb rather than reaching into the rig. -->
            ${cbRadioHTML()}
            <div class="cab-cabctl" role="group" aria-label="Cab">
              <button class="cab-btn cab-rocker cab-latchbtn" aria-pressed="false" aria-label="Cab doors unlocked" title="cab door latches (Y)"><i></i><u><span>OPEN</span></u></button>
              <!-- THE GALLEY FLAP. It's here at all because a haul is long, hunger and thirst run
                   for the whole of it, and the only surface that could answer "what have I got" was
                   the tablet — which meant stopping and leaving the glass. Every row it opens sends
                   the ordinary eat/drink verb; nothing is eaten by a path that only exists in a
                   cab. -->
              <button class="cab-btn cab-rocker cab-galleybtn" aria-label="Galley" title="what's in the cab to eat or drink (T)"><i></i><u><span>GALLEY</span></u></button>
            </div>
          </div>
          <!-- LOOKING OFF THE NOSE. The flight sim's Q/E/S, and deliberately the same three keys: a
               truck has exactly the same problem an aircraft does (you can't see behind you) and a
               player who has flown already has the habit. HELD, not toggled, for the reason a
               shoulder-check is held — you look, you come back. -->
          <div class="cab-look cab-touch" role="group" aria-label="Look">
            <button class="cab-btn cab-lookl" aria-label="Look left" title="Look left, hold (Q)"><b>${svgIcon('mirrorL')}</b><em>PORT</em></button>
            <button class="cab-btn cab-lookr" aria-label="Look right" title="Look right, hold (E)"><b>${svgIcon('mirrorR')}</b><em>STBD</em></button>
            <button class="cab-btn cab-lookb" aria-label="Look behind" title="Look behind, hold (S)"><b>${svgIcon('mirrorC')}</b><em>BACK</em></button>
          </div>
        </div>

        <!-- ── THE PEDALS ──────────────────────────────────────────────────────
             Three slabs on the floor in the order a truck has them — clutch, brake, throttle, left
             to right — raked away from you and pressing DOWN AND AWAY when you stand on them,
             which is the whole difference between a control you operate and a word in a box. They
             are still <button>s bound by the same hold() as before; nothing about the input path
             changed, only what the input path looks like. -->
        <div class="cab-pedals" role="group" aria-label="Pedals">
          <button class="cab-pedal cab-clutch" aria-label="Clutch"><span>CLU</span></button>
          <button class="cab-pedal cab-brake" aria-label="Brake"><span>BRK</span></button>
          <button class="cab-pedal cab-throttle" aria-label="Throttle"><span>ACC</span></button>
        </div>
      </div>
    </div>`;

  const sim = createTruckState(P);
  sim.x = ctx.x; sim.y = ctx.y; sim.heading = ctx.heading ?? 180;
  // A cold truck: the server says so on the wire (state.js mountRig); an older payload keeps it running.
  // ⚠ Left in neutral, because the model only cranks with the clutch in or the box out of gear.
  if (ctx.engineOn === false) { sim.stalled = true; sim.gear = 0; }

  st = {
    id, container, sim,
    input: { throttle: 0, brake: 0, steer: 0, clutch: 0, jake: 0, surface: ctx.surface || 'road' },
    steerKey: 0,
    autoClutch: autoCluPref(),   // manual mode works the clutch for you unless this is off
    autoDip: 0,
    knob: knobPref(),
    auto: autoPref(),   // automatic shifting: a hand on the lever, never a different gearbox
    shiftSeq: null,     // the beat of a shift in progress (autoShift)
    shiftCool: 0,
    map: ctx.map, mapX: ctx.mapX, mapY: ctx.mapY,
    s: ctx.s || 0, L: ctx.L || 1, node: ctx.node || 0, nodes: ctx.nodes || 1,
    hour: ctx.hour ?? 12, weather: ctx.weather || 'clear', moon: ctx.moon, wind: ctx.wind || 0, wipers: 0,
    // The spatial weather the sky is rendered from, the same values a cockpit gets.
    wxField: ctx.wxField || null, wxGround: ctx.wxGround || null, wxEvent: ctx.wxEvent || null,
    // 'grime' is the server's 0..1 (plugins/trucking/filth.js), cleared only by a hose; 'dust' is what
    // the wheels throw up right now.
    grime: ctx.grime || 0, dust: 0,
    // G-forces in the truck's frame: 'lat' positive right, 'lon' positive under acceleration.
    gee: { lat: 0, lon: 0 }, geeSpeed: 0,
    // 'wasRolling' is the telemetry edge detector; false because a cab opens stationary.
    last: performance.now(), lastSync: 0, wasRolling: false, lastAudio: 0, raf: 0, hitCd: 0, prev: null, contacts: ctx.contacts || [],
    // Seeded from the sim, or the first frame reads as a shift.
    lastGear: sim.gear, lastSplit: sim.split, rpmDip: 0, external: false, tier: P.tier,
    viewYaw: 0,                                  // degrees off the nose; 0 is through the windscreen
    // The peek: middle-button, -1..1 of the pane, sprung back to 0 on release.
    look: { x: 0, y: 0 }, looking: false,
    // Latched free look; see CAB_LOOK_YAW.
    freeLook: false,
    // The chase camera's orbit, the same three numbers cockpit.js keeps.
    extYaw: 0, extPitch: EXT_REST_PITCH, extZoom: 1,
    // Derived from the gear every frame (paintGate); this is only the start.
    range: false,
    fuel: 1,
  };

  // ── THE SHELF'S OWN HEIGHT ─────────────────────────────────────────────────
  // Overlays at the bottom of .cab-wrap sit above the shelf via --cab-shelf. ⚠ Measured with a
  // ResizeObserver, never guessed: the shelf wraps and its groups come and go with the world.
  const shelfEl = container.querySelector('.cab-controls');
  const wrapEl = container.querySelector('.cab-wrap');
  if (shelfEl && wrapEl && typeof ResizeObserver === 'function') {
    st.shelfRO = new ResizeObserver(() => {
      wrapEl.style.setProperty('--cab-shelf', Math.round(shelfEl.offsetHeight) + 'px');
    });
    st.shelfRO.observe(shelfEl);
    wrapEl.style.setProperty('--cab-shelf', Math.round(shelfEl.offsetHeight) + 'px');
  }

  // Headless: the widget keeps the angle, lock, self-centring and keyboard; the scene draws it
  // (drawCabWheel), and the glass hub hit-test fires onHorn.
  st.wheel = createHelmWheel(null, {
    accent: cabTrim(P.tier, TRIM).glow, mode: 'absolute', art: 'truck',
    // ⚠ keyRate is rad/s and doesn't scale with the lock: retune it with the travel or a held arrow
    // reaches the stops in a different time. handRate is a cap on a flick, deliberately unscaled.
    lock: TRUCK_LOCK_TURNS, selfCentre: 2.6, keyRate: 2.1, handRate: 14,
    // Speed-scaled self-centring, read live from the sim, the only owner of road speed.
    getSpeed: () => Math.abs(st?.sim?.speed || 0),
    onSteer: (axle) => { st.input.steer = axle; },
    onHorn: () => sendCmdSilent('horn'),
  });

  // Pedals are held: pointer, A/Z keys, and Space/Enter on a focused button (keydown to keyup).
  // ⚠ pointercancel releases too, or a browser-taken gesture leaves the throttle stuck on.
  const winOff = [];                                  // window-level releases, unwound in closeCab
  const isPress = (e) => e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter';
  // Pedal visuals are painted from 'st.input' by the frame loop, so every input path animates them.
  const CONTROL_PAINT = [['.cab-throttle', 'throttle'], ['.cab-brake', 'brake'],
    ['.cab-clutch', 'clutch'], ['.cab-jake', 'jake']];
  st.paintControls = () => {
    for (const [sel, key] of CONTROL_PAINT) {
      container.querySelector(sel)?.classList.toggle('on', (st.input[key] || 0) > 0);
    }
  };
  // ⚠ A held control belongs to the pointer that pressed it (setPointerCapture), so a second finger
  // can't release it. That's what lets a phone throttle and steer at once.
  const hold = (sel, key) => {
    const el = container.querySelector(sel);
    if (!el) return;
    let pid = null;
    const on = (e) => {
      pid = e.pointerId != null ? e.pointerId : 'kb';
      st.input[key] = 1; st.heldBy = st.heldBy || {}; st.heldBy[key] = 1; el.classList.add("on");
      if (e.pointerId != null) el.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };
    // ⚠ A pointer release may only end a press a pointer started, and only that one. A keyboard
    // press has pid null, and any page click used to drop the throttle. Key, blur and teardown pass no pointer.
    const off = (e) => {
      if (!st) return;
      if (e && e.pointerId != null) {
        if (pid === null || pid === 'kb') return;   // nothing pressed it with a pointer
        if (e.pointerId !== pid) return;            // somebody else's finger
      }
      pid = null; st.input[key] = 0; if (st.heldBy) st.heldBy[key] = 0; el.classList.remove("on");
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('keydown', (e) => { if (isPress(e) && !e.repeat) on(e); });
    el.addEventListener('keyup', (e) => { if (isPress(e)) off(); });
    el.addEventListener('blur', () => off());          // tabbed away mid-press; nothing else releases it
    addEventListener('pointerup', off);
    winOff.push(() => off());
  };
  hold('.cab-throttle', 'throttle');
  hold('.cab-brake', 'brake');
  hold('.cab-clutch', 'clutch');
  hold('.cab-jake', 'jake');
  // ── THE CLUTCH ALSO LATCHES ────────────
  // A tap holds it in until the next tap, so one mouse can shift. ⚠ It writes the same
  // 'st.input.clutch' and 'heldBy' as the pedal; a second flag would be a second clutch.
  {
    const el = container.querySelector('.cab-clutch');
    let downAt = 0;
    el?.addEventListener('pointerdown', () => { downAt = performance.now(); });
    // ⚠ On click, never pointerup: hold()'s window pointerup would wipe the latch right after.
    el?.addEventListener('click', () => {
      if (performance.now() - downAt > 260) return;
      const latch = !(st.clutchLatched);
      st.clutchLatched = latch;
      st.input.clutch = latch ? 1 : 0;
      st.heldBy = st.heldBy || {}; st.heldBy.clutch = latch ? 1 : 0;
      el.classList.toggle('latched', latch);
      st.paintControls?.();
    });
  }
  // Cruise is a latch, so a plain click.
  container.querySelector('.cab-cruise')?.addEventListener('click', () => toggleCruise());
  container.querySelector('.cab-auto')?.addEventListener('click', () => st.setAuto?.(!st.auto));
  container.querySelector('.cab-autoclu')?.addEventListener('click', () => st.setAutoClutch?.(!st.autoClutch));
  container.querySelector('.cab-revbtn')?.addEventListener('click', () => st.engageReverse?.());
  container.querySelector('.cab-parkbtn')?.addEventListener('click', () => st.setPark?.(!st.park));
  // The door is enabled only when parked and stopped; 'parkSent' stops it doubling with the knob.
  container.querySelector('.cab-exitbtn')?.addEventListener('click', () => {
    if (st.parkSent) return;
    st.parkSent = true;
    sendCmdSilent('park');
  });
  // The tablet is 900 KB, so it's fetched on the press.
  st.cbWidget = wireCbRadio(container, { openDeadhead: (key) => import('./tablet-os.js').then((m) => m.openTabletToChatTab(key)) });
  // The button runs the real verb; once coupled it unhitches.
  container.querySelector('.cab-hitchbtn')?.addEventListener('click', () => {
    sendCmdSilent(st.sim?.hitched ? 'unhitch' : 'hitch');
  });

  // ── THE PUMP HANDLE ─────────────────────────────────────────────────────────
  // Held, metered and committed on release; it writes money, so it isn't hold(). The needle rises
  // locally and the server corrects on the next push. ⚠ Two ceilings, 'room' (full tank) and
  // 'afford' (balance): the server re-checks both, but the readout mustn't promise what it refuses.
  const RATE = 0.10;                       // tank fraction per second
  {
    const el = container.querySelector('.cab-pumpbtn');
    const read = () => el?.querySelector('.cab-pumpread');
    let pid = null, t0 = 0, took = 0, timer = 0;
    const cap = () => {
      const room = Math.max(0, 1 - (st.fuel ?? 1));
      const afford = (st.pump?.credits || 0) / (st.pump?.full || 380);
      return Math.min(room, afford);
    };
    let flowAt = 0, flowSeed = 0, wasFull = false;
    const tick = () => {
      const lim = cap();
      took = Math.min(lim, ((performance.now() - t0) / 1000) * RATE);
      st.fuel = Math.min(1, (st.fuelAtPump ?? 0) + took);
      const cost = Math.round(took * (st.pump?.full || 380));
      const r = read();
      // CLICK means the pump stopped, tank full or money gone; it keeps showing the total.
      const full = took >= lim - 1e-6;
      if (r) r.textContent = full ? `CLICK ${cost}₵` : `${cost}₵`;
      el.classList.toggle('clicked', full);
      // Flow sound only while the handle is down and the pump hasn't clicked off; the click fires once.
      const now = performance.now();
      if (!full && now - flowAt >= PUMP_FLOW_MS) { flowAt = now; pumpFlowCue(4600 + (flowSeed++ % 23) * 7); }
      if (full && !wasFull) pumpEndCue('stop');
      wasFull = full;
      paintFuelGauge(st);
    };
    const on = (e) => {
      if (!el || el.hidden || !st.pump || timer) return;
      pid = e.pointerId != null ? e.pointerId : 'kb';
      if (e.pointerId != null) el.setPointerCapture?.(e.pointerId);
      t0 = performance.now(); took = 0; st.fuelAtPump = st.fuel ?? 1;
      st.pumping = true;
      flowAt = 0; wasFull = false;
      pumpEndCue('start');                       // the nozzle going into the filler
      el.classList.add('on');
      timer = setInterval(tick, 50);
      paintFuelGauge(st);
      e.preventDefault();
    };
    const off = (e) => {
      if (!st || !timer) return;
      if (e && e.pointerId != null && pid !== null && pid !== 'kb' && e.pointerId !== pid) return;
      clearInterval(timer); timer = 0; pid = null;
      st.pumping = false;
      // Not when the pump already clicked off: two clicks a tenth apart read as a fault.
      if (!wasFull && took >= 0.01) pumpEndCue('stop');
      el.classList.remove('on', 'clicked');
      const r = read(); if (r) r.textContent = 'FUEL';
      // A stab at the handle isn't a purchase.
      if (took >= 0.01) sendCmdSilent(`truckpump ${took.toFixed(3)}`);
      else st.fuel = st.fuelAtPump ?? st.fuel;
      took = 0;
      paintFuelGauge(st);
    };
    el?.addEventListener('pointerdown', on);
    el?.addEventListener('pointerup', off);
    el?.addEventListener('pointercancel', off);
    el?.addEventListener('keydown', (e) => { if (isPress(e) && !e.repeat) on(e); });
    el?.addEventListener('keyup', (e) => { if (isPress(e)) off(); });
    el?.addEventListener('blur', () => off());
    addEventListener('pointerup', off);
    // Closing mid-pour must commit what went in and not leave an interval running.
    winOff.push(() => off());
  }

  // Held steering buttons for touch. They drive the wheel widget's own setHeld.
  // ⚠ Same pointer discipline as hold(): X/C and the arrows write 'st.steerKey' directly.
  const steerHold = (sel, dir) => {
    const el = container.querySelector(sel);
    let pid = null;
    const on = (e) => { pid = e?.pointerId != null ? e.pointerId : 'kb'; st.steerKey = dir; st.wheel?.setHeld(dir); el.classList.add('on'); e.preventDefault(); };
    const off = (e) => {
      if (!st) return;
      if (e && e.pointerId != null && (pid === null || pid === 'kb' || e.pointerId !== pid)) return;
      pid = null;
      if (st.steerKey === dir) { st.steerKey = 0; st.wheel?.setHeld(0); } el.classList.remove('on');
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('keydown', (e) => { if (isPress(e) && !e.repeat) on(e); });
    el.addEventListener('keyup', (e) => { if (isPress(e)) off(); });
    el.addEventListener('blur', off);
    addEventListener('pointerup', off);
    winOff.push(off);
  };
  steerHold('.cab-left', -1);
  steerHold('.cab-right', 1);

  // The look buttons. 'viewYaw' is degrees off the nose, 0 forward (the renderer gates the interior on it).
  // ⚠ Same guard as hold(): a stray click mustn't snap a held shoulder check forward.
  const lookHold = (sel, yaw) => {
    const el = container.querySelector(sel);
    let pid = null;
    const on = (e) => { pid = e?.pointerId != null ? e.pointerId : 'kb'; st.viewYaw = yaw; el.classList.add('on'); showViewTag(yaw); e.preventDefault(); };
    const off = (e) => {
      if (!st) return;
      if (e && e.pointerId != null && (pid === null || pid === 'kb' || e.pointerId !== pid)) return;
      pid = null;
      if (st.viewYaw === yaw) { st.viewYaw = 0; showViewTag(0); } el.classList.remove('on');
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('keydown', (e) => { if (isPress(e) && !e.repeat) on(e); });
    el.addEventListener('keyup', (e) => { if (isPress(e)) off(); });
    el.addEventListener('blur', off);
    addEventListener('pointerup', off);
    winOff.push(off);
  };
  lookHold('.cab-lookl', -90);
  lookHold('.cab-lookr', 90);
  lookHold('.cab-lookb', 180);

  // Which way you're facing, said in the corner.
  function showViewTag(yaw) {
    const tag = container.querySelector('.ws-label');
    if (!tag) return;
    // Free look outranks the fixed looks: it can point anywhere, including where they do.
    tag.textContent = st.freeLook ? 'FREE LOOK'
      : yaw === -90 ? 'LEFT WINDOW' : yaw === 90 ? 'RIGHT WINDOW'
      : yaw === 180 ? 'OVER THE SHOULDER' : kitFor(P).label;
    tag.classList.toggle('ws-label-look', !!yaw || !!st.freeLook);
  }
  // The board as the shelf currently reads; rebuilt every frame from elements already in the DOM.
  st.ctlCells = () => {
    const out = { left: [], right: [] };
    for (const c of CAB_CTL) {
      const el = container.querySelector(c.sel);
      if (!el || el.hidden) continue;
      out[c.bank].push({
        ...c,
        label: el.dataset.dash || c.label,
        on: el.classList.contains('on') || el.getAttribute('aria-pressed') === 'true',
        enabled: !el.disabled,
      });
    }
    return out;
  };
  // ⚠ A press is the button's own click, so the power check, sound, verb and persistence stay in one handler.
  st.pressCtl = (key) => {
    // On touch the automatic drives (setAuto), so a painted gearbox switch does nothing.
    if (cabTouch() && TOUCH_AUTO_CTL.has(key)) return false;
    const row = CAB_CTL.find((c) => c.key === key);
    const el = row && container.querySelector(row.sel);
    if (!el || el.hidden || el.disabled) return false;
    el.click();
    return true;
  };
  st.showViewTag = showViewTag;
  st.winOff = winOff;                                 // released in closeCab

  // ── STEERING FROM THE GLASS, AND WALKING ROUND THE RIG ─────────────────────
  // One drag surface: in the cab a horizontal drag winds the wheel; in the external view it orbits.
  const glass = container.querySelector('.ws-wrap');
  // The free camera's mouse; inert until the camera is off its mount.
  // A phone gets a camera button on the glass that presses O, shown where O would work.
  st.freeCamUnbind = bindFreeCamPointer(glass, freeCam, { toggleKey: 'o', canToggle: () => !!st?.external });
  // Listens on the window, so it must not outlive the cab.
  freeIdle = bindFreeCamIdle(freeCam);
  {
    let drag = null;
    const isChrome = (e) => !!e.target?.closest?.('.cab-chrome,.cab-dmg,.cab-help');
    // The switch under the pointer, from the last frame's projected hotspots (canvas CSS pixels).
    const hotAt = (e) => {
      const hs = st && st.hot;
      if (!hs || !hs.list?.length || isChrome(e)) return null;
      const cv = document.getElementById(st.id);
      const b = cv?.getBoundingClientRect();
      if (!b || !b.width || !b.height) return null;
      const x = (e.clientX - b.left) * ((hs.W || b.width) / b.width), y = (e.clientY - b.top) * ((hs.H || b.height) / b.height);
      let best = null, bd = Infinity;
      for (const h of hs.list) { const d = Math.hypot(x - h.x, y - h.y); if (d <= h.r * 1.2 && d < bd) { bd = d; best = h; } }
      return best;
    };
    glass.addEventListener('pointerdown', (e) => {
      grabSeatKeys();                                     // clicking the road is asking to drive (seat-keys.js)
      // Middle button: in the seat it toggles latched free look (one press takes hold, the next
      // straightens up); behind the truck it's an orbit alias. ⚠ Gate it on the view: in the cab a
      // middle drag must never reach the wheel. Free look has no key: every letter is bound.
      if (e.button === 1 && !st.external) {
        if (st.freeLook) {
          st.freeLook = false; st.look.x = 0; st.look.y = 0; st.looking = false;
          st.showViewTag?.(0);
          e.preventDefault(); return;
        }
        st.freeLook = true; st.viewYaw = 0; st.showViewTag?.(0);
        st.looking = true;
        peekFrom(e);
        glass.setPointerCapture?.(e.pointerId);
        e.preventDefault(); return;
      }
      // The 3-D cab's fascia switches (truckHotspots in interior-fit.js), taken before the steering drag.
      if (e.button === 0 && !st.external) {
        const h = hotAt(e);
        if (h) { st.pressCtl?.(h.id); e.preventDefault(); return; }
      }
      const orbitBtn = e.button === 1 && st.external;
      if (isChrome(e) || (e.button > 0 && !orbitBtn)) return;
      // The horn boss, tested against the renderer's own geometry (cabWheelHub). Measure the canvas
      // the wheel is drawn on (cabDashCanvas), not the world's, or the horn lands above the wheel.
      const cv = cabDashCanvas(st.id) || document.getElementById(st.id);
      if (!st.external && cv) {
        const b = cv.getBoundingClientRect();
        const hub = cabWheelHub(b.width, b.height);
        const wx = e.clientX - b.left - hub.x, wy = e.clientY - b.top - hub.y;
        const wr = Math.hypot(wx, wy);
        if (wr < hub.r) {
          // The horn holds; its release is on the window because a hand can drag off the hub.
          st.hornDown?.();
          const up = () => { st.hornUp?.(); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
          window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
          e.preventDefault(); return;
        }
        // Anywhere on the wheel's disc out to the rim is a grab that follows the hand round. The
        // drag-anywhere control below stays for speed and big windows.
        const wg = cabWheelGeom(b.width, b.height);
        if (wr < wg.R * 1.04) {
          drag = { x: e.clientX, y: e.clientY, id: e.pointerId, wheel: true, a: Math.atan2(wy, wx) };
          st.wheel?.setDragging(true);
          glass.setPointerCapture?.(e.pointerId);
          glass.classList.add('cab-glass-drag');
          e.preventDefault(); return;
        }
        // The GPS, against the rectangle the renderer drew. A pane too narrow for a screen reports none.
        const gr = cabGpsRect();
        if (gr && e.clientX - b.left >= gr.x && e.clientX - b.left <= gr.x + gr.w
          && e.clientY - b.top >= gr.y && e.clientY - b.top <= gr.y + gr.h) {
          st.toggleRoutePicker?.(); e.preventDefault(); return;
        }
        // The painted console. ⚠ Rects come from the drawer (cabControlRects), never a second layout.
        // ⚠ Every press ends at the shelf button's own click (pressCtl); nothing is decided here.
        const cr = cabControlRects();
        if (cr) {
          const px = e.clientX - b.left, py = e.clientY - b.top;
          const inR = (q) => q && px >= q.x && px <= q.x + q.w && py >= q.y && py <= q.y + q.h;
          // ⚠ A press on the gate opens the gearshift window (openShiftWin) rather than snapping a gear,
          // since a stray click on the small plate used to shift. Not on touch, where the automatic drives.
          if (inR(cr.gate) && st.openShiftWin && !cabTouch()) {
            st.openShiftWin(e.clientX, e.clientY);
            e.preventDefault(); return;
          }
          for (const k of Object.keys(cr)) {
            if (k === 'gate' || !inR(cr[k])) continue;
            st.pressCtl?.(k);
            e.preventDefault(); return;
          }
        }
      }
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      if (!st.external) st.wheel?.setDragging(true);
      glass.setPointerCapture?.(e.pointerId);
      glass.classList.add('cab-glass-drag');
      e.preventDefault();
    });
    // Where the cursor is, as a fraction of the pane either side of its middle.
    function peekFrom(e) {
      const cv = cabDashCanvas(st.id) || document.getElementById(st.id);
      const b = cv?.getBoundingClientRect(); if (!b || !b.width) return;
      st.look.x = Math.max(-1, Math.min(1, ((e.clientX - b.left) / b.width - 0.5) * 2));
      st.look.y = Math.max(-1, Math.min(1, ((e.clientY - b.top) / b.height - 0.5) * 2));
    }
    const endPeek = () => { if (st) st.looking = false; };
    window.addEventListener('pointerup', endPeek);
    window.addEventListener('pointercancel', endPeek);
    glass.addEventListener('pointermove', (e) => {
      if (st && st.looking) { peekFrom(e); e.preventDefault(); return; }
      if (!drag && st) glass.classList.toggle('cab-glass-hot', !!hotAt(e));
      if (!drag || !st) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.wheel) {
        // 1:1 with the hand, unwrapped at the ±π cut so crossing the bottom doesn't snap to the other stop.
        const cv2 = cabDashCanvas(st.id) || document.getElementById(st.id);
        const b2 = cv2?.getBoundingClientRect(); if (!b2) return;
        const hub2 = cabWheelHub(b2.width, b2.height);
        const a = Math.atan2(e.clientY - b2.top - hub2.y, e.clientX - b2.left - hub2.x);
        let da = a - drag.a;
        if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
        drag.a = a;
        st.wheel?.wind(da);
        return;
      }
      // ⚠ In the external view the drag is always the orbit, even dollied right in.
      if (st.external) {
        // The pitch top stops short of the pole (a near-vertical orbit stretches the model).
        st.extYaw = (st.extYaw + dx * 0.30 + 360) % 360;
        // The floor is the renderer's: paintWindshield clamps to 'groundPitch'.
        st.extPitch = Math.max(-0.30, Math.min(1.12, st.extPitch - dy * 0.006));
      } else {
        // Screen-width-relative, and the gain is the lock: one screen width is one full lock at any
        // TRUCK_LOCK_TURNS, so retuning the travel can't leave the gesture behind.
        st.wheel?.wind(dx / Math.max(240, glass.clientWidth) * TRUCK_LOCK_RAD);
      }
    });
    const endDrag = () => {
      if (!drag) return;
      drag = null;
      st?.wheel?.setDragging(false);                  // the axle walks back to centre
      glass.classList.remove('cab-glass-drag');
    };
    glass.addEventListener('pointerup', endDrag);
    glass.addEventListener('pointercancel', endDrag);
    addEventListener('pointerup', endDrag);
    winOff.push(endDrag);
    // No middle-click autoscroll over the windscreen. ⚠ Chrome arms it on pointerdown, so auxclick
    // alone is too late; pointerdown prevents it for the orbit, and these are the backstop.
    glass.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
    glass.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    // The dolly, external only.
    glass.addEventListener('wheel', (e) => {
      if (!st?.external) return;
      // In as far as the renderer's standoff (lastViewState), where the rig fills the frame; the cab
      // hands over 1.15 x this, hence the division.
      const lv = lastViewState(), lo = lv && lv.external && lv.chaseZoomFloor > 0 ? lv.chaseZoomFloor / 1.15 : 0.13;
      st.extZoom = Math.max(lo, Math.min(2.8, st.extZoom * (e.deltaY > 0 ? 1.1 : 0.9)));
      e.preventDefault();
    }, { passive: false });
    // The same dolly under two fingers; one finger already orbits.
    bindTouchGestures(glass, {
      enabled: () => !!st?.external && !freeCam.active,
      pinch: (f) => {
        const lv = lastViewState(), lo = lv && lv.external && lv.chaseZoomFloor > 0 ? lv.chaseZoomFloor / 1.15 : 0.13;
        st.extZoom = Math.max(lo, Math.min(2.8, st.extZoom / f));
      },
    });
  }

  // ── WHO HAS THE KEYBOARD ───────────────────────────────────────────────────
  // The cab takes the keyboard on mount and on any press in the pane, and says so on the glass;
  // clicking the command bar hands it back. Shared with the other seats in seat-keys.js; the chip is the cab's own.
  st.cabWrap = container.querySelector('.cab-wrap');
  claimSeatKeyboard(st.cabWrap, { label: 'CAB', tag: container.querySelector('.cab-focustag') });
  touchWipers(st);   // before the paint: st.paintWipers isn't assigned yet this early in the mount
  paintWipers();

  // ── THE GATE ───────────────────────────────────────────────────────────────
  const GATE = CAB_GATE;
  const gearOfSlot = (s) => (s.gear != null ? s.gear : s.slot + (st.range ? 4 : 0));
  // Where the knob rests: the slot the box is actually in.
  const slotOfGear = (g) => GATE.find((s) => gearOfSlot(s) === g) || null;
  {
    const gate = container.querySelector('.cab-gate');
    const lever = container.querySelector('.cab-lever');
    const rangeBtn = container.querySelector('.cab-range');
    let drag = null;
    // The knob sits a fixed stick-length above the slot the rod passes through; a drag corrects by
    // this offset, since the hand is on the knob. ⚠ The CSS reads its length from '--cab-stick', set here.
    const STICK_PX = 34, LEAN_DEG = -7;
    const KNOB_DX = Math.sin(LEAN_DEG * Math.PI / 180) * STICK_PX;
    const KNOB_DY = -Math.cos(LEAN_DEG * Math.PI / 180) * STICK_PX;
    gate.style.setProperty('--cab-stick', STICK_PX + 'px');
    const put = (x, y) => {
      lever.style.setProperty('--gx', x.toFixed(3));
      lever.style.setProperty('--gy', y.toFixed(3));
      // ⚠ Published here rather than in glide, so a drag on the shelf lever moves the painted one too.
      st.gatePos = { x, y };
    };
    // What the painted gate gets: the slot table in 0..1, labelled for the range, and the knob position.
    // The renderer derives its rails from the points.
    st.gateView = () => ({
      pts: GATE.map((g) => ({ x: g.x, y: g.y, label: g.label || String(gearOfSlot(g)) })),
      at: st.gatePos || { x: 0.38, y: 0.50 },
      range: !!st.range,
      knob: st.knob || 'ball',
    });
    // ── THE LEVER MOVES, IT DOESN'T TELEPORT ─────────────────────────────────
    // The knob eases toward its slot so the automatic can be watched. ⚠ Never while a hand is on it
    // (a frame of lag under the pointer shows), and it snaps on the first paint.
    let at = null, lastPut = 0;
    const GLIDE_SPEED = 6.5;   // gate fractions a second: crossgate ~0.1 s, a whole H ~0.25 s
    const glide = (x, y) => {
      const now = performance.now();
      const dt = at ? Math.min(0.1, (now - lastPut) / 1000) : 0;
      lastPut = now;
      if (!at) { at = { x, y }; put(x, y); return; }
      // Along the rails at constant speed, never a straight line across the plate.
      let step = GLIDE_SPEED * dt;
      const route = Math.abs(at.x - x) < 0.004 ? [[x, y]] : [[at.x, 0.5], [x, 0.5], [x, y]];
      for (const [wx, wy] of route) {
        const dx = wx - at.x, dy = wy - at.y, d = Math.hypot(dx, dy);
        if (d <= step) { at.x = wx; at.y = wy; step -= d; continue; }
        at.x += (dx / d) * step; at.y += (dy / d) * step;
        break;
      }
      put(at.x, at.y);
    };
    // A drag has the knob under the pointer; when it ends, the ease resumes from where it was left.
    const dropGlide = (x, y) => { at = { x, y }; lastPut = performance.now(); };
    // Rest the knob wherever the box is, every frame, so a shift from any source moves the lever.
    // Slot labels follow the range every frame.
    const slots = [...container.querySelectorAll('.cab-slot')];
    const paintSlots = () => {
      for (const el of slots) {
        const g = GATE[+el.dataset.gi];
        if (!g) continue;
        const gear = gearOfSlot(g);
        const label = g.label || String(gear);
        el.textContent = label;
        el.setAttribute('aria-label', gear > 0 ? `Gear ${gear}` : gear < 0 ? 'Reverse' : 'Neutral');
        el.classList.toggle('on', st.sim.gear === gear);
      }
    };
    st.paintGate = () => {
      paintSlots();
      if (drag) return;
      // ⚠ The range is derived from the gear, never stored separately: the sequential keys know nothing of the gate.
      if (st.sim.gear > 0 && st.range !== st.sim.gear > 4) { st.range = st.sim.gear > 4; syncRange(); }
      const s = slotOfGear(st.sim.gear);
      // A gear with no slot belongs to the other range: the knob goes to neutral.
      glide(s ? s.x : 0.38, s ? s.y : 0.50);
      gate.classList.toggle('cab-gate-off', !s && st.sim.gear !== 0);
    };
    // Nearest legal slot, never wherever you let go.
    const snap = (px, py) => {
      let best = null, bd = Infinity;
      for (const s of GATE) {
        const d = (s.x - px) ** 2 + ((s.y - py) * 0.8) ** 2;
        if (d < bd) { bd = d; best = s; }
      }
      return best;
    };
    // ── THE LEVER CAN'T LEAVE THE SLOTS ──────────────────────────────────────
    // The pointer is projected onto the milled channels every frame: the same rails the plate draws.
    const CHANNELS = [
      [0.24, 0.15, 0.24, 0.85],   // left rail: 1 over 2
      [0.52, 0.15, 0.52, 0.85],   // right rail: 3 over 4
      [0.80, 0.50, 0.80, 0.85],   // reverse's dogleg, off the crossgate
      [0.24, 0.50, 0.80, 0.50],   // the crossgate everything passes through
    ];
    // Nearest point on the network. ⚠ The snap's aspect squash isn't applied: this is a screen
    // position, and squashing would slide the knob off the rail.
    const onChannel = (px, py) => {
      let bx = px, by = py, bd = Infinity;
      for (const [x0, y0, x1, y1] of CHANNELS) {
        const vx = x1 - x0, vy = y1 - y0;
        const t = Math.max(0, Math.min(1, ((px - x0) * vx + (py - y0) * vy) / (vx * vx + vy * vy || 1)));
        const cx = x0 + vx * t, cy = y0 + vy * t;
        const d = (cx - px) ** 2 + (cy - py) ** 2;
        if (d < bd) { bd = d; bx = cx; by = cy; }
      }
      return [bx, by];
    };
    lever.addEventListener('pointerdown', (e) => {
      drag = { id: e.pointerId };
      lever.setPointerCapture?.(e.pointerId);
      lever.classList.add('on');
      // Taking the lever doesn't dip the clutch; a tap on the pedal latches it instead.
      e.preventDefault(); e.stopPropagation();
    });
    const move = (e) => {
      if (!drag || !st) return;
      const b = gate.getBoundingClientRect();
      if (!b.width) return;
      // The hand is on the knob; position the slot below it (KNOB_DX/KNOB_DY).
      const fx = (e.clientX - b.left - KNOB_DX) / b.width;
      const fy = (e.clientY - b.top - KNOB_DY) / b.height;
      const [px, py] = onChannel(fx, fy);
      put(px, py);            // ⚠ not glide: the knob is under the pointer
      dropGlide(px, py);      // ...and the ease picks up from here on release
      const s = snap(px, py);
      gate.dataset.aim = s ? String(gearLabelOf(gearOfSlot(s))) : '';
    };
    const drop = (e) => {
      if (!drag || !st) { drag = null; return; }
      const b = gate.getBoundingClientRect();
      const fx = b.width ? ((e?.clientX ?? 0) - b.left - KNOB_DX) / b.width : 0.38;
      const fy = b.height ? ((e?.clientY ?? 0) - b.top - KNOB_DY) / b.height : 0.50;
      const [px, py] = onChannel(fx, fy);
      const s = snap(px, py);
      drag = null;
      lever.classList.remove('on');
      gate.dataset.aim = '';
      if (s) selectGear(gearOfSlot(s));
      st.paintGate?.();
    };
    lever.addEventListener('pointermove', move);
    lever.addEventListener('pointerup', drop);
    lever.addEventListener('pointercancel', drop);
    // Clicking a slot is the same act as dragging to it.
    gate.addEventListener('click', (e) => {
      if (e.target === lever || lever.contains(e.target)) return;
      const b = gate.getBoundingClientRect();
      if (!b.width) return;
      const s = snap((e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height);
      if (s) { selectGear(gearOfSlot(s)); st.paintGate?.(); }
    });
    // The painted gate's press, in the plate's 0..1 space as resolved against the renderer's rect.
    st.gateSnapAt = (fx, fy) => {
      const g = snap(fx, fy);
      if (g) { selectGear(gearOfSlot(g)); st.paintGate?.(); }
    };
    // ── THE GEARSHIFT WINDOW ──────────────────────────────────────────────────
    // ⚠ It holds the shelf's own gate element, moved, never a copy, so there's still one gearbox;
    // closing puts it back where the screen reader and touch layout expect it.
    const gateCol = container.querySelector('.cab-col-gate');
    const gateHome = gateCol?.parentNode, gateNext = gateCol?.nextSibling;
    let shiftWin = null;
    const closeShiftWin = () => {
      if (!shiftWin) return;
      if (gateHome && gateCol) gateHome.insertBefore(gateCol, gateNext && gateNext.parentNode === gateHome ? gateNext : null);
      shiftWin.remove(); shiftWin = null;
    };
    st.openShiftWin = (cx, cy) => {
      if (shiftWin) { closeShiftWin(); return; }
      if (!gateCol) return;
      shiftWin = document.createElement('div');
      shiftWin.className = 'cab-shiftwin';
      shiftWin.setAttribute('role', 'dialog');
      shiftWin.setAttribute('aria-label', 'Gearshift');
      shiftWin.innerHTML = `<div class="cab-shiftwin-bar"><span>GEARSHIFT</span><button class="cab-shiftwin-x" aria-label="Close gearshift" title="Close">✕</button></div>`;
      shiftWin.appendChild(gateCol);
      const pick = document.createElement('label');
      pick.className = 'cab-shiftwin-knob';
      pick.innerHTML = `<span>KNOB</span><select aria-label="Shift knob">${SHIFT_KNOBS.map(([id, name]) => `<option value="${id}"${id === st.knob ? ' selected' : ''}>${name}</option>`).join('')}</select>`;
      pick.querySelector('select').addEventListener('change', (e) => {
        st.knob = e.target.value;
        try { localStorage.setItem(KNOB_KEY, st.knob); } catch {}
      });
      shiftWin.appendChild(pick);
      document.body.appendChild(shiftWin);
      shiftWin.querySelector('.cab-shiftwin-x').addEventListener('click', (e) => { closeShiftWin(); e.stopPropagation(); });
      makeDraggable(shiftWin, shiftWin.querySelector('.cab-shiftwin-bar'));
      // Beside where you clicked, kept on screen.
      const w = shiftWin.offsetWidth, h = shiftWin.offsetHeight;
      const x = cx != null ? cx - w / 2 : (innerWidth - w) / 2;
      const y = cy != null ? cy - h - 16 : innerHeight - h - 24;
      shiftWin.style.left = Math.max(4, Math.min(innerWidth - w - 4, x)) + 'px';
      shiftWin.style.top = Math.max(4, Math.min(innerHeight - h - 4, y)) + 'px';
      // The keyboard stays the cab's: a press in here is on buttons, never a text field.
      shiftWin.addEventListener('pointerdown', () => grabSeatKeys?.());
      st.paintGate?.();
    };
    st.closeShiftWin = closeShiftWin;
    winOff.push(closeShiftWin);
    for (const el of slots) {
      el.addEventListener('click', (e) => {
        const g = GATE[+el.dataset.gi];
        if (g) { selectGear(gearOfSlot(g)); st.paintGate?.(); }
        e.preventDefault(); e.stopPropagation();
      });
    }
    rangeBtn.addEventListener('click', (e) => {
      // The range moves the gear with it (same slot, four ratios up or down).
      // ⚠ Ask which slot you're in before flipping: slotOfGear reads 'st.range'.
      const cur = slotOfGear(st.sim.gear);
      st.range = !st.range;
      const rl = rangeBtn.querySelector('b'); if (rl) rl.textContent = st.range ? 'HI' : 'LO';
      rangeBtn.classList.toggle('on', st.range);
      if (st.sim.gear > 0 && cur && cur.slot != null) selectGear(cur.slot + (st.range ? 4 : 0));
      st.paintGate?.();
      e.preventDefault();
    });
    winOff.push(() => { drag = null; });
  }
  // ── THE CLUTCH ISN'T OPTIONAL ─────────────────────────
  // The box isn't synchronised: with the clutch out a shift is refused and grinds into neutral.
  // Pulling into neutral, or shifting from neutral, never grinds.
  const clutchIn = () => (st.input.clutch || 0) > 0.5;
  // What a ±1 sequential move would land on, the same clamp truckShift applies.
  const gearWithin = (g) => Math.max(-1, Math.min(P.gears.length - 1, g | 0));
  function grind(target) {
    truckSelectGear(st.sim, P, 0);
    grindCue();
    // The server decides what a fluffed shift costs; this only rate-limits the sending.
    const now = performance.now();
    if (!st.lastGrindSent || now - st.lastGrindSent > 900) {
      st.lastGrindSent = now;
      sendCmdSilent('truckevent grind');
    }
    const gate = container.querySelector('.cab-gate');
    if (gate) {
      // 'void offsetWidth' restarts the animation on a grind inside the last one.
      gate.classList.remove('grind'); void gate.offsetWidth; gate.classList.add('grind');
      // The CLUTCH tell shows the first few times only.
      if ((st.grinds = (st.grinds || 0) + 1) <= 3) {
        gate.dataset.tell = 'CLUTCH';
        clearTimeout(st.grindTell);
        st.grindTell = setTimeout(() => { if (gate.dataset) gate.dataset.tell = ''; }, 1800);
      }
      setTimeout(() => gate.classList.remove('grind'), 420);
    }
    st.paintGate?.();
    return true;
  }
  // Every gear change in the cab funnels through this.
  function shiftGate(target) {
    if (target === st.sim.gear) return false;                      // not a shift
    if (target === 0 || st.sim.gear === 0) return false;           // out of gear / already out: free
    if (clutchIn()) return false;
    // Automatic clutch: in now, so this step's gear lands disengaged (autoClutchStep lifts it).
    if (st.autoClutch) { st.input.clutch = 1; st.autoDip = 0.3; return false; }
    grind(target);
    return true;                                                    // handled: don't put it in gear
  }
  st.shiftGate = shiftGate;

  // One door for choosing a gear, so the reverse rule is written once.
  function selectGear(g) {
    if (g < 0) { toggleReverse(); return; }
    if (st.sim.gear < 0 && Math.abs(st.sim.speed) >= 2) return;   // rolling backwards
    if (shiftGate(g)) return;
    truckSelectGear(st.sim, P, g);
    // Keep the gate's range in step with the box.
    if (g > 0) st.range = g > 4;
    syncRange();
  }
  st.selectGear = selectGear;
  function syncRange() {
    const rb = container.querySelector('.cab-range');
    if (!rb) return;
    const rl = rb.querySelector('b'); if (rl) rl.textContent = st.range ? 'HI' : 'LO';
    rb.classList.toggle('on', !!st.range);
  }
  const gearLabelOf = (g) => (g < 0 ? 'R' : g === 0 ? 'N' : String(g));

  // 'tap' fires once per press: a shift is an edge.
  const tap = (sel, fn) => {
    const el = container.querySelector(sel);
    el.addEventListener('click', (e) => { fn(); e.preventDefault(); });
  };
  // The key barrel is a hold, wired like the pedals, with every release path covered.
  {
    const barrel = container.querySelector('.cab-keybarrel');
    if (barrel) {
      const press = (e) => {
        e.preventDefault();
        barrel.setPointerCapture?.(e.pointerId);
        if (!st.sim.stalled) ignitionOff(); else startCrank();
      };
      const release = () => stopCrank();
      barrel.addEventListener('pointerdown', press);
      barrel.addEventListener('pointerup', release);
      barrel.addEventListener('pointercancel', release);
      barrel.addEventListener('pointerleave', release);
      // Space/Enter fire click with no hold, so one press toggles.
      barrel.addEventListener('click', (e) => { if (e.detail === 0) toggleIgnition(); });
    }
  }
  tap('.cab-splitbtn', () => splitGear());
  tap('.cab-wipe', () => cycleWipers());
  // Headlights: local state the telemetry carries out; repainted at once.
  tap('.cab-heads', () => setHeads(!st.heads));
  tap('.cab-dome', () => setDome(!st.dome));
  // ── THE HORN SOUNDS FOR AS LONG AS YOU PULL IT ─────────────────────────────
  // ⚠ Your own horn never waits for the server: the voice is local, and the verb goes once on
  // release with how long it was held.
  function hornDown() {
    if (st.hornAt) return;                       // already open
    st.hornAt = performance.now();
    airHornOn(TYPE_ID, HORN);
  }
  function hornUp() {
    if (!st.hornAt) return;
    const secs = Math.min(4, (performance.now() - st.hornAt) / 1000);
    st.hornAt = 0;
    airHornOff();
    // The server clamps the duration again.
    sendCmdSilent(`horn ${Math.max(0.15, secs).toFixed(2)}`);
  }
  st.hornDown = hornDown; st.hornUp = hornUp;
  {
    const hb = container.querySelector('.cab-horn');
    if (hb) {
      hb.addEventListener('pointerdown', (e) => { e.preventDefault(); hb.setPointerCapture?.(e.pointerId); hornDown(); });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) hb.addEventListener(ev, hornUp);
      // Keyboard activation has no hold to read: a short toot.
      hb.addEventListener('click', (e) => { if (e.detail === 0) { hornDown(); setTimeout(hornUp, 350); } });
    }
  }

  // ── WHICH DRIVE KEYS ARE PHYSICALLY DOWN ────────────────────────────────────
  // A record of the keyboard only, so a missed keyup (command box, Alt-Tab, the free camera) can still
  // release a held control. ⚠ Each entry undoes exactly what its key's branch in onKey does, guarded
  // the same way, so running it twice is a no-op. Pointer holds aren't in here.
  const HOLD_KEYS = new Map([
    ['a', () => { st.input.throttle = 0; if (st.heldBy) st.heldBy.throttle = 0; }],
    ['z', () => { st.input.brake = 0; if (st.heldBy) st.heldBy.brake = 0; }],
    [' ', () => { st.input.clutch = 0; if (st.heldBy) st.heldBy.clutch = 0; }],
    ['j', () => { st.input.jake = 0; if (st.heldBy) st.heldBy.jake = 0; }],
    ['x', () => { if (st.steerKey === -1) { st.steerKey = 0; st.wheel?.setHeld(0); } }],
    ['arrowleft', () => { if (st.steerKey === -1) { st.steerKey = 0; st.wheel?.setHeld(0); } }],
    ['c', () => { if (st.steerKey === 1) { st.steerKey = 0; st.wheel?.setHeld(0); } }],
    ['arrowright', () => { if (st.steerKey === 1) { st.steerKey = 0; st.wheel?.setHeld(0); } }],
    ['q', () => { if (st.viewYaw === -90) { st.viewYaw = 0; st.showViewTag?.(0); } }],
    ['e', () => { if (st.viewYaw === 90) { st.viewYaw = 0; st.showViewTag?.(0); } }],
    ['s', () => { if (st.viewYaw === 180) { st.viewYaw = 0; st.showViewTag?.(0); } }],
    ['h', () => st.hornUp?.()],   // a blast that never ends
  ]);
  const typingNow = (el) => /^(INPUT|TEXTAREA)$/.test(el?.tagName || '') || !!el?.isContentEditable;
  st.keysDown = new Set();
  function releaseHeldKey(k) {
    if (!st || !st.keysDown.delete(k)) return;
    HOLD_KEYS.get(k)?.();
  }
  // Everything at once: the window losing focus, or the tab hidden.
  function releaseAllHeldKeys() {
    if (!st) return;
    for (const k of [...st.keysDown]) releaseHeldKey(k);
  }
  // ⚠ After Alt-Tab the keyup goes elsewhere. Both hooks, since blur and visibilitychange each happen alone.
  st.onWinBlur = releaseAllHeldKeys;
  st.onVisibility = () => { if (document.hidden) releaseAllHeldKeys(); };
  addEventListener('blur', st.onWinBlur);
  document.addEventListener('visibilitychange', st.onVisibility);

  st.onKey = (e) => {
    const k = e.key.toLowerCase();
    const down = e.type === 'keydown';
    // ⚠ The record is settled before the typing guard: a press counts only while the cab has the
    // keyboard, a release always counts, or a pedal stays pinned after clicking into the command box.
    if (down) { if (!typingNow(e.target) && HOLD_KEYS.has(k)) st.keysDown.add(k); }
    else releaseHeldKey(k);
    if (typingNow(e.target)) {
      // ⚠ The camera's keys too: a dropped W release would fly the camera on unsteered.
      if (!down) freeCam.onKey(k, false);
      return;
    }
    // ── THE CAMERA OFF ITS MOUNT ────────────────────────────────────────────
    // O (free on every windshield panel). Entering holds the truck: cruise at its speed, wheel centred.
    // ⚠ The external view is needed to enter, never to leave, or a driver who clicks back to the
    // cab is stuck with a camera that swallows every key.
    if (k === 'o' && down && !e.repeat && (st.external || freeCam.active)) {
      if (freeCam.active) exitFreeCam();
      else {
        freeCam.open({ yaw: (st.sim.heading || 0) + (st.extYaw || 0), z: 0.5 });
        st.freeHold = { cruise: st.cruise };
        if (st.sim.speed >= 5.5 && !st.dry && !st.broken && st.sim.gear > 0) setCruise(st.sim.speed);
        st.input.steer = 0; st.input.throttle = 0; st.input.brake = 0;
        paintFreeCamChrome();
      }
      return;
    }
    // ── THE MARKS OFF THE GLASS ─────────────────────────────────────────────
    // Before the camera's key claim on purpose: the switch is for the seat you'll come back to.
    // N was the last free letter (see POINTER_KEY in freecam.js).
    if (k === 'n' && down && !e.repeat) { e.preventDefault(); markSwitchTold(navMarks()); return; }
    // While detached the camera owns its keys. ⚠ It eats the event, or the arrows scroll the page.
    if (freeCam.onKey(k, down)) { e.preventDefault(); return; }
    if (freeCam.active) return;
    if (k === 'a') st.input.throttle = down ? 1 : 0;
    else if (k === 'z') st.input.brake = down ? 1 : 0;
    else if (k === 'l' && down) setHeads(!st.heads);
    else if (k === 'i' && down && !e.repeat) setDome(!st.dome);
    // ── ⚠ THE CAB AND THE COCKPIT SHARE A KEYBOARD ────────────────────────────
    // The flight sim wins every collision: X/C steer (rudder), V external view, Space clutch, J Jake,
    // W wipers. ',' and '.' stay on the gearbox (they're only the cockpit's secondary rudder). F is
    // a silent alias for V.
    else if (k === ' ') { st.input.clutch = down ? 1 : 0; st.heldBy = st.heldBy || {}; st.heldBy.clutch = down ? 1 : 0; }
    else if (k === 'j') st.input.jake = down ? 1 : 0;
    // ↑/↓ shift too, beside the steering. ⚠ Not W/S: S is look-behind, the flight sim's key.
    else if (down && !e.repeat && (k === ',' || k === '.' || k === 'arrowup' || k === 'arrowdown')) {
      // Through the same gate as the lever.
      const want = gearWithin((st.sim.gear ?? 1) + ((k === '.' || k === 'arrowup') ? 1 : -1));
      if (!st.shiftGate?.(want)) truckShift(st.sim, P, (k === '.' || k === 'arrowup') ? 1 : -1);
    }
    // Cruise is a latch, so its own press.
    else if (down && !e.repeat && k === 'g') toggleCruise();
    // K turns the key and holds like one: release lets it spring back. e.repeat isn't a second turn.
    else if (k === 'k') { if (down && !e.repeat) toggleIgnition(); else if (!down) st.stopCrank?.(); }
    else if (down && !e.repeat && k === '/') splitGear();
    // Reverse is its own key so a downshift can never find it by accident; it only takes at a stop.
    else if (down && !e.repeat && k === 'r') toggleReverse();
    else if (down && !e.repeat && k === 'w') cycleWipers();
    else if (down && !e.repeat && k === 'p') st.setPark?.(!st.park);
    // M (automatic) stays off the gearbox cluster: a key that switches the box off doesn't belong among those that work it.
    else if (down && !e.repeat && k === 'm' && e.shiftKey) st.setAutoClutch?.(!st.autoClutch);
    else if (down && !e.repeat && k === 'm') st.setAuto?.(!st.auto);
    else if (down && !e.repeat && (k === 'v' || k === 'f')) st.setExternal?.(!st.external);
    // Shift+/ arrives as '?', so the splitter's own '/' branch above never sees it.
    else if (down && !e.repeat && k === '?') st.toggleHelp?.();
    else if (down && !e.repeat && k === 'd') container.querySelector('.cab-dmg-strip')?.click();
    // T, because every obvious letter for food was taken.
    else if (down && !e.repeat && k === 't') st.toggleGalley?.();
    // Y, by elimination: L is the headlights.
    else if (down && !e.repeat && k === 'y') container.querySelector('.cab-latchbtn')?.click();
    else if (down && k === 'escape' && !container.querySelector('.cab-help')?.hidden) st.toggleHelp?.(false);
    // H holds: down opens the horn, up closes it and sends the length.
    else if (k === 'h') { if (down && !e.repeat) st.hornDown?.(); else if (!down) st.hornUp?.(); }
    // Q / E / S: held shoulder checks. ⚠ The release is guarded on the current yaw, so letting go of
    // Q with E still down leaves you looking right.
    else if (k === 'q' || k === 'e' || k === 's') {
      const yaw = k === 'q' ? -90 : k === 'e' ? 90 : 180;
      if (down) { st.viewYaw = yaw; st.showViewTag?.(yaw); }
      else if (st.viewYaw === yaw) { st.viewYaw = 0; st.showViewTag?.(0); }
    }
    else if (k === 'arrowleft' || k === 'arrowright' || k === 'x' || k === 'c') {
      const dir = (k === 'arrowleft' || k === 'x') ? -1 : 1;
      if (down) st.steerKey = dir;
      else if (st.steerKey === dir) st.steerKey = 0;
      st.wheel?.setHeld(st.steerKey);
    }
    else return;
    e.preventDefault();
  };
  addEventListener('keydown', st.onKey);
  addEventListener('keyup', st.onKey);

  // Cruise lives in one place: it's reached from a key, the rocker and the frame loop's cancels.
  // null is off; a number is the demanded mph.
  function setCruise(v) {
    st.cruise = v;
    const el = container.querySelector('.cab-cruise');
    if (el) {
      el.classList.toggle('on', v != null);
      el.setAttribute('aria-pressed', v == null ? 'false' : 'true');
      const w = el.querySelector('u span');
      if (w) w.textContent = v == null ? 'CRUISE' : `${Math.round(v)} MPH`;
    }
  }
  st.setCruise = setCruise;
  // ── AUTOMATIC SHIFTING ──────────────────────────────────────────────────────
  // ⚠ It's a hand, never a gearbox: it writes 'st.input.clutch' and calls selectGear, so the gate,
  // grind, stall and load all still decide, and the lever visibly moves. It defaults on, per browser.
  // ⚠ Only the driver writes the stored value; the touch force-on isn't a choice and isn't saved.
  function setAuto(on, remember = true) {
    // ⚠ On touch it never switches off: the touch shelf has no gearbox.
    if (cabTouch()) { on = true; remember = false; }
    st.auto = !!on;
    // Never leave the clutch pinned in by a sequence that was just switched off.
    if (!on && st.shiftSeq) { st.shiftSeq = null; if (!st.heldBy?.clutch && !st.clutchLatched) st.input.clutch = 0; }
    const el = container.querySelector('.cab-auto');
    if (el) { el.classList.toggle('on', st.auto); el.setAttribute('aria-pressed', st.auto ? 'true' : 'false'); el.dataset.dash = st.auto ? 'AUTO' : 'MANUAL'; const sp = el.querySelector('span'); if (sp) sp.textContent = st.auto ? 'AUTO' : 'MAN'; }
    if (remember) { try { localStorage.setItem(AUTO_KEY, st.auto ? '1' : '0'); } catch {} }
  }
  st.setAuto = setAuto;
  function setAutoClutch(on, remember = true) {
    // Same on touch: with no clutch pedal there, this keeps the engine from stalling.
    if (cabTouch()) { on = true; remember = false; }
    st.autoClutch = !!on;
    if (!on && !st.heldBy?.clutch && !st.clutchLatched && !st.shiftSeq) st.input.clutch = 0;
    const el = container.querySelector('.cab-autoclu');
    if (el) { el.classList.toggle('on', st.autoClutch); el.setAttribute('aria-pressed', st.autoClutch ? 'true' : 'false'); el.dataset.dash = st.autoClutch ? 'AUTO CLU' : 'FOOT CLU'; }
    if (remember) { try { localStorage.setItem(AUTOCLU_KEY, st.autoClutch ? '1' : '0'); } catch {} }
  }
  st.setAutoClutch = setAutoClutch;
  setAutoClutch(st.autoClutch, false);
  // Paints the switch; 'st.auto' already came from the stored preference.
  setAuto(st.auto, false);
  // ── THE PARK BRAKE ──────────────────────────────────────────────────────────
  // ⚠ It's the brake pedal latched, never a new force: it writes 'st.input.brake'. It works with the
  // key off (spring brakes) and won't come on above a walking pace.
  function setPark(on) {
    if (on && Math.abs(st.sim.speed) > 3) return;      // not parked
    st.park = !!on;
    // ⚠ The park brake cancels cruise but only suspends the automatic (see the inhibit in autoShift).
    if (st.park) st.setCruise?.(null);
    const el = container.querySelector('.cab-parkbtn');
    if (el) {
      el.classList.toggle('on', st.park);
      el.setAttribute('aria-pressed', String(st.park));
      // The word on the knob is what your hand does next.
      const w = el.querySelector('em');
      if (w) w.textContent = st.park ? 'PUSH' : 'PULL';
    }
    // Setting it on a stopped truck means getting out: the ordinary 'park' verb follows, sent with
    // the engine running too so parkRig can say the key is the missing step.
    // ⚠ The send is latched, never decided here: the knob comes on under 3 mph and the frame loop
    // fires it once the rig is at rest (the exit-cab block). Pushing the knob in clears 'parkSent'.
    if (!st.park) st.parkSent = false;
  }
  st.setPark = setPark;
  // ── THE KEY ─────────────────────────────────────────────────────────────────
  // Off is the stall flag: one "engine not turning" in the model. Starting is the model's rule
  // (clutch in or neutral, flight-model.js). ⚠ The barrel's angle is derived from the engine, never
  // remembered, or it sits at ON over a stalled motor.
  const KEY_DEG = { off: 0, on: 38, start: 74 };
  function paintKey() {
    const el = container.querySelector('.cab-keybarrel');
    if (!el) return;
    const pos = st.cranking ? 'start' : st.sim.stalled ? 'off' : 'on';
    el.style.setProperty('--keyrot', KEY_DEG[pos] + 'deg');
    el.classList.toggle('on', !st.sim.stalled);
    el.classList.toggle('cranking', !!st.cranking);
    el.setAttribute('aria-pressed', String(!st.sim.stalled));
  }
  st.paintKey = paintKey;
  // Turning it off is instant.
  function ignitionOff() {
    if (st.sim.stalled) return;
    st.sim.stalled = true;
    st.input.throttle = 0;
    st.setCruise?.(null);
    // ⚠ A key-off is a decision to stop and a stall isn't: only 'shutdown' makes the frame loop hold
    // the rig still, so a lugged stall at forty isn't punished with the brakes. Cranking clears it.
    st.shutdown = true;
    stopCrank();
    keyCue(false);
    paintKey();
    st.paintControls?.();
  }
  // Holding it round cranks for as long as you hold it.
  function startCrank() {
    if (!st.sim.stalled || st.cranking) return;
    // Asking for the engine releases the settle, and the brake goes back to what a foot is doing.
    st.shutdown = false;
    if (!st.heldBy?.brake) st.input.brake = 0;
    // ⚠ The one refusal that has to say its name: the model won't crank an engine coupled to the
    // road, and silently that reads as a broken button. Say the fix before the churn.
    if (!(st.input.clutch > 0.5 || st.sim.gear === 0)) {
      // The gate's CLUTCH tell where the eye is, and a line in the log for the bottom display rung.
      const gate = container.querySelector('.cab-gate');
      if (gate) {
        gate.classList.remove('grind'); void gate.offsetWidth; gate.classList.add('grind');
        gate.dataset.tell = 'CLUTCH';
        clearTimeout(st.grindTell);
        st.grindTell = setTimeout(() => { if (gate.dataset) gate.dataset.tell = ''; }, 1800);
        setTimeout(() => gate.classList.remove('grind'), 420);
      }
      // ⚠ Loaded on demand: a static import of render.js closes a cycle through the boot chain
      // (render.js, smartbar, smartbar-macros, input.js, this file).
      import('../render.js').then((r) => r.appendHtml(
        "The starter churns and the engine won't catch: the box is still in gear. <b>Clutch in</b>, or find <b>neutral</b>, and turn the key again.",
        'msg-system')).catch(() => { /* the gate plate already said it — the log line is the second surface, not the only one */ });
      // The starter still turns; the churn is what makes the message make sense.
    }
    st.cranking = true;
    st.input.starter = 1;
    keyCue(true);
    paintKey();
    // A starter gives up after a few seconds.
    clearTimeout(st.crankT);
    st.crankT = setTimeout(() => stopCrank(), 4000);
  }
  function stopCrank() {
    clearTimeout(st.crankT);
    if (st) { st.cranking = false; st.input.starter = 0; }
    paintKey();
  }
  st.startCrank = startCrank; st.stopCrank = stopCrank; st.ignitionOff = ignitionOff;
  // The one-press form for the K key and a tap.
  function toggleIgnition() {
    if (!st.sim.stalled) ignitionOff();
    else startCrank();
  }
  st.toggleIgnition = toggleIgnition;

  function toggleCruise() {
    if (st.cruise != null) return setCruise(null);
    if (st.sim.gear > 0 && st.sim.speed >= 5.5 && !st.dry && !st.broken) setCruise(st.sim.speed);
  }


  // The REV button runs the automatic's own sequence (beginShift), so the shift is visible;
  // toggleReverse throws the lever straight across for the R key.
  function engageReverse() {
    if (Math.abs(st.sim.speed) >= 2) return;      // the lever's standstill rule
    if (st.shiftSeq) return;                      // one shift at a time
    beginShift(st.sim.gear < 0 ? 0 : -1);         // reverse goes to neutral; otherwise into reverse
  }
  st.engageReverse = engageReverse;
  function toggleReverse() {
    if (Math.abs(st.sim.speed) >= 2) return;
    // The clutch is automatic for reverse only: it can only be chosen stopped, so there's no shift to
    // fluff. Dipped and released around it, honouring a hand or latch on the pedal.
    const held = st.input.clutch;
    st.input.clutch = 1;
    if (!st.shiftGate?.(st.sim.gear < 0 ? 1 : -1)) {
      truckShift(st.sim, P, st.sim.gear < 0 ? 2 : -(st.sim.gear + 1));
    }
    st.input.clutch = (st.heldBy?.clutch || st.clutchLatched) ? held : 0;
  }
  // The splitter is half a shift, so it goes through shiftGate too.
  function splitGear() {
    const want = gearWithin((st.sim.gear ?? 1) + (st.sim.split ? -1 : 1));
    if (st.shiftGate?.(want)) return;
    truckSplit(st.sim, P);
  }

  // Wipers off, intermittent, low, high. Client-only: nothing about them is world state.
  function paintWipers() {
    const w = st.wipers | 0;
    const stalk = container.querySelector('.cab-stalk');
    if (stalk) {
      stalk.style.setProperty('--pos', String(w));
      stalk.classList.toggle('on', w > 0);
      // Painted here too, so switching off in the rain brings the hint straight back.
      stalk.classList.toggle('hint', cabWet(st) && !w);
      const lbl = stalk.querySelector('.cab-stalk-pos');
      if (lbl) lbl.textContent = WIPE_POS[w] || 'OFF';
      stalk.setAttribute('aria-label', 'Wipers: ' + (WIPE_POS[w] || 'OFF').toLowerCase());
    }
  }
  st.paintWipers = paintWipers;
  // ── THE HEADLIGHT SWITCH ───────────────────────────────────────────────────
  // On by default; the telemetry packet carries it to other drivers.
  if (st.heads === undefined) st.heads = true;
  function setHeads(on) {
    st.heads = !!on;
    const el = container.querySelector('.cab-heads');
    if (el) {
      el.classList.toggle('on', st.heads);
      // ⚠ Write the <span>, never the button: textContent on the button deletes its tell-tale lamp.
      const lbl = el.querySelector('span');
      if (lbl) lbl.textContent = st.heads ? 'LAMPS' : 'DARK';
      el.setAttribute('aria-pressed', st.heads ? 'true' : 'false');
      el.setAttribute('aria-label', st.heads ? 'Headlights: on' : 'Headlights: off');
    }
  }
  st.setHeads = setHeads;
  // ── THE DOME LAMP ──────────────────────────────────────────────────────────
  // On by default and local only: nobody outside the cab can see it.
  if (st.dome === undefined) st.dome = true;
  function setDome(on) {
    st.dome = !!on;
    const el = container.querySelector('.cab-dome');
    if (el) {
      el.classList.toggle('on', st.dome);
      // ⚠ The <span>, as with the headlights.
      const lbl = el.querySelector('span');
      if (lbl) lbl.textContent = st.dome ? 'CAB' : 'DARK';
      el.setAttribute('aria-pressed', st.dome ? 'true' : 'false');
      el.setAttribute('aria-label', st.dome ? 'Cab light: on' : 'Cab light: off');
    }
  }
  st.setDome = setDome;
  function cycleWipers() {
    st.wipers = ((st.wipers | 0) + 1) % 4;
    paintWipers();
    const el = container.querySelector('.cab-wipe');
    if (el) {
      // ⚠ The <span>, as with the headlights.
      const lbl = el.querySelector('span');
      if (lbl) lbl.textContent = ['WIPE', 'INT', 'LO', 'HI'][st.wipers];
      el.classList.toggle('on', st.wipers > 0);
    }
  }

  // ── THE VIEW CHROME ────────────────────────────────────────────────────────
  // Fullscreen and hide-panel are body classes, as in the flight sim; fullscreen supersedes hide-panel.
  const fsBtn = container.querySelector('.cab-fsbtn');
  const hideBtn = container.querySelector('.cab-hidebtn');
  const viewBtn = container.querySelector('.cab-viewbtn');
  fsBtn.addEventListener('click', () => {
    const on = document.body.classList.toggle('cab-fullscreen');
    fsBtn.classList.toggle('on', on);
    if (on) { document.body.classList.remove('cab-hidepanel'); hideBtn.classList.remove('on'); }
  });
  hideBtn.addEventListener('click', () => {
    const on = document.body.classList.toggle('cab-hidepanel');
    hideBtn.classList.toggle('on', on);
    if (on) { document.body.classList.remove('cab-fullscreen'); fsBtn.classList.remove('on'); }
  });
  // Big screen is a separate layer, so ⛶ and ⊟ keep their state; bigscreen.js keeps its lit state.
  bindBigScreenButton(container.querySelector('.cab-bigbtn'));
  // On a phone the panel starts hidden; the rules are in compact-view.js.
  seatHidePanel('cab-hidepanel', hideBtn);
  window.dispatchEvent(new Event('pane:claimed'));   // a phone keeps #area-pane collapsed until told
  // The external view is the renderer's existing chase camera. ⚠ The rig must never become a world
  // object (the collision probe would hit it); it's the renderer's own-ship.
  viewBtn.addEventListener('click', () => setExternal(!st.external));
  function setExternal(on) {
    // Stepping back inside stows the camera, or it holds the keyboard hostage.
    if (!on) st.exitFreeCam?.();
    st.external = !!on;
    viewBtn.classList.toggle('on', st.external);
    viewBtn.textContent = st.external ? '◎ CAB' : '◎ EXT';
    container.querySelector('.cab-wrap')?.classList.toggle('cab-ext', st.external);
    // Outside there's no dash, so repaint the glass fuel gauge now.
    paintFuelGauge(st);
    const rst = container.querySelector('.cab-orbitreset');
    if (rst) rst.hidden = !st.external;
    // A drag that started as steering mustn't become an orbit, and vice versa.
    st.wheel?.setDragging(false);
  }
  st.setExternal = setExternal;
  // The one way out, for the key, the view button and teardown alike.
  function exitFreeCam() {
    if (!freeCam.active) return;
    freeCam.close();
    // A driver who wasn't on cruise before mustn't be on it after.
    if (!st.freeHold?.cruise) setCruise(null);
    st.freeHold = null;
    // ⚠ The pedals and steering come back from the key record, since autorepeat won't fire again for a held key.
    for (const [k, ctl] of [['a', 'throttle'], ['z', 'brake'], [' ', 'clutch'], ['j', 'jake']]) {
      st.input[ctl] = st.keysDown.has(k) ? 1 : 0;
      if (st.heldBy) st.heldBy[ctl] = st.input[ctl];
    }
    st.steerKey = st.keysDown.has('x') || st.keysDown.has('arrowleft') ? -1
      : st.keysDown.has('c') || st.keysDown.has('arrowright') ? 1 : 0;
    st.wheel?.setHeld(st.steerKey);
    paintFreeCamChrome();
  }
  st.exitFreeCam = exitFreeCam;
  // ── THE ROUTE PICKER ───────────────────────────────────────────────────────
  // ⚠ The screen proposes and the verb decides: every row sends 'route <key>', which owns every rule.
  // Never decide anything here. Unreachable destinations are shown greyed with the reason, never hidden.
  {
    const box = container.querySelector('.cab-routes');
    const REACH = {
      ok: ['', 'in range'],
      thin: ['r-thin', 'past your tank, one way'],
      far: ['r-far', 'well past your range'],
    };
    const body = () => box?.querySelector('.cab-gps-body');
    // Which app is up; the tabs are the only writer.
    st.gpsApp = 'route';
    function renderGps() {
      // ⚠ An EMP kills the whole unit, every tab: a plotter that still showed MAP would be pretending.
      if (st.elecOut) {
        const el = body(); if (!el) return;
        el.innerHTML = '<div class="cab-routes-none cab-gps-dead">NO SIGNAL<br><span>the head took the pulse</span></div>';
        return;
      }
      if (st.gpsApp === 'damage') return renderDamageApp();
      if (st.gpsApp === 'map') return renderMapApp();
      return renderRoutePicker();
    }
    st.renderMapApp = () => { if (st.gpsApp === 'map') renderMapApp(); };
    // ── THE MAP ────────────────────────────────────────────────────────────────
    // Drawn only from what's already on the wire: the 'map' window, 's'/'L' and 'routes'. ⚠ Never add
    // a second position channel. In a city it draws the window north-up.
    function renderMapApp() {
      const el = body(); if (!el) return;
      const corridor = (st.L || 0) > 0 && (st.sim?.leg || st.leg) !== 'city';
      el.innerHTML = '<canvas class="cab-gps-canvas" width="440" height="300"></canvas>'
        + '<div class="cab-gps-legend"></div>';
      const cv = el.querySelector('.cab-gps-canvas');
      const leg = el.querySelector('.cab-gps-legend');
      if (!cv || !cv.getContext) return;
      const g = cv.getContext('2d');
      g.clearRect(0, 0, cv.width, cv.height);
      // On the corridor it's the window plus the route strip as a footer ('st.map' is synthesised
      // there too; see providerFor in plugins/trucking/state.js).
      const RIBBON = 54;
      const full = { x: 0, y: 0, w: cv.width, h: cv.height };
      if (corridor) {
        // The window draws without a legend here; the strip's legend is the useful one.
        drawLocalMap(g, cv, null, { x: 0, y: 0, w: cv.width, h: cv.height - RIBBON });
        drawRouteStrip(g, cv, leg, { x: 0, y: cv.height - RIBBON, w: cv.width, h: RIBBON });
      } else drawLocalMap(g, cv, leg, full);
    }
    // Few flat colours: it's an instrument.
    const MAP_INK = { road: '#4d5560', bldg: '#20262e', water: '#1d3550', field: '#2c3a2e', land: '#2a2620', air: '#12151a',
      // Corridor only: the paved surface and the slower graded verge, deliberately close in tone.
      paved: '#5a6472', verge: '#403a30' };
    function cellInk(c) {
      if (!c || c.kind === 'air') return MAP_INK.air;
      if (c.bt) return MAP_INK.bldg;
      // ⚠ The corridor is a band: 'rt' (offset from centreline) and 'rw' (paved half-width) travel
      // together (see deriveSurfaceCell).
      if (c.rdeg !== undefined && c.rw !== undefined) {
        return Math.abs(c.rt || 0) <= c.rw ? MAP_INK.paved : MAP_INK.verge;
      }
      if (c.road) return MAP_INK.road;
      if (c.biome === 'water' || c.sub) return MAP_INK.water;
      if (c.kind === 'field') return MAP_INK.field;
      return MAP_INK.land;
    }
    // 'rect' is this map's box on the canvas; 'leg' is optional so the map and the strip don't both write the legend.
    function drawLocalMap(g, cv, leg, rect = { x: 0, y: 0, w: cv.width, h: cv.height }) {
      const rows = st.map;
      if (!rows || !rows.length) { if (leg) leg.innerHTML = '<span class="cab-routes-none">No fix.</span>'; return; }
      const n = rows.length, px = Math.min(rect.w, rect.h) / n;
      const ox = rect.x + (rect.w - px * n) / 2, oy = rect.y + (rect.h - px * n) / 2;
      for (let r = 0; r < n; r++) for (let c = 0; c < rows[r].length; c++) {
        g.fillStyle = cellInk(rows[r][c]);
        g.fillRect(ox + c * px, oy + r * px, Math.ceil(px), Math.ceil(px));
      }
      // Roadside landmarks from the 'mark' channel the windshield extrudes, so nothing's authored twice.
      const MARK_INK = { sign: '#c9d2dc', pylons: '#7d8794', bay: '#e8b455', gate: '#9aa6b4', statue: '#6f7a88' };
      for (let r = 0; r < n; r++) for (let c = 0; c < rows[r].length; c++) {
        const ink = MARK_INK[rows[r][c]?.mark];
        if (!ink) continue;
        g.fillStyle = ink;
        const d = Math.max(2, px * 0.42);
        g.fillRect(ox + (c + 0.5) * px - d / 2, oy + (r + 0.5) * px - d / 2, d, d);
      }
      // ⚠ The truck sits at its fractional position in the centre tile: 'mapX/mapY' are the rounded
      // centre, 'sim.x/y' are the wheels.
      const cx = ox + (n / 2 + ((st.sim?.x ?? st.mapX) - st.mapX)) * px;
      const cy = oy + (n / 2 + ((st.sim?.y ?? st.mapY) - st.mapY)) * px;
      const hd = ((st.sim?.heading ?? 0)) * Math.PI / 180;
      g.save(); g.translate(cx, cy); g.rotate(hd);
      g.fillStyle = '#e8b455'; g.strokeStyle = '#1a1d22'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 4); g.lineTo(-6, 7); g.closePath();
      g.fill(); g.stroke(); g.restore();
      g.fillStyle = '#8c98a6'; g.font = '10px system-ui, sans-serif'; g.textAlign = 'left';
      g.fillText('N', ox + 5, oy + 13);
      if (leg) {
        leg.innerHTML = `<b>${Math.round(st.mapX)}, ${Math.round(st.mapY)}</b>`
          + `<span class="td-dim"> · heading ${Math.round(st.sim?.heading ?? 0)}° · ${esc(String(st.input?.surface || 'road')).toUpperCase()}</span>`;
      }
    }
    // The corridor as one line, drawn in 'rect' as the map's footer. 's'/'L' are the server's own,
    // so the dot can't drift from the mileage.
    function drawRouteStrip(g, cv, leg, rect = { x: 0, y: 0, w: cv.width, h: cv.height }) {
      const L = Math.max(1, st.L || 1), s = Math.max(0, Math.min(L, st.s || 0));
      const x0 = rect.x + 34, x1 = rect.x + rect.w - 34, y = rect.y + 18;
      g.strokeStyle = '#252c34'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(rect.x + 6, rect.y + 0.5); g.lineTo(rect.x + rect.w - 6, rect.y + 0.5); g.stroke();
      g.strokeStyle = '#39424e'; g.lineWidth = 10; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
      g.strokeStyle = '#c98f3c'; g.lineWidth = 10;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + (x1 - x0) * (s / L), y); g.stroke();
      const nodes = Math.max(0, st.nodes || 0);
      for (let i = 0; i <= nodes; i++) {
        const px = x0 + (x1 - x0) * (nodes ? i / nodes : 0);
        g.fillStyle = i <= (st.node || 0) ? '#e8b455' : '#5c6674';
        g.beginPath(); g.arc(px, y, 3.5, 0, 6.2832); g.fill();
      }
      const dot = x0 + (x1 - x0) * (s / L);
      g.fillStyle = '#f2f6fb'; g.strokeStyle = '#1a1d22'; g.lineWidth = 1.4;
      g.beginPath(); g.arc(dot, y, 7, 0, 6.2832); g.fill(); g.stroke();
      g.fillStyle = '#8c98a6'; g.font = '11px system-ui, sans-serif';
      g.textAlign = 'left'; g.fillText('start', x0 - 8, y + 22);
      g.textAlign = 'right'; g.fillText(destName() || 'the road', x1 + 8, y + 22);
      // Miles in the boards' unit (TILES_PER_MILE). ⚠ Derived from the destination's own mileage and
      // the server's progress, never counted here, so it matches the row the driver picked.
      const cur = st.routes?.dests?.find((d) => d.current) || st.routes?.dests?.find((d) => d.key === st.aim);
      const total = cur?.miles;
      const left = total != null ? Math.max(0, Math.round(total * (1 - s / L))) : null;
      leg.innerHTML = `<b>${destName() || 'no fix'}</b>`
        + `<span class="td-dim"> · node ${(st.node || 0) + 1} of ${(st.nodes || 0) + 1}`
        + `${left != null ? ` · ${left} of ${total} miles to run` : ''}</span>`
        + `<div class="cab-gps-instr">${nextInstruction()}</div>`;
    }
    // ── THE INSTRUCTION ────────────────────────────────────────────────────────
    // Read off 'rdeg', the corridor's heading at the tile you're on, so it can't contradict the road.
    // Quiet when there's nothing to say.
    function nextInstruction() {
      const rows = st.map;
      if (!rows || !rows.length) return '';
      const mid = rows[(rows.length - 1) / 2 | 0];
      const cell = mid && mid[(mid.length - 1) / 2 | 0];
      const rdeg = cell && cell.rdeg;
      if (rdeg == null) return '<span class="td-dim">Off the road.</span>';
      let d = ((rdeg - (st.sim?.heading ?? 0)) % 360 + 540) % 360 - 180;
      const mag = Math.abs(d);
      if (mag < 6) return '<span class="td-dim">Straight on.</span>';
      const side = d > 0 ? 'right' : 'left';
      if (mag < 18) return `<b>Bear ${side}.</b>`;
      return `<b class="cab-gps-turn">Hold it ${side}: the road is going.</b>`;
    }
    function destName() {
      const R = st.routes;
      const cur = R?.dests?.find((d) => d.current) || R?.dests?.find((d) => d.key === st.aim);
      return cur ? cur.heading : null;
    }
    st.renderGps = renderGps;
    // The rig's condition as a GPS page: the same 'st.dmg' rows the damage card draws.
    function renderDamageApp() {
      const el = body(); if (!el) return;
      const d = st.dmg;
      if (!d) { el.innerHTML = '<div class="cab-routes-none">No read on the truck yet.</div>'; return; }
      const parts = DMG_PARTS.filter((p) => d[p.key]);
      el.innerHTML = parts.map((p) => {
        const v = d[p.key];
        return `<div class="cab-dmg-row"><span class="cab-dmg-lbl">${p.label}</span>`
          + `<span class="cab-dmg-bar b-${v.band}"><i style="width:${Math.round(v.v * 100)}%"></i></span>`
          + `<b>${Math.round(v.v * 100)}%</b><span class="cab-dmg-note">${p.note}</span></div>`;
      }).join('')
        + '<p class="cab-dmg-foot">A bench is <b>rig repair shop</b> at a depot, or one part at a time. '
        + 'A component that has FAILED needs the part itself: <b>rig parts</b>.</p>';
    }
    function renderRoutePicker() {
      if (!box || box.hidden || st.gpsApp !== 'route') return;
      const el = body(); if (!el) return;
      const R = st.routes;
      if (!R || !R.dests?.length) {
        el.innerHTML = '<div class="cab-routes-none">One road out of here, and you\'re on it.</div>';
        return;
      }
      const rows = R.dests.map((d) => {
        const [cls, note] = REACH[d.reach] || REACH.ok;
        return `<button class="cab-route ${cls}${d.current ? ' on' : ''}" data-key="${esc(d.key)}">`
          + `<b>${esc(d.heading)}</b>`
          + `<span class="cab-route-d">${d.miles} miles &middot; ${note}</span>`
          + `${d.current ? '<i>▸ running for this</i>' : ''}</button>`;
      }).join('');
      // Past the junction there's nothing to choose.
      const foot = R.forkAhead
        ? '<div class="cab-routes-ft">The fork is still ahead.</div>'
        : '<div class="cab-routes-ft warn">The fork is behind you. This is the road you\'re on.</div>';
      el.innerHTML = `${R.origin ? `<div class="cab-routes-hd">out of ${esc(R.origin)}</div>` : ''}${rows}${foot}`;
    }
    st.renderRoutePicker = renderRoutePicker;
    st.toggleRoutePicker = (on) => {
      if (!box) return;
      box.hidden = on === undefined ? !box.hidden : !on;
      renderGps();
      // ⚠ Nothing is requested on open: the only channel is 'trucksync' telemetry, and a fake one
      // would feed the anti-cheat a position the truck isn't at. The list is at most a second old.
      grabSeatKeys();
    };
    // One delegated listener on the header, since re-renders replace the buttons.
    box?.querySelector('.cab-gps-hd')?.addEventListener('click', (e) => {
      const tab = e.target.closest?.('.cab-gps-tab');
      if (tab) {
        st.gpsApp = tab.dataset.app;
        for (const t of box.querySelectorAll('.cab-gps-tab')) t.classList.toggle('on', t === tab);
        renderGps();
        grabSeatKeys();                       // tapping the screen mustn't cost you the wheel
        e.preventDefault(); return;
      }
      if (e.target.closest?.('.cab-gps-x')) { st.toggleRoutePicker(false); e.preventDefault(); return; }
      if (e.target.closest?.('.cab-gps-pop')) {
        // Popping out is a class on the same DOM, never a new window.
        const out = box.classList.toggle('cab-gps-out');
        if (out && !box.style.left) { box.style.left = '18vw'; box.style.top = '16vh'; }
        renderGps();
        grabSeatKeys();
        e.preventDefault(); return;
      }
    });
    // Dragging the popped-out unit by its header, with pointer capture.
    {
      const hd = box?.querySelector('.cab-gps-hd');
      let drag = null;
      hd?.addEventListener('pointerdown', (e) => {
        if (!box.classList.contains('cab-gps-out')) return;
        if (e.target.closest('.cab-gps-tab,.cab-gps-pop,.cab-gps-x')) return;   // buttons first
        const r = box.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        hd.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      });
      hd?.addEventListener('pointermove', (e) => {
        if (!drag) return;
        // Clamped to the window, or it can be dragged off for good.
        box.style.left = Math.max(0, Math.min(innerWidth - 80, e.clientX - drag.dx)) + 'px';
        box.style.top = Math.max(0, Math.min(innerHeight - 40, e.clientY - drag.dy)) + 'px';
      });
      const end = () => { drag = null; };
      hd?.addEventListener('pointerup', end);
      hd?.addEventListener('pointercancel', end);
    }

    box?.addEventListener('click', (e) => {
      const btn = e.target.closest?.('.cab-route');
      if (!btn) return;
      // Straight to the verb; refusals come back in the log.
      sendCmdSilent('route ' + btn.dataset.key);
      st.toggleRoutePicker(false);
      e.preventDefault();
    });
  }

  container.querySelector('.cab-orbitreset')?.addEventListener('click', () => {
    st.extYaw = 0; st.extPitch = EXT_REST_PITCH; st.extZoom = 1;
  });

  // ── THE DAMAGE HUD ─────────────────────────────────────────────────────────
  // Two densities over one payload. Repainted from the server push (cabContext), never per frame.
  const dmgStrip = container.querySelector('.cab-dmg-strip');
  const dmgFull = container.querySelector('.cab-dmg-full');
  dmgStrip.addEventListener('click', () => {
    const open = dmgFull.hidden;
    dmgFull.hidden = !open;
    dmgStrip.setAttribute('aria-expanded', String(open));
  });
  st.renderDamage = (d) => {
    if (!d) return;
    // A component dropping into a worse band plays a cue, from the server's band so the pip, bar,
    // log and sound change together. ⚠ Only on the way down: a repair changes the band too.
    const prev = st.dmg;
    if (prev) {
      for (const part of DMG_PARTS) {
        const now = d[part.key], was = prev[part.key];
        if (!now || !was) continue;
        if (now.v < was.v && now.band !== was.band) damageCue(part.key, now.band);
      }
    }
    st.dmg = d;
    // One pip per component; the worst one sets the whole strip's alarm.
    const parts = DMG_PARTS.filter(p => d[p.key]);
    const worst = parts.reduce((w, p) => Math.min(w, d[p.key].v), 1);
    dmgStrip.innerHTML = parts.map(p =>
      `<i class="cab-pip b-${d[p.key].band}" title="${p.label} ${Math.round(d[p.key].v * 100)}%">`
      + `<em style="height:${Math.round(d[p.key].v * 100)}%"></em><b>${p.short}</b></i>`).join('');
    dmgStrip.classList.toggle('warn', worst < 0.40);
    dmgStrip.classList.toggle('bad', worst < 0.15);
    dmgFull.innerHTML = `<h4>CONDITION</h4>` + parts.map((p) => {
      const v = d[p.key];
      return `<div class="cab-dmg-row"><span class="cab-dmg-lbl">${p.label}</span>`
        + `<span class="cab-dmg-bar b-${v.band}"><i style="width:${Math.round(v.v * 100)}%"></i></span>`
        + `<b>${Math.round(v.v * 100)}%</b><span class="cab-dmg-note">${p.note}</span></div>`;
    }).join('')
      + `<p class="cab-dmg-foot">A bench is <b>rig repair shop</b> at a depot, or one part at a time: `
      + `<b>rig repair shop engine</b>. Out here, <b>fix</b> needs a box of spares.</p>`;
    // The GPS rig page shows these same numbers, so repaint it here.
    if (st.gpsApp === 'damage') st.renderGps?.();
  };

  // The controls card, built from the CONTROLS table.
  const helpEl = container.querySelector('.cab-help');
  helpEl.innerHTML = `<h4>DRIVING</h4><dl>${CONTROLS.map(([k, d]) =>
    `<dt>${k}</dt><dd>${d}</dd>`).join('')}</dl>
    <p class="cab-help-foot">Everything here is also a button on the dash. Press <b>?</b> or <b>Esc</b> to close.</p>`;
  const toggleHelp = (show) => {
    helpEl.hidden = show === undefined ? !helpEl.hidden : !show;
    container.querySelector('.cab-helpbtn')?.classList.toggle('on', !helpEl.hidden);
  };
  container.querySelector('.cab-helpbtn').addEventListener('click', () => toggleHelp());
  helpEl.addEventListener('click', () => toggleHelp(false));
  st.toggleHelp = toggleHelp;

  // ── THE GALLEY FLAP ────────────────────────────────────────────────────────
  // ⚠ Opening it asks once ('galley'); the list must never ride cabContext, which runs several times
  // a second and would pay an inventory query per push. The bars paint at once from local state.
  const galleyEl = container.querySelector('.cab-galley');
  const toggleGalley = (show) => {
    const open = show === undefined ? galleyEl.hidden : show;
    galleyEl.hidden = !open;
    container.querySelector('.cab-galleybtn')?.classList.toggle('on', open);
    if (open) {
      galleyEl.querySelector('.cab-galley-body').innerHTML = '<i class="cab-galley-wait">…</i>';
      paintGalleyVitals(st);
      // ⚠ Flagged as ours (see cabGalley), so the reply can't re-open a flap the driver closed.
      st.galleyAsked = true;
      sendCmdSilent('galley');
    }
  };
  // The latch sends the ordinary verb and waits for the payload (paintLatch).
  container.querySelector('.cab-latchbtn').addEventListener('click', () => {
    sendCmdSilent(st.locked ? 'unlock cab' : 'lock cab');
  });
  paintLatch(st);

  container.querySelector('.cab-galleybtn').addEventListener('click', () => toggleGalley());
  galleyEl.querySelector('.cab-galley-x').addEventListener('click', () => toggleGalley(false));
  // Delegated, since rows are rebuilt each reply. Eating refreshes rather than closing.
  galleyEl.addEventListener('click', (e) => {
    const b = e.target.closest?.('.cab-galley-item');
    if (!b) return;
    sendCmdSilent(b.dataset.cmd);
    st.galleyAsked = true;
    sendCmdSilent('galley');
  });
  st.toggleGalley = toggleGalley;
  st.renderGalley = (msg) => renderGalley(st, msg);

  // Sends the bare verb: the fugitive's sleeper-or-trailer question belongs to the verb.
  container.querySelector('.cab-hitchalert').addEventListener('click', (e) => {
    if (e.target.closest?.('.cab-hitch-go')) sendCmdSilent('pickup');
  });


  st.raf = requestAnimationFrame(frame);
  return st;
}


// The 'galley' verb's reply, routed from dispatch; a no-op with no cab up. Paint only.
// ⚠ A reply the panel asked for ('galleyAsked') only repaints; one the player typed opens the flap.
// Otherwise the panel's own refreshes kept re-opening a flap the driver had just closed.
export function cabGalley(msg) {
  if (!st) return;
  const ours = st.galleyAsked;
  st.galleyAsked = false;
  if (!ours) st.toggleGalley?.(true);
  st.renderGalley?.(msg);
}

// The server's push: it owns the world window, odometer and surface. Position is snapped only when
// the server moved the rig (a bog).
export function cabContext(ctx) {
  if (!st) return;
  // A bench repair or tune arrives on the next push and takes effect in the seat.
  if (ctx.params || ctx.typeId) setParams(ctx);
  if (ctx.condition != null) st.condition = ctx.condition;
  if (ctx.dmg) st.renderDamage?.(ctx.dmg);
  // Interned: see panels/map-intern.js.
  if (ctx.map) { st.map = internMap(st.map, st.mapX, st.mapY, ctx.map, ctx.mapX, ctx.mapY); st.mapX = ctx.mapX; st.mapY = ctx.mapY; st.renderMapApp?.(); }
  // The South Lock: you rolled out on amber. The lamps are already red in the map above.
  if (ctx.lockAlarm) lockKlaxon();
  // The road past the window as polylines in world tiles. null means no road in range and must clear.
  if (ctx.roads !== undefined) st.roads = ctx.roads;
  // Towers and colour grade ride every eighth tile (trucking/state.js farView); absent keeps the last.
  if (ctx.skyline) st.skyline = ctx.skyline;
  if (ctx.regions) st.regions = ctx.regions;
  // An empty list is a real answer (see cockpit.js flightSimContext).
  if (ctx.actors !== undefined) st.actors = ctx.actors;
  // null is nobody out there; only an absent key keeps the last answer.
  if (ctx.hitcher !== undefined) { st.hitcher = ctx.hitcher; paintHitchAlert(st); }
  if (ctx.locked !== undefined) { st.locked = !!ctx.locked; paintLatch(st); paintHitchAlert(st); }
  st.s = ctx.s ?? st.s; st.L = ctx.L ?? st.L;
  st.aim = ctx.aim !== undefined ? ctx.aim : st.aim;
  if (ctx.routes !== undefined) { st.routes = ctx.routes; st.renderRoutePicker?.(); }   // the route verb owns the aiming
  // The dash is dead (EMP): every screen reads this flag. Repainted on the edge, both ways.
  if (ctx.elecOut !== undefined && !!ctx.elecOut !== !!st.elecOut) { st.elecOut = !!ctx.elecOut; st.renderGps?.(); }
  st.node = ctx.node ?? st.node; st.nodes = ctx.nodes ?? st.nodes;
  if (ctx.surface) st.input.surface = ctx.surface;
  // Grime is always the server's number, or a bench wash would be undone.
  if (ctx.grime != null) st.grime = ctx.grime;
  if (ctx.fits !== undefined) FITS = ctx.fits || '';
  // Stamped on arrival, which gives contactsFor an age.
  if (ctx.contacts) {
    st.contacts = ctx.contacts.map(c => ({ ...c, t: performance.now() }));
    (st.contactTrack || (st.contactTrack = makeContactTrack())).update(ctx.contacts);
  }
  // Trailers in the yard arrive in contact shape (trailers.js trailersNear) and draw as contacts.
  if (ctx.trailers) st.trailers = ctx.trailers.map(c => ({ ...c, t: performance.now() }));
  if (ctx.hitchable !== undefined) { st.hitchable = ctx.hitchable; paintHitchBtn(st); }
  // The pump and the balance it meters against; null is a real answer.
  if (ctx.pump !== undefined) { st.pump = ctx.pump || null; paintPumpBtn(st); paintFuelGauge(st); }
  // Out of diesel; the server clamps the speed too.
  if (ctx.dry != null) { st.dry = !!ctx.dry; paintFuelGauge(st); }
  // ⚠ Not while the handle is down: the server's pre-pour figure would drag the needle back each
  // second. The commit's own push lands after release.
  if (ctx.fuel != null && !st.pumping) { st.fuel = Math.max(0, Math.min(1, ctx.fuel)); paintPumpBtn(st); paintFuelGauge(st); }
  if (ctx.broken !== undefined) st.broken = ctx.broken || null;
  if (ctx.hour != null) st.hour = ctx.hour;
  if (ctx.moon != null) st.moon = ctx.moon;
  if (ctx.wind != null) st.wind = ctx.wind;
  // ⚠ wxField may legitimately be null, so test presence, never truthiness, or the last storm sticks.
  if (ctx.wxField !== undefined) st.wxField = ctx.wxField || null;
  if (ctx.wxGround !== undefined) st.wxGround = ctx.wxGround || null;
  if (ctx.wxEvent !== undefined) st.wxEvent = ctx.wxEvent || null;
  if (ctx.weather) {
    st.weather = ctx.weather;
    // paintWipers reads the weather, so the stalk's hint follows it.
    st.paintWipers?.();
  }
  if (ctx.weather || ctx.wxEvent !== undefined) touchWipers(st);
  // The trailer is the server's fact, the articulation angle the client's. A new hitch starts straight.
  if (ctx.trailer !== undefined) {
    const want = !!ctx.trailer;
    if (want !== st.sim.hitched) { st.sim.hitched = want; st.sim.phi = 0; st.sim.trailerHeading = st.sim.heading; }
    st.sim.trailerKg = ctx.trailer?.kg || 0;
    st.sim.loadKg = ctx.trailer?.loadKg || 0;
  }
  if (ctx.bogged) { st.sim.x = ctx.x; st.sim.y = ctx.y; st.sim.heading = ctx.heading; st.sim.speed = 0; }
}

// ── Collision ────────────────────────────────────────────────────────────────
// The flight sim's CFIT probe at ground level, on the same geometry the buildings are drawn from.
// Dropped from cockpit.js: the on-ground bail, the visible-window gate (fog would make near walls
// non-solid) and the altitude test. Kept: the sweep, or a fast truck tunnels through a wall.
const SWEEP = 4;
const TRUCK_CLEAR_Z = 0.010;   // cab roof in render world-z (FLOOR_Z is one storey ≈ 0.028)
// TRUCK_STEP_Z (windshield.js) is the height below which a thing is ridden over, such as a kerb.
const BUMP_MPH = 12;           // at or below this it is a bump; above it, you hit something
// Below this the server isn't told: the rebound and jolt say enough.
const REPORT_MPH = 6;

// The jolt on the glass, scaled by impact speed.
function bumpJolt(mph) {
  const wrap = st?.container?.querySelector('.cab-wrap');
  if (!wrap) return;
  if (document.documentElement.getAttribute('data-motion') === 'off') return;
  wrap.classList.remove('cab-jolt', 'cab-jolt-hard');
  void wrap.offsetWidth;                                   // restart the animation
  wrap.classList.add(mph > BUMP_MPH ? 'cab-jolt-hard' : 'cab-jolt');
  setTimeout(() => wrap.classList.remove('cab-jolt', 'cab-jolt-hard'), 620);
  try {
    const d = window.ProceduralSFX?.buildActionCue({
      action: 'impact', surface: mph > BUMP_MPH ? 'metal' : 'plastic',
      intensity: Math.min(1, 0.25 + mph / 60), seed: 1200 + ((mph * 7) | 0),
    });
    if (d) window.AudioEngine?.playSfx(d, Math.min(0.7, 0.2 + mph / 90));
  } catch { /* audio is never load-bearing */ }
}

function obstructionAhead(st) {
  const map = st.map, mc = { x: st.mapX, y: st.mapY };
  if (!map || !map.length) return 0;
  const R = (map.length - 1) / 2;
  const from = st.prev || { x: st.sim.x, y: st.sim.y };
  // The cells round a point, for the South Lock's walls (lockWallZAt). ⚠ Not when the rig starts
  // inside one, so a rig in the doorway at lockdown can back out.
  const near = (x, y) => { const r = map[Math.round(y - mc.y + R)]; return r && r[Math.round(x - mc.x + R)]; };
  const fx = Math.round(from.x), fy = Math.round(from.y);
  const lockAt = groundObstructionAt(fx, fy, null, from.x, from.y, TRUCK_CLEAR_Z, TRUCK_STEP_Z, near) > 0 ? null : near;
  let worst = 0;
  for (let i = 1; i <= SWEEP; i++) {
    const t = i / SWEEP;
    const px = from.x + (st.sim.x - from.x) * t, py = from.y + (st.sim.y - from.y) * t;
    const wx = Math.round(px), wy = Math.round(py);
    // Cheap reject first, as in the flight sweep.
    if (Math.abs(px - wx) > MODEL_MAX_EXTENT * (RENDER_TUNE.bldgFoot || 1)) continue;
    const rx = Math.round(wx - mc.x + R), ry = Math.round(wy - mc.y + R);
    const cell = map[ry] && map[ry][rx];
    if (!cell) continue;
    const z = groundObstructionAt(wx, wy, cell, px, py, TRUCK_CLEAR_Z, TRUCK_STEP_Z, lockAt);
    if (z > worst) worst = z;
  }
  return worst;
}

// A shift as sound: the lever through the gate, then the clutch taking up a beat later.
function shiftCue(half, toNeutral) {
  const A = window.AudioEngine, S = window.ProceduralSFX;
  if (!A || !S) return;
  const cue = (o, gain, delay = 0) => {
    const fire = () => { try { const d = S.buildActionCue(o); if (d) A.playSfx(d, gain); } catch { /* never load-bearing */ } };
    if (delay) setTimeout(fire, delay); else fire();
  };
  const seed = 3300 + ((performance.now() | 0) % 997);
  cue({ action: 'impact', surface: 'metal', intensity: half ? 0.28 : 0.5, seed }, half ? 0.16 : 0.3);
  // Into neutral the clutch never bites, so no second half.
  if (!toNeutral) cue({ action: 'impact', surface: 'rubber', intensity: half ? 0.2 : 0.36, seed: seed + 41 }, half ? 0.12 : 0.22, half ? 90 : 150);
}

// A missed shift: overlapping metal scrapes and a knock. Deliberately the loudest thing the box does.
function grindCue() {
  const A = window.AudioEngine, S = window.ProceduralSFX;
  if (!A || !S) return;
  const cue = (o, gain, delay = 0) => {
    const fire = () => { try { const d = S.buildActionCue(o); if (d) A.playSfx(d, gain); } catch { /* never load-bearing */ } };
    if (delay) setTimeout(fire, delay); else fire();
  };
  const seed = 7700 + ((performance.now() | 0) % 991);
  cue({ action: 'scrape', surface: 'metal', intensity: 0.95, seed }, 0.55);
  cue({ action: 'scrape', surface: 'metal', intensity: 0.7, seed: seed + 37 }, 0.34, 60);
  cue({ action: 'impact', surface: 'metal', intensity: 0.45, seed: seed + 71 }, 0.22, 30);
}

// The key: a switch click, plus a cold starter churn when turning on. Whether it catches is the model's call.
function keyCue(on) {
  const A = window.AudioEngine, S = window.ProceduralSFX;
  if (!A || !S) return;
  const cue = (o, gain, delay = 0) => {
    const fire = () => { try { const d = S.buildActionCue(o); if (d) A.playSfx(d, gain); } catch { /* never load-bearing */ } };
    if (delay) setTimeout(fire, delay); else fire();
  };
  const seed = 5100 + ((performance.now() | 0) % 983);
  cue({ action: 'impact', surface: 'metal', intensity: 0.22, seed }, 0.18);
  if (on) cue({ action: 'scrape', surface: 'metal', intensity: 0.5, seed: seed + 19 }, 0.26, 90);
}

// The hitch knob shows when there's something to do with the fifth wheel, driven by the server's
// 'hitchable' (state.js), never a client guess at distance.
function paintHitchBtn(st) {
  const el = st?.container?.querySelector('.cab-hitchbtn');
  if (!el) return;
  const coupled = !!st.sim?.hitched;
  const target = st.hitchable;
  const show = coupled || !!target;
  el.hidden = !show;
  if (!show) return;
  // Coupled is the knob pushed in; the stamped word is the action, not the state.
  const w = el.querySelector('.cab-knobface em');
  if (w) w.textContent = coupled ? 'PULL' : 'PUSH';
  el.classList.toggle('out', !coupled);
  el.setAttribute('aria-label', coupled ? 'Trailer air supply: pull to release' : 'Trailer air supply: push to couple');
  el.setAttribute('title', coupled
    ? 'Pull the air supply and drop the trailer here (unhitch)'
    : `Push the air supply in and couple to ${target?.name || 'the trailer'} (hitch)`);
}

// The pump handle shows only with a pump under the nose, room in the tank and money for a splash.
function paintPumpBtn(st) {
  const el = st?.container?.querySelector('.cab-pumpbtn');
  if (!el) return;
  const p = st.pump;
  const room = 1 - (st.fuel ?? 1);
  const show = !!p && room > 0.02 && (p.credits || 0) >= Math.round((p.full || 380) * 0.01);
  el.hidden = !show;
  if (!show) return;
  // The tooltip is the price board; the readout while held is the meter.
  el.setAttribute('title', `Diesel: ${p.full}₵ a tank, ${Math.round(room * p.full)}₵ to fill this one.`
    + ` HOLD the handle: it fills while you hold it and charges you when you let go.`);
  el.setAttribute('aria-label', `Fuel pump: hold to fill, ${Math.round(room * p.full)} credits for a full tank`);
}

// ── THE GLASS FUEL GAUGE ─────────────────────────────────────────────────────
// Painted from the same 'st.fuel' as the dash dial and the pump. Always up outside the cab; inside,
// only at a pump or under reserve.
function paintFuelGauge(st) {
  const el = st?.container?.querySelector('.cab-fuel');
  if (!el) return;
  const f = Math.max(0, Math.min(1, st.dry ? 0 : (st.fuel ?? 1)));
  const low = f < 0.15;
  const want = st.external || st.pumping || !!st.pump || low;
  if (el.hidden !== !want) el.hidden = !want;
  if (!want) return;
  el.classList.toggle('low', low && f > 0);
  el.classList.toggle('dry', f <= 0);
  el.classList.toggle('pumping', !!st.pumping);
  const pct = Math.round(f * 100);
  const q = (s, v) => { const n = el.querySelector(s); if (n && n.textContent !== v) n.textContent = v; };
  q('.cab-fuel-pct', `${pct}%`);
  const fill = el.querySelector('.cab-fuel-fill');
  if (fill) fill.style.width = `${(f * 100).toFixed(1)}%`;
  // Two decimals, to match the pylon price ('each' on the fuel.prices row).
  const p = st.pump;
  q('.cab-fuel-note', st.pumping && p ? `${(p.full / 100).toFixed(2)}/%`
    : p ? `${Math.round((1 - f) * p.full)}₵ to fill` : low ? 'RESERVE' : '');
  el.setAttribute('aria-label', `Fuel ${pct} percent${low ? ', reserve' : ''}`);
}

// ── THE PERSON IN THE SEAT ───────────────────────────────────────────────────
// Read from 'gameState.player', which every player_update and resource_tick already updates: no
// request. Red is 0, where the resource tick starts taking HP (gameLoop.js).
const VIT_AMBER = 25;
function vitalsNow() {
  const pl = gameState?.player;
  if (!pl) return null;
  return {
    hunger: Math.max(0, Math.min(100, Number(pl.hunger ?? 100))),
    thirst: Math.max(0, Math.min(100, Number(pl.thirst ?? 100))),
  };
}
function paintVitBand(st) {
  const el = st?.container?.querySelector('.cab-vitband');
  if (!el) return;
  const v = vitalsNow();
  if (!v) { el.hidden = true; return; }
  // Thirst first: it kills twice as fast.
  const rows = [];
  if (v.thirst <= VIT_AMBER) rows.push({ w: 'THIRST', dead: v.thirst === 0 });
  if (v.hunger <= VIT_AMBER) rows.push({ w: 'HUNGER', dead: v.hunger === 0 });
  if (!rows.length) { el.hidden = true; el.textContent = ''; return; }
  const txt = rows.map(r => r.w).join('  ·  ');
  el.hidden = false;
  // ⚠ Written only on change: it's an aria-live region, and identical rewrites get re-announced.
  if (el.textContent !== txt) el.textContent = txt;
  el.classList.toggle('bad', rows.some(r => r.dead));
}
// The flap's bars: the same two numbers as figures.
function paintGalleyVitals(st) {
  const el = st?.container?.querySelector('.cab-galley');
  if (!el || el.hidden) return;
  const v = vitalsNow();
  if (!v) return;
  for (const k of ['hunger', 'thirst']) {
    const bar = el.querySelector('[data-v="' + k + '"]'), num = el.querySelector('[data-p="' + k + '"]');
    if (bar) { bar.style.width = v[k] + '%'; bar.className = v[k] === 0 ? 'bad' : v[k] <= VIT_AMBER ? 'low' : ''; }
    if (num) { const t = Math.round(v[k]) + '%'; if (num.textContent !== t) num.textContent = t; }
  }
}
// One button per row, sending the exact verb string the log printed.
function renderGalley(st, msg) {
  const el = st?.container?.querySelector('.cab-galley');
  if (!el) return;
  const body = el.querySelector('.cab-galley-body');
  const items = msg?.items || [];
  if (!items.length) {
    body.innerHTML = '<i class="cab-galley-wait">Nothing in the bunk and nothing in the door pockets.</i>';
    return;
  }
  body.innerHTML = items.map(i => {
    const cmd = (i.verb + ' ' + i.name).replace(/"/g, '&quot;');
    // What it's worth, straight off the item's restore tags.
    const gain = [i.food ? '+' + i.food + ' food' : '', i.water ? '+' + i.water + ' water' : ''].filter(Boolean).join('  ');
    const qty = i.qty > 1 ? ' ×' + i.qty : '';
    return '<button class="cab-galley-item" data-cmd="' + cmd + '">'
      + '<b>' + i.verb.toUpperCase() + '</b>'
      + '<span>' + i.name + qty + '</span>'
      + '<em>' + gain + '</em></button>';
  }).join('');
  paintGalleyVitals(st);
}
// The hitcher card. It shows what the roadside can tell you, never what they'll do (hitchers.js).
const HITCH_LOOK = {
  mechanic: 'Somebody sitting on a toolbox, back to the wind.',
  local: 'A man in a coat two sizes too big, watching the road.',
  chancer: 'Somebody young, a bag held between their feet.',
  fugitive: "A thin figure who hasn't looked at the road behind them once.",
};
function paintHitchAlert(st) {
  const el = st?.container?.querySelector('.cab-hitchalert');
  if (!el) return;
  const hh = st.hitcher;
  if (!hh) { if (!el.hidden) { el.hidden = true; el.innerHTML = ''; el.dataset.tok = ''; } return; }
  // ⚠ Keyed on the person and the latch, or locking up leaves a card saying the doors are open.
  const key = hh.t + (st.locked ? '|L' : '|O');
  if (el.dataset.tok === key) return;       // never rebuild under a hand
  el.dataset.tok = key;
  el.hidden = false;
  // Says what the door is doing, as a fact, never a warning.
  el.innerHTML = '<b>ON THE SHOULDER</b>'
    + '<span>' + (HITCH_LOOK[hh.kind] || 'Somebody with a hand out.') + '</span>'
    + '<em>' + (st.locked
        ? "Doors latched. Stopping isn't enough, pick them up if you mean to."
        : 'Doors are open. Stop for a moment and they will get in by themselves.') + '</em>'
    + '<button class="cab-hitch-go">PICK UP</button>';
}

// The door latch reads the state you're in. The server owns it (per truck, and the 'lock' verb), so
// this paints 'st.locked' and never toggles locally.
function paintLatch(st) {
  const el = st?.container?.querySelector('.cab-latchbtn');
  if (!el) return;
  const locked = !!st.locked;
  el.classList.toggle('on', locked);
  el.setAttribute('aria-pressed', locked ? 'true' : 'false');
  // ⚠ Write the legend span, never textContent on the rocker, which would delete the switch.
  const legend = el.querySelector('u span') || el;
  const txt = locked ? 'LOCKED' : 'OPEN';
  if (legend.textContent !== txt) legend.textContent = txt;
  el.title = locked
    ? 'Cab doors are latched. Nobody gets in (Y)'
    : 'Cab doors are open. Stop beside somebody and they can let themselves in (Y)';
  el.setAttribute('aria-label', locked ? 'Cab doors locked' : 'Cab doors unlocked');
}

// ── THE PUMP, AS A SOUND ─────────────────────────────────────────────────────
// ⚠ The generator has no sustain, so the flow is a short 'pour' re-fired on the needle's own 50ms
// tick (no second timer to leak). The generator's jitter keeps it from sounding like a stuck loop.
const PUMP_FLOW_MS = 380;
function pumpFlowCue(seed) {
  const A = window.AudioEngine, S = window.ProceduralSFX;
  if (!A || !S) return;
  try {
    const flow = S.buildActionCue({ action: 'pour', material: 'liquid', flow: 0.42, intensity: 0.5, seed });
    if (flow) A.playSfx(flow, 0.16);
    // The pump motor under the rush, giving the flow a pulse.
    const motor = S.buildActionCue({ action: 'impact', surface: 'metal', intensity: 0.12, seed: seed + 17 });
    if (motor) A.playSfx(motor, 0.07);
  } catch { /* audio is never load-bearing */ }
}
// The nozzle going in, and the handle clicking off.
function pumpEndCue(kind) {
  const A = window.AudioEngine, S = window.ProceduralSFX;
  if (!A || !S) return;
  try {
    const d = S.buildActionCue({ action: kind === 'start' ? 'impact' : 'lock', surface: 'metal',
      state: 'click', intensity: kind === 'start' ? 0.3 : 0.45, seed: 4400 + (kind === 'start' ? 0 : 61) });
    if (d) A.playSfx(d, kind === 'start' ? 0.2 : 0.3);
  } catch { /* audio is never load-bearing */ }
}

function drawRigOverlay(st, r) {
  if (!(r.hitched && r.folding)) return;
  const cv = document.getElementById(st.id);
  if (!cv || !cv.getContext || !cv.clientWidth) return;
  const g = cv.getContext('2d');
  const k = cv.width / cv.clientWidth;
  const W = cv.clientWidth, H = cv.clientHeight;
  g.save();
  g.setTransform(k, 0, 0, k, 0, 0);
  g.fillStyle = '#d2603f';
  g.font = `700 ${Math.max(10, Math.min(W, H) * 0.028) | 0}px 'DejaVu Sans Mono',monospace`;
  g.textAlign = 'center';
  g.fillText('JACKKNIFING', W / 2, H * 0.16);
  g.restore();
}

// ── THE ROAD, ON THE GLASS AND IN THE AIR ────────────────────────────────────
// The dust the wheels throw now, and the film it has left on the windscreen. Drawn, not simulated.
// ⚠ Specks are hashed from their index and move on a clock, never Math.random per frame.
// ⚠ The film never hides a contact: it's capped at FILM_MAX on the outer frame.
const FILM_MAX = 0.30;
// Loose material per surface, in the server's 'surfaceUnder' vocabulary. Tarmac throws some grit.
const DUST_SURFACE = { road: 0.22, dirt: 0.8, shoulder: 0.95, offroad: 1 };
// Rain kills the plume but never clears the film (RAIN_FLOOR in filth.js).
const DUST_WET = { rain: 0.1, storm: 0.05, snow: 0.15 };
const hash1 = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function drawRoadFilm(st, dt) {
  const cv = document.getElementById(st.id);
  if (!cv || !cv.getContext || !cv.clientWidth) return;
  const grime = Math.max(0, Math.min(1, st.grime || 0));

  // How hard the wheels work the ground: speed against a nominal motorway, so every truck throws the same at the same speed.
  const mph = Math.abs(st.sim?.speed || 0);
  const roll = Math.min(1, mph / 55);
  const loose = DUST_SURFACE[st.input?.surface] ?? DUST_SURFACE.road;
  const wet = DUST_WET[st.weather] ?? 1;
  // The last third of the throttle digs harder (squared).
  const dig = 1 + 0.5 * Math.pow(st.input?.throttle || 0, 2);
  const want = Math.min(1, roll * loose * wet * dig);
  // The plume lags both ways, or it strobes with the throttle.
  const k = Math.min(1, (dt || 0.016) * 2.4);
  st.dust = (st.dust || 0) + (want - (st.dust || 0)) * k;
  const dust = st.dust;

  // Wipers thin the film but never clear it: a dry blade smears.
  const wipe = 1 - 0.22 * Math.min(3, st.wipers | 0) / 3;
  const film = Math.min(FILM_MAX, grime * 0.34) * wipe;
  if (film < 0.004 && dust < 0.01) return;

  const g = cv.getContext('2d');
  const kx = cv.width / cv.clientWidth;
  const W = cv.clientWidth, H = cv.clientHeight;
  g.save();
  g.setTransform(kx, 0, 0, kx, 0, 0);

  // ── THE FILM ──
  // Heaviest at the corners and the bottom edge, so it reads as on the glass.
  if (film > 0.004) {
    const rad = g.createRadialGradient(W * 0.5, H * 0.46, Math.min(W, H) * 0.18, W * 0.5, H * 0.5, Math.max(W, H) * 0.72);
    rad.addColorStop(0, 'rgba(126,106,74,0)');
    rad.addColorStop(0.62, 'rgba(126,106,74,' + (film * 0.5).toFixed(3) + ')');
    rad.addColorStop(1, 'rgba(108,90,62,' + film.toFixed(3) + ')');
    g.fillStyle = rad; g.fillRect(0, 0, W, H);
    const lin = g.createLinearGradient(0, H, 0, H * 0.72);
    lin.addColorStop(0, 'rgba(96,80,56,' + (film * 1.25).toFixed(3) + ')');
    lin.addColorStop(1, 'rgba(96,80,56,0)');
    g.fillStyle = lin; g.fillRect(0, H * 0.72, W, H * 0.28);
  }

  // ── THE PLUME ──
  // A veil off each bottom corner: a pair reads as wheels, one band as fog.
  if (dust > 0.01) {
    const a = dust * (0.10 + 0.16 * loose);
    for (const sx of [0.13, 0.87]) {
      const r = g.createRadialGradient(W * sx, H * 1.02, 0, W * sx, H * 1.02, Math.min(W, H) * (0.42 + 0.2 * dust));
      r.addColorStop(0, 'rgba(158,134,96,' + (a * 1.4).toFixed(3) + ')');
      r.addColorStop(0.5, 'rgba(150,126,90,' + (a * 0.55).toFixed(3) + ')');
      r.addColorStop(1, 'rgba(150,126,90,0)');
      g.fillStyle = r; g.fillRect(0, H * 0.5, W, H * 0.5);
    }
    // The grit: streaks, scaled with the plume, so an idling truck draws none.
    const n = Math.round(dust * 46);
    const t = performance.now() / 1000;
    g.strokeStyle = 'rgba(196,172,132,' + (0.10 + 0.30 * dust).toFixed(3) + ')';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      // Each speck owns a lane, lifetime and phase, rising off the wheel.
      const life = 0.5 + hash1(i * 3.1) * 0.9;
      const ph = (t / life + hash1(i * 7.7)) % 1;
      const lane = hash1(i * 5.3);
      // Pushed to the edges, away from the part of the glass you look through.
      const x = W * (lane < 0.5 ? lane * 0.44 : 0.56 + (lane - 0.5) * 0.88);
      const y = H * (1.02 - ph * (0.34 + 0.26 * dust));
      const len = 3 + 16 * ph * dust;
      g.moveTo(x, y); g.lineTo(x + (x < W / 2 ? -2 : 2) * ph, y - len);
    }
    g.stroke();
  }
  g.restore();
}

// ── THE AUTOMATIC'S HAND ─────────────────────────────────────────────────────
// A shift is four beats: dip, out to neutral, into the slot, clutch up. Each writes the player's own
// controls (see setAuto). ⚠ The release beat lets the pedal up only if no hand or latch holds it.
const SHIFT_DIP = 0.16;      // s: the pedal going in before the lever moves
const SHIFT_OUT = 0.20;      // s: sat in neutral (the visible pause)
const SHIFT_IN = 0.22;       // s: across the gate into the new slot
const SHIFT_COOL = 0.45;     // s: before it considers another shift
// ⚠ Below SAVE_RPM the overrun rule ("never downshift off the throttle") stops applying, or the
// automatic rides top gear down to a stall when braking. Below band[0] (0.42), a ratio step above STALL_RPM.
const SAVE_RPM = 0.26;
function autoShift(dt) {
  const seq = st.shiftSeq;
  if (seq) {
    seq.t += dt;
    if (seq.phase === 'dip') {
      st.input.clutch = 1;                       // the pedal itself; the model reads this
      if (seq.t >= SHIFT_DIP) { seq.phase = 'out'; seq.t = 0; st.selectGear?.(0); }
    } else if (seq.phase === 'out') {
      st.input.clutch = 1;
      if (seq.t >= SHIFT_OUT) { seq.phase = 'in'; seq.t = 0; st.selectGear?.(seq.to); }
    } else if (seq.phase === 'in') {
      st.input.clutch = 1;
      if (seq.t >= SHIFT_IN) { seq.phase = 'up'; seq.t = 0; }
    } else {
      // Let it up, unless a hand is on it.
      if (!st.heldBy?.clutch && !st.clutchLatched) st.input.clutch = 0;
      st.shiftSeq = null;
      st.shiftCool = SHIFT_COOL;
    }
    return;
  }
  if (st.shiftCool > 0) st.shiftCool -= dt;
  if (!st.auto || !P) return;
  // Reverse and the park brake suspend the automatic, never switch it off; both clear themselves.
  if (st.dry || st.broken || st.sim.stalled || st.sim.gear < 0 || st.park) return;
  // ⚠ The cooldown gates a decision, never a rescue: under SAVE_RPM it doesn't pause between grabs,
  // or a braking chain arrives late and stalls.
  const saving = (st.sim.rpm || 0) < SAVE_RPM && st.sim.gear > 1;
  if (st.shiftCool > 0 && !saving) return;
  // ⚠ The target is bestGear, the same answer the dash prints, so the light and the hand agree.
  const want = bestGear(st.sim.speed, P);
  // Pulling away from neutral on the throttle: first at a standstill.
  if (st.sim.gear === 0) {
    if ((st.input.throttle || 0) > 0.05) beginShift(Math.abs(st.sim.speed) < 2.8 ? 1 : want);
    return;
  }
  if (want === st.sim.gear) return;
  // One gear at a time, so the process shows.
  const step1 = want > st.sim.gear ? st.sim.gear + 1 : st.sim.gear - 1;
  if (step1 < 1) return;
  // ...and only once the revs agree ('band' is the dash's IN BAND pair), or it hunts.
  const [lo, hi] = P.band || [0.55, 0.8];
  const rpm = st.sim.rpm || 0;                    // fraction of redline
  // ⚠ An upshift can't wait for the top of the band: a truck often plateaus just under 'hi', which
  // stranded the top ratios. So also shift when the next gear will still pull ('rpmNext >= lo').
  if (step1 > st.sim.gear) {
    const rpmNext = rpm * (P.gears[step1] / P.gears[st.sim.gear]);
    if (rpm > hi || rpmNext >= lo) beginShift(step1);
    return;
  }
  // Never downshift on the overrun, unless the engine is out of room (saving).
  if (saving || (rpm < lo && (st.input.throttle || 0) > 0.15)) beginShift(step1);
}
// The automatic clutch: never while a human has the pedal or a shift is running. It dips after a
// shift (autoDip), holds in at a stop in gear and while stalled, and otherwise lets the model's
// launch slip feather it.
function autoClutchStep(dt) {
  if (!st.autoClutch || st.shiftSeq) return;
  if (st.heldBy?.clutch || st.clutchLatched) { st.autoDip = 0; return; }
  if (st.autoDip > 0) { st.autoDip -= dt; st.input.clutch = 1; return; }
  const idle = st.sim.gear !== 0 && (st.sim.stalled
    || ((st.input.throttle || 0) < 0.05 && (st.sim.rpm || 0) < 0.2));
  st.input.clutch = idle ? 1 : 0;
}
function beginShift(to) {
  st.shiftSeq = { to, phase: 'dip', t: 0 };
}

function frame(now) {
  if (!st) return;
  const dt = Math.max(0, Math.min(0.1, (now - st.last) / 1000));
  st.last = now;
  // Profile phases use the cockpit's names so profiles compare. 'frame' closes after the catch.
  perfBegin('frame');
  try {
    st.prev = { x: st.sim.x, y: st.sim.y };
    // Dry and broken behave the same at the wheel.
    if (st.dry || st.broken) { st.input.throttle = 0; st.sim.rpm = 0; }
    // ── KEY OFF MEANS STOPPED ──────────────────────────────────────────────────
    // The settle brakes through 'st.input' like a foot, so load and surface still decide the stop.
    // ⚠ Keyed on 'st.shutdown', never the stall. Once stopped the residual rates are zeroed.
    if (st.shutdown) {
      st.input.throttle = 0;
      st.input.brake = 1;
      st.input.steer = 0;
      // The trailer settles by itself once the tractor stops; its heading is the model's.
      if (Math.abs(st.sim.speed) < 0.4) { st.sim.speed = 0; st.sim.yawRate = 0; st.sim.slip = 0; }
    }
    // ⚠ Nothing may pin the throttle in a shed: the depot door lifts because you drive at it.
    // ── CRUISE ────────────────────────────────────────────────────────────────
    // ⚠ It writes only 'st.input.throttle', so it has no authority the pedal lacks. Cancelled by
    // the brake, clutch, stall or losing the drive; steering doesn't cancel it.
    if (st.cruise != null) {
      if (st.input.brake > 0 || st.input.clutch > 0 || st.dry || st.broken || st.sim.stalled
        // ⚠ Through 'st.setCruise', the writer that owns the lamp.
        || st.sim.gear <= 0 || Math.abs(st.sim.speed) < 5.5) st.setCruise?.(null);
      else {
        // Proportional and gentle, or a heavy truck surges.
        st.input.throttle = Math.max(0, Math.min(1, (st.cruise - st.sim.speed) * 0.18));
      }
    }
    // The camera steps before the paint, so a held key moves it this frame.
    perfBegin('sim:physics');
    freeCam.step(dt);
    autoShift(dt);
    autoClutchStep(dt);
    // The spring brakes: the last word on the pedal this frame, after cruise and the automatic.
    if (st.park) st.input.brake = 1;
    step(st.sim, st.input, P, dt);
    const r = truckReadout(st.sim, P);
    // ── WHAT IS THROWING THE CAB ABOUT ────────────────────────────────────────
    // G-forces for the cab trinkets (cab-trinkets.js). Lateral is v·ω straight from the sim;
    // longitudinal is a derivative, smoothed one-pole (~0.1 s) or every shift spikes it.
    {
      const MPH_FPS = 1.4667, G_FPS2 = 32.17;
      // ⚠ Signed speed: yawRate already carries direction, so v·ω points the steered way when reversing too.
      const lat = (st.sim.speed * MPH_FPS) * ((st.sim.yawRate || 0) * Math.PI / 180) / G_FPS2;
      const raw = dt > 0 ? ((st.sim.speed - st.geeSpeed) * MPH_FPS / dt) / G_FPS2 : 0;
      st.geeSpeed = st.sim.speed;
      const k = dt > 0 ? Math.min(1, dt / 0.10) : 0;
      // Clamped at 1 g; only the rebound and dropped frames get near it.
      st.gee.lat = Math.max(-1, Math.min(1, st.gee.lat + (lat - st.gee.lat) * k));
      st.gee.lon = Math.max(-1, Math.min(1, st.gee.lon + (raw - st.gee.lon) * k));
    }
    perfEnd();   // sim:physics

    // Solid geometry. The wall pushes back: return to the last clear spot, nudge further back, and
    // roll gently backwards, so the driver can drive out. 'hitCd' is a quiet window afterwards.
    if (st.hitCd > 0) st.hitCd -= dt;
    else if (obstructionAhead(st) > 0) {
      const mph = Math.abs(st.sim.speed);
      const h = st.sim.heading * Math.PI / 180;
      const dirSign = Math.sign(st.sim.speed) || 1;
      st.sim.x = st.prev.x - Math.sin(h) * 0.35 * dirSign;
      st.sim.y = st.prev.y + Math.cos(h) * 0.35 * dirSign;
      // A fifth of the speed, backwards, never more than walking pace.
      st.sim.speed = -dirSign * Math.min(6, mph * 0.2);
      st.sim.yawRate = 0;
      st.sim.brakeTemp = st.sim.brakeTemp || 0;
      // One line per impact worth one; the cooldown makes a scrape down a frontage one incident.
      st.hitCd = mph > BUMP_MPH ? 1.6 : 4.0;
      // Which end met it: only the client knows, and it picks the damaged parts (damage.js impactSplit).
      // Not usefully forgeable: every area routes the same total.
      const area = st.sim.speed < 0 ? 'rear'
        : Math.abs(st.input.steer || 0) > 0.45 ? 'side'
        : 'front';
      if (mph >= REPORT_MPH) sendCmdSilent(`truckevent ${mph > BUMP_MPH ? 'crash' : 'bump'} ${Math.round(mph)} ${area}`);
      bumpJolt(mph);
    }

    const q = (s) => st.container.querySelector(s);
    q('.cab-mph').textContent = r.speed;
    q('.cab-odo').textContent = Math.max(0, Math.round(st.L - st.s));
    // The surface readout says why you're stopped first.
    q('.cab-surface').textContent = st.broken ? 'BROKEN' : st.dry ? 'NO FUEL' : (st.input.surface || 'road').toUpperCase();
    q('.cab-surface').className = 'cab-surface s-' + (st.broken ? 'offroad' : st.input.surface);
    // The controls follow the truck, whatever moved them.
    st.paintGate?.();
    st.paintControls?.();
    // The key's angle is the engine (paintKey).
    st.paintKey?.();
    const gearEl = q('.cab-gear');
    gearEl.textContent = r.stalled ? '—' : r.reversing ? 'R' : (r.gear === 0 ? 'N' : r.gear + (st.sim.split ? '½' : ''));
    gearEl.className = 'cab-gear' + (r.stalled ? ' g-stall' : r.inBand ? ' g-band' : '');
    // The REV lamp is derived from the box, and dims while rolling. ⚠ Use 'q': this is module scope.
    const rev = q('.cab-revbtn');
    if (rev) {
      rev.classList.toggle('on', r.gear < 0);
      rev.setAttribute('aria-pressed', String(r.gear < 0));
      rev.disabled = Math.abs(st.sim.speed) >= 2;
    }
    // ── GETTING OUT ────────────────────────────────────────────────────────────
    // ⚠ Matches the server's PARK_STOPPED_MPH in plugins/trucking/index.js.
    const PARK_SEND_MPH = 0.6;
    const stopped = Math.abs(st.sim.speed) <= PARK_SEND_MPH;
    // The latched pull fires the frame the rig comes to rest (setPark).
    if (st.park && stopped && !st.parkSent) { st.parkSent = true; sendCmdSilent('park'); }
    // The exit button is derived: lit when parked and stopped. It sends the ordinary 'park' verb.
    const exit = q('.cab-exitbtn');
    if (exit) exit.disabled = !(st.park && stopped);
    // BEST (the shift indicator) is a tier privilege; see CAB_KIT.
    const kit = kitFor(P);
    q('.cab-gearhint').textContent = r.stalled ? 'ENGINE OFF · CLUTCH + KEY'
      : kit.best ? `GEAR · BEST ${r.best}` : 'GEAR · , .';
    // The instruments are drawn on the dash in the scene (drawCabInterior); nothing is painted here.

    // Brake temperature is a word. Below tier 2 there's only a warning lamp; FADING always shows.
    const bEl = q('.cab-brakes');
    const bt = r.brakeTemp;
    bEl.textContent = r.fading ? 'FADING'
      : !kit.brakeTemp ? 'OK'
      : bt > 0.42 ? 'HOT' : bt > 0.2 ? 'WARM' : 'COLD';
    bEl.className = 'cab-brakes' + (r.fading ? ' b-fade' : kit.brakeTemp && bt > 0.42 ? ' b-hot' : '');
    // Articulation angle in degrees is the Orlov's alone.
    q('.cab-riginfo').textContent = r.hitched
      ? (r.folding ? 'JACKKNIFING'
        : kit.trailerAngle ? `TRAILER ${r.phi > 0 ? '+' : ''}${r.phi.toFixed(0)}°` : 'TRAILER')
      : 'BOBTAIL';
    q('.cab-riginfo').className = 'cab-riginfo' + (r.folding ? ' b-fade' : '');

    // The gearbox's voice, keyed on 'sim.gear' so every source sounds the same. A split is quieter.
    if (st.sim.gear !== st.lastGear || st.sim.split !== st.lastSplit) {
      const half = st.sim.gear === st.lastGear;        // same gear, splitter moved
      shiftCue(half, st.sim.gear === 0);
      // An ear-only rpm dip for the clutch travel the model doesn't simulate.
      st.rpmDip = half ? 0.06 : 0.14;
      st.lastGear = st.sim.gear; st.lastSplit = st.sim.split;
    }
    if (st.rpmDip > 0) st.rpmDip = Math.max(0, st.rpmDip - dt * 0.9);

    // The engine voice. Throttle is boost ('r.pedal'), so the note rises with the pull. A bay rev
    // (cabRev) needs a faster cadence than 220 ms.
    const kick = revKick(now);
    if (now - st.lastAudio >= (kick > 0 ? 40 : 220)) {
      st.lastAudio = now;
      // The damage bed, from the same payload the gauges read.
      damageBed(st.dmg && Object.fromEntries(DMG_PARTS.map((p) => [p.key, st.dmg[p.key]?.v ?? 1])),
        !st.dry && !st.broken);
      // A dead engine goes silent after the settle (SETTLE_MS, matching the renderer's hoverLift), not at once.
      const dead = st.sim.stalled || st.dry || st.broken;
      if (dead && !st.deadAt) st.deadAt = performance.now();
      else if (!dead && st.deadAt) st.deadAt = 0;
      const SETTLE_MS = 1300;
      updateEngineAudio({
        continuous: true, class: 'truck',
        engineOn: !st.dry && (!dead || performance.now() - st.deadAt < SETTLE_MS),
        airborne: false, onGround: true,
        rpm: Math.min(1, Math.max(0, st.sim.rpm - (st.rpmDip || 0) + kick)), throttle: Math.min(100, (r.pedal + kick * 1.6) * 100), spd: r.speed,
        groundSpeed: r.speed, surface: st.input.surface || 'road',
        cabin: !st.external, weather: st.weather,
      });
      // Boats beside the road, from the same contacts feed. ⚠ A truck's speed is mph, the cockpit's
      // knots; don't convert here.
      updateBoatContacts({ x: st.sim.x, y: st.sim.y, hdg: st.sim.heading || 0, speed: r.speed || 0 },
        st.contacts || []);
    }

    // ── THE MIRRORS, RENDERED ───────────────────────────────────────────────
    // ⚠ Rendered before the forward view, never inside it: from drawCabMirror it would re-enter
    // paintWindshield with the frame's sinks armed and leak geometry into the windscreen. Throttled to REAR_MS.
    if (!st.external && st.map) {
      const nowMs = performance.now();
      if (!st._rearAt || nowMs - st._rearAt > REAR_MS) {
        st._rearAt = nowMs;
        const rc = document.getElementById(st.id + '-rear');
        if (rc && rc.clientWidth) {
          try {
            paintWindshield(st.id + '-rear', {
              cls: 'truck', phase: 'ground', worldBlend: 1, bare: true,
              height: 0, eyeH: 0.12, speed: Math.min(1, Math.abs(st.sim.speed || 0) / 68),
              // ⚠ The rig's heading turned round, never the camera's: a mirror doesn't follow your head.
              heading: ((st.sim.heading || 0) + 180) % 360,
              // A narrow instrument; fovMul scales both focal lengths (makeCam).
              fovMul: 0.62,
              // ⚠ Centre and offset don't move with the slice; the renderer derives its radius from the array.
              map: rearMap(st.map), mapCenter: { x: st.mapX, y: st.mapY },
              mapOffset: { x: st.sim.x - st.mapX, y: st.sim.y - st.mapY },
              hour: st.hour, weather: st.weather, event: st.wxEvent,
              wxField: st.wxField, wxGround: st.wxGround, acX: st.sim.x, acY: st.sim.y,
              roads: st.roads, contacts: contactsFor(st), actors: st.actors, skyline: st.skyline, regions: st.regions,
              landingLight: st.heads, wipers: 0,
            });
            st.rearImg = rc;
          } catch (e) { st.rearImg = null; }   // falls back to the stub
        }
      }
    }
    perfBegin('sim:paint');
    paintWindshield(st.id, {
      rearImg: st.rearImg || null,
      cls: 'truck', phase: 'ground', worldBlend: 1,
      // Never below one backing pixel per CSS pixel (resFloorPx); lane markings must stay sharp.
      resFloor: 0.5, resFloorPx: 1,
      // Supersample up to 2x; it backs off on its own (see paintWindshield).
      superSample: 2,
      // The ground camera's own load-shedding numbers. Only skip-work keys may be set (VIEW_TUNABLE);
      // geometry never, since collision reads it outside the frame.
      tune: CAB_VIEW_TUNE,
      // The one string that decides the shape. '~p' is the parked pose for a dead engine.
      // ⚠ The fitting suffix goes last: the mesh strips from the first '~' or '^', which would eat '+t'.
      variant: TYPE_ID + (r.hitched ? '+t' : '') + (r.stalled ? '~p' : '') + FITS,
      // Lifter wash from rpm, anchored at idle so a running idle rig is already bright.
      // ⚠ IDLE comes from the model; never restate it.
      power: r.stalled ? 0
        : (st.sim.rpm || 0) <= IDLE ? 0.55 * ((st.sim.rpm || 0) / IDLE)
        : 0.55 + 0.45 * Math.min(1, ((st.sim.rpm || 0) - IDLE) / (1 - IDLE)),
      // ⚠ The trailer's own colour wins over 'deck' in every view (server-sent). Grime goes through the
      // one livery conversion (client/shared/truck-livery.js).
      livery: { ...truckLivery(PAINT_PREVIEW || PAINT, st.grime || 0), ...(st.trailer?.colour ? { deck: st.trailer.colour } : {}) },
      // ⚠ Yaw is always the player's; only the height is overridden while dollied in (chaseAmt).
      ...(st.external ? {
        external: true,
        extYaw: st.extYaw,
        extPitch: st.extPitch + (CHASE_PITCH - st.extPitch) * chaseAmt(st.extZoom),
        extZoom: 1.15 * st.extZoom,
      } : {}),
      // No shoulder checks in the chase camera.
      viewYaw: st.external ? 0 : (st.viewYaw || 0),
      // The peek's spring runs here, once a frame, with no timer. Suppressed in the chase camera,
      // where the middle button orbits.
      ...(() => {
        if (st.external) { st.look.x = 0; st.look.y = 0; st.looking = false; st.freeLook = false; return { lookYaw: 0, lookPitch: 0 }; }
        // ⚠ The spring is skipped while latched, never slowed: a slow drift is worse than either.
        if (!st.looking && !st.freeLook) { st.look.x *= CAB_PEEK_DECAY; st.look.y *= CAB_PEEK_DECAY;
          if (Math.abs(st.look.x) < 0.002) st.look.x = 0;
          if (Math.abs(st.look.y) < 0.002) st.look.y = 0; }
        // ⚠ The lean is a head translation, so it isn't scaled with the yaw. In a modelled cab
        // (cockpit3d) the peek gets the full range: there's no painted board to protect.
        return (st.freeLook || RENDER_TUNE.cockpit3d)
          ? { lookYaw: st.look.x * CAB_LOOK_YAW, lookPitch: -st.look.y * CAB_LOOK_PITCH,
              lookLean: { x: st.look.x * 0.14, y: st.look.y * 0.14 } }
          : { lookYaw: st.look.x * CAB_PEEK_YAW, lookPitch: 0, lookLean: { x: st.look.x, y: st.look.y } };
      })(),
      // Off its mount; null otherwise.
      freeCam: freeCam.view(),
      // ⚠ Two speeds: 'speed' is 0..1 of 68 mph for the renderer, 'mph' the real figure.
      // Interior-only eye height and field of view: the chase camera anchors its model against the
      // shared constants. See docs/reference/glass-notes.md#truck-cab-eye-height-and-prop-scale
      ...(st.external ? {} : { eyeH: 0.12, fovMul: 1.22 }),
      // Ground scatter and people scale, sent for both views (it moves only the scatter). Same doc section.
      propMul: 1.75,
      height: 0, speed: r.speed / 68, mph: r.speed,
      // ⚠ Signed, from the sim: readout speed already carries the sign, so never negate on 'reversing'.
      drive: Math.max(-1, Math.min(1, (st.sim.speed || 0) / 68)),
      heading: st.sim.heading, hour: st.hour, weather: st.weather, moon: st.moon, wind: st.wind,
      // The headlight switch; the renderer still decides when a beam is worth drawing.
      landingLight: !!st.heads,
      // The dome lamp stays local. Absent means on, for the turntable and the smoke.
      dome: st.dome !== false,
      // Brake lamps from the same 'st.input.brake' the model reads.
      braking: (st.input.brake || 0) > 0.02 || !!st.park,
      wipers: st.wipers | 0,
      // Which cab is drawn (CAB_TRIM in windshield.js). 'trim' changes surfaces only, never instruments.
      tier: P.tier, trim: TRIM_PREVIEW || TRIM,
      // Cab fittings (cab-trinkets.js) and the g they swing on; local to this renderer.
      cab: CABFITS, gee: st.gee,
      // ⚠ The make is sent from CAB_KIT, never duplicated in windshield.js.
      make: kit.label,
      // ⚠ Send the trailer's absolute heading, not only 'phi': reconstructing it picks a sign, and the wrong one leads the turn.
      hitched: r.hitched, phi: r.phi, trailerHeading: r.trailerHeading,
      rpmFrac: r.rpm / 100, band: P.band, inBand: r.inBand, topSpeed: P.topSpeed,
      // The dash's data is derived here: the renderer must not know what a CAB_KIT is.
      steer: st.wheel?.getLock?.() ?? 0,
      // 'console' means draw the full dash (no shelf on screen), asked of the media every frame.
      // 'ctl' and 'gate' are views of the shelf (CAB_CTL).
      console: !cabTouch(),
      // Feet, straight off 'st.input'.
      pedals: { clutch: st.input.clutch || 0, brake: st.input.brake || 0, throttle: st.input.throttle || 0 },
      ctl: st.ctlCells ? st.ctlCells() : null,
      gate: st.gateView ? st.gateView() : null,
      gearLabel: r.stalled ? '—' : r.reversing ? 'R' : (r.gear === 0 ? 'N' : r.gear + (st.sim.split ? '½' : '')),
      stalled: r.stalled,
      // The lifters run off the engine.
      engineOn: !st.dry && !st.broken,
      fuel: st.dry ? 0 : (st.fuel ?? 1),
      legFrac: st.L ? Math.max(0, Math.min(1, st.s / st.L)) : 0,
      // 'aim' is the server's destKey. ⚠ Miles via the one TILES_PER_MILE, so the dash matches the boards.
      aim: st.aim || null,
      legLeft: st.L ? Math.max(0, (st.L - st.s) / TILES_PER_MILE) : null,
      brakeTemp: r.brakeTemp, fading: r.fading, brakeGauge: kit.brakeTemp,
      lamps: {
        fuel: st.dry || (st.fuel ?? 1) < 0.15,
        brake: r.fading,
        jake: st.input.jake > 0,
        wipe: (st.wipers | 0) > 0,
        trail: r.hitched && r.folding,
        dmg: st.dmg ? Object.values(st.dmg).some((d) => d && d.v < 0.4) : false,
      },
      // Contacts. ⚠ The renderer wants camera-relative {dx, dy, ...}; the server sends world tiles, so
      // contactsFor converts (as the cockpit's contactView does), or nothing ever draws.
      contacts: contactsFor(st),
      map: st.map, mapCenter: { x: st.mapX, y: st.mapY }, roads: st.roads,
      actors: st.actors,   // people on the pavement
      roadside: st.hitcher || null,   // the hitcher on the void road's shoulder
      mapOffset: { x: st.sim.x - st.mapX, y: st.sim.y - st.mapY },
      // 'wxField' drives the local cells and precipitation; 'event' outranks 'weather' visually.
      acX: st.sim.x, acY: st.sim.y,
      wxField: st.wxField, wxGround: st.wxGround, event: st.wxEvent,
      // The nav head is a screen, so the EMP kills it.
      elecOut: !!st.elecOut,
    });
    // Taken now, because the mirror's bare pass clears the renderer's copy.
    st.hot = st.external || freeCam.active ? null : interiorHotspots();
    // Only what the renderer can't know.
    if (st.external) { st.tier = P.tier; drawRigOverlay(st, r); }
    // After the world and the rig, on the same canvas.
    drawRoadFilm(st, dt);
    perfEnd();   // sim:paint

    // ── THE DRIVER, FOUR TIMES A SECOND ────────────────────────────────────
    // A throttled poll; both painters bail on unchanged text.
    if (now - (st.vitAt || 0) > 250) {
      st.vitAt = now;
      paintVitBand(st);
      paintGalleyVitals(st);
    }

    // Fast while rolling, heartbeat when stopped.
    const rolling = Math.abs(st.sim.speed) >= 0.5;
    // The rolling/stopped edge is sent at once, or the
    // server keeps a stale speed and 'park' refuses. ⚠ Inside MIN_SYNC_MS the server drops the packet
    // unread, so 'lastSync' is left alone and the next frame retries.
    const edge = rolling !== st.wasRolling;
    if (edge && now - st.lastSync < MIN_SYNC_MS) { /* too soon to be heard: retry next frame */ }
    else if (edge || now - st.lastSync >= (rolling ? SYNC_MS : IDLE_SYNC_MS)) {
      st.wasRolling = rolling;
      st.lastSync = now;
      // Packed in cmdTruckSync's order: s, ignition (1 running, 0 key off), hdg, spd, x, y, lamps.
      // The server derives the odometer from position; never send a distance. Lamps bitfield: bit 0
      // headlights, bit 1 brake lamps.
      sendCmdSilent(`trucksync ${st.s.toFixed(2)} ${st.sim.stalled ? 0 : 1} ${Math.round(st.sim.heading)} ${Math.round(st.sim.speed)} ${st.sim.x.toFixed(3)} ${st.sim.y.toFixed(3)} ${(st.heads ? 1 : 0) | (((st.input.brake || 0) > 0.02 || st.park) ? 2 : 0)}`);
    }
  } catch (e) {
    // The renderer has no try/catch; one bad frame mustn't kill the loop.
    if (!st._errLogged) { console.error('[cab] frame error (view kept alive — report this stack):', e); st._errLogged = true; }
  }
  perfEnd();    // frame
  perfTick();   // prints + resets on a 2s window
  st.raf = requestAnimationFrame(frame);
}

// The two server lists in the renderer's frame: world tiles in, offsets from the truck out. Moving
// contacts are dead-reckoned by the shared track (world-feed.js). Rigs get ROAD_RIG_MUL via
// 'sizeMul', which reaches the draw, ground anchor and occlusion together.
function contactsFor(st) {
  const ax = st.sim.x, ay = st.sim.y;
  const out = st.contactTrack ? st.contactTrack.frame(ax, ay, { roadRig: ROAD_RIG_MUL }) : [];
  for (const c of st.trailers || []) {
    const dx = c.x - ax, dy = c.y - ay;
    // A box rests on the tarmac.
    out.push({ ...c, dx, dy, rng: Math.hypot(dx, dy), sizeMul: (c.sizeMul || 1) * (c.cls === 'truck' ? ROAD_RIG_MUL : 1),
      groundZ: 0, altDiff: 0 });
  }
  return out;
}

function ensureCabStyles() {
  if (document.getElementById('cab-styles')) return;
  const s = document.createElement('style');
  s.id = 'cab-styles';
  s.textContent = CAB_CSS.split('__TOUCH_MQ__').join(TOUCH_MQ);
  document.head.appendChild(s);
}

export function closeCab() {
  if (!st) return;
  PAINT_PREVIEW = null; TRIM_PREVIEW = null;
  // The immersive layouts are the page's; nothing else takes them down.
  document.body.classList.remove('cab-fullscreen', 'cab-hidepanel');
  exitBigScreen();
  window.dispatchEvent(new Event('pane:released'));
  // The camera holds a key set; a dismount mid-key would latch it for the next drive.
  freeCam.close();
  st.freeCamUnbind?.(); st.freeCamUnbind = null;
  freeIdle?.unbind(); freeIdle = null;
  st.freeHold = null;
  suppressWeatherFx(false, 'cab');
  cancelAnimationFrame(st.raf);
  stopEngineAudio(); stopBoatContacts();
  stopDamageBed();
  removeEventListener('keydown', st.onKey);
  removeEventListener('keyup', st.onKey);
  endSeatKeyboard(st.cabWrap);
  // Window and document hooks would stack on the next drive.
  if (st.onWinBlur) removeEventListener('blur', st.onWinBlur);
  if (st.onVisibility) document.removeEventListener('visibilitychange', st.onVisibility);
  // The pedals' and buttons' window releases, likewise.
  (st.winOff || []).forEach((off) => removeEventListener('pointerup', off));
  st.shelfRO?.disconnect?.();
  st.wheel?.destroy?.();
  // The radio's own state survives, for the log rung.
  st.cbWidget?.dispose?.();
  disposeWindshield(st.id);
  // The rear camera has its own GL context.
  disposeWindshield(st.id + '-rear');
  st.container.innerHTML = '';
  st = null;
}
