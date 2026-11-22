// The Minim Pipit: writes content/vehicle_models/mesh_pipit.json.
//
//   node scripts/shapes/concepts/pipit.mjs
//   then: npm run vehicles:bake
//
// A two-seat mini VTOL built like a small upright city car (docs/proposals/hover-cars.md): one box
// four metres long, a short round nose with two round lamps standing out of it and a slot of a mouth,
// the screen starting almost at the nose, deep glass, a roof in a second colour, grey cladding round
// the sills and bumpers, a rub strip down each flank, coach doors, and a flat hatch with an upright
// lamp at each corner. Four small fans are tucked into the corners where the wheels would be, each
// with a ring of light; a pusher sits low in the hatch; three feet with mag-lock pucks clamp it to a pad.
//
// ⚠ THIS OVERWRITES THE JSON. Edit this file, not the mesh in the Modelshop.
//
// Two bodies in one file. Everything fine is `minDetail: 1`; a coarse body with `maxDetail: 0`
// stands in at range. The class's shared machinery (fans, jets, feet, doors) is hovercar-lib.mjs.
//
// Frame: f fore, g right, h up, in the units of client/shared/cabin-pipit.js, which states the body,
// the glass, the doors and the ducts once for this file and the cockpit both.
import { hoverCarKit, FINE, poly, range, faceOut, discAt, R, pod, tube, mirror, group, quad } from './hovercar-lib.mjs';
const { PIPIT: C } = await import('../../../client/shared/cabin-pipit.js');

// A light tint: you can see the people in a Pipit.
const K = hoverCarKit(C, { glassTint: [38, 48, 54] });
const { at, patch, alongF, roundF, LR, bandsIn } = K;
const ST = C.stations, D = C.ducts, TL = ST[ST.length - 1];
const strip = (name, pts, r = 0.005, paint = 'carbon') => tube(name, pts, r, { role: 'nacelle', paint, sh: 0.6, sides: 5, ...FINE });

// ── The body: the roof in the trim colour, grey cladding low down all round ─────
const body = K.body({
  note: 'The shell. The glass is the loft\'s own faces, glazed (cabin-pipit.js). The roof is the loft\'s crown faces in the trim colour. Lamps, strips, seams and the badge are separate parts laid a hair proud of it.',
  low: { f: [-0.69, 0.69], a: [225, 315] },
  regions: [{ at: bandsIn(-0.50, 0.14), k: C.faceKs(45, 135), paint: 'trim' }],
  capFore: { kind: 'apex', at: [0.716, 0, -0.01], paint: 'hull' },
  capAft: { kind: 'flat', sh: 0.5, paint: 'carbon' },
  shade: { base: 0.64, amp: 0.34 },
});

// ── The face: two round lamps standing out of the nose, a slot of a mouth, the badge ──
const lampAt = (sg) => [0.655, sg * 0.14, 0.045];
const face = [
  ...[1, -1].flatMap((sg) => {
    const [f, g, h] = lampAt(sg);
    return [
      group('headlamp', [pod('headlamp', g, h, [[f + 0.045, 0.036], [f, 0.04]], { sides: 16, paint: 'hull', capFore: { kind: 'flat', sh: 1, paint: 'led' } })], FINE),
      tube('headlamp ring', Array.from({ length: 17 }, (_, k) => { const a = k / 16 * Math.PI * 2; return [f + 0.046, g + Math.cos(a) * 0.036, h + Math.sin(a) * 0.036]; }), 0.004, { role: 'nacelle', paint: 'trim', sh: 0.95, sides: 5, ...FINE }),
    ];
  }),
  poly('mouth', patch([0.705, 0.69, 0.672], range(-60, -120, 6), { paint: 'duct', sh: 0.2 }, 0.003), FINE),
  // Minim's badge: a ring on a stem, between the lamps.
  tube('badge ring', Array.from({ length: 13 }, (_, k) => { const a = k / 12 * Math.PI * 2, c = at(0.685, 90, 0.004); return [c[0] + Math.cos(a) * 0.006, Math.sin(a) * 0.014, c[2] + 0.006 + Math.cos(a) * 0.004]; }), 0.003, { role: 'nacelle', paint: 'trim', sh: 1, sides: 5, ...FINE }),
  tube('badge stem', [at(0.672, 86, 0.004), at(0.64, 86, 0.004)].map((q) => [q[0], 0.014, q[2]]), 0.003, { role: 'nacelle', paint: 'trim', sh: 1, sides: 5, ...FINE }),
  ...LR((A, side) => [poly('indicator (' + side + ')', patch([0.66, 0.635], [A(-8), A(4)], { paint: 'amber', sh: 1 }, 0.003), FINE)]),
];

// ── Flanks: a rub strip, the charge port, the door's seams are the kit's ────────
const flanks = LR((A, side) => [
  strip('rub strip (' + side + ')', alongF(range(-0.60, 0.58, 12), A(-18), 0.005), 0.006),
  poly('charge port (' + side + ')', [discAt(at(0.44, A(-2), 0.004), 0.018, [0, side === 'right' ? 1 : -1, 0.1], 12, { paint: 'seam', sh: 0.5 })], FINE),
  strip('roof gutter (' + side + ')', alongF(range(-0.50, 0.14, 8), A(45), 0.004), 0.0035, 'frame'),
]);

// ── The hatch: its shut line, an upright lamp at each corner, a wiper, a small spoiler, the plate ──
const hatch = [
  tube('hatch seam', [...roundF(-0.50, range(40, 140, 10), 0.003), ...alongF(range(-0.50, -0.69, 4), 140, 0.003), ...roundF(-0.69, range(140, 40, 10), 0.003), ...alongF(range(-0.69, -0.50, 4), 40, 0.003)], 0.0024, { role: 'nacelle', paint: 'seam', sh: 0.4, sides: 4, ...FINE }),
  ...LR((A, side) => [poly('tail lamp (' + side + ')', patch([-0.56, -0.61, -0.66], [A(18), A(30), A(42)], { paint: 'taillight', sh: 1 }, 0.003), FINE)]),
  strip('rear wiper', [at(-0.665, 92, 0.004), at(-0.60, 74, 0.004)], 0.0028, 'frame'),
  { kind: 'panel', name: 'roof spoiler', role: 'wing', sh: 0.85, th: 0.008, paint: 'trim', ...FINE,
    c: [[-0.46, -0.19, at(-0.46, 90)[2] + 0.004], [-0.46, 0.19, at(-0.46, 90)[2] + 0.004], [-0.535, 0.19, at(-0.50, 90)[2] + 0.004], [-0.535, -0.19, at(-0.50, 90)[2] + 0.004]] },
  tube('aerial', [at(-0.40, 90, 0.002), [-0.47, 0, at(-0.40, 90)[2] + 0.09]], 0.0022, { role: 'nacelle', paint: 'frame', sides: 4, ...FINE }),
  poly('number plate', [faceOut([[TL.f - 0.004, -0.05, TL.cz + 0.06], [TL.f - 0.004, 0.05, TL.cz + 0.06], [TL.f - 0.004, 0.05, TL.cz + 0.084], [TL.f - 0.004, -0.05, TL.cz + 0.084]], [-1, 0, 0], { paint: 'trim', sh: 0.95 })], FINE),
  K.pusherDuct('carbon'),
];

// ── The arches: a short fairing from the body out over each fan ────────────────
const arches = mirror('arches', D.at.map(([f, g], i) => poly((i ? 'rear' : 'front') + ' arch', [
  faceOut([[f + 0.11, 0.21, -0.02], [f - 0.11, 0.21, -0.02], [f - 0.08, g - D.rIn + 0.01, D.h1 + 0.004], [f + 0.08, g - D.rIn + 0.01, D.h1 + 0.004]], [0, 0.2, 1], { paint: 'carbon', role: 'body', sh: 0.8 }),
  faceOut([[f + 0.11, 0.21, -0.07], [f - 0.11, 0.21, -0.07], [f - 0.08, g - D.rIn + 0.01, D.h0 + 0.02], [f + 0.08, g - D.rIn + 0.01, D.h0 + 0.02]], [0, 0.2, -1], { paint: 'carbon', sh: 0.35 }),
], FINE)));

const coarse = K.coarse({ idx: [0, 2, 3, 5, 7, 9, 11, 13], glassAt: [ST[3].f, ST[5].f], capFore: { kind: 'apex', at: [0.716, 0, -0.01] } });

const doc = {
  id: 'pipit',
  kind: 'mesh',
  params: {
    name: 'Minim Pipit',
    note: 'CONCEPT, generated by scripts/shapes/concepts/pipit.mjs (edit that, not this). A two-seat mini VTOL built like a small upright city car: one box four metres long, a short round nose with two round lamps standing out of it, the screen starting almost at the nose, deep glass, a roof in a second colour, grey cladding, coach doors hinged at the back, a flat hatch with upright lamps, four small ducted fans tucked into the corners where the wheels would be, a pusher low in the hatch and three feet with mag-lock pucks. 4.0 m long. docs/proposals/hover-cars.md.',
    classFacts: { contactSize: 0.13, modelScale: 0.34, metres: 2.9 },
    groundPitch: 0,
    navLamps: null,
    lamps: [
      ...K.navLamps([-0.47, 0, 0.48]),
      { at: [0.71, 0.14, 0.045], n: [1, 0, 0], rgb: '255,244,226', kind: 'steady' },
      { at: [0.71, -0.14, 0.045], n: [1, 0, 0], rgb: '255,244,226', kind: 'steady' },
      { at: [-0.66, 0.2, 0.12], n: [-1, 0, 0], rgb: '255,40,40', kind: 'steady' },
      { at: [-0.66, -0.2, 0.12], n: [-1, 0, 0], rgb: '255,40,40', kind: 'steady' },
    ],
    rotors: K.rotors({ blades: 11, pusherBlades: 9 }),
    finish: 'gloss',
    // The four factory paint jobs, picked by a livery's `variant` (content/liveries/aircraft_pipit_*.json).
    // Mint is the paints as written below.
    schemes: {
      mint: {},
      custard: { hull: { rgb: [242, 214, 110] }, trim: { rgb: [250, 248, 240] } },
      coral: { hull: { rgb: [238, 120, 100] }, trim: { rgb: [240, 236, 224] } },
      slate: { hull: { rgb: [84, 96, 108] }, trim: { rgb: [26, 28, 32] }, seat: { rgb: [96, 100, 108] } },
    },
    paints: {
      hull: { rgb: [150, 214, 186], livery: 'base', mat: 'gloss', tex: 'paint' },
      trim: { rgb: [240, 236, 224], livery: 'trim', tex: 'paint' },
      frame: { rgb: [20, 22, 26], livery: 'fixed', mat: 'satin', tex: 'plastic' },
      // The cladding: unpainted grey plastic, the cheap part you can replace.
      carbon: { rgb: [72, 76, 80], livery: 'fixed', mat: 'matte', tex: 'plastic' },
      seam: { rgb: [30, 32, 36], livery: 'fixed', mat: 'matte' },
      duct: { rgb: [22, 24, 28], livery: 'fixed', mat: 'matte', tex: 'cast' },
      metal: { rgb: [160, 164, 170], livery: 'fixed', mat: 'bare', tex: 'brushed' },
      puck: { rgb: [60, 64, 70], livery: 'fixed', mat: 'rubber', tex: 'rubber' },
      led: { rgb: [255, 244, 226], livery: 'fixed', mat: 'matte' },
      amber: { rgb: [255, 170, 50], livery: 'fixed', mat: 'gloss', tex: 'plastic' },
      taillight: { rgb: [232, 40, 44], livery: 'fixed', mat: 'gloss', tex: 'plastic' },
      jet: { rgb: [196, 220, 255], livery: 'fixed', mat: 'gloss' },
      interior: { rgb: [200, 196, 186], livery: 'fixed', mat: 'matte', tex: 'plastic' },
      seat: { rgb: [170, 172, 176], livery: 'fixed', mat: 'matte', tex: 'fabric' },
    },
    parts: [
      body, ...K.glassFrame({ r: 0.006 }), ...K.mirrors(0.47, 14, 'hull'), ...K.doors({ sign: 1 }), ...face, ...flanks, ...hatch,
      ...K.jets(0.60, -0.60), K.ducts({ wall: 'carbon', lip: 'trim', armG: 0.19, armChord: 0.14 }), arches, ...K.feet(), ...K.cabinInside({ dashF: 0.3, dashH: 0.1, wheelR: 0.05 }),
      ...coarse,
    ],
  },
};
K.finish(doc);
