// THE SWITCH ROW AND THE READINGS THE OLD SHARED FIT-OUTS LEFT BEHIND.
//
// This file used to hold a fit-out for every aircraft that had borrowed somebody else's cockpit. Each
// of those aircraft has its own file now (interior-<id>.js, wired in interior-shell.js), and what is
// left is what two seats still read: the switch row and hotspots heliFit draws on the reference
// bubble (interior-fit.js), and `readings`, which the Shrike resolves its gauges with.
//
// ⚠ `live` IS OPTIONAL EVERYWHERE: every reader has a resting value, so a gate can build any of these
// with no sim behind it.
import { makeKit, clamp } from './interior-kit.js';
import { eased, pressPulse, hotspotHalo } from './interior-cockpit-kit.js';

// ── THE CONTROLS YOU CAN TOUCH ────────────────────────────────────────────────
//
// One spec per seat says where its switches are, and both the drawing and the hotspot list read it,
// so a switch can never be drawn in one place and clicked in another. The ids are the kit's 'ck:*'
// set (cockpit.js DK_ACT), and only circuits the sim has: a switch with nothing behind it is removed.
//
//   panel   (P) => the kit panel the row is on: [o, r, u]
//   strip   [u0, v, ids]  a switch row on that panel, in its own coords
//   stick   (P, R) => the grip, in shell metres
//   thr     (P, R) => the throttle knob (or collective), in shell metres
const SW_PITCH = 0.024;
// What each switch's placard says.
const PLACARD = { master: 'MSTR', land: 'LDG', dome: 'DOME' };
const CTRL = {
  // The reference bubble (heliFit in interior-fit.js): the switches are a row along the bottom of the
  // pod, right of the vertical-speed dial, and the cyclic and the collective are what you grab.
  heli: { panel: (P) => [[0, P.dashY, P.dashZ], [1, 0, 0], [0, 0.35, 0.94]], strip: [0.06, -0.103, ['master', 'land', 'dome']],
    stick: (P, R) => [R.ail * 0.06 + 0.01, 0.17 + R.elev * 0.07, -0.37],
    thr: (P, R) => [-P.seatHalf - 0.06, P.seatY[1] + 0.18, P.seatZ + 0.08 + R.thr * 0.16] },
};
const panelOf = (c, P) => makeKit(() => {}).panel(...c.panel(P));

function switchState(R) {
  const on = R.powered;
  return { master: on, land: !!R.L.landingLight, dome: !!(R.L.dome && on) };
}

// Every hotspot for one of this file's seats.
export function craftHotspots(craft, P, live) {
  const c = CTRL[craft];
  if (!c) return [];
  const R = readings(live), out = [];
  const Pn = panelOf(c, P), [u0, v, ids] = c.strip;
  ids.forEach((id, i) => out.push({ id: 'ck:' + id, p: Pn.pt(u0 + i * SW_PITCH, v, 0.01), r: 0.013, kind: 'click' }));
  out.push({ id: 'yoke', p: c.stick(P, R), r: 0.07, kind: 'yoke' });
  out.push({ id: 'throttle', p: c.thr(P, R), r: 0.035, kind: 'throttle' });
  return out;
}

// Draw the spec's switch row onto the seat's panel, and the halo round whatever the pointer is over.
// Each switch eases between its positions and gives a little when it is thrown.
export function craftControls(K, Pn, craft, P, live) {
  const c = CTRL[craft], R = readings(live);
  const [u0, v, ids] = c.strip, st = switchState(R);
  ids.forEach((id, i) => {
    const u = u0 + i * SW_PITCH, on = !!st[id];
    const f = eased(craft + ':' + id, on ? 1 : 0, 18) - pressPulse(craft + ':' + id, on) * 0.3;
    Pn.rect(u - 0.009, v + 0.015, u + 0.009, v + 0.020, [214, 212, 204], 0.1, 0.002);   // the placard
    Pn.fitText(PLACARD[id] || id.toUpperCase(), u, v + 0.0175, 0.016, 0.004, [24, 24, 26], 0, 0.0035);
    Pn.rect(u - 0.0085, v - 0.014, u + 0.0085, v + 0.014, [14, 14, 16], 0, 0.003);
    Pn.stud(u, v + (f * 2 - 1) * 0.0045, 0.0068, 0.0078, 0.006 + f * 0.004, id === 'master' ? [210, 44, 38] : [232, 230, 222], 0, 0.003);
  });
  hotspotHalo(K, craftHotspots(craft, P, live), live);
}

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

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
