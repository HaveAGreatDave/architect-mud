// THE MAYFLY'S COCKPIT: a Cessna 172, side by side, the pilot in the left seat.
//
// Built on the cockpit kit (interior-cockpit-kit.js) to the Drake's standard: every control that a
// 172 pilot reaches for is here and moves, the ones that do something are clickable (cessnaHotspots),
// the panel is lit by its own floods after dark, and what stands on a surface shades it.
//
// The frame is the shell's: metres, the eye at the origin, x right, y forward, z up. The aircraft's
// centreline is `P.xCentre` to the right of the eye, so the co-pilot's side is at 2·xCentre.
import { makeKit, C, clamp, pedal, SHINY, PANE, TEXTURE } from './interior-kit.js';
import { facingPanel, eased, pressPulse, domeButton, contactShadow, hotspotHalo } from './interior-cockpit-kit.js';

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

// The 172's colours: a light grey panel under a black crackle glareshield, ivory bezels, a black
// avionics stack, a tan cabin.
const T = {
  panel: [74, 78, 86], panelDk: [48, 51, 57], shield: [26, 27, 30], stack: [22, 23, 26],
  bezel: [210, 206, 196], placard: [226, 224, 216], yoke: [34, 34, 38], column: [150, 154, 160],
  throttle: [20, 20, 22], mixture: [196, 36, 34], carpet: [70, 58, 48], trim: [44, 44, 48],
  lcd: [110, 236, 150], lcdBg: [10, 22, 16], amber: [255, 176, 64],
};

// ── WHAT EACH SURFACE IS MADE OF ─────────────────────────────────────────────
// The Drake's standard: a surface answers the light as its material would, not as a flat colour.
// Registered by identity on T's own arrays, so no other cockpit changes. The yoke column is the one
// real mirror in a 172 (chromed tube), so it takes the metal ramp and reflects the sky; the crackle
// glareshield is nearly dead matte; bezels are cast and the knobs are lacquered moulding.
SHINY.set(T.column, { spec: 0.8, pow: 24, ramp: [[70, 72, 78], [236, 238, 242]], glint: 0.3, albedo: [236, 238, 242], envK: 0.8 });
SHINY.set(T.yoke, { spec: 0.35, pow: 30 });
SHINY.set(T.throttle, { spec: 0.4, pow: 40 });
SHINY.set(T.mixture, { spec: 0.45, pow: 40 });
SHINY.set(T.bezel, { spec: 0.3, pow: 20 });
SHINY.set(T.shield, { spec: 0.05, pow: 8 });
for (const [k, tex] of [['panel', 'paint'], ['panelDk', 'paint'], ['shield', 'cast'], ['stack', 'plastic'], ['bezel', 'cast'],
  ['placard', 'paint'], ['yoke', 'plastic'], ['column', 'brushed'], ['throttle', 'plastic'], ['mixture', 'plastic'],
  ['carpet', 'carpet'], ['trim', 'plastic']]) TEXTURE.set(T[k], tex);
// The glass over each dial catches a crescent of window light, upper left.
const GLINT = [255, 252, 244];
PANE.set(GLINT, 0.18);

// Where things are, as functions of the profile, so the hotspots and the geometry are one table.
function layout(P) {
  const xC = P.xCentre, y = P.dashY - 0.004, top = P.dashZ - 0.012;
  return {
    xC, y, top,
    six: { x: 0.0, z: [top - 0.075, top - 0.165], dx: 0.086, R: 0.033 },
    stack: { x: xC, w: 0.085, z0: top - 0.245, z1: top - 0.03 },
    eng: { x: xC + 0.21, z: [top - 0.075, top - 0.165] },
    sw: { z: top - 0.215, x: [-0.215, -0.185, -0.155, -0.125, -0.095, -0.065] },   // master, beacon, land, taxi, nav, strobe
    throttle: [xC - 0.06, y, top - 0.205], mixture: [xC + 0.035, y, top - 0.205],
    flaps: [xC + 0.13, y, top - 0.215],
    yoke: (x, elev) => [x, y - 0.17 - clamp(elev, -1, 1) * 0.04, top - 0.20],   // the shaft comes out BELOW the six-pack
    trim: [xC - 0.02, 0.10, P.floor + 0.26],
  };
}

export function cessnaHotspots(P, live) {
  const L = live || {}, Y = layout(P), Kd = makeKit(() => {});
  const Pn = Kd.panel([0, Y.y, 0], [1, 0, 0], [0, 0, 1]);
  const at = (x, z) => Pn.pt(x, z, 0.01);
  const out = [];
  const ids = ['master', 'beacon', 'land', 'taxi', 'nav', 'strobe'];
  Y.sw.x.forEach((x, i) => out.push({ id: 'ck:' + ids[i], p: at(x, Y.sw.z), r: 0.016, kind: 'click' }));
  out.push({ id: 'ck:flaps', p: at(Y.flaps[0], Y.flaps[2]), r: 0.02, kind: 'click' });
  out.push({ id: 'ck:dome', p: [Y.xC, 0.05, P.roof - 0.02], r: 0.03, kind: 'click' });
  out.push({ id: 'yoke', p: (([x, y, z]) => [x, y, z + 0.05])(Y.yoke(0, num(L.stickY))), r: 0.09, kind: 'yoke' });
  out.push({ id: 'throttle', p: [Y.throttle[0], Y.throttle[1] - 0.04, Y.throttle[2]], r: 0.03, kind: 'throttle' });
  out.push({ id: 'trim', p: Y.trim, r: 0.05, kind: 'trim' });
  return out;
}

export function cessnaFit(P, live, push) {
  const K = makeKit(push), L = live || {}, Y = layout(P);
  const powered = L.powered !== false;
  const ias = num(L.ias), alt = num(L.alt), vsi = num(L.vsi), hdg = num(L.hdg), rpm = clamp(num(L.rpm), 0, 1);
  const pitch = num(L.pitch), bank = num(L.bank), fuel = clamp(num(L.fuel, 1) > 1 ? num(L.fuel) / 100 : num(L.fuel, 1), 0, 1);
  const thr = clamp(num(L.throttle), 0, 1), ail = clamp(num(L.stickX), -1, 1), elev = clamp(num(L.stickY), -1, 1);
  const trim = clamp(num(L.trim), -1, 1), rud = clamp(num(L.rudder), -1, 1), flap = clamp(num(L.flapNotch), 0, 3);
  const xL = Y.xC - P.halfW, xR = Y.xC + P.halfW;
  const lit = powered ? 1 : 0.12;

  // ── THE PANEL, THE GLARESHIELD, THE STACK ────────────────────────────────
  const Pn = K.panel([0, Y.y, 0], [1, 0, 0], [0, 0, 1], 'dash', 0.2);
  const glint = (x, z, R) => Pn.annulus(x, z, R * 0.62, R * 0.88, GLINT, 1, 0.012, 8, Math.PI * 0.55, Math.PI * 0.9);
  const dial = (x, z, R, f, o) => { Pn.dial(x, z, R, f, o); glint(x, z, R); };
  Pn.rect(xL + 0.02, Y.top - 0.33, xR - 0.02, Y.top, T.panel, 0, 0.0005);
  Pn.rect(xL + 0.02, Y.top - 0.33, xR - 0.02, Y.top - 0.315, T.panelDk, 0, 0.001);   // the lower lip
  // The glareshield: black crackle over the whole panel, overhanging it, with the post-light hood.
  K.box(xL + 0.01, Y.y - 0.05, Y.top - 0.005, xR - 0.01, Y.y + 0.02, Y.top + 0.03, 'dash', 0.05, T.shield);
  K.box(xL + 0.01, Y.y - 0.055, Y.top - 0.012, xR - 0.01, Y.y - 0.045, Y.top + 0.03, 'dash', -0.1, T.shield);
  // The avionics stack: a black bay in the middle, units stacked in it.
  const st = Y.stack;
  Pn.rect(st.x - st.w, st.z0, st.x + st.w, st.z1, T.stack, 0, 0.002);
  // GPS on top: a lit moving map with a heading-up track line and the aircraft.
  const gz0 = st.z1 - 0.09, gz1 = st.z1 - 0.008;
  Pn.rect(st.x - st.w + 0.008, gz0, st.x + st.w - 0.008, gz1, powered ? [16, 34, 28] : [10, 12, 12], powered ? 0.6 : 0, 0.004);
  if (powered) {
    for (let i = 1; i < 4; i++) Pn.rect(st.x - st.w + 0.01, gz0 + i * 0.02, st.x + st.w - 0.01, gz0 + i * 0.02 + 0.0012, [40, 110, 80], 0.8, 0.005);
    Pn.rect(st.x - 0.0012, gz0 + 0.008, st.x + 0.0012, gz1 - 0.008, [230, 90, 220], 0.9, 0.0055);
    Pn.disc(st.x, gz0 + 0.02, 0.005, [255, 255, 255], 1, 0.006, 6);
  }
  // COM/NAV and the transponder: green seven-segment readouts, and knobs.
  const unit = (z, str) => {
    Pn.rect(st.x - st.w + 0.006, z - 0.022, st.x + st.w - 0.006, z + 0.022, [34, 36, 40], 0, 0.003);
    if (powered) Pn.digits(st.x - 0.06, z - 0.009, 0.018, str, T.lcd, true);
    else Pn.rect(st.x - 0.06, z - 0.01, st.x + 0.03, z + 0.01, T.lcdBg, 0, 0.004);
    Pn.knob(st.x + 0.06, z, 0.009, 0.012, [60, 60, 66], 0);
  };
  unit(gz0 - 0.03, '12280');
  unit(gz0 - 0.08, '11340');
  unit(gz0 - 0.13, String(1200 + (Math.round(hdg) % 7)).padStart(4, '0'));
  // The audio panel: a row of lit buttons.
  // Lettered here rather than through lamp's name, which allows 70 mm: these are 24 mm apart.
  ['COM1', 'COM2', 'NAV1', 'NAV2', 'MKR', 'SPKR'].forEach((nm, i) => {
    const x = st.x - 0.06 + i * 0.024;
    Pn.lamp(x, st.z0 + 0.018, 0.008, 0.005, powered && (i === 0 || i === 3), T.amber);
    Pn.fitText(nm, x, st.z0 + 0.0065, 0.02, 0.006, [200, 200, 196], 0.35, 0.004);
  });

  // ── THE SIX-PACK ─────────────────────────────────────────────────────────
  const sx = (i) => Y.six.x + (i - 1) * Y.six.dx, R = Y.six.R, [z1, z2] = Y.six.z;
  const face = powered ? [236, 232, 220] : [150, 146, 138];
  const dialO = (o) => ({ face: [24, 26, 30], bezel: T.bezel, tick: [230, 230, 224], ...o });
  dial(sx(0), z1, R, clamp(ias / 160, 0, 1), dialO({ ticks: 16, major: 4, arcs: [[0.25, 0.8, C.green], [0.8, 0.95, C.amber]], red: 0.96, name: 'MPH' }));
  Pn.attitude(sx(1), z1, R, pitch, bank); glint(sx(1), z1, R);
  dial(sx(2), z1, R, (alt % 1000) / 1000, dialO({ a0: Math.PI / 2, sweep: Math.PI * 2, ticks: 10, major: 1, frac2: (alt % 10000) / 10000, name: 'ALT' }));
  dial(sx(0), z2, R, clamp(0.5 + bank / 90, 0, 1), dialO({ a0: Math.PI * 0.9, sweep: Math.PI * 0.8, ticks: 6, major: 3, name: 'TURN' }));
  Pn.compass(sx(1), z2, R, hdg); glint(sx(1), z2, R);
  dial(sx(2), z2, R, clamp(0.5 + vsi / 3000, 0, 1), dialO({ a0: Math.PI, sweep: Math.PI * 1.8, ticks: 8, major: 2, name: 'VSI' }));
  // Clock and suction, small, to the left.
  dial(sx(0) - 0.08, z1, 0.022, ((L.hour ?? 12) % 12) / 12, dialO({ a0: Math.PI / 2, sweep: Math.PI * 2, ticks: 12, major: 3, name: 'CLOCK' }));
  dial(sx(0) - 0.08, z2, 0.022, powered ? 0.55 : 0, dialO({ ticks: 6, major: 2, arcs: [[0.35, 0.75, C.green]], name: 'VAC' }));
  void face;

  // ── ENGINE GAUGES ────────────────────────────────────────────────────────
  const ex = Y.eng.x;
  dial(ex, z1, 0.03, rpm, dialO({ ticks: 14, major: 2, arcs: [[0.55, 0.9, C.green]], red: 0.93, name: 'RPM' }));
  dial(ex + 0.075, z1, 0.02, fuel, dialO({ ticks: 4, major: 1, red: 0.08, name: 'FUEL L' }));
  dial(ex + 0.125, z1, 0.02, fuel, dialO({ ticks: 4, major: 1, red: 0.08, name: 'FUEL R' }));
  dial(ex + 0.075, z2, 0.02, powered ? 0.4 + rpm * 0.25 : 0, dialO({ ticks: 4, major: 1, arcs: [[0.2, 0.8, C.green]], name: 'OIL P' }));
  dial(ex + 0.125, z2, 0.02, powered ? 0.3 + rpm * 0.4 : 0, dialO({ ticks: 4, major: 1, arcs: [[0.25, 0.85, C.green]], name: 'OIL T' }));

  // ── SWITCHES ─────────────────────────────────────────────────────────────
  // The split red master, then white rockers: beacon, landing, taxi, nav, strobe. Each moves.
  const ids = ['master', 'beacon', 'land', 'taxi', 'nav', 'strobe'];
  const names = ['MASTER', 'BCN', 'LAND', 'TAXI', 'NAV', 'STROBE'];
  const state = { master: powered, beacon: powered, land: !!L.landingLight, taxi: !!L.landingLight, nav: powered, strobe: powered };
  Y.sw.x.forEach((x, i) => {
    const id = ids[i], on = state[id];
    Pn.rect(x - 0.012, Y.sw.z + 0.018, x + 0.012, Y.sw.z + 0.024, T.placard, 0.1, 0.002);   // the placard over it
    Pn.fitText(names[i], x, Y.sw.z + 0.021, 0.022, 0.0045, [24, 24, 26], 0, 0.003);
    const f = eased('mayfly:' + id, on ? 1 : 0, 18) - pressPulse('mayfly:' + id, on) * 0.3;
    Pn.rect(x - 0.011, Y.sw.z - 0.017, x + 0.011, Y.sw.z + 0.017, [16, 16, 18], 0, 0.003);
    Pn.stud(x, Y.sw.z + (f * 2 - 1) * 0.005, 0.008, 0.009, 0.007 + f * 0.005, i === 0 ? [200, 40, 36] : [232, 230, 222], 0, 0.003);
  });
  // The flap switch: a little white airfoil-shaped tab, down with the flaps.
  const ff = eased('mayfly:flaps', flap / 3, 10);
  Pn.rect(Y.flaps[0] - 0.012, Y.flaps[2] - 0.03, Y.flaps[0] + 0.012, Y.flaps[2] + 0.03, [16, 16, 18], 0, 0.003);
  Pn.fitText('FLAPS', Y.flaps[0], Y.flaps[2] - 0.038, 0.03, 0.0065, [200, 200, 196], 0.35, 0.004);
  Pn.stud(Y.flaps[0], Y.flaps[2] + 0.02 - ff * 0.04, 0.012, 0.006, 0.014, [236, 234, 226], 0, 0.004);

  // ── THROTTLE AND MIXTURE: push-pull knobs, in is forward ─────────────────
  const pull = (base, out, rgb, r) => {
    const tip = [base[0], base[1] - 0.02 - out, base[2]];
    K.rod([base[0], base[1], base[2]], tip, 0.004, 'dash', 0.3, C.chrome, 0.1, 6);
    K.rod(tip, [tip[0], tip[1] - 0.018, tip[2]], r, 'dash', 0.3, rgb, 0.05, 12);
    contactShadow(K, [base[0], Y.y - 0.001, base[2] - 0.012], [1, 0, 0], [0, 0, 1], [0, -1, 0], r * 1.3, r * 0.8);
  };
  pull(Y.throttle, (1 - thr) * 0.06, T.throttle, 0.014);
  pull(Y.mixture, 0.005, T.mixture, 0.012);

  // ── THE YOKES ────────────────────────────────────────────────────────────
  // A chrome column out of the panel and a black ram's-horn yoke on it, rolled by the aileron and
  // run in and out by the elevator. The co-pilot's is linked, so it moves too.
  const yoke = (x) => {
    const h = Y.yoke(x, elev), base = [x, Y.y, h[2]];
    K.rod(base, h, 0.008, 'dash', 0.4, T.column, 0.05, 8);
    const a = ail * 0.9, c = Math.cos(a), s = Math.sin(a);
    const P2 = (dx, dz) => [h[0] + dx * c + dz * s, h[1] - 0.01, h[2] - dx * s + dz * c];
    K.rod(P2(-0.075, 0), P2(0.075, 0), 0.008, 'dash', 0.2, T.yoke, 0, 8);          // the bar
    for (const sd of [-1, 1]) {
      K.rod(P2(sd * 0.075, 0), P2(sd * 0.09, 0.045), 0.010, 'dash', 0.2, T.yoke, 0, 8);   // the horns, up
      K.rod(P2(sd * 0.09, 0.045), P2(sd * 0.08, 0.07), 0.009, 'dash', 0.2, T.yoke, 0, 8);
    }
    K.rod(P2(-0.018, 0.006), P2(0.018, 0.006), 0.007, 'dash', 0.3, [200, 190, 150], 0.05, 6);   // the hub plate
    contactShadow(K, [x, Y.y - 0.001, h[2] - 0.05], [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.07, 0.03);
  };
  yoke(0);
  yoke(2 * Y.xC);

  // ── TRIM WHEEL, FUEL SELECTOR, PEDALS ────────────────────────────────────
  const tw = Y.trim, trA = eased('mayfly:trim', trim, 10);
  K.box(tw[0] - 0.02, tw[1] - 0.06, P.floor, tw[0] + 0.02, tw[1] + 0.06, tw[2] - 0.05, 'dash', 0, T.trim);
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * Math.PI * 2 + trA * 3, a1 = ((i + 1) / 12) * Math.PI * 2 + trA * 3, r = 0.05;
    K.rod([tw[0], tw[1] + Math.cos(a0) * r, tw[2] + Math.sin(a0) * r], [tw[0], tw[1] + Math.cos(a1) * r, tw[2] + Math.sin(a1) * r], 0.008, 'dash', 0.2, i % 3 ? [30, 30, 34] : [210, 210, 214], 0, 5);
  }
  K.box(Y.xC - 0.05, -0.05, P.floor, Y.xC + 0.05, 0.05, P.floor + 0.012, 'floor', 0, [40, 40, 44]);
  K.box(Y.xC - 0.008, -0.03, P.floor + 0.012, Y.xC + 0.008, 0.03, P.floor + 0.035, 'floor', 0.3, [200, 40, 36]);
  for (const [px, s] of [[-0.09, -1], [0.09, 1], [2 * Y.xC - 0.09, -1], [2 * Y.xC + 0.09, 1]]) {
    pedal(K, [px, Y.y - 0.04, P.floor + 0.14], 0.035, 0.09, clamp(s < 0 ? -rud : rud, 0, 1), [30, 30, 34]);
  }

  // ── WHISKEY COMPASS, DOME LIGHT, DOORS ───────────────────────────────────
  const wc = [Y.xC, P.front - 0.09, P.headerZ - 0.03];
  K.box(wc[0] - 0.03, wc[1] - 0.03, wc[2] - 0.025, wc[0] + 0.03, wc[1] + 0.02, wc[2] + 0.02, 'dash', 0.1, [30, 30, 34]);
  const Wc = facingPanel(K, [wc[0], wc[1] - 0.031, wc[2]], 'dash', 0.2);
  Wc.rect(-0.022, -0.012, 0.022, 0.012, [236, 232, 214], 0.4, 0.001);
  Wc.rect(-0.001, -0.012, 0.001, 0.012, [230, 60, 40], 0.6, 0.002);
  const dome = !!(L.dome && powered);
  K.box(Y.xC - 0.05, 0.0, P.roof - 0.02, Y.xC + 0.05, 0.10, P.roof, 'hdr', 0.1, [200, 196, 186]);
  K.box(Y.xC - 0.035, 0.015, P.roof - 0.024, Y.xC + 0.035, 0.085, P.roof - 0.02, 'hdr', 0.3, dome ? [255, 240, 200] : [120, 118, 110], dome ? 1 : 0);
  for (const [x, sd] of [[xL + 0.012, 1], [xR - 0.012, -1]]) {
    K.box(x - (sd < 0 ? 0.05 : 0), -0.30, -0.38, x + (sd > 0 ? 0.05 : 0), 0.20, -0.33, 'pil', 0.1, [150, 128, 104]);   // the armrest
    K.rod([x + sd * 0.04, 0.24, -0.30], [x + sd * 0.04, 0.32, -0.30], 0.008, 'pil', 0.4, C.chrome, 0.1, 6);   // the handle
  }

  // ── WHAT IS UNDER THE POINTER ─────────────────────────────────────────────
  hotspotHalo(K, cessnaHotspots(P, L), L);
  void lit;
}
