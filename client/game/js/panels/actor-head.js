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
export function spline(pts) {
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
export const ZC = -0.006; // the skull's centre line front to back

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

// How much of each feature a style keeps. `real` is the street's head, which the atlas's faces are
// painted for. `comic` is the close-up figure's (figure.js), after Borderlands' people: the forms
// pushed rather than smoothed (a heavier brow, the nose's bridge and tip kept, a firmer chin, the
// jaw a little wider, `jaw` in skullPoint) and the fine relief cut back (the folds, the lips, the
// eyeballs in their sockets), because the inked atlas draws those as lines. And its exaggerations,
// none of which the real head has: `browEdge` sharpens the brow into a shelf, `cheekHi` lifts the
// cheekbones, `chinW` widens the chin into a flat one, and `jawSq` gives the jaw a corner at its
// angle, so the head reads square from the front and in silhouette.
export const FACE_STYLES = {
  real: { brow: 1, bridge: 1, socket: 1, ball: 1, cheek: 1, hollow: 1, nose: 1, tip: 1, wings: 1, folds: 1, lips: 1, chin: 1, jaw: 0, browEdge: 1, cheekHi: 0, chinW: 1, jawSq: 0 },
  // the revised close-up head (docs/proposals/sculpted-figure.md): the same mesh, the planes cut deeper,
  // and `asym` the small unevenness a real face has
  sculpt: { brow: 3, browY: 1.659, bridge: 0.9, socket: 1.6, eyeX: 0.0292, ball: 0.45, cheek: 2.4, hollow: 1.7, nose: 1.28, noseNarrow: 0.3, tip: 1, wings: 1.25, folds: 0.5, lips: 0.42, chin: 2.3, jaw: 0.1, browEdge: 0.62, cheekHi: 0.004, chinW: 1.15, jawSq: 1, jawY: 1.574, jawR: 0.02, chinOut: 0.0035, chinUp: 0.007, asym: 1 },
  comic: { brow: 1.9, bridge: 0.9, socket: 0.65, ball: 0.4, cheek: 1.85, hollow: 1.1, nose: 1.05, tip: 1.1, wings: 0.8, folds: 0.3, lips: 0.55, chin: 1.6, jaw: -0.7, browEdge: 0.78, cheekHi: 0.004, chinW: 1.35, jawSq: 1 },
};

// The sculpted head's other shapes, a person's pick (SCULPT_HEADS, by index): the same mesh, broader,
// leaner, or softer with a fuller mouth.
FACE_STYLES.sculptBroad = { ...FACE_STYLES.sculpt, jaw: -0.25, jawSq: 1.3, chinW: 1.25, cheek: 2.6, nose: 1.35 };
FACE_STYLES.sculptLean = { ...FACE_STYLES.sculpt, jaw: 0.3, jawSq: 0.6, hollow: 2.6, chin: 2.5, chinW: 1, nose: 1.35 };
// The soft head is a woman's: hardly any brow ridge, a shorter smaller nose, the jaw tapering to a small
// chin with no corner, and `chinUp` shortening the face under the mouth.
FACE_STYLES.sculptSoft = { ...FACE_STYLES.sculpt, brow: 0.6, bridge: 0.75, socket: 0.7, ball: 0.7, cheek: 1.5, cheekHi: 0.006, hollow: 0.35, nose: 0.72, tip: 0.85, wings: 0.7, folds: 0, lips: 1.3, chin: 0.8, chinW: 0.85, jaw: 1.1, jawSq: 0, browEdge: 1.2, chinUp: 0.011, chinOut: 0, browY: 1.6645, eyeX: 0.0312, noseNarrow: 0, wings: 0.7, tip: 0.85 };
// The leading man's head: the plain sculpted head with a firmer jaw and a broad, rounded chin, a little
// squared in front (`chinFlat`), and nothing pushed far enough to read as a caricature. Nobody rolls it
// (the rolls stop at 3); a settled look asks for it (John Akerson's).
FACE_STYLES.sculptChin = { ...FACE_STYLES.sculpt, cheek: 2.5, hollow: 1.9, nose: 1.2, chin: 1.9, chinW: 1.4, chinOut: 0.0045, jaw: -0.1, jawSq: 1.1, jawY: 1.57, jawR: 0.02, chinFlat: 0.35 };
export const SCULPT_HEADS = ['sculpt', 'sculptBroad', 'sculptLean', 'sculptSoft', 'sculptChin'];
// A sculpted head at a body's weight (figure.js SOMA), 0 to 1. What each body does to the face, added to
// the head's own shape: an ectomorph's goes hollow and narrow, a mesomorph's heavier in the
// jaw, an endomorph's round and full, the jaw lost and a second chin under it (`fat` in skullPoint).
const FACE_WEIGHT = {
  ecto: { cheek: 0.5, hollow: 2.6, jaw: 0.6, jawSq: -0.3, chin: 0.2, chinUp: 0, fat: 0, lean: 1 },
  meso: { cheek: 0.1, hollow: 0.2, jaw: -0.2, jawSq: 0.3, chin: 0.3, chinUp: 0, fat: 0, lean: 0 },
  endo: { cheek: -1, hollow: -1.4, jaw: -0.3, jawSq: -1.6, chin: -0.9, chinUp: 0.009, fat: 1, lean: 0 },
};
export function weightedFace(style, w) {
  if (w === null || w === undefined) return style;
  const name = style + '@' + w;
  if (FACE_STYLES[name]) return name;
  const lo = w < 0.5, t = lo ? w * 2 : (w - 0.5) * 2, A = lo ? FACE_WEIGHT.ecto : FACE_WEIGHT.meso, B = lo ? FACE_WEIGHT.meso : FACE_WEIGHT.endo, K = { ...FACE_STYLES[style] };
  for (const k of Object.keys(A)) K[k] = Math.max(k === 'jaw' ? -9 : 0, (K[k] || 0) + A[k] + (B[k] - A[k]) * t);
  FACE_STYLES[name] = K;
  return name;
}

// The face's relief, added to z on the front of the skull. A level only keeps what its loops
// land on; what falls between them is the painter's to shade.
function faceDisp(x, y, K = FACE_STYLES.real) {
  const ax = Math.abs(x);
  let d = 0;
  d += K.brow * 0.005 * gauss(x, y, 0, K.browY || 1.6645, 0.045, 0.0085 * K.browEdge);          // brow ridge
  d -= K.bridge * 0.004 * gauss(x, y, 0, 1.6485, 0.011, 0.0075);          // the bridge's root
  d -= K.socket * 0.0095 * gauss(ax, y, K.eyeX || 0.031, 1.6415, 0.019, 0.012);     // sockets
  d += K.ball * 0.0052 * gauss(ax, y, K.eyeX || 0.0312, 1.6395, 0.0115, 0.0068);  // the eyeball in them
  d += K.cheek * 0.006 * gauss(ax, y, 0.047, 1.6215 + K.cheekHi, 0.016, 0.012);      // cheekbones
  d -= K.hollow * 0.0035 * gauss(ax, y, 0.047, 1.59, 0.013, 0.014);       // and the hollow under them
  d += K.nose * NOSE_H(y) * Math.exp(-((x / (NOSE_W(y) * (1 - (K.noseNarrow || 0) * sstep(1.598, 1.625, y)))) ** 2));
  d += K.tip * 0.0035 * gauss(x, y, 0, 1.5985, 0.0085, 0.0075);        // the tip
  d += K.wings * 0.0075 * gauss(ax, y, 0.0155, 1.5925, 0.0066, 0.0064);  // the wings of the nostrils
  d -= K.folds * 0.0018 * gauss(ax, y, 0.0225, 1.5985, 0.004, 0.006);    // and the groove behind them
  { // nose to mouth corner
    const t = clamp01((1.59 - y) / 0.024), lx = 0.022 + 0.008 * t;
    d -= K.folds * 0.0018 * Math.exp(-(((ax - lx) / 0.0045) ** 2)) * Math.sin(Math.PI * t);
  }
  d -= K.folds * 0.0012 * gauss(x, y, 0, 1.579, 0.0032, 0.0055);         // philtrum
  d += K.lips * 0.0068 * gauss(x, y, 0, 1.5703, 0.021, 0.0046);         // upper lip
  d += K.lips * 0.0078 * gauss(x, y, 0, 1.559, 0.019, 0.005);           // lower lip
  d -= K.lips * 0.0032 * gauss(x, y, 0, FACE.mouthY, 0.026, 0.0011);    // where they meet
  d -= K.lips * 0.003 * gauss(x, y, 0, 1.5495, 0.017, 0.004);           // under the lower lip
  d += K.chin * 0.009 * gauss(x, y, 0, FACE.chinY, 0.017 * K.chinW, 0.01);        // chin
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
// A point on the skull at height `y` and angle `phi` round it (x = cos phi, z = sin phi), the
// face's relief included. Headwear is fitted to this (gl/ballplayer-mesh.js). `style` is a
// FACE_STYLES name.
export function skullPoint(y, phi, style = 'real') {
  const K = FACE_STYLES[style] || FACE_STYLES.real;
  const S = station(y), c = Math.cos(phi), s = Math.sin(phi);
  // `chinFlat` squares the front below the mouth, so the chin ends in a flat front with corners, not a point
  const n = s > 0 ? S.nf * (1 + (K.chinFlat || 0) * sstep(1.585, 1.54, y)) : 2.1;
  // the jaw's width from the cheekbones down, most at the chin (the comic style's is a little wider)
  let x = S.w * se(c, n) * (1 - K.jaw * 0.1 * sstep(1.615, 1.53, y) * (0.4 + 0.6 * Math.max(0, s)));
  // a full face: wider from the cheeks down, and under the chin the rings open into a second one
  if (K.fat) x *= 1 + K.fat * (0.15 * Math.exp(-(((y - 1.598) / 0.042) ** 2)) + 0.3 * sstep(1.542, 1.524, y));
  // and a lean one: drawn in below the cheekbones, so the bones stand out
  if (K.lean) x *= 1 - K.lean * 0.09 * sstep(1.625, 1.575, y);
  // the jaw's corner at its angle, out to the side and a little forward. The sculpted heads put it up by the mouth,
  // where a real jaw turns (`jawY`, `jawR`): at chin height it's a box
  if (K.jawSq) x += Math.sign(c) * K.jawSq * 0.0065 * Math.exp(-(((y - (K.jawY || 1.553)) / (K.jawR || 0.016)) ** 2)) * sstep(0.2, 0.75, Math.abs(c)) * (0.5 + 0.5 * Math.max(0, s));
  let z = S.zw + (s > 0 ? S.zf - S.zw : S.zw - S.zb) * se(s, n);
  if (s > 0) z += faceDisp(x, y, K) * sstep(0.1, 0.5, s);
  // the chin and the mouth over it brought forward, for a firm line in profile
  if (K.chinOut && s > 0) z += K.chinOut * sstep(1.585, 1.545, y) * s;
  if (K.fat && s > 0) z += K.fat * s * (0.018 * gauss(Math.abs(x), y, 0.052, 1.592, 0.032, 0.032) + 0.01 * sstep(1.54, 1.524, y));
  if (K.asym && s > 0) {
    z += K.asym * 0.0014 * gauss(x, y, 0.045, 1.62, 0.02, 0.02);   // the left cheekbone a little fuller
    x += K.asym * 0.0011 * gauss(x, y, 0, 1.6, 0.013, 0.022);      // the nose a little off true
  }
  return [x, y + (K.chinUp || 0) * sstep(1.556, 1.522, y) - (K.fat || 0) * 0.012 * sstep(1.542, 1.524, y), z];
}
// The sculpted eye's opening, by face: its centre's half-width, half its length, how far the lids stand above
// and below the middle, and how much it tilts up to the outer corner. gl/figure-hd.js draws the same curve.
export const EYE = { y: 1.6398, man: { x: 0.0292, w: 0.0158, t: 0.0051, b: 0.0034, tilt: 0.02 }, soft: { x: 0.0312, w: 0.0168, t: 0.0074, b: 0.0052, tilt: 0.07 } };
// The point on the face at half-width `x` and height `y`, for what's fitted to the skin.
export function facePoint(x, y, style) {
  let lo = 0.02, hi = Math.PI / 2;
  for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (skullPoint(y, m, style)[0] > Math.abs(x)) lo = m; else hi = m; }
  const p = skullPoint(y, (lo + hi) / 2, style);
  return [Math.sign(x) * Math.abs(p[0]), p[1], p[2]];
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
// The sculpted head's: a sideburn in front of the ear rather than at the eye's corner, and the hair
// coming down round the ear.
export const HAIRLINE_SCULPT = [1.697, 1.695, 1.687, 1.672, 1.651, 1.63, 1.598, 1.622, 1.64, 1.615, 1.585, 1.57, 1.565];
export function hairlineAt(x, z, line = HAIRLINE) {
  const psi = Math.atan2(Math.abs(x), z - ZC), u = (psi / Math.PI) * 12;
  const i = Math.floor(u), t = u - i, k = (j) => line[Math.max(0, Math.min(12, j))];
  const p0 = k(i - 1), p1 = k(i), p2 = k(i + 1), p3 = k(i + 2);
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}
// The skullet (hair style 5): the dome bald, the hair a horseshoe from ear to ear round the back and
// long down it. 1 where there's hair over the scalp, 0 on the bald, by height on the skull's ellipsoid
// and the angle from the brow over the crown (0) to the nape (180).
export function skulletHair(x, y, z) {
  const qy = (y - 1.655) / 0.097, qz = (z - ZC) / 0.101, th = Math.atan2(qy, qz) * 180 / Math.PI;
  return Math.max(1 - sstep(0.26, 0.36, qy), sstep(136, 150, th));
}
export const HAIRLINE_GLSL = `float skulletHair(vec3 r) {
  float qy = (r.y - 1.655) / 0.097, qz = (r.z - (${ZC.toFixed(3)})) / 0.101, th = degrees(atan(qy, qz));
  return max(1.0 - smoothstep(0.26, 0.36, qy), smoothstep(136.0, 150.0, th));
}
// how much of the skullet's scalp shows hair: the line between it and the bald wanders, and across it the
// hair thins a fleck at a time, as a balding man's does
float skulletPaint(vec3 r, float seed) {
  float h = fract(sin(dot(floor(r * 1400.0), vec3(12.9898, 78.233, 37.719)) + seed) * 43758.5453);
  float k = skulletHair(r + vec3(0.0, 0.012 * (sin(r.x * 140.0 + r.z * 90.0) * 0.5 + sin(r.z * 230.0 - r.x * 60.0) * 0.3), 0.0));
  // never on the forehead: the horseshoe starts in front of the ears
  return clamp((k * 1.25 - h) * 5.0, 0.0, 1.0) * smoothstep(0.0, 0.15, k) * (1.0 - smoothstep(0.03, 0.055, r.z));
}
const float HL[13] = float[13](${HAIRLINE.map((v) => v.toFixed(3)).join(', ')});
const float HLS[13] = float[13](${HAIRLINE_SCULPT.map((v) => v.toFixed(3)).join(', ')});
float hairlineSculpt(vec3 r) {
  float u = atan(abs(r.x), r.z - (${ZC.toFixed(3)})) / 3.14159265 * 12.0;
  int i = int(floor(u));
  float t = u - float(i);
  float p0 = HLS[clamp(i - 1, 0, 12)], p1 = HLS[clamp(i, 0, 12)], p2 = HLS[clamp(i + 1, 0, 12)], p3 = HLS[clamp(i + 2, 0, 12)];
  return 0.5 * (2.0 * p1 + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t * t + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t * t * t);
}
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
const _grid = {};
function grid(lv, style = 'real') {
  const gk = lv + style;
  if (_grid[gk]) return _grid[gk];
  const L = HEAD_LEVELS[lv], ys = L.rings;
  const pts = ys.map((y) => ringPhis(L, y).map((phi) => skullPoint(y, phi, style)));
  const n = pts[0].length;
  const top = [0, FACE.top, ZC], bot = [0, FACE.chin + (FACE_STYLES[style]?.chinUp || 0) - (FACE_STYLES[style]?.fat || 0) * 0.012, 0.05];
  // Normals off a throwaway mesh of the whole closed skull.
  const M = builder();
  const ti = M.v(top, 7), rings = pts.map((r) => r.map((p) => M.v(p, 7))), bi = M.v(bot, 7);
  for (let k = 0; k < n; k++) M.t(ti, rings[0][(k + 1) % n], rings[0][k]);
  stitch(M, rings);
  const R = rings[rings.length - 1];
  for (let k = 0; k < n; k++) M.t(R[k], R[(k + 1) % n], bi);
  const N = normals(new Float32Array(M.P), M.I);
  const nAt = (i) => [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]];
  _grid[gk] = { ys, pts, n, top, bot, nrm: rings.map((r) => r.map(nAt)), topN: nAt(ti) };
  return _grid[gk];
}

// An ear: a flattened ellipsoid with a hollow in its outer face, leaned back and flared from the
// head, its front edge sunk into the side of the skull.
function addEar(M, side, nu, nv, sculpt = false) {
  const rx = 0.0068, ry = sculpt ? 0.0245 : 0.029, rz = sculpt ? 0.0158 : 0.0172;
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
    if (ly < 0) lz *= 1 - (sculpt ? 0.34 : 0.22) * sstep(0, -ry, ly);
    const dent = gauss(ly, lz, -0.004, 0.001, 0.013, 0.0085) * sstep(0, rx * 0.6, lx);
    lx -= (sculpt ? 0.0085 : 0.0058) * dent;
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
export const NECK = [
  // y      rx      rz      cz
  [1.425, 0.064, 0.06, -0.028],
  [1.45, 0.056, 0.055, -0.025],
  [1.475, 0.049, 0.051, -0.021],
  [1.5, 0.0458, 0.049, -0.018],
  [1.53, 0.0442, 0.048, -0.015],
  [1.56, 0.0438, 0.047, -0.012],
  [1.6, 0.043, 0.046, -0.01],
];
export const NECK_SCULPT = 1.13;
// The sculpted neck (`k` not 1) with `fineNeck` (the close-up figure only) is modelled: twice as fine, the two sternomastoids standing out as ridges from
// behind each ear down to the notch at the base of the throat, the column drawn in a little above them and its
// back thicker than its front. The rink and park players keep the plain tube and their triangle budget; so does the street figure.
// `ph` runs round from the left side (+x) through the throat (+z) at a quarter turn.
const SCM_TOP = 1.575, SCM_FOOT = 1.438;
function scmRidge(ph, y) {
  const t = Math.max(0, Math.min(1, (SCM_TOP - y) / (SCM_TOP - SCM_FOOT))), env = sstep(SCM_FOOT - 0.004, SCM_FOOT + 0.022, y) * sstep(SCM_TOP + 0.01, SCM_TOP - 0.03, y);
  let best = 0;
  for (const side of [1, -1]) {
    // behind the ear at the top, a little behind the side; at the foot, either side of the notch
    const at = side > 0 ? -0.32 + (Math.PI / 2 - 0.2 + 0.32) * t : Math.PI + 0.32 - (Math.PI / 2 - 0.2 + 0.32) * t;
    const d = Math.atan2(Math.sin(ph - at), Math.cos(ph - at));
    best = Math.max(best, Math.exp(-((d / 0.26) ** 2)));
  }
  return best * env;
}
function addNeck(M, n, rows, k = 1, fineNeck = false) {
  // the extra rings and columns only at the close-up level (12 round), where the ridges can be seen
  const sculpt = k !== 1, fine = sculpt && fineNeck && n >= 12, N = fine ? n * 2 : n, R = fine ? Math.round(rows * 1.75) : rows;
  const rings = [], f = [1, 2, 3].map((k) => spline(NECK.map((r) => [r[0], r[k]])));
  for (let i = 0; i < R; i++) {
    const y = NECK_TOP - ((NECK_TOP - NECK_FOOT) * i) / (R - 1);
    const rx = f[0](y) * k, rz = f[1](y) * k, cz = f[2](y), w = sstep(1.495, 1.565, y), r = [];
    for (let j = 0; j < N; j++) {
      const ph = (j * TAU) / N, s = Math.sin(ph), c = Math.cos(ph);
      // the throat is flatter than the back of the neck
      let px = rx * c, pz = rz * s * (s > 0 ? 0.92 : 1);
      if (sculpt) {
        // the back of the neck thicker than the front (the shoulders' slope is the torso's, under the collar)
        if (s < 0) pz *= 1.05;
        // drawn in a little at the middle of its height, and the ridges standing out of it
        const pinch = 1 - 0.035 * Math.exp(-(((y - 1.52) / 0.03) ** 2)), ridge = 1 + 0.085 * scmRidge(ph, y);
        px *= pinch * ridge; pz *= pinch * ridge;
      }
      r.push(M.v([px, y, cz + pz], 12, w));
    }
    rings.push(r);
  }
  stitch(M, rings);
}

const _head = {};
// Skin at level `lv` (0, 1 or 2): the skull, both ears and the neck, one indexed mesh. `style` is
// a FACE_STYLES name; the hair shells (hairMesh) fit either, since they stop above the face.
export function headMesh(lv = 0, style = 'real', fineNeck = false) {
  const hk = lv + style + (fineNeck ? '+neck' : '');
  if (_head[hk]) return _head[hk];
  const L = HEAD_LEVELS[lv], G = grid(lv, style), M = builder(), n = G.n;
  const ti = M.v(G.top, 7), rings = G.pts.map((r) => r.map((p) => M.v(p, 7))), bi = M.v(G.bot, 7);
  for (let k = 0; k < n; k++) M.t(ti, rings[0][(k + 1) % n], rings[0][k]);
  stitch(M, rings);
  const R = rings[rings.length - 1];
  for (let k = 0; k < n; k++) M.t(R[k], R[(k + 1) % n], bi);
  const sculpt = style.startsWith('sculpt');
  addEar(M, 1, ...L.ear, sculpt); addEar(M, -1, ...L.ear, sculpt);
  addNeck(M, ...L.neck, sculpt ? NECK_SCULPT : 1, fineNeck);
  _head[hk] = done(M);
  return _head[hk];
}

// ── Hair ────────────────────────────────────────────────────────────────────────────────────────────
// A shell grown off the scalp above the hairline, thinning to nothing at its edge so it meets the
// skin instead of standing off it like a helmet. Styles: 0 cropped, 1 neat and parted, 2 tousled,
// 3 long, 4 a quiff over cut sides.
export const HAIR_STYLES = 6;
const _hair = [];
// `sculpt` fits the sculpted head and its hairline, and leaves the volume to figure.js's locks.
export function hairMesh(style, lv = 0, sculpt = false) {
  const key = lv * HAIR_STYLES + style + (sculpt ? 100 : 0);
  if (_hair[key]) return _hair[key];
  const L = HEAD_LEVELS[lv], G = grid(lv, sculpt ? 'sculpt' : 'real'), M = builder(), n = G.n, line = sculpt ? HAIRLINE_SCULPT : HAIRLINE;
  const shell = (p, nn) => {
    const ax = Math.abs(p[0]);
    let T = [0.0032, 0.0042, 0.008, 0.007, 0.011, 0.006][style];
    if (style === 2) T += 0.007 * vnoise3(p[0] * 55, p[1] * 55, p[2] * 55 + 3);
    if (style === 3) T += 0.004 * vnoise3(p[0] * 40, p[1] * 40, p[2] * 40 + 9);
    let thin = 0;
    // a skullet's shell lies flat on the bald dome, where the paint makes it skin
    if (style === 5) T = sculpt ? 0.0012 : 0.0009 + (T - 0.0009) * skulletHair(p[0], p[1], p[2]);
    else if (sculpt) T = 0.0045;
    else if (style === 4) {
      thin = Math.max(sstep(0.04, 0.05, ax) * (1 - sstep(1.708, 1.722, p[1])), sstep(-0.02, -0.07, p[2]) * (1 - sstep(1.63, 1.66, p[1])));
      T = T + (0.0016 - T) * thin;
    }
    const hl = hairlineAt(p[0], p[2], line);
    const tuck = sstep(hl + 0.003, hl + 0.016, p[1]);
    const t = 0.0007 + (T - 0.0007) * tuck;
    const q = [p[0] + nn[0] * t, p[1] + nn[1] * t, p[2] + nn[2] * t];
    if (style === 4 && !sculpt) {
      const front = sstep(0.02, 0.08, p[2]) * sstep(1.7, 1.73, p[1]) * (1 - thin) * tuck;
      q[1] += 0.03 * front; q[2] += 0.018 * front;
    }
    return q;
  };
  // The shell starts a little above the hairline, where the scalp under it is already painted the
  // hair's colour, so the stepped edge of the cut lands on hair, not skin. Each column's first
  // vertex below the line is pulled up onto it, so the edge follows the hairline instead of
  // stepping ring by ring.
  const thr = (p) => hairlineAt(p[0], p[2], line) + 0.0045;
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
  if (style === 3 && !sculpt) {
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
