// THE GATE FOR THE DRAKE 2076'S COCKPIT (client/shared/interior-drake-2076.js).
//
// Six questions, each a way the refit can be wrong without anything throwing:
//   (a) is it a room you can sit in and see out of, at rest and with every control at both stops;
//   (b) is it still the inside of the head: every vertex of the fit-out forward of the seat inside
//       the head loft's skin, and the room the one the stock Drake's mesh `cabin` block builds;
//   (c) does every control and every display move, the Drake's own channels included (the wings,
//       the rotor fold, the boat, the gear, the mode, the ramp, the stores, the convergence);
//   (d) is every Drake control still here and wired, and is each one reachable in the forward view,
//       with the low grabs (yoke, throttle, pedals) mirrored in the HUD;
//   (e) do the pages boot in turn when the power comes on;
//   (f) is every other Drake trim's cockpit left alone.
// `node scripts/shapes/cockpit-drake-2076.mjs`, exit 1 on failure.
import { shellFaces, shellBounds, freezeFaces, shellProfileFor, SHELL_PROFILES } from '../../client/shared/interior-shell.js';
import { drake2076Profile } from '../../client/shared/interior-drake-2076.js';
import { drakeHotspots } from '../../client/shared/interior-drake.js';
import { MESH_ROWS } from '../../client/shared/vehicle-meshes.js';
import { readDkTables } from './dk-tables.mjs';

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

const P = drake2076Profile();
ok(!!P, 'drake2076Profile() built nothing: the 2076 mesh or its cabin block is missing from the bake');
if (!P) { console.log('drake 2076 cockpit: ' + fails + ' of ' + checks + ' FAILED'); process.exit(1); }
ok(!!MESH_ROWS.drake_2076, 'mesh_drake_2076 is not baked into vehicle-meshes.js');
ok(shellProfileFor('drake', false, '2076').label === P.label, 'the 2076 edition does not sit in the 2076 refit');
const B = shellBounds(P);

// ── (a) A ROOM, AT REST AND AT EVERY STOP ────────────────────────────────────
function roomChecks(tag, live) {
  const faces = freezeFaces(shellFaces(P, live, { rich: true }));
  ok(faces.length > 0, tag + ': no geometry');
  ok(B[0] < -0.05 && B[1] < -0.05 && B[2] < -0.05 && B[3] > 0.05 && B[4] > 0.05 && B[5] > 0.05, tag + ': the eye is not strictly inside the bounds');
  ok(!cast(faces, [0, 1, 0]), tag + ': something is across the forward view');
  const wy = (P.winY[0] + P.winY[1]) / 2, wz = (P.winZ[0] + P.winZ[1]) / 2;
  const xL = P.xCentre - P.halfW, xR = P.xCentre + P.halfW;
  ok(!castFrom(faces, [0, 0, 0], [xL, wy, wz]), tag + ': the left eye is blocked');
  ok(!castFrom(faces, [0, 0, 0], [xR, wy, wz]), tag + ': the right eye is blocked');
  ok(castFrom(faces, [2 * P.xCentre, (P.seatY[1] + P.dashY) / 2, 0], [0, 0, -1]), tag + ': no floor under the footwell');
  ok(cast(faces, [0, 0, 1]), tag + ': no crown overhead');
  ok(castFrom(faces, [0, 0, (P.backZ + P.roof) / 2], [0, -1, 0]), tag + ': no back to the head');
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

const REST = { ias: 0, alt: 0, vsi: 0, pitch: 0, bank: 0, hdg: 0, rpm: 0, throttle: 0, fuel: 1, hull: 1, powered: true, stickX: 0, stickY: 0, rudder: 0, hour: 12, phase: 0,
  gear: 1, wings: 0, rotorFold: 0, boat: 0, convert: 0, mode: 0, ramp: 0, trim: 0 };
const rest = roomChecks('rest', REST);
console.log('drake 2076: ' + rest.length + ' faces at rest; ' + (B[4] - B[1]).toFixed(2) + ' m long, ' + (B[3] - B[0]).toFixed(2) + ' wide, ' + (B[5] - B[2]).toFixed(2) + ' tall');
ok(rest.length >= 8000 && rest.length <= 22000, 'face count ' + rest.length + ' outside the 8,000 to 22,000 budget');

// ── (c) EVERY CONTROL AND EVERY DISPLAY MOVES ────────────────────────────────
const sig = (faces) => { let s = faces.length * 1e-3; for (const f of faces) { for (const q of f.p) s += Math.sin(q[0] * 37.1 + q[1] * 53.3 + q[2] * 71.7); if (f.rgb) s += (f.rgb[0] * 0.3 + f.rgb[1] * 0.5 + f.rgb[2] * 0.7) * (1 + (f.emis || 0)) * 1e-4; } return s; };
const STOPS = {
  stickX: [-1, 1], stickY: [-1, 1], rudder: [-1, 1], throttle: [0, 1], rpm: [0.2, 1.05], phase: [0, 1.7], trim: [-0.6, 0.6],
  ias: [0, 120], alt: [0, 4500], vsi: [-1500, 1500], bank: [-45, 45], pitch: [-20, 20], hdg: [0, 135],
  fuel: [0.1, 1], hull: [0.1, 1], powered: [false, true], landingLight: [false, true], dome: [false, true], hour: [12, 23], stall: [false, true],
  wings: [0, 1], rotorFold: [0, 1], boat: [0, 1], gear: [0, 1], convert: [0, 0.5], mode: [0, 3], ramp: [0, 1], nv: [false, true], gunsArmed: [false, true],
  pantry: [0, 1], locker: [0, 1], champagne: [0, 6], quack: [false, true], conv: [0.5, 2.2], ammo: [1174, 200],
};
for (const [k, [a, b]] of Object.entries(STOPS)) {
  const base = k === 'phase' ? { ...REST, rpm: 1 } : REST;
  const fa = roomChecks(k + '=' + a, { ...base, [k]: a });
  const fb = roomChecks(k + '=' + b, { ...base, [k]: b });
  ok(Math.abs(sig(fa) - sig(fb)) > 1e-6, k + ': the geometry is identical at both stops; the control or display does not move');
}
roomChecks('all low', { ...REST, stickX: -1, stickY: -1, rudder: -1, throttle: 0, rpm: 0, bank: -45, pitch: -25, gear: 0, trim: -0.6 });
roomChecks('all high', { ...REST, stickX: 1, stickY: 1, rudder: 1, throttle: 1, rpm: 1.05, bank: 45, pitch: 25, wings: 1, rotorFold: 1, convert: 1, mode: 1,
  ramp: 1, landingLight: true, dome: true, hour: 23, gunsArmed: true, nv: true, pantry: 1, locker: 1, trim: 0.6 });
roomChecks('afloat and dived', { ...REST, boat: 1, rotorFold: 1, mode: 3, gear: 0, dive: { boat: false, under: true, moving: true } });

// ── (d) EVERY DRAKE CONTROL, WIRED, AND EACH ONE IN THE FORWARD VIEW ─────────
{
  const { ACT, TIP, KINDS } = readDkTables();
  const hs = P.hotspots(REST), ids = new Set(hs.map((h) => h.id));
  for (const h of drakeHotspots(REST)) ok(ids.has(h.id), 'the refit lost the stock Drake control ' + h.id);
  for (const h of hs) {
    ok(KINDS.has(h.kind), h.id + ' is a "' + h.kind + '" hotspot, a kind cockpit.js does nothing with');
    if (h.kind === 'click') ok(ACT.has(h.id), h.id + ' has no action in cockpit.js DK_ACT');
    ok(TIP.has(h.id), h.id + ' has no tooltip in cockpit.js DK_TIP');
  }
  // The forward look: the eye pitched 12 degrees down with an 85 degree lens, about +-42 across and
  // +-26 up and down. Every click control needs a hotspot inside it (the physical ones low on the
  // console and in the fascia have a key on the band as well).
  const PITCH = -12, HALF_X = 42, HALF_Y = 26;
  const inView = (p) => {
    const yaw = Math.atan2(p[0], p[1]) * 180 / Math.PI, el = Math.atan2(p[2], Math.hypot(p[0], p[1])) * 180 / Math.PI;
    return Math.abs(yaw) <= HALF_X && el >= PITCH - HALF_Y && el <= PITCH + HALF_Y;
  };
  for (const id of new Set(hs.filter((h) => h.kind === 'click').map((h) => h.id))) {
    ok(hs.some((h) => h.id === id && inView(h.p)), id + ' has no hotspot in the forward view');
  }
  // The yoke and the throttle are grabs, and the pedals are held: each has a hotspot that moves with it.
  const at = (live, id) => P.hotspots(live).find((h) => h.id === id).p;
  ok(at({ ...REST, stickY: -1 }, 'yoke')[1] !== at({ ...REST, stickY: 1 }, 'yoke')[1], 'the yoke hotspot does not follow the yoke');
  ok(at({ ...REST, throttle: 0 }, 'throttle')[1] < at({ ...REST, throttle: 1 }, 'throttle')[1], 'the throttle hotspot does not go forward with the throttle');
  // The mirrors: something in the forward view, well ahead of the yoke and the band, that changes
  // with each low control.
  const forward = (live) => shellFaces(P, live, { rich: true }).filter((f) => f.p.every(inView) && f.p.every((q) => q[1] > 0.6 && q[2] > -0.2));
  for (const [k, a, b] of [['stickX', -1, 1], ['stickY', -1, 1], ['throttle', 0, 1], ['rudder', -1, 1]]) {
    ok(Math.abs(sig(forward({ ...REST, [k]: a })) - sig(forward({ ...REST, [k]: b }))) > 1e-6, k + ': nothing in the forward view shows it moving');
  }
  // The HUD is projected into the centre screen: something lit ahead of the pilot, off when the power is.
  const hud = (live) => shellFaces(P, live, { rich: true }).filter((f) => f.p.every((q) => q[1] > 0.9 && q[1] < 1.0 && Math.abs(q[2]) < 0.14 && Math.abs(q[0]) < 0.27));
  ok(hud(REST).length > 50 && hud({ ...REST, powered: false }).length === 0, 'no HUD in the centre screen, or one that stays lit with the power off');
  // The hologram converts with her: wings, rotor fold, the boom on the water.
  const holo = (live) => shellFaces(P, live, { rich: true }).filter((f) => f.p.every((q) => q[0] < -0.08 && q[0] > -0.5 && q[1] > 0.45 && q[2] > -0.1 && q[2] < 0.2));
  for (const [k, a, b] of [['wings', 0, 1], ['rotorFold', 0, 1], ['boat', 0, 1], ['gear', 0, 1], ['pitch', -15, 15], ['phase', 0, 1.3]]) {
    ok(Math.abs(sig(holo({ ...REST, rpm: 1, [k]: a })) - sig(holo({ ...REST, rpm: 1, [k]: b }))) > 1e-6, k + ': the hologram does not show it');
  }
}

// ── (e) THE PAGES BOOT IN TURN ───────────────────────────────────────────────
{
  const booting = shellFaces(P, { ...REST, powerAge: 0.2 }, { rich: true }), up = shellFaces(P, REST, { rich: true });
  ok(booting.length < up.length && Math.abs(sig(booting) - sig(up)) > 1e-6, 'the pages do not boot: a fifth of a second after power on looks the same as long after');
  const settle = () => { for (let i = 0; i < 4; i++) { shellFaces(P, REST, { rich: true }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400); } };
  settle();
  const upN = shellFaces(P, REST, { rich: true }).length;
  ok(shellFaces(P, { ...REST, powerAge: 5 }, { rich: true }).length === upN, 'five seconds after power on is not fully booted');
}

// ── (b) STILL THE INSIDE OF THE HEAD ─────────────────────────────────────────
{
  const D = P.drake, m = D.m;
  const gE = -D.X(0) / m, fE = -D.Y(0) / m, hE = -D.Z(0) / m;
  const head = (function find(parts) { for (const p of parts || []) { if (p.name === 'head') return p; const q = find(p.parts); if (q) return q; } return null; })(MESH_ROWS.drake_2076.parts);
  const stock = (function find(parts) { for (const p of parts || []) { if (p.name === 'head') return p; const q = find(p.parts); if (q) return q; } return null; })(MESH_ROWS.drake.parts);
  ok(JSON.stringify(head) === JSON.stringify(stock), 'the 2076 body\'s head is not the stock Drake\'s, so the room no longer fits the hull');
  ok(JSON.stringify(MESH_ROWS.drake_2076.cabin) === JSON.stringify(MESH_ROWS.drake.cabin), 'the 2076 body\'s cabin block differs from the stock Drake\'s');
  const [eg, et, eb] = head.exp;
  const inside = (f, g, h) => {
    const s = D.H.sec(f), dh = h - s.cz, rv = dh >= 0 ? s.rvT : s.rvB, e2 = dh >= 0 ? et : eb;
    return Math.pow(Math.abs(g) / s.rg, 2 / eg) + Math.pow(Math.abs(dh) / rv, 2 / e2) <= 1.0005;
  };
  // Forward of the seat and above the dash top: the band, the dash, the pages, the HUD, the hologram.
  const every = [...shellFaces(P, { ...REST, stickX: 1, stickY: 1, throttle: 1, wings: 1, rotorFold: 1, bank: 45, pitch: 20 }, { rich: true }),
    ...shellFaces(P, { ...REST, stickX: -1, stickY: -1, bank: -45, pitch: -20, boat: 1 }, { rich: true })];
  let outside = 0, n = 0, worst = null;
  for (const f of every) for (const q of f.p) {
    if (q[1] < 0.15 || q[2] < -0.5) continue;
    n++;
    const fm = q[1] / m + fE, gm = q[0] / m + gE, hm = q[2] / m + hE;
    if (!inside(fm, gm, hm)) { outside++; if (!worst) worst = [f.tone, q.map((v) => v.toFixed(2)).join(',')]; }
  }
  ok(n > 2000, 'nothing forward of the seat to test (' + n + ')');
  ok(outside === 0, outside + ' of ' + n + ' fit-out vertices forward of the seat stand outside the head\'s skin (first: ' + (worst || []).join(' ') + ')');
}

// ── (f) EVERY OTHER TRIM LEFT ALONE ──────────────────────────────────────────
for (const t of [null, 'stock', 'noir', 'quackhawk']) {
  const Q = shellProfileFor('drake', false, t);
  ok(Q && !Q.refit && !Q.hotspots && Q.label !== P.label, 'the ' + (t || 'default') + ' Drake sits in the 2076 refit');
}
ok(SHELL_PROFILES.drake2076 === shellProfileFor('drake', false, '2076'), 'SHELL_PROFILES.drake2076 is not the profile the 2076 edition gets');

console.log('drake 2076 cockpit: ' + (fails ? fails + ' of ' + checks + ' FAILED' : checks + ' checks passed'));
process.exit(fails ? 1 : 0);
