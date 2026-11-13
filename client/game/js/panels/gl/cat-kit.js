// THE CAT KIT: a cat carved the way Scrappy's statue is (gl/cat-statue.js), but alive. ROOM's cats are built here.
//
// The statue is one signed distance field: ellipsoids and tapered limbs joined by smooth unions, the details cut in,
// meshed once by surface nets. A cat is the same field hung on a skeleton. Every piece of it belongs to a bone and is
// written where it sits on a cat standing square (the rest pose); a pose moves the bones, and the field is read
// through them, so a hip folded into a sit is carved folded, the haunch blending into the flank as the statue's does,
// with no skinning seams. That's the bake: one mesh per pose (stand, sit, loaf, curl, and the rest), each vertex
// carrying where it was on the rest cat (for the coat) and how much each bone owns it.
//
// What moves while a pose is held (breathing, the head turning, an ear swivelling, the tail, a blink) is the bake
// skinned to the bones as they move now (skinCat), which is cheap. The eyes, the lids over them and the whiskers are
// built every frame on the head, so a pupil can open and a lid can fall.
//
// Nothing here is any particular cat. A cat is a set of numbers (CAT, below): its build, its coat and its eyes. Scrappy
// is one set of them (tools/modelshop/cattery-recipes.js until the pets table carries it).
//
// Frames. The sculpt is written at the statue's size, about 1.65 times life; `scale` takes it to metres on the way
// out. Model space is the beast kit's: Y up, the cat facing +Z, its left on +X, the floor at y = 0. Angles: pitch > 0
// tips the nose down, yaw > 0 turns it to its left, roll > 0 drops its left side... (see euler, below).

import { MAT } from './ballpark-mesh.js';
import { furShells } from './beast-kit.js';

// ── numbers ─────────────────────────────────────────────────────────────────────────────────────────
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const mirror = (p, s) => [p[0] * s, p[1], p[2]];

// 3×3 matrices, row-major
const M3 = {
  I: () => [1, 0, 0, 0, 1, 0, 0, 0, 1],
  mul: (A, B) => [
    A[0] * B[0] + A[1] * B[3] + A[2] * B[6], A[0] * B[1] + A[1] * B[4] + A[2] * B[7], A[0] * B[2] + A[1] * B[5] + A[2] * B[8],
    A[3] * B[0] + A[4] * B[3] + A[5] * B[6], A[3] * B[1] + A[4] * B[4] + A[5] * B[7], A[3] * B[2] + A[4] * B[5] + A[5] * B[8],
    A[6] * B[0] + A[7] * B[3] + A[8] * B[6], A[6] * B[1] + A[7] * B[4] + A[8] * B[7], A[6] * B[2] + A[7] * B[5] + A[8] * B[8],
  ],
  v: (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]],
  T: (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]],
  // columns
  cols: (a, b, c) => [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]],
};
// [pitch, yaw, roll]: roll about z first, then pitch about x, then yaw about y. Pitch > 0 tips +Z (the nose) down;
// yaw > 0 swings +Z toward +X (to the cat's left); roll > 0 tips +Y (its back) toward −X (onto its left side... it
// lies on its right side when it rolls the other way)
function euler(e) {
  if (!e) return M3.I();
  const [p, y, r] = e;
  const cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y), cr = Math.cos(r), sr = Math.sin(r);
  const Rx = [1, 0, 0, 0, cp, -sp, 0, sp, cp];
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rz = [cr, -sr, 0, sr, cr, 0, 0, 0, 1];
  return M3.mul(Ry, M3.mul(Rx, Rz));
}
// an affine map rest → pose: x ↦ R x + t
const apply = (X, p) => add(M3.v(X.R, p), X.t);
// the frame (a, s, c) from a direction and a side, the side squared off against the direction
function frameOf(dir, side, alt = [0, 1, 0]) {
  const a = unit(dir);
  let s = sub(side, mul(a, dot(side, a)));
  if (len(s) < 1e-6) s = sub(alt, mul(a, dot(alt, a)));
  s = unit(s);
  return M3.cols(a, s, cross(a, s));
}
// the rigid map taking the rest segment (A0 along d0, side s0) to the posed one (A1 along d1, side s1)
function aimXf(A0, d0, s0, A1, d1, s1) {
  const R = M3.mul(frameOf(d1, s1), M3.T(frameOf(d0, s0)));
  return { R, t: sub(A1, M3.v(R, A0)) };
}
// a child turned by its own euler about its joint j, then carried by the parent
function childXf(P, j, e) {
  const Rb = euler(e), R = M3.mul(P.R, Rb);
  return { R, t: add(M3.v(P.R, sub(j, M3.v(Rb, j))), P.t) };
}

// ── noise ───────────────────────────────────────────────────────────────────────────────────────────
const hash = (i, j, k) => { let h = (i * 374761393 + j * 668265263 + k * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 2147483648 - 1; };
function noise(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  let u = x - i, v = y - j, w = z - k;
  u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v); w = w * w * (3 - 2 * w);
  const a0 = hash(i, j, k), a1 = hash(i + 1, j, k), a2 = hash(i, j + 1, k), a3 = hash(i + 1, j + 1, k);
  const b0 = hash(i, j, k + 1), b1 = hash(i + 1, j, k + 1), b2 = hash(i, j + 1, k + 1), b3 = hash(i + 1, j + 1, k + 1);
  const c0 = a0 + (a1 - a0) * u, c1 = a2 + (a3 - a2) * u, d0 = b0 + (b1 - b0) * u, d1 = b2 + (b3 - b2) * u;
  const e0 = c0 + (c1 - c0) * v, e1 = d0 + (d1 - d0) * v;
  return e0 + (e1 - e0) * w;
}
const fbm = (x, y, z, o = 3) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * noise(x * f, y * f, z * f); a *= 0.5; f *= 2.1; } return s; };
// a stable pseudo-random number in [0, 1) from two integers, for the idle clock
const rnd = (a, b = 0) => (hash(a | 0, b | 0, 91) + 1) / 2;

// ── the field's pieces (Inigo Quilez's distance estimates, as the statue's) ─────────────────────────────
function mkEllip(c, r, rot) {
  const [cx, cy, cz] = c, jx = 1 / (r[0] * r[0]), jy = 1 / (r[1] * r[1]), jz = 1 / (r[2] * r[2]), lo = -Math.min(r[0], r[1], r[2]);
  const R = rot ? M3.T(euler(rot)) : null;
  return (x, y, z) => {
    let qx = x - cx, qy = y - cy, qz = z - cz;
    if (R) { const a = R[0] * qx + R[1] * qy + R[2] * qz, b = R[3] * qx + R[4] * qy + R[5] * qz, d = R[6] * qx + R[7] * qy + R[8] * qz; qx = a; qy = b; qz = d; }
    const k0 = Math.sqrt(qx * qx * jx + qy * qy * jy + qz * qz * jz), k1 = Math.sqrt(qx * qx * jx * jx + qy * qy * jy * jy + qz * qz * jz * jz);
    return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : lo;
  };
}
function mkCone(a, b, r1, r2) {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2], l2 = bx * bx + by * by + bz * bz, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2, sr = Math.sign(rr) * rr * rr;
  return (x, y, z) => {
    const px = x - a[0], py = y - a[1], pz = z - a[2], yy = px * bx + py * by + pz * bz, zz = yy - l2;
    const vx = px * l2 - bx * yy, vy = py * l2 - by * yy, vz = pz * l2 - bz * yy, x2 = vx * vx + vy * vy + vz * vz, y2 = yy * yy * l2, z2 = zz * zz * l2, k = sr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
  };
}
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);

// a paw, toes forward along +Z from c: the palm, four toes, the grooves between them cut in (the statue's)
function mkPaw(c, L, w = 1) {
  const palm = mkEllip(c, [0.027 * w, 0.018, L]);
  const toes = [-1.5, -0.5, 0.5, 1.5].map((t) => mkEllip([c[0] + t * 0.0088 * w, c[1] - 0.002, c[2] + L * 0.75 - Math.abs(t) * 0.005], [0.0078 * w, 0.011, 0.0095]));
  const cuts = [-1, 0, 1].map((t) => mkCone([c[0] + t * 0.0088 * w, c[1] + 0.016, c[2] + L * 0.45], [c[0] + t * 0.0088 * w, c[1] - 0.004, c[2] + L * 1.05], 0.0013, 0.0013));
  return (x, y, z) => {
    let d = palm(x, y, z);
    for (const t of toes) d = smin(d, t(x, y, z), 0.003);
    for (const k of cuts) d = smax(d, -k(x, y, z), 0.0015);
    return d;
  };
}

// ── a cat as numbers ────────────────────────────────────────────────────────────────────────────────
// `build` stretches the sculpt (1 is an ordinary domestic shorthair at the statue's proportions); `coat` paints it;
// `eyes` and `fur` are what they say. `coat.white` is how far white spotting has spread, from none (0) through a
// locket and mittens (0.2), a tuxedo (0.45), a bicolour (0.65) to a van (0.9); `marks` are patches laid over it,
// each an ellipsoid where it sits on the rest cat ('body') or on the head ('head', in the head's own frame).
export const CAT = {
  scale: 0.6,
  build: { length: 0.86, neckLen: 1, belly: 1, pouch: 1, chest: 1, hips: 1, neck: 1, legLen: 1, legW: 1, head: 1, cheeks: 1, ears: 1, muzzle: 1, tailLen: 1, tailW: 1 },
  coat: {
    base: '#4a4642', white: 0, whiteCol: '#ece7dc', seed: 1, tabby: null, marks: [],
    nose: '#c98a8e', pads: '#c48890', earInner: '#d8a4a2', lid: '#151314', mouth: '#2a1a1c', whisker: '#f2eee6',
  },
  // size scales the eye and its socket; open is how round the opening is (1 the statue's almond, more for a wide,
  // alert eye); sunk sets the ball back in the socket; droop is how far the upper lid rests down over it
  eyes: { iris: '#c8a838', rim: '#6e5a1e', pupil: 0.35, size: 1, open: 1, sunk: 0.6, droop: 0.12 },
  // fur lengths in metres: the shell coat (gl/beast-kit.js furShells), longest on the ruff and the tail
  fur: { body: 0.006, ruff: 0.012, belly: 0.01, tail: 0.01, legs: 0.004, face: 0.002, budget: 60000 },
};
export function catLook(o = {}) {
  return {
    ...CAT, ...o,
    build: { ...CAT.build, ...(o.build || {}) }, coat: { ...CAT.coat, ...(o.coat || {}) },
    eyes: { ...CAT.eyes, ...(o.eyes || {}) }, fur: { ...CAT.fur, ...(o.fur || {}) },
  };
}

// ── the head, in its own frame (the statue's, at full size; the rig sets it on at HS of it) ─────────────────
const EYE_ROLL = 0.2, EYE_YAW = 0.3;
// The eye's own frame and shape for a cat's eyes: where each sits on the head, its turn, the lid ring round the
// opening, the socket cut behind it. Everything the head carves and headBits draws reads it, so a bigger eye is one
// number.
function eyeKit(e = {}) {
  const es = e.size ?? 1, op = e.open ?? 1;
  const rx = 0.0215 * es, ryT = 0.0128 * es * op, ryB = 0.0145 * es * Math.sqrt(op);
  const eyeC = (s) => [s * (0.044 + 0.004 * (es - 1)), 0.004 + 0.003 * (es - 1), 0.064 + 0.01 * (es - 1)];
  // turned out a little, and tilted so the outer corner sits higher than the inner: a cat's eye slants up and out
  const eyeM = (s) => M3.T(euler([0, s * EYE_YAW, s * EYE_ROLL]));
  const fromEye = (q, s) => add(eyeC(s), M3.v(M3.T(eyeM(s)), q));
  // the lid: a soft ridge round the opening, the upper a little heavier; thinner than the statue's, which was stone
  const lidD = (ex, ey, ez) => {
    const top = ey > 0, ry = top ? ryT : ryB, ring = Math.hypot(ex / rx, ey / ry);
    const th = (top ? 0.0019 + 0.0007 * smooth(0.6, 0, Math.abs(ex) / rx) : 0.0013) * es;
    return Math.hypot((ring - 1) * ry, ez - 0.0006 * es) - th;
  };
  const SOCKET = mkEllip([0, 0, 0.006 * es], [rx * 1.1, Math.max(ryT, ryB) * 1.12, 0.011 * es]);
  return { es, op, rx, ryT, ryB, eyeC, eyeM, fromEye, lidD, SOCKET, sunk: e.sunk ?? 1 };
}
function makeHead(b, EK) {
  const mz = b.muzzle, ck = b.cheeks, { eyeC, eyeM, lidD, SOCKET } = EK;
  const CRANIUM = mkEllip([0, 0.004, -0.012], [0.088, 0.064, 0.083]), CHEEKS = mkEllip([0, -0.006, 0.0], [0.1 * ck, 0.05, 0.072]);
  const RUFFS = [-1, 1].map((s) => mkEllip([s * 0.07 * ck, -0.03, -0.018], [0.03, 0.036, 0.042]));
  const BRIDGE = mkEllip([0, -0.004, 0.05 * mz], [0.026, 0.03, 0.023], [-0.6, 0, 0]), MUZZLE = mkEllip([0, -0.036, 0.058 * mz], [0.04, 0.029, 0.032]);
  const PADS = [-1, 1].map((s) => mkEllip([s * 0.0195, -0.041, 0.074 * mz], [0.024, 0.0195, 0.021]));
  const CHIN = mkEllip([0, -0.061, 0.054 * mz], [0.016, 0.011, 0.015]), NOSE = mkEllip([0, -0.018, 0.085 * mz], [0.0135, 0.0085, 0.009], [-0.35, 0, 0]);
  const NOSTRILS = [-1, 1].map((s) => mkEllip([s * 0.0072, -0.0205, 0.0905 * mz], [0.0028, 0.0018, 0.004], [0, 0, s * 0.6]));
  const CLEFT = mkCone([0, -0.025, 0.091 * mz], [0, -0.039, 0.089 * mz], 0.0013, 0.0013);
  const MOUTH = [-1, 1].map((s) => mkCone([0, -0.04, 0.088 * mz], [s * 0.032, -0.053, 0.066 * mz], 0.0013, 0.001));
  const EM = [-1, 1].map((s) => ({ s, c: eyeC(s), m: eyeM(s) }));
  const BROWS = [-1, 1].map((s) => { const c = eyeC(s); return mkEllip([c[0] * 0.95, c[1] + 0.021 * EK.es, c[2] - 0.01], [0.026 * EK.es, 0.0065, 0.017], [0.15, 0, 0]); });
  const field = (x, y, z) => {
    let d = CRANIUM(x, y, z);
    for (const b2 of BROWS) d = smin(d, b2(x, y, z), 0.026);
    d = smin(d, CHEEKS(x, y, z), 0.045);
    for (const r of RUFFS) d = smin(d, r(x, y, z), 0.035);
    d = smin(d, BRIDGE(x, y, z), 0.032);
    d = smin(d, MUZZLE(x, y, z), 0.015);
    for (const p of PADS) d = smin(d, p(x, y, z), 0.012);
    d = smin(d, CHIN(x, y, z), 0.01);
    d = smin(d, NOSE(x, y, z), 0.004);
    for (const { c, m } of EM) {
      const dx = x - c[0], dy = y - c[1], dz = z - c[2];
      if (dx * dx + dy * dy + dz * dz > 0.0025) continue;
      const ex = m[0] * dx + m[1] * dy + m[2] * dz, ey = m[3] * dx + m[4] * dy + m[5] * dz, ez = m[6] * dx + m[7] * dy + m[8] * dz;
      d = smax(d, -SOCKET(ex, ey, ez), 0.003);
      d = smin(d, lidD(ex, ey, ez), 0.0025);
    }
    if (x * x + (y + 0.04) ** 2 + (z - 0.075 * mz) ** 2 < 0.0025) {
      for (const n of NOSTRILS) d = smax(d, -n(x, y, z), 0.0015);
      d = smax(d, -CLEFT(x, y, z), 0.0015);
      for (const mo of MOUTH) d = smax(d, -mo(x, y, z), 0.0015);
    }
    return d;
  };
  // what a point on the head is, before the coat: the nose leather, a lid's rim, the mouth line
  const part = (x, y, z) => {
    for (const n of NOSTRILS) if (n(x, y, z) < 0.0012) return 'nostril';
    if (z > 0.07 * mz && NOSE(x, y, z) < 0.0022 && y > -0.0275 && y < -0.009) {
      // the leather: flat across the top, coming to a point over the cleft
      const w = 0.0135 * clamp((y + 0.0275) / 0.0165);
      if (Math.abs(x) < w + 0.0006) return Math.abs(x) > w - 0.0008 ? 'noseEdge' : 'nose';
    }
    if (y < -0.0272 && CLEFT(x, y, z) < 0.0013) return 'mouth';
    for (const mo of MOUTH) if (mo(x, y, z) < 0.0016) return 'mouth';
    // the whisker roots: four rows of dots across each pad, a little darker than the fur round them
    if (z > 0.07 * mz && y < -0.03 && y > -0.054) for (const sd of [-1, 1]) for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const dx = x - sd * (0.012 + i * 0.0062 + j * 0.0012), dy = y - (-0.0335 - j * 0.0048 - i * 0.0006);
      if (dx * dx + dy * dy < 0.0011 * 0.0011) return 'dot';
    }
    for (const { c, m } of EM) {
      const dx = x - c[0], dy = y - c[1], dz = z - c[2];
      if (dx * dx + dy * dy + dz * dz > 0.0025) continue;
      const ex = m[0] * dx + m[1] * dy + m[2] * dz, ey = m[3] * dx + m[4] * dy + m[5] * dz, ez = m[6] * dx + m[7] * dy + m[8] * dz;
      if (lidD(ex, ey, ez) < (ey > 0 ? 0.0017 : 0.0011) * EK.es) return 'lid';
      // the inner corner: a short dark line running down toward the nose
      const s0 = Math.sign(c[0]), ix = -s0 * ex - EK.rx * 0.9;
      if (ix > 0 && ix < 0.0075 * EK.es && Math.abs(ey + 0.0035 * EK.es + ix * 0.55) < 0.0011 * EK.es * (1 - ix / (0.0085 * EK.es))) return 'lid';
    }
    return null;
  };
  return { field, part };
}
// an ear in the head's frame: a cupped shell, edges curling forward round a hollow, thinning to the tip, tufts
// chiselled on its inner face (the statue's earD)
function makeEar(s, k) {
  // A cat's ear (the pinna) is a cone of cartilage opened at the front: broad at the root, set on the top corner of the
  // skull, turned a little out. Its inner (medial) edge runs nearly straight to a rounded tip; the outer edge bows out
  // a little, then comes in at the root, where Henry's pocket folds into it. The cup is deepest at the root, where the
  // canal turns down into the head, and the edges are rolled. u runs across the ear (+ toward +X on both ears, so the
  // outer edge is where u·s > 0), v up it, w out of its front.
  const B = [s * 0.056, 0.042, -0.016], T = [s * (0.057 + 0.056 * k), 0.042 + 0.106 * k, -0.016 - 0.012 * k], a = unit(sub(T, B));
  const f0 = unit([s * 0.42, 0.05, 1]), f = unit(sub(f0, mul(a, dot(f0, a)))), e = cross(a, f), L = len(sub(T, B)), W = 0.054 * (0.6 + 0.4 * k);
  const local = (x, y, z) => { const rx = x - B[0], ry = y - B[1], rz = z - B[2]; return [rx * e[0] + ry * e[1] + rz * e[2], rx * a[0] + ry * a[1] + rz * a[2], rx * f[0] + ry * f[1] + rz * f[2]]; };
  const toHead = (u, v, w) => add(add(add(B, mul(e, u)), mul(a, v)), mul(f, w));
  const halfAt = (t, outer) => (outer
    ? W * Math.pow(1 - t, 0.78) * (1 + 0.1 * Math.sin(Math.PI * t)) * (1 - 0.1 * smooth(0.22, 0, t))
    : W * Math.pow(1 - t, 0.95)) + 0.0018;
  const cupAt = (u, t) => 13 * u * u - 0.004 - 0.007 * (1 - t) * (1 - t) + 0.0028 * Math.exp(-(((t - 0.17) / 0.045) ** 2)) * Math.exp(-(((u + s * 0.004) / 0.016) ** 2));
  const pocketC = (t) => [s * (halfAt(t, true) - 0.0015), t * L];
  const field = (x, y, z) => {
    const [u, v, w] = local(x, y, z);
    if (v < -0.03 || v > L + 0.02 || Math.abs(u) > 0.075 || Math.abs(w) > 0.05) return 0.02;
    const t = clamp(v / L), outer = u * s > 0, half = halfAt(t, outer), cup = cupAt(u, t);
    // thick at the root, thin at the tip; the rim rolled and curled a little forward
    const rim = smooth(half - 0.007, half, Math.abs(u));
    const thick = 0.006 * (1 - 0.62 * t) + 0.0011 + 0.0013 * rim;
    let d = Math.abs(w - cup - 0.0014 * rim) - thick;
    d = smax(d, Math.abs(u) - half, 0.004);
    d = smax(d, v - L, 0.009);
    d = smax(d, -v - 0.025, 0.006);
    // the canal opening, down at the root of the cup and toward the face
    const cu = u + s * 0.006, cv = v - 0.012, cw = w - cupAt(u, t) - 0.006;
    d = smax(d, -(Math.hypot(cu / 0.011, cv / 0.016, cw / 0.009) - 1) * 0.009, 0.004);
    // Henry's pocket: a small slit in the outer edge, low down
    const [pu, pv] = pocketC(0.17), pd = Math.hypot((u - pu) / 0.0042, (v - pv) / 0.0075, (w - cup) / 0.006) - 1;
    d = smax(d, -pd * 0.004, 0.0015);
    return d;
  };
  // the skin inside: the front of the cup, inside a fur-lined rim
  const inner = (x, y, z) => {
    const [u, v, w] = local(x, y, z), t = clamp(v / L), half = halfAt(t, u * s > 0);
    return v > 0.002 && t < 0.96 && w > cupAt(u, t) - 0.0008 && Math.abs(u) < half - 0.0026;
  };
  // where a point is on the ear: how far up, how close to the canal, how close to the rim
  const at = (x, y, z) => {
    const [u, v] = local(x, y, z), t = clamp(v / L), half = halfAt(t, u * s > 0);
    return { t, canal: smooth(0.03, 0.0, Math.hypot(u + s * 0.006, v - 0.012)), rim: smooth(half - 0.0065, half - 0.0026, Math.abs(u)), fold: Math.exp(-(((t - 0.17) / 0.04) ** 2)) };
  };
  const pocket = (x, y, z) => {
    const [u, v, w] = local(x, y, z), [pu, pv] = pocketC(0.17);
    return Math.hypot((u - pu) / 0.0055, (v - pv) / 0.01) < 1 && w > cupAt(u, clamp(v / L)) - 0.006;
  };
  // the furnishings: long pale hairs from the root of the cup by the canal, fanning up and out of the ear, as lines
  // of points in the head's frame
  const tufts = () => {
    const out = [];
    for (let i = 0; i < 22; i++) {
      const t = 0.03 + (i % 5) * 0.055 + Math.floor(i / 5) * 0.012, half = halfAt(t, false);
      const u = -s * half * (0.05 + 0.75 * ((i * 0.37) % 1)), v = t * L, w = cupAt(u, t) + 0.0012;
      const up = 0.95 - (i % 3) * 0.14, fwd = 0.35 + (i % 2) * 0.25, side = s * (0.1 + 0.12 * (i % 4));
      const l = 0.034 + 0.022 * ((i * 0.61) % 1);
      const p0 = [u, v, w], p1 = [u + side * l * 0.45, v + up * l * 0.5, w + fwd * l * 0.4], p2 = [u + side * l * 1.0, v + up * l * 0.9, w + fwd * l * 0.75 + 0.004];
      out.push([p0, p1, p2].map((q) => toHead(q[0], q[1], q[2])));
    }
    return out;
  };
  return { B, field, inner, L, at, pocket, tufts };
}

// ── the rig ─────────────────────────────────────────────────────────────────────────────────────────
// Bones are named; each piece of the field belongs to one. Rest frames are all the world's axes, so a piece is
// written where it sits on the rest cat, and the bone's own map moves it.
export const TAIL_N = 12;
const LEGS = ['LF', 'RF', 'LH', 'RH'];
export function catRig(look0) {
  const look = look0?.build ? look0 : catLook(look0);
  const b = look.build, ll = b.legLen, lw = b.legW;
  // the body's height over the floor follows the legs
  const lift = 0.36 * (ll - 1);
  const Y = (y) => y + lift;
  const bones = [], index = {};
  const bone = (name, parent, j, group, o = {}) => { index[name] = bones.length; bones.push({ name, parent, j, group, prims: [], ...o }); return bones[bones.length - 1]; };
  const pelvis = bone('pelvis', null, [0, Y(0.43), -0.2], 'body');
  const lumbar = bone('lumbar', 'pelvis', [0, Y(0.445), -0.1], 'body');
  const chest = bone('chest', 'lumbar', [0, Y(0.44), 0.06], 'body');
  const neck = bone('neck', 'chest', [0, Y(0.45), 0.22], 'neck');
  // `neckLen` draws the head in toward the shoulders (a fat cat's head sits low in its ruff) or out
  const nl = b.neckLen ?? 1, NK = (p) => [p[0], Y(0.45) + (p[1] - Y(0.45)) * nl, 0.22 + (p[2] - 0.22) * nl];
  const HS = 0.84 * b.head, HC = NK([0, Y(0.585), 0.4]);
  const head = bone('head', 'neck', NK([0, Y(0.55), 0.33]), 'head');
  const ears = [1, -1].map((s) => { const E = makeEar(s, b.ears); return { s, E, bone: bone(s > 0 ? 'earL' : 'earR', 'head', add(HC, mul(E.B, HS)), 'ear') }; });
  // the tail hangs back from the root, a little down
  const TB = [0, Y(0.425), -0.33 * (b.length ?? 1)], TD = unit([0, -0.25, -1]), TL = 0.5 * b.tailLen / TAIL_N;
  const tail = [];
  for (let i = 0; i < TAIL_N; i++) tail.push(bone('tail' + i, i ? 'tail' + (i - 1) : 'pelvis', madd(TB, TD, TL * i), 'tail', { k: i }));
  // the legs: shoulder (or hip), elbow (stifle), wrist (hock), paw. Left on +X
  const legs = {};
  for (const key of LEGS) {
    const s = key[0] === 'L' ? 1 : -1, front = key[1] === 'F';
    const J = front
      ? { A: [0.062, Y(0.37), 0.17], B: [0.058, 0.235 * ll, 0.12], C: [0.056, 0.075 * ll, 0.155], D: [0.056, 0.024, 0.175] }
      : { A: [0.075, Y(0.4), -0.22], B: [0.082, 0.25 * ll, -0.13], C: [0.075, 0.12 * ll, -0.3], D: [0.07, 0.024, -0.235] };
    for (const k of 'ABCD') J[k] = mirror(J[k], s);
    const g = 'leg';
    legs[key] = {
      key, s, front, J,
      upper: bone(key + 'up', front ? 'chest' : 'pelvis', J.A, g, { s }), lower: bone(key + 'lo', key + 'up', J.B, g, { s }),
      meta: bone(key + 'me', key + 'lo', J.C, g, { s }), paw: bone(key + 'pw', key + 'me', J.D, 'paw', { s }),
      l1: len(sub(J.B, J.A)), l2: len(sub(J.C, J.B)), l3: len(sub(J.D, J.C)),
    };
  }
  const P = (bn, f, k, o = {}) => bn.prims.push({ f, k, ...o });
  // the body: hips, loin, belly and its pouch, the ribs, the brisket, the blades
  P(pelvis, mkEllip([0, Y(0.415), -0.23], [0.1 * b.hips, 0.1, 0.11]), 0.05);
  P(lumbar, mkEllip([0, Y(0.41), -0.09], [0.095 * b.hips, 0.095, 0.15]), 0.05);
  P(lumbar, mkEllip([0, Y(0.35 - 0.012 * (b.belly - 1)), -0.08], [0.1 * b.belly, 0.085 * b.belly, 0.15]), 0.05);
  P(lumbar, mkEllip([0, Y(0.3 - 0.02 * (b.pouch - 1)), -0.15], [0.07 * b.pouch, 0.05 * b.pouch, 0.1]), 0.04);
  P(chest, mkEllip([0, Y(0.395), 0.08], [0.105 * b.chest, 0.125, 0.15]), 0.05);
  P(chest, mkEllip([0, Y(0.36), 0.2], [0.075 * b.chest, 0.095, 0.075]), 0.04);
  for (const s of [1, -1]) P(chest, mkEllip([s * 0.058, Y(0.45), 0.15], [0.03, 0.06, 0.055], [-0.5, 0, 0]), 0.03);
  // the neck, and the ruff under the throat
  P(neck, mkCone([0, Y(0.44), 0.2], NK([0, Y(0.56), 0.34]), 0.074 * b.neck, 0.06 * b.neck), 0.045);
  P(neck, mkEllip(NK([0, Y(0.47), 0.3]), [0.068 * b.neck, 0.07, 0.06]), 0.04);
  // the head, set on at HS
  const EK = eyeKit(look.eyes);
  const H = makeHead(b, EK);
  head.HC = HC; head.HS = HS;
  P(head, (x, y, z) => H.field((x - HC[0]) / HS, (y - HC[1]) / HS, (z - HC[2]) / HS) * HS, 0.028, { r: 0.13 * HS, c: HC });
  for (const { E, bone: eb } of ears) P(eb, (x, y, z) => E.field((x - HC[0]) / HS, (y - HC[1]) / HS, (z - HC[2]) / HS) * HS, 0.012, { r: E.L * HS + 0.03, c: add(HC, mul(E.B, HS)) });
  // the tail, a tapered cone a bone
  const TR = (i) => (0.027 - 0.016 * Math.pow(i / TAIL_N, 1.2)) * b.tailW;
  for (let i = 0; i < TAIL_N; i++) P(tail[i], mkCone(tail[i].j, madd(tail[i].j, TD, TL), TR(i), TR(i + 1)), i ? 0.008 : 0.03);
  // the legs
  for (const key of LEGS) {
    const L = legs[key], { A, B, C, D } = L.J, s = L.s;
    if (L.front) {
      P(L.upper, mkCone(A, B, 0.045 * lw, 0.034 * lw), 0.035);
      P(L.upper, mkEllip(add(lerp3(A, B, 0.45), [s * 0.006, 0, -0.025]), [0.034 * lw, 0.065, 0.04], [-0.35, 0, 0]), 0.025);
      P(L.lower, mkCone(B, C, 0.03 * lw, 0.02 * lw), 0.016);
      P(L.lower, mkEllip(add(lerp3(B, C, 0.22), [0, 0, 0.008]), [0.028 * lw, 0.05, 0.03]), 0.016);
      P(L.meta, mkCone(C, D, 0.021 * lw, 0.019 * lw), 0.012);
      P(L.paw, mkPaw([D[0], 0.019, D[2] - 0.004], 0.033, lw), 0.01);
    } else {
      P(L.upper, mkCone(A, B, 0.05 * lw, 0.036 * lw), 0.035);
      // the round haunch: the big muscle of the thigh
      P(L.upper, mkEllip(add(lerp3(A, B, 0.45), [s * 0.012, 0, -0.012]), [0.064 * lw * b.hips, 0.112, 0.098], [-0.55, 0, 0]), 0.035);
      P(L.lower, mkCone(B, C, 0.036 * lw, 0.022 * lw), 0.016);
      P(L.lower, mkEllip(add(lerp3(B, C, 0.3), [0, 0.01, -0.014]), [0.03 * lw, 0.05, 0.04], [0.9, 0, 0]), 0.016);
      P(L.meta, mkCone(C, D, 0.021 * lw, 0.019 * lw), 0.012);
      // the point of the hock
      P(L.meta, mkEllip(madd(C, [0, 0, -1], 0.008), [0.014 * lw, 0.016, 0.014]), 0.008);
      P(L.paw, mkPaw([D[0], 0.018, D[2] - 0.006], 0.03, lw), 0.008);
    }
  }
  // `length` draws the body in or out nose to tail: every piece but the head, the ears and the tail is read through
  // z / length (its distance scaled down by as much, so it never claims more than it is), and the joints moved to
  // match. The head and the ears keep their shape and ride on HC; the tail keeps its length and moves with its base.
  const bl = b.length ?? 1;
  if (bl !== 1) {
    const k = Math.min(1, bl);
    for (const bn of bones) {
      if (bn.group === 'head' || bn.group === 'ear' || bn.group === 'tail') continue;
      for (const p of bn.prims) { const f = p.f; p.f = (x, y, z) => f(x, y, z / bl) * k; }
    }
    const zs = (p) => { p[2] *= bl; };
    // (a leg's joints are its bones' own; the tail was laid from a base already moved)
    for (const bn of bones) if (bn.group !== 'ear' && bn.group !== 'tail') zs(bn.j);
    zs(HC);
    for (const { E, bone: eb } of ears) { const j = add(HC, mul(E.B, HS)); eb.j[0] = j[0]; eb.j[1] = j[1]; eb.j[2] = j[2]; }
    for (const key of LEGS) {
      const L = legs[key];
      L.l1 = len(sub(L.J.B, L.J.A)); L.l2 = len(sub(L.J.C, L.J.B)); L.l3 = len(sub(L.J.D, L.J.C));
    }
  }
  // each bone's bounding sphere on the rest cat, for skipping it when it's far from a point
  for (const bn of bones) {
    let c = bn.prims.find((p) => p.c)?.c;
    let r = bn.prims.find((p) => p.r)?.r;
    if (!c) c = bn.j;
    if (!r) r = 0.12;
    bn.c = c; bn.r = r;
  }
  // tighter spheres for the legs and the tail from their segments
  for (const key of LEGS) {
    const L = legs[key], { A, B, C, D } = L.J;
    L.upper.c = lerp3(A, B, 0.5); L.upper.r = len(sub(B, A)) / 2 + 0.12;
    L.lower.c = lerp3(B, C, 0.5); L.lower.r = len(sub(C, B)) / 2 + 0.06;
    L.meta.c = lerp3(C, D, 0.5); L.meta.r = len(sub(D, C)) / 2 + 0.05;
    L.paw.c = [D[0], 0.02, D[2] + 0.01]; L.paw.r = 0.06;
  }
  for (const t of tail) { t.c = madd(t.j, TD, TL / 2); t.r = TL / 2 + 0.05; }
  pelvis.r = 0.2; lumbar.r = 0.24; chest.r = 0.24; neck.r = 0.16;
  return { look, bones, index, legs, ears, tail, head, HC, HS, H, EK, TB, TD, TL, lift, Y };
}

// ── poses ───────────────────────────────────────────────────────────────────────────────────────────
// A pose says where the pelvis is and how it's turned, how each joint of the spine bends, where each paw is planted
// (and which way its toes point, and its sole's up), and the tail as a line of points the tail is laid along. Paws
// and the tail are in the cat's own ground frame: the floor at y = 0, facing +Z. Written as functions of the rig, so
// a long-legged cat sits as high as its legs make it.
const P_FWD = [0, 0, 1], P_UP = [0, 1, 0];
export const CAT_POSES = {
  stand: (R) => ({
    root: { at: R.bones[R.index.pelvis].j, rot: [0, 0, 0] },
    spine: { lumbar: [0.02, 0, 0], chest: [0.02, 0, 0], neck: [0.05, 0, 0], head: [0.12, 0, 0] },
    legs: Object.fromEntries(LEGS.map((k) => [k, { paw: R.legs[k].J.D, fwd: P_FWD, up: P_UP }])),
    tail: [[0, R.Y(0.33), -0.46], [0, R.Y(0.18), -0.55], [0, R.Y(0.14), -0.68], [0, R.Y(0.22), -0.78]],
  }),
  // upright on the haunches, the forepaws together, the tail round the front of them: the statue's sit
  sit: (R) => ({
    root: { at: [0, 0.11, -0.18], rot: [-0.6, 0, 0] },
    spine: { lumbar: [-0.2, 0, 0], chest: [-0.15, 0, 0], neck: [0.55, 0, 0], head: [0.5, 0, 0] },
    legs: {
      LF: { paw: [0.048, 0.024, 0.13], fwd: P_FWD, up: P_UP, pole: [0, 0, -1] },
      RF: { paw: [-0.048, 0.024, 0.13], fwd: P_FWD, up: P_UP, pole: [0, 0, -1] },
      LH: { paw: [0.105, 0.024, 0.075], fwd: unit([0.15, 0, 1]), up: P_UP, meta: unit([0.05, -0.02, 1]), pole: [0.4, 0.6, 1] },
      RH: { paw: [-0.105, 0.024, 0.075], fwd: unit([-0.15, 0, 1]), up: P_UP, meta: unit([-0.05, -0.02, 1]), pole: [-0.4, 0.6, 1] },
    },
    tail: [[0.0, 0.05, -0.32], [-0.12, 0.03, -0.24], [-0.18, 0.025, -0.06], [-0.13, 0.022, 0.1], [-0.02, 0.022, 0.2], [0.07, 0.022, 0.2]],
  }),
  // the loaf: chest and belly down, the forepaws folded out of sight under the chest, the hind legs folded under
  loaf: (R) => ({
    root: { at: [0, 0.19, -0.19], rot: [0.04, 0, 0] },
    spine: { lumbar: [0.0, 0, 0], chest: [0.06, 0, 0], neck: [-0.35, 0, 0], head: [0.32, 0, 0] },
    legs: {
      LF: { paw: [0.05, 0.03, 0.13], fwd: [0, 0, -1], up: [0, 1, 0], meta: unit([0, -0.2, -1]), pole: [0.2, 0.3, -1] },
      RF: { paw: [-0.05, 0.03, 0.13], fwd: [0, 0, -1], up: [0, 1, 0], meta: unit([0, -0.2, -1]), pole: [-0.2, 0.3, -1] },
      LH: { paw: [0.1, 0.024, -0.1], fwd: unit([0.1, 0, 1]), up: P_UP, meta: unit([0.04, -0.02, 1]), pole: [0.3, 0.4, 1] },
      RH: { paw: [-0.1, 0.024, -0.1], fwd: unit([-0.1, 0, 1]), up: P_UP, meta: unit([-0.04, -0.02, 1]), pole: [-0.3, 0.4, 1] },
    },
    tail: [[0, 0.08, -0.4], [0.08, 0.035, -0.46], [0.16, 0.025, -0.38], [0.2, 0.025, -0.22], [0.2, 0.025, -0.05]],
  }),
  // asleep in a ring: down on the belly and tipped a little onto the right hip, the spine bent round to the left
  // until the nose is at the hip, the legs tucked under, the tail round the front of the face
  curl: (R) => ({
    root: { at: [0, 0.165, -0.06], rot: [0.05, 0, 0.3] },
    spine: { lumbar: [0.08, 0.95, 0.1], chest: [0.1, 1.0, 0.1], neck: [1.1, 0.75, 0.05], head: [0.5, 0.5, -0.35] },
    legs: {
      LF: { rel: true, paw: [0.05, R.Y(0.27), 0.22], fwd: unit([0, -0.3, 1]), up: P_UP, meta: unit([0, -0.25, -1]), pole: [0, 0.3, -1] },
      RF: { rel: true, paw: [-0.05, R.Y(0.27), 0.22], fwd: unit([0, -0.3, 1]), up: P_UP, meta: unit([0, -0.25, -1]), pole: [0, 0.3, -1] },
      LH: { rel: true, paw: [0.08, R.Y(0.27), 0.02], fwd: unit([0.2, 0, 1]), up: P_UP, meta: unit([0.05, 0, 1]), pole: [0.4, 0.5, 1] },
      RH: { rel: true, paw: [-0.12, R.Y(0.31), 0.0], fwd: unit([-0.2, 0, 1]), up: P_UP, meta: unit([-0.05, 0, 1]), pole: [-0.5, 0.4, 1] },
    },
    tail: [[0.04, 0.1, -0.37], [0.15, 0.035, -0.42], [0.27, 0.035, -0.38], [0.36, 0.04, -0.26], [0.37, 0.04, -0.12], [0.32, 0.04, -0.02]],
  }),
};

// motion laid over a held pose: [pitch, yaw, roll] added at the head; each ear's swivel (yaw out, + is back toward
// flat), lift (pitch) and flatten; the tail's sway and the tip's flick; breath; the lids (0 open, 1 shut); the pupil
export const STILL = { head: [0, 0, 0], ears: [[0, 0, 0], [0, 0, 0]], tailSway: 0, tailFlick: 0, tailLift: 0, breath: 0, lids: 0, pupil: null, whiskers: 0 };

// every bone's map rest → pose for the pose and the motion over it
export function solveRig(R, poseFn, mo = STILL) {
  const pose = typeof poseFn === 'function' ? poseFn(R) : poseFn;
  const X = new Array(R.bones.length), B = R.bones, ix = R.index;
  const pel = B[ix.pelvis];
  const Rr = euler(pose.root.rot);
  X[ix.pelvis] = { R: Rr, t: sub(pose.root.at, M3.v(Rr, pel.j)) };
  const sp = pose.spine || {};
  X[ix.lumbar] = childXf(X[ix.pelvis], B[ix.lumbar].j, sp.lumbar);
  X[ix.chest] = childXf(X[ix.lumbar], B[ix.chest].j, sp.chest);
  X[ix.neck] = childXf(X[ix.chest], B[ix.neck].j, sp.neck);
  const h = sp.head || [0, 0, 0], hm = mo.head || [0, 0, 0];
  X[ix.head] = childXf(X[ix.neck], B[ix.head].j, [h[0] + hm[0], h[1] + hm[1], h[2] + hm[2]]);
  R.ears.forEach((e, i) => {
    const em = (mo.ears || [])[i] || [0, 0, 0], pe = (pose.ears || [])[i] || [0, 0, 0];
    // an ear turns out about its base: yaw swivels it back, roll flattens it sideways
    X[e.bone.index ?? ix[e.bone.name]] = childXf(X[ix.head], e.bone.j, [pe[0] + em[0], e.s * (pe[1] + em[1]), -e.s * (pe[2] + em[2])]);
  });
  // the legs, each by two-bone reach from its shoulder or hip to the wrist or hock
  for (const key of LEGS) {
    const L = R.legs[key], spec = pose.legs[key], par = L.front ? X[ix.chest] : X[ix.pelvis];
    const { A, B: Bj, C, D } = L.J;
    const S = apply(par, A);
    // `rel` says the paw, its toes, its sole and the metacarpus in the body's own rest frame (a paw tucked under a
    // cat lying on its side), carried by the shoulder's or hip's bone
    const rel = spec.rel, rv = (v) => (rel ? M3.v(par.R, v) : v);
    const Rp = M3.mul(frameOf(rv(spec.fwd), rv(spec.up)), M3.T(frameOf(P_FWD, P_UP)));
    const pawP = rel ? apply(par, spec.paw) : spec.paw;
    const md = spec.meta ? unit(rv(spec.meta)) : M3.v(Rp, unit(sub(D, C)));
    const W = madd(pawP, md, -L.l3);
    // the elbow points back, the stifle forward, both turned with the body
    const pole = spec.pole ? unit(rv(spec.pole)) : M3.v(par.R, L.front ? [0, 0, -1] : [0, 0, 1]);
    const E = reach(S, W, L.l1, L.l2, pole);
    const side0 = unit(cross(sub(Bj, A), sub(C, Bj))), side1 = unit(cross(sub(E, S), sub(W, E)));
    const s1 = len(side1) > 1e-6 ? side1 : M3.v(par.R, side0);
    X[ix[key + 'up']] = aimXf(A, sub(Bj, A), side0, S, sub(E, S), s1);
    X[ix[key + 'lo']] = aimXf(Bj, sub(C, Bj), side0, E, sub(W, E), s1);
    X[ix[key + 'me']] = aimXf(C, sub(D, C), side0, W, sub(pawP, W), s1);
    X[ix[key + 'pw']] = { R: Rp, t: sub(pawP, M3.v(Rp, D)) };
  }
  // the tail along its line, from where the root has carried its base; the sway and flick bend the line
  {
    const base = apply(X[ix.pelvis], R.TB);
    // the tail's line is in the ground frame, or in the pelvis's rest frame with relTail
    const ctrl = [base, ...(pose.tail || []).map((q) => (pose.relTail ? apply(X[ix.pelvis], q) : q))];
    const t = mo._t || 0;
    for (let i = 1; i < ctrl.length; i++) {
      const f = i / (ctrl.length - 1);
      ctrl[i] = add(ctrl[i], [mo.tailSway * f * f * 0.06, mo.tailLift * f * 0.08, 0]);
    }
    const pts = alongCurve(ctrl, R.TL, TAIL_N + 1);
    // the flick: the last third whips across and back
    if (mo.tailFlick) for (let i = Math.floor(TAIL_N * 0.6); i <= TAIL_N; i++) {
      const f = (i - TAIL_N * 0.6) / (TAIL_N * 0.4);
      pts[i] = add(pts[i], [mo.tailFlick * f * f * 0.05, Math.abs(mo.tailFlick) * f * 0.012, 0]);
    }
    let side = M3.v(X[ix.pelvis].R, [1, 0, 0]);
    for (let i = 0; i < TAIL_N; i++) {
      const d = sub(pts[i + 1], pts[i]);
      side = unit(sub(side, mul(unit(d), dot(side, unit(d)))));
      X[ix['tail' + i]] = aimXf(R.tail[i].j, R.TD, [1, 0, 0], pts[i], d, side);
    }
  }
  return X;
}
// two-bone reach: the middle joint from the root S to the end W with lengths a and b, bent toward `pole`
function reach(S, W, a, b, pole) {
  let d = sub(W, S), L = len(d);
  const lo = Math.abs(a - b) + 1e-4, hi = a + b - 1e-4;
  const Lc = clamp(L, lo, hi);
  const dir = unit(d);
  const x = (a * a + Lc * Lc - b * b) / (2 * Lc), y = Math.sqrt(Math.max(0, a * a - x * x));
  let p = sub(pole, mul(dir, dot(pole, dir)));
  if (len(p) < 1e-6) p = [0, 1, 0];
  return add(add(S, mul(dir, x)), mul(unit(p), y));
}
// n points spaced `step` apart along a Catmull-Rom through ctrl (carried straight on past its end)
function alongCurve(ctrl, step, n) {
  const fine = [];
  const cr = (p0, p1, p2, p3, f) => { const f2 = f * f, f3 = f2 * f; return [0, 1, 2].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * f + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f3)); };
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let s = 0; s < 24; s++) fine.push(cr(p0, p1, p2, p3, s / 24));
  }
  fine.push(ctrl[ctrl.length - 1]);
  const out = [fine[0]];
  let acc = 0, k = 1, prev = fine[0];
  while (out.length < n && k < fine.length) {
    const seg = len(sub(fine[k], prev));
    if (acc + seg >= step) { const f = (step - acc) / seg; prev = lerp3(prev, fine[k], f); out.push(prev); acc = 0; }
    else { acc += seg; prev = fine[k]; k++; }
  }
  const last = fine[fine.length - 1], dirE = unit(sub(last, fine[fine.length - 4] || fine[0]));
  while (out.length < n) out.push(madd(out[out.length - 1], dirE, step));
  return out;
}

// ── the field through the bones ─────────────────────────────────────────────────────────────────────
// For a point in the pose: each bone takes it back to the rest cat and its pieces are read there, the bones joined
// by their pieces' smooth unions. A bone whose sphere is far beyond what's been found already is skipped.
function poseField(R, X) {
  const B = R.bones.map((bn, i) => {
    const Rt = M3.T(X[i].R), t = X[i].t, c = apply(X[i], bn.c);
    return { Rt, t, c, r: bn.r, prims: bn.prims };
  });
  const D = (x, y, z, per) => {
    let d = 1;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      const cx = x - b.c[0], cy = y - b.c[1], cz = z - b.c[2], q = Math.sqrt(cx * cx + cy * cy + cz * cz) - b.r;
      if (q > d + 0.05 && !per) continue;
      const px = x - b.t[0], py = y - b.t[1], pz = z - b.t[2], Rt = b.Rt;
      const rx = Rt[0] * px + Rt[1] * py + Rt[2] * pz, ry = Rt[3] * px + Rt[4] * py + Rt[5] * pz, rz = Rt[6] * px + Rt[7] * py + Rt[8] * pz;
      let own = 1;
      for (const p of b.prims) {
        const v = p.f(rx, ry, rz);
        own = Math.min(own, v);
        d = smin(d, v, p.k);
      }
      if (per) per[i] = own;
    }
    return d;
  };
  return D;
}

// ── the coat ────────────────────────────────────────────────────────────────────────────────────────
const toLin = (h) => { const n = parseInt(String(h).slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.pow(v / 255, 2.2)); };
// How far up the cat a point on the rest cat is, for white spotting: 0 under the chin, the chest, the belly and the
// toes; 1 along the spine, over the crown, the ears and the tail. White spreads up from 0.
function dorsality(R, g, p, hq) {
  const [x, y, z] = p;
  if (g === 'tail') return 0.92 + 0.08 * (1 - (p[2] - R.TB[2]) / -0.5);
  if (g === 'ear') return 1;
  if (g === 'head') {
    const [hx, hy, hz] = hq;
    // the muzzle, chin and the fronts of the cheeks are the lowest; the crown and the back of the head the highest
    let d = 0.5 + hy * 5.5 - Math.max(0, hz - 0.01) * 4.5 + Math.max(0, -hz - 0.02) * 3;
    d -= 0.25 * smooth(0.03, -0.04, hy) * smooth(0.0, 0.05, hz);
    return clamp(d + Math.abs(hx) * 1.2 - 0.05, 0, 1.2);
  }
  if (g === 'leg' || g === 'paw') {
    const top = R.Y(0.42);
    let d = 0.62 * clamp((y - 0.02) / (top - 0.02));
    // the outside of the thigh sits high
    if (z < -0.08) d += 0.35 * smooth(0.06, 0.13, Math.abs(x)) * smooth(0.18, 0.32, y);
    return d;
  }
  // body and neck: the barrel from the belly line to the spine, the bib low at the front
  const lo = R.Y(0.27), hi = R.Y(0.53);
  let d = (y - lo) / (hi - lo) + 0.15 * Math.abs(x) * 4;
  d -= 0.35 * smooth(0.12, 0.3, z) * smooth(0.12, 0.0, Math.abs(x));
  if (g === 'neck') d -= 0.2 * smooth(0.25, 0.35, z);
  return clamp(d, 0, 1.2);
}
function tabbyAt(R, g, p, hq, tb) {
  const f = tb.freq || 1, [x, y, z] = p;
  const w = fbm(x * 9, y * 9, z * 9) * 1.4;
  if (tb.kind === 'ticked') return 0;
  if (g === 'tail') return Math.abs(Math.sin(z * 55 * f + w)) > 0.55 ? 1 : 0;
  if (g === 'leg' || g === 'paw') return Math.abs(Math.sin(y * 60 * f + w)) > 0.7 ? 1 : 0;
  if (g === 'head') {
    const [hx, hy, hz] = hq;
    // the M on the forehead and the lines back from the eyes
    if (hz > 0.0 && hy > 0.03 && Math.abs(Math.sin(hx * 70 + w)) > 0.82) return 1;
    if (Math.abs(hy - 0.0 - Math.abs(hx) * 0.15) < 0.006 && Math.abs(hx) > 0.06) return 1;
    return 0;
  }
  if (tb.kind === 'spotted') return fbm(x * 30 * f, y * 30 * f, z * 30 * f, 2) > 0.18 ? 1 : 0;
  if (tb.kind === 'classic') { const r = Math.hypot(y - R.Y(0.42), z + 0.05); return Math.abs(Math.sin(r * 45 * f + w)) > 0.6 ? 1 : 0; }
  // mackerel: thin stripes down from the spine
  return Math.abs(Math.sin(z * 48 * f + w * 1.5)) > 0.66 ? 1 : 0;
}
// the colour (linear), fur length and material of a point on the rest cat
const inPoly = (x, y, P) => {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
function coatAt(R, look, g, p, ear) {
  const co = look.coat, fur = look.fur;
  const hq = g === 'head' || g === 'ear' ? mul(sub(p, R.HC), 1 / R.HS) : null;
  if (g === 'head') {
    const part = R.H.part(hq[0], hq[1], hq[2]);
    // the leather lighter where it catches the light at the top, a darker edge round it, the nostrils dark
    if (part === 'nose') return { c: lerp3(toLin(co.nose), [1, 1, 1], 0.12 * smooth(-0.02, -0.011, hq[1])), f: 0, m: MAT.SATIN };
    if (part === 'noseEdge') return { c: lerp3(toLin(co.nose), toLin(co.mouth), 0.45), f: 0, m: MAT.SATIN };
    if (part === 'nostril' || part === 'mouth') return { c: toLin(co.mouth), f: 0, m: MAT.MATTE };
    if (part === 'lid') return { c: toLin(co.lid), f: 0, m: MAT.SATIN };
  }
  const dotted = g === 'head' && R.H.part(hq[0], hq[1], hq[2]) === 'dot';
  const innerEar = g === 'ear' && ear && ear.E.inner(hq[0], hq[1], hq[2]);
  if (g === 'paw' && p[1] < 0.012) return { c: toLin(co.pads), f: 0, m: MAT.MATTE };
  let col = 'base';
  const dn = dorsality(R, g, p, hq), wob = fbm(p[0] * 14 + co.seed * 3.1, p[1] * 14, p[2] * 14) * 0.18;
  if (co.white >= 0.98 || (co.white > 0 && dn < co.white * 1.1 + wob - 0.04)) col = 'white';
  if (col === 'base' && co.tabby && tabbyAt(R, g, p, hq, co.tabby)) col = 'stripe';
  for (const mk of co.marks || []) {
    const q = mk.space === 'head' ? hq : p;
    if (mk.poly) {
      if (!q || (mk.on && !mk.on.includes(g)) || q[2] < (mk.zMin ?? -1)) continue;
      const wb = fbm(q[0] * 60 + 3, q[1] * 60, q[2] * 60) * (mk.wob ?? 0.002);
      if (inPoly(q[0] + wb, q[1] - wb, mk.poly)) col = mk.col || 'base';
      continue;
    }
    if (!q || (mk.space === 'head' && g !== 'head' && g !== 'ear')) continue;
    if (mk.on && !mk.on.includes(g)) continue;
    const w2 = fbm(q[0] * 11 + 7, q[1] * 11, q[2] * 11) * (mk.wob ?? 0.3);
    const r = mk.r, e = ((q[0] - mk.c[0]) / r[0]) ** 2 + ((q[1] - mk.c[1]) / r[1]) ** 2 + ((q[2] - mk.c[2]) / r[2]) ** 2;
    if (e < 1 + w2) col = mk.col || 'base';
  }
  // the inside of an ear is skin: pink under white fur, darkened toward the coat under any other
  // the inside of an ear is skin: pink under white fur, darkened toward the coat under any other; darker down in the
  // cup, with pale furnishings fanning up from its base
  if (innerEar) {
    let k = toLin(co.earInner);
    if (col !== 'white') k = lerp3(k, col === 'base' ? toLin(co.base) : toLin(col === 'stripe' ? co.tabby.col : col), 0.55);
    const { t, canal, rim, fold } = ear.E.at(hq[0], hq[1], hq[2]);
    // brighter toward the tip where the light comes through, darker and redder down the cup into the canal, and a
    // short lining of the coat's own fur along the rim
    k = k.map((v) => v * (0.42 + 0.58 * smooth(0.0, 0.55, t)) * (1 + 0.18 * fold));
    k = lerp3(k, toLin(co.mouth), 0.7 * canal);
    k = lerp3(k, col === 'white' ? toLin(co.whiteCol) : col === 'base' ? toLin(co.base) : k, 0.6 * rim);
    return { c: k, f: 0, m: MAT.MATTE };
  }
  let c = col === 'white' ? toLin(co.whiteCol) : col === 'base' ? toLin(co.base) : col === 'stripe' ? toLin(co.tabby.col) : toLin(col);
  let f = fur.body;
  if (g === 'tail') f = fur.tail;
  else if (g === 'leg') f = fur.legs + (fur.body - fur.legs) * smooth(0.1, 0.3, p[1]);
  else if (g === 'paw') f = fur.legs * 0.6;
  else if (g === 'ear') f = fur.face * 0.5;
  else if (g === 'head') f = hq[2] > 0.03 ? fur.face : lerp(fur.face, fur.ruff, smooth(0.07, 0.11, Math.hypot(hq[0], hq[1] + 0.03)));
  else if (g === 'neck') f = fur.ruff;
  else if (p[1] < R.Y(0.32)) f = fur.belly;
  // the whisker roots, and Henry's pocket: the small fold at the outer base of each ear
  if (dotted) c = c.map((v) => v * 0.55 + 0.01);
  if (g === 'ear' && ear && ear.E.pocket(hq[0], hq[1], hq[2])) c = c.map((v) => v * 0.45);
  return { c, f, m: MAT.MATTE };
}

// ── the bake ────────────────────────────────────────────────────────────────────────────────────────
/**
 * One pose of one cat carved and meshed: surface nets over the posed field, grid `h` (sculpt units; 0.004 is about
 * 2.4 mm on a cat), only in a band round the surface. Each vertex keeps where it is, its normal, where it was on the
 * rest cat, its coat, and up to four bones with their weights, so skinCat can move it with the bones.
 */
// Surface nets over `field` in the box lo..hi on grid H, only in a band round the surface, into the shared vertex
// and quad lists; `keep(centre)` drops a quad by where its centre is.
function netsInto(field, lo, hi, H, verts, quads, keep) {
  const O = lo, NX = Math.ceil((hi[0] - lo[0]) / H), NY = Math.ceil((hi[1] - lo[1]) / H), NZ = Math.ceil((hi[2] - lo[2]) / H), C = 4;
  const BX = Math.ceil(NX / C) + 2, BY = Math.ceil(NY / C) + 2, BZ = Math.ceil(NZ / C) + 2, blocks = new Array(BX * BY * BZ);
  const S = (i, j, k) => {
    const bi = (i / C) | 0, bj = (j / C) | 0, bk = (k / C) | 0, b = (bi * BY + bj) * BZ + bk;
    let blk = blocks[b];
    if (!blk) { blk = new Float32Array(C * C * C).fill(NaN); blocks[b] = blk; }
    const ofs = ((i - bi * C) * C + (j - bj * C)) * C + (k - bk * C);
    let d = blk[ofs];
    if (d !== d) { d = field(O[0] + i * H, O[1] + j * H, O[2] + k * H); blk[ofs] = d; }
    return d;
  };
  const CO = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cells = new Map();
  const key = (i, j, k) => (i * 2048 + j) * 2048 + k;
  const cellVertex = (i, j, k) => {
    const kk = key(i, j, k);
    let v = cells.get(kk);
    if (v !== undefined) return v;
    const c = CO.map(([a, b, e]) => S(i + a, j + b, k + e));
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of EDGES) if ((c[a] < 0) !== (c[b] < 0)) { const t = c[a] / (c[a] - c[b]); sx += CO[a][0] + (CO[b][0] - CO[a][0]) * t; sy += CO[a][1] + (CO[b][1] - CO[a][1]) * t; sz += CO[a][2] + (CO[b][2] - CO[a][2]) * t; n++; }
    n = Math.max(1, n);
    v = verts.length; verts.push([O[0] + (i + sx / n) * H, O[1] + (j + sy / n) * H, O[2] + (k + sz / n) * H]); cells.set(kk, v);
    return v;
  };
  const band = C * H * 1.25;
  const push = (q) => {
    if (keep) { const c = [0, 1, 2].map((k) => (verts[q[0]][k] + verts[q[1]][k] + verts[q[2]][k] + verts[q[3]][k]) / 4); if (!keep(c)) return; }
    quads.push(q);
  };
  for (let ci = 0; ci * C < NX; ci++) for (let cj = 0; cj * C < NY; cj++) for (let ck = 0; ck * C < NZ; ck++) {
    if (Math.abs(field(O[0] + (ci + 0.5) * C * H, O[1] + (cj + 0.5) * C * H, O[2] + (ck + 0.5) * C * H)) > band) continue;
    for (let si = ci * C; si < ci * C + C; si += 2) for (let sj = cj * C; sj < cj * C + C; sj += 2) for (let sk = ck * C; sk < ck * C + C; sk += 2) {
      if (Math.abs(field(O[0] + (si + 1) * H, O[1] + (sj + 1) * H, O[2] + (sk + 1) * H)) > H * 2.2) continue;
      for (let i = si; i < si + 2; i++) for (let j = sj; j < sj + 2; j++) for (let k = sk; k < sk + 2; k++) {
        const d0 = S(i, j, k) < 0;
        if ((S(i + 1, j, k) < 0) !== d0 && j > 0 && k > 0) { const q = [cellVertex(i, j - 1, k - 1), cellVertex(i, j, k - 1), cellVertex(i, j, k), cellVertex(i, j - 1, k)]; push(d0 ? q : q.reverse()); }
        if ((S(i, j + 1, k) < 0) !== d0 && i > 0 && k > 0) { const q = [cellVertex(i - 1, j, k - 1), cellVertex(i - 1, j, k), cellVertex(i, j, k), cellVertex(i, j, k - 1)]; push(d0 ? q : q.reverse()); }
        if ((S(i, j, k + 1) < 0) !== d0 && i > 0 && j > 0) { const q = [cellVertex(i - 1, j - 1, k), cellVertex(i, j - 1, k), cellVertex(i, j, k), cellVertex(i - 1, j, k)]; push(d0 ? q : q.reverse()); }
      }
    }
  }
}

export function bakeCat(look0, pose = 'stand', o = {}) {
  const look = look0?.build ? look0 : catLook(look0);
  const R = o.rig || catRig(look);
  const poseFn = typeof pose === 'string' ? CAT_POSES[pose] : pose;
  const X = solveRig(R, poseFn, STILL);
  const F = poseField(R, X);
  const H = o.h || 0.004, nb = R.bones.length;
  // the box: every bone's posed sphere
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  R.bones.forEach((bn, i) => { const c = apply(X[i], bn.c); for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], c[k] - bn.r * 0.8); hi[k] = Math.max(hi[k], c[k] + bn.r * 0.8); } });
  lo = lo.map((v) => v - 0.03); hi = hi.map((v) => v + 0.03); lo[1] = Math.max(lo[1], -0.01);
  // the floor cuts the field, so a paw is flat where it stands
  const field = (x, y, z) => Math.max(F(x, y, z), -0.001 - y);
  const verts = [], quads = [];
  // The face is carved on a finer grid than the body (`faceH`, half the body's by default): the head and the ears
  // inside a ball round the head are meshed on their own grid, the body's mesh is cut away inside it, and the seam
  // falls round the throat, in the ruff, where the fur covers it. The two overlap by half a cell so no crack shows.
  const fH = o.faceH ?? H * 0.5, hc = apply(X[R.index.head], R.HC), fr = 0.19 * R.HS;
  const dFace = (c) => Math.hypot(c[0] - hc[0], c[1] - hc[1], c[2] - hc[2]);
  if (fH < H) {
    netsInto(field, lo, hi, H, verts, quads, (c) => dFace(c) > fr);
    const flo = hc.map((v, k) => Math.max(lo[k], v - fr - 3 * H)), fhi = hc.map((v, k) => Math.min(hi[k], v + fr + 3 * H));
    netsInto(field, flo, fhi, fH, verts, quads, (c) => dFace(c) <= fr + H * 0.5);
  } else netsInto(field, lo, hi, H, verts, quads, null);
  {
    const used = new Int32Array(verts.length).fill(-1), kept = [];
    for (const q of quads) for (let k = 0; k < 4; k++) { const v = q[k]; if (used[v] < 0) { used[v] = kept.length; kept.push(verts[v]); } q[k] = used[v]; }
    verts.length = 0; verts.push(...kept);
  }
  // each vertex: its normal from the field, its bones and weights, where it was on the rest cat, its coat
  const n = verts.length, Pv = new Float32Array(n * 3), Nv = new Float32Array(n * 3), Cv = new Float32Array(n * 3), Fv = new Float32Array(n), Mv = new Uint8Array(n);
  const Wb = new Uint8Array(n * 4), Ww = new Float32Array(n * 4), Bm = new Float32Array(n), Rest = new Float32Array(n * 3);
  const per = new Float64Array(nb), e = H * 0.25;
  const inv = X.map((x) => ({ Rt: M3.T(x.R), t: x.t }));
  const sig = 0.011;
  // the face's lighting normal (below): how far it's rounded, and the point in the skull it's rounded about
  const faceSoft = o.faceSoft ?? 0.6, hBack = madd(hc, M3.v(X[R.index.head].R, [0, 0, 1]), -0.35 * fr);
  for (let v = 0; v < n; v++) {
    const p = verts[v];
    Pv[v * 3] = p[0]; Pv[v * 3 + 1] = p[1]; Pv[v * 3 + 2] = p[2];
    const a = field(p[0] + e, p[1] - e, p[2] - e), b = field(p[0] - e, p[1] - e, p[2] + e), c = field(p[0] - e, p[1] + e, p[2] - e), d = field(p[0] + e, p[1] + e, p[2] + e);
    const nn = unit([a - b - c + d, -a - b + c + d, -a + b - c + d]);
    // the bones nearest the surface own it, falling off over `sig`
    F(p[0], p[1], p[2], per);
    let best = 1e9;
    for (let i = 0; i < nb; i++) best = Math.min(best, per[i]);
    const top = [];
    for (let i = 0; i < nb; i++) { const w = Math.exp(-(per[i] - best) / sig); if (w > 0.02) top.push([w, i]); }
    top.sort((x, y) => y[0] - x[0]);
    const k4 = top.slice(0, 4), sw = k4.reduce((s, q) => s + q[0], 0);
    let rest = [0, 0, 0];
    k4.forEach(([w, i], k) => {
      Wb[v * 4 + k] = i; Ww[v * 4 + k] = w / sw;
      const I = inv[i], r = M3.v(I.Rt, sub(p, I.t));
      rest = madd(rest, r, w / sw);
    });
    Rest[v * 3] = rest[0]; Rest[v * 3 + 1] = rest[1]; Rest[v * 3 + 2] = rest[2];
    // the coat read where the point was on the rest cat, through the bones of the group that owns it most, blended (one
    // bone alone splits a patch where a joint bends; mixing groups would smear the face into the neck)
    const own = k4[0][1], bn = R.bones[own];
    // The face is lit through a rounder normal than it's carved with: the field's normal bent toward the way out
    // from a point set back in the skull, as an animator transfers a sphere's normals onto a drawn face. The comic
    // terminator then sweeps the head as one ball instead of cutting a hard band along every bump of the cheeks
    // and whisker pads. The creases still read from the shading baked into the coat, below. Fades out toward the
    // ruff so the neck meets the body's own normals; ears keep theirs.
    let ln = nn;
    if (bn.group === 'head' && faceSoft > 0) {
      const dc = dFace(p), w = faceSoft * (1 - smooth(fr * 0.75, fr, dc));
      if (w > 0) ln = unit(lerp3(nn, unit(sub(p, hBack)), w));
    }
    Nv[v * 3] = ln[0]; Nv[v * 3 + 1] = ln[1]; Nv[v * 3 + 2] = ln[2];
    let r0 = [0, 0, 0], wg = 0;
    for (const [w, i] of k4) {
      if (R.bones[i].group !== bn.group) continue;
      const I = inv[i];
      r0 = madd(r0, M3.v(I.Rt, sub(p, I.t)), w); wg += w;
    }
    r0 = mul(r0, 1 / wg);
    const ear = bn.group === 'ear' ? R.ears.find((x) => x.bone === bn) : null;
    const ct = coatAt(R, look, bn.group, r0, ear);
    // the body's breath: the ribs and belly rise, the legs and head don't
    Bm[v] = k4.reduce((s, [w, i]) => s + (i === R.index.chest || i === R.index.lumbar ? w : 0), 0) / sw;
    // the crease's own shadow, two steps out along the normal
    let ao = 1;
    for (const hh of [0.004, 0.01, 0.02]) ao -= (Math.max(0, hh - F(p[0] + nn[0] * hh, p[1] + nn[1] * hh, p[2] + nn[2] * hh)) / hh) * 0.28;
    const faceAO = R.bones[own].group === 'head' || R.bones[own].group === 'ear';
    ao = faceAO ? clamp(ao) * 0.42 + 0.58 : clamp(ao) * 0.22 + 0.78;
    Cv[v * 3] = ct.c[0] * ao; Cv[v * 3 + 1] = ct.c[1] * ao; Cv[v * 3 + 2] = ct.c[2] * ao;
    Fv[v] = ct.f; Mv[v] = ct.m;
  }
  const Q = new Uint32Array(quads.length * 4);
  quads.forEach((q, i) => { Q[i * 4] = q[0]; Q[i * 4 + 1] = q[1]; Q[i * 4 + 2] = q[2]; Q[i * 4 + 3] = q[3]; });
  return { look, rig: R, pose: poseFn, X, P: Pv, N: Nv, C: Cv, F: Fv, M: Mv, Wb, Ww, Bm, Rest, Q, verts: n, quads: quads.length, h: H };
}

// ── the eyes, the lids and the whiskers, built every frame on the head ─────────────────────────────────
function headBits(R, look, mo, push, headX) {
  const co = look.coat, ey = look.eyes, HS = R.HS, HC = R.HC;
  const toW = (q) => apply(headX, add(HC, mul(q, HS)));
  const nW = (n) => unit(M3.v(headX.R, n));
  const iris = toLin(ey.iris), ring = toLin(ey.rim), black = toLin('#0b0b0d'), white = [1, 1, 1];
  const pupil = clamp(mo.pupil ?? ey.pupil);
  const lids = clamp(Math.max(mo.lids || 0, ey.droop || 0));
  const EK = R.EK, { fromEye, eyeC, es, op } = EK, sk = EK.sunk;
  for (const s of [-1, 1]) {
    // a domed disc in the eye's frame: a round the rim, b out from the middle
    const disc = (rx, ry, ox, oy, z0, dome) => (a, b) => { const t = a * Math.PI * 2; return fromEye([ox + Math.cos(t) * rx * b, oy + Math.sin(t) * ry * b, z0 + dome * Math.sqrt(Math.max(0, 1 - b * b))], s); };
    const lens = (S, col, nu, nv, mat, inkless) => {
      const g = [];
      for (let j = 0; j <= nv; j++) { const row = []; for (let i = 0; i <= nu; i++) row.push(S(i / nu, j / nv)); g.push(row); }
      const out = sub(g[0][0], [0, 0.012, -0.01]);
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const q = [g[j][i], g[j][i + 1], g[j + 1][i + 1], g[j + 1][i]];
        let nn = unit(cross(sub(q[2], q[0]), sub(q[3], q[1])));
        if (len(nn) < 0.5 || !Number.isFinite(nn[0])) nn = unit(out);
        if (dot(nn, out) < 0) nn = mul(nn, -1);
        const c = col(i / nu, j / nv);
        push(q.map(toW), nW(nn), c, mat, inkless);
      }
    };
    // the iris fills the opening and a little more, so no socket shows round it; `sunk` sets it back
    // the iris: paler in a ring round the pupil, the colour in the middle, a dark ring at its edge, fibres running out
    const inner = lerp3(iris, [1, 0.95, 0.75], 0.32);
    lens(disc(EK.rx * 0.97, EK.ryT * 1.1, 0, 0, -0.0036 * es * sk, 0.0055 * es), (a, b) => {
      const fib = 1 + 0.07 * Math.sin(a * Math.PI * 2 * 31 + 3 * Math.sin(a * Math.PI * 2 * 7)) * smooth(0.25, 0.5, b);
      const c = b < 0.5 ? lerp3(inner, iris, smooth(0.28, 0.5, b)) : lerp3(iris, ring, smooth(0.66, 0.97, b));
      return c.map((v) => v * fib * (b > 0.48 && b < 0.53 ? 0.88 : 1));
    }, 64, 14, MAT.GLOSS, false);
    // the pupil: a slit in bright light, a full round dark in the dark or when it's excited
    const zt = (-0.0036 * sk + 0.0055) * es;
    lens(disc(lerp(0.0016, 0.0158, pupil) * es, lerp(0.0118, 0.0128, pupil) * es * op, 0, 0.0003 * es, zt + 0.0002 * es, 0.0011 * es), () => black, 36, 6, MAT.GLOSS, true);
    lens(disc(0.0036 * es, 0.0031 * es, s * -0.0058 * es, 0.0052 * es * op, zt + 0.0012 * es, 0.0005 * es), () => white, 16, 3, MAT.GLOSS, true);
    // and a small one low on the far side, the light off the floor
    lens(disc(0.0012 * es, 0.001 * es, s * 0.0062 * es, -0.0058 * es * op, zt + 0.0006 * es, 0.0003 * es), () => [0.8, 0.82, 0.85], 10, 2, MAT.GLOSS, true);
    // the upper lid coming down: a shell over the opening from the top to `lids` of the way down, the coat's colour,
    // with the lid's dark rim along its edge
    if (lids > 0.02) {
      const top = EK.ryT, bot = -EK.ryB, edge = lerp(top, bot, lids), nu = 14, nv = 5, X = EK.rx * 1.03;
      const fur = sampleHeadCoat(R, look, fromEye([0, 0.008, 0.003], s));
      const lidCol = toLin(co.lid);
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const P4 = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => {
          const x = lerp(-X, X, a / nu), yTop = top * Math.sqrt(Math.max(0, 1 - (x / X) ** 2)) + 0.0012 * es;
          const sq = Math.sqrt(Math.max(0, 1 - (x / X) ** 2)), y = lerp(yTop, lerp(top * sq, bot * sq, lids), b / nv);
          return fromEye([x, y, (0.0045 + 0.0042 * Math.sqrt(Math.max(0, 1 - (x / (X * 1.08)) ** 2 - (y / (Math.max(top, -bot) * 1.17)) ** 2))) * es], s);
        });
        const nn = nW(unit(sub(fromEye([0, 0, 0.01], s), eyeC(s))));
        push(P4.map(toW), nn, j === nv - 1 ? lidCol : fur, MAT.MATTE, j === nv - 1);
      }
    }
    // whiskers (the mystacial set): four rows across each pad, three to a row, the top rows longest, curving down and
    // back, fanned forward by `whiskers` (−1 laid back flat, +1 bristling forward to feel something)
    const wc = toLin(co.whisker), mz = look.build.muzzle, fan = (mo.whiskers || 0) * 0.5;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) {
      const root = [s * (0.016 + i * 0.0068 + j * 0.0012), -0.0335 - j * 0.0048 - i * 0.0006, 0.084 * mz - i * 0.006 - j * 0.002];
      const dir = unit([s * 1, 0.28 - j * 0.16 + i * 0.02, -0.4 + fan + i * 0.06]);
      const L = (0.11 - j * 0.012 + 0.02 * Math.sin(i * 2.3 + j)) * (1 - 0.15 * i);
      const droop = 0.02 + j * 0.006;
      hair([root, add(madd(root, dir, L * 0.5), [0, -droop * 0.3, 0]), add(madd(root, dir, L), [0, -droop, -0.008])], 0.0011, 0.00025, wc, push, toW, nW);
    }
    // over each eye (supraorbital)
    for (let i = 0; i < 2; i++) {
      const c = eyeC(s), root = [c[0] * (0.78 + i * 0.22), c[1] + 0.024 * es, c[2] - 0.006 - i * 0.006];
      const dir = unit([s * (0.75 + i * 0.2), 0.65, 0.35]);
      hair([root, madd(root, dir, 0.03), add(madd(root, dir, 0.062), [s * 0.016, -0.012, 0])], 0.0008, 0.0002, wc, push, toW, nW);
    }
    // on the chin (mandibular)
    {
      const root = [s * 0.008, -0.062, 0.066 * mz], dir = unit([s * 0.5, -0.6, 0.6]);
      hair([root, madd(root, dir, 0.014), add(madd(root, dir, 0.026), [0, -0.004, 0])], 0.0006, 0.00015, wc, push, toW, nW);
    }
  }
}
// a thin hair as a ribbon facing the head's front, uninked
function hair(pts, r0, r1, col, push, toW, nW) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], d = unit(sub(b, a)), side = unit(cross(d, [0, 0, 1]).every((v) => v === 0) ? [1, 0, 0] : cross(d, [0, 0.3, 1]));
    const ra = lerp(r0, r1, i / (pts.length - 1)), rb = lerp(r0, r1, (i + 1) / (pts.length - 1));
    const q = [madd(a, side, -ra), madd(a, side, ra), madd(b, side, rb), madd(b, side, -rb)];
    push(q.map(toW), nW(unit(cross(side, d))), col, MAT.MATTE, true, true);
  }
}
function sampleHeadCoat(R, look, q) {
  return coatAt(R, look, 'head', add(R.HC, mul(q, R.HS)), null).c;
}

// ── skinning a bake to the bones as they are now ─────────────────────────────────────────────────────
/**
 * The bake moved to `mo` (the motion over its pose) into the beast kit's mesh M (gl/beast-kit.js beastMesh), in
 * metres. The eyes, lids and whiskers are added on the head as it is now, and the fur shells after, so
 * toBatch(b, M, placeAt(...)) draws it like any beast.
 */
export function skinCat(bake, M, mo = STILL, o = {}) {
  const R = bake.rig, look = bake.look, sc = look.scale;
  const Xn = solveRig(R, bake.pose, mo);
  // each bone's map from the baked pose to now
  const K = Xn.map((x, i) => {
    const R0t = M3.T(bake.X[i].R), Rm = M3.mul(x.R, R0t);
    return { R: Rm, t: sub(x.t, M3.v(Rm, bake.X[i].t)) };
  });
  const n = bake.verts, P = new Float32Array(n * 3), N = new Float32Array(n * 3);
  const br = (mo.breath || 0) * 0.0035;
  for (let v = 0; v < n; v++) {
    const px = bake.P[v * 3], py = bake.P[v * 3 + 1], pz = bake.P[v * 3 + 2], nx = bake.N[v * 3], ny = bake.N[v * 3 + 1], nz = bake.N[v * 3 + 2];
    let x = 0, y = 0, z = 0, a = 0, b = 0, c = 0;
    for (let k = 0; k < 4; k++) {
      const w = bake.Ww[v * 4 + k];
      if (!w) continue;
      const T = K[bake.Wb[v * 4 + k]], m = T.R;
      x += w * (m[0] * px + m[1] * py + m[2] * pz + T.t[0]); y += w * (m[3] * px + m[4] * py + m[5] * pz + T.t[1]); z += w * (m[6] * px + m[7] * py + m[8] * pz + T.t[2]);
      a += w * (m[0] * nx + m[1] * ny + m[2] * nz); b += w * (m[3] * nx + m[4] * ny + m[5] * nz); c += w * (m[6] * nx + m[7] * ny + m[8] * nz);
    }
    const l = Math.hypot(a, b, c) || 1; a /= l; b /= l; c /= l;
    const lift = br * bake.Bm[v];
    P[v * 3] = (x + a * lift) * sc; P[v * 3 + 1] = (y + b * lift) * sc; P[v * 3 + 2] = (z + c * lift) * sc;
    N[v * 3] = a; N[v * 3 + 1] = b; N[v * 3 + 2] = c;
  }
  const from = M.M.length / 3;
  const push3 = (i) => {
    M.P.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); M.N.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
    M.C.push(bake.C[i * 3], bake.C[i * 3 + 1], bake.C[i * 3 + 2]); M.M.push(bake.M[i]); M.B.push(-1); M.U.push(0, 0); M.F.push(bake.F[i]);
  };
  const Q = bake.Q;
  for (let q = 0; q < bake.quads; q++) {
    const i0 = Q[q * 4], i1 = Q[q * 4 + 1], i2 = Q[q * 4 + 2], i3 = Q[q * 4 + 3];
    // split along the shorter diagonal
    const d02 = (P[i0 * 3] - P[i2 * 3]) ** 2 + (P[i0 * 3 + 1] - P[i2 * 3 + 1]) ** 2 + (P[i0 * 3 + 2] - P[i2 * 3 + 2]) ** 2;
    const d13 = (P[i1 * 3] - P[i3 * 3]) ** 2 + (P[i1 * 3 + 1] - P[i3 * 3 + 1]) ** 2 + (P[i1 * 3 + 2] - P[i3 * 3 + 2]) ** 2;
    // wound so the face's own normal goes the way the field's does
    const ex = [P[i2 * 3] - P[i0 * 3], P[i2 * 3 + 1] - P[i0 * 3 + 1], P[i2 * 3 + 2] - P[i0 * 3 + 2]], ey = [P[i3 * 3] - P[i1 * 3], P[i3 * 3 + 1] - P[i1 * 3 + 1], P[i3 * 3 + 2] - P[i1 * 3 + 2]];
    const fn = cross(ex, ey), sn = [N[i0 * 3] + N[i2 * 3], N[i0 * 3 + 1] + N[i2 * 3 + 1], N[i0 * 3 + 2] + N[i2 * 3 + 2]];
    const [a0, a1, a2, a3] = dot(fn, sn) >= 0 ? [i0, i1, i2, i3] : [i0, i3, i2, i1];
    if (d02 <= d13) { push3(a0); push3(a1); push3(a2); push3(a0); push3(a2); push3(a3); }
    else { push3(a0); push3(a1); push3(a3); push3(a1); push3(a2); push3(a3); }
  }
  // the eyes, lids and whiskers, in metres
  const headX = Xn[R.index.head];
  const pushQ = (q, nn, col, mat, inkless, twoSided) => {
    const s = q.map((p) => mul(p, sc)), nm = inkless ? mul(nn, 0.05) : nn;
    for (const k of [0, 1, 2, 0, 2, 3]) { M.P.push(s[k][0], s[k][1], s[k][2]); M.N.push(nm[0], nm[1], nm[2]); M.C.push(col[0], col[1], col[2]); M.M.push(mat); M.B.push(-1); M.U.push(0, 0); M.F.push(0); }
    if (twoSided) for (const k of [0, 2, 1, 0, 3, 2]) { M.P.push(s[k][0], s[k][1], s[k][2]); M.N.push(-nm[0], -nm[1], -nm[2]); M.C.push(col[0], col[1], col[2]); M.M.push(mat); M.B.push(-1); M.U.push(0, 0); M.F.push(0); }
  };
  headBits(R, look, mo, pushQ, headX);
  {
    const fc = lerp3(toLin(look.coat.whiteCol), toLin(look.coat.earInner), 0.18);
    for (const ear of R.ears) {
      const eX = Xn[R.index[ear.bone.name]];
      const toW = (q) => apply(eX, add(R.HC, mul(q, R.HS))), nW = (n) => unit(M3.v(eX.R, n));
      for (const pts of ear.E.tufts()) hair(pts, 0.0024, 0.0003, fc, pushQ, toW, nW);
    }
  }
  if (o.fur !== false && look.fur.budget > 0) furShells(M, from, { budget: o.furBudget ?? look.fur.budget, step: 0.0014, max: 8, floor: 0.004 });
  return M;
}

// ── idling ──────────────────────────────────────────────────────────────────────────────────────────
// What a cat does while it holds a pose, from the clock alone: the same t gives the same cat for everyone. `awake` 0
// is asleep (slow deep breaths, lids shut, the odd ear twitch); 1 is alert (quicker breaths, looking about, slow
// blinks, the tail's tip working). `seed` makes two cats move out of step.
export function idleMotion(t, { awake = 1, seed = 1 } = {}) {
  const mo = { ...STILL, ears: [[0, 0, 0], [0, 0, 0]], head: [0, 0, 0] };
  // breathing: about 24 a minute awake, 18 asleep; in quicker than out
  const rate = lerp(0.3, 0.42, awake), ph = (t * rate + seed * 0.37) % 1;
  mo.breath = ph < 0.4 ? smooth(0, 0.4, ph) : 1 - smooth(0.4, 1, ph);
  // looking about: the head settles on a new spot every few seconds, and holds it
  const look = (k) => { const i = Math.floor(t / 3.2 + seed * 0.7 + k), f = smooth(0, 0.18, (t / 3.2 + seed * 0.7 + k) % 1); return lerp(rnd(i, seed) - 0.5, rnd(i + 1, seed) - 0.5, f); };
  mo.head = [look(0.5) * 0.18 * awake, look(0) * 0.7 * awake, look(0.3) * 0.12 * awake];
  // an ear turns on its own now and then, and comes back
  for (let e = 0; e < 2; e++) {
    const per = 2.7 + e * 1.3, i = Math.floor(t / per + seed + e * 0.4), f = (t / per + seed + e * 0.4) % 1;
    const go = rnd(i, e + 7) > 0.45 ? 1 : 0, amt = go * Math.sin(Math.PI * smooth(0, 0.5, f)) * (rnd(i, e + 9) * 0.8 + 0.2);
    mo.ears[e] = [0.1 * amt, (0.9 * awake + 0.4) * amt, 0];
    // the twitch: a quick flick, then still
    const tw = (t * 0.37 + e * 0.53 + seed) % 1;
    if (tw < 0.035) mo.ears[e][2] += Math.sin(tw / 0.035 * Math.PI * 3) * 0.25;
  }
  // the blink: a slow one every few seconds awake (the cat's 'I trust you'), none asleep
  if (awake > 0.2) {
    const bp = (t / 5.3 + seed * 0.31) % 1;
    mo.lids = bp < 0.12 ? Math.sin(bp / 0.12 * Math.PI) * 0.95 : 0;
    mo.lids = Math.max(mo.lids, 0.18 * (1 - awake));
  } else mo.lids = 1;
  mo.pupil = null;
  // the tail: a slow sway, and the tip working when it's awake
  mo.tailSway = Math.sin(t * 0.55 + seed) * lerp(0.15, 0.6, awake);
  mo.tailFlick = Math.sin(t * 2.6 + seed * 2) * Math.max(0, Math.sin(t * 0.33 + seed)) * awake * 0.8;
  mo.whiskers = 0.3 * awake * Math.max(0, Math.sin(t * 0.21 + seed));
  mo._t = t;
  return mo;
}
