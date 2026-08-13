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
  groundObstructionAt, MODEL_MAX_EXTENT, RENDER_TUNE, cabTrim } from './windshield.js';
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
  ['Wheel / ← →', 'Steer. Drag the wheel — that is the control. The arrows wind the same wheel on for a keyboard or a thumb, and it walks back to centre when you let go.'],
  ['A / THROTTLE', 'Throttle. Held. The engine takes a moment to come up on boost, and longer in a low gear.'],
  ['Z / BRAKE', 'Service brakes. They heat, and hot brakes fade.'],
  ['X / CLUTCH', 'Clutch. Held. Also how you restart a stalled engine.'],
  ['C / JAKE', 'Engine brake. Held. Free retardation on a descent — it does not heat the drums.'],
  ['. and ,', 'Shift up / down. Gear 0 is neutral.'],
  ['/', 'Splitter — half a gear.'],
  ['R', 'Reverse. Only from a standstill.'],
  ['H / centre boss', 'Air horn. The room hears it.'],
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
      <div class="cab-controls">
        <canvas class="cab-wheel" width="220" height="220" aria-label="Steering wheel — drag to steer, press the centre for the horn"></canvas>
        <div class="cab-gauges">
          <div class="cab-readout"><b class="cab-mph">0</b><span>MPH</span></div>
          <div class="cab-readout"><b class="cab-odo">0</b><span>TILES TO GO</span></div>
          <div class="cab-readout"><b class="cab-surface">ROAD</b><span>SURFACE</span></div>
          <div class="cab-readout cab-gearbox"><b class="cab-gear">N</b><span class="cab-gearhint">GEAR &middot; , .</span></div>
        </div>
        ${kit.tach ? '<div class="cab-tach" aria-hidden="true"><i class="cab-tach-band"></i><i class="cab-tach-needle"></i></div>' : ''}
        <div class="cab-readout cab-rig"><b class="cab-brakes">COLD</b><span class="cab-riginfo">BRAKES</span></div>
        <!-- EVERY CONTROL IS REACHABLE BY HAND, not just by key. The gearbox, the clutch and the
             Jake were keyboard-only, which on a tablet meant the whole of phase 1.5 was
             unreachable — you could drive, but you could not shift, so you were stuck in whatever
             gear you started in. These are ordinary buttons on pointer events, so mouse and touch
             are the same code path, and each one carries the key that also works. -->
        <div class="cab-box" role="group" aria-label="Gearbox">
          <button class="cab-btn cab-up" aria-label="Shift up" title="Shift up (.)">▲</button>
          <button class="cab-btn cab-down" aria-label="Shift down" title="Shift down (,)">▼</button>
          <button class="cab-btn cab-splitbtn" aria-label="Splitter" title="Splitter (/)">½</button>
          <button class="cab-btn cab-rev" aria-label="Reverse" title="Reverse (R) — only at a stop">R</button>
          <!-- THE STALK. One button cycling off → intermittent → low → high, rather than four
               controls, because that is how the stalk on the column works and because the cab has
               no room for a fourth row. The label IS the state: a control whose current setting you
               have to remember is a control you stop using. -->
          <button class="cab-btn cab-wipe" aria-label="Wipers" title="Wipers (V) — off / intermittent / low / high">⑊</button>
          <!-- THE HORN. Two trumpets on the roof of every rig in the fleet, and until now they were
               ornament. It is a VERB ('horn', plugins/trucking) rather than a local sound, because
               the whole point of a horn is that the room hears it and you are not the room. -->
          <button class="cab-btn cab-horn" aria-label="Air horn" title="Air horn (H)">📯</button>
        </div>
        <div class="cab-pedals">
          <button class="cab-pedal cab-throttle" aria-label="Throttle">THROTTLE</button>
          <button class="cab-pedal cab-brake" aria-label="Brake">BRAKE</button>
          <button class="cab-pedal cab-clutch" aria-label="Clutch">CLUTCH</button>
          <button class="cab-pedal cab-jake" aria-label="Jake brake">JAKE</button>
        </div>
        <div class="cab-steer" role="group" aria-label="Steering">
          <button class="cab-btn cab-left" aria-label="Steer left" title="Steer left (←)">◀</button>
          <button class="cab-btn cab-right" aria-label="Steer right" title="Steer right (→)">▶</button>
        </div>
        <!-- LOOKING OFF THE NOSE. The flight sim's Q/E/S, and deliberately the same three keys: a
             truck has exactly the same problem an aircraft does (you cannot see behind you) and a
             player who has flown already has the habit. HELD, not toggled, for the reason a
             shoulder-check is held — you look, you come back, and a view you can leave yourself
             stuck in at fifty miles an hour is a view that kills you. -->
        <div class="cab-look" role="group" aria-label="Look">
          <button class="cab-btn cab-lookl" aria-label="Look left" title="Look left — hold (Q)">↖</button>
          <button class="cab-btn cab-lookr" aria-label="Look right" title="Look right — hold (E)">↗</button>
          <button class="cab-btn cab-lookb" aria-label="Look behind" title="Look behind — hold (S)">↺</button>
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
  st.wheel = createHelmWheel(container.querySelector('.cab-wheel'), {
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
      el.textContent = ['⑊', 'INT', 'LO', 'HI'][st.wipers];
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
  }
  st.setExternal = setExternal;

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

// ── THE RIG, SEEN FROM BEHIND ────────────────────────────────────────────────
// The chase camera is the renderer's own (`external` + `hideOwnShip`), which means the world is
// correct for free and there is nothing here but the vehicle. It is drawn in 2D over the finished
// frame rather than as a world object, for the same reason the yacht is: the truck is not IN the
// world model, it is the thing the world is being rendered for, and putting it in the tile map
// would mean the collision probe could hit it.
//
// It is a rear three-quarter silhouette, and it articulates: the trailer swings by φ, the whole rig
// leans out of a turn on the yaw rate, and the wheels' track narrows as the box comes round. That
// is enough to reverse a trailer by, which is the entire reason to have this view at all.
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
  // Screen-centred, sat low — the camera is behind and above, so the rig lives in the bottom third.
  const cx = W / 2, cy = H * 0.74, S = Math.min(W, H) * 0.0016;
  const lean = Math.max(-0.09, Math.min(0.09, (r.slip || 0) * Math.sign(st.sim.yawRate || 0) * 0.5));
  const trim = tier === 3 ? '#e8c07a' : '#9fb4c8';

  // The trailer first — it is behind the tractor, so it is painted first and the cab overlaps it.
  if (r.hitched) {
    g.save();
    g.translate(cx, cy);
    // φ is the articulation angle in degrees. Positive means the box has swung to the driver's
    // right, so from behind it slides LEFT across the view and foreshortens.
    const phi = (r.phi || 0) * Math.PI / 180;
    g.translate(-Math.sin(phi) * 120 * S * 6, 0);
    g.transform(Math.cos(phi) * 0.85 + 0.15, 0, Math.sin(phi) * 0.55, 1, 0, 0);
    g.scale(1, 1);
    g.fillStyle = '#20262d';
    g.strokeStyle = Math.abs(r.phi) > 55 ? '#d2603f' : '#39424c';
    g.lineWidth = 1.5;
    const tw = 220 * S * 6, th = 150 * S * 6;
    g.beginPath(); g.rect(-tw / 2, -th, tw, th); g.fill(); g.stroke();
    // Doors, hinges, and the plate light — the three things you can see of a box at night.
    g.strokeStyle = '#2b333b';
    g.beginPath(); g.moveTo(0, -th); g.lineTo(0, 0); g.stroke();
    g.fillStyle = 'rgba(255,240,200,.5)';
    g.fillRect(-tw * 0.06, -th * 0.06, tw * 0.12, th * 0.03);
    g.restore();
  }

  // The tractor. Cab, roof fairing, mudflaps, and the two red lamps that tell you it is a vehicle
  // and not a shed — which at this size is most of the work the drawing has to do.
  g.save();
  g.translate(cx, cy);
  g.rotate(lean);
  const w = 170 * S * 6, h = 118 * S * 6;
  g.fillStyle = '#1b2026';
  g.strokeStyle = '#3b444f'; g.lineWidth = 1.6;
  g.beginPath(); g.rect(-w / 2, -h, w, h); g.fill(); g.stroke();
  // Roof fairing — the shape that reads as "truck" rather than "van" from directly behind.
  g.fillStyle = '#232a31';
  g.beginPath();
  g.moveTo(-w * 0.42, -h); g.lineTo(-w * 0.30, -h * 1.22);
  g.lineTo(w * 0.30, -h * 1.22); g.lineTo(w * 0.42, -h); g.closePath();
  g.fill(); g.stroke();
  // Marker lights along the fairing — five, as they are on a real cab roof.
  g.fillStyle = trim;
  for (let i = -2; i <= 2; i++) g.fillRect(i * w * 0.11 - w * 0.014, -h * 1.20, w * 0.028, h * 0.035);
  // Tail lamps, brighter under braking. The one honest instrument in this view.
  const braking = st.input.brake > 0;
  g.fillStyle = braking ? '#ff4b3a' : '#8e2a22';
  g.shadowColor = '#ff4b3a'; g.shadowBlur = braking ? 14 : 4;
  g.fillRect(-w * 0.46, -h * 0.42, w * 0.10, h * 0.20);
  g.fillRect(w * 0.36, -h * 0.42, w * 0.10, h * 0.20);
  g.shadowBlur = 0;
  // Reversing lamps, on the same principle.
  if (r.reversing) {
    g.fillStyle = '#e9f2ff'; g.shadowColor = '#e9f2ff'; g.shadowBlur = 12;
    g.fillRect(-w * 0.10, -h * 0.30, w * 0.20, h * 0.08);
    g.shadowBlur = 0;
  }
  // Tyres and mudflaps.
  g.fillStyle = '#0d1013';
  g.fillRect(-w * 0.54, -h * 0.30, w * 0.10, h * 0.30);
  g.fillRect(w * 0.44, -h * 0.30, w * 0.10, h * 0.30);
  g.restore();
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
    // The strip is absent entirely on tier 0 — there is no tachometer in that truck to strip.
    const tachN = q('.cab-tach-needle');
    if (tachN) {
      tachN.style.left = Math.min(100, r.rpm) + '%';
      q('.cab-tach').classList.toggle('over', r.rpm > P.band[1] * 100 + 4);
    }

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
      ...(st.external ? { external: true, hideOwnShip: true, extZoom: 1.15, extPitch: 0.42 } : {}),
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
     dash is all over the place". */
  .cab-controls{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;
    padding:8px 12px;background:linear-gradient(#15181c,#0b0d10);border-top:1px solid #2a2f36}
  /* \`touch-action:none\` is what makes the wheel STEERABLE on a touch screen rather than a thing
     you scroll the page with. The buttons already had it; the wheel — the one control you are
     meant to drag — did not. */
  /* THE WHEEL IS THE BIGGEST THING ON THE SHELF, because it is the control you
     use continuously and everything else is used in moments. At 112px it read as
     an ornament sitting next to the two arrow buttons that were doing the actual
     steering; at 148 it is the obvious thing to grab. */
  .cab-wheel{width:148px;height:148px;flex:0 0 auto;touch-action:none;cursor:grab}
  .cab-wheel:active{cursor:grabbing}
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
  .cab-pedals{display:flex;flex-direction:column;gap:6px;flex:0 0 auto}
  .cab-box,.cab-steer,.cab-look{display:flex;gap:5px;flex:0 0 auto;align-items:center}
  /* The look tag over the glass. It has to be loud: a driver whose pointer slipped off a
     shoulder-check needs to know instantly why the road is going sideways. */
  .ws-label-look{color:#0a0c0f !important;background:var(--cab-glow,#e8c07a);padding:1px 6px;border-radius:3px}
  .cab-btn{min-width:34px;min-height:34px;padding:6px 8px;font:600 13px/1 inherit;color:#c8d2de;
    background:#191d22;border:1px solid #333a43;border-radius:4px;cursor:pointer;touch-action:none;user-select:none}
  .cab-btn:active,.cab-btn.on{background:#2b3138;border-color:#5c6672;color:#fff}
  .cab-clutch.on{border-color:#8a7ac0}
  .cab-wipe{font-size:11px;letter-spacing:.06em}
  .cab-horn{font-size:13px}
  .cab-horn:active{border-color:#e0b45a;box-shadow:0 0 10px rgba(224,180,90,.45)}
  .cab-wipe.on{border-color:#4e7a9a}
  /* Rain on the glass and the stalk still off: the button asks once, rather than a line of prose
     in the log telling a driver about a key. It stops the moment they touch it. */
  .cab-wipe.hint{border-color:#6fa8d0;animation:cab-wipe-hint 1.1s ease-in-out infinite}
  @keyframes cab-wipe-hint{0%,100%{box-shadow:0 0 0 0 rgba(111,168,208,0)}50%{box-shadow:0 0 0 3px rgba(111,168,208,0.28)}}
  .cab-jake.on{border-color:#4e8a9a}
  .cab-pedal{padding:8px 16px;font:600 11px/1 inherit;letter-spacing:.12em;color:#c8d2de;
    background:#191d22;border:1px solid #333a43;border-radius:4px;cursor:pointer;touch-action:none;user-select:none}
  .cab-pedal.on{background:#2b3138;border-color:#5c6672;color:#fff}
  .cab-throttle.on{border-color:#4e9a5c}
  .cab-brake.on{border-color:#9a4e4e}
  .cab-gear{min-width:1.6em;text-align:center}
  .cab-brakes.b-hot{color:#d8a24e}
  .cab-brakes.b-fade{color:#d2603f}
  .cab-riginfo.b-fade{color:#d2603f}
  .cab-gear.g-band{color:#7fc98b}
  .cab-gear.g-stall{color:#d2603f}
  .cab-tach{position:relative;flex:0 0 96px;height:8px;border:1px solid #333a43;border-radius:3px;background:#12151a;overflow:hidden}
  .cab-tach.over{border-color:#9a4e4e}
  .cab-tach-band{position:absolute;left:42%;width:26%;top:0;bottom:0;background:#2f5c39}
  .cab-tach-needle{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:var(--cab-glow,#e8c07a)}
  /* ── THE FOUR CABS ────────────────────────────────────────────────────────
     Materials, and only materials. A tier changes what the shelf is MADE of and
     which instruments are bolted to it (CAB_KIT) — never a number the physics
     read, which all live in effTruckParams on the server. */
  .cab-t0 .cab-controls{background:linear-gradient(#23241d,#111209);border-top-color:#3a3a2c}  /* flaking olive steel */
  .cab-t0 .cab-btn,.cab-t0 .cab-pedal{background:#1e1f18;border-color:#3d3e30}
  .cab-t2 .cab-controls{background:linear-gradient(#182219,#0a100c);border-top-color:#2b3a30}  /* green vinyl */
  .cab-t2 .cab-btn,.cab-t2 .cab-pedal{background:#16201a;border-color:#2e4033}
  /* Walnut and brass, and a warm lamp over the bunk washing down onto the shelf. The Orlov is a
     bedroom; the pool of light is the single strongest thing that says so. */
  .cab-t3 .cab-controls{background:
      radial-gradient(140% 180% at 50% -60%,rgba(255,214,150,.16),transparent 60%),
      linear-gradient(#2c211a,#100b07);border-top-color:#5a4028}
  .cab-t3 .cab-btn,.cab-t3 .cab-pedal{background:#241a13;border-color:#5a4028;color:#e6d3b6}
  .cab-t3 .cab-readout span{color:#9c8a72}
  /* Touch: the controls get BIGGER on a small screen rather than smaller, because that is the one
     place they are the only way in — the wheel shrinks to make room for them, not the reverse. */
  @media (max-width:700px){
    .cab-wheel{width:112px;height:112px}.cab-readout b{font-size:17px}.cab-tach{display:none}
    .cab-controls{flex-wrap:wrap;gap:8px}
    .cab-btn{min-width:44px;min-height:44px;font-size:15px}
    .cab-pedal{padding:12px 14px}
    .cab-pedals{flex-direction:row;flex-wrap:wrap}
  }
  @media (pointer:coarse){ .cab-btn{min-width:44px;min-height:44px} .cab-pedal{padding:12px 16px} }

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
  // Each pedal and steer button parked a release on the window (a pointerup that lands outside the
  // control still has to let go of it). They are not the pane's, so nothing else takes them down,
  // and a driver who parked and drove again would stack another set on top of the last.
  (st.winOff || []).forEach((off) => removeEventListener('pointerup', off));
  st.wheel?.destroy?.();
  disposeWindshield(st.id);
  st.container.innerHTML = '';
  st = null;
}
