// THE GOOSE: the gilt figure on Golden Goose Gardens' front gable (glass/models/ashway.js), as outlines, so the same
// bird stands on the roof and on top of the Cup in its case (gl/room-cup.js) and on the ice (gl/arena-mesh.js).
//
// It's displayed the way a deco eagle is: body and wings face you, the neck goes straight up, the head is turned in
// profile to the viewer's left (heraldry's dexter), and each wing rises in four stepped feathers, the longest on top.
// It's cut from plate, every part a slab GOOSE_T thick, so it keeps a shape from the side.
//
// Units are the roof's (a tile's depth): u across (−u is the viewer's left), v up from the plinth's top. A caller
// scales them to its own size; the figure is GOOSE_H tall and GOOSE_W across the wings.
// ⚠ EVERY OUTLINE IS CONVEX. A flat face is a fan on the GPU, so a concave one fills wrong; the figure is built from
// convex parts instead.
// ⚠ NO TWO PARTS SHARE A PLANE. Each part's front stands at its own `y` (in front of the figure's back), so where two
// parts overlap one is in front and neither z-fights. The wings stand furthest back.

export const GOOSE_T = 0.012;
// Each part: its front's y, its outline, and `k`, how much of the gilt's light it takes, so the parts read apart
// where they overlap.
export const GOOSE_PARTS = [
  { y: 0.004, k: 0.86, pts: [[-0.016, 0], [0.016, 0], [0.009, 0.016], [-0.009, 0.016]] },            // the tail, fanned on the plinth
  { y: 0.006, k: 1, pts: [[0, 0.008], [0.014, 0.014], [0.026, 0.03], [0.03, 0.055], [0.022, 0.078], [0.009, 0.086],
    [-0.009, 0.086], [-0.022, 0.078], [-0.03, 0.055], [-0.026, 0.03], [-0.014, 0.014]] },              // the body
  { y: 0.0055, k: 0.97, pts: [[-0.0065, 0.084], [0.0065, 0.084], [0.0048, 0.162], [-0.0048, 0.162]] }, // the neck, long, which is what makes it a goose
  { y: 0.0065, k: 1.04, pts: Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * Math.PI * 2; return [0.002 + 0.0125 * Math.cos(a), 0.167 + 0.0085 * Math.sin(a)]; }) },   // the head
  { y: 0.006, k: 0.9, pts: [[-0.008, 0.171], [-0.032, 0.1655], [-0.032, 0.1625], [-0.008, 0.1605]] },   // the bill, pointing dexter
  { y: 0.0075, k: 0.84, pts: [[-0.017, 0], [-0.003, 0], [-0.01, 0.009]] },                              // the feet
  { y: 0.0075, k: 0.84, pts: [[0.003, 0], [0.017, 0], [0.01, 0.009]] },
];
// One wing's feathers, inside to tip, top first: [root u, foot v, head v, tip u]. Each rises toward its tip, and its
// tip leans out at the top. They darken a step at a time down the wing.
const GOOSE_WING = [[0.004, 0.112, 0.13, 0.118], [0.008, 0.092, 0.108, 0.1], [0.012, 0.073, 0.088, 0.082], [0.016, 0.056, 0.069, 0.064]];
for (const s of [1, -1]) GOOSE_WING.forEach(([u0, v0, v1, u1], i) => {
  const r = (u1 - u0) * 0.3;
  GOOSE_PARTS.push({ y: 0.002, k: 0.95 - i * 0.05, pts: [[s * u0, v0], [s * (u1 - 0.008), v0 + r], [s * u1, v1 + r], [s * u0, v1]] });
});
// Three chevrons down the breast, each arm its own strip, a shade darker than the body: the feathers as a deco
// sculptor cuts them. Face only, flats laid on the body at GOOSE_FACE.
export const GOOSE_CHEVRONS = [];
for (const v of [0.028, 0.044, 0.06]) for (const s of [1, -1]) {
  const w = 0.019 - (v - 0.028) * 0.1;
  GOOSE_CHEVRONS.push([[0, v], [s * w, v + 0.011], [s * w, v + 0.015], [0, v + 0.004]]);
}
// the eye, a dark chip on the head's face
export const GOOSE_EYE = [[-0.006, 0.169], [-0.0045, 0.1705], [-0.003, 0.169], [-0.0045, 0.1675]];
// where the chevrons and the eye lie: a hair in front of the body's and the head's faces
export const GOOSE_FACE = 0.0068;
// its size in its own units: from the plinth to the top of the head, and wingtip to wingtip
export const GOOSE_H = 0.1755, GOOSE_W = 0.236;
