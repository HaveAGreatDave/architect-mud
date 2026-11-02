// The Leviathan 2076 concept: writes content/vehicle_models/mesh_heavy_2076.json.
//
//   node scripts/shapes/concepts/leviathan-2076.mjs
//   then: npm run vehicles:bake
//
// The Leviathan fifty years on, after JetZero's blended wing body and Radia's WindRunner outsize
// freighter: the An-124's tube and high wing gone into one lifting body as wide as the hold, thinning
// out into swept outer wings with raked winglets; four hydrogen turbofans riding on the upper aft
// deck where the body shields the ground from their noise, between two canted fins; the liquid
// hydrogen in insulated tanks under the crown, with boil-off masts on the fin tips. The flight deck
// is a glazed cab standing proud on the nose, and the cargo visor is kept: the whole nose, cab and
// crew with it, swings up on the noseVisor channel by the ancestor's own angle, and a ramp walks
// down out of a hold you could park a wind turbine blade in. It is a variant of the heavy mesh
// (mesh_heavy.json `variants`), worn as the Leviathan 2076 factory edition.
//
// ⚠ THIS OVERWRITES THE JSON. Edit this file, not the mesh in the Modelshop.
//
// Two bodies in one file. Everything fine is `minDetail: 1`; a coarse body with `maxDetail: 0`
// stands in at range. The wings and fins are foil() groups, which carry their own two LODs. The
// visor is a group on the noseVisor channel at both detail levels, so a far contact parked with its
// nose up still has its nose up.
//
// Frame: f fore, g right, h up, in the Leviathan's units (f -1.12..1.08, span ±1.05, wheels on the
// ground at h -0.285), so it sits on the ground as the An-124 does. Angles on a section are lib.mjs's:
// 0 = right waterline, +90 = crown, -90 = keel.
import { writeFileSync } from 'node:fs';
import { R, P3, skin, loft, pod, foil, foilPt, lerpSt, ctrlOn, tube, mirror, group, poly as rawPoly, quad, cone, wheel, strut, faired, DEG } from '../fw-meshes/lib.mjs';
const { formatMesh, validateMesh, compileMesh } = await import('../../../client/shared/vehicle-mesh.js');
const { LEV76_BODY, LEV76_BODY_APEX, LEV76_BODY_TE, LEV76_CAB, LEV76_CAB_APEX, LEV76_CAB_TAIL, LEV76_GLASS, LEV76_VISOR, LEV76_HOLD, LEV76_INSIDE, levBodySurface, levBodySection } = await import('../../../client/shared/cabin-leviathan-2076.js');

const FINE = { minDetail: 1 }, COARSE = { maxDetail: 0 };
// Every poly face needs a role; trim and fittings are 'nacelle' unless they say otherwise.
const poly = (name, faces, extra) => rawPoly(name, faces.map((f) => ({ role: 'nacelle', ...f })), extra);
const GLASS = [38, 60, 82];
const lerp = (a, b, t) => a + (b - a) * t;
const range = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));
const P3s = (a) => a.map(P3);
const BODY = LEV76_BODY, CAB = LEV76_CAB, CUT = LEV76_VISOR.cut, TE = LEV76_BODY_TE;
const atB = (f, a, o = 0) => skin(BODY, f, a * DEG, o);
const atC = (f, a, o = 0) => skin(CAB, f, a * DEG, o);
const surf = (f, g, up = true) => levBodySurface(f, g, up);
const mirA = (s) => (a) => (s ? 180 - a : a);

// A curved patch of skin as a grid of quads, `o` proud of the hull: glass, panels, trim.
const patchOn = (at) => (fs, as, extra, o = 0.0022) => {
  const out = [];
  for (let i = 0; i < fs.length - 1; i++) for (let j = 0; j < as.length - 1; j++) {
    out.push(quad(at(fs[i + 1], as[j], o), at(fs[i], as[j], o), at(fs[i], as[j + 1], o), at(fs[i + 1], as[j + 1], o), extra));
  }
  return out;
};
const patchB = patchOn(atB), patchC = patchOn(atC);
const alongOn = (at) => (fs, a, o = 0.004) => fs.map((f) => at(f, a, o));
const roundOn = (at) => (f, as, o = 0.004) => as.map((a) => at(f, a, o));
const alongB = alongOn(atB), roundB = roundOn(atB), alongC = alongOn(atC), roundC = roundOn(atC);
// A rectangle's outline in (f, a) on a skin, as one closed run of points.
const outline = (at, f0, f1, a0, a1, o, n = 6) => [
  ...range(a0, a1, n).map((a) => at(f0, a, o)), ...range(f0, f1, n).slice(1).map((f) => at(f, a1, o)),
  ...range(a1, a0, n).slice(1).map((a) => at(f1, a, o)), ...range(f1, f0, n).slice(1).map((f) => at(f, a0, o))];
const SEAM = (name, pts, extra = {}) => tube(name, pts, 0.0018, { role: 'nacelle', paint: 'seam', sh: 0.55, sides: 4, ...FINE, ...extra });
const FR = (name, pts, r = 0.0032) => tube(name, pts, r, { role: 'nacelle', paint: 'frame', sh: 0.5, sides: 5, ...FINE });

// ── The centrebody ──────────────────────────────────────────────────────────────
// Two lofts, split at the visor joint: the nose rides the visor, the rest stays. The underside is the
// fixed grey from about -165° to -15° (k 31..52 of 56).
const NB = 56;
const BELLY_K = Array.from({ length: 22 }, (_, i) => 31 + i);
const foreSt = BODY.filter((s) => s.f >= CUT - 1e-9), aftSt = BODY.filter((s) => s.f <= CUT + 1e-9);
const bodyFore = loft('centrebody nose', NB, foreSt, {
  ...FINE, paint: 'hull', capFore: { kind: 'apex', at: LEV76_BODY_APEX, paint: 'hull' },
  regions: [{ at: foreSt.map((s) => s.f), k: BELLY_K, paint: 'belly' }],
});
const bodyAft = loft('fuselage', NB, aftSt, {
  ...FINE, paint: 'hull', capAft: { kind: 'flat', sh: 0.5, paint: 'belly' },
  note: 'The centrebody aft of the visor joint: the hold, the hydrogen tanks, the engine deck. Detail is laid a hair proud of it.',
  regions: [{ at: aftSt.map((s) => s.f), k: BELLY_K, paint: 'belly' }],
});

// ── The flight deck cab ─────────────────────────────────────────────────────────
const NC = 40;
const cab = loft('flight deck cab', NC, CAB, {
  ...FINE, paint: 'hull', capFore: { kind: 'apex', at: LEV76_CAB_APEX, role: 'glass', tint: GLASS }, capAft: { kind: 'apex', at: LEV76_CAB_TAIL },
  shade: { base: 0.6, amp: 0.36 },
});
const W = LEV76_GLASS.windscreen, SW = LEV76_GLASS.side;
const WS_F = range(W.f[0], W.f[1], 7);
const windscreen = poly('windscreen', patchC(WS_F, range(W.a[0], W.a[1], 42), { role: 'glass', tint: GLASS }), FINE);
const sideGlass = mirror('side windows', [poly('side window', patchC(range(SW.f[0], SW.f[1], 3), range(SW.a[0], SW.a[1], 5), { role: 'glass', tint: GLASS }), FINE)]);
const cabFrames = [
  FR('windscreen aft arch', roundC(W.f[0], range(W.a[0], W.a[1], 30), 0.0034), 0.0042),
  FR('windscreen fore edge', roundC(W.f[1], range(W.a[0], W.a[1], 24), 0.0034), 0.0036),
  FR('windscreen sill (right)', alongC(WS_F, W.a[0], 0.0034)),
  FR('windscreen sill (left)', alongC(WS_F, W.a[1], 0.0034)),
  ...LEV76_GLASS.posts.map((a, i) => FR('windscreen post ' + (i + 1), alongC(WS_F, a, 0.0035), a === 90 ? 0.003 : 0.0038)),
  ...[0, 1].map((s) => { const A = mirA(s); return FR('side window frame (' + (s ? 'left' : 'right') + ')', outline(atC, SW.f[0], SW.f[1], A(SW.a[0]), A(SW.a[1]), 0.0034, 4), 0.003); }),
  // The cab's brow: a dark band over the windscreen where the heads-up projectors live, and an LED
  // line along its lower edge.
  poly('cab brow', patchC(range(0.88, W.f[0] - 0.003, 3), range(62, 118, 8), { paint: 'glare' }, 0.0018), FINE),
  tube('cab LED line (right)', alongC(range(0.8, 0.938, 6), 4, 0.003), 0.0018, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  tube('cab LED line (left)', alongC(range(0.8, 0.938, 6), 176, 0.003), 0.0018, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  // Seams round the cab's escape hatch on the crown, and its handle.
  SEAM('escape hatch seam', outline(atC, 0.85, 0.88, 76, 104, 0.0022, 4)),
  tube('escape hatch handle', [atC(0.859, 90, 0.004), atC(0.871, 90, 0.004)], 0.0016, { role: 'nacelle', paint: 'metal', sides: 4, ...FINE }),
];

// ── The room behind the glass ───────────────────────────────────────────────────
// Seen through the windscreen from outside: two seats, the deck, its light line. The seated cockpit is
// interior-leviathan-2076.js.
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
const FH = LEV76_INSIDE.floorH, SG = LEV76_INSIDE.seatG;
const room = [];
for (const g of [SG, -SG]) {
  room.push(poly('seat', [
    ...slab([0.905, g, FH + 0.014], [0.016, 0.016, 0.004], 4, { paint: 'seat' }),
    ...slab([0.896, g, FH + 0.03], [0.004, 0.016, 0.028], -14, { paint: 'seat' }),
  ], FINE));
}
room.push(poly('flight deck floor', [quad([0.99, -0.05, FH], [0.99, 0.05, FH], [LEV76_INSIDE.bulkheadF, 0.05, FH], [LEV76_INSIDE.bulkheadF, -0.05, FH], { paint: 'interior', sh: 0.45 })], FINE));
room.push(poly('glass deck', [...slab([0.965, 0, FH + 0.03], [0.006, 0.1, 0.012], -24, { paint: 'interior' }), ...slab([0.962, 0, FH + 0.031], [0.002, 0.094, 0.009], -24, { paint: 'screen' })], FINE));
room.push(poly('deck light line', slab([0.97, 0, FH + 0.037], [0.003, 0.1, 0.0016], 0, { paint: 'led' }), FINE));
room.push(poly('bulkhead', [quad([LEV76_INSIDE.bulkheadF, -0.07, FH], [LEV76_INSIDE.bulkheadF, 0.07, FH], [LEV76_INSIDE.bulkheadF, 0.07, 0.15], [LEV76_INSIDE.bulkheadF, -0.07, 0.15], { paint: 'interior', sh: 0.5 })], FINE));

// ── The nose: sensors, the crew door, the trim, the joint ──────────────────────
const noseBits = [
  // The chin sensor window: lidar and cameras behind one smoked strip across the nose, under the cab.
  mirror('chin sensor windows', [poly('chin sensor window', patchB(range(1.03, 1.048, 2), range(-40, -22, 4), { role: 'glass', tint: [30, 40, 50] }, 0.002), FINE)]),
  mirror('chin sensor window (left)', []),
  poly('lidar strip', patchB([1.058, 1.052], range(-150, -30, 16), { role: 'glass', tint: [24, 30, 36] }, 0.002), FINE),
  // Pitot and static probes either side of the cab, angle-of-attack vanes below them.
  mirror('nose probes', [
    tube('pitot', [atB(0.99, 30, 0), [1.01, 0.12, 0.05], [1.035, 0.12, 0.05]], 0.0022, { role: 'gear', paint: 'metal', sh: 0.85, sides: 5, ...FINE }),
    { kind: 'panel', name: 'AoA vane', role: 'fin', sh: 0.7, th: 0.002, paint: 'metal', ...FINE, c: P3s([atB(0.95, 22, 0.002), atB(0.935, 22, 0.002), [0.93, 0.19, 0.03], [0.942, 0.188, 0.033]]) },
    { kind: 'drum', name: 'static port', f: 0.9, g: 0.0, r: 0.006, n: 8, z: [0, 0], role: 'nacelle', paint: 'seam', sh: { base: 0.4 }, ...FINE, note: 'placeholder, replaced below' },
  ]),
  // The supercargo deck behind the flight deck: a row of small square windows down each side of the
  // nose, the only thing on her that is the size of a person.
  mirror('supercargo windows', [poly('supercargo windows', range(0.84, 0.66, 6).flatMap((f) => patchB([f, f - 0.012], [26, 30.5], { role: 'glass', tint: GLASS }, 0.0024)), FINE)]),
  // The crew door, low on the nose's left flank, with a handle and a lit status strip.
  SEAM('crew door seam', outline(atB, 0.7, 0.76, 150, 170, 0.0022, 5)),
  tube('crew door handle', [atB(0.712, 160, 0.004), atB(0.726, 160, 0.004)], 0.0016, { role: 'nacelle', paint: 'metal', sides: 4, ...FINE }),
  tube('crew door lamp', [atB(0.765, 152, 0.003), atB(0.765, 168, 0.003)], 0.0016, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
];
// The static port drum stands on h; a small flush disc on the flank is a patch instead.
noseBits[3].parts[2] = poly('static port', patchB([0.905, 0.895], [10, 14], { paint: 'seam' }, 0.0022), FINE);
noseBits.splice(1, 1);
// The cheatline: a trim band along the nose's flanks and on along the hold, split at the joint so
// the forward half rides the visor; an LED line runs under it.
const TRIM_A = [9, 15];
const trimF = [0.995, 0.97, 0.94, 0.9, 0.86, 0.82, 0.76, 0.7, 0.65, CUT];
const trimAft = [CUT, 0.52, 0.44, 0.36, 0.28, 0.2, 0.12, 0.04, -0.06, -0.16, -0.26];
const trimFore = mirror('cheatline (nose)', [poly('cheatline', patchB(trimF, TRIM_A, { paint: 'trim' }, 0.0018), FINE), tube('LED line', alongB(trimF, 6, 0.003), 0.0018, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE })]);
const trimBody = mirror('cheatline (body)', [poly('cheatline', patchB(trimAft, TRIM_A, { paint: 'trim' }, 0.0018), FINE), tube('LED line', alongB(trimAft, 6, 0.003), 0.0018, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE })]);

// The visor joint, a hairline all the way round, and the visor's own aft face, seen only when open.
const joint = [];
for (let k = 0; k < NB; k++) {
  const a0 = k / NB * 360, a1 = (k + 1) / NB * 360;
  joint.push(quad(atB(CUT - 0.002, a0, 0.0012), atB(CUT - 0.002, a1, 0.0012), atB(CUT + 0.002, a1, 0.0012), atB(CUT + 0.002, a0, 0.0012), { role: 'body', paint: 'seam', sh: 0.42 }));
}
const sCut = levBodySection(CUT);
const ringAt = (f, o) => Array.from({ length: NB }, (_, k) => atB(f, k / NB * 360, o));
const rc = ringAt(CUT + 0.001, -0.004);
const visorFace = [];
for (let k = 0; k < NB; k++) visorFace.push({ role: 'interior', paint: 'bulk', sh: 0.42, p: [[CUT + 0.001, 0, sCut.cz], rc[(k + 1) % NB], rc[k]] });
// The visor's inner frames: three ribs standing on its aft face, a seal round the rim.
const visorRibs = [
  tube('visor seal', [...rc, rc[0]].map((q) => [q[0] + 0.002, q[1] * 0.985, sCut.cz + (q[2] - sCut.cz) * 0.985]), 0.004, { role: 'interior', paint: 'seal', sides: 4, ...FINE }),
  ...[-0.12, 0, 0.12].map((g) => tube('visor rib', [[CUT + 0.003, g, surf(CUT, g, false) + 0.01], [CUT + 0.003, g, surf(CUT, g) - 0.01]], 0.005, { role: 'interior', paint: 'holdRib', sides: 4, ...FINE })),
];

const visor = group('cargo visor', [
  bodyFore, cab, windscreen, sideGlass, ...cabFrames, ...room, ...noseBits, trimFore,
  poly('visor seam', joint, FINE),
  poly('visor bulkhead', visorFace, { when: 'noseVisor', ...FINE }),
  ...visorRibs.map((p) => ({ ...p, when: undefined })),
  // At range the nose is one coarse loft and the cab another, on the same hinge.
  loft('centrebody nose (far)', 16, foreSt.filter((_, i) => i % 2 === 0 || i === foreSt.length - 1), { ...COARSE, paint: 'hull', capFore: { kind: 'apex', at: LEV76_BODY_APEX } }),
  loft('cab (far)', 12, CAB.filter((_, i) => i % 2 === 0 || i === CAB.length - 1), {
    ...COARSE, paint: 'hull', capFore: { kind: 'apex', at: LEV76_CAB_APEX }, capAft: { kind: 'apex', at: LEV76_CAB_TAIL },
    regions: [{ at: [1.05, 1.005], k: [1, 2, 3, 4, 5], role: 'glass', tint: GLASS }],
  }),
], { anim: { ch: 'noseVisor', pivot: P3(LEV76_VISOR.pivot), axis: [0, 1, 0], ang: [0, R(LEV76_VISOR.swing, 3)], def: 0 } });
for (const p of visor.parts) if (p.when === undefined) delete p.when;

// Hinge brackets on the crown: external structure you only see once the joint is broken open.
const brackets = mirror('visor hinges', [0.06, 0.16].map((g) => poly('hinge bracket', [
  quad([CUT - 0.05, g, surf(CUT - 0.05, g) + 0.002], [CUT + 0.012, g, surf(CUT, g) + 0.016], [CUT + 0.012, g + 0.012, surf(CUT, g) + 0.016], [CUT - 0.05, g + 0.012, surf(CUT - 0.05, g) + 0.002], { role: 'strut', paint: 'metal', sh: 0.6 }),
], { when: 'noseVisor', ...FINE })));

// ── The hold behind the visor, and the ramp ─────────────────────────────────────
const HD = LEV76_HOLD, hw = HD.halfW, fl = HD.floor, ce = HD.ceil, f0 = HD.f0, f1 = HD.f1;
const hold = [
  poly('cargo hold', [
    quad([f0, -hw, fl], [f0, hw, fl], [f1, hw, fl], [f1, -hw, fl], { role: 'interior', paint: 'holdFloor', sh: 0.55 }),
    quad([f1, -hw, ce], [f1, hw, ce], [f0, hw, ce], [f0, -hw, ce], { role: 'interior', paint: 'hold', sh: 0.4 }),
    quad([f0, hw, fl], [f0, hw, ce], [f1, hw, ce], [f1, hw, fl], { role: 'interior', paint: 'hold', sh: 0.5 }),
    quad([f1, -hw, fl], [f1, -hw, ce], [f0, -hw, ce], [f0, -hw, fl], { role: 'interior', paint: 'hold', sh: 0.5 }),
    quad([f1, hw, fl], [f1, hw, ce], [f1, -hw, ce], [f1, -hw, fl], { role: 'interior', paint: 'bulk', sh: 0.3 }),
  ], FINE),
  // Frames down the walls and over the roof every few metres, roller tracks and a lit line on the floor.
  poly('hold frames', range(f0 - 0.06, f1 + 0.04, 9).flatMap((f) => [
    quad([f + 0.008, hw - 0.012, fl], [f + 0.008, hw - 0.012, ce], [f - 0.008, hw - 0.012, ce], [f - 0.008, hw - 0.012, fl], { role: 'interior', paint: 'holdRib', sh: 0.45 }),
    quad([f - 0.008, -hw + 0.012, fl], [f - 0.008, -hw + 0.012, ce], [f + 0.008, -hw + 0.012, ce], [f + 0.008, -hw + 0.012, fl], { role: 'interior', paint: 'holdRib', sh: 0.45 }),
    quad([f - 0.008, -hw, ce - 0.012], [f - 0.008, hw, ce - 0.012], [f + 0.008, hw, ce - 0.012], [f + 0.008, -hw, ce - 0.012], { role: 'interior', paint: 'holdRib', sh: 0.35 }),
  ]), FINE),
  poly('roller tracks', [-0.16, -0.08, 0.08, 0.16].map((g) => quad([f0, g - 0.006, fl + 0.002], [f0, g + 0.006, fl + 0.002], [f1, g + 0.006, fl + 0.002], [f1, g - 0.006, fl + 0.002], { role: 'interior', paint: 'metal', sh: 0.7 })), FINE),
  poly('hold floor line', [quad([f0, -0.003, fl + 0.003], [f0, 0.003, fl + 0.003], [f1, 0.003, fl + 0.003], [f1, -0.003, fl + 0.003], { role: 'interior', paint: 'led', sh: 1 })], FINE),
  poly('hold roof lamps', range(f0 - 0.1, f1 + 0.1, 5).map((f) => quad([f + 0.02, -0.04, ce - 0.004], [f + 0.02, 0.04, ce - 0.004], [f - 0.02, 0.04, ce - 0.004], [f - 0.02, -0.04, ce - 0.004], { role: 'interior', paint: 'lamp', sh: 1 })), FINE),
];
// The mouth: the joint's face between the body's section and the hold's box, seen only when open.
{
  const ring = ringAt(CUT - 0.002, -0.004), cz = sCut.cz, mouth = [];
  const toBox = (q) => {
    const dg = q[1], dh = q[2] - cz, kg = dg ? hw / Math.abs(dg) : Infinity, kh = dh > 0 ? (ce - cz) / dh : dh < 0 ? (fl - cz) / dh : Infinity;
    const k = Math.min(kg, kh, 1);
    return [CUT - 0.002, dg * k, cz + dh * k];
  };
  for (let k = 0; k < NB; k++) {
    const a = ring[k], b = ring[(k + 1) % NB];
    mouth.push({ role: 'interior', paint: 'bulk', sh: 0.38, p: [a, toBox(a), toBox(b), b] });
  }
  hold.push(poly('hold mouth', mouth, FINE));
}
const rampHinge = [CUT, 0, fl], rw = HD.rampHalfW, [rf, rz] = HD.rampFoot;
const ramp = group('nose ramp', [
  poly('ramp plate', [
    quad([CUT, -rw, fl], [CUT, rw, fl], [rf, rw, rz], [rf, -rw, rz], { role: 'ramp', paint: 'holdFloor', sh: 0.7 }),
    quad([rf, -rw, rz - 0.006], [rf, rw, rz - 0.006], [CUT, rw, fl - 0.006], [CUT, -rw, fl - 0.006], { role: 'ramp', paint: 'belly', sh: 0.45 }),
    // Treads across it, and the toes that meet the ground.
    ...range(0.06, 0.94, 10).map((t) => { const f = lerp(CUT, rf, t), z = lerp(fl, rz, t) + 0.002; return quad([f + 0.006, -rw + 0.01, z], [f + 0.006, rw - 0.01, z], [f - 0.006, rw - 0.01, z], [f - 0.006, -rw + 0.01, z], { role: 'ramp', paint: 'metal', sh: 0.75 }); }),
    quad([rf, -rw, rz], [rf, rw, rz], [rf + 0.03, rw, rz], [rf + 0.03, -rw, rz], { role: 'ramp', paint: 'metal', sh: 0.65 }),
  ], FINE),
  mirror('ramp rails', [tube('ramp rail', [[CUT, rw, fl + 0.02], [rf, rw, rz + 0.02]], 0.004, { role: 'ramp', paint: 'trim', sides: 5, ...FINE }), tube('ramp jack', [[CUT + 0.02, rw - 0.012, fl + 0.03], [CUT + 0.2, rw - 0.012, fl - 0.05]], 0.006, { role: 'ramp', paint: 'metal', sides: 6, ...FINE })]),
], { anim: { ch: 'noseVisor', pivot: P3(rampHinge), axis: [0, 1, 0], ang: [-105, 0], span: [0.58, 1], def: 0 } });

// ── Skin detail on the centrebody: seams, hatches, the hydrogen bays ────────────
const bodyDetail = [
  // Chordwise seams across the crown, where the frames are.
  ...[0.46, 0.3, 0.12, -0.06, -0.24, -0.42, -0.6, -0.76].map((f) => SEAM('frame seam', roundB(f, range(18, 162, 24), 0.0016))),
  // Spanwise seams along the crown either side of the spine.
  ...[64, 116].map((a) => SEAM('stringer seam', alongB(range(CUT - 0.01, -0.84, 14), a, 0.0016))),
  // The liquid hydrogen tanks lie under the crown aft of the hold: two long access panels over them,
  // frost-pale, edged, with a fill port and a boil-off vent each.
  mirror('hydrogen tank bays', [
    poly('tank bay panel', patchB(range(-0.02, -0.4, 6), range(70, 84, 2), { paint: 'cryo' }, 0.0018), FINE),
    SEAM('tank bay seam', outline(atB, -0.4, -0.02, 70, 84, 0.0022, 6)),
    ...[-0.08, -0.34].map((f) => tube('tank bay latch', [atB(f, 72, 0.004), atB(f, 82, 0.004)], 0.0016, { role: 'nacelle', paint: 'metal', sides: 4, ...FINE })),
  ]),
  // The fill and vent ports on the left flank, aft of the hold, behind a door, and a frost-white
  // ground connector beside it.
  SEAM('hydrogen servicing door', outline(atB, -0.42, -0.34, 158, 172, 0.0022, 4)),
  poly('hydrogen servicing door', patchB([-0.34, -0.42], [158, 172], { paint: 'cryo' }, 0.0019), FINE),
  tube('servicing door lamp', [atB(-0.33, 158, 0.003), atB(-0.33, 172, 0.003)], 0.0016, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  // Big belly access panels under the hold, and the gear sponson doors are their own parts below.
  ...[[0.42, 0.3], [0.16, 0.04], [-0.42, -0.56]].map(([a, b]) => SEAM('belly panel seam', outline(atB, b, a, -112, -68, 0.0022, 5))),
  // Flush NACA intakes for the hold's air on the crown sides.
  mirror('hold vents', [poly('hold vent', [0.36, 0.2].flatMap((f) => patchB([f, f - 0.03], [42, 45], { paint: 'seam' }, 0.0022)), FINE)]),
  // Walkway lines on the crown, as an engineer would want them painted.
  mirror('walkway', [poly('walkway line', patchB(range(0.5, -0.2, 7), [82, 83.2], { paint: 'seam' }, 0.0017), FINE)]),
];

// ── The outer wings ─────────────────────────────────────────────────────────────
// From the centrebody's thin edge out to raked winglets: a strake-like inner panel and a swept outer
// panel, both a little dihedral.
const OW = [
  { g: 0.42, le: 0.28, te: -0.86, h: 0.02, t: 0.78 },
  { g: 0.62, le: 0.0, te: -0.74, h: 0.034, t: 0.88 },
  { g: 1.0, le: -0.35, te: -0.62, h: 0.074, t: 0.84 },
  { g: 1.03, le: -0.372, te: -0.618, h: 0.077, t: 0.6 },
];
const outerWing = foil('outer wing', OW, { nx: 13, paint: 'hull', lowerSh: 0.5, bands: [{ x0: 0, x1: 0.05, paint: 'boot' }] });
const flapsIn = ctrlOn('flap', OW[0], OW[1], 0.25, 1, 0.24);
const flapsOut = ctrlOn('flap', OW[1], OW[2], 0, 0.36, 0.3);
const ailerons = ctrlOn('aileron', OW[1], OW[2], 0.4, 0.96, 0.3);
const wingAt = (g, x, up = 1) => {
  for (let i = 0; i < OW.length - 1; i++) if (g <= OW[i + 1].g + 1e-9) return foilPt(lerpSt(OW[i], OW[i + 1], (g - OW[i].g) / (OW[i + 1].g - OW[i].g)), x, up);
  return foilPt(OW[OW.length - 1], x, up);
};
// The centrebody's trailing edge: elevons across it, on a thin shelf the loft's edge runs into.
const CT = [{ g: 0, le: -0.82, te: -0.94, h: 0.022, t: 0.32 }, { g: 0.44, le: -0.82, te: -0.94, h: 0.021, t: 0.32 }];
const tePanel = foil('trailing edge shelf', CT, { nx: 7, paint: 'hull', lowerSh: 0.5, tip: true });
const elevonsIn = ctrlOn('elevator', CT[0], CT[1], 0.02, 0.46, 0.55);
const elevonsOut = ctrlOn('elevator', CT[0], CT[1], 0.5, 0.98, 0.55);
// Flap track fairings under the outer wing's trailing edge, and vortex generators near the tips.
const tracks = mirror('flap track fairings', [0.5, 0.66, 0.8].map((g) => {
  const lo = wingAt(g, 0.66, 0);
  return group('flap track', [pod('canoe', 0, 0, [[0.05, 0.003], [0.03, 0.01], [-0.06, 0.011], [-0.13, 0.008], [-0.17, 0.002]], { sides: 8, paint: 'hull', shade: { base: 0.55, amp: 0.3 } })],
    { xf: { t: [R(lo[0]), g, R(lo[2] - 0.005)] }, ...FINE });
}));
const vgs = mirror('vortex generators', [poly('vortex generators', range(0.66, 0.98, 16).flatMap((g, i) => {
  const p = wingAt(g, 0.12), tq = (i % 2 ? 1 : -1) * 0.004;
  const a = [p[0] + 0.007, g - tq, p[2] + 0.001], b = [p[0] - 0.007, g + tq, p[2] + 0.001];
  return [quad(a, b, [b[0], b[1], b[2] + 0.008], [a[0] + 0.003, a[1], a[2] + 0.004], { paint: 'metal', sh: 0.8 }),
    quad([a[0] + 0.003, a[1], a[2] + 0.004], [b[0], b[1], b[2] + 0.008], b, a, { paint: 'metal', sh: 0.6 })];
}), FINE)]);
// Raked winglets in the trim colour, the nav lens on the leading edge, a strobe at the trailing tip.
const WL = P3s([[-0.36, 1.03, 0.078], [-0.5, 1.07, 0.2], [-0.58, 1.07, 0.2], [-0.615, 1.03, 0.078]]);
const winglets = mirror('winglets', [
  { kind: 'panel', name: 'winglet', role: 'fin', sh: 0.82, th: 0.006, paint: 'trim', ...FINE, c: WL },
  { kind: 'panel', name: 'winglet (far)', role: 'fin', sh: 0.82, th: 0.01, paint: 'trim', ...COARSE, c: WL },
  group('nav lens', [pod('nav lens', 0, 0, [[0.012, 0.003], [0.004, 0.007], [-0.018, 0.008], [-0.03, 0.005]], { sides: 8, paint: 'navR', role: 'glass', capFore: { kind: 'apex', at: [0.016, 0, 0] } })], { xf: { t: [-0.37, 1.032, 0.08] }, ...FINE }),
  tube('tip strobe', [[-0.6, 1.071, 0.2], [-0.62, 1.071, 0.2]], 0.004, { role: 'nacelle', paint: 'strobe', sh: 1, sides: 6, caps: 1, ...FINE }),
  tube('winglet LED edge', [[-0.37, 1.033, 0.082], [-0.5, 1.072, 0.203]], 0.002, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
]);

// ── Four hydrogen turbofans on the upper aft deck ───────────────────────────────
// High-bypass fans burning hydrogen, each on a short pylon above the deck so the body hides their
// fan noise from the ground, the inner pair a step higher than the outer as the crown falls away.
const ENG_G = [0.15, 0.36], IN_F = -0.24, EL = 0.4, ER = 0.058, EDECK = -0.45;
const engH = (g) => R(surf(EDECK, g) + 0.084);
function engine(g, i) {
  const h = engH(g), r = ER, fI = IN_F;
  const parts = [
    pod('fan cowl', 0, 0, [[fI, r * 0.9], [fI - 0.008, r * 1.0], [fI - 0.03, r * 1.05], [fI - 0.1, r * 1.07], [fI - 0.2, r * 1.03], [fI - 0.27, r * 0.92], [fI - 0.32, r * 0.78]], { sides: 20, paint: 'cowl', shade: { base: 0.6, amp: 0.36 } }),
    pod('intake lip', 0, 0, [[fI + 0.004, r * 0.86], [fI + 0.001, r * 0.93], [fI - 0.006, r * 0.95]], { sides: 20, paint: 'metal' }),
    pod('intake duct', 0, 0, [[fI + 0.002, r * 0.86], [fI - 0.03, r * 0.84]], { sides: 16, paint: 'intake' }),
    cone('fan face', fI - 0.034, 0, 0, r * 0.84, [fI - 0.04, 0, 0], { paint: 'fan', n: 16, shade: { base: 0.3, amp: 0.08 } }),
    cone('spinner', fI - 0.034, 0, 0, r * 0.3, [fI - 0.004, 0, 0], { paint: 'spinner', n: 12 }),
    pod('core cowl', 0, 0, [[fI - 0.3, r * 0.74], [fI - 0.34, r * 0.66], [fI - EL, r * 0.52]], { sides: 16, paint: 'metal' }),
    pod('nozzle', 0, 0, [[fI - EL, r * 0.52], [fI - EL - 0.004, r * 0.5]], { sides: 16, paint: 'exhaust' }),
    cone('exhaust plug', fI - EL, 0, 0, r * 0.34, [fI - EL - 0.06, 0, 0], { paint: 'exhaust', n: 12 }),
    // The status ring, lit, behind the lip; the reverser's seam; the cowl's hinge line on top.
    pod('status ring', 0, 0, [[fI - 0.05, r * 1.058], [fI - 0.056, r * 1.058]], { sides: 20, paint: 'led' }),
    pod('reverser seam', 0, 0, [[fI - 0.2, r * 1.034], [fI - 0.204, r * 1.034]], { sides: 20, paint: 'seam' }),
    pod('lip trim', 0, 0, [[fI - 0.008, r * 1.002], [fI - 0.02, r * 1.034]], { sides: 20, paint: 'trim' }),
  ];
  // The fan: twenty-two wide-chord blades, twisted, standing in the face.
  const blades = [];
  for (let k = 0; k < 22; k++) {
    const t = (k / 22) * Math.PI * 2 + i * 0.13, dt = 0.12;
    const P = (rr, a, df) => [fI - 0.03 + df, Math.cos(a) * rr, Math.sin(a) * rr];
    blades.push(quad(P(r * 0.3, t, 0.004), P(r * 0.82, t + 0.05, 0.002), P(r * 0.82, t + dt + 0.05, -0.006), P(r * 0.3, t + dt * 0.6, -0.003), { paint: 'blade', sh: 0.55 + 0.25 * ((k % 2)) }));
  }
  parts.push(poly('fan blades', blades));
  // Chevrons round the nozzle: a serrated lip for quiet.
  const chev = [];
  for (let k = 0; k < 12; k++) {
    const a0 = (k / 12) * Math.PI * 2, a1 = ((k + 1) / 12) * Math.PI * 2, am = (a0 + a1) / 2, rr = r * 0.78, fo = fI - 0.32;
    chev.push({ paint: 'metal', sh: 0.62, p: [[fo, Math.cos(a0) * rr, Math.sin(a0) * rr], [fo - 0.026, Math.cos(am) * rr * 0.9, Math.sin(am) * rr * 0.9], [fo, Math.cos(a1) * rr, Math.sin(a1) * rr]] });
  }
  parts.push(poly('chevrons', chev));
  // The pylon: a blade from the nacelle's belly down into the deck, and a fairing over its root.
  const dz = R(surf(fI - 0.2, g) - h - 0.004);
  parts.push({ kind: 'blade', name: 'pylon', paint: 'hull', role: 'nacelle', t: 0.011, sh: [0.78, 0.6], outline: [[fI - 0.06, -r * 0.8], [fI - 0.3, -r * 0.7], [fI - 0.34, dz], [fI - 0.02, dz]] });
  parts.push(pod('pylon root fairing', 0, 0, [[fI - 0.01, 0.003], [fI - 0.04, 0.016], [fI - 0.3, 0.016], [fI - 0.36, 0.003]], { sides: 8, paint: 'hull' }));
  parts[parts.length - 1] = group('pylon root fairing', [parts[parts.length - 1]], { xf: { t: [0, 0, dz] } });
  return group('engine ' + (i + 1), parts, { xf: { t: [0, g, h] }, ...FINE });
}
const engines = mirror('engines', ENG_G.map(engine));

// ── Twin canted fins ────────────────────────────────────────────────────────────
// Raked out 20°, on the outer wing's root at the trailing edge, in the trim colour with a white tip
// cap. The hydrogen boil-off masts stand on their tips, where a vent plume is out of everyone's way.
const FIN_G = 0.56, FIN_H = R(wingAt(FIN_G, 0.5)[2] + 0.006);
const FN = [
  { g: 0, le: -0.5, te: -0.86, h: 0, t: 1.1 },
  { g: 0.33, le: -0.86, te: -1.06, h: 0, t: 0.88 },
];
const finParts = [
  foil('fin', FN, { axis: 'g', role: 'fin', paint: 'trim', nx: 11 }),
  ctrlOn('rudder', FN[0], FN[1], 0.1, 0.92, 0.32, { axis: 'g', sh: 0.7 }),
  { kind: 'panel', name: 'fin tip cap', role: 'fin', sh: 0.85, th: 0.004, paint: 'hull', ...FINE, c: P3s([[-0.855, 0.0, 0.333], [-0.86, 0, 0.3], [-1.04, 0, 0.3], [-1.062, 0, 0.333]]) },
  tube('boil-off mast', [[-1.0, 0, 0.334], [-1.06, 0, 0.36], [-1.1, 0, 0.36]], 0.004, { role: 'nacelle', paint: 'cryo', sides: 6, ...FINE }),
  { kind: 'drum', name: 'fin strobe', f: -0.86, r: 0.006, n: 8, z: [0.334, 0.344], role: 'nacelle', paint: 'strobe', sh: { base: 0.9 }, top: { sh: 1 }, ...FINE },
  { kind: 'panel', name: 'fin root fillet', role: 'fin', sh: 0.7, th: 0.003, paint: 'trim', ...FINE, c: P3s([[-0.42, 0, -0.004], [-0.52, 0, 0.03], [-0.6, 0, 0.03], [-0.6, 0, -0.004]]) },
];
const fins = mirror('fins', [group('fin', finParts, { xf: { t: [0, FIN_G, FIN_H], r: [-20, 0, 0] } })]);

// ── Gear: sponsons, the centipede, the nose units ───────────────────────────────
const GZ = -0.24, WR = 0.045, MAIN_G = 0.21;
const MAIN_F = [0.26, 0.13, 0, -0.13, -0.26];
const mainGear = mirror('main gear', [
  group('gear sponson', [pod('sponson', 0, 0, [[0.36, 0.008], [0.32, 0.03], [0.24, 0.045], [-0.3, 0.045], [-0.38, 0.032], [-0.44, 0.008]], { sides: 14, paint: 'belly', shade: { base: 0.55, amp: 0.34 } })],
    { xf: { t: [0, MAIN_G, -0.15], s: [1, 1.15, 1] }, ...FINE }),
  // Door seams along each sponson's belly, one door per axle.
  ...MAIN_F.map((f) => tube('sponson door seam', [[f + 0.06, MAIN_G - 0.03, -0.19], [f + 0.06, MAIN_G + 0.03, -0.19]], 0.0016, { role: 'nacelle', paint: 'seam', sides: 4, ...FINE })),
  ...MAIN_F.flatMap((f) => [
    tube('main leg', [[f, MAIN_G, -0.17], [f, MAIN_G, GZ + 0.01]], 0.008, { role: 'gear', paint: 'metal', sides: 8, ...FINE }),
    tube('oleo', [[f, MAIN_G, -0.2], [f, MAIN_G, GZ + 0.012]], 0.0055, { role: 'gear', paint: 'chrome', sides: 8, ...FINE }),
    tube('torque link', [[f + 0.004, MAIN_G, -0.205], [f + 0.016, MAIN_G, -0.215], [f + 0.004, MAIN_G, -0.226]], 0.0025, { role: 'gear', paint: 'metal', sides: 4, ...FINE }),
    tube('axle', [[f, MAIN_G - 0.042, GZ], [f, MAIN_G + 0.042, GZ]], 0.005, { role: 'gear', paint: 'metal', sides: 6, ...FINE }),
    { ...wheel('main wheel', [f, MAIN_G - 0.028, GZ], WR, 0.014, 14), ...FINE },
    { ...wheel('main wheel', [f, MAIN_G + 0.028, GZ], WR, 0.014, 14), ...FINE },
  ]),
]);
const NOSE_F = [0.47, 0.39];
const noseGear = group('nose gear', [
  ...NOSE_F.flatMap((f) => [
    tube('nose leg', [[f, 0, surf(f, 0, false) + 0.01], [f, 0, GZ + 0.01]], 0.009, { role: 'gear', paint: 'metal', sides: 8 }),
    tube('nose oleo', [[f, 0, -0.205], [f, 0, GZ + 0.012]], 0.006, { role: 'gear', paint: 'chrome', sides: 8 }),
    tube('nose axle', [[f, -0.042, GZ], [f, 0.042, GZ]], 0.005, { role: 'gear', paint: 'metal', sides: 6 }),
    wheel('nose wheel', [f, 0.026, GZ], WR, 0.013, 14),
    wheel('nose wheel', [f, -0.026, GZ], WR, 0.013, 14),
    tube('drag brace', [[f + 0.05, 0, surf(f + 0.05, 0, false) + 0.006], [f, 0, -0.205]], 0.004, { role: 'gear', paint: 'metal', sides: 5 }),
  ]),
  tube('taxi lamp', [[0.475, 0, -0.19], [0.49, 0, -0.19]], 0.007, { role: 'gear', paint: 'strobe', sh: 1, sides: 8, caps: 1 }),
], FINE);
// The nose gear bay's doors on the belly: seams either side of the legs.
const noseBay = mirror('nose bay seams', [SEAM('nose bay seam', [[0.52, 0.034, surf(0.52, 0.034, false) - 0.002], [0.34, 0.034, surf(0.34, 0.034, false) - 0.002]])]);

// ── Sensors, antennas, beacons, the APU ─────────────────────────────────────────
const sensors = [
  { kind: 'drum', name: 'satcom base', f: 0.16, r: 0.04, n: 16, z: [surf(0.16, 0) - 0.004, surf(0.16, 0) + 0.004], role: 'nacelle', paint: 'carbon', sh: { base: 0.55, alt: 0.08 }, ...FINE },
  group('satcom dome', [pod('dome', 0, 0, [[0.045, 0.004], [0.035, 0.016], [0.0, 0.021], [-0.035, 0.016], [-0.045, 0.004]], { sides: 16, paint: 'radome' })], { xf: { t: [0.16, 0, R(surf(0.16, 0) + 0.004)], s: [1, 1, 0.8] }, ...FINE }),
  { kind: 'blade', name: 'VHF blade', role: 'fin', paint: 'carbon', t: 0.003, sh: [0.75, 0.6], outline: [[0.42, surf(0.42, 0) - 0.004], [0.4, surf(0.42, 0) + 0.04], [0.388, surf(0.42, 0) + 0.04], [0.375, surf(0.42, 0) - 0.004]], ...FINE },
  { kind: 'blade', name: 'datalink blade', role: 'fin', paint: 'carbon', t: 0.003, sh: [0.75, 0.6], outline: [[-0.1, surf(-0.1, 0) - 0.004], [-0.115, surf(-0.1, 0) + 0.035], [-0.128, surf(-0.1, 0) + 0.035], [-0.14, surf(-0.1, 0) - 0.004]], ...FINE },
  { kind: 'blade', name: 'belly blade', role: 'fin', paint: 'carbon', t: 0.003, sh: [0.75, 0.6], outline: [[0.12, surf(0.12, 0, false) + 0.004], [0.104, surf(0.12, 0, false) - 0.03], [0.09, surf(0.12, 0, false) - 0.03], [0.08, surf(0.12, 0, false) + 0.004]], ...FINE },
  { kind: 'drum', name: 'crown beacon', f: 0.0, r: 0.008, n: 10, z: [surf(0, 0) - 0.002, surf(0, 0) + 0.01], role: 'nacelle', paint: 'beacon', sh: { base: 0.9 }, top: { sh: 1 }, ...FINE },
  { kind: 'drum', name: 'belly beacon', f: -0.02, r: 0.008, n: 10, z: [surf(-0.02, 0, false) - 0.01, surf(-0.02, 0, false) + 0.002], role: 'nacelle', paint: 'beacon', sh: { base: 0.9 }, bottom: { sh: 1 }, ...FINE },
  // The fuel cell APU's exhaust, a short stub at the middle of the trailing edge, and the tail strobe.
  group('APU exhaust', [pod('stub', 0, 0, [[0.03, 0.012], [0.0, 0.014], [-0.04, 0.012]], { sides: 12, paint: 'exhaust', capAft: { kind: 'flat', sh: 0.15 } })], { xf: { t: [TE - 0.02, 0, 0.022] }, ...FINE }),
  tube('tail strobe', [[TE - 0.065, 0, 0.022], [TE - 0.08, 0, 0.022]], 0.006, { role: 'nacelle', paint: 'strobe', sh: 1, sides: 8, caps: 1, ...FINE }),
  // Cameras for the autonomy: a ball under each wing root, looking down and out.
  mirror('wing cameras', [group('camera ball', [pod('ball', 0, 0, [[0.012, 0.003], [0.008, 0.01], [-0.008, 0.01], [-0.012, 0.003]], { sides: 10, paint: 'carbon', regions: [{ at: [0.008], k: 'all', role: 'glass', tint: [18, 22, 26] }] })],
    { xf: { t: [0.24, 0.4, R(surf(0.24, 0.4, false) - 0.008)] }, ...FINE })]),
];

// ── The coarse body, for range ──────────────────────────────────────────────────
const coarse = [
  loft('fuselage (far)', 16, aftSt.filter((_, i) => i % 2 === 0 || i === aftSt.length - 1), { ...COARSE, paint: 'hull', capAft: { kind: 'flat', sh: 0.5 } }),
  mirror('engines (far)', ENG_G.map((g) => group('engine (far)', [pod('nacelle (far)', 0, 0, [[IN_F, ER * 0.9], [IN_F - 0.1, ER * 1.05], [IN_F - 0.3, ER * 0.8], [IN_F - EL, ER * 0.5]], { sides: 8, paint: 'cowl' })], { xf: { t: [0, g, engH(g)] }, ...COARSE }))),
  mirror('gear (far)', [
    group('sponson (far)', [pod('sponson (far)', 0, 0, [[0.36, 0.01], [0.24, 0.045], [-0.3, 0.045], [-0.44, 0.01]], { sides: 6, paint: 'belly' })], { xf: { t: [0, MAIN_G, -0.15] }, ...COARSE }),
    ...[0.2, -0.2].map((f) => ({ ...wheel('main wheel (far)', [f, MAIN_G, GZ], WR, 0.03, 8), ...COARSE })),
  ]),
  { ...wheel('nose wheel (far)', [0.43, 0, GZ], WR, 0.026, 8), ...COARSE },
  tube('nose leg (far)', [[0.43, 0, -0.15], [0.43, 0, GZ]], 0.01, { role: 'gear', paint: 'metal', sides: 4, ...COARSE }),
];

// ── Lamps ───────────────────────────────────────────────────────────────────────
const lamps = [
  { at: [-0.365, -1.034, 0.08], n: [0.3, -1, 0], rgb: '255,55,55', kind: 'steady' },
  { at: [-0.365, 1.034, 0.08], n: [0.3, 1, 0], rgb: '60,255,95', kind: 'steady' },
  { at: [-0.62, -1.071, 0.2], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [-0.62, 1.071, 0.2], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [TE - 0.085, 0, 0.022], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [0.0, 0, R(surf(0, 0) + 0.012)], n: [0, 0, 1], rgb: '255,90,70', kind: 'beacon' },
  { at: [-0.02, 0, R(surf(-0.02, 0, false) - 0.012)], n: [0, 0, -1], rgb: '255,90,70', kind: 'beacon' },
];

const doc = {
  id: 'heavy_2076',
  kind: 'mesh',
  params: {
    name: 'Leviathan 2076',
    note: 'CONCEPT, generated by scripts/shapes/concepts/leviathan-2076.mjs (edit that, not this). The Leviathan fifty years on, after JetZero\'s blended wing body and Radia\'s WindRunner: one lifting body as wide as the hold, thinning into swept outer wings with raked winglets; four hydrogen turbofans on pylons over the upper aft deck between two canted fins with boil-off masts on their tips; elevons across the trailing edge; a glazed flight deck cab proud on the nose; the centipede gear in two sponsons. The cargo visor is kept: the nose and the cab swing up on the noseVisor channel by the fw_heavy row\'s angle, and the hold and its ramp exist only while it is open. A variant of the heavy mesh, worn as the Leviathan 2076 factory edition.',
    groundPitch: 0,
    hull: 'fuselage',
    navLamps: null,
    lamps,
    finish: 'gloss',
    paints: {
      hull: { rgb: [230, 233, 236], livery: 'base' },
      cowl: { rgb: [230, 233, 236], livery: 'base' },
      trim: { rgb: [30, 72, 150], livery: 'trim' },
      spinner: { rgb: [30, 72, 150], livery: 'trim' },
      belly: { rgb: [140, 148, 158], livery: 'fixed', mat: 'satin' },
      glare: { rgb: [26, 28, 32], livery: 'fixed', mat: 'matte' },
      boot: { rgb: [168, 174, 182], livery: 'fixed', mat: 'bare' },
      frame: { rgb: [24, 26, 30], livery: 'fixed', mat: 'gloss' },
      seam: { rgb: [104, 108, 116], livery: 'fixed', mat: 'matte' },
      carbon: { rgb: [38, 42, 46], livery: 'fixed', mat: 'satin' },
      metal: { rgb: [164, 168, 176], livery: 'fixed', mat: 'bare' },
      chrome: { rgb: [210, 214, 220], livery: 'fixed', mat: 'gloss' },
      intake: { rgb: [26, 28, 32], livery: 'fixed', mat: 'matte' },
      fan: { rgb: [34, 36, 42], livery: 'fixed', mat: 'steel' },
      blade: { rgb: [120, 126, 136], livery: 'fixed', mat: 'steel' },
      exhaust: { rgb: [96, 88, 80], livery: 'fixed', mat: 'exhaust' },
      radome: { rgb: [214, 216, 214], livery: 'fixed', mat: 'satin' },
      cryo: { rgb: [238, 243, 248], livery: 'fixed', mat: 'satin' },
      led: { rgb: [150, 224, 255], livery: 'fixed', mat: 'matte' },
      lamp: { rgb: [255, 244, 220], livery: 'fixed', mat: 'matte' },
      navR: { rgb: [210, 210, 210], livery: 'fixed', mat: 'gloss' },
      beacon: { rgb: [235, 70, 56], livery: 'fixed', mat: 'gloss' },
      strobe: { rgb: [240, 244, 248], livery: 'fixed', mat: 'gloss' },
      seal: { rgb: [30, 32, 34], livery: 'fixed', mat: 'matte' },
      bulk: { rgb: [70, 74, 80], livery: 'fixed', mat: 'matte' },
      hold: { rgb: [96, 102, 100], livery: 'fixed', mat: 'matte' },
      holdRib: { rgb: [74, 78, 80], livery: 'fixed', mat: 'matte' },
      holdFloor: { rgb: [70, 70, 66], livery: 'fixed', mat: 'steel' },
      interior: { rgb: [38, 42, 46], livery: 'fixed', mat: 'matte' },
      seat: { rgb: [70, 74, 82], livery: 'fixed', mat: 'satin' },
      screen: { rgb: [60, 180, 190], livery: 'fixed', mat: 'gloss' },
    },
    parts: [
      visor, brackets, ramp, ...hold, bodyAft, trimBody, ...bodyDetail,
      outerWing, flapsIn, flapsOut, ailerons, tePanel, elevonsIn, elevonsOut, tracks, vgs, winglets,
      engines, fins, mainGear, noseGear, noseBay, ...sensors,
      ...coarse,
    ],
  },
};

const v = validateMesh(doc.params, doc.id);
if (v.errors.length) { console.log('ERRORS', v.errors.slice(0, 12)); process.exit(1); }
if (v.warnings?.length) console.log('warnings', v.warnings.slice(0, 8));
const n1 = compileMesh(doc.params, { detail: 1 }).faces.length, n0 = compileMesh(doc.params, { detail: 0 }).faces.length;
writeFileSync(new URL('../../../content/vehicle_models/mesh_heavy_2076.json', import.meta.url), formatMesh(doc));
console.log('mesh_heavy_2076.json:', n1, 'faces near,', n0, 'far');
