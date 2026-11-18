// ROOM · THE TRUCK SHED. A depot's shed on foot (`spec.bay`, room-layout.js bayOf) is the shed a truck drives into
// on the street: GLASS's drawVehicleBay, baked into client/shared/depot-shed.js (scripts/shapes/bake-depot-shed.mjs).
// This puts the bake into the room kit in place of the room's own floor, walls and ceiling: the tarmac and its
// paint, the steel walls, the rafters and the roof, the office, the bench, the racks, the hazard paint round the
// lift and the garage under the floor. Nothing here shapes the shed; it only cuts the walls round the room's
// doorways and hangs a fitting under each of the shed's high-bays.
//
// ⚠ THE PLATE ISN'T HERE IN THE ROOM YOU'RE IN. It rides the lift, so room-hoist.js draws it (shedPlate) where
// the lift is. A shed seen through a doorway has no lift running, so its plate is drawn here, flush.
import { MAT } from './ballpark-mesh.js';
import { legend } from '../../../../shared/legend-font.js';
import { DEPOT_SHED } from '../../../../shared/depot-shed.js';

const { MATTE, METAL, SATIN } = MAT;
const EPS_WALL = 0.2;   // metres: a face this close to a wall's plane and turned the same way is part of that wall

// Convex clip of [u, v, y] points against g(p) >= 0, g affine.
function clip(pts, g) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const A = pts[i], B = pts[(i + 1) % pts.length], ga = g(A), gb = g(B);
    if (ga >= 0) out.push(A);
    if ((ga >= 0) !== (gb >= 0)) { const t = ga / (ga - gb); out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]); }
  }
  return out;
}
const clipAll = (pts, gs) => { for (const g of gs) { pts = clip(pts, g); if (pts.length < 3) return null; } return pts; };

// Which wall a face is on, as { wall, along, hu, D }, or null: every point within EPS_WALL of the plane and the face
// turned along that wall's axis.
function wallOf(f, hu, D) {
  const [nu, , nv] = f.n;
  if (Math.abs(nv) > 0.9) {
    if (f.p.every((p) => p[1] < EPS_WALL)) return { wall: 'front', along: 0 };
    if (f.p.every((p) => p[1] > D - EPS_WALL)) return { wall: 'back', along: 0 };
  } else if (Math.abs(nu) > 0.9) {
    if (f.p.every((p) => p[0] < -hu + EPS_WALL)) return { wall: 'left', along: 1 };
    if (f.p.every((p) => p[0] > hu - EPS_WALL)) return { wall: 'right', along: 1 };
  }
  return null;
}
// A face on a wall, less the holes in that wall: each piece left of, right of, over and under every hole
function cutHoles(pts, holes, along) {
  let pieces = [pts];
  for (const q of holes) {
    const next = [];
    for (const P of pieces) {
      const lo = (p) => q.a - p[along], hi = (p) => p[along] - q.b, inA = (p) => p[along] - q.a, inB = (p) => q.b - p[along];
      for (const gs of [[lo], [hi], [inA, inB, (p) => p[2] - q.y1], [inA, inB, (p) => q.y0 - p[2]]]) {
        const c = clipAll(P, gs);
        if (c) next.push(c);
      }
    }
    pieces = next;
  }
  return pieces;
}

/**
 * The shed into the room's kit. `holes` is buildRoom's: per wall, the openings cut in it ({ a, b, y0, y1 }).
 * `plate` draws the lift's platform flush (a shed seen from next door). Pushes the high-bays onto `lamps`; `lampMat` is
 * the mesh's dimmable lamp face (gl/room-mesh.js LAMP).
 */
export function drawDepotShed(K, L, { holes = {}, lamps = [], lampOn = true, plate = false, lampMat } = {}) {
  const B = DEPOT_SHED, hu = L.w / 2, D = L.d;
  const put = (pts, n, col, mat) => {
    const N = K.nrmOf(n[0], n[1], n[2]);
    for (let i = 1; i + 1 < pts.length; i++) K.quad(K.solid, [pts[0], pts[i], pts[i + 1], pts[i + 1]], N, col, mat);
  };
  for (const f of B.faces) {
    if (f.part === 'plate' && !plate) continue;
    const col = K.C(f.c, 1);
    const flat = Math.abs(f.n[1]) > 0.9 && f.p.every((p) => Math.abs(p[2]) < 0.05);
    const mat = flat ? MATTE : f.part === 'below' ? MATTE : SATIN;
    let pts = f.p;
    if (f.part === 'plate') pts = pts.map((p) => [p[0], p[1], p[2] + B.lift.rise]);
    const W = !f.part && wallOf(f, hu, D);
    const cut = W ? (holes[W.wall] || []) : [];
    if (!cut.length) { put(pts, f.n, col, mat); continue; }
    for (const piece of cutHoles(pts, cut, W.along)) put(piece, f.n, col, mat);
  }
  // the bay legends stencilled on the floor, read by somebody facing the back wall (as the driver coming in does)
  for (const g of B.legends) {
    const [cu, cv] = g.at;
    legend({ plate: (ps, c) => K.quad(K.solid, ps.map(([a, b]) => [cu - a, cv + b, 0.034]), K.nrmOf(0, 1, 0), c, MATTE, null, true) },
      g.text, 0, 0, g.h, K.C(g.colour, 0.85), 0, 0);
  }
  // a high-bay under each of the shed's lamps: a steel reflector and the lamp in its mouth
  for (const [u, v, y] of B.lamps) {
    K.lathe(u, v, [[0.06, y + 0.42], [0.06, y + 0.16], [0.36, y - 0.02], [0.4, y - 0.08]], '#2e3236', 1, 16, METAL);
    K.lathe(u, v, [[0.004, B.ridge - 0.2], [0.004, y + 0.42]], '#202224', 0.9, 6);
    K.lathe(u, v, [[0, y - 0.04], [0.3, y - 0.04]], lampOn ? '#fff4dc' : '#bdb9af', lampOn ? 2.2 : 0.85, 16, lampOn ? lampMat : undefined);
    lamps.push({ p: L.world(u, v, y - 0.4), annex: false, k: 1.6 });
  }
}
