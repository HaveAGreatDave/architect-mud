// The Mule 2076 concept: writes content/vehicle_models/mesh_prop_2076.json.
//
//   node scripts/shapes/concepts/mule-2076.mjs
//   then: npm run vehicles:bake
//
// The Mule fifty years on, after the Electra.aero EL9 and Reliable Robotics' pilotless Caravans: the
// Twin Otter's strut-braced high wing kept, but lined along its leading edge with eight small electric
// props whose wash blows over full-span double-slotted flaps; a boxier freighter hull with a
// wraparound flight-deck windscreen, a side cargo door and a rear ramp under an upswept tail; a
// T-tail; a hydrogen turbogenerator in a dorsal nacelle with two cryogenic tanks on the crown beside it; a lidar chin and a satcom dome, because it can
// fly itself; and fat tundra tyres on sponsons, because it still lands on gravel. It is a variant of
// the prop mesh (mesh_prop.json `variants`), worn as the Mule 2076 factory edition.
//
// ⚠ THIS OVERWRITES THE JSON. Edit this file, not the mesh in the Modelshop.
//
// Two bodies in one file. Everything fine is `minDetail: 1`; a coarse body with `maxDetail: 0`
// stands in at range. The wing, fin and tailplane are foil() groups, which carry their own two LODs.
//
// Frame: f fore, g right, h up, in the Mule's units (f -0.98..1.0, span ±1.24, wheels on the ground
// at h -0.285), so it sits on the ground as the Otter does. Angles on a section are lib.mjs's: 0 = right
// waterline, +90 = crown, -90 = keel.
import { writeFileSync } from 'node:fs';
import { R, P3, skin, loft, pod, foil, foilPt, lerpSt, ctrlOn, tube, mirror, group, poly as rawPoly, quad, cone, wheel, faired, DEG } from '../fw-meshes/lib.mjs';
const { formatMesh, validateMesh, compileMesh } = await import('../../../client/shared/vehicle-mesh.js');
const { MULE76_STATIONS, MULE76_APEX, MULE76_TAIL, MULE76_GLASS, MULE76_DOOR, MULE76_CARGO, MULE76_RAMP, MULE76_INSIDE } = await import('../../../client/shared/cabin-mule-2076.js');

const FINE = { minDetail: 1 }, COARSE = { maxDetail: 0 };
// Every poly face needs a role; trim and fittings are 'nacelle' unless they say otherwise.
const poly = (name, faces, extra) => rawPoly(name, faces.map((f) => ({ role: 'nacelle', ...f })), extra);
const GLASS = [52, 84, 108];
const lerp = (a, b, t) => a + (b - a) * t;
const range = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));
const P3s = (a) => a.map(P3);

// ── The fuselage ────────────────────────────────────────────────────────────────
// Stated once in client/shared/cabin-mule-2076.js, which the cockpit is built off too.
const ST = MULE76_STATIONS;
const at = (f, a, out = 0) => skin(ST, f, a * DEG, out);
const NS = 32;
// Belly panels in the fixed grey, k 19..28 of 32 (about -146° to -45°).
const BELLY_K = Array.from({ length: 10 }, (_, i) => 19 + i);
const fuselage = loft('fuselage', NS, ST, {
  ...FINE, paint: 'hull',
  note: 'The shell. Glass, frames, doors, seams and trim are separate parts laid a hair proud of it.',
  capFore: { kind: 'apex', at: MULE76_APEX, paint: 'carbon' },
  capAft: { kind: 'apex', at: MULE76_TAIL, paint: 'hull' },
  regions: [{ at: ST.map((s) => s.f), k: BELLY_K, paint: 'belly' }],
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

// ── Glass ───────────────────────────────────────────────────────────────────────
// The windscreen: one sheet from waist to waist over the sloping nose, split by posts drawn over it.
const W = MULE76_GLASS.windscreen;
const WS_F = [W.f[1], 0.83, 0.81, 0.785, 0.76, 0.735, 0.71, W.f[0]];
const windscreen = poly('windscreen', patch(WS_F, range(W.a[0], W.a[1], 40), { role: 'glass', tint: GLASS }), FINE);
// Eyebrow windows over the crew's heads, the crew door windows, and a few portholes, each side.
const E = MULE76_GLASS.eyebrow, Dg = MULE76_GLASS.door;
const sideGlass = mirror('side glass', [
  poly('eyebrow window', patch(range(E.f[1], E.f[0], 3), range(E.a[0], E.a[1], 4), { role: 'glass', tint: GLASS }), FINE),
  poly('crew door window', patch(range(Dg.f[1], Dg.f[0], 4), range(Dg.a[0], Dg.a[1], 6), { role: 'glass', tint: GLASS }), FINE),
  ...MULE76_GLASS.portholes.map((p, i) => poly('porthole ' + (i + 1), patch(range(p.f[1], p.f[0], 2), range(p.a[0], p.a[1], 3), { role: 'glass', tint: GLASS }), FINE)),
]);

// Frames: dark posts and rails standing just proud of the glass.
const FR = (name, pts, r = 0.0045) => tube(name, pts, r, { role: 'nacelle', paint: 'frame', sh: 0.5, sides: 5, ...FINE });
const frames = [
  FR('windscreen aft arch', roundF(W.f[0], range(W.a[0], W.a[1], 30), 0.0045), 0.0055),
  FR('windscreen fore edge', roundF(W.f[1], range(W.a[0], W.a[1], 30), 0.0045), 0.005),
  FR('windscreen sill (right)', alongF(WS_F, W.a[0])),
  FR('windscreen sill (left)', alongF(WS_F, W.a[1])),
  ...MULE76_GLASS.posts.map((a, i) => FR('windscreen post ' + (i + 1), alongF(WS_F, a, 0.0046), a === 90 ? 0.0042 : 0.005)),
  ...[0, 1].flatMap((s) => {
    const A = mirA(s), side = s ? 'left' : 'right';
    const box = (name, r) => FR(name + ' (' + side + ')', [...roundF(r.f[0], range(A(r.a[0]), A(r.a[1]), 4)), ...alongF(range(r.f[0], r.f[1], 4), A(r.a[1])).slice(1),
      ...roundF(r.f[1], range(A(r.a[1]), A(r.a[0]), 4)).slice(1), ...alongF(range(r.f[1], r.f[0], 4), A(r.a[0])).slice(1)], 0.004);
    return [box('eyebrow frame', E), box('door window frame', Dg), ...MULE76_GLASS.portholes.map((p) => box('porthole ring', p))];
  }),
];

// ── Doors, the cargo door, the ramp ─────────────────────────────────────────────
const SEAM = (name, pts) => tube(name, pts, 0.0026, { role: 'nacelle', paint: 'seam', sh: 0.4, sides: 4, ...FINE });
const doors = [0, 1].flatMap((s) => {
  const A = mirA(s), side = s ? 'left' : 'right', D = MULE76_DOOR;
  return [
    SEAM('crew door seam (' + side + ')', [...roundF(D.f[0], range(A(D.aLo), A(D.aHi), 10), 0.0026), ...alongF(range(D.f[0], D.f[1], 6), A(D.aHi), 0.0026).slice(1),
      ...roundF(D.f[1], range(A(D.aHi), A(D.aLo), 10), 0.0026).slice(1), ...alongF(range(D.f[1], D.f[0], 6), A(D.aLo), 0.0026).slice(1)]),
    poly('crew door handle recess (' + side + ')', patch([0.535, 0.515], [A(-22), A(-14)], { paint: 'seam' }, 0.0026), FINE),
    tube('crew door handle (' + side + ')', [at(0.532, A(-18), 0.006), at(0.516, A(-18), 0.006)], 0.0035, { role: 'nacelle', paint: 'metal', sh: 0.85, sides: 6, ...FINE }),
    // A fold-down step under each crew door.
    tube('crew step (' + side + ')', [at(0.62, A(-62), 0.002), [0.62, (s ? -1 : 1) * 0.165, -0.15], [0.56, (s ? -1 : 1) * 0.165, -0.15], at(0.56, A(-62), 0.002)], 0.004, { role: 'gear', paint: 'metal', sides: 5, ...FINE }),
  ];
});
const C = MULE76_CARGO, Rp = MULE76_RAMP;
const cargoDoor = [
  // The big side door on the left, aft of the wing, with its two hinges up at the roof and a lit
  // status strip beside it.
  SEAM('cargo door seam', [...roundF(C.f[0], range(180 - C.aLo, 180 - C.aHi, 12), 0.0026), ...alongF(range(C.f[0], C.f[1], 8), 180 - C.aHi, 0.0026).slice(1),
    ...roundF(C.f[1], range(180 - C.aHi, 180 - C.aLo, 12), 0.0026).slice(1), ...alongF(range(C.f[1], C.f[0], 8), 180 - C.aLo, 0.0026).slice(1)]),
  SEAM('cargo door split', roundF((C.f[0] + C.f[1]) / 2, range(180 - C.aLo, 180 - C.aHi, 12), 0.0026)),
  ...[C.f[0] + 0.05, C.f[1] - 0.05, (C.f[0] + C.f[1]) / 2 - 0.05, (C.f[0] + C.f[1]) / 2 + 0.05].map((f) => tube('cargo door hinge', [at(f + 0.012, 180 - (C.aHi + 4), 0.004), at(f - 0.012, 180 - (C.aHi + 4), 0.004)], 0.004, { role: 'nacelle', paint: 'metal', sides: 6, ...FINE })),
  tube('cargo door lamp strip', roundF(C.f[1] + 0.014, range(180 - 30, 180 + 10, 4), 0.004), 0.003, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  poly('cargo door handle', patch([(C.f[0] + C.f[1]) / 2 + 0.02, (C.f[0] + C.f[1]) / 2 - 0.02], [180 + 6, 180 + 14], { paint: 'seam' }, 0.0028), FINE),
  // The rear ramp's seam, from below: two sides and the hinge line across the belly.
  SEAM('ramp seam (right)', alongF(range(Rp.f[1], Rp.f[0], 8), Rp.aHi, 0.0026)),
  SEAM('ramp seam (left)', alongF(range(Rp.f[1], Rp.f[0], 8), Rp.aLo, 0.0026)),
  SEAM('ramp hinge line', roundF(Rp.f[1], range(Rp.aHi, Rp.aLo, 12), 0.0026)),
  SEAM('ramp lip', roundF(Rp.f[0], range(Rp.aHi, Rp.aLo, 12), 0.0026)),
  // Ramp actuator fairings either side of the tail.
  mirror('ramp actuator fairings', [group('ramp actuator', [pod('fairing', 0, 0, [[0.07, 0.004], [0.05, 0.012], [-0.04, 0.012], [-0.07, 0.004]], { sides: 8, paint: 'belly' })], { xf: { t: [Rp.f[0] + 0.12, 0.1, -0.035] }, ...FINE })]),
];

// ── Trim: the cheatline, the LED line under it, the anti-glare, the belly ───────
const trimFs = [0.975, 0.94, 0.9, 0.86, 0.81, 0.76, 0.71, 0.66, 0.6, 0.5, 0.3, 0.05, -0.15, -0.3, -0.44, -0.58, -0.72];
const trim = [
  mirror('cheatline', [poly('cheatline', patch(trimFs, [-20, -11], { paint: 'trim' }, 0.0018), FINE)]),
  tube('LED line (right)', alongF(trimFs, -8, 0.004), 0.0028, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  tube('LED line (left)', alongF(trimFs, 188, 0.004), 0.0028, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  poly('anti-glare', patch([0.97, 0.94, 0.9, W.f[1] + 0.004], range(50, 130, 8), { paint: 'glare' }, 0.0018), FINE),
  // A tail flash in the trim colour up the upswept tail.
  mirror('tail flash', [poly('tail flash', patch([-0.58, -0.66, -0.72, -0.78, -0.84], [8, 40], { paint: 'trim' }, 0.0018), FINE)]),
];

// ── The wing ────────────────────────────────────────────────────────────────────
// Straight and strut-braced like the Otter's, a little more chord for the blown flaps, on a fairing
// that lifts it clear of the crown.
const WG = [
  { g: 0, le: 0.36, te: -0.11, h: 0.19, t: 1.15 },
  { g: 0.5, le: 0.36, te: -0.11, h: 0.193, t: 1.05 },
  { g: 1.1, le: 0.33, te: -0.08, h: 0.198, t: 0.86 },
  { g: 1.15, le: 0.325, te: -0.075, h: 0.198, t: 0.62 },
];
const wing = foil('wing', WG, { nx: 13, paint: 'hull', bands: [{ x0: 0, x1: 0.06, paint: 'boot' }] });
const flapsIn = ctrlOn('flap', WG[0], WG[1], 0.17, 1, 0.34);
const flapsOut = ctrlOn('flap', WG[1], WG[2], 0, 0.5, 0.34);
const ailerons = ctrlOn('aileron', WG[1], WG[2], 0.52, 0.98, 0.3);
// The fairing between the hull's crown and the wing's root.
const wingFairing = loft('wing fairing', 16, [
  [0.4, 0.02, 0.012], [0.37, 0.07, 0.028], [0.3, 0.1, 0.036], [0.1, 0.104, 0.04], [-0.08, 0.09, 0.036], [-0.14, 0.05, 0.022], [-0.17, 0.015, 0.008],
].map(([f, rg, rvT]) => ({ f, rg, rvT, rvB: 0.03, cz: 0.165, boxy: 0.5 })), { ...FINE, paint: 'hull', capFore: { kind: 'apex', at: [0.405, 0, 0.165] }, capAft: { kind: 'apex', at: [-0.175, 0, 0.165] } });
// A point on the wing's mean surface at span g, chord x; `up` the upper surface.
const wingAt = (g, x, up = 1) => {
  for (let i = 0; i < WG.length - 1; i++) if (g <= WG[i + 1].g + 1e-9) return foilPt(lerpSt(WG[i], WG[i + 1], (g - WG[i].g) / (WG[i + 1].g - WG[i].g)), x, up);
  return foilPt(WG[WG.length - 1], x, up);
};
// Vortex generators: a row of small blades along the leading edge, toed alternately.
const vgs = mirror('vortex generators', [poly('vortex generators', range(0.2, 1.08, 30).flatMap((g, i) => {
  const p = wingAt(g, 0.1), tq = (i % 2 ? 1 : -1) * 0.004;
  const a = [p[0] + 0.008, g - tq, p[2] + 0.001], b = [p[0] - 0.008, g + tq, p[2] + 0.001];
  return [quad(a, b, [b[0], b[1], b[2] + 0.009], [a[0] + 0.004, a[1], a[2] + 0.004], { paint: 'metal', sh: 0.8 }),
    quad([a[0] + 0.004, a[1], a[2] + 0.004], [b[0], b[1], b[2] + 0.009], b, a, { paint: 'metal', sh: 0.6 })];
}), FINE)]);
// Flap track fairings: canoes under the trailing edge between the nacelles, the slots' tracks.
const TRACK_G = [0.18, 0.4, 0.62, 0.84, 1.04];
const tracks = mirror('flap track fairings', TRACK_G.map((g) => {
  const lo = wingAt(g, 0.72, 0);
  return group('flap track', [pod('canoe', 0, 0, [[0.05, 0.004], [0.03, 0.012], [-0.06, 0.012], [-0.13, 0.009], [-0.17, 0.003]], { sides: 8, paint: 'hull', shade: { base: 0.55, amp: 0.3 } })],
    { xf: { t: [R(lo[0]), g, R(lo[2] - 0.006)] }, ...FINE });
}));
// The flap slot: a dark line along the hinge, the double slot's vane showing through.
const slot = mirror('flap slot', [
  tube('flap slot', [0.12, 0.5, 1.0].map((g) => { const p = wingAt(g, 0.66, 1); return [p[0], g, p[2] + 0.002]; }), 0.0025, { role: 'wing', paint: 'seam', sides: 4, ...FINE }),
]);
// Raked winglets, lit at the leading edge with the nav lamp, a strobe at the tip.
const winglets = mirror('winglets', [
  { kind: 'panel', name: 'winglet', role: 'fin', sh: 0.82, th: 0.006, paint: 'trim', ...FINE, c: P3s([[0.3, 1.15, 0.2], [0.02, 1.205, 0.3], [-0.06, 1.205, 0.3], [-0.07, 1.15, 0.2]]) },
  { kind: 'panel', name: 'winglet (far)', role: 'fin', sh: 0.82, th: 0.01, paint: 'trim', ...COARSE, c: P3s([[0.3, 1.15, 0.2], [0.02, 1.205, 0.3], [-0.06, 1.205, 0.3], [-0.07, 1.15, 0.2]]) },
  pod('nav lens', 0, 0, [[0.34, 0.004], [0.33, 0.009], [0.3, 0.01], [0.28, 0.006]], { sides: 8, paint: 'navR', role: 'glass', capFore: { kind: 'apex', at: [0.345, 0, 0] } }),
  tube('tip strobe', [[-0.055, 1.206, 0.3], [-0.075, 1.206, 0.3]], 0.005, { role: 'nacelle', paint: 'strobe', sh: 1, sides: 6, caps: 1, ...FINE }),
]);
// The nav lens is built at g 0 and must sit at the tip: move it there inside the mirror.
winglets.parts[2] = group('nav lens', [winglets.parts[2]], { xf: { t: [0, 1.15, 0.2] }, ...FINE });

// ── Eight motors on the leading edge ────────────────────────────────────────────
// Slim pods slung just under the leading edge, a spinner and five blade cuffs on each, a cooling
// ring behind the spinner. The props sit in a line so their wash covers the whole flap span.
const MOTOR_G = [0.27, 0.49, 0.71, 0.93];
const MH = 0.165, PROP_F = 0.505, PROP_R = 0.096;
function motor(g, i) {
  const parts = [
    pod('motor pod', 0, 0, [[0.5, 0.022], [0.49, 0.03], [0.46, 0.034], [0.4, 0.035], [0.32, 0.034], [0.24, 0.03], [0.17, 0.022], [0.12, 0.012], [0.09, 0.004]], { sides: 12, paint: 'hull', shade: { base: 0.6, amp: 0.34 } }),
    pod('cooling ring', 0, 0, [[0.47, 0.0365], [0.455, 0.0365]], { sides: 12, paint: 'carbon' }),
    pod('exhaust vent', 0, 0, [[0.2, 0.031], [0.19, 0.031]], { sides: 12, paint: 'seam' }),
    cone('spinner', PROP_F - 0.002, 0, 0, 0.022, [PROP_F + 0.04, 0, 0], { paint: 'spinner', n: 12 }),
    // The pylon up into the wing.

    // A lit ring round each pod, the motor's status light.
    pod('status ring', 0, 0, [[0.44, 0.0362], [0.436, 0.0362]], { sides: 12, paint: 'led' }),
  ];
  // The blade cuffs, where the drawn blades start.
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + i * 0.4;
    parts.push(tube('blade cuff', [[PROP_F + 0.004, Math.cos(a) * 0.02, Math.sin(a) * 0.02], [PROP_F, Math.cos(a) * 0.04, Math.sin(a) * 0.04]], 0.006, { role: 'nacelle', paint: 'carbon', sides: 5 }));
  }
  return group('motor ' + (i + 1), parts, { xf: { t: [0, g, MH] }, ...FINE });
}
const motors = mirror('motors', MOTOR_G.map(motor));
const propDiscs = mirror('prop discs', MOTOR_G.map((g) => ({
  kind: 'ngon', name: 'prop disc', f: PROP_F, g, h: MH, n: 12, r: PROP_R, role: 'rotor', sh: 0.65, ...FINE,
  note: 'Schematic only: painted renderers draw the blades from `rotors`.',
})));

// ── Struts ──────────────────────────────────────────────────────────────────────
const struts = mirror('struts', [
  faired('lift strut', [[0.12, 0.14, -0.07], [0.14, 0.6, 0.175]], 0.05, 0.011, { paint: 'hull', ...FINE }),
  faired('jury strut', [[0.13, 0.42, 0.115], [0.16, 0.42, 0.18]], 0.022, 0.006, { paint: 'hull', ...FINE }),
  tube('strut root fitting', [[0.14, 0.14, -0.072], [0.1, 0.14, -0.072]], 0.009, { role: 'gear', paint: 'metal', sides: 6, ...FINE }),
]);

// ── Gear: sponsons, legs and tundra tyres ───────────────────────────────────────
const GZ = -0.285, MW = { f: 0.04, g: 0.292, r: 0.082, hw: 0.04 }, NW = { f: 0.82, r: 0.062, hw: 0.03 };
const mainGear = mirror('main gear', [
  group('sponson', [pod('sponson', 0, 0, [[0.27, 0.008], [0.25, 0.026], [0.2, 0.038], [0.06, 0.042], [-0.08, 0.04], [-0.16, 0.026], [-0.2, 0.008]], { sides: 12, paint: 'belly', shade: { base: 0.55, amp: 0.34 } })],
    { xf: { t: [0, 0.15, -0.115], s: [1, 1.25, 1] }, ...FINE }),
  faired('gear leg', [[0.06, 0.19, -0.12], [MW.f + 0.005, MW.g - MW.hw - 0.006, GZ + MW.r]], 0.05, 0.014, { role: 'gear', paint: 'carbon', ...FINE }),
  tube('oleo', [[0.075, 0.2, -0.12], [MW.f + 0.02, MW.g - MW.hw - 0.01, GZ + MW.r + 0.01]], 0.007, { role: 'gear', paint: 'metal', sides: 6, ...FINE }),
  { ...wheel('tundra tyre', [MW.f, MW.g, GZ + MW.r], MW.r, MW.hw, 18), ...FINE },
  // Hub cap and a mudguard over the top of the tyre.
  { kind: 'drum', name: 'hub', f: MW.f, r: 0.03, n: 10, z: [0, 0], role: 'gear', paint: 'metal', sh: { base: 0.8 }, ...FINE, note: 'placeholder, replaced below' },
  tube('mudguard', range(20, 160, 8).map((d) => [MW.f + Math.cos(d * DEG) * (MW.r + 0.012), MW.g, GZ + MW.r + Math.sin(d * DEG) * (MW.r + 0.012)]), 0.012, { role: 'gear', paint: 'carbon', sides: 5, ...FINE }),
]);
// A drum lies along h, so the hub cap is a short tube along g instead.
mainGear.parts[4] = tube('hub', [[MW.f, MW.g + MW.hw - 0.002, GZ + MW.r], [MW.f, MW.g + MW.hw + 0.008, GZ + MW.r]], 0.03, { role: 'gear', paint: 'metal', sides: 10, caps: 1, ...FINE });
const noseGear = group('nose gear', [
  tube('nose leg', [[NW.f - 0.02, 0, -0.12], [NW.f, 0, GZ + NW.r + 0.04]], 0.013, { role: 'gear', paint: 'carbon', sides: 8 }),
  tube('nose oleo', [[NW.f, 0, GZ + NW.r + 0.05], [NW.f, 0, GZ + NW.r + 0.015]], 0.009, { role: 'gear', paint: 'metal', sides: 8 }),
  tube('nose fork', [[NW.f, -NW.hw - 0.008, GZ + NW.r + 0.02], [NW.f, -NW.hw - 0.008, GZ + NW.r], [NW.f, NW.hw + 0.008, GZ + NW.r], [NW.f, NW.hw + 0.008, GZ + NW.r + 0.02]], 0.006, { role: 'gear', paint: 'metal', sides: 6 }),
  tube('nose fork crown', [[NW.f, -NW.hw - 0.008, GZ + NW.r + 0.02], [NW.f, NW.hw + 0.008, GZ + NW.r + 0.02]], 0.007, { role: 'gear', paint: 'carbon', sides: 6 }),
  wheel('nose tundra tyre', [NW.f, 0, GZ + NW.r], NW.r, NW.hw, 16),
  tube('taxi lamp', [[NW.f + 0.012, 0, GZ + NW.r + 0.06], [NW.f + 0.024, 0, GZ + NW.r + 0.06]], 0.008, { role: 'nacelle', paint: 'strobe', sh: 1, sides: 8, caps: 1 }),
], FINE);

// ── The tail: upswept, a T-tail on a big fin, ventral strakes ───────────────────
const FN = [
  { g: 0.13, le: -0.55, te: -0.9, h: 0, t: 1.15 },
  { g: 0.56, le: -0.8, te: -0.97, h: 0, t: 0.95 },
];
const fin = foil('fin', FN, { axis: 'g', role: 'fin', paint: 'hull', nx: 11 });
const rudder = ctrlOn('rudder', FN[0], FN[1], 0.12, 0.92, 0.34, { axis: 'g', sh: 0.7 });
const TP = [
  { g: 0, le: -0.79, te: -0.965, h: 0.562, t: 0.95 },
  { g: 0.4, le: -0.86, te: -0.98, h: 0.566, t: 0.78 },
];
const tailplane = foil('tailplane', TP, { role: 'stab', paint: 'hull', nx: 9, bands: [{ x0: 0, x1: 0.08, paint: 'boot' }] });
const elevators = ctrlOn('elevator', TP[0], TP[1], 0.06, 0.96, 0.38);
const tail = [
  // The bullet where fin meets tailplane, with the beacon on top.
  group('tail bullet', [pod('bullet', 0, 0, [[-0.75, 0.004], [-0.77, 0.014], [-0.81, 0.02], [-0.92, 0.02], [-0.97, 0.012], [-0.99, 0.003]], { sides: 12, paint: 'trim' })], { xf: { t: [0, 0, 0.562] }, ...FINE }),
  { kind: 'drum', name: 'fin beacon', f: -0.86, r: 0.008, n: 10, z: [0.58, 0.592], role: 'nacelle', paint: 'beacon', sh: { base: 0.9 }, top: { sh: 1 }, ...FINE },
  // The dorsal fillet from the turbogenerator to the fin.
  { kind: 'blade', name: 'dorsal fillet', paint: 'hull', role: 'fin', t: 0.008, sh: [0.86, 0.68], ...FINE, outline: [[-0.42, 0.2], [-0.6, 0.27], [-0.6, 0.17], [-0.5, 0.17]] },
  // Ventral strakes under the upswept tail, either side of the ramp.
  mirror('ventral strakes', [{ kind: 'panel', name: 'ventral strake', role: 'fin', sh: 0.62, th: 0.004, paint: 'belly', ...FINE,
    c: P3s([at(-0.6, -55, -0.002), at(-0.78, -50, -0.002), [-0.76, 0.075, 0.02], [-0.64, 0.115, -0.04]]) }]),
  tube('tail cone strobe', [[MULE76_TAIL[0] + 0.01, 0, MULE76_TAIL[2]], [MULE76_TAIL[0] - 0.012, 0, MULE76_TAIL[2]]], 0.006, { role: 'nacelle', paint: 'strobe', sh: 1, sides: 6, caps: 1, ...FINE }),
  mirror('tailplane tip lights', [{ kind: 'drum', name: 'tailplane tip light', f: -0.92, g: 0.402, r: 0.006, n: 8, z: [0.56, 0.572], role: 'nacelle', paint: 'led', sh: { base: 1 }, top: { sh: 1 }, ...FINE }]),
];

// ── The hydrogen turbogenerator and its tanks ───────────────────────────────────
// A small hydrogen turbine driving a generator, in a dorsal nacelle behind the wing: it tops up a
// buffer battery that the eight motors draw from. The fuel rides in two cryogenic tanks along the
// crown either side of its pylon, frosted white, strapped down, with a boil-off vent mast aft.
const TG_H = 0.212;
const turbogen = [
  pod('turbogenerator', 0, TG_H, [[-0.115, 0.022], [-0.125, 0.034], [-0.15, 0.042], [-0.22, 0.045], [-0.32, 0.044], [-0.4, 0.038], [-0.45, 0.028], [-0.47, 0.02]], { sides: 16, paint: 'hull', shade: { base: 0.6, amp: 0.34 } }),
  pod('intake lip', 0, TG_H, [[-0.11, 0.024], [-0.118, 0.026], [-0.13, 0.02]], { sides: 16, paint: 'metal', capFore: { kind: 'flat', sh: 0.15 } }),
  pod('intake throat', 0, TG_H, [[-0.109, 0.016], [-0.112, 0.016]], { sides: 12, paint: 'intake', capFore: { kind: 'flat', sh: 0.1 } }),
  pod('exhaust', 0, TG_H, [[-0.465, 0.021], [-0.49, 0.017]], { sides: 12, paint: 'exhaust', capAft: { kind: 'flat', sh: 0.15 } }),
  { kind: 'blade', name: 'turbogenerator pylon', paint: 'hull', role: 'fin', t: 0.012, sh: [0.8, 0.62], ...FINE, outline: [[-0.13, 0.2], [-0.42, 0.2], [-0.44, 0.16], [-0.12, 0.165]] },
  // Cooling louvres down each flank of the nacelle, and a seam where the cowl opens.
  mirror('turbogenerator louvres', [poly('louvres', range(-0.2, -0.36, 6).flatMap((f) => [
    quad([f + 0.008, 0.044, TG_H + 0.012], [f - 0.008, 0.044, TG_H + 0.012], [f - 0.008, 0.047, TG_H - 0.008], [f + 0.008, 0.047, TG_H - 0.008], { paint: 'seam', sh: 0.35 }),
  ]), FINE)]),
  tube('cowl seam', [[-0.16, 0, TG_H + 0.0455], [-0.39, 0, TG_H + 0.0395]], 0.0022, { role: 'nacelle', paint: 'seam', sides: 4, ...FINE }),
  mirror('hydrogen tanks', [
    group('cryo tank', [pod('cryo tank', 0, 0, [[0.11, 0.004], [0.1, 0.016], [0.08, 0.024], [0.04, 0.027], [-0.12, 0.027], [-0.16, 0.024], [-0.18, 0.016], [-0.19, 0.004]], { sides: 14, paint: 'cryo', shade: { base: 0.62, amp: 0.34 } })],
      { xf: { t: [-0.25, 0.09, 0.19] }, ...FINE }),
    ...[-0.16, -0.25, -0.34].map((f) => group('tank strap', [pod('strap', 0, 0, [[0.006, 0.0285], [-0.006, 0.0285]], { sides: 14, paint: 'carbon' })], { xf: { t: [f, 0.09, 0.19] }, ...FINE })),
    tube('tank saddle', [[-0.13, 0.09, 0.163], [-0.39, 0.09, 0.163]], 0.008, { role: 'nacelle', paint: 'carbon', sides: 5, ...FINE }),
    tube('feed line', [[-0.41, 0.09, 0.19], [-0.43, 0.07, 0.2], [-0.43, 0.04, 0.21]], 0.004, { role: 'gear', paint: 'metal', sides: 5, ...FINE }),
  ]),
  { kind: 'blade', name: 'boil-off vent mast', role: 'fin', paint: 'metal', t: 0.003, sh: [0.8, 0.62], outline: [[-0.5, 0.2], [-0.52, 0.255], [-0.535, 0.255], [-0.535, 0.2]], ...FINE },
].map((p) => ({ ...p, ...(p.kind === 'loft' ? FINE : {}) }));

// ── Sensors, antennas, the satcom dome ──────────────────────────────────────────
// The aircraft flies itself, so the nose is a sensor head: lidar puck on the apex, a smoked chin
// fairing with cameras, pitots, and on the crown a satcom dome.
const sensors = [
  group('lidar puck', [pod('lidar', 0, 0, [[0.026, 0.004], [0.022, 0.016], [0.006, 0.02], [-0.006, 0.02]], { sides: 14, paint: 'carbon', regions: [{ at: [0.022], k: 'all', role: 'glass', tint: [20, 26, 32] }] })],
    { xf: { t: [MULE76_APEX[0] - 0.004, 0, MULE76_APEX[2]] }, ...FINE }),
  group('chin sensor fairing', [pod('chin', 0, 0, [[0.07, 0.006], [0.06, 0.022], [0.035, 0.03], [-0.02, 0.03], [-0.07, 0.014], [-0.09, 0.004]], {
    sides: 14, paint: 'carbon', regions: [{ at: [0.06, 0.035], k: 'all', role: 'glass', tint: [22, 28, 34] }],
  })], { xf: { t: [0.9, 0, -0.142], s: [1, 1.5, 1] }, ...FINE }),
  mirror('pitots and cameras', [
    tube('pitot', [at(0.9, 20, 0), [0.93, 0.1, -0.01], [0.965, 0.1, -0.01]], 0.0032, { role: 'gear', paint: 'metal', sh: 0.85, sides: 5, ...FINE }),
    group('side camera', [pod('camera', 0, 0, [[0.016, 0.003], [0.012, 0.01], [-0.015, 0.011], [-0.022, 0.004]], { sides: 10, paint: 'carbon', regions: [{ at: [0.016], k: 'all', role: 'glass', tint: [18, 22, 26] }] })],
      { xf: { t: [0.88, 0.122, -0.07] }, ...FINE }),
  ]),
  { kind: 'drum', name: 'satcom base', f: 0.47, r: 0.05, n: 16, z: [0.15, 0.158], role: 'nacelle', paint: 'carbon', sh: { base: 0.55, alt: 0.08 }, ...FINE },
  group('satcom dome', [pod('dome', 0, 0, [[0.05, 0.004], [0.04, 0.018], [0.0, 0.024], [-0.04, 0.018], [-0.05, 0.004]], { sides: 16, paint: 'radome' })], { xf: { t: [0.47, 0, 0.16], s: [1, 1, 0.8] }, ...FINE }),
  { kind: 'blade', name: 'VHF blade', role: 'fin', paint: 'carbon', t: 0.003, sh: [0.75, 0.6], outline: [[0.62, 0.14], [0.6, 0.19], [0.585, 0.19], [0.575, 0.14]], ...FINE },
  { kind: 'blade', name: 'datalink blade', role: 'fin', paint: 'carbon', t: 0.003, sh: [0.75, 0.6], outline: [[0.0, -0.125], [-0.01, -0.165], [-0.025, -0.165], [-0.04, -0.125]], ...FINE },
  { kind: 'blade', name: 'ADS-B blade', role: 'fin', paint: 'carbon', t: 0.003, sh: [0.75, 0.6], outline: [[0.6, -0.12], [0.592, -0.152], [0.58, -0.152], [0.57, -0.12]], ...FINE },
  { kind: 'drum', name: 'belly beacon', f: 0.25, r: 0.01, n: 10, z: [-0.142, -0.13], role: 'nacelle', paint: 'beacon', sh: { base: 0.9 }, bottom: { sh: 1 }, ...FINE },
];

// ── The room behind the glass ───────────────────────────────────────────────────
// Seen through the windscreen from outside: two seats, the display deck, the glareshield. The seated
// cockpit is interior-mule-2076.js.
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
const FH = MULE76_INSIDE.floorH, SG = MULE76_INSIDE.seatG;
const room = [];
for (const g of [SG, -SG]) {
  room.push(poly('seat', [
    ...slab([0.6, g, FH + 0.045], [0.06, 0.06, 0.012], 4, { paint: 'seat' }),
    ...slab([0.565, g, FH + 0.095], [0.012, 0.06, 0.09], -14, { paint: 'seat' }),
  ], FINE));
}
room.push(poly('flight deck floor', [quad([0.75, -0.12, FH], [0.75, 0.12, FH], [0.5, 0.12, FH], [0.5, -0.12, FH], { paint: 'interior', sh: 0.45 })], FINE));
room.push(poly('display deck', [...slab([0.68, 0, FH + 0.09], [0.012, 0.22, 0.05], -30, { paint: 'interior' }), ...slab([0.674, 0, FH + 0.093], [0.004, 0.2, 0.04], -30, { paint: 'screen' })], FINE));
room.push(poly('glareshield', slab([0.68, 0, FH + 0.12], [0.03, 0.22, 0.008], 0, { paint: 'interior' }), FINE));
room.push(poly('pedestal', slab([0.64, 0, FH + 0.03], [0.07, 0.04, 0.06], 0, { paint: 'interior' }), FINE));
room.push(poly('bulkhead', [quad([MULE76_INSIDE.bulkheadF, -0.14, FH], [MULE76_INSIDE.bulkheadF, 0.14, FH], [MULE76_INSIDE.bulkheadF, 0.14, 0.15], [MULE76_INSIDE.bulkheadF, -0.14, 0.15], { paint: 'interior', sh: 0.5 })], FINE));

// ── The coarse body, for range ──────────────────────────────────────────────────
const coarse = [
  loft('fuselage (far)', 12, ST.filter((_, i) => i % 2 === 0 || i === ST.length - 1), {
    ...COARSE, paint: 'hull', capFore: { kind: 'apex', at: MULE76_APEX, paint: 'carbon' }, capAft: { kind: 'apex', at: MULE76_TAIL },
    regions: [{ at: [0.86, 0.76], k: [1, 2, 3, 4, 5], role: 'glass', tint: GLASS }],
  }),
  mirror('motors (far)', MOTOR_G.map((g) => group('motor (far)', [pod('motor (far)', 0, 0, [[0.53, 0.008], [0.5, 0.032], [0.3, 0.032], [0.12, 0.008]], { sides: 6, paint: 'hull' })], { xf: { t: [0, g, MH] }, ...COARSE }))),
  mirror('gear (far)', [
    tube('main leg (far)', [[0.06, 0.15, -0.12], [MW.f, MW.g - MW.hw, GZ + MW.r]], 0.012, { role: 'gear', paint: 'carbon', sides: 4, ...COARSE }),
    { ...wheel('main tyre (far)', [MW.f, MW.g, GZ + MW.r], MW.r, MW.hw, 8), ...COARSE },
    faired('lift strut (far)', [[0.12, 0.14, -0.07], [0.14, 0.6, 0.175]], 0.05, 0.011, { paint: 'hull', ...COARSE }),
  ]),
  { ...wheel('nose tyre (far)', [NW.f, 0, GZ + NW.r], NW.r, NW.hw, 8), ...COARSE },
  tube('nose leg (far)', [[NW.f - 0.02, 0, -0.12], [NW.f, 0, GZ + NW.r]], 0.012, { role: 'gear', paint: 'carbon', sides: 4, ...COARSE }),
  pod('turbogenerator (far)', 0, TG_H, [[-0.11, 0.024], [-0.15, 0.042], [-0.4, 0.038], [-0.48, 0.018]], { sides: 6, paint: 'hull' }),
  mirror('cryo tanks (far)', [group('cryo tank (far)', [pod('tank', 0, 0, [[0.11, 0.006], [0.07, 0.026], [-0.15, 0.026], [-0.19, 0.006]], { sides: 6, paint: 'cryo' })], { xf: { t: [-0.25, 0.09, 0.19] }, ...COARSE })]),
].map((p) => (p.kind === 'loft' && !p.maxDetail ? { ...p, ...COARSE } : p));

// ── Rotors and lamps ────────────────────────────────────────────────────────────
// Eight props. Neighbours turn opposite ways, and the pattern mirrors across the centreline, so the
// wash is symmetric and no prop's tip vortex fights its neighbour's.
const rotors = [];
for (const s of [1, -1]) MOTOR_G.forEach((g, i) => {
  const r = { at: [PROP_F, R(s * g), MH], plane: 'fore', r: PROP_R, blades: 5, lead: 0.85, spinMul: 1.3, phase: R(i * 0.37 + (s > 0 ? 0 : 0.2)) };
  if ((i % 2 === 0) === (s > 0)) r.dir = -1;
  rotors.push(r);
});
const lamps = [
  { at: [0.35, -1.15, 0.2], n: [0.3, -1, 0], rgb: '255,55,55', kind: 'steady' },
  { at: [0.35, 1.15, 0.2], n: [0.3, 1, 0], rgb: '60,255,95', kind: 'steady' },
  { at: [-0.08, -1.206, 0.3], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [-0.08, 1.206, 0.3], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [MULE76_TAIL[0] - 0.015, 0, MULE76_TAIL[2]], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [-0.86, 0, 0.596], n: [0, 0, 1], rgb: '255,90,70', kind: 'beacon' },
  { at: [0.25, 0, -0.146], n: [0, 0, -1], rgb: '255,90,70', kind: 'beacon' },
];

const doc = {
  id: 'prop_2076',
  kind: 'mesh',
  params: {
    name: 'Mule 2076',
    note: 'CONCEPT, generated by scripts/shapes/concepts/mule-2076.mjs (edit that, not this). The Mule fifty years on, after the Electra.aero EL9 and the pilotless Caravans: the Twin Otter\'s strut-braced high wing lined with eight electric motors and five-blade props blowing full-span double-slotted flaps, vortex generators and raked winglets; a boxy freighter hull with a wraparound windscreen, eyebrow windows, crew doors, a side cargo door and a rear ramp under an upswept tail; a T-tail; a hydrogen turbogenerator in a dorsal nacelle with two cryogenic tanks on the crown beside it; a lidar nose, chin sensors and a satcom dome; tundra tyres on sponsons. A variant of the prop mesh, worn as the Mule 2076 factory edition.',
    groundPitch: 0,
    navLamps: null,
    lamps,
    rotors,
    finish: 'gloss',
    paints: {
      hull: { rgb: [232, 230, 222], livery: 'base' },
      trim: { rgb: [196, 58, 38], livery: 'trim' },
      spinner: { rgb: [196, 58, 38], livery: 'trim' },
      belly: { rgb: [120, 126, 130], livery: 'fixed', mat: 'satin' },
      glare: { rgb: [30, 32, 34], livery: 'fixed', mat: 'matte' },
      boot: { rgb: [44, 46, 48], livery: 'fixed', mat: 'matte' },
      frame: { rgb: [28, 30, 32], livery: 'fixed', mat: 'gloss' },
      seam: { rgb: [70, 74, 76], livery: 'fixed', mat: 'matte' },
      carbon: { rgb: [38, 42, 46], livery: 'fixed', mat: 'satin' },
      metal: { rgb: [156, 160, 166], livery: 'fixed', mat: 'bare' },
      intake: { rgb: [26, 28, 30], livery: 'fixed', mat: 'matte' },
      exhaust: { rgb: [92, 80, 70], livery: 'fixed', mat: 'bare' },
      radome: { rgb: [210, 212, 208], livery: 'fixed', mat: 'satin' },
      cryo: { rgb: [236, 240, 244], livery: 'fixed', mat: 'satin' },
      led: { rgb: [255, 186, 120], livery: 'fixed', mat: 'matte' },
      navR: { rgb: [210, 210, 210], livery: 'fixed', mat: 'gloss' },
      beacon: { rgb: [235, 70, 56], livery: 'fixed', mat: 'gloss' },
      strobe: { rgb: [240, 244, 248], livery: 'fixed', mat: 'gloss' },
      interior: { rgb: [40, 44, 46], livery: 'fixed', mat: 'matte' },
      seat: { rgb: [96, 80, 62], livery: 'fixed', mat: 'satin' },
      screen: { rgb: [60, 180, 190], livery: 'fixed', mat: 'gloss' },
    },
    parts: [
      fuselage, windscreen, sideGlass, ...frames, ...doors, ...cargoDoor, ...trim,
      wing, flapsIn, flapsOut, ailerons, wingFairing, vgs, tracks, slot, winglets,
      motors, propDiscs, struts, mainGear, noseGear,
      fin, rudder, tailplane, elevators, ...tail, ...turbogen, ...sensors, ...room,
      ...coarse,
    ],
  },
};

const v = validateMesh(doc.params, doc.id);
if (v.errors.length) { console.log('ERRORS', v.errors.slice(0, 12)); process.exit(1); }
if (v.warnings?.length) console.log('warnings', v.warnings.slice(0, 8));
const n1 = compileMesh(doc.params, { detail: 1 }).faces.length, n0 = compileMesh(doc.params, { detail: 0 }).faces.length;
writeFileSync(new URL('../../../content/vehicle_models/mesh_prop_2076.json', import.meta.url), formatMesh(doc));
console.log('mesh_prop_2076.json:', n1, 'faces near,', n0, 'far');
