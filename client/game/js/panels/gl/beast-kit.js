// THE BEAST KIT: animals and things built to the close-up figure's standard, for ROOM.
//
// The figure (figure.js) is lofts through measured stations with the muscles laid on as broad relief, lit in the
// comic manner and inked. An animal on the Room Stage was GLASS's fauna model: a few dozen flat facets sized for a
// hound seen from a cab. This is the same idea as the figure for anything that isn't a person: smooth lofts along a
// spine, limbs as tubes through their joints, superquadric blobs for skulls, paws, plates and machines, sheets for
// membranes, and tufts of fur. The detail is paint in the vertex colour (ribs, scars, stripes, a saddle) and small
// pieces (teeth, claws, brows, hackles), as the figure's is.
//
// ⚠ SMALL PIECES TAKE THE NORMAL OF WHAT THEY GROW FROM. The comic light steps on the normal, so a tuft or a toe lit
// by its own would throw its own hard shadow island, which is what the figure's form normals exist to stop. Pass
// `form` (a normal) to tube/blob and every vertex of the piece is lit as the surface under it.
//
// Units are metres. Model space is the figure's bind space: Y up, facing +Z, the animal's left on +X, the ground at
// y = 0. Nothing here knows any enemy: the builders take numbers, and a look is a set of them.
import { vtx, lin, MAT, createBatch } from './ballpark-mesh.js';
// the four-legged leg and its gaits (an import cycle: see the note at the top of beast-legs.js)
import { LEG_KEYS, quadLegs, footAt, bodyAt, bodyXf, mammalLeg } from './beast-legs.js';

// unlit, as it is: an eye that glows, a lamp, a hot seam (gl/room.js vMat 40)
export const GLOW = 40;
// burning and pulsing; a thin film whose hue turns with the angle; light through it (gl/beast-light.js)
export const PULSE = 47, FILM = 45, TRANSLUCENT = 46;
export { MAT };

// ── vectors ──────────────────────────────────────────────────────────────────────────────────────────
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const madd = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const smooth = (a, b, v) => { const k = clamp((v - a) / (b - a)); return k * k * (3 - 2 * k); };
// rotate v about a unit axis by angle a
export function rot(v, ax, a) {
  const c = Math.cos(a), s = Math.sin(a), d = dot(ax, v), x = cross(ax, v);
  return [v[0] * c + x[0] * s + ax[0] * d * (1 - c), v[1] * c + x[1] * s + ax[1] * d * (1 - c), v[2] * c + x[2] * s + ax[2] * d * (1 - c)];
}

// ── colour ───────────────────────────────────────────────────────────────────────────────────────────
// '#rrggbb' to the batch's linear colour; arrays pass through
export const C = (c) => (typeof c === 'string' ? lin(c) : c);
export const mix = (a, b, k) => { a = C(a); b = C(b); return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; };
export const shade = (a, k) => { a = C(a); return [a[0] * k, a[1] * k, a[2] * k]; };

// ── noise ────────────────────────────────────────────────────────────────────────────────────────────
function h3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// value noise, 0..1, smooth, one cell a unit
export function vnoise(p) {
  const x = Math.floor(p[0]), y = Math.floor(p[1]), z = Math.floor(p[2]);
  const f = [p[0] - x, p[1] - y, p[2] - z].map((v) => v * v * (3 - 2 * v));
  const l = (a, b, k) => a + (b - a) * k;
  const c = (i, j, k) => h3(x + i, y + j, z + k);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), f[0]), l(c(0, 1, 0), c(1, 1, 0), f[0]), f[1]), l(l(c(0, 0, 1), c(1, 0, 1), f[0]), l(c(0, 1, 1), c(1, 1, 1), f[0]), f[1]), f[2]);
}
export const fnoise = (p, s = 1) => 0.6 * vnoise(mul(p, s)) + 0.3 * vnoise(mul(p, s * 2.1)) + 0.1 * vnoise(mul(p, s * 4.3));
// a seeded generator, 0..1
export function rng(seed = 1) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ── the mesh ─────────────────────────────────────────────────────────────────────────────────────────
// Triangles in model space. `bone` tags what's added next, for a piece worn by a figure: the page or the stage
// carries each tagged triangle by that bone's 3×4 (toBatch). -1 is the model itself.
// `F` is each vertex's fur length (model units), set from `furLen` as it's made; furShells grows the coat from it.
export function beastMesh() { return { P: [], N: [], C: [], M: [], B: [], U: [], F: [], furLen: 0, bone: -1, pal: {}, halos: [], lights: [] }; }
export const triCount = (M) => M.M.length / 3;
// A colour for the shader's palette: 1 + r·65536 + g·256 + b in 8-bit sRGB (gl/beast-light.js unpack). 0 is none.
const _pack = new Map();
export function packCol(c) {
  if (c == null || c === false) return 0;
  if (typeof c === 'string') {
    let v = _pack.get(c);
    if (v === undefined) { v = 1 + parseInt(c.slice(1, 7), 16); _pack.set(c, v); }
    return v;
  }
  const e = (x) => Math.max(0, Math.min(255, Math.round(Math.pow(Math.max(0, x), 1 / 2.2) * 255)));
  return 1 + e(c[0]) * 65536 + e(c[1]) * 256 + e(c[2]);
}
// The creature's palette rules (M.pal): 'shade' and 'rim', each a colour or a function of the base (linear) to one.
// A piece's own 'shade'/'rim' options win over them.
function palAt(M, c, s, r) {
  const P = M.pal;
  const sv = s !== undefined && s !== null ? s : typeof P.shade === 'function' ? P.shade(c) : P.shade;
  const rv = r !== undefined && r !== null ? r : typeof P.rim === 'function' ? P.rim(c) : P.rim;
  return [packCol(sv), packCol(rv)];
}
function put(M, p, n, c, m, s, r) {
  const [ps, pr] = palAt(M, c, s, r);
  M.P.push(p[0], p[1], p[2]); M.N.push(n[0], n[1], n[2]); M.C.push(c[0], c[1], c[2]); M.M.push(m); M.B.push(M.bone); M.U.push(ps, pr);
  if (M.F) M.F.push(M.furLen || 0);
}
// what `fn` adds carries fur `len` long (0: bare), whatever the mesh was carrying
export function withFur(M, len, fn) {
  const was = M.furLen;
  M.furLen = len;
  try { return fn(); } finally { M.furLen = was; }
}
/**
 * Whatever `fn` adds goes uninked: a whisker, a hair, a painted stroke, a catchlight. The ink is pushed out from
 * a body by a fixed number of pixels, so a piece thinner than the line comes out as a black bar. The ink pass
 * leaves a vertex alone when its normal is shorter than 0.1 (ink.js), and the lit pass normalises the normal
 * before it uses it, so the piece's normals are shrunk to 0.05 and it's lit as it was.
 */
export function inkless(M, fn) {
  const from = M.N.length;
  withFur(M, 0, fn);
  for (let i = from; i < M.N.length; i++) M.N[i] *= 0.05;
}
/** A shadow rule: the base darkened by k and pulled t of the way to hue (the family's shadow colour). */
export const shadeTo = (hue, t = 0.55, k = 0.55) => (c) => mix(shade(c, k), C(hue), t);
// where the model stands now: triangles, halos and lights, for scaleFrom
export const mark = (M) => ({ t: triCount(M), h: M.halos.length, l: M.lights.length });
const colAt = (col, ...a) => C(typeof col === 'function' ? col(...a) : col);
const matAt = (mat, ...a) => (typeof mat === 'function' ? mat(...a) : mat);

// A grid of points, rows by columns (the columns wrapped when `wrap`), with normals from its own differences turned
// away from each row's centre. `form` is one normal for the lot (a piece lit as what it grows from).
function emitGrid(M, G, centres, colOf, matOf, { wrap = true, form = null, nrm = null, palOf = null } = {}) {
  const R = G.length, Q = G[0].length, NG = [];
  for (let i = 0; i < R; i++) {
    const row = [];
    for (let j = 0; j < Q; j++) {
      if (form) { row.push(form); continue; }
      const a = G[Math.min(R - 1, i + 1)][j], b = G[Math.max(0, i - 1)][j];
      const jp = wrap ? (j + 1) % Q : Math.min(Q - 1, j + 1), jm = wrap ? (j - 1 + Q) % Q : Math.max(0, j - 1);
      let n = cross(sub(a, b), sub(G[i][jp], G[i][jm]));
      const out = sub(G[i][j], centres[i]);
      if (vlen(n) < 1e-12) n = nrm ? nrm(i, j) : vlen(out) > 1e-9 ? out : [0, 1, 0];
      n = norm(n);
      if (dot(n, out) < 0) n = mul(n, -1);
      row.push(n);
    }
    NG.push(row);
  }
  const J = wrap ? Q : Q - 1;
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < J; j++) {
    const j1 = (j + 1) % Q, m = matOf(i, j);
    const v = [[i, j], [i, j1], [i + 1, j1], [i + 1, j]], c = v.map(([a, b]) => colOf(a, b)), pl = palOf ? palOf(i, j) : null;
    for (const k of [0, 1, 2, 0, 2, 3]) put(M, G[v[k][0]][v[k][1]], NG[v[k][0]][v[k][1]], c[k], m, pl?.[0], pl?.[1]);
  }
  return NG;
}

// Points along a Catmull-Rom through the control points, `seg` a span, each with u (control index + fraction).
function curve(ctrl, seg) {
  const pts = [], us = [];
  const cr = (p0, p1, p2, p3, f) => {
    const f2 = f * f, f3 = f2 * f;
    return [0, 1, 2].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * f + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f3));
  };
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let s = 0; s < seg; s++) { pts.push(cr(p0, p1, p2, p3, s / seg)); us.push(i + s / seg); }
  }
  pts.push(ctrl[ctrl.length - 1].slice()); us.push(ctrl.length - 1);
  return { pts, us };
}

// Keyframes [t, value] (or [t, [values]]) eased between: what a loft's sections are written in.
export function keys(K, t) {
  if (t <= K[0][0]) return K[0][1];
  for (let i = 1; i < K.length; i++) {
    if (t <= K[i][0]) {
      const [t0, a] = K[i - 1], [t1, b] = K[i], k = smooth(0, 1, (t - t0) / (t1 - t0 || 1));
      return Array.isArray(a) ? a.map((v, j) => v + (b[j] - v) * k) : a + (b - a) * k;
    }
  }
  return K[K.length - 1][1];
}

/**
 * A loft along a spine. `prof(t, u)` is the section at arc-length fraction t (u the control index): { w, h } its
 * half-width (along X, the side) and half-height (along Y, the up reference), `ox`/`oy` its offset from the spine,
 * `e` a superellipse exponent (2 an ellipse, higher boxier) and `b(a)` a radial bulge. `col(t, a, p)` and
 * `mat(t, a)` paint it; a is round the section, 0 on the left (+X), π/2 on top. Both ends are capped with a dome.
 * Returns `at(t, a)`: the surface point, its normal and the frame there, to put things on it.
 */
export function sweep(M, ctrl, prof, o = {}) {
  const seg = o.seg ?? 6, ring = o.ring ?? 14;
  const { pts, us } = curve(ctrl, seg), n = pts.length;
  const ts = [0];
  for (let k = 1; k < n; k++) ts.push(ts[k - 1] + vlen(sub(pts[k], pts[k - 1])));
  const total = ts[n - 1] || 1;
  for (let k = 0; k < n; k++) ts[k] /= total;
  const F = [];
  let prevX = null;
  for (let k = 0; k < n; k++) {
    const T = norm(sub(pts[Math.min(n - 1, k + 1)], pts[Math.max(0, k - 1)]));
    const U = typeof o.up === 'function' ? o.up(ts[k]) : o.up || [0, 1, 0];
    let X = cross(U, T);
    X = vlen(X) < 1e-4 ? prevX || [1, 0, 0] : norm(X);
    const Y = cross(T, X);
    prevX = X;
    F.push({ c: pts[k], T, X, Y, pr: prof(ts[k], us[k]), t: ts[k], u: us[k] });
  }
  const sp = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), 2 / e);
  const local = (f, a) => {
    const pr = f.pr, e = pr.e ?? 2, b = pr.b ? 1 + pr.b(a, f.t) : 1;
    return [(pr.ox || 0) + pr.w * sp(Math.cos(a), e) * b, (pr.oy || 0) + pr.h * sp(Math.sin(a), e) * b];
  };
  const point = (f, a) => { const [x, y] = local(f, a); return [f.c[0] + f.X[0] * x + f.Y[0] * y, f.c[1] + f.X[1] * x + f.Y[1] * y, f.c[2] + f.X[2] * x + f.Y[2] * y]; };
  const centre = (f) => madd(madd(f.c, f.X, f.pr.ox || 0), f.Y, f.pr.oy || 0);
  const A = Array.from({ length: ring }, (_, j) => (j / ring) * Math.PI * 2);
  const G = F.map((f) => A.map((a) => point(f, a))), cen = F.map(centre);
  const colOf = (i, j) => colAt(o.col || '#808080', F[i].t, A[j], G[i][j], F[i].u);
  const matOf = (i, j) => matAt(o.mat ?? MAT.MATTE, F[i].t, A[j]);
  const palOf = o.shade || o.rim ? (i, j) => [o.shade ? colAt(o.shade, F[i].t, A[j], G[i][j], F[i].u) : null, o.rim ? colAt(o.rim, F[i].t, A[j], G[i][j], F[i].u) : null] : null;
  const NG = emitGrid(M, G, cen, colOf, matOf, { form: o.form || null, palOf });
  // the caps: a low dome over each end, so a blunt end is round and a pointed one stays a point
  if (o.cap !== false) for (const [i, dir] of [[0, -1], [n - 1, 1]]) {
    const f = F[i], r = Math.min(f.pr.w, f.pr.h);
    if (r < 1e-4) continue;
    const tip = madd(cen[i], f.T, dir * r * (o.dome ?? 0.55)), tn = o.form || mul(f.T, dir), tc = colAt(o.col || '#808080', f.t, Math.PI / 2, tip, f.u), m = matOf(i, 0);
    for (let j = 0; j < ring; j++) {
      const j1 = (j + 1) % ring, a = G[i][j], b = G[i][j1];
      const na = o.form || norm(add(NG[i][j], tn)), nb = o.form || norm(add(NG[i][j1], tn));
      const ca = colOf(i, j), cb = colOf(i, j1);
      const pl = palOf ? palOf(i, j) : [null, null];
      if (dir > 0) { put(M, a, na, ca, m, pl[0], pl[1]); put(M, b, nb, cb, m, pl[0], pl[1]); put(M, tip, tn, tc, m, pl[0], pl[1]); }
      else { put(M, b, nb, cb, m, pl[0], pl[1]); put(M, a, na, ca, m, pl[0], pl[1]); put(M, tip, tn, tc, m, pl[0], pl[1]); }
    }
  }
  const at = (t, a) => {
    let k = 0;
    while (k < n - 2 && ts[k + 1] < t) k++;
    const f0 = F[k], f1 = F[k + 1], q = clamp((t - f0.t) / ((f1.t - f0.t) || 1));
    const p = lerp3(point(f0, a), point(f1, a), q), c = lerp3(centre(f0), centre(f1), q);
    const X = norm(lerp3(f0.X, f1.X, q)), Y = norm(lerp3(f0.Y, f1.Y, q)), T = norm(lerp3(f0.T, f1.T, q));
    const w = f0.pr.w + (f1.pr.w - f0.pr.w) * q, h = f0.pr.h + (f1.pr.h - f0.pr.h) * q;
    const nn = norm(add(mul(X, Math.cos(a) * h), mul(Y, Math.sin(a) * w)));
    return { p, n: nn, c, X, Y, T, w, h };
  };
  return { at, frames: F };
}

/** A tube through `ctrl` with a radius at each control point; `flat` squashes it along the up reference. */
export function tube(M, ctrl, radii, o = {}) {
  const r = (u) => { const i = Math.min(radii.length - 2, Math.floor(u)), f = u - i; return radii[i] + (radii[i + 1] - radii[i]) * f; };
  return sweep(M, ctrl, (t, u) => { const v = r(u); return { w: v, h: v * (o.flat ?? 1) }; }, { ring: 9, seg: 5, ...o });
}

/**
 * A superquadric at `c` with half-sizes r = [x, y, z] along `axes` (default the model's). e1 the north-south
 * exponent, e2 round the equator: 1 is an ellipsoid, toward 0.2 a box with soft corners. `lump` displaces it with
 * noise (a heap, a tumour); `col(dir, p)` paints it, dir the unit direction from the centre in its own frame.
 */
export function blob(M, c, r, o = {}) {
  const nu = o.nu ?? 16, nv = o.nv ?? 10, e1 = o.e1 ?? 1, e2 = o.e2 ?? 1;
  const ax = o.axes || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const sp = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
  const G = [], D = [];
  for (let i = 0; i <= nv; i++) {
    const v = -Math.PI / 2 + (i / nv) * Math.PI, row = [], drow = [];
    for (let j = 0; j < nu; j++) {
      const u = (j / nu) * Math.PI * 2;
      let x = r[0] * sp(Math.cos(v), e1) * sp(Math.cos(u), e2), y = r[1] * sp(Math.sin(v), e1), z = r[2] * sp(Math.cos(v), e1) * sp(Math.sin(u), e2);
      const d = norm([x / r[0], y / r[1], z / r[2]]);
      if (o.lump) { const k = 1 + o.lump * (fnoise(add(d, [o.seed || 0, 0, 0]), o.freq || 2.2) - 0.5) * 2; x *= k; y *= k; z *= k; }
      row.push([c[0] + ax[0][0] * x + ax[1][0] * y + ax[2][0] * z, c[1] + ax[0][1] * x + ax[1][1] * y + ax[2][1] * z, c[2] + ax[0][2] * x + ax[1][2] * y + ax[2][2] * z]);
      drow.push(d);
    }
    G.push(row); D.push(drow);
  }
  const pole = (i) => (i === 0 ? mul(ax[1], -1) : ax[1]);
  const palOf = o.shade || o.rim ? (i, j) => [o.shade ? colAt(o.shade, D[i][j], G[i][j]) : null, o.rim ? colAt(o.rim, D[i][j], G[i][j]) : null] : null;
  emitGrid(M, G, G.map(() => c), (i, j) => colAt(o.col || '#808080', D[i][j], G[i][j]), (i, j) => matAt(o.mat ?? MAT.MATTE, D[i][j]), { form: o.form || null, nrm: (i) => pole(i), palOf });
}

/** A spike from base to tip, bent by `bend` (a vector added at its middle): a horn, a claw, a tooth, a thorn. */
export function spike(M, base, tip, r, o = {}) {
  const mid = add(lerp3(base, tip, 0.5), o.bend || [0, 0, 0]);
  tube(M, [base, mid, tip], [r, r * (o.mid ?? 0.6), r * 0.04], { ring: o.ring ?? 7, seg: 3, ...o });
}

/** A tuft of fur: a flattened, tapering clump from `root` along `dir`, lit as the surface it grows from. */
export function tuft(M, root, dir, len, w, col, form, o = {}) {
  const d = norm(dir), side = norm(cross(form, d)), bend = madd(mul(form, len * 0.12), side, len * (o.curl || 0));
  // a tuft is fur already: it grows no coat of its own
  withFur(M, 0, () => tube(M, [madd(root, form, -0.004), add(madd(root, d, len * 0.55), bend), madd(root, d, len)], [w, w * 0.62, 0.0006],
    { ring: 5, seg: 3, flat: 0.42, up: form, form: o.own ? null : form, col, cap: false }));
}

/**
 * FUR AS SHELLS: every furred triangle since `from` drawn again in layers, each a little further out along its
 * normals, and the beast shader (gl/beast-light.js) cuts each layer down to the strands that reach that high, so the
 * coat is soft and deep, a strand at a time. What's furred, and how long, was set as each piece was made (`furLen`,
 * `withFur`); only a matte surface takes it, and nothing near the floor, so a paw doesn't sink through it.
 *
 * A layer carries what the shader needs in what a vertex already has: its material is FUR plus its height in
 * fifteenths, and its normal's length is the fur's length in metres, from which the shader finds each strand's root
 * on the skin. That normal is short, so the ink leaves the layers alone (gl/ink.js) and the coat's edge stays soft;
 * the room's depth prepass leaves them out too (gl/room.js), or the outer layer would hide the coat under it.
 *
 * Short fur needs few layers and long fur many (one every `step` metres, up to `max`); `budget` caps the triangles
 * the coat may add, the counts scaled down to fit. Run it after the model is scaled: it reads lengths in metres.
 */
/**
 * A shaggy coat of spikes over a loft (what sweep returns): inked tufts on a jittered grid, t0..t1 along it and
 * a0..a1 round it, `dt` and `da` apart, laid over the shell fur so the coat reads rough at its edge and soft between.
 * Each lies back along the part (`lie`) and stands off it (`stand`), or goes where `dir(frame, t, a)` says, turned a
 * little its own way (`jitter`) so the coat never lies as scales do. It's `len(t, a)` long, give or take a third
 * (0 leaves a gap), and coloured `col(t, a, p)` a shade lighter or darker than its neighbours (`vary`), so the
 * clumps read. Lit as the skin under it.
 */
export function furCoat(M, part, o = {}) {
  const r = rng(o.seed || 9), t0 = o.t0 ?? 0, t1 = o.t1 ?? 1, a0 = o.a0 ?? 0, a1 = o.a1 ?? Math.PI * 2, jit = o.jitter ?? 0.45, vary = o.vary ?? 0.14;
  const nt = Math.max(1, Math.round((t1 - t0) / (o.dt ?? 0.07))), na = Math.max(1, Math.round((a1 - a0) / (o.da ?? 0.42)));
  for (let i = 0; i < nt; i++) for (let j = 0; j < na; j++) {
    const t = t0 + ((t1 - t0) * (i + 0.5 + (r() - 0.5) * 0.8)) / nt, a = a0 + ((a1 - a0) * (j + 0.5 + (r() - 0.5) * 0.8 + (i % 2) * 0.5)) / na;
    const l = o.len ? o.len(t, a) : 0.05;
    if (!(l > 0)) continue;
    const f = part.at(clamp(t), a), side = norm(cross(f.n, f.T));
    const d0 = o.dir ? o.dir(f, t, a) : add(mul(f.T, -(o.lie ?? 0.75)), mul(f.n, o.stand ?? 0.65));
    const dir = add(add(d0, mul(side, (r() - 0.5) * 2 * jit)), mul(f.n, (r() - 0.3) * jit * 0.6));
    const c = C(o.col ? o.col(t, a, f.p) : '#808080'), from = M.N.length;
    // `lift` roots the clump that far off the part, on whatever stands proud of it there (a shoulder over the ribs)
    tuft(M, madd(f.p, f.n, (o.lift ?? 0) - 0.002), dir, l * (0.67 + 0.66 * r()), (o.w ?? 0.014) * (0.8 + 0.4 * r()), shade(c, 1 - vary + 2 * vary * r()), f.n, { curl: (r() - 0.5) * (o.curl ?? 0.7) });
    // outlined finer than the body: a normal shorter than 1 thins the ink in proportion (gl/ink.js), and the lit
    // pass normalises it again
    for (let i = from; i < M.N.length; i++) M.N[i] *= o.ink ?? 0.45;
  }
}

/**
 * Clumps of fur over part of a finished model: triangles t0..t1 (a leg, from quadruped's `legs`), on the skin facing
 * `side` (a unit vector) and between `band` [low, high] of the part's height (0 its foot, 1 its top), rooted on it
 * and hanging the way `dir(n)` says, coloured as the skin under each. For where one part grows out of another: fur
 * over the top of a foreleg hides the seam with the body. Lengths are in the model's own units, as built. Inked
 * finer than the body, as furCoat's are.
 */
export function furOver(M, t0, t1, o = {}) {
  const r = rng(o.seed || 11), side = o.side || [1, 0, 0], [b0, b1] = o.band || [0.6, 0.95];
  let lo = Infinity, hi = -Infinity;
  for (let i = t0 * 3; i < t1 * 3; i++) { lo = Math.min(lo, M.P[i * 3 + 1]); hi = Math.max(hi, M.P[i * 3 + 1]); }
  const picks = [];
  for (let i = t0 * 3; i < t1 * 3; i++) {
    const y = (M.P[i * 3 + 1] - lo) / Math.max(1e-6, hi - lo), n = norm([M.N[i * 3], M.N[i * 3 + 1], M.N[i * 3 + 2]]);
    if (y >= b0 && y <= b1 && dot(n, side) > (o.facing ?? 0.35)) picks.push(i);
  }
  const want = o.n ?? 10, step = Math.max(1, Math.floor(picks.length / want));
  for (let k = 0; k < picks.length && k / step < want; k += step) {
    const i = picks[Math.min(picks.length - 1, k + Math.floor(r() * step))], p = [M.P[i * 3], M.P[i * 3 + 1], M.P[i * 3 + 2]];
    const n = norm([M.N[i * 3], M.N[i * 3 + 1], M.N[i * 3 + 2]]), c = [M.C[i * 3], M.C[i * 3 + 1], M.C[i * 3 + 2]], from = M.N.length;
    const dir = o.dir ? o.dir(n) : add(mul(n, 0.4), [0, -0.85, -0.25]);
    tuft(M, p, dir, (o.len ?? 0.03) * (0.75 + 0.5 * r()), (o.w ?? 0.009) * (0.85 + 0.3 * r()), shade(c, 0.88 + 0.24 * r()), n, { curl: (r() - 0.5) * (o.curl ?? 0.9) });
    for (let j = from; j < M.N.length; j++) M.N[j] *= o.ink ?? 0.45;
  }
}

export const FUR = 50;
export function furShells(M, from, o = {}) {
  const step = o.step ?? 0.0016, max = o.max ?? 10, budget = o.budget ?? 36000, floor = o.floor ?? 0.006;
  const t0 = typeof from === 'number' ? from : from.t, t1 = triCount(M), tris = [];
  for (let tri = t0; tri < t1; tri++) {
    if (M.M[tri * 3] !== MAT.MATTE) continue;
    let len = 0, low = Infinity, ok = true;
    for (let v = 0; v < 3; v++) {
      const i = tri * 3 + v, nl = Math.hypot(M.N[i * 3], M.N[i * 3 + 1], M.N[i * 3 + 2]);
      if (nl < 0.5) ok = false;
      len = Math.max(len, M.F[i] || 0);
      low = Math.min(low, M.P[i * 3 + 1]);
    }
    if (!ok || len <= 0 || low < floor + len) continue;
    tris.push([tri, Math.min(max, Math.max(2, Math.round(len / step))), len]);
  }
  // over budget, the short fur (a face's) goes down to two layers first, which is all it needs; then the long fur
  // shares what's left
  const total = () => tris.reduce((s, [, n]) => s + n, 0);
  if (total() > budget) for (const T of tris) if (T[2] < (o.short ?? 0.008)) T[1] = 2;
  if (total() > budget) {
    const fixed = tris.reduce((s, [, n, l]) => s + (l < (o.short ?? 0.008) ? n : 0), 0), long = total() - fixed;
    const k = Math.max(0, budget - fixed) / Math.max(1, long);
    for (const T of tris) if (T[2] >= (o.short ?? 0.008)) T[1] = Math.max(2, Math.floor(T[1] * k));
  }
  const was = M.furLen;
  M.furLen = 0;
  // and the budget is a hard cap: the long fur is laid first, and the coat stops where the budget does, so the short
  // fur on a busy frame loses a few triangles before any frame goes over
  tris.sort((p, q) => q[2] - p[2]);
  let spent = 0;
  for (const [tri, n] of tris) {
    if (spent + n > budget) continue;
    spent += n;
    for (let s = 1; s <= n; s++) {
      const h = s / n, mat = FUR + Math.round(h * 15);
      for (let v = 0; v < 3; v++) {
        const i = tri * 3 + v, f = M.F[i] || 0, nn = norm([M.N[i * 3], M.N[i * 3 + 1], M.N[i * 3 + 2]]);
        const p = madd([M.P[i * 3], M.P[i * 3 + 1], M.P[i * 3 + 2]], nn, f * h);
        M.P.push(p[0], p[1], p[2]);
        const fl = Math.min(0.09, Math.max(1e-4, f));
        M.N.push(nn[0] * fl, nn[1] * fl, nn[2] * fl);
        M.C.push(M.C[i * 3], M.C[i * 3 + 1], M.C[i * 3 + 2]); M.M.push(mat); M.B.push(M.B[i]); M.U.push(M.U[i * 2], M.U[i * 2 + 1]); M.F.push(0);
      }
    }
  }
  M.furLen = was;
}

/**
 * A membrane: `P(u, v)` over 0..1 by 0..1, drawn on both sides a hair apart. `keep(u, v)` cuts holes (a burnt wing).
 */
export function sheet(M, P, nu, nv, o = {}) {
  const G = [];
  for (let i = 0; i <= nv; i++) { const row = []; for (let j = 0; j <= nu; j++) row.push(P(j / nu, i / nv)); G.push(row); }
  const N = G.map((row, i) => row.map((p, j) => {
    const a = G[Math.min(nv, i + 1)][j], b = G[Math.max(0, i - 1)][j], c = row[Math.min(nu, j + 1)], d = row[Math.max(0, j - 1)];
    return norm(cross(sub(c, d), sub(a, b)));
  }));
  const th = (o.thick ?? 0.003) / 2;
  for (let i = 0; i < nv; i++) for (let j = 0; j < nu; j++) {
    if (o.keep && !o.keep((j + 0.5) / nu, (i + 0.5) / nv)) continue;
    const q = [[i, j], [i, j + 1], [i + 1, j + 1], [i + 1, j]], m = matAt(o.mat ?? MAT.MATTE, j / nu, i / nv);
    for (const side of [1, -1]) {
      const order = side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      for (const k of order) {
        const [a, b] = q[k], n = mul(N[a][b], side);
        put(M, madd(G[a][b], n, th), n, colAt(o.col || '#808080', b / nu, a / nv, side), m, o.shade ? colAt(o.shade, b / nu, a / nv, side) : null, o.rim ? colAt(o.rim, b / nu, a / nv, side) : null);
      }
    }
  }
}

/** A closed ring (a collar, a band): a tube round a loop of `n` points from `P(s)`, s over 0..1. */
export function loop(M, P, r, o = {}) {
  const n = o.n ?? 16, pts = Array.from({ length: n + 1 }, (_, i) => P(i / n));
  tube(M, pts, Array(n + 1).fill(r), { cap: false, seg: 2, ...o });
}

// ── into a batch ─────────────────────────────────────────────────────────────────────────────────────
// A placement for a whole model: stood at O on the floor, facing F (unit, level). Model +X is the animal's left,
// which with +Y up is (F.z, 0, −F.x), as gl/room-people.js turns a figure.
export function placeAt(O, F, s = 1) {
  const L = [F[2], 0, -F[0]];
  return {
    p: (p) => [O[0] + (L[0] * p[0] + F[0] * p[2]) * s, O[1] + p[1] * s, O[2] + (L[2] * p[0] + F[2] * p[2]) * s],
    n: (n) => [L[0] * n[0] + F[0] * n[2], n[1], L[2] * n[0] + F[2] * n[2]],
    s,
  };
}
// A figure's bones: `rows` is its 3×4 per bone, bind space into the room (gl/room-people.js figurePeople)
export function boneXf(rows) {
  const ap = (b, p) => { const o = b * 12; return [rows[o] * p[0] + rows[o + 1] * p[1] + rows[o + 2] * p[2] + rows[o + 3], rows[o + 4] * p[0] + rows[o + 5] * p[1] + rows[o + 6] * p[2] + rows[o + 7], rows[o + 8] * p[0] + rows[o + 9] * p[1] + rows[o + 10] * p[2] + rows[o + 11]]; };
  // the normal keeps its length: a short one marks an uninked piece (inkless)
  const an = (b, n) => { const o = b * 12; return mul(norm([rows[o] * n[0] + rows[o + 1] * n[1] + rows[o + 2] * n[2], rows[o + 4] * n[0] + rows[o + 5] * n[1] + rows[o + 6] * n[2], rows[o + 8] * n[0] + rows[o + 9] * n[1] + rows[o + 10] * n[2]]), vlen(n)); };
  return { p: (p, b) => ap(Math.max(0, b), p), n: (n, b) => an(Math.max(0, b), n) };
}
/** Every triangle of M into the batch through the placement `xf` ({ p(p, bone), n(n, bone) }). */
export function toBatch(b, M, xf) {
  const { P, N, C: Cl, M: Mt, B, U } = M;
  for (let i = 0; i < Mt.length; i++) {
    const k = i * 3, bone = B[i];
    vtx(b, xf.p([P[k], P[k + 1], P[k + 2]], bone), xf.n([N[k], N[k + 1], N[k + 2]], bone), [U[i * 2] || 0, U[i * 2 + 1] || 0], [Cl[k], Cl[k + 1], Cl[k + 2]], Mt[i]);
  }
  // the halos (a batch of their own, added over the frame) and the glows that light the body (gl/room.js setBeasts)
  if (M.halos.length) {
    b.halos ||= createBatch(1024);
    for (const h of M.halos) {
      const S = beastMesh(), c = xf.p(h.p, h.bone), k = xf.s || 1, r = Array.isArray(h.r) ? h.r.map((v) => v * k) : [h.r * k, h.r * k, h.r * k];
      const ax = (h.axes || [[1, 0, 0], [0, 1, 0], [0, 0, 1]]).map((a) => xf.n(a, h.bone));
      blob(S, c, r, { nu: 16, nv: 10, col: h.c, axes: ax });
      for (let i = 0; i < S.M.length; i++) { const k = i * 3; vtx(b.halos, [S.P[k], S.P[k + 1], S.P[k + 2]], [S.N[k], S.N[k + 1], S.N[k + 2]], [h.k, 0], h.c, GLOW); }
    }
  }
  if (M.lights.length) { b.lights ||= []; for (const l of M.lights) b.lights.push({ p: xf.p(l.p, l.bone), c: l.c, r: l.r * (xf.s || 1) }); }
}
/**
 * Something that glows: an unlit blob (pulsing with 'pulse'), a soft halo round it ('halo' its strength, 'haloR' its
 * size as a multiple of r) and a light on the body round it ('light' its reach in metres, 'lightK' its strength).
 */
export function glow(M, p, r, col, o = {}) {
  const c = C(col), rr = Array.isArray(r) ? r : [r, r, r], m = Math.max(...rr);
  blob(M, p, rr, { col: c, mat: o.pulse ? PULSE : GLOW, nu: o.nu ?? 12, nv: o.nv ?? 8, axes: o.axes });
  if ((o.halo ?? 0.55) > 0) M.halos.push({ p, r: rr.map((v) => Math.max(v, m * 0.35) * (o.haloR ?? 3)), axes: o.axes || null, c, k: o.halo ?? 0.55, bone: M.bone });
  if ((o.light ?? 1) > 0) M.lights.push({ p, c: mul(c, o.lightK ?? 1), r: o.light ?? Math.max(0.25, m * 10), bone: M.bone });
}
/** The model's extent: [min, max] corners. */
export function extentOf(M) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < M.P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], M.P[i + k]); hi[k] = Math.max(hi[k], M.P[i + k]); }
  return [lo, hi];
}
// Scale everything added since triangle `from` about the origin (a whole animal built at a hound's size and grown)
export function scaleFrom(M, from, s) {
  const f = typeof from === 'number' ? { t: from, h: M.halos.length, l: M.lights.length } : from;
  for (let i = f.t * 9; i < M.P.length; i++) M.P[i] *= s;
  if (M.F) for (let i = f.t * 3; i < M.F.length; i++) M.F[i] *= s;
  for (let i = f.h; i < M.halos.length; i++) { const h = M.halos[i]; M.halos[i] = { ...h, p: mul(h.p, s), r: Array.isArray(h.r) ? h.r.map((v) => v * s) : h.r * s }; }
  for (let i = f.l; i < M.lights.length; i++) { const l = M.lights[i]; M.lights[i] = { ...l, p: mul(l.p, s), r: l.r * s }; }
}

// ── eyes ─────────────────────────────────────────────────────────────────────────────────────────────
/** An eye at p looking along `look`: the iris and a pupil painted round its front, glowing if `glow`. */
export function eye(M, p, r, look, o = {}) {
  const z = norm(look), x0 = norm(cross([0, 1, 0], z)), x = vlen(x0) < 0.1 ? [1, 0, 0] : x0, y = cross(z, x);
  const iris = C(o.iris || '#c08030'), pupil = C(o.pupil || '#0a0806'), white = C(o.white || iris), slit = o.slit || 0;
  blob(M, p, [r, r, r * (o.depth ?? 0.8)], {
    axes: [x, y, z], nu: 12, nv: 8, mat: o.glow ? GLOW : MAT.GLOSS,
    col: (d) => {
      if (d[2] < 0.2) return white;
      const px = slit ? Math.abs(d[0]) * (1 + slit * 4) : Math.hypot(d[0], d[1]);
      return px < (o.pupilR ?? 0.32) ? pupil : d[2] > 0.55 ? iris : mix(white, iris, 0.6);
    },
  });
}

/**
 * An eye set INTO a head rather than stuck on it. A whole ball on a surface reads as a toy's googly eye, so this
 * shows only an almond of eyeball through a skin shell: the ball sits back in the socket, the shell's hole is the
 * lid opening, a crease is inked round it and a brow overhangs it, so the brow shades the eye. One hard glint, no
 * round catchlights. `sd` is the side (+1 the creature's left), so `tilt` slants both brows down toward the nose.
 *
 * o: look (unit, default +Z), up (default +Y), sd, open (0..1, how much shows; 0.5 a hooded stare), blink (0..1),
 * tilt (radians, the anger), width (half-width of the opening, radians round the ball), brow (0 none, 1 heavy),
 * skin, lid (the lid's own colour), crease, iris, ring (the iris's outer colour), pupil, shape ('round'|'slit'|'bar'),
 * pupilR, veins (true for a frog's or a lizard's figured iris), mat (the shell's material).
 * Returns { ball, shell } radii and the centre, to hang more on.
 */
export function socketEye(M, c, r, o = {}) {
  const Z = norm(o.look || [0, 0, 1]), up0 = o.up || [0, 1, 0];
  const X0 = norm(cross(up0, Z)), Y0 = cross(Z, X0);
  const sd = o.sd ?? 1, tilt = (o.tilt ?? 0) * sd;
  // the lid frame, turned about the look so the opening slants
  const X = norm(add(mul(X0, Math.cos(tilt)), mul(Y0, Math.sin(tilt)))), Y = cross(Z, X);
  const blink = clamp(o.blink ?? 0), open = (o.open ?? 0.55) * (1 - blink);
  const aw = o.width ?? 0.95, au = Math.max(0.04, 1.1 * open), al = Math.max(0.03, 0.5 * open);
  const R = r * 1.14, ballC = madd(c, Z, -r * 0.3);
  const skin = C(o.skin || '#5a5040'), lidC = C(o.lid || o.skin || '#5a5040');

  // the eyeball: matte, the iris painted round the look, the pupil cut into it
  const iris = C(o.iris || '#b08020'), ringC = C(o.ring || shade(iris, 0.45)), pupil = C(o.pupil || '#060403'), white = C(o.white || '#c8c0a8');
  const shape = o.shape || 'round', pr = o.pupilR ?? 0.32;
  blob(M, ballC, [r, r, r], {
    nu: 26, nv: 18, mat: MAT.MATTE,
    col: (d, p) => {
      const L = [dot(d, X0), dot(d, Y0), dot(d, Z)];
      if (L[2] < 0.35) return white;
      const rr = Math.hypot(L[0], L[1]);
      const base = mix(iris, ringC, smooth(0.35, 0.8, rr));
      return o.veins && veinAt(p, 55, 0.035) ? shade(base, 0.55) : base;
    },
  });
  // The pupil is its own thin lens on the front of the ball. Painted into the ball's vertices it came out as
  // stair-stepped stripes: the slot that shows is a few vertices across.
  const pz = Math.sqrt(Math.max(0, 1 - pr * pr * 0.6));
  const pdim = shape === 'slit' ? [pr * 0.22, pr] : shape === 'bar' ? [pr, pr * 0.3] : [pr, pr];
  inkless(M, () => blob(M, madd(ballC, Z, r * pz), [r * pdim[0], r * pdim[1], r * 0.05], { col: pupil, mat: MAT.MATTE, nu: 18, nv: 8, axes: [X0, Y0, Z] }));
  // one hard glint high in the opening, small and uninked
  inkless(M, () => blob(M, madd(madd(madd(ballC, Z, r * 0.96), Y, r * Math.min(0.3, au * 0.5)), X, -sd * r * 0.2), [r * 0.07, r * 0.05, r * 0.03], { col: '#f4f2ea', mat: MAT.GLOSS, nu: 8, nv: 5, axes: [X, Y, Z] }));

  // the shell: a sphere round the ball with an almond hole where the lids part
  const NT = 28, NS = 9, G = [], cen = [];
  const rimAngle = (th) => { const ah = Math.sin(th) > 0 ? au : al; return 1 / Math.hypot(Math.cos(th) / aw, Math.sin(th) / ah); };
  const dirAt = (th, phi) => norm(add(mul(Z, Math.cos(phi)), mul(add(mul(X, Math.cos(th)), mul(Y, Math.sin(th))), Math.sin(phi))));
  for (let i = 0; i <= NS; i++) {
    const row = [];
    for (let j = 0; j < NT; j++) {
      const th = (j / NT) * Math.PI * 2, p0 = rimAngle(th), phi = p0 + (Math.PI * 0.92 - p0) * (i / NS);
      // the lid's edge rolls in toward the ball, so it has a thickness at the opening
      const rr = i === 0 ? r * 1.02 : R;
      row.push(madd(ballC, dirAt(th, phi), rr));
    }
    G.push(row); cen.push(ballC);
  }
  const lidOf = (i, j) => (i < 3 ? lidC : skin);
  emitGrid(M, G, cen, (i, j) => lidOf(i, j), () => o.mat ?? MAT.MATTE);

  // the crease: an inked fold along the upper lid, and a lighter one under the lower
  const creaseC = o.crease || shade(skin, 0.35);
  const rim = (th, k, lift) => madd(ballC, dirAt(th, rimAngle(th) + k), R + lift);
  tube(M, Array.from({ length: 9 }, (_, i) => rim(Math.PI * (0.06 + 0.88 * i / 8), 0.18, r * 0.02)), Array(9).fill(r * 0.055).map((v, i) => v * Math.sin(Math.PI * (0.1 + 0.8 * i / 8))), { ring: 6, col: creaseC, mat: MAT.MATTE });
  tube(M, Array.from({ length: 7 }, (_, i) => rim(Math.PI * (1.15 + 0.7 * i / 6), 0.22, r * 0.01)), Array(7).fill(r * 0.035).map((v, i) => v * Math.sin(Math.PI * (0.1 + 0.8 * i / 6))), { ring: 6, col: shade(skin, 0.6), mat: MAT.MATTE });

  // the brow: a shelf over the eye, low at the nose end, forward enough to throw the eye into shadow
  const brow = o.brow ?? 0.8;
  if (brow > 0) {
    const bp = (k) => { const th = Math.PI * (0.08 + 0.84 * k); return madd(madd(ballC, dirAt(th, rimAngle(th) + 0.42), R * (1.02 + 0.08 * brow)), Z, r * 0.18 * brow); };
    tube(M, [0, 0.25, 0.5, 0.75, 1].map(bp), [0.18, 0.3, 0.34, 0.3, 0.18].map((v) => v * r * brow), { ring: 10, flat: 0.6, up: Y, col: skin, mat: o.mat ?? MAT.MATTE });
  }
  return { centre: ballC, ball: r, shell: R, X, Y, Z };
}

// ── the mammal head ──────────────────────────────────────────────────────────────────────────────────
// A skull loft from the occiput to the nose, a jaw that opens on a hinge, a nose, eyes under a brow, ears and
// teeth. `at` is the occiput, D the way the muzzle points, U the head's up. Shared by every four-legged thing and
// anything else with a mammal's face on it (an ash crawler's raccoon, a bat). `face` 'dog' or 'cat' draws the
// animal's own face instead (fineHead, below).
export const HEAD = {
  size: 1, skull: 0.14, muzzle: 0.14, skullW: 1, muzzleW: 1, stop: 1, gape: 0.2,
  ears: 'prick', earLen: 0.1, earW: 1, eyeR: 0.013, eyeGlow: false, iris: '#ff7a1a', slit: 0, brow: 0.8,
  col: '#2e2422', cheek: '#8a4a2e', mouth: '#4a1416', nose: '#141012', teeth: '#e8dcc0', inner: '#5a3a36',
  whiskers: 0, whiskerCol: '#d8d0c0', whiskerMetal: false, tan: true, blind: false, eyes: 2, tufts: 0.6, tuftCol: null,
  face: null, lip: '#120c0b', rim: '#0e0a09', tabby: null, white: null, blaze: null,
};
export function mammalHead(M, at, D, U, h0 = {}, t = 0) {
  const h = { ...HEAD, ...h0 };
  if (h.face === 'dog' || h.face === 'cat') return fineHead(M, at, D, U, h, t);
  const s = h.size, X = norm(cross(U, D));
  const sk = h.skull * s, mz = h.muzzle * s;
  const H0 = madd(at, D, -0.025 * s), H1 = madd(madd(H0, D, sk * 0.5), U, 0.012 * s), H2 = madd(H0, D, sk);
  const H3 = madd(madd(H2, D, mz * 0.5), U, -0.012 * s * h.stop), H4 = madd(madd(H2, D, mz), U, -0.018 * s * h.stop);
  const PK = [[0, [0.035, 0.035, 0]], [1, [0.068 * h.skullW, 0.062, 0]], [2, [0.05 * h.skullW, 0.05, -0.006]], [3, [0.034 * h.muzzleW, 0.036, -0.012]], [4, [0.022 * h.muzzleW, 0.024, -0.012]]];
  const tan = C(h.cheek), base = C(h.col), mouth = C(h.mouth);
  const skull = sweep(M, [H0, H1, H2, H3, H4], (t2, u) => { const [w, hh, oy] = keys(PK, u); return { w: w * s, h: hh * s, oy: oy * s }; }, {
    up: U, ring: 16, seg: 5,
    col: (t2, a, p, u) => {
      const sa = Math.sin(a);
      if (h.gape > 0.08 && u > 2.4 && sa < -0.62) return mouth;
      if (h.tan && u > 2.2 && sa < -0.15) return tan;
      if (h.mask) { const m = h.mask(u, a, p); if (m) return C(m); }
      return base;
    },
  });
  // the jaw, on its hinge under the cheek, opened by `gape` (radians)
  const hinge = madd(skull.at(0.42, -Math.PI / 2).p, U, 0.012 * s);
  const tipAt = H4, jl = vlen(sub(tipAt, hinge)) * 0.92, g = h.gape;
  const Dj = norm(sub(mul(D, Math.cos(g)), mul(U, Math.sin(g)))), Uj = norm(add(mul(U, Math.cos(g)), mul(D, Math.sin(g))));
  const jaw = sweep(M, [hinge, madd(hinge, Dj, jl * 0.5), madd(hinge, Dj, jl)], (t2) => ({ w: (0.04 - 0.02 * t2) * s * h.muzzleW, h: (0.02 - 0.009 * t2) * s, oy: 0.004 * s }), {
    up: Uj, ring: 12, seg: 4, col: (t2, a) => (Math.sin(a) > 0.35 && g > 0.05 ? mouth : h.tan ? tan : base),
  });
  // teeth: the canines, and a row of small ones between, showing as the jaw opens
  if (g > 0.05) {
    const T = C(h.teeth);
    for (const sd of [1, -1]) {
      const up0 = skull.at(0.86, -Math.PI / 2 + sd * 0.75), lo0 = jaw.at(0.84, Math.PI / 2 + sd * 0.75);
      spike(M, madd(up0.p, U, 0.004 * s), madd(madd(up0.p, U, -0.026 * s), D, -0.003 * s), 0.0052 * s, { col: T, mat: MAT.GLOSS, ring: 6 });
      spike(M, madd(lo0.p, Uj, -0.004 * s), madd(madd(lo0.p, Uj, 0.022 * s), Dj, -0.003 * s), 0.0045 * s, { col: T, mat: MAT.GLOSS, ring: 6 });
      for (let i = 0; i < 3; i++) {
        const q = skull.at(0.6 + i * 0.08, -Math.PI / 2 + sd * 0.85), r2 = jaw.at(0.45 + i * 0.12, Math.PI / 2 + sd * 0.8);
        spike(M, q.p, madd(q.p, U, -0.012 * s), 0.0035 * s, { col: T, mat: MAT.GLOSS, ring: 5 });
        spike(M, r2.p, madd(r2.p, Uj, 0.01 * s), 0.003 * s, { col: T, mat: MAT.GLOSS, ring: 5 });
      }
    }
  }
  // the nose
  if (h.nose) blob(M, madd(madd(H4, D, 0.008 * s), U, 0.006 * s), [0.021 * s * h.muzzleW, 0.016 * s, 0.014 * s], { axes: [X, U, D], col: h.nose, mat: MAT.GLOSS, nu: 12, nv: 8 });
  // the eyes under a hard brow
  const eyesAt = [];
  if (!h.blind) for (const sd of [1, -1]) {
    const e = skull.at(0.5, sd > 0 ? 0.42 : Math.PI - 0.42), look = norm(add(add(D, mul(X, sd * 0.55)), mul(U, 0.08)));
    const ep = madd(e.p, e.n, -0.004 * s);
    eye(M, ep, h.eyeR * s, look, { iris: h.iris, glow: h.eyeGlow, slit: h.slit, white: h.eyeGlow ? h.iris : '#d8c8a0' });
    eyesAt.push(ep);
    if (h.brow) blob(M, madd(madd(ep, U, h.eyeR * s * 1.1), D, -0.002 * s), [0.018 * s * h.brow, 0.0075 * s, 0.016 * s], { axes: [X, U, D], col: h.tan ? tan : base, form: e.n, nu: 10, nv: 6 });
  }
  if (h.eyes > 2) {
    // more eyes than any pattern: scattered over the skull, each looking its own way
    const r = rng(h.seed || 7);
    for (let i = 2; i < h.eyes; i++) {
      const q = skull.at(0.15 + 0.6 * r(), 0.3 + (Math.PI - 0.6) * r());
      eye(M, madd(q.p, q.n, -0.002 * s), h.eyeR * s * (0.5 + 0.6 * r()), norm(add(q.n, mul(D, 0.6))), { iris: h.iris, glow: h.eyeGlow, white: h.iris });
    }
  }
  // ears
  if (h.ears !== 'none') for (const sd of [1, -1]) {
    const kind = typeof h.ears === 'function' ? h.ears(sd) : h.ears;
    if (kind === 'none') continue;
    const root = skull.at(0.16, sd > 0 ? 1.0 : Math.PI - 1.0), el = h.earLen * s;
    let tip, w = 0.028 * s * h.earW;
    if (kind === 'drop') tip = add(root.p, add(add(mul(X, sd * el * 0.55), mul(U, -el * 0.6)), mul(D, el * 0.25)));
    else if (kind === 'round') { tip = add(root.p, add(add(mul(U, el * 0.7), mul(X, sd * el * 0.5)), mul(D, -el * 0.15))); w = el * 0.75; }
    else if (kind === 'stub') tip = add(root.p, add(add(mul(U, el * 0.35), mul(X, sd * el * 0.2)), mul(D, -el * 0.12)));
    else tip = add(root.p, add(add(mul(U, el * 0.9), mul(X, sd * el * 0.32)), mul(D, -el * 0.25)));
    const mid = add(lerp3(root.p, tip, 0.5), mul(X, sd * 0.006 * s));
    const torn = kind === 'stub' || kind === 'torn';
    tube(M, [madd(root.p, root.n, -0.006 * s), mid, tip], [w, w * (kind === 'round' ? 1 : 0.7), 0.002 * s], {
      flat: 0.2, up: D, ring: 10, seg: 4, form: root.n,
      col: (t2, a) => (Math.sin(a) > 0.2 && t2 > 0.15 ? C(h.inner) : torn && t2 > 0.7 ? C(h.cheek) : base),
    });
  }
  // whiskers: a fan off each side of the muzzle
  if (h.whiskers) for (const sd of [1, -1]) for (let i = 0; i < h.whiskers; i++) {
    const q = skull.at(0.78 + i * 0.03, sd > 0 ? -0.15 : Math.PI + 0.15), dir = norm(add(add(mul(X, sd), mul(D, -0.35)), mul(U, 0.25 - i * 0.18)));
    tube(M, [q.p, madd(madd(q.p, dir, 0.045 * s), U, -0.006 * s), madd(madd(q.p, dir, 0.09 * s), U, -0.018 * s)], [0.0012 * s * (h.whiskerMetal ? 1.8 : 1), 0.0009 * s, 0.0004 * s],
      { ring: 4, seg: 3, col: h.whiskerCol, mat: h.whiskerMetal ? MAT.METAL : MAT.MATTE, cap: false });
  }
  // cheek ruff
  if (h.tufts > 0) {
    const fc = C(h.tuftCol || h.col);
    for (const sd of [1, -1]) for (let i = 0; i < 3; i++) {
      const q = skull.at(0.2 + i * 0.09, sd > 0 ? -0.35 - i * 0.2 : Math.PI + 0.35 + i * 0.2);
      tuft(M, q.p, add(add(mul(D, -0.8), mul(X, sd * 0.5)), mul(U, -0.3)), (0.03 + 0.012 * i) * s * h.tufts, 0.011 * s, fc, q.n);
    }
  }
  return { skull, jaw, X, eyes: eyesAt, nose: H4 };
}

// ── an animal's eye ──────────────────────────────────────────────────────────────────────────────────
/**
 * An eye as an animal's: a ball sunk in its socket with the lid skin painted over all of it but an almond opening,
 * the iris with a dark ring at its edge, the pupil laid on as its own skin so its edge stays sharp (round, or a slit
 * with `slit`), a black rim round the opening, lids with some thickness, a brow over it and a catchlight. `up` is the
 * head's up and `side` +1 for the animal's left eye, −1 for its right, so `tilt` lifts both outer corners.
 */
export function almondEye(M, c, r, look, up, side, o = {}) {
  // an eye and its lids grow no fur
  const furWas = M.furLen;
  M.furLen = 0;
  const z = norm(look), x = norm(cross(up, z)), y = cross(z, x);
  const A = o.wide ?? 0.9, Bu = o.upper ?? 0.62, Bl = o.lower ?? 0.5, tilt = o.tilt ?? 0;
  const lid = C(o.lid || '#2e2422'), rim = C(o.rim || '#0e0a09'), iris = C(o.iris || '#8a5a20'), white = C(o.white || '#d8c8ae');
  const irisR = o.irisR ?? 0.76, form = o.form || null;
  const edge = (ex) => Math.pow(Math.max(0, 1 - (ex / A) ** 2), 0.62);
  // `scowl` brings the upper lid down toward the nose: the hard look a cat gives you
  const top = (ex) => Bu * edge(ex) * (1 - (o.scowl || 0) * smooth(0.4, -0.9, ex / A));
  // the opening in the eye's own terms: ex outward from the nose, ey up, the outer corner lifted by tilt
  const inside = (dx, dy) => { const ex = side * dx, ey = dy - tilt * ex; return Math.abs(ex) < A && ey < top(ex) && ey > -Bl * edge(ex); };
  const Q = (dx, dy, k = 1) => { const dz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy)); return add(c, mul(add(add(mul(x, dx), mul(y, dy)), mul(z, dz)), r * k)); };
  const P = (ex, ey, k = 1) => Q(side * ex, ey + tilt * ex, k);
  blob(M, c, [r, r, r], {
    axes: [x, y, z], nu: 36, nv: 22,
    mat: (d) => (d[2] > 0 && inside(d[0], d[1]) ? (o.glow ? GLOW : MAT.GLOSS) : MAT.MATTE),
    col: (d) => {
      if (d[2] <= 0 || !inside(d[0], d[1])) {
        // a band of liner round the opening: a dog's and a cat's eyes are rimmed in black skin
        const k = 1 + (o.linerW ?? 0.22);
        if (o.liner && d[2] > 0 && inside(d[0] / k, d[1] / k)) return C(o.liner);
        return o.lidLow && d[1] < -0.05 ? C(o.lidLow) : lid;
      }
      const q = Math.hypot(d[0], d[1]);
      if (q > irisR) return white;
      if (q > irisR * 0.84) return shade(iris, 0.5);
      if (o.glow) return iris;
      // lighter toward the pupil, with fine spokes, as a real iris is
      const spoke = 0.06 * Math.cos(Math.atan2(d[1], d[0]) * 22);
      return mix(shade(iris, 0.92 + spoke), '#fff4c0', 0.32 * (1 - smooth(0.25, 0.7, q / irisR)));
    },
  });
  // the pupil, conforming to the ball
  const slit = o.slit || 0, ph = slit ? Math.min(0.9, Math.min(Bu, Bl) * 1.05) : o.pupilR ?? 0.34, pw = slit ? 0.07 + 0.28 * (1 - slit) : ph;
  sheet(M, (u, v) => { const a = u * Math.PI * 2, k = 0.02 + 0.98 * v; return Q(pw * k * Math.cos(a), ph * k * Math.sin(a), 1.004); }, 28, 3,
    { thick: 0.004 * r, col: o.pupil || '#030204', mat: MAT.GLOSS });
  // the rim round the opening, then the lids over it
  const n = 40, ring = (s0) => { const th = s0 * Math.PI * 2, ex = -A * Math.cos(th); return Math.sin(th) >= 0 ? [ex, top(ex)] : [ex, -Bl * edge(ex)]; };
  loop(M, (s0) => { const [ex, ey] = ring(s0); return P(ex * 0.985, ey * 0.985, 1.0); }, (o.rimW ?? 0.075) * r, { n, col: rim, ring: 8 });
  const arc = (lower, lift, k) => Array.from({ length: 9 }, (_, i) => { const ex = -A * 0.98 + (2 * A * 0.98 * i) / 8; return P(ex, lower ? -Bl * edge(ex) - lift : top(ex) + lift, k); });
  // The lids, built as an eye's are: each a fold of skin lying over the ball, a crescent pointed at both corners that
  // stands off the ball at its free edge and runs back into the socket, the edge rolled into a margin. The upper lid
  // is the deeper and the heavier, with the fold of skin over it showing as a crease; the lower is a thin band.
  const S = (ex, ey, k) => { const l = Math.hypot(ex, ey), f = l > 0.985 ? 0.985 / l : 1; return P(ex * f, ey * f, k); };
  const lidLow = o.lidLow ? C(o.lidLow) : lid, lk = o.lidK ?? 1;
  const crescent = (lower, depth, k0, k1) => sheet(M, (u, v) => {
    const ex = -A * 0.99 + 2 * A * 0.99 * u, w = Math.sqrt(Math.max(0, 1 - (ex / A) ** 2));
    const ey = lower ? -Bl * edge(ex) - 0.02 - v * depth * w : top(ex) + 0.02 + v * depth * w;
    return S(ex, ey, k0 + (k1 - k0) * Math.pow(v, 1.4));
  }, 22, 8, { thick: 0.05 * r, col: lower ? lidLow : lid, mat: MAT.MATTE });
  crescent(false, 0.62 * lk, 1.075, 1.0);
  crescent(true, 0.32, 1.05, 1.0);
  // the margins, black as an animal's lids are: the upper rolled and heavy, running on past the outer corner in a
  // short wing; the lower fine
  tube(M, arc(false, 0.04, 1.06), [0.04, 0.1, 0.13, 0.15, 0.15, 0.15, 0.14, 0.11, 0.06].map((v) => v * r * lk), { ring: 10, seg: 4, col: rim, form });
  tube(M, [P(A * 0.97, top(A * 0.97) + 0.03, 1.06), P(Math.min(0.99, A * 1.06), 0.06 + tilt * 0.4, 1.05), S(A * 1.14, 0.16 + tilt * 0.6, 1.02)], [0.07 * r * lk, 0.05 * r * lk, 0.008 * r], { ring: 8, seg: 4, col: rim, form, cap: false });
  tube(M, arc(true, 0.03, 1.035), [0.02, 0.04, 0.06, 0.07, 0.07, 0.06, 0.05, 0.035, 0.02].map((v) => v * r), { ring: 8, seg: 4, col: rim, form });
  // the crease of the fold over the upper lid
  inkless(M, () => {
    const pts = Array.from({ length: 9 }, (_, i) => { const ex = -A * 0.72 + A * 1.55 * (i / 8), w = Math.sqrt(Math.max(0, 1 - (ex / A) ** 2)); return S(ex, top(ex) + 0.06 + 0.3 * w * lk, 1.09); });
    tube(M, pts, pts.map((_, i) => (i === 0 || i === 8 ? 0.008 : 0.028) * r), { ring: 5, seg: 4, col: shade(lid, 0.5), cap: false });
  });
  // the third eyelid, a pink-dark wedge showing in the inner corner
  {
    const ex = -A * 0.9, cp = P(ex, (top(ex) - Bl * edge(ex)) / 2, 1.002), cn = norm(sub(cp, c)), c1 = norm(cross(y, cn)), c2 = cross(cn, c1);
    blob(M, cp, [0.15 * r, 0.12 * r, 0.04 * r], { axes: [c1, c2, cn], col: o.haw || '#6e3a40', mat: MAT.GLOSS, nu: 12, nv: 8 });
  }
  // lashes off the upper lid, raking out and up
  if (o.lashes) for (let i = 0; i < o.lashes; i++) {
    const f = (i + 0.5) / o.lashes, ex = -A * 0.55 + A * 1.4 * f, ey = top(Math.min(A * 0.98, ex));
    const b0 = P(Math.min(A * 0.98, ex), ey + 0.06, 1.05), b1 = P(Math.min(0.99, ex + 0.12 + 0.1 * f), Math.min(0.99, ey + 0.3), 1.14);
    inkless(M, () => tube(M, [b0, lerp3(b0, b1, 0.5), b1], [0.035 * r, 0.025 * r, 0.006 * r], { ring: 4, seg: 3, col: rim, cap: false }));
  }
  // the brow: a ridge over the upper lid, highest over the outer half. `browTilt` lifts its inner end (a worried
  // look) or, below zero, drops it (an angry one)
  if (o.brow) {
    const b = o.brow, bt = o.browTilt || 0;
    const bp = [[-1.0, 0.62], [-0.55, 0.98], [0, 1.1], [0.5, 1.06], [0.95, 0.72], [1.15, 0.35]].map(([ex, ey]) => {
      const e2 = Math.min(0.99, ex * A);
      return P(e2, Math.min(0.99, ey * top(e2 * 0.9) + 0.22 + bt * 0.4 * clamp(-ex)), 1.08 + 0.06 * b);
    });
    tube(M, bp, (o.browR || [0.12, 0.36, 0.46, 0.46, 0.32, 0.1]).map((v) => v * r * b), { ring: 14, seg: 6, col: o.browCol || lid, form, flat: 0.7, up: y });
  }
  // the catchlight, the same corner on both eyes
  if (!o.glow) {
    const cp = Q(0.28, 0.3, 1.006), cn = norm(sub(cp, c)), c1 = norm(cross(y, cn)), c2 = cross(cn, c1);
    inkless(M, () => blob(M, cp, [0.12 * r, 0.1 * r, 0.035 * r], { axes: [c1, c2, cn], col: '#ffffff', mat: GLOW, nu: 10, nv: 6 }));
  }
  M.furLen = furWas;
  return { at: c, P, top, A, Bl, x, y, z };
}

// ── an ear as a leaf of skin ─────────────────────────────────────────────────────────────────────────
// `kind` 'prick' stands up as a cupped triangle; 'drop' folds over at the root and hangs by the cheek; 'stub' is a
// prick ear chewed off halfway; 'torn' has a notch out of its edge. O is outward (the head's side), len and wid its
// length and its width at the root. The inside is `inner`, edged in the coat, deepest at the root.
function leafEar(M, root, { D, U, O }, kind, len, wid, out, inner, o = {}) {
  const drop = kind === 'drop', rr = rng(o.seed || 5), notch = 0.25 + 0.5 * rr();
  let P, Fin;
  if (drop) {
    const P0 = root, P1 = add(root, add(mul(O, len * 0.32), mul(U, len * 0.22))), P2 = add(root, add(add(mul(O, len * 0.5), mul(U, -len * 0.78)), mul(D, len * 0.12)));
    const B = (v) => add(add(mul(P0, (1 - v) ** 2), mul(P1, 2 * v * (1 - v))), mul(P2, v * v));
    const w = (v) => wid * 0.5 * (0.62 + 0.5 * Math.sin(Math.PI * v * 0.85)) * Math.sqrt(Math.max(0.02, 1 - v ** 6));
    P = (u, v) => { const c = 2 * u - 1; return add(add(B(v), mul(D, c * w(v))), mul(O, -0.22 * w(v) * c * c)); };
    Fin = mul(O, -1);
  } else {
    const Ax = norm(add(add(mul(U, 0.88), mul(O, o.splay ?? 0.42)), mul(D, -(o.rake ?? 0.16))));
    let F = norm(add(mul(D, 0.9), mul(O, 0.38)));
    F = norm(sub(F, mul(Ax, dot(F, Ax))));
    const Wd = norm(cross(Ax, F)), cup = o.cup ?? 0.55;
    const w = (v) => wid * 0.5 * Math.pow(1 - v, o.point ?? 0.85) * (1 + 0.28 * Math.sin(Math.PI * v));
    P = (u, v) => {
      const c = 2 * u - 1, sp = add(madd(root, Ax, len * v), mul(D, -len * 0.1 * v * v));
      return add(add(sp, mul(Wd, c * w(v))), mul(F, -cup * (1 - c * c) * w(v) * 0.7 * Math.sin(Math.PI * Math.min(1, v * 1.15 + 0.1))));
    };
    Fin = F;
  }
  const N0 = cross(sub(P(0.55, 0.5), P(0.45, 0.5)), sub(P(0.5, 0.55), P(0.5, 0.45))), inSide = dot(N0, Fin) > 0 ? 1 : -1;
  const O_ = C(out), I_ = C(inner);
  const ragged = (u) => 0.42 + 0.1 * vnoise([u * 7, o.seed || 1, 0.5]) + 0.06 * Math.sin(u * 23);
  sheet(M, P, 14, 18, {
    thick: o.thick ?? 0.004, mat: MAT.MATTE,
    keep: kind === 'stub' ? (u, v) => v < ragged(u) : kind === 'torn' ? (u, v) => !(v > notch && v < notch + 0.16 && u > 0.6) : null,
    col: (u, v, sd) => {
      const c = Math.abs(2 * u - 1);
      if (kind === 'stub' && v > ragged(u) - 0.06) return C(o.scar || '#9a6a5e');
      if (sd !== inSide || c > 0.78 || v > 0.93) return O_;
      return mix(I_, shade(I_, 0.55), (1 - c) * (1 - smooth(0.05, 0.6, v)));
    },
  });
  // fur standing in the ear
  if (o.tufts && kind !== 'stub') for (let i = 0; i < 4; i++) {
    const u = 0.32 + 0.12 * i, base = P(u, 0.08 + 0.05 * (i % 2)), tip = P(0.5 + (u - 0.5) * 0.7, 0.42 + 0.08 * (i % 2));
    inkless(M, () => tuft(M, madd(base, Fin, 0.003), add(sub(tip, base), mul(Fin, len * 0.25)), vlen(sub(tip, base)) * 1.05, 0.004 * (o.s || 1), o.tufts, Fin, { own: true }));
  }
  return { P, Fin };
}

// ── the fine head ────────────────────────────────────────────────────────────────────────────────────
// What mammalHead draws for h.face 'dog' or 'cat': the face the animal is known by, built dense enough to read
// close in a room, stylised but in the right places. A dog: a boxy muzzle under a stop, cheekbones, eyes set
// forward at the stop under brow pads, a leather nose with comma nostrils and a groove, black-edged lips over the
// teeth with only the canines and incisors showing, leaf ears, and creases across the muzzle when it snarls. A cat:
// a round skull and a short bridge, big forward eyes with slit pupils, a small triangular nose, two whisker pads
// with rows of dots and the split lip under them, a chin, jowls, and cupped ears with fur in them. A marking that
// needs a crisp edge (a tabby's M, a snarl's creases) is a stroke laid on the skin: vertex colour would blur it.
function fineHead(M, at, D, U, h, t) {
  const s = h.size, X = norm(cross(U, D)), cat = h.face === 'cat', g = h.gape;
  const sk = h.skull, mz = h.muzzle, sw = h.skullW, mw = h.muzzleW, st = h.stop;
  const L = (d, u, x = 0) => add(add(madd(at, D, d * s), mul(U, u * s)), mul(X, x * s));
  const base = C(h.col), tan = C(h.cheek), mouth = C(h.mouth), lip = C(h.lip), ink = C(h.rim);
  const light = cat ? mix(tan, '#f4efe8', 0.75) : tan, wcol = h.whiskerCol, wmat = h.whiskerMetal ? MAT.METAL : MAT.MATTE;
  const sideA = (sd, a) => (sd > 0 ? a : Math.PI - a);
  // the skull: occiput, crown, the eyes, the bridge, the nose. A cat's is round, with a blunt face on the front of it
  // and the muzzle a full mass of its own under the nose, not a snout; a dog's crown is flatter, over a stop
  const ctrl = (cat
    ? [[-0.02, 0], [sk * 0.38, 0.01], [sk * 0.78, 0.004], [sk * 0.98, -0.004], [sk * 1.1, -0.01]]
    : [[-0.025, 0], [sk * 0.5, 0.012], [sk, 0.002], [sk + mz * 0.5, -0.014 * st], [sk + mz, -0.019 * st]]).map(([d, u]) => L(d, u));
  const PK = cat
    ? [[0, [0.042, 0.042, 0, 2]], [1, [0.07 * sw, 0.064, 0, 2]], [2, [0.066 * sw, 0.058, -0.004, 2.1]], [3, [0.05 * sw, 0.046, -0.01, 2.1]], [4, [0.03 * mw, 0.03, -0.012, 2]]]
    : [[0, [0.035, 0.035, 0, 2]], [1, [0.064 * sw, 0.053, 0, 2.3]], [2, [0.052 * sw, 0.05, -0.006, 2.2]], [3, [0.035 * mw, 0.034, -0.012, 2.5]], [4, [0.026 * mw, 0.027, -0.012, 2.7]]];
  // a dog's skull carries its build: the cheekbone under the eye, the jaw muscle behind it, the temple muscle over
  // the side of the crown, the ridge over each eye, and the groove down the middle of the forehead between them.
  // A cat's jowls are their own pieces.
  const bulge = (u, a) => {
    if (cat) return 0;
    const ca = Math.cos(a) ** 2, sa = Math.sin(a), up = Math.abs(a - Math.PI / 2);
    const brow = Math.exp(-((u - 1.85) ** 2) / 0.025) * Math.exp(-((sa - 0.7) ** 2) / 0.015);
    return 0.13 * Math.exp(-((u - 2.05) ** 2) / 0.12) * ca * (1 - smooth(0, 0.5, sa)) + 0.09 * Math.exp(-((u - 1.2) ** 2) / 0.2) * ca * smooth(0.3, -0.4, sa)
      + 0.09 * Math.exp(-((u - 1.15) ** 2) / 0.18) * Math.exp(-((sa - 0.62) ** 2) / 0.05)
      + 0.2 * brow
      - 0.11 * Math.exp(-(up ** 2) / 0.03) * smooth(1.1, 1.5, u) * smooth(2.35, 2.0, u);
  };
  const skull = sweep(M, ctrl, (t2, u) => { const [w, hh, oy, e] = keys(PK, u); return { w: w * s, h: hh * s, oy: oy * s, e, b: (a) => bulge(u, a) }; }, {
    up: U, ring: cat ? 40 : 48, seg: cat ? 10 : 12, dome: cat ? 0.5 : 0.55,
    col: (t2, a, p, u) => {
      const sa = Math.sin(a);
      if (g > 0.08 && u > (cat ? 3.0 : 2.5) && sa < -0.62) return mouth;
      if (h.mask) { const m = h.mask(u, a, p); if (m) return C(m); }
      // a cat's white runs up from the muzzle either side of the bridge to the eyes, the coat in a stripe down the
      // bridge between them
      if (cat) {
        const ca = Math.abs(Math.cos(a));
        // the edges blended, not stepped: a hard edge saws across the triangles
        if (u > 2.45) return sa > 0.5 && ca < 0.32 && u < 3.7 ? base : mix(light, base, sa > -0.4 ? 0.85 * smooth(0.6, 0.9, ca) : 0);
        return u > 2.0 && sa < -0.3 ? light : base;
      }
      if (h.tan && u > 2.2 && sa < -0.15) return tan;
      // a darker socket round each eye, blended out, so the eye sits in the face instead of on it
      const ea = Math.min(Math.abs(a - 0.3), Math.abs(a - (Math.PI - 0.3)));
      let c0 = mix(base, shade(base, 0.62), 0.8 * Math.exp(-((u - 1.97) ** 2) / 0.05 - (ea ** 2) / 0.06));
      // a blaze: white from the crown down the furrow, narrowing between the eyes and widening over the muzzle
      if (h.blaze) {
        const half = u < 1.7 ? 0.42 - 0.12 * smooth(0.6, 1.7, u) : u < 2.3 ? 0.3 - 0.12 * Math.sin(Math.PI * (u - 1.7) / 0.6) : 0.3 + 0.25 * smooth(2.3, 3.6, u);
        c0 = mix(c0, h.blaze, smooth(half + 0.16, half - 0.12, Math.abs(a - Math.PI / 2)) * smooth(0.5, 0.9, u) * smooth(-0.1, 0.2, sa));
      }
      return c0;
    },
  });
  const cum = [0];
  for (let i = 1; i < ctrl.length; i++) cum.push(cum[i - 1] + vlen(sub(ctrl[i], ctrl[i - 1])));
  const tAt = (u) => { const i = Math.min(ctrl.length - 2, Math.max(0, Math.floor(u))), f = clamp(u - i); return Math.min(0.995, (cum[i] + (cum[i + 1] - cum[i]) * f) / cum[cum.length - 1]); };
  const on = (u, a, lift = 0) => { const f = skull.at(tAt(u), a); return { p: madd(f.p, f.n, lift * s), n: f.n }; };
  const stroke = (pts, r, col, n) => inkless(M, () => tube(M, pts, pts.map((_, i) => r * s * (i === 0 || i === pts.length - 1 ? 0.35 : 1)), { ring: 6, seg: 4, flat: 0.35, up: n, form: n, col, cap: false }));
  const fc = skull.at(1, 0).c;                                       // the centre of the end of the muzzle
  const F = (x, u, d) => add(add(madd(fc, X, x * s), mul(U, u * s)), mul(D, d * s));

  // the jaw on its hinge under the cheek, opened by gape
  const hinge = cat ? L(sk * 0.62, -0.034) : madd(skull.at(tAt(1.6), -Math.PI / 2).p, U, 0.012 * s);
  const tipAt = cat ? L(sk * 1.12, -0.047) : ctrl[4], J0 = cat ? norm(sub(tipAt, hinge)) : D, jl = vlen(sub(tipAt, hinge)) * (cat ? 1 : 0.92);
  const Dj = norm(rot(J0, X, g)), Uj = norm(cross(Dj, X));
  const jaw = sweep(M, [hinge, madd(hinge, Dj, jl * 0.5), madd(hinge, Dj, jl)], (t2) => ({
    w: (cat ? 0.03 - 0.016 * t2 : 0.04 - 0.02 * t2) * s * mw, h: (cat ? 0.013 - 0.004 * t2 : 0.02 - 0.009 * t2) * s, oy: 0.004 * s,
  }), {
    up: Uj, ring: 24, seg: 6,
    col: (t2, a) => { const sa = Math.sin(a); return sa > 0.5 && g > 0.05 ? mouth : sa > (cat ? 0.34 : 0.12) ? lip : cat ? light : h.tan ? tan : base; },
  });
  const T_ = C(h.teeth), tooth = (b, tip, r) => spike(M, b, tip, r * s, { col: T_, mat: MAT.GLOSS, ring: 10, mid: 0.7 });
  const eyes = [];
  const ears = (kindOf, rootU, rootA, len, wid, o) => {
    for (const sd of [1, -1]) {
      const kind = typeof kindOf === 'function' ? kindOf(sd) : kindOf;
      if (kind === 'none') continue;
      const rt = on(rootU, sideA(sd, rootA), -0.006);
      withFur(M, 0, () => leafEar(M, rt.p, { D, U, O: mul(X, sd) }, kind, len, wid, base, C(h.inner), { seed: (h.seed || 3) + sd, thick: 0.004 * s, s, scar: h.cheek, ...o }));
    }
  };

  if (!cat) {
    // ── the dog
    // the forehead: the furrow down its middle, and what the face is doing. A snarl knots it into frown lines between
    // the brows; otherwise it's a wary dog, its forehead creased across over brows held up. The temples carry the
    // comic manner's hatching where they turn from the light.
    const angry = g >= 0.18, crease = shade(base, 0.5);
    stroke([on(2.12, Math.PI / 2, 0.0006).p, on(1.8, Math.PI / 2, 0.0008).p, on(1.4, Math.PI / 2, 0.0006).p], 0.0024, crease, U);
    if (angry) for (const sd of [1, -1]) for (let k = 0; k < 2; k++) {
      const a0 = Math.PI / 2 - sd * (0.1 + k * 0.1);
      stroke([on(2.1, a0 - sd * 0.02, 0.0006).p, on(1.92, a0, 0.0008).p, on(1.72, a0 + sd * 0.06, 0.0006).p], 0.002, crease, U);
    } else for (let k = 0; k < 2; k++) {
      const u = 1.62 - k * 0.15, pts = [0.8, 1.18, 1.57, 1.96, 2.34].map((a, i) => on(u + (i === 2 ? 0.06 : i % 2 ? 0.02 : 0), a, 0.0007).p);
      stroke(pts, 0.0018, crease, U);
    }
    // hatching on the temple behind each eye, where the brow ridge throws its shadow
    for (const sd of [1, -1]) for (let k = 0; k < 5; k++) {
      const u = 1.45 + k * 0.08;
      stroke([on(u, sideA(sd, 0.42), 0.0005).p, on(u + 0.1, sideA(sd, 0.6), 0.0006).p], 0.0013, shade(base, 0.5), mul(X, sd));
    }
    if (angry) for (let k = 0; k < 3; k++) {
      const u = 2.35 + k * 0.22, pts = [0.45, 0.95, 1.57, 2.19, 2.69].map((a, i) => on(u + (i % 2 ? 0.04 : -0.02), a, 0.0008).p);
      stroke(pts, 0.002, shade(base, 0.42), U);
    }
    // the lips: a roll along each side of the muzzle with a black edge, meeting under the nose, drawn up by a snarl
    const snarl = clamp((g - 0.1) / 0.25);
    for (const sd of [1, -1]) {
      const pts = [];
      for (let k = 0; k <= 5; k++) {
        const f = on(1.75 + k * 0.44, sideA(sd, -0.62 - k * 0.05), 0.001);
        pts.push(add(f.p, mul(U, (-0.007 + snarl * 0.009 * smooth(0.2, 1, k / 5)) * s)));
      }
      pts.push(add(on(3.98, -Math.PI / 2, 0.001).p, mul(U, (-0.005 + snarl * 0.006) * s)));
      tube(M, pts, [0.004, 0.009, 0.01, 0.01, 0.009, 0.007, 0.004].map((v) => v * s * mw), {
        ring: 14, seg: 5, flat: 0.5, up: mul(X, sd),
        col: (t2, a) => (sd * Math.cos(a) > 0.15 ? lip : h.tan ? tan : base),
      });
    }
    // the teeth: canines and incisors, a couple of premolars that only a snarl shows
    if (g > 0.04) {
      for (const sd of [1, -1]) {
        const up0 = on(3.55, sideA(sd, -1.22), -0.003).p, lo0 = jaw.at(0.86, Math.PI / 2 - sd * 0.7).p;
        tooth(up0, add(add(up0, mul(U, -0.026 * s)), add(mul(D, 0.003 * s), mul(X, -sd * 0.003 * s))), 0.0058);
        tooth(madd(lo0, Dj, 0.004 * s), add(madd(lo0, Dj, 0.006 * s), mul(Uj, 0.021 * s)), 0.005);
        for (const u of [2.8, 3.1]) { const q = on(u, sideA(sd, -1.05), -0.002).p; tooth(q, madd(q, U, -0.011 * s), 0.0045); }
      }
      for (let k = 0; k < 6; k++) {
        const a = -Math.PI / 2 + (k - 2.5) * 0.24, q = on(3.95, a, -0.001).p, r2 = jaw.at(0.97, Math.PI / 2 + (k - 2.5) * 0.26).p;
        tooth(q, madd(q, U, -0.009 * s), 0.0028);
        tooth(r2, madd(r2, Uj, 0.007 * s), 0.0024);
      }
    }
    // the nose: leather, boxy, with comma nostrils and a groove down to the lip
    if (h.nose) {
      const nf = norm(add(D, mul(U, 0.18))), nu = norm(cross(nf, X)), leather = mix(h.nose, '#6a6260', 0.4);
      blob(M, madd(madd(ctrl[4], D, 0.007 * s), U, 0.006 * s), [0.016 * s * mw, 0.012 * s, 0.012 * s], {
        axes: [X, nu, nf], e1: 0.72, e2: 0.72, nu: 40, nv: 24, mat: MAT.GLOSS,
        col: (d) => {
          if (d[2] > 0.1) {
            const nx = Math.abs(d[0]) - 0.4, ny = d[1] + 0.05, rx = nx * 0.94 + ny * 0.34, ry = -nx * 0.34 + ny * 0.94;
            if ((rx / 0.2) ** 2 + (ry / 0.32) ** 2 < 1) return '#020101';
            if (Math.abs(d[0]) < 0.06 && d[1] < -0.25) return '#020101';
          }
          return d[1] > 0.6 ? shade(leather, 0.85) : leather;
        },
      });
    }
    // the eyes, set forward at the stop, rimmed in black, lashed, under brow pads in the tan of the muzzle (the pips
    // a black-and-tan dog has), held up by a wary dog and pulled down by a snarling one. A dog shows next to no white:
    // the iris fills the opening and what's left at the corners is dark.
    const pips = mix(base, h.tan ? tan : base, 0.75);
    for (const sd of [1, -1]) {
      const r = h.eyeR * s * 1.55, e = on(1.97, sideA(sd, 0.3)), look = norm(add(add(D, mul(X, sd * 0.32)), mul(U, 0.06)));
      const ep = madd(e.p, e.n, -0.45 * r);
      const E = almondEye(M, ep, r, look, U, sd, {
        iris: h.iris, glow: h.eyeGlow, white: h.white || mix(h.iris, '#140e0c', 0.65), lid: base, rim: ink, liner: ink, linerW: 0.2,
        wide: 0.92, upper: 0.62, lower: 0.5, tilt: 0.08, scowl: angry ? 0.3 : 0, irisR: 0.92, lashes: 5, form: e.n,
        brow: Math.max(0.9, h.brow * 1.3), browCol: pips, browTilt: angry ? -0.5 : 0.45, browR: [0.14, 0.42, 0.52, 0.48, 0.3, 0.08],
      });
      // the inner corner runs on down the side of the bridge
      stroke([E.P(-E.A * 0.96, 0, 1.0), E.P(-E.A * 0.99, -0.2, 1.06), add(E.P(-0.99, -0.35, 1.1), mul(D, 0.25 * r))], 0.0012, ink, e.n);
      eyes.push(ep);
    }
    // a few dark whisker spots on the muzzle, and the whiskers where the dog has them
    for (const sd of [1, -1]) for (let i = 0; i < 4; i++) {
      const f = on(3.0 + i * 0.22, sideA(sd, -0.22 - 0.1 * (i % 2)), 0.0004);
      inkless(M, () => blob(M, f.p, [0.0013 * s, 0.0013 * s, 0.0013 * s], { col: shade(base, 0.45), nu: 6, nv: 4, form: f.n }));
      if (i >= h.whiskers) continue;
      const dir = norm(add(add(mul(X, sd * 0.8), mul(D, 0.4)), mul(U, 0.06 - i * 0.1))), l = (h.whiskerMetal ? 0.07 : 0.05) * s;
      inkless(M, () => tube(M, [f.p, add(madd(f.p, dir, l * 0.5), mul(U, -0.003 * s)), add(add(madd(f.p, dir, l), mul(D, -l * 0.2)), mul(U, -0.01 * s))],
        [0.0013 * s * (h.whiskerMetal ? 1.6 : 1), 0.0008 * s, 0.0003 * s], { ring: 4, seg: 3, col: wcol, mat: wmat, cap: false }));
    }
    // ears
    const el = h.earLen * s;
    ears(h.ears, 0.3, 1.0, el * (h.ears === 'drop' ? 1.15 : 1), el * 0.62 * h.earW, { rake: 0.22, splay: 0.36 });
    // cheek ruff
    if (h.tufts > 0) {
      const fc2 = C(h.tuftCol || h.col);
      for (const sd of [1, -1]) for (let i = 0; i < 4; i++) {
        const f = on(0.5 + i * 0.25, sideA(sd, -0.35 - i * 0.16));
        tuft(M, f.p, add(add(mul(D, -0.8), mul(X, sd * 0.5)), mul(U, -0.3)), (0.03 + 0.01 * i) * s * h.tufts, 0.011 * s, fc2, f.n);
      }
    }
    return { skull, jaw, X, eyes, nose: ctrl[4] };
  }

  // ── the cat
  // A round face, drawn after a comic tom: the cranium a ball, the cheeks full and round either side, a short bridge
  // from between the eyes to a broad nose set just under them, and the muzzle a full mass under the nose with the
  // whisker pads on its front, not a snout. Points are in the head's own terms (L: along, up, across).
  // the cheeks, round, with a short ruff off their outer edge
  for (const sd of [1, -1]) {
    const jc = L(sk * 0.72, -0.018, sd * 0.042 * sw), jr = [0.027 * sw * s, 0.03 * s, 0.032 * s];
    withFur(M, M.furLen * 1.5, () => blob(M, jc, jr, { axes: [X, U, D], nu: 26, nv: 16, col: (d) => mix(base, light, smooth(-0.1, -0.55, d[1]) * smooth(0.0, 0.5, d[2]) * smooth(0.75, 0.3, d[0] * sd)) }));
    if (h.tufts > 0) for (let i = 0; i < 6; i++) {
      const k = i / 5, dd = norm([sd * 0.92, 0.25 - k * 0.95, 0.05 - k * 0.3]), q = add(add(add(jc, mul(X, dd[0] * jr[0])), mul(U, dd[1] * jr[1])), mul(D, dd[2] * jr[2]));
      const dir = add(add(mul(X, sd), mul(U, 0.1 - k * 0.9)), mul(D, -0.45 - 0.2 * k));
      tuft(M, q, dir, (0.018 + 0.014 * Math.sin(Math.PI * (0.2 + k * 0.6))) * s * h.tufts, 0.012 * s, k > 0.7 ? light : C(h.tuftCol || h.col), norm(sub(q, jc)), { curl: sd * 0.12 });
    }
  }
  // the muzzle: a full rounded mass under the nose, light
  const mzC = L(sk * 1.04, -0.03), mzR = [0.032 * mw * s, 0.022 * s, 0.024 * s];
  withFur(M, 0, () => blob(M, mzC, mzR, { axes: [X, U, D], nu: 26, nv: 16, col: light }));
  // the tabby's M on the forehead and the line back from each eye
  if (h.tabby) {
    const tb = C(h.tabby);
    for (const k of [-2, -1, 0, 1, 2]) {
      const a0 = Math.PI / 2 + k * 0.12, a1 = Math.PI / 2 + k * 0.32, u0 = 2.4 - Math.abs(k) * 0.1 - (k === 0 ? 0.12 : 0), u1 = 1.0 + Math.abs(k) * 0.08;
      stroke([on(u0, a0, 0.0006).p, on((u0 + u1) / 2, (a0 + a1) / 2, 0.0008).p, on(u1, a1, 0.0006).p], 0.0028, tb, U);
    }
    for (const sd of [1, -1]) stroke([on(2.3, sideA(sd, 0.12), 0.0006).p, on(1.85, sideA(sd, 0.14), 0.0008).p, on(1.35, sideA(sd, 0.22), 0.0006).p], 0.0026, tb, mul(X, sd));
  }
  // the eyes: big, almond, the outer corners up, one eye's width apart, the iris filling the opening, the upper lid
  // brought down toward the nose under a heavy brow. Each sits where the skull is one eye's width off the middle at
  // the height the face wants it, found by searching the skull
  const eyeH = 0.011 * s;
  for (const sd of [1, -1]) {
    const r = h.eyeR * s * 1.18, want = 1.95 * r;
    let bu = 2.5, ba = 0.6, err = Infinity;
    for (let u = 1.9; u <= 3.2; u += 0.02) for (let a = 0.05; a < 1.5; a += 0.01) {
      const q = sub(skull.at(tAt(u), a).p, at), e2 = Math.abs(dot(q, X) - want) + Math.abs(dot(q, U) - eyeH) + 0.6 * Math.abs(dot(q, D) - sk * 0.88 * s);
      if (e2 < err) { err = e2; bu = u; ba = a; }
    }
    const e = on(bu, sideA(sd, ba)), look = norm(add(add(D, mul(X, sd * 0.18)), mul(U, 0.03)));
    // sunk back along its own line of sight as well as into the skull, so the brow and the cheek stand round it
    const ep = madd(madd(e.p, e.n, -0.5 * r), look, -0.32 * r);
    almondEye(M, ep, r, look, U, sd, {
      iris: h.iris, glow: h.eyeGlow, slit: h.slit, white: h.white || shade(C(h.iris), 0.7), lid: base, lidLow: mix(base, light, 0.6), rim: ink, rimW: 0.12,
      liner: ink, linerW: 0.1, wide: 0.95, upper: 0.74, lower: 0.6, tilt: 0.3, scowl: h.scowl ?? 0.45, irisR: 1.2,
      brow: h.brow * 0.42, browCol: shade(base, 0.55), browTilt: -0.3, form: e.n, lidK: 1.1,
    });
    eyes.push(ep);
  }
  // the nose: a broad, rounded triangle of leather just under the eyes, at the top of the muzzle where the bridge
  // meets it, nostrils curling in at its lower corners and the groove under it
  const nf = norm(add(D, mul(U, 0.42))), nv = norm(cross(nf, X)), nc = L(sk * 1.1 + 0.013, -0.011), NW = 0.036 * s * mw, NH = 0.024 * s;
  sheet(M, (u, v) => {
    const c = 2 * u - 1, w = NW * (1 - 0.78 * Math.pow(v, 1.15)) * (1 - 0.12 * c * c);
    return add(add(madd(nc, X, (c * w) / 2), mul(nv, (0.42 - v) * NH)), mul(nf, 0.0065 * s * (1 - c * c) * (1 - Math.abs(2 * v - 0.9) * 0.45)));
  }, 24, 18, {
    thick: 0.003 * s, mat: MAT.GLOSS,
    col: (u, v) => (v < 0.25 ? mix(h.nose, '#ffffff', 0.12) : h.nose),
  });
  // the nostrils: a comma curling in at each lower corner, its own piece so its edge stays clean
  for (const sd of [1, -1]) {
    const np = add(add(madd(nc, X, sd * NW * 0.27), mul(nv, -0.12 * NH)), mul(nf, 0.0058 * s)), along = norm(add(mul(X, sd * 0.75), mul(nv, 0.66)));
    inkless(M, () => blob(M, np, [0.0042 * s * mw, 0.0016 * s, 0.0012 * s], { axes: [along, norm(cross(nf, along)), nf], col: '#1a0c0e', mat: MAT.GLOSS, nu: 14, nv: 8 }));
  }
  // the whisker pads on the front of the muzzle, each with its rows of dots and the whiskers out of them
  const padR = [0.015 * mw * s, 0.0125 * s, 0.012 * s];
  for (const sd of [1, -1]) {
    const pc = L(sk * 1.14, -0.028, sd * 0.0125 * mw);
    withFur(M, 0, () => blob(M, pc, padR, { axes: [X, U, D], nu: 26, nv: 16, col: light }));
    const surf = (dd) => { const d = norm(dd); return [add(add(add(pc, mul(X, d[0] * padR[0])), mul(U, d[1] * padR[1])), mul(D, d[2] * padR[2])), norm(add(add(mul(X, d[0] / padR[0]), mul(U, d[1] / padR[1])), mul(D, d[2] / padR[2])))]; };
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
      const [q, qn] = surf([sd * (0.3 + j * 0.2), 0.42 - i * 0.3, 0.9 - j * 0.18]);
      inkless(M, () => blob(M, q, [0.0012 * s, 0.0012 * s, 0.0012 * s], { col: shade(base, 0.45), nu: 6, nv: 4, form: qn }));
    }
    // the whiskers: soft, fine and uninked, in rows off the pads, each a long gentle arc that carries out, then
    // droops and sweeps back, longest in the middle row
    const wc = mix(wcol, '#ffffff', 0.25), nw = Math.max(4, (h.whiskers || 4) + 2);
    for (let k = 0; k < nw; k++) {
      const f = k / (nw - 1), row = Math.floor(f * 2.999), [q] = surf([sd * (0.62 + 0.12 * (k % 2)), 0.36 - row * 0.32, 0.7 - 0.1 * (k % 2)]);
      const dir = norm(add(add(mul(X, sd * 0.92), mul(D, 0.34 - 0.18 * f)), mul(U, 0.3 - f * 0.62))), l = (0.12 - 0.035 * Math.abs(f - 0.45) - 0.008 * (k % 2)) * s;
      const droop = (0.008 + 0.012 * f) * s;
      const pts = [q, add(madd(q, dir, l * 0.3), mul(U, 0.0015 * s)), add(add(madd(q, dir, l * 0.62), mul(D, -l * 0.1)), mul(U, -droop * 0.35)), add(add(madd(q, dir, l), mul(D, -l * 0.28)), mul(U, -droop))];
      inkless(M, () => tube(M, pts, [0.00095, 0.0007, 0.0004, 0.00008].map((v) => v * s * (h.whiskerMetal ? 1.5 : 1)), { ring: 5, seg: 6, col: wc, mat: wmat, cap: false }));
    }
  }
  // The mouth, as a cat's is made: the groove down from the nose to the split between the pads, and from the split
  // the upper lip on each side, black-edged, curving under its pad and back to a corner set well back under the
  // cheek. The jaw hangs a little open under it, its own lip black-edged, the fangs, the small incisors between them
  // and the tongue showing.
  const nb = madd(nc, nv, -0.58 * NH), padF = sk * 1.14 + 0.0125, padB = -0.028 - 0.0125;
  stroke([madd(nb, nf, 0.0015 * s), L(padF - 0.004, -0.024), L(padF - 0.004, padB + 0.002)], 0.0012, ink, D);
  for (const sd of [1, -1]) {
    const lipPts = [L(padF - 0.004, padB + 0.002), L(padF - 0.003, padB - 0.002, sd * 0.008), L(padF - 0.008, padB - 0.0015, sd * 0.018), L(padF - 0.018, padB + 0.002, sd * 0.026), L(padF - 0.032, padB + 0.006, sd * 0.031)];
    inkless(M, () => tube(M, lipPts, [0.0012, 0.0026, 0.003, 0.0024, 0.0012].map((v) => v * s), { ring: 8, seg: 5, flat: 0.6, up: norm(add(D, mul(X, sd * 0.4))), col: '#1e1214', cap: false }));
  }
  // the chin on the end of the jaw, small and set back under the pads, the tongue, and the teeth
  const jt = madd(hinge, Dj, jl);
  withFur(M, 0, () => blob(M, madd(madd(jt, Uj, -0.002 * s), Dj, -0.003 * s), [0.011 * mw * s, 0.0075 * s, 0.009 * s], { axes: [X, Uj, Dj], nu: 24, nv: 14, col: light }));
  if (g > 0.05) {
    blob(M, madd(jaw.at(0.72, Math.PI / 2).p, Uj, 0.0012 * s), [0.009 * s * mw, 0.003 * s, 0.013 * s], { axes: [X, Uj, Dj], nu: 18, nv: 8, col: '#d86a78', mat: MAT.GLOSS });
    for (const sd of [1, -1]) {
      const u0 = L(padF - 0.006, padB + 0.003, sd * 0.0072);
      tooth(u0, add(u0, add(mul(U, -0.0095 * s), mul(D, 0.0008 * s))), 0.0022);
      const l0 = jaw.at(0.86, Math.PI / 2 - sd * 0.55).p;
      tooth(l0, madd(l0, Uj, 0.0065 * s), 0.0018);
    }
    for (let k = 0; k < 6; k++) {
      const q = L(padF - 0.0055, padB + 0.001, (k - 2.5) * 0.0021);
      tooth(q, madd(q, U, -0.0028 * s), 0.0009);
    }
  }
  // ears: big, on the upper corners of the head, their outer edge running on from the cheek, open to the front with
  // fur standing in them
  const el = h.earLen * s;
  ears(h.ears, 1.05, 0.7, el * 0.92, el * 0.38 * h.earW, { rake: 0.0, splay: 0.5, cup: 0.6, point: 0.9, tufts: mix(C(h.inner), '#ffffff', 0.55) });
  return { skull, jaw, X, eyes, nose: nc };
}

// ── four legs ────────────────────────────────────────────────────────────────────────────────────────
// Built at a hound's proportions in metres, the multipliers stretching each part and `scale` the whole animal.
// `pose` turns it: the head low and the hackles up for a dog squaring up, the weight forward.
export const QUAD = {
  scale: 1, len: 0.62, legLen: 1, legW: 1, bodyW: 1, chestD: 1, chestW: 1, waist: 1, rump: 1, haunch: 1, bloat: 0, arch: 0.4, slope: 0,
  neckLen: 1, neckW: 1, neckRise: 0.55, headPitch: 0.3, hump: 0,
  head: {}, tail: { len: 0.42, r: 0.028, lift: 0.4, curl: -0.25, kind: 'thin' },
  coat: '#35292a', back: '#151012', belly: '#a0603a', patch: null, legs: '#221a19', paws: '#1a1414', claws: '#1c1816',
  hairless: false, skin: '#8a6a60', ribs: 0, scars: 0, scarCol: '#b08a7a', mange: 0, stripes: null, spots: null,
  hackles: 0.8, shag: 0.6, hoof: false, hoofCol: '#1a1614', collar: null, horns: null, mat: MAT.MATTE, breathe: 2.2, sway: 1, stance: 1,
  // the legs (gl/beast-legs.js): `foot` 'paw' | 'hoof' | 'rodent' (paws before, flat soles behind), `gait` 'stand' |
  // 'walk' | 'trot' | 'stalk'; `legTune` overrides LEG_PROPS per end ({ F: { k, ra, meta }, H: … }); `legOverride`
  // draws a foot of its own from the wrist down, keyed LF RF LH RH (the left is +X)
  foot: 'paw', gait: 'stand', speed: 1, pawK: 1, toeLen: 1, metaK: 1, retract: false, pads: '#141010', toeOut: 0.08, fidget: 'RF', legTune: null, legOverride: null,
};
// `over` is laid on last: the Bestiary's gait picker
export function quadruped(M, q0 = {}, t = 0, over = {}) {
  const q = { ...QUAD, ...q0, ...over, head: { ...HEAD, ...(q0.head || {}) }, tail: { ...QUAD.tail, ...(q0.tail || {}) } };
  if (q.hoof) q.foot = 'hoof';
  const from = mark(M), r = rng(q.seed || 3);
  const L = q.len, bw = q.bodyW, cd = q.chestD, clear = 0.34 * q.legLen, W = clear + 0.3 * cd, Hh = W - 0.035 + q.slope;
  // the legs at rest and the gait's clock, and the body over them now
  const LG = quadLegs(q, { L, W, Hh, cd, bw }), cyc = t * LG.hz, pose = bodyAt(q.gait, cyc, LG.H);
  const br = 1 + 0.02 * Math.sin(t * q.breathe * Math.PI * 2 / 3);
  const coat = C(q.coat), back = C(q.back), belly = C(q.belly), skin = C(q.skin);
  // the scars, each a short stroke at (t, a) on the body
  const scars = Array.from({ length: q.scars }, () => ({ t: 0.25 + 0.6 * r(), a: (r() < 0.5 ? 0.4 : Math.PI - 0.4) + (r() - 0.5) * 0.8, len: 0.05 + 0.08 * r(), ang: (r() - 0.5) * 2.4 }));
  const paint = (t2, a, p, region) => {
    const sa = Math.sin(a);
    let c = q.hairless ? mix(skin, shade(skin, 0.78), smooth(0.55, 0.8, fnoise(p, 9))) : coat;
    if (!q.hairless) {
      c = mix(c, back, smooth(0.45, 0.85, sa));
      c = mix(c, belly, smooth(-0.35, -0.7, sa));
      if (q.patch && region === 'body' && t2 > 0.8 && sa < -0.2) c = C(q.patch);
      if (q.patch && region === 'neck' && sa < -0.3) c = C(q.patch);
    }
    if (q.stripes) { const [f, sc, k] = q.stripes; if (Math.abs(Math.sin(p[2] * f + fnoise(p, 6) * 2.5)) > 1 - (k ?? 0.22) && sa > -0.5) c = C(sc); }
    if (q.spots) { const [f, sc] = q.spots; if (fnoise(p, f) > 0.66 && sa > -0.6) c = C(sc); }
    if (q.ribs && region === 'body' && t2 > 0.48 && t2 < 0.8 && Math.abs(Math.cos(a)) > 0.45 && sa < 0.35 && sa > -0.75) {
      if ((((t2 - 0.48) * 22) % 1) < 0.2) c = shade(c, 1 - 0.45 * q.ribs);
    }
    if (q.mange && fnoise(p, 11) > 1 - 0.3 * q.mange) c = mix(c, '#6e4c46', 0.85);
    if (region === 'body') for (const s of scars) {
      const dt = (t2 - s.t) * L * 1.6, da = (a - s.a) * 0.1, along = dt * Math.cos(s.ang) + da * Math.sin(s.ang), off = -dt * Math.sin(s.ang) + da * Math.cos(s.ang);
      if (Math.abs(along) < s.len / 2 && Math.abs(off) < 0.0035) c = C(q.scarCol);
    }
    return c;
  };
  // the spine, rump to brisket
  const spine = [[0, Hh + 0.005, -L / 2 - 0.1], [0, Hh + 0.035, -L / 2], [0, (Hh + W) / 2 + 0.035 * q.arch, -L * 0.05], [0, W, L / 2 - 0.03], [0, W - 0.1 * cd, L / 2 + 0.13]];
  const BK = [[0, [0.045, 0.05, -0.04]], [0.07, [0.085 * q.rump, 0.095 * q.rump, -0.065]], [0.18, [0.09 * q.rump, 0.1 * q.rump, -0.075]],
    [0.4, [0.07 * q.waist + 0.05 * q.bloat, 0.08 * q.waist + 0.06 * q.bloat, -0.07 - 0.04 * q.bloat]], [0.62, [0.105 * q.chestW + 0.04 * q.bloat, 0.15 * cd + 0.03 * q.bloat, -0.13 * cd - 0.02 * q.bloat]],
    [0.82, [0.1 * q.chestW, 0.155 * cd, -0.14 * cd]], [0.95, [0.07, 0.11 * cd, -0.12 * cd]], [1, [0.03, 0.05, -0.1 * cd]]];
  // `fur` ({ body, head, legs, tail } in model units) coats each part as it's made; furShells grows it at the end
  M.furLen = q.fur?.body || 0;
  const body = sweep(M, spine, (t2) => {
    const [w, h, oy] = keys(BK, t2), k = t2 > 0.5 ? br : 1;
    return { w: w * bw * k, h: h * k, oy, b: q.hump ? (a) => q.hump * Math.pow(Math.max(0, Math.sin(a)), 3) * Math.exp(-((t2 - 0.8) ** 2) / 0.012) : null };
  }, { ring: 18, seg: 8, col: (t2, a, p) => paint(t2, a, p, 'body'), mat: q.mat });
  // the neck, from inside the shoulders up to the skull
  const B0 = [0, W - 0.07, L / 2 - 0.02], nr = q.neckRise, NL = 0.24 * q.neckLen, nd = [0, Math.sin(nr), Math.cos(nr)];
  const N2 = madd(B0, nd, NL), N1 = add(madd(B0, nd, NL * 0.5), [0, 0.02, 0]);
  const neck = sweep(M, [B0, N1, N2], (t2) => ({ w: (0.085 - 0.03 * t2) * q.neckW, h: (0.105 - 0.045 * t2) * q.neckW + q.hump * 0.3 * Math.max(0, 0.4 - t2) }),
    { ring: 16, seg: 6, col: (t2, a, p) => paint(t2, a, p, 'neck'), mat: q.mat });
  // the head, pitched down by headPitch
  const hp = q.headPitch + pose.nod, D = [0, -Math.sin(hp), Math.cos(hp)], U = [0, Math.cos(hp), Math.sin(hp)];
  M.furLen = q.fur?.head || 0;
  const head = mammalHead(M, madd(N2, U, 0.01), D, U, { tuftCol: q.coat, ...q.head, seed: q.seed }, t);
  // horns off the crown, swept out and forward
  if (q.horns) {
    const hn = q.horns, hc = C(hn.col || '#d8c8a8');
    for (const sd of [1, -1]) {
      const root = head.skull.at(0.18, sd > 0 ? 0.55 : Math.PI - 0.55), Xh = head.X, l = hn.len || 0.12;
      const p1 = add(root.p, add(mul(Xh, sd * l * 0.45), mul(U, l * 0.05))), p2 = add(root.p, add(add(mul(Xh, sd * l * 0.8), mul(U, l * 0.35)), mul(D, l * 0.25)));
      const p3 = add(root.p, add(add(mul(Xh, sd * l * 0.75), mul(U, l * 0.75)), mul(D, l * (hn.fwd ?? 0.5))));
      tube(M, [madd(root.p, root.n, -0.01), p1, p2, p3], [hn.r || 0.028, (hn.r || 0.028) * 0.85, (hn.r || 0.028) * 0.5, 0.002], {
        ring: 10, seg: 5, mat: hn.metal ? MAT.METAL : MAT.SATIN, col: (t2) => mix(hc, hn.tip || hc, smooth(0.5, 1, t2)),
      });
    }
  }
  // legs (gl/beast-legs.js): each foot where the gait has it, the joints solved up to the shoulder or the hip, which
  // ride with the body; everything else is swayed with the body at the end, the legs left where they were built
  M.furLen = q.fur?.legs || 0;
  const lw = q.legW, lc = C(q.legs);
  const legCoat = (p, k) => (q.hairless ? paint(0.3, 0, p, 'leg') : mix(paint(0.3, 0, p, 'leg'), lc, smooth(0.3, 0.6, k)));
  const look = { lw, haunch: q.haunch, arm: q.arm, wrist: q.wrist, pawStyle: q.pawStyle, coat: legCoat, legCol: q.legs, paws: q.paws, pads: q.pads, claws: q.claws, hoofCol: q.hoofCol, retract: q.retract, pawK: q.pawK, toeLen: q.toeLen, toeOut: q.toeOut, override: q.legOverride };
  const sway = bodyXf(pose, [0, (W + Hh) / 2, 0]), keep = [];
  for (const key of LEG_KEYS) {
    const rig = LG.rigs[key], s = rig.s, k0 = mark(M);
    const step = footAt(q.gait, key, cyc, { H: LG.H, S: LG.S, fidget: q.fidget });
    // the shoulder joint rides forward and back a little with its foot, as the blade turns
    const P = sway.p(rig.front ? add(rig.P0, [0, 0, 0.15 * step.dz]) : rig.P0);
    const J = mammalLeg(M, rig, P, rig.top ? sway.p(rig.top) : null, step, look);
    // a tuft off the back of the elbow or the thigh
    if (q.shag > 0 && !q.hairless) {
      const pj = rig.front ? J.K : lerp3(J.P, J.K, 0.55), dir = rig.front ? [s * 0.2, -0.5, -1] : [s * 0.25, -0.6, -1];
      for (let i = 0; i < 2; i++) tuft(M, add(pj, [s * 0.02 * lw, -0.01 - i * 0.025, -0.02]), dir, (0.035 + 0.01 * i) * q.shag, 0.012, coat, norm([s, 0, -0.4]));
    }
    keep.push([k0, mark(M), key, step.down]);
  }
  // the tail
  {
    const tl = q.tail, n = 6, dir0 = [0, Math.sin(tl.lift), -Math.cos(tl.lift)], pts = [[0, Hh + 0.005, -L / 2 - 0.08]];
    let d = dir0;
    const seg = (tl.len || 0.4) / (n - 1);
    for (let i = 1; i < n; i++) {
      d = norm(rot(d, [1, 0, 0], tl.curl || 0));
      const sway = Math.sin(t * 1.6 * q.sway + i * 0.5) * 0.012 * i * q.sway;
      pts.push(add(madd(pts[i - 1], d, seg), [sway, 0, 0]));
    }
    const rr = tl.r || 0.028;
    const radii = tl.kind === 'bushy' ? [rr, rr * 1.7, rr * 1.9, rr * 1.7, rr * 1.2, rr * 0.3] : tl.kind === 'tuft' ? [rr, rr * 0.7, rr * 0.55, rr * 0.5, rr * 0.9, rr * 0.2] : [rr, rr * 0.8, rr * 0.6, rr * 0.45, rr * 0.3, rr * 0.08];
    const tc = C(tl.col || q.coat);
    M.furLen = q.fur?.tail || 0;
    tube(M, pts, radii, {
      ring: 10, seg: 4, mat: q.mat,
      col: (t2, a, p) => (tl.rings && Math.floor(t2 * tl.rings[0]) % 2 ? C(tl.rings[1]) : tl.kind === 'tuft' && t2 > 0.75 ? shade(tc, 0.5) : q.hairless ? skin : tc),
    });
    if (q.shag > 0 && !q.hairless && tl.kind !== 'rat') for (let i = 1; i < n - 1; i++) {
      const dn = norm(sub(pts[i + 1], pts[i])), sd = i % 2 ? 1 : -1;
      tuft(M, pts[i], add(dn, [sd * 0.4, -0.3, 0]), 0.04 * q.shag, 0.01, tc, norm([sd, -0.4, 0]));
    }
  }
  M.furLen = 0;
  // hackles: a ridge of fur from the neck down the back, up and back
  if (q.hackles > 0 && !q.hairless) {
    for (let i = 0; i < 12; i++) {
      const onNeck = i < 5, f = onNeck ? neck.at(0.85 - i * 0.16, Math.PI / 2 + (i % 2 ? 0.25 : -0.25)) : body.at(0.92 - (i - 5) * 0.06, Math.PI / 2 + (i % 2 ? 0.2 : -0.2));
      const len = (0.035 + 0.025 * r()) * q.hackles * (onNeck ? 1 : 1 - (i - 5) * 0.08);
      tuft(M, f.p, add(mul(f.n, 1), mul(f.T, onNeck ? -0.55 : -0.7)), len, 0.013, back, f.n, { curl: (r() - 0.5) * 0.4 });
    }
    // and a ruff under the throat
    for (let i = 0; i < 4; i++) {
      const f = neck.at(0.3 + i * 0.15, -Math.PI / 2 + (i % 2 ? 0.35 : -0.35));
      tuft(M, f.p, add(f.n, [0, -0.6, 0.2]), 0.04 * q.shag, 0.014, q.patch ? C(q.patch) : belly, f.n);
    }
  }
  // a collar, once somebody's pet: a strap round the neck and a tag
  if (q.collar) {
    const f = neck.frames[Math.floor(neck.frames.length * 0.35)], cw = f.pr.w * 1.04, ch = f.pr.h * 1.04;
    loop(M, (s) => { const a = s * Math.PI * 2; return add(add(f.c, mul(f.X, Math.cos(a) * cw)), mul(f.Y, Math.sin(a) * ch + (f.pr.oy || 0))); }, 0.009, { col: q.collar, mat: MAT.LEATHER, flat: 0.5, up: f.T, ring: 6 });
    blob(M, add(add(f.c, mul(f.Y, -ch - 0.018)), mul(f.T, 0.01)), [0.012, 0.016, 0.003], { col: '#c8b070', mat: MAT.METAL, nu: 10, nv: 6 });
  }
  if (q.extra) q.extra(M, { body, neck, head, W, Hh, L, clear, U, D, paint }, t);
  sway.apply(M, from, keep);
  if (q.scale !== 1) scaleFrom(M, from, q.scale);
  if (q.fur) furShells(M, from, q.fur);
  // each leg's triangles and whether its foot is down, for scripts/beasts/legs-smoke.mjs
  return { body, neck, head, legs: keep.map(([a, b, key, down]) => ({ key, down, t0: a.t, t1: b.t })) };
}

// ── a jointed leg ────────────────────────────────────────────────────────────────────────────────────
/**
 * An arthropod's leg from `root` out along the level unit `h`: coxa, trochanter, femur up to the knee, a short
 * patella over it, the tibia down, the metatarsus to the ground and the tarsus along it, ending in two claws. Each
 * segment is its own tapering tube, swollen where the muscle is, flaring into a collar at its far end that carries
 * the `band` colour, with a pale membrane (`joint`) at every joint, so the leg reads as segments from across a room.
 * `spines` rows of thorns rake toward the tip along femur, tibia and metatarsus; `hair` adds setae; `wrong` puts
 * a backward kink in the tibia (a thing jointed wrong); `stripe` alternates whole segments between col and band.
 */
export function jointedLeg(M, root, h, o = {}) {
  const R = o.reach || 0.2, r = o.r || 0.006, rr = rng(o.seed || 1), up = [0, 1, 0];
  const g = -root[1] + 0.002, kn = o.knee ?? R * 0.35, st = o.step || 0;
  const P = (u, y) => [root[0] + h[0] * u * R, root[1] + y, root[2] + h[2] * u * R];
  const y5 = g + (kn - g) * 0.42 + st * 0.6;
  const J = [P(0, 0), P(0.07, -0.012 * R), P(0.12, 0.004 * R), P(0.4 * (o.femurRise ?? 1), kn + st), P(0.48, kn + 0.025 * R + st), P(0.72, y5)];
  if (o.wrong) J.push(P(0.8, y5 + (kn - g) * 0.22 + st * 0.3));
  J.push(P(0.94, g + 0.05 * R + st * 0.4), P(1.0, g + st * 0.2));
  const names = o.wrong ? ['coxa', 'troch', 'femur', 'patella', 'tibia', 'kink', 'meta', 'tarsus'] : ['coxa', 'troch', 'femur', 'patella', 'tibia', 'meta', 'tarsus'];
  const RAD = { coxa: [1.35, 1.3, 1.2], troch: [1.05, 1.0, 1.05], femur: [0.95, 1.2, 0.95], patella: [0.85, 0.95, 0.9], tibia: [0.8, 0.88, 0.75], kink: [0.72, 0.8, 0.7], meta: [0.62, 0.6, 0.5], tarsus: [0.42, 0.34, 0.16] };
  const col = C(o.col || '#2a1810'), band = C(o.band || shade(col, 0.5)), joint = C(o.joint || mix(col, '#d8c8a8', 0.35)), tip = o.tip ? C(o.tip) : null;
  const mat = o.mat ?? MAT.GLOSS, spineCol = C(o.spineCol || band);
  for (let k = 0; k < J.length - 1; k++) {
    const a = J[k], b = J[k + 1], name = names[k], [r0, rm, r1] = RAD[name].map((v) => v * r), d = norm(sub(b, a));
    const side = norm(cross(d, up)), upr = norm(cross(side, d));
    // the segment, swollen on its upper side, its far end a collar
    const segCol = o.stripe && k % 2 ? band : name === 'tarsus' && tip ? tip : col;
    tube(M, [madd(a, d, r * 0.15), add(lerp3(a, b, 0.42), mul(upr, rm * 0.18)), madd(b, d, -r1 * 0.2), b], [r0 * 0.82, rm, r1 * 1.12, r1 * 0.95], {
      ring: o.ring ?? (r < 0.01 ? 7 : 10), seg: r < 0.01 ? 3 : 4, mat, up: upr, shade: o.shade, rim: o.rim,
      col: (t2) => (t2 > 0.84 ? band : segCol),
    });
    // the membrane at the joint
    if (k < J.length - 2) blob(M, b, [r1 * 0.78, r1 * 0.78, r1 * 0.78], { col: joint, nu: 8, nv: 5, mat: MAT.SATIN, shade: o.shade });
    // thorns, raked toward the tip
    const nsp = name === 'femur' || name === 'tibia' ? o.spines || 0 : name === 'meta' || name === 'kink' ? Math.ceil((o.spines || 0) / 2) : 0;
    for (let i = 0; i < nsp * 2; i++) {
      const tt = 0.2 + 0.65 * ((Math.floor(i / 2) + 0.5) / nsp), ang = (i % 2 ? 0.75 : -0.75) + (name === 'tibia' ? Math.PI : 0) + (rr() - 0.5) * 0.3;
      const radial = norm(add(mul(side, Math.cos(ang + Math.PI / 2)), mul(upr, Math.sin(ang + Math.PI / 2))));
      const base = madd(lerp3(a, b, tt), radial, rm * 0.85), len = r * (o.spineLen ?? 2.6) * (0.75 + 0.5 * rr());
      spike(M, base, add(madd(base, radial, len * 0.75), mul(d, len * 0.7)), r * 0.32, { col: spineCol, ring: 5, mat: MAT.SATIN, bend: mul(radial, len * 0.08) });
    }
    // setae
    const nh = Math.round((o.hair || 0) * (name === 'femur' || name === 'tibia' ? 14 : name === 'meta' ? 9 : 4));
    for (let i = 0; i < nh; i++) {
      const tt = 0.1 + 0.8 * rr(), ang = rr() * Math.PI * 2, radial = norm(add(mul(side, Math.cos(ang)), mul(upr, Math.sin(ang))));
      const base = madd(lerp3(a, b, tt), radial, rm * 0.9);
      spike(M, base, add(madd(base, radial, r * 1.3), mul(d, r * 0.9)), r * 0.13, { col: band, ring: 3, mid: 0.7 });
    }
  }
  // the claws
  const end = J[J.length - 1], dd = norm(sub(end, J[J.length - 2])), sd = norm(cross(dd, up));
  for (const k of [1, -1]) spike(M, end, add(add(madd(end, dd, r * 1.2), mul(sd, k * r * 0.5)), [0, -r * 0.6, 0]), r * 0.22, { col: tip || band, ring: 4, mat: MAT.SATIN, bend: mul(up, r * 0.3) });
  return J;
}

// ── jointed things: insects, spiders, crawlers ───────────────────────────────────────────────────────
// A body of head, thorax and abdomen as one flattened loft, banded, with pairs of jointed legs round the thorax.
export const BUG = {
  scale: 1, len: 0.3, width: 0.09, height: 0.05, lift: 0.04, abdomen: 0.55, thorax: 0.25, headR: 0.03,
  pairs: 3, reach: 0.17, knee: 0.06, legR: 0.007, legJoints: 3, spread: 1.0, front: 0,
  col: '#3a2418', under: '#5a3a22', band: '#1a0e08', bands: 9, legCol: '#2a1810', gloss: true, metal: false,
  antennae: 0.22, mandibles: 0.02, eyes: 2, eyeCol: '#101010', eyeGlow: false, wings: false, wingCol: '#4a2a14', hair: 0,
};
export function arthropod(M, b0 = {}, t = 0) {
  const b = { ...BUG, ...b0 }, from = mark(M), r = rng(b.seed || 5);
  const L = b.len, y0 = b.lift + b.height;
  const mat = b.metal ? MAT.METAL : b.gloss ? MAT.GLOSS : MAT.MATTE;
  const wob = Math.sin(t * 2.4) * 0.004;
  const spine = [[0, y0 - 0.2 * b.height, -L / 2], [0, y0, -L / 6], [0, y0 + 0.1 * b.height, L / 6], [0, y0 - 0.1 * b.height + wob, L / 2]];
  const a0 = b.abdomen, a1 = a0 + b.thorax;
  const prof = b.prof || ((t2) => {
    // abdomen, a waist, the thorax, a neck, the head
    const K = [[0, [0.15, 0.2]], [0.12, [0.85, 0.8]], [a0 * 0.6, [1, 1]], [a0, [0.55, 0.6]], [a0 + 0.04, [0.7, 0.75]], [a1 - 0.04, [0.75, 0.8]], [a1, [0.45, 0.5]], [a1 + 0.06, [0.6, 0.65]], [1, [0.25, 0.3]]];
    const [w, h] = keys(K, t2);
    return { w: w * b.width, h: h * b.height, e: 2.4 };
  });
  const body = sweep(M, spine, prof, {
    ring: 16, seg: 8, mat,
    col: (t2, a, p) => {
      const sa = Math.sin(a);
      let c = sa < -0.3 ? C(b.under) : C(b.col);
      if (b.paint) { const pc = b.paint(t2, a, p); if (pc) return C(pc); }
      if (t2 < a0 && (t2 * b.bands) % 1 < 0.14 && sa > -0.4) c = C(b.band);
      if (b.hair && fnoise(p, 30) > 0.6) c = shade(c, 0.75);
      return c;
    },
  });
  // legs: pairs spread from forward to back round the thorax, each a real arthropod's: coxa, trochanter, femur,
  // patella, tibia, metatarsus and tarsus, banded at every joint, spined and haired (jointedLeg)
  for (let i = 0; i < b.pairs; i++) {
    const f = b.pairs === 1 ? 0.5 : i / (b.pairs - 1), tA = a0 + 0.04 + (b.thorax - 0.08) * (1 - f);
    const phi = (0.95 - 1.9 * f) * b.spread + b.front;
    for (const s of [1, -1]) {
      const root = body.at(tA, s > 0 ? -0.2 : Math.PI + 0.2).p, h = [s * Math.cos(phi), 0, Math.sin(phi)];
      const step = Math.max(0, Math.sin(t * 6 + i * 2.1 + (s > 0 ? 0 : Math.PI))) * 0.012 * (b.twitch ?? 1) * b.reach;
      const reach = b.reach * (b.reachK ? b.reachK(i, s) : 1);
      jointedLeg(M, root, h, {
        reach, knee: b.knee, r: b.legR, col: b.legCol, band: b.legBand || b.band, joint: b.legJoint || b.under, tip: b.legTip, mat,
        spines: b.spines ?? (b.hair ? 3 : 1), spineCol: b.spineCol || b.legTip || b.band, spineLen: b.spineLen ?? 2.6,
        hair: b.hair || 0, wrong: b.wrong || false, step, seed: i * 7 + (s > 0 ? 1 : 2) + (b.seed || 0), shade: b.legShade, rim: b.legRim,
        stripe: b.legStripe || 0, femurRise: b.femurRise,
      });
    }
  }
  const hd = body.at(0.97, 0), Hc = madd(hd.c, hd.T, 0.005), D = hd.T, X = hd.X, U = hd.Y;
  // eyes
  if (b.eyes) for (const s of [1, -1]) {
    const e = body.at(0.93, s > 0 ? 0.6 : Math.PI - 0.6);
    eye(M, e.p, b.width * 0.12, norm(add(e.n, mul(D, 0.6))), { iris: b.eyeCol, pupil: b.eyeCol, glow: b.eyeGlow, white: b.eyeCol });
  }
  // antennae, swept up and back, twitching
  if (b.antennae) for (const s of [1, -1]) {
    const root = body.at(0.985, s > 0 ? 0.9 : Math.PI - 0.9).p, tw = Math.sin(t * 3.3 + s) * 0.03;
    const al = b.antennae;
    tube(M, [root, add(root, [s * al * 0.2, al * 0.25, al * 0.35]), add(root, [s * (al * 0.45 + tw), al * 0.35, al * 0.5]), add(root, [s * (al * 0.7 + tw), al * 0.25 + tw, al * 0.45])], [0.0028, 0.002, 0.0014, 0.0008], { ring: 5, seg: 4, col: b.legCol, mat });
  }
  if (b.mandibles) for (const s of [1, -1]) {
    const root = add(body.at(1, s > 0 ? -0.5 : Math.PI + 0.5).p, mul(D, -0.004));
    spike(M, root, add(madd(root, D, b.mandibles), mul(X, -s * b.mandibles * 0.6)), b.mandibles * 0.25, { col: b.band, mat: MAT.SATIN, bend: mul(X, s * b.mandibles * 0.25) });
  }
  if (b.wings) for (const s of [1, -1]) {
    // wing covers lying over the abdomen, parted at the back
    const c = add(body.at(a0 * 0.55, Math.PI / 2).c, [s * b.width * 0.42, b.height * 0.55, 0]);
    blob(M, c, [b.width * 0.55, b.height * 0.32, L * 0.36], { axes: [[1, 0, 0], [0, 1, 0], norm([-s * 0.12, -0.05, 1])], e1: 0.8, col: (d) => (d[1] > 0 ? C(b.wingCol) : C(b.under)), mat: MAT.GLOSS, nu: 14, nv: 8 });
  }
  // armour: the abdomen's tergites as overlapping plates, each lapping the one behind it, a shield over the thorax and
  // a capsule over the head, so the body reads as hard segments with a dark gap and a pale edge between them
  if (b.plates) {
    const n = b.plates, pc = C(b.plateCol || b.col), edge = C(b.plateEdge || b.band), pm = b.plateMat ?? mat;
    const plate = (t0, t1, k, lift) => {
      const f0 = body.at(t0, Math.PI / 2), f1 = body.at(t1, Math.PI / 2), mid = body.at((t0 + t1) / 2, Math.PI / 2);
      const c = add(lerp3(f0.c, f1.c, 0.5), mul(mid.Y, mid.h * lift)), along = norm(sub(f1.c, f0.c)), len = vlen(sub(f1.c, f0.c)) / 2;
      const ax = [mid.X, norm(cross(along, mid.X)), along];
      blob(M, c, [mid.w * k, mid.h * 0.62, len * 1.18], {
        axes: ax, e1: 0.55, e2: 0.8, mat: pm, nu: 18, nv: 9, shade: b.plateShade, rim: b.plateRim,
        col: (d) => (d[2] > 0.72 ? edge : d[1] < -0.2 ? C(b.under) : pc),
      });
    };
    for (let i = 0; i < n; i++) { const t0 = 0.04 + (a0 - 0.06) * (i / n), t1 = 0.04 + (a0 - 0.06) * ((i + 1) / n); plate(t0, t1 + 0.012, 1.08 - 0.1 * Math.abs(i / (n - 1) - 0.55), 0.42); }
    plate(a0 + 0.03, a1 - 0.02, 1.12, 0.5);
    if (b.capsule !== false) plate(a1 + 0.01, 0.99, 1.05, 0.35);
  }
  if (b.extra) b.extra(M, { body, D, X, U, Hc, y0 }, t);
  if (b.scale !== 1) scaleFrom(M, from, b.scale);
  return { body };
}

// ── long things: snakes, eels, leeches, lampreys ─────────────────────────────────────────────────────
// A body laid in loose curves on the floor with the front raised, round in section, its head shaped by `head`.
export const SERPENT = {
  scale: 1, len: 1.6, r: 0.045, waves: 1.3, amp: 0.22, rise: 0.25, rest: 0.15, head: 'snake', col: '#3a4248', under: '#7a8088', pattern: null,
  ringsN: 0, ringCol: '#101010', fin: 0, finCol: '#202428', studs: 0, studCol: '#203040', glowTips: false, legs: 0, gloss: true, eyes: true, eyeCol: '#d8c030',
  teethCol: '#d8e0e0', mouthCol: '#3a1216',
};
export function serpent(M, s0 = {}, t = 0) {
  const s = { ...SERPENT, ...s0 }, from = mark(M), r = rng(s.seed || 9);
  const n = 22, pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, z = (u - 0.5) * s.len * 0.62;
    const x = s.amp * Math.sin(u * Math.PI * 2 * s.waves + t * 0.8) * (1 - 0.6 * smooth(0.75, 1, u));
    const lift = s.rise * smooth(1 - s.rest - 0.12, 1, u);
    pts.push([x, s.r * 0.9 + lift, z + (s.coil ? 0 : 0)]);
  }
  if (s.path) for (let i = 0; i <= n; i++) pts[i] = s.path(i / n, t);
  const mat = s.gloss ? MAT.GLOSS : MAT.MATTE;
  const rad = (u) => s.r * (s.radK ? s.radK(u) : Math.min(1, u * 5) ** 0.7 * (1 - 0.25 * smooth(0.85, 1, u)) + 0.02);
  const body = sweep(M, pts, (u) => ({ w: rad(u) * (s.wide || 1), h: rad(u) * (s.tall || 0.85) }), {
    ring: s.ring ?? 14, seg: s.seg ?? 4, mat,
    col: (u, a, p) => {
      const sa = Math.sin(a);
      let c = sa < -0.35 ? C(s.under) : C(s.col);
      if (s.pattern) { const pc = s.pattern(u, a, p); if (pc) c = C(pc); }
      if (s.ringsN && (u * s.ringsN) % 1 < 0.18) c = shade(c, 0.55);
      return c;
    },
  });
  const H = body.at(1, 0), D = H.T, U = H.Y, X = H.X, tip = madd(H.c, D, 0.005);
  if (s.fin) sheet(M, (u, v) => { const f = body.at(0.25 + 0.68 * u, Math.PI / 2); return madd(f.p, f.n, v * s.fin * Math.sin(Math.PI * u) * (0.6 + 0.4 * Math.sin(u * 30) ** 2)); }, 30, 2, { col: s.finCol, mat });
  if (s.head === 'snake' || s.head === 'eel') {
    // a wedge of a skull, wider than the neck, and a mouth that's open (the eel's ring of teeth)
    const hl = s.r * 3.2, gape = s.head === 'eel' ? 0.5 : 0.18;
    const skull = sweep(M, [madd(tip, D, -s.r * 0.8), madd(tip, D, hl * 0.4), madd(tip, D, hl)], (u) => ({ w: s.r * (1.25 - 0.55 * u) * (s.head === 'eel' ? 0.9 : 1.15), h: s.r * (0.8 - 0.35 * u), oy: s.r * 0.12 }), { up: U, ring: 14, seg: 5, mat, col: (u, a) => (Math.sin(a) < -0.5 ? C(s.under) : C(s.col)) });
    const hinge = skull.at(0.15, -Math.PI / 2).p, Dj = norm(sub(mul(D, Math.cos(gape)), mul(U, Math.sin(gape)))), Uj = norm(add(mul(U, Math.cos(gape)), mul(D, Math.sin(gape))));
    const jaw = sweep(M, [hinge, madd(hinge, Dj, hl * 0.45), madd(hinge, Dj, hl * 0.85)], (u) => ({ w: s.r * (0.9 - 0.45 * u), h: s.r * 0.22, oy: s.r * 0.08 }), { up: Uj, ring: 10, seg: 4, mat, col: (u, a) => (Math.sin(a) > 0.3 ? C(s.mouthCol) : C(s.under)) });
    if (s.head === 'eel') for (let i = 0; i < 10; i++) {
      const a = Math.PI * (0.15 + 0.7 * (i / 9)), q = skull.at(0.82, -a), w = jaw.at(0.78, a);
      spike(M, q.p, add(madd(q.p, U, -s.r * 0.35), mul(D, -s.r * 0.12)), s.r * 0.07, { col: s.teethCol, mat: MAT.GLOSS, ring: 5 });
      spike(M, w.p, add(madd(w.p, Uj, s.r * 0.3), mul(Dj, -s.r * 0.1)), s.r * 0.06, { col: s.teethCol, mat: MAT.GLOSS, ring: 5 });
    }
    if (s.eyes) for (const sd of [1, -1]) { const e = skull.at(0.45, sd > 0 ? 0.55 : Math.PI - 0.55); eye(M, madd(e.p, e.n, -s.r * 0.05), s.r * 0.22, norm(add(e.n, D)), { iris: s.eyeCol, slit: 0.6 }); }
    if (s.head === 'snake' && s.tongue !== false) { const tb = madd(skull.at(1, 0).c, D, s.r * 0.1), fl = Math.sin(t * 9) * s.r * 0.3; for (const sd of [1, -1]) tube(M, [tb, madd(tb, D, s.r * 1.2), add(madd(tb, D, s.r * 2.1), add(mul(X, sd * s.r * 0.35), mul(U, fl)))], [s.r * 0.06, s.r * 0.05, s.r * 0.015], { ring: 5, seg: 3, col: '#8a1a28' }); }
  } else if (s.head === 'sucker' || s.head === 'wheel') {
    // a lamprey's disc or a leech's mouth: a round face of teeth in rings, turned to you
    const R = s.r * (s.head === 'sucker' ? 1.5 : 1.1), fc = madd(tip, D, s.r * 0.3);
    sweep(M, [madd(tip, D, -s.r * 0.6), fc], (u) => ({ w: s.r * (1 - u) + R * u, h: s.r * 0.9 * (1 - u) + R * u }), { up: U, ring: 18, seg: 4, mat, cap: false, col: s.col });
    blob(M, fc, [R, R, R * 0.12], { axes: [X, U, D], nu: 20, nv: 8, mat, col: (d) => (d[2] < 0 ? C(s.col) : Math.hypot(d[0], d[1]) < 0.86 ? C(s.mouthCol) : C(s.lip || s.under)) });
    const rings = s.head === 'sucker' ? 4 : 2;
    for (let k = 0; k < rings; k++) {
      const rr = R * (0.78 - k * 0.17), cnt = 10 + k * 2;
      for (let i = 0; i < cnt; i++) {
        const a = (i / cnt) * Math.PI * 2 + k * 0.3, p = add(fc, add(mul(X, Math.cos(a) * rr), mul(U, Math.sin(a) * rr)));
        const inward = norm(sub(fc, p));
        spike(M, madd(p, D, R * 0.08), add(madd(p, D, R * (0.25 - k * 0.03)), mul(inward, R * 0.1)), R * (0.07 - k * 0.01), { col: s.teethCol, mat: MAT.GLOSS, ring: 5 });
      }
    }
  }
  if (s.studs) for (let i = 0; i < s.studs; i++) {
    const f = body.at(0.15 + 0.75 * r(), r() * Math.PI * 1.1 - 0.05), l = s.r * (0.25 + 0.4 * r());
    tube(M, [madd(f.p, f.n, -0.003), madd(f.p, f.n, l * 0.6), madd(f.p, f.n, l)], [s.r * 0.12, s.r * 0.1, s.r * 0.08], { ring: 6, seg: 2, col: s.studCol, mat: MAT.SATIN });
    blob(M, madd(f.p, f.n, l), [s.r * 0.1, s.r * 0.1, s.r * 0.1], { col: s.glowTips ? '#7ad8ff' : '#506070', mat: s.glowTips ? GLOW : MAT.GLOSS, nu: 6, nv: 4 });
    blob(M, f.p, [s.r * 0.22, s.r * 0.14, s.r * 0.22], { col: '#8a8470', form: f.n, nu: 8, nv: 5, lump: 0.3, seed: i });
  }
  if (s.legs) for (let i = 0; i < s.legs; i++) for (const sd of [1, -1]) {
    // what used to be legs: thin, folded, no use to it
    const f = body.at(0.62 + i * 0.12, sd > 0 ? -0.35 : Math.PI + 0.35), dir = norm(add(mul(f.X, sd), [0, -0.3, -0.4]));
    tube(M, [f.p, madd(madd(f.p, dir, s.r * 1.6), [0, 1, 0], s.r * 0.4), madd(madd(f.p, dir, s.r * 2.6), [0, 1, 0], -s.r * 0.6)], [s.r * 0.28, s.r * 0.18, s.r * 0.08], { ring: 7, seg: 4, col: s.col, mat });
    for (let k = 0; k < 3; k++) spike(M, madd(madd(f.p, dir, s.r * 2.6), [0, 1, 0], -s.r * 0.6), add(madd(madd(f.p, dir, s.r * 3.0), [0, 1, 0], -s.r * 0.8), mul(f.T, (k - 1) * s.r * 0.3)), s.r * 0.05, { col: s.under, ring: 4 });
  }
  if (s.extra) s.extra(M, { body, D, U, X, tip }, t);
  if (s.scale !== 1) scaleFrom(M, from, s.scale);
  return { body };
}

// ── heaps: slime, tar, middens ───────────────────────────────────────────────────────────────────────
// A lumpy mound of several blobs, with things half sunk in it.
export function mound(M, m = {}, t = 0) {
  const from = mark(M), r = rng(m.seed || 11), R = m.r || 0.4, H = m.h || 0.35, pulse = 1 + 0.03 * Math.sin(t * (m.rate || 1.3));
  const lobes = [{ c: [0, H * 0.45 * pulse, 0], r: [R, H * 0.6 * pulse, R * 0.9] }];
  for (let i = 0; i < (m.lobes ?? 4); i++) {
    const a = (i / (m.lobes ?? 4)) * Math.PI * 2 + r() * 0.8, d = R * (0.5 + 0.3 * r()), k = 0.35 + 0.35 * r();
    lobes.push({ c: [Math.cos(a) * d, H * 0.3 * k, Math.sin(a) * d], r: [R * k, H * 0.45 * k, R * k] });
  }
  for (const [i, l] of lobes.entries()) blob(M, l.c, l.r, { lump: m.lump ?? 0.18, seed: i * 3.1 + (m.seed || 0), freq: m.freq || 2.4, nu: 24, nv: 14, col: (d, p) => C(m.col ? (typeof m.col === 'function' ? m.col(d, p) : m.col) : '#6a7068'), mat: m.mat ?? MAT.GLOSS });
  // what's in it: each piece sunk part way into the surface
  const surf = (a, h) => { const l = lobes[0], dir = norm([Math.cos(a), h, Math.sin(a)]); return add(l.c, [dir[0] * l.r[0] * 0.92, dir[1] * l.r[1] * 0.92, dir[2] * l.r[2] * 0.92]); };
  if (m.debris) m.debris(M, surf, r, t);
  if (m.scale && m.scale !== 1) scaleFrom(M, from, m.scale);
}

// ── wings ────────────────────────────────────────────────────────────────────────────────────────────
// A bat's wing: the arm out to a wrist, fingers fanned from it, and a membrane between each finger and the body.
// `side` +1 is the left. `flap` 0 is spread level, 1 raised; `keep(u, v)` cuts holes in the membrane.
export function batWing(M, root, side, span, o = {}, t = 0) {
  const flap = o.flap ?? 0.15, up = Math.sin(flap) * span, sd = side;
  const elbow = add(root, [sd * span * 0.28, up * 0.3 + span * 0.05, -span * 0.08]);
  const wrist = add(root, [sd * span * 0.5, up * 0.6 + span * 0.1, span * 0.06]);
  const tips = (o.fingers || [[0.98, 0.25, 0.1], [0.9, -0.05, -0.12], [0.7, -0.25, -0.32], [0.45, -0.3, -0.45]]).map(([x, y, z]) => add(root, [sd * span * x, up * (0.7 + 0.3 * x) + span * y * 0.4, span * z]));
  const bone = C(o.bone || '#3a2a26'), mem = C(o.col || '#5a403a'), mat = o.mat ?? MAT.MATTE;
  tube(M, [root, elbow, wrist], [span * 0.025, span * 0.02, span * 0.014], { ring: 8, seg: 4, col: bone, mat });
  for (const tp of tips) tube(M, [wrist, lerp3(wrist, tp, 0.5), tp], [span * 0.01, span * 0.007, span * 0.003], { ring: 6, seg: 3, col: bone, mat });
  if (o.claw !== false) spike(M, wrist, add(wrist, [sd * span * 0.02, span * 0.05, span * 0.04]), span * 0.008, { col: '#1a1414', ring: 5 });
  // the membrane: from the body's flank to each finger in turn, the trailing edge scalloped
  const body = o.flank || add(root, [0, -span * 0.05, -span * 0.35]);
  const edge = [root, elbow, wrist, ...tips, body];
  const chain = [wrist, ...tips, body];
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i], b = chain[i + 1], anchor = i === 0 ? elbow : wrist;
    sheet(M, (u, v) => {
      const e = lerp3(a, b, u), sag = Math.sin(Math.PI * u) * span * 0.06 * (1 - v);
      return add(lerp3(anchor, e, v), [0, -sag * 0.5, sag]);
    }, 8, 6, {
      // `ember(U, v)` burns a cell (the edge of a hole); `memMat` is the membrane's own (TRANSLUCENT lets the light through)
      col: (u, v, sideK) => (o.ember && o.ember(i + u, v) ? C(o.emberCol || '#ff8a20') : sideK > 0 ? mem : shade(mem, 0.8)),
      mat: (u, v) => (o.ember && o.ember(i + u, v) ? GLOW : o.memMat ?? mat), shade: o.memShade, keep: o.keep ? (u, v) => o.keep(i + u, v) : null,
    });
  }
  // the inner part, root to elbow to wrist
  sheet(M, (u, v) => lerp3(lerp3(root, elbow, u), lerp3(add(root, [0, -span * 0.04, -span * 0.25]), wrist, u), v), 5, 3, { col: mem, mat: o.memMat ?? mat, shade: o.memShade });
  void edge;
}

// ── paint ────────────────────────────────────────────────────────────────────────────────────────────
// Patterns for a loft's col(t, a, p): each answers how much of a mark is at a point, 0..1, with a crisp edge, so a
// pattern is a shape in the comic manner and never a smudge.
/** Overlapping scales in rows down a body: 1 on a scale's dark rim. fu rows along it, fa round it. */
export function scaleEdge(t, a, fu = 40, fa = 14, w = 0.16) {
  const x = t * fu, row = Math.floor(x), y = (a / (Math.PI * 2)) * fa + (row % 2) * 0.5;
  const fx = x - row, fy = y - Math.floor(y) - 0.5;
  // a scale is a rounded point toward the tail: its edge is where fx meets the curve of fy
  const edge = fx - (1 - 4 * fy * fy) * 0.85;
  return Math.abs(edge) < w || fx < w * 0.6 ? 1 : 0;
}
/** Branching veins over a surface, from noise: 1 on a vein. */
export function veinAt(p, scale = 9, w = 0.035) {
  const n = fnoise(p, scale), m = fnoise(add(p, [3.1, 1.7, 5.3]), scale * 1.7);
  return Math.abs(n - 0.5) < w || Math.abs(m - 0.5) < w * 0.6 ? 1 : 0;
}
/** Spots on a grid jittered by the seed: 1 inside a spot. Photophores, mottling, rust blooms. */
export function spotAt(p, cell = 0.06, r = 0.3, seed = 1) {
  const q = [p[0] / cell, p[1] / cell, p[2] / cell], f = q.map(Math.floor);
  let best = 9;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
    const c = [f[0] + i, f[1] + j, f[2] + k], h = vnoise([c[0] * 1.37 + seed, c[1] * 2.11, c[2] * 1.73]);
    if (h < 0.55) continue;
    const o = [c[0] + 0.5 + (vnoise([c[0], c[1] + seed, c[2]]) - 0.5) * 0.6, c[1] + 0.5, c[2] + 0.5 + (vnoise([c[2], c[0], c[1] + seed]) - 0.5) * 0.6];
    best = Math.min(best, Math.hypot(q[0] - o[0], q[1] - o[1], q[2] - o[2]));
  }
  return best < r ? 1 : 0;
}
