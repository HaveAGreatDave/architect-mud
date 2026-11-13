import { HAIR_STYLES, SKIN_RGB, TATTOO_INKS, tattooCode } from './morphex-catalog.js';

// A player's close-up figure from their appearance: the MORPHEX columns (hair colour, length and style, eye
// colour, height and weight) turned into the `figure` keys gl/room-people.js reads off an NPC's `flags.figure`.
// One function, so the Room Stage draws what the server holds and the MORPHEX pod can show a draft on the
// body before anything's bought. Pure; no DOM.

const HAIR_RGB = {
  black: [24, 20, 18], 'dark brown': [48, 32, 22], brown: [86, 58, 36], auburn: [120, 52, 30], 'dirty blonde': [150, 122, 78],
  blonde: [206, 176, 112], red: [150, 50, 24], grey: [140, 138, 134], white: [222, 220, 214], silver: [190, 194, 200],
  'dyed blue': [40, 80, 200], 'dyed green': [40, 160, 80], 'dyed purple': [110, 50, 170], 'dyed red': [200, 30, 40],
};
const EYE_RGB = {
  brown: [96, 60, 36], 'dark brown': [56, 36, 24], blue: [60, 110, 180], 'light blue': [120, 170, 220], green: [70, 130, 70],
  hazel: [120, 100, 50], grey: [130, 140, 146], amber: [190, 130, 40],
};
// the cut: the catalog's figure style; a style that isn't a fixed cut follows the length (long hair hangs)
export function hairStyleIdx(style, length) {
  const h = HAIR_STYLES[style];
  if (h?.crop) return h.cut;
  if (length === 'shaved') return 0;
  if (length === 'very_long' || length === 'long') return h?.cut === 4 ? 5 : 3;
  return h ? h.cut : length === 'short' ? 0 : 1;
}
const SHAPE_HEAD = { standard: 0, broad: 1, lean: 2, soft: 3, 'strong jaw': 4 };
const BROW = { thin: 0.45, natural: 0.8, heavy: 1.15, severe: 1.4 };
const AGE = { none: 0, some: 0.35, 'lived-in': 0.6, old: 0.9 };
const GRIT = { clean: 0, weathered: 0.45, rough: 0.85 };

// `a` is anything with the columns: a live player, or a draft { hair_color, hair_length, ... }.
export function playerFigure(a) {
  if (!a) return null;
  const cm = Number(a.height_cm) || 170, kg = Number(a.weight_kg) || 70, bmi = kg / Math.pow(cm / 100, 2);
  const out = {
    hair_style: hairStyleIdx(a.hair_style, a.hair_length),
    // ectomorph to endomorph in tenths, so people share meshes (room-people.js)
    weight: Math.round(Math.max(0, Math.min(1, (bmi - 17) / 13)) * 10) / 10,
    // no rolled hat: a player paid for that haircut
    hat: '',
  };
  if (HAIR_RGB[a.hair_color]) out.hair = HAIR_RGB[a.hair_color];
  if (EYE_RGB[a.eye_color]) out.iris = EYE_RGB[a.eye_color];
  if (HAIR_STYLES[a.hair_style]?.spikes) out.spikes = HAIR_STYLES[a.hair_style].spikes;
  // the face (appearance_data.face): only what's been chosen, so an unset one keeps the figure's own roll
  const f = a.face || {};
  if (f.shape in SHAPE_HEAD) out.head = SHAPE_HEAD[f.shape];
  if (SKIN_RGB[f.skin]) out.skin = SKIN_RGB[f.skin];
  if (f.brows in BROW) out.brow = BROW[f.brows];
  if (f.facial) out.facial = f.facial;
  if (f.age in AGE) out.age = AGE[f.age];
  if (f.wear in GRIT) out.grit = GRIT[f.wear];
  // tattoos (appearance_data.tattoos and .ink): one mask and one ink (gl/figure-hd.js tatPaint)
  const tat = tattooCode(a.tattoos || {});
  if (tat) { out.tat = tat; out.tat_ink = TATTOO_INKS[a.ink] || TATTOO_INKS.black; }
  return out;
}

// The columns a figure is drawn from, and nothing else: what the Room Stage sends about a player.
export function lookOfPlayer(pl) {
  return { hair_color: pl.hair_color || 'brown', hair_length: pl.hair_length || 'short', hair_style: pl.hair_style || 'messy',
    eye_color: pl.eye_color || 'brown', height_cm: Number(pl.height_cm) || 170, weight_kg: Number(pl.weight_kg) || 70,
    face: { ...(pl.appearance_data?.face || {}) }, tattoos: { ...(pl.appearance_data?.tattoos || {}) }, ink: pl.appearance_data?.ink || 'black' };
}
