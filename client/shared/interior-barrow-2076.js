// THE KRELL BARROW 2076'S CAB: the cheapest truck's cab to the 2076 bar (docs/proposals/hover-rigs.md).
//
// The Courier 2076's board (interior-courier-2076.js) on its third owner. A refit like the Courier's
// (`P.refit`): the stock truck room, wheel, gate, pedals, doors, overhead and seats stay (truckFit in
// interior-fit.js), so every control and every trinket keeps its place, and this file brings the board
// that replaces the clusters, stacks and switch banks:
//   - a vinyl wing door to door, split and taped, with a shelf behind it;
//   - one band of glass on the wing's face with three live pages and a dead one, and glass keys along
//     its foot. The route page's backlight is going: it dips and stutters on wall time, over the same
//     numbers. The dead page is cracked and taped over and shows nothing;
//   - a projected HUD low in the screen, with the Jake and the clutch mirrored in its corners;
//   - a hologram of the rig on the shelf that bends at the pin with the real trailer angle;
//   - light lines in the alert colour, pages that boot in turn on the key, keys that light for the hand;
//   - photos tucked into the band's frame, a stick-on clock on the shelf, and a stamped steel tag.
//
// The hotspots' ids are CAB_CTL keys (cab-view.js): a truck's click is the shelf button's own click, so
// a key here does exactly what the same switch does in any other cab, or nothing if the truck hasn't
// got it. `live.ctl` says which switches exist and how they stand; a disabled one has no hotspot. A
// Barrow has fewer switches than a Courier, so it has fewer keys.
//
// Every readout is a sim value; the flicker and the dead page are decoration and carry none. The walls
// and the wing take the colourway (cab-trim.js EDITION_TRIM is the factory's primer grey; the bench can
// change it), and the light lines take its glow until an alert turns them. Frame as interior-kit.js:
// shell metres, eye at the origin, +x right, +y forward, +z up.
import { makeKit, clamp, lerp, SHINY, TEXTURE } from './interior-kit.js';
import { hotspotHalo, eased, pressPulse, HALO, bootAge, reveal, alertLight, sweep, lightLine, bandFrame, glassBand,
  holoFrame, holoProjector, lensLamp, wallSec, facingPanel, HOLO_LINE, HOLO_AMBER, HOLO_RED, HUD_LINE, HUD_AMBER, HUD_RED } from './interior-cockpit-kit.js';
import { loft } from './interior-fit.js';
import { MPH_KMH } from './world-scale.js';

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export const BW76_TRIM = {
  lip: [40, 40, 38], tub: [26, 26, 25], steel: [150, 152, 150], steelDk: [92, 94, 94], stamp: [40, 42, 44],
  screen: [6, 10, 11], dead: [12, 13, 14], crack: [112, 120, 124], keyOff: [42, 44, 44], segOff: [20, 30, 30],
  tape: [150, 148, 138], foam: [156, 138, 96], clock: [22, 24, 22], clockLcd: [150, 196, 120],
  green: [120, 230, 150], red: [235, 60, 48], amber: [255, 176, 64],
};
const T = BW76_TRIM;
for (const k of ['lip', 'tub', 'clock']) TEXTURE.set(T[k], 'plastic');
for (const k of ['steel', 'steelDk']) TEXTURE.set(T[k], 'brushed');
TEXTURE.set(T.tape, 'fabric');
SHINY.set(T.steel, { spec: 0.55, pow: 30 });
SHINY.set(T.screen, { spec: 0.6, pow: 60 });
SHINY.set(T.dead, { spec: 0.7, pow: 70 });
// The wing's skin: the colourway's own dash key, as vinyl gone soft with sun.
const VINYL = { lv: 1.0, spec: 0.16, pow: 9, grain: 0.05, tex: 'leather' };
// The room's surfaces: vinyl on the hard panels, cloth on the seats and the lining, a rubber mat on the
// floor. The stock grain is stipple tuned for dark plastic; this keeps it low so a pale colourway reads
// as vinyl and not as concrete.
const ROOM_MATS = {
  hard: { lv: 1.02, spec: 0.20, pow: 12, grain: 0.04, tex: 'leather' }, soft: { lv: 0.98, spec: 0.14, pow: 8, grain: 0.04, tex: 'leather' },
  card: { lv: 1.10, spec: 0.18, pow: 10, grain: 0.04, tex: 'leather' }, lower: { lv: 0.70, spec: 0.20, pow: 12, grain: 0.06, tex: 'rubber' },
  fabric: { lv: 1.55, spec: 0, pow: 1, grain: 0.03, tex: 'fabric' }, floor: { lv: 0.48, spec: 0.08, pow: 5, grain: 0.05, tex: 'rubber' },
};

export function barrow2076Profile(base) {
  return { ...base, label: 'Barrow 2076 cab',
    refit: { tier: 1, dashToy: SHELF_TOY, mats: ROOM_MATS, fit: bw76Fit },
    hotspots(live) { return bw76Hotspots(this, live); } };
}

// The one place live is read.
function readings(live) {
  const L = live || {}, phi = L.trailerPhi;
  return {
    L, kmh: Math.max(0, Math.abs(num(L.mph))) * MPH_KMH, rpm: clamp(num(L.rpm), 0, 1.05), fuel: clamp(num(L.fuel, 1), 0, 1),
    gear: String(L.gear ?? 'N').replace('½', '').replace('—', '-').slice(0, 2),
    phi: phi == null ? null : num(phi), brake: clamp(num(L.brakeTemp), 0, 1), fading: !!L.fading,
    powered: L.powered !== false, lamps: L.lamps || {}, hdg: num(L.hdg), hour: L.hour == null ? null : num(L.hour),
    legFrac: clamp(num(L.legFrac), 0, 1), legLeft: L.legLeft == null ? null : Math.max(0, num(L.legLeft)), aim: L.aim || null,
    elecOut: !!L.elecOut, clutch: clamp(num(L.pedals?.clutch), 0, 1), jake: !!L.lamps?.jake,
    glow: Array.isArray(L.glow) && L.glow.length === 3 && L.glow.every(Number.isFinite) ? L.glow : [255, 174, 66],
  };
}

// ── THE WING ── The band's lower edge runs door to door in the screen's own shallow curve, as the
// Courier's does.
const DASH = { xL: -0.57, xR: 1.67, yMid: 0.652, sag: 0.045, z0: -0.415, h: 0.18, lean: 0.42 };
const dashCurve = (P) => (s) => {
  const x = lerp(DASH.xL, DASH.xR, s), q = (x - P.xCentre) / P.halfW;
  const dy = -2 * DASH.sag * q / P.halfW;
  return { p: [x, DASH.yMid - DASH.sag * q * q, DASH.z0], f: norm([-dy, 1, 0]) };
};
const sOf = (x) => (x - DASH.xL) / (DASH.xR - DASH.xL);
const bandPanel = (K, P, x, v, lift = 0.005) => bandFrame(dashCurve(P), DASH.lean).at(K, sOf(x), v, lift);
// The glass's top edge, across the dash and up from its foot.
const GT = [DASH.h * DASH.lean / Math.hypot(1, DASH.lean), DASH.h / Math.hypot(1, DASH.lean)];
const SHELF_Z = DASH.z0 + GT[1] + 0.006;
const SHELF_TOY = [0.92, DASH.yMid + GT[0] + 0.05, SHELF_Z];

// ── THE KEYS ── Along the band's foot, either side of the wheel, in the order the stock banks use.
const KEY_ROW = { left: ['key', 'heads', 'dome', 'jake', 'cruise', 'horn'], right: ['park', 'trailer', 'pump', 'exit', 'latch', 'galley', 'auto'] };
const KEY_NAME = { key: 'KEY', heads: 'LAMPS', dome: 'CAB', jake: 'JAKE', cruise: 'CRUISE', horn: 'HORN',
  park: 'PARK', trailer: 'AIR', pump: 'PUMP', exit: 'EXIT', latch: 'DOORS', galley: 'GALLEY', auto: 'AUTO' };
const KEY_STEP = 0.068, KEY_V = 0.027, KEY_HW = 0.031, KEY_HH = 0.0165;
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
export function bw76Hotspots(P, live) {
  const K = makeKit(() => {});
  return keyCells(live || {}).filter((c) => c.enabled)
    .map((c) => ({ id: c.key, p: bandPanel(K, P, c.x, KEY_V, 0.004).pt(0, 0, 0.01), r: 0.028, kind: 'click' }));
}

// ── THE PAGES ── Panel metres, centred; a page runs ±sc.w across and ±SCREEN_H up. The dead page is
// where the Courier keeps its clock.
export const BW76_PAGES = [
  { id: 'route', x: -0.345, w: 0.125, boot: 0.3 },
  { id: 'drive', x: -0.03, w: 0.175, boot: 0 },
  { id: 'rig', x: 0.285, w: 0.122, boot: 0.15 },
  { id: 'sys', x: 0.56, w: 0.135, boot: 0.45 },
  { id: 'dead', x: 1.0, w: 0.12, boot: 0 },
];
const SCREEN_H = 0.058, PAGE_V = 0.109;
const LABEL = 0.0115;
// Where a page's middle is in the cab, for the gate.
export const bw76PageAt = (P, id) => { const sc = BW76_PAGES.find((p) => p.id === id); return bandFrame(dashCurve(P), DASH.lean).P(sOf(sc.x), PAGE_V, 0.012); };

// The route page's backlight is failing. For two or three seconds in every seven it stutters, ticking
// fourteen times a second between full, dim and nearly off; the rest of the time it's steady. Wall
// time only, and only the brightness: the numbers under it are the sim's in every frame.
export function bw76Flicker(t) {
  if (Math.sin(t * 0.9) <= 0.55) return 1;
  const h = (Math.imul(Math.floor(t * 14), 2654435761) >>> 0) / 4294967296;
  return h < 0.4 ? 0.22 : h < 0.65 ? 0.6 : 1;
}
// The same panel with everything it draws dimmed by k, so a page drawn through it is the same page.
const DIM_RGB = { rect: 4, text: 4, digits: 4, fitText: 5, plate: 1 };
const DIM_EMIS = { rect: 5, text: 5, fitText: 6, plate: 2 };
function dimPanel(Pn, k) {
  if (k >= 1) return Pn;
  const out = { ...Pn };
  for (const [m, i] of Object.entries(DIM_RGB)) out[m] = (...a) => {
    if (Array.isArray(a[i])) a[i] = a[i].map((c) => c * k);
    const e = DIM_EMIS[m];
    if (e != null && Number.isFinite(a[e])) a[e] *= k;
    return Pn[m](...a);
  };
  return out;
}

const pad = (n, w) => String(Math.round(n)).padStart(w, ' ').slice(-w);
const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function bar(Pn, x0, x1, y, h, frac, rgb, emis = 0.9) {
  Pn.rect(x0, y, x1, y + h, T.segOff, 0, 0.0015);
  if (frac > 0.002) Pn.rect(x0, y, lerp(x0, x1, frac), y + h, rgb, emis, 0.0025);
}
function drivePage(Pn, R, G) {
  // The revs across the top, amber then red toward the stop.
  const N = 24, x0 = -0.163, x1 = 0.163, w = (x1 - x0) / N;
  for (let i = 0; i < N; i++) {
    const at = (i + 1) / N, on = R.rpm >= at - 0.5 / N;
    const rgb = at > 0.92 ? T.red : at > 0.78 ? T.amber : G;
    Pn.rect(x0 + i * w + 0.0014, 0.030, x0 + (i + 1) * w - 0.0014, 0.046, on ? rgb : T.segOff, on ? 0.95 : 0, 0.0025);
  }
  Pn.digits(-0.16, -0.05, 0.064, pad(R.kmh, 3), G, false);
  Pn.text('KM/H', -0.012, -0.040, LABEL, G, 0.6, 0.003);
  Pn.digits(0.082, -0.05, 0.064, R.gear.padStart(2, ' '), [236, 240, 230], false);
  Pn.text('GEAR', 0.045, -0.040, LABEL, G, 0.6, 0.003);
}
function routePage(Pn, R, G) {
  if (R.elecOut) { Pn.text('NO SIGNAL', 0, 0, 0.014, T.amber, 0.8, 0.003); return; }
  const h = ((R.hdg % 360) + 360) % 360;
  Pn.digits(-0.114, 0.004, 0.034, String(Math.round(h) % 360).padStart(3, '0'), G, false);
  Pn.text(CARD[Math.round(h / 45) % 8], -0.012, 0.029, 0.014, [236, 240, 230], 0.9, 0.003);
  Pn.text('HDG', -0.012, 0.011, LABEL, G, 0.6, 0.003);
  if (R.legLeft != null) {
    Pn.digits(0.026, 0.004, 0.034, pad(R.legLeft, 3).slice(-3), [236, 240, 230], false);
    Pn.text('KM', 0.109, 0.012, LABEL, G, 0.6, 0.003);
  }
  bar(Pn, -0.112, 0.112, -0.016, 0.006, R.legFrac, G);
  const aim = String(R.aim || 'NO ROUTE').toUpperCase().replace(/[^A-Z0-9 /-]/g, ' ').slice(0, 18);
  Pn.fitText(aim, 0, -0.038, 0.22, 0.012, [204, 214, 204], 0.6, 0.003);
}
// The rig from above, nose right, the box swung about the pin by the real angle.
function rigPage(Pn, R, G) {
  const px = 0.030, py = 0.022, col = R.fading ? T.red : G;
  const cab = (x0, x1, hw) => [[px + x0, py - hw], [px + x1, py - hw], [px + x1, py + hw], [px + x0, py + hw]];
  Pn.plate(cab(-0.020, 0.020, 0.012), [56, 52, 44], 0.3, 0.002);
  Pn.plate(cab(0.020, 0.056, 0.019), col, 0.9, 0.0025);
  if (R.phi != null) {
    const a = R.phi * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    // Held inside the page at a jackknife; the angle under it stays the true one.
    const rot = ([x, y]) => [px + x * c - y * s, clamp(py + x * s + y * c, -0.012, SCREEN_H - 0.006)];
    Pn.plate([[-0.112, -0.015], [0.004, -0.012], [0.004, 0.012], [-0.112, 0.015]].map(rot), [236, 240, 230], 0.75, 0.003);
    Pn.text('HITCH ' + Math.round(Math.abs(R.phi)) + ' DEG', 0, -0.025, LABEL, G, 0.7, 0.003);
  } else Pn.text('BOBTAIL', 0, -0.025, LABEL, G, 0.7, 0.003);
  Pn.text('BRAKE', -0.086, -0.045, LABEL, R.fading ? T.red : G, 0.7, 0.003);
  bar(Pn, -0.048, 0.110, -0.049, 0.008, R.brake, R.fading ? T.red : R.brake > 0.42 ? T.amber : G);
}
function sysPage(Pn, R, G) {
  Pn.text('FUEL', -0.106, 0.040, LABEL, R.fuel < 0.15 ? T.amber : G, 0.7, 0.003);
  bar(Pn, -0.072, 0.122, 0.035, 0.010, R.fuel, R.fuel < 0.15 ? T.amber : G);
  const L = R.lamps;
  [['FUEL', L.fuel, T.amber], ['BRAKE', L.brake, T.red], ['JAKE', L.jake, G],
    ['WIPER', L.wipe, G], ['TRAIL', L.trail, T.amber], ['DAMAGE', L.dmg, T.red]].forEach(([name, on, rgb], i) =>
    lensLamp(Pn, -0.086 + (i % 3) * 0.086, 0.010 - (i / 3 | 0) * 0.033, 0.080, 0.027, !!on, rgb, name));
}
// The dead page: the glass is cracked from one corner and taped across, and nothing is lit behind it.
function deadPage(Pn) {
  Pn.rect(-0.12, -SCREEN_H, 0.12, SCREEN_H, T.dead, 0, 0.0015);
  const crack = [[-0.118, 0.052], [-0.070, 0.020], [-0.050, 0.026], [-0.010, -0.006], [0.020, -0.002], [0.064, -0.040], [0.090, -0.054]];
  for (let i = 0; i + 1 < crack.length; i++) {
    const [a, b] = crack[i], [c, d] = crack[i + 1], l = Math.hypot(c - a, d - b) || 1, nx = -(d - b) / l * 0.0009, ny = (c - a) / l * 0.0009;
    Pn.plate([[a + nx, b + ny], [c + nx, d + ny], [c - nx, d - ny], [a - nx, b - ny]], T.crack, 0, 0.0022);
  }
  // Two branches off the main crack.
  Pn.plate([[-0.050, 0.026], [-0.0485, 0.0275], [-0.036, 0.056], [-0.0375, 0.0545]], T.crack, 0, 0.0022);
  Pn.plate([[0.020, -0.002], [0.0215, -0.0035], [0.060, 0.020], [0.0585, 0.0215]], T.crack, 0, 0.0022);
  for (const s of [-1, 1]) tapeStrip(Pn, -0.10, s * 0.046, 0.10, -s * 0.046, 0.011, 0.0034);
}
// A strip of grey tape from (a, b) to (c, d), `hw` wide, on panel Pn.
function tapeStrip(Pn, a, b, c, d, hw, lift = 0.003) {
  const l = Math.hypot(c - a, d - b) || 1, nx = -(d - b) / l * hw, ny = (c - a) / l * hw;
  Pn.plate([[a + nx, b + ny], [c + nx, d + ny], [c - nx, d - ny], [a - nx, b - ny]], T.tape, 0, lift);
}
// A photo: a white border, a picture of sky, ground and somebody standing in it, turned by `rot`.
const PHOTOS = [
  { x: -0.525, v: 0.118, rot: 0.10, sky: [120, 156, 196], ground: [116, 98, 64], who: [180, 70, 52] },
  { x: 1.175, v: 0.124, rot: -0.14, sky: [210, 160, 110], ground: [70, 82, 60], who: [40, 52, 86] },
  { x: 1.53, v: 0.120, rot: 0.08, sky: [150, 170, 180], ground: [90, 96, 100], who: [214, 196, 120] },
];
function photo(Pn, ph) {
  const c = Math.cos(ph.rot), s = Math.sin(ph.rot), R = (pts) => pts.map(([a, b]) => [a * c - b * s, a * s + b * c]);
  const q = (a0, b0, a1, b1) => R([[a0, b0], [a1, b0], [a1, b1], [a0, b1]]);
  Pn.plate(q(-0.030, -0.036, 0.030, 0.036), [228, 224, 214], 0, 0.0026);
  Pn.plate(q(-0.025, -0.002, 0.025, 0.030), ph.sky, 0, 0.0030);
  Pn.plate(q(-0.025, -0.024, 0.025, -0.002), ph.ground, 0, 0.0030);
  Pn.plate(q(-0.006, -0.018, 0.004, 0.012), ph.who, 0, 0.0034);
  Pn.plate(R(Array.from({ length: 8 }, (_, k) => [-0.001 + Math.cos(k * Math.PI / 4) * 0.006, 0.018 + Math.sin(k * Math.PI / 4) * 0.006])), ph.who.map((v) => v * 0.8 + 40), 0, 0.0034);
  // Held on with one strip of tape across the top.
  const [ta, tb] = R([[-0.018, 0.034]])[0], [tc, td] = R([[0.018, 0.034]])[0];
  tapeStrip(Pn, ta, tb, tc, td, 0.006, 0.0040);
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
  // The lane ahead, as two ticks either side of the sight line, and the next stop.
  for (const s of [-1, 1]) H.plate([[s * 0.070, -0.018], [s * 0.074, -0.018], [s * 0.046, 0.016], [s * 0.043, 0.016]], col, 0.45, 0.001);
  if (R.legLeft != null && !R.elecOut) H.text(pad(R.legLeft, 3).trim() + ' KM', 0, -0.024, 0.0095, col, 0.55, 0.001);
}

// ── THE HOLOGRAM ── The rig in its own frame, nose forward, turned to show its flank. A small model of
// the stations the body is built on (concepts/barrow-2076.mjs): the cab-over, its two stacks and the
// spare pod on the roof. The box swings about the pin with the real angle, and the pads pulse with the
// revs.
const HSC = 0.30, PIN_F = 0.065;
const hp = (f, g, h) => [g * HSC, (f - 0.06) * HSC, (h - 0.15) * HSC];
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
  holoBox(H, 0.18, 0.418, 0.14, 0.03, 0.116, HOLO_LINE);                        // lower body
  for (const s of [-1, 1]) {
    H.line(hp(0.390, s * 0.134, 0.116), hp(0.318, s * 0.106, 0.225));          // the screen's edges
    H.line(hp(0.318, s * 0.106, 0.225), hp(0.206, s * 0.106, 0.225));
    H.line(hp(0.206, s * 0.106, 0.225), hp(0.182, s * 0.110, 0.204));
    H.line(hp(0.182, s * 0.110, 0.204), hp(0.182, s * 0.134, 0.116));
    H.line(hp(0.179, s * 0.132, 0.064), hp(0.179, s * 0.132, 0.285), 0.0011, HOLO_AMBER);   // the stacks
  }
  H.line(hp(0.318, -0.106, 0.225), hp(0.318, 0.106, 0.225));
  H.line(hp(0.206, -0.106, 0.225), hp(0.206, 0.106, 0.225));
  H.ring(hp(0.250, 0, 0.232), 0.026 * HSC, [1, 0, 0], [0, 1, 0], 0.0009, 10, HOLO_AMBER);   // the spare pod
  holoBox(H, 0.005, 0.18, 0.087, 0.05, 0.082, HOLO_LINE);                       // the frame
  // The pads: rings that breathe with the revs (the rate is decoration, the swell is the rpm).
  const pulse = 1 + (lit ? 0.18 * R.rpm * Math.sin(wallSec() * 7) : 0);
  for (const [f, r] of [[0.366, 0.036], [0.226, 0.034], [0.062, 0.040]]) for (const s of [-1, 1]) {
    H.ring(hp(f, s * 0.104, 0.016), r * HSC * pulse, [1, 0, 0], [0, 1, 0], 0.0009, 12, lit ? HOLO_LINE : HOLO_AMBER);
  }
  if (R.phi == null) return;
  const a = R.phi * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  const turn = (f, g) => [PIN_F + (f - PIN_F) * cs - g * sn, (f - PIN_F) * sn + g * cs];
  holoBox(H, -0.327, 0.069, 0.10, 0.075, 0.33, col, turn);
}

export function bw76Fit(P, live, push) {
  const K = makeKit(push), R = readings(live), G = R.glow, xC = P.xCentre;
  const lit = R.powered, boot = bootAge(live);
  const warn = lit && (R.fading || !!R.lamps.dmg), caution = lit && (R.fuel < 0.15 || R.brake > 0.42);
  const al0 = alertLight(caution, warn), al = { rgb: !caution && !warn ? G : al0.rgb, k: al0.k };
  const lineK = (k) => (lit ? k * al.k : 0.05);

  // ── THE WING: vinyl over the top, scuffed plastic under the lip ──
  const curve = dashCurve(P), N = 28;
  const top = [GT, [GT[0] + 0.05, GT[1] + 0.008], [GT[0] + 0.11, GT[1] - 0.012], [GT[0] + 0.15, GT[1] - 0.075], [GT[0] + 0.155, -0.02]];
  const at = (c, f, z) => [c.p[0] + c.f[0] * f, c.p[1] + c.f[1] * f, c.p[2] + z];
  const ss = Array.from({ length: N + 1 }, (_, i) => i / N);
  loft(push, ss.map((s) => { const c = curve(s); return top.map(([f, z]) => at(c, f, z)); }), 'dash', 0.26, true, VINYL, 1);
  sweep(K, ss.map((s) => { const c = curve(s); return [[0, 0], [-0.014, -0.006], [-0.022, -0.030], [-0.004, -0.058]].map(([f, z]) => at(c, f, z)); }), 'dash', 0.1, T.lip);
  lightLine(K, ss.map((s) => { const c = curve(s); return at(c, -0.016, -0.004); }), 0.0028, al.rgb, lineK(0.85));
  // Carried back along each door, so the alert reaches the whole cab. Only the waist line: the sill
  // strips were the first thing to go.
  for (const x of [P.xCentre - P.halfW + 0.012, P.xCentre + P.halfW - 0.012]) lightLine(K, [[x, 0.46, -0.335], [x, -0.30, -0.335]], 0.0022, al.rgb, lineK(0.5));

  // The vinyl has split along the top in two places, the yellow foam showing in the splits, and both
  // are taped across. On the wing's first slope, where the sun lands: z rises 0.008 over its first 0.05.
  const onTop = (s, f, l = 0.0015) => { const c = curve(s); return at(c, f, GT[1] + (f - GT[0]) * 0.16 + l); };
  for (const [s0, s1, f0, f1] of [[0.10, 0.19, GT[0] + 0.012, GT[0] + 0.030], [0.62, 0.70, GT[0] + 0.026, GT[0] + 0.014]]) {
    K.face([onTop(s0, f0 - 0.0016), onTop(s1, f1 - 0.0016), onTop(s1, f1 + 0.0016), onTop(s0, f0 + 0.0016)], [0, 0, 1], 'dash', 0.1, T.foam, 0);
    // Each strip a little askew, as tape goes on.
    for (const [t, skew] of [[0.25, 0.003], [0.6, -0.002], [0.9, 0.004]]) {
      const s = lerp(s0, s1, t), f = lerp(f0, f1, t), hw = 0.0045;
      K.face([onTop(s - hw - skew, f - 0.024, 0.0025), onTop(s + hw - skew, f - 0.024, 0.0025), onTop(s + hw + skew, f + 0.022, 0.0025), onTop(s - hw + skew, f + 0.022, 0.0025)], [0, 0, 1], 'dash', 0.2, T.tape, 0);
    }
  }

  // ── THE BAND ──
  glassBand(K, curve, { h: DASH.h, lean: DASH.lean, segs: N, lit, light: al.rgb, lightK: lineK(1), substrate: T.screen });
  const flick = bw76Flicker(wallSec());
  for (const sc of BW76_PAGES) {
    const Pn0 = bandPanel(K, P, sc.x, PAGE_V, 0.012);
    if (sc.id === 'dead') { deadPage(Pn0); continue; }
    const up = reveal(boot, sc.boot);
    if (!lit || up <= 0) continue;
    const Pn = sc.id === 'route' ? dimPanel(Pn0, flick) : Pn0;
    if (up < 1) {                                       // the boot: a lit line sweeps up, the page behind it
      const y = lerp(-SCREEN_H, SCREEN_H, up);
      Pn.rect(-sc.w, -SCREEN_H, sc.w, y, T.screen, 0.3 * up, 0.001);
      Pn.rect(-sc.w, y - 0.002, sc.w, y + 0.002, G, 1, 0.0025);
      continue;
    }
    Pn.rect(-sc.w + 0.004, SCREEN_H - 0.0035, sc.w - 0.004, SCREEN_H - 0.0015, al.rgb, 0.85, 0.0018);
    if (sc.id === 'drive') drivePage(Pn, R, G);
    else if (sc.id === 'route') routePage(Pn, R, G);
    else if (sc.id === 'rig') rigPage(Pn, R, G);
    else sysPage(Pn, R, G);
  }
  // Photos tucked into the band's frame.
  for (const ph of PHOTOS) photo(bandPanel(K, P, ph.x, ph.v, 0.006), ph);
  // The maker's tag at the passenger's end: stamped steel, riveted on.
  {
    const Pn = bandPanel(K, P, 1.34, 0.085, 0.006);
    Pn.rect(-0.118, -0.050, 0.118, 0.050, T.steelDk, 0.03, 0.002);
    Pn.rect(-0.112, -0.044, 0.112, 0.044, T.steel, 0.06, 0.0026);
    for (const [a, b] of [[-0.104, 0.036], [0.104, 0.036], [-0.104, -0.036], [0.104, -0.036]]) Pn.disc(a, b, 0.0035, T.steelDk, 0, 0.0034);
    Pn.text('KRELL', 0, 0.022, 0.0135, T.stamp, 0, 0.0034);
    Pn.text('BARROW 2076', 0, 0.000, 0.0120, T.stamp, 0, 0.0034);
    Pn.text('4471', 0, -0.022, 0.0120, T.stamp, 0, 0.0034);
  }

  // ── THE CLOCK ── Stuck on the shelf over the dead page, where the Courier's clock was: a black box
  // with a green readout, the hour and minute off the sim's clock.
  {
    const c = curve(sOf(1.06)), base = at(c, GT[0] + 0.030, GT[1] + 0.006);
    const [x, y, z] = base;
    K.box(x - 0.048, y - 0.012, z, x + 0.048, y + 0.014, z + 0.034, 'dash', 0.3, T.clock, 0);
    if (R.hour != null) {
      const Pn = facingPanel(K, [x, y - 0.0125, z + 0.017], 'dash', 0.2);
      const hh = Math.floor(R.hour) % 24, mm = Math.floor((R.hour % 1) * 60);
      Pn.digits(-0.031, -0.012, 0.024, String(hh).padStart(2, '0') + String(mm).padStart(2, '0'), lit ? T.clockLcd : T.clockLcd.map((v) => v * 0.4), true);
    }
  }

  // ── THE KEYS ── A key sinks while pressed, its light eases with the switch, it brightens as the
  // hand comes over it, and a ring flashes when its state changes. Disabled: dark, no hotspot.
  for (const c of keyCells(live)) {
    const Kp = bandPanel(K, P, c.x, KEY_V, 0.004), id = c.key;
    const pressed = !!live && live.press === id, near = !!live && live.hover === id && c.enabled;
    const glow = eased('bw76:glow:' + id, c.on ? 1 : 0, 10), depth = eased('bw76:dip:' + id, pressed ? 0.0015 : 0.005, 30);
    const hand = eased('bw76:near:' + id, near ? 1 : 0, 14);
    const rgb = id === 'key' ? T.green : id === 'horn' ? T.amber : G;
    Kp.rect(-KEY_HW - 0.002, -KEY_HH - 0.002, KEY_HW + 0.002, KEY_HH + 0.002, T.tub, 0, 0.0005);
    Kp.rect(-KEY_HW - 0.002, KEY_HH + 0.0005, KEY_HW + 0.002, KEY_HH + 0.002, G, (lit ? 0.2 : 0) + hand * 0.8, 0.0012);
    Kp.stud(0, 0, KEY_HW, KEY_HH, depth, rgb.map((v, k) => lerp(T.keyOff[k], v, glow * 0.8)), glow * 0.85 + hand * 0.15, 0.0015);
    const ink = c.enabled ? (glow > 0.5 ? [10, 20, 16] : [214, 218, 212]) : [96, 100, 100];
    Kp.text(KEY_NAME[id] || id.toUpperCase(), 0, 0, 0.0105, ink, glow > 0.5 ? 0 : (lit ? 0.6 : 0.2), depth + 0.0025);
    const flash = pressPulse('bw76:key:' + id, !!c.on);
    if (flash > 0.02) Kp.rect(-KEY_HW - 0.005, -KEY_HH - 0.005, KEY_HW + 0.005, KEY_HH + 0.005, HALO, flash * 0.6, 0.0002);
  }

  if (lit && reveal(boot, 0.2) > 0) hud(K, R, G, warn, caution);

  // ── THE HOLOGRAM on the shelf, on a projector whose arc is the fuel left ──
  {
    const c = curve(sOf(xC - 0.06)), base = at(c, GT[0] + 0.055, GT[1] + 0.009);
    holoProjector(K, base, 0.05, 0.05, lit ? R.fuel : 0, R.fuel < 0.15 ? HOLO_RED : HOLO_LINE);
    if (lit && reveal(boot, 0.5) >= 1) holoRig(K, add(base, [0, 0, 0.075]), R, lit);
  }
  hotspotHalo(K, bw76Hotspots(P, live), live);
}
