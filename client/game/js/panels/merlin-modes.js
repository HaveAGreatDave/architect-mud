// THE MERLIN'S FOUR BUTTONS: HOVER, LOCK, BOOST AND PIT (docs/proposals/road-vtol.md).
//
// The Corvane Merlin flies on the heli model's `merlin` row and drives on `merlin_road`
// (flight-model.js `stepRoad`): a hover car held a hand's width over whatever is under it. This module
// is the glue cockpit.js calls once a frame after the physics, and the four buttons' actions:
//
//   HOVER  in the air, low and slow: a four-second descent to ride height, levelling and slowing, and
//          then the road row takes over. On the road: back up to hover height and the heli row again.
//          Refused over water, on a roof, too high or too fast, and the toast says which.
//   LOCK   over a pad, slow: the pad takes it, easing it onto the pad's centre and heading, the feet
//          clamp and it's down. The landing is the ordinary landing, so the server parks it where it
//          is, as it parks any VTOL. Pads are the car parks' painted pads (CAR_PARK_PADS, the same
//          numbers the `car_park` arm paints) and the ground helipads; a rooftop pad already catches
//          a heli on its own (pad-catch.js).
//   BOOST  held (Space) or tapped (the key: a 1.5 s burst): more thrust, in the air and on the road.
//          It heats the fans; past the top of the gauge it cuts out for four seconds.
//   PIT    a speed limiter for the road: holds it to PIT_KT. It does nothing in the air.
//
// ⚠ The server never hears about the modes. Road mode is flight at a couple of feet, so the server's
// reconcile, odometer and landing rules all apply to it unchanged; nothing here can move the
// aircraft further than the sim it rides on.

import { TYPES } from './flight-model.js';
import { HOVER_CARS } from '../../../shared/hover-cars.js';

// Every hover car (client/shared/hover-cars.js) has the Merlin's four buttons on its own pair of
// rows: the one it flies on and the one it drives on. Its state carries which car it is as `M.cls`;
// the times, the limits and the pad rules below are the class's.
const carOf = (F) => HOVER_CARS[F.mr && F.mr.cls] || HOVER_CARS.merlin;
export const airRow = (F) => TYPES[carOf(F).air];
export const roadRow = (F) => TYPES[carOf(F).road];

export const MR = {
  HOVER_MAX_AGL_FT: 100,   // about 30 m: higher than this, HOVER refuses
  HOVER_MAX_KT: 32,        // about 60 km/h
  DOWN_S: 3.6,             // the descent to ride height
  UP_S: 2.4,               // the climb back to hover
  UP_FT: 14,               // where the climb hands over to the heli row
  LOCK_R: 0.16,            // tiles from a pad's centre that LOCK will take
  LOCK_KT: 7,              // slower than this, or LOCK won't take it
  LOCK_S: 2.4,             // the guided set-down
  BOOST_HEAT_S: 6,         // seconds of boost from cold to the cut-out
  COOL_S: 8,               // seconds from hot to cold
  OVER_S: 4,               // how long an overheat cuts the boost
  TAP_S: 1.5,              // a click on BOOST is this long a burst
  PIT_KT: 16,              // the pit limiter, about 30 km/h
};

// The car park's three pads in the arm's tile units (models/greenside.js `car_park`, PADS), and the
// café lot's two are its own business: the café isn't a car park tile.
export const CAR_PARK_PADS = [[0.20, -0.25], [0.20, 0.17], [-0.14, -0.05]];
const CAR_PARK_TYPES = new Set(['car_park', 'staff_lot']);
const faceVec = (ent) => (ent === 'north' ? [0, -1] : ent === 'south' ? [0, 1] : ent === 'east' ? [1, 0] : ent === 'west' ? [-1, 0] : [0, 1]);
// windshield.js `facePt`: model-local onto the world, turned to the entrance.
const facePt = (dx, dy, lx, ly, E) => [dx + lx * E[1] + ly * E[0], dy - lx * E[0] + ly * E[1]];

export const newMerlinState = (cls = 'merlin') => ({ cls: HOVER_CARS[cls] ? cls : 'merlin', mode: 'air', t: 0, heat: 0, over: 0, key: false, tap: 0, pit: false, lock: null, near: null, lit: 0, flame: 0 });
export const merlinRoad = (F) => !!F.mr && (F.mr.mode === 'road' || F.mr.mode === 'down');
export const merlinBoostOn = (F) => !!F.mr && !(F.mr.over > 0) && (F.mr.key || F.mr.tap > 0) && F.engineOn;

// The nearest pad within reach, or null: { x, y, hdg, kind }.
export function nearestPad(F, cellAt) {
  if (!F.pos) return null;
  const cx = Math.round(F.pos.x), cy = Math.round(F.pos.y);
  let best = null;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const c = cellAt(cx + dx, cy + dy);
    if (!c) continue;
    const pads = [];
    if (CAR_PARK_TYPES.has(c.bt)) {
      const E = faceVec(c.ent);
      for (const [lx, ly] of CAR_PARK_PADS) { const [x, y] = facePt(cx + dx, cy + dy, lx, ly, E); pads.push({ x, y, hdg: (Math.atan2(E[0], -E[1]) * 180 / Math.PI + 360) % 360, kind: 'car park' }); }
    } else if (c.kind === 'field' && c.pad && !c.bt) {
      pads.push({ x: cx + dx, y: cy + dy, hdg: null, kind: 'helipad' });
    }
    for (const p of pads) {
      const d = Math.hypot(p.x - F.pos.x, p.y - F.pos.y);
      if (!best || d < best.d) best = { ...p, d };
    }
  }
  return best;
}

// Why HOVER can't come down here, or null if it can.
export function hoverDownRefusal(F, s) {
  const agl = s.altitude - (s.groundFt || 0);
  if (!F.engineOn) return 'HOVER: start the fans first';
  if (agl > MR.HOVER_MAX_AGL_FT) return 'HOVER: come down below 100 ft first';
  if (Math.abs(s.airspeed) > MR.HOVER_MAX_KT) return 'HOVER: slow below 32 kt first';
  if ((s.groundFt || 0) > 0.5) return 'HOVER: not on a roof, there\'s no road up here';
  if (F.waterBelow ?? F.biomeBelow === 'water') return 'HOVER: not over water, it would drown the fans';
  return null;
}

// The HOVER button: down from the air, up from the road, or turned round mid-transition.
export function merlinHover(F, toast) {
  const M = F.mr, s = F.s; if (!M || !s) return;
  if (M.lock) return;
  if (M.mode === 'air') {
    if (s.onGround) { toast('HOVER: lift off first; on the ground it drives from a hover'); return; }
    const why = hoverDownRefusal(F, s);
    if (why) { toast(why); return; }
    M.mode = 'down'; M.t = 0; toast('HOVER: coming down to ride height');
  } else if (M.mode === 'road') {
    M.mode = 'up'; M.t = 0; F.P = airRow(F); F.heli = true; F.input.throttle = Math.max(F.input.throttle || 0, 0.62);
    toast('HOVER: up to flight');
  } else if (M.mode === 'down') { M.mode = 'air'; M.t = 0; toast('HOVER: cancelled'); }
  else if (M.mode === 'up') { M.mode = 'down'; M.t = 0; toast('HOVER: back down'); }
}

// The LOCK button.
export function merlinLock(F, toast, cellAt) {
  const M = F.mr, s = F.s; if (!M || !s || M.lock) return;
  const pad = nearestPad(F, cellAt);
  if (!pad || pad.d > MR.LOCK_R) { toast(pad ? 'LOCK: line up over the pad' : 'LOCK: no pad here'); return; }
  if (Math.abs(s.airspeed) > MR.LOCK_KT) { toast('LOCK: too fast, slow right down'); return; }
  if (s.altitude - (s.groundFt || 0) > 40 && M.mode === 'air') { toast('LOCK: come down over the pad first'); return; }
  M.lock = { x: pad.x, y: pad.y, hdg: pad.hdg, t: 0, x0: F.pos.x, y0: F.pos.y, h0: s.heading, a0: s.altitude };
  toast('LOCK: the ' + pad.kind + ' has it');
}

const ease = (t) => t * t * (3 - 2 * t);
const wrap = (d) => ((d % 360) + 540) % 360 - 180;

// Once a frame after the physics. `fx` carries the sounds and the toast.
export function stepMerlin(F, s, dt, fx, cellAt) {
  const M = F.mr; if (!M) return;
  // BOOST heat: up while it's on, down while it isn't, and a cut-out at the top.
  const on = merlinBoostOn(F);
  if (M.tap > 0) M.tap = Math.max(0, M.tap - dt);
  if (M.over > 0) { M.over = Math.max(0, M.over - dt); M.heat = Math.max(0, M.heat - dt / MR.COOL_S); }
  else if (on) {
    M.heat = Math.min(1, M.heat + dt / MR.BOOST_HEAT_S);
    if (M.heat >= 1) { M.over = MR.OVER_S; M.tap = 0; fx.toast('BOOST: fans overheated, cooling'); fx.over?.(); }
  } else M.heat = Math.max(0, M.heat - dt / MR.COOL_S);
  M.boostOn = merlinBoostOn(F);
  // The boost's flame (windshield.js drawMerlinBoost): it lights over a tenth of a second, flares
  // hardest just after (the 0.6 that fades in about a third of a second), settles, and dies down as
  // the heat climbs toward the cut-out, so you can see the boost running out. Off, it goes out fast.
  if (M.boostOn) {
    M.lit = (M.lit || 0) + dt;
    const light = Math.min(1, M.lit / 0.1), flare = 1 + 0.6 * Math.exp(-M.lit * 3);
    M.flame = light * flare * (1 - 0.85 * Math.pow(M.heat, 1.5));
  } else {
    M.lit = 0;
    M.flame = Math.max(0, (M.flame || 0) - dt * 5);
  }

  // HOVER's transitions.
  if (M.mode === 'down') {
    M.t += dt;
    const tgt = (s.groundFt || 0) + roadRow(F).rideFt, k = Math.min(1, dt * 1.3);
    s.altitude += (tgt - s.altitude) * k; s.vs = 0;
    if (s.airspeed > 20) s.airspeed -= Math.min(s.airspeed - 20, 12 * dt);
    s.pitch += (0 - s.pitch) * Math.min(1, dt * 3); s.bank += (0 - s.bank) * Math.min(1, dt * 3);
    if (M.t >= MR.DOWN_S && Math.abs(s.altitude - tgt) < 0.8) {
      M.mode = 'road'; M.t = 0; F.P = roadRow(F); F.heli = false;
      fx.toast('ROAD: on the cushion · hold R to go, F or S to brake, A/D steer');
      fx.settle?.();
    }
  } else if (M.mode === 'up') {
    M.t += dt;
    const tgt = (s.groundFt || 0) + MR.UP_FT;
    if (s.altitude < tgt) { s.altitude += (tgt - s.altitude) * Math.min(1, dt * 1.6); s.vs = Math.max(s.vs, 300); }
    if (M.t >= MR.UP_S) { M.mode = 'air'; M.t = 0; }
  }

  // Whether LOCK would take it now: the wheel's LOCK key lights on it.
  const pad = nearestPad(F, cellAt);
  M.near = pad && pad.d <= MR.LOCK_R * 1.8 ? pad : null;
  M.lockReady = !!(pad && pad.d <= MR.LOCK_R && Math.abs(s.airspeed) <= MR.LOCK_KT && !M.lock
    && (M.mode !== 'air' || s.altitude - (s.groundFt || 0) <= 40) && !s.onGround);

  // LOCK's guided set-down: onto the pad's centre and heading, down onto the feet, and the clamp.
  if (M.lock) {
    const L = M.lock;
    L.t += dt;
    const u = ease(Math.min(1, L.t / MR.LOCK_S));
    F.pos.x = L.x0 + (L.x - L.x0) * u; F.pos.y = L.y0 + (L.y - L.y0) * u;
    if (L.hdg != null) {
      // Square to the pad, whichever way round is nearer.
      const turn = [0, 90, 180, 270].map((q) => wrap(L.hdg + q - L.h0)).reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
      s.heading = (L.h0 + turn * u + 360) % 360;
    }
    s.airspeed = 0; s.vs = 0; s.pitch *= 1 - u; s.bank *= 1 - u;
    s.altitude = (s.groundFt || 0) + (L.a0 - (s.groundFt || 0)) * (1 - u);
    if (L.t >= MR.LOCK_S) {
      M.lock = null; M.mode = 'air'; M.t = 0;
      if (F.P !== airRow(F)) { F.P = airRow(F); F.heli = true; }
      F.input.throttle = 0; F.touchVs = -40;
      s.altitude = s.groundFt || 0; s.onGround = true;
      fx.clamp?.(); fx.toast('LOCKED: feet clamped');
    }
  }
}

// The road's glancing blow off a building (cockpit.js CFIT): slowed, turned off the wall, a scrape.
// Hull damage only at real speed. Returns the hull points lost.
export function merlinGlance(F, s) {
  const v = Math.abs(s.airspeed), hd = (s.heading || 0) * Math.PI / 180;
  F.pos.x -= Math.sin(hd) * 0.06; F.pos.y += Math.cos(hd) * 0.06;
  const side = Math.sin((F.pos.x * 7.1 + F.pos.y * 3.3)) >= 0 ? 1 : -1;
  s.heading = (s.heading + side * Math.min(35, 8 + v * 0.3) + 360) % 360;
  s.airspeed *= v > 40 ? 0.3 : 0.45;
  return v > 30 ? Math.round((v - 30) * 0.25) : 0;
}
