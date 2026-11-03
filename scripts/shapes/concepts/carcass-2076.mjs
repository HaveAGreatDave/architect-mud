// The Carcass 2076 concept: writes content/vehicle_models/mesh_wreck_2076.json.
//
//   node scripts/shapes/concepts/carcass-2076.mjs
//   then: npm run vehicles:bake
//
// The Carcass fifty years on. The old one is a Fly Baby somebody found in a field; this one is a
// 2070s homebuilt somebody found in a field: a small single-seat composite low-wing, after the Sonex
// Onex and the printed-carbon kit planes that followed it, with one blown bubble, a biofuel flat-twin
// in a tight cowl, a three-blade prop and a taildragger stance on spring legs and spats. It came down
// hard and has been flown again, so it wears its rebuild: the port outer wing is a donor's in another
// colour, spliced on with plates and tape; the port winglet snapped off and its nav lamp is a bicycle
// light; the starboard cowl side is missing, so the engine shows; the bubble is cracked and taped,
// with a polycarbonate patch riveted over a hole; a road sign is riveted over the port flank, as on
// the Fly Baby; the rudder is a primer-red spare; the port spat is gone. The flight recorder in the
// tail cone survived the crash, and its access hatch did not: the orange box shows through the hole.
// It is a variant of the wreck mesh (mesh_wreck.json `variants`), worn as the Carcass 2076 edition.
//
// ⚠ THIS OVERWRITES THE JSON. Edit this file, not the mesh in the Modelshop.
//
// ⚠ THE ROLES ARE THE BREAKUP'S. cockpit.js tears an aircraft apart by role and side (body, glass,
// window, interior and gun in nose and tail sections; wing, aileron and flap per side; stab and
// elevator; fin and rudder; nacelle, prop and strut per side; gear), so every face here carries one
// of those, the donor wing panel is still `wing`, and the winglets go with their own wing.
//
// Two bodies in one file. Everything fine is `minDetail: 1`; a coarse body with `maxDetail: 0`
// stands in at range. The wing, fin and tailplane are foil() groups, which carry their own two LODs.
//
// Frame: f fore, g right, h up, in the Carcass's units (prop hub at f 1.062, mains at f 0.44 on the
// ground at h -0.328, tailwheel at f -0.955 on the ground at h -0.019), so she sits three-point at the
// Fly Baby's 12.5° as the old one does. Angles on a section are lib.mjs's: 0 = right waterline.
import { writeFileSync } from 'node:fs';
import { R, P3, skin, loft, pod, foilFaces, foil, foilPt, lerpSt, ctrlOn, tube, mirror, group, poly as rawPoly, quad, cone, wheel, faired, DEG } from '../fw-meshes/lib.mjs';
const { formatMesh, validateMesh, compileMesh } = await import('../../../client/shared/vehicle-mesh.js');
const { CR76_STATIONS, CR76_TAIL, CR76_GLASS, CR76_FRAMES, CR76_INSIDE, CR76_WING, CR76_PROP, CR76_RECORDER } = await import('../../../client/shared/cabin-carcass-2076.js');

const FINE = { minDetail: 1 }, COARSE = { maxDetail: 0 };
// Every poly face needs a role; trim and fittings are 'nacelle' unless they say otherwise.
const poly = (name, faces, extra) => rawPoly(name, faces.map((f) => ({ role: 'nacelle', ...f })), extra);
const GLASS = [64, 96, 104], GLASS_PATCH = [96, 112, 92];
const lerp = (a, b, t) => a + (b - a) * t;
const range = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));
const P3s = (a) => a.map(P3);
const addv = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// ── The fuselage ────────────────────────────────────────────────────────────────
// Stated once in client/shared/cabin-carcass-2076.js, which the cockpit is built off too.
const ST = CR76_STATIONS;
const at = (f, a, out = 0) => skin(ST, f, a * DEG, out);
const NS = 72, STEP = 360 / NS;
// The facets whose middles lie between two angles: a region's `k` list. Every edge below is on a facet line.
const kOf = (a0, a1) => { const o = []; for (let k = 0; k < NS; k++) { const a = ((k * STEP + STEP / 2) + 360) % 360, lo = ((a0 % 360) + 360) % 360, hi = ((a1 % 360) + 360) % 360; if (lo <= hi ? a >= lo && a <= hi : a >= lo || a <= hi) o.push(k); } return o; };
const GB = CR76_GLASS.bubble;
// The bays the bubble covers: each region is keyed by its bay's fore station.
const GLASS_AT = ST.map((s) => s.f).filter((f) => f <= GB.f[1] + 1e-9 && f > GB.f[0] + 1e-9);
const fuselage = loft('fuselage', NS, ST, {
  ...FINE, paint: 'hull',
  note: 'The shell. Its holes are the bubble (the room shows through it), the missing starboard cowl side (the engine shows) and the recorder hatch (the orange box shows). Glass, frames, patches, seams and trim are separate parts a hair proud of it.',
  capFore: { kind: 'flat', sh: 0.5, paint: 'carbon' },
  capAft: { kind: 'apex', at: CR76_TAIL, paint: 'trim' },
  regions: [
    { at: GLASS_AT, k: kOf(GB.a[0], GB.a[1]), omit: true },
    { at: [0.94, 0.86], k: kOf(-20, 40), omit: true },
    { at: [CR76_RECORDER.f[1]], k: kOf(CR76_RECORDER.a[0], CR76_RECORDER.a[1]), omit: true },
    { at: ST.slice(1, -1).map((s) => s.f), k: kOf(-128, -52), paint: 'belly' },
  ],
  shade: { base: 0.6, amp: 0.36 },
});

// A curved patch of skin as a grid of quads, `o` proud of the hull: glass, panels, trim. `inward`
// winds it to face the inside, for the tub you see through the bubble.
function patch(fs, as, extra, o = 0.0022, inward = false) {
  const out = [];
  for (let i = 0; i < fs.length - 1; i++) for (let j = 0; j < as.length - 1; j++) {
    const q = [at(fs[i + 1], as[j], o), at(fs[i], as[j], o), at(fs[i], as[j + 1], o), at(fs[i + 1], as[j + 1], o)];
    out.push(quad(...(inward ? q.reverse() : q), extra));
  }
  return out;
}
const alongF = (fs, a, o = 0.004) => fs.map((f) => at(f, a, o));
const roundF = (f, as, o = 0.004) => as.map((a) => at(f, a, o));
const mirA = (s) => (a) => (s ? 180 - a : a);
const stationsIn = (f0, f1, extra = []) => [...new Set([f1, ...ST.map((s) => s.f).filter((f) => f < f1 && f > f0), ...extra, f0])].sort((a, b) => b - a);
// Rivets round a rectangle in (f, a): small bright squares just proud of whatever is under them.
const rivets = (f0, f1, a0, a1, o, nf = 6, na = 4) => {
  const out = [], d = 0.0022, da = 1.4;
  const dot = (f, a) => quad(at(f + d, a - da, o), at(f - d, a - da, o), at(f - d, a + da, o), at(f + d, a + da, o), { paint: 'rivet', sh: 0.9 });
  for (const f of range(f0, f1, nf)) { out.push(dot(f, a0), dot(f, a1)); }
  for (const a of range(a0, a1, na).slice(1, -1)) { out.push(dot(f0, a), dot(f1, a)); }
  return out;
};

// ── The bubble ──────────────────────────────────────────────────────────────────
// One blown bubble, cracked by whatever it hit and kept: a starburst on the port side with tape
// across it, and a polycarbonate patch riveted over the hole a fist made getting out.
const BUB_F = stationsIn(GB.f[0], GB.f[1], [0.38, 0.3, 0.22, 0.14, 0.06, -0.02, -0.1, -0.18, -0.26]);
const bubble = poly('canopy bubble', patch(BUB_F, range(GB.a[0], GB.a[1], 28), { role: 'glass', tint: GLASS }), FINE);
const CRACK = (name, pts) => tube(name, pts, 0.0011, { role: 'glass', paint: 'crack', sh: 1, sides: 3, ...FINE });
const crackAt = (f, a, o = 0.0034) => at(f, a, o);
const cracks = [
  // The starburst, centred over the pilot's left shoulder.
  ...[[0.14, 118], [0.02, 132], [-0.08, 112], [0.2, 140], [-0.02, 98], [0.1, 148]].map(([f, a], i) =>
    CRACK('crack ' + i, [crackAt(0.06, 122), crackAt(lerp(0.06, f, 0.5), lerp(122, a, 0.5) + (i % 2 ? 3 : -3)), crackAt(f, a)])),
  CRACK('crack run', [crackAt(0.2, 140), crackAt(0.28, 132), crackAt(0.34, 138), crackAt(0.4, 128)]),
  CRACK('crack run aft', [crackAt(-0.08, 112), crackAt(-0.16, 104), crackAt(-0.24, 110)]),
];
// Tape over the starburst: two strips crossing it, and one along the run toward the windscreen.
const tapeStrip = (f0, a0, f1, a1, w, o = 0.0042) => {
  const n = 6, out = [];
  for (let i = 0; i < n; i++) {
    const fa = lerp(f0, f1, i / n), fb = lerp(f0, f1, (i + 1) / n), aa = lerp(a0, a1, i / n), ab = lerp(a0, a1, (i + 1) / n);
    out.push(quad(at(fb, ab - w, o), at(fa, aa - w, o), at(fa, aa + w, o), at(fb, ab + w, o), { paint: 'tape', sh: 0.8 }));
  }
  return out;
};
const canopyTape = poly('canopy tape', [...tapeStrip(-0.02, 104, 0.16, 140, 3.2), ...tapeStrip(0.14, 106, -0.02, 138, 3.2), ...tapeStrip(0.27, 131, 0.39, 131, 2.6)], FINE);
// The patch: a square of polycarbonate in a greener tint, riveted over a hole on the starboard side.
const PF0 = -0.2, PF1 = -0.08, PA0 = 44, PA1 = 72;
const polyPatch = poly('polycarbonate patch', [
  ...patch([PF1, -0.14, PF0], range(PA0, PA1, 3), { role: 'glass', tint: GLASS_PATCH }, 0.0048),
  ...rivets(PF0 + 0.006, PF1 - 0.006, PA0 + 2, PA1 - 2, 0.0056, 6, 4),
], FINE);

// Frames: dark rails standing just proud of the glass. The bubble slides back on its sill rails.
const FR = (name, pts, r = 0.0042) => tube(name, pts, r, { role: 'nacelle', paint: 'frame', sh: 0.5, sides: 5, ...FINE });
const frames = [
  FR('bubble foot', roundF(CR76_FRAMES.foot, range(GB.a[0] - 2, GB.a[1] + 2, 30), 0.0042), 0.005),
  FR('bubble hoop', roundF(CR76_FRAMES.hoop, range(GB.a[0] - 2, GB.a[1] + 2, 30), 0.0045), 0.0058),
  ...[0, 1].flatMap((s) => {
    const A = mirA(s), side = s ? 'left' : 'right';
    return [
      FR('sill rail (' + side + ')', alongF(stationsIn(-0.52, GB.f[1]), A(CR76_FRAMES.railA), 0.004), 0.0046),
      tube('slide track (' + side + ')', alongF(stationsIn(-0.56, GB.f[0] + 0.02), A(CR76_FRAMES.railA + 3), 0.003), 0.0026, { role: 'nacelle', paint: 'metal', sh: 0.85, sides: 4, ...FINE }),
      // The latch: a short lever at the hoop, in a recess.
      tube('latch handle (' + side + ')', [at(-0.28, A(24), 0.008), at(-0.24, A(26), 0.008)], 0.003, { role: 'nacelle', paint: 'metal', sh: 0.9, sides: 6, ...FINE }),
    ];
  }),
];

// ── The tub you see through the bubble: lining, seat, dash, stick ───────────────
// The hull is cut out under the glass, so the inside has to be there: the lining down the walls
// from sill to sill under the floor, the floor, the bulkhead behind the seat and the panel's face.
const tubFs = stationsIn(GB.f[0], GB.f[1], [0.3, 0.14, -0.06, -0.22]);
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
const FH = CR76_INSIDE.floorH;
// The ring just inside the skin at f, from `a0` round under the keel to `a1`, as a closed polygon.
const innerRing = (f, a0, a1, n) => range(a0, a1, n).map((a) => at(f, a, -0.006));
const room = [
  poly('tub lining', patch(tubFs, range(GB.a[1], 360 + GB.a[0], 24), { paint: 'interior', role: 'interior', sh: 0.45 }, -0.006, true), FINE),
  poly('tub ends', [
    { role: 'interior', paint: 'interior', sh: 0.5, p: innerRing(GB.f[0], GB.a[1] + 20, 360 + GB.a[0] - 20, 16) },
    { role: 'interior', paint: 'carbon', sh: 0.42, p: innerRing(GB.f[1], 360 + GB.a[0] - 20, GB.a[1] + 20, 16) },
  ], FINE),
  poly('floor', [quad([0.4, -0.08, FH], [0.4, 0.08, FH], [-0.28, 0.08, FH], [-0.28, -0.08, FH], { paint: 'interior', role: 'interior', sh: 0.42 })], FINE),
  poly('seat', [
    ...slab([CR76_INSIDE.seatF + 0.04, 0, FH + 0.04], [0.09, 0.13, 0.016], 6, { paint: 'seat', role: 'interior' }),
    ...slab([CR76_INSIDE.seatF - 0.035, 0, FH + 0.12], [0.014, 0.12, 0.17], -28, { paint: 'seat', role: 'interior' }),
    ...slab([CR76_INSIDE.seatF - 0.072, 0, FH + 0.22], [0.012, 0.07, 0.05], -28, { paint: 'seat', role: 'interior' }),
    // One shoulder strap is an orange cargo strap.
    ...slab([CR76_INSIDE.seatF - 0.02, 0.026, FH + 0.15], [0.004, 0.012, 0.12], -30, { paint: 'strap', role: 'interior' }),
  ], FINE),
  poly('dash', [
    ...slab([CR76_INSIDE.panelF, 0, FH + 0.15], [0.02, 0.2, 0.06], -38, { paint: 'carbon', role: 'interior' }),
    ...slab([CR76_INSIDE.panelF - 0.006, 0, FH + 0.152], [0.004, 0.18, 0.045], -38, { paint: 'screen', role: 'interior' }),
    // One page is dead: a black square in the lit band.
    ...slab([CR76_INSIDE.panelF - 0.0072, 0.058, FH + 0.152], [0.003, 0.04, 0.04], -38, { paint: 'deadpage', role: 'interior' }),
  ], FINE),
  tube('stick', [[0.11, 0, FH + 0.01], [0.115, 0, FH + 0.085]], 0.0035, { role: 'interior', paint: 'interior', sides: 5, ...FINE }),
];

// ── Trim, seams and the rebuild's patches ───────────────────────────────────────
const SEAM = (name, pts, r = 0.0022) => tube(name, pts, r, { role: 'nacelle', paint: 'seam', sh: 0.4, sides: 4, ...FINE });
const trimFs = stationsIn(-1.0, 0.98);
const trim = [
  // The cheatline: the factory's teal, nose to tail along the waist, the road sign riveted on over it.
  mirror('cheatline', [poly('cheatline', patch(trimFs.filter((f) => f <= 0.96), [-6, 2], { paint: 'trim' }, 0.0018), FINE)]),
  poly('anti-glare', patch(stationsIn(GB.f[1] + 0.004, 0.8), range(68, 112, 6), { paint: 'glare' }, 0.0018), FINE),
  // A tail band in the trim colour, with a thin light along its top edge.
  mirror('tail band', [poly('tail band', patch(stationsIn(-0.98, -0.84), range(-40, 60, 5), { paint: 'trim' }, 0.0018), FINE),
    tube('tail band light', alongF(stationsIn(-0.97, -0.84), 62, 0.003), 0.002, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE })]),
  // Seams: the firewall ring, the tail cone joint, and a ring behind the canopy.
  SEAM('firewall seam', roundF(0.7, range(-90, 270, 36), 0.0022)),
  SEAM('tail cone joint', roundF(-0.52, range(-90, 270, 36), 0.0022)),
  SEAM('turtle deck seam', roundF(-0.4, range(-60, 240, 30), 0.0022)),
  // The tail cone joint was opened and closed again by somebody with a rivet gun and no plan.
  poly('tail cone rivets', range(-80, 260, 34).map((a) => quad(at(-0.517, a - 1.2, 0.003), at(-0.523, a - 1.2, 0.003), at(-0.523, a + 1.2, 0.003), at(-0.517, a + 1.2, 0.003), { paint: 'rivet', sh: 0.9 })), FINE),
  // A step and a hand hold on the left, for climbing in over the wing root.
  tube('hand hold', [at(-0.34, 150, 0.002), at(-0.34, 150, 0.014), at(-0.4, 150, 0.014), at(-0.4, 150, 0.002)], 0.003, { role: 'nacelle', paint: 'metal', sides: 5, ...FINE }),
];
// The patches. A road sign riveted over the port flank, yellow, as on the Fly Baby it descends from;
// two aluminium panels; gaffer over a crack in the turtle deck; soot down the belly from the stacks.
const patches = [
  poly('road sign patch', [...patch([0.22, 0.18, 0.12, 0.06, 0.0], range(163, 177, 4), { paint: 'sign', sh: 0.75 }, 0.0032),
    // The sign's own black chevron, still on it.
    ...patch([0.16, 0.12, 0.09], [166, 169], { paint: 'signInk', sh: 0.75 }, 0.0036),
    ...patch([0.12, 0.09, 0.05], [171, 174], { paint: 'signInk', sh: 0.75 }, 0.0036),
    ...rivets(0.004, 0.216, 164, 176, 0.004, 8, 3)], FINE),
  poly('alu patch (right)', [...patch([-0.36, -0.4, -0.45], range(8, 34, 3), { paint: 'alu', sh: 0.85 }, 0.0032), ...rivets(-0.448, -0.362, 9, 33, 0.004, 5, 3)], FINE),
  poly('alu patch (left)', [...patch([-0.5, -0.56, -0.6], range(158, 188, 3), { paint: 'alu', sh: 0.85 }, 0.0032), ...rivets(-0.598, -0.502, 159, 187, 0.004, 5, 3)], FINE),
  poly('turtle deck tape', [...patch([-0.36, -0.39, -0.42], range(66, 112, 6), { paint: 'gaffer', sh: 0.5 }, 0.003)], FINE),
  poly('exhaust soot', patch(stationsIn(0.32, 0.8), range(-110, -70, 4), { paint: 'soot', sh: 0.4 }, 0.0026), FINE),
  poly('oil streak', patch(stationsIn(0.6, 0.86), range(-34, -22, 2), { paint: 'oil', sh: 0.4 }, 0.0026), FINE),
  // A carbon repair on the belly: a dark square with its resin edge.
  poly('belly repair', [...patch([0.2, 0.14, 0.08], range(-98, -82, 3), { paint: 'carbon', sh: 0.5 }, 0.003)], FINE),
];

// ── The nose: the cowl, the engine where its side is missing, the spinner ───────
// A biofuel flat-twin in a tight cowl: two cheek inlets, louvres on the port side, the fuel filler
// on the deck ahead of the bubble and a sight tube of amber fuel down the port cheek. The starboard
// cowl side never came back from the field, so the cylinder and its fins are out in the air.
const PF = CR76_PROP.f, PH = CR76_PROP.h;
const nose = [
  mirror('cheek inlets', [group('cheek inlet', [pod('inlet', 0, 0, [[0.006, 0.004], [0.0, 0.022, 0, 0.013], [-0.05, 0.02, 0, 0.012], [-0.08, 0.004]], { sides: 12, paint: 'carbon' })],
    { xf: { t: [1.0, 0.06, 0.035] }, ...FINE }),
  group('inlet mouth', [pod('mouth', 0, 0, [[0.0, 0.017, 0, 0.009], [-0.002, 0.012, 0, 0.006]], { sides: 12, paint: 'intake' })], { xf: { t: [1.007, 0.06, 0.035] }, ...FINE })]),
  // Louvres down the port cheek, the side that is still there.
  poly('cowl louvres', range(0.9, 0.8, 5).flatMap((f) => patch([f, f - 0.009], [162, 200], { paint: 'intake', sh: 0.3 }, 0.0024)), FINE),
  SEAM('cowl seam', roundF(0.96, range(-90, 270, 30), 0.0022)),
  mirror('cowl fasteners', [poly('fasteners', range(-60, 80, 7).flatMap((a) => patch([0.962, 0.956], [a - 2, a + 2], { paint: 'metal', sh: 0.85 }, 0.0028)), FINE)]),
  // The edge of the hole: bent alloy where the side panel was torn off its fasteners.
  tube('torn cowl edge', [at(0.94, -20, 0.002), at(0.94, 40, 0.002), at(0.86, 40, 0.002), at(0.78, 40, 0.002), at(0.78, -20, 0.002), at(0.86, -20, 0.002), at(0.94, -20, 0.002)], 0.0026, { role: 'nacelle', paint: 'alu', sides: 4, ...FINE }),
  // The chin scoop under the spinner, and two stacks out of the cowl's belly, rusted.
  group('chin scoop', [pod('scoop', 0, 0, [[0.0, 0.004], [-0.02, 0.024, 0, 0.034], [-0.14, 0.022, 0, 0.03], [-0.2, 0.004]], { sides: 12, paint: 'carbon' })], { xf: { t: [0.98, 0, -0.07] }, ...FINE }),
  group('scoop mouth', [pod('mouth', 0, 0, [[0.0, 0.016, 0, 0.026], [-0.003, 0.01, 0, 0.018]], { sides: 12, paint: 'intake' })], { xf: { t: [0.962, 0, -0.07] }, ...FINE }),
  mirror('exhaust stacks', [tube('exhaust stack', [[0.84, 0.05, -0.085], [0.78, 0.058, -0.112], [0.72, 0.058, -0.118]], 0.0085, { role: 'nacelle', paint: 'exhaust', sides: 6, ...FINE }),
    tube('stack mouth', [[0.725, 0.058, -0.118], [0.715, 0.058, -0.119]], 0.0095, { role: 'nacelle', paint: 'soot', sides: 6, ...FINE })]),
  // The fuel: a filler on the deck with a lit ring, and a sight tube down the port cheek.
  { kind: 'drum', name: 'fuel filler', f: 0.6, r: 0.014, n: 12, z: [R(at(0.6, 90)[2] - 0.003), R(at(0.6, 90)[2] + 0.006)], role: 'nacelle', paint: 'metal', sh: { base: 0.7, alt: 0.1 }, top: { sh: 0.95 }, ...FINE },
  { kind: 'drum', name: 'fuel filler cap', f: 0.6, r: 0.01, n: 12, z: [R(at(0.6, 90)[2] + 0.006), R(at(0.6, 90)[2] + 0.011)], role: 'nacelle', paint: 'bio', sh: { base: 0.8, alt: 0.1 }, top: { sh: 1 }, ...FINE },
  tube('fuel sight tube', [at(0.74, 196, 0.006), at(0.74, 214, 0.006)], 0.004, { role: 'nacelle', paint: 'bio', sh: 1, sides: 6, ...FINE }),
  tube('sight tube guard', [at(0.745, 194, 0.003), at(0.745, 216, 0.003), at(0.735, 216, 0.003), at(0.735, 194, 0.003), at(0.745, 194, 0.003)], 0.0014, { role: 'nacelle', paint: 'metal', sides: 3, ...FINE }),
  // The spinner: not the one she came with. Matte black, a size too small for the backplate.
  tube('spinner backplate', [[1.04, 0, PH], [PF - 0.006, 0, PH]], 0.046, { role: 'nacelle', paint: 'carbon', sides: 20, caps: 1, ...FINE }),
  cone('spinner', PF - 0.006, 0, PH, 0.04, [1.115, 0, PH], { paint: 'spinner', n: 20, role: 'nacelle', ...FINE }),
  cone('spinner tip', 1.108, 0, PH, 0.006, [1.118, 0, PH], { paint: 'metal', n: 10, role: 'nacelle', ...FINE }),
];
// The blade roots: three cuffs out of the spinner, one of them wrapped in tape.
for (let k = 0; k < CR76_PROP.blades; k++) {
  const a = (k / CR76_PROP.blades) * Math.PI * 2 + 0.4;
  nose.push(tube('blade cuff', [[PF + 0.006, Math.cos(a) * 0.028, PH + Math.sin(a) * 0.028], [PF + 0.002, Math.cos(a) * 0.056, PH + Math.sin(a) * 0.056]], 0.0078, { role: 'nacelle', paint: k === 1 ? 'tape' : 'carbon', sides: 6, ...FINE }));
}
// The engine where the starboard cowl side was: a crankcase, the cylinder with its fins standing out
// to starboard, the head, a plug lead and the intake. Behind it, the cowl's own inside, dark.
const EF = 0.86, EH = 0.012;
const engine = [
  poly('cowl inside', [
    // The back of the hole: a plate on the centreline, the deck over it and the floor under it.
    quad([0.94, 0.0, -0.07], [0.78, 0.0, -0.07], [0.78, 0.0, 0.085], [0.94, 0.0, 0.085], { paint: 'cowlIn', sh: 0.35 }),
    quad([0.94, 0.1, 0.075], [0.78, 0.1, 0.075], [0.78, 0.0, 0.075], [0.94, 0.0, 0.075], { paint: 'cowlIn', sh: 0.25 }),
    quad([0.94, 0.0, -0.06], [0.94, 0.1, -0.06], [0.78, 0.1, -0.06], [0.78, 0.0, -0.06], { paint: 'cowlIn', sh: 0.3 }),
    quad([0.785, 0.0, -0.06], [0.785, 0.1, -0.06], [0.785, 0.1, 0.075], [0.785, 0.0, 0.075], { paint: 'cowlIn', sh: 0.3 }),
    quad([0.935, 0.1, -0.06], [0.935, 0.0, -0.06], [0.935, 0.0, 0.075], [0.935, 0.1, 0.075], { paint: 'cowlIn', sh: 0.3 }),
  ], FINE),
  poly('crankcase', slab([EF, 0.025, EH - 0.01], [0.1, 0.05, 0.06], 0, { paint: 'engine' }), FINE),
  tube('cylinder barrel', [[EF, 0.04, EH], [EF, 0.082, EH]], 0.024, { role: 'nacelle', paint: 'engine', sides: 12, caps: 1, ...FINE }),
  ...range(0.046, 0.078, 6).map((g, i) => tube('cylinder fin ' + i, [[EF, g, EH], [EF, g + 0.0025, EH]], 0.031, { role: 'nacelle', paint: 'fins', sides: 12, caps: 1, ...FINE })),
  tube('cylinder head', [[EF, 0.082, EH], [EF, 0.098, EH]], 0.027, { role: 'nacelle', paint: 'fins', sides: 10, caps: 1, ...FINE }),
  ...range(0.084, 0.096, 3).map((g, i) => tube('head fin ' + i, [[EF - 0.03, g, EH], [EF + 0.03, g, EH]], 0.006, { role: 'nacelle', paint: 'fins', sides: 4, ...FINE })),
  tube('plug lead', [[EF + 0.012, 0.1, EH + 0.012], [EF + 0.03, 0.09, 0.05], [0.79, 0.04, 0.06]], 0.0022, { role: 'nacelle', paint: 'lead', sides: 4, ...FINE }),
  tube('intake runner', [[EF - 0.02, 0.08, EH - 0.018], [EF - 0.05, 0.07, -0.04], [0.8, 0.03, -0.05]], 0.006, { role: 'nacelle', paint: 'metal', sides: 6, ...FINE }),
  // A cable tie holding the lead off the cylinder, because the clip is somewhere in a field.
  tube('cable tie', [[EF + 0.025, 0.091, 0.045], [EF + 0.035, 0.091, 0.045]], 0.0035, { role: 'nacelle', paint: 'gaffer', sides: 4, ...FINE }),
];

// ── The wing ────────────────────────────────────────────────────────────────────
// Low and tapered with a splice station where the outer panel bolts on. The port outer panel is a
// donor's, sun-faded blue, joined with a splice plate and a band of tape; the factory's flaps inboard,
// ailerons outboard, the port one the donor's too. The starboard winglet survived; the port one
// snapped at the root and its nav lamp is a bicycle light taped to the tip rib.
const WG = [CR76_WING.root, CR76_WING.splice, CR76_WING.tip];
const DONOR_G = CR76_WING.splice.g;
const donorOf = (faces) => faces.map((f) => (f.p.every((q) => q[1] <= -DONOR_G + 1e-6) ? { ...f, paint: 'donor' } : f));
const wing = {
  kind: 'group', name: 'wing', parts: [
    { kind: 'poly', name: 'wing (near)', minDetail: 1, faces: donorOf(foilFaces(WG, { nx: 21, paint: 'hull', bands: [{ x0: 0, x1: 0.04, paint: 'edge' }] })) },
    { kind: 'poly', name: 'wing (far)', maxDetail: 0, faces: donorOf(foilFaces(WG, { nx: 4, paint: 'hull' })) },
  ],
};
const CF = 0.25;
const portOf = (c) => ({ ...c, le: c.le.map((q) => [q[0], -q[1], q[2]]), te: c.te.map((q) => [q[0], -q[1], q[2]]), side: -c.side });
const fl = ctrlOn('flap', WG[0], WG[1], 0.06, 0.96, CF).parts[0];
const ai = ctrlOn('aileron', WG[1], WG[2], 0.05, 0.95, CF).parts[0];
const surfaces = group('ailerons and flaps', [
  { ...fl, paint: 'hull' }, { ...portOf(fl), paint: 'hull' },
  { ...ai, paint: 'hull' }, { ...portOf(ai), paint: 'donor' },
]);
const wingAt = (g, x, up = 1) => {
  const ag = Math.abs(g);
  for (let i = 0; i < WG.length - 1; i++) if (ag <= WG[i + 1].g + 1e-9) { const p = foilPt(lerpSt(WG[i], WG[i + 1], (ag - WG[i].g) / (WG[i + 1].g - WG[i].g)), x, up); return [p[0], g, p[2]]; }
  const p = foilPt(WG[WG.length - 1], x, up); return [p[0], g, p[2]];
};
const wingUp = (g, x, o) => { const p = wingAt(g, x, 1); return [p[0], g, p[2] + o]; };
const wingLo = (g, x, o) => { const p = wingAt(g, x, 0); return [p[0], g, p[2] - o]; };
// A rectangle on the upper (or lower) surface between spans g0..g1 and chords x0..x1.
const wingRect = (g0, g1, x0, x1, extra, o = 0.0016, lower = false) => {
  const W = lower ? wingLo : wingUp;
  const q = [W(g0, x0, o), W(g1, x0, o), W(g1, x1, o), W(g0, x1, o)];
  // Wound so the face looks up off the upper surface, down off the lower, on either wing.
  const flip = (g0 < 0) !== lower;
  return quad(...(flip ? q.reverse() : q), extra);
};
const wingDetail = [
  // The splice: a plate over the joint on each wing and a band of tape over the port one, top and bottom.
  poly('splice plates', [
    ...[1, -1].flatMap((s) => [wingRect(s * (DONOR_G - 0.02), s * (DONOR_G + 0.02), 0.04, 0.72, { paint: 'alu', sh: 0.85, role: 'wing' }, 0.002),
      wingRect(s * (DONOR_G - 0.02), s * (DONOR_G + 0.02), 0.04, 0.72, { paint: 'alu', sh: 0.5, role: 'wing' }, 0.002, true)]),
    wingRect(-(DONOR_G + 0.024), -(DONOR_G + 0.06), 0.0, 0.74, { paint: 'tape', sh: 0.8, role: 'wing' }, 0.0026),
    wingRect(-(DONOR_G + 0.024), -(DONOR_G + 0.06), 0.0, 0.74, { paint: 'tape', sh: 0.5, role: 'wing' }, 0.0026, true),
    // Rivets down both edges of each plate.
    ...[1, -1].flatMap((s) => range(0.08, 0.68, 8).flatMap((x) => [-0.014, 0.014].map((dg) => wingRect(s * (DONOR_G + dg - 0.003), s * (DONOR_G + dg + 0.003), x - 0.006, x + 0.006, { paint: 'rivet', sh: 0.9, role: 'wing' }, 0.0028)))),
  ], FINE),
  // Walkways on both roots, dark and gritty, where you step in.
  poly('wing walks', [1, -1].map((s) => wingRect(s * 0.14, s * 0.3, 0.06, 0.62, { paint: 'walk', sh: 0.5, role: 'wing' }, 0.0018)), FINE),
  // The tanks' fillers, one in each wing, with an amber ring: the biofuel's colour.
  mirror('wing fuel fillers', [{ kind: 'drum', name: 'wing filler', f: R(wingAt(0.48, 0.3)[0]), g: 0.48, r: 0.012, n: 12, z: [R(wingAt(0.48, 0.3)[2] - 0.002), R(wingAt(0.48, 0.3)[2] + 0.005)], role: 'wing', paint: 'bio', sh: { base: 0.8, alt: 0.1 }, top: { sh: 0.95 }, ...FINE }]),
  // A carbon repair on the starboard wing, and a seam down the starboard spar line.
  poly('wing repair', [wingRect(0.58, 0.72, 0.36, 0.5, { paint: 'repair', sh: 0.7, role: 'wing' }, 0.0022), ...range(0.37, 0.49, 4).flatMap((x) => [0.585, 0.715].map((g) => wingRect(g - 0.003, g + 0.003, x - 0.004, x + 0.004, { paint: 'rivet', sh: 0.9, role: 'wing' }, 0.0028)))], FINE),
  tube('spar seam', range(0.14, 1.46, 10).map((g) => wingUp(g, 0.28, 0.0012)), 0.0012, { role: 'wing', paint: 'seam', sides: 3, ...FINE }),
  tube('donor seam', range(-0.9, -1.46, 6).map((g) => wingUp(g, 0.24, 0.0012)), 0.0012, { role: 'wing', paint: 'seam', sides: 3, ...FINE }),
  // The leading edge's light strip: the factory's on the starboard wing; the donor's has none.
  tube('leading edge light', range(0.16, 1.44, 8).map((g) => { const p = wingAt(g, 0.012, 1); return [p[0] + 0.002, g, p[2] + 0.001]; }), 0.0018, { role: 'wing', paint: 'led', sh: 1, sides: 4, ...FINE }),
  tube('leading edge light (left)', range(-0.16, -0.82, 4).map((g) => { const p = wingAt(g, 0.012, 1); return [p[0] + 0.002, g, p[2] + 0.001]; }), 0.0018, { role: 'wing', paint: 'led', sh: 1, sides: 4, ...FINE }),
  // The pitot: copper tube from a plumber's, bent under the port wing and taped at the bend.
  tube('pitot', [wingLo(-0.62, 0.14, 0), [wingAt(-0.62, 0.14, 0)[0] + 0.02, -0.62, wingAt(-0.62, 0.14, 0)[2] - 0.04], [wingAt(-0.62, 0, 0)[0] + 0.07, -0.62, wingAt(-0.62, 0.14, 0)[2] - 0.04]], 0.0024, { role: 'wing', paint: 'copper', sh: 0.9, sides: 5, ...FINE }),
  tube('pitot tape', [[wingAt(-0.62, 0.14, 0)[0] + 0.012, -0.62, wingAt(-0.62, 0.14, 0)[2] - 0.03], [wingAt(-0.62, 0.14, 0)[0] + 0.026, -0.62, wingAt(-0.62, 0.14, 0)[2] - 0.04]], 0.004, { role: 'wing', paint: 'tape', sides: 5, ...FINE }),
];
// The winglets. A blade stands in the f-h plane; the group moves it out to the tip.
const T = CR76_WING.tip;
const winglet = group('winglet (right)', [{ kind: 'blade', name: 'winglet', role: 'wing', paint: 'hull', t: 0.0045, sh: [0.82, 0.6], ...FINE,
  outline: [[T.le - 0.002, T.h], [T.le - 0.05, T.h + 0.07], [T.le - 0.13, T.h + 0.105], [T.te + 0.06, T.h + 0.1], [T.te + 0.005, T.h]], edges: [{ a: 1, b: 2, sh: 0.9 }] },
  { kind: 'blade', name: 'winglet stripe', role: 'wing', paint: 'trim', t: 0.0048, sh: [0.82, 0.6], ...FINE,
    outline: [[T.le - 0.05, T.h + 0.07], [T.le - 0.13, T.h + 0.105], [T.te + 0.06, T.h + 0.1], [T.te + 0.03, T.h + 0.085], [T.le - 0.06, T.h + 0.06]] }],
  { xf: { t: [0, T.g + 0.002, 0] } });
const wingletStub = group('winglet stub (left)', [{ kind: 'blade', name: 'winglet stub', role: 'wing', paint: 'donor', t: 0.0045, sh: [0.6, 0.82], ...FINE,
  outline: [[T.le - 0.002, T.h], [T.le - 0.03, T.h + 0.03], [T.le - 0.06, T.h + 0.018], [T.le - 0.09, T.h + 0.034], [T.te + 0.07, T.h + 0.012], [T.te + 0.005, T.h]] }],
  { xf: { t: [0, -T.g - 0.002, 0] } });
const tipLamps = [
  // The starboard nav lamp in the winglet's foot, green, and its strobe at the trailing edge.
  group('nav lens (right)', [pod('nav lens', 0, 0, [[0.006, 0.0015], [0.0, 0.007], [-0.012, 0.008]], { sides: 10, role: 'glass', paint: 'navG' })], { xf: { t: [T.le + 0.004, T.g + 0.004, T.h + 0.004] }, ...FINE }),
  tube('tip strobe (right)', [[T.te + 0.012, T.g + 0.004, T.h + 0.004], [T.te - 0.002, T.g + 0.004, T.h + 0.004]], 0.004, { role: 'wing', paint: 'strobe', sh: 1, sides: 6, caps: 1, ...FINE }),
  // The port one: a bicycle lamp in a black case, gaffer-taped to the broken tip rib.
  poly('bicycle lamp', slab([T.le - 0.012, -T.g - 0.012, T.h + 0.012], [0.03, 0.016, 0.018], 0, { paint: 'gaffer', role: 'wing' }), FINE),
  poly('bicycle lamp lens', slab([T.le + 0.004, -T.g - 0.012, T.h + 0.012], [0.003, 0.012, 0.012], 0, { paint: 'navR', role: 'wing' }), FINE),
  poly('lamp tape', [...slab([T.le - 0.012, -T.g - 0.006, T.h + 0.006], [0.008, 0.022, 0.026], 0, { paint: 'tape', role: 'wing' })], FINE),
  tube('tip strobe (left)', [[T.te + 0.012, -T.g - 0.004, T.h + 0.004], [T.te - 0.002, -T.g - 0.004, T.h + 0.004]], 0.004, { role: 'wing', paint: 'strobe', sh: 1, sides: 6, caps: 1, ...FINE }),
];

// ── The small engineering: hinges, balances, drains, ducts, rivet lines ─────────
// What a close look finds on any light aircraft, and what tells a printed kit from a toy.
const hingeX = 1 - CF - 0.006;
const MW_F = 0.44, MW_G = 0.265, MW_H = -0.262, MW_HW = 0.024;   // the main axle, as the gear below has it
const small = [
  // Hinge brackets under the trailing edge, three per flap and three per aileron, each side.
  mirror('hinge brackets', [poly('hinge brackets', [0.18, 0.5, 0.8, 0.95, 1.2, 1.42].flatMap((g) => {
    const a = wingLo(g, hingeX - 0.04, 0), b = wingLo(g, hingeX + 0.01, 0.018), c = wingLo(g, hingeX + 0.05, 0.004);
    return [quad(P3([a[0], g - 0.004, a[2]]), P3([b[0], g - 0.004, b[2]]), P3([b[0], g + 0.004, b[2]]), P3([a[0], g + 0.004, a[2]]), { paint: 'metal', sh: 0.5, role: 'wing' }),
      quad(P3([b[0], g - 0.004, b[2]]), P3([c[0], g - 0.004, c[2]]), P3([c[0], g + 0.004, c[2]]), P3([b[0], g + 0.004, b[2]]), { paint: 'metal', sh: 0.45, role: 'wing' }),
      quad(P3([a[0], g + 0.004, a[2]]), P3([b[0], g + 0.004, b[2]]), P3([c[0], g + 0.004, c[2]]), P3([c[0], g + 0.004, c[2] + 0.002]), { paint: 'metal', sh: 0.7, role: 'wing' })];
  }), FINE)]),
  // Aileron mass balances: a weight on an arm ahead of each aileron's outer end, under the wing.
  mirror('aileron balances', [tube('aileron balance', [wingLo(1.3, 0.62, 0), [wingAt(1.3, 0.5, 0)[0], 1.3, wingAt(1.3, 0.5, 0)[2] - 0.016]], 0.0022, { role: 'aileron', paint: 'metal', sides: 4, ...FINE }),
    tube('balance weight', [[wingAt(1.3, 0.5, 0)[0] + 0.012, 1.3, wingAt(1.3, 0.5, 0)[2] - 0.016], [wingAt(1.3, 0.5, 0)[0] - 0.014, 1.3, wingAt(1.3, 0.5, 0)[2] - 0.016]], 0.0055, { role: 'aileron', paint: 'carbon', sides: 8, caps: 1, ...FINE })]),
  // Tie-down rings and tip skids under each wing, a fuel drain and a vent under each tank.
  mirror('tie-downs', [tube('tie-down ring', range(0, 360, 10).map((d) => { const c = wingLo(1.05, 0.35, 0.012); return [c[0] + Math.cos(d * DEG) * 0.01, 1.05, c[2] + Math.sin(d * DEG) * 0.01 - 0.004]; }), 0.0018, { role: 'wing', paint: 'metal', sides: 4, ...FINE }),
    tube('tip skid', [wingLo(1.5, 0.2, 0), wingLo(1.5, 0.3, 0.014), wingLo(1.5, 0.6, 0.012), wingLo(1.5, 0.75, 0)], 0.003, { role: 'wing', paint: 'carbon', sides: 5, ...FINE }),
    tube('fuel drain', [wingLo(0.48, 0.32, 0), wingLo(0.48, 0.32, 0.01)], 0.0024, { role: 'wing', paint: 'metal', sides: 5, ...FINE }),
    tube('tank vent', [wingLo(0.62, 0.2, 0), wingLo(0.62, 0.22, 0.016), [wingAt(0.62, 0.1, 0)[0], 0.62, wingAt(0.62, 0.22, 0)[2] - 0.018]], 0.0018, { role: 'wing', paint: 'metal', sides: 4, ...FINE })]),
  // Chordwise panel seams on the starboard wing and the inboard port one (the donor's are its own).
  ...[0.38, 0.62, 1.1, 1.3].map((g) => tube('rib seam', range(0.03, 0.72, 8).map((x) => wingUp(g, x, 0.0011)), 0.001, { role: 'wing', paint: 'seam', sides: 3, ...FINE })),
  ...[-0.38, -0.62].map((g) => tube('rib seam', range(0.03, 0.72, 8).map((x) => wingUp(g, x, 0.0011)), 0.001, { role: 'wing', paint: 'seam', sides: 3, ...FINE })),
  ...[-1.05, -1.25].map((g) => tube('donor rib seam', range(0.03, 0.72, 8).map((x) => wingUp(g, x, 0.0011)), 0.0012, { role: 'wing', paint: 'carbon', sides: 3, ...FINE })),
  // The wing root fillets: a fairing up the fuselage's flank over the root's leading and trailing edges.
  mirror('root fillet', [poly('root fillet', range(0.04, 0.96, 12).slice(0, -1).map((x, i, a) => {
    const x1 = i + 1 < a.length ? a[i + 1] : 0.96, A = wingUp(0.1, x, 0.001), B = wingUp(0.1, x1, 0.001);
    return quad(A, B, [B[0], 0.112, B[2] + 0.022 * Math.sin(Math.PI * x1)], [A[0], 0.112, A[2] + 0.022 * Math.sin(Math.PI * x)], { paint: 'hull', sh: 0.7, role: 'body' });
  }), FINE)]),
  // NACA ducts on the cowl's flanks for the cabin air, and a pair of static ports on the tail cone.
  mirror('cabin air ducts', [poly('NACA duct', [...patch([0.66, 0.62, 0.58], range(38, 46, 2), { paint: 'intake', sh: 0.3 }, 0.0026)], FINE)]),
  mirror('static ports', [poly('static port', patch([-0.6, -0.608], [8, 12], { paint: 'metal', sh: 0.9 }, 0.003), FINE)]),
  // Rivet lines down the fuselage's flanks along the old panel joints the rebuild re-riveted.
  mirror('flank rivets', [poly('flank rivets', [-12, 26].flatMap((a) => stationsIn(-0.98, 0.68, range(-0.95, 0.65, 40)).filter((f) => f < GB.f[0] - 0.02 || f > GB.f[1] + 0.02).map((f) =>
    quad(at(f + 0.0022, a - 1.2, 0.0028), at(f - 0.0022, a - 1.2, 0.0028), at(f - 0.0022, a + 1.2, 0.0028), at(f + 0.0022, a + 1.2, 0.0028), { paint: 'rivet', sh: 0.85 }))), FINE)]),
  // A rescue chevron by the canopy latch, and the canopy's outer seal, lit, along each sill.
  mirror('rescue chevron', [poly('rescue chevron', [...patch([-0.24, -0.28], [25, 30], { paint: 'lead', sh: 0.8 }, 0.003), ...patch([-0.24, -0.25], [21, 25], { paint: 'lead', sh: 0.8 }, 0.003)], FINE)]),
  mirror('canopy seal light', [tube('canopy seal', alongF(stationsIn(GB.f[0] + 0.02, GB.f[1] - 0.04), 16.5, 0.0035), 0.0016, { role: 'nacelle', paint: 'led', sh: 1, sides: 3, ...FINE })]),
  // The 2070s' own eyes: an obstacle lidar dome under the chin, scuffed, and a camera blister in
  // each wing tip's leading edge, the port one cracked and taped like everything else on that side.
  group('lidar dome', [pod('lidar', 0, 0, [[0.026, 0.002], [0.02, 0.016], [0.0, 0.024], [-0.02, 0.02], [-0.026, 0.004]], { sides: 18, paint: 'radome', shade: { base: 0.55, amp: 0.4 } })],
    { xf: { t: [0.9, 0, -0.106], s: [1, 1, 0.7] }, ...FINE }),
  { kind: 'drum', name: 'lidar window', f: 0.9, r: 0.02, n: 18, z: [-0.116, -0.108], role: 'nacelle', paint: 'lens', sh: { base: 0.9, alt: 0.1 }, bottom: { sh: 0.6 }, ...FINE },
  mirror('tip cameras', [group('tip camera', [pod('camera', 0, 0, [[0.012, 0.002], [0.006, 0.008], [-0.02, 0.009], [-0.03, 0.002]], { sides: 10, paint: 'carbon' })], { xf: { t: [R(wingAt(1.42, 0.0)[0] + 0.004), 1.42, R(wingAt(1.42, 0.0)[2])] }, ...FINE }),
    group('tip camera lens', [pod('lens', 0, 0, [[0.003, 0.001], [0.0, 0.005]], { sides: 10, role: 'glass', paint: 'lens' })], { xf: { t: [R(wingAt(1.42, 0.0)[0] + 0.016), 1.42, R(wingAt(1.42, 0.0)[2])] }, ...FINE })]),
  tube('camera tape (left)', [[wingAt(-1.42, 0.0)[0] + 0.004, -1.428, wingAt(-1.42, 0.0)[2] + 0.012], [wingAt(-1.42, 0.0)[0] + 0.004, -1.412, wingAt(-1.42, 0.0)[2] - 0.012]], 0.004, { role: 'wing', paint: 'tape', sides: 5, ...FINE }),
  // The hinge line's slot over the flaps and ailerons, dark, each side.
  mirror('hinge slot', [tube('hinge slot', [0.12, 0.5, 0.85, 1.2, 1.46].map((g) => wingUp(g, hingeX, 0.0012)), 0.0016, { role: 'wing', paint: 'seam', sides: 4, ...FINE })]),
  // Trim tabs: a fixed bent tab on the rudder's trailing edge, and a tab on the left elevator.
  { kind: 'blade', name: 'rudder tab', role: 'rudder', paint: 'alu', t: 0.0015, sh: [0.8, 0.6], outline: [[-1.096, 0.1], [-1.116, 0.1], [-1.118, 0.16], [-1.098, 0.16]], ...FINE },
  poly('elevator tab', [quad([-1.036, -0.12, 0.081], [-1.036, -0.2, 0.082], [-1.05, -0.2, 0.082], [-1.05, -0.12, 0.081], { paint: 'alu', sh: 0.8, role: 'elevator' }),
    quad([-1.05, -0.12, 0.079], [-1.05, -0.2, 0.08], [-1.036, -0.2, 0.08], [-1.036, -0.12, 0.079], { paint: 'alu', sh: 0.5, role: 'elevator' })], FINE),
  // A brake line down each leg, and the wheel's valve.
  mirror('brake lines', [tube('brake line', [[0.462, 0.09, -0.1], [0.45, 0.185, -0.19], [MW_F + 0.02, MW_G - MW_HW - 0.012, MW_H + 0.03]], 0.0016, { role: 'gear', paint: 'lead', sides: 3, ...FINE })]),
];

// ── The tail ────────────────────────────────────────────────────────────────────
// A swept fin with a primer-red spare rudder from another kit, a tapered tailplane, a beacon on the
// fin, a strobe at the tail cone, a whip aerial taped to the fin, and the recorder bay.
const FN = [
  { g: 0.08, le: -0.78, te: -1.075, h: 0, t: 1.1 },
  { g: 0.3, le: -0.94, te: -1.1, h: 0, t: 0.92 },
  { g: 0.355, le: -1.0, te: -1.105, h: 0, t: 0.7 },
];
const fin = foil('fin', FN, { axis: 'g', role: 'fin', paint: 'hull', nx: 11 });
const rudder = { ...ctrlOn('rudder', FN[0], FN[1], 0.0, 0.98, 0.34, { axis: 'g', sh: 0.7 }), paint: 'primer' };
const TP = [
  { g: 0.03, le: -0.82, te: -1.045, h: 0.078, t: 0.95 },
  { g: 0.44, le: -0.92, te: -1.035, h: 0.084, t: 0.75 },
];
const tailplane = foil('tailplane', TP, { role: 'stab', paint: 'hull', nx: 9, bands: [{ x0: 0, x1: 0.06, paint: 'edge' }] });
const elevators = { ...ctrlOn('elevator', TP[0], TP[1], 0.06, 0.97, 0.38), paint: 'hull' };
const RF = CR76_RECORDER;
const recF = (RF.f[0] + RF.f[1]) / 2;
const tail = [
  { kind: 'drum', name: 'fin beacon base', f: -1.02, r: 0.009, n: 10, z: [0.352, 0.358], role: 'fin', paint: 'carbon', sh: { base: 0.6 }, top: { sh: 0.8 }, ...FINE },
  { kind: 'drum', name: 'fin beacon', f: -1.02, r: 0.0065, n: 10, z: [0.358, 0.37], role: 'fin', paint: 'beacon', sh: { base: 0.9 }, top: { sh: 1 }, ...FINE },
  tube('tail strobe', [[CR76_TAIL[0] + 0.006, 0, CR76_TAIL[2]], [CR76_TAIL[0] - 0.012, 0, CR76_TAIL[2]]], 0.005, { role: 'body', paint: 'strobe', sh: 1, sides: 6, caps: 1, ...FINE }),
  mirror('tailplane tip lights', [{ kind: 'drum', name: 'tailplane tip light', f: -0.975, g: 0.442, r: 0.005, n: 8, z: [0.08, 0.09], role: 'stab', paint: 'led', sh: { base: 1 }, top: { sh: 1 }, ...FINE }]),
  // The whip aerial: a straightened coat hanger taped up the left of the fin.
  tube('whip aerial', [[-0.86, -0.012, 0.1], [-0.9, -0.012, 0.24], [-0.94, -0.012, 0.42]], 0.0012, { role: 'fin', paint: 'wire', sides: 3, ...FINE }),
  ...[0.13, 0.2].map((h, i) => tube('aerial tape ' + i, [[-0.865 - (h - 0.1) * 0.29, -0.012, h - 0.01], [-0.865 - (h - 0.1) * 0.29, -0.012, h + 0.01]], 0.004, { role: 'fin', paint: 'tape', sides: 5, ...FINE })),
  // The recorder bay. The hull is open over it, so the bay has a back, a roof and a floor, and in it
  // the box: orange, two white reflective bands, a locator on its face and a bracket under it.
  poly('recorder bay', [
    quad([RF.f[1], 0.004, 0.012], [RF.f[1], 0.004, 0.09], [RF.f[0], 0.004, 0.09], [RF.f[0], 0.004, 0.012], { paint: 'cowlIn', sh: 0.35, role: 'body' }),
    quad([RF.f[1], 0.004, 0.09], [RF.f[1], 0.06, 0.09], [RF.f[0], 0.06, 0.09], [RF.f[0], 0.004, 0.09], { paint: 'cowlIn', sh: 0.2, role: 'body' }),
    quad([RF.f[0], 0.004, 0.014], [RF.f[0], 0.06, 0.014], [RF.f[1], 0.06, 0.014], [RF.f[1], 0.004, 0.014], { paint: 'cowlIn', sh: 0.4, role: 'body' }),
  ], FINE),
  poly('flight recorder', [
    ...slab([recF, 0.024, 0.048], [0.085, 0.036, 0.05], 0, { paint: 'recorder', role: 'body' }),
    ...[-0.02, 0.02].flatMap((df) => slab([recF + df, 0.0245, 0.048], [0.008, 0.037, 0.051], 0, { paint: 'reflect', role: 'body' })),
    ...slab([recF + 0.03, 0.0428, 0.06], [0.012, 0.002, 0.012], 0, { paint: 'locator', role: 'body' }),
    ...slab([recF, 0.024, 0.02], [0.09, 0.03, 0.006], 0, { paint: 'metal', role: 'body' }),
  ], FINE),
  // The hatch: hanging off the bay's lower edge by its safety wire.
  poly('recorder hatch', [quad(addv(at(RF.f[1], -24, 0.006), [0, 0.006, -0.002]), addv(at(RF.f[1], -50, 0.008), [0.004, 0.022, -0.02]), addv(at(RF.f[0], -50, 0.008), [0.004, 0.022, -0.02]), addv(at(RF.f[0], -24, 0.006), [0, 0.006, -0.002]), { paint: 'hull', sh: 0.55, role: 'body' })], FINE),
  tube('hatch safety wire', [at(recF, -20, 0.003), addv(at(recF, -44, 0.008), [0.002, 0.016, -0.014])], 0.0008, { role: 'body', paint: 'wire', sides: 3, ...FINE }),
  poly('recorder hatch rivets', rivets(RF.f[0] - 0.006, RF.f[1] + 0.006, RF.a[0] - 4, RF.a[1] + 4, 0.003, 6, 3), FINE),
];

// ── Gear: composite spring legs, one spat left, a sprung tailwheel ──────────────
// The axles are the Fly Baby's own, so the 2076 airframe stands where the old one did.
const MW = { f: MW_F, g: MW_G, h: MW_H, r: 0.068, hw: MW_HW };
const TW = { f: -0.955, h: 0.004, r: 0.024, hw: 0.01 };
const legOf = (s) => [
  faired('spring leg', [[0.47, s * 0.08, -0.1], [0.455, s * 0.18, -0.19], [MW.f + 0.004, s * (MW.g - MW.hw - 0.01), MW.h + 0.012]], 0.06, 0.012, { role: 'gear', paint: 'carbon', ...FINE }),
  tube('leg root fitting', [[0.5, s * 0.075, -0.1], [0.43, s * 0.075, -0.102]], 0.009, { role: 'gear', paint: 'metal', sides: 6, ...FINE }),
  { ...wheel('main wheel', [MW.f, s * MW.g, MW.h], MW.r, MW.hw, 18), ...FINE },
  tube('hub', [[MW.f, s * (MW.g + MW.hw - 0.002), MW.h], [MW.f, s * (MW.g + MW.hw + 0.006), MW.h]], 0.03, { role: 'gear', paint: 'metal', sides: 12, caps: 1, ...FINE }),
  tube('brake disc', [[MW.f, s * (MW.g - MW.hw - 0.002), MW.h], [MW.f, s * (MW.g - MW.hw - 0.006), MW.h]], 0.046, { role: 'gear', paint: 'metal', sides: 16, caps: 1, ...FINE }),
  tube('brake caliper', [[MW.f + 0.03, s * (MW.g - MW.hw - 0.008), MW.h + 0.03], [MW.f + 0.044, s * (MW.g - MW.hw - 0.008), MW.h + 0.012]], 0.008, { role: 'gear', paint: 'trim', sides: 6, ...FINE }),
  tube('axle', [[MW.f, s * (MW.g - MW.hw - 0.012), MW.h], [MW.f, s * (MW.g - MW.hw - 0.002), MW.h]], 0.009, { role: 'gear', paint: 'metal', sides: 8, ...FINE }),
];
const spat = group('spat (right)', [pod('spat', 0, 0, [[0.11, 0.006], [0.08, 0.05, 0.0, 0.03], [0.02, 0.07, 0.0, 0.036], [-0.05, 0.062, 0.002, 0.032], [-0.12, 0.02, 0.006, 0.014]], { sides: 14, paint: 'hull', role: 'gear', shade: { base: 0.6, amp: 0.34 } })],
  { xf: { t: [MW.f, MW.g, MW.h + 0.022] }, ...FINE });
const spatDetail = [
  // A crack up the spat's flank, taped, and the trim's flash along its top.
  tube('spat tape', [[MW.f + 0.03, MW.g + 0.037, MW.h + 0.0], [MW.f + 0.0, MW.g + 0.039, MW.h + 0.04]], 0.005, { role: 'gear', paint: 'tape', sides: 5, ...FINE }),
  tube('spat flash', [[MW.f + 0.08, MW.g, MW.h + 0.07], [MW.f - 0.04, MW.g, MW.h + 0.083]], 0.004, { role: 'gear', paint: 'trim', sides: 5, ...FINE }),
  // On the left, the spat's bracket, sheared, where the spat used to be.
  tube('spat bracket (left)', [[MW.f, -(MW.g - MW.hw - 0.004), MW.h + 0.02], [MW.f + 0.03, -(MW.g - MW.hw - 0.004), MW.h + 0.05], [MW.f + 0.034, -(MW.g - 0.004), MW.h + 0.056]], 0.0035, { role: 'gear', paint: 'metal', sides: 4, ...FINE }),
];
const mainGear = group('main gear', [...legOf(1), ...legOf(-1), spat, ...spatDetail]);
const tailGear = group('tailwheel', [
  tube('tail spring', [[-0.86, 0, 0.016], [-0.93, 0, 0.008], [TW.f + 0.004, 0, TW.h + 0.01]], 0.0045, { role: 'gear', paint: 'carbon', sides: 5 }),
  tube('tail fork', [[TW.f + 0.008, -TW.hw - 0.004, TW.h + 0.02], [TW.f, -TW.hw - 0.004, TW.h], [TW.f, TW.hw + 0.004, TW.h], [TW.f + 0.008, TW.hw + 0.004, TW.h + 0.02]], 0.003, { role: 'gear', paint: 'metal', sides: 5 }),
  wheel('tailwheel', [TW.f, 0, TW.h], TW.r, TW.hw, 10),
  tube('steering horn', [[TW.f + 0.012, -0.022, TW.h + 0.022], [TW.f + 0.012, 0.022, TW.h + 0.022]], 0.002, { role: 'gear', paint: 'metal', sides: 4 }),
], FINE);

// ── Turtle deck and belly: aerials, the beacon, a broken blade ──────────────────
const deck = [
  group('GNSS puck', [pod('gnss', 0, 0, [[0.016, 0.002], [0.01, 0.009], [-0.01, 0.009], [-0.016, 0.002]], { sides: 12, paint: 'radome' })], { xf: { t: [-0.5, 0, R(at(-0.5, 90)[2] + 0.001)], s: [1, 1, 0.5] }, ...FINE }),
  group('VHF blade', [{ kind: 'blade', name: 'VHF blade', role: 'body', paint: 'carbon', t: 0.003, sh: [0.75, 0.6], outline: [[-0.6, R(at(-0.6, 90)[2] - 0.004)], [-0.625, R(at(-0.6, 90)[2] + 0.05)], [-0.64, R(at(-0.6, 90)[2] + 0.05)], [-0.66, R(at(-0.66, 90)[2] - 0.004)]] }], FINE),
  // Under the belly, the transponder blade broken off at its root, a stub and a wire.
  group('transponder stub', [{ kind: 'blade', name: 'transponder stub', role: 'body', paint: 'carbon', t: 0.003, sh: [0.75, 0.6], outline: [[-0.18, -0.105], [-0.19, -0.122], [-0.2, -0.118], [-0.21, -0.126], [-0.215, -0.1]] }], FINE),
  tube('stub wire', [[-0.2, 0, -0.12], [-0.205, 0.006, -0.14], [-0.2, 0.002, -0.155]], 0.0008, { role: 'body', paint: 'lead', sides: 3, ...FINE }),
  { kind: 'drum', name: 'belly beacon', f: 0.06, r: 0.008, n: 10, z: [-0.124, -0.114], role: 'body', paint: 'beacon', sh: { base: 0.9 }, bottom: { sh: 1 }, ...FINE },
  tube('waist light (right)', alongF(stationsIn(-0.6, GB.f[0] - 0.01), -9, 0.004), 0.0022, { role: 'body', paint: 'led', sh: 1, sides: 4, ...FINE }),
  tube('waist light (left)', alongF(stationsIn(-0.6, GB.f[0] - 0.01), 189, 0.004), 0.0022, { role: 'body', paint: 'led', sh: 1, sides: 4, ...FINE }),
  // The pine-tree air freshener from the old tub, hung on the hoop where you can see it from outside.
  tube('freshener string', [at(-0.27, 90, -0.02), [-0.27, 0.0, R(at(-0.27, 90)[2] - 0.05)]], 0.0006, { role: 'interior', paint: 'wire', sides: 3, ...FINE }),
  poly('freshener', [{ role: 'interior', paint: 'leaf', two: true, p: P3s([[-0.27, -0.008, at(-0.27, 90)[2] - 0.05], [-0.27, 0.008, at(-0.27, 90)[2] - 0.05], [-0.27, 0.0, at(-0.27, 90)[2] - 0.075]]) }], FINE),
];

// ── The coarse body, for range ──────────────────────────────────────────────────
const coarse = [
  loft('fuselage (far)', 12, ST.filter((_, i) => i % 3 === 0 || i === ST.length - 1), {
    ...COARSE, paint: 'hull', capFore: { kind: 'flat', paint: 'carbon' }, capAft: { kind: 'apex', at: CR76_TAIL },
    regions: [{ at: [0.34, 0.1, -0.14], k: [1, 2, 3, 4], role: 'glass', tint: GLASS }],
  }),
  cone('spinner (far)', 1.04, 0, PH, 0.045, [1.115, 0, PH], { paint: 'spinner', n: 8, role: 'nacelle', ...COARSE }),
  { kind: 'blade', name: 'winglet (far)', role: 'wing', paint: 'hull', t: 0.004, sh: [0.82, 0.6], ...COARSE, outline: [[T.le, T.h], [T.le - 0.13, T.h + 0.105], [T.te + 0.06, T.h + 0.1], [T.te, T.h]] },
  mirror('gear (far)', [
    tube('main leg (far)', [[0.47, 0.08, -0.1], [MW.f, MW.g - MW.hw, MW.h]], 0.01, { role: 'gear', paint: 'carbon', sides: 4, ...COARSE }),
    { ...wheel('main tyre (far)', [MW.f, MW.g, MW.h], MW.r, MW.hw, 8), ...COARSE },
  ]),
  { ...wheel('tailwheel (far)', [TW.f, 0, TW.h], TW.r, TW.hw, 6), ...COARSE },
  { kind: 'drum', name: 'recorder (far)', f: recF, g: 0.03, r: 0.03, n: 6, z: [0.03, 0.07], role: 'body', paint: 'recorder', sh: { base: 0.8 }, ...COARSE },
];
// The far winglet sits at the tip: move it there.
coarse[2] = group('winglet (far)', [coarse[2]], { xf: { t: [0, T.g + 0.002, 0] }, ...COARSE });

// ── Rotors and lamps ────────────────────────────────────────────────────────────
const rotors = [{ at: [PF, 0, PH], plane: 'fore', r: CR76_PROP.r, blades: CR76_PROP.blades, lead: 0.85, spinMul: 1, phase: 0.4 }];
const lamps = [
  { at: [R(T.le + 0.008), R(-T.g - 0.012), R(T.h + 0.012)], n: [0.3, -1, 0], rgb: '255,55,55', kind: 'steady' },
  { at: [R(T.le + 0.012), R(T.g + 0.004), R(T.h + 0.004)], n: [0.3, 1, 0], rgb: '60,255,95', kind: 'steady' },
  { at: [R(T.te - 0.006), R(-T.g - 0.004), R(T.h + 0.004)], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [R(T.te - 0.006), R(T.g + 0.004), R(T.h + 0.004)], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [R(CR76_TAIL[0] - 0.014), 0, CR76_TAIL[2]], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [-1.02, 0, 0.372], n: [0, 0, 1], rgb: '255,90,70', kind: 'beacon' },
  { at: [0.06, 0, -0.126], n: [0, 0, -1], rgb: '255,90,70', kind: 'beacon' },
  // The recorder's locator, flashing amber in the hole where its hatch was.
  { at: [R(recF + 0.03), 0.045, 0.06], n: [0, 1, 0], rgb: '255,150,40', kind: 'strobe' },
];

const doc = {
  id: 'wreck_2076',
  kind: 'mesh',
  params: {
    name: 'Carcass 2076',
    note: 'CONCEPT, generated by scripts/shapes/concepts/carcass-2076.mjs (edit that, not this). The Carcass fifty years on: a 2070s single-seat composite homebuilt after the Sonex Onex and the printed-carbon kits that followed it, found downed and flown again. A low tapered wing with a splice station, the port outer panel and aileron a donor\'s in sun-faded blue, plated and taped on; the starboard winglet, and a snapped stub on the port tip with a bicycle lamp taped on as its nav light; one blown bubble, cracked and taped, a polycarbonate patch riveted over a hole; a biofuel flat-twin with its starboard cowl side missing, so the finned cylinder shows; a three-blade prop on a spare spinner; a road sign riveted over the port flank as on the Fly Baby; a primer-red spare rudder; composite spring legs, one spat left; the flight recorder in the tail cone behind a hatch that hangs off its safety wire, its locator flashing. She stands on the Fly Baby\'s axles at its 12.5°. A variant of the wreck mesh, worn as the Carcass 2076 edition.',
    groundPitch: 12.5,
    navLamps: null,
    hull: 'fuselage',
    lamps,
    rotors,
    finish: 'satin',
    paints: {
      hull: { rgb: [214, 210, 196], livery: 'base', mat: 'satin' },
      trim: { rgb: [38, 138, 134], livery: 'trim' },
      belly: { rgb: [150, 150, 142], livery: 'fixed', mat: 'satin' },
      donor: { rgb: [96, 122, 150], livery: 'fixed', mat: 'matte' },
      primer: { rgb: [150, 62, 46], livery: 'fixed', mat: 'matte' },
      glare: { rgb: [34, 36, 34], livery: 'fixed', mat: 'matte' },
      edge: { rgb: [70, 72, 70], livery: 'fixed', mat: 'matte' },
      walk: { rgb: [44, 44, 42], livery: 'fixed', mat: 'matte' },
      frame: { rgb: [30, 32, 32], livery: 'fixed', mat: 'gloss' },
      seam: { rgb: [96, 98, 94], livery: 'fixed', mat: 'matte' },
      carbon: { rgb: [38, 40, 42], livery: 'fixed', mat: 'satin' },
      metal: { rgb: [156, 160, 162], livery: 'fixed', mat: 'bare' },
      alu: { rgb: [176, 180, 182], livery: 'fixed', mat: 'bare' },
      rivet: { rgb: [210, 212, 214], livery: 'fixed', mat: 'bare' },
      sign: { rgb: [222, 186, 38], livery: 'fixed', mat: 'gloss' },
      signInk: { rgb: [30, 30, 30], livery: 'fixed', mat: 'gloss' },
      tape: { rgb: [158, 160, 156], livery: 'fixed', mat: 'satin' },
      gaffer: { rgb: [28, 28, 30], livery: 'fixed', mat: 'matte' },
      soot: { rgb: [48, 42, 38], livery: 'fixed', mat: 'matte' },
      oil: { rgb: [62, 54, 40], livery: 'fixed', mat: 'gloss' },
      exhaust: { rgb: [126, 66, 32], livery: 'fixed', mat: 'matte' },
      intake: { rgb: [22, 24, 26], livery: 'fixed', mat: 'matte' },
      cowlIn: { rgb: [26, 26, 28], livery: 'fixed', mat: 'matte' },
      engine: { rgb: [56, 58, 60], livery: 'fixed', mat: 'satin' },
      fins: { rgb: [150, 154, 156], livery: 'fixed', mat: 'bare' },
      lead: { rgb: [180, 40, 32], livery: 'fixed', mat: 'satin' },
      bio: { rgb: [214, 160, 40], livery: 'fixed', mat: 'gloss' },
      spinner: { rgb: [30, 30, 32], livery: 'fixed', mat: 'matte' },
      copper: { rgb: [184, 110, 66], livery: 'fixed', mat: 'bare' },
      wire: { rgb: [70, 72, 74], livery: 'fixed', mat: 'bare' },
      crack: { rgb: [226, 236, 236], livery: 'fixed', mat: 'gloss' },
      recorder: { rgb: [240, 110, 24], livery: 'fixed', mat: 'gloss' },
      reflect: { rgb: [236, 238, 236], livery: 'fixed', mat: 'gloss' },
      locator: { rgb: [255, 170, 60], livery: 'fixed', mat: 'gloss' },
      radome: { rgb: [210, 210, 204], livery: 'fixed', mat: 'satin' },
      lens: { rgb: [20, 34, 52], livery: 'fixed', mat: 'gloss' },
      led: { rgb: [120, 236, 210], livery: 'fixed', mat: 'matte' },
      navR: { rgb: [230, 60, 50], livery: 'fixed', mat: 'gloss' },
      navG: { rgb: [210, 220, 214], livery: 'fixed', mat: 'gloss' },
      beacon: { rgb: [235, 70, 56], livery: 'fixed', mat: 'gloss' },
      strobe: { rgb: [240, 244, 248], livery: 'fixed', mat: 'gloss' },
      interior: { rgb: [42, 44, 44], livery: 'fixed', mat: 'matte' },
      seat: { rgb: [70, 66, 58], livery: 'fixed', mat: 'satin' },
      strap: { rgb: [226, 108, 30], livery: 'fixed', mat: 'matte' },
      screen: { rgb: [60, 190, 170], livery: 'fixed', mat: 'gloss' },
      deadpage: { rgb: [10, 12, 12], livery: 'fixed', mat: 'gloss' },
      leaf: { rgb: [60, 168, 84], livery: 'fixed', mat: 'matte' },
      repair: { rgb: [92, 96, 90], livery: 'fixed', mat: 'satin' },
    },
    parts: [
      fuselage, bubble, ...cracks, canopyTape, polyPatch, ...frames, ...room, ...trim, ...patches, ...nose, ...engine,
      wing, surfaces, ...wingDetail, winglet, wingletStub, ...tipLamps, ...small,
      fin, rudder, tailplane, elevators, ...tail,
      mainGear, tailGear, ...deck,
      ...coarse,
    ],
  },
};

const v = validateMesh(doc.params, doc.id);
if (v.errors.length) { console.log('ERRORS', v.errors.slice(0, 12)); process.exit(1); }
if (v.warnings?.length) console.log('warnings', v.warnings.slice(0, 8));
const n1 = compileMesh(doc.params, { detail: 1 }).faces.length, n0 = compileMesh(doc.params, { detail: 0 }).faces.length;
writeFileSync(new URL('../../../content/vehicle_models/mesh_wreck_2076.json', import.meta.url), formatMesh(doc));
console.log('mesh_wreck_2076.json:', n1, 'faces near,', n0, 'far');
