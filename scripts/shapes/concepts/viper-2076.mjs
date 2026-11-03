// The Viper 2076 concept: writes content/vehicle_models/mesh_heli_armed_2076.json.
//
//   node scripts/shapes/concepts/viper-2076.mjs
//   then: npm run vehicles:bake
//
// The Viper fifty years on, after the Bell MV-75 (the V-280 Valor) and the Air-Launched Effects it
// carries: a tiltrotor drone carrier. A slim hull with a wrapped flight-deck windscreen and a sliding
// cabin door each side, a straight high wing with an engine nacelle fixed at each tip and a proprotor
// pylon standing on it, a V-tail, low stub wings carrying the old Viper's rocket pods and missiles,
// the chin gun kept, and a bank of four launch tubes each side of the aft fuselage. While the master
// arm is on, the tubes' caps swing open and eight small folding-wing drones fly out to hold a box
// round her (the `drones` channel, cockpit.js classAnim); they go home when she is made safe.
//
// The sim has no tilt channel, so the pylons stand in helicopter mode and stay there. It is the
// armed heli's 2076 edition (mesh_heli_armed.json `variants`), on the armed mesh's frame: the same
// `scale` 2, the same 7-degree sit, the main wheels and the tailwheel on the same ground plane.
//
// ⚠ THIS OVERWRITES THE JSON. Edit this file, not the mesh in the Modelshop.
//
// Two bodies in one file. Everything fine is `minDetail: 1`; a coarse body with `maxDetail: 0`
// stands in at range.
//
// Frame: f fore, g right, h up, in the armed heli's units. Angles on a section are lib.mjs's: 0 =
// right waterline, +90 = crown, -90 = keel.
import { writeFileSync } from 'node:fs';
import { R, P3, skin, loft, pod, foil, ctrlOn, tube, mirror, group, poly as rawPoly, quad, DEG } from '../fw-meshes/lib.mjs';
const { formatMesh, validateMesh, compileMesh } = await import('../../../client/shared/vehicle-mesh.js');
const { VP76_STATIONS, VP76_APEX, VP76_TAIL, VP76_GLASS, VP76_DOOR, VP76_SLIDER, VP76_INSIDE, VP76_NACELLE, VP76_ALE, aleMouth } = await import('../../../client/shared/cabin-viper-2076.js');

const FINE = { minDetail: 1 }, COARSE = { maxDetail: 0 };
const poly = (name, faces, extra) => rawPoly(name, faces.map((f) => ({ role: 'nacelle', ...f })), extra);
const GLASS = [44, 62, 70];
const lerp = (a, b, t) => a + (b - a) * t;
const range = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// The ground she sits on, in the model frame: heli_armed's mains and tailwheel at her 7-degree sit.
const PITCH = 7 * DEG;
const groundZ = (f) => (-0.2806 - Math.sin(PITCH) * f) / Math.cos(PITCH);

// ── The hull ────────────────────────────────────────────────────────────────────
const CAB = VP76_STATIONS;
const at = (f, a, out = 0) => skin(CAB, f, a * DEG, out);
const fuselage = loft('fuselage', 40, CAB, {
  ...FINE, paint: 'hull',
  note: 'The shell. Glass, frames, doors, launch tubes and trim are separate parts laid a hair proud of it.',
  capFore: { kind: 'apex', at: VP76_APEX, paint: 'radome' },
  capAft: { kind: 'apex', at: VP76_TAIL, paint: 'hull' },
  shade: { base: 0.6, amp: 0.36 },
});
function patch(fs, as, extra, o = 0.0022) {
  const out = [];
  for (let i = 0; i < fs.length - 1; i++) for (let j = 0; j < as.length - 1; j++) {
    out.push(quad(at(fs[i + 1], as[j], o), at(fs[i], as[j], o), at(fs[i], as[j + 1], o), at(fs[i + 1], as[j + 1], o), extra));
  }
  return out;
}
const alongF = (fs, a, o = 0.004) => fs.map((f) => at(f, a, o));
const roundF = (f, as, o = 0.004) => as.map((a) => at(f, a, o));
// A flat disc of `n` sides at c, square to `ax`.
function disc(c, ax, r, n, extra) {
  const A = norm(ax), U = norm(Math.abs(A[2]) < 0.9 ? cross(A, [0, 0, 1]) : cross(A, [1, 0, 0])), V = cross(A, U);
  return { p: Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2; return add(c, add(mul(U, Math.cos(t) * r), mul(V, Math.sin(t) * r))); }), ...extra };
}
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
const D = (name, f, g, r, z0, z1, paint, extra = {}) => ({ kind: 'drum', name, f: R(f), ...(g ? { g: R(g) } : {}), r: R(r), n: extra.n || 16, z: [R(z0), R(z1)], role: 'nacelle', paint, sh: extra.sh || { base: 0.62, alt: 0.1 }, ...(extra.top ? { top: extra.top } : {}), ...(extra.bottom ? { bottom: extra.bottom } : {}), ...FINE });
const FR = (name, pts, r = 0.0048) => tube(name, pts, r, { role: 'nacelle', paint: 'frame', sh: 0.5, sides: 5, ...FINE });
const SEAM = (name, pts, r = 0.0022) => tube(name, pts, r, { role: 'nacelle', paint: 'seam', sh: 0.4, sides: 4, ...FINE });
const LED = (name, pts, r = 0.0032) => tube(name, pts, r, { role: 'nacelle', paint: 'led', sh: 1, sides: 5, ...FINE });

// ── The flight deck's glass ─────────────────────────────────────────────────────
const W = VP76_GLASS.windscreen;
const WS_F = [W.f[0], 0.575, 0.6, 0.62, 0.65, 0.69, 0.72, 0.75, W.f[1]];
const WS_A = range(W.a[0], W.a[1], 32);
const windscreen = poly('windscreen', patch(WS_F, WS_A, { role: 'glass', tint: GLASS }), FINE);
const DG = VP76_GLASS.door;
const doorGlass = poly('door window (right)', patch(range(DG.f[0], DG.f[1], 6), range(DG.a[0], DG.a[1], 8), { role: 'glass', tint: GLASS }), FINE);
const cabinGlass = VP76_GLASS.cabin.map((r, i) => poly('cabin window ' + (i + 1), patch(range(r.f[0], r.f[1], 2), range(r.a[0], r.a[1], 3), { role: 'glass', tint: GLASS }), FINE));

const frames = [
  FR('windscreen centre post', alongF(WS_F, 90, 0.0042), 0.0042),
  ...[40, 140].map((a) => FR('windscreen post', alongF(WS_F, a, 0.0042), 0.0038)),
  FR('A-pillar arch', roundF(W.f[0], range(W.a[0] - 4, W.a[1] + 4, 26))),
  FR('windscreen bow', roundF(W.f[1], range(W.a[0], W.a[1], 26)), 0.0042),
  FR('windscreen sill (right)', alongF(WS_F, W.a[0])),
  FR('windscreen sill (left)', alongF(WS_F, W.a[1])),
  ...[0, 1].flatMap((s) => {
    const A = (a) => (s ? 180 - a : a), side = s ? 'left' : 'right';
    const fs = range(DG.f[0], DG.f[1], 6);
    return [
      FR('door window frame (' + side + ')', [...roundF(DG.f[0], range(A(DG.a[0]), A(DG.a[1]), 5)), ...alongF(fs, A(DG.a[1])).slice(1), ...roundF(DG.f[1], range(A(DG.a[1]), A(DG.a[0]), 5)).slice(1), ...alongF([...fs].reverse(), A(DG.a[0])).slice(1)], 0.0036),
      ...VP76_GLASS.cabin.map((r) => FR('cabin window frame (' + side + ')', [at(r.f[0], A(r.a[0]), 0.004), at(r.f[1], A(r.a[0]), 0.004), at(r.f[1], A(r.a[1]), 0.004), at(r.f[0], A(r.a[1]), 0.004), at(r.f[0], A(r.a[0]), 0.004)], 0.0032)),
    ];
  }),
];

// ── Crew doors and the cabin's sliding doors ────────────────────────────────────
function doors(s) {
  const A = (a) => (s ? 180 - a : a), side = s ? 'left' : 'right', sg = s ? -1 : 1;
  const Dd = VP76_DOOR, Sl = VP76_SLIDER;
  const parts = [
    SEAM('crew door front seam (' + side + ')', roundF(Dd.f[1], range(A(Dd.aLo), A(Dd.aHi), 12), 0.0026)),
    SEAM('crew door rear seam (' + side + ')', roundF(Dd.f[0], range(A(Dd.aLo), A(Dd.aHi), 12), 0.0026)),
    SEAM('crew door sill seam (' + side + ')', alongF(range(Dd.f[0], Dd.f[1], 8), A(Dd.aLo), 0.0026)),
    SEAM('crew door header seam (' + side + ')', alongF(range(Dd.f[0], Dd.f[1], 8), A(Dd.aHi), 0.0026)),
    tube('crew door handle (' + side + ')', [at(0.41, A(-6), 0.006), at(0.375, A(-6), 0.006)], 0.0035, { role: 'nacelle', paint: 'metal', sh: 0.85, sides: 6, ...FINE }),
    poly('crew door handle recess (' + side + ')', patch([0.415, 0.37], [A(-10), A(-2)], { paint: 'seam' }, 0.0024), FINE),
    // Two hinges at the front edge, a jettison placard (a red stripe) beside the handle.
    ...[A(4), A(48)].map((a) => poly('crew door hinge (' + side + ')', boxAt(at(Dd.f[1] + 0.004, a, 0.004), [0.016, 0.01, 0.012], { paint: 'frame' }), FINE)),
    poly('jettison stripe (' + side + ')', patch([0.43, 0.36], [A(-16), A(-14)], { paint: 'beacon' }, 0.0024), FINE),
    // The cabin's sliding door: its seams, the upper rail it hangs from (running aft past the door,
    // where it slides), the lower track, the handle.
    SEAM('slider front seam (' + side + ')', roundF(Sl.f[1], range(A(Sl.aLo), A(Sl.aHi), 14), 0.0026)),
    SEAM('slider rear seam (' + side + ')', roundF(Sl.f[0], range(A(Sl.aLo), A(Sl.aHi), 14), 0.0026)),
    SEAM('slider bottom seam (' + side + ')', alongF(range(Sl.f[0], Sl.f[1], 10), A(Sl.aLo), 0.0026)),
    SEAM('slider top seam (' + side + ')', alongF(range(Sl.f[0], Sl.f[1], 10), A(Sl.aHi), 0.0026)),
    tube('slider rail (' + side + ')', alongF(range(Sl.f[1] - 0.01, Sl.f[0] - 0.3, 10), A(Sl.aHi + 5), 0.007), 0.004, { role: 'nacelle', paint: 'metal', sh: 0.8, sides: 5, ...FINE }),
    tube('slider rail fairing (' + side + ')', alongF(range(Sl.f[1] - 0.01, Sl.f[0] - 0.3, 10), A(Sl.aHi + 8), 0.004), 0.006, { role: 'nacelle', paint: 'hull', sh: 0.7, sides: 5, ...FINE }),
    tube('slider track (' + side + ')', alongF(range(Sl.f[1] - 0.01, Sl.f[0] - 0.3, 10), A(Sl.aLo - 4), 0.005), 0.0035, { role: 'nacelle', paint: 'metal', sh: 0.8, sides: 5, ...FINE }),
    tube('slider handle (' + side + ')', [at(0.235, A(2), 0.007), at(0.235, A(-14), 0.007)], 0.0035, { role: 'nacelle', paint: 'metal', sh: 0.85, sides: 6, ...FINE }),
  ];
  // The kick steps under the crew door: a fold-down plate on two arms.
  const sf = 0.46, sy = sg * 0.155, sz = -0.115;
  parts.push(poly('crew step (' + side + ')', [
    ...boxAt([sf, sy, sz], [0.06, 0.03, 0.006], { paint: 'carbon' }),
    ...range(sf - 0.022, sf + 0.022, 3).map((f) => quad([f - 0.003, sy - 0.012, sz + 0.0035], [f + 0.003, sy - 0.012, sz + 0.0035], [f + 0.003, sy + 0.012, sz + 0.0035], [f - 0.003, sy + 0.012, sz + 0.0035], { paint: 'rubber' })),
  ], FINE));
  for (const f of [sf - 0.022, sf + 0.022]) parts.push(tube('crew step arm (' + side + ')', [[f, sy - sg * 0.012, sz], at(f, A(-62), -0.002)], 0.003, { role: 'gear', paint: 'metal', sides: 5, ...FINE }));
  return parts;
}

// ── Paint and panel work on the hull ────────────────────────────────────────────
const NOSE_F = [W.f[1], 0.8, 0.82, 0.84, 0.86, 0.875];
const hullWork = [
  // The radome, dark, with its seam ring.
  poly('radome', patch(NOSE_F, range(0, 360, 36), { paint: 'radome' }, 0.0016), FINE),
  SEAM('radome seam', roundF(W.f[1] + 0.003, range(-180, 180, 36), 0.0028)),
  // An anti-glare panel ahead of the windscreen is the radome itself; behind the flight deck the
  // roof carries a trim band in the livery's second colour down to the wing fairing.
  poly('roof band', patch([0.555, 0.5, 0.44, 0.38, 0.32, 0.26], range(70, 110, 6), { paint: 'trim' }, 0.0018), FINE),
  // The belly, the livery's second colour, keel to chine, nose to tail cone.
  poly('belly', patch([0.79, 0.75, 0.69, 0.62, 0.555, 0.47, 0.38, 0.28, 0.15, 0.02, -0.12, -0.26, -0.4, -0.54, -0.68, -0.8, -0.9], range(-150, -30, 12), { paint: 'belly' }, 0.0014), FINE),
  // Panel seams: rings at the bulkheads, a line down each flank at the chine and one at the shoulder.
  ...[0.315, 0.26, -0.11, -0.26, -0.54, -0.8].map((f) => SEAM('frame seam', roundF(f, range(-180, 180, 40), 0.0026))),
  ...[0, 1].flatMap((s) => {
    const A = (a) => (s ? 180 - a : a);
    return [
      SEAM('chine seam', alongF([0.79, 0.69, 0.555, 0.38, 0.28, 0.15, 0.02, -0.12, -0.26, -0.4, -0.54, -0.68, -0.8, -0.9], A(-28), 0.0026)),
      SEAM('shoulder seam', alongF([0.3, 0.15, 0.02, -0.12, -0.26, -0.4, -0.54, -0.68], A(62), 0.0026)),
      // A belly access panel aft of the gun bay, and the avionics bay doors under the flight deck.
      SEAM('avionics bay seam', [...roundF(0.66, range(A(-60), A(-20), 4), 0.0026), ...alongF([0.6, 0.53, 0.46], A(-20), 0.0026), ...roundF(0.46, range(A(-20), A(-60), 4), 0.0026), ...alongF([0.53, 0.6, 0.66], A(-60), 0.0026)]),
      // Formation lights: flat strips of light along the flank, low, as NVG-friendly tape.
      LED('formation strip (' + (s ? 'left' : 'right') + ')', alongF([0.3, 0.2, 0.1], A(14), 0.004), 0.003),
      LED('formation strip aft (' + (s ? 'left' : 'right') + ')', alongF([-0.5, -0.58, -0.66], A(24), 0.004), 0.003),
      // Pitot-static probes either side of the radome, on short swept stalks.
      tube('pitot (' + (s ? 'left' : 'right') + ')', [at(0.77, A(-10), 0), add(at(0.81, A(-10), 0.02), [0, 0, -0.004]), add(at(0.85, A(-10), 0.02), [0, 0, -0.004])], 0.0025, { role: 'gear', paint: 'metal', sh: 0.85, sides: 5, ...FINE }),
      // The distributed aperture system: six dark sensor windows round the airframe, two here.
      poly('DAS window (' + (s ? 'left' : 'right') + ')', patch([0.735, 0.71], [A(-6), A(6)], { role: 'glass', tint: [18, 22, 26] }, 0.003), FINE),
      poly('DAS window aft (' + (s ? 'left' : 'right') + ')', patch([-0.6, -0.625], [A(-4), A(8)], { role: 'glass', tint: [18, 22, 26] }, 0.003), FINE),
      // Missile approach warning heads: small domes on the cheeks and the tail cone.
      { kind: 'cone', name: 'missile warning head', f: R(0.68), g: R(at(0.68, A(-36), 0.002)[1]), h: R(at(0.68, A(-36), 0.002)[2]), r: 0.009, n: 8, apex: P3(add(at(0.7, A(-36), 0.008), [0, 0, 0])), paint: 'radome', role: 'nacelle', ...FINE },
    ];
  }),
  // The DAS's chin and crown windows.
  poly('DAS window (chin)', patch([0.7, 0.675], [-96, -84], { role: 'glass', tint: [18, 22, 26] }, 0.003), FINE),
  poly('DAS window (crown)', patch([0.24, 0.215], [84, 96], { role: 'glass', tint: [18, 22, 26] }, 0.003), FINE),
  // A boarding grab handle by each crew door and the cabin's step well under the sliding doors.
  ...[1, -1].map((s) => tube('grab handle', [at(0.33, s > 0 ? 40 : 140, 0.002), at(0.33, s > 0 ? 40 : 140, 0.012), at(0.29, s > 0 ? 40 : 140, 0.012), at(0.29, s > 0 ? 40 : 140, 0.002)], 0.0022, { role: 'gear', paint: 'metal', sides: 4, ...FINE })),
];

// ── The nose: the sensor turret and the chin gun ────────────────────────────────
// The sensor turret: an EO/IR ball under the radome on a yoke, its window looking ahead.
const SENS = [0.805, 0, -0.072];
const sensor = [
  group('sensor turret', [
    pod('sensor ball', 0, 0, [[0.03, 0.006], [0.026, 0.02], [0.012, 0.03], [0, 0.032], [-0.014, 0.03], [-0.026, 0.02], [-0.03, 0.006]], { sides: 14, paint: 'radome', shade: { base: 0.6, amp: 0.3 } }),
  ], { xf: { t: P3(SENS) }, ...FINE }),
  D('sensor yoke', SENS[0], 0, 0.02, SENS[2] + 0.024, SENS[2] + 0.052, 'carbon', { n: 12 }),
  poly('sensor face', [
    quad([SENS[0] + 0.031, -0.016, SENS[2] + 0.012], [SENS[0] + 0.031, 0.016, SENS[2] + 0.012], [SENS[0] + 0.031, 0.016, SENS[2] - 0.01], [SENS[0] + 0.031, -0.016, SENS[2] - 0.01], { role: 'glass', tint: [20, 26, 30], sh: 0.95 }),
    quad([SENS[0] + 0.0315, -0.006, SENS[2] + 0.004], [SENS[0] + 0.0315, 0.006, SENS[2] + 0.004], [SENS[0] + 0.0315, 0.006, SENS[2] - 0.004], [SENS[0] + 0.0315, -0.006, SENS[2] - 0.004], { role: 'glass', tint: [90, 40, 30], sh: 1 }),
  ], FINE),
];
// The chin gun: a three-barrel 20 mm on a turret hung under the gun bay, the ammunition chute up
// into the belly. Kept on the Viper's hardpoint and with her part names.
const GUN = [0.52, 0, -0.128];
const chinGun = group('chin gun', [
  D('turret base', GUN[0], 0, 0.03, GUN[2] + 0.02, -0.088, 'carbon', { n: 14 }),
  { ...pod('turret ball', 0, 0, [[0.04, 0.008], [0.032, 0.028], [0.012, 0.038], [-0.012, 0.038], [-0.032, 0.028], [-0.04, 0.008]], { sides: 14, paint: 'gunmetal', role: 'gun', shade: { base: 0.6, amp: 0.3 } }) },
  tube('cannon barrel', [[GUN[0] + 0.02, 0, GUN[2] - 0.006], [0.76, 0, GUN[2] - 0.022]], 0.006, { role: 'gun', paint: 'gunmetal', sh: 0.62, sides: 6, ...FINE }),
  tube('muzzle (left)', [[GUN[0] + 0.02, -0.011, GUN[2] - 0.0], [0.745, -0.011, GUN[2] - 0.016]], 0.0055, { role: 'gun', paint: 'gunmetal', sh: 0.6, sides: 6, ...FINE }),
  tube('muzzle (right)', [[GUN[0] + 0.02, 0.011, GUN[2] - 0.0], [0.745, 0.011, GUN[2] - 0.016]], 0.0055, { role: 'gun', paint: 'gunmetal', sh: 0.6, sides: 6, ...FINE }),
  tube('barrel clamp', [[0.66, 0, GUN[2] - 0.014], [0.672, 0, GUN[2] - 0.015]], 0.02, { role: 'gun', paint: 'carbon', sh: 0.5, sides: 10, caps: 1, ...FINE }),
  tube('muzzle brake', [[0.745, 0, GUN[2] - 0.019], [0.77, 0, GUN[2] - 0.0225]], 0.0105, { role: 'gun', paint: 'carbon', sh: 0.5, sides: 8, caps: 1, ...FINE }),
  tube('ammunition chute', [[GUN[0] - 0.035, 0, GUN[2] + 0.01], [GUN[0] - 0.08, 0, -0.1]], 0.012, { role: 'gun', paint: 'carbon', sh: 0.5, sides: 6, ...FINE }),
], { ...FINE });
// The turret ball is authored at the origin as a pod: move it with its group.
chinGun.parts[1] = group('turret ball', [chinGun.parts[1]], { xf: { t: P3(GUN) }, ...FINE });

// ── The wing, its fairing and flaperons ─────────────────────────────────────────
const NAC = VP76_NACELLE;
const WG = [{ g: 0, le: 0.125, te: -0.15, h: NAC.hWing, t: 1.45 }, { g: NAC.g - 0.05, le: 0.118, te: -0.135, h: NAC.hWing, t: 1.25 }];
const wing = foil('wing', WG, { nx: 13, paint: 'hull', lowerSh: 0.55, lodNx: 4 });
const flaperons = ctrlOn('aileron', WG[0], WG[1], 0.24, 0.94, 0.26);
const FAIR = [[0.24, 0.02, 0.006], [0.2, 0.06, 0.02], [0.12, 0.09, 0.04], [0.02, 0.1, 0.048], [-0.1, 0.098, 0.046], [-0.2, 0.08, 0.034], [-0.3, 0.05, 0.02], [-0.36, 0.015, 0.006]]
  .map(([f, rg, rvT]) => ({ f, rg, rvT, rvB: 0.02, cz: 0.238 + (f > 0 ? 0 : f * 0.04), boxy: 0.3 }));
const wingFairing = [
  loft('wing fairing', 24, FAIR, { ...FINE, paint: 'hull', capFore: { kind: 'apex', at: [0.25, 0, 0.238] }, capAft: { kind: 'apex', at: [-0.37, 0, 0.226] } }),
  // The cross-shaft cover down the middle of the wing, the walkway either side of it, the light along
  // the leading edge, and a GNSS dome.
  // The walkway: a non-slip strip each side of the cross-shaft cover, edged in a painted line.
  ...[1, -1].flatMap((s) => [0.07, -0.03].map((f) => tube('walkway edge', [[f, s * 0.12, NAC.hWing + 0.032], [f, s * (NAC.g - 0.1), NAC.hWing + 0.03]], 0.0018, { role: 'nacelle', paint: 'walk', sides: 3, ...FINE }))),
  ...[1, -1].map((s) => LED('wing leading edge light', range(0.16, NAC.g - 0.09, 6).map((g) => [WG[0].le + 0.002, s * g, NAC.hWing + 0.004]), 0.0024)),
  ...[1, -1].map((s) => SEAM('wing spar seam', range(0.12, NAC.g - 0.08, 6).map((g) => [-0.07, s * g, NAC.hWing + 0.031]))),
  D('GNSS dome', -0.18, 0, 0.012, 0.268, 0.278, 'radome', { n: 10, top: { sh: 0.9 } }),
];

// ── The nacelles and the proprotors ─────────────────────────────────────────────
// A fixed engine nacelle on each tip, with its intake forward and its exhaust aft; standing on it the
// proprotor pylon, the gearbox that tilts on a real tiltrotor and here stays vertical, and the hub
// with three blade cuffs.
function nacelle() {
  const g = NAC.g, h = NAC.hWing, f = NAC.f, hr = NAC.hRotor;
  const parts = [
    pod('engine nacelle', g, h, [[0.175, 0.05], [0.165, 0.058], [0.14, 0.066], [0.09, 0.07], [0.0, 0.072], [-0.1, 0.07], [-0.18, 0.062], [-0.24, 0.05], [-0.27, 0.042]], { sides: 18, paint: 'hull', shade: { base: 0.6, amp: 0.34 }, capAft: { kind: 'flat', sh: 0.4 } }),
    { kind: 'cone', name: 'intake', f: 0.172, g, h, r: 0.048, n: 18, apex: [0.13, g, h], paint: 'intake', role: 'nacelle', ...FINE },
    tube('intake lip', [[0.177, g, h], [0.168, g, h]], 0.05, { role: 'nacelle', paint: 'metal', sh: 0.8, sides: 18, ...FINE }),
    tube('exhaust', [[-0.26, g, h + 0.01], [-0.3, g + 0.012, h + 0.03]], 0.03, { role: 'nacelle', paint: 'exhaust', sh: 0.4, sides: 10, caps: 1, ...FINE }),
    tube('exhaust shroud', [[-0.24, g, h + 0.012], [-0.27, g + 0.006, h + 0.024]], 0.036, { role: 'nacelle', paint: 'carbon', sh: 0.5, sides: 10, ...FINE }),
    // A trim band at the nacelle's nose and a seam at each cowl joint.
    poly('nacelle band', Array.from({ length: 18 }, (_, k) => {
      const a0 = k / 18 * Math.PI * 2, a1 = (k + 1) / 18 * Math.PI * 2, r0 = 0.0675, r1 = 0.0715;
      const P = (ff, r, a) => [ff, g + Math.cos(a) * r, h + Math.sin(a) * r];
      return quad(P(0.11, r0 + 0.0012, a0), P(0.11, r0 + 0.0012, a1), P(0.07, r1 + 0.0012, a1), P(0.07, r1 + 0.0012, a0), { paint: 'trim', sh: 0.75 });
    }), FINE),
    ...[-0.05, -0.15].map((ff) => tube('cowl seam', Array.from({ length: 19 }, (_, k) => { const a = k / 18 * Math.PI * 2, r = ff > -0.1 ? 0.0728 : 0.0712; return [ff, g + Math.cos(a) * r, h + Math.sin(a) * r]; }), 0.0016, { role: 'nacelle', paint: 'seam', sides: 3, ...FINE })),
    // Louvres down the outboard side over the oil cooler.
    poly('cooler louvres', range(-0.02, -0.14, 6).flatMap((ff) => [
      quad([ff + 0.008, g + 0.0715, h + 0.022], [ff - 0.008, g + 0.0715, h + 0.022], [ff - 0.008, g + 0.077, h + 0.002], [ff + 0.008, g + 0.077, h + 0.002], { paint: 'metal', sh: 0.72 }),
      quad([ff + 0.008, g + 0.071, h + 0.002], [ff - 0.008, g + 0.071, h + 0.002], [ff - 0.008, g + 0.071, h + 0.022], [ff + 0.008, g + 0.071, h + 0.022], { paint: 'seam', sh: 0.3 }),
    ]), FINE),
    // The nav light fairing on the outboard flank, and the formation strip along it.
    poly('nav light fairing', boxAt([0.0, g + 0.072, h], [0.03, 0.008, 0.016], { paint: 'carbon' }), FINE),
    LED('nacelle formation strip', [[0.08, g + 0.072, h - 0.02], [-0.12, g + 0.07, h - 0.02]], 0.0026),
    // The pylon: a gearbox drum stack rising out of the nacelle's top, a tilt-axis fairing, the
    // swashplate and the hub.
    D('pylon base', f, g, 0.072, h + 0.03, h + 0.07, 'hull', { n: 18, sh: { base: 0.64, alt: 0.08 } }),
    D('pylon', f, g, 0.064, h + 0.07, h + 0.115, 'hull', { n: 18, sh: { base: 0.66, alt: 0.08 } }),
    D('pylon cooling ring', f, g, 0.067, h + 0.093, h + 0.098, 'seam', { n: 18 }),
    D('gearbox', f, g, 0.056, h + 0.115, h + 0.15, 'metal', { n: 18, sh: { base: 0.6, alt: 0.12 } }),
    D('swashplate', f, g, 0.06, hr - 0.042, hr - 0.034, 'metal', { n: 18, sh: { base: 0.7, alt: 0.14 }, top: { sh: 0.8 } }),
    D('mast', f, g, 0.03, hr - 0.034, hr - 0.006, 'metal', { n: 12 }),
    D('hub', f, g, 0.046, hr - 0.006, hr + 0.01, 'carbon', { n: 18, top: { sh: 0.75 }, bottom: { sh: 0.35 } }),
    D('spinner', f, g, 0.04, hr + 0.01, hr + 0.022, 'hull', { n: 18, top: { sh: 0.85 } }),
    D('spinner crown', f, g, 0.03, hr + 0.022, hr + 0.031, 'hull', { n: 16, top: { sh: 0.92 } }),
    D('spinner tip', f, g, 0.016, hr + 0.031, hr + 0.037, 'trim', { n: 12, top: { sh: 1 } }),
    // The tilt-axis spindle: a short cylinder across the nacelle where a real pylon pivots.
    tube('conversion spindle', [[f, g - 0.078, h + 0.035], [f, g + 0.078, h + 0.035]], 0.016, { role: 'nacelle', paint: 'carbon', sh: 0.55, sides: 10, caps: 1, ...FINE }),
    // The conversion actuator, folded flat against the pylon's back in helicopter mode.
    tube('conversion actuator', [[f - 0.05, g, h + 0.045], [f - 0.065, g, h + 0.11]], 0.008, { role: 'nacelle', paint: 'metal', sh: 0.8, sides: 6, ...FINE }),
    // The wing fence where the wing meets the nacelle.
    { kind: 'panel', name: 'tip fence', role: 'fin', sh: 0.8, th: 0.004, paint: 'hull', c: P3s([[0.13, g - 0.074, h - 0.01], [0.13, g - 0.074, h + 0.035], [-0.14, g - 0.074, h + 0.035], [-0.14, g - 0.074, h - 0.01]]), ...FINE },
  ];
  // Three blade cuffs: the root of each blade the rotor draws, at the rotor's own phase.
  for (let k = 0; k < 3; k++) {
    const a = 0.3 + k * Math.PI * 2 / 3, c = Math.cos(a), s = Math.sin(a);
    parts.push(tube('blade cuff', [[f + c * 0.04, g + s * 0.04, hr], [f + c * 0.11, g + s * 0.11, hr - 0.002]], 0.009, { role: 'nacelle', paint: 'carbon', sh: 0.6, sides: 6, ...FINE }));
    parts.push(tube('pitch link', [[f + c * 0.045, g + s * 0.045, hr - 0.036], [f + c * 0.05, g + s * 0.05, hr - 0.006]], 0.003, { role: 'nacelle', paint: 'metal', sides: 4, ...FINE }));
  }
  parts.push({ kind: 'ngon', name: 'proprotor disc', f, g, h: hr, n: 14, r: NAC.rRotor, role: 'rotor', sh: 0.65, note: 'Schematic only: painted renderers draw the blades from `rotors`.' });
  return parts;
}
function P3s(a) { return a.map(P3); }
const nacelles = mirror('nacelles', nacelle());

// ── The V-tail ──────────────────────────────────────────────────────────────────
const VT = { rootLE: [-0.77, 0.03, 0.156], tipLE: [-0.93, 0.27, 0.41], tipTE: [-1.03, 0.27, 0.41], rootTE: [-1.0, 0.024, 0.152] };
const vl = (A, B, t) => [lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)];
const vtail = mirror('V-tail', [
  { kind: 'panel', name: 'ruddervator fin', role: 'fin', sh: 0.86, th: 0.01, paint: 'hull', c: P3s([VT.rootLE, VT.tipLE, vl(VT.tipLE, VT.tipTE, 0.62), vl(VT.rootLE, VT.rootTE, 0.66)]), ...FINE },
  { kind: 'panel', name: 'ruddervator', role: 'rudder', sh: 0.8, th: 0.006, paint: 'trim', c: P3s([vl(VT.rootLE, VT.rootTE, 0.68), vl(VT.tipLE, VT.tipTE, 0.64), VT.tipTE, VT.rootTE]), ...FINE },
  tube('ruddervator hinge', [vl(VT.rootLE, VT.rootTE, 0.67), vl(VT.tipLE, VT.tipTE, 0.63)], 0.003, { role: 'nacelle', paint: 'seam', sides: 4, ...FINE }),
  tube('tail tip cap', [VT.tipLE, add(VT.tipTE, [0.005, 0, 0])], 0.006, { role: 'nacelle', paint: 'trim', sides: 6, caps: 1, ...FINE }),
  D('tail tip strobe', VT.tipTE[0] - 0.006, VT.tipTE[1], 0.006, VT.tipTE[2] - 0.004, VT.tipTE[2] + 0.008, 'strobe', { n: 8, top: { sh: 1 } }),
  LED('tail tip light', [vl(VT.tipLE, VT.tipTE, 0.15), vl(VT.tipLE, VT.tipTE, 0.55)].map((p) => add(p, [0, 0.002, 0.007])), 0.0025),
  // The root fillet: a short tube smoothing the fin into the tail cone.
  tube('tail root fillet', [vl(VT.rootLE, VT.rootTE, 0.05), vl(VT.rootLE, VT.rootTE, 0.95)], 0.012, { role: 'nacelle', paint: 'hull', sides: 8, ...FINE }),
]);
// The tail cone's strobe, and the IR jammer turrets on the aft fuselage's shoulders.
const tail = [
  tube('tail strobe', [add(VP76_TAIL, [0.01, 0, 0]), add(VP76_TAIL, [-0.012, 0, 0])], 0.006, { role: 'nacelle', paint: 'strobe', sh: 1, sides: 6, caps: 1, ...FINE }),
  mirror('IR jammers', [
    D('IR jammer base', -0.5, 0.05, 0.02, 0.17, 0.19, 'carbon', { n: 12 }),
    D('IR jammer head', -0.5, 0.05, 0.016, 0.19, 0.208, 'radome', { n: 12, top: { sh: 0.9 } }),
  ]),
  { kind: 'blade', name: 'datalink blade', role: 'fin', paint: 'carbon', t: 0.003, sh: [0.75, 0.6], outline: [[-0.58, 0.19], [-0.62, 0.235], [-0.645, 0.235], [-0.66, 0.18]], ...FINE },
  { kind: 'blade', name: 'belly antenna', role: 'fin', paint: 'carbon', t: 0.003, sh: [0.7, 0.55], outline: [[-0.3, -0.06], [-0.32, -0.1], [-0.345, -0.1], [-0.35, -0.058]], ...FINE },
  { kind: 'blade', name: 'UHF blade', role: 'fin', paint: 'carbon', t: 0.003, sh: [0.7, 0.55], outline: [[0.3, 0.215], [0.29, 0.25], [0.27, 0.25], [0.255, 0.218]], ...FINE },
];

// ── The stub wings: the Viper's rocket pods and missiles, kept on their hardpoints ──
const SW = [{ g: 0.1, le: 0.15, te: -0.1, h: -0.04, t: 1.7 }, { g: 0.42, le: 0.125, te: -0.075, h: -0.05, t: 1.3 }];
const stubWing = foil('stub wing', SW, { nx: 9, paint: 'hull', lowerSh: 0.5, lodNx: 3 });
const POD = { g: 0.29, h: -0.098 };
function rocketPod() {
  const parts = [
    pod('rocket pod', POD.g, POD.h, [[0.14, 0.02], [0.13, 0.036], [0.11, 0.042], [-0.14, 0.042], [-0.16, 0.034], [-0.17, 0.02]], { sides: 12, paint: 'hull', shade: { base: 0.6, amp: 0.3 }, capAft: { kind: 'flat', sh: 0.4 } }),
    poly('rocket pod band', Array.from({ length: 12 }, (_, k) => {
      const a0 = k / 12 * Math.PI * 2, a1 = (k + 1) / 12 * Math.PI * 2, r = 0.0435;
      const P = (ff, a) => [ff, POD.g + Math.cos(a) * r, POD.h + Math.sin(a) * r];
      return quad(P(0.1, a0), P(0.1, a1), P(0.06, a1), P(0.06, a0), { paint: 'trim', sh: 0.75 });
    }), FINE),
    poly('rocket pod pylon', boxAt([0.0, POD.g, (POD.h + 0.042 + SW[0].h - 0.008) / 2], [0.16, 0.012, SW[0].h - 0.008 - POD.h - 0.042 + 0.006], { paint: 'carbon' }), FINE),
  ];
  // Seven tube mouths on the pod's face in a hexagon round a centre one.
  const mouths = [[0, 0], ...Array.from({ length: 6 }, (_, k) => [Math.cos(k * Math.PI / 3) * 0.022, Math.sin(k * Math.PI / 3) * 0.022])];
  parts.push(group('pod tube mouths', mouths.map(([dg, dh]) => tube('tube mouth', [[0.142, POD.g + dg, POD.h + dh], [0.122, POD.g + dg, POD.h + dh]], 0.0085, { role: 'gun', paint: 'intake', sh: 0.35, sides: 6, ...FINE })), FINE));
  return parts;
}
const stubs = mirror('stub wings', [
  ...rocketPod(),
  poly('missile launcher', boxAt([0.01, 0.405, -0.083], [0.2, 0.014, 0.05], { paint: 'carbon' }), FINE),
  { kind: 'missile', name: 'tip missile', f: [-0.13, 0.13], g: 0.405, z: -0.067, ...FINE },
  { kind: 'missile', name: 'tip missile', f: [-0.13, 0.13], g: 0.405, z: -0.103, ...FINE },
  tube('stub tip light', [[0.11, 0.422, -0.05], [0.07, 0.424, -0.05]], 0.003, { role: 'nacelle', paint: 'led', sh: 1, sides: 5, ...FINE }),
]);

// ── The Air-Launched Effects ────────────────────────────────────────────────────
// Four tubes each side in a doubler plate on the aft fuselage's shoulder, canted up and out, each with
// a hinged cap that swings open on the `drones` channel; a drone in each that slides out to its
// station in the box round the aircraft while the channel is up, and is not drawn while it is down.
const ALE = VP76_ALE;
function outward(f, a) {
  const d = 1e-3;
  const n = norm(cross(sub(at(f + d, a), at(f - d, a)), sub(at(f, a + 0.5), at(f, a - 0.5))));
  const c = [f, 0, at(f, 90)[2] - 0.1];
  return (n[1] * (at(f, a)[1] - c[1]) + n[2] * (at(f, a)[2] - c[2])) < 0 ? mul(n, -1) : n;
}
function launcher() {
  const parts = [];
  const fs = ALE.tubes.map((t) => t[0]), a0 = ALE.tubes[0][1];
  parts.push(poly('ALE doubler plate', patch([fs[0] + 0.035, ...fs.map((f) => f - 0.0325)], [a0 - 13, a0 + 13], { paint: 'trim' }, 0.003), FINE));
  parts.push(SEAM('ALE plate seam', [at(fs[0] + 0.035, a0 - 13, 0.0035), at(fs[3] - 0.0325, a0 - 13, 0.0035), at(fs[3] - 0.0325, a0 + 13, 0.0035), at(fs[0] + 0.035, a0 + 13, 0.0035), at(fs[0] + 0.035, a0 - 13, 0.0035)]));
  ALE.tubes.forEach(([f, a], i) => {
    const n = outward(f, a), M = aleMouth(i), base = at(f, a, -0.03);
    parts.push(tube('ALE tube ' + (i + 1), [base, M], 0.0135, { role: 'nacelle', paint: 'carbon', sh: 0.55, sides: 10, ...FINE }));
    parts.push(tube('ALE tube collar', [sub(M, mul(n, 0.004)), add(M, mul(n, 0.001))], 0.0165, { role: 'nacelle', paint: 'metal', sh: 0.75, sides: 10, ...FINE }));
    parts.push(poly('ALE tube bore', [disc(add(M, mul(n, 0.0012)), n, 0.0125, 10, { paint: 'intake', sh: 0.25 })], FINE));
    // The cap: a lid over the mouth, hinged on its aft edge, swinging open aft over the first fifth
    // of the channel. Its ready light shows green while it is shut.
    const hinge = add(M, [-0.016, 0, 0]), ax = norm(cross(n, [1, 0, 0]));
    parts.push(poly('ALE tube cap ' + (i + 1), [
      disc(add(M, mul(n, 0.0024)), n, 0.016, 10, { paint: 'hull', sh: 0.8 }),
      disc(add(M, mul(n, 0.0032)), n, 0.004, 6, { paint: 'led', sh: 1 }),
    ], { ...FINE, anim: { ch: 'drones', pivot: P3(add(hinge, mul(n, 0.003))), axis: P3(ax), ang: [0, -115], span: [0, 0.2] } }));
  });
  return parts;
}
// One drone, after the Altius-600: a slim body with a seeker in its nose, a pair of wings that
// unfold over it, a V-tail, and a pusher prop the rotor list draws.
const DR = { len: 0.048, r: 0.0072, span: 0.05 };
function droneBody(name) {
  return [
    pod(name + ' body', 0, 0, [[DR.len, 0.001], [DR.len - 0.006, 0.0055], [DR.len - 0.016, DR.r], [-DR.len + 0.01, DR.r], [-DR.len + 0.003, 0.005], [-DR.len, 0.003]], { sides: 8, paint: 'drone', shade: { base: 0.62, amp: 0.3 }, regions: [{ at: [DR.len], k: 'all', role: 'glass', tint: [30, 40, 46] }] }),
    { kind: 'panel', name: name + ' wing', role: 'wing', sh: 0.85, th: 0.0016, paint: 'drone', c: P3s([[0.012, 0, DR.r * 0.8], [0.0, DR.span, DR.r * 0.8 + 0.002], [-0.012, DR.span, DR.r * 0.8 + 0.002], [-0.016, 0, DR.r * 0.8]]), ...FINE },
    { kind: 'panel', name: name + ' wing', role: 'wing', sh: 0.85, th: 0.0016, paint: 'drone', c: P3s([[0.012, 0, DR.r * 0.8], [0.0, -DR.span, DR.r * 0.8 + 0.002], [-0.012, -DR.span, DR.r * 0.8 + 0.002], [-0.016, 0, DR.r * 0.8]]), ...FINE },
    ...[1, -1].map((s) => ({ kind: 'panel', name: name + ' tail', role: 'fin', sh: 0.8, th: 0.0012, paint: 'trim', c: P3s([[-DR.len + 0.016, s * 0.003, 0.004], [-DR.len + 0.006, s * 0.016, 0.014], [-DR.len, s * 0.016, 0.014], [-DR.len + 0.003, s * 0.003, 0.004]]), ...FINE })),
    tube(name + ' prop hub', [[-DR.len, 0, 0], [-DR.len - 0.006, 0, 0]], 0.003, { role: 'nacelle', paint: 'carbon', sides: 6, caps: 1, ...FINE }),
    tube(name + ' nav light', [[-0.006, DR.span - 0.002, DR.r * 0.8 + 0.003], [-0.0, DR.span - 0.002, DR.r * 0.8 + 0.003]], 0.0018, { role: 'nacelle', paint: 'led', sh: 1, sides: 4, ...FINE }),
  ];
}
const drones = mirror('Air-Launched Effects', [
  ...launcher(),
  ...ALE.tubes.map((t, i) => {
    const M = aleMouth(i), Pst = ALE.posts[i];
    return group('ALE drone ' + (i + 1), droneBody('drone'), { xf: { t: P3(M) }, when: 'drones', anim: { ch: 'drones', slide: P3(sub(Pst, M)), def: 0 }, ...FINE });
  }),
]);
const droneRotors = [1, -1].flatMap((side) => ALE.tubes.map((t, i) => {
  const M = aleMouth(i), d = sub(ALE.posts[i], M);
  return { at: P3([M[0] - DR.len - 0.007, side * M[1], M[2]]), plane: 'fore', r: 0.016, blades: 2, lead: 0.9, spinMul: 5.5, phase: R(i * 0.9 + (side > 0 ? 0 : 0.4)), run: 'drones', slide: { ch: 'drones', by: P3([d[0], side * d[1], d[2]]) } };
}));

// ── The gear: the Viper's trailing-arm mains and a tailwheel on a ventral strake ──
// Each wheel's bottom is on the armed heli's ground plane (groundZ), so she sits as the Viper sat.
const MW = { f: 0.06, g: 0.225, r: 0.058 };
const mwz = groundZ(MW.f) + MW.r;
const TW = { f: -0.72, r: 0.03 };
const twz = groundZ(TW.f) + TW.r;
const gear = [
  mirror('main gear', [
    group('gear sponson', [pod('sponson', 0, 0, [[0.14, 0.006], [0.11, 0.026], [0.05, 0.034], [-0.03, 0.034], [-0.1, 0.024], [-0.13, 0.006]], { sides: 10, paint: 'hull', shade: { base: 0.58, amp: 0.3 } })], { xf: { t: [0.03, 0.17, -0.07] }, ...FINE }),
    { kind: 'strut', name: 'trailing leg', at: [R(MW.f + 0.03), 0.19], top: -0.06, bot: R(mwz + 0.02), r: 0.014, ...FINE },
    tube('trailing arm', [[MW.f + 0.03, 0.19, mwz + 0.02], [MW.f, MW.g - 0.035, mwz]], 0.01, { role: 'gear', paint: 'metal', sh: 0.75, sides: 6, ...FINE }),
    tube('drag brace', [[-0.05, 0.175, -0.075], [MW.f + 0.02, 0.19, mwz + 0.03]], 0.007, { role: 'gear', paint: 'metal', sh: 0.75, sides: 6, ...FINE }),
    tube('axle', [[MW.f, MW.g - 0.04, mwz], [MW.f, MW.g, mwz]], 0.009, { role: 'gear', paint: 'metal', sides: 6, ...FINE }),
    { kind: 'wheel', name: 'main wheel', at: P3([MW.f, MW.g, mwz]), r: MW.r, hw: 0.03, n: 14, ...FINE },
    tube('brake line', [[MW.f + 0.03, 0.195, -0.07], [MW.f + 0.032, 0.196, mwz + 0.03]], 0.0018, { role: 'gear', paint: 'carbon', sides: 3, ...FINE }),
  ]),
  { kind: 'blade', name: 'ventral strake', role: 'fin', paint: 'hull', t: 0.006, sh: [0.8, 0.62], outline: [[-0.6, 0.05], [-0.665, -0.07], [-0.77, -0.07], [-0.84, 0.07]], ...FINE },
  { kind: 'strut', name: 'tailwheel leg', at: [R(TW.f + 0.01), 0], top: -0.065, bot: R(twz + 0.012), r: 0.008, ...FINE },
  tube('tailwheel fork', [[TW.f + 0.01, 0, twz + 0.014], [TW.f, -0.016, twz], [TW.f, 0.016, twz]], 0.004, { role: 'gear', paint: 'metal', sides: 5, ...FINE }),
  { kind: 'wheel', name: 'tailwheel', at: P3([TW.f, 0, twz]), r: TW.r, hw: 0.014, n: 10, ...FINE },
];

// ── The room behind the glass ───────────────────────────────────────────────────
// Two seats side by side, the pilot on the right, a wraparound dash, a centre console, two sticks.
// Seen through the glass from outside; the seated cockpit is interior-viper-2076.js.
const IN = VP76_INSIDE;
const interior = [];
for (const g of [IN.seatG, -IN.seatG]) {
  interior.push(poly('seat cushion', slab([0.45, g, IN.floorH + 0.04], [0.06, 0.06, 0.014], 4, { paint: 'seat' }), FINE));
  interior.push(poly('seat back', slab([0.415, g, IN.floorH + 0.085], [0.014, 0.062, 0.09], -14, { paint: 'seat' }), FINE));
  interior.push(poly('headrest', slab([0.405, g, IN.floorH + 0.142], [0.012, 0.04, 0.026], -14, { paint: 'seat' }), FINE));
  interior.push(tube('cyclic', [[0.49, g, IN.floorH + 0.002], [0.5, g, IN.floorH + 0.05]], 0.0035, { role: 'nacelle', paint: 'interior', sides: 5, ...FINE }));
}
interior.push(poly('deck', [quad([0.62, -0.12, IN.floorH], [0.62, 0.12, IN.floorH], [0.33, 0.12, IN.floorH], [0.33, -0.12, IN.floorH], { paint: 'interior', sh: 0.45 })], FINE));
interior.push(poly('centre console', slab([0.47, 0, IN.floorH + 0.03], [0.14, 0.04, 0.05], 0, { paint: 'interior' }), FINE));
interior.push(poly('dash', slab([0.555, 0, IN.floorH + 0.07], [0.05, 0.24, 0.025], 30, { paint: 'interior' }), FINE));
interior.push(poly('dash glass', slab([0.548, 0, IN.floorH + 0.085], [0.004, 0.22, 0.03], 58, { paint: 'screen' }), FINE));
interior.push(poly('bulkhead', [quad([IN.bulkheadF, -0.13, IN.floorH], [IN.bulkheadF, 0.13, IN.floorH], [IN.bulkheadF, 0.13, 0.2], [IN.bulkheadF, -0.13, 0.2], { paint: 'interior', sh: 0.5 })], FINE));

// ── The coarse body, for range ──────────────────────────────────────────────────
const coarse = [
  { kind: 'loft', name: 'fuselage (far)', role: 'body', section: 'ellipse', sides: 12, paint: 'hull', ...COARSE,
    stations: [[0.86, 0.03, 0.03, -0.02], [0.75, 0.1, 0.095, -0.004], [0.555, 0.144, 0.15, 0.0], [0.28, 0.152, 0.163, 0.0], [0.02, 0.151, 0.167, 0.005], [-0.26, 0.137, 0.152, 0.02], [-0.54, 0.093, 0.1, 0.05], [-0.8, 0.052, 0.054, 0.084], [-1.0, 0.012, 0.012, 0.112]].map(([f, rg, rv, cz]) => ({ f, rg, rv, cz })),
    capFore: { kind: 'apex', at: [0.88, 0, -0.02] }, capAft: { kind: 'apex', at: [-1.025, 0, 0.115] },
    regions: [{ at: [0.75], k: [0, 1, 2, 3, 4, 5, 6], role: 'glass', tint: GLASS }] },
  { kind: 'panel', name: 'wing (far)', role: 'wing', sh: 0.9, th: 0.03, paint: 'hull', c: P3s([[0.12, -NAC.g, NAC.hWing + 0.012], [0.12, NAC.g, NAC.hWing + 0.012], [-0.14, NAC.g, NAC.hWing + 0.012], [-0.14, -NAC.g, NAC.hWing + 0.012]]), ...COARSE },
  mirror('nacelles (far)', [
    tube('nacelle (far)', [[0.17, NAC.g, NAC.hWing], [-0.27, NAC.g, NAC.hWing]], 0.068, { role: 'nacelle', paint: 'hull', sides: 8, caps: 1, ...COARSE }),
    { kind: 'drum', name: 'pylon (far)', f: NAC.f, g: NAC.g, r: 0.06, n: 8, z: [NAC.hWing + 0.03, NAC.hRotor + 0.03], role: 'nacelle', paint: 'hull', sh: { base: 0.62, alt: 0.1 }, top: { sh: 0.9 }, ...COARSE },
    { kind: 'panel', name: 'V-tail (far)', role: 'fin', sh: 0.85, th: 0.012, paint: 'hull', c: P3s([VT.rootLE, VT.tipLE, VT.tipTE, VT.rootTE]), ...COARSE },
    { kind: 'panel', name: 'stub wing (far)', role: 'wing', sh: 0.85, th: 0.02, paint: 'hull', c: P3s([[0.15, 0.1, -0.04], [0.125, 0.42, -0.05], [-0.075, 0.42, -0.05], [-0.1, 0.1, -0.04]]), ...COARSE },
    tube('rocket pod (far)', [[0.14, POD.g, POD.h], [-0.17, POD.g, POD.h]], 0.042, { role: 'nacelle', paint: 'hull', sides: 6, caps: 1, ...COARSE }),
    tube('gear (far)', [[MW.f, 0.19, -0.06], [MW.f, MW.g, mwz]], 0.012, { role: 'gear', paint: 'metal', sides: 5, ...COARSE }),
    { kind: 'wheel', name: 'main wheel (far)', at: P3([MW.f, MW.g, mwz]), r: MW.r, hw: 0.03, n: 8, ...COARSE },
  ]),
  { kind: 'wheel', name: 'tailwheel (far)', at: P3([TW.f, 0, twz]), r: TW.r, hw: 0.014, n: 6, ...COARSE },
  tube('tailwheel leg (far)', [[TW.f, 0, 0.04], [TW.f, 0, twz]], 0.008, { role: 'gear', paint: 'metal', sides: 4, ...COARSE }),
];

// ── Rotors and lamps ────────────────────────────────────────────────────────────
// Two proprotors, three blades each, turning opposite ways as a tiltrotor's do; then the drones' props.
const rotors = [
  { at: [NAC.f, NAC.g, NAC.hRotor], plane: 'h', r: NAC.rRotor, blades: 3, lead: 0.85, phase: 0.3 },
  { at: [NAC.f, -NAC.g, NAC.hRotor], plane: 'h', r: NAC.rRotor, blades: 3, lead: 0.85, dir: -1, phase: 0.3 },
  ...droneRotors,
];
const lamps = [
  { at: [0.0, -(NAC.g + 0.077), NAC.hWing], n: [0, -1, 0], rgb: '255,55,55', kind: 'steady' },
  { at: [0.0, NAC.g + 0.077, NAC.hWing], n: [0, 1, 0], rgb: '60,255,95', kind: 'steady' },
  { at: [VP76_TAIL[0] - 0.014, 0, VP76_TAIL[2]], n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  { at: [VT.tipTE[0] - 0.006, VT.tipTE[1], VT.tipTE[2] + 0.01], n: [0, 0.6, 0.8], rgb: '255,255,255', kind: 'strobe' },
  { at: [VT.tipTE[0] - 0.006, -VT.tipTE[1], VT.tipTE[2] + 0.01], n: [0, -0.6, 0.8], rgb: '255,255,255', kind: 'strobe' },
  { at: [-0.06, 0, 0.29], n: [0, 0, 1], rgb: '255,90,70', kind: 'beacon' },
  { at: [-0.05, 0, -0.092], n: [0, 0, -1], rgb: '255,90,70', kind: 'beacon' },
];
// The beacons' housings, where the lamps are mounted.
const beacons = [
  D('beacon base', -0.06, 0, 0.012, 0.28, 0.285, 'carbon', { n: 10 }),
  D('beacon', -0.06, 0, 0.009, 0.285, 0.296, 'beacon', { n: 10, top: { sh: 1 } }),
  D('belly beacon', -0.05, 0, 0.009, -0.098, -0.086, 'beacon', { n: 10, bottom: { sh: 0.8 } }),
];

const doc = {
  id: 'heli_armed_2076',
  kind: 'mesh',
  params: {
    name: 'Viper 2076',
    note: 'CONCEPT, generated by scripts/shapes/concepts/viper-2076.mjs (edit that, not this). The Viper fifty years on, after the Bell MV-75 (V-280 Valor) and its Air-Launched Effects: a tiltrotor drone carrier. A slim hull with a wrapped flight-deck windscreen, crew doors and sliding cabin doors; a straight high wing with an engine nacelle fixed at each tip and a three-blade proprotor on a pylon standing on it (helicopter mode; the sim has no tilt); a V-tail; stub wings carrying the old Viper\'s rocket pods and missiles; the chin gun kept; and four launch tubes each side of the aft fuselage whose eight drones fly out to hold a box round her on the `drones` channel while the master arm is on. The armed heli\'s 2076 edition (mesh_heli_armed.json `variants`), on its frame: scale 2, the 7-degree sit, the same wheel contacts.',
    scale: 2,
    groundPitch: 7,
    navLamps: null,
    lamps,
    rotors,
    finish: 'satin',
    paints: {
      hull: { rgb: [86, 94, 92], livery: 'base', mat: 'satin' },
      trim: { rgb: [190, 162, 108], livery: 'trim' },
      belly: { rgb: [190, 162, 108], livery: 'trim' },
      radome: { rgb: [52, 58, 58], livery: 'fixed', mat: 'matte' },
      frame: { rgb: [26, 30, 30], livery: 'fixed', mat: 'gloss' },
      seam: { rgb: [44, 50, 50], livery: 'fixed', mat: 'matte' },
      carbon: { rgb: [36, 40, 42], livery: 'fixed', mat: 'satin' },
      metal: { rgb: [140, 144, 150], livery: 'fixed', mat: 'bare' },
      gunmetal: { rgb: [66, 70, 74], livery: 'fixed', mat: 'satin' },
      rubber: { rgb: [28, 28, 28], livery: 'fixed', mat: 'rubber' },
      walk: { rgb: [64, 70, 70], livery: 'fixed', mat: 'matte' },
      intake: { rgb: [20, 22, 24], livery: 'fixed', mat: 'matte' },
      exhaust: { rgb: [70, 60, 52], livery: 'fixed', mat: 'bare' },
      led: { rgb: [150, 240, 170], livery: 'fixed', mat: 'matte' },
      beacon: { rgb: [235, 70, 56], livery: 'fixed', mat: 'gloss' },
      strobe: { rgb: [240, 244, 248], livery: 'fixed', mat: 'gloss' },
      drone: { rgb: [196, 200, 194], livery: 'fixed', mat: 'satin' },
      interior: { rgb: [36, 40, 42], livery: 'fixed', mat: 'matte' },
      seat: { rgb: [62, 68, 60], livery: 'fixed', mat: 'satin' },
      screen: { rgb: [70, 200, 170], livery: 'fixed', mat: 'gloss' },
    },
    parts: [
      fuselage, windscreen, mirror('door glass', [doorGlass, ...cabinGlass]), ...frames,
      ...doors(0), ...doors(1), ...hullWork, ...sensor, chinGun, ...interior,
      wing, flaperons, ...wingFairing, nacelles, vtail, ...tail, stubWing, stubs, drones, ...gear, ...beacons,
      ...coarse,
    ],
  },
};
// Everything but the coarse body is the near LOD: a part that says neither is fine.
for (const p of doc.params.parts) if (p.minDetail == null && p.maxDetail == null) p.minDetail = 1;

const v = validateMesh(doc.params, doc.id);
if (v.errors.length) { console.log('ERRORS', v.errors.slice(0, 12)); process.exit(1); }
if (v.warnings?.length) console.log('warnings', v.warnings.slice(0, 8));
const n1 = compileMesh(doc.params, { detail: 1 }).faces.length, n0 = compileMesh(doc.params, { detail: 0 }).faces.length;
writeFileSync(new URL('../../../content/vehicle_models/mesh_heli_armed_2076.json', import.meta.url), formatMesh(doc));
console.log('mesh_heli_armed_2076.json:', n1, 'faces near,', n0, 'far');
