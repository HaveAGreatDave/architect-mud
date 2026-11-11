// The pod train: writes content/vehicle_models/mesh_trailer_podtrain.json.
//
//   node scripts/shapes/concepts/pod-train.mjs
//   then: npm run vehicles:bake
//   see it: the Modelshop subject vehicle:trailer/podtrain, or any hitched variant with ~tpodtrain
//
// After the Strand's pods in the Hover Rig Expo concept (docs/proposals/hover-rigs.md). The concept
// couples three pods like train cars; a tractor pulls one trailer on one kingpin (trailers.js), so here
// they're one body: three rounded pods on a carbon spine, joined by lit couplers, and the whole thing
// swings about the one pin. Each pod has a teal band, a light line, a dark sensor panel on its roof and
// POD A, B or C on its flanks; the last one carries a beacon, a whip aerial, tail lamps and twin
// thrusters. The pods take the box's paint. The 2076 body for a reefer (`reefer`).
//
// The frame, the rules and the running gear are in trailer-lib.mjs. Edit this file, not the JSON.
import { LR, fine, box, loft, puck, liftPad, landingLegs, gladHands, tailLamps, thruster, lettering, GEAR_PAINTS, NOSE_HALF, writeBody } from './trailer-lib.mjs';

const TEAL = [42, 183, 176], TEAL_LIT = [60, 224, 212];
const W = 0.160, Z0 = 0.104, Z1 = 0.344, ZM = (Z0 + Z1) / 2, HH = (Z1 - Z0) / 2;
const PL = 0.180, PGAP = 0.022, P0 = -0.004;
const LEN = -(P0 - 3 * PL - 2 * PGAP) + 0.004;

// A pod's section: a rectangle with its corners cut, scaled by k across and m up and down.
const CUT = 0.034;
const section = (f, k, m = 1) => {
  const g = W * k, h = HH * m, c = CUT * Math.min(k, m);
  return [[f, -g, ZM - h + c], [f, -g + c, ZM - h], [f, g - c, ZM - h], [f, g, ZM - h + c],
    [f, g, ZM + h - c], [f, g - c, ZM + h], [f, -g + c, ZM + h], [f, -g, ZM + h - c]];
};
const pods = [];
for (let i = 0; i < 3; i++) {
  const f1 = P0 - i * (PL + PGAP), f0 = f1 - PL;
  // The first pod's nose is drawn in to the pin's width; the others are rounded at both ends.
  const nose = i === 0 ? [section(f1, NOSE_HALF / W, 0.80), section(f1 - 0.016, 0.86, 0.94), section(f1 - 0.040, 1)]
    : [section(f1, 0.80, 0.84), section(f1 - 0.014, 0.97, 0.98), section(f1 - 0.026, 1)];
  const tail = i === 2 ? [section(f0 + 0.030, 1), section(f0 + 0.012, 0.95, 0.96), section(f0, 0.80, 0.84)]
    : [section(f0 + 0.026, 1), section(f0 + 0.014, 0.97, 0.98), section(f0, 0.80, 0.84)];
  pods.push(loft('pod', [...nose, ...tail]));
  const a = f1 - 0.030, b = f0 + 0.030;
  for (const s of LR) {
    pods.push(box('pod band', a, b, 0.0016, Z0 + 0.040, Z0 + 0.056, { paint: 'teal', g: s * (W + 0.0008) }));
    pods.push(box('light line', a, b, 0.0012, Z0 + 0.078, Z0 + 0.083, { role: 'window', tint: TEAL_LIT, g: s * (W + 0.0008), ...fine }));
    // The seam round the pod's middle.
    pods.push(box('pod seam', (a + b) / 2 - 0.002, (a + b) / 2 + 0.002, 0.0012, Z0 + 0.010, Z1 - 0.010, { role: 'strut', paint: 'steel', g: s * (W + 0.0006), ...fine }));
  }
  pods.push(box('sensor panel', a - 0.006, b + 0.006, W * 0.62, Z1, Z1 + 0.004, { role: 'strut', paint: 'sensor' }));
  pods.push(box('pod seam', (a + b) / 2 - 0.002, (a + b) / 2 + 0.002, W - 0.030, Z1 + 0.004, Z1 + 0.006, { role: 'strut', paint: 'steel', ...fine }));
  pods.push(...lettering('pod letters', 'POD ' + 'ABC'[i], a - 0.020, Z0 + 0.120, W + 0.0012, { tint: TEAL_LIT }));
  // A lift pad pair under the back half of each pod.
  for (const s of LR) {
    const pad = liftPad(f0 + 0.050, s * 0.110, 0.040, Z0);
    pods.push(...pad.parts);
    pods.push({ row: pad.row });
  }
}
// The couplers between pods: a dark bellows and a lit ring.
const couplers = [1, 2].flatMap((i) => {
  const f1 = P0 - i * (PL + PGAP) + PGAP, f0 = f1 - PGAP;
  return [
    box('coupler', f0 - 0.004, f1 + 0.004, W * 0.62, Z0 + 0.030, Z1 - 0.050, { role: 'strut', paint: 'carbon' }),
    loft('coupler ring', [(f0 + f1) / 2 - 0.002, (f0 + f1) / 2 + 0.002].map((f) => [[f, -W * 0.66, Z0 + 0.026], [f, W * 0.66, Z0 + 0.026], [f, W * 0.66, Z1 - 0.046], [f, -W * 0.66, Z1 - 0.046]]),
      { role: 'window', tint: TEAL_LIT }),
  ];
});
// The spine the pods sit on, and the plate over the fifth wheel.
const spine = [
  box('spine', -0.010, -LEN + 0.010, 0.050, 0.078, Z0, { role: 'strut', paint: 'carbon' }),
  box('kingpin plate', -0.002, -0.050, 0.070, 0.078, 0.086, { role: 'strut', paint: 'frame' }),
];
// The last pod's tail: lamps, a beacon and a whip aerial on the roof, two thrusters.
const BACK = P0 - 3 * PL - 2 * PGAP;
const tail = [
  ...tailLamps(BACK + 0.002, 0.112, 0.150),
  box('tail light line', BACK - 0.001, BACK + 0.004, W * 0.62, Z1 - 0.040, Z1 - 0.034, { role: 'window', tint: [214, 60, 48], ...fine }),
  puck('beacon', BACK + 0.030, 0, 0.007, Z1 + 0.004, Z1 + 0.016, { role: 'window', tint: TEAL_LIT }, 8),
  box('whip aerial', BACK + 0.140, BACK + 0.143, 0.0015, Z1 + 0.004, Z1 + 0.070, { role: 'strut', paint: 'steel', g: 0.090, ...fine }),
  ...thruster(BACK + 0.012, -0.060, 0.070, 0.016), ...thruster(BACK + 0.012, 0.060, 0.070, 0.016),
];

const padRows = pods.filter((p) => p.row).map((p) => p.row);
writeBody('podtrain', {
  name: 'Pod train',
  note: 'A trailer body after the Strand (docs/proposals/hover-rigs.md phase 6). Written by scripts/shapes/concepts/pod-train.mjs; edit that, not this. '
    + 'Laid out from the kingpin at f 0, aft negative; aircraft3d.js hangs it on any tractor\'s pin for ~tpodtrain.',
  paints: {
    teal: { rgb: TEAL, livery: 'fixed', mat: 'satin', tex: 'paint', note: 'the band along each pod' },
    carbon: { rgb: [30, 32, 36], livery: 'fixed', mat: 'satin', tex: 'carbon', note: 'the spine and the couplers' },
    sensor: { rgb: [26, 42, 92], livery: 'fixed', mat: 'bare', tex: 'brushed', note: 'the dark panel on each roof' },
    ...GEAR_PAINTS,
  },
  trailer: { len: LEN, w: W, hi: Z1 + 0.016, boxHalf: NOSE_HALF, tail: [BACK - 0.002, 0.112, 0.150], pods: padRows },
  parts: [...spine, ...pods.filter((p) => !p.row), ...couplers, ...landingLegs(-0.090, 0.110, 0.078), ...gladHands(-0.004, 0.090), ...tail],
});
