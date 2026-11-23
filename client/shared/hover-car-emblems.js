// THE HOVER CAR MAKERS' EMBLEMS, DRAWN ONCE (docs/proposals/hover-cars.md).
//
// Each is a list of flat convex pieces in a box from -1 to 1 (x right, y up), so the badge on a car's
// nose (scripts/shapes/concepts/<id>.mjs), the one on its wheel (interior-<id>.js) and any sign that
// wants it are the same drawing. A piece is { p: [[x, y], ...], tone }: 'field' is the ground the
// emblem sits on, 'mark' is the device itself. Pieces are listed back to front.
//
//   castellan   a tower on a shield
//   brakk       a beast's head in profile, jaw open, looking right
//   vex         a V inside a circle
//
// Pure data: no imports, so the bake, the gates and the browser all read it.
const ring = (r0, r1, n = 24) => Array.from({ length: n }, (_, i) => {
  const a = i / n * Math.PI * 2, b = (i + 1) / n * Math.PI * 2;
  return { p: [[Math.cos(a) * r0, Math.sin(a) * r0], [Math.cos(b) * r0, Math.sin(b) * r0], [Math.cos(b) * r1, Math.sin(b) * r1], [Math.cos(a) * r1, Math.sin(a) * r1]], tone: 'mark' };
});
const rect = (x0, y0, x1, y1, tone = 'mark') => ({ p: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], tone });

export const HOVER_EMBLEMS = {
  castellan: [
    { p: [[-0.85, 1], [0.85, 1], [0.85, -0.15], [0, -1], [-0.85, -0.15]], tone: 'field' },
    rect(-0.34, -0.5, 0.34, 0.38),
    rect(-0.46, 0.38, -0.22, 0.66), rect(-0.12, 0.38, 0.12, 0.66), rect(0.22, 0.38, 0.46, 0.66),
    rect(-0.1, -0.5, 0.1, -0.12, 'field'),
  ],
  brakk: [
    { p: [[-0.95, -0.15], [-0.95, 0.45], [-0.35, 0.72], [0.1, 0.45], [0.1, -0.15]], tone: 'mark' },
    { p: [[0.1, 0.45], [1, 0.3], [0.95, 0.1], [0.1, 0.02]], tone: 'mark' },
    { p: [[-0.3, -0.15], [0.1, -0.15], [0.88, -0.52], [0.76, -0.7], [-0.3, -0.42]], tone: 'mark' },
    { p: [[-0.78, 0.55], [-0.6, 1], [-0.36, 0.7]], tone: 'mark' },
    // The eye, and two teeth in the open jaw.
    rect(-0.2, 0.3, -0.04, 0.42, 'field'),
    { p: [[0.5, 0.06], [0.62, 0.07], [0.56, -0.12]], tone: 'mark' },
    { p: [[0.44, -0.3], [0.56, -0.36], [0.5, -0.12]], tone: 'mark' },
  ],
  vex: [
    ...ring(0.84, 1),
    { p: [[-0.6, 0.52], [-0.3, 0.52], [0.13, -0.62], [-0.13, -0.62]], tone: 'mark' },
    { p: [[0.6, 0.52], [0.3, 0.52], [-0.13, -0.62], [0.13, -0.62]], tone: 'mark' },
  ],
};
