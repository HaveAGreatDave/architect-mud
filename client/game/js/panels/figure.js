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

import { headMesh, hairMesh, skullPoint, facePoint, hairlineAt, spline, weightedFace, hdFace, EYE, NECK, NECK_SCULPT, SCULPT_HEADS, HAIRLINE_SCULPT, FACE, ZC, HAIR_STYLES, skulletHair, softFace, tunedFace, FACE_STYLES } from './actor-head.js';
import { formNormals, faceDesigned } from './form-normals.js';

const TAU = Math.PI * 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (e0, e1, x) => { if (e1 === e0) return x < e0 ? 0 : 1; const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
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

// ── The grown bones ─────────────────────────────────────────────────────────────────────────────────
// What a mutation grows past the human skeleton: a second head, spider legs, tentacles, a tail, wings.
// They come after FIGURE_BONES, so no clip knows them and nothing in the crowd's bake uses them; the
// close-up figure poses them itself each frame off their parents (gl/room-people.js growBones).
// `at` is the joint in bind space; `from`, when it's there, is where the geometry was modelled, so a
// second head is built as the head and the bone carries it to the shoulder; `k` scales it about its joint.
// `move` names how it moves: 'look' glances about on its own clock, 'sway' a slow curl, 'flap' a breath.
export const FIGURE_XBONES = (() => {
  const out = [], add = (name, parent, at, o = {}) => { out.push({ name, parent, at, ...o }); return name; };
  // the shoulder girdle: each collarbone turns about the breastbone's end, carrying the top of the shoulder
  // and the arm with it as the arm goes up or forward (gl/room-people.js shoulderGirdle). First, so a body
  // with no growths still has every bone it's weighted to without a gap in the list.
  add('clavL', 'chest', [0.022, 1.43, 0.035], { move: 'girdle' });
  add('clavR', 'chest', [-0.022, 1.43, 0.035], { move: 'girdle' });
  add('head2', 'chest', [-0.215, 1.405, -0.03], { from: [0, 1.47, 0], k: 0.97, move: 'look', yaw: -0.55, roll: -0.32 });
  // four spider legs out of the upper back, each a hip and a knee
  for (const [s, i, y] of [[1, 0, 1.33], [-1, 1, 1.33], [1, 2, 1.2], [-1, 3, 1.2]]) {
    add('spHip' + i, 'chest', [s * 0.06, y, -0.12], { move: 'sway', amp: 0.12, ph: i * 1.7 });
    add('spKnee' + i, 'spHip' + i, [s * 0.27, y + 0.32 - i * 0.05, -0.24], { move: 'sway', amp: 0.18, ph: i * 1.7 + 0.9 });
  }
  // three tentacles from the small of the back and the hips, three joints each
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 0.1, z = -0.1;
    add('tn' + i + 'a', 'spine', [x, 1.02, z], { move: 'sway', amp: 0.22, ph: i * 2.1 });
    add('tn' + i + 'b', 'tn' + i + 'a', [x * 1.6, 0.86, z - 0.09], { move: 'sway', amp: 0.35, ph: i * 2.1 + 0.8 });
    add('tn' + i + 'c', 'tn' + i + 'b', [x * 2, 0.66, z - 0.13], { move: 'sway', amp: 0.5, ph: i * 2.1 + 1.6 });
  }
  add('tailA', 'pelvis', [0, 0.93, -0.11], { move: 'sway', amp: 0.12, ph: 0.3 });
  add('tailB', 'tailA', [0, 0.72, -0.27], { move: 'sway', amp: 0.25, ph: 1.1 });
  add('tailC', 'tailB', [0, 0.42, -0.36], { move: 'sway', amp: 0.4, ph: 1.9 });
  add('wingL', 'chest', [0.07, 1.36, -0.12], { move: 'flap', ph: 0 });
  add('wingR', 'chest', [-0.07, 1.36, -0.12], { move: 'flap', ph: 0 });
  // a second pair of arms under the first, modelled as the arms and carried down the ribs. They 'copy'
  // the real arm's motion bone for bone (`src`), so they swing and gesture with it, held a little wider.
  for (const [s, L] of [[1, 'L'], [-1, 'R']]) {
    add('arm2U' + L, 'chest', [s * 0.182, 1.235, 0.0], { from: [s * 0.195, 1.39, -0.01], move: 'copy', src: 'uarm' + L, roll: s * 0.34, pitch: -0.18 });
    add('arm2F' + L, 'arm2U' + L, [s * 0.195, 1.1, -0.01], { move: 'copy', src: 'farm' + L });
    add('arm2H' + L, 'arm2F' + L, [s * 0.195, 0.85, -0.01], { move: 'copy', src: 'hand' + L });
  }
  // what a hand holds upright, a glass: carried to where the hand is but never turned with it, so it doesn't
  // spill (gl/room-people.js sets it from the hand; propMesh skins the glass to it)
  for (const L of ['L', 'R']) add('prop' + L, 'hand' + L, [0, 0, 0], { move: 'held' });
  return out;
})();
FIGURE_XBONES.forEach((x, i) => { B[x.name] = FIGURE_BONES.length + i; });
// every bone the close-up figure carries: the clips' and the grown ones
export const FIGURE_BONE_COUNT = FIGURE_BONES.length + FIGURE_XBONES.length;

// ── Material slots. The crowd's are actor3d.js ACTOR_MAT's, and keep its numbers. ──────────────────
// 0 skin, 1 the top garment, 2 trousers, 3 shoes and boots, 4 the hair's shell, then the close-up's
// own: 7 the face (atlas), 8 the ears, 9 the neck, 10 a hair card, 11 the collar (the top's colour),
// 12 gear in leather (the belt, a strap, a pouch), 13 knee pads, 14 a cloak or mantle, 15 horn and
// bone (horns, claws, thorns, teeth), 16 salvage (Halcyon-blue goggles), 17 a shirt under a vest,
// 5 a hat (the shoes' colour unless flags.figure.hat_col says), 6 a pair of glasses' frames (flags.figure.glasses).
export const FIG_SLOT = { skin: 0, top: 1, legs: 2, shoes: 3, hair: 4, hat: 5, specs: 6, face: 7, ear: 8, neck: 9, card: 10, collar: 11, gear: 12, pad: 13, cloak: 14, horn: 15, salvage: 16, shirt: 17, eye: 18, lid: 19 };
// What a vertex is, in its aux channel, for the paint (gl/figure-hd.js): which piece of cloth or
// gear, so a sleeve gets a cuff seam and a boot its laces.
export const FIG_PIECE = { torso: 0, sleeve: 1, boot: 2, belt: 3, strap: 4, pouch: 5, pad: 6, trouser: 7, mantle: 8, hood: 9, teeth: 10, goggles: 11, lens: 12, horn: 13, claw: 14, string: 15, cuff: 16,
  // the mutations' (MUTATION_LOOK)
  eye3: 17, compound: 18, wing: 19, spider: 20, tentacle: 21, earbig: 22, tail: 23, plate: 24, blade: 25,
  // what a hand holds (propMesh)
  cig: 26, glass: 27, liquid: 28, ice: 29,
  // a skirt over the legs, a hat, a scarf (FIGURE_BOTTOMS, FIGURE_HATS, FIGURE_SCARVES)
  skirt: 30, hat: 31, scarf: 32,
  // a work vest's pockets, flaps and snaps, and the binding down its open front (FIGURE_CUTS workvest)
  pocket: 33,
  // a cap's peak, its top and its underside (FIGURE_HATS bill)
  bill: 34, billUnder: 35,
  // a chain round the neck
  chain: 36,
  // a work apron (apronParts): the bib, the skirt that hangs from the waist, the ties
  apron: 37 };
// The gear a person can wear, each optional (figureGear picks it off the outfit's rand).
export const FIGURE_GEAR = ['belt', 'strap', 'pouch', 'pads', 'gloves'];

// ── Fabrics ─────────────────────────────────────────────────────────────────────────────────────────
// What a garment is woven or cut from, painted in ink over its colour (gl/figure-hd.js fabricPaint).
// It's a second axis beside the slot's lighting material (MAT in ballpark-mesh.js): leather and
// rubber also set that, so they take a highlight, and quilted nylon takes satin's sheen.
export const FIG_FABRIC = { plain: 0, denim: 1, canvas: 2, leather: 3, knit: 4, cord: 5, quilt: 6, plaid: 7, camo: 8, rubber: 9, rag: 10 };
const F = FIG_FABRIC;
// weights by cut for the top, then the trousers and the shoes
const FABRIC_TOP = {
  coat: [[F.canvas, 4], [F.leather, 3], [F.plain, 3], [F.camo, 1], [F.rubber, 1], [F.rag, 1]],
  jacket: [[F.leather, 4], [F.denim, 3], [F.canvas, 3], [F.cord, 2], [F.camo, 1], [F.plain, 2]],
  tee: [[F.plain, 6], [F.knit, 2], [F.plaid, 2], [F.camo, 1], [F.rag, 1]],
  hoodie: [[F.plain, 4], [F.knit, 3], [F.camo, 1], [F.rag, 1]],
  bomber: [[F.quilt, 5], [F.leather, 3], [F.camo, 1]],
  duster: [[F.canvas, 4], [F.leather, 3], [F.rag, 2], [F.rubber, 1]],
  vest: [[F.plain, 3], [F.knit, 2], [F.plaid, 2], [F.cord, 2], [F.leather, 1]],
  tunic: [[F.rag, 5], [F.canvas, 3], [F.knit, 1]],
  suit: [[F.plain, 8], [F.plaid, 1], [F.cord, 1]],
  crop: [[F.plain, 5], [F.knit, 2], [F.camo, 1]],
  longsleeve: [[F.plain, 5], [F.knit, 2], [F.plaid, 1]],
  tank: [[F.plain, 5], [F.knit, 1], [F.rag, 1]],
  oversized: [[F.plain, 5], [F.knit, 2], [F.rag, 1]],
  sweater: [[F.knit, 8], [F.cord, 1]],
  turtleneck: [[F.knit, 6], [F.plain, 2]],
  cardigan: [[F.knit, 8], [F.plaid, 1]],
  rolled: [[F.plaid, 4], [F.denim, 3], [F.plain, 3], [F.canvas, 2]],
  oxford: [[F.plain, 7], [F.plaid, 2]],
  cropjacket: [[F.denim, 5], [F.leather, 4], [F.cord, 1]],
  peacoat: [[F.plain, 5], [F.knit, 2], [F.plaid, 1]],
  parka: [[F.quilt, 5], [F.canvas, 2], [F.camo, 1]],
  mac: [[F.canvas, 5], [F.plain, 3], [F.leather, 1]],
  labcoat: [[F.plain, 6], [F.canvas, 2]],
  blazer: [[F.plain, 5], [F.plaid, 2], [F.cord, 2]],
  gilet: [[F.quilt, 6], [F.canvas, 1]],
  workvest: [[F.canvas, 3], [F.rubber, 1]],
  coverall: [[F.canvas, 6], [F.denim, 2], [F.camo, 1]],
  uniform: [[F.plain, 6], [F.canvas, 2], [F.camo, 1]],
  dress: [[F.plain, 6], [F.plaid, 1], [F.knit, 1]],
  shift: [[F.plain, 6], [F.knit, 1]],
  maxi: [[F.plain, 5], [F.rag, 1], [F.knit, 1]],
  knitdress: [[F.knit, 6], [F.plain, 1]],
  robe: [[F.plain, 4], [F.knit, 3], [F.plaid, 1]],
  poncho: [[F.knit, 4], [F.canvas, 3], [F.rag, 2]],
  briefs: [[F.plain, 4], [F.rubber, 2], [F.knit, 1]],
  boyshorts: [[F.plain, 4], [F.rubber, 1], [F.knit, 2]],
  bodysuit: [[F.rubber, 3], [F.plain, 3]],
  baselayer: [[F.plain, 4], [F.knit, 2], [F.rubber, 1]],
  strapwrap: [[F.plain, 1]],
  bikini: [[F.plain, 1]],
  longline: [[F.plain, 1]],
  slip: [[F.plain, 3], [F.knit, 1]],
  cutout: [[F.rubber, 2], [F.plain, 2]],
  hexsuit: [[F.plain, 1]],
  stagelace: [[F.plain, 1]], stagehex: [[F.plain, 1]],
  boxers: [[F.plain, 5], [F.plaid, 2], [F.knit, 1]],
};
const FABRIC_LEGS = [[F.denim, 8], [F.canvas, 4], [F.cord, 2], [F.camo, 2], [F.plain, 3], [F.leather, 1], [F.rag, 1], [F.rubber, 0.5]];
const FABRIC_SHOES = [[F.leather, 7], [F.canvas, 2], [F.rubber, 2]];
function rollOf(list, x) {
  let t = 0;
  for (const [, w] of list) t += w;
  x *= t;
  for (const [v, w] of list) { if ((x -= w) < 0) return v; }
  return list[list.length - 1][0];
}
// { top, legs, shoes } off three rolls. The Thornwarren dress in rag and canvas; a suit's trousers
// are its cloth.
export function figureFabric(r, cut, wild = false) {
  // a Wildblood's mantle is hide or a rag of the order's red, and its tunic homespun
  if (wild) return { top: rollOf([[F.rag, 3], [F.canvas, 2], [F.knit, 1]], r[0]), legs: rollOf([[F.rag, 2], [F.canvas, 1], [F.leather, 1]], r[1]), shoes: F.leather, cloak: rollOf([[F.leather, 3], [F.rag, 2], [F.knit, 1]], r[2]) };
  const top = rollOf(FABRIC_TOP[cut] || FABRIC_TOP.coat, r[0]);
  return { top, legs: cut === 'suit' || cut === 'coverall' || FIGURE_CUTS[cut]?.legs ? top : rollOf(FABRIC_LEGS, r[1]), shoes: rollOf(FABRIC_SHOES, r[2]) };
}

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
// the cuts that are dresses (a long coat's hem is as low, so the hem can't say): what a dress sandal goes with
const DRESS_CUTS = new Set(['dress', 'shift', 'maxi', 'knitdress', 'gown', 'slip', 'cutout', 'wrap', 'stagelace', 'stagehex']);
export const cutIsDress = (cut) => DRESS_CUTS.has(cut);
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
  // a flannel overshirt worn open and untucked over a tee: asked for by name; the tee and its print
  // are the paint's (gl/figure-hd.js, front 'open')
  flannel: {
    top: { hem: 0.9, neck: 1.455, ease: 0.013, hug: 0.12, drape: 0.38, flare: 0.012 },
    sleeve: { cuff: 0.88, ease: 0.01, drape: 0.18, open: 0.004 },
    collar: { y0: 1.442, y1: 1.472, ease: 0.008, flare: 0.03, open: 0.06 },
    shoulder: 0.016, front: 'open',
  },
  // a priest's cassock: to the ankle, a low stand collar with the white tab at the throat, and the long row
  // of small buttons down the front (gl/figure-hd.js, front 'cassock'). Asked for by name
  cassock: {
    top: { hem: 0.16, neck: 1.455, ease: 0.016, hug: 0.05, drape: 0.16, flare: 0.05 },
    sleeve: { cuff: 0.872, ease: 0.01, drape: 0.14, open: 0.006 },
    collar: { y0: 1.442, y1: 1.488, ease: 0.006, flare: 0, open: 0 },
    shoulder: 0.016, front: 'cassock',
  },
  // a pressed short-sleeve shirt, tucked in, with a collar and a button front: asked for by name
  shortsleeve: {
    top: { hem: 0.985, neck: 1.452, ease: 0.006, hug: 0.35, drape: 0.55, flare: 0.002 },
    sleeve: { cuff: 1.25, ease: 0.007, drape: 0.45, open: 0.008 },
    collar: { y0: 1.444, y1: 1.474, ease: 0.006, flare: 0.014, open: 0.026 },
    shoulder: 0.008, front: 'shirt',
  },
  // a long overcoat cut full, past the knee to the calf and wide at the hem, so it hangs and swings: asked for by name
  overcoat: {
    top: { hem: 0.26, neck: 1.455, ease: 0.02, hug: 0, drape: 0.15, flare: 0.075 },
    sleeve: { cuff: 0.866, ease: 0.014, drape: 0.12, open: 0.008 },
    collar: { y0: 1.44, y1: 1.55, ease: 0.014, flare: 0.05, open: 0.045 },
    shoulder: 0.024, front: 'buttons', vent: true,
  },
  // a trench coat worn open: the overcoat's length and swing, the fronts hanging apart over whatever's under it
  // (gl/figure-hd.js front 'open', `openW` times as wide as a shirt's opening). Asked for by name
  trench: {
    top: { hem: 0.3, neck: 1.455, ease: 0.02, hug: 0, drape: 0.15, flare: 0.07 },
    sleeve: { cuff: 0.866, ease: 0.014, drape: 0.12, open: 0.008 },
    collar: { y0: 1.44, y1: 1.52, ease: 0.014, flare: 0.05, open: 0.07 },
    shoulder: 0.026, front: 'open', vent: true, openW: 1.9,
  },
  // ── The wardrobe ── appended in order (uCut is the index). Every cut here closes with a front the paint
  // already knows. A dress or a skirted coat is any top whose hem is under 0.81: it drapes between the legs
  // and over a seat as the overcoat does. Fit is in the numbers: tight hugs the body (hug), loose and
  // oversized stand off it (ease) and hang lower. Sleeves: wrist 0.87, rolled 1.08, short 1.26, none null.
  // a cropped tee, tight, to the ribs
  crop: {
    top: { hem: 1.1, neck: 1.452, ease: 0.004, hug: 0.6, drape: 0.7, flare: 0 },
    sleeve: { cuff: 1.28, ease: 0.006, drape: 0.4, open: 0.006 },
    collar: { y0: 1.445, y1: 1.456, ease: 0.003, flare: 0, open: 0 },
    shoulder: 0.006,
  },
  // a long-sleeved tee, close
  longsleeve: {
    top: { hem: 0.96, neck: 1.452, ease: 0.005, hug: 0.5, drape: 0.6, flare: 0.002 },
    sleeve: { cuff: 0.878, ease: 0.006, drape: 0.3, open: 0.002 },
    collar: { y0: 1.445, y1: 1.458, ease: 0.0035, flare: 0, open: 0 },
    shoulder: 0.006, rib: 0.02,
  },
  // a vest top: no sleeves, tight
  tank: {
    top: { hem: 0.97, neck: 1.45, ease: 0.004, hug: 0.6, drape: 0.7, flare: 0.002 },
    sleeve: null, collar: null, shoulder: 0,
  },
  // a tee three sizes too big: off the body, to the thigh, sleeves past the elbow
  oversized: {
    top: { hem: 0.84, neck: 1.452, ease: 0.024, hug: 0, drape: 0.32, flare: 0.012 },
    sleeve: { cuff: 1.16, ease: 0.02, drape: 0.25, open: 0.014 },
    collar: { y0: 1.445, y1: 1.46, ease: 0.006, flare: 0.002, open: 0 },
    shoulder: 0.02,
  },
  // a knitted pullover, ribbed at the waist and cuffs
  sweater: {
    top: { hem: 0.93, neck: 1.452, ease: 0.012, hug: 0.2, drape: 0.42, flare: 0 },
    sleeve: { cuff: 0.88, ease: 0.011, drape: 0.2, open: 0 },
    collar: { y0: 1.444, y1: 1.47, ease: 0.006, flare: 0, open: 0 },
    shoulder: 0.01, rib: 0.045,
  },
  // the same with a roll neck up the throat
  turtleneck: {
    top: { hem: 0.94, neck: 1.452, ease: 0.008, hug: 0.35, drape: 0.5, flare: 0 },
    sleeve: { cuff: 0.88, ease: 0.008, drape: 0.25, open: 0 },
    collar: { y0: 1.44, y1: 1.54, ease: 0.008, flare: 0, open: 0 },
    shoulder: 0.008, rib: 0.03,
  },
  // a long loose knit, buttoned, to the hip
  cardigan: {
    top: { hem: 0.86, neck: 1.452, ease: 0.016, hug: 0.08, drape: 0.34, flare: 0.01 },
    sleeve: { cuff: 0.882, ease: 0.014, drape: 0.18, open: 0.004 },
    collar: { y0: 1.442, y1: 1.468, ease: 0.008, flare: 0.012, open: 0.05 },
    shoulder: 0.012, rib: 0.03, front: 'buttons',
  },
  // a work shirt with the sleeves rolled to the elbow, untucked
  rolled: {
    top: { hem: 0.9, neck: 1.452, ease: 0.009, hug: 0.25, drape: 0.45, flare: 0.006 },
    sleeve: { cuff: 1.08, ease: 0.012, drape: 0.3, open: 0.004 },
    collar: { y0: 1.444, y1: 1.476, ease: 0.006, flare: 0.016, open: 0.03 },
    shoulder: 0.01, front: 'shirt',
  },
  // a long-sleeved button shirt, tucked
  oxford: {
    top: { hem: 0.985, neck: 1.452, ease: 0.006, hug: 0.35, drape: 0.55, flare: 0.002 },
    sleeve: { cuff: 0.878, ease: 0.006, drape: 0.25, open: 0.003 },
    collar: { y0: 1.444, y1: 1.476, ease: 0.006, flare: 0.014, open: 0.026 },
    shoulder: 0.008, front: 'shirt',
  },
  // a short jacket to the waist, denim or biker, zipped
  cropjacket: {
    top: { hem: 1.0, neck: 1.455, ease: 0.014, hug: 0.05, drape: 0.35, flare: 0 },
    sleeve: { cuff: 0.878, ease: 0.011, drape: 0.18, open: 0.002 },
    collar: { y0: 1.442, y1: 1.5, ease: 0.011, flare: 0.03, open: 0.03 },
    shoulder: 0.018, front: 'zip',
  },
  // a wool coat to the top of the thigh, a big collar
  peacoat: {
    top: { hem: 0.74, neck: 1.455, ease: 0.016, hug: 0.04, drape: 0.24, flare: 0.02 },
    sleeve: { cuff: 0.87, ease: 0.012, drape: 0.13, open: 0.004 },
    collar: { y0: 1.44, y1: 1.55, ease: 0.014, flare: 0.05, open: 0.04 },
    shoulder: 0.022, front: 'buttons',
  },
  // a quilted parka past the hip, zipped, the hood down
  parka: {
    top: { hem: 0.7, neck: 1.455, ease: 0.028, hug: 0, drape: 0.22, flare: 0.02 },
    sleeve: { cuff: 0.872, ease: 0.02, drape: 0.18, open: 0 },
    collar: { y0: 1.442, y1: 1.52, ease: 0.014, flare: 0.012, open: 0.016 },
    shoulder: 0.02, rib: 0.03, hood: true, front: 'zip', quilt: true,
  },
  // a mac to the knee, buttoned and closed, the vent behind
  mac: {
    top: { hem: 0.5, neck: 1.455, ease: 0.016, hug: 0.04, drape: 0.18, flare: 0.045 },
    sleeve: { cuff: 0.87, ease: 0.012, drape: 0.12, open: 0.006 },
    collar: { y0: 1.44, y1: 1.54, ease: 0.014, flare: 0.045, open: 0.042 },
    shoulder: 0.024, front: 'buttons', vent: true,
  },
  // a lab or shop coat, thin, to the knee
  labcoat: {
    top: { hem: 0.56, neck: 1.455, ease: 0.012, hug: 0.06, drape: 0.22, flare: 0.03 },
    sleeve: { cuff: 0.874, ease: 0.01, drape: 0.14, open: 0.006 },
    collar: { y0: 1.442, y1: 1.5, ease: 0.008, flare: 0.04, open: 0.05 },
    shoulder: 0.012, front: 'buttons',
  },
  // a blazer without the suit: the shirt's collar shows
  blazer: {
    top: { hem: 0.86, neck: 1.455, ease: 0.01, hug: 0.12, drape: 0.3, flare: 0.004 },
    sleeve: { cuff: 0.878, ease: 0.008, drape: 0.15, open: 0.003 },
    collar: { y0: 1.444, y1: 1.475, ease: 0.006, flare: 0.006, open: 0.03, slot: 'shirt' },
    shoulder: 0.016, front: 'suit',
  },
  // a quilted gilet, zipped, the shirt's sleeves out
  gilet: {
    top: { hem: 0.93, neck: 1.452, ease: 0.02, hug: 0.05, drape: 0.4, flare: 0 },
    sleeve: { cuff: 0.878, ease: 0.008, drape: 0.2, open: 0.003, slot: 'shirt' },
    collar: { y0: 1.444, y1: 1.49, ease: 0.012, flare: 0.006, open: 0.012 },
    shoulder: 0.014, front: 'zip', quilt: true,
  },
  // a boiler suit's top, zipped from the collar; its trousers are its cloth (figureFabric)
  coverall: {
    top: { hem: 0.86, neck: 1.452, ease: 0.014, hug: 0.08, drape: 0.38, flare: 0 },
    sleeve: { cuff: 0.88, ease: 0.012, drape: 0.18, open: 0.003 },
    collar: { y0: 1.444, y1: 1.49, ease: 0.008, flare: 0.024, open: 0.02 },
    shoulder: 0.014, front: 'zip',
  },
  // THE VAT SUIT: the one-piece the dressing gantry puts on every reprinted body, a boiler suit in vat orange, zipped
  // from the collar, elastic at the waist and the cuffs (`rib`). Its repairs are stitched on as patches standing off the
  // cloth (`vat`, vatSuitDetail): which knees, elbows and shoulders, a second patch over the first on a hard-worn knee,
  // and on every one a chest pocket with its flap and snap and a batch tape. One cut a season; the item names it
  // (tags.wear_look.cut), and the vat issues the season's (server/engine/gameLoop.js SEASONAL_SUIT)
  vatsuit_summer: {
    top: { hem: 0.86, neck: 1.448, ease: 0.012, hug: 0.08, drape: 0.38, flare: 0 },
    sleeve: { cuff: 1.2, ease: 0.014, drape: 0.18, open: 0.006 },
    collar: { y0: 1.442, y1: 1.478, ease: 0.008, flare: 0.016, open: 0.04 },
    shoulder: 0.012, front: 'zip', rib: 0.03, vat: { knees: 1, elbows: false, shoulders: false },
  },
  vatsuit_spring: {
    top: { hem: 0.86, neck: 1.452, ease: 0.014, hug: 0.08, drape: 0.38, flare: 0 },
    sleeve: { cuff: 0.88, ease: 0.012, drape: 0.18, open: 0.003 },
    collar: { y0: 1.444, y1: 1.49, ease: 0.008, flare: 0.02, open: 0.02 },
    shoulder: 0.014, front: 'zip', rib: 0.03, vat: { knees: 2, elbows: false, shoulders: true },
  },
  vatsuit_autumn: {
    top: { hem: 0.86, neck: 1.452, ease: 0.017, hug: 0.06, drape: 0.38, flare: 0 },
    sleeve: { cuff: 0.88, ease: 0.014, drape: 0.18, open: 0.003 },
    collar: { y0: 1.444, y1: 1.5, ease: 0.01, flare: 0.022, open: 0.016 },
    shoulder: 0.016, front: 'zip', rib: 0.03, vat: { knees: 2, elbows: true, shoulders: true },
  },
  vatsuit_winter: {
    top: { hem: 0.86, neck: 1.455, ease: 0.022, hug: 0.04, drape: 0.4, flare: 0 },
    sleeve: { cuff: 0.878, ease: 0.016, drape: 0.2, open: 0.003 },
    collar: { y0: 1.444, y1: 1.53, ease: 0.014, flare: 0.012, open: 0.008 },
    shoulder: 0.016, front: 'zip', rib: 0.035, quilt: true, vat: { knees: 2, elbows: true, shoulders: true, double: true },
  },
  // a uniform tunic: fitted, buttoned, a stand collar, to the top of the thigh
  uniform: {
    top: { hem: 0.82, neck: 1.455, ease: 0.008, hug: 0.18, drape: 0.32, flare: 0.008 },
    sleeve: { cuff: 0.876, ease: 0.008, drape: 0.16, open: 0.002 },
    collar: { y0: 1.444, y1: 1.49, ease: 0.006, flare: 0.004, open: 0 },
    shoulder: 0.018, front: 'buttons',
  },
  // a dress to the knee with short sleeves, fitted at the body and full at the hem
  dress: {
    top: { hem: 0.54, neck: 1.45, ease: 0.006, hug: 0.55, drape: 0.45, flare: 0.06 },
    sleeve: { cuff: 1.3, ease: 0.006, drape: 0.4, open: 0.008 },
    collar: { y0: 1.445, y1: 1.455, ease: 0.003, flare: 0, open: 0 },
    shoulder: 0.006,
  },
  // a short sleeveless shift, above the knee
  shift: {
    top: { hem: 0.72, neck: 1.45, ease: 0.006, hug: 0.45, drape: 0.3, flare: 0.03 },
    sleeve: null, collar: null, shoulder: 0,
  },
  // a long sleeveless dress to the ankle
  maxi: {
    top: { hem: 0.14, neck: 1.45, ease: 0.008, hug: 0.35, drape: 0.16, flare: 0.07 },
    sleeve: null, collar: null, shoulder: 0,
  },
  // a knitted dress with long sleeves, to mid-calf
  knitdress: {
    top: { hem: 0.32, neck: 1.452, ease: 0.008, hug: 0.65, drape: 0.5, flare: 0.05 },
    sleeve: { cuff: 0.88, ease: 0.007, drape: 0.25, open: 0.002 },
    collar: { y0: 1.444, y1: 1.47, ease: 0.006, flare: 0, open: 0 },
    shoulder: 0.006, rib: 0.02,
  },
  // a dressing gown worn open over a tee, to the shin
  robe: {
    top: { hem: 0.3, neck: 1.455, ease: 0.024, hug: 0, drape: 0.16, flare: 0.05 },
    sleeve: { cuff: 0.9, ease: 0.024, drape: 0.14, open: 0.02 },
    collar: { y0: 1.442, y1: 1.49, ease: 0.012, flare: 0.04, open: 0.07 },
    shoulder: 0.014, front: 'open',
  },
  // a poncho to the hip over a long-sleeved top
  poncho: {
    top: { hem: 0.94, neck: 1.452, ease: 0.008, hug: 0.3, drape: 0.5, flare: 0 },
    sleeve: { cuff: 0.88, ease: 0.008, drape: 0.25, open: 0.002 },
    collar: { y0: 1.444, y1: 1.47, ease: 0.006, flare: 0, open: 0 },
    shoulder: 0.008, mantle: { top: 1.462, hem: 0.96, ease: 0.03, jag: 0, slot: 'cloak' },
  },
  // ── Underwear ── matched sets in a smart fabric, a lit seam picked out in the shirt's colour (front 'seam',
  // gl/figure-hd.js). `legs` cuts the trousers short as briefs or shorts: `hem` is where the leg ends,
  // `waist` where the seat starts, and the set's bottoms take the top's colour and cloth (figureFabric,
  // gl/room-people.js). Not in the street's roll: asked for by name.
  // a sports bra and high-cut briefs
  briefs: {
    top: { hem: 1.2, neck: 1.44, ease: 0.003, hug: 0.75, drape: 0.8, flare: 0 },
    sleeve: null, collar: null, shoulder: 0, rib: 0.016, front: 'seam',
    legs: { hem: 0.8, waist: 0.95, ease: 0.003, hug: 0.8 },
  },
  // a crop vest and boy shorts to mid-thigh
  boyshorts: {
    top: { hem: 1.13, neck: 1.446, ease: 0.003, hug: 0.7, drape: 0.75, flare: 0 },
    sleeve: null, collar: null, shoulder: 0, rib: 0.02, front: 'seam',
    legs: { hem: 0.68, waist: 0.98, ease: 0.004, hug: 0.75 },
  },
  // a one-piece bodysuit cut high on the hip, sleeveless
  bodysuit: {
    top: { hem: 0.86, neck: 1.446, ease: 0.003, hug: 0.8, drape: 0.8, flare: 0 },
    sleeve: null, collar: null, shoulder: 0, front: 'seam',
    legs: { hem: 0.81, waist: 0.96, ease: 0.003, hug: 0.8 },
  },
  // a long-sleeved base layer and leggings to the ankle, skin-tight
  baselayer: {
    top: { hem: 0.97, neck: 1.452, ease: 0.003, hug: 0.75, drape: 0.75, flare: 0 },
    sleeve: { cuff: 0.872, ease: 0.003, drape: 0.5, open: 0 },
    collar: { y0: 1.444, y1: 1.49, ease: 0.003, flare: 0, open: 0 },
    shoulder: 0, rib: 0.012, front: 'seam',
    legs: { ease: 0.003, hug: 0.8 },
  },
  // a strap wrap after the bandage costume in The Fifth Element (docs/reference/bibliography.md): bands of
  // pale cloth round the chest and hips with skin between them, and braces in the shirt's colour (front 'straps')
  strapwrap: {
    top: { hem: 0.95, neck: 1.43, ease: 0.003, hug: 0.8, drape: 0.8, flare: 0 },
    sleeve: null, collar: null, shoulder: 0, front: 'straps',
    legs: { hem: 0.79, waist: 0.97, ease: 0.003, hug: 0.8 },
  },
  // a loose vest and boxers to above the knee
  boxers: {
    top: { hem: 0.97, neck: 1.44, ease: 0.008, hug: 0.4, drape: 0.6, flare: 0 },
    sleeve: null, collar: null, shoulder: 0, front: 'seam',
    legs: { hem: 0.6, waist: 1.0, ease: 0.016, hug: 0.15 },
  },
};
// ── Bottoms, hats and scarves ── worn with any cut, each its own choice (`bottoms`, `hat`, `scarf` in the key).
// Bottoms replace the trousers: `legs` cuts them short as the underwear's does, and a `skirt` hangs from the
// waist over briefs, its hem draping between the legs and over a seat as a long coat's does (gl/figure-hd.js
// drape). A cut that sets its own legs (the underwear) or a top past the knee ignores them.
export const FIGURE_BOTTOMS = {
  shorts: { legs: { hem: 0.6, ease: 0.012, hug: 0.25 } },
  cutoffs: { legs: { hem: 0.7, ease: 0.008, hug: 0.4 } },
  bermudas: { legs: { hem: 0.5, ease: 0.014, hug: 0.2 } },
  capris: { legs: { hem: 0.3, ease: 0.006, hug: 0.5 } },
  mini: { legs: { hem: 0.8, waist: 0.97, ease: 0.003, hug: 0.8 }, skirt: { hem: 0.66, waist: 1.0, ease: 0.006, hug: 0.4, drape: 0.4, flare: 0.02 } },
  pencil: { legs: { hem: 0.8, waist: 0.97, ease: 0.003, hug: 0.8 }, skirt: { hem: 0.5, waist: 1.02, ease: 0.004, hug: 0.6, drape: 0.5, flare: 0 } },
  aline: { legs: { hem: 0.8, waist: 0.97, ease: 0.003, hug: 0.8 }, skirt: { hem: 0.5, waist: 1.02, ease: 0.008, hug: 0.2, drape: 0.24, flare: 0.06 } },
  midi: { legs: { hem: 0.8, waist: 0.97, ease: 0.003, hug: 0.8 }, skirt: { hem: 0.32, waist: 1.02, ease: 0.008, hug: 0.25, drape: 0.18, flare: 0.05 } },
  longskirt: { legs: { hem: 0.8, waist: 0.97, ease: 0.003, hug: 0.8 }, skirt: { hem: 0.12, waist: 1.02, ease: 0.008, hug: 0.2, drape: 0.16, flare: 0.07 } },
};
// A hat is two shapes on the head bone: a crown and, for most, a brim. [centre, radii, roundness] in the head's
// rest space (actor-head.js FACE: the crown at 1.75, the brow at 1.657); the crown's lower half sits inside the head.
export const FIGURE_HATS = {
  beanie: { crown: [[0, 1.705, -0.008], [0.1, 0.075, 0.11], 2.2], band: [[0, 1.672, -0.006], [0.104, 0.016, 0.114], 2.4] },
  // a cap's peak is a `bill`: a two-sided slab out from the crown's front, `span` radians round it, `out` metres
  // past it at the middle, curved down at the sides by `bend` and tipped down by `tilt` (hatBill)
  // the cap's crown is `fit`: a shell `off` out from the skull (actor-head.js skullPoint) from the ballpark's band
  // (capBandY) to the top, so it sits on the head as a fitted cap does; the hair is cut back under it (hatShell)
  cap: { fit: { off: 0.0095 }, crown: [[0, 1.71, -0.01], [0.097, 0.062, 0.106], 2.2], bill: { y: 1.684, span: 1.18, out: 0.074, bend: 0.013, tilt: 0.011, th: 0.0035 } },
  fedora: { crown: [[0, 1.735, -0.008], [0.088, 0.062, 0.098], 3], brim: [[0, 1.686, -0.006], [0.17, 0.007, 0.175], 2.2] },
  bucket: { crown: [[0, 1.72, -0.008], [0.096, 0.062, 0.104], 3], brim: [[0, 1.666, -0.006], [0.13, 0.012, 0.136], 2.4] },
  hardhat: { crown: [[0, 1.722, -0.006], [0.106, 0.072, 0.116], 2.2], brim: [[0, 1.682, 0.004], [0.124, 0.006, 0.142], 2.2] },
  flatcap: { crown: [[0, 1.718, 0.0], [0.1, 0.04, 0.116], 2.4], brim: [[0, 1.69, 0.09], [0.072, 0.006, 0.05], 2.2] },
  // a ballplayer's cap or batting helmet, which the ballpark draws itself off the same skull (gl/ballplayer-mesh.js
  // cap, helmet): nothing of its own here, only the hair cut back under its band, so only what hangs below shows.
  // Never rolled (gl/room-people.js HATS)
  ballcap: { under: true },
  // a catcher's hockey-style helmet, the same: the hair cut back under a shell that covers the forehead to the brow
  // and comes down over the ears, so no fringe hangs out over the face inside the cage
  skullhelm: { under: true, cut: (a) => (Math.abs(a) < 1.2 ? 1.655 : 1.6) },
};
// The ballpark's cap band round the head (gl/ballplayer-mesh.js capBand: `a` 0 in front, pi behind), in the head's
// rest space, and the locks cut back under it: a triangle with any corner over the band goes, or that corner comes
// out through the cap's edge.
const capBandY = (a) => 1.684 - 0.03 * (1 - Math.cos(a)) / 2;
function underCap(M, band = capBandY) {
  const P = M.P, keep = [];
  for (let t = 0; t < M.I.length; t += 3) {
    let over = false;
    for (let k = 0; k < 3; k++) { const i = M.I[t + k] * 3; if (P[i + 1] > band(Math.atan2(P[i], P[i + 2] - ZC)) - 0.002) over = true; }
    if (!over) keep.push(M.I[t], M.I[t + 1], M.I[t + 2]);
  }
  M.I = keep;
  return M;
}
// A scarf: a loop round the neck and, unless it's a snood, one tail down the front, or both ends (`ends: 2`,
// one a little longer). `wrap` is how many turns.
export const FIGURE_SCARVES = { scarf: { r: 0.02, tail: 0.24, wrap: 1 }, wrap: { r: 0.032, endR: 0.055, tail: 0.4, wrap: 1, ends: 2 }, chunky: { r: 0.03, tail: 0.18, wrap: 2 }, snood: { r: 0.028, tail: 0, wrap: 2 }, bandana: { r: 0.012, tail: 0.06, wrap: 1 } };
// The underwear sets, which the roll leaves out
// Low-cut tops: `neckline` [depth, half-width, 0 a V or 1 a scoop] is painted as skin down the front
// (gl/figure-hd.js uNeck), over a cloth that hugs the chest; any top can take one from flags.figure.neckline.
Object.assign(FIGURE_CUTS, {
  // a scoop-neck tee, close
  scoop: {
    top: { hem: 0.96, neck: 1.448, ease: 0.004, hug: 0.6, drape: 0.65, flare: 0.002 },
    sleeve: { cuff: 1.27, ease: 0.006, drape: 0.4, open: 0.006 },
    collar: null, shoulder: 0.004, neckline: [0.1, 0.1, 1],
  },
  // a plunging V top, sleeveless and fitted
  plunge: {
    top: { hem: 0.97, neck: 1.446, ease: 0.003, hug: 0.75, drape: 0.75, flare: 0 },
    sleeve: null, collar: null, shoulder: 0, neckline: [0.2, 0.075, 0],
  },
  // a wrap top crossed low over the chest, long sleeves
  wrap: {
    top: { hem: 0.95, neck: 1.448, ease: 0.005, hug: 0.6, drape: 0.6, flare: 0.006 },
    sleeve: { cuff: 0.876, ease: 0.006, drape: 0.3, open: 0.003 },
    collar: null, shoulder: 0.004, neckline: [0.16, 0.085, 0],
  },
  // a low-backed evening dress to the ankle, a deep V at the front
  gown: {
    top: { hem: 0.12, neck: 1.446, ease: 0.006, hug: 0.55, drape: 0.18, flare: 0.07 },
    sleeve: null, collar: null, shoulder: 0, neckline: [0.17, 0.08, 0],
  },
  // a bodice cut straight across low with a scoop, to the hip
  corset: {
    top: { hem: 0.94, neck: 1.44, ease: 0.002, hug: 0.85, drape: 0.85, flare: 0 },
    sleeve: null, collar: null, shoulder: 0, front: 'buttons', neckline: [0.13, 0.13, 1],
  },
});
Object.assign(FIGURE_CUTS, {
  // a triangle top, a V between the cups, and high-cut bottoms, in a film that shifts colour (front 'holo')
  bikini: {
    top: { hem: 1.23, neck: 1.44, ease: 0.002, hug: 0.85, drape: 0.85, flare: 0 },
    sleeve: null, collar: null, shoulder: 0, front: 'holo', neckline: [0.13, 0.045, 0],
    legs: { hem: 0.84, waist: 0.9, ease: 0.002, hug: 0.85 },
  },
  // a longline bra to the ribs and high-waisted briefs, in a sheer hex mesh with lit edges (front 'hex')
  longline: {
    top: { hem: 1.12, neck: 1.444, ease: 0.003, hug: 0.8, drape: 0.8, flare: 0 },
    sleeve: null, collar: null, shoulder: 0, front: 'hex', neckline: [0.09, 0.08, 1],
    legs: { hem: 0.8, waist: 1.05, ease: 0.003, hug: 0.8 },
  },
  // a slip to mid-thigh with a lace hem and a scooped lace top, briefs under it (front 'lace')
  slip: {
    top: { hem: 0.66, neck: 1.444, ease: 0.006, hug: 0.5, drape: 0.3, flare: 0.03 },
    sleeve: null, collar: null, shoulder: 0, front: 'lace', neckline: [0.11, 0.1, 1],
    legs: { hem: 0.82, waist: 0.95, ease: 0.003, hug: 0.8 },
  },
  // a bodysuit with windows cut at the waist and a plunge, lit at every edge (front 'cutout')
  cutout: {
    top: { hem: 0.86, neck: 1.446, ease: 0.003, hug: 0.82, drape: 0.82, flare: 0 },
    sleeve: null, collar: null, shoulder: 0, front: 'cutout', neckline: [0.15, 0.06, 0],
    legs: { hem: 0.83, waist: 0.95, ease: 0.003, hug: 0.82 },
  },
  // stage wear for a dancer on shift: a lace bra cut to the ribs and a high-cut thong-back brief (front 'lace')
  stagelace: {
    top: { hem: 1.25, neck: 1.44, ease: 0.002, hug: 0.88, drape: 0.88, flare: 0 },
    sleeve: null, collar: null, shoulder: 0, front: 'lace', neckline: [0.15, 0.05, 0],
    legs: { hem: 0.87, waist: 0.86, ease: 0.002, hug: 0.88 },
  },
  // the same two pieces in sheer hex mesh with lit edges (front 'hex')
  stagehex: {
    top: { hem: 1.25, neck: 1.44, ease: 0.002, hug: 0.88, drape: 0.88, flare: 0 },
    sleeve: null, collar: null, shoulder: 0, front: 'hex', neckline: [0.15, 0.05, 0],
    legs: { hem: 0.87, waist: 0.86, ease: 0.002, hug: 0.88 },
  },
  // a sheer hex-mesh catsuit, long sleeves to the ankle (front 'hex')
  hexsuit: {
    top: { hem: 0.97, neck: 1.452, ease: 0.003, hug: 0.8, drape: 0.8, flare: 0 },
    sleeve: { cuff: 0.872, ease: 0.003, drape: 0.5, open: 0 },
    collar: { y0: 1.444, y1: 1.49, ease: 0.003, flare: 0, open: 0 },
    shoulder: 0, front: 'hex',
    legs: { ease: 0.003, hug: 0.82 },
  },
  // a baseball jersey (Deadball, docs/proposals/deadball-players-v2.md): cut full through the body so it moves
  // on a swing, the short sleeves loose to above the elbow, no collar but the placket's, the tail tucked under the
  // belt. No front of its own: the placket, the buttons and the lettering are the club's kit, off the park's
  // atlas (gl/figure-hd.js kitCloth). Asked for by name: never rolled
  jersey: {
    top: { hem: 0.975, neck: 1.452, ease: 0.013, hug: 0.22, drape: 0.5, flare: 0.004 },
    sleeve: { cuff: 1.21, ease: 0.016, drape: 0.42, open: 0.014 },
    // the undershirt's long sleeve to the wrist, close to the arm, in the club's colour (FIG_SLOT.shirt)
    undersleeve: { cuff: 0.872, ease: 0.004, drape: 0.5, open: 0.002 },
    collar: { y0: 1.444, y1: 1.456, ease: 0.004, flare: 0, open: 0.02 },
    shoulder: 0.01,
  },
  // a stockman's work vest worn open over a crew-neck tee: the tee is its own layer in the shirt's slot (`undertop`),
  // the vest's front is cut away as a V that widens to the hem (`openFront`, half-widths at the neck and the hem),
  // its edges bound, four box pockets with flaps and snaps stand off it as geometry (`pockets`), and the paint
  // runs two reflective bands round it (gl/figure-hd.js `hivis`). Asked for by name
  workvest: {
    undertop: { hem: 0.905, neck: 1.452, ease: 0.006, hug: 0.45, drape: 0.6, flare: 0.004 },
    top: { hem: 0.895, neck: 1.452, ease: 0.017, hug: 0.08, drape: 0.42, flare: 0.006 },
    sleeve: { cuff: 1.262, ease: 0.008, drape: 0.3, open: 0.007, slot: 'shirt' },
    collar: { y0: 1.445, y1: 1.458, ease: 0.0035, flare: 0, open: 0, slot: 'shirt' },
    shoulder: 0.012, openFront: [0.03, 0.085], pockets: true, hivis: true,
  },
  // a hockey sweater, as a fan wears his club's to the rink (gl/crowd-hd.js): cut big and boxy to the top of the
  // thigh, the sleeves loose to the wrist, a laced V at the throat, and the club's stripes round the hem and the
  // forearms in the trim colour (gl/figure-hd.js). Asked for by name: never rolled
  hockey: {
    top: { hem: 0.86, neck: 1.452, ease: 0.022, hug: 0, drape: 0.3, flare: 0.01 },
    sleeve: { cuff: 0.872, ease: 0.02, drape: 0.22, open: 0.01 },
    collar: { y0: 1.444, y1: 1.46, ease: 0.006, flare: 0.002, open: 0.024 },
    shoulder: 0.02,
  },
  // a sport coat over a V-neck sweater, a shirt and tie in the sweater's V: put together without being a suit.
  // The sweater is the trim's colour (flags.figure.trim) and the tie its own (flags.figure.tie); the paint's
  // (gl/figure-hd.js, front 'sportcoat'). Nobody rolls it
  sportcoat: {
    top: { hem: 0.86, neck: 1.455, ease: 0.011, hug: 0.12, drape: 0.3, flare: 0.004 },
    sleeve: { cuff: 0.878, ease: 0.009, drape: 0.15, open: 0.003 },
    collar: { y0: 1.444, y1: 1.475, ease: 0.006, flare: 0.006, open: 0.03, slot: 'shirt' },
    shoulder: 0.012, front: 'sportcoat',
  },
});
export const FIGURE_UNDER_CUTS = ['briefs', 'boyshorts', 'bodysuit', 'baselayer', 'strapwrap', 'boxers', 'bikini', 'longline', 'slip', 'cutout', 'hexsuit', 'stagelace', 'stagehex'];
// The cuts anybody might wear; the tunic is the Wildblood's dress, not a pick.
export const FIGURE_CIVIL_CUTS = ['coat', 'jacket', 'tee', 'hoodie', 'bomber', 'duster', 'vest', 'crop', 'longsleeve', 'tank', 'oversized', 'sweater', 'turtleneck', 'cardigan', 'rolled', 'oxford', 'cropjacket', 'peacoat', 'parka', 'mac', 'labcoat', 'blazer', 'gilet', 'coverall', 'flannel', 'shortsleeve', 'overcoat', 'dress', 'shift', 'maxi', 'knitdress', 'robe', 'poncho', 'scoop', 'wrap'];
// how often each is rolled (1 when unlisted): street clothes common, workwear and the odd ones rare
const CUT_WEIGHT = { tee: 3, jacket: 2.5, coat: 2, hoodie: 2, longsleeve: 1.5, sweater: 1.5, rolled: 1.2, labcoat: 0.4, coverall: 0.6, robe: 0.25, maxi: 0.5, poncho: 0.4, blazer: 0.7 };
export const FIGURE_CUT_NAMES = Object.keys(FIGURE_CUTS);
// the leg's shape kept through the cloth (hug) and let in toward the knee and ankle (drape), so the
// thigh and the calf read in silhouette
const TROUSERS = { waist: 1.005, hem: 0.068, ease: 0.008, hug: 0.38, drape: 0.06, seatDrape: 0.3 };
// (a work boot: fuller all round and longer in the toe than the foot in it. SOLE is the line the walk pivots on,
// which stays where the clips were tuned)
const SHOE = { ease: 0.017, sole: 0.011, toe: 0.01, heel: 0.01 }, SOLE = { toe: 0.002, heel: 0.006 };
// A boot's shaft over the trousers' foot, so they read as tucked in, and the belt over the outermost
// layer at the waist, which a coat or a jacket is cinched to.
// The sculpted man's boot stops above the ankle with the trousers bloused on top of it; a woman's (a soft head)
// and every other figure's goes to mid calf (`tall`). gl/figure-hd.js paints the collar, the laces and the trousers' cuff against the same two
// heights (bootTop there), so change them together.
const BOOT = { top: 0.235, tall: 0.3, foot: 0.078, ease: 0.009 };
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
  const z0 = FOOT[0][0] - SOLE.heel + 0.004, z1 = FOOT[FOOT.length - 1][0] + SOLE.toe - 0.004, out = [];
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
  [0.015, 0.034, 0.050, 0.041, 0.042, 0.004],
  [0.050, 0.038, 0.040, 0.035, 0.032, 0.006],
  [0.085, 0.043, 0.032, 0.026, 0.024, 0.008],
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
  { const side = smooth(0.45, 0.85, Math.abs(c));
    d += 0.003 * side * smooth(-0.1, 0.5, s) * gx(y - 1.25, 0.04);                          // the serratus, one band under the armpit
    d += 0.006 * side * smooth(-0.3, 0.4, s) * gx(y - 1.035, 0.04); }                       // the obliques, rolled over the hip bone
  // the glutes: a round each, fullest at the middle of the seat and tucked in under, so the seat curves back to the
  // thigh. (Fullest at 0.885 and full all the way down to where the leg starts, it hung: a teardrop over a shelf.)
  d += K * 0.02 * gx(ax - 0.07, 0.055) * gx(y - 0.925, 0.05);
  d -= K * 0.03 * gx(ax - 0.07, 0.075) * smooth(0.895, 0.835, y);
  d -= K * 0.014 * gx(x, 0.011) * (1 - smooth(0.95, 1.0, y));
  return d;
}
function armRelief(y, c, s) {
  let d = 0;
  d += 0.004 * gx(y - 1.36, 0.04) * smooth(0.2, 0.8, c);                                  // the deltoid's foot
  d += 0.006 * gx(y - 1.37, 0.045) * smooth(-0.5, 0.2, c);                                // its cap, round over the front, side and back
  d += 0.003 * smooth(0.3, 0.8, s) * gx(y - 1.38, 0.035);                                 // and its front head, toward the chest
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
// The limbs' lines from the front. A hanging arm isn't straight: the elbow sits in toward the waist and the
// forearm angles back out (the carrying angle), so the elbow is drawn in while the shoulder and wrist stay on
// their joints. The thighs slope in from the hips to the knees, and the shins come most of the way back out to
// the ankles, which stay over the feet. Both are moves along the bend's own axis, so a bent elbow or knee still
// turns true about its bone.
const ELBOW_IN = (y) => 0.013 * gx(y - 1.1, 0.075);
const KNEE_IN = (y) => 0.011 * smooth(0.95, 0.6, y) * (0.45 + 0.55 * smooth(0.1, 0.42, y));
function limbSection(T, X, side) {
  const tuck = X === ARM_X ? ELBOW_IN : KNEE_IN;
  return (y) => { const [rx, zf, zb, cx, cz] = T.at(y); return { cx: side * (X + cx - tuck(y)), cz, rx, zf, zb, nf: 2.05, nb: 2.05 }; };
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
  meso: { muscle: 1.7, fat: 0, ribs: 0, neck: 1.16, hand: 1.06, bust: 0.85, sh: 0.006, waist: 0.25, round: 2.35, thigh: -0.012, abduct: 0.065 },
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
// The close-up levels weight the top of the shoulder to the collarbones; the crowd's bake has only the 19
// bones, so its levels keep it on the chest. buildFigure sets this for the level it's building.
let GIRDLE = false;
const girdleOf = (L) => (GIRDLE ? B['clav' + L] : B.chest);
function torsoW(x, y) {
  let w = TORSO_CHAIN(y);
  const ax = Math.abs(x), L = x >= 0;
  // only the collar's ring rides the neck: out past the neck's own width the top of the torso is shoulder,
  // and a tilted head swung it up as a bulge from the jaw to the shoulder on the stretched side
  {
    const off = smooth(0.05, 0.09, ax), nk = w.find(([b]) => b === B.neck)?.[1] || 0;
    if (off > 0 && nk > 0) {
      const ch = (w.find(([b]) => b === B.chest)?.[1] || 0) + nk * off;
      w = [[B.neck, nk * (1 - off)], [B.chest, ch], ...w.filter(([b]) => b !== B.neck && b !== B.chest)].filter(([, k]) => k > 0);
    }
  }
  // the collarbone and the trapezius over it, front and back, out from beside the neck to the shoulder
  if (GIRDLE) w = mixW(w, girdleOf(L ? 'L' : 'R'), 0.9 * smooth(0.035, 0.115, ax) * smooth(1.3, 1.4, y));
  w = mixW(w, L ? B.uarmL : B.uarmR, 0.34 * smooth(0.135, 0.195, ax) * smooth(1.33, 1.42, y));
  w = mixW(w, L ? B.thighL : B.thighR, 0.5 * smooth(0.95, 0.83, y) * Math.min(1, ax / 0.04));
  return w;
}
// Below the hips a skirt is split front and back, so each side follows its own thigh; the centre
// line stays with the pelvis, which keeps the two halves joined (actor3d.js's coat).
// A fitted dress (`tight` 1) goes with the thigh from just under the hip: let go as gradually as a coat's skirt,
// it was a third on the thigh at hip height, and a thigh that swung out came through it.
const skirtWOf = (tight) => (x, y) => {
  if (y > 0.93) return torsoW(x, y);
  const k = smooth(0.93, 0.62 + 0.2 * tight, y) * 0.92 * Math.min(1, Math.abs(x) / 0.03), L = x >= 0;
  // below the knee a long skirt (a duster, a cassock) goes with the shin, so sitting it hangs from the
  // knee instead of carrying on out level with the thigh
  const s = smooth(0.54, 0.42, y);
  if (s <= 0) return [[B.pelvis, 1 - k], [L ? B.thighL : B.thighR, k]];
  return [[B.pelvis, 1 - k], [L ? B.thighL : B.thighR, k * (1 - s)], [L ? B.shinL : B.shinR, k * s]];
};
const skirtW = skirtWOf(0), skirtFitted = skirtWOf(1);
const armW = (L) => chain([
  { y: 1.39, a: girdleOf(L), b: B['uarm' + L], h: 0.03 },
  { y: 1.10, a: B['uarm' + L], b: B['farm' + L], h: 0.045 },
  { y: 0.86, a: B['farm' + L], b: B['hand' + L], h: 0.02 },
]);
// The sculpted arm's shoulder. The deltoid is the arm's: all of it that stands out past the torso goes with the
// arm, and only its inner edge, where it laps over the trapezius and the chest, is shared with the chest. Weighted
// by height alone (armW), the dome's top stayed on the chest as the arm went out under it, and the shoulder
// creased in two: a doll's arm on a peg. `u` is how far out past the shoulder joint a point is.
const armWS = (L) => {
  const below = armW(L), side = L === 'L' ? 1 : -1;
  return (x, y) => {
    if (y < 1.3) return below(y);
    // the shoulder's share: at the top of the round, nearly half on the outer side and four fifths on the inner;
    // all on the arm, the round swung down under the armpit of a raised arm
    // (the outer side is all the arm's, to the top: sharing it, a raised arm's deltoid lagged behind the arm and sank
    // toward the joint, which left a dip between the shoulder and a hump further out. All the arm's, it swings up
    // over the top of the shoulder as the muscle does, and the line from the neck runs into it.)
    const u = side * x - ARM_X, inn = 1 - smooth(-0.035, 0.02, u), k = Math.max(smooth(1.3, 1.45, y) * 0.8 * inn, smooth(1.408, 1.424, y) * Math.min(1, 1.3 * inn));
    return k > 0 ? [[girdleOf(L), k], [B['uarm' + L], 1 - k]] : [[B['uarm' + L], 1]];
  };
};
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
// the sculpted arm's deltoid closes as a dome over its last few centimetres (partsFor), which needs rings there,
// so only the hd level has it: a lite figure keeps its budget and the old cap
// (1.4365 is the ring that rounds the top of the dome; it took the place of one at 1.35, on the plain upper arm, so
// the sculpted figure stays under the triangles of the one it replaces)
const DOME_KEYS = [1.4365, 1.428, 1.42, 1.41, 1.396, 1.375];
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
  const yy = ys(part.hi, part.lo, level.dy[kind], (part.cap ? DOME_KEYS : SHOULDER_KEYS[kind]) || []);
  const R = yy.map((y) => phis.map((phi) => { const p = partPoint(part, y, phi); return addV(M, p, wf(p[0], p[1], p[2])); }));
  if (capTop) capFan(M, R[0], addV(M, capTop, wf(...capTop)), true);
  stitchRings(M, R);
  if (capBot) capFan(M, R[R.length - 1], addV(M, capBot, wf(...capBot)), false);
  M.ys = yy;
  return M;
}
// The arm's top is a closed cap, the round of the shoulder: its outer half falls away to the arm
// (actor3d.js's deltoid), so there's no ring standing on the shoulder.
function armCapPoint(side, part = null) {
  if (!part?.cap) return [side * (ARM_X - 0.028), 1.421, -0.01];
  const S = part.at(part.cap); return [S.cx, part.cap, S.cz];
}
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
// A bare foot, close up: the foot as footMesh lofts it, cut off across the ball, and five toes forward of that, the
// big toe on the inside, each a short tube on the toe bone with its tip curled down onto the sole and the outer ones
// set back and smaller. Only the levels with fingers; the rest keep the shoe's last in skin.
// The five toes, big toe first: how far each starts behind its neighbour, its length, its radius. Where each sits
// across the foot isn't here: bareFootMesh lays them side by side over the foot's whole width, so the big toe's
// inner edge carries on the inside of the foot and the little toe's outer edge the outside. (They were bunched in
// the middle three quarters of it, with a shoulder of foot left over each side.)
const BARE_TOES = [
  [0.0, 0.049, 0.0112], [0.002, 0.042, 0.0078], [0.004, 0.04, 0.0072], [0.006, 0.039, 0.0066], [0.008, 0.037, 0.0061],
];
const TOE_FLAT = 1.25, TOE_SLANT = 0.02;
// The bare foot's section at `z`, and how far its top drops toward the little toe. FOOT is a shoe's last, whose
// toe box stands 4 cm high to the end: cut off across the ball it was a wall, with the toes coming out from under
// it. So from the ball forward the top comes down to the toes' own height, lower on the outside where the toes
// are smaller, and the foot runs into them.
// (`full` leaves out the last centimetre's tuck, where the foot's own end ducks under the toes' roots: it's the
// height those roots start at)
const bareSection = (z, full = false) => { const [rx, cy, up, dn, cx] = T_FOOT.at(z), t = smooth(0.078, 0.124, z), tuck = full ? 0 : smooth(0.112, 0.124, z); return [rx, cy - 0.003 * t - 0.004 * tuck, up * (1 - 0.42 * t) * (1 - 0.4 * tuck), dn, cx, 0.006 * t]; };
function bareFootMesh(side, level) {
  const L = side > 0 ? 'L' : 'R', w = toeW(L), M = newPart('foot' + L, FIG_SLOT.skin), cols = level.cols.foot;
  const z0 = FOOT[0][0], z1 = 0.124, n = Math.max(3, Math.round((z1 - z0) / level.dy.foot)), rings = [];
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n, [rx, cy, up, dn, cx, out] = bareSection(z), ring = [];
    for (let j = 0; j < cols; j++) {
      const a = (j / cols) * TAU, c = Math.cos(a), s = Math.sin(a);
      // the arch: the inside of the sole lifted off the floor through the middle of the foot
      const arch = side * c < 0 && s < 0 ? 0.006 * Math.sin(Math.PI * Math.max(0, Math.min(1, (z + 0.03) / 0.12))) * -c * side : 0;
      ring.push([side * (LEG_X + cx) + side * rx * se(c, 2.3), Math.max(cy + (s >= 0 ? up : dn) * se(s, s >= 0 ? 2.2 : 3.2) - (s > 0 ? out * Math.max(0, c) * s : 0), FOOT_SOLE) + arch,
        // and its front edge runs back toward the little toe, as the toes' roots do, so the outer toes aren't inside it
        z - TOE_SLANT * Math.max(0, c) * smooth(0.085, 0.124, z)]);
    }
    rings.push(ring);
  }
  const R = rings.map((ring) => ring.map((p) => addV(M, p, w(p[2]))));
  const mid = (ring) => ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length, a[2] + p[2] / ring.length], [0, 0, 0]);
  capFan(M, R[0], addV(M, mid(rings[0]), w(rings[0][0][2])), true);
  stitchRings(M, R);
  capFan(M, R[R.length - 1], addV(M, mid(rings[n]), w(z1)), false);
  // THE TOES. Each grows out of the foot, not out of a hole in its end: its root starts two centimetres back inside
  // the forefoot, as tall as the foot is there and wide enough to run into its neighbours (the web between toes),
  // so over the join the top of the foot carries on as the top of the toe. From there it narrows to its own size,
  // waists at the joint, swells to the pad and rounds off. Side by side from the foot's inside edge to its outside:
  // edge to edge they're a little wider than the foot, so they close up by the difference.
  const [bx, bcy, bup, , bcx, bout] = bareSection(z1 - 0.002, true), cols2 = level.name === 'hd' ? 10 : 7;
  const topAt = (at) => { const c = Math.sign(at) * Math.min(1, Math.abs(at / bx)) ** 1.15, sn = Math.sqrt(Math.max(0, 1 - c * c)); return bcy + bup * se(sn, 2.2) - bout * Math.max(0, c) * sn; };
  const hw = BARE_TOES.map((t) => t[2] * TOE_FLAT), W = bx * 0.99, gap = [0];
  for (let i = 1; i < hw.length; i++) gap.push(gap[i - 1] + hw[i - 1] + hw[i]);
  for (let i = 0; i < BARE_TOES.length; i++) {
    const [stagger, len, r] = BARE_TOES[i], at = -W + hw[0] + (2 * W - hw[0] - hw[hw.length - 1]) * (gap[i] / gap[gap.length - 1]), across = at / W;
    const x = side * (LEG_X + bcx) + side * at, ze = z1 - TOE_SLANT * Math.max(0, across) - stagger, Lv = len - 0.012, H = Math.max(r, (topAt(at) - FOOT_SOLE) / 2);
    // along the toe from its root: [how far past the foot's edge, half its height, half its width]
    const st = [[-0.022, H * 0.94, hw[i] * 1.5], [-0.008, H, hw[i] * 1.4], [0.004, Math.max(r, H * 0.92), hw[i] * 1.18], [0.3 * Lv, r, hw[i] * 0.98], [0.58 * Lv, r * 0.9, hw[i] * 0.9], [0.84 * Lv, r * 0.97, hw[i]], [Lv, r * 0.72, hw[i] * 0.74]];
    const R = st.map(([dz, rv, rh]) => {
      // (a root wider than its toe would stand out past the foot's edge on the two outside toes: it moves in instead)
      const f = Math.max(0, dz / Lv), over = Math.max(0, Math.abs(at) + rh - W - 0.0008), cx = x + side * across * 0.004 * f - side * Math.sign(at) * over, cy = FOOT_SOLE + rv - 0.002 * f * f, cz = ze + dz, ring = [];
      for (let j = 0; j < cols2; j++) { const a = (j / cols2) * TAU; ring.push(addV(M, [cx - rh * Math.cos(a), cy + rv * Math.sin(a), cz], w(cz))); }
      return ring;
    });
    stitchRings(M, R);
    const [dzT, rvT] = st[st.length - 1], [dz0, rv0] = st[0];
    capFan(M, R[R.length - 1], addV(M, [x + side * across * 0.004, FOOT_SOLE + rvT - 0.002, ze + dzT + rvT * 0.6], w(ze + dzT)), false);
    capFan(M, R[0], addV(M, [x, FOOT_SOLE + rv0, ze + dz0], w(ze + dz0)), true);
  }
  return M;
}
function footMesh(side, level, slot, grow, sole, ext) {
  const L = side > 0 ? 'L' : 'R', w = toeW(L);
  const M = newPart('foot' + L, slot);
  const rings = footRings(side, level.cols.foot, level.dy.foot, grow, sole, ext);
  // a boot's toe as a shoe's, one smooth line across (toeArc); a bare foot keeps its toes
  const arc = slot === FIG_SLOT.shoes ? toeArc(rings, 0.016, 0.02) : (p) => p;
  const R = rings.map(({ ring }) => ring.map((p) => addV(M, arc(p), w(p[2]))));
  const tip = (r) => { const c = r.ring.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map((v) => v / r.ring.length); return addV(M, arc(c), w(c[2])); };
  capFan(M, R[0], tip(rings[0]), true);
  stitchRings(M, R);
  capFan(M, R[R.length - 1], tip(rings[rings.length - 1]), false);
  return M;
}

// A dress sandal (`boots: 'sandal'`), open at the toe: the bare foot (bareFootMesh, which the caller adds) on a
// thin sole cut to its outline, a band across the roots of the toes, a narrower one over the instep, a strap round
// the ankle and one down the back of the heel. All of it in the shoes' slot, so it takes their colour and leather.
//
// THE HEEL. A heel pitches the foot and would lift the whole body, and no clip allows for either. So it's done in
// the mesh alone, on the same bones: everything behind the ball of the foot is turned up about the ball (heelPose),
// which raises the ankle about 2 cm, and the shin's skin is drawn up by as much from mid calf down (ankleLift), so the
// leg is that much shorter below the knee and nobody stands any taller. The foot and the shoe still ride the foot
// bone, whose joint is now a little under the ankle that shows; over the few degrees a foot turns in a walk that
// doesn't read. The whole foot is set back so the ankle stays over the heel.
// (Turned up as one stiff board the foot was a ramp: no arch, the heel's seat as steep as the shank, and the
// ankle end of the foot tipped forward into the shin, which stood out behind it as a lump. So the turn varies along
// the foot, as a shoe's last does: none under the ball, steepest through the arch, easing to a nearly level seat
// under the heel. The ankle end of the foot goes straight up with the shin instead of tipping, and the heel is
// a little shorter and narrower than the flat foot's, which is a shoe's last and has a boot's heel.)
const HEEL = (() => {
  const zb = 0.1, th = (u) => 0.4 * smooth(0, 0.05, u) * (1 - 0.65 * smooth(0.07, 0.13, u)), N = 240, du = 0.001, Y = [0], Z = [0];
  for (let i = 1; i <= N; i++) { const t = th((i - 0.5) * du); Y.push(Y[i - 1] + Math.sin(t) * du); Z.push(Z[i - 1] + Math.cos(t) * du); }
  const along = (u) => { const f = Math.max(0, Math.min(N - 1e-6, u / du)), i = Math.floor(f), k = f - i; return [Y[i] + (Y[i + 1] - Y[i]) * k, Z[i] + (Z[i + 1] - Z[i]) * k, th(u)]; };
  const ha = 0.095 - FOOT_SOLE, [ya, za, ta] = along(zb), lift = ya + ha * (Math.cos(ta) - 1), back = ha * Math.sin(ta) - (zb - za);
  // a point of the flat foot, [y, z], where the heeled one has it
  const pt = (y0, z0) => {
    let u = zb - z0;
    if (u <= 0) return [y0, z0 - back];
    if (u > 0.11) u = 0.11 + (u - 0.11) * 0.7;
    const [Yc, Zc, t] = along(u), h = y0 - FOOT_SOLE, a = smooth(0.06, 0.098, y0) * smooth(0.07, 0.03, Math.abs(z0));
    const y = FOOT_SOLE + Yc + h * Math.cos(t), z = zb - Zc + h * Math.sin(t) - back;
    // and the back of the heel leans in to the tendon as it climbs, instead of standing square behind it
    return [y + a * (y0 + lift - y), z + a * (z0 - z) + 0.014 * smooth(0.035, 0.09, y0) * smooth(-0.02, -0.06, z0)];
  };
  return { lift, pt };
})();
// where the shin comes down into the foot: a little inboard of the foot's own middle
const ANKLE_X = 0.0885;
function heelPose(M) {
  for (let i = 0; i < M.P.length; i += 3) {
    let x = M.P[i], z0 = M.P[i + 2];
    const y0 = M.P[i + 1], cx = Math.sign(x) * LEG_X;
    // the top of the foot is a shoe's last, a block wider than the shin over it: toward the ankle its back and
    // sides close in to the shin's own round, so the ankle is one column and the heel runs up into the tendon
    // (and it leans in under the shin, which comes down 8 mm inboard of the foot's middle: square under it, the
    // shin overhung the foot on the inside as a flap below the strap)
    x += Math.sign(x) * (ANKLE_X - LEG_X - 0.002) * smooth(0.04, 0.09, y0) * smooth(0.075, 0.02, Math.abs(z0));
    const ax = Math.sign(x) * ANKLE_X, r = Math.hypot(x - ax, z0 + 0.002), R = 0.0335;
    // the instep is a ridge running up to the ankle, not the flat top of a shoe: its sides draw in as it climbs
    x = ax + (x - ax) * (1 - 0.3 * smooth(0.04, 0.085, y0) * smooth(0.1, 0.05, z0) * smooth(-0.01, 0.02, z0));
    if (r > R) { const k = 1 + smooth(0.05, 0.098, y0) * smooth(0.03, 0, z0) * (R / r - 1); x = ax + (x - ax) * k; z0 = -0.002 + (z0 + 0.002) * k; }
    const [y, z] = HEEL.pt(y0, z0);
    M.P[i] = cx + (x - cx) * (1 - 0.2 * smooth(-0.005, -0.055, z0));
    M.P[i + 1] = y; M.P[i + 2] = z;
  }
  return M;
}
// (the shin's skin swells 8 mm a side at the ankle bones, which a boot hides and a strap shows as a lump over the
// foot: below 0.17 it's held to the round the foot's top closes to)
function ankleLift(M) {
  for (let i = 0; i < M.P.length; i += 3) {
    const x = M.P[i], y0 = M.P[i + 1], z = M.P[i + 2], cx = Math.sign(x) * ANKLE_X, r = Math.hypot(x - cx, z + 0.002), R = 0.0335;
    if (r > R && y0 < 0.17) { const k = 1 + smooth(0.17, 0.135, y0) * (R / r - 1); M.P[i] = cx + (x - cx) * k; M.P[i + 2] = -0.002 + (z + 0.002) * k; }
    M.P[i + 1] = y0 + HEEL.lift * smooth(0.34, 0.105, y0);
  }
  return M;
}
// A low shoe (`boots: 'dress'` or `'trainer'`): the upper on the shoe's last, and a sole of its own under it, a slab
// cut to the outline a little wider than the upper so its edge shows (in the pad's piece, which the paint reads as the
// sole: a dark welt for an oxford, white foam for a trainer). An oxford's toe box is pressed lower and longer, as a
// last for a dress shoe is; a trainer's is fuller and its sole thicker. (toeArc, next, is every shoe's toe.)
//
// Every shoe and boot ends in one smooth line across its front, rounding only at the corners, whatever the foot's
// outline under it: anything ahead of the line is drawn back onto it, so the big toe never shows through the leather.
// `cut` is how far behind the foot's furthest point the line runs, `round` how far its corners fall back.
function toeArc(rings, cut, round) {
  const all = rings.flatMap((g) => g.ring), zmax = Math.max(...all.map((p) => p[2])), front = all.filter((p) => p[2] > zmax - 0.04);
  const xs = front.map((p) => p[0]), xc = (Math.min(...xs) + Math.max(...xs)) / 2, hw = (Math.max(...xs) - Math.min(...xs)) / 2 + 0.004, toeZ = zmax - cut;
  return (p) => { if (p[2] < toeZ - 0.06) return p; const u = Math.min(1, Math.abs(p[0] - xc) / hw), zf = toeZ - round * u ** 2.6; return p[2] > zf ? [p[0], p[1], zf] : p; };
}
function lowShoe(side, level, kind) {
  const dress = kind === 'dress', L = side > 0 ? 'L' : 'R', w = toeW(L), M = newPart('foot' + L, FIG_SLOT.shoes);
  // (the toe springs up a third as far as a boot's: a low shoe's toe sits nearly on the floor)
  const spring = (z) => (z > 0.045 ? 0.004 + (shoeSole(z) - 0.004) * 0.35 : shoeSole(z));
  const lift = dress ? 0.008 : 0.02, floor = (z) => spring(z) + lift * (dress ? 0.4 + 0.6 * gx(z - 0.014, 0.027) : 1);
  const ext = dress ? [SHOE.heel - 0.002, SHOE.toe + 0.014] : [SHOE.heel + 0.004, SHOE.toe + 0.006];
  const up = footRings(side, level.cols.foot, level.dy.foot, dress ? SHOE.ease - 0.005 : SHOE.ease + 0.002, floor, ext);
  const zt = up[up.length - 1].ring[0][2];
  const arc = toeArc(up, dress ? 0.016 : 0.018, dress ? 0.016 : 0.02);
  // the upper, its toe pressed down toward the sole (an oxford's last is low and long in front)
  const press = (p0) => { const p = arc(p0); if (!dress) return p; const f = smooth(0.06, zt, p[2]), fl = floor(p[2]); return [p[0], fl + (p[1] - fl) * (1 - 0.32 * f), p[2]]; };
  const R = up.map(({ ring }) => ring.map((p) => addV(M, press(p), w(p[2]))));
  const tip = (rg) => { const c = rg.ring.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map((v) => v / rg.ring.length); return addV(M, press(c), w(c[2])); };
  capFan(M, R[0], tip(up[0]), true);
  stitchRings(M, R);
  capFan(M, R[R.length - 1], tip(up[up.length - 1]), false);
  // the sole: the outline grown a little, flattened between the floor and the sole's top edge
  const so = footRings(side, level.cols.foot, level.dy.foot, (dress ? SHOE.ease - 0.005 : SHOE.ease + 0.002) + (dress ? 0.0035 : 0.005), floor, [ext[0] + 0.003, ext[1] + 0.003]);
  const thick = dress ? 0.009 : 0.022;
  const S = so.map(({ ring }) => ring.map((q, j) => { const fl = floor(q[2]), top = Math.sin((j / ring.length) * TAU) >= 0; const a = arc([q[0], 0, q[2] - 0.003]); return addV(M, [q[0], top ? fl + thick - lift : Math.max(0.0008, fl - lift), a[2] + 0.003], w(q[2]), FIG_PIECE.pad); }));
  const mid = (rg, i) => { const c = rg.ring.reduce((a, q) => [a[0] + q[0], a[1] + q[2]], [0, 0]).map((v) => v / rg.ring.length); const z = Math.min(c[1], arc([c[0], 0, c[1] - 0.003])[2] + 0.003); return addV(M, [c[0], Math.max(0.0008, floor(z) - lift) + thick * 0.5, z], w(z), FIG_PIECE.pad); };
  capFan(M, S[0], mid(so[0]), true);
  stitchRings(M, S);
  capFan(M, S[S.length - 1], mid(so[so.length - 1]), false);
  return M;
}
function sandalMesh(side, level, leg, heeled = true) {
  // (every point carries the strap's piece code: in the shoes' slot the paint reads that as a dress shoe, with no
  // tread, sole line or scuffed toe)
  const L = side > 0 ? 'L' : 'R', w = toeW(L), M = newPart('foot' + L, FIG_SLOT.shoes), TOP = FOOT_SOLE + 0.0012, BOT = 0.001, AX = FIG_PIECE.strap;
  const rings = footRings(side, level.cols.foot, level.dy.foot, 0.003, () => 0, [0.003, 0.004]);
  const R = rings.map(({ ring }) => ring.map((q, j) => addV(M, [q[0], Math.sin((j / ring.length) * TAU) >= 0 ? TOP : BOT, q[2]], w(q[2]), AX)));
  const mid = (r) => { const c = r.ring.reduce((a, q) => [a[0] + q[0], a[1] + q[2]], [0, 0]).map((v) => v / r.ring.length); return addV(M, [c[0], (TOP + BOT) / 2, c[1]], w(c[1]), AX); };
  capFan(M, R[0], mid(rings[0]), true);
  stitchRings(M, R);
  capFan(M, R[R.length - 1], mid(rings[rings.length - 1]), false);
  // a band over the foot at `z`, from the sole's edge on one side to the other
  const band = (z, half) => {
    const [rx, cy, up, , cx, out] = bareSection(z), path = [], radii = [], n = 10, lift = 0.0024;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI, c = Math.cos(a), sn = Math.sin(a);
      path.push([side * (LEG_X + cx) + side * (rx + lift) * se(c, 2.3), Math.max(TOP - 0.002, cy + (up + lift) * se(sn, 2.2) - out * Math.max(0, c) * sn), z]);
      radii.push(half);
    }
    tubeAlong(M, path, radii, 6, w(z), [0, 0, 1], 0.3, AX);
  };
  band(0.112, heeled ? 0.0085 : 0.011);
  band(0.066, heeled ? 0.0042 : 0.0075);
  // down the back of the heel to the sole
  const ya = 0.112, S = leg.at(ya), lift = 0.003, hx = side * LEG_X;
  const back = [[hx, ya, S.cz - S.zb - lift], [hx, 0.088, -0.047], [hx, 0.066, -0.063], [hx, 0.04, -0.0725], [hx, TOP, -0.069]];
  tubeAlong(M, back, back.map(() => 0.0046), 6, w(-0.06), [1, 0, 0], 0.3, AX);
  if (!heeled) {
    // flat: a thicker sole and the strap round the ankle where it stands
    const ring = [], rr = [];
    for (let i = 0; i <= 16; i++) { const a = (i / 16) * TAU, c = Math.cos(a), sn = Math.sin(a); ring.push([S.cx + (Math.min(S.rx, 0.0335) + lift) * c, ya, S.cz + (Math.min(sn >= 0 ? S.zf : S.zb, 0.0335) + lift) * sn]); rr.push(0.005); }
    tubeAlong(M, ring, rr, 6, legW(L)(ya), [0, 1, 0], 0.3, AX);
    return M;
  }
  heelPose(M);
  // the heel under it, tapering to the floor (placed after the pose: it stands straight)
  const [hy, hz] = HEEL.pt(BOT, -0.05);
  tubeAlong(M, [[hx, hy + 0.003, hz + 0.003], [hx, hy * 0.6, hz], [hx, hy * 0.25, hz - 0.002], [hx, 0.004, hz - 0.003], [hx, 0.0018, hz - 0.003]], [0.0165, 0.012, 0.0095, 0.0085, 0.0016], 8, w(-0.06), [1, 0, 0], 1, AX);
  // and the strap round the ankle, where the ankle now is
  const yr = ya + HEEL.lift, ring = [], rr = [];
  for (let i = 0; i <= 16; i++) { const a = (i / 16) * TAU, c = Math.cos(a), sn = Math.sin(a); ring.push([S.cx + (Math.min(S.rx, 0.0335) + lift) * c, yr, S.cz + (Math.min(sn >= 0 ? S.zf : S.zb, 0.0335) + lift) * sn]); rr.push(0.0042); }
  tubeAlong(M, ring, rr, 6, legW(L)(ya), [0, 1, 0], 0.3, AX);
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
  const fine = level.name === 'hd', cols = fine ? 9 : 5, pc = fine ? 20 : 10;
  const F = [
    { z: 0.0255, ph: [0.035, 0.023, 0.018], r: 0.0088, bend: [0.1, 0.34, 0.26] },
    { z: 0.0085, ph: [0.038, 0.026, 0.019], r: 0.0093, bend: [0.14, 0.4, 0.3] },
    { z: -0.0095, ph: [0.035, 0.024, 0.018], r: 0.0087, bend: [0.2, 0.46, 0.32] },
    { z: -0.0265, ph: [0.027, 0.017, 0.015], r: 0.0075, bend: [0.28, 0.52, 0.34] },
  ];
  const knuckleY = (z) => 0.786 + 0.1 * Math.max(0, -z) - 0.05 * Math.max(0, z);
  // the palm, wrist to knuckles: thick at the heel, broad at the knuckles, each knuckle a bump on the back
  const palm = [];
  // (its first ring is the forearm's last: as thick, and centred where the forearm is, so the wrist is one line. It
  // started 8 mm inboard of the forearm and 9 mm thinner, a step all the way round the inside of the wrist. From there
  // it thins to a palm and its back rounds over: a hand's back is a low arch from the index knuckle to the little one)
  for (const t of fine ? [0, 0.1, 0.22, 0.36, 0.5, 0.64, 0.78, 0.92, 1] : [0, 0.25, 0.5, 0.75, 0.92, 1]) {
    const wr = 1 - smooth(0, 0.4, t), y0 = 0.868 - 0.082 * t + (t === 0 ? 0.0085 : 0), rz = 0.0265 - 0.0015 * wr + 0.0165 * smooth(0, 0.65, t), rx = 0.0155 - 0.003 * t + 0.0033 * wr, cz = -0.004 + 0.005 * t, ring = [];
    for (let j = 0; j < pc; j++) {
      const a = (j / pc) * TAU, c = Math.cos(a), s = Math.sin(a), z = cz + rz * se(s, 2.5 - 0.4 * wr);
      let px = rx * se(c, 2.5 - 0.4 * wr) - 0.0028 * wr;
      if (c > 0) px += 0.0022 * smooth(0.15, 0.6, t) * (1 - ((z - cz) / rz) ** 2) * c;             // the back's arch
      if (c < 0) px += 0.002 * gx(t - 0.5, 0.22) * (1 - ((z - cz) / rz) ** 2) * c * -1;              // and the palm's hollow
      if (c > 0) for (const f of F) px += 0.0026 * smooth(0.7, 1, t) * gx(z - f.z, 0.0065) * c;   // the knuckles
      const y = t > 0.5 ? y0 + (knuckleY(z) - 0.786) * smooth(0.5, 1, t) : y0;
      ring.push(addV(M, [x + side * px, y, z], wt));
    }
    palm.push(ring);
  }
  capFan(M, palm[0], addV(M, [x, fine ? 0.879 : 0.873, -0.004], wt), true);
  stitchRings(M, palm);
  capFan(M, palm[palm.length - 1], addV(M, [x, 0.776, 0.002], wt), false);
  // the fingers: down from their knuckles, each bone bent further toward the palm. Each finger's vertices carry
  // -(1 + finger + 0.9 t) in aux, t how far along it they are, so the shader can curl it (gl/figure-hd.js curl)
  const tag = (v0, fi, root, len) => { for (let v = v0; v < M.P.length / 3; v++) { const d = Math.hypot(M.P[v * 3] - root[0], M.P[v * 3 + 1] - root[1], M.P[v * 3 + 2] - root[2]); M.A[v] = -(1 + fi + 0.9 * Math.min(0.999, d / len)); } };
  F.forEach((f, fi) => {
    const v0 = M.P.length / 3, root = [x + side * 0.001, knuckleY(f.z) + 0.006, f.z];
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
    tag(v0, fi, root, f.ph[0] + f.ph[1] + f.ph[2]);
    // its knuckle and its two finger joints, which gl/figure-hd.js folds it at
    (M.joints ||= []).push({ root, j: [path[0], path[2], path[4]], len: f.ph[0] + f.ph[1] + f.ph[2] });
    (M.tips ||= []).push({ p: path[path.length - 1], d: norm3(path[path.length - 1].map((v, j) => v - path[path.length - 2][j])) });
  });
  // the thumb: its muscle on the heel of the palm, then two bones, set forward of the palm and turned in
  ellipsoidInto(M, [x - side * 0.0065, 0.836, 0.0185], [0.0095, 0.026, 0.015], 8, 6, wt);
  {
    const path = [[x - side * 0.006, 0.844, 0.024]], radii = [0.0125], dirs = [[-0.22, -0.78, 0.58], [-0.3, -0.9, 0.3], [-0.4, -0.9, 0.1]], lens = [0.03, 0.02, 0.018], R = [0.0118, 0.0104, 0.0098, 0.0092, 0.0066], rr = [0, 1, 2, 3, 4];
    let p = path[0], ri = 0;
    dirs.forEach((d0, b) => {
      const d = norm3([d0[0] * side, d0[1], d0[2]]), n = b === 0 ? 1 : 2;
      for (let h = 0; h < n; h++) { p = p.map((v, j) => v + (d[j] * lens[b]) / n); path.push(p.slice()); radii.push(R[rr[ri++]]); }
    });
    const v0 = M.P.length / 3;
    tubeAlong(M, path, radii, cols, wt, [1, 0, 0], 0.88);
    tag(v0, 4, path[0], 0.068);
    // its three joints, which gl/figure-hd.js folds it at: the root on the heel of the palm, the knuckle after its
    // first bone and the last joint after its second
    M.thumb = { root: path[0], j: [path[0], path[1], path[3]], len: 0.068 };
    (M.tips ||= []).push({ p: path[path.length - 1], d: norm3(path[path.length - 1].map((v, j) => v - path[path.length - 2][j])) });
  }
  return M;
}
// ── Held props ───────────────────────────────────────────────────────────────────────────────────────
// Rigid on the hand bone, placed on the hand as handMesh scales it about the wrist but kept at their own size.
// A settled look names them (flags.figure.props, { L: 'cigarette', R: 'scotch' }), which room-people.js turns
// into the mesh key's 'L:cigarette;R:scotch'. Each part is on the horn slot with its own FIG_PIECE, and its uv
// is [round, along], so gl/figure-hd.js propPaint colours it: a cigarette's filter, paper and ember; a tumbler's
// glass with the whisky seen through it to the fill line, the whisky's surface and the ice.
export const propsOf = (str) => Object.fromEntries(String(str || '').split(';').filter(Boolean).map((e) => e.split(':')));
export const propKey = (props) => (props ? Object.keys(props).sort().filter((k) => props[k]).map((k) => k + ':' + props[k]).join(';') : '');
export const PROPS = {
  // held between the index and middle fingers below the knuckles, lit end out past the back of the hand
  cigarette: { at: [-0.022, 0.766, 0.017] },
  // a short tumbler in the curl of the fingers, on the palm's side
  scotch: { at: [-0.05, 0.738, 0.012] },
};
const SCOTCH = { r0: 0.034, r1: 0.0375, h: 0.085, base: 0.007, fill: 0.052 };
// a glass stays upright: it rides its own bone (FIGURE_XBONES prop L/R), which follows this point on the hand
const UPRIGHT = { scotch: true };
// where a prop sits on its hand in bind space, for a hand scaled by k about the wrist
export function propBind(name, side, k) {
  const x0 = side * ARM_X, W = [x0, 0.868, -0.004], a = PROPS[name].at;
  return [x0 + side * a[0], a[1], a[2]].map((v, j) => W[j] + (v - W[j]) * k);
}
// The sculpted hand's fingertips in bind space as modelled, for a hand scaled by k about the wrist: the index,
// middle, ring and little fingers, then the thumb. gl/figure-hands.js bends them as the shader bends the
// fingers, so a pinch is found where the fingers really close.
const TIPS = {}, HANDS = {};
const handOnce = (s) => (HANDS[s] ??= handSculpt(s, FIGURE_LEVELS.hd));
export function fingerTipsOf(side, k) {
  const s = side > 0 ? 1 : -1, W = [s * ARM_X, 0.868, -0.004];
  TIPS[s] ??= handOnce(s).tips.map((t) => t.p);
  return TIPS[s].map((p) => p.map((v, j) => W[j] + (v - W[j]) * k));
}
// Each finger's joints on the left hand in bind space, scaled by k about the wrist: the knuckle, the middle joint
// and the last one, and where along the finger (0 to 1, as handSculpt tags it) the two finger joints fall.
export function fingerJointsOf(k = 1) {
  const W = [ARM_X, 0.868, -0.004], sc = (p) => p.map((v, j) => W[j] + (v - W[j]) * k);
  return handOnce(1).joints.map(({ root, j, len }) => ({ j: j.map(sc), t: [1, 2].map((i) => Math.min(0.999, Math.hypot(j[i][0] - root[0], j[i][1] - root[1], j[i][2] - root[2]) / len)) }));
}
// The thumb's the same: its root, its knuckle and its last joint, and where along it (as tagged) the two fall.
export function thumbJointsOf(k = 1) {
  const W = [ARM_X, 0.868, -0.004], sc = (p) => p.map((v, j) => W[j] + (v - W[j]) * k), { root, j, len } = handOnce(1).thumb;
  return { j: j.map(sc), t: [1, 2].map((i) => Math.min(0.999, Math.hypot(j[i][0] - root[0], j[i][1] - root[1], j[i][2] - root[2]) / len)) };
}
// the hand's scale (buildFigure's hk) for a key, so room-people.js can find the prop on it
// 0.97 at an average build (1.1 read as mitts); a figure with a bust takes 0.9 of that
export function handScaleOf({ build = 'average', weight = null, body = null, bust = null } = {}, side = 1) {
  const BK = buildOf(build), SW = weight !== null && weight !== undefined ? somaOf(weight) : null;
  return 0.97 * (bust > 0 ? 0.9 : 1) * Math.sqrt(BK.arm) * (SW ? SW.hand : 1) * (body?.mighty === (side > 0 ? 'L' : 'R') ? 1.12 : 1);
}
export const propUpright = (name) => !!UPRIGHT[name];
function propMesh(name, side, level, k) {
  const L = side > 0 ? 'L' : 'R', wt = [[B[(UPRIGHT[name] ? 'prop' : 'hand') + L], 1]], M = newPart('prop' + L, FIG_SLOT.horn), x0 = side * ARM_X;
  const at = propBind(name, side, k), cols = level.name === 'hd' ? 16 : 8;
  // a lathe round axis A from point c: prof is [[radius, distance along]], uv [round, distance / len]
  const lathe = (c, A, prof, len, aux, cap0, cap1) => {
    const U = norm3(cross(A, Math.abs(A[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), V = cross(A, U), rings = [];
    for (const [r, t] of prof) {
      const ring = [];
      for (let j = 0; j < cols; j++) {
        const th = (j / cols) * TAU, cu = Math.cos(th) * r, sv = Math.sin(th) * r;
        ring.push(addV(M, [c[0] + A[0] * t + U[0] * cu + V[0] * sv, c[1] + A[1] * t + U[1] * cu + V[1] * sv, c[2] + A[2] * t + U[2] * cu + V[2] * sv], wt, aux, [j / cols, t / len]));
      }
      rings.push(ring);
    }
    stitchRings(M, rings);
    const end = (i, top) => { const [, t] = prof[i]; capFan(M, rings[i], addV(M, [c[0] + A[0] * t, c[1] + A[1] * t, c[2] + A[2] * t], wt, aux, [0.5, t / len]), top); };
    if (cap0) end(0, false);
    if (cap1) end(prof.length - 1, true);
  };
  if (name === 'cigarette') {
    const A = norm3([side, 0.22, 0.12]), len = 0.082;
    lathe(at, A, [[0.0045, 0], [0.0045, len * 0.3], [0.0045, len * 0.97], [0.0042, len]], len, FIG_PIECE.cig, true, true);
  } else if (name === 'scotch') {
    const S = SCOTCH, up = [0, 1, 0];
    // the glass: a heavy base, the wall flaring a little to the rim, open at the top
    lathe(at, up, [[S.r0 - 0.002, 0], [S.r0, 0.003], [S.r0 + 0.0008, S.base], [S.r0 + 0.002, S.fill], [S.r1, S.h]], S.h, FIG_PIECE.glass, true, false);
    // the whisky's surface, and two cubes of ice in it
    lathe(at, up, [[S.r0 - 0.0015, S.fill]], S.h, FIG_PIECE.liquid, false, true);
    for (const [dx, dz, sz, tw] of [[0.011, -0.006, 0.016, 0.5], [-0.012, 0.009, 0.014, -0.3]]) {
      const cy = at[1] + S.fill + 0.002, cx = at[0] + dx, cz = at[2] + dz, c = Math.cos(tw), s2 = Math.sin(tw), h = sz / 2;
      const P = (x, y, z) => [cx + c * x - s2 * z, cy + y, cz + s2 * x + c * z];
      const v = [P(-h, -h, -h), P(h, -h, -h), P(h, h, -h), P(-h, h, -h), P(-h, -h, h), P(h, -h, h), P(h, h, h), P(-h, h, h)].map((q) => addV(M, q, wt, FIG_PIECE.ice, [0, 0]));
      for (const [i0, i1, i2, i3] of [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]]) M.I.push(v[i0], v[i1], v[i2], v[i0], v[i2], v[i3]);
    }
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
  { n: 110, len: [0.12, 0.22], w: 0.034, segs: 7, lift: 0.08, grav: 0.9 },
];
const SHELL_T = [0.0032, 0.0042, 0.008, 0.007, 0.011, 0.006];
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
    if (style === 5 && skulletHair(root[0], root[1], root[2]) < 0.5) continue;   // the skullet's bald dome
    const nS = scalpNormal(y, phi);
    const p0 = [root[0] + nS[0] * SHELL_T[style] * 0.7, root[1] + nS[1] * SHELL_T[style] * 0.7, root[2] + nS[2] * SHELL_T[style] * 0.7];
    // where it's combed to, before gravity
    let comb;
    const ax = root[0], back = root[2] < -0.02;
    if (style === 1) comb = ax > 0.024 ? [1, -0.25, -0.35] : [-1, -0.1, -0.25];
    else if (style === 2) { const a = r() * TAU; comb = [Math.cos(a), 0.2, Math.sin(a)]; }
    else if (style === 3) comb = [Math.sign(ax || 1) * 0.3, -1, root[2] > 0.03 ? 0.0 : -0.25];
    else if (style === 5) comb = [Math.sign(ax || 1) * 0.15, -0.7, -0.7];
    else comb = root[2] > 0 && Math.abs(ax) < 0.045 ? [0, 0.9, -0.5] : [0, -0.6, -0.8];
    if (back && style !== 3 && style !== 4 && style !== 5) comb = [comb[0] * 0.4, -0.8, -0.5];
    // into the scalp's plane, then lifted off it by the style
    const dn = comb[0] * nS[0] + comb[1] * nS[1] + comb[2] * nS[2];
    let dir = norm3([comb[0] - nS[0] * dn + nS[0] * S.lift, comb[1] - nS[1] * dn + nS[1] * S.lift, comb[2] - nS[2] * dn + nS[2] * S.lift]);
    let len = S.len[0] + (S.len[1] - S.len[0]) * r();
    if (style === 5) len *= root[2] < -0.02 ? 1 : 0.4;   // long down the back only
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
      if ((style === 3 || style === 5) && q[1] < 1.645) {
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
const LOCK_STYLE = [null, [0.45, 0.2, 0.92, 1, 0.5], [1.05, 1.25, 0.85, 0.82, 2.2], [0.6, 0.1, 1, 1.12, 0.8], [1, 1, 1, 1, 1], [0, 0, 1, 1, 1]];
// The skullet's hair (style 5, actor-head.js skulletHair), the scruffy kind a man grows when it's gone on
// top and he won't give up the rest: the dome bare; a horseshoe from in front of each ear round the back,
// combed back over the ears and left to hang, below the jaw at the sides and past the collar behind. Thin
// and stringy, of uneven lengths, standing off the head so it has volume and isn't a slab. Rooted on the
// skull itself (skullPoint), so the locks spread evenly round the sides; the painted scalp under them
// (gl/figure-hd.js skulletPaint) gives the thinning edge into the bald.
function skulletLocks(M, r, hd, cols, wt, fs) {
  const off = (p, k) => { const dx = p[0], dz = p[2] - ZC, L = Math.hypot(dx, dz) || 1; return [p[0] + (dx / L) * k, p[1], p[2] + (dz / L) * k]; };
  const ok = (p) => p[1] > hairlineAt(p[0], p[2], HAIRLINE_SCULPT) + 0.004 && skulletHair(p[0], p[1], p[2]) > 0.6;
  const rowsY = hd ? [1.618, 1.64, 1.662, 1.684] : [1.63, 1.668], step = hd ? 8 : 22, over = hd ? 3 : 2, fall = hd ? 7 : 3;
  rowsY.forEach((y0r, row) => {
    for (const sd of [1, -1]) for (let a = 58 - (row % 2) * step * 0.5; a >= -90; a -= step) {
      if (sd < 0 && a <= -89) continue;   // the middle of the back once
      const y0 = y0r + (r() - 0.5) * 0.008, phi0 = (a + (r() - 0.5) * step * 0.5) * D2R, root = skullPoint(y0, phi0, fs);
      if (!ok(root)) continue;
      // how far round to the side it grows (1 in front of the ear, 0 at the middle of the back)
      const sideK = Math.max(0, Math.min(1, (a + 90) / 148));
      const sweep = (10 + 12 * r()) * sideK * D2R, yS = Math.min(y0 - 0.014, 1.61), lay = 0.0045 + 0.0035 * row;
      // the end: under the jaw at the sides, past the collar at the back, never two the same
      const yEnd = 1.4 + 0.12 * sideK ** 1.2 + (r() - 0.35) * 0.05;
      const sp = [];
      for (let i = 0; i <= over; i++) { const t = i / over; sp.push(off(skullPoint(y0 + (yS - y0) * t, phi0 - sweep * t, fs), lay + 0.003 * t)); }
      const e = sp[over], jx = (r() - 0.5) * 0.016, jz = (r() - 0.5) * 0.014, wav = r() * 6.28, wa = 0.0025 + 0.002 * r();
      for (let i = 1; i <= fall; i++) {
        const u = i / fall, y = yS + (yEnd - yS) * u;
        // out over the ear, then a little fuller and kicking out at the ends
        const ear = 0.016 * sideK * Math.exp(-(((y - 1.61) / 0.045) ** 2)), q = off(e, 0.004 * Math.sin(Math.PI * Math.min(1, u * 1.1)) + ear + 0.012 * u * u);
        // a slight wave down it, and the ends splaying apart
        const wv = wa * Math.sin(wav + u * 9) * u;
        sp.push([q[0] + jx * u * u + wv, y, q[2] + jz * u * u - 0.008 * u * sideK + wv * 0.6]);
      }
      const spine = sd > 0 ? sp : sp.map((v) => [-v[0], v[1], v[2]]);
      lockBlade(M, spine, (hd ? 0.0105 : 0.026) * (0.7 + 0.6 * r()), r(), hd ? 4 : cols, wt);
    }
  });
}
// ── The cuts past the street's six (the MORPHEX's, client/shared/morphex-catalog.js) ────────────────
// Only the sculpted figure draws them, from the same blades as the six; anything else draws a cut as its
// `base`. `paint` is what the shader paints on the scalp under it (gl/figure-hd.js uFace.z): 0 a crop's
// stubble, which is what shaved sides are, 1 the hair's own colour.
export const HAIR_CUTS = {
  6: { name: 'bob', base: 3, paint: 1 }, 7: { name: 'ponytail', base: 1, paint: 1 }, 8: { name: 'bun', base: 1, paint: 1 },
  9: { name: 'mohawk', base: 0, paint: 0 }, 10: { name: 'afro', base: 2, paint: 1 }, 11: { name: 'dreadlocks', base: 3, paint: 1 },
  12: { name: 'cornrows', base: 0, paint: 1 }, 13: { name: 'undercut', base: 4, paint: 0 }, 14: { name: 'pompadour', base: 4, paint: 1 },
  15: { name: 'pixie', base: 2, paint: 1 }, 16: { name: 'braided', base: 3, paint: 1 }, 17: { name: 'top knot', base: 0, paint: 0 },
  18: { name: 'mullet', base: 5, paint: 1 }, 19: { name: 'wolf cut', base: 2, paint: 1 }, 20: { name: 'buns', base: 1, paint: 1 },
  21: { name: 'curtains', base: 1, paint: 1 }, 22: { name: 'slicked-back', base: 1, paint: 1 }, 23: { name: 'side part', base: 1, paint: 1 },
  24: { name: 'comb-over', base: 0, paint: 0 }, 25: { name: 'liberty spikes', base: 2, paint: 0 }, 26: { name: 'shag', base: 3, paint: 1 },
  27: { name: 'pigtails', base: 3, paint: 1 }, 28: { name: 'beehive', base: 4, paint: 1 }, 29: { name: 'man bun', base: 1, paint: 1 },
  30: { name: 'half up', base: 3, paint: 1 }, 31: { name: 'long waves', base: 3, paint: 1 }, 32: { name: 'flat top', base: 0, paint: 0 },
};
// The cuts each street style can become on a rolled NPC's close-up, so the street and the close-up still agree
// (the street draws a cut as its base): the street's six, by index, to what can stand in for them.
export const CUTS_OF_BASE = [0, 1, 2, 3, 4, 5].map((b) => [b, ...Object.keys(HAIR_CUTS).map(Number).filter((k) => HAIR_CUTS[k].base === b)]);
// what the shader's paint takes for a style, and the street's own style for one it can't draw
export const cutPaint = (style) => (HAIR_CUTS[style] ? HAIR_CUTS[style].paint : style);
export const cutBase = (style) => (HAIR_CUTS[style] ? HAIR_CUTS[style].base : style);
function cutLocks(M, style, r, hd, rows, cols, wt) {
  const rad = (d) => d * D2R, step = (a, b) => (hd ? a : b);
  const blade = (sp, w) => lockBlade(M, sp, w * (hd ? 1 : 1.3), r(), cols, wt);
  // a lock over the scalp from (th0, la0) to (th1, la1) in degrees: `up` off it at its fullest, `lift` at the tip
  const over = (th0, th1, la0, la1, up, lift, n = rows) => {
    const sp = [];
    for (let i = 0; i <= n; i++) { const t = i / n; sp.push(lockPoint(rad(th0 + (th1 - th0) * t), rad(la0 + (la1 - la0) * t), 1.012 + up * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.8 * 0.55 + lift * t * t * t)); }
    return sp;
  };
  // then let it fall from where it ended to y1, full in the middle and a little out at the ends
  const hang = (sp, y1, n = hd ? 5 : 3, flare = 0.1) => {
    const e = sp[sp.length - 1];
    for (let i = 1; i <= n; i++) { const t = i / n, k = 1 + flare * Math.sin(Math.PI * Math.min(1, t * 1.3)) + 0.12 * t; sp.push([e[0] * k, e[1] + (y1 - e[1]) * t, ZC - 0.012 + (e[2] - ZC + 0.012) * k]); }
    return sp;
  };
  // a knot of curled loops round c, R across: a bun
  const knot = (c, R, n) => {
    for (let j = 0; j < n; j++) {
      const a = r() * TAU, b = Math.acos(2 * r() - 1), u = [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)];
      const v = norm3(cross(u, Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), a0 = r() * TAU, sp = [];
      for (let i = 0; i <= 4; i++) { const q = a0 + i * 0.55; sp.push([c[0] + R * (Math.cos(q) * u[0] + Math.sin(q) * v[0]), c[1] + R * (Math.cos(q) * u[1] + Math.sin(q) * v[1]), c[2] + R * (Math.cos(q) * u[2] + Math.sin(q) * v[2])]); }
      lockBlade(M, sp, R * 0.75, r(), cols, wt);
    }
  };
  // a rope straight down from root to y1, swinging back off the head and a little to `side`
  const rope = (root, y1, side = 0, w = 0.014, n = hd ? 8 : 4, plait = false) => {
    const sp = [root];
    for (let i = 1; i <= n; i++) {
      const t = i / n, zig = plait ? (i % 2 ? 0.006 : -0.006) : 0;
      sp.push([root[0] * (1 - 0.3 * t) + side * 0.03 * t + zig, root[1] - (root[1] - y1) * t, root[2] - 0.035 * Math.sin(Math.PI * Math.min(1, t * 1.6)) - 0.012 * t]);
    }
    if (!plait) { blade(sp, w); return; }
    // a plait: short fat blades one after another, crossing
    for (let i = 0; i < n; i++) lockBlade(M, [sp[i], [(sp[i][0] + sp[i + 1][0]) / 2 - (i % 2 ? 0.004 : -0.004), (sp[i][1] + sp[i + 1][1]) / 2, (sp[i][2] + sp[i + 1][2]) / 2 + 0.003], sp[i + 1]], w * (1 - 0.35 * i / n), r(), cols, wt);
  };
  // hair laid flat and drawn back to thEnd, gathered toward the middle by `pull`
  const flatBack = (thEnd, pull) => { for (let la = -72; la <= 72; la += step(12, 24)) blade(over(26 + Math.abs(la) * 0.4, thEnd, la, la * pull, 0.035, 0), 0.026); };
  switch (style) {
    case 6:   // a bob: over from the crown and down to the jaw all round, a straight fringe
      for (let a = -104; a <= 104; a += step(13, 34)) { const side = Math.abs(a) / 104; blade(hang(over(70 + 20 * r(), 168 - 34 * side, a * 0.72, a * 0.75, 0.05, 0.02, hd ? 4 : 2), 1.552 + 0.008 * r(), hd ? 4 : 2, 0.16), 0.03); }
      for (let la = -44; la <= 44; la += step(8, 22)) blade(over(78, 24, la, la * 1.04, 0.05, 0.01), 0.022);
      break;
    case 7:   // a ponytail: flat back to a tie at the crown's back and a tail to the shoulder blades
      flatBack(152, 0.2);
      for (let k = -3; k <= 3; k += step(1, 3)) rope(lockPoint(rad(152), rad(k * 4), 1.05), 1.36 + 0.03 * r(), 0, 0.015);
      break;
    case 8:   // a bun at the back of the crown
      flatBack(130, 0.15);
      knot(lockPoint(rad(128), 0, 1.16), 0.034, step(16, 6));
      break;
    case 9:   // a mohawk: a crest of stiff points from the forehead to the nape, the sides shaved
      for (let th = 22; th <= 186; th += step(8, 20)) for (const la of hd ? [-5, 5] : [0]) {
        const tall = 0.28 + 0.24 * Math.sin(Math.PI * (th - 22) / 164);
        blade(over(th, th + 12, la, la * 0.5, 0, tall), 0.02);
      }
      break;
    case 10: {  // an afro: a round mass, wide locks lying on a sphere well off the head, more standing out to fill it
      const ball = (th, la) => 1.0 + 0.36 * Math.min(1, Math.max(0, (205 - th) / 40)) * Math.min(1, Math.max(0, (110 - Math.abs(la)) / 30));
      for (let th = 16; th <= 200; th += step(11, 26)) for (let la = -100; la <= 100; la += step(13, 32)) {
        if (th < 36 && Math.abs(la) < 58) continue;   // the hairline stays where it is
        const sp = [];
        for (let i = 0; i <= 3; i++) { const t2 = th + i * 7, l2 = la + (r() - 0.5) * 6; sp.push(lockPoint(rad(t2), rad(l2), ball(t2, l2) + 0.02 * (r() - 0.5))); }
        blade(sp, 0.05);
        if (hd && r() < 0.5) blade(over(th, th + 4, la, la, 0, ball(th, la) - 1.0), 0.03);
      }
      break;
    }
    case 11:  // dreadlocks: ropes from all over the scalp, falling to the shoulders, the front ones off the face
      for (let th = 40; th <= 172; th += step(22, 44)) for (let la = -80; la <= 80; la += step(20, 40)) {
        const front = th < 80, la1 = front ? Math.sign(la || 1) * Math.max(Math.abs(la), 58) : la * 1.1;
        const sp = over(th, Math.min(th + 70, 178), la, la1, 0.02, 0.03, hd ? 3 : 2);
        blade(hang(sp, 1.4 + 0.05 * r() + 0.04 * (Math.abs(la) / 80), hd ? 5 : 3, 0.06), 0.0105);
      }
      break;
    case 12:  // cornrows: close rows from the hairline to the nape
      for (let la = -64; la <= 64; la += step(10, 20)) blade(over(24 + Math.abs(la) * 0.3, 206, la, la * 0.85, 0.012, 0, hd ? 10 : 5), 0.0095);
      break;
    case 13:  // an undercut: long on top and swept to one side, the sides shaved
      for (let la = -40; la <= 40; la += step(9, 20)) blade(over(24, 112, la, 64 + la * 0.3, 0.16, 0.05), 0.027);
      break;
    case 14:  // a pompadour: the front swept up high and back, the rest flat behind it
      for (let la = -46; la <= 46; la += step(9, 23)) blade(over(18, 104, la, la * 0.9, 0.34, 0.06), 0.027);
      for (let la = -64; la <= 64; la += step(14, 32)) blade(over(100, 192, la, la * 0.8, 0.05, 0), 0.026);
      break;
    case 15:  // a pixie: short and choppy, the points lying forward, a fringe to one side
      for (let th = 40; th <= 150; th += step(22, 44)) for (let la = -72; la <= 72; la += step(14, 36)) blade(over(th + 30, th - 8, la, la * 1.08 + 10, 0.07, 0.04, hd ? 4 : 2), 0.02);
      for (let la = -30; la <= 30; la += step(10, 30)) blade(over(76, 26, la, la + 30, 0.06, 0.01), 0.02);
      break;
    case 16:  // braided: flat back and two plaits down behind the shoulders
      flatBack(168, 0.5);
      for (const s of [1, -1]) rope(lockPoint(rad(166), rad(s * 34), 1.04), 1.24, s, 0.019, hd ? 12 : 6, true);
      break;
    case 17:  // a top knot: the sides shaved, the top drawn up into a knot
      for (let la = -54; la <= 54; la += step(14, 36)) blade(over(36 + Math.abs(la) * 0.3, 92, la, la * 0.1, 0.04, 0), 0.024);
      knot(lockPoint(rad(96), 0, 1.17), 0.028, step(12, 5));
      break;
    case 18:  // a mullet: short on top and at the sides, long at the back
      for (let la = -58; la <= 58; la += step(14, 29)) blade(over(26, 122, la, la, 0.1, 0.05), 0.026);
      for (let a = -72; a <= 72; a += step(12, 36)) blade(hang(over(124, 176, a, a * 0.8, 0.03, 0, hd ? 3 : 2), 1.43 + 0.03 * r(), hd ? 5 : 3, 0.08), 0.028);
      break;
    case 19:  // a wolf cut: shaggy layers, longest at the back, a choppy fringe
      for (let th = 40; th <= 150; th += step(22, 44)) for (let la = -84; la <= 84; la += step(17, 42)) {
        const sp = over(th, th + 46, la, la * 1.18, 0.13, 0.08, hd ? 4 : 2);
        blade(th > 90 || Math.abs(la) > 50 ? hang(sp, 1.5 + 0.05 * r(), hd ? 3 : 2, 0.18) : sp, 0.025);
      }
      for (let la = -36; la <= 36; la += step(9, 36)) blade(over(74, 24, la, la * 1.1, 0.07, 0.02), 0.02);
      break;
    case 20:  // two buns high on the head
      flatBack(100, 0.4);
      for (const s of [1, -1]) knot(lockPoint(rad(82), rad(s * 44), 1.14), 0.027, step(12, 5));
      break;
    case 21:  // curtains: parted in the middle, each side falling away from the parting to the cheekbone, the back to the collar
      for (const s of [1, -1]) for (let la = 4; la <= 56; la += step(9, 26)) blade(hang(over(72, 32, s * la * 0.35, s * (44 + la * 0.65), 0.07, 0.02, hd ? 4 : 2), 1.57 + 0.01 * r(), hd ? 3 : 2, 0.1), 0.025);
      for (let a = -92; a <= 92; a += step(14, 46)) blade(hang(over(84, 168, a * 0.7, a * 0.76, 0.05, 0.02, hd ? 3 : 2), 1.5 + 0.02 * r(), hd ? 3 : 2, 0.1), 0.028);
      break;
    case 22:  // slicked back: flat and close, combed straight back from the hairline to the nape
      for (let la = -72; la <= 72; la += step(10, 24)) blade(over(20 + Math.abs(la) * 0.32, 198, la, la * 0.62, 0.04, 0.005), 0.027);
      break;
    case 23:  // a side part: parted high on the left, the top combed across to the right, the sides and back short
      for (let la = -62; la <= 24; la += step(9, 29)) blade(over(24 + Math.abs(la) * 0.2, 104, la, la - 26, 0.09, 0.02), 0.026);
      for (let la = 38; la <= 72; la += step(10, 34)) blade(over(36, 116, la, la * 1.05, 0.05, 0), 0.024);
      for (let la = -64; la <= 64; la += step(16, 32)) blade(over(104, 190, la, la * 0.8, 0.045, 0), 0.026);
      break;
    case 24:  // a comb-over: the sides cropped, a few long strands from above one ear laid across the bare top
      for (let k = 0; k < step(6, 3); k++) blade(over(34 + k * step(13, 26), 44 + k * step(13, 26) + 8 * r(), 70, -52 - 10 * r(), 0.018, 0.004, hd ? 6 : 3), 0.014);
      break;
    case 25:  // liberty spikes: a row of tall cones from the forehead to the crown's back, the sides shaved
      for (let th = 24; th <= 168; th += step(18, 36)) blade(over(th, th + 4, 0, 0, 0, 0.5 + 0.15 * Math.sin(Math.PI * (th - 24) / 144)), 0.042);
      break;
    case 26:  // a shag: choppy layers all over, feathered at the sides and long at the back, a heavy fringe
      for (let th = 34; th <= 160; th += step(18, 42)) for (let la = -90; la <= 90; la += step(15, 45)) {
        const sp = over(th, th + 44, la, la * 1.22, 0.12, 0.06, hd ? 4 : 2);
        blade(th > 70 || Math.abs(la) > 40 ? hang(sp, 1.45 + 0.07 * r(), hd ? 4 : 2, 0.22) : sp, 0.026);
      }
      for (let la = -40; la <= 40; la += step(8, 40)) blade(hang(over(70, 22, la, la * 1.1, 0.08, 0.01, hd ? 3 : 2), 1.66 + 0.01 * r(), 2, 0.04), 0.021);
      break;
    case 27:  // pigtails: parted in the middle, drawn down to a tie low behind each ear and hanging from there
      for (const s of [1, -1]) {
        for (let la = 2; la <= 74; la += step(10, 36)) blade(over(26 + la * 0.3, 128, s * la, s * 74, 0.035, 0), 0.025);
        // the back of the crown, drawn down and round to the same tie
        for (let la = 3; la <= 63; la += step(12, 30)) blade(over(84 + la * 0.3, 134, s * la * 0.5, s * 76, 0.035, 0), 0.026);
        // and the nape, drawn up to it from below
        for (let la = 3; la <= 63; la += step(12, 30)) blade(over(204 - la * 0.3, 138, s * la * 0.6, s * 76, 0.03, 0), 0.026);
        const tie = lockPoint(rad(128), rad(s * 76), 1.06);
        knot(tie, 0.012, step(5, 3));
        rope(tie, 1.36 + 0.02 * r(), s * 2, 0.018);
      }
      break;
    case 28: {  // a beehive: piled high on the crown in a tall rounded mass, a swept fringe in front of it
      const hive = (th, la) => 1.02 + 0.5 * Math.exp(-(((th - 84) / 52) ** 2)) * Math.max(0, Math.cos(la * D2R)) ** 1.5;
      for (let th = 30; th <= 196; th += step(12, 28)) for (let la = -84; la <= 84; la += step(14, 34)) {
        const sp = [];
        for (let i = 0; i <= 3; i++) { const t2 = th + i * 8, l2 = la + 14 * i * (la >= 0 ? 1 : -1) * 0.3; sp.push(lockPoint(rad(t2), rad(l2), hive(t2, l2))); }
        blade(sp, 0.045);
      }
      for (let la = -44; la <= 30; la += step(9, 37)) blade(over(26, 70, la, la + 32, 0.16, 0.04), 0.024);
      break;
    }
    case 29:  // a man bun: drawn back off the face to a knot at the back of the crown
      flatBack(116, 0.3);
      for (let la = -60; la <= 60; la += step(15, 30)) blade(over(150, 120, la, la * 0.2, 0.03, 0), 0.025);
      knot(lockPoint(rad(118), 0, 1.15), 0.03, step(12, 5));
      break;
    case 30:  // half up: the top drawn back to a small knot, the rest left long over the shoulders
      flatBack(114, 0.3);
      knot(lockPoint(rad(118), 0, 1.12), 0.021, step(9, 4));
      for (let a = -100; a <= 100; a += step(14, 40)) { const side = Math.abs(a) / 100; blade(hang(over(104 + 10 * side, 172 - 28 * side, a * 0.76, a * 0.8, 0.04, 0.02, hd ? 3 : 2), 1.39 + 0.05 * side ** 2 + 0.03 * r(), hd ? 6 : 3, 0.1), 0.03); }
      break;
    case 31:  // long waves: centre-parted, falling in loose S-waves past the shoulders
      for (let a = -104; a <= 104; a += step(13, 34)) {
        const side = Math.abs(a) / 104, sp = over(22 + 30 * side + 6 * r(), 170 - 32 * side, a * 0.72, a * 0.76, 0.06, 0.02, hd ? 4 : 2), e = sp[sp.length - 1], n = hd ? 8 : 4, ph = r() * TAU, y1 = 1.35 + 0.04 * r();
        for (let i = 1; i <= n; i++) {
          const t = i / n, k = 1 + 0.14 * Math.sin(Math.PI * Math.min(1, t * 1.3)) + 0.12 * t, wv = 0.011 * Math.sin(ph + t * 11) * Math.min(1, t * 3);
          sp.push([e[0] * k + wv * Math.sign(a || 1), e[1] + (y1 - e[1]) * t, ZC - 0.012 + (e[2] - ZC + 0.012) * k + wv * 0.5]);
        }
        blade(sp, 0.031);
      }
      break;
    case 32:  // a flat top: the sides cropped, the top stood straight up and cut level, square to the ground
      for (let th = 20; th <= 124; th += step(11, 26)) for (let la = -46; la <= 46; la += step(11, 23)) {
        const p0 = lockPoint(rad(th), rad(la), 1.01), top = Math.max(p0[1] + 0.02, 1.792 + 0.003 * r()), m = [p0[0] * 1.02, (p0[1] + top) / 2, p0[2] + (p0[2] - ZC) * 0.03];
        lockBlade(M, [p0, m, [p0[0] * 1.03, top, p0[2] + (p0[2] - ZC) * 0.05]], (hd ? 0.02 : 0.03) * 1.1, r(), cols, wt);
      }
      break;
  }
}
// How loose a cut is, for its swing (gl/figure-hd.js hairSway): 0 doesn't move, 1 swings freely. A beard
// counts too, a long one most. The street's six by index, then the cuts.
const HAIR_LOOSE = [0, 0.2, 0.35, 1, 0.3, 0.8, 0.6, 1, 0.2, 0.15, 0.15, 1, 0.05, 0.4, 0.2, 0.25, 1, 0.2, 0.9, 0.7, 0.2,
  0.65, 0.08, 0.25, 0.55, 0.12, 0.85, 1, 0.1, 0.2, 1, 1, 0.04];
const BEARD_LOOSE = { short: 0, goatee: 0, full: 0.3, long: 0.6, handlebar: 0.1, walrus: 0.25, fumanchu: 0.9, forked: 0.6, braided: 0.7, bushy: 0.35 };
export const hairLoose = (style, beard) => Math.max(HAIR_LOOSE[style | 0] ?? 0.3, BEARD_LOOSE[beard] ?? 0);
function hairLocks(level, style, fs, spikes = 0, fan = 0) {
  const M = newPart('locks', FIG_SLOT.hair), r = rng(0x10c5 + style), LS = LOCK_STYLE[style], hd = level.name === 'hd', rows = hd ? 6 : 3, cols = hd ? 6 : 3, wt = [[B.head, 1]];
  if (HAIR_CUTS[style]) { cutLocks(M, style, r, hd, rows, cols, wt); return M; }
  if (!LS) return M;
  if (style === 5) { skulletLocks(M, r, hd, cols, wt, fs); return M; }
  for (const [t0, t1q, l0, l1, hw0, up0, lift0] of hd ? LOCK_ROWS : LOCK_ROWS.filter((_, i) => i % 2 === 0)) {
    // the front's row, from the parting (t0 25): a settled look's `spikes` (0 to 1) stands it up in short
    // points whatever the style does behind it, so a neat cut can have a spiky front. At 0 nothing changes.
    // Over the forehead only: toward the temples they'd fan out like a crown.
    const sp = t0 === 25 ? spikes * Math.max(0, Math.min(1, (52 - Math.abs(l0)) / 26)) : 0;
    const t1 = t0 + (t1q - t0) * LS[3] * (1 - 0.35 * sp), hw = hw0 * LS[2] * (1 - 0.2 * sp), up = up0 * LS[0] * (1 + sp), lift = lift0 * (LS[1] + (1.15 - LS[1]) * sp) * (1 + (r() - 0.5) * (LS[4] + sp - 1));
    // each lock has finer ones lying beside it, longer and sharper, so the mass breaks into points
    // (not in neat or long hair, which lies flat: there they only cross it)
    for (let v = 0; v < (LS[1] < 0.5 && !sp ? 0 : hd ? 2 : 1); v++) {
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
  // THE UNDER LAYERS at the back, close up: two rows of short locks lying down the skull behind the ears and across
  // the nape, the lower ending just above the hairline and the upper overlapping it, under the rows above. A cut
  // is longest on top and shortest at its edge, in steps; without them the top rows ended in mid air over a bare
  // shell. Rooted on the skull itself (skullPoint), so they lie on it. Not under long hair, which covers the nape.
  if (hd && style !== 3) for (const [rise, drop, w, lay] of [[0.03, 0.005, 0.0085, 0.0028], [0.052, 0.02, 0.0105, 0.0046]]) {
    for (const sd of [1, -1]) for (let a = -30 - (rise > 0.04 ? 4 : 0); a >= -90; a -= 16) {
      if (sd < 0 && a <= -89) continue;   // the middle of the back once
      const phi = (a + (r() - 0.5) * 5) * D2R, e0 = skullPoint(1.6, phi, fs), hl = hairlineAt(e0[0], e0[2], HAIRLINE_SCULPT);
      const y0 = hl + rise + (r() - 0.5) * 0.008, y1 = hl + drop + (r() - 0.5) * 0.005, sweep = (r() - 0.5) * 9 * D2R, sp = [];
      for (let i = 0; i <= 3; i++) {
        const t = i / 3, q = skullPoint(y0 + (y1 - y0) * t, phi + sweep * t, fs), k = lay * (0.35 + Math.sin(Math.PI * Math.min(1, t * 1.2)) * 0.65) * (1 - 0.55 * t * t);
        const dx = q[0], dz = q[2] - ZC, L = Math.hypot(dx, dz) || 1;
        sp.push([(q[0] + (dx / L) * k) * sd, q[1], q[2] + (dz / L) * k]);
      }
      lockBlade(M, sp, w * 1.35 * (0.85 + 0.35 * r()), r(), 3, wt, 0.5);
    }
  }
  // long hair: each blade rises from its own root on the crown, runs back over the skull and only then
  // falls to the shoulders, so there's no line where the hanging hair starts; shorter at the face
  if (style === 3) for (let a = -104; a <= 104; a += hd ? 17.33 : 34.67) {
    const side = Math.abs(a) / 104, la = a * 0.72 * D2R, th0 = (84 + 30 * r()) * D2R, th1 = (172 - 22 * side) * D2R;
    // with `fan` it's hockey hair: it falls only to the collar, and its ends swoop up and out (below)
    const y1 = fan ? 1.47 + 0.035 * side + 0.02 * r() - 0.02 * fan : 1.415 + 0.06 * side ** 3 + 0.03 * r(), over = hd ? 4 : 2, fall = hd ? 6 : 3, spine = [];
    for (let i = 0; i <= over; i++) { const t = i / over; spine.push(lockPoint(th0 + (th1 - th0) * t, la, 1.03 + 0.05 * t)); }
    const e = spine[over];
    // a settled look's `fan` (0 to 1) flares the hair at the sides out from the head as it falls, the ends
    // flicked up, and leaves the back hanging; at 0 nothing changes
    const flare = fan * Math.abs(Math.sin(la)) ** 1.5;
    for (let i = 1; i <= fall; i++) {
      const t = i / fall, k = 1 + 0.1 * Math.sin(Math.PI * Math.min(1, t * 1.3)) + 0.12 * t;
      // the swoop: over its last third a lock turns up and out from the head, more at the sides than the back
      const curl = fan ? Math.max(0, (t - 0.62) / 0.38) ** 2 : 0, out = 1 + flare * 0.5 * t ** 0.8 + fan * (0.16 + 0.12 * Math.abs(Math.sin(la))) * curl;
      spine.push([e[0] * k * out, e[1] + (y1 - e[1]) * t + fan * 0.045 * curl, ZC - 0.012 + (e[2] - ZC + 0.012) * k * (1 + fan * 0.12 * curl)]);
    }
    blade(spine, 0.031 * (1 + 0.55 * fan) * (0.9 + 0.3 * r()), r());
  }
  return M;
  // (hair that lies flat, neat or long, is in thin blades close up: at full thickness each lock was a plank)
  function blade(spine, w0, seed) { lockBlade(M, spine, w0, seed, cols, wt, hd && LS[1] < 0.5 ? 0.42 : 1); }
}
// One lock: a flat blade down its spine, fullest a third of the way along, a point at the end.
function lockBlade(M, spine, w0, seed, cols, wt, thick = 1) {
  const rows = spine.length - 1, R = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows, p = spine[i], q = spine[Math.min(rows, i + 1)], o = spine[Math.max(0, i - 1)];
    const T = norm3([q[0] - o[0], q[1] - o[1], q[2] - o[2]]), out = norm3([p[0] - LOCK_C[0], p[1] - LOCK_C[1], p[2] - LOCK_C[2]]);
    const U = norm3(cross(T, out)), V = cross(U, T);
    // fullest a third of the way along, a point at the end
    const w = w0 * (t < 0.3 ? 0.62 + 0.38 * smooth(0, 0.3, t) : Math.max(0.03, (1 - (t - 0.3) / 0.7) ** 0.75)), h = 0.34 * w * thick + 0.0012, ring = [];
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
  if (kind === 'handlebar') return handlebarLocks(M, hd, fs, wt);
  if (kind === 'walrus') return walrusLocks(M, hd, fs, wt);
  if (kind === 'fumanchu') return fuManchuLocks(M, hd, fs, wt);
  // forked and braided are long beards; bushy is a full one grown out wide
  // short is a full beard kept close: short locks lying on the jaw, a little body at the chin
  const forked = kind === 'forked', braided = kind === 'braided', bushy = kind === 'bushy', goat = kind === 'goatee', short = kind === 'short' || goat, lng = long || forked;
  // a goatee is the short beard on the chin alone, the cheeks bare
  const a0 = goat ? (hd ? 66 : 70) : hd ? 30 : 58, a1 = goat ? (hd ? 114 : 110) : hd ? 150 : 122, da = goat ? (hd ? 6 : 20) : hd ? 6.5 : 32;
  for (let a = a0; a <= a1; a += da) {
    const phi = (a + (r() - 0.5) * 4) * D2R, s = Math.sin(phi), c = Math.cos(phi), y0 = 1.562 - 0.03 * s * s + (r() - 0.5) * 0.008, p = skullPoint(y0, phi, fs);
    const L = (lng ? 0.06 + 0.11 * s ** 3 : bushy ? 0.045 + 0.05 * s * s : goat ? 0.004 + 0.004 * s * s : short ? 0.009 + 0.009 * s * s : 0.03 + 0.028 * s * s) * (0.8 + 0.4 * r()), spine = [];
    // a fork's two points, either side of the chin
    const fx = forked ? (p[0] >= 0 ? 1 : -1) * 0.024 : 0;
    for (let i = 0; i <= rows; i++) {
      const t = i / rows, inn = 1 - (lng ? 0.42 : bushy ? 0.08 : short ? 0.05 : 0.24) * t, puff = bushy ? 0.014 * Math.sin(Math.PI * Math.min(1, t * 1.2)) : 0;
      const x = forked ? p[0] + (fx - p[0]) * Math.min(1, t * 1.1) * 0.85 : p[0] * inn * (1 + puff * 12);
      spine.push([x, p[1] - L * t, p[2] + s * (0.006 * Math.sin(Math.PI * Math.min(1, t * 1.4)) + 0.01 * t + puff) + 0.002]);
    }
    lockBlade(M, spine, hd ? (lng ? 0.0125 : bushy ? 0.0135 : 0.0105) * (0.8 + 0.5 * r()) : lng ? 0.03 : 0.034, r(), cols, wt);
  }
  // braided: a plait down from the point of the chin, short fat blades crossing one after another, and a tie at its end
  if (braided) {
    const top = skullPoint(1.53, Math.PI / 2, fs), n = hd ? 9 : 4, y1 = 1.36, sp = [];
    for (let i = 0; i <= n; i++) { const t = i / n; sp.push([0, top[1] - 0.012 - (top[1] - 0.012 - y1) * t, top[2] + 0.012 - 0.018 * t]); }
    for (let i = 0; i < n; i++) lockBlade(M, [sp[i], [(i % 2 ? 0.0045 : -0.0045), (sp[i][1] + sp[i + 1][1]) / 2, (sp[i][2] + sp[i + 1][2]) / 2 + 0.003], sp[i + 1]], (hd ? 0.016 : 0.022) * (1 - 0.3 * i / n), r(), cols, wt);
  }
  return M;
}

// A walrus: a heavy, bushy moustache that hangs down over the upper lip and hides it, its ends past the corners of
// the mouth. Rooted under the nose, every lock falls down and a little out, the middle ones shortest.
function walrusLocks(M, hd, fs, wt) {
  const r = rng(0x3a1f), cols = hd ? 5 : 4, n = hd ? 14 : 5;
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * 2 - 1, x0 = u * 0.03, y0 = 1.587 - 0.006 * u * u, f0 = facePoint(x0, y0, fs);
    const y1 = 1.559 - 0.008 * Math.abs(u) ** 1.5 - 0.004 * r(), x1 = x0 * 1.25, spine = [];
    for (let k = 0; k <= 3; k++) {
      const t = k / 3, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, f = facePoint(Math.max(-0.044, Math.min(0.044, x)), y, fs);
      // off the lip, fullest in the middle of its fall, settling back onto the face at the tip
      spine.push([x, y, Math.max(f[2], f0[2] - 0.004 * t) + 0.004 + 0.006 * Math.sin(Math.PI * Math.min(1, t * 1.3))]);
    }
    lockBlade(M, spine, (hd ? 0.009 : 0.016) * (0.85 + 0.3 * r()), r(), cols, wt);
  }
  return M;
}

// A Fu Manchu: a thin moustache (painted) whose two ends grow on down from the corners of the mouth in long thin
// strands, well below the chin. Each strand is a few thin locks twisted round each other, tapering to a point.
function fuManchuLocks(M, hd, fs, wt) {
  const r = rng(0xf00d), cols = hd ? 4 : 3;
  for (const sd of [1, -1]) for (let k = 0; k < (hd ? 3 : 1); k++) {
    const x0 = sd * (0.03 + 0.002 * k), f0 = facePoint(x0, 1.572, fs), n = hd ? 10 : 4, y1 = 1.43 - 0.02 * r(), spine = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, tw = 0.0025 * Math.sin(t * 12 + k * 2.1);
      spine.push([x0 + sd * 0.004 * Math.sin(Math.PI * t) + tw, 1.572 - (1.572 - y1) * t, f0[2] + 0.004 + 0.012 * Math.sin(Math.PI * Math.min(1, t * 0.9)) + tw]);
    }
    lockBlade(M, spine, (hd ? 0.0042 : 0.008) * (0.9 + 0.2 * r()), r(), cols, wt);
  }
  return M;
}

// A handlebar as a thick, bushy horseshoe: over the whole upper lip, round each corner of the mouth and down
// beside the chin toward the jaw, the ends left natural, not waxed. One smooth curve: nearly level along the
// lip, turning steadily at the corner, then falling. Several blades a side laid over each other, all the full
// length, so it has bulk in profile and every end tapers to a point. Clear of the lips, which have to move.
function handlebarLocks(M, hd, fs, wt) {
  const n = hd ? 16 : 6, cols = hd ? 5 : 4, r = rng(0x4a7d);
  const path = (t) => {
    const th = t * Math.PI * 0.5, s = Math.sin(th), c = Math.cos(th);
    return [0.002 + 0.032 * s ** 0.75, 1.531 + 0.0515 * c ** 0.45];
  };
  // [layer, half-width, its offset across the curve (up and out), how far it reaches]
  const layers = hd ? [[0, 0.0125, 0, 1], [1, 0.009, 0.0032, 0.97], [2, 0.009, -0.0024, 1], [3, 0.0072, 0.0058, 0.92], [4, 0.0072, -0.0044, 0.95]] : [[0, 0.016, 0, 1]];
  for (const sd of [1, -1]) for (const [k, w, off, len] of layers) {
    const spine = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * len, [x0, y0] = path(t), [x1, y1] = path(Math.min(1, t + 0.01));
      // offset across the curve, along its normal, narrowing to nothing at the tip so the layers meet there
      const tx = x1 - x0, ty = y1 - y0, L = Math.hypot(tx, ty) || 1, nx = -ty / L, ny = tx / L, o = off * (1 - 0.85 * t);
      const x = x0 - nx * o, y = y0 + ny * Math.abs(o) * Math.sign(off) - (1 - ny) * 0, f = facePoint(sd * Math.min(x, 0.044), y, fs);
      // off the lip, settling onto the skin as it falls, so the ends lie on the face and never stick out
      spine.push([sd * x, y, f[2] + 0.0045 + 0.0045 * Math.sin(Math.PI * Math.min(1, t * 1.4)) * (1 - 0.6 * t) - 0.0025 * t * t - 0.001 * k]);
    }
    lockBlade(M, spine, w * (hd ? 1 : 1.2) * (0.94 + 0.12 * r()), 0.25 + 0.12 * k + (sd > 0 ? 0.05 : 0), cols, wt);
  }
  return M;
}

// Real eyes, at the close-up level only: a phone's are painted. Behind each opening, which the skin's shader cuts
// (gl/figure-hd.js), sits a flattened ball, as far back as it has to be never to come through the skin round it, so
// the eye has depth from the side and can turn. Along the opening's top and bottom run the lids, thin strips with real
// thickness that catch the light. A lid's uv is [1 if it moves in a blink, how far it travels].
function eyeParts(fs) {
  const E0 = softFace(fs) ? EYE.soft : EYE.man, A = FACE_STYLES[fs]?.eyeAdj, E = A ? { x: E0.x + A[0], w: E0.w * A[1], t: E0.t * A[2], b: E0.b * A[2], tilt: E0.tilt + A[3] } : E0, rx = E.w + 0.0022, ry = 0.0118, rz = 0.012, wt = [[B.head, 1]];
  const ball = newPart('eyes', FIG_SLOT.eye), lids = newPart('lids', FIG_SLOT.lid), socket = newPart('socket', FIG_SLOT.eye);
  for (const side of [1, -1]) {
    const cx = side * E.x, cy = EYE.y;
    let zc = Infinity;
    for (let i = -8; i <= 8; i++) for (let j = -6; j <= 6; j++) {
      const ex = (i / 8) * rx, ey = (j / 6) * ry, q = 1 - (ex / rx) ** 2 - (ey / ry) ** 2;
      if (q > 0) zc = Math.min(zc, facePoint(cx + ex, cy + ey, fs)[2] - rz * Math.sqrt(q) - 0.0007);
    }
    // (2 mm further forward than that: set fully behind the skin all round, the ball sat so deep that from the side
    // nothing of its white showed in the opening)
    zc += 0.002;
    // the ball carries the depth of the skin over its middle in its aux: gl/figure-hd.js traces the line of sight out to it
    const R = [], rings = 7, cols = 14, zs = facePoint(cx, cy, fs)[2];
    for (let i = 1; i <= rings; i++) {
      const a = (i / rings) * 1.9, ring = [];
      for (let k = 0; k < cols; k++) { const b = (k / cols) * TAU, x = rx * Math.sin(a) * Math.cos(b), y = ry * Math.sin(a) * Math.sin(b); ring.push(addV(ball, [cx + x, cy + y, zc + rz * Math.cos(a)], wt, zs, [x / ry, y / ry])); }
      R.push(ring);
    }
    stitchRings(ball, R);
    capFan(ball, R[0], addV(ball, [cx, cy, zc + rz], wt, zs, [0, 0]), true);
    // the socket's lining: from round the ball, behind its widest, out to just behind the skin a few millimetres past
    // the opening, so every line of sight through the opening lands on the eye. Without it, seen from below or the side
    // the line passed the ball into the head and met the ink's shell behind it (black). Its uv is the ball's, 10 up,
    // which gl/figure-hd.js reads as lining.
    const SR = [], sa = (5 / rings) * 1.9;
    for (const f of [0, 0.5, 1]) {
      const ring = [];
      for (let k = 0; k < cols; k++) {
        const b = (k / cols) * TAU, sb = Math.sin(b), xi = rx * Math.sin(sa) * Math.cos(b), yi = ry * Math.sin(sa) * sb, zi = zc + rz * Math.cos(sa);
        const xo = (E.w + 0.0035) * Math.cos(b), yo = E.tilt * side * xo + (sb >= 0 ? E.t + 0.003 : -(E.b + 0.0025)) * sb * sb;
        const x = xi + (xo - xi) * f, y = yi + (yo - yi) * f, z = Math.min(zi + (facePoint(cx + xo, cy + yo, fs)[2] - zi) * f, facePoint(cx + x, cy + y, fs)[2] - 0.0012);
        ring.push(addV(socket, [cx + x, cy + y, z], wt, zs, [x / ry, y / ry + 10]));
      }
      SR.push(ring);
    }
    stitchRings(socket, SR);
    for (const up of [true, false]) {
      const n = 12, cols2 = 6, L = [], yOf = (ex, K) => cy + E.tilt * ex + (up ? E.t : -E.b) * K;
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * 2 - 1, ex = t * E.w, K = 1 - t * t, y = yOf(ex, K), p = facePoint(side * (E.x + ex), y, fs), tp = Math.sqrt(K) * 0.85 + 0.15, thick = (up ? 0.0034 : 0.0013) * tp, tall = (up ? 0.0031 : 0.0011) * tp, ring = [];
        const travel = cy + E.tilt * ex - E.b * K + 0.0003 - y;
        for (let k = 0; k < cols2; k++) { const a = (k / cols2) * TAU; ring.push(addV(lids, [side * (E.x + ex), y + tall * Math.sin(a) + (up ? 0.0006 * tp : -0.0003 * tp), p[2] + (up ? 0.0009 : 0.0003) + thick * Math.cos(a)], wt, 0.5 + 0.5 * Math.sin(a), [up ? 1 : 0, travel])); }
        L.push(ring);
      }
      stitchRings(lids, L);
      for (const [ring, top] of [[L[0], true], [L[n], false]]) { const c = [0, 0, 0]; for (const v of ring) for (let j = 0; j < 3; j++) c[j] += lids.P[v * 3 + j] / ring.length; capFan(lids, ring, addV(lids, c, wt, 0.5, [up ? 1 : 0, 0]), top); }
    }
  }
  return [ball, lids, socket];
}

// ── The head (close-up only): actor-head.js's skin and shell, riding the head and neck bones ───────
function headParts(style, lv, sculpt = false, fs = 'comic', neckK = 1) {
  const out = [];
  const H = headMesh(lv, fs, true), Hs = newPart('head', FIG_SLOT.face);
  for (let i = 0; i < H.P.length / 3; i++) {
    const f = H.F[i], slot = f === 8 ? FIG_SLOT.ear : f === 12 ? FIG_SLOT.neck : FIG_SLOT.face, w = H.W[i];
    // a build's neck, round the neck's own axis
    const nk = f === 12 ? neckK : 1;
    // the fine head's face and neck carry 0.25 in their aux (still piece 0), which tells gl/figure-hd.js the geometry
    // holds the planes; its ears carry 2 plus their bowl's depth (actor-head.js addEarFine)
    addV(Hs, [H.P[i * 3] * nk, H.P[i * 3 + 1], -0.016 + (H.P[i * 3 + 2] + 0.016) * nk], w >= 1 ? [[B.head, 1]] : [[B.head, w], [B.neck, 1 - w]], f === 8 ? H.X[i] : lv === 'hd' && (f === 7 || f === 12) ? 0.25 : H.E[i]);
    (Hs.S ||= []).push(slot);
  }
  Hs.I = Array.from(H.I);
  Hs.N = []; for (let i = 0; i < H.N.length / 3; i++) Hs.N.push([H.N[i * 3], H.N[i * 3 + 1], H.N[i * 3 + 2]]);
  out.push(Hs);
  const Y = hairMesh(cutBase(style), lv, sculpt), Ys = newPart('hair', FIG_SLOT.hair);
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
// The standing figure's height to the crown of its skull, in metres: what flags.figure.height is measured against.
export const FIGURE_CROWN = FACE.top;
export const SCULPT_BUILDS = {
  // (a man's: the chest a little fuller over a narrower waist and hips, so the shoulders are the widest
  // thing on him. `thigh` moves the tops of the legs in or out, which is what the hips' width is)
  average: { chest: 1.05, waist: 0.95, hips: 0.95, arm: 1, upper: 0.15, fore: 0.08, leg: 1, neck: 1, sh: 0.008, thigh: -0.008 },
  older: { chest: 0.94, waist: 1.02, hips: 0.98, belly: 0.02, arm: 0.86, leg: 0.88, neck: 0.92, hunch: 0.14 },
  // a man in his eighties who was never big: the shoulders narrow and sloping, a smaller deltoid on thin arms,
  // a soft belly over the belt, the chest gone in a little
  elder: { chest: 0.9, waist: 1.04, hips: 0.98, belly: 0.03, arm: 0.84, upper: -0.04, delt: 0.75, yoke: 0.92, leg: 0.9, neck: 0.92, sh: -0.012, hunch: 0.1 },
  hunched: { chest: 0.97, waist: 1, hips: 1, arm: 0.96, leg: 0.97, neck: 0.98, hunch: 0.24 },
  // a beer gut on a man who used to play some sport: the chest and arms still there, the belly well
  // out past them, the neck thick, standing a touch back to carry it
  dadbod: { chest: 1.02, waist: 1.12, hips: 1.04, belly: 0.05, arm: 1.0, leg: 1.0, neck: 1.2, sh: 0.004, hunch: 0.05, abduct: 0.04 },
  // (an hourglass: the waist well in under the ribs, the hips and the tops of the thighs out past the shoulders'
  // line, and the top of the shoulder left sloping, `yoke`, where a man's is built out square, under a smaller deltoid, `delt`, on a slimmer upper arm)
  woman: { chest: 0.86, waist: 0.71, hips: 1.22, bust: 0.026, arm: 0.88, upper: -0.08, delt: 0.55, shFill: 0.016, yokeW: 1.3, leg: 0.99, neck: 0.82, sh: -0.02, thigh: 0.008, yoke: 0.85 },
  // an exaggerated hourglass: the woman's shape pushed, the waist pinched right in, the hips and seat wide, the chest fuller
  hourglass: { chest: 0.9, waist: 0.6, hips: 1.36, bust: 0.03, arm: 0.88, upper: -0.08, delt: 0.55, shFill: 0.016, yokeW: 1.3, leg: 1.0, neck: 0.82, sh: -0.02, thigh: 0.014, yoke: 0.85 },
  // a big man built big all over rather than round in the middle: broad through the chest and hips, a modest belly,
  // heavy thighs and calves, a thick neck (Angus Malcolm at Screw It)
  stocky: { chest: 1.05, waist: 1.03, hips: 1.07, belly: 0.012, arm: 1.04, leg: 1.13, neck: 1.18, sh: 0.004, hunch: 0.03 },
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
  short: { stubble: 0.6, shape: [1, 1, 1, 1], more: [0, 0, 1], mesh: 'short' },
  goatee_short: { stubble: 0.9, shape: [0, 1, 1, 0], more: [0, 0, 1], mesh: 'goatee' },
  long: { stubble: 0.5, shape: [1, 1, 1, 1], more: [0, 0, 1], mesh: 'long' },
  handlebar: { stubble: 1.1, shape: [0, 0, 1, 0], mesh: 'handlebar' },
  handlebar_patch: { stubble: 1.3, shape: [0, 0, 1, 0], more: [1, 0, 0], mesh: 'handlebar' },
  // the painted ones: mutton chops down the cheeks with the chin bare (friendly ones joined by a moustache), a
  // horseshoe down past the mouth, an anchor of moustache and a chin strip apart, and a chin curtain with no moustache
  mutton: { stubble: 0.3, shape: [1, 0, 0, 1] },
  friendly_mutton: { stubble: 0.3, shape: [1, 0, 1, 1] },
  horseshoe: { stubble: 0.3, shape: [0, 0, 1, 0], more: [0, 0, 1] },
  anchor: { stubble: 0.2, shape: [0, 1, 1, 0], more: [1, 0, 0] },
  chin_curtain: { stubble: 0.3, shape: [1, 1, 0, 1], more: [0, 1, 0] },
  // with locks of their own (beardLocks)
  walrus: { stubble: 0.6, shape: [0, 0, 1, 0], mesh: 'walrus' },
  fumanchu: { stubble: 0.2, shape: [0, 0, 1, 0], mesh: 'fumanchu' },
  bushy: { stubble: 0.7, shape: [1, 1, 1, 1], more: [0, 0, 1], mesh: 'bushy' },
  forked: { stubble: 0.5, shape: [1, 1, 1, 1], more: [0, 0, 1], mesh: 'forked' },
  braided: { stubble: 0.5, shape: [1, 1, 1, 1], more: [0, 0, 1], mesh: 'braided' },
};
// The seat's shape for `butt`: a dome on each side, round across and up, highest a little below the hip and
// tucked in hard at the fold under it (y 0.84) so it sits on the thigh instead of hanging over it.
// The bust for `bust`: a dome each side, apart, each round with a crisp edge so it stands off the chest instead of
// melting into it, a cleft between them and a fold under each. A bigger one is wider and sits lower; the profile is
// set out from the middle and fuller on its outer side, so each points a little outward; fuller below the middle than above, as weight puts it: round, the upper half only a little flatter than the lower. `d` is the relief in metres (bustOf).
// `g` is the weight's bust factor (somaOf: 0.55 thin to 1.5 heavy): a heavier body's is bigger all round, and sits and hangs lower.
// The bust's frame: its centre, half-widths and how far it hangs, off the relief `d` (bustOf) and the weight's
// factor `g`. `m` is how much of a melon it is: a big bust on a body that isn't heavy goes round and full on
// both sides, so the two meet in the middle in a cleavage instead of hanging apart.
function bustGeo(d, g = 1) {
  const k = Math.min(1, d / 0.134), sc = Math.sqrt(Math.max(1, g)), sag = Math.max(0, g - 1), m = k * Math.max(0, 1 - 1.6 * sag);
  const cy = 1.285 - 0.06 * k - 0.07 * sag + 0.02 * m, cx = 0.094 + 0.02 * k + 0.006 * sag - 0.012 * m, w = (0.052 + 0.032 * k) * Math.sqrt(sc) * (1 - 0.2 * sag);
  return { k, sag, m, cx, cy, w, wo: w * (1.15 - 0.1 * m), wi: w * (0.88 + 0.32 * m), up: (0.056 + 0.034 * k + 0.03 * sag) * sc, lo: (0.05 + 0.028 * k + 0.05 * sag) * sc };
}
// Where the nipple sits: forward of the bust's centre, so a little below it and to the outer side, lower as it hangs.
export function bustApex(bust, weight = null) {
  // no bust: on the pectoral, at its fullest (torsoRelief's lobe, 1.302), a little outside its middle
  if (!(bust > 0.05)) return [0.094, 1.3];
  const g = weight === null ? 1 : somaOf(weight).bust, B = bustGeo(bustOf(bust), g);
  return [B.cx + 0.3 * B.wo, B.cy - (0.22 + 0.25 * B.sag) * B.lo];
}
const bustDome = (ax, y, d, g = 1) => { const B = bustGeo(d, g), up = y > B.cy, u = (ax - B.cx) / (ax > B.cx ? B.wo : B.wi), v = (y - B.cy) / (up ? B.up : B.lo), q = 1 - u * u - v * v; return q > 0 ? Math.pow(q, up ? 0.62 + 0.12 * B.k + 1.1 * B.sag - 0.15 * B.m : 0.5) * smooth(0.004, 0.02 - 0.008 * B.m, ax) : 0; };
// The seat: a round cheek each side, fullest a hand under the top of the hips and full right down to a crisp fold
// under it, not a teardrop hanging to the fold; and the small of the back curved in over it, so the curve reads from
// the side. Heavy (`g` past 1) it widens and sits a little lower, and stays round.
const seatDome = (ax, y, g = 1) => {
  // (a round, not a drop: its middle at the middle of the seat, as far down as up, the same curve under as over.
  // Only a heavy body's sags, `sag`)
  const sc = Math.sqrt(g), sag = Math.max(0, g - 1), cy = 0.928 - 0.04 * sag;
  const u = (ax - 0.07 - 0.01 * sag) / (0.086 * sc), v = (y - cy) / ((y < cy ? 0.08 + 0.02 * sag : 0.09 + 0.03 * sag) * sc), q = 1 - u * u - v * v;
  const dome = q > 0 ? Math.pow(q, 0.5) * smooth(0.815 - 0.04 * sag, 0.856 - 0.035 * sag, y) * smooth(0.008, 0.042, ax) : 0;
  return dome - 0.2 * gx(y - 1.035, 0.035) * gx(ax, 0.075);
};
// `bust` and `butt` (0 to 1, null for the build's own) size the chest's two lobes and the seat's, on the sculpted body.
export const bustOf = (v) => 0.004 + 0.13 * v * (0.4 + 0.6 * v), buttOf = (v) => 0.07 * v * (0.45 + 0.55 * v);
// A man's genitals at rest, for a player in the mature layer only (`groin` 'm'): two rounded forms at the front of
// the crotch, the upper narrower, as relief on the torso. Static: nothing drives it.
const groinForm = (x, y) => { const d = (cx, cy, rx, ry) => { const u = x / rx, v = (y - cy) / ry, q = 1 - u * u - v * v; return q > 0 ? Math.sqrt(q) : 0; }; return Math.max(0.02 * d(0, 0.842, 0.019, 0.036), 0.019 * d(0, 0.817, 0.03, 0.022)); };
function partsFor(body, sculpt = false, build = 'average', weight = null, bust = null, butt = null, groin = '', domed = sculpt) {
  let out = PARTS;
  if (sculpt) {
    const Bd0 = buildOf(build), Bd = bust === null ? Bd0 : { ...Bd0, bust: bustOf(bust) }, seatK = butt === null ? (Bd0.hips > 1 ? buttOf(0.35) : 0) : buttOf(butt), W = weight === null ? null : somaParts(weight), S = W?.S, PS = W?.parts || PARTS;
    const waistK = 1 + (Bd.waist - 1) * (S ? S.waist : 1), bustK = S ? S.bust : 1;
    const widthK = spline([[0.8, Bd.hips], [0.93, Bd.hips], [1.12, waistK], [1.33, Bd.chest], [1.46, 1 + (Bd.chest - 1) * 0.5]]);
    // the sculpted figure's proportions, on the same joints: the upper arm slimmed, but not the deltoid
    // over it, which comes back to full size above the armpit so it caps the torso's shoulder corner
    // and is the shoulder's outline, instead of a knob hung under a square shoulder
    // (2026-11-21: the deltoid was a pad. The upper arm was slimmed 17% under a deltoid at full size with 14 mm of
    // relief on it, so the shoulder stood 3 cm proud of the arm over 7 cm of its length: a knob hanging, and a lump
    // pointing up on a raised arm. Now the upper arm keeps nearly its size (`upper` on a build thickens it without
    // the hands), the deltoid is a little narrower with half the relief, and the two run into each other over about
    // 12 cm, as the muscle does down to where it ties in.)
    const ARM_SHAPE = { slim: 0.05, fill: 0.1, delt: 0.045, relief: 0.3, zf: 0.06, zb: 0.03 };
    const arm = (P) => ({ ...P, relief: (x, y, c, s) => P.relief(x, y, c, s) * (1 - ARM_SHAPE.relief * gx(y - 1.37, 0.05) * smooth(-0.5, 0.2, c)), at: (y) => { const S = P.at(y), up = smooth(1.16, 1.34, y) * (1 - 0.85 * smooth(1.3, 1.385, y)), ku = (1 + (Bd.upper || 0) * smooth(1.12, 1.18, y) * smooth(1.35, 1.3, y)) * (1 + (Bd.fore || 0) * gx(y - 1.03, 0.07)), k = (1 - ARM_SHAPE.slim * up) * (1 + ARM_SHAPE.fill * gx(y - 1.3, 0.055)) * (1 - 0.14 * (1 - (Bd.delt ?? 1)) * gx(y - 1.36, 0.06)) * (1 - ARM_SHAPE.delt * gx(y - 1.372, 0.03)) * ku, kz = (1 - 0.03 * up + 0.015 * gx(y - 1.385, 0.03)) * ku, dk = gx(y - 1.375, 0.05) * (W ? Math.min(1, 0.35 + 0.4 * W.S.muscle) : 1) * (Bd.delt ?? 1); return { ...S, cz: S.cz + 0.006 * dk, rx: S.rx * k * Bd.arm, zf: S.zf * (kz + ARM_SHAPE.zf * dk) * Bd.arm, zb: S.zb * (kz + ARM_SHAPE.zb * dk) * Bd.arm, cx: S.cx - P.side * ((0.012 - (Bd.sh || 0) - (W?.S.sh || 0)) * smooth(1.2, 1.38, y) ) }; } });
    // the deltoid's round: above the armpit the arm closes as a dome, leaning in over the shoulder joint,
    // so it caps the torso's corner instead of standing beside it on a flat ring
    const DELT = 1.366, DTOP = PARTS.armL.hi + 0.028;
    const dome = (P) => ({ ...P, hi: DELT + (DTOP - DELT) * 0.97, cap: DTOP, at: (y) => {
      if (y <= DELT) return P.at(y);
      const S = P.at(DELT), t = (y - DELT) / (DTOP - DELT), // (over a sloping yoke the round closes sooner, or its top stands up off the shoulder as a knob. Its height can't
      // change by build: every build keeps the same rings, which the street's body offsets pair vertex for vertex)
      f = Math.max(0, 1 - t * t) ** (0.6 + 0.5 * (1 - (Bd.yoke ?? 1)));
      return { ...S, rx: S.rx * f, zf: S.zf * f, zb: S.zb * f, cx: S.cx - P.side * 0.03 * t * t };
    } });
    const leg = (P) => ({ ...P, at: (y) => { const S = P.at(y), k = 1 + 0.05 * gx(y - 0.37, 0.07) - 0.05 * gx(y - 0.49, 0.03) - 0.04 * gx(y - 0.17, 0.05), q = k * (1 + (Bd.leg - 1) * smooth(0.12, 0.42, y)); return { ...S, rx: S.rx * q, zf: S.zf * q, zb: S.zb * q, cx: S.cx + P.side * ((W?.S.thigh || 0) + (Bd.thigh || 0)) * smooth(0.45, 0.85, y) }; } });
    // (2026-11-21: the torso's own shoulder ended at 15 cm and fell away steeply, leaving the deltoid's round to be
    // the shoulder. Arms down that held; an arm raised took the round with it and left a notch between the neck's
    // slope and the deltoid. So the top rings are wider: the slope from the neck runs out to the joint under the
    // round, and a raised deltoid runs into it.)
    // (A narrow build needs more of the same. The woman's torso sloped away from the neck and stopped 3 cm short of
    // her arm, front and back, so the arm's round sat on the slope as a lobe with a dip beside it. `yokeW` widens her
    // top rings on its own (her `yoke` still shapes the round), and `shFill` fills the torso's outer corners at the
    // shoulder, more behind than in front, out to where the arm's surface is.)
    const torso = { ...PS.torso,
      // only the chest is held in under the arms: an endomorph's belly goes out past them
      at: (y) => { const S = PS.torso.at(y), k = widthK(y), d = Math.sqrt(k), rx = S.rx * (1 - 0.055 * gx(y - 1.4, 0.05)) * (1 - 0.02 * smooth(1.385, 1.435, y)) * (1 + (Bd.yokeW ?? Bd.yoke ?? 1) * (0.32 * smooth(1.4, 1.432, y) + 0.3 * smooth(1.45, 1.462, y))) * (1 - 0.09 * gx(y - 1.375, 0.04)) * k; return { ...S, rx: y > 1.3 || !W ? Math.min(rx, 0.205) : rx, zf: S.zf * d, zb: S.zb * d, nf: S.nf - 0.3 * gx(y - 1.39, 0.04), nb: S.nb - 0.25 * gx(y - 1.39, 0.04) }; },
      relief: (x, y, c, s) => { const F = smooth(0.12, 0.6, s), K = smooth(0.12, 0.6, -s), ax = Math.abs(x); return torsoRelief(x, y, c, s) * (S ? S.muscle : 1) + (S ? somaRelief(S, x, y, c, s) : 0) + (Bd.shFill ?? 0) * gx(y - 1.385, 0.045) * smooth(0.55, 0.9, Math.abs(c)) * (0.55 + 0.45 * smooth(0, 0.5, -s)) + F * ((Bd.belly || 0) * gx(x, 0.13) * gx(y - 1.09, 0.1) + (Bd.bust || 0) * Math.max(1, bustK) * bustDome(ax, y, Bd.bust || 0, bustK)) + K * seatK * bustK * seatDome(ax, y, bustK) + (groin === 'm' ? F * groinForm(x, y) : 0); } };
    out = { ...PARTS, torso, armL: domed ? dome(arm(PS.armL)) : arm(PS.armL), armR: domed ? dome(arm(PS.armR)) : arm(PS.armR), legL: leg(PS.legL), legR: leg(PS.legR) };
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
const BODY_LETTER = { mighty: 'm', thorn: 't', horns: 'h', claws: 'c', teeth: 'n', goggles: 'g',
  eye3: 'e', compound: 'o', ears: 'a', blades: 'l', spurs: 'u', carapace: 'k', tail: 'q', ptail: 'p', wings: 'w', head2: 'H', spider: 's', tentacles: 'x', arms4: 'A' };

// ── Mutations, seen ─────────────────────────────────────────────────────────────────────────────────
// What each mutation (content/mutations) looks like on the close-up figure: `body` keys are grown as
// mesh (in the figure's key), `paint` bits go to the shader as uMut (gl/figure-hd.js mutPaint).
export const MUT_PAINT = { scales: 1, scalesFull: 2, mottle: 4, freckles: 8, sores: 16, veins: 32, scars: 64, chameleon: 128, gills: 256, maw: 512, torn: 1024, charge: 2048,
  // the grounded set: thick hide in patches or all over, one colour over all the skin, solid eyes
  hide: 4096, hideFull: 8192, hue: 16384, eyes: 32768 };
const P_ = MUT_PAINT;
export const MUTATION_LOOK = {
  mut_dermal_thickening: { paint: P_.hide },
  mut_wb_bio_armor: { paint: P_.hideFull },
  mut_wb_carapace: { body: 'carapace', paint: P_.torn },
  mut_mottled_skin: { paint: P_.mottle },
  mut_wb_chameleon: { paint: P_.hue },
  mut_wb_echolocation: { body: 'ears' },
  mut_wb_predator_senses: { body: 'ears', paint: P_.eyes },
  mut_wb_thermal_vision: { paint: P_.eyes },
  mut_nictitating_membrane: { paint: P_.eyes },
  mut_night_membrane: { paint: P_.eyes },
  mut_rad_freckles: { paint: P_.freckles },
  mut_weeping_sores: { paint: P_.sores },
  mut_translucent_veins: { paint: P_.veins },
  mut_wb_electric: { paint: P_.charge },
  mut_regenerative_scarring: { paint: P_.scars },
  mut_wb_regenerative: { paint: P_.scars },
  mut_wb_gills: { paint: P_.gills },
  mut_wb_maw: { paint: P_.maw },
  mut_extra_eye: { body: 'eye3' },
  mut_wb_compound_eyes: { body: 'compound' },
  mut_enlarged_ears: { body: 'ears' },
  mut_wb_bone_blades: { body: 'blades' },
  mut_bone_spurs: { body: 'spurs' },
  mut_thornhide: { body: 'thorn' },
  mut_keratin_nails: { body: 'claws' },
  mut_vestigial_tail: { body: 'tail' },
  mut_wb_prehensile_tail: { body: 'ptail', paint: P_.torn },
  mut_wb_wings: { body: 'wings', paint: P_.torn },
  mut_wb_second_head: { body: 'head2' },
  // spider limbs are a second pair of arms: more limbs, not a different animal
  mut_wb_spider_limbs: { body: 'arms4' },
  mut_wb_tentacles: { body: 'tentacles', paint: P_.torn },
};
// { body, paint } for a list of mutation ids; ids with no look are skipped
export function mutationLook(ids = []) {
  const body = {};
  let paint = 0;
  for (const id of ids) { const L = MUTATION_LOOK[id]; if (!L) continue; if (L.body) body[L.body] = true; paint |= L.paint || 0; }
  return { body, paint };
}
// A Wildblood's changes off three rolls: one, sometimes two. The great ones are rare.
const WILD_MUTS = [['mut_dermal_thickening', 5], ['mut_wb_bio_armor', 3], ['mut_wb_chameleon', 4], ['mut_wb_echolocation', 3], ['mut_wb_predator_senses', 3],
  ['mut_wb_thermal_vision', 2.5], ['mut_enlarged_ears', 2], ['mut_wb_spider_limbs', 2], ['mut_wb_second_head', 1.2], ['mut_vestigial_tail', 2.5], ['mut_wb_prehensile_tail', 2],
  ['mut_mottled_skin', 2], ['mut_rad_freckles', 2], ['mut_regenerative_scarring', 2], ['mut_bone_spurs', 1.5], ['mut_wb_bone_blades', 1.5], ['mut_extra_eye', 1],
  ['mut_wb_gills', 1], ['mut_wb_electric', 1], ['mut_wb_wings', 0.8], ['mut_wb_carapace', 0.5], ['mut_wb_tentacles', 0.3], ['mut_wb_compound_eyes', 0.3]];
export function wildMutations(r) {
  const out = [rollOf(WILD_MUTS, r[0])];
  if (r[1] < 0.45) { const b = rollOf(WILD_MUTS, r[2]); if (b !== out[0]) out.push(b); }
  return out;
}

// The growths. Each part is rigid on, or weighted down a chain of, its grown bones.
const backOf = (PT, y) => { const S = PT.torso.at(Math.max(PT.torso.lo ?? 0.9, Math.min(PT.torso.hi ?? 1.45, y))); return S.cz - S.zb; };
// a tube down a chain of joints, each ring weighted to the bone whose segment it's on, blended at joints
function chainTube(name, slot, pts, bones, radii, cols, aux, flat = 1) {
  const M = newPart(name, slot), path = [], rr = [], W = [];
  const n = 6;
  for (let s = 0; s < pts.length - 1; s++) for (let i = 0; i < n; i++) {
    const t = i / n, a = pts[s], b = pts[s + 1];
    path.push([0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t));
    rr.push(radii(path.length));
    W.push(t < 0.25 && s > 0 ? [[B[bones[s]], 0.5 + 2 * t], [B[bones[s - 1]], 0.5 - 2 * t]] : [[B[bones[s]], 1]]);
  }
  path.push(pts[pts.length - 1]); rr.push(radii(path.length)); W.push([[B[bones[bones.length - 1]], 1]]);
  const total = path.length;
  // tubeAlong takes one weight; lay the rings down one at a time instead
  const R = [];
  for (let i = 0; i < total; i++) {
    const p = path[i], q = path[Math.min(total - 1, i + 1)], o = path[Math.max(0, i - 1)];
    const T = norm3([q[0] - o[0], q[1] - o[1], q[2] - o[2]]), U = norm3(cross(T, Math.abs(T[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0])), V = cross(U, T), r = rr[i] * (1 - 0.9 * (i / (total - 1)) ** 1.5), ring = [];
    for (let j = 0; j < cols; j++) { const a = (j / cols) * TAU; ring.push(addV(M, [0, 1, 2].map((k) => p[k] + (U[k] * Math.cos(a) * flat + V[k] * Math.sin(a)) * r), W[i], aux, [i / (total - 1), j / cols])); }
    R.push(ring);
  }
  stitchRings(M, R);
  capFan(M, R[total - 1], addV(M, path[total - 1], W[total - 1], aux, [1, 0]), false);
  capFan(M, R[0], addV(M, path[0], W[0], aux, [0, 0]), true);
  return M;
}
const XJ = Object.fromEntries(FIGURE_XBONES.map((x) => [x.name, x.at]));
function spiderMesh(Lv) {
  const out = [], cols = Lv.name === 'hd' ? 8 : 5;
  for (let i = 0; i < 4; i++) {
    const hip = XJ['spHip' + i], knee = XJ['spKnee' + i], s = Math.sign(hip[0]);
    const foot = [s * 0.52, hip[1] - 0.42, -0.16];
    out.push(chainTube('spider' + i, FIG_SLOT.horn, [hip, knee, foot], ['spHip' + i, 'spKnee' + i], (j) => 0.019 * (1 + 0.35 * Math.exp(-(((j - 7) / 1.0) ** 2)) + 0.3 * Math.exp(-(((j - 1) / 1.5) ** 2))), cols, FIG_PIECE.spider));
  }
  return out;
}
function tentacleMesh(Lv) {
  const out = [], cols = Lv.name === 'hd' ? 10 : 6;
  for (let i = 0; i < 3; i++) {
    const a = XJ['tn' + i + 'a'], b = XJ['tn' + i + 'b'], c = XJ['tn' + i + 'c'], tip = [c[0] * 1.2 + (i - 1) * 0.04, 0.42, c[2] + 0.05];
    out.push(chainTube('tentacle' + i, FIG_SLOT.skin, [a, b, c, tip], ['tn' + i + 'a', 'tn' + i + 'b', 'tn' + i + 'c'], () => 0.052, cols, FIG_PIECE.tentacle));
  }
  return out;
}
function tailMesh(Lv, long) {
  const a = XJ.tailA, b = XJ.tailB, c = XJ.tailC, cols = Lv.name === 'hd' ? 10 : 6;
  const pts = long ? [a, b, c, [0.06, 0.12, -0.3]] : [a, [0, 0.83, -0.2]];
  return chainTube(long ? 'ptail' : 'tail', FIG_SLOT.skin, pts, long ? ['tailA', 'tailB', 'tailC'] : ['tailA'], () => (long ? 0.058 : 0.048), cols, FIG_PIECE.tail);
}
// folded wings: a bony spar up over the shoulder and down to the hip, the membrane between it and the back
function wingMesh(Lv) {
  const out = [];
  for (const [s, bone] of [[1, 'wingL'], [-1, 'wingR']]) {
    const r = XJ[bone], wt = [[B[bone], 1]], n = Lv.name === 'hd' ? 10 : 6;
    const spar = (t) => { const u = t * Math.PI; return [r[0] + s * (0.08 + 0.12 * Math.sin(u)), r[1] + 0.22 * Math.cos(u * 0.9) - 0.42 * t, r[2] - 0.05 - 0.05 * Math.sin(u)]; };
    const bone3 = newPart('wingbone' + (s > 0 ? 'L' : 'R'), FIG_SLOT.horn);
    const path = []; for (let i = 0; i <= n; i++) path.push(spar(i / n));
    tubeAlong(bone3, path, path.map((_, i) => 0.02 * (1 - 0.75 * i / n)), 6, wt, [1, 0, 0], 1, FIG_PIECE.horn);
    out.push(bone3);
    const M = newPart('wing' + (s > 0 ? 'L' : 'R'), FIG_SLOT.skin), top = [], low = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, p = spar(t), root = [r[0] + s * 0.01, r[1] - 0.45 * t, r[2] + 0.01];
      // the membrane sags between the spar and the back, scalloped at its edge
      const sag = 0.025 * Math.sin(t * Math.PI);
      top.push(addV(M, p, wt, FIG_PIECE.wing, [t, 1]));
      low.push(addV(M, [(p[0] + root[0]) / 2, (p[1] + root[1]) / 2 - 0.02, (p[2] + root[2]) / 2 - sag], wt, FIG_PIECE.wing, [t, 0.5]));
      low.push(addV(M, root, wt, FIG_PIECE.wing, [t, 0]));
    }
    for (let i = 0; i < n; i++) {
      const a = top[i], b = top[i + 1], m0 = low[i * 2], m1 = low[i * 2 + 2], r0 = low[i * 2 + 1], r1 = low[i * 2 + 3];
      M.I.push(a, b, m0, b, m1, m0, m0, m1, r0, m1, r1, r0);
    }
    M.open = true;
    out.push(M);
  }
  return out;
}
// carapace: overlapping plates down the back and a pauldron on each shoulder, over the clothes
function carapaceMesh(PT, Lv) {
  const M = newPart('carapace', FIG_SLOT.horn), nu = Lv.name === 'hd' ? 14 : 8, nv = Lv.name === 'hd' ? 8 : 5;
  for (let i = 0; i < 5; i++) {
    const y = 1.42 - i * 0.085, S = PT.torso.at(Math.max(1.0, y)), z = S.cz - S.zb - 0.022;
    blobInto(M, [0, y, z], [1, 0, 0], [0, 1, 0], [0, 0, 1], [S.rx * (0.84 - i * 0.07), 0.056, 0.024], nu, nv, 4, torsoW(0, y), FIG_PIECE.plate);
  }
  for (const s of [1, -1]) blobInto(M, [s * 0.2, 1.4, -0.01], [s * 0.95, 0.3, 0], [-0.3 * s, 0.95, 0], [0, 0, 1], [0.095, 0.028, 0.095], nu, nv, 4, [[B[s > 0 ? 'uarmL' : 'uarmR'], 0.7], [B.chest, 0.3]], FIG_PIECE.plate);
  // a short horn up off each pauldron, so the shape reads before the detail does
  for (const s of [1, -1]) tubeAlong(M, [[s * 0.215, 1.43, -0.01], [s * 0.235, 1.46, -0.018], [s * 0.25, 1.49, -0.026]], [0.016, 0.009, 0.0005], 7, [[B[s > 0 ? 'uarmL' : 'uarmR'], 0.7], [B.chest, 0.3]], [0, 0, 1], 1, FIG_PIECE.plate);
  return M;
}
// bone blades out of the back of each forearm, along it toward the elbow
function bladeMesh(PT) {
  const M = newPart('blades', FIG_SLOT.horn);
  for (const L of ['L', 'R']) {
    const P = PT['arm' + L], at = (y, out) => { const S = P.at(y); return [S.cx, y, S.cz - S.zb - out]; };
    const path = [at(0.88, 0.0), at(0.97, 0.05), at(1.07, 0.09), at(1.17, 0.1), at(1.24, 0.075)];
    tubeAlong(M, path, [0.016, 0.026, 0.022, 0.012, 0.0005], 6, [[B['farm' + L], 1]], [0, 0, 1], 0.22, FIG_PIECE.blade);
  }
  return M;
}
// spurs at the elbows and a row down the spine
function spurMesh(PT) {
  const M = newPart('spurs', FIG_SLOT.horn), cone = (p, d, len, r, wt) => tubeAlong(M, [p, p.map((v, k) => v + d[k] * len * 0.5), p.map((v, k) => v + d[k] * len)], [r, r * 0.55, 0.0004], 6, wt, Math.abs(d[1]) > 0.8 ? [1, 0, 0] : [0, 1, 0], 1, FIG_PIECE.horn);
  for (const L of ['L', 'R']) { const S = PT['arm' + L].at(1.1); cone([S.cx, 1.1, S.cz - S.zb + 0.004], norm3([0, -0.4, -1]), 0.04, 0.011, [[B['farm' + L], 1]]); }
  for (let i = 0; i < 4; i++) { const y = 1.4 - i * 0.07; cone([0, y, backOf(PT, y) - 0.012], norm3([0, 0.35, -1]), 0.035 - i * 0.004, 0.01, torsoW(0, y)); }
  return M;
}
// on the head: a third eye up the brow, compound eyes over the two, ears grown out and pointed
function eye3Mesh(Lv, fs) {
  const M = newPart('eye3', FIG_SLOT.horn), p = facePoint(0, 1.682, fs);
  blobInto(M, [0, 1.682, p[2] - 0.004], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.015, 0.012, 0.01], Lv.name === 'hd' ? 16 : 10, Lv.name === 'hd' ? 10 : 6, 2, [[B.head, 1]], FIG_PIECE.eye3);
  return M;
}
function compoundMesh(Lv, fs) {
  const M = newPart('compound', FIG_SLOT.horn);
  for (const s of [1, -1]) { const p = facePoint(s * 0.031, EYE.y, fs); blobInto(M, [s * 0.031, EYE.y + 0.002, p[2] - 0.006], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.026, 0.021, 0.018], Lv.name === 'hd' ? 18 : 10, Lv.name === 'hd' ? 12 : 6, 2, [[B.head, 1]], FIG_PIECE.compound); }
  return M;
}
// bat ears: a tall rounded pinna each side, cupped forward to gather sound, flared up and out from the skull.
// A sheet, painted on both sides (gl/figure-hd.js: ridges inside, the rim inked).
function earMesh(Lv) {
  const M = newPart('ears', FIG_SLOT.skin), nu = Lv.name === 'hd' ? 10 : 6, nv = Lv.name === 'hd' ? 14 : 8, wt = [[B.head, 1]];
  for (const s of [1, -1]) {
    const base = [s * 0.068, 1.63, -0.018], U = norm3([s * 0.55, 1, -0.12]);
    let Wd = [s, 0, 0.25]; const d = Wd[0] * U[0] + Wd[1] * U[1] + Wd[2] * U[2]; Wd = norm3(Wd.map((v, k) => v - U[k] * d));
    let N = cross(U, Wd); if (N[2] < 0) N = N.map((v) => -v);
    const rows = [];
    for (let j = 0; j <= nv; j++) {
      const v = j / nv, w = 0.105 * Math.pow(Math.sin(Math.PI * (0.18 + 0.82 * v)), 0.8) * (1 - 0.55 * v) + 0.004, ring = [];
      for (let i = 0; i <= nu; i++) {
        const u = i / nu, cup = -0.026 * Math.sin(Math.PI * u) * (1 - 0.6 * v), h = 0.15 * v + 0.012 * Math.sin(Math.PI * u) * v;
        ring.push(addV(M, [0, 1, 2].map((k) => base[k] + U[k] * h + Wd[k] * (u - 0.5) * w + N[k] * cup), wt, FIG_PIECE.earbig, [u, v]));
      }
      rows.push(ring);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = rows[j][i], b = rows[j][i + 1], c = rows[j + 1][i], e = rows[j + 1][i + 1]; M.I.push(a, b, c, b, e, c); }
  }
  M.open = true;
  return M;
}
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
// A pair of glasses (flags.figure.glasses, `specs` in the key): two rectangular rims over the eyes on the face's
// own curve (`fs`), a bridge over the nose and the arms back along the sides of the head to the ears. Frames only:
// the eyes are drawn through them.
function specsMesh(Lv, fs) {
  const M = newPart('specs', FIG_SLOT.specs), wt = [[B.head, 1]], n = Lv.name === 'hd' ? 6 : 4, R = 0.0013;
  const W = 0.0205, H = 0.0118, y = FACE.eyeY + 0.0012, ex = EYE.man.x;
  // the lenses' plane stands this far in front of the face at the eye
  const zAt = (x) => facePoint(x, y, fs)[2] + 0.0105;
  for (const sd of [1, -1]) {
    const cx = sd * ex, z = zAt(cx), ring = [];
    for (let i = 0; i <= 24; i++) {
      // a rounded rectangle, a little wider at the top
      const a = (i / 24) * TAU, c = Math.cos(a), s = Math.sin(a);
      const sx = Math.sign(c) * Math.abs(c) ** 0.45, sy = Math.sign(s) * Math.abs(s) ** 0.55;
      const x = cx + sx * W * (sy > 0 ? 1 : 0.94), yy = y + sy * H;
      ring.push([x, yy, z - 0.004 * ((x - cx) * sd > 0 ? ((x - cx) * sd) / W : 0) ** 2]);
    }
    tubeAlong(M, ring, ring.map(() => R), n, wt, [0, 0, 1], 1, FIG_PIECE.goggles);
    // the arm: from the rim's outer top corner, round the side of the head, down behind the ear
    const x0 = cx + sd * W, arm = [[x0, y + H * 0.6, z - 0.004]];
    for (const phi of [0.62, 0.38, 0.14, -0.1, -0.3]) {
      const q = skullPoint(y + H * 0.5 - (phi < 0 ? 0.008 * (-phi / 0.3) : 0), phi, fs), d = norm3([q[0], 0, q[2] - ZC]);
      arm.push([sd * (Math.abs(q[0]) + Math.abs(d[0]) * 0.006), q[1], q[2] + d[2] * 0.006]);
    }
    tubeAlong(M, arm, arm.map((_, i) => R * (i ? 0.85 : 1)), n, wt, [0, 1, 0], 1, FIG_PIECE.goggles);
  }
  // the bridge, arched over the nose
  const bz = facePoint(0, y + 0.004, fs)[2] + 0.0075, ix = ex - W;
  tubeAlong(M, [[ix, y + 0.003, zAt(ex) - 0.001], [ix * 0.4, y + 0.0055, bz], [-ix * 0.4, y + 0.0055, bz], [-ix, y + 0.003, zAt(-ex) - 0.001]], [R, R, R, R], n, wt, [0, 1, 0], 1, FIG_PIECE.goggles);
  return M;
}
// A cap's peak (FIGURE_HATS `bill`): rooted round the crown's front at the bill's height, reaching `out` past it at
// the middle and nothing at the ends, so its outline is a crescent; the sides curved down (`bend`), the whole tipped
// down a little (`tilt`). Each ring across it is a closed loop, top surface then underside (FIG_PIECE.billUnder,
// which takes the cap's `hat_under` colour), and the front edge is capped.
function hatBill(HT, Lv) {
  const BL = HT.bill, [, cyc, czc] = HT.crown[0], [rx, ry, rz] = HT.crown[1], hd = Lv.name === 'hd';
  const ns = hd ? 16 : 8, nt = hd ? 5 : 3, k = Math.sqrt(Math.max(0, 1 - ((BL.y - cyc) / ry) ** 2)), wt = [[B.head, 1]];
  // where the peak is rooted: on a fitted shell, the shell's own surface at the bill's height; else the crown's ellipse
  const root = (ph, n) => {
    if (!HT.fit) return [rx * k * n[0], czc + rz * k * n[1]];
    const p = skullPoint(BL.y, Math.PI / 2 - ph), d = [p[0], p[2] - ZC], r = Math.hypot(d[0], d[1]) || 1, e = (r + HT.fit.off * 1.15) / r;
    return [d[0] * e, ZC + d[1] * e];
  };
  const at = (s, t, low) => {
    const ph = s * BL.span, n = [Math.sin(ph), Math.cos(ph)], o = BL.out * Math.sqrt(Math.max(0, 1 - s * s)) * t, q = root(ph, n);
    const y = BL.y - BL.bend * s * s * t ** 0.85 - BL.tilt * t - (low ? BL.th * (1 - 0.4 * t) : 0);
    return [q[0] + n[0] * o, y, q[1] + n[1] * o];
  };
  const M = newPart('bill', FIG_SLOT.hat), R = [];
  for (let j = 0; j <= nt; j++) {
    const t = j / nt, ring = [];
    for (let i = 0; i <= ns; i++) ring.push(addV(M, at(-1 + (2 * i) / ns, t, false), wt, FIG_PIECE.bill));
    for (let i = ns; i >= 0; i--) ring.push(addV(M, at(-1 + (2 * i) / ns, t, true), wt, FIG_PIECE.billUnder));
    R.push(ring);
  }
  stitchRings(M, R);
  const e = at(0, 1, false);
  capFan(M, R[nt], addV(M, [e[0], e[1] - BL.th * 0.3, e[2]], wt, FIG_PIECE.bill), false);
  orient(M);
  return M;
}
// A fitted cap's crown (FIGURE_HATS `fit`): rings from the band (capBandY, low at the back) up to the crown, each
// point the skull's own pushed `off` out round the skull's axis, the front panels standing a touch prouder, closed
// by a fan at the top where the button is. FIG_PIECE.hat, so the shader paints it as it did the old crown.
function hatShell(HT, Lv) {
  const off = HT.fit.off, hd = Lv.name === 'hd', nu = hd ? 36 : 16, nv = hd ? 10 : 5, wt = [[B.head, 1]], top = FACE.top;
  const M = newPart('hat', FIG_SLOT.hat), R = [];
  for (let j = 0; j <= nv; j++) {
    const t = j / nv, ring = [];
    for (let i = 0; i <= nu; i++) {
      const ph = (i % nu) / nu * TAU, a = Math.atan2(Math.cos(ph), Math.sin(ph) - 0), yb = capBandY(a) - 0.003 * (1 - t);
      const y = yb + (top - 0.0015 - yb) * t ** 0.85, p = skullPoint(Math.min(top - 0.0015, y), ph);
      const d = [p[0], p[2] - ZC], r = Math.hypot(d[0], d[1]) || 1e-4;
      // the front panels are built up, so they stand off the forehead more toward the top
      const o = off * (1 + 1.1 * Math.max(0, Math.sin(ph)) ** 1.5 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
      ring.push(addV(M, [d[0] * (r + o) / r, y + off * 0.85 * t * t, ZC + d[1] * (r + o) / r], wt, FIG_PIECE.hat));
    }
    R.push(ring);
  }
  stitchRings(M, R);
  capFan(M, R[nv], addV(M, [0, top + off * 0.9, ZC], wt, FIG_PIECE.hat), false);
  orient(M);
  return M;
}
// ── A WORK VEST'S MAKING (FIGURE_CUTS workvest) ─────────────────────────────────────────────────────────
// A point on a torso layer: at height y, round it by angle a (pi/2 straight ahead, less to the wearer's left), `e`
// out past its surface. `ringAt` is the layer's (clothLayer); the axis is the torso's own.
function onTorso(ringAt, a, y, e) {
  const ring = ringAt(y), cz = torsoSection(Math.max(T_TORSO.lo, Math.min(T_TORSO.hi, y))).cz, d = [Math.cos(a), Math.sin(a)];
  const t = ring ? rayOut(hull2(ring), [0, cz], d) : 0.15;
  return [d[0] * (t + e), y, cz + d[1] * (t + e)];
}
// A box standing off a torso layer: its outline the rectangle a0..a1 round, y0..y1 up, its sides from `e0` to `e1`
// out and its face pillowed `bulge` past that. Skinned to the torso at each point's height. Its own part.
function torsoBox(name, slot, ringAt, a0, a1, y0, y1, e0, e1, bulge, aux) {
  const M = newPart(name, slot), per = [], n = 4;
  for (let i = 0; i < n; i++) per.push([a1 + (a0 - a1) * (i / n), y1]);
  for (let i = 0; i < n; i++) per.push([a0, y1 + (y0 - y1) * (i / n)]);
  for (let i = 0; i < n; i++) per.push([a0 + (a1 - a0) * (i / n), y0]);
  for (let i = 0; i < n; i++) per.push([a1, y0 + (y1 - y0) * (i / n)]);
  const ring = (e) => per.map(([a, y]) => addV(M, onTorso(ringAt, a, y, e), TORSO_CHAIN(y), aux));
  const R0 = ring(e0), R1 = ring(e1), am = (a0 + a1) / 2, ym = (y0 + y1) / 2;
  stitchRings(M, [R0, R1]);
  capFan(M, R1, addV(M, onTorso(ringAt, am, ym, e1 + bulge), TORSO_CHAIN(ym), aux), false);
  orient(M);
  return M;
}
// A work apron (`apron: 'bib'` or `'waist'`), in the gear's leather: a panel down the front from the waist to the
// knee, hung off whatever is under it (the top, the trousers, a skirt) and skinned as a skirt is, so a stride carries
// it on the thighs; a bib over the chest on the top's layer for 'bib'; and the ties round the back at the waist.
// The panel is the front columns of a skirt's rings, so its two sides run straight down a column each.
function apronParts(layers, ringAt, Lv, kind, waist) {
  const out = [], H = Math.PI / 2, wy = waist + 0.012;
  const wraps = (y) => (y >= T_TORSO.lo + 0.005 ? (y < 0.95 ? ['torso', 'legL', 'legR'] : ['torso']) : ['legL', 'legR']);
  const centre = (y) => [0, torsoSection(Math.max(T_TORSO.lo, Math.min(T_TORSO.hi, y))).cz];
  // a sheet over the front: the columns of a cloth's rings whose ray is within `arc` of straight ahead
  const panel = (name, y0, y1, arc, ease, W) => {
    const rings = clothRings(layers, { name, kind: 'torso', y0, y1, aux: FIG_PIECE.apron, wraps, centre, ease, hug: 0, drape: 0.5 }, Lv);
    if (rings.length < 2) return;
    const front = rings[0].dirs.map((d, k) => [k, Math.atan2(d[0], d[1])]).filter(([, a]) => Math.abs(a) < arc).sort((p, q) => p[1] - q[1]).map(([k]) => k);
    const M = newPart(name, FIG_SLOT.gear), idx = rings.map((r) => front.map((k) => addV(M, r.pts[k], W(r.pts[k][0], r.y), FIG_PIECE.apron)));
    for (let i = 0; i + 1 < idx.length; i++) for (let j = 0; j + 1 < front.length; j++) {
      const a = idx[i][j], b = idx[i][j + 1], c = idx[i + 1][j], d = idx[i + 1][j + 1];
      M.I.push(a, c, b, b, c, d);
    }
    orient(M);
    out.push(M);
  };
  // the skirt, from the waist to the knee (to above it, tied at the waist), a little fuller toward its hem
  panel('apron', wy, kind === 'bib' ? 0.5 : 0.6, 0.95, (y) => 0.006 + 0.01 * smooth(wy, 0.7, y), skirtW);
  // the bib, over the chest and up to under the collarbones: over the bust as the top is, not across it
  if (kind === 'bib') {
    panel('apronBib', 1.3, wy - 0.004, 0.62, () => 0.005, torsoW);
    // and its strap: from each top corner up over the chest to the side of the neck and round the back of it
    const S = newPart('apronStrap', FIG_SLOT.gear), N = neckAt(1.45);
    for (const sd of [1, -1]) {
      const path = [onTorso(ringAt, H - sd * 0.55, 1.292, 0.006), onTorso(ringAt, H - sd * 0.8, 1.39, 0.006),
        [sd * (N.rx + 0.007), 1.45, N.cz], [sd * N.rx * 0.6, 1.455, N.cz - N.rz - 0.004], [0, 1.455, N.cz - N.rz - 0.007]];
      tubeAlong(S, path, [0.0035, 0.0035], 6, TORSO_CHAIN(1.4), [0, 1, 0], 2.2, FIG_PIECE.apron);
    }
    out.push(S);
  }
  // the ties: a band round the back at the waist, from one side of the panel to the other
  out.push(torsoBox('apronTie', FIG_SLOT.gear, ringAt, H + 0.9, H + 2 * Math.PI - 0.9, wy - 0.006, wy + 0.012, 0.0008, 0.003, 0, FIG_PIECE.apron));
  return out;
}
// The vest's pockets: two on the chest and two lower, each a box with a flap over its mouth and a snap on the flap,
// and a pen in the left chest pocket. `ringAt` is the vest's layer.
function vestPockets(ringAt, Lv) {
  const out = [], H = Math.PI / 2, hd = Lv.name === 'hd';
  const P = [
    { c: 0.6, w: 0.19, y0: 1.235, y1: 1.33, d: 0.011 },
    { c: 0.7, w: 0.26, y0: 0.985, y1: 1.115, d: 0.015 },
  ];
  for (const sd of [1, -1]) for (const [i, p] of P.entries()) {
    const ac = H - sd * p.c, a0 = ac - p.w, a1 = ac + p.w;
    out.push(torsoBox('pocket', FIG_SLOT.top, ringAt, a0, a1, p.y0, p.y1, 0.0006, p.d, 0.004, FIG_PIECE.pocket));
    // the flap: a little wider than the mouth, from just over it to a third of the way down, standing proud of it
    const fy0 = p.y1 - (p.y1 - p.y0) * 0.36;
    out.push(torsoBox('flap', FIG_SLOT.top, ringAt, a0 - 0.02, a1 + 0.02, fy0, p.y1 + 0.008, 0.0008, p.d + 0.004, 0.0015, FIG_PIECE.pocket));
    if (!hd && Lv.name !== 'lite') continue;
    // the snap, a press stud on the flap's middle
    const S = newPart('snap', FIG_SLOT.specs), c = onTorso(ringAt, ac, fy0 + 0.012, p.d + 0.0065);
    blobInto(S, c, [-Math.sin(ac), 0, Math.cos(ac)], [0, 1, 0], [Math.cos(ac), 0, Math.sin(ac)], [0.0055, 0.0055, 0.0025], 8, 4, 2, TORSO_CHAIN(fy0), FIG_PIECE.pocket);
    out.push(S);
    // a pen clipped in the left chest pocket, its cap standing out of the mouth
    if (i === 0 && sd > 0) {
      const Pn = newPart('pen', FIG_SLOT.specs), b = onTorso(ringAt, a1 - 0.05, p.y1 - 0.02, p.d * 0.5), t = onTorso(ringAt, a1 - 0.05, p.y1 + 0.03, p.d * 0.5);
      tubeAlong(Pn, [b, t], [0.0038, 0.0034], 6, TORSO_CHAIN(p.y1), [1, 0, 0], 1, FIG_PIECE.pocket);
      out.push(Pn);
    }
  }
  return out;
}
// THE VAT SUIT'S MAKING (FIGURE_CUTS vatsuit_*): what's sewn onto it, each a piece standing off the cloth so it
// catches the light and the ink. A chest pocket on the wearer's left with a flap and a snap, a batch tape across the
// right breast (the shirt's slot, white, which nothing else on a closed suit shows), and the repairs `V` asks for:
// a panel over the front of each shoulder, a patch on the back of each elbow, one on each knee (or only the left),
// and on a hard-worn suit a smaller patch stitched over the knee's. Patches take the top's own
// slot, so they read as the same cloth sewn on twice; the stitching round each is the pocket's paint.
function vatSuitDetail(V, ringAt, layers, PT, Lv, legs) {
  const out = [], H = Math.PI / 2, hd = Lv.name === 'hd', nu = hd ? 14 : 8, nv = hd ? 8 : 5;
  // the chest pocket, its flap and its snap
  const ac = H - 0.62, a0 = ac - 0.19, a1 = ac + 0.19, y0 = 1.225, y1 = 1.33, fy0 = y1 - 0.036;
  out.push(torsoBox('pocket', FIG_SLOT.top, ringAt, a0, a1, y0, y1, 0.0006, 0.008, 0.003, FIG_PIECE.pocket));
  out.push(torsoBox('flap', FIG_SLOT.top, ringAt, a0 - 0.02, a1 + 0.02, fy0, y1 + 0.008, 0.0008, 0.012, 0.0015, FIG_PIECE.pocket));
  if (hd || Lv.name === 'lite') {
    const S = newPart('snap', FIG_SLOT.specs), c = onTorso(ringAt, ac, fy0 + 0.012, 0.0145);
    blobInto(S, c, [-Math.sin(ac), 0, Math.cos(ac)], [0, 1, 0], [Math.cos(ac), 0, Math.sin(ac)], [0.0055, 0.0055, 0.0025], 8, 4, 2, TORSO_CHAIN(fy0), FIG_PIECE.pocket);
    out.push(S);
    // the zip's pull, hanging off the slider at the collar
    const Z = newPart('zippull', FIG_SLOT.specs), z = onTorso(ringAt, H, 1.415, 0.008);
    blobInto(Z, z, [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.0055, 0.012, 0.0022], 8, 4, 3, TORSO_CHAIN(1.415), FIG_PIECE.pocket);
    out.push(Z);
  }
  // the batch tape
  const at = H + 0.6;
  out.push(torsoBox('tape', FIG_SLOT.shirt, ringAt, at - 0.2, at + 0.2, 1.282, 1.316, 0.0005, 0.003, 0.0008, FIG_PIECE.pocket));
  // the shoulders' panels, over the front of each, from the collarbone toward the arm
  if (V.shoulders) for (const sd of [1, -1]) { const c = H - sd * 1.02; out.push(torsoBox('yoke', FIG_SLOT.top, ringAt, c - 0.3, c + 0.3, 1.335, 1.415, 0.0005, 0.0045, 0.0015, FIG_PIECE.pocket)); }
  // a patch on a limb: on its cloth's outermost layer at `y`, facing `dir` round it (z forward), skinned to two bones
  const limbPatch = (name, layer, P, y, dir, radii, wt, lift = 0.002, ax = [1, 0, 0]) => {
    const S = P.at(y), R = hull2(ringOf(layers, layer, y) || []);
    const r = (R.length ? rayOut(R, [S.cx, S.cz], dir) : 0.05) + lift, c = [S.cx + dir[0] * r, y, S.cz + dir[1] * r];
    const M = newPart(name, FIG_SLOT.top);
    blobInto(M, c, ax, [0, 1, 0], [dir[0], 0, dir[1]], radii, nu, nv, 5, wt, FIG_PIECE.pocket);
    return M;
  };
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R';
    if (legs && (V.knees === 2 || (V.knees === 1 && s > 0))) {
      const wt = [[B['thigh' + L], 0.35], [B['shin' + L], 0.65]];
      out.push(limbPatch('kpatch' + L, 'leg' + L, PT['leg' + L], 0.505, [0, 1], [0.05, 0.066, 0.006], wt));
      if (V.double) out.push(limbPatch('kpatch2' + L, 'leg' + L, PT['leg' + L], 0.52, [s * 0.18, 0.98], [0.028, 0.032, 0.006], wt, 0.008));
    }
    if (V.elbows) out.push(limbPatch('epatch' + L, 'arm' + L, PT['arm' + L], 1.1, [0, -1], [0.034, 0.05, 0.005], [[B['uarm' + L], 0.5], [B['farm' + L], 0.5]]));
  }
  return out;
}
// The binding down each edge of an open front, from the neck to the hem: short lengths of tube, each skinned at its
// own height so it follows the body as it bends. `half(y)` is the opening's half-width.
function frontBinding(ringAt, half, yTop, yBot, slot) {
  const out = [], step = 0.04;
  for (const sd of [1, -1]) {
    const pts = [];
    for (let y = yTop; y > yBot - 1e-6; y -= step) {
      const ring = ringAt(y);
      if (!ring) continue;
      const cz = torsoSection(Math.max(T_TORSO.lo, Math.min(T_TORSO.hi, y))).cz;
      let best = null;
      for (const q of ring) if (q[2] > cz && (!best || Math.abs(q[0] - sd * half(y)) < Math.abs(best[0] - sd * half(y)))) best = q;
      if (best) { const d = norm3([best[0], 0, best[2] - cz]); pts.push([sd * half(y), y, best[2] + d[2] * 0.002]); }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const M = newPart('binding', slot), ym = (pts[i][1] + pts[i + 1][1]) / 2;
      tubeAlong(M, [pts[i], pts[i + 1]], [0.0035, 0.0035], 5, TORSO_CHAIN(ym), [0, 0, 1], 1.6, FIG_PIECE.pocket);
      out.push(M);
    }
  }
  return out;
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
// Whether a figure has been built (here, or handed in by figure-ahead.js), without building it.
export const figureBuilt = (k) => _cache.has(figureKey(k));
// A figure built in figure-worker.js, kept as if it had been built here; the one already here wins.
export function figureAdopt(k, F) { const key = figureKey(k); if (!_cache.has(key)) _cache.set(key, F); return _cache.get(key); }
// The worker's own copy, let go once it's been posted to the page, so the worker doesn't keep a second city of people.
export function figureForget(k) { _cache.delete(figureKey(k)); }
const GEAR_LETTER = { belt: 'b', strap: 's', pouch: 'p', pads: 'k' };
const gearCode = (g) => Object.entries(GEAR_LETTER).map(([k, c]) => ((k === 'belt' ? g?.belt !== false : !!g?.[k]) ? c : '')).join('');
// `sculpt` is the revised figure (docs/proposals/sculpted-figure.md), on the close-up levels only.
export const figureKey = ({ cut = 'coat', style = 0, level = 'hd', wear = null, gear = null, body = null, sculpt = false, head = 0, build = 'average', weight = null, beard = '', prop = '', bust = null, butt = null, groin = '', bottoms = '', hat = '', scarf = '', spikes = 0, specs = 0, chain = 0, fan = 0, boots = '', apron = '', faceHd = false, tune = '' } = {}) => `${cut}|${style}|${level}|${wear ? JSON.stringify(wear) : ''}|${gearCode(gear)}|${bodyCode(body)}${sculpt ? '|s' + head + build + (weight === null ? '' : '|w' + weight) + (beard ? '|b' + beard : '') + (prop ? '|p' + prop : '') + (bust === null ? '' : '|B' + bust) + (butt === null ? '' : '|T' + butt) + (groin ? '|g' + groin : '') + (spikes ? '|k' + spikes : '') : ''}${bottoms ? '|o' + bottoms : ''}${hat ? '|h' + hat : ''}${scarf ? '|f' + scarf : ''}${specs ? '|e' : ''}${chain ? '|c' : ''}${fan ? '|n' + fan : ''}${boots ? '|t' + boots : ''}${apron ? '|a' + apron : ''}${faceHd ? '|F' : ''}${sculpt && tune ? '|u' + tune : ''}`;
const SCULPT_DY = { hd: { torso: 0.018, arm: 0.02, leg: 0.024, foot: 0.016 }, lite: { torso: 0.023, arm: 0.025, leg: 0.03, foot: 0.024 } };
export function buildFigure({ cut = 'coat', style = 0, level = 'hd', wear = null, gear = null, body = null, sculpt: sculptAsked = false, head = 0, build = 'average', weight = null, beard = '', prop = '', bust = null, butt = null, groin = '', bottoms = '', hat = '', scarf = '', spikes = 0, specs = 0, chain = 0, fan = 0, boots = '', apron = '', faceHd = false, tune = '' } = {}) {
  const key = figureKey({ cut, style, level, wear, gear, body, sculpt: sculptAsked, head, build, weight, beard, prop, bust, butt, groin, bottoms, hat, scarf, spikes, specs, chain, fan, boots, apron, faceHd, tune });
  if (_cache.has(key)) return _cache.get(key);
  // a MORPHEX cut is drawn by the sculpted figure only; any other level draws the street style it's nearest
  if (HAIR_CUTS[style] && !(sculptAsked && FIGURE_LEVELS[level].skin)) style = cutBase(style);
  const sculpt = sculptAsked && FIGURE_LEVELS[level].skin, BK = sculpt ? buildOf(build) : SCULPT_BUILDS.average, SW = sculpt && weight !== null ? somaOf(weight) : null, NKb = BK.neck * (SW ? SW.neck : 1), NK = sculpt ? NECK_SCULPT * NKb : 1, FS0 = sculpt ? weightedFace(tunedFace(SCULPT_HEADS[head] || 'sculpt', tune), weight) : 'comic', FS = sculpt && faceHd && level === 'hd' ? hdFace(FS0) : FS0;
  const Lv = sculpt ? { ...FIGURE_LEVELS[level], dy: SCULPT_DY[level] } : FIGURE_LEVELS[level];
  GIRDLE = !!Lv.skin;
  const C0 = FIGURE_CUTS[cut] || FIGURE_CUTS.coat, C = sculpt ? sculptCut(C0, SW ? SW.fat : 0) : C0, code = gearCode(gear);
  const G = { belt: code.includes('b'), strap: code.includes('s') && Lv.skin, pouch: code.includes('p') && Lv.skin, pads: code.includes('k') && Lv.skin };
  const on = { top: true, legs: true, shoes: true, ...(wear || {}) };
  const TR0 = sculpt ? { ...TROUSERS, hug: 0.5, ease: 0.011, seatDrape: 3, seatFoot: 0.85 } : TROUSERS;
  // underwear cuts its trousers short (a cut's `legs`)
  const BT = !C.legs && C.top.hem >= 0.81 ? FIGURE_BOTTOMS[bottoms] || null : null;
  // steel-toe work boots (`boots: 'steeltoe'`): built before the trousers, which hang straight over the shaft to the
  // instep with no cuff; the foot chunkier, its sole thicker, its toe longer and boxed
  // low shoes (`boots: 'dress'`, an oxford; `'trainer'`, a running shoe): no shaft, so they're built first too and the
  // trousers fall straight onto the instep
  const low = boots === 'dress' || boots === 'trainer';
  const over = (boots === 'steeltoe' || low) && !C.legs && !BT;
  // a dress sandal needs the bare foot's toes, which only the close-up levels have; the rest keep the shoe
  // (`sandal_flat`: a man's flat sandal, the same straps with no heel)
  const flat = boots === 'sandal_flat' && sculpt && !!Lv.fingers, sandal = (boots === 'sandal' && sculpt && !!Lv.fingers) || flat;
  const TR = C.legs ? { ...TR0, ...C.legs } : BT ? { ...TR0, ...BT.legs } : TR0, legHem = over ? (low ? 0.072 : 0.085) : TR.hem, legWaist = TR.waist;
  // the street's levels have no sculpted head or paint, but they can take its body, for actor3d.js's body offsets
  const shaped = sculptAsked && !sculpt && weight !== null, PT = partsFor(body, sculpt || shaped, build, weight, sculpt ? bust : null, sculpt ? butt : null, sculpt ? groin : '', sculpt && level === 'hd'), BD = Lv.skin ? body || {} : {};
  const slotOf = (name, dflt) => (name === 'shirt' ? FIG_SLOT.shirt : name === 'cloak' ? FIG_SLOT.cloak : dflt);
  const parts = [];
  const layers = {}, cover = {};
  for (const k of Object.keys(PT)) layers[k] = [bodyLayer(PT[k])];
  const cov = (name, lo, hi) => { (cover[name] ||= []).push([lo, hi]); };
  const skirt = on.top && C.top.hem < 0.81;

  // trousers first, so whatever goes over them hulls them (boots worn under the jeans go first instead)
  const trousers = () => { if (on.legs) {
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R', P = PT['leg' + L];
      // a leg's cloth is hidden above a coat's hem, so it starts just above it
      const top = skirt ? Math.min(P.hi, C.top.hem + 0.03) : P.hi;
      const spec = { name: 'trouser' + L, kind: 'leg', aux: FIG_PIECE.trouser, y0: top, y1: legHem, wraps: () => ['leg' + L], centre: (y) => { const S = P.at(y); return [S.cx, S.cz]; }, ease: () => TR.ease, hug: TR.hug, drape: TR.drape };
      const rings = clothRings(layers, spec, Lv);
      const part = clothMesh(rings, spec, Lv, (x, y) => legW(L)(y), FIG_SLOT.legs);
      parts.push(part);
      layers['leg' + L].push(clothLayer(rings));
      cov('leg' + L, legHem + 0.012, 2);
    }
    if (!skirt) {
      // the seat: the torso from the waist down, round both legs' tops
      const spec = { name: 'seat', kind: 'torso', aux: FIG_PIECE.trouser, y0: legWaist, y1: TR.seatFoot || 0.8, wraps: (y) => ['torso', 'legL', 'legR'], centre: (y) => [0, torsoSection(Math.max(T_TORSO.lo, y)).cz], ease: (y) => TR.ease * smooth(0.79, 0.86, y) - (sculpt ? 0.008 * smooth(0.91, 0.85, y) : 0), hug: 0, drape: TR.seatDrape };
      const rings = clothRings(layers, spec, Lv);
      const part = clothMesh(rings, spec, { ...Lv, hem: false }, (x, y) => torsoW(x, y), FIG_SLOT.legs);
      // closed under the crotch
      const R = rings[rings.length - 1], last = part.P.length / 3 - R.pts.length;
      capFan(part, R.pts.map((_, k) => last + k), addV(part, [0, R.y - 0.005, R.o[1]], torsoW(0, R.y)), false);
      parts.push(part);
      layers.torso.push(clothLayer(rings));
      cov('torso', 0, legWaist - 0.012);
    }
  } };
  const shoes = () => { if (on.shoes) {
    const bootTop = sculpt && !softFace(FS0) ? BOOT.top : BOOT.tall;
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R', P = PT['leg' + L];
      if (sandal) { parts.push(sandalMesh(s, Lv, P, !flat)); continue; }
      if (low) { parts.push(lowShoe(s, Lv, boots)); cov('foot' + L, -1, 2); continue; }
      parts.push(over ? footMesh(s, Lv, FIG_SLOT.shoes, SHOE.ease + 0.007, (z) => shoeSole(z) + 0.008, [SHOE.heel + 0.007, SHOE.toe + 0.014]) : footMesh(s, Lv, FIG_SLOT.shoes, SHOE.ease, (z) => shoeSole(z) + 0.011 * gx(z - 0.014, 0.027), [SHOE.heel, SHOE.toe]));
      cov('foot' + L, -1, 2);
      // the boot's shaft, over whatever the leg wears there, a little fuller at its top
      const sp = { name: 'boot' + L, kind: 'leg', aux: FIG_PIECE.boot, y0: bootTop, y1: BOOT.foot, wraps: () => ['leg' + L], centre: (y) => { const S = P.at(y); return [S.cx, S.cz]; },
        ease: (y) => BOOT.ease + 0.004 * smooth(bootTop - 0.05, bootTop, y), hug: 0.55, drape: 0.25 };
      const rings = clothRings(layers, sp, Lv);
      parts.push(clothMesh(rings, sp, { ...Lv, hem: false }, (x, y) => legW(L)(y), FIG_SLOT.shoes));
      layers['leg' + L].push(clothLayer(rings));
      cov('leg' + L, -1, bootTop - 0.012);
      // the trousers' cuff rolled up and resting on the boot's top, over the trouser above and the
      // shaft below
      if (!over && on.legs && legHem < bootTop && !(skirt && C.top.hem < bootTop + 0.06)) {
        const cs = { name: 'cuff' + L, kind: 'leg', aux: FIG_PIECE.cuff, y0: bootTop + 0.032, y1: bootTop - 0.01, wraps: () => ['leg' + L], centre: (y) => { const S = P.at(y); return [S.cx, S.cz]; }, ease: () => 0.007, hug: 0, drape: 9 };
        parts.push(clothMesh(clothRings(layers, cs, Lv), cs, Lv, (x, y) => legW(L)(y), FIG_SLOT.legs));
      }
    }
  } };
  if (over) { shoes(); trousers(); } else { trousers(); shoes(); }
  // a skirt over the briefs, from the waist, round the legs below the crotch as a coat's hem is
  if (on.legs && BT?.skirt && Lv.skin) {
    const K = BT.skirt;
    const sp = { name: 'skirt', kind: 'torso', y0: K.waist, y1: K.hem, aux: FIG_PIECE.skirt,
      wraps: (y) => (y >= T_TORSO.lo + 0.005 ? (y < 0.95 ? ['torso', 'legL', 'legR'] : ['torso']) : ['legL', 'legR']),
      centre: (y) => [0, torsoSection(Math.max(T_TORSO.lo, Math.min(T_TORSO.hi, y))).cz],
      ease: (y) => K.ease + K.flare * smooth(0.86, K.hem, y), hug: K.hug, drape: K.drape };
    const rings = clothRings(layers, sp, Lv);
    parts.push(clothMesh(rings, sp, Lv, skirtW, FIG_SLOT.legs));
    layers.torso.push(clothLayer(rings));
    cov('torso', K.hem + 0.012, K.waist - 0.006);
  }
  if (on.top) {
    // a top worn open over its own tee (FIGURE_CUTS `undertop`): the tee first, in the shirt's slot, so the top over
    // it hulls it and its open front shows it
    const topSpec = (T, name) => ({
      name, kind: 'torso', y0: T.neck, y1: T.hem,
      wraps: (y) => (y >= T_TORSO.lo + 0.005 ? (y < 0.95 ? ['torso', 'legL', 'legR'] : ['torso']) : ['legL', 'legR']),
      centre: (y) => [0, torsoSection(Math.max(T_TORSO.lo, Math.min(T_TORSO.hi, y))).cz],
      // over the trousers' waist the top stands off them, not the skin
      ease: (y) => T.ease + T.flare * smooth(0.86, T.hem, y) + (on.legs && y < legWaist + 0.012 ? 0.002 : 0),
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
    });
    if (C.undertop) {
      const usp = topSpec(C.undertop, 'undertop'), urings = clothRings(layers, usp, Lv);
      parts.push(clothMesh(urings, usp, Lv, torsoW, FIG_SLOT.shirt));
      layers.torso.push(clothLayer(urings));
    }
    const T = C.top, spec = topSpec(T, 'top');
    // below the torso's foot the legs' layer is the trousers'
    const rings = clothRings(layers, spec, Lv), topPart = clothMesh(rings, spec, T.jag ? { ...Lv, hem: false } : Lv, skirt ? (sculpt && cutIsDress(cut) && T.hug >= 0.4 ? skirtFitted : skirtW) : torsoW, FIG_SLOT.top);
    // an open front (`openFront`, half-widths at the neck and the hem): the top's cloth cut away in a V down the front,
    // so what's under it shows, and its two edges bound
    const half = C.openFront ? (y) => C.openFront[0] + (C.openFront[1] - C.openFront[0]) * Math.max(0, Math.min(1, (T.neck - y) / (T.neck - T.hem))) : null;
    if (half) {
      // every point of the cloth inside the opening is moved out to its edge, on its own side, so the edge runs as
      // one clean line; a face left with points on both edges would bridge the gap, and one with all three on an
      // edge is a sliver, so both go. Deleting whole faces left the edge a saw-tooth.
      const P = topPart.P, side = new Int8Array(P.length / 3), keep = [];
      for (let v = 0; v < P.length / 3; v++) {
        const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], cz = torsoSection(Math.max(T_TORSO.lo, Math.min(T_TORSO.hi, y))).cz, h = half(y);
        if (z > cz && Math.abs(x) < h && y > T.hem - 0.002) { side[v] = x >= 0 ? 1 : -1; P[v * 3] = side[v] * h; }
      }
      for (let t = 0; t < topPart.I.length; t += 3) {
        const v = [topPart.I[t], topPart.I[t + 1], topPart.I[t + 2]], s = v.map((i) => side[i]);
        if (s.includes(1) && s.includes(-1)) continue;
        if (s[0] && s[1] && s[2]) continue;
        keep.push(...v);
      }
      topPart.I = keep;
    }
    parts.push(topPart);
    const topLayer = clothLayer(rings);
    layers.torso.push(topLayer);
    cov('torso', T.hem + 0.012, T.neck - 0.006);
    if (half && Lv.skin) parts.push(...frontBinding(topLayer.ringAt, half, T.neck - 0.012, T.hem + 0.012, FIG_SLOT.top));
    if (C.pockets && Lv.skin) parts.push(...vestPockets(topLayer.ringAt, Lv));
    if ((apron === 'bib' || apron === 'waist') && Lv.skin) parts.push(...apronParts(layers, topLayer.ringAt, Lv, apron, legWaist));
    // the sleeves: a long sleeve under the cut's own first, where it has one (`undersleeve`, in the shirt's slot:
    // a ballplayer's undershirt under his jersey's short sleeve), so the sleeve over it hulls it
    const sleeveSets = [];
    if (C.undersleeve && Lv.skin) sleeveSets.push([C.undersleeve, 'under', FIG_SLOT.shirt]);
    if (C.sleeve) sleeveSets.push([C.sleeve, 'sleeve', FIG_SLOT.top]);
    for (const [Sl, prefix, slot0] of sleeveSets) for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R', P = PT['arm' + L];
      const lean = deltoidLean(P, sculpt ? 0.25 : 0.5);
      const sp = {
        name: prefix + L, kind: 'arm', y0: P.hi - (sculpt ? 0.003 : 0.004), y1: Sl.cuff,
        wraps: () => ['arm' + L], centre: (y) => { const S = P.at(y); return [S.cx, S.cz]; },
        ease: (y) => Sl.ease + Sl.open * smooth(Sl.cuff + 0.06, Sl.cuff, y) + 0.6 * (C.shoulder || 0) * smooth(1.33, 1.4, y), hug: sculpt ? 0.6 : 0.3, drape: Sl.drape, aux: FIG_PIECE.sleeve,
        capTop: (R0) => { const c = armCapPoint(s, P); return [c[0], c[1] + Sl.ease - (sculpt ? 0.004 : 0), c[2]]; },
        cinch: C.rib ? { top: Sl.cuff + 0.035, foot: Sl.cuff - 0.001, ease: 0.004 } : null,
      };
      const rings = clothRings(layers, sp, Lv);
      for (const r of rings) r.pts = r.pts.map(lean);
      const part = clothMesh(rings, sp, Lv, sculpt ? armWS(L) : (x, y) => armW(L)(y), slotOf(Sl.slot, slot0));
      parts.push(part);
      layers['arm' + L].push(clothLayer(rings));
      cov('arm' + L, Sl.cuff + 0.012, 2);
    }
    if (C.vat && Lv.skin) parts.push(...vatSuitDetail(C.vat, topLayer.ringAt, layers, PT, Lv, on.legs));
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
    // a hat: its crown and brim on the head bone, in its own slot (the shoes' colour unless the look names one)
    const HT = Lv.skin && FIGURE_HATS[hat];
    if (HT && HT.fit) {
      parts.push(hatShell(HT, Lv));
      if (HT.bill) parts.push(hatBill(HT, Lv));
    } else if (HT && (HT.crown || HT.band || HT.brim)) {
      const M = newPart('hat', FIG_SLOT.hat), nu = Lv.name === 'hd' ? 24 : 12, nv = Lv.name === 'hd' ? 12 : 6;
      for (const k of ['crown', 'band', 'brim']) if (HT[k]) blobInto(M, HT[k][0], [1, 0, 0], [0, 1, 0], [0, 0, 1], HT[k][1], nu, nv, HT[k][2], [[B.head, 1]], FIG_PIECE.hat);
      if (HT.bill && HT.crown) parts.push(hatBill(HT, Lv));
      parts.push(M);
    }
    // a scarf: a loop (or two) round the neck over the collar, and a tail down the front, in the shirt's colour
    const SC = Lv.skin && FIGURE_SCARVES[scarf];
    if (SC) {
      const M = newPart('scarf', FIG_SLOT.shirt), n = Lv.name === 'hd' ? 10 : 6;
      for (let w = 0; w < SC.wrap; w++) {
        const y = 1.462 - w * 0.03, N = neckAt(y, NK), path = [];
        for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI * 2; path.push([Math.sin(a) * (N.rx + SC.r * 0.9), y + 0.006 * Math.cos(a * 2), N.cz + Math.cos(a) * (N.rz + SC.r * 0.9)]); }
        tubeAlong(M, path, path.map(() => SC.r), n, TORSO_CHAIN(1.45), [0, 1, 0], 0.6, FIG_PIECE.scarf);
      }
      if (SC.tail) {
        // one end down the front off to the side, or two either side of the middle, the right one longer
        const ends = SC.ends === 2 ? [[0.8, 1], [-0.8, 0.86]] : [[0.35, 1]], er = SC.endR || SC.r;
        for (const [dx, len] of ends) {
          const path = [0, 0.25, 0.5, 0.75, 1].map((t) => { const y = 1.45 - t * SC.tail * len, pts = ringOf(layers, 'torso', Math.max(T_TORSO.lo + 0.01, y)), o = [0, torsoSection(Math.max(T_TORSO.lo, y)).cz], d = norm2([dx, 1]), r = pts ? rayOut(hull2(pts), o, d) : 0.1; return [o[0] + d[0] * (r + SC.r), y, o[1] + d[1] * (r + SC.r)]; });
          tubeAlong(M, path, path.map((_, i) => er * (1 - 0.15 * i / 4)), n, TORSO_CHAIN(1.3), [1, 0, 0], 0.45, FIG_PIECE.scarf);
        }
      }
      parts.push(M);
    }
    // a chain: round the base of the neck at the back, lying on the chest and dipping to the breastbone in front,
    // in the glasses' frame slot (gl/room-people.js gives it the chain's colour)
    if (chain && Lv.skin) {
      const M = newPart('chain', FIG_SLOT.specs), cr = 0.0032, path = [];
      for (let i = 0; i <= 32; i++) {
        const a = (i / 32) * Math.PI * 2, f = ((1 + Math.cos(a)) / 2) ** 2, y = 1.448 - 0.1 * f, d = [Math.sin(a), Math.cos(a)];
        const N = neckAt(y, NK), rn = 1 / Math.hypot(d[0] / (N.rx + 0.006), d[1] / (N.rz + 0.006));
        const pts = y < 1.44 ? ringOf(layers, 'torso', Math.max(T_TORSO.lo + 0.01, y)) : null, o = [0, pts ? torsoSection(y).cz : N.cz];
        const rr = (pts ? rayOut(hull2(pts), o, d) : rn) + cr + 0.002;
        path.push([o[0] + d[0] * rr, y, o[1] + d[1] * rr]);
      }
      tubeAlong(M, path, path.map(() => cr), Lv.name === 'hd' ? 6 : 4, TORSO_CHAIN(1.42), [0, 1, 0], 0.5, FIG_PIECE.chain);
      parts.push(M);
    }
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
    const hk = sculpt ? handScaleOf({ build, weight, body, bust }, s) : HAND_K * (BD.mighty === (s > 0 ? 'L' : 'R') ? 1.12 : 1);
    const hand = handMesh(s, Lv, hk, sculpt);
    parts.push(hand);
    // what this hand holds (prop is 'L:cigarette;R:scotch'), close up only
    const held = sculpt && Lv.fingers ? propsOf(prop)[s > 0 ? 'L' : 'R'] : '';
    if (held && PROPS[held]) parts.push(propMesh(held, s, Lv, hk));
    if (BD.claws && Lv.fingers) parts.push(clawMesh(hand, s, Lv));
  }
  if (BD.thorn) parts.push(thornMesh(PT, Lv));
  if (BD.teeth) parts.push(teethMesh(Lv, layers));
  // the mutations' growths (MUTATION_LOOK), over whatever they wear
  if (BD.blades) parts.push(bladeMesh(PT));
  if (BD.spurs) parts.push(spurMesh(PT));
  if (BD.carapace) parts.push(carapaceMesh(PT, Lv));
  if (BD.tail || BD.ptail) parts.push(tailMesh(Lv, !!BD.ptail));
  if (BD.wings) parts.push(...wingMesh(Lv));
  if (BD.spider) parts.push(...spiderMesh(Lv));
  if (BD.tentacles) parts.push(...tentacleMesh(Lv));
  // the skin, what the clothes leave of it
  if (Lv.skin) {
    const covered = (name, y) => (cover[name] || []).some(([lo, hi]) => y > lo && y < hi);
    const bodyParts = [
      bodyPart(PT.torso, Lv, (x, y) => torsoW(x, y), [0, T_TORSO.hi + 0.004, -0.022], TORSO_CAP),
      ...[1, -1].map((s) => { const L = s > 0 ? 'L' : 'R', P = PT['arm' + L], lean = deltoidLean(P, P.cap ? 0 : 0.5); const M = bodyPart(P, Lv, sculpt ? armWS(L) : (x, y) => armW(L)(y), armCapPoint(s, P), null); if (sculpt) M.A.fill(FIG_PIECE.sleeve); for (let i = 0; i < M.P.length; i += 3) { const q = lean([M.P[i], M.P[i + 1], M.P[i + 2]]); M.P[i + 1] = q[1]; } return M; }),
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
      if (sandal && !flat && M.name.startsWith('leg')) ankleLift(M);
      if (keep.length) parts.push(compact(M));
    }
    for (const s of [1, -1]) if (sandal) parts.push(flat ? bareFootMesh(s, Lv) : heelPose(bareFootMesh(s, Lv)));
    else if (!on.shoes) parts.push(sculpt && Lv.fingers ? bareFootMesh(s, Lv) : footMesh(s, Lv, FIG_SLOT.skin, 0, undefined, [0, 0]));
  }
  // a second pair of arms: the bare arm and hand again, as modelled, moved onto the grown arm bones
  // (FIGURE_XBONES arm2*), which carry them down the ribs and copy the real arms' motion
  if (BD.arms4) for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R', map = { [B['uarm' + L]]: B['arm2U' + L], [B['farm' + L]]: B['arm2F' + L], [B['hand' + L]]: B['arm2H' + L], [B.chest]: B['arm2U' + L], [B.neck]: B['arm2U' + L], [B.clavL]: B['arm2U' + L], [B.clavR]: B['arm2U' + L] };
    const arm = bodyPart(PT['arm' + L], Lv, (x, y) => armW(L)(y), armCapPoint(s, PT['arm' + L]), null), hand = handMesh(s, Lv, (sculpt ? 1.1 * Math.sqrt(BK.arm) * (SW ? SW.hand : 1) : HAND_K) * 0.96, sculpt);
    for (const X of [arm, hand]) parts.push({ ...X, name: X.name + '4', slot: FIG_SLOT.skin, Wt: X.Wt.map((w) => w.map(([b, k]) => [map[b] ?? B['arm2U' + L], k])) });
  }
  for (const p of parts) if (p.name !== 'cards') orient(p);
  // `faceHd` (the Figure Lab's face: hd) puts a sculpted close-up head on actor-head.js's HEAD_HD, about
  // three times as fine through the face
  const headLv = faceHd && sculpt && Lv.name === 'hd' ? 'hd' : Lv.head;
  if (Lv.head >= 0) {
    parts.push(...headParts(style, headLv, sculpt, FS, NKb));
    if (sculpt) { const l0 = hairLocks(Lv, style, FS, spikes, fan), l = FIGURE_HATS[hat]?.under || FIGURE_HATS[hat]?.fit ? compact(underCap(l0, FIGURE_HATS[hat].cut)) : l0; if (l.I.length) { orient(l); parts.push(l); } }
    if (sculpt && beard) { const l = beardLocks(Lv, beard, FS); orient(l); parts.push(l); }
    if (sculpt && Lv.name === 'hd') for (const l of eyeParts(FS)) { orient(l); parts.push(l); }
    if (BD.horns) { const h = hornMesh(Lv); orient(h); parts.push(h); }
    if (BD.goggles) parts.push(gogglesMesh(Lv));
    if (sculpt && specs) { const m = specsMesh(Lv, FS); orient(m); parts.push(m); }
    for (const [on, make] of [[BD.eye3, () => eye3Mesh(Lv, FS)], [BD.compound, () => compoundMesh(Lv, FS)], [BD.ears, () => earMesh(Lv)]]) if (on) { const m = make(); orient(m); parts.push(m); }
    // a second head: the head again, as modelled, carried to the right shoulder by its own bone
    if (BD.head2) {
      const again = (p) => ({ ...p, name: p.name + '2', Wt: p.Wt.map(() => [[B.head2, 1]]) });
      parts.push(...headParts(style, headLv, sculpt, FS, NKb).map(again));
      if (sculpt && Lv.name === 'hd') for (const l of eyeParts(FS)) { orient(l); parts.push(again(l)); }
    }
  }
  let cards = null;
  if (Lv.cards && !sculpt) { const c = hairCards(style, Lv); if (c.I.length) { parts.push(c); cards = c; } }
  const out = pack(parts, cards);
  // the close-up levels light their forms off smoothed normals (formNormals); the crowd's bake doesn't
  // (the face, its ears and neck keep theirs from a quarter of the way, so the face holds its planes)
  if (Lv.skin) out.NF = formNormals(out, Lv.name === 'hd' ? 40 : 16, { at: Lv.name === 'hd' ? 10 : 5, mask: (v) => out.S[v] === FIG_SLOT.face || out.S[v] === FIG_SLOT.ear || out.S[v] === FIG_SLOT.neck });
  // a hand's wrist lights as the forearm's: the hand is a part of its own with a cap at its top, so its first rings'
  // form normals pointed up the arm, and the comic light drew a hard edge of shadow round every wrist. Each takes
  // the normal of the forearm's last ring nearest it, easing to the hand's own by the middle of the palm
  if (sculpt && out.NF) for (const L of ['L', 'R']) {
    const h = out.parts.find((p) => p.name === 'hand' + L), a = out.parts.find((p) => p.name === 'arm' + L);
    if (!h || !a) continue;
    let ylo = Infinity;
    for (let v = a.v0; v < a.v0 + a.nv; v++) if (out.NF[v * 3 + 1] > -0.6) ylo = Math.min(ylo, out.P[v * 3 + 1]);
    const ring = [];
    for (let v = a.v0; v < a.v0 + a.nv; v++) if (out.NF[v * 3 + 1] > -0.6 && out.P[v * 3 + 1] < ylo + 0.004) ring.push(v);
    if (!ring.length) continue;
    for (let v = h.v0; v < h.v0 + h.nv; v++) {
      const y = out.P[v * 3 + 1], w = out.A[v] < -0.5 ? 0 : smooth(0.822, 0.864, y);
      if (w <= 0) continue;
      let best = ring[0], bd = Infinity;
      for (const u of ring) { const d = (out.P[u * 3] - out.P[v * 3]) ** 2 + (out.P[u * 3 + 2] - out.P[v * 3 + 2]) ** 2; if (d < bd) { bd = d; best = u; } }
      out.NF.set(norm3([0, 1, 2].map((j) => out.NF[v * 3 + j] * (1 - w) + out.NF[best * 3 + j] * w)), v * 3);
    }
  }
  // the face lights on its designed planes (form-normals.js faceDesigned), not its smoothed form
  const hp = out.parts.find((p) => p.name === 'head');
  // on the fine head the field diffuses for longer, so its planes come out about as broad
  if (out.NF && hp) out.NF.set(headLv === 'hd' ? faceDesigned(headMesh('hd', FS, true), 40, 10, 0.7) : faceDesigned(headMesh(Lv.head, FS, true)), hp.v0 * 3);
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
  // the socket's lining lights as the face's front does, whichever way it winds
  { const e = out.parts.find((p) => p.name === 'socket'); if (out.NF && e) for (let v = e.v0; v < e.v0 + e.nv; v++) out.NF.set(norm3([0, 0.35, 1]), v * 3); }
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
export const figureCut = (rand) => rollOf(FIGURE_CIVIL_CUTS.map((c) => [c, CUT_WEIGHT[c] ?? 1]), rand(17));
// The gear they wear close up, off the same rand: slots 18 to 22, past the cut's. Most wear a belt;
// a strap, a pouch, knee pads and gloves each on some.
export const figureGear = (rand) => ({ belt: rand(18) < 0.8, strap: rand(19) < 0.35, pouch: rand(20) < 0.45, pads: rand(21) < 0.4, gloves: rand(22) < 0.5 });
export { B as FIGURE_BONE, HAIR_STYLES };
