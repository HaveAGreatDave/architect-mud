// THE VEX HORNET'S COCKPIT: the inside of the city car, as geometry.
//
// The Hornet is Vex Motors's two-seat mini VTOL (docs/proposals/hover-cars.md), and the
// cockpit is a small cheap car's, done cheerfully: an open tray right across under a big screen, one
// large round dial on a pod in the middle of the car that says everything, a row of eight piano keys
// under it, a sat-nav on a stalk, and a squared-off wheel with the lift on two thumb keys. Check
// cloth on thin upright seats, cream plastic, and Vex's magenta wherever a line goes.
//
// ⚠ THE ROOM IS THE EXTERIOR'S BODY: client/shared/cabin-hornet.js states it, and
// interior-hovercar-kit.js builds the wall, the glass, the floor and the doors off it. Nothing about
// the shape of the cabin is typed here.
//
// ⚠ EVERY CONTROL DRAWN WORKS (docs/reference/cockpit-lettering.md). The rim rolls and pitches the
// aircraft (the 'yoke' hotspot, dragged), the two thumb keys step the lift (ck:padUp, ck:padDn),
// four of the piano keys are the four circuits the sim has and the other four are HOVER, LOCK, BOOST
// and PIT (merlin-modes.js), the sat-nav is the GPS, the HUD knob steps the HUD's colour and each
// door's strap works the doors. Everything is lettered.
//
// Pure: no clock, no camera, no DOM. `live` arrives as an argument.
import { brandTrim } from './interior-brands.js';
import { makeKit, C as KC, clamp, lerp, SHINY, TEXTURE, xfTurn } from './interior-kit.js';
import { memoPart } from './interior-memo.js';
import { hotspotHalo, panelGps, gpsHotspot, lensLamp, eased, pressPulse, HALO, bootAge, reveal, alertLight,
  lightLine, bandFrame, glassBand, windscreenHud, hudTint } from './interior-cockpit-kit.js';
import { MESH_ROWS } from './vehicle-meshes.js';
import { HORNET } from './cabin-hornet.js';
import { hoverCarProfile, readings, night, panelOn, onRoad, driveWord, driveLights, switchOn, doorHotspots, outHoloDraw,
  yawPedals, overhead, roomHalfW, fancyText, drawEmblem, fancyDigits, TAU, add, sub, mul, cross, norm } from './interior-hovercar-kit.js';

// ── THE STYLE ────────────────────────────────────────────────────────────────
// Vex's pale cloth and cream plastic, with a dark check in the cloth and magenta for the accent.
export const HORNET_TRIM = {
  lining: [200, 202, 204], liningDk: [168, 170, 174], headliner: [226, 224, 218],
  carbon: [222, 214, 196], carbonLt: [238, 232, 218], tub: [150, 152, 156],
  cloth: [186, 188, 192], check: [104, 108, 116], accent: [255, 110, 214], accentDk: [176, 60, 140],
  mat: [96, 98, 102], matEdge: [80, 82, 86], grey: [120, 124, 130], dark: [44, 46, 52],
  face: [22, 16, 22], ink: [250, 240, 248], inkDk: [40, 30, 40], bezelBlk: [20, 18, 22],
  glow: [255, 140, 224], glowDim: [110, 56, 96], screen: [16, 8, 14],
  red: [235, 60, 48], amber: [255, 176, 64], marker: [255, 206, 70], green: [120, 214, 140], blue: [120, 176, 255], belt: [60, 62, 68],
};
const T = HORNET_TRIM;
for (const k of ['lining', 'liningDk', 'headliner', 'cloth', 'check']) TEXTURE.set(T[k], 'fabric');
for (const k of ['carbon', 'carbonLt', 'tub', 'grey', 'dark', 'accent', 'accentDk']) TEXTURE.set(T[k], 'plastic');
for (const k of ['mat', 'matEdge']) TEXTURE.set(T[k], 'rubber');
TEXTURE.set(T.belt, 'fabric');
SHINY.set(T.screen, { spec: 0.6, pow: 60 });
brandTrim(T, 'hornet', TEXTURE, SHINY);
SHINY.set(T.accent, { spec: 0.5, pow: 36 });
SHINY.set(T.face, { spec: 0.6, pow: 60 });
SHINY.set(T.grey, { spec: 0.3, pow: 20 });

// Vex letters its dial in a soft squared sans; the keys stay in the legend face.
const F_SOFT = 'chakra';

// ── THE WHEEL ────────────────────────────────────────────────────────────────
// Squared off: a rounded rectangle 34 cm by 28, two flat spokes, a round pad in the middle and a fat
// thumb key on each spoke. Turning it rolls it up to 90 degrees each way; in the air pushing and
// pulling slide it 5 cm along the column; on the road that travel is locked and it only turns.
const WHEEL = { c: [0, 0.46, -0.34], a: 0.17, b: 0.14, tube: 0.015, turn: 1.55, slide: 0.05 };
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
// The rim's outline: a superellipse, squarer than a circle.
const RIM = Array.from({ length: 33 }, (_, i) => { const t = i / 32 * TAU, cs = Math.cos(t), sn = Math.sin(t); return [Math.sign(cs) * Math.abs(cs) ** 0.55 * WHEEL.a, Math.sign(sn) * Math.abs(sn) ** 0.55 * WHEEL.b]; });
// The lift's thumb keys, on the spokes: they turn with the wheel.
const THUMBS = [{ id: 'ck:padUp', x: 0.098, name: 'UP' }, { id: 'ck:padDn', x: -0.098, name: 'DN' }];

// ── THE FASCIA: a short strip under the tray's lip, where the keys are ─────────
const DASH = { yMid: 0.74, sag: 0.05, z0: -0.44, h: 0.11, lean: 0.3 };
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
// The eight keys, left to right: the four circuits, then the four drive keys.
const V_KEY = 0.054;
const KEYS = (xC) => [['master', 'START'], ['land', 'LIGHTS'], ['panel', 'PANEL'], ['dome', 'CABIN'], ['hover', 'HOVER'], ['lock', 'LOCK'], ['boost', 'BOOST'], ['pit', 'PIT']]
  .map(([id, name], i) => ({ id, name, x: xC + (i - 3.5) * 0.05, drive: i > 3 }));
const HUD = { x: 0.165, v: 0.054 };
// The dial: on a pod on the tray in the middle of the car, turned to the driver.
const DIAL = { y: 0.8, zOver: 0.12, rad: 0.085, r: norm([0.94, 0.342, 0]), u: [0, 0, 1] };
const dialAt = (P) => ({ o: [P.xCentre, DIAL.y, DASH.z0 + DASH.h + DIAL.zOver], r: DIAL.r, u: DIAL.u, n: norm(cross(DIAL.r, DIAL.u)) });
// The sat-nav: a small screen on a stalk, between the dial and the wheel.
const NAV = { x: -0.145, y: 0.78, zOver: 0.085, hw: 0.05, hh: 0.036, r: norm([0.985, 0.17, 0]), u: norm([0, 0.2, 0.98]) };
const navAt = () => ({ o: [NAV.x, NAV.y, DASH.z0 + DASH.h + NAV.zOver], r: NAV.r, u: NAV.u });
// The binnacle: a hooded strip behind the wheel for the warnings and the drive word.
const BIN = { y: 0.75, zOver: 0.075 };
const binAt = () => ({ o: [0, BIN.y, DASH.z0 + DASH.h + BIN.zOver], r: [1, 0, 0], u: norm([0, 0.3, 0.95]) });

function hornetHotspots(P, live) {
  const R = readings(live), K = makeKit(() => {}), D = dashOf(P), xC = P.xCentre, out = [];
  for (const k of KEYS(xC)) out.push({ id: 'ck:' + k.id, p: D.at(K, k.x, V_KEY).pt(0, -0.004, 0.014), r: 0.022, kind: 'click' });
  const nv = navAt();
  out.push(gpsHotspot(K.panel(nv.o, nv.r, nv.u, 'dash', 0), 0, 0, 0.04));
  out.push({ id: 'ck:hud', p: D.at(K, HUD.x, HUD.v).pt(0, 0, 0.024), r: 0.024, kind: 'click' });
  const Wh = wheelAt(R);
  out.push({ id: 'yoke', p: Wh.P(WHEEL.a * 0.96, WHEEL.b * 0.3, 0.01), r: 0.05, kind: 'yoke' });
  for (const t of THUMBS) out.push({ id: t.id, p: Wh.P(t.x, 0, 0.014), r: 0.024, kind: 'click' });
  out.push(...doorHotspots(P, live));
  return out;
}

// The cabin's own light: the dial and the sat-nav spill magenta on the cream, with power.
function hornetGlows(P, live) {
  const R = readings(live);
  if (!R.powered) return [];
  const up = reveal(bootAge(live), 0.3);
  if (up <= 0) return [];
  const K = makeKit(() => {}), D = dashOf(P), dl = dialAt(P), nv = navAt();
  return [
    { p: add(dl.o, mul(dl.n, 0.06)), r: 0.26, rgb: T.glow, k: up * 0.8 },
    { p: add(nv.o, [0, -0.05, 0]), r: 0.14, rgb: T.glow, k: up * 0.5 },
    { p: D.at(K, HUD.x, HUD.v).pt(0, 0, 0.05), r: 0.09, rgb: hudTint(R.L.hudTint).line, k: 0.8 },
  ];
}

// ── THE PROFILE ──────────────────────────────────────────────────────────────
export function hornetProfile(doc = MESH_ROWS.hornet) {
  return hoverCarProfile(HORNET, doc, {
    label: 'Vex Hornet', tag: 'pp', fN: 0.62,
    tones: { headliner: T.headliner, upper: T.lining, mid: T.liningDk, lower: T.carbon, doorUpper: T.cloth, doorLower: T.carbon,
      reveal: T.carbonLt, seal: T.glowDim, firewall: T.liningDk, floor: T.mat, floorEdge: T.matEdge, floorLine: null,
      sill: T.tub, sillLine: T.glow, seam: T.tub },
    sillW: 0.06, sillH: 0.08,
    dashY: DASH.yMid - 0.08, dashZ: DASH.z0 + 0.06, seatZ: 0.36, seatHalf: 0.23, seatY: [-0.24, 0.2],
    floods: (xC) => [{ p: [xC * 0.5, 0.5, -0.3], r: 0.55 }, { p: [xC, -0.05, 0.2], r: 0.7 }],
    floodGain: 1.2, glare: 0.24,
    doorCard, roomFit, seats, fit: hornetFit, hotspots: hornetHotspots, glows: hornetGlows,
  });
}

// A check on a flat panel: thin dark lines both ways, and one magenta line a third of the way across.
function checkOn(Pn, hw, hh, step = 0.045) {
  for (let x = -hw + step / 2; x < hw; x += step) Pn.rect(x - 0.0016, -hh, x + 0.0016, hh, T.check, 0, 0.001);
  for (let y = -hh + step / 2; y < hh; y += step) Pn.rect(-hw, y - 0.0016, hw, y + 0.0016, T.check, 0, 0.0012);
  Pn.rect(hw * 0.33 - 0.002, -hh, hw * 0.33 + 0.002, hh, T.accent, 0.1, 0.0016);
}

// ── THE DOOR CARD: a cloth panel, a deep bin, a magenta strap near the front where the latch is ──
function doorCard({ K, S, A, s, D, pull }) {
  // The bin: a long open pocket along the foot of the card.
  const b0 = S(D.f[0] + 0.08, A(-26), 0.03), b1 = S(D.f[1] - 0.1, A(-26), 0.03);
  K.rod(b0, b1, 0.012, 'pil', 0.1, T.carbonLt, 0, 6);
  K.rod(S(D.f[0] + 0.08, A(-32), 0.03), S(D.f[1] - 0.1, A(-32), 0.03), 0.03, 'pil', 0, T.carbon, 0, 4, false);
  // The grab rail under the glass, magenta.
  const cap = [];
  for (let i = 0; i <= 8; i++) cap.push(S(lerp(D.f[0] + 0.04, D.f[1] - 0.04, i / 8), A(HORNET.glass.side.a[0] - 4), 0.012));
  for (let i = 1; i < cap.length; i++) K.rod(cap[i - 1], cap[i], 0.009, 'pil', 0.1, T.accent, 0, 5, false);
  // The pull: a loop of magenta webbing near the front edge, where a coach door latches.
  const p0 = S(D.f[1] - 0.08, A(-2), 0.012), p1 = S(D.f[1] - 0.08, A(-16), 0.012), mid = S(D.f[1] - 0.08, A(-9), 0.05);
  K.rod(p0, mid, 0.008, 'pil', 0.1, T.accent, 0, 4);
  K.rod(mid, p1, 0.008, 'pil', 0.1, T.accent, 0, 4);
  for (const [q, a] of [[p0, -2], [p1, -16]]) K.rod(q, S(D.f[1] - 0.08, A(a), 0), 0.01, 'pil', 0.3, T.grey, 0, 8);
  pull(mid);
  // The speaker: a ring of dots.
  const sc = S(-0.2, A(-12), 0.004), sc2 = S(-0.2, A(-12), 0.03), n = norm(sub(sc2, sc)), r = norm(cross([0, 0, 1], n)), u = cross(n, r);
  const Sp = K.panel(add(sc, mul(n, 0.002)), r, u, 'pil', 0.1);
  for (let ring = 1; ring <= 3; ring++) for (let h = 0; h < ring * 6; h++) { const t = (h / (ring * 6)) * TAU; Sp.disc(Math.cos(t) * ring * 0.014, Math.sin(t) * ring * 0.014, 0.004, T.check, 0, 0.001, 6); }
  void s;
}

// ── THE ROOM'S OWN FITTINGS: a check panel behind each seat, the parcel shelf, a coat hook, the tag ──
function roomFit({ K, xC, zF, yB }) {
  for (const cx of [0, 2 * xC]) {
    const Pp = K.panel([cx, yB + 0.012, zF + 0.75], [1, 0, 0], [0, 0, 1], 'post', 0.1);
    Pp.rect(-0.2, -0.24, 0.2, 0.24, T.cloth, 0, 0.0005);
    checkOn(Pp, 0.2, 0.24, 0.06);
  }
  K.box(xC - 0.5, yB, zF + 1.02, xC + 0.5, yB + 0.09, zF + 1.04, 'post', 0.05, T.carbon);
  K.rod([xC, yB + 0.01, zF + 0.98], [xC, yB + 0.05, zF + 0.97], 0.006, 'post', 0.3, T.accent, 0, 6);
  const Pt = K.panel([xC, yB + 0.014, zF + 0.6], [1, 0, 0], [0, 0, 1], 'post', 0.2);
  Pt.rect(-0.05, -0.016, 0.05, 0.016, T.accent, 0.05, 0.001);
  fancyText(Pt, 'VEX', 0, 0, 0.012, T.ink, 0.2, 0.003, F_SOFT, 0.08);
}

// ── THE SEATS: thin and upright, check cloth, a hole through the headrest, a three-point belt ──
function seats(P, push) {
  const K = makeKit(push, false);
  for (const cx of [0, 2 * P.xCentre]) {
    const h = P.seatHalf, [y0, y1] = P.seatY, sz = P.seatZ, zF = P.hc.zF, side = cx === 0 ? 1 : -1;
    // A single tubular frame leg each side, down to the floor.
    for (const sx of [-1, 1]) { K.rod([cx + sx * (h - 0.03), y0 + 0.05, zF + 0.001], [cx + sx * (h - 0.03), y0 + 0.05, sz - 0.07], 0.012, 'seat', 0.2, T.grey, 0, 6); K.rod([cx + sx * (h - 0.03), y1 - 0.06, zF + 0.001], [cx + sx * (h - 0.03), y1 - 0.06, sz - 0.07], 0.012, 'seat', 0.2, T.grey, 0, 6); }
    K.box(cx - h, y0, sz - 0.07, cx + h, y1, sz, 'seat', 0.02, T.cloth);
    checkOn(K.panel([cx, (y0 + y1) / 2, sz + 0.0005], [1, 0, 0], [0, 1, 0], 'seat', 0.1), h - 0.02, (y1 - y0) / 2 - 0.02);
    K.rod([cx - h, y1, sz - 0.03], [cx + h, y1, sz - 0.03], 0.012, 'seat', 0.1, T.accent, 0, 5);
    // The back: 10 degrees off upright, check on its face, the headrest part of it with a slot through.
    const lean = 0.17, bb = [cx, y0 + 0.01, sz], up = [0, -Math.sin(lean), Math.cos(lean)], fw = [0, Math.cos(lean), Math.sin(lean)];
    const bH = 0.52, bc = add(bb, mul(up, bH / 2));
    K.obox(add(bc, mul(fw, -0.035)), [1, 0, 0], up, fw, h, bH / 2, 0.03, 'seat', -0.02, T.cloth);
    checkOn(K.panel(add(bc, mul(fw, -0.004)), [1, 0, 0], up, 'seat', 0.1), h - 0.02, bH / 2 - 0.02);
    const hc = add(bb, mul(up, bH + 0.09));
    for (const sx of [-1, 1]) K.obox(add(add(bb, mul(up, bH + 0.08)), [sx * 0.085, 0, 0]), [1, 0, 0], up, fw, 0.022, 0.08, 0.028, 'seat', 0.0, T.cloth);
    K.obox(add(add(hc, mul(up, 0.085)), mul(fw, -0.035)), [1, 0, 0], up, fw, 0.107, 0.022, 0.028, 'seat', 0.0, T.cloth);
    // The belt: a diagonal from the outer shoulder to a buckle by the tunnel, and the lap strap.
    const buck = [cx - side * (h - 0.02), y1 - 0.26, sz + 0.04];
    K.rod(add(add(bb, mul(up, bH - 0.02)), [side * (h - 0.03), 0.02, 0]), buck, 0.012, 'seat', 0.05, T.belt, 0, 4);
    K.rod([cx + side * (h - 0.02), y0 + 0.1, sz + 0.02], buck, 0.012, 'seat', 0.05, T.belt, 0, 4);
    K.box(buck[0] - 0.016, buck[1] - 0.012, buck[2] - 0.03, buck[0] + 0.016, buck[1] + 0.012, buck[2] + 0.02, 'seat', 0.2, T.accentDk);
  }
}

// ── THE FIT-OUT ──────────────────────────────────────────────────────────────
function hornetFit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live);
  const zF = P.hc.zF, xC = P.xCentre, D = dashOf(P);
  const lit = R.powered, panel = panelOn(R), boot = bootAge(live);
  const amb = lit ? (night(R) ? 1 : 0.55) * (R.dome ? 1.2 : 1) : 0.05;
  const warn = lit && (R.hull < 0.3 || R.stall), caution = lit && R.fuel < 0.15;
  const al = alertLight(caution, warn, T.line), lineK = (k) => (lit ? k * al.k : 0.05);
  const inkK = panel ? 0.85 : lit ? 0.5 : 0.15;
  // ⚠ THE PARTS THAT DON'T MOVE ARE BUILT ONCE (interior-memo.js memoPart).
  const part = (id, S, fn) => memoPart(push, 'pp:' + id, S, (S2, rec) => fn(makeKit(rec), S2), null);
  const zLip = DASH.z0 + DASH.h;

  // ── THE TRAY: an open shelf from a rolled lip forward to the foot of the screen, the fascia strip
  // under the lip, and the pods that stand on it ──
  part('tray', { line: al.rgb, k: lineK(0.9) }, (K, S) => {
    glassBand(K, D.curve, { h: DASH.h, lean: DASH.lean, segs: 22, lit: false, substrate: T.carbon });
    const N = 22, lip = [], foot = [];
    for (let i = 0; i <= N; i++) { lip.push(D.F.P(i / N, DASH.h + 0.008, 0.006)); foot.push(D.F.P(i / N, -0.004, 0.004)); }
    for (let i = 1; i <= N; i++) K.rod(lip[i - 1], lip[i], 0.02, 'dash', 0.1, T.carbonLt, 0, 8, false);
    lightLine(K, foot.map((q) => add(q, [0, -0.004, -0.008])), 0.003, S.line, S.k);
    // The tray's floor: grey rubber, so nothing slides about, falling a little toward the screen.
    const y0 = DASH.yMid + 0.01, rows = [];
    for (let i = 0; i <= 6; i++) { const y = lerp(y0, y0 + 0.6, i / 6), z = zLip - 0.012 - 0.1 * (i / 6), hw = roomHalfW(P, y, z, 0.03); rows.push([[xC - hw, y, z], [xC + hw, y, z]]); }
    for (let i = 1; i < rows.length; i++) K.face([rows[i - 1][0], rows[i - 1][1], rows[i][1], rows[i][0]], [0, 0, 1], 'dash', -0.15, i % 2 ? T.mat : T.matEdge);
    for (const x of [xC - 0.3, xC + 0.3]) K.rod(D.F.P(D.sOf(x), 0.02, -0.03), [x, DASH.yMid - 0.02, zF + 0.03], 0.016, 'dash', 0.1, T.grey, 0, 6);
    // The car's name moulded into the strip on the passenger's side, and a round vent at each end.
    const Pn = D.at(K, 2 * xC - 0.12, 0.054, 0.004);
    fancyText(Pn, 'HORNET', 0, 0, 0.026, T.accent, 0.15, 0.002, F_SOFT, 0.14);
    for (const x of [D.xL + 0.05, D.xR - 0.045]) {
      const Pv = D.at(K, x, 0.058, 0.004);
      Pv.disc(0, 0, 0.026, T.dark, 0, 0.0005, 18);
      for (let i = -2; i <= 2; i++) Pv.rect(-0.02, i * 0.009 - 0.002, 0.02, i * 0.009 + 0.002, T.grey, 0, 0.002);
      Pv.annulus(0, 0, 0.026, 0.031, T.accent, 0.1, 0.003, 20);
    }
    // The dial's pod and stalk, the sat-nav's stalk, the binnacle's hood.
    const dl = dialAt(P);
    K.rod(add(dl.o, mul(dl.n, -0.002)), add(dl.o, mul(dl.n, -0.06)), DIAL.rad * 1.14, 'dash', 0.15, T.carbonLt, 0, 24);
    K.rod(add(dl.o, mul(dl.n, -0.035)), [dl.o[0], dl.o[1] + 0.02, zLip - 0.03], 0.028, 'dash', 0.1, T.carbon, 0, 10);
    const nv = navAt();
    K.rod(add(nv.o, [0, 0.012, -NAV.hh]), [nv.o[0], nv.o[1] + 0.02, zLip - 0.03], 0.008, 'dash', 0.2, T.grey, 0, 6);
    K.obox(add(nv.o, mul(norm(cross(nv.r, nv.u)), -0.01)), nv.r, nv.u, norm(cross(nv.r, nv.u)), NAV.hw + 0.008, NAV.hh + 0.008, 0.009, 'dash', 0.1, T.dark);
    const bn = binAt(), bnN = norm(cross(bn.r, bn.u));
    K.obox(add(bn.o, mul(bnN, -0.012)), bn.r, bn.u, bnN, 0.1, 0.026, 0.011, 'dash', 0.1, T.carbonLt);
    K.obox(add(add(bn.o, mul(bn.u, 0.03)), mul(bnN, 0.006)), bn.r, bnN, bn.u, 0.104, 0.02, 0.004, 'dash', 0.1, T.carbon);
  });

  // ── THE DIAL: speed on a needle round the rim, height in the middle, charge and lift as arcs
  // either side, the fans as a number, and what the car is doing ──
  {
    const dl = dialAt(P), Pn = K.panel(add(dl.o, mul(dl.n, 0.001)), dl.r, dl.u, 'dash', 0.3), Rr = DIAL.rad, on = lit && reveal(boot, 0.15) >= 1;
    Pn.dial(0, 0, Rr * 0.8, on ? clamp(R.ias / 200, 0, 1) : 0, { ticks: 10, major: 2, red: 0.9, bezel: T.carbonLt, face: T.face, tick: T.ink, needle: T.accent, name: 'KNOTS', nameH: 0.0095, label: T.ink });
    // The outer track, the charge up its left side and the lift up its right.
    Pn.annulus(0, 0, Rr * 0.9, Rr * 1.02, T.bezelBlk, 0, 0.003, 36);
    const arc = (fr, left, rgb) => {
      if (fr <= 0.01) return;
      const a0 = -Math.PI / 2 + (left ? -0.25 : 0.25), span = (Math.PI - 0.5) * fr;
      Pn.annulus(0, 0, Rr * 0.92, Rr, rgb, on ? 0.95 : 0.2, 0.004, Math.max(2, Math.round(16 * fr)), a0, left ? a0 - span : a0 + span);
    };
    arc(on ? R.fuel : 0, true, R.fuel < 0.15 ? T.red : R.fuel < 0.3 ? T.amber : T.green);
    arc(on ? R.thr : 0, false, T.accent);
    fancyText(Pn, 'CHG', -Rr * 0.6, -Rr * 1.13, 0.0095, T.ink, inkK, 0.004, F_SOFT, 0.04);
    fancyText(Pn, 'LIFT', Rr * 0.6, -Rr * 1.13, 0.0095, T.ink, inkK, 0.004, F_SOFT, 0.04);
    if (on) {
      fancyDigits(Pn, -0.03, -Rr * 0.66, 0.015, String(Math.min(99999, Math.round(R.alt))).padStart(5, ' '), T.ink, 0.95, 0.022, 'orbitron');
      fancyText(Pn, 'FT', 0.031, -Rr * 0.58, 0.0075, T.glow, 0.7, 0.008, F_SOFT, 0.014);
      fancyText(Pn, 'FANS ' + Math.round(R.rpm * 100), 0, Rr * 0.3, 0.0085, T.glow, 0.8, 0.008, F_SOFT, 0.07);
      const word = driveWord(R);
      if (word) fancyText(Pn, word, 0, -Rr * 0.22, 0.0095, word === 'PIT' ? T.blue : word === 'ROAD' ? T.marker : word === 'LOCK' ? T.green : T.ink, 0.95, 0.008, F_SOFT, 0.06);
    }
  }
  // ── THE SAT-NAV: the kit's moving map, the screen you click for the GPS ──
  {
    const nv = navAt(), Pn = K.panel(nv.o, nv.r, nv.u, 'dash', 0.3);
    Pn.rect(-NAV.hw - 0.003, -NAV.hh - 0.003, NAV.hw + 0.003, NAV.hh + 0.003, T.bezelBlk, 0, 0.0005);
    if (lit && reveal(boot, 0.3) >= 1) {
      panelGps(Pn, 0, 0, NAV.hw, NAV.hh, live, { label: false, bezel: T.bezelBlk });
      Pn.fitText('NAV', -NAV.hw + 0.014, NAV.hh - 0.008, 0.024, 0.0075, T.ink, 0.6, 0.009);
      Pn.digits(0.004, -NAV.hh + 0.004, 0.0095, String(Math.round(((R.hdg % 360) + 360) % 360)).padStart(3, '0'), T.glow, false);
    }
  }
  // ── THE BINNACLE: the three warnings behind the wheel ──
  {
    const bn = binAt(), Pn = K.panel(bn.o, bn.r, bn.u, 'dash', 0.3);
    const lamps = [['STALL', lit && R.stall, T.amber], ['HULL', lit && R.hull < 0.3, T.red], ['LOW CHG', caution, T.red]];
    lamps.forEach(([name, lampOn, rgb], i) => lensLamp(Pn, -0.062 + i * 0.062, 0, 0.052, 0.022, lampOn && reveal(boot, 0.5) >= 1, rgb, name));
  }
  // ── THE KEYS: eight piano keys under the tray's lip, each tipping in when pressed. The circuits'
  // are cream with a lamp; the drive keys are coloured ──
  {
    const L = driveLights(R, live), cols = { hover: T.marker, lock: T.green, boost: T.red, pit: T.blue };
    for (const k of KEYS(xC)) {
      const id = 'ck:' + k.id, pressed = !!live && live.press === id, hov = !!live && live.hover === id;
      const onNow = k.drive ? L[k.id] : (switchOn(k.id, R) ? 1 : 0);
      const tip = eased('pp:tip:' + k.id, pressed ? 0.35 : !k.drive && onNow ? 0.16 : 0, 26), glow = eased('pp:glow:' + k.id, onNow, 10), near = eased('pp:near:' + k.id, hov ? 1 : 0, 14);
      const Pn = D.at(K, k.x, V_KEY, 0.004), c = D.curve(D.sOf(k.x)), U = D.F.up(c), n = mul(c.f, -1);
      Pn.rect(-0.023, -0.036, 0.023, 0.03, T.dark, 0, 0.0005);
      // The key: hinged along its top edge, its foot swinging into the fascia.
      const hinge = Pn.pt(0, 0.026, 0.01), down = norm(add(mul(U, -Math.cos(tip)), mul(n, -Math.sin(tip)))), kn = norm(cross([1, 0, 0], down));
      const cap = k.drive ? cols[k.id] : k.id === 'master' ? T.red : T.carbonLt;
      K.obox(add(hinge, mul(down, 0.029)), [1, 0, 0], mul(down, -1), kn[1] < 0 ? kn : mul(kn, -1), 0.02, 0.029, 0.006, 'dash', 0.3, cap.map((v) => v * (0.82 + 0.18 * Math.max(glow, near))), lit ? glow * 0.25 : 0);
      const Kc = K.panel(add(add(hinge, mul(down, 0.03)), mul(kn[1] < 0 ? kn : mul(kn, -1), 0.0065)), [1, 0, 0], mul(down, -1), 'dash', 0.3);
      Kc.fitText(k.name, 0, 0.002, 0.036, 0.0086, k.drive || k.id === 'master' ? T.inkDk : T.inkDk, 0, 0.0006);
      Kc.rect(-0.012, 0.018, 0.012, 0.022, onNow > 0.02 ? T.ink : T.dark, lit ? glow : 0, 0.0006);
      const flash = pressPulse('pp:key:' + k.id, onNow > 0);
      if (flash > 0.02) Pn.annulus(0, -0.004, 0.03, 0.034, HALO, flash, 0.016, 4, Math.PI / 4, Math.PI / 4 + TAU);
      // BOOST's heat: a bar under its key, amber, then red past three quarters.
      if (k.id === 'boost' && L.heat > 0.01) Pn.rect(-0.02, -0.043, -0.02 + 0.04 * L.heat, -0.039, L.hot ? T.red : T.amber, lit ? 0.9 : 0.2, 0.002);
    }
  }
  // ── THE HUD KNOB: a cream knob on the strip right of the wheel, its skirt lit in the HUD's colour ──
  {
    const Pn = D.at(K, HUD.x, HUD.v, 0.004), tint = hudTint(R.L.hudTint).line;
    const pressed = !!live && live.press === 'ck:hud', hov = !!live && live.hover === 'ck:hud';
    const dip = eased('pp:dip:hud', pressed ? 0.004 : 0, 30), near = eased('pp:near:hud', hov ? 1 : 0, 14);
    Pn.annulus(0, 0, 0.02, 0.024, tint, lit ? 0.7 + 0.3 * near : 0.05, 0.001, 22);
    K.rod(Pn.pt(0, 0, 0.002), Pn.pt(0, 0, 0.024 - dip), 0.016, 'dash', 0.3, T.carbonLt, 0, 16);
    Pn.fitText('HUD', 0, -0.036, 0.04, 0.0095, T.inkDk, 0, 0.002);
    const Pt = K.panel(Pn.pt(0, 0, 0.0245 - dip), [1, 0, 0], D.F.up(D.curve(D.sOf(HUD.x))), 'dash', 0.1);
    Pt.rect(-0.0016, 0.002, 0.0016, 0.013, tint, lit ? 0.9 : 0.3, 0.0006);
    const flash = pressPulse('pp:hud:' + (R.L.hudTint || 'green'), true);
    if (flash > 0.02) Pn.annulus(0, 0, 0.026, 0.03, HALO, flash, 0.004, 22);
  }

  // ── THE WINDSCREEN HUD: projected, the hands and feet mirrored in its corners ──
  if (lit) windscreenHud(K, R, { dist: 0.6, z: -0.05, hw: 0.13, hh: 0.065, warn, caution, boot: reveal(boot, 0.2),
    mirrors: { stick: [R.ail, R.elev], thrs: [R.thr], rud: R.rud } });

  wheel(makeKit(push), R, live, lit, panel, al);

  // ── BETWEEN THE SEATS: a low open bin and two cup holders, no tunnel to speak of ──
  part('bin', { line: al.rgb, k: lineK(0.7) }, (K, S) => {
    const tz = zF + 0.2;
    K.box(xC - 0.08, -0.3, zF, xC + 0.08, 0.34, tz, 'dash', 0.0, T.carbon);
    K.box(xC - 0.065, -0.26, tz, xC + 0.065, -0.02, tz + 0.002, 'dash', -0.3, T.mat);
    for (const y of [0.1, 0.24]) { K.rod([xC, y, tz - 0.05], [xC, y, tz + 0.002], 0.042, 'dash', -0.25, T.dark, 0, 14); K.torus([xC, y, tz + 0.002], [1, 0, 0], [0, 1, 0], 0.043, 0.004, 16, 'dash', 0.2, T.accent); }
    for (const s of [-1, 1]) lightLine(K, [[xC + s * 0.082, -0.28, tz - 0.01], [xC + s * 0.082, 0.32, tz - 0.01]], 0.0022, S.line, S.k);
    // The passenger's foot rest: ribbed rubber.
    K.obox([2 * xC, 0.7, zF + 0.08], [1, 0, 0], norm([0, -0.6, 0.8]), norm([0, 0.8, 0.6]), 0.14, 0.08, 0.008, 'dash', 0.05, T.matEdge);
  });

  yawPedals(K, R, zF, { y: 0.72, half: 0.085, z: 0.13, plate: T.grey, rail: T.dark, hole: T.accentDk });
  overhead(K, P, R, al.rgb, (R.dome && lit ? 1 : 0.4) * Math.max(amb, 0.2) * (lit ? al.k : 1), { domeY: 0.0, domeR: 0.05, domeOn: [255, 236, 250] });
  outHoloDraw(K, P, live, F_SOFT);
  hotspotHalo(K, hornetHotspots(P, live), live);
}

// ── THE WHEEL, drawn: built at rest and moved (K.posed), as the Merlin's is ──
function wheel(K, R, live, lit, panel, al) {
  const Wh = wheelAt(R), W0 = WHEEL_REST;
  const X = xfTurn(W0.c, W0.a, -Wh.th, Wh.c), q = (x) => Math.round(x * 40) / 40;
  const near = eased('pp:near:yoke', live && (live.hover === 'yoke' || live.press === 'yoke') ? 1 : 0, 12);
  K.posed('ppWheel', X, (...a) => wheelBody(K, W0, ...a), lit, q(near), al.rgb);
  THUMBS.forEach((t, i) => {
    const pressed = !!live && live.press === t.id, hov = !!live && live.hover === t.id;
    const dip = eased('pp:thumb:' + t.id, pressed ? 0.002 : 0.007, 30), flash = pressPulse('pp:thumbf:' + t.id, pressed);
    K.posed('ppThumb:' + t.id, X, (...a) => thumbKey(K, W0, ...a), i, Math.round(dip * 4000) / 4000, hov, flash > 0.02 ? q(flash) : 0, lit, panel);
  });
}
function wheelBody(K, W, lit, near, line) {
  const { c, a, u, v, P } = W;
  // The column, in a cream shroud.
  K.rod(add(c, mul(a, -0.3)), add(c, mul(a, -0.04)), 0.034, 'dash', 0.1, T.carbon, 0, 12);
  K.torus(add(c, mul(a, -0.03)), u, v, 0.03, 0.003, 16, 'dash', 0.2, line, lit ? 0.4 + 0.6 * near : 0);
  // The rim: grey, squared, with a magenta mark at the top, level when it's straight.
  for (let i = 1; i < RIM.length; i++) {
    const top = Math.abs(RIM[i][0]) < 0.04 && RIM[i][1] > 0;
    K.rod(P(RIM[i - 1][0], RIM[i - 1][1]), P(RIM[i][0], RIM[i][1]), WHEEL.tube, 'dash', 0.1, top ? T.accent : T.grey, top && lit ? 0.2 : 0, 8);
  }
  // Two flat spokes and the pad, with Vex's V in a circle.
  for (const s of [-1, 1]) K.obox(P(s * 0.105, 0, -0.004), u, v, a, 0.06, 0.03, 0.007, 'dash', 0.1, T.carbonLt);
  K.rod(add(c, mul(a, -0.02)), add(c, mul(a, 0.008)), 0.05, 'dash', 0.15, T.carbonLt, 0, 20);
  const Pb = K.panel(add(c, mul(a, 0.0085)), u, v, 'dash', 0.3);
  drawEmblem(Pb, 'vex', 0.03, T.accent, T.accent, 0.15);
}
// A thumb key on a spoke: a round magenta pad that sinks, lettered.
function thumbKey(K, W, i, dip, hov, flash, lit, panel) {
  const t = THUMBS[i], { a, u, v, P } = W;
  const Pn = K.panel(P(t.x, 0, 0.0035), u, v, 'dash', 0.3);
  Pn.disc(0, 0, 0.024, T.dark, 0, 0.0005, 20);
  K.rod(Pn.pt(0, 0, 0.001), Pn.pt(0, 0, dip), 0.02, 'dash', 0.3, hov ? T.accent : T.accentDk, lit ? 0.15 : 0, 18);
  const Kc = K.panel(Pn.pt(0, 0, dip + 0.0005), u, v, 'dash', 0.3);
  Kc.fitText(t.name, 0, 0, 0.03, 0.011, T.ink, panel ? 0.8 : 0.45, 0.0006);
  if (flash > 0.02) Pn.annulus(0, 0, 0.025, 0.029, HALO, flash, 0.004, 20);
  void a;
}
