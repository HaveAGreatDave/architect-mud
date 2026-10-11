// GLASS 2 · THE ARENA'S GEOMETRY, AS TRIANGLES.
//
// The 2-D rink (rink/figure.js) draws each man as shaded paths, a few hundred gradient
// fills a body, and a second time for his reflection. That is what dropped frames on a
// big hit. Here the same body is built as a few hundred lit triangles from the same 21
// joints, with the same proportions, and the GPU draws it twice (once mirrored in the ice)
// for next to nothing.
//
// ⚠ NOTHING HERE TOUCHES WEBGL. It fills Float32Arrays, so it runs in node and the smoke
// gate can build every body, ragdoll and severed limb and check the numbers are finite.
//
// Vertex layout, 13 floats: position (3), normal (3), colour RGBA (4), uv (2), texture
// weight (1). A zero normal means UNLIT (the crowd, the ads, a beacon): the shader takes
// the colour as it is. Texture weight 1 multiplies the colour by the batch's texture.

import { V, clamp, lerp, rotZ, footFrame } from '../rink/util.js';
import { rinkFace } from '../rink/faces.js';
import { headMesh, hairMesh, HEAD_FEAT } from '../actor-head.js';
import { maskColours } from '../rink/hud.js';

export const STRIDE = 13;

// ── THE HEAD, FROM THE STREET FIGURES' GENERATOR ──────────────────────────────────────────────
// When the renderer hands over `o.heads`, a body's head is a record for gl/arena-heads.js to draw
// (actor-head.js's skull, ears and hair, with a face from the atlas in actor-faces.js) instead of
// the primitives below, which stay for the smoke gate and anything else that asks for no records.
// The helmet, the cage and the visor are still built here, round the head.
// HEAD_S takes the generator's metres to the rink's feet, a little over life size so the head
// fills the helmet the old one was made for; HEAD_A is the point of the bind-space head that sits
// on the rig's head joint (the middle of the skull, between chin and crown).
export const HEAD_S = 3.2808 * 1.15;
const HEAD_A = [0, 1.635, -0.006];
// Where HEAD_A goes, forward and up of the head joint, in feet.
export const HEAD_AT = [0.02, -0.03];
// The helmet round it: the shell's middle (forward, up of the head joint), the front opening
// (the shell's quads facing further forward than HELM_OPEN and lower than the brow are left out)
// and the brim's height, which the cage and the visor hang from. ⚠ The arena smoke measures every
// haircut against this shell: move one number and run it.
export const HELM_C = [-0.02, 0.08], HELM_OPEN = 0.45, HELM_BROW = 0.15, BRIM_U = 0.12;
// How far in front of the head joint the cage and the visor stand at height `u`: off the face,
// pulled in toward the chin, and in to the shell at the brim.
export function faceRad(R, u) {
  return u > -0.05 ? R * (1.12 - 0.5 * (u + 0.05)) : R * 1.12 * (1 - Math.max(0, -u - 0.2) * 0.35);
}
// actor-head.js's hair styles are numbered: cropped, neat and parted, tousled, long, a quiff.
const TOUSLED = 2, LONG = 3, QUIFF = 4;
// The record: `M` takes a bind-space point (metres, Y up, facing +Z, left hand on +X) to the rink
// (feet, Z up), column-major for GL; `lv` is the level, `face` the player's pick (rink/faces.js),
// `hs` the hair mesh to draw. Under a helmet a quiff is cropped, since it stands out of the shell,
// and under a keeper's mask long hair is tucked in, since the backplate sits close.
// Fh, Sd and Uh are the head's forward, left and up, so the map has no mirror in it.
export function headRecord(C, Fh, Sd, Uh, o, lv = 1, blood = 0, helmet = false) {
  const s = HEAD_S, X = V.mul(Sd, s), Y = V.mul(Uh, s), Z = V.mul(Fh, s);
  const T = V.sub(C, V.add(V.add(V.mul(X, HEAD_A[0]), V.mul(Y, HEAD_A[1])), V.mul(Z, HEAD_A[2])));
  const face = rinkFace(o);
  return {
    M: new Float32Array([X[0], X[1], X[2], 0, Y[0], Y[1], Y[2], 0, Z[0], Z[1], Z[2], 0, T[0], T[1], T[2], 1]),
    lv, face, blood, hs: helmet && face.style === QUIFF ? 0 : helmet && o.goalie && face.style === LONG ? TOUSLED : face.style,
  };
}

const _rgb = new Map();
export function rgb(hex) {
  let v = _rgb.get(hex);
  if (v) return v;
  const s = String(hex || '#808080');
  let r = 0.5, g = 0.5, b = 0.5, a = 1;
  const m = s.match(/^rgba?\(([^)]+)\)/);
  if (m) { const p = m[1].split(',').map(Number); r = p[0] / 255; g = p[1] / 255; b = p[2] / 255; a = p.length > 3 ? p[3] : 1; }
  else { const n = parseInt(s.slice(1, 7), 16); r = ((n >> 16) & 255) / 255; g = ((n >> 8) & 255) / 255; b = (n & 255) / 255; }
  v = [r, g, b, a]; _rgb.set(hex, v);
  return v;
}
export const mix = (c, k) => (k >= 0 ? [c[0] + (1 - c[0]) * k, c[1] + (1 - c[1]) * k, c[2] + (1 - c[2]) * k, c[3]] : [c[0] * (1 + k), c[1] * (1 + k), c[2] * (1 + k), c[3]]);

// ── a growable batch ─────────────────────────────────────────────────────────
export function createBatch(cap = 1 << 15) {
  return { data: new Float32Array(cap * STRIDE), n: 0, uv: null };
}
export const reset = (b) => { b.n = 0; b.uv = null; return b; };
function grow(b, more) {
  const need = (b.n + more) * STRIDE;
  if (need <= b.data.length) return;
  const d = new Float32Array(Math.max(need, b.data.length * 2));
  d.set(b.data.subarray(0, b.n * STRIDE)); b.data = d;
}
function vert(b, p, n, c, u = 0, v = 0, t = 0) {
  const o = b.n * STRIDE, d = b.data;
  d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2];
  d[o + 3] = n[0]; d[o + 4] = n[1]; d[o + 5] = n[2];
  d[o + 6] = c[0]; d[o + 7] = c[1]; d[o + 8] = c[2]; d[o + 9] = c[3];
  d[o + 10] = u; d[o + 11] = v; d[o + 12] = t;
  b.n++;
}
const N0 = [0, 0, 0];

export function tri(b, p0, p1, p2, n0, n1, n2, c) { grow(b, 3); vert(b, p0, n0, c); vert(b, p1, n1, c); vert(b, p2, n2, c); }
// A flat quad, p0→p1→p2→p3 round its edge. `uv` is [u0, v0, u1, v1] across it for a textured
// batch; `n` null leaves it unlit.
export function quad(b, p0, p1, p2, p3, c, uv, n) {
  grow(b, 6);
  const nn = n === undefined ? V.norm(V.cross(V.sub(p1, p0), V.sub(p3, p0))) : n || N0;
  const t = uv ? 1 : 0, [u0, v0, u1, v1] = uv || [0, 0, 0, 0];
  vert(b, p0, nn, c, u0, v1, t); vert(b, p1, nn, c, u1, v1, t); vert(b, p2, nn, c, u1, v0, t);
  vert(b, p0, nn, c, u0, v1, t); vert(b, p2, nn, c, u1, v0, t); vert(b, p3, nn, c, u0, v0, t);
}

// An orthonormal pair perpendicular to `u`.
export function perp(u) {
  let p1 = V.cross(u, [0, 0, 1]);
  if (V.len(p1) < 0.2) p1 = V.cross(u, [1, 0, 0]);
  p1 = V.norm(p1);
  return [p1, V.cross(u, p1)];
}

// Unit circles and spheres, tabulated once per resolution: the builders run every frame for
// every man, so nothing in their inner loops calls sin/cos or allocates an array.
const _circ = new Map(), _sph = new Map();
function circ(seg) {
  let t = _circ.get(seg);
  if (!t) { t = new Float32Array((seg + 1) * 2); for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; t[i * 2] = Math.cos(a); t[i * 2 + 1] = Math.sin(a); } _circ.set(seg, t); }
  return t;
}
function sph(seg, rings) {
  const k = seg * 64 + rings;
  let t = _sph.get(k);
  if (!t) {
    t = new Float32Array((seg + 1) * (rings + 1) * 3);
    for (let j = 0; j <= rings; j++) for (let i = 0; i <= seg; i++) {
      const th = (j / rings) * Math.PI, ph = (i / seg) * Math.PI * 2, o = (j * (seg + 1) + i) * 3;
      t[o] = Math.sin(th) * Math.cos(ph); t[o + 1] = Math.sin(th) * Math.sin(ph); t[o + 2] = Math.cos(th);
    }
    _sph.set(k, t);
  }
  return t;
}
// One vertex from scalars, for the inner loops.
function vs(b, px, py, pz, nx, ny, nz, c, u = 0, v = 0, t = 0) {
  const o = b.n * STRIDE, d = b.data;
  d[o] = px; d[o + 1] = py; d[o + 2] = pz; d[o + 3] = nx; d[o + 4] = ny; d[o + 5] = nz;
  d[o + 6] = c[0]; d[o + 7] = c[1]; d[o + 8] = c[2]; d[o + 9] = c[3];
  d[o + 10] = u; d[o + 11] = v; d[o + 12] = t;
  b.n++;
}

// A tapered tube from A to B, smooth-shaded, open at the ends (joints are covered by the
// neighbouring part or a ball). `seg` sides.
export function tube(b, A, B, ra, rb, c, seg = 8) {
  const ux0 = B[0] - A[0], uy0 = B[1] - A[1], uz0 = B[2] - A[2], L = Math.hypot(ux0, uy0, uz0);
  if (!(L > 1e-4)) return;
  const ux = ux0 / L, uy = uy0 / L, uz = uz0 / L;
  // p1 = u × z (or u × x when u is near vertical), p2 = u × p1
  let ax = uy, ay = -ux, az = 0;
  if (ax * ax + ay * ay < 0.04) { ax = 0; ay = uz; az = -uy; }
  const al = Math.hypot(ax, ay, az); ax /= al; ay /= al; az /= al;
  const bx = uy * az - uz * ay, by = uz * ax - ux * az, bz = ux * ay - uy * ax;
  const sl = (ra - rb) / L, T = circ(seg);
  grow(b, seg * 6);
  for (let i = 0; i < seg; i++) {
    const c0 = T[i * 2], s0 = T[i * 2 + 1], c1 = T[i * 2 + 2], s1 = T[i * 2 + 3];
    const r0x = ax * c0 + bx * s0, r0y = ay * c0 + by * s0, r0z = az * c0 + bz * s0;
    const r1x = ax * c1 + bx * s1, r1y = ay * c1 + by * s1, r1z = az * c1 + bz * s1;
    let n0x = r0x + ux * sl, n0y = r0y + uy * sl, n0z = r0z + uz * sl; const l0 = Math.hypot(n0x, n0y, n0z); n0x /= l0; n0y /= l0; n0z /= l0;
    let n1x = r1x + ux * sl, n1y = r1y + uy * sl, n1z = r1z + uz * sl; const l1 = Math.hypot(n1x, n1y, n1z); n1x /= l1; n1y /= l1; n1z /= l1;
    const a0x = A[0] + r0x * ra, a0y = A[1] + r0y * ra, a0z = A[2] + r0z * ra, a1x = A[0] + r1x * ra, a1y = A[1] + r1y * ra, a1z = A[2] + r1z * ra;
    const b0x = B[0] + r0x * rb, b0y = B[1] + r0y * rb, b0z = B[2] + r0z * rb, b1x = B[0] + r1x * rb, b1y = B[1] + r1y * rb, b1z = B[2] + r1z * rb;
    vs(b, a0x, a0y, a0z, n0x, n0y, n0z, c); vs(b, b0x, b0y, b0z, n0x, n0y, n0z, c); vs(b, b1x, b1y, b1z, n1x, n1y, n1z, c);
    vs(b, a0x, a0y, a0z, n0x, n0y, n0z, c); vs(b, b1x, b1y, b1z, n1x, n1y, n1z, c); vs(b, a1x, a1y, a1z, n1x, n1y, n1z, c);
  }
}
// A tube in three stations, so it swells over a pad and tapers past it.
export function tube3(b, A, B, ra, rm, rb, c, tm = 0.45, seg = 8) {
  const M = V.lerp(A, B, tm);
  tube(b, A, M, ra, rm, c, seg); tube(b, M, B, rm, rb, c, seg);
}
// A band of colour round a tube at fraction t, `w` feet wide.
export function band(b, A, B, ra, rb, t, w, c, seg = 8) {
  const L = V.len(V.sub(B, A)) || 1, h = w / L / 2;
  const t0 = clamp(t - h, 0, 1), t1 = clamp(t + h, 0, 1);
  tube(b, V.lerp(A, B, t0), V.lerp(A, B, t1), lerp(ra, rb, t0) * 1.04, lerp(ra, rb, t1) * 1.04, c, seg);
}
// The grid of a closed surface is worked out once per vertex into scratch, then emitted as
// triangles by copying: each grid point is shared by six triangles.
let _g = new Float32Array(6 * 256);
function gridBuf(n) { if (_g.length < n * 6) _g = new Float32Array(n * 6 * 2); return _g; }
function emitGrid(b, g, S, rows, c, uv, vrow, skip = null) {
  const d = b.data;
  const put = (k, ri, ci) => {
    const o = b.n * STRIDE, q = k * 6;
    d[o] = g[q]; d[o + 1] = g[q + 1]; d[o + 2] = g[q + 2]; d[o + 3] = g[q + 3]; d[o + 4] = g[q + 4]; d[o + 5] = g[q + 5];
    d[o + 6] = c[0]; d[o + 7] = c[1]; d[o + 8] = c[2]; d[o + 9] = c[3];
    if (uv) { d[o + 10] = uv[0] + (uv[2] - uv[0]) * (ci / (S - 1)); d[o + 11] = uv[3] - (uv[3] - uv[1]) * (vrow ? vrow[ri] : ri / rows); d[o + 12] = 1; }
    else { d[o + 10] = 0; d[o + 11] = 0; d[o + 12] = 0; }
    b.n++;
  };
  for (let j = 0; j < rows; j++) for (let i = 0; i < S - 1; i++) {
    const k00 = j * S + i, k10 = k00 + 1, k01 = k00 + S, k11 = k01 + 1;
    if (skip && skip(k00, k11)) continue;
    put(k00, j, i); put(k01, j + 1, i); put(k11, j + 1, i + 1);
    put(k00, j, i); put(k11, j + 1, i + 1); put(k10, j, i + 1);
  }
}

// An ellipsoid in the frame (ax, ay, az) with radii r.
export function ellipsoid(b, C, ax, ay, az, r, c, seg = 10, rings = 7) {
  grow(b, seg * rings * 6);
  const T = sph(seg, rings), S = seg + 1, N = S * (rings + 1), g = gridBuf(N);
  const r0 = r[0], r1 = r[1], r2 = r[2];
  const xa = ax[0] * r0, xb = ax[1] * r0, xc = ax[2] * r0, ya = ay[0] * r1, yb = ay[1] * r1, yc = ay[2] * r1, za = az[0] * r2, zb = az[1] * r2, zc = az[2] * r2;
  const nxa = ax[0] / r0, nxb = ax[1] / r0, nxc = ax[2] / r0, nya = ay[0] / r1, nyb = ay[1] / r1, nyc = ay[2] / r1, nza = az[0] / r2, nzb = az[1] / r2, nzc = az[2] / r2;
  for (let k = 0; k < N; k++) {
    const x = T[k * 3], y = T[k * 3 + 1], z = T[k * 3 + 2], q = k * 6;
    g[q] = C[0] + xa * x + ya * y + za * z; g[q + 1] = C[1] + xb * x + yb * y + zb * z; g[q + 2] = C[2] + xc * x + yc * y + zc * z;
    const nx = nxa * x + nya * y + nza * z, ny = nxb * x + nyb * y + nzb * z, nz = nxc * x + nyc * y + nzc * z, l = Math.hypot(nx, ny, nz) || 1;
    g[q + 3] = nx / l; g[q + 4] = ny / l; g[q + 5] = nz / l;
  }
  emitGrid(b, g, S, rings, c, null);
}
export const sphere = (b, C, r, c, seg = 10, rings = 7) => ellipsoid(b, C, [1, 0, 0], [0, 1, 0], [0, 0, 1], [r, r, r], c, seg, rings);

// A helmet shell: the ellipsoid in the head's frame (forward, side, up) with the face open below
// the brow and the bottom open where the head comes in. `open` is how far forward the opening
// starts (0 is the sides, 1 straight ahead) and `brow` how high it reaches, both on the unit
// sphere. The generator's head goes inside it, so the face shows through the cage.
export function helmetShell(b, C, ax, ay, az, r, c, seg = 14, rings = 9, open = 0.45, brow = 0.15) {
  grow(b, seg * rings * 6);
  const T = sph(seg, rings), S = seg + 1, N = S * (rings + 1), g = gridBuf(N);
  for (let k = 0; k < N; k++) {
    const x = T[k * 3], y = T[k * 3 + 1], z = T[k * 3 + 2], q = k * 6;
    const p = V.frame(C, ax, x * r[0], ay, y * r[1], az, z * r[2]);
    const n = V.norm(V.add(V.add(V.mul(ax, x / r[0]), V.mul(ay, y / r[1])), V.mul(az, z / r[2])));
    g[q] = p[0]; g[q + 1] = p[1]; g[q + 2] = p[2]; g[q + 3] = n[0]; g[q + 4] = n[1]; g[q + 5] = n[2];
  }
  emitGrid(b, g, S, rings, c, null, null, (k00, k11) => {
    const x = (T[k00 * 3] + T[k11 * 3]) / 2, z = (T[k00 * 3 + 2] + T[k11 * 3 + 2]) / 2;
    return z < -0.6 || (x > open && z < brow);
  });
}
// ── THE GOALIE'S MASK ─────────────────────────────────────────────────────────────────────────
// A keeper wears a mask, not a helmet: a shell moulded round his face and skull, open in a
// cat-eye over the eyes, nose and mouth with a cage across it, a cup under the chin and a
// backplate behind, painted with his club's art (gl/arena.js paints it into a cell of the
// masks' texture). It's moulded to the generator's head itself: the head's reach in every
// direction from MASK_O, out by the padding and smoothed, so it fits the way a moulded mask
// does. Everything is worked out once a level in the head's frame (forward, left, up, in feet
// from the head joint) and only placed each frame.
//
// ⚠ THE OPENING HAS CLEAN EDGES BECAUSE THE GRID IS BENT TO IT. Rows run from the crown down
// and columns round from the back; the columns across the face are spaced along the opening's
// top and bottom edges and the rows across it along its sides, so the opening is whole quads.
// A grid cut across would leave a stepped edge.
export const MASK_O = [0.03, 0, -0.04];
export const MASK_EL_MIN = -1.25;
const MP_AZ = 36, MP_EL = 19, TAU2 = Math.PI * 2, HALF_PI = Math.PI / 2;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// bind space to the head's frame, as headRecord places it
const toHead = (P, i) => [HEAD_AT[0] + HEAD_S * (P[i * 3 + 2] - HEAD_A[2]), HEAD_S * (P[i * 3] - HEAD_A[0]), HEAD_AT[1] + HEAD_S * (P[i * 3 + 1] - HEAD_A[1])];
// The padding: the shell stands further off the chin, which a cup sits well clear of.
const maskPad = (az, el) => 0.055 + 0.05 * sstep(-0.6, -1.0, el) * (1 - sstep(0.5, 1.0, Math.abs(az)));
let _mp = null;
// The head's reach from MASK_O (skull, ears and the three haircuts that can be under a mask),
// in bins of 10° each way, and the shell's radius over it.
export function maskProfile() {
  if (_mp) return _mp;
  const reach = new Float32Array(MP_AZ * MP_EL).fill(-1);
  const take = (src, keep) => {
    for (let i = 0; i < src.P.length / 3; i++) {
      if (!keep(src, i)) continue;
      const p = toHead(src.P, i), f = p[0] - MASK_O[0], s = p[1] - MASK_O[1], u = p[2] - MASK_O[2];
      const h = Math.hypot(f, s), az = Math.atan2(s, f), el = Math.atan2(u, h), d = Math.hypot(h, u);
      const ia = ((Math.floor((az + Math.PI) / TAU2 * MP_AZ) % MP_AZ) + MP_AZ) % MP_AZ;
      const k = clamp(Math.round((el + HALF_PI) / Math.PI * (MP_EL - 1)), 0, MP_EL - 1) * MP_AZ + ia;
      if (d > reach[k]) reach[k] = d;
    }
  };
  take(headMesh(0), (m, i) => m.F[i] !== HEAD_FEAT.neck);
  // the cuts a mask goes over: a quiff is cropped and long hair tucked in (headRecord)
  for (let st = 0; st < 3; st++) take(hairMesh(st, 0), () => true);
  const at = (A, ia, ie) => A[clamp(ie, 0, MP_EL - 1) * MP_AZ + (((ia % MP_AZ) + MP_AZ) % MP_AZ)];
  // a bin no vertex fell in takes its neighbours' reach
  for (let pass = 0, empty = true; empty && pass < 40; pass++) {
    empty = false;
    const next = reach.slice();
    for (let ie = 0; ie < MP_EL; ie++) for (let ia = 0; ia < MP_AZ; ia++) {
      const k = ie * MP_AZ + ia;
      if (reach[k] >= 0) continue;
      let m = -1;
      for (let de = -1; de <= 1; de++) for (let da = -1; da <= 1; da++) m = Math.max(m, at(reach, ia + da, ie + de));
      next[k] = m; if (m < 0) empty = true;
    }
    reach.set(next);
  }
  const azOf = (ia) => -Math.PI + (ia + 0.5) * TAU2 / MP_AZ, elOf = (ie) => -HALF_PI + ie * Math.PI / (MP_EL - 1);
  let shell = new Float32Array(reach.length);
  for (let ie = 0; ie < MP_EL; ie++) for (let ia = 0; ia < MP_AZ; ia++) shell[ie * MP_AZ + ia] = reach[ie * MP_AZ + ia] + maskPad(azOf(ia), elOf(ie));
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(shell.length);
    for (let ie = 0; ie < MP_EL; ie++) for (let ia = 0; ia < MP_AZ; ia++) {
      let s = 0;
      for (let de = -1; de <= 1; de++) for (let da = -1; da <= 1; da++) s += at(shell, ia + da, ie + de);
      next[ie * MP_AZ + ia] = s / 9;
    }
    shell = next;
  }
  // smoothing mustn't pull it into the head anywhere
  for (let k = 0; k < shell.length; k++) shell[k] = Math.max(shell[k], reach[k] + 0.04);
  _mp = { reach, shell };
  return _mp;
}
// The shell's radius from MASK_O in a direction (azimuth from forward toward his left, elevation).
export function maskRadius(az, el) {
  const { shell } = maskProfile();
  const fa = (az + Math.PI) / TAU2 * MP_AZ - 0.5, fe = clamp((el + HALF_PI) / Math.PI * (MP_EL - 1), 0, MP_EL - 1);
  const a0 = Math.floor(fa), e0 = Math.min(MP_EL - 2, Math.floor(fe)), ta = fa - a0, te = fe - e0;
  const g = (ia, ie) => shell[ie * MP_AZ + (((ia % MP_AZ) + MP_AZ) % MP_AZ)];
  return lerp(lerp(g(a0, e0), g(a0 + 1, e0), ta), lerp(g(a0, e0 + 1), g(a0 + 1, e0 + 1), ta), te);
}
const maskPoint = (az, el) => {
  const r = maskRadius(az, el), ce = Math.cos(el);
  return [MASK_O[0] + r * ce * Math.cos(az), MASK_O[1] + r * ce * Math.sin(az), MASK_O[2] + r * Math.sin(el)];
};
// The opening, drawn on the face (side, up) and turned into directions from MASK_O: its top
// edge rises over each eye and dips at the bridge of the nose (the cat-eye), its bottom edge
// runs under the lower lip, and its sides follow the cheekbones down.
const maskDepth = (side) => 0.42 - 1.2 * side * side;
const maskTop = (sp) => [sp * 0.235, 0.06 + 0.04 * Math.sin(Math.PI * Math.abs(sp)) - 0.03 * Math.abs(sp) ** 3];
const maskBot = (sp) => [sp * 0.12, -0.35];
function faceDir(side, up) {
  const f = maskDepth(side) - MASK_O[0], s = side - MASK_O[1], u = up - MASK_O[2];
  return [Math.atan2(s, f), Math.atan2(u, Math.hypot(f, s))];
}
// how low the shell comes: under the chin at the front, the jaw at the sides, the nape behind
const maskEdge = (az) => -1.2 + 0.7 * (Math.abs(az) / Math.PI) ** 1.3;
// The mask's outline as directions [az, el], for whoever paints it (scripts/content/
// build-cphl-clubs.mjs authors each club's art in maskUV's flattening): the opening once
// round (its top edge from his right to his left, down his left side, back along the bottom,
// up his right side) and the shell's bottom edge from behind his right ear round to behind
// his left.
export function maskOutline(n = 16) {
  const at = (sp, t) => { const p = maskTop(sp), q = maskBot(sp); return faceDir(lerp(p[0], q[0], t), lerp(p[1], q[1], t)); };
  const opening = [];
  for (let i = 0; i <= n; i++) opening.push(at(-1 + (2 * i) / n, 0));
  for (let i = 1; i <= n; i++) opening.push(at(1, i / n));
  for (let i = n - 1; i >= 0; i--) opening.push(at(-1 + (2 * i) / n, 1));
  for (let i = n - 1; i > 0; i--) opening.push(at(-1, i / n));
  const edge = [];
  for (let i = 0; i <= 4 * n; i++) { const az = -Math.PI + (TAU2 * i) / (4 * n); edge.push([az, maskEdge(az)]); }
  return { opening, edge };
}
// The texture's flattening: x once round from the back of his right side, through the face
// (half way) and his left side, to the back again; y from the crown down to MASK_EL_MIN.
export const maskUV = (az, el) => [(az + Math.PI) / TAU2, (HALF_PI - el) / (HALF_PI - MASK_EL_MIN)];
// Two levels: columns round (NA), the opening's half-width in columns (io), and its top and
// bottom rows (jT, jB) of NE rows from the crown to the edge.
const MASK_LV = [{ NA: 20, io: 3, jT: 3, jB: 6, NE: 8 }, { NA: 40, io: 5, jT: 6, jB: 12, NE: 15 }];
function maskDir(L, i, j) {
  const c = i - L.NA / 2;
  const col = (sp) => {
    if (j <= L.jT) { const T = faceDir(...maskTop(sp)); return [T[0], lerp(HALF_PI, T[1], j / L.jT)]; }
    if (j <= L.jB) { const t = (j - L.jT) / (L.jB - L.jT), p = maskTop(sp), q = maskBot(sp); return faceDir(lerp(p[0], q[0], t), lerp(p[1], q[1], t)); }
    const B = faceDir(...maskBot(sp));
    return [B[0], lerp(B[1], maskEdge(B[0]), (j - L.jB) / (L.NE - L.jB))];
  };
  if (Math.abs(c) <= L.io) return col(c / L.io);
  // round the sides and the back: spread from the opening's edge column to the seam behind
  const sg = Math.sign(c), w = (Math.abs(c) - L.io) / (L.NA / 2 - L.io), E = col(sg);
  return [sg * (Math.abs(E[0]) + w * (Math.PI - Math.abs(E[0]))), lerp(E[1], lerp(HALF_PI, maskEdge(Math.PI), j / L.NE), w)];
}
const _mt = [];
// The template for a level: the shell's grid (positions, normals and texture coordinates, a
// column more than NA so the seam behind can take u = 0 and u = 1), which quads are the
// opening, the rim round the opening, the cage's bars and the throat guard's top edge.
export function maskTemplate(lv = 1) {
  if (_mt[lv]) return _mt[lv];
  const L = MASK_LV[lv], S = L.NA + 1, Rn = L.NE + 1, N = S * Rn;
  const pos = new Float32Array(N * 3), nrm = new Float32Array(N * 3), uv = new Float32Array(N * 2);
  const dirs = [];
  for (let j = 0; j < Rn; j++) for (let i = 0; i < S; i++) {
    const [az, el] = maskDir(L, i, j), k = j * S + i, p = maskPoint(az, el), t = maskUV(az, el);
    pos.set(p, k * 3); uv.set(t, k * 2); dirs.push([az, el]);
  }
  const P = (i, j) => { const k = (clamp(j, 0, L.NE) * S + i) * 3; return [pos[k], pos[k + 1], pos[k + 2]]; };
  for (let j = 0; j < Rn; j++) for (let i = 0; i < S; i++) {
    const k = j * S + i;
    if (j === 0) { nrm.set([0, 0, 1], k * 3); continue; }
    const il = i === 0 ? L.NA - 1 : i - 1, ir = i === L.NA ? 1 : i + 1;
    const di = V.sub(P(ir, j), P(il, j)), dj = V.sub(P(i, j + 1), P(i, j - 1));
    let n = V.norm(V.cross(di, dj));
    if (!Number.isFinite(n[0]) || V.len(n) < 0.5) n = V.norm(V.sub(P(i, j), MASK_O));
    if (V.dot(n, V.sub(P(i, j), MASK_O)) < 0) n = V.mul(n, -1);
    nrm.set(n, k * 3);
  }
  const c0 = L.NA / 2 - L.io, c1 = L.NA / 2 + L.io;
  const open = (i, j) => i >= c0 && i < c1 && j >= L.jT && j < L.jB;
  // the rim, once round the opening along the grid's own edge
  const rim = [];
  for (let i = c0; i <= c1; i++) rim.push(P(i, L.jT));
  for (let j = L.jT + 1; j <= L.jB; j++) rim.push(P(c1, j));
  for (let i = c1 - 1; i >= c0; i--) rim.push(P(i, L.jB));
  for (let j = L.jB - 1; j > L.jT; j--) rim.push(P(c0, j));
  // The cage spans the opening (a Coons patch on its four edges) and bulges forward over the
  // nose. Bars: one up the middle between the eyes, and below the eyes a grid; the eyes have
  // the cat-eye's open frames.
  const edgeAt = (sp, t) => { const p = maskTop(sp), q = maskBot(sp); return maskPoint(...faceDir(lerp(p[0], q[0], t), lerp(p[1], q[1], t))); };
  const T0 = edgeAt(-1, 0), T1 = edgeAt(1, 0), B0 = edgeAt(-1, 1), B1 = edgeAt(1, 1);
  const cage = (sp, t) => {
    const u = (sp + 1) / 2, top = edgeAt(sp, 0), bot = edgeAt(sp, 1), lft = edgeAt(-1, t), rgt = edgeAt(1, t);
    const p = [0, 1, 2].map((k) => (1 - t) * top[k] + t * bot[k] + (1 - u) * lft[k] + u * rgt[k]
      - ((1 - u) * (1 - t) * T0[k] + u * (1 - t) * T1[k] + (1 - u) * t * B0[k] + u * t * B1[k]));
    p[0] += 0.11 * (1 - sp * sp) ** 0.6 * Math.sin(Math.PI * t) ** 0.7;
    return p;
  };
  const line = (f, a, b, n) => Array.from({ length: n + 1 }, (_, k) => f(lerp(a, b, k / n)));
  const EYE_T = 0.38, bars = [line((t) => cage(0, t), 0, 1, lv ? 8 : 4)];
  for (const sp of lv ? [-0.7, -0.36, 0.36, 0.7] : [-0.5, 0.5]) bars.push(line((t) => cage(sp, t), EYE_T, 1, lv ? 5 : 2));
  for (const t of lv ? [EYE_T, 0.62, 0.84] : [EYE_T, 0.7]) bars.push(line((sp) => cage(sp, t), -1, 1, lv ? 10 : 4));
  // the throat guard hangs off the front of the chin cup
  const dangler = [];
  for (let i = c0 + 1; i <= c1 - 1; i++) dangler.push(P(i, L.NE));
  _mt[lv] = { L, S, rows: L.NE, pos, nrm, uv, dirs, open, rim, bars, dangler };
  return _mt[lv];
}
// The mask, placed on a keeper's head: the shell (painted, into `o.maskBatch` or `bt`, when the
// renderer gave him a cell of its mask texture, else plain into `b`), the rim and the cage into
// `b`. The throat guard is see-through, so it's left for buildVisor on `o._dangler`.
export function buildMask(b, bt, Hc, Fh, Sd, Uh, o, det) {
  const T = maskTemplate(det ? 1 : 0), slot = o.maskSlot, tb = slot ? o.maskBatch || bt : b;
  const col = slot ? [1, 1, 1, 1] : rgb(maskColours(o.kit).base), tw = slot ? 1 : 0;
  const [su0, sv0, su1, sv1] = slot || [0, 0, 0, 0];
  const S = T.S, pos = T.pos, nrm = T.nrm, uv = T.uv;
  const put = (k) => {
    const f = pos[k * 3], s = pos[k * 3 + 1], u = pos[k * 3 + 2], nf = nrm[k * 3], ns = nrm[k * 3 + 1], nu = nrm[k * 3 + 2];
    vs(tb, Hc[0] + Fh[0] * f + Sd[0] * s + Uh[0] * u, Hc[1] + Fh[1] * f + Sd[1] * s + Uh[1] * u, Hc[2] + Fh[2] * f + Sd[2] * s + Uh[2] * u,
      Fh[0] * nf + Sd[0] * ns + Uh[0] * nu, Fh[1] * nf + Sd[1] * ns + Uh[1] * nu, Fh[2] * nf + Sd[2] * ns + Uh[2] * nu,
      col, su0 + uv[k * 2] * (su1 - su0), sv0 + uv[k * 2 + 1] * (sv1 - sv0), tw);
  };
  grow(tb, (S - 1) * T.rows * 6);
  for (let j = 0; j < T.rows; j++) for (let i = 0; i < S - 1; i++) {
    if (T.open(i, j)) continue;
    const k00 = j * S + i, k10 = k00 + 1, k01 = k00 + S, k11 = k01 + 1;
    put(k00); put(k01); put(k11); put(k00); put(k11); put(k10);
  }
  const at = (p) => [Hc[0] + Fh[0] * p[0] + Sd[0] * p[1] + Uh[0] * p[2], Hc[1] + Fh[1] * p[0] + Sd[1] * p[1] + Uh[1] * p[2], Hc[2] + Fh[2] * p[0] + Sd[2] * p[1] + Uh[2] * p[2]];
  // (each piece runs a radius past its ends, so the joints close)
  const piece = (A, B, r, c, n) => { const d = V.sub(B, A), L = V.len(d) || 1, e = V.mul(d, r / L); tube(b, V.sub(A, e), V.add(B, e), r, r, c, n); };
  const rim = T.rim.map(at);
  for (let k = 0; k < rim.length; k++) piece(rim[k], rim[(k + 1) % rim.length], 0.024, MASK_RIM, det ? 5 : 3);
  for (const bar of T.bars) { const pts = bar.map(at); for (let k = 0; k + 1 < pts.length; k++) piece(pts[k], pts[k + 1], 0.016, CAGE_GK, det ? 4 : 3); }
  o._dangler = det ? { top: T.dangler.map(at), Fh, Uh } : null;
}

// An oriented box: centre, three unit axes, three half-sizes.
export function boxAxes(b, C, ax, ay, az, hx, hy, hz, c) {
  const P = (x, y, z) => V.frame(C, ax, x * hx, ay, y * hy, az, z * hz);
  const f = (n, a, bb, cc, d) => quad(b, a, bb, cc, d, c, null, n);
  f(az, P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1));
  f(V.mul(az, -1), P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1), P(-1, -1, -1));
  f(ax, P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1));
  f(V.mul(ax, -1), P(-1, 1, -1), P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1));
  f(ay, P(1, 1, -1), P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1));
  f(V.mul(ay, -1), P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1));
}
// A box from A to B with a half-width and half-height across it.
export function box(b, A, B, hw, hh, c, up) {
  const ax = V.sub(B, A), L = V.len(ax) || 1e-4, u = V.mul(ax, 1 / L);
  let p1, p2;
  if (up) { p2 = V.norm(V.sub(up, V.mul(u, V.dot(up, u)))); p1 = V.cross(p2, u); } else [p1, p2] = perp(u);
  boxAxes(b, V.lerp(A, B, 0.5), u, p1, p2, L / 2, hw, hh, c);
}
// A flat disc facing `n`.
export function disc(b, C, n, r, c, seg = 14, thick = 0.08) {
  const [p1, p2] = perp(n);
  const top = V.add(C, V.mul(n, thick / 2)), bot = V.sub(C, V.mul(n, thick / 2));
  grow(b, seg * 12);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const r0 = V.add(V.mul(p1, Math.cos(a0)), V.mul(p2, Math.sin(a0))), r1 = V.add(V.mul(p1, Math.cos(a1)), V.mul(p2, Math.sin(a1)));
    vert(b, top, n, c); vert(b, V.add(top, V.mul(r0, r)), n, c); vert(b, V.add(top, V.mul(r1, r)), n, c);
    const nb = V.mul(n, -1);
    vert(b, bot, nb, c); vert(b, V.add(bot, V.mul(r1, r)), nb, c); vert(b, V.add(bot, V.mul(r0, r)), nb, c);
  }
  tube(b, bot, top, r, r, c, seg);
}

// ── the body ─────────────────────────────────────────────────────────────────
// Torso cross-sections: [fraction pelvis→neck, half-width, half-depth, forward offset], the
// same table figure.js draws from.
const SK_RINGS = [[-0.14, 0.6, 0.42, 0.03], [0.3, 0.53, 0.38, 0.04], [0.64, 0.66, 0.45, 0.04], [0.78, 0.78, 0.5, -0.06], [0.9, 0.86, 0.44, -0.03], [1.03, 0.44, 0.32, -0.02]];
const GK_RINGS = [[-0.14, 0.72, 0.52, 0.04], [0.3, 0.72, 0.56, 0.08], [0.64, 0.86, 0.62, 0.1], [0.78, 0.98, 0.62, -0.02], [0.9, 1.08, 0.56, 0.02], [1.04, 0.52, 0.4, 0]];
const BOOT = rgb('#16171b'), HOLDER = rgb('#e7eaed'), STEEL = rgb('#cfd6dd'), STICK = rgb('#24262d'), TAPE = rgb('#f1f0ea'), RAW = rgb('#7a0a10'), BONE = rgb('#e9e1cf');
const CAGE = rgb('#c6ccd2'), CAGE_GK = rgb('#1b1e23'), PAD = rgb('#eef0f2'), EYE = rgb('#1b1012'), LINER = rgb('#141518'), MASK_RIM = rgb('#202226');

// The torso as a loft of elliptical rings, UV-mapped so the batch's texture (the jersey
// atlas) puts the number on the back and the crest on the chest. `slot` is the atlas
// rectangle [u0, v0, u1, v1] for this man.
function loft(b, rings, c, slot, seg = 16) {
  const last = rings.length - 1, S = seg + 1, g = gridBuf(S * rings.length), T = circ(seg);
  grow(b, last * seg * 6);
  for (let k = 0; k <= last; k++) {
    const r = rings[k], Sx = r.S, F = r.F, rs = r.rs, rf = r.rf;
    for (let i = 0; i < S; i++) {
      const ca = T[i * 2], sa = T[i * 2 + 1], q = (k * S + i) * 6;
      g[q] = r.c[0] + Sx[0] * ca * rs + F[0] * sa * rf; g[q + 1] = r.c[1] + Sx[1] * ca * rs + F[1] * sa * rf; g[q + 2] = r.c[2] + Sx[2] * ca * rs + F[2] * sa * rf;
      const nx = Sx[0] * ca / rs + F[0] * sa / rf, ny = Sx[1] * ca / rs + F[1] * sa / rf, nz = Sx[2] * ca / rs + F[2] * sa / rf, l = Math.hypot(nx, ny, nz) || 1;
      g[q + 3] = nx / l; g[q + 4] = ny / l; g[q + 5] = nz / l;
    }
  }
  // v follows each ring's height up the torso, so the number keeps its shape on the jersey
  const f0 = rings[0].f ?? 0, f1 = rings[last].f ?? last, vrow = rings.map((r, k) => ((r.f ?? k) - f0) / ((f1 - f0) || 1));
  emitGrid(b, g, S, last, c, slot || null, vrow);
}

// The frame of a glove closed round the stick, or null when the hand isn't on it: p1 runs
// along the knuckles (the shaft, squared to the forearm), p2 out of the back of the hand.
function gripFrame(J, H, dir) {
  if (!J[18] || !J[19]) return null;
  const s = V.norm(V.sub(J[19], J[18])), w = V.sub(H, J[18]), off = V.sub(w, V.mul(s, V.dot(w, s)));
  if (V.len(off) > 0.25) return null;
  let p1 = V.sub(s, V.mul(dir, V.dot(s, dir)));
  if (V.len(p1) < 0.15) return null;
  p1 = V.norm(p1);
  let p2 = V.cross(dir, p1);
  if (V.dot(p2, V.sub(H, J[1])) < 0) { p2 = V.mul(p2, -1); p1 = V.mul(p1, -1); }
  return [p1, p2];
}

// One skater, goalie, official or medic. `b` takes everything but the jersey; `bt` (the
// textured batch) takes the torso. `o` is the same options object figure.js reads, plus
// `slot` (the atlas rectangle) and `detail` (0 far, 1 near) for the small things.
export function buildBody(b, bt, J, o) {
  for (let i = 0; i < 18; i++) if (!J[i] || !Number.isFinite(J[i][0])) return;
  const K = o.kit, gk = !!o.goalie, missing = o.missing || {}, det = o.detail ?? 1;
  const seg = det ? 10 : 6;
  const jersey = rgb(K.jersey), trim = rgb(K.trim), pants = rgb(K.pants), sock = rgb(K.sock), glove = rgb(K.glove), helmet = rgb(gk ? maskColours(K).base : K.helmet), skin = rgb(o.skin || '#e0b08c');
  const U = V.norm(V.sub(J[2], J[0]));
  const ortho = (v) => V.norm(V.sub(v, V.mul(U, V.dot(v, U))));
  const Ss = ortho(V.sub(J[4], J[7])), Sh = ortho(V.sub(J[10], J[13]));
  const F = V.cross(Ss, U);
  const tl = V.len(V.sub(J[2], J[0]));
  const stump = (C, n, r) => { disc(b, C, n, r, RAW, 10, 0.06); if (det) disc(b, V.add(C, V.mul(n, 0.035)), n, r * 0.35, BONE, 8, 0.02); };

  // legs
  for (const [hip, kn, an, toe, side] of [[10, 11, 12, 16, 1], [13, 14, 15, 17, -1]]) {
    const A = J[an], T = J[toe];
    if (missing[side > 0 ? 'legL' : 'legR'] && !gk) {
      const thighEnd = V.lerp(J[hip], J[kn], 0.9);
      tube(b, J[hip], thighEnd, 0.46, 0.41, pants, seg); tube(b, thighEnd, J[kn], 0.3, 0.28, sock, seg);
      stump(J[kn], V.norm(V.sub(J[kn], J[hip])), 0.24);
      continue;
    }
    // the skate in the foot's own frame (rink/util.js): lifted with the foot, rolled onto its
    // edge with the shin. Standing, these are the old fixed heights.
    const fr = footFrame(A, T, J[kn]), at = fr.at;
    const heel = at(-0.24, 0, -0.25), toeC = at(0.76, 0, -0.36);
    tube(b, heel, toeC, 0.16, 0.12, BOOT, seg);
    tube(b, at(0, 0, 0.05), at(0.12, 0, -0.21), 0.19, 0.16, BOOT, seg);
    box(b, at(-0.24, 0, -0.45), at(0.76, 0, -0.46), 0.035, 0.07, HOLDER, fr.Z);
    box(b, at(-0.32, 0, -0.525), at(0.9, 0, -0.525), 0.012, 0.025, STEEL, fr.Z);
    if (det) {
      // the tongue up the front of the boot, and the tendon guard at the back
      box(b, at(0.14, 0, -0.31), at(0.2, 0, -0.03), 0.1, 0.03, mix(BOOT, 0.25), fr.X);
      box(b, at(-0.28, 0, -0.23), at(-0.31, 0, 0.07), 0.06, 0.025, mix(BOOT, 0.15), fr.X);
    }
    if (gk) {
      const top = V.add(J[kn], [0, 0, 0.35]), bot = V.add(A, [0, 0, -0.15]);
      tube(b, top, bot, 0.5, 0.46, PAD, seg);
      band(b, top, bot, 0.5, 0.46, 0.14, 0.16, jersey, seg); band(b, top, bot, 0.5, 0.46, 0.27, 0.1, jersey, seg); band(b, top, bot, 0.5, 0.46, 0.62, 0.06, trim, seg);
      tube(b, J[hip], J[kn], 0.48, 0.44, rgb('#e3e6e9'), seg);
    } else {
      tube3(b, J[kn], A, 0.3, 0.26, 0.2, sock, 0.4, seg);
      if (K.socks) for (const sb of K.socks) band(b, J[kn], A, 0.3, 0.2, sb.at, sb.w, rgb(sb.col), seg);
      else { band(b, J[kn], A, 0.3, 0.2, 0.3, 0.11, trim, seg); band(b, J[kn], A, 0.3, 0.2, 0.45, 0.11, trim, seg); }
      const thighEnd = V.lerp(J[hip], J[kn], 0.9);
      tube(b, J[hip], thighEnd, 0.46, 0.41, pants, seg);
      band(b, J[hip], thighEnd, 0.46, 0.41, 0.95, 0.08, mix(pants, -0.45), seg);
      // the stripe down the outside of the thigh
      if (det) { const out = V.mul(ortho(V.sub(J[hip], V.lerp(J[10], J[13], 0.5))), 0.44); box(b, V.add(J[hip], out), V.add(thighEnd, V.mul(out, 0.92)), 0.06, 0.02, trim, out); }
      if (det) tube(b, V.add(J[kn], V.add(V.mul(F, 0.17), [0, 0, 0.12])), V.add(J[kn], V.add(V.mul(F, 0.18), [0, 0, -0.2])), 0.14, 0.12, sock, 6);
    }
  }
  tube(b, J[10], J[13], gk ? 0.6 : 0.5, gk ? 0.6 : 0.5, pants, seg);
  if (!gk) tube(b, V.add(V.lerp(J[10], J[13], 0.5), V.add(V.mul(F, -0.2), [0, 0, 0.02])), V.add(V.lerp(J[10], J[13], 0.5), V.add(V.mul(F, -0.17), [0, 0, -0.38])), 0.33, 0.3, pants, seg);

  // torso
  const ju = o.jerseyUp || 0;
  const rings = (gk ? GK_RINGS : SK_RINGS).map(([f, rs, rf, off]) => {
    const S = V.norm(V.lerp(Sh, Ss, clamp(f, 0, 1))), Fr = V.cross(S, U);
    return { c: V.add(V.add(J[0], V.mul(U, f * tl)), V.mul(Fr, off)), S, F: Fr, rs, rf, f };
  });
  if (ju > 0.3) {
    const k = clamp((ju - 0.3) / 0.7, 0, 1);
    rings[5] = { ...rings[5], rs: lerp(0.5, 0.62, k), rf: lerp(0.34, 0.5, k) };
    rings.push({ c: V.add(J[3], [0, 0, 0.25 * k]), S: Ss, F, rs: 0.55 * k + 0.1, rf: 0.5 * k + 0.1, f: 1.25 });
  }
  loft(bt, rings, [1, 1, 1, 1], o.slot || null, det ? 16 : 12);

  // arms
  const ar = gk ? 1.3 : 1;
  for (const [sh, el, hd, side] of [[4, 5, 6, 1], [7, 8, 9, -1]]) {
    const S = J[sh], E = J[el], H = J[hd];
    const dir = V.norm(V.sub(H, E));
    const wrist = V.sub(H, V.mul(dir, gk ? 0.15 : 0.2));
    tube(b, V.add(S, V.mul(U, 0.04)), E, 0.28 * ar, 0.23 * ar, jersey, seg);
    // the shoulder pad under the sweater: a cap that sits up and out over the joint
    ellipsoid(b, V.add(V.add(S, V.mul(U, 0.06)), V.mul(Ss, side * 0.05)), Ss, F, U, [0.36 * ar, 0.34 * ar, 0.3 * ar], jersey, det ? 10 : 8, det ? 6 : 5);
    if (missing[side > 0 ? 'armL' : 'armR'] && !gk) { stump(V.add(E, V.mul(dir, 0.15)), dir, 0.2); continue; }
    tube3(b, E, wrist, 0.23 * ar, 0.2 * ar, 0.23 * ar, jersey, 0.25, seg);
    // the elbow pad under the sleeve
    if (det && !gk) ellipsoid(b, V.sub(E, V.mul(dir, 0.02)), dir, Ss, F, [0.22, 0.25, 0.25], jersey, 8, 5);
    if (K.sleeve) { for (const sb of K.sleeve) band(b, E, wrist, 0.23 * ar, 0.23 * ar, sb.at, sb.w, rgb(sb.col), seg); }
    else if (!K.stripes) { band(b, E, wrist, 0.23 * ar, 0.23 * ar, 0.3, 0.1, trim, seg); band(b, E, wrist, 0.23 * ar, 0.23 * ar, 0.48, 0.06, trim, seg); }
    if (gk && side > 0) {
      // the trapper: the cuff, the round pocket, the deep mitt
      const tc = V.add(H, V.mul(dir, 0.15));
      tube(b, V.sub(wrist, V.mul(dir, 0.2)), wrist, 0.32, 0.3, mix(trim, -0.05), seg);
      disc(b, tc, F, 0.62, mix(trim, -0.05), 18, 0.12);
      ellipsoid(b, V.add(tc, V.mul(F, 0.08)), V.cross(F, dir), dir, F, [0.42, 0.5, 0.16], mix(trim, 0.15), 10, 5);
    } else if (gk) {
      const up = V.norm(V.sub(U, V.mul(F, V.dot(U, F))));
      boxAxes(b, V.add(H, V.mul(F, 0.12)), V.cross(F, up), up, F, 0.38, 0.58, 0.06, rgb('#eceef1'));
    } else if (o.gloves !== false) {
      // a hockey glove: the gauntlet flaring open toward the elbow, a trim band round it,
      // the padded back of the hand with its finger rolls, and the thumb
      const cuff0 = V.sub(wrist, V.mul(dir, 0.3)), palm = V.add(H, V.mul(dir, 0.14));
      tube(b, cuff0, wrist, 0.3, 0.24, glove, seg);
      band(b, cuff0, wrist, 0.3, 0.24, 0.3, 0.07, trim, seg);
      // a glove gripping the stick: the knuckles run along the shaft and the back of the hand
      // faces out of the plane of forearm and shaft, so the fist closes round the stick
      const grip = gripFrame(J, H, dir);
      box(b, wrist, palm, 0.21, 0.17, mix(glove, 0.05), grip ? grip[1] : undefined);
      if (det) {
        const [p1, p2] = grip || perp(dir);
        for (let f = 0; f < 3; f++) { const at2 = V.add(V.lerp(wrist, palm, 0.35 + f * 0.25), V.mul(p2, 0.17)); box(b, V.sub(at2, V.mul(p1, 0.19)), V.add(at2, V.mul(p1, 0.19)), 0.045, 0.035, mix(glove, -0.18)); }
        tube(b, V.add(V.lerp(wrist, palm, 0.3), V.mul(p1, 0.2)), V.add(V.lerp(wrist, palm, 0.75), V.mul(p1, 0.26)), 0.07, 0.065, mix(glove, -0.08), 6);
      }
    } else {
      tube(b, wrist, H, 0.15, 0.14, skin, seg);
      box(b, V.sub(H, V.mul(dir, 0.05)), V.add(H, V.mul(dir, 0.22)), 0.15, 0.13, skin);
    }
  }

  // head
  const Hc = J[3];
  if (missing.head) stump(J[2], U, 0.24);
  else if (ju <= 0.3) {
    tube(b, J[2], V.add(Hc, V.mul(U, -0.28)), 0.2, 0.19, o.helmet === false ? skin : rgb('#202228'), seg);
    const look = J.meta && J.meta.look ? V.norm(J.meta.look) : V.norm([F[0], F[1], F[2] * 0.4 - 0.05]);
    const Fh = look, Sd = V.norm(V.cross([0, 0, 1], Fh)), Uh = V.cross(Fh, Sd);
    const R = gk ? 0.52 : 0.46;
    // The shell's middle. It sits forward and up of the head joint so the generator's brow and
    // crown and four of its five haircuts clear it (a quiff is drawn cropped, headRecord), and
    // the cage and the visor hang from its brim.
    const C0 = V.frame(Hc, Fh, HELM_C[0], Uh, HELM_C[1]);
    // a bloody nose and mouth when he's been hit, or is bleeding
    const bloody = (o.react || 0) > 0.15 || (o.blood || 0) > 0.25;
    // the generator's head as a record, or the old face poking forward of the shell
    if (o.heads) o.heads.push(headRecord(V.frame(Hc, Fh, HEAD_AT[0], Uh, HEAD_AT[1]), Fh, Sd, Uh, o, o.headLv ?? 1, bloody ? Math.min(1, 0.55 + (o.blood || 0)) : 0, o.helmet !== false));
    else ellipsoid(b, V.frame(Hc, Fh, 0.16, Uh, -0.2), Fh, Sd, Uh, [0.3, 0.3, 0.36], skin, det ? 10 : 7, det ? 7 : 5);
    if (o.helmet === false) {
      if (!o.heads) {
        sphere(b, Hc, R * 0.86, skin, det ? 10 : 7, det ? 7 : 5);
        ellipsoid(b, V.frame(Hc, Fh, -0.08, Uh, 0.1), Fh, Sd, Uh, [R * 0.88, R * 0.9, R * 0.74], rgb(o.hair || '#2a1c14'), det ? 10 : 7, 5);
      }
    } else if (o.heads && gk) {
      buildMask(b, bt, Hc, Fh, Sd, Uh, o, det);
    } else if (o.heads) {
      // open at the face, the generator's head inside it, the dark liner showing round the
      // opening
      helmetShell(b, C0, Fh, Sd, Uh, [R, R, R * 0.92], helmet, det ? 16 : 10, det ? 10 : 6, HELM_OPEN, HELM_BROW);
      if (det) helmetShell(b, C0, Fh, Sd, Uh, [R * 0.95, R * 0.95, R * 0.87], LINER, 12, 8, HELM_OPEN, HELM_BROW);
    } else {
      ellipsoid(b, C0, Fh, Sd, Uh, [R, R, R * 0.92], helmet, det ? 14 : 8, det ? 9 : 5);
    }
    if (o.helmet !== false) {
      if (det && !gk) {
        // the ridge over the crown, the ear guards over the ears, the strap under the chin
        ellipsoid(b, V.frame(C0, Fh, -0.02, Uh, R * 0.86), Fh, Sd, Uh, [R * 0.8, R * 0.22, R * 0.12], mix(helmet, 0.1), 10, 4);
        for (const sd of [1, -1]) disc(b, V.frame(Hc, Fh, -0.01, Sd, sd * R * 0.93, Uh, -0.09), V.mul(Sd, sd), 0.17, mix(helmet, -0.15), 10, 0.06);
        for (const sd of [1, -1]) tube(b, V.frame(Hc, Fh, 0, Sd, sd * R * 0.9, Uh, -0.24), V.frame(Hc, Fh, 0.2, Uh, -0.49), 0.02, 0.02, rgb('#16171b'), 4);
      }
    }
    if (det) {
      if (!o.heads) {
        for (const sd of [0.13, -0.13]) sphere(b, V.frame(Hc, Fh, 0.43, Sd, sd, Uh, -0.16), 0.04, EYE, 6, 4);
        sphere(b, V.frame(Hc, Fh, 0.47, Uh, -0.3), 0.07, mix(skin, -0.12), 6, 4);
        if (bloody) box(b, V.frame(Hc, Fh, 0.46, Uh, -0.34), V.frame(Hc, Fh, 0.42, Uh, -0.62), 0.03, 0.02, rgb('#96080e'));
      }
      if (o.helmet !== false && o.face !== 'visor' && !(gk && o.heads)) {
        // the cage: bars over the face, in the head's frame, clipped to the brim at the top
        const col = gk ? CAGE_GK : CAGE;
        const pt = (ang, u) => { const rad = faceRad(R, u); return V.frame(Hc, Fh, Math.cos(ang) * rad, Sd, Math.sin(ang) * rad, Uh, u); };
        for (const a of [-0.95, -0.55, -0.18, 0.18, 0.55, 0.95]) for (let i = 0; i < 5; i++) tube(b, pt(a, BRIM_U - i * 0.155), pt(a, BRIM_U - (i + 1) * 0.155), 0.018, 0.018, col, 4);
        for (const u of [BRIM_U, -0.1, -0.3, -0.5, -0.64]) for (let a = -1.05; a < 1.04; a += 0.3) tube(b, pt(a, u), pt(a + 0.3, u), 0.018, 0.018, col, 4);
      }
    }
    o._visor = o.helmet !== false && o.face === 'visor' ? { Hc, Fh, Sd, Uh, R } : null;
  }

  // stick
  if (J[18] && J[19] && J[20]) {
    const bend = J.meta && J.meta.bend;
    if (bend) { tube(b, J[18], bend, 0.07, 0.065, STICK, 6); tube(b, bend, J[19], 0.065, gk ? 0.09 : 0.06, STICK, 6); }
    else tube(b, J[18], J[19], 0.07, gk ? 0.09 : 0.06, STICK, 6);
    tube(b, J[18], V.lerp(J[18], J[19], 0.06), 0.08, 0.077, TAPE, 6);
    // the blade, curved: straight from the heel, then bending toward the toe. It lies in the
    // shaft's plane (blade and shaft are one piece), so it tips with the stick instead of
    // standing bolt upright whatever the stick is doing.
    const mid = V.lerp(J[19], J[20], 0.55), bl = V.sub(J[20], J[19]), nrm = V.norm([-bl[1], bl[0], 0]);
    const toe = V.add(J[20], V.mul(nrm, 0.12));
    const blU = V.norm(bl), shU = V.norm(V.sub(J[18], J[19])), upR = V.sub(shU, V.mul(blU, V.dot(shU, blU)));
    const bu = V.len(upR) > 0.2 ? V.norm(upR) : [0, 0, 1], o13 = V.mul(bu, 0.13), o12 = V.mul(bu, 0.12), o125 = V.mul(bu, 0.125);
    box(b, V.add(J[19], o13), V.add(mid, o13), 0.03, 0.13, STICK, bu);
    box(b, V.add(mid, o13), V.add(toe, o12), 0.03, 0.12, STICK, bu);
    if (det) { box(b, V.add(V.lerp(J[19], J[20], 0.15), o13), V.add(mid, o13), 0.034, 0.12, TAPE, bu); box(b, V.add(mid, o13), V.add(V.lerp(mid, toe, 0.7), o125), 0.034, 0.115, TAPE, bu); }
  }
  if (J.meta && J.meta.bottle) tube(b, J.meta.bottle, V.add(J.meta.bottle, [0, 0, -0.75]), 0.12, 0.13, rgb('#468cdc'), 8);
}

// A visor is see-through, so it goes in the transparent batch after the body is built, and so
// does a keeper's throat guard, hung off the front of his chin cup.
export function buildVisor(b, o) {
  const g = o._dangler;
  if (g) {
    const c = [0.8, 0.86, 0.92, 0.26], drop = (p, k) => V.frame(p, g.Fh, 0.06 * k, g.Uh, -0.24 * k);
    for (let i = 0; i + 1 < g.top.length; i++) {
      const a = g.top[i], d = g.top[i + 1];
      quad(b, drop(a, 0.5), drop(d, 0.5), d, a, c, null, null);
      quad(b, drop(a, 1), drop(d, 1), drop(d, 0.5), drop(a, 0.5), c, null, null);
    }
  }
  const v = o._visor; if (!v) return;
  const { Hc, Fh, Sd, Uh, R } = v, c = [0.75, 0.88, 0.98, 0.22];
  const pt = (a, u) => { const rad = faceRad(R, u); return V.frame(Hc, Fh, Math.cos(a) * rad, Sd, Math.sin(a) * rad, Uh, u); };
  // from the brim to the tip of the nose, curving in at the top to meet the shell
  for (let i = 0; i < 8; i++) {
    const a0 = -1.15 + (i / 8) * 2.3, a1 = -1.15 + ((i + 1) / 8) * 2.3;
    quad(b, pt(a0, -0.05), pt(a1, -0.05), pt(a1, BRIM_U), pt(a0, BRIM_U), c, null, null);
    quad(b, pt(a0, -0.26), pt(a1, -0.26), pt(a1, -0.05), pt(a0, -0.05), c, null, null);
  }
}

// A limb that came off: a chain of verlet points from sim.js.
export function buildSevered(b, l, o, bt = b) {
  const K = o.kit, skin = rgb(o.skin || '#e0b08c'), pts = l.pts.map((p) => [p.x, p.y, p.z]);
  if (pts.some((p) => !Number.isFinite(p[0]))) return;
  if (l.part === 'head') {
    const c = pts[0];
    const f = [Math.cos(l.rot || 0), Math.sin(l.rot || 0), 0], sd = V.norm(V.cross([0, 0, 1], f)), up = [0, 0, 1];
    if (o.heads) {
      // the generator's head, bloodied, in his helmet as it sat on him, so the face shows
      const helm = o.helmet !== false;
      o.heads.push(headRecord(V.frame(c, f, HEAD_AT[0], up, HEAD_AT[1]), f, sd, up, o, 1, 1, helm));
      if (helm && o.goalie) buildMask(b, bt, c, f, sd, up, o, 0);
      else if (helm) helmetShell(b, V.frame(c, f, HELM_C[0], up, HELM_C[1]), f, sd, up, [0.46, 0.46, 0.42], rgb(K.helmet), 10, 6, HELM_OPEN, HELM_BROW);
    } else {
      sphere(b, c, 0.47, o.helmet === false ? skin : rgb(K.helmet), 10, 7);
      ellipsoid(b, V.add(c, V.mul(f, 0.2)), f, sd, up, [0.28, 0.3, 0.34], skin, 8, 6);
    }
    disc(b, V.add(c, [0, 0, -0.42]), [0, 0, -1], 0.2, RAW, 10, 0.05);
    return;
  }
  if (l.part === 'armL' || l.part === 'armR') {
    const [e, h] = pts;
    tube(b, e, h, 0.28, 0.3, rgb(K.jersey), 8);
    if (o.gloves !== false) sphere(b, h, 0.3, rgb(K.glove), 8, 6); else sphere(b, h, 0.19, skin, 8, 6);
    disc(b, e, V.norm(V.sub(e, h)), 0.22, RAW, 10, 0.05);
    return;
  }
  const [k, a, t] = pts;
  tube(b, k, a, 0.3, 0.19, rgb(K.sock), 8);
  tube(b, a, t, 0.22, 0.15, BOOT, 8);
  disc(b, k, V.norm(V.sub(k, a)), 0.25, RAW, 10, 0.05);
}

// A flat ribbon through `pts`, turned to face `eye`, tapering from `w0` at the first point
// to `w1` at the last and fading from `c0` to `c1`. Unlit; for the tail a shot leaves.
export function ribbon(b, pts, eye, w0, w1, c0, c1) {
  const n = pts.length;
  if (n < 2) return;
  grow(b, (n - 1) * 6);
  const side = (i) => {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(n - 1, i + 1)], p = pts[i];
    const d = V.norm(V.sub(c, a)), e = V.norm(V.sub(eye, p)), s = V.cross(d, e), l = V.len(s);
    return l > 1e-4 ? V.mul(s, 1 / l) : [0, 0, 1];
  };
  let pa = null, pb = null, ca = null;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), w = lerp(w0, w1, t) / 2, sd = side(i);
    const qa = V.add(pts[i], V.mul(sd, w)), qb = V.sub(pts[i], V.mul(sd, w));
    const cc = [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t), lerp(c0[3], c1[3], t)];
    if (pa) {
      vert(b, pa, N0, ca); vert(b, pb, N0, ca); vert(b, qb, N0, cc);
      vert(b, pa, N0, ca); vert(b, qb, N0, cc); vert(b, qa, N0, cc);
    }
    pa = qa; pb = qb; ca = cc;
  }
}

// ── the arena's furniture ────────────────────────────────────────────────────
export function buildPuck(b, pk) {
  disc(b, [pk.x, pk.y, pk.z + 0.06], [0, 0, 1], 0.21, rgb('#0b0c0f'), 14, 0.11);
  disc(b, [pk.x, pk.y, pk.z + 0.118], [0, 0, 1], 0.17, rgb('#2c2f36'), 14, 0.005);
}
export function buildDebris(b, d, K) {
  if (d.kind === 'stick') {
    const dx = Math.cos(d.rot) * 2.3, dy = Math.sin(d.rot) * 2.3;
    tube(b, [d.x - dx, d.y - dy, d.z], [d.x + dx, d.y + dy, d.z], 0.06, 0.06, STICK, 5);
    box(b, [d.x + dx, d.y + dy, d.z + 0.06], [d.x + dx + Math.cos(d.rot + 1.5) * 0.9, d.y + dy + Math.sin(d.rot + 1.5) * 0.9, d.z + 0.06], 0.13, 0.03, STICK);
  } else if (d.kind === 'glove') {
    const f = [Math.cos(d.rot * 0.3), Math.sin(d.rot * 0.3), 0];
    boxAxes(b, [d.x, d.y, d.z], f, V.norm(V.cross([0, 0, 1], f)), [0, 0, 1], 0.38, 0.25, 0.14, rgb(K.glove));
  } else if (d.kind === 'helmet') {
    ellipsoid(b, [d.x, d.y, d.z + 0.05], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.44, 0.4, 0.3], rgb(K.helmet), 10, 5);
  }
}
export function buildStretcher(b, s) {
  const ch = Math.cos(s.h), sn = Math.sin(s.h), ax = [ch, sn, 0], ay = [-sn, ch, 0];
  boxAxes(b, [s.x, s.y, 1.6], ax, ay, [0, 0, 1], 3.2, 0.9, 0.05, rgb('#e9e5d8'));
  for (const sv of [-1, 1]) tube(b, V.frame([s.x, s.y, 1.6], ax, -3.9, ay, sv * 0.95), V.frame([s.x, s.y, 1.6], ax, 3.9, ay, sv * 0.95), 0.05, 0.05, rgb('#7a7466'), 5);
}

// The ice resurfacer, box for box the same machine render.js draws.
const ZB = [
  { b: [-6.1, -4.6, -3.7, 3.7, 0.12, 1.2], col: '#7d848c', bands: [[0.12, 0.35, '#2a2e34']] },
  { b: [-4.7, 4.7, -3.45, 3.45, 0.55, 2.7], col: '#eceff2', bands: [[1.45, 1.95, '#1f4fbf'], [0.55, 0.8, '#3a3f46']] },
  { b: [0.2, 4.75, -3.35, 3.35, 2.7, 5.9], col: '#f4f6f8', bands: [[5.55, 5.9, '#1f4fbf'], [2.7, 2.95, '#c9ced3']] },
  { b: [-4.05, -1.6, 0.2, 2.8, 2.7, 3.2], col: '#30343b' },
  { b: [-4.25, -3.85, 0.4, 2.6, 3.2, 4.9], col: '#30343b' },
  { b: [-3.6, -2.7, 0.95, 2.05, 3.2, 5.2], col: '#2c3a4e' },
  { b: [-1.0, -0.65, 1.25, 1.55, 2.7, 4.4], col: '#22262c' },
];
export function buildZamboni(b, bt, z, t) {
  const ch = Math.cos(z.h), sn = Math.sin(z.h), ax = [ch, sn, 0], ay = [-sn, ch, 0], az = [0, 0, 1];
  const W3 = (u, v, w) => [z.x + u * ch - v * sn, z.y + u * sn + v * ch, w];
  const bx = (u0, u1, v0, v1, z0, z1, col) => boxAxes(b, W3((u0 + u1) / 2, (v0 + v1) / 2, (z0 + z1) / 2), ax, ay, az, (u1 - u0) / 2, (v1 - v0) / 2, (z1 - z0) / 2, rgb(col));
  for (const o of ZB) {
    const [u0, u1, v0, v1, z0, z1] = o.b;
    bx(u0, u1, v0, v1, z0, z1, o.col);
    for (const [a0, a1, c] of o.bands || []) bx(u0 - 0.02, u1 + 0.02, v0 - 0.02, v1 + 0.02, a0, a1, c);
  }
  // the lettering on both flanks of the tank, from the label texture
  if (bt) for (const sv of [-1, 1]) {
    const v = sv * 3.37, u0 = sv > 0 ? 4.45 : 0.5, u1 = sv > 0 ? 0.5 : 4.45;
    quad(bt, W3(u0, v, 3.6), W3(u1, v, 3.6), W3(u1, v, 4.6), W3(u0, v, 4.6), [1, 1, 1, 1], [0, 0, 1, 1], V.mul(ay, sv));
  }
  for (const sv of [-1, 1]) for (const wu of [-3.0, 2.8]) disc(b, W3(wu, sv * 3.5, 0.95), V.mul(ay, sv), 0.95, rgb('#16181c'), 14, 0.5);
  sphere(b, W3(-3.15, 1.5, 5.75), 0.42, rgb('#d9a27e'), 8, 6);
  ellipsoid(b, W3(-3.15, 1.5, 5.9), ax, ay, az, [0.45, 0.45, 0.25], rgb('#1f4fbf'), 8, 4);
  // the beacon is lit from inside: an unlit vertex colour
  const on = Math.sin(t * 7) > 0, bcol = on ? [1, 0.75, 0.25, 1] : [0.55, 0.36, 0.1, 1];
  const c0 = b.n;
  boxAxes(b, W3(4.27, 0, 6.1), ax, ay, az, 0.18, 0.25, 0.18, bcol);
  for (let i = c0; i < b.n; i++) { const o = i * STRIDE; b.data[o + 3] = b.data[o + 4] = b.data[o + 5] = 0; }
}

// A net: red posts and crossbar, white base frame, and the mesh in the transparent batch
// (textured with the net pattern, so it reads as mesh rather than sheet).
export function buildNet(b, bt, gx, dir, midY, half, depth, height, bulge) {
  const red = rgb('#d42e28'), white = rgb('#f2f4f6');
  const a = [gx, midY - half, 0], c = [gx, midY + half, 0];
  tube(b, a, [gx, midY - half, height], 0.12, 0.12, red, 8);
  tube(b, c, [gx, midY + half, height], 0.12, 0.12, red, 8);
  tube(b, [gx, midY - half, height], [gx, midY + half, height], 0.12, 0.12, red, 8);
  const base = (k, bk, z) => [[gx, midY - half], [gx + dir * 1.6 * k, midY - half - 0.6], [gx + dir * (depth + bk) * k, midY - half + 1.4], [gx + dir * (depth + bk) * k, midY + half - 1.4], [gx + dir * 1.6 * k, midY + half + 0.6], [gx, midY + half]].map(([x, y]) => [x, y, z]);
  const lo = base(1, bulge, 0.05), hi = base(0.45, bulge * 0.5, height);
  for (let i = 0; i < 5; i++) tube(b, lo[i], lo[i + 1], 0.05, 0.05, white, 5);
  for (let i = 1; i < 5; i++) tube(b, hi[i], hi[i + 1], 0.04, 0.04, white, 5);
  if (!bt) return;
  const m = [1, 1, 1, 0.55];
  for (let i = 0; i < 5; i++) {
    const w = Math.hypot(lo[i + 1][0] - lo[i][0], lo[i + 1][1] - lo[i][1]);
    quad(bt, lo[i], lo[i + 1], hi[i + 1], hi[i], m, [0, 0, w * 2, height * 2]);
  }
  quad(bt, hi[1], hi[2], hi[3], hi[4], m, [0, 0, 4, 6]);
}
