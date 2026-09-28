// The stroke alphabet: every letter as the path a pen would take through it, not as an outline.
// The throw-up bake strokes these at a fat width to get a letterform, and HOW it strokes them is
// the style: round joins and smoothed corners give a soft bubble, square caps and mitred corners
// give a block letter, mitred corners with a chisel cut on every free end give a sharp one. One
// table, three hands, and a keyline is the same path stroked wider.
//
// Units: y runs 0 (top of the stroke centre line) to 1 (bottom); x from 0 to `w`. The ink extends
// half a stroke beyond both. `s` is a list of polylines, closed when the first point is repeated at
// the end. `dot` is a list of single points, drawn as a round or square dot a stroke wide.
//
// A letter may carry an entry of the same shape under a face's name (`sharp`, `round`), used by
// that face instead.
//
// TAG_FACES is the list of throw-up letterforms, shared by the renderer and the graffiti plugin,
// which stores a player's choice and checks it against this list. `bubble` is the traced sheet
// (tag-glyphs.js); the other three are this table stroked three ways (see TAG_FACE_SPEC in
// windshield.js). A new face goes here and there, and nowhere else.
//
// Covers A-Z, 0-9 and the punctuation a tag uses. The traced sheet (tag-glyphs.js) wins for the
// letters it has in the bubble style; anything in neither table falls back to TAG_FONT.
export const TAG_FACES = ['bubble', 'round', 'block', 'sharp'];

export const TAG_STROKES = {
  // An arch with legs in the upright faces, because a pointed apex at this weight closes the
  // counter and reads as a lambda. The sharp face keeps the point: its stroke is thinner.
  A: { w: 0.64, s: [[[0, 1], [0, 0.34], [0.2, 0], [0.44, 0], [0.64, 0.34], [0.64, 1]], [[0, 0.62], [0.64, 0.62]]],
    sharp: { w: 0.64, s: [[[0, 1], [0.32, 0], [0.64, 1]], [[0.14, 0.64], [0.5, 0.64]]] } },
  B: { w: 0.6, s: [[[0, 1], [0, 0], [0.4, 0], [0.54, 0.12], [0.54, 0.34], [0.4, 0.47], [0, 0.47]],
    [[0.4, 0.47], [0.6, 0.6], [0.6, 0.86], [0.46, 1], [0, 1]]] },
  C: { w: 0.6, s: [[[0.6, 0.14], [0.46, 0], [0.16, 0], [0, 0.16], [0, 0.84], [0.16, 1], [0.46, 1], [0.6, 0.86]]] },
  D: { w: 0.6, s: [[[0, 0], [0.36, 0], [0.6, 0.22], [0.6, 0.78], [0.36, 1], [0, 1], [0, 0]]] },
  E: { w: 0.56, s: [[[0.56, 0], [0, 0], [0, 1], [0.56, 1]], [[0, 0.5], [0.44, 0.5]]] },
  F: { w: 0.56, s: [[[0.56, 0], [0, 0], [0, 1]], [[0, 0.5], [0.42, 0.5]]] },
  // The top end stops short of turning down, and the bar sits at mid-height and stays short. Lower,
  // it runs into the bottom stroke and the letter reads as a C; longer, it closes a bowl and reads 6.
  // The round face smooths the corner into the bar and curls it, so it takes the bar as a separate
  // stroke across the end of the bowl.
  G: { w: 0.66, s: [[[0.64, 0.04], [0.46, 0], [0.16, 0], [0, 0.16], [0, 0.84], [0.16, 1], [0.5, 1], [0.66, 0.86], [0.66, 0.52], [0.44, 0.52]]],
    round: { w: 0.7, s: [[[0.66, 0.08], [0.5, 0], [0.18, 0], [0, 0.18], [0, 0.82], [0.18, 1], [0.52, 1], [0.7, 0.82], [0.7, 0.56]],
      [[0.5, 0.56], [0.76, 0.56]]] } },
  H: { w: 0.6, s: [[[0, 0], [0, 1]], [[0.6, 0], [0.6, 1]], [[0, 0.5], [0.6, 0.5]]] },
  I: { w: 0.36, s: [[[0, 0], [0.36, 0]], [[0.18, 0], [0.18, 1]], [[0, 1], [0.36, 1]]] },
  J: { w: 0.56, s: [[[0.2, 0], [0.56, 0], [0.56, 0.8], [0.38, 1], [0.14, 1], [0, 0.84]]] },
  K: { w: 0.6, s: [[[0, 0], [0, 1]], [[0.58, 0], [0.04, 0.56]], [[0.24, 0.38], [0.6, 1]]] },
  L: { w: 0.54, s: [[[0, 0], [0, 1], [0.54, 1]]] },
  M: { w: 0.74, s: [[[0, 1], [0, 0], [0.37, 0.58], [0.74, 0], [0.74, 1]]] },
  N: { w: 0.6, s: [[[0, 1], [0, 0], [0.6, 1], [0.6, 0]]] },
  O: { w: 0.62, s: [[[0.16, 0], [0.46, 0], [0.62, 0.16], [0.62, 0.84], [0.46, 1], [0.16, 1], [0, 0.84], [0, 0.16], [0.16, 0]]] },
  P: { w: 0.58, s: [[[0, 1], [0, 0], [0.42, 0], [0.58, 0.14], [0.58, 0.4], [0.42, 0.54], [0, 0.54]]] },
  Q: { w: 0.66, s: [[[0.16, 0], [0.46, 0], [0.62, 0.16], [0.62, 0.84], [0.46, 1], [0.16, 1], [0, 0.84], [0, 0.16], [0.16, 0]],
    [[0.38, 0.7], [0.66, 1.04]]] },
  R: { w: 0.62, s: [[[0, 1], [0, 0], [0.42, 0], [0.58, 0.14], [0.58, 0.38], [0.42, 0.52], [0, 0.52]], [[0.28, 0.52], [0.62, 1]]] },
  S: { w: 0.6, s: [[[0.6, 0.12], [0.46, 0], [0.14, 0], [0, 0.14], [0, 0.34], [0.14, 0.47], [0.46, 0.53], [0.6, 0.66],
    [0.6, 0.86], [0.46, 1], [0.14, 1], [0, 0.88]]] },
  T: { w: 0.64, s: [[[0, 0], [0.64, 0]], [[0.32, 0], [0.32, 1]]] },
  U: { w: 0.6, s: [[[0, 0], [0, 0.84], [0.16, 1], [0.44, 1], [0.6, 0.84], [0.6, 0]]] },
  V: { w: 0.62, s: [[[0, 0], [0.31, 1], [0.62, 0]]] },
  // The middle peak runs nearly to the top, or the two inner counters close and it reads as a V.
  W: { w: 0.86, s: [[[0, 0], [0.2, 1], [0.43, 0.18], [0.66, 1], [0.86, 0]]] },
  X: { w: 0.6, s: [[[0, 0], [0.6, 1]], [[0.6, 0], [0, 1]]] },
  Y: { w: 0.62, s: [[[0, 0], [0.31, 0.5], [0.62, 0]], [[0.31, 0.5], [0.31, 1]]] },
  Z: { w: 0.58, s: [[[0, 0], [0.58, 0], [0, 1], [0.58, 1]]] },

  0: { w: 0.56, s: [[[0.14, 0], [0.42, 0], [0.56, 0.16], [0.56, 0.84], [0.42, 1], [0.14, 1], [0, 0.84], [0, 0.16], [0.14, 0]]] },
  1: { w: 0.32, s: [[[0, 0.2], [0.24, 0], [0.24, 1]]] },
  2: { w: 0.58, s: [[[0, 0.16], [0.16, 0], [0.42, 0], [0.58, 0.16], [0.58, 0.36], [0, 1], [0.58, 1]]] },
  3: { w: 0.58, s: [[[0, 0.1], [0.14, 0], [0.44, 0], [0.58, 0.14], [0.58, 0.34], [0.44, 0.48], [0.2, 0.48]],
    [[0.44, 0.48], [0.58, 0.62], [0.58, 0.86], [0.44, 1], [0.14, 1], [0, 0.9]]] },
  // An open 4: the closed one's hairpin at the top of the stem is a loop once it is smoothed.
  4: { w: 0.6, s: [[[0.04, 0], [0, 0.64], [0.6, 0.64]], [[0.44, 0.3], [0.44, 1]]] },
  5: { w: 0.58, s: [[[0.56, 0], [0.04, 0], [0, 0.46], [0.42, 0.44], [0.58, 0.58], [0.58, 0.86], [0.44, 1], [0.12, 1], [0, 0.9]]] },
  6: { w: 0.58, s: [[[0.52, 0.04], [0.4, 0], [0.16, 0], [0, 0.2], [0, 0.84], [0.16, 1], [0.42, 1], [0.58, 0.84], [0.58, 0.64],
    [0.42, 0.48], [0.16, 0.48], [0, 0.6]]] },
  7: { w: 0.58, s: [[[0, 0], [0.58, 0], [0.2, 1]]] },
  // A figure of eight, crossing at the waist, with the top loop the smaller: two equal loops is a B.
  8: { w: 0.6, s: [[[0.3, 0.46], [0.1, 0.34], [0.07, 0.13], [0.2, 0], [0.4, 0], [0.53, 0.13], [0.5, 0.34], [0.3, 0.46],
    [0.06, 0.6], [0, 0.84], [0.14, 1], [0.46, 1], [0.6, 0.84], [0.54, 0.6], [0.3, 0.46]]] },
  9: { w: 0.58, s: [[[0.58, 0.4], [0.42, 0.52], [0.16, 0.52], [0, 0.36], [0, 0.16], [0.16, 0], [0.42, 0], [0.58, 0.16],
    [0.58, 0.8], [0.42, 1], [0.16, 1], [0.04, 0.94]]] },

  // The dots sit low, clear of the stroke above them at the fattest weight.
  '!': { w: 0, s: [[[0, 0], [0, 0.5]]], dot: [[0, 1.06]] },
  '?': { w: 0.56, s: [[[0, 0.16], [0.16, 0], [0.42, 0], [0.56, 0.14], [0.56, 0.28], [0.28, 0.42], [0.28, 0.5]]], dot: [[0.28, 1.06]] },
  '.': { w: 0, s: [], dot: [[0, 1]] },
  ',': { w: 0.1, s: [[[0.1, 0.92], [0, 1.1]]] },
  "'": { w: 0, s: [[[0, 0], [0, 0.26]]] },
  '-': { w: 0.36, s: [[[0, 0.52], [0.36, 0.52]]] },
  '+': { w: 0.5, s: [[[0, 0.52], [0.5, 0.52]], [[0.25, 0.27], [0.25, 0.77]]] },
  '/': { w: 0.44, s: [[[0.44, 0], [0, 1]]] },
};
