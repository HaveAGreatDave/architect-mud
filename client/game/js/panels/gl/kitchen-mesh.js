// GLASS 2 · THE KITCHEN'S GEOMETRY, AS TRIANGLES.
//
// The Kitchen Stage (gl/kitchen.js, docs/proposals/kitchen-stage.md) draws a counter in front of the
// stove: the board on the left, the hob in the middle, the pass on the right. This builds every
// piece of it into arena-mesh.js batches, so the rink's ink pass (gl/ink.js) outlines it unchanged.
//
// ⚠ NOTHING HERE TOUCHES WEBGL, the wall clock or Math.random. It fills Float32Arrays, so
// scripts/shapes/kitchen-smoke.mjs builds every form, cut and beat in node and checks the numbers.
//
// Units: centimetres, z up, x to the right along the counter, y away from the cook. The counter top
// is z = 0 and its front edge y = -FRONT.

import * as M from './arena-mesh.js';
import { footprint, cutPieces, centroid, bounds } from '../../../../shared/knife.js';
import { matterFor, beatOf } from '../../../../shared/kitchen-matter.js';

export const STRIDE = M.STRIDE;
export const FRONT = 30;                       // the counter's front edge, cm in front of its middle
export const STATIONS = { board: -55, hob: 0, pass: 55 };
export const BOARD = { w: 40, d: 26, h: 2.5 };
export const PLATE_R = 13;
const N0 = [0, 0, 0];

const C = {
  counter: M.rgb('#e6cfa4'), counterEdge: M.rgb('#cdb085'), wall: M.rgb('#efe3cc'),
  noren: M.rgb('#2b3a63'), norenBand: M.rgb('#f2ede2'), rod: M.rgb('#5a3a22'),
  board: M.rgb('#d9b47a'), boardEdge: M.rgb('#b98e52'),
  steel: M.rgb('#8e969e'), steelDark: M.rgb('#3a3e44'), grate: M.rgb('#24272b'),
  copper: M.rgb('#c3703e'), iron: M.rgb('#2e2f33'), handle: M.rgb('#4a2e1c'),
  plate: M.rgb('#f3f1ec'), slate: M.rgb('#2a2d33'), blade: M.rgb('#d6dde4'), bladeEdge: M.rgb('#f6f9fb'),
  knob: M.rgb('#1e2024'), knobMark: M.rgb('#f2ede2'),
  flameIn: [0.55, 0.75, 1.0, 1], flameOut: [0.25, 0.4, 0.95, 0.85],
  steam: M.rgb('#f6f6f2'), bubble: M.rgb('#fff8e8'),
  guide: M.rgb('#c8323a'), marker: M.rgb('#2b3a63'),
};
export const COLOURS = C;

// ── a pose: yaw about z, then roll about the piece's own x (a flip), then a move ─────────────────
export function pose(at = [0, 0, 0], yaw = 0, roll = 0, scale = 1) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll);
  const rot = (v) => {
    const x = v[0], y = v[1] * cr - v[2] * sr, z = v[1] * sr + v[2] * cr;
    return [x * cy - y * sy, x * sy + y * cy, z];
  };
  return {
    p: (v) => { const r = rot(v); return [at[0] + r[0] * scale, at[1] + r[1] * scale, at[2] + r[2] * scale]; },
    n: rot,
  };
}
const IDENT = pose();

// ── the prism: a convex footprint extruded, its edges rounded ─────────────────────────────────────
// `poly` is [[x, y], ...] in either winding; `h` the height; `bevel` the radius of the rounded
// edge, held to what the shape can take. Fan-triangulated caps, which is only right for a convex
// footprint (knife.js keeps every piece convex). Height is from z = 0 up, in the pose's frame.
const BEVEL_STEPS = [-90, -45, 0, 0, 45, 90].map((d) => (d * Math.PI) / 180);
export function prism(b, poly, h, bevel, c, P = IDENT) {
  const n = poly.length;
  if (n < 3 || !(h > 0)) return;
  let s = 0;
  for (let i = 0; i < n; i++) { const a = poly[i], q = poly[(i + 1) % n]; s += a[0] * q[1] - q[0] * a[1]; }
  const ccw = s > 0;
  const vn = [];
  let rmin = Infinity;
  const cen = centroid(poly);
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n], p = poly[i], q = poly[(i + 1) % n];
    const e1 = edgeNormal(a, p, ccw), e2 = edgeNormal(p, q, ccw);
    let nx = e1[0] + e2[0], ny = e1[1] + e2[1];
    const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    vn.push([nx, ny]);
    rmin = Math.min(rmin, Math.hypot(p[0] - cen[0], p[1] - cen[1]));
  }
  const r = Math.max(0, Math.min(bevel, h / 2, rmin * 0.45));
  // rings: positions and normals per vertex
  const rings = BEVEL_STEPS.map((th, k) => {
    const cos = Math.cos(th), sin = Math.sin(th), top = k >= 3;
    const z = top ? h - r + r * sin : r + r * sin;
    const inset = r * (1 - cos);
    return poly.map((p, i) => ({
      p: P.p([p[0] - vn[i][0] * inset, p[1] - vn[i][1] * inset, z]),
      n: P.n(norm3([vn[i][0] * cos, vn[i][1] * cos, sin])),
    }));
  });
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k], B = rings[k + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      M.tri(b, A[i].p, A[j].p, B[j].p, A[i].n, A[j].n, B[j].n, c);
      M.tri(b, A[i].p, B[j].p, B[i].p, A[i].n, B[j].n, B[i].n, c);
    }
  }
  const bot = rings[0], top = rings[rings.length - 1];
  const cb = P.p([cen[0], cen[1], 0]), ct = P.p([cen[0], cen[1], h]);
  const nd = P.n([0, 0, -1]), nu = P.n([0, 0, 1]);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    M.tri(b, cb, bot[j].p, bot[i].p, nd, nd, nd, c);
    M.tri(b, ct, top[i].p, top[j].p, nu, nu, nu, c);
  }
}
function edgeNormal(a, q, ccw) {
  const dx = q[0] - a[0], dy = q[1] - a[1], l = Math.hypot(dx, dy) || 1;
  return ccw ? [dy / l, -dx / l] : [-dy / l, dx / l];
}
function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

// A ring of tube: a burner, a pan's rim, a plate's lip.
export function ring(b, C0, R, r, c, seg = 20, P = IDENT) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    M.tube(b, P.p([C0[0] + Math.cos(a0) * R, C0[1] + Math.sin(a0) * R, C0[2]]), P.p([C0[0] + Math.cos(a1) * R, C0[1] + Math.sin(a1) * R, C0[2]]), r, r, c, 6);
  }
}

// An axis-aligned slab from its low corner to its high corner.
export function slab(b, lo, hi, c, bevel = 0.4) {
  const w = hi[0] - lo[0], d = hi[1] - lo[1];
  const poly = [[0, 0], [w, 0], [w, d], [0, d]];
  prism(b, poly, hi[2] - lo[2], bevel, c, pose(lo));
}

// ── food ─────────────────────────────────────────────────────────────────────────────────────────
// One piece of a food, at a pose. `piece` is a footprint polygon (whole, or one of knife.js's
// pieces); `whole` is the food's full footprint, which a dome-shaped food needs to know how tall
// this piece of it stands. `beat` picks the colour from the ramp, and cooking shrinks it.
const SHRINK_AT = { raw: 0, cook: 0.5, peak: 1, over: 1.15, burnt: 1.3 };
export function foodPiece(b, m, piece, whole, beat, P = IDENT, seed = 1) {
  // Gloss rides in the alpha (gl/kitchen.js says why): 1 is matt, 0.5 is a mirror.
  const f = m.form, base = M.rgb(m.ramp[beat] || m.ramp.raw);
  const c = [base[0], base[1], base[2], 1 - 0.5 * Math.max(0, Math.min(1, m.cook.gloss || 0))];
  const k = 1 - (m.cook.shrink || 0) * (SHRINK_AT[beat] ?? 0);
  const H = Math.max(0.3, f.h * (m.cook.shrink < 0 ? 1 - m.cook.shrink * (SHRINK_AT[beat] ?? 0) : k));
  switch (f.kind) {
    case 'grain': return grains(b, f, c, P, seed);
    case 'liquid': return pool(b, f, c, P);
    case 'cluster': return cluster(b, f, c, P, seed);
    default: break;
  }
  // piecesOf builds a fresh footprint each call, so a whole food is matched by its points, not identity.
  const isWhole = piece === whole || (piece.length === whole.length && piece.every((q, i) => q[0] === whole[i][0] && q[1] === whole[i][1]));
  // Raw, the outside is the skin and a cut face the flesh; once it cooks the ramp has it.
  const L = m.look || {}, raw = beat === 'raw';
  const tone = (hex) => { const t = M.rgb(hex); return [t[0], t[1], t[2], c[3]]; };
  const outside = raw && L.skin ? tone(L.skin) : c;
  if (isWhole && (f.kind === 'sphere' || f.kind === 'log')) {
    M.ellipsoid(b, P.p([0, 0, H / 2]), P.n([1, 0, 0]), P.n([0, 1, 0]), P.n([0, 0, 1]), [f.w / 2 * k, f.d / 2 * k, H / 2], outside, 22, 14);
    trim(b, f, L, k, H, P, seed, raw);
    return;
  }
  // A dome stands tallest in the middle: a slice off the end of a potato is shorter than one from
  // its waist. Slabs and blocks are as tall all over.
  let h = H;
  if (f.kind === 'sphere' || f.kind === 'log') {
    const bb = bounds(whole), hw = (bb.x1 - bb.x0) / 2 || 1, cx = centroid(piece)[0] - (bb.x0 + bb.x1) / 2;
    h = H * Math.max(0.35, Math.sqrt(Math.max(0, 1 - (cx / hw) ** 2)));
  }
  if (f.kind === 'leaf') h = Math.max(0.3, H * 0.25);
  const bevel = Math.max(0.15, (f.round ?? 0.5) * h * 0.45);
  const scaled = k === 1 ? piece : piece.map(([x, y]) => [x * k, y * k]);
  prism(b, scaled, h, bevel, isWhole ? outside : raw && L.flesh ? tone(L.flesh) : c, P);
  if (isWhole) trim(b, f, L, k, H, P, seed, raw);
}

// What makes a whole food that food and not its class: a stalk, speckles, stripes, a fish's fins.
// Drawn on the whole piece only; a cut piece is just its flesh.
function trim(b, f, L, k, H, P, seed, raw) {
  const rx = f.w / 2 * k, ry = f.d / 2 * k, rz = H / 2, round = f.kind === 'sphere' || f.kind === 'log';
  // a point on the surface, from an angle round z and a height fraction up the side
  const onSkin = (a, u) => {
    const z = u * 2 - 1, r = round ? Math.sqrt(Math.max(0, 1 - z * z)) : 1;
    return [Math.cos(a) * rx * r, Math.sin(a) * ry * r, rz + z * rz];
  };
  if (L.stripes) {
    const c = M.rgb(L.stripes);
    for (let i = 1; i <= 5; i++) {
      const x = -rx + (i / 6) * rx * 2, t = round ? Math.sqrt(Math.max(0, 1 - (x / rx) ** 2)) : 1;
      M.ellipsoid(b, P.p([x, 0, rz]), P.n([1, 0, 0]), P.n([0, 1, 0]), P.n([0, 0, 1]), [Math.max(0.25, rx * 0.05), ry * t * 1.03, rz * t * 1.03], c, 10, 6);
    }
  }
  if (L.spots) {
    // small and half sunk, so each reads as a mark on the skin rather than a bead stuck to it
    const c = M.rgb(L.spots), n = 16, sz = Math.max(0.12, Math.min(rx, ry, rz) * 0.07);
    for (let i = 0; i < n; i++) {
      const p = onSkin(hash01(seed, i * 3 + 40) * Math.PI * 2, 0.35 + hash01(seed, i * 3 + 41) * 0.62);
      M.ellipsoid(b, P.p([p[0] * 0.995, p[1] * 0.995, p[2]]), P.n([1, 0, 0]), P.n([0, 1, 0]), P.n([0, 0, 1]), [sz, sz, sz * 0.6], c, 6, 4);
    }
  }
  if (L.stem && raw) {
    const c = M.rgb(L.stem);
    // a long food carries its stalk at one end, a round one on top
    if (f.kind === 'log' && rx > ry * 1.6) M.tube(b, P.p([rx * 0.95, 0, rz]), P.p([rx * 1.18, 0, rz * 1.25]), 0.4, 0.25, c, 6);
    else M.tube(b, P.p([0, 0, H - 0.2]), P.p([0.25, 0.1, H + Math.max(0.6, H * 0.14)]), Math.max(0.2, rx * 0.06), 0.15, c, 6);
  }
  if (L.fins) {
    // a forked tail off the -x end and a fin along the back, both flat, so they draw both faces
    const c = M.rgb(L.fins), side = P.n([0, 1, 0]), dn = P.n([0, -1, 0]);
    const t0 = P.p([-rx * 0.92, 0, rz]), tA = P.p([-rx * 1.32, 0, rz + rz * 1.1]), tB = P.p([-rx * 1.32, 0, rz - rz * 0.9]), tM = P.p([-rx * 1.18, 0, rz]);
    M.tri(b, t0, tA, tM, side, side, side, c); M.tri(b, t0, tM, tA, dn, dn, dn, c);
    M.tri(b, t0, tM, tB, side, side, side, c); M.tri(b, t0, tB, tM, dn, dn, dn, c);
    const d0 = P.p([-rx * 0.35, 0, H * 0.92]), d1 = P.p([rx * 0.25, 0, H * 0.92]), dT = P.p([-rx * 0.15, 0, H + rz * 0.55]);
    M.tri(b, d0, d1, dT, side, side, side, c); M.tri(b, d0, dT, d1, dn, dn, dn, c);
  }
}

// ── packaging: a food on the counter in what it came in ──────────────────────────────────────────
// `look.pack` names it, `look.label` colours the lid or label, `look.size` scales it. The body is
// the food's raw colour where you'd see it (a jar, a bottle) and card or tin where you wouldn't.
const PACK_COL = { glass: [0.86, 0.9, 0.9, 0.55], tin: M.rgb('#a9b1b8'), paper: M.rgb('#c9ad7e'), card: M.rgb('#e8e0cf') };
export function shelfPiece(b, m, piece, whole, beat, P = IDENT, seed = 1) {
  const L = m.look || {};
  if (!L.pack) return foodPiece(b, m, piece, whole, beat, P, seed);
  const k = L.size || 1, food = M.rgb(m.ramp.raw), label = L.label ? M.rgb(L.label) : M.rgb('#d8d0c0');
  const up = P.n([0, 0, 1]), dn = P.n([0, 0, -1]);
  const can = (r, h, body, z0 = 0) => {
    M.tube(b, P.p([0, 0, z0]), P.p([0, 0, z0 + h]), r, r, body, 14);
    M.disc(b, P.p([0, 0, z0 + h]), up, r, body, 14, 0.05);
    M.disc(b, P.p([0, 0, z0]), dn, r, body, 14, 0.05);
  };
  const box = (w, d, h, col) => M.box(b, P.p([0, 0, 0]), P.p([0, 0, h]), w / 2, d / 2, col, P.n([0, 1, 0]));
  switch (L.pack) {
    case 'jar':
      can(3.4 * k, 7.5 * k, food);
      M.band(b, P.p([0, 0, 0]), P.p([0, 0, 7.5 * k]), 3.4 * k, 3.4 * k, 0.45, 3.2 * k, label, 14);
      can(3.6 * k, 1.4 * k, label, 7.5 * k);
      break;
    case 'bottle':
      can(3.4 * k, 15 * k, food);
      M.tube(b, P.p([0, 0, 15 * k]), P.p([0, 0, 19 * k]), 3.4 * k, 1.2 * k, food, 12);
      can(1.2 * k, 4 * k, food, 19 * k);
      can(1.35 * k, 1.4 * k, label, 23 * k);
      M.band(b, P.p([0, 0, 0]), P.p([0, 0, 15 * k]), 3.4 * k, 3.4 * k, 0.45, 6 * k, label, 14);
      break;
    case 'tin':
      can(3.8 * k, 10 * k, PACK_COL.tin);
      M.band(b, P.p([0, 0, 0]), P.p([0, 0, 10 * k]), 3.8 * k, 3.8 * k, 0.5, 8 * k, label, 16);
      break;
    case 'tub':
      can(5.5 * k, 6 * k, food);
      can(5.8 * k, 1 * k, label, 6 * k);
      break;
    case 'shaker':
      can(2.6 * k, 8.5 * k, food);
      M.ellipsoid(b, P.p([0, 0, 8.5 * k]), P.n([1, 0, 0]), P.n([0, 1, 0]), up, [2.7 * k, 2.7 * k, 1.6 * k], label, 12, 6);
      break;
    case 'sack':
      M.ellipsoid(b, P.p([0, 0, 5.5 * k]), P.n([1, 0, 0]), P.n([0, 1, 0]), up, [4.6 * k, 3.6 * k, 5.5 * k], L.label ? label : PACK_COL.paper, 12, 8);
      M.tube(b, P.p([0, 0, 10.5 * k]), P.p([0, 0, 12.5 * k]), 1.4 * k, 2.2 * k, L.label ? label : PACK_COL.paper, 8);
      break;
    case 'pouch':
      M.ellipsoid(b, P.p([0, 0, 1.4 * k]), P.n([1, 0, 0]), P.n([0, 1, 0]), up, [6 * k, 4.5 * k, 1.4 * k], label, 12, 6);
      break;
    case 'carton':
      box(7 * k, 7 * k, 17 * k, PACK_COL.card);
      M.band(b, P.p([0, 0, 0]), P.p([0, 0, 17 * k]), 3.6 * k, 3.6 * k, 0.5, 7 * k, label, 4);
      M.box(b, P.p([-3.5 * k, 0, 17 * k]), P.p([3.5 * k, 0, 17 * k]), 0.4 * k, 1.6 * k, PACK_COL.card, up);
      break;
    case 'box':
      box(12 * k, 4.5 * k, 16 * k, label);
      break;
    case 'tube':
      M.tube(b, P.p([-7 * k, 0, 1.6 * k]), P.p([6 * k, 0, 1.6 * k]), 0.5 * k, 1.6 * k, label, 10);
      M.tube(b, P.p([6 * k, 0, 1.6 * k]), P.p([7.6 * k, 0, 1.6 * k]), 0.9 * k, 0.9 * k, M.rgb('#f2f2f2'), 10);
      break;
    case 'wrap':
      // paper round a block: the food's shape in the label's colour
      foodPiece(b, { ...m, ramp: { ...m.ramp, raw: L.label || '#e9e4d6' }, look: {} }, piece, whole, 'raw', P, seed);
      break;
    default:
      foodPiece(b, m, piece, whole, beat, P, seed);
  }
}

// Grains: a low pile of small beads, laid out by a hash of the seed so it's the same pile every frame.
function grains(b, f, c, P, seed) {
  const n = 36, R = Math.min(f.w, f.d) / 2;
  for (let i = 0; i < n; i++) {
    const a = hash01(seed, i * 2) * Math.PI * 2, rr = Math.sqrt(hash01(seed, i * 2 + 1)) * R;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr, z = (1 - rr / R) * f.h * 0.8 + 0.4;
    M.ellipsoid(b, P.p([x, y, z]), P.n([Math.cos(a), Math.sin(a), 0]), P.n([-Math.sin(a), Math.cos(a), 0]), P.n([0, 0, 1]), [0.7, 0.35, 0.35], c, 6, 4);
  }
}
// A liquid: a flat surface the size of what holds it. The vessel draws its walls.
function pool(b, f, c, P) {
  const R = Math.min(f.w, f.d) / 2, seg = 24, top = P.p([0, 0, f.h]), nu = P.n([0, 0, 1]);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    M.tri(b, top, P.p([Math.cos(a0) * R, Math.sin(a0) * R, f.h]), P.p([Math.cos(a1) * R, Math.sin(a1) * R, f.h]), nu, nu, nu, c);
  }
}
// A head of garlic, a knob of ginger: a few lobes round a middle.
function cluster(b, f, c, P, seed) {
  const n = 5;
  M.ellipsoid(b, P.p([0, 0, f.h * 0.5]), P.n([1, 0, 0]), P.n([0, 1, 0]), P.n([0, 0, 1]), [f.w * 0.3, f.d * 0.3, f.h * 0.5], c, 10, 7);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + hash01(seed, i) * 0.4;
    M.ellipsoid(b, P.p([Math.cos(a) * f.w * 0.22, Math.sin(a) * f.d * 0.22, f.h * 0.42]), P.n([Math.cos(a), Math.sin(a), 0]), P.n([-Math.sin(a), Math.cos(a), 0]), P.n([0, 0, 1]), [f.w * 0.2, f.d * 0.16, f.h * 0.42], c, 8, 6);
  }
}
export function hash01(seed, i) {
  let x = (Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(i + 1, 0xc2b2ae35)) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; x ^= x >>> 12; x = Math.imul(x, 0x297a2d39) >>> 0; x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

// A whole food's pieces for a set of cuts, centred where the whole food sat. What the board draws
// after each stroke, and what the smoke gate checks.
export function piecesOf(m, cuts) {
  const whole = footprint(m.form);
  return { whole, pieces: cuts.length ? cutPieces(whole, cuts) : [whole] };
}

// The matter and beat for one workspace component, the one place the payload becomes a look.
export function lookOf(comp) {
  const m = matterFor(comp.profile, comp.matter);
  return { m, beat: beatOf(comp.cook, comp.state === 'cooked' || comp.state === 'a finished dish') };
}

// ── the set ──────────────────────────────────────────────────────────────────────────────────────
// What never moves: the counter, the wall, the noren, the board and the hob for this stove.
// `hob` is 'camp', 'domestic' or 'range', from the stove's tier.
export function buildSet(b, { hob = 'domestic' } = {}) {
  slab(b, [-95, -FRONT, -14], [95, 34, 0], C.counter, 0.8);
  slab(b, [-95, -FRONT - 0.6, -14], [95, -FRONT + 0.4, 0.4], C.counterEdge, 0.3);
  slab(b, [-120, 34, -14], [120, 38, 110], C.wall, 0.2);
  // the noren: four panels hanging from a rod above the pass-through
  M.tube(b, [-70, 32, 92], [70, 32, 92], 1.1, 1.1, C.rod, 8);
  for (let i = 0; i < 4; i++) {
    const x0 = -66 + i * 33;
    slab(b, [x0, 31, 46], [x0 + 31, 31.6, 91], C.noren, 0.1);
    slab(b, [x0, 30.8, 50], [x0 + 31, 31.0, 56], C.norenBand, 0.05);
  }
  // the board
  const bx = STATIONS.board;
  slab(b, [bx - BOARD.w / 2, -BOARD.d / 2, 0], [bx + BOARD.w / 2, BOARD.d / 2, BOARD.h], C.board, 0.6);
  slab(b, [bx - BOARD.w / 2 + 2, -BOARD.d / 2 - 0.2, 0.4], [bx + BOARD.w / 2 - 2, -BOARD.d / 2 + 0.2, BOARD.h - 0.4], C.boardEdge, 0.1);
  // the pass: a slate the plate is dressed on
  slab(b, [STATIONS.pass - 20, -16, 0], [STATIONS.pass + 20, 16, 1.2], C.slate, 0.4);
  hobSet(b, hob);
}

// Where the pan sits, and the knob that runs its ring.
export const BURNER = [STATIONS.hob, 0, 0];
export const KNOB = [STATIONS.hob + 19, -15, 2.5];   // on the hob top, front right of the live ring
// What the knob stands on: the hob's top, or the counter beside a camp burner.
export const knobBase = (hob) => (hob === 'camp' ? 0.5 : 3.0);

function hobSet(b, kind) {
  const x = STATIONS.hob;
  if (kind === 'camp') {
    // a single ring on three legs, standing on the counter
    slab(b, [x - 12, -12, 0], [x + 12, 12, 1], C.steelDark, 0.3);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      M.tube(b, [x + Math.cos(a) * 9, Math.sin(a) * 9, 1], [x + Math.cos(a) * 11, Math.sin(a) * 11, 6], 0.5, 0.5, C.grate, 6);
    }
    ring(b, [x, 0, 3], 4, 0.8, C.steel, 16);
  } else {
    // the live ring in front and the middle, two spare rings behind it
    const w = kind === 'range' ? 34 : 28;
    slab(b, [x - w, -22, 0], [x + w, 30, 2.5], kind === 'range' ? C.steelDark : C.steel, 0.5);
    for (const ox of [-w / 2 - 2, w / 2 + 2]) ring(b, [x + ox, 20, 2.8], 4.5, 0.7, C.grate, 14);
    // grates over the live ring
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      M.tube(b, [x + Math.cos(a) * 3, Math.sin(a) * 3, 3.6], [x + Math.cos(a) * 11, Math.sin(a) * 11, 3.6], 0.6, 0.6, C.grate, 6);
    }
    ring(b, [x, 0, 2.9], 4.5, 0.9, C.steel, 16);
  }
  // the knob's boss
  M.disc(b, [KNOB[0], KNOB[1], knobBase(kind) - 0.5], [0, 0, 1], 3.8, C.steelDark, 18, 0.4);
}

// Where food sits in a vessel, and how big a footprint fits.
export const PAN_Z = 4.2;
export function vesselSpec(kind) {
  switch (kind) {
    case 'pot': return { r: 11, wall: 14, base: PAN_Z, metal: C.steel, handles: 2 };
    case 'tray': return { r: 13, wall: 3, base: PAN_Z, metal: C.steel, handles: 0, square: true };
    case 'bowl': return { r: 10, wall: 7, base: PAN_Z, metal: C.plate, handles: 0, taper: 0.6 };
    case 'bread': return { r: 9, wall: 0, base: 1.2, metal: C.board, handles: 0 };
    default: return { r: 12, wall: 4, base: PAN_Z, metal: C.iron, handles: 1 };
  }
}
// A vessel at a pose: walls, base, rim and handle. Its own frame has the base's middle at z = 0.
export function vessel(b, kind, P = IDENT) {
  const s = vesselSpec(kind);
  if (s.wall <= 0) return;
  if (s.square) {
    const r = s.r;
    prism(b, [[-r, -r * 0.7], [r, -r * 0.7], [r, r * 0.7], [-r, r * 0.7]], s.wall, 0.6, s.metal, P);
    return;
  }
  const rb = s.r * (s.taper || 0.85);
  M.disc(b, P.p([0, 0, 0.3]), P.n([0, 0, 1]), rb, s.metal, 24, 0.6);
  M.tube(b, P.p([0, 0, 0]), P.p([0, 0, s.wall]), rb, s.r, s.metal, 24);
  ring(b, [0, 0, s.wall], s.r, 0.45, s.metal, 24, P);
  if (s.handles === 1) {
    M.tube(b, P.p([0, -s.r, s.wall * 0.7]), P.p([0, -s.r - 18, s.wall * 0.9 + 2]), 1.1, 1.3, C.handle, 8);
  } else if (s.handles === 2) {
    for (const sx of [-1, 1]) ring(b, [sx * (s.r + 2.5), 0, s.wall * 0.8], 2.2, 0.5, s.metal, 10, P);
  }
}

// The plate on the pass.
export function plate(b, P = IDENT) {
  M.disc(b, P.p([0, 0, 0.5]), P.n([0, 0, 1]), PLATE_R, C.plate, 28, 1);
  ring(b, [0, 0, 1.1], PLATE_R - 0.6, 0.6, C.plate, 28, P);
}

// The knife: a gyuto, its edge along the blade's bottom. `P` puts the heel at the origin, the
// blade running along +x, the spine up. The handle runs back along -x.
export function knife(b, P = IDENT) {
  prism(b, [[0, -0.12], [22, -0.12], [24, 0.0], [22, 0.12], [0, 0.12]], 4.6, 0.05, C.blade, P);
  M.tube(b, P.p([0, 0, 0.3]), P.p([22, 0, 0.3]), 0.15, 0.08, C.bladeEdge, 4);
  M.tube(b, P.p([-1, 0, 2.6]), P.p([-13, 0, 2.4]), 1.1, 1.25, C.handle, 8);
}

// The knob: a dial standing on the hob whose mark points at `level` of 0..10, off at the cook's
// left, wound clockwise. Seen from above.
export function knob(b, level, at = KNOB, base = 2.7) {
  const a = Math.PI * 1.25 - (Math.max(0, Math.min(10, level)) / 10) * Math.PI * 1.5;
  const top = base + 2.2;
  M.disc(b, [at[0], at[1], base + 1.1], [0, 0, 1], 2.8, C.knob, 18, 2.2);
  M.box(b, [at[0], at[1], top + 0.15], [at[0] + Math.cos(a) * 2.5, at[1] + Math.sin(a) * 2.5, top + 0.15], 0.35, 0.3, C.knobMark, [0, 0, 1]);
}

// ── things that move every frame ─────────────────────────────────────────────────────────────────
// A burner's flame: a crown of cones, unlit (a zero normal), taller the higher the dial. `t` is
// seconds, for the flicker; the caller hands it in. With a pan on, `ceiling` is its base: a flame
// that reaches it spreads out along the underside, and a high ring licks out past the rim.
export function flames(b, level, t, at = BURNER, ceiling = Infinity) {
  if (!(level > 0)) return;
  const n = 14, R = 4.5, h = 0.8 + level * 0.38;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, fl = 0.75 + 0.25 * Math.sin(t * 17 + i * 2.3);
    const base = [at[0] + Math.cos(a) * R, at[1] + Math.sin(a) * R, 3.1];
    const z = 3.1 + h * fl, over = Math.max(0, z - ceiling), out = R + h * 0.35 + over * 1.8;
    const tip = [at[0] + Math.cos(a) * out, at[1] + Math.sin(a) * out, Math.min(z, ceiling)];
    const s = [-Math.sin(a) * 0.7, Math.cos(a) * 0.7, 0];
    M.tri(b, [base[0] - s[0], base[1] - s[1], base[2]], [base[0] + s[0], base[1] + s[1], base[2]], tip, N0, N0, N0, i & 1 ? C.flameIn : C.flameOut);
  }
}
// A puff of steam or smoke, lit and inked like everything else: a few lumps, rising and swelling
// with its age 0..1.
export function puff(b, at, age, c = C.steam, size = 1) {
  const s = size * (0.6 + age * 1.6), k = Math.max(0, 1 - age);
  if (k <= 0.02) return;
  const col = [c[0], c[1], c[2], 1];
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + age * 1.3;
    M.sphere(b, [at[0] + Math.cos(a) * s * 0.4, at[1] + Math.sin(a) * s * 0.4, at[2] + age * 22 + i * s * 0.3], s * (0.55 + 0.15 * i) * (0.6 + 0.4 * k), col, 8, 5);
  }
}
// A bubble breaking on a liquid.
export function bubble(b, at, age, r = 0.6) {
  if (age >= 1) return;
  M.sphere(b, [at[0], at[1], at[2] + r * 0.3], r * (0.5 + age), C.bubble, 6, 4);
}
