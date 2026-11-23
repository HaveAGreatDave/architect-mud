// The Brakk Wolverine: writes content/vehicle_models/mesh_wolverine.json.
//
//   node scripts/shapes/concepts/wolverine.mjs
//   then: npm run vehicles:bake
//
// A two-seat mini VTOL built like a muscle car (docs/proposals/hover-cars.md): square and wide, a
// blunt nose that is one grille with four lamps set into it over a steel bumper, a flat bonnet with a
// scoop standing through it and two pins, twin stripes nose to tail, a short strip of glass over a
// high waist, a lip spoiler and a flat tail with one light bar from side to side. Brakk leaves the
// weld seams showing: a bead runs along each top corner of the body and round each fan's housing.
// The four fans are the biggest in the class and their housings stand proud; a pusher sits in the
// tail panel; three feet with mag-lock pucks clamp it to a pad.
//
// ⚠ THIS OVERWRITES THE JSON. Edit this file, not the mesh in the Modelshop.
//
// Two bodies in one file. Everything fine is `minDetail: 1`; a coarse body with `maxDetail: 0`
// stands in at range. The class's shared machinery (fans, jets, feet, doors) is hovercar-lib.mjs.
//
// Frame: f fore, g right, h up, in the units of client/shared/cabin-wolverine.js, which states the
// body, the glass, the doors and the ducts once for this file and the cockpit both.
import { hoverCarKit, emblem, FINE, poly, range, faceOut, boxAt, discAt, R, tube, mirror, quad } from './hovercar-lib.mjs';
const { WOLVERINE: C } = await import('../../../client/shared/cabin-wolverine.js');

const K = hoverCarKit(C, { glassTint: [10, 10, 12] });
const { at, patch, alongF, roundF, LR } = K;
const ST = C.stations, D = C.ducts, N0 = ST[0], TL = ST[ST.length - 1];
const steel = (name, pts, r = 0.005, sides = 6) => tube(name, pts, r, { role: 'nacelle', paint: 'metal', sh: 0.8, sides, ...FINE });
const bead = (name, pts) => tube(name, pts, 0.0032, { role: 'nacelle', paint: 'weld', sh: 0.7, sides: 5, ...FINE });

// ── The body ────────────────────────────────────────────────────────────────────
const body = K.body({
  note: 'The shell. The glass is the loft\'s own faces, glazed (cabin-wolverine.js). The grille, the scoop, the stripes, the weld beads and the lamps are separate parts laid a hair proud of it.',
  low: { f: [-0.81, 0.81], a: [234, 306] },
  // The nose's flat end is the grille's dark back.
  capFore: { kind: 'flat', sh: 0.18, paint: 'duct' },
  capAft: { kind: 'flat', sh: 0.45, paint: 'carbon' },
  shade: { base: 0.58, amp: 0.4 },
});

// ── The nose: a grille of steel bars with four lamps in it, over a bumper ───────
const gz = (t) => N0.cz + t * N0.rvT * 0.8, gw = N0.rg * 0.9;
const nose = [
  ...range(-0.7, 0.7, 6).map((t) => steel('grille bar', [[N0.f + 0.004, -gw, gz(t)], [N0.f + 0.004, gw, gz(t)]], 0.0035, 4)),
  steel('grille surround', [[N0.f + 0.004, -gw, gz(-0.85)], [N0.f + 0.004, gw, gz(-0.85)], [N0.f + 0.004, gw, gz(0.85)], [N0.f + 0.004, -gw, gz(0.85)], [N0.f + 0.004, -gw, gz(-0.85)]], 0.006),
  ...[-0.185, -0.125, 0.125, 0.185].flatMap((g, i) => [
    poly('headlamp', [discAt([N0.f + 0.009, g, gz(0.05)], 0.026, [1, 0, 0], 14, { paint: 'led', sh: 1 })], FINE),
    steel('headlamp rim', Array.from({ length: 15 }, (_, k) => { const a = k / 14 * Math.PI * 2; return [N0.f + 0.009, g + Math.cos(a) * 0.027, gz(0.05) + Math.sin(a) * 0.027]; }), 0.004),
  ]),
  // Brakk's beast's head, jaw open, on a plate in the middle of the grille.
  poly('badge', [faceOut([[N0.f + 0.0105, -0.036, gz(-0.55)], [N0.f + 0.0105, 0.036, gz(-0.55)], [N0.f + 0.0105, 0.036, gz(0.55)], [N0.f + 0.0105, -0.036, gz(0.55)]], [1, 0, 0], { paint: 'carbon', sh: 0.6 }), ...emblem('brakk', [N0.f + 0.011, 0, gz(0)], 0.028, { field: 'carbon', mark: 'metal' })], FINE),
  // The bumper: one steel bar the width of the car, on two brackets.
  steel('front bumper', [[N0.f + 0.02, -0.25, N0.cz - N0.rvB * 0.75], [N0.f + 0.02, 0.25, N0.cz - N0.rvB * 0.75]], 0.014, 8),
  ...[-0.16, 0.16].map((g) => steel('bumper bracket', [[N0.f - 0.01, g, N0.cz - N0.rvB * 0.75], [N0.f + 0.02, g, N0.cz - N0.rvB * 0.75]], 0.006)),
];

// ── The bonnet: the scoop through it, two pins, and the stripes that run on over the roof and deck ──
const stripe = (name, f0, f1, n) => poly(name, [[80.5, 87.5], [92.5, 99.5]].flatMap(([a0, a1]) => patch(range(f0, f1, n), [a0, a1], { paint: 'trim', sh: 0.92 }, 0.0026)), FINE);
const SC = { f0: 0.50, f1: 0.30, g: 0.075, h: 0.05 };
const scoopBase = at((SC.f0 + SC.f1) / 2, 90)[2];
const bonnet = [
  stripe('bonnet stripes', 0.19, 0.80, 8), stripe('roof stripes', -0.36, -0.08, 4), stripe('deck stripes', -0.80, -0.57, 4),
  // The scoop: a matte box standing through a hole in the bonnet, its mouth open to the front.
  poly('scoop', [
    ...boxAt([(SC.f0 + SC.f1) / 2, 0, scoopBase + SC.h / 2 - 0.004], [SC.f0 - SC.f1, SC.g * 2, SC.h], { paint: 'carbon' }),
    faceOut([[SC.f0 + 0.001, -SC.g + 0.01, scoopBase + 0.008], [SC.f0 + 0.001, SC.g - 0.01, scoopBase + 0.008], [SC.f0 + 0.001, SC.g - 0.01, scoopBase + SC.h - 0.012], [SC.f0 + 0.001, -SC.g + 0.01, scoopBase + SC.h - 0.012]], [1, 0, 0], { paint: 'duct', sh: 0.1 }),
    ...[-0.04, 0, 0.04].map((g) => faceOut([[SC.f0 + 0.002, g - 0.003, scoopBase + 0.008], [SC.f0 + 0.002, g + 0.003, scoopBase + 0.008], [SC.f0 + 0.002, g + 0.003, scoopBase + SC.h - 0.012], [SC.f0 + 0.002, g - 0.003, scoopBase + SC.h - 0.012]], [1, 0, 0], { paint: 'metal', sh: 0.8 })),
  ], FINE),
  ...[-0.17, 0.17].map((g) => ({ kind: 'drum', name: 'bonnet pin', f: 0.72, g, r: 0.01, n: 8, z: [R(at(0.72, 90)[2] - 0.002), R(at(0.72, 90)[2] + 0.006)], role: 'nacelle', paint: 'metal', sh: { base: 0.85 }, top: { sh: 1 }, ...FINE })),
  tube('bonnet seam', [...alongF(range(0.20, 0.78, 8), 50, 0.003), ...alongF(range(0.78, 0.20, 8), 130, 0.003)], 0.0024, { role: 'nacelle', paint: 'seam', sh: 0.4, sides: 4, ...FINE }),
];

// ── The weld beads: along each top corner of the body, nose to tail ─────────────
const welds = LR((A, side) => [
  bead('bonnet weld (' + side + ')', alongF(range(0.19, 0.80, 10), A(40), 0.003)),
  bead('deck weld (' + side + ')', alongF(range(-0.80, -0.57, 5), A(40), 0.003)),
  bead('sill weld (' + side + ')', alongF(range(-0.78, 0.78, 14), A(-54), 0.003)),
]);

// ── Flanks: three gills behind the front fan, a scoop ahead of the rear one, the charge flap ──
const flanks = LR((A, side) => [
  poly('gills (' + side + ')', range(0.33, 0.25, 2).map((f) => quad(at(f + 0.012, A(-14), 0.0026), at(f - 0.006, A(-14), 0.0026), at(f + 0.004, A(8), 0.0026), at(f + 0.022, A(8), 0.0026), { paint: 'trim', sh: 0.9 })), FINE),
  poly('quarter scoop (' + side + ')', patch([-0.44, -0.40, -0.36], [A(-12), A(-2), A(8)], { paint: 'duct', sh: 0.2 }, 0.003), FINE),
  steel('quarter scoop lip (' + side + ')', roundF(-0.44, [A(-12), A(-2), A(8)], 0.005), 0.004),
  poly('charge flap (' + side + ')', patch([-0.66, -0.62], [A(4), A(12)], { paint: 'seam', sh: 0.5 }, 0.0028), FINE),
]);

// ── The tail: one light bar side to side, a lip spoiler, a bumper, the plate ────
const tail = [
  poly('tail light bar', [faceOut([[TL.f - 0.004, -0.2, TL.cz + 0.045], [TL.f - 0.004, 0.2, TL.cz + 0.045], [TL.f - 0.004, 0.2, TL.cz + 0.078], [TL.f - 0.004, -0.2, TL.cz + 0.078]], [-1, 0, 0], { paint: 'taillight', sh: 1 })], FINE),
  ...range(-0.2, 0.2, 8).map((g) => steel('tail bar divider', [[TL.f - 0.006, g, TL.cz + 0.045], [TL.f - 0.006, g, TL.cz + 0.078]], 0.0025, 4)),
  steel('tail bar surround', [[TL.f - 0.005, -0.204, TL.cz + 0.042], [TL.f - 0.005, 0.204, TL.cz + 0.042], [TL.f - 0.005, 0.204, TL.cz + 0.081], [TL.f - 0.005, -0.204, TL.cz + 0.081], [TL.f - 0.005, -0.204, TL.cz + 0.042]], 0.004),
  { kind: 'panel', name: 'lip spoiler', role: 'wing', sh: 0.85, th: 0.012, paint: 'hull', ...FINE,
    c: [[-0.73, -0.262, at(-0.73, 90)[2] + 0.004], [-0.73, 0.262, at(-0.73, 90)[2] + 0.004], [-0.83, 0.262, at(-0.80, 90)[2] + 0.034], [-0.83, -0.262, at(-0.80, 90)[2] + 0.034]] },
  steel('rear bumper', [[TL.f - 0.02, -0.24, TL.cz - TL.rvB * 0.7], [TL.f - 0.02, 0.24, TL.cz - TL.rvB * 0.7]], 0.014, 8),
  poly('number plate', [faceOut([[TL.f - 0.006, -0.05, TL.cz - 0.03], [TL.f - 0.006, 0.05, TL.cz - 0.03], [TL.f - 0.006, 0.05, TL.cz - 0.006], [TL.f - 0.006, -0.05, TL.cz - 0.006]], [-1, 0, 0], { paint: 'trim', sh: 0.95 })], FINE),
  K.pusherDuct('metal'),
];

// ── The housings: each fan in a square-shouldered box off the flank, a weld bead round its top ──
const housings = mirror('housings', D.at.flatMap(([f, g], i) => {
  const nm = i ? 'rear' : 'front';
  return [
    poly(nm + ' flare', [
      faceOut([[f + 0.15, 0.24, 0.0], [f - 0.15, 0.24, 0.0], [f - 0.11, g - D.rIn, D.h1 + 0.004], [f + 0.11, g - D.rIn, D.h1 + 0.004]], [0, 0.2, 1], { paint: 'hull', role: 'body', sh: 0.84 }),
      faceOut([[f + 0.15, 0.24, 0.0], [f + 0.11, g - D.rIn, D.h1 + 0.004], [f + 0.11, g - D.rIn, D.h0 + 0.02], [f + 0.15, 0.24, -0.07]], [1, 0.2, 0], { paint: 'hull', role: 'body', sh: 0.7 }),
      faceOut([[f - 0.15, 0.24, 0.0], [f - 0.11, g - D.rIn, D.h1 + 0.004], [f - 0.11, g - D.rIn, D.h0 + 0.02], [f - 0.15, 0.24, -0.07]], [-1, 0.2, 0], { paint: 'hull', role: 'body', sh: 0.52 }),
      faceOut([[f + 0.15, 0.24, -0.07], [f - 0.15, 0.24, -0.07], [f - 0.11, g - D.rIn, D.h0 + 0.02], [f + 0.11, g - D.rIn, D.h0 + 0.02]], [0, 0.2, -1], { paint: 'carbon', sh: 0.35 }),
    ], FINE),
    bead(nm + ' housing weld', Array.from({ length: 25 }, (_, k) => { const a = k / 24 * Math.PI * 2; return [f + Math.cos(a) * (D.rOut + 0.001), g + Math.sin(a) * (D.rOut + 0.001), D.h1 - 0.006]; })),
    // A steel guard bar across the outside of each housing, as on a freight fan.
    steel(nm + ' guard', range(-50, 50, 8).map((d) => [f + Math.sin(d * Math.PI / 180) * (D.rOut + 0.012), g + Math.cos(d * Math.PI / 180) * (D.rOut + 0.012), (D.h0 + D.h1) / 2]), 0.006),
  ];
}));

const coarse = K.coarse({ idx: [0, 1, 3, 5, 7, 8, 10, 12, 14, 15], glassAt: [ST[5].f, ST[7].f], capFore: { kind: 'flat' } });

const doc = {
  id: 'wolverine',
  kind: 'mesh',
  params: {
    name: 'Brakk Wolverine',
    note: 'CONCEPT, generated by scripts/shapes/concepts/wolverine.mjs (edit that, not this). A two-seat mini VTOL built like a muscle car: square and wide, a blunt nose that is one grille with four lamps in it over a steel bumper, a flat bonnet with a scoop through it, twin stripes nose to tail, a short strip of glass over a high waist, scissor doors, a lip spoiler, one tail light bar side to side, weld beads left showing, the biggest fans in the class in square-shouldered housings, a pusher in the tail panel and three feet with mag-lock pucks. 4.7 m long. docs/proposals/hover-cars.md.',
    classFacts: { contactSize: 0.13, modelScale: 0.34, metres: 2.9 },
    groundPitch: 0,
    navLamps: null,
    lamps: [
      ...K.navLamps([-0.78, 0, 0.17]),
      { at: [0.84, 0.155, -0.015], n: [1, 0, 0], rgb: '236,244,255', kind: 'steady' },
      { at: [0.84, -0.155, -0.015], n: [1, 0, 0], rgb: '236,244,255', kind: 'steady' },
      { at: [-0.83, 0.15, 0.07], n: [-1, 0, 0], rgb: '255,40,40', kind: 'steady' },
      { at: [-0.83, -0.15, 0.07], n: [-1, 0, 0], rgb: '255,40,40', kind: 'steady' },
    ],
    rotors: K.rotors({ blades: 5, pusherBlades: 7 }),
    finish: 'gloss',
    // The four factory paint jobs, picked by a livery's `variant` (content/liveries/aircraft_wolverine_*.json).
    // Orange is the paints as written below. Primer is the car as it leaves the welding bay.
    schemes: {
      orange: {},
      black: { hull: { rgb: [18, 18, 20] }, trim: { rgb: [226, 92, 22] }, seat: { rgb: [26, 24, 24] } },
      primer: { hull: { rgb: [122, 126, 128], mat: 'matte', tex: 'paint' }, trim: { rgb: [22, 22, 24] }, weld: { rgb: [196, 150, 96] } },
      plum: { hull: { rgb: [72, 24, 84] }, trim: { rgb: [236, 232, 224] }, seat: { rgb: [30, 22, 32] } },
    },
    paints: {
      hull: { rgb: [226, 92, 22], livery: 'base', mat: 'gloss', tex: 'paint' },
      trim: { rgb: [16, 16, 18], livery: 'trim', tex: 'paint' },
      frame: { rgb: [18, 18, 20], livery: 'fixed', mat: 'satin', tex: 'plastic' },
      carbon: { rgb: [22, 22, 24], livery: 'fixed', mat: 'matte', tex: 'cast' },
      seam: { rgb: [10, 10, 12], livery: 'fixed', mat: 'matte' },
      duct: { rgb: [14, 14, 16], livery: 'fixed', mat: 'matte', tex: 'cast' },
      // Bare steel: the bumpers, the grille, the guards. The weld beads are the same steel, blued by the heat.
      metal: { rgb: [156, 158, 162], livery: 'fixed', mat: 'bare', tex: 'brushed' },
      weld: { rgb: [118, 124, 140], livery: 'fixed', mat: 'bare', tex: 'cast' },
      puck: { rgb: [60, 64, 70], livery: 'fixed', mat: 'rubber', tex: 'rubber' },
      led: { rgb: [236, 244, 255], livery: 'fixed', mat: 'matte' },
      taillight: { rgb: [232, 34, 38], livery: 'fixed', mat: 'gloss', tex: 'plastic' },
      jet: { rgb: [196, 220, 255], livery: 'fixed', mat: 'gloss' },
      interior: { rgb: [22, 22, 24], livery: 'fixed', mat: 'matte', tex: 'fabric' },
      seat: { rgb: [28, 28, 30], livery: 'fixed', mat: 'satin', tex: 'leather' },
    },
    parts: [
      body, ...K.glassFrame({ r: 0.0065 }), ...K.mirrors(0.14, 22, 'metal'), ...K.doors({ sign: 1 }), ...nose, ...bonnet, ...welds, ...flanks, ...tail,
      ...K.jets(0.70, -0.70), K.ducts({ lip: 'metal', archLight: false, armG: 0.2, armChord: 0.22 }), housings, ...K.feet(), ...K.cabinInside({ dashF: 0.06, dashH: 0.08, wheelR: 0.05 }),
      ...coarse,
    ],
  },
};
K.finish(doc);
