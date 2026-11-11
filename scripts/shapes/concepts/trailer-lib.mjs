// What the three trailer bodies share (docs/proposals/hover-rigs.md phase 6): the primitives the truck
// editions use, the trailer frame, and the running gear every body carries.
//
// THE FRAME. f fore, g right, h up, in the truck's own units, with f 0 at the kingpin (the middle of
// the fifth wheel) and the body aft of it, so f is negative. aircraft3d.js hangs it on whichever
// tractor's pin, so nothing here knows which truck pulls it. h 0 is the road, as on a tractor file.
//
// THE RULES a body keeps, and meshes.mjs section 8 holds:
//   - Nothing forward of f 0. A dropped box is anchored on its foremost point, which has to be the pin.
//   - The nose is no wider than NOSE_HALF where it meets the pin, so it clears the Barrow's cab back at
//     90 degrees of articulation, the tightest of the eight (frameBack in aircraft3d.js).
//   - Nothing below FLOOR within REACH of the pin, where the tractor's deck, fifth wheel and saddle
//     tanks are.
//   - Colours that belong to the box are plain `body` faces, which take the box's paint (`deck`).
//     Everything else is a fixed slot or a tinted lamp, never `pk` and never the bare hardware role,
//     both of which read the TRACTOR's livery: a box has to look the same whoever pulls it.
import { writeFileSync } from 'node:fs';
const { formatMesh, validateMesh, compileMesh } = await import('../../../client/shared/vehicle-mesh.js');

export const NOSE_HALF = 0.096;     // under the Barrow's own box nose (0.0999)
export const FLOOR = 0.075;         // the stock box's floor: the fifth wheel's plate is at 0.082
export const REACH = 0.10;

export const r6 = (x) => (Math.round(x * 1e6) / 1e6) || 0;
const P = (f, g, h) => [r6(f), r6(g), r6(h)];
const mean = (vs) => { const s = [0, 0, 0]; for (const v of vs) { s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; } return s.map((x) => x / vs.length); };
function newell(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}
const shadeOf = ([x, y, z]) => r6(x * x * (x > 0 ? 0.80 : 0.55) + y * y * (y > 0 ? 0.62 : 0.72) + z * z * (z > 0 ? 1.00 : 0.42));
const tags = (o) => { const t = {}; for (const k of ['minDetail', 'when', 'whenNot']) if (o[k] != null) t[k] = o[k]; return t; };
export const LR = [-1, 1];
export const fine = { minDetail: 1 };

// A convex solid: each face wound outward from its centre and shaded by its normal.
export function solid(name, polys, o = {}) {
  const uniq = new Map();
  for (const p of polys) for (const v of p) uniq.set(v.join(','), v);
  const cen = mean([...uniq.values()]).map(r6);
  const faces = polys.map((p) => {
    let pts = p.map((v) => P(v[0], v[1], v[2]));
    let n = newell(pts);
    const c = mean(pts);
    if (n[0] * (c[0] - cen[0]) + n[1] * (c[1] - cen[1]) + n[2] * (c[2] - cen[2]) < 0) { pts = pts.slice().reverse(); n = n.map((x) => -x); }
    const f = { role: o.role || 'body', sh: shadeOf(n), p: pts, cen };
    if (o.tint) f.tint = o.tint;
    if (o.paint) f.paint = o.paint;
    return f;
  });
  return { kind: 'poly', name, faces, ...tags(o) };
}
// Rings of equal length, skinned in order and capped.
export function loft(name, rings, o = {}) {
  const polys = [], n = rings[0].length;
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    polys.push([rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]]);
  }
  polys.push(rings[0].slice(), rings[rings.length - 1].slice());
  return solid(name, polys, o);
}
export const ngon = (n, fn) => Array.from({ length: n }, (_, k) => fn(Math.cos((k + 0.5) / n * Math.PI * 2), Math.sin((k + 0.5) / n * Math.PI * 2)));
// An upright puck, and a round section along f (r at each station).
export const puck = (name, f, g, r, z0, z1, o = {}, n = 10) => loft(name, [z0, z1].map((z) => ngon(n, (c, s) => [f + c * r, g + s * r, z])), o);
export const tubeF = (name, stations, g, h, o = {}, n = 8) => loft(name, stations.map(([f, r]) => ngon(n, (c, s) => [f, g + c * r, h + s * r])), o);
// An upright prism on a convex plan [[f, g], ...].
export const prism = (name, plan, z0, z1, o = {}) => solid(name, [
  plan.map(([f, g]) => [f, g, z1]), plan.map(([f, g]) => [f, g, z0]),
  ...plan.map(([f, g], i) => { const [f2, g2] = plan[(i + 1) % plan.length]; return [[f, g, z1], [f2, g2, z1], [f2, g2, z0], [f, g, z0]]; }),
], o);
export const box = (name, f0, f1, w, z0, z1, o = {}) => {
  const b = { kind: 'box', name, f: [r6(Math.min(f0, f1)), r6(Math.max(f0, f1))], w: r6(w), z: [r6(z0), r6(z1)] };
  if (o.g) b.g = r6(o.g);
  if (o.role && o.role !== 'body') b.role = o.role;
  if (o.tint) b.tint = o.tint;
  if (o.paint) b.paint = o.paint;
  return { ...b, ...tags(o) };
};
// A flat sheet (two-sided, no centre), for a flag or a placard.
export const sheet = (name, pts, o = {}) => {
  const f = { role: o.role || 'body', sh: o.sh ?? 0.9, p: pts.map((v) => P(v[0], v[1], v[2])) };
  if (o.tint) f.tint = o.tint;
  if (o.paint) f.paint = o.paint;
  return { kind: 'poly', name, faces: [f], ...tags(o) };
};

// ── Colours: lamps are tinted windows, which keep their own colour under any livery ──
export const RED = [214, 60, 48], AMBER = [236, 176, 96], WASH = [128, 226, 255], WHITE = [236, 240, 244];

// The fixed slots every body uses for its running gear.
export const GEAR_PAINTS = {
  frame: { rgb: [40, 43, 49], livery: 'fixed', mat: 'steel', tex: 'cast', note: 'the chassis, legs and arms: black steel whoever tows it' },
  steel: { rgb: [104, 110, 120], livery: 'fixed', mat: 'steel', tex: 'cast', note: 'bumper, brackets, fittings' },
  gunmetal: { rgb: [58, 62, 70], livery: 'fixed', mat: 'steel', tex: 'cast', note: 'the lift pads' },
  chrome: { rgb: [214, 220, 228], livery: 'fixed', mat: 'bare', tex: 'brushed', note: 'pad rings and handles' },
  rubber: { rgb: [28, 29, 31], livery: 'fixed', mat: 'satin', tex: 'rubber', note: 'mud flaps and seals' },
};

// ── Running gear ──
// A lift pad: a cast puck, a lit emitter ring (out when parked), a chrome ring and an arm up to `top`.
// Returns its parts and its row for the trailer block's pods.
export function liftPad(f, g, r, top) {
  const z0 = 0.014, z1 = 0.040;
  return {
    row: [r6(f), r6(g), r6(Math.max(0.04, r)), true, 0.024],
    parts: [
      puck('lift pad', f, g, r * 0.94, z0 + 0.006, z1, { role: 'gear', paint: 'gunmetal' }, 12),
      puck('emitter ring', f, g, r, z0, z0 + 0.006, { role: 'window', tint: WASH, whenNot: 'parked', ...fine }, 14),
      puck('pad ring', f, g, r * 0.97, z1 - 0.006, z1 - 0.002, { role: 'strut', paint: 'chrome', ...fine }, 14),
      box('pad arm', f - 0.012, f + 0.012, 0.009, z1, top, { role: 'strut', paint: 'frame', g: g * 0.92 }),
    ],
  };
}
// Landing legs, cranked up while it's hitched; a dropped box stands on their feet.
export const landingLegs = (f, g, top) => LR.flatMap((s) => [
  box('landing leg', f - 0.007, f + 0.007, 0.007, 0.012, top, { role: 'strut', paint: 'frame', g: s * g }),
  box('leg foot', f - 0.014, f + 0.014, 0.013, 0.004, 0.012, { role: 'strut', paint: 'frame', g: s * g }),
  box('leg crank', f - 0.003, f + 0.003, 0.010, top - 0.030, top - 0.024, { role: 'strut', paint: 'steel', g: s * (g + 0.012), ...fine }),
]);
// The air lines at the nose: red supply, blue service.
export const gladHands = (f, z) => LR.map((s) => box('glad hand', f - 0.006, f, 0.006, z, z + 0.010, { role: 'window', tint: s < 0 ? [52, 92, 196] : [196, 52, 44], g: s * 0.046, ...fine }));
// A tail lamp pair at f (the rear face), g out, h the lamp's middle.
export const tailLamps = (f, g, h) => LR.flatMap((s) => [
  box('tail lamp', f - 0.006, f + 0.001, 0.014, h - 0.009, h + 0.009, { role: 'window', tint: RED, g: s * g }),
  box('indicator', f - 0.005, f + 0.001, 0.006, h - 0.006, h + 0.006, { role: 'window', tint: AMBER, g: s * (g + 0.024), ...fine }),
]);
// A thruster pointing aft at f: a nozzle and its glow (out when parked).
export const thruster = (f, g, h, r) => [
  tubeF('thruster', [[f + 0.040, r * 0.9], [f + 0.008, r], [f, r * 1.12]], g, h, { role: 'strut', paint: 'gunmetal' }, 10),
  tubeF('thruster glow', [[f + 0.0015, r * 0.86], [f - 0.0005, r * 0.86]], g, h, { role: 'window', tint: [150, 168, 255], whenNot: 'parked' }, 10),
];
// Stroke lettering, A to Z and 0 to 9 only (cockpit-lettering.md), on a flank at g, reading forwards
// from that side: nose-ward on the left (g < 0), tail-ward on the right, as the Modelshop showed. `at` is the lower fore corner.
const CW = 0.012, CH = 0.018, ST = 0.0026, GAP = 0.005, SPACE = 0.007;
const Vs = (x, y0, y1) => [x, y0, x + ST, y1], Hs = (x0, y, x1) => [x0, y, x1, y + ST];
const GLYPHS = {
  A: [Vs(0, 0, CH), Vs(CW - ST, 0, CH), Hs(0, CH - ST, CW), Hs(0, CH / 2 - ST / 2, CW)],
  B: [Vs(0, 0, CH), Hs(0, CH - ST, CW * 0.8), Hs(0, CH / 2 - ST / 2, CW), Hs(0, 0, CW), Vs(CW * 0.8 - ST, CH / 2, CH), Vs(CW - ST, 0, CH / 2)],
  C: [Vs(0, 0, CH), Hs(0, CH - ST, CW), Hs(0, 0, CW)],
  D: [Vs(0, 0, CH), Hs(0, CH - ST, CW * 0.72), Hs(0, 0, CW * 0.72), Vs(CW - ST, CH * 0.2, CH * 0.8), Vs(CW * 0.72 - ST, CH * 0.8 - ST, CH), Vs(CW * 0.72 - ST, 0, CH * 0.2 + ST)],
  O: [Vs(0, 0, CH), Vs(CW - ST, 0, CH), Hs(0, CH - ST, CW), Hs(0, 0, CW)],
  P: [Vs(0, 0, CH), Hs(0, CH - ST, CW), Hs(0, CH / 2 - ST / 2, CW), Vs(CW - ST, CH / 2, CH)],
  H: [Vs(0, 0, CH), Vs(CW - ST, 0, CH), Hs(0, CH / 2 - ST / 2, CW)],
  R: [Vs(0, 0, CH), Hs(0, CH - ST, CW), Hs(0, CH / 2 - ST / 2, CW), Vs(CW - ST, CH / 2, CH), Vs(CW * 0.6, 0, CH / 2)],
  Y: [Vs(CW / 2 - ST / 2, 0, CH / 2), Hs(0, CH / 2 - ST / 2, CW), Vs(0, CH / 2, CH), Vs(CW - ST, CH / 2, CH)],
  2: [Hs(0, CH - ST, CW), Vs(CW - ST, CH / 2, CH), Hs(0, CH / 2 - ST / 2, CW), Vs(0, 0, CH / 2), Hs(0, 0, CW)],
};
export function lettering(name, text, f0, h0, g, o = {}) {
  const width = [...text].reduce((a, ch, i) => a + (ch === ' ' ? SPACE : CW) + (i < text.length - 1 ? GAP : 0), 0);
  const out = [];
  for (const s of LR) {
    const fOf = (x) => (s < 0 ? f0 - width + x : f0 - x);
    let x = 0;
    for (const ch of text) {
      if (ch === ' ') { x += SPACE + GAP; continue; }
      for (const [x0, y0, x1, y1] of GLYPHS[ch]) out.push(box(name, fOf(x + x0), fOf(x + x1), 0.0006, h0 + y0, h0 + y1, { role: 'window', ...o, g: s * g, ...fine }));
      x += CW + GAP;
    }
  }
  return out;
}

// Writes the file, after checking it against the rules at the top.
export function writeBody(id, params) {
  const doc = { id: 'trailer_' + id, kind: 'mesh', params: { partIds: true, ...params } };
  const v = validateMesh(doc.params, doc.id);
  if (v.errors.length) { console.log('ERRORS', v.errors.slice(0, 12)); process.exit(1); }
  const faces = compileMesh(doc.params, { detail: 1 }).faces;
  let fmax = -Infinity;
  for (const f of faces) for (const p of f.p) fmax = Math.max(fmax, p[0]);
  if (fmax > 1e-9) { console.log('a part stands forward of the pin, at f ' + fmax); process.exit(1); }
  writeFileSync(new URL('../../../content/vehicle_models/mesh_trailer_' + id + '.json', import.meta.url), formatMesh(doc));
  console.log('mesh_trailer_' + id + '.json:', faces.length, 'faces near,', compileMesh(doc.params, { detail: 0 }).faces.length, 'far');
}
