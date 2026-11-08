// THE VIPER 2076'S FLIGHT DECK: the inside of the tiltrotor's nose, as geometry.
//
// The Viper 2076 is the armed heli's concept body (mesh_heli_armed_2076.json), after the Bell MV-75
// (the V-280 Valor) and the Air-Launched Effects it carries: a tiltrotor that hunts with a box of
// small drones round it. She can fly herself and fight herself, and does neither unless somebody is
// in the right-hand seat with a hand on something: Halcyon's Warm Hands Rider voids her cover on any
// flight logged without a living pilot, so the controls are real and the panel says, politely and
// all the time, that they are advisory.
//
// Two seats side by side, the pilot on the right as in the MV-75. A centre cyclic between the
// knees, the collective on the console at the left hand (the class is a helicopter, so the lever
// that lifts her is a collective; it is the 'throttle' hotspot, as on the Viper), pedals on rails.
// One wrapped band of glass across a swept dash carries the flight page, the map, the weapons
// page, the effects page with the drones on it, and the engines; the HUD is projected into the
// windscreen with the cyclic, the collective and the pedals mirrored in its corners; a hologram of
// her stands over the dash with her proprotors turning and her drones round her when they are out.
//
// Sources read for this file:
//   https://en.wikipedia.org/wiki/Bell_V-280_Valor
//     side-by-side crew, 50 ft 6 in (15.4 m) long, 35 ft (10.7 m) proprotors, fixed engine nacelles
//     at the wing tips with only the proprotor gearboxes tilting, V-tail, fly-by-wire.
//   https://en.wikipedia.org/wiki/Air-Launched_Effects and the Altius-600 fact sheets
//     tube-launched folding-wing drones, launched from the aircraft in flight, working ahead of it.
//
// ── ⚠ THE ROOM IS THE EXTERIOR'S HULL ───────────────────────────────────────
//
// client/shared/cabin-viper-2076.js states the hull's stations and where its glass is, and the
// exterior generator builds the shell and the panes from the same file. The wall here is that hull
// walked at its own stations and pushed in by a wall's thickness; the windows are the absence of wall
// where the layout says glass. Nothing about the shape of the flight deck is typed here.
//
// ── ⚠ ONE SCALE: THE MV-75'S LENGTH OVER THE MODEL'S ─────────────────────────
//
// 15.4 m over the compiled exterior's radome-to-tail length (in the file's own units, before its
// `scale`), so the room and the airframe agree about what a metre is.
//
// ── ⚠ ANIMATION IS LIVE STATE ────────────────────────────────────────────────
//
// The proprotors on the pages and the hologram turn on `live.phase`, the attitude and the tapes on
// the flight state, the weapons page on `weapon`, `ammo`, `missiles` and `weaponsArmed`. The drones
// are disabled for now: they stay in their tubes here and on the exterior (see dronesOut).
//
// Pure: no clock, no camera, no DOM. `live` arrives as an argument.
import { brandTrim } from './interior-brands.js';
import { makeKit, C, clamp, lerp, SHINY, PANE, TEXTURE } from './interior-kit.js';
import { contactShadow, hotspotHalo, panelGps, gpsHotspot, lensLamp, eased, pressPulse, HALO,
  bootAge, reveal, alertLight, sweep, lightLine, bandFrame, glassBand, holoFrame, holoProjector, windscreenHud,
  HOLO, HOLO_LINE, HOLO_AMBER, HOLO_RED } from './interior-cockpit-kit.js';
import { MESH_ROWS } from './vehicle-meshes.js';
import { compileMesh } from './vehicle-mesh.js';
import { VP76_STATIONS, VP76_GLASS, VP76_DOOR, VP76_INSIDE, VP76_NACELLE, VP76_ALE, MV75_LENGTH_M, vp76Section, vp76Point, aleMouth } from './cabin-viper-2076.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ── THE STYLE ────────────────────────────────────────────────────────────────
// Slate and carbon, the exterior's own two materials, the sand kept for the seat facings, and the
// light that runs round the room in the alert colour.
export const VP76_TRIM = {
  lining: [74, 80, 80], liningDk: [56, 62, 62], headliner: [66, 72, 72],
  carbon: [30, 33, 35], carbonLt: [48, 52, 55], tub: [24, 26, 28],
  fabric: [92, 96, 84], fabricDk: [60, 64, 56], bolster: [40, 44, 44], sand: [176, 152, 104],
  glow: [120, 236, 214], glowDim: [40, 92, 84],
  floor: [34, 36, 36], floorEdge: [24, 26, 26], metal: [140, 146, 152], grip: [28, 30, 32],
  screen: [6, 12, 14], harness: [64, 70, 58], buckle: [176, 182, 190],
  red: [235, 60, 48], amber: [255, 176, 64], green: [90, 230, 120], drone: [210, 214, 208],
};
const T = VP76_TRIM;
for (const k of ['lining', 'liningDk', 'headliner']) TEXTURE.set(T[k], 'paint');
for (const k of ['carbon', 'carbonLt', 'tub']) TEXTURE.set(T[k], 'plastic');
for (const k of ['fabric', 'fabricDk', 'bolster', 'harness']) TEXTURE.set(T[k], 'fabric');
for (const k of ['floor', 'floorEdge', 'grip']) TEXTURE.set(T[k], 'rubber');
for (const k of ['metal', 'buckle']) TEXTURE.set(T[k], 'brushed');
TEXTURE.set(T.sand, 'leather');
SHINY.set(T.carbon, { spec: 0.45, pow: 30 });
SHINY.set(T.carbonLt, { spec: 0.4, pow: 26 });
SHINY.set(T.metal, { spec: 0.7, pow: 36 });
SHINY.set(T.buckle, { spec: 0.8, pow: 40 });
SHINY.set(T.screen, { spec: 0.6, pow: 60 });
brandTrim(T, 'viper', TEXTURE, SHINY);
// The gun's ammunition as cockpit.js counts it: a full load is 1,174 rounds (F.gunCap), and the
// page draws `ammo` against it.
export const GUN_LOAD = 1174;

// ── THE EXTERIOR, MEASURED ──────────────────────────────────────────────────
// Radome tip to tail, in the file's units (compileMesh applies `scale`; this divides it back out).
function modelLength(doc) {
  let fMax = -Infinity, fMin = Infinity;
  for (const f of compileMesh(doc, { detail: 1 }).faces) {
    if (f.role === 'rotor' || f.when) continue;
    for (const q of f.p) { if (q[0] > fMax) fMax = q[0]; if (q[0] < fMin) fMin = q[0]; }
  }
  return (fMax - fMin) / (doc.scale || 1);
}

const EYE = { f: VP76_INSIDE.eyeF, g: VP76_INSIDE.seatG, overFloorM: 1.0 };
const WALL_M = 0.04;

// ── THE PROFILE ──────────────────────────────────────────────────────────────
export function viper2076Profile(doc = MESH_ROWS.heli_armed_2076) {
  if (!doc) return null;
  const m = MV75_LENGTH_M / modelLength(doc);
  const fE = EYE.f, gE = EYE.g, hE = VP76_INSIDE.floorH + EYE.overFloorM / m;
  const X = (g) => (g - gE) * m, Y = (f) => (f - fE) * m, Z = (h) => (h - hE) * m;
  const toShell = (q) => [X(q[1]), Y(q[0]), Z(q[2])];
  const inset = WALL_M / m;
  const fB = VP76_INSIDE.bulkheadF, zF = Z(VP76_INSIDE.floorH);
  const G = { m, X, Y, Z, toShell, inset, fB, zF, fW: VP76_GLASS.windscreen.f[0] };
  const room = buildRoom(G);
  const glass = buildGlass(G);

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const see = (q) => {
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]);
    y1 = Math.max(y1, q[1]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]);
  };
  for (const f of room.faces) f.p.forEach(see);
  for (const pn of glass) pn.forEach(see);
  const xCentre = X(0);
  const halfW = Math.max(xCentre - x0, x1 - xCentre) + 1e-6;
  // The side rays go out through the middle of each door window.
  const Dg = VP76_GLASS.door, fm = (Dg.f[0] + Dg.f[1]) / 2;
  const wLo = vp76Point(fm, Dg.a[0] + 2)[2], wHi = vp76Point(fm, Dg.a[1] - 4)[2];
  const P = {
    label: 'Viper 2076 flight deck',
    xCentre, halfW,
    floor: z0 - 1e-6, roof: z1 + 1e-6, front: y1 + 1e-6, back: y0 - 1e-6,
    mPerUnit: m, glassAftY: Y(G.fW),
    winY: [Y(fm - 0.03), Y(fm + 0.03)], winZ: [Z(wLo), Z(wHi)],
    dashY: 0.62, dashZ: -0.38, headerZ: Z(vp76Point(G.fW, 80)[2]), pillarW: 0.03,
    seatZ: zF + 0.34, seatHalf: 0.25, seatY: [-0.28, 0.2], backZ: 0.02,
    seats: 2, centrePost: 0,
    normalLit: true,
    floods: [{ p: [xCentre * 0.5, 0.6, -0.32], r: 0.55 }, { p: [xCentre, -0.2, 0.3], r: 0.65 }],
    floodGain: 1.7, glare: 0.3,
    room: vp76Shell,
    glass,
    vp76: { ...G, faces: room.faces },
    hotspots(live) { return vp76Hotspots(this, live); },
  };
  return P;
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
function buildRoom(G) {
  const { toShell, inset, fB, zF, m } = G;
  const faces = [];
  const put = (p, n, tone, k, rgb, emis) => faces.push({ p, n, tone, k, rgb, emis: emis || 0 });
  const K = makeKit((fs, tone, k, fwd, rgb, emis) => { for (const f of fs) put(f.p, f.n, tone, k, rgb, emis); }, false);
  const S = (f, aDeg, inM = 0) => toShell(vp76Point(f, aDeg, -(inset + inM / m)));
  const inward = (f, a) => {
    const d = 1e-4;
    let n = norm(cross(sub(S(f + d, a), S(f - d, a)), sub(S(f, a + d * 50), S(f, a - d * 50))));
    const c = toShell([f, 0, vp76Section(f).cz]);
    if (dot(n, sub(c, S(f, a))) < 0) n = mul(n, -1);
    return n;
  };
  const aboveFloor = (poly) => clipHalf(poly, (q) => q[2] - zF);

  // ── THE SHELL: lining over the crown, dark panels below the waist, door cards on the doors ──
  const FS = [fB, 0.34, 0.37, 0.4, 0.43, 0.46, 0.49, 0.52, 0.548, 0.555, 0.575, 0.6, 0.62, 0.65, 0.69, 0.72, 0.75, 0.79, 0.81, 0.835];
  const NA = 72;
  const W = VP76_GLASS.windscreen, Dg = VP76_GLASS.door;
  const holes = [
    [[W.f[0], W.a[0]], [W.f[1], W.a[0]], [W.f[1], W.a[1]], [W.f[0], W.a[1]]],
    [[Dg.f[0], Dg.a[0]], [Dg.f[1], Dg.a[0]], [Dg.f[1], Dg.a[1]], [Dg.f[0], Dg.a[1]]],
    [[Dg.f[0], 180 - Dg.a[1]], [Dg.f[1], 180 - Dg.a[1]], [Dg.f[1], 180 - Dg.a[0]], [Dg.f[0], 180 - Dg.a[0]]],
  ];
  const Dd = VP76_DOOR;
  for (let i = 0; i < FS.length - 1; i++) {
    for (let j = 0; j < NA; j++) {
      const f0 = FS[i], f1 = FS[i + 1], a0 = -90 + (j / NA) * 360, a1 = -90 + ((j + 1) / NA) * 360;
      let cells = [[[f0, a0], [f1, a0], [f1, a1], [f0, a1]]];
      for (const h of holes) cells = cells.flatMap((c) => (bbOverlap(c, h) ? subtractConvex(c, h) : [c]));
      const fm = (f0 + f1) / 2, am = (a0 + a1) / 2, sn = Math.sin(am * DEG);
      const n = inward(fm, am);
      const side = Math.abs(Math.cos(am * DEG)) > 0.2;
      const aSide = am > 90 ? 180 - am : am;
      const inDoor = side && fm > Dd.f[0] && fm < Dd.f[1] && aSide > Dd.aLo && aSide < Dd.aHi;
      for (const c of cells) {
        const poly = aboveFloor(c.map(([f, a]) => S(f, a)));
        if (poly.length < 3) continue;
        if (sn > 0.88) put(poly, n, 'hdr', -0.28, (j + i) % 2 ? T.headliner : T.lining);
        else if (inDoor) put(poly, n, 'pil', -0.06, aSide < 6 ? T.carbonLt : T.lining);
        else if (sn < -0.15) put(poly, n, 'pil', -0.18, T.tub);
        else put(poly, n, 'pil', -0.12, T.liningDk);
      }
    }
  }

  // ── THE REVEALS: a carbon return round every window and a lit seal along its inner edge ──
  const revealEdge = (pts, cF, cA) => {
    for (let t = 1; t < pts.length; t++) {
      const [fa, aa] = pts[t - 1], [fb, ab] = pts[t];
      const i0 = S(fa, aa), i1 = S(fb, ab), o0 = toShell(vp76Point(fa, aa, -0.004 / m)), o1 = toShell(vp76Point(fb, ab, -0.004 / m));
      const fm = (fa + fb) / 2, am = (aa + ab) / 2;
      const toC = sub(S(cF, cA), S(fm, am));
      const out = norm(sub(toShell(vp76Point(fm, am, 0)), S(fm, am)));
      const rn = norm(sub(toC, mul(out, dot(toC, out))));
      if (i0[2] > zF && i1[2] > zF) put([i0, i1, o1, o0], rn, 'pil', 0.05, T.carbon);
      if (i0[2] > zF + 0.01 && i1[2] > zF + 0.01) K.rod(S(fa, aa, 0.006), S(fb, ab, 0.006), 0.0035, 'pil', 0.1, T.glowDim, 0.35, 5, false);
    }
  };
  const edge = (f0, a0, f1, a1, n) => Array.from({ length: n + 1 }, (_, i) => [lerp(f0, f1, i / n), lerp(a0, a1, i / n)]);
  revealEdge(edge(W.f[0], W.a[0], W.f[0], W.a[1], 30), W.f[0] + 0.05, 90);
  revealEdge(edge(W.f[0], W.a[0], W.f[1], W.a[0], 10), (W.f[0] + W.f[1]) / 2, 60);
  revealEdge(edge(W.f[0], W.a[1], W.f[1], W.a[1], 10), (W.f[0] + W.f[1]) / 2, 120);
  for (const [aLo, aHi] of [Dg.a, [180 - Dg.a[1], 180 - Dg.a[0]]]) {
    const cF = (Dg.f[0] + Dg.f[1]) / 2, cA = (aLo + aHi) / 2;
    revealEdge([...edge(Dg.f[0], aLo, Dg.f[1], aLo, 8), ...edge(Dg.f[1], aLo, Dg.f[1], aHi, 6).slice(1), ...edge(Dg.f[1], aHi, Dg.f[0], aHi, 8).slice(1), ...edge(Dg.f[0], aHi, Dg.f[0], aLo, 6).slice(1)], cF, cA);
  }
  // The windscreen's two posts, inside: carbon ribs where the exterior's posts are.
  for (const a of [40, 140]) {
    const pts = [0.56, 0.6, 0.65, 0.7, 0.75, 0.785].map((f) => S(f, a, 0.004));
    for (let k = 1; k < pts.length; k++) K.rod(pts[k - 1], pts[k], 0.012, 'pil', 0.0, T.carbon, 0, 6, false);
  }

  // ── THE CREW DOORS: the seam round each card, an armrest, a pull, the jettison handle ──
  for (const s of [1, -1]) {
    const A = (a) => (s > 0 ? a : 180 - a);
    const seam = [...edge(Dd.f[0] + 0.004, Dd.aLo + 18, Dd.f[0] + 0.004, Dd.aHi - 2, 10), ...edge(Dd.f[0] + 0.004, Dd.aHi - 2, Dd.f[1] - 0.004, Dd.aHi - 2, 10).slice(1), ...edge(Dd.f[1] - 0.004, Dd.aHi - 2, Dd.f[1] - 0.004, Dd.aLo + 18, 10).slice(1)];
    const pts = seam.map(([f, a]) => S(f, A(a), 0.006)).filter((q) => q[2] > zF + 0.02);
    for (let k = 1; k < pts.length; k++) K.rod(pts[k - 1], pts[k], 0.005, 'pil', -0.3, T.carbon, 0, 4, false);
    // The armrest: a carbon blade along the card at elbow height, lit along its top edge.
    const aArm = A(-4);
    const ar0 = S(0.38, aArm, 0.05), ar1 = S(0.52, aArm, 0.05);
    const along = norm(sub(ar1, ar0));
    const aUp = norm(cross(cross(along, [0, 0, 1]), along));
    K.obox(mul(add(ar0, ar1), 0.5), along, aUp, norm(cross(along, aUp)), Math.hypot(...sub(ar1, ar0)) / 2, 0.025, 0.045, 'pil', 0.05, T.carbon);
    K.rod(add(ar0, [0, 0, 0.026]), add(ar1, [0, 0, 0.026]), 0.004, 'pil', 0.2, T.glow, 0.9, 5);
    // The pull, and the yellow-and-black jettison handle under a clear guard, a fixture that only
    // matters on the ground: the sim has no jettison, so it is not a control here.
    const p0 = S(0.47, A(10), 0.03), p1 = S(0.53, A(10), 0.03);
    K.rod(p0, p1, 0.01, 'pil', 0.3, T.metal, 0, 8);
    for (const q of [[0.47, p0], [0.53, p1]]) K.rod(q[1], S(q[0], A(10), 0.004), 0.007, 'pil', 0.3, T.metal, 0, 6);
    const j0 = S(0.4, A(12), 0.012);
    K.rod(j0, S(0.44, A(12), 0.012), 0.008, 'pil', 0.2, [214, 180, 40], 0.1, 6);
  }

  // ── THE BULKHEAD: carbon, the hatch to the cabin in the middle, padded panels behind the seats ──
  const NS = 72, bpts = [];
  for (let k = 0; k <= NS; k++) bpts.push(S(fB, -90 + (k / NS) * 360));
  const bulk = aboveFloor(bpts);
  if (bulk.length >= 3) put(bulk, [0, 1, 0], 'post', -0.12, T.carbon);
  const yB = G.Y(fB), xC = G.X(0);
  for (const cx of [0, 2 * xC]) {
    K.box(cx - 0.23, yB, zF + 0.4, cx + 0.23, yB + 0.03, zF + 1.0, 'post', -0.05, T.fabricDk);
    for (let r = 1; r < 6; r++) K.box(cx - 0.23, yB + 0.03, zF + 0.4 + r * 0.1, cx + 0.23, yB + 0.034, zF + 0.404 + r * 0.1, 'post', -0.2, T.bolster);
  }
  // The hatch: a frame, a window into the cabin's dark, and a handle. A fixture.
  K.box(xC - 0.2, yB, zF + 0.05, xC + 0.2, yB + 0.012, zF + 1.25, 'post', 0.0, T.carbonLt);
  K.box(xC - 0.16, yB + 0.012, zF + 0.1, xC + 0.16, yB + 0.016, zF + 1.2, 'post', -0.1, T.carbon);
  K.box(xC - 0.08, yB + 0.016, zF + 0.85, xC + 0.08, yB + 0.018, zF + 1.1, 'post', 0.3, [10, 14, 16]);
  K.box(xC + 0.1, yB + 0.016, zF + 0.6, xC + 0.12, yB + 0.05, zF + 0.75, 'post', 0.3, T.metal);
  K.box(2 * xC - 0.25, yB + 0.005, zF + 1.3, 0.25, yB + 0.02, zF + 1.32, 'post', 0.2, T.glow, 0.9);

  // ── THE FLOOR: rubber mats from the bulkhead to where the floor meets the hull, edged in light ──
  const floorHalf = (f) => {
    let prev = null;
    for (let a = -90; a <= 0; a += 1) {
      const q = vp76Point(f, a, -inset);
      if (prev && prev[2] < VP76_INSIDE.floorH && q[2] >= VP76_INSIDE.floorH) {
        const t = (VP76_INSIDE.floorH - prev[2]) / (q[2] - prev[2]);
        return (prev[1] + (q[1] - prev[1]) * t) * m;
      }
      prev = q;
    }
    return 0;
  };
  const FF = [];
  for (let f = fB; f < 0.76; f += 0.02) FF.push(f);
  for (let i = 0; i < FF.length - 1; i++) {
    const f0 = FF[i], f1 = FF[i + 1], w0 = floorHalf(f0), w1 = floorHalf(f1);
    if (w0 <= 0.01 || w1 <= 0.01) continue;
    put([[xC - w0, G.Y(f0), zF], [xC + w0, G.Y(f0), zF], [xC + w1, G.Y(f1), zF], [xC - w1, G.Y(f1), zF]], [0, 0, 1], 'floor', -0.2, i % 6 === 5 ? T.floorEdge : T.floor);
    for (const s of [-1, 1]) if (w0 > 0.08) K.box(xC + s * (w0 - 0.05) - 0.006, G.Y(f0), zF + 0.001, xC + s * (w0 - 0.05) + 0.006, G.Y(f1), zF + 0.004, 'floor', 0.2, T.glow, 0.7);
  }
  return { faces };
}

// ── THE GLASS ────────────────────────────────────────────────────────────────
function buildGlass(G) {
  const { toShell, m } = G;
  const d = 0.005 / m;
  const panes = [];
  const grid = (f0, f1, a0, a1, nf, na) => {
    for (let i = 0; i < nf; i++) for (let j = 0; j < na; j++) {
      const fa = lerp(f0, f1, i / nf), fb = lerp(f0, f1, (i + 1) / nf), aa = lerp(a0, a1, j / na), ab = lerp(a0, a1, (j + 1) / na);
      panes.push([[fa, aa], [fb, aa], [fb, ab], [fa, ab]].map(([f, a]) => toShell(vp76Point(f, a, -d))));
    }
  };
  const W = VP76_GLASS.windscreen, Dg = VP76_GLASS.door;
  grid(W.f[0], W.f[1], W.a[0], W.a[1], 8, 24);
  panes.bubble = panes.length;
  grid(Dg.f[0], Dg.f[1], Dg.a[0], Dg.a[1], 4, 4);
  grid(Dg.f[0], Dg.f[1], 180 - Dg.a[1], 180 - Dg.a[0], 4, 4);
  return panes;
}

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
function vp76Shell(P, live, push, rich) {
  const D = P.vp76;
  for (const f of D.faces) push(f.one || (f.one = Object.assign([{ p: f.p, n: f.n }], { stable: true })), f.tone, f.k, false, f.rgb, f.emis || 0);
  seats(P, push);
  if (rich) vp76Fit(P, live, push);
}

// ── THE READINGS ─────────────────────────────────────────────────────────────
const readings = (live) => {
  const L = live || {};
  const missiles = Math.max(0, Math.round(num(L.missiles, 4)));
  const w = String(L.weapon || 'guns').toLowerCase();
  return {
    L,
    pitch: num(L.pitch), bank: num(L.bank), hdg: num(L.hdg),
    ias: Math.max(0, num(L.ias)), alt: Math.max(0, num(L.alt)), vsi: num(L.vsi),
    rpm: clamp(num(L.rpm), 0, 1.1), thr: clamp(num(L.throttle), 0, 1),
    fuel: clamp(num(L.fuel, 1), 0, 1), hull: clamp(num(L.hull, 1), 0, 1),
    temp: clamp(num(L.oilTemp, 0.4), 0, 1),
    powered: L.powered !== false,
    ail: clamp(num(L.stickX), -1, 1), elev: clamp(num(L.stickY), -1, 1), rud: clamp(num(L.rudder), -1, 1),
    land: !!L.landingLight, gearDown: L.gearDown !== false, dome: !!L.dome, hour: num(L.hour, 12),
    phase: num(L.phase), stall: !!L.stall,
    armed: !!(L.weaponsArmed || L.armed),
    weapon: w.startsWith('msl') || w.startsWith('mis') ? 'msl' : w.startsWith('bomb') ? 'bomb' : 'guns',
    ammo: Math.max(0, Math.round(num(L.ammo, GUN_LOAD))), missiles, firing: !!L.firing,
  };
};
const night = (R) => R.hour < 6.5 || R.hour > 19.5;
const panelOn = (R) => R.powered && (R.L.panelLight != null ? !!R.L.panelLight : night(R));
// The drones' place between the tubes (0) and the box (1). Held at 0 with the exterior's `drones`
// channel (cockpit.js classAnim) until they have a job in the sim, so the pages read STOWED.
const dronesOut = () => 0;
// The pylons' lean in the hologram: the sim has no tilt, so this is the conversion schedule a
// tiltrotor would fly at this airspeed, drawn small (to 12 degrees by 120 kt) and only in the hologram.
const pylonLean = (R) => clamp(R.ias / 120, 0, 1) * 12;

// ── WHERE THE CONTROLS ARE ───────────────────────────────────────────────────
// The cyclic between the pilot's knees; the collective at the left hand, hinged beside the hip on
// the console's edge, rising as it is pulled; the pedals on rails.
const CYC = { base: [0, 0.3, 0.22], len: 0.36 };                    // z off the floor
const COLL = { x: -0.28, pivotY: -0.42, z: 0.42, len: 0.42 };       // pivot z off the floor
const PED = { x: 0.12, y: 0.74, z: 0.14 };
function cyclicAt(P, R) {
  const base = [CYC.base[0], CYC.base[1], P.vp76.zF + CYC.base[2]];
  const dir = norm([R.ail * 0.3, -R.elev * 0.3, 1]);
  return { base, top: add(base, mul(dir, CYC.len)), dir };
}
function collectiveAt(P, R) {
  const pivot = [COLL.x, COLL.pivotY, P.vp76.zF + COLL.z];
  const a = (6 + R.thr * 20) * DEG;                                  // 6 degrees up at bottom, 26 at full pull
  const dir = [0, Math.cos(a), Math.sin(a)];
  return { pivot, end: add(pivot, mul(dir, COLL.len)), dir, a };
}

// ── THE DASH: a sculpted wing across the deck and on its face one band of glass ──
const DASH = { xL: -1.42, xR: 0.36, yMid: 0.8, sag: 0.17, w: 0.98, z0: -0.5, h: 0.26, lean: 0.45 };
function dashCurve(P) {
  const xC = P.xCentre;
  return (s) => {
    const x = lerp(DASH.xL, DASH.xR, s), q = (x - xC) / DASH.w;
    const y = DASH.yMid - DASH.sag * q * q, dy = -2 * DASH.sag * q / DASH.w;
    return { p: [x, y, DASH.z0], f: norm([-dy, 1, 0]) };
  };
}
const sOf = (x) => (x - DASH.xL) / (DASH.xR - DASH.xL);
const bandPanel = (K, P, x, v, lift = 0.005) => bandFrame(dashCurve(P), DASH.lean).at(K, sOf(x), v, lift);

// ── ⚠ EVERY CONTROL IN ONE FORWARD VIEW ──────────────────────────────────────
// The five keys the sim has (power, the three lighting circuits and the master arm) are glass keys on
// the band's right end; the map is clicked for destinations. The cyclic, the collective and the
// pedals sit low, so each is mirrored in the windscreen HUD.
const BTN = { ids: ['master', 'land', 'panel', 'dome', 'arm', 'gear'], names: { master: 'PWR', land: 'LAND', panel: 'PANEL', dome: 'CABIN', arm: 'ARM', gear: 'GEAR' } };
const BTN_AT = (i) => (i < 3 ? { x: [0.17, 0.235, 0.3][i], v: 0.18, w: 0.031 } : i === 3 ? { x: 0.17, v: 0.11, w: 0.031 } : i === 5 ? { x: 0.365, v: 0.18, w: 0.031 } : { x: 0.268, v: 0.11, w: 0.062 });
function switchOn(id, R) {
  if (id === 'master') return R.powered;
  if (id === 'land') return R.land;
  if (id === 'panel') return panelOn(R);
  if (id === 'dome') return R.dome && R.powered;
  if (id === 'arm') return R.armed && R.powered;
  if (id === 'gear') return R.gearDown && R.powered;
  return R.powered;
}

// ── THE PAGES on the band, and the status lamps along its foot ──
const SCREENS = [
  { id: 'eng', x: -1.24, w: 0.13, boot: 0.6 },
  { id: 'ale', x: -0.94, w: 0.14, boot: 0.45 },
  { id: 'wpn', x: -0.63, w: 0.14, boot: 0.3 },
  { id: 'map', x: -0.33, w: 0.13, boot: 0.15 },     // the one page you click (destinations): inside the forward view
  { id: 'pfd', x: -0.02, w: 0.15, boot: 0 },
];
const SCREEN_H = 0.1, PAGE_V = 0.145;
const screenPanel = (K, P, sc) => bandPanel(K, P, sc.x, PAGE_V, 0.014);
const LAMP_X = [-1.24, -0.98, -0.72, -0.46, -0.2];

export function vp76Hotspots(P, live) {
  const R = readings(live), K = makeKit(() => {}), out = [];
  BTN.ids.forEach((id, i) => { const b = BTN_AT(i); out.push({ id: 'ck:' + id, p: bandPanel(K, P, b.x, b.v).pt(0, 0, 0.01), r: id === 'arm' ? 0.034 : 0.026, kind: 'click' }); });
  out.push({ id: 'yoke', p: add(cyclicAt(P, R).top, [0, 0, 0.05]), r: 0.07, kind: 'yoke' });
  const cl = collectiveAt(P, R);
  out.push({ id: 'throttle', p: add(cl.end, mul(cl.dir, 0.05)), r: 0.05, kind: 'throttle' });
  const zF = P.vp76.zF;
  out.push({ id: 'rudderL', p: [-PED.x, PED.y, zF + PED.z + 0.04], r: 0.05, kind: 'rudder' });
  out.push({ id: 'rudderR', p: [PED.x, PED.y, zF + PED.z + 0.04], r: 0.05, kind: 'rudder' });
  out.push(gpsHotspot(screenPanel(K, P, SCREENS.find((sc) => sc.id === 'map')), 0, 0, 0.06));
  return out;
}

// ── THE SEATS: armoured crew seats, sand facings, a five-point harness each ──
function seats(P, push) {
  const K = makeKit(push, false);
  for (const cx of [0, 2 * P.xCentre]) crewSeat(K, P, cx);
}
function crewSeat(K, P, cx) {
  const h = P.seatHalf, [y0, y1] = P.seatY, sz = P.seatZ, zF = P.vp76.zF;
  // The stroking base: two rails and the energy absorbers a crash seat rides down.
  K.box(cx - 0.14, y0 + 0.06, zF, cx + 0.14, y1 - 0.1, zF + 0.04, 'seat', -0.25, T.carbon);
  for (const s of [-1, 1]) K.rod([cx + s * 0.12, y0 + 0.02, zF + 0.04], [cx + s * 0.12, y0 + 0.02, sz - 0.12], 0.018, 'seat', 0.1, T.metal, 0, 8);
  K.box(cx - 0.12, y0 + 0.08, zF + 0.04, cx + 0.12, y1 - 0.12, sz - 0.12, 'seat', -0.2, T.tub);
  // The bucket, armoured: a carbon pan with side plates, and a sand cushion in it.
  K.box(cx - h, y0, sz - 0.12, cx + h, y1, sz - 0.06, 'seat', 0.0, T.carbon);
  K.box(cx - h + 0.05, y0 + 0.02, sz - 0.06, cx + h - 0.05, y1 - 0.02, sz, 'seat', 0.08, T.sand);
  for (const s of [-1, 1]) {
    K.box(cx + s * h - s * 0.05, y0, sz - 0.06, cx + s * h, y1, sz + 0.09, 'seat', 0.05, T.bolster);
    K.box(cx + s * (h - 0.025) - 0.003, y0 + 0.02, sz + 0.09, cx + s * (h - 0.025) + 0.003, y1 - 0.02, sz + 0.094, 'seat', 0.2, T.glow, 0.5);
  }
  // Quilting: rows of seams across the cushion.
  for (let i = 1; i < 5; i++) { const y = lerp(y0 + 0.02, y1 - 0.02, i / 5); K.box(cx - h + 0.06, y - 0.003, sz + 0.0005, cx + h - 0.06, y + 0.003, sz + 0.002, 'seat', -0.3, T.fabricDk); }
  const lean = 0.22, bb = [cx, y0 - 0.01, sz], up = [0, -Math.sin(lean), Math.cos(lean)], fw = [0, Math.cos(lean), Math.sin(lean)];
  const bH = 0.66, bc = add(bb, mul(up, bH / 2));
  K.obox(add(bc, mul(fw, -0.07)), [1, 0, 0], up, fw, h, bH / 2, 0.05, 'seat', -0.06, T.carbon);
  K.obox(add(bc, mul(fw, -0.015)), [1, 0, 0], up, fw, h - 0.06, bH / 2 - 0.04, 0.012, 'seat', 0.0, T.sand);
  for (const s of [-1, 1]) K.obox(add(add(bc, mul(fw, -0.005)), [s * (h - 0.03), 0, 0]), [1, 0, 0], up, fw, 0.03, bH / 2, 0.045, 'seat', 0.0, T.bolster);
  // Armour wings either side of the head, the headrest between them.
  const hc = add(bb, mul(up, bH + 0.1));
  K.obox(add(hc, mul(fw, -0.045)), [1, 0, 0], up, fw, 0.15, 0.1, 0.05, 'seat', 0.0, T.carbon);
  K.obox(add(hc, mul(fw, 0.008)), [1, 0, 0], up, fw, 0.1, 0.07, 0.008, 'seat', 0.0, T.fabric);
  for (const s of [-1, 1]) K.obox(add(add(hc, mul(fw, -0.01)), [s * 0.15, 0, 0]), [1, 0, 0], up, fw, 0.02, 0.1, 0.06, 'seat', 0.05, T.carbonLt);
  K.obox(add(add(bb, mul(up, bH * 0.55)), mul(fw, -0.002)), [1, 0, 0], up, fw, h - 0.07, 0.004, 0.012, 'seat', 0.2, T.glow, 0.3);
  const top = add(bb, mul(up, bH - 0.01)), buck = [cx, y1 - 0.16, sz + 0.14];
  for (const s of [-1, 1]) {
    K.rod(add(add(top, mul(fw, 0.03)), [s * 0.06, 0, 0]), add(buck, [s * 0.025, 0, 0.03]), 0.012, 'seat', 0.05, T.harness, 0, 4);
    K.rod([cx + s * (h - 0.04), y0 + 0.08, sz + 0.03], add(buck, [s * 0.025, 0, -0.01]), 0.012, 'seat', 0.05, T.harness, 0, 4);
  }
  K.rod([cx, y1 - 0.04, sz + 0.005], add(buck, [0, 0, -0.02]), 0.01, 'seat', 0.05, T.harness, 0, 4);
  K.rod(add(buck, [0, -0.008, 0]), add(buck, [0, 0.01, 0]), 0.034, 'seat', 0.3, T.buckle, 0, 12);
}

// ── THE FIT-OUT ──────────────────────────────────────────────────────────────
export function vp76Fit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live);
  const zF = P.vp76.zF, xC = P.xCentre;
  const lit = R.powered, panel = panelOn(R);
  const amb = lit ? (night(R) ? 1 : 0.55) * (R.dome ? 1.2 : 1) : 0.05;
  const boot = bootAge(live);
  // The light lines carry the alert: teal, amber on low fuel or the master arm, red and breathing on
  // a hull warning or a stall.
  const warn = lit && (R.hull < 0.3 || R.stall), caution = lit && (R.fuel < 0.15 || R.armed);
  const al = alertLight(caution, warn, T.line), lineK = (k) => (lit ? k * al.k : 0.05);
  const out = dronesOut(R);

  // ── THE DASH: a wing swept along the band's curve ──
  const curve = dashCurve(P);
  const gt = [DASH.h * DASH.lean / Math.hypot(1, DASH.lean), DASH.h / Math.hypot(1, DASH.lean)];
  const SEC = [[0, 0], gt, [0.2, 0.25], [0.3, 0.235], [0.33, 0.17], [0.25, -0.06], [0.07, -0.14], [-0.06, -0.1], [-0.07, -0.04], [0, 0]];
  const N = 32, rings = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N, c = curve(s), e = Math.abs(2 * s - 1) ** 3, tap = 1 - 0.6 * e;
    rings.push(SEC.map(([f, z]) => {
      const ff = f > gt[0] ? gt[0] + (f - gt[0]) * tap : f < 0 ? f * tap : f;
      return [c.p[0] + c.f[0] * ff, c.p[1] + c.f[1] * ff, c.p[2] + (z > gt[1] ? gt[1] + (z - gt[1]) * tap : z) - (z > 0.05 ? 0.05 * e : 0)];
    }));
  }
  sweep(K, rings, 'dash', 0.1, T.carbon);
  for (const r of [rings[0], rings[N]]) {
    const n = norm(cross(sub(r[3], r[1]), sub(r[6], r[1])));
    K.face(r.slice(0, -1), n, 'dash', 0.05, T.carbonLt);
    K.face(r.slice(0, -1).reverse(), mul(n, -1), 'dash', 0.05, T.carbonLt);
  }
  lightLine(K, rings.map((r) => r[7]), 0.003, al.rgb, lineK(0.8));
  lightLine(K, rings.slice(2, -2).map((r) => add(r[3], [0, 0, 0.002])), 0.002, al.rgb, lineK(0.35));
  // The glareshield's vents: slots along the shelf's top, between the band and the glass.
  for (let i = 3; i < N - 3; i += 2) {
    const a = rings[i][2], b = rings[i + 1][2];
    K.rod(add(a, [0, 0, 0.003]), add(b, [0, 0, 0.003]), 0.004, 'dash', -0.2, T.tub, 0, 4, false);
  }
  // The struts the dash hangs off, down to the floor between the footwells.
  for (const x of [xC, xC - 0.5, 0.3]) {
    const c = curve(sOf(x)), top = add(add(c.p, mul(c.f, 0.15)), [0, 0, -0.12]);
    K.rod(top, [top[0], top[1] - 0.05, zF + 0.03], 0.02, 'dash', 0.1, T.carbon, 0, 8);
  }

  // ── THE BAND: one sheet of glass, the pages on it, booting in turn when the power comes on ──
  glassBand(K, curve, { h: DASH.h, lean: DASH.lean, segs: 32, lit, light: al.rgb, lightK: lineK(1), substrate: T.screen });
  for (const sc of SCREENS) {
    const Pn = screenPanel(K, P, sc), up = reveal(boot, sc.boot);
    if (!lit || up <= 0) continue;
    if (up < 1) {
      const y = lerp(-SCREEN_H, SCREEN_H, up);
      Pn.rect(-sc.w, -SCREEN_H, sc.w, y, T.screen, 0.3 * up, 0.001);
      Pn.rect(-sc.w, y - 0.002, sc.w, y + 0.002, T.glow, 1, 0.0025);
      continue;
    }
    Pn.rect(-sc.w + 0.004, SCREEN_H - 0.0035, sc.w - 0.004, SCREEN_H - 0.0015, sc.id === 'wpn' && R.armed ? T.amber : T.glow, 0.85, 0.0018);
    if (sc.id === 'pfd') pfd(Pn, R);
    else if (sc.id === 'map') mapPage(Pn, R, live);
    else if (sc.id === 'wpn') weaponsPage(Pn, R);
    else if (sc.id === 'ale') effectsPage(Pn, R, out);
    else if (sc.id === 'eng') enginePage(Pn, R);
  }
  {
    const handsOn = lit && (Math.abs(R.ail) > 0.03 || Math.abs(R.elev) > 0.03 || Math.abs(R.rud) > 0.03);
    // ⚠ PILOT PRESENT IS THE RIDER'S LAMP: lit whenever the seat is powered and occupied.
    const lamps = [
      ['PILOT PRESENT', lit, C.green], ['HANDS ON', handsOn, T.glow], ['MASTER ARM', lit && R.armed, T.amber],
      ['LOW FUEL', lit && R.fuel < 0.15, T.red], ['HULL', lit && R.hull < 0.3, T.red],
    ];
    lamps.forEach(([name, on, rgb], i) => lensLamp(bandPanel(K, P, LAMP_X[i], 0.026, 0.012), 0, 0, 0.2, 0.032, on && reveal(boot, 0.6) >= 1, rgb, name));
  }

  // ── THE KEYS: six glass keys on the band's right end, ARM wide and red ──
  BTN.ids.forEach((id, i) => {
    const b = BTN_AT(i), Kp = bandPanel(K, P, b.x, b.v, 0.004), on = switchOn(id, R);
    const pressed = !!live && live.press === 'ck:' + id, near = !!live && live.hover === 'ck:' + id;
    const rgb = id === 'master' ? C.green : id === 'arm' ? T.red : T.glow;
    const glow = eased('v76:glow:' + id, on ? 1 : 0, 10), depth = eased('v76:dip:' + id, pressed ? 0.002 : 0.007, 30);
    const hand = eased('v76:near:' + id, near ? 1 : 0, 14);
    const w = b.w;
    Kp.rect(-w, -0.03, w, 0.03, T.tub, 0, 0.0005);
    if (id === 'arm') {
      // The guard: yellow and black stripes round the key, the arm's own warning.
      for (let k = 0; k < 8; k++) Kp.rect(-w + k * w / 4, 0.026, -w + k * w / 4 + w / 8, 0.03, k % 2 ? [20, 20, 20] : [214, 180, 40], 0.2, 0.001);
      Kp.rect(-w + 0.002, -0.029, w - 0.002, 0.029, [60, 20, 18], 0, 0.0008);
      Kp.stud(0, 0, w - 0.006, 0.024, depth, rgb.map((c, k) => lerp([50, 30, 30][k], c, glow * 0.85)), glow * 0.9 + hand * 0.15, 0.0015);
    } else {
      Kp.annulus(0, 0, 0.029, 0.031, T.glow, (lit ? 0.25 : 0) + hand * 0.75, 0.0012, 20);
      Kp.stud(0, 0, 0.026, 0.026, depth, rgb.map((c, k) => lerp([40, 46, 50][k], c, glow * 0.8)), glow * 0.85 + hand * 0.15, 0.0015);
    }
    Kp.fitText(BTN.names[id], 0, -0.004, id === 'arm' ? 0.08 : 0.044, 0.012, glow > 0.5 ? [10, 24, 22] : [214, 222, 220], glow > 0.5 ? 0 : (panel ? 0.6 : 0.25), depth + 0.0025);
    const flash = pressPulse('v76:key:' + id, on);
    if (flash > 0.02) Kp.annulus(0, 0, w + 0.003, w + 0.007, HALO, flash, 0.004, 18);
  });

  // ── THE WINDSCREEN HUD: projected, conformal, the cyclic, the collective and the pedals mirrored ──
  if (lit) {
    const H = windscreenHud(K, R, { dist: 0.66, z: 0.0, hw: 0.21, hh: 0.1, warn, caution: lit && R.fuel < 0.15, boot: reveal(boot, 0.2),
      mirrors: { stick: [R.ail, R.elev], thrs: [R.thr], rud: R.rud } });
    // The weapon cue under the speed box, and the drones' count, both in the HUD's own colour.
    if (reveal(boot, 0.2) >= 1) {
      const wTxt = R.weapon === 'msl' ? 'MSL ' + R.missiles : 'GUN ' + R.ammo;
      H.text(R.armed ? wTxt : 'SAFE', 0.21 * 0.72, -0.058, 0.011, R.armed ? [255, 206, 110] : [90, 214, 172], 1, 0.001);
      if (out > 0.02) H.text('ALE ' + (out > 0.98 ? '8' : 'OUT'), -0.21 * 0.72, -0.042, 0.011, [150, 255, 205], 1, 0.001);
    }
  }

  // ── THE HOLOGRAM over the dash: the aircraft herself, flying as she flies ──
  {
    const c0 = curve(sOf(-0.48)), base = add(add(c0.p, mul(c0.f, 0.21)), [0, 0, 0.24]);
    holoProjector(K, base, 0.07, 0.06, lit ? R.fuel : 0, R.fuel < 0.15 ? HOLO_RED : R.fuel < 0.3 ? HOLO_AMBER : HOLO_LINE);
    if (lit && reveal(boot, 0.7) > 0) holoViper(K, add(base, [0, 0, 0.1]), R, out);
  }

  // ── THE CONSOLE between the seats: the collective's quadrant, a lid and a pocket ──
  const cy0 = -0.5, cy1 = 0.42, ct = zF + 0.46, chw = 0.13;
  {
    const crings = [];
    for (let i = 0; i <= 8; i++) {
      const y = lerp(cy0, cy1, i / 8), hw = chw * (0.85 + 0.15 * i / 8);
      const sec = [];
      for (let j = 0; j <= 10; j++) {
        const a = Math.PI * j / 10, x = xC - Math.cos(a) * hw, z = j === 0 || j === 10 ? zF : ct - (1 - Math.sin(a)) * 0.05 + Math.sin(a) * 0.004;
        sec.push([x, y, j === 0 || j === 10 ? zF : Math.max(zF + 0.02, z)]);
      }
      crings.push(sec);
    }
    sweep(K, crings, 'dash', 0.1, T.carbon);
    K.face(crings[8].slice(), [0, 1, 0], 'dash', 0.05, T.carbonLt);
    for (const s of [-1, 1]) lightLine(K, crings.map((r) => add(r[s < 0 ? 1 : 9], [0, 0, 0.004])), 0.0025, al.rgb, lineK(0.85));
  }
  K.box(xC - 0.09, 0.12, ct + 0.002, xC + 0.09, 0.4, ct + 0.006, 'dash', 0.2, T.fabricDk);
  K.box(xC - 0.09, -0.46, ct - 0.03, xC - 0.01, -0.34, ct + 0.001, 'dash', -0.25, T.tub);

  // ── THE COLLECTIVE: a tube from its hinge, a friction collar, the grip with its switch box ──
  {
    const cl = collectiveAt(P, R), near = eased('v76:near:throttle', live && (live.hover === 'throttle' || live.press === 'throttle') ? 1 : 0, 12);
    // The hinge housing on the console's flank and the gate with a lit scale against its travel.
    K.obox(cl.pivot, [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.03, 0.05, 0.035, 'dash', 0.05, T.carbon);
    for (let i = 0; i <= 4; i++) {
      const a = (6 + i * 5) * DEG, p = add(cl.pivot, [0.04, Math.cos(a) * 0.3, Math.sin(a) * 0.3]);
      const here = lit && Math.abs(i / 4 - R.thr) < 0.13;
      K.box(p[0] - 0.002, p[1] - 0.008, p[2] - 0.002, p[0] + 0.006, p[1] + 0.008, p[2] + 0.002, 'dash', 0.2, here ? T.glow : T.glowDim, here ? 1 : 0.4);
    }
    K.rod(cl.pivot, cl.end, 0.016, 'dash', 0.1, T.metal, 0, 8);
    K.rod(add(cl.pivot, mul(cl.dir, 0.18)), add(cl.pivot, mul(cl.dir, 0.21)), 0.022, 'dash', 0.1, T.carbon, 0, 8);
    const g0 = add(cl.end, mul(cl.dir, -0.1));
    K.rod(g0, cl.end, 0.022, 'dash', 0.05, T.grip, 0, 10);
    const box = add(cl.end, mul(cl.dir, 0.035)), up = norm(cross([1, 0, 0], cl.dir));
    K.obox(box, [1, 0, 0], cl.dir, up, 0.03, 0.035, 0.028, 'dash', 0.1, T.carbon);
    // The grip's light ring eases on with the hand; a lamp on the head shows the landing light.
    K.torus(add(cl.end, mul(cl.dir, -0.1)), [1, 0, 0], up, 0.024, 0.003, 14, 'dash', 0.2, al.rgb, lit ? 0.4 + 0.6 * near : 0);
    K.obox(add(box, mul(up, 0.03)), [1, 0, 0], cl.dir, up, 0.008, 0.008, 0.003, 'dash', 0.3, R.land && lit ? [255, 236, 190] : [60, 60, 60], R.land && lit ? 0.9 : 0);
  }

  // ── THE CYCLIC between the knees, its weapons grip leaning with the hand ──
  {
    const cy = cyclicAt(P, R), near = eased('v76:near:yoke', live && (live.hover === 'yoke' || live.press === 'yoke') ? 1 : 0, 12);
    K.obox([cy.base[0], cy.base[1], zF + 0.02], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.08, 0.08, 0.02, 'dash', 0.0, T.carbon);
    const bootTop = add(cy.base, mul(cy.dir, 0.12));
    K.rod([cy.base[0], cy.base[1], zF + 0.04], bootTop, 0.04, 'dash', 0, T.grip, 0, 10);
    K.torus(add(cy.base, [0, 0, 0.0]), [1, 0, 0], [0, 1, 0], 0.05, 0.004, 18, 'dash', 0.2, al.rgb, lit ? 0.5 + 0.5 * near : 0);
    K.rod(bootTop, cy.top, 0.013, 'dash', 0.1, T.metal, 0, 8);
    const gTop = add(cy.top, mul(cy.dir, 0.13)), fw = norm(cross([1, 0, 0], cy.dir));
    K.rod(cy.top, gTop, 0.022, 'dash', 0.05, T.grip, 0, 10);
    // The trigger, red while the master arm is on; its guard; the hats on top.
    K.obox(add(add(cy.top, mul(cy.dir, 0.06)), mul(fw, 0.028)), [1, 0, 0], cy.dir, fw, 0.007, 0.014, 0.008, 'dash', 0.2, R.armed && lit ? T.red : T.tub, R.armed && lit ? 0.7 : 0);
    K.rod(add(add(cy.top, mul(cy.dir, 0.03)), mul(fw, 0.022)), add(add(cy.top, mul(cy.dir, 0.095)), mul(fw, 0.034)), 0.003, 'dash', 0.1, T.tub, 0, 4);
    K.obox(add(gTop, mul(cy.dir, 0.008)), [1, 0, 0], fw, cy.dir, 0.024, 0.02, 0.012, 'dash', 0.1, T.carbonLt);
    for (const [s, rgb] of [[-0.012, T.tub], [0.012, T.metal]]) K.obox(add(gTop, add(mul(cy.dir, 0.022), [s, 0, 0])), [1, 0, 0], fw, cy.dir, 0.006, 0.006, 0.005, 'dash', 0.2, rgb);
    K.obox(add(gTop, mul(cy.dir, 0.024)), [1, 0, 0], fw, cy.dir, 0.004, 0.004, 0.002, 'dash', 0.3, T.glow, lit ? 0.5 + 0.5 * near : 0);
  }

  // ── THE PEDALS: two plates sliding on rails, one forward as the other comes back ──
  for (const [dx, sgn] of [[-PED.x, -1], [PED.x, 1]]) {
    const slide = clamp(R.rud * sgn, -1, 1) * 0.05, pz = zF + PED.z;
    K.box(dx - 0.012, PED.y - 0.12, zF, dx + 0.012, PED.y + 0.12, zF + 0.02, 'dash', 0.1, T.metal);
    const c = [dx, PED.y + slide, pz];
    K.obox(c, [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.045, 0.1, 0.008, 'dash', 0.05, T.carbon);
    K.obox(add(c, mul(norm([0, -0.89, -0.45]), -0.009)), [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.038, 0.088, 0.002, 'dash', 0.1, T.grip);
    K.obox(add(c, mul(norm([0, -0.89, -0.45]), -0.012)), [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.004, 0.07, 0.001, 'dash', 0.2, al.rgb, lit ? 0.3 + 0.7 * clamp(R.rud * sgn, 0, 1) : 0);
    K.rod(add(c, [0, 0, -0.06]), [dx, PED.y + slide, zF + 0.02], 0.012, 'dash', 0.2, T.metal, 0, 6);
    contactShadow(K, [dx, PED.y + slide, zF], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.05, 0.11);
  }
  // The other seat's pedals, slaved to yours as a dual-control deck's are.
  for (const [dx, sgn] of [[2 * xC - PED.x, -1], [2 * xC + PED.x, 1]]) {
    const slide = clamp(R.rud * sgn, -1, 1) * 0.05;
    K.box(dx - 0.012, PED.y - 0.12, zF, dx + 0.012, PED.y + 0.12, zF + 0.02, 'dash', 0.1, T.metal);
    K.obox([dx, PED.y + slide, zF + PED.z], [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.045, 0.1, 0.008, 'dash', 0.05, T.carbon);
    K.rod([dx, PED.y + slide, zF + PED.z - 0.06], [dx, PED.y + slide, zF + 0.02], 0.012, 'dash', 0.2, T.metal, 0, 6);
  }

  // ── OVERHEAD: a light bar down the roof's spine, lit with the cabin circuit ──
  {
    const D = P.vp76;
    const a = D.toShell(vp76Point(0.36, 90, -(D.inset + 0.006 / D.m))), b = D.toShell(vp76Point(0.53, 90, -(D.inset + 0.006 / D.m)));
    K.rod(a, b, 0.008, 'hdr', 0.2, al.rgb, (R.dome && lit ? 1 : 0.35) * Math.max(amb, 0.2) * (lit ? al.k : 1), 6);
    const dome = add(mul(add(a, b), 0.5), [0, 0, -0.02]);
    K.rod(add(dome, [0, 0, -0.01]), add(dome, [0, 0, 0.015]), 0.05, 'hdr', 0.1, R.dome && lit ? [240, 252, 248] : [70, 74, 74], R.dome && lit ? 1 : 0, 14);
  }

  hotspotHalo(K, vp76Hotspots(P, live), live);
}

// ── THE HOLOGRAM: the Viper 2076 in miniature, 20 cm across the proprotors ──
// Her hull as section rings and a keel line, the wing across her back, the two nacelles with their
// pylons, the three-blade proprotors turning on the rotor phase and ringed at their speed, the
// V-tail, the stub wings, and the drones round her in their box as far out as they are.
const HSC = 0.1;
function holoViper(K, c, R, out) {
  const H = holoFrame(K, c, R.pitch, R.bank);
  const s = HSC, on = R.powered && R.rpm > 0.02, frac = clamp(R.rpm / 1.05, 0, 1);
  const P = (f, g, h) => [g * s, (f + 0.07) * s, (h - 0.12) * s];
  for (const st of [0.8, 0.62, 0.38, 0.02, -0.4, -0.8]) {
    const S = vp76Section(st), pts = [];
    for (let i = 0; i <= 14; i++) { const p = vp76Point(st, i * 360 / 14); pts.push(P(p[0], p[1], p[2])); }
    for (let i = 0; i < 14; i++) H.line(pts[i], pts[i + 1], 0.0007);
    void S;
  }
  for (const a of [90, -90, 0, 180]) {
    const fs = [0.875, 0.8, 0.62, 0.38, 0.02, -0.4, -0.8, -1.01];
    for (let i = 0; i + 1 < fs.length; i++) { const p = vp76Point(fs[i], a), q = vp76Point(fs[i + 1], a); H.line(P(...p), P(...q), 0.0007); }
  }
  // The windscreen, filled.
  H.plate([P(...vp76Point(0.79, 30)), P(...vp76Point(0.79, 150)), P(...vp76Point(0.56, 150)), P(...vp76Point(0.56, 30))], HOLO, 0.5);
  // The wing, as a filled plate tip to tip.
  const N = VP76_NACELLE, wh = N.hWing + 0.02;
  H.plate([P(0.12, -N.g, wh), P(0.12, N.g, wh), P(-0.14, N.g, wh), P(-0.14, -N.g, wh)], HOLO, 0.45);
  // The V-tail and the stub wings.
  for (const sg of [1, -1]) {
    H.plate([P(-0.77, sg * 0.03, 0.156), P(-0.93, sg * 0.27, 0.41), P(-1.03, sg * 0.27, 0.41), P(-1.0, sg * 0.02, 0.152)], HOLO, 0.5);
    H.plate([P(0.15, sg * 0.12, -0.04), P(0.125, sg * 0.42, -0.05), P(-0.075, sg * 0.42, -0.05), P(-0.1, sg * 0.12, -0.04)], HOLO, 0.4);
  }
  // The nacelles and pylons, the pylons leaning on the conversion schedule; the proprotors.
  const lean = pylonLean(R) * DEG;
  [1, -1].forEach((sg, k) => {
    const g = sg * N.g;
    H.line(P(0.17, g, N.hWing), P(-0.27, g, N.hWing), 0.0035, HOLO_LINE, 0.8);
    const foot = P(N.f, g, N.hWing + 0.03), hub = add(foot, [0, Math.sin(lean) * (N.hRotor - N.hWing - 0.03) * s, Math.cos(lean) * (N.hRotor - N.hWing - 0.03) * s]);
    H.line(foot, hub, 0.0028, HOLO_LINE, 1);
    const rr = N.rRotor * s, U = [1, 0, 0], V = norm([0, Math.cos(lean), -Math.sin(lean)]);
    H.ring(hub, U, V, rr, 24, frac > 0.85 ? HOLO_LINE : HOLO_AMBER, on ? 1 : 0.3);
    H.plate(Array.from({ length: 16 }, (_, j) => { const t = j * TAU / 16; return add(hub, add(mul(U, Math.cos(t) * rr), mul(V, Math.sin(t) * rr))); }), HOLO, 0.35);
    for (let b = 0; b < 3; b++) {
      const t = (on ? R.phase * 2.2 * sg : 0) + b * TAU / 3 + k * 0.5;
      H.line(hub, add(hub, add(mul(U, Math.cos(t) * rr * 0.95), mul(V, Math.sin(t) * rr * 0.95))), 0.0011, HOLO_LINE, 1);
    }
  });
  // The drones: from their tubes out to their station, as far as the channel has them.
  if (out > 0.01) for (const sg of [1, -1]) VP76_ALE.posts.forEach((post, i) => {
    const M = aleMouth(i), q = [lerp(M[0], post[0], out), sg * lerp(M[1], post[1], out), lerp(M[2], post[2], out)];
    const p = P(...q), d = 0.006;
    H.line(add(p, [0, -d, 0]), add(p, [0, d, 0]), 0.0012, HOLO_LINE, 1);
    H.line(add(p, [-d * 1.1, 0, 0]), add(p, [d * 1.1, 0, 0]), 0.0011, HOLO_LINE, 1);
    if (out > 0.98) H.ring(p, [1, 0, 0], [0, 1, 0], 0.009, 8, HOLO_AMBER, 0.6);
  });
}

// ── THE PILOT'S PAGE: attitude, speed and height tapes, a heading tape, the vertical speed ──
function pfd(Pn, R) {
  Pn.attitude(0, 0.004, 0.072, R.pitch, R.bank);
  tape(Pn, -0.12, R.ias, 5, 10, 'KT');
  tape(Pn, 0.12, R.alt, 50, 100, 'FT');
  const span = 30, w = 0.11;
  Pn.rect(-w, 0.083, w, 0.101, [10, 18, 20], 0.3, 0.002);
  const h0 = Math.floor((R.hdg - span) / 5) * 5;
  for (let d = h0; d <= R.hdg + span; d += 5) {
    const u = ((d - R.hdg) / span) * w;
    if (Math.abs(u) > w - 0.002) continue;
    const big = ((d % 30) + 30) % 30 === 0;
    Pn.rect(u - 0.0008, big ? 0.084 : 0.09, u + 0.0008, 0.1, [200, 236, 226], 0.7, 0.003);
  }
  Pn.rect(-0.018, 0.082, 0.018, 0.102, T.screen, 0.2, 0.0035);
  Pn.digits(-0.015, 0.086, 0.012, String(Math.round(((R.hdg % 360) + 360) % 360)).padStart(3, '0'), T.glow);
  const vs = clamp(R.vsi / 1500, -1, 1);
  Pn.rect(0.144, -0.07, 0.15, 0.07, [20, 30, 32], 0.2, 0.002);
  if (Math.abs(vs) > 0.01) Pn.rect(0.143, Math.min(0, vs * 0.07), 0.151, Math.max(0, vs * 0.07), vs > 0 ? C.green : T.amber, 0.9, 0.003);
  if (R.stall) Pn.rect(-0.15, -0.098, 0.15, -0.09, T.red, 1, 0.003);
}
function tape(Pn, u, v, step, major, unit) {
  const hh = 0.075, w = 0.026, span = step * 6;
  Pn.rect(u - w, -hh, u + w, hh, [10, 18, 20], 0.3, 0.002);
  const v0 = Math.floor((v - span) / step) * step;
  for (let t = v0; t <= v + span; t += step) {
    if (t < 0) continue;
    const b = ((t - v) / span) * hh;
    if (Math.abs(b) > hh - 0.003) continue;
    const big = t % major === 0, side = u < 0 ? 1 : -1;
    Pn.rect(u + side * w - side * (big ? 0.012 : 0.006), b - 0.0007, u + side * w, b + 0.0007, [200, 236, 226], 0.7, 0.003);
  }
  Pn.rect(u - w - 0.003, -0.011, u + w + 0.003, 0.011, T.screen, 0.2, 0.0035);
  const s = String(Math.round(v));
  Pn.digits(u - w + 0.002, -0.007, 0.014, s.length > 5 ? s.slice(-5) : s, T.glow, false);
  Pn.text(unit, u, -hh - 0.013, 0.012, [160, 196, 190], 0.5, 0.003);
}

// ── THE MAP ──
function mapPage(Pn, R, live) {
  panelGps(Pn, 0, 0, 0.13, 0.098, live, { label: false, bezel: [8, 14, 16] });
  Pn.text('NAV', -0.1, 0.085, 0.012, [160, 196, 190], 0.5, 0.009);
  const g = live && live.gpsTo;
  if (g && Number.isFinite(g.dist)) Pn.digits(0.05, 0.078, 0.014, String(Math.min(999, Math.round(g.dist))).padStart(3, ' '), T.glow, false);
  Pn.digits(-0.02, -0.093, 0.012, String(Math.round(((R.hdg % 360) + 360) % 360)).padStart(3, '0'), [200, 236, 226], false);
}

// ── THE WEAPONS PAGE: what is selected, how much of it is left, and where it hangs ──
// The aircraft in plan, the gun under the nose and a missile rail at each stub tip, the selected
// station boxed; the gun's rounds against a full load as a bar; the missiles as pips. SAFE or ARMED
// across the top, from the master arm.
function weaponsPage(Pn, R) {
  const Gc = R.armed ? T.amber : T.glow, dim = [70, 110, 104];
  Pn.fitText(R.armed ? 'ARMED' : 'SAFE', -0.07, 0.083, 0.11, 0.014, R.armed ? T.amber : [160, 196, 190], R.armed ? 1 : 0.6, 0.003);
  Pn.text('WPN', 0.1, 0.083, 0.012, [160, 196, 190], 0.5, 0.003);
  // The plan, nose up: hull, wing, stub wings, nacelles.
  const sc = 0.07, cu = -0.065, cv = -0.01, Q = (f, g) => [cu + g * sc, cv + f * sc];
  const hull = [[0.875, 0], [0.75, 0.1], [0.5, 0.149], [0, 0.151], [-0.4, 0.117], [-0.8, 0.052], [-1.01, 0.01]];
  for (const sg of [1, -1]) for (let i = 0; i + 1 < hull.length; i++) { const a = Q(hull[i][0], sg * hull[i][1]), b = Q(hull[i + 1][0], sg * hull[i + 1][1]); Pn.spoke(a[0], a[1], Math.atan2(b[1] - a[1], b[0] - a[0]), 0, Math.hypot(b[0] - a[0], b[1] - a[1]), 0.0012, dim, 0.6, 0.003); }
  const W0 = Q(0.12, -0.8), W1 = Q(-0.14, 0.8);
  Pn.rect(W0[0], W1[1], W1[0], W0[1], [60, 100, 96], 0.6, 0.0025);
  for (const sg of [1, -1]) {
    const a = Q(0.15, sg * 0.1), b = Q(-0.1, sg * 0.42);
    Pn.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), [50, 84, 80], 0.5, 0.0026);
    const [hu, hv] = Q(0.035, sg * 0.8);
    Pn.annulus(hu, hv, 0.6 * sc - 0.001, 0.6 * sc + 0.001, [50, 84, 80], 0.5, 0.0026, 18);
  }
  // The stations.
  const gunSel = R.weapon === 'guns', mslSel = R.weapon === 'msl';
  const gp = Q(0.62, 0);
  Pn.rect(gp[0] - 0.006, gp[1] - 0.012, gp[0] + 0.006, gp[1] + 0.012, gunSel ? Gc : dim, gunSel ? 1 : 0.5, 0.004);
  if (gunSel) Pn.annulus(gp[0], gp[1], 0.017, 0.019, Gc, 1, 0.0045, 16);
  const mN = Math.max(4, R.missiles);
  for (const sg of [1, -1]) {
    const mp = Q(0.0, sg * 0.405);
    for (let k = 0; k < mN / 2; k++) {
      const filled = (sg > 0 ? k * 2 : k * 2 + 1) < R.missiles;
      Pn.rect(mp[0] - 0.003 + sg * k * 0.008, mp[1] - 0.012, mp[0] + 0.003 + sg * k * 0.008, mp[1] + 0.012, filled ? (mslSel ? Gc : T.glow) : [30, 44, 44], filled ? 0.95 : 0.3, 0.004);
    }
    if (mslSel) Pn.annulus(mp[0] + sg * 0.008, mp[1], 0.019, 0.021, Gc, 1, 0.0045, 16);
  }
  // The counts, the selected one brightest.
  const xR = 0.075;
  Pn.fitText('GUN', xR - 0.035, 0.05, 0.03, 0.012, gunSel ? Gc : [160, 196, 190], gunSel ? 1 : 0.5, 0.003);
  Pn.digits(xR - 0.012, 0.042, 0.016, String(R.ammo).padStart(4, ' '), gunSel ? Gc : dim, false);
  const af = clamp(R.ammo / GUN_LOAD, 0, 1);
  Pn.rect(xR - 0.05, 0.026, xR + 0.06, 0.033, [24, 34, 34], 0.3, 0.002);
  if (af > 0.005) Pn.rect(xR - 0.049, 0.027, xR - 0.049 + 0.108 * af, 0.032, af < 0.15 ? T.red : gunSel ? Gc : T.glow, 0.95, 0.003);
  Pn.fitText('MSL', xR - 0.035, -0.008, 0.03, 0.012, mslSel ? Gc : [160, 196, 190], mslSel ? 1 : 0.5, 0.003);
  Pn.digits(xR + 0.012, -0.016, 0.016, String(R.missiles).padStart(2, ' '), mslSel ? Gc : dim, false);
  // The trigger: FIRING while the gun runs.
  Pn.fitText(R.armed && R.firing ? 'FIRING' : R.armed ? 'HOT' : 'COLD', xR, -0.07, 0.1, 0.014, R.armed && R.firing ? T.red : R.armed ? T.amber : [120, 150, 146], R.armed ? 1 : 0.5, 0.003);
}

// ── THE EFFECTS PAGE: the eight drones, where they are and what they are doing ──
// The aircraft at the middle, nose up; each drone at its tube or its station or between, as far
// out as the channel has them; their state in words: STOWED, LAUNCH, or ON STATION. While dronesOut
// holds them at 0 the page only ever reads STOWED.
function effectsPage(Pn, R, out) {
  const sc = 0.034, cu = 0, cv = -0.012, Q = (f, g) => [cu + g * sc, cv + f * sc];
  Pn.text('ALE', -0.115, 0.083, 0.012, [160, 196, 190], 0.5, 0.003);
  const st = !R.powered ? 'OFF' : out < 0.02 ? 'STOWED' : out < 0.98 ? 'LAUNCH' : 'ON STATION';
  Pn.fitText(st, 0.045, 0.083, 0.15, 0.013, out >= 0.98 ? T.green : out > 0.02 ? T.amber : [160, 196, 190], out > 0.02 ? 1 : 0.6, 0.003);
  // The box they hold: a dashed rectangle round the aircraft.
  const bx = 2.05 * sc, by = 1.25 * sc;
  for (let i = 0; i < 12; i++) {
    const t0 = i / 12, t1 = (i + 0.5) / 12;
    Pn.rect(cu - bx + 2 * bx * t0, cv + by - 0.0008, cu - bx + 2 * bx * t1, cv + by + 0.0008, [60, 100, 96], 0.5, 0.002);
    Pn.rect(cu - bx + 2 * bx * t0, cv - by - 0.0008, cu - bx + 2 * bx * t1, cv - by + 0.0008, [60, 100, 96], 0.5, 0.002);
  }
  // The aircraft: hull, wing and the two proprotor discs turning on the rotor phase.
  Pn.rect(cu - 0.0045, cv - 1.0 * sc, cu + 0.0045, cv + 0.87 * sc, [110, 160, 152], 0.7, 0.003);
  Pn.rect(cu - 0.8 * sc, cv - 0.14 * sc, cu + 0.8 * sc, cv + 0.12 * sc, [90, 140, 132], 0.6, 0.003);
  const on = R.powered && R.rpm > 0.02;
  for (const sg of [1, -1]) {
    const [hu, hv] = Q(0.035, sg * 0.8);
    Pn.annulus(hu, hv, 0.6 * sc - 0.001, 0.6 * sc + 0.001, [50, 80, 78], 0.4, 0.0025, 18);
    for (let b = 0; b < 3; b++) Pn.spoke(hu, hv, (on ? R.phase * 2.2 * sg : 0) + b * TAU / 3, 0, 0.6 * sc, 0.0012, [170, 220, 210], 0.7, 0.0035);
  }
  // The drones.
  for (const sg of [1, -1]) VP76_ALE.posts.forEach((post, i) => {
    const M = aleMouth(i);
    const [u, v] = Q(lerp(M[0], post[0], out), sg * lerp(M[1], post[1], out));
    const [pu, pv] = Q(post[0], sg * post[1]);
    Pn.annulus(pu, pv, 0.0055, 0.0065, [50, 80, 78], 0.4, 0.0025, 10);
    const col = out >= 0.98 ? T.green : out > 0.02 ? T.amber : [90, 120, 116];
    Pn.rect(u - 0.0075, v - 0.0012, u + 0.0075, v + 0.0012, col, out > 0.02 ? 1 : 0.5, 0.004);
    Pn.rect(u - 0.0012, v - 0.005, u + 0.0012, v + 0.005, col, out > 0.02 ? 1 : 0.5, 0.004);
  });
  Pn.text('8 ON BOARD', -0.075, -0.09, 0.011, [160, 196, 190], 0.5, 0.003);
  Pn.digits(0.065, -0.096, 0.014, String(Math.round(out * 100)).padStart(3, ' '), out > 0.02 ? T.glow : [90, 120, 116], false);
}

// ── THE ENGINES: two turboshafts on one drive, torque from the collective, rotor speed, fuel ──
function enginePage(Pn, R) {
  // Torque: the lever's demand, as the Viper's own page read it (0.1 at the bottom of the lever).
  const tq = R.powered ? clamp(R.thr * 0.9 + 0.1, 0, 1.2) * Math.min(1, R.rpm / 0.9) : 0;
  const bars = [[-0.105, tq, 'TQ 1'], [-0.065, tq, 'TQ 2'], [-0.02, R.rpm, 'NR']];
  for (const [u, v, nm] of bars) {
    Pn.fitText(nm, u, 0.084, 0.036, 0.012, [160, 196, 190], 0.5, 0.003);
    Pn.rect(u - 0.011, -0.07, u + 0.011, 0.07, [14, 30, 30], 0.4, 0.002);
    const top = -0.068 + clamp(v / 1.2, 0, 1) * 0.136;
    const bad = nm === 'NR' ? (R.powered && v < 0.9) : v > 1;
    if (v > 0.005) Pn.rect(u - 0.009, -0.068, u + 0.009, top, bad ? (nm === 'NR' ? T.amber : T.red) : T.glow, 0.95, 0.003);
    Pn.rect(u - 0.013, -0.068 + 0.136 / 1.2 - 0.0008, u + 0.013, -0.068 + 0.136 / 1.2 + 0.0008, T.red, 0.8, 0.0035);
  }
  // Fuel: the percentage big, a bar, and the jet's temperature as a dial.
  Pn.text('FUEL', 0.07, 0.084, 0.012, [160, 196, 190], 0.5, 0.003);
  Pn.digits(0.035, 0.045, 0.022, String(Math.round(R.fuel * 100)).padStart(3, ' '), R.fuel < 0.15 ? T.red : T.glow, false);
  Pn.rect(0.03, 0.026, 0.115, 0.034, [24, 34, 34], 0.3, 0.002);
  Pn.rect(0.031, 0.027, 0.031 + 0.083 * R.fuel, 0.033, R.fuel < 0.15 ? T.red : R.fuel < 0.3 ? T.amber : T.glow, 0.95, 0.003);
  Pn.dial(0.072, -0.04, 0.036, R.temp, { a0: Math.PI * 1.15, sweep: Math.PI * 1.3, ticks: 6, major: 3, arcs: [[0.2, 0.7, C.green], [0.7, 0.85, C.amber]], red: 0.85 });
  Pn.text('TEMP', 0.072, -0.091, 0.012, [160, 196, 190], 0.5, 0.003);
}
