// THE GATE FOR THE CARCASS'S COCKPIT (client/shared/interior-carcass.js).
//
// Three things, each silent when wrong:
//   (a) the room is a room: the eye strictly inside, nothing outside the bounds, unit normals, no
//       NaN, the three sight lines clear (ahead, and through the open side of the cockpit each way),
//       floor, bulkhead and both side walls there, a seat under you nearer than the floor, and — an
//       open cockpit's roof is sky — straight up clear. At rest and with every control at each stop.
//   (b) the inside is the outside: the exterior tube is read here from the JSON file with its own
//       code, never through the profile, and the room's walls, skin and sill are held against it.
//   (c) every control moves: each one driven to both stops must change the geometry.
//
// Run: node scripts/shapes/cockpit-carcass.mjs   (exit 1 on any failure)
import { readFileSync } from 'node:fs';
import { carcassProfile, CARCASS } from '../../client/shared/interior-carcass.js';
import { shellFaces, shellBounds } from '../../client/shared/interior-shell.js';

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('  FAIL  ' + msg); } };

// ── RAYS (shell.mjs's own test, copied so this gate stands alone) ────────────
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

const P = carcassProfile();
ok(!!P, 'carcassProfile() built nothing');
if (!P) process.exit(1);
const B = shellBounds(P);

// ── (a) THE ROOM, AT REST AND AT EVERY STOP ──────────────────────────────────
const REST = { powered: true };
const STOPS = {
  stickX: [-1, 1], stickY: [-1, 1], rudder: [-1, 1], throttle: [0, 1], flapNotch: [0, 3], trim: [-1, 1],
  gearDown: [false, true], ias: [0, 200], alt: [0, 4321], vsi: [-2000, 2000], rpm: [0, 1], fuel: [0, 1],
  hull: [0, 1], pitch: [-30, 30], bank: [-60, 60], hdg: [0, 270], oilTemp: [0, 1], stall: [false, true],
  powered: [false, true], landingLight: [false, true], dome: [false, true],
};
function roomChecks(tag, live) {
  const faces = shellFaces(P, live);
  const inside = B[0] < -0.05 && B[1] < -0.05 && B[2] < -0.05 && B[3] > 0.05 && B[4] > 0.05 && B[5] > 0.05;
  ok(inside, tag + ': the eye is not strictly inside the bounds ' + B.map((n) => n.toFixed(2)).join(' '));
  let badN = 0, badP = 0, out = 0;
  for (const f of faces) {
    const L = f.n && Math.hypot(f.n[0], f.n[1], f.n[2]);
    if (!f.n || !Number.isFinite(L) || Math.abs(L - 1) > 1e-6) badN++;
    if (!f.p || f.p.length < 3) badP++;
    for (const q of f.p || []) {
      if (!Number.isFinite(q[0] + q[1] + q[2])) badP++;
      else if (q[0] < B[0] - 1e-6 || q[0] > B[3] + 1e-6 || q[1] < B[1] - 1e-6 || q[1] > B[4] + 1e-6 || q[2] < B[2] - 1e-6 || q[2] > B[5] + 1e-6) out++;
    }
  }
  ok(badN === 0, tag + ': ' + badN + ' missing or non-unit normals');
  ok(badP === 0, tag + ': ' + badP + ' degenerate or non-finite polygons');
  ok(out === 0, tag + ': ' + out + ' vertices outside the bounds');
  ok(!cast(faces, [0, 1, 0]), tag + ': something is across the forward view');
  const wy = (P.winY[0] + P.winY[1]) / 2, wz = (P.winZ[0] + P.winZ[1]) / 2;
  const xL = P.xCentre - P.halfW, xR = P.xCentre + P.halfW;
  ok(!castFrom(faces, [0, 0, 0], [xL, wy, wz]), tag + ': the left side of the cockpit is blocked');
  ok(!castFrom(faces, [0, 0, 0], [xR, wy, wz]), tag + ': the right side of the cockpit is blocked');
  ok(castFrom(faces, [2 * P.xCentre, (P.seatY[1] + P.dashY) / 2, 0], [0, 0, -1]), tag + ': NO FLOOR in the footwell');
  // ⚠ AND THE FLOOR ITSELF, not the stick standing on it: the shared footwell ray above lands on the
  // glove at the stick's foot, so deleting every floorboard left it green. Down the right footwell,
  // clear of the stick, the first hit must be at the floorboards' own height.
  const fw = castFrom(faces, [0.07, 0.40, 0], [0, 0, -1]);
  ok(Math.abs(fw + P.carcass.floorZ) < 0.01, tag + ': the right footwell has no floorboards (first hit ' + fw.toFixed(3) + ')');
  // The plywood bulkhead itself, behind the seat: the ray over the seat lands on the headrest cushion.
  const bh = castFrom(faces, [0.12, -0.55, P.carcass.floorZ + 0.15], [0, -1, 0]);
  ok(Math.abs(-0.55 - bh - P.carcass.Y(CARCASS.back)) < 0.01, tag + ': NO PLYWOOD BULKHEAD behind the seat (hit ' + bh.toFixed(3) + ')');
  ok(castFrom(faces, [0, 0, (P.backZ + P.roof) / 2], [0, -1, 0]), tag + ': NO BULKHEAD behind the head');
  ok(castFrom(faces, [0, 0, 0], [xL, 0, P.winZ[0] - 0.2]), tag + ': NO LEFT WALL below the sill');
  ok(castFrom(faces, [0, 0, 0], [xR, 0, P.winZ[0] - 0.2]), tag + ': NO RIGHT WALL below the sill');
  const down = cast(faces, [0, 0, -1]);
  ok(down > 0 && down < Math.abs(P.floor) - 1e-6, tag + ': the first thing under the eye is the floor');
  // An open cockpit: the sky straight overhead, which is what `roofGlass` states.
  ok(!!P.roofGlass && !cast(faces, [0, 0, 1]), tag + ': something is overhead in an open cockpit');
  return faces;
}
console.log('carcass — ' + P.label);
const rest = roomChecks('rest', REST);
for (const [k, [a, b]] of Object.entries(STOPS)) { roomChecks(k + '=' + a, { ...REST, [k]: a }); roomChecks(k + '=' + b, { ...REST, [k]: b }); }
ok(rest.length >= 4000 && rest.length <= 12000, 'face budget: ' + rest.length + ' (want 4,000-12,000)');

// ── (b) THE INSIDE IS THE OUTSIDE ────────────────────────────────────────────
// The exterior, read raw from its content file with this file's own code.
const doc = JSON.parse(readFileSync('content/vehicle_models/mesh_wreck.json', 'utf8')).params;
const body = doc.parts.find((p) => p.faces.some((f) => f.role === 'body'));
const vs = body.faces.flatMap((f) => f.p);
const fMin = Math.min(...vs.map((v) => v[0])), fMax = Math.max(...vs.map((v) => v[0]));
const m = CARCASS.realLengthM / (fMax - fMin);
ok(Math.abs(P.carcass.m - m) < 1e-9, 'metres per unit disagrees with length / loft length: ' + P.carcass.m + ' vs ' + m);
// The half-width and crown of the exterior at a station, by linear interpolation of each station's
// extreme — which is exact for a loft of straight quads at its widest vertex.
const stations = [...new Set(vs.map((v) => v[0]))].sort((a, b) => a - b);
const ext = (f, pick) => {
  let i = 0; while (i < stations.length - 2 && stations[i + 1] < f) i++;
  const a = stations[i], b = stations[i + 1], t = (f - a) / (b - a);
  const at = (s) => pick(vs.filter((v) => v[0] === s));
  return at(a) + (at(b) - at(a)) * t;
};
const halfWAt = (f) => ext(f, (r) => Math.max(...r.map((v) => Math.abs(v[1]))));
const crownAt = (f) => ext(f, (r) => Math.max(...r.map((v) => v[2])));
const Y = (f) => (f - CARCASS.eyeF) * m;
const hE = P.carcass.hE;
// Every vertex of the room's inner wall and of its outside skin, held against the exterior at that
// vertex's own station: no wall may stand outside the tube, and at each station band the widest one
// must reach it (the inner wall less exactly one wall thickness).
const band = (sel, wall) => {
  let over = 0; const best = new Map();
  for (const x of P.carcass.faces.filter(sel)) for (const q of x.p) {
    const f = q[1] / m + CARCASS.eyeF; if (f < fMin || f > fMax) continue;
    const want = halfWAt(f) * m - wall, d = Math.abs(q[0]) - want;
    if (d > 0.002) over++;
    const k = Math.round(f * 20); best.set(k, Math.max(best.get(k) ?? -1, d));
  }
  return { over, worst: Math.min(...[...best.values()]), n: best.size };
};
const inW = band((x) => x.tone === 'pil' && x.mat && x.mat.grain === 0.3, CARCASS.wallM);
const outW = band((x) => x.mat && x.mat.spec === 0.25, 0);
ok(inW.n > 10 && inW.over === 0 && inW.worst > -0.008, 'the inner wall is not the exterior tube less one wall: ' + JSON.stringify(inW));
ok(outW.n > 10 && outW.over === 0 && outW.worst > -0.008, 'the outside skin is not the exterior tube: ' + JSON.stringify(outW));
// The crown of the outside skin, ahead of the windscreen, is the exterior crown.
for (const f of [0.25, 0.40, 0.60]) {
  const y = Y(f);
  const top = P.carcass.faces.filter((x) => x.mat && x.mat.spec === 0.25).flatMap((x) => x.p).filter((q) => Math.abs(q[1] - y) < 0.12 && Math.abs(q[0]) < 0.01);
  const zc = Math.max(...top.map((q) => q[2] - ((crownAt(q[1] / m + CARCASS.eyeF) - hE) * m)).map(Math.abs));
  ok(top.length > 0 && zc < 0.004, 'f ' + f + ': the outside crown is not the exterior crown (' + zc + ')');
}
// The inside width against the real aircraft: a Fly Baby is about 22.5 in (0.571 m) inside.
const wEye = (halfWAt(CARCASS.eyeF) * m - CARCASS.wallM) * 2;
ok(Math.abs(wEye - 0.5715) < 0.03, 'inside width at the eye ' + wEye.toFixed(3) + ' m is not a Fly Baby\'s 0.57');
// The opening is cut out of the tube: the sill is below the exterior crown and above the belly all
// along it, and the coaming's reveal reaches exactly the exterior skin.
for (const f of [CARCASS.open[0] + 0.01, 0, CARCASS.open[1] - 0.01]) {
  const crownZ = (crownAt(f) - hE) * m;
  ok(P.carcass.sillZ < crownZ - 0.05 && P.carcass.sillZ > P.carcass.floorZ + 0.3, 'f ' + f + ': the sill is not cut through the upper tube');
}
const reveal = P.carcass.faces.filter((x) => x.n[2] === 1 && x.rgb && Math.abs(x.p[0][2] - P.carcass.sillZ) < 1e-9 && x.tone === 'pil');
let revErr = 0;
for (const x of reveal) for (const q of [x.p[2], x.p[3]]) {
  const f = q[1] / m + CARCASS.eyeF, hs = q[2] / m + hE;
  // Exterior half-width at the sill height: this station's widest, less how far the section curves in.
  revErr = Math.max(revErr, Math.abs(Math.abs(q[0]) / m) > halfWAt(f) + 1e-6 ? 1 : 0);
}
ok(reveal.length > 10 && revErr === 0, 'the sill reveal does not end at the exterior skin (' + reveal.length + ' faces)');
// The floor is inside the belly: above the exterior's lowest point at the eye.
const bellyZ = (Math.min(...vs.filter((v) => Math.abs(v[0]) < 1e-9).map((v) => v[2])) - hE) * m;
ok(P.carcass.floorZ > bellyZ + CARCASS.wallM * 0.5, 'the floor is below the exterior belly');

// ── (c) EVERY CONTROL MOVES ──────────────────────────────────────────────────
const sig = (faces) => { let s = 0, k = 0; for (const f of faces) { for (const q of f.p) s += (q[0] * 1.3 + q[1] * 2.1 + q[2] * 3.7) * (++k % 7 + 1); s += (f.emis || 0) * 11 * k; } return s; };
for (const [k, [a, b]] of Object.entries(STOPS)) {
  const A = sig(shellFaces(P, { ...REST, [k]: a })), Bv = sig(shellFaces(P, { ...REST, [k]: b }));
  ok(Math.abs(A - Bv) > 1e-6, 'control ' + k + ' does not move anything between ' + a + ' and ' + b);
}
// And the geometric ones move GEOMETRY, not only a lamp.
const geo = (faces) => { let s = 0, k = 0; for (const f of faces) for (const q of f.p) s += (q[0] * 1.3 + q[1] * 2.1 + q[2] * 3.7) * (++k % 7 + 1); return s; };
for (const k of ['stickX', 'stickY', 'rudder', 'throttle', 'flapNotch', 'trim', 'fuel', 'bank', 'pitch', 'ias', 'alt', 'vsi', 'rpm', 'hdg', 'hull', 'oilTemp', 'landingLight', 'dome', 'powered']) {
  const [a, b] = STOPS[k];
  ok(Math.abs(geo(shellFaces(P, { ...REST, [k]: a })) - geo(shellFaces(P, { ...REST, [k]: b }))) > 1e-6, 'control ' + k + ' changes no geometry');
}
// ── (d) THE GLASS ─────────────────────────────────────────────────────────────
// ⚠ THE EXTERIOR HAS NO GLASS (buildWreck strips it), so the panes are matched against the
// windscreen FRAME the fit-out draws instead: its steel posts are found in shellFaces here and the
// frame's plane and extent measured off them, not read from the profile.
{
  const G = P.glass;
  ok(Array.isArray(G) && G.length === 2, 'want the two perspex shards still in the frame, got ' + (G && G.length));
  const steel = shellFaces(P, REST).filter((x) => x.rgb && x.rgb[0] === 96 && x.rgb[1] === 100 && x.p.every((q) => Math.abs(q[1] - P.carcass.glareY) < 0.1 && q[2] > P.carcass.glareZ - 0.03 && q[2] < 0.1));
  const fp = steel.flatMap((x) => x.p);
  ok(fp.length > 20, 'no windscreen frame found to match the glass against');
  const fx = Math.max(...fp.map((q) => Math.abs(q[0]))), zb = Math.min(...fp.map((q) => q[2])), zt = Math.max(...fp.map((q) => q[2]));
  const lo = fp.filter((q) => q[2] < zb + 0.01), hi = fp.filter((q) => q[2] > zt - 0.01);
  const yLo = lo.reduce((s2, q) => s2 + q[1], 0) / lo.length, yHi = hi.reduce((s2, q) => s2 + q[1], 0) / hi.length;
  const planeY = (z) => yLo + (yHi - yLo) * (z - zb) / (zt - zb);
  const rest = shellFaces(P, REST);
  for (const [i, pane] of (G || []).entries()) {
    ok(pane.length >= 3 && pane.every((q) => q.every(Number.isFinite)), 'pane ' + i + ' is degenerate or non-finite');
    ok(pane.every((q) => q[0] >= B[0] && q[0] <= B[3] && q[1] >= B[1] && q[1] <= B[4] && q[2] >= B[2] && q[2] <= B[5]), 'pane ' + i + ' is outside the bounds');
    ok(pane.every((q) => Math.abs(q[0]) <= fx + 0.005 && q[2] >= zb - 0.005 && q[2] <= zt + 0.005), 'pane ' + i + ' is outside the windscreen frame');
    ok(pane.every((q) => Math.abs(q[1] - planeY(q[2])) < 0.012), 'pane ' + i + ' is not in the plane of the frame');
    // Convex: every turn the same way, in the frame's (x, z).
    let sg = 0, convex = true;
    for (let k = 0; k < pane.length; k++) { const a = pane[k], b = pane[(k + 1) % pane.length], c = pane[(k + 2) % pane.length];
      const cr = (b[0] - a[0]) * (c[2] - b[2]) - (b[2] - a[2]) * (c[0] - b[0]); if (Math.abs(cr) < 1e-12) continue; const g2 = Math.sign(cr); if (!sg) sg = g2; else if (g2 !== sg) convex = false; }
    ok(convex, 'pane ' + i + ' is not convex');
    ok(!rest.some((x) => x.p.length === pane.length && x.p.every((q, k) => q === pane[k] || (q[0] === pane[k][0] && q[1] === pane[k][1] && q[2] === pane[k][2]))), 'pane ' + i + ' is in shellFaces — glass must not be');
    // The middle of the frame is open: no pane crosses the eye's straight-ahead line.
    ok(!rayHitsPoly([0, 0, 0], [0, 1, 0], pane), 'pane ' + i + ' is across the straight-ahead view, where the perspex is gone');
  }
}
// Hotspots stay inside the room.
for (const h of P.hotspots(REST)) ok(h.p.every(Number.isFinite) && h.p[0] > B[0] && h.p[0] < B[3] && h.p[2] > B[2] && h.p[2] < B[5], 'hotspot ' + h.id + ' is outside the room');

console.log('    ' + rest.length + ' faces · ' + (B[4] - B[1]).toFixed(2) + ' m long, ' + (B[3] - B[0]).toFixed(2) + ' wide · m/unit ' + m.toFixed(4) + ' · inside width ' + wEye.toFixed(3));
console.log(fails ? fails + ' of ' + checks + ' checks FAILED' : checks + '/' + checks + ' passed');
process.exit(fails ? 1 : 0);
