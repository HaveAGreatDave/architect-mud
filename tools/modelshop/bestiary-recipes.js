// THE BESTIARY'S RECIPES: how each enemy in content/enemies is drawn to ROOM's standard (bestiary.html).
//
// Two ways, as the Room Stage would draw them:
//   · a person, or anything that was one, is the close-up figure (figure.js) with a settled look (`figure`, the
//     same keys as an NPC's flags.figure), a clip and a mood, its limbs drawn out by `stretch` and its gear (`gear`)
//     built in the figure's bind space on its bones, so armour, a gas mask or a tumour moves with the body;
//   · anything else is built from the beast kit (`build`, gl/beast-kit.js) in metres, facing +Z.
// A concept: the recipes would become content (an enemy's flags.figure, or a flags.body naming a kit build) before
// any of this ships. Only the gutter hound does now, through gl/beast-looks.js.
import {
  beastMesh, sweep, tube, blob, spike, tuft, sheet, loop, eye, mammalHead, quadruped, arthropod, serpent, mound, batWing,
  add, sub, mul, madd, norm, cross, lerp3, rot, keys, smooth, fnoise, rng, C, mix, shade, GLOW, MAT, scaleFrom, triCount,
  shadeTo, glow, jointedLeg, socketEye, scaleEdge, veinAt, spotAt, PULSE, FILM, TRANSLUCENT, mark, vlen, furCoat, furOver,
} from '/client/game/js/panels/gl/beast-kit.js';
import { houndLook } from '/client/game/js/panels/gl/beast-looks.js';
import { FIGURE_BONES, FIGURE_BONE } from '/client/game/js/panels/figure.js';

export const GROUPS = [
  { key: 'people', label: 'People' },
  { key: 'law', label: 'SPECTER-PD and the Architect' },
  { key: 'mutant', label: 'What used to be people' },
  { key: 'thorn', label: 'The Thornwarren road' },
  { key: 'four', label: 'Four legs' },
  { key: 'crawl', label: 'Crawlers' },
  { key: 'long', label: 'Long things' },
  { key: 'heap', label: 'Horrors and heaps' },
  { key: 'air', label: 'Fliers' },
  { key: 'machine', label: 'Machines' },
];

// ── the families: each a colour script ───────────────────────────────────────────────────────────────
// Every enemy belongs to one register, and the register decides its colour, not the enemy: where its shadows go
// (`shade`, a hue the shadow is pulled toward), the colour of the light round its silhouette (`rim`), its accent (the
// one saturated thing on it, usually what glows), and how it's staged on this page (`stage`: the key light's tint and
// a coloured back light). docs/proposals/bestiary-art-direction.md says where each comes from.
export const FAMILY = {
  // gutter-wet vermin (rats, roaches, leeches, lampreys, slime): bile and slate, a wet mint rim, bioluminescent accents
  wet: { shade: '#2e3a52', rim: '#b8f0d8', accent: '#2bf5c8', stage: { key: [0.85, 0.95, 0.8], back: [0.35, 1.0, 0.8], keyK: 0.9, backK: 1.3 } },
  // the Under's deep horrors: wet-brick black, shadows sunk to teal, a sickly cyan rim, light of their own
  under: { shade: '#0c2a2c', rim: '#5af0c8', accent: '#7dffb4', stage: { key: [0.55, 0.85, 0.8], back: [0.25, 1.0, 0.75], keyK: 0.8, backK: 1.3 } },
  // the fused masses, after the tatarigami: no mid-tones, a bruised aubergine with a raw pink rim and red eyes
  midden: { shade: '#170f24', rim: '#e0507a', accent: '#ff3b1f', stage: { key: [0.85, 0.7, 0.85], back: [1.0, 0.3, 0.5], keyK: 0.7, backK: 1.5 } },
  // the pale things: bone paper, lavender shadow that keeps its light, a white rim, a cold glow
  pale: { shade: '#8f8ab8', rim: '#ffffff', accent: '#8fe3ff', stage: { key: [0.85, 0.88, 1.0], back: [0.6, 0.8, 1.0], keyK: 1.0, backK: 1.4 } },
  // slag and burn: char, violet-black shadow, a heat rim, cores down the blackbody ramp
  burn: { shade: '#120d14', rim: '#ff6a1a', accent: '#ff890e', stage: { key: [1.0, 0.6, 0.35], back: [1.0, 0.35, 0.1], keyK: 0.6, backK: 1.5 } },
  // Halcyon: porcelain and navy, high-key cool shadows, a white rim, one teal accent (the pin)
  halcyon: { shade: '#8a96b4', rim: '#ffffff', accent: '#4fd1c5', stage: { key: [1.0, 0.97, 0.94], back: [0.8, 0.85, 1.0], keyK: 1.2, backK: 0.8 } },
  // SPECTER-PD: fleet white and gunmetal, blue-grey shadows, an ice-blue rim, a red and blue light bar
  police: { shade: '#3a4870', rim: '#9fd4ff', accent: '#2e7bff', stage: { key: [0.85, 0.9, 1.0], back: [1.0, 0.18, 0.25], keyK: 1.0, backK: 1.2 } },
  // the Architect's own: one dark value, violet-black shadow, a cold white rim, light only in its slit or seams
  angel: { shade: '#0a0a18', rim: '#e8eeff', accent: '#f4f8ff', stage: { key: [0.6, 0.62, 0.75], back: [0.85, 0.92, 1.0], keyK: 0.6, backK: 1.7 } },
  // the city's tired machines: safety yellow with a warm shadow (not brown-grey), an amber rim
  municipal: { shade: '#6a3424', rim: '#ffc070', accent: '#ffa020', stage: { key: [1.0, 0.88, 0.7], back: [0.4, 0.55, 1.0], keyK: 1.0, backK: 1.0 } },
  // the Bleed's flesh: warm skin, purple shadow, a peach rim, blue in the veins
  bleed: { shade: '#5a2a5e', rim: '#ffd9b0', accent: '#40c8ff', stage: { key: [1.0, 0.85, 0.85], back: [0.75, 1.0, 0.35], keyK: 0.9, backK: 1.2 } },
  // the Thornwarren: thornwood and bone, indigo shadow, a low-sun rim; eyes that turn blue to red
  thorn: { shade: '#2d2a4a', rim: '#ffe6a8', accent: '#ff3b30', stage: { key: [1.0, 0.8, 0.6], back: [1.0, 0.35, 0.2], keyK: 0.9, backK: 1.4 } },
  // the great arthropods: chitin with an oil-slick film, cold complementary shadows, a warm rim
  chitin: { shade: '#1e2440', rim: '#ffb070', accent: '#ff2d55', stage: { key: [1.0, 0.9, 0.75], back: [0.55, 0.45, 1.0], keyK: 1.0, backK: 1.2 } },
  // the deep water: abyssal shadow, a phosphor rim, light in rows of points
  deep: { shade: '#0a1220', rim: '#6fe8ff', accent: '#2bf5c8', stage: { key: [0.55, 0.7, 1.0], back: [0.2, 0.9, 1.0], keyK: 0.8, backK: 1.4 } },
  // the street's animals at night: warm fur, shadows gone ultramarine-violet, a neon rim off a sign
  street: { shade: '#2c2650', rim: '#ff6ab8', accent: '#ff8a20', stage: { key: [1.0, 0.82, 0.6], back: [1.0, 0.3, 0.8], keyK: 1.0, backK: 1.3 } },
  // the people: no register of their own, lit by the room
  people: { shade: null, rim: '#ffe0b0', accent: null, stage: { key: [1.0, 0.92, 0.8], back: [0.5, 0.65, 1.0], keyK: 1.1, backK: 0.9 } },
};
// The family's palette rules on a mesh: shadows pulled toward its hue, the rim its colour.
export function palOf(fam, o = {}) {
  const F = FAMILY[fam] || {};
  return { shade: F.shade ? shadeTo(F.shade, o.t ?? 0.6, o.k ?? 0.5) : null, rim: o.rim ?? F.rim };
}

// ── the figure's bind space ──────────────────────────────────────────────────────────────────────────
// Each bone's joint in bind space (metres, Y up, facing +Z, the left on +X), from FIGURE_BONES' offsets.
const JB = [];
FIGURE_BONES.forEach(([, p, off], i) => { JB[i] = p < 0 ? off.slice() : add(JB[p], off); });
export const JOINT = Object.fromEntries(FIGURE_BONES.map(([n], i) => [n, JB[i]]));
const B = FIGURE_BONE;
const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const on = (M, bone) => { M.bone = B[bone]; return M; };
const LR = (sd) => (sd > 0 ? 'L' : 'R');
// where things are on the body in bind space
const HEAD = [0, 1.612, 0.012], FACE_Z = 0.098, EYE_Y = 1.625;
const PALM = (sd) => [sd * 0.197, 0.778, 0.012];

// A bone's 3×4 composed with a stretch along its bind Y about its joint: a longer thigh, a longer forearm.
function stretchBone(rows, b, s) {
  const o = b * 12, jy = JB[b][1];
  for (let r = 0; r < 3; r++) { const m1 = rows[o + r * 4 + 1]; rows[o + r * 4 + 3] += m1 * jy * (1 - s); rows[o + r * 4 + 1] = m1 * s; }
}
const apply = (rows, b, p) => { const o = b * 12; return [0, 1, 2].map((r) => rows[o + r * 4] * p[0] + rows[o + r * 4 + 1] * p[1] + rows[o + r * 4 + 2] * p[2] + rows[o + r * 4 + 3]); };
const shift = (rows, b, d) => { const o = b * 12; for (let r = 0; r < 3; r++) rows[o + r * 4 + 3] += d[r]; };
/** Draw out a figure's legs or arms by s (posed rows, in place): each bone stretched, the ones below carried. */
export function stretchRows(rows, { legs = 1, arms = 1 } = {}) {
  let drop = 0, n = 0;
  const chain = (a, bb, c, extra, s) => {
    const kj = JB[bb], aj = JB[c];
    const k0 = apply(rows, a, kj); stretchBone(rows, a, s); const dk = sub(apply(rows, a, kj), k0);
    shift(rows, bb, dk);
    const a0 = apply(rows, bb, aj); stretchBone(rows, bb, s); const d = add(sub(apply(rows, bb, aj), a0), dk);
    for (const e of [c, ...extra]) shift(rows, e, d);
    return d;
  };
  for (const sd of ['L', 'R']) {
    if (legs !== 1) { const d = chain(B['thigh' + sd], B['shin' + sd], B['foot' + sd], [B['toe' + sd]], legs); drop += d[1]; n++; }
    if (arms !== 1) chain(B['uarm' + sd], B['farm' + sd], B['hand' + sd], [], arms);
  }
  // stood back on the floor
  if (n) { const lift = -drop / n; for (let b = 0; b < rows.length / 12; b++) shift(rows, b, [0, lift, 0]); }
}

/** The body figurePeople takes for a figure recipe. */
export function figureBody(id, rcp, at, yaw, t) {
  return {
    id: 'bestiary-' + id, at, yaw, pose: 'stand', sculpt: true, sex: rcp.sex || 'male', figure: { gear: false, ...rcp.figure },
    ...(rcp.height ? { height: rcp.height } : {}), ...(rcp.clip ? { clip: rcp.clip } : {}),
    mood: { m: rcp.mood || 'angry', i: rcp.moodI ?? 0.8 }, ...(rcp.facial ? { facial: rcp.facial } : {}),
    ...Object.fromEntries(['bottoms', 'hat', 'scarf'].map((k) => [k, rcp[k] || ''])),
  };
}

// ── gear: pieces made in bind space, each on a bone ──────────────────────────────────────────────────
const METAL = MAT.METAL, GLOSS = MAT.GLOSS, SATIN = MAT.SATIN, LEATHER = MAT.LEATHER;
// a plate of armour: a rounded box at c, half-sizes r, facing n (its thin axis)
function plate(M, bone, c, r, col, o = {}) {
  on(M, bone);
  const n = norm(o.n || [0, 0, 1]), up = norm(o.up || [0, 1, 0]), x = norm(cross(up, n)), y = cross(n, x);
  blob(M, c, r, { axes: [x, y, n], e1: o.e1 ?? 0.35, e2: o.e2 ?? 0.45, col, mat: o.mat ?? SATIN, nu: 14, nv: 8, form: o.form || null });
}
// a helmet over the head, its visor across the face
function helmet(M, col, visor, o = {}) {
  on(M, 'head');
  const c = add(HEAD, [0, 0.012, -0.004]);
  blob(M, c, [0.112, 0.128, 0.13].map((v) => v * (o.k || 1)), { e1: 0.85, e2: 0.9, col, mat: o.mat ?? SATIN, nu: 20, nv: 12 });
  if (visor) blob(M, [0, EYE_Y - 0.005, 0.07], [0.1, 0.035, 0.07], { e1: 0.5, e2: 0.9, col: visor, mat: o.visorMat ?? GLOSS, nu: 18, nv: 8 });
  if (o.slit) glow(M, [0, EYE_Y, 0.128], [0.075, 0.009, 0.012], o.slit, { halo: 0.6, haloR: 2, light: 0.4 });
  if (o.crest) plate(M, 'head', add(c, [0, 0.12, -0.02]), [0.02, 0.02, 0.1], col);
}
// a cuirass over the chest and back
function cuirass(M, col, o = {}) {
  const k = o.k || 1;
  plate(M, 'chest', [0, 1.3, 0.12 * k], [0.165 * k, 0.15, 0.04], col, { n: [0, 0.15, 1] });
  plate(M, 'chest', [0, 1.3, -0.11 * k], [0.16 * k, 0.15, 0.035], col, { n: [0, 0.1, -1] });
  plate(M, 'spine', [0, 1.08, 0.105 * k], [0.13 * k, 0.07, 0.03], o.belly || shade(col, 0.85), { n: [0, 0, 1] });
  for (const sd of [1, -1]) plate(M, 'uarm' + LR(sd), [sd * 0.215, 1.39, -0.01], [0.075 * k, 0.03, 0.07 * k], col, { n: [sd, 1, 0], up: [0, 0, 1] });
}
function limbGuards(M, col, o = {}) {
  for (const sd of [1, -1]) {
    plate(M, 'farm' + LR(sd), [sd * 0.197, 0.97, 0.025], [0.036, 0.09, 0.022], col, { n: [0, 0, 1] });
    plate(M, 'thigh' + LR(sd), [sd * 0.1, 0.7, 0.07], [0.07, 0.12, 0.025], col, { n: [0, 0, 1] });
    plate(M, 'shin' + LR(sd), [sd * 0.095, 0.3, 0.05], [0.045, 0.13, 0.022], col, { n: [0, 0, 1] });
    plate(M, 'shin' + LR(sd), [sd * 0.095, 0.5, 0.055], [0.05, 0.045, 0.03], o.knee || col, { n: [0, 0.2, 1], e1: 0.7 });
  }
}
// something held in the fist, along z through the palm (forward when the arm hangs)
function held(M, sd, pts, r, col, o = {}) {
  on(M, 'hand' + LR(sd));
  const P = PALM(sd);
  tube(M, pts.map((p) => add(P, p)), Array.isArray(r) ? r : pts.map(() => r), { ring: o.ring ?? 8, seg: 3, col, mat: o.mat ?? METAL, ...(o.flat ? { flat: o.flat, up: [1, 0, 0] } : {}) });
}
function knife(M, sd, col = '#b8bcc0', len = 0.15) {
  held(M, sd, [[0, 0, -0.05], [0, 0, 0.05]], 0.014, '#2a2420', { mat: LEATHER });
  held(M, sd, [[0, 0, 0.05], [0, -0.004, 0.05 + len * 0.6], [0, -0.012, 0.05 + len]], [0.013, 0.01, 0.001], col, { flat: 0.18 });
}
function pistol(M, sd) {
  held(M, sd, [[0, 0.01, -0.02], [0, 0.03, 0.03]], 0.016, '#1a1c20', { mat: SATIN, flat: 0.6 });
  held(M, sd, [[0, 0.045, -0.04], [0, 0.045, 0.17]], [0.018, 0.016], '#24272c', { flat: 0.55, ring: 6 });
}
function gasMask(M, col = '#3a3c34', lens = '#9ab0a0') {
  on(M, 'head');
  blob(M, [0, 1.585, 0.085], [0.07, 0.065, 0.05], { e1: 0.8, col, mat: SATIN, nu: 16, nv: 10 });
  for (const sd of [1, -1]) {
    blob(M, [sd * 0.035, EYE_Y + 0.004, 0.094], [0.026, 0.026, 0.012], { col: lens, mat: GLOSS, nu: 12, nv: 6, axes: [[1, 0, 0], [0, 1, 0], norm([sd * 0.3, 0, 1])] });
    tube(M, [[sd * 0.04, 1.55, 0.11], [sd * 0.08, 1.53, 0.13]], [0.024, 0.026], { ring: 10, col: '#2a2a26', mat: SATIN });
  }
  tube(M, [[0, 1.555, 0.13], [0, 1.535, 0.15]], [0.022, 0.02], { ring: 10, col: '#4a4a42', mat: METAL });
  loop(M, (s) => { const a = s * Math.PI * 2; return [Math.cos(a) * 0.105, 1.63 + Math.sin(a) * 0.01, Math.sin(a) * 0.115 - 0.005]; }, 0.007, { col: '#1a1a18', mat: LEATHER });
}
function goggles(M, up = true, lens = '#c8a050') {
  on(M, 'head');
  const y = up ? 1.69 : EYE_Y, z = up ? 0.075 : 0.095;
  for (const sd of [1, -1]) {
    tube(M, [[sd * 0.038, y, z - 0.01], [sd * 0.04, y, z + 0.02]], [0.025, 0.025], { ring: 12, col: '#2a2420', mat: METAL });
    blob(M, [sd * 0.04, y, z + 0.022], [0.021, 0.021, 0.006], { col: lens, mat: GLOSS, nu: 12, nv: 5 });
  }
  loop(M, (s) => { const a = s * Math.PI * 2; return [Math.cos(a) * 0.108, y + 0.004, Math.sin(a) * 0.118]; }, 0.008, { col: '#3a2a20', mat: LEATHER });
}
// lumps of growth (tumour, crust, concrete) over a list of [bone, centre, radius]
function lumps(M, list, col, o = {}) {
  list.forEach(([bone, c, r], i) => { on(M, bone); blob(M, c, Array.isArray(r) ? r : [r, r, r], { lump: o.lump ?? 0.25, seed: i * 1.7 + (o.seed || 0), freq: o.freq || 2.6, col: typeof col === 'function' ? col(i) : col, mat: o.mat ?? MAT.MATTE, nu: 16, nv: 10 }); });
}
// thorns or spikes off a bone, pointing out from its axis
function thorns(M, bone, axisX, y0, y1, r, n, len, col, seed = 1) {
  on(M, bone);
  const R = rng(seed);
  for (let i = 0; i < n; i++) {
    const y = y0 + (y1 - y0) * R(), a = R() * Math.PI * 2, d = [Math.cos(a), 0, Math.sin(a)], base = [axisX + d[0] * r, y, d[2] * r];
    spike(M, base, add(base, add(mul(d, len * (0.6 + 0.6 * R())), [0, len * 0.25, 0])), len * 0.16, { col, mat: SATIN, ring: 5 });
  }
}
// glowing seams: thin lit lines laid over the surface along a bone
function seams(M, bone, axis, y0, y1, r, n, col, seed = 3) {
  on(M, bone);
  const R = rng(seed);
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, y = y0 + (y1 - y0) * R(), l = 0.05 + 0.08 * R(), da = (R() - 0.5) * 0.9;
    const p = (k) => { const aa = a + da * k, yy = y + l * k; return [axis[0] + Math.cos(aa) * r, yy, axis[2] + Math.sin(aa) * r]; };
    tube(M, [p(0), p(0.5), p(1)], [0.003, 0.004, 0.002], { ring: 4, seg: 3, col, mat: GLOW });
  }
}
function glowEyes(M, col, r = 0.011) {
  on(M, 'head');
  for (const sd of [1, -1]) glow(M, [sd * 0.033, EYE_Y, 0.088], [r, r * 0.7, r * 0.5], col, { halo: 0.55, haloR: 3.5, light: 0.3 });
}

// ── the bay leviathan's head ─────────────────────────────────────────────────────────────────────────
// A deep-water predator's head on the end of the neck, bigger than the neck it's on: a skull with cheek plates and
// brow ridges over bony eye sockets, the jaw dropped open on rows of needle fangs, a tongue, and a cold light down
// its throat that lights the teeth from inside. A gold eye (the one crisp thing on it) with a row of photophores
// under it, as a dragonfish has, slit nostrils, gill slits down the neck, barbels with lit tips, and a translucent
// crest on bone rays from the crown down the neck. `tip` is the neck's end, D the way the neck runs there and U its
// up; r the head's half-width.
function leviathanHead(M, tip, D, U, r, t) {
  // the head turns from the neck to look out and a little down
  const hz = norm([D[0], 0, D[2]]), F = norm(add(vlen([D[0], 0, D[2]]) > 0.1 ? hz : [0, 0, 1], [0, -0.32, 0]));
  const X = norm(cross([0, 1, 0], F)), Uh = norm(cross(F, X)), L = r * 2.7;
  const base = madd(madd(tip, D, r * 0.35), F, -r * 0.2);
  const P = (a, b, c) => add(base, add(add(mul(X, a), mul(Uh, b)), mul(F, c)));
  const ivory = C('#dce6e8'), plate = C('#a8b4c4'), lav = C('#8a88b0'), mouth = C('#4a2034'), gum = C('#7a3a52'), bone = C('#f2ede0');
  // the neck into the head
  tube(M, [madd(tip, D, -r * 0.6), tip, base], [r * 0.62, r * 0.66, r * 0.74], { ring: 18, seg: 4, col: ivory, mat: MAT.SATIN });
  // the skull: the upper jaw, wide at the cheeks, a ridge over each eye, the snout tapering
  const SK = [[0, [0.86, 0.84, 0.0]], [1, [0.98, 0.8, 0.02]], [2, [0.74, 0.6, 0.06]], [3, [0.48, 0.38, 0.02]], [4, [0.22, 0.17, -0.02]]];
  const skull = sweep(M, [P(0, 0, -0.22 * L), P(0, 0.05 * r, 0.12 * L), P(0, 0.03 * r, 0.42 * L), P(0, -0.08 * r, 0.72 * L), P(0, -0.16 * r, L)], (t2, u) => {
    const [w, h, oy] = keys(SK, u);
    // flattened underneath, where the mouth opens; the brow lifts over the eye
    return { w: w * r, h: h * r, oy: oy * r, b: (a) => (Math.sin(a) < 0 ? -0.22 * Math.sin(a) ** 2 : 0.06 * Math.exp(-((Math.abs(Math.cos(a)) - 0.55) ** 2) / 0.02) * Math.exp(-((u - 1.6) ** 2) / 0.3)) };
  }, {
    up: Uh, ring: 28, seg: 8, mat: MAT.SATIN,
    col: (t2, a, p, u) => {
      const sa = Math.sin(a);
      if (u > 0.8 && sa < -0.62) return mouth;
      if (u > 0.8 && sa < -0.42) return gum;
      if (sa > 0.25 && scaleEdge(t2, a, 16, 12, 0.1)) return plate;
      if (fnoise(p, 1.1) > 0.7) return lav;
      return ivory;
    },
  });
  // the lower jaw, dropped open on its hinge
  const g = 0.55 + 0.05 * Math.sin(t * 0.7), Fj = rot(F, X, g), Uj = rot(Uh, X, g), hinge = P(0, -0.42 * r, 0.1 * L), jl = 0.9 * L;
  const jaw = sweep(M, [madd(hinge, Fj, -0.1 * L), hinge, madd(hinge, Fj, jl * 0.5), madd(hinge, Fj, jl)], (t2) => ({ w: r * (0.86 - 0.62 * t2), h: r * (0.3 - 0.16 * t2), oy: r * 0.04, b: (a) => (Math.sin(a) > 0 ? -0.35 * Math.sin(a) ** 3 : 0) }), {
    up: Uj, ring: 22, seg: 6, mat: MAT.SATIN,
    col: (t2, a, p) => (Math.sin(a) > 0.45 ? mouth : Math.sin(a) > 0.2 ? gum : Math.sin(a) < -0.5 ? C('#eef2f0') : fnoise(p, 1.1) > 0.7 ? lav : ivory),
  });
  // the tongue, and the cold light down the throat
  sweep(M, [madd(madd(hinge, Fj, jl * 0.1), Uj, r * 0.08), madd(madd(hinge, Fj, jl * 0.45), Uj, r * 0.12), madd(madd(hinge, Fj, jl * 0.72), Uj, r * 0.06)], (t2) => ({ w: r * (0.34 - 0.2 * t2), h: r * 0.07 }), { up: Uj, ring: 12, seg: 4, col: '#b8708e', mat: MAT.GLOSS });
  glow(M, P(0, -0.5 * r, 0.2 * L), [r * 0.2, r * 0.14, r * 0.1], '#8fe3ff', { pulse: true, halo: 0.7, haloR: 2.2, light: r * 3.2, lightK: 1.4 });
  // teeth: needles along both jaws, a fang every few, curved back, longest at the front
  const R = rng(613);
  for (const sd of [1, -1]) {
    for (let i = 0; i < 17; i++) {
      const k = i / 16, q = skull.at(0.3 + 0.66 * k, sd > 0 ? -0.62 : Math.PI + 0.62), fang = i % 4 === 3 || i >= 15;
      const len = r * (fang ? 0.42 + 0.18 * k : 0.12 + 0.12 * R()), dir = norm(add(mul(Uh, -1), mul(F, -0.18 - 0.1 * R())));
      spike(M, madd(q.p, Uh, r * 0.03), madd(q.p, dir, len), r * (fang ? 0.05 : 0.028), { col: bone, mat: MAT.GLOSS, ring: 6, bend: mul(F, len * 0.12) });
    }
    for (let i = 0; i < 14; i++) {
      const k = i / 13, q = jaw.at(0.18 + 0.78 * k, sd > 0 ? 0.62 : Math.PI - 0.62), fang = i % 4 === 2 || i >= 12;
      const len = r * (fang ? 0.36 + 0.16 * k : 0.1 + 0.1 * R()), dir = norm(add(Uj, mul(Fj, -0.15)));
      spike(M, madd(q.p, Uj, -r * 0.02), madd(q.p, dir, len), r * (fang ? 0.045 : 0.025), { col: bone, mat: MAT.GLOSS, ring: 6, bend: mul(Fj, len * 0.1) });
    }
  }
  // the cheeks: a heavy plate over each hinge
  for (const sd of [1, -1]) blob(M, P(sd * 0.82 * r, -0.2 * r, 0.12 * L), [0.24 * r, 0.32 * r, 0.42 * r], { axes: [X, Uh, F], col: (d, p) => (scaleEdge(d[2] * 0.5 + 0.5, d[1] * 3, 6, 4, 0.12) ? plate : ivory), mat: MAT.SATIN, lump: 0.08, seed: sd, nu: 18, nv: 10 });
  // the eyes: gold, slit, set in bony sockets under a ridge, with photophores in an arc beneath
  for (const sd of [1, -1]) {
    const e = skull.at(0.36, sd > 0 ? 0.42 : Math.PI - 0.42), ep = madd(e.p, e.n, -0.04 * r), look = norm(add(add(e.n, mul(F, 0.9)), mul(Uh, -0.1)));
    eye(M, ep, 0.17 * r, look, { iris: '#ffd040', pupil: '#05060a', slit: 0.7, white: '#f4e8b0', glow: true });
    M.halos.push({ p: ep, r: [0.3 * r, 0.22 * r, 0.3 * r], axes: null, c: C('#ffd040'), k: 0.3, bone: M.bone });
    const ex = norm(cross(look, Uh)), ey = cross(ex, look);
    loop(M, (s) => { const a = s * Math.PI * 2; return add(madd(ep, look, 0.04 * r), add(mul(ex, Math.cos(a) * 0.2 * r), mul(ey, Math.sin(a) * 0.19 * r))); }, 0.035 * r, { col: plate, mat: MAT.SATIN, n: 20 });
    // the brow ridge, swept back into a horn
    tube(M, [madd(madd(ep, Uh, 0.2 * r), F, 0.18 * r), madd(madd(madd(ep, Uh, 0.27 * r), F, -0.1 * r), X, sd * 0.04 * r), madd(madd(madd(ep, Uh, 0.32 * r), F, -0.55 * r), X, sd * 0.12 * r), madd(madd(madd(ep, Uh, 0.5 * r), F, -1.0 * r), X, sd * 0.2 * r)],
      [0.07 * r, 0.09 * r, 0.06 * r, 0.008 * r], { ring: 10, seg: 5, col: (u) => mix(plate, bone, smooth(0.4, 1, u)), mat: MAT.SATIN });
    for (let i = 0; i < 5; i++) { const a = -1.9 - i * 0.28; glow(M, add(madd(ep, look, -0.02 * r), add(mul(ex, Math.cos(a) * 0.3 * r * sd), mul(ey, Math.sin(a) * 0.28 * r))), 0.03 * r, '#8fe3ff', { pulse: true, halo: 0.4, haloR: 3, light: 0 }); }
    // the nostril, a slit on the snout
    const nq = skull.at(0.86, sd > 0 ? 1.1 : Math.PI - 1.1);
    blob(M, madd(nq.p, nq.n, -0.01 * r), [0.025 * r, 0.02 * r, 0.09 * r], { axes: [X, Uh, F], col: '#2a1824', nu: 10, nv: 5 });
    // gill slits down the neck, dark, each with a pale lip
    for (let k = 0; k < 5; k++) {
      const c = madd(madd(tip, D, -(0.25 + 0.28 * k) * r), cross(U, D), sd * 0.62 * r), pts = [-1, -0.5, 0, 0.5, 1].map((v) => madd(madd(c, U, v * 0.34 * r), D, -Math.abs(v) * 0.06 * r));
      tube(M, pts, pts.map(() => 0.02 * r), { ring: 5, seg: 2, col: '#3a1830' });
      tube(M, pts.map((p) => madd(p, D, 0.035 * r)), pts.map(() => 0.016 * r), { ring: 5, seg: 2, col: '#b8b4cc' });
    }
  }
  // barbels: a pair off the chin and a pair off the corners of the mouth, hanging and swaying, their tips lit
  for (const [root, len, sw] of [[jaw.at(0.95, -Math.PI / 2 + 0.3).p, 1.6, 0], [jaw.at(0.95, -Math.PI / 2 - 0.3).p, 1.5, 1], [skull.at(0.62, -0.35).p, 1.2, 2], [skull.at(0.62, Math.PI + 0.35).p, 1.25, 3]]) {
    const pts = [root];
    let d = norm(add(mul(F, 0.3), [0, -1, 0]));
    for (let i = 1; i < 6; i++) { d = norm(add(d, [Math.sin(t * 1.1 + sw + i * 0.6) * 0.12, -0.05, -0.12])); pts.push(madd(pts[i - 1], d, (len * r) / 5)); }
    tube(M, pts, [0.05, 0.04, 0.03, 0.022, 0.016, 0.01].map((v) => v * r), { ring: 7, seg: 3, col: lav, mat: MAT.SATIN });
    glow(M, pts[5], 0.035 * r, '#8fe3ff', { pulse: true, halo: 0.5, haloR: 3, light: sw === 0 ? r * 1.6 : 0, lightK: 0.6 });
  }
  // the crest: bone rays from the crown down the neck, translucent membrane between them
  const rays = [];
  for (let i = 0; i < 8; i++) { const q = skull.at(0.38 - i * 0.05, Math.PI / 2); rays.push({ b: madd(q.p, q.n, -0.03 * r), d: norm(add(Uh, mul(F, -0.75))), l: r * (0.75 + 0.5 * Math.sin(Math.PI * (i + 1) / 9)) }); }
  for (let j = 0; j < 7; j++) { const b = madd(madd(tip, D, -(j + 0.2) * 0.42 * r), U, r * 0.6); rays.push({ b, d: norm(add(U, mul(D, -0.6))), l: r * (0.95 - j * 0.11) }); }
  rays.forEach((ry, i) => { ry.tip = add(madd(ry.b, ry.d, ry.l), mul(F, Math.sin(t * 0.9 + i * 0.5) * 0.04 * r)); spike(M, ry.b, ry.tip, 0.04 * r, { col: bone, mat: MAT.SATIN, ring: 6 }); });
  for (let i = 0; i < rays.length - 1; i++) {
    const a = rays[i], b = rays[i + 1];
    sheet(M, (u, v) => { const p0 = lerp3(a.b, b.b, u), p1 = lerp3(a.tip, b.tip, u); return madd(lerp3(p0, p1, v), F, -Math.sin(Math.PI * u) * v * 0.08 * r); }, 3, 4, { col: '#c4c2dc', mat: TRANSLUCENT, shade: '#8a7ab8', thick: 0.01 * r });
  }
  // scars across the snout
  for (let i = 0; i < 3; i++) { const q0 = skull.at(0.55 + i * 0.08, 0.9 + i * 0.4), q1 = skull.at(0.62 + i * 0.08, 1.6 + i * 0.4); tube(M, [madd(q0.p, q0.n, 0.004 * r), madd(q1.p, q1.n, 0.004 * r)], [0.014 * r, 0.01 * r], { ring: 4, col: '#f4f2ec' }); }
  return { skull, jaw };
}

// ── the recipes ──────────────────────────────────────────────────────────────────────────────────────
const fig = (o) => ({ ...o });
// Fur over the top of each foreleg of a finished cat, hanging down over the seam where the arm comes out of the
// body, so the leg grows out of the coat (beast-kit.js furOver). Sizes are in metres: the model is already scaled.
function catFur(M, R, o = {}) {
  for (const L of R.legs) if (L.key.endsWith('F')) furOver(M, L.t0, L.t1, { seed: L.key[0] === 'L' ? 38 : 45, side: [L.key[0] === 'L' ? 1 : -1, 0, 0], band: [0.55, 0.86], n: 14, len: 0.022, w: 0.008, dir: (n) => add(mul(n, 0.22), [0, -0.95, -0.15]), curl: 0.3, ...o });
  return R;
}

// The cat (the gutter cat, and Cathode on it): its look as quadruped's numbers.
const CAT = {
  // legs as a cat's in profile: the foreleg near upright with the paw under the shoulder, the hind leg deeply
  // angled, the hock high and the metatarsus raked back; the thighs heavy with muscle, on big paws
  // a cat's paws, big as a hunter's, the fronts the bigger, the leg coming down into them thick (beast-legs.js catPawFoot)
  pawStyle: 'cat', retract: true, pawK: 2.1, wrist: 1.65, pads: '#3a2a2a', stance: 1.05, foreSet: 0.05, foreHigh: 0.11, foreWide: 1.6, hindHigh: 0.05, hindWide: 1.45, haunch: 1.75, arm: 1.85, legTune: { F: { k: 1.04, dir: [0, 1, -0.22], pawK: 1.12 }, H: { meta: 0.38, k: 1.24, dir: [0, 1, -0.26] } },
  // Proportions measured off a side photo of a walking Bengal, each as a share of the height at the shoulder:
  // rump to chest 1.25, the belly at 0.42, the back of the head 0.1 ahead of the chest and the nose 0.47, the top
  // of the head 0.23 over the back, the head 0.37 long (scripts: the bestiary's profile check). The neck is long
  // and carries the head forward and up off a deep chest; the mane thickens it.
  seed: 91, scale: 0.42, len: 0.62, legLen: 0.82, legW: 1.0, chestD: 1.2, waist: 1.15, bloat: 0.85, rump: 1.22, arch: 0.8, neckLen: 0.95, neckW: 1.05, neckRise: 0.7, headPitch: -0.05, ribs: 0, scars: 3, hackles: 0, shag: 0.7,
  coat: '#5a524a', back: '#3a3430', belly: '#8a8278', legs: '#4a443e', paws: '#4a443e', stripes: [26, '#2a2622', 0.3],
  // A rough coat: soft fur drawn a strand at a time (furShells), longest on the tail and short on the face, and
  // over it clumps of fur in the comic manner, finely inked, only where a shaggy tom has them: the ruff round his
  // neck and down his chest, britches over the hind legs and a fringe under the belly. The back is left to the
  // soft fur: spikes along it read as a ridge of thorns. The clumps take the coat's own paint, stripes and all.
  fur: { body: 0.036, tail: 0.04, legs: 0.018, head: 0.012, budget: 22000 },
  extra: (M2, { body, neck, head, paint }) => {
    const coat = (region) => (t2, a, p) => paint(t2, a, p, region), down = [0, -1, 0], back = [0, 0, -1];
    // the ruff: a mane round the neck, longest under the throat, lying the way the coat runs (down the neck and
    // back along the body) and thinning out over the shoulders into the soft fur, so it's the coat grown long
    const flow = (f, k) => add(add(add(mul(f.T, -0.5), mul(back, 0.5)), mul(down, k)), mul(f.n, 0.62));
    furCoat(M2, neck, { seed: 34, t0: 0.18, t1: 0.98, dt: 0.1, da: 0.4, len: (t2, a) => 0.075 + 0.055 * Math.max(0, -Math.sin(a)), dir: (f, t2, a) => flow(f, 0.25 * Math.max(0, -Math.sin(a))), w: 0.024, curl: 1.0, col: coat('neck') });
    // and up over the back of the head to the crown, shortening as it goes, short of the ears
    furCoat(M2, head.skull, { seed: 37, t0: 0.0, t1: 0.3, a0: -0.55, a1: Math.PI + 0.55, dt: 0.075, da: 0.42, len: (t2) => 0.016 + 0.05 * (1 - t2 / 0.34), lie: 0.8, stand: 0.55, w: 0.02, curl: 1.0, col: (t2, a, p) => paint(0.5, a, p, 'neck') });
    furCoat(M2, body, { seed: 36, t0: 0.7, t1: 0.9, a0: -0.6, a1: Math.PI + 0.6, dt: 0.07, da: 0.5, len: (t2) => 0.065 * smooth(0.68, 0.9, t2), dir: (f) => flow(f, 0.15), w: 0.022, curl: 1.0, col: coat('body') });
    furCoat(M2, body, { seed: 35, t0: 0.9, t1: 1.0, a0: Math.PI + 0.75, a1: 2 * Math.PI - 0.75, dt: 0.05, da: 0.4, len: () => 0.058, dir: (f) => add(add(mul(down, 0.7), mul(back, 0.4)), mul(f.n, 0.35)), w: 0.024, curl: 1.0, col: coat('neck') });
    // britches over the hind legs
    for (const [a0, a1] of [[-0.85, 0.0], [Math.PI, Math.PI + 0.85]]) {
      furCoat(M2, body, { seed: 33, t0: 0.03, t1: 0.24, a0, a1, dt: 0.065, da: 0.36, len: () => 0.07, dir: (f) => add(add(mul(f.T, -0.55), mul(down, 0.65)), mul(f.n, 0.35)), w: 0.022, curl: 1.0, col: coat('body') });
    }
    // a fringe under the belly
    furCoat(M2, body, { seed: 32, t0: 0.36, t1: 0.82, a0: Math.PI + 0.75, a1: 2 * Math.PI - 0.75, dt: 0.075, da: 0.42, len: () => 0.06, dir: (f) => add(add(mul(f.T, -0.3), mul(down, 0.85)), mul(f.n, 0.3)), w: 0.02, curl: 1.0, col: coat('body') });
  },
  head: { face: 'cat', size: 1.38, skull: 0.12, muzzle: 0.05, skullW: 1.2, muzzleW: 0.9, stop: 0.3, gape: 0.13, ears: (sd) => (sd > 0 ? 'prick' : 'stub'), earLen: 0.09, earW: 1.5, iris: '#a8c030', slit: 0.8, eyeR: 0.017, col: '#5a524a', cheek: '#8a8278', whiskers: 4, brow: 0.5, nose: '#c47a80', inner: '#b88480', tabby: '#2a2622' },
  tail: { len: 0.6, r: 0.026, lift: 1.0, curl: 0.3, col: '#4a443e', rings: [8, '#2a2622'], kind: 'bushy' },
};

// Cathode's right forepaw: from the wrist down, machined steel. A collar at the wrist with a seam of amber light at
// the fur's edge, a metacarpal with a piston behind it, a housing for the paw, and four toes of two segments each on
// knuckles, rubber under their tips. Built in the leg's own foot frame (beast-legs.js, as pawFoot is), so it stands
// where a paw would.
const STEEL = '#6a6e74', STEEL_D = '#3c3f44', AMBER = '#ffb040', RUBBER = '#1c1c1e';
function steelPaw(M, { W, U, F: Fw, Sd, at, lw, pw }) {
  const ax = [Sd, U, Fw], ball = at([0, pw * 0.62, -pw * 0.12]), md = norm(sub(W, ball)), Y1 = norm(cross(md, Sd));
  const ring = (c, r) => (s) => { const a = s * Math.PI * 2; return add(c, add(mul(Sd, Math.cos(a) * r), mul(Y1, Math.sin(a) * r))); };
  // the seam of light where the fur stops, and the collar under it
  loop(M, ring(madd(W, md, -pw * 0.12), pw * 0.84), pw * 0.1, { col: AMBER, mat: GLOW, n: 28 });
  glow(M, madd(W, md, -pw * 0.12), pw * 0.08, AMBER, { halo: 0.5, haloR: 6, light: 0.1 });
  tube(M, [madd(W, md, -pw * 0.2), madd(W, md, -pw * 0.5)], [pw * 0.82, pw * 0.72], { ring: 16, col: STEEL, mat: MAT.METAL });
  // the metacarpal, and its piston behind
  tube(M, [madd(W, md, -pw * 0.45), ball], [pw * 0.5, pw * 0.58], { ring: 14, col: STEEL, mat: MAT.METAL });
  tube(M, [madd(madd(W, md, -pw * 0.5), Fw, -pw * 0.55), madd(ball, Fw, -pw * 0.6)], [pw * 0.14, pw * 0.14], { ring: 8, col: STEEL_D, mat: MAT.METAL });
  // the housing, two bolts on it, and the sole
  blob(M, at([0, pw * 0.62, -pw * 0.15]), [pw * 1.02, pw * 0.56, pw * 1.05], { axes: ax, e1: 0.55, e2: 0.75, col: STEEL, mat: MAT.METAL, nu: 18, nv: 10 });
  for (const sd of [1, -1]) blob(M, at([sd * pw * 0.35, pw * 1.07, -pw * 0.12]), [pw * 0.1, pw * 0.06, pw * 0.1], { axes: ax, col: STEEL_D, mat: MAT.METAL, nu: 8, nv: 5 });
  blob(M, at([0, pw * 0.12, -pw * 0.22]), [pw * 0.6, pw * 0.12, pw * 0.5], { axes: ax, col: RUBBER, mat: MAT.SATIN, nu: 12, nv: 6 });
  // four toes, each a knuckle, two segments and a joint between, rubber under the tip
  for (let i = 0; i < 4; i++) {
    const a = (i - 1.5) * 0.42, x = Math.sin(a) * pw * 1.0, z = Math.cos(a) * pw * (0.85 + (i === 1 || i === 2 ? 0.13 : 0));
    const k0 = at([x, pw * 0.55, z * 0.55]), k1 = at([x, pw * 0.42, z * 0.95]), tip = at([x * 1.03, pw * 0.14, z * 1.15]);
    blob(M, k0, [pw * 0.3, pw * 0.3, pw * 0.3], { col: STEEL_D, mat: MAT.METAL, nu: 10, nv: 7 });
    tube(M, [k0, k1], [pw * 0.28, pw * 0.25], { ring: 10, col: STEEL, mat: MAT.METAL });
    blob(M, k1, [pw * 0.24, pw * 0.24, pw * 0.24], { col: STEEL_D, mat: MAT.METAL, nu: 10, nv: 7 });
    tube(M, [k1, tip], [pw * 0.23, pw * 0.14], { ring: 10, col: STEEL, mat: MAT.METAL });
    blob(M, at([x * 1.03, pw * 0.08, z * 1.12]), [pw * 0.27, pw * 0.09, pw * 0.3], { axes: ax, col: RUBBER, mat: MAT.SATIN, nu: 10, nv: 5 });
  }
}

export const BESTIARY = {
  // ── people
  enemy_scav: fig({
    group: 'people', clip: 'guard', mood: 'afraid', moodI: 0.6, facial: 'stubble', scarf: 'bandana',
    figure: { cut: 'tank', top: rgb('#7a6e4c'), legs: rgb('#4c4232'), shoes: rgb('#3a2a1e'), skin: rgb('#c27a5e'), hair: rgb('#5a3a20'), hair_style: 2, weight: 0.1, fabric_top: 'rag', fabric_legs: 'canvas' },
    gear: (M) => knife(M, -1, '#9aa0a4', 0.16),
    note: 'A tank top gone to rag, a bandana, a sunburn and a blade held up.',
  }),
  enemy_squatter: fig({
    group: 'people', mood: 'annoyed', hat: 'beanie', scarf: 'chunky', facial: 'full',
    figure: { cut: 'overcoat', top: rgb('#4c4438'), legs: rgb('#3a3630'), shoes: rgb('#2e2620'), skin: rgb('#b0907a'), hair: rgb('#6a6a62'), build: 'older', weight: 0.15, age: 0.5, fabric_top: 'rag' },
    gear: (M) => { held(M, -1, [[0, 0, -0.12], [0, 0, 0.62]], 0.017, '#6a4a36', { ring: 10 }); held(M, -1, [[0, 0, 0.58], [0, 0, 0.64]], 0.024, '#5a3e2c', { ring: 10 }); },
    note: 'An overcoat over everything else, and a length of pipe.',
  }),
  enemy_scrap_picker: fig({
    group: 'people', clip: 'idleLook', mood: 'afraid', moodI: 0.5, scarf: 'scarf',
    figure: { cut: 'parka', top: rgb('#5c5a46'), legs: rgb('#3c3a30'), shoes: rgb('#2a2620'), skin: rgb('#9a8270'), hair: rgb('#3a3028'), weight: 0.05, fabric_top: 'rag' },
    gear: (M) => {
      gasMask(M);
      on(M, 'handL');
      blob(M, add(PALM(1), [0.03, -0.17, -0.02]), [0.13, 0.17, 0.11], { lump: 0.22, seed: 4, col: '#7a6a4a', nu: 16, nv: 10 });
      tube(M, [add(PALM(1), [0, 0.02, 0]), add(PALM(1), [0.02, -0.03, -0.02])], [0.02, 0.02], { col: '#6a5a40', ring: 8 });
    },
    note: 'A cracked gas mask and a sack of salvage held close.',
  }),
  enemy_sprawl_ganger: fig({
    group: 'people', clip: 'guard', facial: 'goatee',
    figure: { cut: 'jacket', top: rgb('#3a3446'), legs: rgb('#2a2a30'), shoes: rgb('#1e1c1e'), skin: rgb('#8a6650'), hair: rgb('#141012'), hair_style: 4, weight: 0.2, fabric_top: 'leather', print: '' },
    gear: (M) => {
      knife(M, -1, '#8a8e90', 0.11);
      // the patches, sewn on
      on(M, 'chest');
      for (const [x, y, c] of [[0.11, 1.32, '#8a3a2a'], [-0.09, 1.22, '#4a6a3a']]) blob(M, [x, y, 0.118], [0.035, 0.03, 0.006], { col: c, nu: 10, nv: 5, e1: 0.3, e2: 0.4 });
      plate(M, 'uarmL', [0.245, 1.25, -0.01], [0.004, 0.035, 0.03], '#b08a3a', { n: [1, 0, 0] });
    },
    note: 'A patched leather jacket and a ground-down shiv.',
  }),
  enemy_prybar_nomad: fig({
    group: 'people', sex: 'female', mood: 'neutral', scarf: 'scarf',
    figure: { cut: 'duster', top: rgb('#8a7a5c'), legs: rgb('#5a4a38'), shoes: rgb('#3a2c20'), skin: rgb('#a8805e'), hair: rgb('#3a2a1e'), hair_style: 0, weight: 0.3, fabric_top: 'canvas', build: 'woman' },
    gear: (M) => {
      goggles(M, true);
      // a four-foot bar carried like an umbrella, its claw on the ground
      held(M, -1, [[0, 0.3, -0.06], [0, 0, 0], [-0.03, -0.42, 0.22], [-0.05, -0.74, 0.4]], 0.014, '#5a5e64', { ring: 8 });
      held(M, -1, [[-0.05, -0.74, 0.4], [-0.05, -0.77, 0.45], [-0.05, -0.75, 0.48]], [0.013, 0.01, 0.004], '#5a5e64', { flat: 0.5 });
    },
    note: 'Goggles up on a shaved head and a wrecking bar carried like an umbrella.',
  }),
  enemy_clonejacker: fig({
    group: 'people', clip: 'idleLook', mood: 'afraid', moodI: 0.4, height: 1.7,
    figure: { cut: 'labcoat', top: rgb('#c8d0cc'), shirt: rgb('#3a5a6a'), legs: rgb('#3a3a3e'), shoes: rgb('#20201e'), skin: rgb('#c8a48a'), hair: rgb('#8a5a2a'), hair_style: 2, weight: 0.0 },
    gear: (M) => {
      // a coat two sizes too big: its pockets full of somebody else's starter kits
      for (const sd of [1, -1]) {
        on(M, 'pelvis');
        blob(M, [sd * 0.15, 0.9, 0.11], [0.06, 0.07, 0.05], { col: '#b8c0bc', lump: 0.15, seed: sd, nu: 12, nv: 8 });
        blob(M, [sd * 0.14, 0.95, 0.15], [0.03, 0.035, 0.02], { col: sd > 0 ? '#3aa0a8' : '#c8a030', mat: GLOSS, nu: 10, nv: 6 });
      }
      on(M, 'chest'); glow(M, [0.1, 1.33, 0.128], [0.028, 0.038, 0.006], '#4ab0c0', { pulse: true, halo: 0.5, light: 0.3 });
    },
    note: 'A stolen vat-tech coat, pockets bulging.',
  }),
  enemy_halcyon_adjuster: fig({
    group: 'people', fam: 'halcyon', clip: 'idleBehind', mood: 'neutral',
    figure: { cut: 'blazer', top: rgb('#2c2e33'), shirt: rgb('#e8e6e0'), legs: rgb('#2a2c30'), shoes: rgb('#101012'), skin: rgb('#c09a80'), hair: rgb('#1c1a18'), hair_style: 1, weight: 0.45, fabric_shoes: 'leather', facial: 'clean' },
    gear: (M) => { on(M, 'chest'); glow(M, [0.12, 1.36, 0.12], [0.011, 0.011, 0.004], '#4fd1c5', { halo: 0.45, haloR: 2.5, light: 0.15 }); blob(M, [0.12, 1.36, 0.121], [0.0045, 0.0045, 0.003], { col: '#10141a', mat: GLOSS, nu: 8, nv: 4 }); },
    note: 'A charcoal suit and a lapel pin: a calm eye.',
  }),
  enemy_halcyon_supervisor: fig({
    group: 'people', fam: 'halcyon', clip: 'idleHip', mood: 'annoyed', moodI: 0.5, facial: 'trimmed',
    figure: { cut: 'shortsleeve', top: rgb('#3a5a8c'), legs: rgb('#b4a274'), shoes: rgb('#4a3424'), skin: rgb('#d0a888'), hair: rgb('#6a4a2a'), hair_style: 1, build: 'dadbod', weight: 0.6 },
    gear: (M) => { plate(M, 'chest', [0.1, 1.31, 0.135], [0.035, 0.045, 0.004], '#f0eee0', { n: [0, 0.1, 1], e1: 0.2, e2: 0.2 }); plate(M, 'chest', [0, 1.28, 0.105], [0.155, 0.14, 0.02], '#3a5a8c', { n: [0, 0, 1] }); },
    note: 'A polo shirt over body armour, and the escalation matrix in the pocket.',
  }),

  // ── the law, and the Architect's own
  enemy_wanted_patrol_officer: fig({
    group: 'law', mood: 'annoyed', hat: 'cap',
    figure: { cut: 'uniform', top: rgb('#1e2a44'), legs: rgb('#1a2236'), shoes: rgb('#0e0e10'), skin: rgb('#a07a60'), hair: rgb('#201a14'), hair_style: 0, weight: 0.4 },
    gear: (M) => {
      plate(M, 'chest', [0, 1.29, 0.115], [0.155, 0.13, 0.03], '#2a3448', { n: [0, 0.1, 1] });
      plate(M, 'chest', [0, 1.29, -0.105], [0.15, 0.13, 0.03], '#2a3448', { n: [0, 0, -1] });
      for (const sd of [1, -1]) { plate(M, 'uarm' + LR(sd), [sd * 0.215, 1.38, -0.01], [0.06, 0.025, 0.06], '#2a3448', { n: [sd, 1, 0], up: [0, 0, 1] }); plate(M, 'shin' + LR(sd), [sd * 0.095, 0.5, 0.055], [0.05, 0.045, 0.03], '#20242c', { n: [0, 0.2, 1], e1: 0.7 }); }
      plate(M, 'chest', [0.11, 1.4, 0.105], [0.02, 0.035, 0.015], '#101214', { n: [0, 0, 1] });
      blob(M, [0.11, 1.44, 0.105], [0.004, 0.02, 0.004], { col: '#101214', nu: 6, nv: 4 });
      on(M, 'chest'); glow(M, [-0.09, 1.36, 0.15], [0.03, 0.01, 0.004], '#e8f4ff', { halo: 0.3, light: 0.2 });
      for (const [x, c] of [[-0.2, '#ff2e3a'], [0.2, '#2e7bff']]) { on(M, x > 0 ? 'uarmL' : 'uarmR'); glow(M, [x * 1.08, 1.42, 0.0], 0.012, c, { pulse: true, halo: 0.6, light: 0.3 }); }
      pistol(M, -1);
    },
    note: 'Riot-lite armour over the uniform, a radio on the chest and the sidearm out.',
  }),
  enemy_wanted_enforcement_trooper: fig({
    group: 'law', mood: 'neutral', height: 1.86,
    figure: { cut: 'coverall', top: rgb('#1e2430'), legs: rgb('#1e2430'), shoes: rgb('#0c0c0e'), skin: rgb('#a07a60'), weight: 0.5 },
    gear: (M) => {
      const A = '#2c3442';
      helmet(M, A, '#0a1830', { visorMat: GLOSS });
      cuirass(M, A, { k: 1.05 });
      limbGuards(M, A, { knee: '#1a1e26' });
      on(M, 'chest');
      // the carbine, slung across the chest
      tube(M, [[-0.13, 1.06, 0.19], [0.0, 1.2, 0.2], [0.2, 1.42, 0.17]], [0.03, 0.028, 0.02], { ring: 6, flat: 0.6, up: [0, 0, 1], col: '#16181c', mat: SATIN });
      tube(M, [[0.2, 1.42, 0.17], [0.3, 1.53, 0.15]], [0.009, 0.009], { ring: 8, col: '#2a2c30', mat: METAL });
      blob(M, [0.02, 1.15, 0.24], [0.022, 0.05, 0.02], { col: '#16181c', axes: [[0.8, -0.6, 0], [0.6, 0.8, 0], [0, 0, 1]], nu: 10, nv: 6, e1: 0.4, e2: 0.4 });
      on(M, 'chest'); glow(M, [0, 1.38, 0.17], [0.04, 0.008, 0.004], '#5a9aff', { halo: 0.4, light: 0.2 });
      on(M, 'head'); glow(M, [0, EYE_Y + 0.005, 0.135], [0.07, 0.004, 0.004], '#6fd8ff', { halo: 0.35, haloR: 2, light: 0 });
    },
    note: 'Full plate, the visor down, a carbine across the chest.',
  }),
  enemy_wanted_heavy_enforcer: fig({
    group: 'law', mood: 'neutral', height: 2.05,
    figure: { cut: 'coverall', top: rgb('#1e2430'), legs: rgb('#1e2430'), shoes: rgb('#0c0c0e'), skin: rgb('#a07a60'), build: 'dadbod', weight: 1 },
    gear: (M) => {
      const A = '#323a46';
      helmet(M, A, '#0a1830', { k: 1.08 });
      cuirass(M, A, { k: 1.3 });
      limbGuards(M, A);
      plate(M, 'chest', [0, 1.35, -0.2], [0.17, 0.2, 0.08], '#262c36', { n: [0, 0, -1] });
      seams(M, 'chest', [0, 0, -0.27], 1.22, 1.46, 0.04, 4, '#5a9aff', 8);
      for (const sd of [1, -1]) plate(M, 'uarm' + LR(sd), [sd * 0.25, 1.4, -0.01], [0.1, 0.05, 0.1], A, { n: [sd, 1, 0], up: [0, 0, 1] });
      // the chaingun where the right forearm was
      on(M, 'farmR');
      const x = -0.197;
      tube(M, [[x, 1.1, 0], [x, 0.95, 0.01]], [0.065, 0.06], { ring: 14, col: '#2a2e36', mat: METAL });
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2, o = [Math.cos(a) * 0.03, 0, Math.sin(a) * 0.03 + 0.01]; tube(M, [add([x, 0.95, 0], o), add([x, 0.55, 0], o)], [0.011, 0.011], { ring: 7, col: '#3a3e44', mat: METAL }); }
      loop(M, (s) => { const a = s * Math.PI * 2; return [x + Math.cos(a) * 0.045, 0.6, 0.01 + Math.sin(a) * 0.045]; }, 0.008, { col: '#2a2e36', mat: METAL });
      blob(M, [x - 0.06, 1.0, -0.03], [0.05, 0.07, 0.06], { e1: 0.5, e2: 0.5, col: '#262a30', mat: METAL, nu: 12, nv: 8 });
    },
    note: 'A slab of armour with a chaingun for a right forearm and a power pack on the back.',
  }),
  enemy_arbiterclass_enforcement_unit: fig({
    group: 'law', fam: 'angel', mood: 'neutral', height: 2.1, stretch: { legs: 1.06, arms: 1.05 },
    figure: { cut: 'coverall', top: rgb('#141518'), legs: rgb('#141518'), shoes: rgb('#0a0a0c'), skin: rgb('#202224'), weight: 0, fabric_top: 'rubber' },
    gear: (M) => {
      const A = '#1a1b1f';
      on(M, 'head');
      blob(M, add(HEAD, [0, 0.01, 0]), [0.095, 0.125, 0.115], { e1: 0.9, e2: 0.8, col: A, mat: SATIN, nu: 20, nv: 12 });
      glow(M, [0, EYE_Y, 0.11], [0.08, 0.008, 0.012], '#f4f8ff', { halo: 0.9, haloR: 2.4, light: 0.6, lightK: 1.2 });
      // segmented: a plate for every part, a gap at every joint
      cuirass(M, A, { k: 0.98 });
      limbGuards(M, A, { knee: '#0c0c0e' });
      for (const sd of [1, -1]) {
        plate(M, 'uarm' + LR(sd), [sd * 0.197, 1.24, 0.0], [0.05, 0.1, 0.05], A, { n: [sd, 0, 0], e1: 0.5 });
        plate(M, 'thigh' + LR(sd), [sd * 0.1, 0.72, -0.07], [0.07, 0.12, 0.025], A, { n: [0, 0, -1] });
      }
      for (let i = 0; i < 4; i++) plate(M, 'spine', [0, 0.98 + i * 0.07, 0.095], [0.11 - i * 0.004, 0.028, 0.03], A, { n: [0, 0, 1] });
    },
    note: 'Matte black plates with a gap at every joint, and one white slit for a face.',
  }),

  // ── what used to be people
  enemy_rad_mutant: fig({
    group: 'mutant', clip: 'idleShift', mood: 'disgusted', moodI: 0.6,
    figure: { cut: 'tank', top: rgb('#6a6248'), legs: rgb('#4a4436'), shoes: rgb('#2a2420'), skin: rgb('#a8906c'), hair: rgb('#4a4030'), hair_style: 0, build: 'hunched', weight: 0.3, fabric_top: 'rag',
      mutations: ['mut_mottled_skin', 'mut_rad_freckles', 'mut_weeping_sores'], mut_accent: rgb('#7a9a3a') },
    gear: (M) => {
      // the extra limb, out of the small of the back to the floor: it takes weight
      on(M, 'pelvis');
      tube(M, [[0.02, 1.02, -0.08], [0.06, 0.9, -0.22], [0.08, 0.62, -0.36], [0.07, 0.3, -0.42], [0.06, 0.03, -0.44]], [0.055, 0.06, 0.045, 0.035, 0.03], { ring: 12, seg: 5, col: '#a08668', mat: MAT.MATTE });
      blob(M, [0.08, 0.62, -0.36], [0.05, 0.05, 0.05], { col: '#a08668', nu: 12, nv: 8 });
      blob(M, [0.06, 0.02, -0.4], [0.05, 0.025, 0.08], { col: '#8a7058', nu: 12, nv: 6, lump: 0.2 });
    },
    note: 'Mottled and freckled by the Bleed, with a third leg out of the small of the back.',
  }),
  enemy_bloated_mutant: fig({
    group: 'mutant', mood: 'tired', height: 1.86,
    figure: { cut: 'tank', top: rgb('#5a564a'), legs: rgb('#3a3832'), shoes: rgb('#2a2622'), skin: rgb('#8a8a7e'), hair: rgb('#3a3a34'), hair_style: 0, build: 'dadbod', weight: 1, fabric_top: 'rag',
      mutations: ['mut_weeping_sores', 'mut_translucent_veins'], mut_accent: rgb('#6a7a5a') },
    gear: (M) => lumps(M, [
      ['spine', [0.02, 1.12, 0.13], [0.15, 0.13, 0.11]], ['chest', [-0.08, 1.3, 0.1], [0.12, 0.11, 0.09]], ['chest', [0.0, 1.3, -0.12], [0.16, 0.15, 0.1]],
      ['chest', [0.14, 1.4, -0.04], [0.09, 0.08, 0.08]], ['uarmL', [0.22, 1.24, 0.0], [0.08, 0.1, 0.08]], ['uarmR', [-0.22, 1.28, -0.02], [0.07, 0.08, 0.07]],
      ['thighL', [0.12, 0.72, 0.02], [0.1, 0.12, 0.1]], ['thighR', [-0.12, 0.8, -0.04], [0.09, 0.1, 0.09]], ['neck', [0.06, 1.47, -0.04], [0.07, 0.06, 0.07]],
    ], (i) => (i % 3 ? '#8a8a7c' : '#7e7a6c'), { lump: 0.3 }),
    note: 'A body lost inside a rind of grey, tumorous flesh.',
  }),
  enemy_knuckle_mutant: fig({
    group: 'mutant', clip: 'stare', mood: 'angry', stretch: { arms: 1.45, legs: 0.72 },
    figure: { cut: 'tank', top: rgb('#4a4a40'), legs: rgb('#3a3630'), shoes: rgb('#2a2622'), skin: rgb('#8a8478'), hair: rgb('#2a2622'), hair_style: 0, build: 'hunched', weight: 0.7, fabric_top: 'rag',
      mutations: ['mut_dermal_thickening'], mut_accent: rgb('#5a5a50') },
    gear: (M) => { for (const sd of [1, -1]) lumps(M, [[`farm${LR(sd)}`, [sd * 0.197, 0.97, 0], [0.085, 0.13, 0.085]], [`uarm${LR(sd)}`, [sd * 0.2, 1.24, -0.01], [0.075, 0.12, 0.075]], [`hand${LR(sd)}`, [sd * 0.2, 0.79, 0.01], [0.06, 0.06, 0.07]]], '#7a766a', { lump: 0.15, seed: sd * 3 }); },
    note: 'Forearms like fire hydrants on arms drawn out to the floor; the legs shrunk under it.',
  }),
  enemy_stilt_mutant: fig({
    group: 'mutant', mood: 'neutral', stretch: { legs: 1.6 },
    figure: { cut: 'tee', top: rgb('#5a5850'), legs: rgb('#3c3a36'), shoes: rgb('#2a2622'), skin: rgb('#9a948a'), hair: rgb('#2a2622'), hair_style: 0, weight: 0, fabric_top: 'rag' },
    note: 'Unchanged above the hips; the legs half again too long.',
  }),
  enemy_sixarm_thresher: fig({
    group: 'mutant', clip: 'guard', mood: 'angry',
    figure: { cut: 'tank', top: rgb('#4a3e34'), legs: rgb('#3a3028'), shoes: rgb('#2a2420'), skin: rgb('#a07c66'), hair: rgb('#2a2018'), hair_style: 0, weight: 0.4, fabric_top: 'rag',
      mutations: ['mut_wb_spider_limbs', 'mut_regenerative_scarring'], mut_accent: rgb('#8a3a2a') },
    gear: (M) => {
      // the third pair, out of the lower ribs, worked forward
      on(M, 'spine');
      for (const sd of [1, -1]) {
        const sh = [sd * 0.13, 1.07, 0.0], el = [sd * 0.3, 1.0, 0.16], wr = [sd * 0.24, 1.08, 0.38];
        tube(M, [sh, el, wr], [0.042, 0.034, 0.026], { ring: 12, seg: 5, col: '#a07c66' });
        blob(M, el, [0.036, 0.036, 0.036], { col: '#a07c66', nu: 10, nv: 6 });
        blob(M, add(wr, [0, 0, 0.05]), [0.03, 0.025, 0.055], { col: '#94705c', nu: 12, nv: 8 });
        for (let k = 0; k < 3; k++) spike(M, add(wr, [sd * (k - 1) * 0.015, 0, 0.09]), add(wr, [sd * (k - 1) * 0.02, -0.03, 0.13]), 0.008, { col: '#6a5040', ring: 5 });
      }
    },
    note: 'Six arms in three pairs down a torso that never grew to match.',
  }),
  enemy_gill_mutant: fig({
    group: 'mutant', fam: 'deep', mood: 'neutral', clip: 'stare',
    figure: { cut: 'baselayer', top: rgb('#3a4044'), legs: rgb('#3a4044'), shoes: rgb('#2a2e30'), skin: rgb('#8e969a'), hair: rgb('#8e969a'), hair_style: 0, weight: 0.2, fabric_top: 'rubber',
      mutations: ['mut_wb_gills', 'mut_wb_thermal_vision'], mut_accent: rgb('#c86a6a') },
    gear: (M) => { on(M, 'neck'); for (const sd of [1, -1]) for (let i = 0; i < 3; i++) plate(M, 'neck', [sd * 0.055, 1.5 - i * 0.022, 0.0], [0.003, 0.006, 0.03], '#7a2a30', { n: [sd, 0, 0], mat: GLOSS }); },
    note: 'Grey and hairless, three wet slits down each side of the neck.',
  }),
  enemy_sewer_junkie: fig({
    group: 'people', mood: 'happy', moodI: 0.7, facial: 'stubble',
    figure: { cut: 'tee', top: rgb('#6a4a2a'), legs: rgb('#3a3630'), shoes: rgb('#2a2620'), skin: rgb('#a8806a'), hair: rgb('#3a2a20'), hair_style: 2, weight: 0.0, fabric_top: 'rag' },
    gear: (M) => { goggles(M, true); held(M, -1, [[0, 0, -0.1], [0, 0, 0.6], [0, -0.05, 0.66]], 0.014, '#5a5e64', { ring: 8 }); },
    note: 'Goggles up, a hooked pipe and a grin with too few teeth.',
  }),
  enemy_sewer_brawler: fig({
    group: 'people', mood: 'angry', moodI: 0.8, facial: 'stubble',
    figure: { cut: 'tank', top: rgb('#4a5660'), legs: rgb('#5a4a36'), shoes: rgb('#2e2620'), skin: rgb('#a88a76'), hair: rgb('#2a2420'), hair_style: 2, build: 'dadbod', weight: 0.8, fabric_top: 'rag', fabric_legs: 'canvas' },
    note: 'Shaved at the sides, a grey vest and arms like pipe lagging.',
  }),
  enemy_pipe_spitter: fig({
    group: 'mutant', fam: 'wet', mood: 'neutral',
    figure: { cut: 'baselayer', top: rgb('#3a3c36'), legs: rgb('#2e302a'), shoes: rgb('#1e201c'), skin: rgb('#8a8c84'), hair: rgb('#8a8c84'), hair_style: 0, build: 'hunched', weight: 0.0, fabric_top: 'rubber' },
    gear: (M) => goggles(M, false),
    note: 'Thin and grey, a rubber mask and a hose run into its chest.',
  }),
  enemy_tunnel_crawler: fig({
    group: 'mutant', fam: 'pale', mood: 'angry',
    figure: { cut: 'tee', top: rgb('#4a4238'), legs: rgb('#3a342c'), shoes: rgb('#2a2620'), skin: rgb('#9a8a78'), hair: rgb('#9a8a78'), hair_style: 0, build: 'hunched', weight: 0.0, fabric_top: 'rag' },
    note: 'All fours, arms too long, the face wrapped in rag.',
  }),
  enemy_sewer_shambler: fig({
    group: 'mutant', fam: 'under', mood: 'neutral', height: 2.0,
    figure: { cut: 'tee', top: rgb('#8a8478'), legs: rgb('#3a3a36'), shoes: rgb('#2a2620'), skin: rgb('#9a9080'), hair: rgb('#4a4440'), hair_style: 0, build: 'dadbod', weight: 0.7, fabric_top: 'rag' },
    gear: (M) => lumps(M, [['chest', [0.14, 1.42, 0.02], [0.08, 0.06, 0.07]], ['uarmL', [0.2, 1.36, 0.02], [0.06, 0.05, 0.06]]], '#c8742a', { lump: 0.35, seed: 4 }),
    note: 'A big man gone soft, orange fungus out of one shoulder.',
  }),
  enemy_spore_carrier: fig({
    group: 'mutant', fam: 'under', mood: 'neutral', hat: 'beanie',
    figure: { cut: 'duster', top: rgb('#4a4632'), legs: rgb('#3a3628'), shoes: rgb('#2a2620'), skin: rgb('#5a5e54'), hair: rgb('#2a2620'), hair_style: 0, weight: 0.2, fabric_top: 'canvas' },
    gear: (M) => { held(M, -1, [[0, 0.3, 0], [0, -0.9, 0.1]], 0.018, '#4a3a2a', { ring: 8 }); lumps(M, [['chest', [0.12, 1.5, -0.08], [0.07, 0.05, 0.07]], ['chest', [-0.1, 1.52, -0.1], [0.06, 0.05, 0.06]]], '#c89a5a', { lump: 0.3, seed: 7 }); },
    note: 'Hooded, leaning on a staff, mushrooms up its back and shoulders.',
  }),
  enemy_deadhead_mutant: fig({
    group: 'mutant', fam: 'under', mood: 'neutral', height: 2.35,
    figure: { cut: 'tank', top: rgb('#3e3a32'), legs: rgb('#302c26'), shoes: rgb('#221e1a'), skin: rgb('#9a8c7c'), hair: rgb('#9a8c7c'), hair_style: 0, build: 'dadbod', weight: 0.9, fabric_top: 'rag',
      mutations: ['mut_dermal_thickening'], mut_accent: rgb('#7a6e5e') },
    gear: (M) => lumps(M, [['head', [0, 1.65, 0.03], [0.115, 0.1, 0.11]], ['head', [0.04, 1.63, 0.075], [0.06, 0.04, 0.045]], ['head', [-0.04, 1.63, 0.075], [0.06, 0.04, 0.045]]], '#b0a490', { lump: 0.2, seed: 9 }),
    note: 'Huge and slack-faced, the skull grown thick over where the eyes were.',
  }),
  enemy_grease_ghoul: fig({
    group: 'mutant', fam: 'wet', clip: 'guard', mood: 'angry',
    figure: { cut: 'coverall', top: rgb('#2a2218'), legs: rgb('#2a2218'), shoes: rgb('#1a1610'), skin: rgb('#3c3226'), hair: rgb('#1a1610'), hair_style: 0, weight: 0.2, fabric_top: 'rubber' },
    gear: (M) => lumps(M, [
      ['chest', [0.06, 1.34, 0.1], [0.11, 0.09, 0.06]], ['chest', [-0.1, 1.28, -0.06], [0.1, 0.12, 0.08]], ['uarmL', [0.22, 1.3, 0.02], [0.06, 0.09, 0.06]], ['farmR', [-0.2, 0.98, 0.02], [0.05, 0.08, 0.05]],
      ['head', [0.03, 1.7, -0.02], [0.09, 0.06, 0.09]], ['thighL', [0.1, 0.75, 0.04], [0.07, 0.1, 0.06]], ['spine', [-0.05, 1.05, 0.1], [0.08, 0.07, 0.05]],
    ], (i) => (i % 2 ? '#2a2216' : '#3a2e1c'), { mat: GLOSS, lump: 0.35 }),
    note: 'Fat from the western mains over all of it, glossy and impossible to hold.',
  }),
  enemy_lime_walker: fig({
    group: 'mutant', fam: 'under', mood: 'neutral',
    figure: { cut: 'coverall', top: rgb('#6a665c'), legs: rgb('#6a665c'), shoes: rgb('#4a4640'), skin: rgb('#a8a49a'), hair_style: 0, weight: 0.4 },
    gear: (M) => {
      const L = (i) => ['#c8c4b8', '#b4b0a4', '#d0ccc0'][i % 3];
      lumps(M, [['head', [0, 1.66, 0.0], [0.12, 0.11, 0.12]], ['chest', [0, 1.33, 0.07], [0.19, 0.15, 0.09]], ['chest', [0, 1.3, -0.07], [0.19, 0.16, 0.09]], ['spine', [0, 1.08, 0], [0.16, 0.08, 0.13]],
        ['uarmL', [0.21, 1.32, 0], [0.08, 0.1, 0.08]], ['uarmR', [-0.21, 1.32, 0], [0.08, 0.1, 0.08]], ['farmL', [0.2, 1.0, 0], [0.06, 0.12, 0.06]], ['farmR', [-0.2, 1.0, 0], [0.06, 0.12, 0.06]],
        ['thighL', [0.1, 0.72, 0], [0.1, 0.17, 0.1]], ['thighR', [-0.1, 0.72, 0], [0.1, 0.17, 0.1]], ['shinL', [0.095, 0.3, 0.01], [0.07, 0.17, 0.08]], ['shinR', [-0.095, 0.3, 0.01], [0.07, 0.17, 0.08]]], L, { lump: 0.22, freq: 3.2 });
      on(M, 'head'); glow(M, [0.03, 1.62, 0.115], [0.012, 0.007, 0.005], '#e0b040', { halo: 0.5, light: 0.2 });
    },
    note: 'A shell of grey lime grown over it joint by joint; one eye showing.',
  }),
  enemy_rebar_shambler: fig({
    group: 'mutant', fam: 'under', mood: 'neutral', height: 2.0,
    figure: { cut: 'tank', top: rgb('#6a6660'), legs: rgb('#5a5650'), shoes: rgb('#4a4640'), skin: rgb('#8a8680'), hair_style: 0, weight: 0.9 },
    gear: (M) => {
      const conc = (i) => ['#9a968e', '#86827a', '#a8a49a'][i % 3];
      lumps(M, [['head', [0, 1.64, 0.0], [0.13, 0.12, 0.13]], ['chest', [0.05, 1.32, 0.04], [0.22, 0.18, 0.15]], ['spine', [-0.03, 1.06, 0.0], [0.18, 0.12, 0.14]], ['uarmL', [0.24, 1.28, 0], [0.1, 0.14, 0.1]],
        ['uarmR', [-0.24, 1.26, 0], [0.09, 0.15, 0.09]], ['farmL', [0.21, 0.96, 0.01], [0.08, 0.14, 0.08]], ['farmR', [-0.21, 0.96, 0.01], [0.09, 0.14, 0.09]], ['thighL', [0.11, 0.72, 0], [0.12, 0.18, 0.12]],
        ['thighR', [-0.11, 0.72, 0], [0.11, 0.18, 0.11]], ['shinL', [0.1, 0.28, 0.01], [0.09, 0.19, 0.09]], ['shinR', [-0.1, 0.28, 0.01], [0.09, 0.19, 0.09]]], conc, { lump: 0.3, freq: 2 });
      const R = rng(12), rust = '#7a3a1c';
      for (const [bone, c, r] of [['chest', [0, 1.32, 0], 0.2], ['uarmL', [0.24, 1.28, 0], 0.1], ['farmR', [-0.21, 0.96, 0], 0.09], ['thighL', [0.11, 0.72, 0], 0.12], ['spine', [0, 1.06, 0], 0.17]]) {
        on(M, bone);
        for (let i = 0; i < 3; i++) { const a = R() * Math.PI * 2, d = [Math.cos(a), (R() - 0.5) * 0.8, Math.sin(a)], base = madd(c, d, r * 0.6); tube(M, [base, madd(base, d, 0.1 + 0.12 * R()), add(madd(base, d, 0.18 + 0.1 * R()), [0, -0.04, 0])], [0.008, 0.008, 0.007], { ring: 6, col: rust, mat: SATIN }); }
      }
    },
    note: 'Collapsed tunnel that got up: concrete, and rebar out of it rusted all the way in.',
  }),
  enemy_slag_wight: fig({
    group: 'mutant', fam: 'burn', mood: 'neutral', hat: 'hardhat',
    figure: { cut: 'coverall', top: rgb('#4a5058'), legs: rgb('#4a5058'), shoes: rgb('#2a2622'), skin: rgb('#2c2826'), hair_style: 0, weight: 0.1, fabric_top: 'rag',
      mutations: ['mut_regenerative_scarring'], mut_accent: rgb('#ff7a2a') },
    gear: (M) => {
      glowEyes(M, '#ffb050');
      seams(M, 'chest', [0, 0, 0], 1.18, 1.42, 0.125, 7, '#ff8a30', 2);
      seams(M, 'farmL', [0.197, 0, 0], 0.88, 1.08, 0.04, 3, '#ff8a30', 5);
      seams(M, 'farmR', [-0.197, 0, 0], 0.88, 1.08, 0.04, 3, '#ff8a30', 6);
      seams(M, 'head', [0, 0, 0.01], 1.55, 1.6, 0.085, 3, '#ff8a30', 7);
    },
    note: 'Fused slag in old coveralls and a hard hat, the heat showing through the cracks.',
  }),
  enemy_slag_wretch: fig({
    group: 'mutant', fam: 'burn', mood: 'angry', moodI: 0.5,
    figure: { cut: 'vest', top: rgb('#c4d82a'), shirt: rgb('#4a4640'), legs: rgb('#3a3632'), shoes: rgb('#2a2622'), skin: rgb('#4c4844'), hair_style: 0, weight: 0.2, fabric_top: 'rag',
      mutations: ['mut_dermal_thickening', 'mut_wb_thermal_vision'], mut_accent: rgb('#e0802a') },
    gear: (M) => {
      glowEyes(M, '#e8a040', 0.012);
      for (const sd of [1, -1]) plate(M, 'chest', [sd * 0.085, 1.25, 0.122], [0.012, 0.13, 0.004], '#d8dcd8', { n: [0, 0, 1], mat: GLOSS });
    },
    note: 'Skin like slag and eyes like cooling glass, still in the hi-vis vest.',
  }),
  enemy_cinder_saint: fig({
    group: 'mutant', fam: 'burn', mood: 'neutral', clip: 'idleBehind', key: { wear: { top: false, legs: false, shoes: false } },
    figure: { skin: rgb('#1c1816'), hair_style: 0, weight: 0.2, mutations: ['mut_regenerative_scarring'], mut_accent: rgb('#ff6a20') },
    gear: (M) => {
      on(M, 'chest');
      glow(M, [0, 1.27, 0.098], [0.075, 0.09, 0.02], '#ffb050', { pulse: true, halo: 1.0, haloR: 3.2, light: 0.9, lightK: 1.4 });
      blob(M, [0, 1.27, 0.09], [0.095, 0.11, 0.025], { col: '#0e0c0c', mat: SATIN, nu: 14, nv: 8 });
      glowEyes(M, '#ffd070', 0.012);
      on(M, 'head'); glow(M, [0, 1.555, 0.085], [0.03, 0.006, 0.01], '#ff9040', { halo: 0.4, light: 0 });
      for (const [b, ax, y0, y1, r, s] of [['chest', [0, 0, 0], 1.12, 1.42, 0.14, 1], ['spine', [0, 0, 0], 0.95, 1.12, 0.125, 2], ['uarmL', [0.197, 0, 0], 1.12, 1.36, 0.045, 3], ['uarmR', [-0.197, 0, 0], 1.12, 1.36, 0.045, 4], ['thighL', [0.095, 0, 0], 0.55, 0.88, 0.07, 5], ['thighR', [-0.095, 0, 0], 0.55, 0.88, 0.07, 6], ['farmL', [0.197, 0, 0], 0.88, 1.08, 0.036, 7], ['shinR', [-0.095, 0, 0], 0.15, 0.45, 0.045, 8]]) seams(M, b, ax, y0, y1, r, 5, '#ff7a28', s);
    },
    note: 'Man-shaped and lit from inside like a stove with the door open.',
  }),
  enemy_tinnitus_saint: fig({
    group: 'mutant', mood: 'neutral', clip: 'spread', height: 2.1,
    figure: { cut: 'robe', top: rgb('#4a4440'), shirt: rgb('#3a3632'), legs: rgb('#2a2622'), shoes: rgb('#1a1816'), skin: rgb('#8a7a6e'), hair_style: 0, weight: 0.05, fabric_top: 'rag' },
    gear: (M) => {
      // a face of dead speaker cones
      on(M, 'head');
      const R = rng(21);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2, rr = i ? 0.05 : 0, c = [Math.cos(a) * rr, 1.62 + Math.sin(a) * rr * 1.1, 0.09 + (i ? 0 : 0.012)], d = norm([c[0] * 2, (c[1] - 1.62) * 2, 1]), r = i ? 0.026 + 0.01 * R() : 0.036;
        tube(M, [madd(c, d, -0.02), madd(c, d, 0.01)], [r * 0.4, r], { ring: 14, seg: 2, col: '#2a2826', mat: SATIN, cap: false, up: [0, 1, 0] });
        blob(M, madd(c, d, -0.012), [r * 0.38, r * 0.38, r * 0.22], { axes: [norm(cross([0, 1, 0], d)), norm(cross(d, norm(cross([0, 1, 0], d)))), d], col: '#5a5450', mat: SATIN, nu: 10, nv: 6 });
        loop(M, (s) => { const ax = norm(cross([0, 1, 0], d)), ay = cross(d, ax), b = s * Math.PI * 2; return add(madd(c, d, 0.01), add(mul(ax, Math.cos(b) * r), mul(ay, Math.sin(b) * r))); }, 0.004, { col: '#141210', ring: 5, n: 14 });
        glow(M, madd(c, d, -0.006), r * 0.25, '#ff3fa4', { pulse: true, halo: 0.45, haloR: 3, light: i === 0 ? 0.5 : 0 });
      }
      // wound in frayed speaker wire
      for (const [bone, cx, y0, y1, r, s] of [['chest', 0, 1.1, 1.42, 0.16, 0], ['uarmL', 0.197, 1.12, 1.38, 0.06, 1], ['uarmR', -0.197, 1.12, 1.38, 0.06, 2], ['farmL', 0.197, 0.88, 1.08, 0.05, 3], ['farmR', -0.197, 0.88, 1.08, 0.05, 4]]) {
        on(M, bone);
        const n = 26, pts = Array.from({ length: n }, (_, i) => { const k = i / (n - 1), a = k * Math.PI * 2 * 3.5 + s; return [cx + Math.cos(a) * r, y0 + (y1 - y0) * k, Math.sin(a) * r * 0.85]; });
        tube(M, pts, pts.map(() => 0.0045), { ring: 5, seg: 2, col: s % 2 ? '#8a2a20' : '#1a1a1a', mat: GLOSS });
      }
    },
    note: 'A robe wound in frayed speaker wire, a cluster of dead cones for a face, conducting.',
  }),
  enemy_bramble_whistler: fig({
    group: 'mutant', mood: 'neutral', clip: 'stare', height: 2.05, stretch: { legs: 1.12, arms: 1.18 }, key: { wear: { top: false, legs: false, shoes: false } },
    figure: { skin: rgb('#7a6450'), hair_style: 0, weight: 0, mutations: ['mut_thornhide', 'mut_dermal_thickening'], mut_accent: rgb('#4a3a28') },
    gear: (M) => {
      const th = '#5a4630';
      thorns(M, 'chest', 0, 1.15, 1.42, 0.14, 14, 0.04, th, 1);
      thorns(M, 'spine', 0, 0.95, 1.12, 0.12, 8, 0.035, th, 2);
      for (const sd of [1, -1]) { thorns(M, 'uarm' + LR(sd), sd * 0.197, 1.12, 1.36, 0.045, 6, 0.03, th, 3 + sd); thorns(M, 'thigh' + LR(sd), sd * 0.095, 0.55, 0.88, 0.07, 7, 0.035, th, 5 + sd); thorns(M, 'shin' + LR(sd), sd * 0.095, 0.15, 0.45, 0.045, 5, 0.03, th, 7 + sd); }
      on(M, 'neck'); blob(M, [0, 1.47, 0.04], [0.06, 0.05, 0.06], { col: '#8a7058', lump: 0.15, nu: 14, nv: 8 });
      for (let i = 0; i < 4; i++) loop(M, (s) => { const a = s * Math.PI * 2; return [Math.cos(a) * 0.062, 1.44 + i * 0.016, 0.04 + Math.sin(a) * 0.062]; }, 0.004, { col: '#5a4434', ring: 5 });
    },
    note: 'Long-limbed and hairless under a crust of thorn-scab, its throat a bellows.',
  }),
  enemy_bracken_hulk: fig({
    group: 'mutant', mood: 'neutral', height: 2.3, key: { wear: { top: false, legs: false, shoes: false } },
    figure: { skin: rgb('#5a4a3a'), hair_style: 0, build: 'dadbod', weight: 1, mutations: ['mut_thornhide', 'mut_wb_bio_armor'], mut_accent: rgb('#3a2c20') },
    gear: (M) => {
      const wood = (i) => ['#5a4028', '#4a3420', '#6a4a2e'][i % 3], R = rng(31);
      // thornwood grown round every limb, and cable through it
      for (const [bone, cx, y0, y1, r, s] of [['chest', 0, 1.08, 1.45, 0.19, 0], ['uarmL', 0.2, 1.1, 1.4, 0.07, 1], ['uarmR', -0.2, 1.1, 1.4, 0.07, 2], ['farmL', 0.2, 0.86, 1.1, 0.06, 3], ['farmR', -0.2, 0.86, 1.1, 0.06, 4], ['thighL', 0.1, 0.5, 0.9, 0.1, 5], ['thighR', -0.1, 0.5, 0.9, 0.1, 6], ['shinL', 0.095, 0.08, 0.5, 0.07, 7], ['shinR', -0.095, 0.08, 0.5, 0.07, 8]]) {
        on(M, bone);
        for (let w = 0; w < 3; w++) {
          const n = 14, ph = R() * 6, turns = 0.6 + R() * 0.8, pts = Array.from({ length: n }, (_, i) => { const k = i / (n - 1), a = ph + k * Math.PI * 2 * turns; return [cx + Math.cos(a) * r, y0 + (y1 - y0) * k, Math.sin(a) * r]; });
          tube(M, pts, pts.map((_, i) => (w === 2 ? 0.008 : 0.022 - i * 0.0006)), { ring: 7, seg: 2, col: w === 2 ? '#141414' : wood(w + s), mat: w === 2 ? GLOSS : MAT.MATTE });
        }
        thorns(M, bone, cx, y0, y1, r + 0.01, 5, 0.05, '#3a2a1a', s + 40);
      }
      on(M, 'chest');
      for (const sd of [1, -1]) tube(M, [[sd * 0.18, 1.42, -0.05], [sd * 0.28, 1.62, -0.1], [sd * 0.34, 1.82, -0.06], [sd * 0.42, 1.9, -0.1]], [0.03, 0.022, 0.012, 0.004], { ring: 8, col: '#4a3420' });
    },
    note: 'A knot of thornwood, cable and somebody, grown together.',
  }),
  enemy_under_sunless: fig({
    group: 'mutant', fam: 'pale', mood: 'neutral', clip: 'stare', height: 2.4, stretch: { legs: 1.18, arms: 1.3 }, key: { wear: { top: false, legs: false, shoes: false } },
    figure: { skin: rgb('#dcd6c8'), hair_style: 0, weight: 0, mutations: ['mut_translucent_veins', 'mut_nictitating_membrane'], mut_accent: rgb('#a8a090') },
    gear: (M) => {
      const R = rng(41), root = '#c8c0ae';
      // roots off the fingers and the feet, trailing on the floor
      for (const sd of [1, -1]) {
        on(M, 'hand' + LR(sd));
        for (let i = 0; i < 4; i++) { const b = add(PALM(sd), [sd * 0.005, -0.06, (i - 1.5) * 0.015]); tube(M, [b, add(b, [sd * 0.02, -0.15, 0.02 * (i - 1.5)]), add(b, [sd * (0.05 + 0.04 * R()), -0.3 - 0.1 * R(), 0.05 * (i - 1.5)])], [0.006, 0.004, 0.001], { ring: 5, col: root }); }
        on(M, 'foot' + LR(sd));
        for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2, b = [sd * 0.095 + Math.cos(a) * 0.04, 0.03, Math.sin(a) * 0.05 + 0.03], d = [Math.cos(a), 0, Math.sin(a)]; tube(M, [b, add(madd(b, d, 0.12), [0, -0.025, 0]), add(madd(b, d, 0.28 + 0.1 * R()), [0, -0.028, 0])], [0.012, 0.007, 0.002], { ring: 6, col: root }); }
      }
      for (const [bone, cx, y0, y1, r] of [['chest', 0, 1.1, 1.42, 0.15], ['thighL', 0.095, 0.55, 0.9, 0.075], ['thighR', -0.095, 0.55, 0.9, 0.075]]) {
        on(M, bone);
        for (let w = 0; w < 3; w++) { const n = 10, ph = R() * 6, pts = Array.from({ length: n }, (_, i) => { const k = i / (n - 1), a = ph + k * 2.4; return [cx + Math.cos(a) * r, y1 - (y1 - y0) * k, Math.sin(a) * r]; }); tube(M, pts, pts.map(() => 0.008), { ring: 5, seg: 2, col: root }); }
      }
      on(M, 'chest');
      for (let i = 0; i < 9; i++) { const a = i * 2.4, y = 1.0 + 0.6 * R(); glow(M, [Math.cos(a) * (0.25 + 0.15 * R()), y, Math.sin(a) * (0.2 + 0.15 * R())], 0.006 + 0.004 * R(), '#d8f06a', { pulse: true, halo: 0.5, haloR: 4, light: 0 }); }
    },
    note: 'Pale as a root and the shape of a person who kept going.',
  }),

  // ── the Thornwarren road
  enemy_thorn_cull: fig({
    group: 'thorn', mood: 'neutral', clip: 'stare', height: 2.0, stretch: { legs: 1.12 }, key: { wear: { top: false, legs: false, shoes: false } },
    figure: { skin: rgb('#4a2e26'), hair_style: 0, build: 'hunched', weight: 0, mutations: ['mut_wb_bio_armor', 'mut_bone_spurs'], mut_accent: rgb('#2a1a16') },
    gear: (M, t) => {
      on(M, 'head');
      const R = rng(51), hostile = Math.floor((t || 0) / 3) % 2 === 1;
      for (let i = 0; i < 11; i++) {
        const a = -0.4 + R() * 3.9, y = 1.57 + R() * 0.13, p = [Math.cos(a) * 0.085 * (0.9 + 0.1 * R()), y, Math.sin(a) * 0.1 + 0.01];
        eye(M, p, 0.011 + 0.008 * R(), norm(add([p[0], (y - 1.61) * 2, p[2]], [(R() - 0.5), (R() - 0.5) * 0.6, 0.3])), { iris: hostile ? '#ff3b30' : '#3fa9ff', white: '#e8dcc0', pupilR: 0.3, glow: true });
      }
    },
    note: 'Lean, plated, and too many eyes, none of them looking the same way.',
  }),
  enemy_thorn_harrow: {
    group: 'thorn', note: 'The spine too long and carried low on four points; the trophy wire in its hand.',
    build: (M, t, o) => quadruped(M, {
      seed: 61, len: 1.15, legLen: 1.25, legW: 1.25, bodyW: 1.05, chestD: 0.85, waist: 0.75, arch: 1.3, slope: 0.08, haunch: 1.2, neckLen: 1.4, neckW: 0.85, neckRise: 0.15, headPitch: 0.15,
      hairless: true, skin: '#4a3028', mange: 0, ribs: 0.9, hackles: 0, shag: 0, stance: 1.6, spots: [14, '#2a1a14'],
      head: { ears: 'none', muzzle: 0.07, skull: 0.16, skullW: 1.1, muzzleW: 1.2, stop: 0.4, gape: 0.25, col: '#4a3028', cheek: '#3a2420', tan: false, iris: '#e0c060', eyeR: 0.012, tufts: 0, nose: null },
      tail: { len: 0.3, r: 0.03, lift: -0.2, curl: 0.05, col: '#4a3028', kind: 'rat' },
      extra: (M2, { body, head }) => {
        // plates down the long spine, and a bone mask
        for (let i = 0; i < 9; i++) { const f = body.at(0.12 + i * 0.09, Math.PI / 2); blob(M2, madd(f.p, f.n, -0.01), [0.07, 0.025, 0.06], { axes: [f.X, f.n, f.T], e1: 0.5, e2: 0.6, col: '#3a2620', mat: SATIN, nu: 12, nv: 6, form: f.n }); }
        const s = head.skull.at(0.55, Math.PI / 2);
        blob(M2, madd(s.p, s.n, 0.004), [0.07, 0.03, 0.09], { axes: [s.X, s.n, s.T], e1: 0.6, col: '#d8ccb0', mat: SATIN, nu: 14, nv: 8 });
        // the wire, coiled, with a skull on it
        const c = add(head.nose, [0, -0.18, 0.02]);
        loop(M2, (u) => { const a = u * Math.PI * 2; return add(c, [Math.cos(a) * 0.1, Math.sin(a * 3) * 0.01, Math.sin(a) * 0.06]); }, 0.004, { col: '#8a8a8a', ring: 5, n: 30, mat: MAT.METAL });
        tube(M2, [head.nose, add(c, [0.05, 0.05, 0])], [0.004, 0.004], { ring: 5, col: '#8a8a8a', mat: MAT.METAL });
        blob(M2, add(c, [0, -0.06, 0]), [0.05, 0.055, 0.06], { col: '#d8ccb0', nu: 12, nv: 8 });
        for (const sd of [1, -1]) blob(M2, add(c, [sd * 0.02, -0.055, 0.05]), [0.013, 0.013, 0.008], { col: '#1a1410', nu: 8, nv: 5 });
      },
    }, t, o),
  },
  enemy_thorn_warden: fig({
    group: 'thorn', mood: 'neutral', clip: 'stare', height: 3.35, stretch: { arms: 1.3 }, key: { wear: { top: false, legs: false, shoes: false } },
    figure: { skin: rgb('#3a2a22'), hair_style: 0, weight: 0.6, mutations: ['mut_wb_bio_armor', 'mut_bone_spurs'], mut_accent: rgb('#2a1c16') },
    gear: (M) => {
      const P = '#2e2018', bone = '#d8ccb0';
      // the mask, the jaw wired open
      on(M, 'head');
      blob(M, [0, 1.64, 0.07], [0.09, 0.1, 0.06], { e1: 0.7, col: bone, mat: SATIN, nu: 18, nv: 10 });
      for (const sd of [1, -1]) { blob(M, [sd * 0.035, EYE_Y + 0.005, 0.12], [0.02, 0.016, 0.01], { col: '#120c0a', nu: 10, nv: 5 }); glow(M, [sd * 0.035, EYE_Y + 0.005, 0.127], 0.006, '#ff3b30', { halo: 0.5, haloR: 4, light: 0.2 }); }
      blob(M, [0, 1.5, 0.1], [0.07, 0.02, 0.05], { e1: 0.6, col: bone, mat: SATIN, nu: 14, nv: 6, axes: [[1, 0, 0], norm([0, 1, 0.4]), norm([0, -0.4, 1])] });
      for (const sd of [1, -1]) tube(M, [[sd * 0.06, 1.56, 0.1], [sd * 0.065, 1.53, 0.11], [sd * 0.06, 1.5, 0.1]], [0.003, 0.003, 0.003], { ring: 4, col: '#8a8a8a', mat: METAL });
      for (let i = 0; i < 7; i++) spike(M, [(i - 3) * 0.012, 1.52, 0.12], [(i - 3) * 0.012, 1.5, 0.13], 0.004, { col: '#e8dcc0', ring: 4 });
      // grained plates, and a second set of shoulders
      cuirass(M, P, { k: 1.05 });
      limbGuards(M, P);
      for (const sd of [1, -1]) {
        on(M, 'uarm' + LR(sd)); blob(M, [sd * 0.21, 1.27, -0.01], [0.06, 0.06, 0.06], { col: P, mat: SATIN, nu: 12, nv: 8 });
        on(M, 'chest'); blob(M, [sd * 0.17, 1.44, -0.03], [0.07, 0.06, 0.07], { col: P, mat: SATIN, nu: 12, nv: 8, lump: 0.1 });
      }
    },
    note: 'Eleven feet, masked in bone with the jaw wired open, arms past the knee.',
  }),

  // ── four legs
  enemy_gutter_hound: { group: 'four', build: (M, t, o) => quadruped(M, houndLook(), t, o), note: 'The model the Room Stage draws a gutter hound from now, in the colours of its fauna row.' },
  enemy_feral_dog: {
    group: 'four', fam: 'municipal', note: 'Forty pounds of somebody\'s sandy old pet with a white blaze and socks, ribs showing, still in the red collar.',
    build: (M, t, o) => quadruped(M, {
      seed: 72, scale: 0.78, len: 0.6, chestD: 0.95, waist: 0.9, neckRise: 0.6, headPitch: 0.22, ribs: 0.4, scars: 1, mange: 0.2, hackles: 0.5, shag: 0.5,
      coat: '#b8864e', back: '#7a5430', belly: '#f0e4cc', patch: '#f4ece0', legs: '#f0e4cc', paws: '#e8dcc4', collar: '#d82a2a',
      head: { face: 'dog', gape: 0.12, iris: '#6a4a20', ears: 'drop', earLen: 0.1, earW: 1.3, col: '#6a4a30', cheek: '#b08a60', brow: 0.6, muzzle: 0.13, inner: '#8a5a48', blaze: '#efe4d0' },
      tail: { len: 0.4, r: 0.026, lift: 0.5, curl: -0.15, col: '#6a4a30', kind: 'bushy' },
    }, t, o),
  },
  enemy_wire_jackal: {
    group: 'four', fam: 'chitin', note: 'Dog and junkyard: a steel-grey hide wound in copper wire that takes the light, scabs in it, copper whiskers.',
    build: (M, t, o) => quadruped(M, {
      seed: 81, scale: 0.85, len: 0.62, legLen: 1.18, legW: 0.85, waist: 0.72, chestD: 0.95, haunch: 0.95, neckRise: 0.5, headPitch: 0.25, ribs: 0.7, scars: 3, mange: 0.4, hackles: 0.7, shag: 0.6,
      coat: '#8a8a80', back: '#4a4a46', belly: '#b8b4a4', legs: '#5a5a54', spots: [18, '#6a2a22'],
      head: { face: 'dog', gape: 0.2, iris: '#e0b040', ears: 'prick', earLen: 0.15, col: '#5a4838', cheek: '#9a7a58', muzzle: 0.16, muzzleW: 0.85, whiskers: 4, whiskerCol: '#c87a3a', whiskerMetal: true },
      tail: { len: 0.38, r: 0.03, lift: 0.0, curl: -0.15, col: '#5a4838', kind: 'bushy' },
      extra: (M2, { body, neck }) => {
        // wire wound round the body and the neck, copper and steel
        for (const [part, t0, t1, turns, col] of [[body, 0.25, 0.85, 5, '#b06a30'], [neck, 0.1, 0.8, 3, '#8a8a8a'], [body, 0.3, 0.7, 3, '#8a8a8a']]) {
          const n = 50, pts = Array.from({ length: n }, (_, i) => { const k = i / (n - 1), f = part.at(t0 + (t1 - t0) * k, k * Math.PI * 2 * turns); return madd(f.p, f.n, 0.004); });
          tube(M2, pts, pts.map(() => 0.0035), { ring: 4, seg: 1, col, mat: MAT.METAL });
        }
      },
    }, t, o),
  },
  enemy_gutter_cat: {
    group: 'four', fam: 'street', note: 'A ragged old tom with one ear chewed to a stub.',
    build: (M, t, o) => catFur(M, quadruped(M, CAT, t, o)),
  },
  // Cathode, the Dray Lane stray (docs/systems-strays.md), on the same cat: a Bengal's coat, rosettes on gold with a
  // cream belly and muzzle, lighter and rangier than the tom, calm where he scowls, most of one ear gone, and her right
  // foreleg machined steel from the wrist down, with amber light at the join
  npc_stray_cathode: {
    group: 'four', fam: 'street', note: 'Cathode, the stray: a Bengal, her right forepaw machined steel from the wrist, an amber seam where it joins.',
    build: (M, t, o) => catFur(M, quadruped(M, {
      ...CAT,
      seed: 17, scale: 0.4, bloat: 0.35, waist: 1.05, haunch: 1.55, arm: 1.6, scars: 1,
      coat: '#c48a48', back: '#9a6430', belly: '#f2e4c8', legs: '#b07a42', paws: '#b07a42', stripes: null, spots: [24, '#3a2214'],
      legOverride: { RF: steelPaw },
      pads: '#6e3e3a',
      fur: { ...CAT.fur, budget: 19000 },
      head: { ...CAT.head, col: '#c08a4a', cheek: '#f4e8d0', tabby: '#3a2214', iris: '#86c43a', gape: 0, scowl: 0.12, brow: 0.35, nose: '#c87c70' },
      tail: { ...CAT.tail, col: '#b07a42', rings: [9, '#3a2214'] },
    }, t, o)),
  },
  enemy_sewer_rat: {
    group: 'four', fam: 'wet', note: 'A rat the size of a terrier, fat, greasy, eyes filmed pale.',
    build: (M, t, o) => quadruped(M, {
      foot: 'rodent', toeLen: 1.6, pawK: 0.72, pads: '#c09088',
      seed: 101, scale: 0.55, len: 0.6, legLen: 0.48, legW: 0.85, chestD: 0.95, bloat: 0.7, rump: 1.25, arch: 1.2, neckLen: 0.45, neckRise: 0.3, headPitch: 0.2, shag: 0.35, hackles: 0.3, mange: 0.25,
      coat: '#4a4236', back: '#2e2a24', belly: '#6a6050', legs: '#8a6a60', paws: '#b08a80', claws: '#d8c8b8',
      head: { skull: 0.12, muzzle: 0.15, muzzleW: 0.6, skullW: 0.85, stop: 0.2, gape: 0.1, ears: 'round', earLen: 0.07, iris: '#c8d0d0', pupil: '#8a9090', col: '#4a4236', cheek: '#4a4236', tan: false, nose: '#b07a74', whiskers: 5, brow: 0.2, tufts: 0.3 },
      tail: { len: 0.75, r: 0.024, lift: -0.3, curl: 0.07, col: '#a07a70', kind: 'rat', rings: [30, '#8a6660'] },
    }, t, o),
  },
  enemy_slag_rat: {
    group: 'four', fam: 'burn', note: 'Hairless and slick, the grey of cooled slag.',
    build: (M, t, o) => quadruped(M, {
      foot: 'rodent', toeLen: 1.6, pawK: 0.72, pads: '#4a4442',
      seed: 111, scale: 0.42, len: 0.6, legLen: 0.5, legW: 0.85, chestD: 0.9, bloat: 0.3, rump: 1.15, arch: 1.1, neckLen: 0.45, neckRise: 0.3, headPitch: 0.15,
      hairless: true, skin: '#6a6866', hackles: 0, shag: 0, legs: '#5a5856', paws: '#6a6260', claws: '#2a2826', spots: [9, '#4a4846'],
      head: { skull: 0.12, muzzle: 0.15, muzzleW: 0.6, skullW: 0.85, stop: 0.2, gape: 0.15, ears: 'round', earLen: 0.06, iris: '#8a2a20', col: '#6a6866', cheek: '#6a6866', tan: false, nose: '#4a4442', whiskers: 3, whiskerCol: '#3a3836', brow: 0.2, tufts: 0 },
      tail: { len: 0.6, r: 0.022, lift: -0.3, curl: 0.07, col: '#5a5856', kind: 'rat' },
    }, t, o),
  },
  enemy_rust_bull: {
    group: 'four', fam: 'chitin', note: 'Half a ton of slate hide, a hump of muscle and horns gone to rusted metal.',
    build: (M, t, o) => quadruped(M, {
      seed: 121, scale: 2.2, len: 0.66, legLen: 0.82, legW: 1.55, bodyW: 1.45, chestD: 1.25, chestW: 1.15, waist: 1.15, rump: 1.15, haunch: 1.05, arch: 0.1, neckLen: 0.55, neckW: 1.7, neckRise: 0.25, headPitch: 0.65, hump: 0.07,
      hairless: true, skin: '#46443f', spots: [7, '#6a3a1e'], hackles: 0, shag: 0, hoof: true, legs: '#4a4844', breathe: 1.2,
      head: { skull: 0.15, muzzle: 0.1, skullW: 1.25, muzzleW: 1.55, stop: 0.6, gape: 0.0, ears: 'drop', earLen: 0.06, earW: 1.2, iris: '#3a1a10', eyeR: 0.011, col: '#5c5a56', cheek: '#4a4844', tan: true, nose: '#2a2624', brow: 1.2, tufts: 0 },
      horns: { len: 0.17, r: 0.022, col: '#6a4a36', tip: '#c87a3a', fwd: 0.6, metal: true },
      tail: { len: 0.4, r: 0.012, lift: -0.9, curl: 0.0, col: '#4a4844', kind: 'tuft' },
    }, t, o),
  },

  // ── crawlers
  // Spiders, roaches and grubs as their own animals: a spider is a cephalothorax and an abdomen on a pedicel with
  // eight legs off the front half, chelicerae and palps and an eye cluster; a roach is flat under a pronotum with a
  // pale rim, its legs spined down the tibia; a harvestman is a pea on stilts with an eye turret.
  enemy_sewer_roach: {
    group: 'crawl', fam: 'wet', note: 'An American roach a forearm long: chestnut gloss with an oil sheen, the pale-rimmed shield over its head, spined legs and whip antennae.',
    build: (M, t) => arthropod(M, {
      seed: 131, len: 0.44, width: 0.15, height: 0.04, lift: 0.03, abdomen: 0.58, thorax: 0.26, reach: 0.28, knee: 0.022, femurRise: 0.75, legR: 0.0055, hair: 0.4, spines: 4, spineLen: 3.2,
      wings: true, antennae: 0.42, mandibles: 0.012, eyes: 2, eyeCol: '#14100c', plates: 6, plateCol: '#5a2c12', plateEdge: '#2a1206', plateMat: FILM,
      col: '#4a2410', wingCol: '#6a3416', under: '#8a5a32', band: '#2a1206', legCol: '#5a3018', legBand: '#2a140a', legJoint: '#b08050', spineCol: '#1a0c06',
      extra: (M2, { body, D, X, U }) => {
        // the pronotum: a flat shield over the head, chestnut with a cream rim and two dark eyespots
        const f = body.at(0.84, Math.PI / 2);
        blob(M2, add(madd(f.c, U, 0.022), mul(D, 0.012)), [0.068, 0.012, 0.045], { axes: [X, U, D], e1: 0.4, e2: 1, nu: 20, nv: 8, mat: MAT.GLOSS,
          col: (d) => (Math.hypot(d[0], d[2]) > 0.78 ? C('#e8c890') : Math.hypot(d[0] * 1.6 - 0.35, d[2] + 0.1) < 0.28 || Math.hypot(d[0] * 1.6 + 0.35, d[2] + 0.1) < 0.28 ? C('#1a0a04') : C('#7a3a16')) });
        // cerci at the tail
        const tl = body.at(0.02, 0);
        for (const sd of [1, -1]) spike(M2, tl.c, add(tl.c, add(mul(D, -0.05), mul(X, sd * 0.025))), 0.005, { col: '#3a1a0a', ring: 5 });
      },
    }, t),
  },
  enemy_printer_roach: {
    group: 'crawl', fam: 'wet', note: 'Half chitin, half printer: a beige plastic carapace with a paper slot, ribbon cable for a spine, green status lights that light its legs.',
    build: (M, t) => arthropod(M, {
      seed: 141, len: 0.32, width: 0.13, height: 0.045, lift: 0.03, reach: 0.2, knee: 0.04, femurRise: 0.85, legR: 0.0048, spines: 3, wings: false, antennae: 0.3, mandibles: 0.012,
      col: '#3a2416', under: '#6a4a2c', band: '#1a0e08', legCol: '#4a2c18', legBand: '#cfc4a4', legJoint: '#cfc4a4', spineCol: '#1a0e08',
      extra: (M2, { body, D, X, U }, tt) => {
        const f = body.at(0.36, Math.PI / 2), g = body.at(0.7, Math.PI / 2);
        // the carapace is a printer's lid: off-white plastic, a paper slot, a cracked corner
        blob(M2, madd(f.c, U, 0.03), [0.065, 0.022, 0.085], { axes: [X, U, D], e1: 0.3, e2: 0.3, col: (d) => (d[1] > 0.5 && Math.abs(d[2] - 0.1) < 0.06 ? C('#2a2620') : C('#d8cfb2')), mat: MAT.SATIN, nu: 16, nv: 8 });
        blob(M2, madd(g.c, U, 0.022), [0.05, 0.015, 0.03], { axes: [X, U, D], e1: 0.3, e2: 0.3, col: '#c4bb9e', mat: MAT.SATIN, nu: 12, nv: 6 });
        sheet(M2, (u, v) => add(madd(f.c, U, 0.053), add(mul(X, (u - 0.5) * 0.06), add(mul(D, 0.012 + v * 0.03), mul(U, v * 0.02)))), 3, 2, { col: '#f4f0e6' });
        const blink = Math.floor(tt * 2) % 2;
        glow(M2, add(madd(g.c, U, 0.04), mul(X, 0.025)), 0.0055, blink ? '#40ff80' : '#1a8040', { halo: blink ? 0.7 : 0.2, light: 0.18, lightK: blink ? 1 : 0.3 });
        glow(M2, add(madd(g.c, U, 0.04), mul(X, 0.012)), 0.004, '#ffb030', { halo: 0.4, light: 0 });
        // ribbon cable down its back into the head
        const a = madd(f.c, U, 0.05), b = madd(body.at(0.95, Math.PI / 2).c, U, 0.02);
        for (let i = 0; i < 4; i++) tube(M2, [add(a, mul(X, i * 0.006 - 0.009)), add(add(lerp3(a, b, 0.5), mul(U, 0.03)), mul(X, i * 0.006 - 0.009)), add(b, mul(X, i * 0.006 - 0.009))], [0.0028, 0.0028, 0.0028], { ring: 4, col: ['#d84a3a', '#e8e0d0', '#e8e0d0', '#3a6ad8'][i], mat: MAT.SATIN });
      },
    }, t),
  },
  enemy_ash_crawler: {
    group: 'crawl', fam: 'burn', note: 'Ash fused over a raccoon: grey plates with embers in every seam, ten hurrying legs, a ringed tail with its tip still burning.',
    build: (M, t) => arthropod(M, {
      seed: 151, len: 0.64, width: 0.21, height: 0.09, lift: 0.07, abdomen: 0.55, thorax: 0.35, pairs: 5, reach: 0.32, knee: 0.1, legR: 0.0095, spread: 1.15, gloss: false, eyes: 0, antennae: 0, mandibles: 0, spines: 2,
      col: '#5a5652', under: '#7a7670', band: '#ff6a1a', bands: 8, legCol: '#3a3632', legBand: '#ff7a2a', legJoint: '#ffb050', plates: 6, plateCol: '#6a6662', plateEdge: '#ff8a30', plateMat: MAT.MATTE,
      extra: (M2, { body }, tt) => {
        const f = body.at(0.98, 0), D = norm(add(f.T, [0, 0.15, 0])), U = norm(cross(D, f.X));
        mammalHead(M2, madd(f.c, f.T, -0.01), D, U, {
          size: 1.05, skull: 0.12, muzzle: 0.1, muzzleW: 0.9, ears: 'round', earLen: 0.065, gape: 0.32, iris: '#ffb040', eyeGlow: true, col: '#7a766e', cheek: '#e8e2d6', nose: '#141210', inner: '#ff6a2a',
          mask: (u, a) => (u > 0.9 && u < 2.4 && Math.sin(a) > -0.2 && Math.sin(a) < 0.65 ? '#141210' : null), tufts: 0.8, tuftCol: '#9a968e',
        }, tt);
        for (let i = 0; i < 4; i++) { const s = body.at(0.12 + i * 0.12, Math.PI / 2); glow(M2, madd(s.p, s.n, 0.01), 0.008, '#ff7a20', { pulse: true, halo: 0.35, light: 0.25, lightK: 0.6 }); }
        const r0 = body.at(0.02, 0), pts = [r0.c];
        for (let i = 1; i < 6; i++) pts.push(add(pts[i - 1], [Math.sin(tt * 1.5 + i) * 0.015, 0.035 - i * 0.012, -0.07]));
        tube(M2, pts, [0.05, 0.065, 0.065, 0.055, 0.04, 0.012], { ring: 12, col: (u) => (u > 0.9 ? C('#ffb040') : Math.floor(u * 7) % 2 ? C('#1e1c1a') : C('#8a8680')), mat: MAT.MATTE });
        glow(M2, pts[5], 0.018, '#ffb040', { pulse: true, halo: 0.8, light: 0.5 });
      },
    }, t),
  },
  enemy_blind_crawler: {
    group: 'crawl', fam: 'pale', note: 'A grub you can half see through: pale segments with the gut dark inside, light passing through its sides, two amber spade claws.',
    build: (M, t) => arthropod(M, {
      seed: 161, len: 0.95, width: 0.3, height: 0.22, lift: 0.04, abdomen: 0.7, thorax: 0.22, pairs: 3, reach: 0.17, knee: 0.012, femurRise: 0.55, legR: 0.014, gloss: true, eyes: 0, antennae: 0, mandibles: 0.05, spines: 0,
      col: '#e6dccb', under: '#d4c6ae', band: '#b4a48c', bands: 12, legCol: '#d8ccb6', legBand: '#c09050', legJoint: '#f0e8da',
      prof: (u) => { const K = [[0, [0.25, 0.25]], [0.12, [0.75, 0.7]], [0.45, [1, 1]], [0.72, [0.85, 0.95]], [0.9, [0.6, 0.65]], [1, [0.3, 0.3]]]; const [w, h] = keys(K, u); const rib = 1 + 0.08 * Math.max(0, Math.sin(u * 75)) ** 3; return { w: w * 0.3 * rib, h: h * 0.22 * rib, oy: 0.04 * Math.sin(u * Math.PI) }; },
      paint: (u, a) => (Math.abs(a - Math.PI / 2) < 0.22 && u > 0.08 && u < 0.85 ? '#7a6a8e' : null),
      extra: (M2, { body }, tt) => {
        // light through its skin: the far side of every segment glows a cold lavender
        const f = body.at(0.5, Math.PI / 2);
        for (let i = 0; i < 9; i++) { const q = body.at(0.08 + i * 0.09, Math.PI / 2 + (i % 2 ? 0.6 : -0.6)); blob(M2, madd(q.p, q.n, -0.012), [0.05, 0.03, 0.04], { axes: [q.X, q.n, q.T], col: '#f4ecdc', mat: TRANSLUCENT, shade: '#9a8ad8', nu: 10, nv: 6 }); }
        void f;
        for (const sd of [1, -1]) {
          const r = body.at(0.84, sd > 0 ? -0.3 : Math.PI + 0.3).p, el = add(r, [sd * 0.15, 0.07, 0.12]), wr = add(r, [sd * 0.14, -0.05, 0.28]);
          tube(M2, [r, el, wr], [0.04, 0.035, 0.03], { ring: 12, col: '#e0d4c0', mat: TRANSLUCENT, shade: '#9a8ad8' });
          blob(M2, el, [0.034, 0.034, 0.034], { col: '#c09050', nu: 10, nv: 6 });
          blob(M2, add(wr, [0, -0.03, 0.05]), [0.075, 0.016, 0.085], { e1: 0.5, axes: [[1, 0, 0], norm([0, 1, 0.3]), norm([0, -0.3, 1])], col: '#c8903a', mat: MAT.GLOSS, shade: '#5a2a10', nu: 16, nv: 6 });
          for (let k = 0; k < 3; k++) spike(M2, add(wr, [sd * (k - 1) * 0.045, -0.04, 0.12]), add(wr, [sd * (k - 1) * 0.055, -0.08, 0.19]), 0.013, { col: '#7a4a1a', ring: 6, mat: MAT.GLOSS });
        }
      },
    }, t),
  },
  enemy_glass_tick: {
    group: 'crawl', fam: 'pale', note: 'A palm-wide disc of fused silica, the light going through it and splitting, tipped up to show the wet red ring underneath.',
    build: (M, t) => {
      const from = mark(M);
      arthropod(M, {
        seed: 171, len: 0.12, width: 0.062, height: 0.016, lift: 0.024, abdomen: 0.6, thorax: 0.3, pairs: 5, reach: 0.075, knee: 0.016, legR: 0.0018, spread: 1.4, gloss: true, eyes: 0, antennae: 0, mandibles: 0, spines: 1, spineLen: 2,
        col: '#a8d0c8', under: '#7a1a24', band: '#e8fff8', bands: 0, legCol: '#5a1a1e', legBand: '#2a0a0c', legJoint: '#c84a4a',
        prof: (u) => ({ w: 0.062 * Math.sin(Math.PI * Math.min(1, u * 1.02)) ** 0.5 + 0.003, h: 0.016 * Math.sin(Math.PI * u) ** 0.6 + 0.002, e: 2 }),
        paint: (u, a, p) => (Math.sin(a) < -0.2 ? null : fnoise(p, 160) > 0.62 ? '#e8fff8' : null),
        extra: (M2, { body }) => {
          const c = body.at(0.55, -Math.PI / 2).c;
          blob(M2, add(c, [0, 0.004, 0]), [0.03, 0.006, 0.03], { col: '#c81a2a', mat: MAT.GLOSS, shade: '#3a0410', nu: 14, nv: 6 });
          for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, p = add(c, [Math.cos(a) * 0.022, -0.002, Math.sin(a) * 0.022]); spike(M2, p, add(p, [Math.cos(a) * -0.007, -0.008, Math.sin(a) * -0.007]), 0.0022, { col: '#f0d0c8', ring: 4, mat: MAT.GLOSS }); }
        },
      }, t);
      // its body is glass: let the light through and split it (the arthropod's own loft is the first triangles)
      for (let i = from.t; i < triCount(M); i++) if (M.M[i * 3] === MAT.GLOSS && M.C[i * 9 + 1] > 0.3) M.M[i * 3] = M.M[i * 3 + 1] = M.M[i * 3 + 2] = FILM;
    },
  },
  enemy_ferric_strider: {
    group: 'crawl', fam: 'chitin', note: 'A harvestman eight feet tall: a pea of tempered steel, blued and straw-coloured by its own heat, on rust-red stilts with an eye turret on top.',
    build: (M, t) => arthropod(M, {
      seed: 181, len: 0.42, width: 0.2, height: 0.12, lift: 1.62, abdomen: 0.62, thorax: 0.3, pairs: 4, reach: 1.4, knee: 0.78, legR: 0.011, spread: 1.05, metal: true, eyes: 0, antennae: 0, mandibles: 0.02, spines: 0, wrong: true,
      col: '#8a3a1c', under: '#4a1a0c', band: '#2a0c06', bands: 0, legCol: '#8a3418', legBand: '#2a0e08', legJoint: '#e8a050', legTip: '#1a0c08', twitch: 0.25,
      prof: (u) => { const [w, h] = keys([[0, [0.3, 0.3]], [0.2, [0.95, 0.9]], [0.6, [1, 1]], [0.85, [0.8, 0.85]], [1, [0.3, 0.35]]], u); return { w: w * 0.2, h: h * 0.12, e: 2 }; },
      extra: (M2, { body }, tt) => {
        // the temper film over the back (straw, bronze, purple, blue by angle) and the eye turret
        const top = body.at(0.5, Math.PI / 2);
        blob(M2, madd(top.c, top.Y, 0.03), [0.16, 0.07, 0.17], { col: '#a87040', mat: FILM, shade: '#1a0a2a', nu: 22, nv: 12 });
        const tur = madd(top.c, top.Y, 0.115);
        tube(M2, [madd(tur, [0, 1, 0], -0.03), tur], [0.024, 0.02], { ring: 10, col: '#6a2a14', mat: MAT.METAL });
        for (const sd of [1, -1]) glow(M2, add(tur, [sd * 0.014, 0.004, 0.01]), 0.007, '#ffd060', { halo: 0.4, light: 0.25 });
        for (let i = 0; i < 6; i++) spike(M2, add(tur, [Math.cos(i) * 0.012, 0.012, Math.sin(i) * 0.012]), add(tur, [Math.cos(i) * 0.03, 0.04, Math.sin(i) * 0.03]), 0.003, { col: '#2a0e08', ring: 4 });
        void tt;
      },
    }, t),
  },
  enemy_sump_widow: {
    group: 'crawl', fam: 'chitin', note: 'A spider bigger than a shed: an oil-slick abdomen with a crimson hourglass, eight banded legs jointed wrong, palps, fangs, and a cluster of red eyes lighting her own face.',
    build: (M, t) => arthropod(M, {
      seed: 191, len: 2.1, width: 1.0, height: 0.6, lift: 0.85, abdomen: 0.6, thorax: 0.34, pairs: 4, reach: 2.7, knee: 1.55, legR: 0.05, spread: 1.05, gloss: true, eyes: 0, antennae: 0, mandibles: 0, spines: 5, spineLen: 2.2, hair: 0.8, wrong: true, twitch: 0.4,
      col: '#2a2018', under: '#1a120c', band: '#0e0a08', bands: 0, legCol: '#3a2a1c', legBand: '#c8642a', legJoint: '#e8a060', legTip: '#0e0a08', spineCol: '#120c08', legStripe: 0,
      // a spider: the abdomen a great bulb on a narrow pedicel, the cephalothorax in front, no head of its own
      prof: (u) => { const [w, h] = keys([[0, [0.1, 0.1]], [0.08, [0.8, 0.75]], [0.32, [1.05, 1.0]], [0.55, [0.7, 0.75]], [0.6, [0.16, 0.16]], [0.64, [0.5, 0.42]], [0.8, [0.62, 0.45]], [0.97, [0.4, 0.32]], [1, [0.15, 0.15]]], u); return { w: w * 1.0, h: h * 0.62, oy: u < 0.6 ? 0.18 * Math.sin(u / 0.6 * Math.PI) : 0, e: 2 }; },
      paint: (u, a) => {
        const sa = Math.sin(a), ca = Math.cos(a);
        // the hourglass on the back of the abdomen
        if (u < 0.58 && sa > 0.55) { const x = Math.abs(ca) * 2.2, y = (u - 0.3) / 0.25; if (x < 0.15 + 0.5 * Math.abs(y) && Math.abs(y) < 0.9) return '#d81a2a'; }
        return u < 0.6 ? null : '#3a2a20';
      },
      extra: (M2, { body, D, X, U }, tt) => {
        // the oil-slick film over the abdomen, laid as a shell over the loft
        const ab = body.at(0.3, Math.PI / 2);
        blob(M2, add(ab.c, mul(U, 0.13)), [0.97, 0.58, 0.62].map((v) => v * 1.04), { axes: [X, U, D], col: (d) => { const x = Math.abs(d[0]) * 2.2, y = d[2] / 0.6; return d[1] > 0.55 && x < 0.15 + 0.5 * Math.abs(y) && Math.abs(y) < 0.9 ? C('#ff1a2a') : C('#1a1410'); }, mat: FILM, shade: '#120a20', nu: 26, nv: 16 });
        // the cephalothorax's eyes: two great ones, six small, all burning
        const ce = body.at(0.94, Math.PI / 2), ec = madd(madd(ce.c, U, 0.18), D, 0.08);
        const EYES = [[0.07, 0.04, 0.075], [-0.07, 0.04, 0.075], [0.16, 0.0, 0.04], [-0.16, 0.0, 0.04], [0.1, 0.1, 0.03], [-0.1, 0.1, 0.03], [0.04, -0.06, 0.035], [-0.04, -0.06, 0.035]];
        for (const [x, y, r] of EYES) { const p = add(ec, add(mul(X, x), mul(U, y))); eye(M2, p, r, norm(add(D, add(mul(X, x * 2), mul(U, y)))), { iris: '#ff2a1a', white: '#ff2a1a', pupil: '#3a0004', glow: true }); }
        M2.halos.push({ p: ec, r: 0.35, c: C('#ff2a1a'), k: 0.5, bone: M2.bone });
        M2.lights.push({ p: madd(ec, D, 0.1), c: C('#ff3a1a'), r: 1.3, bone: M2.bone });
        // chelicerae and fangs, and the palps
        const fr = body.at(1, -0.6);
        for (const sd of [1, -1]) {
          const base = add(madd(body.at(0.99, sd > 0 ? -0.4 : Math.PI + 0.4).p, D, -0.05), mul(U, -0.05));
          tube(M2, [base, add(madd(base, D, 0.14), mul(U, -0.12)), add(madd(base, D, 0.16), mul(U, -0.26))], [0.075, 0.06, 0.045], { ring: 12, col: '#2a1c12', mat: MAT.GLOSS });
          spike(M2, add(madd(base, D, 0.16), mul(U, -0.26)), add(add(madd(base, D, 0.1), mul(U, -0.4)), mul(X, -sd * 0.06)), 0.03, { col: '#e8d8b0', mat: MAT.GLOSS, bend: mul(D, 0.05) });
          const pb = add(madd(base, D, 0.04), mul(X, sd * 0.16)), sw = Math.sin(tt * 1.3 + sd) * 0.04;
          tube(M2, [pb, add(add(madd(pb, D, 0.25), mul(U, 0.18)), mul(X, sd * 0.08)), add(add(madd(pb, D, 0.45 + sw), mul(U, -0.05)), mul(X, sd * 0.05)), add(madd(pb, D, 0.5 + sw), mul(U, -0.35))], [0.035, 0.03, 0.028, 0.035], { ring: 10, col: (u) => (u > 0.82 ? C('#c8642a') : C('#3a2a1c')), mat: MAT.GLOSS });
        }
        void fr;
        // tufts of setae on the cephalothorax
        for (let i = 0; i < 14; i++) { const q = body.at(0.66 + (i % 7) * 0.04, Math.PI / 2 + (i < 7 ? 0.7 : -0.7)); tuft(M2, q.p, add(q.n, mul(D, -0.6)), 0.08, 0.02, C('#4a3624'), q.n); }
      },
    }, t),
  },
  enemy_tunnel_horror: {
    group: 'crawl', fam: 'under', note: 'Knuckled and many-jointed under plates of horn that grade from ivory to umber, folded to fit a ceiling, a dozen small green eyes.',
    build: (M, t) => arthropod(M, {
      seed: 201, len: 1.7, width: 0.52, height: 0.3, lift: 0.5, abdomen: 0.5, thorax: 0.35, pairs: 3, reach: 1.55, knee: 0.95, legR: 0.042, spread: 0.9, gloss: false, eyes: 0, antennae: 0, mandibles: 0.26, spines: 4, spineLen: 2.4, wrong: true,
      col: '#2e2620', under: '#4a3c30', band: '#120e0a', bands: 0, legCol: '#3a2e24', legBand: '#d8c8a0', legJoint: '#8a6a4a', legTip: '#120e0a', spineCol: '#e0d0a8',
      plates: 8, plateCol: '#5a4430', plateEdge: '#e8d8b0', plateMat: MAT.SATIN,
      extra: (M2, { body, D, X, U }) => {
        for (let i = 0; i < 5; i++) { const f = body.at(0.12 + i * 0.15, Math.PI / 2); spike(M2, madd(f.p, f.n, 0.06), add(madd(f.p, f.n, 0.22), mul(f.T, -0.08)), 0.032, { col: (u) => mix('#5a4430', '#f0e4c8', u), mat: MAT.SATIN }); }
        const h = body.at(0.95, Math.PI / 2), R = rng(203);
        for (let i = 0; i < 12; i++) { const p = add(madd(h.c, U, 0.05 + 0.06 * R()), add(mul(X, (R() - 0.5) * 0.24), mul(D, 0.04 + 0.04 * R()))); glow(M2, p, 0.012 + 0.008 * R(), '#8aff60', { halo: 0.25, light: i < 2 ? 0.8 : 0, lightK: 0.5 }); }
      },
    }, t),
  },

  // ── long things
  // Each has one thing about it that's lit: the eel its rows of fibre-optic, the lurker a far-red lure you barely see,
  // the leviathan its one crisp eye. The rest stays two tones.
  enemy_drain_snake: {
    group: 'long', fam: 'wet', note: 'Wet slate in overlapping scales, the belly pale and the eyes grown over milky, a tongue still working.',
    build: (M, t) => serpent(M, {
      seed: 211, len: 2.4, r: 0.045, col: '#4a5458', under: '#a8b0a8', eyes: false, rise: 0.3, gloss: true,
      pattern: (u, a) => (Math.sin(a) > -0.35 && scaleEdge(u, a, 120, 22, 0.14) ? '#1e2628' : Math.sin(a) > 0.6 && Math.floor(u * 30) % 3 === 0 ? '#2e383a' : null),
      extra: (M2, { body, D, U, X }) => { for (const sd of [1, -1]) { const e = body.at(0.985, sd > 0 ? 0.6 : Math.PI - 0.6); blob(M2, madd(e.p, D, 0.05), [0.009, 0.007, 0.006], { axes: [X, U, D], col: '#d8e0e0', mat: TRANSLUCENT, shade: '#7a90b0', nu: 10, nv: 6 }); } },
    }, t),
  },
  enemy_cable_eel: {
    group: 'long', fam: 'deep', note: 'A black eel grown round swallowed fibre-optic: rows of studs down each flank sending a pulse of light tail to head, and a ring of glassy teeth.',
    build: (M, t) => serpent(M, {
      seed: 221, len: 1.9, r: 0.05, col: '#20303a', under: '#3a4a52', head: 'eel', fin: 0.035, finCol: '#0e1820', eyeCol: '#6fe8ff', rise: 0.34, teethCol: '#e8fbff', studs: 0,
      extra: (M2, { body }, tt) => {
        // the studs, in rows along the lateral line, the light running toward the head
        for (let i = 0; i < 26; i++) for (const sd of [1, -1]) {
          const u = 0.12 + i * 0.031, f = body.at(u, sd > 0 ? 0.25 : Math.PI - 0.25), k = Math.pow(0.5 + 0.5 * Math.sin(u * 40 - tt * 7), 6);
          tube(M2, [madd(f.p, f.n, -0.003), madd(f.p, f.n, 0.012)], [0.006, 0.005], { ring: 6, seg: 1, col: '#3a4a58', mat: MAT.SATIN, cap: false });
          glow(M2, madd(f.p, f.n, 0.013), 0.0045, mix('#0a4a48', '#2bf5c8', 0.25 + 0.75 * k), { halo: 0.15 + 0.6 * k, haloR: 4, light: i % 6 === 0 && sd > 0 ? 0.3 : 0, lightK: k });
        }
      },
    }, t),
  },
  enemy_meltwater_lamprey: {
    group: 'long', fam: 'wet', note: 'A yard of mottled muscle with seven gill pores down each side and a sucker for a face, rings of yellow teeth in it, raised to look at you.',
    build: (M, t) => serpent(M, {
      seed: 231, len: 1.0, r: 0.042, col: '#6a5e44', under: '#c8b890', head: 'sucker', eyes: false, rise: 0.3, amp: 0.12, mouthCol: '#9a2a34', lip: '#e0c8a8', teethCol: '#f0d870',
      pattern: (u, a, p) => (spotAt(p, 0.025, 0.42, 3) ? '#3a3020' : null),
      extra: (M2, { body, D, U, X }) => {
        for (const sd of [1, -1]) for (let i = 0; i < 7; i++) { const f = body.at(0.86 + i * 0.014, sd > 0 ? 0.05 : Math.PI - 0.05); blob(M2, madd(f.p, f.n, -0.002), [0.005, 0.006, 0.003], { axes: [f.T, f.Y, f.n], col: '#1a1008', nu: 8, nv: 5 }); }
        for (const sd of [1, -1]) { const e = body.at(0.93, sd > 0 ? 0.7 : Math.PI - 0.7); blob(M2, e.p, [0.006, 0.006, 0.004], { col: '#c8d0a0', mat: MAT.GLOSS, nu: 8, nv: 5 }); }
        void D; void U; void X;
      },
    }, t),
  },
  enemy_sump_leech: {
    group: 'long', fam: 'wet', note: 'A thigh-thick leech, black-olive with two rust-orange stripes down its back, ringed all along, its wheel of hooked teeth in a translucent lip.',
    build: (M, t) => serpent(M, {
      seed: 241, len: 1.5, r: 0.085, col: '#22261a', under: '#4a4a2a', head: 'wheel', eyes: false, ringsN: 52, rise: 0.32, amp: 0.14, waves: 0.8, mouthCol: '#7a1a2a', lip: '#c8a890', teethCol: '#f0e8d0',
      radK: (u) => 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, u * 1.1)),
      pattern: (u, a) => { const ca = Math.cos(a), sa = Math.sin(a); return sa > 0 && Math.abs(Math.abs(ca) - 0.35) < 0.09 ? '#c8642a' : sa > 0.2 && Math.abs(ca) < 0.08 ? '#0e100a' : null; },
      extra: (M2, { tip, D, U, X }) => { loop(M2, (s) => { const a = s * Math.PI * 2; return add(madd(tip, D, 0.02), add(mul(X, Math.cos(a) * 0.088), mul(U, Math.sin(a) * 0.088))); }, 0.014, { col: '#d8b0a0', mat: TRANSLUCENT, shade: '#9a2a3a', n: 20 }); },
    }, t),
  },
  enemy_harbor_lurker: {
    group: 'long', fam: 'deep', note: 'Murky olive, part eel and part something that had legs, with a far-red lure dangling over its jaw: light most of its prey can\'t see.',
    build: (M, t) => serpent(M, {
      seed: 251, len: 3.6, r: 0.13, col: '#4f5f4a', under: '#a8b098', head: 'eel', fin: 0.07, finCol: '#3a4838', legs: 2, eyeCol: '#c8103e', rise: 0.55, amp: 0.4,
      pattern: (u, a, p) => (spotAt(p, 0.09, 0.35, 5) && Math.sin(a) > -0.2 ? '#2e3a2a' : null),
      extra: (M2, { tip, D, U, X }, tt) => {
        const root = madd(madd(tip, D, 0.12), U, 0.11), sw = Math.sin(tt * 1.4) * 0.05;
        tube(M2, [root, madd(madd(root, U, 0.22), D, 0.1), add(madd(madd(root, U, 0.24), D, 0.3), mul(X, sw)), add(madd(madd(root, U, 0.12), D, 0.38), mul(X, sw))], [0.012, 0.009, 0.006, 0.005], { ring: 7, col: '#4f5f4a' });
        glow(M2, add(madd(madd(root, U, 0.1), D, 0.39), mul(X, sw)), 0.026, '#c8103e', { pulse: true, halo: 0.25, haloR: 2.5, light: 0.6, lightK: 0.5 });
      },
    }, t),
  },
  enemy_bay_leviathan: {
    group: 'long', fam: 'pale', view: { at: [-1.8, 3.8, 0], yawAbs: 1.9, pitch: -0.2, distAbs: 12 }, note: 'Pale coils up through the floor and back down, mottled like old ivory, photophores down its flanks, and a deep-water head: needle fangs in a dropped jaw lit from its throat, a gold eye in a bony socket, barbels with lit tips and a rayed crest down the neck.',
    build: (M, t) => serpent(M, {
      seed: 261, len: 1, r: 0.9, col: '#dce6e8', under: '#eef2f0', head: 'none', fin: 0, ring: 26, seg: 6, eyes: false, teethCol: '#f4f0e4', mouthCol: '#5a2a3a',
      pattern: (u, a, p) => (fnoise(p, 0.7) > 0.68 ? '#a8b4c0' : Math.sin(a) > 0.3 && spotAt(p, 0.35, 0.25, 7) ? '#8fe3ff' : null),
      radK: (u) => 0.25 + 0.75 * Math.min(1, u * 6) * (1 - 0.35 * smooth(0.85, 1, u)),
      path: (u, tt) => { const x = 3.2 * Math.sin(u * 3.1) - 1.5, z = -8 + u * 10, hump = 1.5 + 1.9 * Math.sin(u * Math.PI * 4.6 + tt * 0.4), y = u < 0.8 ? hump : 1.5 + 1.9 * Math.sin(0.8 * Math.PI * 4.6 + tt * 0.4) + (u - 0.8) * 22; return [x, y, z]; },
      extra: (M2, { body, tip, D, U }, tt) => {
        leviathanHead(M2, tip, D, U, 0.82, tt);
        for (let i = 0; i < 34; i++) for (const sd of [1, -1]) { const u = 0.12 + i * 0.024, f = body.at(u, sd > 0 ? 0.1 : Math.PI - 0.1), k = 0.5 + 0.5 * Math.sin(u * 30); glow(M2, madd(f.p, f.n, 0.01), 0.045 + 0.02 * k, mix('#3a7a9a', '#8fe3ff', k), { pulse: true, halo: 0.25 * k, haloR: 3, light: i % 8 === 0 && sd > 0 ? 2.5 : 0, lightK: 0.6 }); }
      },
    }, t),
  },

  // ── horrors and heaps
  // After the tatarigami: a mass reads by having no mid-tone, one motion and one accent. A fragment of something human
  // at medium scale, in the wrong place, is what makes it horrible rather than just big.
  enemy_sewer_slime: {
    group: 'heap', fam: 'wet', pal: { shade: '#5e6a54' }, note: 'Knee-high translucent ooze, light going through it in a yellow-green band, with bottle caps, a doll\'s eye and teeth floating in it and bubbles on its skin.',
    build: (M, t) => mound(M, {
      seed: 271, r: 0.42, h: 0.5, lump: 0.12, col: (d, p) => mix('#a4aca4', '#868e88', fnoise(p, 6)), mat: TRANSLUCENT, rate: 1.1,
      debris: (M2, surf, R, tt) => {
        M2.pal = { ...M2.pal, shade: '#c9e85a' };
        for (let i = 0; i < 6; i++) { const p = surf(R() * 6.3, 0.2 + R() * 0.8); blob(M2, p, [0.016, 0.004, 0.016], { e1: 0.3, col: ['#d84a3a', '#e8c040', '#3a7ac8'][i % 3], mat: MAT.METAL, nu: 10, nv: 4 }); }
        eye(M2, surf(0.8, 0.5), 0.024, norm([0.6, 0.4, 1]), { iris: '#3a8ad8', white: '#f4f0e6' });
        for (let i = 0; i < 6; i++) { const p = surf(2 + R() * 2, 0.3 + R() * 0.5); spike(M2, p, add(p, [0, 0.025, 0.01]), 0.007, { col: '#f0e4c8', mat: MAT.GLOSS, ring: 5 }); }
        for (let i = 0; i < 9; i++) { const p = surf(R() * 6.3, 0.1 + R() * 0.9), r = 0.012 + 0.02 * R() * (1 + 0.3 * Math.sin(tt * 3 + i)); blob(M2, p, [r, r, r], { col: '#e8fff0', mat: MAT.GLOSS, nu: 10, nv: 6 }); }
        glow(M2, surf(1.6, 0.0), 0.02, '#c9e85a', { halo: 0.3, light: 0.6, lightK: 0.7 });
      },
    }, t),
  },
  enemy_tar_horror: {
    group: 'heap', fam: 'midden', note: 'Black tar with no middle tone, writhing arms with a raw pink edge, red eyes opening wherever, and a human hand and skull carried up in it.',
    build: (M, t) => mound(M, {
      seed: 281, r: 0.95, h: 1.3, lump: 0.22, col: '#0e0c0e', mat: MAT.GLOSS, rate: 0.6,
      debris: (M2, surf, R, tt) => {
        // the writhing: a dozen worms off the mass, each on its own clock
        for (let k = 0; k < 14; k++) {
          const a = R() * 6.3, h = 0.1 + R() * 0.8, p0 = surf(a, h), out = norm(sub(p0, [0, 0.5, 0])), ph = tt * (1.2 + R()) + k;
          const pts = [madd(p0, out, -0.05)];
          for (let i = 1; i < 5; i++) pts.push(add(madd(pts[i - 1], out, 0.12), [Math.sin(ph + i) * 0.06, 0.05 * Math.cos(ph * 1.3 + i), Math.cos(ph + i * 1.7) * 0.06]));
          tube(M2, pts, [0.05, 0.04, 0.03, 0.018, 0.004], { ring: 9, seg: 4, col: '#120e12', mat: MAT.GLOSS });
        }
        // the arms it reaches with
        for (let k = 0; k < 3; k++) {
          const a = -0.6 + k * 0.6 + Math.PI / 2, p0 = surf(a, 0.5), sw = Math.sin(tt * 0.9 + k) * 0.1;
          tube(M2, [p0, add(p0, [Math.cos(a) * 0.4, 0.3, Math.sin(a) * 0.4 + 0.2]), add(p0, [Math.cos(a) * 0.7 + sw, 0.1, Math.sin(a) * 0.6 + 0.5]), add(p0, [Math.cos(a) * 0.85 + sw, -0.35, Math.sin(a) * 0.7 + 0.6])], [0.13, 0.1, 0.07, 0.03], { ring: 12, col: '#100c10', mat: MAT.GLOSS });
        }
        // a human hand up out of it, and a skull
        const hp = surf(1.9, 0.75), up = [0, 1, 0];
        tube(M2, [madd(hp, up, -0.05), madd(hp, up, 0.25)], [0.045, 0.04], { ring: 10, col: '#d8c8b8' });
        blob(M2, madd(hp, up, 0.3), [0.05, 0.06, 0.025], { col: '#d8c8b8', nu: 12, nv: 8 });
        for (let i = 0; i < 4; i++) tube(M2, [madd(add(hp, [(i - 1.5) * 0.022, 0, 0]), up, 0.34), madd(add(hp, [(i - 1.5) * 0.028, 0, 0.02]), up, 0.43), madd(add(hp, [(i - 1.5) * 0.03, 0, 0.05]), up, 0.48)], [0.01, 0.009, 0.006], { ring: 6, col: '#d8c8b8' });
        const sk = surf(0.5, 0.35);
        blob(M2, sk, [0.09, 0.1, 0.11], { col: '#e8dcc0', nu: 14, nv: 10 });
        for (const sd of [1, -1]) blob(M2, add(sk, [sd * 0.035, 0.01, 0.09]), [0.025, 0.025, 0.012], { col: '#120e0c', nu: 8, nv: 5 });
        // the eyes, red, wherever
        for (let i = 0; i < 7; i++) { const p = surf(R() * 6.3, 0.2 + R() * 0.7); eye(M2, p, 0.025 + 0.02 * R(), norm(sub(p, [0, 0.4, 0])), { iris: '#ff3b1f', white: '#ff3b1f', pupil: '#1a0000', glow: true, slit: 0.8 }); if (i < 3) M2.halos.push({ p, r: 0.09, c: C('#ff3b1f'), k: 0.4, bone: M2.bone }); }
      },
    }, t),
  },
  enemy_under_midden: {
    group: 'heap', fam: 'midden', note: 'A hundred things drowned into one bruise-coloured mound: bone, plastic, rat tails and roots, worms of it writhing at the edges, red eyes in it, and one pale human face half sunk in the middle.',
    build: (M, t) => mound(M, {
      seed: 291, r: 1.6, h: 1.7, lump: 0.28, lobes: 6, freq: 1.8, col: (d, p) => mix('#4a2f45', '#2e1c2c', fnoise(p, 2.5)), mat: MAT.SATIN, rate: 0.35,
      debris: (M2, surf, R, tt) => {
        for (let i = 0; i < 14; i++) { const p = surf(R() * 6.3, R() * 0.9), d = norm([R() - 0.5, R() * 0.5, R() - 0.5]); tube(M2, [madd(p, d, -0.1), madd(p, d, 0.25)], [0.03, 0.025], { ring: 8, col: '#e8dcc0' }); blob(M2, madd(p, d, 0.27), [0.04, 0.035, 0.035], { col: '#e8dcc0', nu: 8, nv: 6 }); }
        for (let i = 0; i < 10; i++) { const p = surf(R() * 6.3, R() * 0.8); blob(M2, p, [0.05 + 0.08 * R(), 0.04 + 0.06 * R(), 0.05 + 0.06 * R()], { e1: 0.4, e2: 0.4, col: ['#e84a3a', '#3a8ae8', '#f0c840', '#f0ece4', '#3ac070'][i % 5], mat: MAT.GLOSS, nu: 10, nv: 6 }); }
        for (let i = 0; i < 8; i++) { const p = surf(R() * 6.3, R() * 0.3), d = norm([R() - 0.5, -0.4, R() - 0.5]); tube(M2, [p, madd(p, d, 0.3), add(madd(p, d, 0.6), [0, -0.1, 0])], [0.012, 0.008, 0.002], { ring: 5, col: '#c88a80' }); }
        for (let i = 0; i < 6; i++) { const p = surf(R() * 6.3, R() * 0.6); sheet(M2, (u, v) => add(p, [(u - 0.5) * 0.4, -v * 0.5 + Math.sin(u * 6) * 0.03, Math.sin(u * 3 + v) * 0.08 + 0.05]), 5, 4, { col: ['#6a4a5a', '#3a4a6a', '#7a5a3a'][i % 3] }); }
        // worms at the edges, writhing
        for (let k = 0; k < 16; k++) {
          const a = R() * 6.3, p0 = surf(a, 0.05 + R() * 0.5), out = norm([Math.cos(a), 0.3, Math.sin(a)]), ph = tt * (1 + R()) + k;
          const pts = [madd(p0, out, -0.06)];
          for (let i = 1; i < 5; i++) pts.push(add(madd(pts[i - 1], out, 0.16), [Math.sin(ph + i) * 0.08, 0.06 * Math.cos(ph * 1.3 + i), Math.cos(ph + i * 1.7) * 0.08]));
          tube(M2, pts, [0.06, 0.05, 0.035, 0.02, 0.004], { ring: 9, seg: 4, col: '#1e1220', mat: MAT.GLOSS });
        }
        // the face: smooth, pale, half sunk, its eyes shut. The focal point
        const fc = surf(Math.PI / 2, 0.45), fd = norm(sub(fc, [0, 0.7, 0]));
        const fx = norm(cross([0, 1, 0], fd)), fy = cross(fd, fx);
        blob(M2, madd(fc, fd, -0.04), [0.2, 0.26, 0.12], { axes: [fx, fy, fd], col: '#efe6d8', mat: MAT.MATTE, shade: '#9a8ab8', nu: 20, nv: 14 });
        for (const sd of [1, -1]) tube(M2, [add(madd(fc, fd, 0.075), add(mul(fx, sd * 0.11), mul(fy, 0.05))), add(madd(fc, fd, 0.08), add(mul(fx, sd * 0.06), mul(fy, 0.04)))], [0.006, 0.006], { ring: 5, col: '#3a2a3a' });
        blob(M2, add(madd(fc, fd, 0.07), mul(fy, -0.13)), [0.05, 0.012, 0.01], { axes: [fx, fy, fd], col: '#5a2a3a', nu: 10, nv: 4 });
        for (let i = 0; i < 6; i++) { const p = surf(R() * 6.3, 0.3 + R() * 0.6); eye(M2, p, 0.03 + 0.02 * R(), norm(sub(p, [0, 0.6, 0])), { iris: '#ff3b1f', white: '#ff3b1f', pupil: '#1a0000', glow: true, slit: 0.8 }); if (i < 2) M2.lights.push({ p, c: C('#ff3b1f'), r: 0.6, bone: M2.bone }); }
      },
    }, t),
  },
  enemy_choke_swarm: {
    group: 'heap', fam: 'wet', note: 'A rolling knot of pale flies with a front edge, wings catching the light.',
    build: (M, t) => {
      const R = rng(301), n = 260;
      for (let i = 0; i < n; i++) {
        const u = R(), v = R(), w = R(), th = u * Math.PI * 2, ph = Math.acos(2 * v - 1), rr = 0.55 * Math.cbrt(w);
        let p = [Math.sin(ph) * Math.cos(th) * rr, Math.cos(ph) * rr * 0.7, Math.sin(ph) * Math.sin(th) * rr];
        if (p[2] < 0) p = [p[0] * 1.2, p[1], p[2] * 1.6];
        const a = t * (1.5 + R()) + i;
        p = add(p, [Math.sin(a) * 0.03, Math.cos(a * 1.3) * 0.03 + 1.25, Math.sin(a * 0.7) * 0.03]);
        const d = norm([Math.cos(a), 0, Math.sin(a)]);
        blob(M, p, [0.013, 0.011, 0.02], { axes: [norm(cross([0, 1, 0], d)), [0, 1, 0], d], col: '#f0f2dc', nu: 6, nv: 4, shade: '#8a9a7a' });
        sheet(M, (uu, vv) => add(p, add(mul(norm(cross([0, 1, 0], d)), (uu - 0.5) * 0.05), [0, 0.012, (vv - 0.5) * 0.016])), 1, 1, { col: '#ffffff', mat: FILM, thick: 0.001, shade: '#a8c0b8' });
      }
    },
  },
  enemy_sump_gulper: {
    group: 'heap', fam: 'wet', note: 'A huge squat toad, a low mound of warty green over a yellow belly, round ringed eyes high on the head, a wide mouth of small sharp teeth, drool at the corners, and a throat that keeps swallowing on nothing.',
    build: (M, t) => {
      const top = '#6e8a38', back = '#4c6624', side = '#8a9a48', belly = '#d8a838', belly2 = '#c07828', fold = '#9a8a40';
      const inside = '#a0242a', gum = '#c8505a', tooth = '#f0e8d0', ridge = '#a8bc60';
            // Time: it breathes, works its jaw, and every 5.2 s swallows hard on nothing.
      const ph = (t % 5.2) / 5.2, ez = (v) => smooth(0, 1, v);
      const gulp = ph > 0.7 ? Math.sin(Math.PI * (ph - 0.7) / 0.3) : 0;
      const chew = 0.5 + 0.5 * Math.sin(t * 5.5);
      const br = 1 + 0.025 * Math.sin(t * 2.0) + 0.03 * gulp;
      
      // ── the mound: wider than long, low, the head the front of it ──
      // A toe: three segments that arch up off the ground and come down on a fat round pad, a knuckle
      // at each joint, creases across the top and a short dark claw. Returns its first joint for the webbing.
      const pad = '#d8c890', claw = '#2a2014', crease = '#3a4a18';
      const toe = (base, dir, len, r, col) => {
        const d = norm([dir[0], 0, dir[2]]);
        const j1 = add(base, add(mul(d, len * 0.38), [0, len * 0.16, 0]));
        const j2 = add(base, add(mul(d, len * 0.7), [0, len * 0.12, 0]));
        const tip = add(base, add(mul(d, len), [0, r * 0.4 - base[1] + 0.012, 0]));
        tube(M, [base, j1, j2, tip], [r, r * 0.85, r * 0.72, r * 0.6], { ring: 10, col: C(col) });
        for (const [j, k] of [[j1, 0.95], [j2, 0.82]]) {
          blob(M, j, [r * k * 1.15, r * k * 1.1, r * k * 1.15], { col, nu: 10, nv: 8 });
          // the crease across the top of the joint
          const x = norm(cross([0, 1, 0], d));
          tube(M, [madd(madd(j, x, -r * k), [0, 1, 0], r * k * 0.7), madd(j, [0, 1, 0], r * k * 1.08), madd(madd(j, x, r * k), [0, 1, 0], r * k * 0.7)], [r * 0.12, r * 0.16, r * 0.12], { ring: 5, col: C(crease) });
        }
        // the pad: a fat disc it stands on, wider than the toe
        blob(M, madd(tip, d, r * 0.3), [r * 1.35, r * 0.8, r * 1.45], { col: pad, nu: 12, nv: 8, axes: [norm(cross([0, 1, 0], d)), [0, 1, 0], d] });
        spike(M, add(madd(tip, d, r * 1.2), [0, r * 0.35, 0]), add(madd(tip, d, r * 2.2), [0, -r * 0.2, 0]), r * 0.32, { col: C(claw), bend: [0, r * 0.25, 0] });
        return j1;
      };
      // webbing: a thin flat strip between two toes' first joints and the foot
      const web = (p, q, foot, col) => tube(M, [p, lerp3(lerp3(p, q, 0.5), foot, 0.35), q], [0.006, 0.009, 0.006], { ring: 6, flat: 0.25, col: C(col) });

      const bodyAt = M.P.length;
      sweep(M, [[0, 0.26, -0.46], [0, 0.31, -0.22], [0, 0.32, 0.02], [0, 0.31, 0.22], [0, 0.29, 0.38]], (u) => {
        const [w, h] = keys([[0, [0.24, 0.18]], [0.2, [0.4, 0.3]], [0.5, [0.52, 0.31]], [0.78, [0.47, 0.26]], [1, [0.36, 0.15]]], u);
        return { w: w * br, h: h * br, oy: -0.02, e: 2.3 };
      }, { ring: 30, seg: 8,
        mat: (u, q) => (Math.sin(q * 4 + u * 11) > 0.85 ? MAT.GLOSS : MAT.MATTE),
        col: (u, q, p) => {
          const sq = Math.sin(q);
          if (sq < -0.45) return mix(C(belly), C(belly2), smooth(-0.45, -1, sq));
          if (sq < -0.15) return mix(C(side), C(belly), smooth(-0.15, -0.45, sq));
          if (spotAt(p, 0.045, 0.3, 5)) return C(back);
          return sq > 0.55 ? C(top) : mix(C(side), C(top), smooth(-0.15, 0.55, sq));
        } });
      // the sacral hump over the hips, and a rounded rump that sits down between the thighs
      blob(M, [0, 0.47, -0.24], [0.2, 0.1, 0.15], { col: (d) => (d[1] > 0.3 ? C(top) : C(side)), nu: 18, nv: 10 });
      blob(M, [0, 0.21, -0.43], [0.2, 0.16, 0.1], { col: (d) => (d[1] < -0.2 ? C(belly2) : C(side)), nu: 18, nv: 12 });
      const bodyEnd = M.P.length;

      // ── the mouth: a wide line that wraps back round the sides of the head ──
      const my = 0.25, mz = 0.455, gap = 0.02 + 0.018 * chew + 0.03 * gulp;
      const lip = (x, up) => { const k = x / 0.33, back = 0.2 * k * k * k * k + 0.06 * k * k; return [x, my + 0.03 * k * k + (up ? gap * 0.4 : -gap * 0.6), mz - back]; };
      const xs = [-0.36, -0.3, -0.22, -0.12, 0, 0.12, 0.22, 0.3, 0.36];
      blob(M, [0, my - 0.004, mz - 0.07], [0.28, 0.008 + gap * 0.5, 0.05], { col: inside, nu: 20, nv: 8 });
      sweep(M, xs.map((x) => lip(x, true)), () => ({ w: 0.016, h: 0.02 }), { ring: 8, seg: 4, col: C(back) });
      sweep(M, xs.map((x) => lip(x, false)), () => ({ w: 0.02, h: 0.024 }), { ring: 8, seg: 4, col: C(side) });
      // a red line of gum under the top lip
      sweep(M, xs.slice(1, -1).map((x) => { const p = lip(x, true); return [p[0], p[1] - 0.008, p[2] - 0.006]; }), () => ({ w: 0.01, h: 0.008 }), { ring: 6, seg: 4, col: C(gum), mat: MAT.GLOSS });
      // small sharp teeth, top row, a few gaps
      for (let k = -9; k <= 9; k++) {
        if (Math.abs(k) === 5 || k === 2) continue;                          // a couple are gone
        const p = lip(k * 0.033, true), l = 0.012 + 0.008 * ((k * 7 + 3) % 3) / 2;
        spike(M, [p[0], p[1] - 0.006, p[2] - 0.004], [p[0], p[1] - 0.006 - l, p[2] + 0.003], 0.006, { col: tooth });
      }
      for (let k = -7; k <= 7; k += 2) { const p = lip(k * 0.04, false); spike(M, [p[0], p[1] + 0.006, p[2] - 0.004], [p[0], p[1] + 0.017, p[2] + 0.002], 0.005, { col: tooth }); }

      // drool from the corners, longer as it works its jaw
      for (const sd2 of [1, -1]) {
        const c0 = lip(sd2 * 0.2, false), len = 0.04 + 0.07 * (0.5 + 0.5 * Math.sin(t * 1.7 + sd2)) + 0.05 * gulp, w2 = 0.01 * Math.sin(t * 2.6 + sd2);
        tube(M, [c0, [c0[0] + w2 * 0.5, c0[1] - len * 0.5, c0[2] + 0.008], [c0[0] + w2, c0[1] - len, c0[2] + 0.012]], [0.006, 0.0035, 0.005], { ring: 6, col: C('#d8e4d0'), mat: TRANSLUCENT });
        blob(M, [c0[0] + w2, c0[1] - len - 0.008, c0[2] + 0.012], [0.01, 0.014, 0.01], { col: '#d8e4d0', mat: TRANSLUCENT, nu: 8, nv: 6 });
      }

      // ── the throat: folds of loose skin under the jaw, swelling on the gulp ──
      for (let i = 0; i < 4; i++) {
        const y = 0.2 - i * 0.035, z = 0.38 - i * 0.05, w = 0.28 + i * 0.035, sk = 1 + 0.15 * gulp * (1 - i / 4);
        tube(M, [[-w, y + 0.03, z - 0.12], [-w * 0.6, y, z - 0.02], [0, y - 0.008 * sk, z + 0.008 * sk], [w * 0.6, y, z - 0.02], [w, y + 0.03, z - 0.12]],
          [0.008, 0.014, 0.017, 0.014, 0.008], { ring: 7, col: C(i % 2 ? belly : fold) });
      }

      for (const sd of [1, -1]) {
        // ── eyes: round and ringed, high on the head, looking out to the side and down at you ──
        blob(M, [sd * 0.2, 0.43, 0.24], [0.115, 0.09, 0.11], { col: (d) => (d[1] > 0.3 ? C(top) : C(side)), nu: 18, nv: 12 });
        const blink = Math.max(0, 1 - Math.abs(((t + (sd > 0 ? 0 : 0.06)) % 4.7) - 0.1) / 0.12);
        socketEye(M, [sd * 0.21, 0.47, 0.29], 0.074, {
          look: norm([sd * 0.55, -0.05, 1]), sd, open: 1.0, blink, tilt: -0.06, width: 1.25, brow: 0.0,
          skin: top, lid: '#b8c47a', crease: '#3a4a18', iris: '#e4dc94', ring: '#8a7a30', pupil: '#0a0806', shape: 'bar', pupilR: 0.36,
        });
        // the eardrum behind each eye
        blob(M, [sd * 0.35, 0.4, 0.15], [0.012, 0.048, 0.048], { col: (d) => (Math.hypot(d[1], d[2]) < 0.45 ? C(back) : C(side)), nu: 14, nv: 10, axes: [norm([1, 0, 0.6 * sd]), [0, 1, 0], norm([-0.6 * sd, 0, 1])] });
        // two ridges down the outer side of each eye, from in front of it to well behind it
        for (const [off, hi, th] of [[0.0, 0.0, 1], [0.045, -0.035, 0.8]]) {
          tube(M, [[sd * (0.25 + off), 0.45 + hi, 0.36], [sd * (0.31 + off), 0.52 + hi, 0.26], [sd * (0.33 + off), 0.57 + hi, 0.12], [sd * (0.35 + off), 0.57 + hi, -0.06], [sd * (0.36 + off), 0.51 + hi, -0.26]],
            [0.008, 0.02 * th, 0.022 * th, 0.017 * th, 0.006], { ring: 9, col: (tt, q) => (Math.sin(q) > 0.3 ? C(side) : C(back)) });
          // bone spikes along the ridge behind the eye, biggest just behind it and shrinking toward the back
          const rp = [[sd * (0.33 + off), 0.59 + hi, 0.12], [sd * (0.35 + off), 0.59 + hi, -0.06], [sd * (0.36 + off), 0.53 + hi, -0.26]];
          for (let k = 0; k < 5; k++) {
            const u = k / 4, seg = u < 0.5 ? 0 : 1, f2 = u < 0.5 ? u * 2 : (u - 0.5) * 2;
            const base = lerp3(rp[seg], rp[seg + 1], f2), len = (0.05 - 0.03 * u) * th;
            const tip = add(base, [sd * len * 0.45, len * 0.85, -len * 0.4]);
            blob(M, base, [0.017, 0.01, 0.017], { col: back, nu: 10, nv: 6 });
            spike(M, base, tip, 0.014 * th, { col: (tt) => (Math.sin(tt * 26) > 0.55 ? C('#9a8460') : mix(C('#c8b488'), C('#f2ead6'), tt)), bend: [0, -len * 0.15, -len * 0.1], mid: 0.7, ring: 9 });
          }
        }
        // a ring of spikes round the eye turret, longest over the brow and at the back, leaning outward
        for (let k = 0; k < 11; k++) {
          const th = (k / 11) * Math.PI * 2, cx = sd * 0.2, cz = 0.24;
          const out = [Math.cos(th) * 0.118, 0, Math.sin(th) * 0.112];
          const base = [cx + out[0], 0.465 + 0.02 * Math.sin(th + 0.3), cz + out[2]];
          if (out[2] > 0.08 && Math.abs(out[0]) < 0.05) continue;            // keep the front of the eye clear
          const len = 0.035 + 0.025 * (0.5 + 0.5 * Math.cos(th - (sd > 0 ? 0 : Math.PI))) + 0.012 * ((k * 5) % 3) / 2;
          const tip = add(base, add(mul(norm([out[0], 0, out[2]]), len * 0.7), [0, len * 0.75, 0]));
          // bone, not skin: a collar of hide at the root, then off-white horn ringed with growth lines, curving back
          blob(M, base, [0.019, 0.011, 0.019], { col: back, nu: 10, nv: 6 });
          spike(M, base, tip, 0.016, { col: (tt) => (Math.sin(tt * 26) > 0.55 ? C('#9a8460') : mix(C('#c8b488'), C('#f2ead6'), tt)), bend: [0, -len * 0.18, 0], mid: 0.7, ring: 9 });
        }
        // a big bone horn behind each eye: out of a collar of hide, back and up, curling out at the tip
        blob(M, [sd * 0.25, 0.57, 0.1], [0.06, 0.03, 0.06], { col: back, nu: 12, nv: 8 });
        tube(M, [[sd * 0.25, 0.55, 0.1], [sd * 0.29, 0.66, 0.04], [sd * 0.34, 0.74, -0.06], [sd * 0.42, 0.77, -0.17], [sd * 0.5, 0.74, -0.24]],
          [0.045, 0.036, 0.026, 0.015, 0.002], { ring: 12, seg: 6,
            col: (tt) => (Math.sin(tt * 34) > 0.6 ? C('#8a7450') : mix(C('#bca878'), C('#f2ead6'), tt)) });
        // nostrils
        blob(M, [sd * 0.05, 0.345, 0.425], [0.012, 0.008, 0.008], { col: '#1a220c', nu: 8, nv: 5 });

        // ── arms: heavy, set forward, folds where they meet the body ──
        const sh = [sd * 0.36, 0.24, 0.16], el = [sd * 0.45, 0.13, 0.26], wr = [sd * 0.38, 0.035, 0.4];
        tube(M, [sh, el, wr], [0.095, 0.072, 0.05], { ring: 14, col: (u, q) => (Math.sin(q) < -0.2 ? C(belly) : C(side)) });
        for (let i = 0; i < 3; i++) tube(M, [[sd * (0.3 + i * 0.02), 0.32 - i * 0.04, 0.09 + i * 0.02], [sd * (0.38 + i * 0.02), 0.3 - i * 0.04, 0.17 + i * 0.02], [sd * (0.42 + i * 0.02), 0.22 - i * 0.04, 0.22 + i * 0.02]], [0.006, 0.011, 0.006], { ring: 6, col: C(i % 2 ? side : fold) });
        // four big splayed fingers, jointed, padded and clawed, webbed at the base
        const hand = [];
        for (let k = 0; k < 4; k++) {
          const ang = (k - 1.5) * 0.42 + sd * 0.18;
          hand.push(toe(add(wr, [0, -0.008, 0.01]), [Math.sin(ang) * sd, 0, Math.cos(ang)], 0.19 - Math.abs(k - 1.5) * 0.025, 0.022, side));
        }
        for (let k = 0; k < 3; k++) web(hand[k], hand[k + 1], wr, belly);

        // ── hind legs, folded as a sitting frog folds them: the thigh runs forward from the hip along the flank,
        // the shin doubles back over it to a heel tucked by the rump, and the long foot runs forward again on the
        // ground, so the whole leg is a Z pressed against the body ──
        const hip = [sd * 0.36, 0.2, -0.34], knee = [sd * 0.63, 0.19, -0.04], heel = [sd * 0.55, 0.07, -0.44];
        const ball = [sd * 0.72, 0.03, -0.14];
        const legCol = (tt, q, p) => (Math.sin(q) < -0.35 ? C(belly2) : spotAt(p, 0.04, 0.35, 6) ? C(back) : C(side));
        // the thigh: a fat drumstick, widest near the hip, blended into the body
        tube(M, [hip, [sd * 0.5, 0.22, -0.2], knee], [0.14, 0.12, 0.072], { ring: 16, col: legCol });
        // the shin lies on top of and outside the thigh, back to the heel
        tube(M, [add(knee, [sd * 0.02, 0.02, 0]), [sd * 0.66, 0.15, -0.22], heel], [0.075, 0.065, 0.045], { ring: 14, col: legCol });
        blob(M, add(knee, [sd * 0.015, 0.01, 0.01]), [0.08, 0.075, 0.075], { col: side, nu: 12, nv: 9 });
        // the heel and the long foot along the ground, forward and out
        blob(M, heel, [0.05, 0.045, 0.055], { col: side, nu: 12, nv: 8 });
        tube(M, [heel, [sd * 0.65, 0.045, -0.3], ball], [0.045, 0.04, 0.034], { ring: 12, flat: 0.7, col: legCol });
        // a fold of skin where the thigh meets the body, and one behind the knee
        tube(M, [add(hip, [0, 0.12, 0.06]), add(hip, [sd * 0.08, 0.14, 0.12]), add(hip, [sd * 0.14, 0.06, 0.16])], [0.008, 0.013, 0.008], { ring: 6, col: C(fold) });
        tube(M, [add(knee, [-sd * 0.05, -0.04, -0.06]), add(knee, [-sd * 0.02, -0.07, -0.02]), add(knee, [sd * 0.02, -0.07, 0.02])], [0.006, 0.01, 0.006], { ring: 6, col: C(fold) });
        // five long webbed toes off the ball of the foot, the middle ones longest
        const feet = [];
        for (let k = 0; k < 5; k++) {
          const ang = (k - 2) * 0.32 + sd * 0.45;
          feet.push(toe(ball, [Math.sin(ang) * sd, 0, Math.cos(ang)], 0.24 - Math.abs(k - 2) * 0.035, 0.022, side));
        }
        for (let k = 0; k < 4; k++) web(feet[k], feet[k + 1], ball, belly);
      }

      // ── warts: raised ridges over the back, long along the body, pale on top, in its real skin ──
      const wr2 = rng(4417);
      for (let i = 0, tries = 0; i < 30 && tries < 4000; tries++) {
        const v = bodyAt + 3 * Math.floor(wr2() * ((bodyEnd - bodyAt) / 3)), p = [M.P[v], M.P[v + 1], M.P[v + 2]];
        if (p[1] < 0.26 || p[2] > 0.3) continue;
        // keep the brow and the eyes clear
        if (p[2] > 0.12 && Math.abs(Math.abs(p[0]) - 0.21) < 0.12) continue;
        i++;
        const r = 0.024 + wr2() * 0.022, long = 1.6 + wr2() * 1.8;
        const n = norm([M.N[v], M.N[v + 1], M.N[v + 2]]), ax = norm(cross(n, [0, 0, 1])), az = cross(ax, n);
        if (vlen(ax) < 0.5) continue;
        const rb = r * (1.0 + wr2() * 0.7);
        blob(M, madd(p, n, rb * 0.35), [rb, rb * 0.85, rb * 1.05], { axes: [ax, n, az], nu: 12, nv: 9, mat: MAT.SATIN ?? MAT.MATTE,
          col: (d) => (d[1] > 0.55 ? C('#b07ac0') : d[1] > 0 ? C('#7a3e8a') : C('#4a2050')) });
      }
      // a few wet sheens, so it's damp without being plastic
      for (const [x, y, z] of [[0.1, 0.6, -0.08], [-0.16, 0.58, -0.2], [0.04, 0.585, 0.08]]) blob(M, [x, y, z], [0.03, 0.004, 0.05], { col: '#c8d8a0', mat: MAT.GLOSS, nu: 8, nv: 5 });
    },
  },
  enemy_pipe_stalker: {
    group: 'heap', fam: 'under', note: 'Long grey limbs, a back ridged with verdigrised pipe scale beaded with condensation, and two dim teal pits where the eyes were.',
    build: (M, t, o) => quadruped(M, {
      gait: 'stalk', toeLen: 1.3,
      seed: 311, len: 0.7, legLen: 1.75, legW: 1.05, bodyW: 0.95, chestD: 0.9, waist: 0.7, arch: 1.4, neckLen: 1.0, neckW: 0.8, neckRise: 0.05, headPitch: 0.65, slope: -0.05, stance: 0.4, breathe: 0.6, sway: 0.2,
      hairless: true, skin: '#8a8c8e', ribs: 0.6, hackles: 0, shag: 0, mange: 0, paws: '#5a5c5e', claws: '#1a1a1a',
      head: { ears: 'none', blind: true, muzzle: 0.12, skull: 0.15, muzzleW: 0.85, stop: 0.2, gape: 0.06, col: '#7a7c7e', cheek: '#7a7c7e', tan: false, nose: null, brow: 0, tufts: 0 },
      tail: { len: 0.5, r: 0.025, lift: -0.4, curl: 0.18, col: '#7a7c7e', kind: 'rat' },
      extra: (M2, { body, neck, head }) => {
        for (let i = 0; i < 12; i++) {
          const f = i < 9 ? body.at(0.1 + i * 0.095, Math.PI / 2) : neck.at(0.2 + (i - 9) * 0.25, Math.PI / 2);
          tube(M2, [madd(madd(f.p, f.n, -0.005), f.X, -0.05), madd(madd(f.p, f.n, 0.025), f.X, 0), madd(madd(f.p, f.n, -0.005), f.X, 0.05)], [0.018, 0.022, 0.018], { ring: 8, seg: 3, up: f.T, col: i % 3 ? '#5a7a6a' : '#8a5a3a', mat: MAT.METAL });
          if (i % 2) blob(M2, madd(madd(f.p, f.n, 0.03), f.X, 0.03), [0.006, 0.008, 0.006], { col: '#e8fff8', mat: MAT.GLOSS, nu: 8, nv: 5 });
        }
        for (const sd of [1, -1]) { const e = head.skull.at(0.5, sd > 0 ? 0.42 : Math.PI - 0.42); glow(M2, madd(e.p, e.n, -0.006), 0.008, '#3ad8b0', { pulse: true, halo: 0.35, light: 0.25, lightK: 0.5 }); }
      },
    }, t, o),
  },
  enemy_redline_horror: {
    group: 'heap', fam: 'bleed', note: 'Raw red on too many legs, ribs of bone over a heart that glows like a core and ticks, the light of it on its own flesh.',
    build: (M, t) => arthropod(M, {
      seed: 321, len: 1.9, width: 0.55, height: 0.45, lift: 0.75, abdomen: 0.45, thorax: 0.4, pairs: 3, reach: 1.3, knee: 0.75, legR: 0.06, spread: 0.85, gloss: false, eyes: 0, antennae: 0, mandibles: 0.25, spines: 3, wrong: true, twitch: 0.5,
      col: '#9a2a24', under: '#d8786a', band: '#4a1018', bands: 5, legCol: '#8a2420', legBand: '#e8d8c0', legJoint: '#ffb0a0', legTip: '#2a0a10', spineCol: '#e8d8c0',
      paint: (u, a, p) => (veinAt(p, 6, 0.03) ? '#4a1a4e' : null),
      extra: (M2, { body, D, X, U }, tt) => {
        const c = body.at(0.62, -Math.PI / 2 + 0.1), beat = 1 + 0.14 * Math.max(0, Math.sin(tt * 7)) ** 8;
        const hp = madd(madd(c.c, c.n, 0.2), [0, 1, 0], 0.05);
        glow(M2, hp, [0.12 * beat, 0.14 * beat, 0.11 * beat], '#ff5a2a', { halo: 0.9, haloR: 3.2, light: 1.6, lightK: 1.2 });
        for (let i = 0; i < 6; i++) loop(M2, (s) => { const a = -Math.PI / 2 + (s - 0.5) * 2.2; const q = body.at(0.5 + i * 0.04, a); return madd(q.p, q.n, 0.03); }, 0.016, { col: '#f0e4d0', n: 12 });
        for (let i = 0; i < 9; i++) { const q = body.at(0.92 + (i % 3) * 0.02, Math.PI / 2 - 0.4 + Math.floor(i / 3) * 0.4); glow(M2, madd(q.p, q.n, 0.005), 0.014, '#f0e040', { halo: 0.2, light: 0 }); }
        for (const sd of [1, -1]) for (let k = 0; k < 2; k++) {
          const r0 = body.at(0.88 - k * 0.06, sd > 0 ? -0.1 : Math.PI + 0.1).p, sw = Math.sin(tt * 1.2 + k + sd) * 0.08;
          const el = add(r0, [sd * (0.35 + k * 0.1), 0.15 - k * 0.2, 0.25]), wr = add(r0, [sd * (0.25 + k * 0.1) + sw, -0.2 - k * 0.25, 0.75]);
          tube(M2, [r0, el, wr], [0.06, 0.045, 0.03], { ring: 10, col: '#9a2a24' });
          for (let j = 0; j < 3; j++) spike(M2, wr, add(wr, [sd * (j - 1) * 0.04, -0.06, 0.15]), 0.015, { col: '#f0e4d0', ring: 5, mat: MAT.SATIN });
        }
        void D; void X; void U;
      },
    }, t),
  },

  // ── fliers
  enemy_sewer_bat: {
    group: 'air', fam: 'wet', note: 'Ribs and membrane: the light behind it comes through the wings red, the ribs dark in them.',
    build: (M, t) => {
      const y = 1.35 + 0.05 * Math.sin(t * 3), flap = 0.3 * Math.sin(t * 9) + 0.1, root = [0, y + 0.02, 0.02];
      sweep(M, [[0, y - 0.06, -0.14], [0, y, -0.04], [0, y + 0.01, 0.06]], (u) => ({ w: 0.04 + 0.03 * Math.sin(Math.PI * u), h: 0.045 + 0.02 * Math.sin(Math.PI * u) }), { ring: 14, col: (u, a, p) => (fnoise(p, 50) > 0.55 ? C('#4a3a30') : C('#6a5444')) });
      mammalHead(M, [0, y + 0.03, 0.05], [0, 0, 1], [0, 1, 0], { size: 0.5, skull: 0.14, muzzle: 0.09, skullW: 1.2, ears: 'round', earLen: 0.15, earW: 1.3, gape: 0.4, iris: '#ff6a2a', eyeGlow: true, eyeR: 0.011, col: '#6a5444', cheek: '#7a6454', nose: '#3a2a26', brow: 0.3, tufts: 0.5, inner: '#c84a4a' }, t);
      for (const sd of [1, -1]) {
        batWing(M, add(root, [sd * 0.035, 0, 0]), sd, 0.42, { flap, col: '#7a4a40', bone: '#2a1a18', memMat: TRANSLUCENT, memShade: '#e04a3a' }, t);
        tube(M, [[sd * 0.03, y - 0.05, -0.12], [sd * 0.05, y - 0.11, -0.16], [sd * 0.05, y - 0.15, -0.14]], [0.01, 0.008, 0.005], { ring: 6, col: '#2a1a18' });
      }
    },
  },
  enemy_ashfall_drifter: {
    group: 'air', fam: 'burn', note: 'Wide and grey on wings burnt through, every hole edged in ember, riding the heat with its crop glowing white-hot.',
    build: (M, t) => {
      const y = 2.0 + 0.08 * Math.sin(t * 0.8), flap = 0.12 * Math.sin(t * 1.4) - 0.05, root = [0, y + 0.04, 0.05];
      sweep(M, [[0, y - 0.05, -0.55], [0, y, -0.25], [0, y + 0.03, 0.1], [0, y + 0.1, 0.32], [0, y + 0.12, 0.48]], (u) => { const [w, h] = keys([[0, [0.02, 0.02]], [0.25, [0.1, 0.09]], [0.5, [0.11, 0.1]], [0.75, [0.05, 0.05]], [1, [0.05, 0.05]]], u); return { w, h }; }, { ring: 16, seg: 6, col: (u, a, p) => (fnoise(p, 14) > 0.6 ? C('#3a3634') : C('#8a8680')) });
      const crop = 1 + 0.08 * Math.sin(t * 2);
      glow(M, [0, y - 0.03, 0.2], [0.075 * crop, 0.085 * crop, 0.075 * crop], '#ffb860', { halo: 1.0, haloR: 3.5, light: 1.4, lightK: 1.3 });
      blob(M, [0, y + 0.13, 0.53], [0.055, 0.05, 0.07], { col: '#7a7670' });
      spike(M, [0, y + 0.12, 0.58], [0, y + 0.08, 0.72], 0.025, { col: '#1e1a18', bend: [0, -0.02, 0] });
      for (const sd of [1, -1]) glow(M, [sd * 0.04, y + 0.15, 0.57], 0.011, '#ffd080', { halo: 0.4, light: 0 });
      const hole = (u, v) => fnoise([u * 3, v * 3, 7], 1.5);
      for (const sd of [1, -1]) batWing(M, add(root, [sd * 0.08, 0, 0]), sd, 1.45, {
        flap, col: '#6a6662', bone: '#3a3634', keep: (u, v) => hole(u, v) < 0.62, ember: (u, v) => hole(u, v) > 0.57, emberCol: '#ff7a20',
        fingers: [[0.98, 0.15, 0.05], [0.9, -0.05, -0.15], [0.75, -0.15, -0.3], [0.55, -0.2, -0.42], [0.35, -0.2, -0.5]],
      }, t);
      for (let i = 0; i < 3; i++) tube(M, [[0, y - 0.04, -0.5], [(i - 1) * 0.08, y - 0.12, -0.75], [(i - 1) * 0.16 + Math.sin(t + i) * 0.05, y - 0.22, -1.05]], [0.012, 0.008, 0.002], { ring: 5, col: (u) => (u > 0.8 ? C('#ff8a30') : C('#5a5650')) });
    },
  },

  // ── machines
  // A machine reads through its job (the jobsite or the animal it's built like) and one light that carries its state.
  enemy_architect_drone: {
    group: 'machine', fam: 'angel', note: 'A hexagonal plate of black glass in six facets with gold light showing only through the seams between them, and one white eye underneath.',
    build: (M, t) => {
      const y = 1.6 + 0.03 * Math.sin(t * 1.7), tilt = 0.06 * Math.sin(t * 0.9);
      // the gold core, seen only through the seams
      tube(M, [[0, y - 0.004, 0], [0, y + 0.004, 0]], [0.12, 0.12], { ring: 6, seg: 1, up: [0, 0, 1], col: '#ffd54a', mat: GLOW });
      M.halos.push({ p: [0, y, 0], r: 0.24, c: C('#ffd54a'), k: 0.12, bone: M.bone });
      M.lights.push({ p: [0, y, 0], c: C('#ffd54a'), r: 0.5, bone: M.bone });
      for (let i = 0; i < 6; i++) {
        const a0 = (i / 6) * Math.PI * 2 + Math.PI / 6, a1 = ((i + 1) / 6) * Math.PI * 2 + Math.PI / 6, gap = 0.009;
        const mid = (a0 + a1) / 2, off = [Math.cos(mid) * gap, 0, Math.sin(mid) * gap];
        const P = (u, v) => { const a = a0 + (a1 - a0) * u, r = 0.165 * v; return add([Math.cos(a) * r, y + 0.02 - 0.012 * v + tilt * Math.cos(a) * r * 3, Math.sin(a) * r], off); };
        sheet(M, P, 4, 3, { col: '#0c0e12', mat: FILM, thick: 0.016, shade: '#1a1430' });
        sheet(M, (u, v) => add(P(u, v), [0, -0.035, 0]), 4, 3, { col: '#08090c', mat: MAT.SATIN, thick: 0.01 });
      }
      glow(M, [0, y - 0.03, 0.0], 0.014, '#f4f8ff', { halo: 0.7, light: 0.4 });
      for (let i = 0; i < 6; i += 2) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6, p = [Math.cos(a) * 0.19, y + 0.005, Math.sin(a) * 0.19];
        tube(M, [add(p, [0, -0.012, 0]), add(p, [0, 0.012, 0])], [0.035, 0.035], { ring: 12, seg: 1, col: '#14161a', mat: MAT.SATIN, cap: false });
        blob(M, add(p, [0, 0.016, 0]), [0.032, 0.002, 0.032], { col: '#2a2c34', mat: FILM, nu: 12, nv: 3 });
      }
    },
  },
  enemy_maint_drone: {
    group: 'machine', fam: 'municipal', note: 'Safety-yellow and squat on four legs with hazard stripes, its amber optic on a turret that tilts to look at you like something curious.',
    build: (M, t) => {
      const yel = '#f2c230', dk = '#2a2c30', y = 0.32;
      // a Tachikoma's curiosity: the turret holds a look, then cocks
      const hold = Math.floor(t * 0.7), tiltA = Math.sin(hold * 2.3) * 0.35, sweepA = Math.sin(hold * 1.7) * 0.7;
      blob(M, [0, y, 0], [0.22, 0.1, 0.28], { e1: 0.35, e2: 0.4, col: (d) => (d[1] < -0.3 ? C(dk) : Math.abs(d[2]) > 0.8 && d[1] > -0.25 ? (Math.floor((d[0] + 1) * 7 + d[1] * 4) % 2 ? C('#141414') : C(yel)) : C(yel)), mat: MAT.SATIN, nu: 22, nv: 12 });
      const D = norm([Math.sin(sweepA), -0.1, Math.cos(sweepA)]), side = norm(cross([0, 1, 0], D)), Ut = norm(add([0, 1, 0], mul(side, Math.sin(tiltA))));
      const tc = [0, y + 0.14, 0.06];
      blob(M, tc, [0.085, 0.055, 0.09], { e1: 0.45, axes: [norm(cross(Ut, D)), Ut, D], col: dk, mat: MAT.METAL });
      tube(M, [madd(tc, D, 0.05), madd(tc, D, 0.13)], [0.04, 0.046], { ring: 16, col: '#3a3c40', mat: MAT.METAL, up: Ut });
      glow(M, madd(tc, D, 0.135), [0.032, 0.032, 0.01], '#ffaa30', { axes: [norm(cross(Ut, D)), Ut, D], halo: 0.8, light: 0.9, lightK: 1.2 });
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const hip = [sx * 0.2, y, sz * 0.2], knee = [sx * 0.34, y + 0.1, sz * 0.3], foot = [sx * 0.36, 0.02, sz * 0.36];
        tube(M, [hip, knee], [0.035, 0.03], { ring: 10, col: yel, mat: MAT.SATIN });
        tube(M, [knee, foot], [0.028, 0.022], { ring: 10, col: dk, mat: MAT.METAL });
        blob(M, knee, [0.044, 0.044, 0.044], { col: dk, mat: MAT.METAL, nu: 10, nv: 6 });
        blob(M, foot, [0.05, 0.02, 0.05], { e1: 0.4, col: '#141414', mat: MAT.SATIN, nu: 12, nv: 6 });
      }
      tube(M, [[0.12, y + 0.08, -0.25], [0.12, y + 0.22, -0.3], [0.02, y + 0.26, -0.3]], [0.012, 0.012, 0.012], { ring: 6, col: '#d83a2a' });
      glow(M, [0.12, y + 0.12, -0.27], 0.012, Math.floor(t * 1.5) % 2 ? '#40ff70' : '#104020', { halo: 0.4, light: 0 });
    },
  },
  enemy_rusted_sweeper: {
    group: 'machine', fam: 'municipal', note: 'A municipal sweeper in faded green enamel with a yellow stripe, rust coming through, on three good wheels and one bad, its amber beacon still turning.',
    build: (M, t) => {
      const rust = (d, p) => (spotAt(p, 0.14, 0.26, 4) ? C('#9a4a22') : d[1] > 0.7 ? C('#5a8e6e') : C('#3e7a5a'));
      blob(M, [0, 0.42, -0.05], [0.38, 0.26, 0.55], { e1: 0.3, e2: 0.35, col: rust, mat: MAT.SATIN, nu: 24, nv: 14 });
      blob(M, [0, 0.72, 0.12], [0.26, 0.1, 0.22], { e1: 0.4, e2: 0.4, col: rust, mat: MAT.SATIN });
      blob(M, [0, 0.44, -0.05], [0.392, 0.035, 0.565], { e1: 0.15, e2: 0.35, col: (d, p) => (spotAt(p, 0.14, 0.26, 4) ? C('#9a4a22') : C('#e8c040')), mat: MAT.SATIN, nu: 24, nv: 4 });
      blob(M, [0, 0.66, 0.36], [0.22, 0.08, 0.02], { col: '#1a2a30', mat: FILM, e1: 0.3, e2: 0.3 });
      const beacon = 0.5 + 0.5 * Math.sin(t * 6);
      glow(M, [0, 0.86, -0.1], [0.045, 0.055, 0.045], mix('#7a3a08', '#ffa020', beacon), { halo: 0.3 + 0.6 * beacon, light: 1.2, lightK: beacon });
      for (const [sx, sz, bad] of [[1, 0.38, 0], [-1, 0.38, 0], [1, -0.42, 0], [-1, -0.42, 1]]) {
        const c = [sx * 0.36, 0.14, sz], ax = bad ? norm([1, 0.25, 0.1]) : [1, 0, 0];
        tube(M, [madd(c, ax, -0.06), madd(c, ax, 0.06)], [0.14, 0.14], { ring: 18, seg: 1, up: [0, 1, 0], col: '#1a1a1a', mat: MAT.SATIN });
        blob(M, madd(c, ax, sx * 0.065), [0.07, 0.07, 0.012], { axes: [[0, 0, 1], [0, 1, 0], mul(ax, sx)], col: '#9a9a9a', mat: MAT.METAL, nu: 12, nv: 4 });
      }
      for (const sd of [1, -1]) {
        const c = [sd * 0.34, 0.05, 0.62], spin = t * 3 * sd;
        tube(M, [add(c, [0, 0.0, 0]), add(c, [0, 0.03, 0])], [0.16, 0.16], { ring: 18, seg: 1, col: '#3a3a3a', mat: MAT.SATIN });
        for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2 + spin, p = add(c, [Math.cos(a) * 0.15, 0.0, Math.sin(a) * 0.15]); spike(M, p, add(p, [Math.cos(a) * 0.03, -0.04, Math.sin(a) * 0.03]), 0.012, { col: '#d8b048', ring: 4 }); }
        tube(M, [[sd * 0.2, 0.3, 0.45], [sd * 0.32, 0.1, 0.6]], [0.025, 0.02], { ring: 8, col: '#4a4a4a', mat: MAT.METAL });
      }
    },
  },
  enemy_wanted_patrol_drone: {
    group: 'machine', fam: 'police', note: 'Fleet white over gunmetal legs, a strobing blue eye, a red and blue bar along its back and a stun lance with a white-hot tip.',
    build: (M, t) => {
      const white = '#d9dee6', gun = '#1e2733', y = 0.36, ph = Math.floor(t * 6) % 4;
      blob(M, [0, y, 0], [0.12, 0.08, 0.26], { e1: 0.4, e2: 0.5, col: (d) => (d[1] < -0.2 ? C(gun) : Math.abs(d[2] + 0.2) < 0.06 ? C('#2a3a6a') : C(white)), mat: MAT.SATIN, nu: 20, nv: 10 });
      blob(M, [0, y + 0.06, 0.3], [0.075, 0.06, 0.08], { e1: 0.5, e2: 0.5, col: white, mat: MAT.SATIN });
      glow(M, [0, y + 0.065, 0.378], [0.036, 0.022, 0.012], ph < 2 ? '#9ad8ff' : '#2e7bff', { halo: ph < 2 ? 0.9 : 0.4, light: 0.6 });
      glow(M, [0.04, y + 0.085, -0.05], [0.025, 0.012, 0.05], ph % 2 ? '#ff2e3a' : '#5a0a10', { halo: ph % 2 ? 0.7 : 0.1, light: ph % 2 ? 0.8 : 0 });
      glow(M, [-0.04, y + 0.085, -0.05], [0.025, 0.012, 0.05], ph % 2 ? '#0a1a5a' : '#2e7bff', { halo: ph % 2 ? 0.1 : 0.7, light: ph % 2 ? 0 : 0.8 });
      tube(M, [[0.09, y + 0.02, 0.25], [0.12, y + 0.0, 0.5], [0.12, y - 0.01, 0.72]], [0.012, 0.01, 0.008], { ring: 8, col: '#4a5260', mat: MAT.METAL });
      glow(M, [0.12, y - 0.01, 0.735], 0.012, '#e8fbff', { halo: 0.9, haloR: 4, light: 0.5 });
      for (let i = 0; i < 3; i++) spike(M, [0.12, y - 0.01, 0.73], [0.12 + (i - 1) * 0.03, y + Math.sin(t * 20 + i) * 0.03, 0.78], 0.003, { col: '#6fd8ff', mat: GLOW, ring: 4 });
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const st = Math.sin(t * 4 + sx + sz * 2) * 0.03, hip = [sx * 0.11, y - 0.02, sz * 0.18], knee = [sx * 0.15, y - 0.12, sz * 0.18 + 0.08], hock = [sx * 0.15, 0.1, sz * 0.18 - 0.04 + st], foot = [sx * 0.15, 0.015, sz * 0.18 + st];
        tube(M, [hip, knee, hock, foot], [0.03, 0.022, 0.016, 0.014], { ring: 10, col: gun, mat: MAT.METAL });
        blob(M, knee, [0.026, 0.026, 0.026], { col: white, mat: MAT.SATIN, nu: 10, nv: 6 });
        blob(M, foot, [0.025, 0.012, 0.032], { col: '#0e1014', mat: MAT.SATIN, nu: 10, nv: 5 });
      }
    },
  },
};
void triCount; void scaleFrom; void smooth; void lerp3; void rot; void tuft; void C;

// ── each recipe in its family's colours ──────────────────────────────────────────────────────────────
// A recipe's family is its own `fam`, or its group's. The family's palette is set on the mesh before the build or the
// gear runs (a piece's own shade or rim still wins), and its stage goes with it to the page.
const GROUP_FAM = { people: 'people', law: 'police', mutant: 'bleed', thorn: 'thorn', four: 'street', crawl: 'chitin', long: 'deep', heap: 'under', air: 'wet', machine: 'municipal' };
for (const rcp of Object.values(BESTIARY)) {
  const fam = rcp.fam || GROUP_FAM[rcp.group] || 'people';
  rcp.fam = fam;
  rcp.stage = FAMILY[fam]?.stage;
  for (const k of ['build', 'gear']) {
    const fn = rcp[k];
    if (fn) rcp[k] = (M, t, o) => { M.pal = { ...palOf(fam), ...(rcp.pal || {}) }; return fn(M, t, o); };
  }
}
