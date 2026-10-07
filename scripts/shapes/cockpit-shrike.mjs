// THE GATE FOR THE SHRIKE'S COCKPIT (client/shared/interior-shrike.js).
//
// Three questions, each silent when wrong:
//   (a) is it a room you can sit in and see out of — at rest AND with every control at both stops,
//       because a stick at full aft that swings through the panel is invisible to a rest-pose check;
//   (b) is the inside the inside of the OUTSIDE — the real mesh is built (aircraftFaces) and its
//       glass is held against this room's frames, so a room that drifts off the exterior fails;
//   (c) does every control actually move — geometry at one stop must differ from the other.
// Run: node scripts/shapes/cockpit-shrike.mjs   (exit 1 on any failure)
import { shrikeProfile } from '../../client/shared/interior-shrike.js';
import { shellFaces, shellBounds, freezeFaces } from '../../client/shared/interior-shell.js';
import { FW_ROWS } from '../../client/shared/vehicle-models.js';

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('  FAIL  ' + msg); } };

// Ray against a convex polygon — scripts/shapes/shell.mjs's own test, copied so this file stands alone.
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

const P = shrikeProfile();
ok(!!P, 'shrikeProfile() returned nothing');
const B = shellBounds(P);

// ── (a) A ROOM, AT REST AND AT EVERY STOP ────────────────────────────────────
function roomChecks(tag, live) {
  const faces = freezeFaces(shellFaces(P, live));
  ok(faces.length > 0, tag + ': no geometry');
  const inside = B[0] < -0.05 && B[1] < -0.05 && B[2] < -0.05 && B[3] > 0.05 && B[4] > 0.05 && B[5] > 0.05;
  ok(inside, tag + ': eye not strictly inside ' + B.map((n) => n.toFixed(2)).join(' '));
  ok(!cast(faces, [0, 1, 0]), tag + ': something is across the windscreen');
  const wy = (P.winY[0] + P.winY[1]) / 2, wz = (P.winZ[0] + P.winZ[1]) / 2;
  const xL = P.xCentre - P.halfW, xR = P.xCentre + P.halfW;
  ok(!castFrom(faces, [0, 0, 0], [xL, wy, wz]), tag + ': the left side glass is blocked');
  ok(!castFrom(faces, [0, 0, 0], [xR, wy, wz]), tag + ': the right side glass is blocked');
  // Under a glasshouse the straight-up look must LEAVE (roofGlass).
  ok(P.roofGlass && !cast(faces, [0, 0, 1]), tag + ': something is across the canopy overhead');
  const footwell = [2 * P.xCentre, (P.seatY[1] + P.dashY) / 2, 0];
  ok(castFrom(faces, footwell, [0, 0, -1]), tag + ': NO FLOOR under the footwell');
  ok(castFrom(faces, [0, 0, (P.backZ + P.roof) / 2], [0, -1, 0]), tag + ': NO BULKHEAD behind the seat');
  const low = P.winZ[0] - 0.2;
  ok(castFrom(faces, [0, 0, 0], [xL, 0, low]), tag + ': no left wall below the sill');
  ok(castFrom(faces, [0, 0, 0], [xR, 0, low]), tag + ': no right wall below the sill');
  // The bomb-aiming window between the feet is GLASS, not a hole in the floor: a ray down through it
  // must meet the pane, and the pane must be see-through (PANE), not floor.
  const W = P.shrike.room.WIN, wc = [0, (W.y0 + W.y1) / 2, 0];
  const tw = castFrom(faces, wc, [0, 0, -1]);
  ok(tw > Math.abs(P.floorZ) - 0.001 && tw < Math.abs(P.floorZ) + 0.05, tag + ': the floor window has no pane (first hit down through it at ' + tw.toFixed(3) + ')');
  const down = cast(faces, [0, 0, -1]);
  ok(down > 0 && down < Math.abs(P.floor) - 1e-6, tag + ': nothing to sit on (first hit down is the floor)');
  let badN = 0, badP = 0, out = 0;
  for (const f of faces) {
    const L = Math.hypot(f.n[0], f.n[1], f.n[2]);
    if (!Number.isFinite(L) || Math.abs(L - 1) > 1e-6) badN++;
    if (!f.p || f.p.length < 3) badP++;
    for (const q of f.p) {
      if (!Number.isFinite(q[0] + q[1] + q[2])) badP++;
      if (q[0] < B[0] - 1e-6 || q[0] > B[3] + 1e-6 || q[1] < B[1] - 1e-6 || q[1] > B[4] + 1e-6 || q[2] < B[2] - 1e-6 || q[2] > B[5] + 1e-6) out++;
    }
  }
  ok(badN === 0, tag + ': ' + badN + ' non-unit normals');
  ok(badP === 0, tag + ': ' + badP + ' NaN or degenerate polygons');
  ok(out === 0, tag + ': ' + out + ' vertices outside the bounds');
  return faces;
}
const REST = { throttle: 0.5, stickX: 0, stickY: 0, rudder: 0, trim: 0, flapNotch: 0, diveBrake: 0, powered: true, hour: 12 };
console.log('shrike — ' + P.label);
const rest = roomChecks('rest', REST);
console.log('    ' + rest.length + ' faces at rest · ' + (B[4] - B[1]).toFixed(2) + 'm long, ' + (B[3] - B[0]).toFixed(2) + ' wide, ' + (B[5] - B[2]).toFixed(2) + ' tall');
ok(rest.length >= 4000 && rest.length <= 12000, 'face budget: ' + rest.length + ' outside 4,000-12,000');

// ── (c) EVERY CONTROL MOVES, AND STAYS A ROOM AT BOTH STOPS ──────────────────
const STOPS = {
  stickX: [-1, 1], stickY: [-1, 1], rudder: [-1, 1], throttle: [0, 1], trim: [-1, 1], flapNotch: [0, 3],
  diveBrake: [0, 1], pitch: [-60, 60], bank: [-60, 60], hdg: [0, 45], ias: [0, 300], alt: [0, 4500],
  vsi: [-6000, 3000], rpm: [0, 1], fuel: [0, 1], oilTemp: [0, 1], bombs: [0, 4], siren: [false, true],
  landingLight: [false, true], weaponsArmed: [false, true], powered: [false, true], hour: [12, 23],
};
// ⚠ THE WHOLE LIST, NOT A SUM: a compass card turned by 45° is the same SET of ticks, so any
// symmetric reduction (a coordinate sum) calls it unchanged. Every vertex, in order.
const sig = (fs) => fs.map((f) => f.p.map((q) => q.map((x) => x.toFixed(5)).join(',')).join(' ')).join('|');
const col = (fs) => fs.map((f) => (f.rgb ? f.rgb.join(',') : '') + '/' + (f.emis || 0)).join(';');
for (const [k, [a, b]] of Object.entries(STOPS)) {
  const A = roomChecks(k + '=' + a, { ...REST, [k]: a }), Bf = roomChecks(k + '=' + b, { ...REST, [k]: b });
  ok(sig(A) !== sig(Bf) || col(A) !== col(Bf), k + ': nothing changes between ' + a + ' and ' + b);
}
// The dive-release lamp: lit only low and steep.
{
  const lit = (l) => shellFaces(P, { ...REST, ...l }).filter((f) => f.rgb && f.rgb[0] === 255 && f.rgb[1] === 86 && f.emis === 1).length;
  ok(lit({ vsi: -5000, alt: 1500 }) > lit({ vsi: 0, alt: 1500 }), 'the contact altimeter lamp does not light in a steep low dive');
}

// ── (b) THE INSIDE IS THE INSIDE OF THE OUTSIDE ──────────────────────────────
//
// ⚠ MEASURED OFF THE BUILT MESH, NOT OFF THE PROFILE: aircraftFaces('divebomber') is the exterior
// as the renderer draws it. The only things taken from the profile are the frame's ORIGIN (the eye)
// — a coordinate choice, not a claim — and the stated scale is recomputed here from the row.
const { loadWindshield } = await import('./dom-stub.mjs');
await loadWindshield();
const A3 = await import('../../client/game/js/panels/aircraft3d.js');
const row = FW_ROWS.divebomber, p = row.params || row;
const m = 11.0 / (p.noseF - p.tailF);
ok(Math.abs(m - P.shrike.m) < 1e-9, 'the interior is not at the stated 11.0 m / model-length scale (' + P.shrike.m + ' vs ' + m + ')');
const toS = (q) => [q[1] * m, (q[0] - P.shrike.fE) * m, (q[2] - P.shrike.hE) * m];
const glass = A3.aircraftFaces('divebomber', 1).filter((f) => f.role === 'glass');
ok(glass.length > 20, 'the exterior has no glasshouse to hold the room against (' + glass.length + ' glass faces)');
// Every corner of the exterior glass must have one of this room's frames at it: the frames are on
// the seams. Tolerance 4 cm (the rods are set in by their own radius, 1-2 cm).
const verts = [];
for (const f of rest) for (const q of f.p) verts.push(q);
let far = 0, worst = 0;
const corners = [];
for (const f of glass) for (const q of f.p) {
  const s = toS(q);
  // Skip the cap fans' centre points: they are not on any seam.
  if (f.p.length === 3 && q === f.p[0]) continue;
  corners.push(s);
}
for (const s of corners) {
  let best = Infinity;
  for (const v of verts) { const d = Math.hypot(v[0] - s[0], v[1] - s[1], v[2] - s[2]); if (d < best) best = d; }
  worst = Math.max(worst, best);
  if (best > 0.04) far++;
}
ok(far === 0, far + ' of ' + corners.length + ' exterior glass corners have no frame within 4 cm (worst ' + worst.toFixed(3) + ' m)');
console.log('    exterior glass corners: ' + corners.length + ', worst distance to a frame ' + worst.toFixed(3) + ' m');
// The glass is OPEN: every exterior pane's middle is visible from whoever sits under it. ⚠ TWO
// EYES, because the head armour between the crew is real — the pilot cannot see aft through it and
// the gunner cannot see forward — so each pane is asked of the crewman on its side of the plate.
// The gunner's eye is where the canopy art paints his head (u 0.80), a seated 0.78 m over his seat.
const armourY = -0.32;
const gunEye = [0, (p.canopy.f0 + (p.canopy.f1 - p.canopy.f0) * 0.80 - P.shrike.fE) * m, -0.70 + 0.78];
let seen = 0;
for (const f of glass) {
  const c = f.p.reduce((a, q) => [a[0] + q[0] / f.p.length, a[1] + q[1] / f.p.length, a[2] + q[2] / f.p.length], [0, 0, 0]);
  const s = toS(c), o = s[1] > armourY ? [0, 0, 0] : gunEye;
  const v = [s[0] - o[0], s[1] - o[1], s[2] - o[2]], d = Math.hypot(...v);
  const t = castFrom(rest, o, v.map((x) => x / d));
  if (!t || t > d * 0.97) seen++; else if (process.env.DBG) console.log('blocked', s.map((x) => x.toFixed(2)).join(','), t.toFixed(2), d.toFixed(2));
}
ok(seen / glass.length >= 0.85, 'only ' + seen + ' of ' + glass.length + ' exterior panes are visible from the seat under them — the aperture is not the glass');
console.log('    exterior panes visible from the crew: ' + seen + ' / ' + glass.length);
// The GLASS: one pane per exterior glass face, each within 3 cm of the exterior face it stands for,
// finite, inside the bounds, and never part of shellFaces (the sight lines above stay open).
{
  const panes = typeof P.glass === 'function' ? P.glass(REST) : P.glass || [];
  const cen = (pts) => pts.reduce((a, q) => [a[0] + q[0] / pts.length, a[1] + q[1] / pts.length, a[2] + q[2] / pts.length], [0, 0, 0]);
  ok(panes.length === glass.length, 'glass: ' + panes.length + ' panes against ' + glass.length + ' exterior glass faces');
  let unmatched = 0, bad = 0;
  const pc = panes.map(cen);
  for (const f of glass) {
    const c = toS(cen(f.p));
    if (!pc.some((q) => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) < 0.03)) unmatched++;
  }
  for (const pn of panes) for (const q of pn) {
    if (!Number.isFinite(q[0] + q[1] + q[2]) || q[0] < B[0] - 1e-6 || q[0] > B[3] + 1e-6 || q[1] < B[1] - 1e-6 || q[1] > B[4] + 1e-6 || q[2] < B[2] - 1e-6 || q[2] > B[5] + 1e-6) bad++;
  }
  ok(unmatched === 0, 'glass: ' + unmatched + ' exterior panes have no glass polygon within 3 cm');
  ok(bad === 0, 'glass: ' + bad + ' pane points non-finite or outside the bounds');
  const inShell = rest.filter((f) => pc.some((q) => { const c = cen(f.p); return Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) < 1e-6; })).length;
  ok(inShell === 0, 'glass: ' + inShell + ' panes leaked into shellFaces');
  console.log('    glass panes: ' + panes.length);
}
// The sill: the room's ledge edge at the pilot's station agrees with the exterior canopy base.
{
  const base = glass.flatMap((f) => f.p).filter((q) => Math.abs(q[0] - P.shrike.fE) < 0.12);
  const baseZ = Math.min(...base.map((q) => q[2])), baseW = Math.max(...base.map((q) => Math.abs(q[1])));
  ok(Math.abs((baseZ - P.shrike.hE) * m - P.sillZ) < 0.03, 'the sill (' + P.sillZ.toFixed(3) + ') is not at the exterior canopy base (' + ((baseZ - P.shrike.hE) * m).toFixed(3) + ')');
  ok(P.halfW >= baseW * m - 0.02 && P.halfW < baseW * m + 0.25, 'the room width ' + P.halfW.toFixed(2) + ' does not match the exterior glass half-width ' + (baseW * m).toFixed(2));
}

console.log('\n' + (checks - fails) + '/' + checks + ' passed');
process.exit(fails ? 1 : 0);
