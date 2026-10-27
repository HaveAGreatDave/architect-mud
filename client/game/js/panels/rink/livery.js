// Rinkside · the Zamboni's Cup final livery. On the night of the Coldwater Cup final the
// tank goes black and Ken Raven's name is sprayed down both flanks like a wall piece: a
// gold "Ken" tag over fat purple RAVEN letters with a gold edge, a 3-D drop, drips and a
// gold crown on the R, and a raven perched on a branch across a gold ring beside them.
//
// It's painted once onto a canvas. render.js lays the canvas on the tank's flank in the
// 2-D view; gl/arena.js puts it in the lettering texture under ICE CREW.
//
// Pure canvas: no world. The spray is from a fixed seed, so every viewer's tank is the
// same tank.

// the machine's colours on Cup night, over the boxes' everyday ones (render.js ZB)
export const FINAL = { tank: '#141217', chassis: '#1b1820', band: '#6a2bb8', trim: '#e2b33a' };
// the everyday colour each one replaces (the blue bands and the driver's cap go purple)
const RECOLOUR = { '#eceff2': FINAL.chassis, '#f4f6f8': FINAL.tank, '#1f4fbf': FINAL.band, '#c9ced3': FINAL.trim };
export const cupColour = (col, cup) => (cup && RECOLOUR[col]) || col;
// the flank the piece covers, in the tank box's own feet: [u0, u1] along it, [z0, z1] up it
export const FLANK = { u: [0.35, 4.6], z: [2.98, 5.5] };
export const LIVERY_W = 512, LIVERY_H = 300;

const PURPLE = '#7b35d0', PURPLE_LT = '#b98af5', PURPLE_DK = '#2b0f55', GOLD = '#f2c230', GOLD_DK = '#9a6f14', INK = '#0b0a0d', WHITE = '#fffaf0';
const BLOCK = '900 116px Impact, "Arial Black", "Saira Condensed", sans-serif';
const TAG = 'italic 800 58px "Segoe Script", "Brush Script MT", "Saira Condensed", cursive';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// A raven in profile, perched on a branch that runs across the ring, facing the letters:
// the heavy beak, the shaggy throat and the long wedge tail a raven has and a crow hasn't.
// Centred on 0,0 in units of the mark's size.
// Built from parts (body, head, beak, throat hackles, tail) that are stroked and then
// filled together, so the outline only runs round the whole bird.
const poly = (x, P) => { x.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) x.lineTo(P[i][0], P[i][1]); x.closePath(); };
function birdPath(x) {
  x.beginPath();
  x.ellipse(-0.03, -0.01, 0.145, 0.25, 0.45, 0, Math.PI * 2); x.closePath();
  x.moveTo(0.2, -0.3); x.arc(0.105, -0.3, 0.095, 0, Math.PI * 2); x.closePath();
  x.moveTo(0.15, -0.345); x.quadraticCurveTo(0.27, -0.35, 0.37, -0.29); x.quadraticCurveTo(0.27, -0.27, 0.16, -0.24); x.closePath();
  poly(x, [[0.11, -0.25], [0.205, -0.225], [0.15, -0.195], [0.205, -0.165], [0.14, -0.14], [0.18, -0.105], [0.08, -0.12]]);
  poly(x, [[-0.16, 0.12], [-0.28, 0.41], [-0.235, 0.445], [-0.19, 0.425], [-0.06, 0.16]]);
}
function branchPath(x) {
  x.beginPath();
  x.moveTo(-0.62, 0.215); x.quadraticCurveTo(-0.1, 0.15, 0.6, 0.115);
  x.lineTo(0.61, 0.15); x.quadraticCurveTo(-0.1, 0.215, -0.6, 0.29); x.closePath();
  // a twig up off the left end, one down off the right, and a knot
  x.moveTo(-0.44, 0.22); x.quadraticCurveTo(-0.52, 0.13, -0.57, 0.05); x.lineTo(-0.535, 0.045); x.quadraticCurveTo(-0.47, 0.13, -0.39, 0.21); x.closePath();
  x.moveTo(0.36, 0.14); x.quadraticCurveTo(0.43, 0.22, 0.51, 0.27); x.lineTo(0.49, 0.295); x.quadraticCurveTo(0.41, 0.25, 0.32, 0.15); x.closePath();
  x.moveTo(0.22, 0.155); x.arc(0.2, 0.16, 0.03, 0, Math.PI * 2);
}
function feet(x) {
  x.beginPath();
  for (const fx of [-0.04, 0.02]) { x.moveTo(fx, 0.12); x.lineTo(fx + 0.015, 0.175); x.moveTo(fx + 0.015, 0.175); x.lineTo(fx + 0.05, 0.19); x.moveTo(fx + 0.015, 0.175); x.lineTo(fx - 0.02, 0.2); }
}
function raven(x, cx, cy, size) {
  x.save();
  // the gold ring behind it
  const rr = size * 0.4;
  x.lineWidth = size * 0.08; x.strokeStyle = INK; x.beginPath(); x.arc(cx, cy, rr, 0, Math.PI * 2); x.stroke();
  x.lineWidth = size * 0.045; x.strokeStyle = GOLD; x.beginPath(); x.arc(cx, cy, rr, 0, Math.PI * 2); x.stroke();
  x.fillStyle = 'rgba(123,53,208,0.55)'; x.beginPath(); x.arc(cx, cy, rr - size * 0.03, 0, Math.PI * 2); x.fill();
  x.translate(cx, cy); x.scale(size, size);
  x.lineJoin = 'round'; x.lineCap = 'round';
  // a purple drop, then an ink edge round a gold one round the bird and the branch together,
  // so the two read as one mark, then both in ink
  const both = (fn) => { branchPath(x); fn(); birdPath(x); fn(); };
  x.save(); x.translate(0.025, 0.03); both(() => { x.fillStyle = PURPLE_DK; x.fill(); }); x.restore();
  both(() => { x.lineWidth = 0.06; x.strokeStyle = INK; x.stroke(); });
  feet(x); x.lineWidth = 0.06; x.strokeStyle = INK; x.stroke();
  both(() => { x.lineWidth = 0.032; x.strokeStyle = GOLD; x.stroke(); });
  feet(x); x.lineWidth = 0.032; x.strokeStyle = GOLD; x.stroke();
  both(() => { x.fillStyle = INK; x.fill(); });
  feet(x); x.lineWidth = 0.016; x.strokeStyle = INK; x.stroke();
  // the sheen along the folded wing
  x.strokeStyle = PURPLE_LT; x.lineWidth = 0.014;
  x.beginPath(); x.moveTo(0.03, -0.2); x.quadraticCurveTo(-0.1, -0.04, -0.19, 0.16); x.stroke();
  x.beginPath(); x.moveTo(0.06, -0.1); x.quadraticCurveTo(-0.03, 0.02, -0.11, 0.12); x.stroke();
  x.restore();
}

// a soft cloud of spray, the way a can lays paint on a wall
function cloud(x, cx, cy, r, rgb, a) {
  const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
  x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
}
function drip(x, px, py, len, w, col) {
  x.fillStyle = col;
  x.fillRect(px - w / 2, py, w, len);
  x.beginPath(); x.arc(px, py + len, w * 0.75, 0, Math.PI * 2); x.fill();
}
function sparkle(x, px, py, r, col = WHITE) {
  x.fillStyle = col; x.beginPath();
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, rr = i % 2 ? r * 0.22 : r; x.lineTo(px + Math.cos(a) * rr, py + Math.sin(a) * rr); }
  x.closePath(); x.fill();
}
// the graffiti crown: three points with a ball on each, a band under them
function crown(x, cx, cy, w, rot) {
  x.save(); x.translate(cx, cy); x.rotate(rot); x.lineJoin = 'round';
  const h = w * 0.62, pts = [[-0.5, 0], [-0.5, -0.55], [-0.25, -0.22], [0, -0.75], [0.25, -0.22], [0.5, -0.55], [0.5, 0]];
  const path = () => { x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(a * w, b * h) : x.moveTo(a * w, b * h))); x.closePath(); };
  path(); x.lineWidth = 9; x.strokeStyle = INK; x.stroke();
  const g = x.createLinearGradient(0, -h * 0.75, 0, 0); g.addColorStop(0, '#fff1a8'); g.addColorStop(0.45, GOLD); g.addColorStop(1, GOLD_DK);
  path(); x.fillStyle = g; x.fill();
  x.fillStyle = INK; x.fillRect(-w * 0.54, -2, w * 1.08, h * 0.24 + 4);
  x.fillStyle = GOLD; x.fillRect(-w * 0.5, 0, w, h * 0.24);
  for (const [a, b] of [[-0.5, -0.55], [0, -0.75], [0.5, -0.55]]) {
    x.fillStyle = INK; x.beginPath(); x.arc(a * w, b * h - 4, 8, 0, Math.PI * 2); x.fill();
    x.fillStyle = GOLD; x.beginPath(); x.arc(a * w, b * h - 4, 5, 0, Math.PI * 2); x.fill();
  }
  x.fillStyle = PURPLE; for (const a of [-0.25, 0.25]) { x.beginPath(); x.arc(a * w, h * 0.12, 3.5, 0, Math.PI * 2); x.fill(); }
  x.restore();
}

// The piece on its own canvas, painted the first time it's asked for.
let _canvas = null;
export function liveryCanvas(doc) {
  if (!_canvas && doc) { _canvas = doc.createElement('canvas'); _canvas.width = LIVERY_W; _canvas.height = LIVERY_H; paintLivery(_canvas.getContext('2d')); }
  return _canvas;
}

// Paint the piece onto a w × h canvas context (LIVERY_W × LIVERY_H is what it's laid out for).
export function paintLivery(x, w = LIVERY_W, h = LIVERY_H) {
  const r = rng(0x4b52);
  x.save(); x.scale(w / LIVERY_W, h / LIVERY_H);
  const W = LIVERY_W, H = LIVERY_H;
  x.fillStyle = FINAL.tank; x.fillRect(0, 0, W, H);
  // the wall behind the piece: purple and smoke clouds, then a gold speckle of overspray
  for (let i = 0; i < 9; i++) cloud(x, 140 + r() * 360, 60 + r() * 190, 60 + r() * 70, '123,53,208', 0.3 + r() * 0.2);
  for (let i = 0; i < 6; i++) cloud(x, r() * W, r() * H, 50 + r() * 60, '60,52,72', 0.35);
  x.fillStyle = 'rgba(242,194,48,0.55)';
  for (let i = 0; i < 220; i++) { const px = r() * W, py = r() * H; x.fillRect(px, py, 1 + r() * 1.5, 1 + r() * 1.5); }
  raven(x, 104, 150, 176);
  // RAVEN: block letters, each tipped and bounced a little, with a deep purple drop, an ink
  // outline, a gold edge inside it, a purple fill, drips and shines
  x.font = BLOCK; x.textBaseline = 'alphabetic'; x.lineJoin = 'round'; x.lineCap = 'round';
  const word = 'RAVEN', base = 240, x0 = 206, span = 262;
  const widths = [...word].map((c) => x.measureText(c).width);
  const k = span / widths.reduce((a, b) => a + b - 6, 0);
  const letters = []; let lx = x0;
  for (let i = 0; i < word.length; i++) {
    const cw = widths[i] * k;
    letters.push({ c: word[i], x: lx + cw / 2, y: base + [6, -10, 4, -8, 2][i], rot: [-0.09, 0.05, -0.04, 0.08, -0.06][i], cw });
    lx += cw - 6 * k;
  }
  const each = (fn) => letters.forEach((L) => { x.save(); x.translate(L.x, L.y); x.rotate(L.rot); x.transform(1, 0, -0.12, 1, 0, 0); x.scale(k, 1.08); fn(L); x.restore(); });
  x.textAlign = 'center';
  for (let d = 12; d > 0; d -= 2) each((L) => { x.fillStyle = d > 10 ? INK : PURPLE_DK; x.fillText(L.c, d * 0.9 / k, d * 0.7); });
  each((L) => { x.strokeStyle = INK; x.lineWidth = 18 / k; x.strokeText(L.c, 0, 0); });
  each((L) => { x.strokeStyle = GOLD; x.lineWidth = 7 / k; x.strokeText(L.c, 0, 0); });
  each((L) => {
    const g = x.createLinearGradient(0, -86, 0, 0); g.addColorStop(0, PURPLE_LT); g.addColorStop(0.45, PURPLE); g.addColorStop(1, PURPLE_DK);
    x.fillStyle = g; x.fillText(L.c, 0, 0);
    x.strokeStyle = 'rgba(255,250,240,0.6)'; x.lineWidth = 3 / k; x.beginPath(); x.moveTo(-L.cw / k * 0.3, -78); x.lineTo(-L.cw / k * 0.3, -56); x.stroke();
  });
  for (const L of letters) for (let j = 0; j < 2; j++) if (r() < 0.75) drip(x, L.x - L.cw * 0.3 + r() * L.cw * 0.6, L.y + 4, 10 + r() * 28, 3 + r() * 2.5, PURPLE);
  // the gold crown, tipped on the R
  crown(x, letters[0].x - 2, letters[0].y - 104, 54, -0.16);
  // Ken: the tag over it, in gold with an ink edge, and a swoosh under
  x.save(); x.translate(262, 104); x.rotate(-0.1);
  x.font = TAG; x.textAlign = 'left';
  x.strokeStyle = INK; x.lineWidth = 9; x.strokeText('Ken', 0, 0);
  x.fillStyle = GOLD; x.fillText('Ken', 0, 0);
  x.strokeStyle = GOLD; x.lineWidth = 5; x.beginPath(); x.moveTo(-4, 14); x.quadraticCurveTo(70, 30, 150, 4); x.stroke();
  x.fillStyle = GOLD; x.beginPath(); x.moveTo(152, 3); x.lineTo(137, -3); x.lineTo(141, 12); x.closePath(); x.fill();
  x.restore();
  sparkle(x, 452, 112, 14, GOLD); sparkle(x, 222, 92, 9); sparkle(x, 484, 262, 8, GOLD);
  // the edges fade back into the tank, so the piece sits on the machine rather than on a sheet
  const fade = (x0, x1) => { const g = x.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, 'rgba(20,18,23,1)'); g.addColorStop(1, 'rgba(20,18,23,0)'); x.fillStyle = g; x.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), H); };
  fade(0, 10); fade(W, W - 10);
  x.restore();
}
