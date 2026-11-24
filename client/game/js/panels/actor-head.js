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
  sculpt: { brow: 3, browY: 1.659, bridge: 0.9, socket: 1.6, eyeX: 0.0318, ball: 0.45, cheek: 2.4, hollow: 1.7, nose: 1.28, noseNarrow: 0.3, tip: 1, wings: 1.25, folds: 0.5, lips: 0.42, chin: 2.3, jaw: 0.1, browEdge: 0.62, cheekHi: 0.004, chinW: 1.15, jawSq: 1, jawY: 1.574, jawR: 0.02, chinOut: 0.0035, chinUp: 0.007, asym: 1 },
  comic: { brow: 1.9, bridge: 0.9, socket: 0.65, ball: 0.4, cheek: 1.85, hollow: 1.1, nose: 1.05, tip: 1.1, wings: 0.8, folds: 0.3, lips: 0.55, chin: 1.6, jaw: -0.7, browEdge: 0.78, cheekHi: 0.004, chinW: 1.35, jawSq: 1 },
};

// The sculpted head's other shapes, a person's pick (SCULPT_HEADS, by index): the same mesh, broader,
// leaner, or softer with a fuller mouth.
FACE_STYLES.sculptBroad = { ...FACE_STYLES.sculpt, jaw: -0.25, jawSq: 1.3, chinW: 1.25, cheek: 2.6, nose: 1.35 };
FACE_STYLES.sculptLean = { ...FACE_STYLES.sculpt, jaw: 0.3, jawSq: 0.6, hollow: 2.6, chin: 2.5, chinW: 1, nose: 1.35 };
// The soft head is a woman's: hardly any brow ridge, a shorter smaller nose, the jaw tapering to a small
// chin with no corner, and `chinUp` shortening the face under the mouth.
FACE_STYLES.sculptSoft = { ...FACE_STYLES.sculpt, brow: 0.6, bridge: 0.75, socket: 0.7, ball: 0.7, cheek: 1.5, cheekHi: 0.006, hollow: 0.35, nose: 0.72, tip: 0.85, wings: 0.7, folds: 0, lips: 1.3, chin: 0.8, chinW: 0.85, jaw: 1.1, jawSq: 0, browEdge: 1.2, chinUp: 0.011, chinOut: 0, browY: 1.6645, eyeX: 0.0312, noseNarrow: 0, wings: 0.7, tip: 0.85, soft: 1 };
// The leading man's head: the plain sculpted head with a firmer jaw and a broad, rounded chin, a little
// squared in front (`chinFlat`), and nothing pushed far enough to read as a caricature. Nobody rolls it
// (the rolls stop at 3); a settled look asks for it (John Akerson's).
FACE_STYLES.sculptChin = { ...FACE_STYLES.sculpt, cheek: 2.5, hollow: 1.9, nose: 1.2, chin: 1.9, chinW: 1.4, chinOut: 0.0045, jaw: -0.1, jawSq: 1.1, jawY: 1.57, jawR: 0.02, chinFlat: 0.35 };
// More women's heads, each the soft head pushed one way (they keep its eyes, `soft`): heart (wide high cheekbones
// over a small pointed chin), oval (longer and even), round (full cheeks, a soft round chin), angular (high
// cheekbones, a defined jaw with a corner), elfin (small chin, a short tipped-up nose, big open sockets) and strong
// (a square jaw and a firmer brow).
FACE_STYLES.sculptHeart = { ...FACE_STYLES.sculptSoft, cheek: 2.0, cheekHi: 0.008, hollow: 0.6, chin: 0.9, chinW: 0.65, jaw: 1.5, chinOut: 0.002 };
FACE_STYLES.sculptOval = { ...FACE_STYLES.sculptSoft, cheek: 1.3, chinUp: 0.007, chin: 1.0, chinW: 0.8, jaw: 0.9, nose: 0.85 };
FACE_STYLES.sculptRound = { ...FACE_STYLES.sculptSoft, cheek: 1.1, hollow: 0, chin: 0.6, chinW: 1.1, jaw: 0.5, lips: 1.45, nose: 0.68 };
FACE_STYLES.sculptAngular = { ...FACE_STYLES.sculptSoft, cheek: 2.3, cheekHi: 0.009, hollow: 1.3, jaw: 0.6, jawSq: 0.55, chin: 1.2, chinW: 0.9, brow: 0.9, nose: 0.85, noseNarrow: 0.25 };
FACE_STYLES.sculptElfin = { ...FACE_STYLES.sculptSoft, socket: 0.5, ball: 0.85, cheek: 1.7, cheekHi: 0.007, nose: 0.55, tip: 1.15, chin: 0.65, chinW: 0.6, jaw: 1.4, chinUp: 0.013 };
FACE_STYLES.sculptStrong = { ...FACE_STYLES.sculptSoft, brow: 1.1, cheek: 1.8, jaw: 0.25, jawSq: 0.8, chin: 1.4, chinW: 1.05, chinOut: 0.002, nose: 0.9, lips: 1.15 };
// and more men's: gaunt (the hollows sunk), a boxer's (flattened broad nose, heavy brow), boyish (smooth and young)
// and craggy (everything pushed).
FACE_STYLES.sculptGaunt = { ...FACE_STYLES.sculpt, cheek: 2.8, hollow: 3.2, jaw: 0.35, jawSq: 0.8, chin: 2.2, nose: 1.4, noseNarrow: 0.5 };
FACE_STYLES.sculptBoxer = { ...FACE_STYLES.sculpt, brow: 3.6, browEdge: 0.55, nose: 1.05, wings: 1.7, bridge: 0.5, noseNarrow: 0, jaw: -0.3, jawSq: 1.3, chinW: 1.3 };
FACE_STYLES.sculptBoyish = { ...FACE_STYLES.sculpt, brow: 1.8, socket: 1.1, cheek: 1.9, hollow: 0.9, jaw: 0.4, jawSq: 0.6, chin: 1.6, chinW: 1.0, lips: 0.7, folds: 0.2 };
FACE_STYLES.sculptCraggy = { ...FACE_STYLES.sculpt, brow: 3.8, socket: 2.0, cheek: 2.9, hollow: 2.3, nose: 1.5, wings: 1.45, folds: 1.0, chin: 2.6, jawSq: 1.4 };
// By index, so a figure's `head` keeps meaning the same head: append, never reorder.
export const SCULPT_HEADS = ['sculpt', 'sculptBroad', 'sculptLean', 'sculptSoft', 'sculptChin', 'sculptHeart', 'sculptOval', 'sculptRound', 'sculptAngular', 'sculptElfin', 'sculptStrong', 'sculptGaunt', 'sculptBoxer', 'sculptBoyish', 'sculptCraggy'];
// a woman's head (the soft head's eyes, bust and face height go with it), by style name or by SCULPT_HEADS index
export const softFace = (style) => !!FACE_STYLES[style]?.soft;
export const softHead = (i) => softFace(SCULPT_HEADS[i]);
// the heads a woman's figure rolls among, and a man's (sculptChin is a settled look's, never rolled)
export const SOFT_HEADS = [3, 5, 6, 7, 8, 9, 10], HARD_HEADS = [0, 1, 2, 11, 12, 13, 14];
// The MORPHEX's fine sliders (morphex-catalog.js FACE_TUNE), -5 to 5 each, added to a head's numbers. `tune` is the
// figure's compact form, 'jaw:2,nose:-3'. Each tuned head is registered once under its own name, like weightedFace.
const TUNE = {
  jaw: (K, v) => { K.jaw -= v * 0.16; K.jawSq += v * 0.12; K.chinW += v * 0.04; },
  chin: (K, v) => { K.chin += v * 0.28; K.chinOut = (K.chinOut || 0) + v * 0.0007; },
  cheeks: (K, v) => { K.cheek += v * 0.24; K.cheekHi += v * 0.0007; },
  hollows: (K, v) => { K.hollow += v * 0.3; },
  nose: (K, v) => { K.nose += v * 0.09; K.tip += v * 0.06; K.wings += v * 0.07; },
  bridge: (K, v) => { K.bridge += v * 0.15; K.noseNarrow = (K.noseNarrow || 0) + v * 0.05; },
  lips: (K, v) => { K.lips += v * 0.16; },
  browridge: (K, v) => { K.brow += v * 0.3; },
  eyes: (K, v) => { K.socket += v * 0.18; },
  // the eye's outline (figure.js eyeParts, and its paint in gl/figure-hd.js): K.eyeAdj is [spacing added in metres,
  // width scale, opening scale, tilt added]; eyeAdjust gives the same from a tune string
  eyesize: (K, v) => { const A = eyeAdj(K); A[1] *= 1 + 0.04 * v; A[2] *= 1 + 0.04 * v; },
  eyeopen: (K, v) => { eyeAdj(K)[2] *= 1 + 0.07 * v; },
  eyetilt: (K, v) => { eyeAdj(K)[3] += 0.012 * v; },
  eyeset: (K, v) => { eyeAdj(K)[0] += 0.0006 * v; K.eyeX = (K.eyeX || 0.031) + 0.0006 * v; },
};
const eyeAdj = (K) => (K.eyeAdj ||= [0, 1, 1, 0]);
const _eyeAdj = new Map();
export function eyeAdjust(tune) {
  if (!tune) return null;
  let A = _eyeAdj.get(tune);
  if (A === undefined) {
    const K = {};
    for (const part of String(tune).split(',')) {
      const [k, n] = part.split(':'), v = Math.max(-5, Math.min(5, Number(n) || 0));
      if (k.startsWith('eye') && k !== 'eyes' && TUNE[k] && v) TUNE[k](K, v);
    }
    A = K.eyeAdj || null;
    _eyeAdj.set(tune, A);
  }
  return A;
}
export function tunedFace(style, tune) {
  if (!tune || !FACE_STYLES[style]) return style;
  const name = style + '~' + tune;
  if (FACE_STYLES[name]) return name;
  const K = { ...FACE_STYLES[style] };
  delete K.eyeAdj;
  for (const part of String(tune).split(',')) {
    const [k, n] = part.split(':'), v = Math.max(-5, Math.min(5, Number(n) || 0));
    if (TUNE[k] && v) TUNE[k](K, v);
  }
  for (const k of ['brow', 'bridge', 'socket', 'cheek', 'hollow', 'nose', 'tip', 'wings', 'lips', 'chin', 'chinW', 'jawSq', 'noseNarrow']) K[k] = Math.max(k === 'chinW' ? 0.4 : 0, K[k] || 0);
  K.jaw = Math.max(-1.5, Math.min(2.2, K.jaw));
  FACE_STYLES[name] = K;
  return name;
}
// A sculpted head drawn on HEAD_HD: the rows there can hold the relief the coarse head left to the paint, so the
// lips are put back toward the real head's, and the rest softened: flatter, broader cheekbones over a shallower hollow (they
// stood out in profile as a triangle), a rounder brow and a gentler jaw. Not the folds: deeper, the philtrum shades
// under the nose into a moustache.
// The fine head's jaw (2026-11-21). In profile the chin was a wedge pointing forward and the jaw ran from it
// straight up to the ear; from the front the face was an egg. `square` (from the head's own `jawSq`, so a soft
// head has none) widens the jaw down to a corner level with the mouth, broadens the chin and flattens its front, and
// brings the chin's underside forward, so in profile it ends in a corner. The chin's own bump is lower and taller.
const squareJaw = (K) => { if (K.soft) return { jawSq: K.jawSq * 0.75, chinTall: 1.45, chinRound: 1 }; const q = Math.min(1.2, K.jawSq || 0); return { square: q, jawSq: K.jawSq * 1.1, jawY: K.jawSq ? 1.564 : K.jawY, chin: K.chin * (1 - 0.3 * Math.min(1, q)), chinTall: 1 + 0.4 * q, chinUp: (K.chinUp || 0) + 0.004 * Math.min(1, q), nose: K.nose * (1 - 0.36 * Math.min(1, q)), tip: K.tip * (1 - 0.1 * Math.min(1, q)), tipR: 1 + 0.4 * Math.min(1, q), lips: Math.max(K.lips, 0.95 - 0.25 * Math.min(1, q)) }; };
export function hdFace(style) {
  const name = style + '+hd';
  if (!FACE_STYLES[name]) { const K = FACE_STYLES[style]; FACE_STYLES[name] = { ...K, lips: Math.max(K.lips, 0.95), wings: K.wings * 1.1, cheek: K.cheek * 0.14, hollow: K.hollow * 0.5, cheekS: 2.0, cheekX: 0.057, cheekDy: -0.009, brow: K.brow * 0.3, browEdge: K.browEdge * 2.1, socket: K.socket * 0.6, ...squareJaw(K) }; }
  return name;
}
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
  const cS = K.cheekS || 1;
  d += K.cheek * 0.006 * gauss(ax, y, K.cheekX || 0.047, 1.6215 + K.cheekHi + (K.cheekDy || 0), 0.016 * cS, 0.012 * cS);      // cheekbones
  d -= K.hollow * 0.0035 * gauss(ax, y, 0.047, 1.59, 0.013 * cS, 0.014 * cS);       // and the hollow under them
  d += K.nose * NOSE_H(y) * Math.exp(-((x / (NOSE_W(y) * (1 - (K.noseNarrow || 0) * sstep(1.598, 1.625, y)))) ** 2));
  d += K.tip * 0.0035 * gauss(x, y, 0, 1.5985, 0.0085 * (K.tipR || 1), 0.0075 * (K.tipR || 1));        // the tip (`tipR` broadens it into a round)
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
  d += K.chin * 0.009 * gauss(x, y, 0, FACE.chinY, 0.017 * K.chinW, 0.01 * (K.chinTall || 1));        // chin
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
// The close-up face's own level, asked for by name ('hd' where a level index goes): L0's rings and
// columns with two more between each pair through the face and one more over the crown and under the
// chin, so the nose's wings, the lips, the philtrum and the jaw's line have rows to hold them. It isn't
// in HEAD_LEVELS because the street never draws it, and the street counts its levels.
const fillIn = (v, k) => v.flatMap((a, i) => (i === v.length - 1 ? [a] : Array.from({ length: k(a, v[i + 1]) }, (_, j) => a + ((v[i + 1] - a) * j) / k(a, v[i + 1]))));
export const HEAD_HD = {
  name: 'LHD', px: Infinity,
  rings: fillIn(HEAD_LEVELS[0].rings, (a, b) => ((a + b) / 2 > 1.528 && (a + b) / 2 < 1.685 ? 3 : 2)),
  xs: fillIn([0.066, ...HEAD_LEVELS[0].xs, 0], () => 3).slice(0, -1),
  back: 30, ear: [16, 10], neck: [18, 12], sheet: [20, 12],
};
const levelOf = (lv) => (lv === 'hd' ? HEAD_HD : HEAD_LEVELS[lv]);

const se = (v, n) => Math.sign(v) * Math.abs(v) ** (2 / n);
// A point on the skull at height `y` and angle `phi` round it (x = cos phi, z = sin phi), the
// face's relief included. Headwear is fitted to this (gl/ballplayer-mesh.js). `style` is a
// FACE_STYLES name.
export function skullPoint(y, phi, style = 'real') {
  const K = FACE_STYLES[style] || FACE_STYLES.real;
  const S = station(y), c = Math.cos(phi), s = Math.sin(phi);
  // `chinFlat` squares the front below the mouth, so the chin ends in a flat front with corners, not a point
  const sq = K.square || 0;
  const n = s > 0 ? S.nf * (1 + ((K.chinFlat || 0) + 0.3 * sq) * sstep(1.585, 1.54, y)) : 2.1;
  // the jaw's width from the cheekbones down, most at the chin (the comic style's is a little wider)
  let x = (S.w + sq * 0.012 * sstep(1.562, 1.528, y) + sq * 0.012 * sstep(1.546, 1.524, y) + sq * 0.002 * sstep(1.622, 1.566, y) + (K.chinRound || 0) * 0.005 * sstep(1.552, 1.527, y)) * se(c, n) * (1 - K.jaw * 0.1 * sstep(1.615, 1.53, y) * (0.4 + 0.6 * Math.max(0, s)));
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
  if (sq && s > 0) z += sq * 0.014 * clamp01((1.541 - y) / 0.0175) ** 1.6 * s;
  // and the chin's front is a plane all the way down. It stood forward for a centimetre under the lip and then
  // fell away to the neck, so in profile the chin was a small point; filled, it's flat to a low rounded turn
  if (sq && s > 0) z += sq * 0.012 * sstep(1.532, 1.5235, y) * (1 - 0.25 * sstep(1.5225, 1.5195, y)) * s;
  // a soft head's chin is a round: its front carried a little further down before it turns under, and that turn eased,
  // where it ran forward to a point and then straight back along the jaw
  if (K.chinRound && s > 0) z += K.chinRound * 0.012 * Math.exp(-(((y - 1.524) / 0.008) ** 2)) * s;
  // and the jaw's underside carried back nearly level to its corner, instead of climbing straight to the ear
  if (sq && s < 0) z += sq * 0.011 * sstep(1.562, 1.529, y) * s;
  if (K.fat && s > 0) z += K.fat * s * (0.018 * gauss(Math.abs(x), y, 0.052, 1.592, 0.032, 0.032) + 0.01 * sstep(1.54, 1.524, y));
  if (K.asym && s > 0) {
    z += K.asym * 0.0014 * gauss(x, y, 0.045, 1.62, 0.02, 0.02);   // the left cheekbone a little fuller
    x += K.asym * 0.0011 * gauss(x, y, 0, 1.6, 0.013, 0.022);      // the nose a little off true
  }
  return [x, y + (K.chinUp || 0) * sstep(1.556, 1.522, y) - (K.fat || 0) * 0.012 * sstep(1.542, 1.524, y), z];
}
// The sculpted eye's opening, by face: its centre's half-width, half its length, how far the lids stand above
// and below the middle, and how much it tilts up to the outer corner. gl/figure-hd.js draws the same curve.
export const EYE = { y: 1.6398, man: { x: 0.0328, w: 0.0195, t: 0.0056, b: 0.0034, tilt: 0.035 }, soft: { x: 0.0312, w: 0.0182, t: 0.0066, b: 0.0042, tilt: 0.12 } };
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
// (2026-11-22: clear of the ear, which is 63 mm now and reaches 1.662: over it the line is above its top, in front of
// it a short sideburn, and behind it the line comes down to half way down the ear before it runs to the nape)
// (and the same day: down behind the ear to its lobe, then nearly level across the nape, where it was a V to a
// point with bare skin either side of it)
// (and a sideburn: in front of the ear the line comes down to the middle of it and stands close against it)
export const HAIRLINE_SCULPT = [1.697, 1.695, 1.687, 1.672, 1.65, 1.606, 1.664, 1.669, 1.614, 1.592, 1.584, 1.581, 1.58];
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
  const L = levelOf(lv), ys = L.rings;
  const pts = ys.map((y) => ringPhis(L, y).map((phi) => skullPoint(y, phi, style)));
  const n = pts[0].length;
  const top = [0, FACE.top, ZC], bot = [0, FACE.chin + (FACE_STYLES[style]?.chinUp || 0) - (FACE_STYLES[style]?.fat || 0) * 0.012, 0.05 - 0.018 * (FACE_STYLES[style]?.square || 0)];
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

// The fine head's ear (HEAD_HD, sculpted): modelled rather than painted. A front face over the ear's outline with its
// relief laid on (the rolled rim over the top and down the back, the groove inside it, the ridge inside that, the
// bowl, the flap in front of the bowl and a full lobe), the rim curled over the edge, and a plain back face toward the
// skull. Placed as addEar places its ear, but further out and flared more, so it stands off the head clear of the
// hair. `aux` is 2 plus how deep in the bowl a point is, so gl/figure-hd.js can tell the folds are modelled and paints
// only the bowl's shade.
const g1 = (x, x0, s) => Math.exp(-(((x - x0) / s) ** 2));
function addEarFine(M, side) {
  // (63 mm tall, its top level with the brow and its lobe with the base of the nose, leaning back a little more: at
  // 51 mm and centred lower it was a small ear set low, with a long bare stretch under it down to the jaw's corner)
  const ry = 0.0315, rz = 0.0182, tilt = -0.26, flare = -0.34 * side, nu = 32;
  const place = (lx, ly, lz) => {
    const y = ly * Math.cos(tilt) - lz * Math.sin(tilt), z = ly * Math.sin(tilt) + lz * Math.cos(tilt);
    const x = lx * side, pz = rz * 0.75, dz = z - pz;
    const x2 = x * Math.cos(flare) + dz * Math.sin(flare), z2 = -x * Math.sin(flare) + dz * Math.cos(flare) + pz;
    return [x2 + 0.0705 * side, y + 1.6305, z2 - 0.018];
  };
  // the outline, angle th round the middle (cos toward the face, sin up): an egg wider at the top, narrowing to the
  // lobe, a little flatter along the front where it joins the head
  const outline = (th) => { const c = Math.cos(th), s = Math.sin(th); return [rz * c * (1 - 0.18 * Math.max(0, c)) * (1 - 0.32 * sstep(0, -1, s)), ry * s]; };
  const bowl = (z, y) => Math.max(0, 1 - ((z - 0.16 * rz) / (0.44 * rz)) ** 2 - ((y + 0.12 * ry) / (0.42 * ry)) ** 2) ** 1.4;
  const front = (r, th) => {
    const [oz, oy] = outline(th), z = oz * r, y = oy * r, up = Math.sin(th), fr = Math.cos(th);
    const helix = sstep(-0.82, -0.45, up) * (fr > 0 ? sstep(0.0, 0.45, up) : 1);
    const anti = sstep(-0.55, -0.15, up) * (1 - sstep(0.25, 0.7, fr));
    const lobe = sstep(-0.5, -0.9, up);
    const b = bowl(z, y);
    let h = 0.0016 + 0.0042 * r * r
      + 0.0034 * helix * g1(r, 0.88, 0.07) - 0.0011 * helix * g1(r, 0.75, 0.045)
      + 0.0022 * anti * g1(r, 0.58, 0.085)
      - 0.0058 * b
      + 0.0026 * gauss(z, y, 0.64 * rz, -0.16 * ry, 0.13 * rz, 0.17 * ry)
      + 0.0016 * lobe * (1 - r * r);
    return { p: [h, y, z], b };
  };
  const rings = [], fr = [0.12, 0.24, 0.36, 0.46, 0.55, 0.63, 0.7, 0.76, 0.81, 0.86, 0.9, 0.94, 0.97, 1.0];
  const ths = Array.from({ length: nu }, (_, k) => (k * TAU) / nu);
  const v = (p, b) => M.v(place(p[0], p[1], p[2]), 8, 1, Math.max(0, p[1] / ry) ** 2, 2 + b);
  for (const r of fr) rings.push(ths.map((th) => { const f = front(r, th); return v(f.p, f.b); }));
  // the rim curled over the edge, then the back face in toward the middle
  rings.push(ths.map((th) => { const f = front(1, th), [oz, oy] = outline(th); return v([f.p[0] * 0.45 - 0.0006, oy * 1.03, oz * 1.03], 0); }));
  for (const [r, lx] of [[1.0, -0.0022], [0.7, -0.003], [0.35, -0.0034]]) rings.push(ths.map((th) => { const [oz, oy] = outline(th); return v([lx, oy * r, oz * r], 0); }));
  const c0 = front(0, 0), top = v(c0.p, c0.b), bot = v([-0.0035, 0, 0], 0);
  // wound outward, as the skull is; the mirror flips it
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
function addNeck(M, n, rows, k = 1, fineNeck = false, adam = false) {
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
        // and its top wider at the sides and the back, up under the skull: the column was 3 cm narrower than the
        // head behind the ears, which stood out over it as a ledge with nothing running down from it into the neck
        // (a little, and only close under the skull: more of it stood out under the jaw as a ring round the neck)
        { const fl = sstep(1.55, 1.6, y); px *= 1 + 0.13 * fl * Math.abs(c); if (s < 0) pz *= 1 + 0.12 * fl; }
        // drawn in a little at the middle of its height, and the ridges standing out of it
        const pinch = 1 - 0.035 * Math.exp(-(((y - 1.52) / 0.03) ** 2)), ridge = 1 + 0.085 * scmRidge(ph, y);
        px *= pinch * ridge; pz *= pinch * ridge;
        // the floor of the mouth: under the chin the throat comes forward to meet the jaw's underside and slopes back
        // down to the Adam's apple. A straight column met the jaw's underside at a right angle in profile
        if (s > 0) pz += 0.034 * sstep(1.482, 1.532, y) * s ** 1.5;
        // a man's Adam's apple: a small firm bump on the front of the throat, under the fold below the chin
        if (adam && s > 0) pz += 0.0075 * Math.exp(-(((y - 1.494) / 0.0105) ** 2)) * s ** 10;
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
  const L = levelOf(lv), G = grid(lv, style), M = builder(), n = G.n;
  const ti = M.v(G.top, 7), rings = G.pts.map((r) => r.map((p) => M.v(p, 7))), bi = M.v(G.bot, 7);
  for (let k = 0; k < n; k++) M.t(ti, rings[0][(k + 1) % n], rings[0][k]);
  stitch(M, rings);
  const R = rings[rings.length - 1];
  for (let k = 0; k < n; k++) M.t(R[k], R[(k + 1) % n], bi);
  const sculpt = style.startsWith('sculpt');
  if (L === HEAD_HD && sculpt) { addEarFine(M, 1); addEarFine(M, -1); } else { addEar(M, 1, ...L.ear, sculpt); addEar(M, -1, ...L.ear, sculpt); }
  addNeck(M, ...L.neck, sculpt ? NECK_SCULPT : 1, fineNeck, sculpt && !FACE_STYLES[style]?.soft);
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
  const key = lv === 'hd' ? `hd${style}${sculpt ? 's' : ''}` : lv * HAIR_STYLES + style + (sculpt ? 100 : 0);
  if (_hair[key]) return _hair[key];
  const L = levelOf(lv), G = grid(lv, sculpt ? 'sculpt' : 'real'), M = builder(), n = G.n, line = sculpt ? HAIRLINE_SCULPT : HAIRLINE;
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
