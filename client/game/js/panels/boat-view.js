// THE HELM OF A RACE BOAT — the seat you drive the Basin from.
//
// The water seat, and it is the CAB's shape rather than the Echelon's. Those are two different
// kinds of boat and the difference is not size: `helm-view.js` sets a COURSE — you wind a wheel to
// a rhumb, ring a bell and she makes way — because that is what a sixty-metre yacht is. This is
// `stepBoat` in flight-model.js integrated at the frame rate with the server reconciling it four
// times a second, which is what `cab-view.js` does with a truck, because a blown picklefork is a
// thing you HOLD rather than a thing you point.
//
// What it deliberately does not borrow from the cab is the gearbox and the painted dash. A blown
// boat has one drive and no ratios, so the whole longitudinal decision is the lever; and the
// instruments here are GEOMETRY, built by `interior-shell.js` and standing on the dash in the
// depth buffer, so there is no `paintCabDash` equivalent and no second board to keep in step.
//
// ── ⚠ THE ROOM AROUND YOU IS NOT DRAWN HERE ──────────────────────────────────
//
// `pushInteriorShell` builds the pilothouse — sole, headlining, tumbled walls with the teardrop
// cut in them, the bulkhead and its door, the screen pillars, the dash and the gauge pod — from
// `client/shared/boat-house.js`, which is the SAME file `buildBoat` lofts the outside from. So
// this panel hands the renderer a class and a set of live values and gets the inside of the hull
// somebody standing on the pontoon can see. Nothing in here authors a cabin, and nothing in here
// may: the moment it does there are two descriptions of one room again, which is the state that
// file's header is a record of.
//
// ── ⚠ THE CLIENT REPORTS WHERE IT IS, NOT HOW FAR IT HAS COME ────────────────
//
// `boatsync` carries position, heading and speed and the server derives everything else from them
// against its own water. That is the trucking rule quoted, and it holds harder here: there is no
// corridor on the Basin, so a self-reported distance would be a number nobody could check at all.

import { paintWindshield, windshieldHTML, ensureWindshieldStyles, disposeWindshield, normalizeWx } from './windshield.js';
import { stepBoat, TYPES, CRANK_S } from './flight-model.js';
import { createHelmWheel } from './helm-wheel.js';
import { startBoatEngine, updateBoatEngine, stopBoatEngine, updateBoatContacts, stopBoatContacts } from './boat-audio.js';
import { claimSeatKeyboard, endSeatKeyboard } from './seat-keys.js';
import { bindBigScreenButton, exitBigScreen, BIGSCREEN_GLYPH, BIGSCREEN_TITLE } from './bigscreen.js';
import { HELM } from '../../../shared/boat-house.js';
import { EYE_M } from '../../../shared/interior-shell.js';

const ID = 'boat-sim';
const RAD = 16;                     // map window half-width, in tiles
const SYNC_MS = 250;                // four a second, the cab's own cadence
// ⚠ THE SAME TWO LIMITS THE CAB USES, and they are shared for a reason rather than copied: a
// player who has learned how far they can turn their head in a truck has learned it for every
// seat, and a seat that allows more is one where the painted world runs out.
const LOOK_YAW = 135, LOOK_PITCH = 55;

let st = null;

// ⚠ THE PANEL DOES NOT IMPORT THE SOCKET, and that is the arrangement `helm_open` already uses
// rather than a testing convenience: dispatch.js hands the seat its callbacks, so the one thing
// this file needs from the network is a function. It also happens to be the only reason the seat
// can be MOUNTED headlessly at all — `net.js` imports '/shared/ws.js', a browser-absolute path
// that does not resolve in node, so a panel that reaches for it is a panel no gate can open.
const send = (cmd) => { try { st?.onSend?.(cmd); } catch { /* the pane can outlive the socket */ } };

// ── HOW THE LEVER MOVES ──────────────────────────────────────────────────────
//
// ⚠ A THROTTLE IS A LEVER, NOT A BUTTON, and that is most of what makes this boat feel like a
// boat. Held down, W runs the lever up over about a second and a half; released, it falls back
// faster than it rose. `stepBoat` then spools the BLOWER off the lever on its own asymmetry, so
// there are two lags in series between your finger and the thrust — which is exactly what the
// throttle of a supercharged engine is.
const LEVER_UP = 0.70, LEVER_DOWN = 1.30;
// ⚠ THE TABS ARE HELD, NOT TOGGLED, because that is what the control on a real boat is: a rocker
// under your thumb that runs the rams while you hold it and leaves them where you let go. A
// three-position switch would make trim a mode you select rather than a thing you are constantly
// working, and working it IS the skill — see the note in `stepBoat`.
const TRIM_RATE = 0.55;

function readInput(dt) {
  const k = st.keys;
  // ⚠ THE DRAG WINS WHILE IT IS HELD, AND THE KEY IS SKIPPED RATHER THAN BLENDED. A hand on the
  // lever and a finger on W are two people driving; the one that would lose is the hand, because
  // the key integrates every frame and the drag only writes when the pointer moves — so a player
  // dragging the lever down against a held W would watch it climb out from under them.
  if (!st.leverHeld) {
    const wantT = (k.has('w') || k.has('arrowup')) ? 1 : 0;
    const rate = wantT ? LEVER_UP : -LEVER_DOWN;
    st.lever = Math.max(0, Math.min(1, st.lever + rate * dt));
  }
  // ⚠ THERE IS NO REVERSE, AND THE KEY FOR IT HAS BEEN REMOVED RATHER THAN LEFT LOOKING LIKE ONE.
  // This read S into an `astern` lever and handed it to `stepBoat`, which does not read the field
  // at all — the model clamps speed at zero and has no astern term anywhere in it. So the key did
  // nothing, the comment beside it said it was "a separate, much smaller lever", and the only way
  // to find out was to press it and watch carefully. A control that does nothing is worse than a
  // missing one: it tells you the boat is broken rather than that the feature is absent.

  // The tabs. ⚠ THEY DO NOT RECENTRE — every other control here springs back and this one must not,
  // or you would be holding a button for the whole of every straight.
  if (k.has(']')) st.trim = Math.min(1, st.trim + TRIM_RATE * dt);
  if (k.has('[')) st.trim = Math.max(-1, st.trim - TRIM_RATE * dt);

  // ⚠ THE KEYS TURN THE WHEEL RATHER THAN THE BOAT. `setHeld` is the widget's own keyboard input,
  // so the wheel a keyboard driver turns is the one on the screen — and `st.steer` has exactly one
  // writer, which is the wheel's `onSteer`. Integrating the keys here as well would be a second
  // owner of the axle, and the one that lost would do so silently.
  let want = 0;
  if (k.has('a') || k.has('arrowleft')) want -= 1;
  if (k.has('d') || k.has('arrowright')) want += 1;
  st.wheel?.setHeld?.(want);

  return {
    throttle: st.lever,
    steer: st.steer,
    trim: st.trim,
    // ⚠ A NEUTRAL START SWITCH, AND IT IS A REAL MECHANISM RATHER THAN A GUARD AGAINST THE PLAYER.
    // Every outboard and every inboard ever built refuses to crank out of neutral, for the obvious
    // reason — and here the obvious reason is exactly the failure it prevents: the lever is a
    // spring-loaded HUD control that holds where you leave it, so somebody who wound it open while
    // she was dead and then hit the key would have the boat leave the pontoon at full chat. The
    // model has no opinion about it; this is the boat's own switch.
    starter: st.starter && st.lever < 0.05,
    // The model refuses to fire a dry motor and needs telling, because it holds no row — the hull's
    // own arrangement one function down.
    fuel: st.fuel,
    nitro: k.has('shift'),
    surface: st.surface,
    aground: st.aground,
    now: performance.now(),
  };
}

// ── THE MAP WINDOW ───────────────────────────────────────────────────────────
//
// The server streams real tiles once, centred on the berth, and the boat moves INSIDE that window
// until it recentres. ⚠ AN UNKNOWN TILE IS OPEN WATER AND NEVER LAND — the window is finite and a
// boat under way will reach its edge between streams, and a rim of land is a wall that appears out
// of nothing and grounds you. Open water is the honest default on a basin.
const OPEN = { kind: 'land', biome: 'water', road: 0 };
function cellAt(dx, dy) {
  const gx = Math.round(st.cx + dx), gy = Math.round(st.cy + dy);
  const row = st.tiles[gy - st.oy];
  const c = row && row[gx - st.ox];
  return c || OPEN;
}
function buildWindow() {
  const N = RAD * 2 + 1;
  const map = [];
  for (let j = 0; j < N; j++) {
    const row = [];
    for (let i = 0; i < N; i++) row.push(cellAt(i - RAD, j - RAD));
    map.push(row);
  }
  return map;
}

// Is the water under us water? ⚠ ASKED OF THE TILE THE HULL IS ON, not of the one the window is
// centred on — they are the same only at the instant the window is rebuilt, and a boat doing 130
// crosses a tile in under a second.
function surfaceUnder() {
  const c = cellAt(0, 0);
  if (c.biome === 'water' || c.sub) return c.rough ? 'chop' : 'open';
  return 'land';
}

export function isBoatActive() { return !!st; }

export function openBoat(ctx = {}) {
  closeBoat();
  ensureWindshieldStyles();
  // ⚠ A HANDED-IN MOUNT WINS, the free-look seat's arrangement. dispatch.js passes none and gets
  // #area-content, which is what the cab does; a gate passes its own node, which is the only way
  // a panel that writes straight into the page can be opened without one.
  const host = ctx.mount || document.getElementById('area-content');
  if (!host) return;

  // ⚠ THE SIM'S OWN ROW, NOT A COPY. `TYPES.hydro` is what `stepBoat` is tuned against and what
  // the boatyard prices; a second table here would be a boat that handles differently depending
  // on which file you asked.
  const p = ctx.params || TYPES.hydro;
  ensureBoatStyles();
  // ⚠ ONE ROOT WITH THE GLASS AS ITS ONLY ALLOWED CHILD IN BIG SCREEN. The rule below is an
  // ALLOW-LIST rather than a list of things to hide, which is what `bigscreen-smoke` insists on
  // and for a good reason: a rule naming what to hide is a rule somebody has to remember to add
  // to, and the next readout hung on this glass ships inside the shot.
  host.innerHTML = '<div class="boat-root">'
    + `<div class="boat-view">${windshieldHTML(ID, (ctx.name || 'THE BASIN').toUpperCase() + ' · HELM')}</div>`
    + '<div class="boat-chrome">'
    // ⚠ THE LEVER IS A CONTROL AND NOT A READOUT, which is the whole reason it is here and not in
    // the text strip. `throttleFaces` already stands a quadrant on the starboard gunwale in the
    // depth buffer, and that is the one you look at; this is the one you can PUT YOUR HAND ON with
    // a mouse or a thumb. A boat whose only throttle is a held key is a boat nobody on a tablet
    // can drive, and it is the control the cab's own note calls the whole longitudinal decision.
    + '<canvas class="boat-lever" width="88" height="200" title="throttle — drag (W)"></canvas>'
    + '<canvas class="boat-wheel" width="200" height="200"></canvas>'
    + '<div class="boat-read"></div>'
    + '<div class="boat-keys"></div>'
    + '</div>'
    + '<div class="boat-chips">'
    // ⚠ THE IGNITION IS THE TRUCK'S KEY AND NOT A NEW ONE. `cab-view.js` binds K to
    // `toggleIgnition` and holds the starter for as long as it is down, so a driver who has
    // learned to start a rig has learned to start a boat. I was the obvious letter and is the
    // truck's DOME LIGHT — a seat that gave one letter two meanings across two vehicles is worse
    // than a seat with no key in it.
    + '<button class="boat-chip boat-key" type="button" title="ignition (K — hold to crank)">⏻ START</button>'
    // ⚠ AND THE CHASE CAMERA IS V/F, for the same reason and off the same pair: the cab takes both
    // because V is the cockpit's and F is what everybody's hands do anyway.
    + '<button class="boat-chip boat-ext" type="button" title="external / helm view (V)">◎ EXT</button>'
    + '<button class="boat-chip boat-help-btn" type="button" title="controls (?)">?</button>'
    + `<button class="boat-chip boat-big" type="button" title="${BIGSCREEN_TITLE}">${BIGSCREEN_GLYPH}</button>`
    + '<button class="boat-chip boat-x" type="button" title="step off (ESC)">✕</button>'
    + '</div>'
    // ⚠ TWO WAYS OUT, AND THEY ARE DIFFERENT ACTS RATHER THAN ONE VERB WITH A CONTEXT. ESC used to
    // fire a bare `disembark`, which the server reads as "tie her up here if here is a berth, and
    // otherwise put me in the water" — a correct rule that the seat gave the player no way to SEE,
    // so stepping off at speed in the middle of the Basin and mooring at the float were the same
    // keystroke with wildly different outcomes. Both verbs already exist; this is the affordance.
    + '<div class="boat-out" hidden></div>'
    + '<div class="boat-help" hidden></div>'
    + '</div>';

  st = {
    p,
    name: ctx.name || 'her',
    // The sim state `stepBoat` owns. ⚠ SEEDED FROM THE SERVER AND NOT FROM ZERO: hull and fuel are
    // a row in the database and a boat that came back full every time you sat in it would make the
    // whole yard pointless.
    sim: {
      x: 0, y: 0, heading: ctx.heading ?? 0, speed: 0, drift: 0, pedal: 0,
      hull: ctx.hull ?? 1, nitro: ctx.nitro ?? 1, nitroHeat: 0,
      vs: 0, z: 0, airborne: false, pitch: 0, roll: 0, clock: 0,
      // ⚠ SHE COMES UP DEAD, AND THIS IS THE ONE PLACE THAT IS TRUE. Everywhere else in the game
      // `running` is absent and therefore true — see `ignitionStep` — because nothing else in the
      // game has a key. Stating it false here is what makes taking the seat and getting under way
      // two acts, which is the same split `helm` and `embark` already are.
      running: false, crank: 0,
    },
    fuel: ctx.fuel ?? 1,
    cx: ctx.gx ?? 0, cy: ctx.gy ?? 0,          // the window's centre tile
    ox: (ctx.gx ?? 0) - RAD, oy: (ctx.gy ?? 0) - RAD,
    tiles: ctx.map || [],
    surface: 'open', aground: false,
    lever: 0, steer: 0, trim: 0,
    starter: false,
    keys: new Set(),
    look: { yaw: 0, pitch: 0, on: false },
    // ── THE CHASE CAMERA ───────────────────────────────────────────────────
    // ⚠ NOTHING HERE DRAWS A BOAT. `paintWindshield` already takes `external/extYaw/extPitch/
    // extZoom` and already has the hull, because this seat has been passing `cls: 'hydro'` since
    // the day it shipped — the same mesh the dock screen, the dealer's card and a stranger's
    // contact all read. So the view somebody else sees her from is four numbers rather than a
    // second renderer, which is the whole reason the cab could afford one too.
    external: false, extYaw: 0, extPitch: 0.18, extZoom: 1,
    first: !!ctx.first,
    hour: ctx.hour ?? 12, weather: (ctx.weather || 'clear').toLowerCase(),
    wxField: ctx.wxField ? normalizeWx(ctx.wxField) : null, wxGround: ctx.wxGround || null,
    contacts: [],
    lastSync: 0, last: performance.now(), alive: true, raf: 0,
    onSend: ctx.onSend || null,
    onExit: ctx.onExit || (() => send('disembark')),
  };

  // ⚠ THE WHEEL IS IN `absolute` MODE AND THE BOAT IS NOT A YACHT, which sounds like a
  // contradiction and is not: `absolute` means the wheel's ANGLE is the input rather than its
  // rotation being a course demand, and that is what a driven boat wants — the same mode the truck
  // uses. `helm-view` is the one that winds a course on.
  const root = host.querySelector?.('.boat-root') || host;
  // ── ⚠ THE WHEEL IS THE STEERING, AND IT IS BUILT WHETHER OR NOT THERE IS A CANVAS ──────────
  //
  // The cab's arrangement, and the first cut here got it wrong in three ways at once — each of
  // which leaves a wheel that draws perfectly and does nothing:
  //
  //   · it passed `onHold`, WHICH THE WIDGET DOES NOT READ. Only `accent, art, centreFullAt, gear,
  //     getHeading, getSpeed, handRate, keyRate, lock, mode, onHorn, onSteer, selfCentre` are.
  //   · it called `setAngle`, WHICH IS NOT IN THE RETURNED API (`setAccent, setHeld, setDragging,
  //     wind, setEnabled, getAngle, getLock, destroy`) — swallowed by the optional chaining.
  //   · and it kept its own `steer`, integrating the keys itself and only using the wheel's answer
  //     while a flag the widget never set was true. Two owners of one number, one of them dead.
  //
  // In `absolute` mode the widget IS the axle: it owns the angle, self-centres against speed, rate-
  // limits a flick and takes the keyboard through `setHeld`. Built with a null canvas it still does
  // all of that and simply draws nothing, which is how the truck uses it — so there is no branch
  // here and no fallback integrator to disagree with it.
  st.wheel = createHelmWheel(root.querySelector?.('.boat-wheel') || null, {
    mode: 'absolute',
    // ⚠ THE HUD WHEEL AND THE WHEEL IN THE PILOTHOUSE ARE ONE OBJECT. 'wheelFaces' in
    // interior-shell.js already builds a butterfly with a shift-light strip across its top, so a
    // widget left on the Echelon's ship's wheel would be two different wheels in one boat.
    art: 'f1',
    // ⚠ A RACE BOAT IS LESS THAN A TURN LOCK TO LOCK, which is the reason the shape is a yoke at
    // all: your hands never leave the grips, so there is nothing for the top and bottom of a
    // circle to do. 0.5 is ±90°, against the 1.6 (±288°) a ship geared for several turns wants.
    lock: 0.5,
    // The shift lights, read live off the crank rather than off the lever — the strip has to show
    // what the engine is doing and not what you have asked it for.
    getRevs: () => st?.sim?.rpm || 0,
    // The self-centring is a caster effect rather than a spring, so it asks the hull how fast it is
    // going — read live, because the sim is the only owner of speed and a pushed copy lags a frame.
    getSpeed: () => Math.abs(st?.sim?.speed || 0),
    onSteer: (axle) => { if (st) st.steer = Math.max(-1, Math.min(1, axle)); },
  });

  st.root = root;
  st.pane = document.getElementById(ID)?.closest?.('.ws-wrap') || root;
  st.helpEl = root.querySelector?.('.boat-help') || null;
  st.outEl = root.querySelector?.('.boat-out') || null;
  bindBigScreenButton(root.querySelector?.('.boat-big'));
  root.querySelector?.('.boat-x')?.addEventListener('click', () => toggleOut());
  root.querySelector?.('.boat-key')?.addEventListener('click', () => {
    // ⚠ A CLICK CANNOT HOLD A STARTER, so it arms one and the frame lets go of it once she fires.
    // Without that the button starts a motor that never catches, which is the control reading as
    // broken on the one surface a touch player has.
    ignition();
    // ⚠ AND IT LETS GO ON A CLOCK RATHER THAN ON SUCCESS, because a dry motor never succeeds: the
    // model turns it over for as long as the starter is down and reports `dry`, so a release
    // waiting for her to catch would leave the starter engaged for the rest of the session.
    if (!st.sim.running) { st.clickCrank = true; st.clickCrankUntil = performance.now() + CRANK_S * 1000 + 500; }
  });
  root.querySelector?.('.boat-ext')?.addEventListener('click', () => setExternal(!st.external));
  root.querySelector?.('.boat-help-btn')?.addEventListener('click', () => toggleHelp());
  buildHelp();
  buildOut();
  st.lever3d = createLever(root.querySelector?.('.boat-lever') || null);
  bindKeys();
  bindExternal();
  // ⚠ THE FIRST TIME, AND IT IS THE SERVER'S FACT RATHER THAN THE BROWSER'S. `ctx.first` comes off
  // a player flag the helm sets on the way past, so it follows the character onto another machine
  // and does not fire again for somebody who has owned a boat for a month and cleared their site
  // data. A localStorage key would have got both of those the wrong way round.
  if (st.first) toggleHelp(true);
  claimSeatKeyboard(st.pane, { label: 'HELM' });
  // ⚠ AND THE MOTOR IS NOT STARTED HERE ANY MORE. It was, unconditionally, which was right while
  // she was alive the moment the pane opened; with a key in her, a V8 idling over a dead boat is
  // the one thing that would make the whole ignition read as broken. `onEvent` starts it when she
  // catches. (The STARTER itself has no voice yet — `boat-audio.js` has no cranking cue, and the
  // V8 at `CRANK_RPM` is 1,300 rpm, which is a motor running rather than one being turned over.)
  st.raf = requestAnimationFrame(frame);
}

export function closeBoat() {
  if (!st) return;
  st.alive = false;
  cancelAnimationFrame(st.raf);
  window.removeEventListener('keydown', st.kd, true);
  window.removeEventListener('keyup', st.ku, true);
  st.wheel?.destroy?.();
  st.lever3d?.destroy?.();
  stopBoatEngine(true);
  stopBoatContacts();
  // ⚠ THE MODE OWNS THE PAGE, so nothing else takes it down with the view — climbing out in big
  // screen would otherwise strand the player with no sidebar, no log and no command box, and the
  // one key that would fix it is bound only while the mode thinks it is on.
  exitBigScreen();
  disposeWindshield(ID);
  endSeatKeyboard(st.pane);
  st = null;
}

// ── THE KEYS ─────────────────────────────────────────────────────────────────
//
// ⚠ FREE LOOK IS LATCHED ON SHIFT AND HELD, the cab's own arrangement, and it may not take a
// letter: every letter is spoken for in a seat and the cab's note records what happened the one
// time a mode took one (L is the headlights, and a driver who turned their head at night lost the
// road). Shift is the nitro here, so free look is the RIGHT MOUSE BUTTON instead and Shift is left
// alone — a seat that stole the boost to look sideways would be worse than no free look at all.
function bindKeys() {
  st.kd = (e) => {
    if (!st || e.target?.closest?.('input, textarea, [contenteditable]')) return;
    const k = e.key.toLowerCase();
    // ⚠ ESC CLOSES WHATEVER IS OPEN BEFORE IT CLOSES THE SEAT, which is the cab's own ladder and
    // is the difference between a flap you can dismiss and a flap that throws you out of the boat.
    if (k === 'escape') {
      if (!st.helpEl?.hidden) { toggleHelp(false); return; }
      if (!st.outEl?.hidden) { toggleOut(false); return; }
      toggleOut(true); return;
    }
    // ⚠ HELD, NOT TOGGLED — `cab-view.js` binds K exactly this way. A press turns a running motor
    // off; on a dead one it turns the starter for as long as your finger is down, so a start you
    // let go of half way through is a start that did not take, which is what a key is.
    if (k === 'k' && !e.repeat) { e.preventDefault(); ignition(); return; }
    if (!e.repeat) {
      if (k === 'v' || k === 'f') { e.preventDefault(); setExternal(!st.external); return; }
      if (k === '?' || k === '/') { e.preventDefault(); toggleHelp(); return; }
      // The shoulder-checks, and they are the cab's three letters. ⚠ SNAP AND LATCH rather than
      // held: a boat is steered with two hands and there is no third one to hold a look key with.
      if (k === 'q' || k === 'e') { st.look.yaw = clamp(k === 'q' ? -90 : 90, -LOOK_YAW, LOOK_YAW); st.look.pitch = 0; return; }
      // ⚠ ASTERN IS AS FAR AS THE PAINTED WORLD GOES, NOT 180°. `LOOK_YAW` is the limit this seat
      // and the cab share, and a snap past it would put your head somewhere the renderer has
      // nothing to show you — so S is "as far round as you can get", and pressing it again brings
      // you back rather than winding on for ever.
      if (k === 's') { st.look.yaw = Math.abs(st.look.yaw) > LOOK_YAW - 1 ? 0 : LOOK_YAW; st.look.pitch = 0; return; }
    }
    st.keys.add(k === 'shift' ? 'shift' : k);
  };
  st.ku = (e) => {
    if (!st) return;
    const k = e.key.toLowerCase();
    if (k === 'k') st.starter = false;
    st.keys.delete(k);
  };
  window.addEventListener('keydown', st.kd, true);
  window.addEventListener('keyup', st.ku, true);

  const glass = document.getElementById(ID);
  if (!glass || !glass.addEventListener) return;
  glass.addEventListener('contextmenu', (e) => e.preventDefault());
  glass.addEventListener('pointerdown', (e) => {
    if (e.button !== 2 || !st) return;
    st.look.on = true; st.look.px = e.clientX; st.look.py = e.clientY;
    glass.setPointerCapture?.(e.pointerId);
  });
  glass.addEventListener('pointermove', (e) => {
    if (!st?.look.on) return;
    const dx = e.clientX - st.look.px, dy = e.clientY - st.look.py;
    st.look.px = e.clientX; st.look.py = e.clientY;
    // ⚠ ONE DRAG, TWO JOBS, DECIDED BY WHICH VIEW IS UP — and it is the SAME handler rather than a
    // second set of listeners on the same element, which is the arrangement the cab's own note
    // about `st.external` is a record of: two owners of one drag and the one that loses does so
    // silently. Behind the glass the drag turns your head; outside it, it swings the camera round
    // the boat, because out there there is no head to turn.
    if (st.external) {
      st.extYaw = (st.extYaw + dx * 0.4) % 360;
      st.extPitch = clamp(st.extPitch - dy * 0.004, -0.10, 0.85);
      return;
    }
    // ⚠ RELATIVE, NEVER A POSITION MAP. A look that maps the cursor's place on the glass to a head
    // angle is a magnet at screen centre: let go and your head snaps forward.
    st.look.yaw = clamp(st.look.yaw + dx * 0.35, -LOOK_YAW, LOOK_YAW);
    st.look.pitch = clamp(st.look.pitch - dy * 0.30, -LOOK_PITCH, LOOK_PITCH);
  });
  // The dolly. ⚠ IT ONLY MEANS ANYTHING OUTSIDE — behind the glass there is nothing to back away
  // from, and a wheel that silently did nothing in one of two views is a control you stop trusting.
  glass.addEventListener('wheel', (e) => {
    if (!st?.external) return;
    e.preventDefault();
    st.extZoom = clamp(st.extZoom * (e.deltaY > 0 ? 1.12 : 0.89), 0.55, 3.2);
  }, { passive: false });
  const drop = () => { if (st) st.look.on = false; };
  glass.addEventListener('pointerup', drop);
  glass.addEventListener('pointercancel', drop);
  // A double-click puts your head back where it belongs, because a free look with no way home is
  // the trap the cab's own unlatch note is written about.
  glass.addEventListener('dblclick', () => {
    if (!st) return;
    if (st.external) { st.extYaw = 0; st.extPitch = 0.18; st.extZoom = 1; return; }
    st.look.yaw = 0; st.look.pitch = 0;
  });
}

// ⚠ A PLACEHOLDER SO THE LOOK BINDER READS THE SAME EITHER WAY. The orbit lives inside the pointer
// handlers above rather than in a second set of listeners — see the note there — so there is
// nothing left for this to bind. It exists because a call with no function behind it is exactly the
// class of mistake this file's own header records three of.
function bindExternal() { /* the orbit rides the look drag; see bindKeys */ }

// ── THE KEY ──────────────────────────────────────────────────────────────────
//
// ⚠ A PRESS MEANS TWO DIFFERENT THINGS AND THAT IS WHAT A KEY IS. Running, it stops her — one
// press, immediate, because a kill switch that had to be held would be the one control in the boat
// you cannot use in the moment you need it. Dead, it turns the starter, and the starter only turns
// while your finger is down.
function ignition() {
  if (!st) return;
  if (st.sim.running) {
    st.sim.running = false;
    st.starter = false;
    // ⚠ THE LEVER COMES BACK WITH IT. Leaving it open on a dead motor is the state the neutral
    // switch then refuses to start out of, so a player who shut her down at speed would find the
    // key doing nothing at all with nothing on the boat saying why.
    st.lever = 0;
    stopBoatEngine();
    send('boatevent stopped');
    return;
  }
  st.starter = true;
}

// ── THE CHASE CAMERA ─────────────────────────────────────────────────────────
function setExternal(on) {
  if (!st) return;
  st.external = !!on;
  const b = st.root?.querySelector?.('.boat-ext');
  if (b) { b.classList.toggle('on', st.external); b.textContent = st.external ? '◎ HELM' : '◎ EXT'; }
  // ⚠ THE HEAD GOES BACK TO THE SCREEN WHEN YOU COME INSIDE. A shoulder-check left latched while
  // you were outside is a driver who climbs back into the seat facing the transom — the cab
  // suppresses the same three things for the same reason.
  st.look.yaw = 0; st.look.pitch = 0; st.look.on = false;
  st.root?.classList?.toggle('boat-is-ext', st.external);
}

// ── THE FLAPS ────────────────────────────────────────────────────────────────
function toggleHelp(show) {
  if (!st?.helpEl) return;
  st.helpEl.hidden = show == null ? !st.helpEl.hidden : !show;
  st.root?.querySelector?.('.boat-help-btn')?.classList?.toggle('on', !st.helpEl.hidden);
  // ⚠ IT IS ONLY THE FIRST TIME ONCE, AND THE SERVER IS TOLD AS SOON AS IT HAS BEEN SEEN rather
  // than when it is dismissed: a player who shuts the pane without closing the flap has still had
  // the lesson, and a lesson that comes back every time is the one nobody reads.
  if (!st.helpEl.hidden && st.first) { st.first = false; send('boatevent learned'); }
}

function buildHelp() {
  if (!st?.helpEl) return;
  st.helpEl.innerHTML = '<h4>THE HELM</h4>'
    + '<dl>'
    + '<dt>K</dt><dd>ignition — hold to crank her, press again to shut down. She will not start with the lever open.</dd>'
    + '<dt>W</dt><dd>throttle. It is a lever, not a button: it runs up while you hold it and falls back when you let go. You can also drag it.</dd>'
    + '<dt>A / D</dt><dd>steer. She has no rudder at rest — you point her by moving her.</dd>'
    + '<dt>[ / ]</dt><dd>trim tabs. Bow down holds on; bow up is speed on a boat barely in the water.</dd>'
    + '<dt>SHIFT</dt><dd>the bottle. It costs hull, not fuel.</dd>'
    + '<dt>V</dt><dd>external view. Drag to swing round her, wheel to back off.</dd>'
    + '<dt>Q / E / S</dt><dd>look port, starboard, astern. Right-drag looks anywhere.</dd>'
    + '<dt>ESC</dt><dd>step off — alongside to moor her, or over the side into the water.</dd>'
    + '</dl>'
    + '<p class="boat-help-foot">Everything here is also a button. Press <b>?</b> or <b>Esc</b> to close.</p>';
  st.helpEl.addEventListener('click', () => toggleHelp(false));
}

// ── STEPPING OFF ─────────────────────────────────────────────────────────────
//
// ⚠ BOTH VERBS ALREADY EXISTED AND NEITHER HAD A WAY IN. `disembark` ties her up when the tile
// under her is a berth and puts you in the water when it is not, and `adrift.js` is a long record
// of why that is the right rule — what it never had was anything telling the player WHICH of the
// two they were about to do. So the flap says it, and the seat asks the sim rather than guessing:
// what decides it is where she is lying, which only the server knows, so the wording is a
// question and never a promise.
function buildOut() {
  if (!st?.outEl) return;
  st.outEl.innerHTML = '<h4>STEP OFF</h4>'
    + '<p class="boat-out-note"></p>'
    + '<button class="boat-chip boat-out-go" type="button">step off</button>'
    + '<button class="boat-chip boat-out-no" type="button">stay aboard</button>';
  st.outEl.querySelector('.boat-out-go')?.addEventListener('click', () => { toggleOut(false); st.onExit(); });
  st.outEl.querySelector('.boat-out-no')?.addEventListener('click', () => toggleOut(false));
}

function toggleOut(show) {
  if (!st?.outEl) return;
  st.outEl.hidden = show == null ? !st.outEl.hidden : !show;
  if (st.outEl.hidden) return;
  const note = st.outEl.querySelector('.boat-out-note');
  const mph = Math.abs(st.sim.speed);
  // ⚠ WAY ON IS THE ONE STATE WORTH REFUSING, and the server refuses it too (`STEP_OFF_MPH` in
  // adrift.js) — this is the warning that stops a player meeting that refusal with no idea what
  // it is about. Said here rather than only there, because by the time the log prints it you have
  // already decided.
  if (note) {
    note.textContent = mph > 4
      ? 'She still has way on. Take the lever off her and let her lose it first.'
      : st.sim.running
        ? 'Alongside a berth you will tie her up and step onto it. Anywhere else you go into the water and she floats where you left her — with the engine still running.'
        : 'Alongside a berth you will tie her up and step onto it. Anywhere else you go into the water and she floats where you left her.';
  }
}

// ── THE LEVER, AS A THING YOU CAN GRAB ───────────────────────────────────────
//
// ⚠ IT IS THE SAME NUMBER THE KEY MOVES, WITH EXACTLY ONE OWNER. `st.lever` is written by
// `readInput` from W and by a drag here, and the two cannot both be integrating it — so a drag
// SETS it and the key rate is skipped for as long as a finger is down. Two owners of one axle is
// the bug this file's own wheel note is a record of, and it is the same bug one control over.
const LEVER_PAD = 22;   // the dead space at each end of the gate, in the canvas's own units

function createLever(canvas) {
  if (!canvas) return null;
  let dragging = false;
  const set = (e) => {
    const r = canvas.getBoundingClientRect();
    if (!r.height) return;
    // Top of the travel is full ahead, bottom is idle — which is the way the gate on the gunwale
    // runs and the way your hand pushes.
    //
    // ⚠ THE PAD IS THE DRAWN ONE, SCALED, AND NOT A SECOND LITERAL. The canvas has a backing store
    // in its own units and a CSS box in the page's, so a grab offset written as a number here goes
    // quietly out of step with the gate the moment either size is retuned — and the symptom is a
    // lever whose knob does not come to your finger, which reads as lag rather than as arithmetic.
    const pad = LEVER_PAD * (r.height / canvas.height);
    st.lever = clamp(1 - (e.clientY - r.top - pad) / Math.max(1, r.height - pad * 2), 0, 1);
  };
  const down = (e) => { dragging = true; st.leverHeld = true; canvas.setPointerCapture?.(e.pointerId); set(e); e.preventDefault(); };
  const move = (e) => { if (dragging) set(e); };
  const up = () => { dragging = false; st.leverHeld = false; };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'grab';
  return {
    draw() {
      const g = canvas.getContext?.('2d');
      if (!g) return;
      const W = canvas.width, H = canvas.height, pad = LEVER_PAD;
      g.clearRect(0, 0, W, H);
      const x = W * 0.5, y0 = H - pad, y1 = pad;
      // ⚠ IT NEEDS A BODY, AND THAT IS A MEASUREMENT RATHER THAN A PREFERENCE. Drawn as a bare
      // stem and a dot it sits over the dark top of the pilothouse — which is the same value — and
      // in the pane it read as a smudge with a red speck on it. A control you cannot find is a
      // control that is not there, and this is the one a touch player has instead of a key.
      g.fillStyle = 'rgba(10,15,22,.72)';
      g.strokeStyle = 'rgba(120,150,180,.45)'; g.lineWidth = 2;
      const r = 10;
      g.beginPath();
      g.moveTo(x - 20 + r, 4); g.arcTo(x + 20, 4, x + 20, H - 4, r);
      g.arcTo(x + 20, H - 4, x - 20, H - 4, r); g.arcTo(x - 20, H - 4, x - 20, 4, r);
      g.arcTo(x - 20, 4, x + 20, 4, r); g.closePath(); g.fill(); g.stroke();
      // The gate and its notches.
      g.strokeStyle = 'rgba(170,195,225,.55)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x, y1); g.lineTo(x, y0); g.stroke();
      for (let i = 0; i <= 4; i++) {
        const yy = y0 + (y1 - y0) * (i / 4);
        g.strokeStyle = i === 0 || i === 4 ? 'rgba(190,215,240,.75)' : 'rgba(170,195,225,.35)';
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(x - 13, yy); g.lineTo(x + 13, yy); g.stroke();
      }
      const ky = y0 + (y1 - y0) * clamp(st.lever, 0, 1);
      // The arm and the knob. ⚠ RED WHILE SHE IS DEAD, because a lever that looks live on a boat
      // with no engine running is the control telling you the wrong thing about the boat.
      g.strokeStyle = st.sim.running ? 'rgba(210,232,255,.95)' : 'rgba(255,120,104,.8)';
      g.lineWidth = 6; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, ky); g.stroke();
      g.fillStyle = st.sim.running ? '#d8e8ff' : '#ff8a78';
      g.beginPath(); g.arc(x, ky, 13, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(8,12,18,.85)';
      g.beginPath(); g.arc(x, ky, 6, 0, Math.PI * 2); g.fill();
      // Which end is which. Two words, because a lever with no gate markings is a slider.
      g.fillStyle = 'rgba(160,185,210,.75)';
      g.font = '600 13px ui-monospace,monospace'; g.textAlign = 'center';
      g.fillText('FULL', x, 16); g.fillText('IDLE', x, H - 5);
    },
    destroy() {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
    },
  };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ── THE FRAME ────────────────────────────────────────────────────────────────
function frame(now) {
  if (!st || !st.alive) return;
  const dt = Math.min(0.05, (now - st.last) / 1000);
  st.last = now;
  try {
    const input = readInput(dt);
    st.surface = surfaceUnder();
    st.aground = st.surface === 'land';
    input.surface = st.surface; input.aground = st.aground;

    // ⚠ FUEL IS BURNT HERE AND SPENT ON THE SERVER. `stepBoat` has no opinion about a database row
    // — see its own note on the hull — so the model reports and this panel meters, exactly as the
    // hull does. Running dry drops the lever rather than stopping the boat dead, because way is
    // way and a boat does not have brakes.
    // ⚠ AND A STOPPED MOTOR BURNS NOTHING, which the base term used to do regardless. That figure
    // is the IDLE burn — it is what she drinks sitting at the pontoon doing nothing — so left
    // unconditional it would empty a tank while the key was off, and the one thing a key is
    // unambiguously for is leaving her somewhere without that happening.
    if (st.fuel <= 0) { st.lever = 0; input.throttle = 0; }
    else if (st.sim.running) st.fuel = Math.max(0, st.fuel - (0.00042 + 0.0035 * st.sim.pedal) * dt);

    stepBoat(st.sim, input, st.p, dt);
    for (const ev of st.sim.events || []) onEvent(ev);
    if (st.clickCrank && (st.sim.running || now > st.clickCrankUntil)) { st.starter = false; st.clickCrank = false; }

    // Recentre the window when the hull has crossed far enough that the rim is in reach. The
    // server streams a fresh one on the next sync; until it arrives the old tiles are re-indexed
    // about the new centre, which is why `cellAt` works in absolute grid coordinates.
    const dx = st.sim.x, dy = st.sim.y;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
      st.cx += Math.round(dx); st.cy += Math.round(dy);
      st.sim.x -= Math.round(dx); st.sim.y -= Math.round(dy);
    }

    const spd01 = clamp(Math.abs(st.sim.speed) / Math.max(1, st.p.topSpeed || 138), 0, 1);
    // ⚠ THE TWO KEYS THE SYNTH ACTUALLY READS. `rampV8` takes `rpm`, `pedal`, `distance`,
    // `doppler` and `perspective` and nothing else — this sent `load`, `nitro` and `airborne`,
    // which are silently ignored, and handed the PEDAL in as the rpm while `pedal` itself went
    // unset. The motor still made a noise, which is exactly why it would never have been reported:
    // it was the blower follower's noise rather than the engine's, with no throttle response on it
    // at all. `s.rpm` is the sim's own 0..1 crank figure and `s.pedal` the lever follower.
    updateBoatEngine({ rpm: st.sim.rpm, pedal: st.sim.pedal });
    updateBoatContacts({ x: st.cx + st.sim.x, y: st.cy + st.sim.y, heading: st.sim.heading, speed: st.sim.speed }, st.contacts);

    paintWindshield(ID, {
      cls: 'hydro', phase: 'cruise', worldBlend: 1,
      map: buildWindow(), mapCenter: { x: st.cx, y: st.cy },
      mapOffset: { x: st.sim.x, y: st.sim.y },
      heading: st.sim.heading, ownHdg: st.sim.heading,
      // ⚠ `pitch`/`roll` ARE THE HULL'S ATTITUDE AND `lookYaw`/`lookPitch` ARE YOUR HEAD'S. Two
      // different things that would be one field with two meanings if they shared a name — the
      // trap `camPitch` is named for.
      pitch: st.sim.pitch, roll: st.sim.roll,
      // ⚠ THE SHOULDER-CHECK IS SUPPRESSED OUT THERE, NOT MERELY UNUSED. The chase camera is
      // already showing you what a look astern is for, and yawing a third-person view off the
      // boat it is following is just lost — the cab's own wording, and it is the same renderer
      // reading the same two fields.
      lookYaw: st.external ? 0 : st.look.yaw, lookPitch: st.external ? 0 : st.look.pitch,
      // ⚠ AND THE EYE IS ONLY SENT FROM INSIDE. `eyeH` seats the driver in the pilothouse; out
      // there it would move the BOAT against the world rather than the camera against the boat,
      // which is the trap `cab-view.js` records one seat over and the reason it spreads the pair
      // conditionally rather than sending both always.
      ...(st.external
        ? { external: true, extYaw: st.extYaw, extPitch: st.extPitch, extZoom: 1.15 * st.extZoom }
        : { height: 0, eyeH: EYE_TILES }),
      speed: st.sim.speed,
      hour: st.hour, weather: st.weather,
      // ⚠ IT IS `wxGround`, AND THIS SENT `ground`. The renderer reads `v.wxGround` to seed how wet
      // and how snowed the world already is, so named wrong the seat starts every passage on dry,
      // bare summer ground and converges over the next ten minutes — a player taking the helm in a
      // blizzard sails out onto grass while somebody on the pontoon is standing in snow. Exactly the
      // failure recorded against the sky payload, arriving through a fifth seat the gate for it
      // could not see, because that gate scans a hard-coded list of four view files.
      wxField: st.wxField, wxGround: st.wxGround,
      acX: st.cx + st.sim.x, acY: st.cy + st.sim.y,
      ownWake: { spd: spd01, turn: st.steer, beam: 0.30 },
      contacts: st.contacts,
      // The live cluster. These are the shell's own keys — see `instrumentFaces` — and every one of
      // them is a number the sim already has, which is the point of the dials being geometry.
      instr: {
        rpm: st.sim.pedal, speed: Math.abs(st.sim.speed), throttle: st.lever,
        hull: st.sim.hull, nitro: st.sim.nitro, nitroOn: st.sim.nitroOn,
        nitroHeat: st.sim.nitroHeat, steer: st.steer, fuel: st.fuel, trim: st.trim,
        aground: st.aground, gps: { x: st.cx + st.sim.x, y: st.cy + st.sim.y },
      },
    });
    drawRead();

    if (now - st.lastSync >= SYNC_MS) {
      st.lastSync = now;
      // Packed, in cmdBoatSync's unpack order:
      //   x y heading speed hull nitro fuel pedal roll pitch rich bang flags
      // ⚠ THE LAST FIVE ARE NOT TELEMETRY ABOUT ME, THEY ARE WHAT OTHER PEOPLE SEE. The server
      // fills `rigs` from this packet and `vehicle.contacts` publishes it to every windscreen in
      // range, so `pedal`, `rich` and `bang` are what draws the flame off somebody else's pipes
      // when they stab the throttle. Dropped, a boat two hundred yards away runs clean and silent
      // and nothing anywhere says why.
      //   bit 0 = the bottle is lit
      send('boatsync '
        + (st.cx + st.sim.x).toFixed(3) + ' ' + (st.cy + st.sim.y).toFixed(3) + ' '
        + Math.round(st.sim.heading) + ' ' + Math.round(Math.abs(st.sim.speed)) + ' '
        + st.sim.hull.toFixed(4) + ' ' + st.sim.nitro.toFixed(3) + ' ' + st.fuel.toFixed(4) + ' '
        + (st.sim.pedal || 0).toFixed(3) + ' ' + (st.sim.roll || 0).toFixed(4) + ' '
        + (st.sim.pitch || 0).toFixed(4) + ' ' + (st.sim.rich || 0).toFixed(2) + ' '
        + (st.sim.bang || 0).toFixed(2) + ' ' + (st.sim.nitroOn ? 1 : 0));
    }
  } catch (e) {
    // The cab's and the helm's discipline, for the same reason: `paintWindshield` has no internal
    // try/catch, so one bad frame must not reach the reschedule and strand a driver looking at a
    // frozen picture.
    if (!st._errLogged) { console.error('[boat] frame error (view kept alive — report this stack):', e); st._errLogged = true; }
  }
  st.raf = requestAnimationFrame(frame);
}

// A helm eye, in tiles.
//
// ⚠ DERIVED, BECAUSE THE INTERIOR IS SIZED AGAINST IT. `pushInteriorShell` turns the shell's metres
// into tiles with `cam.EH / eyeMetresOf(P)`, so this number and `HELM.eyeM` are the two ends of one
// scale: pick this one to frame the sea nicely and you have silently resized the cabin against the
// world it is looking out at. Written as a literal it was right, and it was right by coincidence —
// it would have stopped being right the first time anybody retuned the helm.
//
// The conversion is the only human-scale anchor this codebase states: the truck cab sits at
// `eyeH: 0.12` and means `EYE_M` metres, so a metre is `0.12 / EYE_M` of a tile everywhere.
const EYE_TILES = HELM.eyeM * (0.12 / EYE_M);

function onEvent(ev) {
  if (ev === 'holed' || ev === 'aground' || ev === 'slam') send('boatevent ' + ev);
  // ⚠ THE MOTOR IS STARTED AND STOPPED BY THE MODEL'S OWN EVENTS, never beside the keypress. The
  // key ARMS a starter and the model decides whether she catches — dry, she never does — so audio
  // hung off the press would have a boat roaring into life on an empty tank.
  if (ev === 'started') { startBoatEngine(); send('boatevent started'); }
}

function drawRead() {
  const el = st.root?.querySelector?.('.boat-read');
  if (!el) return;
  const mph = Math.round(Math.abs(st.sim.speed));
  // ⚠ THE TABS READ AS A DIRECTION, NOT AS A PERCENTAGE. What you need to know at a glance is
  // which way she is set and roughly how far, and "TABS +38%" is a number you would have to stop
  // and think about at 130 mph.
  const t = st.trim;
  const tab = Math.abs(t) < 0.08 ? 'FLAT' : (t > 0 ? 'BOW UP' : 'BOW DOWN') + ' ' + '|'.repeat(Math.max(1, Math.round(Math.abs(t) * 4)));
  // ⚠ A DEAD ENGINE IS THE FIRST THING ON THE STRIP AND IT REPLACES THE SPEED, because it is the
  // answer to the only question a stationary player is asking. Printed after the mph it reads as a
  // footnote on a boat that is plainly not moving, which is exactly the state the whole ignition
  // exists to make legible.
  const head = st.sim.running ? (mph + ' MPH')
    : (st.sim.crank > 0 ? 'CRANKING…' : st.fuel <= 0 ? 'DRY — NO START' : 'ENGINE OFF · K');
  el.textContent = head + '   HULL ' + Math.round(st.sim.hull * 100) + '%   FUEL '
    + Math.round(st.fuel * 100) + '%   BOTTLE ' + Math.round(st.sim.nitro * 100) + '%   ' + tab;
  el.classList.toggle('boat-dead', !st.sim.running);

  const keys = st.root?.querySelector?.('.boat-keys');
  // ⚠ THE LINE FOLLOWS THE MODE RATHER THAN LISTING EVERYTHING, the free camera's own rule: a strip
  // advertising the lever and the tabs while you are orbiting the boat is advertising two controls
  // that do nothing out there.
  if (keys) {
    keys.textContent = st.external
      ? 'drag swing · wheel back off · V helm view · ? controls · ESC step off'
      : (st.sim.running
        ? 'W throttle · A/D steer · [ ] tabs · SHIFT bottle · K stop · V external · ? controls'
        : 'K ignition (hold) · V external · ? controls · ESC step off');
  }
  st.lever3d?.draw?.();
  const kb = st.root?.querySelector?.('.boat-key');
  if (kb) { kb.textContent = st.sim.running ? '⏻ STOP' : '⏻ START'; kb.classList.toggle('on', st.sim.running); }
}

// ── WHAT THE SERVER PUSHES ───────────────────────────────────────────────────
export function boatSetWorld(msg = {}) {
  if (!st) return;
  if (msg.map) { st.tiles = msg.map; st.ox = (msg.gx ?? st.cx) - RAD; st.oy = (msg.gy ?? st.cy) - RAD; }
  if (msg.hour != null) st.hour = msg.hour;
  if (msg.weather) st.weather = String(msg.weather).toLowerCase();
  if (msg.wxField) st.wxField = normalizeWx(msg.wxField);
  if (msg.wxGround) st.wxGround = msg.wxGround;
  if (msg.contacts) st.contacts = msg.contacts;
  // ⚠ THE SERVER IS AUTHORITATIVE ABOUT THE ROW AND NOT ABOUT THE POSITION. Hull, fuel and the
  // bottle are things the yard, a refit and a wreck all write, so they are adopted; where the boat
  // IS is what this client just told the server, and adopting it back would fight the sim four
  // times a second.
  if (msg.hull != null) st.sim.hull = msg.hull;
  if (msg.fuel != null) st.fuel = msg.fuel;
  if (msg.nitro != null) st.sim.nitro = msg.nitro;
}

// ── THE STYLES ───────────────────────────────────────────────────────────────
//
// One block, with the panel, per the one-file-per-panel convention. Rewritten every time rather
// than early-returned, for the reason helm-mode gives: a stale block left by an older build would
// pin the old layout under this module's fresh JS.
function ensureBoatStyles() {
  const el = document.getElementById('boat-styles') || document.createElement('style');
  el.id = 'boat-styles';
  el.textContent = `
    #area-content:has(.boat-root){ height:100%; overflow:hidden; overscroll-behavior:contain; touch-action:none; }
    .boat-root{ position:relative; width:100%; height:100%; min-height:380px; overflow:hidden;
      overscroll-behavior:contain; touch-action:none; background:#05070b; }
    .boat-view, .boat-view .ws-wrap{ position:absolute; inset:0; }
    /* ⚠ THE STRIP UNDER IT HANGS AT -18px, SO THE ROW CANNOT SIT AT 10. '.boat-keys' is absolutely
       positioned BELOW its own row and the root clips, so at the old offset the one line telling a
       new driver which keys to press was cut in half by the bottom of the pane — which is exactly
       the line that matters most on a seat that now starts dead and has to be started. Measured in
       the pane: it needs the row's own height plus that overhang. */
    .boat-chrome{ position:absolute; left:10px; bottom:30px; display:flex; align-items:flex-end;
      gap:12px; pointer-events:none; }
    .boat-wheel{ width:150px; height:150px; pointer-events:auto; opacity:.92; }
    .boat-read{ font:600 15px/1.5 ui-monospace,monospace; color:#cfe6ff; letter-spacing:.06em;
      text-shadow:0 1px 3px #000; padding-bottom:6px; }
    .boat-keys{ position:absolute; left:0; bottom:-18px; white-space:nowrap;
      font:500 11px/1.4 ui-monospace,monospace; color:#7d93ab; letter-spacing:.04em; }
    .boat-chips{ position:absolute; right:10px; top:10px; display:flex; gap:6px; }
    .boat-chip{ background:rgba(8,12,18,.72); border:1px solid #24303d; color:#9fb6cc;
      font:600 13px/1 ui-monospace,monospace; padding:6px 9px; border-radius:4px; cursor:pointer; }
    .boat-chip:hover{ color:#e6f2ff; border-color:#3a4a5c; }
    .boat-chip.on{ color:#cfe6ff; border-color:#4a6d8c; background:rgba(24,44,64,.8); }
    .boat-lever{ width:66px; height:150px; pointer-events:auto; }
    /* ⚠ THE STRIP GOES RED WITH THE LEVER, not amber and not merely dimmer: a stopped engine is
       the one state on this boat you can sit in indefinitely without noticing, and it is the one
       that makes every other control appear broken. */
    .boat-read.boat-dead{ color:#ff9c8c; }
    /* The two flaps. Same shape, same dismissal, and the cab's own wording under both. */
    .boat-help, .boat-out{ position:absolute; z-index:6; background:rgba(8,12,18,.94);
      border:1px solid #2b3846; border-radius:6px; padding:14px 16px; color:#aeb9c6;
      font:500 12px/1.5 ui-monospace,monospace; }
    .boat-help{ inset:10px 10px auto 10px; max-height:calc(100% - 92px); overflow:auto; cursor:pointer; }
    .boat-out{ left:50%; top:50%; transform:translate(-50%,-50%); width:min(420px,86%); text-align:left; }
    .boat-help[hidden], .boat-out[hidden]{ display:none; }
    .boat-help h4, .boat-out h4{ margin:0 0 10px; font-size:11px; letter-spacing:.18em; color:#8fd0ff; }
    .boat-help dl{ display:grid; grid-template-columns:max-content 1fr; gap:5px 14px; margin:0; }
    .boat-help dt{ color:#8fd0ff; font-weight:600; white-space:nowrap; }
    .boat-help dd{ margin:0; }
    .boat-help-foot{ margin:12px 0 0; color:#78828e; font-size:11px; }
    .boat-out-note{ margin:0 0 12px; }
    .boat-out .boat-chip{ margin-right:8px; }
    /* ⚠ AN ALLOW-LIST, NOT A HIDE LIST — see the note at the mount. The picture stays and
       everything else on this glass goes, so the next readout somebody hangs here is outside the
       shot by default rather than by somebody remembering to add it. */
    body.bigscreen .boat-root > *:not(.boat-view){ display:none !important; }
    body.bigscreen .boat-root .ws-label,
    body.bigscreen .boat-root .ws-frame::after{ display:none; }`;
  if (!el.parentNode) document.head.appendChild(el);
}
