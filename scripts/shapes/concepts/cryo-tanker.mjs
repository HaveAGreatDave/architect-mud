// The cryo tanker: writes content/vehicle_models/mesh_trailer_cryo.json.
//
//   node scripts/shapes/concepts/cryo-tanker.mjs
//   then: npm run vehicles:bake
//   see it: the Modelshop subject vehicle:trailer/cryo, or any hitched variant with ~tcryo
//
// After the Coldline in the Hover Rig Expo concept (docs/proposals/hover-rigs.md), which was parked as
// a tractor because a tanker is a trailer. Three insulated tanks with dished ends on saddles along a
// black spine, two green rings and a lit ring round each, hazard diamonds on their flanks, a pipe run
// along the tops with a riser to each, a striped bumper, red flags on poles at the tail and one big
// thruster behind the last tank. The tanks take the box's paint. The 2076 body for a tanker (`tank`).
// Cosmetic: what it carries is whatever the tanker carries (the hazmat class is an open question).
//
// The frame, the rules and the running gear are in trailer-lib.mjs. Edit this file, not the JSON.
import { LR, fine, box, loft, ngon, tubeF, sheet, liftPad, landingLegs, gladHands, tailLamps, thruster, lettering, GEAR_PAINTS, NOSE_HALF, writeBody } from './trailer-lib.mjs';

const GREEN = [47, 174, 106], GREEN_LIT = [92, 255, 157];
const LEN = 0.744, SP0 = 0.078, SP1 = 0.110;
const R = 0.142, ZC = SP1 + 0.012 + R;                 // the tanks' radius and the height of their axis
const T0 = -0.044, PITCH = 0.234, TL = 0.214;          // the first tank's front, the spacing, a tank's length
const N = 14;
const ring = (f, r) => ngon(N, (c, s) => [f, c * r, ZC + s * r]);

// ── The spine ── A black box section from the pin to the bumper, with a raised nose over the fifth wheel.
const spine = [
  box('spine', -0.006, -LEN + 0.012, 0.070, SP0, SP1, { role: 'strut', paint: 'frame' }),
  loft('nose box', [[0, NOSE_HALF], [-0.028, 0.100]].map(([f, w]) => [[f, -w, SP0], [f, w, SP0], [f, w, 0.180], [f, -w, 0.180]]), { role: 'strut', paint: 'frame' }),
  box('nose band', -0.0016, 0.0000, NOSE_HALF - 0.010, 0.150, 0.170, { paint: 'green', ...fine }),
  ...LR.map((s) => box('side rail', -0.040, -LEN + 0.030, 0.006, SP0 + 0.004, SP0 + 0.020, { role: 'strut', paint: 'steel', g: s * 0.150 })),
  ...LR.flatMap((s) => [-0.150, -0.384, -0.618].map((f) => box('outrigger', f - 0.006, f + 0.006, 0.040, SP0 + 0.004, SP0 + 0.016, { role: 'strut', paint: 'frame', g: s * 0.110, ...fine }))),
  ...lettering('spine letters', 'CRYO H2', -0.300, SP0 + 0.006, 0.0706, { tint: GREEN_LIT }),
];

// ── The tanks ──
const tanks = [];
const hazard = (fc, s) => {
  const g = s * (R + 0.0012), d = 0.028, hc = ZC;
  return [
    sheet('placard', [[fc + d, g, hc], [fc, g, hc + d], [fc - d, g, hc], [fc, g, hc - d]], { role: 'window', tint: [242, 242, 236], ...fine }),
    sheet('placard', [[fc + d * 0.78, g * 1.004, hc], [fc, g * 1.004, hc + d * 0.78], [fc - d * 0.78, g * 1.004, hc], [fc, g * 1.004, hc - d * 0.78]], { role: 'window', tint: [228, 72, 77], ...fine }),
  ];
};
for (let i = 0; i < 3; i++) {
  const f1 = T0 - i * PITCH, f0 = f1 - TL, fc = (f0 + f1) / 2;
  // Dished both ends: the head bulges out over 0.040 of length.
  tanks.push(loft('tank', [[f1, 0.50], [f1 - 0.012, 0.84], [f1 - 0.030, 0.98], [f1 - 0.042, 1], [f0 + 0.042, 1], [f0 + 0.030, 0.98], [f0 + 0.012, 0.84], [f0, 0.50]].map(([f, k]) => ring(f, R * k))));
  for (const d of [-0.050, 0.050]) tanks.push(loft('tank ring', [fc + d - 0.007, fc + d + 0.007].map((f) => ring(f, R + 0.004)), { paint: 'green' }));
  tanks.push(loft('lit ring', [fc - 0.002, fc + 0.002].map((f) => ring(f, R + 0.003)), { role: 'window', tint: GREEN_LIT, ...fine }));
  tanks.push(box('saddle', fc - 0.040, fc + 0.040, 0.075, SP1, ZC - R * 0.86, { role: 'strut', paint: 'frame' }));
  for (const s of LR) tanks.push(...hazard(fc + 0.074, s));
  // The riser from the pipe run into the tank's top.
  tanks.push(box('riser', fc - 0.004, fc + 0.004, 0.004, ZC + R * 0.98, ZC + R + 0.018, { role: 'strut', paint: 'chrome', g: 0.045 }));
  tanks.push(box('valve', fc - 0.010, fc + 0.010, 0.010, ZC + R - 0.004, ZC + R + 0.006, { role: 'strut', paint: 'steel', ...fine }));
}
const LAST = T0 - 2 * PITCH - TL;
const pipe = [
  tubeF('pipe run', [[T0 - TL / 2 + 0.004, 0.006], [LAST + TL / 2 - 0.004, 0.006]], 0.045, ZC + R + 0.018, { role: 'strut', paint: 'chrome' }, 6),
];

// ── Under it and the tail ──
const pads = [-0.300, -0.480, -0.640].flatMap((f) => LR.map((s) => liftPad(f, s * 0.112, 0.044, SP0)));
const tailF = -LEN + 0.012;
const tail = [
  box('bumper', tailF - 0.010, tailF, 0.150, 0.040, 0.068, { role: 'strut', paint: 'frame' }),
  ...Array.from({ length: 6 }, (_, k) => box('bumper stripe', tailF - 0.0105, tailF - 0.0095, 0.022, 0.044, 0.064, { paint: k % 2 ? 'yellow' : 'frame', g: -0.125 + k * 0.050, ...fine })),
  ...tailLamps(tailF, 0.132, 0.084),
  ...LR.flatMap((s) => [
    box('flag pole', tailF + 0.004, tailF + 0.008, 0.002, 0.068, 0.200, { role: 'strut', paint: 'steel', g: s * 0.080 }),
    sheet('flag', [[tailF + 0.006, s * 0.080, 0.198], [tailF - 0.030, s * 0.086, 0.192], [tailF - 0.030, s * 0.086, 0.172], [tailF + 0.006, s * 0.080, 0.178]], { role: 'window', tint: [228, 72, 77], ...fine }),
  ]),
  ...LR.flatMap((s) => [-0.560, -0.700].map((f) => box('mud flap', f, f + 0.003, 0.028, 0.012, SP0, { role: 'strut', paint: 'rubber', g: s * 0.112 }))),
  ...thruster(LAST - 0.010, 0, ZC, 0.034),
  box('thruster mount', LAST - 0.004, LAST + 0.020, 0.012, SP1, ZC - 0.030, { role: 'strut', paint: 'frame' }),
];

writeBody('cryo', {
  name: 'Cryo tanker',
  note: 'A trailer body after the Coldline (docs/proposals/hover-rigs.md phase 6). Written by scripts/shapes/concepts/cryo-tanker.mjs; edit that, not this. '
    + 'Laid out from the kingpin at f 0, aft negative; aircraft3d.js hangs it on any tractor\'s pin for ~tcryo.',
  paints: {
    green: { rgb: GREEN, livery: 'fixed', mat: 'satin', tex: 'paint', note: 'the rings on the tanks and the nose band' },
    yellow: { rgb: [242, 195, 59], livery: 'fixed', mat: 'satin', tex: 'paint', note: 'the bumper stripes' },
    ...GEAR_PAINTS,
  },
  trailer: { len: LEN, w: R + 0.004, hi: ZC + R + 0.024, boxHalf: NOSE_HALF, tail: [tailF - 0.004, 0.132, 0.084],
    pods: pads.map((p) => p.row) },
  parts: [...spine, ...tanks, ...pipe, ...landingLegs(-0.090, 0.112, SP0), ...gladHands(-0.002, 0.120), ...pads.flatMap((p) => p.parts), ...tail],
});
