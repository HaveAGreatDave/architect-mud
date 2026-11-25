// The container flatbed: writes content/vehicle_models/mesh_trailer_container.json.
//
//   node scripts/shapes/concepts/container-flatbed.mjs
//   then: npm run vehicles:bake
//   see it: the Modelshop subject vehicle:trailer/container, or any hitched variant with ~tcontainer
//
// After the Bulwark HX's trailer in the Hover Rig Expo concept (docs/proposals/hover-rigs.md): a long
// gunmetal flatbed with a light line along its edge, a steel headboard, and three containers chained
// down on it, the middle one in hazard orange. Corrugated flanks, corner castings, locking bars on the
// back doors, heavy lift pads under the tail with mud flaps behind them, and twin thrusters under the
// bumper. The two outer containers take the box's paint. The 2076 body for a dry box (`box`).
//
// The frame, the rules and the running gear are in trailer-lib.mjs. Edit this file, not the JSON.
import { LR, fine, box, prism, sheet, liftPad, landingLegs, gladHands, tailLamps, thruster, GEAR_PAINTS, NOSE_HALF, writeBody, AMBER } from './trailer-lib.mjs';

const LEN = 0.600, W = 0.172;
const DECK0 = 0.078, DECK1 = 0.106;
const GLOW = [255, 154, 46];

// ── The deck ── Narrow at the pin and out to full width by the headboard, thin, on a frame.
const deck = [
  prism('deck', [[0, -NOSE_HALF], [0, NOSE_HALF], [-0.044, W], [-LEN + 0.010, W], [-LEN + 0.010, -W], [-0.044, -W]], DECK0, DECK1, { paint: 'gunmetal' }),
  ...LR.map((s) => box('deck light', -0.050, -LEN + 0.016, 0.0012, DECK0 + 0.010, DECK0 + 0.015, { role: 'window', tint: GLOW, g: s * (W + 0.0006), ...fine })),
  ...LR.map((s) => box('deck rail', -0.046, -LEN + 0.012, 0.003, DECK1 - 0.004, DECK1 + 0.002, { role: 'strut', paint: 'steel', g: s * (W - 0.002) })),
  ...LR.map((s) => box('frame rail', -0.020, -LEN + 0.020, 0.010, 0.050, DECK0, { role: 'strut', paint: 'frame', g: s * 0.090 })),
  // Stake pockets along the edge.
  ...LR.flatMap((s) => Array.from({ length: 9 }, (_, i) => box('stake pocket', -0.070 - i * 0.060, -0.064 - i * 0.060, 0.003, DECK0 + 0.004, DECK1 - 0.006, { role: 'strut', paint: 'frame', g: s * (W + 0.002), ...fine }))),
];

// ── The headboard ── A steel frame across the front of the deck, with a hazard chevron along its foot.
const HB_F = -0.048, HB_TOP = 0.300;
const headboard = [
  ...LR.map((s) => box('headboard post', HB_F - 0.008, HB_F, 0.008, DECK1, HB_TOP, { role: 'strut', paint: 'steel', g: s * (W - 0.010) })),
  box('headboard rail', HB_F - 0.008, HB_F, W - 0.004, HB_TOP - 0.012, HB_TOP, { role: 'strut', paint: 'steel' }),
  box('headboard', HB_F - 0.006, HB_F - 0.002, W - 0.016, DECK1, HB_TOP - 0.012, { role: 'strut', paint: 'frame' }),
  ...[0.150, 0.200, 0.250].map((h) => box('headboard bar', HB_F - 0.0005, HB_F + 0.0015, W - 0.018, h, h + 0.006, { role: 'strut', paint: 'steel', ...fine })),
  box('headboard band', HB_F - 0.0005, HB_F + 0.0010, W - 0.018, DECK1 + 0.004, DECK1 + 0.020, { paint: 'hazard' }),
];

// ── The containers ── Three, nose to tail, each a box with ribbed flanks, corner castings and rails.
const CL = 0.164, CGAP = 0.012, C0 = -0.060, CW = 0.162, CZ0 = DECK1 + 0.002, CZ1 = 0.356;
const containers = [];
for (let i = 0; i < 3; i++) {
  const f1 = C0 - i * (CL + CGAP), f0 = f1 - CL, mid = i === 1;
  const paint = mid ? { paint: 'hazard' } : {};
  containers.push(box('container', f0, f1, CW, CZ0, CZ1, paint));
  // Corrugation: ribs proud of the flanks and the roof.
  for (let k = 0; k < 7; k++) {
    const f = f0 + 0.016 + k * (CL - 0.032) / 6;
    for (const s of LR) containers.push(box('container rib', f - 0.005, f + 0.005, 0.0016, CZ0 + 0.012, CZ1 - 0.012, { ...paint, g: s * (CW + 0.0010), ...fine }));
  }
  // Top and bottom rails, the corner posts, and the castings at the eight corners.
  for (const s of LR) {
    for (const h of [CZ0, CZ1 - 0.010]) containers.push(box('container rail', f0, f1, 0.0025, h, h + 0.010, { role: 'strut', paint: 'frame', g: s * (CW + 0.0010) }));
    for (const f of [f0, f1 - 0.010]) containers.push(box('corner post', f, f + 0.010, 0.006, CZ0, CZ1, { role: 'strut', paint: 'frame', g: s * (CW - 0.004) }));
    for (const f of [f0, f1 - 0.012]) for (const h of [CZ0, CZ1 - 0.012]) containers.push(box('corner casting', f, f + 0.012, 0.007, h, h + 0.012, { role: 'strut', paint: 'steel', g: s * (CW - 0.003), ...fine }));
    // Chained down to the deck, a chain at each end of the container's flank.
    for (const f of [f0 + 0.030, f1 - 0.030]) containers.push(box('lashing chain', f - 0.002, f + 0.002, 0.0012, DECK1, CZ0 + 0.060, { role: 'strut', paint: 'chrome', g: s * (CW + 0.003), ...fine }));
  }
  // A hazard diamond on the middle one, both flanks.
  if (mid) for (const s of LR) {
    const fc = (f0 + f1) / 2, hc = 0.250, d = 0.030, g = s * (CW + 0.0020);
    containers.push(sheet('placard', [[fc + d, g, hc], [fc, g, hc + d], [fc - d, g, hc], [fc, g, hc - d]], { role: 'window', tint: [242, 242, 236], ...fine }));
    containers.push(sheet('placard', [[fc + d * 0.8, g * 1.0005, hc], [fc, g * 1.0005, hc + d * 0.8], [fc - d * 0.8, g * 1.0005, hc], [fc, g * 1.0005, hc - d * 0.8]], { role: 'window', tint: [228, 72, 77], ...fine }));
  }
}
// The back doors of the last container: four locking bars, the handles, the hinges.
const BACK = C0 - 2 * (CL + CGAP) - CL;
const doors = [
  box('door seam', BACK - 0.0015, BACK + 0.0005, 0.0012, CZ0 + 0.010, CZ1 - 0.010, { role: 'strut', paint: 'frame' }),
  ...[-0.110, -0.040, 0.040, 0.110].flatMap((g) => [
    box('locking bar', BACK - 0.004, BACK, 0.0025, CZ0 + 0.012, CZ1 - 0.012, { role: 'strut', paint: 'chrome', g }),
    box('bar handle', BACK - 0.008, BACK - 0.002, 0.008, 0.200, 0.206, { role: 'strut', paint: 'steel', g: g + 0.010, ...fine }),
  ]),
  ...LR.flatMap((s) => [0.150, 0.230, 0.310].map((h) => box('door hinge', BACK - 0.004, BACK, 0.004, h, h + 0.014, { role: 'strut', paint: 'steel', g: s * (CW - 0.010), ...fine }))),
];

// ── Under it ── Landing legs, lift pads, mud flaps; the bumper, lamps and thrusters at the tail.
const pads = [-0.400, -0.520].flatMap((f) => LR.map((s) => liftPad(f, s * 0.118, 0.046, DECK0)));
const tailF = -LEN + 0.010;
const tail = [
  box('bumper', tailF - 0.010, tailF, W - 0.030, 0.040, 0.066, { role: 'strut', paint: 'steel' }),
  ...LR.map((s) => box('bumper post', tailF + 0.002, tailF + 0.014, 0.006, 0.066, DECK0, { role: 'strut', paint: 'frame', g: s * 0.090 })),
  ...[-2, -1, 0, 1, 2].map((i) => box('bumper stripe', tailF - 0.0105, tailF - 0.0095, 0.012, 0.044, 0.062, { paint: 'hazard', g: i * 0.050, ...fine })),
  ...tailLamps(tailF, 0.138, 0.092),
  box('plate', tailF - 0.0105, tailF - 0.0095, 0.022, 0.044, 0.062, { role: 'window', tint: [214, 210, 196], ...fine }),
  ...LR.map((s) => box('side marker', -0.300, -0.290, 0.0014, DECK0 + 0.004, DECK0 + 0.010, { role: 'window', tint: AMBER, g: s * (W + 0.0012), ...fine })),
  ...LR.flatMap((s) => [-0.470, -0.590].map((f) => box('mud flap', f, f + 0.003, 0.030, 0.012, DECK0, { role: 'strut', paint: 'rubber', g: s * 0.118 }))),
  ...thruster(tailF - 0.004, -0.060, 0.030, 0.016), ...thruster(tailF - 0.004, 0.060, 0.030, 0.016),
];

writeBody('container', {
  name: 'Container flatbed',
  note: 'A trailer body after the Bulwark HX (docs/proposals/hover-rigs.md phase 6). Written by scripts/shapes/concepts/container-flatbed.mjs; edit that, not this. '
    + 'Laid out from the kingpin at f 0, aft negative; aircraft3d.js hangs it on any tractor\'s pin for ~tcontainer.',
  paints: {
    hazard: { rgb: [232, 115, 28], livery: 'fixed', mat: 'satin', tex: 'paint', note: 'the middle container, the headboard band and the bumper stripes' },
    ...GEAR_PAINTS,
  },
  trailer: { len: LEN, w: W, hi: CZ1, boxHalf: NOSE_HALF, tail: [tailF - 0.004, 0.138, 0.092],
    pods: pads.map((p) => p.row) },
  parts: [...deck, ...headboard, ...containers, ...doors, ...landingLegs(-0.090, 0.118, DECK0), ...gladHands(-0.044, DECK1 + 0.012),
    ...pads.flatMap((p) => p.parts), ...tail],
});
