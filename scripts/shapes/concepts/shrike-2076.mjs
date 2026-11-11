// The Shrike 2076 concept: writes content/vehicle_models/mesh_divebomber_2076.json.
//
//   node scripts/shapes/concepts/shrike-2076.mjs
//   then: npm run vehicles:bake
//
// The Stuka fifty years on, after the optionally crewed strike aircraft and loitering munitions of
// the 2020s: a single-seat dive striker that can fly the dive without anybody in it, and is only
// allowed to with somebody in it. One jet in the tail fed by a chin intake where the Stuka's radiator
// hung; a chined hull with the Stuka's drooping beak and a sensor chin under it; a gold-filmed canopy;
// the inverted gull wing kept, cranked and swept, with the slatted dive brakes still under it, now
// turning on the diveBrake channel; the bombs inside a bay between the knees, on a trapeze that lowers
// them into the air before release; the trousered legs kept as fixed talons, and where each leg's
// siren was, a cell broadcaster that pushes the dive alert to every tablet in the target zone.
// It is a variant of the divebomber mesh (mesh_divebomber.json `variants`), worn as the Shrike 2076
// factory edition.
//
// ⚠ THIS OVERWRITES THE JSON. Edit this file, not the mesh in the Modelshop.
//
// Two bodies in one file. Everything fine is `minDetail: 1`; a coarse body with `maxDetail: 0` stands
// in at range. The wing, fin and tailplane are foil() groups, which carry their own two LODs.
//
// Frame: f fore, g right, h up, in the Stuka's units (mains at f 0.21 on the ground at h -0.28,
// tailwheel at f -0.875 on the ground at h -0.104), so she sits at the Stuka's 9 degrees. The hull is
// not a loft: its chined section is stated in client/shared/cabin-shrike-2076.js and skinned here.
//
// ⚠ CHANNEL: `diveBrake` (0 shut, 1 in the dive). The brakes swing out over [0, 0.5], the bay doors
// open over [0.3, 0.7] and the trapeze lowers the bomb over [0.6, 1]. cockpit.js feeds it from the
// dive computer; a contact or the hangar shows her clean at 0.
import { writeFileSync } from 'node:fs';
import { R, P3, foil, foilPt, lerpSt, ctrlOn, tube, mirror, group, poly as rawPoly, quad, cone, wheel, faired, pod, DEG } from '../fw-meshes/lib.mjs';
const { formatMesh, validateMesh, compileMesh } = await import('../../../client/shared/vehicle-mesh.js');
const C = await import('../../../client/shared/cabin-shrike-2076.js');
const { SH76_STATIONS: ST, SH76_RING: NR, SH76_K: K, SH76_GLASS, SH76_BAY, SH76_INTAKE, SH76_NOZZLE: NZ, SH76_INSIDE, SH76_WING, SH76_GEAR, sh76Point, sh76Station } = C;

const FINE = { minDetail: 1 }, COARSE = { maxDetail: 0 };
const poly = (name, faces, extra) => rawPoly(name, faces.map((f) => ({ role: 'nacelle', ...f })), extra);
const GLASS = [104, 90, 50];        // gold-filmed, the colour of a canopy you cannot see into
const lerp = (a, b, t) => a + (b - a) * t;
const range = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));
const at = (f, k, o = 0) => sh76Point(f, k, o);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mirK = (k) => NR - k;
// A shade for a face from its normal's lean: crown-bright, belly-dark, as a loft's shade is.
const shOf = (p, base = 0.5, amp = 0.42) => { const n = unit(cross(sub(p[1], p[0]), sub(p[2], p[0]))); return R(base + amp * (0.5 + 0.5 * n[2]), 3); };

// ── The hull ───────────────────────────────────────────────────────────────────
// Ring by ring off the stated section, quad (aft k, fore k, fore k+1, aft k+1) as the lofts wind.
const STF = ST.map((s) => s.f);
const inBay = (f0, f1, k) => f1 <= SH76_BAY.f[1] + 1e-9 && f0 >= SH76_BAY.f[0] - 1e-9 && (k < SH76_BAY.k || k >= NR - SH76_BAY.k);
const glassOf = (f0, f1, k) => f0 >= SH76_GLASS.f[0] - 1e-9 && f1 <= SH76_GLASS.f[1] + 1e-9 && k >= SH76_GLASS.k[0] && k < SH76_GLASS.k[1];
function paintOf(f0, f1, k) {
  const fm = (f0 + f1) / 2, kk = k < NR / 2 ? k : NR - 1 - k;   // kk: 0 keel .. 14 crown, either side
  if (f1 > 1.09 + 1e-9) return 'radome';
  // The shrike's mask: a black band along the upper flank from the beak back under the canopy's
  // sill, above the red jaw line, as the bird wears through its eye.
  if (fm > 0.2 && fm < 1.02 && kk === K.chine + 1) return 'mask';
  if (fm > SH76_GLASS.f[1] && fm < 1.02 && kk === K.upper) return 'mask';
  // The jaw line: the chine in the trim red from the beak back past the sensor chin.
  if (fm > 0.78 && fm < 1.09 && (kk === K.chine - 1 || kk === K.chine)) return 'trim';
  // The tail band, the Stuka's yellow band moved to red.
  if (fm < -0.48 && fm > -0.64 && kk >= K.chine - 1) return 'trim';
  if (kk < K.lower) return 'belly';
  return 'hull';
}
function hullFaces(stF, ks, extra = {}) {
  const out = [];
  for (let i = 0; i < stF.length - 1; i++) {
    const f1 = stF[i], f0 = stF[i + 1];
    for (let j = 0; j < ks.length; j++) {
      const k = ks[j], k1 = ks[(j + 1) % ks.length] || NR;
      if (extra.hole && inBay(f0, f1, k)) continue;
      const p = [at(f0, k), at(f1, k), at(f1, k1), at(f0, k1)];
      if (glassOf(f0, f1, k)) out.push({ role: 'glass', tint: GLASS, sh: 0.9, p });
      else out.push({ role: 'body', paint: paintOf(f0, f1, k), sh: shOf(p), p });
    }
  }
  return out;
}
const ALLK = Array.from({ length: NR }, (_, k) => k);
const fuselage = poly('fuselage', hullFaces(STF, ALLK, { hole: true }), FINE);
// The beak's tip, closed.
const noseCap = poly('nose cap', [{ role: 'body', paint: 'radome', sh: 0.7, p: ALLK.map((k) => at(STF[0], k)).reverse() }], FINE);

// ── The canopy: frames, seals, the hinge ───────────────────────────────────────
const GF = SH76_GLASS, GK = GF.k;
const FR = (name, pts, r = 0.0042, paint = 'frame') => tube(name, pts, r, { role: 'nacelle', paint, sh: 0.5, sides: 5, ...FINE });
const glassFs = STF.filter((f) => f >= GF.f[0] - 1e-9 && f <= GF.f[1] + 1e-9);
const frames = [
  FR('windscreen arch', range(GK[0], GK[1], 16).map((k) => at(GF.f[1], k, 0.003)), 0.0055),
  FR('canopy bow', range(GK[0], GK[1], 16).map((k) => at(GF.bow, k, 0.0035)), 0.005),
  FR('canopy aft frame', range(GK[0], GK[1], 16).map((k) => at(GF.f[0], k, 0.003)), 0.006),
  FR('canopy sill (right)', glassFs.map((f) => at(f, GK[0], 0.003)), 0.0048),
  FR('canopy sill (left)', glassFs.map((f) => at(f, GK[1], 0.003)), 0.0048),
  // The windscreen's two posts, a third of the way up each side: a fighter's three-pane screen.
  FR('windscreen post (right)', [at(GF.f[1], 11.5, 0.003), at(GF.bow, 11.5, 0.0035)], 0.0036),
  FR('windscreen post (left)', [at(GF.f[1], mirK(11.5), 0.003), at(GF.bow, mirK(11.5), 0.0035)], 0.0036),
  // A lit seal along each sill, red: the canopy is shut and locked.
  tube('sill seal (right)', glassFs.map((f) => at(f, GK[0] - 0.35, 0.004)), 0.0019, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  tube('sill seal (left)', glassFs.map((f) => at(f, GK[1] + 0.35, 0.004)), 0.0019, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  // The canopy's hinge behind the aft frame and its jettison cord line along the crown, yellow.
  tube('canopy hinge', [at(GF.f[0] - 0.012, 13.5, 0.004), at(GF.f[0] - 0.012, mirK(13.5), 0.004)], 0.0045, { role: 'nacelle', paint: 'carbon', sides: 6, ...FINE }),
  tube('canopy breaker line', glassFs.map((f) => at(f, 15, 0.0025)), 0.0012, { role: 'nacelle', paint: 'hazard', sh: 0.8, sides: 4, ...FINE }),
];

// ── Seams, hatches, fasteners ──────────────────────────────────────────────────
const SEAM = (name, pts, r = 0.0018) => tube(name, pts, r, { role: 'nacelle', paint: 'seam', sh: 0.4, sides: 4, ...FINE });
const ringSeam = (f, k0 = 0, k1 = NR, o = 0.0016) => range(k0, k1, Math.max(4, Math.round((k1 - k0) * 1.2))).map((k) => at(f, k, o));
// A rectangle on the skin in (f, k), proud by o.
const rectSeam = (name, f0, f1, k0, k1, o = 0.002) => SEAM(name, [...range(k0, k1, 4).map((k) => at(f1, k, o)), ...range(f1, f0, 4).slice(1).map((f) => at(f, k1, o)),
  ...range(k1, k0, 4).slice(1).map((k) => at(f0, k, o)), ...range(f0, f1, 4).slice(1).map((f) => at(f, k0, o))]);
const fastenRow = (name, f, k0, k1, n) => poly(name, range(k0, k1, n).map((k) => {
  const a = at(f + 0.003, k - 0.12, 0.0024), b = at(f - 0.003, k - 0.12, 0.0024), c = at(f - 0.003, k + 0.12, 0.0024), d = at(f + 0.003, k + 0.12, 0.0024);
  return { paint: 'metal', sh: 0.85, p: [b, a, d, c] };
}), FINE);
const seams = [
  SEAM('radome joint', ringSeam(1.09)),
  SEAM('forward bay seam', ringSeam(0.78, K.lower, mirK(K.lower))),
  SEAM('bulkhead seam', ringSeam(0.12, K.chine, mirK(K.chine))),
  SEAM('engine bay seam', ringSeam(-0.18)),
  SEAM('tail seam', ringSeam(-0.64)),
  SEAM('spine seam', range(0.2, -0.64, 10).map((f) => at(f, 15, 0.0016))),
  ...[0, 1].flatMap((s) => {
    const k = (x) => (s ? mirK(x) : x), side = s ? 'left' : 'right';
    return [
      rectSeam('avionics hatch (' + side + ')', 0.8, 0.96, k(s ? 11 : 8.4), k(s ? 8.4 : 11)),
      rectSeam('gun bay blank (' + side + ')', 0.74, 0.86, k(s ? 6.4 : 3.6), k(s ? 3.6 : 6.4)),
      rectSeam('engine access (' + side + ')', -0.5, -0.24, k(s ? 6.6 : 2.6), k(s ? 2.6 : 6.6)),
      rectSeam('fuel panel (' + side + ')', -0.06, 0.1, k(s ? 11.4 : 8.6), k(s ? 8.6 : 11.4)),
      rectSeam('refuel door (' + side + ')', -0.02, 0.04, k(s ? 13.6 : 12.4), k(s ? 12.4 : 13.6)),
      fastenRow('radome fasteners (' + side + ')', 1.085, k(s ? 14 : 1), k(s ? 16 : 14), 6),
      fastenRow('bay fasteners (' + side + ')', -0.184, k(s ? 13 : 2), k(s ? 17 : 13), 7),
      // The NO STEP strips at the wing root, as grey hatching.
      poly('walkway (' + side + ')', range(0.18, -0.1, 5).slice(0, -1).map((f, i) => ({ paint: 'seam', sh: 0.6, p: [at(f - 0.052, k(8.2), 0.0018), at(f, k(8.2), 0.0018), at(f, k(8.9), 0.0018), at(f - 0.052, k(8.9), 0.0018)].map((q) => q) })).map((fc) => (s ? { ...fc, p: fc.p.slice().reverse() } : fc)), FINE),
    ];
  }),
];

// ── The beak, the chin sensor, the probes ──────────────────────────────────────
// Under the beak, where the Stuka's chin radiator began, a faceted targeting turret: a six-sided
// fairing and a dark window looking forward and down, with the laser's small lens beside it.
const eo = [
  group('targeting turret', [pod('turret', 0, 0, [[0.07, 0.004], [0.05, 0.02], [0.0, 0.026], [-0.06, 0.022], [-0.1, 0.004]], { sides: 6, paint: 'radome', shade: { base: 0.5, amp: 0.3 } })],
    { xf: { t: [0.95, 0, -0.072], s: [1, 1, 0.8] }, ...FINE }),
  group('targeting window', [pod('window', 0, 0, [[0.006, 0.002], [0.003, 0.012], [-0.004, 0.0155]], { sides: 6, role: 'glass', paint: 'lens' })],
    { xf: { t: [1.012, 0, -0.077], r: [0, 28, 0] }, ...FINE }),
  group('laser lens', [pod('laser', 0, 0, [[0.004, 0.001], [0, 0.005]], { sides: 8, role: 'glass', paint: 'lensRed' })],
    { xf: { t: [1.0, 0.016, -0.083], r: [0, 28, 0] }, ...FINE }),
];
// The pitot comes out of the beak's tip, and the beak droops: the tip ring is at h -0.068.
const probes = [
  tube('pitot probe', [[1.192, 0, -0.0665], [1.25, 0, -0.069], [1.29, 0, -0.07]], 0.0026, { role: 'nacelle', paint: 'metal', sh: 0.85, sides: 6, ...FINE }),
  tube('pitot heater', [[1.24, 0, -0.0686], [1.255, 0, -0.0692]], 0.0036, { role: 'nacelle', paint: 'carbon', sides: 6, ...FINE }),
  mirror('angle-of-attack vanes', [tube('AoA vane', [at(1.04, 9, 0.002), [1.03, 0.042, -0.012]], 0.002, { role: 'nacelle', paint: 'metal', sides: 4, ...FINE })]),
];
// Distributed-aperture sensors: dark hexagonal windows round the nose and the spine, so she sees all
// round with nobody's head in the canopy.
const hex = (name, f, k, r = 0.0075) => {
  const c = at(f, k, 0.0024), c2 = at(f, k + 0.5, 0.0024), up = unit(sub(c2, c)), fw = [1, 0, 0];
  const pts = range(0, 300, 5).map((d) => { const a = d * DEG; return [c[0] + fw[0] * Math.cos(a) * r, c[1] + up[1] * Math.sin(a) * r * 1.6, c[2] + up[2] * Math.sin(a) * r * 1.6]; });
  return poly(name, [{ role: 'glass', paint: 'lens', sh: 0.9, p: (k > NR / 2 ? pts.reverse() : pts) }], FINE);
};
const das = [hex('aperture', 0.9, 10.5), hex('aperture', 0.9, mirK(10.5)), hex('aperture', 0.84, 2.6), hex('aperture', 0.84, mirK(2.6)), hex('aperture', 0.14, 13.6, 0.007), hex('aperture', 0.14, mirK(13.6), 0.007), hex('aperture', -0.4, 3.4), hex('aperture', -0.4, mirK(3.4))];
// The predator's eye-line: a red light along the chine from the beak back to the intake.
const eyeLine = [K.chine, mirK(K.chine)].map((k, i) => tube('jaw light (' + (i ? 'left' : 'right') + ')', range(1.06, 0.74, 8).map((f) => at(f, k, 0.003)), 0.0022, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }));

// ── The chin intake ────────────────────────────────────────────────────────────
// A U-section duct under the belly where the Stuka's radiator hung, its mouth raked so the lower lip
// juts forward under the beak like an open jaw. A lip round the mouth with a red light along the lower
// edge, a radar blocker of vanes across the throat so the engine face is never seen, and the duct's
// own seam line and drain.
const IN_ = SH76_INTAKE, IST = IN_.stations;
// The duct's half-section, top (buried in the hull) to the bottom centre: [g frac, h frac of the depth].
const USEC = [[0.86, 1], [1.0, 0.62], [0.98, 0.3], [0.86, 0.07], [0.5, 0], [0, 0]];
const UR = [...USEC, ...USEC.slice(0, -1).reverse().map(([g, y]) => [-g, y])];
// A point on the duct at station i, section point j; the mouth station rakes with height.
const ductPt = (i, j, o = 0) => {
  const [f, a, hb] = IST[i], [gx, y] = UR[j], h = hb + (IN_.topH - hb) * y;
  const ff = i === 0 ? f + (IN_.lipF - f) * (1 - y) ** 1.4 : f;
  const cg = gx === 0 ? 0 : Math.sign(gx) * (Math.abs(gx) * a + o);
  return [ff, cg, h - (y < 0.2 ? o : 0)];
};
const ductFaces = [];
for (let i = 0; i < IST.length - 1; i++) for (let j = 0; j < UR.length - 1; j++) {
  const p = [ductPt(i + 1, j), ductPt(i, j), ductPt(i, j + 1), ductPt(i + 1, j + 1)];
  ductFaces.push({ role: 'body', paint: 'belly', sh: shOf(p, 0.46, 0.4), p });
}
// The duct's tail, closed into the belly.
ductFaces.push({ role: 'body', paint: 'belly', sh: 0.45, p: UR.map((_, j) => ductPt(IST.length - 1, j)) });
const mouthRing = UR.map((_, j) => ductPt(0, j));
const intake = [
  poly('intake duct', ductFaces, FINE),
  // The mouth: dark, set a little back into the duct.
  poly('intake mouth', [{ role: 'body', paint: 'intake', sh: 0.25, p: UR.map((_, j) => { const q = ductPt(0, j, -0.006); return [q[0] - 0.012, q[1], q[2]]; }) }], FINE),
  tube('intake lip', mouthRing.map((q, j) => [q[0] + 0.001, q[1] * 1.02, q[2] - (UR[j][1] < 0.2 ? 0.001 : 0)]), 0.0052, { role: 'nacelle', paint: 'edge', sh: 0.6, sides: 6, ...FINE }),
  tube('intake lip light', UR.map((_, j) => j).filter((j) => UR[j][1] < 0.35).map((j) => { const q = ductPt(0, j, 0.004); return [q[0] + 0.004, q[1], q[2] - 0.002]; }), 0.0019, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  poly('radar blocker', range(0.25, 0.8, 3).map((y) => {
    const f = IST[0][0] - 0.03, a = IST[0][1] * 0.94, h = IST[0][2] + (IN_.topH - IST[0][2]) * y;
    return { role: 'nacelle', paint: 'metal', sh: 0.45, p: [[f, -a, h], [f, a, h], [f - 0.01, a, h - 0.008], [f - 0.01, -a, h - 0.008]] };
  }), FINE),
  SEAM('duct seam', IST.slice(0, -1).map((_, i) => ductPt(i, 5, 0.0016))),
  mirror('duct side seam', [SEAM('duct side seam', IST.slice(0, -1).map((_, i) => ductPt(i, 2, 0.0016)))]),
  { kind: 'drum', name: 'duct drain', f: 0.4, r: 0.004, n: 8, z: [R(IST[3][2] - 0.006), R(IST[3][2] + 0.002)], role: 'nacelle', paint: 'metal', ...FINE },
  // Two auxiliary inlet doors on the flanks above it, for the ground.
  ...[0, 1].map((s) => rectSeam('aux inlet door (' + (s ? 'left' : 'right') + ')', 0.58, 0.64, s ? mirK(6) : 4.6, s ? mirK(4.6) : 6, 0.0022)),
];

// ── The bay ────────────────────────────────────────────────────────────────────
// A hole in the flat belly, a box above it, two doors hinged at its edges, the bomb on a trapeze.
const BF = SH76_BAY.f, BK = SH76_BAY.k;
const bayFs = STF.filter((f) => f >= BF[0] - 1e-9 && f <= BF[1] + 1e-9);
const roofH = -0.03;
const bayBox = [];
for (let i = 0; i < bayFs.length - 1; i++) {
  const f1 = bayFs[i], f0 = bayFs[i + 1];
  const r0 = at(f0, BK), r1 = at(f1, BK), l0 = at(f0, mirK(BK)), l1 = at(f1, mirK(BK));
  bayBox.push({ paint: 'bayIn', sh: 0.5, p: [r0, r1, [f1, r1[1], roofH], [f0, r0[1], roofH]] });
  bayBox.push({ paint: 'bayIn', sh: 0.5, p: [[f0, l0[1], roofH], [f1, l1[1], roofH], l1, l0] });
  bayBox.push({ paint: 'bayIn', sh: 0.35, p: [[f0, r0[1], roofH], [f1, r1[1], roofH], [f1, l1[1], roofH], [f0, l0[1], roofH]] });
  // The keel half of the hole: the two flat-belly bays either side of the centreline, filled in at
  // the roof so the bay reads as one box.
}
for (const f of [BF[0], BF[1]]) {
  const r = at(f, BK), l = at(f, mirK(BK)), kc = at(f, 0);
  bayBox.push({ paint: 'bayIn', sh: 0.45, p: f === BF[1] ? [r, [f, r[1], roofH], [f, l[1], roofH], l, kc] : [kc, l, [f, l[1], roofH], [f, r[1], roofH], r] });
}
const bay = [poly('bomb bay', bayBox, FINE)];
// The doors: each the belly flat from the keel to the bay's edge, hinged along that edge, swinging
// down and out on the channel.
const doorFaces = [];
for (let i = 0; i < bayFs.length - 1; i++) {
  const f1 = bayFs[i], f0 = bayFs[i + 1];
  for (let k = 0; k < BK; k++) doorFaces.push({ role: 'body', paint: 'belly', sh: 0.42, p: [at(f0, k, 0.0012), at(f1, k, 0.0012), at(f1, k + 1, 0.0012), at(f0, k + 1, 0.0012)] });
  // Inside face of the door, so an open door is not a hole from below.
  doorFaces.push({ role: 'body', paint: 'bayIn', sh: 0.55, p: [at(f0, BK, -0.002), at(f1, BK, -0.002), at(f1, 0, -0.002), at(f0, 0, -0.002)] });
}
const hingeR = at(BF[1], BK);
const bayDoors = mirror('bay doors', [
  poly('bay door', doorFaces, { ...FINE, anim: { ch: 'diveBrake', pivot: P3([0, hingeR[1], hingeR[2]]), axis: [1, 0, 0], ang: [0, 105], span: [0.3, 0.7] } }),
  tube('door edge light', bayFs.map((f) => at(f, 0.15, 0.002)), 0.0014, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE, anim: { ch: 'diveBrake', pivot: P3([0, hingeR[1], hingeR[2]]), axis: [1, 0, 0], ang: [0, 105], span: [0.3, 0.7] } }),
]);
// The store: a 500 kg penetrator with a seeker nose and strakes, on a trapeze of two telescoping rams.
const BZ = -0.062, BC = 0.01;
const TRAP = { ch: 'diveBrake', slide: [0, 0, -0.045], span: [0.6, 1] };
const bomb = group('bomb on trapeze', [
  pod('penetrator', 0, BZ, [[BC + 0.15, 0.004], [BC + 0.14, 0.012], [BC + 0.11, 0.021], [BC + 0.05, 0.024], [BC - 0.08, 0.024], [BC - 0.12, 0.016], [BC - 0.135, 0.008]], { sides: 12, paint: 'store', shade: { base: 0.5, amp: 0.35 } }),
  pod('seeker', 0, BZ, [[BC + 0.156, 0.0015], [BC + 0.15, 0.0045], [BC + 0.142, 0.009]], { sides: 10, role: 'glass', paint: 'lens' }),
  tube('store band', range(0, 360, 12).map((d) => [BC + 0.07, Math.cos(d * DEG) * 0.0245, BZ + Math.sin(d * DEG) * 0.0245]), 0.0016, { role: 'gun', paint: 'hazard', sides: 4 }),
  poly('store fins', [0, 90, 180, 270].map((d) => {
    const c = Math.cos(d * DEG), s = Math.sin(d * DEG), r0 = 0.012, r1 = 0.03;
    return { role: 'gun', paint: 'store', sh: 0.62, p: [[BC - 0.09, c * r0, BZ + s * r0], [BC - 0.125, c * r1, BZ + s * r1], [BC - 0.14, c * r1, BZ + s * r1], [BC - 0.135, c * r0, BZ + s * r0]] };
  })),
  poly('store strakes', [0, 180].map((d) => {
    const c = Math.cos(d * DEG), r0 = 0.024, r1 = 0.031;
    return { role: 'gun', paint: 'store', sh: 0.66, p: [[BC + 0.06, c * r0, BZ], [BC - 0.06, c * r0, BZ], [BC - 0.06, c * r1, BZ], [BC + 0.0, c * r1, BZ]] };
  })),
  mirror('trapeze rams', [tube('trapeze ram', [[BC + 0.05, 0.012, BZ + 0.022], [BC + 0.05, 0.012, roofH - 0.012]], 0.0035, { role: 'gun', paint: 'metal', sides: 6 }),
    tube('trapeze ram', [[BC - 0.06, 0.012, BZ + 0.022], [BC - 0.06, 0.012, roofH - 0.012]], 0.0035, { role: 'gun', paint: 'metal', sides: 6 })]),
], { ...FINE, anim: TRAP });
const rack = mirror('trapeze sleeves', [tube('ram sleeve', [[BC + 0.05, 0.012, roofH], [BC + 0.05, 0.012, roofH - 0.016]], 0.0055, { role: 'gun', paint: 'carbon', sides: 6, ...FINE }),
  tube('ram sleeve', [[BC - 0.06, 0.012, roofH], [BC - 0.06, 0.012, roofH - 0.016]], 0.0055, { role: 'gun', paint: 'carbon', sides: 6, ...FINE })]);

// ── The wing ───────────────────────────────────────────────────────────────────
const WG = [SH76_WING.root, SH76_WING.inner, SH76_WING.knee, SH76_WING.crank, SH76_WING.tip];
const wing = foil('wing', WG, { nx: 15, paint: 'hull', bands: [{ x0: 0, x1: 0.06, paint: 'edge' }] });
const CF = 0.24;
const flapsIn = { ...ctrlOn('flap', WG[0], WG[1], 0.62, 0.98, CF), paint: 'hull' };
const flapsKnee = { ...ctrlOn('flap', WG[1], WG[2], 0.03, 0.97, CF), paint: 'hull' };
const flapsOut = { ...ctrlOn('flap', WG[2], WG[3], 0.03, 0.97, CF), paint: 'hull' };
const ailerons = { ...ctrlOn('aileron', WG[3], WG[4], 0.05, 0.93, 0.26), paint: 'hull' };
const wingAt = (g, x, up = 1) => {
  for (let i = 0; i < WG.length - 1; i++) if (g <= WG[i + 1].g + 1e-9) return foilPt(lerpSt(WG[i], WG[i + 1], (g - WG[i].g) / (WG[i + 1].g - WG[i].g)), x, up);
  return foilPt(WG[WG.length - 1], x, up);
};
const wingUp = (g, x, o) => { const p = wingAt(g, x, 1); return [p[0], g, p[2] + o]; };
const wingLo = (g, x, o) => { const p = wingAt(g, x, 0); return [p[0], g, p[2] - o]; };
// The hinge slot over the flaps and ailerons, and spanwise access panels.
const slot = mirror('hinge slot', [tube('hinge slot', [0.1, 0.17, 0.33, 0.7, 1.03].map((g) => wingUp(g, 1 - CF - 0.012, 0.0015)), 0.0018, { role: 'wing', paint: 'seam', sides: 4, ...FINE })]);
const wingSeams = mirror('wing panels', [
  ...[[0.4, 0.6], [0.66, 0.86]].map(([g0, g1]) => tube('wing access panel', [wingUp(g0, 0.2, 0.0014), wingUp(g1, 0.2, 0.0014), wingUp(g1, 0.5, 0.0014), wingUp(g0, 0.5, 0.0014), wingUp(g0, 0.2, 0.0014)], 0.0014, { role: 'wing', paint: 'seam', sides: 4, ...FINE })),
  tube('wing fold line', [0.06, 0.12, 0.18].map((x) => wingUp(0.36, x, 0.0014)).concat([0.4, 0.6, 0.72].map((x) => wingUp(0.36, x, 0.0014))), 0.0014, { role: 'wing', paint: 'seam', sides: 4, ...FINE }),
  // A thin red light along the outer leading edge, the striker's running line.
  tube('leading edge light', range(0.36, 1.0, 8).map((g) => { const p = wingAt(g, 0.01, 1); return [p[0] + 0.002, g, p[2] + 0.001]; }), 0.0016, { role: 'wing', paint: 'led', sh: 1, sides: 4, ...FINE }),
]);
// Dive brakes: slatted bars under each outer panel, ahead of the flaps, as the Stuka's were. Shut they
// lie flat under the wing; on the channel they swing trailing edge down to stand across the air.
const brakeBar = (g0, g1) => {
  const xa = 0.42, ch = 0.075;
  const hA = wingLo(g0, xa, 0.016), hB = wingLo(g1, xa, 0.016);
  const piv = [lerp(hA[0], hB[0], 0.5), (g0 + g1) / 2, lerp(hA[2], hB[2], 0.5)];
  const faces = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const u0 = i / n + 0.012, u1 = (i + 1) / n - 0.012;
    const fA = (u) => [hA[0] - ch * u, g0, hA[2] - 0.002 * u], fB = (u) => [hB[0] - ch * u, g1, hB[2] - 0.002 * u];
    faces.push({ role: 'strut', paint: 'brake', sh: 0.62, p: [fA(u0), fB(u0), fB(u1), fA(u1)] });
    faces.push({ role: 'strut', paint: 'brake', sh: 0.4, p: [fA(u1), fB(u1), fB(u0), fA(u0)] });
  }
  // The frame round the slats and its red edge.
  const frame = tube('dive brake frame', [hA, hB, [hB[0] - ch, g1, hB[2] - 0.002], [hA[0] - ch, g0, hA[2] - 0.002], hA], 0.0022, { role: 'strut', paint: 'carbon', sides: 4 });
  const edge = tube('dive brake edge', [[hA[0] - ch, g0, hA[2] - 0.002], [hB[0] - ch, g1, hB[2] - 0.002]], 0.0016, { role: 'strut', paint: 'trim', sides: 4 });
  // The hinge on two hangers from the wing.
  const hang = [g0 + 0.02, g1 - 0.02].map((g) => tube('dive brake hanger', [wingLo(g, xa, 0), [lerp(hA[0], hB[0], (g - g0) / (g1 - g0)), g, lerp(hA[2], hB[2], (g - g0) / (g1 - g0))]], 0.0026, { role: 'strut', paint: 'carbon', sides: 4, ...FINE }));
  return [group('dive brake', [poly('dive brake slats', faces), frame, edge], { ...FINE, anim: { ch: 'diveBrake', pivot: P3(piv), axis: P3([hB[0] - hA[0], g1 - g0, hB[2] - hA[2]].map((v, i, a) => v / Math.hypot(...a))), ang: [0, -85], span: [0, 0.5] } }), ...hang];
};
const brakes = mirror('dive brakes', [...brakeBar(0.42, 0.58), ...brakeBar(0.64, 0.8)]);
// The tip: a raked light pod, the nav lens forward and the strobe aft.
const tip = SH76_WING.tip;
const tipPods = mirror('tip pods', [
  group('tip pod', [pod('tip pod', 0, 0, [[tip.le + 0.02, 0.002], [tip.le + 0.008, 0.008], [tip.le - 0.02, 0.011], [tip.te + 0.01, 0.009], [tip.te - 0.02, 0.003]], { sides: 8, paint: 'hull', shade: { base: 0.55, amp: 0.34 } })],
    { xf: { t: [0, tip.g + 0.004, tip.h + 0.003] }, ...FINE }),
  group('nav lens', [pod('nav lens', 0, 0, [[tip.le + 0.024, 0.0015], [tip.le + 0.016, 0.006], [tip.le + 0.006, 0.008]], { sides: 8, role: 'glass', paint: 'navR' })],
    { xf: { t: [0, tip.g + 0.004, tip.h + 0.003] }, ...FINE }),
  tube('tip strobe', [[tip.te - 0.012, tip.g + 0.004, tip.h + 0.003], [tip.te - 0.026, tip.g + 0.004, tip.h + 0.003]], 0.0038, { role: 'nacelle', paint: 'strobe', sh: 1, sides: 6, caps: 1, ...FINE }),
]);
// ── The loitering munitions ────────────────────────────────────────────────────
// The 2020s' contribution: under each outer panel, on a short pylon, a tube-launched loiterer with
// its wings folded along its body, a seeker in its nose and a pusher's blades folded at its tail.
const LM = { g: 0.92, len: 0.15, r: 0.0125 };
const lmZ = () => wingAt(LM.g, 0.4, 0)[2] - 0.03;
const loiterers = mirror('loitering munitions', [
  poly('pylon', [{ role: 'gun', paint: 'carbon', sh: 0.6, p: [wingLo(LM.g, 0.3, -0.002), wingLo(LM.g, 0.62, -0.002), [wingAt(LM.g, 0.58, 0)[0], LM.g, lmZ() + LM.r], [wingAt(LM.g, 0.34, 0)[0], LM.g, lmZ() + LM.r]] }], FINE),
  group('loiterer', [
    pod('loiterer body', 0, 0, [[LM.len * 0.5, 0.003], [LM.len * 0.44, 0.009], [LM.len * 0.34, LM.r], [-LM.len * 0.4, LM.r], [-LM.len * 0.5, 0.007]], { sides: 10, paint: 'store', shade: { base: 0.5, amp: 0.34 } }),
    pod('loiterer seeker', 0, 0, [[LM.len * 0.505, 0.0012], [LM.len * 0.49, 0.0045], [LM.len * 0.47, 0.007]], { sides: 8, role: 'glass', paint: 'lens' }),
    poly('folded wings', [-1, 1].map((sg) => ({ role: 'gun', paint: 'store', sh: 0.7, p: [[LM.len * 0.3, sg * 0.004, LM.r + 0.001], [-LM.len * 0.36, sg * 0.004, LM.r + 0.001], [-LM.len * 0.36, sg * 0.012, LM.r - 0.001], [LM.len * 0.26, sg * 0.012, LM.r - 0.001]] }))),
    poly('tail fins', [45, 135, 225, 315].map((d) => { const c = Math.cos(d * DEG), sn = Math.sin(d * DEG); return { role: 'gun', paint: 'store', sh: 0.62, p: [[-LM.len * 0.36, c * LM.r * 0.8, sn * LM.r * 0.8], [-LM.len * 0.48, c * LM.r * 1.9, sn * LM.r * 1.9], [-LM.len * 0.52, c * LM.r * 1.9, sn * LM.r * 1.9], [-LM.len * 0.5, c * LM.r * 0.7, sn * LM.r * 0.7]] }; })),
    tube('folded blades', [[-LM.len * 0.5, 0, 0.007], [-LM.len * 0.38, 0, 0.012]], 0.0016, { role: 'gun', paint: 'carbon', sides: 4 }),
    tube('arming band', range(0, 360, 10).map((d) => [LM.len * 0.2, Math.cos(d * DEG) * (LM.r + 0.0008), Math.sin(d * DEG) * (LM.r + 0.0008)]), 0.0012, { role: 'gun', paint: 'trim', sides: 4 }),
  ], { xf: { t: [wingAt(LM.g, 0.46, 0)[0], LM.g, lmZ()] }, ...FINE }),
]);

// Leading-edge strakes from the intake's cheeks to the wing root, along the chine: the knife edge
// carried out into the wing.
const strake = mirror('chine strakes', [poly('chine strake', (() => {
  const fs = range(0.74, 0.36, 6), out = [];
  for (let i = 0; i < fs.length - 1; i++) {
    const a = fs[i], b = fs[i + 1], wa = 0.004 + 0.05 * (i / (fs.length - 1)) ** 1.5, wb = 0.004 + 0.05 * ((i + 1) / (fs.length - 1)) ** 1.5;
    const A = at(a, K.chine), B = at(b, K.chine);
    const A2 = [a, A[1] + wa, A[2] - 0.003], B2 = [b, B[1] + wb, B[2] - 0.004];
    out.push({ role: 'wing', paint: 'hull', sh: 0.84, p: [B, A, A2, B2] });
    out.push({ role: 'wing', paint: 'belly', sh: 0.42, p: [B2, A2, [A[0], A[1], A[2] - 0.005], [B[0], B[1], B[2] - 0.006]] });
  }
  return out;
})(), FINE)]);


// ── The small engineering ──────────────────────────────────────────────────────
// Flare dispensers under the tail, the engine bay's louvres, formation strips, static ports, static
// wicks on every trailing surface, vortex generators on the outer panels, the canopy's breaker line.
const cell = (f, k, df, dk, paint, o = 0.0022, sh = 0.3) => {
  const p = [at(f - df, k - dk, o), at(f + df, k - dk, o), at(f + df, k + dk, o), at(f - df, k + dk, o)];
  return { paint, sh, p: k > NR / 2 ? p.reverse() : p };
};
const flares = [0, 1].map((s) => poly('flare dispenser (' + (s ? 'left' : 'right') + ')', range(-0.56, -0.68, 5).flatMap((f) => range(2.4, 4.2, 2).map((k) => cell(f, s ? mirK(k) : k, 0.0085, 0.26, 'intake'))), FINE));
const flareFrames = [0, 1].map((s) => rectSeam('flare dispenser frame (' + (s ? 'left' : 'right') + ')', -0.695, -0.545, s ? mirK(4.6) : 2.0, s ? mirK(2.0) : 4.6, 0.0024));
const louvres = [0, 1].map((s) => poly('engine bay louvres (' + (s ? 'left' : 'right') + ')', range(-0.22, -0.4, 6).map((f) => cell(f, s ? mirK(10.6) : 10.6, 0.006, 1.1, 'intake', 0.0022, 0.25)), FINE));
const louvreLips = [0, 1].map((s) => poly('louvre lips (' + (s ? 'left' : 'right') + ')', range(-0.22, -0.4, 6).map((f) => cell(f + 0.007, s ? mirK(10.6) : 10.6, 0.0014, 1.1, 'metal', 0.0034, 0.8)), FINE));
const formation = [
  ...[0, 1].map((s) => poly('formation strip (nose, ' + (s ? 'left' : 'right') + ')', [cell(0.74, s ? mirK(9.6) : 9.6, 0.03, 0.18, 'formation', 0.0024, 1)], FINE)),
  ...[0, 1].map((s) => poly('formation strip (tail, ' + (s ? 'left' : 'right') + ')', [cell(-0.74, s ? mirK(9.2) : 9.2, 0.03, 0.2, 'formation', 0.0024, 1)], FINE)),
  mirror('formation strip (fin)', [poly('formation strip (fin)', [{ role: 'fin', paint: 'formation', sh: 1, p: [[-0.62, 0.012, 0.13], [-0.7, 0.0115, 0.25], [-0.712, 0.0112, 0.25], [-0.632, 0.0118, 0.13]] }], FINE)]),
];
const ports = [0, 1].flatMap((s) => [0.98, 0.95].map((f) => {
  const c = at(f, s ? mirK(8.5) : 8.5, 0.0024), sg = s ? -1 : 1;
  return poly('static port', [{ paint: 'metal', sh: 0.85, p: range(0, 330, 11).map((d) => [c[0] + Math.cos(d * DEG) * 0.004, c[1] + sg * 0.0004, c[2] + Math.sin(d * DEG) * 0.004]) }], FINE);
}));
// Static wicks: short rods off the trailing edges, two per aileron, elevator and the rudder's top.
const wick = (p) => tube('static wick', [p, [p[0] - 0.02, p[1], p[2]]], 0.0011, { role: 'nacelle', paint: 'carbon', sides: 3, ...FINE });
const wicks = [
  mirror('aileron wicks', [0.84, 0.98].map((g) => { const q = wingAt(g, 1, 1); return wick([q[0] - 0.002, g, q[2] - 0.002]); })),
  mirror('tip wicks', [wick([SH76_WING.tip.te - 0.004, SH76_WING.tip.g - 0.01, SH76_WING.tip.h])]),
];
// Vortex generators: a row of small blades across the outer panel's upper surface, ahead of the
// ailerons, to keep the flow on them at the bottom of the pull-out.
const vgs = mirror('vortex generators', [poly('vortex generators', range(0.74, 1.0, 9).map((g, i) => {
  const a = wingUp(g, 0.12, 0), b = wingUp(g, 0.16, 0), tw = (i % 2 ? 1 : -1) * 0.004;
  return { role: 'wing', paint: 'seam', sh: 0.7, p: [a, b, [b[0], b[1] + tw, b[2] + 0.007], [a[0], a[1] + tw * 0.5, a[2] + 0.003]] };
}), FINE)]);
// The canopy's breaker line: a yellow zigzag under the glass over the pilot's head, the cord that
// shatters it for a seat that goes through.
const zig = range(GF.f[0] + 0.03, GF.bow - 0.02, 12).map((f, i) => at(f, 15 + (i % 2 ? 1.1 : -1.1), 0.0024));
const breaker = tube('canopy breaker zigzag', zig, 0.0011, { role: 'nacelle', paint: 'hazard', sh: 0.85, sides: 3, ...FINE });

// ── The legs: fixed talons, and the alert broadcaster where the siren was ──────
const MW = SH76_GEAR.main, TW = SH76_GEAR.tail;
const kneeLo = wingLo(MW.g, 0.45, 0);
const mainGear = mirror('main gear', [
  // The trouser, faceted: a blade-section fairing from the knee down over the leg, its spat round
  // the top of the wheel.
  faired('trouser', [[0.24, MW.g, kneeLo[2] + 0.01], [0.235, MW.g, -0.15], [MW.f + 0.01, MW.g, -0.2]], 0.11, 0.028, { role: 'nacelle', paint: 'hull' }),
  group('spat', [pod('spat', 0, 0, [[0.29, 0.006], [0.265, 0.03, 0.004], [0.21, 0.045, 0.008], [0.15, 0.04, 0.012], [0.11, 0.012, 0.02]], { sides: 6, paint: 'hull', shade: { base: 0.5, amp: 0.36 } })],
    { xf: { t: [0, MW.g, -0.205], s: [1, 0.62, 1] } }),
  // The talon's red claw edge down the trouser's leading edge.
  tube('talon edge', [[0.296, MW.g, kneeLo[2] - 0.004], [0.29, MW.g, -0.15], [0.288, MW.g, -0.2]], 0.0022, { role: 'nacelle', paint: 'trim', sides: 4, ...FINE }),
  { ...wheel('main wheel', [MW.f, MW.g, MW.h], MW.r, MW.hw, 18), ...FINE },
  tube('axle', [[MW.f, MW.g - MW.hw - 0.008, MW.h], [MW.f, MW.g + MW.hw + 0.008, MW.h]], 0.006, { role: 'gear', paint: 'metal', sides: 8, ...FINE }),
  tube('brake disc', [[MW.f, MW.g - MW.hw - 0.001, MW.h], [MW.f, MW.g - MW.hw - 0.004, MW.h]], 0.028, { role: 'gear', paint: 'metal', sides: 14, caps: 1, ...FINE }),
  tube('brake caliper', [[MW.f + 0.02, MW.g - MW.hw - 0.006, MW.h + 0.018], [MW.f + 0.03, MW.g - MW.hw - 0.006, MW.h + 0.004]], 0.006, { role: 'gear', paint: 'trim', sides: 6, ...FINE }),
  tube('hub', [[MW.f, MW.g + MW.hw - 0.001, MW.h], [MW.f, MW.g + MW.hw + 0.004, MW.h]], 0.02, { role: 'gear', paint: 'carbon', sides: 10, caps: 1, ...FINE }),
  tube('oleo', [[MW.f + 0.006, MW.g - 0.02, -0.17], [MW.f, MW.g - 0.02, MW.h + 0.006]], 0.0045, { role: 'gear', paint: 'metal', sides: 6, ...FINE }),
  // The torque link on the oleo and the brake line down it.
  tube('torque link', [[MW.f + 0.006, MW.g - 0.026, -0.19], [MW.f + 0.022, MW.g - 0.026, -0.205], [MW.f + 0.003, MW.g - 0.026, -0.222]], 0.0022, { role: 'gear', paint: 'carbon', sides: 4, ...FINE }),
  tube('brake line', [[MW.f - 0.004, MW.g - 0.024, -0.16], [MW.f - 0.006, MW.g - 0.024, -0.215], [MW.f + 0.01, MW.g - MW.hw - 0.006, MW.h + 0.012]], 0.0012, { role: 'gear', paint: 'hazard', sides: 3, ...FINE }),
  // The taxi light in the spat's nose, and the alert broadcaster on the trouser where the Jericho
  // siren was: a pointed emitter with a red ring that lights in the dive.
  tube('spat light', [[0.285, MW.g, -0.198], [0.293, MW.g, -0.198]], 0.006, { role: 'nacelle', paint: 'strobe', sh: 1, sides: 8, caps: 1, ...FINE }),
  cone('alert broadcaster', 0.29, MW.g + 0.006, -0.105, 0.011, [0.33, MW.g + 0.006, -0.105], { paint: 'carbon', n: 8, role: 'nacelle', ...FINE }),
  tube('broadcaster ring', range(0, 360, 10).map((d) => [0.296, MW.g + 0.006 + Math.cos(d * DEG) * 0.0118, -0.105 + Math.sin(d * DEG) * 0.0118]), 0.0016, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  tube('broadcaster mount', [[0.27, MW.g, -0.105], [0.29, MW.g + 0.006, -0.105]], 0.004, { role: 'nacelle', paint: 'carbon', sides: 6, ...FINE }),
]);
const tailGear = group('tailwheel', [
  faired('tail leg', [[-0.85, 0, at(-0.85, 0)[2] + 0.004], [-0.865, 0, -0.04], [TW.f + 0.004, 0, TW.h + 0.012]], 0.024, 0.006, { role: 'gear', paint: 'carbon' }),
  tube('tail fork', [[TW.f + 0.008, -TW.hw - 0.003, TW.h + 0.016], [TW.f, -TW.hw - 0.003, TW.h], [TW.f, TW.hw + 0.003, TW.h], [TW.f + 0.008, TW.hw + 0.003, TW.h + 0.016]], 0.0026, { role: 'gear', paint: 'metal', sides: 5 }),
  wheel('tailwheel', [TW.f, 0, TW.h], TW.r, TW.hw, 12),
], FINE);

// ── The jet: the nozzle at the tail ────────────────────────────────────────────
// A flattened exit, wider than tall, its trailing edge serrated, the turbine's hot face deep inside.
const NF = NZ.f;
const nozzle = [
  group('nozzle', [pod('nozzle', 0, 0, [[NF + 0.03, 1.0], [NF, 1.0], [NF - 0.045, 0.94]], { sides: 18, paint: 'nozzle', shade: { base: 0.5, amp: 0.3 } })], { xf: { t: [0, 0, NZ.h], s: [1, NZ.rw, NZ.rh] }, ...FINE }),
  poly('nozzle throat', [{ role: 'nacelle', paint: 'exhaustIn', sh: 0.3, p: range(0, 360, 18).slice(0, -1).map((d) => [NF - 0.03, Math.cos(d * DEG) * NZ.rw * 0.86, NZ.h + Math.sin(d * DEG) * NZ.rh * 0.86]) }], FINE),
  poly('turbine face', [{ role: 'nacelle', paint: 'glow', sh: 1, p: range(0, 360, 12).slice(0, -1).map((d) => [NF - 0.02, Math.cos(d * DEG) * NZ.rw * 0.55, NZ.h + Math.sin(d * DEG) * NZ.rh * 0.55]) }], FINE),
  poly('nozzle serrations', range(0, 360, 12).slice(0, -1).map((d, i) => {
    const a0 = d * DEG, a1 = (d + 30) * DEG, am = (d + 15) * DEG, r0 = 0.94, f0 = NF - 0.045, f1 = NF - 0.06;
    const P = (a, r, f) => [f, Math.cos(a) * NZ.rw * r, NZ.h + Math.sin(a) * NZ.rh * r];
    return { role: 'nacelle', paint: 'nozzle', sh: 0.55, p: [P(a0, r0, f0), P(am, r0 * 0.97, f1), P(a1, r0, f0)] };
  }), FINE),
  SEAM('nozzle seam', range(0, 360, 18).map((d) => [NF + 0.002, Math.cos(d * DEG) * NZ.rw * 1.02, NZ.h + Math.sin(d * DEG) * NZ.rh * 1.02])),
];
// The tail's own cap behind the hull's last ring, round the nozzle.
const tailCap = poly('tail cap', [{ role: 'body', paint: 'hull', sh: 0.45, p: ALLK.map((k) => at(STF[STF.length - 1], k)) }], FINE);

// ── The tail ───────────────────────────────────────────────────────────────────
// One big swept fin, the Stuka's own proportion, with a radar warning cap, a beacon and a strobe; a
// swept tailplane with a touch of anhedral; two canted ventral strakes under the jet.
const FN = [
  { g: 0.08, le: -0.44, te: -0.93, h: 0, t: 0.95 },
  { g: 0.3, le: -0.7, te: -0.96, h: 0, t: 0.8 },
  { g: 0.47, le: -0.86, te: -0.99, h: 0, t: 0.65 },
];
const fin = foil('fin', FN, { axis: 'g', role: 'fin', paint: 'hull', nx: 11, bands: [{ x0: 0, x1: 0.06, paint: 'edge' }] });
const rudder = { ...ctrlOn('rudder', FN[0], FN[2], 0.12, 0.92, 0.3, { axis: 'g', sh: 0.7 }), paint: 'hull' };
const TP = [
  { g: 0.03, le: -0.66, te: -0.9, h: 0.058, t: 0.9 },
  { g: 0.38, le: -0.84, te: -0.95, h: 0.046, t: 0.72 },
];
const tailplane = foil('tailplane', TP, { role: 'stab', paint: 'hull', nx: 9, bands: [{ x0: 0, x1: 0.07, paint: 'edge' }] });
const elevators = { ...ctrlOn('elevator', TP[0], TP[1], 0.12, 0.96, 0.32), paint: 'hull' };
const finTop = FN[2];
const tail = [
  group('RWR cap', [pod('rwr', 0, 0, [[finTop.le + 0.0, 0.003], [finTop.le - 0.02, 0.009], [finTop.te + 0.01, 0.009], [finTop.te - 0.006, 0.004]], { sides: 8, paint: 'radome' })], { xf: { t: [0, 0, finTop.g + 0.004] }, ...FINE }),
  { kind: 'drum', name: 'fin beacon', f: -0.9, r: 0.0065, n: 10, z: [R(finTop.g + 0.012), R(finTop.g + 0.024)], role: 'nacelle', paint: 'beacon', sh: { base: 0.9 }, top: { sh: 1 }, ...FINE },
  tube('fin strobe', [[finTop.te - 0.004, 0, finTop.g - 0.02], [finTop.te - 0.016, 0, finTop.g - 0.02]], 0.004, { role: 'nacelle', paint: 'strobe', sh: 1, sides: 6, caps: 1, ...FINE }),
  // The fin flash: a red chevron on each side, and the low light along the fin's root.
  mirror('fin flash', [poly('fin flash', [{ role: 'fin', paint: 'trim', sh: 0.8, p: [[-0.62, 0.0115, 0.19], [-0.76, 0.0105, 0.33], [-0.8, 0.0098, 0.33], [-0.68, 0.0108, 0.19]] },
    { role: 'fin', paint: 'trim', sh: 0.8, p: [[-0.7, 0.0108, 0.19], [-0.82, 0.0096, 0.31], [-0.845, 0.0092, 0.31], [-0.74, 0.0104, 0.19]] }], FINE)]),
  mirror('ventral strakes', [group('ventral strake', [{ kind: 'blade', name: 'strake', role: 'fin', paint: 'hull', t: 0.003, sh: [0.7, 0.5], outline: [[-0.6, 0], [-0.7, -0.05], [-0.82, -0.05], [-0.8, 0]] }],
    { xf: { t: [0, 0.035, 0.012], r: [-30, 0, 0] }, ...FINE })]),
  mirror('tailplane tip lights', [{ kind: 'drum', name: 'tailplane tip light', f: -0.9, g: 0.382, r: 0.0045, n: 8, z: [0.044, 0.052], role: 'nacelle', paint: 'led', sh: { base: 1 }, top: { sh: 1 }, ...FINE }]),
];

// ── The spine: datalink, antennas, the beacon ──────────────────────────────────
// Behind the canopy a low satcom hump carries the link that lets her fly without a pilot; blade
// antennas down the spine and under the belly; the top beacon at the hump's foot.
const crownH = (f) => at(f, 15)[2];
const spine = [
  group('satcom hump', [pod('satcom', 0, 0, [[0.06, 0.004], [0.04, 0.02], [0.0, 0.026], [-0.06, 0.022], [-0.1, 0.004]], { sides: 12, paint: 'radome', shade: { base: 0.55, amp: 0.36 } })],
    { xf: { t: [0.02, 0, crownH(0.02) - 0.006], s: [1, 1, 0.55] }, ...FINE }),
  { kind: 'drum', name: 'spine beacon', f: -0.14, r: 0.007, n: 10, z: [R(crownH(-0.14) - 0.002), R(crownH(-0.14) + 0.01)], role: 'nacelle', paint: 'beacon', sh: { base: 0.9 }, top: { sh: 1 }, ...FINE },
  { kind: 'blade', name: 'UHF blade', role: 'fin', paint: 'carbon', t: 0.0025, sh: [0.75, 0.6], outline: [[-0.24, R(crownH(-0.24) - 0.004)], [-0.27, R(crownH(-0.24) + 0.04)], [-0.285, R(crownH(-0.24) + 0.04)], [-0.3, R(crownH(-0.3) - 0.004)]], ...FINE },
  { kind: 'blade', name: 'link blade', role: 'fin', paint: 'carbon', t: 0.0025, sh: [0.75, 0.6], outline: [[-0.38, R(crownH(-0.38) - 0.004)], [-0.4, R(crownH(-0.38) + 0.026)], [-0.41, R(crownH(-0.38) + 0.026)], [-0.43, R(crownH(-0.43) - 0.004)]], ...FINE },
  { kind: 'blade', name: 'IFF blade', role: 'fin', paint: 'carbon', t: 0.0025, sh: [0.75, 0.6], outline: [[0.86, R(at(0.86, 0)[2] + 0.004)], [0.85, R(at(0.86, 0)[2] - 0.026)], [0.84, R(at(0.86, 0)[2] - 0.026)], [0.82, R(at(0.82, 0)[2] + 0.004)]], ...FINE },
  { kind: 'drum', name: 'belly beacon', f: -0.3, r: 0.007, n: 10, z: [R(at(-0.3, 0)[2] - 0.01), R(at(-0.3, 0)[2] + 0.002)], role: 'nacelle', paint: 'beacon', sh: { base: 0.9 }, bottom: { sh: 1 }, ...FINE },
];

// ── The room behind the glass ──────────────────────────────────────────────────
// Seen through the canopy from outside: the seat, the coaming and its HUD, the stick. The seated
// cockpit is interior-shrike-2076.js.
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
const IN = SH76_INSIDE, FH = IN.floorH;
const room = [
  poly('seat', [
    ...slab([IN.pilotF + 0.02, 0, FH + 0.04], [0.07, 0.07, 0.014], 4, { paint: 'seat' }),
    ...slab([IN.pilotF - 0.03, 0, FH + 0.11], [0.014, 0.068, 0.13], -18, { paint: 'seat' }),
    ...slab([IN.pilotF - 0.05, 0, FH + 0.185], [0.02, 0.04, 0.03], -18, { paint: 'seat' }),
    // The seat's striped handle, yellow and black.
    ...slab([IN.pilotF + 0.06, 0, FH + 0.055], [0.01, 0.02, 0.012], 0, { paint: 'hazard' }),
  ], FINE),
  tube('stick', [[IN.pilotF + 0.08, 0.02, FH + 0.02], [IN.pilotF + 0.085, 0.024, FH + 0.07]], 0.003, { role: 'nacelle', paint: 'interior', sides: 5, ...FINE }),
  poly('floor', [quad([0.62, -0.06, FH], [0.62, 0.06, FH], [IN.bulkheadF, 0.06, FH], [IN.bulkheadF, -0.06, FH], { paint: 'interior', sh: 0.45 })], FINE),
  poly('coaming', [...slab([IN.panelF, 0, 0.08], [0.05, 0.13, 0.02], 8, { paint: 'interior' }), ...slab([IN.panelF - 0.03, 0, 0.065], [0.006, 0.12, 0.04], -60, { paint: 'screen' })], FINE),
  poly('HUD combiner', [quad([IN.panelF - 0.01, -0.02, 0.092], [IN.panelF - 0.01, 0.02, 0.092], [IN.panelF - 0.02, 0.02, 0.122], [IN.panelF - 0.02, -0.02, 0.122], { role: 'glass', paint: 'hud', sh: 0.9 })], FINE),
  poly('bulkhead', [quad([IN.bulkheadF, -0.07, FH], [IN.bulkheadF, 0.07, FH], [IN.bulkheadF, 0.07, 0.13], [IN.bulkheadF, -0.07, 0.13], { paint: 'interior', sh: 0.5 })], FINE),
];

// ── The coarse body, for range ─────────────────────────────────────────────────
const FAR_K = [0, 2, 5, 7, 9, 12, 15, 18, 21, 23, 25, 28];
const farF = STF.filter((f, i) => i % 3 === 0 || i === STF.length - 1 || f === 0.7 || f === 0.705);
const coarse = [
  poly('fuselage (far)', hullFaces([...new Set(farF)], FAR_K).map((fc) => ({ ...fc, sh: fc.sh })), COARSE),
  poly('nozzle (far)', [{ role: 'nacelle', paint: 'exhaustIn', sh: 0.3, p: FAR_K.map((k) => at(STF[STF.length - 1], k)) }], COARSE),
  mirror('gear (far)', [
    tube('trouser (far)', [[0.24, MW.g, kneeLo[2]], [MW.f + 0.01, MW.g, -0.2]], 0.016, { role: 'nacelle', paint: 'hull', sides: 4, ...COARSE }),
    { ...wheel('main wheel (far)', [MW.f, MW.g, MW.h], MW.r, MW.hw, 8), ...COARSE },
  ]),
  { ...wheel('tailwheel (far)', [TW.f, 0, TW.h], TW.r, TW.hw, 6), ...COARSE },
];

// ── Lamps ──────────────────────────────────────────────────────────────────────
const lamps = [
  { at: [R(tip.le + 0.026), R(-tip.g - 0.004), R(tip.h + 0.003)], n: [0.3, -1, 0], rgb: '255,55,55', kind: 'steady' },
  { at: [R(tip.le + 0.026), R(tip.g + 0.004), R(tip.h + 0.003)], n: [0.3, 1, 0], rgb: '60,255,95', kind: 'steady' },
  { at: [R(tip.te - 0.028), R(-tip.g - 0.004), R(tip.h + 0.003)], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [R(tip.te - 0.028), R(tip.g + 0.004), R(tip.h + 0.003)], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [R(finTop.te - 0.018), 0, R(finTop.g - 0.02)], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [-0.9, 0, R(finTop.g + 0.026)], n: [0, 0, 1], rgb: '255,90,70', kind: 'beacon' },
  { at: [-0.14, 0, R(crownH(-0.14) + 0.012)], n: [0, 0, 1], rgb: '255,90,70', kind: 'beacon' },
  { at: [-0.3, 0, R(at(-0.3, 0)[2] - 0.012)], n: [0, 0, -1], rgb: '255,90,70', kind: 'beacon' },
];

const doc = {
  id: 'divebomber_2076',
  kind: 'mesh',
  params: {
    name: 'Shrike 2076',
    note: 'CONCEPT, generated by scripts/shapes/concepts/shrike-2076.mjs (edit that, not this). The Stuka fifty years on: an optionally crewed single-seat dive striker. A chined hull with the drooping beak kept and a targeting turret under it; one jet in the tail fed by a chin intake where the radiator hung; a gold-filmed canopy; the inverted gull wing, cranked and swept, with the slatted dive brakes under it, flaps and ailerons; the bomb inside a bay between the knees on a trapeze; fixed talon legs with a cell broadcaster on each where the siren was, which pushes the dive alert to every tablet in the target zone; a big swept fin, a swept tailplane, ventral strakes. The diveBrake channel swings the brakes, opens the bay and lowers the bomb. A variant of the divebomber mesh, worn as the Shrike 2076 factory edition.',
    groundPitch: 9,
    navLamps: null,
    hull: 'fuselage',
    lamps,
    finish: 'satin',
    paints: {
      hull: { rgb: [52, 56, 60], livery: 'base', mat: 'satin' },
      trim: { rgb: [168, 36, 28], livery: 'trim' },
      belly: { rgb: [82, 88, 92], livery: 'fixed', mat: 'satin' },
      radome: { rgb: [40, 43, 46], livery: 'fixed', mat: 'matte' },
      edge: { rgb: [30, 32, 34], livery: 'fixed', mat: 'matte' },
      mask: { rgb: [16, 17, 19], livery: 'fixed', mat: 'matte' },
      frame: { rgb: [22, 24, 26], livery: 'fixed', mat: 'gloss' },
      seam: { rgb: [32, 35, 38], livery: 'fixed', mat: 'matte' },
      carbon: { rgb: [30, 32, 34], livery: 'fixed', mat: 'satin' },
      metal: { rgb: [138, 144, 148], livery: 'fixed', mat: 'bare' },
      intake: { rgb: [12, 13, 14], livery: 'fixed', mat: 'matte' },
      bayIn: { rgb: [58, 66, 60], livery: 'fixed', mat: 'matte' },
      store: { rgb: [70, 74, 64], livery: 'fixed', mat: 'satin' },
      brake: { rgb: [44, 46, 48], livery: 'fixed', mat: 'steel' },
      nozzle: { rgb: [96, 88, 82], livery: 'fixed', mat: 'exhaust' },
      exhaustIn: { rgb: [20, 18, 18], livery: 'fixed', mat: 'matte' },
      glow: { rgb: [200, 84, 44], livery: 'fixed', mat: 'matte' },
      lens: { rgb: [16, 24, 34], livery: 'fixed', mat: 'gloss' },
      lensRed: { rgb: [170, 40, 36], livery: 'fixed', mat: 'gloss' },
      led: { rgb: [255, 64, 46], livery: 'fixed', mat: 'matte' },
      formation: { rgb: [150, 236, 120], livery: 'fixed', mat: 'matte' },
      hazard: { rgb: [214, 176, 36], livery: 'fixed', mat: 'gloss' },
      navR: { rgb: [210, 210, 210], livery: 'fixed', mat: 'gloss' },
      beacon: { rgb: [235, 70, 56], livery: 'fixed', mat: 'gloss' },
      strobe: { rgb: [240, 244, 248], livery: 'fixed', mat: 'gloss' },
      interior: { rgb: [36, 38, 40], livery: 'fixed', mat: 'matte' },
      seat: { rgb: [52, 54, 50], livery: 'fixed', mat: 'satin' },
      screen: { rgb: [60, 190, 170], livery: 'fixed', mat: 'gloss' },
      hud: { rgb: [90, 200, 150], livery: 'fixed', mat: 'gloss' },
    },
    parts: [
      fuselage, noseCap, ...frames, ...seams, ...eo, ...probes, ...das, ...eyeLine, ...intake,
      ...bay, bayDoors, bomb, rack,
      wing, loiterers, flapsIn, flapsKnee, flapsOut, ailerons, slot, wingSeams, brakes, tipPods, strake,
      mainGear, tailGear, ...nozzle, tailCap,
      ...flares, ...flareFrames, ...louvres, ...louvreLips, ...formation, ...ports, ...wicks, vgs, breaker,
      fin, rudder, tailplane, elevators, ...tail, ...spine, ...room,
      ...coarse,
    ],
  },
};

const v = validateMesh(doc.params, doc.id);
if (v.errors.length) { console.log('ERRORS', v.errors.slice(0, 12)); process.exit(1); }
if (v.warnings?.length) console.log('warnings', v.warnings.slice(0, 8));
const n1 = compileMesh(doc.params, { detail: 1 }).faces.length, n0 = compileMesh(doc.params, { detail: 0 }).faces.length;
writeFileSync(new URL('../../../content/vehicle_models/mesh_divebomber_2076.json', import.meta.url), formatMesh(doc));
console.log('mesh_divebomber_2076.json:', n1, 'faces near,', n0, 'far');
