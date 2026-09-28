// ONE COCKPIT PER AIRFRAME — the fit-outs for every aircraft that used to borrow somebody else's.
//
// Until this file the Mule, the Leviathan, the Reaper and the Shrike all sat in ONE light-twin tub
// with a yoke each side, the Viper sat in the Dragonfly's glass bubble, and the Locust, the
// Grasshopper, the Mayfly and the Carcass had no interior at all. Each function below is the inside
// of one of them, built from the same kit (interior-kit.js) as every other seat so no aircraft can
// quietly end up with the better gauge.
//
// ⚠ THE ROOM IS THE PROFILE'S, THE CONTENTS ARE HERE — the split interior-fit.js already uses. A
// profile in interior-shell.js says how big the cabin is and where the glass is; these functions
// only fill it, and every one of them stays inside `shellBounds` and off the three sight lines the
// gate casts (straight ahead, and through the middle of each side window), plus straight up for a
// profile whose roof is glass (`roofGlass`).
//
// ⚠ AND `live` IS OPTIONAL EVERYWHERE, as it is there: every reader has a resting value, so the gate
// can build any of these with no sim behind it.
import { makeKit, C, clamp, pedal, richSeat } from './interior-kit.js';
import { planeFit, annun } from './interior-fit.js';
import { eased, pressPulse, hotspotHalo } from './interior-cockpit-kit.js';

// ── THE CONTROLS YOU CAN TOUCH ────────────────────────────────────────────────
//
// Every cockpit in this file gets what the Drake and the Cessna have: a row of switches that move
// and click (master, lights), and a stick and a throttle you can grab. One spec per aircraft says
// where they are, and both the drawing and the hotspot list read it, so a switch can never be drawn
// in one place and clicked in another. The ids are the kit's 'ck:*' set (cockpit.js DK_ACT).
//
//   strip   [u0, v, ids]  a switch row on the aircraft's flat panel, in that panel's own coords
//   stick   (P, R) => the grip, in shell metres
//   thr     (P, R) => the throttle knob (or collective), in shell metres
//   extra   (P, R) => more hotspots (a gear lever, a flap lever)
const SW_PITCH = 0.024;
// What each switch's placard says.
const PLACARD = { master: 'MSTR', land: 'LDG', nav: 'NAV', strobe: 'STRB', dome: 'DOME', beacon: 'BCN', taxi: 'TAXI' };
const flatAt = (P, hh) => makeKit(() => {}).panel([P.xCentre, P.dashY - 0.006, P.dashZ - 0.06 - hh], [1, 0, 0], [0, 0, 1]);
const specPanel = (c, P) => (c.panel ? makeKit(() => {}).panel(...c.panel(P)) : flatAt(P, c.hh));
const gripAt = (x, y, top, R, up = 0.06) => [x + R.ail * 0.06, y + 0.045 + R.elev * 0.07, top + up];
const quadAt = (P, R, o = {}) => {
  const x = P.xCentre - P.halfW + 0.03 + 0.018, y0 = o.y0 ?? -0.14, y1 = o.y1 ?? 0.14, z = o.z ?? (P.winZ[0] - 0.08);
  return [x, y0 + 0.03 + R.thr * (y1 - y0 - 0.06), z + 0.07];
};
const levPz = (P) => P.dashZ - 0.065 - 0.165;      // planeFit's panel centre
const CTRL = {
  // The Dragonfly (heliFit in interior-fit.js): the switches are a row along the bottom of the pod,
  // right of the vertical-speed dial, and the cyclic and the collective are what you grab.
  heli: { panel: (P) => [[0, P.dashY, P.dashZ], [1, 0, 0], [0, 0.35, 0.94]], strip: [0.06, -0.103, ['master', 'land', 'nav', 'strobe', 'dome']],
    stick: (P, R) => [R.ail * 0.06 + 0.01, 0.17 + R.elev * 0.07, -0.37],
    thr: (P, R) => [-P.seatHalf - 0.06, P.seatY[1] + 0.18, P.seatZ + 0.08 + R.thr * 0.16] },
  locust: { hh: 0.12, strip: [-0.235, 0.098, ['master', 'land', 'nav', 'strobe']],
    stick: (P, R) => gripAt(P.xCentre, 0.10, P.dashZ - 0.18 - 0.08, R), thr: (P, R) => quadAt(P, R) },
  grasshopper: { hh: 0.075, strip: [-0.20, -0.052, ['master', 'nav', 'land']],
    stick: (P, R) => gripAt(P.xCentre, 0.12, -0.46, R), thr: (P, R) => quadAt(P, R, { y0: -0.05, y1: 0.20 }) },
  reaper: { hh: 0.15, strip: [-0.335, 0.125, ['master', 'beacon', 'land', 'nav', 'strobe']],
    stick: (P, R) => gripAt(P.xCentre, 0.12, P.dashZ - 0.21 - 0.10, R),
    thr: (P, R) => [P.xCentre - P.halfW + 0.07, -0.20 + R.thr * 0.20, P.seatZ + 0.22] },
  shrike: { hh: 0.13, strip: [-0.335, 0.108, ['master', 'land', 'nav']],
    stick: (P, R) => gripAt(P.xCentre, 0.10, P.dashZ - 0.19 - 0.08, R), thr: (P, R) => quadAt(P, R) },
  viper: { hh: 0.13, strip: [-0.29, 0.115, ['master', 'beacon', 'land', 'nav', 'strobe']],
    stick: (P, R) => gripAt(P.xCentre, 0.10, P.dashZ - 0.19 - 0.08, R),
    thr: (P, R) => [P.xCentre - P.halfW + 0.16, P.seatY[1] + 0.15, P.seatZ + 0.12 + R.thr * 0.14] },
  carcass: { hh: 0.14, strip: [-0.46, 0.118, ['master', 'land']],
    stick: (P, R) => gripAt(0, 0.14, P.dashZ - 0.20 - 0.10, R),
    thr: (P, R) => [P.xCentre - P.halfW + 0.06, 0.05 + R.thr * 0.15, P.winZ[0] - 0.14] },
  // The Leviathan keeps planeFit's panel, whose own toggle row is master, alternator, landing, taxi,
  // nav, strobe, pitot: those become clickable where they already are, and nothing is redrawn.
  leviathan: { planeRow: ['master', null, 'land', 'taxi', 'nav', 'strobe'],
    stick: (P, R) => [0, 0.34 - R.elev * 0.05, levPz(P) - 0.10 + 0.05],
    thr: (P, R) => [P.xCentre - 0.07, 0.33 + R.thr * 0.16, P.dashZ - 0.065 - 0.165 * 2 - 0.02 + 0.06],
    extra: (P, R) => {
      const qz = levPz(P) - 0.165 - 0.02, fl = clamp(num(R.L.flapNotch), 0, 3);
      return [{ id: 'ck:flaps', p: [P.xCentre + 0.072, 0.32 - fl * 0.07, qz + 0.09], r: 0.025, kind: 'click' }];
    } },
};

function switchState(R) {
  const on = R.powered, land = !!R.L.landingLight;
  return { master: on, beacon: on, land, taxi: land, nav: on, strobe: on, dome: !!(R.L.dome && on) };
}

// Every hotspot for one of this file's aircraft.
export function craftHotspots(craft, P, live) {
  const c = CTRL[craft];
  if (!c) return [];
  const R = readings(live), out = [];
  if (c.strip) {
    const Pn = specPanel(c, P), [u0, v, ids] = c.strip;
    ids.forEach((id, i) => out.push({ id: 'ck:' + id, p: Pn.pt(u0 + i * SW_PITCH, v, 0.01), r: 0.013, kind: 'click' }));
  }
  if (c.planeRow) {
    const Pn = makeKit(() => {}).panel([P.xCentre, P.dashY - 0.006, levPz(P)], [1, 0, 0], [0, 0, 1]);
    c.planeRow.forEach((id, i) => id && out.push({ id: 'ck:' + id, p: Pn.pt(-P.xCentre - 0.25 + i * 0.045, -0.135, 0.01), r: 0.016, kind: 'click' }));
  }
  if (c.stick) out.push({ id: 'yoke', p: c.stick(P, R), r: 0.07, kind: 'yoke' });
  if (c.thr) out.push({ id: 'throttle', p: c.thr(P, R), r: 0.035, kind: 'throttle' });
  if (c.extra) out.push(...c.extra(P, R));
  return out;
}

// Draw the spec's switch row onto the aircraft's flat panel, and the halo round whatever the pointer
// is over. Each switch eases between its positions and gives a little when it is thrown.
export function craftControls(K, Pn, craft, P, live) {
  const c = CTRL[craft], R = readings(live);
  if (c.strip) {
    const [u0, v, ids] = c.strip, st = switchState(R);
    ids.forEach((id, i) => {
      const u = u0 + i * SW_PITCH, on = !!st[id];
      const f = eased(craft + ':' + id, on ? 1 : 0, 18) - pressPulse(craft + ':' + id, on) * 0.3;
      Pn.rect(u - 0.009, v + 0.015, u + 0.009, v + 0.020, [214, 212, 204], 0.1, 0.002);   // the placard
      Pn.fitText(PLACARD[id] || id.toUpperCase(), u, v + 0.0175, 0.016, 0.004, [24, 24, 26], 0, 0.0035);
      Pn.rect(u - 0.0085, v - 0.014, u + 0.0085, v + 0.014, [14, 14, 16], 0, 0.003);
      Pn.stud(u, v + (f * 2 - 1) * 0.0045, 0.0068, 0.0078, 0.006 + f * 0.004, id === 'master' ? [210, 44, 38] : [232, 230, 222], 0, 0.003);
    });
  }
  hotspotHalo(K, craftHotspots(craft, P, live), live);
}


const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// The readings every flight panel shares, resolved once.
export function readings(live) {
  const L = live || {};
  return {
    L,
    pitch: num(L.pitch), bank: num(L.bank), hdg: num(L.hdg),
    ias: Math.max(0, num(L.ias)), vne: Math.max(40, num(L.vne, 160)),
    alt: Math.max(0, num(L.alt)), vsi: num(L.vsi),
    rpm: clamp(num(L.rpm), 0, 1.05), thr: clamp(num(L.throttle), 0, 1),
    fuel: clamp(num(L.fuel, 1), 0, 1), hull: clamp(num(L.hull, 1), 0, 1),
    powered: L.powered !== false,
    ail: clamp(num(L.stickX), -1, 1), elev: clamp(num(L.stickY), -1, 1), rud: clamp(num(L.rudder), -1, 1),
  };
}

// A centre stick between the knees, leaning with the aileron and the elevator. `top` is where the
// grip sits at rest; the base is on the floor under it.
export function centreStick(K, P, R, x, y, top, o = {}) {
  const base = [x, y, P.floor + 0.02];
  K.obox([x, y, P.floor + 0.035], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.05, 0.05, 0.025, 'dash', 0, C.rubber);
  const tip = [x + R.ail * 0.06, y + 0.04 + R.elev * 0.07, top];
  K.rod(base, tip, o.shaft || 0.013, 'dash', 0, o.shaftRgb || C.black, 0, 6);
  const grip = add3(tip, [0, 0.01, o.gripLen || 0.11]);
  K.rod(tip, grip, o.gripR || 0.02, 'dash', 0.05, o.gripRgb || C.grip, 0, 8);
  if (o.trigger) K.obox(add3(tip, [0, 0.022, 0.035]), [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.006, 0.012, 0.006, 'dash', 0.2, C.black);
  if (o.button) K.obox(add3(grip, [0, 0, 0.004]), [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.007, 0.007, 0.004, 'dash', 0.3, o.button, 0.25);
  return grip;
}

// A throttle on a quadrant bolted to the wall on the pilot's left hand — how every tandem and
// single-seat taildragger in the game is flown. `n` levers, the first one being the throttle.
export function wallQuadrant(K, P, R, n = 1, o = {}) {
  const x = P.xCentre - P.halfW + 0.03, y0 = o.y0 ?? -0.14, y1 = o.y1 ?? 0.14, z = o.z ?? (P.winZ[0] - 0.08);
  K.box(x - 0.03, y0, z - 0.03, x + 0.03, y1, z, 'dash', -0.05, [30, 32, 36]);
  const cols = o.rgb || [C.black, C.blue, C.red, C.white];
  for (let i = 0; i < n; i++) {
    const v = i === 0 ? R.thr : (o.vals ? o.vals[i] : 0.9);
    const lx = x + 0.018 - i * 0.015;
    const tip = [lx, y0 + 0.03 + v * (y1 - y0 - 0.06), z + 0.07];
    K.rod([lx, tip[1], z], tip, 0.004, 'dash', 0, C.chrome, 0.1, 5);
    K.obox(tip, [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.008, 0.012, 0.010, 'dash', 0.1, cols[i % cols.length], 0);
  }
}

// Framing for a greenhouse canopy: hoops over the glass at the given stations. ⚠ NEVER AT y = 0 —
// the eye looks straight up through the gap between two hoops, and the gate asserts it can.
export function canopyHoops(K, P, ys, rad = 0.012, rgb = null) {
  const xL = P.xCentre - P.halfW + rad, xR = P.xCentre + P.halfW - rad, zt = P.roof - rad, zs = P.winZ[0];
  for (const y of ys) {
    K.rod([xL, y, zs], [xL, y, zt], rad, 'pil', 0.22, rgb, 0, 6);
    K.rod([xR, y, zs], [xR, y, zt], rad, 'pil', 0.22, rgb, 0, 6);
    K.rod([xL, y, zt], [xR, y, zt], rad, 'pil', 0.22, rgb, 0, 6);
  }
}

// A flat flight panel across the cockpit, facing the pilot, hung under the coaming. Returns the
// kit panel so the caller can lay out its own instruments on it.
export function flatPanel(K, P, hh, o = {}) {
  const pz = P.dashZ - 0.06 - hh, py = P.dashY - 0.006;
  const Pn = K.panel([P.xCentre, py, pz], [1, 0, 0], [0, 0, 1]);
  const HW = o.hw ?? (P.halfW - 0.03);
  Pn.rect(-HW, -hh, HW, hh, o.rgb || [34, 38, 44], 0, 0);
  K.box(P.xCentre - HW, P.dashY - 0.03, P.dashZ - 0.06, P.xCentre + HW, P.dashY + 0.02, P.dashZ + 0.01, 'dash', 0.25);
  return { Pn, pz, py, HW };
}

// The basic six in two rows of three around `pc`.
export function sixPack(Pn, R, pc, r1, r2, rad, dx) {
  Pn.dial(pc - dx, r1, rad, clamp(R.ias / (R.vne * 1.1), 0, 1), { ticks: 16, major: 4, arcs: [[0.3, 0.82, C.green], [0.82, 0.91, C.amber]], red: 0.91, name: 'IAS' });
  Pn.attitude(pc, r1, rad, R.pitch, R.bank);
  Pn.dial(pc + dx, r1, rad, (R.alt % 1000) / 1000, { a0: Math.PI / 2, sweep: Math.PI * 2, ticks: 10, major: 1, frac2: (R.alt % 10000) / 10000, name: 'ALT' });
  Pn.dial(pc - dx, r2, rad, clamp(0.5 + R.bank / 60, 0, 1), { a0: Math.PI * 0.9, sweep: Math.PI * 0.8, ticks: 4, major: 2, needle: C.white, name: 'TURN' });
  Pn.compass(pc, r2, rad, R.hdg);
  Pn.dial(pc + dx, r2, rad, clamp(0.5 + R.vsi / 4000, 0, 1), { a0: Math.PI, sweep: Math.PI * 1.8, ticks: 8, major: 2, name: 'VSI' });
}

// Two pedals for one pair of feet.
export function pedals(K, P, R, x, y, z, rgb = C.steel) {
  pedal(K, [x - 0.09, y, z], 0.04, 0.2, Math.max(0, -R.rud), rgb);
  pedal(K, [x + 0.09, y, z], 0.04, 0.2, Math.max(0, R.rud), rgb);
}

// The Mule is the Twin Otter and has its own cockpit on the kit: interior-otter.js.

// ── LEVIATHAN — the transport flight deck ────────────────────────────────────
//
// An An-124 is flown from a deck, not a cockpit: the same two yokes and the same panel, then FOUR
// thrust levers on a wide pedestal, an overhead that covers the whole ceiling, and a flight
// engineer's station behind the right seat, with a panel of its own, a fold-down seat and a chart
// table. The windows are further off and the room is taller, which is what reads as big.
export function leviathanFit(P, live, push) {
  planeFit(P, live, push);
  const K = makeKit(push);
  const R = readings(live);
  const cx = P.xCentre, xR = cx + P.halfW;
  // The four thrust levers, forward of the throttle planeFit put on the pedestal.
  const qz = P.dashZ - 0.065 - 0.165 * 2 - 0.02;
  K.box(cx - 0.16, 0.30, P.floor, cx + 0.16, 0.52, qz - 0.04, 'dash', -0.1, [30, 32, 36]);
  const Q = K.panel([cx, 0.41, qz - 0.039], [1, 0, 0], [0, 1, 0]);
  Q.rect(-0.15, -0.10, 0.15, 0.10, [22, 24, 28], 0, 0.001);
  for (let i = 0; i < 4; i++) {
    const lx = cx - 0.105 + i * 0.07, v = R.thr * (1 - i * 0.01);
    Q.rect(lx - cx - 0.005, -0.08, lx - cx + 0.005, 0.08, C.black, 0, 0.002);
    const tip = [lx, 0.33 + v * 0.16, qz + 0.06];
    K.rod([lx, tip[1], qz - 0.04], tip, 0.006, 'dash', 0, C.chrome, 0.1, 5);
    K.obox(tip, [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.028, 0.012, 0.014, 'dash', 0.15, C.white, 0.1);
  }
  // Four engine columns on the centre of the panel: N1 bars, one per engine.
  const Pn = K.panel([cx, P.dashY - 0.007, P.dashZ - 0.065 - 0.165], [1, 0, 0], [0, 0, 1]);
  for (let i = 0; i < 4; i++) Pn.bar(-0.075 + i * 0.05, -0.15, -0.02, 0.012, clamp(R.rpm * (1 - i * 0.015), 0, 1), R.rpm > 0.98 ? C.amber : C.green, 'ENG ' + (i + 1));
  // The overhead: a whole ceiling of switch rows.
  const oz = P.roof - 0.05;
  K.box(cx - 0.40, -0.40, oz, cx + 0.40, 0.46, P.roof, 'hdr', -0.3);
  const O = K.panel([cx, 0.03, oz - 0.001], [1, 0, 0], [0, 1, 0], 'hdr', -0.3);
  // A row a system, left to right as a flight engineer reads it; the gap splits each row in two.
  const ohN = [
    ['BAT', 'GEN 1', 'GEN 2', 'BUS TIE', 'BUS TIE', 'GEN 3', 'GEN 4', 'EXT PWR'],
    ['PUMP 1', 'PUMP 2', 'XFEED', 'BOOST', 'BOOST', 'XFEED', 'PUMP 3', 'PUMP 4'],
    ['HYD 1', 'HYD 2', 'AUX PMP', 'BRK ACC', 'FLAP ALT', 'STEER', 'HYD 3', 'HYD 4'],
    ['PITOT L', 'WING', 'PROP 1', 'PROP 2', 'PROP 3', 'PROP 4', 'TAIL', 'PITOT R'],
    ['NAV', 'BCN', 'STROBE', 'LOGO', 'LDG L', 'LDG R', 'TAXI', 'WING LT'],
  ];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 10; c++) {
    if (c === 4 || c === 5) continue;          // the gap straight over your head, which the gate looks up through
    O.toggle(-0.34 + c * 0.075, 0.36 - r * 0.17, R.powered && (r + c) % 3 !== 0, ohN[r][c < 4 ? c : c - 2]);
  }
  // The flight engineer's station, behind the right seat against the wall.
  const fx = xR - 0.02, fy = P.back + 0.45;
  K.box(fx - 0.40, fy - 0.35, P.floor, fx, fy + 0.30, -0.35, 'dash', -0.08, [36, 38, 42]);
  const E = K.panel([fx - 0.001, fy, -0.05], [0, 1, 0], [0, 0, 1], 'pil', -0.05);
  E.rect(-0.32, -0.26, 0.32, 0.26, [30, 34, 40], 0, 0.002);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
    E.dial(-0.24 + c * 0.16, 0.16 - r * 0.15, 0.045, clamp(0.4 + ((r * 4 + c) % 5) * 0.1 * R.rpm, 0, 1), { ticks: 8, major: 2, arcs: [[0.3, 0.8, C.green]], name: ['EGT ', 'OIL ', 'FF '][r] + (c + 1) });
  }
  // The engineer's chart table and his seat.
  const T = K.panel([fx - 0.2, fy - 0.02, -0.349], [1, 0, 0], [0, 1, 0]);
  T.rect(-0.15, -0.28, 0.15, 0.25, C.paper, 0.1, 0.002);
  T.rect(-0.12, -0.10, 0.10, 0.12, [140, 170, 200], 0.1, 0.003);
  K.box(fx - 0.62, fy - 0.20, P.floor, fx - 0.44, fy + 0.10, -0.52, 'seat', 0.05, [58, 54, 48]);
  K.box(fx - 0.62, fy - 0.26, -0.52, fx - 0.44, fy - 0.20, -0.10, 'seat', -0.05, [58, 54, 48]);
  craftControls(K, null, 'leviathan', P, live);
}

// ── REAPER — the gun with a seat bolted to it ────────────────────────────────
//
// A single-seat attack jet under a bubble. You sit high on an ejection seat with the whole canopy
// round your head (the roof is glass — `roofGlass`), a centre stick with a trigger, the twin
// throttles on the left console, an armament panel on the right of the dash, a HUD's frame on the
// coaming — ⚠ ITS FRAME ONLY: a combiner is a sheet of glass across the one sight line the gate
// guarantees, and a pane in a depth buffer is a depth value in front of the entire world — and the
// titanium tub's side consoles either side of your knees.
export function reaperFit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live);
  const cx = P.xCentre, xL = cx - P.halfW, xR = cx + P.halfW;
  const { Pn, pz, py } = flatPanel(K, P, 0.15, { rgb: [52, 58, 56] });
  // Flight: the six, the ADI larger in the middle.
  sixPack(Pn, R, 0, 0.065, -0.07, 0.042, 0.105);
  // Engines: two tachos and two ITT gauges, left of the six.
  for (const [i, f] of [[0, R.rpm], [1, R.rpm * 0.99]]) {
    Pn.dial(-0.30 + i * 0.075, 0.07, 0.03, f, { ticks: 10, major: 2, arcs: [[0.6, 0.9, C.green]], red: 0.95, name: i ? 'RPM R' : 'RPM L' });
    Pn.dial(-0.30 + i * 0.075, -0.02, 0.028, clamp(0.3 + f * 0.5, 0, 1), { ticks: 6, major: 2, arcs: [[0.2, 0.8, C.green], [0.85, 1, C.red]], name: i ? 'ITT R' : 'ITT L' });
  }
  Pn.bar(-0.36, -0.13, -0.02, 0.01, R.fuel, R.fuel < 0.15 ? C.red : C.green, 'FUEL');
  // Armament: a station selector strip and the master arm, right of the six.
  const arm = !!(R.L.gunsArmed || R.L.weaponsArmed);
  for (let i = 0; i < 4; i++) annun(Pn, 'STA ' + (i + 1), 0.22 + (i % 2) * 0.05, 0.08 - (i >> 1) * 0.04, 0.02, 0.012, arm && R.powered, C.green);
  Pn.rect(0.20, -0.08, 0.33, -0.02, [40, 40, 30], 0, 0.002);
  for (let i = 0; i < 6; i++) Pn.rect(0.205 + i * 0.02, -0.075, 0.2 + i * 0.02 + 0.01, -0.025, i % 2 ? C.black : C.yellow, 0, 0.003);
  Pn.toggle(0.27, -0.11, arm, 'ARM');
  [[!!R.L.stall, C.red, 'STALL'], [R.fuel < 0.15, C.amber, 'FUEL'], [R.hull < 0.35, C.red, 'HULL']]
    .forEach(([lit, rgb, nm], i) => annun(Pn, nm, 0.35, 0.08 - i * 0.04, 0.012, 0.012, lit && R.powered, rgb));
  // The HUD frame on the coaming: two posts and a top bar, straddling the sight line.
  const hy = P.dashY + 0.02, hz0 = P.dashZ, hz1 = 0.10;
  K.box(cx - 0.12, hy - 0.06, hz0, cx + 0.12, hy + 0.06, hz0 + 0.05, 'dash', 0.1, C.black);
  for (const s of [-1, 1]) K.rod([cx + s * 0.10, hy, hz0 + 0.05], [cx + s * 0.10, hy + 0.04, hz1], 0.008, 'dash', 0.1, C.black, 0, 5);
  K.rod([cx - 0.10, hy + 0.04, hz1], [cx + 0.10, hy + 0.04, hz1], 0.006, 'dash', 0.1, C.black, 0, 5);
  if (R.powered) K.rod([cx - 0.02, hy + 0.041, 0.02], [cx - 0.004, hy + 0.041, 0.02], 0.002, 'dash', 0, C.lcd, 0.9, 4);
  // Side consoles.
  const scN = [['BAT', 'GEN', 'PUMP L', 'PUMP R', 'IGN', 'START'], ['NAV', 'BCN', 'STROBE', 'LDG', 'PITOT', 'DEICE']];
  for (const [s, [x0, x1]] of [[xL, xL + 0.14], [xR - 0.14, xR]].entries()) {
    K.box(x0, -0.50, P.floor, x1, 0.40, P.seatZ + 0.10, 'dash', -0.05, [44, 50, 48]);
    const Sc = K.panel([(x0 + x1) / 2, -0.05, P.seatZ + 0.101], [1, 0, 0], [0, 1, 0]);
    for (let i = 0; i < 6; i++) Sc.toggle(-0.03 + (i % 2) * 0.06, 0.30 - (i >> 1) * 0.12, R.powered && i % 3 !== 1, scN[s][i]);
  }
  // Twin throttles on the left console.
  for (let i = 0; i < 2; i++) {
    const tx = xL + 0.05 + i * 0.045, tip = [tx, -0.20 + R.thr * 0.20, P.seatZ + 0.22];
    K.rod([tx, tip[1], P.seatZ + 0.10], tip, 0.008, 'dash', 0, C.steel, 0.1, 5);
    K.obox(tip, [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.02, 0.03, 0.03, 'dash', 0.1, C.black);
  }
  centreStick(K, P, R, cx, 0.12, pz - 0.10, { trigger: true, button: C.red, gripRgb: C.black });
  pedals(K, P, R, cx, 0.62, P.floor + 0.30);
  // The ejection seat's handles and its striped pull loop between your knees.
  K.rod([cx - 0.05, P.seatY[1] - 0.02, P.seatZ + 0.02], [cx + 0.05, P.seatY[1] - 0.02, P.seatZ + 0.02], 0.010, 'seat', 0, C.yellow, 0.15, 6);
  richSeat(K, 0, P, [60, 66, 58]);
  canopyHoops(K, P, [P.back + 0.08], 0.018, C.black);
  craftControls(K, Pn, 'reaper', P, live);
}

// ── SHRIKE — the dive bomber's glasshouse ────────────────────────────────────
//
// A long framed canopy with a gunner behind you, facing the other way. The things that make it this
// aeroplane: the red dive lines on the side glazing (30, 45 and 60 degrees against the horizon, so
// you can hold the dive by eye), a dive-brake lever and a bomb release on the stick, a siren switch,
// the rear gunner's seat and swivelling gun, and the frames — the canopy is the whole roof.
export function shrikeFit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live);
  const cx = P.xCentre, xL = cx - P.halfW, xR = cx + P.halfW;
  const { Pn, pz } = flatPanel(K, P, 0.13, { rgb: [46, 50, 44] });
  sixPack(Pn, R, 0, 0.055, -0.06, 0.036, 0.09);
  Pn.dial(-0.23, 0.055, 0.032, R.rpm, { ticks: 10, major: 2, arcs: [[0.55, 0.85, C.green]], red: 0.93, name: 'RPM' });
  Pn.dial(-0.23, -0.06, 0.028, clamp(num(R.L.oilTemp), 0, 1), { a0: Math.PI * 0.85, sweep: Math.PI * 0.7, ticks: 4, major: 2, arcs: [[0.3, 0.8, C.green]], name: 'OIL' });
  Pn.bar(0.20, -0.11, 0.00, 0.012, R.fuel, R.fuel < 0.15 ? C.red : C.green, 'FUEL');
  // Bombs remaining, one lamp a bomb.
  const bombs = clamp(Math.round(num(R.L.bombs, 4)), 0, 4);
  for (let i = 0; i < 4; i++) annun(Pn, String(i + 1), 0.235 + (i % 2) * 0.035, 0.07 - (i >> 1) * 0.035, 0.012, 0.012, i < bombs && R.powered, C.amber);
  Pn.toggle(0.25, -0.08, !!R.L.siren, 'SIREN');
  // The dive lines, red, on the frame of each side window — from the forward sill corner, rising
  // aft, clipped at the window's top.
  for (const x of [xL + 0.004, xR - 0.004]) {
    const y0 = P.winY[1], z0 = P.winZ[0];
    for (const deg of [30, 45, 60, 75, 80]) {
      const t = Math.tan(deg * Math.PI / 180), z1 = P.winZ[1];
      K.rod([x, y0, z0], [x, y0 - (z1 - z0) / t, z1], 0.003, 'pil', 0, C.red, 0.3, 4);
    }
  }
  // The dive brake lever on the left wall, and the throttle.
  wallQuadrant(K, P, R, 2, { vals: [0, num(R.L.diveBrake) > 0.5 ? 0.95 : 0.1], rgb: [C.black, C.red] });
  centreStick(K, P, R, cx, 0.10, pz - 0.08, { trigger: true, button: C.red });
  pedals(K, P, R, cx, 0.58, P.floor + 0.28);
  richSeat(K, 0, P, [70, 62, 48]);
  // The armour plate behind your head, and the gunner beyond it: his seat faces aft, his gun on a
  // ring mount in the rear of the glasshouse.
  K.box(cx - 0.20, P.seatY[0] - 0.22, P.seatZ, cx + 0.20, P.seatY[0] - 0.19, 0.06, 'post', 0.05, [64, 66, 60]);
  const gy = P.back + 0.40;
  K.box(cx - 0.18, gy - 0.10, P.floor, cx + 0.18, gy + 0.18, -0.60, 'seat', 0.05, [62, 58, 48]);
  K.box(cx - 0.18, gy + 0.18, -0.60, cx + 0.18, gy + 0.22, -0.15, 'seat', -0.05, [62, 58, 48]);
  K.torus([cx, P.back + 0.26, -0.05], [1, 0, 0], [0, 1, 0], 0.20, 0.012, 16, 'post', 0.1, C.steel, 0);
  K.rod([cx, P.back + 0.26, -0.05], [cx + 0.06, P.back + 0.12, 0.02], 0.014, 'dash', 0.1, C.black, 0, 6);
  canopyHoops(K, P, [0.42, -0.38, -0.80, -1.18], 0.012, [58, 62, 54]);
  craftControls(K, Pn, 'shrike', P, live);
}

// ── LOCUST — the crop duster ─────────────────────────────────────────────────
//
// A slab-sided single seat perched high over the hopper. A plain panel with the hopper's own gauge
// taking the middle of it, a guarded spray switch, a pressure gauge, the big yellow T-handle that
// dumps the whole load when the engine coughs, a stick, and the throttle on the left wall.
export function locustFit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live);
  const cx = P.xCentre, xR = cx + P.halfW;
  const { Pn, pz } = flatPanel(K, P, 0.12, { rgb: [40, 44, 36] });
  Pn.dial(-0.20, 0.045, 0.034, clamp(R.ias / (R.vne * 1.1), 0, 1), { ticks: 12, major: 4, arcs: [[0.25, 0.8, C.green]], red: 0.9, name: 'IAS' });
  Pn.attitude(-0.11, 0.045, 0.034, R.pitch, R.bank);
  Pn.dial(-0.02, 0.045, 0.034, (R.alt % 1000) / 1000, { a0: Math.PI / 2, sweep: Math.PI * 2, ticks: 10, major: 1, name: 'ALT' });
  Pn.compass(-0.11, -0.06, 0.03, R.hdg);
  Pn.dial(-0.20, -0.06, 0.03, R.rpm, { ticks: 10, major: 2, arcs: [[0.55, 0.85, C.green]], red: 0.93, name: 'RPM' });
  // The hopper: the biggest dial on the panel, which tells you what this aeroplane is for.
  const hop = clamp(num(R.L.hopper, 1), 0, 1);
  Pn.dial(0.11, 0.01, 0.06, hop, { a0: Math.PI * 1.1, sweep: Math.PI * 0.8, ticks: 8, major: 2, arcs: [[0, 0.15, C.red]], needle: C.yellow, name: 'HOPPER' });
  Pn.dial(0.23, 0.05, 0.028, R.L.spraying ? 0.7 : 0.05, { ticks: 6, major: 2, arcs: [[0.5, 0.85, C.green]], name: 'PRESS' });
  // The turbine: an Air Tractor is a PT6 on a crop sprayer, so the right of the panel is its column —
  // torque, turbine temperature, gas-generator speed, oil — the needles following the power.
  const run = R.powered ? R.rpm : 0;
  [[run * R.thr * 0.9, [[0.1, 0.8, C.green]], 0.9], [run ? 0.35 + R.thr * 0.45 : 0, [[0.3, 0.8, C.green]], 0.86],
   [run ? 0.55 + R.thr * 0.38 : 0, [[0.5, 0.95, C.green]], 0.97], [run ? 0.6 : 0, [[0.4, 0.8, C.green]], 0.92]]
    .forEach(([v, arcs, red], i) => Pn.dial(0.33 + (i % 2) * 0.052, 0.06 - (i >> 1) * 0.06, 0.023, clamp(v, 0, 1), { ticks: 8, major: 2, arcs, red, name: ['TRQ', 'ITT', 'NG', 'OIL'][i] }));
  // The ag GPS on the left of the panel: the field's swaths as lines, the one you are flying lit,
  // and your aircraft on it — the moving map a spray pilot works from.
  Pn.rect(-0.395, -0.09, -0.26, 0.05, [16, 18, 20], 0, 0.002);
  Pn.rect(-0.385, -0.08, -0.27, 0.04, R.powered ? [8, 24, 16] : C.screen, R.powered ? 0.5 : 0, 0.004);
  if (R.powered) {
    const off = clamp(num(R.L.courseErr) / 20, -1, 1) * 0.012;
    for (let i = 0; i < 5; i++) {
      const u = -0.375 + i * 0.024 + off;
      if (u > -0.383 && u < -0.272) Pn.rect(u - 0.001, -0.075, u + 0.001, 0.035, i === 2 ? C.lampOn : [40, 110, 80], i === 2 ? 0.9 : 0.5, 0.005);
    }
    Pn.plate([[-0.3275, -0.01], [-0.3205, -0.03], [-0.3275, -0.024], [-0.3345, -0.03]], [255, 255, 255], 1, 0.006);
    Pn.digits(-0.38, -0.083 + 0.004, 0.009, String(Math.round(100 * clamp(num(R.L.hopper, 1), 0, 1))).padStart(3, ' '), C.lcd, false);
  }
  Pn.bar(0.23, -0.10, -0.01, 0.012, R.fuel, R.fuel < 0.15 ? C.red : C.green, 'FUEL');
  // The spray switch, under a red guard, lettered below the guard rather than under it.
  Pn.toggle(0.02, -0.07, !!R.L.spraying);
  Pn.rect(0.005, -0.095, 0.035, -0.045, C.red, 0.2, 0.015);
  Pn.text('SPRAY', 0.02, -0.103, 0.0085);
  // The dump handle, on the right below the panel.
  const dy = P.dashY - 0.05, dz = pz - 0.14;
  K.rod([xR - 0.10, dy, dz], [xR - 0.10, dy - 0.07, dz], 0.008, 'dash', 0, C.steel, 0.1, 5);
  K.rod([xR - 0.15, dy - 0.07, dz], [xR - 0.05, dy - 0.07, dz], 0.014, 'dash', 0.1, C.yellow, 0.1, 6);
  wallQuadrant(K, P, R, 2, { vals: [0, 0.9], rgb: [C.black, C.red] });
  centreStick(K, P, R, cx, 0.10, pz - 0.08, { button: C.yellow });
  pedals(K, P, R, cx, 0.58, P.floor + 0.28);
  // The swath-guidance lightbar on the glareshield, a row of lamps that walks with your line.
  const lb = clamp(num(R.L.courseErr) / 20, -1, 1);
  K.box(cx - 0.14, P.dashY + 0.04, P.dashZ, cx + 0.14, P.dashY + 0.07, P.dashZ + 0.025, 'dash', 0.1, C.black);
  for (let i = 0; i < 11; i++) {
    const on = R.powered && Math.abs((i - 5) / 5 - lb) < 0.15;
    K.box(cx - 0.13 + i * 0.024, P.dashY + 0.039, P.dashZ + 0.005, cx - 0.115 + i * 0.024, P.dashY + 0.04, P.dashZ + 0.02, 'dash', 0.2, on ? (i === 5 ? C.green : C.amber) : C.lampOff, on ? 0.9 : 0);
  }
  // Chemical on everything: a stained rag on the floor and the smell nobody can model.
  K.box(cx + 0.12, 0.28, P.floor, cx + 0.26, 0.40, P.floor + 0.012, 'floor', 0, [110, 120, 70]);
  richSeat(K, 0, P, [74, 70, 50]);
  craftControls(K, Pn, 'locust', P, live);
}

// ── GRASSHOPPER — the Cub ────────────────────────────────────────────────────
//
// Tandem, flown solo from the BACK seat. So what is in front of you is the empty front seat — a
// tube frame with a sling back, well below your eye — a second stick, and past both a panel with
// five things on it. The wing sits on top of the cabin with a skylight cut in the headlining
// (`roofGlass`) and its root tubes cross over your head; the fuel gauge is a wire on a cork
// standing out of the nose tank in front of the screen.
export function grasshopperFit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live);
  const cx = P.xCentre, xL = cx - P.halfW, xR = cx + P.halfW;
  const { Pn } = flatPanel(K, P, 0.075, { rgb: [70, 74, 52], hw: P.halfW - 0.05 });
  Pn.dial(-0.18, 0.0, 0.03, clamp(R.ias / (R.vne * 1.1), 0, 1), { ticks: 10, major: 2, arcs: [[0.25, 0.8, C.green]], name: 'IAS' });
  Pn.dial(-0.09, 0.0, 0.03, (R.alt % 1000) / 1000, { a0: Math.PI / 2, sweep: Math.PI * 2, ticks: 10, major: 1, name: 'ALT' });
  Pn.dial(0.0, 0.0, 0.03, R.rpm, { ticks: 10, major: 2, arcs: [[0.55, 0.85, C.green]], red: 0.93, name: 'RPM' });
  Pn.dial(0.09, 0.0, 0.026, clamp(num(R.L.oilTemp, 0.5), 0, 1), { a0: Math.PI * 0.85, sweep: Math.PI * 0.7, ticks: 4, major: 2, arcs: [[0.3, 0.8, C.green]], name: 'OIL' });
  Pn.compass(0.18, 0.0, 0.026, R.hdg);
  // What a Cub pilot touches on the panel: the primer, the carb-heat knob and the magneto key, along
  // the bottom edge right of the switches. The key sits at BOTH while the engine runs.
  Pn.knob(0.0, -0.052, 0.008, 0.016, C.chrome, 0.1);
  Pn.knob(0.06, -0.052, 0.009, 0.014, [200, 40, 36], 0.05);
  Pn.annulus(0.15, -0.052, 0.013, 0.019, C.chrome, 0.1, 0.002, 12);
  const kA = R.powered ? 0.9 : 0;
  Pn.spoke(0.15, -0.052, Math.PI / 2 - kA, 0, 0.012, 0.003, C.steel, 0.1, 0.018);
  Pn.text('PRIME', 0.0, -0.066, 0.007);
  Pn.text('CARB', 0.06, -0.066, 0.007);
  Pn.text('MAG', 0.115, -0.052, 0.007);
  // The cork float: a wire rising out of the tank ahead of the screen, off to one side of the line.
  const fz = P.dashZ + 0.02 + R.fuel * 0.14;
  K.rod([cx + 0.14, P.front - 0.05, P.dashZ], [cx + 0.14, P.front - 0.05, fz], 0.002, 'dash', 0, C.steel, 0.1, 4);
  K.rod([cx + 0.14, P.front - 0.05, fz], [cx + 0.14, P.front - 0.05, fz + 0.012], 0.010, 'dash', 0.2, C.tan, 0, 6);
  // The front seat: a tube frame and a canvas sling, low enough to see over.
  const fy = 0.55, fzs = P.seatZ + 0.02;
  K.rod([cx - 0.18, fy, P.floor + 0.012], [cx - 0.18, fy - 0.04, fzs], 0.01, 'dash', 0.1, C.steel, 0, 5);
  K.rod([cx + 0.18, fy, P.floor + 0.012], [cx + 0.18, fy - 0.04, fzs], 0.01, 'dash', 0.1, C.steel, 0, 5);
  K.box(cx - 0.18, fy - 0.24, fzs - 0.02, cx + 0.18, fy - 0.04, fzs, 'seat', 0.05, [120, 110, 70]);
  K.box(cx - 0.18, fy - 0.06, fzs, cx + 0.18, fy - 0.03, -0.30, 'seat', -0.05, [120, 110, 70]);
  // Both sticks, linked; yours is the one you are holding.
  centreStick(K, P, R, cx, 0.12, -0.46, { gripRgb: C.wood });
  centreStick(K, P, R, cx, 0.80, -0.50, { gripRgb: C.wood });
  // The throttle: a knob on a rod through the left wall, and a second set of pedals up front.
  wallQuadrant(K, P, R, 1, { y0: -0.05, y1: 0.20 });
  pedals(K, P, R, cx, 0.36, P.floor + 0.30);
  // The wing root: two tubes across the headlining either side of the skylight.
  for (const y of [P.roofGlass[0] - 0.05, P.roofGlass[1] + 0.05]) K.rod([xL + 0.02, y, P.roof - 0.03], [xR - 0.02, y, P.roof - 0.03], 0.018, 'hdr', 0.05, C.steel, 0, 6);
  // The door: the split half-door on the right, its top half hinged up — the sill is a latch rail.
  K.rod([xR - 0.012, P.winY[0] + 0.05, P.winZ[0] + 0.01], [xR - 0.012, P.winY[1] - 0.05, P.winZ[0] + 0.01], 0.010, 'pil', 0.1, C.chrome, 0.1, 5);
  richSeat(K, 0, P, [120, 110, 70]);
  craftControls(K, Pn, 'grasshopper', P, live);
}

// ── VIPER — the attack helicopter ────────────────────────────────────────────
//
// Not a bubble. A narrow armoured tandem cockpit with flat-plate glazing, flown from the back seat
// over the gunner's station below you. Two screens instead of a pod of gauges, a small standby
// cluster between them, the missile panel, a cyclic with the weapons triggers on it, the collective
// down your left side, and the frames of the flat plates round your head.
export function viperFit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live);
  const cx = P.xCentre, xL = cx - P.halfW, xR = cx + P.halfW;
  const { Pn, pz } = flatPanel(K, P, 0.13, { rgb: [30, 34, 36] });
  // Two multifunction displays: a moving map on the left, the flight page on the right.
  for (const [sx, page] of [[-0.19, 'map'], [0.19, 'pfd']]) {
    Pn.rect(sx - 0.10, -0.10, sx + 0.10, 0.10, [16, 18, 20], 0, 0.002);
    Pn.rect(sx - 0.085, -0.085, sx + 0.085, 0.085, R.powered ? [8, 26, 18] : C.screen, R.powered ? 0.5 : 0, 0.004);
    for (let i = 0; i < 5; i++) {
      Pn.knob(sx - 0.09 + i * 0.045, -0.095, 0.006, 0.008, C.black, 0);
      Pn.knob(sx - 0.09 + i * 0.045, 0.095, 0.006, 0.008, C.black, 0);
    }
    if (!R.powered) continue;
    if (page === 'pfd') {
      Pn.attitude(sx, 0.01, 0.055, R.pitch, R.bank);
      Pn.digits(sx - 0.08, -0.075, 0.018, String(Math.round(R.ias)).padStart(3, ' '), C.lcd, false);
      Pn.digits(sx + 0.03, -0.075, 0.018, String(Math.round(R.alt / 10) % 1000).padStart(3, ' '), C.lcd, false);
    } else {
      Pn.annulus(sx, 0, 0.05, 0.055, [60, 170, 120], 0.6, 0.006, 20);
      Pn.plate([[sx, 0.025], [sx + 0.012, -0.01], [sx, -0.002], [sx - 0.012, -0.01]], C.lampOn, 0.9, 0.007);
      for (let i = 0; i < 6; i++) Pn.rect(sx - 0.07 + i * 0.025, -0.06 + (i % 3) * 0.04, sx - 0.065 + i * 0.025, 0.07 - (i % 2) * 0.05, [40, 110, 80], 0.5, 0.005);
    }
  }
  // The standby cluster between the screens.
  Pn.dial(0, 0.06, 0.028, clamp(R.rpm, 0, 1), { ticks: 10, major: 2, frac2: clamp(R.rpm * 0.98, 0, 1), needle2: C.lampOn, needle: C.amber, arcs: [[0.85, 0.95, C.green]], red: 0.97, name: 'RPM' });
  Pn.compass(0, -0.01, 0.024, R.hdg);
  Pn.bar(-0.03, -0.11, -0.05, 0.008, R.fuel, R.fuel < 0.15 ? C.red : C.green, 'FUEL');
  // The missile panel: rail lamps, eight a side.
  const arm = !!(R.L.gunsArmed || R.L.weaponsArmed);
  for (let i = 0; i < 8; i++) Pn.lamp(0.012 + (i % 4) * 0.012, -0.075 - (i >> 2) * 0.016, 0.004, 0.005, arm && R.powered, C.red);
  Pn.text('MSL', 0.03, -0.062, 0.006);
  // The frames of the flat plates: a bow either side of the sight line, and the one aft.
  const zt = P.roof - 0.02;
  for (const s of [-1, 1]) {
    const x = cx + s * (P.halfW - 0.03);
    K.rod([x, P.front - 0.04, P.dashZ], [cx + s * 0.20, P.front - 0.20, zt], 0.016, 'pil', 0.2, C.black, 0, 6);
  }
  K.rod([cx - 0.20, P.front - 0.20, zt], [cx + 0.20, P.front - 0.20, zt], 0.016, 'pil', 0.2, C.black, 0, 6);
  // Blast panels on the side consoles.
  const scN = [['BAT', 'GEN', 'APU', 'IGN', 'FUEL', 'FIRE'], ['NAV', 'BCN', 'IR', 'LDG', 'SRH', 'IFF']];
  for (const [s, [x0, x1]] of [[xL, xL + 0.12], [xR - 0.12, xR]].entries()) {
    K.box(x0, -0.40, P.floor, x1, 0.40, P.seatZ + 0.12, 'dash', -0.05, [36, 40, 40]);
    const Sc = K.panel([(x0 + x1) / 2, 0, P.seatZ + 0.121], [1, 0, 0], [0, 1, 0]);
    for (let i = 0; i < 6; i++) Sc.toggle(-0.02 + (i % 2) * 0.04, 0.30 - (i >> 1) * 0.14, R.powered && i !== 3, scN[s][i]);
  }
  // Cyclic with the weapons triggers, collective down the left, pedals.
  centreStick(K, P, R, cx, 0.10, pz - 0.08, { trigger: true, button: C.red, gripRgb: C.black });
  const kx = xL + 0.16;
  const cp = [kx, P.seatY[0] - 0.02, P.seatZ - 0.02], ce = [kx, P.seatY[1] + 0.10, P.seatZ + 0.10 + R.thr * 0.14];
  K.rod(cp, ce, 0.015, 'dash', 0, C.steel, 0.1, 6);
  K.rod(ce, add3(ce, [0, 0.10, 0.03]), 0.024, 'dash', 0.05, C.grip, 0, 8);
  pedals(K, P, R, cx, 0.60, P.floor + 0.28);
  richSeat(K, 0, P, [44, 50, 46]);
  craftControls(K, Pn, 'viper', P, live);
}

// ── CARCASS — the wreck you bought ───────────────────────────────────────────
//
// The tub it came in, minus most of what was in it: a panel with holes where the instruments were
// and wires hanging out of them, one airspeed and one fuel gauge taped in place, the passenger seat
// gone (four bolt stubs where it stood), a stick that is a length of pipe, and a throttle that is a
// cable and a clothes peg.
export function carcassFit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live);
  const cx = P.xCentre, pc = -cx;
  const { Pn, pz } = flatPanel(K, P, 0.14, { rgb: [52, 46, 40] });
  // Holes where the six used to be, each with a wire out of it.
  for (let i = 0; i < 6; i++) {
    const a = pc + (i % 3 - 1) * 0.11, b = i < 3 ? 0.06 : -0.06;
    if (i === 0) {
      Pn.dial(a, b, 0.04, clamp(R.ias / (R.vne * 1.1), 0, 1), { ticks: 8, major: 2, arcs: [[0.3, 0.8, C.green]], name: 'IAS' });
      Pn.rect(a - 0.05, b + 0.035, a + 0.05, b + 0.05, [150, 150, 140], 0.05, 0.004);   // the tape
      continue;
    }
    Pn.disc(a, b, 0.04, C.black, 0, 0.001, 12);
    const w0 = Pn.pt(a, b - 0.02, 0.002);
    K.rod(w0, [w0[0] + 0.01 * (i - 3), w0[1] - 0.05, w0[2] - 0.10 - i * 0.01], 0.003, 'dash', 0, i % 2 ? C.red : C.yellow, 0.05, 4);
  }
  Pn.bar(pc + 0.22, -0.10, 0.02, 0.012, R.fuel, R.fuel < 0.15 ? C.red : C.green, 'FUEL');
  Pn.rect(pc + 0.20, 0.03, pc + 0.24, 0.05, [150, 150, 140], 0.05, 0.004);
  // A crack across the coaming.
  K.rod([cx - 0.3, P.dashY + 0.05, P.dashZ + 0.002], [cx + 0.1, P.dashY + 0.15, P.dashZ + 0.002], 0.004, 'dash', 0, C.black, 0, 4);
  // The pipe stick.
  centreStick(K, P, R, 0, 0.14, pz - 0.10, { shaftRgb: C.steel, gripRgb: C.rubber, gripR: 0.016 });
  // The throttle: a cable along the wall ending in a peg.
  const xL = cx - P.halfW;
  K.rod([xL + 0.02, P.dashY - 0.02, P.winZ[0] - 0.10], [xL + 0.06, 0.05 + R.thr * 0.15, P.winZ[0] - 0.14], 0.004, 'dash', 0, C.black, 0, 4);
  K.obox([xL + 0.06, 0.05 + R.thr * 0.15, P.winZ[0] - 0.14], [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.01, 0.025, 0.006, 'dash', 0.2, C.wood);
  pedals(K, P, R, 0, 0.62, P.floor + 0.30, C.rubber);
  // Where the passenger seat was.
  for (const [dx, dy] of [[-0.18, -0.40], [0.18, -0.40], [-0.18, 0.05], [0.18, 0.05]]) {
    K.rod([2 * cx + dx, dy, P.floor], [2 * cx + dx, dy, P.floor + 0.03], 0.012, 'floor', 0.1, C.steel, 0, 6);
  }
  richSeat(K, 0, P, [70, 50, 40], false);
  craftControls(K, Pn, 'carcass', P, live);
}

// ── MAYFLY — the open ultralight ─────────────────────────────────────────────
//
// There is no cabin; this is what is round you instead. The keel tube running forward to the nose
// wheel, the A-frame down from the wing, a two-gauge pod on a stalk, a stick, a throttle lever on the
// left down-tube, and a rudder bar under your feet. The room itself (a seat pan, the pod's low sides,
// the firewall of the pusher engine behind you and the wing overhead) is built in interior-shell.js.
export function mayflyFit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live);
  const cx = P.xCentre, xL = cx - P.halfW, xR = cx + P.halfW;
  // The keel, low and forward, and the A-frame from the wing down to the seat rails.
  K.rod([cx, P.back + 0.05, P.floor + 0.04], [cx, P.front - 0.03, P.floor + 0.10], 0.022, 'post', 0.1, C.chrome, 0.1, 8);
  for (const s of [-1, 1]) {
    K.rod([cx + s * (P.halfW - 0.03), -0.10, P.roof - 0.03], [cx + s * (P.halfW - 0.03), 0.35, P.floor + 0.05], 0.018, 'post', 0.1, C.chrome, 0.1, 6);
  }
  // The gauge pod on its stalk, low and ahead.
  const py = P.dashY, pz = P.dashZ;
  K.rod([cx, py + 0.10, P.floor + 0.10], [cx, py, pz], 0.012, 'dash', 0.1, C.steel, 0, 6);
  const Pn = K.panel([cx, py, pz], [1, 0, 0], [0, 0.3, 0.95]);
  Pn.rect(-0.09, -0.045, 0.09, 0.045, [30, 32, 36], 0, 0);
  Pn.dial(-0.045, 0, 0.035, clamp(R.ias / (R.vne * 1.1), 0, 1), { ticks: 8, major: 2, arcs: [[0.2, 0.7, C.green]], red: 0.85, name: 'IAS' });
  Pn.dial(0.045, 0, 0.035, R.rpm, { ticks: 8, major: 2, arcs: [[0.5, 0.85, C.green]], red: 0.93, name: 'RPM' });
  // Stick, throttle on the left down-tube, rudder bar.
  centreStick(K, P, R, cx, 0.10, -0.46, { gripRgb: C.rubber });
  const tx = xL + 0.06, ty = 0.10;
  K.rod([tx, ty, P.seatZ + 0.05], [tx, ty + 0.03 + R.thr * 0.10, P.seatZ + 0.20], 0.006, 'dash', 0, C.steel, 0.1, 5);
  K.obox([tx, ty + 0.03 + R.thr * 0.10, P.seatZ + 0.21], [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.012, 0.012, 0.012, 'dash', 0.2, C.red, 0.1);
  const rb = 0.60 - R.rud * 0;
  K.rod([cx - 0.20 - R.rud * 0.03, rb - R.rud * 0.05, P.floor + 0.14], [cx + 0.20 - R.rud * 0.03, rb + R.rud * 0.05, P.floor + 0.14], 0.012, 'dash', 0.1, C.steel, 0, 6);
  // The lap belt, and a water bottle cable-tied to the right tube.
  K.rod([xR - 0.06, 0.15, P.seatZ + 0.05], [xR - 0.06, 0.15, P.seatZ + 0.25], 0.03, 'dash', 0.2, [70, 150, 200], 0.05, 8);
  richSeat(K, 0, P, [50, 56, 70]);
}
