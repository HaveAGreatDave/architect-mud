// The Shrike — a Junkers Ju 87 Stuka.
import { R, P3, loft, pod, foil, ctrlOn, tube, mirror, group, poly, cone, wheel, strut, faired, skin, skinBand, ringBand, DEG, foilPt, lerpSt, legacyFaces, oldStations, oldStation, oldGlass } from './lib.mjs';

export default async function shrike() {
  const OLD = await legacyFaces('divebomber', 1);
  const { FW_ROWS } = await import('../../../client/shared/vehicle-models.js');
  const S0 = [
    { f: 1.06, rg: 0.05, rvT: 0.048, rvB: 0.052, cz: -0.035, boxy: 0.2 },
    { f: 1.02, rg: 0.068, rvT: 0.066, rvB: 0.078, cz: -0.03, boxy: 0.32 },
    { f: 0.94, rg: 0.078, rvT: 0.078, rvB: 0.098, cz: -0.024, boxy: 0.42 },
    { f: 0.84, rg: 0.086, rvT: 0.088, rvB: 0.112, cz: -0.018, boxy: 0.48 },
    { f: 0.72, rg: 0.092, rvT: 0.096, rvB: 0.124, cz: -0.01, boxy: 0.52 },
    { f: 0.6, rg: 0.095, rvT: 0.1, rvB: 0.13, cz: -0.004, boxy: 0.55 },
    { f: 0.4, rg: 0.096, rvT: 0.1, rvB: 0.13, cz: 0, boxy: 0.55, minDetail: 1 },
    { f: 0.2, rg: 0.094, rvT: 0.098, rvB: 0.122, cz: 0.005, boxy: 0.54 },
    { f: 0.0, rg: 0.088, rvT: 0.094, rvB: 0.108, cz: 0.012, boxy: 0.52 },
    { f: -0.2, rg: 0.076, rvT: 0.084, rvB: 0.088, cz: 0.02, boxy: 0.5 },
    { f: -0.42, rg: 0.062, rvT: 0.074, rvB: 0.066, cz: 0.03, boxy: 0.46, minDetail: 1 },
    { f: -0.62, rg: 0.05, rvT: 0.064, rvB: 0.048, cz: 0.038, boxy: 0.42 },
    { f: -0.82, rg: 0.036, rvT: 0.052, rvB: 0.032, cz: 0.045, boxy: 0.36 },
    { f: -0.96, rg: 0.022, rvT: 0.036, rvB: 0.018, cz: 0.05, boxy: 0.28 },
  ];
  // Under the canopy the hull is the fw row's, ring for ring, so the old bubble (and the interior
  // built against it) sits exactly where it always did.
  const keep = oldStations(FW_ROWS['divebomber']).filter((f) => f >= -0.35 - 1e-9 && f <= 0.68 + 1e-9);
  const S = [...S0.filter((s) => s.f > 0.68 + 0.03 || s.f < -0.35 - 0.03), ...keep.map((f) => oldStation(OLD, f, 0.46))].sort((a, b) => b.f - a.f);
  const N = 24;
  const fus = loft('fuselage', N, S, {
    paint: 'hull',
    regions: [{ at: S.map((s) => s.f), k: [13, 14, 15, 16, 17, 18, 19, 20, 21, 22], paint: 'belly' }, { at: [1.06, 1.02, 0.94], k: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], paint: 'nose' }],
    capAft: { kind: 'apex', at: [-1.0, 0, 0.05] },
  });

  // The long greenhouse, pilot in front and gunner behind, framed every few inches.
  const cz = 0.078;
  const canopy = poly('canopy (kept from the fw row)', oldGlass(OLD), { exact: true });
  const rearGun = group('rear gun', [
    tube('MG 81Z', [[-0.1, 0.012, cz + 0.03], [-0.26, 0.012, cz + 0.06]], 0.005, { role: 'gun', paint: 'gun', sides: 5 }),
    tube('MG 81Z', [[-0.1, -0.012, cz + 0.03], [-0.26, -0.012, cz + 0.06]], 0.005, { role: 'gun', paint: 'gun', sides: 5 }),
  ], { minDetail: 1 });

  // The chin radiator, exhaust stubs down both sides of the cowl, the spinner.
  const chin = pod('chin radiator', 0, -0.132, [[0.78, 0.01, 0.01, 0.02], [0.75, 0.045, 0, 0.05], [0.6, 0.05, 0, 0.056], [0.42, 0.04, 0.004, 0.05], [0.3, 0.008, 0.02, 0.03]], { paint: 'hull', sides: 12, role: 'body', capFore: { kind: 'flat', sh: 0.2 } });
  const stubs = mirror('exhaust stubs', [0.94, 0.9, 0.86, 0.82, 0.78, 0.74].map((f) => tube('exhaust stub', [[f, 0.084, 0.02], [f - 0.02, 0.1, 0.018]], 0.009, { role: 'nacelle', paint: 'exhaust', sides: 5, minDetail: 1 })));
  const spinner = cone('spinner', 1.06, 0, -0.035, 0.05, [1.175, 0, -0.035], { paint: 'spinner', n: 12 });

  // The inverted gull wing: down to the knee where the legs are, then up to the tips.
  const W = [
    { g: 0, le: 0.3, te: -0.2, h: 0.012, t: 1.25 },
    { g: 0.32, le: 0.29, te: -0.2, h: -0.07, t: 1.15 },
    { g: 1.0, le: 0.21, te: -0.12, h: 0.058, t: 0.85 },
    { g: 1.06, le: 0.18, te: -0.1, h: 0.062, t: 0.55 },
  ];
  const wing = foil('wing', W, { nx: 11, paint: 'hull', lowerSh: 0.55 });
  const onWing = (g) => { const i = g <= W[1].g ? 0 : 1; return lerpSt(W[i], W[i + 1], (g - W[i].g) / (W[i + 1].g - W[i].g)); };
  // The Junkers double wing: flaps and ailerons as separate slim aerofoils hung below and behind
  // the trailing edge, full span.
  const junkers = (role, g0, g1) => {
    const a = onWing(g0), b = onWing(g1), d = 0.012;
    return mirror(role + 's', [{
      kind: 'ctrl', name: role, role, side: 1, sh: 0.76, cf: 1, axis: 'z', half: 0.004,
      le: [P3([a.te + 0.01, g0, a.h - d]), P3([b.te + 0.01, g1, b.h - d])],
      te: [P3([a.te - 0.075, g0, a.h - d - 0.004]), P3([b.te - 0.065, g1, b.h - d - 0.004])],
    }]);
  };
  const flapsIn = junkers('flap', 0.1, 0.32), flapsOut = junkers('flap', 0.34, 0.66), ailerons = junkers('aileron', 0.68, 1.0);
  const hangers = mirror('flap hangers', [0.2, 0.5, 0.84].map((g) => { const s = onWing(g); return tube('flap hanger', [[s.te + 0.02, g, s.h - 0.004], [s.te - 0.005, g, s.h - 0.014]], 0.003, { role: 'strut', paint: 'hull', minDetail: 1 }); }));

  // Dive brakes: a slatted bar under each outer panel, ahead of the flaps.
  const brakes = mirror('dive brakes', [0.44, 0.6].map((g0) => {
    const a = onWing(g0), b = onWing(g0 + 0.14), za = foilPt(a, 0.3, 0)[2] - 0.018, zb = foilPt(b, 0.3, 0)[2] - 0.018;
    const fa = a.le - 0.3 * (a.le - a.te), fb = b.le - 0.3 * (b.le - b.te);
    return poly('dive brake', [
      { role: 'strut', paint: 'glare', sh: 0.5, p: [[fa + 0.012, g0, za], [fb + 0.012, g0 + 0.14, zb], [fb - 0.012, g0 + 0.14, zb], [fa - 0.012, g0, za]] },
      { role: 'strut', paint: 'glare', sh: 0.4, p: [[fa - 0.012, g0, za - 0.002], [fb - 0.012, g0 + 0.14, zb - 0.002], [fb + 0.012, g0 + 0.14, zb - 0.002], [fa + 0.012, g0, za - 0.002]] },
    ], { minDetail: 1 });
  }));

  // Trousered main gear hanging from the knees, with the siren on the leg fairing.
  const kz = -0.07;
  const gear = mirror('main gear', [
    faired('trouser', [[0.2, 0.32, kz - 0.01], [0.215, 0.33, -0.2]], 0.1, 0.03, { role: 'nacelle', paint: 'hull' }),
    pod('wheel spat', 0.33, -0.225, [[0.31, 0.012], [0.28, 0.038, 0.004], [0.2, 0.046, 0.006], [0.14, 0.036, 0.01], [0.1, 0.01, 0.02]], { paint: 'hull', sides: 10, role: 'nacelle' }),
    wheel('main wheel', [0.21, 0.33, -0.24], 0.04, 0.012, 12),
    cone('Jericho siren', 0.3, 0.335, -0.105, 0.012, [0.33, 0.335, -0.105], { paint: 'spinner', n: 6, minDetail: 1 }),
    tube('siren prop', [[0.305, 0.335, -0.125], [0.305, 0.335, -0.085]], 0.0025, { role: 'nacelle', paint: 'gun', minDetail: 1 }),
  ]);
  const tailwheel = group('tailwheel', [
    faired('tailwheel leg', [[-0.84, 0, 0.02], [-0.87, 0, -0.07]], 0.025, 0.01, { role: 'gear' }),
    wheel('tailwheel', [-0.875, 0, -0.082], 0.022, 0.008, 10),
  ]);

  // Tail: a braced tailplane and a big fin.
  const T = [
    { g: 0, le: -0.68, te: -0.9, h: 0.075, t: 0.9 },
    { g: 0.42, le: -0.73, te: -0.92, h: 0.075, t: 0.75 },
  ];
  const tailplane = foil('tailplane', T, { role: 'stab', paint: 'hull', nx: 8 });
  const elevators = ctrlOn('elevator', T[0], T[1], 0.06, 0.95, 0.36);
  const stabStruts = mirror('tailplane struts', [tube('tailplane strut', [[-0.76, 0.03, 0.01], [-0.78, 0.26, 0.07]], 0.004, { role: 'strut', paint: 'hull', minDetail: 1 })]);
  const F = [
    { g: 0.08, le: -0.6, te: -0.97, h: 0, t: 1.0 },
    { g: 0.42, le: -0.76, te: -0.98, h: 0, t: 0.85 },
    { g: 0.5, le: -0.84, te: -0.96, h: 0, t: 0.6 },
  ];
  const fin = foil('fin', F, { axis: 'g', role: 'fin', paint: 'hull', nx: 9 });
  const rudder = ctrlOn('rudder', F[0], F[1], 0.1, 1, 0.38, { axis: 'g', sh: 0.72 });

  // Stores: the big bomb on its swing crutch, and four small ones under the wings.
  const bombZ = -0.18;
  const bomb = group('centreline bomb', [
    pod('SC 500', 0, bombZ, [[0.36, 0.008], [0.32, 0.03], [0.22, 0.038], [0.02, 0.036], [-0.06, 0.02], [-0.1, 0.008]], { paint: 'store', sides: 12 }),
    poly('bomb fins', [
      { role: 'gun', paint: 'store', sh: 0.7, p: [[-0.04, 0, bombZ + 0.02], [-0.11, 0, bombZ + 0.045], [-0.11, 0, bombZ - 0.045], [-0.04, 0, bombZ - 0.02]] },
      { role: 'gun', paint: 'store', sh: 0.6, p: [[-0.04, 0.02, bombZ], [-0.11, 0.045, bombZ], [-0.11, -0.045, bombZ], [-0.04, -0.02, bombZ]] },
    ]),
    mirror('crutch', [tube('swing crutch', [[0.28, 0.03, -0.13], [0.2, 0.03, bombZ + 0.03]], 0.004, { role: 'gun', paint: 'gun' })]),
  ]);
  const wingBombs = mirror('wing bombs', [0.46, 0.62].map((g) => {
    const z = foilPt(onWing(g), 0.4, 0)[2] - 0.035;
    return group('SC 50', [
      pod('SC 50', g, z, [[0.14, 0.004], [0.11, 0.018], [0.02, 0.021], [-0.06, 0.012], [-0.08, 0.004]], { paint: 'store', sides: 8 }),
      tube('rack', [[0.06, g, z + 0.018], [0.04, g, z + 0.032]], 0.004, { role: 'gun', paint: 'gun' }),
    ], { minDetail: 1 });
  }));

  const tip = foilPt(W[3], 0.5, 1);
  const bits = [
    rearGun, chin, stubs, spinner,
    poly('fuselage band', ringBand(S, -0.42, -0.5, 16, { role: 'body', paint: 'band', sh: 0.8 })),
    tube('aerial mast', [[-0.02, 0, cz + 0.07], [-0.04, 0, cz + 0.11]], 0.003, { role: 'strut', paint: 'glare', minDetail: 1 }),
    tube('aerial wire', [[-0.04, 0, cz + 0.11], [-0.86, 0, 0.5]], 0.0018, { role: 'strut', paint: 'glare', minDetail: 1 }),
    poly('starboard tip lamp', [{ role: 'window', sh: 1, tint: [46, 190, 78], p: [[tip[0] + 0.03, 1.062, tip[2] - 0.008], [tip[0] - 0.03, 1.062, tip[2] - 0.008], [tip[0] - 0.03, 1.062, tip[2] + 0.004], [tip[0] + 0.03, 1.062, tip[2] + 0.004]] }]),
    poly('port tip lamp', [{ role: 'window', sh: 1, tint: [200, 52, 48], p: [[tip[0] + 0.03, -1.062, tip[2] + 0.004], [tip[0] - 0.03, -1.062, tip[2] + 0.004], [tip[0] - 0.03, -1.062, tip[2] - 0.008], [tip[0] + 0.03, -1.062, tip[2] - 0.008]] }]),
  ];

  const parts = [fus, canopy, wing, flapsIn, flapsOut, ailerons, hangers, brakes, gear, tailwheel, tailplane, elevators, stabStruts, fin, rudder, bomb, wingBombs, ...bits];
  return {
    id: 'divebomber', kind: 'mesh',
    params: {
      name: 'Shrike',
      note: 'A Junkers Ju 87 Stuka: a slab-sided fuselage behind an inline engine with its radiator slung under the chin, a long framed greenhouse for pilot and rear gunner, an inverted gull wing whose knees carry trousered fixed gear (with a siren on each leg), Junkers double-wing flaps and ailerons hung below the trailing edge, slatted dive brakes, a braced tailplane, and a big bomb on its swing crutch.',
      groundPitch: 9,
      hull: 'fuselage',
      navLamps: P3([tip[0], 1.06, tip[2]]),
      rotors: [{ at: [1.075, 0, -0.035], plane: 'fore', r: 0.3, blades: 3, lead: 0.85 }],
      paints: {
        hull: { rgb: [74, 88, 64], livery: 'base' },
        belly: { rgb: [132, 160, 184], livery: 'trim' },
        nose: { rgb: [214, 178, 52], livery: 'fixed' },
        band: { rgb: [214, 178, 52], livery: 'fixed' },
        spinner: { rgb: [66, 78, 58], livery: 'base' },
        frame: { rgb: [60, 70, 54], livery: 'base' },
        glare: { rgb: [34, 36, 34], livery: 'fixed' },
        gun: { rgb: [40, 40, 42], livery: 'fixed' },
        exhaust: { rgb: [78, 64, 56], livery: 'fixed' },
        store: { rgb: [70, 76, 60], livery: 'fixed' },
      },
      parts,
    },
  };
}
