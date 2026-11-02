// The REAPER 2076 concept: writes content/vehicle_models/mesh_gunship_2076.json.
//
//   node scripts/shapes/concepts/reaper-2076.mjs
//   then: npm run vehicles:bake
//
// The Reaper fifty years on. The ancestor is the A-10 Thunderbolt II (the stock mesh); the bridge is
// the Boeing MQ-28 Ghost Bat, the loyal wingman that flies beside a crewed aircraft and takes the
// risks it is told to. The 2076 aircraft is still the gun with a plane round it: a seven-barrel
// rotary cannon hangs in the open under a chined nose and runs back into the belly to a drum the size
// of a car, and everything else is armour, engines high out of the dust, and a straight thick wing
// that can take hits. It keeps the A-10's bubble on an armoured tub, its gear standing half out of
// leading-edge pods, its turbofans high on the rear fuselage between twin fins (now canted out), and
// stores on pylons. And it carries two uncrewed wingmen after the Ghost Bat, docked conformal on the
// top of the outer wing panels, which lift off and fly in formation off each wingtip while the
// weapons are armed (the `wingmen` channel; see the wingmen below).
//
// A variant of the gunship mesh (mesh_gunship.json `variants`, written by fw-meshes/reaper.mjs), worn
// as the REAPER 2076 factory edition. Same frame and scale as the stock body: the gun's muzzles at
// f 1.0 and h -0.064, the tail cone's apex at -1.08, the wheels touching at h -0.279 where the stock
// wheels do, so she sits at the stock `groundPitch` and the flight view frames her the same way.
//
// ⚠ THIS OVERWRITES THE JSON. Edit this file, not the mesh in the Modelshop.
//
// ⚠ THE GUN'S BARRELS ARE THE ONLY FACES PAINTED `gun`. The renderer finds the muzzles as the
// forward-most `gun` faces each side of the centreline (windshield.js gunMuzzles), so a clamp, a
// shroud or a wingman painted `gun` would move where the tracers start.
//
// Two bodies in one file. Everything fine is `minDetail: 1`; a coarse body with `maxDetail: 0` stands
// in at range. The wing and tail come from lib.mjs's `foil`, which carries its own far body.
//
// Frame: f fore, g right, h up. Angles on a section are lib.mjs's: 0 = right waterline, +90 = crown.
import { writeFileSync } from 'node:fs';
import { R, P3, loft, pod, foil, ctrlOn, tube, mirror, group, poly as rawPoly, quad, cone, wheel, faired, DEG, foilPt, lerpSt } from '../fw-meshes/lib.mjs';
const { formatMesh, validateMesh, compileMesh } = await import('../../../client/shared/vehicle-mesh.js');
const { RP_STATIONS, RP_APEX_FORE, RP_APEX_AFT, RP_GLASS, RP_CANOPY, RP_ENGINES, RP_GUN, RP_WINGMEN, rpPoint } = await import('../../../client/shared/cabin-reaper-2076.js');

const FINE = { minDetail: 1 }, COARSE = { maxDetail: 0 };
// Every poly face needs a role; trim and fittings are 'nacelle' unless they say otherwise.
const poly = (name, faces, extra) => rawPoly(name, faces.map((f) => ({ role: 'nacelle', ...f })), extra);
const GLASS = [52, 78, 92];
const lerp = (a, b, t) => a + (b - a) * t;
const range = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));
const at = (f, a, o = 0) => rpPoint(f, a, o);
const L = (a) => 180 - a;   // the left side's angle for a right-side one

// A curved patch of skin as a grid of quads, `o` proud of the hull. `fs` runs fore to aft.
function patch(fs, as, extra, o = 0.0022) {
  const out = [];
  for (let i = 0; i < fs.length - 1; i++) for (let j = 0; j < as.length - 1; j++) {
    out.push(quad(at(fs[i + 1], as[j], o), at(fs[i], as[j], o), at(fs[i], as[j + 1], o), at(fs[i + 1], as[j + 1], o), extra));
  }
  return out;
}
const alongF = (fs, a, o = 0.004) => fs.map((f) => at(f, a, o));
const roundF = (f, as, o = 0.004) => as.map((a) => at(f, a, o));
// A box as six faces, centred at c with size [f, g, h], optionally yawed (degrees) about h.
function boxAt(c, [sf, sg, sh], extra = {}, yaw = 0) {
  const cy = Math.cos(yaw * DEG), sy = Math.sin(yaw * DEG);
  const P = (df, dg, dh) => P3([c[0] + df * cy - dg * sy, c[1] + df * sy + dg * cy, c[2] + dh]);
  const f = sf / 2, g = sg / 2, h = sh / 2;
  const v = [P(-f, -g, -h), P(f, -g, -h), P(f, g, -h), P(-f, g, -h), P(-f, -g, h), P(f, -g, h), P(f, g, h), P(-f, g, h)];
  return [
    quad(v[4], v[5], v[6], v[7], { sh: 0.86, ...extra }), quad(v[3], v[2], v[1], v[0], { sh: 0.4, ...extra }),
    quad(v[1], v[2], v[6], v[5], { sh: 0.74, ...extra }), quad(v[0], v[4], v[7], v[3], { sh: 0.55, ...extra }),
    quad(v[0], v[1], v[5], v[4], { sh: 0.62, ...extra }), quad(v[3], v[7], v[6], v[2], { sh: 0.66, ...extra }),
  ];
}
// A box tilted about g (pitch, degrees, nose up positive) at c: the seat back, the panel.
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
const D = (name, f, g, r, z0, z1, paint, extra = {}) => ({ kind: 'drum', name, f: R(f), ...(g ? { g: R(g) } : {}), r: R(r), n: extra.n ?? 10, z: [R(z0), R(z1)], role: extra.role || 'nacelle', paint, sh: extra.sh || { base: 0.62, alt: 0.1 }, ...(extra.top ? { top: extra.top } : {}), ...(extra.bottom ? { bottom: extra.bottom } : {}), ...(extra.fine === false ? {} : FINE) });
// A ring of `n` points round the f axis at (f, g, h), radius r: a clamp, a lip, a seam.
const ringF = (f, g, h, r, n = 12) => Array.from({ length: n + 1 }, (_, k) => { const t = k / n * 2 * Math.PI; return [f, g + Math.cos(t) * r, h + Math.sin(t) * r]; });
// A disc facing fore (normal +f) at (f, g, h): a lens, a fan face, a window.
const discF = (f, g, h, r, n, extra) => ({ p: Array.from({ length: n }, (_, k) => { const t = -k / n * 2 * Math.PI; return [f, g + Math.cos(t) * r, h + Math.sin(t) * r]; }), ...extra });

// ── The fuselage ────────────────────────────────────────────────────────────────
// Stated once in client/shared/cabin-reaper-2076.js: chined nose, bubble on an armoured tub, slab body.
const S = RP_STATIONS;
const BELLY_K = [19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29];
const fuselage = loft('fuselage', 32, S, {
  ...FINE, paint: 'hull',
  note: 'The shell. Glass, frames, the armour, the gun trough and the seams are separate parts laid a hair proud of it.',
  regions: [{ at: S.map((s) => s.f), k: BELLY_K, paint: 'belly' }],
  capFore: { kind: 'apex', at: RP_APEX_FORE, paint: 'glare' },
  capAft: { kind: 'apex', at: RP_APEX_AFT, paint: 'trim' },
  shade: { base: 0.6, amp: 0.34 },
});
const fuselageFar = loft('fuselage (far)', 12, S.filter((s, i) => i % 2 === 0 || i === S.length - 1), {
  ...COARSE, paint: 'hull', capFore: { kind: 'apex', at: RP_APEX_FORE, paint: 'glare' }, capAft: { kind: 'apex', at: RP_APEX_AFT, paint: 'trim' },
});

// ── The canopy ──────────────────────────────────────────────────────────────────
const G = RP_GLASS;
const WS_F = range(G.windscreen.f[1], G.windscreen.f[0], 4);
const BB_F = range(G.bubble.f[1], G.bubble.f[0], 10);
const windscreen = poly('windscreen', patch(WS_F, range(G.windscreen.a[0], G.windscreen.a[1], 20), { role: 'glass', tint: GLASS }, 0.001), FINE);
const bubble = poly('canopy bubble', patch(BB_F, range(G.bubble.a[0], G.bubble.a[1], 24), { role: 'glass', tint: GLASS }, 0.001), FINE);
const glassFar = poly('glass (far)', [
  ...patch([G.windscreen.f[1], G.windscreen.f[0]], range(G.windscreen.a[0], G.windscreen.a[1], 3), { role: 'glass', tint: GLASS }, 0.003),
  ...patch([G.bubble.f[1], 0.45, G.bubble.f[0]], range(G.bubble.a[0], G.bubble.a[1], 4), { role: 'glass', tint: GLASS }, 0.003),
], COARSE);

// Frames: the windscreen's heavy armoured bow and posts, the canopy bow, the sill rails, the aft
// hoop, a black seal along every edge, and the canopy's hinge and jettison line at the back.
const FR = (name, pts, r = 0.004) => tube(name, pts, r, { role: 'nacelle', paint: 'frame', sh: 0.5, sides: 6, ...FINE });
const SEAL = (name, pts) => tube(name, pts, 0.0018, { role: 'nacelle', paint: 'rubber', sh: 0.35, sides: 4, ...FINE });
const frames = [
  FR('windscreen arch', roundF(G.windscreen.f[1] + 0.002, range(G.windscreen.a[0] - 4, G.windscreen.a[1] + 4, 20)), 0.0055),
  FR('canopy bow', roundF(RP_CANOPY.bowF, range(G.bubble.a[0] - 3, G.bubble.a[1] + 3, 24)), 0.0065),
  FR('aft hoop', roundF(RP_CANOPY.hoopF, range(G.bubble.a[0] - 3, G.bubble.a[1] + 3, 24)), 0.0055),
  SEAL('windscreen seal', roundF(G.windscreen.f[1] - 0.004, range(G.windscreen.a[0], G.windscreen.a[1], 20), 0.0025)),
  SEAL('bubble fore seal', roundF(G.bubble.f[1] - 0.004, range(G.bubble.a[0], G.bubble.a[1], 24), 0.0025)),
  ...G.windscreen.posts.map((a) => FR('windscreen post', alongF(WS_F, a, 0.0035), 0.0045)),
  ...[0, 1].flatMap((s) => {
    const A = (a) => (s ? L(a) : a), side = s ? 'left' : 'right';
    return [
      FR('windscreen sill (' + side + ')', alongF(WS_F, A(G.windscreen.a[0] - 1.5)), 0.0045),
      FR('canopy rail (' + side + ')', alongF(range(RP_CANOPY.bowF, RP_CANOPY.hoopF - 0.01, 12), A(RP_CANOPY.sillA)), 0.005),
      SEAL('rail seal (' + side + ')', alongF(BB_F, A(G.bubble.a[0] + 1), 0.0025)),
      // The canopy's external jettison handle, behind a striped door low on the rail.
      poly('jettison door (' + side + ')', patch([0.37, 0.345], s ? [L(14), L(6)] : [6, 14], { paint: 'hazard', sh: 0.65 }, 0.003), FINE),
    ];
  }),
  // The hinge at the back of the bubble: two lugs and the actuator fairing on the spine.
  poly('canopy hinge', [...boxAt(at(0.31, 90, 0.004), [0.024, 0.03, 0.01], { paint: 'frame' })], FINE),
  ...[1, -1].map((s) => tube('canopy hinge lug', [at(0.322, s > 0 ? 70 : 110, 0.003), at(0.304, s > 0 ? 74 : 106, 0.009)], 0.003, { role: 'nacelle', paint: 'metal', sides: 5, ...FINE })),
  // A rear-view mirror bump and a blade on top of the bow, as an A-10's has.
  tube('bow mirror', [at(RP_CANOPY.bowF, 90, 0.004), at(RP_CANOPY.bowF - 0.006, 90, 0.012)], 0.0035, { role: 'nacelle', paint: 'frame', sides: 6, caps: 1, ...FINE }),
];

// ── The armoured tub ────────────────────────────────────────────────────────────
// The titanium bathtub shows on the outside as bolted plates down each flank of the cockpit, under the
// rail, from the windscreen to the aft hoop: four plates a side, each ringed with bolts.
const TUB_F = [0.665, 0.58, 0.5, 0.415, 0.33];
const armour = [];
const bolts = [];
for (const s of [0, 1]) {
  const A = (a) => (s ? L(a) : a);
  for (let i = 0; i < TUB_F.length - 1; i++) {
    const f0 = TUB_F[i] - 0.004, f1 = TUB_F[i + 1] + 0.004;
    const as = s ? [L(20), L(-24)] : [-24, 20];
    armour.push(...patch(range(f0, f1, 3), range(as[0], as[1], 5), { paint: 'armour', sh: 0.62 }, 0.0034));
    for (const f of range(f0 - 0.006, f1 + 0.006, 5)) for (const a of [-20, 16]) bolts.push(...boxAt(at(f, A(a), 0.0044), [0.003, 0.003, 0.003], { paint: 'metal' }));
    for (const a of range(-16, 12, 3)) for (const f of [f0 - 0.005, f1 + 0.005]) bolts.push(...boxAt(at(f, A(a), 0.0044), [0.003, 0.003, 0.003], { paint: 'metal' }));
  }
}
const tub = [poly('tub armour', armour, FINE), poly('tub bolts', bolts, FINE)];

// ── The room behind the glass, as seen from outside ─────────────────────────────
// The cockpit's big shapes, where interior-reaper-2076.js puts them (its metres over 7.82 a unit, the
// eye at f 0.47, h 0.172): the ejection seat, the swept dash with its lit band of glass, the two side
// consoles with the throttles and the stick, and the tub floor.
const interior = [
  poly('seat pan', slab([0.43, 0, 0.098], [0.05, 0.062, 0.018], 6, { paint: 'seat' }), FINE),
  poly('seat back', slab([0.4, 0, 0.15], [0.016, 0.064, 0.1], -14, { paint: 'seat' }), FINE),
  poly('headbox', slab([0.392, 0, 0.214], [0.022, 0.05, 0.036], -14, { paint: 'seat' }), FINE),
  poly('headbox stripes', slab([0.381, 0, 0.214], [0.002, 0.03, 0.024], -14, { paint: 'hazard' }), FINE),
  poly('dash', slab([0.565, 0, 0.122], [0.05, 0.15, 0.03], 6, { paint: 'interior' }), FINE),
  poly('dash band', slab([0.542, 0, 0.13], [0.003, 0.15, 0.034], -24, { paint: 'screen' }), FINE),
  ...[1, -1].map((s) => poly('console', slab([0.46, s * 0.07, 0.085], [0.13, 0.024, 0.04], 0, { paint: 'interior' }), FINE)),
  tube('stick', [[0.475, 0.07, 0.106], [0.48, 0.07, 0.13]], 0.0035, { role: 'nacelle', paint: 'interior', sides: 5, ...FINE }),
  ...[0.007, -0.007].map((dg) => tube('throttle', [[0.47, -0.07 + dg, 0.106], [0.478, -0.07 + dg, 0.126]], 0.0026, { role: 'nacelle', paint: 'metal', sides: 5, ...FINE })),
];

// ── The nose: chines, sensors, the refuelling receptacle ────────────────────────
const CHINE_F = range(0.955, 0.6, 8);
const chineW = (f) => 0.012 * Math.sin(Math.PI * Math.min(1, (0.96 - f) / 0.2)) ** 0.5 * (f < 0.75 ? lerp(0.5, 1, (f - 0.6) / 0.15) : 1);
const chines = mirror('chines', [poly('chine', CHINE_F.slice(0, -1).flatMap((f, i) => {
  const f2 = CHINE_F[i + 1], a = at(f, 0, 0), b = at(f2, 0, 0), w1 = chineW(f), w2 = chineW(f2);
  const A = [a[0], a[1] + w1, a[2]], B = [b[0], b[1] + w2, b[2]];
  return [
    quad([a[0], a[1], a[2] + 0.0012], [b[0], b[1], b[2] + 0.0012], B, A, { paint: 'hull', sh: 0.8 }),
    quad(A, B, [b[0], b[1], b[2] - 0.0012], [a[0], a[1], a[2] - 0.0012], { paint: 'belly', sh: 0.45 }),
  ];
}), FINE)]);
const nose = [
  // The anti-glare panel ahead of the windscreen.
  poly('anti-glare', patch(range(0.94, 0.668, 8), range(38, 142, 8), { paint: 'glare', sh: 0.5 }, 0.0016), FINE),
  // The laser spot tracker and its window at the nose's tip, a dark facet under the apex.
  poly('tracker window', patch([0.962, 0.944], range(-60, -120, 4), { role: 'glass', tint: [20, 26, 30] }, 0.0016), FINE),
  // The refuelling receptacle on the nose top, with its lit lead-in lines, as an A-10's has.
  poly('refuel door', patch([0.87, 0.83], [80, 100], { paint: 'glare', sh: 0.4 }, 0.0026), FINE),
  D('refuel receptacle', 0.85, 0, 0.008, at(0.85, 90)[2] + 0.001, at(0.85, 90)[2] + 0.0045, 'intake', { n: 10, top: { sh: 0.2 } }),
  ...[1, -1].map((s) => tube('refuel lead-in', [at(0.82, 90 - s * 6, 0.003), at(0.7, 90 - s * 3, 0.003)], 0.0012, { role: 'nacelle', paint: 'led', sh: 1, sides: 3, ...FINE })),
  // The EO/IR ball under the nose, left of the gun: targeting and night vision, in a turret.
  group('targeting turret', [
    pod('turret base', 0, 0, [[0.016, 0.004], [0.012, 0.018], [-0.012, 0.018], [-0.018, 0.006]], { sides: 12, paint: 'glare' }),
    pod('turret ball', 0, -0.016, [[0.016, 0.004], [0.011, 0.014], [0, 0.016], [-0.011, 0.014], [-0.016, 0.004]], { sides: 12, paint: 'carbon', regions: [{ at: [0.016, 0.011], k: 'all', role: 'glass', tint: [30, 40, 60] }] }),
  ], { xf: { t: [0.79, -0.058, at(0.79, -120)[2] - 0.004] }, ...FINE }),
  // Pitot booms either side of the nose, and the angle-of-attack vanes.
  mirror('pitots', [
    tube('pitot', [at(0.9, 20, 0), [0.97, 0.05, 0.022]], 0.0022, { role: 'strut', paint: 'metal', sides: 5, ...FINE }),
    tube('pitot tip', [[0.97, 0.05, 0.022], [0.985, 0.051, 0.022]], 0.0012, { role: 'strut', paint: 'metal', sides: 4, ...FINE }),
    poly('AoA vane', [quad(at(0.8, 30, 0.002), at(0.78, 30, 0.002), at(0.785, 30, 0.012), at(0.8, 30, 0.012), { paint: 'metal', sh: 0.75 })], FINE),
  ]),
  // Distributed-aperture sensor windows round the nose: dark diamonds, one per quarter.
  poly('aperture windows', [[0.86, 40], [0.86, 140], [0.86, -38], [0.86, -142]].map(([f, a]) => quad(at(f + 0.012, a, 0.0026), at(f, a - 7, 0.0026), at(f - 0.012, a, 0.0026), at(f, a + 7, 0.0026), { role: 'glass', tint: [18, 22, 28] })), FINE),
  // Panel seams across the nose.
  ...[0.9, 0.8, 0.7].map((f) => poly('nose seam', patch([f + 0.0015, f - 0.0015], range(-150, 150, 30).filter((a) => a > -150), { paint: 'seam', sh: 0.4 }, 0.0014), FINE)),
  // The avionics bay doors on each side of the nose, their seams and their latches.
  mirror('avionics doors', [
    tube('avionics door seam', [...alongF([0.86, 0.72], 26, 0.0022), ...roundF(0.72, range(26, -6, 4), 0.0022).slice(1), ...alongF([0.72, 0.86], -6, 0.0022).slice(1), ...roundF(0.86, range(-6, 26, 4), 0.0022).slice(1)], 0.0011, { role: 'nacelle', paint: 'seam', sides: 3, ...FINE }),
    poly('avionics latches', [0.84, 0.79, 0.74].flatMap((f) => boxAt(at(f, 22, 0.003), [0.008, 0.003, 0.003], { paint: 'metal' })), FINE),
  ]),
];

// ── The gun ─────────────────────────────────────────────────────────────────────
// Seven barrels round a turning cluster, longer than a car, in the open under the chin; a muzzle
// clamp and a mid clamp hold them; behind them the breech housing with cooling slots runs into a
// trough in the belly; a gas diverter either side of the chin; and the feed chute runs back along
// the belly to the drum under the cockpit, whose fairing carries a lit rounds strip.
const GH = RP_GUN.h, GR = RP_GUN.ring, BR = RP_GUN.barrel;
const barrelAt = (i, f) => { const a = i / RP_GUN.n * 2 * Math.PI + 0.2; return [f, Math.cos(a) * GR, GH + Math.sin(a) * GR]; };
const gun = group('rotary cannon', [
  // The barrels: the ONLY faces painted `gun` (see the head of this file).
  ...range(0, 6, 6).map((i) => tube('barrel', [barrelAt(i, 0.82), barrelAt(i, 1.0)], BR, { role: 'gun', paint: 'gun', sides: 6 })),
  // Bore ends: a dark disc in each muzzle (not `gun`: they sit at the muzzle face, a hair back).
  poly('bores', range(0, 6, 6).map((i) => discF(0.9995, barrelAt(i, 1)[1], barrelAt(i, 1)[2], BR * 0.6, 6, { paint: 'intake', sh: 0.1 }))),
  tube('spindle', [[0.83, 0, GH], [0.995, 0, GH]], 0.0055, { role: 'nacelle', paint: 'gunmetal', sides: 8 }),
  tube('muzzle clamp', [[0.968, 0, GH], [0.982, 0, GH]], GR + BR + 0.0035, { role: 'nacelle', paint: 'gunmetal', sides: 14, caps: 1 }),
  tube('mid clamp', [[0.892, 0, GH], [0.902, 0, GH]], GR + BR + 0.003, { role: 'nacelle', paint: 'gunmetal', sides: 14, caps: 1 }),
  tube('muzzle clamp band', [[0.973, 0, GH], [0.977, 0, GH]], GR + BR + 0.0045, { role: 'nacelle', paint: 'hazard', sides: 14 }),
  // The breech housing: a heavy can behind the barrels, ribbed, into the belly.
  pod('breech housing', 0, GH, [[0.835, 0.026], [0.825, RP_GUN.housing], [0.72, RP_GUN.housing], [0.62, RP_GUN.housing * 1.04, 0.006], [0.54, RP_GUN.housing * 1.02, 0.02]], { sides: 16, paint: 'gunmetal', capFore: { kind: 'flat', paint: 'gunmetal', sh: 0.5 }, shade: { base: 0.58, amp: 0.3 } }),
  ...range(0.81, 0.74, 3).map((f) => tube('housing rib', [[f, 0, GH], [f - 0.006, 0, GH]], RP_GUN.housing + 0.0035, { role: 'nacelle', paint: 'gunmetal', sides: 16 })),
  // Cooling slots round the housing's fore half: dark slots, each with a lip.
  poly('housing slots', range(0, 330, 11).flatMap((d) => {
    const a = d * DEG, c = Math.cos(a), s = Math.sin(a), r = RP_GUN.housing + 0.0008;
    const P = (f, dr, dt) => [f, (r + dr) * Math.cos(a + dt), GH + (r + dr) * Math.sin(a + dt)];
    return [quad(P(0.735, 0, -0.07), P(0.735, 0, 0.07), P(0.715, 0, 0.07), P(0.715, 0, -0.07), { paint: 'intake', sh: 0.15 }),
      quad(P(0.736, 0.0025, -0.08), P(0.736, 0.0025, 0.08), P(0.734, 0, 0.08), P(0.734, 0, -0.08), { paint: 'metal', sh: 0.8 * (0.6 + 0.4 * Math.max(0, s)) + 0 * c })];
  })),
], FINE);
// The gun's trough in the belly: dark side walls either side of the housing where it runs in.
const gunTrough = mirror('gun trough', [poly('trough wall', range(0.72, 0.54, 6).slice(0, -1).map((f, i, a) => {
  const f2 = i + 1 < a.length ? a[i + 1] : 0.54;
  const top = (ff) => at(ff, -62, 0.001), w = RP_GUN.housing + 0.006;
  return quad([f, w, GH + 0.004], [f2, w, GH + 0.01], top(f2), top(f), { paint: 'intake', sh: 0.3 });
}), FINE)]);
// The gas diverters: louvred boxes either side of the chin that throw the gun's smoke clear of the
// engine intakes.
const gasDiverters = mirror('gas diverters', [
  poly('gas diverter', boxAt([0.86, 0.044, GH + 0.022], [0.06, 0.012, 0.018], { paint: 'gunmetal' }), FINE),
  poly('gas diverter louvres', range(0.885, 0.84, 5).map((f) => quad([f, 0.0505, GH + 0.016], [f - 0.006, 0.0505, GH + 0.016], [f - 0.006, 0.0505, GH + 0.028], [f, 0.0505, GH + 0.028], { paint: 'intake', sh: 0.2 })), FINE),
]);
// The drum: a deep fairing under the cockpit with the magazine's rounds strip lit along each side,
// two access hatches, and the feed and return chutes forward along the belly to the breech.
const DRUM_Z = at(0.3, -90)[2];
const drum = [
  group('drum fairing', [pod('drum fairing', 0, 0, [[0.5, 0.004, 0, 0.01], [0.46, 0.016, 0, 0.05], [0.4, 0.024, 0, 0.068], [0.2, 0.026, 0, 0.07], [0.12, 0.018, 0, 0.056], [0.06, 0.004, 0, 0.012]], {
    sides: 14, paint: 'belly', shade: { base: 0.55, amp: 0.3 } })], { xf: { t: [0, 0, DRUM_Z + 0.004] }, ...FINE }),
  mirror('rounds strip', [tube('rounds strip', [[0.42, 0.058, DRUM_Z - 0.006], [0.16, 0.058, DRUM_Z - 0.008]], 0.0018, { role: 'nacelle', paint: 'warn', sh: 1, sides: 4, ...FINE }),
    poly('rounds ticks', range(0.4, 0.18, 11).flatMap((f) => boxAt([f, 0.06, DRUM_Z - 0.0065], [0.003, 0.003, 0.005], { paint: 'seam' })), FINE)]),
  ...[[0.42, 0.34], [0.26, 0.18]].map(([f0, f1]) => tube('drum hatch', [[f0, -0.03, DRUM_Z - 0.0255], [f0, 0.03, DRUM_Z - 0.0255], [f1, 0.03, DRUM_Z - 0.0255], [f1, -0.03, DRUM_Z - 0.0255], [f0, -0.03, DRUM_Z - 0.0255]], 0.0011, { role: 'nacelle', paint: 'seam', sides: 3, ...FINE })),
  mirror('feed chutes', [faired('feed chute', [[0.47, 0.022, DRUM_Z + 0.0], [0.53, 0.02, GH - 0.02]], 0.014, 0.008, { role: 'nacelle', paint: 'gunmetal', sh: 0.55, ...FINE })]),
  poly('drum fairing seams', range(0.44, 0.14, 5).flatMap((f) => [quad([f + 0.0015, -0.05, DRUM_Z - 0.021], [f - 0.0015, -0.05, DRUM_Z - 0.021], [f - 0.0015, 0.05, DRUM_Z - 0.021], [f + 0.0015, 0.05, DRUM_Z - 0.021], { paint: 'seam', sh: 0.3 })]), FINE),
];

// ── The engines ─────────────────────────────────────────────────────────────────
// Two turbofans where the TF34s were, high on the rear fuselage out of the dust a gun throws up. The
// pods are longer and sharper-lipped; behind each fan, a mixed exhaust through a serrated nozzle
// inside an IR-suppressing shroud that splays the plume flat between the fins.
const E = RP_ENGINES, eF = E.fanF + 0.01, eA = E.tailF, eR = E.r, eG = E.g, eH = E.h;
const pyF = -0.3, pyA = -0.52, pyIn = 0.06, pyOut = eG - eR * 0.75;
const fanBlades = [];
for (let k = 0; k < 18; k++) {
  const a0 = k / 18 * 2 * Math.PI, a1 = a0 + 0.22, tw = 0.24;
  const P = (a, r, df) => [eF - 0.026 + df, Math.cos(a) * r, Math.sin(a) * r];
  fanBlades.push(quad(P(a0, eR * 0.3, 0), P(a0 + tw, eR * 0.84, -0.004), P(a1 + tw, eR * 0.84, -0.01), P(a1, eR * 0.3, -0.006), { paint: 'fan', sh: 0.45 + 0.35 * ((k % 2)) }));
}
const engine = [
  pod('engine pod', 0, 0, [[eF, eR * 0.86], [eF - 0.006, eR * 0.97], [eF - 0.02, eR * 1.02], [eF - 0.08, eR * 1.05], [eF - 0.26, eR * 1.01], [eA + 0.09, eR * 0.86], [eA + 0.02, eR * 0.74], [eA, eR * 0.7]], { sides: 20, paint: 'hull', shade: { base: 0.6, amp: 0.34 } }),
  // The inlet lip: a bare metal ring, and the fan face behind it: blades round a spinner.
  tube('inlet lip', ringF(eF + 0.001, 0, 0, eR * 0.9, 20), 0.0055, { role: 'nacelle', paint: 'metal', sh: 0.8, sides: 6 }),
  poly('inlet duct', range(0, 19, 19).map((k) => { const a0 = k / 20 * 2 * Math.PI, a1 = (k + 1) / 20 * 2 * Math.PI, r = eR * 0.86, r2 = eR * 0.84;
    return quad([eF, Math.cos(a0) * r, Math.sin(a0) * r], [eF, Math.cos(a1) * r, Math.sin(a1) * r], [eF - 0.026, Math.cos(a1) * r2, Math.sin(a1) * r2], [eF - 0.026, Math.cos(a0) * r2, Math.sin(a0) * r2], { paint: 'intake', sh: 0.2 }); })),
  poly('fan face', [discF(eF - 0.03, 0, 0, eR * 0.85, 20, { paint: 'intake', sh: 0.12 })]),
  poly('fan blades', fanBlades),
  cone('fan spinner', eF - 0.028, 0, 0, eR * 0.3, [eF - 0.002, 0, 0], { paint: 'metal', n: 12 }),
  poly('spinner swirl', [quad([eF - 0.012, 0, eR * 0.17], [eF - 0.004, 0, eR * 0.06], [eF - 0.004, 0.002, eR * 0.06], [eF - 0.012, 0.002, eR * 0.17], { paint: 'label', sh: 0.9 })]),
  // Cowl seams, the access door, a vent grille on top and the oil filler.
  ...[eF - 0.06, eF - 0.17, eF - 0.3].map((f) => tube('cowl seam', ringF(f, 0, 0, eR * 1.045, 20), 0.0011, { role: 'nacelle', paint: 'seam', sides: 3 })),
  poly('cowl vent', range(eF - 0.19, eF - 0.27, 6).map((f) => { const r = eR * 1.03 + 0.0012; return quad([f, -0.016, r], [f, 0.016, r], [f - 0.006, 0.016, r - 0.001], [f - 0.006, -0.016, r - 0.001], { paint: 'intake', sh: 0.2 }); })),
  // The nozzle: a serrated mixer in a shroud, dark inside, the hot core deep in it.
  poly('nozzle chevrons', range(0, 11, 11).map((k) => { const a0 = k / 12 * 2 * Math.PI, a1 = (k + 1) / 12 * 2 * Math.PI, am = (a0 + a1) / 2, r = eR * 0.7, r2 = eR * 0.62;
    return { p: [[eA + 0.002, Math.cos(a0) * r, Math.sin(a0) * r], [eA - 0.03, Math.cos(am) * r2, Math.sin(am) * r2], [eA + 0.002, Math.cos(a1) * r, Math.sin(a1) * r]], paint: 'exhaust', sh: 0.5 + 0.2 * (k % 2) }; })),
  poly('nozzle core', [discF(eA + 0.03, 0, 0, eR * 0.6, 12, { paint: 'intake', sh: 0.2 }), discF(eA + 0.025, 0, 0, eR * 0.44, 12, { paint: 'heat', sh: 0.7 })].map((d) => ({ ...d, p: d.p.slice().reverse() }))),
  cone('exhaust plug', eA + 0.02, 0, 0, eR * 0.34, [eA - 0.045, 0, 0], { paint: 'exhaust', n: 12 }),
];
const engines = mirror('engines', [
  group('engine', engine, { xf: { t: [0, eG, eH] }, ...FINE }),
  // The pylon: thick, short, as the A-10's. Explicit shades: a mirror keeps the vertex order.
  poly('engine pylon', [
    { role: 'nacelle', paint: 'hull', sh: 0.82, p: [[pyF, pyIn, 0.105], [pyF, pyOut, eH - 0.01], [pyA, pyOut, eH - 0.01], [pyA, pyIn, 0.095]] },
    { role: 'nacelle', paint: 'hull', sh: 0.55, p: [[pyA, pyIn, 0.07], [pyA, pyOut, eH - 0.045], [pyF, pyOut, eH - 0.045], [pyF, pyIn, 0.08]] },
    { role: 'nacelle', paint: 'hull', sh: 0.7, p: [[pyF, pyIn, 0.08], [pyF, pyOut, eH - 0.045], [pyF, pyOut, eH - 0.01], [pyF, pyIn, 0.105]] },
  ]),
  tube('pylon fire line', [[pyF - 0.01, pyOut - 0.004, eH - 0.012], [pyA + 0.01, pyOut - 0.004, eH - 0.012]], 0.0014, { role: 'nacelle', paint: 'warn', sh: 1, sides: 3, ...FINE }),
  // The IR shroud: two flat plates splaying the exhaust out and up between the tailplane and the fin.
  poly('IR shroud', [
    quad([eA + 0.06, eG + eR * 0.78, eH + 0.03], [eA - 0.06, eG + eR * 1.05, eH + 0.04], [eA - 0.06, eG + eR * 1.05, eH - 0.035], [eA + 0.06, eG + eR * 0.78, eH - 0.03], { paint: 'exhaust', sh: 0.7 }),
    quad([eA + 0.06, eG - eR * 0.78, eH - 0.03], [eA - 0.06, eG - eR * 1.05, eH - 0.035], [eA - 0.06, eG - eR * 1.05, eH + 0.04], [eA + 0.06, eG - eR * 0.78, eH + 0.03], { paint: 'exhaust', sh: 0.55 }),
  ], FINE),
]);
const enginesFar = mirror('engines (far)', [pod('engine pod (far)', eG, eH, [[eF, eR * 0.9], [eF - 0.08, eR * 1.05], [eA, eR * 0.7]], { sides: 8, paint: 'hull' })].map((p) => ({ ...p, ...COARSE })));

// ── The spine ───────────────────────────────────────────────────────────────────
// Behind the canopy: the wingmen's datalink array (a long dark conformal strip of tiles), a satcom
// dome, the APU's exhaust, blades, and the beacon.
const spine = [
  poly('datalink array', patch(range(0.26, -0.12, 10), range(78, 102, 4), { paint: 'carbon', sh: 0.5 }, 0.0024), FINE),
  ...range(0.26, -0.12, 5).map((f) => poly('datalink tile seam', patch([f + 0.0012, f - 0.0012], range(78, 102, 4), { paint: 'seam', sh: 0.3 }, 0.003), FINE)),
  { kind: 'drum', name: 'satcom dome base', f: -0.22, r: 0.03, n: 14, z: [at(-0.22, 90)[2] - 0.004, at(-0.22, 90)[2] + 0.006], role: 'nacelle', paint: 'glare', sh: { base: 0.6 }, top: { sh: 0.8 }, ...FINE },
  group('satcom dome', [pod('dome', 0, 0, [[0.028, 0.004], [0.02, 0.014], [0, 0.018], [-0.02, 0.014], [-0.028, 0.004]], { sides: 12, paint: 'radome', shade: { base: 0.75, amp: 0.2 } })], { xf: { t: [-0.22, 0, at(-0.22, 90)[2] + 0.006] }, ...FINE }),
  { kind: 'blade', name: 'UHF blade', role: 'fin', paint: 'glare', t: 0.0025, sh: [0.7, 0.55], outline: [[-0.32, at(-0.32, 90)[2] - 0.002], [-0.35, at(-0.32, 90)[2] + 0.04], [-0.365, at(-0.32, 90)[2] + 0.04], [-0.375, at(-0.375, 90)[2] - 0.002]], ...FINE },
  { kind: 'blade', name: 'link blade', role: 'fin', paint: 'glare', t: 0.0022, sh: [0.7, 0.55], outline: [[0.18, at(0.18, 90)[2] - 0.002], [0.16, at(0.18, 90)[2] + 0.028], [0.15, at(0.18, 90)[2] + 0.028], [0.14, at(0.14, 90)[2] - 0.002]], ...FINE },
  { kind: 'blade', name: 'belly whip', role: 'fin', paint: 'glare', t: 0.002, sh: [0.7, 0.55], outline: [[-0.4, at(-0.4, -90)[2] + 0.002], [-0.43, at(-0.4, -90)[2] - 0.04], [-0.44, at(-0.4, -90)[2] - 0.04], [-0.43, at(-0.43, -90)[2] + 0.002]], ...FINE },
  D('APU exhaust', -0.7, 0, 0.008, at(-0.7, 90)[2] - 0.002, at(-0.7, 90)[2] + 0.004, 'exhaust', { n: 10, top: { sh: 0.15 } }),
  // Fuselage seams aft of the cockpit, and the long access panels down the flanks.
  ...[0.3, 0.12, -0.05, -0.25, -0.45, -0.66, -0.86].map((f) => poly('fuselage seam', patch([f + 0.0015, f - 0.0015], range(-150, 150, 30).filter((a) => a > -150), { paint: 'seam', sh: 0.4 }, 0.0014), FINE)),
  mirror('flank access panels', [
    tube('flank panel seam', [...alongF([0.26, 0.04], 40, 0.0022), ...roundF(0.04, range(40, 14, 3), 0.0022).slice(1), ...alongF([0.04, 0.26], 14, 0.0022).slice(1), ...roundF(0.26, range(14, 40, 3), 0.0022).slice(1)], 0.0011, { role: 'nacelle', paint: 'seam', sides: 3, ...FINE }),
    tube('flank panel seam', [...alongF([-0.08, -0.36], 30, 0.0022), ...roundF(-0.36, range(30, 2, 3), 0.0022).slice(1), ...alongF([-0.36, -0.08], 2, 0.0022).slice(1), ...roundF(-0.08, range(2, 30, 3), 0.0022).slice(1)], 0.0011, { role: 'nacelle', paint: 'seam', sides: 3, ...FINE }),
    poly('flank vents', range(-0.12, -0.3, 6).map((f) => quad(at(f + 0.004, 24, 0.0026), at(f - 0.004, 24, 0.0026), at(f - 0.004, 8, 0.0026), at(f + 0.004, 8, 0.0026), { paint: 'intake', sh: 0.2 })), FINE),
    // The boarding ladder's door, and kick steps up to the rail.
    tube('ladder door seam', [...alongF([0.3, 0.25], -26, 0.0022), ...roundF(0.25, range(-26, -4, 3), 0.0022).slice(1), ...alongF([0.25, 0.3], -4, 0.0022).slice(1), ...roundF(0.3, range(-4, -26, 3), 0.0022).slice(1)], 0.0011, { role: 'nacelle', paint: 'seam', sides: 3, ...FINE }),
  ]),
  // The chaff and flare dispensers in the tail cone: two banks a side, the cartridge ends showing.
  mirror('dispensers', [poly('dispenser', [-0.84, -0.9].flatMap((f) => [
    ...patch([f + 0.022, f - 0.022], [-40, -18], { paint: 'carbon', sh: 0.45 }, 0.0025),
    ...range(f + 0.016, f - 0.016, 3).flatMap((ff) => [-36, -29, -22].map((a) => quad(at(ff + 0.004, a - 2.5, 0.0032), at(ff - 0.004, a - 2.5, 0.0032), at(ff - 0.004, a + 2.5, 0.0032), at(ff + 0.004, a + 2.5, 0.0032), { paint: 'intake', sh: 0.2 }))),
  ]), FINE)]),
];

// ── The wing, its surfaces, the pods ────────────────────────────────────────────
// The stock planform: a flat centre section to the gear pods, the outer panels up at 7 degrees, and
// drooped Hoerner tips.
const W = [
  { g: 0, le: 0.142, te: -0.233, h: -0.034, t: 1.3 },
  { g: 0.34, le: 0.14, te: -0.23, h: -0.034, t: 1.2 },
  { g: 1.04, le: 0.09, te: -0.2, h: 0.052, t: 0.9 },
  { g: 1.1, le: 0.075, te: -0.19, h: 0.036, t: 0.55 },
];
const onWing = (g) => { const i = g <= W[1].g ? 0 : g <= W[2].g ? 1 : 2; return lerpSt(W[i], W[i + 1], (g - W[i].g) / (W[i + 1].g - W[i].g)); };
const wingTop = (g, x, o = 0) => { const q = foilPt(onWing(g), x, 1); return [q[0], g, q[2] + o]; };
const wingBot = (g, x, o = 0) => { const q = foilPt(onWing(g), x, 0); return [q[0], g, q[2] - o]; };
const wing = foil('wing', W, { nx: 15, paint: 'hull', lowerSh: 0.55, lodNx: 4, bands: [{ x0: 0, x1: 0.05, paint: 'trim' }] });
const flaps = ctrlOn('flap', W[0], W[1], 0.28, 1, 0.24);
const flapsOut = ctrlOn('flap', W[1], W[2], 0, 0.3, 0.24);
const ailerons = ctrlOn('aileron', W[1], W[2], 0.36, 0.98, 0.28);   // the split decelerons
// The deceleron split line, a dark seam along each aileron's trailing edge.
const tipBands = mirror('wingtip bands', [foil('tip band', [{ ...onWing(1.0), t: 0.93 }, { ...W[2], t: 0.92 }], { paint: 'trim', nx: 7, tip: false, sides: 1, lodNx: 3 })]);
const wingDetail = mirror('wing detail', [
  // Walkways at the root, dark non-slip, edged.
  poly('wing walk', [quad(wingTop(0.13, 0.15, 0.0018), wingTop(0.3, 0.15, 0.0018), wingTop(0.3, 0.62, 0.0018), wingTop(0.13, 0.62, 0.0018), { paint: 'glare', sh: 0.5 })], FINE),
  tube('wing walk edge', [wingTop(0.13, 0.15, 0.0024), wingTop(0.3, 0.15, 0.0024), wingTop(0.3, 0.62, 0.0024), wingTop(0.13, 0.62, 0.0024), wingTop(0.13, 0.15, 0.0024)], 0.0011, { role: 'nacelle', paint: 'hazard', sides: 3, ...FINE }),
  // The LED line along the leading edge, and rib and spar seams.
  tube('leading edge light', range(0.4, 1.02, 8).map((g) => { const q = foilPt(onWing(g), 0.0, 1); return [q[0] + 0.003, g, q[2]]; }), 0.002, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  ...[0.2, 0.46, 0.58, 0.86, 0.98].map((g) => tube('wing rib seam', range(0.06, 0.7, 5).map((x) => wingTop(g, x, 0.0012)), 0.0011, { role: 'nacelle', paint: 'seam', sides: 3, ...FINE })),
  tube('wing spar seam', [0.36, 0.5, 0.9, 1.03].map((g) => wingTop(g, 0.2, 0.0012)), 0.0011, { role: 'nacelle', paint: 'seam', sides: 3, ...FINE }),
  tube('wing spar seam', [0.0, 0.33].map((g) => wingTop(g, 0.2, 0.0012)), 0.0011, { role: 'nacelle', paint: 'seam', sides: 3, ...FINE }),
  // A fuel filler and a vortex generator row on the outer panel.
  D('wing filler', wingTop(0.44, 0.35)[0], 0.44, 0.006, wingTop(0.44, 0.35)[2] - 0.001, wingTop(0.44, 0.35)[2] + 0.0025, 'metal', { n: 8, top: { sh: 0.85 } }),
  poly('vortex generators', range(0.38, 0.54, 4).concat(range(0.88, 1.0, 3)).map((g) => { const q = wingTop(g, 0.09); return quad([q[0] + 0.006, g, q[2]], [q[0] - 0.006, g, q[2]], [q[0] - 0.006, g, q[2] + 0.006], [q[0] + 0.004, g, q[2] + 0.002], { paint: 'metal', sh: 0.8 }); }), FINE),
  // The wing's root fillet into the body, forward of the spar.
  faired('root fillet', [[0.2, 0.09, -0.02], [0.08, 0.1, -0.02], [-0.12, 0.1, -0.022]], 0.04, 0.012, { role: 'body', paint: 'hull', sh: 0.66, ...FINE }),
  // The landing lamp in the leading edge, inboard of the gear pod.
  poly('landing lamp', [(() => { const s = onWing(0.25), q = foilPt(s, 0.004, 1), l = foilPt(s, 0.004, 0); return quad([q[0] + 0.002, 0.23, q[2]], [q[0] + 0.002, 0.27, q[2]], [l[0] + 0.002, 0.27, l[2]], [l[0] + 0.002, 0.23, l[2]], { role: 'window', tint: [250, 246, 220], sh: 1 }); })()], FINE),
  // The wingtip countermeasure pod in the drooped tip, as the A-10's has.
  poly('tip dispenser', [quad(wingBot(1.07, 0.3, 0.001), wingBot(1.07, 0.7, 0.001), wingBot(1.095, 0.7, 0.001), wingBot(1.095, 0.3, 0.001), { paint: 'carbon', sh: 0.4 })].map((f) => ({ ...f, p: f.p.slice().reverse() })), FINE),
]);

// Main gear pods on the leading edge, the wheels standing half out of them even when up. The leg,
// the axle and brake, a torque link and the pod's door seam.
const gearPods = group('gear pods', [mirror('gear pods', [
  pod('gear pod', 0.34, -0.085, [[0.35, 0.006], [0.33, 0.026], [0.3, 0.038], [0.25, 0.047], [0.08, 0.047], [-0.06, 0.035], [-0.15, 0.008]], { paint: 'hull', sides: 16, shade: { base: 0.6, amp: 0.32 } }),
  tube('gear pod seam', [[0.3, 0.34 + 0.04, -0.085], [0.1, 0.34 + 0.048, -0.085]], 0.0011, { role: 'nacelle', paint: 'seam', sides: 3, ...FINE }),
  tube('gear pod seam', [[0.3, 0.34 - 0.04, -0.085], [0.1, 0.34 - 0.048, -0.085]], 0.0011, { role: 'nacelle', paint: 'seam', sides: 3, ...FINE }),
  faired('main leg', [[0.25, 0.34, -0.1], [0.24, 0.34, -0.2]], 0.04, 0.012, { role: 'gear' }),
  wheel('main wheel', [0.24, 0.34, -0.238], 0.041, 0.018, 16),
  D('brake disc', 0.24, 0.322, 0.026, -0.2395, -0.2365, 'metal', { n: 12, role: 'gear' }),
  tube('axle', [[0.24, 0.318, -0.238], [0.24, 0.362, -0.238]], 0.006, { role: 'gear', paint: 'metal', sides: 8, caps: 1, ...FINE }),
  tube('torque link', [[0.27, 0.334, -0.14], [0.285, 0.334, -0.17], [0.258, 0.334, -0.2]], 0.003, { role: 'gear', paint: 'metal', sides: 5, ...FINE }),
  tube('brake caliper', [[0.262, 0.322, -0.222], [0.27, 0.322, -0.228]], 0.006, { role: 'gear', paint: 'hazard', sides: 5, caps: 1, ...FINE }),
  tube('brake line', [[0.252, 0.33, -0.11], [0.255, 0.328, -0.2], [0.265, 0.322, -0.222]], 0.0016, { role: 'gear', paint: 'glare', sides: 4, ...FINE }),
])], FINE);
const NG = 0.072;   // the nose gear's g: right of the gun, as the A-10's is
const noseGear = group('nose gear', [
  faired('nose leg', [[0.725, NG, at(0.725, -60)[2] + 0.004], [0.72, NG, -0.215]], 0.022, 0.012, { role: 'gear', paint: 'gearLeg', sh: 0.62 }),
  wheel('nose wheel', [0.72, NG, -0.24], 0.039, 0.014, 16),
  tube('nose fork', [[0.72, NG - 0.017, -0.215], [0.72, NG - 0.017, -0.24]], 0.0035, { role: 'gear', paint: 'metal', sides: 5, ...FINE }),
  tube('nose fork', [[0.72, NG + 0.017, -0.215], [0.72, NG + 0.017, -0.24]], 0.0035, { role: 'gear', paint: 'metal', sides: 5, ...FINE }),
  tube('nose axle', [[0.72, NG - 0.02, -0.24], [0.72, NG + 0.02, -0.24]], 0.004, { role: 'gear', paint: 'metal', sides: 6, caps: 1, ...FINE }),
  tube('nose torque link', [[0.73, NG, -0.15], [0.745, NG, -0.18], [0.728, NG, -0.208]], 0.0028, { role: 'gear', paint: 'metal', sides: 5, ...FINE }),
  poly('taxi lamp', [discF(0.735, NG, -0.2, 0.007, 8, { role: 'window', tint: [250, 246, 220], sh: 1 })], FINE),
  // The gear well's doors, standing open either side of the leg.
  ...[1, -1].map((s) => poly('nose gear door', [quad([0.765, NG + s * 0.024, at(0.765, -70)[2] + 0.002], [0.685, NG + s * 0.024, at(0.685, -70)[2] + 0.002], [0.685, NG + s * 0.027, at(0.685, -70)[2] - 0.032], [0.765, NG + s * 0.027, at(0.765, -70)[2] - 0.032], { role: 'gear', paint: 'belly', sh: s > 0 ? 0.6 : 0.5 })].map((f) => (s > 0 ? f : { ...f, p: f.p.slice().reverse() })), FINE)),
], FINE);

// ── Stores: a missile rail outboard, a glide bomb, the targeting pod ─────────────
const zAt = (g) => foilPt(onWing(g), 0.4, 0)[2];
const pylon = (g, f0, f1, drop) => { const z = zAt(g); return poly('pylon', [
  { role: 'strut', paint: 'hull', sh: 0.8, p: [[f0, g + 0.007, z], [f1, g + 0.007, z], [f1 + 0.02, g + 0.007, z - drop], [f0 - 0.02, g + 0.007, z - drop]] },
  { role: 'strut', paint: 'hull', sh: 0.6, p: [[f0 - 0.02, g - 0.007, z - drop], [f1 + 0.02, g - 0.007, z - drop], [f1, g - 0.007, z], [f0, g - 0.007, z]] },
  { role: 'strut', paint: 'glare', sh: 0.45, p: [[f0 - 0.02, g + 0.007, z - drop], [f1 + 0.02, g + 0.007, z - drop], [f1 + 0.02, g - 0.007, z - drop], [f0 - 0.02, g - 0.007, z - drop]] },
], FINE); };
const stores = group('stores', [mirror('stores', [
  pylon(0.9, 0.05, -0.11, 0.03),
  { kind: 'missile', name: 'missile', f: [-0.13, 0.05], g: 0.9, z: R(zAt(0.9) - 0.05), ...FINE },
  tube('missile rail', [[0.04, 0.9, zAt(0.9) - 0.032], [-0.12, 0.9, zAt(0.9) - 0.032]], 0.0035, { role: 'strut', paint: 'metal', sides: 4, ...FINE }),
  pylon(0.62, 0.06, -0.14, 0.03),
  pod('glide bomb', 0.62, zAt(0.62) - 0.06, [[0.1, 0.006], [0.07, 0.024], [-0.02, 0.028], [-0.12, 0.024], [-0.16, 0.012]], { paint: 'store', sides: 12 }),
  poly('glide bomb wings', [quad([0.02, 0.62, zAt(0.62) - 0.06], [-0.08, 0.62, zAt(0.62) - 0.06], [-0.07, 0.68, zAt(0.62) - 0.062], [-0.04, 0.68, zAt(0.62) - 0.062], { paint: 'store', sh: 0.7 }), quad([-0.04, 0.56, zAt(0.62) - 0.062], [-0.07, 0.56, zAt(0.62) - 0.062], [-0.08, 0.62, zAt(0.62) - 0.06], [0.02, 0.62, zAt(0.62) - 0.06], { paint: 'store', sh: 0.7 })], FINE),
  tube('bomb fins', [[-0.15, 0.62, zAt(0.62) - 0.095], [-0.15, 0.62, zAt(0.62) - 0.025]], 0.003, { role: 'strut', paint: 'store', ...FINE }),
  tube('bomb band', ringF(0.06, 0.62, zAt(0.62) - 0.06, 0.0255, 12), 0.0016, { role: 'nacelle', paint: 'warn', sides: 3, ...FINE }),
  pylon(0.48, 0.06, -0.12, 0.028),
  pod('targeting pod', 0.48, zAt(0.48) - 0.055, [[0.09, 0.004], [0.075, 0.017], [0.05, 0.021], [-0.12, 0.021], [-0.15, 0.008]], { paint: 'glare', sides: 12, regions: [{ at: [0.09, 0.075], k: 'all', role: 'glass', tint: [30, 40, 60] }] }),
])], FINE);

// ── Tail: a straight tailplane, two fins canted out ─────────────────────────────
const T = [
  { g: 0, le: -0.79, te: -1.01, h: 0.052, t: 0.9 },
  { g: 0.36, le: -0.84, te: -1.03, h: 0.052, t: 0.8 },
];
const tailplane = foil('tailplane', T, { role: 'stab', paint: 'hull', nx: 10, lodNx: 4 });
const elevators = ctrlOn('elevator', T[0], T[1], 0.04, 0.9, 0.34);
// The fins, built about their own root on the tailplane's tip and canted out 9 degrees.
const CANT = 9;
const F = [
  { g: -0.088, le: -0.765, te: -1.015, h: 0, t: 0.95 },
  { g: 0.275, le: -0.8, te: -0.99, h: 0, t: 0.8 },
];
const finTop = foilPt(F[1], 0.5, 1);
const fins = mirror('fins', [group('fin', [
  foil('fin', F, { axis: 'g', role: 'fin', paint: 'hull', nx: 10, lodNx: 4 }),
  ctrlOn('rudder', F[0], F[1], 0.12, 0.95, 0.34, { axis: 'g', sh: 0.72 }),
  // The fin's trim band and cap, a formation light strip and the strobe on its top.
  poly('fin band', [0, 1].map((s) => ({ role: 'fin', paint: 'trim', sh: s ? 0.64 : 0.84, p: (s ? [[-0.79, -0.0105, 0.2], [-0.95, -0.0085, 0.2], [-0.952, -0.0085, 0.24], [-0.795, -0.0105, 0.24]] : [[-0.795, 0.0105, 0.24], [-0.952, 0.0085, 0.24], [-0.95, 0.0085, 0.2], [-0.79, 0.0105, 0.2]]) })), FINE),
  tube('fin formation light', [[-0.79, 0.011, 0.12], [-0.8, 0.011, 0.25]], 0.0018, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  tube('fin formation light', [[-0.79, -0.011, 0.12], [-0.8, -0.011, 0.25]], 0.0018, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  tube('fin cap', [[-0.8, 0, finTop[2] + 0.001], [-0.99, 0, finTop[2] + 0.001]], 0.004, { role: 'nacelle', paint: 'glare', sides: 6, caps: 1, ...FINE }),
  tube('fin leading edge', [[-0.765, 0, -0.08], [-0.8, 0, 0.27]], 0.0035, { role: 'nacelle', paint: 'metal', sides: 5, ...FINE }),
], { xf: { t: [0, 0.355, 0.052], r: [-CANT, 0, 0] } })]);

// ── The wingmen ─────────────────────────────────────────────────────────────────
// Two loyal wingmen after the Boeing MQ-28 Ghost Bat: a chined body with a sharp nose and a sensor
// window in it, a dorsal intake flush with the spine, a small swept wing, a V-tail canted out, a flat
// exhaust, lit edges. Each docks conformal on the top of an outer wing panel in a cradle: a dark
// saddle with a lit rim, four clamps and an umbilical, and a lamp lit while its wingman is out. Built
// at the origin, the belly at h 0, nose to +f, and moved onto the wing.
//
// ⚠ THE WINGMEN FLY ON THE `wingmen` CHANNEL (cockpit.js eases it up while the weapons are armed).
// Each wingman is a group whose anim lifts it clear of the cradle, rolls it level and flies it out
// to RP_WINGMEN's station off the wingtip. Both sides are written out, not mirrored: a mirror flips
// a part's anim but not the second stage of a chained one. A contact, the hangar and a card pass no
// channels, so there the wingmen are docked.
const WM = RP_WINGMEN, WL = WM.len, WS = WM.span / 2;
const WMS = [
  { f: 0.5 * WL, rg: 0.002, rvT: 0.002, rvB: 0.002, cz: 0.012, boxy: 0.3 },
  { f: 0.42 * WL, rg: 0.009, rvT: 0.007, rvB: 0.006, cz: 0.012, boxy: 0.6 },
  { f: 0.3 * WL, rg: 0.016, rvT: 0.012, rvB: 0.009, cz: 0.012, boxy: 0.8 },
  { f: 0.12 * WL, rg: 0.022, rvT: 0.018, rvB: 0.011, cz: 0.012, boxy: 0.85 },
  { f: -0.1 * WL, rg: 0.024, rvT: 0.019, rvB: 0.011, cz: 0.012, boxy: 0.88 },
  { f: -0.32 * WL, rg: 0.021, rvT: 0.014, rvB: 0.01, cz: 0.013, boxy: 0.88 },
  { f: -0.46 * WL, rg: 0.015, rvT: 0.008, rvB: 0.008, cz: 0.014, boxy: 0.9 },
  { f: -0.5 * WL, rg: 0.012, rvT: 0.006, rvB: 0.006, cz: 0.014, boxy: 0.9 },
];
const wmPt = (f, a, o = 0) => {
  let s = WMS[WMS.length - 1];
  for (let i = 0; i < WMS.length - 1; i++) if (f <= WMS[i].f && f >= WMS[i + 1].f) { const A = WMS[i], B = WMS[i + 1], t = (A.f - f) / (A.f - B.f); s = { rg: lerp(A.rg, B.rg, t), rvT: lerp(A.rvT, B.rvT, t), rvB: lerp(A.rvB, B.rvB, t), cz: lerp(A.cz, B.cz, t), boxy: lerp(A.boxy, B.boxy, t) }; break; }
  const e = 1 - s.boxy * 0.55, c = Math.cos(a * DEG), sn = Math.sin(a * DEG);
  return [f, Math.sign(c) * Math.abs(c) ** e * (s.rg + o), s.cz + (sn >= 0 ? sn ** e * (s.rvT + o) : -((-sn) ** e) * (s.rvB + o))];
};
const WMW = [
  { g: 0.016, le: 0.04, te: -0.075, h: 0.012, t: 0.7 },
  { g: WS, le: -0.045, te: -0.085, h: 0.014, t: 0.55 },
];
function wingmanBody(name) {
  const tailRoot = -0.33 * WL, tailTip = -0.5 * WL, vh = 0.042, vSpan = 0.05, cant = 50 * DEG;
  // A V-tail half: a thin swept plate leaning out by `cant` from the vertical, both faces.
  const vtail = (s) => {
    const base = [[tailRoot, s * 0.012, 0.024], [tailTip + 0.002, s * 0.01, 0.022]];
    const up = [Math.sin(cant) * s, Math.cos(cant)];
    const tip = [[tailRoot - 0.03, s * 0.012 + up[0] * vSpan, 0.024 + up[1] * vSpan], [tailTip - 0.012, s * 0.01 + up[0] * vSpan, 0.022 + up[1] * vSpan]];
    const n = [0.0012 * Math.cos(cant) * s, -0.0012 * Math.sin(cant)];
    const off = (p, k) => [p[0], p[1] + n[0] * k, p[2] + n[1] * k];
    const q = [base[0], base[1], tip[1], tip[0]];
    const A = q.map((p) => off(p, -1)), B = q.map((p) => off(p, 1)).reverse();
    return [{ p: s > 0 ? A : A.slice().reverse(), paint: 'wingman', sh: 0.78 }, { p: s > 0 ? B : B.slice().reverse(), paint: 'wingman', sh: 0.55 },
      { p: [tip[0], tip[1], off(tip[1], 1), off(tip[0], 1)], paint: 'led', sh: 1 }];
  };
  return [
    loft(name + ' body', 16, WMS, { role: 'nacelle', paint: 'wingman', capFore: { kind: 'apex', at: [0.5 * WL + 0.008, 0, 0.012] }, capAft: { kind: 'flat', paint: 'exhaust', sh: 0.3 }, shade: { base: 0.6, amp: 0.34 } }),
    // The chine down each side, from the nose to the wing.
    poly(name + ' chines', [1, -1].flatMap((s) => range(0.48 * WL, 0.05 * WL, 4).slice(0, -1).map((f, i, a) => {
      const f2 = i + 1 < a.length ? a[i + 1] : 0.05 * WL, p = wmPt(f, 0), q = wmPt(f2, 0), w = (ff) => 0.006 * Math.min(1, (0.5 * WL - ff) / (0.15 * WL));
      const P = [[p[0], s * p[1], p[2]], [q[0], s * q[1], q[2]], [q[0], s * (q[1] + w(f2)), q[2]], [p[0], s * (p[1] + w(f)), p[2]]];
      return { p: s > 0 ? P : P.slice().reverse(), paint: 'wingman', sh: 0.85 };
    }))),
    // The wing: small and swept, mid-mounted.
    rawPoly(name + ' wing', foilFacesLite(WMW), {}),
    poly(name + ' wingtip lights', [1, -1].map((s) => ({ p: [[WMW[1].le - 0.004, s * (WS + 0.0005), 0.012], [WMW[1].te + 0.004, s * (WS + 0.0005), 0.012], [WMW[1].te + 0.004, s * (WS + 0.0005), 0.017], [WMW[1].le - 0.004, s * (WS + 0.0005), 0.017]].map((p, i, A) => (s > 0 ? p : A[3 - i])), role: 'window', tint: s > 0 ? [46, 190, 78] : [200, 52, 48], sh: 1 }))),
    poly(name + ' V-tail', [...vtail(1), ...vtail(-1)]),
    // The dorsal intake: a dark mouth flush with the spine, a lip, and a boundary-layer splitter.
    poly(name + ' intake', [quad(wmPt(0.06 * WL, 72, 0.001), wmPt(0.06 * WL, 108, 0.001), wmPt(-0.06 * WL, 104, 0.0012), wmPt(-0.06 * WL, 76, 0.0012), { paint: 'intake', sh: 0.12 })]),
    tube(name + ' intake lip', [wmPt(0.06 * WL, 70, 0.0016), wmPt(0.06 * WL, 90, 0.0028), wmPt(0.06 * WL, 110, 0.0016)], 0.0012, { role: 'nacelle', paint: 'metal', sides: 3 }),
    // The nose sensor window and an edge light down the spine.
    poly(name + ' sensor window', [quad(wmPt(0.45 * WL, -30, 0.0008), wmPt(0.38 * WL, -40, 0.0008), wmPt(0.38 * WL, -140, 0.0008), wmPt(0.45 * WL, -150, 0.0008), { role: 'glass', tint: [26, 34, 48] })]),
    tube(name + ' spine light', [wmPt(-0.1 * WL, 90, 0.0012), wmPt(-0.44 * WL, 90, 0.0012)], 0.0012, { role: 'nacelle', paint: 'led', sh: 1, sides: 3 }),
    // The exhaust: a flat slot glowing at the tail, and the tail's trim band.
    poly(name + ' exhaust', [quad([-0.5 * WL - 0.0006, -0.008, 0.012], [-0.5 * WL - 0.0006, 0.008, 0.012], [-0.5 * WL - 0.0006, 0.008, 0.016], [-0.5 * WL - 0.0006, -0.008, 0.016], { paint: 'heat', sh: 1 })]),
    poly(name + ' band', range(0, 7, 7).map((k) => { const a0 = -30 + k * 30, a1 = a0 + 30; return quad(wmPt(0.22 * WL, a0, 0.0008), wmPt(0.19 * WL, a0, 0.0008), wmPt(0.19 * WL, a1, 0.0008), wmPt(0.22 * WL, a1, 0.0008), { paint: 'wingmanTrim', sh: 0.8 }); })),
    poly(name + ' panel seams', [0.3, 0.0, -0.25].flatMap((ff) => range(0, 11, 11).map((k) => { const a0 = k * 30, a1 = a0 + 30, f = ff * WL; return quad(wmPt(f + 0.001, a0, 0.0007), wmPt(f - 0.001, a0, 0.0007), wmPt(f - 0.001, a1, 0.0007), wmPt(f + 0.001, a1, 0.0007), { paint: 'seam', sh: 0.35 }); }))),
  ];
}
// A thin wing's faces from two stations, both sides of the centreline: the wingman's.
function foilFacesLite(st) {
  const xs = [0, 0.15, 0.4, 0.7, 1], out = [];
  for (const s of [1, -1]) for (let j = 0; j < xs.length - 1; j++) {
    const P = (k, x, up) => { const q = foilPt(st[k], x, up); return [q[0], s * q[1], q[2]]; };
    const U = [P(0, xs[j], 1), P(1, xs[j], 1), P(1, xs[j + 1], 1), P(0, xs[j + 1], 1)];
    const B = [P(0, xs[j + 1], 0), P(1, xs[j + 1], 0), P(1, xs[j], 0), P(0, xs[j], 0)];
    out.push({ role: 'nacelle', paint: 'wingman', sh: 0.8, p: (s > 0 ? U : U.slice().reverse()).map(P3) });
    out.push({ role: 'nacelle', paint: 'wingman', sh: 0.5, p: (s > 0 ? B : B.slice().reverse()).map(P3) });
  }
  return out;
}
function cradle(name) {
  const hw = WM.span * 0.32, hl = WM.len * 0.36;
  return [
    poly(name + ' saddle', boxAt([0, 0, 0.0018], [2 * hl, 2 * hw, 0.0036], { paint: 'cradle' }), FINE),
    tube(name + ' rim light', [[hl, hw, 0.004], [-hl, hw, 0.004], [-hl, -hw, 0.004], [hl, -hw, 0.004], [hl, hw, 0.004]], 0.0014, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
    ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => poly(name + ' clamp', boxAt([a * hl * 0.6, b * 0.016, 0.006], [0.01, 0.006, 0.008], { paint: 'metal' }), FINE)),
    tube(name + ' umbilical', [[-hl * 0.2, 0, 0.0036], [-hl * 0.2, 0, 0.008]], 0.003, { role: 'nacelle', paint: 'hazard', sides: 6, caps: 1, ...FINE }),
    poly(name + ' away lamp', boxAt([hl - 0.004, 0, 0.0045], [0.004, 2 * hw - 0.01, 0.0018], { paint: 'warn' }), { ...FINE, when: 'wingmen' }),
  ];
}
// The chained anim for one side (s = 1 right, -1 left), in the group's own frame. The group is rolled
// to the panel's dihedral, so the slides are rolled back by the same amount to land where RP_WINGMEN
// says in the aircraft's frame.
function wingmanAnim(s) {
  const r = -s * WM.roll * DEG;   // undo the group's roll on a world vector
  const loc = ([f, g, h]) => [f, g * Math.cos(r) - h * Math.sin(r), g * Math.sin(r) + h * Math.cos(r)];
  const lift = loc([0, 0, WM.lift]), out = loc([WM.out[0], s * WM.out[1], WM.out[2]]);
  return { ch: 'wingmen', slide: P3(lift), span: WM.liftSpan, def: 0,
    then: { ch: 'wingmen', pivot: P3(lift), axis: [1, 0, 0], ang: [0, -s * WM.roll], slide: P3(out), span: WM.flySpan, def: 0 } };
}
const wingmen = [1, -1].flatMap((s) => {
  const side = s > 0 ? 'right' : 'left', xf = { t: P3([WM.dock[0], s * WM.dock[1], WM.dock[2]]), r: [s * WM.roll, 0, 0] };
  return [
    group('wingman cradle (' + side + ')', cradle('cradle'), { xf: { t: P3([WM.dock[0], s * WM.dock[1], WM.dock[2] - 0.002]), r: [s * WM.roll, 0, 0] }, ...FINE }),
    group('wingman (' + side + ')', wingmanBody('wingman'), { xf, anim: wingmanAnim(s), ...FINE }),
    group('wingman (' + side + ', far)', [poly('wingman (far)', [...boxAt([0, 0, 0.012], [WL * 0.9, 0.044, 0.02], { paint: 'wingman' }), ...boxAt([-0.03, 0, 0.012], [0.07, WM.span * 0.9, 0.004], { paint: 'wingman' })])], { xf, anim: wingmanAnim(s), ...COARSE }),
  ];
});

// ── Lamps and lenses ────────────────────────────────────────────────────────────
const tip = foilPt(W[3], 0.5, 1);
const lenses = [
  poly('starboard tip lamp', [{ role: 'window', sh: 1, tint: [46, 190, 78], p: [[tip[0] + 0.04, 1.103, tip[2] - 0.012], [tip[0] - 0.04, 1.103, tip[2] - 0.012], [tip[0] - 0.04, 1.103, tip[2] + 0.004], [tip[0] + 0.04, 1.103, tip[2] + 0.004]] }]),
  poly('port tip lamp', [{ role: 'window', sh: 1, tint: [200, 52, 48], p: [[tip[0] + 0.04, -1.103, tip[2] + 0.004], [tip[0] - 0.04, -1.103, tip[2] + 0.004], [tip[0] - 0.04, -1.103, tip[2] - 0.012], [tip[0] + 0.04, -1.103, tip[2] - 0.012]] }]),
  mirror('tip strobes', [poly('tip strobe', boxAt([tip[0] - 0.07, 1.104, tip[2] - 0.004], [0.014, 0.004, 0.008], { paint: 'strobe' }), FINE)]),
  D('belly beacon', -0.4, 0, 0.01, at(-0.4, -90)[2] - 0.012, at(-0.4, -90)[2] + 0.002, 'beacon', { bottom: { sh: 1 } }),
  D('spine beacon', -0.5, 0, 0.01, at(-0.5, 90)[2] - 0.002, at(-0.5, 90)[2] + 0.012, 'beacon', { top: { sh: 1 } }),
  tube('tail strobe', [[-1.06, 0, 0.064], [-1.079, 0, 0.064]], 0.006, { role: 'nacelle', paint: 'strobe', sh: 1, sides: 6, caps: 1, ...FINE }),
];
const lamps = [
  { at: P3([tip[0], -1.11, tip[2]]), n: [0, -1, 0], rgb: '255,55,55', kind: 'steady' },
  { at: P3([tip[0], 1.11, tip[2]]), n: [0, 1, 0], rgb: '60,255,95', kind: 'steady' },
  { at: P3([tip[0] - 0.07, -1.11, tip[2]]), n: [0, -1, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: P3([tip[0] - 0.07, 1.11, tip[2]]), n: [0, 1, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [-1.085, 0, 0.064], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: P3([-0.5, 0, at(-0.5, 90)[2] + 0.014]), n: [0, 0, 1], rgb: '255,90,70', kind: 'beacon' },
  { at: P3([-0.4, 0, at(-0.4, -90)[2] - 0.014]), n: [0, 0, -1], rgb: '255,90,70', kind: 'beacon' },
];

// ── LED accents along the body ──────────────────────────────────────────────────
const accents = mirror('body light lines', [
  tube('chine light', alongF(range(0.94, 0.64, 5), 0, 0.006), 0.0018, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  tube('formation light', alongF([0.26, 0.06], 30, 0.004), 0.0022, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  tube('formation light', alongF([-0.62, -0.82], 20, 0.004), 0.0022, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  poly('trim stripe', patch([0.32, 0.2, 0.06, -0.08, -0.24, -0.45, -0.7, -0.9], [-6, 3], { paint: 'trim', sh: 0.8 }, 0.0018), FINE),
  // A red band round the gun's end of the nose: the danger area, painted.
  poly('muzzle danger band', patch([0.94, 0.925], range(-80, 0, 6), { paint: 'hazard', sh: 0.7 }, 0.0022), FINE),
]);

// ── The coarse body, for range ──────────────────────────────────────────────────
const coarse = [
  fuselageFar, glassFar, enginesFar,
  tube('gun (far)', [[0.6, 0, GH], [1.0, 0, GH]], GR + BR, { role: 'nacelle', paint: 'gunmetal', sides: 6, ...COARSE }),
  mirror('gear pods (far)', [pod('gear pod (far)', 0.34, -0.085, [[0.35, 0.006], [0.25, 0.047], [-0.06, 0.035], [-0.15, 0.008]], { paint: 'hull', sides: 6 })].map((p) => ({ ...p, ...COARSE }))),
  group('wheels (far)', [mirror('main wheels (far)', [wheel('main wheel (far)', [0.24, 0.34, -0.238], 0.041, 0.018, 8), tube('main leg (far)', [[0.25, 0.34, -0.1], [0.24, 0.34, -0.21]], 0.008, { role: 'gear', sides: 4 })]),
    wheel('nose wheel (far)', [0.72, NG, -0.24], 0.039, 0.014, 8), tube('nose leg (far)', [[0.725, NG, -0.11], [0.72, NG, -0.22]], 0.006, { role: 'gear', sides: 4 })], COARSE),
  group('drum (far)', [pod('drum (far)', 0, 0, [[0.5, 0.006, 0, 0.012], [0.4, 0.024, 0, 0.068], [0.12, 0.018, 0, 0.056], [0.06, 0.004, 0, 0.012]], { sides: 6, paint: 'belly' })], { xf: { t: [0, 0, DRUM_Z + 0.004] }, ...COARSE }),
];

const doc = {
  id: 'gunship_2076',
  kind: 'mesh',
  params: {
    name: 'REAPER 2076',
    note: 'CONCEPT, generated by scripts/shapes/concepts/reaper-2076.mjs (edit that, not this). The Reaper fifty years on, after the Boeing MQ-28 Ghost Bat: still the gun with a plane round it. A seven-barrel rotary cannon in the open under a chined nose, clamped, with a ribbed and slotted breech housing, gas diverters and a feed chute back to a drum fairing with a lit rounds strip; a bubble on an armoured tub bolted down both flanks; a targeting turret, a refuelling receptacle, aperture windows; turbofans high on the rear fuselage with serrated nozzles and IR shrouds; the straight thick wing with its gear standing half out of leading-edge pods; twin fins canted out; a missile, a glide bomb and a targeting pod on pylons; a datalink array and satcom dome on the spine. Two loyal wingmen ride conformal in lit cradles on the outer wing panels and fly in formation off each wingtip while the weapons are armed (the wingmen channel). A variant of the gunship mesh, worn as the REAPER 2076 factory edition.',
    groundPitch: 0,
    hull: 'fuselage',
    navLamps: P3([tip[0], 1.1, tip[2]]),
    lamps,
    finish: 'matte',
    paints: {
      hull: { rgb: [62, 68, 58], livery: 'base' },
      trim: { rgb: [40, 43, 46], livery: 'trim' },
      belly: { rgb: [112, 118, 120], livery: 'fixed', mat: 'matte' },
      glare: { rgb: [30, 32, 34], livery: 'fixed', mat: 'matte' },
      armour: { rgb: [84, 88, 86], livery: 'fixed', mat: 'satin' },
      frame: { rgb: [34, 36, 38], livery: 'fixed', mat: 'satin' },
      seam: { rgb: [36, 40, 34], livery: 'fixed', mat: 'matte' },
      carbon: { rgb: [32, 35, 38], livery: 'fixed', mat: 'satin' },
      gun: { rgb: [44, 44, 46], livery: 'fixed', mat: 'blued' },
      gunmetal: { rgb: [58, 60, 62], livery: 'fixed', mat: 'steel' },
      metal: { rgb: [150, 154, 160], livery: 'fixed', mat: 'bare' },
      gearLeg: { rgb: [60, 64, 66], livery: 'fixed', mat: 'satin' },
      rubber: { rgb: [24, 24, 26], livery: 'fixed', mat: 'rubber' },
      fan: { rgb: [70, 74, 80], livery: 'fixed', mat: 'steel' },
      intake: { rgb: [12, 13, 14], livery: 'fixed', mat: 'matte' },
      exhaust: { rgb: [70, 64, 60], livery: 'fixed', mat: 'exhaust' },
      heat: { rgb: [196, 92, 44], livery: 'fixed', mat: 'matte' },
      hazard: { rgb: [150, 36, 30], livery: 'fixed', mat: 'satin' },
      warn: { rgb: [255, 150, 40], livery: 'fixed', mat: 'matte' },
      label: { rgb: [226, 226, 218], livery: 'fixed', mat: 'satin' },
      radome: { rgb: [88, 92, 90], livery: 'fixed', mat: 'satin' },
      store: { rgb: [74, 84, 64], livery: 'fixed' },
      led: { rgb: [120, 255, 200], livery: 'fixed', mat: 'matte' },
      beacon: { rgb: [235, 70, 56], livery: 'fixed', mat: 'gloss' },
      strobe: { rgb: [240, 244, 248], livery: 'fixed', mat: 'gloss' },
      wingman: { rgb: [96, 102, 100], livery: 'fixed', mat: 'satin' },
      wingmanTrim: { rgb: [62, 68, 58], livery: 'base' },
      cradle: { rgb: [22, 24, 26], livery: 'fixed', mat: 'rubber' },
      interior: { rgb: [38, 42, 44], livery: 'fixed', mat: 'matte' },
      seat: { rgb: [62, 66, 60], livery: 'fixed', mat: 'satin' },
      screen: { rgb: [60, 200, 170], livery: 'fixed', mat: 'gloss' },
    },
    parts: [
      fuselage, windscreen, bubble, ...frames, ...tub, ...interior, chines, ...nose, gun, gunTrough, gasDiverters, ...drum,
      engines, ...spine, wing, flaps, flapsOut, ailerons, tipBands, wingDetail, gearPods, noseGear, stores,
      tailplane, elevators, fins, ...wingmen, ...lenses, accents,
      ...coarse,
    ],
  },
};

const v = validateMesh(doc.params, doc.id);
if (v.errors.length) { console.log('ERRORS', v.errors.slice(0, 12)); process.exit(1); }
if (v.warnings?.length) console.log('warnings', v.warnings.slice(0, 8));
const n1 = compileMesh(doc.params, { detail: 1 }).faces.length, n0 = compileMesh(doc.params, { detail: 0 }).faces.length;
writeFileSync(new URL('../../../content/vehicle_models/mesh_gunship_2076.json', import.meta.url), formatMesh(doc));
console.log('mesh_gunship_2076.json:', n1, 'faces near,', n0, 'far');
