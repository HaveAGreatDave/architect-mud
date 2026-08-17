// THE LONG HAUL — the cab.
//
// The driving half of the truck sim. Structurally this is `cockpit.js` shrunk to its spine, and it
// borrows the yacht's trick wholesale (see helm-view.js): the world is not drawn here at all. It
// is handed to `paintWindshield` — the flight sim's renderer — with `height: 0`, which drops the
// eye to the ground because that renderer's camera height was always
// `RENDER_TUNE.eh + height * climbLift`. A truck is what that function does when you stop climbing.
//
// WHAT IS DELIBERATELY NOT PASSED: `hud` (no airspeed tape or altimeter), `airport`,
// `windowClass`, `external`. Those overlays are separate functions in the renderer and
// the cab simply does not call them. Nothing was forked to make a truck; things were left out.
//
// THE LOOP is the flight sim's contract, unchanged: simulate locally at 60fps because a round trip
// between turning the wheel and the world turning is the difference between driving and operating a
// website, then report ~4×/s and let the server clamp. The server never re-simulates; it defends the
// odometer against elapsed wall-clock (plugins/trucking/state.js reconcileTruck) and pushes back the
// authoritative world window.

import { paintWindshield, windshieldHTML, ensureWindshieldStyles, disposeWindshield,
  groundObstructionAt, MODEL_MAX_EXTENT, RENDER_TUNE, cabTrim, cabWheelHub, cabWheelGeom, cabGpsRect, cabDashCanvas } from './windshield.js';
import { TYPES, IDLE, createTruckState, truckReadout, step, truckShift, truckSplit, truckSelectGear, bestGear } from './flight-model.js';
import { updateEngineAudio, stopEngineAudio, damageCue, damageBed, stopDamageBed, airHornOn, airHornOff } from './engine-audio.js';
// The cab draws the weather through its own windscreen, so the pane's outdoor overlay has to
// stand down while it owns the pane — the same hard override the cockpit takes on embark.
import { suppressWeatherFx } from './weather-fx.js';
import { createHelmWheel, TRUCK_LOCK_TURNS, TRUCK_LOCK_RAD } from './helm-wheel.js';
import { sendCmdSilent } from '../net.js';
import { cbRadioHTML, wireCbRadio, cbTabKey } from './cb-radio.js';
import { openTabletToChatTab } from './tablet-os.js';

// TELEMETRY CADENCE. This was a flat 250ms — four commands a second through the full dispatch
// pipeline, forever, including for a rig sitting in a bay with the handbrake on while its driver
// read a job board. The flight sim, which this borrowed its shape from, actually syncs at 1.2s and
// only tightens to 0.33s inside the dogfight bubble; the truck had taken the tight number as the
// normal one. So: MOVING is the fast rung, STOPPED is a keepalive. The server reconciles against
// its own wall clock (reconcileTruck) and derives the odometer from position, so a slower frame
// costs nothing but a slightly later node crossing.
const SYNC_MS = 500;              // rolling
const IDLE_SYNC_MS = 2500;        // stationary — a heartbeat, not a stream
// THE PARAMETERS ARE THE SERVER'S, NOT A CONSTANT. This was `TYPES.hauler` — one hardcoded truck
// for the whole fleet — so a player who spent 31,000₵ on a Continental drove a Courier with a
// different name on the door: same gears, same top speed, same brakes, same turn-in. The server
// now assembles the real set at mount (plugins/trucking/rig.js effTruckParams: the type, its tune,
// its kits, and how worn it is) and ships it in the cab context, so a bought truck and a tuned
// truck are both felt at the wheel. The fallback stays for a context that predates the field.
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

let P = TYPES.hauler;
// WHICH of the four, kept as its own id. `params` is the effective NUMBERS and deliberately says
// nothing about the shape — but the external view draws a real mesh now, and `buildTruck` picks the
// silhouette off exactly this string (aircraft3d's `<typeId>[+t]` grammar). A context that predates
// the field falls back to the hauler, the same rung the parameters do.
let TYPE_ID = 'hauler';
// Whatever the depot sprayed on it, in the truck paint vocabulary (`truck:` patterns, aircraft3d).
let PAINT = null;
const setParams = (ctx) => {
  P = (ctx && ctx.params) || TYPES[ctx && ctx.typeId] || TYPES.hauler;
  if (ctx && ctx.typeId) TYPE_ID = ctx.typeId;
  if (ctx && 'paint' in ctx) PAINT = ctx.paint || null;
};

// WHICH ROOM YOU ARE SITTING IN. One number — the type's `tier`, which rides along in `params`
// because rig.js spreads the whole type — decides the whole interior: the painted panels out on
// the glass (CAB_TRIM in windshield.js) and the instruments on the shelf below it, here.
//
// THE LADDER IS INSTRUMENTS, NOT ASSISTANCE, and it has to stay that way. Every rung of it either
// TELLS you something or is decoration; not one of them makes the truck easier to drive, because
// the moment the expensive truck steers better than the cheap one for a reason that isn't in
// `effTruckParams`, the physics have two homes. A Barrow with no rev counter is a Barrow you drive
// on the engine note, which is harder and is meant to be — that is the thing 30,000₵ buys back.
const CAB_KIT = {
  0: { tach: false, best: false, brakeTemp: false, trailerAngle: false, label: 'KRELL BARROW' },
  1: { tach: true,  best: false, brakeTemp: false, trailerAngle: false, label: 'OSTREK COURIER' },
  2: { tach: true,  best: true,  brakeTemp: true,  trailerAngle: false, label: 'VACHON DRAYMAN' },
  3: { tach: true,  best: true,  brakeTemp: true,  trailerAngle: true,  label: 'ORLOV CONTINENTAL' },
};
const kitFor = (p) => CAB_KIT[p?.tier] || CAB_KIT[1];

// ── THE CONTROLS, IN ONE PLACE ───────────────────────────────────────────────
// The cab had eleven controls and no list of them. Every one carried a `title` on its own button,
// which is a tooltip on a touch screen nobody will ever see, and the gear hint on the dash named
// two keys out of eleven. This table is the legend the ? card renders, and it is written as data so
// that adding a control without telling anybody about it takes a deliberate omission.
const CONTROLS = [
  ['Drag the wheel', 'Steer. Take hold of the wheel on the dash anywhere on it and turn it, or put a hand anywhere else on the glass and drag sideways. It walks back to centre when you let go. In the chase view the same drag orbits the camera instead, and the scroll wheel dollies it.'],
  ['X / C or ← →', 'Steer. X and C are the flight sim rudder keys, so the hand that flies already knows them; the arrows do the same thing. One full turn of the wheel is full lock.'],
  ['Centre boss', 'The horn. Press the middle of the wheel.'],
  ['GPS screen', 'Tap it. The map is the road you are actually on; tapping opens the fork, with the distance and whether your tank reaches. Picking one runs the ordinary route command, so it obeys the same rules typing it would.'],
  ['Lever', 'The gear lever, in an H-gate. Drag the knob into a slot — or just click the slot. The knob sits in whatever gear you are actually in.'],
  ['LO / HI', 'Range. The box is a four-by-two: the same four slots are gears 1-4 in LO and 5-8 in HI, and changing range in gear takes four ratios with it.'],
  ['A / THROTTLE', 'Throttle. Held. The engine takes a moment to come up on boost, and longer in a low gear.'],
  ['Z', 'Service brakes. They heat, and hot brakes fade.'],
  ['SPACE / CLUTCH', 'Clutch. Held — or TAP the pedal to latch it in, which is how you shift with one hand on a mouse. The box is not synchronised: a gear only goes in with the clutch in, and trying it without grinds the box into neutral. It is also how you restart a stalled engine.'],
  ['J / JAKE', 'Engine brake. Held. Free retardation on a descent — it does not heat the drums.'],
  ['↑ ↓', 'Shift up / down, on the same cluster the wheel is on: ← → steers, ↑ ↓ works the box.'],
  ['. and ,', 'Shift up / down, the other way round. Gear 0 is neutral.'],
  ['K / KEY', 'The ignition. Off stops the engine; on cranks it, and it only catches with the clutch in or the box in neutral — same rule as restarting a stall.'],
  ['M / AUTO', 'Automatic shifting. It works the clutch and the lever for you and you can watch it do it — the stick goes out through neutral and into the slot, the pedal goes in and comes up. It never chooses reverse, and it has no authority you do not: it can lug the engine and it can be fluffed, because it is a hand on the same controls.'],
  ['G / CRUISE', 'Cruise control. Locks the speed you are doing — the brake, the clutch or dropping out of gear cancels it. It works the throttle and nothing else, so a hill still beats you in the wrong gear.'],
  ['/', 'Splitter — half a gear.'],
  ['R', 'Reverse. Only from a standstill.'],
  ['H', 'Air horn. The room hears it.'],
  ['W / the stalk', 'Wipers. The stalk is on the column beside the wheel and it wears its own setting — off, intermittent, low, high.'],
  ['Q / E / S', 'Look left, right, and over your shoulder. Held — you look, then you come back. There is no dash behind the side glass, so the view out of it is clear.'],
  // The whole map is the flight sim's now — see the sync note in the key handler.
  ['V', 'External view — a chase camera behind the rig, on the same key the cockpit uses. Dolly right in and it settles flat to the road so you can see ahead of you; you can still orbit right round at any distance. (F still works.)'],
  ['D', 'Damage. Four bars — engine, wheels, body, and the trailer if you have one. The strip in the corner is always there; this opens it out.'],
  ['⛶ / ⊟', 'Fullscreen, or hide the text panel for more road.'],
];

// The damage HUD's vocabulary, and the one place the client says anything about what a component
// IS. The numbers and the bands are the server's (damage.js); these are the words next to them, and
// each note names the consequence rather than the part — a driver needs to know what a bar costs
// them, not what it is called. The trailer's row appears only when there is a trailer, which is why
// this is filtered against the payload rather than rendered blind.
const DMG_PARTS = [
  { key: 'engine',  short: 'ENG', label: 'ENGINE',  note: 'pull' },
  { key: 'wheels',  short: 'WHL', label: 'WHEELS',  note: 'grip and stopping' },
  { key: 'body',    short: 'BDY', label: 'BODY',    note: 'what it is worth' },
  { key: 'trailer', short: 'TRL', label: 'TRAILER', note: 'the box behind you' },
];

// The chase camera's resting elevation, in radians, matching cockpit.js's REST_PITCH intent: behind
// and a little above. The renderer clamps this against the terrain, so the orbit can never dip the
// eye under the road.
// 0.42 → 0.26 rad. The higher angle is right for an aircraft, whose interesting surface is its
// PLAN — wings, and the ground it is over. A truck's interesting surface is its FLANK: it is a tall
// box on wheels, and looking down on it at 24° shows you the roof, which is a rectangle. That is
// most of what "seems very flat" is. Dropped to ~15°, the chase sits nearer the road and the rig
// has a side, a screen and a stack. The orbit still runs from under-belly to top-down; this is only
// where it RESTS and where ⟲ puts it back.
const EXT_REST_PITCH = 0.26;
// ── DOLLYING IN DROPS THE CAMERA TO THE ROAD, AND DOES NOTHING ELSE ──────────
// ⚠ IT MUST NOT TOUCH YAW. A first cut eased the camera round to dead astern as you zoomed in, on
// the theory that close up you want to drive rather than admire — and it took the turntable away
// at exactly the distance where a turntable is most useful, which is walking round your own rig
// looking at it. A 360 close-up is the whole reason to have an external view at all.
//
// So the zoom changes ONE thing: how high the camera is. Backed off it hangs above the truck, where
// you can see the shape of the whole rig; dollied in it settles to road level, which is what puts
// the road AHEAD of the truck on screen instead of the roof. That is the part that makes the view
// drivable, and it costs nothing — you can still swing right round to the front at any distance,
// and the drag never stops meaning "orbit".
//
// The player's own pitch is never overwritten, only overridden while they are close; back the wheel
// off and the camera they set comes back.
const CHASE_FROM = 0.62;          // where the camera starts coming down
const CHASE_FULL = 0.34;          // …and where it is flat on the road
const CHASE_PITCH = 0.07;         // road level, looking along the lane rather than down on the roof
const chaseAmt = (zoom) => Math.max(0, Math.min(1, (CHASE_FROM - zoom) / (CHASE_FROM - CHASE_FULL)));

// ── THE PICTOGRAMS ───────────────────────────────────────────────────────────
//
// Line art on a 24×24 grid, stroked in currentColor at a single weight, so every one of them
// inherits the key it sits on — the tell-tale colour, the dimming when a control is unavailable,
// the brightening on hover — without a second copy of any of those rules.
//
// They are DRAWN RATHER THAN TYPED because the text glyphs they replace were standing in for
// meanings they do not have: an arrow is not a wiper, and half of these controls have no character
// in Unicode at all. A truck's switch panel is pictograms for exactly this reason — you read it at
// a glance, in your peripheral vision, in a language that does not depend on knowing the word.
//
// Everything is stroke, nothing is fill, and nothing is smaller than about 2px at the size these
// render: a pictogram with hairline detail is a smudge on a dash you glance at.
const ICON = {
  // A wiper: the cowl, the arm swung up off its pivot, the blade across it, and the arc it sweeps.
  wiper: '<path d="M2.5 20h19"/><path d="M6.5 20 14 8.2"/><path d="M12.4 7.1 16.9 9.9"/>'
    + '<path d="M5.2 15.6a9.5 9.5 0 0 1 13-4.6" stroke-dasharray="2.4 2.2"/>',
  // The engine brake: a block with two cylinders, and the exhaust being dumped out of it — which is
  // literally what a Jake does. The down arrow is the retardation.
  jake: '<rect x="3.5" y="9.5" width="10" height="8" rx="1.4"/><path d="M6.2 9.5V7.2M10.8 9.5V7.2"/>'
    + '<path d="M18.5 7.5v8.4"/><path d="M15.6 13.2l2.9 3 2.9-3"/>',
  // An air horn: the trumpet and two waves. Not a speaker — a truck's horn is a horn.
  horn: '<path d="M3.5 10.2h3l6-4.2v12l-6-4.2h-3z" stroke-linejoin="round"/>'
    + '<path d="M16 9.2a4.4 4.4 0 0 1 0 5.6"/><path d="M18.8 6.9a8 8 0 0 1 0 10.2"/>',
  // The splitter: one ratio cut in half. Two stacked steps with the arrow crossing the divider.
  split: '<path d="M4 8.5h16M4 15.5h16" stroke-dasharray="2.6 2.4"/><path d="M12 5.4v13.2"/>'
    + '<path d="M9.4 8 12 5.4 14.6 8"/><path d="M9.4 16 12 18.6 14.6 16"/>',
  // The range collar: a low step and a high one.
  range: '<path d="M5 18V11"/><path d="M12 18V7"/><path d="M19 18V3.4"/><path d="M3 20.5h18"/>',
  // A wing mirror, per side: the glass on its arm off the A-pillar.
  mirrorL: '<rect x="3" y="7.5" width="8" height="6.4" rx="1.2"/><path d="M11 10.7h4.4"/><path d="M15.4 5.5v12"/>',
  mirrorR: '<rect x="13" y="7.5" width="8" height="6.4" rx="1.2"/><path d="M13 10.7H8.6"/><path d="M8.6 5.5v12"/>',
  // The interior mirror: wide glass on a stem, which is what you actually use to look behind.
  mirrorC: '<rect x="3.5" y="8" width="17" height="6" rx="1.6"/><path d="M12 8V4.5"/><path d="M9.6 4.5h4.8"/>',
  // A wheel with the direction wound on.
  steerL: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.1"/><path d="M12 4v2.4M5.6 15.6l2-1.2M18.4 15.6l-2-1.2"/><path d="M7.2 7.6 4.6 8.4l.8-2.7"/>',
  steerR: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.1"/><path d="M12 4v2.4M5.6 15.6l2-1.2M18.4 15.6l-2-1.2"/><path d="M16.8 7.6l2.6.8-.8-2.7"/>',
};
// One wrapper, so stroke weight and cap style are stated once. `aria-hidden` because every one of
// these sits inside a button that already has a real accessible name and a printed legend — a
// pictogram announced as well would be the label read twice.
const svgIcon = (k) => '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"'
  + ' stroke-width="1.7" stroke-linecap="round">' + (ICON[k] || '') + '</svg>';


// ── THE GATE ─────────────────────────────────────────────────────────────────
// Positions in the plate's own 0..1 space, and a SLOT NUMBER (1-4) rather than a gear — the gear is
// 'slot + range*4', which is the one line that makes an eight-speed four positions your hand can
// learn instead of eight it cannot. Reverse and neutral carry an explicit gear instead.
//
// It is at module scope because the markup is generated from it: every slot is a real <button>, and
// a table that the DOM and the hit-test both read cannot put a legend where there is no target.
// The four wiper detents, in order. ⚠ MODULE SCOPE, DELIBERATELY. It lived inside openCab as a
// const, and `paintWipers` — a hoisted function declaration called early in the mount to set the
// stalk to its starting position — closed over it. The function hoists; the const does NOT, so the
// early call landed in its temporal dead zone and threw "Cannot access WIPE_POS before
// initialization", which aborted openCab entirely: no world, no dash, no wired controls, and
// nothing on screen to suggest the cause. A static table has no business being per-instance state
// anyway, and up here the hoisted function is genuinely safe to call from anywhere in the mount.
const WIPE_POS = ['OFF', 'INT', 'LOW', 'HIGH'];
const CAB_GATE = [
  { x: 0.24, y: 0.15, slot: 1 },
  { x: 0.24, y: 0.85, slot: 2 },
  { x: 0.52, y: 0.15, slot: 3 },
  { x: 0.52, y: 0.85, slot: 4 },
  { x: 0.80, y: 0.85, gear: -1, label: 'R' },     // reverse, on its own dogleg, down and away
  { x: 0.38, y: 0.50, gear: 0, label: 'N' },      // neutral — the crossgate everything passes through
];

let st = null;

export function isCabActive() { return !!st; }

export function openCab(ctx = {}) {
  // Same mount the cockpit and the helm take — the cab owns the area pane while you're driving.
  const container = ctx.mount || document.getElementById('area-content');
  if (!container) return null;
  closeCab();
  suppressWeatherFx(true, 'cab');
  ensureWindshieldStyles();
  ensureCabStyles();
  const id = 'cab';
  setParams(ctx);                                  // which truck this is — BEFORE the dash is built
  const kit = kitFor(P);
  container.innerHTML = `
    <div class="cab-wrap cab-t${P.tier ?? 1}" style="--cab-glow:${cabTrim(P.tier).glow}">
      ${windshieldHTML(id, kit.label)}
      <!-- THE GLASS CHROME. Three buttons over the windscreen, in the same corner and with the same
           glyphs the flight sim and the hangar use (⛶ / ⊟ / ◎), because a player who has flown
           already knows what they do. They are on the VIEW rather than on the dash shelf: the dash
           is the truck, and none of these three is a thing the truck has. -->
      <div class="cab-chrome">
        <button class="cab-cbtn cab-viewbtn" title="external / cab view (F)">◎ EXT</button>
        <!-- Only in the chase view, and only because a turntable you can spin is a turntable you
             can get lost on. Same glyph the flight sim's orbit reset uses. -->
        <button class="cab-cbtn cab-orbitreset" title="point the camera back down the road" hidden>⟲</button>
        <button class="cab-cbtn cab-helpbtn" title="controls (?)">?</button>
        <!-- HIDE-PANEL THEN FULLSCREEN, in that order — they are one ladder and it should read as
             one, with the biggest rung at the end of the row nearest the corner. The flight sim
             puts fullscreen first for historical reasons; this is the order that matches what the
             two buttons actually do to each other (fullscreen supersedes hide-panel). -->
        <button class="cab-cbtn cab-hidebtn" title="hide the text panel — more road">⊟</button>
        <button class="cab-cbtn cab-fsbtn" title="fullscreen">⛶</button>
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
      <div class="cab-help" hidden></div>
      <!-- THE ROUTE PICKER. Opened by tapping the GPS screen on the dash; every row sends the
           ordinary 'route &lt;key&gt;' verb, which is what actually decides. -->
      <!-- ── THE GPS, WHICH IS A LITTLE TABLET ────────────────────────────────
           It was one screen that did one thing: tap the dash unit, get a route picker. But a
           screen in a dash is a screen, and a driver who wants to know what the truck's condition
           is should not have to leave the windscreen to find out — the damage was already a payload
           the cab receives and a panel the cab renders, so it is an APP on this thing rather than a
           second surface with its own way in.
           And it POPS OUT. A 5-inch unit painted into the dash is the right size when you are
           driving and the wrong size when you are reading it, so the same panel detaches into a
           floating window you can put where you like and drag around. Same DOM, same renderers,
           one class — a second copy for the popped-out state is a second copy to keep in step. -->
      <div class="cab-routes" hidden>
        <div class="cab-gps-hd">
          <b class="cab-gps-tabs">
            <button class="cab-gps-tab on" data-app="route">ROUTE</button>
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
             THERE IS NO WHEEL DOWN HERE ANY MORE, and that is the change. There were two: a canvas
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
             numbers in words, and they are kept — VISUALLY hidden, never removed — because they
             are what a screen reader reads and what the log rung of the display ladder has always
             had. A canvas gauge is not an accessible instrument; a canvas gauge WITH this behind
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
             (flight-model TYPES: 'gears' is nine long, index 0 being neutral), and eight is not a
             ladder you climb — it is four slots in an H with a RANGE lever that does them twice.
             That is what a real range-change box is and it is why the shifter is a tree rather than
             a line: LO gives you 1-4 in the four slots, HI gives you 5-8 in the same four, and your
             hand learns one shape instead of eight positions.
             The lever it replaces was a THROW — drag up, it clunks one gear, springs back. Honest
             for a sequential box and wrong for this one: it made the eight ratios a queue you had to
             walk, so downshifting three gears for a hill was three drags, and the control told you
             nothing about where you were. A gate is also a DISPLAY — the knob sits in the slot you
             are in, which is most of what a gearstick is for.
             Reverse has its own dogleg, as it does on the real thing, and neutral is the crossgate
             everything passes through.
             ⚠ EVERY SLOT IS A REAL BUTTON, and that is what let the ▲▼ pair go. They existed only
             because a lever you can work solely by dragging is a lever a keyboard user does not
             have — so the answer was never a second control beside it, it was making the lever
             itself operable. Tab to a slot and press it and you are in that gear; the drag is now
             the shortcut rather than the only way in. -->
        <div class="cab-col cab-col-gate">
          <div class="cab-gate" role="group" aria-label="Gear lever">
            <i class="cab-gate-rail cab-rail-l"></i>
            <i class="cab-gate-rail cab-rail-r"></i>
            <i class="cab-gate-rail cab-rail-x"></i>
            <i class="cab-gate-rail cab-rail-rev"></i>
            ${CAB_GATE.map((g, i) => `<button class="cab-slot" data-gi="${i}" style="left:${g.x * 100}%;top:${g.y * 100}%"></button>`).join('')}
            <!-- ── THE STICK ────────────────────────────────────────────────
                 ⚠ THE LEVER COMES UP OUT OF THE SLOT IT IS IN, and that is the whole of this
                 element. The first version drew the shaft from a fixed pivot BELOW the plate up to
                 the knob, on the theory that a gear lever comes through the floor — true of the
                 real object, and wrong for this picture, because the picture is not a side view of
                 a cab. It is a small isometric plate seen from above and in front, so the only
                 thing that can be "below" it is the edge of the panel: what you actually got was a
                 rod running off the bottom of the frame that grew and shrank as you moved through
                 the gate, which reads as a pointer to the knob rather than as the knob's own stem.
                 Now the base of the stick IS the slot position. The whole assembly — collar, rod,
                 knob — translates as one object, so the lever passes THROUGH the gate the way a
                 real one passes through its slot, at a fixed length and a fixed lean. There is no
                 geometry left to solve: nothing measures a rect, nothing stretches, and the knob
                 can never disagree with the stick about which gear it is in because it is bolted
                 to the top of it. -->
            <div class="cab-lever" title="Throw the lever into a slot, or press one. The collar doubles the four slots into eight gears.">
              <i class="cab-boot" aria-hidden="true"></i>
              <i class="cab-shaft" aria-hidden="true"><s></s><b class="cab-knob"><s></s></b></i>
            </div>
          </div>
          <!-- THE KNOB COLLARS. On a real range-change box both of these live ON the shift knob
               under your thumb, never as a position you put the lever in — so they are two small
               switches beside the gate rather than two more keys in a row of keys. -->
          <div class="cab-collars" role="group" aria-label="Gearbox collars">
            <button class="cab-btn cab-range" aria-label="Range" title="Range collar — LO is gears 1-4, HI is 5-8"><i class="cab-rangeic">${svgIcon('range')}</i><b>LO</b><em>RANGE</em></button>
            <button class="cab-btn cab-splitbtn" aria-label="Splitter" title="Splitter collar (/) — half a gear"><b>${svgIcon('split')}</b><em>SPLIT</em></button>
            <!-- AUTO. Not an automatic gearbox — there is no such truck in this fleet. It is a
                 hand on the same lever and the same pedal, and you can watch it work: the stick
                 goes through neutral, the clutch goes in, the gear goes home. Which is the point
                 of showing it rather than swapping the number silently — a driver who leaves it on
                 for a leg learns the pattern, and the day they switch it off they already know
                 where second is.
                 ⚠ IT SITS WITH THE GEARBOX, NOT ON THE DASH. It began life among the rockers with
                 the horn and the wipers, which is where a switch goes on a real truck and exactly
                 the wrong place here: everything else that decides which gear you are in — the
                 gate, the range collar, the splitter — is in this group, and the one control that
                 does all three of those jobs for you was across the cab from them. The class is
                 unchanged, so the M key, the click handler and the lamp painter all still find it. -->
            <button class="cab-btn cab-rocker cab-auto" aria-pressed="false" aria-label="Automatic shifting" title="Automatic shifting (M) — works the clutch and the lever for you. Watch the stick: it shifts the way you would."><i></i><u><span>AUTO</span></u></button>
            <!-- REVERSE, AND IT EXISTS BECAUSE OF THE BUTTON NEXT TO IT. The automatic deliberately
                 never chooses reverse for you (which way a truck is pointed when it moves is the
                 one decision that stays with the person who can see out of the window), so a driver
                 who has left AUTO on has no hand on the lever and no way into it. The R key always
                 worked; a key is not a control you can find with a mouse.
                 It runs the SAME shift sequence the automatic uses, which is what makes it neutral
                 first and reverse second rather than a gear change nobody watched happen: the
                 clutch goes in, the stick comes out to neutral, there is a pause you can see, and
                 then it goes across. Pressing it again brings it back to neutral. -->
            <button class="cab-btn cab-rocker cab-revbtn" aria-pressed="false" aria-label="Reverse" title="Reverse (R) — clutch in, through neutral, into reverse. Only at a standstill. Press again for neutral."><i></i><u><span>REV</span></u></button>
          </div>
        </div>

        <!-- ── THE COLUMN STALK ────────────────────────────────────────────────
             WIPERS ARE NOT A DASH SWITCH. On every truck ever built they are a stalk on the
             steering column, and the reason that matters is not authenticity for its own sake — it
             is that a stalk tells you its state by WHERE IT IS POINTING, from the corner of your
             eye, without a lamp or a word. A rocker can only say on or off; this has four
             positions and wears them.
             It stays one control that cycles, so the input path, the V key and the hint animation
             are all untouched — what changed is that the thing on screen is now the thing a driver
             would reach for. -->
        <div class="cab-col cab-col-stalk">
          <button class="cab-stalk cab-wipe" aria-label="Wipers"
            title="Wiper stalk (W) — off / intermittent / low / high">
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
                 A truck you cannot switch OFF is a truck that is always on, and every other
                 system in this cab is built around the engine being a thing with a state:
                 the lifters' wash says it is running, the stall says it stopped, the depot
                 lets you sit in it. The only thing missing was the driver's own decision.
                 It is a KEY BARREL rather than a rocker — the one control on the panel you
                 turn instead of press — and it routes through the same 'starter' input the
                 stall restart uses, so there is exactly one way an engine comes back to
                 life and both of them are it. -->
            <!-- ⚠ THE ONE CONTROL IN THE CAB THAT IS NOT A SWITCH, and it is worth the extra
                 markup. Everything on this panel is a rocker with a lamp, which is right for a
                 Jake or a set of wipers and wrong for the ignition: a key is the only thing here
                 you TURN, it is the first thing you touch and the last, and as a rocker it read as
                 one more toggle in a row of toggles. So it is a barrel with a blade in it, and it
                 rotates — OFF, ON, and held round to START against a spring, exactly like the
                 thing it is a picture of. Held is not decoration either: the starter runs for as
                 long as you hold it (see startCrank), so a rig that does not catch first time is
                 cranked until it does, which is what the model's 'input.starter' always wanted and
                 the 900ms timer was standing in for. (⚠ SINGLE QUOTES: this comment is inside a
                 template literal, and a backtick here ends the string mid-sentence — see the
                 client:smoke note in CLAUDE.md, which exists because of exactly this file.) -->
            <div class="cab-key" role="group" aria-label="Ignition">
              <button class="cab-keybarrel" aria-label="Ignition key" aria-pressed="true" title="Ignition (K) — turn and HOLD to crank. Off kills the engine; it only catches with the clutch in or the box in neutral."><s></s><b></b></button>
              <u><span>KEY</span></u>
            </div>

            <!-- THE JAKE is a rocker rather than a pedal, because that is what it is in the cab:
                 a switch on the dash you flick on for a descent. It is still HELD (see hold()). -->
            <button class="cab-btn cab-rocker cab-jake" aria-label="Jake brake" title="Jacobs engine brake (J) — held. Holds you back on a descent so the service brakes stay cold."><i></i><u><span>JAKE</span></u></button>

            <!-- THE HORN. A VERB ('horn', plugins/trucking) rather than a local sound, because the
                 whole point of a horn is that the room hears it and you are not the room. -->
            <button class="cab-btn cab-rocker cab-horn cab-touch" aria-label="Air horn" title="Air horn (H) — the room hears it"><i></i><u><span>HORN</span></u></button>

            <!-- CRUISE. A LATCHING switch, not a held one, and the only rocker on this panel whose
                 label is a NUMBER when it is on: what a driver wants back off cruise control is
                 confirmation of the speed it took, and the lamp alone cannot say that. -->
            <!-- HITCH. The one control in this cab that is not always there: it appears when the fifth
                 wheel is actually under a pin and names the box it would take, and it is gone the
                 rest of the time. A permanently visible button that answers "not here" is a button
                 you learn to ignore; one that only exists when it will work is an instrument.
                 ⚠ It is a HINT, never an authority — pressing it runs the ordinary 'hitch' verb,
                 which re-checks distance, angle and speed for itself.

                 IT IS NOT A ROCKER, because the thing a driver actually operates to take or drop a
                 box is not a switch: it is the RED OCTAGONAL TRAILER AIR SUPPLY KNOB, the one
                 push-pull control on a truck dash that is shaped differently from everything around
                 it so a hand finds it without looking. Push it in and the trailer has air and is
                 yours; pull it out and the box stays where it is. So the knob's own state is the
                 rig's state, and the word stamped on it is what your hand does next — which is why
                 the legend reads PUSH and PULL rather than HITCH and DROP. -->
            <button class="cab-btn cab-hitchbtn" hidden aria-label="Trailer air supply" title="Back under the trailer and couple (hitch)"><i></i><b class="cab-knobface"><s></s><em>PUSH</em></b><u><span>TRAILER AIR</span></u></button>

            <button class="cab-btn cab-rocker cab-cruise" aria-pressed="false" aria-label="Cruise control" title="Cruise control (G) — locks the speed you are doing. The brake, the clutch or dropping out of gear cancels it."><i></i><u><span>CRUISE</span></u></button>

            <!-- THE PARK BRAKE, and it is a KNOB because that is what it is on a truck: a big
                 yellow diamond you pull out and push in, next to the trailer's red one. It is
                 shaped like the trailer air valve above for exactly that reason — a hand finds
                 both of them without looking, and they are the same gesture. Spring brakes hold
                 the rig with no air and no engine, which is why this is the one control that still
                 does something with the key off. -->
            <button class="cab-btn cab-parkbtn" aria-pressed="false" aria-label="Park brake" title="Park brake (P) — the spring brakes. Holds the rig with the engine off; it will not let you pull away. Pull it with the key off and the rig stopped and you climb down."><i></i><b class="cab-knobface cab-parkface"><s></s><em>PULL</em></b><u><span>PARK</span></u></button>

            <!-- THE PUMP HANDLE. Hidden until the server says there is a pump under the nose — the
                 same 'a control appears because the world affords it' rule the trailer air valve
                 follows, and for the same reason: a dead button on the panel everywhere else in
                 the world is worse than no button.

                 IT IS HELD, and that is the entire design. A driver who wants twenty credits of
                 diesel because that is what they have takes it by letting go, which is what a
                 pump handle is FOR — the alternative was a dialog asking how much, and nobody has
                 ever wanted a form in a truck. The readout is the running total in credits, so the
                 number you are watching is the number you are about to pay; it stops climbing when
                 the tank is full or the money runs out, and the handle clicks off exactly there. -->
            <button class="cab-btn cab-pumpbtn" hidden aria-label="Fuel pump — hold to fill" title="Fuel — HOLD the handle. It fills while you hold it and charges you when you let go; it clicks off when the tank is full or you have spent what you have."><i></i><b class="cab-knobface cab-pumpface"><s></s><em class="cab-pumpread">FUEL</em></b><u><span>PUMP</span></u></button>

          </div>

          <!-- THE CB. The set is a VIEW of server state (cb-radio.js) and decides nothing: the
               dial sends 'cb <n>' and moves when the answer comes back, exactly as the hitch
               button runs the real verb rather than reaching into the rig. It is here on the
               switch panel rather than out on the dash because that is where a radio is bolted,
               and because everything on this panel is already a control with a lamp on it. -->
          ${cbRadioHTML()}
          <!-- LOOKING OFF THE NOSE. The flight sim's Q/E/S, and deliberately the same three keys: a
               truck has exactly the same problem an aircraft does (you cannot see behind you) and a
               player who has flown already has the habit. HELD, not toggled, for the reason a
               shoulder-check is held — you look, you come back. -->
          <div class="cab-look cab-touch" role="group" aria-label="Look">
            <button class="cab-btn cab-lookl" aria-label="Look left" title="Look left — hold (Q)"><b>${svgIcon('mirrorL')}</b><em>PORT</em></button>
            <button class="cab-btn cab-lookr" aria-label="Look right" title="Look right — hold (E)"><b>${svgIcon('mirrorR')}</b><em>STBD</em></button>
            <button class="cab-btn cab-lookb" aria-label="Look behind" title="Look behind — hold (S)"><b>${svgIcon('mirrorC')}</b><em>BACK</em></button>
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

  st = {
    id, container, sim,
    input: { throttle: 0, brake: 0, steer: 0, clutch: 0, jake: 0, surface: ctx.surface || 'road' },
    steerKey: 0,
    auto: false,        // automatic shifting — a hand on the lever, never a different gearbox
    shiftSeq: null,     // the beat of a shift in progress (autoShift)
    shiftCool: 0,
    map: ctx.map, mapX: ctx.mapX, mapY: ctx.mapY,
    s: ctx.s || 0, L: ctx.L || 1, node: ctx.node || 0, nodes: ctx.nodes || 1,
    hour: ctx.hour ?? 12, weather: ctx.weather || 'clear', wipers: 0,
    last: performance.now(), lastSync: 0, lastAudio: 0, raf: 0, hitCd: 0, prev: null, contacts: ctx.contacts || [],
    // Seeded from the sim's own starting gear, or the first frame reads as a shift and the box
    // clunks at a driver who has not touched it.
    lastGear: sim.gear, lastSplit: sim.split, rpmDip: 0, external: false, tier: P.tier,
    viewYaw: 0,                                  // degrees off the nose; 0 is through the windscreen
    // THE CHASE CAMERA IS A TURNTABLE, and it always was — the renderer has taken extYaw/extPitch/
    // extZoom since the flight sim's own orbit was built (see paintWindshield). The cab passed two
    // constants and wired no drag, so the one view whose entire purpose is looking at your own rig
    // was the one view you could not walk around. These are the same three numbers cockpit.js
    // keeps, with the same resting pose.
    extYaw: 0, extPitch: EXT_REST_PITCH, extZoom: 1,
    // Which half of the gate the lever is looking at. Derived from the gear every frame (see
    // paintGate) rather than owned here — this is only the starting position.
    range: false,
    fuel: 1,
  };

  // THE WHEEL IS THE STEERING. Not a decoration beside two arrow buttons — the primary control, and
  // the dash is laid out around that now: it is the biggest thing on the shelf and it sits at the
  // left where a hand would be. `art: 'truck'` drops the yacht's compass bezel and wordmark (see
  // helm-wheel.js), which were a boat's instrument sitting in a cab telling a driver their cardinal
  // heading while they were trying to hold a lane.
  //
  // `selfCentre` is slower than it was (5.0 → 2.6). A front axle does walk back to centre, but at
  // 5/s the wheel snapped straight out of your hand the instant you let go, so holding a long bend
  // meant holding the pointer down for the whole bend and any keyboard input was a series of jabs.
  // At 2.6 you can set an angle, let go, and correct — which is how you actually drive.
  // HEADLESS. The widget keeps the angle, the lock clamp, the self-centring and the keyboard; the
  // drawing is the scene's (drawCabWheel), because the wheel a driver looks at should be the wheel
  // in front of them and not a second one in a box underneath. `art`/`accent` still go over so a
  // future non-headless caller behaves; `onHorn` is now fired by the cab's own hub hit-test on the
  // glass, since there is no canvas here to press.
  st.wheel = createHelmWheel(null, {
    accent: cabTrim(P.tier).glow, mode: 'absolute', art: 'truck',
    // THREE AND A HALF TURNS LOCK TO LOCK, from the one place that owns it. The keyboard rate goes
    // up with it or a keyboard driver could never reach the stops — 5.5 rad/s is about two seconds
    // of held key from centre to full lock, which is a hand working, not a hand waiting.
    // `handRate` goes with the travel for the same reason the drag gain does: the limiter is there
    // to stop a mouse flick teleporting the axle, and at the 9 rad/s default a driver winding on
    // three and a half turns of lock hit the limiter during ORDINARY steering rather than during
    // an impossible one. 14 rad/s is a hard two-and-a-bit turns a second — a pair of hands
    // working, still nothing like a flick, and the cap does its job on the flick unchanged.
    // ⚠ AND `keyRate` HAD TO COME DOWN WITH THE TRAVEL, which is the trap in retuning the lock: it
    // is radians per second, so it does not scale with the wheel — shortening the travel to 0.75
    // turns without touching it would have taken a held arrow key from a bit over a second to reach
    // the stops down to four tenths, and the keyboard would have become the twitchiest control in
    // the cab as a side effect of a change made for the mouse. 2.1 restores the same time to lock.
    // `handRate` is deliberately NOT scaled: it is a cap on a flick, not a rate anybody drives at,
    // and lowering it would rate-limit the single swoop the shorter travel exists to allow.
    lock: TRUCK_LOCK_TURNS, selfCentre: 2.6, keyRate: 2.1, handRate: 14,
    // The wheel asks the truck how fast it is going, so the self-centring can be the speed-scaled
    // caster effect a real axle has rather than a constant spring — slack in a yard, firm on the
    // road. Reading `st.sim` live rather than pushing a number in: the sim is the only owner of
    // road speed and a copy of it here would be a copy that lags by a frame.
    getSpeed: () => Math.abs(st?.sim?.speed || 0),
    onSteer: (axle) => { st.input.steer = axle; },
    onHorn: () => sendCmdSilent('horn'),
  });

  // Pedals: hold-to-apply on pointer, and A/Z on the keyboard so a keyboard driver isn't
  // second-class. (The instrument panel's token-bucket lesson does not apply here — a pedal is a
  // held state, not a stream of events.)
  // THREE WAYS INTO EVERY CONTROL, and the third one is the one that keeps getting left out. A
  // pedal is a HELD state, so a `click` — which is what Enter and Space on a focused button
  // produce — means nothing to it: a keyboard driver who tabbed to THROTTLE and pressed Space got
  // silence. Space/Enter are therefore held here exactly as a thumb is, keydown to keyup.
  // `pointercancel` is the touch case: a browser taking the gesture over (a scroll, a system
  // swipe) fires cancel and NOT pointerup, so without it the throttle sticks on and the rig drives
  // itself off the road while the player is holding nothing at all.
  const winOff = [];                                  // window-level releases, unwound in closeCab
  const isPress = (e) => e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter';
  // WHAT A PEDAL LOOKS LIKE IS DERIVED FROM WHAT THE TRUCK IS BEING GIVEN, never from the thing
  // that gave it. The `on` class used to be added by this handler and by nothing else, so a driver
  // using A/Z/X/C — which is nearly all of them, since the keys are the fast way to drive — stood
  // on a throttle that never moved. Two ways in, one of them with a picture attached, is a control
  // that lies about half the time it is used.
  // So the frame loop paints it off `st.input` (see paintControls) and every input path gets the
  // animation for free: the pointer, the key, the ▲ button's own keyboard activation, and anything
  // added later that writes an input without knowing a pedal is drawn.
  const CONTROL_PAINT = [['.cab-throttle', 'throttle'], ['.cab-brake', 'brake'],
    ['.cab-clutch', 'clutch'], ['.cab-jake', 'jake']];
  st.paintControls = () => {
    for (const [sel, key] of CONTROL_PAINT) {
      container.querySelector(sel)?.classList.toggle('on', (st.input[key] || 0) > 0);
    }
  };
  // ⚠ A HELD CONTROL BELONGS TO THE FINGER THAT PRESSED IT, and that is the whole of why you could
  // not accelerate and steer at the same time on a touch screen. The release was bound to
  // `pointerup` on the WINDOW with no idea which pointer it was hearing about — so holding the
  // throttle with a thumb and then lifting the other thumb off the wheel released the throttle. Any
  // second finger anywhere on the glass ended the first one's press.
  //
  // Now the press records its pointer id and claims the pointer (`setPointerCapture`), so events
  // for that finger keep coming to this element even when it slides off, and every other finger is
  // ignored by it entirely. Two hands work, which on a phone is the difference between driving and
  // stabbing at a picture of a truck.
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
    const off = (e) => {
      if (!st) return;
      // Not our finger: leave the control held. A keyboard release (no pointerId) always ends it.
      if (e && e.pointerId != null && pid !== null && pid !== 'kb' && e.pointerId !== pid) return;
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
  // ── THE CLUTCH ALSO LATCHES, AND THAT IS WHAT PAYS FOR THE GRIND ────────────
  // The box refuses a shift with the clutch out (see `shiftTo`), which is the mechanic — and it
  // would be unusable with one mouse, because a hand on the pedal is a hand not on the lever. So a
  // TAP on the clutch pedal holds it in until you tap again; a press-and-hold is unchanged. That is
  // not a concession, it is how the control has to work on a device with one pointer, and it keeps
  // the rule ("a gear goes in with the clutch in") the same rule for everybody.
  // ⚠ It writes the SAME `st.input.clutch` and `heldBy` the pedal writes. A second latched flag
  // would be a second clutch, and the engine, the stall check and the shift gate would each have to
  // learn about it.
  {
    const el = container.querySelector('.cab-clutch');
    let downAt = 0;
    el?.addEventListener('pointerdown', () => { downAt = performance.now(); });
    // ⚠ ON `click`, NOT ON `pointerup`. hold() releases the pedal from a pointerup handler on the
    // WINDOW, which bubbles after this element's own — so a latch set on pointerup is wiped by it a
    // microsecond later, every time. `click` fires once the whole pointerup pass is finished.
    el?.addEventListener('click', () => {
      // A tap, not a hold: a hold has already done its job and released.
      if (performance.now() - downAt > 260) return;
      const latch = !(st.clutchLatched);
      st.clutchLatched = latch;
      st.input.clutch = latch ? 1 : 0;
      st.heldBy = st.heldBy || {}; st.heldBy.clutch = latch ? 1 : 0;
      el.classList.toggle('latched', latch);
      st.paintControls?.();
    });
  }
  // Cruise is a LATCH, so it is a plain click rather than a hold() — the one switch on this panel
  // that stays where you put it.
  container.querySelector('.cab-cruise')?.addEventListener('click', () => toggleCruise());
  container.querySelector('.cab-auto')?.addEventListener('click', () => st.setAuto?.(!st.auto));
  container.querySelector('.cab-revbtn')?.addEventListener('click', () => st.engageReverse?.());
  container.querySelector('.cab-parkbtn')?.addEventListener('click', () => st.setPark?.(!st.park));
  // The radio wires itself; the cab only tells it what pressing the set should open, because the
  // tablet is the cab's business and not the radio's.
  st.cbWidget = wireCbRadio(container, { openDeadhead: (key) => openTabletToChatTab(key) });
  // Hitching is a real verb with real rules; the button is a shortcut to typing it, which is why it
  // sends the command rather than reaching into the rig. Unhitching goes through the same button
  // once you are coupled, because "the thing behind me" is one question with two answers.
  container.querySelector('.cab-hitchbtn')?.addEventListener('click', () => {
    sendCmdSilent(st.sim?.hitched ? 'unhitch' : 'hitch');
  });

  // ── THE PUMP HANDLE ─────────────────────────────────────────────────────────
  //
  // Held, metered, and committed on release. It is NOT hold() — that helper writes a driving input
  // the model reads every frame, and this writes money.
  //
  // The needle rises LOCALLY while you hold it, which is the same split as everything else in this
  // cab: the client simulates the feel, the server owns the fact and corrects on the next push. So
  // the gauge moves under your thumb at 20fps instead of stepping once a second, and the authority
  // is still the number the server sends back after it has taken the credits.
  //
  // ⚠ TWO CEILINGS, AND THE MONEY ONE IS THE POINT. `room` stops it at a full tank; `afford` stops
  // it at the driver's balance, so the handle can never run up a bill they cannot pay. Both are
  // re-derived server-side at the commit — this is the feel, not the enforcement — but they have to
  // be here too, or the readout promises a number the commit then quietly refuses to honour.
  const RATE = 0.10;                       // tank fraction per second — a full fill is about ten
  {
    const el = container.querySelector('.cab-pumpbtn');
    const read = () => el?.querySelector('.cab-pumpread');
    let pid = null, t0 = 0, took = 0, timer = 0;
    const cap = () => {
      const room = Math.max(0, 1 - (st.fuel ?? 1));
      const afford = (st.pump?.credits || 0) / (st.pump?.full || 380);
      return Math.min(room, afford);
    };
    const tick = () => {
      const lim = cap();
      took = Math.min(lim, ((performance.now() - t0) / 1000) * RATE);
      st.fuel = Math.min(1, (st.fuelAtPump ?? 0) + took);
      const cost = Math.round(took * (st.pump?.full || 380));
      const r = read();
      // CLICK is the pump stopping, and it is deliberately the same word whether the tank filled or
      // the money ran out — the driver can see which from the gauge, and a handle does not explain
      // itself. It keeps showing the total, because that is what you are about to be charged.
      if (r) r.textContent = took >= lim - 1e-6 ? `CLICK ${cost}₵` : `${cost}₵`;
      el.classList.toggle('clicked', took >= lim - 1e-6);
    };
    const on = (e) => {
      if (!el || el.hidden || !st.pump || timer) return;
      pid = e.pointerId != null ? e.pointerId : 'kb';
      if (e.pointerId != null) el.setPointerCapture?.(e.pointerId);
      t0 = performance.now(); took = 0; st.fuelAtPump = st.fuel ?? 1;
      st.pumping = true;
      el.classList.add('on');
      timer = setInterval(tick, 50);
      e.preventDefault();
    };
    const off = (e) => {
      if (!st || !timer) return;
      if (e && e.pointerId != null && pid !== null && pid !== 'kb' && e.pointerId !== pid) return;
      clearInterval(timer); timer = 0; pid = null;
      st.pumping = false;
      el.classList.remove('on', 'clicked');
      const r = read(); if (r) r.textContent = 'FUEL';
      // Nothing worth a round trip: a stab at the handle is not a purchase.
      if (took >= 0.01) sendCmdSilent(`truckpump ${took.toFixed(3)}`);
      else st.fuel = st.fuelAtPump ?? st.fuel;
      took = 0;
    };
    el?.addEventListener('pointerdown', on);
    el?.addEventListener('pointerup', off);
    el?.addEventListener('pointercancel', off);
    el?.addEventListener('keydown', (e) => { if (isPress(e) && !e.repeat) on(e); });
    el?.addEventListener('keyup', (e) => { if (isPress(e)) off(); });
    el?.addEventListener('blur', () => off());
    addEventListener('pointerup', off);
    // Letting the panel close mid-pour must not leave an interval running against a dead `st`, and
    // must not silently swallow the diesel the driver already watched go in.
    winOff.push(() => off());
  }

  // Held STEERING buttons, for a touch device with no keyboard and no room to drag a wheel. They
  // drive the wheel widget's own `setHeld`, not a private angle — one wheel, three ways to turn it,
  // and the thing on screen is always the thing you are steering with.
  const steerHold = (sel, dir) => {
    const el = container.querySelector(sel);
    const on = (e) => { st.steerKey = dir; st.wheel?.setHeld(dir); el.classList.add('on'); e.preventDefault(); };
    const off = () => { if (!st) return; if (st.steerKey === dir) { st.steerKey = 0; st.wheel?.setHeld(0); } el.classList.remove('on'); };
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

  // The look controls, on the same held-button machinery. `viewYaw` is degrees off the nose and 0
  // is forward, which is why the renderer's cab-interior gate reads `!v.viewYaw` — see windshield.
  const lookHold = (sel, yaw) => {
    const el = container.querySelector(sel);
    const on = (e) => { st.viewYaw = yaw; el.classList.add('on'); showViewTag(yaw); e.preventDefault(); };
    const off = () => { if (!st) return; if (st.viewYaw === yaw) { st.viewYaw = 0; showViewTag(0); } el.classList.remove('on'); };
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

  // Which way you are facing, said in the corner. Without it a driver who looked over their
  // shoulder and had a pointer slip is looking at a road going the wrong way with no explanation.
  function showViewTag(yaw) {
    const tag = container.querySelector('.ws-label');
    if (!tag) return;
    tag.textContent = yaw === -90 ? 'LEFT WINDOW' : yaw === 90 ? 'RIGHT WINDOW'
      : yaw === 180 ? 'OVER THE SHOULDER' : kitFor(P).label;
    tag.classList.toggle('ws-label-look', !!yaw);
  }
  st.showViewTag = showViewTag;
  st.winOff = winOff;                                 // see closeCab — these outlive the pane otherwise

  // ── STEERING FROM THE GLASS, AND WALKING ROUND THE RIG ─────────────────────
  //
  // ONE DRAG SURFACE, TWO MEANINGS, decided by which view you are in — and they are the two things
  // a hand on that part of the screen could possibly mean. In the CAB you are holding a lane, so a
  // horizontal drag winds the wheel; the wheel widget is still the one being turned (`wind`), so
  // what you see turning is what you are turning. In the EXTERNAL view there is no lane to hold
  // and the whole point of the camera is the vehicle, so the same drag orbits it.
  //
  // This is what makes fullscreen worth having. The wheel widget is a 148px canvas on a shelf; on
  // a 27-inch monitor it is a postage stamp at the bottom-left of the road, and reaching for it
  // means taking your eyes off the thing you are steering. Dragging where you are already looking
  // is the control that scales with the window.
  const glass = container.querySelector('.ws-wrap');
  {
    let drag = null;
    const isChrome = (e) => !!e.target?.closest?.('.cab-chrome,.cab-dmg,.cab-help');
    glass.addEventListener('pointerdown', (e) => {
      grabKeys();                                     // clicking the road is asking to drive — see grabKeys
      if (isChrome(e) || e.button === 2) return;
      // THE BOSS IS A BUTTON, because on a truck it is. It is tested against the renderer's own
      // geometry (cabWheelHub) rather than a second copy of it, so the horn can never end up an
      // inch off the thing that looks like the horn. Not a grab: the angle delta at the centre of
      // a wheel is noise anyway, so this costs no steering.
      // The canvas the WHEEL IS DRAWN ON, which is not the one the world is drawn on — see
      // cabDashCanvas. Measuring the wrong sibling is what put the horn above the wheel.
      const cv = cabDashCanvas(st.id) || document.getElementById(st.id);
      if (!st.external && cv) {
        const b = cv.getBoundingClientRect();
        const hub = cabWheelHub(b.width, b.height);
        const wx = e.clientX - b.left - hub.x, wy = e.clientY - b.top - hub.y;
        const wr = Math.hypot(wx, wy);
        if (wr < hub.r) {
          // The boss is the cord too, and it holds like the rest of them — the release is parked on
          // the window because a hand that presses the hub and drags off it has still let go.
          st.hornDown?.();
          const up = () => { st.hornUp?.(); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
          window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
          e.preventDefault(); return;
        }
        // ── PUTTING A HAND ON THE WHEEL ITSELF ────────────────────────────────
        // Anywhere on the wheel — rim, spoke, the gap between them — is a grab, and it turns the
        // wheel the way a hand turns a wheel: you take hold of a point on it and it follows your
        // hand round. The horizontal-drag-anywhere control below is deliberately kept (it is the
        // one that works at speed and the one that scales with the window), but it is the wrong
        // gesture for the wheel you are looking at: dragging sideways across a wheel is not how
        // anybody has ever turned one, and the wheel is the biggest object on the dash.
        //
        // The target is the whole DISC out to the rim, not an annulus over the drawn ring. A hit
        // test you have to aim at is the problem being fixed; the only part of the disc that is
        // not the wheel is the boss, and that is tested first, above.
        const wg = cabWheelGeom(b.width, b.height);
        if (wr < wg.R * 1.04) {
          drag = { x: e.clientX, y: e.clientY, id: e.pointerId, wheel: true, a: Math.atan2(wy, wx) };
          st.wheel?.setDragging(true);
          glass.setPointerCapture?.(e.pointerId);
          glass.classList.add('cab-glass-drag');
          e.preventDefault(); return;
        }
        // THE GPS IS A BUTTON, tested against the rectangle the renderer says it drew rather than
        // against a second copy of the dash layout. Same rule as the horn boss above, and the same
        // reason: a control that looks like it is somewhere and is somewhere else is worse than no
        // control. A pane too narrow to carry a screen reports no rectangle and this never fires.
        const gr = cabGpsRect();
        if (gr && e.clientX - b.left >= gr.x && e.clientX - b.left <= gr.x + gr.w
          && e.clientY - b.top >= gr.y && e.clientY - b.top <= gr.y + gr.h) {
          st.toggleRoutePicker?.(); e.preventDefault(); return;
        }
      }
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      if (!st.external) st.wheel?.setDragging(true);
      glass.setPointerCapture?.(e.pointerId);
      glass.classList.add('cab-glass-drag');
      e.preventDefault();
    });
    glass.addEventListener('pointermove', (e) => {
      if (!drag || !st) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.wheel) {
        // 1:1 with the hand, unwrapped at the ±π branch cut so crossing the bottom of the wheel
        // does not snap the lock to the opposite stop. Same maths the helm widget's own grab uses,
        // because it is the same gesture — this one is just measured against the painted wheel.
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
      // ⚠ THE DRAG IN THE EXTERNAL VIEW IS ALWAYS THE TURNTABLE. A version of this handed the
      // gesture to the steering wheel once you were dollied right in, which quietly removed the
      // ability to walk round your own truck at exactly the distance you would want to — the close
      // orbit is the point of the view, not a state to be grown out of. Steering from the glass
      // stays a CAB gesture, where there is a lane in front of you to hold.
      if (st.external) {
        // Turntable, in the renderer's own units. The pitch bound is short of the poles for the
        // reason cockpit.js's is: a near-vertical orbit stretches the model into a spindle.
        st.extYaw = (st.extYaw + dx * 0.30 + 360) % 360;
        // THE FLOOR IS THE RENDERER'S JOB, NOT THIS ONE. 0.06 rad was a hand-shy 3° that stopped
        // the camera well above the tarmac, so the one shot a road vehicle most wants — level with
        // the road, looking down the lane at the rig in profile — was unreachable. paintWindshield
        // already solves the true limit (`groundPitch`, the angle at which the eye would sink into
        // the terrain) and clamps to it, so passing a lower number asks for flat and gets exactly
        // as flat as the ground allows. Handing that decision to a constant here was second-
        // guessing a clamp that knows the terrain height and this one does not.
        st.extPitch = Math.max(-0.30, Math.min(1.12, st.extPitch - dy * 0.006));
      } else {
        // Screen-width-relative, so the same physical gesture means the same lock at any window
        // size — a fixed radians-per-pixel would make a fullscreen drag four times gentler than a
        // panelled one, which is the opposite of what a bigger picture should do.
        //
        // ⚠ THE GAIN IS THE LOCK, NOT A CONSTANT, and that is the whole of "it still won't come
        // round". The wheel went to three and a half turns lock to lock — 11 radians from centre —
        // while this stayed at the 5.4 it was tuned to when the wheel was 1.6 turns. So a drag
        // across the ENTIRE screen bought half a lock, and the truck was being driven on half its
        // steering by anybody using the control the fullscreen view is built around. The axle it
        // can reach now falls out of the wheel's own travel, so retuning `TRUCK_LOCK_TURNS` can
        // never again leave the gesture behind: one screen width is one lock, at any travel.
        st.wheel?.wind(dx / Math.max(240, glass.clientWidth) * TRUCK_LOCK_RAD);
      }
    });
    const endDrag = () => {
      if (!drag) return;
      drag = null;
      st?.wheel?.setDragging(false);                  // the axle walks back to centre from here
      glass.classList.remove('cab-glass-drag');
    };
    glass.addEventListener('pointerup', endDrag);
    glass.addEventListener('pointercancel', endDrag);
    addEventListener('pointerup', endDrag);
    winOff.push(endDrag);
    // The dolly. External only — there is nothing to zoom in the cab, and a wheel event that did
    // nothing but eat the page scroll would be worse than one that is simply not bound.
    glass.addEventListener('wheel', (e) => {
      if (!st?.external) return;
      // THE FLOOR IS THE DOLLY-IN LIMIT, and 0.4 was not a limit anybody chose — it was copied
      // from the aircraft orbit, where the subject is forty feet across. The cab multiplies by 1.15
      // on the way out, so the closest a driver could physically get was 0.46 of the resting
      // stand-off: nowhere near "fill the frame with the rig". The renderer's own floor is 0.15 and
      // it is happy there (the Echelon deck-cam's final hold pushes down to it), so this stops
      // being the binding constraint. Ceiling raised too — a chase camera you can back right off is
      // how you look at the whole rig with a trailer on.
      // 0.16 → 0.13, for the same reason the pitch floor moved: the cab multiplies by 1.15 on the
      // way out, so a 0.16 floor bottomed out at 0.18 and the renderer's own 0.15 limit was never
      // the one binding. At 0.13 the wheel runs all the way down to what the renderer will actually
      // allow, and the constraint is the camera's rather than an arbitrary number in the cab.
      st.extZoom = Math.max(0.13, Math.min(2.8, st.extZoom * (e.deltaY > 0 ? 1.1 : 0.9)));
      e.preventDefault();
    }, { passive: false });
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
  const focusTag = container.querySelector('.cab-focustag');
  const cmdInput = () => document.getElementById('cmd-input');
  function grabKeys() {
    const el = container.querySelector('.cab-wrap');
    if (!el) return;
    if (document.activeElement === cmdInput()) cmdInput()?.blur();
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
    paintFocusTag();
  }
  function paintFocusTag() {
    if (!focusTag) return;
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '')
      || document.activeElement?.isContentEditable;
    focusTag.textContent = typing ? '⌨ KEYS: TEXT BAR' : '⌨ KEYS: CAB';
    focusTag.classList.toggle('away', !!typing);
  }
  container.querySelector('.cab-wrap')?.setAttribute('tabindex', '-1');
  focusTag?.addEventListener('click', grabKeys);
  container.addEventListener('pointerdown', grabKeys);
  st.paintFocusTag = paintFocusTag;
  addEventListener('focusin', paintFocusTag);
  st.onFocusIn = paintFocusTag;
  paintWipers();
  grabKeys();

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
    };
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
    const glide = (x, y) => {
      const now = performance.now();
      const dt = at ? Math.min(0.1, (now - lastPut) / 1000) : 0;
      lastPut = now;
      if (!at) { at = { x, y }; put(x, y); return; }
      // Exponential ease — frame-rate independent, and quick enough that a manual shift still feels
      // like the gear went in when you pressed the key rather than a moment afterwards.
      const k = 1 - Math.exp(-16 * dt);
      at.x += (x - at.x) * k; at.y += (y - at.y) * k;
      if (Math.abs(x - at.x) < 0.002 && Math.abs(y - at.y) < 0.002) { at.x = x; at.y = y; }
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
    airHornOn(TYPE_ID);
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

  st.onKey = (e) => {
    if (/^(INPUT|TEXTAREA)$/.test(e.target?.tagName) || e.target?.isContentEditable) return;
    const k = e.key.toLowerCase();
    const down = e.type === 'keydown';
    if (k === 'a') st.input.throttle = down ? 1 : 0;
    // Z is the flight sim's throttle-DOWN key and the brake here, which is the same gesture in a
    // vehicle with no reverse thrust. SPACE is an alias for it because it is the key every hand
    // reaches for to stop a moving thing, and a truck has no guns for it to conflict with (the
    // flight sim's Space is the trigger). Its default is a page scroll, so it must be eaten.
    else if (k === 'z') st.input.brake = down ? 1 : 0;
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
    else if (down && !e.repeat && k === 'm') st.setAuto?.(!st.auto);
    // V, the cockpit's own chase key — see the sync note above. F is kept as a silent alias so
    // nobody who learned the cab's old key finds it dead.
    else if (down && !e.repeat && (k === 'v' || k === 'f')) st.setExternal?.(!st.external);
    // Shift+/ arrives as '?', so the splitter's own '/' branch above never sees it.
    else if (down && !e.repeat && k === '?') st.toggleHelp?.();
    else if (down && !e.repeat && k === 'd') container.querySelector('.cab-dmg-strip')?.click();
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
  function setAuto(on) {
    st.auto = !!on;
    // Never leave the clutch pinned in by a driver that has just been switched off mid-shift: the
    // truck would coast, silently, with no pedal down and nothing to explain it.
    if (!on && st.shiftSeq) { st.shiftSeq = null; if (!st.heldBy?.clutch && !st.clutchLatched) st.input.clutch = 0; }
    const el = container.querySelector('.cab-auto');
    if (el) { el.classList.toggle('on', st.auto); el.setAttribute('aria-pressed', st.auto ? 'true' : 'false'); }
  }
  st.setAuto = setAuto;
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
    if (st.park && Math.abs(st.sim.speed) < 0.5) sendCmdSilent('park');
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
        'The starter churns and the engine will not catch — the box is still in gear. <b>Clutch in</b>, or find <b>neutral</b>, and turn the key again.',
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
    // Reverse is a gear like any other, so it grinds like any other. The target is what the shift
    // below would land on — first out of reverse, reverse out of anything else.
    if (st.shiftGate?.(st.sim.gear < 0 ? 1 : -1)) return;
    truckShift(st.sim, P, st.sim.gear < 0 ? 2 : -(st.sim.gear + 1));
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
      const lbl = stalk.querySelector('.cab-stalk-pos');
      if (lbl) lbl.textContent = WIPE_POS[w] || 'OFF';
      // The stalk's own detent is the state, so the accessible name carries it too — a screen
      // reader gets "Wipers, low" rather than a control it has to press to learn anything about.
      stalk.setAttribute('aria-label', 'Wipers — ' + (WIPE_POS[w] || 'OFF').toLowerCase());
    }
  }
  st.paintWipers = paintWipers;
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
  // THE EXTERNAL VIEW. The renderer has had a real chase camera the whole time — the cab's own
  // header note lists `external` among the things it deliberately did not pass — so this is not a
  // new camera, it is the existing one turned on, model and all. The rig is NOT a world object and
  // must never become one (the collision probe would hit it); it is the renderer's own-ship, which
  // is exactly the seam every aircraft already uses to be the thing the world is drawn for.
  viewBtn.addEventListener('click', () => setExternal(!st.external));
  function setExternal(on) {
    st.external = !!on;
    viewBtn.classList.toggle('on', st.external);
    viewBtn.textContent = st.external ? '◎ CAB' : '◎ EXT';
    container.querySelector('.cab-wrap')?.classList.toggle('cab-ext', st.external);
    const rst = container.querySelector('.cab-orbitreset');
    if (rst) rst.hidden = !st.external;
    // A drag that started as steering must not become an orbit halfway through, and vice versa.
    st.wheel?.setDragging(false);
  }
  st.setExternal = setExternal;
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
    function renderGps() { return st.gpsApp === 'damage' ? renderDamageApp() : renderRoutePicker(); }
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
        + 'A component that has FAILED needs the part itself — <b>rig parts</b>.</p>';
    }
    function renderRoutePicker() {
      if (!box || box.hidden || st.gpsApp !== 'route') return;
      const el = body(); if (!el) return;
      const R = st.routes;
      if (!R || !R.dests?.length) {
        el.innerHTML = '<div class="cab-routes-none">One road out of here, and you are on it.</div>';
        return;
      }
      const rows = R.dests.map((d) => {
        const [cls, note] = REACH[d.reach] || REACH.ok;
        return `<button class="cab-route ${cls}${d.current ? ' on' : ''}" data-key="${esc(d.key)}">`
          + `<b>${esc(d.heading)}</b>`
          + `<span class="cab-route-d">${d.tiles} tiles &middot; ${note}</span>`
          + `${d.current ? '<i>▸ running for this</i>' : ''}</button>`;
      }).join('');
      // The one thing the picker says on its own account, and it is a statement about the ROAD
      // rather than a decision about the player: past the junction there is nothing to choose.
      const foot = R.forkAhead
        ? '<div class="cab-routes-ft">The fork is still ahead.</div>'
        : '<div class="cab-routes-ft warn">The fork is behind you — this is the road you are on.</div>';
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
      grabKeys();
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
        grabKeys();                       // tapping the screen must not cost you the wheel
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
        grabKeys();
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
      + `<p class="cab-dmg-foot">A bench is <b>rig repair shop</b> at a depot, or one part at a time — `
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
export function cabContext(ctx) {
  if (!st) return;
  // A repair or a tune committed at the bench arrives on the next push, so a truck that got its
  // brakes back gets them back while you are sitting in it rather than at the next mount.
  if (ctx.params || ctx.typeId) setParams(ctx);
  if (ctx.condition != null) st.condition = ctx.condition;
  // The damage HUD repaints on the SERVER push, never in the frame loop — see renderDamage.
  if (ctx.dmg) st.renderDamage?.(ctx.dmg);
  if (ctx.map) { st.map = ctx.map; st.mapX = ctx.mapX; st.mapY = ctx.mapY; }
  // The street population, paired with the map. An empty list is a real answer, not an absent one —
  // see the same note in cockpit.js flightSimContext.
  if (ctx.actors !== undefined) st.actors = ctx.actors;
  st.s = ctx.s ?? st.s; st.L = ctx.L ?? st.L;
  st.aim = ctx.aim !== undefined ? ctx.aim : st.aim;
  if (ctx.routes !== undefined) { st.routes = ctx.routes; st.renderRoutePicker?.(); }   // what the GPS names — the route verb owns the aiming
  st.node = ctx.node ?? st.node; st.nodes = ctx.nodes ?? st.nodes;
  if (ctx.surface) st.input.surface = ctx.surface;
  if (ctx.contacts) st.contacts = ctx.contacts;
  // THE BOXES STANDING IN THE YARD. They arrive in the same contact shape the aircraft do (see
  // trailers.js trailersNear), so they need no renderer of their own — they are concatenated into
  // the contact list below and drawn by the same code that draws another player's rig.
  if (ctx.trailers) st.trailers = ctx.trailers;
  if (ctx.hitchable !== undefined) { st.hitchable = ctx.hitchable; paintHitchBtn(st); }
  // The pump under the nose, and the balance the handle meters against. `null` is a real answer —
  // it is most of the world — so this assigns rather than merges.
  if (ctx.pump !== undefined) { st.pump = ctx.pump || null; paintPumpBtn(st); }
  // Out of diesel: the server says so and the pedal stops meaning anything. It clamps the speed
  // its own side too — this is the feel, not the enforcement.
  if (ctx.dry != null) st.dry = !!ctx.dry;
  // The tank has been in this payload since phase 1 (state.js packs `fuel`) and the cab has never
  // read it — a driver got a boolean at the moment they ran out and nothing at all before it. The
  // gauge is the warning; running dry with a needle on the peg is the driver's fault, which is the
  // only version of that event worth having.
  // ⚠ NOT WHILE THE HANDLE IS DOWN. A push lands about once a second, and the server's fuel is the
  // pre-pour figure until the commit — so accepting it mid-pour drags the needle back to where the
  // tank was every second while the driver is watching it rise. The commit's own push (`pumped`)
  // arrives after the handle is released and lands normally, which is the correction that matters.
  if (ctx.fuel != null && !st.pumping) { st.fuel = Math.max(0, Math.min(1, ctx.fuel)); paintPumpBtn(st); }
  if (ctx.broken !== undefined) st.broken = ctx.broken || null;
  if (ctx.hour != null) st.hour = ctx.hour;
  if (ctx.weather) {
    st.weather = ctx.weather;
    // Ask once, on the control itself. A driver who has never needed the stalk has no reason to
    // know it is there, and the moment they do need it is the moment rain starts hitting the glass.
    const wet = st.weather === 'rain' || st.weather === 'storm' || st.weather === 'acid_rain' || st.weather === 'snow';
    st.container?.querySelector('.cab-wipe')?.classList.toggle('hint', wet && !(st.wipers | 0));
  }
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
// FOUR AVIATION GATES ARE DELIBERATELY DROPPED from cockpit.js's buildingCollisionAt:
//   • `if (s.onGround) return null` — the entire premise there, and the opposite of ours
//   • `climbOutClear` / the departure corridor — a shield for aircraft leaving a runway
//   • the "must be visible on the glass" window (VISIBLE_NEAR_F..VISIBLE_FAR_F) — an aircraft
//     rule ("a building that isn't drawn can't hurt you"); at 15 tiles of ground fog it would
//     make near buildings non-solid, which is worse than the problem it solves
//   • the altitude penetration test — at ground level any obstruction is a hit
//
// What is KEPT is the sweep, and it is the important part: a truck at 68 mph covers most of a tile
// between frames, so testing only the endpoint would let it tunnel clean through a wall.
const SWEEP = 4;
const TRUCK_CLEAR_Z = 0.010;   // cab roof in render world-z (FLOOR_Z is one storey ≈ 0.028)
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
    const z = groundObstructionAt(wx, wy, cell, px, py, TRUCK_CLEAR_Z);
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
  el.setAttribute('aria-label', coupled ? 'Trailer air supply — pull to release' : 'Trailer air supply — push to couple');
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
  el.setAttribute('title', `Diesel — ${p.full}₵ a tank, ${Math.round(room * p.full)}₵ to fill this one.`
    + ` HOLD the handle: it fills while you hold it and charges you when you let go.`);
  el.setAttribute('aria-label', `Fuel pump — hold to fill, ${Math.round(room * p.full)} credits for a full tank`);
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
  if (st.shiftCool > 0) return;
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
  if (step1 > st.sim.gear) { if (rpm > hi) beginShift(step1); return; }
  // Not on the overrun: lifting off drops the revs, and a box that downshifted every time you came
  // off the throttle would work its way down the gears the whole way down a hill.
  if (rpm < lo && (st.input.throttle || 0) > 0.15) beginShift(step1);
}
function beginShift(to) {
  st.shiftSeq = { to, phase: 'dip', t: 0 };
}

function frame(now) {
  if (!st) return;
  const dt = Math.max(0, Math.min(0.1, (now - st.last) / 1000));
  st.last = now;
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
    autoShift(dt);
    // THE SPRING BRAKES, applied where a foot would be — see setPark. Written AFTER cruise (which
    // it cancels on the way on) and after the automatic, and before `step`, so it is the last word
    // on the pedal for this frame: pulling the knob out while somebody is on the throttle holds the
    // truck, which is what a park brake is for and what makes forgetting it a real mistake.
    if (st.park) st.input.brake = 1;
    step(st.sim, st.input, P, dt);
    const r = truckReadout(st.sim, P);

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
    if (now - st.lastAudio >= 220) {
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
        rpm: Math.max(0, st.sim.rpm - (st.rpmDip || 0)), throttle: r.pedal * 100, spd: r.speed,
        groundSpeed: r.speed, surface: st.input.surface || 'road',
        cabin: !st.external, weather: st.weather,
      });
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
    paintWindshield(st.id, {
      cls: 'truck', phase: 'ground', worldBlend: 1,
      // NEVER DOWNSCALE THE ROAD. The renderer's dynamic resolution defends frame rate by shrinking
      // the backing store, which is right for a sim looking at clouds and wrong for a cab looking at
      // lane markings a metre away — and because a fullscreen canvas is where it actually engages,
      // the symptom was "fullscreen makes it blurry". Rendering at native and taking the frame cost
      // is the trade this view wants.
      resFloor: 1,
      // …AND GO THE OTHER WAY WHEN THERE IS ROOM. Native is the floor, not the goal: at 1:1 on an
      // ordinary monitor every hard edge in this view — lane markings, the panel lines on the rig
      // in front, the aerial — is drawn with no antialiasing at all, and fullscreen is where that
      // is most obvious because the edges get bigger, not softer. So the scene is rendered at up to
      // twice the linear resolution and scaled down into the box, which is the one place a picture
      // gets sharper by being made larger first. It backs off on its own if the frames cost too
      // much (see the supersample note in paintWindshield) — no setting, no cliff.
      superSample: 2,
      // Which of the four, and whether there is a box on the back. The ONE string that decides the
      // shape, and it is the same one the yard hands its turntable.
      //
      // ⚠ `~p` IS THE SHUT-DOWN POSE, AND THE ROAD NEVER ASKED FOR IT. The mesh has had a parked
      // pose since the lifters were built — a stalled rig settles onto its skirts and the emitter
      // bands stop being drawn — but the only caller passing `~p` was the depot panel's turntable.
      // So out here a truck with a dead engine went on hovering with its bands lit, which is the
      // exact tell the parked pose was written to kill: a machine holding itself up on light it is
      // not making. It is one suffix, and the whole settle comes with it.
      variant: TYPE_ID + (r.hitched ? '+t' : '') + (r.stalled ? '~p' : ''),
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
      livery: PAINT || undefined,
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
      height: 0, speed: r.speed / 68, mph: r.speed,
      // ⚠ SIGNED, WHERE `speed` IS NOT. `truckReadout.speed` is a magnitude and the direction lives
      // in `reversing` — fine for a speedometer, useless to anything that has to point something
      // the way the truck is travelling. The lifter thrust cones fire opposite the direction of
      // travel, so they need the one number that says which way that is.
      drive: (r.reversing ? -1 : 1) * (r.speed / 68),
      heading: st.sim.heading, hour: st.hour, weather: st.weather,
      // Headlights. There is no switch on the dash and there should not be one: a rig runs lit,
      // and the renderer only throws the beam when the seeing is bad enough to want it (night OR
      // weather — see the gloom gate in paintWindshield). A driver in midday fog was the case that
      // made this necessary; before it, the one condition that needed lamps was the one that
      // couldn't have them.
      landingLight: true,
      wipers: st.wipers | 0,
      // The mirrors need the articulation angle — it is the only place it is visible. The
      // binnacle needs the same numbers the DOM readouts show, because they are the same
      // instruments seen from the seat rather than a second set of facts.
      // Which cab is drawn around the view — the panels, the bezels, the marker lights and how
      // many dials are in the binnacle. One number; the table is CAB_TRIM in windshield.js.
      tier: P.tier,
      hitched: r.hitched, phi: r.phi,
      rpmFrac: r.rpm / 100, band: P.band, inBand: r.inBand, topSpeed: P.topSpeed,
      // ── THE DASH IS THE DASH ─────────────────────────────────────────────
      // Everything the instrument panel needs, and nothing it does not. It is all derived here
      // rather than in the renderer because the renderer must not know what a CAB_KIT is: it
      // paints what a truck's dash shows, and WHICH truck this is, is the cab's question.
      steer: st.wheel?.getLock?.() ?? 0,
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
      aim: st.aim || null,
      legLeft: st.L ? Math.max(0, (st.L - st.s) / 12) : null,
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
      contacts: (st.contacts || []).concat(st.trailers || []),
      map: st.map, mapCenter: { x: st.mapX, y: st.mapY },
      actors: st.actors,   // the people on the pavement either side of the road
      mapOffset: { x: st.sim.x - st.mapX, y: st.sim.y - st.mapY },
      acX: st.sim.x, acY: st.sim.y,
    });
    // The rig itself is the renderer's now; this is only what the renderer cannot know.
    if (st.external) { st.tier = P.tier; drawRigOverlay(st, r); }

    // Stopped and pointing the same way as last time we spoke? Nothing the server needs to know
    // has changed, so drop to the heartbeat. `rolling` is the whole gate — a truck that is not
    // moving cannot cross a node, burn fuel, break down or bog.
    const rolling = Math.abs(st.sim.speed) >= 0.5;
    if (now - st.lastSync >= (rolling ? SYNC_MS : IDLE_SYNC_MS)) {
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
      sendCmdSilent(`trucksync ${st.s.toFixed(2)} ${st.sim.stalled ? 0 : 1} ${Math.round(st.sim.heading)} ${Math.round(st.sim.speed)} ${st.sim.x.toFixed(3)} ${st.sim.y.toFixed(3)}`);
    }
  } catch (e) {
    // Same discipline as helm-view: the renderer has no internal try/catch, so one bad frame must
    // not kill the loop and strand a driver looking at a frozen picture.
    if (!st._errLogged) { console.error('[cab] frame error (view kept alive — report this stack):', e); st._errLogged = true; }
  }
  st.raf = requestAnimationFrame(frame);
}

// Styles live with the panel (the one-file-per-panel convention), injected once.
function ensureCabStyles() {
  if (document.getElementById('cab-styles')) return;
  const s = document.createElement('style');
  s.id = 'cab-styles';
  s.textContent = `
  /* THE PANE IS THE BUDGET, AND THE GLASS GETS WHAT IS LEFT.
     This is the fix for a cab you had to SCROLL to drive. \`.ws-wrap\` is \`height:100%\` by its own
     rule (windshield.js) — correct inside the cockpit, which caps it with \`.ck-canopy\`, and wrong
     here, where it was a bare flex item in an auto-height column. It took a full pane's height,
     the dash was laid out underneath the fold, and the canvas the renderer had to fill each frame
     was the size of the whole area pane rather than the part of it you can see — which is why it
     was scrolling AND slow, from one cause. The dash is now a fixed shelf and the glass flexes
     into the remainder, so the canvas can never be taller than the pane. */
  #area-content:has(.cab-wrap){height:100%;overflow:hidden}
  .cab-wrap{position:relative;width:100%;height:100%;display:flex;flex-direction:column;
    background:#07080a;overflow:hidden;box-sizing:border-box}
  .cab-wrap > .ws-wrap{flex:1 1 auto;height:auto;min-height:0}
  /* One shelf, wrapping. It never scrolls and it never grows: \`flex-wrap\` is what stops the
     controls being shoved off the right edge on a narrow pane, which is the other half of "the
     dash is all over the place".
     THE SHELF IS NOW A MOULDED THING rather than a strip of background: a lip catching the light
     off the glass, a bolt line, and the tier's own materials underneath (see the four cabs). */
  .cab-controls{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:stretch;gap:8px 12px;
    padding:9px 12px 10px;border-top:1px solid #2a2f36;position:relative;
    background:linear-gradient(#15181c,#0b0d10)}
  .cab-controls::before{content:'';position:absolute;left:0;right:0;top:0;height:2px;
    background:linear-gradient(90deg,transparent,var(--cab-glow,#e8c07a),transparent);opacity:.35}
  .cab-col{display:flex;flex-direction:column;justify-content:center;gap:6px;flex:0 0 auto}
  /* ⚠ SPREAD, NOT CENTRED — and this is the fix for controls sitting on top of the steering wheel.
     Centring a flex row puts every control in the middle of the pane, which is precisely where the
     painted wheel and the binnacle are, so the hardware ended up stacked over the one part of the
     dash that was already busy. The wheel is at 42% of the width (cabWheelGeom), so the shelf now
     pushes its groups out to the two ends and leaves the middle to the column, the way the real
     dash does: your hands go out to the sides, the wheel is in front of you. */
  .cab-controls{justify-content:space-between;align-items:flex-end}
  /* The gap the wheel lives in. Not a control — a deliberate hole in the row, so nothing can drift
     back into the middle as groups are added or reordered. */
  .cab-controls::after{content:'';flex:0 1 16%;min-width:0}
  .cab-col-wheel{order:-1}
  /* THE RECORD, kept and not shown. The standard visually-hidden clip: it stays in the accessibility
     tree, it is still written by the frame loop, and it takes no space away from the road. */
  .cab-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;
    clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
  /* \`touch-action:none\` is what makes the glass STEERABLE on a touch screen rather than a thing
     you scroll the page with — and it has to be the glass, because the glass is where the wheel
     is now. */
  .cab-wrap .ws-wrap{touch-action:none}
  /* A control you can tab to has to SHOW that you have tabbed to it. */
  .cab-btn:focus-visible,.cab-pedal:focus-visible{outline:2px solid #e8c07a;outline-offset:2px}
  .cab-gauges{display:flex;flex-wrap:wrap;gap:10px 16px;flex:1 1 auto;min-width:0}
  .cab-readout{display:flex;flex-direction:column;align-items:flex-start;line-height:1.1}
  /* THE SHELF IS THE SAME ROOM AS THE GLASS. \`--cab-glow\` is set on the wrap from the same
     CAB_TRIM entry the renderer paints the dash with, so the numbers under the windscreen are lit
     by the truck you are actually in rather than by one amber that every rung shared. */
  .cab-readout b{font-size:22px;color:var(--cab-glow,#e8c07a);font-variant-numeric:tabular-nums}
  .cab-readout span{font-size:9px;letter-spacing:.14em;color:#7c848f}
  .cab-surface.s-shoulder{color:#d8a24e}
  .cab-surface.s-offroad{color:#d2603f}
  /* ── THE PEDALS ────────────────────────────────────────────────────────────
     Three rubber-faced slabs on a footwell floor, in a truck's own order — clutch, brake,
     throttle, left to right. The perspective is one \`rotateX\` on a shared parent: they are
     hinged at the TOP and rake away from you, so pressing one pushes it down and away, which is
     the motion a foot makes. It is a transform on a button; the input path is the same hold()
     that bound the four words this replaces.
     A pedal that only looked like a pedal would be a costume, so the throttle is deliberately the
     tallest and furthest right, the brake the widest (you stand on it), and the clutch the one
     with the longest travel — which is the order and the shape a driver's foot already knows. */
  .cab-pedals{display:flex;gap:7px;flex:0 0 auto;align-items:flex-end;perspective:340px;
    padding:2px 4px 0}
  .cab-pedal{position:relative;width:38px;height:60px;padding:0;border-radius:4px 4px 6px 6px;
    transform-origin:50% 0;transform:rotateX(26deg);transform-style:preserve-3d;
    background:linear-gradient(#2a3038,#141920 62%,#0c1015);
    border:1px solid #39424c;border-top-color:#4b5763;cursor:pointer;touch-action:none;user-select:none;
    box-shadow:0 6px 12px -6px #000, inset 0 1px 0 rgba(255,255,255,.10);
    transition:transform .07s ease-out, box-shadow .07s ease-out;
    /* The tread. Six ribs in one repeating gradient — a hundred elements' worth of grip for one
       paint, the same trick the roller door's slats use. */
    background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.07) 0 2px,transparent 2px 9px),
      linear-gradient(#2a3038,#141920 62%,#0c1015)}
  .cab-pedal span{position:absolute;left:0;right:0;bottom:5px;font:700 9px/1 inherit;
    letter-spacing:.10em;color:#93a0ae;text-shadow:0 1px 2px #000}
  .cab-pedal.on{transform:rotateX(46deg) translateY(3px);box-shadow:0 2px 6px -4px #000, inset 0 2px 6px rgba(0,0,0,.6)}
  .cab-pedal.on span{color:#fff}
  .cab-brake{width:46px}
  .cab-throttle{height:68px}
  .cab-throttle.on{border-color:#4e9a5c}
  .cab-brake.on{border-color:#9a4e4e}
  .cab-clutch.on{border-color:#8a7ac0}

  /* ── THE GATE ──────────────────────────────────────────────────────────────
     A milled H-plate with a lever in it. Two variables move the knob and nothing else does:
     '--gx'/'--gy', the position in the plate's own 0..1 space, written by the drag handler while a
     hand is on it and by paintGate off the CURRENT GEAR the rest of the time. So the lever's
     position and the gear it selected can never disagree — there is no second copy of where the
     lever is, and a shift from a key moves the knob too.
     Every dimension below is a fraction of '--gw'/'--gh', so the rails, the engraved numbers and the
     knob all track one pair of numbers when the gate resizes for touch. */
  /* The shifter is the biggest thing on the shelf, because it is the biggest thing in the cab —
     a range-change lever is a foot of steel you move with your whole forearm, not a thumb control. */
  /* THE PLATE IS BRUSHED METAL, not a dark rectangle. Three cheap layers do it: fine vertical
     striations (the brush), a broad diagonal sheen (the light coming in the windscreen), and the
     base tone underneath. Nothing here is an image and nothing animates — it is the difference
     between a control drawn on a panel and a control MADE of something, which is the whole ask. */
  .cab-gate{--gw:168px;--gh:104px;position:relative;width:var(--gw);height:var(--gh);border-radius:5px;
    background:
      repeating-linear-gradient(90deg,rgba(255,255,255,.030) 0 1px,rgba(0,0,0,.05) 1px 3px),
      linear-gradient(114deg,rgba(255,255,255,.075) 0%,rgba(255,255,255,0) 34%,rgba(255,255,255,.04) 62%,rgba(255,255,255,0) 100%),
      linear-gradient(#20252c,#0c0f13);
    border:1px solid #333a43;
    /* ⚠ NOT 'overflow:hidden'. A gear lever STANDS PROUD of its gate — that is what a lever is —
       and the knob sits a stick above whichever slot it is in, so for the top row (1 and 3) it was
       being sliced off by the edge of the plate: a half-knob welded to the frame. Clipping the one
       part of the control you are meant to grab is worse than letting it overhang, and there is
       nothing else here that needs containing now that the stick no longer runs off the bottom.
       '.cab-col-gate' reserves the headroom so the overhang lands on the shelf, not on the glass. */
    overflow:visible;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.10), inset 0 -6px 12px rgba(0,0,0,.55);
    touch-action:none;cursor:pointer}
  /* A MISSED SHIFT, ON THE PLATE. The sound is the message — this is the part you catch out of the
     corner of an eye while you are busy, so it is one hard red pulse and a word, not a panel. The
     word stops appearing after the third grind (see 'grind'): by then it is not news. */
  .cab-gate.grind{box-shadow:inset 0 1px 0 rgba(255,255,255,.10), inset 0 -6px 12px rgba(0,0,0,.55),
    0 0 0 1px rgba(226,92,72,.85), 0 0 16px -2px rgba(226,92,72,.6);
    animation:cab-grind 380ms steps(2) 1}
  .cab-gate[data-tell]:not([data-tell=""])::after{content:attr(data-tell);position:absolute;
    left:0;right:0;bottom:-14px;text-align:center;font:700 8px/1 inherit;letter-spacing:1.5px;
    color:#e25c48;text-shadow:0 1px 0 rgba(0,0,0,.9);pointer-events:none}
  @keyframes cab-grind{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(1.5px,0,0)}}
  /* The clutch pedal, LATCHED in with a tap rather than held down — the one pedal that stays where
     you put it, because a shift needs a hand on the lever as well. */
  .cab-clutch.latched{border-color:#c8a45e;box-shadow:0 0 10px -2px rgba(232,192,122,.5)}
  /* Four countersunk screws at the corners of the plate — the smallest possible detail that says
     this thing is BOLTED to something. Two elements, four shadows. */
  .cab-gate::before{content:'';position:absolute;left:5px;top:5px;width:5px;height:5px;border-radius:50%;
    background:radial-gradient(circle at 40% 35%,#79838f,#2a3038 70%,#0a0d10);
    /* The other three screws are copies of this one — a box-shadow is the cheapest way to repeat a
       drawn object, and four pseudo-elements is not a thing CSS has. */
    box-shadow:calc(var(--gw) - 20px) 0 0 0 #2a3038, 0 calc(var(--gh) - 20px) 0 0 #2a3038,
      calc(var(--gw) - 20px) calc(var(--gh) - 20px) 0 0 #2a3038;
    pointer-events:none}
  /* The milled slots. Two vertical rails, the crossgate that joins them, and reverse's dogleg —
     drawn as recessed channels rather than painted lines, because the whole read of an H-gate is
     that the lever is DOWN IN something. Percentages, so they track the GATE table above: rails at
     24% and 52%, reverse at 80%, crossgate at 50% height. */
  .cab-gate-rail{position:absolute;background:#05070a;box-shadow:inset 0 0 6px #000;border-radius:4px}
  .cab-rail-l{left:24%;top:10%;bottom:10%;width:9px;margin-left:-4.5px}
  .cab-rail-r{left:52%;top:10%;bottom:10%;width:9px;margin-left:-4.5px}
  .cab-rail-rev{left:80%;top:50%;bottom:10%;width:9px;margin-left:-4.5px}
  .cab-rail-x{left:24%;right:16%;top:50%;height:9px;margin-top:-4.5px}
  /* 1 3 R over 2 4 — the numbers milled into the plate, which is the only reason a gate is
     learnable at a glance. A pair of pseudo-elements would be two labels for six positions, so this is
     one grid laid over the plate. */
  /* ── THE SLOTS ─────────────────────────────────────────────────────────────
     Real buttons, positioned from the same table the hit-test reads, which is what makes the plate
     keyboard-operable and what let the ▲▼ pair go. The number milled into the plate IS the target:
     there is no separate legend that could end up somewhere the button is not. */
  .cab-slot{position:absolute;transform:translate(-50%,-50%);width:26px;height:22px;padding:0;
    background:none;border:0;border-radius:4px;cursor:pointer;
    font:700 11px/1 inherit;color:rgba(163,176,192,.85);
    text-shadow:0 1px 0 rgba(0,0,0,.9);
    transition:color .1s, text-shadow .1s}
  .cab-slot:hover{color:#e6eef8}
  .cab-slot.on{color:var(--cab-glow,#e8c07a);
    text-shadow:0 0 8px var(--cab-glow,#e8c07a), 0 1px 0 rgba(0,0,0,.9)}
  .cab-slot:focus-visible{outline:2px solid #e8c07a;outline-offset:1px}
  /* The collars sit beside the gate, small, because on the real box they are thumb switches on the
     knob rather than controls in their own right. */
  .cab-collars{display:flex;gap:6px;margin-top:5px;justify-content:center}
  .cab-collars .cab-btn{min-width:46px;min-height:38px}
  /* ⚠ THE KNOB IS POSITIONED IN THE SAME UNITS AS EVERYTHING ELSE ON THE PLATE — percentages of the
     gate, exactly like .cab-slot and the rails. It used to translate by '--gx * --gw', i.e. the
     gate's DECLARED pixel width, and the moment the plate was laid out at any other size (the
     fullscreen cab, the touch media query, a flex shrink) the knob was placed against a width the
     plate no longer had: it walked off the left of the gate while the numbered slots stayed put.
     One coordinate system for the plate, or the lever and the gate it lives in disagree. */
  /* ⚠ THE LEVER IS A POINT, AND THE POINT IS WHERE IT MEETS THE SLOT. Zero-sized on purpose: the
     collar, the rod and the knob all hang off it, so moving the lever is one translation of one
     object and there is nothing that can arrive a frame late or a pixel out. Everything visible
     overflows it, which is why it needs no width — a box here would only be a second opinion about
     where the knob is. */
  .cab-lever{position:absolute;left:calc(var(--gx,.38) * 100%);top:calc(var(--gy,.5) * 100%);
    width:0;height:0;margin:0;
    cursor:grab;touch-action:none;z-index:3;
    transition:left .14s cubic-bezier(.2,.8,.3,1), top .14s cubic-bezier(.2,.8,.3,1)}
  /* No easing while a hand is on it: a knob that lags the finger is a knob that feels broken. */
  .cab-lever.on{transition:none;cursor:grabbing;z-index:2}
  /* In a gear the gate's own range does not offer — you shifted into 6 with a key while the lever
     was in the LO half. The plate says so rather than the knob lying about where it is. */
  .cab-gate-off .cab-gate-marks{color:rgba(216,162,78,.75)}
  /* ── THE STICK, THE COLLAR AND THE KNOB ─────────────────────────────────────
     One lever in three pieces, all of them hung off the slot point above. The COLLAR is the ring
     the rod passes through — a squashed ellipse, because the plate is seen at an angle, and it is
     what says the lever goes DOWN INTO the gate rather than standing on top of it. The ROD is a
     polished column with a highlight down one side and a shadow down the other, which is the whole
     reason a cylinder reads as a cylinder. The KNOB is a turned ball bolted to its top end.
     ⚠ Draw order is collar → rod → knob and it matters: the rod has to come up out of the collar,
     and the knob has to sit on the rod's end cap.
     The rod's LENGTH AND LEAN ARE CONSTANTS. They were solved per-frame from a rect while the stick
     was a line drawn to an off-plate pivot; with the base riding the slot there is nothing left to
     solve, and a constant is also the honest answer — a gear lever does not telescope. */
  .cab-boot{position:absolute;left:-11px;top:-5px;width:22px;height:10px;
    border-radius:50%;pointer-events:none;z-index:1;
    background:radial-gradient(60% 70% at 50% 24%,#2b3038,#12151a 62%,#05070a);
    box-shadow:0 1px 3px rgba(0,0,0,.9), inset 0 1px 0 rgba(255,255,255,.10)}
  /* Bottom-anchored AT the point (the parent has no height, so bottom:0 IS the slot) and grown
     upward — so the foot of the stick is nailed to the gate and only the top can move. */
  .cab-shaft{position:absolute;left:-4px;bottom:0;width:8px;height:var(--cab-stick,34px);
    pointer-events:auto;z-index:2;
    transform:rotate(-7deg);transform-origin:50% 100%}
  .cab-shaft s{display:block;position:absolute;inset:0;border-radius:3px 3px 1px 1px;
    background:linear-gradient(90deg,#0a0d11 0%,#454e59 28%,#9aa7b6 46%,#5b6673 64%,#0d1116 100%);
    box-shadow:0 2px 6px -2px #000}
  /* A machined joint where the rod meets the knob — the thing that stops the stick reading as a
     stripe that happens to end at a circle. */
  .cab-shaft s::after{content:'';position:absolute;left:-2px;right:-2px;top:3px;height:4px;
    border-radius:2px;background:linear-gradient(90deg,#161a20,#8e9aa8,#20262d)}
  .cab-lever b.cab-knob{display:block;width:22px;height:22px;border-radius:50%;
    position:absolute;left:50%;top:0;transform:translate(-50%,-52%);
    background:
      radial-gradient(circle at 50% 118%,rgba(255,255,255,.10),rgba(255,255,255,0) 46%),
      radial-gradient(circle at 34% 28%,#5c6673 0%,#232930 62%,#0b0e12 100%);
    border:1px solid #4b5763;
    box-shadow:0 4px 9px -3px #000, inset 0 1px 0 rgba(255,255,255,.22), inset 0 -3px 6px rgba(0,0,0,.55)}
  /* The specular hit. A separate element rather than another gradient stop, because a highlight
     that is part of the fill scales with the ball and a real one does not. */
  .cab-lever b.cab-knob s{position:absolute;left:22%;top:16%;width:34%;height:26%;border-radius:50%;
    background:linear-gradient(160deg,rgba(255,255,255,.55),rgba(255,255,255,0));
    filter:blur(.4px)}
  .cab-lever.on b.cab-knob{border-color:var(--cab-glow,#e8c07a);box-shadow:0 0 10px rgba(232,192,122,.35), 0 4px 9px -3px #000}
  /* THE HOUSINGS. A recessed black panel with the keys sitting in it — on the reference this is
     most of what separates a control box from a row of buttons, because it gives every group an
     edge and a shadow of its own. */
  .cab-box,.cab-steer,.cab-look,.cab-rockers{display:flex;gap:6px;flex:0 0 auto;align-items:center;
    padding:5px;border-radius:6px;background:linear-gradient(#0b0f13,#070a0d);
    border:1px solid #1b232b;box-shadow:inset 0 2px 6px rgba(0,0,0,.75)}
  .cab-box{flex-wrap:wrap;max-width:96px;justify-content:center}
  /* Headroom for the lever, which now overhangs the top of its own plate by a stick — and room
     under it for the CLUTCH IN legend. Reserved on the COLUMN rather than padded onto the gate,
     because the gate's own box is the coordinate system every slot and rail is a fraction of:
     padding it would move all six positions and the rails would no longer line up with them. */
  .cab-col-gate{align-items:center;padding:34px 0 16px}

  /* ── THE ROCKERS ───────────────────────────────────────────────────────────
     A switch that rocks, with a tell-tale above it. Still a <button>: the whole of the change is
     what it looks like and where the 'on' class lands. */
  /* A SWITCH IS A BEZEL WITH A PADDLE IN IT, and the paddle is a separate element because it has
     to move independently of the housing — the bezel is screwed to the dash, the paddle pivots.
     The tell-tale is the third piece and it is drilled into the BEZEL, above the paddle, the way a
     lamp is on a real switch panel rather than printed on the thing that moves. */
  .cab-rockers{display:flex;gap:6px}
  .cab-btn.cab-rocker{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:46px;
    padding:4px 4px 5px;border-radius:4px;
    background:linear-gradient(#171b20,#0e1216);
    border:1px solid #2b333c;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.06), inset 0 -2px 3px rgba(0,0,0,.5)}
  .cab-btn.cab-rocker i{display:block;width:6px;height:6px;border-radius:50%;background:#1d2229;
    box-shadow:inset 0 0 3px #000, 0 1px 0 rgba(255,255,255,.05)}
  /* THE PADDLE. Hinged at the top: the upper half catches the light and the lower half falls into
     shadow, which is the whole read of a rocker that is currently OFF. Pressed, that gradient
     inverts and the legend sinks — the switch is standing proud at the bottom instead of the top. */
  .cab-btn.cab-rocker u{display:block;width:100%;padding:5px 3px 6px;border-radius:2px;text-decoration:none;
    background:linear-gradient(#39424d 0%,#2a323b 46%,#1b2128 47%,#141a20 100%);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.14), 0 1px 2px rgba(0,0,0,.5);
    transition:background .07s ease-out, box-shadow .07s ease-out}
  /* THE LEGEND IS SILKSCREENED ON, not a caption underneath. Bone-white ink, tight and
     letterspaced the way a legend printed on a switch actually is, with a dark shadow under it so
     it sits IN the plastic rather than floating over it. */
  .cab-btn.cab-rocker span{display:block;font:700 8px/1 inherit;letter-spacing:.12em;color:#c9d2dc;
    text-shadow:0 1px 0 rgba(0,0,0,.85), 0 -1px 0 rgba(255,255,255,.06)}
  .cab-btn.cab-rocker.on u{background:linear-gradient(#12161a 0%,#1a2027 53%,#2f3841 54%,#3d4751 100%);
    box-shadow:inset 0 2px 4px rgba(0,0,0,.55), inset 0 -1px 0 rgba(255,255,255,.10)}
  .cab-btn.cab-rocker.on span{color:#fff;text-shadow:0 1px 0 rgba(0,0,0,.9)}
  .cab-btn.cab-rocker.on i{background:var(--cab-glow,#e8c07a);box-shadow:0 0 8px var(--cab-glow,#e8c07a)}
  .cab-jake.on i{background:#4e9ab0;box-shadow:0 0 8px #4e9ab0}
  .cab-horn:active i{background:#e0b45a;box-shadow:0 0 10px #e0b45a}

  /* ── THE TRAILER AIR SUPPLY KNOB ───────────────────────────────────────────
     The only round, red, EIGHT-SIDED thing on the panel, and every one of those three is doing a
     job: a truck dash is a field of grey rectangles, and the two air valves are deliberately shaped
     and coloured so a hand finds them at night without the eyes leaving the road. Copying that is
     most of why this reads as a cab control rather than a web button.
     It is built as a KNOB ON A COLLAR rather than a flat octagon: the collar is the bezel screwed to
     the dash, the octagon is the part that travels, and the whole read of the control is how far the
     octagon is standing out of the collar. Pushed home it is flush and dark; pulled out it stands
     proud on a lit stem with a shadow under it. */
  .cab-btn.cab-hitchbtn{gap:3px;min-width:52px;padding:4px 4px 5px;border-radius:4px;
    background:linear-gradient(#171b20,#0e1216);border:1px solid #2b333c;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.06), inset 0 -2px 3px rgba(0,0,0,.5)}
  .cab-btn.cab-hitchbtn::before{display:none}          /* it has its own lamp; no tell-tale strip */
  .cab-btn.cab-hitchbtn i{display:block;width:6px;height:6px;border-radius:50%;background:#1d2229;
    box-shadow:inset 0 0 3px #000, 0 1px 0 rgba(255,255,255,.05)}
  /* THE COLLAR AND THE KNOB. The octagon is a clip-path so the silhouette is honest at any size, and
     the knurl is a repeating conic gradient — eight flats catch the light unevenly, which is what
     stops a red octagon reading as a sticker. */
  .cab-btn.cab-hitchbtn b.cab-knobface{position:relative;display:flex;align-items:center;
    justify-content:center;width:30px;height:30px;
    clip-path:polygon(30% 0,70% 0,100% 30%,100% 70%,70% 100%,30% 100%,0 70%,0 30%);
    background:
      repeating-conic-gradient(from 22.5deg,rgba(0,0,0,.20) 0deg 6deg,rgba(255,255,255,.06) 6deg 45deg),
      radial-gradient(120% 120% at 32% 24%,rgba(255,180,170,.28),rgba(0,0,0,.35));
    background-color:#8e2a24;
    transition:transform .09s ease-out, box-shadow .09s ease-out, background-color .09s}
  /* The moulded highlight, up and to the left, the way every one of these is lit in a real cab by
     the windscreen behind it. */
  .cab-btn.cab-hitchbtn b.cab-knobface s{position:absolute;left:14%;top:10%;width:46%;height:32%;
    border-radius:50%;text-decoration:none;
    background:linear-gradient(160deg,rgba(255,255,255,.42),rgba(255,255,255,0));filter:blur(.6px)}
  /* THE STAMPED WORD. Sunk into the plastic, not printed over it. */
  .cab-btn.cab-hitchbtn b.cab-knobface em{position:relative;font:700 8px/1 inherit;font-style:normal;
    letter-spacing:.09em;color:#f4d9d4;text-shadow:0 1px 0 rgba(0,0,0,.65), 0 -1px 0 rgba(255,255,255,.10)}
  .cab-btn.cab-hitchbtn u{display:block;text-decoration:none;font:700 7px/1 inherit;letter-spacing:.1em;
    color:#7f8b98;text-shadow:0 1px 0 rgba(0,0,0,.9)}
  /* PULLED OUT: standing off the dash, lit, with air in it. */
  .cab-btn.cab-hitchbtn.out b.cab-knobface{background-color:#c23b30;transform:translateY(-2px);
    box-shadow:0 4px 6px -2px rgba(0,0,0,.85), inset 0 -2px 4px rgba(0,0,0,.35),
      0 0 10px rgba(194,59,48,.45)}
  .cab-btn.cab-hitchbtn.out i{background:#e05348;box-shadow:0 0 8px #e05348}
  .cab-btn.cab-hitchbtn.out u{color:#c9d2dc}
  /* PUSHED HOME: sunk into its collar, the shadow now falling ON it rather than under it. */
  .cab-btn.cab-hitchbtn:not(.out) b.cab-knobface{transform:translateY(1px);
    box-shadow:inset 0 3px 5px rgba(0,0,0,.6), inset 0 -1px 0 rgba(255,255,255,.08)}
  .cab-btn.cab-hitchbtn:active b.cab-knobface{transform:translateY(2px);
    box-shadow:inset 0 3px 6px rgba(0,0,0,.7)}
  .cab-btn.cab-hitchbtn:active{transform:none}         /* the KNOB travels, not the housing */

  /* ── THE PARK BRAKE ────────────────────────────────────────────────────────
     The trailer valve's twin, in the other regulation colour: red is the trailer, YELLOW is the
     tractor's own spring brakes, and a driver who has seen one dashboard knows which is which
     without a legend. Every rule of the red one is inherited by selector rather than restated —
     the octagon, the moulded highlight, the stamped word, the travel — so the pair can never drift
     apart, and only the colour and the OUT state's meaning are written here. */
  .cab-btn.cab-parkbtn{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:46px}
  .cab-btn.cab-parkbtn b.cab-knobface{position:relative;display:flex;align-items:center;
    justify-content:center;width:30px;height:30px;
    clip-path:polygon(30% 0,70% 0,100% 30%,100% 70%,70% 100%,30% 100%,0 70%,0 30%);
    background:
      repeating-conic-gradient(from 22.5deg,rgba(0,0,0,.20) 0deg 6deg,rgba(255,255,255,.06) 6deg 45deg),
      radial-gradient(120% 120% at 32% 24%,rgba(255,238,170,.30),rgba(0,0,0,.35));
    background-color:#8a6a16;
    transform:translateY(1px);
    box-shadow:inset 0 3px 5px rgba(0,0,0,.6), inset 0 -1px 0 rgba(255,255,255,.08);
    transition:transform .09s ease-out, box-shadow .09s ease-out, background-color .09s}
  .cab-btn.cab-parkbtn b.cab-knobface s{position:absolute;left:14%;top:10%;width:46%;height:32%;
    border-radius:50%;text-decoration:none;
    background:linear-gradient(160deg,rgba(255,255,255,.42),rgba(255,255,255,0));filter:blur(.6px)}
  .cab-btn.cab-parkbtn b.cab-knobface em{position:relative;font:700 8px/1 inherit;font-style:normal;
    letter-spacing:.09em;color:#f6ecc8;text-shadow:0 1px 0 rgba(0,0,0,.65), 0 -1px 0 rgba(255,255,255,.10)}
  .cab-btn.cab-parkbtn u{display:block;text-decoration:none;font:700 7px/1 inherit;letter-spacing:.1em;
    color:#7f8b98;text-shadow:0 1px 0 rgba(0,0,0,.9)}
  .cab-btn.cab-parkbtn i{display:block;width:6px;height:6px;border-radius:50%;background:#1d2229;
    box-shadow:inset 0 1px 2px rgba(0,0,0,.8)}
  /* SET: standing proud of the dash with the brakes on — the state you want visible from the far
     side of the cab, because pulling away against it is the mistake this control exists to make
     possible. */
  .cab-btn.cab-parkbtn.on b.cab-knobface{background-color:#d8a41e;transform:translateY(-2px);
    box-shadow:0 4px 6px -2px rgba(0,0,0,.85), inset 0 -2px 4px rgba(0,0,0,.35),
      0 0 10px rgba(216,164,30,.45)}
  .cab-btn.cab-parkbtn.on i{background:#f0c23a;box-shadow:0 0 8px #f0c23a}
  .cab-btn.cab-parkbtn.on u{color:#c9d2dc}
  .cab-btn.cab-parkbtn:active b.cab-knobface{transform:translateY(2px);
    box-shadow:inset 0 3px 6px rgba(0,0,0,.7)}
  .cab-btn.cab-parkbtn:active{transform:none}

  /* ── THE PUMP HANDLE ───────────────────────────────────────────────────────
     Not a knob and deliberately not shaped like one — the two knobs on this panel are BRAKES, and
     a control that takes money must not be findable by the same shape as the control that stops
     the truck. So it is a wide flat trigger with a readout window in it, which is what a pump is:
     a grip and a number. The face is the meter, so it is monospaced and wide enough for '9999₵'
     without the housing changing size mid-pour (a button that grows while you hold it reads as
     broken). Sodium orange, because that is the colour of every forecourt in this game. */
  .cab-btn.cab-pumpbtn{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:58px}
  .cab-btn.cab-pumpbtn::before{display:none}          /* it has its own lamp */
  .cab-btn.cab-pumpbtn b.cab-pumpface{position:relative;display:flex;align-items:center;
    justify-content:center;width:52px;height:26px;border-radius:3px;
    background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(0,0,0,.35));
    background-color:#3a2d18;
    box-shadow:inset 0 2px 4px rgba(0,0,0,.65), inset 0 -1px 0 rgba(255,255,255,.07);
    transition:transform .09s ease-out, box-shadow .09s ease-out, background-color .12s}
  .cab-btn.cab-pumpbtn b.cab-pumpface s{position:absolute;left:6%;top:8%;width:40%;height:30%;
    border-radius:3px;text-decoration:none;
    background:linear-gradient(160deg,rgba(255,255,255,.30),rgba(255,255,255,0));filter:blur(.6px)}
  .cab-btn.cab-pumpbtn b.cab-pumpface em{position:relative;font-style:normal;
    font:700 9px/1 ui-monospace,'SF Mono',Menlo,Consolas,monospace;letter-spacing:.04em;
    color:#ffb14a;text-shadow:0 0 6px rgba(255,177,74,.5), 0 1px 0 rgba(0,0,0,.7)}
  .cab-btn.cab-pumpbtn u{display:block;text-decoration:none;font:700 7px/1 inherit;letter-spacing:.1em;
    color:#7f8b98;text-shadow:0 1px 0 rgba(0,0,0,.9)}
  .cab-btn.cab-pumpbtn i{display:block;width:6px;height:6px;border-radius:50%;background:#1d2229;
    box-shadow:inset 0 1px 2px rgba(0,0,0,.8)}
  /* PULLED: fuel is moving and the meter is running. */
  .cab-btn.cab-pumpbtn.on b.cab-pumpface{background-color:#6b4a12;transform:translateY(2px);
    box-shadow:inset 0 3px 6px rgba(0,0,0,.7), 0 0 10px rgba(255,177,74,.35)}
  .cab-btn.cab-pumpbtn.on i{background:#f0a83a;box-shadow:0 0 8px #f0a83a}
  .cab-btn.cab-pumpbtn.on u{color:#c9d2dc}
  /* CLICKED OFF: full tank, or the money is gone. The lamp goes out and the meter stops — the
     handle is still in your hand and nothing more is going in, which is the real thing exactly. */
  .cab-btn.cab-pumpbtn.clicked b.cab-pumpface{background-color:#43331a}
  .cab-btn.cab-pumpbtn.clicked b.cab-pumpface em{color:#8f9aa6;text-shadow:0 1px 0 rgba(0,0,0,.7)}
  .cab-btn.cab-pumpbtn.clicked i{background:#1d2229;box-shadow:inset 0 1px 2px rgba(0,0,0,.8)}

  /* ── THE IGNITION BARREL ───────────────────────────────────────────────────
     A lock barrel with a blade in it, and the blade ROTATES: '--keyrot' is written by paintKey and
     is the only thing that moves. Three stops, and the barrel's own face carries the ticks, so the
     angle is readable as a POSITION rather than as an amount of tilt.
     ⚠ The blade turns; the housing does not. That is the whole illusion, and putting the transform
     on the button instead would rotate the collar with it and read as the dash coming loose. */
  .cab-key{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:46px}
  .cab-keybarrel{position:relative;width:30px;height:30px;padding:0;border-radius:50%;
    background:radial-gradient(120% 120% at 34% 26%,#39414c,#1b2027 62%,#0c1015);
    border:1px solid #454e5a;cursor:pointer;touch-action:none;
    box-shadow:0 3px 7px -3px #000, inset 0 1px 0 rgba(255,255,255,.12)}
  /* The escutcheon's tick marks — OFF, ON, START, at the three angles KEY_DEG names. Drawn as one
     conic gradient rather than three elements: they are paint on a plate, not parts. */
  .cab-keybarrel::before{content:'';position:absolute;inset:-4px;border-radius:50%;pointer-events:none;
    background:conic-gradient(from -4deg,rgba(190,204,220,.55) 0deg 3deg,transparent 3deg 34deg,
      rgba(190,204,220,.55) 34deg 37deg,transparent 37deg 70deg,
      rgba(224,160,90,.65) 70deg 73deg,transparent 73deg 360deg);
    -webkit-mask:radial-gradient(circle,transparent 62%,#000 64%);
            mask:radial-gradient(circle,transparent 62%,#000 64%)}
  /* THE BLADE. A flat steel wafer standing up out of the barrel, plus the bow you hold. */
  .cab-keybarrel s,.cab-keybarrel b{position:absolute;left:50%;top:50%;text-decoration:none;
    transform-origin:50% 50%;
    transform:translate(-50%,-50%) rotate(var(--keyrot,0deg));
    transition:transform .16s cubic-bezier(.34,1.3,.64,1)}
  .cab-keybarrel s{width:4px;height:22px;border-radius:1px;
    background:linear-gradient(90deg,#5d6874,#c3cdd9 45%,#7c8794);
    box-shadow:0 0 3px rgba(0,0,0,.8)}
  /* The bow, offset down the blade's own axis so it rides round with it. */
  .cab-keybarrel b{width:12px;height:9px;border-radius:2px 2px 5px 5px;margin-top:9px;
    background:linear-gradient(#8e9aa8,#454e5a);box-shadow:0 1px 2px rgba(0,0,0,.7)}
  .cab-keybarrel.on{border-color:#4e9a5c;box-shadow:0 3px 7px -3px #000, 0 0 8px rgba(78,154,92,.35), inset 0 1px 0 rgba(255,255,255,.12)}
  /* CRANKING is the one state with a colour, because it is the one state that is temporary and that
     you are actively holding — the dash's way of saying the starter is turning. */
  .cab-keybarrel.cranking{border-color:#e0a05a;box-shadow:0 0 12px rgba(224,160,90,.55)}
  .cab-keybarrel:focus-visible{outline:2px solid #e8c07a;outline-offset:2px}

  /* ── THE CB SET ────────────────────────────────────────────────────────────
     A radio in the same recessed housing as everything else on this panel: a lit channel readout,
     a knob that turns, and two rockers. The KNOB is the only genuinely new shape in the cab, and
     the rotation is done with a CSS custom property ('--cb-turn', 0..1) set from the widget, so
     the pointer's angle is a render of the channel rather than a second number to keep in step. */
  .cab-cb{display:flex;align-items:center;gap:6px;padding:5px;border-radius:6px;
    background:linear-gradient(#0b0f13,#070a0d);border:1px solid #1b232b;
    box-shadow:inset 0 2px 6px rgba(0,0,0,.75)}
  /* THE SET. Pressing it opens the Deadhead window, so it reads as a screen you can touch rather
     than as another switch — a lit LCD with the channel on it, in the amber the rest of the dash
     lights in. */
  .cab-cb-set{display:flex;flex-direction:column;align-items:center;gap:1px;cursor:pointer;
    min-width:44px;padding:3px 5px 4px;border-radius:3px;border:1px solid #2b333c;
    background:linear-gradient(#0a1418,#060c0f);box-shadow:inset 0 0 8px rgba(0,0,0,.8)}
  .cab-cb-band{font:700 7px/1 inherit;letter-spacing:.18em;color:#5d6b78}
  .cab-cb-chan{font:700 17px/1 ui-monospace,monospace;color:var(--cab-glow,#e8c07a);
    text-shadow:0 0 9px rgba(232,192,122,.55)}
  /* OFF IS A DARK SET, not a hidden one. The controls stay exactly where they were and stay
     operable — the way back on is the same switch, and a panel that vanishes when you turn it off
     is a panel you cannot turn on. */
  .cab-cb.off .cab-cb-chan{color:#3a444e;text-shadow:none}
  .cab-cb.off .cab-cb-pointer{background:#3a444e;box-shadow:none}
  /* THE KNOB. 300 degrees of travel like a real detented dial, leaving a dead sector at the
     bottom so the ends of the band are visibly ends rather than wrapping round. */
  .cab-cb-dial{position:relative;width:30px;height:30px;border-radius:50%;cursor:ns-resize;
    background:radial-gradient(circle at 38% 32%,#39424d,#161b21 68%,#0c1014);
    border:1px solid #2b333c;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.10), 0 2px 5px -2px #000;
    transform:rotate(calc(-150deg + var(--cb-turn,0) * 300deg));transition:transform .12s ease-out}
  .cab-cb-dial:focus-visible{outline:2px solid var(--cab-glow,#e8c07a);outline-offset:2px}
  .cab-cb-pointer{position:absolute;left:50%;top:3px;width:2px;height:9px;margin-left:-1px;
    border-radius:1px;background:var(--cab-glow,#e8c07a);box-shadow:0 0 6px rgba(232,192,122,.6)}
  .cab-cb-sw{display:flex;gap:5px}
  .cab-cb-spk.on i{background:#7fc4a0;box-shadow:0 0 8px #7fc4a0}
  /* Narrow cabs drop the dial's housing to a column rather than shrinking the knob: a 30px knob
     is already the smallest thing on this panel anybody is expected to hit. */
  @media (max-width:900px){ .cab-cb{flex-wrap:wrap;justify-content:center;max-width:104px} }

  /* ── THE ROUTE PICKER ──────────────────────────────────────────────────────
     Over the glass, anchored to the right where the screen it belongs to is. It is a panel rather
     than something drawn on the canvas because it is a LIST OF BUTTONS — tab order, focus rings and
     a screen reader all come free from being real elements, and none of them would exist on a
     canvas hit-test. */
  .cab-routes{position:absolute;right:10px;bottom:76px;z-index:6;min-width:210px;max-width:44%;
    background:rgba(6,10,14,.94);border:1px solid #35404b;border-radius:5px;padding:7px;
    box-shadow:0 10px 26px -10px #000;backdrop-filter:blur(3px)}
  .cab-routes-hd{font:700 9px/1 inherit;letter-spacing:.14em;color:var(--cab-glow,#e8c07a);
    padding:2px 3px 6px}
  /* ── THE GPS UNIT'S CHROME ────────────────────────────────────────────────
     A dash screen is a bezel with a strip of buttons along the top, so that is what this is: tabs
     on the left, the two window controls on the right, and a body under it that each app paints.
     The header doubles as the drag handle once the unit is popped out — which is why it is a real
     bar with padding rather than a row of floating buttons. */
  .cab-gps-hd{display:flex;align-items:center;gap:6px;margin:-2px -2px 6px;padding:3px 3px 5px;
    border-bottom:1px solid #29323c}
  .cab-gps-tabs{display:flex;gap:3px;flex:1 1 auto;min-width:0}
  .cab-gps-tab{padding:3px 8px;cursor:pointer;border-radius:3px;border:1px solid transparent;
    background:none;color:#8b97a6;font:700 9px/1 inherit;letter-spacing:.12em}
  .cab-gps-tab:hover{color:#cfd9e5}
  .cab-gps-tab.on{color:var(--cab-glow,#e8c07a);border-color:#3c4753;background:#131a21}
  .cab-gps-pop,.cab-gps-x{background:none;border:0;cursor:pointer;color:#8b97a6;font:700 12px/1 inherit;padding:2px 4px}
  .cab-gps-pop:hover,.cab-gps-x:hover{color:#eaf1f8}
  .cab-gps-body{max-height:min(52vh,420px);overflow:auto}
  /* POPPED OUT. Fixed rather than absolute, so it is free of the windscreen's box and can be put
     anywhere on the page; wider, because the whole reason to pop it out is that you are reading it
     rather than glancing at it. The drag handle gets the cursor that says so. */
  .cab-routes.cab-gps-out{position:fixed;right:auto;bottom:auto;min-width:340px;max-width:min(560px,92vw);
    z-index:60;box-shadow:0 22px 60px -18px #000,0 0 0 1px #46525f}
  .cab-routes.cab-gps-out .cab-gps-hd{cursor:grab}
  .cab-routes.cab-gps-out .cab-gps-hd:active{cursor:grabbing}
  .cab-routes.cab-gps-out .cab-gps-body{max-height:min(70vh,620px)}
  .cab-route{display:block;width:100%;text-align:left;margin:0 0 4px;padding:6px 8px;cursor:pointer;
    background:#141a20;border:1px solid #2f3944;border-radius:4px;color:#cfd9e5;font:600 12px/1.25 inherit}
  .cab-route:hover{background:#1d252d;border-color:#5c6672}
  .cab-route b{display:block;color:#eaf1f8;font-size:13px}
  .cab-route-d{display:block;font-size:10px;color:#8b95a2;letter-spacing:.04em;margin-top:2px}
  .cab-route i{display:block;font-size:9px;color:#8fe0a0;font-style:normal;margin-top:3px}
  .cab-route.on{border-color:#8fe0a0}
  /* Shown, never hidden: the fuel judgement is the driver's to make, and a row that is missing is
     a mystery where a row that says why is information. */
  .cab-route.r-thin .cab-route-d{color:#d8a24e}
  .cab-route.r-far .cab-route-d{color:#d2603f}
  .cab-routes-ft{font:10px/1.3 inherit;color:#7c848f;padding:4px 3px 1px}
  .cab-routes-ft.warn{color:#d8a24e}
  .cab-routes-none{font:11px/1.3 inherit;color:#8b95a2;padding:3px}
  .cab-route:focus-visible{outline:2px solid #e8c07a;outline-offset:2px}

  /* ── WHO HAS THE KEYBOARD ──────────────────────────────────────────────────
     Bottom-right of the glass, quiet while it is right and loud the moment it is not — because
     the failure it exists for is silent by nature: keys going into a text box you are not
     looking at. */
  .cab-focustag{position:absolute;right:8px;bottom:8px;z-index:5;cursor:pointer;
    background:rgba(6,10,14,.72);border:1px solid #2f3944;color:#6f7883;
    font:600 9px/1 inherit;letter-spacing:.10em;padding:4px 7px;border-radius:4px}
  .cab-focustag.away{border-color:#d8a24e;color:#f0c777;background:rgba(30,20,6,.85);
    animation:cab-keys-warn 1.4s ease-in-out infinite}
  .cab-focustag:hover{color:#dfe8f2;border-color:#5c6672}
  @keyframes cab-keys-warn{0%,100%{box-shadow:0 0 0 0 rgba(216,162,78,0)}50%{box-shadow:0 0 0 3px rgba(216,162,78,.28)}}
  /* Steering with a hand on the road. The cursor is the whole affordance — there is no widget
     here to hint at one. */
  .cab-wrap .ws-wrap{cursor:grab}
  .cab-wrap.cab-ext .ws-wrap{cursor:move}
  .ws-wrap.cab-glass-drag{cursor:grabbing}
  /* The look tag over the glass. It has to be loud: a driver whose pointer slipped off a
     shoulder-check needs to know instantly why the road is going sideways. */
  .ws-label-look{color:#0a0c0f !important;background:var(--cab-glow,#e8c07a);padding:1px 6px;border-radius:3px}
  /* A DASH SWITCH, not a dialog button. Domed rather than flat (a radial highlight off the top
     left is what reads as moulded plastic), a lip of shadow underneath so it stands off the panel,
     and it goes DOWN when pressed instead of merely changing colour.
     Two children: the glyph, which is what you aim at, and the engraved legend, which is what
     tells you what it does without a tooltip. Both are inside the button, so the accessible name
     is unchanged and nothing here is a caption floating next to a control. */
  /* ── A KEY, INDIVIDUALLY HOUSED ─────────────────────────────────────────────
     Modelled on a real truck control box: every function is its own moulded key in its own bezel,
     with a TELL-TALE STRIP across the top, a pictogram, and the word underneath. The strip is what
     makes a panel of these readable at a glance — you are not reading twelve labels, you are
     looking for the one that is lit — and it is why each key needs its own housing rather than
     being one cell of a shared strip.
     'gap' is deliberately generous and the housing deliberately dark: on the reference, what reads
     as quality is the BLACK BETWEEN the keys as much as the keys themselves. */
  .cab-btn{position:relative;display:inline-flex;flex-direction:column;align-items:center;
    justify-content:flex-end;gap:2px;min-width:50px;min-height:44px;padding:9px 6px 5px;
    font:600 13px/1 inherit;color:#dbe4ef;cursor:pointer;touch-action:none;user-select:none;
    border:1px solid #05080b;border-radius:5px;
    background:
      repeating-linear-gradient(0deg,rgba(255,255,255,.018) 0 1px,transparent 1px 3px),
      linear-gradient(#2c333b 0%,#222931 52%,#171d24 53%,#11161c 100%);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.10), inset 0 -1px 0 rgba(0,0,0,.6),
      0 2px 0 #06090c, 0 3px 5px -2px rgba(0,0,0,.7);
    transition:transform .05s ease-out, box-shadow .07s, filter .07s}
  /* THE TELL-TALE. Dark until the control is doing something; the key's own accent when it is. */
  .cab-btn::before{content:'';position:absolute;top:3px;left:50%;transform:translateX(-50%);
    width:56%;height:3px;border-radius:1px;background:#0d1319;
    box-shadow:inset 0 0 2px #000;transition:background .08s, box-shadow .08s}
  .cab-btn b{display:block;font-weight:700;line-height:1;font-size:15px;
    text-shadow:0 1px 1px rgba(0,0,0,.8)}
  /* A pictogram sits where the glyph did and inherits the key's colour, so the tell-tale, the hover
     and the disabled state all reach it with no extra rules. */
  .cab-btn b svg{width:18px;height:18px;display:block;color:#cbd6e3}
  .cab-btn.on b svg{color:#fff}
  /* The range collar shows BOTH — the little ladder says what the control is, the word says which
     way it is set, because LO and HI are the two states you must never have to guess between. */
  .cab-rangeic{position:absolute;top:8px;left:50%;transform:translateX(-50%);width:14px;height:14px;
    color:#7d8794;opacity:.9}
  .cab-rangeic svg{width:100%;height:100%;display:block}
  .cab-range{padding-top:22px}
  .cab-range.on .cab-rangeic{color:var(--cab-glow,#e8c07a)}
  /* The legend. Brighter than the first pass — on the reference these are near-white, because the
     word is what you actually navigate by; the pictogram only confirms it. */
  .cab-btn em{display:block;font:700 7px/1 inherit;font-style:normal;letter-spacing:.11em;
    color:#aab5c2;text-shadow:0 1px 0 rgba(0,0,0,.9)}
  .cab-btn:hover{filter:brightness(1.12)}
  /* Pressed: the key goes down onto its own shadow, which is what the 0 2px 0 under it is for. */
  .cab-btn:active{transform:translateY(2px);
    box-shadow:inset 0 2px 5px rgba(0,0,0,.6), 0 0 0 #06090c}
  .cab-btn.on::before{background:var(--key,#e8c07a);
    box-shadow:0 0 6px var(--key,#e8c07a), 0 0 2px var(--key,#e8c07a)}
  .cab-btn.on em{color:#fff}
  .cab-btn.on{filter:brightness(1.06)}
  /* Colour-coded by what the control DOES, the way the reference groups engine, view and comfort.
     The tell-tale carries it; the key face stays the same moulding throughout, because a dash of
     twelve different coloured plastics is a toy. */
  /* A ROCKER IS NOT A KEY and keeps being a rocker: a real cab has both, and the ask was that
     each control look like the thing it actually is rather than like its neighbours. It carries
     its own tell-tale drilled into the bezel, so it must not also grow the key strip — two lamps
     on one switch is the tell that a style was applied rather than chosen. */
  .cab-btn.cab-rocker::before{display:none}
  .cab-btn.cab-rocker{padding:4px 4px 5px;justify-content:center;min-height:44px}
  .cab-jake{--key:#4e9ab0}
  .cab-wipe{--key:#6fa8d0}
  /* ── THE COLUMN STALK ───────────────────────────────────────────────────────
     A boss on the column and an arm off it, and the ARM'S ANGLE IS THE STATE: --pos steps 0..3 and
     the arm swings 14° a detent. That is the whole reason this is a stalk rather than a fourth
     rocker — a rocker can say on or off, and this says which of four without a lamp or a word,
     which is exactly how you read one at 60mph without looking at it.
     The word underneath is there anyway, because "slightly further round than it was" is not
     something anyone should have to judge on a screen. */
  .cab-stalk{position:relative;display:flex;flex-direction:column;align-items:center;
    width:78px;height:56px;padding:0;background:none;border:0;cursor:pointer;
    touch-action:none;user-select:none;color:#c9d4e1}
  .cab-stalk-mount{position:absolute;left:50%;top:12px;width:15px;height:15px;margin-left:-7.5px;
    border-radius:50%;background:radial-gradient(circle at 36% 30%,#4b5763,#1b2129 70%,#0c1015);
    border:1px solid #05080b;box-shadow:0 2px 4px -1px rgba(0,0,0,.7)}
  /* The arm. Hinged at the boss, so it sweeps rather than slides. */
  .cab-stalk-arm{position:absolute;left:50%;top:17px;width:36px;height:7px;margin-left:-3px;
    transform-origin:4px 4px;
    transform:rotate(calc(-8deg + var(--pos,0) * 14deg));
    border-radius:4px;
    background:linear-gradient(#3d4653,#232a32 55%,#141a20);
    border:1px solid #05080b;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.14), 0 2px 3px -1px rgba(0,0,0,.65);
    transition:transform .13s cubic-bezier(.3,1.4,.5,1)}
  /* The pictogram rides the tip of the arm, on the collar you actually twist. */
  .cab-stalk-arm b{position:absolute;right:-7px;top:50%;transform:translateY(-50%);
    width:17px;height:17px;color:#8f9dad;transition:color .1s}
  .cab-stalk-arm b svg{width:100%;height:100%;display:block}
  .cab-stalk.on .cab-stalk-arm b{color:#6fa8d0}
  .cab-stalk-pos{position:absolute;left:0;right:0;bottom:1px;font:700 8px/1 inherit;
    font-style:normal;letter-spacing:.12em;color:#8b95a2;text-shadow:0 1px 0 rgba(0,0,0,.9)}
  .cab-stalk.on .cab-stalk-pos{color:#cfe3f2}
  .cab-stalk:hover .cab-stalk-arm{filter:brightness(1.15)}
  .cab-stalk:focus-visible{outline:2px solid #e8c07a;outline-offset:2px;border-radius:5px}
  /* Rain on the glass and the stalk still off: the arm nudges rather than a border flashing. */
  .cab-stalk.hint .cab-stalk-arm{animation:cab-stalk-hint 1.3s ease-in-out infinite}
  @keyframes cab-stalk-hint{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(0deg)}}
  .cab-horn{--key:#e0b45a}
  .cab-rev,.cab-revbtn{--key:#d2603f}
  /* Refusing is a STATE, not a silence: rolling, the button dims rather than doing nothing. */
  .cab-revbtn[disabled]{opacity:.42;cursor:default}
  .cab-splitbtn{--key:#8fe0a0}
  .cab-lookl,.cab-lookr,.cab-lookb{--key:#8fa4bc}
  .cab-left,.cab-right{--key:#9fb4c8}
  /* The housing is screwed to the dash: pressing the switch must not repaint or move it. Both
     of these restate the bezel because .cab-btn:active and .cab-btn.on tie on specificity with
     .cab-btn.cab-rocker and come later in the sheet, so without them a press would hand the
     rocker a push-button gradient and lose the pivot entirely. */
  .cab-btn.cab-rocker:active,
  .cab-btn.cab-rocker.on{transform:none;background:linear-gradient(#171b20,#0e1216);
    border-color:#2b333c;box-shadow:inset 0 1px 0 rgba(255,255,255,.06), inset 0 -2px 3px rgba(0,0,0,.5)}
  .cab-btn:active{transform:translateY(1px);
    background:radial-gradient(120% 100% at 30% 8%,#2b333c,#1b2129 55%,#121820);
    box-shadow:inset 0 2px 4px rgba(0,0,0,.55)}
  .cab-btn.on{background:radial-gradient(120% 100% at 30% 8%,#3d4854,#2a323b 55%,#1a2027);
    border-color:#5c6672;color:#fff;box-shadow:inset 0 2px 4px rgba(0,0,0,.5)}
  .cab-btn.on em{color:#aeb9c6}
  .cab-horn:active{border-color:#e0b45a;box-shadow:0 0 10px rgba(224,180,90,.45)}
  /* Rain on the glass and the stalk still off: the button asks once, rather than a line of prose
     in the log telling a driver about a key. It stops the moment they touch it. */
  .cab-jake.on{border-color:#4e8a9a}
  .cab-gear{min-width:1.6em;text-align:center}
  .cab-brakes.b-hot{color:#d8a24e}
  .cab-brakes.b-fade{color:#d2603f}
  .cab-riginfo.b-fade{color:#d2603f}
  .cab-gear.g-band{color:#7fc98b}
  .cab-gear.g-stall{color:#d2603f}
  /* ── THE FOUR CABS ────────────────────────────────────────────────────────
     Materials, and only materials. A tier changes what the shelf is MADE of and
     which instruments are bolted to it (CAB_KIT) — never a number the physics
     read, which all live in effTruckParams on the server. */
  /* Chipped brown enamel over steel — the same board CAB_TRIM[0] paints up on the glass, so the
     shelf and the fascia are one truck rather than two. Brown, and NOT the Orlov's brown: this one
     is chalky and desaturated where that one is deep and varnished. */
  .cab-t0 .cab-controls{background:linear-gradient(#2a211a,#130d08);border-top-color:#493826}
  .cab-t0 .cab-btn,.cab-t0 .cab-gate{background:#241c15;border-color:#4a3927}
  .cab-t0 .cab-pedal{border-color:#4a3927}
  .cab-t0 .cab-readout span{color:#8d7b64}
  .cab-t2 .cab-controls{background:linear-gradient(#182219,#0a100c);border-top-color:#2b3a30}  /* green vinyl */
  .cab-t2 .cab-btn,.cab-t2 .cab-gate{background:#16201a;border-color:#2e4033}
  .cab-t2 .cab-pedal{border-color:#2e4033}
  /* Walnut and brass, and a warm lamp over the bunk washing down onto the shelf. The Orlov is a
     bedroom; the pool of light is the single strongest thing that says so. */
  .cab-t3 .cab-controls{background:
      radial-gradient(140% 180% at 50% -60%,rgba(255,214,150,.16),transparent 60%),
      linear-gradient(#2c211a,#100b07);border-top-color:#5a4028}
  .cab-t3 .cab-btn,.cab-t3 .cab-gate{background:#241a13;border-color:#5a4028;color:#e6d3b6}
  .cab-t3 .cab-pedal{border-color:#5a4028}
  .cab-t3 .cab-readout span{color:#9c8a72}
  /* Touch: the controls get BIGGER on a small screen rather than smaller, because that is the one
     place they are the only way in — the wheel shrinks to make room for them, not the reverse. */
  @media (max-width:700px){
    .cab-readout b{font-size:17px}
    .cab-controls{flex-wrap:wrap;gap:8px}
    .cab-btn{min-width:44px;min-height:44px;font-size:15px}
    .cab-pedal{width:48px;height:56px}
    .cab-brake{width:54px}
    .cab-throttle{height:62px}
    /* The gate gets BIGGER on touch, not smaller — it is six targets in one plate and on a phone
       it is the only way to shift at all. One pair of variables moves the rails, the marks and the
       knob together, because they are all expressed as fractions of it. */
    .cab-gate{--gw:186px;--gh:118px}
    .cab-lever{width:26px;height:26px;margin:-13px 0 0 -13px}
  }
  @media (pointer:coarse){ .cab-btn{min-width:44px;min-height:44px} .cab-pedal{min-width:46px} }
  /* ── TOUCH-ONLY CONTROLS ────────────────────────────────────────────────────
     Steering, the shoulder-checks and the horn are all things a desktop driver already has a
     better way to do — drag the wheel or hold an arrow key, Q/E/S, and the horn is the boss in the
     middle of the wheel you can simply press. On a touch screen none of those exist, so the
     buttons do. Showing them to everybody is what made the cab look like a game pad bolted to a
     picture of a truck: eight controls on screen for things two keys already did.
     ⚠ HIDDEN, NOT DELETED, and hidden by POINTER rather than by width — a small window on a
     desktop still has a keyboard, and a tablet in landscape still does not. */
  @media (hover:hover) and (pointer:fine){ .cab-touch{display:none !important} }
  /* ⚠ EXCEPT IN THE CHASE VIEW, where they are the only way in. Out there the wheel is not on
     screen to drag, the painted dash is behind the camera, and a pointer drag means ORBIT — so a
     desktop driver in the external view has no pointer route to steering at all. The controls a
     cockpit made redundant stop being redundant the moment you leave the cockpit. */
  body .cab-wrap.cab-ext .cab-touch{display:flex !important}

  /* ── THE GLASS CHROME ──────────────────────────────────────────────────────
     Deliberately the flight sim's chrome, moved: same corner, same glyphs, same
     precedence (fullscreen beats hide-panel). A driver who has flown does not
     have to learn a second set. */
  .cab-chrome{position:absolute;top:6px;right:6px;z-index:5;display:flex;gap:4px}
  .cab-cbtn{background:rgba(6,10,14,.82);border:1px solid #3a4550;color:#dfe8f2;
    font:600 12px/1 inherit;padding:5px 8px;border-radius:4px;cursor:pointer;backdrop-filter:blur(2px)}
  .cab-cbtn:hover{background:var(--cab-glow,#e8c07a);color:#0a0c0f;border-color:var(--cab-glow,#e8c07a)}
  .cab-cbtn.on{background:var(--cab-glow,#e8c07a);color:#0a0c0f;border-color:var(--cab-glow,#e8c07a)}
  .cab-cbtn:focus-visible{outline:2px solid #e8c07a;outline-offset:2px}
  /* Fullscreen / hide-panel. Body classes, because what they change is the PAGE
     and not the cab — the same seam \`fsim-fullscreen\` uses. */
  /* ⚠ THESE ARE THE FLIGHT SIM'S RULES, COPIED, and they have to be — the cab had invented its own
     and got both halves wrong. It hid \`#sidebar\` and \`#input-row\`; the elements are \`#output\`,
     \`#look-resize-handle\` and \`#bottom-input-wrap\`, so two of the three selectors matched nothing
     and the log stayed. And it took \`#area-pane\` out of the flex column with \`position:fixed\`,
     which left the pane's own 12px padding and \`overflow-y:auto\` in place around a wrap that was
     then asking for 100% of a height nobody had set — a cab inset from every edge with a scrollbar,
     which is exactly what "it doesn't expand" looked like.
     The sim's approach is the correct one and is already proven on three panels (fsim, helm,
     passenger): don't leave the column, GROW in it. */
  /* ⚠ THE !important IS LOAD-BEARING AND IS NOT A SPECIFICITY HACK. The look-resize handle lets a
     player drag the room pane's height, and it stores that as an INLINE style on #area-pane,
     restored from localStorage on every boot (main.js, 'lookPaneHeight'). An inline height beats
     every class rule there is, so for anybody who had ever dragged that handle — which is most
     people — fullscreen grew the pane's ALLOWANCE and then left it pinned at 535px anyway. That is
     why it kept "not expanding" after the flex rules were already correct: the flex rules WERE
     applying, and losing to a style attribute.
     We beat it rather than clearing it, because that height is the player's saved preference for
     ordinary rooms and fullscreen is a temporary mode — dispatching 'lookpaneauto' (the hangar
     bay's seam) would delete it for good on a passing glance at the road. */
  body.cab-fullscreen #area-pane,
  body.cab-hidepanel #area-pane{max-height:none !important;height:auto !important;flex:1 1 auto}
  body.cab-fullscreen #area-pane{padding:0}   /* reach every edge — the inset is stolen road */
  body.cab-fullscreen #area-content,
  body.cab-hidepanel #area-content{flex:1 1 auto;display:flex;min-height:0}
  body.cab-fullscreen .cab-wrap,
  body.cab-hidepanel .cab-wrap{flex:1 1 auto;min-height:0;height:auto}
  body.cab-fullscreen #output,
  body.cab-fullscreen #look-resize-handle,
  body.cab-fullscreen #bottom-input-wrap{display:none}
  body.cab-hidepanel #output,
  body.cab-hidepanel #look-resize-handle{display:none}
  /* ── FULLSCREEN GIVES YOU MORE ROAD, NOT A BIGGER DASH ─────────────────────
     Going fullscreen used to hand the extra height to the shelf as readily as to the glass: the
     dash is a flex row that grows, so a taller window bought a taller strip of buttons and the
     windscreen got what was left. Which is backwards — the reason to go fullscreen is the view.
     So at fullscreen the shelf STOPS BEING A SHELF and becomes a HUD: absolutely positioned over
     the bottom of the glass, on a gradient that fades into the road rather than cutting it off,
     with the windscreen running the full height of the screen behind it. The renderer's camera is
     unchanged and does not need changing — it fills the canvas it is given, so a canvas that is
     now the whole viewport genuinely shows more world in every direction.
     Nothing moves, nothing is hidden, and every control is exactly where it was. */
  body.cab-fullscreen .cab-wrap > .ws-wrap{position:absolute;inset:0;height:100%;border-radius:0}
  /* ⚠ NO BACKDROP BLUR. There was one, and it was the whole of "the fullscreen gauges are fuzzy":
     the HUD sits over the bottom of the glass, and the bottom of the glass is where the PAINTED
     INSTRUMENTS are — the dial faces, their needles, the numerals and the wheel are all on the dash
     canvas underneath this strip. A backdrop-filter blurs what is behind it, so the scrim meant to
     separate the shelf from the road was softening the only things on screen you have to read a
     number off. The gradient alone does the separating; it always did. */
  body.cab-fullscreen .cab-controls{position:absolute;left:0;right:0;bottom:0;z-index:4;
    border-top:none;padding-top:26px;
    background:linear-gradient(to top,rgba(6,8,11,.94) 0%,rgba(6,8,11,.86) 55%,rgba(6,8,11,0) 100%)}
  body.cab-fullscreen .cab-controls::before{opacity:0}
  /* ⚠ THE HUD IS A PICTURE, THE CONTROLS IN IT ARE THE TARGETS. Absolutely positioned over the
     glass, this strip was a full-width sheet of hit-testable nothing lying across the bottom of the
     scene — and the bottom of the scene is where the PAINTED WHEEL is. So the half of the wheel
     nearest you, the part with the most leverage and the part a hand reaches for first, could not
     be grabbed at all: the pointer landed on the scrim. Every miss looked like a bad hit-test in
     the 'drawCabWheel' geometry, and the geometry was right the whole time.
     The strip itself takes no pointer, its actual control groups take theirs back, and the gaps
     between them are glass again — which is what they look like. */
  body.cab-fullscreen .cab-controls{pointer-events:none}
  body.cab-fullscreen .cab-controls > *{pointer-events:auto}
  /* The instruments earn the extra room the shelf gave up. */
  body.cab-fullscreen .cab-focustag{bottom:auto;top:44px}
  body.cab-fullscreen .cab-dmg{bottom:auto;top:44px;left:8px}
  /* Hide-panel is the same idea one rung down: the pane grows, and the shelf is a shelf still —
     it is only fullscreen that is worth the HUD, because it is only fullscreen where the view is
     the entire point of what is on the screen. */

  /* ── THE DAMAGE HUD ────────────────────────────────────────────────────────
     Bottom-left of the glass, opposite the view chrome. Small enough to ignore
     when everything is fine, and the pips carry the colour so a bad one is
     visible without reading anything. */
  .cab-dmg{position:absolute;left:6px;bottom:6px;z-index:5;display:flex;flex-direction:column;
    align-items:flex-start;gap:5px}
  .cab-dmg-strip{display:flex;gap:3px;align-items:flex-end;background:rgba(6,10,14,.8);
    border:1px solid #3a4550;border-radius:4px;padding:4px 5px;cursor:pointer}
  .cab-dmg-strip:focus-visible{outline:2px solid #e8c07a;outline-offset:2px}
  .cab-dmg-strip.warn{border-color:#8a6a2e}
  .cab-dmg-strip.bad{border-color:#9a4e4e;animation:cab-dmg-pulse 1.6s ease-in-out infinite}
  @keyframes cab-dmg-pulse{0%,100%{box-shadow:0 0 0 0 rgba(210,96,63,0)}50%{box-shadow:0 0 0 3px rgba(210,96,63,.3)}}
  .cab-pip{position:relative;display:flex;flex-direction:column-reverse;align-items:center;
    width:16px;height:26px;background:#12161b;border-radius:2px;overflow:hidden}
  /* The fill is bottom-anchored, so a bar that is going down LOOKS like it is going down. */
  .cab-pip em{display:block;width:100%;background:#5f8f6a}
  .cab-pip b{position:absolute;bottom:1px;font:600 7px/1 inherit;letter-spacing:.04em;
    color:#dfe8f2;text-shadow:0 1px 2px #000}
  .cab-pip.b-worked em{background:#6f8f5f}
  .cab-pip.b-tired em{background:#b08a3e}
  .cab-pip.b-ailing em{background:#c07038}
  .cab-pip.b-derelict em{background:#c04a3a}
  .cab-dmg-full{background:rgba(6,9,13,.94);border:1px solid #3a4550;border-radius:6px;
    padding:10px 12px;color:#d5dde7;font-size:11px;min-width:250px}
  .cab-dmg-full[hidden]{display:none}
  .cab-dmg-full h4{margin:0 0 7px;font-size:10px;letter-spacing:.18em;color:var(--cab-glow,#e8c07a)}
  .cab-dmg-row{display:grid;grid-template-columns:60px 1fr 34px;gap:6px;align-items:center;margin:3px 0}
  .cab-dmg-lbl{font-size:9px;letter-spacing:.1em;color:#8b95a2}
  .cab-dmg-bar{height:7px;background:#12161b;border-radius:3px;overflow:hidden}
  .cab-dmg-bar i{display:block;height:100%;background:#5f8f6a}
  .cab-dmg-bar.b-worked i{background:#6f8f5f}
  .cab-dmg-bar.b-tired i{background:#b08a3e}
  .cab-dmg-bar.b-ailing i{background:#c07038}
  .cab-dmg-bar.b-derelict i{background:#c04a3a}
  .cab-dmg-row b{font-variant-numeric:tabular-nums;font-size:11px;text-align:right}
  /* The note wraps under its row rather than squeezing the bar — it is the part you read once. */
  .cab-dmg-note{grid-column:2 / -1;font-size:9px;color:#6f7883;margin-top:-2px}
  .cab-dmg-foot{margin:8px 0 0;font-size:10px;color:#78828e;line-height:1.5}

  /* The controls card. It sits over the glass rather than in the dash, because
     it is not part of the truck — and it closes on any click, so it can never be
     the thing between a driver and a brake pedal. */
  .cab-help{position:absolute;inset:8px 8px auto 8px;z-index:6;max-height:calc(100% - 16px);
    overflow:auto;background:rgba(6,9,13,.94);border:1px solid #3a4550;border-radius:6px;
    padding:12px 14px;color:#d5dde7;font-size:12px;line-height:1.45}
  .cab-help[hidden]{display:none}
  .cab-help h4{margin:0 0 8px;font-size:11px;letter-spacing:.18em;color:var(--cab-glow,#e8c07a)}
  .cab-help dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:0}
  .cab-help dt{color:var(--cab-glow,#e8c07a);font-weight:600;white-space:nowrap}
  .cab-help dd{margin:0;color:#aeb9c6}
  .cab-help-foot{margin:10px 0 0;color:#78828e;font-size:11px}

  /* Hitting something. The view takes the hit — which is what makes the printed
     line unnecessary below reporting speed. */
  .cab-jolt .ws-wrap{animation:cab-jolt .28s ease-out}
  .cab-jolt-hard .ws-wrap{animation:cab-jolt-hard .55s cubic-bezier(.2,.9,.3,1)}
  @keyframes cab-jolt{0%{transform:translate3d(0,4px,0)}55%{transform:translate3d(-2px,-2px,0)}100%{transform:none}}
  @keyframes cab-jolt-hard{0%{transform:translate3d(0,14px,0) rotate(.6deg)}
    30%{transform:translate3d(-8px,-6px,0) rotate(-.5deg)}
    60%{transform:translate3d(5px,3px,0) rotate(.25deg)}100%{transform:none}}
  @media (prefers-reduced-motion:reduce){.cab-jolt .ws-wrap,.cab-jolt-hard .ws-wrap{animation:none}}

  `;
  document.head.appendChild(s);
}

export function closeCab() {
  if (!st) return;
  // The immersive layouts are the PAGE's, not the pane's — nothing else takes them down, and a
  // driver who parked in fullscreen would be left with no log and no command box.
  document.body.classList.remove('cab-fullscreen', 'cab-hidepanel');
  suppressWeatherFx(false, 'cab');
  cancelAnimationFrame(st.raf);
  stopEngineAudio();                                 // the diesel does not idle on in an empty room
  stopDamageBed();                                   // …and neither does the rattle it was making
  removeEventListener('keydown', st.onKey);
  removeEventListener('keyup', st.onKey);
  if (st.onFocusIn) removeEventListener('focusin', st.onFocusIn);
  // Each pedal and steer button parked a release on the window (a pointerup that lands outside the
  // control still has to let go of it). They are not the pane's, so nothing else takes them down,
  // and a driver who parked and drove again would stack another set on top of the last.
  (st.winOff || []).forEach((off) => removeEventListener('pointerup', off));
  st.wheel?.destroy?.();
  // The knob deregisters itself from the radio's repaint set; the radio's own state survives,
  // because a driver at the log rung still has a set even with no cab on screen.
  st.cbWidget?.dispose?.();
  disposeWindshield(st.id);
  st.container.innerHTML = '';
  st = null;
}
