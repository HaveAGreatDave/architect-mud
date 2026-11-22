// THE HALLARD LANNER'S COCKPIT: the inside of the grand tourer, as geometry.
//
// The Lanner is Hallard Coachbuilders' two-seat mini VTOL (docs/proposals/hover-cars.md), and the
// cockpit is a coachbuilt car's: a walnut fascia under a hide crash roll, round dials in brass bezels
// with cream ink on black, a row of brass toggles, a wood-rimmed wheel on three drilled spokes, fluted
// tan seats and dark green carpet. You fly it and drive it with the wheel; the lift is on two brass
// stalks behind it.
//
// ⚠ THE ROOM IS THE EXTERIOR'S BODY: client/shared/cabin-lanner.js states it, and
// interior-hovercar-kit.js builds the wall, the glass, the floor and the doors off it. Nothing about
// the shape of the cabin is typed here.
//
// ⚠ EVERY CONTROL DRAWN WORKS (docs/reference/cockpit-lettering.md). The rim rolls and pitches the
// aircraft (the 'yoke' hotspot, dragged), the stalks step the lift (ck:padUp, ck:padDn), the four
// toggles are the four circuits the sim has, the four push buttons are HOVER, LOCK, BOOST and PIT
// (merlin-modes.js), the chart is the GPS, the HUD knob steps the HUD's colour and each door's pull
// works the doors. Everything is lettered.
//
// Pure: no clock, no camera, no DOM. `live` arrives as an argument.
import { brandTrim } from './interior-brands.js';
import { makeKit, C as KC, clamp, lerp, SHINY, TEXTURE, xfTurn } from './interior-kit.js';
import { memoPart } from './interior-memo.js';
import { hotspotHalo, panelGps, gpsHotspot, lensLamp, eased, pressPulse, HALO, bootAge, reveal, alertLight,
  lightLine, bandFrame, glassBand, windscreenHud, hudTint } from './interior-cockpit-kit.js';
import { MESH_ROWS } from './vehicle-meshes.js';
import { LANNER } from './cabin-lanner.js';
import { hoverCarProfile, readings, night, panelOn, onRoad, driveWord, driveLights, switchOn, doorHotspots, outHoloDraw,
  yawPedals, overhead, roomHalfW, fancyText, TAU, DEG, add, sub, mul, cross, norm } from './interior-hovercar-kit.js';

// ── THE STYLE ────────────────────────────────────────────────────────────────
// Hallard's tan hide, green carpet and walnut, with brass where a hand goes.
export const LANNER_TRIM = {
  lining: [150, 118, 82], liningDk: [112, 86, 58], headliner: [196, 186, 166],
  carbon: [58, 40, 26], carbonLt: [92, 64, 40], tub: [30, 44, 36],
  hide: [178, 142, 100], hideDk: [134, 102, 68], piping: [226, 214, 188],
  carpet: [24, 42, 32], carpetEdge: [16, 30, 22],
  wood: [68, 40, 22], woodDk: [44, 26, 14], woodLt: [90, 54, 28],
  brass: [196, 160, 84], brassDk: [128, 100, 50], chrome: [200, 204, 212], alu: [170, 174, 180],
  face: [14, 14, 13], ink: [236, 226, 198], bezelBlk: [20, 18, 16],
  glow: [120, 236, 220], glowDim: [40, 96, 90], screen: [6, 14, 13],
  red: [235, 60, 48], amber: [255, 176, 64], marker: [255, 196, 40], belt: [40, 36, 30],
};
const T = LANNER_TRIM;
for (const k of ['lining', 'liningDk', 'hide', 'hideDk', 'piping']) TEXTURE.set(T[k], 'leather');
TEXTURE.set(T.headliner, 'fabric');
for (const k of ['carbon', 'carbonLt', 'wood', 'woodDk', 'woodLt']) TEXTURE.set(T[k], 'wood');
for (const k of ['tub', 'carpet', 'carpetEdge']) TEXTURE.set(T[k], 'carpet');
for (const k of ['brass', 'brassDk', 'chrome', 'alu']) TEXTURE.set(T[k], 'brushed');
TEXTURE.set(T.belt, 'fabric');
SHINY.set(T.screen, { spec: 0.6, pow: 60 });
brandTrim(T, 'lanner', TEXTURE, SHINY);
SHINY.set(T.wood, { spec: 0.42, pow: 30 });
SHINY.set(T.woodLt, { spec: 0.42, pow: 30 });
SHINY.set(T.woodDk, { spec: 0.36, pow: 26 });
SHINY.set(T.brass, { spec: 0.85, pow: 60 });
SHINY.set(T.brassDk, { spec: 0.6, pow: 40 });
SHINY.set(T.chrome, { spec: 0.95, pow: 90 });
SHINY.set(T.hide, { spec: 0.26, pow: 16 });
SHINY.set(T.face, { spec: 0.5, pow: 50 });

// Hallard letters its dials in a deco roman; small switch labels stay in the legend face.
const F_DIAL = 'federo', F_BADGE = 'federo';

// ── THE WHEEL ────────────────────────────────────────────────────────────────
// A thin wood rim 37 cm across on three drilled aluminium spokes, with a brass boss. Turning it
// rolls it up to 90 degrees each way; in the air pushing and pulling slide it 5 cm along the column
// (a pull comes toward you); on the road that travel is locked and it only turns.
const WHEEL = { c: [0, 0.42, -0.31], r: 0.172, tube: 0.013, turn: 1.55, slide: 0.05 };
const WHEEL_AXIS = norm([0, -0.9, 0.44]);
function wheelAt(R) {
  const a = WHEEL_AXIS, c = add(WHEEL.c, mul(a, onRoad(R) ? 0 : R.elev * WHEEL.slide));
  const u0 = [1, 0, 0], v0 = norm(cross(a, u0));
  const th = R.ail * WHEEL.turn, ct = Math.cos(th), st = Math.sin(th);
  const u = norm(sub(mul(u0, ct), mul(v0, st))), v = norm(add(mul(v0, ct), mul(u0, st)));
  const P = (x, y, z = 0) => add(add(add(c, mul(u, x)), mul(v, y)), mul(a, z));
  return { c, a, u, v, P, th };
}
const WHEEL_REST = wheelAt({ ail: 0, elev: 0 });
// The lift stalks on the column, behind the rim: they don't turn with the wheel.
const STALKS = [{ id: 'ck:padUp', sx: 1, name: 'LIFT +' }, { id: 'ck:padDn', sx: -1, name: 'LIFT -' }];
const stalkTip = (sx) => add(add(WHEEL.c, mul(WHEEL_AXIS, -0.075)), [sx * 0.2, 0, 0.02]);

// ── THE FASCIA ───────────────────────────────────────────────────────────────
// A walnut board across the cabin, bowed a little toward the screen in the middle. Everything on it
// is placed along it by x and up it by v (metres above its foot).
const DASH = { yMid: 0.68, sag: 0.10, z0: -0.46, h: 0.20, lean: 0.28 };
function dashOf(P) {
  if (P.hc.dash) return P.hc.dash;
  const xC = P.xCentre, half = Math.min(roomHalfW(P, DASH.yMid - DASH.sag, DASH.z0 + DASH.h, 0.035), roomHalfW(P, DASH.yMid - DASH.sag, DASH.z0, 0.035));
  const xL = xC - half, xR = xC + half;
  const curve = (s) => {
    const x = lerp(xL, xR, s), q = (x - xC) / half;
    return { p: [x, DASH.yMid - DASH.sag * q * q, DASH.z0], f: norm([2 * DASH.sag * q / half, 1, 0]) };
  };
  const sOf = (x) => (x - xL) / (xR - xL), F = bandFrame(curve, DASH.lean);
  return (P.hc.dash = { xL, xR, half, curve, sOf, F, at: (K, x, v, lift = 0.005) => F.at(K, sOf(x), v, lift) });
}
// What's on the board, by x. The driver's two big dials and the warning lamps between them; under
// them the four drive buttons; the HUD knob to the right; the centre stack of small dials round the
// chart, with the four toggles under it.
const V_UP = 0.132, V_LO = 0.038;
const BIG = [{ id: 'speed', x: -0.092, name: 'KNOTS' }, { id: 'height', x: 0.092, name: 'FEET' }];
const SMALL = (xC) => [{ id: 'charge', x: xC + 0.105, name: 'CHARGE' }, { id: 'fans', x: xC - 0.105, name: 'FANS' }, { id: 'lift', x: xC - 0.175, name: 'LIFT' }];
const DRIVE = [
  { id: 'hover', name: 'HOVER', x: -0.108 }, { id: 'lock', name: 'LOCK', x: -0.036 },
  { id: 'boost', name: 'BOOST', x: 0.036 }, { id: 'pit', name: 'PIT', x: 0.108 },
];
const TOGGLES = (xC) => [['master', 'START'], ['land', 'LIGHTS'], ['panel', 'PANEL'], ['dome', 'CABIN']].map(([id, name], i) => ({ id, name, x: xC - 0.09 + i * 0.06 }));
const HUD_X = 0.19, CHART = { hw: 0.05, hh: 0.044 };

function lannerHotspots(P, live) {
  const R = readings(live), K = makeKit(() => {}), D = dashOf(P), xC = P.xCentre, out = [];
  for (const d of DRIVE) out.push({ id: 'ck:' + d.id, p: D.at(K, d.x, V_LO).pt(0, 0, 0.012), r: 0.022, kind: 'click' });
  for (const t of TOGGLES(xC)) out.push({ id: 'ck:' + t.id, p: D.at(K, t.x, V_LO).pt(0, 0.004, 0.016), r: 0.02, kind: 'click' });
  out.push(gpsHotspot(D.at(K, xC, V_UP, 0.008), 0, 0, 0.046));
  out.push({ id: 'ck:hud', p: D.at(K, HUD_X, 0.075).pt(0, 0, 0.022), r: 0.024, kind: 'click' });
  const Wh = wheelAt(R);
  out.push({ id: 'yoke', p: Wh.P(WHEEL.r * 0.94, WHEEL.r * 0.2, 0.01), r: 0.05, kind: 'yoke' });
  for (const st of STALKS) out.push({ id: st.id, p: stalkTip(st.sx), r: 0.03, kind: 'click' });
  out.push(...doorHotspots(P, live));
  return out;
}

// The cabin's own light: the chart and the lit dials spill a little teal on the wood, with power.
function lannerGlows(P, live) {
  const R = readings(live);
  if (!R.powered) return [];
  const K = makeKit(() => {}), D = dashOf(P), up = reveal(bootAge(live), 0.3);
  if (up <= 0) return [];
  return [
    { p: D.at(K, P.xCentre, V_UP).pt(0, 0, 0.05), r: 0.2, rgb: T.glow, k: up * 0.7 },
    { p: D.at(K, 0, V_UP).pt(0, 0, 0.05), r: 0.24, rgb: T.ink, k: up * (panelOn(R) ? 0.6 : 0.15) },
    { p: D.at(K, HUD_X, 0.075).pt(0, 0, 0.05), r: 0.09, rgb: hudTint(R.L.hudTint).line, k: 0.8 },
  ];
}

// ── THE PROFILE ──────────────────────────────────────────────────────────────
export function lannerProfile(doc = MESH_ROWS.lanner) {
  return hoverCarProfile(LANNER, doc, {
    label: 'Hallard Lanner', tag: 'ln', fN: 0.34,
    tones: { headliner: T.headliner, upper: T.headliner, mid: T.liningDk, lower: T.tub, doorUpper: T.hide, doorLower: T.tub,
      reveal: T.woodDk, seal: T.glowDim, firewall: T.liningDk, floor: T.carpet, floorEdge: T.carpetEdge, floorLine: null,
      sill: T.woodDk, sillLine: T.glow, seam: T.woodDk },
    sillW: 0.07, sillH: 0.09,
    dashY: DASH.yMid - 0.08, dashZ: DASH.z0 + 0.1, seatZ: 0.17, seatHalf: 0.25, seatY: [-0.26, 0.2],
    floods: (xC) => [{ p: [xC * 0.5, 0.5, -0.3], r: 0.5 }, { p: [xC, -0.05, 0.14], r: 0.6 }],
    floodGain: 1.4, glare: 0.2,
    doorCard, roomFit, seats, fit: lannerFit, hotspots: lannerHotspots, glows: lannerGlows,
  });
}

// ── THE DOOR CARD: a wood capping under the glass, a hide armrest, a brass pull, a map pocket ──
function doorCard({ K, S, A, s, D, pull }) {
  const SGa = LANNER.glass.side.a[0];
  // The capping: a walnut rail along the top of the card.
  const cap = [];
  for (let i = 0; i <= 8; i++) cap.push(S(lerp(D.f[0] + 0.03, D.f[1] - 0.04, i / 8), A(SGa - 3), 0.012));
  for (let i = 1; i < cap.length; i++) K.rod(cap[i - 1], cap[i], 0.014, 'pil', 0.1, T.wood, 0, 6, false);
  // The armrest, and the piping along its top.
  const ar0 = S(-0.34, A(-10), 0.055), ar1 = S(-0.08, A(-10), 0.055);
  const along = norm(sub(ar1, ar0)), aUp = norm(cross(cross(along, [0, 0, 1]), along));
  K.obox(mul(add(ar0, ar1), 0.5), along, aUp, norm(cross(along, aUp)), Math.hypot(...sub(ar1, ar0)) / 2, 0.022, 0.045, 'pil', 0.05, T.hide);
  K.rod(add(ar0, [0, 0, 0.024]), add(ar1, [0, 0, 0.024]), 0.003, 'pil', 0.2, T.piping, 0, 4);
  // The pull: a brass lever in a dished plate, ahead of the armrest.
  const p0 = S(-0.02, A(-2), 0.03), p1 = S(0.03, A(-2), 0.03);
  K.rod(p0, p1, 0.007, 'pil', 0.3, T.brass, 0, 8);
  for (const q of [p0]) K.rod(q, S(-0.02, A(-2), 0.004), 0.009, 'pil', 0.3, T.brassDk, 0, 8);
  pull(mul(add(p0, p1), 0.5));
  // The map pocket: a hide flap low on the card, piped.
  const m0 = S(-0.30, A(-24), 0.012), m1 = S(-0.02, A(-24), 0.012);
  K.rod(m0, m1, 0.004, 'pil', 0.2, T.piping, 0, 4);
  K.rod(S(-0.30, A(-30), 0.01), S(-0.02, A(-30), 0.01), 0.012, 'pil', 0, T.hideDk, 0, 6);
}

// ── THE ROOM'S OWN FITTINGS: the firewall's pleated panel, a parcel shelf, the maker's plate ──
function roomFit({ K, xC, zF, yB }) {
  for (const cx of [0, 2 * xC]) {
    K.box(cx - 0.2, yB, zF + 0.28, cx + 0.2, yB + 0.025, zF + 0.72, 'post', -0.05, T.hideDk);
    for (let r = -3; r <= 3; r++) K.box(cx + r * 0.055 - 0.002, yB + 0.025, zF + 0.3, cx + r * 0.055 + 0.002, yB + 0.029, zF + 0.7, 'post', 0.1, T.piping, 0.05);
  }
  K.box(xC - 0.5, yB, zF + 0.74, xC + 0.5, yB + 0.07, zF + 0.76, 'post', 0.05, T.wood);
  const Pp = K.panel([xC, yB + 0.03, zF + 0.58], [1, 0, 0], [0, 0, 1], 'post', 0.2);
  Pp.rect(-0.05, -0.016, 0.05, 0.016, T.brass, 0.05, 0.001);
  fancyText(Pp, 'HALLARD', 0, 0, 0.011, T.woodDk, 0, 0.003, F_BADGE, 0.086);
}

// ── THE SEATS: low armchairs in fluted tan hide, piped, a lap and diagonal belt ──
function seats(P, push) {
  const K = makeKit(push, false);
  for (const cx of [0, 2 * P.xCentre]) {
    const h = P.seatHalf, [y0, y1] = P.seatY, sz = P.seatZ, zF = P.hc.zF, side = cx === 0 ? 1 : -1;
    K.box(cx - h + 0.03, y0 + 0.04, zF, cx + h - 0.03, y1 - 0.06, sz - 0.09, 'seat', -0.25, T.woodDk);
    K.box(cx - h, y0, sz - 0.09, cx + h, y1, sz, 'seat', 0.02, T.hide);
    // The flutes: eight piped channels fore and aft across the cushion.
    for (let i = -3; i <= 3; i++) K.box(cx + i * 0.058 - 0.002, y0 + 0.03, sz, cx + i * 0.058 + 0.002, y1 - 0.02, sz + 0.004, 'seat', 0.2, T.hideDk);
    K.rod([cx - h, y1, sz - 0.004], [cx + h, y1, sz - 0.004], 0.006, 'seat', 0.2, T.piping, 0, 5);
    // The back: leaning 16 degrees, fluted the same way, with a rolled top and a small headrest.
    const lean = 0.28, bb = [cx, y0 + 0.01, sz], up = [0, -Math.sin(lean), Math.cos(lean)], fw = [0, Math.cos(lean), Math.sin(lean)];
    const bH = 0.5, bc = add(bb, mul(up, bH / 2));
    K.obox(add(bc, mul(fw, -0.05)), [1, 0, 0], up, fw, h, bH / 2, 0.045, 'seat', -0.02, T.hide);
    for (let i = -3; i <= 3; i++) K.obox(add(add(bc, mul(fw, -0.004)), [i * 0.058, 0, 0]), [1, 0, 0], up, fw, 0.002, bH / 2 - 0.03, 0.002, 'seat', 0.2, T.hideDk);
    K.rod(add(add(bb, mul(up, bH)), [-h, 0, 0]), add(add(bb, mul(up, bH)), [h, 0, 0]), 0.03, 'seat', 0.05, T.hide, 0, 8);
    for (const sx of [-1, 1]) K.rod(add(add(bb, mul(up, 0.02)), [sx * h, 0, 0]), add(add(bb, mul(up, bH)), [sx * h, 0, 0]), 0.006, 'seat', 0.2, T.piping, 0, 5);
    const hc = add(bb, mul(up, bH + 0.1));
    for (const sx of [-0.06, 0.06]) K.rod(add(add(bb, mul(up, bH)), [sx, 0, 0]), add(hc, [sx, 0, -0.04]), 0.006, 'seat', 0.3, T.chrome, 0, 6);
    K.obox(add(hc, mul(fw, -0.03)), [1, 0, 0], up, fw, 0.11, 0.06, 0.035, 'seat', 0.0, T.hide);
    // The belt: a diagonal from the outer shoulder to a buckle by the tunnel, and the lap strap.
    const buck = [cx - side * (h - 0.03), y1 - 0.26, sz + 0.05];
    K.rod(add(add(bb, mul(up, bH - 0.04)), [side * (h - 0.04), 0.03, 0]), buck, 0.012, 'seat', 0.05, T.belt, 0, 4);
    K.rod([cx + side * (h - 0.02), y0 + 0.1, sz + 0.02], buck, 0.012, 'seat', 0.05, T.belt, 0, 4);
    K.rod(add(buck, [0, -0.012, 0]), add(buck, [0, 0.012, 0]), 0.022, 'seat', 0.3, T.chrome, 0, 10);
  }
}

// ── A dial in Hallard's manner: brass bezel, black face, cream ink, its name in the deco face ──
function dial(Pn, u, v, rad, frac, name, o = {}) {
  Pn.dial(u, v, rad, frac, { bezel: T.brass, face: T.face, tick: T.ink, needle: o.needle || T.ink, name, nameH: Math.max(0.0085, rad * 0.2), label: T.ink, ...o });
}

// ── THE FIT-OUT ──────────────────────────────────────────────────────────────
function lannerFit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live);
  const zF = P.hc.zF, xC = P.xCentre, D = dashOf(P);
  const lit = R.powered, panel = panelOn(R), boot = bootAge(live);
  const amb = lit ? (night(R) ? 1 : 0.55) * (R.dome ? 1.2 : 1) : 0.05;
  const warn = lit && (R.hull < 0.3 || R.stall), caution = lit && R.fuel < 0.15;
  const al = alertLight(caution, warn, T.line), lineK = (k) => (lit ? k * al.k : 0.05);
  const inkK = panel ? 0.75 : lit ? 0.4 : 0.12;
  // ⚠ THE PARTS THAT DON'T MOVE ARE BUILT ONCE (interior-memo.js memoPart): each reads the light
  // only through `S`, so it is rebuilt when the power or the alert colour changes and reused otherwise.
  const part = (id, S, fn) => memoPart(push, 'ln:' + id, S, (S2, rec) => fn(makeKit(rec), S2), null);

  // ── THE BOARD: walnut, a hide crash roll along its top, a brass rail along its foot ──
  part('board', { line: al.rgb, k: lineK(0.8), panel }, (K, S) => {
    glassBand(K, D.curve, { h: DASH.h, lean: DASH.lean, segs: 26, lit: false, substrate: T.wood });
    const N = 26, top = [], foot = [];
    for (let i = 0; i <= N; i++) { top.push(D.F.P(i / N, DASH.h + 0.012, 0.012)); foot.push(D.F.P(i / N, -0.006, 0.006)); }
    for (let i = 1; i <= N; i++) K.rod(top[i - 1], top[i], 0.026, 'dash', 0.05, T.hide, 0, 8, false);
    lightLine(K, top.map((q) => add(q, [0, -0.018, 0.02])), 0.0016, T.piping, 0.05);
    for (let i = 1; i <= N; i++) K.rod(foot[i - 1], foot[i], 0.005, 'dash', 0.3, T.brass, 0, 6, false);
    lightLine(K, foot.map((q) => add(q, [0, -0.004, -0.012])), 0.003, S.line, S.k);
    // The deck from the roll forward to the foot of the screen: hide, falling with the bonnet.
    const y0 = DASH.yMid - DASH.sag * 0.2, zT = DASH.z0 + DASH.h + 0.02, rows = [];
    for (let i = 0; i <= 5; i++) { const y = lerp(y0, y0 + 0.36, i / 5), z = zT - 0.1 * (i / 5), hw = roomHalfW(P, y, z, 0.03); rows.push([[xC - hw, y, z], [xC + hw, y, z]]); }
    for (let i = 1; i < rows.length; i++) K.face([rows[i - 1][0], rows[i - 1][1], rows[i][1], rows[i][0]], [0, 0, 1], 'dash', -0.2, T.hideDk);
    // Under the board: a hide knee roll, and the two struts it hangs off.
    for (const x of [xC - 0.3, xC + 0.3]) K.rod(D.F.P(D.sOf(x), 0.02, -0.03), [x, DASH.yMid - 0.02, zF + 0.03], 0.016, 'dash', 0.05, T.woodDk, 0, 8);
    // The glovebox in front of the passenger: a walnut door in a brass frame, a lock, the car's name.
    const Pg = D.at(K, 2 * xC - 0.02, 0.1, 0.004);
    Pg.rect(-0.13, -0.062, 0.13, 0.062, T.woodLt, 0, 0.001);
    for (const [a0, b0, a1, b1] of [[-0.132, -0.064, 0.132, -0.06], [-0.132, 0.06, 0.132, 0.064], [-0.132, -0.064, -0.128, 0.064], [0.128, -0.064, 0.132, 0.064]]) Pg.rect(a0, b0, a1, b1, T.brass, 0.05, 0.002);
    Pg.disc(0.105, 0, 0.009, T.brass, 0.05, 0.003, 12);
    Pg.rect(0.1035, -0.005, 0.1065, 0.005, T.bezelBlk, 0, 0.004);
    fancyText(Pg, 'LANNER', -0.02, 0.0, 0.018, T.brass, S.panel ? 0.25 : 0.05, 0.003, F_BADGE, 0.15);
    // The vents: two brass-ringed eyeballs at the board's ends.
    for (const x of [D.xL + 0.07, D.xR - 0.045]) {
      const Pv = D.at(K, x, 0.15, 0.004);
      Pv.disc(0, 0, 0.022, [8, 8, 8], 0, 0.0005, 18);
      for (let i = 0; i < 6; i++) Pv.spoke(0, 0, i * TAU / 6, 0.005, 0.02, 0.002, T.brassDk, 0, 0.003);
      Pv.annulus(0, 0, 0.022, 0.027, T.brass, 0.05, 0.004, 20);
    }
    // The dials' and switches' lettering and the brass plates the switches stand in.
    const Pd = D.at(K, 0, V_LO, 0.004);
    Pd.rect(-0.146, -0.031, 0.146, 0.031, T.brassDk, 0.03, 0.0005);
    Pd.rect(-0.143, -0.028, 0.143, 0.028, T.bezelBlk, 0, 0.001);
    const Pt = D.at(K, xC, V_LO, 0.004);
    Pt.rect(-0.128, -0.031, 0.128, 0.031, T.brassDk, 0.03, 0.0005);
    Pt.rect(-0.125, -0.028, 0.125, 0.028, T.bezelBlk, 0, 0.001);
  });

  // ── THE DRIVER'S DIALS ──
  {
    const Pn = D.at(K, 0, V_UP, 0.006), on = lit && reveal(boot, 0.1) >= 1;
    // Speed: 0 to 240 knots, redlined at the top eighth.
    dial(Pn, BIG[0].x, 0, 0.052, on ? clamp(R.ias / 240, 0, 1) : 0, BIG[0].name, { ticks: 12, major: 2, red: 0.875 });
    // Height: the long hand a thousand feet a turn, the short one ten thousand.
    dial(Pn, BIG[1].x, 0, 0.052, on ? (R.alt % 1000) / 1000 : 0, BIG[1].name, { a0: Math.PI / 2, sweep: TAU, ticks: 10, major: 1, frac2: on ? clamp(R.alt / 10000, 0, 1) : 0, needle2: T.brass });
    for (const [x, str] of [[BIG[0].x, 'KT'], [BIG[1].x, 'FT']]) fancyText(Pn, str, x, 0.02, 0.0075, T.ink, inkK, 0.0046, F_DIAL, 0.03);
    // The drive word between them, and the three warnings over it.
    const lamps = [['STALL', lit && R.stall, T.amber], ['HULL', lit && R.hull < 0.3, T.red], ['LOW CHG', caution, T.red]];
    lamps.forEach(([name, lampOn, rgb], i) => lensLamp(Pn, 0, 0.046 - i * 0.026, 0.05, 0.018, lampOn && reveal(boot, 0.5) >= 1, rgb, name));
    const word = driveWord(R);
    if (on && word) fancyText(Pn, word, 0, -0.042, 0.0085, word === 'PIT' ? KC.blue : word === 'ROAD' ? T.marker : word === 'LOCK' ? KC.green : T.glow, 0.9, 0.005, F_DIAL, 0.05);
  }
  // ── THE CENTRE STACK: charge, the fans and the lift round the chart ──
  {
    const Pn = D.at(K, xC, V_UP, 0.006), on = lit && reveal(boot, 0.25) >= 1, [chg, fans, lift] = SMALL(0);
    dial(Pn, chg.x, 0, 0.031, on ? R.fuel : 0, chg.name, { ticks: 8, major: 2, arcs: [[0, 0.15, T.red]], needle: R.fuel < 0.15 ? T.red : T.ink });
    dial(Pn, fans.x, 0, 0.031, on ? clamp(R.rpm / 1.1, 0, 1) : 0, fans.name, { ticks: 11, major: 2, red: 0.91 });
    dial(Pn, lift.x, 0, 0.031, on ? R.thr : 0, lift.name, { ticks: 10, major: 5 });
    // The chart: the kit's moving map behind a brass frame, the screen you click for the GPS.
    Pn.rect(-CHART.hw - 0.006, -CHART.hh - 0.006, CHART.hw + 0.006, CHART.hh + 0.006, T.brass, 0.05, 0.0008);
    Pn.rect(-CHART.hw - 0.002, -CHART.hh - 0.002, CHART.hw + 0.002, CHART.hh + 0.002, T.bezelBlk, 0, 0.0015);
    if (lit && reveal(boot, 0.3) >= 1) {
      panelGps(Pn, 0, 0, CHART.hw, CHART.hh, live, { label: false, bezel: T.bezelBlk });
      Pn.fitText('CHART', -CHART.hw + 0.018, CHART.hh - 0.008, 0.03, 0.0075, T.ink, 0.6, 0.009);
      Pn.digits(0.006, -CHART.hh + 0.004, 0.01, String(Math.round(((R.hdg % 360) + 360) % 360)).padStart(3, '0'), T.glow, false);
    }
  }
  // ── THE TOGGLES: four brass levers in the centre plate, up for on, lettered underneath ──
  for (const t of TOGGLES(xC)) {
    const on = switchOn(t.id, R), id = 'ck:' + t.id;
    const pressed = !!live && live.press === id, hov = !!live && live.hover === id;
    const th = eased('ln:tg:' + t.id, on ? 0.5 : -0.5, 18), near = eased('ln:near:' + t.id, hov ? 1 : 0, 14);
    const Pn = D.at(K, t.x, V_LO, 0.005);
    Pn.disc(0, 0.004, 0.011, T.brass, 0.05 + near * 0.4, 0.001, 16);
    Pn.disc(0, 0.004, 0.0065, T.bezelBlk, 0, 0.002, 12);
    const root = Pn.pt(0, 0.004, 0.002), tip = Pn.pt(0, 0.004 + Math.sin(th) * 0.02, 0.006 + Math.cos(th) * 0.022 - (pressed ? 0.002 : 0));
    K.rod(root, tip, 0.0035, 'dash', 0.4, T.brass, 0, 8);
    K.rod(tip, add(tip, mul(norm(sub(tip, root)), 0.006)), 0.0052, 'dash', 0.4, T.brass, 0, 8);
    Pn.fitText(t.name, 0, -0.019, 0.052, 0.0088, on ? T.ink : T.ink.map((c) => c * 0.7), inkK, 0.003);
    if (t.id === 'master') Pn.disc(0, 0.024, 0.003, on ? T.red : [60, 20, 18], on ? 1 : 0, 0.003, 8);
    const flash = pressPulse('ln:tgf:' + t.id, on);
    if (flash > 0.02) Pn.annulus(0, 0.004, 0.013, 0.016, HALO, flash, 0.004, 18);
  }
  // ── THE DRIVE BUTTONS: four round pushes in brass rings, each lit in its own colour ──
  {
    const L = driveLights(R, live), cols = { hover: T.marker, lock: KC.green, boost: T.red, pit: KC.blue };
    for (const d of DRIVE) {
      const id = 'ck:' + d.id, pressed = !!live && live.press === id, hov = !!live && live.hover === id;
      const glow = eased('ln:glow:' + d.id, L[d.id], 10), dip = eased('ln:dip:' + d.id, pressed ? 0.001 : 0.005, 30), near = eased('ln:near:' + d.id, hov ? 1 : 0, 14);
      const Pn = D.at(K, d.x, V_LO, 0.005), rgb = cols[d.id];
      Pn.annulus(0, 0, 0.0175, 0.021, T.brass, 0.05 + near * 0.5, 0.001, 22);
      K.rod(Pn.pt(0, 0, 0.001), Pn.pt(0, 0, dip), 0.017, 'dash', 0.3, T.bezelBlk, 0, 20);
      const Kc = K.panel(Pn.pt(0, 0, dip), [1, 0, 0], D.F.up(D.curve(D.sOf(d.x))), 'dash', 0.3);
      Kc.annulus(0, 0, 0.0128, 0.0155, glow > 0.02 ? rgb : rgb.map((c) => c * 0.2), lit ? glow * 0.95 + 0.05 : 0, 0.0006, 22);
      Kc.fitText(d.name, 0, 0, 0.023, 0.0062, T.ink, inkK, 0.001);
      const flash = pressPulse('ln:key:' + d.id, L[d.id] > 0);
      if (flash > 0.02) Pn.annulus(0, 0, 0.022, 0.026, HALO, flash, 0.004, 22);
      // BOOST's heat: an arc round its ring from the bottom, amber, then red past three quarters.
      if (d.id === 'boost' && L.heat > 0.01) Pn.annulus(0, 0, 0.0225, 0.0255, L.hot ? T.red : T.amber, lit ? 0.9 : 0.2, 0.0018, Math.max(2, Math.round(22 * L.heat)), -Math.PI / 2, -Math.PI / 2 - L.heat * TAU);
    }
  }
  // ── THE HUD KNOB: knurled brass at the board's right end, its skirt lit in the HUD's colour ──
  {
    const Pn = D.at(K, HUD_X, 0.075, 0.004), tint = hudTint(R.L.hudTint).line;
    const pressed = !!live && live.press === 'ck:hud', hov = !!live && live.hover === 'ck:hud';
    const dip = eased('ln:dip:hud', pressed ? 0.004 : 0, 30), near = eased('ln:near:hud', hov ? 1 : 0, 14);
    Pn.annulus(0, 0, 0.019, 0.023, tint, lit ? 0.7 + 0.3 * near : 0.05, 0.001, 22);
    K.rod(Pn.pt(0, 0, 0.002), Pn.pt(0, 0, 0.022 - dip), 0.015, 'dash', 0.3, T.brass, 0, 20);
    Pn.fitText('HUD', 0, -0.034, 0.04, 0.0095, T.ink, inkK, 0.002);
    const Pt = K.panel(Pn.pt(0, 0, 0.0225 - dip), [1, 0, 0], D.F.up(D.curve(D.sOf(HUD_X))), 'dash', 0.1);
    Pt.rect(-0.0014, 0.003, 0.0014, 0.012, tint, lit ? 0.9 : 0.1, 0.0006);
    const flash = pressPulse('ln:hud:' + (R.L.hudTint || 'green'), true);
    if (flash > 0.02) Pn.annulus(0, 0, 0.025, 0.029, HALO, flash, 0.004, 22);
  }
  // ── THE CLOCK, in the glovebox door's corner: live, so outside the cached board ──
  {
    const Pn = D.at(K, 2 * xC - 0.115, 0.135, 0.006);
    Pn.dial(0, 0, 0.024, 0, { a0: Math.PI / 2, sweep: TAU, ticks: 12, major: 3, bezel: T.brass, face: T.face, tick: T.ink, needle: T.ink, frac2: (((R.hour % 12) + 12) % 12) / 12, needle2: T.ink });
    Pn.spoke(0, 0, Math.PI / 2 - ((R.hour * 60) % 60) / 60 * TAU, -0.003, 0.02, 0.0012, T.brass, 0.4, 0.008);
  }

  // ── THE WINDSCREEN HUD: projected, the hands and feet mirrored in its corners ──
  if (lit) windscreenHud(K, R, { dist: 0.46, z: -0.05, hw: 0.11, hh: 0.058, warn, caution, boot: reveal(boot, 0.2),
    mirrors: { stick: [R.ail, R.elev], thrs: [R.thr], rud: R.rud } });

  // ── THE WHEEL and its stalks ──
  wheel(makeKit(push), R, live, lit, al);
  for (const st of STALKS) {
    const pressed = !!live && live.press === st.id, hov = !!live && live.hover === st.id;
    const pull = eased('ln:stalk:' + st.id, pressed ? 1 : 0, 26);
    const root = add(WHEEL.c, mul(WHEEL_AXIS, -0.09)), tip = add(stalkTip(st.sx), [0, 0, (st.sx > 0 ? 1 : -1) * pull * 0.012]);
    K.rod(root, tip, 0.006, 'dash', 0.3, T.brass, 0, 8);
    K.rod(tip, add(tip, [st.sx * 0.03, 0, 0]), 0.011, 'dash', 0.3, hov ? T.piping : T.woodLt, 0, 10);
    const Ps = K.panel(add(tip, [st.sx * 0.015, -0.012, 0.0]), [1, 0, 0], [0, 0.44, 0.9], 'dash', 0.1);
    Ps.fitText(st.name, 0, 0.022, 0.06, 0.0095, T.ink, inkK, 0.001);
    const flash = pressPulse('ln:stf:' + st.id, pressed);
    if (flash > 0.02) K.rod(tip, add(tip, [st.sx * 0.03, 0, 0]), 0.013, 'dash', 0.2, HALO, flash, 10);
  }

  // ── THE TUNNEL: hide over the driveline, a walnut-lidded box and the maker's line down each side ──
  part('tunnel', { line: al.rgb, k: lineK(0.7) }, (K, S) => {
    const y0 = -0.34, y1 = DASH.yMid - 0.04, tz = zF + 0.26;
    K.box(xC - 0.085, y0, zF, xC + 0.085, y1, tz, 'dash', 0.0, T.hideDk);
    K.box(xC - 0.07, -0.26, tz, xC + 0.07, 0.02, tz + 0.05, 'dash', 0.05, T.hide);
    K.box(xC - 0.072, -0.262, tz + 0.05, xC + 0.072, 0.022, tz + 0.058, 'dash', 0.1, T.wood);
    K.rod([xC, 0.022, tz + 0.054], [xC, 0.03, tz + 0.054], 0.008, 'dash', 0.3, T.brass, 0, 8);
    for (const s of [-1, 1]) lightLine(K, [[xC + s * 0.087, y0 + 0.02, tz - 0.01], [xC + s * 0.087, y1 - 0.04, tz - 0.01]], 0.0022, S.line, S.k);
    lightLine(K, [[xC - 0.085, y0, tz + 0.001], [xC - 0.085, y1, tz + 0.001]], 0.0025, T.piping, 0.05);
    lightLine(K, [[xC + 0.085, y0, tz + 0.001], [xC + 0.085, y1, tz + 0.001]], 0.0025, T.piping, 0.05);
    // The passenger's foot rest: a carpeted board.
    K.obox([2 * xC, 0.62, zF + 0.08], [1, 0, 0], norm([0, -0.6, 0.8]), norm([0, 0.8, 0.6]), 0.14, 0.08, 0.008, 'dash', 0.05, T.carpetEdge);
  });

  yawPedals(K, R, zF, { y: 0.66, half: 0.085, z: 0.12, plate: T.alu, rail: T.brassDk, hole: T.woodDk });
  overhead(K, P, R, al.rgb, (R.dome && lit ? 1 : 0.4) * Math.max(amb, 0.2) * (lit ? al.k : 1), { domeY: -0.1 });
  outHoloDraw(K, P, live, F_DIAL);
  hotspotHalo(K, lannerHotspots(P, live), live);
}

// ── THE WHEEL, drawn: built at rest and moved (K.posed), as the Merlin's is ──
function wheel(K, R, live, lit, al) {
  const Wh = wheelAt(R), W0 = WHEEL_REST;
  const X = xfTurn(W0.c, W0.a, -Wh.th, Wh.c);
  const near = eased('ln:near:yoke', live && (live.hover === 'yoke' || live.press === 'yoke') ? 1 : 0, 12);
  K.posed('lnWheel', X, (...a) => wheelBody(K, W0, ...a), lit, Math.round(near * 40) / 40, al.rgb);
}
function wheelBody(K, W, lit, near, line) {
  const { c, a, u, v, P } = W;
  // The column, in a wood shroud with a brass collar.
  K.rod(add(c, mul(a, -0.34)), add(c, mul(a, -0.05)), 0.032, 'dash', 0.05, T.woodDk, 0, 14);
  K.rod(add(c, mul(a, -0.05)), add(c, mul(a, -0.02)), 0.022, 'dash', 0.3, T.brass, 0, 14);
  K.torus(add(c, mul(a, -0.035)), u, v, 0.026, 0.003, 18, 'dash', 0.2, line, lit ? 0.4 + 0.6 * near : 0);
  // The rim: wood, with a brass rivet at each spoke and a pale band at the top, level when straight.
  K.torus(c, u, v, WHEEL.r, WHEEL.tube, 40, 'dash', 0.1, T.woodLt);
  K.torus(c, u, v, WHEEL.r, WHEEL.tube + 0.0008, 3, 'dash', 0.2, T.piping, lit ? 0.15 : 0, Math.PI / 2 - 0.09, Math.PI / 2 + 0.09);
  // Three spokes: drilled aluminium blades to nine, three and six o'clock.
  for (const deg of [0, 180, 270]) {
    const t = deg * DEG, dir = add(mul(u, Math.cos(t)), mul(v, Math.sin(t))), side = add(mul(u, -Math.sin(t)), mul(v, Math.cos(t)));
    K.obox(add(c, mul(dir, WHEEL.r * 0.56)), dir, side, a, WHEEL.r * 0.42, 0.015, 0.0025, 'dash', 0.3, T.alu);
    const Ps = K.panel(add(add(c, mul(dir, WHEEL.r * 0.56)), mul(a, 0.003)), dir, side, 'dash', 0.2);
    for (let i = -2; i <= 2; i++) Ps.disc(i * 0.028, 0, 0.0075 - Math.abs(i) * 0.001, T.woodDk, 0, 0.0005, 10);
    K.rod(add(add(c, mul(dir, WHEEL.r)), mul(a, WHEEL.tube * 0.6)), add(add(c, mul(dir, WHEEL.r)), mul(a, WHEEL.tube + 0.002)), 0.004, 'dash', 0.4, T.brass, 0, 8);
  }
  // The boss: brass, with Hallard's lozenge and bar.
  K.rod(add(c, mul(a, -0.02)), add(c, mul(a, 0.012)), 0.04, 'dash', 0.3, T.brass, 0, 20);
  const Pb = K.panel(add(c, mul(a, 0.0125)), u, v, 'dash', 0.3);
  Pb.disc(0, 0, 0.033, T.bezelBlk, 0, 0.0004, 20);
  Pb.plate([[0, 0.024], [0.016, 0], [0, -0.024], [-0.016, 0]], T.brass, 0.1, 0.001);
  Pb.rect(-0.021, -0.004, 0.021, 0.004, T.piping, 0.1, 0.0016);
}
