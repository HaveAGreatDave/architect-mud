// The Grasshopper 2076 concept: writes content/vehicle_models/mesh_grasshopper_2076.json.
//
//   node scripts/shapes/concepts/grasshopper-2076.mjs
//   then: npm run vehicles:bake
//
// The Grasshopper fifty years on, after the Airbus Zephyr: still a tandem two-seat spotter that
// lands on grass, but electric and solar. A very long, high-aspect wing skinned in solar cells sits on
// a pylon over a slender pod; the pilot rides in front under a bubble, the observer behind watches a
// gimballed sensor ball under the chin; one big quiet propeller on the nose where the Cub's was, and
// the Cub's taildragger stance on carbon spring legs and tundra tyres. It is a variant of the
// grasshopper mesh (mesh_grasshopper.json `variants`), worn as the Grasshopper 2076 factory edition.
//
// ⚠ THIS OVERWRITES THE JSON. Edit this file, not the mesh in the Modelshop.
//
// Two bodies in one file. Everything fine is `minDetail: 1`; a coarse body with `maxDetail: 0`
// stands in at range. The wing, fin and tailplane are foil() groups, which carry their own two LODs.
//
// Frame: f fore, g right, h up, in the Cub's units (spinner apex at f 0.865, mains at f 0.34 on the
// ground at h -0.317, tailwheel at f -1.005), so she sits three-point at the Cub's 11° as the Cub does.
// Angles on a section are lib.mjs's: 0 = right waterline, +90 = crown, -90 = keel.
import { writeFileSync } from 'node:fs';
import { R, P3, skin, loft, pod, foil, foilPt, lerpSt, ctrlOn, tube, mirror, group, poly as rawPoly, quad, cone, wheel, faired, DEG } from '../fw-meshes/lib.mjs';
const { formatMesh, validateMesh, compileMesh } = await import('../../../client/shared/vehicle-mesh.js');
const { GH76_STATIONS, GH76_TAIL, GH76_GLASS, GH76_FRAMES, GH76_INSIDE, GH76_WING, GH76_PROP, GH76_BALL } = await import('../../../client/shared/cabin-grasshopper-2076.js');

const FINE = { minDetail: 1 }, COARSE = { maxDetail: 0 };
// Every poly face needs a role; trim and fittings are 'nacelle' unless they say otherwise.
const poly = (name, faces, extra) => rawPoly(name, faces.map((f) => ({ role: 'nacelle', ...f })), extra);
const GLASS = [58, 92, 112];
const lerp = (a, b, t) => a + (b - a) * t;
const range = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));
const P3s = (a) => a.map(P3);
const addv = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// ── The pod ─────────────────────────────────────────────────────────────────────
// Stated once in client/shared/cabin-grasshopper-2076.js, which the cockpit is built off too.
const ST = GH76_STATIONS;
const at = (f, a, out = 0) => skin(ST, f, a * DEG, out);
const NS = 36;
// The belly panels in the fixed grey: k 24..34 of 36 (about -120° to -60°).
const BELLY_K = Array.from({ length: 11 }, (_, i) => 24 + i);
// The cowl in the trim colour: the first two bays.
const fuselage = loft('fuselage', NS, ST, {
  ...FINE, paint: 'hull',
  note: 'The shell. Glass, frames, the canopy, seams, the cell strips and trim are separate parts laid a hair proud of it.',
  capFore: { kind: 'flat', sh: 0.5, paint: 'carbon' },
  capAft: { kind: 'apex', at: GH76_TAIL, paint: 'trim' },
  regions: [
    { at: ST.slice(2, -1).map((s) => s.f), k: BELLY_K, paint: 'belly' },
    { at: [0.8, 0.77], k: 'all', paint: 'trim' },
  ],
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
// The pod's own stations inside a run, plus its ends, fore to aft: a patch on them bends with the skin.
const stationsIn = (f0, f1, extra = []) => [...new Set([f1, ...ST.map((s) => s.f).filter((f) => f < f1 && f > f0), ...extra, f0])].sort((a, b) => b - a);

// ── Glass ───────────────────────────────────────────────────────────────────────
// The pilot's bubble, sill to sill over the crown, from the windscreen's foot to the hoop.
const B = GH76_GLASS.bubble, RW = GH76_GLASS.rear;
const BUB_F = stationsIn(B.f[0], B.f[1], [0.6, 0.58, 0.515, 0.445, 0.375, 0.305, 0.235, 0.2]);
const bubble = poly('canopy bubble', patch(BUB_F, range(B.a[0], B.a[1], 38), { role: 'glass', tint: GLASS }), FINE);
// The observer's windows, one each side of the wing pylon.
const REAR_F = stationsIn(RW.f[0], RW.f[1], [0.09, -0.01]);
const rearGlass = mirror('rear windows', [poly('rear window', patch(REAR_F, range(RW.a[0], RW.a[1], 10), { role: 'glass', tint: GLASS }), FINE)]);

// Frames: dark rails standing just proud of the glass.
const FR = (name, pts, r = 0.0042) => tube(name, pts, r, { role: 'nacelle', paint: 'frame', sh: 0.5, sides: 5, ...FINE });
const H = GH76_FRAMES.hoop;
const frames = [
  FR('windscreen foot', roundF(B.f[1], range(B.a[0] - 2, B.a[1] + 2, 30), 0.0042), 0.005),
  FR('canopy hoop', roundF(H, range(B.a[0] - 2, B.a[1] + 2, 30), 0.0045), 0.0058),
  ...[0, 1].flatMap((s) => {
    const A = mirA(s), side = s ? 'left' : 'right';
    return [
      FR('canopy sill (' + side + ')', alongF(stationsIn(RW.f[0], B.f[1]), A(B.a[0] - 1.5)), 0.0046),
      FR('rear window header (' + side + ')', alongF(REAR_F, A(RW.a[1] + 1.5)), 0.004),
      FR('rear window post (' + side + ')', roundF(RW.f[0], range(A(RW.a[0] - 1.5), A(RW.a[1] + 1.5), 6)), 0.004),
    ];
  }),
];

// ── The canopy's fittings, seams and the step ───────────────────────────────────
// The bubble hinges up and forward at the windscreen foot on a gas strut each side; a latch handle
// on the hoop, a lit seal along the sill, a step and a hand hold on the right for climbing in.
const SEAM = (name, pts, r = 0.0024) => tube(name, pts, r, { role: 'nacelle', paint: 'seam', sh: 0.4, sides: 4, ...FINE });
const canopy = [
  ...[0, 1].flatMap((s) => {
    const A = mirA(s), side = s ? 'left' : 'right', sg = s ? -1 : 1;
    return [
      tube('canopy strut (' + side + ')', [at(0.6, A(10), 0.006), at(0.36, A(12), 0.007)], 0.0028, { role: 'gear', paint: 'metal', sh: 0.85, sides: 5, ...FINE }),
      tube('canopy hinge (' + side + ')', [at(0.632, A(10), 0.004), at(0.61, A(10), 0.006)], 0.0055, { role: 'nacelle', paint: 'carbon', sides: 6, ...FINE }),
      tube('sill light (' + side + ')', alongF(stationsIn(RW.f[0], B.f[1] - 0.01), A(B.a[0] - 5), 0.004), 0.0026, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
      // The latch: a short lever on the hoop at the sill, in a recess.
      poly('latch recess (' + side + ')', patch([0.175, 0.15], [A(16), A(26)], { paint: 'seam' }, 0.0026), FINE),
      tube('latch handle (' + side + ')', [at(0.17, A(18), 0.008), at(0.155, A(24), 0.008)], 0.0032, { role: 'nacelle', paint: 'metal', sh: 0.9, sides: 6, ...FINE }),
      // The battery bay door below the sill, between the seats.
      SEAM('battery bay seam (' + side + ')', [...roundF(0.3, range(A(-50), A(-8), 6), 0.0024), ...alongF(range(0.3, 0.02, 6), A(-8), 0.0024).slice(1),
        ...roundF(0.02, range(A(-8), A(-50), 6), 0.0024).slice(1), ...alongF(range(0.02, 0.3, 6), A(-50), 0.0024).slice(1)]),
      ...[0.26, 0.06].map((f) => tube('bay latch (' + side + ')', [at(f, A(-30), 0.004), at(f - 0.018, A(-30), 0.004)], 0.0026, { role: 'nacelle', paint: 'metal', sides: 5, ...FINE })),
      // Cooling slots for the pack, aft of the bay.
      poly('pack vents (' + side + ')', range(-0.03, -0.12, 5).flatMap((f) => patch([f, f - 0.008], [A(-38), A(-14)], { paint: 'intake', sh: 0.3 }, 0.0024)), FINE),
      // A step under the bubble's sill, the Cub's step kept.
      tube('step (' + side + ')', [at(0.27, A(-62), 0.002), [0.27, sg * 0.118, -0.08], [0.22, sg * 0.118, -0.08], at(0.22, A(-62), 0.002)], 0.0035, { role: 'gear', paint: 'metal', sides: 5, ...FINE }),
    ];
  }),
  // The charge port on the left flank: a lit ring round a recessed socket under a flap.
  poly('charge port door', patch([-0.16, -0.21], [180 + 6, 180 + 26], { paint: 'carbon' }, 0.003), FINE),
  tube('charge port ring', range(0, 360, 10).map((d) => { const c = at(-0.185, 196, 0.004); return [c[0] + Math.cos(d * DEG) * 0.011, c[1] - 0.001, c[2] + Math.sin(d * DEG) * 0.011]; }), 0.0018, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
];

// ── Trim: the cheatline, the anti-glare, the belly ──────────────────────────────
const trimFs = stationsIn(-0.98, 0.77);
const trim = [
  mirror('cheatline', [poly('cheatline', patch(trimFs.filter((f) => f <= 0.72), [-14, -6], { paint: 'trim' }, 0.0018), FINE)]),
  poly('anti-glare', patch(stationsIn(B.f[1] + 0.004, 0.71), range(40, 140, 10), { paint: 'glare' }, 0.0018), FINE),
  // A tail flash up the boom, in the trim colour, with a thin LED line along its top edge.
  mirror('tail flash', [poly('tail flash', patch(stationsIn(-0.98, -0.56), [6, 46], { paint: 'trim' }, 0.0018), FINE),
    tube('tail flash light', alongF(stationsIn(-0.96, -0.6), 48, 0.003), 0.002, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE })]),
  // Access panels down the boom: a seam ring every bay, and a service hatch each side.
  ...[-0.34, -0.54, -0.74].map((f) => SEAM('boom seam', roundF(f, range(-90, 270, 24), 0.0018), 0.0018)),
  mirror('boom hatches', [SEAM('boom hatch', [...roundF(-0.38, range(-20, 20, 4), 0.0022), ...alongF(range(-0.38, -0.5, 4), 20, 0.0022).slice(1), ...roundF(-0.5, range(20, -20, 4), 0.0022).slice(1), ...alongF(range(-0.5, -0.38, 4), -20, 0.0022).slice(1)])]),
];

// ── The nose: the motor's cowl, the spinner, the cooling ────────────────────────
// An electric motor in a slim cowl: an annular inlet behind the spinner, louvres down each cheek,
// the cowl's seam, and a big spinner in the Cub's straw yellow.
const PF = GH76_PROP.f, PH = GH76_PROP.h;
const nose = [
  group('cooling inlet', [pod('inlet lip', 0, 0, [[0.803, 0.0405], [0.797, 0.0425], [0.788, 0.042]], { sides: 18, paint: 'metal' })], { xf: { t: [0, 0, PH] }, ...FINE }),
  mirror('cowl louvres', [poly('cowl louvres', range(0.75, 0.68, 4).flatMap((f) => [
    ...patch([f, f - 0.009], [-12, 28], { paint: 'intake', sh: 0.3 }, 0.0024),
  ]), FINE)]),
  SEAM('cowl seam', roundF(0.71, range(-90, 270, 30), 0.0022), 0.0022),
  mirror('cowl fasteners', [poly('fasteners', range(-60, 80, 7).flatMap((a) => patch([0.718, 0.712], [a - 2, a + 2], { paint: 'metal', sh: 0.85 }, 0.0028)), FINE)]),
  { kind: 'drum', name: 'spinner backplate', f: 0, r: 0.041, n: 20, z: [0, 0], role: 'nacelle', paint: 'spinner', ...FINE, note: 'placeholder, replaced below' },
  cone('spinner', PF - 0.008, 0, PH, 0.039, [0.875, 0, PH], { paint: 'spinner', n: 20, role: 'nacelle', ...FINE }),
  cone('spinner tip', 0.865, 0, PH, 0.006, [0.877, 0, PH], { paint: 'metal', n: 10, role: 'nacelle', ...FINE }),
];
// A drum stands along h, so the backplate is a short tube along f instead.
nose[4] = tube('spinner backplate', [[0.8, 0, PH], [PF - 0.008, 0, PH]], 0.041, { role: 'nacelle', paint: 'spinner', sides: 20, caps: 1, ...FINE });
// The blade roots, where the drawn blades start: three scimitar cuffs out of the spinner.
for (let k = 0; k < GH76_PROP.blades; k++) {
  const a = (k / GH76_PROP.blades) * Math.PI * 2 + 0.3;
  nose.push(tube('blade cuff', [[PF + 0.006, Math.cos(a) * 0.026, PH + Math.sin(a) * 0.026], [PF + 0.002, Math.cos(a) * 0.052, PH + Math.sin(a) * 0.052]], 0.0075, { role: 'nacelle', paint: 'carbon', sides: 6, ...FINE }));
}

// ── The sensor ball under the chin ──────────────────────────────────────────────
// A gimballed electro-optical turret: a mast out of a faired base, a yoke, and the ball with its two
// windows (the day camera and the thermal) and a laser ranger's small lens, all looking forward.
const BL = GH76_BALL;
const sphere = (r, n = 9) => range(-1, 1, n).map((u) => { const c = Math.cos(Math.asin(u)); return [u * r, Math.max(0.0015, c * r)]; }).reverse();
const ball = [
  group('ball base', [pod('ball base', 0, 0, [[0.06, 0.004], [0.045, 0.02], [0.0, 0.03], [-0.05, 0.026], [-0.08, 0.006]], { sides: 16, paint: 'carbon', shade: { base: 0.5, amp: 0.3 } })],
    { xf: { t: [BL.f + 0.01, 0, -0.058], s: [1, 1, 0.7] }, ...FINE }),
  { kind: 'drum', name: 'ball mast', f: BL.f, r: 0.018, n: 14, z: [R(BL.h + BL.r - 0.004), -0.066], role: 'nacelle', paint: 'carbon', sh: { base: 0.5, alt: 0.1 }, ...FINE },
  { kind: 'drum', name: 'ball bearing ring', f: BL.f, r: 0.024, n: 18, z: [R(BL.h + BL.r - 0.002), R(BL.h + BL.r + 0.006)], role: 'nacelle', paint: 'led', sh: { base: 1 }, ...FINE },
  mirror('ball yoke', [tube('yoke arm', [[BL.f, 0.02, BL.h + BL.r + 0.004], [BL.f, BL.r + 0.008, BL.h + BL.r * 0.4], [BL.f, BL.r + 0.008, BL.h]], 0.0055, { role: 'nacelle', paint: 'frame', sides: 6, ...FINE }),
    tube('yoke pivot', [[BL.f, BL.r + 0.012, BL.h], [BL.f, BL.r - 0.004, BL.h]], 0.011, { role: 'nacelle', paint: 'metal', sides: 10, caps: 1, ...FINE })]),
  group('sensor ball', [pod('ball', 0, 0, sphere(BL.r, 12), { sides: 20, paint: 'radome', shade: { base: 0.55, amp: 0.4 } })], { xf: { t: [BL.f, 0, BL.h] }, ...FINE }),
  // The windows: a big round day-camera pane and a square thermal one beside it, set into the ball's face.
  group('day camera window', [pod('window', 0, 0, [[0.0045, 0.0015], [0.004, 0.012], [0, 0.0145]], { sides: 16, role: 'glass', paint: 'lens' })],
    { xf: { t: [BL.f + BL.r - 0.003, -0.012, BL.h + 0.004] }, ...FINE }),
  group('thermal window', [pod('window', 0, 0, [[0.0045, 0.0015], [0.004, 0.009], [0, 0.0105]], { sides: 4, role: 'glass', paint: 'lens2' })],
    { xf: { t: [BL.f + BL.r - 0.0055, 0.016, BL.h + 0.008]}, ...FINE }),
  group('ranger lens', [pod('ranger', 0, 0, [[0.003, 0.001], [0, 0.0045]], { sides: 10, role: 'glass', paint: 'lensRed' })],
    { xf: { t: [BL.f + BL.r - 0.004, 0.012, BL.h - 0.016] }, ...FINE }),
  tube('ball seam', range(-70, 250, 24).map((d) => [BL.f + Math.cos(d * DEG) * 0.0005 + 0.0, Math.cos(d * DEG) * (BL.r + 0.0008), BL.h + Math.sin(d * DEG) * (BL.r + 0.0008)]), 0.0016, { role: 'nacelle', paint: 'seam', sides: 4, ...FINE }),
];

// ── The wing ────────────────────────────────────────────────────────────────────
// Long and slender, its upper surface one sheet of cells from the leading edge's boot to the hinge
// line, on a pylon over the rear seat. Flaps inboard of the kink, ailerons outboard, a light pod at
// each tip with the nav lamp and the strobe.
const WG = [GH76_WING.root, GH76_WING.kink, GH76_WING.tip];
const wing = foil('wing', WG, { nx: 15, paint: 'hull', bands: [{ x0: 0, x1: 0.05, paint: 'boot' }] });
const CF = 0.26;
const flaps = { ...ctrlOn('flap', WG[0], WG[1], 0.08, 0.97, CF), paint: 'hull' };
const ailerons = { ...ctrlOn('aileron', WG[1], WG[2], 0.04, 0.95, CF), paint: 'hull' };
// A point on the wing's surface at span g, chord x; `up` the upper surface.
const wingAt = (g, x, up = 1) => {
  for (let i = 0; i < WG.length - 1; i++) if (g <= WG[i + 1].g + 1e-9) return foilPt(lerpSt(WG[i], WG[i + 1], (g - WG[i].g) / (WG[i + 1].g - WG[i].g)), x, up);
  return foilPt(WG[WG.length - 1], x, up);
};
const wingUp = (g, x, o) => { const p = wingAt(g, x, 1); return [p[0], g, p[2] + o]; };
const wingLo = (g, x, o) => { const p = wingAt(g, x, 0); return [p[0], g, p[2] - o]; };
// The cells: strings of cells running spanwise between the root fairing and the tip pod, five rows
// across the chord, in two shades so the strings read; a bus bar between every string.
const CELL_X = range(0.065, 0.69, 8);
const CELL_G = range(0.12, 1.52, 52);
const cells = [];
for (let i = 0; i < CELL_G.length - 1; i++) {
  const g0 = CELL_G[i] + 0.002, g1 = CELL_G[i + 1] - 0.002;
  for (let j = 0; j < CELL_X.length - 1; j++) {
    const x0 = CELL_X[j] + 0.004, x1 = CELL_X[j + 1] - 0.004;
    cells.push(quad(wingUp(g0, x0, 0.0016), wingUp(g1, x0, 0.0016), wingUp(g1, x1, 0.0016), wingUp(g0, x1, 0.0016), { paint: (i + j) % 2 ? 'solar' : 'solar2', sh: 0.86, role: 'wing' }));
  }
}
const busbars = [];
for (const x of CELL_X.filter((_, k) => k % 2 === 0)) busbars.push(quad(wingUp(CELL_G[0], x - 0.002, 0.0012), wingUp(CELL_G[CELL_G.length - 1], x - 0.002, 0.0012), wingUp(CELL_G[CELL_G.length - 1], x + 0.002, 0.0012), wingUp(CELL_G[0], x + 0.002, 0.0012), { paint: 'busbar', sh: 0.9, role: 'wing' }));
const solar = mirror('solar array', [poly('solar cells', cells, FINE), poly('bus bars', busbars, FINE)]);
// The far body's wing carries the cells as a single dark band.
const solarFar = mirror('solar array (far)', [poly('solar band (far)', range(0.12, 1.52, 4).slice(0, -1).map((g, i, a) => {
  const g1 = i + 1 < a.length ? a[i + 1] : 1.52;
  return quad(wingUp(g, 0.07, 0.003), wingUp(g1, 0.07, 0.003), wingUp(g1, 0.68, 0.003), wingUp(g, 0.68, 0.003), { paint: 'solar', sh: 0.86, role: 'wing' });
}), COARSE)]);
// Battery hatches under the wing: the packs ride in the wing as a Zephyr's do, each bay a seam
// rectangle with two fasteners.
const hatches = mirror('wing battery hatches', [0.3, 0.56, 0.82].map((g) => poly('battery hatch', [
  ...[[g - 0.08, 0.15, g + 0.08, 0.17], [g - 0.08, 0.55, g + 0.08, 0.57], [g - 0.081, 0.15, g - 0.079, 0.57], [g + 0.079, 0.15, g + 0.081, 0.57]].map(([ga, xa, gb, xb]) =>
    quad(wingLo(ga, xa, 0.0012), wingLo(ga, xb, 0.0012), wingLo(gb, xb, 0.0012), wingLo(gb, xa, 0.0012), { paint: 'seam', sh: 0.4, role: 'wing' })),
  ...[0.25, 0.45].map((x) => quad(wingLo(g - 0.006, x, 0.0016), wingLo(g - 0.006, x + 0.02, 0.0016), wingLo(g + 0.006, x + 0.02, 0.0016), wingLo(g + 0.006, x, 0.0016), { paint: 'metal', sh: 0.7, role: 'wing' })),
], FINE)));
// The hinge line's slot, dark, over the flaps and ailerons.
const slot = mirror('hinge slot', [tube('hinge slot', [0.08, 0.5, 1.0, 1.3, 1.53].map((g) => { const p = wingAt(g, 1 - CF - 0.01, 1); return [p[0], g, p[2] + 0.0015]; }), 0.0018, { role: 'wing', paint: 'seam', sides: 4, ...FINE })]);
// A leading-edge light strip along the boot: the scout's own running light, teal like her cabin.
const leLight = mirror('leading edge light', [tube('leading edge light', range(0.14, 1.5, 8).map((g) => { const p = wingAt(g, 0.012, 1); return [p[0] + 0.002, g, p[2] + 0.001]; }), 0.0018, { role: 'wing', paint: 'led', sh: 1, sides: 4, ...FINE })]);
// The tip pods: a slim bullet at each tip, the nav lens in its nose, the strobe in its tail.
const tip = GH76_WING.tip, tipMid = (tip.le + tip.te) / 2;
const tipPods = mirror('tip pods', [
  group('tip pod', [pod('tip pod', 0, 0, [[tip.le + 0.03, 0.002], [tip.le + 0.02, 0.009], [tip.le, 0.013], [tipMid, 0.014], [tip.te, 0.011], [tip.te - 0.03, 0.003]], { sides: 12, paint: 'trim', shade: { base: 0.6, amp: 0.34 } })],
    { xf: { t: [0, tip.g + 0.004, tip.h + 0.002] }, ...FINE }),
  group('nav lens', [pod('nav lens', 0, 0, [[tip.le + 0.034, 0.0015], [tip.le + 0.028, 0.0065], [tip.le + 0.02, 0.0085]], { sides: 10, role: 'glass', paint: 'navR' })],
    { xf: { t: [0, tip.g + 0.004, tip.h + 0.002] }, ...FINE }),
  tube('tip strobe', [[tip.te - 0.022, tip.g + 0.004, tip.h + 0.002], [tip.te - 0.034, tip.g + 0.004, tip.h + 0.002]], 0.004, { role: 'nacelle', paint: 'strobe', sh: 1, sides: 6, caps: 1, ...FINE }),
]);
// The pitot under the right wing, outboard of the kink, and a static probe pair under the left.
const pitot = [
  tube('pitot mast', [wingLo(1.1, 0.1, 0), [GH76_WING.kink.le + 0.03, 1.1, 0.25], [GH76_WING.kink.le + 0.08, 1.1, 0.25]], 0.0026, { role: 'gear', paint: 'metal', sh: 0.85, sides: 5, ...FINE }),
  tube('pitot heater band', [[GH76_WING.kink.le + 0.06, 1.1, 0.25], [GH76_WING.kink.le + 0.07, 1.1, 0.25]], 0.0034, { role: 'gear', paint: 'carbon', sides: 6, ...FINE }),
];

// ── The pylon and the wing root ─────────────────────────────────────────────────
// A faired pylon from the crown behind the hoop up to the wing's root, carrying the wing as the Cub's
// cabane struts did. Its sides are the observer's window headers' cover; a satcom blister on its
// back, and the beacon on top of the wing centre section.
const BEACON_F = -0.02, BEACON_H = R(wingAt(0, (GH76_WING.root.le - BEACON_F) / (GH76_WING.root.le - GH76_WING.root.te), 1)[2]);
const PYL = [
  [0.152, 0.006, 0.006], [0.135, 0.018, 0.022], [0.105, 0.03, 0.034], [0.04, 0.036, 0.04], [-0.06, 0.036, 0.04], [-0.14, 0.034, 0.036], [-0.2, 0.026, 0.026], [-0.26, 0.012, 0.012],
].map(([f, rg, rvT]) => ({ f, rg, rvT, rvB: 0.045, cz: 0.198, boxy: 0.55 }));
const pylon = [
  loft('wing pylon', 18, PYL, { ...FINE, paint: 'hull', capFore: { kind: 'apex', at: [0.16, 0, 0.198] }, capAft: { kind: 'apex', at: [-0.272, 0, 0.198] }, shade: { base: 0.6, amp: 0.34 } }),
  // The beacon on top of the centre section, over the pylon.
  { kind: 'drum', name: 'beacon base', f: BEACON_F, r: 0.012, n: 12, z: [R(BEACON_H - 0.004), R(BEACON_H + 0.003)], role: 'nacelle', paint: 'carbon', sh: { base: 0.55, alt: 0.1 }, top: { sh: 0.8 }, ...FINE },
  { kind: 'drum', name: 'beacon', f: BEACON_F, r: 0.008, n: 12, z: [R(BEACON_H + 0.003), R(BEACON_H + 0.014)], role: 'nacelle', paint: 'beacon', sh: { base: 0.9 }, top: { sh: 1 }, ...FINE },
  group('satcom blister', [pod('satcom', 0, 0, [[0.04, 0.003], [0.03, 0.014], [0.0, 0.019], [-0.03, 0.016], [-0.05, 0.004]], { sides: 14, paint: 'radome' })], { xf: { t: [-0.215, 0, 0.212], s: [1, 1, 0.6] }, ...FINE }),
  { kind: 'blade', name: 'VHF blade', role: 'fin', paint: 'carbon', t: 0.003, sh: [0.75, 0.6], outline: [[-0.42, 0.1], [-0.44, 0.145], [-0.455, 0.145], [-0.47, 0.097]], ...FINE },
];

// ── The tail ────────────────────────────────────────────────────────────────────
// A tall swept fin over the boom with the rudder hung to the tailwheel as the Cub's was, a tailplane
// with its own strip of cells, a beacon and a GNSS puck on the fin, a strobe at the tail cone.
const FN = [
  { g: 0.06, le: -0.66, te: -0.93, h: 0, t: 1.1 },
  { g: 0.36, le: -0.86, te: -0.99, h: 0, t: 0.95 },
];
const fin = foil('fin', FN, { axis: 'g', role: 'fin', paint: 'trim', nx: 11 });
const rudder = { ...ctrlOn('rudder', FN[0], FN[1], 0.0, 0.94, 0.38, { axis: 'g', sh: 0.7 }), paint: 'trim' };
// The ventral fin under the boom: it carries the tailwheel's spring, and the rudder's foot.
const ventral = { kind: 'blade', name: 'ventral fin', paint: 'trim', role: 'fin', t: 0.006, sh: [0.86, 0.66], ...FINE,
  outline: [[-0.84, 0.05], [-0.95, 0.02], [-1.0, -0.006], [-1.03, 0.06]], edges: [{ a: 1, b: 2, sh: 0.8 }] };
const TP = [
  { g: 0.02, le: -0.7, te: -0.9, h: 0.09, t: 0.95 },
  { g: 0.44, le: -0.8, te: -0.91, h: 0.1, t: 0.75 },
];
const tailplane = foil('tailplane', TP, { role: 'stab', paint: 'hull', nx: 9, bands: [{ x0: 0, x1: 0.08, paint: 'boot' }] });
const elevators = { ...ctrlOn('elevator', TP[0], TP[1], 0.08, 0.96, 0.36), paint: 'hull' };
const tpAt = (g, x) => { const s = lerpSt(TP[0], TP[1], (g - TP[0].g) / (TP[1].g - TP[0].g)); const p = foilPt(s, x, 1); return [p[0], g, p[2] + 0.0014]; };
const tpCells = mirror('tailplane cells', [poly('tailplane cells', range(0.06, 0.4, 6).slice(0, -1).flatMap((g, i) => {
  const g1 = g + (0.4 - 0.06) / 6 - 0.004;
  return [0.1, 0.34].map((x, j) => quad(tpAt(g + 0.002, x), tpAt(g1, x), tpAt(g1, x + 0.2), tpAt(g + 0.002, x + 0.2), { paint: (i + j) % 2 ? 'solar' : 'solar2', sh: 0.86, role: 'stab' }));
}), FINE)]);
const tail = [
  { kind: 'drum', name: 'fin beacon', f: -0.94, r: 0.007, n: 10, z: [0.368, 0.38], role: 'nacelle', paint: 'beacon', sh: { base: 0.9 }, top: { sh: 1 }, ...FINE },
  { kind: 'drum', name: 'fin tip', f: -0.93, r: 0.012, n: 10, z: [0.36, 0.368], role: 'nacelle', paint: 'straw', sh: { base: 0.8 }, top: { sh: 0.9 }, ...FINE },
  group('GNSS puck', [pod('gnss', 0, 0, [[0.016, 0.002], [0.01, 0.009], [-0.01, 0.009], [-0.016, 0.002]], { sides: 12, paint: 'radome' })], { xf: { t: [-0.6, 0, 0.1], s: [1, 1, 0.5] }, ...FINE }),
  tube('tail strobe', [[GH76_TAIL[0] + 0.006, 0, GH76_TAIL[2]], [GH76_TAIL[0] - 0.012, 0, GH76_TAIL[2]]], 0.005, { role: 'nacelle', paint: 'strobe', sh: 1, sides: 6, caps: 1, ...FINE }),
  mirror('tailplane tip lights', [{ kind: 'drum', name: 'tailplane tip light', f: -0.855, g: 0.442, r: 0.005, n: 8, z: [0.096, 0.106], role: 'nacelle', paint: 'led', sh: { base: 1 }, top: { sh: 1 }, ...FINE }]),
  // The stabiliser's root fairing, and a lit seam where the fin meets the boom.
  mirror('tailplane fillet', [{ kind: 'panel', name: 'tailplane fillet', role: 'stab', sh: 0.7, th: 0.004, paint: 'hull', ...FINE, c: P3s([[-0.66, 0.012, 0.09], [-0.7, 0.03, 0.092], [-0.9, 0.03, 0.094], [-0.92, 0.012, 0.09]]) }]),
];

// ── Gear: carbon spring legs, tundra tyres, a steerable tailwheel ───────────────
const MW = { f: 0.34, g: 0.215, h: -0.235, r: 0.082, hw: 0.034 };
const TW = { f: -1.005, h: -0.072, r: 0.026, hw: 0.012 };
const mainGear = mirror('main gear', [
  faired('spring leg', [[0.36, 0.045, -0.06], [0.355, 0.12, -0.13], [MW.f + 0.005, MW.g - MW.hw - 0.008, MW.h + 0.01]], 0.05, 0.012, { role: 'gear', paint: 'carbon', ...FINE }),
  tube('leg root fitting', [[0.39, 0.04, -0.06], [0.33, 0.04, -0.062]], 0.009, { role: 'gear', paint: 'metal', sides: 6, ...FINE }),
  tube('damper', [[0.3, 0.05, -0.066], [MW.f - 0.01, MW.g - MW.hw - 0.012, MW.h + 0.03]], 0.0055, { role: 'gear', paint: 'metal', sides: 6, ...FINE }),
  tube('damper body', [[0.3, 0.05, -0.066], [0.31, 0.11, -0.12]], 0.0085, { role: 'gear', paint: 'frame', sides: 8, ...FINE }),
  { ...wheel('tundra tyre', [MW.f, MW.g, MW.h], MW.r, MW.hw, 20), ...FINE },
  tube('hub', [[MW.f, MW.g + MW.hw - 0.002, MW.h], [MW.f, MW.g + MW.hw + 0.008, MW.h]], 0.03, { role: 'gear', paint: 'straw', sides: 12, caps: 1, ...FINE }),
  tube('hub cap', [[MW.f, MW.g + MW.hw + 0.008, MW.h], [MW.f, MW.g + MW.hw + 0.012, MW.h]], 0.012, { role: 'gear', paint: 'metal', sides: 10, caps: 1, ...FINE }),
  tube('brake disc', [[MW.f, MW.g - MW.hw - 0.002, MW.h], [MW.f, MW.g - MW.hw - 0.006, MW.h]], 0.048, { role: 'gear', paint: 'metal', sides: 16, caps: 1, ...FINE }),
  tube('brake caliper', [[MW.f + 0.03, MW.g - MW.hw - 0.008, MW.h + 0.032], [MW.f + 0.045, MW.g - MW.hw - 0.008, MW.h + 0.012]], 0.008, { role: 'gear', paint: 'trim', sides: 6, ...FINE }),
  tube('axle', [[MW.f, MW.g - MW.hw - 0.012, MW.h], [MW.f, MW.g - MW.hw - 0.002, MW.h]], 0.009, { role: 'gear', paint: 'metal', sides: 8, ...FINE }),
  // A splash guard over the top of the tyre's back half, against the gravel the prop throws.
  tube('splash guard', range(40, 150, 8).map((d) => [MW.f + Math.cos(d * DEG) * (MW.r + 0.012), MW.g, MW.h + Math.sin(d * DEG) * (MW.r + 0.012)]), 0.01, { role: 'gear', paint: 'carbon', sides: 5, ...FINE }),
  // The landing light in the leg's fairing, facing forward.
  tube('leg landing light', [[0.372, 0.12, -0.128], [0.38, 0.12, -0.128]], 0.007, { role: 'nacelle', paint: 'strobe', sh: 1, sides: 8, caps: 1, ...FINE }),
]);
const tailGear = group('tailwheel', [
  faired('tail spring', [[-0.975, 0, 0.008], [-0.995, 0, -0.03], [TW.f, 0, TW.h + 0.016]], 0.024, 0.006, { role: 'gear', paint: 'carbon' }),
  tube('tail fork', [[TW.f + 0.008, -TW.hw - 0.004, TW.h + 0.02], [TW.f, -TW.hw - 0.004, TW.h], [TW.f, TW.hw + 0.004, TW.h], [TW.f + 0.008, TW.hw + 0.004, TW.h + 0.02]], 0.003, { role: 'gear', paint: 'metal', sides: 5 }),
  wheel('tailwheel', [TW.f, 0, TW.h], TW.r, TW.hw, 12),
  tube('steering horn', [[TW.f + 0.01, 0, TW.h + 0.03], [TW.f + 0.01, 0.025, TW.h + 0.03]], 0.0022, { role: 'gear', paint: 'metal', sides: 4 }),
], FINE);

// ── Belly: antennas and the LED waist line ──────────────────────────────────────
const belly = [
  { kind: 'blade', name: 'datalink blade', role: 'fin', paint: 'carbon', t: 0.003, sh: [0.75, 0.6], outline: [[-0.14, -0.02], [-0.155, -0.06], [-0.17, -0.06], [-0.19, -0.018]], ...FINE },
  { kind: 'blade', name: 'ADS-B blade', role: 'fin', paint: 'carbon', t: 0.003, sh: [0.75, 0.6], outline: [[-0.4, 0.008], [-0.41, -0.022], [-0.42, -0.022], [-0.43, 0.01]], ...FINE },
  { kind: 'drum', name: 'belly beacon', f: 0.12, r: 0.008, n: 10, z: [-0.07, -0.06], role: 'nacelle', paint: 'beacon', sh: { base: 0.9 }, bottom: { sh: 1 }, ...FINE },
  tube('waist light (right)', alongF(stationsIn(-0.5, 0.7), -16, 0.004), 0.0024, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  tube('waist light (left)', alongF(stationsIn(-0.5, 0.7), 196, 0.004), 0.0024, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
];

// ── The room behind the glass ───────────────────────────────────────────────────
// Seen through the bubble from outside: two seats in tandem, the panel, the stick, the observer's
// screen. The seated cockpit is interior-grasshopper-2076.js.
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
const FH = GH76_INSIDE.floorH;
const room = [];
for (const f of [GH76_INSIDE.pilotF, GH76_INSIDE.rearF]) {
  room.push(poly('seat', [
    ...slab([f + 0.03, 0, FH + 0.035], [0.075, 0.08, 0.012], 6, { paint: 'seat' }),
    ...slab([f - 0.018, 0, FH + 0.1], [0.012, 0.075, 0.11], -24, { paint: 'seat' }),
    ...slab([f - 0.034, 0, FH + 0.168], [0.01, 0.045, 0.03], -24, { paint: 'seat' }),
  ], FINE));
  room.push(tube('stick', [[f + 0.09, 0, FH + 0.01], [f + 0.095, 0, FH + 0.07]], 0.0035, { role: 'nacelle', paint: 'interior', sides: 5, ...FINE }));
}
room.push(poly('floor', [quad([0.6, -0.06, FH], [0.6, 0.06, FH], [-0.07, 0.06, FH], [-0.07, -0.06, FH], { paint: 'interior', sh: 0.45 })], FINE));
room.push(poly('panel', [...slab([0.585, 0, FH + 0.115], [0.012, 0.13, 0.04], -40, { paint: 'interior' }), ...slab([0.58, 0, FH + 0.117], [0.004, 0.11, 0.03], -40, { paint: 'screen' })], FINE));
room.push(poly('observer screen', [...slab([0.205, 0, FH + 0.12], [0.008, 0.08, 0.05], -20, { paint: 'interior' }), ...slab([0.2, 0, FH + 0.12], [0.003, 0.07, 0.04], -20, { paint: 'screen' })], FINE));
room.push(poly('bulkhead', [quad([GH76_INSIDE.bulkheadF, -0.07, FH], [GH76_INSIDE.bulkheadF, 0.07, FH], [GH76_INSIDE.bulkheadF, 0.07, 0.15], [GH76_INSIDE.bulkheadF, -0.07, 0.15], { paint: 'interior', sh: 0.5 })], FINE));

// ── The coarse body, for range ──────────────────────────────────────────────────
const coarse = [
  loft('fuselage (far)', 10, ST.filter((_, i) => i % 3 === 0 || i === ST.length - 1), {
    ...COARSE, paint: 'hull', capFore: { kind: 'flat', paint: 'trim' }, capAft: { kind: 'apex', at: GH76_TAIL },
    regions: [{ at: [0.61, 0.41], k: [1, 2, 3, 4], role: 'glass', tint: GLASS }],
  }),
  cone('spinner (far)', 0.8, 0, PH, 0.04, [0.875, 0, PH], { paint: 'spinner', n: 8, role: 'nacelle', ...COARSE }),
  loft('wing pylon (far)', 6, PYL.filter((_, i) => i % 2 === 0), { ...COARSE, paint: 'hull' }),
  { kind: 'blade', name: 'ventral fin (far)', paint: 'trim', role: 'fin', t: 0.008, sh: [0.86, 0.66], ...COARSE, outline: [[-0.84, 0.05], [-0.95, 0.02], [-1.0, -0.006], [-1.03, 0.06]] },
  { kind: 'drum', name: 'sensor ball (far)', f: BL.f, r: BL.r, n: 8, z: [R(BL.h - BL.r), R(BL.h + BL.r)], role: 'nacelle', paint: 'radome', sh: { base: 0.6, alt: 0.12 }, top: { sh: 0.8 }, bottom: { sh: 0.4 }, ...COARSE },
  mirror('gear (far)', [
    tube('main leg (far)', [[0.36, 0.045, -0.06], [MW.f, MW.g - MW.hw, MW.h]], 0.01, { role: 'gear', paint: 'carbon', sides: 4, ...COARSE }),
    { ...wheel('main tyre (far)', [MW.f, MW.g, MW.h], MW.r, MW.hw, 8), ...COARSE },
  ]),
  { ...wheel('tailwheel (far)', [TW.f, 0, TW.h], TW.r, TW.hw, 6), ...COARSE },
  solarFar,
];

// ── Rotors and lamps ────────────────────────────────────────────────────────────
// One three-blade scimitar propeller on the nose, slow and big for the noise: the Cub's station.
const rotors = [{ at: [PF, 0, PH], plane: 'fore', r: GH76_PROP.r, blades: GH76_PROP.blades, lead: 0.8, spinMul: 1, phase: 0.3 }];
const lamps = [
  { at: [R(tip.le + 0.036), R(-tip.g - 0.004), R(tip.h + 0.002)], n: [0.3, -1, 0], rgb: '255,55,55', kind: 'steady' },
  { at: [R(tip.le + 0.036), R(tip.g + 0.004), R(tip.h + 0.002)], n: [0.3, 1, 0], rgb: '60,255,95', kind: 'steady' },
  { at: [R(tip.te - 0.036), R(-tip.g - 0.004), R(tip.h + 0.002)], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [R(tip.te - 0.036), R(tip.g + 0.004), R(tip.h + 0.002)], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [GH76_TAIL[0] - 0.014, 0, GH76_TAIL[2]], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [-0.94, 0, 0.384], n: [0, 0, 1], rgb: '255,90,70', kind: 'beacon' },
  { at: [BEACON_F, 0, R(BEACON_H + 0.016)], n: [0, 0, 1], rgb: '255,90,70', kind: 'beacon' },
  { at: [0.12, 0, -0.072], n: [0, 0, -1], rgb: '255,90,70', kind: 'beacon' },
];

const doc = {
  id: 'grasshopper_2076',
  kind: 'mesh',
  params: {
    name: 'Grasshopper 2076',
    note: 'CONCEPT, generated by scripts/shapes/concepts/grasshopper-2076.mjs (edit that, not this). The Grasshopper fifty years on, after the Airbus Zephyr: a tandem two-seat solar-electric scout. A very long, high-aspect wing skinned in solar cells on a pylon over a slender pod, flaps and ailerons, tip pods with the nav lamps; a bubble over the pilot and windows for the observer behind; a gimballed sensor ball under the chin; one three-blade propeller on the nose at the Cub\'s station; a swept fin, the rudder hung to the tailwheel as the Cub\'s was, a celled tailplane; carbon spring legs on tundra tyres, three-point at the Cub\'s 11°. A variant of the grasshopper mesh, worn as the Grasshopper 2076 factory edition.',
    groundPitch: 11,
    navLamps: null,
    hull: 'fuselage',
    lamps,
    rotors,
    finish: 'gloss',
    paints: {
      hull: { rgb: [222, 228, 216], livery: 'base', mat: 'pearl' },
      trim: { rgb: [95, 143, 58], livery: 'trim' },
      belly: { rgb: [120, 128, 126], livery: 'fixed', mat: 'satin' },
      glare: { rgb: [30, 34, 32], livery: 'fixed', mat: 'matte' },
      boot: { rgb: [52, 56, 58], livery: 'fixed', mat: 'matte' },
      frame: { rgb: [28, 32, 30], livery: 'fixed', mat: 'gloss' },
      seam: { rgb: [70, 76, 74], livery: 'fixed', mat: 'matte' },
      carbon: { rgb: [36, 40, 42], livery: 'fixed', mat: 'satin' },
      metal: { rgb: [156, 162, 166], livery: 'fixed', mat: 'bare' },
      intake: { rgb: [24, 26, 28], livery: 'fixed', mat: 'matte' },
      spinner: { rgb: [216, 194, 74], livery: 'fixed', mat: 'gloss' },
      straw: { rgb: [216, 194, 74], livery: 'fixed', mat: 'gloss' },
      solar: { rgb: [26, 36, 64], livery: 'fixed', mat: 'gloss' },
      solar2: { rgb: [34, 48, 82], livery: 'fixed', mat: 'gloss' },
      busbar: { rgb: [170, 176, 186], livery: 'fixed', mat: 'bare' },
      radome: { rgb: [214, 216, 210], livery: 'fixed', mat: 'satin' },
      lens: { rgb: [20, 34, 52], livery: 'fixed', mat: 'gloss' },
      lens2: { rgb: [60, 30, 46], livery: 'fixed', mat: 'gloss' },
      lensRed: { rgb: [170, 40, 36], livery: 'fixed', mat: 'gloss' },
      led: { rgb: [120, 236, 196], livery: 'fixed', mat: 'matte' },
      navR: { rgb: [210, 210, 210], livery: 'fixed', mat: 'gloss' },
      beacon: { rgb: [235, 70, 56], livery: 'fixed', mat: 'gloss' },
      strobe: { rgb: [240, 244, 248], livery: 'fixed', mat: 'gloss' },
      interior: { rgb: [40, 44, 42], livery: 'fixed', mat: 'matte' },
      seat: { rgb: [70, 76, 66], livery: 'fixed', mat: 'satin' },
      screen: { rgb: [60, 190, 170], livery: 'fixed', mat: 'gloss' },
    },
    parts: [
      fuselage, bubble, rearGlass, ...frames, ...canopy, ...trim, ...nose, ...ball,
      wing, flaps, ailerons, solar, hatches, slot, leLight, tipPods, ...pitot, ...pylon,
      fin, rudder, ventral, tailplane, elevators, tpCells, ...tail,
      mainGear, tailGear, ...belly, ...room,
      ...coarse,
    ],
  },
};

const v = validateMesh(doc.params, doc.id);
if (v.errors.length) { console.log('ERRORS', v.errors.slice(0, 12)); process.exit(1); }
if (v.warnings?.length) console.log('warnings', v.warnings.slice(0, 8));
const n1 = compileMesh(doc.params, { detail: 1 }).faces.length, n0 = compileMesh(doc.params, { detail: 0 }).faces.length;
writeFileSync(new URL('../../../content/vehicle_models/mesh_grasshopper_2076.json', import.meta.url), formatMesh(doc));
console.log('mesh_grasshopper_2076.json:', n1, 'faces near,', n0, 'far');
