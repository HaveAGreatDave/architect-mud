// THE GATE EVERY HOVER CAR'S COCKPIT PASSES (client/shared/interior-<id>.js, built on
// interior-hovercar-kit.js). The Merlin's own gate (cockpit-merlin.mjs) is older and asks the same.
//
// Five questions, each a way a cockpit can be wrong without anything throwing:
//   (a) is it a room you can sit in and see out of, at rest and with every control at both stops;
//   (b) is it the inside of the OUTSIDE: every vertex inside the body's skin, the exterior's compiled
//       glass where the shared cabin says it is, and no lining across the windscreen;
//   (c) does every control and every display move: the geometry differs between the stops;
//   (d) is every click control in one forward look, with the wheel, the lift and the pedals showing
//       there (the head-up display mirrors them);
//   (e) are the class's controls all there: the four circuits, HOVER, LOCK, BOOST and PIT, the GPS,
//       the HUD colour, the wheel, the doors, and whatever the car steps or drags its lift with.
//
// A car's own gate (cockpit-<id>.mjs) calls `runCockpitGate` with what is its own: where its pedals
// are, how its lift is worked, and how many faces it may spend.
import { shellFaces, shellBounds, freezeFaces, shellProfileFor } from '../../client/shared/interior-shell.js';
import { MESH_ROWS } from '../../client/shared/vehicle-meshes.js';
import { compileMesh } from '../../client/shared/vehicle-mesh.js';

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

// `o`: { id, label, profile, cabin, pedalAt: [x, y, zOverFloor], lift: 'click' | 'drag', budget: [lo, hi], extra(ctx) }
export function runCockpitGate(o) {
  let fails = 0, checks = 0;
  const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('  FAIL  ' + msg); } };
  const done = () => { console.log(o.id + ' cockpit: ' + (fails ? fails + ' of ' + checks + ' FAILED' : checks + ' checks passed')); process.exit(fails ? 1 : 0); };
  const C = o.cabin, P = o.profile();
  ok(!!P, o.id + 'Profile() built nothing: the ' + o.id + ' mesh is missing from the bake');
  if (!P) return done();
  ok(shellProfileFor(o.id)?.label === P.label, 'the ' + o.id + ' class does not sit in the ' + o.label + '\'s cabin');
  const B = shellBounds(P);
  const cast = (faces, d) => castFrom(faces, [0, 0, 0], d);

  // ── (a) A ROOM, AT REST AND AT EVERY STOP ──
  function roomChecks(tag, live) {
    const faces = freezeFaces(shellFaces(P, live, { rich: true }));
    ok(faces.length > 0, tag + ': no geometry');
    ok(B[0] < -0.05 && B[1] < -0.05 && B[2] < -0.05 && B[3] > 0.05 && B[4] > 0.05 && B[5] > 0.05, tag + ': the eye is not strictly inside the bounds');
    ok(!cast(faces, [0, 1, 0]), tag + ': something is across the forward view');
    const wy = (P.winY[0] + P.winY[1]) / 2, wz = (P.winZ[0] + P.winZ[1]) / 2;
    const xL = P.xCentre - P.halfW, xR = P.xCentre + P.halfW;
    ok(!castFrom(faces, [0, 0, 0], [xL, wy, wz]), tag + ': the left door glass is blocked');
    ok(!castFrom(faces, [0, 0, 0], [xR, wy, wz]), tag + ': the right door glass is blocked');
    ok(cast(faces, [0, 0, 1]) > 0.05, tag + ': no roof over the driver\'s head');
    ok(castFrom(faces, [2 * P.xCentre, (P.seatY[1] + P.dashY) / 2, 0], [0, 0, -1]), tag + ': no floor under the passenger footwell');
    ok(castFrom(faces, [0, 0, (P.backZ + P.roof) / 2], [0, -1, 0]), tag + ': no firewall behind');
    const low = P.winZ[0] - 0.3;
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
  const REST = { ias: 0, alt: 0, vsi: 0, pitch: 0, bank: 0, hdg: 0, rpm: 0, throttle: 0, fuel: 1, hull: 1, powered: true, stickX: 0, stickY: 0, rudder: 0, hour: 12, phase: 0 };
  const rest = roomChecks('rest', REST);
  console.log(o.id + ': ' + rest.length + ' faces at rest; ' + (B[4] - B[1]).toFixed(2) + ' m long, ' + (B[3] - B[0]).toFixed(2) + ' wide, ' + (B[5] - B[2]).toFixed(2) + ' tall');
  ok(rest.length >= o.budget[0] && rest.length <= o.budget[1], 'face count ' + rest.length + ' outside the ' + o.budget[0] + ' to ' + o.budget[1] + ' budget');

  // ── (c) EVERY CONTROL AND EVERY DISPLAY MOVES ──
  const sig = (faces) => { let s = faces.length * 1e-3; for (const f of faces) { for (const q of f.p) s += Math.sin(q[0] * 37.1 + q[1] * 53.3 + q[2] * 71.7); if (f.rgb) s += (f.rgb[0] * 0.3 + f.rgb[1] * 0.5 + f.rgb[2] * 0.7) * (1 + (f.emis || 0)) * 1e-4; } return s; };
  const STOPS = {
    stickX: [-1, 1], stickY: [-1, 1], rudder: [-1, 1], throttle: [0, 1], rpm: [0.2, 1.05],
    ias: [0, 120], alt: [0, 4500], hdg: [0, 135],
    fuel: [0.1, 1], hull: [0.1, 1], powered: [false, true], landingLight: [false, true], dome: [false, true], hour: [12, 23],
    ...(o.stops || {}),
  };
  for (const [k, [a, b]] of Object.entries(STOPS)) {
    const fa = roomChecks(k + '=' + a, { ...REST, [k]: a });
    const fb = roomChecks(k + '=' + b, { ...REST, [k]: b });
    ok(Math.abs(sig(fa) - sig(fb)) > 1e-6, k + ': the geometry is identical at both stops; the control or display does not move');
  }
  // The drive modes show: the road, the limiter, a lock in reach, the boost and its heat.
  {
    const mr = (m) => ({ ...REST, mr: { mode: 'air', heat: 0, over: 0, pit: false, boost: false, lockReady: false, locking: false, near: false, ...m } });
    const base = sig(shellFaces(P, mr({}), { rich: true }));
    for (const [name, m] of [['road', { mode: 'road' }], ['PIT', { mode: 'road', pit: true }], ['LOCK', { near: true }], ['BOOST', { boost: true }], ['heat', { heat: 0.8 }]]) {
      ok(Math.abs(sig(shellFaces(P, mr(m), { rich: true })) - base) > 1e-6, name + ': nothing in the cabin shows it');
    }
  }
  const near = (faces, c, r) => faces.filter((f) => f.p.every((q) => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) < r));
  const grip = (id, live) => P.hotspots(live).find((h) => h.id === id)?.p;
  for (const [k, a, b] of [['stickX', -1, 1], ['stickY', -1, 1]]) {
    const c = grip('yoke', { ...REST, [k]: a });
    ok(!!c, 'no wheel to hold (the yoke hotspot)');
    if (!c) continue;
    const fa = near(shellFaces(P, { ...REST, [k]: a }, { rich: true }), c, 0.14), fb = near(shellFaces(P, { ...REST, [k]: b }, { rich: true }), c, 0.14);
    ok(fa.length > 4 && Math.abs(sig(fa) - sig(fb)) > 1e-6, k + ': the wheel does not move with it');
  }
  {
    const zF = P.hc.zF, pc = [o.pedalAt[0], o.pedalAt[1], zF + o.pedalAt[2]];
    const pa = near(shellFaces(P, { ...REST, rudder: -1 }, { rich: true }), pc, 0.3), pb = near(shellFaces(P, { ...REST, rudder: 1 }, { rich: true }), pc, 0.3);
    ok(pa.length > 20 && Math.abs(sig(pa) - sig(pb)) > 1e-6, 'rudder: the yaw pedals do not slide');
  }
  roomChecks('all low', { ...REST, stickX: -1, stickY: -1, rudder: -1, throttle: 0, rpm: 0, bank: -45, pitch: -25 });
  roomChecks('all high', { ...REST, stickX: 1, stickY: 1, rudder: 1, throttle: 1, rpm: 1.05, bank: 45, pitch: 25, landingLight: true, dome: true, hour: 23 });
  {
    const at = (hs, id) => hs.find((h) => h.id === id).p;
    const h0 = P.hotspots({ ...REST, stickY: -1 }), h1 = P.hotspots({ ...REST, stickY: 1 });
    ok(at(h0, 'yoke')[1] !== at(h1, 'yoke')[1], 'the wheel hotspot does not follow the pull');
    const r0 = P.hotspots({ ...REST, stickX: -1 }), r1 = P.hotspots({ ...REST, stickX: 1 });
    ok(Math.hypot(...at(r0, 'yoke').map((v, i) => v - at(r1, 'yoke')[i])) > 0.05, 'the wheel hotspot does not turn with the wheel');
    // On the road the wheel's push and pull lock.
    const road = { mode: 'road' }, d0 = P.hotspots({ ...REST, stickY: -1, mr: road }), d1 = P.hotspots({ ...REST, stickY: 1, mr: road });
    ok(Math.hypot(...at(d0, 'yoke').map((v, i) => v - at(d1, 'yoke')[i])) < 1e-9, 'the wheel still slides fore and aft on the road');
  }

  // ── (e) THE CLASS'S CONTROLS ARE ALL THERE, AND NONE OVERLAP ──
  {
    const hs = P.hotspots(REST), ids = new Set(hs.map((h) => h.id));
    const need = ['ck:master', 'ck:land', 'ck:panel', 'ck:dome', 'ck:hover', 'ck:lock', 'ck:boost', 'ck:pit', 'ck:gps', 'ck:hud', 'ck:door', 'yoke',
      ...(o.lift === 'drag' ? ['throttle'] : ['ck:padUp', 'ck:padDn'])];
    for (const id of need) ok(ids.has(id), id + ': the control is missing');
    const clicks = hs.filter((h) => h.kind === 'click' && h.id !== 'ck:door');
    for (let i = 0; i < clicks.length; i++) for (let j = i + 1; j < clicks.length; j++) {
      const d = Math.hypot(...clicks[i].p.map((v, k) => v - clicks[j].p[k]));
      ok(d > (clicks[i].r + clicks[j].r) * 0.85, clicks[i].id + ' and ' + clicks[j].id + ' overlap (' + (d * 1000).toFixed(0) + ' mm apart)');
    }
    ok(!ids.has('ck:out'), 'OUT shows with the doors shut');
    const open = P.hotspots({ ...REST, door: 1 });
    ok(open.some((h) => h.id === 'ck:out'), 'OUT does not show with the doors open');
    const p0 = hs.find((h) => h.id === 'ck:door').p, p1 = open.find((h) => h.id === 'ck:door').p;
    ok(Math.hypot(...p0.map((v, i) => v - p1[i])) > 0.1, 'the door pull does not swing with its door');
    ok(Math.abs(sig(shellFaces(P, REST, { rich: true })) - sig(shellFaces(P, { ...REST, door: 1 }, { rich: true }))) > 1e-6, 'the doors do not open');
  }

  // ── (d) EVERY CONTROL IN ONE FORWARD VIEW ──
  // The forward look is the eye pitched 12 degrees down with an 85 degree lens on a 16:9 frame: about
  // 42 degrees either side and 26 up and down.
  {
    const PITCH = -12, HALF_X = 42, HALF_Y = 26;
    const inView = (p) => {
      const yaw = Math.atan2(p[0], p[1]) * 180 / Math.PI, el = Math.atan2(p[2], Math.hypot(p[0], p[1])) * 180 / Math.PI;
      return Math.abs(yaw) <= HALF_X && el >= PITCH - HALF_Y && el <= PITCH + HALF_Y;
    };
    // The door pulls are on the doors beside you, reached by turning your head, so they're exempt.
    for (const h of P.hotspots({ ...REST })) if (h.kind === 'click' && h.id !== 'ck:door') ok(inView(h.p), h.id + ' is outside the forward view (' + h.p.map((v) => v.toFixed(2)).join(', ') + ')');
    const forward = (live) => shellFaces(P, live, { rich: true }).filter((f) => f.p.every(inView) && f.p.every((q) => q[1] > 0.3));
    for (const [k, a, b] of [['stickX', -1, 1], ['stickY', -1, 1], ['throttle', 0, 1], ['rudder', -1, 1]]) {
      ok(Math.abs(sig(forward({ ...REST, powered: true, [k]: a })) - sig(forward({ ...REST, powered: true, [k]: b }))) > 1e-6, k + ': nothing in the forward view shows it moving');
    }
  }

  // ── (b) THE INSIDE IS THE INSIDE OF THE OUTSIDE ──
  {
    const D = P.hc, m = P.mPerUnit;
    const gE = -D.X(0) / m, fE = -D.Y(0) / m, hE = -D.Z(0) / m;
    const every = [...D.faces, ...D.doorFaces[1], ...D.doorFaces[-1],
      ...shellFaces(P, { ...REST, stickX: 1, stickY: 1, rudder: 1, throttle: 1 }, { rich: true }), ...shellFaces(P, { ...REST, stickX: -1, stickY: -1, rudder: -1 }, { rich: true })];
    let outside = 0, n = 0;
    const worst = [];
    for (const f of every) for (const q of f.p) {
      n++;
      const fm = q[1] / m + fE, gm = q[0] / m + gE, hm = q[2] / m + hE;
      if (!C.within(fm, gm, hm)) { outside++; if (worst.length < 6) worst.push(f.tone + ' at x ' + q[0].toFixed(2) + ' y ' + q[1].toFixed(2) + ' z ' + q[2].toFixed(2)); }
    }
    ok(outside === 0, outside + ' of ' + n + ' cockpit vertices stand outside the body (' + worst.join('; ') + ')');
    // The exterior's compiled glass is where the shared cabin says: nothing glazed aft of its last pane.
    const ext = compileMesh(MESH_ROWS[o.id], { detail: 1 }).faces.filter((f) => f.role === 'glass');
    const fLo = Math.min(...Object.values(C.glass).map((r) => r.f[0])) - 0.002;
    let stray = 0;
    for (const f of ext) for (const q of f.p) if (q[0] < fLo - 0.06) stray++;
    ok(ext.length > 40, 'the exterior has lost its glass (' + ext.length + ' faces)');
    ok(stray === 0, stray + ' exterior glass vertices aft of the cabin\'s last pane');
    // The room stops being wall where the windscreen starts.
    let papered = 0;
    const W = C.glass.windscreen, yW = (W.f[0] - fE) * m;
    for (const f of D.faces) {
      if (f.tone !== 'hdr' && f.tone !== 'pil') continue;
      const c = f.p.reduce((s, q) => [s[0] + q[0] / f.p.length, s[1] + q[1] / f.p.length, s[2] + q[2] / f.p.length], [0, 0, 0]);
      const fm = c[1] / m + fE, a = C.angleAt(fm, c[0] / m + gE, c[2] / m + hE);
      if (c[1] > yW + 0.02 && fm < W.f[1] - 0.01 && a > W.a[0] + 3 && a < W.a[1] - 3) papered++;
    }
    ok(papered === 0, papered + ' lining faces stand over the windscreen: it is walled in');
  }

  // ── (f) THE GLOWS: lit parts spill colour, inside the room, only with power ──
  {
    const on = P.glows({ ...REST, powered: true, hudTint: 'magenta' });
    ok(on.length >= 1 && on.length <= 6, on.length + ' glows; the renderer takes 1 to 6');
    ok(P.glows({ ...REST, powered: false }).length === 0, 'the glows are lit with the power off');
    for (const g of on) ok(g.p.every(Number.isFinite) && g.p[0] > B[0] && g.p[0] < B[3] && g.p[1] > B[1] && g.p[1] < B[4] && g.p[2] > B[2] && g.p[2] < B[5] && g.r > 0, 'a glow stands outside the cabin');
  }

  o.extra?.({ P, ok, REST, sig, near, grip, shellFaces, roomChecks });
  done();
}
