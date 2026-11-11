// THE VACHON DRAYMAN 2076'S CAB, after the Strand in the Hover Rig Expo concept (docs/proposals/hover-rigs.md).
//
// A refit on the stock truck room, as the Courier 2076's is (`P.refit`): the wheel, gate, pedals,
// doors, overhead and seats stay (truckFit in interior-fit.js), so every control and every trinket
// keeps its place. What this file brings is cooler and plainer than the Courier's leather:
//   - a flat satin slab door to door, a lit line along its lip and its top;
//   - one band of glass, near upright, with five live pages and thirteen glass keys along its foot;
//   - a status strip with NO COVER, lit whenever the power is on (the Strand is sold as a truck that
//     drives itself, and no insurer in the Basin will cover it doing so), and HIRED, lit on a rental;
//   - a projected HUD low in the screen, with the Jake and the clutch mirrored in its corners and the
//     hire's time left in the top corner when it's a rental;
//   - a hologram of the rig on the slab that bends at the pin with the real trailer angle;
//   - a small stick right of the wheel. It's decoration: the Strand's own stick, kept for the look, with
//     no hotspot, wired to nothing, and it never moves;
//   - pages that boot in turn on the key, keys that light for the hand, alerts that turn the lines.
//
// The hotspots' ids are CAB_CTL keys (cab-view.js), so a key does what the same switch does in any
// other cab. `live.ctl` says which switches exist; a disabled one has no hotspot.
//
// Every readout is a sim value. The walls take the colourway (cab-trim.js EDITION_TRIM is the
// factory's navy; the bench can change it), the lines take its glow until an alert turns them.
// Frame as interior-kit.js: shell metres, eye at the origin, +x right, +y forward, +z up.
import { makeKit, clamp, lerp, SHINY, TEXTURE } from './interior-kit.js';
import { hotspotHalo, eased, pressPulse, HALO, bootAge, reveal, alertLight, sweep, lightLine, bandFrame, glassBand,
  holoFrame, holoProjector, lensLamp, wallSec, HOLO_LINE, HOLO_AMBER, HOLO_RED, HUD_LINE, HUD_AMBER, HUD_RED } from './interior-cockpit-kit.js';
import { loft } from './interior-fit.js';
import { MPH_KMH } from './world-scale.js';

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export const DR76_TRIM = {
  slab: [30, 38, 52], carbon: [20, 23, 28], tub: [16, 19, 24], steel: [150, 158, 168], steelDk: [70, 76, 86],
  screen: [5, 10, 14], keyOff: [32, 40, 50], segOff: [16, 28, 34], white: [228, 240, 244],
  green: [120, 230, 150], red: [235, 60, 48], amber: [255, 176, 64],
};
const T = DR76_TRIM;
for (const k of ['slab', 'carbon', 'tub']) TEXTURE.set(T[k], 'plastic');
for (const k of ['steel', 'steelDk']) TEXTURE.set(T[k], 'brushed');
SHINY.set(T.slab, { spec: 0.38, pow: 26 });
SHINY.set(T.carbon, { spec: 0.45, pow: 30 });
SHINY.set(T.steel, { spec: 0.8, pow: 40 });
SHINY.set(T.screen, { spec: 0.6, pow: 60 });
// The slab's skin: the colourway's dash key as satin moulding, not hide.
const SATIN = { lv: 1.0, spec: 0.34, pow: 24, grain: 0.004, tex: 'plastic' };
// The room's surfaces: moulded panels, a tight cloth, a rubber floor. The grain is nearly off, as on
// the Courier, because the stock stipple reads as concrete on anything but dark plastic.
const ROOM_MATS = {
  hard: { lv: 1.0, spec: 0.30, pow: 22, grain: 0.006, tex: 'plastic' }, soft: { lv: 1.08, spec: 0.18, pow: 10, grain: 0.010, tex: 'fabric' },
  card: { lv: 1.12, spec: 0.22, pow: 14, grain: 0.008, tex: 'plastic' }, lower: { lv: 0.62, spec: 0.20, pow: 14, grain: 0.02, tex: 'carpet' },
  fabric: { lv: 1.3, spec: 0, pow: 1, grain: 0.010, tex: 'fabric' }, floor: { lv: 0.48, spec: 0.08, pow: 6, grain: 0.02, tex: 'rubber' },
};

export function drayman2076Profile(base) {
  return { ...base, label: 'Drayman 2076 cab',
    refit: { tier: 2, dashToy: SLAB_TOY, mats: ROOM_MATS, fit: dr76Fit },
    hotspots(live) { return dr76Hotspots(this, live); } };
}

// The one place live is read.
function readings(live) {
  const L = live || {}, phi = L.trailerPhi;
  const hire = L.hireLeft == null || !Number.isFinite(+L.hireLeft) ? null : Math.max(0, +L.hireLeft);
  return {
    L, kmh: Math.max(0, Math.abs(num(L.mph))) * MPH_KMH, rpm: clamp(num(L.rpm), 0, 1.05), fuel: clamp(num(L.fuel, 1), 0, 1),
    gear: String(L.gear ?? 'N').replace('½', '').replace('—', '-').slice(0, 2),
    phi: phi == null ? null : num(phi), brake: clamp(num(L.brakeTemp), 0, 1), fading: !!L.fading,
    powered: L.powered !== false, lamps: L.lamps || {}, hdg: num(L.hdg), hour: L.hour == null ? null : num(L.hour),
    legFrac: clamp(num(L.legFrac), 0, 1), legLeft: L.legLeft == null ? null : Math.max(0, num(L.legLeft)), aim: L.aim || null,
    elecOut: !!L.elecOut, clutch: clamp(num(L.pedals?.clutch), 0, 1), jake: !!L.lamps?.jake, hire,
    glow: Array.isArray(L.glow) && L.glow.length === 3 && L.glow.every(Number.isFinite) ? L.glow : [52, 214, 202],
  };
}
// A hire's time left as the HUD letters it: HIRE 1H 05M, HIRE 12M, HIRE DUE.
export function hireText(ms) {
  if (ms == null) return '';
  const m = Math.ceil(ms / 60000);
  if (m <= 0) return 'HIRE DUE';
  return m >= 60 ? 'HIRE ' + Math.floor(m / 60) + 'H ' + String(m % 60).padStart(2, '0') + 'M' : 'HIRE ' + m + 'M';
}

// ── THE SLAB ── The band's lower edge runs door to door, nearly straight: a flatter curve than the
// Courier's wing, and the glass stands nearer upright.
const DASH = { xL: -0.57, xR: 1.67, yMid: 0.648, sag: 0.018, z0: -0.412, h: 0.17, lean: 0.30 };
const dashCurve = (P) => (s) => {
  const x = lerp(DASH.xL, DASH.xR, s), q = (x - P.xCentre) / P.halfW;
  const dy = -2 * DASH.sag * q / P.halfW;
  return { p: [x, DASH.yMid - DASH.sag * q * q, DASH.z0], f: norm([-dy, 1, 0]) };
};
const sOf = (x) => (x - DASH.xL) / (DASH.xR - DASH.xL);
const bandPanel = (K, P, x, v, lift = 0.005) => bandFrame(dashCurve(P), DASH.lean).at(K, sOf(x), v, lift);
// The glass's top edge, across the slab and up from its foot.
const GT = [DASH.h * DASH.lean / Math.hypot(1, DASH.lean), DASH.h / Math.hypot(1, DASH.lean)];
const SLAB_Z = DASH.z0 + GT[1] + 0.004;
const SLAB_TOY = [0.94, DASH.yMid + GT[0] + 0.06, SLAB_Z];

// ── THE KEYS ── Along the band's foot, either side of the wheel, in the order the stock banks use.
const KEY_ROW = { left: ['key', 'heads', 'dome', 'jake', 'cruise', 'horn'], right: ['park', 'trailer', 'pump', 'exit', 'latch', 'galley', 'auto'] };
const KEY_NAME = { key: 'KEY', heads: 'LAMPS', dome: 'CAB', jake: 'JAKE', cruise: 'CRUISE', horn: 'HORN',
  park: 'PARK', trailer: 'AIR', pump: 'PUMP', exit: 'EXIT', latch: 'DOORS', galley: 'GALLEY', auto: 'AUTO' };
const KEY_STEP = 0.068, KEY_V = 0.026, KEY_HW = 0.030, KEY_HH = 0.0160;
const keyX = (bank, i) => (bank === 'left' ? -0.53 + i * KEY_STEP : 0.19 + i * KEY_STEP);
function keyCells(L) {
  const c = L && L.ctl;
  if (!c) return [];
  const all = [...(c.left || []), ...(c.right || [])], out = [];
  for (const bank of ['left', 'right']) KEY_ROW[bank].forEach((key, i) => {
    const cell = all.find((x) => x.key === key);
    if (cell) out.push({ ...cell, x: keyX(bank, i) });
  });
  return out;
}
export function dr76Hotspots(P, live) {
  const K = makeKit(() => {});
  return keyCells(live || {}).filter((c) => c.enabled)
    .map((c) => ({ id: c.key, p: bandPanel(K, P, c.x, KEY_V, 0.004).pt(0, 0, 0.01), r: 0.028, kind: 'click' }));
}

// ── THE PAGES ── Panel metres, centred; a page runs ±sc.w across and ±SCREEN_H up.
const SCREENS = [
  { id: 'route', x: -0.345, w: 0.125, boot: 0.3 },
  { id: 'drive', x: -0.03, w: 0.175, boot: 0 },
  { id: 'rig', x: 0.285, w: 0.122, boot: 0.15 },
  { id: 'sys', x: 0.56, w: 0.135, boot: 0.45 },
];
const SCREEN_H = 0.056, PAGE_V = 0.104;
const LABEL = 0.0115;
const pad = (n, w) => String(Math.round(n)).padStart(w, ' ').slice(-w);
const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function bar(Pn, x0, x1, y, h, frac, rgb, emis = 0.9) {
  Pn.rect(x0, y, x1, y + h, T.segOff, 0, 0.0015);
  if (frac > 0.002) Pn.rect(x0, y, lerp(x0, x1, frac), y + h, rgb, emis, 0.0025);
}
// Speed big in the middle, the revs as an arc of ticks over it, the gear to the right.
function drivePage(Pn, R, G) {
  const N = 24;
  for (let i = 0; i < N; i++) {
    const at = (i + 1) / N, on = R.rpm >= at - 0.5 / N;
    const a = Math.PI * (0.92 - 0.84 * (i / (N - 1))), r0 = 0.050, r1 = 0.060;
    const cx = -0.045, cy = -0.012, rgb = at > 0.93 ? T.red : at > 0.8 ? T.amber : G;
    const c = Math.cos(a), s = Math.sin(a), d = 0.0042;
    Pn.plate([[cx + c * r0 - s * d, cy + s * r0 + c * d], [cx + c * r1 - s * d, cy + s * r1 + c * d],
      [cx + c * r1 + s * d, cy + s * r1 - c * d], [cx + c * r0 + s * d, cy + s * r0 - c * d]], on ? rgb : T.segOff, on ? 0.95 : 0, 0.0025);
  }
  Pn.digits(-0.093, -0.040, 0.050, pad(R.kmh, 3), T.white, false);
  Pn.text('KM/H', -0.045, -0.050, LABEL, G, 0.6, 0.003);
  Pn.digits(0.070, -0.040, 0.060, R.gear.padStart(2, ' '), G, false);
  Pn.text('GEAR', 0.115, 0.034, LABEL, G, 0.6, 0.003);
}
function routePage(Pn, R, G) {
  if (R.elecOut) { Pn.text('NO SIGNAL', 0, 0, 0.014, T.amber, 0.8, 0.003); return; }
  const h = ((R.hdg % 360) + 360) % 360;
  // A compass tape across the top: the card ticks slide with the heading.
  Pn.rect(-0.112, 0.020, 0.112, 0.022, G, 0.5, 0.002);
  for (let k = -2; k <= 2; k++) {
    const card = Math.round(h / 45) + k, off = (card * 45 - h) / 45 * 0.050;
    if (Math.abs(off) > 0.108) continue;
    Pn.rect(off - 0.001, 0.022, off + 0.001, 0.030, G, 0.8, 0.0022);
    Pn.text(CARD[((card % 8) + 8) % 8], off, 0.040, 0.012, card === Math.round(h / 45) ? T.white : G, 0.8, 0.003);
  }
  Pn.digits(-0.108, -0.016, 0.030, String(Math.round(h) % 360).padStart(3, '0'), T.white, false);
  Pn.text('HDG', -0.012, -0.010, LABEL, G, 0.6, 0.003);
  if (R.legLeft != null) {
    Pn.digits(0.022, -0.016, 0.030, pad(R.legLeft, 3).slice(-3), T.white, false);
    Pn.text('KM', 0.103, -0.010, LABEL, G, 0.6, 0.003);
  }
  bar(Pn, -0.112, 0.112, -0.030, 0.005, R.legFrac, G);
  const aim = String(R.aim || 'NO ROUTE').toUpperCase().replace(/[^A-Z0-9 /-]/g, ' ').slice(0, 18);
  Pn.fitText(aim, 0, -0.045, 0.22, 0.012, [196, 220, 222], 0.6, 0.003);
}
// The rig from above, nose right, the box swung about the pin by the real angle.
function rigPage(Pn, R, G) {
  const px = 0.034, py = 0.020, col = R.fading ? T.red : G;
  const cab = (x0, x1, hw) => [[px + x0, py - hw], [px + x1, py - hw], [px + x1, py + hw], [px + x0, py + hw]];
  Pn.plate(cab(-0.008, 0.044, 0.014), [34, 60, 70], 0.3, 0.002);
  Pn.plate(cab(0.044, 0.074, 0.016), col, 0.9, 0.0025);
  if (R.phi != null) {
    const a = R.phi * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const rot = ([x, y]) => [px + x * c - y * s, clamp(py + x * s + y * c, -0.014, SCREEN_H - 0.006)];
    Pn.plate([[-0.140, -0.016], [0.004, -0.013], [0.004, 0.013], [-0.140, 0.016]].map(rot), T.white, 0.75, 0.003);
    Pn.text('HITCH ' + Math.round(Math.abs(R.phi)) + ' DEG', 0, -0.025, LABEL, G, 0.7, 0.003);
  } else Pn.text('BOBTAIL', 0, -0.025, LABEL, G, 0.7, 0.003);
  Pn.text('BRAKE', -0.086, -0.044, LABEL, R.fading ? T.red : G, 0.7, 0.003);
  bar(Pn, -0.048, 0.110, -0.048, 0.008, R.brake, R.fading ? T.red : R.brake > 0.42 ? T.amber : G);
}
function sysPage(Pn, R, G) {
  Pn.text('FUEL', -0.106, 0.038, LABEL, R.fuel < 0.15 ? T.amber : G, 0.7, 0.003);
  bar(Pn, -0.072, 0.122, 0.033, 0.010, R.fuel, R.fuel < 0.15 ? T.amber : G);
  const L = R.lamps;
  [['FUEL', L.fuel, T.amber], ['BRAKE', L.brake, T.red], ['JAKE', L.jake, G],
    ['WIPER', L.wipe, G], ['TRAIL', L.trail, T.amber], ['DAMAGE', L.dmg, T.red]].forEach(([name, on, rgb], i) =>
    lensLamp(Pn, -0.086 + (i % 3) * 0.086, 0.008 - (i / 3 | 0) * 0.033, 0.080, 0.027, !!on, rgb, name));
}

// ── THE HUD ── Lines and lettering in the screen, low, nothing on the three sight lines.
function hud(K, R, G, warn, caution) {
  const H = K.panel([0, 0.78, -0.145], [1, 0, 0], [0, 0, 1], 'dash', 0);
  const col = warn ? HUD_RED : caution ? HUD_AMBER : HUD_LINE, e = 0.9;
  H.text(pad(R.kmh, 3).trim(), -0.135, 0.0, 0.0145, col, e, 0.001);
  H.text('KM/H', -0.135, -0.019, 0.0095, col, 0.6, 0.001);
  H.text(R.gear, 0.135, 0.0, 0.0145, col, e, 0.001);
  H.text('GEAR', 0.135, -0.019, 0.0095, col, 0.6, 0.001);
  // The low controls, mirrored: the Jake's lamp and the clutch's travel.
  H.text('JAKE', -0.215, 0.0, 0.0095, R.jake ? [255, 214, 120] : col, R.jake ? 1 : 0.28, 0.001);
  H.text('CLU', 0.215, 0.006, 0.0095, col, 0.5, 0.001);
  H.rect(0.195, -0.014, 0.235, -0.0115, col, 0.25, 0.001);
  if (R.clutch > 0.01) H.rect(0.195, -0.014, lerp(0.195, 0.235, R.clutch), -0.0115, col, e, 0.0015);
  // The hire's time left, in the top corner, only when it's a rental.
  if (R.hire != null) {
    const t = hireText(R.hire);
    H.text(t, 0.185, 0.034, 0.0095, R.hire < 15 * 60000 ? HUD_AMBER : col, 0.85, 0.001);
  }
  // The lane ahead, as two ticks either side of the sight line, and the next stop.
  for (const s of [-1, 1]) H.plate([[s * 0.070, -0.018], [s * 0.074, -0.018], [s * 0.046, 0.016], [s * 0.043, 0.016]], col, 0.45, 0.001);
  if (R.legLeft != null && !R.elecOut) H.text(pad(R.legLeft, 3).trim() + ' KM', 0, -0.024, 0.0095, col, 0.55, 0.001);
}

// ── THE HOLOGRAM ── The rig in its own frame, nose forward, turned to show its flank: the cab-over's
// stations from mesh_truck_drayman_2076.json, its masts, and the box swinging about the pin with the
// real angle. The pads breathe with the revs.
const HSC = 0.235, PIN_F = -0.0355;
const hp = (f, g, h) => [g * HSC, (f + 0.02) * HSC, (h - 0.15) * HSC];
function holoBox(H, f0, f1, w, h0, h1, rgb, turn = null) {
  const m = (f, g, h) => { const q = turn ? turn(f, g) : [f, g]; return hp(q[0], q[1], h); };
  const c = [[f0, -w], [f1, -w], [f1, w], [f0, w]];
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    H.line(m(a[0], a[1], h0), m(b[0], b[1], h0), 0.0011, rgb);
    H.line(m(a[0], a[1], h1), m(b[0], b[1], h1), 0.0011, rgb);
    H.line(m(a[0], a[1], h0), m(a[0], a[1], h1), 0.0011, rgb);
  }
}
function holoRig(K, c, R, lit) {
  const H = holoFrame(K, c, 0, 0, -32);
  const col = R.fading ? HOLO_RED : R.brake > 0.42 ? HOLO_AMBER : HOLO_LINE;
  holoBox(H, 0.10, 0.416, 0.165, 0.03, 0.15, HOLO_LINE);                       // lower body
  for (const s of [-1, 1]) {
    H.line(hp(0.400, s * 0.165, 0.150), hp(0.363, s * 0.165, 0.262));          // the screen's edges
    H.line(hp(0.363, s * 0.165, 0.262), hp(0.356, s * 0.159, 0.284), 0.0013, HOLO_AMBER);   // the visor
    H.line(hp(0.356, s * 0.159, 0.284), hp(0.340, s * 0.141, 0.300));
    H.line(hp(0.340, s * 0.141, 0.300), hp(0.114, s * 0.141, 0.300));
    H.line(hp(0.100, s * 0.165, 0.150), hp(0.100, s * 0.165, 0.284));
    H.line(hp(0.100, s * 0.155, 0.300), hp(0.100, s * 0.155, 0.360), 0.0011, HOLO_AMBER);    // the masts
  }
  H.line(hp(0.363, -0.165, 0.262), hp(0.363, 0.165, 0.262), 0.0013, HOLO_AMBER);
  H.line(hp(0.340, -0.141, 0.300), hp(0.340, 0.141, 0.300));
  H.line(hp(0.114, -0.141, 0.300), hp(0.114, 0.141, 0.300));
  holoBox(H, -0.105, 0.10, 0.102, 0.05, 0.082, HOLO_LINE);                       // the frame
  const pulse = 1 + (lit ? 0.18 * R.rpm * Math.sin(wallSec() * 7) : 0);
  for (const f of [0.360, 0.200, -0.030]) for (const s of [-1, 1]) {
    H.ring(hp(f, s * 0.122, 0.016), 0.040 * HSC * pulse, [1, 0, 0], [0, 1, 0], 0.0009, 12, lit ? HOLO_LINE : HOLO_AMBER);
  }
  if (R.phi == null) return;
  const a = R.phi * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  const turn = (f, g) => [PIN_F + (f - PIN_F) * cs - g * sn, (f - PIN_F) * sn + g * cs];
  holoBox(H, PIN_F - 0.58, PIN_F + 0.03, 0.168, 0.075, 0.36, col, turn);
}

// ── THE STICK ── The Strand's own stick, right of the wheel on a pod off the slab's lip. Decoration:
// no hotspot, no reading, never moves.
function stick(K, P, lit, G) {
  const base = [0.30, 0.50, -0.505];
  K.box(base[0] - 0.045, base[1] - 0.030, base[2] - 0.020, base[0] + 0.045, base[1] + 0.105, base[2], 'dash', 0.12, T.carbon);
  K.box(base[0] - 0.040, base[1] + 0.080, base[2], base[0] + 0.040, base[1] + 0.130, base[2] + 0.045, 'dash', 0.1, T.carbon);
  lightLine(K, [[base[0] - 0.040, base[1] - 0.031, base[2] - 0.004], [base[0] + 0.040, base[1] - 0.031, base[2] - 0.004]], 0.0018, G, lit ? 0.6 : 0.05);
  K.rod([base[0], base[1], base[2]], [base[0], base[1] + 0.004, base[2] + 0.008], 0.022, 'dash', 0.05, T.tub, 0, 12);   // the boot
  K.rod([base[0], base[1] + 0.004, base[2] + 0.008], [base[0], base[1] + 0.010, base[2] + 0.050], 0.007, 'dash', 0.1, T.steel, 0.05, 8);
  K.rod([base[0], base[1] + 0.010, base[2] + 0.048], [base[0], base[1] + 0.016, base[2] + 0.088], 0.015, 'dash', 0.12, T.carbon, 0, 10);   // the grip
  K.rod([base[0], base[1] + 0.016, base[2] + 0.088], [base[0], base[1] + 0.017, base[2] + 0.092], 0.012, 'dash', 0.2, G, lit ? 0.7 : 0.05, 10);
}

export function dr76Fit(P, live, push) {
  const K = makeKit(push), R = readings(live), G = R.glow, xC = P.xCentre;
  const lit = R.powered, boot = bootAge(live);
  const warn = lit && (R.fading || !!R.lamps.dmg), caution = lit && (R.fuel < 0.15 || R.brake > 0.42);
  const al0 = alertLight(caution, warn), al = { rgb: !caution && !warn ? G : al0.rgb, k: al0.k };
  const lineK = (k) => (lit ? k * al.k : 0.05);

  // ── THE SLAB: satin over the top, carbon under the lip ──
  const curve = dashCurve(P), N = 28;
  const top = [GT, [GT[0] + 0.05, GT[1] + 0.004], [GT[0] + 0.12, GT[1] + 0.002], [GT[0] + 0.15, GT[1] - 0.050], [GT[0] + 0.152, -0.02]];
  const at = (c, f, z) => [c.p[0] + c.f[0] * f, c.p[1] + c.f[1] * f, c.p[2] + z];
  const ss = Array.from({ length: N + 1 }, (_, i) => i / N);
  loft(push, ss.map((s) => { const c = curve(s); return top.map(([f, z]) => at(c, f, z)); }), 'dash', 0.26, true, SATIN, 1);
  sweep(K, ss.map((s) => { const c = curve(s); return [[0, 0], [-0.012, -0.004], [-0.018, -0.028], [-0.004, -0.060]].map(([f, z]) => at(c, f, z)); }), 'dash', 0.1, T.carbon);
  lightLine(K, ss.map((s) => { const c = curve(s); return at(c, -0.014, -0.004); }), 0.0026, al.rgb, lineK(0.85));
  lightLine(K, ss.slice(1, -1).map((s) => { const c = curve(s); return at(c, GT[0] + 0.12, GT[1] + 0.004); }), 0.0016, al.rgb, lineK(0.4));
  // The same line along each door, at the shoulder and the sill, so an alert reaches the whole cab.
  for (const x of [P.xCentre - P.halfW + 0.012, P.xCentre + P.halfW - 0.012]) {
    lightLine(K, [[x, 0.46, -0.335], [x, -0.30, -0.335]], 0.0022, al.rgb, lineK(0.5));
    lightLine(K, [[x, 0.46, P.floor + 0.05], [x, -0.30, P.floor + 0.05]], 0.0022, al.rgb, lineK(0.22));
  }

  // ── THE BAND ──
  glassBand(K, curve, { h: DASH.h, lean: DASH.lean, segs: N, lit, light: al.rgb, lightK: lineK(1), substrate: T.screen });
  for (const sc of SCREENS) {
    const Pn = bandPanel(K, P, sc.x, PAGE_V, 0.012), up = reveal(boot, sc.boot);
    if (!lit || up <= 0) continue;
    if (up < 1) {                                       // the boot: a lit line sweeps across, the page behind it
      const x = lerp(-sc.w, sc.w, up);
      Pn.rect(-sc.w, -SCREEN_H, x, SCREEN_H, T.screen, 0.3 * up, 0.001);
      Pn.rect(x - 0.002, -SCREEN_H, x + 0.002, SCREEN_H, G, 1, 0.0025);
      continue;
    }
    Pn.rect(-sc.w + 0.004, -SCREEN_H + 0.0015, -sc.w + 0.0065, SCREEN_H - 0.0015, al.rgb, 0.85, 0.0018);
    if (sc.id === 'drive') drivePage(Pn, R, G);
    else if (sc.id === 'route') routePage(Pn, R, G);
    else if (sc.id === 'rig') rigPage(Pn, R, G);
    else sysPage(Pn, R, G);
  }
  // The status strip: NO COVER whenever there's power, HIRED on a rental.
  {
    const Pn = bandPanel(K, P, 0.83, PAGE_V, 0.012), on = lit && reveal(boot, 0.55) >= 1;
    lensLamp(Pn, 0, 0.022, 0.110, 0.030, on, T.amber, 'NO COVER');
    lensLamp(Pn, 0, -0.022, 0.110, 0.030, on && R.hire != null, G, 'HIRED');
  }
  // The clock, and the maker's plate at the passenger's end.
  if (lit && R.hour != null && reveal(boot, 0.6) >= 1) {
    const Pn = bandPanel(K, P, 1.07, PAGE_V, 0.012), hh = Math.floor(R.hour) % 24, mm = Math.floor((R.hour % 1) * 60);
    Pn.digits(-0.07, -0.022, 0.044, String(hh).padStart(2, '0') + String(mm).padStart(2, '0'), G, false);
  }
  {
    const Pn = bandPanel(K, P, 1.36, 0.085, 0.006);
    Pn.rect(-0.115, -0.04, 0.115, 0.04, T.steel, 0.06, 0.002);
    Pn.rect(-0.108, -0.033, 0.108, 0.033, T.steelDk, 0.02, 0.0026);
    Pn.text('VACHON', 0, 0.012, 0.0145, T.steel, 0.25, 0.0034);
    Pn.text('DRAYMAN 2076', 0, -0.014, 0.012, G, lit ? 0.5 : 0.15, 0.0034);
  }

  // ── THE KEYS ── A key sinks while pressed, its light eases with the switch, it brightens as the
  // hand comes over it, and a ring flashes when its state changes. Disabled: dark, no hotspot.
  for (const c of keyCells(live)) {
    const Kp = bandPanel(K, P, c.x, KEY_V, 0.004), id = c.key;
    const pressed = !!live && live.press === id, near = !!live && live.hover === id && c.enabled;
    const glow = eased('dr76:glow:' + id, c.on ? 1 : 0, 10), depth = eased('dr76:dip:' + id, pressed ? 0.0015 : 0.005, 30);
    const hand = eased('dr76:near:' + id, near ? 1 : 0, 14);
    const rgb = id === 'key' ? T.green : id === 'horn' ? T.amber : G;
    Kp.rect(-KEY_HW - 0.002, -KEY_HH - 0.002, KEY_HW + 0.002, KEY_HH + 0.002, T.tub, 0, 0.0005);
    Kp.rect(-KEY_HW - 0.002, -KEY_HH - 0.002, -KEY_HW - 0.0005, KEY_HH + 0.002, G, (lit ? 0.25 : 0) + hand * 0.75, 0.0012);
    Kp.stud(0, 0, KEY_HW, KEY_HH, depth, rgb.map((v, k) => lerp(T.keyOff[k], v, glow * 0.8)), glow * 0.85 + hand * 0.15, 0.0015);
    const ink = c.enabled ? (glow > 0.5 ? [8, 22, 26] : [210, 224, 228]) : [90, 98, 104];
    Kp.text(KEY_NAME[id] || id.toUpperCase(), 0, 0, 0.0105, ink, glow > 0.5 ? 0 : (lit ? 0.6 : 0.2), depth + 0.0025);
    const flash = pressPulse('dr76:key:' + id, !!c.on);
    if (flash > 0.02) Kp.rect(-KEY_HW - 0.005, -KEY_HH - 0.005, KEY_HW + 0.005, KEY_HH + 0.005, HALO, flash * 0.6, 0.0002);
  }

  if (lit && reveal(boot, 0.2) > 0) hud(K, R, G, warn, caution);

  stick(K, P, lit, G);

  // ── THE HOLOGRAM on the slab, on a projector whose arc is the fuel left ──
  {
    const c = curve(sOf(xC - 0.06)), base = at(c, GT[0] + 0.07, GT[1] + 0.006);
    holoProjector(K, base, 0.05, 0.05, lit ? R.fuel : 0, R.fuel < 0.15 ? HOLO_RED : HOLO_LINE);
    if (lit && reveal(boot, 0.5) >= 1) holoRig(K, add(base, [0, 0, 0.075]), R, lit);
  }
  hotspotHalo(K, dr76Hotspots(P, live), live);
}
