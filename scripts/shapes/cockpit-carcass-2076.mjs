// THE GATE FOR THE CARCASS 2076'S COCKPIT (client/shared/interior-carcass-2076.js).
//
// Five questions, each a way the cockpit can be wrong without anything throwing:
//   (a) is it a room you can sit in and see out of, at rest and with every control at both stops;
//   (b) is it the inside of the OUTSIDE: every vertex inside the fuselage's skin, and the exterior's
//       compiled glass where the shared layout (cabin-carcass-2076.js) says it is;
//   (c) does every control and every display move: the geometry differs between the stops, with the
//       decoration's clock held still so a flicker can't pass for a reading;
//   (d) is every click control in the one forward view, and every low grab mirrored there;
//   (e) is the decoration decoration: the flicker, the dead page and the hologram's glitch move on the
//       wall clock alone, and the burn on the engine page is the throttle's and the rpm's.
// `node scripts/shapes/cockpit-carcass-2076.mjs`, exit 1 on failure.
import { shellFaces, shellBounds, freezeFaces, shellProfileFor } from '../../client/shared/interior-shell.js';
import { carcass2076Profile, CR76_DECO, fuelFlow, BURN_LPH } from '../../client/shared/interior-carcass-2076.js';
import { MESH_ROWS } from '../../client/shared/vehicle-meshes.js';
import { compileMesh } from '../../client/shared/vehicle-mesh.js';
import { CR76_STATIONS as CAB_STATIONS, CR76_GLASS as CAB_GLASS, cr76Section as cabSection } from '../../client/shared/cabin-carcass-2076.js';

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('  FAIL  ' + msg); } };

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

// The decoration's clock, held still for everything but (e).
CR76_DECO.t = 0;
const P = carcass2076Profile();
ok(!!P, 'carcass2076Profile() built nothing: the 2076 mesh is missing from the bake');
if (!P) { console.log('carcass 2076 cockpit: ' + fails + ' of ' + checks + ' FAILED'); process.exit(1); }
ok(shellProfileFor('wreck', false, '2076').label === P.label, 'the 2076 edition does not sit in the 2076 seat');
ok(shellProfileFor('wreck', false, null).label !== P.label, 'the stock Carcass sits in the 2076 seat');
ok(MESH_ROWS.wreck && MESH_ROWS.wreck.variants && MESH_ROWS.wreck.variants['2076'] === 'wreck_2076', 'mesh_wreck.json does not name wreck_2076 as its 2076 variant');
const B = shellBounds(P);

// ── (a) A ROOM, AT REST AND AT EVERY STOP ────────────────────────────────────
function roomChecks(tag, live) {
  const faces = freezeFaces(shellFaces(P, live, { rich: true }));
  ok(faces.length > 0, tag + ': no geometry');
  ok(B[0] < -0.05 && B[1] < -0.05 && B[2] < -0.05 && B[3] > 0.05 && B[4] > 0.05 && B[5] > 0.05, tag + ': the eye is not strictly inside the bounds');
  ok(!cast(faces, [0, 1, 0]), tag + ': something is across the forward view');
  const wy = (P.winY[0] + P.winY[1]) / 2, wz = (P.winZ[0] + P.winZ[1]) / 2;
  const xL = P.xCentre - P.halfW, xR = P.xCentre + P.halfW;
  ok(!castFrom(faces, [0, 0, 0], [xL, wy, wz]), tag + ': the left side of the bubble is blocked');
  ok(!castFrom(faces, [0, 0, 0], [xR, wy, wz]), tag + ': the right side of the bubble is blocked');
  ok(!cast(faces, [0, 0, 1]), tag + ': something is across the bubble straight overhead');
  ok(castFrom(faces, [0, 0.9, 0], [0, 0, -1]), tag + ': no floor under the pedals');
  ok(castFrom(faces, [0, 0, (P.backZ + P.roof) / 2], [0, -1, 0]), tag + ': nothing behind the pilot');
  const low = P.winZ[0] - 0.3;
  ok(castFrom(faces, [0, 0, 0], [xL, 0, low]), tag + ': no left wall under the sill');
  ok(castFrom(faces, [0, 0, 0], [xR, 0, low]), tag + ': no right wall under the sill');
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

const REST = { ias: 0, alt: 0, vsi: 0, pitch: 0, bank: 0, hdg: 0, rpm: 0, throttle: 0, fuel: 1, hull: 1, powered: true, stickX: 0, stickY: 0, rudder: 0, trim: 0, flapNotch: 0, hour: 12, phase: 0, oilTemp: 0.4 };
const rest = roomChecks('rest', REST);
console.log('carcass 2076: ' + rest.length + ' faces at rest; ' + (B[4] - B[1]).toFixed(2) + ' m long, ' + (B[3] - B[0]).toFixed(2) + ' wide, ' + (B[5] - B[2]).toFixed(2) + ' tall');
ok(rest.length >= 4000 && rest.length <= 12000, 'face count ' + rest.length + ' outside the 4,000 to 12,000 budget');

// ── (c) EVERY CONTROL AND EVERY DISPLAY MOVES ────────────────────────────────
const sig = (faces) => { let s = faces.length * 1e-3; for (const f of faces) { for (const q of f.p) s += Math.sin(q[0] * 37.1 + q[1] * 53.3 + q[2] * 71.7); if (f.rgb) s += (f.rgb[0] * 0.3 + f.rgb[1] * 0.5 + f.rgb[2] * 0.7) * (1 + (f.emis || 0)) * 1e-4; } return s; };
const STOPS = {
  stickX: [-1, 1], stickY: [-1, 1], rudder: [-1, 1], throttle: [0, 1], rpm: [0.2, 1.05], phase: [0, 1.7],
  ias: [0, 120], alt: [0, 4500], vsi: [-1500, 1500], bank: [-45, 45], pitch: [-20, 20], hdg: [0, 135],
  fuel: [0.1, 1], hull: [0.1, 1], powered: [false, true], landingLight: [false, true], dome: [false, true], hour: [12, 23],
  trim: [-1, 1], flapNotch: [0, 3], oilTemp: [0.3, 0.95],
};
for (const [k, [a, b]] of Object.entries(STOPS)) {
  const base = k === 'phase' ? { ...REST, rpm: 1 } : REST;
  const fa = roomChecks(k + '=' + a, { ...base, [k]: a });
  const fb = roomChecks(k + '=' + b, { ...base, [k]: b });
  ok(Math.abs(sig(fa) - sig(fb)) > 1e-6, k + ': the geometry is identical at both stops; the control or display does not move');
}
// Each grip moves itself, not just a display reading the same value.
{
  const near = (faces, c, r) => faces.filter((f) => f.p.every((q) => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) < r));
  const grip = (id, live) => P.hotspots(live).find((h) => h.id === id).p;
  for (const [k, a, b, id] of [['throttle', 0, 1, 'throttle'], ['stickX', -1, 1, 'yoke'], ['stickY', -1, 1, 'yoke'], ['trim', -1, 1, 'trim']]) {
    const c = grip(id, { ...REST, [k]: a });
    const fa = near(shellFaces(P, { ...REST, [k]: a }, { rich: true }), c, 0.14), fb = near(shellFaces(P, { ...REST, [k]: b }, { rich: true }), c, 0.14);
    ok(fa.length > 10 && Math.abs(sig(fa) - sig(fb)) > 1e-6, k + ': the ' + id + ' does not move with it');
  }
  const pc = [0, 0.98, P.cr76.zF + 0.12];
  const pa = near(shellFaces(P, { ...REST, rudder: -1 }, { rich: true }), pc, 0.3), pb = near(shellFaces(P, { ...REST, rudder: 1 }, { rich: true }), pc, 0.3);
  ok(pa.length > 20 && Math.abs(sig(pa) - sig(pb)) > 1e-6, 'rudder: the pedals do not slide');
  // The dome toggle throws: its bat is near the dome hotspot.
  const dc = grip('ck:dome', REST);
  const da = near(shellFaces(P, { ...REST, dome: false }, { rich: true }), dc, 0.04), db = near(shellFaces(P, { ...REST, dome: true }, { rich: true }), dc, 0.04);
  ok(da.length > 10 && Math.abs(sig(da) - sig(db)) > 1e-6, 'dome: the old toggle does not throw');
}
roomChecks('all low', { ...REST, stickX: -1, stickY: -1, rudder: -1, throttle: 0, rpm: 0, bank: -45, pitch: -25 });
roomChecks('all high', { ...REST, stickX: 1, stickY: 1, rudder: 1, throttle: 1, rpm: 1.05, bank: 45, pitch: 25, landingLight: true, dome: true, hour: 23, trim: 1, flapNotch: 3 });
{
  const h0 = P.hotspots({ ...REST, stickY: -1, throttle: 0 }), h1 = P.hotspots({ ...REST, stickY: 1, throttle: 1 });
  const at = (hs, id) => hs.find((h) => h.id === id).p;
  ok(at(h0, 'yoke')[1] !== at(h1, 'yoke')[1], 'the stick hotspot does not follow the stick');
  ok(at(h0, 'throttle')[1] < at(h1, 'throttle')[1], 'the throttle hotspot does not go forward with the throttle');
  const ids = new Set(h0.map((h) => h.id));
  for (const id of ['ck:master', 'ck:land', 'ck:panel', 'ck:dome', 'ck:flaps', 'ck:gps', 'yoke', 'throttle', 'trim']) ok(ids.has(id), 'no ' + id + ' control: the old tub had one');
}

// ── (d) EVERY CONTROL IN ONE FORWARD VIEW ────────────────────────────────────
// The forward look is the eye pitched 12° down with an 85° lens on a 16:9 frame: about ±42° across
// and ±26° up and down. Every click control must be inside it, and the low grabs (the stick, the
// throttle and the pedals) must have a mirror inside it that moves: the projected HUD's symbols.
{
  const PITCH = -12, HALF_X = 42, HALF_Y = 26;
  const inView = (p) => {
    const yaw = Math.atan2(p[0], p[1]) * 180 / Math.PI, el = Math.atan2(p[2], Math.hypot(p[0], p[1])) * 180 / Math.PI;
    return Math.abs(yaw) <= HALF_X && el >= PITCH - HALF_Y && el <= PITCH + HALF_Y;
  };
  for (const h of P.hotspots({ ...REST })) if (h.kind === 'click') ok(inView(h.p), h.id + ' is outside the forward view (' + h.p.map((v) => v.toFixed(2)).join(', ') + ')');
  const forward = (live) => shellFaces(P, live, { rich: true }).filter((f) => f.p.every(inView) && f.p.every((q) => q[1] > 0.3));
  for (const [k, a, b] of [['stickX', -1, 1], ['stickY', -1, 1], ['throttle', 0, 1], ['rudder', -1, 1]]) {
    ok(Math.abs(sig(forward({ ...REST, powered: true, [k]: a })) - sig(forward({ ...REST, powered: true, [k]: b }))) > 1e-6, k + ': nothing in the forward view shows it moving');
  }
}

// ── (b) THE INSIDE IS THE INSIDE OF THE OUTSIDE ──────────────────────────────
{
  const D = P.cr76, m = P.mPerUnit;
  const gE = -D.X(0) / m, fE = -D.Y(0) / m, hE = -D.Z(0) / m;
  const fNose = CAB_STATIONS[0].f, fTail = CAB_STATIONS[CAB_STATIONS.length - 1].f;
  const inside = (f, g, h) => {
    if (f > fNose || f < fTail) return false;
    const s = cabSection(f), e = 1 - s.boxy * 0.55, dh = h - s.cz;
    const rv = dh >= 0 ? s.rvT : s.rvB;
    return Math.pow(Math.abs(g) / s.rg, 2 / e) + Math.pow(Math.abs(dh) / rv, 2 / e) <= 1.0005;
  };
  const every = [...D.faces, ...shellFaces(P, { ...REST, stickX: 1, stickY: 1, rudder: 1, throttle: 1, bank: 45, pitch: 25 }, { rich: true }), ...shellFaces(P, { ...REST, stickX: -1, stickY: -1, rudder: -1, bank: -45, pitch: -25 }, { rich: true })];
  let outside = 0, n = 0, worst = null;
  for (const f of every) for (const q of f.p) {
    n++;
    const fm = q[1] / m + fE, gm = q[0] / m + gE, hm = q[2] / m + hE;
    if (!inside(fm, gm, hm)) { outside++; if (!worst) worst = [f.tone, fm.toFixed(3), gm.toFixed(3), hm.toFixed(3)]; }
  }
  ok(outside === 0, outside + ' of ' + n + ' cockpit vertices stand outside the fuselage\'s skin (first: ' + (worst || []).join(' ') + ')');
  // The exterior's glass on the fuselage is where the shared layout says: nothing glazed outside the bubble.
  const GB = CAB_GLASS.bubble;
  const ext = compileMesh(MESH_ROWS.wreck_2076, { detail: 1 }).faces.filter((f) => f.role === 'glass' && f.p.every((q) => Math.abs(q[1]) < 0.2 && q[2] > -0.05));
  let stray = 0;
  for (const f of ext) for (const q of f.p) if (q[0] < GB.f[0] - 0.012 || q[0] > GB.f[1] + 0.012) stray++;
  ok(ext.length > 200, 'the exterior has lost its bubble (' + ext.length + ' faces)');
  ok(stray === 0, stray + ' exterior glass vertices outside the layout\'s bubble');
  // The room stops being wall where the bubble starts.
  let papered = 0;
  const yW = (GB.f[0] - fE) * m, yW1 = (GB.f[1] - fE) * m;
  for (const f of D.faces) {
    if (f.tone !== 'hdr' && f.tone !== 'pil') continue;
    const c = f.p.reduce((s, q) => [s[0] + q[0] / f.p.length, s[1] + q[1] / f.p.length, s[2] + q[2] / f.p.length], [0, 0, 0]);
    const fm = c[1] / m + fE, gm = c[0] / m + gE, hm = c[2] / m + hE;
    const s = cabSection(fm), e = 1 - s.boxy * 0.55, dh = hm - s.cz;
    const a = Math.atan2(Math.sign(dh) * Math.pow(Math.abs(dh) / (dh >= 0 ? s.rvT : s.rvB), 1 / e), Math.sign(gm) * Math.pow(Math.abs(gm) / s.rg, 1 / e)) * 180 / Math.PI;
    if (c[1] > yW + 0.02 && c[1] < yW1 - 0.02 && a > GB.a[0] + 3 && a < 180 - (GB.a[0] + 3)) papered++;
  }
  ok(papered === 0, papered + ' lining faces stand over the bubble: the canopy is walled in');
  // The hull is open under the bubble on the outside too, or nobody could see in.
  const hullOver = compileMesh(MESH_ROWS.wreck_2076, { detail: 1 }).faces.filter((f) => f.role === 'body' && f.p.every((q) => q[0] > GB.f[0] + 0.01 && q[0] < GB.f[1] - 0.01 && q[2] > 0.16 && Math.abs(q[1]) < 0.05));
  ok(hullOver.length === 0, hullOver.length + ' hull faces over the bubble: the exterior hides the cockpit');
}

// ── (e) DECORATION IS DECORATION, AND THE BURN IS THE ENGINE'S ───────────────
{
  const FLY = { ...REST, rpm: 0.9, throttle: 0.7, alt: 1200, ias: 80, hdg: 200 };
  const at = (t) => { CR76_DECO.t = t; return sig(shellFaces(P, FLY, { rich: true })); };
  // Let the eased switches and the press pulses from the stops above settle on the real clock first.
  // eased() steps at most 0.1 s a call, so settling takes calls as well as time.
  for (let i = 0; i < 30; i++) { at(0); await new Promise((r) => setTimeout(r, 60)); }
  const s0 = at(0), s1 = at(0), sMany = [0.37, 1.13, 2.71, 5.05, 7.9].map(at);
  ok(Math.abs(s0 - s1) < 1e-6, 'the cockpit moves with the decoration clock held still (' + (s0 - s1) + ')');
  ok(sMany.some((s) => Math.abs(s - s0) > 1e-6), 'nothing flickers or glitches: the decoration clock moves nothing');
  CR76_DECO.t = 0;
  const R = (o) => ({ powered: true, rpm: 1, thr: 1, ...o });
  ok(fuelFlow(R({ powered: false })) === 0 && fuelFlow(R({ rpm: 0 })) === 0, 'the engine page burns fuel with the engine stopped');
  ok(Math.abs(fuelFlow(R({})) - BURN_LPH) < 1e-9, 'full throttle at full rpm is not the full burn');
  ok(fuelFlow(R({ thr: 0.3 })) < fuelFlow(R({ thr: 0.8 })), 'more throttle does not burn more');
}

console.log('carcass 2076 cockpit: ' + (fails ? fails + ' of ' + checks + ' FAILED' : checks + ' checks passed'));
process.exit(fails ? 1 : 0);
