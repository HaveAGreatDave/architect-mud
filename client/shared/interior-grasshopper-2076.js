// THE GRASSHOPPER 2076'S COCKPIT: the front seat of the solar scout, as geometry.
//
// The Grasshopper 2076 is the grasshopper class's concept body (mesh_grasshopper_2076.json), after
// the Airbus Zephyr: a tandem two-seat spotter with a fourteen-metre wing skinned in solar cells, a
// slender pod under it and a gimballed sensor ball under the chin. She can fly herself, and on a long
// survey leg she does unless somebody is in the front seat with a hand on the stick. Halcyon's Warm
// Hands Rider voids the hull cover on any flight logged without a living pilot at the controls, so
// the controls are there and they work, and the panel says, politely, that they are advisory.
//
// So the front seat is a glider's: you lie back in a carbon shell with your heels forward on the
// pedals and the stick between your knees, under a bubble that runs from your toes to behind your
// head. Across the front is one curved band of glass with the solar page, the flight page and the
// sensor page on it; the throttle and the trim wheel are on the left console. Behind you, over the
// back of your seat, the observer sits under the wing pylon with their own windows.
//
// Sources read for this file:
//   https://en.wikipedia.org/wiki/Airbus_Zephyr (solar HAPS, 25 m span, cells over the whole wing)
//   https://en.wikipedia.org/wiki/Pipistrel_Velis_Electro (two-seat electric, 10.7 m span, 58 kW)
//   The cockpit fit-out is the game's fiction; nothing above is a source for a dimension inside.
//
// ── ⚠ THE ROOM IS THE EXTERIOR'S POD ────────────────────────────────────────
//
// client/shared/cabin-grasshopper-2076.js states the pod's stations and where its glass is, and the
// exterior generator builds the shell and the panes from the same file. The wall here is the pod's
// own section walked at its own stations and pushed in by a wall's thickness, the windows are the
// absence of wall where the layout says glass, and anything that would reach the skin (the dash, the
// console) is clamped to the inside of the section it stands in.
//
// ── ⚠ ONE SCALE: THE SPAN ───────────────────────────────────────────────────
//
// SCOUT_SPAN_M over the compiled exterior's span, so the room and the airframe agree about what a
// metre is. Anything about a PERSON (seat, reach, a screen's size) is honest metres.
//
// ── ⚠ EVERY READING IS A LIVE VALUE OR DERIVED FROM ONE IN THE OPEN ─────────
//
// The solar input is the array's peak output times the sun's height, which is the hour's (live.hour),
// times what the sky lets through (live.weather, when the view sends it). The draw is the motor's
// power from throttle and rpm. The sensor page's ranges come off the altitude and the ball's fixed
// look-down. Nothing shows a constant dressed as a reading. Decoration may move on wall time (the
// alert breathing, the boot); every readout moves only on live values.
import { makeKit, C, clamp, lerp, SHINY, PANE, TEXTURE } from './interior-kit.js';
import { contactShadow, hotspotHalo, panelGps, gpsHotspot, lensLamp, eased, pressPulse, HALO,
  bootAge, reveal, alertLight, sweep, lightLine, bandFrame, glassBand, holoFrame, holoProjector, windscreenHud,
  HOLO, HOLO_LINE, HOLO_AMBER, HOLO_RED } from './interior-cockpit-kit.js';
import { MESH_ROWS } from './vehicle-meshes.js';
import { compileMesh } from './vehicle-mesh.js';
import { GH76_STATIONS, GH76_GLASS, GH76_FRAMES, GH76_INSIDE, GH76_WING, SCOUT_SPAN_M, gh76Section, gh76Point } from './cabin-grasshopper-2076.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ── THE STYLE ────────────────────────────────────────────────────────────────
// The exterior's pearl and carbon, sage leather, and the stock meadow green as the stitch. The light
// that runs round the room and every display's normal colour is teal; amber is caution, red a warning.
export const GH76_TRIM = {
  lining: [212, 216, 206], liningDk: [176, 182, 172], carbon: [34, 38, 36], carbonLt: [54, 60, 56], tub: [26, 29, 28],
  leather: [118, 132, 106], leatherDk: [80, 92, 72], bolster: [44, 50, 44], green: [95, 143, 58],
  glow: [120, 236, 210], glowDim: [40, 92, 84], floor: [40, 44, 40], floorEdge: [26, 29, 27],
  metal: [150, 156, 162], harness: [72, 80, 70], buckle: [176, 182, 190],
  screen: [6, 12, 14], solar: [30, 46, 82], solarLit: [70, 110, 200], sun: [255, 214, 120],
  red: [235, 60, 48], amber: [255, 176, 64], white: [230, 244, 238], dim: [150, 190, 182],
};
const T = GH76_TRIM;
for (const k of ['lining', 'liningDk']) TEXTURE.set(T[k], 'paint');
for (const k of ['carbon', 'carbonLt', 'tub']) TEXTURE.set(T[k], 'plastic');
for (const k of ['leather', 'leatherDk', 'bolster']) TEXTURE.set(T[k], 'leather');
for (const k of ['floor', 'floorEdge']) TEXTURE.set(T[k], 'carpet');
for (const k of ['metal', 'buckle']) TEXTURE.set(T[k], 'brushed');
TEXTURE.set(T.harness, 'fabric');
SHINY.set(T.carbon, { spec: 0.45, pow: 30 });
SHINY.set(T.carbonLt, { spec: 0.4, pow: 26 });
SHINY.set(T.lining, { spec: 0.2, pow: 16 });
SHINY.set(T.metal, { spec: 0.7, pow: 36 });
SHINY.set(T.buckle, { spec: 0.8, pow: 40 });
SHINY.set(T.screen, { spec: 0.6, pow: 60 });
// The hologram's cells, lit by the sun: translucent like the rest of it.
const HOLO_SUN = [255, 214, 120];
PANE.set(HOLO_SUN, 0.5);

// ── THE EXTERIOR, MEASURED ──────────────────────────────────────────────────
function modelSpan(doc) {
  let g = 0;
  for (const f of compileMesh(doc, { detail: 1 }).faces) {
    if (f.role === 'rotor') continue;
    for (const q of f.p) if (Math.abs(q[1]) > g) g = Math.abs(q[1]);
  }
  return 2 * g;
}

// The pilot's eye: on the centreline in the front seat, a reclined seated eye height (0.9 m, a
// glider's) over the floor, a hand's width ahead of the canopy's crown.
const EYE = { f: 0.37, g: 0, overFloorM: 0.9 };
const WALL_M = 0.035;
const FN = 0.655;                     // the firewall, a little ahead of the windscreen's foot

// ── THE PROFILE ──────────────────────────────────────────────────────────────
export function grasshopper2076Profile(doc = MESH_ROWS.grasshopper_2076) {
  if (!doc) return null;
  const m = SCOUT_SPAN_M / modelSpan(doc);
  const fE = EYE.f, gE = EYE.g, hE = GH76_INSIDE.floorH + EYE.overFloorM / m;
  const X = (g) => (g - gE) * m, Y = (f) => (f - fE) * m, Z = (h) => (h - hE) * m;
  const toShell = (q) => [X(q[1]), Y(q[0]), Z(q[2])];
  const fromShell = (q) => [q[1] / m + fE, q[0] / m + gE, q[2] / m + hE];
  const inset = WALL_M / m;
  const fB = GH76_INSIDE.bulkheadF, zF = Z(GH76_INSIDE.floorH);
  const G = { m, X, Y, Z, toShell, fromShell, inset, fB, zF, fW: GH76_GLASS.bubble.f[0] };
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
  const B = GH76_GLASS.bubble;
  return {
    label: 'Grasshopper 2076 front seat',
    xCentre: 0, halfW,
    floor: z0 - 1e-6, roof: z1 + 1e-6, front: y1 + 1e-6, back: y0 - 1e-6,
    mPerUnit: m, glassAftY: Y(G.fW),
    // The side rays go out through the bubble beside the pilot's head.
    winY: [Y(fE - 0.03), Y(fE + 0.03)], winZ: [Z(gh76Point(fE, B.a[0] + 8)[2]), Z(gh76Point(fE, 50)[2])],
    dashY: DASH.yMid - DASH.sag, dashZ: DASH.z0, headerZ: Z(gh76Point(fE, 80)[2]), pillarW: 0.03,
    seatZ: zF + 0.2, seatHalf: 0.2, seatY: [-0.1, 0.5], backZ: 0,
    roofGlass: true,          // straight up from the pilot is the bubble and the sky
    seats: 1, centrePost: 0,
    normalLit: true,
    floods: [{ p: [0, 0.55, -0.25], r: 0.45 }, { p: [0, -0.6, 0.0], r: 0.6 }],
    floodGain: 1.5, glare: 0.25,
    room: gh76Shell,
    glass,
    gh76: { ...G, faces: room.faces },
    hotspots(live) { return gh76Hotspots(this, live); },
  };
}

// Pull a cabin point in until it is `margin` metres inside the pod's skin at its own station and
// height: the dash and the console are drawn freely and then held off the wall by this.
function clampIn(G, q, margin = 0.012) {
  const [f, g, h] = G.fromShell(q);
  const s = gh76Section(f), e = 1 - s.boxy * 0.55, dh = h - s.cz;
  const inn = G.inset + margin / G.m;
  const rg = s.rg - inn, rv = (dh >= 0 ? s.rvT : s.rvB) - inn;
  const t = clamp(Math.abs(dh) / rv, 0, 0.999);
  const gMax = rg * Math.pow(1 - Math.pow(t, 2 / e), e / 2);
  if (Math.abs(g) <= gMax) return q;
  return G.toShell([f, Math.sign(g) * gMax, h]);
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
// Built once per profile: lining, the canopy's hoop and sills, the rear windows' reveals, the
// firewall, the bulkhead, the floor and the light along the sills. Nothing here moves.
function buildRoom(G) {
  const { toShell, inset, fB, zF, m } = G;
  const faces = [];
  const put = (p, n, tone, k, rgb, emis) => faces.push({ p, n, tone, k, rgb, emis: emis || 0 });
  const K = makeKit((fs, tone, k, fwd, rgb, emis) => { for (const f of fs) put(f.p, f.n, tone, k, rgb, emis); }, false);
  const S = (f, aDeg, inM = 0) => toShell(gh76Point(f, aDeg, -(inset + inM / m)));
  const inward = (f, a) => {
    const d = 1e-4;
    let n = norm(cross(sub(S(f + d, a), S(f - d, a)), sub(S(f, a + d * 50), S(f, a - d * 50))));
    const c = toShell([f, 0, gh76Section(f).cz]);
    if (dot(n, sub(c, S(f, a))) < 0) n = mul(n, -1);
    return n;
  };
  const aboveFloor = (poly) => clipHalf(poly, (q) => q[2] - zF);
  const Bb = GH76_GLASS.bubble, Rw = GH76_GLASS.rear;

  // ── THE SHELL: walked in the pod's own (f, angle), bulkhead to firewall, every pane cut out of it.
  const FS = [fB, -0.06, -0.04, 0.0, 0.04, 0.08, 0.12, 0.15, GH76_FRAMES.hoop, Bb.f[0], 0.2, 0.235, 0.27, 0.305, 0.34, 0.375, 0.41, 0.445, 0.48, 0.515, 0.55, 0.58, 0.6, Bb.f[1], FN];
  const NA = 72;
  const holes = [
    [[Bb.f[0], Bb.a[0]], [Bb.f[1], Bb.a[0]], [Bb.f[1], Bb.a[1]], [Bb.f[0], Bb.a[1]]],
    [[Rw.f[0], Rw.a[0]], [Rw.f[1], Rw.a[0]], [Rw.f[1], Rw.a[1]], [Rw.f[0], Rw.a[1]]],
    [[Rw.f[0], 180 - Rw.a[1]], [Rw.f[1], 180 - Rw.a[1]], [Rw.f[1], 180 - Rw.a[0]], [Rw.f[0], 180 - Rw.a[0]]],
  ];
  for (let i = 0; i < FS.length - 1; i++) {
    for (let j = 0; j < NA; j++) {
      const f0 = FS[i], f1 = FS[i + 1], a0 = -90 + (j / NA) * 360, a1 = -90 + ((j + 1) / NA) * 360;
      let cells = [[[f0, a0], [f1, a0], [f1, a1], [f0, a1]]];
      for (const h of holes) cells = cells.flatMap((c) => (bbOverlap(c, h) ? subtractConvex(c, h) : [c]));
      const fm = (f0 + f1) / 2, am = (a0 + a1) / 2, sn = Math.sin(am * DEG);
      const n = inward(fm, am);
      for (const c of cells) {
        const poly = aboveFloor(c.map(([f, a]) => S(f, a)));
        if (poly.length < 3) continue;
        if (sn > 0.8) put(poly, n, 'hdr', -0.24, T.lining);                 // the pylon's underside, over the observer
        else if (sn < -0.2) put(poly, n, 'pil', -0.18, T.tub);
        else if (fm > Bb.f[1]) put(poly, n, 'pil', -0.12, T.carbon);        // the footwell, under the cowl
        else put(poly, n, 'pil', -0.12, sn > 0.1 ? T.lining : T.liningDk);
      }
    }
  }

  // ── THE REVEALS: a carbon return round every pane and a lit seal along its inner edge.
  const revealEdge = (pts, cF, cA, lit = true) => {
    for (let t = 1; t < pts.length; t++) {
      const [fa, aa] = pts[t - 1], [fb, ab] = pts[t];
      const i0 = S(fa, aa), i1 = S(fb, ab), o0 = toShell(gh76Point(fa, aa, -0.003 / m)), o1 = toShell(gh76Point(fb, ab, -0.003 / m));
      const fm = (fa + fb) / 2, am = (aa + ab) / 2;
      const toC = sub(S(cF, cA), S(fm, am));
      const out = norm(sub(toShell(gh76Point(fm, am, 0)), S(fm, am)));
      const rn = norm(sub(toC, mul(out, dot(toC, out))));
      if (i0[2] > zF && i1[2] > zF) put([i0, i1, o1, o0], rn, 'pil', 0.05, T.carbon);
      if (lit && i0[2] > zF + 0.01 && i1[2] > zF + 0.01) K.rod(S(fa, aa, 0.006), S(fb, ab, 0.006), 0.003, 'pil', 0.1, T.glowDim, 0.35, 5, false);
    }
  };
  const edge = (f0, a0, f1, a1, n) => Array.from({ length: n + 1 }, (_, i) => [lerp(f0, f1, i / n), lerp(a0, a1, i / n)]);
  // The bubble's sills, both sides, and its foot across the front.
  revealEdge(edge(Bb.f[0], Bb.a[0], Bb.f[1], Bb.a[0], 14), (Bb.f[0] + Bb.f[1]) / 2, 60);
  revealEdge(edge(Bb.f[0], Bb.a[1], Bb.f[1], Bb.a[1], 14), (Bb.f[0] + Bb.f[1]) / 2, 120);
  revealEdge(edge(Bb.f[1], Bb.a[0], Bb.f[1], Bb.a[1], 20), Bb.f[1] - 0.05, 90, false);
  for (const [aLo, aHi] of [Rw.a, [180 - Rw.a[1], 180 - Rw.a[0]]]) {
    const cF = (Rw.f[0] + Rw.f[1]) / 2, cA = (aLo + aHi) / 2;
    revealEdge([...edge(Rw.f[0], aLo, Rw.f[1], aLo, 6), ...edge(Rw.f[1], aLo, Rw.f[1], aHi, 6).slice(1), ...edge(Rw.f[1], aHi, Rw.f[0], aHi, 6).slice(1), ...edge(Rw.f[0], aHi, Rw.f[0], aLo, 6).slice(1)], cF, cA);
  }
  // ── THE HOOP: the carbon arch between the bubble and the observer's windows, where the bubble
  // hinges, with its lit seal and the two grab handles the pilot pulls the canopy down by.
  {
    const hf = GH76_FRAMES.hoop + 0.003;
    const arc = edge(hf, Bb.a[0] - 4, hf, Bb.a[1] + 4, 24).map(([f, a]) => S(f, a, 0.012));
    for (let k = 1; k < arc.length; k++) K.rod(arc[k - 1], arc[k], 0.018, 'post', 0.05, T.carbon, 0, 6, false);
    const seal = edge(hf + 0.004, Bb.a[0] + 2, hf + 0.004, Bb.a[1] - 2, 20).map(([f, a]) => S(f, a, 0.03));
    for (let k = 1; k < seal.length; k++) K.rod(seal[k - 1], seal[k], 0.003, 'post', 0.2, T.glow, 0.7, 4, false);
    for (const a of [50, 130]) {
      const p0 = S(hf + 0.01, a - 6, 0.03), p1 = S(hf + 0.01, a + 6, 0.03);
      K.rod(p0, p1, 0.009, 'post', 0.3, T.metal, 0, 8);
      K.rod(p0, S(hf, a - 6, 0.012), 0.006, 'post', 0.3, T.metal, 0, 6);
      K.rod(p1, S(hf, a + 6, 0.012), 0.006, 'post', 0.3, T.metal, 0, 6);
    }
  }
  // The canopy's gas struts down each sill, as the exterior has them.
  for (const s of [1, -1]) {
    const A = (a) => (s > 0 ? a : 180 - a);
    K.rod(S(0.6, A(10), 0.02), S(0.36, A(12), 0.025), 0.007, 'pil', 0.3, T.metal, 0, 6);
    K.rod(S(0.6, A(10), 0.02), S(0.5, A(11), 0.023), 0.011, 'pil', 0.2, T.carbonLt, 0, 8);
  }

  // ── THE FIREWALL ahead of the pedals, and THE BULKHEAD behind the observer ──
  const ring = (f) => { const o = []; for (let k = 0; k <= 72; k++) o.push(S(f, -90 + (k / 72) * 360)); return aboveFloor(o); };
  const fw = ring(FN);
  if (fw.length >= 3) put(fw, [0, -1, 0], 'post', -0.15, T.carbon);
  const bk = ring(fB);
  if (bk.length >= 3) put(bk, [0, 1, 0], 'post', -0.12, T.carbon);
  const yB = G.Y(fB);
  K.box(-0.14, yB, zF + 0.3, 0.14, yB + 0.025, zF + 0.75, 'post', -0.05, T.leatherDk);
  K.box(-0.18, yB + 0.005, zF + 0.8, 0.18, yB + 0.02, zF + 0.815, 'post', 0.2, T.glow, 0.8);

  // ── THE FLOOR: a carbon trough from the bulkhead to the firewall, edged in light ──
  const floorHalf = (f) => {
    let prev = null;
    for (let a = -90; a <= 0; a += 1) {
      const q = gh76Point(f, a, -inset);
      if (prev && prev[2] < GH76_INSIDE.floorH && q[2] >= GH76_INSIDE.floorH) {
        const t = (GH76_INSIDE.floorH - prev[2]) / (q[2] - prev[2]);
        return (prev[1] + (q[1] - prev[1]) * t) * m;
      }
      prev = q;
    }
    return 0;
  };
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
// The panes the renderer lays over the room as film, faceted along the pod in (f, angle), 5 mm inside
// the skin and outboard of every reveal.
function buildGlass(G) {
  const { toShell, m } = G;
  const d = 0.005 / m;
  const panes = [];
  const grid = (f0, f1, a0, a1, nf, na) => {
    for (let i = 0; i < nf; i++) for (let j = 0; j < na; j++) {
      const fa = lerp(f0, f1, i / nf), fb = lerp(f0, f1, (i + 1) / nf), aa = lerp(a0, a1, j / na), ab = lerp(a0, a1, (j + 1) / na);
      panes.push([[fa, aa], [fb, aa], [fb, ab], [fa, ab]].map(([f, a]) => toShell(gh76Point(f, a, -d))));
    }
  };
  const Bb = GH76_GLASS.bubble, Rw = GH76_GLASS.rear;
  grid(Bb.f[0], Bb.f[1], Bb.a[0], Bb.a[1], 12, 22);
  panes.bubble = panes.length;
  grid(Rw.f[0], Rw.f[1], Rw.a[0], Rw.a[1], 3, 3);
  grid(Rw.f[0], Rw.f[1], 180 - Rw.a[1], 180 - Rw.a[0], 3, 3);
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
function gh76Shell(P, live, push, rich) {
  const D = P.gh76;
  for (const f of D.faces) push(f.one || (f.one = Object.assign([{ p: f.p, n: f.n }], { stable: true })), f.tone, f.k, false, f.rgb, f.emis || 0);
  seats(P, push);
  if (rich) gh76Fit(P, live, push);
}

// ── THE READINGS ─────────────────────────────────────────────────────────────
const readings = (live) => {
  const L = live || {};
  return {
    L,
    pitch: num(L.pitch), bank: num(L.bank), hdg: num(L.hdg),
    ias: Math.max(0, num(L.ias)), vne: Math.max(40, num(L.vne, 105)),
    alt: Math.max(0, num(L.alt)), vsi: num(L.vsi),
    rpm: clamp(num(L.rpm), 0, 1.1), thr: clamp(num(L.throttle), 0, 1),
    fuel: clamp(num(L.fuel, 1), 0, 1), hull: clamp(num(L.hull, 1), 0, 1),
    temp: clamp(num(L.oilTemp, 0.4), 0, 1),
    powered: L.powered !== false,
    ail: clamp(num(L.stickX), -1, 1), elev: clamp(num(L.stickY), -1, 1), rud: clamp(num(L.rudder), -1, 1),
    trim: clamp(num(L.trim), -1, 1), flap: clamp(Math.round(num(L.flapNotch)), 0, 3),
    land: !!L.landingLight, dome: !!L.dome, hour: ((num(L.hour, 12) % 24) + 24) % 24,
    weather: typeof L.weather === 'string' ? L.weather.toLowerCase() : null,
    phase: num(L.phase), stall: !!L.stall,
  };
};
const night = (R) => R.hour < 6.5 || R.hour > 19.5;
const panelOn = (R) => R.powered && (R.L.panelLight != null ? !!R.L.panelLight : night(R));

// ── THE SUN ON THE WING ──────────────────────────────────────────────────────
// The array: about 12 m² of cells at 24 per cent under 1 kW a square metre of full sun, so 2.9 kW at
// noon in a clear sky. The sun's height is the hour's: up at six, highest (60°) at noon, down at six,
// and the cells give in proportion to its sine. The sky takes its share by the weather word, when the
// view sends one; without it the page says so and shows a clear sky's input.
export const ARRAY_PEAK_KW = 2.9;
const SKY = { clear: 1, cloudy: 0.72, haze: 0.78, overcast: 0.36, fog: 0.3, rain: 0.26, sleet: 0.2, snow: 0.2, ash: 0.15, thunderstorm: 0.1, storm: 0.1, blizzard: 0.08 };
export function solarInput(hour, weather) {
  const up = Math.sin(Math.PI * (hour - 6) / 12);
  const elev = Math.max(0, up) * 60;
  const sky = weather == null ? 1 : (SKY[weather] ?? 0.6);
  return { elev, sky, kw: ARRAY_PEAK_KW * Math.sin(elev * DEG) * sky, known: weather != null };
}
// The motor: a Velis-class 58 kW at full throttle and full rpm, a kilowatt and a half of avionics,
// the ball and the motor's idle at the bottom.
const MOTOR_KW = 58;
const drawKw = (R) => (R.powered ? 1.5 + MOTOR_KW * clamp(R.thr * R.rpm, 0, 1) : 0);

// ── WHERE THE CONTROLS ARE ───────────────────────────────────────────────────
// One place says where each thing you can grab is; the drawing and the hotspots both read it. The
// stick stands between the knees, the throttle and the trim wheel are on the left console.
const STICK = { base: [0, 0.6, 0.06], len: 0.3 };                   // z off the floor
const LEVER = { x: -0.21, pivotY: 0.12, top: 0.4, len: 0.16 };      // on the left console, z off the floor
const TRIMW = { x: -0.21, y: 0.36, z: 0.4, r: 0.045 };
function stickAt(P, R) {
  const base = [STICK.base[0], STICK.base[1], P.gh76.zF + STICK.base[2]];
  const dir = norm([R.ail * 0.3, -R.elev * 0.3 - 0.12, 1]);
  return { base, top: add(base, mul(dir, STICK.len)), dir };
}
function leverAt(P, R) {
  const pivot = [LEVER.x, LEVER.pivotY, P.gh76.zF + LEVER.top];
  const ang = -0.55 + R.thr * 1.1;
  const dir = [0, Math.sin(ang), Math.cos(ang)];
  return { pivot, end: add(pivot, mul(dir, LEVER.len)), dir, ang };
}

// ── THE DASH: a sculpted wing across the pod, and on its face toward you one band of glass ──
const DASH = { xL: -0.232, xR: 0.232, yMid: 0.65, sag: 0.12, w: 0.232, z0: -0.37, h: 0.215, lean: 0.42 };
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
// The five keys the sim has for this seat (power, three lighting circuits and the flaps) are glass
// keys along the band's foot, the map beside them, so a forward look shows every one and its state.
// The stick, the throttle and the pedals sit low, so each is mirrored in the windscreen HUD, and the
// flap key carries its own four-notch gauge.
const BTN = { ids: ['master', 'land', 'panel', 'dome', 'flaps'], names: { master: 'PWR', land: 'LAND', panel: 'PANEL', dome: 'CABIN', flaps: 'FLAP' } };
const KEY_V = 0.042, KEY_R = 0.022;
const BTN_X = [-0.098, -0.049, 0, 0.049, 0.098];
function switchOn(id, R) {
  if (id === 'master') return R.powered;
  if (id === 'land') return R.land;
  if (id === 'panel') return panelOn(R);
  if (id === 'dome') return R.dome && R.powered;
  if (id === 'flaps') return R.flap > 0;
  return R.powered;
}
// The pages on the band's upper row, and the map at the left of its foot.
const SCREENS = [
  { id: 'solar', x: -0.153, w: 0.074, boot: 0.3 },
  { id: 'pfd', x: 0, w: 0.074, boot: 0 },
  { id: 'sensor', x: 0.153, w: 0.074, boot: 0.45 },
];
const PAGE_V = 0.15, PAGE_H = 0.062;
const MAP = { x: -0.177, v: 0.042, hw: 0.048, hh: 0.032, boot: 0.15 };
const LAMP = { x: 0.178, w: 0.086, h: 0.026, v: [0.058, 0.024] };
const screenPanel = (K, sc) => bandPanel(K, sc.x, PAGE_V, 0.012);

export function gh76Hotspots(P, live) {
  const R = readings(live), K = makeKit(() => {}), out = [];
  BTN.ids.forEach((id, i) => out.push({ id: 'ck:' + id, p: bandPanel(K, BTN_X[i], KEY_V).pt(0, 0, 0.01), r: KEY_R + 0.002, kind: 'click' }));
  out.push({ id: 'yoke', p: add(stickAt(P, R).top, [0, 0, 0.05]), r: 0.06, kind: 'yoke' });
  const lv = leverAt(P, R);
  out.push({ id: 'throttle', p: add(lv.end, mul(lv.dir, 0.03)), r: 0.045, kind: 'throttle' });
  out.push({ id: 'trim', p: [TRIMW.x, TRIMW.y, P.gh76.zF + TRIMW.z], r: 0.05, kind: 'trim' });
  out.push(gpsHotspot(bandPanel(K, MAP.x, MAP.v, 0.008), 0, 0, 0.045));
  return out;
}

// ── THE SEATS: two reclined carbon shells, the pilot's in front and the observer's behind ──
function seats(P, push) {
  const K = makeKit(push, false);
  const zF = P.gh76.zF, yR = P.gh76.Y(GH76_INSIDE.rearF) - P.gh76.Y(GH76_INSIDE.pilotF);
  shell(K, P, 0, zF, true);
  shell(K, P, yR, zF, false);
}
// A seat whose hips are at `dy` along the pod (0 for the pilot's): a pan forward under the thighs, a
// back reclined 34° to a headrest, a harness, and for the pilot the observer's screen on its back.
function shell(K, P, dy, zF, pilot) {
  const G = P.gh76, hip = [0, 0.26 + dy, zF + 0.16];
  const lean = 34 * DEG, up = [0, -Math.sin(lean), Math.cos(lean)], fw = [0, Math.cos(lean), Math.sin(lean)];
  const hw = 0.19;
  // The pan: a carbon tray tilting up toward the knees, a leather cushion in it.
  const panDir = norm([0, 1, 0.22]), panUp = norm(cross([1, 0, 0], panDir));
  const pc = add(hip, mul(panDir, 0.2));
  K.obox(add(pc, mul(panUp, -0.03)), [1, 0, 0], panDir, panUp, hw, 0.23, 0.025, 'seat', 0.0, T.carbon);
  K.obox(add(pc, mul(panUp, 0.004)), [1, 0, 0], panDir, panUp, hw - 0.04, 0.21, 0.012, 'seat', 0.05, T.leather);
  K.box(-0.1, hip[1] - 0.02, zF, 0.1, hip[1] + 0.3, hip[2] - 0.06, 'seat', -0.25, T.carbon);
  // The back and the headrest.
  const bL = 0.62, bc = add(hip, mul(up, bL / 2));
  K.obox(add(bc, mul(fw, -0.035)), [1, 0, 0], up, fw, hw, bL / 2, 0.03, 'seat', -0.06, T.carbon);
  K.obox(add(bc, mul(fw, 0.0)), [1, 0, 0], up, fw, hw - 0.05, bL / 2 - 0.04, 0.012, 'seat', 0.0, T.leather);
  for (const s of [-1, 1]) {
    K.obox(add(add(bc, mul(fw, 0.0)), [s * (hw - 0.025), 0, 0]), [1, 0, 0], up, fw, 0.025, bL / 2, 0.035, 'seat', 0.0, T.bolster);
    K.obox(add(add(bc, mul(fw, 0.036)), [s * (hw - 0.025), 0, 0]), [1, 0, 0], up, fw, 0.003, bL / 2 - 0.02, 0.002, 'seat', 0.2, T.glow, 0.5);
  }
  for (let r = 1; r < 6; r++) K.obox(add(add(hip, mul(up, r * bL / 6)), mul(fw, 0.013)), [1, 0, 0], up, fw, hw - 0.06, 0.003, 0.002, 'seat', -0.2, T.leatherDk);
  const hc = add(hip, mul(up, bL + 0.08));
  K.obox(add(hc, mul(fw, -0.03)), [1, 0, 0], up, fw, 0.11, 0.08, 0.04, 'seat', 0.0, T.carbon);
  K.obox(add(hc, mul(fw, 0.012)), [1, 0, 0], up, fw, 0.085, 0.06, 0.006, 'seat', 0.0, T.leather);
  K.obox(add(add(hip, mul(up, bL * 0.5)), mul(fw, 0.014)), [1, 0, 0], up, fw, hw - 0.06, 0.004, 0.002, 'seat', 0.2, T.green, 0.3);
  // A five-point harness: the shoulder straps out of a slot under the headrest, the lap belts, the
  // crotch strap and a rotary buckle on the lap.
  const top = add(hip, mul(up, bL - 0.02)), buck = add(add(hip, mul(panDir, 0.16)), [0, 0, 0.1]);
  for (const s of [-1, 1]) {
    K.rod(add(add(top, mul(fw, 0.03)), [s * 0.055, 0, 0]), add(buck, [s * 0.025, 0, 0.02]), 0.011, 'seat', 0.05, T.harness, 0, 4);
    K.rod(add(add(hip, mul(panDir, 0.06)), [s * (hw - 0.03), 0, 0.04]), add(buck, [s * 0.025, 0, -0.01]), 0.011, 'seat', 0.05, T.harness, 0, 4);
  }
  K.rod(add(add(hip, mul(panDir, 0.3)), [0, 0, 0.0]), add(buck, [0, 0, -0.015]), 0.009, 'seat', 0.05, T.harness, 0, 4);
  K.rod(add(buck, [0, -0.008, 0]), add(buck, [0, 0.01, 0]), 0.03, 'seat', 0.3, T.buckle, 0, 12);
  K.rod(add(buck, [0, 0.01, 0]), add(buck, [0, 0.013, 0]), 0.011, 'seat', 0.3, T.green, 0.4, 8);
  if (!pilot) return;
  // The observer's screen on the back of the pilot's seat, under the headrest: the sensor's feed.
  // Seen from the back seat only, so it carries no lettering (it would read mirrored from this eye).
  const sc = add(add(hip, mul(up, bL * 0.62)), mul(fw, -0.072));
  K.obox(sc, [1, 0, 0], up, fw, 0.13, 0.09, 0.008, 'seat', 0.1, T.tub);
  K.obox(add(sc, mul(fw, -0.009)), [1, 0, 0], up, fw, 0.12, 0.08, 0.001, 'seat', 0.2, T.screen, 0.3);
  K.obox(add(add(sc, mul(fw, -0.01)), mul(up, 0.078)), [1, 0, 0], up, fw, 0.118, 0.002, 0.001, 'seat', 0.2, T.glow, 0.8);
  void G;
}

// ── THE FIT-OUT ──────────────────────────────────────────────────────────────
export function gh76Fit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live);
  const G = P.gh76, zF = G.zF;
  const lit = R.powered, panel = panelOn(R);
  const amb = lit ? (night(R) ? 1 : 0.55) * (R.dome ? 1.2 : 1) : 0.05;
  const boot = bootAge(live);
  const sun = solarInput(R.hour, R.weather), kwOut = drawKw(R);
  // The cabin's light lines carry the alert: teal, amber on low charge or a draining array at night,
  // red and breathing on a hull or stall warning.
  const warn = lit && (R.hull < 0.3 || R.stall), caution = lit && R.fuel < 0.15;
  const al = alertLight(caution, warn), lineK = (k) => (lit ? k * al.k : 0.05);

  // ── THE DASH: a wing swept along the band's curve, held inside the pod ──
  const curve = dashCurve();
  const gt = [DASH.h * DASH.lean / Math.hypot(1, DASH.lean), DASH.h / Math.hypot(1, DASH.lean)];
  const SEC = [[0, 0], gt, [0.12, gt[1] + 0.022], [0.2, gt[1] + 0.01], [0.23, gt[1] - 0.03], [0.19, -0.05], [0.08, -0.11], [-0.04, -0.08], [-0.05, -0.035], [0, 0]];
  const N = 26, rings = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N, c = curve(s), e = Math.abs(2 * s - 1) ** 3, tap = 1 - 0.45 * e;
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
  // The strut the dash hangs off, down to the floor between the pedals.
  { const c = curve(0.5), top = add(add(c.p, mul(c.f, 0.12)), [0, 0, -0.1]); K.rod(top, [0, top[1] + 0.02, zF + 0.03], 0.018, 'dash', 0.1, T.carbon, 0, 8); }

  // ── THE BAND: one sheet of glass, the pages on it, booting in turn when the power comes on ──
  glassBand(K, curve, { h: DASH.h, lean: DASH.lean, segs: 26, lit, light: al.rgb, lightK: lineK(1), substrate: T.screen });
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
    // current value the brightest thing on the page.
    Pn.rect(-sc.w + 0.004, PAGE_H - 0.0035, sc.w - 0.004, PAGE_H - 0.0015, T.glow, 0.85, 0.0018);
    if (sc.id === 'pfd') pfd(Pn, R);
    else if (sc.id === 'solar') solarPage(Pn, R, sun, kwOut);
    else if (sc.id === 'sensor') sensorPage(Pn, R);
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
  // powered and occupied, which is whenever this cockpit is drawn.
  {
    const on = lit && reveal(boot, 0.6) >= 1;
    lensLamp(bandPanel(K, LAMP.x, LAMP.v[0], 0.01), 0, 0, LAMP.w, LAMP.h, on, C.green, 'PILOT');
    lensLamp(bandPanel(K, LAMP.x, LAMP.v[1], 0.01), 0, 0, LAMP.w, LAMP.h, on, T.amber, 'ADVISORY');
  }

  // ── THE KEYS: five glass keys along the band's foot ──
  // A key sinks while pressed and comes back, its light eases with the circuit, it brightens as the
  // hand comes over it, and a ring flashes round it when its state changes.
  BTN.ids.forEach((id, i) => {
    const Kp = bandPanel(K, BTN_X[i], KEY_V, 0.004), on = switchOn(id, R);
    const pressed = !!live && live.press === 'ck:' + id, near = !!live && live.hover === 'ck:' + id;
    const rgb = id === 'master' ? C.green : T.glow;
    const glow = eased('gh76:glow:' + id, on && (id !== 'flaps' || lit) ? 1 : 0, 10), depth = eased('gh76:dip:' + id, pressed ? 0.002 : 0.007, 30);
    const hand = eased('gh76:near:' + id, near ? 1 : 0, 14);
    const r = KEY_R;
    Kp.rect(-r - 0.002, -r - 0.002, r + 0.002, r + 0.002, T.tub, 0, 0.0005);
    Kp.annulus(0, 0, r - 0.001, r + 0.001, T.glow, (lit ? 0.25 : 0) + hand * 0.75, 0.0012, 20);
    Kp.stud(0, 0, r - 0.003, r - 0.003, depth, rgb.map((c, k) => lerp([40, 46, 50][k], c, glow * 0.8)), glow * 0.85 + hand * 0.15, 0.0015);
    Kp.fitText(BTN.names[id], 0, id === 'flaps' ? 0.002 : -0.004, 0.042, 0.012, glow > 0.5 ? [10, 24, 22] : [214, 222, 220], glow > 0.5 ? 0 : (panel ? 0.6 : 0.25), depth + 0.0025);
    // The flap key carries its notches: four bars, lit up to the one the lever is in.
    if (id === 'flaps') for (let k = 0; k < 4; k++) {
      const u = -0.0135 + k * 0.009, here = lit && k <= R.flap;
      Kp.rect(u - 0.0032, -0.016, u + 0.0032, -0.011, here ? (k === R.flap ? T.white : T.glow) : [50, 60, 60], here ? 1 : 0.2, depth + 0.003);
    }
    const flash = pressPulse('gh76:key:' + id, id === 'flaps' ? R.flap : on);
    if (flash > 0.02) Kp.annulus(0, 0, r + 0.004, r + 0.008, HALO, flash, 0.004, 18);
  });

  // ── THE WINDSCREEN HUD: projected, conformal, the hands and feet mirrored in its corners ──
  if (lit) windscreenHud(K, R, { dist: 0.4, z: 0.008, hw: 0.13, hh: 0.05, warn, caution, boot: reveal(boot, 0.2),
    mirrors: { stick: [R.ail, R.elev], thrs: [R.thr], rud: R.rud } });

  // ── THE HOLOGRAM on the dash's shelf: the scout herself, flying as she flies ──
  // Pitched and banked with her, the propeller turning on the prop phase and ringed at its speed, the
  // cells on her wing lit by what the sun is giving them, on a projector whose arc is the charge.
  {
    const c0 = curve(0.5), base = clampIn(G, add(add(c0.p, mul(c0.f, 0.075)), [0, 0, gt[1] + 0.016]), 0.03);
    holoProjector(K, base, 0.035, 0.045, lit ? R.fuel : 0, R.fuel < 0.15 ? HOLO_RED : R.fuel < 0.3 ? HOLO_AMBER : HOLO_LINE);
    if (lit && reveal(boot, 0.7) > 0) holoScout(K, add(base, [0, 0, 0.042]), R, sun);
  }

  // ── THE LEFT CONSOLE: the throttle in its gate and the trim wheel, along the wall ──
  {
    const crings = [];
    for (let i = 0; i <= 8; i++) {
      const y = lerp(-0.1, 0.5, i / 8), sec = [];
      for (let j = 0; j <= 8; j++) {
        const a = Math.PI * j / 8, x = LEVER.x - Math.cos(a) * 0.065, z = zF + LEVER.top - (1 - Math.sin(a)) * 0.05;
        sec.push(clampIn(G, [x, y, j === 0 || j === 8 ? zF + LEVER.top - 0.16 : z], 0.006));
      }
      crings.push(sec);
    }
    sweep(K, crings, 'dash', 0.1, T.carbon);
    K.face(crings[8].slice(), [0, 1, 0], 'dash', 0.05, T.carbonLt);
    lightLine(K, crings.map((r) => add(r[7], [0, 0, 0.004])), 0.0022, al.rgb, lineK(0.85));
  }
  const lv = leverAt(P, R), lvNear = eased('gh76:near:throttle', live && (live.hover === 'throttle' || live.press === 'throttle') ? 1 : 0, 12);
  const ct = zF + LEVER.top;
  K.box(LEVER.x - 0.01, LEVER.pivotY - 0.15, ct - 0.004, LEVER.x + 0.01, LEVER.pivotY + 0.15, ct + 0.006, 'dash', -0.3, T.tub);
  for (let i = 0; i <= 4; i++) {
    const y = LEVER.pivotY - 0.13 + i * 0.065, here = lit && Math.abs(i / 4 - R.thr) < 0.13;
    K.box(LEVER.x + 0.014, y - 0.002, ct + 0.003, LEVER.x + 0.028, y + 0.002, ct + 0.007, 'dash', 0.2, here ? T.glow : T.glowDim, here ? 1 : 0.5);
  }
  K.rod(lv.pivot, lv.end, 0.009, 'dash', 0.2, T.metal, 0, 8);
  const gripEnd = add(lv.end, mul(lv.dir, 0.055));
  K.obox(mul(add(lv.end, gripEnd), 0.5), [1, 0, 0], lv.dir, norm(cross([1, 0, 0], lv.dir)), 0.018, 0.03, 0.016, 'dash', 0.1, T.carbon);
  K.obox(add(gripEnd, mul(lv.dir, 0.002)), [1, 0, 0], norm(cross([1, 0, 0], lv.dir)), lv.dir, 0.015, 0.01, 0.003, 'dash', 0.3, al.rgb, lit ? 0.4 + R.thr * 0.4 + lvNear * 0.2 : 0);
  // The trim wheel: a knurled disc standing in a slot, its index line turning with the trim, the
  // nose-up arc lit on the console beside it.
  {
    const tc = [TRIMW.x, TRIMW.y, zF + TRIMW.z], tNear = eased('gh76:near:trim', live && (live.hover === 'trim' || live.press === 'trim') ? 1 : 0, 12);
    K.box(TRIMW.x - 0.012, TRIMW.y - 0.06, ct - 0.004, TRIMW.x + 0.012, TRIMW.y + 0.06, ct + 0.005, 'dash', -0.3, T.tub);
    K.rod(add(tc, [-0.008, 0, 0]), add(tc, [0.008, 0, 0]), TRIMW.r, 'dash', 0.1, T.carbonLt, 0, 20);
    for (let k = 0; k < 16; k++) {
      const a = k * TAU / 16 + R.trim * 2.5;
      K.rod(add(tc, [-0.009, Math.cos(a) * TRIMW.r, Math.sin(a) * TRIMW.r]), add(tc, [0.009, Math.cos(a) * TRIMW.r, Math.sin(a) * TRIMW.r]), 0.0025, 'dash', 0.2, T.carbon, 0, 4, false);
    }
    const ia = R.trim * 2.5 + Math.PI / 2;
    K.rod(add(tc, [0.0095, 0, 0]), add(tc, [0.0095, Math.cos(ia) * TRIMW.r * 0.95, Math.sin(ia) * TRIMW.r * 0.95]), 0.0022, 'dash', 0.3, al.rgb, lit ? 0.6 + 0.4 * tNear : 0.1, 4);
    K.torus(add(tc, [0.011, 0, 0]), [0, 1, 0], [0, 0, 1], TRIMW.r + 0.004, 0.0025, 20, 'dash', 0.2, T.glow, lit ? 0.15 + 0.6 * tNear : 0);
  }

  // ── THE STICK between the knees ──
  const st = stickAt(P, R), stNear = eased('gh76:near:yoke', live && (live.hover === 'yoke' || live.press === 'yoke') ? 1 : 0, 12);
  {
    const b = st.base;
    K.rod(add(b, [0, 0, -0.02]), add(b, [0, 0, 0.012]), 0.05, 'dash', 0.1, T.tub, 0, 16);
    K.torus(add(b, [0, 0, 0.012]), [1, 0, 0], [0, 1, 0], 0.05, 0.004, 18, 'dash', 0.2, al.rgb, lit ? 0.5 + 0.5 * stNear : 0);
    K.rod(add(b, [0, 0, 0.012]), add(b, mul(st.dir, 0.06)), 0.028, 'dash', -0.1, T.tub, 0, 10);
    K.rod(add(b, mul(st.dir, 0.05)), st.top, 0.011, 'dash', 0.2, T.metal, 0, 8);
    const gTop = add(st.top, mul(st.dir, 0.1));
    K.rod(st.top, gTop, 0.02, 'dash', 0.05, T.carbon, 0, 12);
    K.rod(add(gTop, mul(st.dir, -0.004)), add(gTop, mul(st.dir, 0.008)), 0.015, 'dash', 0.2, T.carbonLt, 0, 12);
    K.obox(add(gTop, mul(st.dir, 0.009)), [1, 0, 0], [0, 1, 0], st.dir, 0.006, 0.006, 0.002, 'dash', 0.3, al.rgb, lit ? 0.5 + 0.5 * stNear : 0);
    contactShadow(K, [b[0], b[1], zF], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.06, 0.06);
  }

  // ── THE PEDALS: two plates on rails in the footwell, one forward as the other comes back ──
  const py = 1.02, pz = zF + 0.12;
  for (const [dx, sgn] of [[-0.075, -1], [0.075, 1]]) {
    const slide = clamp(R.rud * sgn, -1, 1) * 0.04;
    K.box(dx - 0.01, py - 0.1, zF, dx + 0.01, py + 0.1, zF + 0.018, 'dash', 0.1, T.metal);
    const c = [dx, py + slide, pz];
    K.obox(c, [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.038, 0.085, 0.007, 'dash', 0.05, T.carbon);
    K.obox(add(c, mul(norm([0, -0.89, -0.45]), -0.008)), [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.032, 0.075, 0.002, 'dash', 0.1, T.tub);
    K.obox(add(c, mul(norm([0, -0.89, -0.45]), -0.011)), [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.0035, 0.06, 0.001, 'dash', 0.2, al.rgb, lit ? 0.3 + 0.7 * clamp(R.rud * sgn, 0, 1) : 0);
    K.rod(add(c, [0, 0, -0.05]), [dx, py + slide, zF + 0.018], 0.01, 'dash', 0.2, T.metal, 0, 6);
    contactShadow(K, [dx, py + slide, zF], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.045, 0.1);
  }

  // ── OVERHEAD: a dome lamp in the hoop, over your head and behind ──
  {
    const hf = GH76_FRAMES.hoop + 0.004, dome = G.toShell(gh76Point(hf, 90, -(G.inset + 0.04 / G.m)));
    K.rod(add(dome, [0, 0.02, 0]), add(dome, [0, -0.02, 0]), 0.03, 'hdr', 0.1, R.dome && lit ? [240, 252, 248] : [80, 84, 84], R.dome && lit ? 1 : 0, 14);
    void amb;
  }

  hotspotHalo(K, gh76Hotspots(P, live), live);
}

// ── THE HOLOGRAM: the scout in miniature, a hand's width across ──
// Her pod as section rings and a keel line, the long wing with its cells lit by the sun, the tail,
// the sensor ball, and the propeller turning on the prop phase, ringed in its speed colour.
function holoScout(K, c, R, sun) {
  const H = holoFrame(K, c, R.pitch, R.bank);
  const sc = 0.06;                                        // metres a model unit
  const P = (f, g, h) => [g * sc, f * sc, (h - 0.03) * sc];
  const on = R.powered && R.rpm > 0.02, frac = clamp(R.rpm / 1.05, 0, 1);
  // The pod: five section rings and a crown and keel line.
  for (const f of [0.72, 0.5, 0.3, 0.05, -0.3]) {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const q = gh76Point(f, i * 30); pts.push(P(q[0], q[1], q[2])); }
    for (let i = 0; i < 12; i++) H.line(pts[i], pts[i + 1], 0.0006);
  }
  for (const a of [90, -90, 0, 180]) {
    const pts = GH76_STATIONS.filter((_, i) => i % 2 === 0).map((s) => { const q = gh76Point(s.f, a); return P(q[0], q[1], q[2]); });
    for (let i = 0; i + 1 < pts.length; i++) H.line(pts[i], pts[i + 1], 0.0006);
  }
  // The wing: leading and trailing edges out to the tips, each half a band of cells lit by the sun.
  const W = [GH76_WING.root, GH76_WING.kink, GH76_WING.tip];
  for (const s of [1, -1]) {
    for (let i = 0; i + 1 < W.length; i++) {
      const A = W[i], B = W[i + 1];
      H.line(P(A.le, s * A.g, A.h), P(B.le, s * B.g, B.h), 0.0008);
      H.line(P(A.te, s * A.g, A.h), P(B.te, s * B.g, B.h), 0.0008);
      const k = lerp(0.12, 0.7, A.le - A.te > 0 ? 0.5 : 0);
      const x = (S, t) => S.le - (S.le - S.te) * t;
      H.plate([P(x(A, 0.08), s * A.g, A.h), P(x(B, 0.08), s * B.g, B.h), P(x(B, 0.68), s * B.g, B.h), P(x(A, 0.68), s * A.g, A.h)],
        sun.kw > 0.05 ? HOLO_SUN : HOLO, sun.kw > 0.05 ? 0.25 + 0.75 * clamp(sun.kw / ARRAY_PEAK_KW, 0, 1) : k * 0.5);
    }
    const t = W[2];
    H.line(P(t.le, s * t.g, t.h), P(t.te, s * t.g, t.h), 0.0008);
  }
  // The tail: the tailplane and the fin.
  for (const s of [1, -1]) H.plate([P(-0.7, 0, 0.09), P(-0.8, s * 0.44, 0.1), P(-0.91, s * 0.44, 0.1), P(-0.9, 0, 0.09)]);
  H.plate([P(-0.66, 0, 0.1), P(-0.86, 0, 0.36), P(-0.99, 0, 0.36), P(-0.93, 0, 0.06)]);
  // The sensor ball under the chin, and its look-down line.
  H.ring(P(0.585, 0, -0.118), [1, 0, 0], [0, 0, 1], 0.042 * sc, 10, HOLO_LINE, 0.8);
  H.line(P(0.585, 0, -0.118), P(0.585 + 0.5 * Math.cos(30 * DEG), 0, -0.118 - 0.5 * Math.sin(30 * DEG)), 0.0005, HOLO_AMBER, 0.6);
  // The propeller: three blades turning on the prop phase, the disc ringed at its speed.
  const hub = P(0.83, 0, 0.03), pr = 0.2 * sc;
  H.ring(hub, [1, 0, 0], [0, 0, 1], pr, 18, frac > 0.85 ? HOLO_LINE : HOLO_AMBER, on ? 1 : 0.3);
  for (let b = 0; b < 3; b++) {
    const t = (on ? R.phase * 2.2 : 0) + b * TAU / 3;
    H.line(hub, add(hub, [Math.cos(t) * pr * 0.95, 0, Math.sin(t) * pr * 0.95]), 0.0011, HOLO_LINE, 1);
  }
}

// ── THE FLIGHT PAGE: attitude, speed and height, heading, climb, trim ──
function pfd(Pn, R) {
  Pn.attitude(0, -0.004, 0.04, R.pitch, R.bank);
  // Speed on the left and height on the right, each boxed, with a scale of five ticks either side.
  const box = (u, v, s, unit, digitsN) => {
    Pn.rect(u - 0.022, v - 0.012, u + 0.022, v + 0.012, [10, 18, 20], 0.3, 0.002);
    Pn.digits(u - 0.019, v - 0.007, 0.013, String(Math.round(s)).padStart(digitsN, ' ').slice(-digitsN), T.white, false);
    Pn.text(unit, u, v - 0.026, 0.011, T.dim, 0.5, 0.003);
  };
  box(-0.051, 0.0, R.ias, 'KT', 3);
  box(0.051, 0.0, R.alt, 'FT', 4);
  // The speed band: the green arc's worth of the vne as a lit strip down the left edge.
  const sp = clamp(R.ias / R.vne, 0, 1);
  Pn.rect(-0.071, -0.045, -0.068, 0.045, [24, 34, 34], 0.3, 0.002);
  Pn.rect(-0.0715, -0.045, -0.0675, -0.045 + 0.09 * sp, sp > 0.9 ? T.red : sp > 0.75 ? T.amber : T.glow, 0.9, 0.003);
  // The climb: a bar from the middle of the right edge, up or down.
  const vs = clamp(R.vsi / 1000, -1, 1);
  Pn.rect(0.068, -0.045, 0.071, 0.045, [24, 34, 34], 0.3, 0.002);
  if (Math.abs(vs) > 0.01) Pn.rect(0.0675, Math.min(0, vs * 0.045), 0.0715, Math.max(0, vs * 0.045), vs > 0 ? C.green : T.amber, 0.9, 0.003);
  // The heading, top centre, and the trim's index under the attitude.
  Pn.rect(-0.016, 0.038, 0.016, 0.054, T.screen, 0.2, 0.0035);
  Pn.digits(-0.013, 0.041, 0.011, String(Math.round(((R.hdg % 360) + 360) % 360)).padStart(3, '0'), T.glow, false);
  Pn.rect(-0.03, -0.052, 0.03, -0.05, [40, 60, 60], 0.3, 0.003);
  Pn.rect(R.trim * 0.028 - 0.002, -0.056, R.trim * 0.028 + 0.002, -0.046, T.glow, 0.9, 0.004);
  if (R.stall) Pn.rect(-0.07, -0.061, 0.07, -0.057, T.red, 1, 0.004);
}

// ── THE SOLAR PAGE: the sun's height, the array's input, the draw, the net, the charge ──
function solarPage(Pn, R, sun, kwOut) {
  Pn.text('SOLAR', -0.044, 0.046, 0.011, T.dim, 0.5, 0.003);
  // The sky the input is reckoned under: the weather word, or NO WX when the view sends none.
  Pn.fitText(sun.known ? R.weather.toUpperCase() : 'NO WX', 0.04, 0.046, 0.06, 0.011, sun.known && sun.sky < 0.5 ? T.amber : T.dim, 0.5, 0.003);
  // The day as an arc, six to six, with the sun on it at the hour (under the line when it is down).
  const ac = [-0.035, 0.0], ar = 0.03;
  Pn.rect(ac[0] - ar - 0.004, ac[1] - 0.0007, ac[0] + ar + 0.004, ac[1] + 0.0007, [60, 90, 90], 0.4, 0.002);
  Pn.annulus(ac[0], ac[1], ar - 0.0007, ar + 0.0007, [60, 90, 90], 0.4, 0.002, 18, 0, Math.PI);
  const t = clamp((R.hour - 6) / 12, -0.2, 1.2), sa = Math.PI * (1 - t);
  const sx = ac[0] + Math.cos(sa) * ar, sy = ac[1] + Math.sin(sa) * ar * (sun.elev > 0 ? 1 : 0) - (sun.elev > 0 ? 0 : 0.006);
  Pn.disc(sx, sy, 0.0055, sun.elev > 0 ? T.sun : [90, 100, 110], sun.elev > 0 ? 1 : 0.3, 0.004, 12);
  Pn.text('SUN', ac[0], -0.012, 0.011, T.dim, 0.5, 0.003);
  Pn.digits(ac[0] - 0.012, 0.012, 0.011, String(Math.round(sun.elev)).padStart(2, ' '), T.white, false);
  // In and out, in kilowatts, as two bars with the numbers beside them.
  const row = (v, label, kw, max, rgb) => {
    Pn.text(label, 0.012, v, 0.011, T.dim, 0.5, 0.003);
    Pn.rect(0.024, v - 0.004, 0.07, v + 0.004, [24, 34, 34], 0.3, 0.002);
    if (kw > 0.01) Pn.rect(0.024, v - 0.0035, 0.024 + 0.046 * clamp(kw / max, 0, 1), v + 0.0035, rgb, 0.9, 0.003);
  };
  row(0.025, 'IN', sun.kw, ARRAY_PEAK_KW, T.sun);
  Pn.digits(0.03, 0.009, 0.011, sun.kw.toFixed(1).padStart(4, ' '), T.white, false);
  row(-0.008, 'OUT', kwOut, MOTOR_KW, kwOut > 40 ? T.amber : T.glow);
  Pn.digits(0.03, -0.024, 0.011, String(Math.round(kwOut)).padStart(3, ' '), T.white, false);
  // The charge: ten cells filled to it, and the endurance at this net draw in minutes.
  const soc = R.fuel;
  for (let i = 0; i < 10; i++) {
    const u = -0.068 + i * 0.0072, f = clamp(soc * 10 - i, 0, 1);
    Pn.rect(u, -0.05, u + 0.0058, -0.034, [24, 34, 34], 0.3, 0.002);
    if (f > 0.02) Pn.rect(u + 0.0006, -0.0494, u + 0.0052, -0.0494 + 0.0148 * f, soc < 0.15 ? T.red : soc < 0.3 ? T.amber : T.glow, 0.95, 0.003);
  }
  // Endurance: a 40 kWh pack's charge over the net draw. A net gain reads as a full bar of minutes.
  const net = kwOut - sun.kw;
  const mins = net > 0.05 ? Math.min(999, Math.round(soc * 40 * 60 / net)) : 999;
  Pn.text('MIN', 0.006, -0.052, 0.011, T.dim, 0.5, 0.003);
  Pn.digits(0.042, -0.057, 0.011, String(mins).padStart(3, ' '), net > 0.05 && mins < 20 ? T.amber : T.white, false);
}

// ── THE SENSOR PAGE: what the ball sees, slaved forward and looking down 30° ──
// The view is the ball's: the ground below the nose in perspective, the horizon rolled with her bank
// and above the frame at a level attitude, a grid of 50 m squares that grows finer as she climbs, the
// reticle in the middle. Day camera by day, thermal by night (white on dark). The ranges are off the
// altitude: slant range to the reticle and the ground distance ahead of her.
const BALL_DEP = 30;
function sensorPage(Pn, R) {
  const ir = night(R);
  Pn.text(ir ? 'IR' : 'TV', -0.058, 0.046, 0.011, ir ? T.white : T.glow, 0.6, 0.003);
  const vw = 0.068, vh = 0.034, vc = 0.005;
  Pn.rect(-vw, vc - vh, vw, vc + vh, ir ? [20, 22, 24] : [16, 30, 26], 0.4, 0.002);
  // The camera's frame, 40° tall: degrees to page metres.
  const k = (vh * 2) / 40;
  const look = BALL_DEP - R.pitch;                       // the reticle's depression under the horizon
  const bk = -R.bank * DEG, cb = Math.cos(bk), sb = Math.sin(bk);
  const rot = (u, v) => [u * cb - v * sb, u * sb + v * cb + vc];
  const inF = ([u, v]) => Math.abs(u) <= vw - 0.001 && Math.abs(v - vc) <= vh - 0.001;
  const seg = (a, b, rgb, e, w = 0.0006) => {
    // Clip to the frame by sampling: short pieces either side of a step are dropped, never drawn outside.
    const n = 10;
    for (let i = 0; i < n; i++) {
      const p = [lerp(a[0], b[0], i / n), lerp(a[1], b[1], i / n)], q = [lerp(a[0], b[0], (i + 1) / n), lerp(a[1], b[1], (i + 1) / n)];
      if (!inF(p) || !inF(q)) continue;
      const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1, px = -dy / L * w, py = dx / L * w;
      Pn.plate([[p[0] - px, p[1] - py], [q[0] - px, q[1] - py], [q[0] + px, q[1] + py], [p[0] + px, p[1] + py]], rgb, e, 0.004);
    }
  };
  const lineC = ir ? [220, 226, 230] : [110, 210, 170];
  // The horizon, `look` degrees above the reticle (off the frame unless she is nose-down).
  const hv = look * k;
  seg(rot(-0.2, hv), rot(0.2, hv), lineC, 0.9, 0.0008);
  // The ground grid: lines across at 50 m steps ahead of the point under her, and lines along that
  // fan from the vanishing point on the horizon. Height in metres off the altimeter's feet.
  const hM = Math.max(5, R.alt * 0.3048);
  for (let d = 50; d < 4000; d += 50) {
    const dep = Math.atan2(hM, d) / DEG;             // degrees under the horizon
    const v = (look - dep) * k;
    if (v > hv || -v > vh * 3) continue;
    seg(rot(-0.2, v), rot(0.2, v), lineC, d % 250 === 0 ? 0.55 : 0.25);
  }
  for (let x = -400; x <= 400; x += 50) {
    const near = (look - 80) * k, w2 = (x / hM) * 40 * k * 0.6;
    seg(rot(0, hv), rot(w2, near), lineC, x === 0 ? 0.5 : 0.22);
  }
  // The reticle, with its gap.
  for (const [a, b] of [[[-0.022, 0], [-0.008, 0]], [[0.008, 0], [0.022, 0]], [[0, -0.016], [0, -0.006]], [[0, 0.006], [0, 0.016]]]) seg([a[0], a[1] + vc], [b[0], b[1] + vc], T.amber, 1, 0.0007);
  // The ranges: slant to the reticle's ground point, and that point's distance ahead, in metres.
  const dep = Math.max(1, BALL_DEP + R.pitch);
  const slant = R.alt > 0 ? hM / Math.sin(dep * DEG) : 0, ahead = R.alt > 0 ? hM / Math.tan(dep * DEG) : 0;
  Pn.text('SLT', -0.058, -0.04, 0.011, T.dim, 0.5, 0.003);
  Pn.digits(-0.046, -0.058, 0.011, String(Math.min(9999, Math.round(slant))).padStart(4, ' '), T.white, false);
  Pn.text('GND', 0.022, -0.04, 0.011, T.dim, 0.5, 0.003);
  Pn.digits(0.034, -0.058, 0.011, String(Math.min(9999, Math.round(ahead))).padStart(4, ' '), T.white, false);
  Pn.text('DEP', 0.018, 0.046, 0.011, T.dim, 0.5, 0.003);
  Pn.digits(0.044, 0.041, 0.011, String(BALL_DEP), T.glow, false);
}
