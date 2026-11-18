// What the MORPHEX sells: one list for the server (plugins/cosmetic-machine checks every value against it), the
// pod's menu (panels/room-morphex.js) and the figure (client/shared/player-figure.js). Pure data.

// Hair styles, as the `hair_style` column stores them. `cut` is the sculpted figure's style index (figure.js:
// 0 to 5 are the street's six, 6 and up are HAIR_CUTS there); `crop` is a style that ignores hair length.
export const HAIR_STYLES = {
  'buzz cut': { cut: 0, crop: true }, shaved: { cut: 0, crop: true }, fade: { cut: 0, crop: true },
  'slicked-back': { cut: 22, crop: true }, 'side part': { cut: 23, crop: true }, messy: { cut: 2 }, curly: { cut: 2 }, wavy: { cut: 2 }, spiky: { cut: 2, spikes: 1 },
  quiff: { cut: 4 }, skullet: { cut: 5, crop: true },
  bob: { cut: 6, crop: true }, ponytail: { cut: 7, crop: true }, bun: { cut: 8, crop: true }, mohawk: { cut: 9, crop: true },
  afro: { cut: 10, crop: true }, dreadlocks: { cut: 11, crop: true }, cornrows: { cut: 12, crop: true }, undercut: { cut: 13, crop: true },
  pompadour: { cut: 14, crop: true }, pixie: { cut: 15, crop: true }, braided: { cut: 16, crop: true }, 'top knot': { cut: 17, crop: true },
  mullet: { cut: 18, crop: true }, 'long and straight': { cut: 3, crop: true }, 'wolf cut': { cut: 19, crop: true }, 'buns': { cut: 20, crop: true },
  curtains: { cut: 21, crop: true }, 'comb-over': { cut: 24, crop: true }, 'liberty spikes': { cut: 25, crop: true }, shag: { cut: 26, crop: true },
  pigtails: { cut: 27, crop: true }, beehive: { cut: 28, crop: true }, 'man bun': { cut: 29, crop: true }, 'half up': { cut: 30, crop: true },
  'long waves': { cut: 31, crop: true }, 'flat top': { cut: 32, crop: true },
};
export const HAIR_STYLE_NAMES = Object.keys(HAIR_STYLES);

// The face, kept in appearance_data.face. Each is a short list so it stays a menu, not a slider wall.
export const FACE = {
  // the sculpted heads (actor-head.js SCULPT_HEADS, by FACE_SHAPE_HEAD below): men's, then women's
  shape: { label: 'Face shape', values: ['standard', 'broad', 'lean', 'strong jaw', 'gaunt', 'boxer', 'boyish', 'craggy', 'soft', 'heart', 'oval', 'round', 'angular', 'elfin', 'square'] },
  // the eyes' shape, under the face shape: 'natural' is the one that face comes with (FACE_SHAPE_EYES)
  eyeshape: { label: 'Eye shape', values: ['natural', 'almond', 'round', 'hooded', 'narrow', 'upturned', 'downturned', 'wide'] },
  skin: { label: 'Skin tone', values: ['porcelain', 'fair', 'light', 'olive', 'tan', 'brown', 'deep brown', 'ebony', 'chrome grey', 'synth blue'] },
  brows: { label: 'Brows', values: ['thin', 'natural', 'heavy', 'severe'] },
  facial: { label: 'Facial hair', values: ['clean', 'stubble', 'shadow', 'moustache', 'goatee', 'vandyke', 'soulpatch', 'chinstrap', 'sideburns', 'trimmed', 'full', 'long', 'handlebar', 'mutton', 'friendly_mutton', 'horseshoe', 'anchor', 'chin_curtain', 'walrus', 'fumanchu', 'bushy', 'forked', 'braided'] },
  age: { label: 'Age lines', values: ['none', 'some', 'lived-in', 'old'] },
  wear: { label: 'Skin', values: ['clean', 'weathered', 'rough'] },
};
export const FACE_SHAPE_HEAD = { standard: 0, broad: 1, lean: 2, soft: 3, 'strong jaw': 4, heart: 5, oval: 6, round: 7, angular: 8, elfin: 9, square: 10, gaunt: 11, boxer: 12, boyish: 13, craggy: 14 };
// The face's fine sliders, kept in appearance_data.face as whole numbers from -5 to 5 (0, or missing, is the shape's
// own). Each pushes a head's numbers one way (actor-head.js tunedFace); `lo` and `hi` say which way.
export const FACE_TUNE = {
  jaw: { label: 'Jaw width', lo: 'narrow', hi: 'wide' },
  chin: { label: 'Chin', lo: 'small', hi: 'strong' },
  cheeks: { label: 'Cheekbones', lo: 'flat', hi: 'high' },
  hollows: { label: 'Cheek hollows', lo: 'full', hi: 'sunken' },
  nose: { label: 'Nose size', lo: 'small', hi: 'large' },
  bridge: { label: 'Nose bridge', lo: 'flat', hi: 'high' },
  lips: { label: 'Lips', lo: 'thin', hi: 'full' },
  browridge: { label: 'Brow ridge', lo: 'smooth', hi: 'heavy' },
  eyes: { label: 'Eye depth', lo: 'shallow', hi: 'deep-set' },
  eyesize: { label: 'Eye size', lo: 'small', hi: 'large' },
  eyeopen: { label: 'Eye opening', lo: 'narrow', hi: 'open' },
  eyetilt: { label: 'Eye tilt', lo: 'down', hi: 'up' },
  eyeset: { label: 'Eye spacing', lo: 'close', hi: 'wide' },
};
// An eye shape is a set of the eye sliders' settings, added under the player's own (actor-head.js tunedFace reads them).
export const EYE_SHAPES = {
  natural: {},
  almond: { eyeopen: -1, eyetilt: 2, eyesize: 1 },
  round: { eyeopen: 4, eyesize: 1 },
  hooded: { eyeopen: -3, eyetilt: -1, eyes: 1 },
  narrow: { eyeopen: -4, eyesize: 1 },
  upturned: { eyetilt: 4, eyeopen: -1 },
  downturned: { eyetilt: -4 },
  wide: { eyesize: 3, eyeopen: 2 },
};
// the eyes each face shape comes with while the eye shape is left 'natural'
export const FACE_SHAPE_EYES = {
  standard: 'natural', broad: 'natural', lean: 'narrow', 'strong jaw': 'natural', gaunt: 'hooded', boxer: 'narrow', boyish: 'wide', craggy: 'hooded',
  soft: 'almond', heart: 'almond', oval: 'almond', round: 'round', angular: 'upturned', elfin: 'wide', square: 'natural',
};
export const TUNE_MIN = -5, TUNE_MAX = 5;
// the figure's compact form of a face's slider settings: 'jaw:2,nose:-3', or '' when they're all at 0
// (the eye shape's settings added in, kept within the sliders' range)
export function faceTune(face = {}) {
  const pick = EYE_SHAPES[face.eyeshape] && face.eyeshape !== 'natural' ? face.eyeshape : FACE_SHAPE_EYES[face.shape];
  const E = EYE_SHAPES[pick] || {};
  return Object.keys(FACE_TUNE).map((k) => {
    const own = Math.round(Number(face[k]) || 0), ok = own >= TUNE_MIN && own <= TUNE_MAX ? own : 0;
    return [k, Math.max(TUNE_MIN, Math.min(TUNE_MAX, ok + (E[k] || 0)))];
  }).filter(([, v]) => v).map(([k, v]) => k + ':' + v).join(',');
}
export const SKIN_RGB = {
  porcelain: [242, 214, 200], fair: [232, 192, 168], light: [214, 168, 136], olive: [188, 146, 104], tan: [176, 124, 88],
  brown: [140, 92, 62], 'deep brown': [98, 62, 42], ebony: [62, 40, 30], 'chrome grey': [168, 172, 178], 'synth blue': [96, 140, 196],
};

// Tattoos, kept in appearance_data.tattoos as { place: design }, and one ink for all of them. A place's
// designs are what the shader can draw there (gl/figure-hd.js tatPaint); `bit` is its bit in the figure's mask.
export const TATTOO_PLACES = {
  cheek: { label: 'Cheek', designs: ['teardrop', 'tribal', 'barcode'] },
  brow: { label: 'Forehead', designs: ['cross', 'third eye', 'barcode'] },
  neck: { label: 'Neck', designs: ['barcode', 'band', 'web'] },
  leftarm: { label: 'Left arm', designs: ['tribal', 'bands', 'circuit'] },
  rightarm: { label: 'Right arm', designs: ['tribal', 'bands', 'circuit'] },
  hands: { label: 'Knuckles', designs: ['dots', 'bars'] },
  chest: { label: 'Chest', designs: ['eagle', 'circuit', 'script'] },
};
export const TATTOO_INKS = { black: [12, 12, 16], 'faded blue': [36, 52, 84], red: [150, 24, 30], 'neon uv': [180, 60, 255], 'neon green': [60, 255, 140] };
// The shader's design numbers: a place's design index plus one, three bits a place
export const TATTOO_ORDER = ['cheek', 'brow', 'neck', 'leftarm', 'rightarm', 'hands', 'chest'];
export function tattooCode(tats = {}) {
  let code = 0;
  TATTOO_ORDER.forEach((place, i) => {
    const d = TATTOO_PLACES[place].designs.indexOf(tats[place]);
    if (d >= 0) code |= (d + 1) << (i * 3);
  });
  return code;
}
