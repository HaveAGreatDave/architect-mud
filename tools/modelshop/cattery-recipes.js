// THE CATTERY'S CATS: each a set of the cat kit's numbers (client/game/js/panels/gl/cat-kit.js CAT).
//
// Scrappy is the first cat and the bar every other one is built to (docs/proposals/pets.md). His coat is off the
// two photos of him: a black saddle over his back and sides from behind the shoulders to the tail, the belly, chest
// and front legs white, black hind legs in white socks, a black patch on the front of his left shoulder; a thin black
// cap joining the ear bases, a patch round his left eye up into a black left ear, a handlebar moustache, a chin spot,
// a pink nose and pale round eyes. He's a fat, fluffy tom.
// Until the pets table carries cats, they live here.

export const CATS = {
  scrappy: {
    name: 'Scrappy',
    note: "Cyd's cat. A black saddle and tail, black hind legs in white socks, white chest and front legs, a patch on his left shoulder, a cap, a patch round his left eye into a black left ear, a handlebar moustache and a chin spot.",
    look: {
      build: { belly: 1.5, pouch: 1.6, chest: 1.18, hips: 1.2, cheeks: 1.1, head: 1.08, legLen: 0.92, tailW: 1.15, neck: 1.05, length: 0.84, neckLen: 0.72 },
      coat: {
        base: '#1c1a1f', whiteCol: '#eeeae2', white: 1, seed: 3,
        nose: '#d4898f', pads: '#cf8b93', earInner: '#dda2a4', whisker: '#f4f1ea',
        marks: [
          // the cap: a thin band over the crown joining the two ear bases, the forehead left white
          { space: 'head', on: ['head'], c: [0.0, 0.088, 0.0], r: [0.115, 0.036, 0.06] },
          { space: 'head', on: ['head'], c: [0.0, 0.04, -0.085], r: [0.09, 0.06, 0.04] },
          // the patch over his left eye, traced off the photos in the face's front view: its inner edge curves down on a
          // diagonal from the root of his left ear to the inner corner of the eye, leaving the forehead white; it rounds
          // under the eye, sweeps out along the cheek and goes round the side of the head up into the black ear
          { space: 'head', on: ['head'], zMin: -0.045, wob: 0.0025, poly: [[0.064, 0.094], [0.052, 0.074], [0.039, 0.054], [0.028, 0.034], [0.02, 0.016], [0.017, 0.002], [0.022, -0.01], [0.036, -0.019], [0.056, -0.026], [0.078, -0.028], [0.098, -0.02], [0.116, -0.003], [0.124, 0.035], [0.114, 0.075], [0.09, 0.1]] },
          // his left ear black; the right stays white, pink inside
          { space: 'head', on: ['ear'], c: [0.11, 0.12, -0.02], r: [0.08, 0.14, 0.09] },
          // the handlebar moustache: a big lobe on his right, a longer thinner one on his left, joined under the nose
          { space: 'head', c: [-0.022, -0.036, 0.08], r: [0.02, 0.012, 0.03], wob: 0.3 },
          { space: 'head', c: [0.02, -0.034, 0.081], r: [0.021, 0.0085, 0.03], wob: 0.3 },
          { space: 'head', c: [0.0, -0.031, 0.088], r: [0.012, 0.008, 0.02], wob: 0.1 },
          // the spot on the chin, a little to his right
          { space: 'head', c: [-0.006, -0.066, 0.066], r: [0.012, 0.012, 0.02], wob: 0.2 },
          // the saddle: his back and sides black from behind the shoulders to the tail, the belly left white
          { space: 'body', on: ['body', 'neck'], c: [0, 0.44, -0.17], r: [0.22, 0.25, 0.28] },
          // and the belly under it white
          { space: 'body', on: ['body'], col: 'white', c: [0, 0.2, -0.08], r: [0.1, 0.12, 0.3] },
          { space: 'body', on: ['tail'], c: [0, 0.3, -0.6], r: [0.3, 0.3, 0.4], wob: 0 },
          // the hind legs black down to white socks
          { space: 'body', on: ['leg'], c: [0.1, 0.32, -0.2], r: [0.085, 0.2, 0.15] },
          { space: 'body', on: ['leg'], c: [-0.1, 0.32, -0.2], r: [0.085, 0.2, 0.15] },
          // the patch on the front of his left shoulder
          { space: 'body', on: ['body', 'leg'], c: [0.085, 0.38, 0.17], r: [0.035, 0.075, 0.05] },
        ],
      },
      eyes: { iris: '#bcc486', rim: '#5c6440', pupil: 0.6, size: 1.16, open: 1.12, sunk: 0.5, droop: 0 },
      fur: { body: 0.009, ruff: 0.016, belly: 0.014, tail: 0.012, legs: 0.005, face: 0.0025 },
    },
  },
  // the kit's own numbers, a plain cat to measure against
  plain: { name: 'Plain shorthair', note: "The kit's defaults: an ordinary grey-brown shorthair.", look: {} },
  tabby: {
    name: 'Mackerel tabby', note: 'A brown mackerel tabby with white mittens and bib, to show the coat has more in it than Scrappy.',
    look: { coat: { base: '#8a6a48', white: 0.22, tabby: { kind: 'mackerel', col: '#2e2218' }, nose: '#b0605a' }, eyes: { iris: '#a8b838', pupil: 0.3 } },
  },
  tux: {
    name: 'Tuxedo', note: 'Black with a white bib, belly and paws.',
    look: { coat: { base: '#18161a', white: 0.42, seed: 7, nose: '#2a2224', pads: '#2a2224' }, eyes: { iris: '#d8b030' }, build: { belly: 0.9, chest: 0.95 } },
  },
};
