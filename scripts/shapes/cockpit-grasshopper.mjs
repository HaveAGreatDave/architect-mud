// THE GATE FOR THE CUB'S COCKPIT (client/shared/interior-grasshopper.js).
//
// Three things, each silent when wrong:
//   (a) the room is a room you can sit in and see out of — shell.mjs's own ray checks, at rest and
//       with every control at both stops;
//   (b) the INSIDE matches the OUTSIDE: the exterior's own glass faces, compiled here from the mesh
//       and mapped to metres with a scale and crown this file derives for itself, must be CLEAR from
//       the eye, and the exterior's solid cabin skin must be HIT by the room — at the centre of each
//       face and at 60% (glass) or 55% (skin) of the way to each of its corners — the stated tolerance: the
//       outer 40-45% of a bay, which is the wall's own 2 cm of thickness seen with parallax. The glass
//       is held against the room minus its tube frame, which stands on every glass edge;
//   (c) every control moves: the geometry at one stop differs from the other.
// ⚠ (b) NEVER READS THE PROFILE'S SCALE, EYE-TO-SKIN MAPPING OR HOLES: it recomputes them off the
// JSON, or it would be the answer checking itself.
import { shellFaces, shellBounds } from '../../client/shared/interior-shell.js';
import { grasshopperProfile, CUB_TRIM } from '../../client/shared/interior-grasshopper.js';
import { MESH_ROWS } from '../../client/shared/vehicle-meshes.js';
import { compileMesh } from '../../client/shared/vehicle-mesh.js';

let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('  FAIL  ' + m); } };

// The ray against a convex polygon: shell.mjs's, copied because that file runs on import.
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
    const ed = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], vp = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
    const c = [ed[1] * vp[2] - ed[2] * vp[1], ed[2] * vp[0] - ed[0] * vp[2], ed[0] * vp[1] - ed[1] * vp[0]];
    const s = c[0] * n[0] + c[1] * n[1] + c[2] * n[2];
    const scale = Math.hypot(...n) * Math.hypot(...ed) * Math.hypot(...vp);
    if (!(scale > 1e-24) || Math.abs(s) <= 1e-9 * scale) continue;
    const g = s > 0 ? 1 : -1;
    if (sign === 0) sign = g; else if (g !== sign) return 0;
  }
  return t;
}
const castFrom = (faces, o, d) => { let best = 0; for (const f of faces) { const t = rayHitsPoly(o, d, f.p); if (t && (!best || t < best)) best = t; } return best; };
const cast = (faces, d) => castFrom(faces, [0, 0, 0], d);
const TOL = 0.60, TOL_SKIN = 0.55;

const P = grasshopperProfile();
ok(!!P, 'no profile');
const B = shellBounds(P);

// ── (a) THE ROOM, AT REST AND AT EVERY STOP ─────────────────────────────────
const REST = { powered: true, hour: 12 };
const STOPS = {
  stickX: [-1, 1], stickY: [-1, 1], rudder: [-1, 1], throttle: [0, 1], trim: [-1, 1],
  fuel: [0, 1], ias: [0, 140], alt: [0, 9500], rpm: [0, 1], oilTemp: [0, 1], hdg: [0, 180],
  powered: [false, true], dome: [false, true], landingLight: [false, true], hour: [12, 0],
};
function roomChecks(tag, live) {
  const faces = shellFaces(P, live);
  const inside = B[0] < -0.05 && B[1] < -0.05 && B[2] < -0.05 && B[3] > 0.05 && B[4] > 0.05 && B[5] > 0.05;
  ok(inside, tag + ': eye not strictly inside ' + B.map((n) => n.toFixed(2)).join(' '));
  ok(!cast(faces, [0, 1, 0]), tag + ': something is across the windscreen');
  const wy = (P.winY[0] + P.winY[1]) / 2, wz = (P.winZ[0] + P.winZ[1]) / 2;
  const xL = P.xCentre - P.halfW, xR = P.xCentre + P.halfW;
  ok(!castFrom(faces, [0, 0, 0], [xL, wy, wz]), tag + ': the left side window is blocked');
  ok(!castFrom(faces, [0, 0, 0], [xR, wy, wz]), tag + ': the right side window is blocked');
  ok(castFrom(faces, [0, (P.seatY[1] + P.dashY) / 2, 0], [0, 0, -1]), tag + ': no floor down the footwell');
  ok(!cast(faces, [0, 0, 1]), tag + ': something across the skylight straight up');
  ok(castFrom(faces, [0, 0, (P.backZ + P.roof) / 2], [0, -1, 0]), tag + ': no bulkhead behind');
  ok(castFrom(faces, [0, 0, 0], [xL, 0, P.winZ[0] - 0.2]), tag + ': no left door card');
  ok(castFrom(faces, [0, 0, 0], [xR, 0, P.winZ[0] - 0.2]), tag + ': no right door card');
  const down = cast(faces, [0, 0, -1]);
  ok(down > 0 && down < Math.abs(P.floor) - 1e-6, tag + ': nothing to sit on');
  let bad = 0, outN = 0;
  for (const f of faces) {
    const L = Math.hypot(f.n[0], f.n[1], f.n[2]);
    if (!Number.isFinite(L) || Math.abs(L - 1) > 1e-6) bad++;
    if (!f.p || f.p.length < 3) bad++;
    for (const q of f.p) {
      if (!Number.isFinite(q[0] + q[1] + q[2])) bad++;
      else if (q[0] < B[0] - 1e-6 || q[0] > B[3] + 1e-6 || q[1] < B[1] - 1e-6 || q[1] > B[4] + 1e-6 || q[2] < B[2] - 1e-6 || q[2] > B[5] + 1e-6) outN++;
    }
  }
  ok(bad === 0, tag + ': ' + bad + ' bad normals/NaN/degenerate');
  ok(outN === 0, tag + ': ' + outN + ' vertices outside the bounds');
  return faces;
}
const rest = roomChecks('rest', REST);
for (const [k, [lo, hi]] of Object.entries(STOPS)) { roomChecks(k + '=' + lo, { ...REST, [k]: lo }); roomChecks(k + '=' + hi, { ...REST, [k]: hi }); }
console.log('grasshopper: ' + rest.length + ' faces at rest · ' + (B[4] - B[1]).toFixed(2) + ' m long, '
  + (B[3] - B[0]).toFixed(2) + ' wide, ' + (B[5] - B[2]).toFixed(2) + ' tall');
ok(rest.length >= 4000 && rest.length <= 12000, 'face count ' + rest.length + ' outside 4,000–12,000');

// ── (b) INSIDE MATCHES OUTSIDE ───────────────────────────────────────────────
{
  const doc = MESH_ROWS.grasshopper;
  const { faces: ext } = compileMesh(doc);
  const find = (ps, n) => { for (const p of ps || []) { if (p.name === n) return p; const q = find(p.parts, n); if (q) return q; } return null; };
  const loft = find(doc.parts, 'fuselage'), wing = find(doc.parts, 'wing');
  // The scale: wing tip to wing tip against the real 10.74 m, measured off the compiled wing.
  let span = 0; for (const f of ext) if (f.role === 'wing') for (const q of f.p) span = Math.max(span, Math.abs(q[1]));
  const M = 10.74 / (2 * span);
  ok(Math.abs(M - P.cub.M) / M < 0.02, 'the room\'s scale ' + P.cub.M.toFixed(3) + ' is not the span\'s ' + M.toFixed(3));
  // cz and rvT along the loft, by straight interpolation of its stations.
  const st = loft.stations.slice().sort((a, b) => b.f - a.f);
  const at = (f, key) => {
    if (f >= st[0].f) return st[0][key];
    for (let i = 0; i < st.length - 1; i++) if (f <= st[i].f && f >= st[i + 1].f) {
      const t = (st[i].f - f) / (st[i].f - st[i + 1].f); return st[i][key] + (st[i + 1][key] - st[i][key]) * t;
    }
    return st[st.length - 1][key];
  };
  // The crown stretch: the wing's lowest root point over the crown at the eye's station.
  let gR = Infinity; for (const f of ext) if (f.role === 'wing') for (const q of f.p) gR = Math.min(gR, Math.abs(q[1]));
  let crown = Infinity; for (const f of ext) if (f.role === 'wing') for (const q of f.p) if (Math.abs(Math.abs(q[1]) - gR) < 1e-6) crown = Math.min(crown, q[2]);
  const fE = P.cub.fE, hE = P.cub.hE;   // where the PERSON sits: authored, not derived, and read as such
  // The side glass's top edge: the end of the glazed run that starts at the sill (k 0), off the regions.
  let kTop = Infinity;
  for (const rg of loft.regions) if (rg.role === 'glass' && rg.k !== 'all' && rg.k.includes(0) && !rg.k.includes(1)) kTop = Math.min(kTop, 1);
  const aTop = kTop * 2 * Math.PI / loft.sides;
  // The stretch is spent on the side glass only; above its top edge the exterior's height is kept.
  const topRel = (f) => Math.pow(Math.sin(aTop), 1 - at(f, 'boxy') * 0.55) * at(f, 'rvT');
  const S = (crown - at(fE, 'cz') - (at(fE, 'rvT') - topRel(fE))) / topRel(fE);
  const map = (q) => {
    const cz = at(q[0], 'cz'), r = q[2] - cz, gT = topRel(q[0]);
    const h = r <= 0 ? q[2] : cz + (r <= gT ? r * S : gT * S + (r - gT));
    return [q[1] * M, (q[0] - fE) * M, (h - hE) * M];
  };
  const roomOnly = shellFaces(P, REST, { rich: false });
  // ⚠ The tube frame stands along every glass edge and may shadow the edge of a bay from a grazing
  // eye, as the real one does; the SKIN may not. So the glass is held against the room minus its tubes.
  const skinOnly = roomOnly.filter((f) => f.rgb !== CUB_TRIM.tube);
  const cen = (p) => p.reduce((s, q) => [s[0] + q[0] / p.length, s[1] + q[1] / p.length, s[2] + q[2] / p.length], [0, 0, 0]);
  const probes = (p, tl) => { const c = cen(p); return [c, ...p.map((q) => [c[0] + (q[0] - c[0]) * tl, c[1] + (q[1] - c[1]) * tl, c[2] + (q[2] - c[2]) * tl])]; };
  let glassN = 0, glassBad = 0, bodyN = 0, bodyBad = 0;
  const fBk = -0.21, fFw = 0.52;
  for (const f of ext) {
    const c = cen(f.p);
    if (c[0] < fBk || c[0] > fFw) continue;
    if (f.role === 'glass') {
      for (const q of probes(f.p, TOL)) {
        const d = map(q); glassN++;   // the SKIN point: anything the room puts short of it is across the glass
        const t = castFrom(skinOnly, [0, 0, 0], d);
        if (t && t < 0.999) { glassBad++; if (glassBad < 4) console.log('    glass probe blocked at t=' + t.toFixed(3) + ' toward ' + q.map((v) => v.toFixed(3)).join(',')); }
      }
    } else if (f.role === 'body') {
      for (const q of probes(f.p, TOL_SKIN)) {
        const d = map(q);
        if (Math.abs(d[0]) < 0.02) continue;   // the keel line: straight down, the seat's business
        bodyN++;
        const t = castFrom(roomOnly, [0, 0, 0], d);
        if (!(t > 0 && t <= 1.05)) { bodyBad++; if (bodyBad < 4) console.log('    skin probe open (t=' + t.toFixed(3) + ') at ' + q.map((v) => v.toFixed(3)).join(',')); }
      }
    }
  }
  // ── THE GLASS: one pane per exterior glass facet, where that facet is, and never in the room ──
  const G = Array.isArray(P.glass) ? P.glass : [];
  const extGlass = ext.filter((f) => f.role === 'glass');
  ok(G.length === extGlass.length, 'the profile carries ' + G.length + ' panes for ' + extGlass.length + ' exterior glass facets');
  let unmatched = 0, badG = 0;
  const used = new Set();
  for (const f of extGlass) {
    const c = map(cen(f.p));
    let best = -1, bd = Infinity;
    G.forEach((g, i) => { if (used.has(i)) return; const d = Math.hypot(...cen(g).map((v, k) => v - c[k])); if (d < bd) { bd = d; best = i; } });
    if (bd > 0.06) unmatched++; else used.add(best);   // 6 cm: the wall's 2 cm inset plus the facet's chord against the curve
  }
  for (const g of G) {
    if (g.length < 3) badG++;
    for (const q of g) if (!Number.isFinite(q[0] + q[1] + q[2]) || q[0] < B[0] - 1e-6 || q[0] > B[3] + 1e-6
      || q[1] < B[1] - 1e-6 || q[1] > B[4] + 1e-6 || q[2] < B[2] - 1e-6 || q[2] > B[5] + 1e-6) badG++;
  }
  ok(unmatched === 0, unmatched + ' exterior glass facets have no pane within 6 cm');
  ok(badG === 0, badG + ' pane points non-finite or outside the bounds');
  const room = shellFaces(P, REST), pts = new Set(G.flat());
  ok(!room.some((f) => f.p.some((q) => pts.has(q))), 'a glass pane was drawn into shellFaces');
  console.log('  inside/outside: ' + glassN + ' glass probes, ' + bodyN + ' skin probes');
  ok(glassN > 40 && glassBad === 0, glassBad + ' of ' + glassN + ' probes through the exterior glass hit the room');
  ok(bodyN > 100 && bodyBad === 0, bodyBad + ' of ' + bodyN + ' probes at the exterior\'s solid skin see out');
}

// ── (c) EVERY CONTROL MOVES ──────────────────────────────────────────────────
{
  const sig = (faces) => { let s = 0, i = 0; for (const f of faces) for (const q of f.p) { i++; s += (q[0] * 1.3 + q[1] * 2.7 + q[2] * 3.1) * (1 + (i % 97) * 0.01); } return faces.length + ":" + s.toFixed(6); };
  // The eased parts (the mag key, the map lamp) step by wall time: build twice after a pause.
  // ⚠ eased() advances at most 0.1 s a CALL, not per wall-clock second, so settling is ten builds a
  // tenth of a second apart; fewer and the LAST stop's easing is still running and a frozen control reads as moving.
  const settle = (live) => { for (let n = 0; n < 10; n++) { shellFaces(P, live); const t0 = Date.now(); while (Date.now() - t0 < 105); } return shellFaces(P, live); };
  const rgbSig = (faces) => faces.map((f) => (f.rgb ? f.rgb.join(',') + '/' + (f.emis || 0).toFixed(2) : '')).join('|');
  for (const [k, [lo, hi]] of Object.entries(STOPS)) {
    const a = settle({ ...REST, [k]: lo }), b = settle({ ...REST, [k]: hi });
    ok(sig(a) !== sig(b) || rgbSig(a) !== rgbSig(b), k + ' does not move anything between ' + lo + ' and ' + hi);
  }
}

console.log((checks - fails) + '/' + checks + ' checks passed');
process.exit(fails ? 1 : 0);
