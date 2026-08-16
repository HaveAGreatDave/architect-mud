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
import { TYPES, createTruckState, truckReadout, step, truckShift, truckSplit, truckSelectGear } from './flight-model.js';
import { updateEngineAudio, stopEngineAudio, damageCue, damageBed, stopDamageBed } from './engine-audio.js';
// The cab draws the weather through its own windscreen, so the pane's outdoor overlay has to
// stand down while it owns the pane — the same hard override the cockpit takes on embark.
import { suppressWeatherFx } from './weather-fx.js';
import { createHelmWheel } from './helm-wheel.js';
import { sendCmdSilent } from '../net.js';

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
  ['← →', 'Steer, for a keyboard or a thumb. The same wheel, wound on at the pace a wrist manages.'],
  ['Centre boss', 'The horn. Press the middle of the wheel.'],
  ['GPS screen', 'Tap it. The map is the road you are actually on; tapping opens the fork, with the distance and whether your tank reaches. Picking one runs the ordinary route command, so it obeys the same rules typing it would.'],
  ['Lever', 'The gear lever, in an H-gate. Drag the knob into a slot — or just click the slot. The knob sits in whatever gear you are actually in.'],
  ['LO / HI', 'Range. The box is a four-by-two: the same four slots are gears 1-4 in LO and 5-8 in HI, and changing range in gear takes four ratios with it.'],
  ['A / THROTTLE', 'Throttle. Held. The engine takes a moment to come up on boost, and longer in a low gear.'],
  ['Z or SPACE', 'Service brakes. They heat, and hot brakes fade.'],
  ['X / CLUTCH', 'Clutch. Held. Also how you restart a stalled engine.'],
  ['C / JAKE', 'Engine brake. Held. Free retardation on a descent — it does not heat the drums.'],
  ['↑ ↓', 'Shift up / down, on the same cluster the wheel is on: ← → steers, ↑ ↓ works the box.'],
  ['. and ,', 'Shift up / down, the other way round. Gear 0 is neutral.'],
  ['G / CRUISE', 'Cruise control. Locks the speed you are doing — the brake, the clutch or dropping out of gear cancels it. It works the throttle and nothing else, so a hill still beats you in the wrong gear.'],
  ['/', 'Splitter — half a gear.'],
  ['R', 'Reverse. Only from a standstill.'],
  ['H', 'Air horn. The room hears it.'],
  ['V / the stalk', 'Wipers. The stalk is on the column beside the wheel and it wears its own setting — off, intermittent, low, high.'],
  ['Q / E / S', 'Look left, right, and over your shoulder. Held — you look, then you come back. There is no dash behind the side glass, so the view out of it is clear.'],
  // The look keys are the flight sim's Q/E/S exactly, and that parity is worth more than either of
  // the two obvious letters for the chase camera — hence F. See the key handler.
  ['F', 'External view — a chase camera behind the rig. The cab is where the instruments are; this is where the trailer is.'],
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
  suppressWeatherFx(true);
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
                 There was no stick. There was a knob that slid around a plate, which is a plan view
                 of a gearbox rather than a gear lever — and it is the reason the control read as a
                 diagram: nothing about it was a foot of steel coming up out of the floor. This is
                 the shaft, drawn from a pivot BELOW the plate (the boot, at the bottom of the
                 gate) up to the knob, so pulling the lever through the gate leans it toward you
                 and away from you and you can see the throw. It is one element and the geometry is
                 solved where the knob position is already solved ('put'), so there is no second
                 idea of where the lever is. Purely decorative — it is not a hit target, the knob
                 and the slots are. -->
            <i class="cab-boot" aria-hidden="true"></i>
            <i class="cab-shaft" aria-hidden="true"><s></s></i>
            <div class="cab-lever" title="Throw the lever into a slot, or press one. The collar doubles the four slots into eight gears."><b class="cab-knob"><s></s></b></div>
          </div>
          <!-- THE KNOB COLLARS. On a real range-change box both of these live ON the shift knob
               under your thumb, never as a position you put the lever in — so they are two small
               switches beside the gate rather than two more keys in a row of keys. -->
          <div class="cab-collars" role="group" aria-label="Gearbox collars">
            <button class="cab-btn cab-range" aria-label="Range" title="Range collar — LO is gears 1-4, HI is 5-8"><i class="cab-rangeic">${svgIcon('range')}</i><b>LO</b><em>RANGE</em></button>
            <button class="cab-btn cab-splitbtn" aria-label="Splitter" title="Splitter collar (/) — half a gear"><b>${svgIcon('split')}</b><em>SPLIT</em></button>
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
            title="Wiper stalk (V) — off / intermittent / low / high">
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
            <!-- THE JAKE is a rocker rather than a pedal, because that is what it is in the cab:
                 a switch on the dash you flick on for a descent. It is still HELD (see hold()). -->
            <button class="cab-btn cab-rocker cab-jake" aria-label="Jake brake" title="Jacobs engine brake (C) — held. Holds you back on a descent so the service brakes stay cold."><i></i><u><span>JAKE</span></u></button>

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
                 which re-checks distance, angle and speed for itself. -->
            <button class="cab-btn cab-rocker cab-hitchbtn" hidden aria-label="Hitch trailer" title="Back under the trailer and couple (hitch)"><i></i><u><span>HITCH</span></u></button>

            <button class="cab-btn cab-rocker cab-cruise" aria-pressed="false" aria-label="Cruise control" title="Cruise control (G) — locks the speed you are doing. The brake, the clutch or dropping out of gear cancels it."><i></i><u><span>CRUISE</span></u></button>
          </div>
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
    lock: 1.6, selfCentre: 2.6, keyRate: 2.6,
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
  // Cruise is a LATCH, so it is a plain click rather than a hold() — the one switch on this panel
  // that stays where you put it.
  container.querySelector('.cab-cruise')?.addEventListener('click', () => toggleCruise());
  // Hitching is a real verb with real rules; the button is a shortcut to typing it, which is why it
  // sends the command rather than reaching into the rig. Unhitching goes through the same button
  // once you are coupled, because "the thing behind me" is one question with two answers.
  container.querySelector('.cab-hitchbtn')?.addEventListener('click', () => {
    sendCmdSilent(st.sim?.hitched ? 'unhitch' : 'hitch');
  });

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
          sendCmdSilent('horn'); e.preventDefault(); return;
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
        st.wheel?.wind(dx / Math.max(240, glass.clientWidth) * 5.4);
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
    const shaft = container.querySelector('.cab-shaft');
    // WHERE THE LEVER IS ROOTED. Below the plate and on the left rail's line — the floor of the cab
    // is off the bottom of this box, and a stick that pivoted at the middle of the gate would lean
    // the wrong way in the top half. In gate fractions, so it moves with the plate at every size.
    const PIVOT_X = 0.38, PIVOT_Y = 1.34;
    const put = (x, y) => {
      lever.style.setProperty('--gx', x.toFixed(3));
      lever.style.setProperty('--gy', y.toFixed(3));
      // The shaft is solved here, from the same two numbers, and never stored: length and lean
      // between the pivot and the knob. A separate source for either would be a lever whose stick
      // and knob eventually disagree about which gear you are in.
      if (!shaft) return;
      const dx = x - PIVOT_X, dy = PIVOT_Y - y;
      const len = Math.hypot(dx, dy * 0.72);          // dy squashed: the plate is a raked view, not a plan
      shaft.style.setProperty('--plen', (len * 100).toFixed(2) + '%');
      shaft.style.setProperty('--pang', (Math.atan2(dx, dy * 0.72) * 180 / Math.PI).toFixed(2) + 'deg');
    };
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
      put(s ? s.x : 0.38, s ? s.y : 0.50);
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
    lever.addEventListener('pointerdown', (e) => {
      drag = { id: e.pointerId };
      lever.setPointerCapture?.(e.pointerId);
      lever.classList.add('on');
      e.preventDefault(); e.stopPropagation();
    });
    const move = (e) => {
      if (!drag || !st) return;
      const b = gate.getBoundingClientRect();
      if (!b.width) return;
      const px = Math.max(0, Math.min(1, (e.clientX - b.left) / b.width));
      const py = Math.max(0, Math.min(1, (e.clientY - b.top) / b.height));
      put(px, py);
      const s = snap(px, py);
      gate.dataset.aim = s ? String(gearLabelOf(gearOfSlot(s))) : '';
    };
    const drop = (e) => {
      if (!drag || !st) { drag = null; return; }
      const b = gate.getBoundingClientRect();
      const px = b.width ? Math.max(0, Math.min(1, ((e?.clientX ?? 0) - b.left) / b.width)) : 0.38;
      const py = b.height ? Math.max(0, Math.min(1, ((e?.clientY ?? 0) - b.top) / b.height)) : 0.50;
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
      st.range = !st.range;
      const rl = rangeBtn.querySelector('b'); if (rl) rl.textContent = st.range ? 'HI' : 'LO';
      rangeBtn.classList.toggle('on', st.range);
      const cur = slotOfGear(st.sim.gear);
      if (st.sim.gear > 0 && cur && cur.slot) selectGear(cur.slot + (st.range ? 4 : 0));
      st.paintGate?.();
      e.preventDefault();
    });
    winOff.push(() => { drag = null; });
  }
  // ONE DOOR for every way of choosing a gear, so the reverse rule is written once. The H-gate, the
  // R button and the R key all arrive here.
  function selectGear(g) {
    if (g < 0) { toggleReverse(); return; }
    if (st.sim.gear < 0 && Math.abs(st.sim.speed) >= 2) return;   // rolling backwards: not yet
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
  tap('.cab-splitbtn', () => truckSplit(st.sim, P));
  tap('.cab-wipe', () => cycleWipers());
  tap('.cab-horn', () => sendCmdSilent('horn'));

  st.onKey = (e) => {
    if (/^(INPUT|TEXTAREA)$/.test(e.target?.tagName) || e.target?.isContentEditable) return;
    const k = e.key.toLowerCase();
    const down = e.type === 'keydown';
    if (k === 'a') st.input.throttle = down ? 1 : 0;
    // Z is the flight sim's throttle-DOWN key and the brake here, which is the same gesture in a
    // vehicle with no reverse thrust. SPACE is an alias for it because it is the key every hand
    // reaches for to stop a moving thing, and a truck has no guns for it to conflict with (the
    // flight sim's Space is the trigger). Its default is a page scroll, so it must be eaten.
    else if (k === 'z' || k === ' ') st.input.brake = down ? 1 : 0;
    // The clutch and the Jake are HELD, like the pedals they are. The shifts are EDGES, and
    // `e.repeat` is filtered — holding the comma must not walk the box down to neutral.
    else if (k === 'x') { st.input.clutch = down ? 1 : 0; st.heldBy = st.heldBy || {}; st.heldBy.clutch = down ? 1 : 0; }
    else if (k === 'c') st.input.jake = down ? 1 : 0;
    // SHIFTING WITHOUT HUNTING FOR THE PUNCTUATION KEYS. `,` and `.` stay — they are what the dash
    // has always hinted and what any existing muscle memory has — but they are two of the worst
    // keys on the board to find with a hand that is also holding A and Z, and shifting is the thing
    // this gearbox asks you to do most. So ↑/↓ shift up and down, which puts the whole gearbox on
    // the arrow cluster the other hand is already steering with: ← → is the wheel, ↑ ↓ is the box.
    // ⚠ NOT W/S, tempting as the WASD read is: S is look-behind and it is the flight sim's key,
    // and that parity is worth more than any convenience this could buy.
    else if (down && !e.repeat && (k === ',' || k === '.' || k === 'arrowup' || k === 'arrowdown')) {
      truckShift(st.sim, P, (k === '.' || k === 'arrowup') ? 1 : -1);
      // AUTO-CLUTCH ON A SEQUENTIAL SHIFT. Holding X with one hand while finding the next ratio
      // with the other is the real thing and it is also two keys for one act — so a shift from a
      // KEY dips the clutch for you. The gate is deliberately left alone: putting the lever in a
      // slot by hand is the manual control, and the pedal is part of it.
      st.autoClutch = performance.now() + 320;
    }
    // Cruise. Not a held control and not on a pedal key: it is the switch that means "stop holding
    // the pedal", so it gets its own press.
    else if (down && !e.repeat && k === 'g') toggleCruise();
    else if (down && !e.repeat && k === '/') truckSplit(st.sim, P);
    // REVERSE is its own key rather than "shift down past first", because walking a driver through
    // neutral into reverse by accident at twenty miles an hour is not a skill test, it is a bug
    // report. It only takes at a stop, which is where a real box lets you have it too.
    else if (down && !e.repeat && k === 'r') toggleReverse();
    else if (down && !e.repeat && k === 'v') cycleWipers();
    // F, not E and not V. E is the flight sim's look-right and that parity is worth more than this
    // key is; V is the wiper stalk, which is the control a driver grabs in a hurry.
    else if (down && !e.repeat && k === 'f') st.setExternal?.(!st.external);
    // Shift+/ arrives as '?', so the splitter's own '/' branch above never sees it.
    else if (down && !e.repeat && k === '?') st.toggleHelp?.();
    else if (down && !e.repeat && k === 'd') container.querySelector('.cab-dmg-strip')?.click();
    else if (down && k === 'escape' && !container.querySelector('.cab-help')?.hidden) st.toggleHelp?.(false);
    // Held would be a stuck horn and a round trip per frame; one pull per press, `e.repeat` filtered.
    else if (down && !e.repeat && k === 'h') sendCmdSilent('horn');
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
    else if (k === 'arrowleft' || k === 'arrowright') {
      const dir = k === 'arrowleft' ? -1 : 1;
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
  // Toggling it ON takes the speed you are DOING, which is the only number a driver ever means by
  // it — there is no set-point to dial, because dialling one is a menu and this is a truck.
  function toggleCruise() {
    if (st.cruise != null) return setCruise(null);
    if (st.sim.gear > 0 && st.sim.speed >= 8 && !st.dry && !st.broken) setCruise(st.sim.speed);
  }


  function toggleReverse() {
    if (Math.abs(st.sim.speed) >= 2) return;
    truckShift(st.sim, P, st.sim.gear < 0 ? 2 : -(st.sim.gear + 1));
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

  // THE ROLLER DOOR. Only when you turned the key inside a shed — see below.
  if (ctx.fromBay) rollUp(container);

  st.raf = requestAnimationFrame(frame);
  return st;
}

// ── OUT THROUGH THE ROLLER DOOR ──────────────────────────────────────────────
//
// A haul starts inside a building. The truck cannot: a bay is a building, buildings are solid and
// carry no grid coordinates, and a rig has to stand on a tile with a surface under it — so the
// server puts you on the apron a door away and always has (see cmdDrive). What was missing was the
// door itself, and without it the run did not begin, it was simply already happening: one moment a
// shop window, the next moment a road.
//
// So THE SHED IS DRAWN IN THE CAB, NOT IN THE WORLD. It is four gradients and a slatted panel over
// the glass — the real windscreen is live underneath it the entire time, already painting the yard
// — and the panel goes up. That is the whole trick, and it is why this costs the world model
// nothing: no interior tile, no second camera, no geometry to collide with, nothing to keep in
// sync. What you see through the widening gap is the actual road you are about to drive on.
//
// The throttle is dead until the door is clear. Not because anything would stop you — there is no
// door in the physics, there is no door anywhere but here — but because a driver who pulls away
// through a closed door has been told the picture is a lie, and every frame after that is cheaper
// for it. Two seconds of idle, which is roughly how long the real thing takes.
const DOOR_LIFT_MS = 2400;      // the panel's own travel, matching the CSS
const DOOR_HOLD_MS = 2150;      // throttle released a shade before it is fully home — you creep out under it
const DOOR_GONE_MS = 3300;      // overlay removed; the walls have faded off the glass by now

function rollUp(container) {
  const wrap = container.querySelector('.ws-wrap');
  if (!wrap) return;
  // A player who has turned motion off has turned THIS off — it is two and a half seconds of a
  // large object moving across the whole of their view, which is the exact thing that setting is
  // for. They get the road, immediately, and the log still tells them the door went up.
  if (document.documentElement.getAttribute('data-motion') === 'off'
      || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
  wrap.insertAdjacentHTML('beforeend', `
    <div class="cab-shed" aria-hidden="true">
      <div class="cab-shed-spill"></div>
      <div class="cab-shed-wall l"></div>
      <div class="cab-shed-wall r"></div>
      <div class="cab-shed-ceil"><i></i></div>
      <div class="cab-shed-dust"></div>
      <div class="cab-shed-door"><span class="cab-shed-seal"></span></div>
    </div>`);
  st.doorUntil = performance.now() + DOOR_HOLD_MS;
  // The rig shakes on its springs while it sits there with the handbrake on and nothing to do.
  container.querySelector('.cab-wrap')?.classList.add('cab-idling');

  // The voice of it: a long metal scrape for the travel, and a clatter when it hits the top stop.
  // Built locally rather than pushed from the server — nobody else in the yard needs to hear your
  // door, and a cue that only one person can hear has no business on the wire.
  const A = window.AudioEngine, S = window.ProceduralSFX;
  const cue = (o, gain) => { try { const d = S?.buildActionCue(o); if (d) A?.playSfx(d, gain); } catch { /* audio is never load-bearing */ } };
  cue({ action: 'scrape', surface: 'metal', intensity: 0.85, seed: 4471 }, 0.5);
  st.doorT1 = setTimeout(() => cue({ action: 'scrape', surface: 'metal', intensity: 0.7, seed: 991 }, 0.4), 780);
  st.doorT2 = setTimeout(() => cue({ action: 'impact', surface: 'metal', intensity: 0.6, seed: 233 }, 0.55), DOOR_LIFT_MS - 120);
  st.doorT3 = setTimeout(() => {
    if (!st) return;
    st.container?.querySelector('.cab-shed')?.remove();
    st.container?.querySelector('.cab-wrap')?.classList.remove('cab-idling');
  }, DOOR_GONE_MS);
}

// Nothing here may outlive the cab: a timer holding a removed node is harmless, but one that fires
// a sound into a player who has already parked is not.
function clearRollUp() {
  if (!st) return;
  clearTimeout(st.doorT1); clearTimeout(st.doorT2); clearTimeout(st.doorT3);
  st.doorUntil = 0;
}

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
  // Out of diesel: the server says so and the pedal stops meaning anything. It clamps the speed
  // its own side too — this is the feel, not the enforcement.
  if (ctx.dry != null) st.dry = !!ctx.dry;
  // The tank has been in this payload since phase 1 (state.js packs `fuel`) and the cab has never
  // read it — a driver got a boolean at the moment they ran out and nothing at all before it. The
  // gauge is the warning; running dry with a needle on the peg is the driver's fault, which is the
  // only version of that event worth having.
  if (ctx.fuel != null) st.fuel = Math.max(0, Math.min(1, ctx.fuel));
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
  const w = el.querySelector('u span');
  if (w) w.textContent = coupled ? 'DROP' : 'HITCH';
  el.classList.toggle('on', !coupled);
  el.setAttribute('title', coupled
    ? 'Drop the trailer here (unhitch)'
    : `Couple to ${target?.name || 'the trailer'} (hitch)`);
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
    // Still under the door. The pedal does nothing and the brake is on — see rollUp. The engine is
    // deliberately NOT silenced the way a dry tank silences it: it is running, you are just not
    // going anywhere yet, and the idle is half of what makes the wait feel like a truck.
    // The throttle and the wheel only. The BRAKE is deliberately not forced on: it is the
    // player's own held control, and stomping it here would release a pedal they are holding the
    // moment the door cleared. Nothing is pushing the truck at zero mph anyway.
    if (st.doorUntil && now < st.doorUntil) { st.input.throttle = 0; st.input.steer = 0; }
    else if (st.doorUntil) st.doorUntil = 0;
    // The auto-clutch dip a keyboard shift asked for. It writes the same `clutch` input the pedal
    // does — one clutch, not a second mechanism — so the engine, the launch window and the stall
    // rule all see exactly what they would see if a hand had done it.
    if (st.autoClutch) {
      if (now < st.autoClutch) st.input.clutch = 1;
      // ⚠ Handing it back to the FOOT, not to zero: `heldBy` is what the pedal and the X key
      // actually have down right now, so a driver who was already holding the clutch when a shift
      // dipped it does not have it dropped out from under them when the dip expires.
      else { st.autoClutch = 0; st.input.clutch = st.heldBy?.clutch ? 1 : 0; }
    }
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
        || st.sim.gear <= 0 || Math.abs(st.sim.speed) < 8) st.setCruise?.(null);
      else {
        // Proportional, and gentle: a truck's mass means a hard correction reads as surging.
        st.input.throttle = Math.max(0, Math.min(1, (st.cruise - st.sim.speed) * 0.18));
      }
    }
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
    const gearEl = q('.cab-gear');
    gearEl.textContent = r.stalled ? '—' : r.reversing ? 'R' : (r.gear === 0 ? 'N' : r.gear + (st.sim.split ? '½' : ''));
    gearEl.className = 'cab-gear' + (r.stalled ? ' g-stall' : r.inBand ? ' g-band' : '');
    // `BEST` is the shift indicator, and it is a fleet privilege — see CAB_KIT. In a Barrow or a
    // Courier the hint reverts to the keys, which is all a cheap dash has ever told anybody.
    const kit = kitFor(P);
    q('.cab-gearhint').textContent = r.stalled ? 'STALLED · CLUTCH X'
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
      updateEngineAudio({
        continuous: true, class: 'truck', engineOn: !st.dry, airborne: false, onGround: true,
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
      variant: TYPE_ID + (r.hitched ? '+t' : ''),
      livery: PAINT || undefined,
      // The orbit is the player's now, not two constants — drag on the glass, wheel to dolly, ⟲ to
      // put it back down the road.
      ...(st.external ? { external: true, extYaw: st.extYaw, extPitch: st.extPitch, extZoom: 1.15 * st.extZoom } : {}),
      // Shoulder-checks are suppressed in the chase camera, which is already showing you what they
      // are for — and yawing a third-person view off the vehicle it is following is just lost.
      viewYaw: st.external ? 0 : (st.viewYaw || 0),
      // ⚠ TWO SPEEDS, AND THEY ARE NOT THE SAME NUMBER. `speed` is NORMALISED (0..1 of a nominal
      // 68 mph) because that is what the world renderer wants — it drives motion blur, road rush,
      // wind noise, none of which are in mph. `mph` is the real figure, and it exists because the
      // speedometer was reading the normalised one: at sixty miles an hour the dial printed "1".
      height: 0, speed: r.speed / 68, mph: r.speed,
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
      sendCmdSilent(`trucksync ${st.s.toFixed(2)} 0 ${Math.round(st.sim.heading)} ${Math.round(st.sim.speed)} ${st.sim.x.toFixed(3)} ${st.sim.y.toFixed(3)}`);
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
    border:1px solid #333a43;overflow:hidden;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.10), inset 0 -6px 12px rgba(0,0,0,.55);
    touch-action:none;cursor:pointer}
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
  .cab-lever{position:absolute;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;
    cursor:grab;touch-action:none;
    transform:translate(calc(var(--gx,.38) * var(--gw,104px)),calc(var(--gy,.5) * var(--gh,62px)));
    transition:transform .14s cubic-bezier(.2,.8,.3,1)}
  /* No easing while a hand is on it: a knob that lags the finger is a knob that feels broken. */
  .cab-lever.on{transition:none;cursor:grabbing;z-index:2}
  /* In a gear the gate's own range does not offer — you shifted into 6 with a key while the lever
     was in the LO half. The plate says so rather than the knob lying about where it is. */
  .cab-gate-off .cab-gate-marks{color:rgba(216,162,78,.75)}
  /* ── THE STICK, THE BOOT AND THE KNOB ───────────────────────────────────────
     A gear lever is three things and the old control had one of them. The SHAFT is a polished
     column with a highlight down one side and a shadow down the other, which is the whole reason a
     cylinder reads as a cylinder; it leans as you pull it through the gate ('put' solves the
     angle), so the throw is visible instead of implied. The BOOT is the rubber gaiter it comes out
     of — the piece that says the lever goes THROUGH the floor rather than sitting on the plate, and
     it is drawn with concentric folds because that is the only thing a gaiter looks like. The KNOB
     is a turned ball with a real specular hit and a contact shadow under it.
     ⚠ Draw order is boot → shaft → knob and it matters: the shaft has to emerge from inside the
     gaiter, and the knob has to sit on top of the shaft's end cap. */
  .cab-boot{position:absolute;left:38%;bottom:-13%;width:34%;height:30%;margin-left:-17%;
    border-radius:44% 44% 30% 30%;pointer-events:none;z-index:1;
    background:
      repeating-linear-gradient(#000 0 2px,rgba(255,255,255,.055) 2px 4px),
      radial-gradient(120% 90% at 50% 12%,#2b3038,#14171c 60%,#080a0d);
    box-shadow:0 -2px 8px rgba(0,0,0,.8), inset 0 3px 6px rgba(255,255,255,.06)}
  .cab-shaft{position:absolute;left:38%;top:0;width:9px;margin-left:-4.5px;
    height:var(--plen,60%);pointer-events:none;z-index:1;
    transform:translateY(calc(134% - var(--plen,60%))) rotate(var(--pang,0deg));
    transform-origin:50% 100%;
    transition:transform .14s cubic-bezier(.2,.8,.3,1), height .14s cubic-bezier(.2,.8,.3,1)}
  .cab-lever.on ~ .cab-shaft,.cab-gate .cab-lever.on + .cab-shaft{transition:none}
  .cab-shaft s{display:block;position:relative;width:100%;height:100%;border-radius:4px 4px 2px 2px;
    background:linear-gradient(90deg,#0a0d11 0%,#454e59 30%,#9aa7b6 46%,#5b6673 62%,#0d1116 100%);
    box-shadow:0 2px 6px -2px #000}
  /* A collar where the shaft meets the knob — the machined joint, and the thing that stops the
     stick reading as a stripe that happens to end at a circle. */
  .cab-shaft s::after{content:'';position:absolute;left:-2px;right:-2px;top:2px;height:5px;
    border-radius:2px;background:linear-gradient(90deg,#161a20,#8e9aa8,#20262d)}
  .cab-lever b.cab-knob{display:block;width:100%;height:100%;border-radius:50%;position:relative;
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
  .cab-col-gate{align-items:center}

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
  .cab-rev{--key:#d2603f}
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
  body.cab-fullscreen .cab-controls{position:absolute;left:0;right:0;bottom:0;z-index:4;
    border-top:none;padding-top:26px;
    background:linear-gradient(to top,rgba(6,8,11,.94) 0%,rgba(6,8,11,.86) 55%,rgba(6,8,11,0) 100%);
    backdrop-filter:blur(2px)}
  body.cab-fullscreen .cab-controls::before{opacity:0}
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

  /* ── THE SHED, AND THE DOOR GOING UP ──────────────────────────────────────
     Everything here sits INSIDE .ws-wrap, over a windscreen that is already
     painting the yard. Nothing is a screenshot and nothing is faked: the gap
     under the lifting door is the live render, which is why the light spilling
     in matches the weather and the time of day without being told either. */
  .cab-shed{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:3;
    animation:shed-clear .8s ease 2.5s forwards}
  /* Walls and ceiling converge toward the mouth — a cheap one-point perspective, and enough of
     one at this size. The player is looking down the length of a bay, not at a room. */
  .cab-shed-wall{position:absolute;top:0;bottom:0;width:34%;
    background:linear-gradient(90deg,#0a0c0f,#191d22 62%,#23282f)}
  .cab-shed-wall.l{left:0;clip-path:polygon(0 0,100% 20%,100% 84%,0 100%)}
  .cab-shed-wall.r{right:0;transform:scaleX(-1);clip-path:polygon(0 0,100% 20%,100% 84%,0 100%)}
  .cab-shed-ceil{position:absolute;left:0;right:0;top:0;height:24%;background:linear-gradient(#0c0e12,#15181d);
    clip-path:polygon(0 0,100% 0,68% 100%,32% 100%)}
  /* The strip light. One tube, buzzing, slightly the wrong colour — the light every
     workshop in the Basin is lit by. */
  .cab-shed-ceil i{position:absolute;left:38%;right:38%;top:26%;height:5px;border-radius:3px;
    background:#cfe6ff;box-shadow:0 0 26px 9px rgba(150,200,255,.30);animation:shed-buzz 2.6s steps(1) infinite}
  /* Daylight coming under the door and then flooding the bay. Anchored at the bottom because
     that is where the gap is; it grows with the door rather than on its own clock. */
  .cab-shed-spill{position:absolute;left:-10%;right:-10%;bottom:0;height:70%;
    background:radial-gradient(120% 100% at 50% 100%,rgba(255,240,205,.55),rgba(255,235,195,.16) 45%,transparent 72%);
    opacity:.25;animation:shed-spill 2.4s ease-out .3s forwards;mix-blend-mode:screen}
  .cab-shed-dust{position:absolute;inset:0;opacity:.5;animation:shed-drift 9s linear infinite;
    background:
      radial-gradient(1.5px 1.5px at 22% 62%,rgba(255,240,210,.55),transparent),
      radial-gradient(1.5px 1.5px at 63% 38%,rgba(255,240,210,.42),transparent),
      radial-gradient(2px 2px at 44% 76%,rgba(255,240,210,.35),transparent),
      radial-gradient(1.5px 1.5px at 78% 66%,rgba(255,240,210,.45),transparent),
      radial-gradient(1.5px 1.5px at 34% 30%,rgba(255,240,210,.30),transparent)}
  /* The door itself: corrugated steel, lit from below by the gap it is opening. The slats are a
     repeating gradient rather than elements, so a hundred of them cost one paint. */
  .cab-shed-door{position:absolute;inset:0;
    background:
      linear-gradient(180deg,rgba(0,0,0,.55),rgba(0,0,0,0) 26%,rgba(255,238,205,.10) 96%),
      repeating-linear-gradient(180deg,#2b3038 0,#343a44 5px,#22262d 10px,#1b1f25 11px),
      #22262d;
    box-shadow:inset 0 -22px 40px -18px rgba(255,236,200,.55);
    animation:shed-lift 2.4s cubic-bezier(.42,.02,.24,1) .35s forwards}
  /* The rubber seal at the bottom, and the bar of daylight it is holding down. */
  .cab-shed-seal{position:absolute;left:0;right:0;bottom:0;height:9px;background:#0e1013;
    box-shadow:0 5px 16px 4px rgba(255,236,200,.55),0 2px 0 0 rgba(255,244,215,.85)}
  @keyframes shed-lift{
    0%{transform:translateY(0)}
    6%{transform:translate(-1px,1%)}      /* it takes up the slack before it takes up anything else */
    12%{transform:translate(1px,0)}
    40%{transform:translate(-1px,-34%)}
    70%{transform:translate(1px,-72%)}
    100%{transform:translateY(-104%)}
  }
  @keyframes shed-spill{0%{opacity:.25}100%{opacity:1}}
  @keyframes shed-clear{to{opacity:0}}
  @keyframes shed-buzz{0%,88%,100%{opacity:1}90%{opacity:.45}92%{opacity:1}94%{opacity:.6}}
  @keyframes shed-drift{from{transform:translate3d(0,0,0)}to{transform:translate3d(-6%,-9%,0)}}
  /* Sitting there with the box in neutral and forty tonnes idling under you. Tiny on purpose:
     it should read at the edge of the glass, not be something anybody has to look at. */
  .cab-idling .ws-wrap{animation:cab-idle-shake 260ms ease-in-out infinite}
  @keyframes cab-idle-shake{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(.6px,-.6px,0)}}
  @media (prefers-reduced-motion:reduce){
    .cab-idling .ws-wrap,.cab-shed-dust,.cab-shed-ceil i{animation:none}
  }
  `;
  document.head.appendChild(s);
}

export function closeCab() {
  if (!st) return;
  clearRollUp();
  // The immersive layouts are the PAGE's, not the pane's — nothing else takes them down, and a
  // driver who parked in fullscreen would be left with no log and no command box.
  document.body.classList.remove('cab-fullscreen', 'cab-hidepanel');
  suppressWeatherFx(false);
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
  disposeWindshield(st.id);
  st.container.innerHTML = '';
  st = null;
}
