// ROOM · A LOCKED DOORWAY (docs/proposals/room-hololock.md). The door in a doorway whose lock the server
// sent (`room_view.locks`), and the reader on the wall beside it that the hololock is projected from.
//
// A building's doorway is a hole in the room's mesh (gl/room-mesh.js), and it stays one: the door is built
// here, apart, as two steel leaves that slide into the wall either side, so a lock giving costs no rebuild of
// the room. Each leaf is the shape `liftDoorBatch` slides (a lift's doors and the street's glass ones are the
// same), and the stage puts the batch on the renderer's lock layer (gl/room.js `setLocks`).
//
// Pure: vertices and points, no GL and no DOM. `at` and the panel corners are in the host frame (L.world).

import { roomKit } from './room-kit.js';
import { MAT, STRIDE } from './ballpark-mesh.js';
import { hallOf, annexWay, readerSpot, READER } from '../../../../shared/room-layout.js';

// gl/room.js draws a face with this code unlit: the strip down a leaf's edge and the reader's lens
const GLOW = 40;
const STEEL = '#343a44', STEEL_DARK = '#1c2026', PLATE = '#4a525e', HAZARD = '#e0a020';
// what the lock's own light says: shut to you, or not. A locked door that knows you is green too: it's
// unlocked as far as you're concerned.
export const LOCK_HUE = Object.freeze({ shut: '#ff2a4f', open: '#2ff3c0' });
export const lockHue = (k) => (!k.locked ? LOCK_HUE.open : LOCK_HUE.shut);
// a door with no lock on it has a plain pull where the light would be
const PULL = '#b9bec6';

// How far the hologram stands off the wall, metres. A keypad's face is on the wall itself.
const HOLO_OFF = 0.17, PAD_OFF = 0.012;

// The doorway's own frame: `along` the wall, `p` out of the room past the wall's inner face (negative is
// into the room), `y` up. A flat's front door on a corridor is in its hall's far wall (room-layout.js hallOf).
// The en-suite's doorway seen from inside it (room-layout.js annexWay) has its own frame: `p` runs back towards
// the flat from the en-suite's front wall, so "into the room" is into the en-suite.
function frameOf(L, o) {
  if (o.wall === 'annex' && L.annex) {
    const A = L.annex, uv = (a, p) => [a, A.v0 - p];
    const span = (a, b, p0, p1) => { const q = uv(a, p0), r = uv(b, p1); return [Math.min(q[0], r[0]), Math.max(q[0], r[0]), Math.min(q[1], r[1]), Math.max(q[1], r[1])]; };
    return { uv, span, lo: A.u0, hi: A.u1, world: (a, p, y) => { const q = uv(a, p); return L.world(q[0], q[1], y); } };
  }
  const S = L.spec, hu = L.w / 2, hall = hallOf(S, o), DB = hall ? hall.v1 : L.d;
  const uv = (a, p) => (o.wall === 'front' ? [a, -p] : o.wall === 'back' ? [a, DB + p] : o.wall === 'left' ? [-hu - p, a] : [hu + p, a]);
  // [u0, u1, v0, v1] of a slab across [a, b] from depth p0 to p1
  const span = (a, b, p0, p1) => { const q = uv(a, p0), r = uv(b, p1); return [Math.min(q[0], r[0]), Math.max(q[0], r[0]), Math.min(q[1], r[1]), Math.max(q[1], r[1])]; };
  const lo = hall ? hall.a : o.wall === 'front' || o.wall === 'back' ? -hu : 0, hi = hall ? hall.b : o.wall === 'front' || o.wall === 'back' ? hu : L.d;
  return { uv, span, lo, hi, world: (a, p, y) => { const q = uv(a, p); return L.world(q[0], q[1], y); } };
}

// Where along its wall a doorway's reader stands: on whichever side has the wall for it. The room's mesh
// reads this too (gl/room-decor.js), to put the unit's plaque over the reader.
// `busy`: whether anything tall stands within 0.7 m of the wall across [a0, a1] (L.placed), so a card isn't
// hung behind a wardrobe or a bar's end
function busyOn(L, F) {
  const tall = (L.placed || []).filter((p) => p.h > 1.2);
  return (a0, a1) => {
    const [u0, u1, v0, v1] = F.span(a0 - 0.05, a1 + 0.05, -0.7, 0);
    return tall.some((p) => {
      const q = Math.round((((p.turn || 0) % 180) + 180) % 180) === 90, hw = (q ? p.d : p.w) / 2, hd = (q ? p.w : p.d) / 2;
      return p.u - hw < u1 && p.u + hw > u0 && p.v - hd < v1 && p.v + hd > v0;
    });
  };
}
function readerOn(L, F, o) { return readerSpot(o, F.lo, F.hi, busyOn(L, F)); }
export const readerAlong = (L, o) => readerOn(L, frameOf(L, o), o).c;

// Where the reader and its card hang: { R, c }, R a frame like frameOf's and c the reader's place along it.
// ⚠ A FLAT'S HALL IS 1.5 m WIDE, so beside its door there's no room for the 0.45 m card, which straddled the
// hall's corner, half on each wall. There it goes on the hall's side wall, just short of the door.
function readerFrame(L, o, F) {
  const fits = (s) => (s > 0 ? o.b + READER.off + READER.half <= F.hi + 1e-6 : o.a - READER.off - READER.half >= F.lo - 1e-6);
  const hall = hallOf(L.spec, o);
  if (!hall || fits(1) || fits(-1)) { const { c, pad } = readerOn(L, F, o); return { R: F, c, pad }; }
  const right = hall.b - o.b >= o.a - hall.a;
  const uv = (a, p) => (right ? [hall.b + p, a] : [hall.a - p, a]);
  const span = (a, b, p0, p1) => { const q = uv(a, p0), r = uv(b, p1); return [Math.min(q[0], r[0]), Math.max(q[0], r[0]), Math.min(q[1], r[1]), Math.max(q[1], r[1])]; };
  const c = Math.max(hall.v0 + 0.3, hall.v1 - 0.42);
  return { R: { uv, span, lo: hall.v0, hi: hall.v1, world: (a, p, y) => { const q = uv(a, p); return L.world(q[0], q[1], y); } }, c };
}
// the top of the hologram's card off the floor, metres: a plaque goes over this
export const CARD_TOP = 1.68;

// A kit that bakes nothing: the door is steel, lit by the room's lamps in the shader.
const kitFor = (L) => roomKit(L, (lp, nl, col) => col, { glow: GLOW });
const take = (K) => K.solid.data.slice(0, K.solid.n * STRIDE);

/**
 * The doors and readers for a room's locks. `locks` is the server's list; each needs a doorway in `ways`
 * (room-layout.js doorwaysOf) with the same `to`.
 * Returns { leaves, fixed, panels }: `leaves` for liftDoorBatch, each with `way` (its lock's index);
 * `fixed` the vertices that don't move; `panels[i]` where lock i's hologram hangs.
 */
export function buildLocks(L, ways, locks) {
  const fine = L.spec.finish === 'fine', DH = fine ? Math.min(2.4, L.h - 0.3) : 2.05;
  const leaves = [], panels = [], fixedK = kitFor(L);
  locks.forEach((k, way) => {
    const o = k.annex ? annexWay(L.spec, k.inside, k.to) : ways.find((x) => x.to === k.to && !x.annex);
    if (!o) { panels.push(null); return; }
    const F = frameOf(L, o), m = (o.a + o.b) / 2, half = (o.b - o.a) / 2, hue = lockHue(k);
    for (const side of [-1, 1]) {
      const K = kitFor(L), a0 = side < 0 ? o.a - 0.01 : m + 0.003, a1 = side < 0 ? m - 0.003 : o.b + 0.01;
      const box = (b0, b1, p0, p1, y0, y1, hex, kk = 1, surf = MAT.METAL) => K.box(...F.span(b0, b1, p0, p1), y0, y1, hex, kk, null, surf);
      // the slab, inside the wall's thickness; a raised plate on the room's side and a kick plate under it
      // ⚠ MATTE, NOT METAL. A metal leaf is a big flat mirror for the lamps' highlight, which showed as a round
      // spot sliding across the door as you walked up to it.
      box(a0, a1, 0.05, 0.095, 0.004, DH, STEEL, 1, MAT.MATTE);
      box(a0 + 0.07, a1 - 0.07, 0.036, 0.05, 0.36, DH - 0.14, PLATE, 1, MAT.MATTE);
      box(a0 + 0.03, a1 - 0.03, 0.04, 0.05, 0.03, 0.26, STEEL_DARK, 1, MAT.MATTE);
      // a hazard band at hand height, cut by the plate's edges so it reads as painted on
      box(a0 + 0.07, a1 - 0.07, 0.032, 0.036, 1.0, 1.1, HAZARD, 1, MAT.SATIN);
      // the meeting edge: a dark seam, and the lock's light down it
      const edge = side < 0 ? a1 : a0, in0 = side < 0 ? edge - 0.05 : edge + 0.02, in1 = in0 + 0.03;
      box(edge - 0.004, edge + 0.004, 0.03, 0.05, 0.004, DH, STEEL_DARK);
      if (k.lock === false) box(in0, in1, 0.02, 0.036, 0.95, 1.25, PULL);
      else box(in0, in1, 0.028, 0.036, 0.5, DH - 0.3, hue, 1.6, MAT.EMISSIVE);
      const p0 = F.world(m, 0, 0), p1 = F.world(m + side, 0, 0), mid = F.world(m, 0, 0);
      leaves.push({ rest: take(K), out: null, dir: [p1[0] - p0[0], p1[2] - p0[2]], slide: half - 0.02, at: [mid[0], mid[2]], way, to: k.to });
    }
    // the reader, on whichever side of the doorway has the wall for it
    const { R, c, pad } = readerFrame(L, o, F);
    const fb = (b0, b1, p0, p1, y0, y1, hex, kk = 1, surf = MAT.METAL) => fixedK.box(...R.span(b0, b1, p0, p1), y0, y1, hex, kk, null, surf);
    // a keypad where there's no wall for the card: a steel housing whose face is the page (room-lock.js keypad)
    if (pad) {
      fb(c - 0.08, c + 0.08, -0.01, 0, 1.08, 1.5, STEEL_DARK, 1, MAT.MATTE);
      fb(c - 0.085, c + 0.085, -0.03, -0.01, 1.47, 1.5, STEEL);
      fb(c - 0.02, c + 0.02, -0.032, -0.03, 1.48, 1.49, k.lock === false ? '#37d6ff' : hue, 1.7, MAT.EMISSIVE);
    } else {
    fb(c - 0.075, c + 0.075, -0.035, 0, 1.14, 1.5, STEEL_DARK);
    fb(c - 0.06, c + 0.06, -0.042, -0.035, 1.2, 1.44, PLATE);
    fb(c - 0.035, c + 0.035, -0.047, -0.042, 1.3, 1.37, k.lock === false ? '#37d6ff' : hue, 1.7, MAT.EMISSIVE);
    // the two emitters the hologram hangs between
    fb(c - 0.085, c + 0.085, -0.075, -0.03, 1.5, 1.525, STEEL);
    fb(c - 0.085, c + 0.085, -0.075, -0.03, 1.115, 1.14, STEEL);
    }
    // [top left, top right, bottom right, bottom left] of a panel `w` wide and `h` tall, its middle at
    // (along, y), `off` into the room
    const quad = (Q, along, y, w, h, off) => [Q.world(along - w / 2, -off, y + h / 2), Q.world(along + w / 2, -off, y + h / 2), Q.world(along + w / 2, -off, y - h / 2), Q.world(along - w / 2, -off, y - h / 2)];
    // on a hall's side wall, across the hall is only 1.5 m
    const stand = R.uv(c, R === F ? -0.9 : -0.6), door = F.uv(m, -0.2);
    panels.push({
      to: k.to,
      // the reader's card, and the wider board the bypass is played on, hung in front of the door itself
      card: pad ? quad(R, c, 1.27, 0.15, 0.36, PAD_OFF) : quad(R, c, 1.38, 0.45, 0.6, HOLO_OFF),
      pad: !!pad,
      board: quad(F, m, 1.42, Math.min(1.1, (o.b - o.a) + 0.24), 0.66, 0.3),
      at: stand,          // where you'd stand to use it, [u, v]
      door,               // just inside the doorway, [u, v]
      mid: pad ? R.world(c, -PAD_OFF, 1.27) : R.world(c, -HOLO_OFF, 1.38),
      // the way the card faces: off the wall, into the room. It's read from that side only.
      face: (() => { const a = R.world(c, 0, 0), b = R.world(c, -1, 0); return [b[0] - a[0], b[2] - a[2]]; })(),
    });
  });
  for (const l of leaves) l.out = new Float32Array(l.rest.length);
  return { leaves, fixed: take(fixedK), panels };
}
