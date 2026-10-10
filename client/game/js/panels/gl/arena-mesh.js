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

import { V, clamp, lerp, rotZ } from '../rink/util.js';

export const STRIDE = 13;

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
function emitGrid(b, g, S, rows, c, uv, vrow) {
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
const CAGE = rgb('#c6ccd2'), CAGE_GK = rgb('#1b1e23'), PAD = rgb('#eef0f2'), EYE = rgb('#1b1012');

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

// One skater, goalie, official or medic. `b` takes everything but the jersey; `bt` (the
// textured batch) takes the torso. `o` is the same options object figure.js reads, plus
// `slot` (the atlas rectangle) and `detail` (0 far, 1 near) for the small things.
export function buildBody(b, bt, J, o) {
  for (let i = 0; i < 18; i++) if (!J[i] || !Number.isFinite(J[i][0])) return;
  const K = o.kit, gk = !!o.goalie, missing = o.missing || {}, det = o.detail ?? 1;
  const seg = det ? 8 : 6;
  const jersey = rgb(K.jersey), trim = rgb(K.trim), pants = rgb(K.pants), sock = rgb(K.sock), glove = rgb(K.glove), helmet = rgb(gk ? '#eef0f2' : K.helmet), skin = rgb(o.skin || '#e0b08c');
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
    const fw = V.norm([T[0] - A[0], T[1] - A[1], 0]);
    const heel = [A[0] - fw[0] * 0.24, A[1] - fw[1] * 0.24, 0.3], toeC = [T[0] + fw[0] * 0.02, T[1] + fw[1] * 0.02, 0.19];
    tube(b, heel, toeC, 0.16, 0.12, BOOT, seg);
    tube(b, V.add(A, [0, 0, 0.05]), [A[0] + fw[0] * 0.12, A[1] + fw[1] * 0.12, 0.34], 0.19, 0.16, BOOT, seg);
    box(b, [heel[0], heel[1], 0.1], [toeC[0], toeC[1], 0.09], 0.035, 0.07, HOLDER, [0, 0, 1]);
    box(b, [heel[0] - fw[0] * 0.08, heel[1] - fw[1] * 0.08, 0.025], [toeC[0] + fw[0] * 0.14, toeC[1] + fw[1] * 0.14, 0.025], 0.012, 0.025, STEEL, [0, 0, 1]);
    if (gk) {
      const top = V.add(J[kn], [0, 0, 0.35]), bot = V.add(A, [0, 0, -0.15]);
      tube(b, top, bot, 0.5, 0.46, PAD, seg);
      band(b, top, bot, 0.5, 0.46, 0.14, 0.16, jersey, seg); band(b, top, bot, 0.5, 0.46, 0.27, 0.1, jersey, seg); band(b, top, bot, 0.5, 0.46, 0.62, 0.06, trim, seg);
      tube(b, J[hip], J[kn], 0.48, 0.44, rgb('#e3e6e9'), seg);
    } else {
      tube3(b, J[kn], A, 0.3, 0.26, 0.2, sock, 0.4, seg);
      band(b, J[kn], A, 0.3, 0.2, 0.3, 0.11, trim, seg); band(b, J[kn], A, 0.3, 0.2, 0.45, 0.11, trim, seg);
      const thighEnd = V.lerp(J[hip], J[kn], 0.9);
      tube(b, J[hip], thighEnd, 0.46, 0.41, pants, seg);
      band(b, J[hip], thighEnd, 0.46, 0.41, 0.95, 0.08, mix(pants, -0.45), seg);
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
    ellipsoid(b, V.add(S, V.mul(U, 0.02)), Ss, F, U, [0.3 * ar, 0.3 * ar, 0.28 * ar], jersey, 8, 5);
    if (missing[side > 0 ? 'armL' : 'armR'] && !gk) { stump(V.add(E, V.mul(dir, 0.15)), dir, 0.2); continue; }
    tube3(b, E, wrist, 0.23 * ar, 0.2 * ar, 0.23 * ar, jersey, 0.25, seg);
    if (!K.stripes) { band(b, E, wrist, 0.23 * ar, 0.23 * ar, 0.3, 0.1, trim, seg); band(b, E, wrist, 0.23 * ar, 0.23 * ar, 0.48, 0.06, trim, seg); }
    if (gk && side > 0) {
      disc(b, V.add(H, V.mul(dir, 0.15)), F, 0.66, mix(trim, -0.05), 16, 0.12);
    } else if (gk) {
      const up = V.norm(V.sub(U, V.mul(F, V.dot(U, F))));
      boxAxes(b, V.add(H, V.mul(F, 0.12)), V.cross(F, up), up, F, 0.38, 0.58, 0.06, rgb('#eceef1'));
    } else if (o.gloves !== false) {
      const cuff0 = V.sub(wrist, V.mul(dir, 0.14)), palm = V.add(H, V.mul(dir, 0.13));
      tube(b, cuff0, wrist, 0.22, 0.26, glove, seg);
      box(b, wrist, palm, 0.21, 0.17, mix(glove, 0.05));
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
    // the face pokes forward of the shell, which sits back and up on the skull
    ellipsoid(b, V.frame(Hc, Fh, 0.16, Uh, -0.2), Fh, Sd, Uh, [0.3, 0.3, 0.36], skin, det ? 10 : 7, det ? 7 : 5);
    if (o.helmet === false) {
      sphere(b, Hc, R * 0.86, skin, det ? 10 : 7, det ? 7 : 5);
      ellipsoid(b, V.frame(Hc, Fh, -0.08, Uh, 0.1), Fh, Sd, Uh, [R * 0.88, R * 0.9, R * 0.74], rgb(o.hair || '#2a1c14'), det ? 10 : 7, 5);
    } else {
      ellipsoid(b, V.frame(Hc, Fh, -0.06, Uh, 0.05), Fh, Sd, Uh, [R, R, R * 0.92], helmet, det ? 12 : 8, det ? 8 : 5);
    }
    if (det) {
      for (const sd of [0.13, -0.13]) sphere(b, V.frame(Hc, Fh, 0.43, Sd, sd, Uh, -0.16), 0.04, EYE, 6, 4);
      sphere(b, V.frame(Hc, Fh, 0.47, Uh, -0.3), 0.07, mix(skin, -0.12), 6, 4);
      if ((o.react || 0) > 0.15 || (o.blood || 0) > 0.25) box(b, V.frame(Hc, Fh, 0.46, Uh, -0.34), V.frame(Hc, Fh, 0.42, Uh, -0.62), 0.03, 0.02, rgb('#96080e'));
      if (o.helmet !== false && o.face !== 'visor') {
        // the cage: bars over the face, in the head's frame
        const R2 = R * 1.12, col = gk ? CAGE_GK : CAGE;
        const pt = (ang, u) => { const rad = R2 * (1 - Math.max(0, -u - 0.2) * 0.35); return V.frame(Hc, Fh, Math.cos(ang) * rad, Sd, Math.sin(ang) * rad, Uh, u); };
        for (const a of [-0.95, -0.55, -0.18, 0.18, 0.55, 0.95]) for (let u = -0.05; u > -0.6; u -= 0.15) tube(b, pt(a, u), pt(a, u - 0.15), 0.018, 0.018, col, 4);
        for (const u of [-0.08, -0.3, -0.5, -0.64]) for (let a = -1.05; a < 1.04; a += 0.3) tube(b, pt(a, u), pt(a + 0.3, u), 0.018, 0.018, col, 4);
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
    box(b, V.add(J[19], [0, 0, 0.13]), V.add(J[20], [0, 0, 0.13]), 0.03, 0.13, STICK, [0, 0, 1]);
    if (det) box(b, V.add(V.lerp(J[19], J[20], 0.15), [0, 0, 0.13]), V.add(V.lerp(J[19], J[20], 0.82), [0, 0, 0.13]), 0.034, 0.12, TAPE, [0, 0, 1]);
  }
  if (J.meta && J.meta.bottle) tube(b, J.meta.bottle, V.add(J.meta.bottle, [0, 0, -0.75]), 0.12, 0.13, rgb('#468cdc'), 8);
}

// A visor is see-through, so it goes in the transparent batch after the body is built.
export function buildVisor(b, o) {
  const v = o._visor; if (!v) return;
  const { Hc, Fh, Sd, Uh, R } = v, R2 = R * 1.12, c = [0.75, 0.88, 0.98, 0.22];
  const pt = (a, u) => V.frame(Hc, Fh, Math.cos(a) * R2, Sd, Math.sin(a) * R2, Uh, u);
  for (let i = 0; i < 8; i++) {
    const a0 = -1.15 + (i / 8) * 2.3, a1 = -1.15 + ((i + 1) / 8) * 2.3;
    quad(b, pt(a0, -0.3), pt(a1, -0.3), pt(a1, -0.04), pt(a0, -0.04), c, null, null);
  }
}

// A limb that came off: a chain of verlet points from sim.js.
export function buildSevered(b, l, o) {
  const K = o.kit, skin = rgb(o.skin || '#e0b08c'), pts = l.pts.map((p) => [p.x, p.y, p.z]);
  if (pts.some((p) => !Number.isFinite(p[0]))) return;
  if (l.part === 'head') {
    const c = pts[0];
    sphere(b, c, 0.47, o.helmet === false ? skin : rgb(K.helmet), 10, 7);
    const f = [Math.cos(l.rot || 0), Math.sin(l.rot || 0), 0];
    ellipsoid(b, V.add(c, V.mul(f, 0.2)), f, V.norm(V.cross([0, 0, 1], f)), [0, 0, 1], [0.28, 0.3, 0.34], skin, 8, 6);
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
