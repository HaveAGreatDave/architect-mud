// THE GATE FOR THE MULE'S FLIGHT DECK (client/shared/interior-mule.js).
//
// Four questions, each silent when wrong:
//   a) is it a room you can sit in and see out of — shell.mjs's own ray checks, at rest and with
//      every control at both stops;
//   b) is the INSIDE the inside of the OUTSIDE — the glass is read off the real exterior mesh
//      (aircraftFaces('prop')), converted with a scale this file derives itself from that mesh, and
//      every pane must be a clear hole in the room with its rim on the pane's own corners;
//   c) does every control move — a lever that draws the same at both stops is a picture of a lever;
//   d) can you start her from the seat: the ignition is in the forward view with nothing in front
//      of it, and every click control is one cockpit.js acts on. The Mule shipped with neither: no
//      start in front of the pilot, and a BAT switch whose id no handler knew.
// Run: node scripts/shapes/cockpit-mule.mjs   (exit 1 on any failure)
import { shellFaces, shellBounds } from '../../client/shared/interior-shell.js';
import { muleProfile } from '../../client/shared/interior-mule.js';
import { readDkTables } from './dk-tables.mjs';

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('  FAIL  ' + msg); } };

// ── RAY / CONVEX POLYGON (shell.mjs's, with an optional far limit) ───────────
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
const castFrom = (faces, o, d, tMax = Infinity) => {
  let best = 0;
  for (const f of faces) { const t = rayHitsPoly(o, d, f.p); if (t && t < tMax && (!best || t < best)) best = t; }
  return best;
};
const cast = (faces, d) => castFrom(faces, [0, 0, 0], d);

const P = muleProfile();
const B = shellBounds(P);
ok(!!P && P.room, 'muleProfile() built no profile with a room');

// ── a) THE ROOM, AT REST AND AT EVERY STOP ───────────────────────────────────
const REST = { powered: true, engineOn: true, throttle: 0.5, rpm: 0.8, ias: 110, alt: 4500, hdg: 90, fuel: 0.6, hull: 1, hour: 12 };
const STOPS = {
  stickX: [-1, 1], stickY: [-1, 1], rudder: [-1, 1], throttle: [0, 1], flapNotch: [0, 3], trim: [-1, 1],
  powered: [false, true], dome: [false, true], landingLight: [false, true], hour: [12, 23],
  engineOn: [false, true], starting: [false, true], panelLight: [false, true],
  ias: [0, 170], alt: [0, 9500], vsi: [-2000, 2000], hdg: [0, 200], pitch: [-20, 20], bank: [-45, 45],
  rpm: [0, 1], fuel: [0, 1], hull: [0.1, 1], oilTemp: [20, 115],
};
const xL = P.xCentre - P.halfW, xR = P.xCentre + P.halfW;
const wy = (P.winY[0] + P.winY[1]) / 2, wz = (P.winZ[0] + P.winZ[1]) / 2;
function roomChecks(tag, faces) {
  ok(!cast(faces, [0, 1, 0]), tag + ': something is across the windscreen');
  ok(!castFrom(faces, [0, 0, 0], [xL, wy, wz]), tag + ': the left side window is blocked');
  ok(!castFrom(faces, [0, 0, 0], [xR, wy, wz]), tag + ': the right side window is blocked');
  const footwell = [2 * P.xCentre, (P.seatY[1] + P.dashY) / 2, 0];
  ok(castFrom(faces, footwell, [0, 0, -1]), tag + ': NO FLOOR under the co-pilot footwell');
  ok(cast(faces, [0, 0, 1]), tag + ': NO ROOF straight up');
  ok(castFrom(faces, [0, 0, (P.backZ + P.roof) / 2], [0, -1, 0]), tag + ': NO BULKHEAD behind');
  const low = P.winZ[0] - 0.2;
  ok(castFrom(faces, [0, 0, 0], [xL, 0, low]), tag + ': NO LEFT DOOR CARD below the sill');
  ok(castFrom(faces, [0, 0, 0], [xR, 0, low]), tag + ': NO RIGHT DOOR CARD below the sill');
  const down = cast(faces, [0, 0, -1]);
  ok(down > 0 && down < Math.abs(P.floor) - 1e-6, tag + ': the first thing under the eye is not a seat');
  let badN = 0, badP = 0, out = 0;
  for (const f of faces) {
    const L = f.n && Math.hypot(f.n[0], f.n[1], f.n[2]);
    if (!(Math.abs(L - 1) <= 1e-6)) badN++;
    if (!f.p || f.p.length < 3) badP++;
    for (const q of f.p || []) {
      if (!Number.isFinite(q[0] + q[1] + q[2])) badP++;
      else if (q[0] < B[0] - 1e-6 || q[0] > B[3] + 1e-6 || q[1] < B[1] - 1e-6 || q[1] > B[4] + 1e-6 || q[2] < B[2] - 1e-6 || q[2] > B[5] + 1e-6) out++;
    }
  }
  ok(badN === 0, tag + ': ' + badN + ' non-unit normals');
  ok(badP === 0, tag + ': ' + badP + ' degenerate or NaN polygons');
  ok(out === 0, tag + ': ' + out + ' vertices outside the bounds');
  return down;
}
console.log('mule — ' + P.label);
const inside = B[0] < -0.05 && B[1] < -0.05 && B[2] < -0.05 && B[3] > 0.05 && B[4] > 0.05 && B[5] > 0.05;
ok(inside, 'the eye is not strictly inside the shell: ' + B.map((n) => n.toFixed(2)).join(' '));
const rest = shellFaces(P, REST);
const down = roomChecks('rest', rest);
ok(!P.roofGlass, 'the Mule has a painted roof; roofGlass must not be set');
for (const [k, [a, b]] of Object.entries(STOPS)) {
  roomChecks(k + '=' + a, shellFaces(P, { ...REST, [k]: a }));
  roomChecks(k + '=' + b, shellFaces(P, { ...REST, [k]: b }));
}
ok(rest.length >= 4000 && rest.length <= 12000, 'face count ' + rest.length + ' outside the 4,000–12,000 budget');

// ── b) THE INSIDE MATCHES THE OUTSIDE ────────────────────────────────────────
// ⚠ THE EXTERIOR IS BUILT, NOT RE-DERIVED: the real mesh off aircraft3d.js, under the DOM stub.
const { loadWindshield } = await import('./dom-stub.mjs');
await loadWindshield();
const A3 = await import('../../client/game/js/panels/aircraft3d.js');
const ext = A3.aircraftFaces('prop', 1, false, '');
const body = ext.filter((f) => f.role === 'body' || f.role === 'glass');
let fMin = Infinity, fMax = -Infinity;
for (const f of body) for (const q of f.p) { fMin = Math.min(fMin, q[0]); fMax = Math.max(fMax, q[0]); }
// This file's own scale, off the mesh's own length, and the eye it states.
const M = 15.77 / (fMax - fMin), EYE = [0.55, -0.055, 0.08];
const toS = (q) => [(q[1] - EYE[1]) * M, (q[0] - EYE[0]) * M, (q[2] - EYE[2]) * M];
ok(Math.abs(M - P.mule.m) < 1e-3, 'scale disagrees: mesh says ' + M.toFixed(4) + ' m/unit, profile ' + P.mule.m.toFixed(4));
ok(P.mule.eye.every((v, i) => v === EYE[i]), 'the profile\'s eye anchor moved: ' + P.mule.eye.join(','));
// The flight-deck glass: every glazed facet ahead of the cabin (the glaze runs f1 0.30 → f0 0.70).
const glass = ext.filter((f) => f.role === 'glass').map((f) => f.p.map(toS));
ok(glass.length > 0, 'the exterior has no glass at all — the check below would be vacuous');
const holes = P.mule.glassHoles;
ok(glass.length === holes.length, 'the exterior has ' + glass.length + ' panes and the room cut ' + holes.length + ' holes');
const room = P.mule.faces;
let blocked = 0, rimOff = 0, worst = 0;
for (const g of glass) {
  const c = g.reduce((s, q) => [s[0] + q[0] / g.length, s[1] + q[1] / g.length, s[2] + q[2] / g.length], [0, 0, 0]);
  // From the eye to the middle of the pane, the room must be open all the way to the glass.
  if (castFrom(room, [0, 0, 0], c, 0.999)) blocked++;
}
// And each hole's rim sits on a pane's corners (tolerance 2 cm).
const TOL = 0.02;
for (const h of holes) for (const q of h.outer) {
  let best = Infinity;
  for (const g of glass) for (const v of g) best = Math.min(best, Math.hypot(v[0] - q[0], v[1] - q[1], v[2] - q[2]));
  worst = Math.max(worst, best);
  if (best > TOL) rimOff++;
}
ok(blocked === 0, blocked + ' exterior panes are covered by the room — the inside has lining where the outside has glass');
ok(rimOff === 0, rimOff + ' hole corners are more than ' + TOL + ' m off the exterior glass (worst ' + worst.toFixed(3) + ' m)');
// THE GLASS FILM: one pane per exterior pane, on it, finite, inside the bounds, and never in shellFaces.
const film = P.glass || [];
ok(Array.isArray(film) && film.length === glass.length, 'the profile has ' + film.length + ' glass panes for ' + glass.length + ' exterior panes');
let unmatched = 0, badG = 0;
for (const g of glass) {
  const c = g.reduce((s, q) => [s[0] + q[0] / g.length, s[1] + q[1] / g.length, s[2] + q[2] / g.length], [0, 0, 0]);
  const hit = film.some((f) => {
    const fc = f.reduce((s, q) => [s[0] + q[0] / f.length, s[1] + q[1] / f.length, s[2] + q[2] / f.length], [0, 0, 0]);
    return Math.hypot(fc[0] - c[0], fc[1] - c[1], fc[2] - c[2]) < TOL;
  });
  if (!hit) unmatched++;
}
for (const f of film) for (const q of f) {
  if (!Number.isFinite(q[0] + q[1] + q[2]) || q[0] < B[0] || q[0] > B[3] || q[1] < B[1] || q[1] > B[4] || q[2] < B[2] || q[2] > B[5]) badG++;
}
ok(unmatched === 0, unmatched + ' exterior panes have no glass film within ' + TOL + ' m');
ok(badG === 0, badG + ' glass vertices non-finite or outside the bounds');
const filmKeys = new Set(film.map((f) => JSON.stringify(f)));
ok(!rest.some((f) => filmKeys.has(JSON.stringify(f.p))), 'glass film leaked into shellFaces — the sight lines would be glazed shut');
// The converse: solid skin outside is solid inside. A ray to the middle of every exterior BODY
// facet in the cockpit bay must hit the room before it reaches the skin.
const bodyFacets = ext.filter((f) => f.role === 'body' && f.p.length === 4).map((f) => f.p.map(toS)).filter((p) => {
  const cf = p.reduce((s, q) => s + q[1], 0) / p.length / M + EYE[0];
  return cf > 0.32 && cf < 0.66;
});
let leaks = 0;
for (const g of bodyFacets) {
  const c = g.reduce((s, q) => [s[0] + q[0] / 4, s[1] + q[1] / 4, s[2] + q[2] / 4], [0, 0, 0]);
  if (c[2] < P.floor) continue;
  if (!castFrom(room, [0, 0, 0], c, 0.999)) leaks++;
}
ok(leaks === 0, leaks + ' exterior body facets are open windows from inside');

// ── c) EVERY CONTROL MOVES ───────────────────────────────────────────────────
const hash = (fs) => {
  let h = 0;
  for (const f of fs) {
    for (const q of f.p) h = (h * 31 + Math.round(q[0] * 1e4) * 7 + Math.round(q[1] * 1e4) * 13 + Math.round(q[2] * 1e4) * 17) % 2147483647;
    if (f.rgb) h = (h * 31 + f.rgb[0] + f.rgb[1] * 3 + f.rgb[2] * 5 + Math.round((f.emis || 0) * 100)) % 2147483647;
  }
  return h + ':' + fs.length;
};
const still = [];
for (const [k, [a, b]] of Object.entries(STOPS)) {
  if (hash(shellFaces(P, { ...REST, [k]: a })) === hash(shellFaces(P, { ...REST, [k]: b }))) still.push(k);
}
ok(still.length === 0, 'these controls draw the same at both stops: ' + still.join(', '));
// ⚠ A WHOLE-SHELL HASH IS TOO EASY TO PASS for a lever: the throttle also drives the torque dials, so
// a power lever frozen in its slot still changes the hash. The parts you grab are held to where the
// hotspot says they are: at stop b there is geometry at the grab point, and at stop a there is less.
const near = (fs, p, r) => fs.reduce((n, f) => n + f.p.filter((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < r).length, 0);
for (const [k, id, a, b] of [['throttle', 'throttle', 0, 1], ['throttle', 'throttle', 1, 0], ['flapNotch', 'ck:flaps', 0, 3],
  ['flapNotch', 'ck:flaps', 3, 0], ['stickY', 'yoke', -1, 1], ['stickY', 'yoke', 1, -1]]) {
  const hb = P.hotspots({ ...REST, [k]: b }).find((h) => h.id === id).p;
  const nb = near(shellFaces(P, { ...REST, [k]: b }), hb, 0.03), na = near(shellFaces(P, { ...REST, [k]: a }), hb, 0.03);
  ok(nb > 0 && nb > na, k + ' ' + a + '→' + b + ': nothing arrives at the ' + id + ' grab point (' + na + ' → ' + nb + ' vertices)');
}

// ── d) YOU CAN START HER FROM THE SEAT ───────────────────────────────────────
// The ignition is the engine master, 'ck:master'. It must be in the forward view (within 30° of
// straight ahead, either way) and nothing may stand between the eye and it, nor between the eye and
// the switches beside it, with the wheel at rest or at either end of its travel.
const hs = P.hotspots(REST);
const key = hs.find((h) => h.id === 'ck:master');
ok(!!key, 'no ck:master hotspot: nothing in the cockpit starts the engine');
if (key) {
  const [x, y, z] = key.p, down = Math.atan2(-z, y) * 180 / Math.PI, side = Math.atan2(Math.abs(x), y) * 180 / Math.PI;
  ok(y > 0 && down < 30 && side < 30, 'the ignition is out of the forward view: ' + down.toFixed(0) + '° down, ' + side.toFixed(0) + '° aside');
}
for (const sy of [-1, 0, 1]) {
  const live = { ...REST, stickY: sy };
  const fs = shellFaces(P, live);
  for (const h of P.hotspots(live).filter((h) => h.kind === 'click' && h.p[1] > 0.5)) {
    ok(!castFrom(fs, [0, 0, 0], h.p, 0.95), h.id + ' is hidden from the seat (stickY ' + sy + ')');
  }
}
// Every click control names an action cockpit.js has, and a tooltip. Read off the source by
// dk-tables.mjs, which cockpit-controls.mjs asks of every other seat.
const { ACT, TIP } = readDkTables();
ok(!!ACT && !!TIP, 'could not read DK_ACT / DK_TIP out of cockpit.js; this check would be vacuous');
for (const h of hs.filter((h) => h.kind === 'click')) {
  ok(!!ACT?.has(h.id), h.id + ': cockpit.js DK_ACT has no action for it, so the click does nothing');
  ok(!!TIP?.has(h.id), h.id + ': cockpit.js DK_TIP has no tooltip for it');
}

console.log('    ' + rest.length + ' faces · ' + down.toFixed(2) + 'm to the seat · ' + (B[4] - B[1]).toFixed(2) + 'm long, '
  + (B[3] - B[0]).toFixed(2) + ' wide, ' + (B[5] - B[2]).toFixed(2) + ' tall · ' + glass.length + ' panes, rim worst ' + worst.toFixed(3) + ' m');
console.log('\n' + (checks - fails) + '/' + checks + ' checks passed');
process.exit(fails ? 1 : 0);
