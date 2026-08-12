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
  groundObstructionAt, MODEL_MAX_EXTENT, RENDER_TUNE } from './windshield.js';
import { TYPES, createTruckState, truckReadout, step, truckShift, truckSplit } from './flight-model.js';
import { updateEngineAudio, stopEngineAudio } from './engine-audio.js';
// The cab draws the weather through its own windscreen, so the pane's outdoor overlay has to
// stand down while it owns the pane — the same hard override the cockpit takes on embark.
import { suppressWeatherFx } from './weather-fx.js';
import { createHelmWheel } from './helm-wheel.js';
import { sendCmdSilent } from '../net.js';

const SYNC_MS = 250;              // telemetry cadence — matches the server's MIN_SYNC_MS guard
// THE PARAMETERS ARE THE SERVER'S, NOT A CONSTANT. This was `TYPES.hauler` — one hardcoded truck
// for the whole fleet — so a player who spent 31,000₵ on a Continental drove a Courier with a
// different name on the door: same gears, same top speed, same brakes, same turn-in. The server
// now assembles the real set at mount (plugins/trucking/rig.js effTruckParams: the type, its tune,
// its kits, and how worn it is) and ships it in the cab context, so a bought truck and a tuned
// truck are both felt at the wheel. The fallback stays for a context that predates the field.
let P = TYPES.hauler;
const setParams = (ctx) => { P = (ctx && ctx.params) || TYPES[ctx && ctx.typeId] || TYPES.hauler; };

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
  container.innerHTML = `
    <div class="cab-wrap">
      ${windshieldHTML(id, 'THE LONG HAUL')}
      <div class="cab-controls">
        <canvas class="cab-wheel" width="220" height="220" aria-label="Steering wheel"></canvas>
        <div class="cab-gauges">
          <div class="cab-readout"><b class="cab-mph">0</b><span>MPH</span></div>
          <div class="cab-readout"><b class="cab-odo">0</b><span>TILES TO GO</span></div>
          <div class="cab-readout"><b class="cab-surface">ROAD</b><span>SURFACE</span></div>
          <div class="cab-readout cab-gearbox"><b class="cab-gear">N</b><span class="cab-gearhint">GEAR &middot; , .</span></div>
        </div>
        <div class="cab-tach" aria-hidden="true"><i class="cab-tach-band"></i><i class="cab-tach-needle"></i></div>
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
      </div>
    </div>`;

  setParams(ctx);                                  // which truck this is — before anything reads P
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
  };

  // The wheel, in ABSOLUTE mode — see helm-wheel.js. A boat sets a course; a truck holds a line.
  st.wheel = createHelmWheel(container.querySelector('.cab-wheel'), {
    accent: '#d8892e', mode: 'absolute', lock: 1.6, selfCentre: 5.0,
    onSteer: (axle) => { st.input.steer = axle; },
    getHeading: () => st.sim.heading,
  });

  // Pedals: hold-to-apply on pointer, and A/Z on the keyboard so a keyboard driver isn't
  // second-class. (The instrument panel's token-bucket lesson does not apply here — a pedal is a
  // held state, not a stream of events.)
  const hold = (sel, key) => {
    const el = container.querySelector(sel);
    const on = (e) => { st.input[key] = 1; el.classList.add('on'); e.preventDefault(); };
    const off = () => { st.input[key] = 0; el.classList.remove('on'); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off);
    addEventListener('pointerup', off);
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
    const off = () => { if (st.steerKey === dir) { st.steerKey = 0; st.wheel?.setHeld(0); } el.classList.remove('on'); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('pointercancel', off);
    addEventListener('pointerup', off);
  };
  steerHold('.cab-left', -1);
  steerHold('.cab-right', 1);

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
    // Held would be a stuck horn and a round trip per frame; one pull per press, `e.repeat` filtered.
    else if (down && !e.repeat && k === 'h') sendCmdSilent('horn');
    // STEERING BY KEYBOARD. Until this existed a keyboard driver could accelerate, brake and shift
    // — and could not turn, which is not a harder way to drive, it is not driving. It goes through
    // the wheel widget so the wheel on screen turns with it.
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

    // Solid geometry. On contact the truck does not pass through it: it is put back where it was
    // and stopped dead, which is the honest outcome for a wall and needs no rebound model.
    if (st.hitCd > 0) st.hitCd -= dt;
    else if (obstructionAhead(st) > 0) {
      const mph = st.sim.speed;
      st.sim.x = st.prev.x; st.sim.y = st.prev.y;
      st.sim.speed = 0; st.sim.yawRate = 0;
      st.hitCd = 0.9;                                  // don't re-fire every frame while nosed against it
      sendCmdSilent(`truckevent ${mph > BUMP_MPH ? 'crash' : 'bump'} ${Math.round(mph)}`);
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
    q('.cab-gearhint').textContent = r.stalled ? 'STALLED · CLUTCH X' : `GEAR · BEST ${r.best}`;
    q('.cab-tach-needle').style.left = Math.min(100, r.rpm) + '%';
    q('.cab-tach').classList.toggle('over', r.rpm > P.band[1] * 100 + 4);

    // The rig. Brake temperature is a WORD, not a number, because nobody reads a gauge in
    // Fahrenheit while a hill is happening to them — and it goes amber before it fades, so a
    // driver who is paying attention gets to do something about it.
    const bEl = q('.cab-brakes');
    const bt = r.brakeTemp;
    bEl.textContent = r.fading ? 'FADING' : bt > 0.42 ? 'HOT' : bt > 0.2 ? 'WARM' : 'COLD';
    bEl.className = 'cab-brakes' + (r.fading ? ' b-fade' : bt > 0.42 ? ' b-hot' : '');
    q('.cab-riginfo').textContent = r.hitched
      ? (r.folding ? 'JACKKNIFING' : `TRAILER ${r.phi > 0 ? '+' : ''}${r.phi.toFixed(0)}°`)
      : 'BOBTAIL';
    q('.cab-riginfo').className = 'cab-riginfo' + (r.folding ? ' b-fade' : '');

    // The voice. rpm/gear/surface are the three things a diesel tells you about, so all three go
    // over; `continuous: true` picks the live parametric synth rather than the deck-craft loops.
    if (now - st.lastAudio >= 220) {
      st.lastAudio = now;
      updateEngineAudio({
        continuous: true, class: 'truck', engineOn: !st.dry, airborne: false, onGround: true,
        rpm: st.sim.rpm, throttle: st.input.throttle * 100, spd: r.speed,
        groundSpeed: r.speed, surface: st.input.surface || 'road',
        cabin: true, weather: st.weather,
      });
    }

    // Hand the world to the flight sim's renderer. `height: 0` is the ground camera; the map
    // window came from the server and was derived by the same mapWindow a cockpit uses.
    paintWindshield(st.id, {
      cls: 'truck', phase: 'ground', worldBlend: 1,
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

    if (now - st.lastSync >= SYNC_MS) {
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
  .cab-wrap{position:relative;width:100%;height:100%;display:flex;flex-direction:column;background:#07080a}
  .cab-controls{display:flex;align-items:center;gap:14px;padding:8px 12px;background:linear-gradient(#15181c,#0b0d10);border-top:1px solid #2a2f36}
  .cab-wheel{width:112px;height:112px;flex:0 0 auto}
  .cab-gauges{display:flex;gap:16px;flex:1 1 auto}
  .cab-readout{display:flex;flex-direction:column;align-items:flex-start;line-height:1.1}
  .cab-readout b{font-size:22px;color:#e8c07a;font-variant-numeric:tabular-nums}
  .cab-readout span{font-size:9px;letter-spacing:.14em;color:#7c848f}
  .cab-surface.s-shoulder{color:#d8a24e}
  .cab-surface.s-offroad{color:#d2603f}
  .cab-pedals{display:flex;flex-direction:column;gap:6px;flex:0 0 auto}
  .cab-box,.cab-steer{display:flex;gap:5px;flex:0 0 auto;align-items:center}
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
  .cab-tach-needle{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:#e8c07a}
  /* Touch: the controls get BIGGER on a small screen rather than smaller, because that is the one
     place they are the only way in — the wheel shrinks to make room for them, not the reverse. */
  @media (max-width:700px){
    .cab-wheel{width:84px;height:84px}.cab-readout b{font-size:17px}.cab-tach{display:none}
    .cab-controls{flex-wrap:wrap;gap:8px}
    .cab-btn{min-width:44px;min-height:44px;font-size:15px}
    .cab-pedal{padding:12px 14px}
    .cab-pedals{flex-direction:row;flex-wrap:wrap}
  }
  @media (pointer:coarse){ .cab-btn{min-width:44px;min-height:44px} .cab-pedal{padding:12px 16px} }

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
  suppressWeatherFx(false);
  cancelAnimationFrame(st.raf);
  stopEngineAudio();                                 // the diesel does not idle on in an empty room
  removeEventListener('keydown', st.onKey);
  removeEventListener('keyup', st.onKey);
  st.wheel?.destroy?.();
  disposeWindshield(st.id);
  st.container.innerHTML = '';
  st = null;
}
