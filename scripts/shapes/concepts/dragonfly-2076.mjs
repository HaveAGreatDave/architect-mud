// The Dragonfly 2076 concept: writes content/vehicle_models/mesh_heli_2076.json.
//
//   node scripts/shapes/concepts/dragonfly-2076.mjs
//   then: npm run vehicles:bake
//
// The Dragonfly fifty years on, after the EHang EH216-S: a two-seat pod with no main rotor, four
// arms in an X off a roof hub, a coaxial pair of rotors at each tip, a segmented tail kept only for
// the name, and faired skids. It is a variant of the heli mesh (mesh_heli.json `variants`), worn as
// the Dragonfly 2076 factory edition.
//
// ⚠ THIS OVERWRITES THE JSON. Edit this file, not the mesh in the Modelshop.
//
// Two bodies in one file. Everything fine is `minDetail: 1`; a coarse body with `maxDetail: 0`
// stands in at range, so the far LOD stays near the Mini-500's few hundred faces.
//
// Frame: f fore, g right, h up, in the heli's units (the Mini-500's rotor is 1.02 in radius).
// Angles on a section are lib.mjs's: 0 = right waterline, +90 = crown, -90 = keel.
import { writeFileSync } from 'node:fs';
import { R, P3, skin, loft, pod, tube, mirror, group, poly as rawPoly, quad, DEG } from '../fw-meshes/lib.mjs';
const { formatMesh, validateMesh, compileMesh } = await import('../../../client/shared/vehicle-mesh.js');

const FINE = { minDetail: 1 }, COARSE = { maxDetail: 0 };
// Every poly face needs a role; trim and fittings are 'nacelle' unless they say otherwise.
const poly = (name, faces, extra) => rawPoly(name, faces.map((f) => ({ role: 'nacelle', ...f })), extra);
const GLASS = [62, 98, 122];
const lerp = (a, b, t) => a + (b - a) * t;
const range = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));

// ── The cabin pod ───────────────────────────────────────────────────────────────
// [f, rg, rvT, rvB, cz, boxy]: an egg with flatter flanks and belly, widest just behind the seats.
const CAB = [
  [0.668, 0.012, 0.012, 0.012, 0.0, 0],
  [0.655, 0.05, 0.052, 0.046, 0.002, 0.05],
  [0.635, 0.085, 0.09, 0.075, 0.004, 0.08],
  [0.605, 0.118, 0.126, 0.1, 0.008, 0.1],
  [0.565, 0.148, 0.16, 0.124, 0.012, 0.13],
  [0.515, 0.175, 0.19, 0.146, 0.017, 0.15],
  [0.455, 0.198, 0.214, 0.165, 0.022, 0.17],
  [0.385, 0.216, 0.233, 0.18, 0.027, 0.19],
  [0.31, 0.229, 0.246, 0.192, 0.031, 0.2],
  [0.23, 0.237, 0.254, 0.2, 0.035, 0.21],
  [0.15, 0.24, 0.257, 0.204, 0.038, 0.21],
  [0.07, 0.238, 0.256, 0.204, 0.042, 0.21],
  [-0.01, 0.231, 0.25, 0.2, 0.047, 0.2],
  [-0.08, 0.218, 0.238, 0.191, 0.053, 0.19],
  [-0.14, 0.198, 0.219, 0.176, 0.059, 0.17],
  [-0.19, 0.172, 0.193, 0.155, 0.065, 0.15],
  [-0.23, 0.141, 0.16, 0.128, 0.071, 0.12],
  [-0.26, 0.106, 0.122, 0.097, 0.076, 0.09],
  [-0.28, 0.07, 0.083, 0.066, 0.08, 0.06],
].map(([f, rg, rvT, rvB, cz, boxy]) => ({ f, rg, rvT, rvB, cz, boxy }));
const at = (f, a, out = 0) => skin(CAB, f, a * DEG, out);

const cabin = loft('cabin pod', 36, CAB, {
  ...FINE, paint: 'hull',
  note: 'The shell. Glass, frames, doors and the belly trim are separate parts laid a hair proud of it.',
  capFore: { kind: 'apex', at: [0.672, 0, 0], role: 'glass', tint: GLASS },
  capAft: { kind: 'apex', at: [-0.288, 0, 0.081], paint: 'hull' },
  shade: { base: 0.6, amp: 0.36 },
});

// A curved patch of skin as a grid of quads, `o` proud of the hull: glass, panels, trim.
function patch(fs, as, extra, o = 0.0022) {
  const out = [];
  for (let i = 0; i < fs.length - 1; i++) for (let j = 0; j < as.length - 1; j++) {
    out.push(quad(at(fs[i + 1], as[j], o), at(fs[i], as[j], o), at(fs[i], as[j + 1], o), at(fs[i + 1], as[j + 1], o), extra));
  }
  return out;
}
// A curve drawn on the skin: along f at a fixed angle, or round a station between two angles.
const alongF = (fs, a, o = 0.004) => fs.map((f) => at(f, a, o));
const roundF = (f, as, o = 0.004) => as.map((a) => at(f, a, o));

// The windscreen: one bubble from the nose round to the A-pillars, down to a chin line at -34°.
const WS_F = [0.668, 0.655, 0.635, 0.605, 0.565, 0.515, 0.455, 0.405, 0.36, 0.33];
const WS_A = range(-34, 214, 28);
const windscreen = poly('windscreen', patch(WS_F, WS_A, { role: 'glass', tint: GLASS }), FINE);

// Door windows, each side: from the A-pillar to the B-pillar, sill at 8°, header at 74°.
const DW_F = [0.31, 0.26, 0.21, 0.16, 0.11, 0.06, 0.01, -0.03];
const doorGlass = poly('door window (right)', patch(DW_F, range(8, 74, 8), { role: 'glass', tint: GLASS }), FINE);
// Rear quarter lights, a small teardrop behind the B-pillar.
const QW_F = [-0.06, -0.09, -0.12, -0.15];
const quarter = poly('quarter light (right)', patch(QW_F, range(30, 66, 4), { role: 'glass', tint: GLASS }), FINE);
// The roof between the headers is glass too, a skylight over the seats.
const SKY_F = [0.31, 0.24, 0.17, 0.1, 0.03, -0.03];
const skylight = poly('skylight', patch(SKY_F, range(84, 96, 2), { role: 'glass', tint: GLASS }), FINE);

// Frames: the pillars, header rails and sills, dark and standing just proud of the glass.
const FR = (name, pts, r = 0.0055) => tube(name, pts, r, { role: 'nacelle', paint: 'frame', sh: 0.5, sides: 5, ...FINE });
const frames = [
  FR('windscreen centre post', alongF([0.665, 0.645, 0.615, 0.575, 0.525, 0.465, 0.405, 0.35, 0.31], 90, 0.0045), 0.0045),
  FR('chin line (right)', alongF(WS_F, -34), 0.005),
  FR('chin line (left)', alongF(WS_F, 214), 0.005),
  FR('A-pillar arch', roundF(0.315, range(-34, 214, 22))),
  FR('B-pillar arch', roundF(-0.04, range(-30, 210, 20))),
  FR('C-ring', roundF(-0.165, range(-20, 200, 18)), 0.0045),
  ...[0, 1].flatMap((s) => {
    const A = (a) => (s ? 180 - a : a), side = s ? 'left' : 'right';
    return [
      FR('door sill (' + side + ')', alongF(DW_F, A(7))),
      FR('door header (' + side + ')', alongF(DW_F, A(75))),
      FR('roof rail (' + side + ')', alongF([0.31, 0.24, 0.17, 0.1, 0.03, -0.04, -0.1, -0.16], A(83)), 0.0045),
      FR('quarter light frame (' + side + ')', [...roundF(-0.055, range(A(29), A(67), 4)), ...alongF(QW_F, A(67)).slice(1), ...roundF(-0.155, range(A(67), A(29), 4)).slice(1), ...alongF([...QW_F].reverse(), A(29)).slice(1)], 0.004),
    ];
  }),
].filter((t) => t.pts.length > 1);

// The doors: a seam all round each, a little bigger than its window, gull-wing hinged at the roof
// rail. Handle, hinge fairings and a fold-out step under the sill.
const DOOR_F0 = 0.325, DOOR_F1 = -0.05, DOOR_LO = -42;
const doorSeam = (s) => {
  const A = (a) => (s ? 180 - a : a), side = s ? 'left' : 'right';
  const seam = (name, pts) => tube(name + ' (' + side + ')', pts, 0.0028, { role: 'nacelle', paint: 'seam', sh: 0.4, sides: 4, ...FINE });
  return [
    seam('door front seam', roundF(DOOR_F0, range(A(DOOR_LO), A(80), 12), 0.0026)),
    seam('door rear seam', roundF(DOOR_F1, range(A(DOOR_LO), A(80), 12), 0.0026)),
    seam('door bottom seam', alongF(range(DOOR_F0, DOOR_F1, 9), A(DOOR_LO), 0.0026)),
  ];
};
const door = (s) => {
  const A = (a) => (s ? 180 - a : a), side = s ? 'left' : 'right', sg = s ? -1 : 1;
  const parts = [
    ...doorSeam(s),
    // Flush handle: a short bar in a dark recess at waist height, aft on the door.
    poly('handle recess (' + side + ')', patch([0.02, -0.03], [A(-6), A(2)], { paint: 'seam' }, 0.0026), FINE),
    tube('door handle (' + side + ')', [at(0.015, A(-2), 0.006), at(-0.025, A(-2), 0.006)], 0.004, { role: 'nacelle', paint: 'metal', sh: 0.85, sides: 6, ...FINE }),
    // Gull-wing hinge fairings on the roof rail.
    ...[0.26, 0.02].map((f) => poly('hinge fairing (' + side + ')', boxAt(at(f, A(80), 0.004), [0.04, 0.012, 0.01], { paint: 'frame' }), FINE)),
  ];
  // Fold-out step under the door: a ribbed plate on two arms.
  const sf = 0.14, sw = 0.11, sy = sg * 0.235, sz = -0.175;
  parts.push(poly('boarding step (' + side + ')', [
    ...boxAt([sf, sy, sz], [sw, 0.05, 0.008], { paint: 'carbon' }),
    ...range(sf - sw / 2 + 0.012, sf + sw / 2 - 0.012, 4).map((f) => quad([f - 0.004, sy - 0.022, sz + 0.0045], [f + 0.004, sy - 0.022, sz + 0.0045], [f + 0.004, sy + 0.022, sz + 0.0045], [f - 0.004, sy + 0.022, sz + 0.0045], { paint: 'rubber' })),
  ], FINE));
  for (const f of [sf - 0.035, sf + 0.035]) parts.push(tube('step arm (' + side + ')', [[f, sy - sg * 0.02, sz], at(f, A(-58), -0.002)], 0.004, { role: 'gear', paint: 'metal', sides: 5, ...FINE }));
  return parts;
};

// A box as six faces, centred at c with size [f, g, h], optionally yawed (degrees) about h.
function boxAt(c, [sf, sg, sh], extra = {}, yaw = 0) {
  const cy = Math.cos(yaw * DEG), sy = Math.sin(yaw * DEG);
  const P = (df, dg, dh) => P3([c[0] + df * cy - dg * sy, c[1] + df * sy + dg * cy, c[2] + dh]);
  const f = sf / 2, g = sg / 2, h = sh / 2;
  const v = [P(-f, -g, -h), P(f, -g, -h), P(f, g, -h), P(-f, g, -h), P(-f, -g, h), P(f, -g, h), P(f, g, h), P(-f, g, h)];
  return [
    quad(v[4], v[5], v[6], v[7], { sh: 0.86, ...extra }), quad(v[3], v[2], v[1], v[0], { sh: 0.4, ...extra }),
    quad(v[1], v[2], v[6], v[5], { sh: 0.74, ...extra }), quad(v[0], v[4], v[7], v[3], { sh: 0.55, ...extra }),
    quad(v[0], v[1], v[5], v[4], { sh: 0.62, ...extra }), quad(v[3], v[7], v[6], v[2], { sh: 0.66, ...extra }),
  ];
}
// A box tilted about g (pitch, degrees, nose up positive) at c: seat backs, screens.
function slab(c, [sf, sg, sh], pitch, extra = {}) {
  const cp = Math.cos(pitch * DEG), sp = Math.sin(pitch * DEG);
  const P = (df, dg, dh) => P3([c[0] + df * cp - dh * sp, c[1] + dg, c[2] + df * sp + dh * cp]);
  const f = sf / 2, g = sg / 2, h = sh / 2;
  const v = [P(-f, -g, -h), P(f, -g, -h), P(f, g, -h), P(-f, g, -h), P(-f, -g, h), P(f, -g, h), P(f, g, h), P(-f, g, h)];
  return [
    quad(v[4], v[5], v[6], v[7], { sh: 0.86, ...extra }), quad(v[3], v[2], v[1], v[0], { sh: 0.4, ...extra }),
    quad(v[1], v[2], v[6], v[5], { sh: 0.74, ...extra }), quad(v[0], v[4], v[7], v[3], { sh: 0.55, ...extra }),
    quad(v[0], v[1], v[5], v[4], { sh: 0.62, ...extra }), quad(v[3], v[7], v[6], v[2], { sh: 0.66, ...extra }),
  ];
}

// ── The room behind the glass ───────────────────────────────────────────────────
// Two seats side by side, a dash with two screens, and no flight controls: the "advisory" stick
// stows in the armrest. Seen through the glass from outside; the seated cockpit is still the Mini-500's.
const interior = [];
for (const g of [0.095, -0.095]) {
  interior.push(poly('seat cushion', slab([0.12, g, -0.075], [0.16, 0.13, 0.035], 4, { paint: 'seat' }), FINE));
  interior.push(poly('seat back', slab([0.025, g, 0.045], [0.035, 0.13, 0.2], -16, { paint: 'seat' }), FINE));
  interior.push(poly('headrest', slab([-0.01, g, 0.175], [0.03, 0.085, 0.055], -16, { paint: 'seat' }), FINE));
  interior.push(poly('seat bolster', [...slab([0.03, g + 0.06, 0.03], [0.04, 0.02, 0.15], -16, { paint: 'trim' }), ...slab([0.03, g - 0.06, 0.03], [0.04, 0.02, 0.15], -16, { paint: 'trim' })], FINE));
  interior.push(tube('harness', [[0.035, g + 0.045, 0.14], [0.065, g + 0.02, 0.03], [0.1, g - 0.03, -0.05]], 0.005, { role: 'nacelle', paint: 'trim', sides: 4, ...FINE }));
  interior.push(tube('armrest stick', [[0.15, g + (g > 0 ? 0.075 : -0.075), -0.04], [0.16, g + (g > 0 ? 0.075 : -0.075), 0.0]], 0.006, { role: 'nacelle', paint: 'interior', sides: 5, ...FINE }));
}
interior.push(poly('floor', [quad([0.46, -0.17, -0.1], [0.46, 0.17, -0.1], [-0.06, 0.17, -0.1], [-0.06, -0.17, -0.1], { paint: 'interior', sh: 0.45 })], FINE));
interior.push(poly('centre console', slab([0.2, 0, -0.06], [0.22, 0.04, 0.05], 0, { paint: 'interior' }), FINE));
interior.push(poly('dash', slab([0.44, 0, 0.0], [0.08, 0.32, 0.03], 32, { paint: 'interior' }), FINE));
interior.push(poly('dash screens', [
  ...slab([0.415, 0.075, 0.035], [0.006, 0.12, 0.07], 58, { paint: 'screen' }),
  ...slab([0.415, -0.075, 0.035], [0.006, 0.12, 0.07], 58, { paint: 'screen' }),
], FINE));
interior.push(poly('rear bulkhead', [quad([-0.07, -0.2, -0.1], [-0.07, 0.2, -0.1], [-0.07, 0.2, 0.22], [-0.07, -0.2, 0.22], { paint: 'interior', sh: 0.5 })], FINE));

// ── Nose and chin ───────────────────────────────────────────────────────────────
const nose = [
  // Running lights tracing the chin line each side, and a bar across under the nose.
  tube('chin light (right)', alongF([0.64, 0.61, 0.57, 0.52, 0.46, 0.41], -38, 0.006), 0.0045, { role: 'nacelle', paint: 'led', sh: 1, sides: 5, ...FINE }),
  tube('chin light (left)', alongF([0.64, 0.61, 0.57, 0.52, 0.46, 0.41], 218, 0.006), 0.0045, { role: 'nacelle', paint: 'led', sh: 1, sides: 5, ...FINE }),
  tube('nose light bar', roundF(0.62, range(-60, -120, 8), 0.006), 0.005, { role: 'nacelle', paint: 'led', sh: 1, sides: 5, caps: 1, ...FINE }),
  // The sense-and-avoid blister under the chin: lidar behind a smoked dome, two cameras either side.
  group('sensor blister', [pod('blister', 0, 0, [[0.07, 0.006], [0.06, 0.026], [0.04, 0.038], [0.0, 0.042], [-0.04, 0.036], [-0.07, 0.012]], {
    sides: 14, paint: 'carbon', regions: [{ at: [0.07, 0.06, 0.04], k: 'all', role: 'glass', tint: [24, 30, 36] }],
  })], { xf: { t: [0.5, 0, -0.152] }, ...FINE }),
  mirror('chin cameras', [
    group('camera', [pod('camera', 0, 0, [[0.02, 0.004], [0.014, 0.012], [0.0, 0.014], [-0.03, 0.013], [-0.04, 0.006]], { sides: 10, paint: 'carbon', regions: [{ at: [0.02], k: 'all', role: 'glass', tint: [20, 24, 28] }] })],
      { xf: { t: [0.57, 0.07, -0.105] }, ...FINE }),
    tube('pitot', [at(0.53, -24, 0), [0.62, 0.15, -0.035], [0.67, 0.15, -0.035]], 0.0035, { role: 'gear', paint: 'metal', sh: 0.85, sides: 5, ...FINE }),
  ]),
];

// ── Belly: battery pack, louvres, antennas ──────────────────────────────────────
const PACK = [
  [0.33, 0.04, 0.012, 0.012], [0.3, 0.09, 0.024, 0.026], [0.25, 0.12, 0.03, 0.034], [0.15, 0.135, 0.032, 0.038],
  [0.0, 0.137, 0.032, 0.039], [-0.1, 0.13, 0.03, 0.036], [-0.16, 0.105, 0.026, 0.028], [-0.19, 0.06, 0.016, 0.016], [-0.2, 0.02, 0.008, 0.008],
].map(([f, rg, rvT, rvB]) => ({ f, rg, rvT, rvB, cz: -0.188, boxy: 0.55 }));
const belly = [
  loft('battery pack', 20, PACK, { ...FINE, paint: 'carbon', capFore: { kind: 'apex', at: [0.335, 0, -0.188] }, capAft: { kind: 'apex', at: [-0.205, 0, -0.188] }, shade: { base: 0.5, amp: 0.3 } }),
  // Cooling louvres down each flank of the pack: eight slats a side.
  mirror('pack louvres', [poly('louvres', range(0.2, -0.08, 7).flatMap((f) => [
    quad([f + 0.012, 0.139, -0.18], [f - 0.012, 0.139, -0.18], [f - 0.012, 0.145, -0.2], [f + 0.012, 0.145, -0.2], { paint: 'metal', sh: 0.75 }),
    quad([f + 0.012, 0.1385, -0.2], [f - 0.012, 0.1385, -0.2], [f - 0.012, 0.1385, -0.18], [f + 0.012, 0.1385, -0.18], { paint: 'seam', sh: 0.3 }),
  ]), FINE)]),
  // Charge port door, forward on the right of the pack.
  poly('charge port', [quad([0.24, 0.128, -0.175], [0.2, 0.128, -0.175], [0.2, 0.132, -0.2], [0.24, 0.132, -0.2], { paint: 'led', sh: 0.8 })], FINE),
  // Belly trim in the livery's trim colour, wrapped up the lower flanks.
  poly('belly trim', patch([0.565, 0.515, 0.455, 0.385, 0.31, 0.23, 0.15, 0.07, -0.01, -0.08, -0.14, -0.19, -0.23], range(-150, -30, 10), { paint: 'belly' }, 0.0016), FINE),
  // A waist stripe of light from the A-pillar to the tail, the Dragonfly's one bit of show.
  tube('waist light (right)', alongF([0.33, 0.25, 0.15, 0.05, -0.05, -0.14, -0.21, -0.26], -18, 0.005), 0.004, { role: 'nacelle', paint: 'led', sh: 1, sides: 5, ...FINE }),
  tube('waist light (left)', alongF([0.33, 0.25, 0.15, 0.05, -0.05, -0.14, -0.21, -0.26], 198, 0.005), 0.004, { role: 'nacelle', paint: 'led', sh: 1, sides: 5, ...FINE }),
  // Service hatch on the pod's back, under the tail root, and the seam where the tail meets the pod.
  ...[0, 1].map((s) => tube('service hatch seam' + (s ? ' (left)' : ''), [...roundF(-0.12, range(s ? 150 : 30, s ? 110 : 70, 4), 0.0026), ...alongF([-0.15, -0.18, -0.21], s ? 110 : 70, 0.0026).slice(0), ...roundF(-0.21, range(s ? 110 : 70, s ? 150 : 30, 4), 0.0026), ...alongF([-0.18, -0.15, -0.12], s ? 150 : 30, 0.0026)], 0.0026, { role: 'nacelle', paint: 'seam', sh: 0.4, sides: 4, ...FINE })),
  { kind: 'blade', name: 'belly antenna', role: 'fin', paint: 'carbon', t: 0.003, sh: [0.7, 0.55], outline: [[-0.12, -0.215], [-0.14, -0.26], [-0.16, -0.26], [-0.17, -0.215]], ...FINE },
  { kind: 'blade', name: 'datalink blade', role: 'fin', paint: 'carbon', t: 0.003, sh: [0.7, 0.55], outline: [[0.08, -0.22], [0.075, -0.245], [0.06, -0.245], [0.045, -0.22]], ...FINE },
];

// ── The roof hub ────────────────────────────────────────────────────────────────
// A low dome the four arms grow out of, with a ring of cooling slots and a beacon on top.
const HUB = [
  [0.3, 0.03, 0.01], [0.27, 0.09, 0.025], [0.22, 0.13, 0.04], [0.15, 0.155, 0.05], [0.08, 0.162, 0.054],
  [0.0, 0.158, 0.052], [-0.07, 0.14, 0.046], [-0.12, 0.11, 0.035], [-0.15, 0.07, 0.022], [-0.165, 0.02, 0.008],
].map(([f, rg, rvT]) => ({ f, rg, rvT, rvB: 0.02, cz: 0.275, boxy: 0.3 }));
const hub = [
  loft('roof hub', 24, HUB, { ...FINE, paint: 'hull', capFore: { kind: 'apex', at: [0.305, 0, 0.275] }, capAft: { kind: 'apex', at: [-0.17, 0, 0.275] } }),
  poly('hub cooling slots', range(0, 330, 11).flatMap((d) => {
    const a = d * DEG, r0 = 0.1, r1 = 0.125, c = [0.07, 0, 0.322];
    const p = (r, da) => [c[0] + Math.cos(a + da) * r, c[1] + Math.sin(a + da) * r, c[2] + 0.004 - r * 0.12];
    return [quad(p(r0, -0.06), p(r1, -0.05), p(r1, 0.05), p(r0, 0.06), { paint: 'seam', sh: 0.3 })];
  }), FINE),
  { kind: 'drum', name: 'beacon base', f: 0.07, r: 0.022, n: 12, z: [0.326, 0.336], role: 'nacelle', paint: 'carbon', sh: { base: 0.55, alt: 0.1 }, top: { sh: 0.8 }, ...FINE },
  { kind: 'drum', name: 'beacon', f: 0.07, r: 0.014, n: 12, z: [0.336, 0.352], role: 'nacelle', paint: 'beacon', sh: { base: 0.9 }, top: { sh: 1 }, ...FINE },
  { kind: 'blade', name: 'GNSS mast', role: 'fin', paint: 'carbon', t: 0.003, sh: [0.75, 0.6], outline: [[-0.08, 0.31], [-0.1, 0.36], [-0.115, 0.36], [-0.125, 0.31]], ...FINE },
];

// ── Arms, motors and rotors ─────────────────────────────────────────────────────
// Each arm is a loft along its own length, yawed out to its tip. Root flares into the hub; the
// section is a flattened lozenge with a lit strip on top and a cable run underneath.
const TIPS = [{ f: 0.5, g: 0.6, name: 'fore' }, { f: -0.42, g: 0.6, name: 'aft' }];
const ROOTS = { fore: [0.17, 0.08], aft: [-0.08, 0.08] };
const ARM_H = 0.3, RZ_UP = 0.355, RZ_LO = 0.245, RR = 0.3;
function arm(tip) {
  const [rf, rgg] = ROOTS[tip.name];
  const df = tip.f - rf, dg = tip.g - rgg, L = Math.hypot(df, dg), yaw = Math.atan2(dg, df) / DEG;
  const sts = [
    [0, 0.058, 0.036, 0.027, -0.006], [0.04, 0.05, 0.03, 0.024, -0.003], [0.09, 0.045, 0.026, 0.021, 0],
    [0.16, 0.036, 0.021, 0.018, 0], [0.26, 0.031, 0.019, 0.016, 0], [0.36, 0.028, 0.018, 0.015, 0],
    [L - 0.1, 0.026, 0.017, 0.014, 0], [L - 0.04, 0.027, 0.019, 0.016, 0], [L, 0.024, 0.016, 0.014, 0],
  ].map(([f, rg, rvT, rvB, cz]) => ({ f, rg, rvT, rvB, cz, boxy: 0.35 })).reverse();   // a loft runs fore to aft: tip first
  const parts = [
    loft(tip.name + ' arm', 16, sts, { paint: 'carbon', capAft: { kind: 'flat', sh: 0.5 }, shade: { base: 0.55, amp: 0.3 } }),
    tube(tip.name + ' arm light', [[0.1, 0, 0.022], [L - 0.06, 0, 0.0185]], 0.0035, { role: 'nacelle', paint: 'led', sh: 1, sides: 5 }),
    tube(tip.name + ' cable run', [[0.06, 0, -0.022], [L - 0.05, 0, -0.016]], 0.006, { role: 'gear', paint: 'seam', sides: 6 }),
    // Clamp bands where the arm meets the nacelle and halfway out.
    ...[0.32, L - 0.07].map((f) => pod(tip.name + ' clamp', 0, 0, [[f + 0.008, 0.03], [f - 0.008, 0.03]], { sides: 12, paint: 'metal', shade: { base: 0.7, amp: 0.2 } })),
  ];
  return group(tip.name + ' arm', parts, { xf: { r: [0, 0, R(yaw, 3)], t: [rf, rgg, ARM_H] }, ...FINE });
}
// A motor nacelle at a tip: stacked drums, a finned can top and bottom, a spinner dome on each.
function nacelle(tip) {
  const D = (name, r, z0, z1, paint, sh = { base: 0.62, alt: 0.12 }, extra = {}) =>
    ({ kind: 'drum', name: tip.name + ' ' + name, f: tip.f, g: tip.g, r, n: 18, z: [R(z0), R(z1)], role: 'nacelle', paint, sh, ...extra, ...FINE });
  const parts = [
    D('arm boss', 0.04, ARM_H - 0.024, ARM_H + 0.024, 'carbon', { base: 0.55, alt: 0.08 }),
    D('upper motor', 0.046, RZ_UP - 0.042, RZ_UP - 0.006, 'metal', { base: 0.66, alt: 0.14 }, { top: { sh: 0.85 } }),
    D('lower motor', 0.046, RZ_LO + 0.006, RZ_LO + 0.042, 'metal', { base: 0.66, alt: 0.14 }, { bottom: { sh: 0.35 } }),
    D('upper spinner', 0.03, RZ_UP - 0.006, RZ_UP + 0.008, 'hull', { base: 0.8 }, { top: { sh: 0.95 } }),
    D('upper spinner cap', 0.016, RZ_UP + 0.008, RZ_UP + 0.016, 'hull', { base: 0.85 }, { top: { sh: 1 } }),
    D('lower spinner', 0.03, RZ_LO - 0.008, RZ_LO + 0.006, 'hull', { base: 0.55 }, { bottom: { sh: 0.35 } }),
    D('lower spinner cap', 0.016, RZ_LO - 0.016, RZ_LO - 0.008, 'hull', { base: 0.5 }, { bottom: { sh: 0.3 } }),
  ];
  // Cooling fins: thin rings proud of each motor can.
  for (const zc of [RZ_UP - 0.034, RZ_UP - 0.026, RZ_UP - 0.018, RZ_LO + 0.018, RZ_LO + 0.026, RZ_LO + 0.034]) {
    parts.push(D('cooling fin', 0.051, zc - 0.002, zc + 0.002, 'metal', { base: 0.8 }, { top: { sh: 0.9 }, bottom: { sh: 0.4 } }));
  }
  // Blade roots: stubs either side of each hub, where the rotor's drawn blades start.
  for (const [z, ph] of [[RZ_UP + 0.002, 0.3], [RZ_LO - 0.002, 1.2]]) {
    for (const s of [1, -1]) {
      const a = ph + (s > 0 ? 0 : Math.PI), c = Math.cos(a), sn = Math.sin(a);
      parts.push(tube(tip.name + ' blade root', [[tip.f + c * 0.03, tip.g + sn * 0.03, z], [tip.f + c * 0.06, tip.g + sn * 0.06, z]], 0.007, { role: 'nacelle', paint: 'carbon', sides: 5, ...FINE }));
    }
  }
  return parts;
}
const rotorDiscs = TIPS.flatMap((t) => [RZ_UP, RZ_LO].map((h) => ({
  kind: 'ngon', name: t.name + ' rotor disc', f: t.f, g: t.g, h, n: 12, r: RR, role: 'rotor', sh: 0.65,
  note: 'Schematic only: painted renderers draw the blades from `rotors`.',
})));
const armsAndRotors = mirror('arms, motors and rotors', [...TIPS.map(arm), ...TIPS.flatMap(nacelle), ...rotorDiscs]);

// ── The tail ────────────────────────────────────────────────────────────────────
// Three segments that taper and pinch at each joint; the joints are lit. A small stabiliser pair,
// a fin above, a strobe at the tip.
const TAIL = [];
{
  const segs = [[-0.24, -0.45, 0.074, 0.058], [-0.455, -0.64, 0.054, 0.042], [-0.645, -0.82, 0.04, 0.03], [-0.825, -0.93, 0.028, 0.012]];
  const cz = (f) => 0.08 + (-0.24 - f) * 0.09;
  for (const [f0, f1, r0, r1] of segs) {
    for (const t of [0, 0.15, 0.4, 0.7, 0.92, 1]) {
      const f = lerp(f0, f1, t), bulge = Math.sin(Math.PI * Math.min(1, t * 1.1)) * 0.12;
      const r = lerp(r0, r1, t) * (1 + bulge) * (t === 1 ? 0.86 : 1);
      TAIL.push({ f, rg: r, rvT: r * 1.06, rvB: r * 0.96, cz: cz(f), boxy: 0.08 });
    }
  }
}
const tailRegions = [];
for (let i = 0; i < TAIL.length - 1; i++) if (TAIL[i + 1].f - TAIL[i].f > -0.006 && TAIL[i + 1].f - TAIL[i].f < 0) tailRegions.push(R(TAIL[i].f));
const tailTip = TAIL[TAIL.length - 1];
const tail = [
  loft('tail', 18, TAIL, {
    ...FINE, paint: 'hull', regions: [{ at: tailRegions, k: 'all', paint: 'led' }],
    capAft: { kind: 'apex', at: P3([tailTip.f - 0.025, 0, tailTip.cz]), paint: 'trim' }, shade: { base: 0.6, amp: 0.36, mul: 0.94 },
  }),
  { kind: 'blade', name: 'tail fin', paint: 'trim', role: 'fin', t: 0.006, sh: [0.92, 0.72], ...FINE,
    outline: [[-0.7, 0.115], [-0.82, 0.25], [-0.875, 0.26], [-0.885, 0.24], [-0.86, 0.12]], edges: [{ a: 1, b: 2, sh: 0.85 }, { a: 2, b: 3, sh: 0.8 }] },
  { kind: 'blade', name: 'ventral fin', paint: 'trim', role: 'fin', t: 0.005, sh: [0.88, 0.68], ...FINE,
    outline: [[-0.74, 0.08], [-0.84, 0.03], [-0.87, 0.035], [-0.86, 0.085]] },
  mirror('stabilisers', [{ kind: 'panel', name: 'stabiliser', role: 'fin', sh: 0.85, th: 0.008, paint: 'trim', ...FINE,
    c: [[-0.735, 0.03, 0.135], [-0.79, 0.15, 0.16], [-0.83, 0.15, 0.16], [-0.81, 0.03, 0.128]] },
  { kind: 'drum', name: 'stabiliser tip light', f: -0.81, g: 0.153, r: 0.007, n: 8, z: [0.152, 0.168], role: 'nacelle', paint: 'led', sh: { base: 1 }, top: { sh: 1 }, ...FINE }]),
  tube('tail strobe', [[tailTip.f - 0.02, 0, tailTip.cz], [tailTip.f - 0.045, 0, tailTip.cz + 0.004]], 0.006, { role: 'nacelle', paint: 'strobe', sh: 1, sides: 6, caps: 1, ...FINE }),
];

// ── Skids ───────────────────────────────────────────────────────────────────────
// Two faired rails, toes curled up, on swept legs with fairings; rubber pads and tie-down rings.
const GZ = -0.285, SG = 0.26;
const RAIL = [
  [0.47, 0.006, 0.04], [0.46, 0.012, 0.03], [0.44, 0.015, 0.014], [0.41, 0.016, 0.003], [0.36, 0.016, 0], [0.1, 0.016, 0],
  [-0.15, 0.016, 0], [-0.22, 0.015, 0.002], [-0.25, 0.01, 0.008], [-0.26, 0.004, 0.012],
].map(([f, r, dz]) => ({ f, rg: r * 1.25, rvT: r, rvB: r, cz: GZ + dz, boxy: 0.25 }));
const skids = mirror('skids', [
  group('skid rail', [loft('rail', 12, RAIL, { paint: 'carbon', capFore: { kind: 'apex', at: [0.475, 0, GZ + 0.046] }, capAft: { kind: 'apex', at: [-0.263, 0, GZ + 0.014] }, shade: { base: 0.55, amp: 0.3 } })],
    { xf: { t: [0, SG, 0] }, ...FINE }),
  ...[[0.3, 0.33], [-0.09, -0.07]].map(([fb, ft], i) => ({ kind: 'faired', name: (i ? 'rear' : 'front') + ' leg', pts: P3s([[fb, SG, GZ + 0.012], [ft, 0.19, -0.12], [ft - 0.005, 0.13, -0.095]]), chord: 0.05, th: 0.018, role: 'strut', sh: 0.62, paint: 'carbon', ...FINE })),
  ...[[0.3, 0.33], [-0.09, -0.07]].map(([fb], i) => group('leg shoe', [pod('shoe', 0, 0, [[0.03, 0.012], [0.015, 0.022], [-0.015, 0.022], [-0.03, 0.012]], { sides: 10, paint: 'metal', shade: { base: 0.7, amp: 0.2 } })], { xf: { t: [fb, SG, GZ + 0.012] }, ...FINE })),
  poly('skid pads', [0.32, 0.12, -0.08, -0.2].flatMap((f) => boxAt([f, SG, GZ - 0.018], [0.05, 0.03, 0.01], { paint: 'rubber' })), FINE),
  ...[0.38, -0.2].map((f) => tube('tie-down ring', range(0, 360, 8).map((d) => [f + Math.cos(d * DEG) * 0.012, SG + 0.022, GZ + 0.01 + Math.sin(d * DEG) * 0.012]), 0.0025, { role: 'gear', paint: 'metal', sides: 4, ...FINE })),
  tube('skid light', [[0.42, SG + 0.018, GZ + 0.006], [0.36, SG + 0.02, GZ + 0.004]], 0.004, { role: 'nacelle', paint: 'led', sh: 1, sides: 5, ...FINE }),
]);
function P3s(a) { return a.map(P3); }

// ── The coarse body, for range ──────────────────────────────────────────────────
const coarse = [
  { kind: 'loft', name: 'cabin pod (far)', role: 'body', section: 'ellipse', sides: 14, paint: 'hull', ...COARSE,
    stations: [[0.64, 0.07, 0.08, 0.04], [0.54, 0.15, 0.16, 0.035], [0.38, 0.215, 0.22, 0.03], [0.18, 0.235, 0.235, 0.035], [-0.02, 0.215, 0.22, 0.045], [-0.18, 0.15, 0.16, 0.06], [-0.28, 0.075, 0.085, 0.075]].map(([f, rg, rv, cz]) => ({ f, rg, rv, cz })),
    capFore: { kind: 'apex', at: [0.7, 0, 0.045], role: 'glass', tint: GLASS }, capAft: { kind: 'flat' },
    regions: [{ at: [0.64], k: 'all', role: 'glass', tint: GLASS }, { at: [0.54], k: [0, 1, 2, 3, 4, 5, 6, 7, 13], role: 'glass', tint: GLASS }, { at: [0.38], k: [0, 1, 2, 3, 4, 5, 6], role: 'glass', tint: GLASS }, { at: [0.18], k: [0, 1, 5, 6], role: 'glass', tint: GLASS }, { at: [0.54, 0.38, 0.18, -0.02, -0.18], k: [8, 9, 10, 11, 12], paint: 'belly' }] },
  { kind: 'loft', name: 'tail (far)', role: 'body', section: 'ellipse', sides: 8, paint: 'hull', ...COARSE,
    stations: [[-0.22, 0.06, 0.085], [-0.45, 0.045, 0.1], [-0.66, 0.035, 0.116], [-0.88, 0.016, 0.13]].map(([f, r, cz]) => ({ f, rg: r, rv: r, cz })), capAft: { kind: 'apex', at: [-0.92, 0, 0.133] } },
  { kind: 'blade', name: 'tail fin (far)', paint: 'trim', role: 'fin', t: 0.008, sh: [0.92, 0.72], outline: [[-0.7, 0.13], [-0.84, 0.27], [-0.9, 0.27], [-0.86, 0.13]], ...COARSE },
  { kind: 'drum', name: 'roof hub (far)', f: 0.07, r: 0.13, n: 10, z: [0.24, 0.31], role: 'nacelle', paint: 'hull', sh: { base: 0.6, alt: 0.1 }, top: { sh: 0.85 }, ...COARSE },
  mirror('arms (far)', TIPS.flatMap((t) => [
    { kind: 'faired', name: t.name + ' arm (far)', pts: P3s([[ROOTS[t.name][0], ROOTS[t.name][1], ARM_H], [t.f, t.g, ARM_H]]), chord: 0.07, th: 0.03, role: 'strut', sh: 0.7, paint: 'carbon', ...COARSE },
    { kind: 'drum', name: t.name + ' motor (far)', f: t.f, g: t.g, r: 0.045, n: 8, z: [RZ_LO - 0.01, RZ_UP + 0.01], role: 'nacelle', paint: 'metal', sh: { base: 0.62, alt: 0.14 }, top: { sh: 0.9 }, bottom: { sh: 0.4 }, ...COARSE },
  ])),
  mirror('skids (far)', [
    tube('skid rail (far)', [[0.44, SG, GZ + 0.03], [0.4, SG, GZ], [-0.22, SG, GZ]], 0.016, { role: 'gear', paint: 'carbon', sides: 6, ...COARSE }),
    ...[[0.3, 0.33], [-0.09, -0.07]].map(([fb, ft]) => tube('leg (far)', [[fb, SG, GZ], [ft, 0.13, -0.1]], 0.012, { role: 'strut', paint: 'carbon', sides: 6, ...COARSE })),
  ]),
];

// ── Rotors and lamps ────────────────────────────────────────────────────────────
// Eight rotors. Diagonal neighbours turn the same way and adjacent ones opposite, and the lower of
// each pair counter-rotates the upper, as a real coaxial multicopter's do.
const rotors = [];
for (const t of TIPS) for (const s of [1, -1]) for (const [h, d] of [[RZ_UP, 1], [RZ_LO, -1]]) {
  const r = { at: [t.f, R(s * t.g), h], plane: 'h', r: RR, blades: 2, lead: 0.8, spinMul: 1.8, phase: R((t.f + s * t.g + h) * 2.3) };
  if (d * s * (t.f > 0 ? 1 : -1) < 0) r.dir = -1;
  rotors.push(r);
}
const lamps = [
  { at: [0.5, -0.6 - 0.052, ARM_H], n: [0, -1, 0], rgb: '255,55,55', kind: 'steady' },
  { at: [0.5, 0.6 + 0.052, ARM_H], n: [0, 1, 0], rgb: '60,255,95', kind: 'steady' },
  { at: [tailTip.f - 0.05, 0, tailTip.cz + 0.004], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [0.07, 0, 0.356], n: [0, 0, 1], rgb: '255,90,70', kind: 'beacon' },
  { at: [0.05, 0, -0.228], n: [0, 0, -1], rgb: '255,90,70', kind: 'beacon' },
];

const doc = {
  id: 'heli_2076',
  kind: 'mesh',
  params: {
    name: 'Dragonfly 2076',
    note: 'CONCEPT, generated by scripts/shapes/concepts/dragonfly-2076.mjs (edit that, not this). The Dragonfly fifty years on, after the EHang EH216-S: a two-seat pod with a bubble windscreen, gull-wing doors and a skylight, no main rotor, four carbon arms in an X off a roof hub each carrying a finned coaxial motor pair (eight rotors), a louvred battery pack under the floor, a segmented tail kept only for the name, and faired skids. A variant of the heli mesh, worn as the Dragonfly 2076 factory edition.',
    groundPitch: 0,
    navLamps: null,
    lamps,
    rotors,
    finish: 'gloss',
    paints: {
      hull: { rgb: [226, 230, 226], livery: 'base', mat: 'pearl' },
      trim: { rgb: [31, 122, 110], livery: 'trim' },
      belly: { rgb: [31, 122, 110], livery: 'trim' },
      frame: { rgb: [28, 34, 36], livery: 'fixed', mat: 'gloss' },
      seam: { rgb: [52, 58, 60], livery: 'fixed', mat: 'matte' },
      carbon: { rgb: [36, 40, 44], livery: 'fixed', mat: 'satin' },
      metal: { rgb: [150, 154, 160], livery: 'fixed', mat: 'bare' },
      rubber: { rgb: [30, 30, 30], livery: 'fixed', mat: 'rubber' },
      led: { rgb: [120, 236, 214], livery: 'fixed', mat: 'matte' },
      beacon: { rgb: [235, 70, 56], livery: 'fixed', mat: 'gloss' },
      strobe: { rgb: [240, 244, 248], livery: 'fixed', mat: 'gloss' },
      interior: { rgb: [38, 44, 46], livery: 'fixed', mat: 'matte' },
      seat: { rgb: [58, 66, 68], livery: 'fixed', mat: 'satin' },
      screen: { rgb: [70, 190, 200], livery: 'fixed', mat: 'gloss' },
    },
    parts: [
      cabin, windscreen, mirror('door glass', [doorGlass, quarter]), skylight, ...frames,
      ...door(0), ...door(1), ...interior, ...nose, ...belly, ...hub, armsAndRotors, ...tail, skids,
      ...coarse,
    ],
  },
};

const v = validateMesh(doc.params, doc.id);
if (v.errors.length) { console.log('ERRORS', v.errors.slice(0, 12)); process.exit(1); }
if (v.warnings?.length) console.log('warnings', v.warnings.slice(0, 8));
const n1 = compileMesh(doc.params, { detail: 1 }).faces.length, n0 = compileMesh(doc.params, { detail: 0 }).faces.length;
writeFileSync(new URL('../../../content/vehicle_models/mesh_heli_2076.json', import.meta.url), formatMesh(doc));
console.log('mesh_heli_2076.json:', n1, 'faces near,', n0, 'far');
