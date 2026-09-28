// THE GATE FOR THE LOCUST'S COCKPIT (client/shared/interior-locust.js).
//
// Three questions. (a) Is it a room you can sit in and see out of — shell.mjs's own rays, at rest
// and with every control at both stops. (b) Is the INSIDE the OUTSIDE — the canopy cage is held
// against the glass faces the exterior actually draws (aircraftFaces), measured here and not
// through the profile, so a room that quietly stopped reading the airframe fails. (c) Does every
// control move — geometry at one stop must differ from the other.
//
// node scripts/shapes/cockpit-locust.mjs   (exit 1 on failure)
import { shellFaces, shellBounds } from '../../client/shared/interior-shell.js';
import { locustProfile, LOCUST_TRIM } from '../../client/shared/interior-locust.js';
import { aircraftFaces } from '../../client/game/js/panels/aircraft3d.js';

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
const castFrom = (faces, o, d) => { let best = 0; for (const f of faces) { const t = rayHitsPoly(o, d, f.p); if (t && (!best || t < best)) best = t; } return best; };
const cast = (faces, d) => castFrom(faces, [0, 0, 0], d);

const P = locustProfile();
ok(!!P, 'locustProfile() returned nothing');
const B = shellBounds(P);

// ── (a) THE ROOM, AT REST AND AT EVERY STOP ──────────────────────────────────
const STOPS = {
  stickX: [-1, 1], stickY: [-1, 1], rudder: [-1, 1], throttle: [0, 1], flapNotch: [0, 3], trim: [-1, 1],
  spraying: [false, true], dumping: [false, true], hopper: [0, 1], courseErr: [-20, 20],
  ias: [0, 130], alt: [0, 950], vsi: [-2000, 2000], rpm: [0, 1], fuel: [0, 1], oilTemp: [0, 1],
  pitch: [-25, 25], bank: [-45, 45], hdg: [0, 90], powered: [false, true], landingLight: [false, true],
  dome: [false, true], stall: [false, true],
};
const REST = { powered: true, hour: 22 };
function roomChecks(tag, faces) {
  const inside = B[0] < -0.05 && B[1] < -0.05 && B[2] < -0.05 && B[3] > 0.05 && B[4] > 0.05 && B[5] > 0.05;
  ok(inside, tag + ': the eye is not strictly inside the shell ' + B.map((n) => n.toFixed(2)).join(' '));
  ok(!cast(faces, [0, 1, 0]), tag + ': something is across the windscreen');
  const wy = (P.winY[0] + P.winY[1]) / 2, wz = (P.winZ[0] + P.winZ[1]) / 2;
  const xL = P.xCentre - P.halfW, xR = P.xCentre + P.halfW;
  ok(!castFrom(faces, [0, 0, 0], [xL, wy, wz]), tag + ': the left side glass is blocked');
  ok(!castFrom(faces, [0, 0, 0], [xR, wy, wz]), tag + ': the right side glass is blocked');
  const footwell = [2 * P.xCentre, (P.seatY[1] + P.dashY) / 2, 0];
  ok(castFrom(faces, footwell, [0, 0, -1]), tag + ': NO FLOOR');
  ok(!cast(faces, [0, 0, 1]), tag + ': something is across the canopy straight overhead');
  ok(castFrom(faces, [0, 0, (P.backZ + P.roof) / 2], [0, -1, 0]), tag + ': NO REAR BULKHEAD');
  const low = P.winZ[0] - 0.2;
  ok(castFrom(faces, [0, 0, 0], [xL, 0, low]), tag + ': NO LEFT WALL below the sill');
  ok(castFrom(faces, [0, 0, 0], [xR, 0, low]), tag + ': NO RIGHT WALL below the sill');
  const down = cast(faces, [0, 0, -1]);
  ok(down > 0 && down < Math.abs(P.floor) - 1e-6, tag + ': nothing to sit on');
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
  ok(badN === 0, tag + ': ' + badN + ' non-unit normals');
  ok(badP === 0, tag + ': ' + badP + ' degenerate or NaN polygons');
  ok(out === 0, tag + ': ' + out + ' vertices outside the bounds');
  return down;
}
const rest = shellFaces(P, REST);
const down = roomChecks('rest', rest);
ok(roomChecks('no live', shellFaces(P, null)) > 0, 'no live: builds');
for (const [k, [a, b]] of Object.entries(STOPS)) {
  roomChecks(k + '=' + a, shellFaces(P, { ...REST, [k]: a }));
  roomChecks(k + '=' + b, shellFaces(P, { ...REST, [k]: b }));
}
ok(rest.length >= 4000 && rest.length <= 12000, 'face count ' + rest.length + ' outside 4000–12000');

// ── (b) THE INSIDE IS THE OUTSIDE ────────────────────────────────────────────
// The exterior's own glass, in model units, converted with the profile's ONE stated scale and eye.
const D = P.locust;
const glass = aircraftFaces('locust', 1).filter((f) => f.role === 'glass');
ok(glass.length > 0, 'the exterior has no canopy glass to measure');
let gf0 = Infinity, gf1 = -Infinity, gW = 0, gTop = -Infinity, gBase = Infinity;
for (const f of glass) for (const [fq, g, h] of f.p) {
  gf0 = Math.min(gf0, fq); gf1 = Math.max(gf1, fq); gW = Math.max(gW, Math.abs(g)); gTop = Math.max(gTop, h); gBase = Math.min(gBase, h);
}
const ext = { yFront: D.Y(gf1), yRear: D.Y(gf0), halfW: D.X(gW), top: D.Z(gTop), base: D.Z(gBase) };
// The interior's cage, measured off its rims.
const rims = D.canopyRims;
const front = rims.reduce((a, r) => (r.f > a.f ? r : a)), rear = rims.reduce((a, r) => (r.f < a.f ? r : a));
const allRim = rims.flatMap((r) => r.rim);
const inn = {
  yFront: front.rim[0][1], yRear: rear.rim[0][1],
  halfW: Math.max(...allRim.map((q) => Math.abs(q[0]))), top: Math.max(...allRim.map((q) => q[2])),
  base: Math.min(...allRim.map((q) => q[2])),
};
const TOL = 0.06;   // a frame 18 mm inside a skin, plus the rod's own radius and the post offset
for (const k of Object.keys(ext)) {
  ok(Math.abs(ext[k] - inn[k]) <= TOL, 'canopy ' + k + ': cage ' + inn[k].toFixed(3) + ' vs exterior glass ' + ext[k].toFixed(3));
}
// The sill: where the glass meets the fuselage is the top of the tub walls — no wall above it.
let wallAboveSill = 0;
for (const f of rest) if ((f.rgb === LOCUST_TRIM.skin || f.rgb === LOCUST_TRIM.skinDk) && f.p.every((q) => Math.abs(q[0]) < ext.halfW - 0.07 && q[2] > ext.base + 0.03 && q[1] > ext.yRear + 0.1 && q[1] < ext.yFront - 0.1 && q[2] < ext.top - 0.12)) wallAboveSill++;
ok(wallAboveSill === 0, wallAboveSill + ' wall faces stand inside the glass, above the sill');
// And the eye sits under the glass, the straight-ahead line clearing the exterior windscreen bow.
ok(ext.top > 0.1 && ext.base < -0.1, 'the eye is not between the canopy sill and its crown');

// ── (b2) THE GLASS: one pane per exterior glass facet, where that facet is ──
const cen = (pts) => pts.reduce((s, q) => [s[0] + q[0] / pts.length, s[1] + q[1] / pts.length, s[2] + q[2] / pts.length], [0, 0, 0]);
const panes = typeof P.glass === 'function' ? P.glass({}) : P.glass;
ok(Array.isArray(panes) && panes.length === glass.length, 'glass: ' + (panes ? panes.length : 0) + ' panes vs ' + glass.length + ' exterior glass facets');
const extC = glass.map((f) => { const c = cen(f.p); return [D.X(c[1]), D.Y(c[0]), D.Z(c[2])]; });
const used = new Set();
for (const c of extC) {
  let bi = -1, bd = Infinity;
  (panes || []).forEach((p, i) => { if (used.has(i)) return; const q = cen(p); const d = Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]); if (d < bd) { bd = d; bi = i; } });
  ok(bd <= 0.02, 'glass: no pane within 2 cm of the exterior facet at ' + c.map((v) => v.toFixed(2)).join(','));
  if (bi >= 0) used.add(bi);
}
let gBad = 0;
for (const p of panes || []) for (const q of p) if (!Number.isFinite(q[0] + q[1] + q[2]) || q[0] < B[0] - 1e-6 || q[0] > B[3] + 1e-6 || q[1] < B[1] - 1e-6 || q[1] > B[4] + 1e-6 || q[2] < B[2] - 1e-6 || q[2] > B[5] + 1e-6) gBad++;
ok(gBad === 0, 'glass: ' + gBad + ' points non-finite or outside the bounds');
const shellSet = new Set(rest.map((f) => f.p));
const shellC = rest.map((f) => cen(f.p));
ok(!(panes || []).some((p) => shellSet.has(p) || shellC.some((c) => { const q = cen(p); return Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) < 1e-4; })), 'glass: a pane is inside shellFaces');

// ── (c) EVERY CONTROL MOVES ──────────────────────────────────────────────────
const sig = (fs) => { let s = fs.length; for (const f of fs) for (const q of f.p) s = (s * 31 + q[0] * 1e4 + q[1] * 7e3 + q[2] * 3e3) % 1e12; for (const f of fs) if (f.rgb) s = (s * 17 + f.rgb[0] + (f.emis || 0) * 100) % 1e12; return s; };
for (const [k, [a, b]] of Object.entries(STOPS)) {
  ok(sig(shellFaces(P, { ...REST, [k]: a })) !== sig(shellFaces(P, { ...REST, [k]: b })), 'control/reading ' + k + ' does not change the cockpit between ' + a + ' and ' + b);
}

console.log('locust cockpit: ' + rest.length + ' faces, ' + down.toFixed(2) + ' m to the seat, M ' + D.M.toFixed(3) + ' m/u, '
  + (checks - fails) + '/' + checks + ' checks');
process.exit(fails ? 1 : 0);
