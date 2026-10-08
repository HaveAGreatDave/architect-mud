// THE STREET FIGURE'S HEAD: A LOW-POLY SKULL, EARS, NECK AND HAIR, IN THREE LEVELS.
//
// The bake's head (actor3d.js buildBody) is an 18 x 12 ellipsoid with lumps for a nose, eyes and
// ears, on a neck as wide as its jaw. This is the head that replaces it (docs/proposals/
// street-figure-heads.md). It's a loft whose edge loops sit on the face's landmarks rather than
// at even spacing: a ring through the brow, the eyes, the nose's root, tip and base, both lips,
// the mouth line and the chin, and a column down each side of the nose, through each nostril,
// each mouth corner, each iris and each cheekbone. So a few hundred vertices still carry a brow,
// a nose and a chin in profile, and the painted face (tools/modelshop/actor-head.js paintFace)
// lands on the features it was painted for. The face texture is a front projection in metres, so
// every level takes the same face.
//
// Three levels, by how tall the figure is on screen (HEAD_LEVELS). Each is a setting of the same
// code, so they share the face mapping and the hairline.
//
// Units are the bake's bind space: metres, Y up, the figure facing +Z with its left hand on +X.
// The head rides the head bone; the neck blends from the neck bone at the collar to the head bone
// under the skull (`W` per vertex). No DOM, no GL: the gate (scripts/shapes/actor-head.mjs) runs
// it in Node and the Modelshop's Actor Lab draws it.

const TAU = Math.PI * 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const gauss = (x, y, x0, y0, sx, sy) => Math.exp(-(((x - x0) / sx) ** 2) - (((y - y0) / sy) ** 2));
function h3(x, y, z) { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); }
function vnoise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const s = (t) => t * t * (3 - 2 * t), fx = s(x - ix), fy = s(y - iy), fz = s(z - iz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => h3(ix + dx, iy + dy, iz + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy),
    l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
}
// A monotone cubic through [x, y] pairs, x ascending: smooth, and it never overshoots a row.
function spline(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), n = xs.length;
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// ── Landmarks ───────────────────────────────────────────────────────────────────────────────────────
// Where things are, in metres. The geometry and the painter both read these, so a face painted
// on the texture lands on the face in the mesh.
export const FACE = {
  top: 1.75, chin: 1.5215,
  eyeY: 1.6395, eyeX: 0.031, irisX: 0.0312, iris: 0.0058, pupil: 0.0022,
  browY: 1.657, noseTipY: 1.5985, noseBaseY: 1.587, mouthY: 1.5652, chinY: 1.5365,
  // The texture: a front projection of this box.
  x0: -0.1, x1: 0.1, y0: 1.515, y1: 1.765,
};
const ZC = -0.006; // the skull's centre line front to back

// The skull, crown to chin. Above 1.655 it's an ellipsoid; below, these rows: half-width, front,
// back, where it's widest front to back, and how square the front is (2 is an ellipse).
const LOWER = [
  // y       w       zf      zb      zw     nf
  [1.5235, 0.0080, 0.064, 0.036, 0.050, 2.0],
  [1.5290, 0.0240, 0.079, 0.012, 0.042, 2.2],
  [1.5360, 0.0360, 0.086, -0.014, 0.022, 2.3],
  [1.5460, 0.0470, 0.090, -0.040, 0.006, 2.4],
  [1.5580, 0.0540, 0.092, -0.060, -0.004, 2.5],
  [1.5720, 0.0590, 0.093, -0.077, 0.000, 2.6],
  [1.5880, 0.0630, 0.092, -0.089, 0.003, 2.7],
  [1.6050, 0.0665, 0.090, -0.097, 0.002, 2.7],
  [1.6250, 0.0700, 0.089, -0.103, -0.002, 2.6],
  [1.6400, 0.0740, 0.088, -0.106, -0.005, 2.5],
  [1.6550, 0.0755, 0.091, -0.107, -0.006, 2.3],
];
const LOW = [1, 2, 3, 4, 5].map((k) => spline(LOWER.map((r) => [r[0], r[k]])));
function station(y) {
  if (y >= 1.655) {
    const t = Math.min(1, (y - 1.655) / 0.095), s = Math.sqrt(Math.max(0, 1 - t * t));
    return { w: 0.0755 * s, zf: ZC + 0.097 * s, zb: ZC - 0.101 * s, zw: ZC, nf: 2.3 - 0.2 * t };
  }
  const [w, zf, zb, zw, nf] = LOW.map((f) => f(y));
  return { w, zf, zb, zw, nf };
}

// The nose's height off the face and its half-width, by height.
const NOSE_H = spline([[1.583, 0], [1.5855, 0.0055], [1.588, 0.0142], [1.591, 0.0205], [1.5955, 0.0232], [1.599, 0.0232],
  [1.603, 0.021], [1.61, 0.0172], [1.62, 0.0132], [1.63, 0.0098], [1.64, 0.0062], [1.648, 0.0033], [1.656, 0]]);
const NOSE_W = spline([[1.583, 0.0125], [1.59, 0.0115], [1.597, 0.0105], [1.605, 0.0088], [1.62, 0.0076], [1.64, 0.0072], [1.656, 0.0095]]);

// The face's relief, added to z on the front of the skull. A level only keeps what its loops
// land on; what falls between them is the painter's to shade.
function faceDisp(x, y) {
  const ax = Math.abs(x);
  let d = 0;
  d += 0.005 * gauss(x, y, 0, 1.6645, 0.045, 0.0085);          // brow ridge
  d -= 0.004 * gauss(x, y, 0, 1.6485, 0.011, 0.0075);          // the bridge's root
  d -= 0.0095 * gauss(ax, y, 0.031, 1.6415, 0.019, 0.012);     // sockets
  d += 0.0052 * gauss(ax, y, 0.0312, 1.6395, 0.0115, 0.0068);  // the eyeball in them
  d += 0.006 * gauss(ax, y, 0.047, 1.6215, 0.016, 0.012);      // cheekbones
  d -= 0.0035 * gauss(ax, y, 0.047, 1.59, 0.013, 0.014);       // and the hollow under them
  d += NOSE_H(y) * Math.exp(-((x / NOSE_W(y)) ** 2));
  d += 0.0035 * gauss(x, y, 0, 1.5985, 0.0085, 0.0075);        // the tip
  d += 0.0075 * gauss(ax, y, 0.0155, 1.5925, 0.0066, 0.0064);  // the wings of the nostrils
  d -= 0.0018 * gauss(ax, y, 0.0225, 1.5985, 0.004, 0.006);    // and the groove behind them
  { // nose to mouth corner
    const t = clamp01((1.59 - y) / 0.024), lx = 0.022 + 0.008 * t;
    d -= 0.0018 * Math.exp(-(((ax - lx) / 0.0045) ** 2)) * Math.sin(Math.PI * t);
  }
  d -= 0.0012 * gauss(x, y, 0, 1.579, 0.0032, 0.0055);         // philtrum
  d += 0.0068 * gauss(x, y, 0, 1.5703, 0.021, 0.0046);         // upper lip
  d += 0.0078 * gauss(x, y, 0, 1.559, 0.019, 0.005);           // lower lip
  d -= 0.0032 * gauss(x, y, 0, FACE.mouthY, 0.026, 0.0011);    // where they meet
  d -= 0.003 * gauss(x, y, 0, 1.5495, 0.017, 0.004);           // under the lower lip
  d += 0.009 * gauss(x, y, 0, FACE.chinY, 0.017, 0.01);        // chin
  return d;
}

// ── Levels ──────────────────────────────────────────────────────────────────────────────────────────
// `rings`: heights crown to chin. Over the crown they're even steps of angle on the skull's
//   ellipsoid (15° at L0); through the face each one is a landmark.
// `xs`: where the face's columns cross the eye line, half-widths from the centre out. The centre
//   column is implied, so a level has 2 * xs.length + 1 columns across the face. Through the face
//   a column holds its x from ring to ring, so it runs straight down the side of the nose or
//   through the mouth corner; over the crown and under the chin it eases to a fixed angle, so the
//   small rings there don't bunch up.
// `back`: columns round the sides and back, evenly spaced.
// `ear`: points round and rings down each ear. `neck`: points round and rings down the neck.
// `sheet`: columns and rows of the long-hair sheet.
// `px`: the figure's height on screen, in pixels, from which a level is used.
export const HEAD_LEVELS = [
  {
    name: 'L0', px: 250,
    rings: [1.7468, 1.7373, 1.7222, 1.7025, 1.6796, 1.6665, 1.6575, 1.6485, 1.6395, 1.6315, 1.6215, 1.6095,
      1.5985, 1.5915, 1.5845, 1.5775, 1.5703, 1.5652, 1.559, 1.5495, 1.5365, 1.5285, 1.5236],
    xs: [0.058, 0.048, 0.04, 0.0325, 0.025, 0.018, 0.0115, 0.0055],
    back: 15, ear: [10, 6], neck: [12, 8], sheet: [14, 8],
  },
  {
    name: 'L1', px: 60,
    rings: [1.7428, 1.7222, 1.6914, 1.666, 1.648, 1.6355, 1.6185, 1.5985, 1.5855, 1.5703, 1.559, 1.5435, 1.5285, 1.5236],
    xs: [0.05, 0.034, 0.02, 0.009],
    back: 11, ear: [6, 4], neck: [8, 5], sheet: [8, 4],
  },
  {
    name: 'L2', px: 0,
    rings: [1.735, 1.7025, 1.666, 1.638, 1.6, 1.57, 1.545, 1.527],
    xs: [0.04, 0.014],
    back: 7, ear: [4, 2], neck: [6, 3], sheet: [5, 2],
  },
];
// The level for a figure this many pixels tall.
export const headLevelFor = (px) => HEAD_LEVELS.findIndex((L) => px >= L.px);

const se = (v, n) => Math.sign(v) * Math.abs(v) ** (2 / n);
function skullPoint(y, phi) {
  const S = station(y), c = Math.cos(phi), s = Math.sin(phi);
  const n = s > 0 ? S.nf : 2.1;
  const x = S.w * se(c, n);
  let z = S.zw + (s > 0 ? S.zf - S.zw : S.zw - S.zb) * se(s, n);
  if (s > 0) z += faceDisp(x, y) * sstep(0.1, 0.5, s);
  return [x, y, z];
}
// The angle on ring `y` whose point sits at half-width `x` on the front of the skull. A column
// wider than a small ring is eased in to just inside its edge rather than clamped onto it.
function phiAtX(y, x) {
  const S = station(y);
  let t = Math.abs(x) / Math.max(S.w, 1e-6);
  if (t > 0.8) t = 0.8 + 0.19 * (1 - Math.exp(-(t - 0.8) / 0.19));
  return Math.acos(Math.sign(x) * t ** (S.nf / 2));
}
// Each ring's angles, phi increasing (x = cos phi, z = sin phi): the face's columns from +x to
// -x, then the back's round to where the face began.
function ringPhis(L, y) {
  const xs = [...L.xs, 0, ...L.xs.slice().reverse().map((x) => -x)];
  const ease = Math.max(sstep(1.668, 1.69, y), sstep(1.545, 1.528, y));
  const front = xs.map((x) => { const a = phiAtX(y, x), b = phiAtX(FACE.eyeY, x); return a + (b - a) * ease; });
  const a = front[front.length - 1], b = front[0] + TAU, out = front.slice();
  for (let k = 1; k <= L.back; k++) out.push(a + ((b - a) * k) / (L.back + 1));
  return out;
}

// ── The hairline, crown-centred, by angle from straight ahead (0) to straight behind (pi) ──────────
// Thirteen knots a twelfth of pi apart, read the same way by the shell builder here and by the
// scalp paint in the head's fragment shader, so the paint is under the shell's edge.
export const HAIRLINE = [1.703, 1.7, 1.688, 1.662, 1.63, 1.648, 1.664, 1.666, 1.65, 1.612, 1.586, 1.574, 1.571];
export function hairlineAt(x, z) {
  const psi = Math.atan2(Math.abs(x), z - ZC), u = (psi / Math.PI) * 12;
  const i = Math.floor(u), t = u - i, k = (j) => HAIRLINE[Math.max(0, Math.min(12, j))];
  const p0 = k(i - 1), p1 = k(i), p2 = k(i + 1), p3 = k(i + 2);
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}
export const HAIRLINE_GLSL = `const float HL[13] = float[13](${HAIRLINE.map((v) => v.toFixed(3)).join(', ')});
float hairlineAt(vec3 r) {
  float u = atan(abs(r.x), r.z - (${ZC.toFixed(3)})) / 3.14159265 * 12.0;
  int i = int(floor(u));
  float t = u - float(i);
  float p0 = HL[clamp(i - 1, 0, 12)], p1 = HL[clamp(i, 0, 12)], p2 = HL[clamp(i + 1, 0, 12)], p3 = HL[clamp(i + 2, 0, 12)];
  return 0.5 * (2.0 * p1 + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t * t + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t * t * t);
}`;

// ── Mesh building ───────────────────────────────────────────────────────────────────────────────────
// Feature ids match the Actor Lab's FEAT: 7 head skin, 8 ears, 9 hair, 12 neck. `w` is how much a
// vertex rides the head rather than the neck; `e` is how far up an ear it is (for pointed ears);
// `aux` is the ear's hollow, for shading.
export const HEAD_FEAT = { skin: 7, ear: 8, hair: 9, neck: 12 };
function builder() {
  const M = { P: [], F: [], W: [], E: [], X: [], I: [] };
  M.v = (p, f, w = 1, e = 0, aux = 0) => {
    M.P.push(p[0], p[1], p[2]); M.F.push(f); M.W.push(w); M.E.push(e); M.X.push(aux);
    return M.P.length / 3 - 1;
  };
  M.t = (a, b, c) => M.I.push(a, b, c);
  return M;
}
function normals(P, I) {
  const N = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { N[i] += nx; N[i + 1] += ny; N[i + 2] += nz; }
  }
  for (let i = 0; i < N.length; i += 3) {
    const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
    N[i] /= l; N[i + 1] /= l; N[i + 2] /= l;
  }
  return N;
}
// { P, N, UV, F, W, E, X, I }: positions, normals, the face texture's UV, then per vertex the
// feature id, head weight, ear height and ear hollow; I indexes triangles as UNSIGNED_SHORT.
function done(M) {
  const P = new Float32Array(M.P), I = new Uint16Array(M.I);
  const UV = new Float32Array((P.length / 3) * 2);
  for (let i = 0; i < P.length / 3; i++) {
    UV[i * 2] = (P[i * 3] - FACE.x0) / (FACE.x1 - FACE.x0);
    UV[i * 2 + 1] = (P[i * 3 + 1] - FACE.y0) / (FACE.y1 - FACE.y0);
  }
  return { P, N: normals(P, M.I), UV, F: new Float32Array(M.F), W: new Float32Array(M.W), E: new Float32Array(M.E), X: new Float32Array(M.X), I };
}
// Rings of `n` points each, top to bottom with phi increasing: (upper k, upper k+1, lower k) winds
// outward, the same rule as actor3d.js stitch. A -1 is a missing point; its quads are skipped.
function stitch(M, rings, flip = false) {
  for (let j = 0; j < rings.length - 1; j++) {
    const u = rings[j], l = rings[j + 1], n = u.length;
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      if (u[k] < 0 || u[k1] < 0 || l[k] < 0 || l[k1] < 0) continue;
      if (flip) { M.t(u[k], l[k], u[k1]); M.t(u[k1], l[k], l[k1]); } else { M.t(u[k], u[k1], l[k]); M.t(u[k1], l[k1], l[k]); }
    }
  }
}

// The skull as a grid, kept so the hair can grow off it.
const _grid = [];
function grid(lv) {
  if (_grid[lv]) return _grid[lv];
  const L = HEAD_LEVELS[lv], ys = L.rings;
  const pts = ys.map((y) => ringPhis(L, y).map((phi) => skullPoint(y, phi)));
  const n = pts[0].length;
  const top = [0, FACE.top, ZC], bot = [0, FACE.chin, 0.05];
  // Normals off a throwaway mesh of the whole closed skull.
  const M = builder();
  const ti = M.v(top, 7), rings = pts.map((r) => r.map((p) => M.v(p, 7))), bi = M.v(bot, 7);
  for (let k = 0; k < n; k++) M.t(ti, rings[0][(k + 1) % n], rings[0][k]);
  stitch(M, rings);
  const R = rings[rings.length - 1];
  for (let k = 0; k < n; k++) M.t(R[k], R[(k + 1) % n], bi);
  const N = normals(new Float32Array(M.P), M.I);
  const nAt = (i) => [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]];
  _grid[lv] = { ys, pts, n, top, bot, nrm: rings.map((r) => r.map(nAt)), topN: nAt(ti) };
  return _grid[lv];
}

// An ear: a flattened ellipsoid with a hollow in its outer face, leaned back and flared from the
// head, its front edge sunk into the side of the skull.
function addEar(M, side, nu, nv) {
  const rx = 0.0068, ry = 0.029, rz = 0.0172;
  const tilt = -0.2, flare = -0.26 * side;
  const place = (lx, ly, lz) => {
    // lean back about x, flare about a vertical line near the front edge, then put it on the head
    const y = ly * Math.cos(tilt) - lz * Math.sin(tilt), z = ly * Math.sin(tilt) + lz * Math.cos(tilt);
    const x = lx * side;
    const pz = rz * 0.75, dz = z - pz;
    const x2 = x * Math.cos(flare) + dz * Math.sin(flare), z2 = -x * Math.sin(flare) + dz * Math.cos(flare) + pz;
    return [x2 + 0.0695 * side, y + 1.62, z2 - 0.014];
  };
  const vert = (th, ph) => {
    let lx = rx * Math.sin(th) * Math.cos(ph);
    const ly = ry * Math.cos(th);
    let lz = rz * Math.sin(th) * Math.sin(ph);
    if (ly < 0) lz *= 1 - 0.22 * sstep(0, -ry, ly);
    const dent = gauss(ly, lz, -0.004, 0.001, 0.013, 0.0085) * sstep(0, rx * 0.6, lx);
    lx -= 0.0058 * dent;
    return M.v(place(lx, ly, lz), 8, 1, Math.max(0, ly / ry) ** 2, dent);
  };
  const top = vert(0, 0), rings = [];
  for (let j = 1; j < nv; j++) {
    const r = [];
    for (let k = 0; k < nu; k++) r.push(vert((j * Math.PI) / nv, (k * TAU) / nu));
    rings.push(r);
  }
  const bot = vert(Math.PI, 0);
  // ph runs x = cos, z = sin, the same as the skull, so the left ear winds like it; the mirror flips.
  const flip = side < 0;
  for (let k = 0; k < nu; k++) { const a = rings[0][(k + 1) % nu], b = rings[0][k]; flip ? M.t(top, b, a) : M.t(top, a, b); }
  stitch(M, rings, flip);
  const R = rings[rings.length - 1];
  for (let k = 0; k < nu; k++) { const a = R[k], b = R[(k + 1) % nu]; flip ? M.t(b, a, bot) : M.t(a, b, bot); }
}

// The neck: narrower than the jaw, leaning forward a little, widening into the shoulders under the
// collar. It rides the neck bone at the collar and the head under the skull. An open tube: its top
// is inside the skull and its foot inside the coat.
export const NECK_TOP = 1.6, NECK_FOOT = 1.425;
const NECK = [
  // y      rx      rz      cz
  [1.425, 0.064, 0.06, -0.028],
  [1.45, 0.056, 0.055, -0.025],
  [1.475, 0.049, 0.051, -0.021],
  [1.5, 0.0458, 0.049, -0.018],
  [1.53, 0.0442, 0.048, -0.015],
  [1.56, 0.0438, 0.047, -0.012],
  [1.6, 0.043, 0.046, -0.01],
];
function addNeck(M, n, rows) {
  const rings = [], f = [1, 2, 3].map((k) => spline(NECK.map((r) => [r[0], r[k]])));
  for (let i = 0; i < rows; i++) {
    const y = NECK_TOP - ((NECK_TOP - NECK_FOOT) * i) / (rows - 1);
    const rx = f[0](y), rz = f[1](y), cz = f[2](y), w = sstep(1.495, 1.565, y), r = [];
    for (let k = 0; k < n; k++) {
      const ph = (k * TAU) / n, s = Math.sin(ph);
      // the throat is flatter than the back of the neck
      r.push(M.v([rx * Math.cos(ph), y, cz + rz * s * (s > 0 ? 0.92 : 1)], 12, w));
    }
    rings.push(r);
  }
  stitch(M, rings);
}

const _head = [];
// Skin at level `lv` (0, 1 or 2): the skull, both ears and the neck, one indexed mesh.
export function headMesh(lv = 0) {
  if (_head[lv]) return _head[lv];
  const L = HEAD_LEVELS[lv], G = grid(lv), M = builder(), n = G.n;
  const ti = M.v(G.top, 7), rings = G.pts.map((r) => r.map((p) => M.v(p, 7))), bi = M.v(G.bot, 7);
  for (let k = 0; k < n; k++) M.t(ti, rings[0][(k + 1) % n], rings[0][k]);
  stitch(M, rings);
  const R = rings[rings.length - 1];
  for (let k = 0; k < n; k++) M.t(R[k], R[(k + 1) % n], bi);
  addEar(M, 1, ...L.ear); addEar(M, -1, ...L.ear);
  addNeck(M, ...L.neck);
  _head[lv] = done(M);
  return _head[lv];
}

// ── Hair ────────────────────────────────────────────────────────────────────────────────────────────
// A shell grown off the scalp above the hairline, thinning to nothing at its edge so it meets the
// skin instead of standing off it like a helmet. Styles: 0 cropped, 1 neat and parted, 2 tousled,
// 3 long, 4 a quiff over cut sides.
export const HAIR_STYLES = 5;
const _hair = [];
export function hairMesh(style, lv = 0) {
  const key = lv * HAIR_STYLES + style;
  if (_hair[key]) return _hair[key];
  const L = HEAD_LEVELS[lv], G = grid(lv), M = builder(), n = G.n;
  const shell = (p, nn) => {
    const ax = Math.abs(p[0]);
    let T = [0.0032, 0.0042, 0.008, 0.007, 0.011][style];
    if (style === 2) T += 0.007 * vnoise3(p[0] * 55, p[1] * 55, p[2] * 55 + 3);
    if (style === 3) T += 0.004 * vnoise3(p[0] * 40, p[1] * 40, p[2] * 40 + 9);
    let thin = 0;
    if (style === 4) {
      thin = Math.max(sstep(0.04, 0.05, ax) * (1 - sstep(1.708, 1.722, p[1])), sstep(-0.02, -0.07, p[2]) * (1 - sstep(1.63, 1.66, p[1])));
      T = T + (0.0016 - T) * thin;
    }
    const hl = hairlineAt(p[0], p[2]);
    const tuck = sstep(hl + 0.003, hl + 0.016, p[1]);
    const t = 0.0007 + (T - 0.0007) * tuck;
    const q = [p[0] + nn[0] * t, p[1] + nn[1] * t, p[2] + nn[2] * t];
    if (style === 4) {
      const front = sstep(0.02, 0.08, p[2]) * sstep(1.7, 1.73, p[1]) * (1 - thin) * tuck;
      q[1] += 0.03 * front; q[2] += 0.018 * front;
    }
    return q;
  };
  // The shell starts a little above the hairline, where the scalp under it is already painted the
  // hair's colour, so the stepped edge of the cut lands on hair, not skin. Each column's first
  // vertex below the line is pulled up onto it, so the edge follows the hairline instead of
  // stepping ring by ring.
  const thr = (p) => hairlineAt(p[0], p[2]) + 0.0045;
  const ti = M.v(shell(G.top, G.topN), 9);
  const rings = G.pts.map((r) => r.map(() => -1));
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < G.pts.length; i++) {
      const p = G.pts[i][j], nn = G.nrm[i][j];
      if (p[1] > 1.55 && p[1] >= thr(p)) { rings[i][j] = M.v(shell(p, nn), 9); continue; }
      if (i > 0 && rings[i - 1][j] >= 0) {
        const a = G.pts[i - 1][j], na = G.nrm[i - 1][j], y = thr(p), t = clamp01((a[1] - y) / (a[1] - p[1]));
        const q = [0, 1, 2].map((k) => a[k] + (p[k] - a[k]) * t), nq = [0, 1, 2].map((k) => na[k] + (nn[k] - na[k]) * t);
        rings[i][j] = M.v(shell(q, nq), 9);
      }
      break;
    }
  }
  for (let k = 0; k < n; k++) M.t(ti, rings[0][(k + 1) % n], rings[0][k]);
  stitch(M, rings);
  if (style === 3) {
    // Long hair hangs off the back of the head as a sheet, ragged at the ends, over the shoulders.
    // It rides the head at the top and the neck below the nape.
    const rx = spline([[1.38, 0.13], [1.44, 0.122], [1.5, 0.098], [1.58, 0.084], [1.645, 0.082]]);
    const rz = spline([[1.38, 0.135], [1.44, 0.13], [1.5, 0.112], [1.58, 0.106], [1.645, 0.108]]);
    const [cols, rows] = L.sheet, A = 1.75, sheet = [];
    for (let r = 0; r <= rows; r++) {
      const row = [];
      for (let c = 0; c <= cols; c++) {
        const yEnd = 1.4 + 0.035 * vnoise3(c * (21 / cols), 0.5, 4.2), y = 1.645 - (1.645 - yEnd) * (r / rows);
        const phi = -Math.PI / 2 - A + (2 * A * c) / cols, zc = ZC - 0.02 * sstep(1.62, 1.44, y);
        row.push(M.v([rx(y) * Math.cos(phi), y, zc + rz(y) * Math.sin(phi)], 9, sstep(1.47, 1.6, y)));
      }
      sheet.push(row);
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const a = sheet[r][c], b = sheet[r][c + 1], d = sheet[r + 1][c], e = sheet[r + 1][c + 1];
      M.t(a, d, b); M.t(b, d, e);
    }
  }
  _hair[key] = done(M);
  return _hair[key];
}
