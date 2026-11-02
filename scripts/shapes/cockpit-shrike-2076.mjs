// THE GATE FOR THE SHRIKE 2076'S COCKPIT (client/shared/interior-shrike-2076.js).
//
// Five questions, each a way the cockpit can be wrong without anything throwing:
//   (a) is it a room you can sit in and see out of, at rest and with every control at both stops;
//   (b) is it the inside of the OUTSIDE: every vertex inside the hull's skin, and the exterior's
//       compiled canopy glass where the shared layout (cabin-shrike-2076.js) says it is;
//   (c) does every control and every display move: the geometry differs between the stops;
//   (d) is every control in the one forward view, the low ones mirrored there;
//   (e) is the dive page honest: the gate's numbers are the server's, and the derived pull-out
//       height and countdowns behave.
// `node scripts/shapes/cockpit-shrike-2076.mjs`, exit 1 on failure.
import { readFileSync } from 'node:fs';
import { shellFaces, shellBounds, freezeFaces, shellProfileFor } from '../../client/shared/interior-shell.js';
import { shrike2076Profile, DIVE_GATE, diveState, pullOutLossFt } from '../../client/shared/interior-shrike-2076.js';
import { MESH_ROWS } from '../../client/shared/vehicle-meshes.js';
import { compileMesh } from '../../client/shared/vehicle-mesh.js';
import { SH76_STATIONS, SH76_GLASS, sh76Inside, sh76Point } from '../../client/shared/cabin-shrike-2076.js';

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

const P = shrike2076Profile();
ok(!!P, 'shrike2076Profile() built nothing: the 2076 mesh is missing from the bake');
if (!P) { console.log('shrike 2076 cockpit: ' + fails + ' of ' + checks + ' FAILED'); process.exit(1); }
ok(shellProfileFor('divebomber', false, '2076').label === P.label, 'the 2076 edition does not sit in the 2076 seat');
ok(shellProfileFor('divebomber', false, null).label !== P.label, 'the stock Stuka sits in the 2076 seat');
const B = shellBounds(P);

// ── (a) A ROOM, AT REST AND AT EVERY STOP ────────────────────────────────────
function roomChecks(tag, live) {
  const faces = freezeFaces(shellFaces(P, live, { rich: true }));
  ok(faces.length > 0, tag + ': no geometry');
  ok(B[0] < -0.05 && B[1] < -0.05 && B[2] < -0.05 && B[3] > 0.05 && B[4] > 0.05 && B[5] > 0.05, tag + ': the eye is not strictly inside the bounds');
  ok(!cast(faces, [0, 1, 0]), tag + ': something is across the forward view');
  const wy = (P.winY[0] + P.winY[1]) / 2, wz = (P.winZ[0] + P.winZ[1]) / 2;
  const xL = P.xCentre - P.halfW, xR = P.xCentre + P.halfW;
  ok(!castFrom(faces, [0, 0, 0], [xL, wy, wz]), tag + ': the left canopy is blocked');
  ok(!castFrom(faces, [0, 0, 0], [xR, wy, wz]), tag + ': the right canopy is blocked');
  ok(!cast(faces, [0, 0, 1]), tag + ': something is across the glass straight overhead');
  ok(castFrom(faces, [0, 0.9, 0], [0, 0, -1]), tag + ': no floor under the pedals');
  ok(castFrom(faces, [0, 0, (P.backZ + P.roof) / 2], [0, -1, 0]), tag + ': nothing behind');
  const low = P.winZ[0] - 0.3;
  ok(castFrom(faces, [0, 0, 0], [xL, 0, low]), tag + ': no left wall');
  ok(castFrom(faces, [0, 0, 0], [xR, 0, low]), tag + ': no right wall');
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

const REST = { ias: 0, alt: 0, vsi: 0, pitch: 0, bank: 0, hdg: 0, rpm: 0, throttle: 0, fuel: 1, hull: 1, powered: true, stickX: 0, stickY: 0, rudder: 0, trim: 0, flapNotch: 0, hour: 12, phase: 0, bombs: 4 };
const rest = roomChecks('rest', REST);
console.log('shrike 2076: ' + rest.length + ' faces at rest; ' + (B[4] - B[1]).toFixed(2) + ' m long, ' + (B[3] - B[0]).toFixed(2) + ' wide, ' + (B[5] - B[2]).toFixed(2) + ' tall');
ok(rest.length >= 4000 && rest.length <= 14000, 'face count ' + rest.length + ' outside the 4,000 to 14,000 budget');

// ── (c) EVERY CONTROL AND EVERY DISPLAY MOVES ────────────────────────────────
const sig = (faces) => { let s = faces.length * 1e-3; for (const f of faces) { for (const q of f.p) s += Math.sin(q[0] * 37.1 + q[1] * 53.3 + q[2] * 71.7); if (f.rgb) s += (f.rgb[0] * 0.3 + f.rgb[1] * 0.5 + f.rgb[2] * 0.7) * (1 + (f.emis || 0)) * 1e-4; } return s; };
const STOPS = {
  stickX: [-1, 1], stickY: [-1, 1], rudder: [-1, 1], throttle: [0, 1], rpm: [0.2, 1.05], phase: [0, 1.7],
  ias: [0, 300], alt: [0, 4500], vsi: [-6000, 2000], bank: [-45, 45], pitch: [-70, 20], hdg: [0, 135],
  fuel: [0.1, 1], hull: [0.1, 1], powered: [false, true], landingLight: [false, true], dome: [false, true], hour: [12, 23],
  trim: [-1, 1], flapNotch: [0, 3], weaponsArmed: [false, true], bombs: [0, 4], diveBrake: [0, 1], oilTemp: [0.2, 0.9],
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
  for (const [k, a, b, id] of [['throttle', 0, 1, 'throttle'], ['stickX', -1, 1, 'yoke'], ['stickY', -1, 1, 'yoke']]) {
    const c = grip(id, { ...REST, [k]: a });
    const fa = near(shellFaces(P, { ...REST, [k]: a }, { rich: true }), c, 0.12), fb = near(shellFaces(P, { ...REST, [k]: b }, { rich: true }), c, 0.12);
    ok(fa.length > 10 && Math.abs(sig(fa) - sig(fb)) > 1e-6, k + ': the ' + (id === 'yoke' ? 'stick' : 'throttle') + ' does not move with it');
  }
  const pc = [0, 0.95, P.sh76.zF + 0.12];
  const pa = near(shellFaces(P, { ...REST, rudder: -1 }, { rich: true }), pc, 0.3), pb = near(shellFaces(P, { ...REST, rudder: 1 }, { rich: true }), pc, 0.3);
  ok(pa.length > 20 && Math.abs(sig(pa) - sig(pb)) > 1e-6, 'rudder: the yaw pedals do not slide');
}
const DIVING = { ...REST, pitch: -70, ias: 260, alt: 1000, vsi: -9000, rpm: 0.8, throttle: 0.6, weaponsArmed: true, bombs: 3, diveBrake: 1 };
roomChecks('all low', { ...REST, stickX: -1, stickY: -1, rudder: -1, throttle: 0, rpm: 0, bank: -45, pitch: -85 });
roomChecks('all high', { ...REST, stickX: 1, stickY: 1, rudder: 1, throttle: 1, rpm: 1.05, bank: 45, pitch: 25, landingLight: true, dome: true, hour: 23, trim: 1, flapNotch: 3 });
roomChecks('in the dive', DIVING);
{
  const h0 = P.hotspots({ ...REST, stickY: -1, throttle: 0 }), h1 = P.hotspots({ ...REST, stickY: 1, throttle: 1 });
  const at = (hs, id) => hs.find((h) => h.id === id).p;
  ok(at(h0, 'yoke')[1] !== at(h1, 'yoke')[1], 'the stick hotspot does not follow the stick');
  ok(at(h0, 'throttle')[1] < at(h1, 'throttle')[1], 'the throttle hotspot does not go forward with the throttle');
  const ids = h0.map((h) => h.id);
  for (const id of ['ck:master', 'ck:land', 'ck:panel', 'ck:dome', 'ck:flaps', 'ck:arm', 'ck:dive', 'ck:gps', 'yoke', 'throttle', 'trim']) ok(ids.includes(id), 'no ' + id + ' control');
  ok(!ids.some((id) => /^thr\d/.test(id)), 'a one-engine seat has a split throttle');
}

// ── (d) EVERY CONTROL IN ONE FORWARD VIEW ────────────────────────────────────
// The forward look is the eye pitched 12° down with an 85° lens on a 16:9 frame: about ±42° across
// and ±26° up and down. Every click control must be inside it, and the low grabs (the sidestick, the
// throttle and the pedals) must have a mirror inside it that moves: the head-up symbols.
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
  const D = P.sh76, m = P.mPerUnit;
  const gE = -D.X(0) / m, fE = -D.Y(0) / m, hE = -D.Z(0) / m;
  const fNose = SH76_STATIONS[0].f, fTail = SH76_STATIONS[SH76_STATIONS.length - 1].f;
  const every = [...D.faces, ...shellFaces(P, { ...REST, stickX: 1, stickY: 1, rudder: 1, throttle: 1 }, { rich: true }),
    ...shellFaces(P, { ...REST, stickX: -1, stickY: -1, rudder: -1 }, { rich: true }), ...shellFaces(P, DIVING, { rich: true })];
  let outside = 0, n = 0, worst = null;
  for (const f of every) for (const q of f.p) {
    n++;
    const fm = q[1] / m + fE, gm = q[0] / m + gE, hm = q[2] / m + hE;
    if (fm > fNose || fm < fTail || !sh76Inside(fm, gm, hm, 0.0005)) { outside++; if (!worst) worst = [f.tone, fm.toFixed(3), gm.toFixed(3), hm.toFixed(3)]; }
  }
  ok(outside === 0, outside + ' of ' + n + ' cockpit vertices stand outside the hull\'s skin (first: ' + (worst || []).join(' ') + ')');
  // The exterior's compiled canopy is where the shared layout says: every hull glass face on the crown
  // between the layout's stations, and as many of them as the layout's cells.
  // The canopy's panes carry its gold film; the sensor windows and the HUD combiner are glazed too.
  const gold = (f) => f.tint && f.tint[0] === 104 && f.tint[1] === 90 && f.tint[2] === 50;
  const ext = compileMesh(MESH_ROWS.divebomber_2076, { detail: 1 }).faces.filter((f) => f.role === 'glass' && gold(f));
  let stray = 0;
  for (const f of ext) for (const q of f.p) if (q[0] < SH76_GLASS.f[0] - 0.002 || q[0] > SH76_GLASS.f[1] + 0.002) stray++;
  ok(ext.length > 150, 'the exterior has lost its canopy (' + ext.length + ' faces)');
  ok(stray === 0, stray + ' exterior canopy vertices outside the layout\'s stations');
  // Its lowest edge is the layout's sill.
  const sillH = Math.min(...ext.flatMap((f) => f.p.map((q) => q[2])));
  const want = Math.min(sh76Point(SH76_GLASS.f[0], SH76_GLASS.k[0])[2], sh76Point(SH76_GLASS.f[1], SH76_GLASS.k[0])[2]);
  ok(Math.abs(sillH - want) < 0.004, 'the exterior canopy\'s sill (' + sillH.toFixed(4) + ') is not the layout\'s (' + want.toFixed(4) + ')');
  // The room stops being wall where the canopy starts.
  let papered = 0;
  for (const f of D.faces) {
    if (f.tone !== 'hdr' && f.tone !== 'pil') continue;
    const c = f.p.reduce((s, q) => [s[0] + q[0] / f.p.length, s[1] + q[1] / f.p.length, s[2] + q[2] / f.p.length], [0, 0, 0]);
    const fm = c[1] / m + fE, hm = c[2] / m + hE;
    const sill = sh76Point(fm, SH76_GLASS.k[0])[2];
    if (fm > SH76_GLASS.f[0] + 0.01 && fm < SH76_GLASS.f[1] - 0.01 && hm > sill + 0.01) papered++;
  }
  ok(papered === 0, papered + ' lining faces stand over the canopy: it is walled in');
}

// ── (e) THE DIVE PAGE IS THE SERVER'S GATE, AND ITS DERIVED NUMBERS BEHAVE ───
{
  const src = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
  const constOf = (text, name) => { const m = new RegExp('const ' + name + '\\s*=\\s*([0-9.]+)').exec(text); return m ? +m[1] : NaN; };
  const combat = src('plugins/flight/combat.js'), state = src('plugins/flight/state.js'), index = src('plugins/flight/index.js');
  ok(constOf(combat, 'BOMB_DIVE_DEG') === DIVE_GATE.releaseDeg, 'the dive page\'s release angle is not combat.js BOMB_DIVE_DEG');
  ok(constOf(combat, 'BOMB_IAS_MIN') === DIVE_GATE.releaseKt, 'the dive page\'s release speed is not combat.js BOMB_IAS_MIN');
  ok(constOf(combat, 'BOMB_BEST_DEG') === DIVE_GATE.bestDeg, 'the dive page\'s best angle is not combat.js BOMB_BEST_DEG');
  ok(/export const ALT_LOW = \d+, ALT_CRUISE = (\d+)/.exec(state)?.[1] === String(DIVE_GATE.releaseFt), 'the release height is not state.js ALT_CRUISE');
  ok(/altitude_band === 'high'\) return advise/.test(combat), 'cmdBomb no longer refuses the high band, so the release height means nothing');
  ok(constOf(index, 'DIVE_ANNOUNCE_DEG') === DIVE_GATE.alertDeg, 'the alert angle is not index.js DIVE_ANNOUNCE_DEG');
  const R = (o) => ({ pitch: 0, ias: 0, alt: 0, vsi: 0, armed: false, bombs: 0, ...o });
  ok(pullOutLossFt(0, 300) === 0, 'a level pull-out costs height');
  ok(pullOutLossFt(80, 300) > pullOutLossFt(45, 300) && pullOutLossFt(60, 300) > pullOutLossFt(60, 150), 'the pull-out loss does not grow with the dive and the speed');
  const d1 = diveState(R({ pitch: -60, ias: 200, alt: 3000, vsi: -9000, armed: true, bombs: 2 }));
  ok(d1.alert && !d1.ready && !d1.low && Math.abs(d1.toRel - (3000 - 1200) / 9000 * 60) < 1e-9, 'the countdown to the release height is not the height to lose over the sink');
  const d2 = diveState(R({ pitch: -60, ias: 200, alt: 1100, vsi: -9000, armed: true, bombs: 2 }));
  ok(d2.ready && d2.toRel === 0, 'the gate is not open at 60 degrees, 200 kt, 1100 ft, armed, with bombs');
  ok(!diveState(R({ pitch: -60, ias: 200, alt: 1100, vsi: -9000, armed: false, bombs: 2 })).ready, 'the gate opens unarmed');
  ok(!diveState(R({ pitch: -30, ias: 200, alt: 1100, vsi: -9000, armed: true, bombs: 2 })).ready, 'the gate opens at 30 degrees');
  ok(!diveState(R({ pitch: -60, ias: 120, alt: 1100, vsi: -9000, armed: true, bombs: 2 })).ready, 'the gate opens at 120 knots');
  ok(diveState(R({ pitch: -20, ias: 200, alt: 3000, vsi: -2000 })).alert === false, 'the alert goes out at 20 degrees');
  ok(diveState(R({ pitch: 5, ias: 200, alt: 3000, vsi: 500 })).toRel == null, 'a climb counts down');
  ok(diveState(R({ pitch: -70, ias: 300, alt: 300, vsi: -9000 })).pullNow, 'no pull-up under the pull-out height');
}

console.log('shrike 2076 cockpit: ' + (fails ? fails + ' of ' + checks + ' FAILED' : checks + ' checks passed'));
process.exit(fails ? 1 : 0);
