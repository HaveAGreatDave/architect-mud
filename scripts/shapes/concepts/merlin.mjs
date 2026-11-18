// The Corvane Merlin: writes content/vehicle_models/mesh_merlin.json.
//
//   node scripts/shapes/concepts/merlin.mjs
//   then: npm run vehicles:bake
//
// A two-seat mini VTOL conceived as a late-century wedge supercar (docs/proposals/road-vtol.md): a knife
// nose, the cab pushed forward under a steep windscreen that wraps into the door glass, gull-wing doors
// hinged on the roof rail, NACA ducts behind them, a long louvred engine cover with a roof scoop, four
// round tail lamps and a wing on stanchions. Four ducted fans stand at the corners where the wheels
// would be, so the duct housings are the wheel arches; a pusher duct sits between the tail lamps; three
// feet with mag-lock pucks clamp it to a pad.
//
// ⚠ THIS OVERWRITES THE JSON. Edit this file, not the mesh in the Modelshop.
//
// Two bodies in one file. Everything fine is `minDetail: 1`; a coarse body with `maxDetail: 0`
// stands in at range.
//
// Frame: f fore, g right, h up, in the units of client/shared/cabin-merlin.js, which states the body,
// the glass, the doors and the ducts once for this file and the cockpit both.
import { writeFileSync } from 'node:fs';
import { R, P3, skin, loft, pod, tube, mirror, group, poly as rawPoly, quad, DEG } from '../fw-meshes/lib.mjs';
const { formatMesh, validateMesh, compileMesh } = await import('../../../client/shared/vehicle-mesh.js');
const { MERLIN_STATIONS, MERLIN_SIDES, MERLIN_GLASS, MERLIN_DOOR, MERLIN_DUCTS, MERLIN_GROUND_H, MERLIN_FEET, MERLIN_PUSHER, faceKs } = await import('../../../client/shared/cabin-merlin.js');

const FINE = { minDetail: 1 }, COARSE = { maxDetail: 0 };
const poly = (name, faces, extra) => rawPoly(name, faces.map((f) => ({ role: 'nacelle', ...f })), extra);
// Black-tinted glass all round: a supercar's limo tint. Only a glint of the sky in it, from the outside.
const GLASS = [12, 14, 18];
const lerp = (a, b, t) => a + (b - a) * t;
const range = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));
const P3s = (a) => a.map(P3);

// A face wound so its normal points along `out` (Newell's normal), so culling means what it says.
function faceOut(pts, out, extra = {}) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const p = nx * out[0] + ny * out[1] + nz * out[2] < 0 ? pts.slice().reverse() : pts;
  return { p: p.map(P3), ...extra };
}
// A box as six outward faces, centred at c with size [f, g, h].
function boxAt(c, [sf, sg, sh], extra = {}) {
  const f = sf / 2, g = sg / 2, h = sh / 2, P = (a, b, d) => [c[0] + a, c[1] + b, c[2] + d];
  return [
    faceOut([P(-f, -g, h), P(f, -g, h), P(f, g, h), P(-f, g, h)], [0, 0, 1], { sh: 0.86, ...extra }),
    faceOut([P(-f, -g, -h), P(f, -g, -h), P(f, g, -h), P(-f, g, -h)], [0, 0, -1], { sh: 0.4, ...extra }),
    faceOut([P(f, -g, -h), P(f, g, -h), P(f, g, h), P(f, -g, h)], [1, 0, 0], { sh: 0.74, ...extra }),
    faceOut([P(-f, -g, -h), P(-f, g, -h), P(-f, g, h), P(-f, -g, h)], [-1, 0, 0], { sh: 0.55, ...extra }),
    faceOut([P(-f, g, -h), P(f, g, -h), P(f, g, h), P(-f, g, h)], [0, 1, 0], { sh: 0.66, ...extra }),
    faceOut([P(-f, -g, -h), P(f, -g, -h), P(f, -g, h), P(-f, -g, h)], [0, -1, 0], { sh: 0.62, ...extra }),
  ];
}

// ── The body ────────────────────────────────────────────────────────────────────
const ST = MERLIN_STATIONS;
const at = (f, a, out = 0) => skin(ST, f, a * DEG, out);
const W = MERLIN_GLASS.windscreen, SG_ = MERLIN_GLASS.side, DR = MERLIN_DOOR;
// The stations a run of faces starts at: a loft region's `at` names the band from that station aft.
const bandsIn = (f0, f1) => ST.map((s) => s.f).filter((f) => f <= f1 + 1e-9 && f > f0 + 1e-9);
const body = loft('body', MERLIN_SIDES, ST, {
  ...FINE, paint: 'hull',
  note: 'The shell. The glass is the loft\'s own faces, glazed (cabin-merlin.js). Door seams, vents, light bars and trim are separate parts laid a hair proud of it.',
  capFore: { kind: 'apex', at: [0.808, 0, -0.06], paint: 'carbon' },
  capAft: { kind: 'flat', sh: 0.5, paint: 'carbon' },
  regions: [
    // The splitter, sills and diffuser: a carbon band low down all the way round.
    { at: ST.map((s) => s.f).filter((f) => f < 0.78 && f > -0.79), k: faceKs(234, 306), paint: 'carbon' },
    // The windscreen and the door glass, both sides: whole faces of the loft, glazed.
    { at: bandsIn(W.f[0], W.f[1]), k: faceKs(W.a[0], W.a[1]), role: 'glass', tint: GLASS },
    { at: bandsIn(SG_.f[0], SG_.f[1]), k: [...faceKs(SG_.a[0], SG_.a[1]), ...faceKs(180 - SG_.a[1], 180 - SG_.a[0])], role: 'glass', tint: GLASS },
    // The engine cover's centre panel in carbon, between the louvre banks.
    { at: bandsIn(-0.70, -0.28), k: faceKs(81, 99), paint: 'carbon' },
  ],
  shade: { base: 0.6, amp: 0.38 },
});

// A curved patch of skin as a grid of quads, `o` proud of the hull.
function patch(fs, as, extra, o = 0.0022) {
  const out = [];
  for (let i = 0; i < fs.length - 1; i++) for (let j = 0; j < as.length - 1; j++) {
    out.push(quad(at(fs[i + 1], as[j], o), at(fs[i], as[j], o), at(fs[i], as[j + 1], o), at(fs[i + 1], as[j + 1], o), extra));
  }
  return out;
}
const alongF = (fs, a, o = 0.004) => fs.map((f) => at(f, a, o));
const roundF = (f, as, o = 0.004) => as.map((a) => at(f, a, o));
const LR = (fn) => [0, 1].flatMap((s) => fn((a) => (s ? 180 - a : a), s ? 'left' : 'right', s ? -1 : 1));

// ── The glasshouse frame ────────────────────────────────────────────────────────
// The canopy has no A-pillars: a hoop at its back edge over the roof, a frame round its foot, the
// roof rails over the door glass behind it, the B-pillar and the black waist line under all the glass.
const FR = (name, pts, r = 0.005, paint = 'frame') => tube(name, pts, r, { role: 'nacelle', paint, sh: 0.5, sides: 5, ...FINE });
const glassFrame = [
  FR('canopy hoop', roundF(W.f[0] - 0.004, range(W.a[0], W.a[1], 24)), 0.0055),
  FR('windscreen foot', roundF(W.f[1] + 0.004, range(W.a[0], W.a[1], 24)), 0.006),
  FR('wiper', [at(W.f[1] - 0.005, 72, 0.004), at(W.f[1] - 0.06, 88, 0.004)], 0.0028, 'frame'),
  ...LR((A, side) => [
    FR('roof rail (' + side + ')', alongF(range(SG_.f[0] - 0.01, W.f[0], 5), A(SG_.a[1]), 0.0045), 0.0055),
    FR('waist line (' + side + ')', alongF(range(SG_.f[0] - 0.01, W.f[1] + 0.004, 12), A(SG_.a[0]), 0.004), 0.005),
    FR('B-pillar (' + side + ')', roundF(SG_.f[0] - 0.006, range(A(SG_.a[0]), A(SG_.a[1]), 4)), 0.007),
    // The mirror: a blade on a stalk off the body just ahead of the canopy's foot.
    tube('mirror stalk (' + side + ')', [at(0.40, A(10), 0.004), at(0.385, A(10), 0.045)], 0.004, { role: 'nacelle', paint: 'carbon', sides: 5, ...FINE }),
  ]),
  ...LR((A, side, sg) => {
    const c = at(0.385, A(10), 0.05);
    return [poly('mirror (' + side + ')', [
      ...boxAt([c[0], c[1] + sg * 0.012, c[2] + 0.004], [0.022, 0.05, 0.026], { paint: 'hull' }),
      faceOut([[c[0] - 0.0115, c[1] - 0.012, c[2] - 0.006], [c[0] - 0.0115, c[1] + 0.036 * sg, c[2] - 0.006], [c[0] - 0.0115, c[1] + 0.036 * sg, c[2] + 0.014], [c[0] - 0.0115, c[1] - 0.012, c[2] + 0.014]], [-1, 0, 0], { role: 'glass', tint: [150, 170, 190], sh: 0.9 }),
    ], FINE)];
  }),
];

// ── The gull-wing doors ───────────────────────────────────────────────────────────
// Each door's seam round its edge, hinged along the roof rail: two hinge knuckles there, a pull at the
// front edge where your hand finds it, and the NACA duct behind the door that feeds the rear fans.
// The hinge line: the door's top edge along the roof rail, back to front. DOOR_SWING is how far it lifts.
const DOOR_SWING = 68;
const GULL = 1;   // which way round the roof-rail axis lifts the door up, not into the cabin
const DOOR_AXIS = (A) => { const a = at(DR.f[0], A(DR.aHi)), b = at(DR.f[1], A(DR.aHi)); return [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; };
const doors = LR((A, side, sg) => {
  const seam = (name, pts) => tube(name + ' (' + side + ')', pts, 0.0026, { role: 'nacelle', paint: 'seam', sh: 0.4, sides: 4, ...FINE });
  return [
    seam('door front seam', roundF(DR.f[1], range(A(DR.aLo), A(DR.aHi), 12), 0.0026)),
    seam('door rear seam', roundF(DR.f[0], range(A(DR.aLo), A(DR.aHi), 12), 0.0026)),
    seam('door sill seam', alongF(range(DR.f[0], DR.f[1], 10), A(DR.aLo), 0.0026)),
    // The hinges, on the roof rail: that's what makes it a gull wing.
    ...[DR.f[0] + 0.08, DR.f[1] - 0.08].map((f) => tube('door hinge (' + side + ')', [at(f, A(DR.aHi - 3), 0.003), at(f, A(DR.aHi + 3), 0.006)], 0.007, { role: 'nacelle', paint: 'metal', sh: 0.8, sides: 6, ...FINE })),
    // The opening behind the door: a dark aperture, parked inside the shell while the door is shut
    // and brought out flush as it starts to open, so the open door shows a hole and not more body.
    poly('door aperture (' + side + ')', patch(range(DR.f[0] + 0.004, DR.f[1] - 0.004, 6), range(A(DR.aLo + 3), A(DR.aHi - 3), 6), { paint: 'interior', sh: 0.12 }, 0.0028),
      { ...FINE, anim: { ch: 'door', slide: [0, R(-sg * 0.04), 0], span: [0.06, 0], def: 0 } }),
    // The door itself: the skin below the waist and the glass above it, a hair proud of the body and
    // its seams, lifted up on the hinge line along the roof rail.
    poly('door leaf (' + side + ')', [
      ...patch(range(DR.f[0] + 0.003, DR.f[1] - 0.003, 6), range(A(DR.aLo + 2), A(SG_.a[0]), 3), { paint: 'hull', sh: 0.62 }, 0.0034),
      ...patch(range(Math.max(DR.f[0] + 0.003, SG_.f[0]), Math.min(DR.f[1] - 0.003, SG_.f[1]), 6), range(A(SG_.a[0]), A(Math.min(SG_.a[1], DR.aHi - 2)), 4), { role: 'glass', tint: GLASS, sh: 0.9 }, 0.0034),
      ...patch(range(DR.f[1] - 0.012, DR.f[1] - 0.05, 1), range(A(-4), A(4), 1), { paint: 'seam', sh: 0.3 }, 0.0040),
      ...patch(range(DR.f[1] - 0.016, DR.f[1] - 0.046, 1), range(A(-1.2), A(1.2), 1), { paint: 'led', sh: 1 }, 0.0052),
    ], { ...FINE, anim: { ch: 'door', pivot: P3(at(DR.f[0], A(DR.aHi))), axis: P3(DOOR_AXIS(A)), ang: [0, R(GULL * sg * DOOR_SWING, 1)], def: 0 } }),
    // The NACA duct behind the door: a dark tapered mouth in the flank.
    poly('NACA duct (' + side + ')', [0, 1, 2, 3].map((i) => {
      const f0 = -0.22 - i * 0.025, f1 = f0 - 0.025, w0 = 6 + i * 4, w1 = 6 + (i + 1) * 4;
      return quad(at(f1, A(-w1 + 4), 0.003), at(f0, A(-w0 + 4), 0.003), at(f0, A(w0 + 4), 0.003), at(f1, A(w1 + 4), 0.003), { paint: 'carbon', sh: 0.22 });
    }), FINE),
  ];
});

// ── Lights, vents and trim on the body ──────────────────────────────────────────
const trim = [
  // The headlights: twin slots each side of the knife nose under smoked covers, and the running blade.
  ...LR((A, side) => [
    tube('running light (' + side + ')', alongF([0.775, 0.75, 0.71, 0.665, 0.62], A(14), 0.004), 0.005, { role: 'nacelle', paint: 'led', sh: 1, sides: 5, ...FINE }),
    poly('headlight cover (' + side + ')', patch([0.72, 0.69, 0.66, 0.63], [A(22), A(34), A(46)], { role: 'glass', tint: [40, 46, 54], sh: 0.85 }, 0.003), FINE),
    ...[0.705, 0.665].map((f) => ({ kind: 'drum', name: 'headlight (' + side + ')', f, g: R(at(f, A(34))[1] * 0.97), r: 0.012, n: 10, z: [R(at(f, A(34))[2] - 0.004), R(at(f, A(34))[2] + 0.001)], role: 'nacelle', paint: 'led', sh: { base: 1 }, top: { sh: 1 }, ...FINE })),
  ]),
  // The front intakes: three dark mouths across the chin.
  poly('nose intakes', [[-62, -76], [-82, -98], [-104, -118]].flatMap(([a0, a1]) => patch([0.765, 0.74, 0.70], range(a0, a1, 3), { paint: 'carbon', sh: 0.2 }, 0.0025)), FINE),
  // The splitter lip under the nose.
  poly('splitter', [faceOut([[0.80, -0.04, -0.072], [0.80, 0.04, -0.072], [0.70, 0.20, -0.104], [0.62, 0.22, -0.11], [0.62, -0.22, -0.11], [0.70, -0.20, -0.104]], [0, 0, 1], { paint: 'carbon', sh: 0.5 })], FINE),
  // The engine cover: two banks of louvres either side of the centre panel, eight slats each.
  ...LR((A, side) => [poly('deck louvres (' + side + ')', range(-0.31, -0.62, 7).map((f) => quad(at(f + 0.016, A(58), 0.003), at(f - 0.016, A(58), 0.003), at(f - 0.016, A(78), 0.007), at(f + 0.016, A(78), 0.007), { paint: 'carbon', sh: 0.42 })), FINE)]),
  // The engine cover's shut line round the louvre banks.
  ...LR((A, side) => [tube('deck seam (' + side + ')', alongF(range(-0.29, -0.66, 6), A(54), 0.003), 0.0024, { role: 'nacelle', paint: 'seam', sh: 0.4, sides: 4, ...FINE })]),
  // The roof scoop over the cab, feeding the pusher motor: a low hood with a dark mouth.
  poly('roof scoop', [
    ...patch([-0.10, -0.14, -0.18, -0.22], range(80, 100, 4), { paint: 'hull', sh: 0.86 }, 0.016),
    faceOut([at(-0.10, 80, 0.002), at(-0.10, 100, 0.002), at(-0.10, 100, 0.016), at(-0.10, 80, 0.016)], [1, 0, 0], { paint: 'carbon', sh: 0.15 }),
  ], FINE),
  // The tail: four round lamps across a black panel, two each side of the pusher, and a light bar under the wing.
  poly('tail panel', [faceOut([at(-0.795, -20, 0.002), at(-0.795, 20, 0.002), at(-0.795, 160, 0.002), at(-0.795, 200, 0.002)], [-1, 0, 0], { paint: 'carbon', sh: 0.4 })], FINE),
  ...[0.075, 0.13, -0.075, -0.13].map((g) => group('tail lamp', [pod('tail lamp', g, 0.032, [[-0.796, 0.022], [-0.806, 0.02]], { sides: 14, paint: 'taillight', capAft: { kind: 'flat', sh: 1 } })], FINE)),
  tube('tail light bar', [[-0.805, -0.15, 0.072], [-0.805, 0.15, 0.072]], 0.004, { role: 'nacelle', paint: 'taillight', sh: 1, sides: 5, ...FINE }),
  // The diffuser strakes under the tail.
  poly('diffuser', [-0.12, -0.04, 0.04, 0.12].flatMap((g) => [faceOut([[-0.66, g, -0.07], [-0.81, g, -0.03], [-0.81, g, -0.07]], [0, 1, 0], { paint: 'carbon', sh: 0.5 })]), FINE),
  // The Corvane badge on the nose: a small chevron in the trim colour.
  poly('badge', [faceOut([at(0.70, 86, 0.003), at(0.70, 94, 0.003), at(0.67, 90, 0.003)], [0, 0, 1], { paint: 'trim', sh: 1 })], FINE),
];

// ── The ducts: the wheel arches ─────────────────────────────────────────────────
// Each duct is a ring: an outer wall in the body colour, a carbon throat, lips top and bottom, four
// stator vanes and a motor pod in the middle. The fan itself is a rotor the renderer spins.
const D = MERLIN_DUCTS;
function ductRing(cf, cg, n = 24) {
  const faces = [];
  const P = (r, a, h) => [cf + Math.cos(a) * r, cg + Math.sin(a) * r, h];
  const lip = 0.006;
  for (let i = 0; i < n; i++) {
    const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, am = (a0 + a1) / 2;
    const out = [Math.cos(am), Math.sin(am), 0];
    faces.push(faceOut([P(D.rOut, a0, D.h0), P(D.rOut, a1, D.h0), P(D.rOut, a1, D.h1), P(D.rOut, a0, D.h1)], out, { paint: 'hull', sh: 0.62 + 0.3 * Math.max(0, out[0] * 0.5 + out[1] * 0.3) }));
    faces.push(faceOut([P(D.rIn, a0, D.h0), P(D.rIn, a1, D.h0), P(D.rIn, a1, D.h1), P(D.rIn, a0, D.h1)], [-out[0], -out[1], 0], { paint: 'duct', sh: 0.35 }));
    faces.push(faceOut([P(D.rIn, a0, D.h1), P(D.rIn, a1, D.h1), P(D.rOut, a1, D.h1 + lip), P(D.rOut, a0, D.h1 + lip)], [0, 0, 1], { paint: 'trim', sh: 0.9 }));
    faces.push(faceOut([P(D.rIn, a0, D.h0), P(D.rIn, a1, D.h0), P(D.rOut, a1, D.h0), P(D.rOut, a0, D.h0)], [0, 0, -1], { paint: 'carbon', sh: 0.3 }));
  }
  // Four stator vanes from the throat to the motor pod, under the fan.
  for (let k = 0; k < 4; k++) {
    const a = (k + 0.5) * Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a), hv = D.fanH - 0.022;
    const p0 = [cf + ca * 0.03, cg + sa * 0.03], p1 = [cf + ca * D.rIn, cg + sa * D.rIn];
    for (const s of [1, -1]) faces.push(faceOut([[p0[0], p0[1], hv - 0.012], [p1[0], p1[1], hv - 0.012], [p1[0], p1[1], hv + 0.004], [p0[0], p0[1], hv + 0.004]], [-sa * s, ca * s, 0], { paint: 'carbon', sh: 0.45 }));
  }
  return faces;
}
const ducts = mirror('ducts', D.at.flatMap(([f, g], i) => {
  const nm = i ? 'rear' : 'front';
  return [
    poly(nm + ' duct', ductRing(f, g), FINE),
    { kind: 'drum', name: nm + ' fan motor', f, g, r: 0.03, n: 14, z: [R(D.fanH - 0.03), R(D.fanH - 0.004)], role: 'nacelle', paint: 'metal', sh: { base: 0.6, alt: 0.12 }, bottom: { sh: 0.35 }, ...FINE },
    { kind: 'drum', name: nm + ' spinner', f, g, r: 0.018, n: 12, z: [R(D.fanH - 0.004), R(D.fanH + 0.008)], role: 'nacelle', paint: 'trim', sh: { base: 0.85 }, top: { sh: 1 }, ...FINE },
    // The arch's running light: a ring of LED round the top lip's outer edge, nav colours on the fronts.
    tube(nm + ' arch light', range(-70, 70, 10).map((d) => [f + Math.cos((d + (i ? 180 : 0)) * DEG) * (D.rOut + 0.002), g + Math.sin((d + (i ? 180 : 0)) * DEG) * (D.rOut + 0.002), D.h1 - 0.012]), 0.004, { role: 'nacelle', paint: 'led', sh: 1, sides: 5, ...FINE }),
  ];
}));

// ── The sidepods: arch to arch, joining the ducts to the body ─────────────────
// A blade of bodywork along each flank at duct height, with a fender joining it to each arch's
// inner face, so the car reads as one body with its fans in its corners.
const SPG = 0.232;
const sidepods = mirror('sidepods', [
  group('sidepod', [pod('sidepod', 0, -0.07, [[0.40, 0.012, 0, 0.02], [0.36, 0.034, 0, 0.05], [0.24, 0.05, 0, 0.07], [0, 0.056, 0, 0.074], [-0.24, 0.05, 0, 0.07], [-0.36, 0.034, 0, 0.05], [-0.40, 0.012, 0, 0.02]], { sides: 12, paint: 'hull', role: 'body', shade: { base: 0.62, amp: 0.3 } })], { xf: { t: [0, SPG, 0] }, ...FINE }),
  // The fenders: a swept panel from the body's flank over to each arch's top lip.
  ...D.at.map(([f], i) => poly((i ? 'rear' : 'front') + ' fender', [
    faceOut([[f + 0.10, 0.19, -0.02], [f - 0.10, 0.19, -0.02], [f - 0.08, D.at[0][1] - D.rIn, D.h1], [f + 0.08, D.at[0][1] - D.rIn, D.h1]], [0, 0.2, 1], { paint: 'hull', role: 'body', sh: 0.82 }),
    faceOut([[f + 0.10, 0.19, -0.06], [f - 0.10, 0.19, -0.06], [f - 0.08, D.at[0][1] - D.rIn, D.h0 + 0.02], [f + 0.08, D.at[0][1] - D.rIn, D.h0 + 0.02]], [0, 0.2, -1], { paint: 'carbon', sh: 0.35 }),
  ], FINE)),
  ...D.at.map(([f], i) => ({ kind: 'faired', name: (i ? 'rear' : 'front') + ' arch arm', pts: P3s([[f, 0.17, -0.07], [f, D.at[0][1] - D.rIn + 0.004, -0.072]]), chord: 0.17, th: 0.05, role: 'strut', sh: 0.72, paint: 'hull', ...FINE })),
  // The side skirt light, along the sidepod's lower edge.
  tube('skirt light', [[0.33, SPG + 0.05, -0.115], [-0.33, SPG + 0.05, -0.115]], 0.003, { role: 'nacelle', paint: 'led', sh: 1, sides: 5, ...FINE }),
]);

// ── The tail: twin fins, a wing between them, and the pusher duct ───────────────
const PU = MERLIN_PUSHER;
const tail = [
  mirror('fins', [group('fin', [{ kind: 'blade', name: 'fin', paint: 'carbon', role: 'fin', t: 0.008, sh: [0.9, 0.7],
    outline: [[-0.56, 0.10], [-0.72, 0.24], [-0.80, 0.25], [-0.80, 0.06]], edges: [{ a: 1, b: 2, sh: 0.85 }] }], { xf: { t: [0, 0.15, 0] }, ...FINE })]),
  { kind: 'panel', name: 'rear wing', role: 'wing', sh: 0.85, th: 0.01, paint: 'carbon', ...FINE,
    c: [[-0.71, -0.15, 0.225], [-0.71, 0.15, 0.225], [-0.79, 0.15, 0.235], [-0.79, -0.15, 0.235]] },
  // The pusher's ring, faced aft, and its motor.
  poly('pusher duct', range(0, 340, 17).flatMap((d) => {
    const a0 = d * DEG, a1 = (d + 20) * DEG, Pp = (r, a, f) => [f, Math.cos(a) * r, PU.h + Math.sin(a) * r];
    return [
      faceOut([Pp(PU.r + 0.012, a0, PU.f + 0.01), Pp(PU.r + 0.012, a1, PU.f + 0.01), Pp(PU.r + 0.012, a1, PU.f - 0.035), Pp(PU.r + 0.012, a0, PU.f - 0.035)], [0, Math.cos((d + 10) * DEG), Math.sin((d + 10) * DEG)], { paint: 'carbon', sh: 0.6 }),
      faceOut([Pp(PU.r, a0, PU.f - 0.035), Pp(PU.r, a1, PU.f - 0.035), Pp(PU.r + 0.012, a1, PU.f - 0.035), Pp(PU.r + 0.012, a0, PU.f - 0.035)], [-1, 0, 0], { paint: 'metal', sh: 0.7 }),
    ];
  }), FINE),
  { kind: 'drum', name: 'pusher hub', f: 0, g: 0, r: 0.02, n: 10, z: [0, 0.01], role: 'nacelle', paint: 'metal', sh: { base: 0.7 }, ...FINE, xf: undefined },
].filter((p) => p.name !== 'pusher hub');

// ── The yaw thrusters ───────────────────────────────────────────────────────────
// Four small jets on the flanks, a pair at the nose and a pair at the tail, that turn it on the
// spot. Yawing left fires the front-right and the rear-left (`yawL`), right the other two (`yawR`):
// each blows out on the side away from the turn. A nozzle is a dark-throated ring on the skin; its
// plume is a hot cone parked inside the body that slides out of the nozzle as its channel rises
// (cockpit.js classAnim eases the pedal onto it), so a still model shows none.
const JET_R = 0.016, JET_L = 0.12, JET_N = 12;
function jet(name, fj, side, ch) {
  const sg = side, sk = at(fj, side > 0 ? 0 : 180), g0 = sk[1], h0 = sk[2];
  const ringAt = (g, r) => Array.from({ length: JET_N }, (_, k) => { const a = k / JET_N * Math.PI * 2; return [fj + Math.cos(a) * r, g, h0 + Math.sin(a) * r]; });
  const out = [sg, 0, 0].map((v, i) => (i === 1 ? sg : 0));
  // The nozzle: a short collar standing 8 mm proud, its face a dark ring.
  const inner = ringAt(g0 - sg * 0.004, JET_R * 1.15), outer = ringAt(g0 + sg * 0.008, JET_R * 1.15), lip = ringAt(g0 + sg * 0.008, JET_R * 0.75);
  const nozzle = [];
  for (let k = 0; k < JET_N; k++) {
    const j = (k + 1) % JET_N, mid = [Math.cos((k + 0.5) / JET_N * Math.PI * 2), 0, Math.sin((k + 0.5) / JET_N * Math.PI * 2)];
    nozzle.push(faceOut([inner[k], inner[j], outer[j], outer[k]], mid, { paint: 'metal', sh: 0.7 }));
    nozzle.push(faceOut([outer[k], outer[j], lip[j], lip[k]], out, { paint: 'carbon', sh: 0.3 }));
  }
  nozzle.push(faceOut(lip.slice(), out, { paint: 'duct', sh: 0.15 }));
  // The plume, parked inside: its root at the nozzle less the travel, its tip JET_L further out.
  const travel = JET_L + 0.012, root = ringAt(g0 - sg * travel, JET_R * 0.85), tip = [fj, g0 - sg * travel + sg * JET_L, h0];
  const plume = [];
  for (let k = 0; k < JET_N; k++) {
    const j = (k + 1) % JET_N, mid = [Math.cos((k + 0.5) / JET_N * Math.PI * 2), sg * 0.2, Math.sin((k + 0.5) / JET_N * Math.PI * 2)];
    plume.push(faceOut([root[k], root[j], tip], mid, { paint: 'jet', sh: 1 }));
  }
  return [
    poly(name + ' nozzle', nozzle, FINE),
    poly(name + ' plume', plume, { ...FINE, anim: { ch, slide: [0, R(sg * travel), 0], def: 0 } }),
  ];
}
const thrusters = [
  ...jet('front right jet', 0.64, 1, 'yawL'), ...jet('rear left jet', -0.66, -1, 'yawL'),
  ...jet('front left jet', 0.64, -1, 'yawR'), ...jet('rear right jet', -0.66, 1, 'yawR'),
];

// ── The feet: three legs with mag-lock pucks ────────────────────────────────────
const GZ = MERLIN_GROUND_H;
const feet = MERLIN_FEET.flatMap(([f, g], i) => [
  tube('foot leg ' + (i + 1), [[f, g, -0.08], [f, g, GZ + 0.016]], 0.009, { role: 'gear', paint: 'metal', sides: 6, ...FINE }),
  { kind: 'drum', name: 'mag-lock puck ' + (i + 1), f, g, r: 0.026, n: 14, z: [R(GZ), R(GZ + 0.016)], role: 'gear', paint: 'puck', sh: { base: 0.5, alt: 0.1 }, top: { sh: 0.75 }, bottom: { sh: 0.2 }, ...FINE },
  { kind: 'drum', name: 'puck ring ' + (i + 1), f, g, r: 0.028, n: 14, z: [R(GZ + 0.004), R(GZ + 0.008)], role: 'gear', paint: 'led', sh: { base: 1 }, ...FINE },
]);

// ── The cabin seen through the glass ───────────────────────────────────────────
// Two bucket seats, a dash and the yoke, for the outside view; the seated cockpit is interior-merlin.js.
const interior = [];
for (const g of [0.098, -0.098]) {
  interior.push(poly('seat', [...boxAt([0.02, g, -0.05], [0.13, 0.11, 0.03], { paint: 'seat' }), ...boxAt([-0.06, g, 0.05], [0.03, 0.11, 0.18], { paint: 'seat' })], FINE));
}
interior.push(poly('dash', boxAt([0.30, 0, 0.06], [0.06, 0.38, 0.04], { paint: 'interior' }), FINE));
interior.push(poly('yoke', boxAt([0.24, 0.098, 0.09], [0.012, 0.10, 0.05], { paint: 'carbon' }), FINE));
interior.push(poly('tunnel', boxAt([0.10, 0, -0.04], [0.40, 0.06, 0.06], { paint: 'interior' }), FINE));

// ── The coarse body, for range ──────────────────────────────────────────────────
const coarse = [
  { kind: 'loft', name: 'body (far)', role: 'body', section: 'super', sides: 14, paint: 'hull', ...COARSE,
    stations: [ST[0], ST[3], ST[5], ST[7], ST[9], ST[11], ST[13], ST[15]].map((s) => ({ f: s.f, rg: s.rg, rvT: s.rvT, rvB: s.rvB, cz: s.cz, boxy: s.boxy })),
    capFore: { kind: 'apex', at: [0.808, 0, -0.045] }, capAft: { kind: 'flat' },
    regions: [{ at: [ST[6].f, ST[7].f], k: [2, 3, 4], role: 'glass', tint: GLASS }] },
  mirror('ducts (far)', D.at.map(([f, g], i) => ({ kind: 'drum', name: (i ? 'rear' : 'front') + ' duct (far)', f, g, r: D.rOut, n: 10, z: [D.h0, D.h1], role: 'nacelle', paint: 'hull', sh: { base: 0.62, alt: 0.12 }, top: { sh: 0.3 }, ...COARSE }))),
  mirror('fins (far)', [group('fin (far)', [{ kind: 'blade', name: 'fin (far)', paint: 'carbon', role: 'fin', t: 0.01, sh: [0.9, 0.7], outline: [[-0.56, 0.10], [-0.74, 0.24], [-0.80, 0.24], [-0.80, 0.06]] }], { xf: { t: [0, 0.15, 0] }, ...COARSE })]),
];

// ── Rotors and lamps ────────────────────────────────────────────────────────────
// Four fans, diagonal pairs turning the same way, the pusher on its own axis.
const rotors = [];
for (const [f, g] of D.at) for (const s of [1, -1]) {
  const r = { at: [f, R(s * g), D.fanH], plane: 'h', r: D.fanR, blades: 7, lead: 0.6, spinMul: 2.6, phase: R((f + s * g) * 3.1) };
  if (s * (f > 0 ? 1 : -1) < 0) r.dir = -1;
  rotors.push(r);
}
// The pusher turns with forward drive, not with the lift fans: the cockpit integrates its angle
// (`pushAng`) and how fast it reads (`push`) off the push on the stick, the airspeed and BOOST.
rotors.push({ at: [PU.f - 0.02, 0, PU.h], plane: 'fore', r: PU.r, blades: 9, lead: 0.5, run: 'push', angle: 'pushAng' });
const lamps = [
  { at: [D.at[0][0] + D.rOut * 0.6, -(D.at[0][1] + D.rOut * 0.8), D.h1 - 0.01], n: [0, -1, 0], rgb: '255,55,55', kind: 'steady' },
  { at: [D.at[0][0] + D.rOut * 0.6, D.at[0][1] + D.rOut * 0.8, D.h1 - 0.01], n: [0, 1, 0], rgb: '60,255,95', kind: 'steady' },
  { at: [0.77, 0.10, -0.03], n: [1, 0, 0], rgb: '236,244,255', kind: 'steady' },
  { at: [0.77, -0.10, -0.03], n: [1, 0, 0], rgb: '236,244,255', kind: 'steady' },
  { at: [-0.80, 0.13, 0.05], n: [-1, 0, 0], rgb: '255,40,40', kind: 'steady' },
  { at: [-0.80, -0.13, 0.05], n: [-1, 0, 0], rgb: '255,40,40', kind: 'steady' },
  { at: [-0.80, 0, 0.24], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
];

const doc = {
  id: 'merlin',
  kind: 'mesh',
  params: {
    name: 'Corvane Merlin',
    note: 'CONCEPT, generated by scripts/shapes/concepts/merlin.mjs (edit that, not this). A two-seat mini VTOL built like a wedge supercar: a knife nose, a cab-forward glasshouse, gull-wing doors hinged on the roof rail, NACA ducts, a louvred engine cover with a roof scoop, four round tail lamps, a wing on stanchions, four ducted fans at the corners where the wheels would be, a pusher between the tail lamps and three feet with mag-lock pucks. 4.6 m long. docs/proposals/road-vtol.md.',
    classFacts: { contactSize: 0.13, modelScale: 0.34, metres: 2.9 },
    groundPitch: 0,
    navLamps: null,
    lamps,
    rotors,
    finish: 'gloss',
    // The four factory paint jobs, picked by a livery's `variant` (content/liveries/aircraft_merlin_*.json).
    // Each sets the slots a player's paint never reaches too: the running lights, the seats seen
    // through the glass, the metal. Rosso is the paints as written below.
    schemes: {
      rosso: {},
      nero: { hull: { rgb: [18, 18, 20] }, trim: { rgb: [168, 150, 255] }, led: { rgb: [186, 168, 255] }, seat: { rgb: [44, 38, 60] }, metal: { rgb: [70, 72, 78] }, puck: { rgb: [40, 36, 54] } },
      giallo: { hull: { rgb: [242, 194, 30] }, trim: { rgb: [20, 20, 22] }, led: { rgb: [255, 238, 200] }, seat: { rgb: [26, 26, 28] }, metal: { rgb: [40, 40, 44] } },
      bianco: { hull: { rgb: [236, 235, 230] }, trim: { rgb: [192, 30, 44] }, led: { rgb: [214, 236, 255] }, seat: { rgb: [120, 22, 28] }, metal: { rgb: [186, 190, 196] }, frame: { rgb: [48, 50, 56] } },
    },
    paints: {
      // The body is a pearl over metal flake, so it sparkles in the sun and isn't one flat red.
      hull: { rgb: [178, 22, 34], livery: 'base', mat: 'pearl', tex: 'flake' },
      trim: { rgb: [236, 232, 224], livery: 'trim', tex: 'paint' },
      frame: { rgb: [20, 22, 26], livery: 'fixed', mat: 'gloss', tex: 'plastic' },
      carbon: { rgb: [30, 32, 36], livery: 'fixed', mat: 'satin', tex: 'carbon' },
      duct: { rgb: [22, 24, 28], livery: 'fixed', mat: 'matte', tex: 'cast' },
      metal: { rgb: [150, 154, 160], livery: 'fixed', mat: 'bare', tex: 'brushed' },
      puck: { rgb: [60, 64, 70], livery: 'fixed', mat: 'rubber', tex: 'rubber' },
      led: { rgb: [210, 236, 255], livery: 'fixed', mat: 'matte' },
      taillight: { rgb: [235, 40, 44], livery: 'fixed', mat: 'gloss', tex: 'plastic' },
      // The yaw thrusters' plume: blue-white, as a hot jet is.
      jet: { rgb: [196, 220, 255], livery: 'fixed', mat: 'gloss' },
      interior: { rgb: [30, 30, 32], livery: 'fixed', mat: 'matte', tex: 'fabric' },
      seat: { rgb: [70, 30, 30], livery: 'fixed', mat: 'satin', tex: 'leather' },
    },
    parts: [
      body, ...glassFrame, ...doors, ...trim, ...thrusters, ducts, sidepods, ...tail, ...feet, ...interior,
      ...coarse,
    ],
  },
};

const v = validateMesh(doc.params, doc.id);
if (v.errors.length) { console.log('ERRORS', v.errors.slice(0, 12)); process.exit(1); }
if (v.warnings?.length) console.log('warnings', v.warnings.slice(0, 8));
const n1 = compileMesh(doc.params, { detail: 1 }).faces.length, n0 = compileMesh(doc.params, { detail: 0 }).faces.length;
writeFileSync(new URL('../../../content/vehicle_models/mesh_merlin.json', import.meta.url), formatMesh(doc));
console.log('mesh_merlin.json:', n1, 'faces near,', n0, 'far');
