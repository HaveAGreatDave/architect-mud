// The REAPER 2076 concept: writes content/vehicle_models/mesh_gunship_2076.json.
//
//   node scripts/shapes/concepts/reaper-2076.mjs
//   then: npm run vehicles:bake
//
// The Reaper fifty years on. The ancestor is the A-10 Thunderbolt II (the stock mesh). The 2076
// aircraft is still the gun with a plane round it: a seven-barrel rotary cannon hangs in the open
// under a chined nose and runs back into the belly to a drum the size of a car. Everything round it
// has moved on. The bubble is one frameless gold-tinted piece on the armoured tub. Aft of the cockpit
// the body flares into a broad flat engine deck with both turbofans buried in it, still high out of
// the dust: each breathes through a dorsal intake on the deck's shoulder and blows out of a flat slot
// nozzle over a beavertail. Two fins stand canted hard out on the deck's edges ahead of the nozzles,
// over a swept tailplane. The wing keeps its thickness and its gear pods but is swept, raked at the
// tips and run into the body by strakes. Light lines trace the chines, the deck's edges, the intakes'
// lips and every leading edge.
//
// A variant of the gunship mesh (mesh_gunship.json `variants`, written by fw-meshes/reaper.mjs), worn
// as the REAPER 2076 factory edition. Same frame and scale as the stock body: the gun's muzzles at
// f 1.0 and h -0.064, the tail cone's apex at -1.08, the wheels touching at h -0.279 where the stock
// wheels do, so she sits at the stock `groundPitch` and the flight view frames her the same way.
//
// ⚠ THIS OVERWRITES THE JSON. Edit this file, not the mesh in the Modelshop.
//
// ⚠ THE GUN'S BARRELS ARE THE ONLY FACES PAINTED `gun`. The renderer finds the muzzles as the
// forward-most `gun` faces each side of the centreline (windshield.js gunMuzzles), so a clamp or a
// shroud painted `gun` would move where the tracers start.
//
// ⚠ THE EXHAUST HAZE IS DRAWN AT THE NOZZLES' EXITS (windshield.js, the gunship's 2076 arm), which are
// rpEngineAxis(RP_ENGINES.tailF). Move the engines and that table moves with them by hand.
//
// ⚠ EVERYTHING STAYS BETWEEN f -1.08 AND 1.0. interior-reaper-2076.js scales the cockpit by the
// compiled model's length, so a part past either end shrinks the room.
//
// Two bodies in one file. Everything fine is `minDetail: 1`; a coarse body with `maxDetail: 0` stands
// in at range. The wing and tail come from lib.mjs's `foil`, which carries its own far body.
//
// Frame: f fore, g right, h up. Angles on a section are lib.mjs's: 0 = right waterline, +90 = crown.
import { writeFileSync } from 'node:fs';
import { R, P3, loft, pod, foil, ctrlOn, tube, mirror, group, poly as rawPoly, quad, wheel, faired, DEG, foilPt, lerpSt, skin } from '../fw-meshes/lib.mjs';
const { formatMesh, validateMesh, compileMesh } = await import('../../../client/shared/vehicle-mesh.js');
const { RP_STATIONS, RP_APEX_FORE, RP_APEX_AFT, RP_GLASS, RP_CANOPY, RP_ENGINES, RP_GUN, RP_WING, RP_STRAKE, RP_TAIL, RP_STORES, rpPoint, rpEngineAxis } = await import('../../../client/shared/cabin-reaper-2076.js');

const FINE = { minDetail: 1 }, COARSE = { maxDetail: 0 };
// Every poly face needs a role; trim and fittings are 'nacelle' unless they say otherwise.
const poly = (name, faces, extra) => rawPoly(name, faces.map((f) => ({ role: 'nacelle', ...f })), extra);
// The canopy's gold flash: a metallised coat in the glass, so from outside it reads as a warm dark gold.
const GLASS = [112, 92, 52];
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

// Frames: thin ones. The windscreen has no posts; a slim arch at its fore edge, a slim bow where it
// meets the bubble, the sill rails and the aft hoop, a black seal along every edge, and the canopy's
// hinge and jettison line at the back.
const FR = (name, pts, r = 0.004) => tube(name, pts, r, { role: 'nacelle', paint: 'frame', sh: 0.5, sides: 6, ...FINE });
const SEAL = (name, pts) => tube(name, pts, 0.0018, { role: 'nacelle', paint: 'rubber', sh: 0.35, sides: 4, ...FINE });
const frames = [
  FR('windscreen arch', roundF(G.windscreen.f[1] + 0.002, range(G.windscreen.a[0] - 4, G.windscreen.a[1] + 4, 20)), 0.0035),
  FR('canopy bow', roundF(RP_CANOPY.bowF, range(G.bubble.a[0] - 3, G.bubble.a[1] + 3, 24)), 0.0035),
  FR('aft hoop', roundF(RP_CANOPY.hoopF, range(G.bubble.a[0] - 3, G.bubble.a[1] + 3, 24)), 0.004),
  SEAL('windscreen seal', roundF(G.windscreen.f[1] - 0.004, range(G.windscreen.a[0], G.windscreen.a[1], 20), 0.0025)),
  SEAL('bubble fore seal', roundF(G.bubble.f[1] - 0.004, range(G.bubble.a[0], G.bubble.a[1], 24), 0.0025)),
  ...G.windscreen.posts.map((a) => FR('windscreen post', alongF(WS_F, a, 0.0035), 0.0045)),
  ...[0, 1].flatMap((s) => {
    const A = (a) => (s ? L(a) : a), side = s ? 'left' : 'right';
    return [
      FR('windscreen sill (' + side + ')', alongF(WS_F, A(G.windscreen.a[0] - 1.5)), 0.003),
      FR('canopy rail (' + side + ')', alongF(range(RP_CANOPY.bowF, RP_CANOPY.hoopF - 0.01, 12), A(RP_CANOPY.sillA)), 0.0035),
      // A light line down the sill under the glass, where the rail meets the tub.
      tube('canopy sill light (' + side + ')', alongF(range(RP_CANOPY.bowF + 0.07, RP_CANOPY.hoopF, 12), A(RP_CANOPY.sillA - 3), 0.0035), 0.0015, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
      SEAL('rail seal (' + side + ')', alongF(BB_F, A(G.bubble.a[0] + 1), 0.0025)),
      // The canopy's external jettison handle, behind a striped door low on the rail.
      poly('jettison door (' + side + ')', patch([0.37, 0.345], s ? [L(14), L(6)] : [6, 14], { paint: 'hazard', sh: 0.65 }, 0.003), FINE),
    ];
  }),
  // The hinge at the back of the bubble: two lugs and the actuator fairing on the spine.
  poly('canopy hinge', [...boxAt(at(0.31, 90, 0.004), [0.024, 0.03, 0.01], { paint: 'frame' })], FINE),
  ...[1, -1].map((s) => tube('canopy hinge lug', [at(0.322, s > 0 ? 70 : 110, 0.003), at(0.304, s > 0 ? 74 : 106, 0.009)], 0.003, { role: 'nacelle', paint: 'metal', sides: 5, ...FINE })),
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
// eye at f 0.47, h 0.172): the ejection seat, the swept dash with its lit band of glass, and the two
// side consoles with the thrust levers and the stick.
const interior = [
  poly('seat pan', slab([0.43, 0, 0.098], [0.05, 0.062, 0.018], 6, { paint: 'seat' }), FINE),
  poly('seat back', slab([0.4, 0, 0.15], [0.016, 0.064, 0.1], -14, { paint: 'seat' }), FINE),
  poly('headbox', slab([0.392, 0, 0.214], [0.022, 0.05, 0.036], -14, { paint: 'seat' }), FINE),
  poly('headbox stripes', slab([0.381, 0, 0.214], [0.002, 0.03, 0.024], -14, { paint: 'hazard' }), FINE),
  poly('dash', slab([0.565, 0, 0.122], [0.05, 0.15, 0.03], 6, { paint: 'interior' }), FINE),
  poly('dash band', slab([0.542, 0, 0.13], [0.003, 0.15, 0.034], -24, { paint: 'screen' }), FINE),
  ...[1, -1].map((s) => poly('console', slab([0.47, s * 0.043, 0.085], [0.12, 0.017, 0.04], 0, { paint: 'interior' }), FINE)),
  tube('stick', [[0.48, 0.043, 0.106], [0.485, 0.043, 0.128]], 0.0035, { role: 'nacelle', paint: 'interior', sides: 5, ...FINE }),
  ...[0.003, -0.003].map((dg) => tube('throttle', [[0.48, -0.043 + dg, 0.106], [0.487, -0.043 + dg, 0.124]], 0.0026, { role: 'nacelle', paint: 'metal', sides: 5, ...FINE })),
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
// Two turbofans buried in the engine deck (cabin-reaper-2076.js RP_ENGINES). Each shows as a long low
// hump on the deck: a dorsal intake on the shoulder, its mouth a dark letterbox with a lit lip and no
// fan in sight (the duct bends down to it); a row of bypass vents and two seams down the hump, a light
// line along its outboard shoulder; and at the back a flat slot nozzle over the beavertail, dark inside
// with the hot core glowing between three vanes, and a scorched trench on the deck behind it.
// Built on the right engine's axis at g 0 and moved and toed in by the group, as rpEngineAxis says.
const E = RP_ENGINES, TOE = Math.sin(E.toe * DEG), eF = E.fanF, eA = E.tailF, eR = E.r, eH = E.h;
const HUMP = [
  { f: eF, rg: eR * 0.92, rvT: eR * 0.62, rvB: eR * 0.62, cz: eH + 0.004, boxy: 0.92 },
  { f: eF - 0.05, rg: eR, rvT: eR * 0.8, rvB: eR * 0.8, cz: eH, boxy: 0.86 },
  { f: -0.25, rg: eR * 1.02, rvT: eR * 0.86, rvB: eR * 0.86, cz: eH, boxy: 0.84 },
  { f: -0.55, rg: eR * 0.98, rvT: eR * 0.76, rvB: eR * 0.8, cz: eH - 0.002, boxy: 0.86 },
  { f: eA + 0.06, rg: eR * 0.96, rvT: eR * 0.5, rvB: eR * 0.6, cz: eH - 0.004, boxy: 0.94 },
  { f: eA, rg: eR * 0.94, rvT: eR * 0.34, rvB: eR * 0.4, cz: eH - 0.002, boxy: 0.96 },
];
// A point on the hump's skin at station f, angle a (degrees, lib.mjs's), `o` proud of it.
const hp = (f, a, o = 0) => skin(HUMP, f, a * DEG, o);
const humpPatch = (fs, as, extra, o = 0.0014) => {
  const out = [];
  for (let i = 0; i < fs.length - 1; i++) for (let j = 0; j < as.length - 1; j++) {
    out.push(quad(hp(fs[i + 1], as[j], o), hp(fs[i], as[j], o), hp(fs[i], as[j + 1], o), hp(fs[i + 1], as[j + 1], o), extra));
  }
  return out;
};
const VISOR_A = range(18, 162, 9);
// An aft-facing rectangle in the plane f, from g0 to g1 and h0 to h1.
const aftRect = (f, g0, g1, h0, h1, extra) => ({ p: [[f, g1, h0], [f, g1, h1], [f, g0, h1], [f, g0, h0]], ...extra });
const slot = HUMP[HUMP.length - 1], slotW = slot.rg * 0.82;
const engine = [
  loft('engine hump', 20, HUMP, { role: 'nacelle', paint: 'hull', capFore: { kind: 'flat', paint: 'intake', sh: 0.1 }, capAft: { kind: 'flat', paint: 'intake', sh: 0.12 }, shade: { base: 0.6, amp: 0.34 } }),
  // The intake's lit lip round the upper half of the mouth, and a visor raked forward over it, which
  // is what makes the mouth a sharp letterbox from the side rather than a hole in a hump.
  tube('intake lip', range(-12, 192, 17).map((a) => hp(eF + 0.0015, a, 0.0012)), 0.0018, { role: 'nacelle', paint: 'led', sh: 1, sides: 4 }),
  poly('intake visor', VISOR_A.slice(0, -1).flatMap((a, i) => {
    const p = hp(eF, a, 0.0012), q = hp(eF, VISOR_A[i + 1], 0.0012), fw = (v) => [v[0] + 0.022, v[1], v[2] + 0.002];
    return [{ p: [p, fw(p), fw(q), q], paint: 'hull', sh: 0.82 }, { p: [q, fw(q), fw(p), p], paint: 'glare', sh: 0.35 }];
  })),
  // Seams round the hump, a vent row on its back, and the light line down its outboard shoulder.
  ...[eF - 0.16, -0.46].map((f) => tube('hump seam', range(-20, 200, 11).map((a) => hp(f, a, 0.0011)), 0.0011, { role: 'nacelle', paint: 'seam', sides: 3 })),
  poly('bypass vents', range(-0.36, -0.56, 7).flatMap((f) => humpPatch([f + 0.007, f - 0.007], [72, 108], { paint: 'intake', sh: 0.18 }, 0.0013))),
  tube('hump light', range(eF - 0.06, eA + 0.08, 8).map((f) => hp(f, 32, 0.0014)), 0.0016, { role: 'nacelle', paint: 'led', sh: 1, sides: 4 }),
  // The nozzle: three vanes across the slot, the hot core glowing between them, and a lit rim.
  poly('nozzle core', [aftRect(eA - 0.0006, -slotW, slotW, slot.cz - slot.rvB * 0.6, slot.cz + slot.rvT * 0.6, { paint: 'heat', sh: 0.85 })]),
  poly('nozzle vanes', [-0.5, 0, 0.5].map((k) => aftRect(eA - 0.0012, k * slotW - 0.0016, k * slotW + 0.0016, slot.cz - slot.rvB * 0.75, slot.cz + slot.rvT * 0.75, { paint: 'exhaust', sh: 0.5 }))),
  tube('nozzle rim', range(0, 180, 12).map((a) => hp(eA - 0.001, a, 0.0008)), 0.0014, { role: 'nacelle', paint: 'exhaust', sides: 4 }),
];
const engineXf = { t: [0, R(E.g - eF * TOE), 0], r: [0, 0, E.toe] };
// The trench aft of each nozzle, on the beavertail: soot, where the exhaust lies along the deck.
const trenchG = rpEngineAxis(eA)[0];
const engines = mirror('engines', [
  group('engine', engine, { xf: engineXf, ...FINE }),
  poly('exhaust trench', range(eA - 0.004, -0.98, 6).slice(0, -1).map((f, i, a) => {
    const f2 = i + 1 < a.length ? a[i + 1] : -0.98, w = slotW * (1 - 0.35 * (eA - f) / (eA + 0.98));
    const g = trenchG + (f - eA) * TOE, g2 = trenchG + (f2 - eA) * TOE, w2 = slotW * (1 - 0.35 * (eA - f2) / (eA + 0.98));
    const top = (ff, gg) => { const s = rpPoint(ff, 90); let hi = s[2]; for (const a2 of range(90, 20, 14)) { const q = rpPoint(ff, a2); if (q[1] >= gg) { hi = q[2]; break; } } return hi + 0.0016; };
    return quad([f2, g2 + w2, top(f2, g2 + w2)], [f, g + w, top(f, g + w)], [f, g - w, top(f, g - w)], [f2, g2 - w2, top(f2, g2 - w2)], { paint: 'exhaust', sh: 0.45 });
  }), FINE),
]);
const enginesFar = mirror('engines (far)', [group('engine (far)', [loft('engine hump (far)', 8, [HUMP[0], HUMP[2], HUMP[HUMP.length - 1]], { role: 'nacelle', paint: 'hull', capFore: { kind: 'flat', paint: 'intake', sh: 0.1 }, capAft: { kind: 'flat', paint: 'intake', sh: 0.12 } })], { xf: engineXf, ...COARSE })]);

// ── The spine ───────────────────────────────────────────────────────────────────
// Behind the canopy, up to the intakes: a warning-receiver array (a dark conformal strip of tiles);
// then between the engine humps a satcom dome, the APU's exhaust, blades, and the beacon.
const spine = [
  poly('sensor array', patch(range(0.26, 0.04, 6), range(82, 98, 4), { paint: 'carbon', sh: 0.5 }, 0.0024), FINE),
  ...range(0.26, 0.04, 3).map((f) => poly('sensor tile seam', patch([f + 0.0012, f - 0.0012], range(82, 98, 4), { paint: 'seam', sh: 0.3 }, 0.003), FINE)),
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
// cabin-reaper-2076.js RP_WING: a thick flat centre section to the gear pods, the outer panels swept
// and up 7 degrees, and raked tips; and a strake each side from the tub's flank into the leading edge.
const W = RP_WING, TIP_G = W[W.length - 1].g;
const onWing = (g) => { const i = g <= W[1].g ? 0 : g <= W[2].g ? 1 : 2; return lerpSt(W[i], W[i + 1], (g - W[i].g) / (W[i + 1].g - W[i].g)); };
const wingTop = (g, x, o = 0) => { const q = foilPt(onWing(g), x, 1); return [q[0], g, q[2] + o]; };
const wing = foil('wing', W, { nx: 15, paint: 'hull', lowerSh: 0.55, lodNx: 4, bands: [{ x0: 0, x1: 0.05, paint: 'trim' }] });
const flaps = ctrlOn('flap', W[0], W[1], 0.28, 1, 0.24);
const flapsOut = ctrlOn('flap', W[1], W[2], 0, 0.3, 0.24);
const ailerons = ctrlOn('aileron', W[1], W[2], 0.36, 0.98, 0.28);   // the split decelerons
// The raked tip in the trim colour, a hair proud of the wing, from where the sweep starts to rake.
const tipBands = mirror('wingtip bands', [foil('tip band', [{ ...onWing(0.92), t: onWing(0.92).t + 0.012 }, { ...W[2], t: W[2].t + 0.012 }, { ...W[3], t: W[3].t + 0.012 }], { paint: 'trim', nx: 7, sides: 1, lodNx: 3 })]);
// The strakes: thin plates from the tub's flank, behind the armour, into the inner leading edge.
const strakes = foil('strake', RP_STRAKE, { paint: 'hull', nx: 7, lodNx: 3, lowerSh: 0.5 });
const wingDetail = mirror('wing detail', [
  // Walkways at the root, outboard of the engine deck, dark non-slip, edged.
  poly('wing walk', [quad(wingTop(0.19, 0.18, 0.0018), wingTop(0.31, 0.18, 0.0018), wingTop(0.31, 0.62, 0.0018), wingTop(0.19, 0.62, 0.0018), { paint: 'glare', sh: 0.5 })], FINE),
  tube('wing walk edge', [wingTop(0.19, 0.18, 0.0024), wingTop(0.31, 0.18, 0.0024), wingTop(0.31, 0.62, 0.0024), wingTop(0.19, 0.62, 0.0024), wingTop(0.19, 0.18, 0.0024)], 0.0011, { role: 'nacelle', paint: 'hazard', sides: 3, ...FINE }),
  // The light line along the leading edge from the strake to the tip, and rib and spar seams.
  tube('leading edge light', range(0.39, TIP_G - 0.004, 9).map((g) => { const q = foilPt(onWing(g), 0.0, 1); return [q[0] + 0.003, g, q[2]]; }), 0.002, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  tube('strake light', range(0, 1, 4).map((t) => { const q = foilPt(lerpSt(RP_STRAKE[0], RP_STRAKE[1], 0.08 + 0.92 * t), 0.0, 1); return [q[0] + 0.002, q[1], q[2]]; }), 0.0016, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  ...[0.24, 0.46, 0.58, 0.76, 0.9].map((g) => tube('wing rib seam', range(0.06, 0.7, 5).map((x) => wingTop(g, x, 0.0012)), 0.0011, { role: 'nacelle', paint: 'seam', sides: 3, ...FINE })),
  tube('wing spar seam', [0.36, 0.5, 0.9, 0.98].map((g) => wingTop(g, 0.2, 0.0012)), 0.0011, { role: 'nacelle', paint: 'seam', sides: 3, ...FINE }),
  tube('wing spar seam', [0.18, 0.33].map((g) => wingTop(g, 0.2, 0.0012)), 0.0011, { role: 'nacelle', paint: 'seam', sides: 3, ...FINE }),
  // A fuel filler on the outer panel.
  D('wing filler', wingTop(0.44, 0.35)[0], 0.44, 0.006, wingTop(0.44, 0.35)[2] - 0.001, wingTop(0.44, 0.35)[2] + 0.0025, 'metal', { n: 8, top: { sh: 0.85 } }),
  // The landing lamp in the leading edge, outboard of the gear pod.
  poly('landing lamp', [(() => { const s = onWing(0.44), q = foilPt(s, 0.004, 1), l = foilPt(s, 0.004, 0); return quad([q[0] + 0.002, 0.42, q[2]], [q[0] + 0.002, 0.46, q[2]], [l[0] + 0.002, 0.46, l[2]], [l[0] + 0.002, 0.42, l[2]], { role: 'window', tint: [250, 246, 220], sh: 1 }); })()], FINE),
]);

// Main gear pods on the leading edge. The leg, the axle and brake, a torque link and the pod's door
// seam.
// The gear channel runs 1 (down) to 0 (up). Each leg swings aft about its top and up a little, the
// mains into their pods and the nose leg into the belly beside the gun; the legs move over the
// middle of the channel and the nose doors shut behind theirs.
// ⚠ A positive angle about +g swings a leg aft.
const LEG = { ch: 'gear', span: [0.9, 0.2] };
const MAIN_FOLD = { ...LEG, pivot: [0.25, 0.34, -0.1], axis: [0, 1, 0], ang: [0, 85], slide: [0, 0, 0.012] };
const gearPods = group('gear pods', [mirror('gear pods', [
  pod('gear pod', 0.34, -0.085, [[0.35, 0.006], [0.33, 0.026], [0.3, 0.038], [0.25, 0.047], [0.08, 0.047], [-0.06, 0.035], [-0.15, 0.008]], { paint: 'hull', sides: 16, shade: { base: 0.6, amp: 0.32 } }),
  tube('gear pod seam', [[0.3, 0.34 + 0.04, -0.085], [0.1, 0.34 + 0.048, -0.085]], 0.0011, { role: 'nacelle', paint: 'seam', sides: 3, ...FINE }),
  tube('gear pod seam', [[0.3, 0.34 - 0.04, -0.085], [0.1, 0.34 - 0.048, -0.085]], 0.0011, { role: 'nacelle', paint: 'seam', sides: 3, ...FINE }),
  group('main leg', [
  faired('main leg', [[0.25, 0.34, -0.1], [0.24, 0.34, -0.2]], 0.04, 0.012, { role: 'gear' }),
  wheel('main wheel', [0.24, 0.34, -0.238], 0.041, 0.018, 16),
  D('brake disc', 0.24, 0.322, 0.026, -0.2395, -0.2365, 'metal', { n: 12, role: 'gear' }),
  tube('axle', [[0.24, 0.318, -0.238], [0.24, 0.362, -0.238]], 0.006, { role: 'gear', paint: 'metal', sides: 8, caps: 1, ...FINE }),
  tube('torque link', [[0.27, 0.334, -0.14], [0.285, 0.334, -0.17], [0.258, 0.334, -0.2]], 0.003, { role: 'gear', paint: 'metal', sides: 5, ...FINE }),
  tube('brake caliper', [[0.262, 0.322, -0.222], [0.27, 0.322, -0.228]], 0.006, { role: 'gear', paint: 'hazard', sides: 5, caps: 1, ...FINE }),
  tube('brake line', [[0.252, 0.33, -0.11], [0.255, 0.328, -0.2], [0.265, 0.322, -0.222]], 0.0016, { role: 'gear', paint: 'glare', sides: 4, ...FINE }),
  ], { anim: MAIN_FOLD }),
])], FINE);
const NG = 0.072;   // the nose gear's g: right of the gun, as the A-10's is
const NOSE_TOP = R(at(0.725, -60)[2] + 0.004);
const NOSE_FOLD = { ...LEG, pivot: [0.725, NG, NOSE_TOP], axis: [0, 1, 0], ang: [0, 85], slide: [0, 0, 0.02] };
// A door hangs from its top edge, which follows the belly, and folds in under the well.
const DOOR_F = [0.765, 0.685], DOOR_H = DOOR_F.map((f) => R(at(f, -70)[2] + 0.002));
const doorShut = (s) => ({ ch: 'gear', span: [0.2, 0], pivot: [DOOR_F[0], R(NG + s * 0.024), DOOR_H[0]], axis: [DOOR_F[0] - DOOR_F[1], 0, R(DOOR_H[0] - DOOR_H[1])], ang: [0, -s * 86] });
const noseGear = group('nose gear', [
  group('nose leg', [
  faired('nose leg', [[0.725, NG, at(0.725, -60)[2] + 0.004], [0.72, NG, -0.215]], 0.022, 0.012, { role: 'gear', paint: 'gearLeg', sh: 0.62 }),
  wheel('nose wheel', [0.72, NG, -0.24], 0.039, 0.014, 16),
  tube('nose fork', [[0.72, NG - 0.017, -0.215], [0.72, NG - 0.017, -0.24]], 0.0035, { role: 'gear', paint: 'metal', sides: 5, ...FINE }),
  tube('nose fork', [[0.72, NG + 0.017, -0.215], [0.72, NG + 0.017, -0.24]], 0.0035, { role: 'gear', paint: 'metal', sides: 5, ...FINE }),
  tube('nose axle', [[0.72, NG - 0.02, -0.24], [0.72, NG + 0.02, -0.24]], 0.004, { role: 'gear', paint: 'metal', sides: 6, caps: 1, ...FINE }),
  tube('nose torque link', [[0.73, NG, -0.15], [0.745, NG, -0.18], [0.728, NG, -0.208]], 0.0028, { role: 'gear', paint: 'metal', sides: 5, ...FINE }),
  poly('taxi lamp', [discF(0.735, NG, -0.2, 0.007, 8, { role: 'window', tint: [250, 246, 220], sh: 1 })], FINE),
  ], { anim: NOSE_FOLD }),
  // The gear well's doors, standing open either side of the leg.
  ...[1, -1].map((s) => poly('nose gear door', [quad([0.765, NG + s * 0.024, at(0.765, -70)[2] + 0.002], [0.685, NG + s * 0.024, at(0.685, -70)[2] + 0.002], [0.685, NG + s * 0.027, at(0.685, -70)[2] - 0.032], [0.765, NG + s * 0.027, at(0.765, -70)[2] - 0.032], { role: 'gear', paint: 'belly', sh: s > 0 ? 0.6 : 0.5 })].map((f) => (s > 0 ? f : { ...f, p: f.p.slice().reverse() })), { ...FINE, anim: doorShut(s) })),
], FINE);

// ── Stores: a missile rail outboard, a glide bomb, the targeting pod ─────────────
const zAt = (g) => foilPt(onWing(g), 0.4, 0)[2];
const pylon = (g, f0, f1, drop) => { const z = zAt(g); return poly('pylon', [
  { role: 'strut', paint: 'hull', sh: 0.8, p: [[f0, g + 0.007, z], [f1, g + 0.007, z], [f1 + 0.02, g + 0.007, z - drop], [f0 - 0.02, g + 0.007, z - drop]] },
  { role: 'strut', paint: 'hull', sh: 0.6, p: [[f0 - 0.02, g - 0.007, z - drop], [f1 + 0.02, g - 0.007, z - drop], [f1, g - 0.007, z], [f0, g - 0.007, z]] },
  { role: 'strut', paint: 'glare', sh: 0.45, p: [[f0 - 0.02, g + 0.007, z - drop], [f1 + 0.02, g + 0.007, z - drop], [f1 + 0.02, g - 0.007, z - drop], [f0 - 0.02, g - 0.007, z - drop]] },
], FINE); };
// Where each hangs is RP_STORES, which the cockpit's stores page draws from.
const SM = RP_STORES.missile, SB = RP_STORES.bomb, SP = RP_STORES.pod;
const stores = group('stores', [mirror('stores', [
  pylon(SM, 0.05, -0.11, 0.03),
  { kind: 'missile', name: 'missile', f: [-0.13, 0.05], g: SM, z: R(zAt(SM) - 0.05), ...FINE },
  tube('missile rail', [[0.04, SM, zAt(SM) - 0.032], [-0.12, SM, zAt(SM) - 0.032]], 0.0035, { role: 'strut', paint: 'metal', sides: 4, ...FINE }),
  pylon(SB, 0.06, -0.14, 0.03),
  pod('glide bomb', SB, zAt(SB) - 0.06, [[0.1, 0.006], [0.07, 0.024], [-0.02, 0.028], [-0.12, 0.024], [-0.16, 0.012]], { paint: 'store', sides: 12 }),
  poly('glide bomb wings', [quad([0.02, SB, zAt(SB) - 0.06], [-0.08, SB, zAt(SB) - 0.06], [-0.07, SB + 0.06, zAt(SB) - 0.062], [-0.04, SB + 0.06, zAt(SB) - 0.062], { paint: 'store', sh: 0.7 }), quad([-0.04, SB - 0.06, zAt(SB) - 0.062], [-0.07, SB - 0.06, zAt(SB) - 0.062], [-0.08, SB, zAt(SB) - 0.06], [0.02, SB, zAt(SB) - 0.06], { paint: 'store', sh: 0.7 })], FINE),
  tube('bomb fins', [[-0.15, SB, zAt(SB) - 0.095], [-0.15, SB, zAt(SB) - 0.025]], 0.003, { role: 'strut', paint: 'store', ...FINE }),
  tube('bomb band', ringF(0.06, SB, zAt(SB) - 0.06, 0.0255, 12), 0.0016, { role: 'nacelle', paint: 'warn', sides: 3, ...FINE }),
  pylon(SP, 0.06, -0.12, 0.028),
  pod('targeting pod', SP, zAt(SP) - 0.055, [[0.09, 0.004], [0.075, 0.017], [0.05, 0.021], [-0.12, 0.021], [-0.15, 0.008]], { paint: 'glare', sides: 12, regions: [{ at: [0.09, 0.075], k: 'all', role: 'glass', tint: [30, 40, 60] }] }),
])], FINE);

// ── Tail: two fins canted hard out on the deck's edges, a swept tailplane ───────
// cabin-reaper-2076.js RP_TAIL. Each fin is built about its own root (lib.mjs's foil on axis 'g', the
// span up h) and placed by its group's roll, pitch and translate, which rpFinXf repeats for the
// hologram. The tailplane runs out of the beavertail's flanks under the nozzles.
const T = RP_TAIL.stab, FIN = RP_TAIL.fin, FIN_H = FIN[1].g;
const tailplane = foil('tailplane', T, { role: 'stab', paint: 'hull', nx: 10, lodNx: 4 });
const elevators = ctrlOn('elevator', T[0], T[1], 0.04, 0.9, 0.34);
const stabLights = mirror('tailplane lights', [tube('tailplane leading edge light', range(0.15, 1, 4).map((t) => { const q = foilPt(lerpSt(T[0], T[1], t), 0, 1); return [q[0] + 0.002, q[1], q[2]]; }), 0.0016, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE })]);
// A point on the fin in its own frame: `span` up from the root, `x` along the chord, on the outboard
// (+g) or inboard face, `o` proud of it.
const finAt = (span, x, up = 1, o = 0) => { const q = foilPt(lerpSt(FIN[0], FIN[1], span / FIN_H), x, up); return [q[0], q[2] + (up ? o : -o), q[1]]; };
const fins = mirror('fins', [group('fin', [
  foil('fin', FIN, { axis: 'g', role: 'fin', paint: 'hull', nx: 10, lodNx: 4 }),
  ctrlOn('rudder', FIN[0], FIN[1], 0.12, 0.95, 0.3, { axis: 'g', sh: 0.72 }),
  // The top fifth in the trim colour, both faces, over the fin's own skin.
  foil('fin tip', [{ ...lerpSt(FIN[0], FIN[1], 0.8), t: lerpSt(FIN[0], FIN[1], 0.8).t + 0.04 }, { ...FIN[1], t: FIN[1].t + 0.04 }], { axis: 'g', role: 'fin', paint: 'trim', nx: 8, lodNx: 3, lowerSh: 0.62 }),
  // A light line up the leading edge, a formation strip low on each face, and a dark cap on the top.
  tube('fin leading edge light', range(0.01, FIN_H - 0.004, 5).map((s) => { const q = finAt(s, 0); return [q[0] + 0.002, q[1], q[2]]; }), 0.0018, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  ...[1, 0].map((up) => tube('fin formation light', [finAt(0.05, 0.22, up, 0.0016), finAt(0.13, 0.3, up, 0.0016)], 0.0016, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE })),
  tube('fin cap', [finAt(FIN_H, 0.03, 1, -0.003), finAt(FIN_H, 0.95, 1, -0.003)], 0.003, { role: 'nacelle', paint: 'glare', sides: 6, caps: 1, ...FINE }),
], { xf: { t: RP_TAIL.at, r: [-RP_TAIL.cant, RP_TAIL.pitch, 0] } })]);

// ── Lamps and lenses ────────────────────────────────────────────────────────────
const tip = foilPt(W[3], 0.5, 1);
const lenses = [
  poly('starboard tip lamp', [{ role: 'window', sh: 1, tint: [46, 190, 78], p: [[tip[0] + 0.045, TIP_G + 0.003, tip[2] - 0.012], [tip[0] - 0.025, TIP_G + 0.003, tip[2] - 0.012], [tip[0] - 0.025, TIP_G + 0.003, tip[2] + 0.004], [tip[0] + 0.045, TIP_G + 0.003, tip[2] + 0.004]] }]),
  poly('port tip lamp', [{ role: 'window', sh: 1, tint: [200, 52, 48], p: [[tip[0] + 0.045, -TIP_G - 0.003, tip[2] + 0.004], [tip[0] - 0.025, -TIP_G - 0.003, tip[2] + 0.004], [tip[0] - 0.025, -TIP_G - 0.003, tip[2] - 0.012], [tip[0] + 0.045, -TIP_G - 0.003, tip[2] - 0.012]] }]),
  mirror('tip strobes', [poly('tip strobe', boxAt([tip[0] - 0.042, TIP_G + 0.004, tip[2] - 0.004], [0.014, 0.004, 0.008], { paint: 'strobe' }), FINE)]),
  D('belly beacon', -0.4, 0, 0.01, at(-0.4, -90)[2] - 0.012, at(-0.4, -90)[2] + 0.002, 'beacon', { bottom: { sh: 1 } }),
  D('spine beacon', -0.5, 0, 0.01, at(-0.5, 90)[2] - 0.002, at(-0.5, 90)[2] + 0.012, 'beacon', { top: { sh: 1 } }),
  tube('tail strobe', [[-1.06, 0, 0.064], [-1.079, 0, 0.064]], 0.006, { role: 'nacelle', paint: 'strobe', sh: 1, sides: 6, caps: 1, ...FINE }),
];
const lamps = [
  { at: P3([tip[0], -TIP_G - 0.01, tip[2]]), n: [0, -1, 0], rgb: '255,55,55', kind: 'steady' },
  { at: P3([tip[0], TIP_G + 0.01, tip[2]]), n: [0, 1, 0], rgb: '60,255,95', kind: 'steady' },
  { at: P3([tip[0] - 0.042, -TIP_G - 0.01, tip[2]]), n: [0, -1, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: P3([tip[0] - 0.042, TIP_G + 0.01, tip[2]]), n: [0, 1, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [-1.085, 0, 0.064], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: P3([-0.5, 0, at(-0.5, 90)[2] + 0.014]), n: [0, 0, 1], rgb: '255,90,70', kind: 'beacon' },
  { at: P3([-0.4, 0, at(-0.4, -90)[2] - 0.014]), n: [0, 0, -1], rgb: '255,90,70', kind: 'beacon' },
];

// ── LED accents along the body ──────────────────────────────────────────────────
const accents = mirror('body light lines', [
  tube('chine light', alongF(range(0.94, 0.64, 5), 0, 0.006), 0.0018, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  tube('formation light', alongF([0.26, 0.06], 30, 0.004), 0.0022, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  tube('formation light', alongF([-0.62, -0.82], 20, 0.004), 0.0022, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  // The deck's chine: a trim band along its edge from the tub to the beavertail, a light line in it.
  poly('trim stripe', patch([0.32, 0.2, 0.06, -0.08, -0.24, -0.45, -0.7, -0.9, -0.98], [-4, 4], { paint: 'trim', sh: 0.8 }, 0.0018), FINE),
  tube('deck edge light', alongF(range(0.08, -0.96, 13), 0, 0.0032), 0.0016, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  // A red band round the gun's end of the nose: the danger area, painted.
  poly('muzzle danger band', patch([0.94, 0.925], range(-80, 0, 6), { paint: 'hazard', sh: 0.7 }, 0.0022), FINE),
]);

// ── The coarse body, for range ──────────────────────────────────────────────────
const coarse = [
  fuselageFar, glassFar, enginesFar,
  tube('gun (far)', [[0.6, 0, GH], [1.0, 0, GH]], GR + BR, { role: 'nacelle', paint: 'gunmetal', sides: 6, ...COARSE }),
  mirror('gear pods (far)', [pod('gear pod (far)', 0.34, -0.085, [[0.35, 0.006], [0.25, 0.047], [-0.06, 0.035], [-0.15, 0.008]], { paint: 'hull', sides: 6 })].map((p) => ({ ...p, ...COARSE }))),
  group('wheels (far)', [mirror('main wheels (far)', [group('main leg (far)', [wheel('main wheel (far)', [0.24, 0.34, -0.238], 0.041, 0.018, 8), tube('main leg (far)', [[0.25, 0.34, -0.1], [0.24, 0.34, -0.21]], 0.008, { role: 'gear', sides: 4 })], { anim: MAIN_FOLD })]),
    group('nose leg (far)', [wheel('nose wheel (far)', [0.72, NG, -0.24], 0.039, 0.014, 8), tube('nose leg (far)', [[0.725, NG, -0.11], [0.72, NG, -0.22]], 0.006, { role: 'gear', sides: 4 })], { anim: NOSE_FOLD })], COARSE),
  group('drum (far)', [pod('drum (far)', 0, 0, [[0.5, 0.006, 0, 0.012], [0.4, 0.024, 0, 0.068], [0.12, 0.018, 0, 0.056], [0.06, 0.004, 0, 0.012]], { sides: 6, paint: 'belly' })], { xf: { t: [0, 0, DRUM_Z + 0.004] }, ...COARSE }),
];

const doc = {
  id: 'gunship_2076',
  kind: 'mesh',
  params: {
    name: 'REAPER 2076',
    note: 'CONCEPT, generated by scripts/shapes/concepts/reaper-2076.mjs (edit that, not this). The Reaper fifty years on: still the gun with a plane round it. A seven-barrel rotary cannon in the open under a chined nose, clamped, with a ribbed and slotted breech housing, gas diverters and a feed chute back to a drum fairing with a lit rounds strip; a frameless gold-tinted bubble on an armoured tub bolted down both flanks; a targeting turret, a refuelling receptacle, aperture windows; aft of the cockpit a broad flat engine deck with both turbofans buried in it, each breathing through a dorsal intake under a raked visor and blowing out of a flat slot nozzle over a beavertail; two fins canted hard out on the deck edges over a swept tailplane; a swept wing with raked tips, strakes, and the gear standing half out of leading-edge pods; a missile, a glide bomb and a targeting pod on pylons; light lines on the chines, the deck edges, the intakes and every leading edge. A variant of the gunship mesh, worn as the REAPER 2076 factory edition.',
    groundPitch: 0,
    hull: 'fuselage',
    navLamps: P3([tip[0], TIP_G + 0.006, tip[2]]),
    lamps,
    finish: 'matte',
    paints: {
      hull: { rgb: [62, 68, 58], livery: 'base' },
      trim: { rgb: [40, 43, 46], livery: 'trim' },
      belly: { rgb: [112, 118, 120], livery: 'fixed', mat: 'matte' },
      glare: { rgb: [30, 32, 34], livery: 'fixed', mat: 'matte' },
      armour: { rgb: [84, 88, 86], livery: 'fixed', mat: 'satin' },
      frame: { rgb: [24, 26, 28], livery: 'fixed', mat: 'gloss' },
      seam: { rgb: [36, 40, 34], livery: 'fixed', mat: 'matte' },
      carbon: { rgb: [32, 35, 38], livery: 'fixed', mat: 'satin' },
      gun: { rgb: [44, 44, 46], livery: 'fixed', mat: 'blued' },
      gunmetal: { rgb: [58, 60, 62], livery: 'fixed', mat: 'steel' },
      metal: { rgb: [150, 154, 160], livery: 'fixed', mat: 'bare' },
      gearLeg: { rgb: [60, 64, 66], livery: 'fixed', mat: 'satin' },
      rubber: { rgb: [24, 24, 26], livery: 'fixed', mat: 'rubber' },
      intake: { rgb: [12, 13, 14], livery: 'fixed', mat: 'matte' },
      exhaust: { rgb: [70, 64, 60], livery: 'fixed', mat: 'exhaust' },
      heat: { rgb: [196, 92, 44], livery: 'fixed', mat: 'matte' },
      hazard: { rgb: [150, 36, 30], livery: 'fixed', mat: 'satin' },
      warn: { rgb: [255, 150, 40], livery: 'fixed', mat: 'matte' },
      radome: { rgb: [88, 92, 90], livery: 'fixed', mat: 'satin' },
      store: { rgb: [74, 84, 64], livery: 'fixed' },
      led: { rgb: [120, 255, 200], livery: 'fixed', mat: 'matte' },
      beacon: { rgb: [235, 70, 56], livery: 'fixed', mat: 'gloss' },
      strobe: { rgb: [240, 244, 248], livery: 'fixed', mat: 'gloss' },
      interior: { rgb: [38, 42, 44], livery: 'fixed', mat: 'matte' },
      seat: { rgb: [62, 66, 60], livery: 'fixed', mat: 'satin' },
      screen: { rgb: [60, 200, 170], livery: 'fixed', mat: 'gloss' },
    },
    parts: [
      fuselage, windscreen, bubble, ...frames, ...tub, ...interior, chines, ...nose, gun, gunTrough, gasDiverters, ...drum,
      engines, ...spine, wing, strakes, flaps, flapsOut, ailerons, tipBands, wingDetail, gearPods, noseGear, stores,
      tailplane, elevators, stabLights, fins, ...lenses, accents,
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
