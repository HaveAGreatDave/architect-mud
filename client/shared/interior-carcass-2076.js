// THE CARCASS 2076'S COCKPIT: the seat of the downed 2070s homebuilt, as geometry.
//
// The Carcass 2076 is the wreck class's concept body (mesh_wreck_2076.json): a 2070s single-seat
// composite homebuilt that came down in a field and was flown out again by whoever found it. She can
// fly herself, or could before the crash; Halcyon's Warm Hands Rider voids the hull cover on any
// flight logged without a living pilot at the controls, so the controls are there and they work, and
// the panel says, politely, that they are advisory.
//
// It is built off the old tub (interior-carcass.js): the same seat, the stick between the knees, the
// throttle and the trim on the left, the same five switches and the phone's job done by the map. But
// the airframe is fifty years newer and so is the panel, and the panel came through the crash about
// as well as the bubble did. One curved band of glass runs across a swept dash, cracked from the right
// end and taped; one page on it is dead and one flickers; the hologram over the dash glitches but is
// still her, donor wing and broken winglet and all. The dome switch is the Fly Baby's own toggle, taped
// to the glass where a key died. The flight recorder survived in the tail and is wired forward: its
// page on the band reads out the channels it is recording, live.
//
// Sources read for this file:
//   https://en.wikipedia.org/wiki/Sonex_Aircraft_Onex (single-seat low-wing homebuilt, 5.3 m long)
//   https://en.wikipedia.org/wiki/Flight_recorder (the parameters an FDR records; the orange box)
//   The cockpit fit-out is the game's fiction; nothing above is a source for a dimension inside.
//
// ── ⚠ THE ROOM IS THE EXTERIOR'S FUSELAGE ───────────────────────────────────
//
// client/shared/cabin-carcass-2076.js states the fuselage's stations and where its glass is, and the
// exterior generator builds the shell and the bubble from the same file. The wall here is the
// fuselage's own section walked at its own stations and pushed in by a wall's thickness, the canopy
// is the absence of wall where the layout says glass, and anything that would reach the skin (the
// dash, the consoles) is clamped to the inside of the section it stands in.
//
// ── ⚠ ONE SCALE: THE SPAN ───────────────────────────────────────────────────
//
// CR76_SPAN_M over the wing's own span in model units, which is the Fly Baby's 8.38 m over 3.07: the
// old tub's 2.733 m a unit, so a metre here is a metre there. Anything about a PERSON (seat, reach, a
// screen's size) is honest metres.
//
// ── ⚠ EVERY READING IS A LIVE VALUE OR DERIVED FROM ONE IN THE OPEN ─────────
//
// The fuel flow is the engine's at this throttle and rpm (a 55 kW biofuel twin burns about 17 litres
// an hour flat out). The recorder's page is the live channels themselves. The flicker, the dead page's
// static and the hologram's glitch are decoration on wall time; no readout moves except on a live value.
import { brandTrim } from './interior-brands.js';
import { makeKit, C, clamp, lerp, SHINY, PANE, TEXTURE } from './interior-kit.js';
import { contactShadow, hotspotHalo, panelGps, gpsHotspot, lensLamp, eased, pressPulse, HALO, wallSec,
  bootAge, reveal, alertLight, sweep, lightLine, bandFrame, glassBand, holoFrame, holoProjector, windscreenHud,
  HOLO, HOLO_LINE, HOLO_AMBER, HOLO_RED } from './interior-cockpit-kit.js';
import { MESH_ROWS } from './vehicle-meshes.js';
import { CR76_GLASS, CR76_FRAMES, CR76_INSIDE, CR76_WING, CR76_SPAN_M, CR76_STATIONS, cr76Section, cr76Point } from './cabin-carcass-2076.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
// A repeatable 0..1 from a wall-time step, for the decoration's flicker and glitch.
const noise = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
// The decoration's clock: the wall's, unless a gate holds it still (`CR76_DECO.t`), so a gate comparing
// two live states sees only what the live values moved.
export const CR76_DECO = { t: null };
const decoSec = () => (CR76_DECO.t != null ? CR76_DECO.t : wallSec());

// ── THE STYLE ────────────────────────────────────────────────────────────────
// The factory's bone and carbon, worn; the old tub's chromate where the lining was stripped back to
// the structure; gaffer, alloy patches and the recorder's orange. The light that runs round the room
// and every display's normal colour is teal; amber is caution, red a warning.
export const CR76_TRIM = {
  lining: [196, 192, 180], liningDk: [160, 156, 146], carbon: [36, 38, 38], carbonLt: [58, 60, 60], tub: [26, 28, 28],
  chromate: [132, 146, 72], leather: [96, 88, 76], leatherDk: [66, 60, 52], bolster: [44, 44, 42], teal: [38, 138, 134],
  glow: [120, 236, 210], glowDim: [40, 92, 84], floor: [42, 42, 40], floorEdge: [28, 28, 27],
  metal: [150, 154, 158], harness: [64, 68, 74], cargo: [226, 108, 30], buckle: [176, 182, 190],
  screen: [6, 12, 14], dead: [3, 4, 5], crack: [214, 232, 230], tape: [150, 152, 148], gaffer: [30, 30, 32], alu: [170, 174, 176],
  orange: [240, 110, 24], foam: [214, 190, 110], leaf: [60, 168, 84], wire: [200, 200, 196],
  red: [235, 60, 48], amber: [255, 176, 64], white: [230, 244, 238], dim: [150, 190, 182], bio: [214, 160, 40],
};
const T = CR76_TRIM;
for (const k of ['lining', 'liningDk', 'chromate']) TEXTURE.set(T[k], 'paint');
for (const k of ['carbon', 'carbonLt', 'tub']) TEXTURE.set(T[k], 'plastic');
for (const k of ['leather', 'leatherDk', 'bolster']) TEXTURE.set(T[k], 'leather');
for (const k of ['floor', 'floorEdge']) TEXTURE.set(T[k], 'carpet');
for (const k of ['metal', 'buckle', 'alu', 'tape']) TEXTURE.set(T[k], 'brushed');
for (const k of ['harness', 'cargo', 'gaffer', 'foam']) TEXTURE.set(T[k], 'fabric');
SHINY.set(T.carbon, { spec: 0.4, pow: 26 });
SHINY.set(T.carbonLt, { spec: 0.36, pow: 22 });
SHINY.set(T.lining, { spec: 0.16, pow: 12 });
SHINY.set(T.metal, { spec: 0.7, pow: 36 });
SHINY.set(T.alu, { spec: 0.5, pow: 20 });
SHINY.set(T.buckle, { spec: 0.8, pow: 40 });
SHINY.set(T.screen, { spec: 0.6, pow: 60 });
SHINY.set(T.dead, { spec: 0.7, pow: 70 });
brandTrim(T, 'carcass', TEXTURE, SHINY);
// The hologram's donor panel, in the donor's own amber, and its glitch ghost: translucent like the rest.
const HOLO_DONOR = [255, 170, 90], HOLO_GHOST = [255, 80, 120];
PANE.set(HOLO_DONOR, 0.5); PANE.set(HOLO_GHOST, 0.35);

// The pilot's eye: on the centreline at the old tub's station, a seated eye height (0.84 m, a little
// reclined) over the floor.
const EYE = { f: CR76_INSIDE.seatF, g: 0, overFloorM: 0.84 };
const WALL_M = 0.03;
const FN = 0.6;                       // the footwell's end: the header tank behind the firewall's skin

// ── THE PROFILE ──────────────────────────────────────────────────────────────
export function carcass2076Profile(doc = MESH_ROWS.wreck_2076) {
  if (!doc) return null;
  const m = CR76_SPAN_M / (2 * CR76_WING.tip.g);
  const fE = EYE.f, gE = EYE.g, hE = CR76_INSIDE.floorH + EYE.overFloorM / m;
  const X = (g) => (g - gE) * m, Y = (f) => (f - fE) * m, Z = (h) => (h - hE) * m;
  const toShell = (q) => [X(q[1]), Y(q[0]), Z(q[2])];
  const fromShell = (q) => [q[1] / m + fE, q[0] / m + gE, q[2] / m + hE];
  const inset = WALL_M / m;
  const fB = CR76_INSIDE.bulkheadF, zF = Z(CR76_INSIDE.floorH);
  const G = { m, X, Y, Z, toShell, fromShell, inset, fB, zF, fW: CR76_GLASS.bubble.f[0] };
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
  const B = CR76_GLASS.bubble;
  return {
    label: 'Carcass 2076 seat',
    xCentre: 0, halfW,
    floor: z0 - 1e-6, roof: z1 + 1e-6, front: y1 + 1e-6, back: y0 - 1e-6,
    mPerUnit: m, glassAftY: Y(G.fW),
    // The side rays go out through the bubble beside the pilot's head.
    winY: [Y(fE - 0.03), Y(fE + 0.03)], winZ: [Z(cr76Point(fE, B.a[0] + 8)[2]), Z(cr76Point(fE, 50)[2])],
    dashY: DASH.yMid - DASH.sag, dashZ: DASH.z0, headerZ: Z(cr76Point(fE, 80)[2]), pillarW: 0.03,
    seatZ: zF + 0.18, seatHalf: 0.2, seatY: [-0.3, 0.12], backZ: -0.3,
    roofGlass: true,          // straight up from the pilot is the bubble and the sky
    seats: 1, centrePost: 0,
    normalLit: true,
    floods: [{ p: [0, 0.5, -0.3], r: 0.45 }, { p: [0, -0.4, -0.1], r: 0.5 }],
    floodGain: 1.4, glare: 0.25,
    room: cr76Shell,
    glass,
    cr76: { ...G, faces: room.faces },
    hotspots(live) { return cr76Hotspots(this, live); },
  };
}

// Pull a cabin point in until it is `margin` metres inside the fuselage's skin at its own station and
// height: the dash and the consoles are drawn freely and then held off the wall by this.
function clampIn(G, q, margin = 0.012) {
  const [f, g, h] = G.fromShell(q);
  const s = cr76Section(f), e = 1 - s.boxy * 0.55, dh = h - s.cz;
  const inn = G.inset + margin / G.m;
  const rg = s.rg - inn, rv = (dh >= 0 ? s.rvT : s.rvB) - inn;
  const t = clamp(Math.abs(dh) / rv, 0, 0.999);
  const gMax = rg * Math.pow(1 - Math.pow(t, 2 / e), e / 2);
  if (Math.abs(g) <= gMax) return q;
  return G.toShell([f, Math.sign(g) * gMax, h]);
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
// Built once per profile: the lining (stripped to chromate in places), the bubble's sills, foot and
// hoop, the bulkhead behind the seat, the footwell's end, the floor and the light along the sills.
function buildRoom(G) {
  const { toShell, inset, fB, zF, m } = G;
  const faces = [];
  const put = (p, n, tone, k, rgb, emis) => faces.push({ p, n, tone, k, rgb, emis: emis || 0 });
  const K = makeKit((fs, tone, k, fwd, rgb, emis) => { for (const f of fs) put(f.p, f.n, tone, k, rgb, emis); }, false);
  const S = (f, aDeg, inM = 0) => toShell(cr76Point(f, aDeg, -(inset + inM / m)));
  const inward = (f, a) => {
    const d = 1e-4;
    let n = norm(cross(sub(S(f + d, a), S(f - d, a)), sub(S(f, a + d * 50), S(f, a - d * 50))));
    const c = toShell([f, 0, cr76Section(f).cz]);
    if (dot(n, sub(c, S(f, a))) < 0) n = mul(n, -1);
    return n;
  };
  const aboveFloor = (poly) => clipHalf(poly, (q) => q[2] - zF);
  const Bb = CR76_GLASS.bubble;

  // ── THE SHELL: walked in the fuselage's own (f, angle), bulkhead to footwell, the bubble cut out.
  const FS = [fB, -0.26, -0.22, -0.18, -0.14, -0.1, -0.06, -0.02, 0.02, 0.06, 0.1, 0.14, 0.18, 0.22, 0.26, 0.3, 0.34, 0.38, Bb.f[1], 0.5, FN];
  const NA = 72;
  const holes = [[[Bb.f[0], Bb.a[0]], [Bb.f[1], Bb.a[0]], [Bb.f[1], Bb.a[1]], [Bb.f[0], Bb.a[1]]]];
  for (let i = 0; i < FS.length - 1; i++) {
    for (let j = 0; j < NA; j++) {
      const f0 = FS[i], f1 = FS[i + 1], a0 = -90 + (j / NA) * 360, a1 = -90 + ((j + 1) / NA) * 360;
      let cells = [[[f0, a0], [f1, a0], [f1, a1], [f0, a1]]];
      for (const h of holes) cells = cells.flatMap((c) => (bbOverlap(c, h) ? subtractConvex(c, h) : [c]));
      const fm = (f0 + f1) / 2, am = (a0 + a1) / 2, sn = Math.sin(am * DEG);
      const n = inward(fm, am);
      // The lining was stripped back to the structure where the crash cracked it: chromate patches.
      const stripped = noise(i * 7.3 + j * 1.9) < 0.12 && sn > -0.3 && sn < 0.4;
      for (const c of cells) {
        const poly = aboveFloor(c.map(([f, a]) => S(f, a)));
        if (poly.length < 3) continue;
        if (sn > 0.8) put(poly, n, 'hdr', -0.24, T.lining);
        else if (sn < -0.2) put(poly, n, 'pil', -0.18, T.tub);
        else if (fm > Bb.f[1]) put(poly, n, 'pil', -0.12, T.carbon);        // the footwell, under the cowl's deck
        else put(poly, n, 'pil', -0.12, stripped ? T.chromate : sn > 0.1 ? T.lining : T.liningDk);
      }
    }
  }

  // ── THE REVEALS: a carbon return round the bubble and a lit seal along its inner edge.
  const revealEdge = (pts, cF, cA, lit = true) => {
    for (let t = 1; t < pts.length; t++) {
      const [fa, aa] = pts[t - 1], [fb, ab] = pts[t];
      const i0 = S(fa, aa), i1 = S(fb, ab), o0 = toShell(cr76Point(fa, aa, -0.003 / m)), o1 = toShell(cr76Point(fb, ab, -0.003 / m));
      const fm = (fa + fb) / 2, am = (aa + ab) / 2;
      const toC = sub(S(cF, cA), S(fm, am));
      const out = norm(sub(toShell(cr76Point(fm, am, 0)), S(fm, am)));
      const rn = norm(sub(toC, mul(out, dot(toC, out))));
      if (i0[2] > zF && i1[2] > zF) put([i0, i1, o1, o0], rn, 'pil', 0.05, T.carbon);
      if (lit && i0[2] > zF + 0.01 && i1[2] > zF + 0.01) K.rod(S(fa, aa, 0.006), S(fb, ab, 0.006), 0.003, 'pil', 0.1, T.glowDim, 0.35, 5, false);
    }
  };
  const edge = (f0, a0, f1, a1, n) => Array.from({ length: n + 1 }, (_, i) => [lerp(f0, f1, i / n), lerp(a0, a1, i / n)]);
  revealEdge(edge(Bb.f[0], Bb.a[0], Bb.f[1], Bb.a[0], 18), (Bb.f[0] + Bb.f[1]) / 2, 60);
  revealEdge(edge(Bb.f[0], Bb.a[1], Bb.f[1], Bb.a[1], 18), (Bb.f[0] + Bb.f[1]) / 2, 120);
  revealEdge(edge(Bb.f[1], Bb.a[0], Bb.f[1], Bb.a[1], 20), Bb.f[1] - 0.05, 90, false);
  // ── THE HOOP: the carbon arch at the bubble's back, where it latches, with its lit seal and the two
  // grab handles the pilot pulls the bubble shut by.
  {
    const hf = CR76_FRAMES.hoop + 0.004;
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
    // One handle's grip is gaffer, wound on where the moulding split.
    K.rod(S(hf + 0.01, 126, 0.03), S(hf + 0.01, 134, 0.03), 0.011, 'post', 0.1, T.gaffer, 0, 8);
  }
  // The sill rails the bubble slides on, inside each sill.
  for (const s of [1, -1]) {
    const A = (a) => (s > 0 ? a : 180 - a);
    const rail = edge(Bb.f[0] + 0.01, A(Bb.a[0] - 3), Bb.f[1] - 0.02, A(Bb.a[0] - 3), 10).map(([f, a]) => S(f, a, 0.016));
    for (let k = 1; k < rail.length; k++) K.rod(rail[k - 1], rail[k], 0.006, 'pil', 0.3, T.metal, 0, 5, false);
  }

  // ── THE FOOTWELL'S END ahead of the pedals, and THE BULKHEAD behind the seat ──
  const ring = (f) => { const o = []; for (let k = 0; k <= 72; k++) o.push(S(f, -90 + (k / 72) * 360)); return aboveFloor(o); };
  const fw = ring(FN);
  if (fw.length >= 3) put(fw, [0, -1, 0], 'post', -0.15, T.carbon);
  const bk = ring(fB);
  if (bk.length >= 3) put(bk, [0, 1, 0], 'post', -0.12, T.carbon);
  // The recorder's cable comes through the bulkhead in a grommet; a stencilled hand-hold plate over it.
  const yB = G.Y(fB);
  K.rod([0.09, yB, zF + 0.12], [0.09, yB + 0.02, zF + 0.12], 0.016, 'post', 0.1, T.gaffer, 0, 10);

  // ── THE FLOOR: a carbon trough from the bulkhead to the footwell, edged in light ──
  const floorHalf = (f) => {
    let prev = null;
    for (let a = -90; a <= 0; a += 1) {
      const q = cr76Point(f, a, -inset);
      if (prev && prev[2] < CR76_INSIDE.floorH && q[2] >= CR76_INSIDE.floorH) {
        const t = (CR76_INSIDE.floorH - prev[2]) / (q[2] - prev[2]);
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
  // The recorder's cable along the right of the floor, cable-tied down, from the bulkhead to the dash.
  {
    const pts = [[0.09, yB + 0.02, zF + 0.12], [0.11, yB + 0.08, zF + 0.012], [0.14, 0.2, zF + 0.012], [0.15, 0.5, zF + 0.014], [0.16, 0.62, zF + 0.2]];
    for (let k = 1; k < pts.length; k++) K.rod(pts[k - 1], pts[k], 0.006, 'floor', 0.1, T.orange, 0, 6, false);
    for (const y of [0.0, 0.25, 0.42]) K.rod([0.13 + y * 0.04, y - 0.005, zF + 0.012], [0.13 + y * 0.04, y + 0.005, zF + 0.012], 0.009, 'floor', 0.1, T.gaffer, 0, 6);
  }
  return { faces };
}

// ── THE GLASS ────────────────────────────────────────────────────────────────
// The bubble the renderer lays over the room as film, faceted along the fuselage in (f, angle), 5 mm
// inside the skin and outboard of every reveal.
function buildGlass(G) {
  const { toShell, m } = G;
  const d = 0.005 / m;
  const panes = [];
  const grid = (f0, f1, a0, a1, nf, na) => {
    for (let i = 0; i < nf; i++) for (let j = 0; j < na; j++) {
      const fa = lerp(f0, f1, i / nf), fb = lerp(f0, f1, (i + 1) / nf), aa = lerp(a0, a1, j / na), ab = lerp(a0, a1, (j + 1) / na);
      panes.push([[fa, aa], [fb, aa], [fb, ab], [fa, ab]].map(([f, a]) => toShell(cr76Point(f, a, -d))));
    }
  };
  const Bb = CR76_GLASS.bubble;
  grid(Bb.f[0], Bb.f[1], Bb.a[0], Bb.a[1], 14, 22);
  panes.bubble = panes.length;
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
function cr76Shell(P, live, push, rich) {
  const D = P.cr76;
  for (const f of D.faces) push(f.one || (f.one = Object.assign([{ p: f.p, n: f.n }], { stable: true })), f.tone, f.k, false, f.rgb, f.emis || 0);
  seat(P, push);
  if (rich) cr76Fit(P, live, push);
}

// ── THE READINGS ─────────────────────────────────────────────────────────────
const readings = (live) => {
  const L = live || {};
  return {
    L,
    pitch: num(L.pitch), bank: num(L.bank), hdg: num(L.hdg),
    ias: Math.max(0, num(L.ias)), vne: Math.max(40, num(L.vne, 115)),
    alt: Math.max(0, num(L.alt)), vsi: num(L.vsi),
    rpm: clamp(num(L.rpm), 0, 1.1), thr: clamp(num(L.throttle), 0, 1),
    fuel: clamp(num(L.fuel, 1), 0, 1), hull: clamp(num(L.hull, 1), 0, 1),
    oil: clamp(num(L.oilTemp, 0.4), 0, 1),
    powered: L.powered !== false,
    ail: clamp(num(L.stickX), -1, 1), elev: clamp(num(L.stickY), -1, 1), rud: clamp(num(L.rudder), -1, 1),
    trim: clamp(num(L.trim), -1, 1), flap: clamp(Math.round(num(L.flapNotch)), 0, 3),
    land: !!L.landingLight, dome: !!L.dome, hour: ((num(L.hour, 12) % 24) + 24) % 24,
    phase: num(L.phase), stall: !!L.stall,
  };
};
const night = (R) => R.hour < 6.5 || R.hour > 19.5;
const panelOn = (R) => R.powered && (R.L.panelLight != null ? !!R.L.panelLight : night(R));
// The biofuel twin's burn: about 17 litres an hour at full throttle and rpm, 2 at idle.
export const BURN_LPH = 17;
export const fuelFlow = (R) => (R.powered && R.rpm > 0.02 ? 2 + (BURN_LPH - 2) * clamp(R.thr * R.rpm, 0, 1) : 0);

// ── WHERE THE CONTROLS ARE ───────────────────────────────────────────────────
// One place says where each thing you can grab is; the drawing and the hotspots both read it. The
// stick stands between the knees, the throttle and the trim wheel are on the left console, as in the
// old tub.
const STICK = { base: [0, 0.3, 0.04], len: 0.38 };                  // z off the floor
const LEVER = { x: -0.22, pivotY: 0.08, top: 0.42, len: 0.15 };     // on the left console, z off the floor
const TRIMW = { x: -0.22, y: 0.32, z: 0.42, r: 0.042 };
function stickAt(P, R) {
  const base = [STICK.base[0], STICK.base[1], P.cr76.zF + STICK.base[2]];
  const dir = norm([R.ail * 0.3, -R.elev * 0.3 - 0.06, 1]);
  return { base, top: add(base, mul(dir, STICK.len)), dir };
}
function leverAt(P, R) {
  const pivot = [LEVER.x, LEVER.pivotY, P.cr76.zF + LEVER.top];
  const ang = -0.55 + R.thr * 1.1;
  const dir = [0, Math.sin(ang), Math.cos(ang)];
  return { pivot, end: add(pivot, mul(dir, LEVER.len)), dir, ang };
}

// ── THE DASH: a sculpted wing across the cabin, and on its face toward you one band of glass ──
const DASH = { xL: -0.25, xR: 0.25, yMid: 0.6, sag: 0.1, w: 0.25, z0: -0.37, h: 0.2, lean: 0.42 };
function dashCurve() {
  return (s) => {
    const x = lerp(DASH.xL, DASH.xR, s), q = x / DASH.w;
    const y = DASH.yMid - DASH.sag * q * q, dy = -2 * DASH.sag * q / DASH.w;
    return { p: [x, y, DASH.z0], f: norm([-dy, 1, 0]) };
  };
}
const sOf = (x) => (x - DASH.xL) / (DASH.xR - DASH.xL);
const bandPanel = (K, x, v, lift = 0.005) => bandFrame(dashCurve(), DASH.lean).at(K, sOf(x), v, lift);
const bandPt = (x, v, lift = 0.005) => bandFrame(dashCurve(), DASH.lean).P(sOf(x), v, lift);

// ── ⚠ EVERY CONTROL IN ONE FORWARD VIEW ──────────────────────────────────────
// The five switches the sim has for this seat (power, three lighting circuits and the flaps) are along
// the band's foot, the map beside them, so a forward look shows every one and its state. Four are
// glass keys; the dome's key died in the crash, and the Fly Baby's toggle is taped to the glass in its
// place. The stick, the throttle and the pedals sit low, so each is mirrored in the windscreen HUD, and
// the flap key carries its own four-notch gauge.
const BTN = { ids: ['master', 'land', 'panel', 'dome', 'flaps'], names: { master: 'PWR', land: 'LAND', panel: 'PANEL', dome: 'DOME', flaps: 'FLAP' } };
const KEY_V = 0.042, KEY_R = 0.02;
const BTN_X = [-0.1, -0.05, 0, 0.05, 0.1];
function switchOn(id, R) {
  if (id === 'master') return R.powered;
  if (id === 'land') return R.land;
  if (id === 'panel') return panelOn(R);
  if (id === 'dome') return R.dome && R.powered;
  if (id === 'flaps') return R.flap > 0;
  return R.powered;
}
// The pages on the band's upper row, the map at the left of its foot, the dead page and the lamps at
// its right.
const SCREENS = [
  { id: 'eng', x: -0.165, w: 0.07, boot: 0.3 },
  { id: 'pfd', x: 0, w: 0.074, boot: 0 },
  { id: 'fdr', x: 0.165, w: 0.07, boot: 0.45 },
];
const PAGE_V = 0.14, PAGE_H = 0.058;
const MAP = { x: -0.19, v: 0.042, hw: 0.046, hh: 0.03, boot: 0.15 };
const DEAD = { x: 0.158, v: 0.042, hw: 0.03, hh: 0.028 };
const LAMP = { x: 0.217, w: 0.056, h: 0.024, v: [0.058, 0.026] };
const screenPanel = (K, sc) => bandPanel(K, sc.x, PAGE_V, 0.012);

export function cr76Hotspots(P, live) {
  const R = readings(live), K = makeKit(() => {}), out = [];
  BTN.ids.forEach((id, i) => out.push({ id: 'ck:' + id, p: bandPanel(K, BTN_X[i], KEY_V).pt(0, 0, 0.01), r: KEY_R + 0.002, kind: 'click' }));
  out.push({ id: 'yoke', p: add(stickAt(P, R).top, [0, 0, 0.05]), r: 0.06, kind: 'yoke' });
  const lv = leverAt(P, R);
  out.push({ id: 'throttle', p: add(lv.end, mul(lv.dir, 0.03)), r: 0.045, kind: 'throttle' });
  out.push({ id: 'trim', p: [TRIMW.x, TRIMW.y, P.cr76.zF + TRIMW.z], r: 0.05, kind: 'trim' });
  out.push(gpsHotspot(bandPanel(K, MAP.x, MAP.v, 0.008), 0, 0, 0.042));
  return out;
}

// ── THE SEAT: a carbon shell, the cushion split and taped, one strap a cargo strap ──
function seat(P, push) {
  const K = makeKit(push, false);
  const zF = P.cr76.zF, hip = [0, -0.17, zF + 0.16];
  const lean = 24 * DEG, up = [0, -Math.sin(lean), Math.cos(lean)], fw = [0, Math.cos(lean), Math.sin(lean)];
  const hw = 0.19;
  // The pan: a carbon tray tilting up toward the knees, a cushion in it, foam out of a split.
  const panDir = norm([0, 1, 0.16]), panUp = norm(cross([1, 0, 0], panDir));
  const pc = add(hip, mul(panDir, 0.2));
  K.obox(add(pc, mul(panUp, -0.03)), [1, 0, 0], panDir, panUp, hw, 0.23, 0.025, 'seat', 0.0, T.carbon);
  K.obox(add(pc, mul(panUp, 0.004)), [1, 0, 0], panDir, panUp, hw - 0.04, 0.21, 0.012, 'seat', 0.05, T.leather);
  K.obox(add(add(pc, mul(panUp, 0.017)), [-0.04, -0.02, 0]), [1, 0, 0], panDir, panUp, 0.05, 0.06, 0.003, 'seat', 0.2, T.foam);
  K.obox(add(add(pc, mul(panUp, 0.019)), [-0.04, -0.02, 0]), [1, 0, 0], panDir, panUp, 0.065, 0.012, 0.002, 'seat', 0.2, T.tape);
  K.box(-0.1, hip[1] - 0.02, zF, 0.1, hip[1] + 0.3, hip[2] - 0.06, 'seat', -0.25, T.carbon);
  // The back and the headrest.
  const bL = 0.6, bc = add(hip, mul(up, bL / 2));
  K.obox(add(bc, mul(fw, -0.035)), [1, 0, 0], up, fw, hw, bL / 2, 0.03, 'seat', -0.06, T.carbon);
  K.obox(add(bc, mul(fw, 0.0)), [1, 0, 0], up, fw, hw - 0.05, bL / 2 - 0.04, 0.012, 'seat', 0.0, T.leather);
  for (const s of [-1, 1]) {
    K.obox(add(bc, [s * (hw - 0.025), 0, 0]), [1, 0, 0], up, fw, 0.025, bL / 2, 0.035, 'seat', 0.0, T.bolster);
    K.obox(add(add(bc, mul(fw, 0.036)), [s * (hw - 0.025), 0, 0]), [1, 0, 0], up, fw, 0.003, bL / 2 - 0.02, 0.002, 'seat', 0.2, T.glow, 0.5);
  }
  for (let r = 1; r < 6; r++) K.obox(add(add(hip, mul(up, r * bL / 6)), mul(fw, 0.013)), [1, 0, 0], up, fw, hw - 0.06, 0.003, 0.002, 'seat', -0.2, T.leatherDk);
  const hc = add(hip, mul(up, bL + 0.08));
  K.obox(add(hc, mul(fw, -0.03)), [1, 0, 0], up, fw, 0.11, 0.08, 0.04, 'seat', 0.0, T.carbon);
  K.obox(add(hc, mul(fw, 0.012)), [1, 0, 0], up, fw, 0.085, 0.06, 0.006, 'seat', 0.0, T.leather);
  K.obox(add(add(hip, mul(up, bL * 0.5)), mul(fw, 0.014)), [1, 0, 0], up, fw, hw - 0.06, 0.004, 0.002, 'seat', 0.2, T.teal, 0.3);
  // The harness: one shoulder strap the factory's, the other an orange cargo strap with its ratchet,
  // the lap belts, the crotch strap and a rotary buckle on the lap.
  const top = add(hip, mul(up, bL - 0.02)), buck = add(add(hip, mul(panDir, 0.16)), [0, 0, 0.1]);
  for (const s of [-1, 1]) {
    const strap = s < 0 ? T.harness : T.cargo;
    K.rod(add(add(top, mul(fw, 0.03)), [s * 0.055, 0, 0]), add(buck, [s * 0.025, 0, 0.02]), 0.011, 'seat', 0.05, strap, 0, 4);
    K.rod(add(add(hip, mul(panDir, 0.06)), [s * (hw - 0.03), 0, 0.04]), add(buck, [s * 0.025, 0, -0.01]), 0.011, 'seat', 0.05, T.harness, 0, 4);
  }
  { const r = add(add(top, mul(fw, 0.04)), [0.05, 0, -0.18]); K.obox(r, [1, 0, 0], up, fw, 0.02, 0.03, 0.01, 'seat', 0.3, T.metal); }
  K.rod(add(hip, mul(panDir, 0.3)), add(buck, [0, 0, -0.015]), 0.009, 'seat', 0.05, T.harness, 0, 4);
  K.rod(add(buck, [0, -0.008, 0]), add(buck, [0, 0.01, 0]), 0.03, 'seat', 0.3, T.buckle, 0, 12);
  K.rod(add(buck, [0, 0.01, 0]), add(buck, [0, 0.013, 0]), 0.011, 'seat', 0.3, T.teal, 0.4, 8);
  contactShadow(K, [0, hip[1] + 0.15, zF + 0.001], [1, 0, 0], [0, 1, 0], [0, 0, 1], hw + 0.03, 0.2);
}

// ── THE FIT-OUT ──────────────────────────────────────────────────────────────
export function cr76Fit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live);
  const G = P.cr76, zF = G.zF;
  const lit = R.powered, panel = panelOn(R);
  const boot = bootAge(live), now = decoSec();
  // The cabin's light lines carry the alert: teal, amber on low fuel or a hot engine, red and
  // breathing on a hull or stall warning.
  const warn = lit && (R.hull < 0.3 || R.stall), caution = lit && (R.fuel < 0.15 || R.oil > 0.85);
  const al = alertLight(caution, warn, T.line), lineK = (k) => (lit ? k * al.k : 0.05);

  // ── THE DASH: a wing swept along the band's curve, held inside the fuselage ──
  const curve = dashCurve();
  const gt = [DASH.h * DASH.lean / Math.hypot(1, DASH.lean), DASH.h / Math.hypot(1, DASH.lean)];
  const SEC = [[0, 0], gt, [0.1, gt[1] + 0.02], [0.17, gt[1] + 0.008], [0.2, gt[1] - 0.03], [0.17, -0.05], [0.08, -0.1], [-0.04, -0.08], [-0.05, -0.035], [0, 0]];
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
  // The lip's light runs only two thirds of the way: the right end of the strip died in the crash.
  lightLine(K, rings.slice(2, 17).map((r) => add(r[3], [0, 0, 0.002])), 0.002, al.rgb, lineK(0.35));
  // Gaffer over a split in the dash's top, and an alloy patch riveted over the right end of it.
  { const a = rings[19], b = rings[21];
    K.face([add(a[2], [0, 0, 0.003]), add(b[2], [0, 0, 0.003]), add(b[4], [0, 0, 0.003]), add(a[4], [0, 0, 0.003])], norm([0, -0.3, 0.95]), 'dash', 0.1, T.gaffer);
    const c = rings[23], d = rings[25];
    K.face([add(c[2], [0, 0, 0.003]), add(d[2], [0, 0, 0.003]), add(d[3], [0, 0, 0.003]), add(c[3], [0, 0, 0.003])], norm([0, -0.3, 0.95]), 'dash', 0.2, T.alu);
    for (const q of [c[2], d[2], c[3], d[3]]) K.rod(add(q, [0, 0, 0.003]), add(q, [0, 0, 0.006]), 0.0035, 'dash', 0.3, T.metal, 0, 6); }
  // The strut the dash hangs off, down to the floor between the pedals, and the loom that came loose
  // under it, swinging with the engine's shake.
  { const c = curve(0.5), top = add(add(c.p, mul(c.f, 0.12)), [0, 0, -0.1]); K.rod(top, [0, top[1] + 0.02, zF + 0.03], 0.018, 'dash', 0.1, T.carbon, 0, 8);
    const sway = R.rpm * 0.008;
    for (const [dx, rgb, dz] of [[-0.06, [180, 40, 32], 0.12], [-0.04, [210, 180, 40], 0.16], [-0.02, [30, 30, 34], 0.1], [0.04, T.wire, 0.14]]) {
      const s0 = [dx, c.p[1] + 0.02, DASH.z0 - 0.06], s1 = [dx + sway, s0[1] - 0.04, s0[2] - dz * 0.5], s2 = [dx * 1.4 + sway * 2, s0[1] - 0.06, s0[2] - dz];
      K.rod(s0, s1, 0.0026, 'dash', 0, rgb, 0, 4); K.rod(s1, s2, 0.0026, 'dash', 0, rgb, 0, 4);
    } }

  // ── THE BAND: one sheet of glass, cracked, the pages on it booting in turn when the power comes on ──
  glassBand(K, curve, { h: DASH.h, lean: DASH.lean, segs: 26, lit, light: al.rgb, lightK: lineK(1), substrate: T.screen });
  // The crack: from a star at the band's right end, across the dead page and into the recorder's page,
  // with a strip of tape across it. It is in the cover glass; the pages under it still read.
  {
    const star = [0.2, 0.072], arms = [[0.12, 0.15], [0.12, 0.068], [0.235, 0.17], [0.245, 0.02], [0.17, 0.008], [0.205, 0.13]];
    for (const [x, v] of arms) {
      const mid = [(star[0] + x) / 2 + (v - star[1]) * 0.08, (star[1] + v) / 2 - (x - star[0]) * 0.08];
      K.rod(bandPt(star[0], star[1], 0.016), bandPt(mid[0], mid[1], 0.016), 0.0011, 'dash', 0.3, T.crack, 0.25, 3, false);
      K.rod(bandPt(mid[0], mid[1], 0.016), bandPt(x, v, 0.016), 0.0009, 'dash', 0.3, T.crack, 0.2, 3, false);
    }
    const Tp = bandPanel(K, 0.2, 0.072, 0.017);
    Tp.rect(-0.045, -0.008, 0.045, 0.008, T.tape, 0.05, 0.001);
  }
  // A page flickers: the engine page's driver is loose, so on the wall clock it drops out for a frame
  // and tears. Decoration: what it shows when it is up is the live engine.
  const tick = Math.floor(now * 12), flick = noise(tick) < 0.1 ? 0.25 : 1, tear = noise(tick + 0.5);
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
    else if (sc.id === 'eng') {
      engPage(Pn, R, flick);
      if (flick < 1) Pn.rect(-sc.w, lerp(-PAGE_H, PAGE_H, tear) - 0.003, sc.w, lerp(-PAGE_H, PAGE_H, tear) + 0.003, T.glow, 0.6, 0.0042);
    } else if (sc.id === 'fdr') fdrPage(Pn, R, now);
  }
  // The map, at the left of the band's foot: the one page you click.
  {
    const Pn = bandPanel(K, MAP.x, MAP.v, 0.008), up = reveal(boot, MAP.boot);
    if (lit && up >= 1) {
      panelGps(Pn, 0, 0, MAP.hw, MAP.hh, live, { label: false, bezel: [8, 14, 16] });
      const g = live && live.gpsTo;
      if (g && Number.isFinite(g.dist)) Pn.digits(0.01, -0.025, 0.011, String(Math.min(999, Math.round(g.dist))).padStart(3, ' '), T.glow, false);
    } else if (lit && up > 0) Pn.rect(-MAP.hw, -MAP.hh, MAP.hw, lerp(-MAP.hh, MAP.hh, up), T.screen, 0.3, 0.001);
  }
  // The dead page: black glass under the crack. Now and then its driver wakes and throws a line of
  // static across it and dies again. Decoration only; it reads nothing.
  {
    const Pn = bandPanel(K, DEAD.x, DEAD.v, 0.008);
    Pn.rect(-DEAD.hw, -DEAD.hh, DEAD.hw, DEAD.hh, T.dead, 0, 0.001);
    Pn.rect(-DEAD.hw, -DEAD.hh, -DEAD.hw + 0.002, DEAD.hh, [40, 40, 44], 0.1, 0.0015);
    if (lit) {
      const st = Math.floor(now * 7);
      if (noise(st * 1.7) < 0.22) for (let k = 0; k < 3; k++) {
        const v = lerp(-DEAD.hh, DEAD.hh, noise(st + k * 0.31)), w = 0.01 + 0.04 * noise(st + k * 0.77);
        const u = lerp(-DEAD.hw + w / 2, DEAD.hw - w / 2, noise(st + k * 0.13));
        Pn.rect(u - w / 2, v - 0.0012, u + w / 2, v + 0.0012, k ? T.glowDim : T.glow, 0.6, 0.002);
      }
      // A stuck column of pixels down its left, lit whenever the bus is.
      Pn.rect(-DEAD.hw + 0.006, -DEAD.hh, -DEAD.hw + 0.0075, DEAD.hh, [120, 60, 140], 0.5, 0.0018);
    }
  }
  // The status lamps at the right of the foot. ⚠ PILOT is the Rider's lamp: lit whenever the seat is
  // powered and occupied, which is whenever this cockpit is drawn.
  {
    const on = lit && reveal(boot, 0.6) >= 1;
    lensLamp(bandPanel(K, LAMP.x, LAMP.v[0], 0.01), 0, 0, LAMP.w, LAMP.h, on, C.green, 'PILOT');
    lensLamp(bandPanel(K, LAMP.x, LAMP.v[1], 0.01), 0, 0, LAMP.w, LAMP.h, on, T.amber, 'ADVISE');
  }

  // ── THE KEYS: four glass keys along the band's foot, and the Fly Baby's toggle for the dome ──
  // A key sinks while pressed and comes back, its light eases with the circuit, it brightens as the
  // hand comes over it, and a ring flashes round it when its state changes.
  BTN.ids.forEach((id, i) => {
    const Kp = bandPanel(K, BTN_X[i], KEY_V, 0.004), on = switchOn(id, R);
    const pressed = !!live && live.press === 'ck:' + id, near = !!live && live.hover === 'ck:' + id;
    const hand = eased('cr76:near:' + id, near ? 1 : 0, 14);
    const r = KEY_R;
    if (id === 'dome') {
      // The old toggle: a steel bat in a hex bushing on a scrap of alloy, gaffer-taped to the glass, its
      // name on masking tape in marker. It throws up for on and down for off, and dips when pressed.
      const throwOn = eased('cr76:dome', on ? 1 : 0, 18) - pressPulse('cr76:dome', on) * 0.3;
      Kp.rect(-0.017, -0.019, 0.017, 0.019, T.alu, 0.05, 0.002);
      Kp.rect(-0.022, 0.006, 0.022, 0.012, T.gaffer, 0, 0.003);
      Kp.rect(-0.022, -0.014, 0.022, -0.008, T.gaffer, 0, 0.003);
      Kp.disc(0, 0, 0.0075, T.metal, 0.05, 0.004, 6);
      const tipP = Kp.pt(0, (throwOn * 2 - 1) * 0.011, 0.022 + (pressed ? -0.003 : 0)), baseP = Kp.pt(0, 0, 0.005);
      K.rod(baseP, tipP, 0.0028, 'dash', 0.4, T.metal, 0, 6);
      K.rod(tipP, add(tipP, mul(norm(sub(tipP, baseP)), 0.004)), 0.0042, 'dash', 0.4, T.metal, 0, 8);
      Kp.annulus(0, 0, r - 0.001, r + 0.001, T.glow, (lit ? 0.15 : 0) + hand * 0.8, 0.0026, 20);
      Kp.fitText('DOME', 0, 0.026, 0.04, 0.0105, [26, 24, 24], 0, 0.004);
      Kp.rect(-0.021, 0.0205, 0.021, 0.0315, [214, 206, 180], 0.05, 0.0035);
      const flash = pressPulse('cr76:key:dome', on);
      if (flash > 0.02) Kp.annulus(0, 0, r + 0.004, r + 0.008, HALO, flash, 0.004, 18);
      return;
    }
    const rgb = id === 'master' ? C.green : T.glow;
    const glow = eased('cr76:glow:' + id, on && (id !== 'flaps' || lit) ? 1 : 0, 10), depth = eased('cr76:dip:' + id, pressed ? 0.002 : 0.007, 30);
    Kp.rect(-r - 0.002, -r - 0.002, r + 0.002, r + 0.002, T.tub, 0, 0.0005);
    Kp.annulus(0, 0, r - 0.001, r + 0.001, T.glow, (lit ? 0.25 : 0) + hand * 0.75, 0.0012, 20);
    Kp.stud(0, 0, r - 0.003, r - 0.003, depth, rgb.map((c, k) => lerp([40, 46, 50][k], c, glow * 0.8)), glow * 0.85 + hand * 0.15, 0.0015);
    Kp.fitText(BTN.names[id], 0, id === 'flaps' ? 0.002 : -0.004, 0.036, 0.011, glow > 0.5 ? [10, 24, 22] : [214, 222, 220], glow > 0.5 ? 0 : (panel ? 0.6 : 0.25), depth + 0.0025);
    if (id === 'flaps') for (let k = 0; k < 4; k++) {
      const u = -0.0125 + k * 0.0083, here = lit && k <= R.flap;
      Kp.rect(u - 0.003, -0.015, u + 0.003, -0.0105, here ? (k === R.flap ? T.white : T.glow) : [50, 60, 60], here ? 1 : 0.2, depth + 0.003);
    }
    const flash = pressPulse('cr76:key:' + id, id === 'flaps' ? R.flap : on);
    if (flash > 0.02) Kp.annulus(0, 0, r + 0.004, r + 0.008, HALO, flash, 0.004, 18);
  });

  // ── THE WINDSCREEN HUD: projected, conformal, the hands and feet mirrored in its corners ──
  if (lit) windscreenHud(K, R, { dist: 0.4, z: 0.004, hw: 0.13, hh: 0.052, warn, caution, boot: reveal(boot, 0.2),
    mirrors: { stick: [R.ail, R.elev], thrs: [R.thr], rud: R.rud } });

  // ── THE HOLOGRAM on the dash's shelf: the Carcass herself, glitching, flying as she flies ──
  // Pitched and banked with her, the propeller turning on the prop phase and ringed at its speed, the
  // donor's wing panel picked out in amber and the port winglet missing, on a projector whose arc is
  // the fuel. The projector's lens is cracked, so on the wall clock she jumps and ghosts.
  {
    const c0 = curve(0.5), base = clampIn(G, add(add(c0.p, mul(c0.f, 0.07)), [0, 0, gt[1] + 0.014]), 0.03);
    holoProjector(K, base, 0.03, 0.04, lit ? R.fuel : 0, R.fuel < 0.15 ? HOLO_RED : R.fuel < 0.3 ? HOLO_AMBER : HOLO_LINE);
    { const Sp = K.panel(add(base, [0, 0, 0.0025]), [1, 0, 0], [0, 1, 0], 'dash', 0.3);
      Sp.spoke(0, 0, 0.6, 0.004, 0.022, 0.0005, T.crack, 0.4, 0); Sp.spoke(0, 0, 2.4, 0.004, 0.018, 0.0005, T.crack, 0.4, 0); }
    if (lit && reveal(boot, 0.7) > 0) {
      const gl = Math.floor(now * 9), glitch = noise(gl * 2.3) < 0.12;
      const jit = glitch ? (noise(gl) - 0.5) * 0.008 : 0;
      const at = add(base, [jit, 0, 0.042]);
      holoCarcass(K, at, R, glitch ? 0.6 : 1, null);
      if (glitch) holoCarcass(K, add(at, [0.005, 0, 0.002]), R, 0.3, HOLO_GHOST);
    }
  }

  // ── THE LEFT CONSOLE: the throttle in its gate and the trim wheel, along the wall ──
  {
    const crings = [];
    for (let i = 0; i <= 8; i++) {
      const y = lerp(-0.14, 0.46, i / 8), sec = [];
      for (let j = 0; j <= 8; j++) {
        const a = Math.PI * j / 8, x = LEVER.x - Math.cos(a) * 0.06, z = zF + LEVER.top - (1 - Math.sin(a)) * 0.05;
        sec.push(clampIn(G, [x, y, j === 0 || j === 8 ? zF + LEVER.top - 0.16 : z], 0.006));
      }
      crings.push(sec);
    }
    sweep(K, crings, 'dash', 0.1, T.carbon);
    K.face(crings[8].slice(), [0, 1, 0], 'dash', 0.05, T.carbonLt);
    lightLine(K, crings.map((r) => add(r[7], [0, 0, 0.004])), 0.0022, al.rgb, lineK(0.85));
    // The right console: a shelf the same shape, with the fuel shutoff's empty socket under tape.
    const rrings = crings.map((sec) => sec.map((q) => clampIn(G, [-q[0], q[1], q[2]], 0.006)).reverse());
    sweep(K, rrings, 'dash', 0.1, T.carbon);
    K.face(rrings[8].slice(), [0, 1, 0], 'dash', 0.05, T.carbonLt);
    lightLine(K, rrings.slice(0, 6).map((r) => add(r[1], [0, 0, 0.004])), 0.0022, al.rgb, lineK(0.85));
    const ct = zF + LEVER.top;
    K.box(0.2, 0.06, ct - 0.002, 0.25, 0.14, ct + 0.003, 'dash', 0.1, T.tape);
    K.rod([0.225, 0.1, ct + 0.003], [0.225, 0.1, ct + 0.006], 0.008, 'dash', 0.1, T.dead, 0, 10);
  }
  const lv = leverAt(P, R), lvNear = eased('cr76:near:throttle', live && (live.hover === 'throttle' || live.press === 'throttle') ? 1 : 0, 12);
  const ct = zF + LEVER.top;
  K.box(LEVER.x - 0.01, LEVER.pivotY - 0.15, ct - 0.004, LEVER.x + 0.01, LEVER.pivotY + 0.15, ct + 0.006, 'dash', -0.3, T.tub);
  for (let i = 0; i <= 4; i++) {
    const y = LEVER.pivotY - 0.13 + i * 0.065, here = lit && Math.abs(i / 4 - R.thr) < 0.13;
    K.box(LEVER.x + 0.014, y - 0.002, ct + 0.003, LEVER.x + 0.028, y + 0.002, ct + 0.007, 'dash', 0.2, here ? T.glow : T.glowDim, here ? 1 : 0.5);
  }
  K.rod(lv.pivot, lv.end, 0.009, 'dash', 0.2, T.metal, 0, 8);
  const gripEnd = add(lv.end, mul(lv.dir, 0.055));
  // The grip is the old tub's brass doorknob, kept: the 2076 lever's own knob is in the field.
  K.rod(lv.end, gripEnd, 0.008, 'dash', 0.2, T.metal, 0, 8);
  K.rod(gripEnd, add(gripEnd, mul(lv.dir, 0.012)), 0.022, 'dash', 0.3, [182, 146, 74], 0, 12);
  K.rod(add(gripEnd, mul(lv.dir, 0.012)), add(gripEnd, mul(lv.dir, 0.018)), 0.012, 'dash', 0.3, [182, 146, 74], 0, 10);
  K.torus(add(gripEnd, mul(lv.dir, 0.006)), [1, 0, 0], [0, 1, 0], 0.024, 0.002, 18, 'dash', 0.2, al.rgb, lit ? 0.3 + R.thr * 0.4 + lvNear * 0.3 : 0);
  // The trim wheel: a knurled disc standing in a slot, its index line turning with the trim.
  {
    const tc = [TRIMW.x, TRIMW.y, zF + TRIMW.z], tNear = eased('cr76:near:trim', live && (live.hover === 'trim' || live.press === 'trim') ? 1 : 0, 12);
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

  // ── THE STICK between the knees: the factory's grip on a length of the old tub's scaffold pipe ──
  const st = stickAt(P, R), stNear = eased('cr76:near:yoke', live && (live.hover === 'yoke' || live.press === 'yoke') ? 1 : 0, 12);
  {
    const b = st.base;
    K.rod(add(b, [0, 0, -0.02]), add(b, [0, 0, 0.012]), 0.05, 'dash', 0.1, T.tub, 0, 16);
    K.torus(add(b, [0, 0, 0.012]), [1, 0, 0], [0, 1, 0], 0.05, 0.004, 18, 'dash', 0.2, al.rgb, lit ? 0.5 + 0.5 * stNear : 0);
    K.rod(add(b, [0, 0, 0.012]), add(b, mul(st.dir, 0.06)), 0.028, 'dash', -0.1, T.tub, 0, 10);
    K.rod(add(b, mul(st.dir, 0.05)), st.top, 0.012, 'dash', 0.2, [128, 132, 136], 0, 8);
    // The hose clamp where the pipe meets the grip's stub.
    K.rod(add(st.top, mul(st.dir, -0.02)), add(st.top, mul(st.dir, -0.005)), 0.016, 'dash', 0.3, T.metal, 0, 8);
    const gTop = add(st.top, mul(st.dir, 0.1));
    K.rod(st.top, gTop, 0.02, 'dash', 0.05, T.carbon, 0, 12);
    K.rod(add(gTop, mul(st.dir, -0.004)), add(gTop, mul(st.dir, 0.008)), 0.015, 'dash', 0.2, T.carbonLt, 0, 12);
    K.obox(add(gTop, mul(st.dir, 0.009)), [1, 0, 0], [0, 1, 0], st.dir, 0.006, 0.006, 0.002, 'dash', 0.3, al.rgb, lit ? 0.5 + 0.5 * stNear : 0);
    contactShadow(K, [b[0], b[1], zF], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.06, 0.06);
  }

  // ── THE PEDALS: two plates on rails in the footwell, one forward as the other comes back ──
  const py = 0.98, pz = zF + 0.12;
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
  // A strap off a sandal still round the left pedal: the old tub's rudder bar had two.
  K.obox([-0.075, py - 0.02, pz + 0.04], [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.042, 0.012, 0.006, 'dash', 0, [98, 64, 40]);

  // ── THE OLD TUB'S INSTRUMENTS, KEPT ──
  // The pine-tree air freshener, on a suction cup up the left of the bubble: it swings with the turn
  // and the pitch, and it is the plumb bob. The spirit level cable-tied under the band's foot: its
  // bubble runs with the slip (bank and rudder), uphill, the wrong way round, as it always did.
  {
    const cup = G.toShell(cr76Point(0.16, 118, -(G.inset + 0.022 / G.m)));
    K.rod(add(cup, [0.004, -0.004, -0.004]), cup, 0.009, 'pil', 0.3, [200, 210, 214], 0.1, 10);
    const hang = add(cup, [0.006, -0.006, -0.008]);
    const sw = clamp(R.bank / 50, -0.9, 0.9), pw = clamp(-R.pitch / 40, -0.6, 0.6);
    const bob = add(hang, [Math.sin(sw) * 0.07, Math.sin(pw) * 0.03, -Math.cos(sw) * 0.07]);
    K.rod(hang, bob, 0.0009, 'pil', 0, T.wire, 0, 3);
    const d = norm(sub(bob, hang)), r = norm(cross(d, [0, 1, 0])), n0 = norm(cross(r, d));
    const nn = dot(n0, bob) > 0 ? mul(n0, -1) : n0;
    const Tq = (u, v) => add(bob, add(mul(r, u), mul(d, v)));
    K.face([Tq(0, 0), Tq(0.018, 0.022), Tq(0.008, 0.02), Tq(0.022, 0.045), Tq(-0.022, 0.045), Tq(-0.008, 0.02), Tq(-0.018, 0.022)], nn, 'pil', 0, T.leaf, 0.1);
    const lvl = bandPt(0, -0.016, 0.02);
    K.box(lvl[0] - 0.07, lvl[1] - 0.011, lvl[2] - 0.01, lvl[0] + 0.07, lvl[1] + 0.011, lvl[2] + 0.01, 'dash', 0.2, C.yellow);
    const slip = clamp(-R.bank / 45 + R.rud * 0.3, -1, 1);
    K.box(lvl[0] - 0.03, lvl[1] - 0.0125, lvl[2] - 0.005, lvl[0] + 0.03, lvl[1] - 0.011, lvl[2] + 0.005, 'dash', 0.2, [170, 220, 90], 0.25);
    K.box(lvl[0] + slip * 0.024 - 0.005, lvl[1] - 0.0135, lvl[2] - 0.004, lvl[0] + slip * 0.024 + 0.005, lvl[1] - 0.0125, lvl[2] + 0.004, 'dash', 0.3, T.wire, 0.3);
    for (const dx of [-0.05, 0.05]) K.rod([lvl[0] + dx, lvl[1] - 0.002, lvl[2] + 0.011], [lvl[0] + dx, lvl[1] + 0.012, lvl[2] + 0.03], 0.0025, 'dash', 0.1, [30, 30, 34], 0, 4);
  }

  // ── OVERHEAD: a dome lamp in the hoop, over your head and behind ──
  {
    const hf = CR76_FRAMES.hoop + 0.006, dome = G.toShell(cr76Point(hf, 90, -(G.inset + 0.04 / G.m)));
    K.rod(add(dome, [0, 0.02, 0]), add(dome, [0, -0.02, 0]), 0.03, 'hdr', 0.1, R.dome && lit ? [240, 252, 248] : [80, 84, 84], R.dome && lit ? 1 : 0, 14);
  }

  hotspotHalo(K, cr76Hotspots(P, live), live);
}

// ── THE HOLOGRAM: the Carcass in miniature, a hand's width across ──
// Her fuselage as section rings and a keel line, the bubble, the wing with the donor's panel in amber
// and the port winglet missing, the tail, and the propeller turning on the prop phase, ringed in its
// speed colour. `ghost` draws the glitch's second copy in one colour.
// She is presented three-quarter on and tilted toward the seat (HOLO_YAW, HOLO_TILT), so her top and
// her donor wing read from the eye; she still pitches and banks with the aircraft about that.
const HOLO_TILT = -22, HOLO_YAW = 32;
function holoCarcass(K, c, R, k, ghost) {
  const H = holoFrame(K, c, R.pitch + HOLO_TILT, R.bank, HOLO_YAW);
  const sc = 0.075;                                       // metres a model unit
  const P = (f, g, h) => [g * sc, f * sc, (h - 0.03) * sc];
  const line = (a, b, w = 0.0006, rgb = HOLO_LINE) => H.line(a, b, w, ghost || rgb, k);
  const on = R.powered && R.rpm > 0.02, frac = clamp(R.rpm / 1.05, 0, 1);
  // The fuselage: six section rings, and the crown, keel and waist lines.
  for (const f of [0.95, 0.6, 0.3, 0.0, -0.4, -0.8]) {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const q = cr76Point(f, i * 30); pts.push(P(q[0], q[1], q[2])); }
    for (let i = 0; i < 12; i++) line(pts[i], pts[i + 1]);
  }
  for (const a of [90, -90, 0, 180]) {
    const pts = CR76_STATIONS.filter((_, i) => i % 2 === 0).map((s) => { const q = cr76Point(s.f, a); return P(q[0], q[1], q[2]); });
    for (let i = 0; i + 1 < pts.length; i++) line(pts[i], pts[i + 1]);
  }
  // The bubble, a lit outline over the seat.
  { const Bb = CR76_GLASS.bubble; const pts = [];
    for (let i = 0; i <= 8; i++) { const q = cr76Point(lerp(Bb.f[0], Bb.f[1], i / 8), 90); pts.push(P(q[0], q[1], q[2])); }
    for (let i = 0; i < 8; i++) line(pts[i], pts[i + 1], 0.0008); }
  // The wing: leading and trailing edges out to the tips, a plate each side, the donor's outer panel
  // on the left in amber; the starboard winglet, and none on the port tip.
  const W = [CR76_WING.root, CR76_WING.splice, CR76_WING.tip];
  for (const s of [1, -1]) {
    for (let i = 0; i + 1 < W.length; i++) {
      const A = W[i], B = W[i + 1];
      line(P(A.le, s * A.g, A.h), P(B.le, s * B.g, B.h), 0.0008);
      line(P(A.te, s * A.g, A.h), P(B.te, s * B.g, B.h), 0.0008);
      const donor = s < 0 && i === 1;
      H.plate([P(A.le, s * A.g, A.h), P(B.le, s * B.g, B.h), P(B.te, s * B.g, B.h), P(A.te, s * A.g, A.h)], ghost || (donor ? HOLO_DONOR : HOLO), (donor ? 0.8 : 0.5) * k);
    }
    const t = W[2];
    line(P(t.le, s * t.g, t.h), P(t.te, s * t.g, t.h), 0.0008);
  }
  { const t = W[2]; H.plate([P(t.le, t.g, t.h), P(t.le - 0.13, t.g, t.h + 0.105), P(t.te + 0.06, t.g, t.h + 0.1), P(t.te, t.g, t.h)], ghost || HOLO, 0.6 * k); }
  // The tail: the tailplane and the fin, the spare rudder in the same amber as the donor's panel.
  for (const s of [1, -1]) H.plate([P(-0.82, 0, 0.078), P(-0.92, s * 0.44, 0.084), P(-1.035, s * 0.44, 0.084), P(-1.045, 0, 0.078)], ghost || HOLO, 0.5 * k);
  H.plate([P(-0.78, 0, 0.08), P(-0.94, 0, 0.3), P(-1.0, 0, 0.355), P(-1.0, 0, 0.08)], ghost || HOLO, 0.5 * k);
  H.plate([P(-1.0, 0, 0.08), P(-1.0, 0, 0.355), P(-1.105, 0, 0.355), P(-1.075, 0, 0.08)], ghost || HOLO_DONOR, 0.6 * k);
  // The recorder, a lit box in the tail cone: still recording, so it pulses in the projector's colour.
  H.ring(P(-0.73, 0.02, 0.05), [1, 0, 0], [0, 0, 1], 0.03 * sc, 8, ghost || HOLO_AMBER, k);
  // The propeller: three blades turning on the prop phase, the disc ringed at its speed.
  const hub = P(1.064, 0, 0.02), pr = 0.29 * sc;
  H.ring(hub, [1, 0, 0], [0, 0, 1], pr, 18, ghost || (frac > 0.85 ? HOLO_LINE : HOLO_AMBER), (on ? 1 : 0.3) * k);
  for (let b = 0; b < 3; b++) {
    const t = (on ? R.phase * 2.2 : 0) + b * TAU / 3;
    line(hub, add(hub, [Math.cos(t) * pr * 0.95, 0, Math.sin(t) * pr * 0.95]), 0.0011);
  }
  void HOLO_RED;
}

// ── THE FLIGHT PAGE: attitude, speed and height, heading, climb, trim ──
function pfd(Pn, R) {
  Pn.attitude(0, -0.004, 0.038, R.pitch, R.bank);
  const box = (u, v, s, unit, digitsN) => {
    Pn.rect(u - 0.022, v - 0.012, u + 0.022, v + 0.012, [10, 18, 20], 0.3, 0.002);
    Pn.digits(u - 0.019, v - 0.007, 0.013, String(Math.round(s)).padStart(digitsN, ' ').slice(-digitsN), T.white, false);
    Pn.text(unit, u, v - 0.026, 0.011, T.dim, 0.5, 0.003);
  };
  box(-0.051, 0.0, R.ias, 'KT', 3);
  box(0.051, 0.0, R.alt, 'FT', 4);
  const sp = clamp(R.ias / R.vne, 0, 1);
  Pn.rect(-0.071, -0.045, -0.068, 0.045, [24, 34, 34], 0.3, 0.002);
  Pn.rect(-0.0715, -0.045, -0.0675, -0.045 + 0.09 * sp, sp > 0.9 ? T.red : sp > 0.75 ? T.amber : T.glow, 0.9, 0.003);
  const vs = clamp(R.vsi / 1000, -1, 1);
  Pn.rect(0.068, -0.045, 0.071, 0.045, [24, 34, 34], 0.3, 0.002);
  if (Math.abs(vs) > 0.01) Pn.rect(0.0675, Math.min(0, vs * 0.045), 0.0715, Math.max(0, vs * 0.045), vs > 0 ? C.green : T.amber, 0.9, 0.003);
  Pn.rect(-0.016, 0.036, 0.016, 0.052, T.screen, 0.2, 0.0035);
  Pn.digits(-0.013, 0.039, 0.011, String(Math.round(((R.hdg % 360) + 360) % 360)).padStart(3, '0'), T.glow, false);
  Pn.rect(-0.03, -0.052, 0.03, -0.05, [40, 60, 60], 0.3, 0.003);
  Pn.rect(R.trim * 0.028 - 0.002, -0.056, R.trim * 0.028 + 0.002, -0.046, T.glow, 0.9, 0.004);
  if (R.stall) Pn.rect(-0.07, -0.058, 0.07, -0.054, T.red, 1, 0.004);
}

// ── THE ENGINE PAGE: the biofuel twin's rpm, oil, fuel and burn ──
// `k` is the flicker: the whole page dims with it, and comes back.
function engPage(Pn, R, k) {
  const e = (x) => x * k;
  Pn.text('ENG', -0.05, 0.044, 0.011, T.dim, e(0.5), 0.003);
  Pn.text('BIO', 0.046, 0.044, 0.011, T.bio, e(0.6), 0.003);
  // The rpm as an arc, the redline at the top, the reading in the middle of it.
  const rc = [-0.03, 0.006], rr = 0.028, f = clamp(R.rpm / 1.1, 0, 1);
  Pn.annulus(rc[0], rc[1], rr - 0.003, rr, [40, 60, 60], e(0.3), 0.002, 20, Math.PI * 1.25, Math.PI * 1.25 - Math.PI * 1.5);
  if (f > 0.01) Pn.annulus(rc[0], rc[1], rr - 0.003, rr, R.rpm > 1.0 ? T.red : T.glow, e(0.95), 0.003, Math.max(2, Math.round(20 * f)), Math.PI * 1.25, Math.PI * 1.25 - Math.PI * 1.5 * f);
  Pn.spoke(rc[0], rc[1], Math.PI * 1.25 - Math.PI * 1.5 * (1 / 1.1) * 1.0, rr - 0.004, rr + 0.003, 0.0012, T.red, e(0.8), 0.0032);
  Pn.digits(rc[0] - 0.013, rc[1] - 0.006, 0.012, String(Math.round(R.rpm * 100)).padStart(3, ' '), T.white, false);
  Pn.text('RPM', rc[0], -0.031, 0.01, T.dim, e(0.5), 0.003);
  // Oil temperature and fuel as bars down the right, the fuel in the biofuel's amber.
  const bar = (u, v0, v1, fr, rgb) => {
    Pn.rect(u - 0.0045, v0, u + 0.0045, v1, [24, 34, 34], e(0.3), 0.002);
    if (fr > 0.01) Pn.rect(u - 0.0035, v0 + 0.0008, u + 0.0035, v0 + 0.0008 + (v1 - v0 - 0.0016) * clamp(fr, 0, 1), rgb, e(0.95), 0.003);
  };
  bar(0.026, -0.03, 0.034, R.oil, R.oil > 0.85 ? T.red : R.oil > 0.7 ? T.amber : T.glow);
  Pn.fitText('OIL', 0.026, -0.04, 0.022, 0.0085, T.dim, e(0.5), 0.003);
  bar(0.054, -0.03, 0.034, R.fuel, R.fuel < 0.15 ? T.red : R.fuel < 0.3 ? T.amber : T.bio);
  Pn.fitText('FUEL', 0.054, -0.04, 0.024, 0.0085, T.dim, e(0.5), 0.003);
  // The burn, litres an hour, off the throttle and the rpm.
  Pn.fitText('L/H', -0.054, -0.049, 0.024, 0.0085, T.dim, e(0.5), 0.003);
  Pn.digits(-0.036, -0.054, 0.011, String(Math.round(fuelFlow(R))).padStart(2, ' '), T.white, false);
}

// ── THE RECORDER'S PAGE: what the flight recorder in the tail is writing, as it writes it ──
// The orange box survived the crash; its page reads its channels out: height, speed, heading, climb,
// pitch and bank on the left; engine, throttle, fuel and hull on the right; the three controls as
// bars along the foot. A REC dot blinks on the wall clock while it has power.
function fdrPage(Pn, R, now) {
  Pn.text('FDR', -0.046, 0.044, 0.011, T.orange, 0.7, 0.003);
  if (Math.floor(now * 1.5) % 2 === 0) Pn.disc(-0.022, 0.046, 0.0035, T.red, 1, 0.0035, 10);
  Pn.text('REC', 0.0, 0.044, 0.011, T.dim, 0.5, 0.003);
  const row = (u, v, name, val, n, rgb = T.white) => {
    Pn.fitText(name, u + 0.016, v + 0.0045, 0.026, 0.0085, T.dim, 0.5, 0.003);
    Pn.digits(u + 0.032, v, 0.0095, String(val).padStart(n, ' ').slice(-n), rgb, false);
  };
  const L = [['ALT', Math.round(R.alt), 5], ['IAS', Math.round(R.ias), 3], ['HDG', String(Math.round(((R.hdg % 360) + 360) % 360)).padStart(3, '0'), 3],
    ['VS', Math.round(R.vsi / 10) * 10, 5], ['PIT', Math.round(R.pitch), 3]];
  const Rr = [['BNK', Math.round(R.bank), 3], ['RPM', Math.round(R.rpm * 100), 3], ['THR', Math.round(R.thr * 100), 3],
    ['FUEL', Math.round(R.fuel * 100), 3, R.fuel < 0.15 ? T.red : T.white], ['HULL', Math.round(R.hull * 100), 3, R.hull < 0.3 ? T.red : T.white]];
  L.forEach(([n, v, w], i) => row(-0.07, 0.024 - i * 0.015, n, v, w));
  Rr.forEach(([n, v, w, c], i) => row(0.002, 0.024 - i * 0.015, n, v, w, c));
  // The controls: aileron, elevator, rudder, each a bar from the middle.
  [R.ail, R.elev, R.rud].forEach((x, i) => {
    const u = -0.046 + i * 0.046, v = -0.054;
    Pn.rect(u - 0.019, v - 0.0012, u + 0.019, v + 0.0012, [40, 60, 60], 0.3, 0.002);
    Pn.rect(u + Math.min(0, x) * 0.018, v - 0.002, u + Math.max(0, x) * 0.018 + 0.0008, v + 0.002, T.glow, 0.9, 0.003);
  });
}
