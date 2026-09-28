// THE MULE'S COCKPIT: a DHC-6 Twin Otter, side by side, the pilot in the left seat.
//
// Built on the cockpit kit (interior-cockpit-kit.js) to the Drake's standard, like the Cessna next
// door. What makes it a Twin Otter rather than a big Cessna:
//   · the engine instruments are a centre column of PAIRS, left engine and right, because it is
//     flown on two turbines: torque, prop rpm, T5, Ng, fuel flow, oil;
//   · the power, prop and fuel levers hang from the ROOF between the pilots, not on a pedestal;
//   · an overhead switch panel runs back from the windscreen header;
//   · a W-shaped yoke on a column out of the panel for each pilot;
//   · and behind you it is a freighter: a cargo net, a folded jump seat, the manifests.
//
// The frame is the shell's: metres, the eye at the origin, x right, y forward, z up. The aircraft's
// centreline is `P.xCentre` to the right of the eye, so the co-pilot's side is at 2·xCentre.
import { makeKit, C, clamp, pedal, SHINY, PANE, TEXTURE } from './interior-kit.js';
import { facingPanel, eased, pressPulse, contactShadow, hotspotHalo } from './interior-cockpit-kit.js';

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

// A working freighter: a flat grey panel, a black glareshield, olive webbing, worn tan seats.
const T = {
  panel: [58, 62, 66], panelDk: [40, 43, 46], shield: [22, 23, 25], stack: [20, 21, 24],
  bezel: [120, 124, 130], placard: [214, 212, 204], yoke: [30, 30, 33], column: [70, 72, 76],
  quad: [36, 38, 42], overhead: [48, 51, 55], webbing: [120, 104, 60], annun: [60, 56, 40],
  lcd: [110, 236, 150], lcdBg: [10, 22, 16], amber: [255, 176, 64], red: [236, 60, 48],
};


// ── WHAT EACH SURFACE IS MADE OF ─────────────────────────────────────────────
// The Drake's standard, in a freighter's materials. Registered by identity on T's own arrays. The
// columns are painted steel, worn to a dull sheen; the overhead levers ride in a cast quadrant;
// the webbing is woven, the glareshield flocked matte, and the lever knobs lacquered.
SHINY.set(T.column, { spec: 0.45, pow: 18, ramp: [[40, 42, 46], [150, 154, 160]], glint: 0.15, albedo: [200, 204, 210], envK: 0.4 });
SHINY.set(T.yoke, { spec: 0.3, pow: 28 });
SHINY.set(T.bezel, { spec: 0.3, pow: 20 });
SHINY.set(T.shield, { spec: 0.04, pow: 8 });
for (const [k, tex] of [['panel', 'paint'], ['panelDk', 'paint'], ['shield', 'carpet'], ['stack', 'plastic'], ['bezel', 'cast'],
  ['placard', 'paint'], ['yoke', 'plastic'], ['column', 'paint'], ['quad', 'cast'], ['overhead', 'paint'],
  ['webbing', 'fabric'], ['annun', 'plastic']]) TEXTURE.set(T[k], tex);
// The glass over each dial catches a crescent of window light, upper left.
const GLINT = [255, 252, 244];
PANE.set(GLINT, 0.16);
// Where things are, as functions of the profile, so the hotspots and the geometry are one table.
function layout(P) {
  const xC = P.xCentre, y = P.dashY - 0.004, top = P.dashZ - 0.012;
  return {
    xC, y, top,
    six: { z: [top - 0.07, top - 0.155], dx: 0.088, R: 0.034 },
    eng: { x: [xC - 0.034, xC + 0.034], z: [top - 0.045, top - 0.098, top - 0.151, top - 0.204], R: 0.022 },
    stack: { x: xC + 0.155, w: 0.068, z0: top - 0.225, z1: top - 0.02 },
    sw: { z: top - 0.222, x: [-0.20, -0.17, -0.14, -0.11, -0.08, -0.05] },   // master, beacon, land, taxi, nav, strobe
    flaps: [xC, y, top - 0.245],
    yoke: (x, elev) => [x, y - 0.18 - clamp(elev, -1, 1) * 0.045, top - 0.205],
    // The overhead quadrant: power, prop and fuel levers, two of each, hanging from the roof.
    quad: { x: xC, y0: 0.10, y1: 0.46, z: P.roof - 0.02 },
    trim: [xC, -0.02, P.floor + 0.24],
  };
}

export function otterHotspots(P, live) {
  const Y = layout(P), L = live || {}, Kd = makeKit(() => {});
  const Pn = Kd.panel([0, Y.y, 0], [1, 0, 0], [0, 0, 1]);
  const at = (x, z) => Pn.pt(x, z, 0.01);
  const out = [];
  ['master', 'beacon', 'land', 'taxi', 'nav', 'strobe'].forEach((id, i) => out.push({ id: 'ck:' + id, p: at(Y.sw.x[i], Y.sw.z), r: 0.015, kind: 'click' }));
  out.push({ id: 'ck:flaps', p: at(Y.flaps[0], Y.flaps[2]), r: 0.022, kind: 'click' });
  out.push({ id: 'ck:dome', p: [Y.xC, -0.10, P.roof - 0.03], r: 0.03, kind: 'click' });
  out.push({ id: 'yoke', p: (([x, y, z]) => [x, y, z + 0.05])(Y.yoke(0, num(L.stickY))), r: 0.10, kind: 'yoke' });
  const q = Y.quad, thr = clamp(num(L.throttle), 0, 1);
  out.push({ id: 'throttle', p: [q.x - 0.065, q.y0 + 0.04 + thr * (q.y1 - q.y0 - 0.08), q.z - 0.14], r: 0.04, kind: 'throttle' });
  out.push({ id: 'trim', p: Y.trim, r: 0.05, kind: 'trim' });
  return out;
}

export function otterFit(P, live, push) {
  const K = makeKit(push), L = live || {}, Y = layout(P);
  const powered = L.powered !== false;
  const ias = Math.max(0, num(L.ias)), alt = Math.max(0, num(L.alt)), vsi = num(L.vsi), hdg = num(L.hdg);
  const rpm = clamp(num(L.rpm), 0, 1.05), vne = Math.max(40, num(L.vne, 160));
  const pitch = num(L.pitch), bank = num(L.bank), fuel = clamp(num(L.fuel, 1) > 1 ? num(L.fuel) / 100 : num(L.fuel, 1), 0, 1);
  const thr = clamp(num(L.throttle), 0, 1), ail = clamp(num(L.stickX), -1, 1), elev = clamp(num(L.stickY), -1, 1);
  const trim = clamp(num(L.trim), -1, 1), rud = clamp(num(L.rudder), -1, 1), flap = clamp(num(L.flapNotch), 0, 3);
  const xL = Y.xC - P.halfW, xR = Y.xC + P.halfW;
  const dialO = (o) => ({ face: [22, 24, 28], bezel: T.bezel, tick: [230, 230, 224], ...o });

  // ── THE PANEL AND THE GLARESHIELD ────────────────────────────────────────
  const Pn = K.panel([0, Y.y, 0], [1, 0, 0], [0, 0, 1], 'dash', 0.2);
  const glint = (x, z, R) => Pn.annulus(x, z, R * 0.62, R * 0.88, GLINT, 1, 0.012, 8, Math.PI * 0.55, Math.PI * 0.9);
  const dial = (x, z, R, f, o) => { Pn.dial(x, z, R, f, o); glint(x, z, R); };
  Pn.rect(xL + 0.03, Y.top - 0.30, xR - 0.03, Y.top, T.panel, 0, 0.0005);
  Pn.rect(xL + 0.03, Y.top - 0.30, xR - 0.03, Y.top - 0.285, T.panelDk, 0, 0.001);
  K.box(xL + 0.02, Y.y - 0.06, Y.top - 0.005, xR - 0.02, Y.y + 0.02, Y.top + 0.035, 'dash', 0.05, T.shield);
  K.box(xL + 0.02, Y.y - 0.065, Y.top - 0.012, xR - 0.02, Y.y - 0.055, Y.top + 0.035, 'dash', -0.1, T.shield);
  // The annunciator strip under the glareshield lip, over the engine column: fire handles either
  // side, and caution lamps that only light when something is wrong (or on the press-to-test).
  const Sh = K.panel([Y.xC, Y.y - 0.056, Y.top + 0.012], [1, 0, 0], [0, 0, 1], 'dash', 0.1);
  Sh.rect(-0.10, -0.012, 0.10, 0.012, [16, 16, 18], 0, 0.001);
  const warn = [!powered ? 0 : fuel < 0.12, !powered ? 0 : rpm < 0.25, L.stall, 0, 0, L.bingo];
  // Each lamp's name is on its lens, since the strip has no room under it.
  const warnN = ['FUEL', 'ENG', 'STALL', 'GEN 1', 'GEN 2', 'BINGO'];
  warn.forEach((w, i) => {
    Sh.lamp(-0.075 + i * 0.03, 0, 0.011, 0.007, !!w, i < 2 ? T.red : T.amber);
    Sh.fitText(warnN[i], -0.075 + i * 0.03, 0, 0.019, 0.006, w ? [30, 10, 6] : [150, 146, 140], 0, 0.008);
  });
  for (const sd of [-1, 1]) {
    Sh.rect(sd * 0.13 - 0.018, -0.01, sd * 0.13 + 0.018, 0.01, T.red, powered ? 0.3 : 0.05, 0.003);   // the fire T-handles
    Sh.fitText(sd < 0 ? 'FIRE 1' : 'FIRE 2', sd * 0.13, 0, 0.032, 0.008, [240, 236, 226], 0.2, 0.005);
  }

  // ── BOTH SIX-PACKS ───────────────────────────────────────────────────────
  const six = (cx) => {
    const sx = (i) => cx + (i - 1) * Y.six.dx, R = Y.six.R, [z1, z2] = Y.six.z;
    dial(sx(0), z1, R, clamp(ias / (vne * 1.1), 0, 1), dialO({ ticks: 16, major: 4, arcs: [[0.3, 0.82, C.green], [0.82, 0.91, C.amber]], red: 0.91, name: 'KTS' }));
    Pn.attitude(sx(1), z1, R, pitch, bank); glint(sx(1), z1, R);
    dial(sx(2), z1, R, (alt % 1000) / 1000, dialO({ a0: Math.PI / 2, sweep: Math.PI * 2, ticks: 10, major: 1, frac2: (alt % 10000) / 10000, name: 'ALT' }));
    dial(sx(0), z2, R, clamp(0.5 + bank / 90, 0, 1), dialO({ a0: Math.PI * 0.9, sweep: Math.PI * 0.8, ticks: 6, major: 3, name: 'TURN' }));
    Pn.compass(sx(1), z2, R, hdg); glint(sx(1), z2, R);
    dial(sx(2), z2, R, clamp(0.5 + vsi / 4000, 0, 1), dialO({ a0: Math.PI, sweep: Math.PI * 1.8, ticks: 8, major: 2, name: 'VSI' }));
  };
  six(0);
  six(2 * Y.xC);
  dial(-0.175, Y.six.z[0], 0.022, ((L.hour ?? 12) % 12) / 12, dialO({ a0: Math.PI / 2, sweep: Math.PI * 2, ticks: 12, major: 3, name: 'CLOCK' }));

  // ── THE ENGINE COLUMN: left and right, side by side ──────────────────────
  // A turboprop's needles move with its power; the two engines are flown matched, with a hair of
  // split so they never look like one gauge drawn twice.
  const run = powered ? rpm : 0;
  const pairs = [
    { v: (e) => clamp(thr * 0.85 * run + e * 0.01, 0, 1), o: { arcs: [[0.1, 0.8, C.green]], red: 0.9 }, name: 'TORQ' },          // torque
    { v: (e) => clamp(run * 0.92 - e * 0.008, 0, 1), o: { arcs: [[0.7, 0.92, C.green]], red: 0.94 }, name: 'PROP' },          // prop rpm
    { v: (e) => clamp(run ? 0.35 + thr * 0.45 + e * 0.012 : 0, 0, 1), o: { arcs: [[0.3, 0.8, C.green]], red: 0.86 }, name: 'T5' },   // T5
    { v: (e) => clamp(run ? 0.55 + thr * 0.38 : 0, 0, 1) - e * 0.004, o: { arcs: [[0.5, 0.95, C.green]], red: 0.97 }, name: 'NG' },   // Ng
  ];
  pairs.forEach((g, row) => Y.eng.x.forEach((x, e) => dial(x, Y.eng.z[row], Y.eng.R, g.v(e), dialO({ ticks: 8, major: 2, ...g.o, name: g.name }))));
  // Fuel flow and oil: little strip gauges under the column, one bar per engine.
  for (let e = 0; e < 2; e++) {
    const x = Y.eng.x[e];
    Pn.rect(x - 0.012, Y.top - 0.265, x + 0.012, Y.top - 0.232, [14, 14, 16], 0, 0.002);
    Pn.rect(x - 0.008, Y.top - 0.262, x + 0.008, Y.top - 0.262 + 0.027 * (powered ? 0.3 + thr * 0.6 : 0), C.green, powered ? 0.6 : 0, 0.003);
    Pn.fitText('FF', x, Y.top - 0.273, 0.024, 0.0065, [220, 220, 214], 0.35, 0.004);
  }
  dial(-0.175, Y.six.z[1], 0.022, fuel, dialO({ ticks: 4, major: 1, red: 0.08, name: 'FUEL' }));

  // ── THE RADIO STACK, to the right of the engines ─────────────────────────
  const st = Y.stack;
  Pn.rect(st.x - st.w, st.z0, st.x + st.w, st.z1, T.stack, 0, 0.002);
  const unit = (z, str) => {
    Pn.rect(st.x - st.w + 0.006, z - 0.02, st.x + st.w - 0.006, z + 0.02, [34, 36, 40], 0, 0.003);
    if (powered) Pn.digits(st.x - 0.05, z - 0.008, 0.016, str, T.lcd, true);
    else Pn.rect(st.x - 0.05, z - 0.009, st.x + 0.02, z + 0.009, T.lcdBg, 0, 0.004);
    Pn.knob(st.x + 0.048, z, 0.008, 0.011, [60, 60, 66], 0);
  };
  unit(st.z1 - 0.03, '12190');
  unit(st.z1 - 0.078, '11770');
  unit(st.z1 - 0.126, String(1200 + (Math.round(hdg) % 7)).padStart(4, '0'));
  unit(st.z1 - 0.174, String(Math.round(alt / 100)).padStart(3, '0'));   // the altitude-encoder readout
  // Lettered here rather than through lamp's name, which allows 70 mm: these are 24 mm apart.
  ['COM1', 'COM2', 'NAV1', 'NAV2', 'MKR'].forEach((nm, i) => {
    const x = st.x - 0.048 + i * 0.024;
    Pn.lamp(x, st.z0 + 0.016, 0.008, 0.005, powered && i % 2 === 0, T.amber);
    Pn.fitText(nm, x, st.z0 + 0.0055, 0.02, 0.006, [200, 200, 196], 0.35, 0.004);
  });

  // ── SWITCHES AND THE FLAP SELECTOR ───────────────────────────────────────
  const ids = ['master', 'beacon', 'land', 'taxi', 'nav', 'strobe'];
  const names = ['MASTER', 'BCN', 'LAND', 'TAXI', 'NAV', 'STROBE'];
  const state = { master: powered, beacon: powered, land: !!L.landingLight, taxi: !!L.landingLight, nav: powered, strobe: powered };
  Y.sw.x.forEach((x, i) => {
    const id = ids[i], on = state[id];
    Pn.rect(x - 0.011, Y.sw.z + 0.017, x + 0.011, Y.sw.z + 0.023, T.placard, 0.1, 0.002);
    Pn.fitText(names[i], x, Y.sw.z + 0.020, 0.02, 0.0045, [24, 24, 26], 0, 0.003);
    const f = eased('otter:' + id, on ? 1 : 0, 18) - pressPulse('otter:' + id, on) * 0.3;
    Pn.rect(x - 0.01, Y.sw.z - 0.016, x + 0.01, Y.sw.z + 0.016, [16, 16, 18], 0, 0.003);
    Pn.stud(x, Y.sw.z + (f * 2 - 1) * 0.005, 0.008, 0.009, 0.007 + f * 0.005, i === 0 ? [210, 44, 38] : [232, 230, 222], 0, 0.003);
  });
  // The flap selector: a lever in a notched gate, UP / 10 / 20 / 37.5, eased between notches.
  const ff = eased('otter:flaps', flap / 3, 8);
  Pn.rect(Y.flaps[0] - 0.012, Y.flaps[2] - 0.035, Y.flaps[0] + 0.012, Y.flaps[2] + 0.035, [16, 16, 18], 0, 0.003);
  for (let i = 0; i < 4; i++) Pn.rect(Y.flaps[0] + 0.014, Y.flaps[2] + 0.03 - i * 0.02, Y.flaps[0] + 0.022, Y.flaps[2] + 0.032 - i * 0.02, T.placard, 0.1, 0.003);
  Pn.fitText('FLAPS', Y.flaps[0], Y.flaps[2] - 0.043, 0.03, 0.0065, [200, 200, 196], 0.35, 0.004);
  Pn.stud(Y.flaps[0], Y.flaps[2] + 0.028 - ff * 0.056, 0.014, 0.008, 0.016, [236, 234, 226], 0, 0.004);

  // ── THE YOKES: a W on a column out of the panel ──────────────────────────
  const yoke = (x) => {
    const h = Y.yoke(x, elev), base = [x, Y.y, h[2]];
    K.rod(base, h, 0.011, 'dash', 0.35, T.column, 0.05, 8);
    const a = ail * 0.9, c = Math.cos(a), s = Math.sin(a);
    const P2 = (dx, dz) => [h[0] + dx * c + dz * s, h[1] - 0.012, h[2] - dx * s + dz * c];
    // The W: a dip in the middle, the arms rising to two grips.
    const pts = [[-0.11, 0.05], [-0.10, 0.0], [-0.03, -0.012], [0, 0.012], [0.03, -0.012], [0.10, 0.0], [0.11, 0.05]];
    for (let i = 0; i < pts.length - 1; i++) K.rod(P2(...pts[i]), P2(...pts[i + 1]), 0.009, 'dash', 0.2, T.yoke, 0, 8);
    for (const sd of [-1, 1]) {
      K.rod(P2(sd * 0.11, 0.05), P2(sd * 0.105, 0.10), 0.013, 'dash', 0.15, C.grip, 0, 8);   // the grips
      K.obox(P2(sd * 0.103, 0.10), [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.005, 0.005, 0.006, 'dash', 0.3, sd < 0 ? T.red : C.black, 0.15);   // PTT / trim buttons
    }
    K.rod(P2(-0.022, 0.012), P2(0.022, 0.012), 0.009, 'dash', 0.3, [170, 160, 120], 0.05, 6);   // the hub plate
    contactShadow(K, [x, Y.y - 0.001, h[2] - 0.05], [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.09, 0.03);
  };
  yoke(0);
  yoke(2 * Y.xC);

  // ── THE OVERHEAD: quadrant and switch panel ──────────────────────────────
  const q = Y.quad;
  K.box(q.x - 0.13, q.y0, q.z - 0.05, q.x + 0.13, q.y1, q.z, 'hdr', -0.2, T.quad);
  const levers = [[-0.085, thr, C.black], [-0.05, thr, C.black], [-0.01, 0.95, C.blue], [0.02, 0.95, C.blue], [0.065, powered ? 1 : 0, T.red], [0.095, powered ? 1 : 0, T.red]];
  levers.forEach(([dx, v, rgb], i) => {
    const vv = eased('otter:lev' + i, v, 10);
    const tip = [q.x + dx, q.y0 + 0.04 + vv * (q.y1 - q.y0 - 0.08), q.z - 0.14];
    K.rod([q.x + dx, tip[1], q.z - 0.05], tip, 0.005, 'hdr', 0, C.chrome, 0.1, 5);
    K.obox(tip, [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.012, 0.014, 0.012, 'hdr', 0.1, rgb, rgb === C.black ? 0 : 0.15);
  });
  // The switch panel forward of it, back from the header: rows of toggles, the start switches, the
  // dome light in the middle.
  const Ov = K.panel([q.x, (q.y1 + P.front) / 2 - 0.02, P.roof - 0.012], [1, 0, 0], [0, -1, 0], 'hdr', -0.1);
  Ov.rect(-0.16, -0.10, 0.16, 0.10, T.overhead, 0, 0.001);
  const ovN = [['BAT', 'GEN 1', 'GEN 2', 'AVION', 'INV', 'BUS', 'EXT'],
               ['IGN 1', 'IGN 2', 'STRT', 'BOOST', 'BOOST', 'XFEED', 'FUEL'],
               ['PITOT', 'DEICE', 'PROP', 'WSHLD', 'INST', 'CABIN', 'FAN']];
  for (let r = 0; r < 3; r++) for (let i = 0; i < 7; i++) Ov.toggle(-0.12 + i * 0.04, 0.06 - r * 0.05, powered && (r + i) % 3 !== 0, ovN[r][i]);
  const dome = !!(L.dome && powered);
  K.box(q.x - 0.05, -0.16, P.roof - 0.022, q.x + 0.05, -0.04, P.roof, 'hdr', 0.1, [190, 186, 176]);
  K.box(q.x - 0.035, -0.145, P.roof - 0.026, q.x + 0.035, -0.055, P.roof - 0.022, 'hdr', 0.3, dome ? [255, 240, 200] : [110, 108, 100], dome ? 1 : 0);

  // ── TRIM WHEEL, PEDALS ───────────────────────────────────────────────────
  const tw = Y.trim, trA = eased('otter:trim', trim, 10);
  K.box(tw[0] - 0.03, tw[1] - 0.08, P.floor, tw[0] + 0.03, tw[1] + 0.08, tw[2] - 0.05, 'dash', 0, T.quad);
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * Math.PI * 2 + trA * 3, a1 = ((i + 1) / 12) * Math.PI * 2 + trA * 3, r = 0.055;
    K.rod([tw[0], tw[1] + Math.cos(a0) * r, tw[2] + Math.sin(a0) * r], [tw[0], tw[1] + Math.cos(a1) * r, tw[2] + Math.sin(a1) * r], 0.009, 'dash', 0.2, i % 3 ? [30, 30, 34] : [210, 210, 214], 0, 5);
  }
  for (const [px, s] of [[-0.10, -1], [0.10, 1], [2 * Y.xC - 0.10, -1], [2 * Y.xC + 0.10, 1]]) {
    pedal(K, [px, Y.y - 0.05, P.floor + 0.15], 0.04, 0.10, clamp(s < 0 ? -rud : rud, 0, 1), [34, 34, 38]);
  }

  // ── BEHIND YOU: THE FREIGHTER ────────────────────────────────────────────
  const ny = P.back + 0.03;
  for (let i = 0; i <= 6; i++) {
    const x = xL + 0.06 + (xR - xL - 0.12) * (i / 6);
    K.rod([x, ny, P.floor + 0.10], [x, ny, P.roof - 0.08], 0.006, 'post', 0.05, T.webbing, 0, 4);
  }
  for (let j = 0; j <= 4; j++) {
    const z = P.floor + 0.10 + (P.roof - 0.18 - P.floor) * (j / 4);
    K.rod([xL + 0.06, ny, z], [xR - 0.06, ny, z], 0.006, 'post', 0.05, T.webbing, 0, 4);
  }
  K.box(Y.xC - 0.18, ny + 0.01, -0.35, Y.xC + 0.18, ny + 0.06, 0.05, 'seat', -0.05, [60, 58, 50]);   // the jump seat, folded
  const M = K.panel([xL, -0.25, P.winZ[0] - 0.12], [0, 1, 0], [0, 0, 1], 'pil', -0.05);   // the manifests
  M.rect(-0.07, -0.09, 0.07, 0.09, C.wood, 0, 0.004);
  M.rect(-0.06, -0.08, 0.06, 0.07, C.paper, 0.1, 0.006);
  for (let i = 0; i < 5; i++) M.rect(-0.05, 0.05 - i * 0.025, 0.04 - (i % 2) * 0.02, 0.053 - i * 0.025, [80, 80, 90], 0, 0.007);
  M.rect(-0.02, 0.07, 0.02, 0.09, C.chrome, 0.1, 0.008);
  // A whiskey compass on the centre post.
  const wc = [Y.xC, P.front - 0.10, P.headerZ - 0.04];
  K.box(wc[0] - 0.03, wc[1] - 0.03, wc[2] - 0.025, wc[0] + 0.03, wc[1] + 0.02, wc[2] + 0.02, 'dash', 0.1, [30, 30, 34]);
  const Wc = facingPanel(K, [wc[0], wc[1] - 0.031, wc[2]], 'dash', 0.2);
  Wc.rect(-0.022, -0.012, 0.022, 0.012, [236, 232, 214], 0.4, 0.001);
  Wc.rect(-0.001, -0.012, 0.001, 0.012, [230, 60, 40], 0.6, 0.002);

  hotspotHalo(K, otterHotspots(P, L), L);
}
