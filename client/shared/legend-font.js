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
const ADV = 5.4, HALF = 0.62;   // grid units per letter, and half a stroke

export const legendWidth = (str, h) => ((String(str).length * ADV - (ADV - 4 - HALF * 2)) * h) / 6;

// One line of legend centred on (ca, cb), `h` metres tall, onto a kit panel. Returns its width.
// `shadow` (optional) lays the same letters a hair down-right in that colour first, which is what
// reads as the letters being cut into the panel.
export function legend(Pn, str, ca, cb, h, rgb, emis = 0.12, lift = 0.002, shadow = null) {
  const u = h / 6, W = legendWidth(str, h);
  const bar = (x0, y0, x1, y1, ox, oy, c, l) => {
    let dx = x1 - x0, dy = y1 - y0;
    const L = Math.hypot(dx, dy) || 1;
    dx /= L; dy /= L;
    const ex = dx * HALF, ey = dy * HALF, nx = -dy * HALF, ny = dx * HALF;
    const P = (x, y) => [ox + x * u, oy + y * u];
    Pn.plate([P(x0 - ex + nx, y0 - ey + ny), P(x0 - ex - nx, y0 - ey - ny), P(x1 + ex - nx, y1 + ey - ny), P(x1 + ex + nx, y1 + ey + ny)], c, c === rgb ? emis : 0, l);
  };
  const draw = (dx, dy, c, l) => {
    let x = ca - W / 2 + HALF * u + dx;
    const y = cb - h / 2 + dy;
    for (const ch of String(str).toUpperCase()) {
      const g = G[ch];
      if (g) for (const s of g) bar(s[0], s[1], s[2], s[3], x, y, c, l);
      x += ADV * u;
    }
  };
  if (shadow) draw(u * 0.35, -u * 0.35, shadow, lift);
  draw(0, 0, rgb, shadow ? lift + 0.0015 : lift);
  return W;
}
