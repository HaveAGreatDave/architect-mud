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

import { paintWindshield, windshieldHTML, ensureWindshieldStyles, disposeWindshield, lastViewState, seaAmpsNow, hullSeaGains, interiorHotspots, ownHullScale, RENDER_TUNE, ROAD_RIG_MUL } from './windshield.js';
import { airHornOn, airHornOff } from './engine-audio.js';
import { seaClock, seaHeight, SEA_TILE_M } from '../../../shared/sea-swell.js';
import { CAST_MIN_M } from '../../../shared/boatfish-rules.js';
import { navHomeHTML, drawNavHome } from './nav-home.js';
import { stepBoat, shiftBoatOrigin, stepBoatRide, TYPES, CRANK_S } from './flight-model.js';
import { createHelmWheel } from './helm-wheel.js';
import { tweenOrbit, SHOTS } from './camera-tween.js';
import { startBoatEngine, updateBoatEngine, stopBoatEngine, isBoatEngineRunning, updateBoatContacts, stopBoatContacts, updateBoatWater, stopBoatWater, boatLandThump } from './boat-audio.js';
import { claimSeatKeyboard, endSeatKeyboard } from './seat-keys.js';
import { makeContactTrack } from './world-feed.js';
import { seatHidePanel } from '../../../shared/compact-view.js';
import { bindBigScreenButton, exitBigScreen, BIGSCREEN_GLYPH, BIGSCREEN_TITLE } from './bigscreen.js';
import { boatGeom } from '../../../shared/boat-house.js';
import { BOAT_ROWS } from '../../../shared/vehicle-models.js';
import { wildlandsAt } from '../../../shared/wildlands.js';
import { SWING_R, LIE_FRAC, clampToSwing } from '../../../shared/boat-anchor.js';
import { bindTouchGestures } from './touch-gestures.js';
import { loadCss } from '../../../shared/dom.js';

// boat-view.css ships beside this file and is fetched when the module loads, so ensureBoatStyles
// still applies it synchronously on first open. See loadCss in client/shared/dom.js.
const BOAT_CSS = await loadCss(new URL('./boat-view.css', import.meta.url));

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
// boat. Held down, A runs the lever up over about a second and a half; released, it falls back
// faster than it rose. `stepBoat` then spools the BLOWER off the lever on its own asymmetry, so
// there are two lags in series between your finger and the thrust — which is exactly what the
// throttle of a supercharged engine is.
const LEVER_UP = 0.70, LEVER_DOWN = 1.30;
// ⚠ THE TABS ARE HELD, NOT TOGGLED, because that is what the control on a real boat is: a rocker
// under your thumb that runs the rams while you hold it and leaves them where you let go. A
// three-position switch would make trim a mode you select rather than a thing you are constantly
// working, and working it IS the skill — see the note in `stepBoat`.
const TRIM_RATE = 0.55;
// How much of the sea the hull still answers to with the gyro stabiliser running.
const STAB_K = 0.35;
// The R shove off a beach: astern way in tiles/s, held while R is down on the sand, and how many
// seconds it takes to run down after. A tap moves her about 0.56 tiles; flat out she only runs
// 0.35 up the sand, so one tap always floats her with a few lengths to spare.
const SHOVE_V = 1.4, SHOVE_TAU = 0.4;

function readInput(dt) {
  const k = st.keys;
  // ⚠ THE DRAG WINS WHILE IT IS HELD, AND THE KEY IS SKIPPED RATHER THAN BLENDED. A hand on the
  // lever and a finger on W are two people driving; the one that would lose is the hand, because
  // the key integrates every frame and the drag only writes when the pointer moves — so a player
  // dragging the lever down against a held W would watch it climb out from under them.
  // ⚠ A AND Z ARE THE FLIGHT SIM'S THROTTLE, AND THEY WORK THE WAY IT DOES: the lever runs while a
  // key is held and STAYS where you let go. It used to be W, springing back to idle on release,
  // which was the one vehicle in the game where the throttle hand could not be taken off the key.
  if (!st.leverHeld) {
    const dir = (k.has('a') ? 1 : 0) - (k.has('z') ? 1 : 0);
    if (dir) st.lever = Math.max(0, Math.min(1, st.lever + (dir > 0 ? LEVER_UP : -LEVER_DOWN) * dt));
  }
  // ⚠ AT ANCHOR THE LEVER STAYS SHUT, and says why on the strip rather than dragging the anchor.
  if (st.anchored) {
    if (st.lever > 0 || k.has('a')) st.anchorNag = performance.now();
    st.lever = 0;
  }
  // In rod mode the throttle is dead and the steering keys are the aim's (see stepRod).
  if (rodOn()) st.lever = 0;
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
  // X / C are the cockpit's rudder and the cab's steering; the arrows are the alias both share.
  // ',' / '.' are the flight sim's other rudder pair, so every aircraft's pedals steer a boat.
  if (k.has('x') || k.has(',') || k.has('arrowleft')) want -= 1;
  if (k.has('c') || k.has('.') || k.has('arrowright')) want += 1;
  if (rodOn()) want = 0;
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
// ⚠ A GAP BETWEEN REGIONS COMES DOWN AS `kind: 'air'` WITH NO BIOME, and `isWet` read that as land,
// so open sea the floor paints as water beached her. The gap is sea wherever `wildlandsAt` says so,
// the same answer the floor draws from. Boat-only: it adds no tile to `surfaceAt`.
const gapSea = new Map();
function gapIsSea(gx, gy) {
  const k = gx + ',' + gy;
  let v = gapSea.get(k);
  if (v === undefined) { v = !!wildlandsAt(gx, gy).sea; if (gapSea.size > 20000) gapSea.clear(); gapSea.set(k, v); }
  return v;
}
function cellAt(dx, dy) {
  const gx = Math.round(st.cx + dx), gy = Math.round(st.cy + dy);
  const row = st.tiles[gy - st.oy];
  const c = row && row[gx - st.ox];
  if (c && c.kind === 'air') return gapIsSea(gx, gy) ? OPEN : c;
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
// ── FLOATING STRUCTURE IS SOLID ──────────────────────────────────────────────
//
// A pontoon or a fuel deck is on WATER tiles (a hull has to be on the tile to moor at it or to be
// alongside it), so the land test never stops a boat and she used to drive straight through the
// deck. The deck itself is solid now and the margin of the tile around it is not: that margin is
// where a hull lies alongside. The footprints are the arms' own (windshield.js, `pontoon` and
// `fuel_dock`), at the top of `fh`'s range so a hull can never visibly overlap the deck.
// ⚠ IT IS A FENDER, NOT A GROUNDING: the way comes off and she stops against it; only a hard hit
// costs hull (and reports `slam`, which the server already prices). Beaching stays for land.
const RUN_AXIS_NS = { north: true, south: true };
function structureAt(dx, dy) {
  const c = cellAt(dx, dy);
  if (c.bt !== 'pontoon' && c.bt !== 'fuel_dock') return false;
  const gx = st.cx + dx, gy = st.cy + dy;
  const ox = gx - Math.round(gx), oy = gy - Math.round(gy);
  // The deck's long side is its local X, which is world x for a north/south entrance.
  if (c.bt === 'fuel_dock') {
    const [ax, ay] = (RUN_AXIS_NS[c.ent] || !c.ent) ? [ox, oy] : [oy, ox];
    return Math.abs(ax) < 0.38 && Math.abs(ay) < 0.35;
  }
  // A pontoon runs the length of its tile along the entrance axis; the walkway is solid across it.
  return (RUN_AXIS_NS[c.ent] || !c.ent) ? Math.abs(ox) < 0.35 : Math.abs(oy) < 0.35;
}
function fendOff(px, py) {
  if (!structureAt(st.sim.x, st.sim.y)) return;
  const v = Math.abs(st.sim.speed);
  // Slide along the face where one axis is still free, rather than sticking dead on contact.
  if (!structureAt(st.sim.x, py)) st.sim.y = py;
  else if (!structureAt(px, st.sim.y)) st.sim.x = px;
  else { st.sim.x = px; st.sim.y = py; }
  st.sim.speed *= 0.25; st.sim.drift = 0;
  if (v > 18) {
    st.sim.hull = Math.max(0, (st.sim.hull ?? 1) - Math.min(0.08, (v - 18) * 0.0015));
    onEvent('slam');
  }
}

const isWet = (c) => c.biome === 'water' || !!c.sub;
function surfaceUnder() {
  // ⚠ THE HULL IS AT (sim.x, sim.y) FROM THE WINDOW'S CENTRE. This read cellAt(0, 0) — the centre
  // itself — so a boat anywhere inside the six-tile recentre radius was asking about a tile up to
  // six away, and drove straight up a beach that the check never looked at.
  const c = cellAt(st.sim.x, st.sim.y);
  if (isWet(c)) return c.rough ? 'chop' : 'open';
  return 'land';
}

export function isBoatActive() { return !!st; }

// ── THE SERVICE OVERLAY'S HOOKS ──────────────────────────────────────────────
// The marina's bench comes to the seat in the covered slot, and the pump at the fuel float
// (marina-panel.js, service mode). Three things from the seat, the cab's own three: somewhere to
// mount, a paint job shown on the hull before it is bought, and which camera is up.
export function boatServiceHost() { return st ? st.root : null; }
// ⚠ A PREVIEW, NEVER THE PAINT — cleared on close, and replaced by the server's push after a respray.
export function boatPreview({ livery = null } = {}) { if (st) st.preview = livery || null; }
export function boatView(mode, { quarter = false } = {}) {
  if (!st) return null;
  if (mode === 'ext' || mode === 'cab') setExternal(mode === 'ext');
  // The dock's opening shot: a 3/4 off her FRONT-RIGHT (see cabView — 225 net of 'chaseYaw').
  if (quarter && mode === 'ext') { st.extYaw = ((225 - (RENDER_TUNE.chaseYaw || 0)) % 360 + 360) % 360; st.extPitch = 0.18; }
  return st.external ? 'ext' : 'cab';
}
/** Swing the chase camera onto a shot (camera-tween.js SHOTS). See cabFrame. */
export function boatFrame(shot, ms = 700) {
  // By name too: 'rod' is rod mode's over-the-shoulder shot, the rest are camera-tween.js's.
  if (typeof shot === 'string') shot = shot === 'rod' ? (st ? rodShot() : null) : SHOTS[shot];
  if (!st || !shot) return;
  if (!st.external) setExternal(true);
  // A hull's pitch range is lower than a truck's (the drag clamps it to 0.85), so a shot is held to it.
  tweenOrbit(st, { yaw: 'extYaw', pitch: 'extPitch', zoom: 'extZoom' },
    { yaw: shot.yaw - (RENDER_TUNE.chaseYaw || 0), pitch: Math.min(0.85, shot.pitch), zoom: shot.zoom }, ms);
}
/** A blip of throttle for the ear only. See cabRev. Nothing happens with the engine off. */
export function boatRev(amount = 0.5) {
  if (!st || !isBoatEngineRunning()) return false;
  st.revAt = performance.now(); st.revAmt = amount;
  return true;
}
function revKick(now) {
  if (!st?.revAt) return 0;
  const t = (now - st.revAt) / 1000;
  if (t > 0.9) { st.revAt = 0; return 0; }
  return (st.revAmt || 0) * (t < 0.1 ? t / 0.1 : Math.exp(-(t - 0.1) / 0.22));
}

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
    + '<canvas class="boat-lever" width="88" height="200" title="throttle, drag (W)"></canvas>'
    + '<canvas class="boat-wheel" width="200" height="200"></canvas>'
    + '<div class="boat-read"></div>'
    + '<div class="boat-keys"></div>'
    + '</div>'
    + navHomeHTML()
    // Every held control is a button as well, so a mouse or a thumb can drive the whole boat: the
    // ignition key (tap to start, tap again to stop), the tabs and the bottle.
    + '<div class="boat-panel">'
    + '<button class="boat-ign" type="button" data-pos="off" title="ignition key (K), turn to START, again to OFF">'
    + '<span class="boat-ign-face"><i>OFF</i><i>RUN</i><i>START</i></span><span class="boat-ign-key"></span><span class="boat-ign-cap">ENGINE · K</span></button>'
    + '<div class="boat-hold-row">'
    + '<button class="boat-chip boat-hold" data-key="[" type="button" title="tabs bow down (hold [)">TAB ▼</button>'
    + '<button class="boat-chip boat-hold" data-key="]" type="button" title="tabs bow up (hold ])">TAB ▲</button>'
    + '</div>'
    + '<div class="boat-hold-row">'
    + '<button class="boat-chip boat-sw" data-sw="cabin" type="button" title="cabin dome lamp (I)">CABIN</button>'
    + '<button class="boat-chip boat-sw" data-sw="wipe" type="button" title="wipers (W)">WIPE</button>'
    + '<button class="boat-chip boat-sw boat-dials" data-sw="dials" type="button" title="gauge lights (L)">☼ DIALS</button>'
    + '</div>'
    + '<button class="boat-chip boat-hold" data-key="h" type="button" title="horn (hold H)">HORN</button>'
    + '<button class="boat-chip boat-hold boat-nos" data-key="shift" type="button" title="nitrous bottle (hold Shift)">BOTTLE</button>'
    + '</div>'
    + '<div class="boat-chips">'
    // ⚠ THE IGNITION IS THE TRUCK'S KEY AND NOT A NEW ONE. `cab-view.js` binds K to
    // `toggleIgnition` and holds the starter for as long as it is down, so a driver who has
    // learned to start a rig has learned to start a boat. I was the obvious letter and is the
    // truck's DOME LIGHT — a seat that gave one letter two meanings across two vehicles is worse
    // than a seat with no key in it.
    // ⚠ AND THE CHASE CAMERA IS V/F, for the same reason and off the same pair: the cab takes both
    // because V is the cockpit's and F is what everybody's hands do anyway.
    // Beached: a held button for the R shove, shown only while she is on the sand.
    + '<button class="boat-chip boat-hold boat-push" data-key="r" type="button" hidden title="shove her back off the beach (R), shuts the lever">⇤ PUSH OFF</button>'
    // The anchor, on a hull that carries one (`rode_m`): drop it, or pull it up. B, or the cleat.
    + '<button class="boat-chip boat-anchor" type="button" hidden title="anchor: drop it or pull it up (B)">⚓ ANCHOR</button>'
    + '<button class="boat-chip boat-ext" type="button" title="external / helm view (V)">◎ EXT</button>'
    + '<button class="boat-chip boat-ride" type="button" title="helm camera motion: full / soft / steady (N), the boat still rides the full sea">RIDE FULL</button>'
    + '<button class="boat-chip boat-help-btn" type="button" title="controls (?)">?</button>'
    + '<button class="boat-chip boat-hidebtn" type="button" title="hide the text panel, keep the command bar">⊟</button>'
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
    // The berth prompt: what the marked box ahead is, and the act once she is stopped in it.
    + '<div class="boat-berth" hidden></div>'
    + '</div>';

  // ⚠ A PHONE KEEPS #area-pane COLLAPSED UNTIL AN APP SAYS IT OWNS IT, and this was the one seat
  // that never said so: dispatch.js closes the depot (which releases the pane) and then opens the
  // boat into it, so on a phone the helm mounted into a 0×0 pane and the player saw a d-pad.
  // Only when the pane is ours: a handed-in mount (free look) has already claimed it itself.
  const ownsPane = !ctx.mount;
  if (ownsPane) window.dispatchEvent(new Event('pane:claimed'));

  st = {
    ownsPane,
    p,
    // Which hull: her mesh, her pilothouse and her eye height all key off it (helm.js sends it).
    typeId: BOAT_ROWS[ctx.typeId] ? ctx.typeId : 'hydro',
    name: ctx.name || 'her',
    livery: ctx.livery || null, preview: null,
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
    homeX: ctx.gx ?? 0, homeY: ctx.gy ?? 0,    // where she was boarded: the HOME marker's target (nav-home.js)
    ox: (ctx.gx ?? 0) - RAD, oy: (ctx.gy ?? 0) - RAD,
    tiles: ctx.map || [],
    surface: 'open', aground: false, shove: 0,
    lever: 0, steer: 0, trim: 0,
    // The gauge lights' switch. Off until you turn it on; lit only while she has power.
    dials: false,
    // The rest of the switch panel (interior-hydro.js HYDRO_SWITCHES). Each one is drawn on the dash,
    // clickable there, has a key and a button, and does something: the dome lamp, the wipers and the
    // horn. The cabin lamp starts on, which is how she has always come up.
    cabin: true, wipers: 0, hornOn: false,
    // The 3-D control under the pointer and the one being pressed, for the halo (hotspotHalo).
    hover: null, press: null, holdKey: null,
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
    wxField: ctx.wxField || null, wxGround: ctx.wxGround || null,
    // Everything moving near her (aircraft, the other boats, rigs on the quay road), absolute tiles,
    // pushed once a second and dead-reckoned between (world-feed.js).
    contacts: makeContactTrack(),
    // The far view: the towers and the highway past the window and the region's colour grade.
    skyline: ctx.skyline || null, roads: ctx.roads || null, regions: ctx.regions || null,
    actors: ctx.actors || [],   // the people on the quay, in absolute tiles (street-actors.js)
    marks: ctx.marks || [],     // the fuel berths and covered slots in the window (helm.js berthMarksNear)
    berthNow: null, berthDraw: [], berthKey: '', actAt: 0,
    // The anchor point, absolute tiles, while she's lying to it (the server's: plugins/powerboat/anchor.js).
    anchored: ctx.anchored || null, anchorNag: 0,
    // The skiff's open-boat controls (interior-skiff.js): the battery lamp, the fish box lid, the
    // choke and the primer bulb's last squeeze.
    lamp: false, boxOpen: false, choke: false, primeAt: -1e9,
    // Rod mode, and what you look like on the thwart (angler.js anglerBody): the helm's push may
    // carry `look: { id, skin, hair, hairStyle }`; without it the boat's name keeps you the same man.
    rod: newRod(), rodView: null, angLook: ctx.look || { id: ctx.player || ctx.name || 'angler' },
    lastSync: 0, last: performance.now(), alive: true, raf: 0,
    onSend: ctx.onSend || null,
    onExit: ctx.onExit || (() => send('disembark')),
  };
  if (ctx.contacts) st.contacts.update(ctx.contacts);

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
  st.berthEl = root.querySelector?.('.boat-berth') || null;
  st.berthEl?.addEventListener?.('click', (e) => { if (e.target.closest?.('[data-berth-act]')) berthAct(); });
  st.svcOpen = () => !!root.querySelector?.('#mar-svc.open');
  bindBigScreenButton(root.querySelector?.('.boat-big'));
  // ⊟: the log folds away and the command bar stays. The seat opens that way, like every vehicle.
  const hideBtn = root.querySelector?.('.boat-hidebtn');
  hideBtn?.addEventListener('click', () => { hideBtn.classList.toggle('on', document.body.classList.toggle('boat-hidepanel')); });
  seatHidePanel('boat-hidepanel', hideBtn);
  root.querySelector?.('.boat-x')?.addEventListener('click', () => toggleOut());
  root.querySelectorAll?.('.boat-hold')?.forEach?.((b) => {
    const k = b.dataset.key;
    const up = () => { st?.keys?.delete(k); b.classList.remove('on'); };
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); st?.keys?.add(k); b.classList.add('on'); });
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
  });
  root.querySelectorAll?.('.boat-sw')?.forEach?.((b) => b.addEventListener('click', () => flipSwitch(b.dataset.sw)));
  root.querySelector?.('.boat-ride')?.addEventListener('click', () => cycleRide());
  root.querySelector?.('.boat-ign')?.addEventListener('click', () => {
    // ⚠ A CLICK CANNOT HOLD A STARTER, so it arms one and the frame lets go of it once she fires.
    // Without that the button starts a motor that never catches, which is the control reading as
    // broken on the one surface a touch player has.
    ignition();
    // ⚠ AND IT LETS GO ON A CLOCK RATHER THAN ON SUCCESS, because a dry motor never succeeds: the
    // model turns it over for as long as the starter is down and reports `dry`, so a release
    // waiting for her to catch would leave the starter engaged for the rest of the session.
    // ⚠ IN SIM SECONDS, NOT WALL ONES: the frame step is capped at 0.05 s, so below 20 fps the model
    // turns her over slower than the clock on the wall, and a wall-clock window ran out before she
    // caught. A click that never starts the boat on a slow machine reads as a dead button.
    if (!st.sim.running) { st.clickCrank = true; st.clickCrankLeft = CRANK_S + 0.5; }
  });
  root.querySelector?.('.boat-ext')?.addEventListener('click', () => setExternal(!st.external));
  const anchorBtn = root.querySelector?.('.boat-anchor');
  if (anchorBtn) { anchorBtn.hidden = !(Number(p.rode_m) > 0); anchorBtn.addEventListener('click', () => anchorAct()); }
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
  // A reel already open (boarded while fishing) or opened later mounts its HUD in this seat.
  if (BF) hostReel();
  else if (Number(p.rode_m) > 0) loadReel();
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
  try { BF?.detachBoatFishHost?.(); } catch { /* the reel keeps its own overlay */ }
  stopBoatEngine(true);
  stopBoatContacts();
  stopBoatWater();
  airHornOff();
  // ⚠ THE MODE OWNS THE PAGE, so nothing else takes it down with the view — climbing out in big
  // screen would otherwise strand the player with no sidebar, no log and no command box, and the
  // one key that would fix it is bound only while the mode thinks it is on.
  exitBigScreen();
  document.body.classList.remove('boat-hidepanel');
  disposeWindshield(ID);
  endSeatKeyboard(st.pane);
  if (st.ownsPane) window.dispatchEvent(new Event('pane:released'));  // hand the pane back to the phone layout
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
    // ⚠ IN ROD MODE THE REEL HEARS EVERY KEY FIRST, and the seat acts only on what it leaves: a twitch,
    // a knock and the fight's lean are the reel's; the aim, the cast's charge and R are the seat's.
    if (rodOn() && reelOpen()) {
      let took = false;
      try { took = !!BF.boatFishKey(e, true); } catch { took = false; }
      if (took) { e.preventDefault(); return; }
      if (rodKey(e, k, true)) { e.preventDefault(); return; }
    }
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
    if (k === 'n' && !e.repeat) { e.preventDefault(); cycleRide(); return; }
    if (!e.repeat) {
      if (k === 'v' || k === 'f') { e.preventDefault(); setExternal(!st.external); return; }
      if (k === '?' || k === '/') { e.preventDefault(); toggleHelp(); return; }
      if (k === 'l') { e.preventDefault(); flipSwitch('dials'); return; }
      if (k === 'i') { e.preventDefault(); flipSwitch('cabin'); return; }
      if (k === 'w') { e.preventDefault(); flipSwitch('wipe'); return; }
      if (k === 'g') { e.preventDefault(); flipSwitch('stab'); return; }
      // The marked berth's act: fill her at the pumps, or dock her under the roof. P is the cab's
      // park key, and tying up is what a boat does instead of parking.
      if (k === 'p') { e.preventDefault(); berthAct(); return; }
      // The anchor. ⚠ B, NOT A: A is the throttle in every seat, and every other letter here is bound.
      if (k === 'b') { e.preventDefault(); anchorAct(); return; }
      // The rod. ⚠ ON THE SAND R IS STILL THE SHOVE, and you can't be anchored there anyway.
      if (k === 'r' && !st.sim.beached) { e.preventDefault(); toggleRod(); return; }
      // The shoulder-checks, and they are the cab's three letters. ⚠ SNAP AND LATCH rather than
      // held: a boat is steered with two hands and there is no third one to hold a look key with.
      // Q / E / S are HELD shoulder-checks, the cab's and the cockpit's own three keys.
      if (k === 'q' || k === 'e' || k === 's') { st.look.yaw = k === 'q' ? -90 : k === 'e' ? 90 : LOOK_YAW; st.look.pitch = 0; st.look.held = k; e.preventDefault(); return; }
      // ⚠ ASTERN IS AS FAR AS THE PAINTED WORLD GOES, NOT 180°. `LOOK_YAW` is the limit this seat
      // and the cab share, and a snap past it would put your head somewhere the renderer has
      // nothing to show you — so S is "as far round as you can get", and pressing it again brings
      // you back rather than winding on for ever.
    }
    if (k.startsWith('arrow') || k === ' ') e.preventDefault();
    st.keys.add(k === 'shift' ? 'shift' : k);
  };
  st.ku = (e) => {
    if (!st) return;
    const k = e.key.toLowerCase();
    if (st.rod) {
      st.rod.keys.delete(k);
      if (rodOn() && reelOpen()) {
        let took = false;
        try { took = !!BF.boatFishKey(e, false); } catch { took = false; }
        if (!took && k === ' ' && st.rod.charging) castNow(performance.now());
        if (took || k === ' ') { st.keys.delete(k); return; }
      }
    }
    if (k === 'k') st.starter = false;
    if (st.look.held === k) { st.look.yaw = 0; st.look.pitch = 0; st.look.held = null; }
    st.keys.delete(k);
  };
  window.addEventListener('keydown', st.kd, true);
  window.addEventListener('keyup', st.ku, true);

  const glass = document.getElementById(ID);
  if (!glass || !glass.addEventListener) return;
  glass.addEventListener('contextmenu', (e) => e.preventDefault());
  // ── THE 3-D CONTROLS ───────────────────────────────────────────────────────
  // The renderer leaves where each switch landed on screen (interiorHotspots, off the profile's own
  // hotspots(live)); a left press on one is taken here before the look drag can have it. 'click'
  // acts once, 'hold' holds its key for as long as the button is down — the same key the keyboard
  // and the on-screen buttons hold, so all three are one control.
  const hotAt = (e) => {
    if (!st || st.external) return null;
    const hs = interiorHotspots();
    if (!hs || !hs.list?.length) return null;
    const r = glass.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const x = (e.clientX - r.left) * (hs.W / r.width), y = (e.clientY - r.top) * (hs.H / r.height);
    let best = null, bd = Infinity;
    for (const h of hs.list) { const d = Math.hypot(x - h.x, y - h.y); if (d <= h.r && d < bd) { bd = d; best = h; } }
    return best;
  };
  glass.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !st) return;
    const h = hotAt(e);
    if (!h) return;
    e.preventDefault(); e.stopImmediatePropagation();
    st.press = h.id;
    if (h.kind === 'hold') {
      st.holdKey = HOLD_KEY[h.id] || null;
      if (st.holdKey) st.keys.add(st.holdKey);
      glass.setPointerCapture?.(e.pointerId);
    } else pressControl(h.id);
  }, true);
  const release = () => {
    if (!st) return;
    if (st.holdKey) st.keys.delete(st.holdKey);
    st.holdKey = null; st.press = null;
  };
  glass.addEventListener('pointerup', release);
  glass.addEventListener('pointercancel', release);
  glass.addEventListener('pointermove', (e) => {
    if (!st || st.look.on) return;
    const h = hotAt(e);
    st.hover = h ? h.id : null;
    glass.style.cursor = h ? 'pointer' : '';
    glass.title = h ? (CONTROL_TIP[h.id] || '') : '';
  });
  glass.addEventListener('pointerleave', () => { if (st) st.hover = null; });
  // The middle button's default is the browser's autoscroll, which would steal the drag.
  glass.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  glass.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
  glass.addEventListener('pointerdown', (e) => {
    // ⚠ MIDDLE OR RIGHT BUTTON. The middle is the free camera's own orbit button everywhere else in
    // GLASS, so it looks round the pilothouse inside and swings round the hull outside; the right
    // button stays as the alias this seat shipped with.
    // In rod mode the left button aims too (a press on a 3-D control is taken first, above).
    if ((e.button !== 1 && e.button !== 2 && !(e.button === 0 && rodOn())) || !st) return;
    e.preventDefault();
    st.look.on = true; st.look.px = e.clientX; st.look.py = e.clientY;
    glass.setPointerCapture?.(e.pointerId);
  });
  glass.addEventListener('pointermove', (e) => {
    if (!st?.look.on) return;
    const dx = e.clientX - st.look.px, dy = e.clientY - st.look.py;
    st.look.px = e.clientX; st.look.py = e.clientY;
    lookBy(dx, dy);
  });
  // A finger can't press the middle button, so on a phone one finger is the same drag and two pinch
  // the dolly. A finger on a hotspot is the hotspot's (the capture handler above takes it first).
  bindTouchGestures(glass, {
    enabled: (e) => !!st && !hotAt(e),
    drag: (dx, dy) => { if (st) lookBy(dx, dy); },
    pinch: (f) => { if (st?.external) dollyTo(st.extZoom / f); },
  });
  function lookBy(dx, dy) {
    // ⚠ IN ROD MODE THE DRAG IS THE AIM, in both views, and it is RELATIVE: the bearing moves by how
    // far you drag and stays where you leave it. The look and the chase camera follow the aim.
    if (rodOn()) {
      const ph = BF?.boatFishState?.()?.phase;
      if (ph === 'ready' && !st.rod.cast) st.rod.bearing = clamp(st.rod.bearing + dx * AIM_DRAG, -AIM_MAX, AIM_MAX);
      return;
    }
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
  }
  function dollyTo(z) {
    // in as far as the renderer's standoff, where the hull fills the frame (the seat hands over 1.15 x this)
    const lv = lastViewState(), lo = lv && lv.external && lv.chaseZoomFloor > 0 ? lv.chaseZoomFloor / 1.15 : 0.55;
    st.extZoom = clamp(z, lo, 3.2);
  }
  // The dolly. ⚠ IT ONLY MEANS ANYTHING OUTSIDE — behind the glass there is nothing to back away
  // from, and a wheel that silently did nothing in one of two views is a control you stop trusting.
  glass.addEventListener('wheel', (e) => {
    if (!st?.external) return;
    e.preventDefault();
    dollyTo(st.extZoom * (e.deltaY > 0 ? 1.12 : 0.89));
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
// Ride comfort for the helm camera: full motion, softened, or steadied. Per-viewer, so browser
// storage is the right home; it can come back empty and must never throw.
const RIDE = [{ id: 'full', k: 1, label: 'RIDE FULL' }, { id: 'soft', k: 0.5, label: 'RIDE SOFT' }, { id: 'steady', k: 0.2, label: 'RIDE STEADY' }];
let rideIdx = (() => { try { const i = RIDE.findIndex((r) => r.id === localStorage.getItem('boat_ride')); return i < 0 ? 0 : i; } catch { return 0; } })();
function rideK() { return st.external ? 1 : RIDE[rideIdx].k; }
function cycleRide() {
  rideIdx = (rideIdx + 1) % RIDE.length;
  try { localStorage.setItem('boat_ride', RIDE[rideIdx].id); } catch {}
}

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

// ── THE SWITCHES ─────────────────────────────────────────────────────────────
// One place that knows what each switch on the dash does, used by the keys, the buttons and a click
// on the dash itself.
const HOLD_KEY = { horn: 'h', arm: 'shift', tabUp: ']', tabDown: '[', fast: 'a', slow: 'z' };
const CONTROL_TIP = {
  cabin: 'CABIN: dome lamp (I)', wipe: 'WIPE: wipers (W)', horn: 'HORN: hold (H)', dials: 'DIALS: gauge lights (L)',
  arm: 'ARM: nitrous bottle, hold (Shift)', tabUp: 'TABS: bow up, hold (])', tabDown: 'TABS: bow down, hold ([)',
  stab: 'STAB: gyro stabiliser (G), needs the engine running',
  ign: 'IGN: ignition key (K)', kill: 'KILL: stop the engine',
  // The skiff's open-boat controls (client/shared/interior-skiff.js).
  fast: 'FAST: twist the grip open, hold (A)', slow: 'SLOW: twist the grip shut, hold (Z)',
  choke: 'CHOKE: pull it for a cold start', prime: 'PRIME: squeeze the fuel bulb',
  cleat: 'CLEAT: the anchor, drop it or pull it up (B)', lamp: 'LAMP: the battery lamp on its pole',
  box: 'BOX: the fish box lid', rod: 'ROD: fish from her, at anchor (R)',
};
function switchState(id) {
  if (!st) return false;
  return id === 'cabin' ? !!st.cabin : id === 'wipe' ? st.wipers > 0 : id === 'dials' ? !!st.dials : false;
}
function flipSwitch(id) {
  if (!st) return;
  if (id === 'cabin') st.cabin = !st.cabin;
  else if (id === 'wipe') st.wipers = st.wipers ? 0 : 2;
  else if (id === 'dials') st.dials = !st.dials;
  else if (id === 'stab') st.stab = !st.stab;
  else if (id === 'lamp') st.lamp = !st.lamp;
  else if (id === 'box') st.boxOpen = !st.boxOpen;
  else if (id === 'choke') st.choke = !st.choke;
  // The primer bulb: a squeeze, which springs back over half a second (primeLevel).
  else if (id === 'prime') st.primeAt = performance.now();
}
const PRIME_MS = 500;
function primeLevel() {
  const t = (performance.now() - (st?.primeAt || -1e9)) / PRIME_MS;
  return t < 0 || t >= 1 ? 0 : t < 0.25 ? t / 0.25 : 1 - (t - 0.25) / 0.75;
}
function pressControl(id) {
  if (!st) return;
  if (id === 'ign') {
    // The key on the dash is the same key as the chip: see the click handler at the mount.
    ignition();
    if (!st.sim.running) { st.clickCrank = true; st.clickCrankLeft = CRANK_S + 0.5; }
  } else if (id === 'kill') { if (st.sim.running) ignition(); }
  else if (id === 'cleat') anchorAct();
  else if (id === 'rod') toggleRod();
  else flipSwitch(id);
}

// ── THE ANCHOR ───────────────────────────────────────────────────────────────
// ⚠ THE SEAT ASKS AND THE SERVER DECIDES. `boat anchor` checks the speed, the berth, the rode and the
// bottom (plugins/powerboat/anchor.js) and pushes the point back as `anchored`; nothing here sets it.
function anchorAct() {
  if (!st || !(Number(st.p.rode_m) > 0)) return;
  send(st.anchored ? 'boat anchor up' : 'boat anchor');
}

// At anchor she lies downwind of the point on the swing circle and turns her bow to the wind. Eased,
// so dropping the anchor or adopting one on boarding never jumps her. The window-relative frame is
// the sim's: the point is absolute, so the window centre comes off it.
function holdAtAnchor(dt) {
  const a = st.anchored;
  const ax = a.x - st.cx, ay = a.y - st.cy;
  // The renderer's own wind (windshield.js windFromView): the field's direction, else the hour's.
  const dir = st.wxField?.wind?.dir ?? ((((st.hour || 12) * 17 + 40) % 360 + 360) % 360);
  const r = dir * Math.PI / 180, lie = SWING_R * LIE_FRAC;
  const k = 1 - Math.exp(-dt / 6);
  st.sim.x += (ax + Math.sin(r) * lie - st.sim.x) * k;
  st.sim.y += (ay - Math.cos(r) * lie - st.sim.y) * k;
  ({ x: st.sim.x, y: st.sim.y } = clampToSwing(st.sim.x, st.sim.y, { x: ax, y: ay }));
  st.sim.speed = 0; st.sim.drift = 0;
  // Bow upwind, with a slow sheer either side of it the way a boat at anchor never quite settles.
  const want = dir + 180 + Math.sin(performance.now() / 9000) * 8;
  const err = ((want - st.sim.heading) % 360 + 540) % 360 - 180;
  st.sim.heading = ((st.sim.heading + err * (1 - Math.exp(-dt / 10))) % 360 + 360) % 360;
}

// ── ROD MODE (docs/proposals/boat-fishing.md §5, §5b) ────────────────────────
//
// R, or the rod holder, sends `fish`; the server opens the reel (boatfish.js) and while it's open
// this seat is in rod mode: the throttle is dead, the drag and the arrows aim, Space charges the
// range and its release casts. Every key goes to the reel first (boatFishKey) and the seat acts only
// on what it leaves. The seat owns the aim, the landing ring and what's drawn (glass/rod-rig.js): the
// angler's clips (angler.js), the lure's flight, the splash, the fish coming aboard.
//
// ⚠ BOTH MODULES ARE FETCHED, NEVER IMPORTED. boatfish.js imports net.js, which a headless gate can't
// load, and angler.js brings the two-megabyte clip library; a seat that never fishes loads neither.
let BF = null, bfP = null, ANG = null, angP = null;
const loadReel = () => bfP || (bfP = import('./boatfish.js').then((m) => { BF = m; if (st) hostReel(); return m; }).catch(() => null));
const loadAngler = () => angP || (angP = import('./angler.js').then((m) => { ANG = m; return m; }).catch(() => null));
function hostReel() { try { BF?.attachBoatFishHost?.(st.root); } catch { /* the HUD falls back to its own overlay */ } }
const reelOpen = () => { try { return !!(BF && BF.boatFishActive()); } catch { return false; } };
function rodOn() { return !!(st && st.rod && st.rod.on); }
// A cue from the reel's set (sfx-catalog.js), by name; silent with no audio engine.
function cue(id) { try { const d = window.SFXCatalog?.get?.(id); if (d) window.AudioEngine?.playSfx?.(d); } catch { /* no audio */ } }

const AIM_RATE = 70;       // degrees a second, held key or full stick
const AIM_DRAG = 0.25;     // degrees a pixel of drag
const AIM_MAX = 150;       // off the bow either way: past it you'd be casting over the outboard
const CHARGE_MS = 1400;    // the range meter, short to long, as the reel's own
const SPLASH_S = 1.6, LAND_S = 1.8;

function newRod() {
  return { on: false, want: false, wantAt: 0, nag: 0, bearing: 0, keys: new Set(), charging: false, chargeAt: 0, range: CAST_MIN_M,
    anim: null, phase: null, castAt: 0, snapAt: 0, cast: null, fly: null, splash: null, lure: null, fish: null,
    lastLine: 0, lastBeat: 0, camAt: 0 };
}
function toggleRod() {
  if (!st) return;
  const R = st.rod;
  if (R.on || reelOpen()) { send('stand'); R.want = false; leaveRod(); return; }
  if (!st.anchored) { R.nag = performance.now(); return; }
  R.want = true; R.wantAt = performance.now();
  loadReel(); loadAngler();
  send('fish');
}
function enterRod(now) {
  const R = st.rod;
  R.on = true; R.want = false; R.charging = false; R.cast = null; R.fly = null; R.lure = null; R.fish = null; R.splash = null;
  R.anim = ANG ? ANG.newAnim(now) : null;
  hostReel();
  if (st.external) { boatFrame('rod', 750); R.camAt = now + 800; }
}
function leaveRod() {
  const R = st.rod;
  R.on = false; R.anim = null; R.charging = false; R.keys.clear();
  st.rodView = null;
  st.look.yaw = 0; st.look.pitch = 0;
}
// The over-the-shoulder shot: from behind you along the way you're aiming, a little to your right, in
// as close as the orbit goes (the chase view draws her at a fifth of her size, see drawnRide).
function rodShot() { return { yaw: (st?.rod?.bearing || 0) - 10, pitch: 0.16, zoom: 0.12 }; }

// A rod key, in rod mode: the aim's arrows and A/D, and Space, which charges and casts while the reel
// is ready and is the reel's own after that. Returns true when the seat used it.
function rodKey(e, k, down) {
  const R = st.rod;
  if (k === 'arrowleft' || k === 'arrowright' || k === 'a' || k === 'd') {
    if (down) R.keys.add(k); else R.keys.delete(k);
    return true;
  }
  if (k === ' ') {
    const ph = BF?.boatFishState?.()?.phase;
    if (down && !e.repeat && ph === 'ready' && !R.charging && !R.cast) { R.charging = true; R.chargeAt = performance.now(); cue('fishing-charge'); }
    else if (!down && R.charging) castNow(performance.now());
    return true;
  }
  return false;
}

function chargeRange(now, castM) {
  const p = ((now - st.rod.chargeAt) / CHARGE_MS) % 2;
  return CAST_MIN_M + (castM - CAST_MIN_M) * (p < 1 ? p : 2 - p);
}
function castNow(now) {
  const R = st.rod, S = BF?.boatFishState?.();
  R.charging = false;
  const ok = !!(S && BF.boatFishCast(R.bearing, R.range));
  if (R.anim && ANG) {
    if (R.anim.id !== 'fish_cast') ANG.play(R.anim, 'fish_cast', now);
    ANG.release(R.anim, now);
  }
  if (!ok) { R.cast = null; return; }
  // The lure goes at the clip's snap; the server says where it landed while it's in the air.
  const snap = R.anim && ANG ? R.anim.t0 + ANG.CAST_SNAP_S * 1000 : now + 120;
  R.cast = { at: now, snapAt: Math.max(now, snap), bearing: R.bearing, range: R.range };
  R.lure = null; R.fish = null;
}

// Where a cast of `range` metres at `bearing` off the bow lands from the anchor point (the server's
// arithmetic, plugins/fishing/boat.js): absolute tiles in the boat's convention.
function aimPoint(S, bearing, range) {
  const a = st.anchored || { x: st.cx + st.sim.x, y: st.cy + st.sim.y };
  const ax = Number.isFinite(S?.ax) && S.ax ? S.ax : a.x, ay = Number.isFinite(S?.ay) && S.ay ? S.ay : a.y;
  const w = (st.sim.heading + bearing) * Math.PI / 180, d = range / SEA_TILE_M;
  return { x: ax + Math.sin(w) * d, y: ay - Math.cos(w) * d, ax, ay };
}
// The sea's height at an absolute point: the frame the renderer draws it in is the map window's.
function seaAt(x, y) {
  try { return seaHeight(x - st.cx, y - st.cy, seaClock(Date.now()), st.sim.seaRoll || 0, st.sim.seaChopH || 0, st.sim.seaWind || 0); }
  catch { return 0; }
}

function stepRod(dt, now) {
  const R = st.rod;
  const open = reelOpen();
  if (open && !R.on) enterRod(now);
  else if (!open && R.on) leaveRod();
  if (R.want && !open && now - R.wantAt > 5000) R.want = false;   // refused: the server said why in the log
  if (!R.on) { st.rodView = null; return; }
  if (!R.anim && ANG) R.anim = ANG.newAnim(now);
  const S = BF.boatFishState() || {};
  const ph = S.phase, A = R.anim;
  const castM = Number(S.castM) > 0 ? S.castM : 25;

  // ── the aim: keys and a stick swing it at a rate; the drag (lookBy) by how far you move ──
  if (ph === 'ready' && !R.cast) {
    let rate = (R.keys.has('arrowright') || R.keys.has('d') ? 1 : 0) - (R.keys.has('arrowleft') || R.keys.has('a') ? 1 : 0);
    try {
      for (const gp of navigator.getGamepads?.() || []) {
        const x = gp?.axes?.[0] || 0;
        if (Math.abs(x) > 0.15) { rate += Math.sign(x) * (Math.abs(x) - 0.15) / 0.85; break; }
      }
    } catch { /* no gamepads */ }
    R.bearing = clamp(R.bearing + rate * AIM_RATE * dt, -AIM_MAX, AIM_MAX);
  }
  if (R.charging) R.range = chargeRange(now, castM);

  // ── the clips ─────────────────────────────────────────────────────────────────────────────
  const facing = Math.cos(R.bearing * Math.PI / 180) >= 0 ? 1 : -1;   // port is his left facing forward
  if (A && ANG) {
    const t = ANG.clipTime(A, now), ended = !ANG.clipLoops(A.id) && t >= ANG.clipDuration(A.id);
    if (R.charging) {
      if (A.id !== 'fish_cast') ANG.play(A, 'fish_cast', now);
      else if (A.hold == null && t >= ANG.CAST_LOAD_S) ANG.holdAt(A, ANG.CAST_LOAD_S, now);
    } else if (ph === 'fight') {
      if (A.id !== 'fight' && (A.id !== 'fish_strike' || ended)) ANG.play(A, 'fight', now, { mixMs: 300 });
      A.lean = (S.lean || 0) * facing;
    } else if (ph === 'reeling') {
      if (A.id !== 'fish_reel') ANG.play(A, 'fish_reel', now, { mixMs: 300 });
    } else if (ph === 'bite') {
      const bi = S.beat ? S.beat.i : 0;
      if (bi > R.lastBeat) ANG.play(A, 'fish_strike', now, { mixMs: 80 });
      R.lastBeat = bi;
    } else if (ph === 'wait') {
      if (S.lineM < R.lastLine - 0.4 && A.id !== 'fish_cast') ANG.play(A, 'fish_twitch', now, { mixMs: 90 });
      else if (ended) ANG.play(A, 'fish_sit', now, { mixMs: 300 });
    } else if (A.id === 'fight' || A.id === 'fish_reel' || ended) {
      if (A.id !== 'fish_sit') ANG.play(A, 'fish_sit', now, { mixMs: 350 });
    }
    if (ph !== 'bite') R.lastBeat = 0;
  }
  R.lastLine = S.lineM || 0;

  // ── the cast: the lure leaves at the snap and flies to where the server says it landed ─────
  if (R.cast && now >= R.cast.snapAt && !R.fly) {
    const p = aimPoint(S, R.cast.bearing, R.cast.range);
    R.fly = { t0: now, dur: 0.55 + R.cast.range / 38, px: p.x, py: p.y };
    cue('boatfish-cast');
  }
  if (R.fly) {
    const has = S.lx != null && S.ly != null;
    const x = has ? S.lx : R.fly.px, y = has ? S.ly : R.fly.py;
    const s = (now - R.fly.t0) / 1000 / R.fly.dur;
    if (s >= 1) {
      R.splash = { x, y, z: seaAt(x, y), t0: now };
      R.lure = { x, y };
      R.fly = null; R.cast = null;
      cue('boatfish-plop');
    } else R.flyView = { s, x, y, z: seaAt(x, y), apex: (R.cast?.range || 15) / SEA_TILE_M * 0.11 };
  }
  if (R.cast && !R.fly && ph !== 'flight' && ph !== 'ready' && now > R.cast.snapAt + 3000) R.cast = null;
  if (R.splash && (now - R.splash.t0) / 1000 > SPLASH_S) R.splash = null;

  // ── the lure in the water: along the line from the anchor, as much line as is out ─────────
  const inWater = ph === 'wait' || ph === 'bite' || ph === 'fight' || ph === 'reeling';
  if (!R.fly && inWater && S.lx != null) {
    const a = aimPoint(S, 0, 0);
    let dx = S.lx - a.ax, dy = S.ly - a.ay;
    const d = Math.hypot(dx, dy) || 1e-6;
    // In the fight the fish takes the line off to the side it's running.
    const sw = ph === 'fight' ? (S.pull || 0) * 0.45 : 0;
    const c = Math.cos(sw), s = Math.sin(sw);
    [dx, dy] = [(dx * c - dy * s) / d, (dx * s + dy * c) / d];
    const out = Math.min((S.lineM || 0) / SEA_TILE_M, ph === 'fight' ? Infinity : d);
    const tx = a.ax + dx * out, ty = a.ay + dy * out;
    if (!R.lure) R.lure = { x: tx, y: ty };
    const k = 1 - Math.exp(-dt / 0.18);
    R.lure.x += (tx - R.lure.x) * k; R.lure.y += (ty - R.lure.y) * k;
  } else if (!R.fly && !inWater && ph !== 'landed') R.lure = null;

  // ── landed: up out of the water on the line and over the gunwale into the box ─────────────
  if (ph === 'landed' && !R.fish && R.lure) {
    R.fish = { t0: now, kg: S.catch?.kg || 1, x: R.lure.x, y: R.lure.y };
    if (A && ANG) ANG.play(A, 'fish_strike', now, { mixMs: 120 });
  }
  if (R.fish && (now - R.fish.t0) / 1000 > LAND_S) { R.fish = null; R.lure = null; }

  // ── the float knocks on a bite ────────────────────────────────────────────────────────────
  let dip = 0;
  if (ph === 'bite' && S.beat && S.beat.nextAtServerMs != null) {
    try { const d = Math.abs(BF.serverNow() - S.beat.nextAtServerMs); if (d < 160) dip = 0.005 * (1 - d / 160); } catch { /* no clock */ }
  }

  // ── the cameras ───────────────────────────────────────────────────────────────────────────
  if (!st.external) {
    // From the seat you look where you're aiming, down at the water over the rod tip.
    const k = 1 - Math.exp(-dt / 0.25);
    st.look.yaw += (clamp(R.bearing, -LOOK_YAW, LOOK_YAW) - st.look.yaw) * k;
    st.look.pitch += (-9 - st.look.pitch) * k;
  } else if (now > R.camAt && !st.look.on) {
    const want = rodShot().yaw - (RENDER_TUNE.chaseYaw || 0);
    const err = ((want - st.extYaw) % 360 + 540) % 360 - 180;
    st.extYaw = ((st.extYaw + err * (1 - Math.exp(-dt / 0.6))) % 360 + 360) % 360;
  }

  // ── the ring: where it'll land, wobbling less the better you are ──────────────────────────
  let ring = null;
  if (ph === 'ready' && !R.cast) {
    const skill = clamp((Number(S.skill) || 4) / 10, 0, 1), wob = (1 - skill) * 2.2 + 0.35;
    const p = aimPoint(S, R.bearing, R.charging ? R.range : Math.max(R.range, CAST_MIN_M));
    const j = wob / SEA_TILE_M;
    ring = { x: p.x + Math.sin(now / 430) * j * 0.6 + Math.sin(now / 977) * j * 0.4, y: p.y + Math.cos(now / 610) * j * 0.6 + Math.cos(now / 1310) * j * 0.4,
      r: (0.9 + wob * 0.4) / SEA_TILE_M, a: R.charging ? 0.95 : 0.45 };
  }

  const tension = ph === 'fight' ? (S.tension || 0) : ph === 'reeling' ? 0.6 : ph === 'bite' ? 0.35 : ph === 'wait' ? 0.12 : 0;
  st.rodView = {
    typeId: st.typeId, bearing: R.bearing, anim: A, look: st.angLook,
    ring,
    fly: R.fly ? R.flyView : null,
    lure: !R.fly && R.lure && !R.fish ? { x: R.lure.x, y: R.lure.y, z: seaAt(R.lure.x, R.lure.y) + 0.002, dip } : null,
    splash: R.splash ? { x: R.splash.x, y: R.splash.y, z: R.splash.z, age: (now - R.splash.t0) / 1000 } : null,
    fish: R.fish ? { s: (now - R.fish.t0) / 1000 / LAND_S, kg: R.fish.kg, x: R.fish.x, y: R.fish.y, z: seaAt(R.fish.x, R.fish.y) } : null,
    tension, bend: ph === 'fight' ? 0.15 + 0.85 * tension : tension * 0.5, pull: ph === 'fight' ? (S.pull || 0) * facing : 0,
  };
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
    + '<dt>K</dt><dd>ignition: hold to crank her, press again to shut down. She will not start with the lever open.</dd>'
    + '<dt>N</dt><dd>ride comfort: full, soft or steady helm camera motion. The boat still rides the full sea.</dd>'
    + '<dt>A / Z</dt><dd>throttle up / down, as in the flight sim. It is a lever and stays where you leave it. You can also drag it.</dd>'
    + '<dt>X / C</dt><dd>steer (or the arrows). She has no rudder at rest: you point her by moving her.</dd>'
    + '<dt>R (beached)</dt><dd>shut the lever and shove her back off the sand.</dd>'
    + '<dt>L</dt><dd>gauge lights. They need power, so they only come up with the engine running.</dd>'
    + '<dt>I / W / H</dt><dd>cabin lamp, wipers, horn (held). Every switch on the dash is clickable too.</dd>'
    + '<dt>G</dt><dd>gyro stabiliser. Takes most of the roll and pitch out of the swell while the engine runs.</dd>'
    + '<dt>[ / ]</dt><dd>trim tabs. Bow down holds on; bow up is speed on a boat barely in the water.</dd>'
    + '<dt>SHIFT</dt><dd>the bottle. It costs hull, not fuel.</dd>'
    + '<dt>V</dt><dd>external view. Middle-drag to swing round her, wheel to back off.</dd>'
    + '<dt>Q / E / S</dt><dd>hold to look port, starboard, astern. Middle-drag looks anywhere.</dd>'
    + '<dt>P</dt><dd>at a marked berth, stopped inside the box: fill her at the fuel pumps, or dock her under the marina roof.</dd>'
    + (Number(st.p.rode_m) > 0 ? '<dt>B</dt><dd>the anchor. Stopped, off the berths, in water the rope reaches. It cuts the engine; B again pulls it up.</dd>'
      + '<dt>R (at anchor)</dt><dd>the rod. Drag or the arrows aim, hold Space and let go to cast, Space twitches and strikes, the arrows lean in the fight. R again stows it.</dd>' : '')
    + '<dt>ESC</dt><dd>step off: alongside to moor her, or over the side into the water.</dd>'
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
        ? 'Alongside a berth you will tie her up and step onto it. Anywhere else you go into the water and she floats where you left her, with the engine still running.'
        : 'Alongside a berth you will tie her up and step onto it. Anywhere else you go into the water and she floats where you left her.';
  }
}

// ── THE BERTHS ON THE WATER ──────────────────────────────────────────────────
//
// The server sends the fuel berths and covered slots in the window (helm.js `berthMarksNear`), each
// a box in world tiles. Near one, the seat marks the box on the water (glass/berth-marks.js) and
// puts a line on the glass saying what it is; stopped inside it, the line carries the act, which is
// a button and P: fill her at the pumps, or dock her under the roof.
//
// ⚠ THE SEAT DECIDES NOTHING. The act is the typed verb (`fuel`, and `disembark`, which in the slot
// is the slings lifting her into the hall), and the server's own tests are the box or larger, so a
// box shown green is one the server accepts. "Stopped" here is under the server's 2 mph after its
// rounding, for the same reason.
const MARK_NEAR = 4.5;     // tiles from the box's centre: the box fades in from here
const MARK_STOP = 1.4;     // mph
const ACT_GAP_MS = 1500;   // one act per press, however long the key is held or the button mashed

function markLocal(m, x, y) {
  const h = (m.hdg || 0) * Math.PI / 180, dx = x - m.x, dy = y - m.y;
  return { along: dx * Math.sin(h) - dy * Math.cos(h), across: dx * Math.cos(h) + dy * Math.sin(h) };
}

function updateBerth() {
  const x = st.cx + st.sim.x, y = st.cy + st.sim.y;
  const stopped = Math.abs(st.sim.speed) < MARK_STOP && !st.sim.airborne;
  let best = null;
  const draw = [];
  for (const m of st.marks || []) {
    const d = Math.hypot(m.x - x, m.y - y);
    if (d > MARK_NEAR) continue;
    const l = markLocal(m, x, y);
    const inside = Math.abs(l.along) <= m.hl && Math.abs(l.across) <= m.hw;
    const state = inside ? (stopped ? 'ready' : 'in') : 'near';
    draw.push({ kind: m.kind, x: m.x, y: m.y, hdg: m.hdg, hl: m.hl, hw: m.hw, state, fade: clamp((MARK_NEAR - d) / 1.2, 0, 1) });
    // The one the prompt is about: the box she is in, else the nearest.
    if (!best || (inside && !best.inside) || (inside === best.inside && d < best.d)) best = { m, d, inside, state };
  }
  st.berthDraw = draw;
  st.berthNow = best;
  drawBerthPrompt();
}

// What the line on the glass says. Rebuilt only when it would read differently, so the button
// under a finger is not replaced sixty times a second.
function drawBerthPrompt() {
  const el = st.berthEl;
  if (!el) return;
  // ⚠ NOT UNDER THE MARINA'S OWN OVERLAY. Open, it carries the same act as a button (marina-panel.js
  // service mode) and covers this corner of the glass; P still works while it is up.
  const b = st.svcOpen?.() ? null : st.berthNow;
  const full = st.fuel >= 0.99;
  const key = !b ? '' : `${b.m.id}|${b.m.kind}|${b.state}|${full ? 1 : 0}|${b.m.kind === 'fuel' && b.state === 'ready' ? Math.round(st.fuel * 100) : ''}`;
  if (key === st.berthKey) return;
  st.berthKey = key;
  if (!b) { el.hidden = true; el.innerHTML = ''; return; }
  const fuel = b.m.kind === 'fuel';
  const head = fuel ? '⛽ FUEL BERTH' : '⚓ COVERED DOCK';
  const say = b.state === 'near'
    ? (fuel ? 'Lie her alongside the pumps, inside the box.' : 'Bring her into the slot under the roof, inside the box.')
    : b.state === 'in'
      ? 'In the box. Take the way off her.'
      : fuel
        ? (full ? 'She is full.' : `At the pumps. Fuel ${Math.round(st.fuel * 100)}%.`)
        : 'Under cover. The slings can take her.';
  const act = b.state !== 'ready' || (fuel && full) ? ''
    : `<button class="boat-chip boat-berth-go" type="button" data-berth-act="1">${fuel ? 'Fill her' : 'Dock her'} <b>P</b></button>`;
  el.className = `boat-berth ${fuel ? 'fuel' : 'dock'} ${b.state}`;
  el.innerHTML = `<span class="boat-berth-head">${head}</span><span class="boat-berth-say">${say}</span>${act}`;
  el.hidden = false;
}

function berthAct() {
  const b = st?.berthNow;
  if (!b || b.state !== 'ready') return;
  const now = performance.now();
  if (now - st.actAt < ACT_GAP_MS) return;
  st.actAt = now;
  if (b.m.kind === 'fuel') { if (st.fuel < 0.99) send('fuel'); }
  // Docking IS stepping off in the slot: the server lifts her into the hall and the seat closes.
  else if (b.m.kind === 'dock') st.onExit();
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
  // The horn follows whatever is holding it: the H key, the HORN button or the button on the dash.
  if (st && st.alive !== false) {
    const want = st.keys.has('h');
    if (want !== st.hornOn) { st.hornOn = want; if (want) airHornOn('hauler'); else airHornOff(); }
  }
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
    // `burn` is the hull's thirst against the Rooster's (flight-model.js); absent is 1. The text
    // rung multiplies by the same field, or one boat would have two ranges.
    if (st.fuel <= 0) { st.lever = 0; input.throttle = 0; }
    else if (st.sim.running) st.fuel = Math.max(0, st.fuel - (0.00042 + 0.0035 * st.sim.pedal) * (st.p.burn ?? 1) * dt);

    // ⚠ THE SEA SHE RIDES IS THE SEA THE RENDERER DRAWS: its amplitudes, its clock and its frame.
    // None of the three was ever handed over, so `boatSeaPose` returned zero on every frame — no
    // heave, no pitch, no roll, and no face to be thrown off, which is why she never caught air.
    // ⚠ AND THE FRAME IS THE MAP WINDOW'S, NOT THE WORLD'S. The floor and the mesh sample the sea at
    // window-relative positions (gl/water.js `uA + aOff`, no window centre added), so `ssx`/`ssy`
    // stay 0. She used to add the window centre, which put her on a stretch of sea nobody draws: in
    // phase with the picture by luck, and under a crest about half the time.
    const amps = seaAmpsNow();
    // ⚠ AND THE REST OF WHAT THE MESH DOES TO THE SEA: it grows and breaks in shallow water, it is
    // smaller in the lee of land, and round the eye it carries the chop as geometry. Given only the
    // first, she rode the open swell inside every harbour and sat under the drawn crests.
    const gain = hullSeaGains(st.sim.x, st.sim.y, st.cx, st.cy, amps.roll, amps.wind);
    // ⚠ THE GYRO STABILISER (STAB switch, G): a flywheel resisting roll and pitch, run off the
    // engine, so a dead boat rides freely. ⚠ IT GOES TO THE MODEL AS `stab`, NEVER ONTO THE SWELL.
    // Scaling the amplitudes here made her ride a lower sea than the mesh draws, so she sat inside
    // the crests. See `stepBoat`.
    st.sim.stab = st.stab && st.sim.running ? STAB_K : 1;
    st.sim.seaRoll = amps.roll * gain.swell; st.sim.seaWind = amps.wind * gain.swell;
    st.sim.seaChop = amps.chop;
    st.sim.seaChopH = (amps.drawn || 0) * gain.chop;
    input.now = seaClock(Date.now()) * 1000;
    const px = st.sim.x, py = st.sim.y;
    stepBoat(st.sim, input, st.p, dt);
    // ⚠ BEACHED, R IS A SHOVE OFF, AND IT SHUTS THE LEVER. She has no astern, so without this a boat run
    // up the sand is a boat you can never leave: stepping off aground is refused, and the throttle
    // only drives her further up.
    // ⚠ IT IS A BUMP WITH WAY ON IT, NOT A WALK THAT STOPS AT THE WATERLINE. The walk quit the frame
    // she floated, so she sat with her stern a hand's width off the sand and the first touch of the
    // lever put her straight back up it. The astern way is held at SHOVE_V while she is on the sand
    // and runs down by itself once she floats, so a tap is enough. Afloat it only carries her over
    // water: gliding up the far bank would be a second grounding, and the server prices every one.
    if (st.sim.beached && st.keys.has('r')) {
      st.lever = 0;   // shoving and driving at once is not a thing; the shove wins
      if (st.shove < 0.1) boatLandThump(0.35);
      st.shove = SHOVE_V;
    }
    if (st.shove > 0) {
      const h = st.sim.heading * Math.PI / 180;
      const nx = st.sim.x - Math.sin(h) * st.shove * dt, ny = st.sim.y + Math.cos(h) * st.shove * dt;
      if (st.sim.beached || isWet(cellAt(nx, ny))) {
        st.sim.x = nx; st.sim.y = ny;
        st.shove = st.shove > 0.02 ? st.shove * Math.exp(-dt / SHOVE_TAU) : 0;
      } else st.shove = 0;
    }
    if (st.anchored) holdAtAnchor(dt);
    fendOff(px, py);
    for (const ev of st.sim.events || []) onEvent(ev);
    if (st.clickCrank) st.clickCrankLeft -= dt;
    if (st.clickCrank && (st.sim.running || st.clickCrankLeft <= 0)) { st.starter = false; st.clickCrank = false; }

    // Recentre the window when the hull has crossed far enough that the rim is in reach. The
    // server streams a fresh one on the next sync; until it arrives the old tiles are re-indexed
    // about the new centre, which is why `cellAt` works in absolute grid coordinates.
    // ⚠ THROUGH `shiftBoatOrigin`, because the drawn sea is in the window's frame and jumps with it.
    const dx = st.sim.x, dy = st.sim.y;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
      st.cx += Math.round(dx); st.cy += Math.round(dy);
      shiftBoatOrigin(st.sim, st.p, -Math.round(dx), -Math.round(dy));
      // The drawn ride remembers the water too, and it is new water: start it on the sea she is on.
      st.ride = null;
    }

    const spd01 = clamp(Math.abs(st.sim.speed) / Math.max(1, st.p.topSpeed || 138), 0, 1);
    // ⚠ THE TWO KEYS THE SYNTH ACTUALLY READS. `rampV8` takes `rpm`, `pedal`, `distance`,
    // `doppler` and `perspective` and nothing else — this sent `load`, `nitro` and `airborne`,
    // which are silently ignored, and handed the PEDAL in as the rpm while `pedal` itself went
    // unset. The motor still made a noise, which is exactly why it would never have been reported:
    // it was the blower follower's noise rather than the engine's, with no throttle response on it
    // at all. `s.rpm` is the sim's own 0..1 crank figure and `s.pedal` the lever follower.
    const kick = revKick(performance.now());
    updateBoatEngine({ rpm: Math.min(1, st.sim.rpm + kick), pedal: Math.min(1, st.sim.pedal + kick * 1.6) });
    // The hull on the water: follows way, not revs, and goes quiet in the air.
    updateBoatWater({ spd01, airborne: st.sim.airborne, aground: st.aground });
    updateBoatContacts({ x: st.cx + st.sim.x, y: st.cy + st.sim.y, heading: st.sim.heading, speed: st.sim.speed }, st.contacts.raw);
    updateBerth();
    stepRod(dt, performance.now());
    // How she sits on the water the picture draws, at the size this view draws her (see `drawnRide`).
    const ride = drawnRide(dt, spd01);

    paintWindshield(ID, {
      cls: st.typeId, phase: 'cruise', worldBlend: 1,
      map: buildWindow(), mapCenter: { x: st.cx, y: st.cy },
      mapOffset: { x: st.sim.x, y: st.sim.y },
      heading: st.sim.heading, ownHdg: st.sim.heading,
      // ⚠ `pitch`/`roll` ARE THE HULL'S ATTITUDE AND `lookYaw`/`lookPitch` ARE YOUR HEAD'S. Two
      // different things that would be one field with two meanings if they shared a name — the
      // trap `camPitch` is named for.
      // ⚠ DEGREES, AND `bank` NOT `roll`. The sim holds radians; the renderer's own-ship draw and
      // the horizon both read degrees, and the hull draw reads `bank` — so the attitude arrived as
      // a fifth of a degree on a field nothing drew from, and she sat level on a heaving sea.
      // ⚠ RIDE COMFORT SCALES WHAT THE HELM CAMERA IS SHOWN, NEVER THE HULL: the sim, the packet
      // and the chase view keep the full attitude, so a steadier seat is not a calmer sea.
      // ⚠ THE PICTURE'S RIDE, NOT THE SIM'S. `drawnRide` poses her on the water under the hull this
      // view draws; the sim's own pitch and roll are the physics' (a point on a face), and posed by
      // them the drawn chop stood over her deck a third of the time.
      // ⚠ AND `bank` IS STARBOARD DOWN, THE AIRCRAFT'S SENSE, WHILE THE SIM'S ROLL IS STARBOARD UP.
      // Handed over unsigned, every boat leaned INTO the water rising beside her: the high side went
      // down into it. Negated here, once, for the hull and the horizon alike.
      pitch: ride.pitch * 180 / Math.PI * rideK(), bank: -ride.roll * 180 / Math.PI * rideK(), roll: -ride.roll * 180 / Math.PI * rideK(),
      rideZ: st.external ? ride.heave : 0,
      // ⚠ THE SHOULDER-CHECK IS SUPPRESSED OUT THERE, NOT MERELY UNUSED. The chase camera is
      // already showing you what a look astern is for, and yawing a third-person view off the
      // boat it is following is just lost — the cab's own wording, and it is the same renderer
      // reading the same two fields.
      lookYaw: st.external ? 0 : st.look.yaw, lookPitch: st.external ? 0 : st.look.pitch,
      // ⚠ AND THE EYE IS ONLY SENT FROM INSIDE. `eyeH` seats the driver in the pilothouse; out
      // there it would move the BOAT against the world rather than the camera against the boat,
      // which is the trap `cab-view.js` records one seat over and the reason it spreads the pair
      // conditionally rather than sending both always.
      // ⚠ THE HEAVE IS NEVER SCALED BY RIDE COMFORT. The water keeps its full height, so a camera
      // that rose a fifth as far as the hull sank under every crest she climbed.
      ...(st.external
        ? { external: true, extYaw: st.extYaw, extPitch: st.extPitch, extZoom: 1.15 * st.extZoom }
        : { height: 0, metreTiles: METRE_TILES, eyeH: Math.max(0.02, eyeTilesOf(st.typeId) + ride.heave) }),
      speed: st.sim.speed,
      // The cabin lights (the profile's floods) and the dome lift come on with the engine.
      // ⚠ THE SKIFF'S LAMP IS A BATTERY LAMP: it lights the seat with the engine off, so it powers
      // the cabin pass on its own (the dome stays the engine's).
      powered: !!st.sim.running || !!st.lamp, dome: (!!st.sim.running && st.cabin) || !!st.lamp,
      wipers: st.sim.running && st.wipers ? st.wipers : 0,
      // Her paint, or the shipwright's preview of it (see boatPreview). Absent is the factory colours.
      ...((st.preview || st.livery) ? { livery: st.preview || st.livery } : {}),
      hour: st.hour, weather: st.weather,
      actors: st.actors,   // pavement people; drawn as meshes up close (gl/actors.js)
      berthMarks: st.berthDraw,   // the fuel berth / covered slot boxes she is near (glass/berth-marks.js)
      // ⚠ IT IS `wxGround`, AND THIS SENT `ground`. The renderer reads `v.wxGround` to seed how wet
      // and how snowed the world already is, so named wrong the seat starts every passage on dry,
      // bare summer ground and converges over the next ten minutes — a player taking the helm in a
      // blizzard sails out onto grass while somebody on the pontoon is standing in snow. Exactly the
      // failure recorded against the sky payload, arriving through a fifth seat the gate for it
      // could not see, because that gate scans a hard-coded list of four view files.
      wxField: st.wxField, wxGround: st.wxGround,
      acX: st.cx + st.sim.x, acY: st.cy + st.sim.y,
      // No wake and no foam while she is off the water: a hull in the air cuts nothing.
      // The beam is the hull as DRAWN (about 0.4 tiles long, 0.12 across the sponsons): it sets
      // how wide and how tall the wake stands (collectWakes), and at the Echelon's 0.30 it stood
      // three hulls high.
      ownWake: { spd: (st.sim.airborne || st.aground) ? 0 : spd01, turn: st.steer, beam: 0.12 * ((BOAT_ROWS[st.typeId]?.beam ?? 0.25) / 0.25) },
      // ⚠ AS OFFSETS FROM HER. This handed the renderer the list in absolute tiles, which has no `dx`,
      // so no other craft was ever drawn from a boat; the audio half (updateBoatContacts) worked.
      contacts: st.contacts.size ? st.contacts.frame(st.cx + st.sim.x, st.cy + st.sim.y, { roadRig: ROAD_RIG_MUL }) : null,
      skyline: st.skyline, roads: st.roads, regions: st.regions,
      // The live cluster. These are the shell's own keys — see `instrumentFaces` — and every one of
      // them is a number the sim already has, which is the point of the dials being geometry.
      instr: {
        rpm: st.sim.pedal, speed: Math.abs(st.sim.speed), throttle: st.lever,
        hull: st.sim.hull, nitro: st.sim.nitro, nitroOn: st.sim.nitroOn,
        nitroHeat: st.sim.nitroHeat, steer: st.steer, fuel: st.fuel, trim: st.trim,
        aground: st.aground, gps: { x: st.cx + st.sim.x, y: st.cy + st.sim.y },
        hdg: st.sim.heading,   // the binnacle compass on the dash — see boatFit
        running: !!st.sim.running,   // the backlighting on the switchgear and the plotter
        stab: !!st.stab,
        dialSwitch: !!st.dials, dials: !!st.dials && !!st.sim.running,   // the gauge lights, and whether they have power
        cabin: st.cabin, wipers: st.wipers, horn: st.hornOn, hover: st.hover, press: st.press,
        // The skiff's (interior-skiff.js): the cleat, the battery lamp, the box lid, the choke, the
        // primer bulb's squeeze and the rod holder.
        anchored: !!st.anchored, lamp: !!st.lamp, boxOpen: !!st.boxOpen, choke: !!st.choke, prime: primeLevel(), rod: rodOn(),
      },
      // Rod mode's angler, rod, line, lure and ring (glass/rod-rig.js).
      ...(st.rodView ? { rod: st.rodView } : {}),
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
// ⚠ THE METRE IS THE SEA'S, NOT THE ROAD'S. The cab's anchor (0.12 tiles is `EYE_M` metres) makes
// a tile about 22 m, but the swell is authored at `SEA_TILE_M` (7 m), so on the cab's scale the
// helm sat 0.44 sea-metres up and drove into the face of every wave over 10 kt. The same figure
// goes to the renderer as `metreTiles`, which sizes the pilothouse, so the eye and the room stay
// one scale.
const METRE_TILES = 1 / SEA_TILE_M;
// ⚠ PER HULL. A cat's driver sits a third of a metre lower than the Rooster's, and the eye is read
// off the same geometry the pilothouse is built from (`boatGeom(row).helm.eyeM`), never a second
// number: this and the profile's `eyeM` are the two ends of one scale.
const eyeTilesOf = (id) => boatGeom(BOAT_ROWS[id] || BOAT_ROWS.hydro).helm.eyeM * METRE_TILES;

// ── HOW SHE SITS ON THE WATER THE PICTURE DRAWS ──────────────────────────────
//
// `stepBoatRide` (flight-model.js) fits her to the drawn sea over her own footprint; this says which
// footprint. ⚠ TWO SIZES, BECAUSE THE TWO VIEWS DRAW TWO HULLS. The chase camera draws her at
// `ownHullScale` (a fifth of her length in sea metres, with her height exaggerated) and the helm seats
// you in her at full size through `METRE_TILES`. Each is posed by the water under the hull it shows,
// and each keeps its own state, so swapping views does not drag one ride into the other.
// Eight tenths of her length and beam: the sheer, not the stem and the chine's outermost point.
function drawnRide(dt, spd01) {
  const row = BOAT_ROWS[st.typeId] || BOAT_ROWS.hydro, G = boatGeom(row);
  const sc = st.external ? ownHullScale(st.typeId) : { plan: G.helm.mPerUnit * METRE_TILES, vert: G.helm.mPerUnit * METRE_TILES };
  const r = (st.ride ||= { chase: {}, helm: {} })[st.external ? 'chase' : 'helm'];
  return stepBoatRide(r, st.sim, dt, { halfLen: G.LEN * 0.8 * sc.plan, halfBeam: G.BEAM * 0.8 * sc.plan,
    vr: sc.vert / sc.plan, trim: st.trim || 0, spd01 });
}

function onEvent(ev) {
  if (ev === 'holed' || ev === 'aground' || ev === 'slam') send('boatevent ' + ev);
  // Back on the water: an FM thump sized by how hard she came down (0.9 tiles/s is a big one).
  if (ev === 'land' || ev === 'slam') boatLandThump(Math.min(1, (st.sim.landImpact || 0) / 0.9 + (ev === 'slam' ? 0.3 : 0)));
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
  const head = (st.anchored ? 'AT ANCHOR   ' : '') + (st.sim.running ? (mph + ' MPH')
    : (st.sim.crank > 0 ? 'CRANKING…' : st.fuel <= 0 ? 'DRY: NO START' : (st.starter && st.lever >= 0.05) ? 'LEVER TO IDLE TO START' : 'ENGINE OFF · K'));
  // In rod mode the strip leads with the aim: the bearing off the bow and, while charging, the range.
  const rb0 = rodOn() ? Math.round(st.rod.bearing) : null;
  const rodHead = rb0 == null ? '' : 'ROD ' + (rb0 === 0 ? 'DEAD AHEAD' : Math.abs(rb0) + '° ' + (rb0 < 0 ? 'PORT' : 'STBD'))
    + (st.rod.charging ? '  ' + Math.round(st.rod.range) + ' M' : '') + '   ';
  el.textContent = rodHead + head + '   HULL ' + Math.round(st.sim.hull * 100) + '%   FUEL '
    + Math.round(st.fuel * 100) + '%   BOTTLE ' + Math.round(st.sim.nitro * 100) + '%   ' + tab;
  el.classList.toggle('boat-dead', !st.sim.running);
  drawNavHome(st.root?.querySelector?.('.nav-home'), { x: st.cx + st.sim.x, y: st.cy + st.sim.y, heading: st.sim.heading, homeX: st.homeX, homeY: st.homeY });

  const keys = st.root?.querySelector?.('.boat-keys');
  // ⚠ THE LINE FOLLOWS THE MODE RATHER THAN LISTING EVERYTHING, the free camera's own rule: a strip
  // advertising the lever and the tabs while you are orbiting the boat is advertising two controls
  // that do nothing out there.
  if (keys) {
    // Beached, the one control that does anything is the shove, whichever view you are in.
    // A throttle taken at anchor says so for three seconds, rather than dragging the anchor.
    const rodPh = rodOn() ? BF?.boatFishState?.()?.phase : null;
    keys.textContent = rodOn()
      ? (rodPh === 'ready'
        ? (st.rod.charging ? 'CASTING: let go of SPACE at the range you want' : 'ROD: drag or ◀ ▶ to aim · hold SPACE to cast · R stow the rod · V ' + (st.external ? 'seat' : 'external'))
        : 'ROD: SPACE twitches and strikes · ◀ ▶ lean in the fight · R stow the rod · V ' + (st.external ? 'seat' : 'external'))
      : performance.now() - (st.rod?.nag || -1e9) < 3000
      ? 'DROP THE ANCHOR FIRST (B), THEN R FOR THE ROD.'
      : st.anchored && performance.now() - st.anchorNag < 3000
      ? "THE ANCHOR'S DOWN. B PULLS IT UP."
      : st.sim.beached
      ? 'BEACHED: R push off · V ' + (st.external ? 'helm view' : 'external') + ' · ? controls'
      : st.external
      ? 'drag swing · wheel back off · V helm view · ? controls · ESC step off'
      : (st.sim.running
        ? 'A/Z throttle · X/C steer · [ ] tabs · SHIFT bottle · H horn · I/W/L cabin wipe dials · K stop · V external · ? controls'
        : 'ENGINE OFF: click the ENGINE key or hold K to start · V external · N ride · ? controls · ESC step off');
  }
  st.lever3d?.draw?.();
  st.root?.querySelectorAll?.('.boat-sw')?.forEach?.((b) => b.classList.toggle('on', switchState(b.dataset.sw)));
  const kb = st.root?.querySelector?.('.boat-ign');
  const rb = st.root?.querySelector?.('.boat-ride');
  if (rb) rb.textContent = RIDE[rideIdx].label;
  const pb = st.root?.querySelector?.('.boat-push');
  if (pb) pb.hidden = !st.sim.beached;
  const ab = st.root?.querySelector?.('.boat-anchor');
  if (ab) { ab.hidden = !(Number(st.p.rode_m) > 0); ab.classList.toggle('on', !!st.anchored); ab.textContent = st.anchored ? '⚓ WEIGH' : '⚓ ANCHOR'; }
  if (kb) kb.dataset.pos = (st.sim.crank > 0 || st.starter) && !st.sim.running ? 'start' : st.sim.running ? 'run' : 'off';
}

// ── WHAT THE SERVER PUSHES ───────────────────────────────────────────────────
export function boatSetWorld(msg = {}) {
  if (!st) return;
  if (msg.map) { st.tiles = msg.map; st.ox = (msg.gx ?? st.cx) - RAD; st.oy = (msg.gy ?? st.cy) - RAD; }
  if (msg.hour != null) st.hour = msg.hour;
  if (msg.weather) st.weather = String(msg.weather).toLowerCase();
  if (msg.wxField !== undefined) st.wxField = msg.wxField || null;
  if (msg.wxGround) st.wxGround = msg.wxGround;
  if (msg.contacts) st.contacts.update(msg.contacts);
  if (msg.skyline) st.skyline = msg.skyline;
  if (msg.roads !== undefined) st.roads = msg.roads || null;
  if (msg.regions) st.regions = msg.regions;
  // An empty list is a real answer (everybody went indoors), so only an absent key keeps the last one.
  if (msg.actors !== undefined) st.actors = msg.actors || [];
  if (msg.marks) st.marks = msg.marks;
  // ⚠ THE SERVER IS AUTHORITATIVE ABOUT THE ROW AND NOT ABOUT THE POSITION. Hull, fuel and the
  // bottle are things the yard, a refit and a wreck all write, so they are adopted; where the boat
  // IS is what this client just told the server, and adopting it back would fight the sim four
  // times a second.
  if (msg.hull != null) st.sim.hull = msg.hull;
  if (msg.fuel != null) st.fuel = msg.fuel;
  if (msg.nitro != null) st.sim.nitro = msg.nitro;
  // What the yard changed about her while you sat in her: wear (the handling), paint, name.
  if (msg.params) st.p = msg.params;
  // The anchor, which only the server sets. Dropping it cuts the engine (anchor.js).
  if ('anchored' in msg) {
    st.anchored = msg.anchored || null;
    if (msg.cut && st.sim.running) { st.sim.running = false; st.starter = false; st.lever = 0; stopBoatEngine(); }
  }
  if ('livery' in msg) st.livery = msg.livery || null;
  if (msg.name) st.name = msg.name;
}

// ── THE STYLES ───────────────────────────────────────────────────────────────
//
// One block, with the panel, per the one-file-per-panel convention. Rewritten every time rather
// than early-returned, for the reason helm-mode gives: a stale block left by an older build would
// pin the old layout under this module's fresh JS.
function ensureBoatStyles() {
  const el = document.getElementById('boat-styles') || document.createElement('style');
  el.id = 'boat-styles';
  el.textContent = BOAT_CSS;
  if (!el.parentNode) document.head.appendChild(el);
}
