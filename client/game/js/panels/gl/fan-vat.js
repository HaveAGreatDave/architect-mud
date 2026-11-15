// GLASS · THE STANDS' FANS, BAKED INTO A TEXTURE.
//
// Everybody in the stands at the Coliseum and the rink is this figure: the street's body (actor3d.js
// actorFanBody, the sculpted close-up figure cut down) without its head, a head of its own built
// here off actor-head.js's sculpted skull, and a face laid on it in a few dozen flat triangles. Its
// clips (actor3d.js FAN_CLIPS and three of ROOM's seated ones) are baked into one RGBA32F texture, a
// column a vertex and a row a frame, so the vertex shader (gl/crowd.js FAN_GLSL) poses a fan with a
// texel fetch or two and the CPU does nothing a frame.
//
//   · THE TEXTURE. Texel (v, row): the vertex's place in feet (xyz) and its normal packed into w,
//     two 12-bit octahedral halves as one exact integer. The last column is the head's pivot (the
//     head bone's joint) and in w how far the jaw is open, for the head's turn toward the play.
//     Every frame is dropped so the lowest point of the body is on the ground, as the street's bake
//     drops its own.
//   · TWO LEVELS. `far` (about 650 triangles) for anybody from the card's 9 px up, and `near`
//     (about 1,900) for a fan big on the screen: a long lens on the stands, the man beside you in a
//     seat. Both share the clips' rows, so one shader and one table serve both.
//   · THE FACE is triangles, not a texture: an almond of white and an iris for each eye with a lash
//     line over it, brows, the upper and lower lip and the mouth between them, which opens when the
//     clip shouts (each clip's `jaw`), and the nostrils' shade. The nose, the brow's shelf, the
//     cheekbones and the jaw are the skull's own shape at the rings that carry them.
//   · THE GROUPS each fan wears or doesn't (FAN_GROUP): his hair cropped or long, a cap, a beard,
//     glasses, a rally towel. A group he doesn't wear is folded to one point in the shader.
//   · WHO HE IS. Each vertex carries how far it moves along its normal for a thin, an average and a
//     heavy build and for a woman's (`aBody`), and the head how far it moves to the soft (woman's)
//     skull (`aAlt`), so a stand is many people from one bake.
//
// Pure: no DOM, no GL, so a worker can bake it (fan-vat-worker.js) and the gate measure it
// (scripts/shapes/fan-vat.mjs). Units are bind space (metres, Y up, facing +Z, the figure's left on
// +X) until the bake writes feet.

import { actorFanBody, actorFanSkin, ACTOR_MAT } from '../actor3d.js';
import { FIGURE_BONES } from '../figure.js';
import { skullPoint, FACE, EYE, NECK, hairlineAt, HAIRLINE_SCULPT, ZC } from '../actor-head.js';
import { FT_M } from '../../../../shared/world-scale.js';

const FT = 1 / FT_M;
const TAU = Math.PI * 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const BONE = {};
FIGURE_BONES.forEach((b, i) => { BONE[b[0]] = i; });
// each bone's joint in bind space
const JOINT = [];
FIGURE_BONES.forEach(([, p, o], i) => { JOINT[i] = p < 0 ? o.slice() : add(JOINT[p], o); });

// ⚠ THE PART IS A CODE THE SHADER COLOURS BY (gl/crowd.js FAN_GLSL `fanAlbedo`): append, never renumber.
export const FAN_PART = Object.freeze({ skin: 0, shirt: 1, legs: 2, shoes: 3, hair: 4, white: 5, iris: 6, ink: 7, brow: 8, lip: 9, lipLow: 10, mouth: 11, cap: 12, brim: 13, beard: 14, lens: 15, towel: 16, shade: 17 });
// What a fan may or may not wear. 0 is everybody's.
export const FAN_GROUP = Object.freeze({ all: 0, crop: 1, long: 2, cap: 3, beard: 4, glasses: 5, towel: 6 });
// Floats a vertex in the static buffer: part, group, turn (how much it follows the head's turn),
// the four build offsets along the normal (ft) and the soft head's offset (ft).
export const FAN_STATIC = 10;
const P = FAN_PART, G = FAN_GROUP;
const BODY_PART = { [ACTOR_MAT.skin]: P.skin, [ACTOR_MAT.coat]: P.shirt, [ACTOR_MAT.legs]: P.legs, [ACTOR_MAT.shoes]: P.shoes };

// ── The clips ─────────────────────────────────────────────────────────────────────────────────────
// Rows in the texture, in this order. `src` is the actor3d.js clip (actorFanSkin knows both its own
// and ROOM's), `frames` how many rows, `dur` seconds a cycle, `once` a clip played by a value 0 to 1
// rather than looping on the clock (the rise, by how far up he is). `jaw` is how far his mouth is
// open through the cycle, 0 shut to 1 shouting. ⚠ gl/crowd.js picks clips by these names.
const shout = (base, beat, n = 2) => (p) => clamp01(base + beat * Math.abs(Math.sin(Math.PI * n * p)));
export const FAN_CLIPS = (() => {
  const list = [
    { name: 'sit', src: 'fanSit', frames: 12, dur: 9 },
    { name: 'rest', src: 'sitRest', frames: 12, dur: 10 },
    { name: 'lean', src: 'sitLean', frames: 10, dur: 10 },
    { name: 'fold', src: 'sitFold', frames: 10, dur: 10 },
    { name: 'sitClap', src: 'fanSitClap', frames: 10, dur: 0.9, jaw: () => 0.12 },
    { name: 'despair', src: 'fanDespair', frames: 10, dur: 7, jaw: (p) => 0.25 + 0.1 * Math.sin(TAU * p) },
    { name: 'rise', src: 'fanRise', frames: 9, dur: 1, once: true },
    { name: 'cheer', src: 'cheer', frames: 16, dur: 1.2, jaw: shout(0.45, 0.55) },
    { name: 'clap', src: 'fanClap', frames: 12, dur: 0.9, jaw: shout(0.2, 0.4, 1) },
    { name: 'fist', src: 'fanFist', frames: 14, dur: 1.4, jaw: shout(0.35, 0.65) },
    { name: 'cup', src: 'fanCup', frames: 10, dur: 2.2, jaw: shout(0.7, 0.3, 3) },
    { name: 'towel', src: 'fanTowel', frames: 14, dur: 1.1, jaw: shout(0.5, 0.4) },
  ];
  let row = 0;
  for (const c of list) { c.row0 = row; row += c.frames; }
  return Object.freeze(list.map((c) => Object.freeze(c)));
})();
export const FAN_ROWS = FAN_CLIPS.reduce((n, c) => n + c.frames, 0);
export const fanClip = (name) => FAN_CLIPS.find((c) => c.name === name);

// ── The two levels ────────────────────────────────────────────────────────────────────────────────
// `tris` the body's budget; the head's rings (heights, crown to under the chin) carry its landmarks:
// the brow's shelf, the eyes, the cheekbones, the nose's tip and base, the lips and the chin. `xs` are
// the face's columns either side of the middle one, `back` the columns round the back of the head.
export const FAN_LEVELS = Object.freeze({
  far: Object.freeze({ tris: 430, rings: [1.733, 1.69, 1.657, 1.637, 1.6, 1.5652, 1.537], xs: [0.046, 0.02], back: 5, neck: 6, hair: 2, face: 'far' }),
  near: Object.freeze({ tris: 1100, rings: [1.742, 1.718, 1.688, 1.664, 1.652, 1.6395, 1.622, 1.6075, 1.5985, 1.587, 1.5765, 1.5652, 1.551, 1.5365, 1.5265], xs: [0.058, 0.042, 0.027, 0.013], back: 7, neck: 8, hair: 4, face: 'near' }),
});

// ── The head ──────────────────────────────────────────────────────────────────────────────────────
const MAN = 'sculpt', SOFT = 'sculptSoft';
// the angle round the skull, at height y, whose point is `x` across: the front's columns
function phiAt(x, y, style = MAN) {
  if (x === 0) return Math.PI / 2;
  let lo = 0.02, hi = Math.PI / 2;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (skullPoint(y, m, style)[0] > Math.abs(x)) lo = m; else hi = m; }
  const a = (lo + hi) / 2;
  return x > 0 ? a : Math.PI - a;
}
// a ring's angles, phi increasing (x = cos, z = sin): the face's columns, then evenly round the back.
// Rings above the brow and below the mouth take the angles of the eyes' ring and the chin's, so the
// columns run straight down the face rather than crowding where the skull narrows.
function ringPhis(L, y) {
  const yy = Math.max(1.552, Math.min(1.672, y));
  const xs = [...L.xs, 0, ...L.xs.slice().reverse().map((x) => -x)];
  const front = xs.map((x) => phiAt(x, yy));
  const a = front[front.length - 1], b = front[0] + TAU, out = front.slice();
  for (let k = 1; k <= L.back; k++) out.push(a + ((b - a) * k) / (L.back + 1));
  return out;
}
const CENTRE = [0, 1.64, ZC];
// the point on the skin at (x across, y up) on the front of the face, and the way out of it
function surf(x, y, style = MAN) { return skullPoint(y, phiAt(x, y, style), style); }
function surfN(x, y, style = MAN) {
  const h = 0.0015, dx = sub(surf(x + h, y, style), surf(x - h, y, style)), dy = sub(surf(x, y + h, style), surf(x, y - h, style));
  let n = norm(cross(dx, dy));
  if (n[2] < 0) n = mul(n, -1);
  return n;
}
// where the jaw takes a point of the head when the mouth opens: everything under the mouth's line at
// the front, fading out round the cheeks and back to the angle of the jaw
function jawOf(p) { return sstep(1.5655, 1.553, p[1]) * sstep(-0.035, 0.03, p[2]); }
const JAW_DROP = 0.014, JAW_BACK = 0.004;

function builder() {
  const M = { p: [], part: [], group: [], turn: [], b0: [], b1: [], w: [], body: [], alt: [], jaw: [], I: [] };
  // a vertex: where, its part and group, how much it turns with the head, its two bones and the
  // first one's weight, its build offsets, its soft-head offset and how far the jaw takes it
  M.v = (p, part, group, o = {}) => {
    M.p.push(p[0], p[1], p[2]); M.part.push(part); M.group.push(group); M.turn.push(o.turn ?? 1);
    M.b0.push(o.b0 ?? BONE.head); M.b1.push(o.b1 ?? BONE.head); M.w.push(o.w ?? 1);
    const b = o.body || [0, 0, 0, 0]; M.body.push(b[0], b[1], b[2], b[3]);
    const a = o.alt || [0, 0, 0]; M.alt.push(a[0], a[1], a[2]);
    M.jaw.push(o.jaw ?? 0);
    return M.part.length - 1;
  };
  const at = (i) => [M.p[i * 3], M.p[i * 3 + 1], M.p[i * 3 + 2]];
  // a triangle wound so its face points along `out` (a direction, or a point it faces away from)
  M.t = (a, b, c, out) => {
    const n = cross(sub(at(b), at(a)), sub(at(c), at(a)));
    let o = out;
    if (!o) o = sub(at(a), CENTRE);
    else if (o.from) o = sub(add(add(at(a), at(b)), at(c)).map((v) => v / 3), o.from);
    if (dot(n, o) < 0) M.I.push(a, c, b); else M.I.push(a, b, c);
  };
  M.q = (a, b, c, d, out) => { M.t(a, b, c, out); M.t(a, c, d, out); };
  return M;
}

// The skull and the neck. Every point is worked out on the man's skull and on the soft one at the
// same height and angle, so the two share their topology and the difference is the alt.
function addHead(M, L) {
  const rings = L.rings.map((y) => ringPhis(L, y).map((phi) => {
    const p = skullPoint(y, phi, MAN), q = skullPoint(y, phi, SOFT);
    return M.v(p, P.skin, G.all, { alt: sub(q, p), jaw: jawOf(p) });
  }));
  const n = rings[0].length;
  const top = M.v([0, FACE.top, ZC], P.skin, G.all);
  const chinY = FACE.chin, softChin = FACE.chin + 0.011;
  const bot = M.v([0, chinY, 0.05], P.skin, G.all, { alt: [0, softChin - chinY, 0], jaw: 1 });
  for (let k = 0; k < n; k++) M.t(top, rings[0][(k + 1) % n], rings[0][k]);
  for (let j = 0; j + 1 < rings.length; j++) for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    M.q(rings[j][k], rings[j][k1], rings[j + 1][k1], rings[j + 1][k]);
  }
  const R = rings[rings.length - 1];
  for (let k = 0; k < n; k++) M.t(R[k], R[(k + 1) % n], bot, [0, -1, 0.4]);
  // the neck, an open tube from inside the skull down into the collar, the head's turn fading out
  // down it as its bones do
  const rowAt = (y) => {
    for (let i = 0; i + 1 < NECK.length; i++) {
      const a = NECK[NECK.length - 1 - i], b = NECK[NECK.length - 2 - i];
      if (y <= a[0] && y >= b[0]) { const t = (a[0] - y) / (a[0] - b[0]); return a.map((v, k) => v + (b[k] - v) * t); }
    }
    return y > NECK[NECK.length - 1][0] ? NECK[NECK.length - 1] : NECK[0];
  };
  const neck = [1.59, 1.52, 1.43].map((y) => {
    const [, rx, rz, cz] = rowAt(y), W = sstep(1.495, 1.565, y), out = [];
    for (let j = 0; j < L.neck; j++) {
      const ph = (j * TAU) / L.neck;
      out.push(M.v([rx * Math.cos(ph), y, cz + rz * Math.sin(ph) * (Math.sin(ph) > 0 ? 0.92 : 1)], P.skin, G.all, { turn: W, b0: BONE.head, b1: BONE.neck, w: W }));
    }
    return out;
  });
  for (let r = 0; r + 1 < neck.length; r++) for (let j = 0; j < L.neck; j++) {
    const j1 = (j + 1) % L.neck, c = [0, 0, -0.02];
    M.q(neck[r][j], neck[r][j1], neck[r + 1][j1], neck[r + 1][j], { from: [0, M.p[neck[r][j] * 3 + 1], c[2]] });
  }
  return { rings, top };
}

// A shell over the skull, `thick` off it, from the crown down to the line `edge(phi)` gives for each
// column: the crop's hair down to the hairline, a cap down to its band. Its edge comes in to the
// skin, so it meets the head rather than standing off it like a helmet.
function addDome(M, L, part, group, edge, thick, rows) {
  const phis = ringPhis(L, 1.64), n = phis.length;
  const shell = (y, phi, t) => {
    const p = skullPoint(y, phi, MAN), q = skullPoint(y, phi, SOFT);
    const o = norm(sub(p, CENTRE));
    return { p: add(p, mul(o, t)), alt: sub(q, p) };
  };
  const topY = FACE.top + thick;
  const top = M.v([0, topY, ZC], part, group);
  const cols = phis.map((phi) => {
    const e = edge(phi), out = [];
    for (let r = 1; r <= rows; r++) {
      const s = r / rows, y = topY - (topY - e) * (1 - Math.cos(s * Math.PI / 2)) / (1 - Math.cos(Math.PI / 2));
      const yy = Math.min(y, FACE.top - 0.004), t = thick * (1 - 0.7 * sstep(0.6, 1, s));
      const { p, alt } = shell(yy, phi, t);
      out.push(M.v(p, part, group, { alt }));
    }
    return out;
  });
  for (let k = 0; k < n; k++) M.t(top, cols[(k + 1) % n][0], cols[k][0]);
  for (let r = 0; r + 1 < rows; r++) for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    M.q(cols[k][r], cols[k1][r], cols[k1][r + 1], cols[k][r + 1]);
  }
  return { cols, phis };
}
// the hairline under a column (actor-head.js HAIRLINE_SCULPT), a little below where it's painted
const hairEdge = (phi) => { const c = Math.cos(phi), s = Math.sin(phi); return hairlineAt(c, ZC + s, HAIRLINE_SCULPT) - 0.002; };
// a cap's band: over the brows at the front, down to the nape at the back
const capEdge = (phi) => { const psi = Math.abs(Math.atan2(Math.cos(phi), Math.sin(phi))); return 1.688 - 0.05 * (psi / Math.PI); };

function addHair(M, L) {
  addDome(M, L, P.hair, G.crop, hairEdge, 0.0055, L.hair);
  // long hair: a sheet off the back of the head to the shoulders, riding the head at the top and the
  // neck below the nape (actor-head.js hairMesh's long style)
  const near = L.face === 'near', cols = near ? 7 : 4, rows = near ? 3 : 2, A = 1.4;
  const rx = (y) => 0.084 + (0.13 - 0.084) * sstep(1.62, 1.39, y), rz = (y) => 0.108 + (0.135 - 0.108) * sstep(1.62, 1.39, y);
  const sheet = [];
  for (let r = 0; r <= rows; r++) {
    const y = 1.66 - (1.66 - 1.42) * (r / rows), row = [];
    for (let c = 0; c <= cols; c++) {
      const phi = -Math.PI / 2 - A + (2 * A * c) / cols, zc = ZC - 0.02 * sstep(1.62, 1.44, y);
      const W = sstep(1.47, 1.6, y);
      row.push(M.v([rx(y) * Math.cos(phi), y, zc + rz(y) * Math.sin(phi)], P.hair, G.long, { turn: W, b0: BONE.head, b1: BONE.neck, w: W }));
    }
    sheet.push(row);
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) M.q(sheet[r][c], sheet[r][c + 1], sheet[r + 1][c + 1], sheet[r + 1][c], { from: [0, 1.55, ZC + 0.01] });
}

function addCap(M, L) {
  const { cols, phis } = addDome(M, L, P.cap, G.cap, capEdge, 0.011, Math.max(2, L.hair - 1));
  // the peak: out from the band at the front, a little down
  const K = L.face === 'near' ? 6 : 3, inner = [], outer = [];
  for (let k = 0; k <= K; k++) {
    const psi = -1.05 + 2.1 * k / K, phi = Math.PI / 2 - psi, y = capEdge(phi);
    const p = add(skullPoint(y, phi, MAN), [0, 0, 0.004]), o = norm([Math.sin(psi), 0, Math.cos(psi)]);
    const reach = 0.075 * Math.cos(psi * 0.8);
    inner.push(M.v(p, P.brim, G.cap));
    outer.push(M.v(add(add(p, mul(o, reach)), [0, -0.012, 0]), P.brim, G.cap));
  }
  for (let k = 0; k < K; k++) {
    M.q(inner[k], inner[k + 1], outer[k + 1], outer[k], [0, 1, 0]);
    // and its underside, so it reads from below
    const a = M.v(M.p.slice(inner[k] * 3, inner[k] * 3 + 3), P.brim, G.cap), b = M.v(M.p.slice(inner[k + 1] * 3, inner[k + 1] * 3 + 3), P.brim, G.cap);
    const c = M.v(add(M.p.slice(outer[k + 1] * 3, outer[k + 1] * 3 + 3), [0, -0.002, 0]), P.brim, G.cap), d = M.v(add(M.p.slice(outer[k] * 3, outer[k] * 3 + 3), [0, -0.002, 0]), P.brim, G.cap);
    M.q(a, b, c, d, [0, -1, 0]);
  }
  return { cols, phis };
}

// ── The face, in flat triangles laid on the skin ─────────────────────────────────────────────────
// Each point is on the skin `lift` out along it; the shader also draws every face part a little
// toward the eye (FACE_PULL), so they never fight the skin under them. A face point's soft-head
// offset is the same point on the soft skull.
function facePt(M, x, y, lift, part, group, jaw = 0) {
  const p = add(surf(x, y, MAN), mul(surfN(x, y, MAN), lift)), q = add(surf(x, y, SOFT), mul(surfN(x, y, SOFT), lift));
  return M.v(p, part, group, { alt: sub(q, p), jaw });
}
// a strip along points [x, y, half-width] (the width up and down), wound outward
function strip(M, pts, lift, part, group, jaw = 0) {
  const top = pts.map(([x, y, w]) => facePt(M, x, y + w, lift, part, group, jaw)), bot = pts.map(([x, y, w]) => facePt(M, x, y - w, lift, part, group, jaw));
  for (let i = 0; i + 1 < pts.length; i++) M.q(top[i], top[i + 1], bot[i + 1], bot[i], { from: CENTRE });
}
// a fan of triangles round a centre: a ring of [x, y] points
function disc(M, c, ring, lift, part, group, jaw = 0) {
  const m = facePt(M, c[0], c[1], lift, part, group, jaw), r = ring.map(([x, y]) => facePt(M, x, y, lift, part, group, jaw));
  for (let i = 0; i < r.length; i++) M.t(m, r[i], r[(i + 1) % r.length], { from: CENTRE });
}

function addFace(M, L) {
  const near = L.face === 'near', E = EYE.man;
  for (const s of [1, -1]) {
    const x0 = s * E.x, y0 = EYE.y, w = E.w * 1.05, t = E.t * 1.7, b = E.b * 1.5, tilt = E.tilt * w;
    if (near) {
      // the white of the eye, an almond from the inner corner to the outer
      const inner = [x0 - s * w, y0 - tilt], outer = [x0 + s * w, y0 + tilt];
      const ring = [inner, [x0 - s * w * 0.45, y0 + t * 0.9], [x0 + s * w * 0.35, y0 + t], outer, [x0 + s * w * 0.4, y0 - b * 0.9], [x0 - s * w * 0.4, y0 - b]];
      disc(M, [x0, y0], ring, 0.0016, P.white, G.all);
      // the iris, a little toward the nose, and the lid's line over the top of it all
      const ir = 0.0068, ic = [x0 - s * 0.0012, y0 - 0.0004];
      disc(M, ic, [0, 1, 2, 3, 4, 5].map((k) => [ic[0] + ir * Math.cos(k * Math.PI / 3), ic[1] + ir * 0.95 * Math.sin(k * Math.PI / 3)]), 0.0022, P.iris, G.all);
      strip(M, [[inner[0], inner[1] + 0.0004, 0.0008], [x0 - s * w * 0.45, y0 + t * 0.9 + 0.0006, 0.0013], [x0 + s * w * 0.35, y0 + t + 0.0006, 0.0014], [outer[0] + s * 0.002, outer[1] + 0.001, 0.0009]], 0.0026, P.ink, G.all);
      // the brow, heavy at its head and tapering out over the eye's corner
      strip(M, [[s * 0.011, 1.6555, 0.0032], [s * 0.026, 1.6615, 0.0028], [s * 0.04, 1.6615, 0.0022], [s * 0.052, 1.657, 0.001]], 0.0024, P.brow, G.all);
    } else {
      // far off, an eye is one dark lozenge under a brow
      disc(M, [x0, y0], [[x0 - s * w, y0], [x0, y0 + t * 1.1], [x0 + s * w, y0 + tilt], [x0, y0 - b * 1.2]], 0.002, P.ink, G.all);
      strip(M, [[s * 0.012, 1.6575, 0.0034], [s * 0.05, 1.6585, 0.0022]], 0.0024, P.brow, G.all);
    }
  }
  // the mouth: the upper lip down to the line, the lower lip under it and the mouth's inside between,
  // shut to a line until the jaw drops it open
  const my = FACE.mouthY;
  if (near) {
    strip(M, [[-0.021, my + 0.0006, 0.0004], [-0.011, my + 0.0022, 0.0018], [-0.004, my + 0.0032, 0.0026], [0, my + 0.0028, 0.0023], [0.004, my + 0.0032, 0.0026], [0.011, my + 0.0022, 0.0018], [0.021, my + 0.0006, 0.0004]], 0.0022, P.lip, G.all);
    const low = [[-0.02, my - 0.001, 0.0006], [-0.01, my - 0.003, 0.0026], [0, my - 0.0037, 0.0031], [0.01, my - 0.003, 0.0026], [0.02, my - 0.001, 0.0006]];
    strip(M, low, 0.0022, P.lipLow, G.all, 1);
    // the inside: its top on the upper lip's line, its bottom on the lower lip's, which the jaw takes
    const xs = [-0.019, -0.009, 0, 0.009, 0.019], topR = xs.map((x) => facePt(M, x, my + 0.0007, 0.0016, P.mouth, G.all, 0));
    const botR = xs.map((x) => facePt(M, x, my - 0.0007, 0.0016, P.mouth, G.all, 1));
    for (let i = 0; i + 1 < xs.length; i++) M.q(topR[i], topR[i + 1], botR[i + 1], botR[i], { from: CENTRE });
    // the nostrils' shade under the tip
    for (const s of [1, -1]) disc(M, [s * 0.0062, FACE.noseBaseY + 0.0012], [[s * 0.0025, FACE.noseBaseY + 0.0006], [s * 0.0098, FACE.noseBaseY + 0.0008], [s * 0.0068, FACE.noseBaseY + 0.0026]], 0.0016, P.shade, G.all);
  } else {
    strip(M, [[-0.02, my + 0.0008, 0.0017], [0, my + 0.0016, 0.0022], [0.02, my + 0.0008, 0.0017]], 0.0024, P.lip, G.all);
    const topR = [-0.016, 0.016].map((x) => facePt(M, x, my, 0.002, P.mouth, G.all, 0)), botR = [-0.016, 0.016].map((x) => facePt(M, x, my - 0.0004, 0.002, P.mouth, G.all, 1));
    M.q(topR[0], topR[1], botR[1], botR[0], { from: CENTRE });
  }
  // a beard: the lower face from ear to ear, and a moustache over the lip
  const bxs = near ? [-0.066, -0.052, -0.036, -0.02, 0, 0.02, 0.036, 0.052, 0.066] : [-0.06, -0.03, 0, 0.03, 0.06];
  const bys = near ? [1.6, 1.58, 1.562, 1.547, 1.534] : [1.592, 1.56, 1.535];
  const grid = bys.map((y) => bxs.map((x) => {
    const yy = Math.abs(x) < 0.03 ? Math.min(y, my - 0.004) : y;
    return facePt(M, x, yy, 0.0014, P.beard, G.beard, jawOf(surf(x, yy)));
  }));
  for (let r = 0; r + 1 < bys.length; r++) for (let c = 0; c + 1 < bxs.length; c++) {
    // the upper rows only at the sides, by the sideburns and the cheeks, not over the mouth
    if (r === 0 && Math.abs(bxs[c]) < 0.04 && Math.abs(bxs[c + 1]) < 0.04) continue;
    M.q(grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c], { from: CENTRE });
  }
  strip(M, near ? [[-0.023, my + 0.0055, 0.002], [0, my + 0.0075, 0.0028], [0.023, my + 0.0055, 0.002]] : [[-0.022, my + 0.006, 0.0028], [0.022, my + 0.006, 0.0028]], 0.003, P.beard, G.beard);
  // glasses: a dark lens over each eye and a bridge, stood off the face
  for (const s of [1, -1]) {
    const c = add(surf(s * E.x, EYE.y), [0, 0, 0.012]), hw = 0.021, hh = 0.0135;
    const pts = [[-hw, hh * 0.8], [hw, hh], [hw * 0.9, -hh], [-hw * 0.95, -hh * 0.8]].map(([dx, dy]) => M.v(add(c, [s * dx, dy, 0]), P.lens, G.glasses));
    M.q(pts[0], pts[1], pts[2], pts[3], [0, 0, 1]);
  }
  const br = [add(surf(0.009, 1.643), [0, 0, 0.012]), add(surf(-0.009, 1.643), [0, 0, 0.012])];
  const bq = [M.v(add(br[0], [0, 0.002, 0]), P.ink, G.glasses), M.v(add(br[1], [0, 0.002, 0]), P.ink, G.glasses), M.v(add(br[1], [0, -0.001, 0]), P.ink, G.glasses), M.v(add(br[0], [0, -0.001, 0]), P.ink, G.glasses)];
  M.q(bq[0], bq[1], bq[2], bq[3], [0, 0, 1]);
}

// the ears: a leaf off each side of the head, both faces
function addEars(M) {
  for (const s of [1, -1]) {
    const q = [[0.069, 1.652, 0.004], [0.08, 1.655, -0.022], [0.077, 1.6, -0.02], [0.068, 1.598, 0.0]].map(([x, y, z]) => [s * x, y, z]);
    const a = q.map((p) => M.v(p, P.skin, G.all)), b = q.map((p) => M.v(add(p, [-s * 0.003, 0, 0]), P.skin, G.all));
    M.q(a[0], a[1], a[2], a[3], [s, 0, 0]);
    M.q(b[0], b[1], b[2], b[3], [-s, 0, 0]);
  }
}

// a rally towel from the right hand, the length of a forearm past the fingers, both faces
function addTowel(M) {
  const hand = JOINT[BONE.handR], o = { turn: 0, b0: BONE.handR, b1: BONE.handR, w: 1 };
  // held at one corner in the fist, hanging down past the fingers and out to the side
  const top = hand[1] - 0.05, bot = top - 0.46, x = hand[0], z = hand[2] + 0.01;
  const q = [[x + 0.01, top, z], [x - 0.02, bot, z + 0.03], [x - 0.3, bot + 0.08, z + 0.05], [x - 0.24, top - 0.06, z + 0.01]];
  const a = q.map((p) => M.v(p, P.towel, G.towel, o)), b = q.map((p) => M.v(p, P.towel, G.towel, o));
  M.q(a[0], a[1], a[2], a[3], [0, 0, 1]);
  M.q(b[0], b[1], b[2], b[3], [0, 0, -1]);
}

// The cut-down body's fingers are a fan of thin shards that read as claws a row away, so each hand's
// own triangles are dropped and a mitt goes on in their place, rigid on the hand bone: an egg round
// the palm, long down the fingers, as wide as a hand across them and flat through it (the arm hanging
// in bind space, the palm to the thigh), its top up inside the cuff.
const MITT = [0.026, 0.056, 0.044];
function mittHands(M, nb, near) {
  const hand = new Set([BONE.handL, BONE.handR]);
  const isHand = (v) => v < nb && hand.has(M.b0[v]) && (hand.has(M.b1[v]) || M.w[v] > 0.5);
  const keep = [];
  for (let t = 0; t < M.I.length; t += 3) if (!(isHand(M.I[t]) && isHand(M.I[t + 1]) && isHand(M.I[t + 2]))) keep.push(M.I[t], M.I[t + 1], M.I[t + 2]);
  M.I.length = 0; M.I.push(...keep);
  const rows = near ? 4 : 3, segs = near ? 7 : 5;
  for (const side of ['L', 'R']) {
    const bone = BONE['hand' + side], c = add(JOINT[bone], [0, -0.07, 0.008]), o = { turn: 0, b0: bone, b1: bone, w: 1 };
    const top = M.v(add(c, [0, MITT[1], 0]), P.skin, G.all, o), bot = M.v(add(c, [0, -MITT[1], 0]), P.skin, G.all, o);
    const ring = [];
    for (let r = 1; r < rows; r++) {
      const th = Math.PI * r / rows, row = [];
      for (let s = 0; s < segs; s++) {
        const ph = TAU * s / segs;
        row.push(M.v(add(c, [Math.sin(th) * Math.cos(ph) * MITT[0], Math.cos(th) * MITT[1], Math.sin(th) * Math.sin(ph) * MITT[2]]), P.skin, G.all, o));
      }
      ring.push(row);
    }
    const from = { from: c };
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      M.t(top, ring[0][s], ring[0][s1], from);
      for (let r = 0; r + 1 < ring.length; r++) M.q(ring[r][s], ring[r][s1], ring[r + 1][s1], ring[r + 1][s], from);
      M.t(bot, ring[ring.length - 1][s1], ring[ring.length - 1][s], from);
    }
  }
}

// ── The figure ────────────────────────────────────────────────────────────────────────────────────
const _mesh = new Map();
export function fanMesh(level = 'far') {
  if (_mesh.has(level)) return _mesh.get(level);
  const L = FAN_LEVELS[level] || FAN_LEVELS.far, M = builder();
  // the body, its vertices as they come, in the street's coat (silhouette 0): the jacket's hem, cut
  // down this far, shows the belt and the trousers through it in streaks
  const Bd = actorFanBody({ tris: L.tris, sil: 0 });
  const nb = Bd.p.length / 3;
  for (let v = 0; v < nb; v++) {
    M.v([Bd.p[v * 3], Bd.p[v * 3 + 1], Bd.p[v * 3 + 2]], BODY_PART[Bd.mat[v]] ?? P.shirt, G.all,
      { turn: 0, b0: Bd.b0[v], b1: Bd.b1[v], w: Bd.w[v], body: [Bd.body[v * 4], Bd.body[v * 4 + 1], Bd.body[v * 4 + 2], Bd.body[v * 4 + 3]] });
  }
  for (const i of Bd.idx) M.I.push(i);
  const bodyTris = Bd.idx.length / 3;
  mittHands(M, nb, L.face === 'near');
  addHead(M, L);
  if (L.face === 'near') addEars(M);
  addFace(M, L);
  addHair(M, L);
  addCap(M, L);
  addTowel(M);
  const nv = M.part.length;
  if (nv > 65535) throw new Error('fan-vat: too many vertices for a 16-bit index');
  const stat = new Float32Array(nv * FAN_STATIC);
  for (let v = 0; v < nv; v++) {
    const o = v * FAN_STATIC;
    stat[o] = M.part[v]; stat[o + 1] = M.group[v]; stat[o + 2] = M.turn[v];
    for (let k = 0; k < 4; k++) stat[o + 3 + k] = M.body[v * 4 + k] * FT;
    for (let k = 0; k < 3; k++) stat[o + 7 + k] = M.alt[v * 3 + k] * FT;
  }
  const out = { level, nv, nb, bodyTris, nt: M.I.length / 3, idx: Uint16Array.from(M.I), stat,
    p: new Float64Array(M.p), b0: Uint8Array.from(M.b0), b1: Uint8Array.from(M.b1), w: Float64Array.from(M.w), jaw: Float64Array.from(M.jaw), part: Uint8Array.from(M.part), group: Uint8Array.from(M.group) };
  _mesh.set(level, out);
  return out;
}

// ── The bake ──────────────────────────────────────────────────────────────────────────────────────
// A normal as one float: its octahedral projection's two halves, 12 bits each, as an exact integer.
export function octPack(n) {
  const l = Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]) || 1;
  let x = n[0] / l, y = n[1] / l;
  if (n[2] < 0) { const ox = x; x = (1 - Math.abs(y)) * (ox >= 0 ? 1 : -1); y = (1 - Math.abs(ox)) * (y >= 0 ? 1 : -1); }
  const qx = Math.round((x * 0.5 + 0.5) * 4095), qy = Math.round((y * 0.5 + 0.5) * 4095);
  return qx + qy * 4096;
}
export function octUnpack(w) {
  const u = Math.round(w), x = ((u % 4096) / 4095) * 2 - 1, y = (Math.floor(u / 4096) / 4095) * 2 - 1;
  let n = [x, y, 1 - Math.abs(x) - Math.abs(y)];
  if (n[2] < 0) n = [(1 - Math.abs(y)) * (x >= 0 ? 1 : -1), (1 - Math.abs(x)) * (y >= 0 ? 1 : -1), n[2]];
  return norm(n);
}

// { level, nv, W, H, data (RGBA32F, W × H), stat, idx, nt, ms }: W is nv + 1, the last column the
// head's pivot. Kept by level.
const _bake = new Map();
export function fanBake(level = 'far') {
  if (_bake.has(level)) return _bake.get(level);
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const m = fanMesh(level), { nv, nb, p: rp, b0, b1, w: rw, jaw, idx } = m;
  const W = nv + 1, H = FAN_ROWS, data = new Float32Array(W * H * 4);
  const Pp = new Float64Array(nv * 3), Nn = new Float64Array(nv * 3);
  const headJ = JOINT[BONE.head];
  for (const c of FAN_CLIPS) {
    for (let f = 0; f < c.frames; f++) {
      const ph = c.once ? f / (c.frames - 1) : f / c.frames, S = actorFanSkin(c.src, ph), J = c.jaw ? c.jaw(ph) : 0;
      let minY = Infinity;
      for (let v = 0; v < nv; v++) {
        let x = rp[v * 3], y = rp[v * 3 + 1], z = rp[v * 3 + 2];
        if (jaw[v] > 0 && J > 0) { y -= JAW_DROP * J * jaw[v]; z -= JAW_BACK * J * jaw[v]; }
        const a = S[b0[v]], b = S[b1[v]], u = rw[v], k = 1 - u;
        for (let i = 0; i < 3; i++) Pp[v * 3 + i] = u * (a[i] * x + a[4 + i] * y + a[8 + i] * z + a[12 + i]) + k * (b[i] * x + b[4 + i] * y + b[8 + i] * z + b[12 + i]);
        if (v < nb && Pp[v * 3 + 1] < minY) minY = Pp[v * 3 + 1];
      }
      Nn.fill(0);
      for (let t = 0; t < idx.length; t += 3) {
        const i0 = idx[t] * 3, i1 = idx[t + 1] * 3, i2 = idx[t + 2] * 3;
        const ux = Pp[i1] - Pp[i0], uy = Pp[i1 + 1] - Pp[i0 + 1], uz = Pp[i1 + 2] - Pp[i0 + 2];
        const vx = Pp[i2] - Pp[i0], vy = Pp[i2 + 1] - Pp[i0 + 1], vz = Pp[i2 + 2] - Pp[i0 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const j of [i0, i1, i2]) { Nn[j] += nx; Nn[j + 1] += ny; Nn[j + 2] += nz; }
      }
      const row = c.row0 + f;
      for (let v = 0; v < nv; v++) {
        const o = (row * W + v) * 4;
        data[o] = Pp[v * 3] * FT; data[o + 1] = (Pp[v * 3 + 1] - minY) * FT; data[o + 2] = Pp[v * 3 + 2] * FT;
        data[o + 3] = octPack([Nn[v * 3], Nn[v * 3 + 1], Nn[v * 3 + 2]]);
      }
      const h = S[BONE.head], o = (row * W + nv) * 4;
      data[o] = (h[0] * headJ[0] + h[4] * headJ[1] + h[8] * headJ[2] + h[12]) * FT;
      data[o + 1] = (h[1] * headJ[0] + h[5] * headJ[1] + h[9] * headJ[2] + h[13] - minY) * FT;
      data[o + 2] = (h[2] * headJ[0] + h[6] * headJ[1] + h[10] * headJ[2] + h[14]) * FT;
      data[o + 3] = J;
    }
  }
  const out = { level, nv, nb, W, H, data, stat: m.stat, idx, nt: m.nt, bodyTris: m.bodyTris, ms: (typeof performance !== 'undefined' ? performance.now() : 0) - t0 };
  _bake.set(level, out);
  return out;
}
// A bake made elsewhere (the warm-up's worker), so the page doesn't make it again.
export function seedFanBake(b) {
  if (b && b.data instanceof Float32Array && b.idx && b.stat && !_bake.has(b.level)) _bake.set(b.level, b);
}
export const fanBakeReady = (level) => _bake.get(level) || null;
// Both levels baked in a worker (fan-vat-worker.js) when there's a browser to have one, else here:
// resolves true once fanBakeReady has both. One bake a page, however many ask.
let _async = null;
export function fanBakeAsync() {
  if (_bake.has('far') && _bake.has('near')) return Promise.resolve(true);
  if (_async) return _async;
  _async = new Promise((done) => {
    const here = () => { try { fanBake('far'); fanBake('near'); done(true); } catch { done(false); } };
    if (typeof Worker !== 'function' || typeof document === 'undefined') { here(); return; }
    try {
      const w = new Worker(new URL('./fan-vat-worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => { for (const b of e.data?.bakes || []) seedFanBake(b); w.terminate(); if (_bake.has('far') && _bake.has('near')) done(true); else here(); };
      w.onerror = () => { w.terminate(); setTimeout(here, 0); };
      w.postMessage({});
    } catch { setTimeout(here, 0); }
  });
  return _async;
}
