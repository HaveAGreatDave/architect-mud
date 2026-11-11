// THE ORLOV CONTINENTAL 2076'S CAB: the big rig's cab to the 2076 bar (docs/proposals/hover-rigs.md).
//
// A refit on the stock truck room, as the Courier 2076's is (`P.refit`): the wheel, gate, pedals, doors,
// overhead and seats stay (truckFit in interior-fit.js), so every control and every trinket keeps its
// place. This file brings the board, and it's built for work rather than for show:
//   - a squared dash with a rubber top and a steel lip, a hazard stripe along the passenger's side;
//   - one band of glass in a bolted steel frame, four live pages on it and thirteen rubber keys under it;
//   - a hitch page with the jackknife zone striped off, and the brakes' fade point on the same page;
//   - a projected HUD low in the screen, with the Jake and the clutch mirrored in its corners;
//   - a long hologram of the rig on the shelf that bends at the pin with the real trailer angle;
//   - light lines in the alert colour, pages that boot in turn on the key, keys that light for the hand;
//   - a grab bar across the passenger's side of the dash and a grab handle up the driver's pillar.
//
// The hotspots' ids are CAB_CTL keys (cab-view.js): a truck's click is the shelf button's own click, so
// a key here does exactly what the same switch does in any other cab, or nothing if the truck hasn't
// got it. `live.ctl` says which switches exist and how they stand; a disabled one has no hotspot.
//
// Every readout is a sim value. The room and the dash take the colourway (cab-trim.js EDITION_TRIM is
// the factory's gunmetal and hazard orange; the bench can change it), and the light lines take its glow
// until an alert turns them. Frame as interior-kit.js: shell metres, eye at the origin, +x right,
// +y forward, +z up.
import { makeKit, clamp, lerp, SHINY, TEXTURE, PANE } from './interior-kit.js';
import { hotspotHalo, eased, pressPulse, HALO, bootAge, reveal, alertLight, sweep, lightLine, bandFrame, glassBand,
  holoFrame, holoProjector, lensLamp, wallSec, HOLO_LINE, HOLO_AMBER, HOLO_RED, HUD_AMBER, HUD_RED } from './interior-cockpit-kit.js';
import { loft } from './interior-fit.js';
import { MPH_KMH } from './world-scale.js';

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export const CN76_TRIM = {
  rubber: [22, 23, 25], steel: [92, 97, 106], steelDk: [52, 56, 62], bolt: [150, 156, 166], hazard: [236, 118, 26], hazardDk: [18, 18, 20],
  screen: [6, 10, 12], keyCap: [30, 32, 35], segOff: [26, 30, 32], white: [232, 238, 240], green: [120, 230, 150], red: [235, 60, 48], amber: [255, 176, 64],
  grip: [214, 104, 24],
};
const T = CN76_TRIM;
for (const k of ['rubber', 'keyCap', 'grip']) TEXTURE.set(T[k], 'rubber');
for (const k of ['steel', 'steelDk', 'bolt']) TEXTURE.set(T[k], 'cast');
TEXTURE.set(T.hazard, 'paint'); TEXTURE.set(T.hazardDk, 'paint');
SHINY.set(T.steel, { spec: 0.6, pow: 30 });
SHINY.set(T.bolt, { spec: 0.8, pow: 40 });
SHINY.set(T.screen, { spec: 0.6, pow: 60 });
// The HUD's own white, translucent like the kit's.
const HUD_WHITE = [214, 232, 255];
PANE.set(HUD_WHITE, 0.86);
// The dash top: a heavy rubber pad in the colourway's dash key.
const PAD = { lv: 0.92, spec: 0.16, pow: 8, grain: 0.02, tex: 'rubber' };
// The room's surfaces: rubberised hard parts, vinyl, painted steel door cards, and tread plate on the
// kick panels and the floor.
const ROOM_MATS = {
  hard: { lv: 1.02, spec: 0.30, pow: 16, grain: 0.02, tex: 'rubber' }, soft: { lv: 1.0, spec: 0.22, pow: 10, grain: 0.015, tex: 'leather' },
  card: { lv: 1.16, spec: 0.40, pow: 24, grain: 0.012, tex: 'paint' }, lower: { lv: 0.72, spec: 0.38, pow: 20, grain: 0.02, tex: 'tread' },
  fabric: { lv: 1.45, spec: 0, pow: 1, grain: 0.02, tex: 'fabric' }, floor: { lv: 0.62, spec: 0.40, pow: 22, grain: 0.02, tex: 'tread' },
};

export function continental2076Profile(base) {
  return { ...base, label: 'Continental 2076 cab',
    refit: { tier: 3, dashToy: SHELF_TOY, mats: ROOM_MATS, fit: cn76Fit },
    hotspots(live) { return cn76Hotspots(this, live); } };
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
    glow: Array.isArray(L.glow) && L.glow.length === 3 && L.glow.every(Number.isFinite) ? L.glow : [255, 140, 42],
  };
}

// ── THE DASH ── The band's lower edge runs door to door in the screen's own shallow curve.
const DASH = { xL: -0.57, xR: 1.67, yMid: 0.652, sag: 0.045, z0: -0.415, h: 0.18, lean: 0.36 };
const dashCurve = (P) => (s) => {
  const x = lerp(DASH.xL, DASH.xR, s), q = (x - P.xCentre) / P.halfW;
  const dy = -2 * DASH.sag * q / P.halfW;
  return { p: [x, DASH.yMid - DASH.sag * q * q, DASH.z0], f: norm([-dy, 1, 0]) };
};
const sOf = (x) => (x - DASH.xL) / (DASH.xR - DASH.xL);
const bandPanel = (K, P, x, v, lift = 0.005) => bandFrame(dashCurve(P), DASH.lean).at(K, sOf(x), v, lift);
// The glass's top edge, across the dash and up from its foot.
const GT = [DASH.h * DASH.lean / Math.hypot(1, DASH.lean), DASH.h / Math.hypot(1, DASH.lean)];
const SHELF_Z = DASH.z0 + GT[1] + 0.012;
const SHELF_TOY = [0.92, DASH.yMid + GT[0] + 0.05, SHELF_Z];

// ── THE KEYS ── Along the band's foot, either side of the wheel, in the order the stock banks use.
const KEY_ROW = { left: ['key', 'heads', 'dome', 'jake', 'cruise', 'horn'], right: ['park', 'trailer', 'pump', 'exit', 'latch', 'galley', 'auto'] };
const KEY_NAME = { key: 'KEY', heads: 'LAMPS', dome: 'CAB', jake: 'JAKE', cruise: 'CRUISE', horn: 'HORN',
  park: 'PARK', trailer: 'AIR', pump: 'PUMP', exit: 'EXIT', latch: 'DOORS', galley: 'GALLEY', auto: 'AUTO' };
const KEY_STEP = 0.068, KEY_V = 0.027, KEY_HW = 0.030, KEY_HH = 0.0165;
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
export function cn76Hotspots(P, live) {
  const K = makeKit(() => {});
  return keyCells(live || {}).filter((c) => c.enabled)
    .map((c) => ({ id: c.key, p: bandPanel(K, P, c.x, KEY_V, 0.004).pt(0, 0, 0.01), r: 0.028, kind: 'click' }));
}

// ── THE PAGES ── Panel metres, centred; a page runs ±sc.w across and ±SCREEN_H up.
const SCREENS = [
  { id: 'route', x: -0.345, w: 0.125, boot: 0.3 },
  { id: 'drive', x: -0.03, w: 0.175, boot: 0 },
  { id: 'hitch', x: 0.285, w: 0.122, boot: 0.15 },
  { id: 'sys', x: 0.56, w: 0.135, boot: 0.45 },
];
const SCREEN_H = 0.058, PAGE_V = 0.109;
const LABEL = 0.0115;
const pad = (n, w) => String(Math.round(n)).padStart(w, ' ').slice(-w);
const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function bar(Pn, x0, x1, y, h, frac, rgb, emis = 0.9) {
  Pn.rect(x0, y, x1, y + h, T.segOff, 0, 0.0015);
  if (frac > 0.002) Pn.rect(x0, y, lerp(x0, x1, frac), y + h, rgb, emis, 0.0025);
}
// Hazard stripes across a box on a page: orange and black bands leaning one way.
function stripes(Pn, x0, y0, x1, y1, step, lit, l = 0.002) {
  Pn.rect(x0, y0, x1, y1, T.hazardDk, 0, l);
  const lean = (y1 - y0);
  for (let x = x0 - lean; x < x1; x += step * 2) {
    const a = Math.max(x0, x), b = Math.min(x1, x + step);
    if (b <= a) continue;
    // Clip each band to the box by its two ends; the slant comes from offsetting the top edge.
    const pts = [[a, y0], [b, y0], [Math.min(x1, b + lean), y1], [Math.min(x1, a + lean), y1]];
    Pn.plate(pts, T.hazard, lit ? 0.7 : 0.12, l + 0.0005);
  }
}
// The tach: an arc of segments over the speed, amber then red toward the stop, with the red zone
// striped off below it.
function drivePage(Pn, R, G) {
  const cx = -0.060, cy = -0.046, r0 = 0.066, r1 = 0.083, N = 24;
  for (let i = 0; i < N; i++) {
    const a0 = Math.PI - (i / N) * Math.PI, a1 = Math.PI - ((i + 0.82) / N) * Math.PI, at = (i + 1) / N, on = R.rpm >= at - 0.5 / N;
    const rgb = at > 0.93 ? T.red : at > 0.8 ? T.amber : G;
    Pn.annulus(cx, cy, r0, r1, on ? rgb : T.segOff, on ? 0.95 : 0, 0.0025, 2, a0, a1);
    if (at > 0.86) Pn.annulus(cx, cy, r0 - 0.008, r0 - 0.003, i % 2 ? T.hazard : T.hazardDk, i % 2 ? 0.6 : 0, 0.002, 2, a0, a1);
  }
  Pn.digits(-0.091, -0.040, 0.032, pad(R.kmh, 3), [236, 244, 240], false);
  Pn.text('KM/H', cx, 0.009, LABEL, G, 0.6, 0.003);
  Pn.digits(0.070, -0.050, 0.068, R.gear.padStart(2, ' '), G, false);
  Pn.text('GEAR', 0.108, 0.034, LABEL, G, 0.6, 0.003);
}
// A heading tape across the top, the leg below it and where it ends.
function routePage(Pn, R, G) {
  if (R.elecOut) { Pn.text('NO SIGNAL', 0, 0, 0.014, T.amber, 0.8, 0.003); return; }
  const h = ((R.hdg % 360) + 360) % 360, span = 40, half = 0.108;
  Pn.rect(-half - 0.004, 0.016, half + 0.004, 0.052, [10, 16, 18], 0.1, 0.0015);
  for (let d = Math.ceil((h - span) / 5) * 5; d <= h + span; d += 5) {
    const x = (d - h) / span * half, big = d % 15 === 0;
    Pn.rect(x - 0.0008, 0.016, x + 0.0008, big ? 0.028 : 0.022, G, 0.7, 0.0025);
    const dd = ((d % 360) + 360) % 360;
    if (dd % 45 === 0 && Math.abs(x) < half - 0.012) Pn.text(CARD[dd / 45], x, 0.040, 0.0115, dd === 0 ? T.amber : [236, 244, 240], 0.85, 0.003);
  }
  Pn.plate([[0, 0.016], [0.006, 0.008], [-0.006, 0.008]], T.hazard, 0.9, 0.003);
  Pn.digits(-0.112, -0.018, 0.024, String(Math.round(h) % 360).padStart(3, '0'), G, false);
  Pn.text('HDG', -0.044, -0.008, LABEL, G, 0.6, 0.003);
  if (R.legLeft != null) {
    Pn.digits(0.012, -0.018, 0.024, pad(R.legLeft, 3).slice(-3), [236, 244, 240], false);
    Pn.text('KM', 0.090, -0.008, LABEL, G, 0.6, 0.003);
  }
  bar(Pn, -0.112, 0.112, -0.030, 0.005, R.legFrac, G);
  const aim = String(R.aim || 'NO ROUTE').toUpperCase().replace(/[^A-Z0-9 /-]/g, ' ').slice(0, 18);
  Pn.fitText(aim, 0, -0.046, 0.22, 0.012, [204, 222, 216], 0.6, 0.003);
}
// The hitch: the trailer's angle on an arc with the jackknife zone striped off either end, and the
// brakes' temperature on a bar striped where they start to fade.
const JACK = 40, ARC = 62;
function hitchPage(Pn, R, G) {
  const cx = 0, cy = -0.012, r0 = 0.046, r1 = 0.058, N = 31, lit = R.phi != null;
  for (let i = 0; i < N; i++) {
    const d0 = -ARC + (2 * ARC) * (i / N), d1 = -ARC + (2 * ARC) * ((i + 0.86) / N), mid = (d0 + d1) / 2;
    const a0 = Math.PI / 2 + d0 * Math.PI / 180, a1 = Math.PI / 2 + d1 * Math.PI / 180;
    const jack = Math.abs(mid) > JACK;
    const rgb = jack ? (i % 2 ? T.hazard : T.hazardDk) : T.segOff;
    Pn.annulus(cx, cy, r0, r1, rgb, jack && i % 2 ? (lit ? 0.7 : 0.15) : 0, 0.002, 2, a0, a1);
  }
  if (lit) {
    const d = clamp(R.phi, -ARC, ARC), t = Math.PI / 2 + d * Math.PI / 180, bad = Math.abs(R.phi) > JACK;
    Pn.spoke(cx, cy, t, 0.006, r1 + 0.002, 0.0022, bad ? T.red : [236, 244, 240], 0.95, 0.0035, 0.0008);
    Pn.disc(cx, cy, 0.006, bad ? T.red : G, 0.9, 0.004, 10);
    Pn.text('HITCH ' + Math.round(Math.abs(R.phi)) + ' DEG', 0, -0.027, LABEL, bad ? T.red : G, 0.75, 0.003);
  } else Pn.text('BOBTAIL', 0, -0.027, LABEL, G, 0.75, 0.003);
  const col = R.fading ? T.red : R.brake > 0.42 ? T.amber : G;
  Pn.text('BRAKE', -0.090, -0.047, LABEL, col, 0.7, 0.003);
  const b0 = -0.058, b1 = 0.112, fade = lerp(b0, b1, 0.42);
  stripes(Pn, fade, -0.053, b1, -0.049, 0.006, true, 0.0015);
  if (R.brake > 0.002) Pn.rect(b0, -0.0525, lerp(b0, b1, R.brake), -0.0405, col, 0.9, 0.0028);
  Pn.rect(b0, -0.0485, b1, -0.0405, T.segOff, 0, 0.0016);
}
function sysPage(Pn, R, G) {
  const low = R.fuel < 0.15, fc = low ? T.amber : G;
  Pn.rect(-0.124, -0.040, -0.096, 0.050, T.segOff, 0, 0.0015);
  if (R.fuel > 0.002) Pn.rect(-0.121, -0.037, -0.099, lerp(-0.037, 0.047, R.fuel), fc, 0.9, 0.0025);
  Pn.text('FUEL', -0.110, -0.050, LABEL, fc, 0.7, 0.003);
  const L = R.lamps;
  [['FUEL', L.fuel, T.amber], ['BRAKE', L.brake, T.red], ['JAKE', L.jake, G],
    ['WIPER', L.wipe, G], ['TRAIL', L.trail, T.amber], ['DAMAGE', L.dmg, T.red]].forEach(([name, on, rgb], i) =>
    lensLamp(Pn, -0.036 + (i % 2) * 0.090, 0.034 - (i / 2 | 0) * 0.034, 0.078, 0.026, !!on, rgb, name));
}

// ── THE HUD ── Lines and lettering in the screen, low, nothing on the three sight lines.
function hud(K, R, G, warn, caution) {
  const H = K.panel([0, 0.78, -0.150], [1, 0, 0], [0, 0, 1], 'dash', 0);
  const col = warn ? HUD_RED : caution ? HUD_AMBER : HUD_WHITE, e = 0.9;
  H.text(pad(R.kmh, 3).trim(), -0.140, 0.0, 0.0145, col, e, 0.001);
  H.text('KM/H', -0.140, -0.019, 0.0095, col, 0.6, 0.001);
  H.text(R.gear, 0.140, 0.0, 0.0145, col, e, 0.001);
  H.text('GEAR', 0.140, -0.019, 0.0095, col, 0.6, 0.001);
  // The low controls, mirrored: the Jake's lamp and the clutch's travel.
  H.text('JAKE', -0.222, 0.0, 0.0095, R.jake ? [255, 190, 110] : col, R.jake ? 1 : 0.28, 0.001);
  H.text('CLU', 0.222, 0.006, 0.0095, col, 0.5, 0.001);
  H.rect(0.202, -0.014, 0.242, -0.0115, col, 0.25, 0.001);
  if (R.clutch > 0.01) H.rect(0.202, -0.014, lerp(0.202, 0.242, R.clutch), -0.0115, col, e, 0.0015);
  // The trailer, as a short line under the middle that swings with the hitch.
  if (R.phi != null) {
    const a = clamp(R.phi, -ARC, ARC) * Math.PI / 180;
    H.rect(-0.003, -0.006, 0.003, 0.0, col, 0.7, 0.001);
    H.spoke(0, -0.006, -Math.PI / 2 + a, 0.0, 0.020, 0.0012, Math.abs(R.phi) > JACK ? HUD_RED : col, 0.8, 0.001);
  }
  if (R.legLeft != null && !R.elecOut) H.text(pad(R.legLeft, 3).trim() + ' KM', 0, -0.036, 0.0095, col, 0.55, 0.001);
}

// ── THE HOLOGRAM ── The rig in its own frame, nose forward, turned well round to show its length. A
// small model of the stations the body is built on (concepts/continental-2076.mjs); the box swings
// about the pin with the real angle, and the pads pulse with the revs.
const HSC = 0.215, PIN_F = -0.106;
const hp = (f, g, h) => [g * HSC, (f + 0.24) * HSC, (h - 0.16) * HSC];
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
  const H = holoFrame(K, c, 0, 0, -62);
  const col = R.fading ? HOLO_RED : R.brake > 0.42 ? HOLO_AMBER : HOLO_LINE;
  holoBox(H, 0.042, 0.402, 0.178, 0.03, 0.17, HOLO_LINE);                       // lower body
  for (const s of [-1, 1]) {
    H.line(hp(0.388, s * 0.176, 0.17), hp(0.358, s * 0.164, 0.374));            // the screen's edges
    H.line(hp(0.358, s * 0.164, 0.374), hp(0.058, s * 0.164, 0.374));
    H.line(hp(0.058, s * 0.164, 0.374), hp(0.042, s * 0.166, 0.360));
    H.line(hp(0.042, s * 0.166, 0.360), hp(0.042, s * 0.176, 0.17));
    H.line(hp(0.041, s * 0.164, 0.10), hp(0.041, s * 0.164, 0.414), 0.0011, HOLO_AMBER);   // the stacks
  }
  H.line(hp(0.358, -0.164, 0.374), hp(0.358, 0.164, 0.374));
  H.line(hp(0.058, -0.164, 0.374), hp(0.058, 0.164, 0.374));
  H.line(hp(0.388, -0.12, 0.374), hp(0.388, 0.12, 0.374), 0.0011, HOLO_AMBER);    // the visor
  holoBox(H, -0.176, 0.042, 0.11, 0.05, 0.082, HOLO_LINE);                      // the frame
  // The pads: rings that breathe with the revs (the rate is decoration, the swell is the rpm).
  const pulse = 1 + (lit ? 0.18 * R.rpm * Math.sin(wallSec() * 6) : 0);
  for (const f of [0.330, 0.200, -0.006, -0.112]) for (const s of [-1, 1]) {
    H.ring(hp(f, s * 0.098, 0.012), 0.048 * HSC * pulse, [1, 0, 0], [0, 1, 0], 0.0009, 12, lit ? HOLO_LINE : HOLO_AMBER);
  }
  if (R.phi == null) return;
  const a = R.phi * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  const turn = (f, g) => [PIN_F + (f - PIN_F) * cs - g * sn, (f - PIN_F) * sn + g * cs];
  holoBox(H, -0.878, -0.102, 0.208, 0.075, 0.413, col, turn);
  // The box's own pads, aft.
  for (const f of [-0.79, -0.68]) for (const s of [-1, 1]) {
    const q = turn(f, s * 0.18);
    H.ring(hp(q[0], q[1], 0.03), 0.04 * HSC, [1, 0, 0], [0, 1, 0], 0.0009, 10, col);
  }
}

// ── THE FITTINGS ── Grab bar, grab handle, and the stripe on the passenger's lip.
function grabBar(K, curve, at) {
  const posts = [1.06, 1.46].map((x) => { const c = curve(sOf(x)); return at(c, GT[0] + 0.012, GT[1] + 0.004); });
  const tops = posts.map((p) => add(p, [0, -0.004, 0.06]));
  for (let i = 0; i < 2; i++) K.rod(posts[i], tops[i], 0.008, 'dash', 0.3, T.steel, 0, 6, true);
  K.rod(tops[0], tops[1], 0.011, 'dash', 0.3, T.steel, 0, 8, true);
  // Two rubber grips in the hazard colour.
  for (const t of [0.22, 0.62]) {
    const a = tops[0].map((v, k) => lerp(v, tops[1][k], t)), b = tops[0].map((v, k) => lerp(v, tops[1][k], t + 0.16));
    K.rod(a, b, 0.0135, 'dash', 0.3, T.grip, 0, 8, true);
  }
}
function pillarHandle(K, P) {
  const x = P.xCentre - P.halfW + 0.045;
  const along = (z) => [x, 0.835 - 0.16 * (z + 0.40) / 0.90, z];
  const a = along(-0.12), b = along(0.20), off = [0.004, -0.026, 0];
  K.rod(add(a, off), add(b, off), 0.0075, 'dash', 0.3, T.rubber, 0, 8, true);
  // A hazard band at each end of the grip, where the hand stops.
  for (const t of [0.04, 0.92]) {
    const p = a.map((v, k) => lerp(v, b[k], t) + off[k]), q = a.map((v, k) => lerp(v, b[k], t + 0.04) + off[k]);
    K.rod(p, q, 0.0085, 'dash', 0.3, T.grip, 0, 8, true);
  }
  for (const p of [a, b]) K.rod(add(p, [-0.03, 0, 0]), add(p, off), 0.005, 'dash', 0.3, T.steel, 0, 6, true);
}
function lipStripe(K, P, curve, at) {
  // Short panels along the lip under the band on the passenger's side, each lettered with stripes.
  for (let x = 0.98; x < 1.58; x += 0.1) {
    // Lying on the room's dash top (P.dashZ), just in front of the band's foot: the lip itself is under
    // that surface.
    const c = curve(sOf(x + 0.05)), o = at(c, -0.046, P.dashZ - DASH.z0 + 0.002);
    const r = curve(sOf(x + 0.051)).p.map((v, k) => v - c.p[k]);
    const Pn = K.panel(o, r, [-c.f[0], -c.f[1], 0], 'dash', 0.3);
    Pn.rect(-0.051, -0.012, 0.051, 0.012, T.hazardDk, 0, 0.0016);
    for (let i = -3; i < 3; i++) {
      const u = i * 0.018;
      Pn.plate([[u, -0.012], [u + 0.009, -0.012], [u + 0.018, 0.012], [u + 0.009, 0.012]].map(([a, b]) => [clamp(a, -0.051, 0.051), b]), T.hazard, 0.05, 0.0022);
    }
  }
}

export function cn76Fit(P, live, push) {
  const K = makeKit(push), R = readings(live), G = R.glow, xC = P.xCentre;
  const lit = R.powered, boot = bootAge(live);
  const warn = lit && (R.fading || !!R.lamps.dmg), caution = lit && (R.fuel < 0.15 || R.brake > 0.42);
  const al0 = alertLight(caution, warn), al = { rgb: !caution && !warn ? G : al0.rgb, k: al0.k };
  const lineK = (k) => (lit ? k * al.k : 0.05);

  // ── THE DASH: a squared rubber pad over the top, a steel lip under the band ──
  const curve = dashCurve(P), N = 28;
  const top = [GT, [GT[0] + 0.03, GT[1] + 0.012], [GT[0] + 0.13, GT[1] + 0.012], [GT[0] + 0.15, GT[1] - 0.004], [GT[0] + 0.155, GT[1] - 0.07], [GT[0] + 0.16, -0.02]];
  const at = (c, f, z) => [c.p[0] + c.f[0] * f, c.p[1] + c.f[1] * f, c.p[2] + z];
  const ss = Array.from({ length: N + 1 }, (_, i) => i / N);
  loft(push, ss.map((s) => { const c = curve(s); return top.map(([f, z]) => at(c, f, z)); }), 'dash', 0.26, true, PAD, 1);
  sweep(K, ss.map((s) => { const c = curve(s); return [[0, 0], [-0.020, -0.004], [-0.024, -0.010], [-0.024, -0.054], [-0.006, -0.064]].map(([f, z]) => at(c, f, z)); }), 'dash', 0.12, T.steel);
  // The band's frame: a steel rail along its head with bolt heads in it.
  const head = (s, d = 0) => { const c = curve(s); return at(c, GT[0] - 0.002 + d, GT[1] + 0.004); };
  sweep(K, ss.map((s) => [head(s, -0.012), head(s, 0.008), add(head(s, 0.008), [0, 0, 0.008]), add(head(s, -0.012), [0, 0, 0.008])]), 'dash', 0.2, T.steelDk);
  for (let i = 1; i < 14; i++) K.rod(add(head(i / 14, -0.002), [0, 0, 0.008]), add(head(i / 14, -0.002), [0, 0, 0.012]), 0.004, 'dash', 0.2, T.bolt, 0, 6, true);
  lightLine(K, ss.map((s) => { const c = curve(s); return at(c, -0.022, -0.007); }), 0.0026, al.rgb, lineK(0.85));
  // The same line carried back along each door and under the sill, so the alert reaches the whole cab.
  for (const x of [P.xCentre - P.halfW + 0.012, P.xCentre + P.halfW - 0.012]) {
    lightLine(K, [[x, 0.46, -0.335], [x, -0.30, -0.335]], 0.0022, al.rgb, lineK(0.5));
    lightLine(K, [[x, 0.46, P.floor + 0.05], [x, -0.30, P.floor + 0.05]], 0.0022, al.rgb, lineK(0.22));
  }
  lipStripe(K, P, curve, at);
  grabBar(K, curve, at);
  pillarHandle(K, P);

  // ── THE BAND ──
  glassBand(K, curve, { h: DASH.h, lean: DASH.lean, segs: N, lit, light: al.rgb, lightK: lineK(1), substrate: T.screen });
  for (const sc of SCREENS) {
    const Pn = bandPanel(K, P, sc.x, PAGE_V, 0.012), up = reveal(boot, sc.boot);
    if (!lit || up <= 0) continue;
    if (up < 1) {                                       // the boot: a striped wipe across, the page behind it
      const x = lerp(-sc.w, sc.w, up);
      Pn.rect(-sc.w, -SCREEN_H, x, SCREEN_H, T.screen, 0.3 * up, 0.001);
      stripes(Pn, x - 0.012, -SCREEN_H, x, SCREEN_H, 0.004, true, 0.002);
      continue;
    }
    Pn.rect(-sc.w + 0.004, SCREEN_H - 0.0035, sc.w - 0.004, SCREEN_H - 0.0015, al.rgb, 0.85, 0.0018);
    if (sc.id === 'drive') drivePage(Pn, R, G);
    else if (sc.id === 'route') routePage(Pn, R, G);
    else if (sc.id === 'hitch') hitchPage(Pn, R, G);
    else sysPage(Pn, R, G);
  }
  // The clock and the maker's plate at the passenger's end.
  if (lit && R.hour != null && reveal(boot, 0.6) >= 1) {
    const Pn = bandPanel(K, P, 1.0, PAGE_V, 0.012), hh = Math.floor(R.hour) % 24, mm = Math.floor((R.hour % 1) * 60);
    Pn.digits(-0.07, -0.022, 0.044, String(hh).padStart(2, '0') + String(mm).padStart(2, '0'), G, false);
  }
  {
    const Pn = bandPanel(K, P, 1.34, 0.085, 0.006);
    Pn.rect(-0.118, -0.042, 0.118, 0.042, T.steel, 0.04, 0.002);
    Pn.rect(-0.110, -0.034, 0.110, 0.034, T.steelDk, 0.02, 0.0026);
    for (const [u, v] of [[-0.110, -0.034], [0.110, -0.034], [0.110, 0.034], [-0.110, 0.034]]) Pn.disc(u * 1.04, v * 1.12, 0.0045, T.bolt, 0.05, 0.003, 8);
    Pn.rect(-0.104, -0.031, 0.104, -0.026, T.hazard, 0.15, 0.003);
    Pn.text('ORLOV', 0, 0.012, 0.0145, T.white, 0.2, 0.0034);
    Pn.text('CONTINENTAL 2076', 0, -0.012, 0.0115, T.white, 0.15, 0.0034);
  }

  // ── THE KEYS ── Rubber caps in a steel guard: a key sinks while pressed, its light strip eases with
  // the switch, it brightens as the hand comes over it, and a ring flashes when its state changes.
  // Disabled: dark, no hotspot.
  for (const c of keyCells(live)) {
    const Kp = bandPanel(K, P, c.x, KEY_V, 0.004), id = c.key;
    const pressed = !!live && live.press === id, near = !!live && live.hover === id && c.enabled;
    const glow = eased('cn76:glow:' + id, c.on ? 1 : 0, 10), depth = eased('cn76:dip:' + id, pressed ? 0.0015 : 0.0055, 30);
    const hand = eased('cn76:near:' + id, near ? 1 : 0, 14);
    const rgb = id === 'key' ? T.green : id === 'horn' ? T.amber : G;
    Kp.rect(-KEY_HW - 0.004, -KEY_HH - 0.004, KEY_HW + 0.004, KEY_HH + 0.004, T.steelDk, 0, 0.0005);
    Kp.rect(-KEY_HW + 0.004, KEY_HH - 0.0035, KEY_HW - 0.004, KEY_HH - 0.0012, rgb.map((v, k) => lerp(T.segOff[k], v, glow)), glow * 0.95 + hand * 0.05, depth + 0.0012);
    Kp.rect(-KEY_HW - 0.004, -KEY_HH - 0.004, KEY_HW + 0.004, -KEY_HH - 0.0025, G, (lit ? 0.15 : 0) + hand * 0.85, 0.0012);
    Kp.stud(0, 0, KEY_HW, KEY_HH, depth, T.keyCap.map((v, k) => lerp(v, rgb[k], glow * 0.25)), glow * 0.2 + hand * 0.15, 0.0015);
    const ink = c.enabled ? (glow > 0.5 ? [255, 236, 210] : [214, 222, 220]) : [96, 102, 104];
    Kp.text(KEY_NAME[id] || id.toUpperCase(), 0, -0.002, 0.0105, ink, glow > 0.5 ? 0.8 : (lit ? 0.6 : 0.2), depth + 0.0025);
    const flash = pressPulse('cn76:key:' + id, !!c.on);
    if (flash > 0.02) Kp.rect(-KEY_HW - 0.006, -KEY_HH - 0.006, KEY_HW + 0.006, KEY_HH + 0.006, HALO, flash * 0.6, 0.0002);
  }

  if (lit && reveal(boot, 0.2) > 0) hud(K, R, G, warn, caution);

  // ── THE HOLOGRAM on the shelf, on a projector whose arc is the fuel left ──
  {
    const c = curve(sOf(xC + 0.14)), base = at(c, GT[0] + 0.10, GT[1] + 0.013);
    holoProjector(K, base, 0.05, 0.055, lit ? R.fuel : 0, R.fuel < 0.15 ? HOLO_RED : HOLO_LINE);
    if (lit && reveal(boot, 0.5) >= 1) holoRig(K, add(base, [0, 0, 0.068]), R, lit);
  }
  hotspotHalo(K, cn76Hotspots(P, live), live);
}
