// The Locust — an Air Tractor AT-802 crop duster.
import { R, P3, loft, pod, foil, ctrlOn, tube, mirror, group, poly, cone, wheel, faired, skin, skinBand, ringBand, DEG, foilPt, lerpSt, legacyFaces, oldStations, oldStation, oldGlass } from './lib.mjs';

export default async function locust() {
  const OLD = await legacyFaces('locust', 1);
  const { FW_ROWS } = await import('../../../client/shared/vehicle-models.js');
  const S0 = [
    { f: 1.0, rg: 0.045, rvT: 0.045, rvB: 0.045, cz: 0.02, boxy: 0.3 },
    { f: 0.96, rg: 0.058, rvT: 0.057, rvB: 0.06, cz: 0.018, boxy: 0.4 },
    { f: 0.88, rg: 0.066, rvT: 0.064, rvB: 0.068, cz: 0.016, boxy: 0.5 },
    { f: 0.78, rg: 0.07, rvT: 0.068, rvB: 0.072, cz: 0.015, boxy: 0.52 },
    { f: 0.7, rg: 0.078, rvT: 0.078, rvB: 0.08, cz: 0.015, boxy: 0.55 },
    { f: 0.64, rg: 0.09, rvT: 0.1, rvB: 0.092, cz: 0.016, boxy: 0.58 },
    { f: 0.56, rg: 0.098, rvT: 0.124, rvB: 0.102, cz: 0.018, boxy: 0.6 },
    { f: 0.48, rg: 0.1, rvT: 0.128, rvB: 0.105, cz: 0.02, boxy: 0.6 },
    { f: 0.36, rg: 0.099, rvT: 0.11, rvB: 0.105, cz: 0.02, boxy: 0.58 },
    { f: 0.2, rg: 0.094, rvT: 0.1, rvB: 0.1, cz: 0.022, boxy: 0.55 },
    { f: 0.0, rg: 0.082, rvT: 0.09, rvB: 0.086, cz: 0.028, boxy: 0.5 },
    { f: -0.2, rg: 0.066, rvT: 0.076, rvB: 0.066, cz: 0.036, boxy: 0.45, minDetail: 1 },
    { f: -0.45, rg: 0.05, rvT: 0.062, rvB: 0.046, cz: 0.044, boxy: 0.4 },
    { f: -0.7, rg: 0.036, rvT: 0.05, rvB: 0.03, cz: 0.05, boxy: 0.34 },
    { f: -0.9, rg: 0.022, rvT: 0.038, rvB: 0.018, cz: 0.052, boxy: 0.28 },
    { f: -0.97, rg: 0.012, rvT: 0.022, rvB: 0.01, cz: 0.052, boxy: 0.2 },
  ];
  // Under the canopy the hull is the fw row's, ring for ring, so the old bubble (and the interior
  // built against it) sits exactly where it always did.
  const keep = oldStations(FW_ROWS['locust']).filter((f) => f >= 0 - 1e-9 && f <= 0.58 + 1e-9);
  const S = [...S0.filter((s) => s.f > 0.58 + 0.03 || s.f < 0 - 0.03), ...keep.map((f) => oldStation(OLD, f, 0.5))].sort((a, b) => b.f - a.f);
  const N = 24;
  const fus = loft('fuselage', N, S, {
    paint: 'hull',
    regions: [{ at: [1.0, 0.96, 0.88, 0.78], k: [5, 6], paint: 'glare' }],
    capAft: { kind: 'apex', at: [-0.99, 0, 0.052] },
  });

  // The cockpit: a tall glass box set up high behind the hopper, for seeing the ground in a turn.
  const cz = 0.1;
  const canopy = poly('canopy (kept from the fw row)', oldGlass(OLD), { exact: true });
  // Wire strike protection: a cutter standing on the windscreen and a cable from it to the fin.
  const wire = group('wire strike kit', [
    tube('wire cutter', [[0.5, 0, cz + 0.05], [0.44, 0, cz + 0.13]], 0.004, { role: 'strut', paint: 'metal' }),
    poly('cutter blade', [{ role: 'strut', paint: 'metal', sh: 0.9, p: [[0.5, 0.002, cz + 0.05], [0.44, 0.002, cz + 0.13], [0.46, 0.002, cz + 0.13], [0.52, 0.002, cz + 0.05]] }]),
    tube('deflector cable', [[0.44, 0, cz + 0.13], [0.2, 0, cz + 0.1], [-0.8, 0, 0.5]], 0.0018, { role: 'strut', paint: 'metal' }),
    mirror('gear cutters', [tube('gear cutter', [[0.25, 0.22, -0.12], [0.28, 0.22, -0.2]], 0.003, { role: 'gear', paint: 'metal' })]),
  ], { minDetail: 1 });

  // The hopper lid on top of the hump, exhaust stacks, the big spinner.
  const lid = poly('hopper lid', [skinBand(S, [0.62, 0.52], 70 * DEG, 110 * DEG, { role: 'body', paint: 'glare', sh: 0.55 }, 0.003)[0]]);
  const stacks = mirror('exhaust stacks', [tube('exhaust stack', [[0.75, 0.066, 0.02], [0.72, 0.09, 0.022], [0.64, 0.1, 0.026]], 0.012, { role: 'nacelle', paint: 'exhaust', sides: 7 })]);
  const intake = pod('intake', 0, -0.045, [[0.94, 0.008, 0, 0.012], [0.92, 0.018, 0, 0.026], [0.84, 0.02, 0, 0.028], [0.78, 0.008, 0.01, 0.014]], { paint: 'glare', sides: 8, role: 'body', capFore: { kind: 'flat', sh: 0.2 } });
  const spinner = cone('spinner', 1.0, 0, 0.02, 0.045, [1.126, 0, 0.02], { paint: 'spinner', n: 12 });
  const stripe = skinBand(S, [0.96, 0.88, 0.78, 0.7, 0.64, 0.56, 0.48, 0.36, 0.2, 0.0, -0.2, -0.45, -0.7], -4 * DEG, 8 * DEG, { role: 'body', paint: 'stripe', sh: 0.84 });

  // Wing: low, straight, constant chord, the spray boom along the trailing edge underneath.
  const W = [
    { g: 0, le: 0.3, te: -0.22, h: -0.09, t: 1.15 },
    { g: 1.1, le: 0.3, te: -0.22, h: -0.058, t: 0.9 },
    { g: 1.14, le: 0.285, te: -0.2, h: -0.056, t: 0.6 },
  ];
  const wing = foil('wing', W, { nx: 11, paint: 'hull', lowerSh: 0.55 });
  const flaps = ctrlOn('flap', W[0], W[1], 0.08, 0.6, 0.26);
  const ailerons = ctrlOn('aileron', W[0], W[1], 0.62, 0.98, 0.26);
  const onWing = (g) => lerpSt(W[0], W[1], g / W[1].g);
  const tipStripe = mirror('wingtip bands', [foil('tip band', [{ ...onWing(0.98), t: 0.93 }, { ...W[1], t: 0.92 }], { paint: 'stripe', nx: 7, tip: false, sides: 1, lodNx: 3 })]);
  const boomF = -0.26, boomZ = (g) => onWing(g).h - 0.055;
  const nozzles = [];
  for (let i = 0; i < 6; i++) { const g = 0.12 + i * 0.16; nozzles.push(tube('nozzle', [[boomF, g, boomZ(g)], [boomF - 0.012, g, boomZ(g) - 0.018]], 0.004, { role: 'gun', paint: 'metal', sides: 4 })); }
  const boom = group('spray boom', [
    mirror('boom', [
      tube('spray boom', [[boomF, 0.04, boomZ(0.04)], [boomF, 0.94, boomZ(0.94)]], 0.006, { role: 'gun', paint: 'metal', sides: 6 }),
      ...[0.3, 0.62, 0.9].map((g) => tube('boom hanger', [[boomF + 0.02, g, onWing(g).h - 0.01], [boomF, g, boomZ(g)]], 0.003, { role: 'gun', paint: 'metal', sides: 4 })),
      ...nozzles,
    ]),
    tube('pump drop', [[0.3, 0, -0.09], [0.3, 0, -0.12]], 0.008, { role: 'gun', paint: 'metal' }),
    cone('pump fan hub', 0.33, 0, -0.13, 0.012, [0.36, 0, -0.13], { paint: 'spinner', n: 6 }),
  ], { minDetail: 1 });

  // Spring-steel main gear, fat tyres, a tailwheel.
  const gear = mirror('main gear', [
    faired('spring leg', [[0.24, 0.1, -0.1], [0.21, 0.3, -0.2]], 0.036, 0.008, { role: 'gear' }),
    wheel('main wheel', [0.205, 0.31, -0.211], 0.042, 0.02, 12),
    pod('wheel fairing', 0.31, -0.2, [[0.26, 0.01], [0.24, 0.03, 0.004], [0.18, 0.034, 0.006], [0.14, 0.012, 0.012]], { paint: 'hull', sides: 8, role: 'nacelle' }),
  ]);
  const tailwheel = group('tailwheel', [
    faired('tailwheel leg', [[-0.86, 0, 0.036], [-0.9, 0, -0.03]], 0.022, 0.008, { role: 'gear' }),
    wheel('tailwheel', [-0.905, 0, -0.041], 0.018, 0.008, 10),
  ]);

  // Tail: braced tailplane and a big fin.
  const T = [
    { g: 0, le: -0.66, te: -0.89, h: 0.068, t: 0.9 },
    { g: 0.4, le: -0.7, te: -0.9, h: 0.068, t: 0.78 },
  ];
  const tailplane = foil('tailplane', T, { role: 'stab', paint: 'hull', nx: 8 });
  const elevators = ctrlOn('elevator', T[0], T[1], 0.06, 0.96, 0.36);
  const stabStruts = mirror('tailplane struts', [tube('tailplane strut', [[-0.74, 0.02, 0.02], [-0.76, 0.26, 0.064]], 0.0035, { role: 'strut', paint: 'metal', minDetail: 1 })]);
  const F = [
    { g: 0.08, le: -0.6, te: -0.94, h: 0, t: 1.0 },
    { g: 0.48, le: -0.8, te: -0.98, h: 0, t: 0.82 },
    { g: 0.52, le: -0.84, te: -0.97, h: 0, t: 0.6 },
  ];
  const fin = foil('fin', F, { axis: 'g', role: 'fin', paint: 'hull', nx: 9 });
  const rudder = ctrlOn('rudder', F[0], F[1], 0.12, 1, 0.36, { axis: 'g', sh: 0.72 });
  const finStripe = poly('fin band', [
    { role: 'fin', paint: 'stripe', sh: 0.84, p: [[-0.68, 0.012, 0.3], [-0.84, 0.01, 0.3], [-0.85, 0.01, 0.36], [-0.71, 0.012, 0.36]] },
    { role: 'fin', paint: 'stripe', sh: 0.64, p: [[-0.71, -0.012, 0.36], [-0.85, -0.01, 0.36], [-0.84, -0.01, 0.3], [-0.68, -0.012, 0.3]] },
  ]);

  const tip = foilPt(W[2], 0.5, 1);
  const bits = [
    wire, lid, stacks, intake, spinner,
    poly('cheatline', stripe), mirror('cheatline other side', [poly('cheatline', stripe)]),
    poly('starboard tip lamp', [{ role: 'window', sh: 1, tint: [46, 190, 78], p: [[tip[0] + 0.03, 1.142, tip[2] - 0.008], [tip[0] - 0.03, 1.142, tip[2] - 0.008], [tip[0] - 0.03, 1.142, tip[2] + 0.004], [tip[0] + 0.03, 1.142, tip[2] + 0.004]] }]),
    poly('port tip lamp', [{ role: 'window', sh: 1, tint: [200, 52, 48], p: [[tip[0] + 0.03, -1.142, tip[2] + 0.004], [tip[0] - 0.03, -1.142, tip[2] + 0.004], [tip[0] - 0.03, -1.142, tip[2] - 0.008], [tip[0] + 0.03, -1.142, tip[2] - 0.008]] }]),
    poly('beacon', [{ role: 'window', tint: [240, 150, 30], sh: 1, p: [[-0.9, 0.006, 0.52], [-0.87, 0.006, 0.52], [-0.87, 0.006, 0.535], [-0.9, 0.006, 0.535]] }, { role: 'window', tint: [240, 150, 30], sh: 1, p: [[-0.9, -0.006, 0.535], [-0.87, -0.006, 0.535], [-0.87, -0.006, 0.52], [-0.9, -0.006, 0.52]] }]),
  ];

  const parts = [fus, canopy, wing, flaps, ailerons, tipStripe, boom, gear, tailwheel, tailplane, elevators, stabStruts, fin, rudder, finStripe, ...bits];
  return {
    id: 'locust', kind: 'mesh',
    params: {
      name: 'Locust',
      note: 'An Air Tractor AT-802: a long slim PT6 cowl with its exhaust stacks bent back, the chemical hopper as a hump ahead of a tall glass cockpit set high for seeing the ground in a turn, a wire cutter on the windscreen and a deflector cable to the fin, a straight low wing with a spray boom and nozzles along its trailing edge and a wind-driven pump under the belly, spring-steel gear on fat tyres, and a braced tail.',
      groundPitch: 10,
      hull: 'fuselage',
      navLamps: P3([tip[0], 1.14, tip[2]]),
      rotors: [{ at: [1.035, 0, 0.02], plane: 'fore', r: 0.26, blades: 5, lead: 0.85 }],
      paints: {
        hull: { rgb: [226, 186, 42], livery: 'base' },
        stripe: { rgb: [36, 92, 58], livery: 'trim' },
        spinner: { rgb: [30, 30, 32], livery: 'fixed' },
        glare: { rgb: [30, 32, 30], livery: 'fixed' },
        frame: { rgb: [40, 42, 40], livery: 'fixed' },
        metal: { rgb: [156, 160, 164], livery: 'fixed' },
        exhaust: { rgb: [82, 68, 58], livery: 'fixed' },
      },
      parts,
    },
  };
}
