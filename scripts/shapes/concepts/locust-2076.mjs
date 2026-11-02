// The LOCUST 2076 concept: writes content/vehicle_models/mesh_locust_2076.json.
//
//   node scripts/shapes/concepts/locust-2076.mjs
//   then: npm run vehicles:bake
//
// The Locust fifty years on. The ancestor is the Air Tractor AT-802 (the stock mesh); the bridge is
// the Pyka Pelican Spray, an autonomous electric crop sprayer, and the DJI Agras spray drones that
// work a field in swarms. The 2076 aircraft is both: an electric hopper mothership. It keeps the
// AT-802's slab sides, its big chemical hopper, its tall glass cockpit set high behind the hopper for
// seeing the ground in a turn, its spring gear on fat tyres and its wire-strike kit. The PT6 and its
// exhaust stacks are gone: a big slow six-blade prop on an electric motor, with cooling inlets where
// the stacks were. Under the belly, where the PT6's fuel was, a battery pack in a ventilated fairing.
// And it carries ten quad-rotor spray drones docked in lit cradles along the top of the wing, five a
// side, which lift out while she sprays and fly in a line off each wingtip to work the edges of the
// swath (the `spray` channel; see the drones below).
//
// The label plate on each flank of the hopper is blank.
//
// A variant of the locust mesh (mesh_locust.json `variants`, written by fw-meshes/locust.mjs), worn
// as the LOCUST 2076 factory edition. Same frame and scale as the stock body: spinner apex at f 1.126,
// the main wheels touching at h -0.253 and the tail wheel at -0.059, so she sits at the stock
// `groundPitch` and the flight view frames her the same way.
//
// ⚠ THIS OVERWRITES THE JSON. Edit this file, not the mesh in the Modelshop.
//
// Two bodies in one file. Everything fine is `minDetail: 1`; a coarse body with `maxDetail: 0` stands
// in at range. The wing and tail come from lib.mjs's `foil`, which carries its own far body.
//
// Frame: f fore, g right, h up. Angles on a section are lib.mjs's: 0 = right waterline, +90 = crown.
import { writeFileSync } from 'node:fs';
import { R, P3, loft, pod, foil, ctrlOn, tube, mirror, group, poly as rawPoly, quad, cone, wheel, faired, DEG, foilPt, lerpSt } from '../fw-meshes/lib.mjs';
const { formatMesh, validateMesh, compileMesh } = await import('../../../client/shared/vehicle-mesh.js');
const { LC_STATIONS, LC_APEX_AFT, LC_GLASS, LC_DOOR, LC_DRONES, lcPoint } = await import('../../../client/shared/cabin-locust-2076.js');

const FINE = { minDetail: 1 }, COARSE = { maxDetail: 0 };
// Every poly face needs a role; trim and fittings are 'nacelle' unless they say otherwise.
const poly = (name, faces, extra) => rawPoly(name, faces.map((f) => ({ role: 'nacelle', ...f })), extra);
const GLASS = [58, 92, 108];
const lerp = (a, b, t) => a + (b - a) * t;
const range = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));
const at = (f, a, o = 0) => lcPoint(f, a, o);

// A curved patch of skin as a grid of quads, `o` proud of the hull. `fs` runs fore to aft.
function patch(fs, as, extra, o = 0.0022) {
  const out = [];
  for (let i = 0; i < fs.length - 1; i++) for (let j = 0; j < as.length - 1; j++) {
    out.push(quad(at(fs[i + 1], as[j], o), at(fs[i], as[j], o), at(fs[i], as[j + 1], o), at(fs[i + 1], as[j + 1], o), extra));
  }
  return out;
}
const alongF = (fs, a, o = 0.004) => fs.map((f) => at(f, a, o));
const roundF = (f, as, o = 0.004) => as.map((a) => at(f, a, o));
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
// A box tilted about g (pitch, degrees, nose up positive) at c: the seat back, the panel.
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
const D = (name, f, g, r, z0, z1, paint, extra = {}) => ({ kind: 'drum', name, f: R(f), ...(g ? { g: R(g) } : {}), r: R(r), n: extra.n ?? 10, z: [R(z0), R(z1)], role: extra.role || 'nacelle', paint, sh: extra.sh || { base: 0.62, alt: 0.1 }, ...(extra.top ? { top: extra.top } : {}), ...(extra.bottom ? { bottom: extra.bottom } : {}), ...(extra.fine === false ? {} : FINE) });

// The wing (stock frame): low, straight, constant chord.
const W = [
  { g: 0, le: 0.3, te: -0.22, h: -0.09, t: 1.15 },
  { g: 1.1, le: 0.3, te: -0.22, h: -0.058, t: 0.9 },
  { g: 1.14, le: 0.285, te: -0.2, h: -0.056, t: 0.6 },
];
const onWing = (g) => lerpSt(W[0], W[1], g / W[1].g);
// A point on the wing's top skin: span station g, chord fraction x from the leading edge.
const wingTop = (g, x) => { const q = foilPt(onWing(g), x, 1); return [q[0], g, q[2]]; };

// ── The fuselage ────────────────────────────────────────────────────────────────
// Stated once in client/shared/cabin-locust-2076.js: motor nacelle, slab hopper, tall cockpit, cone.
const S = LC_STATIONS;
const fuselage = loft('fuselage', 32, S, {
  ...FINE, paint: 'hull',
  note: 'The shell. Glass, frames, the hopper lid, the hazard bands and the seams are separate parts laid a hair proud of it.',
  capFore: { kind: 'flat', paint: 'motor', sh: 0.45 },
  capAft: { kind: 'apex', at: LC_APEX_AFT, paint: 'trim' },
  shade: { base: 0.6, amp: 0.34 },
});
const fuselageFar = loft('fuselage (far)', 12, S.filter((s, i) => i % 2 === 0 || i === S.length - 1), {
  ...COARSE, paint: 'hull', capFore: { kind: 'flat', paint: 'motor', sh: 0.45 }, capAft: { kind: 'apex', at: LC_APEX_AFT, paint: 'trim' },
});

// ── The glass ───────────────────────────────────────────────────────────────────
const G = LC_GLASS;
const WS_F = [G.windscreen.f[1], 0.372, 0.36, 0.345, 0.33, 0.315, 0.3, 0.285, G.windscreen.f[0]];
const windscreen = poly('windscreen', patch(WS_F, range(G.windscreen.a[0], G.windscreen.a[1], 18), { role: 'glass', tint: GLASS }), FINE);
const SD_F = range(G.side.f[1], G.side.f[0], 6);
const sideGlass = poly('side glass (right)', patch(SD_F, range(G.side.a[0], G.side.a[1], 8), { role: 'glass', tint: GLASS }), FINE);
const QW_F = range(G.quarter.f[1], G.quarter.f[0], 2);
const quarter = poly('quarter light (right)', patch(QW_F, range(G.quarter.a[0], G.quarter.a[1], 4), { role: 'glass', tint: GLASS }), FINE);
const RF_F = range(G.roof.f[1], G.roof.f[0], 4);
const roofGlass = poly('roof light', patch(RF_F, range(G.roof.a[0], G.roof.a[1], 2), { role: 'glass', tint: GLASS }), FINE);
const glassFar = poly('glass (far)', [
  ...patch([G.windscreen.f[1], 0.32, G.windscreen.f[0]], range(G.windscreen.a[0], G.windscreen.a[1], 4), { role: 'glass', tint: GLASS }, 0.003),
  ...patch([G.side.f[1], G.side.f[0]], [G.side.a[0], G.side.a[1]], { role: 'glass', tint: GLASS }, 0.003),
  ...patch([G.side.f[1], G.side.f[0]], [180 - G.side.a[1], 180 - G.side.a[0]], { role: 'glass', tint: GLASS }, 0.003),
], COARSE);

// Frames: pillars, header, sills and roof rails, dark, standing just proud of the glass, with a
// black rubber seal along every pane's edge.
const FR = (name, pts, r = 0.004) => tube(name, pts, r, { role: 'nacelle', paint: 'frame', sh: 0.5, sides: 5, ...FINE });
const SEAL = (name, pts) => tube(name, pts, 0.0022, { role: 'nacelle', paint: 'rubber', sh: 0.35, sides: 4, ...FINE });
const frames = [
  FR('windscreen bow', roundF(G.windscreen.f[1] + 0.002, range(G.windscreen.a[0] - 4, G.windscreen.a[1] + 4, 18)), 0.0045),
  FR('A-pillar arch', roundF(0.266, range(8, 172, 22)), 0.0055),
  FR('roof header', roundF(0.254, range(80, 100, 4)), 0.0045),
  FR('B-pillar arch', roundF(0.048, range(8, 172, 22)), 0.005),
  FR('C-ring', roundF(-0.058, range(26, 154, 14)), 0.004),
  SEAL('windscreen seal', roundF(G.windscreen.f[0] + 0.004, range(G.windscreen.a[0], G.windscreen.a[1], 18), 0.003)),
  ...[0, 1].flatMap((s) => {
    const A = (a) => (s ? 180 - a : a), side = s ? 'left' : 'right';
    return [
      FR('windscreen sill (' + side + ')', alongF(WS_F, A(G.windscreen.a[0] - 1))),
      FR('side sill (' + side + ')', alongF(SD_F, A(G.side.a[0] - 1)), 0.0045),
      FR('roof rail (' + side + ')', alongF([0.266, 0.2, 0.13, 0.06, 0.0, -0.06], A(80)), 0.0045),
      FR('side mullion (' + side + ')', roundF(0.16, range(A(G.side.a[0]), A(G.side.a[1]), 6)), 0.0032),
      SEAL('side seal (' + side + ')', [...alongF(SD_F, A(G.side.a[1] - 1), 0.003), ...roundF(G.side.f[0] + 0.003, range(A(G.side.a[1]), A(G.side.a[0]), 5), 0.003)]),
      FR('quarter light frame (' + side + ')', [...roundF(G.quarter.f[1], range(A(G.quarter.a[0]), A(G.quarter.a[1]), 4)), ...alongF(QW_F, A(G.quarter.a[1])).slice(1), ...roundF(G.quarter.f[0], range(A(G.quarter.a[1]), A(G.quarter.a[0]), 4)).slice(1), ...alongF([...QW_F].reverse(), A(G.quarter.a[0])).slice(1)], 0.0032),
    ];
  }),
];

// The door, on the left: a seam round it, a handle, two hinges, and a kick step under it.
const door = (() => {
  const A = (a) => 180 - a, seam = (name, pts) => tube(name, pts, 0.0022, { role: 'nacelle', paint: 'seam', sh: 0.4, sides: 4, ...FINE });
  return [
    seam('door fore seam', roundF(LC_DOOR.f[1], range(A(LC_DOOR.aLo), A(LC_DOOR.aHi), 12), 0.0024)),
    seam('door aft seam', roundF(LC_DOOR.f[0], range(A(LC_DOOR.aLo), A(LC_DOOR.aHi), 12), 0.0024)),
    seam('door bottom seam', alongF(range(LC_DOOR.f[1], LC_DOOR.f[0], 8), A(LC_DOOR.aLo), 0.0024)),
    tube('door handle', [at(0.08, A(4), 0.006), at(0.11, A(4), 0.006)], 0.0032, { role: 'nacelle', paint: 'metal', sh: 0.85, sides: 6, ...FINE }),
    ...[0.21, 0.09].map((f) => poly('door hinge', boxAt(at(f, A(82), 0.003), [0.022, 0.008, 0.006], { paint: 'frame' }), FINE)),
    poly('kick step', boxAt([0.16, -0.112, -0.09], [0.03, 0.024, 0.005], { paint: 'rubber' }), FINE),
    tube('kick step arm', [[0.16, -0.1, -0.09], at(0.16, A(-48), -0.002)], 0.003, { role: 'gear', paint: 'metal', sides: 5, ...FINE }),
  ];
})();

// ── The room behind the glass, as seen from outside ─────────────────────────────
// The cockpit's big shapes, where interior-locust-2076.js puts them (its metres over 5.16 a unit, the
// eye at f 0.13, h 0.139): the seat, the swept deck with its lit band of glass leaning away from the
// pilot, the two side consoles with the throttle and the stick, and the floor.
const interior = [
  poly('seat cushion', slab([0.105, 0, -0.003], [0.09, 0.09, 0.016], 4, { paint: 'seat' }), FINE),
  poly('seat back', slab([0.052, 0, 0.058], [0.016, 0.09, 0.118], -12, { paint: 'seat' }), FINE),
  poly('headrest', slab([0.035, 0, 0.135], [0.014, 0.046, 0.034], -12, { paint: 'seat' }), FINE),
  poly('deck', slab([0.29, 0, 0.098], [0.075, 0.166, 0.034], 4, { paint: 'interior' }), FINE),
  poly('deck band', slab([0.256, 0, 0.093], [0.003, 0.166, 0.046], -22, { paint: 'screen' }), FINE),
  ...[1, -1].map((s) => poly('console', slab([0.155, s * 0.064, -0.009], [0.13, 0.024, 0.09], 0, { paint: 'interior' }), FINE)),
  poly('floor', [quad([0.39, -0.08, -0.054], [0.39, 0.08, -0.054], [-0.04, 0.08, -0.054], [-0.04, -0.08, -0.054], { paint: 'interior', sh: 0.45 })], FINE),
  tube('sidestick', [[0.15, 0.064, 0.036], [0.155, 0.064, 0.066]], 0.004, { role: 'nacelle', paint: 'interior', sides: 5, ...FINE }),
  tube('throttle', [[0.153, -0.064, 0.036], [0.163, -0.064, 0.062]], 0.003, { role: 'nacelle', paint: 'metal', sides: 5, ...FINE }),
];

// ── The motor nacelle: spinner, cooling, the charge port ────────────────────────
// The PT6's exhaust stacks are gone. In their place two cheek inlets feed the motor's cooling, a
// chin scoop feeds the inverter, and louvres down each flank let the warm air out.
const nose = [
  cone('spinner', 1.0, 0, 0.02, 0.05, [1.126, 0, 0.02], { paint: 'spinner', n: 16 }),
  pod('spinner back plate', 0, 0.02, [[1.004, 0.052], [0.996, 0.054]], { sides: 16, paint: 'metal', shade: { base: 0.7, amp: 0.2 } }),
  // The LED ring round the spinner's root: the motor's state at a glance from the ground crew.
  pod('motor light ring', 0, 0.02, [[0.992, 0.0505], [0.986, 0.0505]], { sides: 16, paint: 'led', shade: { base: 1, amp: 0 } }),
  // Motor case bands and its bolt circle.
  ...[0.965, 0.9, 0.82, 0.73].map((f) => poly('motor case band', patch([f + 0.004, f - 0.004], range(-180, 180, 32), { paint: 'seam', sh: 0.45 }, 0.0016), FINE)),
  poly('motor bolt circle', range(0, 330, 11).flatMap((d) => boxAt([0.975, Math.cos(d * DEG) * 0.059, 0.02 + Math.sin(d * DEG) * 0.059], [0.004, 0.006, 0.006], { paint: 'metal' })), FINE),
  // Cheek inlets, each side: a pod with a dark mouth and a splitter vane.
  mirror('cheek inlets', [
    group('cheek inlet', [pod('inlet', 0, 0, [[0.93, 0.012, 0, 0.008], [0.91, 0.022, 0, 0.014], [0.85, 0.024, 0, 0.016], [0.79, 0.016, 0, 0.01], [0.76, 0.004, 0, 0.003]], {
      sides: 10, paint: 'hull', capFore: { kind: 'flat', paint: 'intake', sh: 0.12 }, shade: { base: 0.62, amp: 0.3 } })], { xf: { t: [0, 0.074, 0.008] }, ...FINE }),
    tube('inlet splitter', [[0.93, 0.074, 0.0], [0.93, 0.074, 0.016]], 0.0018, { role: 'nacelle', paint: 'metal', sides: 4, ...FINE }),
    // Exhaust louvres aft of the inlet: eight slats, each a lip over a dark slot.
    poly('motor louvres', range(0.745, 0.67, 7).flatMap((f) => [
      quad(at(f + 0.006, 12, 0.006), at(f - 0.006, 12, 0.006), at(f - 0.006, -12, 0.0025), at(f + 0.006, -12, 0.0025), { paint: 'metal', sh: 0.78 }),
      quad(at(f + 0.006, -12, 0.0015), at(f - 0.006, -12, 0.0015), at(f - 0.006, 12, 0.0015), at(f + 0.006, 12, 0.0015), { paint: 'intake', sh: 0.25 }),
    ]), FINE),
  ]),
  // The chin scoop: the inverter's air, with a mesh grille.
  group('chin scoop', [pod('scoop', 0, 0, [[0.95, 0.008, 0, 0.02], [0.93, 0.016, 0, 0.034], [0.86, 0.018, 0, 0.038], [0.8, 0.01, 0.006, 0.024], [0.77, 0.003, 0.01, 0.008]], {
    sides: 10, paint: 'glare', capFore: { kind: 'flat', paint: 'intake', sh: 0.1 } })], { xf: { t: [0, 0, -0.058] }, ...FINE }),
  poly('chin grille', range(-0.028, 0.028, 6).map((g) => quad([0.952, g - 0.002, -0.068], [0.952, g + 0.002, -0.068], [0.952, g + 0.002, -0.05], [0.952, g - 0.002, -0.05], { paint: 'metal', sh: 0.7 })), FINE),
  // The charge port, low on the left of the nacelle: a door with a lit ring.
  poly('charge port door', patch([0.86, 0.82], range(196, 214, 3), { paint: 'glare', sh: 0.5 }, 0.003), FINE),
  poly('charge port ring', patch([0.858, 0.854], range(196, 214, 3), { paint: 'led' }, 0.004), FINE),
  // The lidar puck under the chin, for terrain following, and its smoked window.
  group('chin lidar', [pod('lidar', 0, 0, [[0.03, 0.004], [0.022, 0.016], [0.0, 0.019], [-0.03, 0.016], [-0.04, 0.006]], {
    sides: 12, paint: 'carbon', regions: [{ at: [0.03, 0.022], k: 'all', role: 'glass', tint: [22, 28, 34] }] })], { xf: { t: [0.7, 0, -0.112] }, ...FINE }),
];

// ── The hopper ──────────────────────────────────────────────────────────────────
// Slab sides with hazard chevrons, a hinged fill lid forward, a sight strip down each flank, a blank
// label plate, and a non-slip walk across its top for the loader. The lid and its gasket sit on the
// flat top. Under the belly, the battery pack.
const HOP_F0 = 0.41, HOP_F1 = 0.72;
const hazard = [];
for (const s of [0, 1]) {
  const A = (a) => (s ? 180 - a : a);
  // A band of black diagonals on the livery yellow, low on the flank, its edges in black.
  const a0 = -24, a1 = -6, n = 10;
  for (let i = 0; i < n; i++) {
    const f0 = lerp(HOP_F1 - 0.02, HOP_F0 + 0.03, i / n), w = 0.012, lean = 0.016;
    const q = [at(f0, A(a0), 0.0026), at(f0 - w, A(a0), 0.0026), at(f0 - w + lean, A(a1), 0.0026), at(f0 + lean, A(a1), 0.0026)];
    hazard.push(quad(...(s ? q.reverse() : q), { paint: 'hazard', sh: 0.6 }));
  }
  hazard.push(...patch([HOP_F1 - 0.005, HOP_F0 + 0.015], [A(a0) - (s ? 0 : 2.5), A(a0) + (s ? 2.5 : 0)].sort((x, y) => x - y), { paint: 'hazard', sh: 0.55 }, 0.0024));
  hazard.push(...patch([HOP_F1 - 0.005, HOP_F0 + 0.015], [A(a1) - (s ? 2.5 : 0), A(a1) + (s ? 0 : 2.5)].sort((x, y) => x - y), { paint: 'hazard', sh: 0.55 }, 0.0024));
}
const hopper = [
  poly('hopper hazard bands', hazard, FINE),
  // The seams where the hopper meets the nacelle and the cockpit.
  ...[HOP_F1 + 0.004, HOP_F0 - 0.004].map((f) => poly('hopper seam', patch([f + 0.002, f - 0.002], range(-180, 180, 32), { paint: 'seam', sh: 0.4 }, 0.0016), FINE)),
  // Sight strips: the chemical's level read from outside, lit.
  mirror('hopper sight strip', [poly('sight strip', patch(range(HOP_F1 - 0.03, HOP_F0 + 0.04, 6), [6, 10], { paint: 'sight' }, 0.0026), FINE),
    tube('sight strip frame', alongF(range(HOP_F1 - 0.028, HOP_F0 + 0.038, 6), 10.6, 0.003), 0.0015, { role: 'nacelle', paint: 'frame', sides: 4, ...FINE }),
    tube('sight strip frame', alongF(range(HOP_F1 - 0.028, HOP_F0 + 0.038, 6), 5.4, 0.003), 0.0015, { role: 'nacelle', paint: 'frame', sides: 4, ...FINE })]),
  // HOPPER LABEL MISSING: the plate is there, riveted on, and blank. Nobody ever filled it in.
  mirror('hopper label plate', [poly('label plate', patch([0.6, 0.56, 0.52], [20, 32, 44], { paint: 'label', sh: 0.85 }, 0.0026), FINE),
    poly('label rivets', [[0.598, 21], [0.598, 43], [0.522, 21], [0.522, 43]].flatMap(([f, a]) => boxAt(at(f, a, 0.003), [0.003, 0.003, 0.003], { paint: 'metal' })), FINE)]),
  // The fill lid, forward on the top: a round hatch on a hinge, four dogs, a vent cap beside it.
  { kind: 'drum', name: 'fill lid', f: 0.69, r: 0.032, n: 16, z: [0.1, 0.108], role: 'nacelle', paint: 'glare', sh: { base: 0.55 }, top: { sh: 0.8 }, ...FINE },
  { kind: 'drum', name: 'fill lid gasket', f: 0.69, r: 0.036, n: 16, z: [0.099, 0.103], role: 'nacelle', paint: 'rubber', sh: { base: 0.4 }, top: { sh: 0.5 }, ...FINE },
  poly('fill lid dogs', [0, 90, 180, 270].flatMap((d) => boxAt([0.69 + Math.cos(d * DEG) * 0.026, Math.sin(d * DEG) * 0.026, 0.11], [0.008, 0.008, 0.005], { paint: 'hazard' }, d)), FINE),
  poly('fill lid hinge', boxAt([0.655, 0, 0.106], [0.008, 0.03, 0.007], { paint: 'metal' }), FINE),
  D('hopper vent', 0.69, 0.07, 0.007, 0.098, 0.12, 'metal', { top: { sh: 0.85 } }),
  D('hopper vent cap', 0.69, 0.07, 0.011, 0.12, 0.124, 'glare', { top: { sh: 0.7 } }),
  // The loader's walk: dark non-slip panels aft of the lid, each edged in a seam.
  poly('hopper walk', patch(range(0.635, 0.45, 4), range(70, 110, 4), { paint: 'glare', sh: 0.45 }, 0.0024), FINE),
  ...[0.635, 0.588, 0.542, 0.496, 0.45].map((f) => poly('hopper walk seam', patch([f + 0.0015, f - 0.0015], range(70, 110, 4), { paint: 'seam', sh: 0.35 }, 0.0028), FINE)),
  // The drone refill coupling on the hopper's flank, each side, with a hose down to the wing root.
  mirror('drone refill', [
    D('refill coupling', 0.46, 0.106, 0.008, -0.03, -0.012, 'hazard', { n: 8, top: { sh: 0.8 } }),
    tube('refill hose', [[0.46, 0.106, -0.03], [0.44, 0.13, -0.06], [0.24, 0.16, wingTop(0.16, 0.12)[2] + 0.004]], 0.004, { role: 'nacelle', paint: 'rubber', sides: 6, ...FINE }),
  ]),
];

// ── The battery pack ────────────────────────────────────────────────────────────
// A shallow fairing under the belly from the firewall to behind the wing, with seams across it at each
// module, cooling louvres down its flanks, two access hatches, and a lit state-of-charge strip the
// ground crew read from the side.
const BAT_F = [0.6, 0.55, 0.47, 0.4, 0.3, 0.2, 0.1, 0.0, -0.08];
const battery = [
  group('battery pack', [pod('battery fairing', 0, 0, BAT_F.map((f, i, a) => {
    const e = Math.min(i, a.length - 1 - i) / 2, k = Math.min(1, e);
    return [f, 0.012 + 0.056 * k, 0, 0.004 + 0.012 * k];
  }), { sides: 12, paint: 'glare', shade: { base: 0.55, amp: 0.3 } })], { xf: { t: [0, 0, -0.094] }, ...FINE }),
  ...[0.5, 0.4, 0.3, 0.2, 0.1].map((f) => tube('battery module seam', range(-0.05, 0.05, 6).map((g) => [f, g, -0.094 - 0.016 * Math.pow(Math.max(0, 1 - Math.abs(g / 0.068) ** 2), 0.5) - 0.0006]), 0.0011, { role: 'nacelle', paint: 'seam', sides: 3, ...FINE })),
  mirror('battery louvres', [poly('battery louvres', range(0.46, 0.14, 8).flatMap((f) => [
    quad([f + 0.008, 0.0695, -0.089], [f - 0.008, 0.0695, -0.089], [f - 0.008, 0.0695, -0.099], [f + 0.008, 0.0695, -0.099], { paint: 'intake', sh: 0.2 }),
    quad([f + 0.008, 0.072, -0.088], [f - 0.008, 0.072, -0.088], [f - 0.008, 0.0705, -0.092], [f + 0.008, 0.0705, -0.092], { paint: 'metal', sh: 0.75 }),
  ]), FINE),
  tube('charge strip', [[0.5, 0.064, -0.1], [0.08, 0.064, -0.1]], 0.0016, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE })]),
  ...[[0.5, 0.42], [0.2, 0.12]].map(([f0, f1]) => tube('battery hatch', [[f0, -0.026, -0.1105], [f0, 0.026, -0.1105], [f1, 0.026, -0.1105], [f1, -0.026, -0.1105], [f0, -0.026, -0.1105]], 0.0011, { role: 'nacelle', paint: 'seam', sides: 3, ...FINE })),
];

// ── The drones ──────────────────────────────────────────────────────────────────
// Ten quad-rotor spray drones, after the DJI Agras and the swarms that followed it: a pod body with
// the livery on its canopy, a tank slung under it with the chemical showing, four arms in an X, a
// motor in a guard ring at each tip with a nozzle under it, two skids and a status lamp. Five ride on
// each wing in cradles: a dark pad with a lit rim, charge contacts, four clamp posts, and a lamp that
// comes on while its drone is out. Built at the origin, the pad at h 0, and moved onto the wing.
//
// ⚠ THE DRONES FLY ON THE `spray` CHANNEL (cockpit.js eases it up while the aircraft sprays). Each
// drone's body is a group sliding by LC_DRONES.out(i); its rotors are `rotors` entries that slide the
// same distance and spin up on the same channel (`run`), so docked they sit still in their guards.
// A contact, the hangar and a card pass no channels, so there they are docked.
const DR = LC_DRONES, Z0 = 0.014, BODY_H = 0.018;
const DRONE_TIPS = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => [a * DR.arm, b * DR.arm]);
function cradle(name) {
  return [
    poly(name + ' pad', boxAt([0, 0, 0.0015], [0.11, 0.11, 0.003], { paint: 'cradle' }), FINE),
    tube(name + ' light', [[0.053, 0.053, 0.0034], [-0.053, 0.053, 0.0034], [-0.053, -0.053, 0.0034], [0.053, -0.053, 0.0034], [0.053, 0.053, 0.0034]], 0.0016, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
    ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => tube(name + ' clamp post', [[a * 0.016, b * 0.014, 0.003], [a * 0.016, b * 0.014, Z0 - 0.001]], 0.0024, { role: 'gear', paint: 'metal', sides: 4, ...FINE })),
    // The charge contacts the skids sit on, and the lamp at the cradle's fore edge, lit while its
    // drone is away.
    ...[1, -1].map((s) => poly(name + ' contact', boxAt([0, s * 0.017, 0.0036], [0.04, 0.004, 0.0012], { paint: 'metal' }), FINE)),
    poly(name + ' away lamp', boxAt([0.049, 0, 0.004], [0.004, 0.034, 0.002], { paint: 'beacon' }), { ...FINE, when: 'spray' }),
  ];
}
function droneBody(name) {
  const zA = Z0 + BODY_H * 0.62;
  const parts = [
    // The body: a pod along f, the canopy on top in the livery, the tank slung under it.
    pod(name + ' body', 0, Z0 + BODY_H * 0.5, [[0.04, 0.003, 0, 0.003], [0.034, 0.013, 0, 0.008], [0.016, 0.018, 0, 0.01], [-0.022, 0.017, 0, 0.01], [-0.034, 0.009, 0, 0.006], [-0.038, 0.003, 0, 0.003]], { sides: 8, paint: 'drone', shade: { base: 0.62, amp: 0.3 } }),
    pod(name + ' canopy', 0, Z0 + BODY_H * 0.9, [[0.03, 0.002, 0, 0.001], [0.022, 0.011, 0, 0.005], [-0.01, 0.012, 0, 0.006], [-0.024, 0.005, 0, 0.003]], { sides: 6, paint: 'droneTop', shade: { base: 0.7, amp: 0.3 } }),
    pod(name + ' tank', 0, Z0 - 0.002, [[0.02, 0.003], [0.015, 0.0075], [-0.015, 0.0075], [-0.02, 0.003]], { sides: 6, paint: 'sight', shade: { base: 0.7, amp: 0.2 } }),
    tube(name + ' tank band', [[0.0, -0.008, Z0 - 0.002], [0.0, 0.008, Z0 - 0.002]], 0.0016, { role: 'nacelle', paint: 'carbon', sides: 4, ...FINE }),
    // The nose: a status lamp and a camera ball under it.
    poly(name + ' status lamp', boxAt([0.0385, 0, Z0 + BODY_H * 0.55], [0.003, 0.012, 0.004], { paint: 'led' }), FINE),
    pod(name + ' camera', 0.032, Z0 + 0.001, [[0.004, 0.001], [0.002, 0.0035], [-0.002, 0.0035], [-0.004, 0.001]], { sides: 6, paint: 'intake' }),
    // A GNSS stub on the canopy's tail.
    D(name + ' gnss', -0.016, 0, 0.0035, Z0 + BODY_H * 1.2, Z0 + BODY_H * 1.2 + 0.004, 'antenna', { n: 8, top: { sh: 0.95 } }),
    // Two skids on struts.
    ...[1, -1].flatMap((s) => [
      tube(name + ' skid', [[0.026, s * 0.017, Z0 - 0.012], [-0.026, s * 0.017, Z0 - 0.012]], 0.0016, { role: 'gear', paint: 'carbon', sides: 4, ...FINE }),
      tube(name + ' skid strut', [[0.014, s * 0.017, Z0 - 0.012], [0, s * 0.012, Z0 + 0.003], [-0.014, s * 0.017, Z0 - 0.012]], 0.0012, { role: 'gear', paint: 'carbon', sides: 3, ...FINE }),
    ]),
  ];
  for (const [tf, tg] of DRONE_TIPS) {
    parts.push(tube(name + ' arm', [[tf * 0.25, tg * 0.25, zA], [tf, tg, zA]], 0.0022, { role: 'nacelle', paint: 'drone', sides: 4, ...FINE }));
    parts.push(D(name + ' motor', tf, tg, 0.0048, zA - 0.003, Z0 + BODY_H + 0.002, 'metal', { n: 6, top: { sh: 0.85 } }));
    // The guard ring round the rotor on a strut, and the nozzle under the motor.
    const ring = Array.from({ length: 9 }, (_, k) => { const t = (k / 8) * 2 * Math.PI; return [tf + Math.cos(t) * DR.guard, tg + Math.sin(t) * DR.guard, Z0 + BODY_H + 0.003]; });
    parts.push(tube(name + ' guard', ring, 0.0011, { role: 'nacelle', paint: 'carbon', sides: 3, ...FINE }));
    const out = Math.atan2(tg, tf);
    parts.push(tube(name + ' guard strut', [[tf, tg, zA], [tf + Math.cos(out) * DR.guard, tg + Math.sin(out) * DR.guard, Z0 + BODY_H + 0.003]], 0.0011, { role: 'nacelle', paint: 'carbon', sides: 3, ...FINE }));
    parts.push(tube(name + ' nozzle', [[tf, tg, zA - 0.003], [tf, tg, zA - 0.011]], 0.0016, { role: 'gun', paint: 'glare', sides: 4, caps: 1, ...FINE }));
  }
  return parts;
}
// Each cradle's centre on the right wing's top.
const cradleAt = (g) => { const p = foilPt(onWing(g), DR.x, 1); return [p[0], g, p[2] + 0.001]; };
const drones = [
  mirror('wing drones', DR.g.flatMap((g, i) => [
    group('drone cradle ' + (i + 1), cradle('cradle'), { xf: { t: P3(cradleAt(g)) }, ...FINE }),
    group('drone ' + (i + 1), droneBody('drone'), { xf: { t: P3(cradleAt(g)) }, anim: { ch: 'spray', slide: P3(DR.out(i)), def: 0 }, ...FINE }),
  ])),
];
// Each drone's four rotors, both sides: two blades, turning opposite ways in pairs, stopped in their
// guards until the channel comes up.
const droneRotors = [1, -1].flatMap((side) => DR.g.flatMap((g, i) => DRONE_TIPS.map(([tf, tg], k) => {
  const c = cradleAt(g), o = DR.out(i);
  return { at: P3([c[0] + tf, side * (c[1] + tg), c[2] + Z0 + BODY_H + 0.004]), plane: 'h', r: DR.rotor, blades: 2, lead: 0.9, dir: (k % 2 ? 1 : -1) * side, spinMul: 3.2, phase: R(((i * 4 + k) * 0.7) % 3.14), run: 'spray', slide: { ch: 'spray', by: P3([o[0], side * o[1], o[2]]) } };
})));
const dronesFar = [
  mirror('wing drones (far)', [poly('wing drones (far)', DR.g.flatMap((g) => { const c = cradleAt(g); return boxAt([c[0], c[1], c[2] + 0.016], [0.08, 0.08, 0.024], { paint: 'drone' }); }), COARSE)]),
];


// ── The wing, its surfaces, the boom ────────────────────────────────────────────
const wing = foil('wing', W, { nx: 13, paint: 'hull', lowerSh: 0.55, lodNx: 4 });
const flaps = ctrlOn('flap', W[0], W[1], 0.1, 0.6, 0.26);
const ailerons = ctrlOn('aileron', W[0], W[1], 0.62, 0.98, 0.26);
const tipBands = mirror('wingtip bands', [foil('tip band', [{ ...onWing(0.96), t: 0.93 }, { ...W[1], t: 0.92 }], { paint: 'trim', nx: 7, tip: false, sides: 1, lodNx: 3 })]);
// A walkway at the wing root, dark non-slip, and an LED line along the leading edge.
const wingDetail = mirror('wing detail', [
  poly('wing walk', range(0.11, 0.2, 3).slice(0, 3).flatMap((g, i, arr) => {
    const A = onWing(g), B = onWing(arr[i] + 0.03);
    const p = (s, x) => { const q = foilPt(s, x, 1); return [q[0], q[1], q[2] + 0.0018]; };
    return [quad(p(A, 0.15), p(B, 0.15), p(B, 0.7), p(A, 0.7), { paint: 'glare', sh: 0.5 })];
  }), FINE),
  tube('leading edge light', range(0.14, 1.06, 8).map((g) => { const q = foilPt(onWing(g), 0.0, 1); return [q[0] + 0.003, g, q[2]]; }), 0.0022, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  // Panel seams across the wing at each rib bay and along the spar.
  ...[0.24, 0.58, 0.78, 0.98].map((g) => tube('wing rib seam', range(0.05, 0.72, 5).map((x) => { const q = foilPt(onWing(g), x, 1); return [q[0], q[1], q[2] + 0.0012]; }), 0.0012, { role: 'nacelle', paint: 'seam', sides: 3, ...FINE })),
  tube('wing spar seam', range(0.12, 1.08, 6).map((g) => { const q = foilPt(onWing(g), 0.22, 1); return [q[0], q[1], q[2] + 0.0012]; }), 0.0012, { role: 'nacelle', paint: 'seam', sides: 3, ...FINE }),
  // Landing lamp in the leading edge, inboard of the drones, and a vortex generator row.
  poly('landing lamp', [(() => { const s = onWing(0.4), q = foilPt(s, 0.004, 1), l = foilPt(s, 0.004, 0); return quad([q[0] + 0.002, 0.38, q[2]], [q[0] + 0.002, 0.42, q[2]], [l[0] + 0.002, 0.42, l[2]], [l[0] + 0.002, 0.38, l[2]], { role: 'window', tint: [250, 246, 220], sh: 1 }); })()], FINE),
  poly('vortex generators', range(0.2, 1.0, 12).map((g) => { const q = foilPt(onWing(g), 0.1, 1); return quad([q[0] + 0.006, g, q[2]], [q[0] - 0.006, g, q[2]], [q[0] - 0.006, g, q[2] + 0.006], [q[0] + 0.004, g, q[2] + 0.002], { paint: 'metal', sh: 0.8 }); }), FINE),
]);
// The spray boom: a faired tube under the trailing edge, on hangers, with fourteen nozzles a side,
// each a drop, a tip and a lit status bead; an electric pump under the belly feeds it.
const boomF = -0.255, boomZ = (g) => onWing(g).h - 0.05;
const NOZ = range(0.12, 1.02, 13);
const boom = group('spray boom', [
  mirror('boom', [
    faired('spray boom', [[boomF, 0.05, boomZ(0.05)], [boomF, 1.04, boomZ(1.04)]], 0.016, 0.008, { role: 'gun', paint: 'metal', sh: 0.7 }),
    ...[0.25, 0.55, 0.85].map((g) => faired('boom hanger', [[boomF + 0.035, g, onWing(g).h - 0.012], [boomF + 0.004, g, boomZ(g)]], 0.012, 0.004, { role: 'gun', paint: 'carbon', sh: 0.6 })),
    ...NOZ.map((g) => tube('nozzle', [[boomF, g, boomZ(g) - 0.003], [boomF - 0.006, g, boomZ(g) - 0.016]], 0.0028, { role: 'gun', paint: 'glare', sides: 5 })),
    ...NOZ.map((g) => tube('nozzle tip', [[boomF - 0.006, g, boomZ(g) - 0.016], [boomF - 0.007, g, boomZ(g) - 0.02]], 0.0038, { role: 'gun', paint: 'metal', sides: 6, caps: 1 })),
    poly('nozzle beads', NOZ.flatMap((g) => boxAt([boomF + 0.007, g, boomZ(g)], [0.003, 0.006, 0.003], { paint: 'led' })), FINE),
    tube('boom end cap', [[boomF, 1.04, boomZ(1.04)], [boomF, 1.052, boomZ(1.052)]], 0.004, { role: 'gun', paint: 'hazard', sides: 6, caps: 1 }),
  ]),
  pod('spray pump', 0, -0.128, [[0.36, 0.006], [0.34, 0.016], [0.26, 0.018], [0.22, 0.011], [0.2, 0.004]], { sides: 10, paint: 'metal', shade: { base: 0.6, amp: 0.25 } }),
  tube('pump stalk', [[0.3, 0, -0.1], [0.3, 0, -0.124]], 0.006, { role: 'gun', paint: 'metal' }),
  mirror('boom feed', [tube('boom feed', [[0.24, 0.012, -0.128], [0.1, 0.07, -0.1], [0.05, 0.075, -0.09], [-0.2, 0.06, boomZ(0.06)], [boomF, 0.06, boomZ(0.06)]], 0.0035, { role: 'gun', paint: 'metal', sides: 5 })]),
], FINE);

// ── The terrain-following pod under the left wing ───────────────────────────────
const tfPod = [
  group('terrain pod', [pod('terrain pod', 0, 0, [[0.36, 0.004], [0.345, 0.016], [0.31, 0.022], [0.12, 0.022], [0.05, 0.016], [0.02, 0.005]], {
    sides: 12, paint: 'glare', regions: [{ at: [0.36, 0.345], k: 'all', role: 'glass', tint: [26, 34, 40] }], capAft: { kind: 'apex', at: [0.01, 0, 0] }, shade: { base: 0.6, amp: 0.3 } })], { xf: { t: [0, -0.62, -0.11] }, ...FINE }),
  faired('terrain pod pylon', [[0.2, -0.62, -0.09], [0.2, -0.62, onWing(0.62).h - 0.01]], 0.08, 0.008, { role: 'strut', paint: 'glare', sh: 0.6, ...FINE }),
  poly('terrain pod band', boxAt([0.3, -0.62, -0.11], [0.006, 0.046, 0.046], { paint: 'led' }), FINE),
];

// ── Gear: spring-steel legs, fat tyres, brakes; a sprung tailwheel ──────────────
const gear = mirror('main gear', [
  faired('spring leg', [[0.24, 0.1, -0.1], [0.215, 0.27, -0.19], [0.208, 0.295, -0.208]], 0.04, 0.009, { role: 'gear', paint: 'gearLeg', sh: 0.62 }),
  wheel('main wheel', [0.205, 0.31, -0.211], 0.042, 0.027, 16),
  D('brake disc', 0.205, 0.29, 0.026, -0.212, -0.21, 'metal', { n: 12 }),
  tube('axle', [[0.205, 0.28, -0.211], [0.205, 0.343, -0.211]], 0.006, { role: 'gear', paint: 'metal', sides: 8, caps: 1, ...FINE }),
  tube('brake caliper', [[0.225, 0.288, -0.196], [0.235, 0.288, -0.2]], 0.006, { role: 'gear', paint: 'hazard', sides: 5, caps: 1, ...FINE }),
  tube('brake line', [[0.235, 0.12, -0.105], [0.222, 0.27, -0.188], [0.23, 0.286, -0.198]], 0.0018, { role: 'gear', paint: 'glare', sides: 4, ...FINE }),
  faired('leg root fairing', [[0.26, 0.098, -0.092], [0.22, 0.098, -0.092]], 0.03, 0.03, { role: 'gear', paint: 'hull', sh: 0.62, ...FINE }),
  tube('gear wire cutter', [[0.25, 0.16, -0.13], [0.29, 0.16, -0.2]], 0.0028, { role: 'gear', paint: 'metal', sides: 4, ...FINE }),
]);
const tailwheel = group('tailwheel', [
  faired('tailwheel spring', [[-0.84, 0, 0.032], [-0.885, 0, -0.008]], 0.026, 0.008, { role: 'gear', paint: 'gearLeg' }),
  tube('tailwheel fork', [[-0.885, 0.012, -0.008], [-0.905, 0.012, -0.041]], 0.0035, { role: 'gear', paint: 'metal', sides: 5, ...FINE }),
  tube('tailwheel fork', [[-0.885, -0.012, -0.008], [-0.905, -0.012, -0.041]], 0.0035, { role: 'gear', paint: 'metal', sides: 5, ...FINE }),
  wheel('tailwheel', [-0.905, 0, -0.041], 0.018, 0.01, 12),
]);

// ── Tail: braced tailplane, a big fin, the cable ────────────────────────────────
const T = [
  { g: 0, le: -0.66, te: -0.89, h: 0.068, t: 0.9 },
  { g: 0.4, le: -0.7, te: -0.9, h: 0.068, t: 0.78 },
];
const tailplane = foil('tailplane', T, { role: 'stab', paint: 'hull', nx: 9, lodNx: 4 });
const elevators = ctrlOn('elevator', T[0], T[1], 0.06, 0.96, 0.36);
const stabStruts = mirror('tailplane struts', [faired('tailplane strut', [[-0.74, 0.03, 0.02], [-0.76, 0.26, 0.064]], 0.014, 0.004, { role: 'strut', paint: 'metal', sh: 0.7, ...FINE })]);
const F = [
  { g: 0.08, le: -0.6, te: -0.94, h: 0, t: 1.0 },
  { g: 0.48, le: -0.8, te: -0.98, h: 0, t: 0.82 },
  { g: 0.52, le: -0.84, te: -0.97, h: 0, t: 0.6 },
];
const fin = foil('fin', F, { axis: 'g', role: 'fin', paint: 'hull', nx: 10, lodNx: 4 });
const rudder = ctrlOn('rudder', F[0], F[1], 0.12, 1, 0.36, { axis: 'g', sh: 0.72 });
// The fin's trim band and an LED line up its leading edge.
const finBand = poly('fin band', [
  { role: 'fin', paint: 'trim', sh: 0.84, p: [[-0.68, 0.0125, 0.3], [-0.84, 0.0105, 0.3], [-0.85, 0.0105, 0.38], [-0.71, 0.0125, 0.38]] },
  { role: 'fin', paint: 'trim', sh: 0.64, p: [[-0.71, -0.0125, 0.38], [-0.85, -0.0105, 0.38], [-0.84, -0.0105, 0.3], [-0.68, -0.0125, 0.3]] },
  { role: 'fin', paint: 'hazard', sh: 0.84, p: [[-0.69, 0.013, 0.31], [-0.84, 0.011, 0.31], [-0.84, 0.011, 0.318], [-0.69, 0.013, 0.318]] },
  { role: 'fin', paint: 'hazard', sh: 0.64, p: [[-0.69, -0.013, 0.318], [-0.84, -0.011, 0.318], [-0.84, -0.011, 0.31], [-0.69, -0.013, 0.31]] },
], FINE);
const finTop = foilPt(F[2], 0.5, 1);
const tail = [
  tube('fin leading edge light', [[-0.62, 0, 0.13], [-0.81, 0, 0.47]], 0.0025, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  D('fin beacon base', -0.9, 0, 0.012, 0.52, 0.527, 'glare', { top: { sh: 0.6 } }),
  D('fin beacon', -0.9, 0, 0.008, 0.527, 0.54, 'beacon', { top: { sh: 1 } }),
  tube('tail strobe', [[-0.975, 0, 0.052], [-0.997, 0, 0.052]], 0.006, { role: 'nacelle', paint: 'strobe', sh: 1, sides: 6, caps: 1, ...FINE }),
  ...[-0.24, -0.5, -0.76].map((f) => poly('tail cone seam', patch([f + 0.002, f - 0.002], range(-180, 180, 24), { paint: 'seam', sh: 0.4 }, 0.0014), FINE)),
  // The avionics hatch on the right of the tail cone, and a GPS puck and two blades on top.
  tube('avionics hatch seam', [...roundF(-0.3, range(-10, 40, 4), 0.0022), ...alongF([-0.34, -0.38], 40, 0.0022), ...roundF(-0.38, range(40, -10, 4), 0.0022), ...alongF([-0.34, -0.3], -10, 0.0022)], 0.0016, { role: 'nacelle', paint: 'seam', sides: 3, ...FINE }),
  { kind: 'drum', name: 'GNSS puck', f: -0.15, r: 0.016, n: 12, z: [0.13, 0.142], role: 'nacelle', paint: 'antenna', sh: { base: 0.8 }, top: { sh: 0.95 }, ...FINE },
  { kind: 'blade', name: 'datalink blade', role: 'fin', paint: 'glare', t: 0.0025, sh: [0.7, 0.55], outline: [[-0.3, 0.1], [-0.325, 0.15], [-0.34, 0.15], [-0.35, 0.098]], ...FINE },
  { kind: 'blade', name: 'drone link blade', role: 'fin', paint: 'glare', t: 0.0025, sh: [0.7, 0.55], outline: [[-0.42, 0.093], [-0.44, 0.13], [-0.452, 0.13], [-0.46, 0.091]], ...FINE },
  { kind: 'blade', name: 'belly whip', role: 'fin', paint: 'glare', t: 0.002, sh: [0.7, 0.55], outline: [[-0.1, -0.06], [-0.13, -0.11], [-0.14, -0.11], [-0.125, -0.056]], ...FINE },
];

// ── The wire-strike kit, modernised ─────────────────────────────────────────────
// An upper cutter on the roof's leading edge and a lower one short of the eye line at the
// windscreen's base, a deflector cable from the roof to the fin top, and cutters on the gear legs.
const wire = group('wire strike kit', [
  tube('upper cutter', [at(0.262, 90, 0), [0.31, 0, 0.27]], 0.0035, { role: 'strut', paint: 'metal' }),
  poly('upper cutter blade', [{ role: 'strut', paint: 'metal', sh: 0.9, p: [at(0.262, 90, 0.002), [0.31, 0.0015, 0.27], [0.318, 0.0015, 0.262], at(0.285, 90, 0.002)] },
    { role: 'strut', paint: 'metal', sh: 0.6, p: [at(0.285, 90, 0.002), [0.318, -0.0015, 0.262], [0.31, -0.0015, 0.27], at(0.262, 90, 0.002)].map((q, i) => (i === 0 || i === 3 ? [q[0], -0.0015, q[2]] : q)) }]),
  tube('lower cutter', [at(0.405, 90, 0), [0.393, 0, 0.127]], 0.003, { role: 'strut', paint: 'metal' }),
  poly('lower cutter teeth', range(0.108, 0.12, 3).map((h) => ({ role: 'strut', paint: 'metal', sh: 0.85, p: [[0.397, 0, h], [0.409, 0, h + 0.003], [0.397, 0, h + 0.006]] }))),
  tube('deflector cable', [[0.3, 0, 0.27], [0.1, 0, 0.268], [-0.9, 0, finTop[2] + 0.005]], 0.0016, { role: 'strut', paint: 'metal' }),
], FINE);

// ── Lamps and lenses ────────────────────────────────────────────────────────────
const tip = foilPt(W[2], 0.5, 1);
const lenses = [
  poly('starboard tip lamp', [{ role: 'window', sh: 1, tint: [46, 190, 78], p: [[tip[0] + 0.03, 1.142, tip[2] - 0.008], [tip[0] - 0.03, 1.142, tip[2] - 0.008], [tip[0] - 0.03, 1.142, tip[2] + 0.004], [tip[0] + 0.03, 1.142, tip[2] + 0.004]] }]),
  poly('port tip lamp', [{ role: 'window', sh: 1, tint: [200, 52, 48], p: [[tip[0] + 0.03, -1.142, tip[2] + 0.004], [tip[0] - 0.03, -1.142, tip[2] + 0.004], [tip[0] - 0.03, -1.142, tip[2] - 0.008], [tip[0] + 0.03, -1.142, tip[2] - 0.008]] }]),
  mirror('tip strobes', [poly('tip strobe', boxAt([tip[0] - 0.05, 1.143, tip[2]], [0.012, 0.004, 0.008], { paint: 'strobe' }), FINE)]),
  D('belly beacon', -0.04, 0, 0.009, -0.104, -0.092, 'beacon', { bottom: { sh: 1 } }),
];
const lamps = [
  { at: P3([tip[0], -1.15, tip[2]]), n: [0, -1, 0], rgb: '255,55,55', kind: 'steady' },
  { at: P3([tip[0], 1.15, tip[2]]), n: [0, 1, 0], rgb: '60,255,95', kind: 'steady' },
  { at: P3([tip[0] - 0.05, -1.15, tip[2]]), n: [0, -1, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: P3([tip[0] - 0.05, 1.15, tip[2]]), n: [0, 1, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [-1.0, 0, 0.052], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [-0.9, 0, 0.545], n: [0, 0, 1], rgb: '255,90,70', kind: 'beacon' },
  { at: [-0.04, 0, -0.106], n: [0, 0, -1], rgb: '255,90,70', kind: 'beacon' },
];

// ── LED accents along the body ──────────────────────────────────────────────────
const accents = mirror('body light lines', [
  tube('cheat light', alongF([0.96, 0.86, 0.74, 0.62, 0.5, 0.42], -30, 0.004), 0.0022, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  tube('tail light line', alongF([-0.07, -0.2, -0.4, -0.6, -0.8], 0, 0.004), 0.002, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  poly('trim stripe', patch([0.42, 0.3, 0.2, 0.06, -0.06, -0.24, -0.45, -0.7, -0.9], [-8, 2], { paint: 'trim', sh: 0.8 }, 0.0018), FINE),
]);

// ── The coarse body, for range ──────────────────────────────────────────────────
const coarse = [
  fuselageFar, glassFar, ...dronesFar,
  cone('spinner (far)', 1.0, 0, 0.02, 0.05, [1.126, 0, 0.02], { paint: 'spinner', n: 8, ...COARSE }),
  mirror('boom (far)', [tube('spray boom (far)', [[boomF, 0.05, boomZ(0.05)], [boomF, 1.04, boomZ(1.04)]], 0.006, { role: 'gun', paint: 'metal', sides: 4, ...COARSE })]),
];

const doc = {
  id: 'locust_2076',
  kind: 'mesh',
  params: {
    name: 'LOCUST 2076',
    note: 'CONCEPT, generated by scripts/shapes/concepts/locust-2076.mjs (edit that, not this). The Locust fifty years on, after the Pyka Pelican Spray and the DJI Agras swarms: an electric hopper mothership on the AT-802\'s lines. A slab-sided hopper with hazard bands, a blank label plate and a sight strip; a tall glass cockpit set high behind it; a big slow six-blade prop on an electric motor nacelle with cheek inlets, a chin scoop and flank louvres where the PT6 stacks were; ten quad-rotor spray drones docked in lit cradles along the top of the wing, which fly out in a line off each wingtip while she sprays (the spray channel); a battery pack under the belly with cooling louvres and a charge strip; a faired spray boom with fourteen nozzles a side on an electric pump; a chin lidar and a terrain-following pod; the wire-strike kit; spring gear on fat tyres. A variant of the locust mesh, worn as the LOCUST 2076 factory edition.',
    groundPitch: 10,
    hull: 'fuselage',
    navLamps: P3([tip[0], 1.14, tip[2]]),
    lamps,
    // A big slow prop: six blades, larger than the PT6's five, turning at three quarters of its rate.
    // Then the drones' forty, on the `spray` channel.
    rotors: [{ at: [1.035, 0, 0.02], plane: 'fore', r: 0.29, blades: 6, lead: 0.85, spinMul: 0.75 }, ...droneRotors],
    finish: 'gloss',
    paints: {
      hull: { rgb: [230, 190, 46], livery: 'base' },
      trim: { rgb: [30, 61, 46], livery: 'trim' },
      glare: { rgb: [34, 37, 40], livery: 'fixed', mat: 'matte' },
      frame: { rgb: [30, 33, 36], livery: 'fixed', mat: 'gloss' },
      seam: { rgb: [70, 64, 40], livery: 'fixed', mat: 'matte' },
      carbon: { rgb: [36, 40, 44], livery: 'fixed', mat: 'satin' },
      metal: { rgb: [156, 160, 166], livery: 'fixed', mat: 'bare' },
      gearLeg: { rgb: [52, 56, 60], livery: 'fixed', mat: 'satin' },
      rubber: { rgb: [26, 26, 28], livery: 'fixed', mat: 'rubber' },
      spinner: { rgb: [30, 32, 34], livery: 'fixed', mat: 'gloss' },
      motor: { rgb: [44, 48, 52], livery: 'fixed', mat: 'satin' },
      intake: { rgb: [14, 15, 16], livery: 'fixed', mat: 'matte' },
      hazard: { rgb: [24, 24, 24], livery: 'fixed', mat: 'satin' },
      label: { rgb: [232, 232, 226], livery: 'fixed', mat: 'satin' },
      sight: { rgb: [150, 196, 120], livery: 'fixed', mat: 'gloss' },
      led: { rgb: [150, 255, 170], livery: 'fixed', mat: 'matte' },
      beacon: { rgb: [235, 70, 56], livery: 'fixed', mat: 'gloss' },
      strobe: { rgb: [240, 244, 248], livery: 'fixed', mat: 'gloss' },
      antenna: { rgb: [214, 216, 212], livery: 'fixed', mat: 'satin' },
      drone: { rgb: [58, 62, 66], livery: 'fixed', mat: 'satin' },
      droneTop: { rgb: [230, 190, 46], livery: 'base' },
      cradle: { rgb: [22, 24, 26], livery: 'fixed', mat: 'rubber' },
      interior: { rgb: [38, 42, 44], livery: 'fixed', mat: 'matte' },
      seat: { rgb: [62, 66, 68], livery: 'fixed', mat: 'satin' },
      screen: { rgb: [60, 200, 170], livery: 'fixed', mat: 'gloss' },
    },
    parts: [
      fuselage, windscreen, mirror('side glass', [sideGlass, quarter]), roofGlass, ...frames, ...door, ...interior,
      ...nose, ...hopper, ...battery, ...drones, wing, flaps, ailerons, tipBands, wingDetail, boom, ...tfPod, gear, tailwheel,
      tailplane, elevators, stabStruts, fin, rudder, finBand, ...tail, wire, ...lenses, accents,
      ...coarse,
    ],
  },
};

const v = validateMesh(doc.params, doc.id);
if (v.errors.length) { console.log('ERRORS', v.errors.slice(0, 12)); process.exit(1); }
if (v.warnings?.length) console.log('warnings', v.warnings.slice(0, 8));
const n1 = compileMesh(doc.params, { detail: 1 }).faces.length, n0 = compileMesh(doc.params, { detail: 0 }).faces.length;
writeFileSync(new URL('../../../content/vehicle_models/mesh_locust_2076.json', import.meta.url), formatMesh(doc));
console.log('mesh_locust_2076.json:', n1, 'faces near,', n0, 'far');
