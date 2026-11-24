// THE HOVER CAR MAKERS' EMBLEMS, DRAWN ONCE (docs/proposals/hover-cars.md).
//
// Each is a list of flat convex pieces in a box from -1 to 1 (x right, y up), so the badge on a car's
// nose (scripts/shapes/concepts/<id>.mjs), the one on its wheel (interior-<id>.js), the showroom's
// signs (dealer-display.js) and anything else that wants it are the same drawing. A piece is
// { p: [[x, y], ...], tone }: 'field' is the ground the emblem sits on, 'mark' is the device. Pieces
// are listed back to front, so a later 'field' piece cuts a line or a window into the mark under it.
// They're built the way the CPhL's crests are (cphl-crests.js): a rim, a ground, a fine inner line,
// then the device with its own detail cut into it.
//
//   castellan   a tower with a gate, slits and a pennant, on a bordered shield
//   brakk       a block-cut B in a bolted octagon
//   vex         an outlined V across a horizon bar, in a studded ring
//   corvane     swept wings either side of a kite (the Merlin's maker)
//
// Pure data: no imports, so the bake, the gates and the browser all read it.
const TAU = Math.PI * 2;
const at = (r, a) => [Math.cos(a) * r, Math.sin(a) * r];
// A band between radii r0 and r1, in n quads, as an n-gon turned by `rot`.
const ring = (r0, r1, n = 32, tone = 'mark', rot = 0) => Array.from({ length: n }, (_, i) => {
  const a = rot + i / n * TAU, b = rot + (i + 1) / n * TAU;
  return { p: [at(r0, a), at(r0, b), at(r1, b), at(r1, a)], tone };
});
const disc = (r, n = 32, tone = 'field', cx = 0, cy = 0, rot = 0) =>
  ({ p: Array.from({ length: n }, (_, i) => { const [x, y] = at(r, rot + i / n * TAU); return [cx + x, cy + y]; }), tone });
const rect = (x0, y0, x1, y1, tone = 'mark') => ({ p: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], tone });
const poly = (p, tone = 'mark') => ({ p, tone });
const mirror = (p) => p.map(([x, y]) => [-x, y]).reverse();

// ── CASTELLAN: a tower on a shield ───────────────────────────────────────────
const SHIELD = [[-0.88, 1], [0.88, 1], [0.88, -0.1], [0.56, -0.62], [0, -1], [-0.56, -0.62], [-0.88, -0.1]];
const castellan = [
  poly(SHIELD),                                   // the border
  poly(SHIELD.map(([x, y]) => [x * 0.86, y * 0.86 + 0.02]), 'field'),
  poly(SHIELD.map(([x, y]) => [x * 0.8, y * 0.8 + 0.03])),   // the fine inner line
  poly(SHIELD.map(([x, y]) => [x * 0.76, y * 0.76 + 0.035]), 'field'),
  // The tower: plinth, body, the corbelled band and five merlons.
  rect(-0.4, -0.55, 0.4, -0.47),
  rect(-0.3, -0.47, 0.3, 0.3),
  rect(-0.38, 0.3, 0.38, 0.4),
  rect(-0.38, 0.4, -0.25, 0.55), rect(-0.19, 0.4, -0.06, 0.55), rect(0.06, 0.4, 0.19, 0.55), rect(0.25, 0.4, 0.38, 0.55),
  // Stone courses and the line under the band.
  rect(-0.3, -0.2, 0.3, -0.18, 'field'), rect(-0.3, 0.08, 0.3, 0.1, 'field'), rect(-0.3, 0.28, 0.3, 0.3, 'field'),
  // The arched gate, with its portcullis.
  rect(-0.12, -0.47, 0.12, -0.3, 'field'), poly(Array.from({ length: 9 }, (_, i) => { const [x, y] = at(0.12, i / 8 * Math.PI); return [x, y - 0.3]; }), 'field'),
  rect(-0.065, -0.47, -0.04, -0.21), rect(0.04, -0.47, 0.065, -0.21), rect(-0.12, -0.36, 0.12, -0.335),
  // Two arrow slits and a window under the band.
  rect(-0.2, -0.06, -0.15, 0.06, 'field'), rect(0.15, -0.06, 0.2, 0.06, 'field'),
  rect(-0.05, 0.14, 0.05, 0.24, 'field'),
  // The pennant on the middle merlon gap's pole.
  rect(-0.015, 0.55, 0.015, 0.8),
  poly([[0.015, 0.8], [0.26, 0.74], [0.015, 0.67]]),
];

// ── BRAKK: a block B in a bolted octagon ─────────────────────────────────────
// A heavy-plant badge: plate steel, eight bolt heads, the letter cut through by a stencil line.
const brakk = [
  ...ring(0.86, 1, 8, 'mark', TAU / 16),
  ...Array.from({ length: 8 }, (_, i) => { const [x, y] = at(0.855, (i + 0.5) / 8 * TAU + TAU / 16); return disc(0.04, 6, 'field', x, y); }),
  disc(0.86, 8, 'field', 0, 0, TAU / 16),
  ...ring(0.76, 0.8, 8, 'mark', TAU / 16),
  // Rails above and below the letter.
  rect(-0.42, 0.58, 0.42, 0.64), rect(-0.42, -0.64, 0.42, -0.58),
  // The B: stem, upper bowl, lower bowl (wider, as a block letter is), each bowl with its counter.
  rect(-0.44, -0.5, -0.2, 0.5),
  poly([[-0.2, 0.04], [0.26, 0.04], [0.38, 0.14], [0.38, 0.38], [0.26, 0.5], [-0.2, 0.5]]),
  poly([[-0.2, -0.5], [0.32, -0.5], [0.46, -0.36], [0.46, -0.08], [0.32, 0.04], [-0.2, 0.04]]),
  rect(-0.2, 0.18, 0.2, 0.36, 'field'),
  rect(-0.2, -0.36, 0.28, -0.12, 'field'),
  // The stencil cut across it, and a slot down the stem.
  rect(-0.44, 0.0, 0.46, 0.07, 'field'),
  rect(-0.34, -0.4, -0.3, -0.06, 'field'), rect(-0.34, 0.14, -0.3, 0.4, 'field'),
];

// ── VEX: a V in a studded ring ───────────────────────────────────────────────
const ARM = [[-0.62, 0.56], [-0.3, 0.56], [0.15, -0.64], [-0.15, -0.64]];
// A thin strip parallel to the arm's outer edge, a little inside it (the edges run 0.392 across per 1 down).
const edgeX = (y, off) => -0.62 + (0.56 - y) * 0.392 + off;
const INLINE = [[edgeX(0.48, 0.08), 0.48], [edgeX(0.48, 0.12), 0.48], [edgeX(-0.46, 0.12), -0.46], [edgeX(-0.46, 0.08), -0.46]];
const vex = [
  ...ring(0.84, 1, 36),
  // Twelve studs let into the ring, as the crests' rims have.
  ...Array.from({ length: 12 }, (_, i) => { const [x, y] = at(0.92, i / 12 * TAU + TAU / 24); return disc(0.035, 8, 'field', x, y); }),
  disc(0.84, 36, 'field'),
  ...ring(0.74, 0.77, 36),
  // The horizon bar either side, stopping short of the V.
  rect(-0.7, -0.08, -0.46, 0.0), rect(0.46, -0.08, 0.7, 0.0),
  poly(ARM), poly(mirror(ARM)),
  // An inline down each arm, the way a chrome badge is cut.
  poly(INLINE, 'field'), poly(mirror(INLINE), 'field'),
  // A chevron over the V's mouth.
  poly([[-0.16, 0.6], [0, 0.48], [0.16, 0.6]]),
  poly([[-0.08, 0.6], [0, 0.54], [0.08, 0.6]], 'field'),
];

// ── CORVANE: wings either side of a kite ─────────────────────────────────────
const corvane = [
  // Four feathers a side, swept and tapering, each longer than the one under it.
  ...[-1, 1].flatMap((sg) => [0, 1, 2, 3].map((i) => {
    const y0 = 0.36 - i * 0.22, xt = 1.0 - i * 0.17, yt = 0.7 - i * 0.19, w = 0.11 - i * 0.012;
    const q = [[sg * 0.22, y0], [sg * xt, yt], [sg * xt, yt - w], [sg * 0.22, y0 - 0.16]];
    return poly(sg < 0 ? q.reverse() : q);
  })),
  // A quill line down each of the two long feathers.
  ...[-1, 1].map((sg) => { const q = [[sg * 0.3, 0.32], [sg * 0.9, 0.66], [sg * 0.9, 0.645], [sg * 0.3, 0.305]]; return poly(sg < 0 ? q.reverse() : q, 'field'); }),
  // The kite: an outline, a cut, a core and a spark at its heart.
  poly([[0, 0.7], [0.2, 0.04], [0, -0.7], [-0.2, 0.04]]),
  poly([[0, 0.56], [0.13, 0.04], [0, -0.56], [-0.13, 0.04]], 'field'),
  poly([[0, 0.46], [0.08, 0.04], [0, -0.46], [-0.08, 0.04]]),
  poly([[0, 0.12], [0.035, 0.04], [0, -0.04], [-0.035, 0.04]], 'field'),
];

export const HOVER_EMBLEMS = { castellan, brakk, vex, corvane };
