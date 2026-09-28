// THE VIPER'S COCKPIT, GATED (client/shared/interior-viper.js).
//
// Three things, each of which fails silently in the seat:
//   (a) the shell.mjs checks — eye in a room, the sight lines, floor/roof/bulkhead/door cards, a
//       seat under you, unit normals, nothing outside the bounds — at rest AND with every control at
//       both of its stops, because a cyclic thrown full forward is the one that goes through the panel;
//   (b) the INSIDE matches the OUTSIDE — measured off the exterior mesh's own compiled faces, never
//       off the profile: every glazed facet of the fuselage over the room can be seen out through,
//       every solid facet can't, and every glazed facet's corner is a corner of the room's reveal;
//   (c) every control actually moves — the geometry differs between its two stops.
//
// Run: node scripts/shapes/cockpit-viper.mjs   (exit 1 on any failure)
import { shellFaces, shellBounds } from '../../client/shared/interior-shell.js';
import { viperProfile, VIPER_CABIN, VIPER_FRAME } from '../../client/shared/interior-viper.js';
import { compileMesh, meshSource } from '../../client/shared/vehicle-mesh.js';
import { MESH_ROWS } from '../../client/shared/vehicle-meshes.js';

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('  FAIL  ' + msg); } };

// ── RAY / CONVEX POLYGON — shell.mjs's own, unchanged ──
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

const P = viperProfile();
ok(!!P, 'viperProfile() returned nothing');
if (!P) process.exit(1);

// ── (a) THE SHELL CHECKS, AT REST AND AT EVERY STOP ──
function shellChecks(tag, live) {
  const faces = shellFaces(P, live);
  const B = shellBounds(P);
  ok(faces.length > 0, tag + ': no geometry');
  ok(B[0] < -0.05 && B[1] < -0.05 && B[2] < -0.05 && B[3] > 0.05 && B[4] > 0.05 && B[5] > 0.05, tag + ': eye not strictly inside ' + B.map((n) => n.toFixed(2)).join(' '));
  ok(!cast(faces, [0, 1, 0]), tag + ': something is across the forward view');
  const wy = (P.winY[0] + P.winY[1]) / 2, wz = (P.winZ[0] + P.winZ[1]) / 2;
  const xL = P.xCentre - P.halfW, xR = P.xCentre + P.halfW;
  ok(!castFrom(faces, [0, 0, 0], [xL, wy, wz]), tag + ': the left side window is not a hole');
  ok(!castFrom(faces, [0, 0, 0], [xR, wy, wz]), tag + ': the right side window is not a hole');
  const footwell = [2 * P.xCentre, (P.seatY[1] + P.dashY) / 2, 0];
  const overHead = [0, 0, (P.backZ + P.roof) / 2];
  ok(castFrom(faces, footwell, [0, 0, -1]), tag + ': NO FLOOR down the footwell');
  if (P.roofGlass) ok(!cast(faces, [0, 0, 1]), tag + ': something is across the canopy straight overhead');
  else ok(cast(faces, [0, 0, 1]), tag + ': NO ROOF');
  ok(castFrom(faces, overHead, [0, -1, 0]), tag + ': NO REAR BULKHEAD');
  const low = P.winZ[0] - 0.2;
  ok(castFrom(faces, [0, 0, 0], [xL, 0, low]), tag + ': NO LEFT DOOR CARD below the window line');
  ok(castFrom(faces, [0, 0, 0], [xR, 0, low]), tag + ': NO RIGHT DOOR CARD below the window line');
  const down = cast(faces, [0, 0, -1]);
  ok(down > 0 && down < Math.abs(P.floor) - 1e-6, tag + ': the first thing under the eye is the floor');
  let badN = 0, badP = 0, out = 0;
  for (const f of faces) {
    const L = f.n && Math.hypot(f.n[0], f.n[1], f.n[2]);
    if (!f.n || !Number.isFinite(L) || Math.abs(L - 1) > 1e-6) badN++;
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

const REST = { powered: true, rpm: 1, throttle: 0.5, fuel: 0.7, hull: 1, ias: 90, alt: 1200, hdg: 45, pitch: 3, bank: 5, vsi: 200, hour: 12 };
const rest = shellChecks('rest', REST);
console.log('viper: ' + rest.length + ' faces at rest');
ok(rest.length >= 4000 && rest.length <= 12000, 'face count ' + rest.length + ' is outside the 4,000–12,000 budget');

// Every control, at both of its stops.
const STOPS = {
  cyclic: [{ stickX: -1, stickY: -1 }, { stickX: 1, stickY: 1 }],
  cyclicX: [{ stickX: -1 }, { stickX: 1 }],
  cyclicY: [{ stickY: -1 }, { stickY: 1 }],
  pedals: [{ rudder: -1 }, { rudder: 1 }],
  collective: [{ throttle: 0 }, { throttle: 1 }],
  powerLevers: [{ powered: false }, { powered: true, rpm: 1 }],
  powerIdle: [{ rpm: 0 }, { rpm: 1 }],
  searchlight: [{ landingLight: false }, { landingLight: true }],
  utility: [{ dome: false }, { dome: true }],
  masterArm: [{ armed: false }, { armed: true }],
  attitude: [{ pitch: -30, bank: -60 }, { pitch: 30, bank: 60 }],
  heading: [{ hdg: 0 }, { hdg: 180 }],
  airspeed: [{ ias: 0 }, { ias: 180 }],
  altimeter: [{ alt: 0 }, { alt: 5555 }],
  vsi: [{ vsi: -3000 }, { vsi: 3000 }],
  fuel: [{ fuel: 0.05 }, { fuel: 1 }],
  hull: [{ hull: 0.1 }, { hull: 1 }],
  night: [{ hour: 12 }, { hour: 23 }],
};
const sig = (faces) => {
  let h = 0;
  for (const f of faces) {
    for (const q of f.p) h = (h * 31 + Math.round(q[0] * 1e4) * 7 + Math.round(q[1] * 1e4) * 13 + Math.round(q[2] * 1e4) * 17) % 2147483647;
    if (f.rgb) h = (h * 31 + f.rgb[0] + f.rgb[1] * 3 + f.rgb[2] * 5 + Math.round((f.emis || 0) * 100)) % 2147483647;
  }
  return faces.length + ':' + h;
};
// ⚠ Switch throws ease over wall time (interior-cockpit-kit.js), so each stop is built a few times
// with a pause between, until the throw has settled, before its geometry is taken.
const settle = (live) => { let f; const t0 = Date.now(); for (let i = 0; i < 40; i++) { f = shellFaces(P, live); while (Date.now() - t0 < i * 12); } return f; };
for (const [name, [a, b]] of Object.entries(STOPS)) {
  const fa = shellChecks(name + '@lo', { ...REST, ...a });
  const fb = shellChecks(name + '@hi', { ...REST, ...b });
  const sa = sig(settle({ ...REST, ...a })), sb = sig(settle({ ...REST, ...b }));
  ok(sa !== sb, name + ': the geometry is identical at both stops — the control does not move');
  void fa; void fb;
}

// ── (b) THE INSIDE MATCHES THE OUTSIDE ──
// The exterior's own compiled fuselage, unscaled back to model units, taken into shell metres with
// the cabin anchor (the conversion is shared; the SHAPE is not).
{
  const row = MESH_ROWS.heli_armed, sc = row.scale || 1;
  const comp = compileMesh(row), src = meshSource(comp.faces);
  const m = VIPER_CABIN.realLengthM / ((row.rotors[0].at[0] + row.rotors[0].r) - (row.rotors[1].at[0] - row.rotors[1].r));
  ok(Math.abs(m - P.viper.m) < 1e-9, 'metres per unit ' + P.viper.m + ' is not the one the row gives (' + m + ')');
  const [fE, gE, hE] = VIPER_CABIN.pilotEye;
  const toShell = (q) => [(q[1] / sc - gE) * m, (q[0] / sc - fE) * m, (q[2] / sc - hE) * m];
  const hull = comp.faces.filter((f, i) => src[i] === 'parts[0]');
  const inRoom = (f) => f.p.every((q) => q[0] / sc >= VIPER_CABIN.back - 1e-9 && q[0] / sc <= VIPER_CABIN.front + 1e-9);
  // ⚠ The canopy FRAMES are left out of the aperture rays: a frame seen edge-on covers a strip of
  // the pane beside it, which is what a frame is for, and says nothing about where the cut is. The
  // mullion webs and reveals ARE in, and they are what carry the cut.
  const roomAll = shellFaces(P, null, { rich: false });
  const room = roomAll.filter((f) => f.rgb !== VIPER_FRAME || f.p.length === 4 && f.k === 0.05);
  const verts = roomAll.flatMap((f) => f.p);
  const floorAt = (y) => (y < (VIPER_CABIN.shieldF - fE) * m ? P.viper.zP : P.viper.zG);
  let glassN = 0, blocked = 0, solidN = 0, leaks = 0, rimMiss = 0, worst = 0;
  for (const f of hull.filter(inRoom)) {
    const Q = f.p.map(toShell);
    const isGlass = f.role === 'glass';
    // Sample the facet at nine interior points: a ray from the eye to each point on the SKIN.
    for (const u of [0.2, 0.5, 0.8]) for (const v of [0.2, 0.5, 0.8]) {
      const a = Q[0].map((x, k) => x + (Q[1][k] - x) * u), b = Q[3].map((x, k) => x + (Q[2][k] - x) * u);
      const tgt = a.map((x, k) => x + (b[k] - x) * v);
      if (tgt[2] < floorAt(tgt[1]) + 0.02) continue;            // under the deck: the deck's business
      const t = castFrom(room, [0, 0, 0], tgt);
      const hit = t > 0 && t < 0.999;
      if (isGlass) { glassN++; if (hit) blocked++; } else { solidN++; if (!hit) leaks++; }
    }
    if (isGlass) for (const q of Q) {
      let best = Infinity;
      for (const v of verts) best = Math.min(best, Math.hypot(v[0] - q[0], v[1] - q[1], v[2] - q[2]));
      worst = Math.max(worst, best);
      if (best > 0.002) rimMiss++;
    }
  }
  console.log('inside vs outside: ' + glassN + ' glass samples, ' + solidN + ' solid samples, worst rim corner ' + (worst * 1000).toFixed(3) + ' mm');
  ok(glassN > 60, 'only ' + glassN + ' glass samples in the room — the check is not exercising the canopy');
  ok(solidN > 20, 'only ' + solidN + ' solid samples in the room');
  ok(blocked === 0, blocked + ' rays to the exterior canopy glass hit the room — the hole inside is not the glass outside');
  ok(leaks === 0, leaks + ' rays to solid exterior skin got out — there is daylight where the hull is solid');
  ok(rimMiss === 0, rimMiss + ' exterior glass corners are more than 2 mm from any reveal corner (tolerance 2 mm)');
}

// ── THE GLASS: one pane per exterior glazed facet over the room, plus the blast shield ──
{
  const row = MESH_ROWS.heli_armed, sc = row.scale || 1;
  const comp = compileMesh(row), src = meshSource(comp.faces);
  const [fE, gE, hE] = VIPER_CABIN.pilotEye, m = P.viper.m;
  const toShell = (q) => [(q[1] / sc - gE) * m, (q[0] / sc - fE) * m, (q[2] / sc - hE) * m];
  const ext = comp.faces.filter((f, i) => src[i] === 'parts[0]' && f.role === 'glass'
    && f.p.every((q) => q[0] / sc >= VIPER_CABIN.back - 1e-9 && q[0] / sc <= VIPER_CABIN.front + 1e-9));
  const G = P.glass || [], B = shellBounds(P);
  const cen = (pts) => pts.reduce((s, q) => [s[0] + q[0] / pts.length, s[1] + q[1] / pts.length, s[2] + q[2] / pts.length], [0, 0, 0]);
  ok(G.length === ext.length + 1, 'glass: ' + G.length + ' panes for ' + ext.length + ' exterior glazed facets plus the blast shield');
  let miss = 0;
  for (const f of ext) {
    const c = cen(f.p.map(toShell));
    if (!G.some((g) => { const d = cen(g); return Math.hypot(d[0] - c[0], d[1] - c[1], d[2] - c[2]) < 0.01; })) miss++;
  }
  ok(miss === 0, 'glass: ' + miss + ' exterior glazed facets have no pane within 10 mm');
  const sy = (VIPER_CABIN.shieldF - fE) * m;
  ok(G.some((g) => g.every((q) => Math.abs(q[1] - sy) < 1e-6)), 'glass: no blast shield pane at the shield station');
  let bad = 0;
  for (const g of G) {
    if (g.length < 3) bad++;
    for (const q of g) if (!q.every(Number.isFinite) || q[0] < B[0] || q[0] > B[3] || q[1] < B[1] || q[1] > B[4] || q[2] < B[2] || q[2] > B[5]) bad++;
  }
  ok(bad === 0, 'glass: ' + bad + ' non-finite or out-of-bounds pane points');
  const faces = shellFaces(P, {});
  ok(!faces.some((f) => G.some((g) => g === f.p)), 'glass: a pane is inside shellFaces');
  console.log('glass: ' + G.length + ' panes (' + ext.length + ' facets + shield)');
}

// The hotspots are in the room and on the things they name.
{
  const hs = P.hotspots(REST), B = shellBounds(P);
  ok(hs.length >= 8, 'only ' + hs.length + ' hotspots');
  for (const h of hs) ok(h.p.every(Number.isFinite) && h.p[0] > B[0] && h.p[0] < B[3] && h.p[1] > B[1] && h.p[1] < B[4] && h.p[2] > B[2] && h.p[2] < B[5], 'hotspot ' + h.id + ' is outside the room');
  const g0 = P.hotspots({ throttle: 0 }).find((h) => h.id === 'throttle').p, g1 = P.hotspots({ throttle: 1 }).find((h) => h.id === 'throttle').p;
  ok(g1[2] > g0[2] + 0.1, 'the collective hotspot does not rise with the collective');
}

console.log('\n' + (checks - fails) + '/' + checks + ' checks passed');
process.exit(fails ? 1 : 0);
