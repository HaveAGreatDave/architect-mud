// The Mule — a DHC-6 Twin Otter.
import { R, P3, loft, pod, foil, ctrlOn, tube, mirror, group, poly, cone, wheel, strut, faired, skin, skinWindow, skinBand, DEG, foilPt, legacyFaces, oldStation, flightDeck } from './lib.mjs';

export default async function mule() {
  const OLD = await legacyFaces('prop', 1);
  // Fuselage: a long pointed baggage nose, a square cabin, a tail cone that rises to the fin.
  // Fuselage: a long pointed baggage nose, a square cabin, a tail cone that rises to the fin. The
  // flight deck (f 0.70 → 0.34) is the fw row's hull and glass, face for face: the interior was
  // built against it (see flightDeck in the generator notes, and interior-mule.js).
  const LO = 0.34, HI = 0.7;
  const S = [
    { f: 1.0, rg: 0.03, rvT: 0.02, rvB: 0.02, cz: -0.052, boxy: 0.3 },
    { f: 0.97, rg: 0.056, rvT: 0.024, rvB: 0.024, cz: -0.052, boxy: 0.45 },
    { f: 0.91, rg: 0.09, rvT: 0.046, rvB: 0.046, cz: -0.046, boxy: 0.6 },
    { f: 0.84, rg: 0.111, rvT: 0.064, rvB: 0.064, cz: -0.039, boxy: 0.75 },
    { f: 0.76, rg: 0.124, rvT: 0.08, rvB: 0.08, cz: -0.027, boxy: 0.82 },
    ...[0.7, 0.66, 0.62, 0.48, 0.34].map((f) => oldStation(OLD, f, 0.86)),
    { f: 0.2, rg: 0.13, rvT: 0.135, rvB: 0.135, cz: 0, boxy: 0.86 },
    { f: -0.05, rg: 0.13, rvT: 0.135, rvB: 0.132, cz: 0.002, boxy: 0.86 },
    { f: -0.25, rg: 0.124, rvT: 0.132, rvB: 0.118, cz: 0.012, boxy: 0.84 },
    { f: -0.42, rg: 0.104, rvT: 0.116, rvB: 0.086, cz: 0.036, boxy: 0.76 },
    { f: -0.6, rg: 0.08, rvT: 0.098, rvB: 0.056, cz: 0.066, boxy: 0.62 },
    { f: -0.76, rg: 0.058, rvT: 0.08, rvB: 0.038, cz: 0.088, boxy: 0.5 },
    { f: -0.86, rg: 0.036, rvT: 0.06, rvB: 0.024, cz: 0.098, boxy: 0.4 },
    { f: -0.9, rg: 0.02, rvT: 0.04, rvB: 0.016, cz: 0.102, boxy: 0.3 },
  ];
  const N = 24;
  const belly = (sts) => ({ at: sts.map((x) => x.f), k: [13, 14, 15, 16, 17, 18, 19, 20, 21, 22], paint: 'belly' });
  const deckFit = flightDeck({
    S, n: N, old: OLD, lo: LO, hi: HI,
    loftExtra: { paint: 'hull' },
    foreExtra: { capFore: { kind: 'apex', at: [1.0, 0, -0.052] }, regions: [belly(S.filter((x) => x.f > HI))] },
    aftExtra: { capAft: { kind: 'apex', at: [-0.92, 0, 0.104] }, regions: [belly(S.filter((x) => x.f < LO))] },
    paintOf: (fc) => (fc.p.reduce((a, v) => a + v[2], 0) / fc.p.length < -0.06 ? 'belly' : 'hull'),
  });
  const fus = group('fuselage parts', deckFit.parts);

  // Cabin windows: seven a side, square with the corners knocked off by the frame.
  const wins = [];
  for (let i = 0; i < 7; i++) {
    const f0 = 0.42 - i * 0.092, f1 = f0 - 0.058;
    wins.push(skinWindow(S, f0, f1, 6 * DEG, 46 * DEG, { role: 'window', sh: 0.9, tint: [36, 50, 62] }));
  }
  // The airstair door, aft on the left, and the cargo door outline beside it.
  const doorFrame = [];
  const outline = (f0, f1, a0, a1) => {
    const o = 0.0032, w = 0.004;
    const pts = [[f0, a0], [f1, a0], [f1, a1], [f0, a1]];
    for (let i = 0; i < 4; i++) {
      const [fa, aa] = pts[i], [fb, ab] = pts[(i + 1) % 4];
      const A = skin(S, fa, aa, o), B = skin(S, fb, ab, o);
      doorFrame.push({ role: 'body', paint: 'seam', sh: 0.4, p: [A, B, [B[0], B[1], B[2] - w], [A[0], A[1], A[2] - w]].map(P3) });
    }
  };
  outline(-0.2, -0.36, -30 * DEG, 50 * DEG);

  // The cheatline: a stripe down each flank, under the windows, sweeping up the tail.
  const stripe = skinBand(S, [0.97, 0.91, 0.83, 0.76, 0.7, 0.64, 0.55, 0.45, 0.2, -0.05, -0.25, -0.42, -0.6], -14 * DEG, -5 * DEG, { role: 'body', paint: 'stripe', sh: 0.86 });
  const antiGlare = skinBand(S, [0.97, 0.91, 0.83, 0.76, 0.705], 38 * DEG, 142 * DEG, { role: 'body', paint: 'glare', sh: 0.5 });

  // Wing: straight, constant chord to the nacelles, a little taper outboard, 2% thickness growth
  // at the root the way a strut-braced wing is deeper there.
  const W = [
    { g: 0, le: 0.36, te: -0.1, h: 0.162, t: 1.15 },
    { g: 0.42, le: 0.36, te: -0.1, h: 0.166, t: 1.05 },
    { g: 1.0, le: 0.3, te: -0.07, h: 0.172, t: 0.85 },
    { g: 1.02, le: 0.296, te: -0.066, h: 0.172, t: 0.6 },
  ];
  const wing = foil('wing', W, { nx: 11, paint: 'hull', bands: [{ x0: 0, x1: 0.12, paint: 'boot' }] });
  const flaps = ctrlOn('flap', W[0], W[1], 0.36, 1, 0.3);
  const flapsOut = ctrlOn('flap', W[1], W[2], 0.0, 0.35, 0.3);
  const ailerons = ctrlOn('aileron', W[1], W[2], 0.4, 0.95, 0.3);

  // Nacelles slung under the wing, PT6 exhaust stacks bent aft out of the sides.
  const nacG = 0.42, nacH = 0.108;
  const nacelle = mirror('nacelles', [
    pod('nacelle', nacG, nacH, [[0.57, 0.03], [0.56, 0.05], [0.52, 0.064], [0.42, 0.07], [0.14, 0.07], [0.0, 0.064], [-0.12, 0.05], [-0.22, 0.026], [-0.26, 0.008]], { paint: 'hull', sides: 14 }),
    pod('intake lip', nacG, nacH - 0.052, [[0.5, 0.012], [0.47, 0.024], [0.3, 0.024], [0.2, 0.01]], { paint: 'intake', sides: 8, capFore: { kind: 'flat', sh: 0.2 } }),
    tube('exhaust stack', [[0.42, nacG + 0.058, nacH + 0.02], [0.38, nacG + 0.078, nacH + 0.02], [0.3, nacG + 0.086, nacH + 0.024]], 0.013, { role: 'nacelle', paint: 'exhaust', sides: 7 }),
    cone('spinner', 0.57, nacG, nacH, 0.03, [0.63, nacG, nacH], { paint: 'spinner', n: 10 }),
    poly('nacelle strip', [{ role: 'nacelle', paint: 'boot', sh: 0.5, p: [[0.562, nacG - 0.03, nacH + 0.03], [0.562, nacG + 0.03, nacH + 0.03], [0.52, nacG + 0.04, nacH + 0.05], [0.52, nacG - 0.04, nacH + 0.05]] }]),
  ]);

  // Lift struts from the fuselage chine up to mid-span, and the stub the main gear hangs from.
  const struts = mirror('struts', [
    faired('lift strut', [[0.14, 0.12, -0.05], [0.16, 0.56, 0.158]], 0.05, 0.01, { paint: 'hull' }),
    faired('jury strut', [[0.16, 0.44, 0.12], [0.2, 0.44, 0.162]], 0.02, 0.006, { paint: 'hull' }),
  ]);
  const gear = mirror('main gear', [
    faired('gear stub', [[0.14, 0.11, -0.1], [0.13, 0.22, -0.14]], 0.1, 0.02, { role: 'body', paint: 'hull' }),
    faired('gear leg', [[0.13, 0.21, -0.13], [0.12, 0.27, -0.21]], 0.05, 0.012, { role: 'gear' }),
    wheel('main wheel', [0.12, 0.28, -0.225], 0.06, 0.022, 14),
    tube('axle', [[0.12, 0.25, -0.225], [0.12, 0.31, -0.225]], 0.008, { role: 'gear' }),
  ]);
  const noseGear = group('nose gear', [
    strut('nose leg', 0.78, 0, -0.1, -0.22, 0.012),
    tube('nose fork', [[0.79, -0.02, -0.2], [0.785, -0.02, -0.24], [0.785, 0.02, -0.24], [0.79, 0.02, -0.2]], 0.006, { role: 'gear' }),
    wheel('nose wheel', [0.785, 0, -0.24], 0.045, 0.016, 12),
  ]);

  // Tail: a tall straight-edged fin with a dorsal fillet, a fuselage-mounted tailplane.
  const F = [
    { g: 0.1, le: -0.6, te: -0.92, h: 0, t: 1.0 },
    { g: 0.6, le: -0.83, te: -0.98, h: 0, t: 0.8 },
  ];
  const fin = foil('fin', F, { axis: 'g', role: 'fin', paint: 'hull', nx: 9 });
  const rudder = ctrlOn('rudder', F[0], F[1], 0.05, 0.95, 0.35, { axis: 'g', sh: 0.7 });
  const fillet = poly('dorsal fillet', [
    { role: 'fin', paint: 'hull', sh: 0.82, p: [[-0.4, 0.004, 0.16], [-0.62, 0.004, 0.24], [-0.62, 0.004, 0.14]] },
    { role: 'fin', paint: 'hull', sh: 0.66, p: [[-0.62, -0.004, 0.14], [-0.62, -0.004, 0.24], [-0.4, -0.004, 0.16]] },
    { role: 'fin', paint: 'hull', sh: 0.9, p: [[-0.4, 0.004, 0.16], [-0.4, -0.004, 0.16], [-0.62, -0.004, 0.24], [-0.62, 0.004, 0.24]] },
  ]);
  const finStripe = poly('fin flash', [
    { role: 'fin', paint: 'stripe', sh: 0.84, p: [[-0.7, 0.012, 0.3], [-0.88, 0.009, 0.46], [-0.9, 0.009, 0.4], [-0.74, 0.012, 0.25]] },
    { role: 'fin', paint: 'stripe', sh: 0.62, p: [[-0.74, -0.012, 0.25], [-0.9, -0.009, 0.4], [-0.88, -0.009, 0.46], [-0.7, -0.012, 0.3]] },
  ]);
  const T = [
    { g: 0, le: -0.69, te: -0.9, h: 0.14, t: 0.9 },
    { g: 0.4, le: -0.75, te: -0.91, h: 0.142, t: 0.75 },
  ];
  const tailplane = foil('tailplane', T, { role: 'stab', paint: 'hull', nx: 8, bands: [{ x0: 0, x1: 0.1, paint: 'boot' }] });
  const elevators = ctrlOn('elevator', T[0], T[1], 0.1, 0.96, 0.36);

  // Odds and ends that make it a real aeroplane.
  const bits = [
    tube('pitot', [[0.6, 0.13, 0.03], [0.66, 0.15, 0.03]], 0.004, { role: 'strut', paint: 'metal', minDetail: 1 }),
    tube('HF wire', [[0.52, 0, 0.15], [-0.86, 0, 0.5]], 0.0025, { role: 'strut', paint: 'metal', minDetail: 1 }),
    tube('VHF blade', [[0.1, 0, 0.146], [0.07, 0, 0.19]], 0.006, { role: 'strut', paint: 'glare', minDetail: 1 }),
    tube('belly aerial', [[-0.1, 0, -0.134], [-0.13, 0, -0.17]], 0.005, { role: 'strut', paint: 'glare', minDetail: 1 }),
    poly('beacon', [{ role: 'window', tint: [220, 40, 34], sh: 1, p: [[-0.87, 0.008, 0.6], [-0.83, 0.008, 0.6], [-0.83, 0.008, 0.62], [-0.87, 0.008, 0.62]] },
      { role: 'window', tint: [220, 40, 34], sh: 1, p: [[-0.87, -0.008, 0.62], [-0.83, -0.008, 0.62], [-0.83, -0.008, 0.6], [-0.87, -0.008, 0.6]] }]),
    poly('windows', wins),
    mirror('windows other side', [poly('windows', wins)]),
    poly('cabin door', doorFrame),
    mirror('cheatline', [poly('cheatline', stripe)]),
    poly('anti-glare', antiGlare),
    poly('starboard tip lamp', [{ role: 'window', sh: 1, tint: [46, 190, 78], p: [[0.24, 1.024, 0.165], [0.13, 1.024, 0.165], [0.13, 1.024, 0.18], [0.24, 1.024, 0.18]] }]),
    poly('port tip lamp', [{ role: 'window', sh: 1, tint: [200, 52, 48], p: [[0.24, -1.024, 0.18], [0.13, -1.024, 0.18], [0.13, -1.024, 0.165], [0.24, -1.024, 0.165]] }]),
  ];

  const parts = [fus, wing, flaps, flapsOut, ailerons, nacelle, struts, gear, noseGear, fin, rudder, fillet, finStripe, tailplane, elevators, ...bits];
  return {
    id: 'prop', kind: 'mesh',
    params: {
      name: 'Mule',
      note: 'A DHC-6 Twin Otter: a long pointed baggage nose, a square cabin with seven windows a side, a strut-braced high wing with double-slotted flaps, two PT6 turboprops slung under it with their exhaust stacks bent aft, fixed tricycle gear on stubs, and a tall straight fin with a dorsal fillet. Drawn in the frame of the fw_prop row, so the interior and the lamps still sit where they did.',
      groundPitch: 0,
      hull: 'fuselage',
      navLamps: [0.1, 1.02, 0.171],
      rotors: [
        { at: [0.568, nacG, nacH], plane: 'fore', r: 0.21, blades: 3, lead: 0.85 },
        { at: [0.568, -nacG, nacH], plane: 'fore', r: 0.21, blades: 3, lead: 0.85, dir: -1 },
      ],
      paints: {
        hull: { rgb: [230, 228, 220], livery: 'base' },
        belly: { rgb: [168, 172, 176], livery: 'fixed' },
        stripe: { rgb: [196, 58, 38], livery: 'trim' },
        spinner: { rgb: [196, 58, 38], livery: 'trim' },
        boot: { rgb: [26, 26, 28], livery: 'fixed' },
        glare: { rgb: [30, 32, 34], livery: 'fixed' },
        intake: { rgb: [40, 40, 44], livery: 'fixed' },
        exhaust: { rgb: [86, 72, 62], livery: 'fixed' },
        metal: { rgb: [150, 154, 160], livery: 'fixed' },
        seam: { rgb: [120, 122, 124], livery: 'fixed' },
      },
      parts,
    },
  };
}
