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
import { BREEDS, PATTERNS } from './cat-breeds.js';

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
// an ellipsoid set along a limb: centred at c, its first radius along `along`, its second across `side` (squared off
// against `along`), its third across both. A muscle is written as where it lies on the bone and which way it runs.
function mkAxis(c, along, side, r) {
  const a = unit(along);
  let s = sub(side, mul(a, dot(side, a)));
  if (len(s) < 1e-6) s = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  s = unit(s);
  const t = cross(a, s), [cx, cy, cz] = c, jx = 1 / (r[0] * r[0]), jy = 1 / (r[1] * r[1]), jz = 1 / (r[2] * r[2]), lo = -Math.min(r[0], r[1], r[2]);
  return (x, y, z) => {
    const px = x - cx, py = y - cy, pz = z - cz;
    const qx = a[0] * px + a[1] * py + a[2] * pz, qy = s[0] * px + s[1] * py + s[2] * pz, qz = t[0] * px + t[1] * py + t[2] * pz;
    const k0 = Math.sqrt(qx * qx * jx + qy * qy * jy + qz * qz * jz), k1 = Math.sqrt(qx * qx * jx * jx + qy * qy * jy * jy + qz * qz * jz * jz);
    return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : lo;
  };
}
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);

// A paw, toes forward along +Z from c. A cat walks on its toes, and its paw is a round mitten, wider than the wrist
// above it and about two-thirds as tall as it's long: a domed bun (the metacarpal pad and the bones over it) behind,
// four toes on an arc round its front, the middle two furthest forward and the outer two curving round its sides,
// each toe a rounded pad under a raised knuckle, with grooves between them. The back of the paw rises straight into
// the pastern. `L` is half its length, `w` its width. (Catster's paw anatomy; Chris Wilson on drawing paws.)
function mkPaw(c, L, w = 1) {
  const bun = mkEllip([c[0], c[1] + 0.004, c[2] - L * 0.22], [0.024 * w, 0.0205, L * 0.72]);
  const T = [-1.5, -0.5, 0.5, 1.5];
  const sp = 0.0134 * w;
  const toeAt = (t) => [c[0] + t * sp, c[1] - 0.0026, c[2] + L * 0.55 - Math.abs(t) * (0.004 + Math.abs(t) * 0.0028)];
  const toes = T.map((t) => mkAxis(toeAt(t), [t * 0.18, 0, 1], [1, 0, 0], [0.0128, 0.0074 * w, 0.0124]));
  const knuckles = T.map((t) => { const p = toeAt(t); return mkEllip([p[0] * 0.96 + c[0] * 0.04, p[1] + 0.009, p[2] - 0.0072], [0.0068 * w, 0.0085, 0.0092]); });
  const cuts = [-1, 0, 1].map((t) => { const p = toeAt(t), x = c[0] + t * sp; return mkCone([x, c[1] + 0.024, p[2] - 0.016], [x, c[1] - 0.004, p[2] + 0.016], 0.0018, 0.0026); });
  const f = (x, y, z) => {
    let d = bun(x, y, z);
    for (const t of toes) d = smin(d, t(x, y, z), 0.0038);
    for (const k of knuckles) d = smin(d, k(x, y, z), 0.006);
    for (const k of cuts) d = smax(d, -k(x, y, z), 0.0018);
    return d;
  };
  // how far a point is from the nearest parting between the toes: a line between each pair from the knuckles down to
  // the floor, over the front of the paw; the coat darkens down them, as the fur parts there
  const zFront = c[2] + L * 0.55 - 0.026;
  f.groove = (x, y, z) => {
    if (z < zFront || y > c[1] + 0.02) return 1;
    let g = 1;
    for (const t of [-1, 0, 1]) g = Math.min(g, Math.abs(x - (c[0] + t * sp)));
    return g + 0.0012 * smooth(c[1] + 0.012, c[1] + 0.02, y);
  };
  return f;
}

// ── a cat as numbers ────────────────────────────────────────────────────────────────────────────────
// `build` stretches the sculpt (1 is an ordinary domestic shorthair at the statue's proportions); `coat` paints it;
// `eyes` and `fur` are what they say. `coat.white` is how far white spotting has spread, from none (0) through a
// locket and mittens (0.2), a tuxedo (0.45), a bicolour (0.65) to a van (0.9); `marks` are patches laid over it,
// each an ellipsoid where it sits on the rest cat ('body') or on the head ('head', in the head's own frame).
export const CAT = {
  scale: 0.6,
  // `jowls` are a tom's: the heavy cheeks an entire or late-neutered male carries low on the face; `dome` is how round
  // and high the skull is over the eyes (a kitten's is high; it reads as young and soft)
  build: { length: 1, neckLen: 1, belly: 1, pouch: 1, chest: 1, hips: 1, neck: 1, legLen: 1, legW: 1, head: 1, cheeks: 1, jowls: 1, dome: 1, ears: 0.8, earRound: 0, muzzle: 1, tailLen: 1, tailW: 1, tailFluff: 0, legFluff: 0 },
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
// A cat's numbers: the kit's, then its breed's (gl/cat-breeds.js, `breed`), then its coat pattern's (`coat.pattern`,
// which sets how far the white goes), then its own over all of them.
export function catLook(o = {}) {
  const B = BREEDS[o.breed] || BREEDS.domestic, pat = PATTERNS[o.coat?.pattern] || {};
  return {
    ...CAT, ...(B.scale ? { scale: B.scale } : {}), ...o,
    build: { ...CAT.build, ...(B.build || {}), ...(o.build || {}) }, coat: { ...CAT.coat, ...(B.coat || {}), ...pat, ...(o.coat || {}) },
    eyes: { ...CAT.eyes, ...(B.eyes || {}), ...(o.eyes || {}) }, fur: { ...CAT.fur, ...(B.fur || {}), ...(o.fur || {}) },
  };
}
/** A breed's lean to a cat's nature, under the cat's own (the Feline Five, 0..1 each). */
export const natureOf = (look = {}, own = {}) => ({ ...(BREEDS[look.breed]?.nature || {}), ...own });

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
// How far the nose and mouth (NY) and the whisker pads (PY) sit below where the statue carved them, in the head's
// units. A cat's nose is lower than you'd think: measured off a photograph from the front, the eye line to the tip of
// the nose is about 1.2 times the tip of the nose to the chin; the statue's was 0.7.
const NY = -0.011, PY = -0.006;
function makeHead(b, EK) {
  const mz = b.muzzle, ck = b.cheeks, jw = b.jowls ?? 1, dm = b.dome ?? 1, { eyeC, eyeM, lidD, SOCKET } = EK;
  const CRANIUM = mkEllip([0, 0.004 + 0.012 * (dm - 1), -0.012], [0.088 * (1 + 0.3 * (dm - 1)), 0.064 * dm, 0.083]), CHEEKS = mkEllip([0, -0.006, 0.0], [0.1 * ck, 0.05, 0.072]);
  // a tom's jowls: two soft masses low and wide on the cheeks, behind the whisker pads, filling the face out to a
  // rounded square; none on a cat at 1
  const JOWLS = jw > 1.01 ? [-1, 1].map((s) => mkEllip([s * 0.058 * ck, -0.03 - 0.008 * (jw - 1), 0.008], [0.042 + 0.03 * (jw - 1), 0.034 + 0.016 * (jw - 1), 0.05])) : [];
  const RUFFS = [-1, 1].map((s) => mkEllip([s * 0.07 * ck, -0.03, -0.018], [0.03, 0.036, 0.042]));
  const BRIDGE = mkEllip([0, -0.004 + NY * 0.5, 0.05 * mz], [0.026, 0.03 - NY * 0.4, 0.023], [-0.6, 0, 0]), MUZZLE = mkEllip([0, -0.036 + PY, 0.058 * mz], [0.04, 0.029, 0.032]);
  const PADS = [-1, 1].map((s) => mkEllip([s * 0.0195, -0.041 + PY, 0.074 * mz], [0.024, 0.0195, 0.021]));
  const CHIN = mkEllip([0, -0.061, 0.054 * mz], [0.016, 0.011, 0.015]), NOSE = mkEllip([0, -0.018 + NY, 0.085 * mz], [0.0135, 0.0085, 0.009], [-0.35, 0, 0]);
  const NOSTRILS = [-1, 1].map((s) => mkEllip([s * 0.0072, -0.0205 + NY, 0.0905 * mz], [0.0028, 0.0018, 0.004], [0, 0, s * 0.6]));
  const CLEFT = mkCone([0, -0.025 + NY, 0.091 * mz], [0, -0.039 + NY * 0.6, 0.089 * mz], 0.0013, 0.0013);
  const MOUTH = [-1, 1].map((s) => mkCone([0, -0.04 + NY * 0.6, 0.088 * mz], [s * 0.032, -0.053 + NY * 0.3, 0.066 * mz], 0.0013, 0.001));
  const EM = [-1, 1].map((s) => ({ s, c: eyeC(s), m: eyeM(s) }));
  const BROWS = [-1, 1].map((s) => { const c = eyeC(s); return mkEllip([c[0] * 0.95, c[1] + 0.021 * EK.es, c[2] - 0.01], [0.026 * EK.es, 0.0065, 0.017], [0.15, 0, 0]); });
  const field = (x, y, z) => {
    let d = CRANIUM(x, y, z);
    for (const b2 of BROWS) d = smin(d, b2(x, y, z), 0.026);
    d = smin(d, CHEEKS(x, y, z), 0.045);
    for (const j of JOWLS) d = smin(d, j(x, y, z), 0.04);
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
    if (x * x + (y + 0.04 - NY * 0.6) ** 2 + (z - 0.075 * mz) ** 2 < 0.0025) {
      for (const n of NOSTRILS) d = smax(d, -n(x, y, z), 0.0015);
      d = smax(d, -CLEFT(x, y, z), 0.0015);
      for (const mo of MOUTH) d = smax(d, -mo(x, y, z), 0.0015);
    }
    return d;
  };
  // what a point on the head is, before the coat: the nose leather, a lid's rim, the mouth line
  const part = (x, y, z) => {
    for (const n of NOSTRILS) if (n(x, y, z) < 0.0012) return 'nostril';
    if (z > 0.07 * mz && NOSE(x, y, z) < 0.0022 && y > -0.0275 + NY && y < -0.009 + NY) {
      // the leather: flat across the top, coming to a point over the cleft
      const w = 0.0135 * clamp((y + 0.0275 - NY) / 0.0165);
      if (Math.abs(x) < w + 0.0006) return Math.abs(x) > w - 0.0008 ? 'noseEdge' : 'nose';
    }
    if (y < -0.0272 + NY && CLEFT(x, y, z) < 0.0013) return 'mouth';
    for (const mo of MOUTH) if (mo(x, y, z) < 0.0016) return 'mouth';
    // the whisker roots: four rows of dots across each pad, a little darker than the fur round them
    if (z > 0.07 * mz && y < -0.03 + PY && y > -0.054 + PY) for (const sd of [-1, 1]) for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const dx = x - sd * (0.012 + i * 0.0062 + j * 0.0012), dy = y - (-0.0335 + PY - j * 0.0048 - i * 0.0006);
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
const EAR_CUT = 0.48;
// an ear in the head's frame: a cupped shell, edges curling forward round a hollow, thinning to the tip, tufts
// chiselled on its inner face (the statue's earD)
function makeEar(s, k, round = 0) {
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
    // far off the ear: a bound that grows with the distance, never a constant, or the ear would claim (and carry when it
    // swivels) any point on the body further than that constant from its own nearest piece
    if (v < -0.03 || v > L + 0.02 || Math.abs(u) > 0.075 || Math.abs(w) > 0.05) return Math.max(0.02, Math.hypot(u, v - L / 2, w) - L * 0.75);
    const t = clamp(v / L), outer = u * s > 0, half = halfAt(t, outer), cup = cupAt(u, t);
    // thick at the root, thin at the tip; the rim rolled and curled a little forward
    const rim = smooth(half - 0.007, half, Math.abs(u));
    const thick = 0.006 * (1 - 0.62 * t) + 0.0011 + 0.0013 * rim;
    let d = Math.abs(w - cup - 0.0014 * rim) - thick;
    d = smax(d, Math.abs(u) - half, 0.004);
    // the tip: a point at 0, a rounded end as `round` goes up (an American Shorthair's ears are rounded at the tips)
    d = smax(d, v - L, 0.009 + 0.022 * round);
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
    for (let i = 0; i < 36; i++) {
      const t = 0.03 + (i % 6) * 0.046 + Math.floor(i / 6) * 0.008, half = halfAt(t, false);
      const u = -s * half * (0.05 + 0.8 * ((i * 0.37) % 1)), v = t * L, w = cupAt(u, t) + 0.0012;
      const up = 0.95 - (i % 3) * 0.14, fwd = 0.35 + (i % 2) * 0.25, side = s * (0.08 + 0.1 * (i % 4));
      const l = 0.03 + 0.026 * ((i * 0.61) % 1);
      const p0 = [u, v, w], p1 = [u + side * l * 0.3, v + up * l * 0.36, w + fwd * l * 0.26], p2 = [u + side * l * 0.68, v + up * l * 0.72, w + fwd * l * 0.55 + 0.002], p3 = [u + side * l * 1.05, v + up * l * 0.95, w + fwd * l * 0.82 + 0.005];
      out.push([p0, p1, p2, p3].map((q) => toHead(q[0], q[1], q[2])));
    }
    return out;
  };
  // where the ear bends: the tip rides its own bone from here up (EAR_CUT of the way), so a flattened ear folds and its
  // tip can swing; `part` cuts the field to the root's piece or the tip's, overlapping a little so they join
  const mid = add(B, mul(a, L * EAR_CUT));
  const partField = (part) => (x, y, z) => {
    const d = field(x, y, z), v = local(x, y, z)[1];
    return part === 'tip' ? smax(d, L * (EAR_CUT - 0.08) - v, 0.003) : smax(d, v - L * (EAR_CUT + 0.08), 0.003);
  };
  return { B, field, partField, inner, L, at, pocket, tufts, mid, a };
}

// ── the rig ─────────────────────────────────────────────────────────────────────────────────────────
// Bones are named; each piece of the field belongs to one. Rest frames are all the world's axes, so a piece is
// written where it sits on the rest cat, and the bone's own map moves it.
export const TAIL_N = 12;
/**
 * The tail's radius at joint i (0 the root, TAIL_N the tip), sculpt units, for a cat's build. A short coat's tail
 * tapers from a thick root to a fine tip; a long coat's (`tailFluff` toward 1) is a plume, full for most of its length
 * and rounding off at the end, as the fur stands out from the bone. The fur shells can't carry it alone: past about
 * 1.2 cm they show their layers.
 */
export function tailRadius(build, i) {
  const f = Math.min(1, i / TAIL_N), fl = build?.tailFluff ?? 0;
  const lean = 0.027 - 0.016 * Math.pow(f, 1.2);
  const plume = 0.031 + 0.012 * Math.sin(Math.PI * Math.min(1, f * 1.15)) - 0.016 * smooth(0.72, 1, f);
  return lerp(lean, plume, fl) * (build?.tailW ?? 1);
}
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
  // A cat's head is big for it, about a quarter of its length nose to rump, and carried up and back on a short,
  // thick neck: the back of the skull nearly over the point of the chest
  const HS = 0.96 * b.head, HC = NK([0, Y(0.61), 0.335]);
  const head = bone('head', 'neck', NK([0, Y(0.565), 0.285]), 'head');
  const ears = [1, -1].map((s) => {
    const E = makeEar(s, b.ears, b.earRound ?? 0), root = bone(s > 0 ? 'earL' : 'earR', 'head', add(HC, mul(E.B, HS)), 'ear');
    return { s, E, bone: root, tip: bone(root.name + 't', root.name, add(HC, mul(E.mid, HS)), 'ear') };
  });
  // the tail hangs back from the root, a little down
  const TB = [0, Y(0.425), -0.33 * (b.length ?? 1)], TD = unit([0, -0.25, -1]), TL = 0.5 * b.tailLen / TAIL_N;
  const tail = [];
  for (let i = 0; i < TAIL_N; i++) tail.push(bone('tail' + i, i ? 'tail' + (i - 1) : 'pelvis', madd(TB, TD, TL * i), 'tail', { k: i }));
  // the legs: shoulder (or hip), elbow (stifle), wrist (hock), paw. Left on +X
  const legs = {};
  for (const key of LEGS) {
    const s = key[0] === 'L' ? 1 : -1, front = key[1] === 'F';
    // Set off a cat's skeleton standing (an engraving of the skeleton inside its outline; the Naturalis mount; see
    // docs/reference/bibliography.md). The fore: the shoulder joint
    // at the front of the chest, the humerus running down and back inside the body to the elbow at the bottom of the
    // ribs, the forearm straight down, the pastern sloping a little forward. The hind: the hip high at the back, the
    // femur long, running well forward and down to the stifle, high in the flank at the belly line; the tibia (longer)
    // back and down to a high hock; the long metatarsus upright under it.
    const J = front
      ? { A: [0.06, Y(0.365), 0.21], B: [0.054, 0.245 * ll, 0.14], C: [0.05, 0.072 * ll, 0.158], D: [0.05, 0.024, 0.19] }
      : { A: [0.072, Y(0.43), -0.24], B: [0.085, 0.285 * ll, -0.12], C: [0.072, 0.165 * ll, -0.29], D: [0.068, 0.024, -0.275] };
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
  // The body, after the living cat over its skeleton. The croup round over the pelvis, the points of the hips and of
  // the buttocks under it; the loin narrower than the ribs or the hips, a waist from above; the belly tucked up
  // behind the ribs and the pouch hanging under the loin. The rib cage deep and narrow in front, where the shoulder
  // blades lie flat on its sides, widening toward its back; the sternum a keel along its floor, its point between
  // the shoulders and no further forward than them.
  const hp = b.hips, ch = b.chest;
  P(pelvis, mkEllip([0, Y(0.425), -0.235], [0.088 * hp, 0.09, 0.1]), 0.05);
  for (const s of [1, -1]) {
    P(pelvis, mkEllip([s * 0.04 * hp, Y(0.47), -0.175], [0.034, 0.028, 0.05]), 0.03);          // the wing of the ilium
    P(pelvis, mkEllip([s * 0.036 * hp, Y(0.375), -0.315], [0.036, 0.042, 0.034]), 0.03);      // the point of the buttock
  }
  P(lumbar, mkEllip([0, Y(0.43), -0.09], [0.078 * hp, 0.075, 0.15]), 0.05);
  P(lumbar, mkEllip([0, Y(0.37 - 0.05 * (b.belly - 1)), -0.06], [0.086 * b.belly, 0.07 * b.belly, 0.13]), 0.05);
  P(lumbar, mkEllip([0, Y(0.315 - 0.055 * (b.pouch - 1)), -0.16], [0.06 * b.pouch, 0.045 * b.pouch, 0.09]), 0.04);
  // the flank folds: the skin from the belly out to each stifle, so the thigh's front runs into the belly
  for (const s of [1, -1]) P(lumbar, mkAxis([s * 0.062 * hp, Y(0.32), -0.13], [s * 0.3, -0.5, -0.4], [1, 0, 0], [0.06, 0.022, 0.045]), 0.05);
  P(chest, mkEllip([0, Y(0.395), 0.03], [0.098 * ch, 0.122, 0.12]), 0.05);                     // the ribs, widest behind
  P(chest, mkEllip([0, Y(0.39), 0.12], [0.07 * ch, 0.112, 0.09]), 0.05);                     // narrowing to the front
  P(chest, mkAxis([0, Y(0.29), 0.08], [0, -0.15, -1], [1, 0, 0], [0.115, 0.042 * ch, 0.03]), 0.05); // the keel
  P(chest, mkEllip([0, Y(0.335), 0.19], [0.042 * ch, 0.05, 0.032]), 0.04);                    // the point of the sternum
  P(chest, mkEllip([0, Y(0.495), 0.11], [0.038, 0.03, 0.07]), 0.04);                          // the withers
  // the shoulder blades flat on the thorax, running up and back from the shoulder joint to the withers, with the
  // muscle over and under each one's spine
  for (const s of [1, -1]) {
    const gl = [s * 0.06, Y(0.365), 0.21], top = [s * 0.042, Y(0.505), 0.125];
    P(chest, mkAxis(lerp3(gl, top, 0.52), sub(top, gl), [s, 0, 0], [0.085, 0.026, 0.046]), 0.03);
  }
  // the neck: deep and thick, its crest rising to the head, the throat falling straight into the point of the sternum
  P(neck, mkCone([0, Y(0.425), 0.19], NK([0, Y(0.575), 0.3]), 0.08 * b.neck, 0.068 * b.neck), 0.05);
  P(neck, mkEllip(NK([0, Y(0.465), 0.245]), [0.062 * b.neck, 0.07, 0.05]), 0.05);
  P(neck, mkAxis(NK([0, Y(0.515), 0.225]), [0, 0.55, 1], [1, 0, 0], [0.075, 0.052 * b.neck, 0.04]), 0.04);
  // the head, set on at HS
  const EK = eyeKit(look.eyes);
  const H = makeHead(b, EK);
  head.HC = HC; head.HS = HS;
  P(head, (x, y, z) => H.field((x - HC[0]) / HS, (y - HC[1]) / HS, (z - HC[2]) / HS) * HS, 0.028, { r: 0.13 * HS, c: HC });
  for (const { E, bone: eb, tip } of ears) {
    const root = E.partField('root'), end = E.partField('tip');
    P(eb, (x, y, z) => root((x - HC[0]) / HS, (y - HC[1]) / HS, (z - HC[2]) / HS) * HS, 0.012, { r: E.L * HS * 0.6 + 0.03, c: add(HC, mul(E.B, HS)) });
    P(tip, (x, y, z) => end((x - HC[0]) / HS, (y - HC[1]) / HS, (z - HC[2]) / HS) * HS, 0.002, { r: E.L * HS * 0.6 + 0.03, c: add(HC, mul(E.mid, HS)) });
  }
  // the tail, a tapered cone a bone
  const TR = (i) => tailRadius(b, i);
  for (let i = 0; i < TAIL_N; i++) P(tail[i], mkCone(tail[i].j, madd(tail[i].j, TD, TL), TR(i), TR(i + 1)), i ? 0.008 : 0.03);
  // The legs, muscle by muscle (after Reighard & Jennings, Anatomy of the Cat). Each muscle is an
  // ellipsoid laid along its bone; `bk` is the bone's back (caudal) side in the leg's own plane, `X` its outside.
  const bkOf = (d) => unit(cross([1, 0, 0], d));
  for (const key of LEGS) {
    const L = legs[key], { A, B, C, D } = L.J, s = L.s, X = [s, 0, 0];
    // a long coat's legs (`legFluff`, 0 to 1): the fur stands well out from them, more than the shells can carry, so
    // its volume is carved: the lower legs fuller, the paws a little broader
    const fl = b.legFluff ?? 0, lwL = lw * (1 + 0.3 * fl);
    const d1 = sub(B, A), d2 = sub(C, B), d3 = sub(D, C), b1 = bkOf(d1), b2 = bkOf(d2), b3 = bkOf(d3);
    const at = (P0, P1, t, bk, back, out = 0) => add(madd(lerp3(P0, P1, t), bk, back), [s * out, 0, 0]);
    if (L.front) {
      // the upper arm, all inside the body's outline: the humerus under the triceps, whose heads fill the angle between
      // the blade and the arm and run down to the point of the elbow; the biceps and brachialis in front; the point
      // of the shoulder at its head
      // (blended wide into the chest wall: under the skin and the coat the arm is a plane of the body, not a lump)
      P(L.upper, mkCone(A, B, 0.036 * lw, 0.028 * lw), 0.05);
      P(L.upper, mkAxis(at(A, B, 0.52, b1, 0.026, -0.01), d1, X, [0.085, 0.027 * lw, 0.041 * lw]), 0.06);
      P(L.upper, mkAxis(at(A, B, 0.16, b1, 0.048, -0.012), [0, -0.5, -1], X, [0.06, 0.024 * lw, 0.032]), 0.06);
      P(L.upper, mkAxis(at(A, B, 0.45, b1, -0.014, -0.008), d1, X, [0.065, 0.02 * lw, 0.02 * lw]), 0.045);
      P(L.upper, mkEllip(add(A, [-s * 0.004, 0.002, 0.008]), [0.026 * lw, 0.03, 0.026]), 0.05);
      // the forearm: the point of the elbow behind; the extensors over the front and outside of its upper two-thirds
      // and the flexors behind, both running down into tendons, so it narrows to a slender wrist
      P(L.lower, mkCone(B, C, 0.03 * lwL, 0.0195 * lwL), 0.016);
      P(L.lower, mkAxis(add(at(B, C, 0.02, b2, 0.015), [0, 0.008, 0]), d2, X, [0.024, 0.018 * lwL, 0.018]), 0.018);
      P(L.lower, mkAxis(at(B, C, 0.33, b2, -0.009, 0.004), d2, X, [0.085, 0.028 * lwL, 0.025 * lwL]), 0.016);
      P(L.lower, mkAxis(at(B, C, 0.27, b2, 0.013, -0.002), d2, X, [0.075, 0.025 * lwL, 0.024 * lwL]), 0.016);
      // the wrist: the carpus a little knob, the carpal pad behind it; the pastern sloping forward; the dewclaw
      // high on its inside
      P(L.meta, mkEllip(C, [0.0195 * lwL, 0.019, 0.02]), 0.014);
      P(L.meta, mkEllip(at(C, D, 0.05, b3, 0.017), [0.0085, 0.01, 0.0075]), 0.01);
      P(L.meta, mkCone(C, D, 0.0198 * lwL, 0.022 * lwL), 0.014);
      P(L.meta, mkAxis(at(C, D, 0.35, b3, 0.003, -0.017 * lwL), d3, X, [0.009, 0.005, 0.005]), 0.006);
      { const pf = mkPaw([D[0], 0.02, D[2] - 0.002], 0.037 * (0.6 + 0.4 * lw), lw * 1.1 * (1 + 0.1 * fl)); P(L.paw, pf, 0.014, { groove: pf.groove }); }
      // the feathering down the back of the forearm, longest at the elbow
      if (fl > 0) P(L.lower, mkAxis(at(B, C, 0.3, b2, 0.016 + 0.012 * fl), d2, X, [0.085, 0.02 * lwL, 0.012 + 0.014 * fl]), 0.02);
    } else {
      // the thigh: one broad, flat mass from the croup to the stifle, seen from the side, and narrow from behind. The
      // biceps femoris and the hamstrings make its long back edge, sweeping from the point of the buttock down to the
      // top of the calf; the quadriceps its front over the femur down to the kneecap; the gluteals its top
      // (the point of the buttock, where the biceps femoris and the hamstrings start, and the top of the calf behind
      // the stifle, where they end)
      const isch = [s * 0.04, Y(0.375), -0.31], shin = add(at(B, C, 0.12, b2, 0.02), [0, 0, 0]);
      P(L.upper, mkCone(A, B, 0.038 * lw, 0.028 * lw), 0.05);
      P(L.upper, mkAxis(add(lerp3(isch, B, 0.48), [s * 0.026 * hp, 0.012, 0]), sub(B, isch), X, [0.11, 0.035 * lw * hp, 0.055]), 0.055);
      P(L.upper, mkAxis(add(lerp3(isch, shin, 0.5), [s * 0.016, 0, -0.006]), sub(shin, isch), X, [0.085, 0.027 * lw * hp, 0.036]), 0.045);
      P(L.upper, mkAxis(at(A, B, 0.55, b1, -0.02, -0.002), d1, X, [0.09, 0.029 * lw * hp, 0.031]), 0.05);
      P(L.upper, mkAxis(add(at(A, B, 0.08, b1, 0.0, -0.006), [0, 0.01, -0.01]), [0, 0.15, -1], X, [0.068, 0.027 * hp, 0.045]), 0.055);
      P(L.upper, mkEllip(madd(B, unit(add(mul(b1, -1), [0, 0.2, 0])), 0.01), [0.022 * lw, 0.024, 0.02]), 0.025);
      // the gaskin: the calf (gastrocnemius) heavy behind the top of the tibia and running down into the Achilles
      // tendon, which stands off the bone to the point of the hock; the tibia's front lean
      // (under the coat the tendon and the bone are one flat blade from the calf to the heel, the skin webbed between)
      P(L.lower, mkCone(B, C, 0.032 * lwL, 0.019 * lwL), 0.022);
      P(L.lower, mkAxis(at(B, C, 0.3, b2, 0.024), d2, X, [0.085, 0.03 * lwL, 0.034 * lwL]), 0.024);
      P(L.lower, mkAxis(at(B, C, 0.28, b2, -0.01, 0.003), d2, X, [0.07, 0.024 * lwL, 0.019]), 0.018);
      P(L.lower, mkAxis(at(B, C, 0.68, b2, 0.017), d2, X, [0.08, 0.017 * lwL, 0.027]), 0.018);
      // the hock: the point of the heel (the calcaneus) behind and above the joint; the metatarsus long and lean
      P(L.meta, mkAxis(add(C, [0, 0.008, -0.02]), [0, 0.6, -1], X, [0.02, 0.015 * lwL, 0.016]), 0.01);
      P(L.meta, mkEllip(C, [0.02 * lwL, 0.021, 0.021]), 0.01);
      P(L.meta, mkAxis(lerp3(C, D, 0.5), d3, X, [len(d3) * 0.56, 0.0185 * lwL, 0.023 * lwL]), 0.012);
      { const pf = mkPaw([D[0], 0.019, D[2] - 0.004], 0.035 * (0.6 + 0.4 * lw), lw * (1 + 0.1 * fl)); P(L.paw, pf, 0.013, { groove: pf.groove }); }
      // the britches: a long coat hangs in a skirt behind the hind leg from the back of the thigh down past the calf,
      // and a tuft stands off the heel
      if (fl > 0) {
        P(L.lower, mkAxis(add(lerp3(B, C, 0.5), [0, -0.006, -0.026 - 0.014 * fl]), [0, -1, -0.3], X, [0.07 + 0.03 * fl, 0.024 * lwL, 0.02 + 0.016 * fl]), 0.03);
        P(L.meta, mkAxis(add(C, [0, 0.016, -0.026 - 0.008 * fl]), [0, 0.8, -1], X, [0.016 + 0.01 * fl, 0.013 * lwL, 0.012 + 0.006 * fl]), 0.024);
      }
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
      for (const p of bn.prims) {
        const f = p.f; p.f = (x, y, z) => f(x, y, z / bl) * k;
        if (p.groove) { const g = p.groove; p.groove = (x, y, z) => g(x, y, z / bl) * k; }
      }
    }
    const zs = (p) => { p[2] *= bl; };
    // (a leg's joints are its bones' own; the tail was laid from a base already moved)
    for (const bn of bones) if (bn.group !== 'ear' && bn.group !== 'tail') zs(bn.j);
    zs(HC);
    for (const { E, bone: eb, tip } of ears) {
      const j = add(HC, mul(E.B, HS)), m = add(HC, mul(E.mid, HS));
      eb.j[0] = j[0]; eb.j[1] = j[1]; eb.j[2] = j[2]; tip.j[0] = m[0]; tip.j[1] = m[1]; tip.j[2] = m[2];
    }
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
    root: { at: [0, 0.11, -0.18], rot: [-0.62, 0, 0] },
    spine: { lumbar: [-0.22, 0, 0], chest: [-0.2, 0, 0], neck: [0.85, 0, 0], head: [0.25, 0, 0] },
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
    spine: { lumbar: [0.0, 0, 0], chest: [0.06, 0, 0], neck: [-0.75, 0, 0], head: [0.68, 0, 0] },
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
    spine: { lumbar: [0.08, 1.2, 0.1], chest: [0.1, 1.15, 0.1], neck: [1.1, 0.85, 0.05], head: [0.5, 0.55, -0.35] },
    legs: {
      LF: { rel: true, paw: [0.05, R.Y(0.27), 0.22], fwd: unit([0, -0.3, 1]), up: P_UP, meta: unit([0, -0.25, -1]), pole: [0, 0.3, -1] },
      RF: { rel: true, paw: [-0.05, R.Y(0.27), 0.22], fwd: unit([0, -0.3, 1]), up: P_UP, meta: unit([0, -0.25, -1]), pole: [0, 0.3, -1] },
      LH: { rel: true, paw: [0.08, R.Y(0.27), 0.02], fwd: unit([0.2, 0, 1]), up: P_UP, meta: unit([0.05, 0, 1]), pole: [0.4, 0.5, 1] },
      RH: { rel: true, paw: [-0.06, R.Y(0.28), 0.02], fwd: unit([-0.2, 0, 1]), up: P_UP, meta: unit([-0.05, 0, 1]), pole: [-0.5, 0.4, 1] },
    },
    tail: [[0.05, 0.05, -0.27], [0.15, 0.035, -0.3], [0.25, 0.035, -0.26], [0.31, 0.04, -0.17], [0.3, 0.045, -0.08]],
  }),
};

// ── the ears' moods ─────────────────────────────────────────────────────────────────────────────────
// A cat's ear is moved by about thirty muscles and each one moves on its own; the ears are the plainest thing it says.
// The positions follow CatFACS, the cat facial action coding system (Caeiro, Burrows & Waller, 2017), whose ear
// actions are: forward (EAD101), together (the adductor, EAD102), flattened (EAD103), rotated so their backs face
// forward (EAD104) and down (EAD105); and Leyhausen's grid of offensive and defensive faces, where an angry cat's ears
// turn their backs to you and a frightened one's go flat and down. Each is per ear [lift, swivel, flatten], the rig's
// own sense: lift tips the ear forward over the face, swivel turns its opening back, flatten lays it out sideways.
// `earsFor` blends toward one; the ear tips fold with the flattening on their own bone, so flat reads as flat.
export const EAR_MOODS = {
  neutral: [[0, 0.15, 0.05], [0, 0.15, 0.05]],          // relaxed: upright, the openings a little outward
  forward: [[-0.12, -0.3, -0.06], [-0.12, -0.3, -0.06]], // EAD101: interested, alert, hunting, greeting
  together: [[-0.1, -0.35, -0.2], [-0.1, -0.35, -0.2]], // EAD102: pricked and pulled in, fixed on something
  airplane: [[0.08, 0.55, 0.85], [0.08, 0.55, 0.85]],   // EAD103 sideways: irritated, unsure, had enough of it
  flat: [[0.45, 0.55, 1.3], [0.45, 0.55, 1.3]],         // EAD103 + EAD105, flat back and down: frightened
  rotated: [[0.05, 1.3, 0.35], [0.05, 1.3, 0.35]],      // EAD104: the backs turned to you: angry, about to swat
  down: [[0.5, 0.25, 0.6], [0.5, 0.25, 0.6]],           // EAD105: drooped: low, unwell, or very drowsy
  sleepy: [[0.22, 0.35, 0.42], [0.22, 0.35, 0.42]],     // asleep: let go, gently out to the sides
  content: [[0.1, 0.3, 0.22], [0.1, 0.3, 0.22]],        // being stroked where he likes it: soft, a little back
  listening: [[-0.1, -0.25, 0], [0.05, 0.9, 0.1]],      // one ear to the front, the other turned to a sound behind
};
/** The ears for a mood, `k` of the way there (0..1), as mo.ears takes them. */
export function earsFor(mood, k = 1) {
  const m = EAR_MOODS[mood] || EAR_MOODS.neutral;
  return m.map((e) => e.map((x) => x * k));
}

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
    const lift = pe[0] + em[0], swivel = pe[1] + em[1], flat = pe[2] + em[2];
    X[ix[e.bone.name]] = childXf(X[ix.head], e.bone.j, [lift, e.s * swivel, -e.s * flat]);
    // the tip: the cartilage bends as well as turning at the root, so a flattened ear folds over and a pricked one
    // stands straight; `mo.earTips` is its own lag on top (a spring in gl/room-beasts.js: it swings as the head moves)
    const tt = (mo.earTips || [])[i] || [0, 0, 0];
    X[ix[e.tip.name]] = childXf(X[ix[e.bone.name]], e.tip.j, [0.3 * lift + Math.max(0, flat) * 0.25 + tt[0], e.s * (0.2 * swivel + tt[1]), -e.s * (0.55 * flat + tt[2])]);
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
    let pawP = rel ? apply(par, spec.paw) : spec.paw;
    const md = spec.meta ? unit(rv(spec.meta)) : M3.v(Rp, unit(sub(D, C)));
    let W = madd(pawP, md, -L.l3);
    // a paw asked for further than the leg reaches (a gallop's full stretch) falls short of its mark on a straight leg
    // rather than leaving the leg behind
    const far = len(sub(W, S)), most = (L.l1 + L.l2) * 0.995;
    if (far > most) { const W1 = madd(S, unit(sub(W, S)), most); pawP = add(pawP, sub(W1, W)); W = W1; }
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
  // the tail along its line (tailLine), or along `mo.tailPts` where its physics has moved it (gl/cat-tail.js): TAIL_N + 1
  // points in the ground frame from the root to the tip
  {
    const pts = mo.tailPts?.length === TAIL_N + 1 ? mo.tailPts : tailLine(R, X[ix.pelvis], pose, mo);
    let side = M3.v(X[ix.pelvis].R, [1, 0, 0]);
    for (let i = 0; i < TAIL_N; i++) {
      const d = sub(pts[i + 1], pts[i]);
      side = unit(sub(side, mul(unit(d), dot(side, unit(d)))));
      X[ix['tail' + i]] = aimXf(R.tail[i].j, R.TD, [1, 0, 0], pts[i], d, side);
    }
  }
  return X;
}
// The line the tail is laid along for a pose and the motion over it: TAIL_N + 1 points in the ground frame, from where
// the pelvis (its map `Xp`) has carried the root out to the tip. The sway and flick bend it. This is where the cat
// means its tail to be; its physics (gl/cat-tail.js) chases it.
function tailLine(R, Xp, pose, mo) {
  const base = apply(Xp, R.TB);
  // the tail's line is in the ground frame, or in the pelvis's rest frame with relTail
  const ctrl = [base, ...(pose.tail || []).map((q) => (pose.relTail ? apply(Xp, q) : q))];
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
  return pts;
}
/** The tail's line for a pose (a CAT_POSES entry or a clip's frame) and its motion: where the cat means it to be. */
export function tailTarget(R, poseFn, mo = STILL) {
  const pose = typeof poseFn === 'function' ? poseFn(R) : poseFn, pel = R.bones[R.index.pelvis], Rr = euler(pose.root.rot);
  return tailLine(R, { R: Rr, t: sub(pose.root.at, M3.v(Rr, pel.j)) }, pose, mo);
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
function coatAt(R, look, g, p, ear, rn = null) {
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
  if (g === 'paw' && p[1] < 0.01 && (!rn || rn[1] < -0.7)) return { c: toLin(co.pads), f: 0, m: MAT.MATTE };
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
  // the ruff starts behind the cheeks: carried round onto the jowls, its long shells stood out edge-on along the face
  else if (g === 'head') f = hq[2] > 0.03 ? fur.face : lerp(fur.face, fur.ruff, smooth(0.08, 0.12, Math.hypot(hq[0], hq[1] + 0.03)) * smooth(0.01, -0.04, hq[2]));
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
  // (the ball takes in a jowly head's cheeks, so the seam falls in the neck rather than across the face)
  const jw = Math.max(0, (look.build.jowls ?? 1) - 1) + Math.max(0, (look.build.cheeks ?? 1) - 1);
  const fH = o.faceH ?? H * 0.5, hc = apply(X[R.index.head], R.HC), fr = (0.19 + 0.06 * Math.min(1, jw)) * R.HS;
  const dFace = (c) => Math.hypot(c[0] - hc[0], c[1] - hc[1], c[2] - hc[2]);
  if (fH < H) {
    netsInto(field, lo, hi, H, verts, quads, (c) => dFace(c) > fr);
    const flo = hc.map((v, k) => Math.max(lo[k], v - fr - 3 * H)), fhi = hc.map((v, k) => Math.min(hi[k], v + fr + 3 * H));
    netsInto(field, flo, fhi, fH, verts, quads, (c) => dFace(c) <= fr + H * 0.5);
  } else netsInto(field, lo, hi, H, verts, quads, null);
  {
    const used = new Int32Array(verts.length).fill(-1), kept = [];
    for (const q of quads) for (let k = 0; k < 4; k++) { const v = q[k]; if (used[v] < 0) { used[v] = kept.length; kept.push(verts[v]); } q[k] = used[v]; }
    // (a loop, not push(...kept): 100k arguments overflow a worker's stack)
    verts.length = kept.length;
    for (let i = 0; i < kept.length; i++) verts[i] = kept[i];
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
    const ear = bn.group === 'ear' ? R.ears.find((x) => x.bone === bn || x.tip === bn) : null;
    // (the normal on the rest cat, for the pads: a paw's sole is the skin that faces the floor)
    const rn = M3.v(inv[own].Rt, nn);
    const ct = coatAt(R, look, bn.group, r0, ear, rn);
    if (bn.group === 'paw') {
      const gp = bn.prims.find((q) => q.groove);
      if (gp && r0[1] > 0.006) {
        const gk = smooth(0.0036, 0.0006, gp.groove(r0[0], r0[1], r0[2]));
        if (gk > 0) { ct.c = ct.c.map((v) => v * (1 - 0.6 * gk)); ct.f *= 1 - gk; }
      }
    }
    // the body's breath: the ribs and belly rise, the legs and head don't
    Bm[v] = k4.reduce((s, [w, i]) => s + (i === R.index.chest || i === R.index.lumbar ? w : 0), 0) / sw;
    // the crease's own shadow, two steps out along the normal
    let ao = 1;
    for (const hh of [0.004, 0.01, 0.02]) ao -= (Math.max(0, hh - F(p[0] + nn[0] * hh, p[1] + nn[1] * hh, p[2] + nn[2] * hh)) / hh) * 0.28;
    const faceAO = R.bones[own].group === 'head' || R.bones[own].group === 'ear' || R.bones[own].group === 'paw';
    ao = faceAO ? clamp(ao) * 0.42 + 0.58 : clamp(ao) * 0.22 + 0.78;
    Cv[v * 3] = ct.c[0] * ao; Cv[v * 3 + 1] = ct.c[1] * ao; Cv[v * 3 + 2] = ct.c[2] * ao;
    // no fur along the seam between the face's mesh and the body's: shells laid on an open edge fan out into a fringe
    // round the neck like a lace collar. The ruff either side of it carries the coat over the gap
    Fv[v] = fH < H ? ct.f * smooth(0.003, 0.012, Math.abs(dFace(p) - fr)) : ct.f; Mv[v] = ct.m;
  }
  const Q = new Uint32Array(quads.length * 4);
  quads.forEach((q, i) => { Q[i * 4] = q[0]; Q[i * 4 + 1] = q[1]; Q[i * 4 + 2] = q[2]; Q[i * 4 + 3] = q[3]; });
  return { look, rig: R, pose: poseFn, X, P: Pv, N: Nv, C: Cv, F: Fv, M: Mv, Wb, Ww, Bm, Rest, Q, verts: n, quads: quads.length, h: H };
}

// ── the eyes, the lids and the whiskers, built every frame on the head ─────────────────────────────────
// `want` picks which: the eyes (the iris, the pupil and the lights in it), the lids, the whiskers
function headBits(R, look, mo, push, headX, want = { eyes: true, lids: true, whiskers: true }) {
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
    if (want.eyes) {
    // Where the eye is looking (`mo.gaze`: [across, up, in], each -1..1): the iris fills the opening and runs on behind
    // the lids, so a turn of the eyeball shows as the pupil and the iris's pattern moving within it, the cornea's
    // lights staying put. `in` turns both eyes toward the nose, as they do on something close: a hand, a toy.
    const gz = mo.gaze || [0, 0, 0], RX = EK.rx * 0.97, RY = EK.ryT * 1.1, z0 = -0.0036 * es * sk, dome = 0.0055 * es;
    const px = clamp(gz[0] - s * (gz[2] || 0), -1, 1) * RX * 0.3, py = clamp(gz[1], -1, 1) * RY * 0.24;
    const surf = (x, y) => z0 + dome * Math.sqrt(Math.max(0, 1 - (x / RX) ** 2 - (y / RY) ** 2));
    const sd = (look.coat.seed ?? 1) * 7.31 + s * 1.7;
    // The iris, as a cat's is: paler and warmer in a jagged ring (the collarette) round the pupil, fine fibres running
    // out from it, darker pits (the crypts) through its middle, the colour deepening to a dark ring at its edge (the
    // limbus), and the upper lid's shadow across its top. Seeded by the coat, so two cats' irises differ.
    const inner = lerp3(iris, [1, 0.95, 0.72], 0.34), mid = iris, deep = lerp3(iris, ring, 0.55);
    lens(disc(RX, RY, 0, 0, z0, dome), (u, v) => {
      const t = u * Math.PI * 2, x = Math.cos(t) * RX * v, y = Math.sin(t) * RY * v;
      const dx = (x - px) / RX, dy = (y - py) / RY, rr = Math.hypot(dx, dy), an = Math.atan2(dy, dx);
      const coll = 0.4 + 0.045 * Math.sin(an * 9 + sd) + 0.03 * Math.sin(an * 17 + 2.1 * sd);
      let c = rr < coll ? lerp3(inner, mid, smooth(coll - 0.16, coll, rr)) : lerp3(mid, deep, smooth(coll + 0.05, 0.9, rr));
      // the collarette's own bright rim
      c = lerp3(c, lerp3(inner, [1, 1, 0.9], 0.2), 0.35 * Math.exp(-(((rr - coll) / 0.035) ** 2)));
      const fib = 1 + (0.07 * Math.sin(an * 47 + 3 * Math.sin(an * 9 + sd)) + 0.045 * Math.sin(an * 83 + sd)) * smooth(coll - 0.05, coll + 0.15, rr);
      const pit = fbm(Math.cos(an) * rr * 6 + sd, Math.sin(an) * rr * 6, sd * 0.3, 2) > 0.22 ? 0.8 : 1;
      const lim = 1 - 0.55 * smooth(0.82, 0.99, v), lid = 1 - 0.28 * smooth(0.25, 0.95, y / RY);
      return c.map((k) => k * fib * (rr > coll + 0.04 && rr < 0.86 ? pit : 1) * lim * lid);
    }, 96, 24, MAT.GLOSS, false);
    // the pupil: a slit pointed at both ends in bright light, opening to a full round dark in the dark or when it's
    // excited; it sits on the iris where the eye is looking
    const pw = lerp(0.0016, 0.0158, pupil) * es, ph = lerp(0.0118, 0.0128, pupil) * es * op, pe = 0.9 * (1 - pupil);
    lens((u, v) => {
      const t = u * Math.PI * 2, c = Math.cos(t), x = px + pw * v * Math.sign(c) * Math.pow(Math.abs(c), 1 + pe), y = py + 0.0003 * es + ph * v * Math.sin(t);
      return fromEye([x, y, surf(x, y) + 0.0002 * es + 0.0011 * es * Math.sqrt(Math.max(0, 1 - v * v))], s);
    }, () => black, 48, 8, MAT.GLOSS, true);
    // the lights on the cornea: a big soft one high on the near side, and a small one low on the far side, the light
    // off the floor. They're on the cornea, so they stay where they are when the eye turns
    const zt = z0 + dome;
    lens(disc(0.0036 * es, 0.0031 * es, s * -0.0058 * es, 0.0052 * es * op, zt + 0.0012 * es, 0.0005 * es), () => white, 20, 4, MAT.GLOSS, true);
    lens(disc(0.0012 * es, 0.001 * es, s * 0.0062 * es, -0.0058 * es * op, zt + 0.0006 * es, 0.0003 * es), () => [0.8, 0.82, 0.85], 12, 2, MAT.GLOSS, true);
    }
    // the upper lid coming down: a shell over the opening from the top to `lids` of the way down, the coat's colour,
    // with the lid's dark rim along its edge
    if (want.lids && lids > 0.02) {
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
    if (!want.whiskers) continue;
    // whiskers (the mystacial set): four rows across each pad, three to a row, the top rows longest, curving down and
    // back, fanned forward by `whiskers` (−1 laid back flat, +1 bristling forward to feel something)
    const wc = toLin(co.whisker), mz = look.build.muzzle, fan = (mo.whiskers || 0) * 0.5;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) {
      const root = [s * (0.016 + i * 0.0068 + j * 0.0012), -0.0335 + PY - j * 0.0048 - i * 0.0006, 0.084 * mz - i * 0.006 - j * 0.002];
      const dir = unit([s * 1, 0.28 - j * 0.16 + i * 0.02, -0.4 + fan + i * 0.06]);
      const L = (0.11 - j * 0.012 + 0.02 * Math.sin(i * 2.3 + j)) * (1 - 0.15 * i);
      const droop = 0.02 + j * 0.006;
      hair([root, add(madd(root, dir, L * 0.33), [0, 0.003, 0]), add(madd(root, dir, L * 0.68), [0, -droop * 0.35, -0.003]), add(madd(root, dir, L), [0, -droop, -0.009])], 0.0012, 0.0002, wc, push, toW, nW, { seg: 10 });
    }
    // over each eye (supraorbital)
    for (let i = 0; i < 2; i++) {
      const c = eyeC(s), root = [c[0] * (0.78 + i * 0.22), c[1] + 0.024 * es, c[2] - 0.006 - i * 0.006];
      const dir = unit([s * (0.75 + i * 0.2), 0.65, 0.35]);
      hair([root, madd(root, dir, 0.03), add(madd(root, dir, 0.062), [s * 0.016, -0.012, 0])], 0.0009, 0.00018, wc, push, toW, nW, { seg: 7 });
    }
    // on the chin (mandibular)
    {
      const root = [s * 0.008, -0.062, 0.066 * mz], dir = unit([s * 0.5, -0.6, 0.6]);
      hair([root, madd(root, dir, 0.014), add(madd(root, dir, 0.026), [0, -0.004, 0])], 0.0007, 0.00015, wc, push, toW, nW, { seg: 5 });
    }
  }
}
// A thin hair, uninked: a smooth curve through `pts` (Catmull-Rom, `seg` segments), tapering from r0 at the root to
// r1 at the tip, a little faster near the end, as a hair does. It's two ribbons crossed along its length, so it never
// goes edge-on to the eye and vanishes: from any side one of them faces you. The tip pales a little.
function hair(pts, r0, r1, col, push, toW, nW, o = {}) {
  const seg = o.seg ?? 6, n = pts.length - 1;
  const at = (u) => {
    const x = Math.min(n - 1e-6, u * n), i = Math.floor(x), f = x - i;
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)], f2 = f * f, f3 = f2 * f;
    return [0, 1, 2].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * f + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f3));
  };
  const P = [], tip = lerp3(col, [1, 1, 1], 0.25);
  for (let k = 0; k <= seg; k++) P.push(at(k / seg));
  const rad = (t) => r1 + (r0 - r1) * Math.pow(1 - t, 0.8);
  for (let i = 0; i < seg; i++) {
    const a = P[i], b = P[i + 1], d = unit(sub(b, a));
    let s1 = cross(d, [0, 0.3, 1]);
    if (len(s1) < 1e-6) s1 = cross(d, [1, 0, 0]);
    s1 = unit(s1);
    const s2 = unit(cross(d, s1)), ra = rad(i / seg), rb = rad((i + 1) / seg), c = lerp3(col, tip, (i + 0.5) / seg);
    for (const side of [s1, s2]) {
      const q = [madd(a, side, -ra), madd(a, side, ra), madd(b, side, rb), madd(b, side, -rb)];
      push(q.map(toW), nW(unit(cross(side, d))), c, MAT.MATTE, true, true);
    }
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
  // `o.pose` is a clip's frame (gl/cat-clips.js) carved from this bake: a groom off the sit, a walk off the stand
  const Xn = solveRig(R, o.pose || bake.pose, mo);
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
      for (const pts of ear.E.tufts()) hair(pts, 0.0018, 0.00025, fc, pushQ, toW, nW, { seg: 6 });
    }
  }
  if (o.fur !== false && look.fur.budget > 0) furShells(M, from, { budget: o.furBudget ?? look.fur.budget, step: 0.0014, max: 8, floor: 0.004 });
  return M;
}

// ── skinned on the GPU (gl/cat-gpu.js) ──────────────────────────────────────────────────────────────
/**
 * The eyes, lids, whiskers and ear tufts as they'd be on the bake's own pose, for the GPU: each quad carries the bone
 * it rides on (the head, or its ear), so the skinning carries it with the head as it turns. Sculpt units, not metres.
 * They change only with the lids, the pupil and the whiskers, so the room builds them again only when those do, and
 * each `part` alone ('eyes' with the pupil, 'lids', 'whiskers', 'tufts' never), so a blink rebuilds only the lids.
 */
export function catBits(bake, mo = STILL, part = null) {
  const R = bake.rig, look = bake.look, hb = R.index.head;
  const P = [], N = [], C = [], Mt = [], B = [];
  let bone = hb;
  const pushQ = (q, nn, col, mat, inkless, twoSided) => {
    const nm = inkless ? mul(nn, 0.05) : nn;
    for (const k of [0, 1, 2, 0, 2, 3]) { P.push(q[k][0], q[k][1], q[k][2]); N.push(nm[0], nm[1], nm[2]); C.push(col[0], col[1], col[2]); Mt.push(mat); B.push(bone); }
    if (twoSided) for (const k of [0, 2, 1, 0, 3, 2]) { P.push(q[k][0], q[k][1], q[k][2]); N.push(-nm[0], -nm[1], -nm[2]); C.push(col[0], col[1], col[2]); Mt.push(mat); B.push(bone); }
  };
  if (part !== 'tufts') headBits(R, look, mo, pushQ, bake.X[hb], part ? { [part]: true } : undefined);
  const fc = lerp3(toLin(look.coat.whiteCol), toLin(look.coat.earInner), 0.18);
  if (!part || part === 'tufts') for (const ear of R.ears) {
    bone = R.index[ear.bone.name];
    const eX = bake.X[bone];
    const toW = (q) => apply(eX, add(R.HC, mul(q, R.HS))), nW = (n) => unit(M3.v(eX.R, n));
    for (const pts of ear.E.tufts()) hair(pts, 0.0018, 0.00025, fc, pushQ, toW, nW, { seg: 6 });
  }
  return { P, N, C, M: Mt, B };
}
/**
 * Each bone's map for the GPU, as 3×4 rows into `out` (Float32Array, 12 a bone): from where it was on the bake's own
 * pose to where the pose and motion put it now (`Xn`, from solveRig), scaled to metres and placed in the room by
 * `place` ({ O: [x, y, z], F: [x, 0, z] unit, the way the cat faces }), as gl/beast-kit.js placeAt places a mesh.
 */
export function catBoneRows(bake, Xn, place, out = new Float32Array(bake.rig.bones.length * 12)) {
  const sc = bake.look.scale, F = place.F, Lx = [F[2], 0, -F[0]], O = place.O;
  // A: the model's x to the cat's left, y up, z forward, in metres
  const A = [Lx[0] * sc, 0, F[0] * sc, 0, sc, 0, Lx[2] * sc, 0, F[2] * sc];
  for (let i = 0; i < Xn.length; i++) {
    const R0t = M3.T(bake.X[i].R), Rm = M3.mul(Xn[i].R, R0t), t = sub(Xn[i].t, M3.v(Rm, bake.X[i].t));
    const AR = M3.mul(A, Rm), At = M3.v(A, t), o = i * 12;
    out[o] = AR[0]; out[o + 1] = AR[1]; out[o + 2] = AR[2]; out[o + 3] = At[0] + O[0];
    out[o + 4] = AR[3]; out[o + 5] = AR[4]; out[o + 6] = AR[5]; out[o + 7] = At[1] + O[1];
    out[o + 8] = AR[6]; out[o + 9] = AR[7]; out[o + 10] = AR[8]; out[o + 11] = At[2] + O[2];
  }
  return out;
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
