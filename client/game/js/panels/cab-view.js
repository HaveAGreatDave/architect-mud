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
import { CAB_VIEW_TUNE } from '../../../shared/cab-render-tune.js';   // this view's own load-shedding numbers — see that file for why they are not RENDER_TUNE's
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
    auto: autoPref(),   // automatic shifting — a hand on the lever, never a different gearbox
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
    el.addEventListener('blur', () => off());          // tabbed away mid-press — nothing else releases it
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
  //
  // The cab listens on the WINDOW and steps aside for a focused text field (see st.onKey), which is
  // correct and which is also how a driver ends up typing "aaazzzxc" into the command bar without
  // ever finding out: the bar is three inches under the windscreen, it is where every other part of
  // this game wants focus, and nothing about a truck ever asked for it back.
  //
  // So the cab TAKES it — once on mount, and again on any press inside the pane — and says so on
  // the glass. Nothing is trapped: clicking the command bar gives it straight back, because a
  // driver who wants to say something to the room must be able to, and the tag flips to tell them
  // the keys went with it.
  //
  // ⚠ THAT IS ALL SHARED NOW (seat-keys.js), AND IT WAS A DOZEN LINES IN THREE PLACES. The flight
  // sim and the charter cabin each carried their own copy of it and the wheelhouse and free look
  // carried none, so two of the five seats simply never took the keyboard. Moving it also fixed a
  // fault every copy had: this bound on the BUBBLE, and `bindFreeCamPointer` stops a pointerdown
  // dead on the capture phase of the glass inside this pane — so with the camera off its mount,
  // clicking the picture stopped handing the keys back, in the one mode where the keys are the
  // whole control scheme.
  //
  // The chip stays the cab's own: it is placed against the shelf and hides its quiet half on a
  // touch screen, and both of those are judgements about a truck rather than about seats.
  st.cabWrap = container.querySelector('.cab-wrap');
  claimSeatKeyboard(st.cabWrap, { label: 'CAB', tag: container.querySelector('.cab-focustag') });
  touchWipers(st);   // before the paint: st.paintWipers isn't assigned yet this early in the mount
  paintWipers();

  // ── THE GATE ───────────────────────────────────────────────────────────────
  //
  // THE SLOT TABLE IS THE WHOLE THING. Positions are in the plate's own 0..1 space so the gate can
  // be any size on any screen, and `slot` is the position IN THE RANGE (1-4) rather than a gear —
  // the gear is `slot + range*4`, which is the one line that makes this a tree instead of eight
  // hard-coded holes and is why adding a nine-speed later is a number, not a layout.
  const GATE = CAB_GATE;
  const gearOfSlot = (s) => (s.gear != null ? s.gear : s.slot + (st.range ? 4 : 0));
  // Where the knob SITS when nobody is holding it: the slot the box is actually in. A gate that did
  // not do this would be a control that forgets what it did, which is the one thing a gearstick is
  // incapable of.
  const slotOfGear = (g) => GATE.find((s) => gearOfSlot(s) === g) || null;
  {
    const gate = container.querySelector('.cab-gate');
    const lever = container.querySelector('.cab-lever');
    const rangeBtn = container.querySelector('.cab-range');
    let drag = null;
    // WHERE THE LEVER IS ROOTED. Below the plate and on the left rail's line — the floor of the cab
    // is off the bottom of this box, and a stick that pivoted at the middle of the gate would lean
    // the wrong way in the top half. In gate fractions, so it moves with the plate at every size.
    // ── HOW FAR THE KNOB IS FROM THE SLOT ─────────────────────────────────────
    // The rod is a fixed length at a fixed lean, so the knob sits at a constant offset above the
    // point the lever passes through the gate. These two numbers ARE that offset, and they are the
    // only reason the drag needs to know the stick exists: your hand is on the knob, and the thing
    // being positioned is the base. Without the correction the slot snaps up to the pointer and the
    // lever ends up a stick-length above wherever you meant to put it — which reads as the gate
    // being mis-aligned rather than as the grab being offset.
    // ⚠ THE CSS TAKES ITS LENGTH FROM HERE (`--cab-stick`, set on the gate at mount), so there is
    // one number rather than a constant in a stylesheet and a matching guess in a handler.
    const STICK_PX = 34, LEAN_DEG = -7;
    const KNOB_DX = Math.sin(LEAN_DEG * Math.PI / 180) * STICK_PX;
    const KNOB_DY = -Math.cos(LEAN_DEG * Math.PI / 180) * STICK_PX;
    gate.style.setProperty('--cab-stick', STICK_PX + 'px');
    // Nothing but the two fractions now. The stick and the knob are children of this point, so they
    // come with it — there is no second geometry to keep in step and no rect to measure.
    const put = (x, y) => {
      lever.style.setProperty('--gx', x.toFixed(3));
      lever.style.setProperty('--gy', y.toFixed(3));
      // …and the painted gate draws the knob at the same point. ⚠ HERE RATHER THAN IN 'glide', so
      // a DRAG publishes it too — a hand on the shelf's lever moves the painted one, which is the
      // whole claim that there is one gearbox rather than two pictures of one.
      st.gatePos = { x, y };
    };
    // What the painted gate is handed: the slot table in its own 0..1 space, labelled from the
    // range the way the plate's own slots are, and where the knob is right now. The renderer
    // derives its rails from the points, so a nine-speed box is a row in CAB_GATE and nothing at
    // all in windshield.js.
    st.gateView = () => ({
      pts: GATE.map((g) => ({ x: g.x, y: g.y, label: g.label || String(gearOfSlot(g)) })),
      at: st.gatePos || { x: 0.38, y: 0.50 },
      range: !!st.range,
      knob: st.knob || 'ball',
    });
    // ── THE LEVER MOVES, IT DOES NOT TELEPORT ─────────────────────────────────
    // Every shift used to write the new slot straight onto the element, which is right for a hand
    // (yours was already there) and wrong for the automatic, whose whole justification is that you
    // can watch it work. So the knob is eased toward wherever it is supposed to be, and because it
    // eases toward the SLOT rather than along an authored path, an auto shift crosses the gate the
    // way the gate is shaped: out through neutral, then over, because the sequence parks it in
    // neutral for a beat on the way (see autoShift).
    //
    // ⚠ NEVER WHILE A HAND IS ON IT. A drag writes the position every pointermove, and easing that
    // would put the knob a frame behind the pointer — the one place a lag is unmistakable.
    // ⚠ AND IT SNAPS ON THE FIRST PAINT, or the lever slides in from the corner of the plate every
    // time the cab is mounted, which reads as the truck arriving with the stick in the wrong place.
    let at = null, lastPut = 0;
    const GLIDE_SPEED = 6.5;   // gate fractions a second — the crossgate is ~0.1 s, a whole H ~0.25 s
    const glide = (x, y) => {
      const now = performance.now();
      const dt = at ? Math.min(0.1, (now - lastPut) / 1000) : 0;
      lastPut = now;
      if (!at) { at = { x, y }; put(x, y); return; }
      // ALONG THE RAILS, never across them. A straight-line ease cut the corner from 4 to 5 through
      // the plate between the slots, which is the one move a gate physically forbids. So the knob
      // walks the channel network at a constant speed: along its own rail to the crossgate, across,
      // then into the slot — and an auto shift is visibly a stick moving through each position on
      // the way. Same column (1 to 2, or N to itself) is one straight run.
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
    // Rest the knob wherever the box is. Called on every frame's readout paint (see paintGate) so a
    // shift from ANY source — the keys, the ▲▼ buttons, the splitter — moves the lever too.
    // THE SLOTS ARE LABELLED FROM THE RANGE, every frame — a plate reading 1 2 3 4 while the
    // collar says HI is a plate lying about four of its six positions.
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
      // THE RANGE IS DERIVED, NEVER REMEMBERED SEPARATELY. `,` and `.` and the ▲▼ buttons all walk
      // the box sequentially and know nothing about a gate, so if the lever's range were its own
      // stored fact it would go stale the first time somebody used a key — the knob sitting in slot
      // 2 while the truck was in 6. The gear is the truth; which half of the gate you are looking at
      // falls out of it.
      if (st.sim.gear > 0 && st.range !== st.sim.gear > 4) { st.range = st.sim.gear > 4; syncRange(); }
      const s = slotOfGear(st.sim.gear);
      // A gear with no slot is one the OTHER range owns (you are in 6 with the lever showing LO).
      // The knob goes to neutral and the range button is the thing that is wrong, which is exactly
      // what it looks like in the cab.
      glide(s ? s.x : 0.38, s ? s.y : 0.50);
      gate.classList.toggle('cab-gate-off', !s && st.sim.gear !== 0);
    };
    // NEAREST LEGAL SLOT, never "wherever you let go". A gate is a physical constraint and the
    // strongest thing it does is stop you selecting something that is not a gear.
    const snap = (px, py) => {
      let best = null, bd = Infinity;
      for (const s of GATE) {
        const d = (s.x - px) ** 2 + ((s.y - py) * 0.8) ** 2;
        if (d < bd) { bd = d; best = s; }
      }
      return best;
    };
    // ── THE LEVER CANNOT LEAVE THE SLOTS ──────────────────────────────────────
    // The knob used to follow the pointer anywhere on the plate and only snap to a gear when you
    // let go, which is a lever floating over a diagram of a gate rather than a lever IN one. A real
    // gate is a physical constraint you can feel the whole way through the movement — you push
    // across the crossgate and it stops, you pull down a rail and it will not go sideways — and
    // that constraint is most of what makes an H-pattern learnable without reading anything.
    // So the pointer is PROJECTED onto the milled channels every frame. These four segments are the
    // same rails the plate draws (.cab-rail-l/-r/-x/-rev), in the same fractions.
    const CHANNELS = [
      [0.24, 0.15, 0.24, 0.85],   // left rail — 1 over 2
      [0.52, 0.15, 0.52, 0.85],   // right rail — 3 over 4
      [0.80, 0.50, 0.80, 0.85],   // reverse's dogleg, off the crossgate
      [0.24, 0.50, 0.80, 0.50],   // the crossgate everything passes through
    ];
    // Nearest point on the channel network. Plain segment projection, four times — the aspect
    // squash the snap test uses is deliberately NOT applied here: this is a position on screen, not
    // a question about which gear you meant, and squashing it would slide the knob off the rail.
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
      // ⚠ TAKING HOLD OF THE LEVER NO LONGER DIPS THE CLUTCH FOR YOU. It used to, with a CLUTCH IN
      // plate announcing that it had, and the effect was that the pedal existed and was never the
      // reason anything worked. The one-mouse problem that was solving is solved on the PEDAL
      // instead — a tap latches the clutch in — so a single pointer still has both halves of a
      // shift available without the box doing the difficult half on your behalf.
      e.preventDefault(); e.stopPropagation();
    });
    const move = (e) => {
      if (!drag || !st) return;
      const b = gate.getBoundingClientRect();
      if (!b.width) return;
      // Your hand is on the KNOB; what gets positioned is the slot the rod passes through, a stick
      // below it. See KNOB_DX/KNOB_DY.
      const fx = (e.clientX - b.left - KNOB_DX) / b.width;
      const fy = (e.clientY - b.top - KNOB_DY) / b.height;
      const [px, py] = onChannel(fx, fy);
      put(px, py);            // ⚠ NOT `glide` — the knob is under the pointer; see the note on glide
      dropGlide(px, py);      // …and the ease picks up from here when the hand lets go
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
    // A gate you can also just POINT AT. Dragging is the control; clicking the slot you want is the
    // same act with less wrist, and on a touch screen it is the only comfortable one.
    gate.addEventListener('click', (e) => {
      if (e.target === lever || lever.contains(e.target)) return;
      const b = gate.getBoundingClientRect();
      if (!b.width) return;
      const s = snap((e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height);
      if (s) { selectGear(gearOfSlot(s)); st.paintGate?.(); }
    });
    // ── AND THE PAINTED GATE POINTS AT THE SAME SLOTS ─────────────────────────
    // The console's gate is this plate drawn on the dash, so a press on it is the click handler
    // above in the plate's own 0..1 space — one snap, one selectGear, one repaint. It takes
    // fractions rather than an event because the point it is given has already been resolved
    // against a rectangle the RENDERER recorded, which is the only thing that knows where the
    // painted plate is.
    st.gateSnapAt = (fx, fy) => {
      const g = snap(fx, fy);
      if (g) { selectGear(gearOfSlot(g)); st.paintGate?.(); }
    };
    // ── THE GEARSHIFT WINDOW ──────────────────────────────────────────────────
    // Clicking the painted gate opens the shelf's own gate in a floating, draggable window — the
    // real lever you can drag through the H, the slot buttons, the range and splitter collars, AUTO
    // and REV. ⚠ IT IS THE SAME ELEMENT, MOVED, NEVER A COPY: every handler above is bound to it,
    // so there is still one gearbox, and closing puts it back in the shelf where the screen reader
    // and the touch layout expect it. The painted knob and this one read the same `st.gatePos`.
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
      // THE RANGE MOVES THE GEAR WITH IT, and that is the point of a range change rather than a
      // display toggle: the lever has not moved, so you are in the same SLOT — one range up is four
      // ratios up. Flicking it in neutral changes nothing but which four gears the gate offers.
      // ⚠ WHICH SLOT YOU ARE IN IS ASKED BEFORE THE COLLAR MOVES, and getting that order wrong is
      // why the collar did nothing at all. `slotOfGear` resolves through `gearOfSlot`, which reads
      // `st.range` — so asking it AFTER the flip searched the range you had just left: in 6th,
      // dropping to LO looked for a slot numbered 6 among four slots numbered 1–4, found nothing,
      // and the gear was silently never changed. The collar's label moved, the box did not, and the
      // truck was in a gear the gate said it could not be in. It failed in both directions for the
      // same reason; HI→LO is simply the one you notice, because that is the one you reach for when
      // something needs pulling.
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
  // ── THE CLUTCH IS NOT OPTIONAL, AND THE BOX SAYS SO ─────────────────────────
  //
  // This gearbox is not synchronised — nothing in a class 8 is — so a gear goes in when the clutch
  // is in and grinds when it is not. That used to be papered over: taking hold of the lever dipped
  // the clutch FOR you and lit a CLUTCH IN plate saying it had, which meant the pedal existed and
  // was never the reason anything happened. A control that quietly does the hard half teaches the
  // player that the hard half is not there.
  //
  // So: every route into a gear passes through here, and with the clutch out the shift is REFUSED.
  // What you get is what a real missed shift gives you — the lever comes out of the gear it was in,
  // you are in NEUTRAL, it makes a noise everybody in the yard can hear, and the truck is now
  // coasting. That last part is the answer to "why did I lose acceleration after shifting": you
  // hadn't got a gear, and nothing was telling you.
  //
  // TWO THINGS NEVER GRIND, because they don't in a truck either:
  //   · pulling it OUT of gear into neutral — you can knock a box out of gear with your knuckles
  //   · a box that is already in neutral, which has nothing to disengage
  const clutchIn = () => (st.input.clutch || 0) > 0.5;
  // What a ±1 sequential move would actually LAND on — the same clamp truckShift applies, so the
  // gate is asked about the gear you are going to get rather than the one you asked for.
  const gearWithin = (g) => Math.max(-1, Math.min(P.gears.length - 1, g | 0));
  function grind(target) {
    // Out of gear, loudly. `truckSelectGear` is the same door the successful shift uses.
    truckSelectGear(st.sim, P, 0);
    grindCue();
    // AND IT COSTS SOMETHING. The gearbox is entirely client-side, so this is the only place that
    // can know a shift was fluffed — the server owns what it is worth, exactly as it does for a
    // collision (`truckevent bump|crash`). It rate-limits the event itself; this rate-limits the
    // sending, because a held key against a refusing box should not become a packet storm.
    const now = performance.now();
    if (!st.lastGrindSent || now - st.lastGrindSent > 900) {
      st.lastGrindSent = now;
      sendCmdSilent('truckevent grind');
    }
    const gate = container.querySelector('.cab-gate');
    if (gate) {
      // Restart the flash even on a grind that lands inside the last one — `void offsetWidth` is
      // what makes the class re-trigger its animation rather than being a no-op.
      gate.classList.remove('grind'); void gate.offsetWidth; gate.classList.add('grind');
      // The plate says CLUTCH the first few times and then stops. It is a tell, not a tutorial: a
      // driver who has understood it does not need telling on every fluffed shift, and this is the
      // one label in the cab that would otherwise be shouting during the exact moment you are busy.
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
  // Every gear change in the cab funnels through this: the H-gate, the slot buttons, the range
  // switch, the sequential keys, the splitter and the R key.
  function shiftGate(target) {
    if (target === st.sim.gear) return false;                      // not a shift at all
    if (target === 0 || st.sim.gear === 0) return false;           // out of gear / already out: free
    if (clutchIn()) return false;
    // THE AUTOMATIC CLUTCH: the pedal goes in for the shift and comes back up on its own (see
    // autoClutchStep). In NOW, so the step this gear lands on already sees it disengaged.
    if (st.autoClutch) { st.input.clutch = 1; st.autoDip = 0.3; return false; }
    grind(target);
    return true;                                                    // handled — do not put it in gear
  }
  st.shiftGate = shiftGate;

  // ONE DOOR for every way of choosing a gear, so the reverse rule is written once. The H-gate, the
  // R button and the R key all arrive here.
  function selectGear(g) {
    if (g < 0) { toggleReverse(); return; }
    if (st.sim.gear < 0 && Math.abs(st.sim.speed) >= 2) return;   // rolling backwards: not yet
    if (shiftGate(g)) return;
    truckSelectGear(st.sim, P, g);
    // Keep the lever's own range honest with the box: shifting to 6 with the ▲ button has to move
    // the gate into HI, or the knob would sit in a slot that means something else.
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

  // The gearbox, by hand. `tap` is a click/touch that fires ONCE per press — a shift is an edge,
  // unlike a pedal, and a button that auto-repeated would walk the box to neutral if you rested a
  // thumb on it.
  const tap = (sel, fn) => {
    const el = container.querySelector(sel);
    el.addEventListener('click', (e) => { fn(); e.preventDefault(); });
  };
  // ▲▼ and the R key are gone from the shelf: every gear including reverse is a slot on the gate
  // now, and the gate's slots are real buttons. The KEYS are untouched — ',' '.' 'r' still work,
  // and so does the splitter collar.
  // THE KEY IS A HOLD, so it is wired like the pedals rather than like the rockers: press turns it
  // (off instantly, or round to START), release lets it spring back off START. `pointercancel` and
  // a window-level release are both covered, or dragging off the barrel leaves the starter running
  // with nothing on screen turned.
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
      // Keyboard operation of the button itself (Space/Enter on a focused control fires `click`,
      // which no hold can be built from) — one press cranks, and it stops on its own timer.
      barrel.addEventListener('click', (e) => { if (e.detail === 0) toggleIgnition(); });
    }
  }
  tap('.cab-splitbtn', () => splitGear());
  tap('.cab-wipe', () => cycleWipers());
  // THE HEADLIGHTS. Latching, defaults on (see the markup note), and purely local state — the
  // telemetry packet carries it out on the next frame, so there is nothing to await and nothing to
  // persist. Toggling repaints the rocker immediately rather than waiting for a server round trip,
  // which is the same rule the instrument voices follow: your own control answers your own hand.
  tap('.cab-heads', () => setHeads(!st.heads));
  tap('.cab-dome', () => setDome(!st.dome));
  // ── THE CORD IS OPEN FOR AS LONG AS YOU PULL IT ─────────────────────────────
  //
  // ⚠ YOUR OWN HORN NEVER WAITS FOR THE SERVER — the instruments' rule (systems-procedural-audio),
  // and for the same reason: a round trip between pulling the cord and hearing the trumpets is the
  // difference between a horn and a website. So the sustained voice starts locally on press and
  // stops locally on release, and the VERB is sent once, on release, carrying how long it was held.
  // The room then hears a blast of the length the driver actually gave it, from one packet, rather
  // than a fixed toot — or a packet a frame for as long as somebody leans on it.
  function hornDown() {
    if (st.hornAt) return;                       // already open; a second finger is not a second horn
    st.hornAt = performance.now();
    airHornOn(TYPE_ID, HORN);
  }
  function hornUp() {
    if (!st.hornAt) return;
    const secs = Math.min(4, (performance.now() - st.hornAt) / 1000);
    st.hornAt = 0;
    airHornOff();
    // Rounded to hundredths: the wire does not need a float with fourteen digits on it, and the
    // server clamps it again anyway (a client is not trusted with how long a noise lasts).
    sendCmdSilent(`horn ${Math.max(0.15, secs).toFixed(2)}`);
  }
  st.hornDown = hornDown; st.hornUp = hornUp;
  {
    const hb = container.querySelector('.cab-horn');
    if (hb) {
      hb.addEventListener('pointerdown', (e) => { e.preventDefault(); hb.setPointerCapture?.(e.pointerId); hornDown(); });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) hb.addEventListener(ev, hornUp);
      // Keyboard operation of the button (Space/Enter fire `click` with no pointer): a short toot,
      // because there is no hold to read.
      hb.addEventListener('click', (e) => { if (e.detail === 0) { hornDown(); setTimeout(hornUp, 350); } });
    }
  }

  // ── WHICH DRIVE KEYS ARE PHYSICALLY DOWN ────────────────────────────────────
  //
  // Nothing recorded this, and three separate bugs were all the same missing fact.
  //
  // A held control is written straight into `st.input` by the key handler, so the ONLY thing that
  // ever let go of it was the matching keyup arriving at this window. Every route by which that
  // keyup can fail to arrive was therefore a truck that never stopped accelerating — clicking into
  // the command box mid-drive, or Alt-Tabbing to another window, in both cases with A still down.
  // And the one path that deliberately drops the pedal (the camera coming off its mount) could not
  // put it back, because there was nothing to put it back FROM: `exitFreeCam` carried a comment
  // promising it restored the throttle "from the KEY STATE", and no key state existed, so a driver
  // holding A through an O…O round trip got the pedal back only by releasing and pressing again.
  //
  // One Set fixes all three, and it is deliberately a record of the KEYBOARD rather than a second
  // copy of the controls: `st.input` stays the one statement of what the truck is being told to do,
  // and this only ever says which fingers are still on which keys. A pedal held by a POINTER is not
  // in here at all — that is `hold()`'s business and it has its own pointer discipline.
  //
  // ⚠ The table is the release, not the press. Each entry undoes exactly what its key's own branch
  // in `onKey` does, guarded the same way (letting go of Q while E is still down must leave you
  // looking right, not snap you forward into a bend) — so a release through this path and a release
  // through the ordinary keyup are the same release, and running both is a no-op.
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
    ['h', () => st.hornUp?.()],   // the cord: a blast that never ends is the loudest version of this bug
  ]);
  const typingNow = (el) => /^(INPUT|TEXTAREA)$/.test(el?.tagName || '') || !!el?.isContentEditable;
  st.keysDown = new Set();
  function releaseHeldKey(k) {
    if (!st || !st.keysDown.delete(k)) return;
    HOLD_KEYS.get(k)?.();
  }
  // Everything at once — the window losing focus, or the tab going to the background.
  function releaseAllHeldKeys() {
    if (!st) return;
    for (const k of [...st.keysDown]) releaseHeldKey(k);
  }
  // ⚠ A KEY YOU CANNOT LET GO OF IS THE WORST OF THE THREE. Alt-Tab away with the throttle down and
  // the keyup is delivered to whatever you switched to; this window never hears it, so the rig
  // drives off on its own while you are reading something else. Both hooks, because they answer
  // different questions — `blur` is "this window is no longer taking keys" and `visibilitychange` is
  // "this tab is not on screen", and a driver can reach either one without the other.
  st.onWinBlur = releaseAllHeldKeys;
  st.onVisibility = () => { if (document.hidden) releaseAllHeldKeys(); };
  addEventListener('blur', st.onWinBlur);
  document.addEventListener('visibilitychange', st.onVisibility);

  st.onKey = (e) => {
    const k = e.key.toLowerCase();
    const down = e.type === 'keydown';
    // ⚠ A KEYUP IS HEARD EVEN WHEN THE HANDS HAVE MOVED TO THE TEXT BAR. The typing guard below is
    // right for a keydown — a driver writing a message must not be shifting gear — and it was
    // catastrophic for a keyup: hold A, click into the command box, and the release for A is
    // addressed to an INPUT, gets dropped here, and the throttle is left pinned at 1 with no key
    // held and nothing on screen to say so. The truck accelerates until you go back to the road and
    // press-release A over it. So the RECORD is settled before the guard: a press only counts while
    // the cab has the keyboard, and a release always counts, wherever it is delivered.
    if (down) { if (!typingNow(e.target) && HOLD_KEYS.has(k)) st.keysDown.add(k); }
    else releaseHeldKey(k);
    if (typingNow(e.target)) {
      // ⚠ AND THE CAMERA'S KEYS ARE THAT SAME RULE — the paragraph above was written for the
      // throttle and the detached camera was left behind it. Hold W, click into the command box,
      // and the release for W is addressed to an INPUT and dropped here: the camera flies on over
      // a city nobody is steering, which is the truck bug one layer out.
      if (!down) freeCam.onKey(k, false);
      return;
    }
    // ── THE CAMERA OFF ITS MOUNT ────────────────────────────────────────────
    // `O` for observer, which is free on all three panels that render a windshield — the cab alone
    // already spends twenty-six keys, so this was chosen by elimination rather than by mnemonic.
    // It only means anything in the external view: there is nothing to detach from behind the glass.
    //
    // ⚠ AND IT HOLDS THE TRUCK. The wheel and the throttle are about to belong to the camera, so
    // whatever the driver was doing with them is latched: the throttle to whatever speed it had, the
    // wheel to centre. Without that the rig keeps its last input forever — a truck detached from its
    // camera mid-corner would spiral off the road while you photographed it, which is a bug wearing
    // a feature's coat. Cruise is the machinery for exactly this and already exists, so it is used
    // rather than a second speed-hold nobody else knows about.
    // ⚠ THE EXTERNAL VIEW IS REQUIRED TO ENTER AND MUST NEVER BE REQUIRED TO LEAVE. Gating the whole
    // toggle on `st.external` built a trap: the view button is a CLICK, so a driver could detach the
    // camera and then click back to the cockpit view — leaving the camera active (swallowing every
    // key, including the throttle) with no way to stow it, because the key that stows it had just
    // stopped working. Holding A did nothing, the pedal read empty, and the truck coasted on the
    // hold. Entering is conditional; leaving is not, and `exitFreeCam` is the one way out so the
    // button below can use it too.
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
    // Ahead of the camera's key claim, and ahead of the `freeCam.active` bail, on purpose: a
    // detached camera hides these anyway (see NAV_MARKS in windshield.js), and a driver setting the
    // switch while lining a shot up is setting it for the seat they are about to come back to.
    // N is the last free letter on this keyboard — see the ⚠ on POINTER_KEY in freecam.js.
    if (k === 'n' && down && !e.repeat) { e.preventDefault(); markSwitchTold(navMarks()); return; }
    // While it is detached the camera owns its keys and the truck hears none of them.
    // ⚠ AND IT EATS THE EVENT. Without this the arrows keep their default and SCROLL THE PAGE
    // underneath a camera that is turning perfectly well — the view jumps, the turn is lost in it,
    // and the control reads as dead. A key this owns is a key nothing else gets, including the
    // browser.
    if (freeCam.onKey(k, down)) { e.preventDefault(); return; }
    if (freeCam.active) return;
    if (k === 'a') st.input.throttle = down ? 1 : 0;
    // Z is the flight sim's throttle-DOWN key and the brake here, which is the same gesture in a
    // vehicle with no reverse thrust. SPACE is an alias for it because it is the key every hand
    // reaches for to stop a moving thing, and a truck has no guns for it to conflict with (the
    // flight sim's Space is the trigger). Its default is a page scroll, so it must be eaten.
    else if (k === 'z') st.input.brake = down ? 1 : 0;
    else if (k === 'l' && down) setHeads(!st.heads);
    else if (k === 'i' && down && !e.repeat) setDome(!st.dome);
    // ── ⚠ THE CAB AND THE COCKPIT SHARE A KEYBOARD ────────────────────────────
    // These four moved so that a player who flies and drives is not learning two contradictory
    // maps for the same hand. The flight sim is the elder system and the one with more keys, so it
    // wins every collision:
    //
    //   X / C   steer left / right     — the cockpit's rudder. Was clutch / Jake.
    //   V       external view          — the cockpit's chase key. Was wipers, and F.
    //   SPACE   clutch                 — freed by moving the brake to Z alone, and unbound in the
    //                                    cockpit, so it costs nothing there. It is also the right
    //                                    key for it: a big held control for the hand that is not
    //                                    on the stick, which is what makes a mouse shift possible.
    //   J       Jake brake             — mnemonic, and unbound in the cab.
    //   W       wipers                 — mnemonic, and the cab never bound it (there is no
    //                                    look-forward key here; forward is where you are looking).
    //
    // ⚠ `,` AND `.` ARE THE ONE DELIBERATE EXCEPTION and stay on the gearbox. They are the
    // cockpit's SECONDARY rudder binding — the alternate for keyboards that make X/C awkward — so
    // the primary is synced and only the fallback differs. Moving them would cost the dash hint and
    // every hand that already knows them to buy parity on a key most pilots never press.
    // F is kept as a silent alias for the external view: it costs one line and it means nobody who
    // learned the old key finds it dead.
    else if (k === ' ') { st.input.clutch = down ? 1 : 0; st.heldBy = st.heldBy || {}; st.heldBy.clutch = down ? 1 : 0; }
    else if (k === 'j') st.input.jake = down ? 1 : 0;
    // SHIFTING WITHOUT HUNTING FOR THE PUNCTUATION KEYS. `,` and `.` stay — they are what the dash
    // has always hinted and what any existing muscle memory has — but they are two of the worst
    // keys on the board to find with a hand that is also holding A and Z, and shifting is the thing
    // this gearbox asks you to do most. So ↑/↓ shift up and down, which puts the whole gearbox on
    // the arrow cluster the other hand is already steering with: ← → is the wheel, ↑ ↓ is the box.
    // ⚠ NOT W/S, tempting as the WASD read is: S is look-behind and it is the flight sim's key,
    // and that parity is worth more than any convenience this could buy.
    else if (down && !e.repeat && (k === ',' || k === '.' || k === 'arrowup' || k === 'arrowdown')) {
      // Through the same gate the lever goes through: a sequential shift is a shift, and the box
      // does not care which control asked for it. (This used to dip the clutch for you for 320ms.
      // That is the half of shifting the pedal is FOR — see shiftGate.)
      const want = gearWithin((st.sim.gear ?? 1) + ((k === '.' || k === 'arrowup') ? 1 : -1));
      if (!st.shiftGate?.(want)) truckShift(st.sim, P, (k === '.' || k === 'arrowup') ? 1 : -1);
    }
    // Cruise. Not a held control and not on a pedal key: it is the switch that means "stop holding
    // the pedal", so it gets its own press.
    else if (down && !e.repeat && k === 'g') toggleCruise();
    // K for the key. Not a held control — you turn it, it stays turned — so it is an edge like
    // cruise and reverse rather than a pedal.
    // K is the key, and it HOLDS like the key does: press to turn it (off, or round to crank),
    // release to let it spring back. `e.repeat` filtered so autorepeat is not a second turn.
    else if (k === 'k') { if (down && !e.repeat) toggleIgnition(); else if (!down) st.stopCrank?.(); }
    else if (down && !e.repeat && k === '/') splitGear();
    // REVERSE is its own key rather than "shift down past first", because walking a driver through
    // neutral into reverse by accident at twenty miles an hour is not a skill test, it is a bug
    // report. It only takes at a stop, which is where a real box lets you have it too.
    else if (down && !e.repeat && k === 'r') toggleReverse();
    else if (down && !e.repeat && k === 'w') cycleWipers();
    else if (down && !e.repeat && k === 'p') st.setPark?.(!st.park);
    // M — automatic shifting. Not on the gearbox cluster (↑↓ , .) deliberately: those are the box,
    // and a key that switches the box off does not belong among the keys that work it.
    else if (down && !e.repeat && k === 'm' && e.shiftKey) st.setAutoClutch?.(!st.autoClutch);
    else if (down && !e.repeat && k === 'm') st.setAuto?.(!st.auto);
    // V, the cockpit's own chase key — see the sync note above. F is kept as a silent alias so
    // nobody who learned the cab's old key finds it dead.
    else if (down && !e.repeat && (k === 'v' || k === 'f')) st.setExternal?.(!st.external);
    // Shift+/ arrives as '?', so the splitter's own '/' branch above never sees it.
    else if (down && !e.repeat && k === '?') st.toggleHelp?.();
    else if (down && !e.repeat && k === 'd') container.querySelector('.cab-dmg-strip')?.click();
    // T, not G — G is cruise control and has been since the box was built. Every obvious letter
    // for 'food' was already a control, which is what a cab with twenty-odd of them costs.
    else if (down && !e.repeat && k === 't') st.toggleGalley?.();
    // Y for the latches. Another letter picked by elimination rather than by meaning — L is the
    // headlights and has been since before there was a door to lock.
    else if (down && !e.repeat && k === 'y') container.querySelector('.cab-latchbtn')?.click();
    else if (down && k === 'escape' && !container.querySelector('.cab-help')?.hidden) st.toggleHelp?.(false);
    // H is the cord and it HOLDS: down opens it, up closes it and sends the length. (`e.repeat`
    // filtered so autorepeat is not a stream of pulls.)
    else if (k === 'h') { if (down && !e.repeat) st.hornDown?.(); else if (!down) st.hornUp?.(); }
    // STEERING BY KEYBOARD. Until this existed a keyboard driver could accelerate, brake and shift
    // — and could not turn, which is not a harder way to drive, it is not driving. It goes through
    // the wheel widget so the wheel on screen turns with it.
    // Q / E / S — held shoulder-checks, on the flight sim's own three keys so the habit carries.
    // The release is guarded on the CURRENT yaw, so letting go of Q while E is still down leaves
    // you looking right rather than snapping forward into a bend you cannot see.
    else if (k === 'q' || k === 'e' || k === 's') {
      const yaw = k === 'q' ? -90 : k === 'e' ? 90 : 180;
      if (down) { st.viewYaw = yaw; st.showViewTag?.(yaw); }
      else if (st.viewYaw === yaw) { st.viewYaw = 0; st.showViewTag?.(0); }
    }
    // X / C are the cockpit's rudder keys and steer here for the same reason — see the sync note.
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

  // Reverse lives in ONE place, because it is reached from a key and from a button and the rule
  // (only at a stop) must not end up written twice and drift.
  // Cruise lives in ONE place for the same reason reverse does: it is reached from a key, from a
  // rocker on the dash and from the frame loop's own cancel conditions, and three copies of "what
  // does the lamp say now" is three chances for the lamp to lie about the state of the truck.
  // `null` is off; a number is the demanded mph.
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
  //
  // ⚠ IT IS A HAND, NOT A GEARBOX. Exactly the rule cruise control keeps two paragraphs up, and for
  // the same reason: this writes `st.input.clutch` and calls `selectGear` — the same pedal and the
  // same door the H-gate, the arrow keys and the splitter go through — so the shift gate, the
  // grind, the stall check, the torque curve and the load all still decide what happens. A version
  // that wrote `st.sim.gear` would be a different truck wearing this one's dashboard, and it would
  // be the only route into a gear in the cab that could not fluff a shift.
  //
  // AND THAT IS WHY THE LEVER MOVES. The whole visible cost of a shift in this cab is the second
  // your hands are busy, and a switch that skipped it would be teaching the box is optional. So it
  // takes the time a shift takes, in the order a shift happens — dip, out through neutral, into the
  // slot, let it up — and the stick on the dash does it in front of you.
  // WHAT THE DRIVER LEFT IT ON, and it defaults to ON. A first-time driver climbing into an
  // eight-speed crash box with a range collar and a splitter is not being given a gearbox, they
  // are being given a reason to get out — so the automatic hand is on the lever until somebody
  // takes it off, and once they have, it stays off. Per browser rather than per account: it is a
  // control preference like the pane heights beside it, not world state.
  //
  // ⚠ THE STORED VALUE IS ONLY EVER WRITTEN BY THE DRIVER. `setAuto` persists, the touch force-on
  // does not: a touch screen can't switch it off (see the guard in setAuto), so recording that as
  // a choice would carry a decision nobody made onto their desktop.
  function setAuto(on, remember = true) {
    // ⚠ ON TOUCH IT DOESN'T SWITCH OFF. The touch shelf carries no gearbox at all (see THE TOUCH
    // SHELF), so a driver who turned this off would have no way into a gear. It's refused here
    // rather than hidden, because the same call arrives from the click handler, the M key on a
    // tablet's keyboard and the painted switch.
    if (cabTouch()) { on = true; remember = false; }
    st.auto = !!on;
    // Never leave the clutch pinned in by a driver that has just been switched off mid-shift: the
    // truck would coast, silently, with no pedal down and nothing to explain it.
    if (!on && st.shiftSeq) { st.shiftSeq = null; if (!st.heldBy?.clutch && !st.clutchLatched) st.input.clutch = 0; }
    const el = container.querySelector('.cab-auto');
    if (el) { el.classList.toggle('on', st.auto); el.setAttribute('aria-pressed', st.auto ? 'true' : 'false'); el.dataset.dash = st.auto ? 'AUTO' : 'MANUAL'; const sp = el.querySelector('span'); if (sp) sp.textContent = st.auto ? 'AUTO' : 'MAN'; }
    if (remember) { try { localStorage.setItem(AUTO_KEY, st.auto ? '1' : '0'); } catch {} }
  }
  st.setAuto = setAuto;
  function setAutoClutch(on, remember = true) {
    // Same rule and the same reason: the automatic doesn't take the box out of gear at a stop, so
    // with no clutch pedal on the touch shelf it's this that keeps the engine from stalling.
    if (cabTouch()) { on = true; remember = false; }
    st.autoClutch = !!on;
    if (!on && !st.heldBy?.clutch && !st.clutchLatched && !st.shiftSeq) st.input.clutch = 0;
    const el = container.querySelector('.cab-autoclu');
    if (el) { el.classList.toggle('on', st.autoClutch); el.setAttribute('aria-pressed', st.autoClutch ? 'true' : 'false'); el.dataset.dash = st.autoClutch ? 'AUTO CLU' : 'FOOT CLU'; }
    if (remember) { try { localStorage.setItem(AUTOCLU_KEY, st.autoClutch ? '1' : '0'); } catch {} }
  }
  st.setAutoClutch = setAutoClutch;
  setAutoClutch(st.autoClutch, false);
  // And it starts on there (the guard in setAuto), because a driver who climbs in and finds
  // neutral with no lever has been handed a truck with no way to move it. On every other cab the
  // stored preference has already put the switch where the driver left it, so this only has to
  // paint the button, since `st.auto` was set from it when the state was built.
  setAuto(st.auto, false);
  // ── THE PARK BRAKE ──────────────────────────────────────────────────────────
  //
  // ⚠ IT IS THE BRAKE PEDAL, NOT A NEW FORCE. Same rule as cruise and the automatic: it writes
  // `st.input.brake`, so the retardation, the fade model, the surface and the load all still apply
  // and there is nothing new for the model to learn. What makes it a PARK brake rather than a very
  // patient foot is that it is a latch and that it survives the engine — spring brakes are held ON
  // by springs and released by air, which is precisely why a truck with no air pressure is a truck
  // you cannot move, and why this is the one control that still means something with the key off.
  //
  // It refuses to come off above a walking pace. Not a safety rail — a real valve will pop out at
  // any speed and it is a genuinely frightening thing to do — but because the only reason to reach
  // for it while rolling is a misclick, and the cab is not the place to model that particular way
  // of destroying a rig.
  function setPark(on) {
    if (on && Math.abs(st.sim.speed) > 3) return;      // it is a park brake; you are not parked
    st.park = !!on;
    // ⚠ THE PARK BRAKE SUSPENDS THE AUTOMATIC, IT NO LONGER SWITCHES IT OFF. Cruise is cancelled
    // because a set speed is a thing you asked for once and it should not survive you stopping; the
    // automatic is a way of driving, and taking it away silently is how a driver ends up rolling
    // around in manual wondering why the box stopped shifting. Reverse works the same way — see the
    // inhibit in autoShift, which is the one place that decides whether the automatic has anything
    // to do right now. Both conditions clear by themselves, and the automatic simply resumes.
    if (st.park) st.setCruise?.(null);
    const el = container.querySelector('.cab-parkbtn');
    if (el) {
      el.classList.toggle('on', st.park);
      el.setAttribute('aria-pressed', String(st.park));
      // The word on the knob is what your hand does NEXT — the same convention the trailer air
      // valve uses, and the reason its legend reads PUSH/PULL rather than ON/OFF.
      const w = el.querySelector('em');
      if (w) w.textContent = st.park ? 'PUSH' : 'PULL';
    }
    // AND IF THERE IS NOTHING LEFT TO DO, THIS IS GETTING OUT. Setting the spring brakes on a
    // stationary truck is the last step of parking it and there is no other reason to do it — so
    // the knob finishes the sequence rather than leaving the driver to find a verb for the part
    // they have visibly already done. It sends the ORDINARY `park` command, which locks up, flushes
    // and closes this panel.
    //
    // ⚠ IT IS SENT WITH THE ENGINE RUNNING TOO, AND THE COMMENT HERE ALREADY SAID SO WHILE THE
    // GUARD DID THE OPPOSITE. The line read "the cab decides nothing about whether it is allowed,
    // and with the engine running the verb's own refusal is the one that speaks" — and then gated
    // on `st.sim.stalled`, so with the engine running NOTHING was sent and nothing spoke. A driver
    // pulled the park brake expecting to climb down, got silence, and had no way to learn that the
    // key was the missing step. `parkRig` refuses in one clear sentence that names the key; letting
    // it say so is the whole point of not deciding here.
    // ⚠ AND THE SEND IS NOT DECIDED HERE, BECAUSE THE MOMENT YOU PULL THE KNOB IS NOT THE MOMENT
    // YOU ARE STOPPED. The knob comes out at anything under 3 mph (above), and the verb only went
    // out under 0.5 — so a driver who pulled it at a crawl set the brakes, watched the legend flip
    // to PUSH, and got NOTHING: the rig then coasted to rest with the knob already on, so pressing
    // it again pushed it back IN. That is the whole of "park sometimes does nothing", and it is not
    // discoverable from the seat, because the control visibly worked.
    //
    // So the intent is LATCHED and the frame loop fires it when the rig actually comes to rest (see
    // the exit-cab block in the readout sync). `parkSent` is the one-shot: cleared whenever the
    // brake is pushed back in, which is also what lets a driver who changed their mind change it.
    if (!st.park) st.parkSent = false;
  }
  st.setPark = setPark;
  // Toggling it ON takes the speed you are DOING, which is the only number a driver ever means by
  // it — there is no set-point to dial, because dialling one is a menu and this is a truck.
  // ── THE KEY ─────────────────────────────────────────────────────────────────
  //
  // Off is a real state, not a pause: the engine is dead, the drive is gone, and the rig rolls to a
  // stop on its own rolling resistance exactly as a stall does. It IS the stall flag — there is one
  // "this engine is not turning" in the model and adding a second would mean every reader (the
  // audio, the lifter wash, the gear readout, the parked pose) had to learn about both.
  //
  // Starting is the model's own rule and is not restated here: `input.starter` only takes with the
  // clutch in or the box in neutral (flight-model.js), which is why turning the key in gear with
  // your foot off the pedal does nothing but churn. The cab holds the starter for a moment rather
  // than setting it for a frame, because a key you turn and release is a key you have to hold.
  // ⚠ THE BARREL'S ANGLE IS THE ENGINE, NOT THE POINTER. Three positions, and which one it is
  // sitting at is derived from the truck rather than remembered here: OFF when the motor is dead,
  // ON when it is running, and START only while a hand is actually holding it round. A key that
  // remembered its own angle would sit at ON over an engine that had stalled underneath it, which
  // is the exact lie the lamp comment two paragraphs down was already written to avoid.
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
  // TURNING IT OFF is instant and needs no hold — a key going anticlockwise has nothing to fight.
  function ignitionOff() {
    if (st.sim.stalled) return;
    st.sim.stalled = true;                       // the engine stops, everything downstream follows
    st.input.throttle = 0;
    st.setCruise?.(null);                        // a dead engine is not holding a speed
    // ⚠ A KEY-OFF IS A DECISION TO STOP, AND A STALL IS NOT. The flag is what separates them, and
    // it has to exist: the frame loop below brings a shut-down rig to a standstill and holds it
    // there, and doing that off `sim.stalled` alone would slam the brakes on the moment a driver
    // lugged it to death at forty — punishing a mistake with a handbrake turn. Only the key sets
    // this; cranking clears it, so the truck is free again the instant somebody asks for it.
    st.shutdown = true;
    stopCrank();
    keyCue(false);
    paintKey();
    st.paintControls?.();
  }
  // …and HOLDING IT ROUND cranks for as long as you hold it. The old version turned the starter on
  // for a fixed 900ms and let go for you, which meant a rig that needed a second turn had to be
  // clicked again rather than simply held — and it is the only control in the cab that behaved like
  // a keypress when the real thing is unambiguously a hold.
  function startCrank() {
    if (!st.sim.stalled || st.cranking) return;
    // Asking for the engine releases the settle — see ignitionOff. The brake goes back to whatever
    // a foot is actually doing rather than being left where the settle put it, or the rig would
    // start up with the pedal on the floor and nothing on screen to say why.
    st.shutdown = false;
    if (!st.heldBy?.brake) st.input.brake = 0;
    // ⚠ THE ONE REFUSAL IN THIS CAB THAT HAS TO SAY ITS NAME. The model will not restart an engine
    // that is coupled to the road (flight-model.js: `clutch > 0.5 || ratio === 0`), which is the
    // correct rule and completely invisible: you turn the key, the starter churns, nothing happens,
    // and every readable signal in the cab — fuel, air, the lamp — says the truck is fine. It read
    // as a broken button, and it was reported as one. So the cab says what the gearbox is doing
    // BEFORE it spends four seconds proving it. The line names the fix, not the fault, because a
    // driver who has just been told "clutch or neutral" can act on it without a manual.
    if (!(st.input.clutch > 0.5 || st.sim.gear === 0)) {
      // TWO SURFACES, because they answer two different people. The gate plate flashes its CLUTCH
      // tell — the same one a fluffed shift raises, in the same place your eye already is — and the
      // line goes to the log, which is where the record lives for anyone driving at the bottom rung
      // of Display Mode (see systems-display-mode). Neither is a new channel.
      const gate = container.querySelector('.cab-gate');
      if (gate) {
        gate.classList.remove('grind'); void gate.offsetWidth; gate.classList.add('grind');
        gate.dataset.tell = 'CLUTCH';
        clearTimeout(st.grindTell);
        st.grindTell = setTimeout(() => { if (gate.dataset) gate.dataset.tell = ''; }, 1800);
        setTimeout(() => gate.classList.remove('grind'), 420);
      }
      // ⚠ LOADED ON DEMAND, NEVER IMPORTED AT THE TOP. A static import of render.js from here
      // closes a cycle through the boot chain — render.js → smartbar → smartbar-macros → input.js →
      // this file — and a cycle on the path that mounts the client is not worth one line of text.
      // ESM would probably have coped, and 'probably' is the wrong word for the module that draws
      // the room. Loaded here it cannot run before the log exists, because nothing can turn a key
      // in a cab that has not been drawn yet.
      import('../render.js').then((r) => r.appendHtml(
        "The starter churns and the engine won't catch: the box is still in gear. <b>Clutch in</b>, or find <b>neutral</b>, and turn the key again.",
        'msg-system')).catch(() => { /* the gate plate already said it — the log line is the second surface, not the only one */ });
      // The starter still turns: refusing to crank at all would be a second invisible rule on top
      // of the first, and the churn is the sound that makes the message make sense.
    }
    st.cranking = true;
    st.input.starter = 1;
    keyCue(true);
    paintKey();
    // A starter motor is not infinite and a held key must not become one: it gives up after a few
    // seconds the way a real one does rather than churning for as long as somebody leans on it.
    clearTimeout(st.crankT);
    st.crankT = setTimeout(() => stopCrank(), 4000);
  }
  function stopCrank() {
    clearTimeout(st.crankT);
    if (st) { st.cranking = false; st.input.starter = 0; }
    paintKey();
  }
  st.startCrank = startCrank; st.stopCrank = stopCrank; st.ignitionOff = ignitionOff;
  // The one-press form the K key and a tap still use: off if it is running, crank if it is not.
  function toggleIgnition() {
    if (!st.sim.stalled) ignitionOff();
    else startCrank();
  }
  st.toggleIgnition = toggleIgnition;

  function toggleCruise() {
    if (st.cruise != null) return setCruise(null);
    if (st.sim.gear > 0 && st.sim.speed >= 5.5 && !st.dry && !st.broken) setCruise(st.sim.speed);
  }


  // The REV button's door, and it is deliberately not `toggleReverse`. That one throws the lever
  // straight across, which is the right thing for the R key (a hand on a stick) and the wrong thing
  // for a button pressed by somebody who has the automatic on and both hands off — they would see
  // the gear number change and nothing else. This goes through `beginShift`, the automatic's own
  // sequence, so the clutch dips, the stick comes out to neutral, it sits there for a beat and then
  // goes across. Same machinery, so there is no second idea about how this box is shifted.
  function engageReverse() {
    if (Math.abs(st.sim.speed) >= 2) return;      // the same standstill rule the lever has
    if (st.shiftSeq) return;                      // one shift at a time
    beginShift(st.sim.gear < 0 ? 0 : -1);         // in reverse → back to neutral; otherwise into it
  }
  st.engageReverse = engageReverse;
  function toggleReverse() {
    if (Math.abs(st.sim.speed) >= 2) return;
    // THE LEFT FOOT IS AUTOMATIC ON THIS ONE, and reverse is the only slot on the gate that gets
    // that. Everywhere else the clutch is half of shifting and the player owns it — see the note on
    // the sequential keys, which deliberately stopped dipping it for you. Reverse is different for
    // a reason that is already written into the guard above: it can ONLY be selected stopped, so
    // there is no version of this where the automatic foot is covering for a shift that should have
    // cost something. What it was actually costing was a grind every time somebody backed onto a
    // dock, from a pedal they were already holding a wheel and a throttle against.
    //
    // Dipped and released around the shift rather than latched, so nothing is left holding the
    // clutch down afterwards — and the release honours a hand that IS on the pedal (or the latch),
    // exactly as the automatic's own sequence does when it lets one up.
    const held = st.input.clutch;
    st.input.clutch = 1;
    if (!st.shiftGate?.(st.sim.gear < 0 ? 1 : -1)) {
      truckShift(st.sim, P, st.sim.gear < 0 ? 2 : -(st.sim.gear + 1));
    }
    st.input.clutch = (st.heldBy?.clutch || st.clutchLatched) ? held : 0;
  }
  // THE SPLITTER IS HALF A SHIFT, AND HALF A SHIFT IS STILL A SHIFT. The collar moves dog teeth in
  // the same box; flicking it under load with the clutch out is the classic way to lose a ratio and
  // find neutral at speed, which is exactly what shiftGate does to you.
  function splitGear() {
    const want = gearWithin((st.sim.gear ?? 1) + (st.sim.split ? -1 : 1));
    if (st.shiftGate?.(want)) return;
    truckSplit(st.sim, P);
  }

  // Wipers, off → intermittent → low → high → off. Purely a client-side control: the blade is
  // drawn on the glass and clears the drops that are drawn on the glass, and neither of those
  // things is a fact about the world, so nothing is told to the server about it.
  function paintWipers() {
    const w = st.wipers | 0;
    const stalk = container.querySelector('.cab-stalk');
    if (stalk) {
      stalk.style.setProperty('--pos', String(w));
      stalk.classList.toggle('on', w > 0);
      // The hint is painted here rather than only on a weather push, so switching the wipers off
      // in the rain brings it straight back.
      stalk.classList.toggle('hint', cabWet(st) && !w);
      const lbl = stalk.querySelector('.cab-stalk-pos');
      if (lbl) lbl.textContent = WIPE_POS[w] || 'OFF';
      // The stalk's own detent is the state, so the accessible name carries it too — a screen
      // reader gets "Wipers, low" rather than a control it has to press to learn anything about.
      stalk.setAttribute('aria-label', 'Wipers: ' + (WIPE_POS[w] || 'OFF').toLowerCase());
    }
  }
  st.paintWipers = paintWipers;
  // ── THE HEADLIGHT SWITCH ───────────────────────────────────────────────────
  // Latching, on by default — see the rocker's markup for why the default is ON rather than OFF.
  // Purely local: the sim reads `st.heads` for the beam and the telemetry packet carries it to the
  // server for other drivers, so there is nothing to await here and nothing to persist.
  if (st.heads === undefined) st.heads = true;
  function setHeads(on) {
    st.heads = !!on;
    const el = container.querySelector('.cab-heads');
    if (el) {
      el.classList.toggle('on', st.heads);
      // ⚠ THE <span>, NOT THE BUTTON. The rocker also holds its tell-tale lamp (`<i>`), and a
      // textContent write on the button deletes it — which is exactly what happened the first time
      // the wiper stalk became a rocker, two controls along.
      const lbl = el.querySelector('span');
      if (lbl) lbl.textContent = st.heads ? 'LAMPS' : 'DARK';
      el.setAttribute('aria-pressed', st.heads ? 'true' : 'false');
      el.setAttribute('aria-label', st.heads ? 'Headlights: on' : 'Headlights: off');
    }
  }
  st.setHeads = setHeads;
  // -- THE DOME LAMP ----------------------------------------------------------
  // Latching, on by default, and it never leaves this client: the renderer reads it off the frame
  // options and there is nothing about the inside of your cab another driver could see.
  if (st.dome === undefined) st.dome = true;
  function setDome(on) {
    st.dome = !!on;
    const el = container.querySelector('.cab-dome');
    if (el) {
      el.classList.toggle('on', st.dome);
      // WARNING: the <span>, not the button — the rocker carries its own tell-tale lamp (<i>) and
      // a textContent write on the button deletes it. Same trap as the headlights above.
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
      // The LABEL is the state, so it is the label that changes — and it is the <span>, not the
      // button, because the button also holds the tell-tale lamp and a textContent write would
      // delete it. (That is exactly what happened the first time the stalk became a rocker.)
      const lbl = el.querySelector('span');
      if (lbl) lbl.textContent = ['WIPE', 'INT', 'LO', 'HI'][st.wipers];
      el.classList.toggle('on', st.wipers > 0);
    }
  }

  // ── THE VIEW CHROME ────────────────────────────────────────────────────────
  // Fullscreen and hide-panel are BODY classes, exactly as the flight sim and the hangar do it
  // (`fsim-fullscreen` / `fsim-hidepanel`), because what they change is the page layout and not
  // anything about the cab. Fullscreen supersedes hide-panel — the same precedence, so a player who
  // learned it in an aircraft does not have to learn it again in a truck.
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
  // The third rung. It does not supersede the other two the way they supersede each other — it is
  // a different layer (the page rather than the pane), so whatever ⛶ or ⊟ were set to is what the
  // driver comes back to. bigscreen.js keeps the lit state, because Esc can leave it without this
  // button being touched.
  bindBigScreenButton(container.querySelector('.cab-bigbtn'));
  // ⚠ AND ON A PHONE IT STARTS HIDDEN. The room description and the log are below the pane, and on
  // a phone that is the last third of a screen the road was already fighting for — a driver in a
  // cab is looking out of the windscreen, and the room they are parked in has nothing to say until
  // they climb down. Shared with the other five panels that take over the pane; the rules are in
  // compact-view.js, including why it is a default and never a lock.
  seatHidePanel('cab-hidepanel', hideBtn);
  window.dispatchEvent(new Event('pane:claimed'));   // a phone keeps #area-pane collapsed until told; an app that mounts there has to say so
  // THE EXTERNAL VIEW. The renderer has had a real chase camera the whole time — the cab's own
  // header note lists `external` among the things it deliberately did not pass — so this is not a
  // new camera, it is the existing one turned on, model and all. The rig is NOT a world object and
  // must never become one (the collision probe would hit it); it is the renderer's own-ship, which
  // is exactly the seam every aircraft already uses to be the thing the world is drawn for.
  viewBtn.addEventListener('click', () => setExternal(!st.external));
  function setExternal(on) {
    // Stepping back inside stows the camera. There is nothing to detach from behind the glass, and
    // a camera left running there is one holding the keyboard hostage — see the ⚠ on the O key.
    if (!on) st.exitFreeCam?.();
    st.external = !!on;
    viewBtn.classList.toggle('on', st.external);
    viewBtn.textContent = st.external ? '◎ CAB' : '◎ EXT';
    container.querySelector('.cab-wrap')?.classList.toggle('cab-ext', st.external);
    // Outside the cab there is no dash, so the glass gauge is the only fuel reading there is —
    // repaint on the switch rather than waiting for the next server push, or stepping out shows
    // nothing for up to a second.
    paintFuelGauge(st);
    const rst = container.querySelector('.cab-orbitreset');
    if (rst) rst.hidden = !st.external;
    // A drag that started as steering must not become an orbit halfway through, and vice versa.
    st.wheel?.setDragging(false);
  }
  st.setExternal = setExternal;
  // THE ONE WAY OUT, so the key, the view button and the teardown all hand the truck back the same
  // way. ⚠ It restores the throttle from the KEY STATE rather than to zero: a driver who was holding
  // A throughout is still holding it, and autorepeat may not fire again for them — so releasing the
  // camera has to give the pedal back rather than wait to be told about it a second time.
  function exitFreeCam() {
    if (!freeCam.active) return;
    freeCam.close();
    // A driver who was NOT on cruise before must not discover they are on it after — the sort of
    // thing you only notice at a junction.
    if (!st.freeHold?.cruise) setCruise(null);
    st.freeHold = null;
    // ⚠ AND THE PEDALS COME BACK FROM THE KEY RECORD, WHICH IS WHAT THE COMMENT ABOVE THIS FUNCTION
    // HAS ALWAYS CLAIMED. It could not: entering zeroed `st.input` and nothing anywhere remembered
    // that A was still down, so autorepeat never fired again for that press and the throttle stayed
    // dead until the driver released and pressed it a second time. Detaching the camera is allowed
    // to take the truck away; it is not allowed to keep it.
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
  //
  // THE SCREEN PROPOSES; THE VERB DECIDES. Every row here sends the ordinary `route <key>` command
  // — the same string a player could type — and that command owns all of the rules: whether the
  // fork is still ahead, whether a contracted load overrides the choice, what happens to the
  // odometer. This panel re-implements none of it, and must not start: the moment it decides
  // anything, there are two answers to "can I go there" and they disagree the first time a tank
  // gets smaller.
  //
  // Which is also why an unreachable destination is shown and NOT hidden. A greyed row that says
  // why is information; a missing row is a mystery, and the fuel judgement ("further than your tank,
  // one way") is a call the driver is allowed to make.
  {
    const box = container.querySelector('.cab-routes');
    const REACH = {
      ok: ['', 'in range'],
      thin: ['r-thin', 'past your tank, one way'],
      far: ['r-far', 'well past your range'],
    };
    const body = () => box?.querySelector('.cab-gps-body');
    // WHICH APP IS UP is one variable and the tabs are the only writer. The renderers below are
    // otherwise unchanged — they paint the body, and the body does not care whether it is currently
    // sitting in the dash or in a floating window.
    st.gpsApp = 'route';
    function renderGps() {
      // ⚠ THE WHOLE UNIT, NOT THE ROUTE APP. An EMP takes the head, and the head is
      // what the three tabs are painted on — a dead plotter that still let you flip
      // to MAP and read your own position off it would be a unit that is only
      // pretending to be broken. The tabs stay clickable on purpose: pressing
      // buttons on a dead screen is what a person does, and it says the same thing
      // whichever one you press.
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
    // The GPS could name where you were going and how far it was, and could not show you where you
    // WERE. Everything this draws was already on the wire and being spent on the windshield: the
    // same `map` window the 3D view extrudes its buildings from, the same `s`/`L` the odometer is
    // derived from, the same `routes` the picker lists. Nothing was added to the context for it,
    // which is the whole reason it is worth having — a second position channel would be a second
    // thing to disagree with the road.
    //
    // TWO ANSWERS, because "where am I" has two at any moment. In a city you want the streets
    // around you, so it draws the window: north up, buildings solid, roads light, you in the
    // middle. Out on the corridor a window of void road tells you nothing at all — every tile looks
    // like the last one, which is the point of the void — so it draws the ROUTE instead, as a line
    // from where you left to where you are aimed, with the nodes on it and you somewhere along.
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
      // ⚠ THE CORRIDOR GETS THE MAP TOO NOW, AND THE STRIP BECOMES ITS FOOTER. The note above used
      // to end "so it draws the ROUTE instead", and that was right when the void was a ruler-
      // straight run of identical tiles. It has not been that for a while: the road BENDS, the
      // verge is a classified band either side of a real centreline, there are mile boards and
      // junction pylons on the shoulder, forks with sibling limbs, and wrecks where somebody did
      // not finish. A window of that is worth looking at — and the one thing a progress bar can
      // never show you is the bend you are already in.
      //
      // So both, rather than a choice: the window is the instrument and the strip is the ribbon
      // under it, still carrying the nodes, the mileage and the turn call. Nothing new is on the
      // wire for any of it — `st.map` is synthesised on the corridor exactly as it is in a city
      // (see providerFor in plugins/trucking/state.js), and the windshield has been eating it the
      // whole time.
      const RIBBON = 54;
      const full = { x: 0, y: 0, w: cv.width, h: cv.height };
      if (corridor) {
        // The window draws SILENT out here — one legend, and it is the strip's, because miles to
        // run and the turn call beat a tile coordinate nobody can do anything with in the void.
        drawLocalMap(g, cv, null, { x: 0, y: 0, w: cv.width, h: cv.height - RIBBON });
        drawRouteStrip(g, cv, leg, { x: 0, y: cv.height - RIBBON, w: cv.width, h: RIBBON });
      } else drawLocalMap(g, cv, leg, full);
    }
    // Colours are deliberately few and flat. This is an instrument, not a picture: what a driver
    // needs off it in a glance is where the roads are and where the buildings are not.
    const MAP_INK = { road: '#4d5560', bldg: '#20262e', water: '#1d3550', field: '#2c3a2e', land: '#2a2620', air: '#12151a',
      // The two the corridor needs and a city does not: the made surface you want to be on, and the
      // graded band either side of it that is merely slow. They are close together on purpose — the
      // verge is not a hazard stripe, it is the same road with less of it under you.
      paved: '#5a6472', verge: '#403a30' };
    function cellInk(c) {
      if (!c || c.kind === 'air') return MAP_INK.air;
      if (c.bt) return MAP_INK.bldg;
      // ⚠ THE CORRIDOR IS A BAND, NOT A LINE, so `road` alone flattens the whole width to one grey
      // and the driver cannot see which part of it they are on — which out here is the only
      // question the map is being asked. `rt`/`rw` are the tile's own offset from the centreline
      // and the paved half-width, and they travel together or not at all (see deriveSurfaceCell).
      if (c.rdeg !== undefined && c.rw !== undefined) {
        return Math.abs(c.rt || 0) <= c.rw ? MAP_INK.paved : MAP_INK.verge;
      }
      if (c.road) return MAP_INK.road;
      if (c.biome === 'water' || c.sub) return MAP_INK.water;
      if (c.kind === 'field') return MAP_INK.field;
      return MAP_INK.land;
    }
    // `rect` is the box on the canvas this map may have, because on the corridor it shares the
    // glass with the route ribbon. `leg` is optional for the same reason — two functions writing
    // the one legend element means whichever ran last wins, silently.
    function drawLocalMap(g, cv, leg, rect = { x: 0, y: 0, w: cv.width, h: cv.height }) {
      const rows = st.map;
      if (!rows || !rows.length) { if (leg) leg.innerHTML = '<span class="cab-routes-none">No fix.</span>'; return; }
      const n = rows.length, px = Math.min(rect.w, rect.h) / n;
      const ox = rect.x + (rect.w - px * n) / 2, oy = rect.y + (rect.h - px * n) / 2;
      for (let r = 0; r < n; r++) for (let c = 0; c < rows[r].length; c++) {
        g.fillStyle = cellInk(rows[r][c]);
        g.fillRect(ox + c * px, oy + r * px, Math.ceil(px), Math.ceil(px));
      }
      // THE THINGS ON THE SHOULDER. A board, a set of junction pylons, a depot door — the landmarks
      // that make one stretch of corridor distinguishable from the next, which is precisely what
      // the old note said a void window could never be. They ride the `mark` channel the windshield
      // already extrudes from, so nothing is authored twice and a mark that never reaches the 3D
      // view can never appear here either.
      const MARK_INK = { sign: '#c9d2dc', pylons: '#7d8794', bay: '#e8b455', gate: '#9aa6b4', statue: '#6f7a88' };
      for (let r = 0; r < n; r++) for (let c = 0; c < rows[r].length; c++) {
        const ink = MARK_INK[rows[r][c]?.mark];
        if (!ink) continue;
        g.fillStyle = ink;
        const d = Math.max(2, px * 0.42);
        g.fillRect(ox + (c + 0.5) * px - d / 2, oy + (r + 0.5) * px - d / 2, d, d);
      }
      // ⚠ THE TRUCK IS NOT AT THE CENTRE OF THE WINDOW, it is at its own fractional position inside
      // the centre TILE — `mapX/mapY` are the window's rounded centre and `sim.x/y` are where the
      // wheels are. Drawing it dead centre would be right three times out of four and visibly
      // lagging the rest of the time, which on a map reads as the map being wrong.
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
    // The corridor, drawn as the thing it is: one line with a start, an end and you on it. `s`/`L`
    // are the server's own numbers — the same pair the odometer is derived from — so the dot cannot
    // drift from the mileage printed under it.
    // It is now the FOOTER of the corridor map rather than the whole of it, so it takes a `rect`
    // and lives in it — the line sits high in the band with the two end labels under it, which is
    // the only arrangement that fits without either clipping the words or stealing height from the
    // window above. The geometry is the only thing that changed; every number it prints is still
    // the server's own.
    function drawRouteStrip(g, cv, leg, rect = { x: 0, y: 0, w: cv.width, h: cv.height }) {
      const L = Math.max(1, st.L || 1), s = Math.max(0, Math.min(L, st.s || 0));
      const x0 = rect.x + 34, x1 = rect.x + rect.w - 34, y = rect.y + 18;
      // A hairline over the band, so the ribbon reads as an instrument under the map rather than as
      // the bottom of it.
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
      // Miles, in the same unit the boards and the `route` verb use — see TILES_PER_MILE. A dash
      // that disagreed with a sign the driver just passed would make both useless.
      // ⚠ DERIVED FROM THE DESTINATION'S OWN MILEAGE, never counted here. The picker already prints
      // a total for this road and the server already says how far along it you are, so the two
      // together are the remaining distance — and it is the SAME total the driver read on the row
      // they picked. A second mileage computed on the client is the one that ends up disagreeing
      // with a board by the roadside.
      const cur = st.routes?.dests?.find((d) => d.current) || st.routes?.dests?.find((d) => d.key === st.aim);
      const total = cur?.miles;
      const left = total != null ? Math.max(0, Math.round(total * (1 - s / L))) : null;
      leg.innerHTML = `<b>${destName() || 'no fix'}</b>`
        + `<span class="td-dim"> · node ${(st.node || 0) + 1} of ${(st.nodes || 0) + 1}`
        + `${left != null ? ` · ${left} of ${total} miles to run` : ''}</span>`
        + `<div class="cab-gps-instr">${nextInstruction()}</div>`;
    }
    // ── THE INSTRUCTION ────────────────────────────────────────────────────────
    // Read off the ROAD, not off a route plan: `rdeg` is the corridor's own heading at the tile you
    // are on — the same number the auto-tiler and the sign posts are struck from — so the dash can
    // never tell you to bear left down a road that goes right. It is deliberately the tile you are
    // ON rather than one some distance ahead: the window is centred on the truck, a lookahead would
    // have to guess how far, and the bend radius is floored well above a tile (see MIN_RADIUS), so
    // the road under you and the road just ahead of you cannot disagree by much.
    //
    // ⚠ And it says nothing at all when it has nothing to say. A GPS that repeats "continue
    // straight" every second is one you stop reading, which is how you miss the one time it matters.
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
    // The rig's condition, as a GPS page. Deliberately the SAME rows the damage card draws — it
    // reads `st.dmg`, the payload the server already pushes — because two renderings of one set of
    // numbers is how two renderings end up disagreeing.
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
      // The one thing the picker says on its own account, and it is a statement about the ROAD
      // rather than a decision about the player: past the junction there is nothing to choose.
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
      // NOTHING IS REQUESTED ON OPEN. The tempting move is to ask the server for a fresh list, and
      // the only channel to hand is `trucksync` — which is TELEMETRY, clamped against wall-clock to
      // defend the odometer. Sending a synthetic one to provoke a reply would be feeding the
      // anti-cheat envelope a position the truck is not at, to refresh a menu. The cab is already
      // pushed on every tile change and once a second as a floor, so the list is at most a second
      // old, and the verb re-checks everything anyway.
      grabSeatKeys();
    };
    // Tabs, close, and the pop-out. All three are one delegated listener on the header, because
    // the header is one control strip and three listeners on three buttons is three chances for one
    // of them to be bound to an element that a re-render has since replaced.
    box?.querySelector('.cab-gps-hd')?.addEventListener('click', (e) => {
      const tab = e.target.closest?.('.cab-gps-tab');
      if (tab) {
        st.gpsApp = tab.dataset.app;
        for (const t of box.querySelectorAll('.cab-gps-tab')) t.classList.toggle('on', t === tab);
        renderGps();
        grabSeatKeys();                       // tapping the screen must not cost you the wheel
        e.preventDefault(); return;
      }
      if (e.target.closest?.('.cab-gps-x')) { st.toggleRoutePicker(false); e.preventDefault(); return; }
      if (e.target.closest?.('.cab-gps-pop')) {
        // POPPING OUT IS A CLASS, NOT A NEW WINDOW. The panel keeps its DOM, its listeners and its
        // renderers; all that changes is where it is positioned and that it now has a title bar you
        // can drag. Cloning it into a real dialog would have meant two of everything.
        const out = box.classList.toggle('cab-gps-out');
        if (out && !box.style.left) { box.style.left = '18vw'; box.style.top = '16vh'; }
        renderGps();
        grabSeatKeys();
        e.preventDefault(); return;
      }
    });
    // Dragging the popped-out unit by its header. Pointer capture, so it keeps following the finger
    // when the cursor outruns the box — the same reason every held control in this cab claims its
    // pointer.
    {
      const hd = box?.querySelector('.cab-gps-hd');
      let drag = null;
      hd?.addEventListener('pointerdown', (e) => {
        if (!box.classList.contains('cab-gps-out')) return;
        if (e.target.closest('.cab-gps-tab,.cab-gps-pop,.cab-gps-x')) return;   // buttons are buttons first
        const r = box.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        hd.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      });
      hd?.addEventListener('pointermove', (e) => {
        if (!drag) return;
        // Clamped to the window, or a panel dragged off the edge is a panel you cannot get back.
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
      // Straight to the verb, by key. No confirmation and no client-side refusal — if the road says
      // no, the road says so in its own words, in the log, where every other refusal lives.
      sendCmdSilent('route ' + btn.dataset.key);
      st.toggleRoutePicker(false);
      e.preventDefault();
    });
  }

  container.querySelector('.cab-orbitreset')?.addEventListener('click', () => {
    st.extYaw = 0; st.extPitch = EXT_REST_PITCH; st.extZoom = 1;
  });

  // ── THE DAMAGE HUD ─────────────────────────────────────────────────────────
  // Two densities over one payload. `renderDamage` is called from `cabContext` (the server push)
  // rather than from the frame loop, because damage changes when the server says so — a few times a
  // minute at most — and repainting four DOM bars at 60fps to show a number that has not moved is
  // the kind of cost that only shows up on somebody else's laptop.
  const dmgStrip = container.querySelector('.cab-dmg-strip');
  const dmgFull = container.querySelector('.cab-dmg-full');
  dmgStrip.addEventListener('click', () => {
    const open = dmgFull.hidden;
    dmgFull.hidden = !open;
    dmgStrip.setAttribute('aria-expanded', String(open));
  });
  st.renderDamage = (d) => {
    if (!d) return;
    // ── YOU HEAR IT BEFORE YOU READ IT ────────────────────────────────────────
    // A component crossing into a worse band is an EVENT, and the sound is how a driver finds out
    // about it with their eyes on the road. Fired from the band the server already computed rather
    // than from a threshold this file keeps its own copy of — the pip, the bar, the log line and
    // the noise then all change at exactly the same moment, which is the only version of this that
    // does not eventually read as a bug.
    //
    // ⚠ ONLY ON THE WAY DOWN. A repair also changes the band, and a bearing knock celebrating a
    // successful bench visit would be an odd thing to sit through.
    const prev = st.dmg;
    if (prev) {
      for (const part of DMG_PARTS) {
        const now = d[part.key], was = prev[part.key];
        if (!now || !was) continue;
        if (now.v < was.v && now.band !== was.band) damageCue(part.key, now.band);
      }
    }
    st.dmg = d;
    // The strip: one pip per component, and the WORST one drives whether the whole strip is
    // shouting. A driver should not have to read four pips to find out that one of them is red.
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
    // …and if the GPS is showing the rig page, it is showing THESE numbers, so it repaints here
    // rather than on a timer of its own.
    if (st.gpsApp === 'damage') st.renderGps?.();
  };

  // The controls card. Built from ONE table so the legend cannot drift from the buttons — every row
  // here names a control that exists above, and a control with no row is a control nobody finds.
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
  // Opening it ASKS. The list is not on the cab push and must not be — 'cabContext' runs several
  // times a second and an inventory join in it is a remote round trip per push, on the hottest path
  // this plugin owns. So one 'galley' the moment the flap opens, and never again until it opens
  // again. The bars are painted immediately from what the client already has, so the panel is never
  // blank while the reply is in flight.
  const galleyEl = container.querySelector('.cab-galley');
  const toggleGalley = (show) => {
    const open = show === undefined ? galleyEl.hidden : show;
    galleyEl.hidden = !open;
    container.querySelector('.cab-galleybtn')?.classList.toggle('on', open);
    if (open) {
      galleyEl.querySelector('.cab-galley-body').innerHTML = '<i class="cab-galley-wait">…</i>';
      paintGalleyVitals(st);
      // ⚠ FLAGGED AS OURS. See cabGalley: a reply the PANEL asked for must never re-open a flap the
      // driver has closed in the meantime.
      st.galleyAsked = true;
      sendCmdSilent('galley');
    }
  };
  // The latch. Sends the ordinary verb and waits for the payload — see paintLatch.
  container.querySelector('.cab-latchbtn').addEventListener('click', () => {
    sendCmdSilent(st.locked ? 'unlock cab' : 'lock cab');
  });
  paintLatch(st);

  container.querySelector('.cab-galleybtn').addEventListener('click', () => toggleGalley());
  galleyEl.querySelector('.cab-galley-x').addEventListener('click', () => toggleGalley(false));
  // Delegated, because the rows are rebuilt on every reply and a listener per row is a listener per
  // row to lose. Eating REFRESHES rather than closing: the commonest thing a driver wants after a
  // sandwich is the next sandwich, and the reply that comes back is the authority on what is left.
  galleyEl.addEventListener('click', (e) => {
    const b = e.target.closest?.('.cab-galley-item');
    if (!b) return;
    sendCmdSilent(b.dataset.cmd);
    st.galleyAsked = true;
    sendCmdSilent('galley');
  });
  st.toggleGalley = toggleGalley;
  st.renderGalley = (msg) => renderGalley(st, msg);

  // The pick-up button. Sends the BARE verb — the fugitive's sleeper-or-trailer question belongs to
  // the verb, which asks it in the log, and a panel that pre-empted that choice would be making the
  // one decision this whole system exists to put in front of a driver.
  container.querySelector('.cab-hitchalert').addEventListener('click', (e) => {
    if (e.target.closest?.('.cab-hitch-go')) sendCmdSilent('pickup');
  });


  st.raf = requestAnimationFrame(frame);
  return st;
}

// ── THE SHED BELONGS TO THE WORLD NOW, NOT TO THE GLASS ─────────────────────
//
// A haul starts inside a building, and for a while the shed around you was four CSS gradients and a
// slatted panel laid OVER the windscreen, lifted on a 2.4s keyframe with the throttle held dead
// underneath it. That was the right trick while a depot was one flat box in the render: the overlay
// was the only shed there was.
//
// The depot is a real model now — walls, a roof, an interior you sit in, and a roller door whose
// leaf rides the distance from your own bumper to the aperture (drawVehicleBay in windshield.js).
// So the overlay had become a SECOND door in front of the first one, running on its own clock: it
// opened whether or not the real one had, and it pinned the throttle at exactly the moment the real
// door needs you to roll at it to lift. Nothing replaces it — you are in the shed, and you drive out
// of the shed.

// The server's authoritative push. It owns the world window, the odometer and the surface; the
// client owns everything between frames. Position is NOT snapped from here unless the server has
// actually moved us (a bog), because yanking a driver's position 4×/s is the one thing that would
// make this feel worse than a text prompt.
// The 'galley' verb's reply, routed in from dispatch. A no-op with no cab up — the verb is an
// ordinary one and can be typed standing on a forecourt, where the log is the surface and this
// panel does not exist. Nothing here decides anything: the list, the verbs and the numbers on each
// row are all the server's, and this only paints them.
// ⚠ A REPLY WE ASKED FOR PAINTS; A REPLY THE PLAYER ASKED FOR OPENS. This used to open the flap
// unconditionally, which is why it would not close: opening it sends a silent `galley`, eating from
// it sends another, and both replies land a moment later and put the flap straight back up. Pressing
// ✕ during that window — which is most of the window, because the reply is a round trip — looked
// like a button that did nothing.
//
// The panel's own refreshes now stamp `galleyAsked`, so they only ever REPAINT. A player who types
// `galley` in the log has no stamp, and that still opens the flap, because asking for the galley
// is a request to see it.
export function cabGalley(msg) {
  if (!st) return;
  const ours = st.galleyAsked;
  st.galleyAsked = false;
  if (!ours) st.toggleGalley?.(true);
  st.renderGalley?.(msg);
}

export function cabContext(ctx) {
  if (!st) return;
  // A repair or a tune committed at the bench arrives on the next push, so a truck that got its
  // brakes back gets them back while you are sitting in it rather than at the next mount.
  if (ctx.params || ctx.typeId) setParams(ctx);
  if (ctx.condition != null) st.condition = ctx.condition;
  // The damage HUD repaints on the SERVER push, never in the frame loop — see renderDamage.
  if (ctx.dmg) st.renderDamage?.(ctx.dmg);
  // Interned: see panels/map-intern.js.
  if (ctx.map) { st.map = internMap(st.map, st.mapX, st.mapY, ctx.map, ctx.mapX, ctx.mapY); st.mapX = ctx.mapX; st.mapY = ctx.mapY; st.renderMapApp?.(); }
  // The South Lock: you rolled out on amber. The lamps are already red in the map above.
  if (ctx.lockAlarm) lockKlaxon();
  // The road past the edge of that window, as polylines in absolute world tiles — the cab window is
  // 30 tiles and the ground runs to the horizon. Same 'undefined vs null' rule as the two lines
  // below: null is the server saying there is no road in range, and it has to CLEAR.
  if (ctx.roads !== undefined) st.roads = ctx.roads;
  // The towers past the window and the region's colour grade. They ride every eighth tile, not every
  // push (trucking/state.js farView), so an absent key keeps what the cab already has.
  if (ctx.skyline) st.skyline = ctx.skyline;
  if (ctx.regions) st.regions = ctx.regions;
  // The street population, paired with the map. An empty list is a real answer, not an absent one —
  // see the same note in cockpit.js flightSimContext.
  if (ctx.actors !== undefined) st.actors = ctx.actors;
  // The one figure on the corridor. Same 'undefined vs null' rule as the list above: null is the
  // server saying nobody is out there, and only an absent key leaves the last answer standing.
  if (ctx.hitcher !== undefined) { st.hitcher = ctx.hitcher; paintHitchAlert(st); }
  if (ctx.locked !== undefined) { st.locked = !!ctx.locked; paintLatch(st); paintHitchAlert(st); }
  st.s = ctx.s ?? st.s; st.L = ctx.L ?? st.L;
  st.aim = ctx.aim !== undefined ? ctx.aim : st.aim;
  if (ctx.routes !== undefined) { st.routes = ctx.routes; st.renderRoutePicker?.(); }   // what the GPS names — the route verb owns the aiming
  // THE DASH IS DEAD (an EMP pulse caught the rig). One flag, and everything that is
  // a SCREEN reads it: the nav head here and its 3-D face on the dash. The road, the
  // mirrors, the weather and the wheel are untouched, because none of them is a
  // screen. ⚠ It repaints the unit on the EDGE rather than every push — the panel is
  // re-rendered whenever the flag changes in either direction, so the "no signal"
  // card arrives the instant the pulse lands and is gone the instant it reboots.
  if (ctx.elecOut !== undefined && !!ctx.elecOut !== !!st.elecOut) { st.elecOut = !!ctx.elecOut; st.renderGps?.(); }
  st.node = ctx.node ?? st.node; st.nodes = ctx.nodes ?? st.nodes;
  if (ctx.surface) st.input.surface = ctx.surface;
  // The dirt, four times a second like everything else here. It is assigned rather than merged and
  // it is the SERVER's number in every case: a wash committed at a bench arrives on this push, and
  // a client that kept accruing its own would put the muck straight back on.
  if (ctx.grime != null) st.grime = ctx.grime;
  if (ctx.fits !== undefined) FITS = ctx.fits || '';
  // …stamped on arrival, which is what gives contactsFor an age to reckon from.
  if (ctx.contacts) {
    st.contacts = ctx.contacts.map(c => ({ ...c, t: performance.now() }));
    (st.contactTrack || (st.contactTrack = makeContactTrack())).update(ctx.contacts);
  }
  // THE BOXES STANDING IN THE YARD. They arrive in the same contact shape the aircraft do (see
  // trailers.js trailersNear), so they need no renderer of their own — they are concatenated into
  // the contact list below and drawn by the same code that draws another player's rig.
  if (ctx.trailers) st.trailers = ctx.trailers.map(c => ({ ...c, t: performance.now() }));
  if (ctx.hitchable !== undefined) { st.hitchable = ctx.hitchable; paintHitchBtn(st); }
  // The pump under the nose, and the balance the handle meters against. `null` is a real answer —
  // it is most of the world — so this assigns rather than merges.
  if (ctx.pump !== undefined) { st.pump = ctx.pump || null; paintPumpBtn(st); paintFuelGauge(st); }
  // Out of diesel: the server says so and the pedal stops meaning anything. It clamps the speed
  // its own side too — this is the feel, not the enforcement.
  if (ctx.dry != null) { st.dry = !!ctx.dry; paintFuelGauge(st); }
  // The tank has been in this payload since phase 1 (state.js packs `fuel`) and the cab has never
  // read it — a driver got a boolean at the moment they ran out and nothing at all before it. The
  // gauge is the warning; running dry with a needle on the peg is the driver's fault, which is the
  // only version of that event worth having.
  // ⚠ NOT WHILE THE HANDLE IS DOWN. A push lands about once a second, and the server's fuel is the
  // pre-pour figure until the commit — so accepting it mid-pour drags the needle back to where the
  // tank was every second while the driver is watching it rise. The commit's own push (`pumped`)
  // arrives after the handle is released and lands normally, which is the correction that matters.
  if (ctx.fuel != null && !st.pumping) { st.fuel = Math.max(0, Math.min(1, ctx.fuel)); paintPumpBtn(st); paintFuelGauge(st); }
  if (ctx.broken !== undefined) st.broken = ctx.broken || null;
  if (ctx.hour != null) st.hour = ctx.hour;
  if (ctx.moon != null) st.moon = ctx.moon;
  if (ctx.wind != null) st.wind = ctx.wind;
  // ⚠ `wxField` MAY LEGITIMATELY BE NULL — the field packet is omitted on a day with no cells at
  // all — so these take the key's PRESENCE as the signal, not its truthiness. Written as `!==
  // undefined` the way `ctx.trailer` and `ctx.broken` already are; `if (ctx.wxField)` would pin
  // the last storm's cells to the canopy for the rest of the haul once the sky cleared.
  if (ctx.wxField !== undefined) st.wxField = ctx.wxField || null;
  // The ground's own state, same latch and same reason: it is absent from a push that carries no
  // sky rather than meaning "dry and bare".
  if (ctx.wxGround !== undefined) st.wxGround = ctx.wxGround || null;
  if (ctx.wxEvent !== undefined) st.wxEvent = ctx.wxEvent || null;
  if (ctx.weather) {
    st.weather = ctx.weather;
    // Ask once, on the control itself. A driver who has never needed the stalk has no reason to
    // know it is there, and the moment they do need it is the moment rain starts hitting the glass.
    // paintWipers reads the weather (cabWet), so the hint follows it.
    st.paintWipers?.();
  }
  if (ctx.weather || ctx.wxEvent !== undefined) touchWipers(st);
  // The trailer is the SERVER's fact; φ is the CLIENT's simulation of it — the same split as
  // everything else in the cab. Hitching mid-drive straightens the box behind us rather than
  // snapping it to an angle nobody drove it to.
  if (ctx.trailer !== undefined) {
    const want = !!ctx.trailer;
    if (want !== st.sim.hitched) { st.sim.hitched = want; st.sim.phi = 0; st.sim.trailerHeading = st.sim.heading; }
    st.sim.trailerKg = ctx.trailer?.kg || 0;
    st.sim.loadKg = ctx.trailer?.loadKg || 0;
  }
  if (ctx.bogged) { st.sim.x = ctx.x; st.sim.y = ctx.y; st.sim.heading = ctx.heading; st.sim.speed = 0; }
}

// ── Collision ────────────────────────────────────────────────────────────────
// The flight sim's CFIT probe, at ground level. `groundObstructionAt` is the shared geometry (see
// windshield.js) — the same segments the building is DRAWN from, so what you can see is what you
// can hit, and a model that changes shape on a seed collides as it actually looks.
//
// THREE AVIATION GATES ARE DELIBERATELY DROPPED from cockpit.js's buildingCollisionAt:
//   • `if (s.onGround) return null` — the entire premise there, and the opposite of ours
//   • the "must be visible on the glass" window (VISIBLE_NEAR_F..VISIBLE_FAR_F) — an aircraft
//     rule ("a building that isn't drawn can't hurt you"); at 15 tiles of ground fog it would
//     make near buildings non-solid, which is worse than the problem it solves
//   • the altitude penetration test — at ground level any obstruction is a hit
//
// What is KEPT is the sweep, and it is the important part: a truck at 68 mph covers most of a tile
// between frames, so testing only the endpoint would let it tunnel clean through a wall.
const SWEEP = 4;
const TRUCK_CLEAR_Z = 0.010;   // cab roof in render world-z (FLOOR_Z is one storey ≈ 0.028)
// …and the other end of the rig: TRUCK_STEP_Z, the height below which a thing is ridden over rather
// than hit. It lives in windshield.js beside the probe that reads it, because the model arms that
// draw a kerb have to be able to check what counts as one. See the note on it there — the forecourt
// islands were colliding as walls until this existed.
const BUMP_MPH = 12;           // at or below this it is a bump; above it, you hit something
// Below this the server is never told at all. A kerb at walking pace is not an incident and does
// not need a sentence in the log — the rebound and the jolt on the glass have already said it.
const REPORT_MPH = 6;

// The physical answer to a wall, on the glass rather than in the log. Scaled by how hard you came
// in, so a nudge is a twitch and a real hit throws the whole view — which is the feedback that
// makes the printed line unnecessary at low speed.
function bumpJolt(mph) {
  const wrap = st?.container?.querySelector('.cab-wrap');
  if (!wrap) return;
  if (document.documentElement.getAttribute('data-motion') === 'off') return;
  wrap.classList.remove('cab-jolt', 'cab-jolt-hard');
  void wrap.offsetWidth;                                   // restart the animation on a repeat hit
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
  // The cells round a point, for the South Lock's walls (see lockWallZAt in windshield.js).
  // ⚠ NOT WHEN THE RIG STARTS INSIDE ONE. The outer door comes down on a lockdown, and a rig that
  // was in the doorway at that moment must be able to back out of it rather than be held in it.
  const near = (x, y) => { const r = map[Math.round(y - mc.y + R)]; return r && r[Math.round(x - mc.x + R)]; };
  const fx = Math.round(from.x), fy = Math.round(from.y);
  const lockAt = groundObstructionAt(fx, fy, null, from.x, from.y, TRUCK_CLEAR_Z, TRUCK_STEP_Z, near) > 0 ? null : near;
  let worst = 0;
  for (let i = 1; i <= SWEEP; i++) {
    const t = i / SWEEP;
    const px = from.x + (st.sim.x - from.x) * t, py = from.y + (st.sim.y - from.y) * t;
    const wx = Math.round(px), wy = Math.round(py);
    // Cheap reject before the per-segment maths, same as the flight sweep.
    if (Math.abs(px - wx) > MODEL_MAX_EXTENT * (RENDER_TUNE.bldgFoot || 1)) continue;
    const rx = Math.round(wx - mc.x + R), ry = Math.round(wy - mc.y + R);
    const cell = map[ry] && map[ry][rx];
    if (!cell) continue;
    const z = groundObstructionAt(wx, wy, cell, px, py, TRUCK_CLEAR_Z, TRUCK_STEP_Z, lockAt);
    if (z > worst) worst = z;
  }
  return worst;
}

// A shift, as a sound. Two cues rather than a sample: the lever through the gate (a short metal
// impact, dry) and the clutch taking the load again a beat later (a softer thud). Built from the
// same procedural generator everything else in the game uses, so it sits in the mix correctly and
// costs no asset.
function shiftCue(half, toNeutral) {
  const A = window.AudioEngine, S = window.ProceduralSFX;
  if (!A || !S) return;
  const cue = (o, gain, delay = 0) => {
    const fire = () => { try { const d = S.buildActionCue(o); if (d) A.playSfx(d, gain); } catch { /* never load-bearing */ } };
    if (delay) setTimeout(fire, delay); else fire();
  };
  const seed = 3300 + ((performance.now() | 0) % 997);   // the gate is never quite the same twice
  cue({ action: 'impact', surface: 'metal', intensity: half ? 0.28 : 0.5, seed }, half ? 0.16 : 0.3);
  // Into neutral there is nothing to take up — the second half of the sound is the clutch biting,
  // and in neutral it never does.
  if (!toNeutral) cue({ action: 'impact', surface: 'rubber', intensity: half ? 0.2 : 0.36, seed: seed + 41 }, half ? 0.12 : 0.22, half ? 90 : 150);
}

// A MISSED SHIFT, as a sound: dog teeth skating off each other, which is a SCRAPE rather than the
// impact a clean shift makes. Deliberately the loudest thing the gearbox can do — the whole point
// of a grind is that it is unmistakeable and slightly awful, and a subtle one would be a mechanic
// nobody notices they are failing. Two overlapping scrapes at different seeds so it rasps rather
// than pings, and a dry metal knock under it for the lever hitting the gate.
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

// The key, as a sound. Turning it OFF is one soft mechanical click and then the absence of an
// engine, which the engine audio does for free the moment rpm goes to zero — so there is nothing to
// play but the switch. Turning it ON is the switch plus the starter, and the starter is deliberately
// NOT a triumphant noise: it is a big cold motor churning, and whether it catches is the model's
// business, not this cue's.
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

// ── THE RIG, SEEN FROM OUTSIDE ───────────────────────────────────────────────
// There is nothing here but a caption, and that is the point.
//
// This used to be a hand-rolled eight-corner box painted over the finished frame, because the
// renderer was told to hide its own model ('hideOwnShip'). Two things were wrong with that and
// they were the same thing: a box has no BOBTAIL — a tractor with nothing behind it read as a slab
// the same as a loaded one — and the camera it drew through was a RESTATEMENT of the renderer's
// three numbers rather than the renderer's own, so an orbit turned the world under a rig that
// stayed put. Both are gone with the model: the truck is now the same 'buildTruck' mesh the depot
// floor and everybody else's windscreen draw, through the same own-ship chase path the aircraft
// use, so heading, ground anchoring, scale and the empty silhouette all come from one place.
//
// What could NOT come from there is this: the renderer knows what a truck looks like and nothing
// about what it is doing. Jackknifing is a fact about the drive, said on the picture because this
// is the view you would see it happening in.
// THE HITCH BUTTON'S WHOLE BEHAVIOUR, in one place: it is present when there is something to do
// with the fifth wheel and absent otherwise, and the label says WHICH box. Driven off the server's
// own `hitchable` (state.js), never from a client-side guess at distance — the cab does not own the
// rule and must not appear to.
function paintHitchBtn(st) {
  const el = st?.container?.querySelector('.cab-hitchbtn');
  if (!el) return;
  const coupled = !!st.sim?.hitched;
  const target = st.hitchable;
  const show = coupled || !!target;
  el.hidden = !show;
  if (!show) return;
  // COUPLED IS THE KNOB PUSHED IN. The 'out' class is the knob standing proud of its collar with the
  // lamp lit, which is a bobtail with something in reach; without it the knob is home and flush.
  // The stamped word is the ACTION, not the state — a hand on a push-pull knob wants to be told
  // which way to move it, and the lamp above already says whether anything is connected.
  const w = el.querySelector('.cab-knobface em');
  if (w) w.textContent = coupled ? 'PULL' : 'PUSH';
  el.classList.toggle('out', !coupled);
  el.setAttribute('aria-label', coupled ? 'Trailer air supply: pull to release' : 'Trailer air supply: push to couple');
  el.setAttribute('title', coupled
    ? 'Pull the air supply and drop the trailer here (unhitch)'
    : `Push the air supply in and couple to ${target?.name || 'the trailer'} (hitch)`);
}

// THE PUMP HANDLE'S PRESENCE, on the same rule as the hitch knob above: the world affords it or it
// is not on the panel. Three conditions, and each is a different kind of "there is nothing to do
// here" — no pump under the nose, the tank already full, or a driver who cannot pay for a splash.
// The last one is why the balance rides in the payload at all: a handle you can grab and get
// nothing out of is worse than a handle that is not there.
function paintPumpBtn(st) {
  const el = st?.container?.querySelector('.cab-pumpbtn');
  if (!el) return;
  const p = st.pump;
  const room = 1 - (st.fuel ?? 1);
  const show = !!p && room > 0.02 && (p.credits || 0) >= Math.round((p.full || 380) * 0.01);
  el.hidden = !show;
  if (!show) return;
  // What a full one costs, said before you pull it rather than after. The tooltip is the price
  // board; the readout while held is the meter.
  el.setAttribute('title', `Diesel: ${p.full}₵ a tank, ${Math.round(room * p.full)}₵ to fill this one.`
    + ` HOLD the handle: it fills while you hold it and charges you when you let go.`);
  el.setAttribute('aria-label', `Fuel pump: hold to fill, ${Math.round(room * p.full)} credits for a full tank`);
}

// ── THE GLASS FUEL GAUGE ─────────────────────────────────────────────────────
// Painted from the SAME `st.fuel` the dash dial reads and the pump handle moves, so all three
// always agree — including mid-pour, where `st.fuel` is the client's optimistic needle and the
// server's number lands a beat later (see the pump handle for that split).
//
// ⚠ WHEN IT IS UP is the whole design of it. In the external view there is nothing else that reads
// out anything at all, so it is always up. In the cab the dash already has the dial, so this only
// appears when there is a reason to watch: at a pump, or under the reserve mark, where the number
// stops being scenery and becomes a decision. A permanent second gauge six inches from the first
// would be the sort of HUD clutter this cab has otherwise been careful not to grow.
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
  // The note line is the one place the gauge says anything: the rate you are being charged while
  // the handle is down, and what it would cost to fill from here while you are stood at a pump.
  // Two decimals, because that is the number on the pylon outside and they have to be the same
  // price said twice — see `each` on the fuel.prices row.
  const p = st.pump;
  q('.cab-fuel-note', st.pumping && p ? `${(p.full / 100).toFixed(2)}/%`
    : p ? `${Math.round((1 - f) * p.full)}₵ to fill` : low ? 'RESERVE' : '');
  el.setAttribute('aria-label', `Fuel ${pct} percent${low ? ', reserve' : ''}`);
}

// ── THE PERSON IN THE SEAT ───────────────────────────────────────────────────
// Everything else on this glass reads out the TRUCK. This reads out the driver, and it is the only
// thing between a long haul and dying of thirst with a full tank and four green damage pips.
//
// ⚠ NOTHING HERE ASKS THE SERVER ANYTHING. 'gameState.player' is the same object the vitals rail
// under the log is drawn from, updated by every 'player_update' and every 'resource_tick'. So the
// band and the bars are free, they can never disagree with the rail, and there is no cab-only copy
// of a number the rest of the client already has.
//
// The two thresholds are not a taste call. RED is 0, because 0 is exactly where the resource tick
// starts taking HP (see gameLoop.js) — the flash is not a prediction, it is the damage, reported.
// AMBER is early enough to still be a decision rather than an announcement.
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
  // Thirst first when both are biting. It kills twice as fast (−2 HP a tick against hunger's −1),
  // so if a driver only reads one word before looking back at the road it has to be that one.
  const rows = [];
  if (v.thirst <= VIT_AMBER) rows.push({ w: 'THIRST', dead: v.thirst === 0 });
  if (v.hunger <= VIT_AMBER) rows.push({ w: 'HUNGER', dead: v.hunger === 0 });
  if (!rows.length) { el.hidden = true; el.textContent = ''; return; }
  const txt = rows.map(r => r.w).join('  ·  ');
  el.hidden = false;
  // Written only on CHANGE. This runs several times a second and the band sits in an aria-live
  // region — reassigning identical text is what makes a screen reader say 'HUNGER' forever, which
  // is the accessibility version of the flashing it is already doing visually.
  if (el.textContent !== txt) el.textContent = txt;
  el.classList.toggle('bad', rows.some(r => r.dead));
}
// The bars in the flap. Same two numbers, said as figures for anyone who wants to know how much
// road they have rather than merely that they are in trouble.
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
// The list itself, from the verb's own reply. One row per thing, one button per row, and the button
// sends the exact verb string the log printed — a player using this panel and a player typing are
// running the identical command.
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
    // What it is WORTH, because the whole reason to open this flap is to decide which of three
    // things to spend. Straight off the item's own restore tags — the panel derives nothing.
    const gain = [i.food ? '+' + i.food + ' food' : '', i.water ? '+' + i.water + ' water' : ''].filter(Boolean).join('  ');
    const qty = i.qty > 1 ? ' ×' + i.qty : '';
    return '<button class="cab-galley-item" data-cmd="' + cmd + '">'
      + '<b>' + i.verb.toUpperCase() + '</b>'
      + '<span>' + i.name + qty + '</span>'
      + '<em>' + gain + '</em></button>';
  }).join('');
  paintGalleyVitals(st);
}
// SOMEBODY ON THE SHOULDER, as something that stays on the screen. The renderer draws the figure
// out on the road; this is the half that survives a driver looking at the gearbox for four seconds,
// which is the entire reason the feature needed anything at all — a single emote at a node boundary
// is a notification you can miss by blinking.
//
// It shows what the ROADSIDE can tell you and no more: how they are standing, and nothing about
// what they will do. That restraint is the system's own rule (hitchers.js) — every one of them is
// worth stopping for and every one can cost you, and you cannot tell which from out here.
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
  // ⚠ THE KEY IS THE PERSON *AND* THE LATCH. Keyed on the token alone, a driver who locked up
  // while somebody was in front of them went on reading a card that said the doors were open.
  const key = hh.t + (st.locked ? '|L' : '|O');
  if (el.dataset.tok === key) return;       // unchanged — never rebuild under a hand
  el.dataset.tok = key;
  el.hidden = false;
  // WHAT THE DOOR IS DOING, said here rather than left to the button in the corner. This is the one
  // moment the latch state is load-bearing, and a driver reading this card is by definition looking
  // at the road and not at the chrome. It is a statement of fact, never a warning: stopping with the
  // doors open is a legitimate way to pick somebody up, and the card must not editorialise about a
  // choice the player has not made yet.
  el.innerHTML = '<b>ON THE SHOULDER</b>'
    + '<span>' + (HITCH_LOOK[hh.kind] || 'Somebody with a hand out.') + '</span>'
    + '<em>' + (st.locked
        ? "Doors latched. Stopping isn't enough, pick them up if you mean to."
        : 'Doors are open. Stop for a moment and they will get in by themselves.') + '</em>'
    + '<button class="cab-hitch-go">PICK UP</button>';
}

// THE DOOR LATCHES. Two states, and the button reads out the one you are IN rather than the one
// pressing it would take you to — a control labelled with its own action is fine for a horn and
// wrong for a lock, where the entire question a driver has is "is it down right now".
//
// The server owns it (it persists per truck in custom_data, and the 'lock' verb can change it
// without this panel being involved), so this paints 'st.locked' and never toggles it locally. A
// button that flipped its own class and then waited for the payload would show the wrong state for
// a round trip, which on the one control whose value is certainty is worse than showing nothing.
function paintLatch(st) {
  const el = st?.container?.querySelector('.cab-latchbtn');
  if (!el) return;
  const locked = !!st.locked;
  el.classList.toggle('on', locked);
  el.setAttribute('aria-pressed', locked ? 'true' : 'false');
  // ⚠ THE PADDLE, NOT THE BUTTON. This wrote el.textContent while the latch was a chrome pill with
  // nothing inside it. It is a rocker on the switch panel now — a tell-tale, a paddle and a legend
  // — and writing textContent on one of those deletes the switch and leaves a word behind.
  const legend = el.querySelector('u span') || el;
  const txt = locked ? 'LOCKED' : 'OPEN';
  if (legend.textContent !== txt) legend.textContent = txt;
  el.title = locked
    ? 'Cab doors are latched. Nobody gets in (Y)'
    : 'Cab doors are open. Stop beside somebody and they can let themselves in (Y)';
  el.setAttribute('aria-label', locked ? 'Cab doors locked' : 'Cab doors unlocked');
}

// ── THE PUMP, AS A SOUND ─────────────────────────────────────────────────────
// Diesel going into a tank is three things at once and none of them is a sample: the rush of the
// liquid, the pump's own motor under it, and the meter counting. Built from the shared generator
// the rest of the game uses (`pour` for the flow, `impact` for the mechanism), so it sits in the
// mix at the right level and costs no asset — the same argument as every other cue in this file.
//
// ⚠ RE-FIRED ON A CADENCE, NOT LOOPED. The generator produces one-shot cues; there is no sustain
// primitive, and inventing one for this would be a second audio path to maintain. So the flow is a
// short `pour` re-fired just inside its own length, which reads as continuous, and it is driven
// from the SAME 50ms tick that moves the needle — no second timer to leak if the panel closes
// mid-pour.
//
// ⚠ AND IT VARIES. Every cue in the shared generator jitters (see `vary`), which is exactly right
// here: a pump re-firing an identical 400ms burst reads as a stuck loop, and the whole reason this
// is generated rather than sampled is that it never has to.
const PUMP_FLOW_MS = 380;
function pumpFlowCue(seed) {
  const A = window.AudioEngine, S = window.ProceduralSFX;
  if (!A || !S) return;
  try {
    const flow = S.buildActionCue({ action: 'pour', material: 'liquid', flow: 0.42, intensity: 0.5, seed });
    if (flow) A.playSfx(flow, 0.16);
    // The motor, an octave under the rush — a short, dull metal knock is what a diaphragm pump
    // sounds like through a hose, and re-firing it on the same cadence gives the flow a pulse.
    const motor = S.buildActionCue({ action: 'impact', surface: 'metal', intensity: 0.12, seed: seed + 17 });
    if (motor) A.playSfx(motor, 0.07);
  } catch { /* audio is never load-bearing */ }
}
// The nozzle going in, and the handle clicking off. Two ends of the same act, and the second one is
// the sound a driver is actually listening for.
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
//
// Two effects that share a function because they share a cause and must never disagree: the dust
// the wheels are throwing RIGHT NOW, and the film that dust has left on the windscreen over the
// last four hundred miles.
//
// IT IS DRAWN, NOT SIMULATED. There is no particle system here and there should not be — the
// windscreen is a 2D overlay over a Mode-7 world, so a real 3D dust volume would need depth it
// cannot have and would cost a frame budget the cab is already the tightest consumer of. What a
// driver actually reads is a warm haze low in the frame that pulses with the throttle and dies
// when they stop, and that is four gradients and a scatter of specks.
//
// ⚠ THE SPECKS ARE HASHED, NOT ROLLED. A Math.random() per speck per frame is boiling static that
// reads as television snow rather than as dirt; each speck's lane and lifetime come from its own
// index through a stable hash and it moves on a CLOCK, so it drifts past you. Same reason the
// world renderer's star grain is hashed.
//
// ⚠ AND THE FILM NEVER HIDES A CONTACT. It is a wash over the outer frame, capped low — see
// FILM_MAX. A driver must never fail to see a truck coming because of a cosmetic system: the
// moment dirt costs you information, washing stops being taste and becomes a tax, which is
// precisely the design this was built not to be.
const FILM_MAX = 0.30;                 // the dirtiest a windscreen is ever allowed to get
// How much loose material each surface has to throw. The same vocabulary the server answers in
// (`surfaceUnder`), so nothing here maps terrain — and the tarmac is deliberately not zero,
// because a highway at speed does throw grit and that is half of what was asked for.
const DUST_SURFACE = { road: 0.22, dirt: 0.8, shoulder: 0.95, offroad: 1 };
// Rain kills the plume outright: wet ground does not lift. It does NOT clear the film (see the
// RAIN_FLOOR note in filth.js) — a wet road is exactly when a windscreen is at its worst.
const DUST_WET = { rain: 0.1, storm: 0.05, snow: 0.15 };
const hash1 = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function drawRoadFilm(st, dt) {
  const cv = document.getElementById(st.id);
  if (!cv || !cv.getContext || !cv.clientWidth) return;
  const grime = Math.max(0, Math.min(1, st.grime || 0));

  // ── how hard the wheels are working the ground ──
  // Speed against a nominal motorway rather than against the truck's own top speed: a Krell flat
  // out throws what a Continental at the same road speed throws, because it is the same road.
  const mph = Math.abs(st.sim?.speed || 0);
  const roll = Math.min(1, mph / 55);
  const loose = DUST_SURFACE[st.input?.surface] ?? DUST_SURFACE.road;
  const wet = DUST_WET[st.weather] ?? 1;
  // …and the throttle, because a driver who stands on it in the dirt should SEE it. Squared, so it
  // is the last third of the pedal that does it rather than every touch.
  const dig = 1 + 0.5 * Math.pow(st.input?.throttle || 0, 2);
  const want = Math.min(1, roll * loose * wet * dig);
  // The plume has inertia both ways — it builds behind you and it hangs after you lift. Without
  // the lag it strobes with the throttle, which reads as a fault rather than as air.
  const k = Math.min(1, (dt || 0.016) * 2.4);
  st.dust = (st.dust || 0) + (want - (st.dust || 0)) * k;
  const dust = st.dust;

  // The film thins for as long as the blades are moving, and a little more the faster they go. It
  // is NOT cleared: a dry wiper on a dusty screen smears, which every driver knows, so the best a
  // stalk can do in here is take the edge off it.
  const wipe = 1 - 0.22 * Math.min(3, st.wipers | 0) / 3;
  const film = Math.min(FILM_MAX, grime * 0.34) * wipe;
  if (film < 0.004 && dust < 0.01) return;

  const g = cv.getContext('2d');
  const kx = cv.width / cv.clientWidth;
  const W = cv.clientWidth, H = cv.clientHeight;
  g.save();
  g.setTransform(kx, 0, 0, kx, 0, 0);

  // ── THE FILM ──
  // Heaviest at the corners and along the bottom of the glass, which is where a blade does not
  // reach and where the cowl throws it. A flat wash over the whole screen would read as a colour
  // grade on the world rather than as something ON the glass a hand's width in front of you.
  if (film > 0.004) {
    const rad = g.createRadialGradient(W * 0.5, H * 0.46, Math.min(W, H) * 0.18, W * 0.5, H * 0.5, Math.max(W, H) * 0.72);
    rad.addColorStop(0, 'rgba(126,106,74,0)');
    rad.addColorStop(0.62, 'rgba(126,106,74,' + (film * 0.5).toFixed(3) + ')');
    rad.addColorStop(1, 'rgba(108,90,62,' + film.toFixed(3) + ')');
    g.fillStyle = rad; g.fillRect(0, 0, W, H);
    // The dried run-off along the bottom edge — the one part of a windscreen nothing ever cleans.
    const lin = g.createLinearGradient(0, H, 0, H * 0.72);
    lin.addColorStop(0, 'rgba(96,80,56,' + (film * 1.25).toFixed(3) + ')');
    lin.addColorStop(1, 'rgba(96,80,56,0)');
    g.fillStyle = lin; g.fillRect(0, H * 0.72, W, H * 0.28);
  }

  // ── THE PLUME ──
  // A warm veil off each bottom corner, where the drive wheels are. Two of them rather than one
  // band across the floor, because a single band reads as fog and a pair reads as WHEELS, which is
  // the one thing this effect has to say.
  if (dust > 0.01) {
    const a = dust * (0.10 + 0.16 * loose);
    for (const sx of [0.13, 0.87]) {
      const r = g.createRadialGradient(W * sx, H * 1.02, 0, W * sx, H * 1.02, Math.min(W, H) * (0.42 + 0.2 * dust));
      r.addColorStop(0, 'rgba(158,134,96,' + (a * 1.4).toFixed(3) + ')');
      r.addColorStop(0.5, 'rgba(150,126,90,' + (a * 0.55).toFixed(3) + ')');
      r.addColorStop(1, 'rgba(150,126,90,0)');
      g.fillStyle = r; g.fillRect(0, H * 0.5, W, H * 0.5);
    }
    // …and the grit itself, going up past the glass. The count scales with the plume, so an idling
    // truck draws none at all, and every speck is a short streak rather than a dot — a dot at this
    // speed is a dead pixel, and a streak is something going past you.
    const n = Math.round(dust * 46);
    const t = performance.now() / 1000;
    g.strokeStyle = 'rgba(196,172,132,' + (0.10 + 0.30 * dust).toFixed(3) + ')';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      // Each speck owns a lane, a lifetime and a phase. Rising, because the air off a turning
      // wheel goes up — dust that fell would read as snow.
      const life = 0.5 + hash1(i * 3.1) * 0.9;
      const ph = (t / life + hash1(i * 7.7)) % 1;
      const lane = hash1(i * 5.3);
      // Pushed toward the edges of the screen by the same argument the veils are: the middle of
      // the glass is the part you are looking through, and is the last place to put moving clutter.
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
//
// A shift is four beats and it takes about as long as it takes a person: dip the clutch, pull it
// out through neutral, push it into the slot, let the clutch up. Every beat writes the controls a
// player writes — see setAuto for why that is not negotiable — so the box can still be fluffed, the
// engine can still be lugged, and the readouts have nothing new to learn.
//
// ⚠ WHILE IT IS MID-SHIFT THE DRIVER OWNS THE CLUTCH, and it must therefore not fight the pedal:
// a player who stamps on the clutch during an auto shift is doing the same thing the driver is, and
// a player who latches it is entitled to. So the release beat only lets the pedal up if nothing
// human is holding it down.
const SHIFT_DIP = 0.16;      // s — the pedal going in before the lever moves at all
const SHIFT_OUT = 0.20;      // s — out of the old gear, sat in neutral (the pause you can SEE)
const SHIFT_IN = 0.22;       // s — across the gate and into the new slot
const SHIFT_COOL = 0.45;     // s — how soon after one shift it will consider another
// ⚠ THE FLOOR UNDER THE OVERRUN RULE, AND THE REASON IT HAS TO EXIST. "Never downshift off the
// throttle" (see below) is right for a lift at cruise and fatal on the way to a stop — slowing down
// is precisely when a driver goes DOWN the box, and written as a throttle gate ALONE the automatic
// did nothing at all on a closed throttle: it sat in eighth from the bottom of the band (72 mph in
// a Drayman) the whole way down to the stall speed of that gear (19), and then shut the engine off.
// Which is the one failure a driver who switched the assist ON is least equipped to read.
//
// So under this the throttle stops being consulted. It sits well below `band[0]` (0.42), so an
// ordinary lift never starts it walking down the box, and well above `STALL_RPM` (0.11) with a
// whole ratio step (~1.3×) of headroom — one save lands back around 0.34, which is what lets the
// chain run a gear at a time instead of needing to catch the whole box in one grab.
const SAVE_RPM = 0.26;
function autoShift(dt) {
  const seq = st.shiftSeq;
  if (seq) {
    seq.t += dt;
    if (seq.phase === 'dip') {
      st.input.clutch = 1;                       // the pedal, not a flag: the model reads this one
      if (seq.t >= SHIFT_DIP) { seq.phase = 'out'; seq.t = 0; st.selectGear?.(0); }
    } else if (seq.phase === 'out') {
      st.input.clutch = 1;
      if (seq.t >= SHIFT_OUT) { seq.phase = 'in'; seq.t = 0; st.selectGear?.(seq.to); }
    } else if (seq.phase === 'in') {
      st.input.clutch = 1;
      if (seq.t >= SHIFT_IN) { seq.phase = 'up'; seq.t = 0; }
    } else {
      // Let it up — unless a hand is on it (see the ⚠ above).
      if (!st.heldBy?.clutch && !st.clutchLatched) st.input.clutch = 0;
      st.shiftSeq = null;
      st.shiftCool = SHIFT_COOL;
    }
    return;
  }
  if (st.shiftCool > 0) st.shiftCool -= dt;
  if (!st.auto || !P) return;
  // ── WHAT SUSPENDS THE AUTOMATIC, AND WHY IT IS A SUSPENSION ─────────────────
  // Reverse is deliberately never chosen FOR you — which way a truck is pointed when it moves is the
  // one decision that must stay with the person who can see out of the window. But that is a reason
  // for the automatic to have NOTHING TO DO while reverse is selected, not a reason to switch it
  // off: come back out of reverse and the driver has not changed their mind about how they want to
  // drive, and a box that quietly reverted to manual behind them is a box that stopped shifting for
  // no reason they can see. The park brake is the same argument (see setPark, which used to call
  // setAuto(false) here and is what actually made "AUTO is off after reversing" happen — you stop,
  // you park, you select R, and the switch you never touched is gone by the time you pull away).
  // So both are inhibits, tested every tick and clearing themselves.
  if (st.dry || st.broken || st.sim.stalled || st.sim.gear < 0 || st.park) return;
  // ⚠ AND THE COOLDOWN GATES A DECISION, NOT A RESCUE. `SHIFT_COOL` exists so the box does not hunt
  // at a ratio boundary — but an engine already under `SAVE_RPM` is not a boundary case, it is out
  // of revs, and a driver going down the box in front of a junction does not wait half a second
  // between grabs. It still cannot overlap a shift (one at a time, above); it just stops pausing.
  // Without the exemption the chain from eighth under full brakes arrives at second a tenth of a
  // second late and stalls there, which is the same bug again three gears further down.
  const saving = (st.sim.rpm || 0) < SAVE_RPM && st.sim.gear > 1;
  if (st.shiftCool > 0 && !saving) return;
  // ⚠ WHICH GEAR IT WANTS IS `bestGear`, NOT A SECOND OPINION. That function already exists and the
  // cab already prints its answer as the suggested gear on the dash — so the automatic obeying it
  // means the light telling you what to do and the hand doing it can never disagree, which they
  // would within a week if this had its own table of ratios.
  const want = bestGear(st.sim.speed, P);
  // PULLING AWAY. Out of gear on the throttle is a driver who wants a gear, and at a standstill
  // that is first whatever the ratios say.
  if (st.sim.gear === 0) {
    if ((st.input.throttle || 0) > 0.05) beginShift(Math.abs(st.sim.speed) < 2.8 ? 1 : want);
    return;
  }
  if (want === st.sim.gear) return;
  // ONE GEAR AT A TIME, even when the suggestion is three away. Skipping is a thing an experienced
  // driver does and this is not a shortcut — it is the process, shown. Two beats of it in a row is
  // also how a downshift into a hill reads: busy, which it is.
  const step1 = want > st.sim.gear ? st.sim.gear + 1 : st.sim.gear - 1;
  if (step1 < 1) return;
  // …and only once the revs agree, or it hunts at every boundary where the ratio maths is a hair
  // either side. `band` is the pair the dash lights IN BAND from, so this is the same instrument.
  const [lo, hi] = P.band || [0.55, 0.8];
  const rpm = st.sim.rpm || 0;                    // a fraction of redline — see truckReadout, which is what multiplies it by 100
  // ⚠ AN UPSHIFT CANNOT WAIT FOR THE TOP OF THE BAND, because a truck does not always GET there.
  // 'rpm > hi' was the whole gate, and it reads as obviously right: wind it out, then grab the next
  // one. What it misses is that a gear's terminal speed is wherever drag balances torque, and
  // torque is already falling off above the band — so a truck that has stopped accelerating
  // plateaus just UNDER 'hi' and sits there. The dash prints a taller suggested gear, the driver
  // can see it, and the box never takes it. Loaded, where the plateau is lower still, that stranded
  // the top two or three ratios permanently: the automatic simply stopped shifting halfway up.
  //
  // So the second clause is the rule a driver actually uses — take the next one when the next one
  // will still PULL. 'want' (bestGear, above) has already said the taller gear is the better place
  // to be; this only asks whether the engine survives the drop, which is 'rpm' scaled by the ratio
  // change. Both clauses are kept rather than swapped: winding it past 'hi' must still shift even
  // when the drop would land under the band, which is what gets first into second at all.
  if (step1 > st.sim.gear) {
    const rpmNext = rpm * (P.gears[step1] / P.gears[st.sim.gear]);
    if (rpm > hi || rpmNext >= lo) beginShift(step1);
    return;
  }
  // Not on the overrun: lifting off drops the revs, and a box that downshifted every time you came
  // off the throttle would work its way down the gears the whole way down a hill. That rule only
  // holds while the engine still has somewhere to fall, though — past `SAVE_RPM` it is out of room
  // and the gear comes out whatever the right foot is doing.
  if (saving || (rpm < lo && (st.input.throttle || 0) > 0.15)) beginShift(step1);
}
// THE AUTOMATIC CLUTCH'S FOOT. Never while a human has the pedal or the automatic is mid-shift.
// It holds the pedal in for a moment after a shift (shiftGate set autoDip), holds it in at a stop
// in gear so the engine cannot stall (off the throttle with the revs near the floor), holds it in
// while stalled so the key will crank, and otherwise lets it up — the model's own launch slip
// (flight-model LAUNCH_MPH) does the feathering on the way off the line.
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
  // -- THE CAB IS PROFILEABLE, ON THE SAME TABLE THE COCKPIT PRINTS -----------
  // '__wsProfile(true)' has existed since the flight sim's frame was first chased down, and in the
  // cab it printed a table with nothing in it: the phases are opened by the CALLER (that is the
  // whole reason 'frame' is whatever the caller declares it to be), and this loop opened none. So
  // the one view whose camera sits at ground level in a dense city -- the worst case this renderer
  // has, and the one place the frame rate actually gets complained about -- was the one view you
  // could not ask where its frame went.
  //
  // Same three phase names the cockpit uses, deliberately, so a cab profile and a sim profile are
  // read against each other rather than each needing its own key. Free when off (one boolean test
  // per call). 'frame' is closed AFTER the catch, so a bad frame cannot leave the stack dirty and
  // mis-attribute every later one.
  perfBegin('frame');
  try {
    st.prev = { x: st.sim.x, y: st.sim.y };
    // Dead in the water, for either reason. A broken rig behaves exactly as a dry one does at the
    // wheel — the pedal stops meaning anything and the motor is not turning — because from the
    // driver's seat those two situations ARE the same situation, and giving the breakdown its own
    // client-side behaviour would have been a second copy of the same three lines.
    if (st.dry || st.broken) { st.input.throttle = 0; st.sim.rpm = 0; }
    // ── KEY OFF MEANS STOPPED ──────────────────────────────────────────────────
    // A truck whose driver has switched it off should come to rest and STAY there, and it did not:
    // the model has no reason to stop a rolling body, so a shut-down rig kept its momentum, kept
    // its yaw rate, and the trailer went on swinging behind it — a dead machine drifting down the
    // road with its lifters down. The fix is the driver's own foot, not a new rule in the physics:
    // the settle applies the brake through `st.input`, which is the same number the pedal writes,
    // so the load, the surface and the trailer all still decide how long it takes to stop.
    //
    // ⚠ IT IS THE KEY, NOT THE STALL — see `st.shutdown` in ignitionOff. And once it is actually
    // stopped, the residual rates are zeroed rather than left to decay: below walking pace the
    // sway is all that is left of them, and a parked truck that is still rocking is exactly the
    // thing the parked pose was built to stop. Steering is dropped too, so a wheel left over from
    // the last corner cannot walk the nose round while the rig settles.
    if (st.shutdown) {
      st.input.throttle = 0;
      st.input.brake = 1;
      st.input.steer = 0;
      // The trailer is deliberately NOT touched: a tractor that is not moving cannot swing it, so
      // zeroing the tractor's rates settles the box for free. Writing its heading here would be a
      // second opinion about an angle the model already owns.
      if (Math.abs(st.sim.speed) < 0.4) { st.sim.speed = 0; st.sim.yawRate = 0; st.sim.slip = 0; }
    }
    // (A throttle lock used to live here, holding the pedal dead while the overlay's door lifted.
    // The door is in the world now and it lifts BECAUSE you drive at it — see "THE SHED BELONGS TO
    // THE WORLD NOW" above. Nothing may pin the throttle in a shed again: that is the one input the
    // real door is waiting on.)
    // ── CRUISE ────────────────────────────────────────────────────────────────
    // A held throttle across four hundred tiles of straight corridor is not a skill, it is a
    // finger. So: lock the speed you are at and the pedal is worked for you.
    //
    // ⚠ IT IS A DRIVER, NOT A CHEAT VALVE. It writes `st.input.throttle` — the SAME number the
    // pedal and the A key write — and nothing else, so the gearbox, the torque curve, the surface,
    // the load and the hill all still decide what that throttle actually buys. Set it on a climb
    // in too high a gear and you will lug and slow down exactly as you would with your foot flat,
    // because it has no authority the pedal does not have. A version that wrote `speed` would be a
    // teleport with a lamp on it.
    //
    // It cancels the way cruise control cancels on every vehicle that has ever had it: the brake,
    // the clutch, a stall, or losing the drive. Deliberately NOT cancelled by steering — holding a
    // long bend at a set speed is most of what it is for.
    if (st.cruise != null) {
      if (st.input.brake > 0 || st.input.clutch > 0 || st.dry || st.broken || st.sim.stalled
        // ⚠ Through `st.setCruise`, not a bare call: this loop is a module-level function and the
        // switch's own writer closes over the cab that owns the lamp. Cancelling without going
        // through it would leave the rocker lit over a truck that is no longer on cruise.
        || st.sim.gear <= 0 || Math.abs(st.sim.speed) < 5.5) st.setCruise?.(null);
      else {
        // Proportional, and gentle: a truck's mass means a hard correction reads as surging.
        st.input.throttle = Math.max(0, Math.min(1, (st.cruise - st.sim.speed) * 0.18));
      }
    }
    // The camera flies on the same clock the truck does, and BEFORE the frame is painted, so a held
    // key moves it this frame rather than next one.
    perfBegin('sim:physics');
    freeCam.step(dt);
    autoShift(dt);
    autoClutchStep(dt);
    // THE SPRING BRAKES, applied where a foot would be — see setPark. Written AFTER cruise (which
    // it cancels on the way on) and after the automatic, and before `step`, so it is the last word
    // on the pedal for this frame: pulling the knob out while somebody is on the throttle holds the
    // truck, which is what a park brake is for and what makes forgetting it a real mistake.
    if (st.park) st.input.brake = 1;
    step(st.sim, st.input, P, dt);
    const r = truckReadout(st.sim, P);
    // ── WHAT IS THROWING THE CAB ABOUT ────────────────────────────────────────
    // Two numbers in g, for anything inside the cab that has mass: the trinkets on the header and
    // the dash (see cab-trinkets.js), and whatever else ever wants them.
    //
    // ⚠ THE CORNERING ONE IS NOT A DERIVATIVE. `yawRate` is already a rate the model publishes, and
    // lateral acceleration on a body going round a bend is v·ω exactly — so it comes out of the sim
    // clean, with no frame-to-frame differencing and none of the noise that would come with it. The
    // longitudinal one has no such shortcut and IS a derivative, which is why it is the only one
    // that needs a previous value kept.
    //
    // ⚠ AND IT IS SMOOTHED, BECAUSE d(speed)/dt OFF A ROUNDED READOUT IS A SQUARE WAVE. `speed` is
    // a float, but the gearbox steps it, the surface model steps it, and a shift drops it in one
    // frame — so the raw difference spikes to several g on a gearchange and a bobblehead reads as
    // being hit with a hammer every time you go up the box. One-pole, about a tenth of a second,
    // which is fast enough that stamping on the brakes still registers as stamping on it.
    {
      const MPH_FPS = 1.4667, G_FPS2 = 32.17;
      // ⚠ SIGNED SPEED, NOT ITS MAGNITUDE. `yawRate` already carries the direction of travel (it
      // comes out of a signed rate times the steer angle), and v·ω with both signed is v²·tanδ/L —
      // which points at the side you steered toward whichever way the truck is rolling, because a
      // turn centre is decided by the front wheels and not by the gearbox. Taking the magnitude of
      // one of the two throws the dice the wrong way every time you back off a bay.
      const lat = (st.sim.speed * MPH_FPS) * ((st.sim.yawRate || 0) * Math.PI / 180) / G_FPS2;
      const raw = dt > 0 ? ((st.sim.speed - st.geeSpeed) * MPH_FPS / dt) / G_FPS2 : 0;
      st.geeSpeed = st.sim.speed;
      const k = dt > 0 ? Math.min(1, dt / 0.10) : 0;
      // Clamped at a g either way. A rig does not pull one, and the only things that reach these
      // numbers are the rebound below and a dropped frame — neither of which should be allowed to
      // put a pair of dice through the roof lining.
      st.gee.lat = Math.max(-1, Math.min(1, st.gee.lat + (lat - st.gee.lat) * k));
      st.gee.lon = Math.max(-1, Math.min(1, st.gee.lon + (raw - st.gee.lon) * k));
    }
    perfEnd();   // sim:physics

    // Solid geometry. THE WALL PUSHES BACK; it does not swallow you.
    //
    // This used to put the truck back where it was and set the speed to zero, and that was the
    // wrong outcome for two reasons that only show up once you are actually driving. A dead stop
    // against a facade leaves the rig nosed INTO the geometry with the throttle still down, so the
    // next frame collides again, and again, at whatever speed the pedal has rebuilt — which is the
    // log full of identical "something plastic gives" lines. And a truck that simply stops is a
    // truck you cannot recover without finding reverse, in a gearbox, while touching a building.
    //
    // So it REBOUNDS: put back to the last clear position, then pushed a little further back along
    // the way it came, with the speed reversed and heavily damped. You end up a truck's length off
    // the wall, rolling gently backwards, pointed the way you were — which you can drive out of.
    // `hitCd` is now a genuine quiet window rather than a re-fire guard, because the rebound has
    // already separated the two bodies.
    if (st.hitCd > 0) st.hitCd -= dt;
    else if (obstructionAhead(st) > 0) {
      const mph = Math.abs(st.sim.speed);
      const h = st.sim.heading * Math.PI / 180;
      const dirSign = Math.sign(st.sim.speed) || 1;
      st.sim.x = st.prev.x - Math.sin(h) * 0.35 * dirSign;
      st.sim.y = st.prev.y + Math.cos(h) * 0.35 * dirSign;
      // A rebound, not a bounce-house: you keep a fifth of what you arrived with, backwards, and
      // never more than walking pace. Hitting a wall harder must not launch you further off it.
      st.sim.speed = -dirSign * Math.min(6, mph * 0.2);
      st.sim.yawRate = 0;
      st.sim.brakeTemp = st.sim.brakeTemp || 0;
      // ONE LINE PER IMPACT, and only for impacts worth a line. Nudging a kerb at three miles an
      // hour in a yard is not an event, it is parking; the server hears about it only if the rig
      // actually took something. The cooldown is long enough that scraping down a row of frontages
      // reads as one incident rather than eleven.
      st.hitCd = mph > BUMP_MPH ? 1.6 : 4.0;
      // WHICH END OF THE TRUCK MET IT. The server has no geometry at all, so this is the one fact
      // about a collision only the client can know — and it decides which components take the
      // damage (damage.js `impactSplit`). Reversing is a rear impact by definition; with the wheel
      // wound over you are scraping the flank rather than nosing into it, which is the case that
      // costs you a tyre. Deliberately not forgeable in any useful direction: every area routes the
      // same TOTAL into the truck and only the destination changes.
      const area = st.sim.speed < 0 ? 'rear'
        : Math.abs(st.input.steer || 0) > 0.45 ? 'side'
        : 'front';
      if (mph >= REPORT_MPH) sendCmdSilent(`truckevent ${mph > BUMP_MPH ? 'crash' : 'bump'} ${Math.round(mph)} ${area}`);
      bumpJolt(mph);
    }

    const q = (s) => st.container.querySelector(s);
    q('.cab-mph').textContent = r.speed;
    q('.cab-odo').textContent = Math.max(0, Math.round(st.L - st.s));
    // The one readout that is allowed to stop saying what it is named after: a driver who is not
    // going anywhere needs to be told WHY before they need to be told what they are parked on.
    q('.cab-surface').textContent = st.broken ? 'BROKEN' : st.dry ? 'NO FUEL' : (st.input.surface || 'road').toUpperCase();
    q('.cab-surface').className = 'cab-surface s-' + (st.broken ? 'offroad' : st.input.surface);
    // The box. `best` is shown as a HINT beside the gear and never acted on — an automatic in a
    // truck sim is the whole game deleted. The tach is the same numbers as a dial because you are
    // meant to be able to drive on the sound alone and glance at this to confirm.
    // The controls follow the truck, whatever moved them — a key, a button, a drag.
    st.paintGate?.();
    st.paintControls?.();
    // The key's ANGLE is the ENGINE, not the switch: a key turned on that did not catch springs
    // back to OFF, and saying otherwise would make the one control whose whole job is "is this
    // thing running" lie. (See paintKey — the barrel derives all three positions from the truck.)
    st.paintKey?.();
    const gearEl = q('.cab-gear');
    gearEl.textContent = r.stalled ? '—' : r.reversing ? 'R' : (r.gear === 0 ? 'N' : r.gear + (st.sim.split ? '½' : ''));
    gearEl.className = 'cab-gear' + (r.stalled ? ' g-stall' : r.inBand ? ' g-band' : '');
    // The REV lamp is DERIVED FROM THE BOX, never remembered by the button — the same rule the key
    // barrel follows. Reverse can be left by the lever, the gate, the R key or an automatic upshift
    // out of it, and a button holding its own idea of the state would be lit over a truck that is
    // in first. It also goes dim while rolling, because that is when the control refuses.
    // ⚠ `q`, NOT `container` — this function is module scope and does not close over the cab that
    // owns the markup. Everything around it already went through `q` for that reason.
    const rev = q('.cab-revbtn');
    if (rev) {
      rev.classList.toggle('on', r.gear < 0);
      rev.setAttribute('aria-pressed', String(r.gear < 0));
      rev.disabled = Math.abs(st.sim.speed) >= 2;
    }
    // ── GETTING OUT ────────────────────────────────────────────────────────────
    // ⚠ THE NUMBER IS THE SERVER'S. `parkRig` refuses above `PARK_STOPPED_MPH` (0.6) in
    // plugins/trucking/index.js, and the cab used to test 0.5 — a sliver where the client sent a
    // command the server then refused, which reads to the driver as the same silence as not sending
    // one. One threshold, kept here as a named constant so the next person can find its twin.
    const PARK_SEND_MPH = 0.6;
    const stopped = Math.abs(st.sim.speed) <= PARK_SEND_MPH;
    // The latched pull, fired the frame the rig actually comes to rest — see setPark.
    if (st.park && stopped && !st.parkSent) { st.parkSent = true; sendCmdSilent('park'); }
    // AND THE EXPLICIT DOOR. `park` being the way out is emergent — it is a brake knob that happens
    // to end the drive — which is fine once you know it and invisible until then. This button says
    // the thing out loud, and it is DERIVED rather than remembered (the same rule as the REV lamp
    // above): it lives whenever the brake is set and the rig is stopped, and it is dim otherwise, so
    // the sequence reads off the dash — stop, park, climb down. It sends the ordinary `park` verb
    // and knows nothing else; there is no second get-out path on the server.
    const exit = q('.cab-exitbtn');
    if (exit) exit.disabled = !(st.park && stopped);
    // `BEST` is the shift indicator, and it is a fleet privilege — see CAB_KIT. In a Barrow or a
    // Courier the hint reverts to the keys, which is all a cheap dash has ever told anybody.
    const kit = kitFor(P);
    q('.cab-gearhint').textContent = r.stalled ? 'ENGINE OFF · CLUTCH + KEY'
      : kit.best ? `GEAR · BEST ${r.best}` : 'GEAR · , .';
    // THE INSTRUMENTS ARE ON THE DASH, in the scene — see the field block in the paintWindshield
    // call below, and drawCabInterior in windshield.js. Nothing is painted from here.

    // The rig. Brake temperature is a WORD, not a number, because nobody reads a gauge in
    // Fahrenheit while a hill is happening to them — and it goes amber before it fades, so a
    // driver who is paying attention gets to do something about it.
    // A GRADED GAUGE IS A TIER-2 LUXURY; below it the drums have a WARNING LAMP and nothing else,
    // so a cheap truck tells you the brakes are gone at the moment they are gone rather than
    // watching them go. The fade itself is identical — this is what you can see of it, never what
    // is happening. (Which is also why FADING is never suppressed: a lamp that doesn't light is
    // not a fleet ladder, it is a bug.)
    const bEl = q('.cab-brakes');
    const bt = r.brakeTemp;
    bEl.textContent = r.fading ? 'FADING'
      : !kit.brakeTemp ? 'OK'
      : bt > 0.42 ? 'HOT' : bt > 0.2 ? 'WARM' : 'COLD';
    bEl.className = 'cab-brakes' + (r.fading ? ' b-fade' : kit.brakeTemp && bt > 0.42 ? ' b-hot' : '');
    // The articulation angle in DEGREES is the Orlov's alone — everyone else reverses on the
    // mirrors, which is where the angle has always actually been readable.
    q('.cab-riginfo').textContent = r.hitched
      ? (r.folding ? 'JACKKNIFING'
        : kit.trailerAngle ? `TRAILER ${r.phi > 0 ? '+' : ''}${r.phi.toFixed(0)}°` : 'TRAILER')
      : 'BOBTAIL';
    q('.cab-riginfo').className = 'cab-riginfo' + (r.folding ? ' b-fade' : '');

    // THE GEARBOX HAS A VOICE. `s.shifted` has been set by truckShift since phase 1.5 and nothing
    // has ever listened to it — the box was silent, which is why shifting felt like changing a
    // number rather than operating a machine. A shift in a real truck is three sounds in about a
    // third of a second: the lever going through the gate, the engine dropping off the load, and
    // the clutch taking it back up. Two cues and an rpm dip get all of it.
    //
    // It rides `sim.gear` rather than the flag, because the flag is set by the auto box and the
    // splitter too and they are all the same event to an ear. A SPLIT is deliberately quieter — it
    // is an air valve on the knob, not a lever through a gate.
    if (st.sim.gear !== st.lastGear || st.sim.split !== st.lastSplit) {
      const half = st.sim.gear === st.lastGear;        // same gear, splitter moved
      shiftCue(half, st.sim.gear === 0);
      // The engine drops off the load for a moment. Purely cosmetic — the model has already
      // computed the real rpm from road speed through the new ratio, and this is the tenth of a
      // second of clutch travel that model does not simulate, applied to what the EAR gets only.
      st.rpmDip = half ? 0.06 : 0.14;
      st.lastGear = st.sim.gear; st.lastSplit = st.sim.split;
    }
    if (st.rpmDip > 0) st.rpmDip = Math.max(0, st.rpmDip - dt * 0.9);

    // The voice. rpm/gear/surface are the three things a diesel tells you about, so all three go
    // over; `continuous: true` picks the live parametric synth rather than the deck-craft loops.
    // THROTTLE IS BOOST, not the pedal: `r.pedal` is the spooled number the engine is actually
    // making, so the note comes up with the pull instead of snapping the instant a key goes down —
    // which is most of what makes a big diesel sound heavy.
    // A bay's rev (cabRev) needs the voice updated faster than the 220 ms cadence, or half a second
    // of blip is two samples of it.
    const kick = revKick(now);
    if (now - st.lastAudio >= (kick > 0 ? 40 : 220)) {
      st.lastAudio = now;
      // What continuing to drive on it sounds like. Scaled off the worst component and driven from
      // the same payload the gauges read, so the sound IS the gauge rather than a second opinion
      // about it. Cheap enough for the frame loop: it sets one loop gain and returns.
      damageBed(st.dmg && Object.fromEntries(DMG_PARTS.map((p) => [p.key, st.dmg[p.key]?.v ?? 1])),
        !st.dry && !st.broken);
      // ── A DEAD ENGINE IS A SILENT ONE, ONCE IT IS DOWN ────────────────────
      // `engineOn` was `!st.dry` and nothing else, so switching the key off left the whole bed
      // running — the lifter wash, the idle, all of it — over a truck whose rev counter read zero
      // and whose mesh had already settled. Every other reader of "is this engine turning" is the
      // stall flag; this was the one that had its own idea.
      //
      // ⚠ NOT INSTANT, THOUGH. The pods take a moment to sink onto their shrouds and the sound has
      // to come down WITH the truck, not before it — cutting the wash the frame the key turns is
      // the same wrongness in the other direction, and it is what makes a shutdown read as a bug
      // rather than as a machine settling. So the bed plays on for the length of the settle and
      // then stops, which is the same window the renderer's own `hoverLift` takes to give up.
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
      // ── AND WHATEVER IS ON THE WATER BESIDE THE ROAD ──────────────────────
      // A waterfront run puts a driver within earshot of the basin, and `st.contacts` is the same
      // `vehicle.contacts` feed that already puts those hulls in the mirror — so the pass-by voices
      // cost one call and no new wire. ⚠ A TRUCK'S OWN SPEED IS ALREADY MPH, unlike the cockpit's,
      // which is knots: same field name on the same payload, two units, which is the divergence the
      // renderer's own note flags. Converting here would put the listener 15% fast and bend every
      // boat the wrong way.
      updateBoatContacts({ x: st.sim.x, y: st.sim.y, hdg: st.sim.heading || 0, speed: r.speed || 0 },
        st.contacts || []);
    }

    // Hand the world to the flight sim's renderer. `height: 0` is the ground camera; the map
    // window came from the server and was derived by the same mapWindow a cockpit uses.
    // THE EXTERNAL VIEW IS THE FLIGHT SIM'S OWN CHASE, MODEL AND ALL.
    //
    // It used to pass `hideOwnShip` and then paint a bespoke eight-corner box over the finished
    // frame — a second truck, in a second projection, with its own copy of the camera pose. Both
    // bugs that came out of that were the same bug: the model was a BOX, so it had no bobtail
    // silhouette (a tractor with nothing on it still read as a slab), and its camera was a
    // restatement of the renderer's rather than the renderer's, so orbiting turned the world
    // underneath a rig that would not turn with it.
    //
    // `buildTruck` has existed the whole time — it is what the depot floor, the wireframe and a rig
    // seen from somebody's cockpit all draw, it takes the `<typeId>[+t]` grammar, and BOBTAIL IS A
    // REAL SILHOUETTE in it. So the cab stops drawing its own truck and asks for the same one
    // everybody else sees, through the same own-ship path the aircraft use: the model keeps its
    // true heading while the camera orbits, the ground anchor pins it to the road, and running
    // empty looks like running empty because the mesh is short.
    //
    // `tier` is still passed and does not need gating — drawCabInterior is already `!ext` inside
    // the renderer, so the painted cab suppresses itself the moment the camera leaves it.
    // ── THE MIRRORS, RENDERED ───────────────────────────────────────────────
    //
    // ⚠ BEFORE THE FORWARD VIEW AND NEVER INSIDE IT. drawCabMirror runs from drawCabInterior,
    // which runs from paintCabDash, which paintWindshield calls near the end of its own frame —
    // so rendering the rear view from in there is paintWindshield re-entering itself with every
    // module-level sink (FACE_SINK, MESH_SINK, SPRITE_SINK, the decal and stroke sinks) already
    // armed for the frame it is in the middle of. It would not throw; it would quietly collect
    // the mirror's geometry into the windscreen's own buffers. So the cab renders it first and
    // hands the finished bitmap over as an ordinary view field.
    //
    // ⚠ AND IT IS THROTTLED, BECAUSE IT IS A SECOND WORLD PASS. A mirror at four frames a second
    // reads as a mirror; the eye is not tracking anything in it, it is checking whether something
    // is there. Tying it to the forward frame doubles the most expensive thing this view does for
    // a picture the size of a stamp.
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
              // ⚠ THE HEADING IS THE RIG'S, TURNED ROUND — not the camera's. A shoulder-check
              // swings st.viewYaw, and a mirror that swung with your head would be a mirror
              // bolted to your head.
              heading: ((st.sim.heading || 0) + 180) % 360,
              // A wing mirror is a NARROW instrument: it shows a lane and a bit, not a panorama.
              // fovMul scales both focal lengths together, so this is a field of view and not a
              // horizontal squash — see the note on it in makeCam.
              fovMul: 0.62,
              // ⚠ THE CENTRE AND THE OFFSET DO NOT MOVE WITH THE SLICE. 'mapCenter' is the tile
              // the window is built around and 'mapOffset' is where in it the rig is standing;
              // only the ARRAY shrinks, and the renderer derives its own radius from
              // '(map.length - 1) / 2'. Shifting either to "re-centre" the smaller window would
              // put the mirror somewhere the truck is not.
              map: rearMap(st.map), mapCenter: { x: st.mapX, y: st.mapY },
              mapOffset: { x: st.sim.x - st.mapX, y: st.sim.y - st.mapY },
              hour: st.hour, weather: st.weather, event: st.wxEvent,
              wxField: st.wxField, wxGround: st.wxGround, acX: st.sim.x, acY: st.sim.y,
              roads: st.roads, contacts: contactsFor(st), actors: st.actors, skyline: st.skyline, regions: st.regions,
              landingLight: st.heads, wipers: 0,
            });
            st.rearImg = rc;
          } catch (e) { st.rearImg = null; }   // a mirror that cannot render falls back to the stub
        }
      }
    }
    perfBegin('sim:paint');
    paintWindshield(st.id, {
      rearImg: st.rearImg || null,
      cls: 'truck', phase: 'ground', worldBlend: 1,
      // NEVER DOWNSCALE THE ROAD. The renderer's dynamic resolution defends frame rate by shrinking
      // the backing store, which is right for a sim looking at clouds and wrong for a cab looking at
      // lane markings a metre away — and because a fullscreen canvas is where it actually engages,
      // the symptom was "fullscreen makes it blurry". Rendering at native and taking the frame cost
      // is the trade this view wants.
      // 'resFloor' is a scale on top of the device ratio, so asking for 1 meant "native" on a 1x
      // monitor and "four times the pixels, and no adaptive relief in either direction" on a 2x one
      // -- the dial pinned solid on exactly the machines paying the most. 'resFloorPx' is the same
      // sentence in the unit that was meant: never below ONE BACKING PIXEL PER CSS PIXEL. On a 1x
      // display that is the identical pin this view already had; on a 2x display the scene may drop
      // to half scale under load and is STILL sharper than a 1x monitor at full resolution. The raw
      // floor goes to the clamp minimum so the pixel floor is the one that governs.
      resFloor: 0.5, resFloorPx: 1,
      // …AND GO THE OTHER WAY WHEN THERE IS ROOM. Native is the floor, not the goal: at 1:1 on an
      // ordinary monitor every hard edge in this view — lane markings, the panel lines on the rig
      // in front, the aerial — is drawn with no antialiasing at all, and fullscreen is where that
      // is most obvious because the edges get bigger, not softer. So the scene is rendered at up to
      // twice the linear resolution and scaled down into the box, which is the one place a picture
      // gets sharper by being made larger first. It backs off on its own if the frames cost too
      // much (see the supersample note in paintWindshield) — no setting, no cliff.
      superSample: 2,
      // -- THE GROUND CAMERA'S OWN LOAD-SHEDDING NUMBERS ----------------------
      // RENDER_TUNE's distance block is in tiles and was calibrated from a cockpit, where a building
      // is small and far away. Down here the camera is at ground level in a dense city and the same
      // numbers mean something else -- so this view brings its own. Only keys that decide how much
      // work to SKIP may be set (see VIEW_TUNABLE); geometry is not overridable, because the
      // collision helpers read that outside the frame and the picture and the solid world must never
      // disagree. The numbers live next to the ones they override so the smoke can drive them too.
      tune: CAB_VIEW_TUNE,
      // Which of the four, and whether there is a box on the back. The ONE string that decides the
      // shape, and it is the same one the yard hands its turntable.
      //
      // ⚠ `~p` IS THE SHUT-DOWN POSE, AND THE ROAD NEVER ASKED FOR IT. The mesh has had a parked
      // pose since the lifters were built — a stalled rig settles onto its skirts and the emitter
      // bands stop being drawn — but the only caller passing `~p` was the depot panel's turntable.
      // So out here a truck with a dead engine went on hovering with its bands lit, which is the
      // exact tell the parked pose was written to kill: a machine holding itself up on light it is
      // not making. It is one suffix, and the whole settle comes with it.
      // ⚠ THE FITTING SUFFIX GOES LAST, after the trailer and parked markers. The mesh strips from
      // the first `~` or `^` to read the type, so a suffix in front of `+t` would take the trailer
      // marker with it and a loaded rig would render bobtail.
      variant: TYPE_ID + (r.hitched ? '+t' : '') + (r.stalled ? '~p' : '') + FITS,
      // WHAT THE ROAD UNDER IT IS LIT BY. The engine drives the lifters, so RPM is the right
      // instrument — what was wrong was the SCALE, not the signal.
      //
      // A diesel idles at 0.16 of redline, so reading rpm as a straight fraction put a running,
      // idling rig at about a tenth of full wash: switched on and still nearly dark, which is the
      // one state that has to read as alive. The curve is anchored at idle instead. Below it —
      // cranking, or dying — the wash comes up from nothing, so a start is visible as the lifters
      // catching; AT idle it is already bright; and the top of the rev range takes it the rest of
      // the way, so working the engine visibly lights the road under the skirts.
      // ⚠ `IDLE` is imported from the model rather than written here. A second copy of the idle
      // speed is a number that silently disagrees with the engine the first time the engine moves.
      power: r.stalled ? 0
        : (st.sim.rpm || 0) <= IDLE ? 0.55 * ((st.sim.rpm || 0) / IDLE)
        : 0.55 + 0.45 * Math.min(1, ((st.sim.rpm || 0) - IDLE) / (1 - IDLE)),
      // ⚠ THE BOX KEEPS ITS OWN COLOUR HERE TOO. `deck` is this tractor's opinion; the stamp on the
      // trailer row is the box's own, and it has to win in every view or the same trailer is one
      // colour standing in the yard and another one behind you. Server-sent (see cabContext) —
      // the client is not deciding this, it is being told.
      // …AND HOW MUCH ROAD IS ON TOP OF IT. Second argument to the one conversion (see
      // client/shared/truck-livery.js), so the rig in the chase camera browns exactly as the rig on
      // the depot turntable does and neither of them owns a dirt model.
      livery: { ...truckLivery(PAINT_PREVIEW || PAINT, st.grime || 0), ...(st.trailer?.colour ? { deck: st.trailer.colour } : {}) },
      // The orbit is the player's now, not two constants — drag on the glass, wheel to dolly, ⟲ to
      // put it back down the road.
      // YAW IS THE PLAYER'S, ALWAYS AND AT EVERY DISTANCE — see the ⚠ on chaseAmt. Only the height
      // is overridden, and only while dollied in; `st.extPitch` itself is untouched, so backing the
      // wheel off hands the camera back exactly as they left it.
      ...(st.external ? {
        external: true,
        extYaw: st.extYaw,
        extPitch: st.extPitch + (CHASE_PITCH - st.extPitch) * chaseAmt(st.extZoom),
        extZoom: 1.15 * st.extZoom,
      } : {}),
      // Shoulder-checks are suppressed in the chase camera, which is already showing you what they
      // are for — and yawing a third-person view off the vehicle it is following is just lost.
      viewYaw: st.external ? 0 : (st.viewYaw || 0),
      // ── ⚠ THE SPRING IS HERE, BECAUSE HERE IS ALREADY PER FRAME ────────────
      // A peek that returns needs something advancing it, and this block runs once a frame by
      // construction — so the decay costs no timer, no rAF of its own and nothing to cancel when
      // the cab closes. Held, it tracks the cursor; released, it is an exponential back to zero.
      // ⚠ AND IT IS SUPPRESSED IN THE CHASE CAMERA for the reason the shoulder-checks are: the
      // middle button is the ORBIT out there, and a peek riding along with it would fight the drag.
      ...(() => {
        if (st.external) { st.look.x = 0; st.look.y = 0; st.looking = false; st.freeLook = false; return { lookYaw: 0, lookPitch: 0 }; }
        // ⚠ THE SPRING IS SKIPPED, NEVER SLOWED. A very slow decay reads as a head that drifts
        // back to the windscreen on its own, which is worse than either behaviour — you cannot
        // look at something and leave it there, and you cannot let go and be back.
        if (!st.looking && !st.freeLook) { st.look.x *= CAB_PEEK_DECAY; st.look.y *= CAB_PEEK_DECAY;
          if (Math.abs(st.look.x) < 0.002) st.look.x = 0;
          if (Math.abs(st.look.y) < 0.002) st.look.y = 0; }
        // ⚠ THE LEAN RIDES ALONG AT BOTH SETTINGS AND IS NOT SCALED UP WITH THE YAW. It is a
        // TRANSLATION of the eye inside the cab — how far a driver's head can actually move — and
        // turning further does not move your neck further. Scaling it with the look would post
        // your head out through the door.
        // ⚠ AND IN A CAB THAT IS ALL GEOMETRY THE PEEK IS THE FULL RANGE TOO. The 26° limit exists
        // because past it the painted board would be drawn over a side window; with the board
        // modelled there is nothing to protect, and a peek that stops short of the door is a peek
        // that cannot see the mirror it was for. The spring back is untouched.
        return (st.freeLook || RENDER_TUNE.cockpit3d)
          ? { lookYaw: st.look.x * CAB_LOOK_YAW, lookPitch: -st.look.y * CAB_LOOK_PITCH,
              lookLean: { x: st.look.x * 0.14, y: st.look.y * 0.14 } }
          : { lookYaw: st.look.x * CAB_PEEK_YAW, lookPitch: 0, lookLean: { x: st.look.x, y: st.look.y } };
      })(),
      // Off its mount. Null every other frame, which is what keeps the chase path untouched.
      freeCam: freeCam.view(),
      // ⚠ TWO SPEEDS, AND THEY ARE NOT THE SAME NUMBER. `speed` is NORMALISED (0..1 of a nominal
      // 68 mph) because that is what the world renderer wants — it drives motion blur, road rush,
      // wind noise, none of which are in mph. `mph` is the real figure, and it exists because the
      // speedometer was reading the normalised one: at sixty miles an hour the dial printed "1".
      // ── WHERE THE DRIVER'S EYES ARE ────────────────────────────────────────
      // The cab used to take the renderer's aircraft-on-the-tarmac camera whole (see the ⚠ in
      // `makeCam`). Two numbers put it in a truck instead, and they are only sent for the INTERIOR:
      // the chase camera anchors its model against the shared constants, so overriding them out
      // there would move the rig itself rather than the eye looking at it.
      //   eyeH   0.24 → 0.12. The aircraft value is lifted so the near ground falls off the bottom
      //          of a bare windscreen; a truck has a dash doing that already, so all the lift did
      //          was seat the driver above where they are sitting.
      //          ⚠ AND THE UNIT IS THE SHED, NOT THE CITY. The one building with a known real size
      //          around this camera is the bay (BAY.RIDGE = 2.2 storeys = 26 ft, so 1.0 world-z is
      //          about 61 ft in here). 0.17 was therefore a 10-ft eye — a cherry picker, not a
      //          cab — and it read exactly that way from inside: you sat looking DOWN at a roller
      //          door. 0.12 is ~7.5 ft, which is where a conventional's eyes actually are.
      //   fovMul 0.82 → ~1.0 effective. The stock focal length pulls the world toward the vanishing
      //          point, which is what made everything out of the glass read small and far.
      ...(st.external ? {} : { eyeH: 0.12, fovMul: 1.22 }),
      // ── AND HOW BIG THE PEOPLE OUT OF IT ARE ───────────────────────────────
      // Same unit, same argument, one layer down. The renderer's ground scatter — trees, lamps,
      // bollards and the figures on the pavement — is sized in raw PIXELS rather than in world-z
      // (see the ⚠ over 'propS' in windshield.js), so it was doing two wrong things at once from
      // in here: not growing with the cab's taller canvas, and undersized to begin with.
      //
      // The shed gives the second number as plainly as it gave the first. At ~61 ft to the world-z
      // unit, the actor drawer's stock constant works out at 3.4 ft of person — which is why
      // everyone on the pavement read as a bollard with a head. 1.75 puts an adult at about
      // 5 ft 10 and takes the street furniture up with them, because every one of those constants
      // was eyeballed against the same wrong scale.
      //
      // ⚠ SENT FOR BOTH SEATS, UNLIKE THE TWO ABOVE. 'eyeH'/'fovMul' are interior-only because
      // they would move the RIG when the chase camera is anchoring its model against them. This
      // one moves nothing but the scatter, and the chase view is a road-level camera looking at
      // the same street, so it wants the same people.
      //
      // The aircraft is deliberately left at 1. The constants are just as wrong up there, but
      // nothing in that view is ever close enough to the ground for it to read, and a silent
      // change to nine other cameras is not what a truck window is for.
      propMul: 1.75,
      height: 0, speed: r.speed / 68, mph: r.speed,
      // ⚠ SIGNED, AND IT IS THE SIM'S OWN SIGN — NOT THE GEARBOX'S.
      // This read `(r.reversing ? -1 : 1) * (r.speed / 68)` on the belief that `truckReadout.speed`
      // is a magnitude with the direction living in `reversing`. It is not: `stepTruck` clamps
      // `s.speed` to [−cap·REVERSE_CAP, cap] and the readout rounds it, sign and all. So backing up
      // negated a number that was ALREADY negative and `drive` came out positive — the thrust cones
      // fired off the back of the truck while it reversed, which reads as driving forwards with the
      // model turned round, and is the exact failure the renderer's own ⚠ warns about ("keyed on
      // the direction of TRAVEL, not on the gearbox"; `reversing` is `s.gear < 0`, the gearbox).
      // Taken straight off the sim, so a rig rolling forward with reverse selected is still being
      // pushed forward, and a stationary one fires neither end.
      drive: Math.max(-1, Math.min(1, (st.sim.speed || 0) / 68)),
      heading: st.sim.heading, hour: st.hour, weather: st.weather, moon: st.moon, wind: st.wind,
      // Headlights. There is no switch on the dash and there should not be one: a rig runs lit,
      // and the renderer only throws the beam when the seeing is bad enough to want it (night OR
      // weather — see the gloom gate in paintWindshield). A driver in midday fog was the case that
      // made this necessary; before it, the one condition that needed lamps was the one that
      // couldn't have them.
      // ⚠ WAS A HARDCODED `true`. The renderer still owns WHEN a beam is worth drawing (the gloom
      // gate — night or filthy weather), but whether the lamps are ON is now the driver's, so this
      // is the switch rather than an assumption about it.
      landingLight: !!st.heads,
      // THE OTHER SWITCH. The dome lamp is a purely local, purely visual fact about the inside of
      // this cab, so unlike the headlights it goes no further than the renderer — no packet field,
      // no column. Absent means ON, which is what keeps the depot turntable and the shape smoke
      // rendering the cab they always did.
      dome: st.dome !== false,
      // Brake lamps, for the rig's own rear and for anyone behind. Taken off the same
      // `st.input.brake` the retardation model reads, so the lamps cannot disagree with the pedal.
      braking: (st.input.brake || 0) > 0.02 || !!st.park,
      wipers: st.wipers | 0,
      // The mirrors need the articulation angle — it is the only place it is visible. The
      // binnacle needs the same numbers the DOM readouts show, because they are the same
      // instruments seen from the seat rather than a second set of facts.
      // Which cab is drawn around the view — the panels, the bezels, the marker lights and how
      // many dials are in the binnacle. One number; the table is CAB_TRIM in windshield.js.
      // `trim` is the bench's retrim over the top of it, and reaches the SURFACE only: a retrimmed
      // Barrow can be walnut and brass and still has one dial, because the ladder is instruments.
      tier: P.tier, trim: TRIM_PREVIEW || TRIM,
      // What the driver has hung, stood and bolted in here (cab-trinkets.js), and the two numbers
      // the ones with mass swing on. Neither goes any further than this renderer — nobody but the
      // driver is ever shown the inside of a cab, so unlike `fits` there is no wire suffix and no
      // contact payload for either of them.
      cab: CABFITS, gee: st.gee,
      // ⚠ THE MAKE, FROM THE ONE PLACE IT IS WRITTEN DOWN. The renderer knows the four makes only as
      // comments beside the trim ladder, and the GPS boots with the maker's wordmark on it — so the
      // name is sent rather than duplicated. A second copy in windshield.js would be four strings
      // that have to be kept in step with these, which is how a Drayman ends up booting as a Courier.
      make: kit.label,
      // ⚠ THE TRAILER'S OWN HEADING GOES OVER, NOT JUST THE ANGLE BETWEEN. `phi` is
      // `heading - trailerHeading` (flight-model), and a renderer handed the difference has to
      // pick a sign to put it back together with — I picked the wrong one, and the box LED the
      // turn instead of lagging it, which reads as the trailer steering the truck. The sim owns
      // the absolute angle; sending it means nothing downstream can reconstruct it backwards.
      hitched: r.hitched, phi: r.phi, trailerHeading: r.trailerHeading,
      rpmFrac: r.rpm / 100, band: P.band, inBand: r.inBand, topSpeed: P.topSpeed,
      // ── THE DASH IS THE DASH ─────────────────────────────────────────────
      // Everything the instrument panel needs, and nothing it does not. It is all derived here
      // rather than in the renderer because the renderer must not know what a CAB_KIT is: it
      // paints what a truck's dash shows, and WHICH truck this is, is the cab's question.
      steer: st.wheel?.getLock?.() ?? 0,
      // ── THE WHOLE DASH, NOT FIVE SWITCHES OF IT ──────────────────────────
      // 'console' is the renderer's word for "the shelf is not on screen, so draw everything" —
      // asked of the MEDIA rather than remembered, because a window dragged onto a touch screen is
      // a thing that happens and the answer has to be right on the next frame rather than at the
      // next mount. 'ctl' and 'gate' are views of the shelf itself (see CAB_CTL): what the buttons
      // currently say, in the order a truck arranges them.
      console: !cabTouch(),
      // What the driver's feet are doing. Straight off the same 'st.input' the physics reads, so a
      // painted pedal cannot disagree with the one the truck is being driven by — it is the rule
      // the brake lamps a few lines up already follow.
      pedals: { clutch: st.input.clutch || 0, brake: st.input.brake || 0, throttle: st.input.throttle || 0 },
      ctl: st.ctlCells ? st.ctlCells() : null,
      gate: st.gateView ? st.gateView() : null,
      gearLabel: r.stalled ? '—' : r.reversing ? 'R' : (r.gear === 0 ? 'N' : r.gear + (st.sim.split ? '½' : '')),
      stalled: r.stalled,
      // WHAT HOLDS THE TRUCK OFF THE ROAD. The lifters run off the engine, so a dry tank or a
      // broken rig settles onto its shrouds — which is the same fact the audio and the pedal
      // already use, reported once more to the renderer rather than inferred there from speed.
      engineOn: !st.dry && !st.broken,
      fuel: st.dry ? 0 : (st.fuel ?? 1),
      legFrac: st.L ? Math.max(0, Math.min(1, st.s / st.L)) : 0,
      // The GPS screen. 'aim' is the route destKey the server sent; the distance left is derived
      // from the leg the cab is already driving rather than asked for a second time.
      //
      // ⚠ THE DIVISOR IS THE ONE CONVERSION, NOT A NUMBER THAT LOOKS ABOUT RIGHT. This was /12 —
      // written before tiles-to-miles existed anywhere — while corridor.js has since declared
      // TILES_PER_MILE = 3 and the sign boards, the 'route' verb and the GPS route picker all
      // print against that. So the strip under the map read a QUARTER of what every other surface
      // in the same cab said, which is precisely the failure the 'miles, not tiles' rule names: a
      // board saying 240 while the dash says 60 means a driver cannot budget a tank against
      // either. Imported rather than restated, so there is still exactly one of them.
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
      // Aircraft passing over. The cab used to be deliberately blind to traffic; it is not any
      // more, because a world where a pilot can see a truck but a driver cannot see a plane is
      // half a world. Same channel, same renderer, no new code on either side.
      // ⚠ CAMERA-RELATIVE, AND THAT CONVERSION IS THE WHOLE REASON THIS CAB HAS NEVER DRAWN A
      // CONTACT. `paintWindshield` documents its contact shape as {dx, dy, altDiff, rng, …} — an
      // offset from the eye — and both server lists arrive in WORLD tiles (`x`, `y`), because that
      // is the only frame a server can speak. The cockpit has always converted before handing them
      // over (see contactView there); the cab concatenated the raw rows straight through, so every
      // contact reached drawContacts with `c.dx` undefined, projected to NaN, failed the on-screen
      // test and fell out through the off-screen chevron branch. Nothing was ever drawn and nothing
      // ever errored.
      //
      // It was invisible because both halves looked right on their own: the boxes were in the
      // payload (the server proves it), the renderer draws contacts (the sim proves it), and the
      // one line between them was speaking a different coordinate system. It is not only the
      // trailers — the aircraft this cab was deliberately given so a driver could watch a Mule come
      // over the yard have never been drawn either.
      contacts: contactsFor(st),
      map: st.map, mapCenter: { x: st.mapX, y: st.mapY }, roads: st.roads,
      actors: st.actors,   // the people on the pavement either side of the road
      roadside: st.hitcher || null,   // …and the one standing on the shoulder out on the void road
      mapOffset: { x: st.sim.x - st.mapX, y: st.sim.y - st.mapY },
      // WHERE WE ARE, AND WHAT IS OVER US. `acX/acY` were already here for the lightning, which is
      // why bolts worked in the cab while the clouds and rain they come out of did not: without
      // `wxField` the renderer's wxSample is null for the whole drive, so there were no local cells
      // to drive into, no local storm darkening, and none of the ambient cloud/precip floors that
      // ride that packet. `event` outranks `weather` for everything visual — it is what makes an
      // acid downpour green through the windscreen instead of ordinary rain.
      acX: st.sim.x, acY: st.sim.y,
      wxField: st.wxField, wxGround: st.wxGround, event: st.wxEvent,
      // The nav head on the dash is a SCREEN, so it goes out with the rest of them.
      // Passed through rather than read from the panel's own state because the
      // renderer owns the dash and has never heard of `st`.
      elecOut: !!st.elecOut,
    });
    // Where the fascia's switches landed this frame — taken now, because the mirror's own pass
    // (bare, so no interior) clears the renderer's copy on the frames it runs.
    st.hot = st.external || freeCam.active ? null : interiorHotspots();
    // The rig itself is the renderer's now; this is only what the renderer cannot know.
    if (st.external) { st.tier = P.tier; drawRigOverlay(st, r); }
    // The road, on the glass and in the air. After the world and after the rig, because it is
    // between them and the eye — and on the same canvas, because it is not a thing in the world.
    drawRoadFilm(st, dt);
    perfEnd();   // sim:paint

    // ── THE DRIVER, FOUR TIMES A SECOND ────────────────────────────────────
    // Not once per frame, and not off the vitals message either. Once per frame is sixty DOM reads
    // a second for two numbers that move every few minutes; hooking the message would mean editing
    // render.js's update path so the log's vitals rail could tell a truck about itself, which is a
    // wire between two things that have no other reason to know about each other.
    //
    // A throttled poll off the loop that is already running is the cheap, local answer, and both
    // painters bail on an unchanged string, so the steady state is two number comparisons.
    if (now - (st.vitAt || 0) > 250) {
      st.vitAt = now;
      paintVitBand(st);
      paintGalleyVitals(st);
    }

    // Stopped and pointing the same way as last time we spoke? Nothing the server needs to know
    // has changed, so drop to the heartbeat. `rolling` is the whole gate — a truck that is not
    // moving cannot cross a node, burn fuel, break down or bog.
    const rolling = Math.abs(st.sim.speed) >= 0.5;
    // ⚠ …EXCEPT THAT COMING TO A STOP IS ITSELF THE NEWS, AND THE HEARTBEAT IS 2.5 SECONDS.
    //
    // The gate above is right about the STREAM and wrong about the EDGE. The instant the truck
    // drops under half a mile an hour the cadence falls from 500ms to 2500ms — so the last thing
    // the server heard can be the speed from BEFORE the stop, and it goes on believing that for up
    // to two and a half seconds after the rig is standing still.
    //
    // `park` refuses over PARK_STOPPED_MPH (0.6), so what that buys the driver is: brake to a halt,
    // watch the needle sit on zero, reach for the brake knob, and get told 'not while it is still
    // rolling'. Nothing on the dash agrees with the refusal and nothing the driver can do makes it
    // go away except waiting, without being told that is what they are doing. It reads as the truck
    // refusing to stop.
    //
    // So the edge is sent immediately, in both directions — stopping is worth knowing at once, and
    // so is pulling away. The interval still governs everything between edges, which is the part
    // that was actually saving packets.
    //
    // ⚠ THE SERVER DROPS ANYTHING INSIDE MIN_SYNC_MS (120ms) AND RETURNS BEFORE IT READS THE SPEED,
    // so an edge fired too soon after the last packet would be swallowed and we would be back to
    // waiting out the heartbeat. `lastSync` is therefore left ALONE when it is too early, so the
    // next frame tries again — which bounds the whole thing at about a tenth of a second rather
    // than at the heartbeat.
    const edge = rolling !== st.wasRolling;
    if (edge && now - st.lastSync < MIN_SYNC_MS) { /* too soon to be heard — retry next frame */ }
    else if (edge || now - st.lastSync >= (rolling ? SYNC_MS : IDLE_SYNC_MS)) {
      st.wasRolling = rolling;
      st.lastSync = now;
      // Packed numerics, matching cmdTruckSync's unpack order exactly: s t hdg spd x y.
      // The client reports WHERE IT IS, not how far it has come — the server derives the odometer
      // from the position against its own corridor geometry (reconcileTruck). The two leading
      // slots are kept in the frame as a fallback for a bogged rig, whose position is off-road and
      // therefore locates nowhere. Sending a self-reported distance would let a client weave and
      // be paid for the extra tarmac.
      // ⚠ THE SECOND SLOT WAS A LITERAL 0 AND IS NOW THE IGNITION. The server had no idea whether
      // the engine was running — it reads position, heading and speed, and a stopped truck and a
      // shut-down one are the same thing to all three. `park` needs to know (you cannot set the
      // brake and walk away from a running truck), so rather than open a second channel for one
      // bit, it rides the dead field that was already in the packet at the same four-a-second
      // cadence. 1 = running, 0 = key off.
      // ⚠ A SEVENTH SLOT: THE LAMPS, AS A BITFIELD. Same packet, same four-a-second cadence, no new
      // route and nothing persisted — the identical trick the ignition bit plays in slot two. One
      // integer carries every lamp the outside of this truck can show, so adding a third (indicators,
      // one day) costs no packet change at all.
      //   bit 0 = headlights   bit 1 = brake lamps
      sendCmdSilent(`trucksync ${st.s.toFixed(2)} ${st.sim.stalled ? 0 : 1} ${Math.round(st.sim.heading)} ${Math.round(st.sim.speed)} ${st.sim.x.toFixed(3)} ${st.sim.y.toFixed(3)} ${(st.heads ? 1 : 0) | (((st.input.brake || 0) > 0.02 || st.park) ? 2 : 0)}`);
    }
  } catch (e) {
    // Same discipline as helm-view: the renderer has no internal try/catch, so one bad frame must
    // not kill the loop and strand a driver looking at a frozen picture.
    if (!st._errLogged) { console.error('[cab] frame error (view kept alive — report this stack):', e); st._errLogged = true; }
  }
  perfEnd();    // frame
  perfTick();   // prints + resets on a 2s window
  st.raf = requestAnimationFrame(frame);
}

// Styles live with the panel (the one-file-per-panel convention), injected once.
// The two server lists, everything moving near the truck and boxes standing in the yard, in the
// frame the renderer actually reads. World tiles in, offsets from the truck out.
//
// A box is STATIC and the rest are not, so the moving list is dead-reckoned between pushes by the
// shared track (world-feed.js), on a velocity differenced from the pushes. It used to read `ias` off
// the wire at 0.02 tiles a knot, which was right for nothing: the list now carries boats (knots
// from mph), rigs (mph) and aircraft (whose ground rate is a tune), and each walked a different
// wrong distance and snapped back at the next push.
//
// ⚠ AND A RIG IS DRAWN AT THE ROAD'S OWN SCALE, not at the one an aeroplane sees it at.
// CONTACT_SIZE.truck is honest (from the air a rig SHOULD be a detail on the tarmac), and the
// hero model multiplies it by seven to frame against lane markings that are metres across. That
// argument is about the road, so it applies to everything on the road: without it, a box parked
// beside your own cab draws at a seventh of its size. `sizeMul` rather than a size override,
// because it is the one field that reaches the draw, the ground anchor and the occlusion size together.
function contactsFor(st) {
  const ax = st.sim.x, ay = st.sim.y;
  const out = st.contactTrack ? st.contactTrack.frame(ax, ay, { roadRig: ROAD_RIG_MUL }) : [];
  for (const c of st.trailers || []) {
    const dx = c.x - ax, dy = c.y - ay;
    // A box rests on the tarmac the cab is already sitting on, never at windscreen height.
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
  // The immersive layouts are the PAGE's, not the pane's — nothing else takes them down, and a
  // driver who parked in fullscreen would be left with no log and no command box.
  document.body.classList.remove('cab-fullscreen', 'cab-hidepanel');
  exitBigScreen();                                   // …and the rung above them, which owns the page rather than the pane
  window.dispatchEvent(new Event('pane:released'));  // hand the collapsed pane back to the phone layout
  // The camera goes back on its mount with the cab. Not merely tidiness: it holds a key set, and a
  // dismount while a movement key is down would leave that key latched for the next drive.
  freeCam.close();
  st.freeCamUnbind?.(); st.freeCamUnbind = null;
  freeIdle?.unbind(); freeIdle = null;
  st.freeHold = null;
  suppressWeatherFx(false, 'cab');
  cancelAnimationFrame(st.raf);
  stopEngineAudio(); stopBoatContacts();                                 // the diesel does not idle on in an empty room
  stopDamageBed();                                   // …and neither does the rattle it was making
  removeEventListener('keydown', st.onKey);
  removeEventListener('keyup', st.onKey);
  endSeatKeyboard(st.cabWrap);                       // the keyboard goes back to the command bar with the cab
  // The key record's own two hooks. They are the window's and the document's, so nothing else takes
  // them down, and a driver who parked and drove again would stack another pair on the last.
  if (st.onWinBlur) removeEventListener('blur', st.onWinBlur);
  if (st.onVisibility) document.removeEventListener('visibilitychange', st.onVisibility);
  // Each pedal and steer button parked a release on the window (a pointerup that lands outside the
  // control still has to let go of it). They are not the pane's, so nothing else takes them down,
  // and a driver who parked and drove again would stack another set on top of the last.
  (st.winOff || []).forEach((off) => removeEventListener('pointerup', off));
  st.shelfRO?.disconnect?.();
  st.wheel?.destroy?.();
  // The knob deregisters itself from the radio's repaint set; the radio's own state survives,
  // because a driver at the log rung still has a set even with no cab on screen.
  st.cbWidget?.dispose?.();
  disposeWindshield(st.id);
  // The rear camera is its own scene and its own GL context — see the note on .cab-rearcam. A seat
  // that closed without releasing it is the helm's own bug at one remove.
  disposeWindshield(st.id + '-rear');
  st.container.innerHTML = '';
  st = null;
}
