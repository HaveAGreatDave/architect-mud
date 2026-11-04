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

import { headMesh, hairMesh, skullPoint, hairlineAt, spline, NECK, FACE, ZC, HAIR_STYLES } from './actor-head.js';
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
export const FIG_SLOT = { skin: 0, top: 1, legs: 2, shoes: 3, hair: 4, face: 7, ear: 8, neck: 9, card: 10, collar: 11, gear: 12, pad: 13, cloak: 14, horn: 15, salvage: 16, shirt: 17 };
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
function deltoidLean(part) {
  const side = part.side;
  return (p) => [p[0], p[1] - 0.5 * smooth(1.383, 1.414, p[1]) * Math.max(0, (p[0] - side * ARM_X) * side), p[2]];
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
function handMesh(side, level, k = HAND_K) {
  const M = handBuild(side, level), W = [side * ARM_X, 0.868, -0.004];
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
function neckAt(y) { const [rx, rz, cz] = T_NECK.at(Math.max(1.425, Math.min(1.6, y))); return { rx, rz, cz }; }

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

// ── The head (close-up only): actor-head.js's skin and shell, riding the head and neck bones ───────
function headParts(style, lv) {
  const out = [];
  const H = headMesh(lv, 'comic'), Hs = newPart('head', FIG_SLOT.face);
  for (let i = 0; i < H.P.length / 3; i++) {
    const f = H.F[i], slot = f === 8 ? FIG_SLOT.ear : f === 12 ? FIG_SLOT.neck : FIG_SLOT.face, w = H.W[i];
    addV(Hs, [H.P[i * 3], H.P[i * 3 + 1], H.P[i * 3 + 2]], w >= 1 ? [[B.head, 1]] : [[B.head, w], [B.neck, 1 - w]], f === 8 ? H.X[i] : H.E[i]);
    (Hs.S ||= []).push(slot);
  }
  Hs.I = Array.from(H.I);
  Hs.N = []; for (let i = 0; i < H.N.length / 3; i++) Hs.N.push([H.N[i * 3], H.N[i * 3 + 1], H.N[i * 3 + 2]]);
  out.push(Hs);
  const Y = hairMesh(style, lv), Ys = newPart('hair', FIG_SLOT.hair);
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
function partsFor(body) {
  if (!body?.mighty) return PARTS;
  const k = 'arm' + body.mighty, P = PARTS[k];
  return { ...PARTS, [k]: { ...P, at: (y) => { const S = P.at(y); return { ...S, rx: S.rx * MIGHTY_K, zf: S.zf * MIGHTY_K, zb: S.zb * MIGHTY_K }; } } };
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
export const figureKey = ({ cut = 'coat', style = 0, level = 'hd', wear = null, gear = null, body = null } = {}) => `${cut}|${style}|${level}|${wear ? JSON.stringify(wear) : ''}|${gearCode(gear)}|${bodyCode(body)}`;
export function buildFigure({ cut = 'coat', style = 0, level = 'hd', wear = null, gear = null, body = null } = {}) {
  const key = figureKey({ cut, style, level, wear, gear, body });
  if (_cache.has(key)) return _cache.get(key);
  const Lv = FIGURE_LEVELS[level], C = FIGURE_CUTS[cut] || FIGURE_CUTS.coat, code = gearCode(gear);
  const G = { belt: code.includes('b'), strap: code.includes('s') && Lv.skin, pouch: code.includes('p') && Lv.skin, pads: code.includes('k') && Lv.skin };
  const on = { top: true, legs: true, shoes: true, ...(wear || {}) };
  const PT = partsFor(body), BD = Lv.skin ? body || {} : {};
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
      const spec = { name: 'trouser' + L, kind: 'leg', aux: FIG_PIECE.trouser, y0: top, y1: TROUSERS.hem, wraps: () => ['leg' + L], centre: (y) => { const S = P.at(y); return [S.cx, S.cz]; }, ease: () => TROUSERS.ease, hug: TROUSERS.hug, drape: TROUSERS.drape };
      const rings = clothRings(layers, spec, Lv);
      const part = clothMesh(rings, spec, Lv, (x, y) => legW(L)(y), FIG_SLOT.legs);
      parts.push(part);
      layers['leg' + L].push(clothLayer(rings));
      cov('leg' + L, TROUSERS.hem + 0.012, 2);
    }
    if (!skirt) {
      // the seat: the torso from the waist down, round both legs' tops
      const spec = { name: 'seat', kind: 'torso', aux: FIG_PIECE.trouser, y0: TROUSERS.waist, y1: 0.8, wraps: (y) => ['torso', 'legL', 'legR'], centre: (y) => [0, torsoSection(Math.max(T_TORSO.lo, y)).cz], ease: (y) => TROUSERS.ease * smooth(0.79, 0.86, y), hug: 0, drape: TROUSERS.seatDrape };
      const rings = clothRings(layers, spec, Lv);
      const part = clothMesh(rings, spec, { ...Lv, hem: false }, (x, y) => torsoW(x, y), FIG_SLOT.legs);
      // closed under the crotch
      const R = rings[rings.length - 1], last = part.P.length / 3 - R.pts.length;
      capFan(part, R.pts.map((_, k) => last + k), addV(part, [0, R.y - 0.005, R.o[1]], torsoW(0, 0.8)), false);
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
        const y = T.neck + 0.006, N = neckAt(y), ce = C.collar ? C.collar.ease : 0.004, ax = N.rx + ce, az = N.rz + ce;
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
      const lean = deltoidLean(P);
      const sp = {
        name: 'sleeve' + L, kind: 'arm', y0: P.hi - 0.004, y1: Sl.cuff,
        wraps: () => ['arm' + L], centre: (y) => { const S = P.at(y); return [S.cx, S.cz]; },
        ease: (y) => Sl.ease + Sl.open * smooth(Sl.cuff + 0.06, Sl.cuff, y) + 0.6 * (C.shoulder || 0) * smooth(1.33, 1.4, y), hug: 0.3, drape: Sl.drape, aux: FIG_PIECE.sleeve,
        capTop: (R0) => { const c = armCapPoint(s); return [c[0], c[1] + Sl.ease, c[2]]; },
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
          const top = Cc.y1 - (Cc.open || 0) * Math.max(0, sn) ** 2, y = Cc.y0 + (top - Cc.y0) * t, N = neckAt(y);
          const e = Cc.ease + Cc.flare * t * t;
          const p = [(N.rx + e) * c, y, N.cz + (N.rz + e) * sn * (sn > 0 ? 0.95 : 1)];
          ring.push(addV(part, p, TORSO_CHAIN(Math.min(y, 1.44))));
        }
        R.push(ring);
      }
      if (Lv.hem) {
        const ring = [];
        for (let k = 0; k < cols; k++) {
          const a = (k / cols) * TAU, sn = Math.sin(a), y = Cc.y1 - (Cc.open || 0) * Math.max(0, sn) ** 2 - 0.006, N = neckAt(y), e = Cc.ease * 0.4 + Cc.flare * 0.5;
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
        topRing: (R0) => { const y = m.top + 0.004, N = neckAt(y), ax = N.rx + 0.012, az = N.rz + 0.012; return R0.dirs.map((d) => { const t = 1 / Math.hypot(d[0] / ax, d[1] / az); return [d[0] * t, y, N.cz + d[1] * t]; }); },
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
    const hand = handMesh(s, Lv, HAND_K * (BD.mighty === (s > 0 ? 'L' : 'R') ? 1.12 : 1));
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
      ...[1, -1].map((s) => { const L = s > 0 ? 'L' : 'R', P = PT['arm' + L], lean = deltoidLean(P); const M = bodyPart(P, Lv, (x, y) => armW(L)(y), armCapPoint(s), null); for (let i = 0; i < M.P.length; i += 3) { const q = lean([M.P[i], M.P[i + 1], M.P[i + 2]]); M.P[i + 1] = q[1]; } return M; }),
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
    parts.push(...headParts(style, Lv.head));
    if (BD.horns) { const h = hornMesh(Lv); orient(h); parts.push(h); }
    if (BD.goggles) parts.push(gogglesMesh(Lv));
  }
  let cards = null;
  if (Lv.cards) { const c = hairCards(style, Lv); if (c.I.length) { parts.push(c); cards = c; } }
  const out = pack(parts, cards);
  // the close-up levels light their forms off smoothed normals (formNormals); the crowd's bake doesn't
  // (the face, its ears and neck keep theirs from a quarter of the way, so the face holds its planes)
  if (Lv.skin) out.NF = formNormals(out, Lv.name === 'hd' ? 40 : 16, { at: Lv.name === 'hd' ? 10 : 5, mask: (v) => out.S[v] === FIG_SLOT.face || out.S[v] === FIG_SLOT.ear || out.S[v] === FIG_SLOT.neck });
  // the face lights on its designed planes (form-normals.js faceDesigned), not its smoothed form
  const hp = out.parts.find((p) => p.name === 'head');
  if (out.NF && hp) out.NF.set(faceDesigned(headMesh(Lv.head, 'comic')), hp.v0 * 3);
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
