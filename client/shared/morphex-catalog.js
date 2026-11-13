// What the MORPHEX sells: one list for the server (plugins/cosmetic-machine checks every value against it), the
// pod's menu (panels/room-morphex.js) and the figure (client/shared/player-figure.js). Pure data.

// Hair styles, as the `hair_style` column stores them. `cut` is the sculpted figure's style index (figure.js:
// 0 to 5 are the street's six, 6 and up are HAIR_CUTS there); `crop` is a style that ignores hair length.
export const HAIR_STYLES = {
  'buzz cut': { cut: 0, crop: true }, shaved: { cut: 0, crop: true }, fade: { cut: 0, crop: true },
  'slicked-back': { cut: 1 }, 'side part': { cut: 1 }, messy: { cut: 2 }, curly: { cut: 2 }, wavy: { cut: 2 }, spiky: { cut: 2, spikes: 1 },
  quiff: { cut: 4 }, skullet: { cut: 5, crop: true },
  bob: { cut: 6, crop: true }, ponytail: { cut: 7, crop: true }, bun: { cut: 8, crop: true }, mohawk: { cut: 9, crop: true },
  afro: { cut: 10, crop: true }, dreadlocks: { cut: 11, crop: true }, cornrows: { cut: 12, crop: true }, undercut: { cut: 13, crop: true },
  pompadour: { cut: 14, crop: true }, pixie: { cut: 15, crop: true }, braided: { cut: 16, crop: true }, 'top knot': { cut: 17, crop: true },
  mullet: { cut: 18, crop: true }, 'long and straight': { cut: 3, crop: true }, 'wolf cut': { cut: 19, crop: true }, 'buns': { cut: 20, crop: true },
};
export const HAIR_STYLE_NAMES = Object.keys(HAIR_STYLES);

// The face, kept in appearance_data.face. Each is a short list so it stays a menu, not a slider wall.
export const FACE = {
  shape: { label: 'Face shape', values: ['standard', 'broad', 'lean', 'soft', 'strong jaw'] },
  skin: { label: 'Skin tone', values: ['porcelain', 'fair', 'light', 'olive', 'tan', 'brown', 'deep brown', 'ebony', 'chrome grey', 'synth blue'] },
  brows: { label: 'Brows', values: ['thin', 'natural', 'heavy', 'severe'] },
  facial: { label: 'Facial hair', values: ['clean', 'stubble', 'shadow', 'moustache', 'goatee', 'vandyke', 'soulpatch', 'chinstrap', 'sideburns', 'trimmed', 'full', 'long', 'handlebar'] },
  age: { label: 'Age lines', values: ['none', 'some', 'lived-in', 'old'] },
  wear: { label: 'Skin', values: ['clean', 'weathered', 'rough'] },
};
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
