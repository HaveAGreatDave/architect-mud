// The Drake 2076 concept: writes content/vehicle_models/mesh_drake_2076.json.
//
//   node scripts/shapes/concepts/drake-2076.mjs
//   then: npm run vehicles:bake
//
// The Drake fifty years on: a printed-to-order air yacht, a compound coaxial after the Sikorsky
// Raider X (two rigid rotors one over the other under a faired hub, and a pusher at the tail). The
// duck is a vanity hull now. The shape is a choice the owner pays for, printed in one piece, so it
// keeps every curve the old Drake had and loses the brown armour, the brass and the army green.
//
// ⚠ THIS STARTS FROM mesh_drake.json AND KEEPS ITS SKELETON. Everything the code reads off a Drake is
// still here under its own name and channel: the head and the eye window the cockpit is lofted from
// (interior-drake.js), the `cabin` block, the hull loft the nose art wraps onto, the wings on
// `wings`/`brake`, the rotor head and its fold on `rotorFold`, the tail and pusher on `boat`, the
// guns on `boat`, the ramp and its extension on `ramp`, the saloon `when: ramp`, the gear bay doors
// and feet on `gear`/`ski`/`paddle`/`paddleL`, `whenNot: feetGone`. The frame, the scale and every
// face that touches the ground or the water are the stock Drake's, so she sits and floats the same.
// What is new is laid over that: glazing, seams, louvres, sensors, light lines, a hub fairing, and a
// pearl and titanium colourway in place of walnut and brass.
//
// ⚠ THIS OVERWRITES THE JSON. Edit this file, not the mesh in the Modelshop.
//
// Every new part is `minDetail: 1`, so the far LOD is the stock Drake's own body.
//
// Frame: f fore, g right, h up, in the Drake's units (7.2 m to a unit, mesh_drake.json `cabin`).
// Angles on a section are lib.mjs's: 0 = right waterline, +90 = crown, -90 = keel.
import { readFileSync, writeFileSync } from 'node:fs';
import { R, P3, tube, mirror, group, poly as rawPoly, quad, pod, DEG } from '../fw-meshes/lib.mjs';
const { formatMesh, validateMesh, compileMesh } = await import('../../../client/shared/vehicle-mesh.js');

const BASE = JSON.parse(readFileSync(new URL('../../../content/vehicle_models/mesh_drake.json', import.meta.url), 'utf8')).params;
const FINE = { minDetail: 1 };
const clone = (x) => JSON.parse(JSON.stringify(x));
const lerp = (a, b, t) => a + (b - a) * t;
const range = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));
// Every poly face needs a role; trim and fittings are 'nacelle' unless they say otherwise.
const poly = (name, faces, extra) => rawPoly(name, faces.map((f) => ({ role: 'nacelle', ...f })), extra);
const find = (parts, name) => {
  for (const p of parts || []) {
    if (p.name === name) return p;
    const q = find(p.parts, name);
    if (q) return q;
  }
  return null;
};

// ── THE HULL, AS A SURFACE ──────────────────────────────────────────────────
// The fuselage loft's own super-ellipse section (vehicle-mesh.js emitLoft), at any station and angle,
// so glazing and seams lie on the skin the renderer draws. `out` pushes a point off it.
function superSkin(L) {
  const st = L.stations, [eg, et, eb] = L.exp;
  const sec = (f) => {
    if (f >= st[0].f) return st[0];
    if (f <= st[st.length - 1].f) return st[st.length - 1];
    for (let i = 0; i < st.length - 1; i++) {
      const A = st[i], B = st[i + 1];
      if (f <= A.f && f >= B.f) {
        const t = (A.f - f) / (A.f - B.f);
        return { rg: lerp(A.rg, B.rg, t), rvT: lerp(A.rvT, B.rvT, t), rvB: lerp(A.rvB, B.rvB, t), cz: lerp(A.cz, B.cz, t) };
      }
    }
    return st[0];
  };
  return (f, aDeg, out = 0) => {
    const s = sec(f), a = aDeg * DEG, cs = Math.cos(a), sn = Math.sin(a);
    const g = Math.sign(cs) * Math.pow(Math.abs(cs), eg) * s.rg;
    const h = sn >= 0 ? Math.pow(sn, et) * s.rvT : -Math.pow(-sn, eb) * s.rvB;
    // Off the skin along the section's own normal (the gradient of the super-ellipse), not radially,
    // so a point on a flat flank stands straight off it.
    const ng = Math.abs(cs) > 1e-6 ? Math.sign(cs) * Math.pow(Math.abs(cs), 2 - eg) / s.rg : 0;
    const nh = sn >= 0 ? Math.pow(sn, 2 - et) / s.rvT : -Math.pow(-sn, 2 - eb) / s.rvB;
    const nl = Math.hypot(ng, nh) || 1;
    return P3([f, g + ng / nl * out, s.cz + h + nh / nl * out]);
  };
}

const parts = clone(BASE.parts).filter((p) => p.name !== 'armour plate' && p.name !== 'armour seams');
const FUS = find(parts, 'fuselage');
const at = superSkin(FUS);
// The stock hull carries a dark band on each flank under the armour plate. The plate is gone, so
// the band is painted over and the new glazing is its own part, framed.
FUS.regions = FUS.regions.map((r) => (r.role === 'glass' ? { at: r.at, k: r.k, paint: 'flank' } : r));
FUS.note = 'The neck, the breast, the back and the tail, the stock Drake\'s loft unchanged so she sits and floats the same. The head is its own part, on top of the neck.';

// A curved patch of hull as a grid of quads, `o` proud of the skin.
function patch(fs, as, extra, o = 0.0025) {
  const out = [];
  for (let i = 0; i < fs.length - 1; i++) for (let j = 0; j < as.length - 1; j++) {
    out.push(quad(at(fs[i + 1], as[j], o), at(fs[i], as[j], o), at(fs[i], as[j + 1], o), at(fs[i + 1], as[j + 1], o), extra));
  }
  return out;
}
const alongF = (fs, a, o = 0.004) => fs.map((f) => at(f, a, o));
const roundF = (f, as, o = 0.004) => as.map((a) => at(f, a, o));
// A closed loop round a rectangle in (f, angle), with its corners cut so it reads as a rounded frame.
function rimLoop(f0, f1, a0, a1, o, c = 0.18) {
  const df = (f0 - f1) * c * 0.5, da = (a1 - a0) * c * 0.5;
  const pts = [
    ...alongF(range(f0 - df, f1 + df, 4), a0, o), at(f1, a0 + da, o),
    ...roundF(f1, range(a0 + da, a1 - da, 3), o).slice(1), at(f1 + df, a1, o),
    ...alongF(range(f1 + df, f0 - df, 4), a1, o), at(f0, a1 - da, o),
    ...roundF(f0, range(a1 - da, a0 + da, 3), o).slice(1),
  ];
  pts.push(pts[0]);
  return pts;
}
const TI = (name, pts, r = 0.0035, extra = {}) => tube(name, pts, r, { role: 'nacelle', paint: 'ti', sh: 0.85, sides: 5, ...FINE, ...extra });
const LED = (name, pts, r = 0.0026, extra = {}) => tube(name, pts, r, { role: 'nacelle', paint: 'led', sh: 1, sides: 5, ...FINE, ...extra });
const SEAM = (name, pts, r = 0.0018) => tube(name, pts, r, { role: 'nacelle', paint: 'seamDk', sh: 0.35, sides: 4, ...FINE });
const GLASS = [34, 58, 72];

// ── THE SALOON GLAZING ──────────────────────────────────────────────────────
// Four tall windows down each flank where the armour was, over the six seats in the saloon: smoked
// glass a hair proud of the hull, a titanium frame round each with its corners rounded, a lit sill
// under the row and a polished character line over it from the shoulder to the tail cone.
const WIN = [[0.125, 0.045], [0.03, -0.05], [-0.065, -0.145], [-0.16, -0.235]];
const WA = [7, 27];
const glazing = [];
for (const [f0, f1] of WIN) {
  glazing.push(poly('saloon window', patch(range(f0, f1, 3), range(WA[0], WA[1], 3), { role: 'glass', tint: GLASS, sh: 0.9 }), FINE));
  glazing.push(TI('saloon window frame', rimLoop(f0 + 0.004, f1 - 0.004, WA[0] - 1.2, WA[1] + 1.2, 0.0045), 0.0042));
}
glazing.push(LED('saloon sill light', alongF(range(0.16, -0.27, 10), 3.5, 0.005)));
glazing.push(TI('character line', alongF(range(0.31, -0.36, 14), 36, 0.0045), 0.0034));
glazing.push(TI('waist chine', alongF(range(0.38, -0.30, 14), -14, 0.004), 0.0028));

// ── THE PRINTED SKIN: panel lines, hatches, louvres ─────────────────────────
// Printed in one piece, so the only seams are where it opens: the fuel-cell hatch on each upper flank,
// the tail-cone joint, and the service panels under the shoulder bars.
const skinWork = [];
skinWork.push(SEAM('tail cone joint', roundF(-0.3, range(-70, 76, 18), 0.0035)));
skinWork.push(SEAM('fuel cell hatch seam', rimLoop(-0.21, -0.37, 42, 66, 0.0035, 0.12)));
// Fuel-cell cooling louvres in the hatch: a dark recess and eight slats over it, each tipped out.
{
  const fs = range(-0.235, -0.345, 8), a0 = 46, a1 = 62;
  skinWork.push(poly('fuel cell louvre recess', patch([-0.225, -0.355], [a0 - 1, a1 + 1], { paint: 'seamDk', sh: 0.3 }, 0.003), FINE));
  skinWork.push(poly('fuel cell louvres', fs.map((f) => quad(at(f - 0.006, a0, 0.0045), at(f + 0.006, a0, 0.0045), at(f + 0.006, a1, 0.0075), at(f - 0.006, a1, 0.0075), { paint: 'ti', sh: 0.75 })), FINE));
}
// Service panels low on the shoulders, each with two flush latches.
for (const [f0, f1] of [[0.33, 0.2]]) {
  skinWork.push(SEAM('service panel seam', rimLoop(f0, f1, -48, -22, 0.0035, 0.1)));
  for (const f of [f0 - 0.025, f1 + 0.025]) skinWork.push(poly('panel latch', patch([f + 0.008, f - 0.008], [-37, -33], { paint: 'ti', sh: 0.8 }, 0.004), FINE));
}
// The aft beacon strakes, and a step-light where a boot finds the wing root.
skinWork.push(LED('wing root light', alongF(range(0.22, 0.06, 4), 24, 0.005), 0.0022));
const flanks = mirror('flank work', [...glazing, ...skinWork]);

// The hydrogen receptacle: a door low on the right flank with the fuel's blue ring on it. Right
// side only, the side the bowser comes up on.
const receptacle = [
  SEAM('hydrogen door seam', rimLoop(-0.02, -0.09, -36, -20, 0.0035, 0.3)),
  poly('hydrogen door', patch(range(-0.025, -0.085, 2), range(-34, -22, 2), { paint: 'flank', sh: 0.82 }, 0.0032), FINE),
  TI('hydrogen ring', range(0, 360, 12).map((d) => {
    const c = at(-0.055, -28, 0.005), r = 0.014;
    return P3([c[0] + Math.cos(d * DEG) * r, c[1], c[2] + Math.sin(d * DEG) * r]);
  }), 0.0028, { paint: 'h2' }),
];

// ── THE HEAD: eyes framed, a lidar on the crown, a sensor ball under the chin ─
const HEAD = find(parts, 'head'), EYEW = find(parts, 'eye window'), EYEF = find(parts, 'eye frame');
const outerRim = EYEF.faces.map((fc) => fc.p[0]);
const innerRim = EYEW.faces.map((fc) => fc.p[1]);
const proud = (q, d) => P3([q[0], q[1] + d, q[2]]);
const head = [
  mirror('eye bezels', [
    TI('eye bezel', [...outerRim, outerRim[0]].map((q) => proud(q, 0.004)), 0.0058),
    LED('eye seal', [...innerRim, innerRim[0]].map((q) => proud(q, 0.003)), 0.0024),
  ]),
  // A lidar puck on the crown, where nothing else on her is as high but the rotor.
  { kind: 'drum', name: 'crown lidar base', f: 0.585, r: 0.026, n: 14, z: [0.508, 0.522], role: 'nacelle', paint: 'ti', sh: { base: 0.7, alt: 0.1 }, top: { sh: 0.9 }, ...FINE },
  { kind: 'drum', name: 'crown lidar window', f: 0.585, r: 0.021, n: 14, z: [0.522, 0.536], role: 'nacelle', paint: 'smoke', sh: { base: 0.85 }, ...FINE },
  { kind: 'drum', name: 'crown lidar cap', f: 0.585, r: 0.023, n: 14, z: [0.536, 0.542], role: 'nacelle', paint: 'ti', sh: { base: 0.8 }, top: { sh: 0.95 }, ...FINE },
  // The sense-and-avoid ball under the chin: a smoked window forward, on a short neck.
  group('chin sensor', [
    pod('chin sensor ball', 0, 0, [[0.03, 0.004], [0.026, 0.016], [0.016, 0.025], [0, 0.029], [-0.016, 0.025], [-0.026, 0.016], [-0.03, 0.004]], {
      sides: 14, paint: 'carbon', regions: [{ at: [0.03, 0.026], k: 'all', role: 'glass', tint: [16, 22, 28] }],
    }),
  ], { xf: { t: [0.752, 0, 0.198] }, ...FINE }),
  tube('chin sensor neck', [[0.752, 0, 0.226], [0.752, 0, 0.246]], 0.012, { role: 'nacelle', paint: 'ti', sides: 8, ...FINE }),
  // Air-data probes either side of the bill root.
  mirror('bill probes', [
    // Role 'strut', not 'gear': a gear face is hidden while the gear is up.
    tube('pitot', [[0.79, 0.052, 0.29], [0.84, 0.068, 0.288], [0.9, 0.07, 0.288]], 0.0032, { role: 'strut', paint: 'ti', sh: 0.9, sides: 5, ...FINE }),
    tube('pitot tip', [[0.9, 0.07, 0.288], [0.915, 0.07, 0.288]], 0.0022, { role: 'strut', paint: 'seamDk', sides: 5, ...FINE }),
  ]),
];
void HEAD;

// ── THE BREAST: landing lights and a ventral radome ─────────────────────────
const breast = [
  mirror('landing lights', [
    tube('landing light bezel', [at(0.6, -48, -0.001), at(0.6, -48, 0.005)], 0.021, { role: 'nacelle', paint: 'ti', sides: 12, ...FINE }),
    tube('landing light lens', [at(0.6, -48, 0.005), at(0.6, -48, 0.0065)], 0.016, { role: 'nacelle', paint: 'lamp', sh: 1, sides: 12, caps: 1, ...FINE }),
  ]),
];

// ── THE BACK: hub fairing, transmission fairing, antennas ───────────────────
// The Raider's look: one smooth fairing round the mast between the two hubs, a cap over the top hub,
// and a hump over the gearbox that blends the pylon into the back. The hub parts ride the rotor
// head's own slide, so they go down into the pylon with it in plane mode.
const RH = find(parts, 'rotor head');
const D = (name, r, z0, z1, paint, extra = {}) => ({ kind: 'drum', name, f: 0.1, r: R(r), n: 18, z: [R(z0), R(z1)], role: 'nacelle', paint, sh: { base: 0.72, alt: 0.08 }, ...FINE, ...extra });
const lens = (name, z0, z1, rMid, rEnd, paint, n = 5) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n, tm = (t0 + t1) / 2;
    const r = rEnd + (rMid - rEnd) * Math.sin(Math.PI * tm);
    out.push(D(name, r, lerp(z0, z1, t0), lerp(z0, z1, t1), paint, i === n - 1 ? { top: { sh: 0.95 } } : i === 0 ? { bottom: { sh: 0.45 } } : {}));
  }
  return out;
};
RH.parts.push(
  // Between the hubs: a lens of fairing, the Raider's own.
  ...lens('interhub fairing', 0.669, 0.711, 0.098, 0.07, 'hull76'),
  // Over the top hub: a domed cap with a lit ring at its rim.
  D('hub cap', 0.07, 0.755, 0.768, 'hull76'), D('hub cap', 0.058, 0.768, 0.779, 'hull76'),
  D('hub cap', 0.042, 0.779, 0.788, 'hull76'), D('hub cap', 0.022, 0.788, 0.794, 'hull76', { top: { sh: 1 } }),
  D('hub cap light', 0.0715, 0.7555, 0.759, 'led', { sh: { base: 1 } }),
  // Under the bottom hub: the swashplate and its four pitch links.
  D('swashplate', 0.058, 0.598, 0.61, 'ti', { bottom: { sh: 0.5 } }),
  ...[0, 1, 2, 3].map((k) => {
    const a = (k * 90 + 45) * DEG;
    return tube('pitch link', [[0.1 + Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0.606], [0.1 + Math.cos(a) * 0.056, Math.sin(a) * 0.056, 0.628]], 0.004, { role: 'nacelle', paint: 'ti', sides: 5, ...FINE });
  }),
);
// The gearbox hump: a teardrop over the pylon root, louvred, with an intake at its nose.
const HUMP = [
  [0.2, 0.012, 0.01, 0.06, 0.4], [0.185, 0.05, 0.04, 0.09, 0.405], [0.16, 0.078, 0.07, 0.12, 0.41], [0.12, 0.098, 0.088, 0.15, 0.41],
  [0.07, 0.104, 0.092, 0.16, 0.405], [0.02, 0.098, 0.084, 0.16, 0.395], [-0.03, 0.078, 0.066, 0.15, 0.38], [-0.07, 0.044, 0.04, 0.12, 0.36], [-0.09, 0.012, 0.012, 0.06, 0.345],
].map(([f, rg, rvT, rvB, cz]) => ({ f, rg, rvT, rvB, cz }));
const back = [
  { kind: 'loft', name: 'gearbox fairing', sides: 18, section: 'super', role: 'body', exp: [0.85, 0.8, 1], stations: HUMP, paint: 'hull76',
    shade: { base: 0.64, amp: 0.34 }, capFore: { kind: 'apex', at: [0.205, 0, 0.4], paint: 'hull76' }, capAft: { kind: 'apex', at: [-0.095, 0, 0.343], paint: 'hull76' }, ...FINE },
  // The intake under the fairing's nose, dark, with a titanium lip.
  poly('gearbox intake', [quad([0.188, -0.045, 0.385], [0.188, 0.045, 0.385], [0.176, 0.06, 0.41], [0.176, -0.06, 0.41], { paint: 'seamDk', sh: 0.25 })], FINE),
  tube('gearbox intake lip', [[0.192, -0.05, 0.383], [0.192, 0.05, 0.383]], 0.004, { role: 'nacelle', paint: 'ti', sides: 5, ...FINE }),
  mirror('gearbox louvres', [poly('louvres', range(0.11, -0.01, 6).map((f) => quad([f + 0.009, 0.1, 0.43], [f - 0.009, 0.1, 0.43], [f - 0.009, 0.108, 0.405], [f + 0.009, 0.108, 0.405], { paint: 'seamDk', sh: 0.3 })), FINE)]),
  mirror('gearbox light', [LED('fairing light line', [[0.17, 0.07, 0.445], [0.1, 0.098, 0.47], [0.02, 0.092, 0.462], [-0.05, 0.058, 0.43]], 0.0024)]),
  // The satellite dome between the sails, and two blade antennas.
  { kind: 'drum', name: 'satcom radome', f: -0.47, r: 0.034, n: 14, z: [0.255, 0.27], role: 'nacelle', paint: 'hull76', sh: { base: 0.72, alt: 0.06 }, ...FINE },
  { kind: 'drum', name: 'satcom radome', f: -0.47, r: 0.026, n: 14, z: [0.27, 0.281], role: 'nacelle', paint: 'hull76', sh: { base: 0.8 }, ...FINE },
  { kind: 'drum', name: 'satcom radome', f: -0.47, r: 0.014, n: 14, z: [0.281, 0.286], role: 'nacelle', paint: 'hull76', sh: { base: 0.9 }, top: { sh: 1 }, ...FINE },
  { kind: 'blade', name: 'datalink blade', role: 'fin', paint: 'carbon', t: 0.004, sh: [0.75, 0.6], outline: [[-0.53, 0.235], [-0.545, 0.29], [-0.56, 0.29], [-0.575, 0.225]], ...FINE },
  { kind: 'blade', name: 'belly antenna', role: 'fin', paint: 'carbon', t: 0.004, sh: [0.7, 0.55], outline: [[-0.17, -0.165], [-0.185, -0.205], [-0.2, -0.205], [-0.215, -0.155]], ...FINE },
];

// ── THE TAIL: light along the boom, endplates, a stator'd duct ──────────────
const TAIL = find(parts, 'tail'), FAN = find(parts, 'pusher fan');
TAIL.parts.push(
  LED('boom light', [[-0.5, 0, 0.306], [-0.7, 0, 0.311], [-0.86, 0, 0.312]], 0.0028),
  mirror('tailplane endplates', [
    { kind: 'panel', name: 'endplate', c: [[-0.86, 0.272, 0.2], [-0.875, 0.272, 0.3], [-0.945, 0.272, 0.31], [-0.965, 0.272, 0.2]], th: 0.008, role: 'fin', sh: 0.82, paint: 'hull76', ...FINE },
    LED('endplate light', [[-0.876, 0.278, 0.296], [-0.944, 0.278, 0.306]], 0.0024),
  ]),
  // Ventral strake under the boom, the Raider's.
  { kind: 'blade', name: 'ventral strake', role: 'fin', paint: 'hull76', t: 0.012, sh: [0.86, 0.66], outline: [[-0.84, 0.15], [-0.94, 0.08], [-1.0, 0.08], [-0.99, 0.16]], ...FINE },
);
{
  const fz = 0.236, ring = (f, r) => range(0, 360, 20).map((d) => P3([f, Math.cos(d * DEG) * r, fz + Math.sin(d * DEG) * r]));
  FAN.parts.push(
    tube('duct lip', ring(-1.046, 0.166), 0.011, { role: 'body', paint: 'ti', sh: 0.85, sides: 6, ...FINE }),
    tube('duct trailing ring', ring(-1.2, 0.163), 0.007, { role: 'body', paint: 'carbon', sh: 0.6, sides: 5, ...FINE }),
    tube('duct light ring', ring(-1.04, 0.15), 0.0035, { role: 'nacelle', paint: 'led', sh: 1, sides: 5, ...FINE }),
    // Six stators behind the fan, from the hub to the duct wall.
    ...range(0, 300, 5).map((d) => {
      const a = (d + 15) * DEG, c = Math.cos(a), s = Math.sin(a);
      return { kind: 'panel', name: 'stator', c: [[-1.165, c * 0.028, fz + s * 0.028], [-1.165, c * 0.152, fz + s * 0.152], [-1.19, c * 0.152, fz + s * 0.152], [-1.19, c * 0.028, fz + s * 0.028]], th: 0.006, role: 'nacelle', sh: 0.6, paint: 'carbon', ...FINE };
    }),
    { kind: 'cone', name: 'tail cone', f: -1.185, h: fz, r: 0.03, n: 10, apex: [-1.24, 0, fz], role: 'nacelle', paint: 'hull76', ...FINE },
  );
}

// ── THE WINGS: a lit leading edge, tip pods, two fences ─────────────────────
// Inside the innermost wing group, so they fold, sweep and brake with it.
const WING = find(parts, 'wing').parts;
WING.push(
  LED('leading edge light', [[0.2635, 0.22, 0.124], [0.2235, 0.68, 0.1456], [0.1735, 0.83, 0.1528]], 0.0036),
  group('wingtip pod', [pod('tip pod', 0, 0, [[0.19, 0.003], [0.18, 0.011], [0.15, 0.015], [0.09, 0.015], [0.05, 0.011], [0.035, 0.003]], {
    sides: 10, paint: 'ti', regions: [{ at: [0.19, 0.18], k: 'all', paint: 'led' }],
  })], { xf: { t: [0, 0.848, 0.1505] }, ...FINE }),
  ...[0.45, 0.63].map((g) => ({ kind: 'panel', name: 'wing fence', c: [[0.245, g, 0.134], [0.235, g, 0.168], [0.08, g, 0.162], [0.06, g, 0.134]], th: 0.004, role: 'wing', sh: 0.8, paint: 'ti', ...FINE })),
);

// ── LAMPS ───────────────────────────────────────────────────────────────────
// The stock five (nav red and green on the flanks, the tail strobe, two beacons) and two strobes on
// the tail cone, lensed on the hull.
const STROBE = [-0.4, 20];
const strobeAt = (s) => { const q = at(STROBE[0], STROBE[1], 0.006); return [q[0], s * q[1], q[2]]; };
const lamps = [...clone(BASE.lamps),
  { at: strobeAt(1), n: [-0.3, 0.95, 0.1], rgb: '255,255,255', kind: 'strobe' },
  { at: strobeAt(-1), n: [-0.3, -0.95, 0.1], rgb: '255,255,255', kind: 'strobe' },
];
const strobeLens = mirror('cone strobes', [tube('cone strobe', [at(STROBE[0] + 0.012, STROBE[1], 0.002), at(STROBE[0] - 0.012, STROBE[1], 0.002)], 0.009, { role: 'body', paint: 'lensWhite', sh: 1, sides: 8, caps: 1, ...FINE })]);

// ── ROTORS ──────────────────────────────────────────────────────────────────
// Four blades on each rigid rotor, as the Raider's; the fold, the tuck and the pusher's slide are the
// stock Drake's, so cockpit.js and the renderer fold them as they always have.
const rotors = clone(BASE.rotors);
rotors[0].blades = 4; rotors[1].blades = 4;

// ── THE COLOURWAY ───────────────────────────────────────────────────────────
// The mandarin's markings, kept, in the materials of a yacht: a champagne pearl hull, the breast in
// violet metal-flake, the crest's emeralds and blues as they were, the bill in candy red, titanium
// where the brass was and pearl white where the army green was.
const paints = { ...clone(BASE.paints),
  flank: { rgb: [218, 196, 158], livery: 'base', mat: 'pearl' },
  belly: { rgb: [242, 238, 228], livery: 'base', mat: 'pearl' },
  breast: { rgb: [92, 34, 124], alt: [122, 54, 166], livery: 'base', mat: 'metallic' },
  neck: { rgb: [92, 34, 124], alt: [122, 54, 166], livery: 'base', mat: 'metallic' },
  face: { rgb: [234, 156, 86], livery: 'base', mat: 'pearl' },
  throat: { rgb: [244, 212, 168], livery: 'base', mat: 'pearl' },
  bill: { rgb: [210, 52, 40], livery: 'trim', mat: 'candy' },
  billtip: { rgb: [238, 186, 150], livery: 'trim', mat: 'pearl' },
  tail: { rgb: [236, 234, 228], livery: 'trim', mat: 'pearl' },
  duct: { rgb: [232, 230, 224], livery: 'trim', mat: 'pearl' },
  hub: { rgb: [188, 186, 180], livery: 'fixed', mat: 'polished' },
  seam: { rgb: [150, 132, 104], livery: 'trim', mat: 'pearl' },
  wing: { rgb: [96, 76, 56], livery: 'base', mat: 'pearl' },
  primary: { rgb: [88, 78, 70], livery: 'base', mat: 'pearl' },
  saloon: { rgb: [232, 226, 214], livery: 'fixed' },
  walnut: { rgb: [150, 132, 110], livery: 'fixed' },
  hull76: { rgb: [238, 236, 230], livery: 'trim', mat: 'pearl' },
  ti: { rgb: [196, 194, 186], livery: 'fixed', mat: 'polished' },
  led: { rgb: [120, 240, 210], livery: 'fixed', mat: 'matte' },
  seamDk: { rgb: [40, 36, 34], livery: 'fixed', mat: 'matte' },
  carbon: { rgb: [34, 36, 40], livery: 'fixed', mat: 'satin' },
  h2: { rgb: [60, 128, 236], livery: 'fixed', mat: 'gloss' },
  smoke: { rgb: [18, 26, 30], livery: 'fixed', mat: 'glass' },
};

const doc = {
  id: 'drake_2076',
  kind: 'mesh',
  params: {
    name: 'Drake 2076',
    note: 'CONCEPT, generated by scripts/shapes/concepts/drake-2076.mjs (edit that, not this). The Drake fifty years on: a printed-to-order air yacht, a compound coaxial after the Sikorsky Raider X, the duck kept as a vanity hull. The stock Drake\'s skeleton, channels and contact faces unchanged, with the armour gone for four framed saloon windows a side, a faired hub between four-blade rigid rotors, a gearbox hump, a stator\'d duct with a lit lip, lit leading edges and wingtip pods, a crown lidar and a chin sensor, and a champagne pearl and titanium colourway. A variant of the drake mesh, worn as the Drake 2076 factory edition.',
    classFacts: clone(BASE.classFacts),
    groundPitch: BASE.groundPitch,
    navLamps: BASE.navLamps,
    hull: BASE.hull,
    cabin: clone(BASE.cabin),
    lamps,
    rotors,
    finish: 'gloss',
    paints,
    parts: [...parts, flanks, ...receptacle, ...head, ...breast, ...back, strobeLens],
  },
};

const v = validateMesh(doc.params, doc.id);
if (v.errors.length) { console.log('ERRORS', v.errors.slice(0, 12)); process.exit(1); }
if (v.warnings?.length) console.log('warnings', v.warnings.slice(0, 8));
const n1 = compileMesh(doc.params, { detail: 1 }).faces.length, n0 = compileMesh(doc.params, { detail: 0 }).faces.length;
writeFileSync(new URL('../../../content/vehicle_models/mesh_drake_2076.json', import.meta.url), formatMesh(doc));
console.log('mesh_drake_2076.json:', n1, 'faces near,', n0, 'far');
