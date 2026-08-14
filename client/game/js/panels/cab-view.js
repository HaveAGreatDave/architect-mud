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
  groundObstructionAt, MODEL_MAX_EXTENT, RENDER_TUNE, cabTrim, cabWheelHub } from './windshield.js';
import { TYPES, createTruckState, truckReadout, step, truckShift, truckSplit } from './flight-model.js';
import { updateEngineAudio, stopEngineAudio } from './engine-audio.js';
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
let P = TYPES.hauler;
const setParams = (ctx) => { P = (ctx && ctx.params) || TYPES[ctx && ctx.typeId] || TYPES.hauler; };

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
  ['Drag the wheel', 'Steer. The wheel is the one on the dash in front of you — put a hand anywhere on the glass and drag, and it winds on. It walks back to centre when you let go. In the chase view the same drag orbits the camera instead, and the scroll wheel dollies it.'],
  ['← →', 'Steer, for a keyboard or a thumb. The same wheel, wound on at the pace a wrist manages.'],
  ['Centre boss', 'The horn. Press the middle of the wheel.'],
  ['Lever', 'The gear lever. Throw it up or down and it shifts on the throw, then springs back — keep pulling to keep shifting.'],
  ['A / THROTTLE', 'Throttle. Held. The engine takes a moment to come up on boost, and longer in a low gear.'],
  ['Z / BRAKE', 'Service brakes. They heat, and hot brakes fade.'],
  ['X / CLUTCH', 'Clutch. Held. Also how you restart a stalled engine.'],
  ['C / JAKE', 'Engine brake. Held. Free retardation on a descent — it does not heat the drums.'],
  ['. and ,', 'Shift up / down. Gear 0 is neutral.'],
  ['/', 'Splitter — half a gear.'],
  ['R', 'Reverse. Only from a standstill.'],
  ['H', 'Air horn. The room hears it.'],
  ['V', 'Wipers: off, intermittent, low, high.'],
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
const EXT_REST_PITCH = 0.42;

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
        <button class="cab-cbtn cab-fsbtn" title="fullscreen">⛶</button>
        <button class="cab-cbtn cab-hidebtn" title="hide the text panel — more road">⊟</button>
        <button class="cab-cbtn cab-helpbtn" title="controls (?)">?</button>
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
          <div class="cab-steer" role="group" aria-label="Steering">
            <button class="cab-btn cab-left" aria-label="Steer left" title="Steer left (←)">◀</button>
            <button class="cab-btn cab-right" aria-label="Steer right" title="Steer right (→)">▶</button>
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
             A shift lever in a slotted plate, and you throw it: drag the knob up or down and it
             changes gear on the throw, then springs back to the middle the way a real range lever
             does. The two ▲▼ buttons are still there, small, beside the gate — a lever you can
             only reach by dragging is a lever a keyboard user does not have, and the whole reason
             those buttons were added in the first place was that this cab had become key-only. -->
        <div class="cab-col cab-col-gate">
          <div class="cab-gate" role="group" aria-label="Gear lever">
            <i class="cab-gate-slot"></i>
            <div class="cab-lever" title="Throw the lever up or down to shift — or use , and ."><b class="cab-knob"></b></div>
          </div>
          <div class="cab-box" role="group" aria-label="Gearbox">
            <button class="cab-btn cab-up" aria-label="Shift up" title="Shift up (.)">▲</button>
            <button class="cab-btn cab-down" aria-label="Shift down" title="Shift down (,)">▼</button>
            <button class="cab-btn cab-splitbtn" aria-label="Splitter" title="Splitter (/)">½</button>
            <button class="cab-btn cab-rev" aria-label="Reverse" title="Reverse (R) — only at a stop">R</button>
          </div>
        </div>

        <!-- ── THE SWITCH PANEL ────────────────────────────────────────────────
             The things that are switches on a real dash are switches here: a rocker rocks, a lamp
             above it lights, and the label is the state. Every one of them is still an ordinary
             <button> underneath, so tab, Space and a screen reader are unchanged. -->
        <div class="cab-col cab-col-switch">
          <div class="cab-rockers" role="group" aria-label="Dash switches">
            <!-- THE JAKE is a rocker rather than a pedal, because that is what it is in the cab:
                 a switch on the dash you flick on for a descent. It is still HELD (see hold()). -->
            <button class="cab-btn cab-rocker cab-jake" aria-label="Jake brake" title="Engine brake (C) — held"><i></i><span>JAKE</span></button>
            <!-- THE STALK. One control cycling off → intermittent → low → high, because that is
                 how the stalk on the column works. The label IS the state. -->
            <button class="cab-btn cab-rocker cab-wipe" aria-label="Wipers" title="Wipers (V) — off / intermittent / low / high"><i></i><span>WIPE</span></button>
            <!-- THE HORN. A VERB ('horn', plugins/trucking) rather than a local sound, because the
                 whole point of a horn is that the room hears it and you are not the room. -->
            <button class="cab-btn cab-rocker cab-horn" aria-label="Air horn" title="Air horn (H)"><i></i><span>HORN</span></button>
          </div>
          <!-- LOOKING OFF THE NOSE. The flight sim's Q/E/S, and deliberately the same three keys: a
               truck has exactly the same problem an aircraft does (you cannot see behind you) and a
               player who has flown already has the habit. HELD, not toggled, for the reason a
               shoulder-check is held — you look, you come back. -->
          <div class="cab-look" role="group" aria-label="Look">
            <button class="cab-btn cab-lookl" aria-label="Look left" title="Look left — hold (Q)">↖</button>
            <button class="cab-btn cab-lookr" aria-label="Look right" title="Look right — hold (E)">↗</button>
            <button class="cab-btn cab-lookb" aria-label="Look behind" title="Look behind — hold (S)">↺</button>
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
  const hold = (sel, key) => {
    const el = container.querySelector(sel);
    const on = (e) => { st.input[key] = 1; el.classList.add('on'); e.preventDefault(); };
    const off = () => { if (!st) return; st.input[key] = 0; el.classList.remove('on'); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('keydown', (e) => { if (isPress(e) && !e.repeat) on(e); });
    el.addEventListener('keyup', (e) => { if (isPress(e)) off(); });
    el.addEventListener('blur', off);                 // tabbed away mid-press — nothing else releases it
    addEventListener('pointerup', off);
    winOff.push(off);
  };
  hold('.cab-throttle', 'throttle');
  hold('.cab-brake', 'brake');
  hold('.cab-clutch', 'clutch');
  hold('.cab-jake', 'jake');

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
      const cv = document.getElementById(st.id);
      if (!st.external && cv) {
        const b = cv.getBoundingClientRect();
        const hub = cabWheelHub(b.width, b.height);
        if (Math.hypot(e.clientX - b.left - hub.x, e.clientY - b.top - hub.y) < hub.r) {
          sendCmdSilent('horn'); e.preventDefault(); return;
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
      if (st.external) {
        // Turntable, in the renderer's own units. The pitch bound is short of the poles for the
        // reason cockpit.js's is: a near-vertical orbit stretches the model into a spindle.
        st.extYaw = (st.extYaw + dx * 0.30 + 360) % 360;
        st.extPitch = Math.max(0.06, Math.min(1.12, st.extPitch - dy * 0.006));
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
      st.extZoom = Math.max(0.4, Math.min(2.2, st.extZoom * (e.deltaY > 0 ? 1.1 : 0.9)));
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
  grabKeys();

  // ── THE LEVER ──────────────────────────────────────────────────────────────
  // Throw it and it shifts, then springs back to the gate's middle — a range lever's whole
  // behaviour, and the reason it is a throw rather than a position is that the box has eighteen
  // ratios and nobody is going to drag a knob to the fourteenth of them. One throw, one gear; keep
  // pulling and it keeps shifting, at the pace a wrist manages.
  {
    const lever = container.querySelector('.cab-lever');
    const THROW = 22;                                 // px of travel that counts as a gate change
    let ly = null, acc = 0;
    lever.addEventListener('pointerdown', (e) => {
      ly = e.clientY; acc = 0; lever.setPointerCapture?.(e.pointerId);
      lever.classList.add('on'); e.preventDefault();
    });
    lever.addEventListener('pointermove', (e) => {
      if (ly == null || !st) return;
      acc += e.clientY - ly; ly = e.clientY;
      while (acc <= -THROW) { truckShift(st.sim, P, 1); acc += THROW; }    // pull back / up = up a gear
      while (acc >= THROW) { truckShift(st.sim, P, -1); acc -= THROW; }
      lever.style.setProperty('--throw', Math.max(-1, Math.min(1, acc / THROW)).toFixed(2));
    });
    const drop = () => { ly = null; acc = 0; lever.classList.remove('on'); lever.style.setProperty('--throw', '0'); };
    lever.addEventListener('pointerup', drop);
    lever.addEventListener('pointercancel', drop);
    addEventListener('pointerup', drop);
    winOff.push(drop);
  }

  // The gearbox, by hand. `tap` is a click/touch that fires ONCE per press — a shift is an edge,
  // unlike a pedal, and a button that auto-repeated would walk the box to neutral if you rested a
  // thumb on it.
  const tap = (sel, fn) => {
    const el = container.querySelector(sel);
    el.addEventListener('click', (e) => { fn(); e.preventDefault(); });
  };
  tap('.cab-up', () => truckShift(st.sim, P, 1));
  tap('.cab-down', () => truckShift(st.sim, P, -1));
  tap('.cab-splitbtn', () => truckSplit(st.sim, P));
  tap('.cab-rev', () => toggleReverse());
  tap('.cab-wipe', () => cycleWipers());
  tap('.cab-horn', () => sendCmdSilent('horn'));

  st.onKey = (e) => {
    if (/^(INPUT|TEXTAREA)$/.test(e.target?.tagName) || e.target?.isContentEditable) return;
    const k = e.key.toLowerCase();
    const down = e.type === 'keydown';
    if (k === 'a') st.input.throttle = down ? 1 : 0;
    else if (k === 'z') st.input.brake = down ? 1 : 0;
    // The clutch and the Jake are HELD, like the pedals they are. The shifts are EDGES, and
    // `e.repeat` is filtered — holding the comma must not walk the box down to neutral.
    else if (k === 'x') st.input.clutch = down ? 1 : 0;
    else if (k === 'c') st.input.jake = down ? 1 : 0;
    else if (down && !e.repeat && (k === ',' || k === '.')) truckShift(st.sim, P, k === '.' ? 1 : -1);
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
  function toggleReverse() {
    if (Math.abs(st.sim.speed) >= 2) return;
    truckShift(st.sim, P, st.sim.gear < 0 ? 2 : -(st.sim.gear + 1));
  }

  // Wipers, off → intermittent → low → high → off. Purely a client-side control: the blade is
  // drawn on the glass and clears the drops that are drawn on the glass, and neither of those
  // things is a fact about the world, so nothing is told to the server about it.
  function cycleWipers() {
    st.wipers = ((st.wipers | 0) + 1) % 4;
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
  // new camera, it is the existing one turned on with `hideOwnShip`, plus a rig drawn over it
  // (drawRig, below). There is no truck in the world model to render, and there should not be: the
  // truck is not a world object, it is you.
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
  st.node = ctx.node ?? st.node; st.nodes = ctx.nodes ?? st.nodes;
  if (ctx.surface) st.input.surface = ctx.surface;
  if (ctx.contacts) st.contacts = ctx.contacts;
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
// The chase camera is the renderer's own (`external` + `hideOwnShip`), which means the world is
// correct for free and there is nothing here but the vehicle. It is drawn in 2D over the finished
// frame rather than as a world object, for the same reason the yacht is: the truck is not IN the
// world model, it is the thing the world is being rendered for, and putting it in the tile map
// would mean the collision probe could hit it.
//
// IT IS A BOX MODEL NOW, NOT A SILHOUETTE, and it had to become one the moment the camera could
// orbit. A flat rear-view drawing is correct from exactly one angle and is a cardboard cutout from
// every other, so walking round the rig would have shown you the back of it the whole way round.
// Eight corners, one yaw, one pitch, a weak perspective — about forty lines, and it is the only
// thing in the cab that knows what shape a truck is.
//
// THE SCALE WAS ALSO WRONG, and wrong by a factor of about five: `S = min(W,H) * 0.0016` was then
// multiplied by 6 and by a 170-unit body, which put the tractor at 1.6× the smaller screen
// dimension — a wall of dark grey with two tail lamps on it, filling the view. Everything here is
// in METRES now and projected, so the rig is the size a rig is and a longer trailer looks longer
// instead of looking closer.
const RIG_M = {
  // Tractor and box, in metres: half-width, length, height. A day cab is about 2.5 across.
  cab: { hw: 1.25, len: 6.2, h: 3.6 },
  box: { hw: 1.30, len: 13.6, h: 4.0 },
};

function drawRig(st, r) {
  const cv = document.getElementById(st.id);
  if (!cv || !cv.getContext || !cv.clientWidth) return;
  const g = cv.getContext('2d');
  const tier = st.tier ?? 1;
  // The renderer scales its backing store dynamically under load (see paintWindshield), so the
  // device ratio is NOT a constant here — it is derived from the canvas we were actually given, or
  // the rig drifts off the middle of the road the moment the frame rate dips.
  const k = cv.width / cv.clientWidth;
  const W = cv.clientWidth, H = cv.clientHeight;
  g.save();
  g.setTransform(k, 0, 0, k, 0, 0);

  // THE CAMERA IS THE RENDERER'S, RESTATED. It is not read from it — the renderer keeps its pose in
  // its own local units inside paintWindshield — so this mirrors the three numbers we handed it
  // (extYaw + its resting chaseYaw, extPitch, extZoom) and nothing else. They move together
  // because they are the same three variables, which is the only coupling that survives a refactor.
  const az = ((st.extYaw || 0) + 12) * Math.PI / 180;      // 12° is RENDER_TUNE.chaseYaw's 3/4 rest
  const pitch = Math.max(0.05, Math.min(1.12, st.extPitch ?? 0.42));
  // NOTE THE DIRECTION. `extZoom` is the renderer's camera DISTANCE, not a magnification — bigger
  // means further back — so the rig's pixel scale is its reciprocal, and the 1.15 is the same
  // resting stand-off the paintWindshield call passes. Get this the wrong way round and the truck
  // grows as you dolly away from it, which is the sort of wrong that looks like a physics bug.
  const zoom = 1.15 * Math.max(0.4, Math.min(2.2, st.extZoom || 1));
  // Metres → pixels. Solved off the smaller screen dimension so the rig holds its share of the
  // frame in a panel and in fullscreen alike; the constant is chosen so a bobtail sits at roughly a
  // third of the height, which is where a chase camera puts a vehicle.
  const S = Math.min(W, H) * 0.060 / zoom;
  const cx = W / 2, cy = H * (0.56 + 0.12 * Math.sin(pitch));
  const ca = Math.cos(az), sa = Math.sin(az), cp = Math.cos(pitch), sp = Math.sin(pitch);

  // Rig space: +x right of the driver, +y FORWARD, +z up, origin at the fifth wheel on the ground.
  // Rotate by the camera azimuth, then flatten: forward-depth foreshortens by cos(pitch) and height
  // lifts by sin — a plain axonometric, which at this size reads exactly as a perspective one does
  // and cannot degenerate when the camera swings over the top.
  const proj = (x, y, z) => {
    const rx = x * ca - y * sa, ry = x * sa + y * ca;
    return [cx + rx * S, cy - (z * sp * S) + ry * cp * S * 0.55];
  };
  // Depth key for the painter's algorithm — how far a face's centre is from the camera, in the
  // rotated frame. Faces are sorted on it and drawn back to front, which is the whole of what makes
  // a box look solid from any angle rather than inside-out from half of them.
  const depth = (pts) => {
    let d = 0;
    for (const p of pts) d += p[0] * sa + p[1] * ca;
    return d / pts.length;
  };

  // One box: eight corners, six faces, each shaded by which way it points so the thing has a lit
  // side and a dark side without a light source being modelled anywhere.
  function box(ox, oy, yaw, m, body, top, trimLine) {
    const cy2 = Math.cos(yaw), sy2 = Math.sin(yaw);
    const local = (lx, ly, lz) => {
      const x = ox + lx * cy2 - ly * sy2, y = oy + lx * sy2 + ly * cy2;
      return [x, y, lz];
    };
    const c = [
      local(-m.hw, 0, 0), local(m.hw, 0, 0), local(m.hw, m.len, 0), local(-m.hw, m.len, 0),
      local(-m.hw, 0, m.h), local(m.hw, 0, m.h), local(m.hw, m.len, m.h), local(-m.hw, m.len, m.h),
    ];
    const faces = [
      { i: [0, 1, 2, 3], f: '#0a0d10' },                      // underside
      { i: [4, 5, 6, 7], f: top },                            // roof
      { i: [0, 1, 5, 4], f: body[0] },                        // rear
      { i: [3, 2, 6, 7], f: body[0] },                        // front
      { i: [0, 3, 7, 4], f: body[1] },                        // left flank
      { i: [1, 2, 6, 5], f: body[2] },                        // right flank
    ];
    const drawn = faces.map((fc) => ({ ...fc, pts: fc.i.map((n) => c[n]), d: depth(fc.i.map((n) => c[n])) }));
    drawn.sort((a, b) => b.d - a.d);
    for (const fc of drawn) {
      g.beginPath();
      fc.pts.forEach((p, n) => { const q = proj(p[0], p[1], p[2]); n ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); });
      g.closePath();
      g.fillStyle = fc.f; g.fill();
      g.strokeStyle = 'rgba(120,140,165,0.20)'; g.lineWidth = 1; g.stroke();
    }
    // A single bright line along the top of the near flank — the one highlight that makes painted
    // steel read as painted steel rather than as a filled polygon.
    if (trimLine) {
      const a = proj(...c[4]), b = proj(...c[7]);
      g.strokeStyle = trimLine; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    }
    return c;
  }

  // A lamp in rig space, drawn as a glowing disc. Skipped when it has swung behind the body, which
  // the depth term answers for free.
  const lamp = (x, y, z, col, rad, on) => {
    const d = x * sa + y * ca;
    if (d > 0.2) return;                                       // facing away from the camera
    const p = proj(x, y, z);
    const rr = rad * S;
    const gr = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], rr * (on ? 4.5 : 1.8));
    gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(p[0], p[1], rr * (on ? 4.5 : 1.8), 0, 7); g.fill();
    g.fillStyle = col; g.beginPath(); g.arc(p[0], p[1], rr, 0, 7); g.fill();
  };
  // A wheel: a short dark cylinder seen as a rounded slab. Four of them on the drive axle, two on
  // the steer, and the trailer's bogie — enough that the rig sits ON the road rather than over it.
  const wheel = (x, y, rad) => {
    const p0 = proj(x, y, rad), p1 = proj(x, y, 0);
    g.strokeStyle = '#0b0e11'; g.lineWidth = Math.max(2.5, rad * S * 1.6); g.lineCap = 'round';
    g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.stroke();
  };

  // THE GROUND SHADOW FIRST, and it is what sells the whole thing: without it the rig floats an
  // inch above a road that is being rendered correctly underneath it. One flattened ellipse per
  // body, at z=0, so it lies in the road plane and swings round with the camera like everything else.
  const shadow = (ox, oy, yaw, m) => {
    g.save();
    const c0 = proj(ox - Math.cos(yaw) * m.hw, oy - Math.sin(yaw) * m.hw, 0);
    const c1 = proj(ox + Math.sin(yaw) * m.len, oy + Math.cos(yaw) * m.len, 0);
    g.globalAlpha = 0.42; g.fillStyle = '#000';
    g.beginPath();
    g.ellipse((c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2,
      Math.abs(c1[0] - c0[0]) / 2 + m.hw * S, Math.max(3, m.hw * S * 0.7), 0, 0, 7);
    g.fill();
    g.restore();
  };

  const trailer = !!r.hitched;
  const phi = (r.phi || 0) * Math.PI / 180;
  // The tractor sits with its fifth wheel at the origin; the box hangs off it at the articulation
  // angle, running BACKWARDS from the coupling — which is why its length is negated through the
  // yaw rather than given a negative extent.
  const boxYaw = Math.PI + phi;
  const trim = tier === 3 ? '#e8c07a' : tier === 2 ? '#7fc98b' : tier === 0 ? '#c08a3e' : '#9fb4c8';
  const skin = tier === 3 ? ['#2a2018', '#3a2c20', '#221a13']
    : tier === 2 ? ['#16211a', '#1e2d24', '#111a15']
      : tier === 0 ? ['#22231b', '#2d2e23', '#191a13']
        : ['#1b2026', '#252c34', '#151a1f'];

  if (trailer) shadow(0, 0, boxYaw, RIG_M.box);
  shadow(0, -1.4, 0, RIG_M.cab);

  // Painter's order between the two bodies: whichever is further from the camera goes down first.
  const bodies = [
    { d: Math.sin(boxYaw) * 0 + Math.cos(az) * -RIG_M.box.len * 0.5, draw: () => {
      if (!trailer) return;
      box(0, 0, boxYaw, RIG_M.box, ['#20262d', '#272f37', '#1a2027'], '#2c343d',
        Math.abs(r.phi) > 55 ? '#d2603f' : 'rgba(170,190,215,0.35)');
      // Bogie, right at the back of the box, and the plate lamp above it.
      for (const s of [-1, 1]) for (const a of [11.2, 12.6]) {
        wheel(Math.sin(boxYaw) * a + Math.cos(boxYaw) * s * RIG_M.box.hw,
          Math.cos(boxYaw) * a - Math.sin(boxYaw) * s * RIG_M.box.hw, 0.55);
      }
      const bx = Math.sin(boxYaw) * RIG_M.box.len, by = Math.cos(boxYaw) * RIG_M.box.len;
      lamp(bx, by, 1.2, 'rgba(255,240,200,0.7)', 0.10, false);
    } },
    { d: Math.cos(az) * RIG_M.cab.len * 0.5, draw: () => {
      const c = box(0, -1.4, 0, RIG_M.cab, skin, tier === 3 ? '#3a2c20' : '#252c34', trim);
      // Marker lights across the roof — five of them, as they are on a real cab.
      for (let i = -2; i <= 2; i++) lamp(i * 0.5, -1.35, RIG_M.cab.h, 'rgba(255,205,131,0.9)', 0.055, false);
      // Tail lamps, brighter under braking. The one honest instrument in this view.
      const braking = st.input.brake > 0;
      for (const s of [-1, 1]) lamp(s * (RIG_M.cab.hw - 0.18), -1.4, 1.0,
        braking ? 'rgba(255,75,58,0.95)' : 'rgba(142,42,34,0.9)', 0.11, braking);
      if (r.reversing) lamp(0, -1.4, 1.0, 'rgba(233,242,255,0.95)', 0.10, true);
      // Steer axle forward, drive axles under the fifth wheel.
      for (const s of [-1, 1]) {
        wheel(s * RIG_M.cab.hw, 3.4, 0.62);
        wheel(s * RIG_M.cab.hw, 0.3, 0.62);
        wheel(s * RIG_M.cab.hw, -0.9, 0.62);
      }
      // Headlamp spill on the road ahead, so a night chase shot has the rig lighting its own way.
      if ((st.hour ?? 12) < 7 || (st.hour ?? 12) >= 19) {
        for (const s of [-1, 1]) lamp(s * (RIG_M.cab.hw - 0.25), RIG_M.cab.len - 1.4, 1.1, 'rgba(255,246,214,0.85)', 0.12, true);
      }
      return c;
    } },
  ];
  bodies.sort((a, b) => b.d - a.d).forEach((b) => b.draw());

  // JACKKNIFING, said on the picture. This view is where you would see it happening, so this is
  // where it is called — the DOM readout says the same thing in words for the record.
  if (trailer && r.folding) {
    g.fillStyle = '#d2603f';
    g.font = `700 ${Math.max(10, Math.min(W, H) * 0.028) | 0}px 'DejaVu Sans Mono',monospace`;
    g.textAlign = 'center';
    g.fillText('JACKKNIFING', cx, H * 0.16);
  }
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
      updateEngineAudio({
        continuous: true, class: 'truck', engineOn: !st.dry, airborne: false, onGround: true,
        rpm: Math.max(0, st.sim.rpm - (st.rpmDip || 0)), throttle: r.pedal * 100, spd: r.speed,
        groundSpeed: r.speed, surface: st.input.surface || 'road',
        cabin: !st.external, weather: st.weather,
      });
    }

    // Hand the world to the flight sim's renderer. `height: 0` is the ground camera; the map
    // window came from the server and was derived by the same mapWindow a cockpit uses.
    // THE EXTERNAL VIEW IS THE SAME CALL. `external` + `hideOwnShip` is the exact pair the Helm
    // chase view passes (helm-view.js) — a real camera behind and above, with the renderer's own
    // aircraft model suppressed because there is no aircraft. What sits at screen centre is
    // drawRig, painted over the finished frame below. `tier` is still passed and does not need
    // gating — drawCabInterior is already `!ext` inside the renderer, so the painted cab suppresses
    // itself the moment the camera leaves it.
    paintWindshield(st.id, {
      cls: 'truck', phase: 'ground', worldBlend: 1,
      // The orbit is the player's now, not two constants — drag on the glass, wheel to dolly, ⟲ to
      // put it back down the road. drawRig mirrors these three exactly (see its camera note).
      ...(st.external ? { external: true, hideOwnShip: true, extYaw: st.extYaw, extPitch: st.extPitch, extZoom: 1.15 * st.extZoom } : {}),
      // Shoulder-checks are suppressed in the chase camera, which is already showing you what they
      // are for — and yawing a third-person view off the vehicle it is following is just lost.
      viewYaw: st.external ? 0 : (st.viewYaw || 0),
      height: 0, speed: r.speed / 68,
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
      fuel: st.dry ? 0 : (st.fuel ?? 1),
      legFrac: st.L ? Math.max(0, Math.min(1, st.s / st.L)) : 0,
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
      contacts: st.contacts || [],
      map: st.map, mapCenter: { x: st.mapX, y: st.mapY },
      mapOffset: { x: st.sim.x - st.mapX, y: st.sim.y - st.mapY },
      acX: st.sim.x, acY: st.sim.y,
    });
    // Over the finished frame, never inside it — see drawRig.
    if (st.external) { st.tier = P.tier; drawRig(st, r); }

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
  /* THE SHELF IS CONTROLS ONLY NOW, so it is centred rather than spread — the instruments went up
     onto the painted dash where a dash is, and what is left is the things your hands do. */
  .cab-controls{justify-content:center}
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
     A slotted plate with a lever in it. \`--throw\` is written by the drag handler as −1..1 and is
     the ONLY thing that moves the knob, so the lever's position and the shift it caused can never
     disagree — there is no second copy of where the lever is. */
  .cab-gate{position:relative;width:44px;height:58px;border-radius:5px;
    background:linear-gradient(#191d22,#0c0f13);border:1px solid #333a43;overflow:hidden}
  .cab-gate-slot{position:absolute;left:50%;top:8px;bottom:8px;width:7px;margin-left:-3.5px;
    border-radius:4px;background:#05070a;box-shadow:inset 0 0 6px #000}
  .cab-lever{position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;
    cursor:ns-resize;touch-action:none;
    transform:translateY(calc(var(--throw,0) * -14px));transition:transform .12s ease-out}
  .cab-lever.on{transition:none}
  .cab-lever b.cab-knob{display:block;width:100%;height:100%;border-radius:50%;
    background:radial-gradient(circle at 34% 30%,#4a535e,#191d22 70%,#0b0e12);
    border:1px solid #4b5763;box-shadow:0 3px 7px -3px #000, inset 0 1px 0 rgba(255,255,255,.18)}
  .cab-lever.on b.cab-knob{border-color:var(--cab-glow,#e8c07a);box-shadow:0 0 10px rgba(232,192,122,.35)}
  .cab-box,.cab-steer,.cab-look{display:flex;gap:5px;flex:0 0 auto;align-items:center}
  .cab-box{flex-wrap:wrap;max-width:96px;justify-content:center}
  .cab-col-gate{align-items:center}

  /* ── THE ROCKERS ───────────────────────────────────────────────────────────
     A switch that rocks, with a tell-tale above it. Still a <button>: the whole of the change is
     what it looks like and where the 'on' class lands. */
  .cab-rockers{display:flex;gap:5px}
  .cab-rocker{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:42px;
    padding:4px 5px 5px;background:linear-gradient(#20252b,#12161a);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
  .cab-rocker i{display:block;width:7px;height:7px;border-radius:50%;background:#252b32;
    box-shadow:inset 0 0 3px #000}
  .cab-rocker span{font:700 8px/1 inherit;letter-spacing:.08em;color:#8b95a2}
  .cab-rocker.on{background:linear-gradient(#12161a,#20252b)}   /* it rocks the other way */
  .cab-rocker.on i{background:var(--cab-glow,#e8c07a);box-shadow:0 0 8px var(--cab-glow,#e8c07a)}
  .cab-rocker.on span{color:#fff}
  .cab-jake.on i{background:#4e9ab0;box-shadow:0 0 8px #4e9ab0}
  .cab-horn:active i{background:#e0b45a;box-shadow:0 0 10px #e0b45a}

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
  .cab-btn{min-width:34px;min-height:34px;padding:6px 8px;font:600 13px/1 inherit;color:#c8d2de;
    background:#191d22;border:1px solid #333a43;border-radius:4px;cursor:pointer;touch-action:none;user-select:none}
  .cab-btn:active,.cab-btn.on{background:#2b3138;border-color:#5c6672;color:#fff}
  .cab-horn:active{border-color:#e0b45a;box-shadow:0 0 10px rgba(224,180,90,.45)}
  .cab-wipe.on{border-color:#4e7a9a}
  /* Rain on the glass and the stalk still off: the button asks once, rather than a line of prose
     in the log telling a driver about a key. It stops the moment they touch it. */
  .cab-wipe.hint{border-color:#6fa8d0;animation:cab-wipe-hint 1.1s ease-in-out infinite}
  @keyframes cab-wipe-hint{0%,100%{box-shadow:0 0 0 0 rgba(111,168,208,0)}50%{box-shadow:0 0 0 3px rgba(111,168,208,0.28)}}
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
  .cab-t0 .cab-controls{background:linear-gradient(#23241d,#111209);border-top-color:#3a3a2c}  /* flaking olive steel */
  .cab-t0 .cab-btn,.cab-t0 .cab-gate{background:#1e1f18;border-color:#3d3e30}
  .cab-t0 .cab-pedal{border-color:#3d3e30}
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
  }
  @media (pointer:coarse){ .cab-btn{min-width:44px;min-height:44px} .cab-pedal{min-width:46px} }

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
  body.cab-fullscreen #sidebar,body.cab-fullscreen #output,body.cab-fullscreen #input-row{display:none}
  body.cab-fullscreen #area-pane{position:fixed;inset:0;z-index:60;max-width:none;width:100vw;height:100vh}
  body.cab-hidepanel #output{display:none}
  body.cab-hidepanel #area-pane{flex:1 1 auto}
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
