// THE GATE FOR THE DRAGONFLY'S COCKPIT (client/shared/interior-dragonfly.js).
//
// Three questions, each a way the cockpit can be wrong without anything throwing:
//   (a) is it a room you can sit in and see out of — shell.mjs's own ray checks, at rest and with
//       every control at both stops;
//   (b) is it the inside of the OUTSIDE — held against the COMPILED exterior mesh (compileMesh of
//       mesh_heli.json), not against anything the profile says about itself;
//   (c) does every control move — the geometry differs between the stops.
// `node scripts/shapes/cockpit-dragonfly.mjs`, exit 1 on failure.
import { shellFaces, shellBounds, freezeFaces } from '../../client/shared/interior-shell.js';
import { dragonflyProfile } from '../../client/shared/interior-dragonfly.js';
import { MESH_ROWS } from '../../client/shared/vehicle-meshes.js';
import { compileMesh } from '../../client/shared/vehicle-mesh.js';

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('  FAIL  ' + msg); } };

// ── RAY / CONVEX POLYGON — shell.mjs's own, verbatim in behaviour ────────────
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

const P = dragonflyProfile();
ok(!!P, 'dragonflyProfile() built nothing — the exterior lost its cabin loft');
if (!P) { console.log('dragonfly cockpit: ' + fails + ' of ' + checks + ' FAILED'); process.exit(1); }
const B = shellBounds(P);

// ── (a) A ROOM, AT REST AND AT EVERY STOP ────────────────────────────────────
function roomChecks(tag, live) {
  const faces = freezeFaces(shellFaces(P, live));
  ok(faces.length > 0, tag + ': no geometry');
  ok(B[0] < -0.05 && B[1] < -0.05 && B[2] < -0.05 && B[3] > 0.05 && B[4] > 0.05 && B[5] > 0.05, tag + ': the eye is not strictly inside the bounds');
  ok(!cast(faces, [0, 1, 0]), tag + ': something is across the forward view');
  const wy = (P.winY[0] + P.winY[1]) / 2, wz = (P.winZ[0] + P.winZ[1]) / 2;
  const xL = P.xCentre - P.halfW, xR = P.xCentre + P.halfW;
  ok(!castFrom(faces, [0, 0, 0], [xL, wy, wz]), tag + ': the left side glass is blocked');
  ok(!castFrom(faces, [0, 0, 0], [xR, wy, wz]), tag + ': the right side glass is blocked');
  ok(castFrom(faces, [2 * P.xCentre, (P.seatY[1] + P.dashY) / 2, 0], [0, 0, -1]), tag + ': no floor under the passenger footwell');
  ok(cast(faces, [0, 0, 1]), tag + ': no roof overhead');
  ok(castFrom(faces, [0, 0, (P.backZ + P.roof) / 2], [0, -1, 0]), tag + ': no bulkhead behind');
  const low = P.winZ[0] - 0.2;
  ok(castFrom(faces, [0, 0, 0], [xL, 0, low]), tag + ': no left door card');
  ok(castFrom(faces, [0, 0, 0], [xR, 0, low]), tag + ': no right door card');
  const down = cast(faces, [0, 0, -1]);
  ok(down > 0 && down < Math.abs(P.floor) - 1e-6, tag + ': nothing to sit on');
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
  return faces;
}

const REST = { ias: 0, alt: 0, vsi: 0, pitch: 0, bank: 0, hdg: 0, rpm: 0, throttle: 0, fuel: 1, hull: 1, powered: true, stickX: 0, stickY: 0, rudder: 0, hour: 12 };
const rest = roomChecks('rest', REST);
console.log('dragonfly — ' + rest.length + ' faces at rest; ' + (B[4] - B[1]).toFixed(2) + ' m long, ' + (B[3] - B[0]).toFixed(2) + ' wide, ' + (B[5] - B[2]).toFixed(2) + ' tall');
ok(rest.length >= 4000 && rest.length <= 12000, 'face count ' + rest.length + ' outside the 4,000–12,000 budget');

// ── (c) EVERY CONTROL MOVES ──────────────────────────────────────────────────
// ⚠ NOT A LINEAR SUM: a compass rose turned under its lubber line is the same SET of spokes, and a
// weighted sum of their vertices is rotation-invariant for any symmetric card — which read as the
// card not turning. A sine of each vertex is not. A lamp changes COLOUR, not shape, so the colour
// and emission are in the signature too.
const sig = (faces) => { let s = faces.length * 1e-3; for (const f of faces) { for (const q of f.p) s += Math.sin(q[0] * 37.1 + q[1] * 53.3 + q[2] * 71.7); if (f.rgb) s += (f.rgb[0] * 0.3 + f.rgb[1] * 0.5 + f.rgb[2] * 0.7) * (1 + (f.emis || 0)) * 1e-4; } return s; };
// ⚠ NO `pitch`: the Mini-500's panel has no attitude indicator (the kit's list is ASI, altimeter,
// VSI, slip and bank, compass, dual tacho, coolant, hourmeter), so nothing in it reads pitch.
// `trim`, `flapNotch` and `gearDown` are absent for the same reason: no trim, no flaps, skids.
const STOPS = {
  stickX: [-1, 1], stickY: [-1, 1], rudder: [-1, 1], throttle: [0, 1], rpm: [0, 1.05],
  ias: [0, 120], alt: [0, 4500], vsi: [-1500, 1500], bank: [-45, 45], hdg: [0, 135],
  fuel: [0, 1], hull: [0.1, 1], oilTemp: [0, 1], powered: [false, true], landingLight: [false, true], dome: [false, true], hour: [12, 23],
};
for (const [k, [a, b]] of Object.entries(STOPS)) {
  const fa = roomChecks(k + '=' + a, { ...REST, [k]: a });
  const fb = roomChecks(k + '=' + b, { ...REST, [k]: b });
  ok(Math.abs(sig(fa) - sig(fb)) > 1e-6, k + ': the geometry is identical at both stops — the control does not move');
}
// ⚠ AND EACH CONTROL MOVES ITSELF, not just something on the panel that reads the same value: rpm
// turns the tacho needles AND the twist grip, and a frozen twist grip hides behind the needles in a
// whole-cockpit signature. So the parts near each grip are compared on their own.
{
  const near = (faces, c, r) => faces.filter((f) => f.p.every((q) => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) < r));
  const grip = (id, live) => P.hotspots(live).find((h) => h.id === id).p;
  for (const [k, a, b, id] of [['rpm', 0, 1.05, 'throttle'], ['throttle', 0, 1, 'throttle'], ['stickX', -1, 1, 'yoke'], ['stickY', -1, 1, 'yoke']]) {
    const c = grip(id, { ...REST, [k]: a });
    const fa = near(shellFaces(P, { ...REST, [k]: a }), c, 0.16), fb = near(shellFaces(P, { ...REST, [k]: b }), c, 0.16);
    ok(fa.length > 20 && Math.abs(sig(fa) - sig(fb)) > 1e-6, k + ': the ' + (id === 'yoke' ? 'cyclic grip' : 'collective head') + ' does not move with it');
  }
  // The pedals, under the pilot's feet.
  const pc = [0, 0.66, P.dragonfly.zF + 0.12];
  const pa = near(shellFaces(P, { ...REST, rudder: -1 }), pc, 0.3), pb = near(shellFaces(P, { ...REST, rudder: 1 }), pc, 0.3);
  ok(pa.length > 20 && Math.abs(sig(pa) - sig(pb)) > 1e-6, 'rudder: the pedals do not move');
}
// All at once, both ends.
roomChecks('all low', { ...REST, stickX: -1, stickY: -1, rudder: -1, throttle: 0, rpm: 0, bank: -45, pitch: -25 });
roomChecks('all high', { ...REST, stickX: 1, stickY: 1, rudder: 1, throttle: 1, rpm: 1.05, bank: 45, pitch: 25, landingLight: true, dome: true, hour: 23 });
// The hotspots follow the controls they are on.
{
  const h0 = P.hotspots({ ...REST, stickY: -1, throttle: 0 }), h1 = P.hotspots({ ...REST, stickY: 1, throttle: 1 });
  const at = (hs, id) => hs.find((h) => h.id === id).p;
  ok(at(h0, 'yoke')[1] !== at(h1, 'yoke')[1], 'the cyclic hotspot does not follow the stick');
  ok(at(h0, 'throttle')[2] < at(h1, 'throttle')[2], 'the collective hotspot does not rise with the collective');
}

// ── (b) THE INSIDE IS THE INSIDE OF THE OUTSIDE ──────────────────────────────
// Measured off the compiled exterior: the faces the renderer actually draws.
{
  const ext = compileMesh(MESH_ROWS.heli).faces;
  const glass = ext.filter((f) => f.role === 'glass');
  ok(glass.length > 0, 'the exterior has no glass faces');
  // The aft edge of the glass, from the glass faces themselves.
  let gAft = Infinity, fNose = -Infinity, fTail = Infinity;
  for (const f of glass) for (const q of f.p) gAft = Math.min(gAft, q[0]);
  for (const f of ext) if (f.role !== 'rotor') for (const q of f.p) { fNose = Math.max(fNose, q[0]); fTail = Math.min(fTail, q[0]); }
  const m = 6.9 / (fNose - fTail);
  ok(Math.abs(m - P.mPerUnit) < 0.02, 'metres per unit ' + P.mPerUnit.toFixed(3) + ' is not 6.9 m over the exterior\'s length (' + m.toFixed(3) + ')');
  // Where the eye is in the model, recovered from the floor's own height and the scale.
  const D = P.dragonfly;
  const fE = D.fB - D.Y(D.fB) / m;   // Y(f) = (f - fE) m  =>  fE = f - Y/m
  const gAftY = (gAft - fE) * m;
  ok(Math.abs(gAftY - P.glassAftY) < 0.01, 'the room stops being wall at y ' + P.glassAftY.toFixed(3) + ' but the exterior glass stops at ' + gAftY.toFixed(3));
  // No lining face stands forward of the glass's aft edge: the bubble is not papered over inside.
  const walls = D.faces.filter((f) => f.tone === 'pil' || f.tone === 'hdr');
  let papered = 0;
  for (const f of walls) { const cy = f.p.reduce((s, q) => s + q[1], 0) / f.p.length; if (cy > gAftY + 0.03) papered++; }
  ok(papered === 0, papered + ' lining faces stand forward of the exterior glass — the bubble is walled in');
  // Every room vertex is INSIDE the exterior skin and the lining is within a wall's thickness of it.
  // ⚠ THE SKIN IS THE DRAWN 14-GON, NOT AN ELLIPSE FITTED TO IT: the loft's top vertex is at 3.5/14 of a
  // turn short of the crown, so a fitted ellipse is 2.5% short in height and calls the headlining
  // outside the aircraft. Each compiled ring is sorted by angle, neighbouring rings are blended vertex
  // by vertex (emitLoft skins ring k to ring k), and the test is a 2-D point-in-polygon.
  const cab = ext.filter((f) => f.role === 'body' || f.role === 'glass');
  const rings = new Map();
  for (const f of cab) for (const q of f.p) {
    if (q[0] < -0.25) continue;
    const k = q[0].toFixed(4); if (!rings.has(k)) rings.set(k, new Map()); rings.get(k).set(q[1].toFixed(5) + ',' + q[2].toFixed(5), q);
  }
  const ringOf = new Map();
  for (const [k, mp] of rings) {
    const pts = [...mp.values()];
    if (pts.length === 1) { ringOf.set(+k, Array.from({ length: 14 }, () => pts[0])); continue; }   // the nose apex
    if (pts.length < 10) continue;
    const cz = pts.reduce((s2, q) => s2 + q[2], 0) / pts.length;
    ringOf.set(+k, pts.slice().sort((p, q) => Math.atan2(p[2] - cz, p[1]) - Math.atan2(q[2] - cz, q[1])));
  }
  const fs2 = [...ringOf.keys()].sort((x, y) => x - y);
  const polyAt = (f) => {
    for (let i = 0; i < fs2.length - 1; i++) if (f >= fs2[i] && f <= fs2[i + 1]) {
      const A = ringOf.get(fs2[i]), Bq = ringOf.get(fs2[i + 1]), t = (f - fs2[i]) / (fs2[i + 1] - fs2[i]);
      if (A.length !== Bq.length) return null;
      return A.map((p, k) => [p[1] + (Bq[k][1] - p[1]) * t, p[2] + (Bq[k][2] - p[2]) * t]);
    }
    return null;
  };
  const inPoly = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const edgeDist = (x, y, poly) => { let d = Infinity; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [ax, ay] = poly[j], [bx, by] = poly[i], ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1, t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)); d = Math.min(d, Math.hypot(x - ax - ex * t, y - ay - ey * t)); } return d; };
  const mI = P.mPerUnit;                     // back through the interior's own bridge
  const fEi = D.fB - D.Y(D.fB) / mI , hE = -D.Z(0) / mI;
  let outside = 0, deep = 0, n = 0;
  // ⚠ EVERYTHING, NOT JUST THE ROOM: a seat base wider than the floor it stands on is the classic way
  // an interior goes through its own hull, and the room alone cannot show it.
  const every = [...D.faces, ...shellFaces(P, { ...REST, stickX: 1, stickY: 1, rudder: 1, throttle: 1 }), ...shellFaces(P, { ...REST, stickX: -1, stickY: -1, rudder: -1 })];
  for (const f of every) for (const q of f.p) {
    const fm = q[1] / mI + fEi, h = q[2] / mI + hE;
    const gm = q[0] / mI - D.X(0) / mI;    // X(g) = (g - gE) m and X(0) = -gE m, so g = x/m + gE = x/m - X(0)/m
    const poly = polyAt(fm);
    if (!poly) continue;
    n++;
    if (!inPoly(gm, h, poly) && edgeDist(gm, h, poly) * mI > 0.002) { outside++; if (process.env.DBG) console.log('out', f.tone, f.rgb, fm.toFixed(3), gm.toFixed(3), h.toFixed(3), (edgeDist(gm, h, poly) * mI).toFixed(3)); }
    else if ((f.tone === 'pil' || f.tone === 'hdr') && edgeDist(gm, h, poly) * mI > 0.12) deep++;
  }
  ok(n > 500, 'only ' + n + ' room vertices compared against the skin');
  ok(outside === 0, outside + ' of ' + n + ' room vertices are OUTSIDE the exterior skin');
  ok(deep === 0, deep + ' lining vertices are more than 12 cm in from the skin — the room is not the inside of this hull');
  const axes = (f) => { const r = ringOf.get(f); return { rg: Math.max(...r.map((q) => Math.abs(q[1]))) }; };
  const fs = fs2;
  // The cabin is as wide as the exterior says, to within the wall.
  let wMax = 0;
  for (const f of fs) if (f > 0.0 && f < 0.31) wMax = Math.max(wMax, axes(f).rg);
  const extW = 2 * wMax * m, roomW = B[3] - B[0];
  ok(Math.abs(extW - roomW - 2 * 0.045) < 0.08, 'room width ' + roomW.toFixed(2) + ' m against exterior ' + extW.toFixed(2) + ' m less two walls');
  console.log('    exterior: ' + (fNose - fTail).toFixed(3) + ' units → ' + m.toFixed(3) + ' m/unit; glass aft edge ' + gAftY.toFixed(3) + ' m ahead of the eye; cabin ' + extW.toFixed(2) + ' m outside, room ' + roomW.toFixed(2) + ' m');
}

// ── (d) THE GLASS ────────────────────────────────────────────────────────────
// Every glazed facet of the COMPILED exterior has a pane of film, a few mm inside it; every pane is
// finite and in the bounds; and the film is not geometry (the sight-line rays above ran through it).
{
  const ext = compileMesh(MESH_ROWS.heli).faces.filter((f) => f.role === 'glass');
  const G = P.glass || [];
  const D = P.dragonfly, mI = P.mPerUnit, fE = D.fB - D.Y(D.fB) / mI;
  const toModel = (q) => [q[1] / mI + fE, q[0] / mI - D.X(0) / mI, q[2] / mI - D.Z(0) / mI];
  const cen = (pts) => pts.reduce((s, q) => [s[0] + q[0] / pts.length, s[1] + q[1] / pts.length, s[2] + q[2] / pts.length], [0, 0, 0]);
  const used = new Set();
  let unmatched = 0;
  for (const f of ext) {
    const c = cen(f.p);
    let best = -1, bd = Infinity;
    G.forEach((pn, i) => { if (used.has(i) || pn.length !== f.p.length) return; const d = Math.hypot(...cen(pn.map(toModel)).map((v, k) => v - c[k])) * mI; if (d < bd) { bd = d; best = i; } });
    if (best < 0 || bd > 0.015) unmatched++; else used.add(best);
  }
  ok(ext.length > 0 && unmatched === 0, unmatched + ' of ' + ext.length + ' exterior glass facets have no pane within 1.5 cm');
  ok(G.bubble === ext.length, 'the bubble has ' + G.bubble + ' panes against ' + ext.length + ' exterior glass facets');
  let bad = 0;
  for (const pn of G) for (const q of pn) {
    if (!Number.isFinite(q[0] + q[1] + q[2]) || q[0] < B[0] - 1e-6 || q[0] > B[3] + 1e-6 || q[1] < B[1] - 1e-6 || q[1] > B[4] + 1e-6 || q[2] < B[2] - 1e-6 || q[2] > B[5] + 1e-6) bad++;
  }
  ok(bad === 0, bad + ' glass vertices non-finite or outside the bounds');
  const all = shellFaces(P, REST);
  ok(!all.some((f) => G.some((pn) => pn === f.p)), 'a glass pane is in shellFaces — it would block the sight lines');
  ok(G.length >= ext.length + 18, 'the door windows have no glass (' + (G.length - ext.length) + ' extra panes)');
  console.log('    glass: ' + G.bubble + ' bubble panes for ' + ext.length + ' exterior facets, ' + (G.length - G.bubble) + ' door-window facets');
}

console.log('dragonfly cockpit: ' + (fails ? fails + ' of ' + checks + ' FAILED' : checks + ' checks passed'));
process.exit(fails ? 1 : 0);
