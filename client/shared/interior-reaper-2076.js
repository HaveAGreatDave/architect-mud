// THE REAPER 2076'S COCKPIT: the inside of the concept gunship, as geometry.
//
// The Reaper 2076 is the gunship class's concept body (mesh_gunship_2076.json): the A-10 fifty years
// on, after the Boeing MQ-28 Ghost Bat. She is still the gun with a plane round it, and she carries
// two uncrewed wingmen docked on her wing that fly in formation off her tips while her weapons are
// armed. She can fly herself. Halcyon's Warm Hands Rider voids the hull cover on any flight logged
// without a living pilot at the controls, so the controls are there, they work, and the panel says
// politely that they are advisory.
//
// One seat in a titanium tub under a bubble, as the A-10's. Two thrust levers side by side on a swept
// console on the left with the flap lever at its forward end, a sidestick on a swept console on the
// right, and ahead a sculpted deck from wall to wall under the windscreen with one curved band of
// glass across it carrying every page, key and lamp: the gun, the engines, the flight page in front
// of the pilot, the wingmen and the map. The flight symbology is projected into the windscreen, and a
// hologram of the aircraft and her two wingmen stands on the deck's shelf.
//
// Sources read for this file:
//   https://en.wikipedia.org/wiki/Fairchild_Republic_A-10_Thunderbolt_II
//     (16.26 m long; one seat in a titanium tub; 1,174 rounds in the GAU-8's drum)
//   https://en.wikipedia.org/wiki/Boeing_MQ-28_Ghost_Bat (the loyal wingman that flies beside a crewed jet)
//   The cockpit fit-out here is the game's fiction; nothing above is a source for a dimension inside.
//
// ── ⚠ THE ROOM IS THE EXTERIOR'S FUSELAGE ───────────────────────────────────
//
// client/shared/cabin-reaper-2076.js states the hull's stations, where the canopy is and where the
// wingmen dock and fly; the exterior generator builds the shell, the glass and the wingmen from the
// same file. The wall here is the hull's own section pushed in by a wall's thickness, the canopy is
// the absence of wall where the layout says glass, and the hologram's wingmen fly where the real
// ones do.
//
// ── ⚠ ONE SCALE: THE A-10'S LENGTH OVER THE MODEL'S ─────────────────────────
//
// A10_LENGTH_M over the compiled exterior's muzzle-to-tail length (about 7.82 m a unit). Anything
// about a PERSON (seat, reach, a screen's size) is honest metres.
//
// ── ⚠ EVERY CONTROL IN ONE FORWARD VIEW, AND EVERY VALUE A REAL ONE ─────────
//
// The five keys (power, three lighting circuits and the master arm) are glass keys on the band, the
// flap lever stands at the forward end of the left console and the map is the page you click; all of
// them are inside the forward look. The sidestick, the two thrust levers and the pedals sit low, so
// each is mirrored in the windscreen HUD, the levers one mark each. Every number is a live value or
// derived from one in the open (the rounds and the barrels' turn from `ammo`, each engine's fuel flow
// from its own lever and spool, endurance from the fuel over the flow); nothing looks operable that
// isn't.
//
// ── ⚠ ANIMATION IS LIVE STATE, NEVER A CLOCK ────────────────────────────────
//
// The fans on the engine page and in the hologram turn on `live.phase`; the attitude and the tapes
// on the flight state; the wingmen leave the wing on the exterior's own `wingmen` channel when the
// view sends it, and otherwise ease toward `weaponsArmed`. Decoration alone moves on wall time: the
// keys and the hand glow ease through the kit's `eased`, the pages boot on `live.powerAge`, and a
// warning's light lines breathe. Every readout is still a function of the live state.
//
// Pure apart from that easing: no camera, no DOM. `live` arrives as an argument.
import { makeKit, C, clamp, lerp, SHINY, TEXTURE } from './interior-kit.js';
import { contactShadow, hotspotHalo, panelGps, gpsHotspot, lensLamp, facingPanel, eased, pressPulse, HALO,
  bootAge, reveal, alertLight, sweep, lightLine, bandFrame, glassBand, holoFrame, holoProjector, windscreenHud,
  HOLO, HOLO_LINE, HOLO_AMBER, HOLO_RED, HUD_LINE, HUD_DIM, HUD_AMBER, HUD_RED } from './interior-cockpit-kit.js';
import { MESH_ROWS } from './vehicle-meshes.js';
import { compileMesh } from './vehicle-mesh.js';
import { RP_APEX_AFT, RP_GLASS, RP_CANOPY, RP_INSIDE, RP_ENGINES, RP_WINGMEN, A10_LENGTH_M, rpSection, rpPoint, rpWingmanAt } from './cabin-reaper-2076.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// The GAU-8's drum holds 1,174 rounds, and that is what this one holds: the full mark on the rounds
// bar and the hologram's projector, a fact about the gun rather than a reading.
const GUN_CAP = 1174;

// ── THE STYLE ────────────────────────────────────────────────────────────────
// Gunmetal and the A-10's gull grey made dark, black consoles, an olive seat with a red stitch for the
// danger area round the gun. The light that runs round the room and every display's normal colour is
// teal; amber is caution, red a warning, white the current value.
export const REAPER76_TRIM = {
  lining: [96, 100, 100], liningDk: [70, 74, 76], headliner: [120, 124, 122],
  graphite: [34, 37, 39], graphiteLt: [54, 58, 60], tub: [22, 24, 25], ti: [104, 108, 106],
  seat: [70, 74, 56], seatDk: [50, 54, 40], bolster: [36, 38, 32], red: [186, 46, 36],
  glow: [110, 230, 210], glowDim: [40, 92, 84],
  floor: [42, 44, 44], floorEdge: [28, 30, 30], metal: [150, 156, 164], harness: [110, 112, 84], buckle: [176, 182, 190],
  screen: [6, 12, 14], title: [70, 190, 172],
  warn: [235, 60, 48], amber: [255, 176, 64], white: [236, 244, 240], dim: [140, 170, 166],
};
const T = REAPER76_TRIM;
for (const k of ['lining', 'liningDk', 'headliner']) TEXTURE.set(T[k], 'paint');
for (const k of ['graphite', 'graphiteLt', 'tub']) TEXTURE.set(T[k], 'plastic');
for (const k of ['seat', 'seatDk', 'bolster']) TEXTURE.set(T[k], 'fabric');
for (const k of ['floor', 'floorEdge']) TEXTURE.set(T[k], 'cast');
for (const k of ['metal', 'buckle']) TEXTURE.set(T[k], 'brushed');
TEXTURE.set(T.ti, 'cast'); TEXTURE.set(T.harness, 'fabric');
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
const WALL_M = 0.04;

// ── THE PROFILE ──────────────────────────────────────────────────────────────
export function reaper2076Profile(doc = MESH_ROWS.gunship_2076) {
  if (!doc) return null;
  const m = A10_LENGTH_M / modelLength(doc);
  const fE = RP_INSIDE.eyeF, hE = RP_INSIDE.eyeH;
  const X = (g) => g * m, Y = (f) => (f - fE) * m, Z = (h) => (h - hE) * m;
  const toShell = (q) => [X(q[1]), Y(q[0]), Z(q[2])];
  const inset = WALL_M / m;
  const fB = RP_INSIDE.bulkheadF, fF = RP_INSIDE.frontF, zF = Z(RP_INSIDE.floorH);
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
  const B = RP_GLASS.bubble;
  return {
    label: 'Reaper 2076 cockpit',
    xCentre: 0, halfW,
    floor: z0 - 1e-6, roof: z1 + 1e-6, front: y1 + 1e-6, back: y0 - 1e-6,
    mPerUnit: m, glassAftY: Y(B.f[0]),
    // The side rays go out through the bubble beside the seat.
    winY: [Y(fE - 0.05), Y(fE + 0.05)], winZ: [Z(rpPoint(fE, B.a[0] + 8)[2]), Z(rpPoint(fE, 60)[2])],
    dashY: DASH.yMid - DASH.sag * 0.2, dashZ: DASH.z0, headerZ: Z(rpPoint(RP_CANOPY.bowF, 90)[2]), pillarW: 0.03,
    seatZ: zF + 0.3, seatHalf: 0.23, seatY: [-0.38, 0.08], backZ: 0.0,
    // Straight up from the pilot is the bubble.
    roofGlass: true,
    seats: 1, centrePost: 0,
    normalLit: true,
    floods: [{ p: [0, 0.5, -0.2], r: 0.55 }, { p: [0, -0.2, 0.35], r: 0.6 }],
    floodGain: 1.4, glare: 0.3,
    room: r76Shell,
    glass,
    r76: { ...G, faces: room.faces },
    hotspots(live) { return r76Hotspots(this, live); },
  };
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
// Built once per profile: the tub's walls, the canopy rails and bow, the armour bulkhead, the floor,
// the reveals and the light that runs round the room. Nothing here moves.
function buildRoom(G) {
  const { toShell, inset, fB, fF, zF, m } = G;
  const faces = [];
  const put = (p, n, tone, k, rgb, emis) => faces.push({ p, n, tone, k, rgb, emis: emis || 0 });
  const K = makeKit((fs, tone, k, fwd, rgb, emis) => { for (const f of fs) put(f.p, f.n, tone, k, rgb, emis); }, false);
  const S = (f, aDeg, inM = 0) => toShell(rpPoint(f, aDeg, -(inset + inM / m)));
  const inward = (f, a) => {
    const d = 1e-4;
    let n = norm(cross(sub(S(f + d, a), S(f - d, a)), sub(S(f, a + d * 50), S(f, a - d * 50))));
    const c = toShell([f, 0, rpSection(f).cz]);
    if (dot(n, sub(c, S(f, a))) < 0) n = mul(n, -1);
    return n;
  };
  const aboveFloor = (poly) => clipHalf(poly, (q) => q[2] - zF);
  const W = RP_GLASS.windscreen, Bb = RP_GLASS.bubble;

  // ── THE SHELL: walked in the hull's own (f, angle), the canopy cut out of it exactly (the
  // rectangles in cabin-reaper-2076.js, as holes). Below the sill it is the tub's titanium wall.
  const FS = [fB, 0.4, 0.42, 0.44, 0.46, 0.48, 0.5, 0.52, 0.54, 0.56, Bb.f[1], RP_CANOPY.bowF, W.f[0], 0.6, 0.615, 0.63, 0.645, fF];
  const NA = 72;
  const holes = [
    [[W.f[0], W.a[0]], [W.f[1], W.a[0]], [W.f[1], W.a[1]], [W.f[0], W.a[1]]],
    [[Bb.f[0], Bb.a[0]], [Bb.f[1], Bb.a[0]], [Bb.f[1], Bb.a[1]], [Bb.f[0], Bb.a[1]]],
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
        // The tub's wall: bare titanium in panels below the rail, graphite low down.
        if (sn > 0.9) put(poly, n, 'hdr', -0.28, T.headliner);
        else if (sn < -0.2) put(poly, n, 'pil', -0.18, T.graphite);
        else put(poly, n, 'pil', -0.12, i % 3 === 1 ? T.ti : sn > 0.2 ? T.lining : T.liningDk);
      }
    }
  }

  // ── THE REVEALS: a graphite return round the canopy, from the lining out to the skin, and a lit
  // seal along its inner edge.
  const reveal = (pts, cF, cA, lit = true) => {
    for (let t = 1; t < pts.length; t++) {
      const [fa, aa] = pts[t - 1], [fb, ab] = pts[t];
      const i0 = S(fa, aa), i1 = S(fb, ab), o0 = toShell(rpPoint(fa, aa, -0.004 / m)), o1 = toShell(rpPoint(fb, ab, -0.004 / m));
      const fm = (fa + fb) / 2, am = (aa + ab) / 2;
      const toC = sub(S(cF, cA), S(fm, am));
      const out = norm(sub(toShell(rpPoint(fm, am, 0)), S(fm, am)));
      const rn = norm(sub(toC, mul(out, dot(toC, out))));
      if (i0[2] > zF && i1[2] > zF) put([i0, i1, o1, o0], rn, 'pil', 0.05, T.graphite);
      if (lit && i0[2] > zF + 0.01 && i1[2] > zF + 0.01) K.rod(S(fa, aa, 0.006), S(fb, ab, 0.006), 0.0035, 'pil', 0.1, T.glowDim, 0.35, 5, false);
    }
  };
  const edge = (f0, a0, f1, a1, n) => Array.from({ length: n + 1 }, (_, i) => [lerp(f0, f1, i / n), lerp(a0, a1, i / n)]);
  // The windscreen's sills and the bubble's two rails, each a reveal down the glass's edge.
  reveal(edge(W.f[0], W.a[0], W.f[1], W.a[0], 6), (W.f[0] + W.f[1]) / 2, 60, false);
  reveal(edge(W.f[0], W.a[1], W.f[1], W.a[1], 6), (W.f[0] + W.f[1]) / 2, 120, false);
  reveal(edge(fB, Bb.a[0], Bb.f[1], Bb.a[0], 14), (fB + Bb.f[1]) / 2, 60);
  reveal(edge(fB, Bb.a[1], Bb.f[1], Bb.a[1], 14), (fB + Bb.f[1]) / 2, 120);
  // The canopy bow and the windscreen's posts, inside: graphite ribs where the exterior has frames.
  {
    const bow = edge(RP_CANOPY.bowF, Bb.a[0] - 2, RP_CANOPY.bowF, Bb.a[1] + 2, 24).map(([f, a]) => S(f, a, -0.006));
    for (let k = 1; k < bow.length; k++) K.rod(bow[k - 1], bow[k], 0.02, 'post', 0.05, T.graphite, 0, 6, false);
    for (const a of W.posts) {
      const pts = edge(W.f[0], a, W.f[1], a, 6).map(([f, aa]) => S(f, aa, -0.004));
      for (let k = 1; k < pts.length; k++) K.rod(pts[k - 1], pts[k], 0.014, 'post', 0.05, T.graphite, 0, 6, false);
    }
  }

  // ── THE TUB'S WALLS: the canopy rails, inside, with the armrest and a light line along each, and
  // the bolt heads of the titanium panels in rows under them.
  for (const s of [1, -1]) {
    const A = (a) => (s > 0 ? a : 180 - a);
    const aArm = A(8);
    const ar0 = S(0.4, aArm, 0.05), ar1 = S(0.53, aArm, 0.05);
    const along = norm(sub(ar1, ar0));
    const aUp = norm(cross(cross(along, [0, 0, 1]), along));
    K.obox(mul(add(ar0, ar1), 0.5), along, aUp, norm(cross(along, aUp)), Math.hypot(...sub(ar1, ar0)) / 2, 0.022, 0.04, 'pil', 0.05, T.graphiteLt);
    K.rod(add(ar0, [0, 0, 0.023]), add(ar1, [0, 0, 0.023]), 0.004, 'pil', 0.2, T.glow, 0.9, 5);
    for (let i = 0; i <= 12; i++) {
      const f = lerp(fB + 0.01, 0.62, i / 12);
      for (const a of [-4, 14]) { const q = S(f, A(a), -0.004); if (q[2] > zF + 0.02) K.rod(q, S(f, A(a), 0.004), 0.006, 'pil', 0.3, T.metal, 0, 5, false); }
    }
    // The canopy's inside handle, ahead of the armrest.
    const p0 = S(0.55, A(20), 0.03), p1 = S(0.57, A(20), 0.03);
    K.rod(p0, p1, 0.009, 'pil', 0.3, T.metal, 0, 8);
    for (const [q, f] of [[p0, 0.55], [p1, 0.57]]) K.rod(q, S(f, A(20), 0.004), 0.006, 'pil', 0.3, T.metal, 0, 6);
  }

  // ── THE ARMOUR BULKHEAD behind the seat: the section, shut, a padded panel on it with a lit seam,
  // and the fire extinguisher on its bracket (a fixture).
  {
    const NS = 72, bpts = [];
    for (let k = 0; k <= NS; k++) bpts.push(S(fB, -90 + (k / NS) * 360));
    const bulk = aboveFloor(bpts);
    if (bulk.length >= 3) put(bulk, [0, 1, 0], 'post', -0.12, T.graphite);
    const yB = G.Y(fB);
    K.box(-0.24, yB, zF + 0.3, 0.24, yB + 0.03, zF + 1.0, 'post', -0.05, T.seatDk);
    for (let r = 1; r < 7; r++) K.box(-0.24, yB + 0.03, zF + 0.3 + r * 0.1, 0.24, yB + 0.034, zF + 0.304 + r * 0.1, 'post', -0.2, T.bolster);
    for (const [a, b] of [[[-0.25, yB + 0.035, zF + 0.29], [0.25, yB + 0.035, zF + 0.29]], [[-0.25, yB + 0.035, zF + 1.01], [0.25, yB + 0.035, zF + 1.01]],
      [[-0.25, yB + 0.035, zF + 0.29], [-0.25, yB + 0.035, zF + 1.01]], [[0.25, yB + 0.035, zF + 1.01], [0.25, yB + 0.035, zF + 0.29]]]) K.rod(a, b, 0.004, 'post', 0.2, T.glow, 0.6, 5);
    K.rod([0.33, yB + 0.07, zF + 0.16], [0.33, yB + 0.07, zF + 0.5], 0.05, 'post', 0.2, T.warn, 0.05, 12);
    K.rod([0.33, yB + 0.07, zF + 0.5], [0.33, yB + 0.07, zF + 0.56], 0.02, 'post', 0.3, T.tub, 0, 8);
    K.box(0.28, yB, zF + 0.24, 0.38, yB + 0.02, zF + 0.28, 'post', 0.1, T.metal);
  }

  // ── THE FLOOR: a cast titanium floor from the bulkhead to the front wall, edged in light ──
  const floorHalf = (f) => {
    let prev = null;
    for (let a = -90; a <= 90; a += 1) {
      const q = rpPoint(f, a, -inset);
      if (prev && prev[2] < RP_INSIDE.floorH && q[2] >= RP_INSIDE.floorH) {
        const t = (RP_INSIDE.floorH - prev[2]) / (q[2] - prev[2]);
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
  // The front wall under the windscreen: the section at fF, shut.
  {
    const pts = [];
    for (let k = 0; k <= 72; k++) pts.push(S(fF, -90 + (k / 72) * 360));
    const wall = aboveFloor(pts);
    if (wall.length >= 3) put(wall, [0, -1, 0], 'post', -0.25, T.graphite);
  }
  return { faces };
}

// ── THE GLASS ────────────────────────────────────────────────────────────────
// The panes the renderer lays over the room as film: the windscreen and the bubble, faceted along the
// hull in (f, angle) small enough to be flat, 5 mm inside the skin and outboard of every reveal.
function buildGlass(G) {
  const { toShell, m, fB } = G;
  const d = 0.005 / m;
  const panes = [];
  const grid = (f0, f1, a0, a1, nf, na) => {
    for (let i = 0; i < nf; i++) for (let j = 0; j < na; j++) {
      const fa = lerp(f0, f1, i / nf), fb = lerp(f0, f1, (i + 1) / nf), aa = lerp(a0, a1, j / na), ab = lerp(a0, a1, (j + 1) / na);
      panes.push([[fa, aa], [fb, aa], [fb, ab], [fa, ab]].map(([f, a]) => toShell(rpPoint(f, a, -d))));
    }
  };
  const W = RP_GLASS.windscreen, Bb = RP_GLASS.bubble;
  grid(W.f[0], W.f[1], W.a[0], W.a[1], 4, 24);
  grid(Math.max(fB, Bb.f[0]), Bb.f[1], Bb.a[0], Bb.a[1], 8, 28);
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
function r76Shell(P, live, push, rich) {
  const D = P.r76;
  for (const f of D.faces) push(f.one || (f.one = Object.assign([{ p: f.p, n: f.n }], { stable: true })), f.tone, f.k, false, f.rgb, f.emis || 0);
  seat(P, push);
  if (rich) r76Fit(P, live, push);
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
    // Each engine's lever and spool, left then right (cockpit.js splits them), falling back to the pair.
    thrs: [0, 1].map((e) => clamp(num(L.throttles?.[e], num(L.throttle)), 0, 1)),
    rpms: [0, 1].map((e) => clamp(num(L.rpms?.[e], num(L.rpm)), 0, 1.1)),
    split: !!L.split,
    // The weapons, as cockpit.js sends them: armed, the selection ('guns', 'msl' or 'bomb'), and the
    // rounds, missiles and bombs aboard. A view that sends no rounds shows no count.
    armed: !!L.weaponsArmed, weapon: L.weapon === 'msl' ? 'msl' : L.weapon === 'bomb' ? 'bomb' : 'gun',
    ammo: Number.isFinite(+L.ammo) && L.ammo != null ? Math.max(0, Math.round(+L.ammo)) : null,
    missiles: Math.max(0, Math.round(num(L.missiles))), bombs: Math.max(0, Math.round(num(L.bombs))),
  };
  // ⚠ THE FUEL NUMBERS ARE DERIVED IN THE OPEN, from each engine's own lever and spool, never typed.
  // Each turbofan burns up to 1,150 kg an hour at full thrust and full spool; the tanks hold 4,990 kg
  // full (the A-10's internal fuel). Endurance is the fuel left over the two engines' flow.
  R.on = [0, 1].map((e) => R.powered && R.rpms[e] > 0.02);
  R.ff = [0, 1].map((e) => (R.on[e] ? Math.round(1150 * R.thrs[e] * Math.min(1, R.rpms[e])) : 0));
  const flow = R.ff[0] + R.ff[1];
  R.endur = flow > 40 ? Math.min(999, Math.round(R.fuel * 4990 / flow * 60)) : null;
  R.handsOn = R.powered && (Math.abs(R.ail) > 0.03 || Math.abs(R.elev) > 0.03 || Math.abs(R.rud) > 0.03);
  return R;
};
const night = (R) => R.hour < 6.5 || R.hour > 19.5;
const panelOn = (R) => R.powered && (R.L.panelLight != null ? !!R.L.panelLight : night(R));
// How far out the wingmen are: the exterior's own `wingmen` channel when the view sends it (so the
// hologram and the page fly them exactly as the airframe does), otherwise eased toward the master arm.
const wingmenOut = (live, R) => (Number.isFinite(+live?.wingmen) && live.wingmen != null ? clamp(+live.wingmen, 0, 1) : eased('r76:wingmen', R.armed && R.powered ? 1 : 0, 2));

// ── WHERE THE CONTROLS ARE ───────────────────────────────────────────────────
// One place says where each thing you can grab or click is; the drawing and the hotspots both read it.
// Shell metres, the eye at the origin on the centreline.
const STICK = { x: 0.33, y: 0.08, z: 0.5, len: 0.13 };                  // z off the floor; on the right console
const CON = { hw: 0.065, y0: -0.2, top: 0.48 };                          // the two side consoles, top off the floor
const LEVER = { x: -0.33, pivotY: 0.08, len: 0.15, dx: [-0.024, 0.024] };   // the two thrust levers, left engine outboard
const FLAP = { x: -0.36, y0: 0.35, y1: 0.41, riserY: 0.29, riserTop: 0.53 };  // the flap lever, UP forward, FULL aft
function stickAt(P, R) {
  const base = [STICK.x, STICK.y, P.r76.zF + STICK.z];
  const dir = norm([R.ail * 0.32, R.elev * 0.32, 1]);
  return { base, top: add(base, mul(dir, STICK.len)), dir };
}
// Engine `e`'s lever, or with `t` given, where a lever at `t` would stand between the two slots.
function leverAt(P, R, e, t = R.thrs[e]) {
  const dx = e == null ? 0 : LEVER.dx[e];
  const pivot = [LEVER.x + dx, LEVER.pivotY, P.r76.zF + CON.top];
  const ang = -0.6 + t * 1.2;
  const dir = [0, Math.sin(ang), Math.cos(ang)];
  return { pivot, end: add(pivot, mul(dir, LEVER.len)), dir };
}
function flapKnob(P, R) {
  return [FLAP.x, lerp(FLAP.y1, FLAP.y0, R.flap / 3), P.r76.zF + FLAP.riserTop + 0.06];
}

// ── THE DECK: one sculpted wing from wall to wall under the windscreen, and on its face toward the
// pilot one band of glass. The band runs across in a shallow arc centred on the seat, so it comes
// round toward the pilot at each end, and every page, key and lamp sits on it. `curve(s)` gives the
// band's lower edge and the direction forward across the deck; the deck body is swept along it.
const DASH = { xL: -0.46, xR: 0.46, yMid: 0.5, sag: 0.11, w: 0.5, z0: -0.41, h: 0.24, lean: 0.36 };
function dashCurve() {
  return (s) => {
    const x = lerp(DASH.xL, DASH.xR, s), q = x / DASH.w;
    const y = DASH.yMid - DASH.sag * q * q, dy = -2 * DASH.sag * q / DASH.w;
    return { p: [x, y, DASH.z0], f: norm([-dy, 1, 0]) };
  };
}
const sOf = (x) => (x - DASH.xL) / (DASH.xR - DASH.xL);
const bandPanel = (K, x, v, lift = 0.005) => bandFrame(dashCurve(), DASH.lean).at(K, sOf(x), v, lift);

// ── THE PAGES on the band, booting in turn: the gun and the engines on the left, the flight page in
// front of the pilot, the wingmen and the map on the right. A flat page on the curved sheet is lifted
// clear of it at its ends.
const SCREENS = [
  { id: 'gun', x: -0.34, title: 'GUN', boot: 0.3 },
  { id: 'eng', x: -0.17, title: 'ENGINES', boot: 0.15 },
  { id: 'pfd', x: 0.0, title: 'FLIGHT', boot: 0 },
  { id: 'wingmen', x: 0.17, title: 'WINGMEN', boot: 0.45 },
  { id: 'map', x: 0.34, title: 'NAV', boot: 0.6 },
];
const SW = 0.08, SH = 0.064, PAGE_V = 0.13;
const screenPanel = (K, sc) => bandPanel(K, sc.x, PAGE_V, 0.013);
// The status lamps along the top of the band, over the pages.
const LAMP_X = [-0.35, -0.21, -0.07, 0.07, 0.21, 0.35], LAMP_V = 0.222;

// ── THE KEYS: five glass keys along the foot of the band: the master arm under the gun page, the
// power and the three lighting circuits on the right ──
const BTN = { ids: ['master', 'land', 'panel', 'dome', 'arm'], names: { master: 'PWR', land: 'LAND', panel: 'PANEL', dome: 'CABIN', arm: 'ARM' } };
const BTN_AT = { master: 0.19, land: 0.25, panel: 0.31, dome: 0.37, arm: -0.3 };
const KEY_V = 0.034, KEY_H = 0.026;
const keyHalfW = (id) => (id === 'arm' ? 0.05 : KEY_H);
function switchOn(id, R) {
  if (id === 'master') return R.powered;
  if (id === 'land') return R.land;
  if (id === 'panel') return panelOn(R);
  if (id === 'dome') return R.dome && R.powered;
  if (id === 'arm') return R.armed && R.powered;
  return R.powered;
}

// ── THE WINDSCREEN HUD: projected ahead of the pilot, inside the bubble ──
const HUD = { dist: 0.55, z: -0.01, hw: 0.14, hh: 0.085 };
// ── THE HOLOGRAM: over the deck's shelf, right of the pilot's line and clear of the HUD ──
const HOLO_AT = { x: 0.27, out: 0.16, rise: 0.045, scale: 0.068 };

export function r76Hotspots(P, live) {
  const R = readings(live), K = makeKit(() => {}), out = [];
  BTN.ids.forEach((id) => out.push({ id: 'ck:' + id, p: bandPanel(K, BTN_AT[id], KEY_V).pt(0, 0, 0.01), r: id === 'arm' ? 0.04 : 0.025, kind: 'click' }));
  out.push({ id: 'ck:flaps', p: flapKnob(P, R), r: 0.035, kind: 'click' });
  out.push({ id: 'yoke', p: add(stickAt(P, R).top, [0, 0, 0.04]), r: 0.06, kind: 'yoke' });
  // Each grip moves its own engine; a hand between the two moves the pair and brings them together.
  const lv = leverAt(P, R, null, (R.thrs[0] + R.thrs[1]) / 2);
  out.push({ id: 'throttle', p: add(lv.end, mul(lv.dir, 0.03)), r: 0.02, kind: 'throttle' });
  LEVER.dx.forEach((dx, e) => { const g = leverAt(P, R, e); out.push({ id: 'thr' + e, p: add(g.end, mul(g.dir, 0.03)), r: 0.03, kind: 'throttle', engine: e }); });
  out.push(gpsHotspot(screenPanel(K, SCREENS.find((sc) => sc.id === 'map')), 0, -0.008, 0.055));
  return out;
}

// ── THE SEAT: an ejection seat in the tub, the olive survival kit and a red stitch, a five-point
// harness, the headbox with its striped firing handle between the knees ──
function seat(P, push) {
  const K = makeKit(push, false);
  const cx = 0, h = P.seatHalf, [y0, y1] = P.seatY, sz = P.seatZ, zF = P.r76.zF;
  for (const s of [-1, 1]) K.box(cx + s * 0.17 - 0.02, y0 - 0.08, zF, cx + s * 0.17 + 0.02, y0 + 0.02, zF + 1.0, 'seat', 0.1, T.graphite);   // the rails up the bulkhead
  K.box(cx - 0.13, y0 + 0.06, zF + 0.03, cx + 0.13, y1 - 0.1, sz - 0.12, 'seat', -0.25, T.graphite);
  K.box(cx - h, y0, sz - 0.12, cx + h, y1, sz - 0.06, 'seat', 0.0, T.graphite);
  K.box(cx - h + 0.05, y0 + 0.02, sz - 0.06, cx + h - 0.05, y1 - 0.02, sz, 'seat', 0.08, T.seat);
  for (const s of [-1, 1]) {
    K.box(cx + s * h - s * 0.05, y0, sz - 0.06, cx + s * h, y1, sz + 0.06, 'seat', 0.05, T.bolster);
    K.box(cx + s * (h - 0.025) - 0.003, y0 + 0.02, sz + 0.06, cx + s * (h - 0.025) + 0.003, y1 - 0.02, sz + 0.064, 'seat', 0.2, T.red, 0.2);
  }
  for (let i = 1; i < 5; i++) {
    const y = lerp(y0 + 0.02, y1 - 0.02, i / 5);
    K.box(cx - h + 0.06, y - 0.003, sz + 0.0005, cx + h - 0.06, y + 0.003, sz + 0.002, 'seat', -0.3, T.seatDk);
  }
  // The firing handle: a striped loop on the front of the seat pan, between the knees.
  K.torus([cx, y1 + 0.01, sz - 0.04], [1, 0, 0], [0, 0, 1], 0.035, 0.007, 12, 'seat', 0.2, [220, 190, 40], 0.1);
  for (let i = 0; i < 4; i++) K.box(cx - 0.036 + i * 0.02, y1 + 0.004, sz - 0.004, cx - 0.028 + i * 0.02, y1 + 0.016, sz + 0.002, 'seat', 0.2, T.tub);
  const lean = 0.18, bb = [cx, y0 - 0.01, sz], up = [0, -Math.sin(lean), Math.cos(lean)], fw = [0, Math.cos(lean), Math.sin(lean)];
  const bH = 0.62;
  const bc = add(bb, mul(up, bH / 2));
  K.obox(add(bc, mul(fw, -0.06)), [1, 0, 0], up, fw, h, bH / 2, 0.04, 'seat', -0.06, T.graphite);
  K.obox(add(bc, mul(fw, -0.015)), [1, 0, 0], up, fw, h - 0.06, bH / 2 - 0.04, 0.012, 'seat', 0.0, T.seat);
  for (const s of [-1, 1]) K.obox(add(add(bc, mul(fw, -0.005)), [s * (h - 0.03), 0, 0]), [1, 0, 0], up, fw, 0.03, bH / 2, 0.04, 'seat', 0.0, T.bolster);
  for (let i = 1; i < 5; i++) K.obox(add(add(bb, mul(up, bH * i / 5)), mul(fw, -0.002)), [1, 0, 0], up, fw, h - 0.07, 0.003, 0.012, 'seat', -0.3, T.seatDk);
  // The headbox: wide, graphite, with its stripes.
  const hc = add(bb, mul(up, bH + 0.12));
  K.obox(add(hc, mul(fw, -0.05)), [1, 0, 0], up, fw, 0.15, 0.12, 0.06, 'seat', 0.0, T.graphite);
  K.obox(add(hc, mul(fw, 0.012)), [1, 0, 0], up, fw, 0.1, 0.07, 0.008, 'seat', 0.0, T.seat);
  for (const s of [-1, 1]) K.obox(add(add(hc, mul(fw, 0.012)), [s * 0.125, 0, 0]), [1, 0, 0], up, fw, 0.012, 0.1, 0.004, 'seat', 0.2, T.red, 0.15);
  K.obox(add(add(bb, mul(up, bH * 0.9)), mul(fw, -0.002)), [1, 0, 0], up, fw, h - 0.07, 0.004, 0.012, 'seat', 0.2, T.red, 0.3);
  const top = add(bb, mul(up, bH - 0.01)), buck = [cx, y1 - 0.16, sz + 0.14];
  for (const s of [-1, 1]) {
    K.rod(add(add(top, mul(fw, 0.03)), [s * 0.06, 0, 0]), add(buck, [s * 0.025, 0, 0.03]), 0.012, 'seat', 0.05, T.harness, 0, 4);
    K.rod([cx + s * (h - 0.04), y0 + 0.08, sz + 0.03], add(buck, [s * 0.025, 0, -0.01]), 0.012, 'seat', 0.05, T.harness, 0, 4);
  }
  K.rod([cx, y1 - 0.04, sz + 0.005], add(buck, [0, 0, -0.02]), 0.01, 'seat', 0.05, T.harness, 0, 4);
  K.rod(add(buck, [0, -0.008, 0]), add(buck, [0, 0.01, 0]), 0.034, 'seat', 0.3, T.buckle, 0, 12);
}

// ── THE FIT-OUT ──────────────────────────────────────────────────────────────
export function r76Fit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live);
  const zF = P.r76.zF;
  const lit = R.powered, panel = panelOn(R);
  const amb = lit ? (night(R) ? 1 : 0.55) * (R.dome ? 1.2 : 1) : 0.05;
  const boot = bootAge(live);
  // The light lines carry the alert: teal, amber on low fuel or a dry gun, red and breathing on a
  // hull or stall warning. They are the first thing in the room to change colour.
  const dry = R.ammo != null && R.ammo < GUN_CAP * 0.1;
  const warn = lit && (R.hull < 0.3 || R.stall), caution = lit && (R.fuel < 0.15 || dry);
  const al = alertLight(caution, warn), lineK = (k) => (lit ? k * al.k : 0.05);
  // How near the hand is to a control: eased up while the pointer is over it or pressing it.
  const near = (key, ids) => eased('r76:near:' + key, live && ids.some((id) => live.hover === id || live.press === id) ? 1 : 0, 12);
  const out = wingmenOut(live, R);

  // ── THE DECK: a wing swept along the band's curve, its shelf falling forward under the windscreen ──
  const curve = dashCurve();
  const gt = [DASH.h * DASH.lean / Math.hypot(1, DASH.lean), DASH.h / Math.hypot(1, DASH.lean)];
  // The section, from the glass's foot up its face, under a brow that hoods the glass's top edge, over
  // a shelf that falls away forward (the hull closes over it under the windscreen), down the nose and
  // back under to the lip. 4 mm in behind the glass.
  const g0 = 0.004;
  const SEC = [[g0, 0], [gt[0] + g0, gt[1]], [0.1, gt[1] + 0.016], [0.115, gt[1] + 0.024], [0.2, gt[1] + 0.012], [0.3, gt[1] - 0.03], [0.36, gt[1] - 0.08],
    [0.34, -0.03], [0.2, -0.1], [0.04, -0.12], [-0.05, -0.08], [-0.06, -0.03], [g0, 0]];
  const N = 32, rings = [];
  for (let i = 0; i <= N; i++) {
    // Toward each wall the wing thins and drops, as the hull closes in over it.
    const s = i / N, c = curve(s), e = Math.abs(2 * s - 1) ** 3, tap = 1 - 0.72 * e;
    rings.push(SEC.map(([f, z]) => {
      const ff = f > gt[0] + g0 ? gt[0] + g0 + (f - gt[0] - g0) * tap : f < 0 ? f * tap : f;
      return [c.p[0] + c.f[0] * ff, c.p[1] + c.f[1] * ff, c.p[2] + (z > gt[1] ? gt[1] + (z - gt[1]) * tap : z) - (z > 0.05 ? 0.06 * e : 0)];
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
    const q = [add(a[3], lift), add(b[3], lift), add(lerp3(b[3], b[4], 0.85), lift), add(lerp3(a[3], a[4], 0.85), lift)];
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
    Pn.rect(-SW + 0.003, SH - 0.003, SW - 0.003, SH - 0.0012, sc.id === 'gun' && R.armed ? T.amber : T.glow, 0.85, 0.0018);
    Pn.fitText(sc.title, 0, SH - 0.0135, SW * 1.3, 0.009, T.title, panel ? 0.9 : 0.7, 0.0026);
    if (sc.id === 'pfd') pfd(Pn, R);
    else if (sc.id === 'gun') gunPage(Pn, R);
    else if (sc.id === 'eng') enginePage(Pn, R);
    else if (sc.id === 'wingmen') wingmenPage(Pn, R, out);
    else if (sc.id === 'map') mapPage(Pn, R, live);
  }
  // The status lamps along the top of the band: what the aircraft thinks of you.
  {
    // ⚠ PILOT PRESENT IS THE RIDER'S LAMP: lit whenever the seat is powered and occupied, which is
    // whenever this cockpit is drawn. It is the one thing on the panel the insurer reads.
    const lamps = [
      ['PILOT PRESENT', lit, C.green], ['HANDS ON', R.handsOn, T.glow], ['ADVISORY', lit, T.amber],
      ['MASTER ARM', lit && R.armed, T.amber], ['LOW FUEL', lit && R.fuel < 0.15, T.warn], ['HULL', lit && (R.hull < 0.3 || R.stall), T.warn],
    ];
    const up = reveal(boot, 0.75) >= 1;
    lamps.forEach(([name, on, rgb], i) => lensLamp(bandPanel(K, LAMP_X[i], LAMP_V, 0.012), 0, 0, 0.125, 0.022, on && up, rgb, name));
  }

  // ── THE KEYS: five glass keys on the band ──
  // A key sinks while pressed and comes back, its light eases on and off with the circuit, it
  // brightens as the hand comes over it, and a ring flashes round it when its state changes. The ARM
  // key is wider, lettered in amber, and lit while the weapons are armed.
  BTN.ids.forEach((id) => {
    const Kp = bandPanel(K, BTN_AT[id], KEY_V, 0.006), on = switchOn(id, R);
    const pressed = !!live && live.press === 'ck:' + id;
    const rgb = id === 'master' ? C.green : id === 'arm' ? T.amber : T.glow;
    const glow = eased('r76:glow:' + id, on ? 1 : 0, 10), depth = eased('r76:dip:' + id, pressed ? 0.002 : 0.007, 30);
    const hand = near('key:' + id, ['ck:' + id]);
    const hw = keyHalfW(id);
    Kp.rect(-hw - 0.002, -KEY_H - 0.002, hw + 0.002, KEY_H + 0.002, T.tub, 0, 0.0005);
    for (const [a, b, c, d] of [[-hw, KEY_H, hw, KEY_H + 0.002], [-hw, -KEY_H - 0.002, hw, -KEY_H], [-hw - 0.002, -KEY_H, -hw, KEY_H], [hw, -KEY_H, hw + 0.002, KEY_H]]) Kp.rect(a, b, c, d, id === 'arm' ? T.amber : T.glow, (lit ? 0.25 : 0) + hand * 0.75, 0.0012);
    Kp.stud(0, 0, hw - 0.003, KEY_H - 0.003, depth, rgb.map((c, k) => lerp([40, 46, 50][k], c, glow * 0.8)), glow * 0.85 + hand * 0.15, 0.0015);
    Kp.fitText(BTN.names[id], 0, -0.004, hw * 1.6, 0.011, glow > 0.5 ? [10, 24, 22] : [214, 222, 220], glow > 0.5 ? 0 : (panel ? 0.6 : 0.25), depth + 0.0025);
    const flash = pressPulse('r76:key:' + id, on);
    if (flash > 0.02) for (const [a, b, c, d] of [[-hw - 0.006, KEY_H + 0.004, hw + 0.006, KEY_H + 0.007], [-hw - 0.006, -KEY_H - 0.007, hw + 0.006, -KEY_H - 0.004]]) Kp.rect(a, b, c, d, HALO, flash, 0.004);
  });

  // ── THE WINDSCREEN HUD: projected, conformal, with both thrust levers, the stick, the pedals and
  // the flaps mirrored round its edges, so the forward view shows every low control; the weapon and
  // the master arm in the lower right ──
  if (lit) {
    const life = reveal(boot, 0.2);
    const col = warn ? HUD_RED : caution ? HUD_AMBER : HUD_LINE;
    const Hp = windscreenHud(K, R, { ...HUD, warn, caution, boot: life, mirrors: { stick: [R.ail, R.elev], thrs: R.thrs, rud: R.rud } });
    if (life > 0) {
      hudFlaps(Hp, R, col);
      const wy = -HUD.hh * 0.6, wx = HUD.hw * 0.62;
      const wname = { gun: 'GUN', msl: 'MSL', bomb: 'BMB' }[R.weapon];
      const count = R.weapon === 'gun' ? (R.ammo == null ? '' : String(R.ammo)) : String(R.weapon === 'msl' ? R.missiles : R.bombs);
      Hp.text(wname + ' ' + count, wx, wy, 0.0095, R.armed ? col : HUD_DIM, 1, 0.001);
      Hp.text(R.armed ? 'ARM' : 'SAFE', wx, wy - 0.014, 0.0095, R.armed ? HUD_AMBER : HUD_DIM, 1, 0.001);
      // The wingmen, two ticks either side of the weapon box: lit and spread while they fly.
      for (const s of [-1, 1]) Hp.rect(wx + s * (0.026 + 0.01 * out) - 0.003, wy + 0.013, wx + s * (0.026 + 0.01 * out) + 0.003, wy + 0.016, out > 0.5 ? col : HUD_DIM, 1, 0.001);
    }
  }

  // ── THE HOLOGRAM over the deck's shelf: the Reaper and her wingmen, flying as she flies ──
  // Pitched and banked with her, her fans turning on the phase and ringed at each engine's spool, the
  // wingmen on the wing or out in formation, standing on a projector whose arc is the rounds left.
  {
    const c0 = curve(sOf(HOLO_AT.x));
    const base = add(add(c0.p, mul(c0.f, HOLO_AT.out)), [0, 0, gt[1] + 0.02]);
    const frac = R.ammo == null ? 0 : clamp(R.ammo / GUN_CAP, 0, 1);
    holoProjector(K, base, HOLO_AT.rise, 0.045, lit ? frac : 0, frac < 0.1 ? HOLO_RED : frac < 0.25 ? HOLO_AMBER : HOLO_LINE);
    if (lit && reveal(boot, 0.7) > 0) holoReaper(K, add(base, [0, 0, HOLO_AT.rise + 0.02]), R, out);
  }

  // ── THE SIDE CONSOLES: swept, the two thrust levers on the left and the stick on the right ──
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
    lightLine(K, crings.map((r) => add(r[s < 0 ? 10 : 0], [-s * 0.002, 0, 0.34])), 0.003, al.rgb, lineK(0.75));
    // The forearm pad along the top, aft of the control.
    for (let i = 0; i <= 6; i++) pads.push(roundSection(cx, lerp(CON.y0 + 0.02, (s < 0 ? LEVER.pivotY : STICK.y) - 0.1, i / 6), 0.05, zF + CON.top - 0.008, zF + CON.top + 0.014, 0.018));
    sweep(K, pads, 'dash', 0.1, T.seat);
    // The danger red along the console's inboard lip.
    lightLine(K, crings.map((r) => add(r[s < 0 ? 10 : 0], [-s * 0.0015, 0, 0.28])), 0.0025, T.red, 0.15);
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
    const Fp = facingPanel(K, [FLAP.x + 0.035, (FLAP.y0 + FLAP.y1) / 2, rt + 0.01], 'dash', 0.3);
    ['UP', '1', '2', 'F'].forEach((sN, i) => {
      const v = (i - 1.5) * 0.017;
      Fp.text(sN, 0, -v - 0.005, 0.012, i === R.flap ? T.white : T.dim, i === R.flap ? 0.9 : (panel ? 0.6 : 0.3), 0.001);
    });
    const kb = flapKnob(P, R), base = [FLAP.x, kb[1], rt];
    const press = !!live && live.press === 'ck:flaps', hand = near('flaps', ['ck:flaps']);
    const dip = eased('r76:flapdip', press ? 0.008 : 0, 30);
    K.rod(base, add(kb, [0, 0, -0.012 - dip]), 0.006, 'dash', 0.2, T.metal, 0, 6);
    // The knob is an aerofoil section, the way flap levers are the world over.
    K.obox(add(kb, [0, 0, -dip]), [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.024, 0.012, 0.014, 'dash', 0.15, [214, 218, 220]);
    K.obox(add(kb, [0, 0, 0.0125 - dip]), [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.02, 0.006, 0.001, 'dash', 0.3, T.glow, lit ? 0.6 + hand * 0.4 : 0);
    K.obox(add(kb, [0, -0.0125, -dip]), [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.025, 0.003, 0.001, 'dash', 0.3, al.rgb, lit ? 0.15 + hand * 0.85 : 0);
    const flash = pressPulse('r76:flap', R.flap);
    if (flash > 0.02) facingPanel(K, kb, 'dash', 0).annulus(0, 0, 0.034, 0.039, HALO, flash, 0.003, 18);
  }
  // The thrust levers: a gate with two slots and a lit tick every quarter, the full tick amber, and a
  // lever in each slot, the left engine outboard. Each grip lights as the hand comes to it, and both
  // when the hand is on the pair.
  {
    const pt = zF + CON.top;
    for (const dx of LEVER.dx) K.box(LEVER.x + dx - 0.006, LEVER.pivotY - 0.13, pt - 0.003, LEVER.x + dx + 0.006, LEVER.pivotY + 0.13, pt + 0.005, 'dash', -0.3, T.tub);
    for (let i = 0; i <= 4; i++) {
      const y = LEVER.pivotY - 0.11 + i * 0.055, here = lit && R.thrs.some((t) => Math.abs(i / 4 - t) < 0.13);
      K.box(LEVER.x + 0.034, y - 0.002, pt + 0.002, LEVER.x + 0.05, y + 0.002, pt + 0.006, 'dash', 0.2, i === 4 ? T.amber : here ? T.glow : T.glowDim, here || i === 4 ? 0.9 : 0.5);
    }
    const both = near('thr', ['throttle']);
    [0, 1].forEach((e) => {
      const lv = leverAt(P, R, e), hand = Math.max(both, near('thr' + e, ['thr' + e]));
      K.rod(lv.pivot, lv.end, 0.008, 'dash', 0.2, T.metal, 0, 8);
      const gripEnd = add(lv.end, mul(lv.dir, 0.05)), side = norm(cross([1, 0, 0], lv.dir));
      K.obox(mul(add(lv.end, gripEnd), 0.5), [1, 0, 0], lv.dir, side, 0.011, 0.03, 0.017, 'dash', 0.1, T.graphiteLt);
      K.obox(add(gripEnd, mul(lv.dir, 0.002)), [1, 0, 0], side, lv.dir, 0.009, 0.011, 0.003, 'dash', 0.3, T.glow, lit ? 0.3 + R.thrs[e] * 0.5 + hand * 0.2 : 0);
      K.obox(add(mul(add(lv.end, gripEnd), 0.5), mul(side, 0.0175)), [1, 0, 0], lv.dir, side, 0.012, 0.004, 0.001, 'dash', 0.3, al.rgb, lit ? 0.2 + hand * 0.8 : 0);
    });
    // The fire lamps at the gate's fore end, one per engine: lit red if that engine's spool is past
    // its stop with the oil hot (a lamp, not a handle).
    [0, 1].forEach((e) => {
      const hot = lit && R.on[e] && R.temp > 0.9;
      K.box(LEVER.x + LEVER.dx[e] - 0.009, LEVER.pivotY + 0.14, pt + 0.002, LEVER.x + LEVER.dx[e] + 0.009, LEVER.pivotY + 0.16, pt + 0.012, 'dash', 0.3, hot ? T.warn : [70, 30, 28], hot ? 0.9 : 0);
    });
  }
  // The sidestick, on the right console: its base ring lights green under a hand, the grip's cap
  // light brightens as the hand comes to it, and the trigger guard is red.
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
    K.obox(add(st.top, add(mul(gdir, 0.05), [0, 0.021, 0])), [1, 0, 0], gdir, [0, 1, 0], 0.006, 0.012, 0.005, 'dash', 0.2, R.armed && lit ? T.warn : T.red, R.armed && lit ? 0.6 : 0.05);
  }

  // ── THE PEDALS, sliding on rails, one forward as the other comes back ──
  {
    const pz = zF + 0.14, py = 0.92;
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

  // ── THE CANOPY RAILS: light lines down each side of the bubble's sill, and the dome light behind
  // the headbox. ⚠ NO CONTROL THE SIM DOES NOT HAVE: nothing up here to pull.
  {
    const D = P.r76, Bb = RP_GLASS.bubble;
    const O = (f, a, inM) => D.toShell(rpPoint(f, a, -(D.inset + inM / D.m)));
    const ohK = (lit ? al.k : 1) * Math.max(amb, 0.2);
    for (const a of [Bb.a[0] - 3, Bb.a[1] + 3]) lightLine(K, [0.395, 0.43, 0.47, 0.51, 0.55].map((f) => O(f, a, 0.012)), 0.004, al.rgb, ohK, 'pil');
    const dome = O(RP_INSIDE.bulkheadF + 0.004, 120, 0.03);
    K.rod(dome, add(dome, [0.012, 0.01, -0.01]), 0.035, 'post', 0.1, R.dome && lit ? [240, 252, 248] : [80, 84, 84], R.dome && lit ? 1 : 0, 14);
  }

  hotspotHalo(K, r76Hotspots(P, live), live);
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
    const y = -0.02 - i * 0.01, sel = i === R.flap;
    Hp.rect(fx - (sel ? 0.008 : 0.004), y - (sel ? 0.0016 : 0.0008), fx + (sel ? 0.008 : 0.004), y + (sel ? 0.0016 : 0.0008), sel ? col : HUD_DIM, 1, 0.001);
  }
  Hp.text(['UP', '1', '2', 'F'][R.flap], fx - 0.002, -0.07, 0.01, col, 1, 0.001);
}

// ── THE HOLOGRAM: the Reaper in miniature, 14 cm long ──
// Her hull as section rings and lines off the hull's own stations (cabin-reaper-2076.js), the bubble
// lit, the gun a long bar under the chin, the straight wing with its flaps down to the notch, the two
// engine pods with their fans turning on the phase and each ringed at its own spool, the twin canted
// fins, and the two wingmen: on the wing, or out in formation off each tip where RP_WINGMEN says the
// real ones fly. The frame is her pitch and bank.
const HW = [{ g: 0, le: 0.142, te: -0.233, h: -0.034 }, { g: 0.34, le: 0.14, te: -0.23, h: -0.034 }, { g: 1.04, le: 0.09, te: -0.2, h: 0.052 }, { g: 1.1, le: 0.075, te: -0.19, h: 0.036 }];
function holoReaper(K, c, R, out) {
  const H = holoFrame(K, c, R.pitch, R.bank);
  const sc = HOLO_AT.scale;
  const M = (f, g, h) => [g * sc, f * sc, h * sc];
  const P = (f, a) => { const q = rpPoint(f, a); return M(q[0], q[1], q[2]); };
  // The hull: rings at five stations and eight lines nose to tail.
  const ST = [0.94, 0.84, 0.69, 0.55, 0.45, 0.3, 0.1, -0.2, -0.5, -0.7, -0.88, -1.0];
  for (const f of [0.84, 0.5, 0.1, -0.35, -0.7]) { let prev = P(f, -90); for (let i = 1; i <= 12; i++) { const q = P(f, -90 + i * 30); H.line(prev, q, 0.0005); prev = q; } }
  for (const a of [-90, -40, 0, 50, 90, 130, 180, 220]) {
    const pts = [M(0.985, 0, 0.004), ...ST.map((f) => P(f, a)), M(...RP_APEX_AFT)];
    for (let i = 0; i + 1 < pts.length; i++) H.line(pts[i], pts[i + 1], a === 90 || a === -90 ? 0.0007 : 0.0005);
  }
  // The bubble, a lit shell of plates.
  {
    const Bb = RP_GLASS.bubble;
    for (let i = 0; i < 5; i++) {
      const a0 = lerp(Bb.a[0], Bb.a[1], i / 5), a1 = lerp(Bb.a[0], Bb.a[1], (i + 1) / 5);
      H.plate([P(Bb.f[1], a0), P(Bb.f[1], a1), P(Bb.f[0], a1), P(Bb.f[0], a0)], HOLO, 0.75);
    }
  }
  // The gun: a bar under the chin to the muzzle, amber while the weapons are armed.
  H.line(M(0.5, 0, -0.064), M(1.0, 0, -0.064), 0.0012, R.armed ? HOLO_AMBER : HOLO_LINE);
  // The wing, each side a plate with its edges lined; the flaps drawn down to the notch.
  const fd = R.flap / 3 * 0.05;
  for (const s of [1, -1]) {
    const le = HW.map((w) => M(w.le, s * w.g, w.h)), te = HW.map((w) => M(w.te, s * w.g, w.h));
    for (let i = 0; i + 1 < le.length; i++) {
      H.plate([le[i], le[i + 1], te[i + 1], te[i]], HOLO, 0.4);
      H.line(le[i], le[i + 1], 0.0007); H.line(te[i], te[i + 1], 0.0006);
    }
    H.line(le[le.length - 1], te[te.length - 1], 0.0006);
    H.line(M(-0.2 - fd, s * 0.1, -0.04 - fd), M(-0.2 - fd, s * 0.55, -0.04 - fd), 0.0006, R.flap ? HOLO_LINE : HOLO);
  }
  // The engines: a pod each side, its fan turning on the phase, ringed at its own spool.
  const E = RP_ENGINES;
  [0, 1].forEach((e) => {
    const s = e === 0 ? -1 : 1, g = s * E.g;
    for (const f of [E.fanF, -0.42, E.tailF]) {
      const r = (f === E.tailF ? 0.7 : 1) * E.r;
      let prev = null;
      for (let i = 0; i <= 10; i++) { const t = i / 10 * TAU, q = M(f, g + Math.cos(t) * r, E.h + Math.sin(t) * r); if (prev) H.line(prev, q, 0.0004); prev = q; }
    }
    for (const t of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI]) H.line(M(E.fanF, g + Math.cos(t) * E.r, E.h + Math.sin(t) * E.r), M(E.tailF, g + Math.cos(t) * E.r * 0.7, E.h + Math.sin(t) * E.r * 0.7), 0.0004);
    const hub = M(E.fanF + 0.005, g, E.h), rr = E.r * 0.85 * sc, frac = clamp(R.rpms[e] / 1.05, 0, 1);
    if (frac > 0.01) H.ring(hub, [1, 0, 0], [0, 0, 1], rr * 1.15, Math.max(2, Math.round(14 * frac)), frac > 0.85 ? HOLO_LINE : HOLO_AMBER, R.on[e] ? 1 : 0.4, Math.PI / 2, Math.PI / 2 - frac * TAU);
    for (let b = 0; b < 6; b++) {
      const t = (R.on[e] ? R.phase * 1.6 : 0) + b * TAU / 6;
      H.line(hub, add(hub, [Math.cos(t) * rr, 0, Math.sin(t) * rr]), 0.0005, HOLO_LINE, R.on[e] ? 1 : 0.5);
    }
  });
  // The tail: the tailplane and the twin fins, canted out.
  for (const s of [1, -1]) {
    const tp = [M(-0.79, 0, 0.052), M(-0.84, s * 0.36, 0.052), M(-1.03, s * 0.36, 0.052), M(-1.01, 0, 0.052)];
    H.plate(tp, HOLO, 0.4);
    H.line(tp[0], tp[1], 0.0006); H.line(tp[1], tp[2], 0.0006); H.line(tp[2], tp[3], 0.0006);
    const cant = 9 * DEG, gx = (z) => s * (0.355 + Math.sin(cant) * (z - 0.052));
    const fin = [M(-0.765, gx(-0.04), -0.04), M(-1.015, gx(-0.04), -0.04), M(-0.99, gx(0.33), 0.33), M(-0.8, gx(0.33), 0.33)];
    H.plate(fin, HOLO, 0.4);
    for (let i = 0; i < 4; i++) H.line(fin[i], fin[(i + 1) % 4], 0.0006);
  }
  // The wingmen: a dart each with a V-tail, on the wing or out in formation where they fly.
  const k = smooth01(out), W = RP_WINGMEN;
  for (const s of [1, -1]) {
    const p = rpWingmanAt(out), cc = M(p[0], s * p[1], p[2]);
    const col = k > 0.5 ? HOLO_LINE : HOLO, L = W.len * sc / 2, Sp = W.span * sc / 2;
    const nose = add(cc, [0, L, 0]), tail = add(cc, [0, -L, 0]);
    H.line(tail, nose, 0.0007, col);
    H.line(add(cc, [-Sp, -L * 0.3, 0]), add(cc, [0, L * 0.25, 0]), 0.0006, col);
    H.line(add(cc, [Sp, -L * 0.3, 0]), add(cc, [0, L * 0.25, 0]), 0.0006, col);
    H.line(add(cc, [-Sp, -L * 0.3, 0]), add(cc, [Sp, -L * 0.3, 0]), 0.0005, col);
    for (const t of [-1, 1]) H.line(add(tail, [0, L * 0.3, 0.0005]), add(tail, [t * Sp * 0.45, 0, Sp * 0.45]), 0.0005, col);
    // While they fly, a faint line back to her wingtip: the link.
    if (k > 0.05) H.line(M(-0.05, s * 1.1, 0.04), cc, 0.0003, HOLO, k * 0.6);
  }
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

// ── THE GUN PAGE: the barrel cluster, the rounds, the selection and the master arm ──
function gunPage(Pn, R) {
  // The cluster, seen from the muzzle: seven barrels round the spindle. A GAU-8 fires one round per
  // barrel per turn, so the cluster stands turned by the rounds fired: a seventh of a turn a round.
  const cu = -0.042, cv = 0.012, rc = 0.017, turn = R.ammo == null ? 0 : -(R.ammo % 7) * TAU / 7;
  Pn.annulus(cu, cv, rc + 0.005, rc + 0.007, R.armed ? T.amber : [30, 44, 44], R.armed ? 0.9 : 0.3, 0.003, 20);
  for (let b = 0; b < 7; b++) {
    const t = turn + b * TAU / 7 + Math.PI / 2;
    Pn.annulus(cu + Math.cos(t) * rc, cv + Math.sin(t) * rc, 0.0025, 0.0045, b === 0 ? T.white : T.glow, b === 0 ? 0.95 : 0.7, 0.0035, 10);
  }
  Pn.disc(cu, cv, 0.005, [200, 210, 210], 0.5, 0.004, 10);
  // The rounds: big, and the bar of the drum under them.
  const frac = R.ammo == null ? 0 : clamp(R.ammo / GUN_CAP, 0, 1);
  const col = R.ammo == null ? T.dim : frac < 0.1 ? T.warn : frac < 0.25 ? T.amber : T.white;
  Pn.digits(0.0, 0.016, 0.016, R.ammo == null ? '----' : String(Math.min(9999, R.ammo)).padStart(4, ' '), col, false);
  Pn.text('RDS', 0.054, 0.003, 0.008, LBL, 0.5, 0.003);
  Pn.rect(0.0, -0.004, 0.066, 0.002, [20, 30, 32], 0.3, 0.002);
  if (frac > 0) Pn.rect(0.001, -0.003, lerp(0.001, 0.065, frac), 0.001, frac < 0.1 ? T.warn : frac < 0.25 ? T.amber : T.glow, 0.9, 0.003);
  // The selection: GUN, MSL and BMB in a row, the selected one boxed and brightest, with what is left
  // of each store under it.
  [['gun', 'GUN'], ['msl', 'MSL'], ['bomb', 'BMB']].forEach(([id, name], i) => {
    const u = -0.046 + i * 0.046, v = -0.025, sel = R.weapon === id;
    if (sel) Pn.rect(u - 0.02, v - 0.006, u + 0.02, v + 0.012, R.armed ? [60, 36, 10] : [16, 40, 38], 0.5, 0.002);
    Pn.fitText(name, u, v - 0.002, 0.034, 0.01, sel ? T.white : T.dim, sel ? 0.95 : 0.5, 0.003);
  });
  const pips = (u, n, rgb) => { for (let i = 0; i < Math.min(6, n); i++) Pn.rect(u - 0.012 + i * 0.005, -0.04, u - 0.009 + i * 0.005, -0.034, rgb, 0.9, 0.003); };
  pips(0.0, R.missiles, T.glow);
  pips(0.046, R.bombs, T.glow);
  // The master arm, the page's foot: SAFE dim, ARMED amber.
  Pn.rect(-0.07, -0.058, 0.07, -0.046, R.armed ? [70, 44, 12] : [20, 24, 26], 0.4, 0.002);
  Pn.fitText(R.armed ? 'ARMED' : 'SAFE', 0, -0.056, 0.12, 0.009, R.armed ? T.amber : T.dim, R.armed ? 0.95 : 0.5, 0.003);
}

// ── THE ENGINES PAGE: each engine's spool and its fan, its lever, its fuel flow; the fuel and the
// endurance across the foot ──
function enginePage(Pn, R) {
  [0, 1].forEach((e) => {
    const u = e === 0 ? -0.036 : 0.036, v = 0.02, frac = clamp(R.rpms[e] / 1.05, 0, 1);
    Pn.annulus(u, v, 0.0175, 0.02, [30, 44, 44], 0.3, 0.003, 16);
    if (frac > 0.01) Pn.annulus(u, v, 0.0175, 0.02, frac > 0.85 ? T.glow : T.amber, 0.95, 0.0035, Math.max(2, Math.round(16 * frac)), Math.PI / 2, Math.PI / 2 - frac * TAU);
    for (let b = 0; b < 6; b++) Pn.spoke(u, v, (R.on[e] ? R.phase * 1.6 : 0) + b * TAU / 6, 0.002, 0.015, 0.0014, T.white, 0.8, 0.0045, 0.0006);
    Pn.disc(u, v, 0.0028, [200, 210, 210], 0.6, 0.005, 8);
    Pn.text(e === 0 ? 'L' : 'R', u, v - 0.03, 0.008, LBL, 0.5, 0.003);
    // The spool as a number, and the lever's own setting as a bar beside it.
    Pn.digits(u - 0.013, -0.022, 0.01, String(Math.round(R.rpms[e] * 100)).padStart(3, ' '), R.on[e] ? T.white : T.dim, false);
    const bx = u + (e === 0 ? -0.026 : 0.026);
    Pn.rect(bx - 0.0025, -0.03, bx + 0.0025, 0.03, [20, 30, 32], 0.3, 0.002);
    Pn.rect(bx - 0.0018, -0.029, bx + 0.0018, lerp(-0.029, 0.029, R.thrs[e]), T.glow, 0.9, 0.003);
    // The fuel flow in kilograms an hour.
    Pn.digits(u - 0.017, -0.036, 0.009, String(R.ff[e]).padStart(4, ' '), R.ff[e] > 1100 ? T.amber : T.glow, false);
  });
  Pn.text('N1', 0, 0.02, 0.008, LBL, 0.5, 0.003);
  Pn.text('FF', 0, -0.033, 0.008, LBL, 0.5, 0.003);
  // The fuel left and the endurance at the present flow.
  const fc = R.fuel < 0.15 ? T.warn : R.fuel < 0.3 ? T.amber : T.white;
  Pn.text('FUEL', -0.054, -0.051, 0.008, LBL, 0.5, 0.003);
  Pn.digits(-0.036, -0.056, 0.01, String(Math.round(R.fuel * 100)).padStart(3, ' '), fc, false);
  Pn.text('MIN', 0.016, -0.051, 0.008, LBL, 0.5, 0.003);
  Pn.digits(0.03, -0.056, 0.01, R.endur == null ? '---' : String(R.endur).padStart(3, ' '), R.endur == null ? T.dim : T.white, false);
}

// ── THE WINGMEN PAGE: her plan from above, the two cradles, and the wingmen in them or out in
// formation off her tips; the link and what they are doing ──
function wingmenPage(Pn, R, out) {
  const k = smooth01(out), sx = 0.026, vy = 0.004;
  const pt = (f, g) => [g * sx, vy + f * sx];
  const ln = (a, b, rgb = [70, 120, 112], e = 0.6) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    Pn.spoke(a[0], a[1], Math.atan2(dy, dx), 0, L, 0.0006, rgb, e, 0.003);
  };
  // Her plan: hull, wing, tailplane and the engine pods, faint.
  ln(pt(1.0, 0), pt(-1.05, 0));
  ln(pt(0.12, -1.1), pt(0.12, 1.1)); ln(pt(-0.22, -1.1), pt(-0.22, 1.1));
  ln(pt(-0.8, -0.36), pt(-0.8, 0.36));
  for (const s of [-1, 1]) ln(pt(-0.2, s * 0.205), pt(-0.62, s * 0.205), [70, 120, 112], 0.4);
  for (const s of [-1, 1]) {
    // The cradle, an empty amber outline while its wingman is away.
    const c = pt(RP_WINGMEN.dock[0], s * RP_WINGMEN.dock[1]);
    Pn.rect(c[0] - 0.004, c[1] - 0.004, c[0] + 0.004, c[1] + 0.004, k > 0.5 ? T.amber : [30, 44, 44], k > 0.5 ? 0.5 : 0.3, 0.003);
    // The wingman, a dart where it is: at the cradle or out off the tip.
    const p = rpWingmanAt(out), d = pt(p[0], s * p[1]), col = k > 0.5 ? T.white : T.glow;
    Pn.spoke(d[0], d[1], Math.PI / 2, -0.0045, 0.0045, 0.0007, col, 0.95, 0.0045);
    Pn.spoke(d[0], d[1] - 0.001, 0, -0.0035, 0.0035, 0.0006, col, 0.95, 0.0045);
    if (k > 0.05) ln([s * 1.1 * sx, vy - 0.002], d, T.glow, 0.3 * k);
  }
  // What they are doing, in words; and the link, lit with the power.
  const state = out > 0.98 ? 'FORMATION' : out > 0.02 ? (R.armed ? 'LAUNCH' : 'RECOVER') : 'DOCKED';
  Pn.fitText(state, -0.024, -0.042, 0.07, 0.009, k > 0.5 ? T.white : T.glow, 0.9, 0.003);
  Pn.text('LINK', 0.038, -0.04, 0.008, R.powered ? T.glow : T.dim, R.powered ? 0.8 : 0.3, 0.003);
  Pn.text(R.armed ? 'WPN FREE' : 'WPN SAFE', 0.0, -0.056, 0.008, R.armed ? T.amber : T.dim, 0.8, 0.003);
}

// ── THE MAP: the kit's moving map, the distance to go, the heading ──
function mapPage(Pn, R, live) {
  panelGps(Pn, 0, -0.008, 0.066, 0.042, live, { label: false, bezel: [8, 14, 16] });
  const g = live && live.gpsTo;
  if (g && Number.isFinite(g.dist)) Pn.digits(0.03, 0.022, 0.01, String(Math.min(999, Math.round(g.dist))).padStart(3, ' '), T.white, false);
  Pn.digits(-0.064, 0.022, 0.01, String(Math.round(((R.hdg % 360) + 360) % 360)).padStart(3, '0'), T.white, false);
}
