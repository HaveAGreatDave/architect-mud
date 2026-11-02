// THE LOCUST 2076'S COCKPIT: the inside of the concept crop sprayer, as geometry.
//
// The Locust 2076 is the locust class's concept body (mesh_locust_2076.json): the AT-802 fifty years
// on, after the Pyka Pelican's autonomous electric sprayers and the drone swarms that work a field's
// edges. A battery under the belly turns one big slow prop; ten spray drones ride on the wing and fly
// out in a line off each wingtip while she sprays. The aircraft can fly the whole job itself.
// Halcyon's Warm Hands Rider voids the hull cover on any flight logged without a living pilot at the
// controls, so the controls are there, they work, and the panel says politely that they are advisory.
//
// One seat on the centreline, set high behind the hopper for seeing the ground in a turn, as the
// AT-802's is. The throttle is on a swept console on the left with the flap lever at its forward end,
// a sidestick on a swept console on the right, and ahead a sculpted deck from wall to wall with one
// curved band of glass across it carrying every page, key and lamp: the charge, the spray, the flight
// page in front of the pilot, the drones and the map. The flight symbology is projected into the
// windscreen, and a hologram of the aircraft stands on the deck's shelf with her drones round her.
//
// Sources read for this file:
//   https://en.wikipedia.org/wiki/Air_Tractor_AT-802 (10.95 m long, one seat or two)
//   https://www.aopa.org/news-and-media/all-news/2021/january/pilot/future-flight-pyka-pelican
//     (Pyka's Pelican: an autonomous electric crop sprayer, battery powered, full-span flaps)
//   The cockpit fit-out here is the game's fiction; nothing above is a source for a dimension inside.
//
// ── ⚠ THE ROOM IS THE EXTERIOR'S FUSELAGE ───────────────────────────────────
//
// client/shared/cabin-locust-2076.js states the hull's stations, where its glass is and where the
// drones dock and fly; the exterior generator builds the shell, the panes and the drones from the same
// file. The wall here is the hull's own section pushed in by a wall's thickness, the windows are the
// absence of wall where the layout says glass, and the hologram's drones fly where the real ones do.
//
// ── ⚠ ONE SCALE: THE AT-802'S LENGTH OVER THE MODEL'S ───────────────────────
//
// AT802_LENGTH_M over the compiled exterior's nose-to-tail length (about 5.16 m a unit). Anything
// about a PERSON (seat, reach, a screen's size) is honest metres.
//
// ── ⚠ EVERY CONTROL IN ONE FORWARD VIEW, AND EVERY VALUE A REAL ONE ─────────
//
// The five keys (power, three lighting circuits and the spray) are glass keys on the band, the flap
// lever stands at the forward end of the left console and the map is the page you click; all of them
// are inside the forward look. The sidestick, the throttle and the pedals sit low, so each is mirrored
// in the windscreen HUD. Every number is a live value or derived from one in the open (the motor's
// draw from throttle and rpm, endurance from charge over draw, the boom's flow from airspeed); the
// hopper's level shows only when the sim sends one, and nothing looks operable that isn't.
//
// ── ⚠ ANIMATION IS LIVE STATE, NEVER A CLOCK ────────────────────────────────
//
// The prop on the charge page and in the hologram turns on `live.phase`, the drones' rotors too while
// they are out; the attitude and tapes on the flight state; the drones leave the wing on `spraying`.
// Decoration alone moves on wall time: the keys, the hand glow and the drones' flight ease through
// the kit's `eased`, which settles on the target, the pages boot on `live.powerAge`, and a warning's
// light lines breathe. Every readout is still a function of the live state.
//
// Pure apart from that easing: no camera, no DOM. `live` arrives as an argument.
import { makeKit, C, clamp, lerp, SHINY, TEXTURE } from './interior-kit.js';
import { contactShadow, hotspotHalo, panelGps, gpsHotspot, lensLamp, facingPanel, eased, pressPulse, HALO,
  bootAge, reveal, alertLight, sweep, lightLine, bandFrame, glassBand, holoFrame, holoProjector, windscreenHud,
  HOLO, HOLO_LINE, HOLO_AMBER, HOLO_RED, HUD_LINE, HUD_DIM, HUD_AMBER, HUD_RED } from './interior-cockpit-kit.js';
import { MESH_ROWS } from './vehicle-meshes.js';
import { compileMesh } from './vehicle-mesh.js';
import { LC_STATIONS, LC_APEX_AFT, LC_GLASS, LC_DOOR, LC_INSIDE, LC_DRONES, AT802_LENGTH_M, lcSection, lcPoint } from './cabin-locust-2076.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ── THE STYLE ────────────────────────────────────────────────────────────────
// Graphite and a warm sage lining, the ag-plane's green made clean, with the livery's yellow as the
// stitch on the seat and the edge of the consoles. The light that runs round the room and every
// display's normal colour is teal; amber is caution, red a warning, white the current value.
export const LOCUST76_TRIM = {
  lining: [150, 158, 146], liningDk: [104, 112, 104], headliner: [184, 188, 178],
  graphite: [38, 42, 42], graphiteLt: [58, 64, 62], tub: [24, 26, 26],
  seat: [64, 70, 64], seatDk: [44, 48, 44], bolster: [34, 38, 36], yellow: [226, 188, 44],
  glow: [110, 230, 210], glowDim: [40, 92, 84],
  floor: [44, 46, 44], floorEdge: [30, 32, 30], metal: [150, 156, 164], harness: [70, 76, 72], buckle: [176, 182, 190],
  screen: [6, 12, 14], title: [70, 190, 172], chem: [150, 214, 110],
  warn: [235, 60, 48], amber: [255, 176, 64], white: [236, 244, 240], dim: [140, 170, 166],
};
const T = LOCUST76_TRIM;
for (const k of ['lining', 'liningDk', 'headliner']) TEXTURE.set(T[k], 'paint');
for (const k of ['graphite', 'graphiteLt', 'tub']) TEXTURE.set(T[k], 'plastic');
for (const k of ['seat', 'seatDk', 'bolster']) TEXTURE.set(T[k], 'leather');
for (const k of ['floor', 'floorEdge']) TEXTURE.set(T[k], 'carpet');
for (const k of ['metal', 'buckle']) TEXTURE.set(T[k], 'brushed');
TEXTURE.set(T.harness, 'fabric');
SHINY.set(T.graphite, { spec: 0.4, pow: 28 });
SHINY.set(T.graphiteLt, { spec: 0.35, pow: 24 });
SHINY.set(T.metal, { spec: 0.7, pow: 36 });
SHINY.set(T.buckle, { spec: 0.8, pow: 40 });
SHINY.set(T.screen, { spec: 0.6, pow: 60 });

// ── THE EXTERIOR, MEASURED ──────────────────────────────────────────────────
function modelLength(doc) {
  let fMax = -Infinity, fMin = Infinity;
  for (const f of compileMesh(doc, { detail: 1 }).faces) {
    if (f.role === 'rotor') continue;
    for (const q of f.p) { if (q[0] > fMax) fMax = q[0]; if (q[0] < fMin) fMin = q[0]; }
  }
  return fMax - fMin;
}
const WALL_M = 0.035;

// ── THE PROFILE ──────────────────────────────────────────────────────────────
export function locust2076Profile(doc = MESH_ROWS.locust_2076) {
  if (!doc) return null;
  const m = AT802_LENGTH_M / modelLength(doc);
  const fE = LC_INSIDE.eyeF, hE = LC_INSIDE.floorH + LC_INSIDE.eyeOverFloorM / m;
  const X = (g) => g * m, Y = (f) => (f - fE) * m, Z = (h) => (h - hE) * m;
  const toShell = (q) => [X(q[1]), Y(q[0]), Z(q[2])];
  const inset = WALL_M / m;
  const fB = LC_INSIDE.bulkheadF, fF = LC_INSIDE.frontF, zF = Z(LC_INSIDE.floorH);
  const G = { m, X, Y, Z, toShell, inset, fB, fF, zF, fE, hE };
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
  const S = LC_GLASS.side;
  return {
    label: 'Locust 2076 cockpit',
    xCentre: 0, halfW,
    floor: z0 - 1e-6, roof: z1 + 1e-6, front: y1 + 1e-6, back: y0 - 1e-6,
    mPerUnit: m, glassAftY: Y(LC_GLASS.windscreen.f[0]),
    // The side rays go out through the middle of each side window.
    winY: [Y(S.f[0] + 0.03), Y(S.f[1] - 0.03)], winZ: [Z(lcPoint(fE, S.a[0] + 6)[2]), Z(lcPoint(fE, S.a[1] - 10)[2])],
    dashY: DASH.yMid - DASH.sag * 0.2, dashZ: DASH.z0, headerZ: Z(lcPoint(LC_GLASS.windscreen.f[0], 90)[2]), pillarW: 0.03,
    seatZ: zF + 0.27, seatHalf: 0.23, seatY: [-0.36, 0.1], backZ: 0.0,
    // Straight up from the pilot is the skylight between the roof rails.
    roofGlass: true,
    seats: 1, centrePost: 0,
    normalLit: true,
    floods: [{ p: [0, 0.6, -0.15], r: 0.55 }, { p: [0, -0.2, 0.4], r: 0.6 }],
    floodGain: 1.5, glare: 0.25,
    room: l76Shell,
    glass,
    l76: { ...G, faces: room.faces },
    hotspots(live) { return l76Hotspots(this, live); },
  };
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
// Built once per profile: lining, headliner, the windscreen frames, the bulkhead, the floor, the
// window reveals and the light that runs round the room. Nothing here moves.
function buildRoom(G) {
  const { toShell, inset, fB, fF, zF, m } = G;
  const faces = [];
  const put = (p, n, tone, k, rgb, emis) => faces.push({ p, n, tone, k, rgb, emis: emis || 0 });
  const K = makeKit((fs, tone, k, fwd, rgb, emis) => { for (const f of fs) put(f.p, f.n, tone, k, rgb, emis); }, false);
  const S = (f, aDeg, inM = 0) => toShell(lcPoint(f, aDeg, -(inset + inM / m)));
  const inward = (f, a) => {
    const d = 1e-4;
    let n = norm(cross(sub(S(f + d, a), S(f - d, a)), sub(S(f, a + d * 50), S(f, a - d * 50))));
    const c = toShell([f, 0, lcSection(f).cz]);
    if (dot(n, sub(c, S(f, a))) < 0) n = mul(n, -1);
    return n;
  };
  const aboveFloor = (poly) => clipHalf(poly, (q) => q[2] - zF);
  const W = LC_GLASS.windscreen, Sd = LC_GLASS.side, Rf = LC_GLASS.roof, Q = LC_GLASS.quarter;

  // ── THE SHELL: walked in the hull's own (f, angle), every pane cut out of it exactly (the
  // rectangles in cabin-locust-2076.js, as holes).
  const FS = [fB, -0.02, 0.0, 0.02, Q.f[1], 0.045, Sd.f[0], Rf.f[0], 0.1, 0.13, 0.16, 0.19, 0.22, Rf.f[1], Sd.f[1], W.f[0], 0.285, 0.3, 0.315, 0.33, 0.345, 0.36, 0.372, W.f[1], fF];
  const NA = 72;
  const holes = [
    [[W.f[0], W.a[0]], [W.f[1], W.a[0]], [W.f[1], W.a[1]], [W.f[0], W.a[1]]],
    [[Rf.f[0], Rf.a[0]], [Rf.f[1], Rf.a[0]], [Rf.f[1], Rf.a[1]], [Rf.f[0], Rf.a[1]]],
  ];
  for (const r of [Sd, Q]) {
    holes.push([[r.f[0], r.a[0]], [r.f[1], r.a[0]], [r.f[1], r.a[1]], [r.f[0], r.a[1]]]);
    holes.push([[r.f[0], 180 - r.a[1]], [r.f[1], 180 - r.a[1]], [r.f[1], 180 - r.a[0]], [r.f[0], 180 - r.a[0]]]);
  }
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
        if (sn > 0.9) put(poly, n, 'hdr', -0.28, T.headliner);
        else if (sn < -0.2) put(poly, n, 'pil', -0.18, T.graphite);
        else put(poly, n, 'pil', -0.12, sn > 0.35 ? T.lining : T.liningDk);
      }
    }
  }

  // ── THE REVEALS: a graphite return round every window, from the lining out to the skin, and a lit
  // seal along its inner edge.
  const reveal = (pts, cF, cA, lit = true) => {
    for (let t = 1; t < pts.length; t++) {
      const [fa, aa] = pts[t - 1], [fb, ab] = pts[t];
      const i0 = S(fa, aa), i1 = S(fb, ab), o0 = toShell(lcPoint(fa, aa, -0.004 / m)), o1 = toShell(lcPoint(fb, ab, -0.004 / m));
      const fm = (fa + fb) / 2, am = (aa + ab) / 2;
      const toC = sub(S(cF, cA), S(fm, am));
      const out = norm(sub(toShell(lcPoint(fm, am, 0)), S(fm, am)));
      const rn = norm(sub(toC, mul(out, dot(toC, out))));
      if (i0[2] > zF && i1[2] > zF) put([i0, i1, o1, o0], rn, 'pil', 0.05, T.graphite);
      if (lit && i0[2] > zF + 0.01 && i1[2] > zF + 0.01) K.rod(S(fa, aa, 0.006), S(fb, ab, 0.006), 0.0035, 'pil', 0.1, T.glowDim, 0.35, 5, false);
    }
  };
  const edge = (f0, a0, f1, a1, n) => Array.from({ length: n + 1 }, (_, i) => [lerp(f0, f1, i / n), lerp(a0, a1, i / n)]);
  const box = (r, aLo, aHi, n = 6) => [...edge(r.f[0], aLo, r.f[1], aLo, n), ...edge(r.f[1], aLo, r.f[1], aHi, n).slice(1), ...edge(r.f[1], aHi, r.f[0], aHi, n).slice(1), ...edge(r.f[0], aHi, r.f[0], aLo, n).slice(1)];
  // The windscreen's aft arch, sill to sill over the top, and its sills.
  reveal(edge(W.f[0], W.a[0], W.f[0], W.a[1], 32), W.f[0] + 0.04, 90);
  reveal(edge(W.f[0], W.a[0], W.f[1], W.a[0], 8), (W.f[0] + W.f[1]) / 2, 60, false);
  reveal(edge(W.f[0], W.a[1], W.f[1], W.a[1], 8), (W.f[0] + W.f[1]) / 2, 120, false);
  reveal(box(Rf, Rf.a[0], Rf.a[1], 6), (Rf.f[0] + Rf.f[1]) / 2, 90);
  for (const r of [Sd, Q]) for (const [aLo, aHi] of [r.a, [180 - r.a[1], 180 - r.a[0]]]) reveal(box(r, aLo, aHi), (r.f[0] + r.f[1]) / 2, (aLo + aHi) / 2);
  // The roof rails beside the skylight, inside: graphite ribs where the exterior has its rails. The
  // windscreen is one wraparound pane, as outside, with no post across it.
  for (const a of [Rf.a[0] - 1.5, Rf.a[1] + 1.5]) {
    const pts = edge(fB + 0.01, a, W.f[0] - 0.004, a, 10).map(([f, aa]) => S(f, aa, 0.004));
    for (let k = 1; k < pts.length; k++) K.rod(pts[k - 1], pts[k], 0.014, 'hdr', 0.05, T.graphite, 0, 6, false);
  }
  // The side glass's mullion at f 0.16, as the exterior has it.
  for (const s of [1, -1]) {
    const A = (a) => (s > 0 ? a : 180 - a);
    const pts = edge(0.16, A(Sd.a[0]), 0.16, A(Sd.a[1]), 6).map(([f, aa]) => S(f, aa, -0.004));
    for (let k = 1; k < pts.length; k++) K.rod(pts[k - 1], pts[k], 0.008, 'post', 0.05, T.graphite, 0, 6, false);
  }

  // ── THE WALL CARDS: an armrest, a pull and a speaker on each, the door's seam on the left ──
  for (const s of [1, -1]) {
    const A = (a) => (s > 0 ? a : 180 - a);
    const aArm = A(-12);
    const ar0 = S(0.04, aArm, 0.05), ar1 = S(0.2, aArm, 0.05);
    const along = norm(sub(ar1, ar0));
    const aUp = norm(cross(cross(along, [0, 0, 1]), along));
    K.obox(mul(add(ar0, ar1), 0.5), along, aUp, norm(cross(along, aUp)), Math.hypot(...sub(ar1, ar0)) / 2, 0.022, 0.04, 'pil', 0.05, T.graphiteLt);
    K.rod(add(ar0, [0, 0, 0.023]), add(ar1, [0, 0, 0.023]), 0.004, 'pil', 0.2, T.glow, 0.9, 5);
    const sc = S(0.1, A(-36), 0.004), sn2 = inward(0.1, A(-36)), sr = norm(cross([0, 0, 1], sn2)), su = cross(sn2, sr);
    const Sp = K.panel(add(sc, mul(sn2, 0.002)), sr, su, 'pil', 0.1);
    Sp.disc(0, 0, 0.05, T.graphite, 0, 0.001, 18);
    Sp.annulus(0, 0, 0.051, 0.056, T.glowDim, 0.5, 0.002, 18);
    for (let ring = 1; ring <= 2; ring++) for (let h = 0; h < ring * 7; h++) {
      const t = (h / (ring * 7)) * TAU, r = ring * 0.016;
      Sp.disc(Math.cos(t) * r, Math.sin(t) * r, 0.0035, T.tub, 0, 0.002, 6);
    }
  }
  // The door on the left: its seam inside, and a pull bar ahead of the armrest.
  {
    const A = (a) => 180 - a, D = LC_DOOR;
    const seam = [...edge(D.f[0], A(D.aLo), D.f[1], A(D.aLo), 10), ...edge(D.f[1], A(D.aLo), D.f[1], A(Sd.a[0] - 2), 4).slice(1)];
    for (let k = 1; k < seam.length; k++) {
      const a = S(seam[k - 1][0], seam[k - 1][1], -0.002), b = S(seam[k][0], seam[k][1], -0.002);
      if (a[2] > zF + 0.01 && b[2] > zF + 0.01) K.rod(a, b, 0.003, 'pil', 0.1, T.tub, 0, 4, false);
    }
    const p0 = S(0.21, A(-2), 0.03), p1 = S(0.245, A(-2), 0.03);
    K.rod(p0, p1, 0.01, 'pil', 0.3, T.metal, 0, 8);
    for (const [q, f] of [[p0, 0.21], [p1, 0.245]]) K.rod(q, S(f, A(-2), 0.004), 0.007, 'pil', 0.3, T.metal, 0, 6);
  }

  // ── THE BULKHEAD behind the seat: the section, shut, with the battery bay's padded access panel and
  // a lit seam round it, and a fire extinguisher on its bracket (a fixture).
  {
    const NS = 72, bpts = [];
    for (let k = 0; k <= NS; k++) bpts.push(S(fB, -90 + (k / NS) * 360));
    const bulk = aboveFloor(bpts);
    if (bulk.length >= 3) put(bulk, [0, 1, 0], 'post', -0.12, T.graphite);
    const yB = G.Y(fB);
    K.box(-0.22, yB, zF + 0.3, 0.22, yB + 0.03, zF + 1.05, 'post', -0.05, T.seatDk);
    for (let r = 1; r < 7; r++) K.box(-0.22, yB + 0.03, zF + 0.3 + r * 0.107, 0.22, yB + 0.034, zF + 0.304 + r * 0.107, 'post', -0.2, T.bolster);
    for (const [a, b] of [[[-0.23, yB + 0.035, zF + 0.29], [0.23, yB + 0.035, zF + 0.29]], [[-0.23, yB + 0.035, zF + 1.06], [0.23, yB + 0.035, zF + 1.06]],
      [[-0.23, yB + 0.035, zF + 0.29], [-0.23, yB + 0.035, zF + 1.06]], [[0.23, yB + 0.035, zF + 1.06], [0.23, yB + 0.035, zF + 0.29]]]) K.rod(a, b, 0.004, 'post', 0.2, T.glow, 0.6, 5);
    K.rod([0.29, yB + 0.07, zF + 0.16], [0.29, yB + 0.07, zF + 0.5], 0.05, 'post', 0.2, T.warn, 0.05, 12);
    K.rod([0.29, yB + 0.07, zF + 0.5], [0.29, yB + 0.07, zF + 0.56], 0.02, 'post', 0.3, T.tub, 0, 8);
    K.box(0.24, yB, zF + 0.24, 0.34, yB + 0.02, zF + 0.28, 'post', 0.1, T.metal);
  }

  // ── THE FLOOR: a dark mat from the bulkhead to under the deck, edged in light ──
  const floorHalf = (f) => {
    let prev = null;
    for (let a = -90; a <= 0; a += 1) {
      const q = lcPoint(f, a, -inset);
      if (prev && prev[2] < LC_INSIDE.floorH && q[2] >= LC_INSIDE.floorH) {
        const t = (LC_INSIDE.floorH - prev[2]) / (q[2] - prev[2]);
        return (prev[1] + (q[1] - prev[1]) * t) * m;
      }
      prev = q;
    }
    return 0;
  };
  const FF = [];
  for (let f = fB; f < fF - 1e-6; f += 0.02) FF.push(f);
  FF.push(fF);
  for (let i = 0; i < FF.length - 1; i++) {
    const f0 = FF[i], f1 = FF[i + 1], w0 = floorHalf(f0), w1 = floorHalf(f1);
    if (w0 <= 0.01 || w1 <= 0.01) continue;
    put([[-w0, G.Y(f0), zF], [w0, G.Y(f0), zF], [w1, G.Y(f1), zF], [-w1, G.Y(f1), zF]], [0, 0, 1], 'floor', -0.2, i % 5 === 4 ? T.floorEdge : T.floor);
    for (const s of [-1, 1]) K.box(s * (w0 - 0.04) - 0.006, G.Y(f0), zF + 0.001, s * (w0 - 0.04) + 0.006, G.Y(f1), zF + 0.004, 'floor', 0.2, T.glow, 0.85);
  }
  // The front wall under the windscreen: the hopper's aft face, the section at fF, shut.
  {
    const pts = [];
    for (let k = 0; k <= 72; k++) pts.push(S(fF, -90 + (k / 72) * 360));
    const wall = aboveFloor(pts);
    if (wall.length >= 3) put(wall, [0, -1, 0], 'post', -0.25, T.graphite);
  }
  return { faces };
}

// ── THE GLASS ────────────────────────────────────────────────────────────────
// The panes the renderer lays over the room as film: each window in the layout, faceted along the
// hull in (f, angle) small enough to be flat, 5 mm inside the skin and outboard of every reveal.
function buildGlass(G) {
  const { toShell, m } = G;
  const d = 0.005 / m;
  const panes = [];
  const grid = (f0, f1, a0, a1, nf, na) => {
    for (let i = 0; i < nf; i++) for (let j = 0; j < na; j++) {
      const fa = lerp(f0, f1, i / nf), fb = lerp(f0, f1, (i + 1) / nf), aa = lerp(a0, a1, j / na), ab = lerp(a0, a1, (j + 1) / na);
      panes.push([[fa, aa], [fb, aa], [fb, ab], [fa, ab]].map(([f, a]) => toShell(lcPoint(f, a, -d))));
    }
  };
  const W = LC_GLASS.windscreen, Sd = LC_GLASS.side, Rf = LC_GLASS.roof, Q = LC_GLASS.quarter;
  grid(W.f[0], W.f[1], W.a[0], W.a[1], 8, 26);
  grid(Rf.f[0], Rf.f[1], Rf.a[0], Rf.a[1], 4, 2);
  for (const r of [Sd, Q]) {
    grid(r.f[0], r.f[1], r.a[0], r.a[1], 4, 4);
    grid(r.f[0], r.f[1], 180 - r.a[1], 180 - r.a[0], 4, 4);
  }
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
function l76Shell(P, live, push, rich) {
  const D = P.l76;
  for (const f of D.faces) push(f.one || (f.one = Object.assign([{ p: f.p, n: f.n }], { stable: true })), f.tone, f.k, false, f.rgb, f.emis || 0);
  seat(P, push);
  if (rich) l76Fit(P, live, push);
}

// ── THE READINGS ─────────────────────────────────────────────────────────────
const readings = (live) => {
  const L = live || {};
  const R = {
    L,
    pitch: num(L.pitch), bank: num(L.bank), hdg: num(L.hdg),
    ias: Math.max(0, num(L.ias)), alt: Math.max(0, num(L.alt)), vsi: num(L.vsi),
    rpm: clamp(num(L.rpm), 0, 1.1), thr: clamp(num(L.throttle), 0, 1),
    fuel: clamp(num(L.fuel, 1), 0, 1), hull: clamp(num(L.hull, 1), 0, 1), temp: clamp(num(L.oilTemp, 0.5), 0, 1),
    powered: L.powered !== false,
    ail: clamp(num(L.stickX), -1, 1), elev: clamp(num(L.stickY), -1, 1), rud: clamp(num(L.rudder), -1, 1),
    flap: clamp(Math.round(num(L.flapNotch)), 0, 3),
    land: !!L.landingLight, dome: !!L.dome, hour: num(L.hour, 12),
    phase: num(L.phase), stall: !!L.stall,
    // The spray valve is open (cockpit.js sends `spraying` through a spray run). The swath guidance is
    // `courseErr`, degrees off the line. The hopper's level is shown only when the sim sends one.
    spraying: !!L.spraying, course: clamp(num(L.courseErr) / 20, -1, 1),
    hopper: Number.isFinite(+L.hopper) && L.hopper != null ? clamp(+L.hopper, 0, 1) : null,
  };
  // ⚠ THE ENERGY NUMBERS ARE DERIVED IN THE OPEN, from throttle and prop speed, never typed. The motor
  // draws up to 950 kW at full throttle and full rpm (the PT6A-67F it replaces makes about 1,000). The
  // pack holds 1,100 kWh full, so endurance is the charge left over the draw. The boom's flow is a
  // fixed application rate laid at the airspeed: 2.4 litres a minute per knot while the valve is open.
  R.on = R.powered && R.rpm > 0.02;
  R.draw = R.powered ? Math.round(950 * R.thr * Math.min(1, R.rpm)) : 0;
  R.endur = R.draw > 20 ? Math.min(999, Math.round(R.fuel * 1100 / R.draw * 60)) : null;
  R.flow = R.powered && R.spraying ? Math.round(R.ias * 2.4) : 0;
  R.psi = R.powered && R.spraying ? Math.round(24 + 30 * Math.min(1, R.rpm)) : 0;
  R.handsOn = R.powered && (Math.abs(R.ail) > 0.03 || Math.abs(R.elev) > 0.03 || Math.abs(R.rud) > 0.03);
  return R;
};
const night = (R) => R.hour < 6.5 || R.hour > 19.5;
const panelOn = (R) => R.powered && (R.L.panelLight != null ? !!R.L.panelLight : night(R));

// ── WHERE THE CONTROLS ARE ───────────────────────────────────────────────────
// One place says where each thing you can grab or click is; the drawing and the hotspots both read it.
// Shell metres, the eye at the origin on the centreline.
const STICK = { x: 0.33, y: 0.1, z: 0.52, len: 0.13 };                 // z off the floor; on the right console
const CON = { hw: 0.06, y0: -0.15, top: 0.5 };                          // the two side consoles, top off the floor
const LEVER = { x: -0.33, pivotY: 0.12, len: 0.15 };                     // the throttle, on the left console
const FLAP = { x: -0.355, y0: 0.42, y1: 0.49, riserY: 0.36, riserTop: 0.56 };   // the flap lever, UP forward, FULL aft
function stickAt(P, R) {
  const base = [STICK.x, STICK.y, P.l76.zF + STICK.z];
  const dir = norm([R.ail * 0.32, R.elev * 0.32, 1]);
  return { base, top: add(base, mul(dir, STICK.len)), dir };
}
function leverAt(P, R) {
  const pivot = [LEVER.x, LEVER.pivotY, P.l76.zF + CON.top];
  const ang = -0.6 + R.thr * 1.2;
  const dir = [0, Math.sin(ang), Math.cos(ang)];
  return { pivot, end: add(pivot, mul(dir, LEVER.len)), dir };
}
function flapKnob(P, R) {
  return [FLAP.x, lerp(FLAP.y1, FLAP.y0, R.flap / 3), P.l76.zF + FLAP.riserTop + 0.06];
}

// ── THE DECK: one sculpted wing from wall to wall, and on its face toward the pilot one band of glass ──
// The band runs across in a shallow arc centred on the seat, so it comes round toward the pilot at
// each end, and every page, key and lamp sits on it. `curve(s)` gives the band's lower edge and the
// direction forward across the deck; the deck body is swept along the same curve.
const DASH = { xL: -0.43, xR: 0.43, yMid: 0.62, sag: 0.12, w: 0.48, z0: -0.37, h: 0.25, lean: 0.4 };
function dashCurve() {
  return (s) => {
    const x = lerp(DASH.xL, DASH.xR, s), q = x / DASH.w;
    const y = DASH.yMid - DASH.sag * q * q, dy = -2 * DASH.sag * q / DASH.w;
    return { p: [x, y, DASH.z0], f: norm([-dy, 1, 0]) };
  };
}
const sOf = (x) => (x - DASH.xL) / (DASH.xR - DASH.xL);
const bandPanel = (K, x, v, lift = 0.005) => bandFrame(dashCurve(), DASH.lean).at(K, sOf(x), v, lift);

// ── THE PAGES on the band, booting in turn: the charge and the spray on the left, the flight page in
// front of the pilot, the drones and the map on the right. A flat page on the curved sheet is lifted
// clear of it at its ends.
const SCREENS = [
  { id: 'charge', x: -0.34, title: 'CHARGE', boot: 0.3 },
  { id: 'spray', x: -0.17, title: 'SPRAY', boot: 0.15 },
  { id: 'pfd', x: 0.0, title: 'FLIGHT', boot: 0 },
  { id: 'drones', x: 0.17, title: 'DRONES', boot: 0.45 },
  { id: 'map', x: 0.34, title: 'NAV', boot: 0.6 },
];
const SW = 0.08, SH = 0.063, PAGE_V = 0.133;
const screenPanel = (K, sc) => bandPanel(K, sc.x, PAGE_V, 0.012);
// The status lamps along the top of the band, over the pages.
const LAMP_X = [-0.35, -0.21, -0.07, 0.07, 0.21, 0.35], LAMP_V = 0.228;

// ── THE KEYS: five glass keys along the foot of the band: the SPRAY key under the spray page, the
// power and the three lighting circuits on the right, clear of the flap lever ──
const BTN = { ids: ['master', 'land', 'panel', 'dome', 'spray'], names: { master: 'PWR', land: 'LAND', panel: 'PANEL', dome: 'CABIN', spray: 'SPRAY' } };
const BTN_AT = { master: 0.19, land: 0.25, panel: 0.31, dome: 0.37, spray: -0.19 };
const KEY_V = 0.034, KEY_H = 0.026;
const keyHalfW = (id) => (id === 'spray' ? 0.05 : KEY_H);
function switchOn(id, R) {
  if (id === 'master') return R.powered;
  if (id === 'land') return R.land;
  if (id === 'panel') return panelOn(R);
  if (id === 'dome') return R.dome && R.powered;
  if (id === 'spray') return R.spraying && R.powered;
  return R.powered;
}

// ── THE WINDSCREEN HUD: where it is projected, ahead of the pilot and inside the hull ──
const HUD = { dist: 0.72, z: 0.03, hw: 0.15, hh: 0.095 };
// ── THE HOLOGRAM: over the deck's shelf, right of the pilot's line and clear of the HUD ──
const HOLO_AT = { x: 0.18, out: 0.2, rise: 0.05, scale: 0.09 };

export function l76Hotspots(P, live) {
  const R = readings(live), K = makeKit(() => {}), out = [];
  BTN.ids.forEach((id) => out.push({ id: 'ck:' + id, p: bandPanel(K, BTN_AT[id], KEY_V).pt(0, 0, 0.01), r: id === 'spray' ? 0.04 : 0.025, kind: 'click' }));
  out.push({ id: 'ck:flaps', p: flapKnob(P, R), r: 0.035, kind: 'click' });
  out.push({ id: 'yoke', p: add(stickAt(P, R).top, [0, 0, 0.04]), r: 0.06, kind: 'yoke' });
  const lv = leverAt(P, R);
  out.push({ id: 'throttle', p: add(lv.end, mul(lv.dir, 0.03)), r: 0.04, kind: 'throttle' });
  out.push(gpsHotspot(screenPanel(K, SCREENS.find((sc) => sc.id === 'map')), 0, -0.008, 0.055));
  return out;
}

// ── THE SEAT: a crew seat on rails, graphite shell and sage leather, a yellow stitch, five-point harness ──
function seat(P, push) {
  const K = makeKit(push, false);
  const cx = 0, h = P.seatHalf, [y0, y1] = P.seatY, sz = P.seatZ, zF = P.l76.zF;
  for (const s of [-1, 1]) K.box(cx + s * 0.15 - 0.015, y0 - 0.05, zF, cx + s * 0.15 + 0.015, y1 + 0.1, zF + 0.03, 'seat', 0.1, T.metal);
  K.box(cx - 0.12, y0 + 0.06, zF + 0.03, cx + 0.12, y1 - 0.1, sz - 0.12, 'seat', -0.25, T.graphite);
  K.box(cx - h, y0, sz - 0.12, cx + h, y1, sz - 0.06, 'seat', 0.0, T.graphite);
  K.box(cx - h + 0.05, y0 + 0.02, sz - 0.06, cx + h - 0.05, y1 - 0.02, sz, 'seat', 0.08, T.seat);
  for (const s of [-1, 1]) {
    K.box(cx + s * h - s * 0.05, y0, sz - 0.06, cx + s * h, y1, sz + 0.06, 'seat', 0.05, T.bolster);
    K.box(cx + s * (h - 0.025) - 0.003, y0 + 0.02, sz + 0.06, cx + s * (h - 0.025) + 0.003, y1 - 0.02, sz + 0.064, 'seat', 0.2, T.yellow, 0.2);
  }
  for (let i = 1; i < 5; i++) {
    const y = lerp(y0 + 0.02, y1 - 0.02, i / 5);
    K.box(cx - h + 0.06, y - 0.003, sz + 0.0005, cx + h - 0.06, y + 0.003, sz + 0.002, 'seat', -0.3, T.seatDk);
  }
  for (let i = 0; i < 8; i++) for (let j = 0; j < 6; j++) {
    const y = lerp(y0 + 0.05, y1 - 0.05, i / 7), x = cx + lerp(-h + 0.09, h - 0.09, j / 5);
    K.box(x - 0.0035, y - 0.0035, sz + 0.0005, x + 0.0035, y + 0.0035, sz + 0.0018, 'seat', -0.3, T.seatDk);
  }
  const lean = 0.2, bb = [cx, y0 - 0.01, sz], up = [0, -Math.sin(lean), Math.cos(lean)], fw = [0, Math.cos(lean), Math.sin(lean)];
  const bH = 0.6;
  const bc = add(bb, mul(up, bH / 2));
  K.obox(add(bc, mul(fw, -0.06)), [1, 0, 0], up, fw, h, bH / 2, 0.04, 'seat', -0.06, T.graphite);
  K.obox(add(bc, mul(fw, -0.015)), [1, 0, 0], up, fw, h - 0.06, bH / 2 - 0.04, 0.012, 'seat', 0.0, T.seat);
  for (const s of [-1, 1]) K.obox(add(add(bc, mul(fw, -0.005)), [s * (h - 0.03), 0, 0]), [1, 0, 0], up, fw, 0.03, bH / 2, 0.04, 'seat', 0.0, T.bolster);
  for (let i = 1; i < 5; i++) K.obox(add(add(bb, mul(up, bH * i / 5)), mul(fw, -0.002)), [1, 0, 0], up, fw, h - 0.07, 0.003, 0.012, 'seat', -0.3, T.seatDk);
  const hc = add(bb, mul(up, bH + 0.1));
  K.obox(add(hc, mul(fw, -0.04)), [1, 0, 0], up, fw, 0.12, 0.09, 0.05, 'seat', 0.0, T.graphite);
  K.obox(add(hc, mul(fw, 0.012)), [1, 0, 0], up, fw, 0.09, 0.065, 0.008, 'seat', 0.0, T.seat);
  K.obox(add(add(bb, mul(up, bH * 0.9)), mul(fw, -0.002)), [1, 0, 0], up, fw, h - 0.07, 0.004, 0.012, 'seat', 0.2, T.yellow, 0.3);
  const top = add(bb, mul(up, bH - 0.01)), buck = [cx, y1 - 0.16, sz + 0.14];
  for (const s of [-1, 1]) {
    K.rod(add(add(top, mul(fw, 0.03)), [s * 0.06, 0, 0]), add(buck, [s * 0.025, 0, 0.03]), 0.012, 'seat', 0.05, T.harness, 0, 4);
    K.rod([cx + s * (h - 0.04), y0 + 0.08, sz + 0.03], add(buck, [s * 0.025, 0, -0.01]), 0.012, 'seat', 0.05, T.harness, 0, 4);
  }
  K.rod([cx, y1 - 0.04, sz + 0.005], add(buck, [0, 0, -0.02]), 0.01, 'seat', 0.05, T.harness, 0, 4);
  K.rod(add(buck, [0, -0.008, 0]), add(buck, [0, 0.01, 0]), 0.034, 'seat', 0.3, T.buckle, 0, 12);
}

// ── THE FIT-OUT ──────────────────────────────────────────────────────────────
export function l76Fit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live);
  const zF = P.l76.zF;
  const lit = R.powered, panel = panelOn(R);
  const amb = lit ? (night(R) ? 1 : 0.55) * (R.dome ? 1.2 : 1) : 0.05;
  const boot = bootAge(live);
  // The light lines carry the alert: teal, amber on a low charge, red and breathing on a hull or stall
  // warning. They are the first thing in the room to change colour.
  const warn = lit && (R.hull < 0.3 || R.stall), caution = lit && R.fuel < 0.15;
  const al = alertLight(caution, warn), lineK = (k) => (lit ? k * al.k : 0.05);
  // How near the hand is to a control: eased up while the pointer is over it or pressing it.
  const near = (key, ids) => eased('l76:near:' + key, live && ids.some((id) => live.hover === id || live.press === id) ? 1 : 0, 12);
  // How far out the drones are: eased toward the valve's state, so the hologram and the drone page fly
  // them out and home again rather than jumping. It reads `spraying` and nothing else.
  const out = eased('l76:drones', R.spraying && R.powered ? 1 : 0, 3);

  // ── THE DECK: a wing swept along the band's curve ──
  const curve = dashCurve();
  const gt = [DASH.h * DASH.lean / Math.hypot(1, DASH.lean), DASH.h / Math.hypot(1, DASH.lean)];
  // The section, from the glass's foot up its face, under a brow that hoods the glass's top edge, over
  // the shelf, down the nose and back under to the lip. 4 mm in behind the glass.
  const g0 = 0.004;
  const SEC = [[g0, 0], [gt[0] + g0, gt[1]], [0.1, gt[1] + 0.02], [0.115, gt[1] + 0.032], [0.22, 0.262], [0.34, 0.255], [0.4, 0.2],
    [0.35, -0.02], [0.2, -0.1], [0.04, -0.12], [-0.05, -0.08], [-0.06, -0.03], [g0, 0]];
  const N = 32, rings = [];
  for (let i = 0; i <= N; i++) {
    // Toward each wall the wing thins and drops, as the hull closes in over it.
    const s = i / N, c = curve(s), e = Math.abs(2 * s - 1) ** 3, tap = 1 - 0.72 * e;
    rings.push(SEC.map(([f, z]) => {
      const ff = f > gt[0] + g0 ? gt[0] + g0 + (f - gt[0] - g0) * tap : f < 0 ? f * tap : f;
      return [c.p[0] + c.f[0] * ff, c.p[1] + c.f[1] * ff, c.p[2] + (z > gt[1] ? gt[1] + (z - gt[1]) * tap : z) - (z > 0.05 ? 0.05 * e : 0)];
    }));
  }
  sweep(K, rings, 'dash', 0.1, T.graphite);
  for (const r of [rings[0], rings[N]]) {
    const pts = r.slice(0, -1), mid = mul(pts.reduce((a, q) => add(a, q), [0, 0, 0]), 1 / pts.length);
    const n = norm(cross(sub(r[5], r[1]), sub(r[8], r[1])));
    for (let j = 0; j < pts.length; j++) {
      const tri = [mid, pts[j], pts[(j + 1) % pts.length]];
      K.face(tri, n, 'dash', 0.05, T.graphiteLt);
      K.face(tri.slice().reverse(), mul(n, -1), 'dash', 0.05, T.graphiteLt);
    }
  }
  // A soft-touch strip along the shelf, light lines along the brow, the lip under the glass and the
  // shelf's far edge, and a seam where the nose turns under.
  for (let i = 2; i < N - 2; i++) {
    const a = rings[i], b = rings[i + 1], lift = [0, 0, 0.003];
    const q = [add(a[4], lift), add(b[4], lift), add(lerp3(b[4], b[5], 0.85), lift), add(lerp3(a[4], a[5], 0.85), lift)];
    K.face(q, norm(cross(sub(q[1], q[0]), sub(q[3], q[0]))), 'dash', 0.15, T.tub);
  }
  lightLine(K, rings.slice(1, -1).map((r) => add(r[2], [0, 0, -0.002])), 0.0025, al.rgb, lineK(0.9));
  lightLine(K, rings.map((r) => r[9]), 0.003, al.rgb, lineK(0.8));
  lightLine(K, rings.slice(2, -2).map((r) => add(r[5], [0, 0, 0.002])), 0.002, al.rgb, lineK(0.35));
  lightLine(K, rings.slice(1, -1).map((r) => r[7]), 0.002, T.tub, 0);

  // ── THE BAND: one sheet of glass, the pages on it, booting in turn when the power comes on ──
  glassBand(K, curve, { h: DASH.h, lean: DASH.lean, segs: 32, lit, light: al.rgb, lightK: lineK(1), substrate: T.screen });
  for (const sc of SCREENS) {
    const Pn = screenPanel(K, sc), up = reveal(boot, sc.boot);
    if (!lit || up <= 0) continue;
    if (up < 1) {
      const y = lerp(-SH, SH, up);
      Pn.rect(-SW, -SH, SW, y, T.screen, 0.3 * up, 0.001);
      Pn.rect(-SW, y - 0.0015, SW, y + 0.0015, T.glow, 1, 0.0025);
      continue;
    }
    // One display language on every page: a lit edge along the top and the page's name under it.
    Pn.rect(-SW, -SH, SW, SH, T.screen, 0.3, 0.0005);
    Pn.rect(-SW + 0.003, SH - 0.003, SW - 0.003, SH - 0.0012, T.glow, 0.85, 0.0018);
    Pn.fitText(sc.title, 0, SH - 0.0135, SW * 1.3, 0.009, T.title, panel ? 0.9 : 0.7, 0.0026);
    if (sc.id === 'pfd') pfd(Pn, R);
    else if (sc.id === 'charge') chargePage(Pn, R);
    else if (sc.id === 'spray') sprayPage(Pn, R);
    else if (sc.id === 'drones') dronesPage(Pn, R, out);
    else if (sc.id === 'map') mapPage(Pn, R, live);
  }
  // The status lamps along the top of the band: what the aircraft thinks of you.
  {
    // ⚠ PILOT PRESENT IS THE RIDER'S LAMP: lit whenever the seat is powered and occupied, which is
    // whenever this cockpit is drawn. It is the one thing on the panel the insurer reads.
    const lamps = [
      ['PILOT PRESENT', lit, C.green], ['HANDS ON', R.handsOn, T.glow], ['ADVISORY', lit, T.amber],
      ['LOW CHARGE', caution, T.warn], ['STALL', lit && R.stall, T.warn], ['HULL', lit && R.hull < 0.3, T.warn],
    ];
    const up = reveal(boot, 0.75) >= 1;
    lamps.forEach(([name, on, rgb], i) => lensLamp(bandPanel(K, LAMP_X[i], LAMP_V, 0.012), 0, 0, 0.125, 0.022, on && up, rgb, name));
  }

  // ── THE KEYS: five glass keys on the band ──
  // A key sinks while pressed and comes back, its light eases on and off with the circuit, it
  // brightens as the hand comes over it, and a ring flashes round it when its state changes. The SPRAY
  // key is wider, lettered in the chemical's green, and lit while the valve is open.
  BTN.ids.forEach((id) => {
    const Kp = bandPanel(K, BTN_AT[id], KEY_V, 0.006), on = switchOn(id, R);
    const pressed = !!live && live.press === 'ck:' + id;
    const rgb = id === 'master' ? C.green : id === 'spray' ? T.chem : T.glow;
    const glow = eased('l76:glow:' + id, on ? 1 : 0, 10), depth = eased('l76:dip:' + id, pressed ? 0.002 : 0.007, 30);
    const hand = near('key:' + id, ['ck:' + id]);
    const hw = keyHalfW(id);
    Kp.rect(-hw - 0.002, -KEY_H - 0.002, hw + 0.002, KEY_H + 0.002, T.tub, 0, 0.0005);
    for (const [a, b, c, d] of [[-hw, KEY_H, hw, KEY_H + 0.002], [-hw, -KEY_H - 0.002, hw, -KEY_H], [-hw - 0.002, -KEY_H, -hw, KEY_H], [hw, -KEY_H, hw + 0.002, KEY_H]]) Kp.rect(a, b, c, d, T.glow, (lit ? 0.25 : 0) + hand * 0.75, 0.0012);
    Kp.stud(0, 0, hw - 0.003, KEY_H - 0.003, depth, rgb.map((c, k) => lerp([40, 46, 50][k], c, glow * 0.8)), glow * 0.85 + hand * 0.15, 0.0015);
    Kp.fitText(BTN.names[id], 0, -0.004, hw * 1.6, 0.011, glow > 0.5 ? [10, 24, 22] : [214, 222, 220], glow > 0.5 ? 0 : (panel ? 0.6 : 0.25), depth + 0.0025);
    const flash = pressPulse('l76:key:' + id, on);
    if (flash > 0.02) for (const [a, b, c, d] of [[-hw - 0.006, KEY_H + 0.004, hw + 0.006, KEY_H + 0.007], [-hw - 0.006, -KEY_H - 0.007, hw + 0.006, -KEY_H - 0.004]]) Kp.rect(a, b, c, d, HALO, flash, 0.004);
  });

  // ── THE WINDSCREEN HUD: projected, conformal, with the throttle, the stick, the pedals and the flaps
  // mirrored round its edges, so the forward view shows every low control ──
  if (lit) {
    const life = reveal(boot, 0.2);
    const Hp = windscreenHud(K, R, { ...HUD, warn, caution, boot: life, mirrors: { stick: [R.ail, R.elev], thrs: [R.thr], rud: R.rud } });
    if (life > 0) {
      hudFlaps(Hp, R, warn ? HUD_RED : caution ? HUD_AMBER : HUD_LINE);
      // While the valve is open the swath bar comes up under the flight path marker: a line with the
      // lit tick walking along it with the guidance.
      if (R.spraying) {
        const y = -HUD.hh * 0.42, col = warn ? HUD_RED : caution ? HUD_AMBER : HUD_LINE;
        for (let i = -3; i <= 3; i++) if (i) Hp.rect(i * 0.012 - 0.0007, y - 0.003, i * 0.012 + 0.0007, y + 0.003, HUD_DIM, 1, 0.001);
        Hp.rect(R.course * 0.036 - 0.003, y - 0.006, R.course * 0.036 + 0.003, y + 0.006, col, 1, 0.0012);
        Hp.text('SPRAY', 0, y - 0.018, 0.009, col, 1, 0.001);
      }
    }
  }

  // ── THE HOLOGRAM over the deck's shelf: the Locust herself, flying as she flies ──
  // Pitched and banked with her, the prop turning on the prop phase and ringed at its speed, the
  // drones on the wing or out in their lines, standing on a projector whose arc is the charge left.
  {
    const c0 = curve(sOf(HOLO_AT.x)), shelf = 0.262 - 0.0;
    const base = add(add(c0.p, mul(c0.f, HOLO_AT.out)), [0, 0, shelf + 0.003]);
    holoProjector(K, base, HOLO_AT.rise, 0.05, lit ? R.fuel : 0, R.fuel < 0.15 ? HOLO_RED : R.fuel < 0.3 ? HOLO_AMBER : HOLO_LINE);
    if (lit && reveal(boot, 0.7) > 0) holoLocust(K, add(base, [0, 0, HOLO_AT.rise + 0.02]), R, out);
  }

  // ── THE SIDE CONSOLES: swept, the throttle on the left and the stick on the right ──
  for (const s of [-1, 1]) {
    const cx = s * Math.abs(LEVER.x), crings = [], pads = [];
    const yEnd = s < 0 ? FLAP.riserY : STICK.y + 0.14;
    for (let i = 0; i <= 10; i++) {
      const y = lerp(CON.y0, yEnd, i / 10);
      crings.push(roundSection(cx, y, CON.hw, zF, zF + CON.top - 0.005, 0.1));
    }
    sweep(K, crings, 'dash', 0.05, T.graphite);
    K.face(crings[0].slice(), [0, -1, 0], 'dash', 0.05, T.graphiteLt);
    K.face(crings[10].slice().reverse(), [0, 1, 0], 'dash', 0.05, T.graphiteLt);
    lightLine(K, crings.map((r) => add(r[s < 0 ? 10 : 0], [-s * 0.002, 0, 0.36])), 0.003, al.rgb, lineK(0.75));
    // The forearm pad along the top, aft of the control.
    for (let i = 0; i <= 6; i++) pads.push(roundSection(cx, lerp(CON.y0 + 0.02, (s < 0 ? LEVER.pivotY : STICK.y) - 0.09, i / 6), 0.05, zF + CON.top - 0.008, zF + CON.top + 0.014, 0.018));
    sweep(K, pads, 'dash', 0.1, T.seat);
    // The livery's yellow along the console's inboard lip.
    lightLine(K, crings.map((r) => add(r[s < 0 ? 10 : 0], [-s * 0.0015, 0, 0.3])), 0.0025, T.yellow, 0.15);
  }
  // The flap riser at the left console's fore end: it stands up to a gate whose detents are lettered.
  {
    const rr = [];
    for (let i = 0; i <= 6; i++) {
      const y = lerp(FLAP.riserY - 0.02, FLAP.y1 + 0.03, i / 6);
      rr.push(roundSection(FLAP.x, y, 0.045, zF, zF + lerp(CON.top - 0.005, FLAP.riserTop, smooth01(i / 2)), 0.06));
    }
    sweep(K, rr, 'dash', 0.05, T.graphite);
    K.face(rr[6].slice().reverse(), [0, 1, 0], 'dash', 0.05, T.graphiteLt);
    lightLine(K, rr.map((r) => add(r[5], [0, 0, 0.003])), 0.002, al.rgb, lineK(0.6));
    const rt = zF + FLAP.riserTop;
    K.box(FLAP.x - 0.008, FLAP.y0 - 0.012, rt - 0.003, FLAP.x + 0.008, FLAP.y1 + 0.012, rt + 0.005, 'dash', -0.3, T.tub);
    // The detents' names, on a strip inboard of the gate, read from the seat.
    const Fp = facingPanel(K, [FLAP.x + 0.035, (FLAP.y0 + FLAP.y1) / 2, rt + 0.01], 'dash', 0.3);
    ['UP', '1', '2', 'F'].forEach((sN, i) => {
      const v = (i - 1.5) * 0.017;
      Fp.text(sN, 0, -v - 0.005, 0.012, i === R.flap ? T.white : T.dim, i === R.flap ? 0.9 : (panel ? 0.6 : 0.3), 0.001);
    });
    const kb = flapKnob(P, R), base = [FLAP.x, kb[1], rt];
    const press = !!live && live.press === 'ck:flaps', hand = near('flaps', ['ck:flaps']);
    const dip = eased('l76:flapdip', press ? 0.008 : 0, 30);
    K.rod(base, add(kb, [0, 0, -0.012 - dip]), 0.006, 'dash', 0.2, T.metal, 0, 6);
    // The knob is an aerofoil section, the way flap levers are the world over.
    K.obox(add(kb, [0, 0, -dip]), [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.024, 0.012, 0.014, 'dash', 0.15, [214, 218, 220]);
    K.obox(add(kb, [0, 0, 0.0125 - dip]), [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.02, 0.006, 0.001, 'dash', 0.3, T.glow, lit ? 0.6 + hand * 0.4 : 0);
    K.obox(add(kb, [0, -0.0125, -dip]), [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.025, 0.003, 0.001, 'dash', 0.3, al.rgb, lit ? 0.15 + hand * 0.85 : 0);
    const flash = pressPulse('l76:flap', R.flap);
    if (flash > 0.02) facingPanel(K, kb, 'dash', 0).annulus(0, 0, 0.034, 0.039, HALO, flash, 0.003, 18);
  }
  // The throttle: a gate with a lit tick every quarter, the full tick amber, and the lever, whose grip
  // lights as the hand comes to it.
  {
    const pt = zF + CON.top;
    K.box(LEVER.x - 0.009, LEVER.pivotY - 0.13, pt - 0.003, LEVER.x + 0.009, LEVER.pivotY + 0.13, pt + 0.005, 'dash', -0.3, T.tub);
    for (let i = 0; i <= 4; i++) {
      const y = LEVER.pivotY - 0.11 + i * 0.055, here = lit && Math.abs(i / 4 - R.thr) < 0.13;
      K.box(LEVER.x + 0.014, y - 0.002, pt + 0.002, LEVER.x + 0.03, y + 0.002, pt + 0.006, 'dash', 0.2, i === 4 ? T.amber : here ? T.glow : T.glowDim, here || i === 4 ? 0.9 : 0.5);
    }
    const lv = leverAt(P, R), hand = near('thr', ['throttle']);
    K.rod(lv.pivot, lv.end, 0.009, 'dash', 0.2, T.metal, 0, 8);
    const gripEnd = add(lv.end, mul(lv.dir, 0.055)), side = norm(cross([1, 0, 0], lv.dir));
    K.obox(mul(add(lv.end, gripEnd), 0.5), [1, 0, 0], lv.dir, side, 0.022, 0.032, 0.018, 'dash', 0.1, T.graphiteLt);
    K.obox(add(gripEnd, mul(lv.dir, 0.002)), [1, 0, 0], side, lv.dir, 0.018, 0.011, 0.003, 'dash', 0.3, T.glow, lit ? 0.3 + R.thr * 0.5 + hand * 0.2 : 0);
    K.obox(add(mul(add(lv.end, gripEnd), 0.5), mul(side, 0.0185)), [1, 0, 0], lv.dir, side, 0.023, 0.004, 0.001, 'dash', 0.3, al.rgb, lit ? 0.2 + hand * 0.8 : 0);
    // The spray lamp on the grip's inboard face: lit while the valve is open (a lamp, not a switch).
    K.obox(add(mul(add(lv.end, gripEnd), 0.5), [0.0225, 0, 0]), lv.dir, side, [1, 0, 0], 0.012, 0.008, 0.001, 'dash', 0.3, R.spraying && lit ? T.chem : [40, 60, 40], R.spraying && lit ? 0.9 : 0);
  }
  // The sidestick, on the right console: its base ring lights green under a hand, the grip's cap
  // light brightens as the hand comes to it.
  {
    const st = stickAt(P, R), arm = st.base, hand = near('yoke', ['yoke']);
    K.rod(add(arm, [0, 0, -0.01]), add(arm, [0, 0, 0.012]), 0.035, 'dash', 0.1, T.tub, 0, 14);
    K.torus(add(arm, [0, 0, 0.012]), [1, 0, 0], [0, 1, 0], 0.036, 0.004, 18, 'dash', 0.2, R.handsOn ? C.green : al.rgb, lit ? 0.5 + 0.5 * hand : 0);
    K.rod(add(arm, [0, 0, 0.012]), add(arm, mul(st.dir, 0.04)), 0.022, 'dash', -0.1, T.tub, 0, 10);
    K.rod(add(arm, mul(st.dir, 0.03)), st.top, 0.011, 'dash', 0.2, T.metal, 0, 8);
    const gdir = norm(add(st.dir, [0, 0.12, 0]));
    const gTop = add(st.top, mul(gdir, 0.09));
    K.rod(st.top, gTop, 0.022, 'dash', 0.05, T.graphiteLt, 0, 12);
    K.rod(add(gTop, mul(gdir, -0.005)), add(gTop, mul(gdir, 0.008)), 0.016, 'dash', 0.2, T.graphite, 0, 12);
    K.obox(add(gTop, mul(gdir, 0.009)), [1, 0, 0], [0, 1, 0], gdir, 0.007, 0.007, 0.002, 'dash', 0.3, T.glow, lit ? 0.6 + 0.4 * hand : 0);
    K.obox(add(st.top, add(mul(gdir, 0.05), [0, 0.021, 0])), [1, 0, 0], gdir, [0, 1, 0], 0.006, 0.012, 0.005, 'dash', 0.2, T.graphite);
  }

  // ── THE PEDALS, sliding on rails, one forward as the other comes back ──
  {
    const pz = zF + 0.14, py = 0.95;
    for (const [dx, sgn] of [[-0.1, -1], [0.1, 1]]) {
      const slide = clamp(R.rud * sgn, -1, 1) * 0.05;
      K.box(dx - 0.012, py - 0.12, zF, dx + 0.012, py + 0.12, zF + 0.02, 'dash', 0.1, T.metal);
      const c = [dx, py + slide, pz];
      K.obox(c, [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.045, 0.1, 0.008, 'dash', 0.05, T.graphite);
      K.obox(add(c, mul(norm([0, -0.89, -0.45]), -0.009)), [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.038, 0.088, 0.002, 'dash', 0.1, T.tub);
      K.obox(add(c, mul(norm([0, -0.89, -0.45]), -0.012)), [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.004, 0.07, 0.001, 'dash', 0.2, al.rgb, lit ? 0.3 + 0.7 * clamp(R.rud * sgn, 0, 1) : 0);
      K.rod(add(c, [0, 0, -0.06]), [dx, py + slide, zF + 0.02], 0.012, 'dash', 0.2, T.metal, 0, 6);
      contactShadow(K, [dx, py + slide, zF], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.05, 0.11);
    }
  }

  // ── OVERHEAD: light lines down the roof rails beside the skylight, and the dome light on the left
  // rail. ⚠ NO CONTROL THE SIM DOES NOT HAVE: nothing up here to pull.
  {
    const D = P.l76, Rf = LC_GLASS.roof;
    const O = (f, a, inM) => D.toShell(lcPoint(f, a, -(D.inset + inM / D.m)));
    const ohK = (lit ? al.k : 1) * Math.max(amb, 0.2);
    for (const a of [Rf.a[0] - 4, Rf.a[1] + 4]) lightLine(K, [0.0, 0.05, 0.1, 0.15, 0.2, 0.25].map((f) => O(f, a, 0.012)), 0.004, al.rgb, ohK, 'hdr');
    const dome = O(0.03, 104, 0.02);
    K.rod(dome, add(dome, [0.012, 0, -0.01]), 0.04, 'hdr', 0.1, R.dome && lit ? [240, 252, 248] : [80, 84, 84], R.dome && lit ? 1 : 0, 14);
  }

  hotspotHalo(K, l76Hotspots(P, live), live);
}

// A console's section at `y`: a flat crown `top` high that rolls over into two vertical sides `hw`
// either side of `cx`, `drop` of the roll, down to `z0`. Eleven points, floor to floor.
function roundSection(cx, y, hw, z0, top, drop) {
  const sec = [];
  for (let j = 0; j <= 10; j++) {
    const a = Math.PI * j / 10, sa = Math.sin(a);
    const z = j === 0 || j === 10 ? z0 : Math.max(z0 + 0.005, top + 0.004 * sa - (1 - sa) * (1 - sa) * drop);
    sec.push([cx - Math.cos(a) * hw, y, z]);
  }
  return sec;
}
const smooth01 = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ── THE HUD'S FLAPS: four detents down the right edge, the selected one lit, and its name ──
function hudFlaps(Hp, R, col) {
  const fx = HUD.hw - 0.012;
  for (let i = 0; i <= 3; i++) {
    const y = -0.028 - i * 0.011, sel = i === R.flap;
    Hp.rect(fx - (sel ? 0.008 : 0.004), y - (sel ? 0.0016 : 0.0008), fx + (sel ? 0.008 : 0.004), y + (sel ? 0.0016 : 0.0008), sel ? col : HUD_DIM, 1, 0.001);
  }
  Hp.text(['UP', '1', '2', 'F'][R.flap], fx - 0.002, -0.085, 0.01, col, 1, 0.001);
}

// ── THE HOLOGRAM: the Locust in miniature, 19 cm long ──
// Her hull as section rings and chines off the hull's own stations (cabin-locust-2076.js), the
// cockpit glass lit, the hopper's outline ahead of it, the straight wing and its flaps, the braced
// tail, the six-blade prop turning on the prop phase and ringed at its speed, and the ten drones:
// on the wing in their cradles, or out in a line off each tip with their rotors turning while she
// sprays, where LC_DRONES says the real ones fly. The frame is her pitch and bank.
const HW = [{ g: 0, le: 0.3, te: -0.22, h: -0.09 }, { g: 1.1, le: 0.3, te: -0.22, h: -0.058 }, { g: 1.14, le: 0.285, te: -0.2, h: -0.056 }];
function holoLocust(K, c, R, out) {
  const H = holoFrame(K, c, R.pitch, R.bank);
  const sc = HOLO_AT.scale;
  const M = (f, g, h) => [g * sc, (f - 0.05) * sc, h * sc];
  const P = (f, a) => { const q = lcPoint(f, a); return M(q[0], q[1], q[2]); };
  // The hull: rings at five stations and six lines nose to tail.
  const ST = [0.975, 0.86, 0.72, 0.56, 0.4, 0.28, 0.14, -0.04, -0.24, -0.45, -0.7, -0.9];
  for (const f of [0.86, 0.56, 0.22, -0.24, -0.7]) { let prev = P(f, -90); for (let i = 1; i <= 12; i++) { const q = P(f, -90 + i * 30); H.line(prev, q, 0.0005); prev = q; } }
  for (const a of [-90, -40, 0, 50, 90, 130, 180, 220]) {
    const pts = [M(1.0, 0, 0.02), ...ST.map((f) => P(f, a)), M(...LC_APEX_AFT)];
    for (let i = 0; i + 1 < pts.length; i++) H.line(pts[i], pts[i + 1], a === 90 || a === -90 ? 0.0007 : 0.0005);
  }
  // The cockpit glass, a lit plate over the windscreen and down each side.
  {
    const W = LC_GLASS.windscreen, S = LC_GLASS.side;
    for (let i = 0; i < 4; i++) {
      const a0 = lerp(W.a[0], W.a[1], i / 4), a1 = lerp(W.a[0], W.a[1], (i + 1) / 4);
      H.plate([P(W.f[1], a0), P(W.f[1], a1), P(W.f[0], a1), P(W.f[0], a0)], HOLO, 0.75);
    }
    for (const [lo, hi] of [S.a, [180 - S.a[1], 180 - S.a[0]]]) H.plate([P(S.f[1], lo), P(S.f[1], hi), P(S.f[0], hi), P(S.f[0], lo)], HOLO, 0.6);
  }
  // The hopper: its outline on the top and flanks, amber while the valve is open.
  {
    const col = R.spraying ? HOLO_AMBER : HOLO_LINE;
    for (const f of [0.41, 0.72]) { let prev = P(f, -20); for (let a = 10; a <= 200; a += 30) { const q = P(f, a); H.line(prev, q, 0.0006, col); prev = q; } }
    for (const a of [-20, 90, 200]) H.line(P(0.41, a), P(0.72, a), 0.0006, col);
  }
  // The wing, each side a plate with its edges lined; the flaps drawn down to the notch.
  const fd = R.flap / 3 * 0.05;
  for (const s of [1, -1]) {
    const le = HW.map((w) => M(w.le, s * w.g, w.h)), te = HW.map((w) => M(w.te, s * w.g, w.h));
    for (let i = 0; i + 1 < le.length; i++) {
      H.plate([le[i], le[i + 1], te[i + 1], te[i]], HOLO, 0.4);
      H.line(le[i], le[i + 1], 0.0007); H.line(te[i], te[i + 1], 0.0006);
    }
    H.line(le[le.length - 1], te[te.length - 1], 0.0006);
    H.line(M(-0.085, s * 0.1, -0.088), M(-0.085, s * 0.62, -0.075), 0.0005, HOLO);
    H.line(M(-0.22 - fd, s * 0.1, -0.09 - fd), M(-0.22 - fd, s * 0.62, -0.077 - fd), 0.0006, R.flap ? HOLO_LINE : HOLO);
    // The spray boom under the trailing edge; while the valve is open, mist falls from it.
    H.line(M(-0.255, s * 0.05, -0.14), M(-0.255, s * 1.04, -0.108), 0.0005, R.spraying ? HOLO_AMBER : HOLO);
    if (R.spraying) for (let k = 0; k < 6; k++) { const g = s * (0.15 + k * 0.17); H.line(M(-0.26, g, -0.14 + Math.abs(g) * 0.03), M(-0.36, g, -0.3), 0.0004, HOLO_AMBER, 0.6); }
  }
  // The tail: the fin and the braced tailplane.
  const fin = [M(-0.6, 0, 0.06), M(-0.94, 0, 0.06), M(-0.97, 0, 0.52), M(-0.84, 0, 0.52)];
  H.plate(fin, HOLO, 0.4);
  for (let i = 0; i < 4; i++) H.line(fin[i], fin[(i + 1) % 4], 0.0006);
  for (const s of [1, -1]) {
    const tp = [M(-0.66, 0, 0.068), M(-0.7, s * 0.4, 0.068), M(-0.9, s * 0.4, 0.068), M(-0.89, 0, 0.068)];
    H.plate(tp, HOLO, 0.4);
    H.line(tp[0], tp[1], 0.0006); H.line(tp[1], tp[2], 0.0006); H.line(tp[2], tp[3], 0.0006);
  }
  // The prop: six blades turning on the prop phase, ringed at the motor's speed.
  {
    const hub = M(1.035, 0, 0.02), rr = 0.29 * sc, frac = clamp(R.rpm / 1.05, 0, 1);
    H.ring(hub, [1, 0, 0], [0, 0, 1], rr, 14, HOLO, 0.35);
    if (frac > 0.01) H.ring(hub, [1, 0, 0], [0, 0, 1], rr * 1.12, Math.max(2, Math.round(14 * frac)), frac > 0.85 ? HOLO_LINE : HOLO_AMBER, R.on ? 1 : 0.4, Math.PI / 2, Math.PI / 2 - frac * TAU);
    for (let b = 0; b < 6; b++) {
      const t = (R.on ? R.phase * 0.75 : 0) + b * TAU / 6;
      H.line(hub, add(hub, [Math.cos(t) * rr * 0.92, 0, Math.sin(t) * rr * 0.92]), 0.0006, HOLO_LINE, R.on ? 1 : 0.5);
    }
  }
  // The drones: a cross and a ring each, on the wing, or out where they fly, rotors turning.
  const k = smooth01(out);
  for (const s of [1, -1]) LC_DRONES.g.forEach((g, i) => {
    const w = HW[0], t = g / HW[1].g, o = LC_DRONES.out(i);
    const f0 = lerp(w.le, HW[1].le, t) - LC_DRONES.x * (w.le - w.te), h0 = lerp(w.h, HW[1].h, t) + 0.03;
    const cc = M(f0 + o[0] * k, s * (g + o[1] * k), h0 + o[2] * k), a = LC_DRONES.arm * sc;
    const col = k > 0.5 ? HOLO_LINE : HOLO;
    H.line(add(cc, [-a, -a, 0]), add(cc, [a, a, 0]), 0.0005, col);
    H.line(add(cc, [-a, a, 0]), add(cc, [a, -a, 0]), 0.0005, col);
    if (k > 0.05) for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const hub = add(cc, [dx * a, dy * a, 0.0005]), th = R.phase * 3.2 * (dx * dy) + i;
      H.line(add(hub, [Math.cos(th) * a * 0.7, Math.sin(th) * a * 0.7, 0]), add(hub, [-Math.cos(th) * a * 0.7, -Math.sin(th) * a * 0.7, 0]), 0.0004, HOLO_LINE, k);
    }
  });
}

// ── THE FLIGHT PAGE: attitude, speed and height tapes, a heading tape, the vertical speed ──
const LBL = [140, 176, 170];
function pfd(Pn, R) {
  Pn.attitude(0, -0.004, 0.035, R.pitch, R.bank);
  tape(Pn, -0.054, R.ias, 5, 10, 'KT');
  tape(Pn, 0.054, R.alt, 50, 100, 'FT');
  const span = 30, w = 0.045, yb = -0.054;
  Pn.rect(-w, yb, w, yb + 0.011, [10, 18, 20], 0.3, 0.002);
  const h0 = Math.floor((R.hdg - span) / 5) * 5;
  for (let d = h0; d <= R.hdg + span; d += 5) {
    const u = ((d - R.hdg) / span) * w;
    if (Math.abs(u) > w - 0.002) continue;
    const big = ((d % 30) + 30) % 30 === 0;
    Pn.rect(u - 0.0006, yb + (big ? 0.001 : 0.005), u + 0.0006, yb + 0.011, T.glow, 0.7, 0.003);
  }
  Pn.rect(-0.016, yb - 0.002, 0.016, yb + 0.013, T.screen, 0.2, 0.0035);
  Pn.digits(-0.0135, yb, 0.011, String(Math.round(((R.hdg % 360) + 360) % 360)).padStart(3, '0'), T.white);
  const vs = clamp(R.vsi / 1500, -1, 1);
  Pn.rect(0.067, -0.035, 0.07, 0.035, [20, 30, 32], 0.2, 0.002);
  if (Math.abs(vs) > 0.01) Pn.rect(0.066, Math.min(0, vs * 0.035), 0.071, Math.max(0, vs * 0.035), vs > 0 ? T.glow : T.amber, 0.9, 0.003);
  if (R.stall) Pn.rect(-0.035, 0.03, 0.035, 0.038, T.warn, 1, 0.004);
}
function tape(Pn, u, v, step, major, unit) {
  const hh = 0.036, w = 0.014, span = step * 6;
  Pn.rect(u - w, -hh, u + w, hh, [10, 18, 20], 0.3, 0.002);
  const v0 = Math.floor((v - span) / step) * step;
  for (let t = v0; t <= v + span; t += step) {
    if (t < 0) continue;
    const b = ((t - v) / span) * hh;
    if (Math.abs(b) > hh - 0.003) continue;
    const big = t % major === 0, side = u < 0 ? 1 : -1;
    Pn.rect(u + side * w - side * (big ? 0.007 : 0.0035), b - 0.0006, u + side * w, b + 0.0006, T.glow, 0.7, 0.003);
  }
  Pn.rect(u - w - 0.002, -0.008, u + w + 0.002, 0.008, T.screen, 0.2, 0.0035);
  const s = String(Math.round(v));
  Pn.digits(u - w + 0.001, -0.0055, 0.011, s.length > 4 ? s.slice(-4) : s, T.white, false);
  Pn.text(unit, u, -hh - 0.011, 0.009, LBL, 0.5, 0.003);
}

// ── THE CHARGE PAGE: the pack, the motor's draw, the endurance at it, and the prop ──
function chargePage(Pn, R) {
  // The pack: a capsule filled to the charge left, its percentage big beside it.
  const tx = -0.052, ty0 = -0.05, ty1 = 0.03, col = R.fuel < 0.15 ? T.warn : R.fuel < 0.3 ? T.amber : T.glow;
  Pn.rect(tx - 0.013, ty0, tx + 0.013, ty1, [20, 30, 32], 0.3, 0.002);
  Pn.rect(tx - 0.01, ty0 + 0.003, tx + 0.01, lerp(ty0 + 0.003, ty1 - 0.003, R.fuel), col, 0.9, 0.003);
  Pn.rect(tx - 0.005, ty1, tx + 0.005, ty1 + 0.004, [20, 30, 32], 0.3, 0.002);
  for (let i = 1; i < 4; i++) Pn.rect(tx + 0.013, lerp(ty0, ty1, i / 4) - 0.0006, tx + 0.018, lerp(ty0, ty1, i / 4) + 0.0006, T.glowDim, 0.6, 0.003);
  Pn.digits(-0.035, 0.012, 0.016, String(Math.round(R.fuel * 100)).padStart(3, ' '), col === T.glow ? T.white : col, false);
  Pn.text('PCT', -0.012, 0.004, 0.008, LBL, 0.5, 0.003);
  // The prop: six blades on the prop phase, the rpm round it.
  const pu = 0.04, pv = 0.016, frac = clamp(R.rpm / 1.05, 0, 1);
  Pn.annulus(pu, pv, 0.0175, 0.02, [30, 44, 44], 0.3, 0.003, 16);
  if (frac > 0.01) Pn.annulus(pu, pv, 0.0175, 0.02, frac > 0.85 ? T.glow : T.amber, 0.95, 0.0035, Math.max(2, Math.round(16 * frac)), Math.PI / 2, Math.PI / 2 - frac * TAU);
  for (let b = 0; b < 6; b++) Pn.spoke(pu, pv, (R.on ? R.phase * 0.75 : 0) + b * TAU / 6, 0.002, 0.015, 0.0016, T.white, 0.85, 0.0045, 0.0007);
  Pn.disc(pu, pv, 0.0028, [200, 210, 210], 0.6, 0.005, 8);
  // The draw in kilowatts and the endurance at it in minutes; the motor's temperature as a bar.
  Pn.text('KW', -0.012, -0.018, 0.008, LBL, 0.5, 0.003);
  Pn.digits(0.002, -0.025, 0.012, String(R.draw).padStart(3, ' '), R.draw > 880 ? T.amber : T.white, false);
  Pn.text('MIN', -0.012, -0.038, 0.008, LBL, 0.5, 0.003);
  Pn.digits(0.002, -0.045, 0.012, R.endur == null ? '---' : String(R.endur).padStart(3, ' '), R.endur == null ? T.dim : T.white, false);
  const tc = R.temp > 0.85 ? T.warn : R.temp > 0.7 ? T.amber : T.glow;
  Pn.rect(0.048, -0.05, 0.054, -0.01, [20, 30, 32], 0.3, 0.002);
  if (R.on) Pn.rect(0.049, -0.049, 0.053, lerp(-0.049, -0.011, R.temp), tc, 0.9, 0.003);
  Pn.text('T', 0.062, -0.05, 0.008, LBL, 0.5, 0.003);
}

// ── THE SPRAY PAGE: the valve, the boom, the flow, the swath bar and the hopper ──
function sprayPage(Pn, R) {
  const open = R.spraying && R.powered;
  // The valve, big, in the chemical's green while it is open.
  Pn.rect(-0.066, 0.02, 0.066, 0.04, open ? [16, 48, 20] : [20, 24, 26], 0.4, 0.002);
  Pn.fitText(open ? 'VALVE OPEN' : 'VALVE SHUT', 0, 0.025, 0.12, 0.011, open ? T.chem : T.dim, open ? 0.95 : 0.5, 0.003);
  // The boom from behind: fourteen nozzles a side either side of the pump, lit while it sprays.
  const by = 0.009;
  Pn.rect(-0.066, by - 0.0008, 0.066, by + 0.0008, [70, 120, 112], 0.6, 0.003);
  for (let i = 0; i < 14; i++) for (const s of [-1, 1]) {
    const u = s * (0.006 + i * 0.0043);
    Pn.rect(u - 0.0011, by - 0.005, u + 0.0011, by - 0.001, open ? T.chem : T.glowDim, open ? 0.95 : 0.4, 0.0035);
  }
  // Pressure and flow, the values brightest.
  Pn.text('PSI', -0.05, -0.008, 0.008, LBL, 0.5, 0.003);
  Pn.digits(-0.064, -0.024, 0.012, String(R.psi).padStart(2, ' '), open ? T.white : T.dim, false);
  Pn.text('L MIN', -0.008, -0.008, 0.008, LBL, 0.5, 0.003);
  Pn.digits(-0.024, -0.024, 0.012, String(R.flow).padStart(3, ' '), open ? T.white : T.dim, false);
  // The hopper: only when the sim sends its level. A gauge that rested full would be a constant
  // dressed as a reading.
  if (R.hopper != null) {
    Pn.text('HOP', 0.05, -0.008, 0.008, LBL, 0.5, 0.003);
    Pn.rect(0.036, -0.026, 0.064, -0.016, [20, 30, 32], 0.3, 0.002);
    Pn.rect(0.037, -0.025, lerp(0.037, 0.063, R.hopper), -0.017, R.hopper < 0.1 ? T.amber : T.chem, 0.9, 0.003);
  }
  // The swath bar: fifteen segments, the lit one walking with the guidance off the line.
  for (let i = 0; i < 15; i++) {
    const u = -0.056 + i * 0.008, here = R.powered && Math.abs((i - 7) / 7 - R.course) < 0.08;
    const rgb = i === 7 ? T.glow : T.amber;
    Pn.rect(u - 0.003, -0.048, u + 0.003, -0.036, here ? (i === 7 ? T.white : rgb) : rgb.map((c) => c * 0.25), here ? 1 : 0.2, 0.0035);
  }
}

// ── THE DRONES PAGE: the wing from above, the ten cradles, and the drones in them or out in their lines ──
function dronesPage(Pn, R, out) {
  const k = smooth01(out), sx = 0.028, wy = 0.006;
  // The wing and the hull, at a scale that keeps the drones' lines on the page.
  Pn.rect(-1.14 * sx, wy - 0.0008, 1.14 * sx, wy + 0.0008, [70, 120, 112], 0.6, 0.003);
  Pn.rect(-1.14 * sx, wy - 0.0158, 1.14 * sx, wy - 0.0142, [70, 120, 112], 0.6, 0.003);
  Pn.rect(-0.0028, -0.03, 0.0028, 0.03, [70, 120, 112], 0.4, 0.003);
  for (const s of [-1, 1]) LC_DRONES.g.forEach((g, i) => {
    const o = LC_DRONES.out(i);
    // The cradle, an empty square while its drone is away.
    const cu = s * g * sx, cv = wy - 0.0075;
    Pn.rect(cu - 0.003, cv - 0.003, cu + 0.003, cv + 0.003, k > 0.5 ? T.amber : [30, 44, 44], k > 0.5 ? 0.5 : 0.3, 0.003);
    // The drone, at the cradle or out where it flies: the aft offset drawn down the page.
    const du = s * (g + o[1] * k) * sx, dv = cv + o[0] * k * sx * 1.6;
    const col = k > 0.5 ? T.white : T.glow;
    Pn.spoke(du, dv, Math.PI / 4, -0.0035, 0.0035, 0.0006, col, 0.9, 0.0045);
    Pn.spoke(du, dv, -Math.PI / 4, -0.0035, 0.0035, 0.0006, col, 0.9, 0.0045);
    if (k > 0.05) Pn.spoke(du, dv, R.phase * 3.2 + i, -0.0028, 0.0028, 0.0005, T.glow, k, 0.005);
  });
  // How many are out, and the pack they charge from while docked.
  Pn.fitText(k > 0.5 ? '10 OUT' : '10 DOCKED', -0.028, -0.04, 0.06, 0.009, k > 0.5 ? T.white : T.glow, 0.9, 0.003);
  Pn.text('PACK', 0.03, -0.034, 0.008, LBL, 0.5, 0.003);
  Pn.digits(0.022, -0.051, 0.011, String(Math.round(R.fuel * 100)).padStart(3, ' '), T.white, false);
}

// ── THE MAP: the kit's moving map, the distance to go, the heading ──
function mapPage(Pn, R, live) {
  panelGps(Pn, 0, -0.008, 0.066, 0.042, live, { label: false, bezel: [8, 14, 16] });
  const g = live && live.gpsTo;
  if (g && Number.isFinite(g.dist)) Pn.digits(0.03, 0.022, 0.01, String(Math.min(999, Math.round(g.dist))).padStart(3, ' '), T.white, false);
  Pn.digits(-0.064, 0.022, 0.01, String(Math.round(((R.hdg % 360) + 360) % 360)).padStart(3, '0'), T.white, false);
}
