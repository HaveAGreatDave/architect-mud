// CAT BREEDS: a breed is a set of the cat kit's numbers (gl/cat-kit.js CAT) that a cat of it starts from, and a cat is
// its breed's numbers with its own over them (catLook({ breed, ...its own })). The kit's own numbers are an ordinary
// domestic shorthair, the moggy every other breed is measured against. A breed says only what's typical of it: its
// build, its head, its ears and eyes, its coat's length and texture, the patterns it comes in, and a lean to its nature
// (the Feline Five, docs/proposals/pets.md), which a cat's own personality is laid over.
//
// Generic: real breeds, nothing of any one game. A new breed is a row here, tried in the Cattery first.
//
// Sources: the breed standards (CFA's for the American Shorthair) and the breed descriptions in
// docs/reference/bibliography.md.

// Coat patterns: how far white spotting spreads (`coat.white`, see CAT), the names cat people give them.
export const PATTERNS = {
  solid: { white: 0 },
  locket: { white: 0.12 },
  mitted: { white: 0.2 },
  tuxedo: { white: 0.42 },      // black with a white bib, belly and paws: the classic tuxedo
  bicolour: { white: 0.65 },
  harlequin: { white: 0.8 },
  van: { white: 0.9 },
};

export const BREEDS = {
  // the kit's own numbers: no breed in particular
  domestic: { name: 'Domestic shorthair', build: {}, eyes: {}, fur: {}, coat: {}, nature: {} },

  // AMERICAN SHORTHAIR. The working cat that came over on the ships: medium to large, solid and muscular, a full chest
  // and heavy legs, a tail of medium length thick at the root. The head large, a little longer than it's wide, with
  // full cheeks (heavy jowls on a male), a square muzzle and fleshy whisker pads; the ears medium-sized, set wide
  // apart and rounded at the tips; the eyes large and round, with a half-almond upper lid. The coat short, thick and
  // hard to the touch. Easygoing and friendly, not much bothered by anything. (CFA breed standard)
  american_shorthair: {
    name: 'American Shorthair',
    scale: 0.66,
    build: { length: 0.95, chest: 1.1, hips: 1.08, legW: 1.12, head: 1.08, cheeks: 1.14, jowls: 1.15, muzzle: 1.02, ears: 0.78, earRound: 0.55, tailW: 1.1, tailLen: 0.95 },
    eyes: { size: 1.06, open: 1.16, droop: 0.06 },
    fur: { body: 0.007, ruff: 0.01, belly: 0.009, tail: 0.008, legs: 0.004, face: 0.002 },
    coat: {},
    patterns: ['tuxedo', 'solid', 'mitted', 'bicolour', 'van'],
    nature: { outgoing: 0.6, friendly: 0.7, skittish: 0.25, dominant: 0.5, impulsive: 0.4 },
  },
};
