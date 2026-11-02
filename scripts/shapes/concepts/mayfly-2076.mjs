// The Mayfly 2076 concept: writes content/vehicle_models/mesh_ultralight_2076.json.
//
//   node scripts/shapes/concepts/mayfly-2076.mjs
//   then: npm run vehicles:bake
//
// The Mayfly fifty years on, after the Opener BlackFly and the Pivotal Helix: a single-seat electric
// tilt-wing ultralight. A teardrop pod under one bubble canopy, its tail swept up, and two wings in
// tandem: a low forward wing off the pod's flanks and a high aft wing on a short pylon over the tail,
// endplated by twin fins. Each wing carries four motors on its leading edge, eight in all, and both
// wings pivot on their roots to stand the props up for a vertical take-off. Tricycle gear in pants,
// as the 172 had. It is a variant of the ultralight mesh (mesh_ultralight.json `variants`), worn as
// the Mayfly 2076 factory edition.
//
// ⚠ THE WINGS ARE DRAWN IN CRUISE. The sim has no tilt channel for this class (the Mayfly takes off
// short, `takeoff_mode: 'stol'`), so the props face forward and the tilt hinges are drawn, not moved.
//
// ⚠ THIS OVERWRITES THE JSON. Edit this file, not the mesh in the Modelshop.
//
// Two bodies in one file. Everything fine is `minDetail: 1`; a coarse body with `maxDetail: 0`
// stands in at range. The wings and fins are foil() groups, which carry their own two LODs.
//
// Frame: f fore, g right, h up, in the Mayfly's units (f -1.0..0.8, span ±1.13, wheels on the
// ground at h -0.255), so it sits on the ground and in the chase view as the 172 does. Angles on a
// section are lib.mjs's: 0 = right waterline, +90 = crown, -90 = keel.
import { writeFileSync } from 'node:fs';
import { R, P3, skin, loft, pod, foil, foilPt, lerpSt, ctrlOn, tube, mirror, group, poly as rawPoly, quad, cone, wheel, faired, DEG } from '../fw-meshes/lib.mjs';
const { formatMesh, validateMesh, compileMesh } = await import('../../../client/shared/vehicle-mesh.js');
const { MAYFLY76_STATIONS, MAYFLY76_APEX, MAYFLY76_TAIL, MAYFLY76_GLASS, MAYFLY76_FRAME, MAYFLY76_INSIDE } = await import('../../../client/shared/cabin-mayfly-2076.js');

const FINE = { minDetail: 1 }, COARSE = { maxDetail: 0 };
// Every poly face needs a role; trim and fittings are 'nacelle' unless they say otherwise.
const poly = (name, faces, extra) => rawPoly(name, faces.map((f) => ({ role: 'nacelle', ...f })), extra);
const GLASS = [86, 128, 160];
const lerp = (a, b, t) => a + (b - a) * t;
const range = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));
const P3s = (a) => a.map(P3);

// ── The pod ─────────────────────────────────────────────────────────────────────
// Stated once in client/shared/cabin-mayfly-2076.js, which the cockpit is built off too.
const ST = MAYFLY76_STATIONS;
const at = (f, a, out = 0) => skin(ST, f, a * DEG, out);
const pod76 = loft('pod', 36, ST, {
  ...FINE, paint: 'hull',
  note: 'The shell. The canopy, its frame, seams, trim and hatches are separate parts laid a hair proud of it.',
  capFore: { kind: 'apex', at: MAYFLY76_APEX, paint: 'carbon' },
  capAft: { kind: 'apex', at: MAYFLY76_TAIL, paint: 'trim' },
  shade: { base: 0.6, amp: 0.36 },
});

// A curved patch of skin as a grid of quads, `o` proud of the hull: glass, panels, trim.
function patch(fs, as, extra, o = 0.0022) {
  const out = [];
  for (let i = 0; i < fs.length - 1; i++) for (let j = 0; j < as.length - 1; j++) {
    out.push(quad(at(fs[i + 1], as[j], o), at(fs[i], as[j], o), at(fs[i], as[j + 1], o), at(fs[i + 1], as[j + 1], o), extra));
  }
  return out;
}
const alongF = (fs, a, o = 0.004) => fs.map((f) => at(f, a, o));
const roundF = (f, as, o = 0.004) => as.map((a) => at(f, a, o));
const mirA = (s) => (a) => (s ? 180 - a : a);

// ── The canopy ──────────────────────────────────────────────────────────────────
// One bubble from behind the pilot's head to the nose, down past the elbows: you sit in it rather
// than behind it. Faceted along the pod's own stations, so its edge is the frame's edge exactly.
const C = MAYFLY76_GLASS.canopy, FR0 = MAYFLY76_FRAME;
const CAN_F = [C.f[1], 0.735, 0.715, 0.69, 0.66, 0.63, 0.59, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.16, C.f[0]];
const canopy = poly('canopy', patch(CAN_F, range(C.a[0], C.a[1], 44), { role: 'glass', tint: GLASS }, 0.0024), FINE);

// Frames: the sills it seals on, the aft arch, the bow it hinges from. Dark, standing just proud.
const FR = (name, pts, r = 0.0045) => tube(name, pts, r, { role: 'nacelle', paint: 'frame', sh: 0.5, sides: 5, ...FINE });
const frames = [
  FR('canopy bow', roundF(FR0.bowF, range(C.a[0], C.a[1], 30), 0.0046), 0.005),
  FR('canopy aft arch', roundF(FR0.archF, range(C.a[0], C.a[1], 30), 0.0046), 0.0065),
  FR('canopy sill (right)', alongF(CAN_F, C.a[0], 0.0046), 0.0055),
  FR('canopy sill (left)', alongF(CAN_F, 180 - C.a[0], 0.0046), 0.0055),
  // The seal: a soft black bead inside the frame all round.
  tube('canopy seal', [...alongF(CAN_F, C.a[0] + 1.5, 0.0034), ...roundF(C.f[0] + 0.006, range(C.a[0] + 1.5, C.a[1] - 1.5, 24), 0.0034), ...alongF([...CAN_F].reverse(), 180 - C.a[0] - 1.5, 0.0034)], 0.0022,
    { role: 'nacelle', paint: 'rubber', sh: 0.3, sides: 4, ...FINE }),
  // The bow's two hinge knuckles and the gas strut that lifts the bubble forward.
  ...[1, -1].flatMap((s) => {
    const a = s > 0 ? -6 : 186, p = at(FR0.bowF + 0.004, a, 0.006);
    return [
      tube('canopy hinge', [[p[0] + 0.012, p[1], p[2]], [p[0] - 0.012, p[1], p[2]]], 0.0075, { role: 'nacelle', paint: 'metal', sh: 0.85, sides: 8, caps: 1, ...FINE }),
      tube('canopy strut', [at(0.66, s > 0 ? -18 : 198, 0.004), at(0.56, s > 0 ? -18 : 198, 0.004)], 0.0028, { role: 'nacelle', paint: 'metal', sh: 0.85, sides: 5, ...FINE }),
    ];
  }),
  // The latch on each sill, beside the pilot's elbow, with its lit release.
  ...[0, 1].map((s) => tube('canopy latch' + (s ? ' (left)' : ''), [at(0.3, mirA(s)(-19), 0.006), at(0.26, mirA(s)(-19), 0.006)], 0.0045, { role: 'nacelle', paint: 'metal', sh: 0.85, sides: 6, ...FINE })),
  ...[0, 1].map((s) => tube('latch light' + (s ? ' (left)' : ''), [at(0.24, mirA(s)(-19), 0.006), at(0.225, mirA(s)(-19), 0.006)], 0.003, { role: 'nacelle', paint: 'led', sh: 1, sides: 5, ...FINE })),
];

// ── Seams, hatches, the cheatline and the belly ─────────────────────────────────
const SEAM = (name, pts) => tube(name, pts, 0.0024, { role: 'nacelle', paint: 'seam', sh: 0.4, sides: 4, ...FINE });
const rectSeam = (name, f0, f1, a0, a1, o = 0.0026) => SEAM(name, [...roundF(f1, range(a0, a1, 6), o), ...alongF(range(f1, f0, 5), a1, o).slice(1), ...roundF(f0, range(a1, a0, 6), o).slice(1), ...alongF(range(f0, f1, 5), a0, o).slice(1)]);
const seams = [
  // The nose cone splits off ahead of the canopy bow for the lidar and the avionics behind it.
  SEAM('nose cone seam', roundF(0.765, range(-16, -164, 20), 0.0026)),
  // Where the tail cone is bonded to the pod, and the tail's own access joint under the pylon.
  SEAM('tail joint', roundF(-0.28, range(-180, 180, 30), 0.0024)),
  SEAM('tail joint aft', roundF(-0.7, range(-180, 180, 26), 0.0024)),
  // The battery bays: one long hatch down each lower flank, latched at three points.
  ...[0, 1].flatMap((s) => {
    const A = mirA(s), side = s ? ' (left)' : ' (right)';
    return [
      rectSeam('battery hatch' + side, 0.0, 0.5, A(-62), A(-30)),
      ...[0.08, 0.25, 0.42].map((f) => tube('hatch latch' + side, [at(f + 0.012, A(-46), 0.004), at(f - 0.012, A(-46), 0.004)], 0.003, { role: 'nacelle', paint: 'metal', sh: 0.85, sides: 5, ...FINE })),
    ];
  }),
  // The parachute hatch on the crown aft of the canopy: the ultralight's ballistic chute, with its
  // red warning triangle.
  rectSeam('parachute hatch', -0.12, 0.08, 72, 108),
  poly('parachute placard', [
    { p: [at(0.03, 90, 0.003), at(0.0, 84, 0.003), at(0.0, 96, 0.003)], paint: 'warn', sh: 0.9 },
  ], FINE),
];
// Charge port on the right flank behind the canopy, its door ringed in light.
const chargePort = [
  poly('charge port door', patch([-0.02, -0.07], [-8, 8], { paint: 'carbon', sh: 0.5 }, 0.0028), FINE),
  SEAM('charge port seam', [...roundF(-0.02, range(-8, 8, 4), 0.0032), ...roundF(-0.07, range(8, -8, 4), 0.0032), at(-0.02, -8, 0.0032)]),
  tube('charge port ring', [...roundF(-0.014, range(-10, 10, 4), 0.0038), ...roundF(-0.076, range(10, -10, 4), 0.0038), at(-0.014, -10, 0.0038)], 0.0018, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
];
const trimFs = [0.79, 0.77, 0.74, 0.7, 0.66, 0.61, 0.54, 0.46, 0.38, 0.3, 0.22, 0.14, 0.06, -0.02, -0.1, -0.18, -0.28, -0.4, -0.55, -0.7, -0.84, -0.94];
const trim = [
  // The belly in the trim colour, swept up the lower flanks as the 172's was.
  poly('belly', patch(trimFs, range(-150, -30, 12), { paint: 'belly' }, 0.0016), FINE),
  // The navy pinstripe above it, kept from the 172, and the light line under the canopy sill.
  mirror('pinstripe', [poly('pinstripe', patch(trimFs, [-27, -24], { paint: 'stripe' }, 0.0018), FINE)]),
  tube('sill light (right)', alongF(CAN_F.slice(2, -1), C.a[0] - 3.5, 0.0042), 0.0026, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  tube('sill light (left)', alongF(CAN_F.slice(2, -1), 180 - C.a[0] + 3.5, 0.0042), 0.0026, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  // The sensor nose ahead of the bow: a black cone round the lidar, so the low sun off it never
  // comes up through the bubble.
  poly('sensor nose', patch([0.8, 0.79, 0.775, 0.76, C.f[1] + 0.003], range(-180, 180, 24), { paint: 'glare' }, 0.0018), FINE),
  // Battery-bay cooling louvres under each hatch.
  mirror('pack louvres', [poly('louvres', range(0.44, 0.06, 9).flatMap((f) => [
    quad(at(f + 0.012, -66, 0.0028), at(f - 0.012, -66, 0.0028), at(f - 0.012, -72, 0.0062), at(f + 0.012, -72, 0.0062), { paint: 'metal', sh: 0.75 }),
    quad(at(f + 0.012, -72, 0.0026), at(f - 0.012, -72, 0.0026), at(f - 0.012, -66, 0.0026), at(f + 0.012, -66, 0.0026), { paint: 'seam', sh: 0.3 }),
  ]), FINE)]),
];

// ── The forward wing ────────────────────────────────────────────────────────────
// Low on the pod's flanks, below the canopy sill, with a touch of dihedral. Elevators along its
// whole trailing edge: the tandem's forward wing does the pitching.
const WF = [
  { g: 0.1, le: 0.575, te: 0.4, h: -0.088, t: 1.15 },
  { g: 0.5, le: 0.565, te: 0.41, h: -0.077, t: 1.0 },
  { g: 0.9, le: 0.546, te: 0.43, h: -0.062, t: 0.82 },
];
const wingF = foil('forward wing', WF, { nx: 13, paint: 'hull', bands: [{ x0: 0, x1: 0.05, paint: 'boot' }] });
const elevIn = ctrlOn('elevator', WF[0], WF[1], 0.12, 1, 0.3);
const elevOut = ctrlOn('elevator', WF[1], WF[2], 0, 0.9, 0.3);
// A point on a wing's mean surface at span g, chord x; `up` the upper surface.
const wingAtOf = (WG) => (g, x, up = 1) => {
  for (let i = 0; i < WG.length - 1; i++) if (g <= WG[i + 1].g + 1e-9) return foilPt(lerpSt(WG[i], WG[i + 1], (g - WG[i].g) / (WG[i + 1].g - WG[i].g)), x, up);
  return foilPt(WG[WG.length - 1], x, up);
};
const wfAt = wingAtOf(WF);

// ── The aft wing ────────────────────────────────────────────────────────────────
// High on a pylon over the tail, the longer of the two, with flaps inboard and ailerons out.
const WA = [
  { g: 0, le: -0.6, te: -0.85, h: 0.235, t: 1.15 },
  { g: 0.55, le: -0.615, te: -0.85, h: 0.245, t: 1.0 },
  { g: 1.1, le: -0.645, te: -0.84, h: 0.258, t: 0.82 },
];
const wingA = foil('aft wing', WA, { nx: 13, paint: 'hull', bands: [{ x0: 0, x1: 0.05, paint: 'boot' }] });
const flaps = ctrlOn('flap', WA[0], WA[1], 0.1, 0.96, 0.3);
const ailerons = ctrlOn('aileron', WA[1], WA[2], 0.04, 0.94, 0.3);
const waAt = wingAtOf(WA);

// The flap and elevator slots: a dark line along each hinge.
const slots = mirror('hinge slots', [
  tube('elevator slot', [0.13, 0.5, 0.88].map((g) => { const p = wfAt(g, 0.69, 1); return [p[0], g, p[2] + 0.0015]; }), 0.0022, { role: 'wing', paint: 'seam', sides: 4, ...FINE }),
  tube('flap slot', [0.06, 0.55, 1.08].map((g) => { const p = waAt(g, 0.69, 1); return [p[0], g, p[2] + 0.0015]; }), 0.0022, { role: 'wing', paint: 'seam', sides: 4, ...FINE }),
]);
// Light lines along both leading edges, the 2076's one bit of show, in the cockpit's own blue.
const leLights = mirror('leading edge lights', [
  tube('forward wing light', range(0.16, 0.86, 7).map((g) => { const p = wfAt(g, 0.012, 1); return [p[0] + 0.002, g, p[2] + 0.002]; }), 0.0022, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  tube('aft wing light', range(0.08, 1.06, 8).map((g) => { const p = waAt(g, 0.012, 1); return [p[0] + 0.002, g, p[2] + 0.002]; }), 0.0022, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
]);
// Vortex generators on the aft wing ahead of the ailerons.
const vgs = mirror('vortex generators', [poly('vortex generators', range(0.6, 1.04, 14).flatMap((g, i) => {
  const p = waAt(g, 0.12), tq = (i % 2 ? 1 : -1) * 0.003;
  const a = [p[0] + 0.006, g - tq, p[2] + 0.001], b = [p[0] - 0.006, g + tq, p[2] + 0.001];
  return [quad(a, b, [b[0], b[1], b[2] + 0.007], [a[0] + 0.003, a[1], a[2] + 0.003], { paint: 'metal', sh: 0.8 }),
    quad([a[0] + 0.003, a[1], a[2] + 0.003], [b[0], b[1], b[2] + 0.007], b, a, { paint: 'metal', sh: 0.6 })];
}), FINE)]);

// ── The tilt hinges ─────────────────────────────────────────────────────────────
// Each wing turns on a spar tube through its root: a fairing over the bearing on the pod's flank
// and an actuator canoe under it. The forward pair sit on the pod; the aft wing's on its pylon.
const tilt = [
  mirror('forward tilt hinges', [
    tube('tilt bearing', [[0.49, 0.105, -0.084], [0.49, 0.165, -0.08]], 0.019, { role: 'nacelle', paint: 'carbon', sh: 0.6, sides: 14, caps: 1, ...FINE }),
    tube('tilt bearing ring', [[0.49, 0.165, -0.08], [0.49, 0.17, -0.0798]], 0.0205, { role: 'nacelle', paint: 'metal', sh: 0.85, sides: 14, caps: 1, ...FINE }),
    group('tilt actuator', [pod('actuator', 0, 0, [[0.07, 0.003], [0.05, 0.011], [-0.03, 0.012], [-0.08, 0.004]], { sides: 10, paint: 'carbon', shade: { base: 0.5, amp: 0.3 } })],
      { xf: { t: [0.47, 0.135, -0.108] }, ...FINE }),
  ]),
  tube('aft tilt bearing', [[-0.695, -0.05, 0.226], [-0.695, 0.05, 0.226]], 0.017, { role: 'nacelle', paint: 'carbon', sh: 0.6, sides: 14, caps: 1, ...FINE }),
  mirror('aft tilt rings', [tube('aft tilt ring', [[-0.695, 0.05, 0.226], [-0.695, 0.056, 0.226]], 0.0185, { role: 'nacelle', paint: 'metal', sh: 0.85, sides: 14, caps: 1, ...FINE })]),
];

// ── Eight motors ────────────────────────────────────────────────────────────────
// A slim pod under each leading edge running back under the wing, a spinner and five blade cuffs on
// the front, a cooling ring, a lit status band, a vent on the tail cone. Built at g 0 and moved out.
function motor(name, g, h, propF, len, r0) {
  const f1 = propF - 0.004;
  const parts = [
    pod('motor pod', 0, 0, [[f1, r0 * 0.7], [f1 - 0.012, r0 * 0.95], [f1 - 0.035, r0], [f1 - 0.09, r0 * 0.98], [f1 - len * 0.6, r0 * 0.86], [f1 - len * 0.85, r0 * 0.6], [f1 - len, r0 * 0.25]], { sides: 12, paint: 'hull', shade: { base: 0.6, amp: 0.34 } }),
    pod('cooling ring', 0, 0, [[f1 - 0.02, r0 * 1.04], [f1 - 0.03, r0 * 1.04]], { sides: 12, paint: 'carbon' }),
    pod('status band', 0, 0, [[f1 - 0.05, r0 * 1.02], [f1 - 0.054, r0 * 1.02]], { sides: 12, paint: 'led' }),
    pod('vent', 0, 0, [[f1 - len * 0.72, r0 * 0.93], [f1 - len * 0.76, r0 * 0.9]], { sides: 12, paint: 'seam' }),
    cone('spinner', propF, 0, 0, r0 * 0.68, [propF + 0.034, 0, 0], { paint: 'spinner', n: 12 }),
  ];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + g * 3;
    parts.push(tube('blade cuff', [[propF + 0.006, Math.cos(a) * r0 * 0.5, Math.sin(a) * r0 * 0.5], [propF + 0.002, Math.cos(a) * r0 * 1.15, Math.sin(a) * r0 * 1.15]], 0.0045, { role: 'nacelle', paint: 'carbon', sides: 5 }));
  }
  return group(name, parts, { xf: { t: [0, g, h] }, ...FINE });
}
const FM = [{ g: 0.32, h: -0.083 }, { g: 0.68, h: -0.073 }];           // forward wing motors, under the leading edge
const AM = [{ g: 0.4, h: 0.237 }, { g: 0.8, h: 0.246 }];             // aft wing motors
const FPROP_F = 0.655, APROP_F = -0.5, FPROP_R = 0.092, APROP_R = 0.104;
const motors = mirror('motors', [
  ...FM.map((m, i) => motor('forward motor ' + (i + 1), m.g, m.h, FPROP_F, 0.25, 0.024)),
  ...AM.map((m, i) => motor('aft motor ' + (i + 1), m.g, m.h, APROP_F, 0.36, 0.026)),
]);

// ── The tail: pylon, twin endplate fins, ventral strake ─────────────────────────
// The aft wing stands on a swept pylon off the tail's crown. Its tips carry fins with rudders; each
// fin's leading edge carries the nav lamp, its top the strobe.
const pylon = [
  { kind: 'blade', name: 'wing pylon', paint: 'hull', role: 'fin', t: 0.016, sh: [0.86, 0.66], ...FINE,
    outline: [[-0.5, 0.15], [-0.6, 0.232], [-0.86, 0.232], [-0.92, 0.16], [-0.8, 0.15]], edges: [{ a: 0, b: 1, sh: 0.88 }] },
  { kind: 'blade', name: 'wing pylon (far)', paint: 'hull', role: 'fin', t: 0.016, sh: [0.86, 0.66], ...COARSE,
    outline: [[-0.5, 0.15], [-0.6, 0.232], [-0.86, 0.232], [-0.92, 0.16]] },
  // The fairing where the wing sits on the pylon.
  group('pylon cap', [pod('cap', 0, 0, [[-0.585, 0.004], [-0.6, 0.014], [-0.66, 0.022], [-0.8, 0.022], [-0.86, 0.012], [-0.88, 0.003]], { sides: 12, paint: 'hull', shade: { base: 0.6, amp: 0.34 } })],
    { xf: { t: [0, 0, 0.238] }, ...FINE }),
  // Ventral strake under the tail, a skid for a heavy rotation.
  { kind: 'blade', name: 'ventral strake', paint: 'trim', role: 'fin', t: 0.008, sh: [0.84, 0.64], ...FINE,
    outline: [[-0.78, 0.1], [-0.92, 0.04], [-0.95, 0.048], [-0.95, 0.12]] },
  { kind: 'drum', name: 'tail skid', f: -0.935, r: 0.006, n: 8, z: [0.034, 0.044], role: 'gear', paint: 'metal', sh: { base: 0.8 }, ...FINE },
];
const FN = [
  { g: 0.16, le: -0.71, te: -0.865, h: 1.106, t: 0.9 },
  { g: 0.43, le: -0.81, te: -0.905, h: 1.106, t: 0.75 },
];
const fins = mirror('endplate fins', [
  foil('endplate fin', FN, { axis: 'g', role: 'fin', paint: 'trim', nx: 9 }),
  ctrlOn('rudder', FN[0], FN[1], 0.2, 0.92, 0.36, { axis: 'g', sh: 0.72 }),
  // The fin's tip light, its top strobe and the nav lens on its leading edge.
  { kind: 'drum', name: 'fin tip strobe', f: -0.875, g: 1.106, r: 0.006, n: 8, z: [0.43, 0.442], role: 'nacelle', paint: 'strobe', sh: { base: 1 }, top: { sh: 1 }, ...FINE },
  group('nav lens', [pod('nav lens', 0, 0, [[-0.698, 0.004], [-0.705, 0.009], [-0.725, 0.01], [-0.74, 0.006]], { sides: 8, paint: 'navR', role: 'glass', capFore: { kind: 'apex', at: [-0.694, 0, 0] } })],
    { xf: { t: [0, 1.106, 0.258] }, ...FINE }),
  // A tip fairing on the forward wing too, with its strobe.
  group('forward tip', [pod('tip pod', 0, 0, [[0.555, 0.004], [0.545, 0.009], [0.47, 0.01], [0.42, 0.004]], { sides: 8, paint: 'trim' })],
    { xf: { t: [0, 0.902, -0.062] }, ...FINE }),
  tube('forward tip strobe', [[0.425, 0.902, -0.062], [0.405, 0.902, -0.062]], 0.0045, { role: 'nacelle', paint: 'strobe', sh: 1, sides: 6, caps: 1, ...FINE }),
]);
// The fin's flash: a navy band across its outer face, the 172's pinstripe carried up the tail.
const finX = (z, k) => lerp(FN[0][k], FN[1][k], (z - FN[0].g) / (FN[1].g - FN[0].g));
const tailFlash = mirror('fin flash', [poly('fin flash', [[0.33, 0.352], [0.364, 0.372]].map(([z0, z1]) => {
  const g = 1.106 + 0.0085, a = 0.3, b = 0.75, X = (z, x) => lerp(finX(z, 'le'), finX(z, 'te'), x);
  return quad([X(z0, a), g, z0], [X(z0, b), g, z0], [X(z1, b), g, z1], [X(z1, a), g, z1], { paint: 'stripe', sh: 0.85 });
}), FINE)]);

// ── Gear: a nose wheel and two mains, each in a pant ────────────────────────────
const GZ = -0.255, MW = { f: 0.08, g: 0.24, r: 0.042, hw: 0.016 }, NW = { f: 0.6, r: 0.035, hw: 0.014 };
// A pant: a slim teardrop over the top of the tyre, open below so the tread shows.
const pant = (name, w) => group(name, [pod('pant', 0, 0, [[0.085, 0.004], [0.07, 0.016], [0.035, 0.026], [-0.02, 0.026], [-0.07, 0.018], [-0.11, 0.004]],
  { sides: 12, paint: 'hull', shade: { base: 0.6, amp: 0.34 } })], { xf: { t: [w.f, w.g || 0, GZ + w.r + 0.014], s: [1, (w.hw + 0.01) / 0.026, w.r / 0.026] }, ...FINE });
const mainGear = mirror('main gear', [
  faired('main leg', [[0.1, 0.07, -0.15], [MW.f + 0.004, MW.g - 0.004, GZ + MW.r + 0.03]], 0.04, 0.012, { role: 'gear', paint: 'carbon', ...FINE }),
  tube('main oleo', [[0.09, 0.08, -0.15], [MW.f + 0.008, MW.g - 0.012, GZ + MW.r + 0.035]], 0.0055, { role: 'gear', paint: 'metal', sides: 6, ...FINE }),
  { ...wheel('main wheel', [MW.f, MW.g, GZ + MW.r], MW.r, MW.hw, 16), ...FINE },
  tube('main hub', [[MW.f, MW.g - MW.hw - 0.004, GZ + MW.r], [MW.f, MW.g + MW.hw + 0.004, GZ + MW.r]], 0.014, { role: 'gear', paint: 'metal', sh: 0.85, sides: 10, caps: 1, ...FINE }),
  pant('main pant', MW),
  // A brake line down the leg's back and the pant's lit stripe.
  tube('brake line', [[0.08, 0.075, -0.15], [MW.f - 0.012, MW.g - 0.01, GZ + MW.r + 0.04]], 0.002, { role: 'gear', paint: 'seam', sides: 4, ...FINE }),
  tube('pant light', [[MW.f + 0.05, MW.g + 0.024, GZ + MW.r + 0.022], [MW.f - 0.03, MW.g + 0.024, GZ + MW.r + 0.022]], 0.002, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
]);
const noseGear = group('nose gear', [
  faired('nose leg', [[NW.f - 0.01, 0, -0.152], [NW.f + 0.004, 0, GZ + NW.r + 0.035]], 0.032, 0.012, { role: 'gear', paint: 'carbon' }),
  tube('nose oleo', [[NW.f + 0.012, 0, -0.15], [NW.f + 0.012, 0, GZ + NW.r + 0.03]], 0.006, { role: 'gear', paint: 'metal', sides: 6 }),
  tube('nose fork', [[NW.f, -NW.hw - 0.006, GZ + NW.r + 0.03], [NW.f, -NW.hw - 0.006, GZ + NW.r], [NW.f, NW.hw + 0.006, GZ + NW.r], [NW.f, NW.hw + 0.006, GZ + NW.r + 0.03]], 0.0045, { role: 'gear', paint: 'metal', sides: 6 }),
  wheel('nose wheel', [NW.f, 0, GZ + NW.r], NW.r, NW.hw, 14),
  pant('nose pant', NW),
  tube('taxi lamp', [[NW.f + 0.07, 0, GZ + NW.r + 0.024], [NW.f + 0.078, 0, GZ + NW.r + 0.024]], 0.007, { role: 'nacelle', paint: 'strobe', sh: 1, sides: 8, caps: 1 }),
], FINE);

// ── Sensors and antennas ────────────────────────────────────────────────────────
// It can fly itself, so the nose is a sensor head: a lidar puck on the apex, a smoked chin with two
// cameras, a pitot under each forward wing tip, a GNSS mast on the aft wing, blades under the belly.
const sensors = [
  group('lidar puck', [pod('lidar', 0, 0, [[0.02, 0.004], [0.016, 0.014], [0.004, 0.017], [-0.006, 0.017]], { sides: 14, paint: 'carbon', regions: [{ at: [0.016], k: 'all', role: 'glass', tint: [20, 26, 32] }] })],
    { xf: { t: [MAYFLY76_APEX[0] - 0.004, 0, MAYFLY76_APEX[2]] }, ...FINE }),
  group('chin sensor', [pod('chin', 0, 0, [[0.05, 0.005], [0.04, 0.016], [0.02, 0.022], [-0.02, 0.022], [-0.05, 0.01], [-0.065, 0.003]], {
    sides: 14, paint: 'carbon', regions: [{ at: [0.04, 0.02], k: 'all', role: 'glass', tint: [22, 28, 34] }],
  })], { xf: { t: [0.72, 0, -0.118], s: [1, 1.4, 1] }, ...FINE }),
  mirror('cameras and pitots', [
    group('side camera', [pod('camera', 0, 0, [[0.014, 0.003], [0.01, 0.009], [-0.012, 0.01], [-0.02, 0.004]], { sides: 10, paint: 'carbon', regions: [{ at: [0.014], k: 'all', role: 'glass', tint: [18, 22, 26] }] })],
      { xf: { t: [0.715, 0.098, -0.07] }, ...FINE }),
    tube('pitot', [[0.5, 0.84, -0.068], [0.54, 0.84, -0.08], [0.6, 0.84, -0.08]], 0.0028, { role: 'gear', paint: 'metal', sh: 0.85, sides: 5, ...FINE }),
  ]),
  { kind: 'blade', name: 'GNSS mast', role: 'fin', paint: 'carbon', t: 0.003, sh: [0.75, 0.6], outline: [[-0.7, 0.25], [-0.715, 0.29], [-0.73, 0.29], [-0.75, 0.25]], ...FINE },
  { kind: 'blade', name: 'datalink blade', role: 'fin', paint: 'carbon', t: 0.003, sh: [0.75, 0.6], outline: [[-0.3, 0.14], [-0.31, 0.175], [-0.325, 0.175], [-0.34, 0.14]], ...FINE },
  { kind: 'blade', name: 'ADS-B blade', role: 'fin', paint: 'carbon', t: 0.003, sh: [0.75, 0.6], outline: [[0.32, -0.166], [0.312, -0.2], [0.3, -0.2], [0.29, -0.166]], ...FINE },
  { kind: 'drum', name: 'beacon base', f: -0.735, r: 0.012, n: 12, z: [0.256, 0.262], role: 'nacelle', paint: 'carbon', sh: { base: 0.55, alt: 0.1 }, ...FINE },
  { kind: 'drum', name: 'beacon', f: -0.735, r: 0.008, n: 12, z: [0.262, 0.274], role: 'nacelle', paint: 'beacon', sh: { base: 0.9 }, top: { sh: 1 }, ...FINE },
  { kind: 'drum', name: 'belly beacon', f: 0.2, r: 0.009, n: 10, z: [-0.18, -0.168], role: 'nacelle', paint: 'beacon', sh: { base: 0.9 }, bottom: { sh: 1 }, ...FINE },
  tube('tail strobe', [[MAYFLY76_TAIL[0] + 0.008, 0, MAYFLY76_TAIL[2]], [MAYFLY76_TAIL[0] - 0.012, 0, MAYFLY76_TAIL[2]]], 0.006, { role: 'nacelle', paint: 'strobe', sh: 1, sides: 6, caps: 1, ...FINE }),
];

// ── The room under the bubble ───────────────────────────────────────────────────
// Seen through the canopy from outside: the seat, the swept dash with its glass band, the sidestick.
// The seated cockpit is interior-mayfly-2076.js.
function slab(c, [sf, sg, sh], pitch, extra = {}) {
  const cp = Math.cos(pitch * DEG), sp = Math.sin(pitch * DEG);
  const P = (df, dg, dh) => P3([c[0] + df * cp - dh * sp, c[1] + dg, c[2] + df * sp + dh * cp]);
  const f = sf / 2, g = sg / 2, h = sh / 2;
  const v = [P(-f, -g, -h), P(f, -g, -h), P(f, g, -h), P(-f, g, -h), P(-f, -g, h), P(f, -g, h), P(f, g, h), P(-f, g, h)];
  return [
    quad(v[4], v[5], v[6], v[7], { sh: 0.86, ...extra }), quad(v[3], v[2], v[1], v[0], { sh: 0.4, ...extra }),
    quad(v[1], v[2], v[6], v[5], { sh: 0.74, ...extra }), quad(v[0], v[4], v[7], v[3], { sh: 0.55, ...extra }),
    quad(v[0], v[1], v[5], v[4], { sh: 0.62, ...extra }), quad(v[3], v[7], v[6], v[2], { sh: 0.66, ...extra }),
  ];
}
const FH = MAYFLY76_INSIDE.floorH;
const room = [
  poly('seat', [
    ...slab([0.27, 0, FH + 0.07], [0.12, 0.13, 0.02], 6, { paint: 'seat' }),
    ...slab([0.19, 0, FH + 0.15], [0.02, 0.12, 0.16], -22, { paint: 'seat' }),
    ...slab([0.15, 0, FH + 0.25], [0.02, 0.07, 0.045], -22, { paint: 'seat' }),
  ], FINE),
  poly('seat bolsters', [...slab([0.2, 0.065, FH + 0.14], [0.03, 0.012, 0.13], -22, { paint: 'interior' }), ...slab([0.2, -0.065, FH + 0.14], [0.03, 0.012, 0.13], -22, { paint: 'interior' })], FINE),
  poly('floor', [quad([0.62, -0.1, FH], [0.62, 0.1, FH], [0.12, 0.1, FH], [0.12, -0.1, FH], { paint: 'interior', sh: 0.45 })], FINE),
  poly('dash', slab([0.585, 0, 0.02], [0.05, 0.25, 0.03], 26, { paint: 'interior' }), FINE),
  poly('glass band', slab([0.566, 0, 0.032], [0.004, 0.23, 0.05], 60, { paint: 'screen' }), FINE),
  poly('sidestick', [...slab([0.36, 0.085, FH + 0.18], [0.1, 0.035, 0.03], 0, { paint: 'interior' }), ...slab([0.39, 0.085, FH + 0.215], [0.012, 0.012, 0.045], 0, { paint: 'interior' })], FINE),
  poly('bulkhead', [quad([MAYFLY76_INSIDE.bulkheadF, -0.12, FH], [MAYFLY76_INSIDE.bulkheadF, 0.12, FH], [MAYFLY76_INSIDE.bulkheadF, 0.12, 0.17], [MAYFLY76_INSIDE.bulkheadF, -0.12, 0.17], { paint: 'interior', sh: 0.5 })], FINE),
];

// ── The coarse body, for range ──────────────────────────────────────────────────
const coarse = [
  loft('pod (far)', 12, ST.filter((_, i) => i % 2 === 0 || i === ST.length - 1), {
    ...COARSE, paint: 'hull', capFore: { kind: 'apex', at: MAYFLY76_APEX, paint: 'carbon' }, capAft: { kind: 'apex', at: MAYFLY76_TAIL },
    regions: [{ at: [0.72, 0.61, 0.46, 0.3, 0.14], k: [0, 1, 2, 3, 4, 5, 6], role: 'glass', tint: GLASS }],
  }),
  mirror('motors (far)', [...FM.map((m) => [m, FPROP_F, 0.25, 0.024]), ...AM.map((m) => [m, APROP_F, 0.36, 0.026])].map(([m, pf, len, r0]) =>
    group('motor (far)', [pod('motor (far)', 0, 0, [[pf + 0.03, 0.005], [pf, r0], [pf - len * 0.6, r0 * 0.86], [pf - len, 0.005]], { sides: 6, paint: 'hull' })], { xf: { t: [0, m.g, m.h] }, ...COARSE }))),
  mirror('gear (far)', [
    tube('main leg (far)', [[0.1, 0.07, -0.15], [MW.f, MW.g, GZ + MW.r]], 0.01, { role: 'gear', paint: 'carbon', sides: 4, ...COARSE }),
    { ...wheel('main wheel (far)', [MW.f, MW.g, GZ + MW.r], MW.r, MW.hw, 8), ...COARSE },
  ]),
  { ...wheel('nose wheel (far)', [NW.f, 0, GZ + NW.r], NW.r, NW.hw, 8), ...COARSE },
  tube('nose leg (far)', [[NW.f, 0, -0.15], [NW.f, 0, GZ + NW.r]], 0.01, { role: 'gear', paint: 'carbon', sides: 4, ...COARSE }),
];

// ── Rotors and lamps ────────────────────────────────────────────────────────────
// Eight props, five blades each. Neighbours turn opposite ways and the pattern mirrors across the
// centreline, so the torque cancels in a hover and the wash is symmetric.
const rotors = [];
for (const s of [1, -1]) {
  FM.forEach((m, i) => {
    const r = { at: [FPROP_F, R(s * m.g), m.h], plane: 'fore', r: FPROP_R, blades: 5, lead: 0.85, spinMul: 1.4, phase: R(i * 0.41 + (s > 0 ? 0 : 0.2)) };
    if ((i % 2 === 0) === (s > 0)) r.dir = -1;
    rotors.push(r);
  });
  AM.forEach((m, i) => {
    const r = { at: [APROP_F, R(s * m.g), m.h], plane: 'fore', r: APROP_R, blades: 5, lead: 0.85, spinMul: 1.3, phase: R(i * 0.37 + 0.9 + (s > 0 ? 0 : 0.2)) };
    if ((i % 2 === 1) === (s > 0)) r.dir = -1;
    rotors.push(r);
  });
}
const lamps = [
  { at: [-0.692, -1.106, 0.258], n: [0.3, -1, 0], rgb: '255,55,55', kind: 'steady' },
  { at: [-0.692, 1.106, 0.258], n: [0.3, 1, 0], rgb: '60,255,95', kind: 'steady' },
  { at: [-0.875, -1.106, 0.444], n: [0, 0, 1], rgb: '255,255,255', kind: 'strobe' },
  { at: [-0.875, 1.106, 0.444], n: [0, 0, 1], rgb: '255,255,255', kind: 'strobe' },
  { at: [0.402, -0.902, -0.062], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [0.402, 0.902, -0.062], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [MAYFLY76_TAIL[0] - 0.014, 0, MAYFLY76_TAIL[2]], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [-0.735, 0, 0.276], n: [0, 0, 1], rgb: '255,90,70', kind: 'beacon' },
  { at: [0.2, 0, -0.182], n: [0, 0, -1], rgb: '255,90,70', kind: 'beacon' },
];

const doc = {
  id: 'ultralight_2076',
  kind: 'mesh',
  params: {
    name: 'Mayfly 2076',
    note: 'CONCEPT, generated by scripts/shapes/concepts/mayfly-2076.mjs (edit that, not this). The Mayfly fifty years on, after the Opener BlackFly and the Pivotal Helix: a single-seat electric tilt-wing ultralight. A teardrop pod under one bubble canopy that tilts forward on its bow, a tail swept up into the aft wing, a low forward wing with full-span elevators and a high aft wing on a pylon with flaps, ailerons and twin endplate fins with rudders; four motors with five-blade props on each wing, both wings on tilt hinges at their roots (drawn in cruise); battery bays down the flanks, a charge port, a ballistic parachute hatch, a lidar nose and chin cameras; tricycle gear in pants, as the 172 had. A variant of the ultralight mesh, worn as the Mayfly 2076 factory edition.',
    groundPitch: 0,
    navLamps: null,
    lamps,
    rotors,
    finish: 'gloss',
    paints: {
      hull: { rgb: [236, 238, 240], livery: 'base' },
      trim: { rgb: [36, 86, 170], livery: 'trim' },
      belly: { rgb: [36, 86, 170], livery: 'trim' },
      spinner: { rgb: [36, 86, 170], livery: 'trim' },
      stripe: { rgb: [20, 38, 84], livery: 'fixed', mat: 'matte' },
      glare: { rgb: [26, 30, 36], livery: 'fixed', mat: 'matte' },
      boot: { rgb: [44, 48, 54], livery: 'fixed', mat: 'matte' },
      frame: { rgb: [26, 30, 36], livery: 'fixed', mat: 'gloss' },
      seam: { rgb: [70, 76, 84], livery: 'fixed', mat: 'matte' },
      carbon: { rgb: [36, 40, 46], livery: 'fixed', mat: 'satin' },
      metal: { rgb: [156, 162, 170], livery: 'fixed', mat: 'bare' },
      rubber: { rgb: [24, 24, 26], livery: 'fixed', mat: 'rubber' },
      warn: { rgb: [214, 52, 40], livery: 'fixed', mat: 'gloss' },
      led: { rgb: [127, 214, 255], livery: 'fixed', mat: 'matte' },
      navR: { rgb: [210, 210, 210], livery: 'fixed', mat: 'gloss' },
      beacon: { rgb: [235, 70, 56], livery: 'fixed', mat: 'gloss' },
      strobe: { rgb: [240, 244, 248], livery: 'fixed', mat: 'gloss' },
      interior: { rgb: [34, 38, 44], livery: 'fixed', mat: 'matte' },
      seat: { rgb: [70, 78, 92], livery: 'fixed', mat: 'satin' },
      screen: { rgb: [90, 190, 230], livery: 'fixed', mat: 'gloss' },
    },
    parts: [
      pod76, canopy, ...frames, ...seams, ...chargePort, ...trim,
      wingF, elevIn, elevOut, wingA, flaps, ailerons, slots, leLights, vgs, ...tilt,
      motors, ...pylon, fins, tailFlash, mainGear, noseGear, ...sensors, ...room,
      ...coarse,
    ],
  },
};

const v = validateMesh(doc.params, doc.id);
if (v.errors.length) { console.log('ERRORS', v.errors.slice(0, 12)); process.exit(1); }
if (v.warnings?.length) console.log('warnings', v.warnings.slice(0, 8));
const n1 = compileMesh(doc.params, { detail: 1 }).faces.length, n0 = compileMesh(doc.params, { detail: 0 }).faces.length;
writeFileSync(new URL('../../../content/vehicle_models/mesh_ultralight_2076.json', import.meta.url), formatMesh(doc));
console.log('mesh_ultralight_2076.json:', n1, 'faces near,', n0, 'far');
