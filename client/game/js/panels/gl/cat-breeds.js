// CAT BREEDS: a breed is a set of the cat kit's numbers (gl/cat-kit.js CAT) that a cat of it starts from, and a cat is
// its breed's numbers with its own over them (catLook({ breed, ...its own })). The kit's own numbers are an ordinary
// domestic shorthair, the moggy every other breed is measured against. A breed says only what's typical of it: its
// build, its head, its ears and eyes, its coat's length and texture, the patterns it comes in, and a lean to its nature
// (the Feline Five, docs/proposals/pets.md), which a cat's own personality is laid over.
//
// Generic: real breeds, nothing of any one game. A new breed is a row here, tried in the Cattery first.
//
// Sources: the CFA breed standards (American Shorthair, Siamese, Maine Coon, Persian, British Shorthair, Abyssinian)
// and the breed descriptions in docs/reference/bibliography.md.

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

// Coat colours that are more than one colour (`coat.colour`): the tortoiseshells and the colourpoints. A tortie carries
// both the black and the orange gene, one on each X, so nearly every one is a she; where white spotting is laid over
// a tortie, the patches come out bigger and cleaner (a calico). A colourpoint's colour is named for its points.
export const COLOURS = {
  tortie: { base: '#1d1917', tortie: { col: '#a8571f', amount: 0.42, scale: 1, brindle: 0.7 }, nose: '#3a2a28', pads: '#2e2422' },
  // the dilute: blue and cream
  blue_cream: { base: '#6e7078', tortie: { col: '#d8b48a', amount: 0.42, scale: 1, brindle: 0.7 }, nose: '#8a7f86', pads: '#8a7f86' },
  calico: { base: '#1d1917', white: 0.6, tortie: { col: '#b0601f', amount: 0.5, scale: 0.75, brindle: 0.15 }, nose: '#d4949a' },
  dilute_calico: { base: '#6e7078', white: 0.6, tortie: { col: '#dcb88c', amount: 0.5, scale: 0.75, brindle: 0.15 }, nose: '#d4a4a8' },
  seal_point: { base: '#e2d4bc', points: { col: '#342520', shade: 0.42, mask: 1 }, nose: '#2e2220', pads: '#2e2220', earInner: '#5a4038' },
  chocolate_point: { base: '#efe4d0', points: { col: '#6a4a34', shade: 0.15, mask: 1 }, nose: '#7a5a4a', pads: '#8a6656', earInner: '#9a7466' },
  blue_point: { base: '#e6e4e2', points: { col: '#646a78', shade: 0.2, mask: 1 }, nose: '#5a5e6a', pads: '#5a5e6a', earInner: '#8a8a94' },
  lilac_point: { base: '#efebe8', points: { col: '#a49aa0', shade: 0.1, mask: 1 }, nose: '#b0949a', pads: '#c09ca4', earInner: '#c4aab0' },
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

  // SIAMESE. The traditional cat, the one people keep (the show ring's modern Siamese is the same thing pushed to a
  // whippet: a long wedge of a head and ears half as tall again). Medium, long and lithe, fine-boned, the belly tight,
  // long slim legs on small oval paws and a long tail tapering to a point. The head a rounded wedge, longer than it's
  // wide, with moderate cheeks; the ears large, wide at the base and pointed, about as tall as from the eye to the
  // chin, set at the corners of the head so their outer edges carry on the line of the cheeks; the eyes almond,
  // slanted toward the nose, a clear pale blue. The coat short, fine and close; a colourpoint, the body pale and
  // shading to fawn along the back, the mask smoky round the eyes and darkest on the nose, the chin paler, the ears,
  // legs and tail dark. Loud, busy, wants to be wherever you are.
  siamese: {
    name: 'Siamese',
    scale: 0.6,
    build: { length: 1.06, chest: 0.9, hips: 0.88, belly: 0.85, pouch: 0.6, legLen: 1.08, legW: 0.85, neck: 0.9, neckLen: 1.05, head: 0.96, cheeks: 0.94, dome: 0.95, muzzle: 1.06, snout: 0.92, ears: 0.98, earRound: 0.1, earSet: 0.18, furnish: 0.6, tailLen: 1.18, tailW: 0.78 },
    eyes: { iris: '#86b8e8', rim: '#2a4a70', size: 1.05, open: 0.9, droop: 0.1, slant: 1.4 },
    fur: { body: 0.0035, ruff: 0.004, belly: 0.004, tail: 0.004, legs: 0.0025, face: 0.0015 },
    coat: { colour: 'seal_point', ...COLOURS.seal_point },
    patterns: ['solid'],
    nature: { outgoing: 0.85, friendly: 0.75, skittish: 0.35, dominant: 0.55, impulsive: 0.7 },
  },

  // MAINE COON. The big farm cat of the American north-east: large, long and rectangular, muscular and broad-chested,
  // on medium-long substantial legs and big round tufted paws; the tail at least as long as the body, wide at the root
  // and flowing. The head medium-long with high cheekbones and a square muzzle; the ears large, wide at the base and
  // tapering, set high and well tufted, with lynx tips; the eyes large and set a little oblique. A heavy, shaggy coat,
  // short on the shoulders and longer down the belly and the britches, a frontal ruff. Gentle and easy, follows you
  // about without asking for much. (CFA breed standard)
  maine_coon: {
    name: 'Maine Coon',
    scale: 0.78,
    build: { length: 1.12, chest: 1.12, hips: 1.05, belly: 1.08, legLen: 1.06, legW: 1.18, neck: 1.1, head: 1.0, cheeks: 0.98, dome: 0.94, muzzle: 1.08, ears: 1.16, earRound: 0, earSet: -0.25, furnish: 1.7, lynx: 1, ruff: 0.75, tailLen: 1.25, tailW: 1.15, tailFluff: 1, legFluff: 0.7 },
    eyes: { iris: '#c8a030', size: 1.06, open: 0.95, droop: 0.1 },
    fur: { body: 0.012, ruff: 0.016, belly: 0.016, tail: 0.014, legs: 0.008, face: 0.003 },
    coat: {},
    patterns: ['solid', 'mitted', 'bicolour'],
    nature: { outgoing: 0.6, friendly: 0.85, skittish: 0.2, dominant: 0.45, impulsive: 0.4 },
  },

  // PERSIAN. Cobby, heavy-boned, low on short thick legs, broad and deep through the chest and as massive over the
  // shoulders as over the rump; the tail short and carried low. The head round and massive on a short thick neck, full
  // cheeks, a short snub nose, the eyes large, round and set wide, the ears small and round-tipped, set far apart and
  // low on the head. A long thick coat standing off the body, an immense ruff carried down between the front legs.
  // Placid: a lap and a sofa. (CFA breed standard)
  persian: {
    name: 'Persian',
    scale: 0.62,
    build: { length: 0.88, chest: 1.2, hips: 1.15, belly: 1.18, legLen: 0.86, legW: 1.2, neck: 1.15, neckLen: 0.7, head: 1.1, cheeks: 1.25, dome: 1.12, muzzle: 0.9, ears: 0.55, earRound: 0.8, earSet: 0.65, furnish: 1.3, ruff: 1, bodyFluff: 1, tailLen: 0.88, tailW: 1.2, tailFluff: 1, legFluff: 1 },
    eyes: { iris: '#d8841c', rim: '#6a3a10', size: 1.18, open: 1.3, sunk: 0.45, droop: 0.02 },
    fur: { body: 0.014, ruff: 0.018, belly: 0.018, tail: 0.016, legs: 0.012, face: 0.0035 },
    coat: {},
    patterns: ['solid', 'bicolour', 'van'],
    nature: { outgoing: 0.35, friendly: 0.7, skittish: 0.3, dominant: 0.35, impulsive: 0.15 },
  },

  // BRITISH SHORTHAIR. Compact and well balanced, powerful, a broad deep chest on short strong legs and round paws; the
  // tail thick at the root and rounded at the tip. A round, massive head with full chubby cheeks, a short broad nose,
  // medium-small ears rounded at the tips and set wide; large round eyes, copper on the blue. The coat short and very
  // dense, crisp to the touch, standing off the body. Calm and self-possessed; likes you, doesn't want to be held.
  // (CFA breed standard)
  british_shorthair: {
    name: 'British Shorthair',
    scale: 0.68,
    build: { length: 0.92, chest: 1.18, hips: 1.12, belly: 1.14, legLen: 0.9, legW: 1.2, neck: 1.1, neckLen: 0.8, head: 1.08, cheeks: 1.22, jowls: 1.1, dome: 1.05, muzzle: 0.95, ears: 0.68, earRound: 0.65, earSet: 0.4, tailLen: 0.85, tailW: 1.2 },
    eyes: { iris: '#d8902a', rim: '#6a4214', size: 1.12, open: 1.25, droop: 0.04 },
    fur: { body: 0.008, ruff: 0.01, belly: 0.01, tail: 0.009, legs: 0.006, face: 0.0025 },
    coat: { base: '#85898d', nose: '#5c6066', pads: '#5c6066', earInner: '#8c8a8e' },
    patterns: ['solid', 'bicolour'],
    nature: { outgoing: 0.35, friendly: 0.55, skittish: 0.2, dominant: 0.55, impulsive: 0.2 },
  },

  // ABYSSINIAN. Medium, lithe and muscular, an arched back, long fine legs on small oval paws, the tail long and
  // tapering. The head a slightly rounded wedge; the ears large and alert, broad and cupped at the base, moderately
  // pointed; the eyes large, almond, gold or green, each rimmed dark with a pale "spectacle" round it. The coat soft,
  // fine and close, every hair ticked in bands (the ruddy: burnt sienna ticked black), the chin pale, a darker line
  // down the spine and the tail's tip dark. Into everything, all the time. (CFA breed standard)
  abyssinian: {
    name: 'Abyssinian',
    scale: 0.6,
    build: { length: 1.04, chest: 0.92, hips: 0.92, belly: 0.84, pouch: 0.7, legLen: 1.08, legW: 0.9, head: 0.95, cheeks: 0.9, dome: 0.98, muzzle: 1.05, ears: 1.2, earRound: 0.15, lynx: 0.3, tailLen: 1.1, tailW: 0.88 },
    eyes: { iris: '#b8a028', rim: '#2e2414', size: 1.06, open: 0.9, droop: 0.1 },
    fur: { body: 0.004, ruff: 0.005, belly: 0.005, tail: 0.005, legs: 0.003, face: 0.0018 },
    // (the pale chin and the spectacles round the eyes are marks, not white spotting, which would put a bib on the chest)
    coat: {
      base: '#94552e', tabby: { kind: 'ticked', col: '#2e1a10' }, grain: 0.55, nose: '#a8524a', pads: '#3a2418',
      marks: [
        { space: 'head', col: '#dcc09a', c: [0, -0.066, 0.05], r: [0.03, 0.016, 0.03], wob: 0.2 },
        { space: 'head', col: '#cfa678', c: [0.044, 0.004, 0.066], r: [0.03, 0.022, 0.012], wob: 0.15 },
        { space: 'head', col: '#cfa678', c: [-0.044, 0.004, 0.066], r: [0.03, 0.022, 0.012], wob: 0.15 },
      ],
    },
    patterns: ['solid'],
    nature: { outgoing: 0.85, friendly: 0.7, skittish: 0.35, dominant: 0.5, impulsive: 0.85 },
  },
};
