// THE FIGURE: ONE PERSON'S BODY, CLOTHES AND HAIR, BUILT AT A LEVEL OF DETAIL.
//
// One generator for everybody drawn as a person: the close-up figure (`hd`, the Room Stage's people
// and the Figure Lab) and the street's crowd body (`crowd` and `far`, baked by actor3d.js). The
// crowd is the close-up figure's clothes sampled coarsely, so a person seen from the cab has the
// silhouette they have across a room (docs/proposals/hd-figure.md).
//
//   · THE BODY is an anatomical loft on the street figure's 19-bone skeleton: a torso, two arms and
//     two legs, each a vertical loft through measured stations (FIGURE_STATIONS), with the muscles
//     laid on as broad relief (pectorals, scapulae, the abdominals, glutes, the deltoid, biceps and
//     triceps, the knee, the calves). Broad on purpose: a cel shader turns a bump into a band edge,
//     so a lump smaller than a band reads as noise. Hands have fingers; feet are shaped.
//   · THE CLOTHES are separate shells grown off the body. A ring of cloth is the convex hull of the
//     slice under it (cloth spans the spine's groove and the gap between the legs), eased out, then
//     draped top to bottom so it can't follow the body in faster than it falls (a coat hangs from
//     the chest past the waist; a trouser leg runs straight from the thigh). A layer hulls the layer
//     under it, so a coat's skirt goes over the trousers, not through them. Skin a garment covers
//     is dropped, which is also what keeps a bent elbow from poking through a sleeve.
//   · THE HAIR is actor-head.js's shell, which the crowd's head wears too, with cards over it in the
//     close-up: strips rooted on the scalp, combed and hung by style, cut into strands by the shader
//     and alpha-tested, so there's nothing to sort. Each card is lit with the head's volume rather
//     than its own flat face, which keeps the bands on the hair round.
//
// Units are the bake's bind space: metres, Y up, the figure facing +Z with its left hand on +X, and
// every bone's rest rotation identity, so the arms hang straight down. No DOM, no GL: the gate
// (scripts/shapes/figure.mjs) builds every cut and style in Node.

import { headMesh, hairMesh, skullPoint, facePoint, hairlineAt, spline, weightedFace, EYE, NECK, NECK_SCULPT, SCULPT_HEADS, HAIRLINE_SCULPT, FACE, ZC, HAIR_STYLES } from './actor-head.js';
import { formNormals, faceDesigned } from './form-normals.js';

const TAU = Math.PI * 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const se = (v, n) => Math.sign(v) * Math.abs(v) ** (2 / n);
const gx = (d, s) => Math.exp(-((d / s) ** 2));
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ── The skeleton (actor3d.js bakes its clips on it). Every rest rotation is identity. ──────────────
export const FIGURE_BONES = [
  ['pelvis', -1, [0, 0.95, 0]],
  ['spine', 0, [0, 0.10, 0]],
  ['chest', 1, [0, 0.17, 0]],
  ['neck', 2, [0, 0.21, -0.005]],
  ['head', 3, [0, 0.10, 0.01]],
  ['uarmL', 2, [0.195, 0.17, -0.01]],
  ['farmL', 5, [0, -0.29, 0]],
  ['handL', 6, [0, -0.25, 0]],
  ['uarmR', 2, [-0.195, 0.17, -0.01]],
  ['farmR', 8, [0, -0.29, 0]],
  ['handR', 9, [0, -0.25, 0]],
  ['thighL', 0, [0.095, -0.03, 0]],
  ['shinL', 11, [0, -0.43, 0]],
  ['footL', 12, [0, -0.41, 0]],
  ['thighR', 0, [-0.095, -0.03, 0]],
  ['shinR', 14, [0, -0.43, 0]],
  ['footR', 15, [0, -0.41, 0]],
  // The ball of each foot, so the heel can lift while the toes stay down. Last, so no other bone's
  // index moves.
  ['toeL', 13, [0, -0.06, 0.095]],
  ['toeR', 16, [0, -0.06, 0.095]],
];
const B = {};
FIGURE_BONES.forEach((b, i) => { B[b[0]] = i; });

// ── Material slots. The crowd's are actor3d.js ACTOR_MAT's, and keep its numbers. ──────────────────
// 0 skin, 1 the top garment, 2 trousers, 3 shoes and boots, 4 the hair's shell, then the close-up's
// own: 7 the face (atlas), 8 the ears, 9 the neck, 10 a hair card, 11 the collar (the top's colour),
// 12 gear in leather (the belt, a strap, a pouch), 13 knee pads, 14 a cloak or mantle, 15 horn and
// bone (horns, claws, thorns, teeth), 16 salvage (Halcyon-blue goggles), 17 a shirt under a vest.
export const FIG_SLOT = { skin: 0, top: 1, legs: 2, shoes: 3, hair: 4, face: 7, ear: 8, neck: 9, card: 10, collar: 11, gear: 12, pad: 13, cloak: 14, horn: 15, salvage: 16, shirt: 17, eye: 18, lid: 19 };
// What a vertex is, in its aux channel, for the paint (gl/figure-hd.js): which piece of cloth or
// gear, so a sleeve gets a cuff seam and a boot its laces.
export const FIG_PIECE = { torso: 0, sleeve: 1, boot: 2, belt: 3, strap: 4, pouch: 5, pad: 6, trouser: 7, mantle: 8, hood: 9, teeth: 10, goggles: 11, lens: 12, horn: 13, claw: 14, string: 15, cuff: 16 };
// The gear a person can wear, each optional (figureGear picks it off the outfit's rand).
export const FIGURE_GEAR = ['belt', 'strap', 'pouch', 'pads', 'gloves'];

// ── Levels ──────────────────────────────────────────────────────────────────────────────────────────
// `cols` points round each loft and `dy` metres between its rings. `skin` false builds the clothes
// and the hands only (the crowd: there's no skin under a coat to see). `fingers` false makes the
// hands mitts. `hem` folds every open edge of cloth back on itself, which shows as the cloth's
// thickness. `cards` grows hair cards. `head` adds actor-head.js's head at that level.
export const FIGURE_LEVELS = {
  hd: { name: 'hd', cols: { torso: 56, arm: 28, leg: 32, foot: 24, neck: 40 }, dy: { torso: 0.011, arm: 0.012, leg: 0.014, foot: 0.012 }, skin: true, fingers: true, hem: true, cards: true, head: 0 },
  lite: { name: 'lite', cols: { torso: 32, arm: 16, leg: 18, foot: 14, neck: 24 }, dy: { torso: 0.02, arm: 0.022, leg: 0.026, foot: 0.022 }, skin: true, fingers: true, hem: true, cards: true, head: 1 },
  crowd: { name: 'crowd', cols: { torso: 22, arm: 12, leg: 12, foot: 12, neck: 16 }, dy: { torso: 0.03, arm: 0.05, leg: 0.06, foot: 0.036 }, skin: false, fingers: false, hem: false, cards: false, head: -1 },
  far: { name: 'far', cols: { torso: 6, arm: 5, leg: 5, foot: 6, neck: 6 }, dy: { torso: 0.12, arm: 0.2, leg: 0.2, foot: 0.12 }, skin: false, fingers: false, hem: false, cards: false, head: -1, mitt: 'lump' },
};

// ── Cuts ────────────────────────────────────────────────────────────────────────────────────────────
// What a person wears over the trousers and shoes everybody has. `hem` and `neck` are heights;
// `ease` is how far the cloth stands off what's under it; `hug` how much of the body's own shape
// a fitted cloth keeps (0 is the hull); `drape` how fast it may follow the body in, in metres a
// metre fallen; `flare` the extra ease at the hem. The crowd always wears the coat: it's one bake.
export const FIGURE_CUTS = {
  coat: {
    top: { hem: 0.62, neck: 1.455, ease: 0.016, hug: 0, drape: 0.22, flare: 0.024 },
    sleeve: { cuff: 0.872, ease: 0.01, drape: 0.12, open: 0.004 },
    collar: { y0: 1.44, y1: 1.53, ease: 0.013, flare: 0.032, open: 0.038 },
    shoulder: 0.022,
  },
  jacket: {
    top: { hem: 0.85, neck: 1.455, ease: 0.012, hug: 0, drape: 0.3, flare: 0.006 },
    sleeve: { cuff: 0.876, ease: 0.008, drape: 0.15, open: 0.003 },
    collar: { y0: 1.442, y1: 1.51, ease: 0.011, flare: 0.026, open: 0.03 },
    shoulder: 0.02,
  },
  tee: {
    top: { hem: 0.965, neck: 1.452, ease: 0.006, hug: 0.45, drape: 0.6, flare: 0.004 },
    sleeve: { cuff: 1.262, ease: 0.008, drape: 0.3, open: 0.007 },
    collar: { y0: 1.445, y1: 1.458, ease: 0.0035, flare: 0, open: 0 },
    shoulder: 0.008,
  },
  // the cuts below are newer; their order fixes their index (uCut in gl/figure-hd.js), so append only.
  // `rib` is a knitted band at the hem and cuffs, cinched; `front` is how the paint closes the front
  // (buttons, zip, a hoodie's pocket, a vest's V, a tunic's handprint); `mantle` a cape over the
  // shoulders and arms; `hood` a hood down behind the neck; a sleeve or collar `slot` of 'shirt' is the
  // shirt under a vest. `jag` rags a hem.
  hoodie: {
    top: { hem: 0.93, neck: 1.452, ease: 0.014, hug: 0.15, drape: 0.4, flare: 0 },
    sleeve: { cuff: 0.882, ease: 0.012, drape: 0.2, open: 0 },
    collar: { y0: 1.444, y1: 1.462, ease: 0.008, flare: 0.004, open: 0.01 },
    shoulder: 0.01, rib: 0.04, hood: true, front: 'pocket',
  },
  bomber: {
    top: { hem: 0.975, neck: 1.452, ease: 0.024, hug: 0, drape: 0.4, flare: 0 },
    sleeve: { cuff: 0.884, ease: 0.017, drape: 0.25, open: 0 },
    collar: { y0: 1.444, y1: 1.48, ease: 0.011, flare: 0.006, open: 0.012 },
    shoulder: 0.016, rib: 0.045, front: 'zip', quilt: true,
  },
  duster: {
    top: { hem: 0.42, neck: 1.455, ease: 0.018, hug: 0, drape: 0.18, flare: 0.04 },
    sleeve: { cuff: 0.872, ease: 0.012, drape: 0.12, open: 0.006 },
    collar: { y0: 1.44, y1: 1.53, ease: 0.014, flare: 0.04, open: 0.04 },
    shoulder: 0.02, mantle: { top: 1.462, hem: 1.24, ease: 0.02, jag: 0, slot: 'top' }, front: 'buttons', vent: true,
  },
  vest: {
    top: { hem: 0.94, neck: 1.452, ease: 0.008, hug: 0.3, drape: 0.5, flare: 0 },
    sleeve: { cuff: 0.876, ease: 0.008, drape: 0.2, open: 0.003, slot: 'shirt' },
    collar: { y0: 1.444, y1: 1.47, ease: 0.006, flare: 0.006, open: 0.02, slot: 'shirt' },
    shoulder: 0.012, front: 'vest',
  },
  // the Wildblood's (gl/room-people.js dresses an NPC of the order in it): a sleeveless tunic with a
  // ragged hem under a ragged mantle, the arms bare
  tunic: {
    top: { hem: 0.8, neck: 1.452, ease: 0.008, hug: 0.25, drape: 0.4, flare: 0.012, jag: 0.035 },
    sleeve: null, collar: null,
    shoulder: 0, mantle: { top: 1.462, hem: 1.2, ease: 0.016, jag: 0.04, point: 0.1, slot: 'cloak' }, front: 'tunic', wild: true,
  },
  // a suit jacket over a shirt, the shirt's collar showing: nobody rolls it, it's asked for by name
  // (an NPC's flags.figure), and the lapels and tie are the sculpted paint's
  suit: {
    top: { hem: 0.85, neck: 1.455, ease: 0.01, hug: 0.1, drape: 0.3, flare: 0.004 },
    sleeve: { cuff: 0.876, ease: 0.008, drape: 0.15, open: 0.003 },
    collar: { y0: 1.444, y1: 1.475, ease: 0.006, flare: 0.006, open: 0.03, slot: 'shirt' },
    shoulder: 0.014, front: 'suit',
  },
};
// The cuts anybody might wear; the tunic is the Wildblood's dress, not a pick.
export const FIGURE_CIVIL_CUTS = ['coat', 'jacket', 'tee', 'hoodie', 'bomber', 'duster', 'vest'];
export const FIGURE_CUT_NAMES = Object.keys(FIGURE_CUTS);
// the leg's shape kept through the cloth (hug) and let in toward the knee and ankle (drape), so the
// thigh and the calf read in silhouette
const TROUSERS = { waist: 1.005, hem: 0.068, ease: 0.008, hug: 0.38, drape: 0.06, seatDrape: 0.3 };
const SHOE = { ease: 0.01, sole: 0.011, toe: 0.002, heel: 0.006 };
// A boot's shaft over the trousers' foot, so they read as tucked in, and the belt over the outermost
// layer at the waist, which a coat or a jacket is cinched to.
const BOOT = { top: 0.235, foot: 0.078, ease: 0.011 };
const BELT = { top: 1.028, foot: 0.982, ease: 0.0045, cinch: 0.007 };
// Hands a little big, as a comic draws them.
const HAND_K = 1.18;
// A shoe's sole is a rocker: flat on the ground from just behind the ankle to the ball, rising to
// the toe (its spring) and rounding off at the heel. In front of the ankle it's the old crowd
// shoe's curve (an ellipsoid 0.122 long and 0.052 high round z 0.045), because the street's walk
// was tuned on it: a lower toe scrapes through the swing. actor3d.js's root solve pivots on this
// line (figureSole), so a foot rolling off its toes doesn't slide.
const shoeSole = (z) => Math.max(0.004, z > 0.045 ? 0.052 - 0.052 * Math.sqrt(Math.max(0, 1 - ((z - 0.045) / 0.122) ** 2)) : 0.004 + 0.014 * smooth(-0.004, -0.076, z) ** 1.6);
// The sole's line, heel to toe, as [z, y] in bind space down the middle of the shoe.
export function figureSole(n = 17) {
  const z0 = FOOT[0][0] - SHOE.heel + 0.004, z1 = FOOT[FOOT.length - 1][0] + SHOE.toe - 0.004, out = [];
  for (let i = 0; i < n; i++) { const z = z0 + ((z1 - z0) * i) / (n - 1); out.push([z, shoeSole(z)]); }
  return out;
}

// ── The body's stations ─────────────────────────────────────────────────────────────────────────────
// Torso, crown of the chest to the crotch: [y, half-width, front, back, centre z]. Its sections are
// superellipses (TORSO_N), so the chest is a little square.
const TORSO = [
  [1.462, 0.046, 0.034, 0.046, -0.022],
  [1.448, 0.094, 0.052, 0.066, -0.020],
  [1.432, 0.135, 0.066, 0.078, -0.016],
  [1.414, 0.168, 0.080, 0.088, -0.012],
  [1.392, 0.180, 0.094, 0.094, -0.008],
  [1.360, 0.186, 0.106, 0.099, -0.004],
  [1.320, 0.180, 0.110, 0.101, -0.002],
  [1.275, 0.170, 0.109, 0.100, 0.000],
  [1.230, 0.158, 0.104, 0.097, 0.000],
  [1.185, 0.144, 0.099, 0.090, 0.000],
  [1.140, 0.132, 0.095, 0.083, 0.000],
  [1.095, 0.123, 0.092, 0.079, 0.002],
  [1.050, 0.124, 0.093, 0.080, 0.002],
  [1.000, 0.138, 0.096, 0.087, 0.000],
  [0.955, 0.156, 0.097, 0.094, -0.002],
  [0.915, 0.164, 0.095, 0.098, -0.004],
  [0.880, 0.163, 0.091, 0.100, -0.006],
  [0.850, 0.150, 0.082, 0.098, -0.008],
  [0.828, 0.120, 0.060, 0.084, -0.010],
  [0.812, 0.070, 0.030, 0.056, -0.012],
];
const TORSO_CAP = [0, 0.804, -0.014], TORSO_N = [2.35, 2.25];
// An arm, hanging, the left one (the right is its mirror): [y, out, front, back, centre x past the
// shoulder joint, centre z]. The wrist is flat, as it is with the palm toward the thigh.
const ARM_X = 0.195;
const ARM = [
  [1.418, 0.012, 0.014, 0.016, -0.026, -0.010],
  [1.410, 0.034, 0.038, 0.042, -0.016, -0.010],
  [1.396, 0.048, 0.050, 0.054, -0.006, -0.010],
  [1.375, 0.055, 0.054, 0.058, 0.002, -0.010],
  [1.350, 0.055, 0.050, 0.054, 0.002, -0.012],
  [1.335, 0.050, 0.046, 0.050, 0.000, -0.014],
  [1.300, 0.045, 0.045, 0.048, -0.002, -0.014],
  [1.250, 0.042, 0.046, 0.047, -0.003, -0.012],
  [1.200, 0.040, 0.043, 0.044, -0.003, -0.010],
  [1.150, 0.038, 0.038, 0.040, -0.003, -0.010],
  [1.110, 0.037, 0.034, 0.038, -0.002, -0.012],
  [1.080, 0.040, 0.036, 0.036, -0.002, -0.010],
  [1.040, 0.041, 0.037, 0.034, -0.002, -0.006],
  [1.000, 0.038, 0.034, 0.031, -0.002, -0.004],
  [0.950, 0.031, 0.030, 0.027, -0.002, -0.004],
  [0.905, 0.024, 0.027, 0.024, -0.002, -0.004],
  [0.880, 0.020, 0.028, 0.025, -0.002, -0.004],
  [0.858, 0.019, 0.029, 0.026, -0.002, -0.004],
];
// A leg, the left: [y, out, front, back, centre x past the hip joint, centre z]. Open at both ends:
// its top is inside the torso and its foot inside the foot.
const LEG_X = 0.095;
const LEG = [
  [0.975, 0.060, 0.062, 0.070, -0.010, -0.010],
  [0.940, 0.080, 0.080, 0.086, 0.000, -0.006],
  [0.900, 0.086, 0.084, 0.086, 0.004, -0.002],
  [0.850, 0.084, 0.082, 0.082, 0.004, 0.000],
  [0.790, 0.078, 0.078, 0.074, 0.002, 0.002],
  [0.730, 0.072, 0.074, 0.068, 0.000, 0.004],
  [0.670, 0.066, 0.068, 0.062, -0.002, 0.006],
  [0.610, 0.058, 0.060, 0.056, -0.004, 0.006],
  [0.560, 0.051, 0.053, 0.050, -0.006, 0.006],
  [0.515, 0.047, 0.050, 0.046, -0.006, 0.006],
  [0.475, 0.045, 0.046, 0.046, -0.006, 0.004],
  [0.430, 0.047, 0.040, 0.054, -0.006, 0.000],
  [0.380, 0.050, 0.038, 0.060, -0.005, -0.004],
  [0.320, 0.047, 0.036, 0.055, -0.004, -0.006],
  [0.260, 0.041, 0.033, 0.046, -0.003, -0.006],
  [0.200, 0.035, 0.030, 0.037, -0.002, -0.004],
  [0.150, 0.031, 0.029, 0.031, -0.002, -0.002],
  [0.110, 0.031, 0.031, 0.031, -0.002, 0.000],
  [0.085, 0.032, 0.036, 0.033, -0.002, 0.004],
  [0.068, 0.030, 0.040, 0.030, -0.002, 0.008],
];
// A foot, heel to toe along z: [z, half-width, centre y, up, down, centre x past the hip joint].
// The sole is flat at FOOT_SOLE.
const FOOT = [
  [-0.068, 0.012, 0.036, 0.012, 0.012, 0.000],
  [-0.058, 0.026, 0.040, 0.030, 0.030, 0.000],
  [-0.040, 0.031, 0.048, 0.042, 0.040, 0.000],
  [-0.015, 0.032, 0.054, 0.040, 0.046, 0.002],
  [0.015, 0.034, 0.050, 0.034, 0.042, 0.004],
  [0.050, 0.038, 0.040, 0.028, 0.032, 0.006],
  [0.085, 0.043, 0.032, 0.022, 0.024, 0.008],
  [0.115, 0.044, 0.026, 0.018, 0.018, 0.008],
  [0.140, 0.040, 0.022, 0.014, 0.014, 0.006],
  [0.155, 0.031, 0.020, 0.011, 0.010, 0.004],
  [0.165, 0.016, 0.019, 0.007, 0.006, 0.002],
];
const FOOT_SOLE = 0.012;
export const FIGURE_STATIONS = { TORSO, ARM, LEG, FOOT };

// A station table as smooth functions of its first column (actor-head.js spline: monotone, so it
// never overshoots a row).
function table(rows) {
  const asc = rows[0][0] < rows[rows.length - 1][0] ? rows : rows.slice().reverse();
  const fs = [];
  for (let k = 1; k < rows[0].length; k++) fs.push(spline(asc.map((r) => [r[0], r[k]])));
  return { lo: asc[0][0], hi: asc[asc.length - 1][0], at: (y) => fs.map((f) => f(y)) };
}
const T_TORSO = table(TORSO), T_ARM = table(ARM), T_LEG = table(LEG), T_FOOT = table(FOOT);
const T_NECK = table(NECK);

// ── The muscles, as relief along the section's normal ───────────────────────────────────────────────
// `c` is cos φ round the section (out to the side; for a limb, away from the body) and `s` sin φ
// (to the front). Amplitudes in metres.
function torsoRelief(x, y, c, s) {
  const ax = Math.abs(x), F = smooth(0.12, 0.6, s), K = smooth(0.12, 0.6, -s);
  let d = 0;
  // the pectorals: a lobe each side, firmer along its lower edge
  { const py = y - 1.302; d += F * 0.012 * gx(ax - 0.07, 0.058) * gx(py, py > 0 ? 0.055 : 0.028); }
  d -= F * 0.0035 * gx(x, 0.011) * gx(y - 1.29, 0.06);                                    // the sternum
  { const cy = 1.426 + 0.05 * ax, span = smooth(0.012, 0.03, ax) * (1 - smooth(0.13, 0.17, ax));
    d += F * 0.0042 * gx(y - cy, 0.007) * span;                                           // the collarbones
    d -= F * 0.003 * gx(y - cy + 0.022, 0.012) * smooth(0.05, 0.08, ax) * (1 - smooth(0.12, 0.16, ax)); }
  d -= F * 0.006 * gx(x, 0.014) * gx(y - 1.44, 0.01);                                     // the notch
  d += F * 0.0055 * gx(ax - 0.042, 0.03) * smooth(0.94, 0.99, y) * (1 - smooth(1.18, 1.22, y)); // the abdominals
  d -= F * 0.0026 * gx(x, 0.007) * smooth(0.98, 1.03, y) * (1 - smooth(1.2, 1.24, y));
  for (const yi of [1.172, 1.118, 1.066]) d -= F * 0.0017 * gx(y - yi, 0.006) * (1 - smooth(0.05, 0.07, ax));
  d -= F * 0.008 * gx(x, 0.0065) * gx(y - 1.045, 0.008);                                  // the navel
  { // the groin's line from the hip bone in to the crotch, and the hip bone above it
    const ax0 = 0.115, ay0 = 1.0, bx = 0.04, by = 0.885, ux = bx - ax0, uy = by - ay0, L2 = ux * ux + uy * uy;
    const t = clamp01(((ax - ax0) * ux + (y - ay0) * uy) / L2), dist = Math.hypot(ax - ax0 - ux * t, y - ay0 - uy * t);
    d -= F * 0.004 * gx(dist, 0.008);
    d += F * 0.0025 * gx(ax - 0.12, 0.025) * gx(y - 1.005, 0.02);
  }
  d -= K * 0.0055 * gx(x, 0.012) * smooth(0.93, 0.98, y) * (1 - smooth(1.4, 1.44, y));    // the spine
  d += K * 0.005 * gx(ax - 0.032, 0.016) * smooth(0.94, 1.0, y) * (1 - smooth(1.16, 1.24, y)); // the erectors
  d += K * 0.008 * gx(ax - 0.085, 0.045) * gx(y - 1.33, 0.065);                           // the shoulder blades
  d += 0.005 * smooth(0.6, 0.95, Math.abs(c)) * gx(y - 1.22, 0.07);                       // the lats
  d += K * 0.016 * gx(ax - 0.068, 0.058) * gx(y - 0.885, 0.05);                           // the glutes
  d -= K * 0.011 * gx(x, 0.009) * (1 - smooth(0.93, 0.97, y));
  return d;
}
function armRelief(y, c, s) {
  let d = 0;
  d += 0.004 * gx(y - 1.36, 0.04) * smooth(0.2, 0.8, c);                                  // the deltoid's foot
  d += 0.008 * smooth(0.1, 0.7, s) * gx(y - 1.235, 0.055);                                // the biceps
  d += 0.007 * smooth(0.1, 0.7, -s) * gx(y - 1.275, 0.06);                                // the triceps
  d -= 0.004 * smooth(0.3, 0.8, s) * gx(y - 1.108, 0.012);                                // the elbow's crease
  d += 0.004 * smooth(0.4, 0.9, -s) * gx(y - 1.1, 0.014);                                 // and its point
  d += 0.006 * smooth(-0.2, 0.6, (c + s) * 0.7) * gx(y - 1.045, 0.04);                    // the forearm's swell
  d += 0.003 * smooth(0.3, 0.8, -(c + s) * 0.7) * gx(y - 0.885, 0.01);                    // the wrist bone
  return d;
}
function legRelief(y, c, s) {
  let d = 0;
  d += 0.006 * smooth(0.2, 0.9, c) * gx(y - 0.72, 0.09);                                  // the outer thigh
  d += 0.009 * smooth(0.1, 0.8, (-c + s) * 0.7) * gx(y - 0.585, 0.035);                   // the teardrop over the knee
  d += 0.004 * smooth(0.4, 0.9, s) * gx(y - 0.72, 0.1);
  d += 0.008 * smooth(0.6, 0.95, s) * gx(y - 0.515, 0.022);                               // the kneecap
  d -= 0.003 * gx(y - 0.5, 0.025) * gx(Math.abs(s) - 0.55, 0.15) * smooth(0, 0.3, s);
  d -= 0.005 * smooth(0.5, 0.9, -s) * gx(y - 0.495, 0.02);                                // behind the knee
  d += 0.008 * smooth(0, 0.6, -s) * smooth(-0.6, 0.2, -c) * gx(y - 0.37, 0.05);           // the calf, inside
  d += 0.006 * smooth(0, 0.6, -s) * smooth(-0.6, 0.2, c) * gx(y - 0.39, 0.045);           // and outside
  d += 0.002 * smooth(0.85, 1, s) * smooth(0.12, 0.2, y) * (1 - smooth(0.42, 0.46, y));   // the shin bone
  d -= 0.004 * gx(Math.abs(c) - 0.75, 0.15) * smooth(0, 0.5, -s) * gx(y - 0.14, 0.04);    // either side of the heel's tendon
  d += 0.006 * smooth(0.5, 0.9, -c) * gx(y - 0.092, 0.012);                               // the ankle bones
  d += 0.006 * smooth(0.5, 0.9, c) * gx(y - 0.08, 0.012);
  return d;
}

// ── Sections ───────────────────────────────────────────────────────────────────────────────────────
// A part is a vertical loft: `at(y)` gives its section, and `point(y, phi)` a point on it with its
// relief. `side` mirrors a limb (1 left, -1 right), so `c` always means "away from the body".
function torsoSection(y) { const [hw, zf, zb, cz] = T_TORSO.at(y); return { cx: 0, cz, rx: hw, zf, zb, nf: TORSO_N[0], nb: TORSO_N[1] }; }
function limbSection(T, X, side) {
  return (y) => { const [rx, zf, zb, cx, cz] = T.at(y); return { cx: side * (X + cx), cz, rx, zf, zb, nf: 2.05, nb: 2.05 }; };
}
function partPoint(part, y, phi) {
  const S = part.at(y), c = Math.cos(phi), s = Math.sin(phi);
  const n = s >= 0 ? S.nf : S.nb, rz = s >= 0 ? S.zf : S.zb;
  const ex = S.rx * se(c, n), ez = rz * se(s, n);
  // the section's normal, near enough: the gradient of the ellipse through the point
  let nx = ex / (S.rx * S.rx), nz = ez / (rz * rz);
  const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
  const px = S.cx + (part.side ? part.side * ex : ex), pz = S.cz + ez;
  const d = part.relief ? part.relief(px, y, c, s) : 0;
  return [px + (part.side ? part.side * nx : nx) * d, y, pz + nz * d];
}
const PARTS = {
  torso: { name: 'torso', at: torsoSection, lo: T_TORSO.lo, hi: T_TORSO.hi, side: 0, relief: (x, y, c, s) => torsoRelief(x, y, c, s) },
  armL: { name: 'armL', at: limbSection(T_ARM, ARM_X, 1), lo: T_ARM.lo, hi: T_ARM.hi, side: 1, relief: (x, y, c, s) => armRelief(y, c, s) },
  armR: { name: 'armR', at: limbSection(T_ARM, ARM_X, -1), lo: T_ARM.lo, hi: T_ARM.hi, side: -1, relief: (x, y, c, s) => armRelief(y, c, s) },
  legL: { name: 'legL', at: limbSection(T_LEG, LEG_X, 1), lo: T_LEG.lo, hi: T_LEG.hi, side: 1, relief: (x, y, c, s) => legRelief(y, c, s) },
  legR: { name: 'legR', at: limbSection(T_LEG, LEG_X, -1), lo: T_LEG.lo, hi: T_LEG.hi, side: -1, relief: (x, y, c, s) => legRelief(y, c, s) },
};

// The sculpted figure's weight: one scale from 0 to 1 across three bodies, each its own set of
// stations rather than a stretched copy of one. 0 is the ectomorph: narrow shoulders and hips, a flat
// chest, long thin muscle, the ribs and collarbones showing. 0.5 is the mesomorph: broad shoulders and a
// deep chest over a narrow waist, the muscle standing out. 1 is the endomorph: sloping shoulders, the
// weight carried on the belly, hips and thighs, thick upper arms and soft forms. All three share the
// base tables' heights, so a weight between two is the two sections mixed, on the same joints, and every
// clip still plays. y, then the base table's columns.
const SOMA_Y = {
  torso: TORSO.map((r) => r[0]), arm: ARM.map((r) => r[0]), leg: LEG.map((r) => r[0]),
};
const rowsOf = (ys, base, list) => ys.map((y, i) => [y, ...(list[i] || base[i].slice(1))]);
const SOMA_TORSO = {
  ecto: [[0.042, 0.03, 0.04, -0.022], [0.086, 0.044, 0.056, -0.02], [0.122, 0.054, 0.066, -0.016], [0.15, 0.064, 0.072, -0.012], [0.16, 0.074, 0.076, -0.008], [0.162, 0.084, 0.08, -0.004], [0.154, 0.088, 0.082, -0.002],
    [0.143, 0.086, 0.081, 0], [0.132, 0.08, 0.078, 0], [0.122, 0.072, 0.071, 0], [0.116, 0.066, 0.064, 0], [0.114, 0.063, 0.061, 0.002], [0.115, 0.065, 0.063, 0.002], [0.122, 0.072, 0.072, 0],
    [0.13, 0.078, 0.082, -0.002], [0.134, 0.08, 0.087, -0.004], [0.135, 0.078, 0.09, -0.006], [0.127, 0.072, 0.088, -0.008], [0.104, 0.054, 0.076, -0.01], [0.064, 0.028, 0.052, -0.012]],
  meso: [[0.05, 0.036, 0.05, -0.022], [0.106, 0.056, 0.072, -0.02], [0.152, 0.072, 0.086, -0.016], [0.186, 0.088, 0.096, -0.012], [0.198, 0.104, 0.102, -0.008], [0.204, 0.118, 0.106, -0.004], [0.198, 0.124, 0.108, -0.002],
    [0.186, 0.121, 0.106, 0], [0.172, 0.113, 0.101, 0], [0.156, 0.105, 0.093, 0], [0.144, 0.098, 0.086, 0], [0.138, 0.095, 0.082, 0.002], [0.139, 0.095, 0.083, 0.002], [0.145, 0.097, 0.089, 0],
    [0.152, 0.098, 0.096, -0.002], [0.156, 0.096, 0.101, -0.004], [0.156, 0.092, 0.103, -0.006], [0.145, 0.083, 0.1, -0.008], [0.116, 0.061, 0.086, -0.01], [0.068, 0.03, 0.056, -0.012]],
  endo: [[0.056, 0.04, 0.052, -0.022], [0.112, 0.062, 0.076, -0.02], [0.152, 0.082, 0.092, -0.016], [0.178, 0.1, 0.104, -0.012], [0.19, 0.116, 0.112, -0.008], [0.196, 0.132, 0.118, -0.004], [0.196, 0.146, 0.122, -0.002],
    [0.192, 0.154, 0.124, 0], [0.19, 0.162, 0.126, 0], [0.194, 0.176, 0.128, 0], [0.2, 0.194, 0.13, 0], [0.206, 0.208, 0.13, 0.002], [0.21, 0.212, 0.13, 0.002], [0.21, 0.204, 0.13, 0],
    [0.204, 0.176, 0.13, -0.002], [0.194, 0.14, 0.128, -0.004], [0.18, 0.112, 0.124, -0.006], [0.168, 0.094, 0.116, -0.008], [0.13, 0.066, 0.096, -0.01], [0.072, 0.032, 0.06, -0.012]],
};
const SOMA_ARM = {
  ecto: [[0.011, 0.012, 0.014, -0.026, -0.01], [0.03, 0.032, 0.036, -0.016, -0.01], [0.04, 0.041, 0.045, -0.006, -0.01], [0.044, 0.043, 0.047, 0.002, -0.01], [0.042, 0.039, 0.043, 0.002, -0.012], [0.037, 0.035, 0.038, 0, -0.014],
    [0.032, 0.033, 0.035, -0.002, -0.014], [0.03, 0.033, 0.034, -0.003, -0.012], [0.029, 0.031, 0.032, -0.003, -0.01], [0.028, 0.028, 0.029, -0.003, -0.01], [0.029, 0.027, 0.029, -0.002, -0.012], [0.031, 0.028, 0.028, -0.002, -0.01],
    [0.031, 0.028, 0.026, -0.002, -0.006], [0.028, 0.026, 0.024, -0.002, -0.004], [0.024, 0.023, 0.021, -0.002, -0.004], [0.019, 0.021, 0.019, -0.002, -0.004], [0.017, 0.022, 0.02, -0.002, -0.004], [0.017, 0.024, 0.022, -0.002, -0.004]],
  meso: [[0.013, 0.016, 0.018, -0.026, -0.01], [0.039, 0.044, 0.048, -0.016, -0.01], [0.056, 0.058, 0.062, -0.006, -0.01], [0.064, 0.063, 0.067, 0.002, -0.01], [0.064, 0.06, 0.063, 0.002, -0.012], [0.059, 0.056, 0.059, 0, -0.014],
    [0.053, 0.056, 0.056, -0.002, -0.014], [0.05, 0.058, 0.055, -0.003, -0.012], [0.047, 0.053, 0.051, -0.003, -0.01], [0.043, 0.045, 0.046, -0.003, -0.01], [0.042, 0.039, 0.043, -0.002, -0.012], [0.046, 0.043, 0.042, -0.002, -0.01],
    [0.047, 0.044, 0.04, -0.002, -0.006], [0.043, 0.04, 0.036, -0.002, -0.004], [0.034, 0.033, 0.03, -0.002, -0.004], [0.026, 0.029, 0.026, -0.002, -0.004], [0.022, 0.03, 0.027, -0.002, -0.004], [0.021, 0.031, 0.028, -0.002, -0.004]],
  endo: [[0.015, 0.018, 0.02, -0.026, -0.01], [0.042, 0.047, 0.052, -0.016, -0.01], [0.06, 0.062, 0.067, -0.006, -0.01], [0.069, 0.068, 0.073, 0.002, -0.01], [0.071, 0.066, 0.072, 0.002, -0.012], [0.069, 0.063, 0.07, 0, -0.014],
    [0.066, 0.063, 0.07, -0.002, -0.014], [0.063, 0.064, 0.072, -0.003, -0.012], [0.059, 0.06, 0.068, -0.003, -0.01], [0.054, 0.052, 0.058, -0.003, -0.01], [0.05, 0.047, 0.05, -0.002, -0.012], [0.05, 0.047, 0.047, -0.002, -0.01],
    [0.049, 0.046, 0.044, -0.002, -0.006], [0.045, 0.042, 0.04, -0.002, -0.004], [0.037, 0.036, 0.034, -0.002, -0.004], [0.029, 0.031, 0.028, -0.002, -0.004], [0.026, 0.031, 0.028, -0.002, -0.004], [0.024, 0.032, 0.029, -0.002, -0.004]],
};
// [out, front, back]; each leg keeps the base's centre columns, and the rows from the ankle down are the
// base's, so every body stands in the same shoe
const legCols = (list) => list.map((r, i) => [...r, LEG[i][4], LEG[i][5]]);
const SOMA_LEG = {
  ecto: legCols([[0.052, 0.054, 0.062], [0.068, 0.068, 0.074], [0.072, 0.071, 0.074], [0.069, 0.068, 0.068], [0.063, 0.063, 0.06], [0.057, 0.058, 0.054], [0.051, 0.053, 0.048], [0.045, 0.047, 0.044], [0.042, 0.044, 0.042], [0.042, 0.046, 0.042],
    [0.039, 0.041, 0.039], [0.038, 0.034, 0.044], [0.04, 0.032, 0.048], [0.037, 0.03, 0.044], [0.033, 0.028, 0.037], [0.029, 0.026, 0.031], [0.028, 0.027, 0.028]]),
  meso: legCols([[0.066, 0.068, 0.076], [0.088, 0.088, 0.094], [0.094, 0.093, 0.094], [0.093, 0.091, 0.09], [0.087, 0.087, 0.082], [0.08, 0.082, 0.075], [0.073, 0.075, 0.068], [0.063, 0.066, 0.06], [0.054, 0.056, 0.053], [0.049, 0.052, 0.048],
    [0.047, 0.048, 0.049], [0.05, 0.042, 0.059], [0.054, 0.04, 0.066], [0.05, 0.038, 0.06], [0.043, 0.034, 0.049], [0.036, 0.031, 0.039], [0.031, 0.029, 0.031]]),
  endo: legCols([[0.072, 0.078, 0.088], [0.098, 0.102, 0.11], [0.108, 0.108, 0.112], [0.108, 0.106, 0.106], [0.103, 0.102, 0.098], [0.096, 0.097, 0.09], [0.088, 0.09, 0.082], [0.078, 0.08, 0.074], [0.068, 0.071, 0.066], [0.062, 0.066, 0.06],
    [0.059, 0.06, 0.06], [0.06, 0.052, 0.068], [0.062, 0.049, 0.073], [0.058, 0.046, 0.067], [0.05, 0.041, 0.056], [0.042, 0.036, 0.044], [0.034, 0.031, 0.034]]),
};
const SOMA_T = Object.fromEntries(['ecto', 'meso', 'endo'].map((k) => [k, { torso: table(rowsOf(SOMA_Y.torso, TORSO, SOMA_TORSO[k])), arm: table(rowsOf(SOMA_Y.arm, ARM, SOMA_ARM[k])), leg: table(rowsOf(SOMA_Y.leg, LEG, SOMA_LEG[k])) }]));
// What each body does beyond its sections: `muscle` scales the muscles' relief, `fat` and `ribs` add the
// soft folds and the bones; `neck`, `hand` and `bust` scale those; `sh` moves the shoulder's mass;
// `waist` is how much of a build's waist it keeps (none of them pinches it much); `round` is the
// torso's section (2 an ellipse); `thigh` moves the top of the thigh in or out from the hip joint, because
// the legs' tops, not the torso, are what the hips' width is; `abduct` holds the arms off the body.
const SOMA = {
  ecto: { muscle: 0.55, fat: 0, ribs: 1, neck: 0.86, hand: 0.92, bust: 0.55, sh: -0.012, waist: 0.15, round: 2.3, thigh: -0.018, abduct: 0.02 },
  meso: { muscle: 1.7, fat: 0, ribs: 0, neck: 1.16, hand: 1.06, bust: 0.85, sh: 0.006, waist: 0.25, round: 2.35, thigh: -0.012, abduct: 0.1 },
  endo: { muscle: 0.15, fat: 1, ribs: 0, neck: 1.22, hand: 1.1, bust: 1.5, sh: -0.004, waist: 0.45, round: 2.05, thigh: 0.012, abduct: 0.19 },
};
// The numbers for a weight, 0 to 1: ectomorph to mesomorph over the first half, on to endomorph over the second.
export function somaOf(w) {
  const lo = w < 0.5, t = lo ? w * 2 : (w - 0.5) * 2, A = lo ? SOMA.ecto : SOMA.meso, Bb = lo ? SOMA.meso : SOMA.endo, out = { t, A: lo ? 'ecto' : 'meso', B: lo ? 'meso' : 'endo' };
  for (const k of Object.keys(A)) out[k] = A[k] + (Bb[k] - A[k]) * t;
  return out;
}
const mixT = (S, part) => { const a = SOMA_T[S.A][part], b = SOMA_T[S.B][part]; return { lo: a.lo, hi: a.hi, at: (y) => { const p = a.at(y), q = b.at(y); return p.map((v, i) => v + (q[i] - v) * S.t); } }; };
// A weight's parts, before the sculpted figure's own proportions go on.
function somaParts(w) {
  const S = somaOf(w), T = mixT(S, 'torso'), A = mixT(S, 'arm'), L = mixT(S, 'leg'), K = S.muscle;
  const limb = (P, t, X, rel) => ({ ...P, at: limbSection(t, X, P.side), relief: (x, y, c, s) => rel(y, c, s) * K });
  return { S, parts: {
    torso: { ...PARTS.torso, at: (y) => { const [hw, zf, zb, cz] = T.at(y); return { cx: 0, cz, rx: hw, zf, zb, nf: S.round, nb: S.round - 0.1 }; } },
    armL: limb(PARTS.armL, A, ARM_X, armRelief), armR: limb(PARTS.armR, A, ARM_X, armRelief),
    legL: limb(PARTS.legL, L, LEG_X, legRelief), legR: limb(PARTS.legR, L, LEG_X, legRelief),
  } };
}
// The bones an ectomorph shows and the folds an endomorph carries, as relief on the torso.
function somaRelief(S, x, y, c, s) {
  const ax = Math.abs(x), F = smooth(0.12, 0.6, s), Kb = smooth(0.12, 0.6, -s), side = smooth(0.5, 0.9, Math.abs(c));
  let d = 0;
  if (S.ribs > 0) {
    for (let i = 0; i < 5; i++) d += S.ribs * F * 0.003 * gx(y - (1.335 - i * 0.036) + 0.12 * Math.max(0, ax - 0.05), 0.0065) * gx(ax - 0.095, 0.05);
    d += S.ribs * F * 0.0035 * gx(y - 1.426 - 0.05 * ax, 0.006) * smooth(0.012, 0.03, ax) * (1 - smooth(0.13, 0.15, ax));
    d += S.ribs * F * 0.004 * gx(ax - 0.118, 0.016) * gx(y - 1.0, 0.018);
  }
  if (S.fat > 0) {
    d -= S.fat * F * 0.016 * gx(x, 0.17) * gx(y - 0.925, 0.018);            // the fold under the belly
    d += S.fat * F * 0.012 * gx(ax - 0.085, 0.06) * gx(y - 1.255, 0.045);   // the chest, gone soft and low
    d -= S.fat * F * 0.005 * gx(ax - 0.085, 0.08) * gx(y - 1.205, 0.012);   // and the crease under it
    d += S.fat * side * 0.01 * gx(y - 1.02, 0.04);                          // the hips' roll
    d += S.fat * Kb * 0.006 * gx(y - 1.1, 0.03);                            // and across the back
  }
  return d;
}

// Angles round a section spaced by arc length on a reference ellipse rather than evenly, so a wide
// torso doesn't spend its columns on its flanks. Returned as parameters of the superellipse.
function arcPhis(n, rx, rz) {
  const S = 720, acc = [0];
  let prev = [rx, 0];
  for (let i = 1; i <= S; i++) { const a = (i / S) * TAU, p = [rx * Math.cos(a), rz * Math.sin(a)]; acc.push(acc[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1])); prev = p; }
  const L = acc[S], out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const want = (k / n) * L;
    while (acc[j + 1] < want) j++;
    out.push(((j + (want - acc[j]) / (acc[j + 1] - acc[j])) / S) * TAU);
  }
  return out;
}

// ── Mesh assembly ───────────────────────────────────────────────────────────────────────────────────
// A part is its own vertices: P positions, Wt [[bone, weight], …] a vertex, slot, aux (a card's
// seed, an ear's hollow), uv, and its triangles. Parts don't share vertices, so each one's normals
// are its own.
function newPart(name, slot) { return { name, slot, P: [], Wt: [], A: [], UV: [], I: [], covered: [] }; }
function addV(part, p, wt, aux = 0, uv = null) {
  part.P.push(p[0], p[1], p[2]); part.Wt.push(wt); part.A.push(aux); part.UV.push(uv ? uv[0] : 0, uv ? uv[1] : 0);
  return part.P.length / 3 - 1;
}
// rings top to bottom (or heel to toe), each `n` points: (upper k, upper k+1, lower k) winds the
// same way all the way down; `orient` sets the whole part outward afterwards
function stitchRings(part, rings, closed = true) {
  for (let j = 0; j < rings.length - 1; j++) {
    const u = rings[j], l = rings[j + 1], n = u.length;
    for (let k = 0; k < (closed ? n : n - 1); k++) { const k1 = (k + 1) % n; part.I.push(u[k], u[k1], l[k], u[k1], l[k1], l[k]); }
  }
}
function capFan(part, ring, c, top) {
  const n = ring.length;
  for (let k = 0; k < n; k++) { const a = ring[k], b = ring[(k + 1) % n]; if (top) part.I.push(c, b, a); else part.I.push(a, b, c); }
}
// Flip a part whose faces point in: the signed volume about its own centroid is positive outward.
function orient(part) {
  const P = part.P, n = P.length / 3;
  if (!n) return;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += P[i * 3]; cy += P[i * 3 + 1]; cz += P[i * 3 + 2]; }
  cx /= n; cy /= n; cz /= n;
  let vol = 0;
  for (let t = 0; t < part.I.length; t += 3) {
    const a = part.I[t] * 3, b = part.I[t + 1] * 3, c = part.I[t + 2] * 3;
    const ax = P[a] - cx, ay = P[a + 1] - cy, az = P[a + 2] - cz, bx = P[b] - cx, by = P[b + 1] - cy, bz = P[b + 2] - cz, qx = P[c] - cx, qy = P[c + 1] - cy, qz = P[c + 2] - cz;
    vol += ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
  }
  if (vol < 0) for (let t = 0; t < part.I.length; t += 3) { const x = part.I[t + 1]; part.I[t + 1] = part.I[t + 2]; part.I[t + 2] = x; }
}

// ── Weights ─────────────────────────────────────────────────────────────────────────────────────────
// Joints listed top to bottom: within ±h of one, the bone above blends into the one below.
function chain(joints) {
  return (y) => {
    for (const j of joints) {
      if (y >= j.y + j.h) return [[j.a, 1]];
      if (y > j.y - j.h) { const w = smooth(j.y - j.h, j.y + j.h, y); return [[j.a, w], [j.b, 1 - w]]; }
    }
    return [[joints[joints.length - 1].b, 1]];
  };
}
const mixW = (base, bone, k) => (k <= 0 ? base : [...base.map(([b, w]) => [b, w * (1 - k)]), [bone, k]]);
const TORSO_CHAIN = chain([
  { y: 1.43, a: B.neck, b: B.chest, h: 0.025 },
  { y: 1.17, a: B.chest, b: B.spine, h: 0.06 },
  { y: 1.02, a: B.spine, b: B.pelvis, h: 0.05 },
]);
// The torso: the shoulder's corner follows the arm a little and the seat follows each thigh, so a
// raised arm lifts the shoulder and a stride moves the buttock with the leg.
function torsoW(x, y) {
  let w = TORSO_CHAIN(y);
  const ax = Math.abs(x), L = x >= 0;
  w = mixW(w, L ? B.uarmL : B.uarmR, 0.45 * smooth(0.12, 0.19, ax) * smooth(1.3, 1.41, y));
  w = mixW(w, L ? B.thighL : B.thighR, 0.5 * smooth(0.95, 0.83, y) * Math.min(1, ax / 0.04));
  return w;
}
// Below the hips a skirt is split front and back, so each side follows its own thigh; the centre
// line stays with the pelvis, which keeps the two halves joined (actor3d.js's coat).
function skirtW(x, y) {
  if (y > 0.93) return torsoW(x, y);
  const k = smooth(0.93, 0.62, y) * 0.92 * Math.min(1, Math.abs(x) / 0.03);
  return [[B.pelvis, 1 - k], [x >= 0 ? B.thighL : B.thighR, k]];
}
const armW = (L) => chain([
  { y: 1.39, a: B.chest, b: B['uarm' + L], h: 0.03 },
  { y: 1.10, a: B['uarm' + L], b: B['farm' + L], h: 0.045 },
  { y: 0.86, a: B['farm' + L], b: B['hand' + L], h: 0.02 },
]);
const legW = (L) => chain([
  { y: 0.93, a: B.pelvis, b: B['thigh' + L], h: 0.04 },
  { y: 0.49, a: B['thigh' + L], b: B['shin' + L], h: 0.045 },
  { y: 0.095, a: B['shin' + L], b: B['foot' + L], h: 0.02 },
]);
// The foot bends at the ball: behind it rides the foot, in front the toes.
const toeW = (L) => (z) => { const t = smooth(0.072, 0.118, z); return [[B['foot' + L], 1 - t], [B['toe' + L], t]]; };

// ── Rings of a part ─────────────────────────────────────────────────────────────────────────────────
// Ring heights top to bottom, `dy` apart, with a loft's key heights (a shoulder's widest ring)
// kept wherever the even ones miss them, so a coarse level still has the shape's turns.
function ys(top, bot, dy, keys = []) {
  const n = Math.max(1, Math.round((top - bot) / dy)), out = [];
  for (let i = 0; i <= n; i++) out.push(top - ((top - bot) * i) / n);
  for (const k of keys) if (k < top && k > bot && out.every((y) => Math.abs(y - k) > dy / 3)) out.push(k);
  return out.sort((a, b) => b - a);
}
// where the shoulder turns: the torso's corner and the deltoid's round
const SHOULDER_KEYS = { torso: [1.432, 1.414, 1.392], arm: [1.41, 1.396, 1.375, 1.35] };
const _phis = new Map();
function phisFor(kind, n) {
  const key = kind + n;
  if (!_phis.has(key)) _phis.set(key, kind === 'torso' ? arcPhis(n, 0.17, 0.105) : arcPhis(n, 0.05, 0.05));
  return _phis.get(key);
}
// The body's own rings, for building it and for the clothes to hull: `cols` points at each height.
function bodyRing(part, y, phis) { return phis.map((phi) => partPoint(part, y, phi)); }

// ── 2-D hull and rays ───────────────────────────────────────────────────────────────────────────────
function hull2(pts) {
  const p = pts.map((q) => [q[0], q[2]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const crossO = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && crossO(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && crossO(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}
// The farthest crossing of a ray from `o` along `d` with a closed polygon, or 0.
function rayOut(poly, o, d) {
  let best = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0], ez = b[1] - a[1], den = d[0] * ez - d[1] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const ax = a[0] - o[0], az = a[1] - o[1];
    const t = (ax * ez - az * ex) / den, u = (ax * d[1] - az * d[0]) / den;
    if (u >= -1e-9 && u <= 1 + 1e-9 && t > best) best = t;
  }
  return best;
}

// ── Building ────────────────────────────────────────────────────────────────────────────────────────
// The layers a garment hulls: a part's outermost surface so far, as rings you can ask for at any
// height. The body is the first layer of every part.
function bodyLayer(part) {
  const phis = phisFor(part.name === 'torso' ? 'torso' : 'limb', 64);
  return { lo: part.lo, hi: part.hi, ringAt: (y) => (y < part.lo - 1e-9 || y > part.hi + 1e-9 ? null : bodyRing(part, y, phis)) };
}
// A garment's rings as a layer: straight lines between its ring heights, column for column.
function clothLayer(rings) {
  const top = rings[0].y, bot = rings[rings.length - 1].y;
  return {
    lo: bot, hi: top,
    ringAt: (y) => {
      if (y > top + 1e-9 || y < bot - 1e-9) return null;
      let i = 0;
      while (i < rings.length - 2 && rings[i + 1].y > y) i++;
      const a = rings[i], b = rings[i + 1] || a, t = a.y === b.y ? 0 : (a.y - y) / (a.y - b.y);
      return a.pts.map((p, k) => [p[0] + (b.pts[k][0] - p[0]) * t, y, p[2] + (b.pts[k][2] - p[2]) * t]);
    },
  };
}

// A part's layers are a stack, body first; at any height the outermost one there is what's hulled.
function ringOf(layers, q, y) {
  const st = layers[q];
  if (!st) return null;
  for (let i = st.length - 1; i >= 0; i--) { const r = st[i].ringAt(y); if (r) return r; }
  return null;
}

// One piece of cloth round a vertical axis. `wraps(y)` names the parts it covers at that height;
// `centre(y)` is its axis; the rest is the cut's numbers. Returns its rings ({ y, pts }) before any
// hem fold, which is what the layer over it hulls.
function clothRings(layers, spec, level) {
  const { wraps, centre, y0, y1, kind } = spec;
  const cols = level.cols[kind], dy = level.dy[kind];
  const phis = phisFor(kind === 'torso' ? 'torso' : 'limb', cols);
  // a superellipse parameter's direction on the reference shape, as a ray
  const dirs = phis.map((phi) => { const v = kind === 'torso' ? [0.17 * Math.cos(phi), 0.105 * Math.sin(phi)] : [Math.cos(phi), Math.sin(phi)]; const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; });
  const out = [];
  let prev = null;
  for (const y of ys(y0, y1, dy, SHOULDER_KEYS[kind] || [])) {
    const parts = wraps(y), pts = [];
    let under = null;
    for (const q of parts) { const r = ringOf(layers, q, y); if (r) { pts.push(...r); under = under ? null : r; } }
    const o = centre(y), H = hull2(pts.length ? pts : [[o[0] + 0.01, y, o[1]], [o[0], y, o[1] + 0.01], [o[0] - 0.01, y, o[1] - 0.01]]);
    const U = parts.length === 1 && under ? under.map((p) => [p[0], p[2]]) : null;
    const ease = spec.ease(y), hug = spec.hug || 0, hs = [];
    const rs = dirs.map((d) => {
      const h = rayOut(H, o, d);
      const b = U && hug > 0 ? rayOut(U, o, d) : h;
      hs.push(h);
      return h + (b - h) * hug + ease + (spec.easeDir ? spec.easeDir(y, d) : 0);
    });
    if (prev) for (let k = 0; k < rs.length; k++) rs[k] = Math.max(rs[k], prev.rs[k] - spec.drape * (prev.y - y));
    // cinched (a belted coat): no further out than what's under it, whatever the drape wanted
    if (spec.cinch && y <= spec.cinch.top && y >= spec.cinch.foot) for (let k = 0; k < rs.length; k++) rs[k] = Math.min(rs[k], hs[k] + spec.cinch.ease);
    prev = { y, rs };
    out.push({ y, pts: dirs.map((d, k) => [o[0] + d[0] * rs[k], y, o[1] + d[1] * rs[k]]), rs, dirs, o });
  }
  // a hem cut to a point front and back (a mantle): the rings over its last 12 cm drop in the middle
  if (spec.point && out.length > 1) {
    const y1 = out[out.length - 1].y;
    for (const R of out) { const t = smooth(y1 + 0.12, y1, R.y); if (t > 0) R.pts = R.pts.map((p, k) => [p[0], p[1] - spec.point * t * Math.abs(R.dirs[k][1]) ** 1.5, p[2]]); }
  }
  // a ragged hem: the last ring's columns lifted in teeth, every other one high, the rest uneven
  if (spec.jag && out.length > 1) {
    const L = out[out.length - 1], r = rng(0x51ed + cols);
    L.pts = L.pts.map((p, k) => [p[0], p[1] + spec.jag * (k % 2 ? 0.75 + 0.25 * r() : 0.1 * r()), p[2]]);
  }
  return out;
}
// A cloth piece's mesh from its rings: `capTop` closes its top on a point (a sleeve's shoulder),
// `topRing` replaces its first ring (a neckline gathered onto the collar), and the hem folds in.
function clothMesh(rings, spec, level, wf, slot) {
  const part = newPart(spec.name, slot), ax = spec.aux || 0;
  const R = rings.map((r) => r.pts.map((p) => addV(part, p, wf(p[0], p[1], p[2]), ax)));
  if (spec.topRing) {
    const tr = spec.topRing(rings[0]);
    R.unshift(tr.map((p) => addV(part, p, wf(p[0], p[1], p[2]), ax)));
  }
  if (spec.capTop) { const c = spec.capTop(rings[0]); capFan(part, R[0], addV(part, c, wf(c[0], c[1], c[2]), ax), true); }
  if (level.hem) {
    // the hem turned up inside: one ring a little in and a little up, so the edge has a thickness
    const L = rings[rings.length - 1];
    R.push(L.pts.map((p, k) => { const q = [L.o[0] + L.dirs[k][0] * (L.rs[k] - 0.005), L.y + 0.008, L.o[1] + L.dirs[k][1] * (L.rs[k] - 0.005)]; return addV(part, q, wf(q[0], q[1], q[2]), ax); }));
  }
  stitchRings(part, R);
  return part;
}

// The body's own lofts.
function bodyPart(part, level, wf, capTop, capBot) {
  const kind = part.name === 'torso' ? 'torso' : part.name.startsWith('arm') ? 'arm' : 'leg';
  const phis = phisFor(kind === 'torso' ? 'torso' : 'limb', level.cols[kind]);
  const M = newPart(part.name, FIG_SLOT.skin);
  const yy = ys(part.hi, part.lo, level.dy[kind], SHOULDER_KEYS[kind] || []);
  const R = yy.map((y) => phis.map((phi) => { const p = partPoint(part, y, phi); return addV(M, p, wf(p[0], p[1], p[2])); }));
  if (capTop) capFan(M, R[0], addV(M, capTop, wf(...capTop)), true);
  stitchRings(M, R);
  if (capBot) capFan(M, R[R.length - 1], addV(M, capBot, wf(...capBot)), false);
  M.ys = yy;
  return M;
}
// The arm's top is a closed cap, the round of the shoulder: its outer half falls away to the arm
// (actor3d.js's deltoid), so there's no ring standing on the shoulder.
function armCapPoint(side) { return [side * (ARM_X - 0.028), 1.421, -0.01]; }
function deltoidLean(part, k = 0.5) {
  const side = part.side;
  return (p) => [p[0], p[1] - k * smooth(1.383, 1.414, p[1]) * Math.max(0, (p[0] - side * ARM_X) * side), p[2]];
}

// A foot, heel to toe, as rings round z. `grow` stands the surface off by that much and flattens
// its sole on `sole(z)` (a shoe's rocker); a bare foot's sole is flat at FOOT_SOLE.
function footRings(side, cols, dz, grow = 0, sole = () => FOOT_SOLE, ext = [0, 0]) {
  const z0 = FOOT[0][0] - ext[0], z1 = FOOT[FOOT.length - 1][0] + ext[1];
  const n = Math.max(2, Math.round((z1 - z0) / dz)), rings = [];
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n, zz = Math.max(FOOT[0][0], Math.min(FOOT[FOOT.length - 1][0], z));
    const [rx, cy, up, dn, cx] = T_FOOT.at(zz);
    // past the ends the shoe's toe and heel round off
    const k = z < FOOT[0][0] ? 1 - (FOOT[0][0] - z) / (ext[0] + 1e-9) * 0.5 : z > FOOT[FOOT.length - 1][0] ? 1 - (z - FOOT[FOOT.length - 1][0]) / (ext[1] + 1e-9) * 0.55 : 1;
    const ring = [], floor = sole(z);
    // the toe box keeps its height as the sole springs up under it
    const lift = Math.max(0, floor - FOOT_SOLE) * 0.8;
    for (let j = 0; j < cols; j++) {
      const a = (j / cols) * TAU, c = Math.cos(a), s = Math.sin(a);
      const x = side * (LEG_X + cx) + side * ((rx + grow) * k) * se(c, 2.3);
      const y = Math.max(cy + lift + (s >= 0 ? up + grow : dn + grow) * k * se(s, s >= 0 ? 2.2 : grow > 0 ? 1.9 : 3.2), floor);
      ring.push([x, y, z]);
    }
    rings.push({ z, ring });
  }
  return rings;
}
function footMesh(side, level, slot, grow, sole, ext) {
  const L = side > 0 ? 'L' : 'R', w = toeW(L);
  const M = newPart('foot' + L, slot);
  const rings = footRings(side, level.cols.foot, level.dy.foot, grow, sole, ext);
  const R = rings.map(({ ring }) => ring.map((p) => addV(M, p, w(p[2]))));
  const tip = (r) => { const c = r.ring.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map((v) => v / r.ring.length); return addV(M, c, w(c[2])); };
  capFan(M, R[0], tip(rings[0]), true);
  stitchRings(M, R);
  capFan(M, R[R.length - 1], tip(rings[rings.length - 1]), false);
  return M;
}

// A tube along a path of points with a radius each, closed at its tip: a finger or a thumb.
function tubeAlong(M, path, radii, cols, wt, up, flat = 1, aux = 0) {
  const R = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i], q = path[Math.min(path.length - 1, i + 1)], o = path[Math.max(0, i - 1)];
    const T = norm3([q[0] - o[0], q[1] - o[1], q[2] - o[2]]);
    const U = norm3(cross(T, up)), V = cross(U, T), r = radii[i], ring = [];
    for (let j = 0; j < cols; j++) {
      const a = (j / cols) * TAU, c = Math.cos(a), s = Math.sin(a);
      ring.push(addV(M, [p[0] + (U[0] * c * flat + V[0] * s) * r, p[1] + (U[1] * c * flat + V[1] * s) * r, p[2] + (U[2] * c * flat + V[2] * s) * r], wt, aux));
    }
    R.push(ring);
  }
  stitchRings(M, R);
  const last = path[path.length - 1], prevP = path[path.length - 2], T = norm3([last[0] - prevP[0], last[1] - prevP[1], last[2] - prevP[2]]);
  const tip = [last[0] + T[0] * radii[radii.length - 1] * 0.8, last[1] + T[1] * radii[radii.length - 1] * 0.8, last[2] + T[2] * radii[radii.length - 1] * 0.8];
  capFan(M, R[R.length - 1], addV(M, tip, wt, aux), false);
  const first = path[0], T0 = norm3([path[1][0] - first[0], path[1][1] - first[1], path[1][2] - first[2]]);
  capFan(M, R[0], addV(M, [first[0] - T0[0] * radii[0] * 0.6, first[1] - T0[1] * radii[0] * 0.6, first[2] - T0[2] * radii[0] * 0.6], wt, aux), true);
}
// A hand, hanging, palm to the thigh: a palm and, close up, four fingers curled a little and a
// thumb in front; far off a mitt. Rigid on the hand bone.
function handMesh(side, level, k = HAND_K, sculpt = false) {
  const M = sculpt && level.fingers ? handSculpt(side, level) : handBuild(side, level), W = [side * ARM_X, 0.868, -0.004];
  for (let i = 0; i < M.P.length; i += 3) for (let j = 0; j < 3; j++) M.P[i + j] = W[j] + (M.P[i + j] - W[j]) * k;
  M.tips = (M.tips || []).map(({ p, d }) => ({ p: p.map((v, j) => W[j] + (v - W[j]) * k), d }));
  return M;
}
function handBuild(side, level) {
  const L = side > 0 ? 'L' : 'R', wt = [[B['hand' + L], 1]], M = newPart('hand' + L, FIG_SLOT.skin), x = side * ARM_X;
  if (!level.fingers) {
    const nu = level.mitt === 'lump' ? 5 : 10, nv = level.mitt === 'lump' ? 4 : 8;
    ellipsoidInto(M, [x, 0.795, 0.005], [0.026, 0.068, 0.043], nu, nv, wt);
    if (level.mitt !== 'lump') ellipsoidInto(M, [x, 0.83, 0.038], [0.016, 0.03, 0.016], 8, 6, wt);
    return M;
  }
  const cols = level.name === 'hd' ? 12 : 8;
  // the palm: a flat loft from the wrist to the knuckles, broad front to back
  const palm = [];
  const PY = [0.868, 0.85, 0.83, 0.81, 0.79, 0.777];
  for (const y of PY) {
    const t = (0.868 - y) / 0.091, rz = 0.028 + 0.014 * smooth(0, 0.6, t), rx = 0.0135 - 0.002 * t, cz = -0.004 + 0.006 * t, ring = [];
    for (let j = 0; j < cols * 2; j++) {
      const a = (j / (cols * 2)) * TAU, c = Math.cos(a), s = Math.sin(a);
      ring.push(addV(M, [x + rx * se(c, 2.6), y, cz + rz * se(s, 2.6)], wt));
    }
    palm.push(ring);
  }
  capFan(M, palm[0], addV(M, [x, 0.874, -0.004], wt), true);
  stitchRings(M, palm);
  capFan(M, palm[palm.length - 1], addV(M, [x, 0.772, 0.002], wt), false);
  // fingers: index in front, little behind; each curls toward the palm (toward -x on the left)
  const F = [[0.028, 0.072, 0.0085], [0.010, 0.08, 0.0088], [-0.008, 0.074, 0.0082], [-0.025, 0.058, 0.0072]];
  const curl = 0.9, segs = level.name === 'hd' ? 7 : 4;
  for (const [fz, len, r0] of F) {
    const path = [], radii = [];
    let p = [x, 0.786, fz], ang = 0.05;
    for (let i = 0; i <= segs; i++) {
      path.push(p.slice()); radii.push(r0 * (1 - 0.3 * (i / segs)));
      ang += curl / segs;
      p = [p[0] - side * Math.sin(ang) * (len / segs), p[1] - Math.cos(ang) * (len / segs), p[2] + 0.003 * (fz > 0 ? 1 : -1) / segs];
    }
    tubeAlong(M, path, radii, cols, wt, [0, 0, 1], 0.9);
    (M.tips ||= []).push({ p: path[path.length - 1], d: norm3(path[path.length - 1].map((v, j) => v - path[path.length - 2][j])) });
  }
  // the thumb, from the heel of the palm, down and forward, curled in
  {
    const path = [], radii = [];
    let p = [x - side * 0.004, 0.848, 0.026], dir = norm3([-side * 0.25, -0.72, 0.62]);
    const n = segs, len = 0.066;
    for (let i = 0; i <= n; i++) {
      path.push(p.slice()); radii.push(0.0115 * (1 - 0.3 * (i / n)));
      dir = norm3([dir[0] - side * 0.06, dir[1] - 0.04, dir[2] - 0.05]);
      p = [p[0] + dir[0] * (len / n), p[1] + dir[1] * (len / n), p[2] + dir[2] * (len / n)];
    }
    tubeAlong(M, path, radii, cols, wt, [1, 0, 0], 0.85);
    (M.tips ||= []).push({ p: path[path.length - 1], d: norm3(path[path.length - 1].map((v, j) => v - path[path.length - 2][j])) });
  }
  return M;
}
// The sculpted hand: a palm with knuckles and the thumb's muscle, and fingers in three bones each,
// bent at their joints, swelling there and tapering, each its own length. Fewer rings than handBuild's,
// spent at the joints.
function handSculpt(side, level) {
  const L = side > 0 ? 'L' : 'R', wt = [[B['hand' + L], 1]], M = newPart('hand' + L, FIG_SLOT.skin), x = side * ARM_X;
  const cols = level.name === 'hd' ? 7 : 5, pc = level.name === 'hd' ? 14 : 10;
  const F = [
    { z: 0.0255, ph: [0.035, 0.023, 0.018], r: 0.0088, bend: [0.1, 0.34, 0.26] },
    { z: 0.0085, ph: [0.038, 0.026, 0.019], r: 0.0093, bend: [0.14, 0.4, 0.3] },
    { z: -0.0095, ph: [0.035, 0.024, 0.018], r: 0.0087, bend: [0.2, 0.46, 0.32] },
    { z: -0.0265, ph: [0.027, 0.017, 0.015], r: 0.0075, bend: [0.28, 0.52, 0.34] },
  ];
  const knuckleY = (z) => 0.786 + 0.1 * Math.max(0, -z) - 0.05 * Math.max(0, z);
  // the palm, wrist to knuckles: thick at the heel, broad at the knuckles, each knuckle a bump on the back
  const palm = [];
  for (const t of [0, 0.25, 0.5, 0.75, 0.92, 1]) {
    const y0 = 0.868 - 0.082 * t, rz = 0.0265 + 0.0165 * smooth(0, 0.65, t), rx = 0.0155 - 0.003 * t, cz = -0.004 + 0.005 * t, ring = [];
    for (let j = 0; j < pc; j++) {
      const a = (j / pc) * TAU, c = Math.cos(a), s = Math.sin(a), z = cz + rz * se(s, 2.5);
      let px = rx * se(c, 2.5);
      if (c > 0) for (const f of F) px += 0.0026 * smooth(0.7, 1, t) * gx(z - f.z, 0.0065) * c;   // the knuckles
      const y = t > 0.5 ? y0 + (knuckleY(z) - 0.786) * smooth(0.5, 1, t) : y0;
      ring.push(addV(M, [x + side * px, y, z], wt));
    }
    palm.push(ring);
  }
  capFan(M, palm[0], addV(M, [x, 0.873, -0.004], wt), true);
  stitchRings(M, palm);
  capFan(M, palm[palm.length - 1], addV(M, [x, 0.776, 0.002], wt), false);
  // the fingers: down from their knuckles, each bone bent further toward the palm
  for (const f of F) {
    const path = [], radii = [], K = [1, 0.95, 0.97, 0.86, 0.9, 0.78, 0.62];
    let p = [x + side * 0.001, knuckleY(f.z) + 0.006, f.z], ang = 0, i = 0;
    path.push(p.slice()); radii.push(f.r * K[i++]);
    for (let b = 0; b < 3; b++) {
      const half = f.ph[b] / 2;
      ang = f.bend.slice(0, b + 1).reduce((s, v) => s + v, 0);
      for (let h = 0; h < 2; h++) {
        p = [p[0] - side * Math.sin(ang) * half, p[1] - Math.cos(ang) * half, p[2] + 0.0007 * Math.sign(f.z) * (b + 1)];
        path.push(p.slice()); radii.push(f.r * K[i++]);
      }
    }
    tubeAlong(M, path, radii, cols, wt, [0, 0, 1], 0.92);
    (M.tips ||= []).push({ p: path[path.length - 1], d: norm3(path[path.length - 1].map((v, j) => v - path[path.length - 2][j])) });
  }
  // the thumb: its muscle on the heel of the palm, then two bones, set forward of the palm and turned in
  ellipsoidInto(M, [x - side * 0.0065, 0.836, 0.0185], [0.0095, 0.026, 0.015], 8, 6, wt);
  {
    const path = [[x - side * 0.006, 0.844, 0.024]], radii = [0.0125], dirs = [[-0.22, -0.78, 0.58], [-0.3, -0.9, 0.3], [-0.4, -0.9, 0.1]], lens = [0.03, 0.02, 0.018], R = [0.0118, 0.0104, 0.0098, 0.0092, 0.0066], rr = [0, 1, 2, 3, 4];
    let p = path[0], ri = 0;
    dirs.forEach((d0, b) => {
      const d = norm3([d0[0] * side, d0[1], d0[2]]), n = b === 0 ? 1 : 2;
      for (let h = 0; h < n; h++) { p = p.map((v, j) => v + (d[j] * lens[b]) / n); path.push(p.slice()); radii.push(R[rr[ri++]]); }
    });
    tubeAlong(M, path, radii, cols, wt, [1, 0, 0], 0.88);
    (M.tips ||= []).push({ p: path[path.length - 1], d: norm3(path[path.length - 1].map((v, j) => v - path[path.length - 2][j])) });
  }
  return M;
}
// A rounded box round `c` on axes ax, ay, az with half-sizes r, squared by `pw` (2 is an ellipsoid).
function blobInto(M, c, ax, ay, az, r, nu, nv, pw, wt, aux) {
  const sp = (v) => Math.sign(v) * Math.abs(v) ** (2 / pw);
  const at = (th, ph) => {
    const l = [sp(Math.sin(th)) * sp(Math.cos(ph)) * r[0], sp(Math.cos(th)) * r[1], sp(Math.sin(th)) * sp(Math.sin(ph)) * r[2]];
    return [0, 1, 2].map((k) => c[k] + ax[k] * l[0] + ay[k] * l[1] + az[k] * l[2]);
  };
  const top = addV(M, at(0, 0), wt, aux), rings = [];
  for (let j = 1; j < nv; j++) { const ring = []; for (let k = 0; k < nu; k++) ring.push(addV(M, at((j * Math.PI) / nv, (k * TAU) / nu), wt, aux)); rings.push(ring); }
  const bot = addV(M, at(Math.PI, 0), wt, aux);
  capFan(M, rings[0], top, true);
  stitchRings(M, rings);
  capFan(M, rings[rings.length - 1], bot, false);
}
function ellipsoidInto(M, c, r, nu, nv, wt) {
  const top = addV(M, [c[0], c[1] + r[1], c[2]], wt), rings = [];
  for (let j = 1; j < nv; j++) {
    const th = (j * Math.PI) / nv, st = Math.sin(th), ct = Math.cos(th), ring = [];
    for (let k = 0; k < nu; k++) { const ph = (k * TAU) / nu; ring.push(addV(M, [c[0] + r[0] * st * Math.cos(ph), c[1] + r[1] * ct, c[2] + r[2] * st * Math.sin(ph)], wt)); }
    rings.push(ring);
  }
  const bot = addV(M, [c[0], c[1] - r[1], c[2]], wt);
  capFan(M, rings[0], top, true);
  stitchRings(M, rings);
  capFan(M, rings[rings.length - 1], bot, false);
}

// ── The neck's section, for the collar ──────────────────────────────────────────────────────────────
function neckAt(y, k = 1) { const [rx, rz, cz] = T_NECK.at(Math.max(1.425, Math.min(1.6, y))); return { rx: rx * k, rz: rz * k, cz }; }

// ── Hair cards ──────────────────────────────────────────────────────────────────────────────────────
// Roots on the scalp above the hairline, each a strip of `segs` rows combed by style and hung, kept
// off the skull and out of the face. Styles are actor-head.js's: 0 cropped (the shell alone), 1 neat
// and parted, 2 tousled, 3 long, 4 a quiff over cut sides.
const CARD_STYLE = [
  null,
  { n: 80, len: [0.05, 0.068], w: 0.03, segs: 4, lift: 0.12, grav: 0.4 },
  { n: 110, len: [0.045, 0.07], w: 0.032, segs: 4, lift: 0.22, grav: 0.45 },
  { n: 140, len: [0.2, 0.3], w: 0.034, segs: 8, lift: 0.1, grav: 1.0 },
  { n: 60, len: [0.05, 0.085], w: 0.03, segs: 5, lift: 0.4, grav: 0.15 },
];
const SHELL_T = [0.0032, 0.0042, 0.008, 0.007, 0.011];
const HEAD_C = [0, 1.655, ZC - 0.004];
// how far a point is outside the skull (plus the shell), by its radius off the head's axis against
// the skull's on the same ray; above the crown it's measured off the crown's sphere
function skullClear(p, style) {
  const y = p[1];
  if (y >= FACE.top - 0.002) return Math.hypot(p[0], p[1] - HEAD_C[1], p[2] - HEAD_C[2]) - (FACE.top - HEAD_C[1]) - SHELL_T[style];
  if (y < FACE.chin) return 1;
  const ang = Math.atan2(p[2] - ZC, p[0]);
  // the skull's point on this ring nearest that direction, by a few steps of the angle
  let best = 0, bd = Infinity;
  for (let k = 0; k < 24; k++) { const phi = (k / 24) * TAU, q = skullPoint(y, phi), d = Math.abs(Math.atan2(Math.sin(Math.atan2(q[2] - ZC, q[0]) - ang), Math.cos(Math.atan2(q[2] - ZC, q[0]) - ang))); if (d < bd) { bd = d; best = phi; } }
  for (let it = 0; it < 6; it++) for (const dp of [-0.04, 0.04].map((v) => v / (it + 1))) {
    const q = skullPoint(y, best + dp), d = Math.abs(Math.atan2(Math.sin(Math.atan2(q[2] - ZC, q[0]) - ang), Math.cos(Math.atan2(q[2] - ZC, q[0]) - ang)));
    if (d < bd) { bd = d; best += dp; }
  }
  const q = skullPoint(y, best);
  return Math.hypot(p[0], p[2] - ZC) - Math.hypot(q[0], q[2] - ZC) - SHELL_T[style];
}
// the long hair's envelope down the back, actor-head.js's sheet's
const SHEET_RX = spline([[1.38, 0.13], [1.44, 0.122], [1.5, 0.098], [1.58, 0.084], [1.645, 0.082]]);
const SHEET_RZ = spline([[1.38, 0.135], [1.44, 0.13], [1.5, 0.112], [1.58, 0.106], [1.645, 0.108]]);
function scalpNormal(y, phi) {
  const e = 1e-3, a = skullPoint(y, phi - e), b = skullPoint(y, phi + e), c = skullPoint(y + e, phi), d = skullPoint(y - e, phi);
  let n = norm3(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - d[0], c[1] - d[1], c[2] - d[2]]));
  const p = skullPoint(y, phi);
  if (n[0] * (p[0] - HEAD_C[0]) + n[1] * (p[1] - HEAD_C[1]) + n[2] * (p[2] - HEAD_C[2]) < 0) n = n.map((v) => -v);
  return n;
}
function hairCards(style, level) {
  const S = CARD_STYLE[style];
  const M = newPart('cards', FIG_SLOT.card);
  if (!S) return M;
  const r = rng(0x9e37 + style * 7919), n = level.name === 'hd' ? S.n : Math.round(S.n * 0.55);
  const segs = level.name === 'hd' ? S.segs : Math.max(3, S.segs >> 1);
  let tries = 0, made = 0;
  while (made < n && tries++ < n * 30) {
    // a root: a height and an angle round the skull, kept above the hairline
    const phi = r() * TAU, y = 1.55 + r() * (FACE.top - 1.552);
    const root = skullPoint(y, phi);
    const hl = hairlineAt(root[0], root[2]);
    if (y < hl + 0.006) continue;
    if (style === 4 && Math.abs(root[0]) > 0.045 && y < 1.722) continue;   // the quiff's cut sides
    const nS = scalpNormal(y, phi);
    const p0 = [root[0] + nS[0] * SHELL_T[style] * 0.7, root[1] + nS[1] * SHELL_T[style] * 0.7, root[2] + nS[2] * SHELL_T[style] * 0.7];
    // where it's combed to, before gravity
    let comb;
    const ax = root[0], back = root[2] < -0.02;
    if (style === 1) comb = ax > 0.024 ? [1, -0.25, -0.35] : [-1, -0.1, -0.25];
    else if (style === 2) { const a = r() * TAU; comb = [Math.cos(a), 0.2, Math.sin(a)]; }
    else if (style === 3) comb = [Math.sign(ax || 1) * 0.3, -1, root[2] > 0.03 ? 0.0 : -0.25];
    else comb = root[2] > 0 && Math.abs(ax) < 0.045 ? [0, 0.9, -0.5] : [0, -0.6, -0.8];
    if (back && style !== 3 && style !== 4) comb = [comb[0] * 0.4, -0.8, -0.5];
    // into the scalp's plane, then lifted off it by the style
    const dn = comb[0] * nS[0] + comb[1] * nS[1] + comb[2] * nS[2];
    let dir = norm3([comb[0] - nS[0] * dn + nS[0] * S.lift, comb[1] - nS[1] * dn + nS[1] * S.lift, comb[2] - nS[2] * dn + nS[2] * S.lift]);
    let len = S.len[0] + (S.len[1] - S.len[0]) * r();
    if (style === 3) len *= root[2] > 0.03 ? 0.45 : Math.abs(ax) > 0.05 ? 0.8 : 1;   // shorter at the face, longest down the back
    const w = S.w * (0.75 + 0.5 * r()), seed = r();
    const path = [p0];
    let p = p0;
    for (let i = 1; i <= segs; i++) {
      const g = S.grav * (i / segs);
      dir = norm3([dir[0], dir[1] - g * 0.6, dir[2]]);
      let q = [p[0] + dir[0] * (len / segs), p[1] + dir[1] * (len / segs), p[2] + dir[2] * (len / segs)];
      // off the skull
      for (let k = 0; k < 4; k++) {
        const cl = skullClear(q, style) - 0.0015;
        if (cl >= 0) break;
        const out = norm3([q[0] - HEAD_C[0], 0.3 * (q[1] - HEAD_C[1]), q[2] - HEAD_C[2]]);
        q = [q[0] - out[0] * cl, q[1] - out[1] * cl, q[2] - out[2] * cl];
      }
      // long hair stays outside the sheet's envelope below the ears, so it falls over the shoulders
      if (style === 3 && q[1] < 1.645) {
        const zc = ZC - 0.02 * smooth(1.62, 1.44, q[1]), ex = SHEET_RX(q[1]), ez = SHEET_RZ(q[1]);
        const rr = Math.hypot(q[0] / ex, (q[2] - zc) / ez);
        if (rr < 1) { q = [q[0] / rr, q[1], zc + (q[2] - zc) / rr]; }
      }
      // never over the face
      if (q[2] > 0.035 && Math.abs(q[0]) < 0.075 && q[1] < 1.705 && q[1] > 1.5) q[0] = Math.sign(q[0] || ax || 1) * 0.075;
      dir = norm3([q[0] - p[0], q[1] - p[1], q[2] - p[2]]);
      path.push(q); p = q;
    }
    // the strip: its width across the comb, in the scalp's plane, narrowing to the tip. A card
    // whose root corners hang below the hairline (a wide card on a sloping temple) is dropped.
    const mark = { p: M.P.length, w: M.Wt.length, a: M.A.length, uv: M.UV.length, n: (M.N ||= []).length };
    const rows = [];
    let reject = false;
    for (let i = 0; i <= segs; i++) {
      const a = path[i], b = path[Math.min(segs, i + 1)], o = path[Math.max(0, i - 1)];
      const T = norm3([b[0] - o[0], b[1] - o[1], b[2] - o[2]]);
      const out = norm3([a[0] - HEAD_C[0], (a[1] - HEAD_C[1]) * (a[1] < 1.6 ? 0.2 : 1), a[2] - HEAD_C[2]]);
      const Wd = norm3(cross(T, out)), half = (w * (1 - 0.45 * (i / segs))) / 2;
      const corner = (k) => {
        const q = [a[0] + Wd[0] * half * k, a[1] + Wd[1] * half * k, a[2] + Wd[2] * half * k];
        if (i === 0 && q[1] < hairlineAt(q[0], q[2]) + 0.002) reject = true;
        // never over the face, corner by corner
        if (q[2] > 0.035 && Math.abs(q[0]) < 0.075 && q[1] < 1.705 && q[1] > 1.5) q[0] = Math.sign(q[0] || ax || 1) * 0.075;
        return q;
      };
      // the card lights as the head's volume, not as its own flat face
      const nv = norm3([out[0] * 0.7 + nS[0] * 0.3, out[1] * 0.7 + nS[1] * 0.3, out[2] * 0.7 + nS[2] * 0.3]);
      const wt = a[1] > 1.6 ? [[B.head, 1]] : (() => { const k = smooth(1.47, 1.6, a[1]); return [[B.head, k], [B.neck, 1 - k]]; })();
      const v = i / segs;
      rows.push([addV(M, corner(-1), wt, seed, [0, v]), addV(M, corner(1), wt, seed, [1, v])]);
      M.N.push(nv, nv);
    }
    if (reject) { M.P.length = mark.p; M.Wt.length = mark.w; M.A.length = mark.a; M.UV.length = mark.uv; M.N.length = mark.n; continue; }
    for (let i = 0; i < segs; i++) { const [a, b] = rows[i], [c, d] = rows[i + 1]; M.I.push(a, b, c, b, d, c); }
    made++;
  }
  M.cards = made;
  return M;
}

// ── Hair locks (the sculpted figure) ───────────────────────────────────────────────────────────────
// Hair as a few large overlapping masses instead of many strands: solid blades laid over the scalp
// in rows, each a lens in section that swells and comes to a point. They're solid, so they take the
// outline and light like any other form. A point on the skull's ellipsoid is (th, la): th runs from
// the forehead over the crown to the nape, la out to the side. `aux` is 1 plus a seed, which tells
// the shader it's a lock; uv is across and along it.
const LOCK_C = [0, 1.655, ZC], LOCK_R = [0.0775, 0.097, 0.101];
const lockPoint = (th, la, s) => [LOCK_C[0] + s * LOCK_R[0] * Math.sin(la), LOCK_C[1] + s * LOCK_R[1] * Math.cos(la) * Math.sin(th), LOCK_C[2] + s * LOCK_R[2] * Math.cos(la) * Math.cos(th)];
const D2R = Math.PI / 180;
// [th at the root, th at the tip, la at the root, la at the tip, half-width, height off the scalp at
// its fullest, how far its tip lifts]: rows from the nape up, so each overlaps the one behind it.
const LOCK_ROWS = [];
for (const la of [-58, -34, -12, 14, 38, 60]) LOCK_ROWS.push([158, 212, la, la * 0.75, 0.025, 0.05, 0.06]);
for (const la of [-70, 70]) LOCK_ROWS.push([112, 186, la, la * 1.03, 0.022, 0.04, 0.05]);
for (const la of [-62, -42, -22, -2, 18, 38, 58]) LOCK_ROWS.push([100, 172, la, la * 1.1 - 4, 0.024, 0.07, 0.17]);
for (const la of [-72, 72]) LOCK_ROWS.push([44, 128, la, la * 1.04, 0.02, 0.05, 0.05]);
for (const la of [-56, -36, -16, 4, 24, 44, 60]) LOCK_ROWS.push([56, 132, la, la * 1.06 - 8, 0.024, 0.1, 0.2]);
// the front: from a parting on the left, up and across to the right
for (const [la, to, up] of [[34, 62, 0.11], [16, -8, 0.15], [-2, -30, 0.17], [-20, -46, 0.16], [-40, -62, 0.12], [-56, -70, 0.08]]) LOCK_ROWS.push([25, 92, la, to, 0.027, up, 0.24]);
// How each hair style reshapes the rows, or null for a crop, which is the shell alone: [up, tip lift,
// half-width, length, scatter].
const LOCK_STYLE = [null, [0.45, 0.2, 0.92, 1, 0.5], [1.05, 1.25, 0.85, 0.82, 2.2], [0.6, 0.1, 1, 1.12, 0.8], [1, 1, 1, 1, 1]];
function hairLocks(level, style) {
  const M = newPart('locks', FIG_SLOT.hair), r = rng(0x10c5 + style), LS = LOCK_STYLE[style], hd = level.name === 'hd', rows = hd ? 6 : 3, cols = hd ? 6 : 4, wt = [[B.head, 1]];
  if (!LS) return M;
  for (const [t0, t1q, l0, l1, hw0, up0, lift0] of hd ? LOCK_ROWS : LOCK_ROWS.filter((_, i) => i % 2 === 0)) {
    const t1 = t0 + (t1q - t0) * LS[3], hw = hw0 * LS[2], up = up0 * LS[0], lift = lift0 * LS[1] * (1 + (r() - 0.5) * (LS[4] - 1));
    // each lock has finer ones lying beside it, longer and sharper, so the mass breaks into points
    // (not in neat or long hair, which lies flat: there they only cross it)
    for (let v = 0; v < (LS[1] < 0.5 ? 0 : hd ? 2 : 1); v++) {
      const k = 0.5 + 0.2 * r(), a0 = (t0 + 8 + (r() - 0.5) * 18) * D2R, a1 = (t1 + (r() - 0.5) * 26 * LS[4]) * D2R, b0 = (l0 + (r() - 0.5) * 22) * D2R, b1 = (l1 + (r() - 0.5) * 24 * LS[4]) * D2R, sp = [];
      for (let i = 0; i <= rows; i++) { const t = i / rows; sp.push(lockPoint(a0 + (a1 - a0) * t, b0 + (b1 - b0) * t, 1 + 0.02 + up * 1.1 * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.8 * 0.55 + lift * 1.3 * t * t * t)); }
      blade(sp, hw * k * (hd ? 1 : 1.3), r());
    }
    const a0 = (t0 + (r() - 0.5) * 8) * D2R, a1 = (t1 + (r() - 0.5) * 16 * LS[4]) * D2R, b0 = (l0 + (r() - 0.5) * 6) * D2R, b1 = (l1 + (r() - 0.5) * 12 * LS[4]) * D2R, seed = r(), w0 = 0.82 * hw * (hd ? 1 : 1.3) * (0.88 + 0.3 * r());
    const spine = [];
    for (let i = 0; i <= rows; i++) {
      const t = i / rows, s = 1 + 0.012 + up * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.8 * 0.55 + lift * t * t * t;
      spine.push(lockPoint(a0 + (a1 - a0) * t, b0 + (b1 - b0) * t, s));
    }
    blade(spine, w0, seed);
  }
  // short points lying forward over the hairline, so the hair ends in tips and not in the shell's edge;
  // hair that lies flat has the painted hairline alone, because they'd cross it in a pattern
  if (LS[1] >= 0.5) for (let la = -54; la <= 54; la += hd ? 13.5 : 27) {
    const a0 = (66 + 12 * r()) * D2R, a1 = (22 + 11 * r() + Math.abs(la) * 0.22) * D2R, b0 = (la * 0.9) * D2R, b1 = (la + (r() - 0.5) * 9) * D2R, sp = [];
    for (let i = 0; i <= rows; i++) { const t = i / rows; sp.push(lockPoint(a0 + (a1 - a0) * t, b0 + (b1 - b0) * t, 1.022 + 0.02 * Math.sin(Math.PI * t) * LS[0] + 0.012 * t)); }
    blade(sp, 0.0125 * (0.8 + 0.5 * r()) * (hd ? 1 : 1.3), r());
  }
  // long hair: each blade rises from its own root on the crown, runs back over the skull and only then
  // falls to the shoulders, so there's no line where the hanging hair starts; shorter at the face
  if (style === 3) for (let a = -104; a <= 104; a += hd ? 17.33 : 34.67) {
    const side = Math.abs(a) / 104, la = a * 0.72 * D2R, th0 = (84 + 30 * r()) * D2R, th1 = (172 - 22 * side) * D2R;
    const y1 = 1.415 + 0.06 * side ** 3 + 0.03 * r(), over = hd ? 4 : 2, fall = hd ? 5 : 3, spine = [];
    for (let i = 0; i <= over; i++) { const t = i / over; spine.push(lockPoint(th0 + (th1 - th0) * t, la, 1.03 + 0.05 * t)); }
    const e = spine[over];
    for (let i = 1; i <= fall; i++) {
      const t = i / fall, k = 1 + 0.1 * Math.sin(Math.PI * Math.min(1, t * 1.3)) + 0.12 * t;
      spine.push([e[0] * k, e[1] + (y1 - e[1]) * t, ZC - 0.012 + (e[2] - ZC + 0.012) * k]);
    }
    blade(spine, 0.031 * (0.9 + 0.3 * r()), r());
  }
  return M;
  function blade(spine, w0, seed) { lockBlade(M, spine, w0, seed, cols, wt); }
}
// One lock: a flat blade down its spine, fullest a third of the way along, a point at the end.
function lockBlade(M, spine, w0, seed, cols, wt) {
  const rows = spine.length - 1, R = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows, p = spine[i], q = spine[Math.min(rows, i + 1)], o = spine[Math.max(0, i - 1)];
    const T = norm3([q[0] - o[0], q[1] - o[1], q[2] - o[2]]), out = norm3([p[0] - LOCK_C[0], p[1] - LOCK_C[1], p[2] - LOCK_C[2]]);
    const U = norm3(cross(T, out)), V = cross(U, T);
    // fullest a third of the way along, a point at the end
    const w = w0 * (t < 0.3 ? 0.62 + 0.38 * smooth(0, 0.3, t) : Math.max(0.03, (1 - (t - 0.3) / 0.7) ** 0.75)), h = 0.34 * w + 0.0012, ring = [];
    for (let j = 0; j < cols; j++) {
      const a = (j / cols) * TAU, c = Math.cos(a), sn = Math.sin(a);
      ring.push(addV(M, [p[0] + U[0] * c * w + V[0] * sn * h, p[1] + U[1] * c * w + V[1] * sn * h, p[2] + U[2] * c * w + V[2] * sn * h], wt, 1 + seed * 0.9, [Math.abs(c), t]));
    }
    R.push(ring);
  }
  stitchRings(M, R);
  const e = spine[rows], d = norm3(spine[rows].map((v, j) => v - spine[rows - 1][j]));
  capFan(M, R[rows], addV(M, [e[0] + d[0] * 0.006, e[1] + d[1] * 0.006, e[2] + d[2] * 0.006], wt, 1 + seed * 0.9, [0, 1]), false);
  capFan(M, R[0], addV(M, spine[0], wt, 1 + seed * 0.9, [0, 0]), true);
}
// A beard with an outline: locks rooted along the jaw from ear to ear, falling and drawn in to the chin. The
// painted beard under it fills the face. Clear of the mouth, which has to move. At the lite level it's three wide
// locks, one mass with the same outline: a few narrow ones read as daggers.
function beardLocks(level, kind, fs) {
  const M = newPart('beard', FIG_SLOT.hair), r = rng(0xbea2d), long = kind === 'long', hd = level.name === 'hd', rows = hd ? (long ? 6 : 5) : 2, cols = hd ? 5 : 4, wt = [[B.head, 1]];
  for (let a = hd ? 30 : 58; a <= (hd ? 150 : 122); a += hd ? 6.5 : 32) {
    const phi = (a + (r() - 0.5) * 4) * D2R, s = Math.sin(phi), c = Math.cos(phi), y0 = 1.562 - 0.03 * s * s + (r() - 0.5) * 0.008, p = skullPoint(y0, phi, fs);
    const L = (long ? 0.06 + 0.11 * s ** 3 : 0.03 + 0.028 * s * s) * (0.8 + 0.4 * r()), spine = [];
    for (let i = 0; i <= rows; i++) {
      const t = i / rows, inn = 1 - (long ? 0.42 : 0.24) * t;
      spine.push([p[0] * inn, p[1] - L * t, p[2] + s * (0.006 * Math.sin(Math.PI * Math.min(1, t * 1.4)) + 0.01 * t) + 0.002]);
    }
    lockBlade(M, spine, hd ? (long ? 0.0125 : 0.0105) * (0.8 + 0.5 * r()) : long ? 0.03 : 0.034, r(), cols, wt);
  }
  return M;
}

// Real eyes, at the close-up level only: a phone's are painted. Behind each opening, which the skin's shader cuts
// (gl/figure-hd.js), sits a flattened ball, as far back as it has to be never to come through the skin round it, so
// the eye has depth from the side and can turn. Along the opening's top and bottom run the lids, thin strips with real
// thickness that catch the light. A lid's uv is [1 if it moves in a blink, how far it travels].
function eyeParts(fs) {
  const E = fs.startsWith('sculptSoft') ? EYE.soft : EYE.man, rx = E.w + 0.0022, ry = 0.0118, rz = 0.012, wt = [[B.head, 1]];
  const ball = newPart('eyes', FIG_SLOT.eye), lids = newPart('lids', FIG_SLOT.lid);
  for (const side of [1, -1]) {
    const cx = side * E.x, cy = EYE.y;
    let zc = Infinity;
    for (let i = -8; i <= 8; i++) for (let j = -6; j <= 6; j++) {
      const ex = (i / 8) * rx, ey = (j / 6) * ry, q = 1 - (ex / rx) ** 2 - (ey / ry) ** 2;
      if (q > 0) zc = Math.min(zc, facePoint(cx + ex, cy + ey, fs)[2] - rz * Math.sqrt(q) - 0.0007);
    }
    const R = [], rings = 7, cols = 14;
    for (let i = 1; i <= rings; i++) {
      const a = (i / rings) * 1.9, ring = [];
      for (let k = 0; k < cols; k++) { const b = (k / cols) * TAU, x = rx * Math.sin(a) * Math.cos(b), y = ry * Math.sin(a) * Math.sin(b); ring.push(addV(ball, [cx + x, cy + y, zc + rz * Math.cos(a)], wt, 0, [x / ry, y / ry])); }
      R.push(ring);
    }
    stitchRings(ball, R);
    capFan(ball, R[0], addV(ball, [cx, cy, zc + rz], wt, 0, [0, 0]), true);
    for (const up of [true, false]) {
      const n = 12, cols2 = 6, L = [], yOf = (ex, K) => cy + E.tilt * ex + (up ? E.t : -E.b) * K;
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * 2 - 1, ex = t * E.w, K = 1 - t * t, y = yOf(ex, K), p = facePoint(side * (E.x + ex), y, fs), tp = Math.sqrt(K) * 0.85 + 0.15, thick = (up ? 0.0034 : 0.0013) * tp, tall = (up ? 0.0024 : 0.0011) * tp, ring = [];
        const travel = cy + E.tilt * ex - E.b * K + 0.0003 - y;
        for (let k = 0; k < cols2; k++) { const a = (k / cols2) * TAU; ring.push(addV(lids, [side * (E.x + ex), y + tall * Math.sin(a) + (up ? 0.0006 * tp : -0.0003 * tp), p[2] + (up ? 0.0009 : 0.0003) + thick * Math.cos(a)], wt, 0.5 + 0.5 * Math.sin(a), [up ? 1 : 0, travel])); }
        L.push(ring);
      }
      stitchRings(lids, L);
      for (const [ring, top] of [[L[0], true], [L[n], false]]) { const c = [0, 0, 0]; for (const v of ring) for (let j = 0; j < 3; j++) c[j] += lids.P[v * 3 + j] / ring.length; capFan(lids, ring, addV(lids, c, wt, 0.5, [up ? 1 : 0, 0]), top); }
    }
  }
  return [ball, lids];
}

// ── The head (close-up only): actor-head.js's skin and shell, riding the head and neck bones ───────
function headParts(style, lv, sculpt = false, fs = 'comic', neckK = 1) {
  const out = [];
  const H = headMesh(lv, fs), Hs = newPart('head', FIG_SLOT.face);
  for (let i = 0; i < H.P.length / 3; i++) {
    const f = H.F[i], slot = f === 8 ? FIG_SLOT.ear : f === 12 ? FIG_SLOT.neck : FIG_SLOT.face, w = H.W[i];
    // a build's neck, round the neck's own axis
    const nk = f === 12 ? neckK : 1;
    addV(Hs, [H.P[i * 3] * nk, H.P[i * 3 + 1], -0.016 + (H.P[i * 3 + 2] + 0.016) * nk], w >= 1 ? [[B.head, 1]] : [[B.head, w], [B.neck, 1 - w]], f === 8 ? H.X[i] : H.E[i]);
    (Hs.S ||= []).push(slot);
  }
  Hs.I = Array.from(H.I);
  Hs.N = []; for (let i = 0; i < H.N.length / 3; i++) Hs.N.push([H.N[i * 3], H.N[i * 3 + 1], H.N[i * 3 + 2]]);
  out.push(Hs);
  const Y = hairMesh(style, lv, sculpt), Ys = newPart('hair', FIG_SLOT.hair);
  for (let i = 0; i < Y.P.length / 3; i++) { const w = Y.W[i]; addV(Ys, [Y.P[i * 3], Y.P[i * 3 + 1], Y.P[i * 3 + 2]], w >= 1 ? [[B.head, 1]] : [[B.head, w], [B.neck, 1 - w]]); }
  Ys.I = Array.from(Y.I);
  Ys.N = []; for (let i = 0; i < Y.N.length / 3; i++) Ys.N.push([Y.N[i * 3], Y.N[i * 3 + 1], Y.N[i * 3 + 2]]);
  out.push(Ys);
  return out;
}

// A bandolier from the left shoulder across the chest to the right hip and round the back: a band on
// a slanted plane through the outermost layer, laid over the top of the shoulder where the plane
// runs above it.
const norm2 = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
function strapMesh(layers, Lv) {
  const cols = Lv.cols.torso, M = newPart('strap', FIG_SLOT.gear);
  const dirs = phisFor('torso', cols).map((phi) => norm2([0.17 * Math.cos(phi), 0.105 * Math.sin(phi)]));
  const onLayer = (y, d) => {
    const pts = ringOf(layers, 'torso', y), o = [0, torsoSection(Math.max(T_TORSO.lo, Math.min(T_TORSO.hi, y))).cz];
    const r = pts ? rayOut(hull2(pts), o, d) : 0.12;
    return [o[0] + d[0] * (r + 0.007), y, o[1] + d[1] * (r + 0.007)];
  };
  const R = [0.023, -0.023].map((e) => dirs.map((d) => {
    let p = onLayer(1.2, d);
    for (let it = 0; it < 2; it++) p = onLayer(Math.min(1.425 + e * 0.3, 1.24 + 1.9 * p[0] + e), d);
    return addV(M, p, torsoW(p[0], p[1]), FIG_PIECE.strap);
  }));
  stitchRings(M, R);
  return M;
}

// ── The Wildblood's changes (docs/lore-wildblood.md: a Gift asked for, a Lesson not) ─────────────
// `body` is { mighty: 'L' | 'R' | '', thorn, horns, claws, teeth, goggles }: one arm thicker and its hand
// bigger, thorns down the right forearm, horns from the brow, claws on the fingers, a necklace of
// teeth, and salvaged goggles up on the brow (Halcyon blue only ever appears on them as salvage).
const MIGHTY_K = 1.28;
// The sculpted figure's builds, all on the same joints, so every clip still plays. A build is who the
// body is; how heavy it is is its weight (SOMA above), and the two multiply. Widths are multiples at
// the chest, waist and hips; `belly` and `bust` are metres of relief on the front; `arm`, `leg` and
// `neck` scale those sections; `sh` moves the shoulder's mass out or in. `hunch` and `abduct` are
// radians of stance, which gl/room-people.js lays on the posed bones: the back bowed, and the arms
// held off a wide body so the hands clear the hips.
export const SCULPT_BUILDS = {
  average: { chest: 1, waist: 1, hips: 1, arm: 1, leg: 1, neck: 1 },
  older: { chest: 0.94, waist: 1.02, hips: 0.98, belly: 0.02, arm: 0.86, leg: 0.88, neck: 0.92, hunch: 0.14 },
  hunched: { chest: 0.97, waist: 1, hips: 1, arm: 0.96, leg: 0.97, neck: 0.98, hunch: 0.24 },
  woman: { chest: 0.87, waist: 0.8, hips: 1.14, bust: 0.026, arm: 0.88, leg: 0.97, neck: 0.82, sh: -0.02 },
};
const buildOf = (name) => SCULPT_BUILDS[name] || SCULPT_BUILDS.average;
// What a man has on his face. `stubble` is the painted shadow's strength. `shape` turns on the solid painted
// areas in gl/figure-hd.js: [cheeks, chin, moustache, sideburns], and `more` [soul patch, jaw strap, the
// bars joining moustache to chin]. `mesh` adds locks along the jaw, so a beard shows in the outline.
export const FIGURE_FACIAL = {
  clean: {},
  stubble: { stubble: 0.8 },
  shadow: { stubble: 1.3 },
  moustache: { stubble: 0.2, shape: [0, 0, 1, 0] },
  goatee: { stubble: 0.2, shape: [0, 1, 1, 0], more: [0, 0, 1] },
  vandyke: { stubble: 0.2, shape: [0, 1, 1, 0] },
  soulpatch: { stubble: 0.2, more: [1, 0, 0] },
  chinstrap: { stubble: 0.2, shape: [0, 0, 0, 1], more: [0, 1, 0] },
  sideburns: { stubble: 0.2, shape: [0, 0, 0, 1] },
  trimmed: { stubble: 0.5, shape: [1, 1, 1, 1], more: [0, 0, 1] },
  full: { stubble: 0.5, shape: [1, 1, 1, 1], more: [0, 0, 1], mesh: 'full' },
  long: { stubble: 0.5, shape: [1, 1, 1, 1], more: [0, 0, 1], mesh: 'long' },
};
function partsFor(body, sculpt = false, build = 'average', weight = null) {
  let out = PARTS;
  if (sculpt) {
    const Bd = buildOf(build), W = weight === null ? null : somaParts(weight), S = W?.S, PS = W?.parts || PARTS;
    const waistK = 1 + (Bd.waist - 1) * (S ? S.waist : 1), bustK = S ? S.bust : 1;
    const widthK = spline([[0.8, Bd.hips], [0.93, Bd.hips], [1.12, waistK], [1.33, Bd.chest], [1.46, 1 + (Bd.chest - 1) * 0.5]]);
    // the sculpted figure's proportions, on the same joints: the shoulder and upper arm slimmed, so the
    // shoulders slope into the arm instead of standing out past it
    const arm = (P) => ({ ...P, at: (y) => { const S = P.at(y), k = 1 - 0.17 * smooth(1.16, 1.34, y); return { ...S, rx: S.rx * k * Bd.arm, zf: S.zf * (1 - 0.08 * smooth(1.16, 1.34, y)) * Bd.arm, zb: S.zb * (1 - 0.08 * smooth(1.16, 1.34, y)) * Bd.arm, cx: S.cx - P.side * (0.012 - (Bd.sh || 0) - (W?.S.sh || 0)) * smooth(1.2, 1.38, y) }; } });
    const leg = (P) => ({ ...P, at: (y) => { const S = P.at(y), k = 1 + 0.05 * gx(y - 0.37, 0.07) - 0.05 * gx(y - 0.49, 0.03) - 0.04 * gx(y - 0.17, 0.05), q = k * (1 + (Bd.leg - 1) * smooth(0.12, 0.42, y)); return { ...S, rx: S.rx * q, zf: S.zf * q, zb: S.zb * q, cx: S.cx + P.side * (W?.S.thigh || 0) * smooth(0.45, 0.85, y) }; } });
    const torso = { ...PS.torso,
      // only the chest is held in under the arms: an endomorph's belly goes out past them
      at: (y) => { const S = PS.torso.at(y), k = widthK(y), d = Math.sqrt(k), rx = S.rx * (1 - 0.055 * gx(y - 1.4, 0.05)) * k; return { ...S, rx: y > 1.3 || !W ? Math.min(rx, 0.205) : rx, zf: S.zf * d, zb: S.zb * d }; },
      relief: (x, y, c, s) => { const F = smooth(0.12, 0.6, s), ax = Math.abs(x); return torsoRelief(x, y, c, s) * (S ? S.muscle : 1) + (S ? somaRelief(S, x, y, c, s) : 0) + F * ((Bd.belly || 0) * gx(x, 0.13) * gx(y - 1.09, 0.1) + (Bd.bust || 0) * bustK * gx(ax - 0.07, 0.05) * gx(y - 1.285, 0.048)); } };
    out = { ...PARTS, torso, armL: arm(PS.armL), armR: arm(PS.armR), legL: leg(PS.legL), legR: leg(PS.legR) };
  }
  if (!body?.mighty) return out;
  const k = 'arm' + body.mighty, P = out[k];
  return { ...out, [k]: { ...P, at: (y) => { const S = P.at(y); return { ...S, rx: S.rx * MIGHTY_K, zf: S.zf * MIGHTY_K, zb: S.zb * MIGHTY_K }; } } };
}
// A cut as the sculpted figure wears it: closer to the body, the shoulder following the arm instead
// of padding it, and rings spent where the silhouette turns rather than evenly.
function sculptCut(C, fat = 0) {
  const fit = C.top.hug > 0 ? fat : 0;
  const top = { ...C.top, ease: Math.min(C.top.ease, 0.013), hug: C.top.hug + (0.85 - C.top.hug) * fit, drape: C.top.drape + 1.4 * fit }, sleeve = C.sleeve && { ...C.sleeve, ease: Math.min(C.sleeve.ease, 0.01) };
  const collar = C.collar && { ...C.collar, y1: C.collar.y1 > 1.475 ? 1.505 : C.collar.y1, flare: Math.min(C.collar.flare, 0.008), open: Math.max(C.collar.open, 0.014) };
  return { ...C, top, sleeve, collar, shoulder: Math.min(C.shoulder || 0, 0.004) };
}
const BODY_LETTER = { mighty: 'm', thorn: 't', horns: 'h', claws: 'c', teeth: 'n', goggles: 'g' };
const bodyCode = (b) => (b ? Object.entries(BODY_LETTER).map(([k, c]) => (k === 'mighty' ? (b.mighty ? c + b.mighty : '') : b[k] ? c : '')).join('') : '');
function thornMesh(PT, Lv) {
  const M = newPart('thorns', FIG_SLOT.horn), P = PT.armR, rr = rng(0x7a0);
  for (let i = 0; i < 8; i++) {
    const y = 0.93 + i * 0.021 + 0.006 * rr(), phi = Math.PI * (1.05 + 0.55 * rr()), S = P.at(y), p = partPoint(P, y, phi);
    const n = norm3([p[0] - S.cx, 0, p[2] - S.cz]), len = 0.02 + 0.016 * rr(), down = [0, -1, 0];
    const path = [[p[0] - n[0] * 0.004, y, p[2] - n[2] * 0.004], [p[0] + n[0] * len * 0.5, y - len * 0.1, p[2] + n[2] * len * 0.5], [p[0] + n[0] * len + down[0], y - len * 0.35, p[2] + n[2] * len]];
    tubeAlong(M, path, [0.0065, 0.0035, 0.0004], Lv.name === 'hd' ? 6 : 4, [[B.farmR, 1]], [0, 1, 0], 1, FIG_PIECE.horn);
  }
  return M;
}
function clawMesh(hand, side, Lv) {
  const M = newPart('claws' + (side > 0 ? 'L' : 'R'), FIG_SLOT.horn), wt = [[B['hand' + (side > 0 ? 'L' : 'R')], 1]];
  for (const { p, d } of hand.tips || []) {
    const a = [p[0] - d[0] * 0.004, p[1] - d[1] * 0.004, p[2] - d[2] * 0.004], b = [p[0] + d[0] * 0.008 - side * 0.002, p[1] + d[1] * 0.008, p[2] + d[2] * 0.008], c = [p[0] + d[0] * 0.018 - side * 0.006, p[1] + d[1] * 0.018, p[2] + d[2] * 0.018];
    tubeAlong(M, [a, b, c], [0.0058, 0.0042, 0.0003], 6, wt, [0, 0, 1], 0.8, FIG_PIECE.claw);
  }
  return M;
}
// On the head, in its bind space: rigid on the head bone.
function hornMesh(Lv) {
  const M = newPart('horns', FIG_SLOT.horn), wt = [[B.head, 1]];
  for (const sd of [1, -1]) {
    const path = [], radii = [];
    let p = [sd * 0.04, 1.712, 0.062], d = norm3([sd * 0.25, 0.78, -0.2]);
    for (let i = 0; i <= 6; i++) { path.push(p.slice()); radii.push(0.012 * (1 - i / 6.6)); d = norm3([d[0] + sd * 0.02, d[1] - 0.06, d[2] - 0.18]); p = p.map((v, j) => v + d[j] * 0.013); }
    tubeAlong(M, path, radii, Lv.name === 'hd' ? 8 : 5, wt, [1, 0, 0], 1, FIG_PIECE.horn);
  }
  return M;
}
function gogglesMesh(Lv) {
  const M = newPart('goggles', FIG_SLOT.salvage), wt = [[B.head, 1]], cols = Lv.name === 'hd' ? 32 : 18;
  // the strap round the head over the hair, and two lenses on the brow
  const R = [0.007, -0.007].map((e) => {
    const ring = [];
    for (let k = 0; k < cols; k++) {
      const phi = (k / cols) * TAU, q = skullPoint(1.706 + e, phi, 'comic'), n = norm3([q[0], 0, q[2] - ZC]);
      ring.push(addV(M, [q[0] + n[0] * 0.013, q[1], q[2] + n[2] * 0.013], wt, FIG_PIECE.goggles));
    }
    return ring;
  });
  stitchRings(M, R);
  for (const sd of [1, -1]) {
    const q = skullPoint(1.703, Math.PI / 2 - sd * 0.42, 'comic'), z0 = q[2] + 0.01;
    tubeAlong(M, [[sd * 0.032, 1.703, z0], [sd * 0.032, 1.703, z0 + 0.007], [sd * 0.032, 1.703, z0 + 0.014]], [0.017, 0.0175, 0.016], 14, wt, [1, 0, 0], 1, FIG_PIECE.lens);
  }
  return M;
}
// A necklace of teeth at the collarbones, each a little cone hanging point down.
function teethMesh(Lv, layers) {
  const M = newPart('teeth', FIG_SLOT.horn), n = 13, rr = rng(0x7e7);
  // on whatever is outermost there (a mantle, a tunic), each tooth's root on the cord and its point
  // lying down the cloth below it
  const on = (y, d, e) => { const pts = ringOf(layers, 'torso', y), o = [0, torsoSection(Math.min(T_TORSO.hi, y)).cz], r = pts ? rayOut(hull2(pts), o, d) : 0.08; return [o[0] + d[0] * (r + e), y, o[1] + d[1] * (r + e)]; };
  for (let i = 0; i < n; i++) {
    const a = Math.PI / 2 + ((i - (n - 1) / 2) / (n - 1)) * 1.9, d = [Math.cos(a), Math.sin(a)], len = 0.018 + 0.01 * rr();
    const y0 = 1.438 - 0.03 * Math.abs(Math.sin(a)) ** 3;
    tubeAlong(M, [on(y0, d, 0.003), on(y0 - len * 0.55, d, 0.006), on(y0 - len, d, 0.005)], [0.0045, 0.0032, 0.0003], 5, TORSO_CHAIN(1.43), [1, 0, 0], 1, FIG_PIECE.teeth);
  }
  return M;
}

// ── The whole figure ────────────────────────────────────────────────────────────────────────────────
// `cut` is a FIGURE_CUTS name, `style` a hair style, `level` a FIGURE_LEVELS name. `wear` switches
// layers off for the lab ({ top, legs, shoes } false), which leaves the skin under them.
//
// Returns { P, N, UV, B (4 bone indices a vertex), W (4 weights), S (slot), A (aux), I, parts, cards }
// where `parts` is [{ name, slot, start, count }] over I (triangles as index ranges), and `cards` is
// the range of I that is hair cards, which the ink skips. Indices are UNSIGNED_SHORT.
const _cache = new Map();
// The key a built figure is kept under, for a renderer that keeps meshes per figure too.
// `gear` is which of FIGURE_GEAR they wear; the belt is on unless it says otherwise, and the gloves are
// paint, so they aren't in the mesh's key.
const GEAR_LETTER = { belt: 'b', strap: 's', pouch: 'p', pads: 'k' };
const gearCode = (g) => Object.entries(GEAR_LETTER).map(([k, c]) => ((k === 'belt' ? g?.belt !== false : !!g?.[k]) ? c : '')).join('');
// `sculpt` is the revised figure (docs/proposals/sculpted-figure.md), on the close-up levels only.
export const figureKey = ({ cut = 'coat', style = 0, level = 'hd', wear = null, gear = null, body = null, sculpt = false, head = 0, build = 'average', weight = null, beard = '' } = {}) => `${cut}|${style}|${level}|${wear ? JSON.stringify(wear) : ''}|${gearCode(gear)}|${bodyCode(body)}${sculpt ? '|s' + head + build + (weight === null ? '' : '|w' + weight) + (beard ? '|b' + beard : '') : ''}`;
const SCULPT_DY = { hd: { torso: 0.018, arm: 0.02, leg: 0.024, foot: 0.016 }, lite: { torso: 0.023, arm: 0.025, leg: 0.03, foot: 0.024 } };
export function buildFigure({ cut = 'coat', style = 0, level = 'hd', wear = null, gear = null, body = null, sculpt: sculptAsked = false, head = 0, build = 'average', weight = null, beard = '' } = {}) {
  const key = figureKey({ cut, style, level, wear, gear, body, sculpt: sculptAsked, head, build, weight, beard });
  if (_cache.has(key)) return _cache.get(key);
  const sculpt = sculptAsked && FIGURE_LEVELS[level].skin, BK = sculpt ? buildOf(build) : SCULPT_BUILDS.average, SW = sculpt && weight !== null ? somaOf(weight) : null, NKb = BK.neck * (SW ? SW.neck : 1), NK = sculpt ? NECK_SCULPT * NKb : 1, FS = sculpt ? weightedFace(SCULPT_HEADS[head] || 'sculpt', weight) : 'comic';
  const Lv = sculpt ? { ...FIGURE_LEVELS[level], dy: SCULPT_DY[level] } : FIGURE_LEVELS[level];
  const C0 = FIGURE_CUTS[cut] || FIGURE_CUTS.coat, C = sculpt ? sculptCut(C0, SW ? SW.fat : 0) : C0, code = gearCode(gear);
  const G = { belt: code.includes('b'), strap: code.includes('s') && Lv.skin, pouch: code.includes('p') && Lv.skin, pads: code.includes('k') && Lv.skin };
  const on = { top: true, legs: true, shoes: true, ...(wear || {}) };
  const TR = sculpt ? { ...TROUSERS, hug: 0.6, ease: 0.006, seatDrape: 3, seatFoot: 0.85 } : TROUSERS;
  // the street's levels have no sculpted head or paint, but they can take its body, for actor3d.js's body offsets
  const shaped = sculptAsked && !sculpt && weight !== null, PT = partsFor(body, sculpt || shaped, build, weight), BD = Lv.skin ? body || {} : {};
  const slotOf = (name, dflt) => (name === 'shirt' ? FIG_SLOT.shirt : name === 'cloak' ? FIG_SLOT.cloak : dflt);
  const parts = [];
  const layers = {}, cover = {};
  for (const k of Object.keys(PT)) layers[k] = [bodyLayer(PT[k])];
  const cov = (name, lo, hi) => { (cover[name] ||= []).push([lo, hi]); };
  const skirt = on.top && C.top.hem < 0.81;

  // trousers first, so whatever goes over them hulls them
  if (on.legs) {
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R', P = PT['leg' + L];
      // a leg's cloth is hidden above a coat's hem, so it starts just above it
      const top = skirt ? Math.min(P.hi, C.top.hem + 0.03) : P.hi;
      const spec = { name: 'trouser' + L, kind: 'leg', aux: FIG_PIECE.trouser, y0: top, y1: TROUSERS.hem, wraps: () => ['leg' + L], centre: (y) => { const S = P.at(y); return [S.cx, S.cz]; }, ease: () => TR.ease, hug: TR.hug, drape: TR.drape };
      const rings = clothRings(layers, spec, Lv);
      const part = clothMesh(rings, spec, Lv, (x, y) => legW(L)(y), FIG_SLOT.legs);
      parts.push(part);
      layers['leg' + L].push(clothLayer(rings));
      cov('leg' + L, TROUSERS.hem + 0.012, 2);
    }
    if (!skirt) {
      // the seat: the torso from the waist down, round both legs' tops
      const spec = { name: 'seat', kind: 'torso', aux: FIG_PIECE.trouser, y0: TROUSERS.waist, y1: TR.seatFoot || 0.8, wraps: (y) => ['torso', 'legL', 'legR'], centre: (y) => [0, torsoSection(Math.max(T_TORSO.lo, y)).cz], ease: (y) => TR.ease * smooth(0.79, 0.86, y) - (sculpt ? 0.008 * smooth(0.91, 0.85, y) : 0), hug: 0, drape: TR.seatDrape };
      const rings = clothRings(layers, spec, Lv);
      const part = clothMesh(rings, spec, { ...Lv, hem: false }, (x, y) => torsoW(x, y), FIG_SLOT.legs);
      // closed under the crotch
      const R = rings[rings.length - 1], last = part.P.length / 3 - R.pts.length;
      capFan(part, R.pts.map((_, k) => last + k), addV(part, [0, R.y - 0.005, R.o[1]], torsoW(0, R.y)), false);
      parts.push(part);
      layers.torso.push(clothLayer(rings));
      cov('torso', 0, TROUSERS.waist - 0.012);
    }
  }
  if (on.shoes) {
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R', P = PT['leg' + L];
      parts.push(footMesh(s, Lv, FIG_SLOT.shoes, SHOE.ease, shoeSole, [SHOE.heel, SHOE.toe]));
      cov('foot' + L, -1, 2);
      // the boot's shaft, over whatever the leg wears there, a little fuller at its top
      const sp = { name: 'boot' + L, kind: 'leg', aux: FIG_PIECE.boot, y0: BOOT.top, y1: BOOT.foot, wraps: () => ['leg' + L], centre: (y) => { const S = P.at(y); return [S.cx, S.cz]; },
        ease: (y) => BOOT.ease + 0.004 * smooth(BOOT.top - 0.05, BOOT.top, y), hug: 0, drape: 0.25 };
      const rings = clothRings(layers, sp, Lv);
      parts.push(clothMesh(rings, sp, { ...Lv, hem: false }, (x, y) => legW(L)(y), FIG_SLOT.shoes));
      layers['leg' + L].push(clothLayer(rings));
      cov('leg' + L, -1, BOOT.top - 0.012);
      // the trousers' cuff rolled up and resting on the boot's top, over the trouser above and the
      // shaft below
      if (on.legs && !(skirt && C.top.hem < BOOT.top + 0.06)) {
        const cs = { name: 'cuff' + L, kind: 'leg', aux: FIG_PIECE.cuff, y0: BOOT.top + 0.032, y1: BOOT.top - 0.01, wraps: () => ['leg' + L], centre: (y) => { const S = P.at(y); return [S.cx, S.cz]; }, ease: () => 0.007, hug: 0, drape: 9 };
        parts.push(clothMesh(clothRings(layers, cs, Lv), cs, Lv, (x, y) => legW(L)(y), FIG_SLOT.legs));
      }
    }
  }
  if (on.top) {
    const T = C.top;
    // the body of the top: the torso from the neck to the hem, and round the legs below the crotch
    const spec = {
      name: 'top', kind: 'torso', y0: T.neck, y1: T.hem,
      wraps: (y) => (y >= T_TORSO.lo + 0.005 ? (y < 0.95 ? ['torso', 'legL', 'legR'] : ['torso']) : ['legL', 'legR']),
      centre: (y) => [0, torsoSection(Math.max(T_TORSO.lo, Math.min(T_TORSO.hi, y))).cz],
      // over the trousers' waist the top stands off them, not the skin
      ease: (y) => T.ease + T.flare * smooth(0.86, T.hem, y) + (on.legs && y < TROUSERS.waist + 0.012 ? 0.002 : 0),
      hug: T.hug, drape: T.drape, aux: FIG_PIECE.torso,
      // the shoulders squared off over the deltoids, as a jacket's are
      easeDir: (y, d) => (C.shoulder || 0) * gx(y - 1.39, 0.03) * smooth(0.5, 0.9, Math.abs(d[0])),
      // belted, a coat or a jacket is cinched at the waist
      cinch: G.belt && T.hem < BELT.foot ? { top: BELT.top + 0.01, foot: BELT.foot - 0.01, ease: BELT.cinch } : C.rib ? { top: T.hem + C.rib, foot: T.hem - 0.001, ease: 0.006 } : null,
      jag: T.jag || 0,
      // the neckline gathered onto the collar's foot: each column's ray onto the neck, eased out
      topRing: (R0) => {
        const y = T.neck + 0.006, N = neckAt(y, NK), ce = C.collar ? C.collar.ease : 0.004, ax = N.rx + ce, az = N.rz + ce;
        return R0.dirs.map((d) => { const t = 1 / Math.hypot(d[0] / ax, d[1] / az); return [d[0] * t, y, N.cz + d[1] * t]; });
      },
    };
    // below the torso's foot the legs' layer is the trousers'
    const rings = clothRings(layers, spec, Lv);
    parts.push(clothMesh(rings, spec, T.jag ? { ...Lv, hem: false } : Lv, skirt ? skirtW : torsoW, FIG_SLOT.top));
    layers.torso.push(clothLayer(rings));
    cov('torso', T.hem + 0.012, T.neck - 0.006);
    // the sleeves
    for (const s of (C.sleeve ? [1, -1] : [])) {
      const L = s > 0 ? 'L' : 'R', P = PT['arm' + L], Sl = C.sleeve;
      const lean = deltoidLean(P, sculpt ? 1.1 : 0.5);
      const sp = {
        name: 'sleeve' + L, kind: 'arm', y0: P.hi - (sculpt ? 0.012 : 0.004), y1: Sl.cuff,
        wraps: () => ['arm' + L], centre: (y) => { const S = P.at(y); return [S.cx, S.cz]; },
        ease: (y) => Sl.ease + Sl.open * smooth(Sl.cuff + 0.06, Sl.cuff, y) + 0.6 * (C.shoulder || 0) * smooth(1.33, 1.4, y), hug: sculpt ? 0.6 : 0.3, drape: Sl.drape, aux: FIG_PIECE.sleeve,
        capTop: (R0) => { const c = armCapPoint(s); return [c[0], c[1] + Sl.ease - (sculpt ? 0.016 : 0), c[2]]; },
        cinch: C.rib ? { top: Sl.cuff + 0.035, foot: Sl.cuff - 0.001, ease: 0.004 } : null,
      };
      const rings = clothRings(layers, sp, Lv);
      for (const r of rings) r.pts = r.pts.map(lean);
      const part = clothMesh(rings, sp, Lv, (x, y) => armW(L)(y), slotOf(Sl.slot, FIG_SLOT.top));
      parts.push(part);
      layers['arm' + L].push(clothLayer(rings));
      cov('arm' + L, Sl.cuff + 0.012, 2);
    }
    // the collar: a band round the neck, flaring a little at its top
    if (C.collar) {
      const Cc = C.collar, cols = Lv.cols.neck, part = newPart('collar', slotOf(Cc.slot, FIG_SLOT.collar));
      const rows = Lv.name === 'far' ? 1 : Lv.name === 'crowd' ? 2 : 4, R = [];
      for (let i = 0; i <= rows; i++) {
        const t = 1 - i / rows, ring = [];
        for (let k = 0; k < cols; k++) {
          const a = (k / cols) * TAU, c = Math.cos(a), sn = Math.sin(a);
          // open at the front: the collar's top drops toward the chin, so a bowed head clears it
          const top = Cc.y1 - (Cc.open || 0) * Math.max(0, sn) ** 2, y = Cc.y0 + (top - Cc.y0) * t, N = neckAt(y, NK);
          const e = Cc.ease + Cc.flare * t * t;
          const p = [(N.rx + e) * c, y, N.cz + (N.rz + e) * sn * (sn > 0 ? 0.95 : 1)];
          ring.push(addV(part, p, TORSO_CHAIN(Math.min(y, 1.44))));
        }
        R.push(ring);
      }
      if (Lv.hem) {
        const ring = [];
        for (let k = 0; k < cols; k++) {
          const a = (k / cols) * TAU, sn = Math.sin(a), y = Cc.y1 - (Cc.open || 0) * Math.max(0, sn) ** 2 - 0.006, N = neckAt(y, NK), e = Cc.ease * 0.4 + Cc.flare * 0.5;
          ring.push(addV(part, [(N.rx + e) * Math.cos(a), y, N.cz + (N.rz + e) * sn], TORSO_CHAIN(1.44)));
        }
        R.unshift(ring);
      }
      stitchRings(part, R);
      parts.push(part);
    }
    // a mantle or a capelet over the shoulders and both arms, ragged or not
    if (C.mantle) {
      const m = C.mantle;
      const sp = {
        name: 'mantle', kind: 'torso', aux: FIG_PIECE.mantle, y0: m.top, y1: m.hem, wraps: () => ['torso', 'armL', 'armR'],
        centre: (y) => [0, torsoSection(Math.max(T_TORSO.lo, Math.min(T_TORSO.hi, y))).cz], ease: () => m.ease, hug: 0, drape: 0.25, jag: m.jag, point: m.point || 0,
        topRing: (R0) => { const y = m.top + 0.004, N = neckAt(y, NK), ax = N.rx + 0.012, az = N.rz + 0.012; return R0.dirs.map((d) => { const t = 1 / Math.hypot(d[0] / ax, d[1] / az); return [d[0] * t, y, N.cz + d[1] * t]; }); },
      };
      const mr = clothRings(layers, sp, Lv);
      parts.push(clothMesh(mr, sp, m.jag ? { ...Lv, hem: false } : Lv, (x, y) => torsoW(x, y), slotOf(m.slot, FIG_SLOT.top)));
      layers.torso.push(clothLayer(mr));
    }
    // a hood down, bunched behind the neck, and its drawstrings down the front
    if (C.hood && Lv.skin) {
      const M = newPart('hood', FIG_SLOT.top);
      blobInto(M, [0, 1.425, -0.112], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.1, 0.07, 0.05], Lv.name === 'hd' ? 18 : 10, Lv.name === 'hd' ? 10 : 6, 2.4, TORSO_CHAIN(1.43), FIG_PIECE.hood);
      parts.push(M);
      const S = newPart('strings', FIG_SLOT.collar);
      for (const sd of [1, -1]) {
        const path = [1.448, 1.42, 1.39, 1.365].map((y) => {
          const pts = ringOf(layers, 'torso', y), o = [0, torsoSection(y).cz], d = norm2([sd * 0.18, 1]), r = pts ? rayOut(hull2(pts), o, d) : 0.1;
          return [o[0] + d[0] * (r + 0.004), y, o[1] + d[1] * (r + 0.004)];
        });
        tubeAlong(S, path, [0.0028, 0.0028, 0.0028, 0.0034], 5, TORSO_CHAIN(1.42), [1, 0, 0], 1, FIG_PIECE.string);
      }
      parts.push(S);
    }
  }
  // the gear, over the outermost layer at its height
  if (G.belt && on.legs) {
    const sp = { name: 'belt', kind: 'torso', aux: FIG_PIECE.belt, y0: BELT.top, y1: BELT.foot, wraps: () => ['torso'], centre: (y) => [0, torsoSection(y).cz], ease: () => BELT.ease, hug: 0, drape: 9 };
    parts.push(clothMesh(clothRings(layers, sp, Lv), sp, { ...Lv, hem: false }, (x, y) => torsoW(x, y), FIG_SLOT.gear));
  }
  if (G.strap) parts.push(strapMesh(layers, Lv));
  if (G.pouch) {
    // on the belt at the right hip
    const y = 0.975, o = [0, torsoSection(y).cz], d = norm2([-0.78, 0.62]), R = hull2(ringOf(layers, 'torso', BELT.foot + 0.02) || []);
    const r = (R.length ? rayOut(R, o, d) : 0.15) + 0.026, c = [o[0] + d[0] * r, y, o[1] + d[1] * r];
    const M = newPart('pouch', FIG_SLOT.gear);
    blobInto(M, c, [-d[1], 0, d[0]], [0, 1, 0], [d[0], 0, d[1]], [0.036, 0.042, 0.022], Lv.name === 'hd' ? 14 : 8, Lv.name === 'hd' ? 8 : 5, 4, torsoW(c[0], c[1]), FIG_PIECE.pouch);
    parts.push(M);
  }
  if (G.pads && on.legs) {
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R', P = PT['leg' + L], y = 0.515, S = P.at(y), R = hull2(ringOf(layers, 'leg' + L, y) || []);
      const r = (R.length ? rayOut(R, [S.cx, S.cz], [0, 1]) : 0.05) + 0.012, c = [S.cx, y, S.cz + r];
      const M = newPart('pad' + L, FIG_SLOT.pad);
      blobInto(M, c, [s, 0, 0], [0, 1, 0], [0, 0, 1], [0.048, 0.062, 0.02], Lv.name === 'hd' ? 14 : 8, Lv.name === 'hd' ? 8 : 5, 3, [[B['thigh' + L], 0.35], [B['shin' + L], 0.65]], FIG_PIECE.pad);
      parts.push(M);
    }
  }
  // the hands, always skin; the mighty arm's bigger, and clawed if they're clawed
  for (const s of [1, -1]) {
    const hand = handMesh(s, Lv, (sculpt ? 1.1 * Math.sqrt(BK.arm) * (SW ? SW.hand : 1) : HAND_K) * (BD.mighty === (s > 0 ? 'L' : 'R') ? 1.12 : 1), sculpt);
    parts.push(hand);
    if (BD.claws && Lv.fingers) parts.push(clawMesh(hand, s, Lv));
  }
  if (BD.thorn) parts.push(thornMesh(PT, Lv));
  if (BD.teeth) parts.push(teethMesh(Lv, layers));
  // the skin, what the clothes leave of it
  if (Lv.skin) {
    const covered = (name, y) => (cover[name] || []).some(([lo, hi]) => y > lo && y < hi);
    const bodyParts = [
      bodyPart(PT.torso, Lv, (x, y) => torsoW(x, y), [0, T_TORSO.hi + 0.004, -0.022], TORSO_CAP),
      ...[1, -1].map((s) => { const L = s > 0 ? 'L' : 'R', P = PT['arm' + L], lean = deltoidLean(P); const M = bodyPart(P, Lv, (x, y) => armW(L)(y), armCapPoint(s), null); if (sculpt) M.A.fill(FIG_PIECE.sleeve); for (let i = 0; i < M.P.length; i += 3) { const q = lean([M.P[i], M.P[i + 1], M.P[i + 2]]); M.P[i + 1] = q[1]; } return M; }),
      ...[1, -1].map((s) => { const L = s > 0 ? 'L' : 'R'; return bodyPart(PT['leg' + L], Lv, (x, y) => legW(L)(y), null, null); }),
    ];
    for (const M of bodyParts) {
      // a triangle is dropped when all three of its corners are under cloth
      const keep = [];
      for (let t = 0; t < M.I.length; t += 3) {
        const a = M.I[t], b = M.I[t + 1], c = M.I[t + 2];
        if (covered(M.name, M.P[a * 3 + 1]) && covered(M.name, M.P[b * 3 + 1]) && covered(M.name, M.P[c * 3 + 1])) continue;
        keep.push(a, b, c);
      }
      M.I = keep;
      if (keep.length) parts.push(compact(M));
    }
    for (const s of [1, -1]) if (!on.shoes) parts.push(footMesh(s, Lv, FIG_SLOT.skin, 0, undefined, [0, 0]));
  }
  for (const p of parts) if (p.name !== 'cards') orient(p);
  if (Lv.head >= 0) {
    parts.push(...headParts(style, Lv.head, sculpt, FS, NKb));
    if (sculpt) { const l = hairLocks(Lv, style); if (l.I.length) { orient(l); parts.push(l); } }
    if (sculpt && beard) { const l = beardLocks(Lv, beard, FS); orient(l); parts.push(l); }
    if (sculpt && Lv.name === 'hd') for (const l of eyeParts(FS)) { orient(l); parts.push(l); }
    if (BD.horns) { const h = hornMesh(Lv); orient(h); parts.push(h); }
    if (BD.goggles) parts.push(gogglesMesh(Lv));
  }
  let cards = null;
  if (Lv.cards && !sculpt) { const c = hairCards(style, Lv); if (c.I.length) { parts.push(c); cards = c; } }
  const out = pack(parts, cards);
  // the close-up levels light their forms off smoothed normals (formNormals); the crowd's bake doesn't
  // (the face, its ears and neck keep theirs from a quarter of the way, so the face holds its planes)
  if (Lv.skin) out.NF = formNormals(out, Lv.name === 'hd' ? 40 : 16, { at: Lv.name === 'hd' ? 10 : 5, mask: (v) => out.S[v] === FIG_SLOT.face || out.S[v] === FIG_SLOT.ear || out.S[v] === FIG_SLOT.neck });
  // the face lights on its designed planes (form-normals.js faceDesigned), not its smoothed form
  const hp = out.parts.find((p) => p.name === 'head');
  if (out.NF && hp) out.NF.set(faceDesigned(headMesh(Lv.head, FS)), hp.v0 * 3);
  // the seat lights as the hips' round, not down into its cap, or the line where it dips into the
  // trousers shows as a jagged shadow
  const seat = sculpt && out.NF && out.parts.find((p) => p.name === 'seat');
  if (seat) for (let v = seat.v0; v < seat.v0 + seat.nv; v++) out.NF.set(norm3([out.P[v * 3], 0, out.P[v * 3 + 2] + 0.02]), v * 3);
  // the shell and the scalp painted under its edge light as one round, or the two forms' different
  // terminators draw the shell's stepped edge on pale hair
  if (sculpt && out.NF && hp) {
    const round = (v) => out.NF.set(norm3([out.P[v * 3], out.P[v * 3 + 1] - LOCK_C[1], out.P[v * 3 + 2] - LOCK_C[2]]), v * 3);
    const sh = out.parts.find((p) => p.name === 'hair');
    if (sh) for (let v = sh.v0; v < sh.v0 + sh.nv; v++) round(v);
    for (let v = hp.v0; v < hp.v0 + hp.nv; v++) if (out.S[v] === FIG_SLOT.face && out.P[v * 3 + 1] > hairlineAt(out.P[v * 3], out.P[v * 3 + 2], HAIRLINE_SCULPT) - 0.008) round(v);
  }
  // an eye and its lids light by their own round forms, not the face's
  for (const name of ['eyes', 'lids']) { const e = out.parts.find((p) => p.name === name); if (out.NF && e) for (let v = e.v0; v < e.v0 + e.nv; v++) out.NF.set(out.N.subarray(v * 3, v * 3 + 3), v * 3); }
  // the locks light with the head's volume, as cards do, so the hair takes one shadow shape
  const lk = out.parts.find((p) => p.name === 'locks');
  if (out.NF && lk) for (let v = lk.v0; v < lk.v0 + lk.nv; v++) {
    const d = norm3([out.P[v * 3], out.P[v * 3 + 1] - LOCK_C[1], out.P[v * 3 + 2] - LOCK_C[2]]), n = norm3([d[0] * 0.75 + out.N[v * 3] * 0.25, d[1] * 0.75 + out.N[v * 3 + 1] * 0.25, d[2] * 0.75 + out.N[v * 3 + 2] * 0.25]);
    out.NF.set(n, v * 3);
  }
  _cache.set(key, out);
  return out;
}

// A part without the vertices no triangle uses any more (the skin under the clothes).
function compact(M) {
  const map = new Int32Array(M.P.length / 3).fill(-1), C = newPart(M.name, M.slot);
  for (const i of M.I) if (map[i] < 0) map[i] = addV(C, [M.P[i * 3], M.P[i * 3 + 1], M.P[i * 3 + 2]], M.Wt[i], M.A[i], [M.UV[i * 2], M.UV[i * 2 + 1]]);
  C.I = M.I.map((i) => map[i]);
  return C;
}

// Parts into one indexed mesh, with normals per part (or as given: the head's, the cards').
function pack(parts, cards) {
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.P.length / 3; ni += p.I.length; }
  if (nv > 65535) throw new Error(`figure: ${nv} vertices won't index as UNSIGNED_SHORT`);
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), UV = new Float32Array(nv * 2), Bi = new Uint8Array(nv * 4), W = new Float32Array(nv * 4);
  const S = new Uint8Array(nv), A = new Float32Array(nv), I = new Uint16Array(ni), ranges = [];
  let vo = 0, io = 0, cardRange = null;
  for (const p of parts) {
    const n = p.P.length / 3;
    P.set(p.P, vo * 3);
    UV.set(p.UV, vo * 2);
    for (let i = 0; i < n; i++) {
      const wt = p.Wt[i].slice().sort((a, b) => b[1] - a[1]).slice(0, 4), sum = wt.reduce((x, [, w]) => x + w, 0) || 1;
      for (let k = 0; k < 4; k++) { Bi[(vo + i) * 4 + k] = wt[k] ? wt[k][0] : wt[0][0]; W[(vo + i) * 4 + k] = wt[k] ? wt[k][1] / sum : 0; }
      S[vo + i] = p.S ? p.S[i] : p.slot;
      A[vo + i] = p.A[i];
    }
    if (p.N) for (let i = 0; i < n; i++) { const v = p.N[i]; N[(vo + i) * 3] = v[0]; N[(vo + i) * 3 + 1] = v[1]; N[(vo + i) * 3 + 2] = v[2]; }
    else {
      for (let t = 0; t < p.I.length; t += 3) {
        const a = p.I[t] * 3, b = p.I[t + 1] * 3, c = p.I[t + 2] * 3, Q = p.P;
        const ux = Q[b] - Q[a], uy = Q[b + 1] - Q[a + 1], uz = Q[b + 2] - Q[a + 2], vx = Q[c] - Q[a], vy = Q[c + 1] - Q[a + 1], vz = Q[c + 2] - Q[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const j of [a, b, c]) { N[vo * 3 + j] += nx; N[vo * 3 + j + 1] += ny; N[vo * 3 + j + 2] += nz; }
      }
      for (let i = vo; i < vo + n; i++) { const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1; N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l; }
    }
    for (let t = 0; t < p.I.length; t++) I[io + t] = p.I[t] + vo;
    ranges.push({ name: p.name, slot: p.slot, start: io, count: p.I.length, v0: vo, nv: n });
    if (p === cards) cardRange = { start: io, count: p.I.length, n: p.cards };
    vo += n; io += p.I.length;
  }
  return { nv, nt: ni / 3, P, N, UV, B: Bi, W, S, A, I, parts: ranges, cards: cardRange };
}



// The cut a person wears close up, off the same `rand` the outfit uses (actor3d.js actorOutfit):
// slot 17, clear of the outfit's, the face's 13-16 and windshield.js's.
export const figureCut = (rand) => FIGURE_CIVIL_CUTS[Math.min(FIGURE_CIVIL_CUTS.length - 1, Math.floor(rand(17) * FIGURE_CIVIL_CUTS.length))];
// The gear they wear close up, off the same rand: slots 18 to 22, past the cut's. Most wear a belt;
// a strap, a pouch, knee pads and gloves each on some.
export const figureGear = (rand) => ({ belt: rand(18) < 0.8, strap: rand(19) < 0.35, pouch: rand(20) < 0.45, pads: rand(21) < 0.4, gloves: rand(22) < 0.5 });
export { B as FIGURE_BONE, HAIR_STYLES };
