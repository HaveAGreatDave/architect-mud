// THE GATE FOR THE REAPER'S COCKPIT (client/shared/interior-reaper.js).
//
// Three questions, each silent when wrong:
//   (a) is it a room you can sit in and see out of — shell.mjs's own rays, at rest and with every
//       control at both of its stops;
//   (b) is the inside the OUTSIDE — the canopy glass is measured off the built exterior mesh
//       (`aircraftFaces('gunship')`), never off the profile, and the rail, the aperture and the bow
//       are held against it;
//   (c) does every control move — the geometry at one stop must differ from the other.
//
// ⚠ THE EXTERIOR IS IMPORTED HERE AND NOT THROUGH THE PROFILE. The profile reconstructs the hull
// from the same row, so asking it where the glass is would be the answer checking itself. The only
// thing borrowed from the profile is its stated scale and eye (M, fE, hE): a conversion, not a shape.
import { shellFaces, shellBounds } from '../../client/shared/interior-shell.js';
import { reaperProfile } from '../../client/shared/interior-reaper.js';

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('  FAIL  ' + msg); } };

// ── RAY / CONVEX POLYGON (shell.mjs's, verbatim) ─────────────────────────────
function rayHitsPoly(o, d, p) {
  const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
  const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const den = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
  if (Math.abs(den) < 1e-12) return 0;
  const w = [p[0][0] - o[0], p[0][1] - o[1], p[0][2] - o[2]];
  const t = (n[0] * w[0] + n[1] * w[1] + n[2] * w[2]) / den;
  if (t <= 1e-6) return 0;
  const q = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const ed = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const vp = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
    const c = [ed[1] * vp[2] - ed[2] * vp[1], ed[2] * vp[0] - ed[0] * vp[2], ed[0] * vp[1] - ed[1] * vp[0]];
    const s = c[0] * n[0] + c[1] * n[1] + c[2] * n[2];
    const scale = Math.hypot(n[0], n[1], n[2]) * Math.hypot(ed[0], ed[1], ed[2]) * Math.hypot(vp[0], vp[1], vp[2]);
    if (!(scale > 1e-24) || Math.abs(s) <= 1e-9 * scale) continue;
    const g = s > 0 ? 1 : -1;
    if (sign === 0) sign = g; else if (g !== sign) return 0;
  }
  return t;
}
const castFrom = (faces, o, d) => {
  let best = 0;
  for (const f of faces) { const t = rayHitsPoly(o, d, f.p); if (t && (!best || t < best)) best = t; }
  return best;
};
const cast = (faces, d) => castFrom(faces, [0, 0, 0], d);

const P = reaperProfile();
ok(!!P, 'no profile at all');
const B = shellBounds(P);

// ── (a) A ROOM YOU CAN SIT IN AND SEE OUT OF ─────────────────────────────────
function roomChecks(tag, live) {
  const faces = shellFaces(P, live);
  ok(faces.length > 0, tag + ': no geometry');
  ok(B[0] < -0.05 && B[1] < -0.05 && B[2] < -0.05 && B[3] > 0.05 && B[4] > 0.05 && B[5] > 0.05, tag + ': the eye is not strictly inside');
  ok(!cast(faces, [0, 1, 0]), tag + ': something is across the forward sight line');
  const wy = (P.winY[0] + P.winY[1]) / 2, wz = (P.winZ[0] + P.winZ[1]) / 2;
  const xL = P.xCentre - P.halfW, xR = P.xCentre + P.halfW;
  ok(!cast(faces, [xL, wy, wz]), tag + ': the left side glass is blocked');
  ok(!cast(faces, [xR, wy, wz]), tag + ': the right side glass is blocked');
  ok(!cast(faces, [0, 0, 1]), tag + ': something is across the canopy straight overhead');
  ok(castFrom(faces, [2 * P.xCentre, (P.seatY[1] + P.dashY) / 2, 0], [0, 0, -1]), tag + ': no floor down the footwell');
  ok(castFrom(faces, [0, 0, (P.backZ + P.roof) / 2], [0, -1, 0]), tag + ': nothing behind the seat (bulkhead/headrest)');
  const low = P.winZ[0] - 0.2;
  ok(cast(faces, [xL, 0, low]), tag + ': no left tub wall under the rail');
  ok(cast(faces, [xR, 0, low]), tag + ': no right tub wall under the rail');
  const down = cast(faces, [0, 0, -1]);
  ok(down > 0 && down < Math.abs(P.floor) - 1e-6, tag + ': nothing to sit on');
  let bad = 0;
  for (const f of faces) {
    if (!f.n || Math.abs(Math.hypot(f.n[0], f.n[1], f.n[2]) - 1) > 1e-6 || !Number.isFinite(f.n[0] + f.n[1] + f.n[2])) bad++;
    if (!f.p || f.p.length < 3) bad++;
    for (const q of f.p || []) {
      if (!Number.isFinite(q[0] + q[1] + q[2])) bad++;
      else if (q[0] < B[0] - 1e-6 || q[0] > B[3] + 1e-6 || q[1] < B[1] - 1e-6 || q[1] > B[4] + 1e-6 || q[2] < B[2] - 1e-6 || q[2] > B[5] + 1e-6) bad++;
    }
  }
  ok(bad === 0, tag + ': ' + bad + ' bad normals, NaNs or vertices outside the bounds');
  return faces;
}

const REST = { powered: true, ias: 180, alt: 2400, hdg: 40, rpm: 0.7, throttle: 0.6, fuel: 0.6, hull: 1, hour: 13 };
// Where each control's hardware is, as [x0, y0, z0, x1, y1, z1] in metres about the eye.
const PANEL = [-0.40, 0.36, -0.66, 0.40, 0.62, -0.08];
const WHERE = {
  stickX: [-0.15, 0.2, -1.2, 0.15, 0.5, -0.3], stickY: [-0.15, 0.2, -1.2, 0.15, 0.5, -0.3],
  rudder: [-0.3, 0.7, -1.2, 0.3, 1.0, -0.6], throttle: [-0.44, -0.2, -0.62, -0.30, 0.4, -0.25],
  flapNotch: [-0.60, -0.2, -0.62, -0.45, 0.3, -0.3], gearDown: [-0.40, 0.45, -0.55, -0.26, 0.62, -0.35],
  trim: [-0.15, 0.2, -0.6, 0.15, 0.5, -0.3], armed: [-0.40, 0.45, -0.37, -0.15, 0.62, -0.12],
  landingLight: [-0.30, 0.45, -0.62, -0.24, 0.62, -0.52], dome: [-0.5, -0.4, -0.5, -0.3, -0.2, -0.3],
  hour: [-0.16, 0.45, -0.58, -0.09, 0.62, -0.50],
};
for (const k of ['pitch', 'bank', 'hdg', 'ias', 'alt', 'vsi', 'rpm', 'fuel', 'hull']) WHERE[k] = PANEL;
const STOPS = [
  ['stickX', -1, 1], ['stickY', -1, 1], ['rudder', -1, 1], ['throttle', 0, 1], ['flapNotch', 0, 3],
  ['gearDown', false, true], ['trim', -1, 1], ['armed', false, true], ['powered', false, true],
  ['landingLight', false, true], ['dome', false, true], ['pitch', -25, 25], ['bank', -60, 60],
  ['hdg', 0, 180], ['ias', 0, 420], ['alt', 0, 8700], ['vsi', -6000, 6000], ['rpm', 0, 1],
  ['fuel', 0, 1], ['hull', 0.1, 1], ['hour', 13, 23],
];
console.log('\nreaper — ' + P.label);
const rest = roomChecks('rest', REST);
const hash = (faces) => faces.map((f) => f.p.map((q) => q.map((v) => v.toFixed(4)).join(',')).join(';') + '|' + (f.rgb || '') + (f.emis || 0)).join('\n');
const moved = [];
for (const [k, a, b] of STOPS) {
  const fa = roomChecks(k + '=' + a, { ...REST, [k]: a });
  // ⚠ TWICE AT THE SECOND STOP: the gear handle and the switches ease between positions, so the
  // first build after a change is part-way. The settled one is what is compared.
  shellFaces(P, { ...REST, [k]: b });
  const fb = roomChecks(k + '=' + b, { ...REST, [k]: b });
  // ── (c) EVERY CONTROL MOVES ──
  // ⚠ IN THE CONTROL'S OWN PLACE. A whole-cockpit hash passes a dead throttle lever, because the
  // fuel-flow needles on the panel move with the throttle too (mutation-tested: it did). So each
  // control is asked about the region its hardware is in, stated here from the A-10A layout.
  const box = WHERE[k] || [-9, -9, -9, 9, 9, 9];
  const inBox = (f) => { const c = f.p.reduce((q, v) => [q[0] + v[0], q[1] + v[1], q[2] + v[2]], [0, 0, 0]).map((v) => v / f.p.length);
    return c[0] >= box[0] && c[1] >= box[1] && c[2] >= box[2] && c[0] <= box[3] && c[1] <= box[4] && c[2] <= box[5]; };
  ok(hash(fa.filter(inBox)) !== hash(fb.filter(inBox)), k + ': nothing changes in its own place between ' + a + ' and ' + b + ' — the control is not wired');
  moved.push(k);
}
console.log('    ' + rest.length + ' faces at rest; ' + moved.length + ' controls driven to both stops');
ok(rest.length >= 4000 && rest.length <= 12000, 'face count ' + rest.length + ' is outside the 4,000–12,000 budget');

// ── (b) THE INSIDE IS THE OUTSIDE ────────────────────────────────────────────
const { loadWindshield } = await import('./dom-stub.mjs');
await loadWindshield();
const A3 = await import('../../client/game/js/panels/aircraft3d.js');
const glass = A3.aircraftFaces('gunship', 1).filter((f) => f.role === 'glass');
ok(glass.length > 20, 'the exterior has no canopy glass to measure');
// The scale and the eye's station, measured off the mesh rather than taken on trust: the A-10A's
// 16.26 m over the built airframe's own nose-to-tail extent, and U 0.30 along the built glass.
const all = A3.aircraftFaces('gunship', 1);
let fMax = -Infinity, fMin = Infinity, gf0 = -Infinity, gf1 = Infinity;
for (const f of all) for (const q of f.p) { fMax = Math.max(fMax, q[0]); fMin = Math.min(fMin, q[0]); }
for (const f of glass) for (const q of f.p) { gf0 = Math.max(gf0, q[0]); gf1 = Math.min(gf1, q[0]); }
const Mext = 16.26 / (fMax - fMin), fEext = gf0 + (gf1 - gf0) * 0.30;
ok(Math.abs(P.reaper.M - Mext) < 0.01, 'the profile\'s metres-per-unit ' + P.reaper.M.toFixed(3) + ' is not the mesh\'s ' + Mext.toFixed(3));
ok(Math.abs(P.reaper.fE - fEext) < 1e-3, 'the eye is not at U 0.30 of the built canopy: ' + P.reaper.fE.toFixed(3) + ' vs ' + fEext.toFixed(3));
const M = Mext, fE = fEext, { hE } = P.reaper;
const toShell = (q) => [q[1] * M, (q[0] - fE) * M, (q[2] - hE) * M];

// 1. THE RAIL IS WHERE THE GLASS STARTS. Per exterior ring station, the glass base (its lowest
//    vertices) against the outermost up-facing interior surface at that station and height.
const byF = new Map();
for (const f of glass) for (const q of f.p) {
  const key = q[0].toFixed(5), e = byF.get(key) || [];
  e.push(q); byF.set(key, e);
}
let railWorst = 0, railN = 0;
const baseline = [];
for (const [, qs] of byF) {
  const hMin = Math.min(...qs.map((q) => q[2]));
  const base = qs.filter((q) => q[2] < hMin + 1e-6);
  if (base.length < 2) continue;                          // a cap's centre, not a ring
  const g = Math.max(...base.map((q) => Math.abs(q[1])));
  const s = toShell([base[0][0], g, hMin]);
  baseline.push(s);
  // The nearest up-facing interior vertex at that station and height: the rail's edge on the glass.
  let near = Infinity;
  for (const f of rest) {
    if (f.n[2] < 0.9 || f.emis) continue;
    for (const q of f.p) if (Math.abs(q[1] - s[1]) < 0.01 && Math.abs(q[2] - s[2]) < 0.03) near = Math.min(near, Math.abs(Math.abs(q[0]) - s[0]));
  }
  railWorst = Math.max(railWorst, near); railN++;
}
ok(railN >= 8, 'measured the rail at only ' + railN + ' exterior stations');
ok(railWorst < 0.02, 'the sill does not meet the exterior glass base: worst ' + railWorst.toFixed(3) + ' m (tolerance 0.02)');

// 2. THE APERTURE IS THE GLASS. A ray from the eye to every exterior glass facet must mostly leave
//    (the bow, the mirrors, the HUD frame and the headrest may take a few), and a ray to just under
//    the glass base must be stopped by the rail or the tub.
// ⚠ FORWARD OF THE HEADREST ONLY: the glass behind your head is behind your head, and a seat that
// hid it would be correct. What is asked is that nothing of the ROOM stands in front of the glass.
let clear = 0, seen = 0;
for (const f of glass) {
  const c = f.p.reduce((a, q) => [a[0] + q[0] / f.p.length, a[1] + q[1] / f.p.length, a[2] + q[2] / f.p.length], [0, 0, 0]);
  const s = toShell(c), d = Math.hypot(...s);
  if (s[1] < -0.35) continue;
  // …and not the low windscreen under the glareshield line, which the panel and the HUD's body are
  // meant to hide: below 15° of depression and inside the coaming's own width.
  if (s[1] > 0 && s[2] / s[1] < -0.28 && Math.abs(s[0]) / s[1] < 0.9) continue;
  // The HUD's body stands on the coaming in front of the flat front pane, as on the aeroplane.
  if (s[1] > 0 && s[2] / s[1] < -0.10 && Math.abs(s[0]) / s[1] < 0.16) continue;
  seen++;
  if (!castFrom(rest, [0, 0, 0], s) || castFrom(rest, [0, 0, 0], s) > d * 0.98) clear++;
}
const clearPct = clear / Math.max(1, seen);
ok(clearPct >= 0.95, 'only ' + (clearPct * 100).toFixed(0) + '% of the exterior glass can be seen through from the seat');
let under = 0;
for (const s of baseline) for (const sx of [-1, 1]) if (castFrom(rest, [0, 0, 0], [sx * s[0], s[1], s[2] - 0.10])) under++;
ok(under >= baseline.length * 2 * 0.9, 'below the glass base the room is open: ' + under + '/' + (baseline.length * 2) + ' rays stopped');

// 3. THE BOW IS ON THE EXTERIOR'S FIRST RING SEAM. Every exterior glass vertex at that station
//    must have interior frame within 8 cm of it.
const fBow = P.reaper.H.fAt(1 / 8);
const bowPts = glass.flatMap((f) => f.p).filter((q) => Math.abs(q[0] - fBow) < 1e-6).map(toShell);
let bowWorst = 0;
for (const s of bowPts) {
  let best = Infinity;
  for (const f of rest) for (const q of f.p) best = Math.min(best, Math.hypot(q[0] - s[0], q[1] - s[1], q[2] - s[2]));
  bowWorst = Math.max(bowWorst, best);
}
ok(bowPts.length >= 4, 'no exterior ring seam at the bow station');
ok(bowWorst < 0.08, 'the bow frame is not on the exterior glass seam: worst ' + bowWorst.toFixed(3) + ' m');

// 4. THE EYE SITS UNDER THE GLASS WHERE THE EXTERIOR PAINTS THE PILOT, with glass above the head.
const atEye = glass.flatMap((f) => f.p).map(toShell).filter((s) => Math.abs(s[1]) < 0.4);
ok(atEye.some((s) => s[2] > 0.25), 'no canopy above the pilot\'s head at the eye station');
ok(atEye.some((s) => s[2] < -0.3), 'the glass base is not below the eye at the eye station');

console.log('    rail vs glass base: worst ' + railWorst.toFixed(4) + ' m over ' + railN + ' stations · aperture '
  + (clearPct * 100).toFixed(0) + '% clear · under-rail ' + under + '/' + (baseline.length * 2) + ' · bow worst ' + bowWorst.toFixed(3) + ' m');
// 5. THE GLASS FILM (profile.glass): one pane per exterior glass facet plus the HUD combiner,
//    each within 2 cm of the facet it stands for, finite, inside the bounds, and NOT in shellFaces.
const G = typeof P.glass === 'function' ? P.glass({}) : P.glass;
ok(Array.isArray(G) && G.length === glass.length + 1, 'glass panes ' + (G && G.length) + ' ≠ exterior facets ' + glass.length + ' + the combiner');
const cen = (pts) => pts.reduce((a, q) => [a[0] + q[0] / pts.length, a[1] + q[1] / pts.length, a[2] + q[2] / pts.length], [0, 0, 0]);
const used = new Set();
let paneWorst = 0, badPane = 0;
for (const f of glass) {
  const s = toShell(cen(f.p));
  let bi = -1, bd = Infinity;
  (G || []).forEach((pn, i) => { if (used.has(i)) return; const c = cen(pn); const d = Math.hypot(c[0] - s[0], c[1] - s[1], c[2] - s[2]); if (d < bd) { bd = d; bi = i; } });
  if (bi >= 0) used.add(bi);
  paneWorst = Math.max(paneWorst, bd);
}
ok(paneWorst < 0.02, 'an exterior glass facet has no pane within 2 cm: worst ' + paneWorst.toFixed(3) + ' m');
for (const pn of G || []) {
  if (!Array.isArray(pn) || pn.length < 3) badPane++;
  for (const q of pn || []) if (!Number.isFinite(q[0] + q[1] + q[2]) || q[0] < B[0] || q[0] > B[3] || q[1] < B[1] || q[1] > B[4] || q[2] < B[2] || q[2] > B[5]) badPane++;
}
ok(badPane === 0, badPane + ' glass points non-finite or outside the bounds');
const key = (pts) => pts.map((q) => q.map((v) => v.toFixed(5)).join(',')).join(';');
const paneKeys = new Set((G || []).map(key));
ok(!rest.some((f) => paneKeys.has(key(f.p))), 'a glass pane was put into shellFaces — it would block the sight lines');
console.log('    glass: ' + (G ? G.length : 0) + ' panes, worst ' + paneWorst.toFixed(4) + ' m from its exterior facet');

console.log('\n' + (fails ? fails + ' of ' + checks + ' checks FAILED' : checks + '/' + checks + ' passed'));
process.exit(fails ? 1 : 0);
