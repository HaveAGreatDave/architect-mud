// THE GATE FOR THE LEVIATHAN'S FLIGHT DECK (client/shared/interior-leviathan.js).
//
// Three questions, each silent when wrong:
//   (a) is it a room you can sit in — the shell.mjs sight lines and sanity checks, at rest and with
//       every control at both stops;
//   (b) is it the inside of the aircraft you can see from outside — the panes cut in the lining are
//       held against the exterior mesh's own glass faces, built by aircraft3d.js and never through
//       the profile, and a ray from the eye through every exterior pane that is above the deck must
//       leave the bare room while a ray to every painted facet must be stopped by it;
//   (c) does every control move — geometry differs between the two stops of each live input.
// Exit 1 on any failure.
import { shellFaces, shellBounds, freezeFaces } from '../../client/shared/interior-shell.js';
import { leviathanProfile, levRing } from '../../client/shared/interior-leviathan.js';
import { FW_ROWS } from '../../client/shared/vehicle-models.js';

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

const P = leviathanProfile();
ok(!!P, 'no profile built');
const B = shellBounds(P);
const REST = { powered: true, hour: 12, throttle: 0.5, stickX: 0, stickY: 0, rudder: 0, flapNotch: 1, gearDown: true, trim: 0, ias: 120, alt: 3000, hdg: 90, pitch: 2, bank: 0, vsi: 0, rpm: 0.7, fuel: 0.6, hull: 1 };

// ── (a) A ROOM YOU CAN SIT IN ────────────────────────────────────────────────
function roomChecks(label, live) {
  const faces = freezeFaces(shellFaces(P, live));
  ok(faces.length > 0, label + ': no geometry');
  ok(B[0] < -0.05 && B[1] < -0.05 && B[2] < -0.05 && B[3] > 0.05 && B[4] > 0.05 && B[5] > 0.05, label + ': eye not strictly inside');
  ok(!cast(faces, [0, 1, 0]), label + ': something across the windscreen');
  const wy = (P.winY[0] + P.winY[1]) / 2, wz = (P.winZ[0] + P.winZ[1]) / 2;
  const xL = P.xCentre - P.halfW, xR = P.xCentre + P.halfW;
  ok(!castFrom(faces, [0, 0, 0], [xL, wy, wz]), label + ': left side window blocked');
  ok(!castFrom(faces, [0, 0, 0], [xR, wy, wz]), label + ': right side window blocked');
  ok(castFrom(faces, [2 * P.xCentre, (P.seatY[1] + P.dashY) / 2, 0], [0, 0, -1]), label + ': no floor');
  if (P.roofGlass) ok(!cast(faces, [0, 0, 1]), label + ': something across the eyebrow glass overhead');
  else ok(cast(faces, [0, 0, 1]), label + ': no roof');
  ok(castFrom(faces, [0, 0, (P.backZ + P.roof) / 2], [0, -1, 0]), label + ': no aft bulkhead');
  const low = P.winZ[0] - 0.2;
  ok(castFrom(faces, [0, 0, 0], [xL, 0, low]), label + ': no left door card / console below the glass');
  ok(castFrom(faces, [0, 0, 0], [xR, 0, low]), label + ': no right door card / console below the glass');
  const down = cast(faces, [0, 0, -1]);
  ok(down > 0 && down < Math.abs(P.floor) - 1e-6, label + ': nothing to sit on');
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
  ok(badN === 0, label + ': ' + badN + ' bad normals');
  ok(badP === 0, label + ': ' + badP + ' degenerate/NaN polygons');
  ok(out === 0, label + ': ' + out + ' vertices outside bounds');
  return faces;
}
console.log('\nleviathan — ' + P.label);
const rest = roomChecks('rest', REST);
console.log('    ' + rest.length + ' faces at rest · bounds ' + B.map((v) => v.toFixed(2)).join(' '));
ok(rest.length >= 4000 && rest.length <= 12000, 'face count ' + rest.length + ' outside the 4k–12k budget');
roomChecks('dead and dark', { powered: false, hour: 2 });
roomChecks('no live', null);
const STOPS = {
  stickX: [-1, 1], stickY: [-1, 1], rudder: [-1, 1], throttle: [0, 1], flapNotch: [0, 3], gearDown: [false, true],
  trim: [-1, 1], pitch: [-40, 40], bank: [-60, 60], hdg: [0, 270], ias: [0, 400], alt: [0, 9500], vsi: [-5000, 5000],
  rpm: [0, 1.05], fuel: [0, 1], hull: [0.2, 1], powered: [false, true], landingLight: [false, true], dome: [false, true], hour: [3, 13],
};
// ⚠ GEOMETRY ONLY, except for the power switch: a lamp changing colour is not a lever moving, and the
// first cut of this summed colours too — a gear handle frozen in place passed on its three lamps.
const geo = (faces) => { let s = 0; for (const f of faces) for (const q of f.p) s += (q[0] + 1.7) * (q[1] + 2.3) * (q[2] + 3.1); return s + faces.length * 1e-3; };
const lit = (faces) => { let s = 0; for (const f of faces) if (f.emis) s += f.emis * 7 + (f.rgb ? f.rgb[0] + f.rgb[1] * 2 : 0); return s; };
const COLOUR_ONLY = new Set(['powered']);
// Where each grabbable control is, which must itself move with its own input.
const HOT = { stickY: 'yoke', throttle: 'throttle', flapNotch: 'ck:flaps', gearDown: 'ck:gear' };
// ── (c) EVERY CONTROL MOVES ──────────────────────────────────────────────────
console.log('\ncontrols at both stops');
for (const [k, [a, b]] of Object.entries(STOPS)) {
  const fa = roomChecks(k + '=' + a, { ...REST, [k]: a });
  const fb = roomChecks(k + '=' + b, { ...REST, [k]: b });
  const moved = Math.abs(geo(fa) - geo(fb)) > 1e-6 || (COLOUR_ONLY.has(k) && Math.abs(lit(fa) - lit(fb)) > 1e-6);
  ok(moved, k + ' does not move anything in the cockpit between ' + a + ' and ' + b);
  if (HOT[k]) {
    const at = (v) => P.hotspots({ ...REST, [k]: v }).find((h) => h.id === HOT[k]).p;
    const pa = at(a), pb = at(b);
    ok(Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) > 0.02, HOT[k] + ' does not travel with ' + k);
  }
}

// ── (b) THE INSIDE IS THE OUTSIDE ────────────────────────────────────────────
console.log('\nthe inside against the outside');
const { loadWindshield } = await import('./dom-stub.mjs');
await loadWindshield();
const A3 = await import('../../client/game/js/panels/aircraft3d.js');
const ext = A3.aircraftFaces('heavy', 1);
const glass = ext.filter((f) => f.role === 'glass' && f.art === FW_ROWS.heavy.glaze.art);
const L = P.lev, m = L.m;
ok(Math.abs(m - 69.1 / 2.27) < 1e-9, 'metres per unit is not 69.1 m / 2.27 u: ' + m);
ok(glass.length > 0, 'the exterior has no flight-deck glass to hold the room against');
// Every exterior pane has a hole in the lining whose rim sits within one lining thickness of it
// (plus 2 cm for the rim straddling a room end), and every hole is a pane. Tolerance in metres.
const TOL = 0.10 * 1.05 + 0.02;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * m;
const [rF0, rF1] = [0.585, 0.78];
const inRoom = (f) => f >= rF0 - 1e-6 && f <= rF1 + 1e-6;
let unmatched = 0, extra = 0;
for (const gf of glass) {
  if (!gf.p.some((q) => inRoom(q[0]))) continue;
  const clip = gf.p.map((q) => [Math.min(Math.max(q[0], rF0), rF1), q[1], q[2]]);
  const hit = L.holes.some((h) => clip.every((q) => h.rimU.some((r) => dist(q, r) <= TOL + (q[0] !== r[0] ? 0.5 : 0))) && clip.every((q) => Math.min(...h.rimU.map((r) => dist(q, r))) <= TOL));
  if (!hit) unmatched++;
}
for (const h of L.holes) {
  const match = glass.some((gf) => h.rimU.every((r) => Math.min(...gf.p.map((q) => dist([Math.min(Math.max(q[0], rF0), rF1), q[1], q[2]], r))) <= TOL));
  if (!match) extra++;
}
ok(unmatched === 0, unmatched + ' exterior panes have no matching hole in the lining');
ok(extra === 0, extra + ' holes in the lining are not an exterior pane');
ok(L.holes.length === glass.filter((gf) => gf.p.every((q) => inRoom(q[0]))).length, 'hole count ' + L.holes.length + ' differs from the exterior pane count');
// Independently of the holes: a ray from the eye to the middle of every exterior pane above the deck
// leaves the bare room, and a ray to every painted facet in the room's span is stopped by it.
const toShell = (q) => [(q[1] - L.gE) * m, (q[0] - L.fE) * m, (q[2] - L.hE) * m];
const roomFaces = L.room.map((f) => ({ p: f.p }));
let blocked = 0, seen = 0, leaks = 0, walls = 0;
for (const gf of glass) {
  const c = gf.p.reduce((s, q) => [s[0] + q[0] / 4, s[1] + q[1] / 4, s[2] + q[2] / 4], [0, 0, 0]);
  const cs = toShell(c);
  if (cs[2] < L.zF + 0.05 || !inRoom(c[0])) continue;
  seen++;
  const t = castFrom(roomFaces, [0, 0, 0], cs);
  if (t && t < 0.999) blocked++;
}
ok(seen >= 4, 'fewer than four exterior panes are above the deck: ' + seen);
ok(blocked === 0, blocked + ' of ' + seen + ' exterior panes are hidden behind the lining from the eye');
const st = [0.78, 0.70, 0.62, 0.56];
const sides = FW_ROWS.heavy.sides;
for (let i = 0; i < st.length - 1; i++) {
  const A = levRing(st[i]).pts, Bq = levRing(st[i + 1]).pts;
  for (let k = 0; k < sides; k++) {
    const isGlass = glass.some((gf) => Math.abs(gf.p[0][0] - st[i]) < 1e-6 && Math.abs(gf.p[0][1] - A[k][1]) < 1e-6 && Math.abs(gf.p[0][2] - A[k][2]) < 1e-6);
    if (isGlass) continue;
    const c = [0, 1, 2].map((j) => (A[k][j] + A[(k + 1) % sides][j] + Bq[k][j] + Bq[(k + 1) % sides][j]) / 4);
    if (!inRoom(c[0])) continue;
    const cs = toShell(c);
    if (cs[2] < L.zF + 0.05) continue;
    walls++;
    const t = castFrom(roomFaces, [0, 0, 0], cs);
    if (!(t && t < 1)) leaks++;
  }
}
ok(walls >= 4, 'fewer than four painted facets above the deck: ' + walls);
ok(leaks === 0, leaks + ' of ' + walls + ' painted hull facets can be seen straight through the lining');
// Nothing in the fit-out pokes through the hull: every vertex is inside the exterior ring at its
// own station (checked at the ring's widest point on its own height, a conservative envelope).
{
  let poke = 0;
  const faces = shellFaces(P, REST);
  for (const f of faces) for (const q of f.p) {
    const fu = L.fE + q[1] / m, hu = L.hE + q[2] / m, gu = L.gE + q[0] / m;
    if (fu > 0.78 + 1e-6 || fu < 0.56) continue;
    const i = fu >= 0.70 ? 0 : fu >= 0.62 ? 1 : 2;
    const t = (st[i] - fu) / (st[i] - st[i + 1]);
    const A = levRing(st[i]).pts, Bq = levRing(st[i + 1]).pts;
    const ring = A.map((a, k) => [0, 1, 2].map((j) => a[j] + (Bq[k][j] - a[j]) * t));
    let wn = 0;
    for (let k = 0; k < sides; k++) {
      const a = ring[k], b = ring[(k + 1) % sides];
      if ((a[2] <= hu) !== (b[2] <= hu)) { const x = a[1] + (hu - a[2]) / (b[2] - a[2]) * (b[1] - a[1]); if (x > gu) wn++; }
    }
    if (wn % 2 === 0) poke++;
  }
  ok(poke === 0, poke + ' fit-out vertices stand outside the exterior hull');
}

// ── THE GLASS FILM ───────────────────────────────────────────────────────────
// One film per exterior pane above the deck, lying on that pane (every point within 10 cm of the
// exterior's own facet plane and inside its corners' reach), finite, inside the bounds, and never
// part of shellFaces — the sight lines above were all cast with it absent.
console.log('\nthe glass');
{
  const G = typeof P.glass === 'function' ? P.glass(REST) : P.glass;
  ok(Array.isArray(G) && G.length > 0, 'the profile carries no glass');
  let bad = 0, off = 0;
  const covered = new Set();
  for (const poly of G || []) {
    for (const q of poly) if (!Number.isFinite(q[0] + q[1] + q[2]) || q[0] < B[0] - 1e-6 || q[0] > B[3] + 1e-6
      || q[1] < B[1] - 1e-6 || q[1] > B[4] + 1e-6 || q[2] < B[2] - 1e-6 || q[2] > B[5] + 1e-6) bad++;
    const c = poly.reduce((s, q) => [s[0] + q[0] / poly.length, s[1] + q[1] / poly.length, s[2] + q[2] / poly.length], [0, 0, 0]);
    // Which exterior pane is it on: the one whose plane is nearest its centre, within reach.
    let best = null;
    for (let i = 0; i < glass.length; i++) {
      const E = glass[i].p.map(toShell);
      const e1 = E[1].map((v, j) => v - E[0][j]), e2 = E[3].map((v, j) => v - E[0][j]);
      let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const ln = Math.hypot(...n); n = n.map((v) => v / ln);
      const ec = E.reduce((s, q) => [s[0] + q[0] / 4, s[1] + q[1] / 4, s[2] + q[2] / 4], [0, 0, 0]);
      const dPlane = Math.max(...poly.map((q) => Math.abs((q[0] - ec[0]) * n[0] + (q[1] - ec[1]) * n[1] + (q[2] - ec[2]) * n[2])));
      const reach = Math.max(...E.map((q) => Math.hypot(q[0] - ec[0], q[1] - ec[1], q[2] - ec[2])));
      const dc = Math.hypot(c[0] - ec[0], c[1] - ec[1], c[2] - ec[2]);
      if (dPlane <= 0.10 && dc <= reach && (!best || dPlane < best.d)) best = { i, d: dPlane };
    }
    if (best) covered.add(best.i); else off++;
  }
  const want = glass.filter((gf) => gf.p.some((q) => inRoom(q[0]) && toShell(q)[2] > L.zF)).length;
  ok(bad === 0, bad + ' glass points non-finite or outside the bounds');
  ok(off === 0, off + ' glass polygons lie on no exterior pane');
  ok(covered.size === want, 'glass covers ' + covered.size + ' of the ' + want + ' exterior panes above the deck');
  const inShell = shellFaces(P, REST).some((f) => G.some((g) => g.length === f.p.length && g.every((q, j) => q === f.p[j] || (q[0] === f.p[j][0] && q[1] === f.p[j][1] && q[2] === f.p[j][2]))));
  ok(!inShell, 'the glass is being emitted as shell geometry — it would block every sight line');
  console.log('    ' + (G || []).length + ' film polygons over ' + covered.size + ' panes');
}

console.log('\n' + (checks - fails) + '/' + checks + ' passed');
process.exit(fails ? 1 : 0);
