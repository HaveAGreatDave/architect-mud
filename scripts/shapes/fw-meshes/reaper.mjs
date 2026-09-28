// The Reaper — an A-10 Thunderbolt II.
import { R, P3, loft, pod, foil, ctrlOn, tube, mirror, group, poly, cone, wheel, strut, faired, skin, skinBand, DEG, foilPt, lerpSt, legacyFaces, oldStations, oldStation, oldGlass } from './lib.mjs';

export default async function reaper() {
  const OLD = await legacyFaces('gunship', 1);
  const { FW_ROWS } = await import('../../../client/shared/vehicle-models.js');
  const S0 = [
    { f: 1.0, rg: 0.026, rvT: 0.028, rvB: 0.026, cz: -0.028, boxy: 0.1 },
    { f: 0.96, rg: 0.05, rvT: 0.052, rvB: 0.056, cz: -0.02, boxy: 0.2 },
    { f: 0.88, rg: 0.074, rvT: 0.076, rvB: 0.086, cz: -0.01, boxy: 0.3 },
    { f: 0.78, rg: 0.09, rvT: 0.094, rvB: 0.11, cz: 0, boxy: 0.36 },
    { f: 0.66, rg: 0.1, rvT: 0.112, rvB: 0.128, cz: 0.004, boxy: 0.4 },
    { f: 0.5, rg: 0.108, rvT: 0.118, rvB: 0.138, cz: 0.005, boxy: 0.43 },
    { f: 0.3, rg: 0.112, rvT: 0.118, rvB: 0.138, cz: 0.006, boxy: 0.45, minDetail: 1 },
    { f: 0.1, rg: 0.108, rvT: 0.114, rvB: 0.132, cz: 0.01, boxy: 0.45 },
    { f: -0.1, rg: 0.098, rvT: 0.106, rvB: 0.118, cz: 0.02, boxy: 0.45 },
    { f: -0.3, rg: 0.084, rvT: 0.096, rvB: 0.094, cz: 0.034, boxy: 0.42 },
    { f: -0.5, rg: 0.068, rvT: 0.082, rvB: 0.07, cz: 0.048, boxy: 0.38 },
    { f: -0.7, rg: 0.052, rvT: 0.066, rvB: 0.05, cz: 0.058, boxy: 0.32, minDetail: 1 },
    { f: -0.88, rg: 0.038, rvT: 0.05, rvB: 0.034, cz: 0.064, boxy: 0.26 },
    { f: -1.0, rg: 0.02, rvT: 0.028, rvB: 0.02, cz: 0.064, boxy: 0.2 },
  ];
  // Under the canopy the hull is the fw row's, ring for ring, so the old bubble (and the interior
  // built against it) sits exactly where it always did.
  const keep = oldStations(FW_ROWS['gunship']).filter((f) => f >= 0 - 1e-9 && f <= 0.66 + 1e-9);
  const S = [...S0.filter((s) => s.f > 0.66 + 0.03 || s.f < 0 - 0.03), ...keep.map((f) => oldStation(OLD, f, 0.22))].sort((a, b) => b.f - a.f);
  const N = 24;
  const fus = loft('fuselage', N, S, {
    paint: 'hull',
    regions: [{ at: S.map((s) => s.f), k: [13, 14, 15, 16, 17, 18, 19, 20, 21, 22], paint: 'belly' }],
    capFore: { kind: 'apex', at: [0.985, 0, -0.028] },
    capAft: { kind: 'apex', at: [-1.03, 0, 0.064] },
  });

  // The bubble: a separate glass loft sat on the crown, windscreen to fairing.
  const cz = 0.098;
  const canopy = poly('canopy (kept from the fw row)', oldGlass(OLD), { exact: true });
  const hump = pod('canopy fairing', 0, cz - 0.005, [[0.18, 0.05, 0, 0.07], [0.0, 0.04, 0, 0.06], [-0.2, 0.012, -0.01, 0.03]], { sides: 12, role: 'body', paint: 'hull' });
  const antiGlare = skinBand(S, [0.96, 0.88, 0.78, 0.66, 0.6], 40 * DEG, 140 * DEG, { role: 'body', paint: 'glare', sh: 0.5 });

  // The gun: seven barrels poking out under the nose, a little right of the centreline.
  const gun = group('GAU-8', [
    pod('gun housing', 0, -0.06, [[0.95, 0.024], [0.9, 0.03], [0.82, 0.03]], { paint: 'glare', sides: 10 }),
    ...[0, 1, 2, 3, 4, 5, 6].map((i) => { const a = i / 7 * Math.PI * 2; return tube('barrel', [[0.94, Math.cos(a) * 0.014, -0.06 + Math.sin(a) * 0.014], [1.0, Math.cos(a) * 0.014, -0.06 + Math.sin(a) * 0.014]], 0.004, { role: 'gun', paint: 'gun', sides: 5 }); }),
    tube('muzzle ring', [[0.985, 0, -0.06], [0.995, 0, -0.06]], 0.02, { role: 'gun', paint: 'gun', sides: 10 }),
  ]);

  // Wing: low, thick, straight, with drooped Hoerner tips.
  const W = [
    { g: 0, le: 0.23, te: -0.3, h: -0.034, t: 1.3 },
    { g: 0.3, le: 0.215, te: -0.29, h: -0.034, t: 1.2 },
    { g: 0.8, le: 0.17, te: -0.25, h: -0.004, t: 0.95 },
    { g: 0.86, le: 0.15, te: -0.23, h: -0.022, t: 0.6 },
  ];
  const wing = foil('wing', W, { nx: 11, paint: 'hull', lowerSh: 0.55, bands: [{ x0: 0, x1: 0.05, paint: 'trim' }] });
  const flaps = ctrlOn('flap', W[0], W[1], 0.28, 1, 0.24);
  const flapsOut = ctrlOn('flap', W[1], W[2], 0, 0.3, 0.24);
  const ailerons = ctrlOn('aileron', W[1], W[2], 0.36, 0.98, 0.28);   // the split decelerons
  const onWing = (g) => { const i = g <= W[1].g ? 0 : 1; return lerpSt(W[i], W[i + 1], (g - W[i].g) / (W[i + 1].g - W[i].g)); };

  // Main gear pods on the leading edge, the wheels standing half out of them even when up.
  const gearPods = mirror('gear pods', [
    pod('gear pod', 0.26, -0.085, [[0.46, 0.01], [0.42, 0.034], [0.34, 0.046], [0.16, 0.046], [0.0, 0.034], [-0.08, 0.01]], { paint: 'hull', sides: 12 }),
    faired('main leg', [[0.34, 0.26, -0.1], [0.33, 0.26, -0.2]], 0.04, 0.012, { role: 'gear' }),
    wheel('main wheel', [0.33, 0.26, -0.238], 0.041, 0.018, 12),
  ]);
  const noseGear = group('nose gear', [
    strut('nose leg', 0.72, 0.03, -0.11, -0.22, 0.01),
    wheel('nose wheel', [0.72, 0.03, -0.24], 0.039, 0.014, 12),
  ]);

  // Two TF34s in pods high on the rear fuselage, on stub pylons.
  const eG = 0.265, eH = 0.152, eR = 0.058;
  const engines = mirror('engines', [
    pod('engine pod', eG, eH, [[-0.2, eR * 0.9], [-0.215, eR], [-0.26, eR * 1.06], [-0.44, eR * 1.02], [-0.56, eR * 0.84], [-0.63, eR * 0.64]], { paint: 'hull', sides: 16 }),
    cone('fan face', -0.212, eG, eH, eR * 0.86, [-0.226, eG, eH], { paint: 'fan', n: 14, shade: { base: 0.34, amp: 0.1 } }),
    cone('fan spinner', -0.22, eG, eH, eR * 0.26, [-0.196, eG, eH], { paint: 'metal', n: 8 }),
    cone('exhaust plug', -0.63, eG, eH, eR * 0.4, [-0.68, eG, eH], { paint: 'exhaust', n: 10 }),
    poly('engine pylon', [
      { role: 'nacelle', paint: 'hull', sh: 0.82, p: [[-0.3, 0.06, 0.085], [-0.3, eG - eR * 0.8, eH - 0.01], [-0.52, eG - eR * 0.8, eH - 0.01], [-0.52, 0.055, 0.1]] },
      { role: 'nacelle', paint: 'hull', sh: 0.55, p: [[-0.52, 0.055, 0.085], [-0.52, eG - eR * 0.8, eH - 0.03], [-0.3, eG - eR * 0.8, eH - 0.03], [-0.3, 0.06, 0.07]] },
    ]),
  ]);

  // Tail: a straight tailplane with a fin standing at each end.
  const T = [
    { g: 0, le: -0.79, te: -1.01, h: 0.052, t: 0.9 },
    { g: 0.36, le: -0.84, te: -1.03, h: 0.052, t: 0.8 },
  ];
  const tailplane = foil('tailplane', T, { role: 'stab', paint: 'hull', nx: 8 });
  const elevators = ctrlOn('elevator', T[0], T[1], 0.04, 0.9, 0.34);
  const F = [
    { g: -0.02, le: -0.8, te: -1.0, h: 0.345, t: 0.95 },
    { g: 0.42, le: -0.94, te: -1.08, h: 0.345, t: 0.8 },
  ];
  const fins = mirror('fins', [foil('fin', F, { axis: 'g', role: 'fin', paint: 'hull', nx: 8 }), ctrlOn('rudder', F[0], F[1], 0.12, 0.95, 0.34, { axis: 'g', sh: 0.72 })]);

  // Stores: a Maverick rail outboard, a bomb and an ECM pod further in, all on pylons.
  const pylon = (g, f0, f1, drop) => { const s = onWing(g); const z = foilPt(s, 0.4, 0)[2]; return poly('pylon', [
    { role: 'strut', paint: 'hull', sh: 0.8, p: [[f0, g + 0.006, z], [f1, g + 0.006, z], [f1 + 0.02, g + 0.006, z - drop], [f0 - 0.02, g + 0.006, z - drop]] },
    { role: 'strut', paint: 'hull', sh: 0.6, p: [[f0 - 0.02, g - 0.006, z - drop], [f1 + 0.02, g - 0.006, z - drop], [f1, g - 0.006, z], [f0, g - 0.006, z]] },
  ], { minDetail: 1 }); };
  const zAt = (g) => foilPt(onWing(g), 0.4, 0)[2];
  const stores = mirror('stores', [
    pylon(0.68, 0.1, -0.06, 0.03),
    { kind: 'missile', name: 'Maverick', f: [-0.08, 0.1], g: 0.68, z: R(zAt(0.68) - 0.05), minDetail: 1 },
    pylon(0.52, 0.12, -0.08, 0.03),
    pod('bomb', 0.52, zAt(0.52) - 0.06, [[0.16, 0.006], [0.13, 0.026], [0.04, 0.03], [-0.06, 0.026], [-0.11, 0.012]], { paint: 'store', sides: 10 }),
    tube('bomb fins', [[-0.1, 0.52, zAt(0.52) - 0.1], [-0.1, 0.52, zAt(0.52) - 0.02]], 0.003, { role: 'gun', paint: 'store', minDetail: 1 }),
    pylon(0.4, 0.12, -0.06, 0.028),
    pod('ECM pod', 0.4, zAt(0.4) - 0.055, [[0.13, 0.006], [0.1, 0.02], [-0.06, 0.02], [-0.09, 0.008]], { paint: 'glare', sides: 8 }),
  ]);

  const tip = foilPt(W[3], 0.5, 1);
  const bits = [
    poly('anti-glare', antiGlare),
    tube('refuelling door', [[0.84, 0, 0.083], [0.8, 0, 0.087]], 0.01, { role: 'body', paint: 'glare', minDetail: 1 }),
    tube('pitot', [[0.3, 0.8, 0.0], [0.36, 0.8, 0.0]], 0.003, { role: 'strut', paint: 'metal', minDetail: 1 }),
    tube('UHF blade', [[-0.1, 0, 0.126], [-0.14, 0, 0.16]], 0.006, { role: 'strut', paint: 'glare', minDetail: 1 }),
    poly('beacon', [{ role: 'window', tint: [220, 40, 34], sh: 1, p: [[-0.4, -0.01, -0.052], [-0.43, -0.01, -0.052], [-0.43, 0.01, -0.052], [-0.4, 0.01, -0.052]] }]),
    poly('starboard tip lamp', [{ role: 'window', sh: 1, tint: [46, 190, 78], p: [[tip[0] + 0.04, 0.863, tip[2] - 0.012], [tip[0] - 0.04, 0.863, tip[2] - 0.012], [tip[0] - 0.04, 0.863, tip[2] + 0.004], [tip[0] + 0.04, 0.863, tip[2] + 0.004]] }]),
    poly('port tip lamp', [{ role: 'window', sh: 1, tint: [200, 52, 48], p: [[tip[0] + 0.04, -0.863, tip[2] + 0.004], [tip[0] - 0.04, -0.863, tip[2] + 0.004], [tip[0] - 0.04, -0.863, tip[2] - 0.012], [tip[0] + 0.04, -0.863, tip[2] - 0.012]] }]),
  ];

  const parts = [fus, canopy, hump, gun, wing, flaps, flapsOut, ailerons, gearPods, noseGear, engines, tailplane, elevators, fins, stores, ...bits];
  return {
    id: 'gunship', kind: 'mesh',
    params: {
      name: 'Reaper',
      note: 'An A-10 Thunderbolt II: a slab-sided fuselage built round the seven-barrel gun that pokes out under the nose (the nose leg is offset right to make room for it), a bubble canopy, a thick straight low wing with drooped tips and wheels that stand half out of their pods, two TF34 pods high on the rear fuselage, twin fins on the ends of the tailplane, and stores on pylons.',
      groundPitch: 0,
      hull: 'fuselage',
      navLamps: P3([tip[0], 0.86, tip[2]]),
      paints: {
        hull: { rgb: [118, 124, 130], livery: 'base' },
        trim: { rgb: [88, 94, 100], livery: 'trim' },
        belly: { rgb: [132, 138, 144], livery: 'base' },
        glare: { rgb: [36, 38, 40], livery: 'fixed' },
        gun: { rgb: [44, 44, 46], livery: 'fixed' },
        frame: { rgb: [70, 74, 78], livery: 'trim' },
        fan: { rgb: [40, 42, 46], livery: 'fixed' },
        metal: { rgb: [150, 154, 160], livery: 'fixed' },
        exhaust: { rgb: [70, 64, 60], livery: 'fixed' },
        store: { rgb: [74, 84, 64], livery: 'fixed' },
      },
      parts,
    },
  };
}
