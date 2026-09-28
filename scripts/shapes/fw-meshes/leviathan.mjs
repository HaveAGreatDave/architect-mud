// The Leviathan — an An-124 Ruslan, except that the flight deck is IN the nose visor: the whole
// cockpit lifts with the nose when she opens up to load. The fw_heavy row's visor block (hinge
// angle 1.2 rad) still drives the interior camera tilt, so the swing here uses the same angle.
import { R, P3, loft, pod, foil, ctrlOn, tube, mirror, group, poly, cone, wheel, strut, faired, skin, skinWindow, skinBand, DEG, foilPt, lerpSt, stationAt, secPt, legacyFaces, flightDeck } from './lib.mjs';

export default async function leviathan() {
  const OLD = await legacyFaces('heavy', 1);
  const LO = 0.62, HI = 0.78;   // the flight deck: the fw row's hull and glass, face for face
  const N = 24;
  const CUT = 0.56;                        // the visor joint
  const PIV = [CUT - 0.004, 0, 0.244];     // the hinge: on the crown line, at the joint
  const SWING = -(1.2 * 180 / Math.PI);    // the fw_heavy row's maxAng, in degrees, nose up

  const NOSE = [
    { f: 1.15, rg: 0.012, rvT: 0.0130, rvB: 0.0130, cz: -0.0300, boxy: 0 },
    { f: 1.14, rg: 0.038, rvT: 0.0410, rvB: 0.0410, cz: -0.0300, boxy: 0.04 },
    { f: 1.11, rg: 0.06, rvT: 0.0665, rvB: 0.0665, cz: -0.0285, boxy: 0.06 },
    { f: 1.06, rg: 0.079, rvT: 0.0935, rvB: 0.0935, cz: -0.0265, boxy: 0.06 },
    { f: 0.98, rg: 0.097, rvT: 0.1255, rvB: 0.1255, cz: -0.0235, boxy: 0.06 },
    { f: 0.88, rg: 0.11, rvT: 0.1660, rvB: 0.1660, cz: -0.0110, boxy: 0.06 },
    { f: 0.78, rg: 0.117, rvT: 0.2080, rvB: 0.2080, cz: 0.0090, boxy: 0.06 },
    { f: 0.7, rg: 0.12, rvT: 0.2315, rvB: 0.2315, cz: 0.0195, boxy: 0.06 },
    { f: 0.62, rg: 0.12, rvT: 0.2375, rvB: 0.2375, cz: 0.0225, boxy: 0.06 },
    { f: CUT, rg: 0.12, rvT: 0.2290, rvB: 0.2290, cz: 0.0140, boxy: 0.06 },
  ];
  const BODY = [
    { f: CUT, rg: 0.12, rvT: 0.2290, rvB: 0.2290, cz: 0.0140, boxy: 0.06 },
    { f: 0.4, rg: 0.122, rvT: 0.2185, rvB: 0.2185, cz: 0.0035, boxy: 0.08, minDetail: 1 },
    { f: 0.05, rg: 0.124, rvT: 0.2160, rvB: 0.2160, cz: 0.0020, boxy: 0.1 },
    { f: -0.2, rg: 0.124, rvT: 0.2105, rvB: 0.2105, cz: 0.0055, boxy: 0.1 },
    { f: -0.4, rg: 0.12, rvT: 0.1910, rvB: 0.1910, cz: 0.0210, boxy: 0.1 },
    { f: -0.55, rg: 0.112, rvT: 0.1670, rvB: 0.1670, cz: 0.0390, boxy: 0.1 },
    { f: -0.7, rg: 0.096, rvT: 0.1340, rvB: 0.1340, cz: 0.0640, boxy: 0.1 },
    { f: -0.85, rg: 0.074, rvT: 0.0990, rvB: 0.0990, cz: 0.0870, boxy: 0.1, minDetail: 1 },
    { f: -1, rg: 0.046, rvT: 0.0650, rvB: 0.0650, cz: 0.1050, boxy: 0.1 },
    { f: -1.1, rg: 0.022, rvT: 0.0420, rvB: 0.0420, cz: 0.1160, boxy: 0.08 },
  ];
  const ALL = [...NOSE, ...BODY.slice(1)];
  const belly = (sts) => ({ at: sts.map((s) => s.f), k: [14, 15, 16, 17, 18, 19, 20, 21, 22], paint: 'belly' });
  const deck = { role: 'glass', tint: [58, 86, 108], art: 'leviathan', uvDiv: 12 };

  // ── The visor: nose skin, flight deck glazing, a dark bulkhead that only shows open, and a seam.
  const deckFit = flightDeck({
    name: 'visor', S: NOSE, n: N, old: OLD, lo: LO, hi: HI,
    loftExtra: { paint: 'hull' },
    foreExtra: { capFore: { kind: 'apex', at: [1.156, 0, -0.03] }, regions: [belly(NOSE.filter((x) => x.f > HI))] },
    paintOf: (fc) => (fc.p.reduce((a, v) => a + v[2], 0) / fc.p.length < -0.1 ? 'belly' : 'hull'),
  });
  // The visor has nothing aft of the flight deck but the joint itself, so its aft loft is empty.
  deckFit.parts[0].parts = deckFit.parts[0].parts.filter((p) => !(p.kind === 'loft' && p.stations.length < 2));
  const noseSkin = group('visor skin', deckFit.parts);
  const ring = (f, sts, n = N) => { const o = []; const s = stationAt(sts, f); for (let k = 0; k < n; k++) o.push(secPt(s, k / n * Math.PI * 2)); return o; };
  const rc = ring(CUT - 0.001, NOSE);
  const bulk = [];
  for (let k = 0; k < N; k++) bulk.push({ role: 'interior', paint: 'bulk', sh: 0.42, p: [[CUT - 0.001, 0, 0.0], rc[(k + 1) % N], rc[k]] });
  const seam = [];
  for (let k = 0; k < N; k++) {
    const a0 = k / N * Math.PI * 2, a1 = (k + 1) / N * Math.PI * 2;
    seam.push({ role: 'body', paint: 'seam', sh: 0.35, p: [skin(ALL, CUT + 0.004, a0, 0.0012), skin(ALL, CUT + 0.004, a1, 0.0012), skin(ALL, CUT - 0.004, a1, 0.0012), skin(ALL, CUT - 0.004, a0, 0.0012)] });
  }
  const antiGlare = skinBand(ALL, [1.1, 1.04, 0.98, 0.88], 36 * DEG, 144 * DEG, { role: 'body', paint: 'glare', sh: 0.5 });
  const visor = group('cargo visor', [
    noseSkin,
    poly('visor bulkhead', bulk, { when: 'noseVisor' }),
    poly('visor seam', seam),
    poly('anti-glare', antiGlare),
    mirror('nose cheatline', [poly('cheatline', skinBand(ALL, [1.1, 1.04, 0.98, 0.88], -6 * DEG, 2 * DEG, { role: 'body', paint: 'stripe', sh: 0.8 })), poly('cheatline', skinBand(ALL, [1.1, 1.04, 0.98, 0.88], 4 * DEG, 7 * DEG, { role: 'body', paint: 'stripe', sh: 0.84 }))]),
    tube('nose probe', [[1.14, 0, -0.03], [1.2, 0, -0.03]], 0.004, { role: 'strut', paint: 'metal', minDetail: 1 }),
    mirror('wipers', [tube('wiper', [[0.795, 0.03, 0.105], [0.77, 0.045, 0.13]], 0.0025, { role: 'strut', paint: 'glare', minDetail: 1 })]),
  ], { anim: { ch: 'noseVisor', pivot: PIV, axis: [0, 1, 0], ang: [0, R(SWING, 3)], def: 0 } });

  // Hinge brackets on the crown: external structure you only see once the joint is broken open.
  const brackets = mirror('visor hinges', [
    poly('hinge bracket', [{ role: 'strut', paint: 'metal', sh: 0.6, p: [[CUT - 0.05, 0.05, 0.236], [CUT + 0.01, 0.05, 0.256], [CUT + 0.01, 0.06, 0.256], [CUT - 0.05, 0.06, 0.236]] }], { when: 'noseVisor' }),
  ]);

  // ── The hold behind the visor, and the loading ramp that walks down out of it.
  const holdF1 = -0.3, fl = -0.17, ce = 0.17, wg = 0.106;
  const hold = poly('cargo hold', [
    { role: 'interior', paint: 'holdFloor', sh: 0.55, p: [[CUT, -wg, fl], [CUT, wg, fl], [holdF1, wg, fl], [holdF1, -wg, fl]] },
    { role: 'interior', paint: 'hold', sh: 0.4, p: [[holdF1, -wg, ce], [holdF1, wg, ce], [CUT, wg, ce], [CUT, -wg, ce]] },
    { role: 'interior', paint: 'hold', sh: 0.5, p: [[CUT, wg, fl], [CUT, wg, ce], [holdF1, wg, ce], [holdF1, wg, fl]] },
    { role: 'interior', paint: 'hold', sh: 0.5, p: [[holdF1, -wg, fl], [holdF1, -wg, ce], [CUT, -wg, ce], [CUT, -wg, fl]] },
    { role: 'interior', paint: 'hold', sh: 0.3, p: [[holdF1, wg, fl], [holdF1, wg, ce], [holdF1, -wg, ce], [holdF1, -wg, fl]] },
  ]);
  const rampFoot = [CUT + 0.44, 0, -0.285];
  const rampHinge = [CUT, 0, fl];
  const rampW = 0.085;
  const ramp = group('nose ramp', [
    poly('ramp plate', [
      { role: 'ramp', paint: 'holdFloor', sh: 0.7, p: [rampHinge.map((v, i) => (i === 1 ? -rampW : v)), [rampHinge[0], rampW, fl], [rampFoot[0], rampW, rampFoot[2]], [rampFoot[0], -rampW, rampFoot[2]]] },
      { role: 'ramp', paint: 'belly', sh: 0.45, p: [[rampFoot[0], -rampW, rampFoot[2] - 0.008], [rampFoot[0], rampW, rampFoot[2] - 0.008], [rampHinge[0], rampW, fl - 0.008], [rampHinge[0], -rampW, fl - 0.008]] },
    ]),
    mirror('ramp jacks', [tube('ramp jack', [[CUT + 0.02, rampW - 0.01, fl + 0.03], [CUT + 0.2, rampW - 0.01, fl - 0.06]], 0.006, { role: 'ramp', paint: 'metal' })]),
  ], { anim: { ch: 'noseVisor', pivot: rampHinge, axis: [0, 1, 0], ang: [-105, 0], span: [0.58, 1], def: 0 } });

  // ── The fuselage aft of the joint.
  const body = loft('fuselage', N, BODY, {
    paint: 'hull',
    regions: [belly(BODY)],
    capAft: { kind: 'apex', at: [-1.12, 0, 0.116] },
  });
  // The troop deck: a row of little windows along the upper crown, and the cheatlines.
  const wins = [];
  for (let i = 0; i < 14; i++) {
    const f0 = 0.5 - i * 0.052;
    if (f0 < -0.2) break;
    wins.push(skinWindow(BODY, f0, f0 - 0.022, 52 * DEG, 60 * DEG, { role: 'window', sh: 0.9, tint: [34, 46, 58] }));
  }
  const stripeFs = [CUT, 0.3, 0.05, -0.2, -0.4, -0.55, -0.7, -0.85];
  const stripe = skinBand(ALL, stripeFs, -6 * DEG, 2 * DEG, { role: 'body', paint: 'stripe', sh: 0.8 });
  const stripe2 = skinBand(ALL, stripeFs, 4 * DEG, 7 * DEG, { role: 'body', paint: 'stripe', sh: 0.84 });
  // The rear ramp outline under the upswept tail.
  const rear = [];
  const edge = (fa, aa, fb, ab) => {
    const A = skin(BODY, fa, aa, 0.002), B = skin(BODY, fb, ab, 0.002), w = 0.004;
    rear.push({ role: 'body', paint: 'seam', sh: 0.35, p: [A, B, [B[0] - w, B[1], B[2]], [A[0] - w, A[1], A[2]]] });
  };
  edge(-0.45, -40 * DEG, -0.92, -60 * DEG); edge(-0.45, -140 * DEG, -0.92, -120 * DEG);
  edge(-0.45, -40 * DEG, -0.45, -140 * DEG);

  // ── Wing: high, swept, cranked, and drooping in anhedral to the tips.
  const W = [
    { g: 0, le: 0.36, te: -0.17, h: 0.222, t: 1.25 },
    { g: 0.42, le: 0.12, te: -0.21, h: 0.194, t: 1.1 },
    { g: 1.03, le: -0.25, te: -0.37, h: 0.152, t: 0.8 },
    { g: 1.05, le: -0.262, te: -0.372, h: 0.151, t: 0.5 },
  ];
  const wing = foil('wing', W, { nx: 11, paint: 'hull', lowerSh: 0.5, bands: [{ x0: 0, x1: 0.08, paint: 'metal' }] });
  const flaps = ctrlOn('flap', W[0], W[1], 0.3, 1, 0.26);
  const flapsOut = ctrlOn('flap', W[1], W[2], 0, 0.5, 0.26);
  const ailerons = ctrlOn('aileron', W[1], W[2], 0.54, 0.97, 0.26);
  const fairing = pod('wing fairing', 0, 0.2, [[0.42, 0.01, -0.01, 0.04], [0.36, 0.035, 0, 0.12], [0.2, 0.05, 0, 0.14], [-0.05, 0.05, 0, 0.14], [-0.2, 0.035, -0.005, 0.12], [-0.3, 0.008, -0.02, 0.05]], { paint: 'hull', sides: 14, role: 'body' });
  const onWing = (g) => { const i = g <= W[1].g ? 0 : 1; const t = (g - W[i].g) / (W[i + 1].g - W[i].g); return lerpSt(W[i], W[i + 1], t); };

  // ── Four big turbofans on pylons, each one hanging ahead of the leading edge.
  const engine = (g, name) => {
    const s = onWing(g), f0 = s.le + 0.2, L = 0.34, h = s.h - 0.082, r = 0.058;
    return group(name, [
      pod('fan cowl', g, h, [[f0, r * 0.9], [f0 - 0.012, r * 1.02], [f0 - 0.06, r * 1.06], [f0 - 0.17, r * 1.02], [f0 - 0.22, r * 0.86]], { paint: 'cowl', sides: 16 }),
      pod('core cowl', g, h, [[f0 - 0.22, r * 0.72], [f0 - 0.27, r * 0.64], [f0 - L, r * 0.5]], { paint: 'metal', sides: 12 }),
      cone('exhaust plug', f0 - L, g, h, r * 0.34, [f0 - L - 0.05, g, h], { paint: 'exhaust', n: 10 }),
      cone('fan face', f0 - 0.012, g, h, r * 0.88, [f0 - 0.028, g, h], { paint: 'fan', n: 16, shade: { base: 0.34, amp: 0.1 } }),
      cone('fan spinner', f0 - 0.022, g, h, r * 0.28, [f0 + 0.008, g, h], { paint: 'metal', n: 10 }),
      poly('pylon', [
        { role: 'nacelle', paint: 'hull', sh: 0.8, p: [[f0 - 0.1, g + 0.008, h + r * 0.95], [s.le + 0.02, g + 0.008, s.h - 0.01], [s.te + 0.06, g + 0.008, s.h - 0.01], [f0 - L + 0.02, g + 0.008, h + r * 0.6]] },
        { role: 'nacelle', paint: 'hull', sh: 0.6, p: [[f0 - L + 0.02, g - 0.008, h + r * 0.6], [s.te + 0.06, g - 0.008, s.h - 0.01], [s.le + 0.02, g - 0.008, s.h - 0.01], [f0 - 0.1, g - 0.008, h + r * 0.95]] },
      ]),
    ]);
  };
  const engines = mirror('engines', [engine(0.34, 'inboard engine'), engine(0.6, 'outboard engine')]);

  // ── The centipede: five twin-wheel axles a side in long sponsons, and two twin nose units.
  const spon = mirror('gear sponsons', [
    pod('gear sponson', 0.1, -0.17, [[0.42, 0.012, 0.02], [0.38, 0.04, 0], [0.3, 0.05], [-0.3, 0.05], [-0.38, 0.04], [-0.44, 0.012, 0.01]], { paint: 'belly', sides: 12, role: 'body' }),
  ]);
  const mains = [];
  for (const f of [0.3, 0.155, 0.01, -0.135, -0.28]) {
    mains.push(strut('main leg', f, 0.13, -0.17, -0.225, 0.011));
    mains.push(wheel('main wheel', [f, 0.108, -0.24], 0.045, 0.016, 10));
    mains.push(wheel('main wheel', [f, 0.152, -0.24], 0.045, 0.016, 10));
  }
  const mainGear = mirror('main gear', mains);
  const noseGear = group('nose gear', [
    ...[0.47, 0.39].flatMap((f) => [
      strut('nose leg', f, 0, -0.17, -0.225, 0.011),
      tube('nose axle', [[f, -0.045, -0.24], [f, 0.045, -0.24]], 0.007, { role: 'gear' }),
      wheel('nose wheel', [f, 0.028, -0.24], 0.045, 0.014, 10),
      wheel('nose wheel', [f, -0.028, -0.24], 0.045, 0.014, 10),
    ]),
  ]);

  // ── Tail: a tall swept fin with a two-piece rudder, and a low tailplane on the tail cone.
  const F = [
    { g: 0.16, le: -0.62, te: -1.02, h: 0, t: 1.0 },
    { g: 0.72, le: -0.94, te: -1.1, h: 0, t: 0.8 },
  ];
  const fin = foil('fin', F, { axis: 'g', role: 'fin', paint: 'hull', nx: 9 });
  const rudder = ctrlOn('rudder', F[0], F[1], 0.18, 0.55, 0.3, { axis: 'g', sh: 0.72 });
  const rudder2 = ctrlOn('rudder', F[0], F[1], 0.56, 0.96, 0.3, { axis: 'g', sh: 0.72 });
  const finFlash = poly('fin flash', [
    { role: 'fin', paint: 'stripe', sh: 0.84, p: [[-0.72, 0.014, 0.34], [-0.9, 0.011, 0.62], [-0.95, 0.011, 0.62], [-0.78, 0.014, 0.34]] },
    { role: 'fin', paint: 'stripe', sh: 0.64, p: [[-0.78, -0.014, 0.28], [-0.95, -0.011, 0.56], [-0.9, -0.011, 0.56], [-0.72, -0.014, 0.28]] },
  ]);
  const T = [
    { g: 0, le: -0.76, te: -1.0, h: 0.13, t: 0.9 },
    { g: 0.46, le: -0.95, te: -1.06, h: 0.12, t: 0.7 },
  ];
  const tailplane = foil('tailplane', T, { role: 'stab', paint: 'hull', nx: 8, bands: [{ x0: 0, x1: 0.08, paint: 'metal' }] });
  const elevators = ctrlOn('elevator', T[0], T[1], 0.08, 0.96, 0.32);

  const tip = foilPt(lerpSt(W[2], W[3], 0.5), 0.5, 1);
  const bits = [
    poly('troop deck windows', wins), mirror('troop deck windows other side', [poly('windows', wins)]),
    mirror('cheatline', [poly('cheatline', stripe), poly('cheatline', stripe2)]),
    poly('rear ramp outline', rear), mirror('rear ramp outline other side', [poly('rear ramp', rear.slice(0, 1))]),
    poly('beacons', [
      { role: 'window', tint: [220, 40, 34], sh: 1, p: [[0.2, -0.01, 0.158], [0.2, 0.01, 0.158], [0.18, 0.01, 0.166], [0.18, -0.01, 0.166]] },
      { role: 'window', tint: [220, 40, 34], sh: 1, p: [[0.1, -0.01, -0.203], [0.08, -0.01, -0.203], [0.08, 0.01, -0.203], [0.1, 0.01, -0.203]] },
    ]),
    tube('satcom', [[0.0, 0, 0.155], [-0.06, 0, 0.18]], 0.008, { role: 'strut', paint: 'glare', minDetail: 1 }),
    tube('HF probe', [[-1.0, 0, 0.7], [-1.06, 0, 0.72]], 0.004, { role: 'strut', paint: 'metal', minDetail: 1 }),
    poly('starboard tip lamp', [{ role: 'window', sh: 1, tint: [46, 190, 78], p: [[tip[0] + 0.04, 1.052, tip[2] - 0.01], [tip[0] - 0.04, 1.052, tip[2] - 0.01], [tip[0] - 0.04, 1.052, tip[2] + 0.004], [tip[0] + 0.04, 1.052, tip[2] + 0.004]] }]),
    poly('port tip lamp', [{ role: 'window', sh: 1, tint: [200, 52, 48], p: [[tip[0] + 0.04, -1.052, tip[2] + 0.004], [tip[0] - 0.04, -1.052, tip[2] + 0.004], [tip[0] - 0.04, -1.052, tip[2] - 0.01], [tip[0] + 0.04, -1.052, tip[2] - 0.01]] }]),
  ];

  const parts = [visor, brackets, hold, ramp, body, fairing, wing, flaps, flapsOut, ailerons, engines, spon, mainGear, noseGear, fin, rudder, rudder2, finFlash, tailplane, elevators, ...bits];
  return {
    id: 'heavy', kind: 'mesh',
    params: {
      name: 'Leviathan',
      note: 'An An-124 Ruslan with one deliberate difference: the flight deck is glazed into the cargo visor, so the crew ride the nose up when she opens. A swept high wing in anhedral, four big turbofans on pylons, the upper-deck crown, twenty main wheels in sponsons, a tall swept fin. The visor swings on the noseVisor channel by the fw_heavy row\'s own angle, and the hold and ramp exist only while it is open.',
      groundPitch: 0,
      hull: 'fuselage',
      navLamps: P3([tip[0], 1.05, tip[2]]),
      paints: {
        hull: { rgb: [228, 230, 232], livery: 'base' },
        belly: { rgb: [150, 156, 164], livery: 'fixed' },
        stripe: { rgb: [30, 72, 150], livery: 'trim' },
        cowl: { rgb: [224, 226, 228], livery: 'base' },
        glare: { rgb: [30, 32, 34], livery: 'fixed' },
        metal: { rgb: [168, 172, 178], livery: 'fixed' },
        exhaust: { rgb: [78, 70, 64], livery: 'fixed' },
        fan: { rgb: [44, 46, 52], livery: 'fixed' },
        seam: { rgb: [96, 98, 104], livery: 'fixed' },
        bulk: { rgb: [70, 74, 80], livery: 'fixed' },
        hold: { rgb: [96, 102, 96], livery: 'fixed' },
        holdFloor: { rgb: [70, 70, 66], livery: 'fixed' },
      },
      parts,
    },
  };
}
