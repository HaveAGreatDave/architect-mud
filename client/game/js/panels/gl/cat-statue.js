// ROOM · THE CAT STATUE. Scrappy, carved: Statuario white where his coat is white, Nero Marquina black
// where it's black, sat on the pedestal the 'catstatue' form in room-decor.js draws, which then calls
// drawCatStatue for him. The target is the design sheet's front view of him: a tall, upright sit, a small
// wedge of a head on a long neck, round black haunches, the tail round the front of his paws, clean
// polished stone, and the comic look's ink round him and round his eyes.
//
// He's carved, not assembled. The whole figure is one signed distance field: ellipsoids and tapered limbs
// joined by smooth unions, so the haunch runs into the flank and the neck into the skull the way they do
// in stone, with the details cut into it (eye sockets and lids, the nostrils, the mouth line and the cleft
// over it, the grooves between the toes, the hollows of the ears, tufted fur on the chest).
// The field is meshed once a page by surface nets on a 3 mm grid, only in a band round the surface, into
// about 220k triangles, each corner with the field's own normal. Each vertex is painted where it stands:
// the coat (one map over the body, one over the head), the marble's veins and clouds, and the field's own
// occlusion, soft in every crease. A small tiling grain texture (paintCatGrain) adds a crystalline speckle.
//
// The eyes are drawn the comic way in stone: lids inked black, a pale grey iris darkening to its edge, a
// big dark pupil and a white catchlight, set into carved sockets under the lids, the upper lid heavier. The
// nose leather, moustache and chin dot, the cap and the patch over his left eye follow the photo of him.
//
// Frame: x across (the piece frame mirrors x, so seen from the front his left, the viewer's right, is -x),
// y up from the pedestal top, z out of his front. Pure: batches through the room kit, no GL.

import { MAT } from './ballpark-mesh.js';

const { GLOSS } = MAT;
export const CAT_GRAIN = 'roomCatGrain';
const H = 0.003;       // the mesh's grid, metres
const GRAIN = 0.15;    // metres per repeat of the grain texture

// ── vectors ─────────────────────────────────────────────────────────────────────────────────────
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
// yaw about y (+ swings the front toward +x), then pitch about x (+ tips the top forward), then roll about
// z (+ tips the top toward +x); turnInv undoes it
const turn = (p, pitch = 0, roll = 0, yaw = 0) => {
  let [x, y, z] = p;
  if (yaw) { const c = Math.cos(yaw), s = Math.sin(yaw); [x, z] = [x * c + z * s, -x * s + z * c]; }
  if (pitch) { const c = Math.cos(pitch), s = Math.sin(pitch); [y, z] = [y * c - z * s, y * s + z * c]; }
  if (roll) { const c = Math.cos(roll), s = Math.sin(roll); [x, y] = [x * c + y * s, -x * s + y * c]; }
  return [x, y, z];
};
const turnInv = (p, pitch = 0, roll = 0, yaw = 0) => {
  let [x, y, z] = p;
  if (roll) { const c = Math.cos(roll), s = Math.sin(roll); [x, y] = [x * c - y * s, x * s + y * c]; }
  if (pitch) { const c = Math.cos(pitch), s = Math.sin(pitch); [y, z] = [y * c + z * s, -y * s + z * c]; }
  if (yaw) { const c = Math.cos(yaw), s = Math.sin(yaw); [x, z] = [x * c - z * s, x * s + z * c]; }
  return [x, y, z];
};

// ── noise ───────────────────────────────────────────────────────────────────────────────────────
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
const fbm = (x, y, z, o = 4) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * noise(x * f, y * f, z * f); a *= 0.5; f *= 2.1; } return s; };

// ── the field ───────────────────────────────────────────────────────────────────────────────────
// Inigo Quilez's distance estimates, compiled once into functions of plain numbers (the field is sampled a
// few million times, so nothing in it allocates): an ellipsoid turned by [pitch, roll, yaw], a cone with
// rounded ends of radius r1 at a and r2 at b, and the polynomial smooth min and max
const frameOf = (pitch = 0, roll = 0, yaw = 0) => [turnInv([1, 0, 0], pitch, roll, yaw), turnInv([0, 1, 0], pitch, roll, yaw), turnInv([0, 0, 1], pitch, roll, yaw)];
function mkEllip(c, r, rot) {
  const [cx, cy, cz] = c, ix = 1 / r[0], iy = 1 / r[1], iz = 1 / r[2], jx = ix * ix, jy = iy * iy, jz = iz * iz, lo = -Math.min(r[0], r[1], r[2]);
  if (!rot) return (x, y, z) => {
    const qx = x - cx, qy = y - cy, qz = z - cz, k0 = Math.sqrt(qx * qx * jx + qy * qy * jy + qz * qz * jz), k1 = Math.sqrt(qx * qx * jx * jx + qy * qy * jy * jy + qz * qz * jz * jz);
    return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : lo;
  };
  const [a, b, d] = frameOf(rot[0], rot[1], rot[2]);
  return (x, y, z) => {
    const dx = x - cx, dy = y - cy, dz = z - cz;
    const qx = dx * a[0] + dy * b[0] + dz * d[0], qy = dx * a[1] + dy * b[1] + dz * d[1], qz = dx * a[2] + dy * b[2] + dz * d[2];
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
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// the pose: the head chin up a touch and tipped a little to his left, as in the photo
// and the head smaller than the body around it, so the neck reads long, as on the design sheet
const HC = [0, 0.495, 0.08], HP = -0.12, HR = 0.06, HS = 0.84, HM = frameOf(HP, HR, 0);
const fromHead = (q) => add(HC, turn(mul(q, HS), HP, HR));
// each eye's own frame in the head: x across the eye, y up it, z out; s is the side (+1 his right)
const EYE_ROLL = 0.2, EYE_YAW = 0.3;
const eyeC = (s) => [s * 0.043, 0.012, 0.064];
const EM = [-1, 1].map((s) => ({ s, c: eyeC(s), m: frameOf(0, -s * EYE_ROLL, s * EYE_YAW) }));
const fromEye = (e, s) => add(eyeC(s), turn(e, 0, -s * EYE_ROLL, s * EYE_YAW));
// each ear's frame in the head: u across, v up its length, w out of its front
const EAR = [-1, 1].map((s) => {
  const B = [s * 0.054, 0.05, -0.014], T = [s * 0.1, 0.166, -0.024], a = unit(sub(T, B));
  const f0 = unit([s * 0.42, 0.05, 1]), f = unit(sub(f0, mul(a, dot(f0, a)))), e = cross(a, f);
  return { s, B, L: Math.hypot(...sub(T, B)), a, f, e };
});
// the tail's spine: out from under the hips, round his right side, the tip across the front of the paws
const TAIL = [], TR = [];
for (let i = 0; i <= 16; i++) {
  const t = i / 16, a = -Math.PI * 0.55 + t * Math.PI * 1.0;
  TAIL.push([Math.cos(a) * (0.19 - t * 0.04), 0.022 + Math.sin(t * Math.PI) * 0.01 + (1 - t) * 0.02, Math.sin(a) * 0.16 - 0.03 + t * 0.07]);
  TR.push(0.026 - t * 0.017);
}
// each segment with a bounding sphere, so a point far from it doesn't pay for the cone
const TAIL_C = TAIL.slice(1).map((b, i) => { const a = TAIL[i], m = mul(add(a, b), 0.5), r = Math.hypot(...sub(b, a)) / 2 + TR[i] + 0.012; return { f: mkCone(a, b, TR[i], TR[i + 1]), m, r2: r * r }; });
function tailD(x, y, z) {
  if (y > 0.09) return y - 0.06;
  let d = 1;
  for (const c of TAIL_C) {
    const dx = x - c.m[0], dy = y - c.m[1], dz = z - c.m[2], q = dx * dx + dy * dy + dz * dz;
    d = smin(d, q < c.r2 ? c.f(x, y, z) : Math.sqrt(q) - Math.sqrt(c.r2) + 0.012, 0.006);
  }
  return d;
}
// a paw: the palm, four toes, the grooves between them cut in
function mkPaw(c, len) {
  const palm = mkEllip(c, [0.027, 0.018, len]);
  const toes = [-1.5, -0.5, 0.5, 1.5].map((t) => mkEllip([c[0] + t * 0.0088, c[1] - 0.002, c[2] + len * 0.75 - Math.abs(t) * 0.005], [0.0078, 0.011, 0.0095]));
  const cuts = [-1, 0, 1].map((t) => mkCone([c[0] + t * 0.0088, c[1] + 0.016, c[2] + len * 0.45], [c[0] + t * 0.0088, c[1] - 0.004, c[2] + len * 1.05], 0.0013, 0.0013));
  return (x, y, z) => {
    // far from the paw, a bound is enough
    const dx = x - c[0], dy = y - c[1], dz = z - c[2] - len * 0.3, q = dx * dx + dy * dy + dz * dz;
    if (q > 0.0036) return Math.sqrt(q) - 0.05;
    let d = palm(x, y, z);
    for (const t of toes) d = smin(d, t(x, y, z), 0.003);
    for (const k of cuts) d = smax(d, -k(x, y, z), 0.0015);
    return d;
  };
}
// the body without the tail, in the figure's frame, each part with how hard it blends into what's built
const HIPS = mkEllip([0, 0.12, -0.075], [0.15, 0.12, 0.135]), BELLY = mkEllip([0, 0.1, -0.01], [0.09, 0.075, 0.08]);
const THIGHS = [-1, 1].map((s) => mkEllip([s * 0.112, 0.108, -0.025], [0.07, 0.102, 0.115], [-0.2, 0, s * 0.12]));
const RIBS = mkEllip([0, 0.25, -0.015], [0.108, 0.17, 0.112], [0.5, 0, 0]), CHEST = mkEllip([0, 0.275, 0.05], [0.082, 0.105, 0.068], [0.3, 0, 0]);
const BLADES = [-1, 1].map((s) => mkEllip([s * 0.05, 0.355, -0.015], [0.034, 0.055, 0.05], [0.6, 0, 0]));
const NECK = mkCone([0, 0.33, 0.015], [0, 0.43, 0.075], 0.075, 0.058);
const ARMS = [-1, 1].map((s) => [mkCone([s * 0.06, 0.32, 0.035], [s * 0.053, 0.205, 0.055], 0.04, 0.029), mkCone([s * 0.053, 0.205, 0.055], [s * 0.048, 0.04, 0.104], 0.027, 0.019), mkPaw([s * 0.048, 0.019, 0.122], 0.033)]);
const LEGS = [-1, 1].map((s) => [mkCone([s * 0.113, 0.03, -0.035], [s * 0.113, 0.02, 0.07], 0.024, 0.021), mkPaw([s * 0.113, 0.017, 0.088], 0.03)]);
function bodyD(x, y, z) {
  let d = HIPS(x, y, z);
  d = smin(d, BELLY(x, y, z), 0.04);
  for (const t of THIGHS) d = smin(d, t(x, y, z), 0.035);
  d = smin(d, RIBS(x, y, z), 0.05);
  d = smin(d, CHEST(x, y, z), 0.03);
  for (const b of BLADES) d = smin(d, b(x, y, z), 0.025);
  d = smin(d, NECK(x, y, z), 0.04);
  if (y < 0.36 && z > -0.02) for (const [up, fore, paw] of ARMS) {
    d = smin(d, up(x, y, z), 0.03);
    d = smin(d, fore(x, y, z), 0.012);
    if (y < 0.06) d = smin(d, paw(x, y, z), 0.01);
  }
  if (y < 0.07) for (const [heel, paw] of LEGS) { d = smin(d, heel(x, y, z), 0.016); d = smin(d, paw(x, y, z), 0.008); }
  // fur combed down the chest, chiselled: shallow grooves wandering a little
  if (z > 0.06 && y > 0.22 && y < 0.44 && Math.abs(x) < 0.08) {
    const m = smooth(0.06, 0.1, z) * smooth(0.22, 0.27, y) * (1 - smooth(0.39, 0.44, y)) * (1 - smooth(0.05, 0.08, Math.abs(x)));
    // tufts: a groove's line wanders and breaks, and the depth comes and goes in locks
    const lock = 0.5 + 0.5 * noise(x * 60, y * 25, z * 60);
    if (m > 0) d += 0.0005 * m * lock * Math.sin(x * 480 + 7 * noise(x * 22, y * 9, z * 22) + y * 40 * noise(x * 15 + 3, y * 6, 0));
  }
  return d;
}
// an ear, in the head's frame: a cupped shell, the edges curling forward round a hollow, thinning to the
// tip, tufts chiselled on its inner face
function earD(x, y, z, E) {
  const rx = x - E.B[0], ry = y - E.B[1], rz = z - E.B[2];
  const u = rx * E.e[0] + ry * E.e[1] + rz * E.e[2], v = rx * E.a[0] + ry * E.a[1] + rz * E.a[2], w = rx * E.f[0] + ry * E.f[1] + rz * E.f[2];
  if (v < -0.03 || v > E.L + 0.02 || Math.abs(u) > 0.07 || Math.abs(w) > 0.05) return 0.02;
  const t = Math.min(1, Math.max(0, v / E.L)), half = 0.05 * Math.pow(1 - t, 0.85) + 0.002;
  const mid = 14 * u * u - 0.004, thick = 0.0055 * (1 - 0.55 * t) + 0.0012;
  let d = Math.abs(w - mid) - thick;
  d = smax(d, Math.abs(u) - half, 0.005);
  d = smax(d, v - E.L, 0.006);
  d = smax(d, -v - 0.025, 0.006);
  if (w > mid && Math.abs(u) < half - 0.006) d += 0.0006 * Math.sin(Math.atan2(u, v + 0.03) * 34) * smooth(0.1, 0.3, t) * (1 - smooth(0.75, 0.95, t));
  return d;
}
// the lids: a rounded ridge round an almond opening, the upper lid heavier and a little lower, so he looks up
function lidD(ex, ey, ez) {
  const top = ey > 0, ry = top ? 0.0128 : 0.0145, ring = Math.hypot(ex / 0.0215, ey / ry);
  const th = top ? 0.0026 + 0.001 * smooth(0.6, 0, Math.abs(ex) / 0.0215) : 0.0017;
  return Math.hypot((ring - 1) * ry, ez - 0.0006) - th;
}
const SOCKET = mkEllip([0, 0, 0.006], [0.024, 0.0165, 0.011]);
const CRANIUM = mkEllip([0, 0.012, -0.01], [0.088, 0.072, 0.083]), CHEEKS = mkEllip([0, -0.012, 0], [0.104, 0.056, 0.07]);
const RUFFS = [-1, 1].map((s) => mkEllip([s * 0.082, -0.03, -0.012], [0.032, 0.04, 0.045]));
const BRIDGE = mkEllip([0, -0.002, 0.05], [0.03, 0.036, 0.026], [0.6, 0, 0]), MUZZLE = mkEllip([0, -0.036, 0.058], [0.04, 0.029, 0.032]);
const PADS = [-1, 1].map((s) => mkEllip([s * 0.018, -0.04, 0.073], [0.021, 0.017, 0.018]));
const CHIN = mkEllip([0, -0.061, 0.054], [0.016, 0.011, 0.015]), NOSE = mkEllip([0, -0.017, 0.085], [0.012, 0.0075, 0.008], [0.35, 0, 0]);
const NOSTRILS = [-1, 1].map((s) => mkEllip([s * 0.005, -0.021, 0.091], [0.0034, 0.0026, 0.004]));
const CLEFT = mkCone([0, -0.025, 0.091], [0, -0.039, 0.089], 0.0013, 0.0013);
const MOUTH = [-1, 1].map((s) => mkCone([0, -0.04, 0.088], [s * 0.032, -0.053, 0.066], 0.0013, 0.001));
// the head, in its own frame
function headD(x, y, z) {
  let d = CRANIUM(x, y, z);
  d = smin(d, CHEEKS(x, y, z), 0.03);
  for (const r of RUFFS) d = smin(d, r(x, y, z), 0.025);
  d = smin(d, BRIDGE(x, y, z), 0.02);
  d = smin(d, MUZZLE(x, y, z), 0.015);
  for (const p of PADS) d = smin(d, p(x, y, z), 0.008);
  d = smin(d, CHIN(x, y, z), 0.01);
  d = smin(d, NOSE(x, y, z), 0.004);
  if (y > 0.02) for (const E of EAR) d = smin(d, earD(x, y, z, E), 0.012);
  // the eyes: the socket cut, the lids raised round it
  for (const { s, c, m } of EM) {
    const dx = x - c[0], dy = y - c[1], dz = z - c[2];
    if (dx * dx + dy * dy + dz * dz > 0.0016) continue;
    const [a, b, f] = m, ex = dx * a[0] + dy * b[0] + dz * f[0], ey = dx * a[1] + dy * b[1] + dz * f[1], ez = dx * a[2] + dy * b[2] + dz * f[2];
    d = smax(d, -SOCKET(ex, ey, ez), 0.003);
    d = smin(d, lidD(ex, ey, ez), 0.0025);
  }
  // the muzzle's cuts: nostrils, the cleft down from the nose, the mouth line
  if (x * x + (y + 0.04) ** 2 + (z - 0.075) ** 2 < 0.0025) {
    for (const n of NOSTRILS) d = smax(d, -n(x, y, z), 0.0015);
    d = smax(d, -CLEFT(x, y, z), 0.0015);
    for (const mo of MOUTH) d = smax(d, -mo(x, y, z), 0.0015);
  }
  return d;
}
// a point in the head's frame (the head is modelled at full size and set on at HS of it)
const headAt = (x, y, z) => {
  const dx = x - HC[0], dy = y - HC[1], dz = z - HC[2], [a, b, c] = HM;
  return [(dx * a[0] + dy * b[0] + dz * c[0]) / HS, (dx * a[1] + dy * b[1] + dz * c[1]) / HS, (dx * a[2] + dy * b[2] + dz * c[2]) / HS];
};
const headDist = (x, y, z) => { const q = headAt(x, y, z); return headD(q[0], q[1], q[2]) * HS; };
// the whole figure: body and tail, the head blended on at the neck
function catD(x, y, z) {
  const d = smin(bodyD(x, y, z), tailD(x, y, z), 0.02);
  const dx = x - HC[0], dy = y - HC[1], dz = z - HC[2], r2 = dx * dx + dy * dy + dz * dz;
  return smin(d, r2 < 0.04 ? headDist(x, y, z) : Math.sqrt(r2) - 0.15, 0.028);
}

// ── the coat ────────────────────────────────────────────────────────────────────────────────────
// a little lumpiness for the edges of the patches, so no boundary is a ruled line
const wob = (p, s = 1) => 0.005 * s * (Math.sin(p[0] * 27 + p[1] * 11) + Math.sin(p[1] * 21 - p[2] * 17) + Math.sin(p[2] * 23 + p[0] * 9));
// After the design sheet: white over the whole front and most of the flanks; black over the back, both
// haunches (a round black dome each side) and the tail; a black patch on each shoulder, the one on his right
// running down his side, and a couple of spots below the one on his left
function bodyCoat(p) {
  const [x, y, z] = p, w = wob(p);
  if (y < 0.05 + w) return 'W'; // the feet
  if (z < -0.055 + w + Math.max(0, y - 0.3) * 0.25) return 'B'; // the back
  // the haunches: the outer face of each folded thigh
  if (Math.abs(x) > 0.07 + w && y < 0.21 + w && THIGHS.some((t) => t(x, y, z) < 0.012 + w)) return 'B';
  if (((x - 0.098) / 0.06) ** 2 + ((y - 0.29) / 0.085) ** 2 + ((z - 0.0) / 0.08) ** 2 < 1 + w * 15) return 'B'; // his right shoulder and side
  if (((x + 0.1) / 0.05) ** 2 + ((y - 0.32) / 0.055) ** 2 + ((z - 0.01) / 0.07) ** 2 < 1 + w * 15) return 'B'; // his left shoulder
  for (const [cx, cy, cz, r] of [[-0.088, 0.235, 0.045, 0.022], [-0.079, 0.195, 0.07, 0.016]]) if (Math.hypot(x - cx, y - cy, z - cz) < r + w * 0.5) return 'B';
  return 'W';
}
function headCoat(q) {
  const [x, y, z] = q, w = wob(q, 0.6);
  // the nose leather, black; the moustache: two lobes off the cleft, joined under the nose; the dot on the chin
  if (z > 0.06) {
    if (Math.abs(x) < 0.013 - (y + 0.012) * -0.35 && y < -0.01 && y > -0.026 && z > 0.08) return 'B';
    const lobe = (cx) => ((x - cx) / 0.025) ** 2 + ((y + 0.047) / 0.013) ** 2 < 1;
    if (lobe(-0.017) || lobe(0.017) || (Math.abs(x) < 0.01 && y < -0.03 && y > -0.05)) return 'B';
    if (Math.hypot(x, y + 0.075) < 0.009) return 'B';
  }
  // the patch over his left eye, running out to the side of the head and back up into the cap
  // (two soft ovals, so its edge curves round the eye and down the cheek, never a ruled line)
  if (((x + 0.06) / 0.05) ** 2 + ((y - 0.022) / 0.042) ** 2 < 1 + w * 20) return 'B';
  if (((x + 0.088) / 0.04) ** 2 + ((y - 0.03) / 0.055) ** 2 < 1 + w * 20) return 'B';
  // the back of the head and the cap over the crown, with the white blaze up the forehead
  if (z < -0.035 + w && y > -0.06) return 'B';
  if (y > 0.045 + w) {
    const blaze = 0.026 + Math.max(0, 0.1 - y) * 0.35;
    if (z > 0.02 && Math.abs(x) < blaze + w) return 'W';
    if (y > 0.06 || z < 0.04) return 'B';
  }
  return 'W';
}
// which stone a point on the surface is cut from
// (with the coat map that decided it, so a vertex can sample round itself)
function toneAt(p) {
  const [x, y, z] = p;
  const near = (x - HC[0]) ** 2 + (y - HC[1]) ** 2 + (z - HC[2]) ** 2 < 0.04, q = headAt(x, y, z);
  const dh = near ? headD(q[0], q[1], q[2]) * HS : 1, db = bodyD(x, y, z), dt = tailD(x, y, z);
  if (dt < Math.min(dh, db) + 0.002) return ['B'];
  if (dh < db) {
    // the lids inked black, as the comic look draws an eye
    for (const { c, m } of EM) {
      const dx = q[0] - c[0], dy = q[1] - c[1], dz = q[2] - c[2];
      if (dx * dx + dy * dy + dz * dz > 0.0016) continue;
      const [a, b, f] = m;
      if (lidD(dx * a[0] + dy * b[0] + dz * f[0], dx * a[1] + dy * b[1] + dz * f[1], dx * a[2] + dy * b[2] + dz * f[2]) < 0.0016) return ['B'];
    }
    // the inside of each ear is pale, the rim and back black
    for (const E of EAR) {
      const r = sub(q, E.B), u = dot(r, E.e), v = dot(r, E.a), w = dot(r, E.f);
      const t = Math.min(1, Math.max(0, v / E.L)), half = 0.05 * Math.pow(1 - t, 0.85);
      if (v > 0 && v < E.L && Math.abs(w) < 0.03 && w > 14 * u * u - 0.004 && Math.abs(u) < half - 0.007) return ['W'];
    }
    return [headCoat(q), (pp) => headCoat(headAt(pp[0], pp[1], pp[2]))];
  }
  return [bodyCoat(p), bodyCoat];
}

// ── the stone ───────────────────────────────────────────────────────────────────────────────────
// a vein is where a warped band crosses zero: the main vein runs on a slant through the block, the way it
// was quarried, with fainter threads off it, soft clouds and a halo of grey bleeding either side
function marble(p) {
  const [x, y, z] = p, warp = fbm(x * 7, y * 7, z * 7, 3) * 2.6;
  const main = Math.abs(Math.sin((x * 0.8 + y * 1.4 - z * 0.5) * 11 + warp * 2.8));
  const thread = Math.abs(Math.sin((x * -1.1 + y * 0.4 + z * 1.2) * 22 + fbm(x * 13 + 5, y * 13, z * 13, 3) * 6));
  return {
    vein: Math.max(Math.max(0, 1 - main / 0.1), 0.5 * Math.max(0, 1 - thread / 0.06)),
    main: Math.max(0, 1 - main / 0.12), thin: Math.max(Math.max(0, 1 - main / 0.045), 0.6 * Math.max(0, 1 - thread / 0.03)), halo: Math.max(0, 1 - main / 0.35) * 0.35,
    cloud: fbm(x * 3 + 11, y * 3, z * 3, 2),
  };
}
const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// Statuario: bright white, soft grey clouds, grey veins sweeping through it. Nero Marquina: deep black with
// bold white veins. Clean and polished, as on the design sheet
const W_GROUND = hexRGB('#f3f1ec'), W_CLOUD = hexRGB('#dddbd6'), W_VEIN = hexRGB('#9a9894');
const B_GROUND = hexRGB('#111113'), B_CLOUD = hexRGB('#26252a'), B_VEIN = hexRGB('#e8e4dc');
function stoneRGB(tone, p) {
  const m = marble(p);
  if (tone === 'B') {
    const c = lerp3(B_GROUND, B_CLOUD, Math.max(0, m.cloud) * 0.9);
    return lerp3(c, B_VEIN, m.thin * 0.9);
  }
  const c = lerp3(W_GROUND, W_CLOUD, Math.max(0, m.cloud) * 0.6 + m.halo * 0.6);
  return lerp3(c, W_VEIN, m.vein * 0.5);
}
const toLinear = (c) => c.map((v) => Math.pow(Math.max(0, v), 2.2));

// ── the mesh ────────────────────────────────────────────────────────────────────────────────────
const gradAt = (x, y, z, e = 0.0005) => {
  const a = catD(x + e, y - e, z - e), b = catD(x - e, y - e, z + e), c = catD(x - e, y + e, z - e), d = catD(x + e, y + e, z + e);
  return [a - b - c + d, -a - b + c + d, -a + b - c + d];
};
// occlusion from the field itself: how far the surface closes in over a point, two steps out along its normal
const occlusion = (p, n) => {
  let ao = 1;
  for (const h of [0.005, 0.016]) ao -= (Math.max(0, h - catD(p[0] + n[0] * h, p[1] + n[1] * h, p[2] + n[2] * h)) / h) * 0.4;
  return Math.max(0, ao);
};
// a vertex: where it is, its normal, its colour (linear)
const AA = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((o) => mul(o, H * 0.6));
const vertexAt = (p, n) => {
  const [t, coat] = toneAt(p), ao = occlusion(p, n);
  // where the coat changes within a cell, the two stones mixed by how much of the cell is black
  let rgb = stoneRGB(t, p);
  if (coat) {
    const f = (AA.reduce((k, o) => k + (coat(add(p, o)) === 'B' ? 1 : 0), 0) + (t === 'B' ? 1 : 0)) / 7;
    if (f > 0 && f < 1) rgb = lerp3(stoneRGB('W', p), stoneRGB('B', p), f);
  }
  const c = toLinear(rgb).map((v) => v * (0.6 + 0.45 * ao));
  return { p, n, c };
};
// Surface nets over the field, only in the cells near its surface: a coarse grid finds the band, the fine
// grid inside it is sampled once per corner, each cell the surface crosses gets one vertex (the mean of where its
// edges cross), and each crossed edge a quad of the four cells round
// it. Built once a page.
let MESH = null;
function catMesh() {
  if (MESH) return MESH;
  const O = [-0.31, -0.006, -0.27], NX = Math.ceil(0.6 / H), NY = Math.ceil(0.72 / H), NZ = Math.ceil(0.55 / H), C = 4;
  const key = (i, j, k) => (i * 1024 + j) * 1024 + k;
  // the field's samples, kept in blocks of C^3 made as the band reaches them
  const BX = Math.ceil(NX / C) + 2, BY = Math.ceil(NY / C) + 2, BZ = Math.ceil(NZ / C) + 2, blocks = new Array(BX * BY * BZ);
  const F = (i, j, k) => {
    const bi = (i / C) | 0, bj = (j / C) | 0, bk = (k / C) | 0, b = (bi * BY + bj) * BZ + bk;
    let blk = blocks[b];
    if (!blk) { blk = new Float32Array(C * C * C).fill(NaN); blocks[b] = blk; }
    const o = ((i - bi * C) * C + (j - bj * C)) * C + (k - bk * C);
    let d = blk[o];
    if (d !== d) { d = catD(O[0] + i * H, O[1] + j * H, O[2] + k * H); blk[o] = d; }
    return d;
  };
  const CO = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const verts = [], norms = [], cells = new Map();
  const cellVertex = (i, j, k) => {
    const kk = key(i, j, k);
    let v = cells.get(kk);
    if (v !== undefined) return v;
    const c = CO.map(([a, b, e]) => F(i + a, j + b, k + e));
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of EDGES) if ((c[a] < 0) !== (c[b] < 0)) { const t = c[a] / (c[a] - c[b]); sx += CO[a][0] + (CO[b][0] - CO[a][0]) * t; sy += CO[a][1] + (CO[b][1] - CO[a][1]) * t; sz += CO[a][2] + (CO[b][2] - CO[a][2]) * t; n++; }
    n = Math.max(1, n);
    const x = O[0] + (i + sx / n) * H, y = O[1] + (j + sy / n) * H, z = O[2] + (k + sz / n) * H;
    const g = gradAt(x, y, z);
    v = verts.length; verts.push([x, y, z]); norms.push(unit(g)); cells.set(kk, v);
    return v;
  };
  const quads = [], band = C * H * 1.25;
  for (let ci = 0; ci * C < NX; ci++) for (let cj = 0; cj * C < NY; cj++) for (let ck = 0; ck * C < NZ; ck++) {
    if (Math.abs(catD(O[0] + (ci + 0.5) * C * H, O[1] + (cj + 0.5) * C * H, O[2] + (ck + 0.5) * C * H)) > band) continue;
    // then each 2 x 2 x 2 run of fine cells inside it, tested again, so only cells next to the surface are sampled
    for (let si = ci * C; si < ci * C + C; si += 2) for (let sj = cj * C; sj < cj * C + C; sj += 2) for (let sk = ck * C; sk < ck * C + C; sk += 2) {
    if (Math.abs(catD(O[0] + (si + 1) * H, O[1] + (sj + 1) * H, O[2] + (sk + 1) * H)) > H * 2.2) continue;
    for (let i = si; i < si + 2; i++) for (let j = sj; j < sj + 2; j++) for (let k = sk; k < sk + 2; k++) {
      const d0 = F(i, j, k) < 0;
      if ((F(i + 1, j, k) < 0) !== d0 && j > 0 && k > 0) quads.push([cellVertex(i, j - 1, k - 1), cellVertex(i, j, k - 1), cellVertex(i, j, k), cellVertex(i, j - 1, k)]);
      if ((F(i, j + 1, k) < 0) !== d0 && i > 0 && k > 0) quads.push([cellVertex(i - 1, j, k - 1), cellVertex(i, j, k - 1), cellVertex(i, j, k), cellVertex(i - 1, j, k)]);
      if ((F(i, j, k + 1) < 0) !== d0 && i > 0 && j > 0) quads.push([cellVertex(i - 1, j - 1, k), cellVertex(i, j - 1, k), cellVertex(i, j, k), cellVertex(i - 1, j, k)]);
    }
    }
  }
  const V = verts.map((p, i) => vertexAt(p, norms[i]));
  MESH = { quads: quads.map((q) => q.map((i) => V[i])) };
  // the inlaid eyes, drawn the comic way: a pale grey iris darkening to a ring at its edge, a big dark
  // pupil, and a white catchlight high on the side the light comes from
  for (const s of [-1, 1]) {
    const disc = (rx, ry, ox, oy, z0, dome) => (a, b) => { const t = a * Math.PI * 2; return fromHead(fromEye([ox + Math.cos(t) * rx * b, oy + Math.sin(t) * ry * b, z0 + dome * Math.sqrt(Math.max(0, 1 - b * b))], s)); };
    MESH.quads.push(...lens(disc(0.0205, 0.0138, 0, 0, -0.0036, 0.0055), (a, b) => { const fib = 0.035 * Math.sin(a * Math.PI * 2 * 23); return lerp3(hexRGB('#d9dad3'), hexRGB('#5e5f5a'), smooth(0.68, 1, b)).map((v) => v * (1 + fib)); }, 40, 10));
    MESH.quads.push(...lens(disc(0.0062, 0.0098, 0, 0.0004, 0.0021, 0.0011), () => hexRGB('#0b0b0d'), 24, 5));
    MESH.quads.push(...lens(disc(0.0026, 0.0022, 0.0055, 0.0052, 0.0031, 0.0005), () => hexRGB('#ffffff'), 14, 3));
  }
  return MESH;

}
// a domed disc (an inlay's face) from a polar map: a round the rim, b out from the middle; smooth normals
// from its own shape, a colour map, no occlusion (it's polished and proud of its socket)
function lens(S, col, nu, nv) {
  const g = [];
  for (let j = 0; j <= nv; j++) { const row = []; for (let i = 0; i <= nu; i++) row.push(S(i / nu, j / nv)); g.push(row); }
  const vx = g.map((row, j) => row.map((p, i) => {
    const ia = (i + 1) % (nu + 1), ib = Math.max(0, i - 1), ja = Math.min(nv, j + 1), jb = Math.max(0, j - 1);
    let n = cross(sub(g[j][ia], g[j][ib]), sub(g[ja][i], g[jb][i]));
    if (Math.hypot(...n) < 1e-12) n = cross(sub(g[1][(i + 1) % nu], g[1][i]), sub(g[1][i], g[0][i]));
    return { p, n: unit(n), c: toLinear(col(i / nu, j / nv)) };
  }));
  // make the normals face out the way the eye looks
  const out = sub(g[0][0], fromHead([0, 0.012, -0.01]));
  for (const row of vx) for (const v of row) if (dot(v.n, out) < 0) v.n = mul(v.n, -1);
  const qs = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) qs.push([vx[j][i], vx[j][i + 1], vx[j + 1][i + 1], vx[j + 1][i]]);
  return qs;
}
// ── the grain ───────────────────────────────────────────────────────────────────────────────────
// paintRoomTexture's 'roomCatGrain': a tiling near-white sheet the vertex colour is multiplied by, carrying
// what's finer than a vertex: a faint crystalline speckle and the odd pit
export function paintCatGrain(doc) {
  const N = 512, c = doc.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N), px = img.data;
  // value noise that tiles at a period of P cells
  const pn = (x, y, P) => {
    const i = Math.floor(x), j = Math.floor(y), u0 = x - i, v0 = y - j, u = u0 * u0 * (3 - 2 * u0), v = v0 * v0 * (3 - 2 * v0);
    const h = (a, b) => hash(((a % P) + P) % P, ((b % P) + P) % P, 7);
    const a = h(i, j) + (h(i + 1, j) - h(i, j)) * u, b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * u;
    return a + (b - a) * v;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    let k = 0.985 + 0.02 * pn(u * 128, v * 128, 128) + 0.012 * pn(u * 32, v * 32, 32);
    if (pn(u * 160, v * 160, 160) > 0.86) k *= 0.9;
    const o = (y * N + x) * 4;
    px[o] = px[o + 1] = px[o + 2] = Math.min(255, k * 255); px[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ── drawing ─────────────────────────────────────────────────────────────────────────────────────
// y0 is the pedestal top above the floor
export function drawCatStatue(K, F, y0) {
  const { P, N } = F, TB = K.TB(CAT_GRAIN), shape = K.C('#ffffff', 1);
  const world = (p) => P(p[0], y0 + p[1], p[2]);
  const colour = (c) => shape.map((w, i) => (i < 3 ? c[i] * 1.03 : w));
  const emit = (q) => {
    // the kit's winding: the diagonals' cross in the room's (u, v, y) along the outward normal
    const nAvg = unit(q.reduce((s, v) => add(s, v.n), [0, 0, 0]));
    const r = q.map((v) => world(v.p)), c0 = mul(q.reduce((s, v) => add(s, v.p), [0, 0, 0]), 0.25);
    const rn = sub(world(add(c0, nAvg)), world(c0));
    const o = dot(cross(sub(r[2], r[0]), sub(r[3], r[1])), rn) < 0 ? [0, 3, 2, 1] : [0, 1, 2, 3];
    // the grain projected along the face's main axis
    const ax = Math.abs(nAvg[0]) > Math.abs(nAvg[1]) ? (Math.abs(nAvg[0]) > Math.abs(nAvg[2]) ? 0 : 2) : (Math.abs(nAvg[1]) > Math.abs(nAvg[2]) ? 1 : 2);
    const uv = (p) => (ax === 0 ? [p[2] / GRAIN, p[1] / GRAIN] : ax === 1 ? [p[0] / GRAIN, p[2] / GRAIN] : [p[0] / GRAIN, p[1] / GRAIN]);
    K.quad(TB, o.map((k) => r[k]), o.map((k) => N(q[k].n[0], q[k].n[1], q[k].n[2])), o.map((k) => colour(q[k].c)), GLOSS, o.map((k) => uv(q[k].p)));
  };
  for (const q of catMesh().quads) emit(q);
}
