// THE LEGEND FACE: small cockpit labels that stay readable.
//
// The Drake's lettering (interior-drake.js GLYPH) is a serif with heavy stems and hairline bars and
// serifs. That is right for a nameplate and wrong for a switch label: at the one or two centimetres a
// label is, seen from the seat, a hairline is under a pixel and vanishes, so a Q read as G, a W lost
// its middle and the boat's legends went to grey fuzz. This face has one stroke weight throughout —
// every letter is a few thick bars on a 4 x 6 grid — so what survives at small sizes is the whole
// letter rather than its stems.
//
// ⚠ IT IS FOR SMALL TEXT ONLY. `engraveText`, `plated_` and `hudText_` in interior-drake.js hand
// anything under LEGEND_MAX_H to it and keep the serif above that, so a nameplate is still a badge.
//
// ⚠ OVERLAPPING BARS ARE THE SAME COLOUR AT THE SAME LIFT, which is why the joints can simply
// overlap: two coplanar faces of one colour fighting for a pixel draw that colour either way.
//
// Pure: no clock, no DOM. Draws through a kit panel's `plate`.

export const LEGEND_MAX_H = 0.0145;   // metres; taller than this, a cockpit keeps its display face

const O = [[1, 0, 3, 0], [3, 0, 4, 1], [4, 1, 4, 5], [4, 5, 3, 6], [3, 6, 1, 6], [1, 6, 0, 5], [0, 5, 0, 1], [0, 1, 1, 0]];
const P_ = [[0, 0, 0, 6], [0, 6, 3, 6], [3, 6, 4, 5], [4, 5, 4, 4], [4, 4, 3, 3], [3, 3, 0, 3]];
const G = {
  A: [[0, 0, 0, 5], [0, 5, 1, 6], [1, 6, 3, 6], [3, 6, 4, 5], [4, 5, 4, 0], [0, 3, 4, 3]],
  B: [[0, 0, 0, 6], [0, 6, 3, 6], [3, 6, 4, 5], [4, 5, 4, 4], [4, 4, 3, 3], [0, 3, 3, 3], [3, 3, 4, 2], [4, 2, 4, 1], [4, 1, 3, 0], [3, 0, 0, 0]],
  C: [[4, 6, 1, 6], [1, 6, 0, 5], [0, 5, 0, 1], [0, 1, 1, 0], [1, 0, 4, 0]],
  D: [[0, 0, 0, 6], [0, 6, 3, 6], [3, 6, 4, 5], [4, 5, 4, 1], [4, 1, 3, 0], [3, 0, 0, 0]],
  E: [[0, 0, 0, 6], [0, 6, 4, 6], [0, 3, 3, 3], [0, 0, 4, 0]],
  F: [[0, 0, 0, 6], [0, 6, 4, 6], [0, 3, 3, 3]],
  G: [[4, 5, 3, 6], [3, 6, 1, 6], [1, 6, 0, 5], [0, 5, 0, 1], [0, 1, 1, 0], [1, 0, 3, 0], [3, 0, 4, 1], [4, 1, 4, 3], [4, 3, 2, 3]],
  H: [[0, 0, 0, 6], [4, 0, 4, 6], [0, 3, 4, 3]],
  I: [[2, 0, 2, 6], [1, 6, 3, 6], [1, 0, 3, 0]],
  J: [[4, 6, 4, 1], [4, 1, 3, 0], [3, 0, 1, 0], [1, 0, 0, 1]],
  K: [[0, 0, 0, 6], [0, 2, 4, 6], [1.3, 3.2, 4, 0]],
  L: [[0, 6, 0, 0], [0, 0, 4, 0]],
  M: [[0, 0, 0, 6], [0, 6, 2, 3], [2, 3, 4, 6], [4, 6, 4, 0]],
  N: [[0, 0, 0, 6], [0, 6, 4, 0], [4, 0, 4, 6]],
  O,
  P: P_,
  Q: [...O, [2.4, 1.6, 4, 0]],
  R: [...P_, [2, 3, 4, 0]],
  S: [[4, 5, 3, 6], [3, 6, 1, 6], [1, 6, 0, 5], [0, 5, 0, 4], [0, 4, 1, 3], [1, 3, 3, 3], [3, 3, 4, 2], [4, 2, 4, 1], [4, 1, 3, 0], [3, 0, 1, 0], [1, 0, 0, 1]],
  T: [[0, 6, 4, 6], [2, 6, 2, 0]],
  U: [[0, 6, 0, 1], [0, 1, 1, 0], [1, 0, 3, 0], [3, 0, 4, 1], [4, 1, 4, 6]],
  V: [[0, 6, 2, 0], [2, 0, 4, 6]],
  W: [[0, 6, 1, 0], [1, 0, 2, 3], [2, 3, 3, 0], [3, 0, 4, 6]],
  X: [[0, 0, 4, 6], [0, 6, 4, 0]],
  Y: [[0, 6, 2, 3], [4, 6, 2, 3], [2, 3, 2, 0]],
  Z: [[0, 6, 4, 6], [4, 6, 0, 0], [0, 0, 4, 0]],
  0: O,
  1: [[2, 0, 2, 6], [2, 6, 1, 5], [1, 0, 3, 0]],
  2: [[0, 5, 1, 6], [1, 6, 3, 6], [3, 6, 4, 5], [4, 5, 4, 4], [4, 4, 0, 0], [0, 0, 4, 0]],
  3: [[0, 6, 4, 6], [4, 6, 2, 3.5], [2, 3.5, 3, 3.5], [3, 3.5, 4, 2.5], [4, 2.5, 4, 1], [4, 1, 3, 0], [3, 0, 1, 0], [1, 0, 0, 1]],
  4: [[3, 0, 3, 6], [3, 6, 0, 2], [0, 2, 4, 2]],
  5: [[4, 6, 0, 6], [0, 6, 0, 3.5], [0, 3.5, 3, 3.5], [3, 3.5, 4, 2.5], [4, 2.5, 4, 1], [4, 1, 3, 0], [3, 0, 0, 0]],
  6: [[3, 6, 1, 6], [1, 6, 0, 5], [0, 5, 0, 1], [0, 1, 1, 0], [1, 0, 3, 0], [3, 0, 4, 1], [4, 1, 4, 2.5], [4, 2.5, 3, 3.5], [3, 3.5, 0, 3.5]],
  7: [[0, 6, 4, 6], [4, 6, 1.5, 0]],
  8: [...O, [0, 3, 4, 3]],
  9: [[1, 0, 3, 0], [3, 0, 4, 1], [4, 1, 4, 5], [4, 5, 3, 6], [3, 6, 1, 6], [1, 6, 0, 5], [0, 5, 0, 3.5], [0, 3.5, 1, 2.5], [1, 2.5, 4, 2.5]],
  '-': [[0.5, 3, 3.5, 3]],
  '/': [[0, 0, 4, 6]],
};
// The strokes themselves, for drawing the face some other way (a club crest outlines them:
// scripts/content/build-deadball-clubs.mjs).
export const LEGEND_STROKES = G;
const ADV = 5.4, HALF = 0.62;   // grid units per letter, and half a stroke

export const legendWidth = (str, h) => ((String(str).length * ADV - (ADV - 4 - HALF * 2)) * h) / 6;

// A gate's ear on the size of the lettering (scripts/shapes/cockpit-controls.mjs). `label(str, foot,
// head)` hears every line drawn on a panel that can say where it is (`Pn.pt`), with the cabin points
// of the middle of its baseline and of its cap line, so the gate can measure how big it looks from
// the eye. Null everywhere but the gate.
export const LEGEND_TRACE = { label: null };

// One line of legend centred on (ca, cb), `h` metres tall, onto a kit panel. Returns its width.
// `shadow` (optional) lays the same letters a hair down-right in that colour first, which is what
// reads as the letters being cut into the panel.
export function legend(Pn, str, ca, cb, h, rgb, emis = 0.12, lift = 0.002, shadow = null) {
  if (LEGEND_TRACE.label && Pn.pt && String(str).trim()) LEGEND_TRACE.label(String(str), Pn.pt(ca, cb - h / 2, lift), Pn.pt(ca, cb + h / 2, lift));
  const u = h / 6, W = legendWidth(str, h);
  // The comic look letters it by hand, as Borderlands does: a forward lean, each letter a little
  // off the baseline and turned a degree or two, and each stroke heavier where the pen came down.
  // The wobble is seeded by the text and the letter's place, so a label draws the same every time.
  // Off, it draws as it always did.
  const C = comicHand();
  const bar = (x0, y0, x1, y1, ox, oy, c, l, wob) => {
    let dx = x1 - x0, dy = y1 - y0;
    const L = Math.hypot(dx, dy) || 1;
    dx /= L; dy /= L;
    const ha = C ? HALF * C.head : HALF, ta = C ? HALF * C.tail : HALF;
    const ex = dx * HALF, ey = dy * HALF;
    const P = (x, y) => {
      if (wob) {   // turn about the letter's middle, bob, then lean
        const cx = x - 2, cy = y - 3;
        x = 2 + cx * wob.c - cy * wob.s; y = 3 + cx * wob.s + cy * wob.c + wob.bob;
        x += y * C.slant;
      }
      return [ox + x * u, oy + y * u];
    };
    Pn.plate([P(x0 - ex - dy * ha, y0 - ey + dx * ha), P(x0 - ex + dy * ha, y0 - ey - dx * ha), P(x1 + ex + dy * ta, y1 + ey - dx * ta), P(x1 + ex - dy * ta, y1 + ey + dx * ta)], c, c === rgb ? emis : 0, l);
  };
  const seed = hashStr(String(str));
  const draw = (dx, dy, c, l) => {
    let x = ca - W / 2 + HALF * u + dx - (C ? 3 * C.slant * u : 0);   // the lean, centred
    const y = cb - h / 2 + dy;
    let i = 0;
    for (const ch of String(str).toUpperCase()) {
      const g = G[ch];
      let wob = null;
      if (C) {
        const r1 = rnd(seed, i * 2), r2 = rnd(seed, i * 2 + 1), a = (r1 - 0.5) * C.turn;
        wob = { c: Math.cos(a), s: Math.sin(a), bob: (r2 - 0.5) * C.bob };
      }
      if (g) for (const s of g) bar(s[0], s[1], s[2], s[3], x, y, c, l, wob);
      x += ADV * u; i++;
    }
  };
  if (shadow) draw(u * 0.35, -u * 0.35, shadow, lift);
  else if (C) draw(u * 0.45, -u * 0.45, C.ink, lift);   // the comic drop: an inked offset under every label
  draw(0, 0, rgb, shadow || C ? lift + 0.0015 : lift);
  return W;
}

// The hand-lettered tune, or null when the comic look is off (gl/house-style.js comicOn reads the
// same flag; this file is shared, so it reads the global itself). `head`/`tail` are each stroke's
// half-width at its start and end, as a share of HALF; `turn` is radians, `bob` grid units.
export const LEGEND_HAND = { slant: 0.16, turn: 0.07, bob: 0.35, head: 1.12, tail: 0.86, ink: [0.05, 0.045, 0.055] };
function comicHand() { return globalThis.__houseComic ? LEGEND_HAND : null; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
function rnd(seed, i) { let x = Math.imul(seed ^ Math.imul(i + 1, 0x9e3779b1), 0x85ebca6b) >>> 0; x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35) >>> 0; return ((x ^ (x >>> 16)) >>> 0) / 4294967296; }
