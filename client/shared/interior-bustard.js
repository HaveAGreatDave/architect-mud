// THE GARROW BUSTARD'S COCKPIT: the inside of the muscle car, as geometry.
//
// The Bustard is Garrow Motor Works' two-seat mini VTOL (docs/proposals/hover-cars.md), and the
// cockpit is what a night shift would build: a flat steel dash with a painted top, a ribbon
// speedometer the width of the wheel, a tachometer for the fans bolted on top of the dash where a
// drag car carries one, rocker switches, square push buttons, a deep-dish steel wheel, high-backed
// vinyl buckets with harnesses, a roll hoop behind them and a pistol-grip lever on the floor that
// is the lift.
//
// ⚠ THE ROOM IS THE EXTERIOR'S BODY: client/shared/cabin-bustard.js states it, and
// interior-hovercar-kit.js builds the wall, the glass, the floor and the doors off it. Nothing about
// the shape of the cabin is typed here.
//
// ⚠ EVERY CONTROL DRAWN WORKS (docs/reference/cockpit-lettering.md). The rim rolls and pitches the
// aircraft (the 'yoke' hotspot, dragged), the floor lever is the lift (the 'throttle' hotspot,
// dragged), the four rockers are the four circuits the sim has, the four square buttons are HOVER,
// LOCK, BOOST and PIT (merlin-modes.js), the chart is the GPS, the HUD knob steps the HUD's colour
// and each door's strap works the doors. Everything is lettered.
//
// Pure: no clock, no camera, no DOM. `live` arrives as an argument.
import { brandTrim } from './interior-brands.js';
import { makeKit, C as KC, clamp, lerp, SHINY, TEXTURE, xfTurn } from './interior-kit.js';
import { memoPart } from './interior-memo.js';
import { hotspotHalo, panelGps, gpsHotspot, lensLamp, eased, pressPulse, HALO, bootAge, reveal, alertLight,
  lightLine, bandFrame, glassBand, windscreenHud, hudTint } from './interior-cockpit-kit.js';
import { MESH_ROWS } from './vehicle-meshes.js';
import { BUSTARD } from './cabin-bustard.js';
import { hoverCarProfile, readings, night, panelOn, onRoad, driveWord, driveLights, switchOn, doorHotspots, outHoloDraw,
  yawPedals, overhead, roomHalfW, fancyText, fancyDigits, TAU, DEG, add, sub, mul, cross, norm } from './interior-hovercar-kit.js';

// ── THE STYLE ────────────────────────────────────────────────────────────────
// Garrow's black vinyl and bare steel, with the body's orange on the dash top and down the seats.
export const BUSTARD_TRIM = {
  lining: [40, 40, 42], liningDk: [28, 28, 30], headliner: [34, 34, 36],
  carbon: [64, 66, 70], carbonLt: [96, 100, 106], tub: [22, 22, 24],
  vinyl: [26, 26, 28], vinylDk: [16, 16, 18], paint: [206, 84, 24], paintDk: [150, 58, 16],
  steel: [150, 154, 160], steelDk: [86, 90, 96], weld: [112, 120, 138],
  mat: [24, 24, 26], matEdge: [14, 14, 16],
  face: [10, 10, 12], ink: [232, 236, 244], bezelBlk: [12, 12, 14],
  glow: [224, 238, 255], glowDim: [84, 92, 108], screen: [8, 9, 12],
  red: [235, 60, 48], amber: [255, 176, 64], marker: [255, 196, 40], belt: [30, 30, 32], bottle: [190, 30, 26],
};
const T = BUSTARD_TRIM;
for (const k of ['lining', 'liningDk', 'vinyl', 'vinylDk']) TEXTURE.set(T[k], 'leather');
TEXTURE.set(T.headliner, 'fabric');
for (const k of ['carbon', 'carbonLt', 'steel', 'steelDk']) TEXTURE.set(T[k], 'brushed');
TEXTURE.set(T.weld, 'cast');
for (const k of ['paint', 'paintDk', 'bottle']) TEXTURE.set(T[k], 'paint');
for (const k of ['tub', 'mat', 'matEdge']) TEXTURE.set(T[k], 'rubber');
TEXTURE.set(T.belt, 'fabric');
SHINY.set(T.screen, { spec: 0.6, pow: 60 });
brandTrim(T, 'bustard', TEXTURE, SHINY);
SHINY.set(T.steel, { spec: 0.6, pow: 26 });
SHINY.set(T.steelDk, { spec: 0.45, pow: 20 });
SHINY.set(T.paint, { spec: 0.55, pow: 40 });
SHINY.set(T.vinyl, { spec: 0.3, pow: 14 });
SHINY.set(T.face, { spec: 0.5, pow: 50 });

// Garrow stamps its plates in a heavy slab; small switch labels stay in the legend face.
const F_SLAB = 'alfaslab';

// ── THE WHEEL ────────────────────────────────────────────────────────────────
// Deep-dish: a thick vinyl rim 35 cm across, its boss set 7 cm back down three slotted steel spokes.
// Turning it rolls it up to 90 degrees each way; in the air pushing and pulling slide it 5 cm along
// the column; on the road that travel is locked and it only turns.
const WHEEL = { c: [0, 0.44, -0.31], r: 0.175, tube: 0.019, dish: 0.07, turn: 1.55, slide: 0.05 };
const WHEEL_AXIS = norm([0, -0.92, 0.39]);
function wheelAt(R) {
  const a = WHEEL_AXIS, c = add(WHEEL.c, mul(a, onRoad(R) ? 0 : R.elev * WHEEL.slide));
  const u0 = [1, 0, 0], v0 = norm(cross(a, u0));
  const th = R.ail * WHEEL.turn, ct = Math.cos(th), st = Math.sin(th);
  const u = norm(sub(mul(u0, ct), mul(v0, st))), v = norm(add(mul(v0, ct), mul(u0, st)));
  const P = (x, y, z = 0) => add(add(add(c, mul(u, x)), mul(v, y)), mul(a, z));
  return { c, a, u, v, P, th };
}
const WHEEL_REST = wheelAt({ ail: 0, elev: 0 });

// ── THE LIFT LEVER ───────────────────────────────────────────────────────────
// A pistol grip on a steel shaft through a slotted plate on the tunnel: back is no lift, forward is
// all of it. Its place is one function, read by the drawing and the hotspot both.
const LEVER = { y: 0.2, len: 0.26, back: -0.5, fore: 0.5 };
function leverAt(P, R) {
  const pivot = [P.xCentre, LEVER.y, P.hc.zF + 0.27], th = lerp(LEVER.back, LEVER.fore, R.thr);
  const dir = [0, Math.sin(th), Math.cos(th)];
  return { pivot, dir, end: add(pivot, mul(dir, LEVER.len)) };
}

// ── THE DASH ─────────────────────────────────────────────────────────────────
// A flat steel board, nearly upright, across the cabin. Everything on it is placed along it by x and
// up it by v (metres above its foot).
const DASH = { yMid: 0.72, sag: 0.05, z0: -0.47, h: 0.22, lean: 0.1 };
function dashOf(P) {
  if (P.hc.dash) return P.hc.dash;
  const xC = P.xCentre, half = Math.min(roomHalfW(P, DASH.yMid - DASH.sag, DASH.z0 + DASH.h + 0.03, 0.04), roomHalfW(P, DASH.yMid - DASH.sag, DASH.z0, 0.04));
  const xL = xC - half, xR = xC + half;
  const curve = (s) => {
    const x = lerp(xL, xR, s), q = (x - xC) / half;
    return { p: [x, DASH.yMid - DASH.sag * q * q, DASH.z0], f: norm([2 * DASH.sag * q / half, 1, 0]) };
  };
  const sOf = (x) => (x - xL) / (xR - xL), F = bandFrame(curve, DASH.lean);
  return (P.hc.dash = { xL, xR, half, curve, sOf, F, at: (K, x, v, lift = 0.005) => F.at(K, sOf(x), v, lift) });
}
// What's on the board, by x and v. The ribbon speedometer across the top in front of the driver;
// under it the height counter, the two bar gauges and the warnings; the drive buttons in a block of
// four to the left of the wheel; the chart and the rockers in the middle; the HUD knob on the right.
const RIBBON = { v: 0.172, hw: 0.125, hh: 0.02, max: 240 };
const DRIVE = [
  { id: 'hover', name: 'HOVER', x: -0.214, v: 0.142 }, { id: 'lock', name: 'LOCK', x: -0.16, v: 0.142 },
  { id: 'boost', name: 'BOOST', x: -0.214, v: 0.086 }, { id: 'pit', name: 'PIT', x: -0.16, v: 0.086 },
];
const ROCKERS = (xC) => [['master', 'START'], ['land', 'LIGHTS'], ['panel', 'PANEL'], ['dome', 'CABIN']].map(([id, name], i) => ({ id, name, x: xC - 0.112 + i * 0.054 }));
const V_ROCK = 0.052, V_CHART = 0.15, CHART = { hw: 0.056, hh: 0.042 }, HUD = { x: 0.2, v: 0.1 };
// The tachometer on top of the dash, leaning back at the driver.
function tachAt(P) {
  const D = dashOf(P), c = D.curve(D.sOf(0)), o = [0, c.p[1] + 0.012, DASH.z0 + DASH.h + 0.058];
  const u = norm([0, 0.18, 1]), r = [1, 0, 0], n = norm(cross(r, u));
  return { o, r, u, n: n[1] < 0 ? n : mul(n, -1), rad: 0.043 };
}

function bustardHotspots(P, live) {
  const R = readings(live), K = makeKit(() => {}), D = dashOf(P), xC = P.xCentre, out = [];
  for (const d of DRIVE) out.push({ id: 'ck:' + d.id, p: D.at(K, d.x, d.v).pt(0, 0, 0.012), r: 0.023, kind: 'click' });
  for (const t of ROCKERS(xC)) out.push({ id: 'ck:' + t.id, p: D.at(K, t.x, V_ROCK).pt(0, 0, 0.012), r: 0.021, kind: 'click' });
  out.push(gpsHotspot(D.at(K, xC, V_CHART, 0.008), 0, 0, 0.046));
  out.push({ id: 'ck:hud', p: D.at(K, HUD.x, HUD.v).pt(0, 0, 0.026), r: 0.026, kind: 'click' });
  const Wh = wheelAt(R);
  out.push({ id: 'yoke', p: Wh.P(WHEEL.r * 0.94, WHEEL.r * 0.2, 0.01), r: 0.05, kind: 'yoke' });
  const lv = leverAt(P, R);
  out.push({ id: 'throttle', p: add(lv.end, mul(lv.dir, 0.03)), r: 0.045, kind: 'throttle' });
  out.push(...doorHotspots(P, live));
  return out;
}

// The cabin's own light: the chart, the ribbon and the tach spill a cold white on the steel, with power.
function bustardGlows(P, live) {
  const R = readings(live);
  if (!R.powered) return [];
  const K = makeKit(() => {}), D = dashOf(P), up = reveal(bootAge(live), 0.3);
  if (up <= 0) return [];
  const tc = tachAt(P);
  return [
    { p: D.at(K, P.xCentre, V_CHART).pt(0, 0, 0.05), r: 0.2, rgb: T.glow, k: up * 0.6 },
    { p: D.at(K, 0, RIBBON.v).pt(0, 0, 0.05), r: 0.26, rgb: T.ink, k: up * (panelOn(R) ? 0.6 : 0.15) },
    { p: add(tc.o, mul(tc.n, 0.05)), r: 0.12, rgb: T.ink, k: up * (panelOn(R) ? 0.5 : 0.1) },
    { p: D.at(K, HUD.x, HUD.v).pt(0, 0, 0.05), r: 0.09, rgb: hudTint(R.L.hudTint).line, k: 0.8 },
  ];
}

// ── THE PROFILE ──────────────────────────────────────────────────────────────
export function bustardProfile(doc = MESH_ROWS.bustard) {
  return hoverCarProfile(BUSTARD, doc, {
    label: 'Garrow Bustard', tag: 'bu', fN: 0.38,
    tones: { headliner: T.headliner, upper: T.lining, mid: T.liningDk, lower: T.tub, doorUpper: T.lining, doorLower: T.vinylDk,
      reveal: T.steelDk, seal: T.glowDim, firewall: T.steelDk, floor: T.mat, floorEdge: T.matEdge, floorLine: null,
      sill: T.steel, sillLine: T.glow, seam: T.steelDk },
    sillW: 0.08, sillH: 0.1,
    dashY: DASH.yMid - 0.08, dashZ: DASH.z0 + 0.1, seatZ: 0.17, seatHalf: 0.25, seatY: [-0.26, 0.2],
    floods: (xC) => [{ p: [xC * 0.5, 0.5, -0.3], r: 0.5 }, { p: [xC, -0.05, 0.1], r: 0.6 }],
    floodGain: 1.7, glare: 0.2,
    doorCard, roomFit, seats, fit: bustardFit, hotspots: bustardHotspots, glows: bustardGlows,
  });
}

// ── THE DOOR CARD: flat vinyl, a steel kick plate, a webbing strap for a pull, three rivets ──
function doorCard({ K, S, A, s, D, pull }) {
  // The kick plate along the foot of the card.
  const k0 = S(D.f[0] + 0.05, A(-30), 0.008), k1 = S(D.f[1] - 0.08, A(-30), 0.008);
  K.rod(k0, k1, 0.03, 'pil', 0.1, T.steel, 0, 4, false);
  for (let i = 0; i <= 4; i++) { const q = S(lerp(D.f[0] + 0.07, D.f[1] - 0.1, i / 4), A(-30), 0.0); K.rod(q, S(lerp(D.f[0] + 0.07, D.f[1] - 0.1, i / 4), A(-30), 0.04), 0.005, 'pil', 0.3, T.weld, 0, 6); }
  // A painted rail along the top of the card, under the glass.
  const cap = [];
  for (let i = 0; i <= 8; i++) cap.push(S(lerp(D.f[0] + 0.03, D.f[1] - 0.04, i / 8), A(BUSTARD.glass.side.a[0] - 4), 0.01));
  for (let i = 1; i < cap.length; i++) K.rod(cap[i - 1], cap[i], 0.011, 'pil', 0.1, T.paint, 0, 5, false);
  // The pull: a loop of webbing bolted to the card near its back edge, where a scissor door latches.
  const p0 = S(D.f[0] + 0.1, A(4), 0.012), p1 = S(D.f[0] + 0.1, A(-12), 0.012), mid = S(D.f[0] + 0.1, A(-4), 0.05);
  K.rod(p0, mid, 0.008, 'pil', 0.1, T.paint, 0, 4);
  K.rod(mid, p1, 0.008, 'pil', 0.1, T.paint, 0, 4);
  for (const q of [p0, p1]) K.rod(q, S(D.f[0] + 0.1, A(q === p0 ? 4 : -12), 0.0), 0.011, 'pil', 0.3, T.steel, 0, 8);
  pull(mid);
}

// ── THE ROOM'S OWN FITTINGS: a braced steel firewall, the roll hoop, an extinguisher, the plate ──
function roomFit({ K, xC, zF, yB }) {
  const y = yB + 0.02;
  // The cross brace on the firewall.
  K.rod([xC - 0.42, y, zF + 0.12], [xC + 0.42, y, zF + 0.7], 0.014, 'post', 0.2, T.steel, 0, 6);
  K.rod([xC + 0.42, y, zF + 0.12], [xC - 0.42, y, zF + 0.7], 0.014, 'post', 0.2, T.steel, 0, 6);
  for (const sx of [-1, 1]) K.rod([xC + sx * 0.42, y, zF + 0.12], [xC + sx * 0.42, y, zF + 0.7], 0.004, 'post', 0.3, T.weld, 0, 5);
  // The roll hoop: up from the floor behind each seat and across under the roof.
  const hy = yB + 0.07, hz = zF + 0.8, hw = 0.42;
  K.rod([xC - hw, hy, zF], [xC - hw, hy, hz - 0.06], 0.02, 'post', 0.1, T.steel, 0, 10);
  K.rod([xC + hw, hy, zF], [xC + hw, hy, hz - 0.06], 0.02, 'post', 0.1, T.steel, 0, 10);
  K.rod([xC - hw, hy, hz - 0.06], [xC - hw + 0.07, hy, hz], 0.02, 'post', 0.1, T.steel, 0, 10);
  K.rod([xC + hw, hy, hz - 0.06], [xC + hw - 0.07, hy, hz], 0.02, 'post', 0.1, T.steel, 0, 10);
  K.rod([xC - hw + 0.07, hy, hz], [xC + hw - 0.07, hy, hz], 0.02, 'post', 0.1, T.steel, 0, 10);
  // The extinguisher, strapped low on the firewall between the seats.
  K.rod([xC, y + 0.04, zF + 0.1], [xC, y + 0.04, zF + 0.36], 0.04, 'post', 0.1, T.bottle, 0, 12);
  K.rod([xC, y + 0.04, zF + 0.36], [xC, y + 0.04, zF + 0.4], 0.015, 'post', 0.3, T.steel, 0, 8);
  K.rod([xC - 0.042, y + 0.04, zF + 0.24], [xC + 0.042, y + 0.04, zF + 0.24], 0.006, 'post', 0.3, T.steelDk, 0, 6);
  // The maker's plate, stamped.
  const Pp = K.panel([xC, y + 0.012, zF + 0.6], [1, 0, 0], [0, 0, 1], 'post', 0.2);
  Pp.rect(-0.07, -0.02, 0.07, 0.02, T.steel, 0.03, 0.001);
  for (const [a, b] of [[-0.062, -0.013], [0.062, -0.013], [-0.062, 0.013], [0.062, 0.013]]) Pp.disc(a, b, 0.003, T.steelDk, 0, 0.002, 6);
  fancyText(Pp, 'GARROW', 0, 0, 0.014, T.bezelBlk, 0, 0.003, F_SLAB, 0.1);
}

// ── THE SEATS: high-backed vinyl buckets on steel frames, an orange stripe, a four-point harness ──
function seats(P, push) {
  const K = makeKit(push, false);
  for (const cx of [0, 2 * P.xCentre]) {
    const h = P.seatHalf, [y0, y1] = P.seatY, sz = P.seatZ, zF = P.hc.zF;
    for (const sx of [-1, 1]) K.box(cx + sx * 0.15 - 0.012, y0, zF, cx + sx * 0.15 + 0.012, y1 - 0.04, zF + 0.025, 'seat', 0.2, T.steel);
    K.box(cx - h + 0.02, y0 + 0.02, zF + 0.025, cx + h - 0.02, y1 - 0.03, sz - 0.07, 'seat', -0.25, T.steelDk);
    K.box(cx - h, y0, sz - 0.07, cx + h, y1, sz, 'seat', 0.02, T.vinyl);
    K.box(cx - 0.05, y0 + 0.01, sz, cx + 0.05, y1 - 0.005, sz + 0.003, 'seat', 0.1, T.paint);
    for (const sx of [-1, 1]) K.box(cx + sx * h - (sx > 0 ? 0.055 : 0), y0, sz, cx + sx * h + (sx < 0 ? 0.055 : 0), y1, sz + 0.07, 'seat', 0.04, T.vinyl);
    // The back: one tall shell to the top of your head, leaning 12 degrees, with two harness slots.
    const lean = 0.2, bb = [cx, y0 + 0.01, sz], up = [0, -Math.sin(lean), Math.cos(lean)], fw = [0, Math.cos(lean), Math.sin(lean)];
    const bH = 0.62, bc = add(bb, mul(up, bH / 2));
    K.obox(add(bc, mul(fw, -0.05)), [1, 0, 0], up, fw, h, bH / 2, 0.04, 'seat', -0.04, T.vinyl);
    K.obox(add(bc, mul(fw, -0.008)), [1, 0, 0], up, fw, 0.05, bH / 2 - 0.02, 0.002, 'seat', 0.1, T.paint);
    for (const sx of [-1, 1]) {
      K.obox(add(add(bb, mul(up, bH * 0.36)), [sx * (h - 0.03), 0, 0]), [1, 0, 0], up, fw, 0.03, bH * 0.3, 0.07, 'seat', 0.0, T.vinyl);
      K.obox(add(add(bb, mul(up, bH - 0.14)), [sx * 0.085, 0, 0]), [1, 0, 0], up, fw, 0.022, 0.012, 0.045, 'seat', -0.3, T.vinylDk);
    }
    // The harness: two shoulder straps through the slots, two laps, a steel buckle.
    const top = add(bb, mul(up, bH - 0.14)), buck = [cx, y1 - 0.2, sz + 0.1];
    for (const sx of [-1, 1]) {
      K.rod(add(add(top, mul(fw, 0.03)), [sx * 0.085, 0, 0]), add(buck, [sx * 0.03, 0, 0.03]), 0.016, 'seat', 0.05, T.belt, 0, 4);
      K.rod([cx + sx * (h - 0.05), y0 + 0.08, sz + 0.03], add(buck, [sx * 0.03, 0, -0.01]), 0.016, 'seat', 0.05, T.belt, 0, 4);
    }
    K.box(buck[0] - 0.03, buck[1] - 0.01, buck[2] - 0.025, buck[0] + 0.03, buck[1] + 0.01, buck[2] + 0.025, 'seat', 0.3, T.steel);
  }
}

// ── THE FIT-OUT ──────────────────────────────────────────────────────────────
function bustardFit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live);
  const zF = P.hc.zF, xC = P.xCentre, D = dashOf(P);
  const lit = R.powered, panel = panelOn(R), boot = bootAge(live);
  const amb = lit ? (night(R) ? 1 : 0.55) * (R.dome ? 1.2 : 1) : 0.05;
  const warn = lit && (R.hull < 0.3 || R.stall), caution = lit && R.fuel < 0.15;
  const al = alertLight(caution, warn, T.line), lineK = (k) => (lit ? k * al.k : 0.05);
  const inkK = panel ? 0.8 : lit ? 0.42 : 0.12;
  // ⚠ THE PARTS THAT DON'T MOVE ARE BUILT ONCE (interior-memo.js memoPart).
  const part = (id, S, fn) => memoPart(push, 'bu:' + id, S, (S2, rec) => fn(makeKit(rec), S2), null);

  // ── THE BOARD: steel, a painted top rail, a weld bead along its foot, bolts in its corners ──
  part('board', { line: al.rgb, k: lineK(0.8), panel }, (K, S) => {
    glassBand(K, D.curve, { h: DASH.h, lean: DASH.lean, segs: 22, lit: false, substrate: T.carbonLt });
    const N = 22, top = [], foot = [];
    for (let i = 0; i <= N; i++) { top.push(D.F.P(i / N, DASH.h + 0.014, 0.02)); foot.push(D.F.P(i / N, -0.005, 0.004)); }
    for (let i = 1; i <= N; i++) K.rod(top[i - 1], top[i], 0.03, 'dash', 0.05, T.paint, 0, 6, false);
    for (let i = 1; i <= N; i++) K.rod(foot[i - 1], foot[i], 0.005, 'dash', 0.3, T.weld, 0, 5, false);
    lightLine(K, foot.map((q) => add(q, [0, -0.004, -0.012])), 0.003, S.line, S.k);
    // The deck from the rail forward to the foot of the screen: painted, falling with the bonnet.
    const y0 = DASH.yMid - DASH.sag * 0.2 + 0.02, zT = DASH.z0 + DASH.h + 0.03, rows = [];
    for (let i = 0; i <= 5; i++) { const y = lerp(y0, y0 + 0.36, i / 5), z = zT - 0.17 * (i / 5), hw = roomHalfW(P, y, z, 0.03); rows.push([[xC - hw, y, z], [xC + hw, y, z]]); }
    for (let i = 1; i < rows.length; i++) K.face([rows[i - 1][0], rows[i - 1][1], rows[i][1], rows[i][0]], [0, 0, 1], 'dash', -0.2, T.paintDk);
    // The struts under it.
    for (const x of [xC - 0.32, xC + 0.32]) K.rod(D.F.P(D.sOf(x), 0.02, -0.03), [x, DASH.yMid - 0.02, zF + 0.03], 0.016, 'dash', 0.1, T.steelDk, 0, 6);
    // The passenger's side: a grab bar on two stanchions and the car's name stamped in a plate.
    const Pg = D.at(K, 2 * xC - 0.02, 0.11, 0.004);
    Pg.rect(-0.12, -0.03, 0.12, 0.03, T.steel, 0.03, 0.001);
    for (const [a, b] of [[-0.11, -0.022], [0.11, -0.022], [-0.11, 0.022], [0.11, 0.022]]) Pg.disc(a, b, 0.004, T.steelDk, 0, 0.002, 6);
    fancyText(Pg, 'BUSTARD', 0, 0, 0.024, T.bezelBlk, S.panel ? 0.05 : 0, 0.003, F_SLAB, 0.2);
    const g0 = Pg.pt(-0.11, -0.07, 0.045), g1 = Pg.pt(0.11, -0.07, 0.045);
    K.rod(g0, g1, 0.011, 'dash', 0.3, T.steel, 0, 8);
    for (const [q, a] of [[g0, -0.11], [g1, 0.11]]) K.rod(q, Pg.pt(a, -0.07, 0), 0.008, 'dash', 0.3, T.steelDk, 0, 6);
    // Two slotted vents at the board's ends.
    for (const x of [D.xL + 0.07, D.xR - 0.05]) {
      const Pv = D.at(K, x, 0.17, 0.004);
      Pv.rect(-0.034, -0.02, 0.034, 0.02, [8, 8, 10], 0, 0.0005);
      for (let i = -2; i <= 2; i++) Pv.rect(-0.03, i * 0.008 - 0.0022, 0.03, i * 0.008 + 0.0022, T.steelDk, 0, 0.002);
    }
    // The ribbon's housing, the gauges' plate, the drive block's plate and the rockers' plate.
    const Pr = D.at(K, 0, RIBBON.v, 0.003);
    Pr.rect(-RIBBON.hw - 0.012, -RIBBON.hh - 0.02, RIBBON.hw + 0.012, RIBBON.hh + 0.012, T.steelDk, 0.02, 0.0005);
    Pr.rect(-RIBBON.hw - 0.004, -RIBBON.hh - 0.014, RIBBON.hw + 0.004, RIBBON.hh + 0.004, T.face, 0, 0.001);
    for (let kt = 0; kt <= RIBBON.max; kt += 20) {
      const x = lerp(-RIBBON.hw, RIBBON.hw, kt / RIBBON.max), big = kt % 40 === 0;
      Pr.rect(x - (big ? 0.0012 : 0.0007), RIBBON.hh - (big ? 0.016 : 0.01), x + (big ? 0.0012 : 0.0007), RIBBON.hh, kt >= 220 ? T.red : T.ink, S.panel ? 0.7 : 0.3, 0.002);
      if (big) Pr.fitText(String(kt), x, -RIBBON.hh - 0.006, 0.03, 0.0085, kt >= 220 ? T.red : T.ink, S.panel ? 0.7 : 0.35, 0.002);
    }
    for (const [x, v, hw2, hh2] of [[-0.187, 0.114, 0.058, 0.062], [xC - 0.031, V_ROCK, 0.115, 0.036], [0, 0.074, 0.126, 0.05]]) {
      const Pq = D.at(K, x, v, 0.003);
      Pq.rect(-hw2, -hh2, hw2, hh2, T.steelDk, 0.02, 0.0005);
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) Pq.disc(a * (hw2 - 0.007), b * (hh2 - 0.007), 0.0032, T.steel, 0, 0.0015, 6);
    }
  });

  // ── THE RIBBON SPEEDOMETER: an orange bar drawn across the scale to the speed ──
  {
    const Pn = D.at(K, 0, RIBBON.v, 0.005), on = lit && reveal(boot, 0.1) >= 1;
    const fr = on ? clamp(R.ias / RIBBON.max, 0, 1) : 0, x = lerp(-RIBBON.hw, RIBBON.hw, fr);
    if (fr > 0.002) Pn.rect(-RIBBON.hw, -RIBBON.hh + 0.004, x, RIBBON.hh - 0.018, R.ias >= 220 ? T.red : T.paint, on ? 0.95 : 0.2, 0.0015);
    Pn.rect(x - 0.0015, -RIBBON.hh + 0.002, x + 0.0015, RIBBON.hh - 0.014, T.ink, on ? 1 : 0.2, 0.002);
    Pn.fitText('KNOTS', -RIBBON.hw + 0.02, RIBBON.hh + 0.0, 0.05, 0.0085, T.ink, inkK, 0.003);
  }
  // ── UNDER IT: the height counter, the charge and lift bars, the warnings, the drive word ──
  {
    const Pn = D.at(K, 0, 0.074, 0.005), on = lit && reveal(boot, 0.2) >= 1;
    Pn.rect(-0.128, -0.006, -0.05, 0.03, T.face, 0, 0.001);
    if (on) fancyDigits(Pn, -0.125, 0.0, 0.022, String(Math.min(99999, Math.round(R.alt))).padStart(5, ' '), T.ink, 0.95, -0.053, 'orbitron');
    Pn.fitText('FEET', -0.089, -0.02, 0.05, 0.0088, T.ink, inkK, 0.003);
    Pn.bar(-0.022, -0.012, 0.034, 0.012, on ? R.fuel : 0, R.fuel < 0.15 ? T.red : T.ink, 'CHG');
    Pn.bar(0.014, -0.012, 0.034, 0.012, on ? R.thr : 0, T.paint, 'LIFT');
    const lamps = [['STALL', lit && R.stall, T.amber], ['HULL', lit && R.hull < 0.3, T.red], ['LOW CHG', caution, T.red]];
    lamps.forEach(([name, lampOn, rgb], i) => lensLamp(Pn, 0.088, 0.028 - i * 0.025, 0.056, 0.018, lampOn && reveal(boot, 0.5) >= 1, rgb, name));
    const word = driveWord(R);
    if (on && word) fancyText(Pn, word, -0.089, -0.038, 0.0085, word === 'PIT' ? KC.blue : word === 'ROAD' ? T.marker : word === 'LOCK' ? KC.green : T.glow, 0.9, 0.004, F_SLAB, 0.07);
  }
  // ── THE TACHOMETER on the dash top: the fans, redlined ──
  part('tachpod', {}, (K) => {
    const tc = tachAt(P);
    K.rod(add(tc.o, mul(tc.n, -0.004)), add(tc.o, mul(tc.n, -0.07)), tc.rad * 1.2, 'dash', 0.2, T.steelDk, 0, 16);
    K.rod(add(add(tc.o, mul(tc.n, -0.03)), [0, 0, -tc.rad]), [0, tc.o[1] - 0.02, DASH.z0 + DASH.h + 0.02], 0.01, 'dash', 0.3, T.steel, 0, 6);
  });
  {
    const tc = tachAt(P), Pn = K.panel(tc.o, tc.r, tc.u, 'dash', 0.3), on = lit && reveal(boot, 0.15) >= 1;
    Pn.dial(0, 0, tc.rad, on ? clamp(R.rpm / 1.1, 0, 1) : 0, { ticks: 11, major: 2, red: 0.91, bezel: T.steel, face: T.face, tick: T.ink, needle: T.paint, name: 'FANS', nameH: 0.0095, label: T.ink });
  }
  // ── THE CHART: the kit's moving map in a steel frame, the screen you click for the GPS ──
  {
    const Pn = D.at(K, xC, V_CHART, 0.006);
    Pn.rect(-CHART.hw - 0.007, -CHART.hh - 0.007, CHART.hw + 0.007, CHART.hh + 0.007, T.steel, 0.03, 0.0008);
    Pn.rect(-CHART.hw - 0.002, -CHART.hh - 0.002, CHART.hw + 0.002, CHART.hh + 0.002, T.bezelBlk, 0, 0.0015);
    if (lit && reveal(boot, 0.3) >= 1) {
      panelGps(Pn, 0, 0, CHART.hw, CHART.hh, live, { label: false, bezel: T.bezelBlk });
      Pn.fitText('CHART', -CHART.hw + 0.018, CHART.hh - 0.008, 0.03, 0.0075, T.ink, 0.6, 0.009);
      Pn.digits(0.008, -CHART.hh + 0.004, 0.01, String(Math.round(((R.hdg % 360) + 360) % 360)).padStart(3, '0'), T.glow, false);
    }
  }
  // ── THE ROCKERS: four steel paddles that tip up for on, lettered underneath; START's is red ──
  for (const t of ROCKERS(xC)) {
    const on = switchOn(t.id, R), id = 'ck:' + t.id;
    const hov = !!live && live.hover === id;
    const th = eased('bu:rk:' + t.id, on ? 0.28 : -0.28, 20), near = eased('bu:near:' + t.id, hov ? 1 : 0, 14);
    const Pn = D.at(K, t.x, V_ROCK, 0.004), c = D.curve(D.sOf(t.x)), U = D.F.up(c), n = mul(c.f, -1);
    Pn.rect(-0.016, -0.012, 0.016, 0.026, T.bezelBlk, 0, 0.001);
    const cu = norm(add(mul(U, Math.cos(th)), mul(n, -Math.sin(th)))), cn = norm(cross([1, 0, 0], cu));
    K.obox(Pn.pt(0, 0.007, 0.007), [1, 0, 0], cu, cn[1] < 0 ? cn : mul(cn, -1), 0.012, 0.016, 0.005, 'dash', 0.3, t.id === 'master' ? T.red : T.steel, t.id === 'master' && on && lit ? 0.4 : 0);
    Pn.rect(-0.008, 0.028, 0.008, 0.031, on ? (t.id === 'master' ? T.red : T.glow) : [40, 42, 48], on && lit ? 1 : 0, 0.002);
    Pn.fitText(t.name, 0, -0.022, 0.05, 0.0088, T.ink, inkK * (0.8 + 0.2 * near), 0.003);
    const flash = pressPulse('bu:rkf:' + t.id, on);
    if (flash > 0.02) Pn.annulus(0, 0.007, 0.021, 0.025, HALO, flash, 0.012, 18);
  }
  // ── THE DRIVE BUTTONS: four square pushes in a block, each edged in its own colour ──
  {
    const L = driveLights(R, live), cols = { hover: T.marker, lock: KC.green, boost: T.red, pit: KC.blue };
    for (const d of DRIVE) {
      const id = 'ck:' + d.id, pressed = !!live && live.press === id, hov = !!live && live.hover === id;
      const glow = eased('bu:glow:' + d.id, L[d.id], 10), dip = eased('bu:dip:' + d.id, pressed ? 0.0015 : 0.006, 30), near = eased('bu:near:' + d.id, hov ? 1 : 0, 14);
      const Pn = D.at(K, d.x, d.v, 0.004), rgb = cols[d.id], c = D.curve(D.sOf(d.x)), U = D.F.up(c);
      Pn.rect(-0.024, -0.024, 0.024, 0.024, T.steel, 0.03 + near * 0.4, 0.001);
      K.obox(Pn.pt(0, 0, dip / 2 + 0.001), [1, 0, 0], U, mul(c.f, -1), 0.02, 0.02, dip / 2, 'dash', 0.3, T.bezelBlk);
      const Kc = K.panel(Pn.pt(0, 0, dip + 0.001), [1, 0, 0], U, 'dash', 0.3);
      const lite = glow > 0.02 ? rgb : rgb.map((cc) => cc * 0.22), e = lit ? glow * 0.95 + 0.05 : 0;
      for (const [a0, b0, a1, b1] of [[-0.019, 0.016, 0.019, 0.019], [-0.019, -0.019, 0.019, -0.016], [-0.019, -0.016, -0.016, 0.016], [0.016, -0.016, 0.019, 0.016]]) Kc.rect(a0, b0, a1, b1, lite, e, 0.0005);
      Kc.fitText(d.name, 0, 0, 0.029, 0.0072, T.ink, inkK, 0.001);
      const flash = pressPulse('bu:key:' + d.id, L[d.id] > 0);
      if (flash > 0.02) Pn.annulus(0, 0, 0.03, 0.034, HALO, flash, 0.012, 4, Math.PI / 4, Math.PI / 4 + TAU);
      // BOOST's heat: a bar along the foot of its button, amber, then red past three quarters.
      if (d.id === 'boost' && L.heat > 0.01) Pn.rect(-0.024, -0.031, -0.024 + 0.048 * L.heat, -0.027, L.hot ? T.red : T.amber, lit ? 0.9 : 0.2, 0.002);
    }
  }
  // ── THE HUD KNOB: a fat steel knob on the right of the board, its skirt lit in the HUD's colour ──
  {
    const Pn = D.at(K, HUD.x, HUD.v, 0.004), tint = hudTint(R.L.hudTint).line;
    const pressed = !!live && live.press === 'ck:hud', hov = !!live && live.hover === 'ck:hud';
    const dip = eased('bu:dip:hud', pressed ? 0.004 : 0, 30), near = eased('bu:near:hud', hov ? 1 : 0, 14);
    Pn.annulus(0, 0, 0.022, 0.026, tint, lit ? 0.7 + 0.3 * near : 0.05, 0.001, 22);
    K.rod(Pn.pt(0, 0, 0.002), Pn.pt(0, 0, 0.026 - dip), 0.018, 'dash', 0.3, T.steel, 0, 8);
    Pn.fitText('HUD', 0, -0.038, 0.04, 0.0095, T.ink, inkK, 0.002);
    const Pt = K.panel(Pn.pt(0, 0, 0.0265 - dip), [1, 0, 0], D.F.up(D.curve(D.sOf(HUD.x))), 'dash', 0.1);
    Pt.rect(-0.0016, 0.003, 0.0016, 0.014, tint, lit ? 0.9 : 0.1, 0.0006);
    const flash = pressPulse('bu:hud:' + (R.L.hudTint || 'green'), true);
    if (flash > 0.02) Pn.annulus(0, 0, 0.028, 0.032, HALO, flash, 0.004, 22);
  }

  // ── THE WINDSCREEN HUD: projected, the hands and feet mirrored in its corners ──
  if (lit) windscreenHud(K, R, { dist: 0.5, z: -0.045, hw: 0.11, hh: 0.055, warn, caution, boot: reveal(boot, 0.2),
    mirrors: { stick: [R.ail, R.elev], thrs: [R.thr], rud: R.rud } });

  wheel(makeKit(push), R, live, lit, al);

  // ── THE TUNNEL: a steel box down the middle, the lever's slotted plate on top of it ──
  const tz = zF + 0.27;
  part('tunnel', { line: al.rgb, k: lineK(0.7), panel }, (K, S) => {
    const y0 = -0.34, y1 = DASH.yMid - 0.03;
    K.box(xC - 0.09, y0, zF, xC + 0.09, y1, tz, 'dash', 0.0, T.steelDk);
    for (const s of [-1, 1]) {
      lightLine(K, [[xC + s * 0.092, y0 + 0.02, tz - 0.012], [xC + s * 0.092, y1 - 0.04, tz - 0.012]], 0.0022, S.line, S.k);
      lightLine(K, [[xC + s * 0.09, y0, tz + 0.001], [xC + s * 0.09, y1, tz + 0.001]], 0.003, T.weld, 0);
    }
    // The gate: a steel plate with a slot, lettered at its ends.
    K.box(xC - 0.05, LEVER.y - 0.15, tz, xC + 0.05, LEVER.y + 0.15, tz + 0.006, 'dash', 0.2, T.steel);
    K.box(xC - 0.008, LEVER.y - 0.12, tz + 0.006, xC + 0.008, LEVER.y + 0.12, tz + 0.007, 'dash', -0.3, T.bezelBlk);
    const Pg = K.panel([xC, LEVER.y, tz + 0.0075], [1, 0, 0], [0, 1, 0], 'dash', 0.2);
    Pg.fitText('LIFT', 0.03, 0.0, 0.03, 0.011, T.bezelBlk, 0, 0.0005);
    Pg.fitText('MAX', -0.03, 0.115, 0.03, 0.01, T.bezelBlk, 0, 0.0005);
    Pg.fitText('OFF', -0.03, -0.115, 0.03, 0.01, T.bezelBlk, 0, 0.0005);
    // The passenger's foot rest: a chequer plate.
    K.obox([2 * xC, 0.66, zF + 0.08], [1, 0, 0], norm([0, -0.6, 0.8]), norm([0, 0.8, 0.6]), 0.14, 0.08, 0.008, 'dash', 0.1, T.steel);
  });
  // ── THE LEVER: a steel shaft and a pistol grip, where the lift is ──
  {
    const lv = leverAt(P, R), hov = !!live && (live.hover === 'throttle' || live.press === 'throttle');
    const near = eased('bu:near:throttle', hov ? 1 : 0, 12);
    K.rod(lv.pivot, lv.end, 0.009, 'dash', 0.4, T.steel, 0, 8);
    K.rod(add(lv.pivot, [0, 0, -0.01]), add(lv.pivot, [0, 0, 0.012]), 0.022, 'dash', 0.2, T.vinylDk, 0, 10);
    const grip = add(lv.end, mul(lv.dir, 0.03)), side = norm(cross(lv.dir, [1, 0, 0]));
    K.obox(grip, [1, 0, 0], lv.dir, side, 0.017, 0.05, 0.024, 'dash', 0.1, near > 0.5 ? T.paint : T.vinyl);
    K.obox(add(grip, mul(side, -0.026)), [1, 0, 0], lv.dir, side, 0.012, 0.016, 0.006, 'dash', 0.3, T.steel);
    if (near > 0.02) K.torus(lv.end, [1, 0, 0], side, 0.03, 0.003, 14, 'dash', 0.2, HALO, near);
  }

  yawPedals(K, R, zF, { y: 0.7, half: 0.09, z: 0.12, w: 0.045, plate: T.steel, rail: T.steelDk, hole: T.bezelBlk });
  overhead(K, P, R, al.rgb, (R.dome && lit ? 1 : 0.4) * Math.max(amb, 0.2) * (lit ? al.k : 1), { domeY: -0.08, domeOn: [236, 244, 255] });
  outHoloDraw(K, P, live, F_SLAB);
  hotspotHalo(K, bustardHotspots(P, live), live);
}

// ── THE WHEEL, drawn: built at rest and moved (K.posed), as the Merlin's is ──
function wheel(K, R, live, lit, al) {
  const Wh = wheelAt(R), W0 = WHEEL_REST;
  const X = xfTurn(W0.c, W0.a, -Wh.th, Wh.c);
  const near = eased('bu:near:yoke', live && (live.hover === 'yoke' || live.press === 'yoke') ? 1 : 0, 12);
  K.posed('buWheel', X, (...a) => wheelBody(K, W0, ...a), lit, Math.round(near * 40) / 40, al.rgb);
}
function wheelBody(K, W, lit, near, line) {
  const { c, a, u, v } = W, hub = add(c, mul(a, -WHEEL.dish));
  // The column: a bare steel tube into the dash.
  K.rod(add(hub, mul(a, -0.3)), hub, 0.024, 'dash', 0.2, T.steelDk, 0, 12);
  K.torus(add(hub, mul(a, -0.02)), u, v, 0.03, 0.003, 16, 'dash', 0.2, line, lit ? 0.4 + 0.6 * near : 0);
  // The rim: fat black vinyl, with a painted band at the top, level when it's straight.
  K.torus(c, u, v, WHEEL.r, WHEEL.tube, 36, 'dash', 0.05, T.vinyl);
  K.torus(c, u, v, WHEEL.r, WHEEL.tube + 0.0008, 3, 'dash', 0.2, T.paint, lit ? 0.15 : 0, Math.PI / 2 - 0.1, Math.PI / 2 + 0.1);
  // Three slotted steel spokes, from the boss out and forward to the rim: that's the dish.
  for (const deg of [0, 180, 270]) {
    const t = deg * DEG, dir = add(mul(u, Math.cos(t)), mul(v, Math.sin(t))), side = add(mul(u, -Math.sin(t)), mul(v, Math.cos(t)));
    const p0 = add(hub, mul(dir, 0.03)), p1 = add(c, mul(dir, WHEEL.r - 0.01)), along = norm(sub(p1, p0)), nn = norm(cross(along, side));
    K.obox(mul(add(p0, p1), 0.5), along, side, nn, Math.hypot(...sub(p1, p0)) / 2, 0.02, 0.003, 'dash', 0.3, T.steel);
    const Ps = K.panel(add(mul(add(p0, p1), 0.5), mul(nn, nn[1] < 0 ? 0.0035 : -0.0035)), along, side, 'dash', 0.2);
    for (const i of [-1, 0, 1]) Ps.rect(i * 0.04 - 0.014, -0.006, i * 0.04 + 0.014, 0.006, T.bezelBlk, 0, 0.0005);
  }
  // The boss: a steel cup with Garrow's three bars.
  K.rod(add(hub, mul(a, -0.01)), add(hub, mul(a, 0.014)), 0.042, 'dash', 0.3, T.steel, 0, 18);
  const Pb = K.panel(add(hub, mul(a, 0.0145)), u, v, 'dash', 0.3);
  Pb.disc(0, 0, 0.034, T.bezelBlk, 0, 0.0004, 18);
  [0.022, 0.016, 0.01].forEach((w, i) => Pb.rect(-w, 0.01 - i * 0.012, w, 0.016 - i * 0.012, T.paint, 0.1, 0.001));
}
