// The Hallard Lanner: writes content/vehicle_models/mesh_lanner.json.
//
//   node scripts/shapes/concepts/lanner.mjs
//   then: npm run vehicles:bake
//
// A two-seat mini VTOL built like a long-nosed grand tourer (docs/proposals/hover-cars.md): an oval
// mouth in a chrome ring, round lamps under glass covers, a long bonnet with a power bulge and two
// rows of louvres, the cab two thirds of the way back, a fastback roof running down to a cut-off tail
// with two round lamps a side, chrome quarter bumpers and a chrome strip along each sill. Four ducted
// fans stand at the corners where the wheels would be, the front pair well forward; a pusher sits in
// the tail panel; three feet with mag-lock pucks clamp it to a pad.
//
// ⚠ THIS OVERWRITES THE JSON. Edit this file, not the mesh in the Modelshop.
//
// Two bodies in one file. Everything fine is `minDetail: 1`; a coarse body with `maxDetail: 0`
// stands in at range. The class's shared machinery (fans, jets, feet, doors) is hovercar-lib.mjs.
//
// Frame: f fore, g right, h up, in the units of client/shared/cabin-lanner.js, which states the body,
// the glass, the doors and the ducts once for this file and the cockpit both.
import { hoverCarKit, FINE, COARSE, poly, range, faceOut, boxAt, discAt, R, P3, pod, tube, mirror, group, quad } from './hovercar-lib.mjs';
const { LANNER: C } = await import('../../../client/shared/cabin-lanner.js');

// Green-tinted glass, as old coachbuilt cars had.
const GLASS = [16, 26, 22];
const K = hoverCarKit(C, { glassTint: GLASS });
const { at, patch, alongF, roundF, LR } = K;
const ST = C.stations, D = C.ducts, DR = C.door;
const chrome = (name, pts, r = 0.0045) => tube(name, pts, r, { role: 'nacelle', paint: 'chrome', sh: 0.9, sides: 6, ...FINE });

// ── The body ────────────────────────────────────────────────────────────────────
const body = K.body({
  note: 'The shell. The glass is the loft\'s own faces, glazed (cabin-lanner.js). Seams, louvres, lamps and chrome are separate parts laid a hair proud of it.',
  low: { f: [-0.82, 0.82], a: [243, 297] },
  // The mouth: the nose's own flat end, dark, inside the chrome ring.
  capFore: { kind: 'flat', sh: 0.2, paint: 'duct' },
  capAft: { kind: 'flat', sh: 0.5, paint: 'hull' },
});

// ── The bonnet: a power bulge down the middle and a row of louvres either side ──
const bonnet = [
  group('power bulge', [pod('power bulge', 0, 0, [[0.74, 0.004], [0.66, 0.02], [0.50, 0.03], [0.30, 0.034], [0.16, 0.03]].map(([f, r]) => [f, r, at(f, 90)[2] - r * 0.35, r * 2.6]), { sides: 10, paint: 'hull', role: 'body', shade: { base: 0.7, amp: 0.3 } })], FINE),
  ...LR((A, side) => [
    poly('bonnet louvres (' + side + ')', range(0.52, 0.24, 9).map((f) => quad(at(f + 0.011, A(52), 0.002), at(f - 0.011, A(52), 0.002), at(f - 0.011, A(66), 0.006), at(f + 0.011, A(66), 0.006), { paint: 'duct', sh: 0.3 })), FINE),
    // The bonnet's shut line: it's one piece from the cowl forward, hinged at the nose.
    tube('bonnet seam (' + side + ')', alongF(range(0.16, 0.80, 10), A(24), 0.003), 0.0024, { role: 'nacelle', paint: 'seam', sh: 0.4, sides: 4, ...FINE }),
  ]),
  tube('cowl seam', roundF(0.165, range(24, 156, 14), 0.003), 0.0024, { role: 'nacelle', paint: 'seam', sh: 0.4, sides: 4, ...FINE }),
];

// ── The nose: the mouth's chrome ring, the lamps under their covers, quarter bumpers ──
const noseRing = Array.from({ length: 21 }, (_, k) => { const a = k / 20 * Math.PI * 2, s = ST[0]; return [s.f + 0.004, Math.cos(a) * s.rg * 0.94, s.cz + Math.sin(a) * (Math.sin(a) > 0 ? s.rvT : s.rvB) * 0.9]; });
const nose = [
  chrome('mouth ring', noseRing, 0.006),
  chrome('mouth bar', [[ST[0].f + 0.006, -ST[0].rg * 0.9, ST[0].cz], [ST[0].f + 0.006, ST[0].rg * 0.9, ST[0].cz]], 0.004),
  poly('badge', [faceOut([[0.874, 0, ST[0].cz + 0.016], [0.874, 0.012, ST[0].cz], [0.874, 0, ST[0].cz - 0.016], [0.874, -0.012, ST[0].cz]], [1, 0, 0], { paint: 'trim', sh: 1 }),
    faceOut([[0.8745, -0.014, ST[0].cz - 0.003], [0.8745, 0.014, ST[0].cz - 0.003], [0.8745, 0.014, ST[0].cz + 0.003], [0.8745, -0.014, ST[0].cz + 0.003]], [1, 0, 0], { paint: 'chrome', sh: 1 })], FINE),
  ...LR((A, side, sg) => [
    // The lamp: a round unit set back in the wing under a long glass cover.
    poly('headlamp cover (' + side + ')', patch([0.80, 0.76, 0.72, 0.68], [A(26), A(40), A(54)], { role: 'glass', tint: [70, 78, 76], sh: 0.9 }, 0.003), FINE),
    chrome('headlamp rim (' + side + ')', [...[A(26), A(40), A(54)].map((a) => at(0.80, a, 0.004)), ...[A(54), A(40), A(26)].map((a) => at(0.68, a, 0.004)), at(0.80, A(26), 0.004)], 0.003),
    { kind: 'drum', name: 'headlamp (' + side + ')', f: 0.745, g: R(at(0.745, A(40))[1] * 0.97), r: 0.024, n: 14, z: [R(at(0.745, A(40))[2] - 0.006), R(at(0.745, A(40))[2] + 0.0005)], role: 'nacelle', paint: 'led', sh: { base: 1 }, top: { sh: 1 }, ...FINE },
    // The quarter bumper: a chrome blade round the corner under the lamp.
    chrome('front bumper (' + side + ')', [at(0.872, A(-8), 0.01), at(0.85, A(-6), 0.012), at(0.80, A(-4), 0.012), at(0.74, A(-4), 0.01)].map((q) => [q[0], q[1] + sg * 0.004, q[2]]), 0.008),
    // The sidelight under the lamp.
    poly('sidelight (' + side + ')', patch([0.82, 0.795], [A(8), A(18)], { paint: 'led', sh: 1 }, 0.0035), FINE),
  ]),
];

// ── Flanks: the wing vent, the sill strip, the gutter, the filler cap ────────────
const flanks = LR((A, side) => [
  poly('wing vent (' + side + ')', range(0.30, 0.20, 4).map((f) => quad(at(f + 0.008, A(-16), 0.003), at(f - 0.008, A(-16), 0.003), at(f - 0.008, A(2), 0.006), at(f + 0.008, A(2), 0.006), { paint: 'duct', sh: 0.25 })), FINE),
  chrome('sill strip (' + side + ')', alongF(range(-0.40, 0.40, 10), A(-46), 0.004), 0.0045),
  chrome('gutter (' + side + ')', alongF(range(-0.58, -0.13, 8), A(46), 0.004), 0.0035),
]);

// ── The tail: the cut-off panel, two round lamps a side, bumpers, the boot's shut line ──
const PU = C.pusher, TL = ST[ST.length - 1];
const tail = [
  poly('tail panel', [faceOut([at(TL.f - 0.002, -24, 0), at(TL.f - 0.002, 24, 0), at(TL.f - 0.002, 156, 0), at(TL.f - 0.002, 204, 0)].map((q) => [q[0] - 0.002, q[1] * 0.96, q[2]]), [-1, 0, 0], { paint: 'carbon', sh: 0.45 })], FINE),
  ...[0.085, 0.128, -0.085, -0.128].map((g) => group('tail lamp', [pod('tail lamp', g, TL.cz + 0.052, [[TL.f - 0.003, 0.02], [TL.f - 0.014, 0.018]], { sides: 14, paint: 'taillight', capAft: { kind: 'flat', sh: 1 } })], FINE)),
  ...[0.085, 0.128, -0.085, -0.128].map((g) => chrome('tail lamp rim', Array.from({ length: 15 }, (_, k) => { const a = k / 14 * Math.PI * 2; return [TL.f - 0.006, g + Math.cos(a) * 0.022, TL.cz + 0.052 + Math.sin(a) * 0.022]; }), 0.0028)),
  ...LR((A, side, sg) => [chrome('rear bumper (' + side + ')', [at(-0.76, A(-6), 0.01), at(-0.81, A(-6), 0.012), [TL.f - 0.012, sg * 0.06, TL.cz - 0.012]], 0.008)]),
  tube('boot seam', [...alongF(range(-0.62, -0.80, 4), 128, 0.003), ...alongF(range(-0.80, -0.62, 4), 52, 0.003)], 0.0024, { role: 'nacelle', paint: 'seam', sh: 0.4, sides: 4, ...FINE }),
  poly('number plate', [faceOut([[TL.f - 0.006, -0.05, TL.cz + 0.088], [TL.f - 0.006, 0.05, TL.cz + 0.088], [TL.f - 0.006, 0.05, TL.cz + 0.112], [TL.f - 0.006, -0.05, TL.cz + 0.112]], [-1, 0, 0], { paint: 'trim', sh: 0.95 })], FINE),
  K.pusherDuct('chrome'),
];

// ── The wings over the fans: a swept panel from the flank to each arch ──────────
const wings = mirror('wings', [
  ...D.at.map(([f, g], i) => poly((i ? 'rear' : 'front') + ' wing', [
    faceOut([[f + 0.13, 0.20, -0.012], [f - 0.13, 0.20, -0.012], [f - 0.09, g - D.rIn, D.h1 + 0.004], [f + 0.09, g - D.rIn, D.h1 + 0.004]], [0, 0.2, 1], { paint: 'hull', role: 'body', sh: 0.84 }),
    faceOut([[f + 0.13, 0.20, -0.06], [f - 0.13, 0.20, -0.06], [f - 0.09, g - D.rIn, D.h0 + 0.02], [f + 0.09, g - D.rIn, D.h0 + 0.02]], [0, 0.2, -1], { paint: 'carbon', sh: 0.35 }),
  ], FINE)),
  // The running board between the arches, chrome-edged.
  group('running board', [pod('running board', 0, -0.078, [[0.40, 0.008, 0, 0.016], [0.30, 0.02, 0, 0.04], [0, 0.024, 0, 0.046], [-0.28, 0.02, 0, 0.04], [-0.38, 0.008, 0, 0.016]], { sides: 10, paint: 'hull', role: 'body', shade: { base: 0.62, amp: 0.3 } })], { xf: { t: [0, 0.236, 0] }, ...FINE }),
]);

// ── The coarse body, for range ──────────────────────────────────────────────────
const coarse = K.coarse({ idx: [0, 2, 4, 7, 9, 11, 13, 15, 17], glassAt: [ST[7].f, ST[9].f], capFore: { kind: 'flat' } });

const doc = {
  id: 'lanner',
  kind: 'mesh',
  params: {
    name: 'Hallard Lanner',
    note: 'CONCEPT, generated by scripts/shapes/concepts/lanner.mjs (edit that, not this). A two-seat mini VTOL built like a long-nosed grand tourer: an oval mouth in a chrome ring, round lamps under glass covers, a long louvred bonnet with a power bulge, the cab two thirds back, a fastback roof down to a cut-off tail with two round lamps a side, long front-hinged doors, four ducted fans at the corners where the wheels would be, a pusher in the tail panel and three feet with mag-lock pucks. 4.9 m long. docs/proposals/hover-cars.md.',
    classFacts: { contactSize: 0.13, modelScale: 0.34, metres: 2.9 },
    groundPitch: 0,
    navLamps: null,
    lamps: [
      ...K.navLamps([-0.60, 0, 0.21]),
      { at: [0.80, 0.14, 0.0], n: [1, 0, 0], rgb: '255,240,214', kind: 'steady' },
      { at: [0.80, -0.14, 0.0], n: [1, 0, 0], rgb: '255,240,214', kind: 'steady' },
      { at: [-0.84, 0.107, 0.07], n: [-1, 0, 0], rgb: '255,40,40', kind: 'steady' },
      { at: [-0.84, -0.107, 0.07], n: [-1, 0, 0], rgb: '255,40,40', kind: 'steady' },
    ],
    rotors: K.rotors({ blades: 9 }),
    finish: 'gloss',
    // The four factory paint jobs, picked by a livery's `variant` (content/liveries/aircraft_lanner_*.json).
    // Racing is the paints as written below.
    schemes: {
      racing: {},
      claret: { hull: { rgb: [112, 18, 34] }, trim: { rgb: [236, 226, 204] }, seat: { rgb: [58, 32, 24] } },
      ivory: { hull: { rgb: [232, 224, 204] }, trim: { rgb: [22, 62, 44] }, seat: { rgb: [26, 60, 44] }, interior: { rgb: [60, 46, 34] } },
      midnight: { hull: { rgb: [18, 26, 58] }, trim: { rgb: [198, 204, 214] }, seat: { rgb: [150, 116, 78] }, led: { rgb: [226, 240, 255] } },
    },
    paints: {
      // British racing green, a deep solid colour under a clear coat.
      hull: { rgb: [22, 62, 44], livery: 'base', mat: 'pearl', tex: 'flake' },
      trim: { rgb: [236, 226, 204], livery: 'trim', tex: 'paint' },
      // The brightwork: window frames, bumpers, rings and strips.
      frame: { rgb: [206, 210, 216], livery: 'fixed', mat: 'bare', tex: 'brushed' },
      chrome: { rgb: [214, 218, 224], livery: 'fixed', mat: 'bare', tex: 'brushed' },
      carbon: { rgb: [26, 28, 30], livery: 'fixed', mat: 'satin', tex: 'plastic' },
      seam: { rgb: [12, 14, 14], livery: 'fixed', mat: 'matte' },
      duct: { rgb: [18, 20, 22], livery: 'fixed', mat: 'matte', tex: 'cast' },
      metal: { rgb: [170, 174, 180], livery: 'fixed', mat: 'bare', tex: 'brushed' },
      puck: { rgb: [60, 64, 70], livery: 'fixed', mat: 'rubber', tex: 'rubber' },
      led: { rgb: [255, 240, 214], livery: 'fixed', mat: 'matte' },
      taillight: { rgb: [226, 36, 40], livery: 'fixed', mat: 'gloss', tex: 'plastic' },
      jet: { rgb: [196, 220, 255], livery: 'fixed', mat: 'gloss' },
      interior: { rgb: [44, 34, 26], livery: 'fixed', mat: 'matte', tex: 'fabric' },
      seat: { rgb: [164, 122, 78], livery: 'fixed', mat: 'satin', tex: 'leather' },
    },
    parts: [
      body, ...K.glassFrame(), ...K.mirrors(0.10, 14, 'chrome'), ...K.doors({ sign: -1 }), ...bonnet, ...nose, ...flanks, ...tail,
      ...K.jets(0.70, -0.70), K.ducts({ lip: 'chrome' }), wings, ...K.feet(), ...K.cabinInside({ dashF: 0.02, dashH: 0.07 }),
      ...coarse,
    ],
  },
};
K.finish(doc);
