// THE SHRIKE 2076'S COCKPIT: the one seat of the dive striker, as geometry.
//
// The Shrike 2076 is the divebomber class's concept body (mesh_divebomber_2076.json): the Stuka fifty
// years on, after the optionally crewed strike aircraft and loitering munitions of the 2020s. She can
// fly the whole dive herself, and the dive computer will; Halcyon's Warm Hands Rider voids the hull
// cover on any sortie logged without a living pilot at the controls, so the controls are real and
// they work, and the panel says, politely, that they are advisory.
//
// A fighter's seat: you sit back in an ejection seat under a gold-filmed canopy, the centre stick ahead of the
// right console and the throttle on the left, your heels on the pedals under the dash. Across the dash
// is one curved band of glass: the engine page, the flight page, the dive page and the alert page, the
// map, seven glass keys and four lamps. The windscreen carries the head-up symbology; over the dash
// floats a miniature of her that dives as she dives.
//
// ── WHAT IS LEFT OF THE STUKA ────────────────────────────────────────────────
//   · the dive lines: three red lines on the right-hand canopy at 60, 75 and 80 degrees, as the
//     Ju 87's were, and the same three marked on the dive page's protractor;
//   · the dive brakes and the dive computer (the Stuka's automatic pull-out) on one key, DIVE;
//   · the siren, which is now a push alert sent to every tablet in the target zone when she tips
//     past 30 degrees (plugins/flight/index.js, checkDiveSiren). The alert page counts down to the
//     release height, as the Stuka's contact altimeter lamp told the pilot when to press.
//
// ── ⚠ THE ROOM IS THE EXTERIOR'S HULL ───────────────────────────────────────
//
// client/shared/cabin-shrike-2076.js states the chined section, its stations and where the canopy
// glass is; the exterior generator builds the hull and the panes from the same file. The wall here
// is that section walked at its own stations and pushed in by a wall's thickness, the canopy is the
// absence of wall where the layout says glass, and anything that would reach the skin (the dash, the
// consoles) is held to the inside of the section it stands in.
//
// ── ⚠ EVERY READING IS A LIVE VALUE OR DERIVED FROM ONE IN THE OPEN ─────────
//
// The dive gate is the server's (plugins/flight/combat.js cmdBomb): 35 degrees nose-down, 140 knots,
// armed, a bomb on the rack, and below the `high` band, 1200 ft (plugins/flight/state.js ALT_CRUISE).
// The sim has no release timer and no alert timer, so the alert page's countdown is derived here:
// the height still to lose to the release height over the rate she is losing it (alt and vsi). The
// pull-out height is the height a 4 g pull from this dive angle at this speed costs, plus a 200 ft
// floor. The gate (scripts/shapes/cockpit-shrike-2076.mjs) reads the server's numbers back out of
// its source and fails if these drift. Decoration may move on wall time (the alert breathing, the
// boot, the alert's rings); every readout moves only on live values.
import { nightAt } from './sky-keys.js';
import { brandTrim } from './interior-brands.js';
import { makeKit, C, clamp, lerp, SHINY, PANE, TEXTURE } from './interior-kit.js';
import { contactShadow, hotspotHalo, panelGps, gpsHotspot, lensLamp, eased, pressPulse, HALO,
  bootAge, reveal, alertLight, sweep, lightLine, bandFrame, glassBand, holoFrame, holoProjector, windscreenHud,
  wallSec, HOLO, HOLO_LINE, HOLO_AMBER, HOLO_RED, stickColumn } from './interior-cockpit-kit.js';
import { MESH_ROWS } from './vehicle-meshes.js';
import { SH76_M_PER_UNIT, SH76_STATIONS, SH76_RING, SH76_K, SH76_GLASS, SH76_BAY, SH76_INSIDE, SH76_WING, SH76_INTAKE, SH76_NOZZLE,
  sh76Station, sh76Half, sh76Point } from './cabin-shrike-2076.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ── THE DIVE GATE, AS THE SERVER HAS IT ───────────────────────────────────────
// Restated for display; scripts/shapes/cockpit-shrike-2076.mjs checks each against its source.
export const DIVE_GATE = {
  releaseDeg: 35,     // combat.js BOMB_DIVE_DEG
  releaseKt: 140,     // combat.js BOMB_IAS_MIN
  bestDeg: 80,        // combat.js BOMB_BEST_DEG
  releaseFt: 1200,    // state.js ALT_CRUISE: at or over it the band is `high` and the rack refuses
  alertDeg: 30,       // index.js DIVE_ANNOUNCE_DEG: past it the zone below gets the alert
};
// The Stuka's dive lines, on the canopy and on the protractor.
const DIVE_LINES = [60, 75, 80];
// The pull-out: a 4 g pull, and 200 ft of floor under the bottom of it.
const PULL_G = 4, PULL_FLOOR_FT = 200;
// Height lost recovering from a dive of `downDeg` at `ias` knots, in feet: the arc of a pull at
// PULL_G, r = v^2 / (g (n - 1)), and the drop over it r (1 - cos angle).
export function pullOutLossFt(downDeg, ias) {
  const v = Math.max(0, ias) * 0.5144, r = v * v / (9.81 * (PULL_G - 1));
  return r * (1 - Math.cos(clamp(downDeg, 0, 90) * DEG)) * 3.281;
}
// The dive's derived numbers, all off live values: where the gate stands and the two countdowns.
export function diveState(R) {
  const down = -R.pitch, aloft = R.alt > 15 && R.ias > 30;
  const pullFt = PULL_FLOOR_FT + pullOutLossFt(down, R.ias);
  const sink = -R.vsi;                                        // ft a minute, positive going down
  const ang = aloft && down >= DIVE_GATE.releaseDeg, spd = R.ias >= DIVE_GATE.releaseKt;
  const low = aloft && R.alt < DIVE_GATE.releaseFt, arm = R.armed && R.bombs > 0;
  // The alert: the server pushes it the moment she passes 30 degrees down in the air. A repeat within
  // 18 s, or a zone already told within 15 s, is held back there; this shows the trigger, not the hold.
  const alert = aloft && down >= DIVE_GATE.alertDeg;
  // Seconds to the release height at this sink, and to the pull-out height. Null when she is not
  // losing height, zero once she is there.
  const toRel = !aloft ? null : R.alt <= DIVE_GATE.releaseFt ? 0 : sink > 60 ? (R.alt - DIVE_GATE.releaseFt) / sink * 60 : null;
  const toPull = !aloft ? null : R.alt <= pullFt ? 0 : sink > 60 ? (R.alt - pullFt) / sink * 60 : null;
  return { down, aloft, pullFt, ang, spd, low, arm, ready: ang && spd && low && arm, alert, toRel, toPull, pullNow: aloft && down > 10 && R.alt <= pullFt };
}

// ── THE STYLE ────────────────────────────────────────────────────────────────
// Graphite and carbon, the exterior's red as the stitch and the jaw, gold for the canopy's film. The
// light that runs round the room and every display's normal colour is teal; amber is caution, red a
// warning.
export const SH76_TRIM = {
  lining: [58, 62, 66], liningDk: [44, 47, 50], carbon: [30, 32, 34], carbonLt: [52, 56, 60], tub: [22, 24, 26],
  leather: [46, 48, 50], leatherDk: [32, 34, 36], bolster: [26, 28, 30], red: [190, 40, 32],
  glow: [100, 232, 212], glowDim: [34, 88, 82], floor: [34, 36, 38], floorEdge: [24, 26, 28],
  metal: [150, 156, 162], harness: [64, 62, 58], buckle: [176, 182, 190], hazard: [222, 182, 40], black: [16, 16, 18],
  screen: [6, 11, 13], amber: [255, 176, 64], warn: [240, 64, 52], white: [230, 244, 238], dim: [150, 190, 182], dive: [214, 36, 28],
};
const T = SH76_TRIM;
for (const k of ['lining', 'liningDk']) TEXTURE.set(T[k], 'paint');
for (const k of ['carbon', 'carbonLt', 'tub']) TEXTURE.set(T[k], 'plastic');
for (const k of ['leather', 'leatherDk', 'bolster']) TEXTURE.set(T[k], 'leather');
for (const k of ['floor', 'floorEdge']) TEXTURE.set(T[k], 'carpet');
for (const k of ['metal', 'buckle']) TEXTURE.set(T[k], 'brushed');
TEXTURE.set(T.harness, 'fabric');
SHINY.set(T.carbon, { spec: 0.45, pow: 30 });
SHINY.set(T.carbonLt, { spec: 0.4, pow: 26 });
SHINY.set(T.lining, { spec: 0.18, pow: 14 });
SHINY.set(T.metal, { spec: 0.7, pow: 36 });
SHINY.set(T.buckle, { spec: 0.8, pow: 40 });
SHINY.set(T.screen, { spec: 0.6, pow: 60 });
brandTrim(T, 'shrike', TEXTURE, SHINY);
// The dive lines are paint on the glass: red, thin, a little see-through.
const DIVE_PAINT = [214, 36, 28];
PANE.set(DIVE_PAINT, 0.8);

// The pilot's eye: on the centreline over the seat, a fighter pilot's seated eye height over the floor.
const EYE = { f: SH76_INSIDE.pilotF, overFloorM: 0.82 };
const WALL_M = 0.035;
const FN = 0.72;                     // the footwell's forward wall, over the intake's lip
const FB = 0.17;                     // the bulkhead behind the seat, just aft of the canopy's frame

// ── THE PROFILE ──────────────────────────────────────────────────────────────
export function shrike2076Profile(doc = MESH_ROWS.divebomber_2076) {
  if (!doc) return null;
  const m = SH76_M_PER_UNIT;
  const fE = EYE.f, gE = 0, hE = SH76_INSIDE.floorH + EYE.overFloorM / m;
  const X = (g) => (g - gE) * m, Y = (f) => (f - fE) * m, Z = (h) => (h - hE) * m;
  const toShell = (q) => [X(q[1]), Y(q[0]), Z(q[2])];
  const fromShell = (q) => [q[1] / m + fE, q[0] / m + gE, q[2] / m + hE];
  const inset = WALL_M / m;
  const zF = Z(SH76_INSIDE.floorH);
  const G = { m, X, Y, Z, toShell, fromShell, inset, fB: FB, zF, fW: SH76_GLASS.f[0] };
  const room = buildRoom(G);
  const glass = buildGlass(G);

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const see = (q) => {
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]);
    y1 = Math.max(y1, q[1]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]);
  };
  for (const f of room.faces) f.p.forEach(see);
  for (const pn of glass) pn.forEach(see);
  const halfW = Math.max(-x0, x1) + 1e-6;
  const KG = SH76_GLASS.k;
  return {
    label: 'Shrike 2076 seat',
    xCentre: 0, halfW,
    floor: z0 - 1e-6, roof: z1 + 1e-6, front: y1 + 1e-6, back: y0 - 1e-6,
    mPerUnit: m, glassAftY: Y(G.fW),
    // The side rays go out through the canopy beside the pilot's head.
    winY: [Y(fE - 0.03), Y(fE + 0.03)], winZ: [Z(sh76Point(fE, KG[0] + 0.8)[2]), Z(sh76Point(fE, KG[0] + 3)[2])],
    dashY: DASH.yMid - DASH.sag, dashZ: DASH.z0, headerZ: Z(sh76Point(fE, 14)[2]), pillarW: 0.03,
    seatZ: zF + 0.22, seatHalf: 0.2, seatY: [-0.15, 0.4], backZ: 0,
    roofGlass: true,          // straight up from the pilot is the canopy and the sky
    seats: 1, centrePost: 0,
    normalLit: true,
    floods: [{ p: [0, 0.55, -0.25], r: 0.45 }, { p: [0, -0.3, 0.0], r: 0.5 }],
    floodGain: 1.4, glare: 0.25,
    room: sh76Shell,
    glass,
    sh76: { ...G, faces: room.faces },
    hotspots(live) { return sh76Hotspots(this, live); },
  };
}

// The hull's half-width at height h (model units) at station f, `inU` inside the skin; 0 outside its
// height, and the section's lowest and highest h.
function halfWidthAt(f, h, inU) {
  const H = sh76Half(sh76Station(f), -inU);
  for (let i = 0; i < H.length - 1; i++) {
    const [g0, h0] = H[i], [g1, h1] = H[i + 1];
    if ((h - h0) * (h - h1) <= 0 && h1 !== h0) return Math.max(0, lerp(g0, g1, (h - h0) / (h1 - h0)));
  }
  return 0;
}
const hRange = (f, inU) => { const H = sh76Half(sh76Station(f), -inU); return [H[0][1], H[H.length - 1][1]]; };
// Pull a cabin point in until it is `margin` metres inside the hull's skin at its own station and
// height: the dash and the consoles are drawn freely and then held off the wall by this.
function clampIn(G, q, margin = 0.012) {
  let [f, g, h] = G.fromShell(q);
  const inn = G.inset + margin / G.m, [hl, hh] = hRange(f, inn);
  h = clamp(h, hl + 1e-4, hh - 1e-4);
  const gMax = halfWidthAt(f, h, inn);
  if (Math.abs(g) <= gMax && h === G.fromShell(q)[2]) return q;
  return G.toShell([f, Math.sign(g) * Math.min(Math.abs(g), gMax), h]);
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
// Built once per profile: the lining, the canopy's sills and frames, the footwell, the bulkhead, the
// floor and the light along the sills. Nothing here moves.
function buildRoom(G) {
  const { toShell, inset, fB, zF, m } = G;
  const faces = [];
  const put = (p, n, tone, k, rgb, emis) => faces.push({ p, n, tone, k, rgb, emis: emis || 0 });
  const K = makeKit((fs, tone, k, fwd, rgb, emis) => { for (const f of fs) put(f.p, f.n, tone, k, rgb, emis); }, false);
  const S = (f, k, inM = 0) => toShell(sh76Point(f, k, -(inset + inM / m)));
  const centreOf = (f) => { const s = sh76Station(f); return toShell([f, 0, s.cz + (s.top - s.bot) * 0.25]); };
  const inward = (f, k) => {
    const d = 1e-4;
    let n = norm(cross(sub(S(f + d, k), S(f - d, k)), sub(S(f, k + 0.02), S(f, k - 0.02))));
    if (dot(n, sub(centreOf(f), S(f, k))) < 0) n = mul(n, -1);
    return n;
  };
  const aboveFloor = (poly) => clipHalf(poly, (q) => q[2] - zF);
  const GL = SH76_GLASS, KG = GL.k;

  // ── THE SHELL: walked in the hull's own (f, k), bulkhead to footwell, the canopy cut out of it.
  const FS = [fB, GL.f[0]];
  for (let f = 0.225; f < GL.f[1] - 0.01; f += 0.025) FS.push(+f.toFixed(4));
  FS.push(GL.bow, GL.f[1], 0.69, FN);
  FS.sort((a, b) => a - b);
  const NA = 60;
  const hole = [[GL.f[0], KG[0]], [GL.f[1], KG[0]], [GL.f[1], KG[1]], [GL.f[0], KG[1]]];
  const fsU = [...new Set(FS)];
  for (let i = 0; i < fsU.length - 1; i++) {
    for (let j = 0; j < NA; j++) {
      const f0 = fsU[i], f1 = fsU[i + 1], k0 = (j / NA) * SH76_RING, k1 = ((j + 1) / NA) * SH76_RING;
      let cells = [[[f0, k0], [f1, k0], [f1, k1], [f0, k1]]];
      cells = cells.flatMap((c) => (bbOverlap(c, hole) ? subtractConvex(c, hole) : [c]));
      const fm = (f0 + f1) / 2, km = (k0 + k1) / 2, kk = km <= SH76_RING / 2 ? km : SH76_RING - km;
      const n = inward(fm, km);
      for (const c of cells) {
        const poly = aboveFloor(c.map(([f, k]) => S(f, k)));
        if (poly.length < 3) continue;
        if (kk > 13) put(poly, n, 'hdr', -0.24, T.lining);                   // the crown, behind and ahead of the glass
        else if (kk < SH76_K.lower) put(poly, n, 'pil', -0.18, T.tub);
        else if (fm > GL.f[1]) put(poly, n, 'pil', -0.12, T.carbon);        // the footwell, under the nose
        else put(poly, n, 'pil', -0.12, kk >= SH76_K.chine ? T.lining : T.liningDk);
      }
    }
  }

  // ── THE REVEALS: a carbon return round the canopy and a lit seal along its inner edge.
  const revealEdge = (pts, cF, cK, lit = true) => {
    for (let t = 1; t < pts.length; t++) {
      const [fa, ka] = pts[t - 1], [fb, kb] = pts[t];
      const i0 = S(fa, ka), i1 = S(fb, kb), o0 = toShell(sh76Point(fa, ka, -0.003 / m)), o1 = toShell(sh76Point(fb, kb, -0.003 / m));
      const fm = (fa + fb) / 2, km = (ka + kb) / 2;
      const toC = sub(S(cF, cK), S(fm, km));
      const out = norm(sub(toShell(sh76Point(fm, km, 0)), S(fm, km)));
      const rn = norm(sub(toC, mul(out, dot(toC, out))));
      if (i0[2] > zF && i1[2] > zF) put([i0, i1, o1, o0], rn, 'pil', 0.05, T.carbon);
      if (lit && i0[2] > zF + 0.01 && i1[2] > zF + 0.01) K.rod(S(fa, ka, 0.006), S(fb, kb, 0.006), 0.003, 'pil', 0.1, T.glowDim, 0.35, 5, false);
    }
  };
  const edge = (f0, k0, f1, k1, n) => Array.from({ length: n + 1 }, (_, i) => [lerp(f0, f1, i / n), lerp(k0, k1, i / n)]);
  const fMid = (GL.f[0] + GL.f[1]) / 2;
  revealEdge(edge(GL.f[0], KG[0], GL.f[1], KG[0], 16), fMid, KG[0] + 3);
  revealEdge(edge(GL.f[0], KG[1], GL.f[1], KG[1], 16), fMid, KG[1] - 3);
  revealEdge(edge(GL.f[1], KG[0], GL.f[1], KG[1], 20), GL.f[1] - 0.05, 15, false);
  revealEdge(edge(GL.f[0], KG[0], GL.f[0], KG[1], 20), GL.f[0] + 0.05, 15, false);
  // ── THE FRAMES: the canopy's bow over your head where the windscreen meets it, and the two posts
  // of the three-pane windscreen, as the exterior has them; the bow carries its lit seal.
  {
    const bow = edge(GL.bow, KG[0] - 0.2, GL.bow, KG[1] + 0.2, 24).map(([f, k]) => S(f, k, 0.008));
    for (let i = 1; i < bow.length; i++) K.rod(bow[i - 1], bow[i], 0.011, 'post', 0.05, T.carbon, 0, 6, false);
    const seal = edge(GL.bow - 0.004, KG[0] + 0.4, GL.bow - 0.004, KG[1] - 0.4, 20).map(([f, k]) => S(f, k, 0.02));
    for (let i = 1; i < seal.length; i++) K.rod(seal[i - 1], seal[i], 0.0025, 'post', 0.2, T.glow, 0.7, 4, false);
    for (const k of [11.5, SH76_RING - 11.5]) K.rod(S(GL.bow, k, 0.008), S(GL.f[1], k, 0.008), 0.008, 'post', 0.05, T.carbon, 0, 6, false);
    // The canopy's aft frame, heavier, with the two handles the pilot pulls it down by.
    const aft = edge(GL.f[0] + 0.003, KG[0] - 0.2, GL.f[0] + 0.003, KG[1] + 0.2, 24).map(([f, k]) => S(f, k, 0.012));
    for (let i = 1; i < aft.length; i++) K.rod(aft[i - 1], aft[i], 0.016, 'post', 0.05, T.carbon, 0, 6, false);
    for (const k of [11, SH76_RING - 11]) {
      const p0 = S(GL.f[0] + 0.012, k - 0.6, 0.03), p1 = S(GL.f[0] + 0.012, k + 0.6, 0.03);
      K.rod(p0, p1, 0.008, 'post', 0.3, T.metal, 0, 8);
      K.rod(p0, S(GL.f[0] + 0.004, k - 0.6, 0.012), 0.005, 'post', 0.3, T.metal, 0, 6);
      K.rod(p1, S(GL.f[0] + 0.004, k + 0.6, 0.012), 0.005, 'post', 0.3, T.metal, 0, 6);
    }
  }
  // ── THE DIVE LINES: three red lines on the right-hand canopy, at 60, 75 and 80 degrees to the
  // horizontal, painted on the inside of the glass where the Ju 87's were. You hold the dive by
  // laying the horizon along one of them.
  {
    DIVE_LINES.forEach((d, i) => {
      const c = S(0.455 + i * 0.012, 11.2, 0.006), a = d * DEG, L = 0.08;
      const dir = norm([0, Math.cos(a), -Math.sin(a)]);
      const p0 = clampIn(G, add(c, mul(dir, -L * 0.5)), 0.006), p1 = clampIn(G, add(c, mul(dir, L * 0.5)), 0.006);
      K.rod(p0, p1, 0.0016, 'post', 0.2, DIVE_PAINT, 0.35, 4, false);
    });
  }

  // ── THE BULKHEAD behind the seat, and THE FOOTWELL'S WALL ahead of the pedals ──
  const ring = (f) => { const o = []; for (let k = 0; k <= 60; k++) o.push(S(f, (k / 60) * SH76_RING)); return aboveFloor(o); };
  const fw = ring(FN);
  if (fw.length >= 3) put(fw, [0, -1, 0], 'post', -0.15, T.carbon);
  const bk = ring(fB);
  if (bk.length >= 3) put(bk, [0, 1, 0], 'post', -0.12, T.carbon);
  const yB = G.Y(fB);
  // The seat's rails up the bulkhead, and the light along its top.
  for (const s of [-1, 1]) K.box(s * 0.12 - 0.012, yB, zF, s * 0.12 + 0.012, yB + 0.03, zF + 0.74, 'post', 0.1, T.metal);
  K.box(-0.13, yB + 0.004, zF + 0.75, 0.13, yB + 0.018, zF + 0.765, 'post', 0.2, T.glow, 0.8);

  // ── THE FLOOR: a carbon trough from the bulkhead to the footwell, edged in light ──
  const floorHalf = (f) => halfWidthAt(f, SH76_INSIDE.floorH, inset) * m;
  const FF = [];
  for (let f = fB; f < FN; f += 0.025) FF.push(f);
  FF.push(FN);
  for (let i = 0; i < FF.length - 1; i++) {
    const f0 = FF[i], f1 = FF[i + 1], w0 = floorHalf(f0), w1 = floorHalf(f1);
    if (w0 <= 0.01 || w1 <= 0.01) continue;
    put([[-w0, G.Y(f0), zF], [w0, G.Y(f0), zF], [w1, G.Y(f1), zF], [-w1, G.Y(f1), zF]], [0, 0, 1], 'floor', -0.2, i % 6 === 5 ? T.floorEdge : T.floor);
    for (const s of [-1, 1]) K.box(s * (w0 - 0.03) - 0.005, G.Y(f0), zF + 0.001, s * (w0 - 0.03) + 0.005, G.Y(f1), zF + 0.004, 'floor', 0.2, T.glow, 0.8);
  }
  return { faces };
}

// ── THE GLASS ────────────────────────────────────────────────────────────────
// The panes the renderer lays over the room as film, faceted along the hull in (f, k), 5 mm inside
// the skin and outboard of every reveal.
function buildGlass(G) {
  const { toShell, m } = G;
  const d = 0.005 / m;
  const panes = [];
  const GL = SH76_GLASS, KG = GL.k;
  const grid = (f0, f1, k0, k1, nf, nk) => {
    for (let i = 0; i < nf; i++) for (let j = 0; j < nk; j++) {
      const fa = lerp(f0, f1, i / nf), fb = lerp(f0, f1, (i + 1) / nf), ka = lerp(k0, k1, j / nk), kb = lerp(k0, k1, (j + 1) / nk);
      panes.push([[fa, ka], [fb, ka], [fb, kb], [fa, kb]].map(([f, k]) => toShell(sh76Point(f, k, -d))));
    }
  };
  grid(GL.f[0], GL.bow, KG[0], KG[1], 12, 24);
  grid(GL.bow, GL.f[1], KG[0], KG[1], 5, 24);
  return panes;
}

// A convex cell minus a convex hole, as disjoint convex pieces (interior-drake.js's own method).
const area2 = (P) => { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
function subtractConvex(cell, hole) {
  const pieces = [];
  let rest = cell;
  for (let i = 0; i < hole.length && rest.length >= 3; i++) {
    const a = hole[i], b = hole[(i + 1) % hole.length];
    const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const out = clipHalf(rest, (p) => -side(p));
    if (out.length >= 3 && Math.abs(area2(out)) > 1e-12) pieces.push(out);
    rest = clipHalf(rest, side);
  }
  return pieces;
}
const bbOf = (P) => [Math.min(...P.map((p) => p[0])), Math.min(...P.map((p) => p[1])), Math.max(...P.map((p) => p[0])), Math.max(...P.map((p) => p[1]))];
const bbOverlap = (A, B) => { const a = bbOf(A), b = bbOf(B); return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]; };
function clipHalf(poly, s) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], sa = s(a), sb = s(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push(a.map((v, k) => v + (b[k] - v) * t));
    }
  }
  return out;
}

// ── THE SHELL, AS interior-shell.js CALLS IT ─────────────────────────────────
function sh76Shell(P, live, push, rich) {
  const D = P.sh76;
  for (const f of D.faces) push(f.one || (f.one = Object.assign([{ p: f.p, n: f.n }], { stable: true })), f.tone, f.k, false, f.rgb, f.emis || 0);
  seat(P, push);
  if (rich) sh76Fit(P, live, push);
}

// ── THE READINGS ─────────────────────────────────────────────────────────────
const readings = (live) => {
  const L = live || {};
  return {
    L,
    pitch: num(L.pitch), bank: num(L.bank), hdg: num(L.hdg),
    ias: Math.max(0, num(L.ias)), vne: Math.max(40, num(L.vne, 330)),
    alt: Math.max(0, num(L.alt)), vsi: num(L.vsi),
    rpm: clamp(num(L.rpm), 0, 1.1), thr: clamp(num(L.throttle), 0, 1),
    fuel: clamp(num(L.fuel, 1), 0, 1), hull: clamp(num(L.hull, 1), 0, 1),
    temp: clamp(num(L.oilTemp, 0.4), 0, 1),
    powered: L.powered !== false,
    ail: clamp(num(L.stickX), -1, 1), elev: clamp(num(L.stickY), -1, 1), rud: clamp(num(L.rudder), -1, 1),
    trim: clamp(num(L.trim), -1, 1), flap: clamp(Math.round(num(L.flapNotch)), 0, 3),
    land: !!L.landingLight, dome: !!L.dome, hour: ((num(L.hour, 12) % 24) + 24) % 24,
    armed: !!L.weaponsArmed, bombs: Math.max(0, Math.round(num(L.bombs))), diveAuto: num(L.diveBrake) > 0,
    phase: num(L.phase), stall: !!L.stall,
  };
};
const night = (R) => nightAt(R.hour);
const panelOn = (R) => R.powered && (R.L.panelLight != null ? !!R.L.panelLight : night(R));
const RACK = 4;                     // the rack's stations, as the type carries them (aircraft_types: bombs 4)

// ── WHERE THE CONTROLS ARE ───────────────────────────────────────────────────
// One place says where each thing you can grab is; the drawing and the hotspots both read it. The
// stick is on a column ahead of the pilot, the throttle and the trim wheel on the left, at arm's rest.
const CONSOLE = { x: 0.3, top: 0.42, w: 0.065, y0: -0.12, y1: 0.46 };   // top: z off the floor
const STICK = { x: 0, y: 0.3, len: 0.14 };
const LEVER = { x: -0.3, pivotY: 0.14, len: 0.14 };
const TRIMW = { x: -0.3, y: 0.38, r: 0.04 };
function stickAt(P, R) {
  const base = [STICK.x, STICK.y, P.sh76.zF + CONSOLE.top + 0.012];
  const dir = norm([R.ail * 0.25, -R.elev * 0.25 + 0.06, 1]);
  return { base, top: add(base, mul(dir, STICK.len)), dir };
}
function leverAt(P, R) {
  const pivot = [LEVER.x, LEVER.pivotY, P.sh76.zF + CONSOLE.top];
  const ang = -0.6 + R.thr * 1.2;
  const dir = [0, Math.sin(ang), Math.cos(ang)];
  return { pivot, end: add(pivot, mul(dir, LEVER.len)), dir, ang };
}

// ── THE DASH: a sculpted wing across the hull, and on its face toward you one band of glass ──
const DASH = { xL: -0.33, xR: 0.33, yMid: 0.62, sag: 0.13, w: 0.33, z0: -0.4, h: 0.22, lean: 0.4 };
function dashCurve() {
  return (s) => {
    const x = lerp(DASH.xL, DASH.xR, s), q = x / DASH.w;
    const y = DASH.yMid - DASH.sag * q * q, dy = -2 * DASH.sag * q / DASH.w;
    return { p: [x, y, DASH.z0], f: norm([-dy, 1, 0]) };
  };
}
const sOf = (x) => (x - DASH.xL) / (DASH.xR - DASH.xL);
const bandPanel = (K, x, v, lift = 0.005) => bandFrame(dashCurve(), DASH.lean).at(K, sOf(x), v, lift);

// ── ⚠ EVERY CONTROL IN ONE FORWARD VIEW ──────────────────────────────────────
// The seven keys the sim has for this seat (power, three lighting circuits, the flaps, master arm and
// the dive computer) are glass keys along the band's foot, the map beside them, so a forward look
// shows every one and its state. The stick, the throttle and the pedals sit low, so each is mirrored
// in the windscreen HUD, and the flap key carries its own four-notch gauge.
const BTN = { ids: ['master', 'land', 'panel', 'dome', 'flaps', 'arm', 'dive'],
  names: { master: 'PWR', land: 'LAND', panel: 'PANEL', dome: 'CABIN', flaps: 'FLAP', arm: 'ARM', dive: 'DIVE' } };
const KEY_V = 0.042, KEY_R = 0.021;
const BTN_X = [-0.168, -0.118, -0.068, -0.018, 0.032, 0.082, 0.132];
function switchOn(id, R) {
  if (id === 'master') return R.powered;
  if (id === 'land') return R.land;
  if (id === 'panel') return panelOn(R);
  if (id === 'dome') return R.dome && R.powered;
  if (id === 'flaps') return R.flap > 0;
  if (id === 'arm') return R.armed;
  if (id === 'dive') return R.diveAuto;
  return R.powered;
}
// The pages on the band's upper row, and the map at the left of its foot.
const SCREENS = [
  { id: 'eng', x: -0.234, w: 0.072, boot: 0.3 },
  { id: 'pfd', x: -0.078, w: 0.072, boot: 0 },
  { id: 'dive', x: 0.078, w: 0.072, boot: 0.15 },
  { id: 'alert', x: 0.234, w: 0.072, boot: 0.45 },
];
const PAGE_V = 0.15, PAGE_H = 0.062;
const MAP = { x: -0.258, v: 0.042, hw: 0.048, hh: 0.032, boot: 0.2 };
const LAMP = { x: [0.208, 0.29], w: 0.074, h: 0.026, v: [0.058, 0.024] };
const LAMPS = [['PILOT', 0, 0], ['ADVISORY', 0, 1], ['ALERT', 1, 0], ['RELEASE', 1, 1]];
const screenPanel = (K, sc) => bandPanel(K, sc.x, PAGE_V, 0.013);

export function sh76Hotspots(P, live) {
  const R = readings(live), K = makeKit(() => {}), out = [];
  BTN.ids.forEach((id, i) => out.push({ id: 'ck:' + id, p: bandPanel(K, BTN_X[i], KEY_V).pt(0, 0, 0.01), r: KEY_R + 0.002, kind: 'click' }));
  out.push({ id: 'yoke', p: add(stickAt(P, R).top, [0, 0, 0.04]), r: 0.055, kind: 'yoke' });
  const lv = leverAt(P, R);
  out.push({ id: 'throttle', p: add(lv.end, mul(lv.dir, 0.03)), r: 0.045, kind: 'throttle' });
  out.push({ id: 'trim', p: [TRIMW.x, TRIMW.y, P.sh76.zF + CONSOLE.top + 0.01], r: 0.045, kind: 'trim' });
  out.push(gpsHotspot(bandPanel(K, MAP.x, MAP.v, 0.008), 0, 0, 0.045));
  return out;
}

// ── THE SEAT: an ejection seat, reclined a fighter's 18 degrees ──
function seat(P, push) {
  const K = makeKit(push, false);
  const zF = P.sh76.zF, hip = [0, -0.02, zF + 0.22];
  const lean = 18 * DEG, up = [0, -Math.sin(lean), Math.cos(lean)], fw = [0, Math.cos(lean), Math.sin(lean)];
  const hw = 0.2;
  // The bucket: a pan under the thighs on the survival kit, its sides up past the hips.
  const panDir = norm([0, 1, 0.12]), panUp = norm(cross([1, 0, 0], panDir));
  const pc = add(hip, mul(panDir, 0.2));
  K.obox(add(pc, mul(panUp, -0.03)), [1, 0, 0], panDir, panUp, hw, 0.22, 0.03, 'seat', 0.0, T.carbon);
  K.obox(add(pc, mul(panUp, 0.006)), [1, 0, 0], panDir, panUp, hw - 0.04, 0.2, 0.012, 'seat', 0.05, T.leather);
  K.box(-0.17, hip[1] - 0.06, zF, 0.17, hip[1] + 0.36, hip[2] - 0.06, 'seat', -0.25, T.tub);
  // The back, the side rails and the headbox.
  const bL = 0.62, bc = add(hip, mul(up, bL / 2));
  K.obox(add(bc, mul(fw, -0.04)), [1, 0, 0], up, fw, hw, bL / 2, 0.035, 'seat', -0.06, T.carbon);
  K.obox(add(bc, mul(fw, 0.002)), [1, 0, 0], up, fw, hw - 0.05, bL / 2 - 0.05, 0.012, 'seat', 0.0, T.leather);
  for (const s of [-1, 1]) {
    K.obox(add(bc, [s * (hw - 0.02), 0, 0]), [1, 0, 0], up, fw, 0.022, bL / 2 + 0.02, 0.045, 'seat', 0.0, T.bolster);
    K.obox(add(add(bc, mul(fw, 0.046)), [s * (hw - 0.02), 0, 0]), [1, 0, 0], up, fw, 0.003, bL / 2 - 0.02, 0.002, 'seat', 0.2, T.red, 0.4);
  }
  for (let r = 1; r < 7; r++) K.obox(add(add(hip, mul(up, r * bL / 7)), mul(fw, 0.015)), [1, 0, 0], up, fw, hw - 0.06, 0.003, 0.002, 'seat', -0.2, T.leatherDk);
  const hc = add(hip, mul(up, bL + 0.08));
  K.obox(add(hc, mul(fw, -0.05)), [1, 0, 0], up, fw, 0.13, 0.095, 0.06, 'seat', 0.0, T.carbon);
  K.obox(add(hc, mul(fw, 0.012)), [1, 0, 0], up, fw, 0.085, 0.07, 0.008, 'seat', 0.0, T.leather);
  // The canopy breakers on the headbox's top corners, yellow.
  for (const s of [-1, 1]) K.obox(add(add(hc, mul(up, 0.09)), [s * 0.095, 0, 0]), [1, 0, 0], up, fw, 0.016, 0.01, 0.02, 'seat', 0.2, T.hazard);
  // A five-point harness and its rotary buckle.
  const top = add(hip, mul(up, bL - 0.02)), buck = add(add(hip, mul(panDir, 0.17)), [0, 0, 0.1]);
  for (const s of [-1, 1]) {
    K.rod(add(add(top, mul(fw, 0.03)), [s * 0.06, 0, 0]), add(buck, [s * 0.025, 0, 0.02]), 0.012, 'seat', 0.05, T.harness, 0, 4);
    K.rod(add(add(hip, mul(panDir, 0.06)), [s * (hw - 0.03), 0, 0.05]), add(buck, [s * 0.025, 0, -0.01]), 0.012, 'seat', 0.05, T.harness, 0, 4);
  }
  K.rod(add(add(hip, mul(panDir, 0.3)), [0, 0, 0.0]), add(buck, [0, 0, -0.015]), 0.01, 'seat', 0.05, T.harness, 0, 4);
  K.rod(add(buck, [0, -0.008, 0]), add(buck, [0, 0.01, 0]), 0.03, 'seat', 0.3, T.buckle, 0, 12);
  // The ejection handle between the knees: a yellow and black loop on the front of the pan.
  const hb = add(hip, mul(panDir, 0.42));
  for (let i = 0; i < 6; i++) {
    const a0 = Math.PI * i / 6, a1 = Math.PI * (i + 1) / 6;
    K.rod(add(hb, [Math.cos(a0) * 0.05, 0.01, Math.sin(a0) * 0.04]), add(hb, [Math.cos(a1) * 0.05, 0.01, Math.sin(a1) * 0.04]), 0.008, 'seat', 0.2, i % 2 ? T.black : T.hazard, 0, 6);
  }
}

// ── THE FIT-OUT ──────────────────────────────────────────────────────────────
export function sh76Fit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live);
  const G = P.sh76, zF = G.zF;
  const lit = R.powered, panel = panelOn(R);
  const boot = bootAge(live);
  const D = diveState(R);
  // The cabin's light lines carry the alert: teal, amber while the zone is being told she is coming
  // or on low fuel, red and breathing under the pull-out height, on a hull or a stall warning.
  const warn = lit && (R.hull < 0.3 || R.stall || D.pullNow), caution = lit && (R.fuel < 0.15 || D.alert);
  const al = alertLight(caution, warn, T.line), lineK = (k) => (lit ? k * al.k : 0.05);

  // ── THE DASH: a wing swept along the band's curve, held inside the hull ──
  const curve = dashCurve();
  const gt = [DASH.h * DASH.lean / Math.hypot(1, DASH.lean), DASH.h / Math.hypot(1, DASH.lean)];
  const SEC = [[0, 0], gt, [0.11, gt[1] + 0.022], [0.19, gt[1] + 0.01], [0.22, gt[1] - 0.03], [0.18, -0.05], [0.08, -0.11], [-0.04, -0.08], [-0.05, -0.035], [0, 0]];
  const N = 28, rings = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N, c = curve(s), e = Math.abs(2 * s - 1) ** 3, tap = 1 - 0.5 * e;
    rings.push(SEC.map(([f, z]) => {
      const ff = f > gt[0] ? gt[0] + (f - gt[0]) * tap : f < 0 ? f * tap : f;
      return clampIn(G, [c.p[0] + c.f[0] * ff, c.p[1] + c.f[1] * ff, c.p[2] + z], 0.01);
    }));
  }
  sweep(K, rings, 'dash', 0.1, T.carbon);
  for (const r of [rings[0], rings[N]]) {
    const n = norm(cross(sub(r[3], r[1]), sub(r[6], r[1])));
    K.face(r.slice(0, -1), n, 'dash', 0.05, T.carbonLt);
    K.face(r.slice(0, -1).reverse(), mul(n, -1), 'dash', 0.05, T.carbonLt);
  }
  lightLine(K, rings.map((r) => r[7]), 0.0028, al.rgb, lineK(0.8));
  lightLine(K, rings.slice(2, -2).map((r) => add(r[3], [0, 0, 0.002])), 0.002, al.rgb, lineK(0.35));
  // The jaw's red along the glare shield's lip, as the exterior wears it along the chine.
  lightLine(K, rings.slice(4, -4).map((r) => add(r[2], [0, 0, 0.003])), 0.0016, T.red, lit ? 0.5 : 0.1);
  // The strut the dash hangs off, down to the floor between the pedals.
  { const c = curve(0.5), top = add(add(c.p, mul(c.f, 0.1)), [0, 0, -0.1]); K.rod(top, [0, top[1] + 0.02, zF + 0.03], 0.02, 'dash', 0.1, T.carbon, 0, 8); }

  // ── THE BAND: one sheet of glass, the pages on it, booting in turn when the power comes on ──
  glassBand(K, curve, { h: DASH.h, lean: DASH.lean, segs: 30, lit, light: al.rgb, lightK: lineK(1), substrate: T.screen });
  for (const sc of SCREENS) {
    const Pn = screenPanel(K, sc), up = reveal(boot, sc.boot);
    if (!lit || up <= 0) continue;
    if (up < 1) {
      const y = lerp(-PAGE_H, PAGE_H, up);
      Pn.rect(-sc.w, -PAGE_H, sc.w, y, T.screen, 0.3 * up, 0.001);
      Pn.rect(-sc.w, y - 0.002, sc.w, y + 0.002, T.glow, 1, 0.0025);
      continue;
    }
    // One display language: a lit edge along the top, teal normal, amber caution, red warning, the
    // current value the brightest thing on the page. The dive and alert pages' edge takes their state.
    const edgeRgb = sc.id === 'dive' ? (D.pullNow ? T.warn : D.ready ? C.green : T.glow) : sc.id === 'alert' ? (D.alert ? T.warn : T.glow) : T.glow;
    Pn.rect(-sc.w + 0.004, PAGE_H - 0.0035, sc.w - 0.004, PAGE_H - 0.0015, edgeRgb, 0.85, 0.0018);
    if (sc.id === 'pfd') pfd(Pn, R);
    else if (sc.id === 'eng') engPage(Pn, R);
    else if (sc.id === 'dive') divePage(Pn, R, D);
    else if (sc.id === 'alert') alertPage(Pn, R, D);
  }
  // The map, at the left of the band's foot: the one page you click.
  {
    const Pn = bandPanel(K, MAP.x, MAP.v, 0.008), up = reveal(boot, MAP.boot);
    if (lit && up >= 1) {
      panelGps(Pn, 0, 0, MAP.hw, MAP.hh, live, { label: false, bezel: [8, 14, 16] });
      const g = live && live.gpsTo;
      if (g && Number.isFinite(g.dist)) Pn.digits(0.012, -0.027, 0.011, String(Math.min(999, Math.round(g.dist))).padStart(3, ' '), T.glow, false);
    } else if (lit && up > 0) Pn.rect(-MAP.hw, -MAP.hh, MAP.hw, lerp(-MAP.hh, MAP.hh, up), T.screen, 0.3, 0.001);
  }
  // The status lamps at the right of the foot. ⚠ PILOT is the Rider's lamp: lit whenever the seat is
  // powered and occupied, which is whenever this cockpit is drawn. ALERT is the zone being told;
  // RELEASE is the whole gate open.
  {
    const on = lit && reveal(boot, 0.6) >= 1;
    const state = { PILOT: [on, C.green], ADVISORY: [on, T.amber], ALERT: [on && D.alert, T.warn], RELEASE: [on && D.ready, C.green] };
    for (const [name, col, row] of LAMPS) lensLamp(bandPanel(K, LAMP.x[col], LAMP.v[row], 0.01), 0, 0, LAMP.w, LAMP.h, state[name][0], state[name][1], name);
  }

  // ── THE KEYS: seven glass keys along the band's foot ──
  // A key sinks while pressed and comes back, its light eases with the circuit, it brightens as the
  // hand comes over it, and a ring flashes round it when its state changes.
  BTN.ids.forEach((id, i) => {
    const Kp = bandPanel(K, BTN_X[i], KEY_V, 0.004), on = switchOn(id, R);
    const pressed = !!live && live.press === 'ck:' + id, near = !!live && live.hover === 'ck:' + id;
    const rgb = id === 'master' ? C.green : id === 'arm' ? T.warn : id === 'dive' ? T.amber : T.glow;
    const glow = eased('sh76:glow:' + id, on && (id === 'master' || lit) ? 1 : 0, 10), depth = eased('sh76:dip:' + id, pressed ? 0.002 : 0.007, 30);
    const hand = eased('sh76:near:' + id, near ? 1 : 0, 14);
    const r = KEY_R;
    Kp.rect(-r - 0.002, -r - 0.002, r + 0.002, r + 0.002, T.tub, 0, 0.0005);
    Kp.annulus(0, 0, r - 0.001, r + 0.001, T.glow, (lit ? 0.25 : 0) + hand * 0.75, 0.0012, 20);
    Kp.stud(0, 0, r - 0.003, r - 0.003, depth, rgb.map((c, k) => lerp([40, 46, 50][k], c, glow * 0.8)), glow * 0.85 + hand * 0.15, 0.0015);
    Kp.fitText(BTN.names[id], 0, id === 'flaps' ? 0.002 : -0.004, 0.04, 0.012, glow > 0.5 ? [10, 24, 22] : [214, 222, 220], glow > 0.5 ? 0 : (panel ? 0.6 : 0.25), depth + 0.0025);
    if (id === 'flaps') for (let k = 0; k < 4; k++) {
      const u = -0.0135 + k * 0.009, here = lit && k <= R.flap;
      Kp.rect(u - 0.0032, -0.016, u + 0.0032, -0.011, here ? (k === R.flap ? T.white : T.glow) : [50, 60, 60], here ? 1 : 0.2, depth + 0.003);
    }
    const flash = pressPulse('sh76:key:' + id, id === 'flaps' ? R.flap : on);
    if (flash > 0.02) Kp.annulus(0, 0, r + 0.004, r + 0.008, HALO, flash, 0.004, 18);
  });

  // ── THE WINDSCREEN HUD: projected, conformal, the hands and feet mirrored in its corners ──
  if (lit) windscreenHud(K, R, { dist: 0.5, z: 0.0, hw: 0.15, hh: 0.075, warn, caution, boot: reveal(boot, 0.2),
    mirrors: { stick: [R.ail, R.elev], thrs: [R.thr], rud: R.rud } });

  // ── THE HOLOGRAM on the dash's shelf: the striker herself, diving as she dives ──
  // Pitched and banked with her, the turbine turning on the prop phase and ringed at its speed, the
  // brakes out and the bay open while the dive computer has her, the bombs on the rack, rings off
  // the broadcasters while the zone is being told; on a projector whose arc is the fuel.
  {
    const c0 = curve(0.5), base = clampIn(G, add(add(c0.p, mul(c0.f, 0.075)), [0, 0, gt[1] + 0.016]), 0.03);
    holoProjector(K, base, 0.035, 0.045, lit ? R.fuel : 0, R.fuel < 0.15 ? HOLO_RED : R.fuel < 0.3 ? HOLO_AMBER : HOLO_LINE);
    if (lit && reveal(boot, 0.7) > 0) holoShrike(K, add(base, [0, 0, 0.058]), R, D);
  }

  // ── THE CONSOLES: a sculpted sill each side, the throttle and trim on the left, the stick right ──
  for (const s of [-1, 1]) {
    const crings = [];
    for (let i = 0; i <= 8; i++) {
      const y = lerp(CONSOLE.y0, CONSOLE.y1, i / 8), sec = [];
      for (let j = 0; j <= 8; j++) {
        const a = Math.PI * j / 8, x = s * CONSOLE.x - Math.cos(a) * CONSOLE.w, z = zF + CONSOLE.top - (1 - Math.sin(a)) * 0.05;
        sec.push(clampIn(G, [x, y, j === 0 || j === 8 ? zF + CONSOLE.top - 0.2 : z], 0.006));
      }
      crings.push(sec);
    }
    sweep(K, crings, 'dash', 0.1, T.carbon);
    K.face(crings[8].slice(), [0, 1, 0], 'dash', 0.05, T.carbonLt);
    lightLine(K, crings.map((r) => add(r[s > 0 ? 1 : 7], [0, 0, 0.004])), 0.0022, al.rgb, lineK(0.85));
  }
  const ct = zF + CONSOLE.top;
  // The throttle: one lever in its gate (one engine), a HOTAS grip lit with the throttle, the gate's
  // detents lit at the setting.
  const lv = leverAt(P, R), lvNear = eased('sh76:near:throttle', live && (live.hover === 'throttle' || live.press === 'throttle') ? 1 : 0, 12);
  K.box(LEVER.x - 0.012, LEVER.pivotY - 0.14, ct - 0.004, LEVER.x + 0.012, LEVER.pivotY + 0.14, ct + 0.006, 'dash', -0.3, T.tub);
  for (let i = 0; i <= 4; i++) {
    const y = LEVER.pivotY - 0.12 + i * 0.06, here = lit && Math.abs(i / 4 - R.thr) < 0.13;
    K.box(LEVER.x + 0.016, y - 0.002, ct + 0.003, LEVER.x + 0.03, y + 0.002, ct + 0.007, 'dash', 0.2, here ? T.glow : T.glowDim, here ? 1 : 0.5);
  }
  K.rod(lv.pivot, lv.end, 0.009, 'dash', 0.2, T.metal, 0, 8);
  {
    const side = norm(cross([1, 0, 0], lv.dir)), gc = add(lv.end, mul(lv.dir, 0.03));
    K.obox(gc, [1, 0, 0], lv.dir, side, 0.022, 0.035, 0.02, 'dash', 0.1, T.carbon);
    K.obox(add(gc, mul(side, 0.021)), [1, 0, 0], lv.dir, side, 0.016, 0.025, 0.002, 'dash', 0.2, T.leather);
    // The thumb's hat switch and the red pickle under the finger.
    K.rod(add(gc, [0.012, 0.01, 0.026]), add(gc, [0.012, 0.01, 0.034]), 0.006, 'dash', 0.3, T.metal, 0, 8);
    K.obox(add(add(lv.end, mul(lv.dir, 0.068)), [0, 0, 0]), [1, 0, 0], side, lv.dir, 0.018, 0.012, 0.003, 'dash', 0.3, al.rgb, lit ? 0.4 + R.thr * 0.4 + lvNear * 0.2 : 0);
  }
  // The trim wheel: a knurled disc in a slot, its index line turning with the trim.
  {
    const tc = [TRIMW.x, TRIMW.y, ct + 0.01], tNear = eased('sh76:near:trim', live && (live.hover === 'trim' || live.press === 'trim') ? 1 : 0, 12);
    K.box(TRIMW.x - 0.012, TRIMW.y - 0.055, ct - 0.004, TRIMW.x + 0.012, TRIMW.y + 0.055, ct + 0.005, 'dash', -0.3, T.tub);
    K.rod(add(tc, [-0.008, 0, 0]), add(tc, [0.008, 0, 0]), TRIMW.r, 'dash', 0.1, T.carbonLt, 0, 20);
    for (let k = 0; k < 16; k++) {
      const a = k * TAU / 16 + R.trim * 2.5;
      K.rod(add(tc, [-0.009, Math.cos(a) * TRIMW.r, Math.sin(a) * TRIMW.r]), add(tc, [0.009, Math.cos(a) * TRIMW.r, Math.sin(a) * TRIMW.r]), 0.0025, 'dash', 0.2, T.carbon, 0, 4, false);
    }
    const ia = R.trim * 2.5 + Math.PI / 2;
    K.rod(add(tc, [0.0095, 0, 0]), add(tc, [0.0095, Math.cos(ia) * TRIMW.r * 0.95, Math.sin(ia) * TRIMW.r * 0.95]), 0.0022, 'dash', 0.3, al.rgb, lit ? 0.6 + 0.4 * tNear : 0.1, 4);
    K.torus(add(tc, [0.011, 0, 0]), [0, 1, 0], [0, 0, 1], TRIMW.r + 0.004, 0.0025, 20, 'dash', 0.2, T.glow, lit ? 0.15 + 0.6 * tNear : 0);
  }
  // The stick on a column ahead of the pilot: a short force stick, its grip canted in, a ring at its foot lit
  // as the hand comes near, the pickle (the bomb button) red on its top.
  {
    const st = stickAt(P, R), stNear = eased('sh76:near:yoke', live && (live.hover === 'yoke' || live.press === 'yoke') ? 1 : 0, 12);
    const b = st.base;
    stickColumn(K, b, zF, T.tub, T.metal);
    K.rod(add(b, [0, 0, -0.012]), add(b, [0, 0, 0.004]), 0.034, 'dash', 0.1, T.tub, 0, 16);
    K.torus(add(b, [0, 0, 0.004]), [1, 0, 0], [0, 1, 0], 0.034, 0.003, 18, 'dash', 0.2, al.rgb, lit ? 0.5 + 0.5 * stNear : 0);
    K.rod(add(b, [0, 0, 0.004]), add(b, mul(st.dir, 0.03)), 0.014, 'dash', 0.2, T.metal, 0, 8);
    const g0 = add(b, mul(st.dir, 0.03)), gTop = st.top;
    K.rod(g0, gTop, 0.022, 'dash', 0.05, T.carbon, 0, 12);
    K.obox(add(mul(add(g0, gTop), 0.5), [-0.02, 0, 0]), [0, 1, 0], st.dir, [1, 0, 0], 0.016, 0.045, 0.004, 'dash', 0.05, T.leather);
    K.rod(gTop, add(gTop, mul(st.dir, 0.012)), 0.018, 'dash', 0.2, T.carbonLt, 0, 12);
    K.rod(add(gTop, mul(st.dir, 0.012)), add(gTop, mul(st.dir, 0.018)), 0.007, 'dash', 0.3, T.warn, lit ? 0.45 + 0.4 * stNear : 0, 8);
    K.rod(add(add(gTop, mul(st.dir, -0.03)), [0, 0.022, 0]), add(add(gTop, mul(st.dir, -0.055)), [0, 0.026, 0]), 0.005, 'dash', 0.3, T.metal, 0, 6);
    contactShadow(K, [b[0], b[1], zF + 0.0005], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.04, 0.04);
  }

  // ── THE PEDALS: two plates on rails in the footwell, one forward as the other comes back ──
  const py = 0.95, pz = zF + 0.12;
  for (const [dx, sgn] of [[-0.09, -1], [0.09, 1]]) {
    const slide = clamp(R.rud * sgn, -1, 1) * 0.04;
    K.box(dx - 0.01, py - 0.1, zF, dx + 0.01, py + 0.1, zF + 0.018, 'dash', 0.1, T.metal);
    const c = [dx, py + slide, pz];
    K.obox(c, [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.04, 0.085, 0.007, 'dash', 0.05, T.carbon);
    K.obox(add(c, mul(norm([0, -0.89, -0.45]), -0.008)), [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.034, 0.075, 0.002, 'dash', 0.1, T.tub);
    K.obox(add(c, mul(norm([0, -0.89, -0.45]), -0.011)), [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.0035, 0.06, 0.001, 'dash', 0.2, al.rgb, lit ? 0.3 + 0.7 * clamp(R.rud * sgn, 0, 1) : 0);
    K.rod(add(c, [0, 0, -0.05]), [dx, py + slide, zF + 0.018], 0.01, 'dash', 0.2, T.metal, 0, 6);
    contactShadow(K, [dx, py + slide, zF], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.045, 0.1);
  }

  // ── OVERHEAD: a dome lamp in the canopy's aft frame, over your head and behind ──
  {
    const dome = G.toShell(sh76Point(SH76_GLASS.f[0] - 0.012, 15, -(G.inset + 0.04 / G.m)));
    K.rod(add(dome, [0, 0.02, 0]), add(dome, [0, -0.02, 0]), 0.028, 'hdr', 0.1, R.dome && lit ? [240, 252, 248] : [80, 84, 84], R.dome && lit ? 1 : 0, 14);
  }

  hotspotHalo(K, sh76Hotspots(P, live), live);
}

// ── THE HOLOGRAM: the striker in miniature, a hand's width long ──
// Her chined hull as section rings and its chine, crown and keel lines; the gull wing's edges, cranked
// at the knee; the fin and tailplane; the intake's jaw; the nozzle ringed in the turbine's colour with
// its blades turning on the prop phase. The dive brakes stand out and the bay opens while the dive
// computer has her (live.diveBrake), the rack shows the bombs left, and while the zone is being told
// rings run out from the broadcasters on her legs.
function holoShrike(K, c, R, D) {
  const H = holoFrame(K, c, R.pitch, R.bank);
  const sc = 0.074;                                       // metres a model unit
  const P = (f, g, h) => [g * sc, f * sc, h * sc];
  const on = R.powered && R.rpm > 0.02, frac = clamp(R.rpm / 1.05, 0, 1);
  // The hull: section rings round the chined section, and the lines that run nose to tail.
  for (const f of [1.12, 1.02, 0.9, 0.78, 0.66, 0.53, 0.39, 0.26, 0.12, -0.06, -0.24, -0.44, -0.64, -0.8, -0.93]) {
    const pts = [];
    for (let k = 0; k <= SH76_RING; k += 2) { const q = sh76Point(f, k); pts.push(P(q[0], q[1], q[2])); }
    for (let i = 0; i + 1 < pts.length; i++) H.line(pts[i], pts[i + 1], 0.0005);
  }
  const fLine = SH76_STATIONS.filter((_, i) => i % 3 === 0 || i === SH76_STATIONS.length - 1).map((s) => s.f);
  for (const k of [0, SH76_K.chine, SH76_K.upper + 1, SH76_K.crown, SH76_RING - SH76_K.upper - 1, SH76_RING - SH76_K.chine]) {
    const pts = fLine.map((f) => { const q = sh76Point(f, k); return P(q[0], q[1], q[2]); });
    const chine = k === SH76_K.chine || k === SH76_RING - SH76_K.chine;
    for (let i = 0; i + 1 < pts.length; i++) H.line(pts[i], pts[i + 1], chine ? 0.0009 : 0.0006, chine ? HOLO_RED : HOLO_LINE, chine ? 0.8 : 1);
  }
  // The canopy, filled.
  {
    const G2 = SH76_GLASS, f0 = G2.f[0], f1 = G2.f[1];
    for (let k = G2.k[0]; k < G2.k[1]; k += 2) {
      const a = sh76Point(f0, k), b = sh76Point(f1, k), cc = sh76Point(f1, k + 2), d = sh76Point(f0, k + 2);
      H.plate([P(...a), P(...b), P(...cc), P(...d)], HOLO_AMBER, 0.25);
    }
  }
  // The wing: leading and trailing edges, root to knee to crank to tip, each half filled.
  const W = [SH76_WING.root, SH76_WING.inner, SH76_WING.knee, SH76_WING.crank, SH76_WING.tip];
  for (const s of [1, -1]) {
    for (let i = 0; i + 1 < W.length; i++) {
      const A = W[i], B = W[i + 1];
      H.line(P(A.le, s * A.g, A.h), P(B.le, s * B.g, B.h), 0.0008);
      H.line(P(A.te, s * A.g, A.h), P(B.te, s * B.g, B.h), 0.0008);
      H.plate([P(A.le, s * A.g, A.h), P(B.le, s * B.g, B.h), P(B.te, s * B.g, B.h), P(A.te, s * A.g, A.h)], HOLO, 0.3);
    }
    const t = W[W.length - 1];
    H.line(P(t.le, s * t.g, t.h), P(t.te, s * t.g, t.h), 0.0008);
    // The dive brakes under the outer panel: flat with the dive computer off, standing across the air
    // while it has her.
    const db = R.diveAuto ? 1 : 0;
    for (const [g0, g1] of [[0.42, 0.58], [0.64, 0.8]]) {
      const kA = W[2], kB = W[3], u0 = (g0 - kA.g) / (kB.g - kA.g), u1 = (g1 - kA.g) / (kB.g - kA.g);
      const le0 = lerp(kA.le, kB.le, u0) - 0.42 * (lerp(kA.le, kB.le, u0) - lerp(kA.te, kB.te, u0)), le1 = lerp(kA.le, kB.le, u1) - 0.42 * (lerp(kA.le, kB.le, u1) - lerp(kA.te, kB.te, u1));
      const h0 = lerp(kA.h, kB.h, u0) - 0.02, h1 = lerp(kA.h, kB.h, u1) - 0.02, ch = 0.075;
      const df = -ch * Math.cos(db * 85 * DEG), dh = -ch * Math.sin(db * 85 * DEG);
      H.plate([P(le0, s * g0, h0), P(le1, s * g1, h1), P(le1 + df, s * g1, h1 + dh), P(le0 + df, s * g0, h0 + dh)], db ? HOLO_AMBER : HOLO, db ? 0.7 : 0.3);
    }
    // The leg, the wheel, and on the leg the broadcaster: rings run out from it while the alert is out.
    const kn = W[2];
    H.line(P(0.24, s * kn.g, kn.h), P(0.21, s * kn.g, -0.24), 0.0009);
    H.ring(P(0.21, s * kn.g, -0.24), [0, 1, 0], [0, 0, 1], 0.04 * sc, 10, HOLO_LINE, 0.7);
    if (D.alert) for (let r = 0; r < 3; r++) {
      const ph = (wallSec() * 0.8 + r / 3) % 1;
      H.ring(P(0.31, s * (kn.g + 0.006), -0.105), [0, 1, 0], [0, 0, 1], (0.02 + ph * 0.1) * sc, 12, HOLO_RED, 1 - ph);
    }
  }
  // The tail: the tailplane and the big fin.
  for (const s of [1, -1]) H.plate([P(-0.66, s * 0.03, 0.058), P(-0.84, s * 0.38, 0.046), P(-0.95, s * 0.38, 0.046), P(-0.9, s * 0.03, 0.058)]);
  H.plate([P(-0.44, 0, 0.1), P(-0.86, 0, 0.47), P(-0.99, 0, 0.47), P(-0.93, 0, 0.1)], HOLO, 0.45);
  H.line(P(-0.44, 0, 0.1), P(-0.86, 0, 0.47), 0.0008); H.line(P(-0.86, 0, 0.47), P(-0.99, 0, 0.47), 0.0008);
  // The intake's jaw under the beak: its mouth outlined, raked.
  {
    const I = SH76_INTAKE, [f0, a, hb] = I.stations[0];
    const mouth = [[f0, a * 0.86, I.topH], [lerp(f0, I.lipF, 0.3), a, lerp(hb, I.topH, 0.6)], [I.lipF, a * 0.86, hb + 0.004], [I.lipF, -a * 0.86, hb + 0.004], [lerp(f0, I.lipF, 0.3), -a, lerp(hb, I.topH, 0.6)], [f0, -a * 0.86, I.topH]];
    for (let i = 0; i + 1 < mouth.length; i++) H.line(P(...mouth[i]), P(...mouth[i + 1]), 0.0008, HOLO_RED, 0.9);
    H.line(P(I.lipF, 0, hb), P(I.stations[I.stations.length - 1][0], 0, I.stations[I.stations.length - 1][2]), 0.0006);
  }
  // The bay between the knees: open with the dive computer, and the rack's bombs in it, one per round left.
  {
    const B = SH76_BAY, bf0 = B.f[0], bf1 = B.f[1], hk = -0.09;
    const open = R.diveAuto ? 1 : 0;
    for (const s of [1, -1]) H.plate([P(bf0, 0, hk), P(bf1, 0, hk), P(bf1, s * (0.065 - 0.05 * open), hk - 0.04 * open), P(bf0, s * (0.065 - 0.05 * open), hk - 0.04 * open)], open ? HOLO_AMBER : HOLO, open ? 0.6 : 0.25);
    for (let i = 0; i < RACK; i++) {
      const g = (i - (RACK - 1) / 2) * 0.03, here = i < R.bombs;
      H.line(P(bf1 - 0.04, g, hk + 0.025), P(bf0 + 0.06, g, hk + 0.025), here ? 0.0016 : 0.0006, here ? HOLO_AMBER : HOLO_LINE, here ? 1 : 0.3);
    }
  }
  // The nozzle, ringed at the turbine's speed, its blades turning on the prop phase.
  const hub = P(SH76_NOZZLE.f - 0.02, 0, SH76_NOZZLE.h), nr = SH76_NOZZLE.rw * sc;
  H.ring(hub, [1, 0, 0], [0, 0, 1], nr, 18, frac > 0.85 ? HOLO_LINE : HOLO_AMBER, on ? 1 : 0.3);
  for (let b = 0; b < 6; b++) {
    const t = (on ? R.phase * 2.2 : 0) + b * TAU / 6;
    H.line(hub, add(hub, [Math.cos(t) * nr * 0.92, 0, Math.sin(t) * nr * 0.7]), 0.0008, HOLO_LINE, on ? 0.9 : 0.4);
  }
}

// ── THE FLIGHT PAGE: attitude, speed and height, heading, climb, trim ──
function pfd(Pn, R) {
  Pn.attitude(0, -0.004, 0.04, R.pitch, R.bank);
  const box = (u, v, s, unit, digitsN) => {
    Pn.rect(u - 0.022, v - 0.012, u + 0.022, v + 0.012, [10, 18, 20], 0.3, 0.002);
    Pn.digits(u - 0.019, v - 0.007, 0.013, String(Math.round(s)).padStart(digitsN, ' ').slice(-digitsN), T.white, false);
    Pn.text(unit, u, v - 0.026, 0.011, T.dim, 0.5, 0.003);
  };
  box(-0.05, 0.0, R.ias, 'KT', 3);
  box(0.05, 0.0, R.alt, 'FT', 4);
  // The speed band against the type's never-exceed, and the dive gate's 140 knots marked on it.
  const sp = clamp(R.ias / R.vne, 0, 1), gate = clamp(DIVE_GATE.releaseKt / R.vne, 0, 1);
  Pn.rect(-0.069, -0.045, -0.066, 0.045, [24, 34, 34], 0.3, 0.002);
  Pn.rect(-0.0695, -0.045, -0.0655, -0.045 + 0.09 * sp, sp > 0.9 ? T.warn : sp > 0.75 ? T.amber : T.glow, 0.9, 0.003);
  Pn.rect(-0.071, -0.045 + 0.09 * gate - 0.0008, -0.064, -0.045 + 0.09 * gate + 0.0008, T.white, 0.8, 0.0035);
  // The climb: a bar from the middle of the right edge, up or down.
  const vs = clamp(R.vsi / 3000, -1, 1);
  Pn.rect(0.066, -0.045, 0.069, 0.045, [24, 34, 34], 0.3, 0.002);
  if (Math.abs(vs) > 0.01) Pn.rect(0.0655, Math.min(0, vs * 0.045), 0.0695, Math.max(0, vs * 0.045), vs > 0 ? C.green : T.amber, 0.9, 0.003);
  Pn.rect(-0.016, 0.038, 0.016, 0.054, T.screen, 0.2, 0.0035);
  Pn.digits(-0.013, 0.041, 0.011, String(Math.round(((R.hdg % 360) + 360) % 360)).padStart(3, '0'), T.glow, false);
  Pn.rect(-0.03, -0.052, 0.03, -0.05, [40, 60, 60], 0.3, 0.003);
  Pn.rect(R.trim * 0.028 - 0.002, -0.056, R.trim * 0.028 + 0.002, -0.046, T.glow, 0.9, 0.004);
  if (R.stall) Pn.rect(-0.068, -0.061, 0.068, -0.057, T.warn, 1, 0.004);
}

// ── THE ENGINE PAGE: the turbine's speed against the throttle, its heat, the fuel, the hull ──
function engPage(Pn, R) {
  Pn.text('ENG', -0.05, 0.046, 0.011, T.dim, 0.5, 0.003);
  Pn.text('JET', 0.05, 0.046, 0.011, T.dim, 0.5, 0.003);
  // N1 as a three-quarter arc from 0 to 110 per cent, the throttle's demand a tick on it.
  const ac = [-0.03, 0.012], ar = 0.03, a0 = Math.PI * 1.25, span = Math.PI * 1.5;
  const at = (v) => a0 - span * clamp(v / 1.1, 0, 1);
  Pn.annulus(ac[0], ac[1], ar - 0.0012, ar + 0.0012, [40, 70, 70], 0.4, 0.002, 24, a0, a0 - span);
  if (R.rpm > 0.005) Pn.annulus(ac[0], ac[1], ar - 0.003, ar + 0.003, R.rpm > 1.02 ? T.warn : T.glow, 0.95, 0.003, Math.max(2, Math.round(24 * R.rpm / 1.1)), a0, at(R.rpm));
  Pn.spoke(ac[0], ac[1], at(R.thr), ar - 0.008, ar + 0.006, 0.0014, T.amber, 0.9, 0.004);
  Pn.text('N1', ac[0], ac[1] + 0.008, 0.011, T.dim, 0.5, 0.003);
  Pn.digits(ac[0] - 0.012, ac[1] - 0.012, 0.012, String(Math.round(R.rpm * 100)).padStart(3, ' '), T.white, false);
  // Three bars down the right: the turbine's heat, the fuel and the hull.
  const bar = (v, label, val, rgb) => {
    Pn.text(label, 0.022, v, 0.011, T.dim, 0.5, 0.003);
    Pn.rect(0.036, v - 0.004, 0.07, v + 0.004, [24, 34, 34], 0.3, 0.002);
    if (val > 0.01) Pn.rect(0.036, v - 0.0035, 0.036 + 0.034 * clamp(val, 0, 1), v + 0.0035, rgb, 0.9, 0.003);
  };
  bar(0.026, 'TMP', R.temp, R.temp > 0.85 ? T.warn : R.temp > 0.7 ? T.amber : T.glow);
  bar(0.002, 'FUEL', R.fuel, R.fuel < 0.15 ? T.warn : R.fuel < 0.3 ? T.amber : T.glow);
  bar(-0.022, 'HULL', R.hull, R.hull < 0.3 ? T.warn : R.hull < 0.6 ? T.amber : T.glow);
  Pn.text('FUEL', -0.05, -0.04, 0.011, T.dim, 0.5, 0.003);
  Pn.digits(-0.034, -0.057, 0.011, String(Math.round(R.fuel * 100)).padStart(3, ' '), R.fuel < 0.15 ? T.warn : T.white, false);
  Pn.text('THR', 0.03, -0.04, 0.011, T.dim, 0.5, 0.003);
  Pn.digits(0.042, -0.057, 0.011, String(Math.round(R.thr * 100)).padStart(3, ' '), T.amber, false);
}

// ── THE DIVE PAGE: the angle on the Stuka's protractor, the gate, the pull-out height ──
// A quarter arc from level to straight down, the gate's 35 to 80 degrees lit, the Stuka's three dive
// lines marked red, and the needle at her dive. Beside it the four conditions the rack wants, each lit
// when it is met; under it the height to start the pull-out by and the release cue.
function divePage(Pn, R, D) {
  Pn.text('DIVE', -0.05, 0.046, 0.011, T.dim, 0.5, 0.003);
  if (R.diveAuto) Pn.text('AUTO', 0.0, 0.046, 0.011, T.amber, 0.9, 0.003);
  const ac = [-0.058, 0.032], ar = 0.058;
  // Angle d below level is the direction (cos d, -sin d) from the centre: the arc runs right then down.
  const dirOf = (d) => -clamp(d, 0, 90) * DEG;
  Pn.annulus(ac[0], ac[1], ar - 0.001, ar + 0.001, [40, 70, 70], 0.4, 0.002, 18, 0, -Math.PI / 2);
  Pn.annulus(ac[0], ac[1], ar - 0.004, ar + 0.004, C.green, D.ang ? 0.7 : 0.25, 0.0025, 12, dirOf(DIVE_GATE.releaseDeg), dirOf(DIVE_GATE.bestDeg));
  for (const d of [0, 30, 45, 90]) Pn.spoke(ac[0], ac[1], dirOf(d), ar - 0.007, ar + 0.002, 0.0008, T.dim, 0.5, 0.003);
  for (const d of DIVE_LINES) Pn.spoke(ac[0], ac[1], dirOf(d), ar - 0.012, ar + 0.004, 0.0012, T.dive, 0.9, 0.0032);
  Pn.spoke(ac[0], ac[1], dirOf(DIVE_GATE.alertDeg), ar - 0.01, ar + 0.004, 0.0009, T.amber, 0.8, 0.0031);
  const nd = clamp(D.down, 0, 90);
  Pn.spoke(ac[0], ac[1], dirOf(nd), 0.006, ar + 0.004, 0.0018, D.ready ? C.green : D.ang ? T.white : T.glow, 1, 0.004);
  Pn.disc(ac[0], ac[1], 0.004, T.glow, 0.8, 0.004, 10);
  Pn.digits(-0.05, 0.004, 0.013, String(Math.round(Math.max(0, D.down))).padStart(2, ' '), D.ang ? T.white : T.dim, false);
  // The rack's four conditions.
  const conds = [['ANG', D.ang], ['SPD', D.spd], ['ALT', D.low], ['ARM', D.arm]];
  conds.forEach(([name, met], i) => {
    const v = 0.03 - i * 0.017;
    Pn.rect(0.03, v - 0.0065, 0.068, v + 0.0065, met ? [12, 60, 30] : [20, 26, 28], met ? 0.6 : 0.3, 0.002);
    Pn.fitText(name, 0.049, v, 0.032, 0.009, met ? C.green : T.dim, met ? 1 : 0.4, 0.003);
  });
  // The pull-out height: the height to start the pull by, red once she is under it in a dive.
  Pn.text('PULL', -0.05, -0.034, 0.011, T.dim, 0.5, 0.003);
  Pn.digits(-0.066, -0.057, 0.011, String(Math.min(99999, Math.round(D.pullFt))).padStart(5, ' '), D.pullNow ? T.warn : T.white, false);
  // The release cue: lit green with the whole gate open.
  Pn.rect(0.012, -0.058, 0.068, -0.038, D.ready ? C.green : [20, 26, 28], D.ready ? 1 : 0.3, 0.003);
  Pn.fitText(D.ready ? 'RELEASE' : D.pullNow ? 'PULL UP' : 'REL ' + DIVE_GATE.releaseFt, 0.04, -0.048, 0.05, 0.011, D.ready ? [8, 30, 12] : D.pullNow ? T.warn : T.dim, D.ready ? 0 : 0.6, 0.004);
}

// ── THE ALERT PAGE: the push alert the zone below gets, and its countdown ──
// The Stuka's siren was for the people under her; the 2076 sends them a push alert to every tablet in
// the target zone instead, when she tips past 30 degrees. This page shows that it has gone and counts
// down to the release height (derived: the sim keeps no timer), then to the pull-out. Under it the rack.
function alertPage(Pn, R, D) {
  Pn.text('ALERT', -0.046, 0.046, 0.011, T.dim, 0.5, 0.003);
  Pn.fitText(D.alert ? 'SENT' : 'QUIET', 0.046, 0.046, 0.04, 0.011, D.alert ? T.warn : T.dim, D.alert ? 1 : 0.4, 0.003);
  // The broadcast mark: a tower and three arcs, lit while the alert is out.
  const bc = [-0.05, 0.012];
  Pn.rect(bc[0] - 0.0012, bc[1] - 0.018, bc[0] + 0.0012, bc[1] + 0.004, D.alert ? T.warn : T.glowDim, D.alert ? 1 : 0.4, 0.003);
  for (let i = 1; i <= 3; i++) {
    const r = 0.006 * i, e = D.alert ? 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(wallSec() * 5 - i)) : 0.25;
    for (const s of [-1, 1]) Pn.annulus(bc[0], bc[1], r - 0.0008, r + 0.0008, D.alert ? T.warn : T.glowDim, e, 0.003, 6, s > 0 ? -Math.PI / 4 : Math.PI * 3 / 4, s > 0 ? Math.PI / 4 : Math.PI * 5 / 4);
  }
  // The countdown to the release height, big; NOW once she is under it; dashes while not sinking.
  Pn.text('REL IN', 0.022, 0.026, 0.011, T.dim, 0.5, 0.003);
  const tr = D.toRel;
  if (tr == null) Pn.rect(0.004, 0.006, 0.04, 0.009, T.dim, 0.5, 0.003);
  else if (tr <= 0) Pn.fitText('NOW', 0.022, 0.008, 0.04, 0.014, D.ready ? C.green : T.amber, 1, 0.003);
  else Pn.digits(0.002, 0.0, 0.016, String(Math.min(999, Math.round(tr))).padStart(3, ' '), D.alert ? T.white : T.glow, false);
  Pn.text('S', 0.062, 0.004, 0.011, T.dim, 0.5, 0.003);
  // Then to the pull-out height.
  Pn.text('PULL IN', -0.03, -0.02, 0.011, T.dim, 0.5, 0.003);
  const tp = D.toPull;
  if (tp == null) Pn.rect(0.02, -0.022, 0.05, -0.019, T.dim, 0.5, 0.003);
  else Pn.digits(0.02, -0.027, 0.011, String(Math.min(999, Math.round(tp))).padStart(3, ' '), tp < 5 ? T.warn : T.white, false);
  // The rack: one pip a station, lit for each bomb left, and the arming state.
  for (let i = 0; i < RACK; i++) {
    const u = -0.064 + i * 0.016, here = i < R.bombs;
    Pn.rect(u, -0.056, u + 0.012, -0.042, here ? (R.armed ? T.amber : T.glow) : [24, 30, 32], here ? 0.9 : 0.3, 0.003);
  }
  Pn.fitText(R.armed ? 'ARMED' : 'SAFE', 0.046, -0.049, 0.04, 0.011, R.armed ? T.warn : T.glow, 0.8, 0.003);
}
