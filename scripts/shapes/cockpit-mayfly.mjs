// THE GATE FOR THE MAYFLY'S COCKPIT (a Cessna 172, client/shared/interior-mayfly.js).
//
// Three questions, each asked as arithmetic:
//   (a) is it a room you can sit in and see out of — shell.mjs's rays, at rest and with every control
//       at both of its stops, since a yoke hauled back is exactly the thing that could cross a window;
//   (b) does the inside match the outside — every glass face the EXTERIOR compiles must be open from
//       the eye, and every solid cabin face must be walled. ⚠ The exterior is compiled here from its
//       own emitter (compileMesh) and never read through the profile, or the check would be the
//       profile agreeing with itself;
//   (c) does every control move — the geometry must differ between a control's two stops.
// Run: node scripts/shapes/cockpit-mayfly.mjs   (exit 1 on any failure)
import { shellFaces, shellBounds, freezeFaces } from '../../client/shared/interior-shell.js';
import { mayflyProfile, M_PER_UNIT, MAYFLY_EYE } from '../../client/shared/interior-mayfly.js';
import { compileMesh, meshSource } from '../../client/shared/vehicle-mesh.js';
import { MESH_ROWS } from '../../client/shared/vehicle-meshes.js';

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('  FAIL  ' + msg); } };

// ── RAY / CONVEX POLYGON (shell.mjs's, unchanged) ────────────────────────────
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

const P = mayflyProfile();
ok(!!P, 'the profile did not build');
if (!P) process.exit(1);
const B = shellBounds(P);

// ── (a) THE ROOM, AT REST AND AT EVERY STOP ──────────────────────────────────
const REST = { ias: 90, alt: 3500, vsi: 0, pitch: 2, bank: 0, hdg: 90, rpm: 0.8, oilTemp: 0.5, fuel: 0.7, hull: 1,
  throttle: 0.7, flapNotch: 0, rudder: 0, trim: 0, stickX: 0, stickY: 0, powered: true, landingLight: false, dome: false,
  hour: 12, courseErr: 0, bingo: false };
// Each control and its two stops.
const STOPS = {
  stickX: [-1, 1], stickY: [-1, 1], rudder: [-1, 1], throttle: [0, 1], flapNotch: [0, 3], trim: [-1, 1],
  rpm: [0, 1], ias: [0, 200], alt: [0, 9500], vsi: [-2000, 2000], hdg: [0, 180], pitch: [-25, 25], bank: [-45, 45],
  fuel: [0, 1], oilTemp: [0, 1], hull: [0.1, 1], powered: [false, true], dome: [false, true],
  landingLight: [false, true], hour: [12, 23], courseErr: [-10, 10], bingo: [false, true],
};
function roomChecks(tag, live) {
  const faces = freezeFaces(shellFaces(P, live));
  const inside = B[0] < -0.05 && B[1] < -0.05 && B[2] < -0.05 && B[3] > 0.05 && B[4] > 0.05 && B[5] > 0.05;
  ok(inside, tag + ': the eye is not strictly inside the shell');
  ok(!cast(faces, [0, 1, 0]), tag + ': something is across the windscreen straight ahead');
  const wy = (P.winY[0] + P.winY[1]) / 2, wz = (P.winZ[0] + P.winZ[1]) / 2;
  const xL = P.xCentre - P.halfW, xR = P.xCentre + P.halfW;
  ok(!cast(faces, [xL, wy, wz]), tag + ': the left side window is not clear');
  ok(!cast(faces, [xR, wy, wz]), tag + ': the right side window is not clear');
  const footwell = [2 * P.xCentre, (P.seatY[1] + P.dashY) / 2, 0];
  ok(castFrom(faces, footwell, [0, 0, -1]), tag + ': NO FLOOR under the passenger footwell');
  ok(cast(faces, [0, 0, 1]), tag + ': NO ROOF straight up');
  ok(castFrom(faces, [0, 0, (P.backZ + P.roof) / 2], [0, -1, 0]), tag + ': NO REAR BULKHEAD');
  const low = P.winZ[0] - 0.2;
  ok(cast(faces, [xL, 0, low]), tag + ': NO LEFT DOOR CARD below the sill');
  ok(cast(faces, [xR, 0, low]), tag + ': NO RIGHT DOOR CARD below the sill');
  const down = cast(faces, [0, 0, -1]);
  ok(down > 0 && down < Math.abs(P.floor) - 1e-6, tag + ': the first thing under the eye is not a seat');
  let badN = 0, badP = 0, out = 0;
  for (const f of faces) {
    const L = f.n && Math.hypot(f.n[0], f.n[1], f.n[2]);
    if (!(Math.abs(L - 1) <= 1e-6)) badN++;
    if (!f.p || f.p.length < 3) badP++;
    for (const q of f.p || []) {
      if (!Number.isFinite(q[0] + q[1] + q[2])) badP++;
      if (q[0] < B[0] - 1e-6 || q[0] > B[3] + 1e-6 || q[1] < B[1] - 1e-6 || q[1] > B[4] + 1e-6 || q[2] < B[2] - 1e-6 || q[2] > B[5] + 1e-6) out++;
    }
  }
  ok(badN === 0, tag + ': ' + badN + ' faces with a missing or non-unit normal');
  ok(badP === 0, tag + ': ' + badP + ' degenerate or non-finite polygons');
  ok(out === 0, tag + ': ' + out + ' vertices outside the shell bounds');
  return faces;
}
const restFaces = roomChecks('rest', REST);
console.log('rest: ' + restFaces.length + ' faces, ' + cast(restFaces, [0, 0, -1]).toFixed(2) + ' m to the seat');
ok(restFaces.length >= 4000 && restFaces.length <= 12000, 'face count ' + restFaces.length + ' outside 4,000-12,000');
ok(roomChecks('bare', null).length > 0, 'no live object builds nothing');

// ── (c) EVERY CONTROL AT BOTH STOPS, AND IT MOVES ────────────────────────────
const sig = (faces) => faces.map((f) => f.p.map((q) => q.map((v) => v.toFixed(5)).join(',')).join(';') + (f.rgb ? '|' + f.rgb.join(',') + ':' + (f.emis || 0) : '')).join('\n');
for (const [k, [lo, hi]] of Object.entries(STOPS)) {
  const a = roomChecks(k + '=' + lo, { ...REST, [k]: lo });
  const b = roomChecks(k + '=' + hi, { ...REST, [k]: hi });
  ok(sig(a) !== sig(b), k + ': nothing in the cockpit changes between ' + lo + ' and ' + hi);
}

// ── (b) THE INSIDE MATCHES THE OUTSIDE ───────────────────────────────────────
// The exterior, compiled by its own emitter, in the same one scale the interior states.
const { faces: ext } = compileMesh(MESH_ROWS.ultralight);
const src = meshSource(ext) || [];
const [fE, gE, hE] = MAYFLY_EYE, m = M_PER_UNIT;
const toShell = (q) => [(q[1] - gE) * m, (q[0] - fE) * m, (q[2] - hE) * m];
// The room's lining, floor and ends: no seat, no yoke, no dial, and not the reveal, which is the aperture's own edge.
const walls = P.mayfly.faces.filter((f) => f.part !== 'reveal');
const fB = -0.28, fF = 0.46;
const centroid = (p) => p.reduce((s, q) => [s[0] + q[0] / p.length, s[1] + q[1] / p.length, s[2] + q[2] / p.length], [0, 0, 0]);
// ⚠ TOLERANCE: a glass face is sampled at its centre and at points 85% of the way to each corner,
// so the cut aperture must reach within 15% of the exterior pane's own edge all the way round. Each
// point is taken 35 mm in from the pane, radially, which is the skin: a pane seen from inside at a
// grazing angle is behind its own lining's edge, and that is a wall thickness, not a wall.
const TOL = 0.85, SKIN_U = 0.035 / M_PER_UNIT;
const inward = (q) => { const d = [0, q[1], q[2] - 0.02], L = Math.hypot(d[1], d[2]) || 1; return [q[0], q[1] - d[1] / L * SKIN_U, q[2] - d[2] / L * SKIN_U]; };
let glassN = 0, solidN = 0;
ext.forEach((f, i) => {
  if (src[i] !== 'parts[0]') return;                   // the fuselage loft only
  const c = centroid(f.p);
  if (!(c[0] < fF - 1e-6 && c[0] > fB + 1e-6)) return;
  if (f.role === 'glass') {
    glassN++;
    const pts = [c, ...f.p.map((q) => [c[0] + (q[0] - c[0]) * TOL, c[1] + (q[1] - c[1]) * TOL, c[2] + (q[2] - c[2]) * TOL])];
    for (const q of pts) {
      const t = cast(walls, toShell(inward(q)));
      ok(!t || t >= 1, 'exterior glass face ' + i + ' is walled over from inside at ' + q.map((v) => v.toFixed(3)).join(','));
    }
  } else {
    // A solid bay above the floor must be walled. ⚠ CAST FROM THE SECTION'S AXIS, not the eye: from
    // the seat a bay beside a window can be seen THROUGH that window at a grazing angle, which says
    // nothing about whether the bay itself is lined.
    const s = toShell(c);
    if (s[2] < P.floor + 0.02) return;
    solidN++;
    const o = toShell([c[0], 0, 0.04]);
    const t = castFrom(walls, o, [s[0] - o[0], s[1] - o[1], s[2] - o[2]]);
    ok(t > 0 && t < 1, 'exterior solid face ' + i + ' has no lining inside it: the cabin shows the sky there');
  }
});
// How many glass faces the exterior's own regions list over the cabin: every (station, side) pair.
const fus = MESH_ROWS.ultralight.parts.find((p) => p.name === 'fuselage'), sts = fus.stations.map((s) => s.f).sort((a, b) => b - a);
const want = new Set();
for (const rg of fus.regions) if (rg.role === 'glass') for (const at of rg.at) if (at <= fF && at > fB && sts.indexOf(at) + 1 < sts.length && sts[sts.indexOf(at) + 1] >= fB) for (const k of rg.k) want.add(at + ':' + k);
ok(glassN === want.size, 'expected ' + want.size + ' cabin glass faces from the exterior regions, found ' + glassN);
// ── THE GLASS: one film pane per exterior glass face, in its aperture, never in shellFaces ──
{
  const panes = typeof P.glass === 'function' ? P.glass(REST) : P.glass;
  ok(Array.isArray(panes) && panes.length === want.size, 'expected ' + want.size + ' glass panes, found ' + (panes && panes.length));
  const pc = (panes || []).map(centroid);
  let bad = 0;
  for (const p of panes || []) for (const q of p) if (!Number.isFinite(q[0] + q[1] + q[2]) || q[0] < B[0] || q[0] > B[3] || q[1] < B[1] || q[1] > B[4] || q[2] < B[2] || q[2] > B[5]) bad++;
  ok(bad === 0, bad + ' glass points non-finite or outside the shell bounds');
  // Each exterior glass face has a pane whose centre is within 20 mm of it (the skin plus the 3 mm film offset).
  const used = new Set();
  ext.forEach((f, i) => {
    if (src[i] !== 'parts[0]' || f.role !== 'glass') return;
    const c = centroid(f.p);
    if (!(c[0] < fF - 1e-6 && c[0] > fB + 1e-6)) return;
    const s = toShell(c);
    let best = -1, bd = Infinity;
    pc.forEach((q, j) => { const d = Math.hypot(q[0] - s[0], q[1] - s[1], q[2] - s[2]); if (d < bd) { bd = d; best = j; } });
    ok(bd < 0.02, 'exterior glass face ' + i + ' has no pane within 20 mm (nearest ' + bd.toFixed(3) + ' m)');
    used.add(best);
  });
  ok(used.size === (panes || []).length, 'a glass pane matches no exterior glass face');
  const shell = shellFaces(P, REST);
  ok(!shell.some((f) => (panes || []).includes(f.p)), 'glass panes leaked into shellFaces');
}
ok(solidN > 30, 'too few solid cabin faces measured (' + solidN + ')');
console.log('matched ' + glassN + ' exterior glass faces open and ' + solidN + ' solid faces lined');

console.log('\n' + (checks - fails) + '/' + checks + ' checks passed');
if (fails) process.exit(1);
