// THE MULE 2076'S FLIGHT DECK: the inside of the concept freighter, as geometry.
//
// The Mule 2076 is the prop class's concept body (mesh_prop_2076.json): the Twin Otter fifty years
// on, after the Electra.aero EL9 and Reliable Robotics' pilotless Caravans. Eight electric motors on
// the leading edge blow the flaps; a hydrogen turbogenerator behind the wing keeps a buffer battery
// topped up; the aircraft can fly itself, and on routes nobody booked it sometimes does. Halcyon's
// Warm Hands Rider voids the hull cover on any flight logged without a living pilot at the controls,
// so the controls are there, they work, and the panel says politely and all the time that they are
// advisory. The pilot's real job is to sign the manifest.
//
// So it is still a working room, but a clean one: two crew side by side, the pilot on the LEFT as
// in the Otter, a sidestick outboard of each seat on a swept side console, a swept pedestal between
// them with the thrust levers and the flap lever, and a sculpted deck from wall to wall with one curved
// band of glass across it carrying every page, key and lamp. The flight symbology is projected into
// the windscreen, and a hologram of the aircraft stands on the deck's shelf. Behind the seats is a
// bulkhead with a doorway in it, and through the doorway the hold with the cargo strapped down.
//
// Sources read for this file:
//   https://en.wikipedia.org/wiki/De_Havilland_Canada_DHC-6_Twin_Otter  (15.77 m long, crew 1-2)
//   https://www.electra.aero (the EL9: hybrid-electric blown-lift STOL, eight props, two crew, nine pax)
//   Reliable Robotics' autonomous Caravan freighters (a pilot in the loop on the ground, not the seat).
//   The cockpit fit-out here is the game's fiction; nothing above is a source for a dimension inside.
//
// ── ⚠ THE ROOM IS THE EXTERIOR'S FUSELAGE ───────────────────────────────────
//
// client/shared/cabin-mule-2076.js states the hull's stations and where its glass is, and the
// exterior generator builds the shell and the panes from the same file. Everything here is read off
// it: the wall is the hull's own section walked at its own stations and pushed in by a wall's
// thickness, the windows are the absence of wall where the layout says glass, and the floor stops
// where it meets the hull. Nothing about the shape of the flight deck is typed here.
//
// ── ⚠ ONE SCALE: THE CONCEPT'S LENGTH OVER THE MODEL'S ──────────────────────
//
// MULE76_LENGTH_M over the compiled exterior's nose-to-tail length, so the room and the airframe
// agree about what a metre is. Anything about a PERSON (seat width, reach, a screen's size) is honest
// metres.
//
// ── ⚠ EVERY CONTROL IN ONE FORWARD VIEW, AND EVERY VALUE A REAL ONE ─────────
//
// The four keys the sim has (power and three lighting circuits) are glass keys on the band, the flap
// lever stands up on the pedestal's forward riser and the map is the one page you click; all of them
// are inside the forward look. The sidesticks, the thrust levers, the pedals and the flaps sit low, so
// each is mirrored in the windscreen HUD and on the motors page. Every number on every page is a live
// value or is derived from one in the open (power from thrust and rpm, endurance from hydrogen over
// burn); nothing shows a constant dressed as a reading, and nothing looks operable that isn't.
//
// ── ⚠ ANIMATION IS LIVE STATE, NEVER A CLOCK ────────────────────────────────
//
// The props on the motors page and in the hologram turn on `live.phase` (the prop phase cockpit.js
// already integrates for the exterior), the attitude and the tapes on the flight state, the tank and
// the projector's arc on the fuel. Decoration alone moves on wall time: the keys and the hand glow ease
// through the cockpit kit's `eased`, which settles on the target, the pages boot on `live.powerAge`
// (absent means long booted), and a warning's light lines breathe. Every readout is still a function
// of the live state.
//
// Pure apart from that easing: no camera, no DOM. `live` arrives as an argument.
import { makeKit, C, clamp, lerp, SHINY, TEXTURE } from './interior-kit.js';
import { contactShadow, hotspotHalo, panelGps, gpsHotspot, lensLamp, facingPanel, eased, pressPulse, HALO,
  bootAge, reveal, alertLight, sweep, lightLine, bandFrame, glassBand, holoFrame, holoProjector, windscreenHud,
  HOLO, HOLO_LINE, HOLO_AMBER, HOLO_RED, HUD_LINE, HUD_DIM, HUD_AMBER, HUD_RED } from './interior-cockpit-kit.js';
import { MESH_ROWS } from './vehicle-meshes.js';
import { compileMesh } from './vehicle-mesh.js';
import { MULE76_STATIONS, MULE76_GLASS, MULE76_INSIDE, MULE76_LENGTH_M, MULE76_APEX, MULE76_TAIL, muleSection, mulePoint } from './cabin-mule-2076.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ── THE STYLE ────────────────────────────────────────────────────────────────
// Warm grey lining and graphite, the Otter's working colours made clean, with the stock red as the
// stitch on the seats. The light that runs round the room and every display's normal colour is teal;
// amber is caution, red a warning, white the current value (one code on every screen).
export const MULE76_TRIM = {
  lining: [176, 176, 170], liningDk: [128, 130, 128], headliner: [196, 196, 190], hold: [102, 106, 104], holdRib: [82, 86, 86],
  graphite: [40, 43, 46], graphiteLt: [60, 64, 68], tub: [26, 28, 30],
  seat: [74, 70, 66], seatDk: [52, 50, 48], bolster: [38, 40, 42], red: [196, 58, 38],
  glow: [110, 230, 210], glowDim: [40, 92, 84],
  floor: [46, 48, 48], floorEdge: [30, 32, 32], metal: [150, 156, 164], harness: [70, 76, 82], buckle: [176, 182, 190],
  screen: [6, 12, 14], title: [70, 190, 172],
  warn: [235, 60, 48], amber: [255, 176, 64], white: [236, 244, 240], dim: [140, 170, 166],
  crate: [150, 118, 74], crateDk: [116, 90, 56], strap: [210, 160, 40], net: [70, 74, 62],
};
const T = MULE76_TRIM;
for (const k of ['lining', 'liningDk', 'headliner', 'hold']) TEXTURE.set(T[k], 'paint');
for (const k of ['graphite', 'graphiteLt', 'tub', 'holdRib']) TEXTURE.set(T[k], 'plastic');
for (const k of ['seat', 'seatDk', 'bolster']) TEXTURE.set(T[k], 'leather');
for (const k of ['floor', 'floorEdge']) TEXTURE.set(T[k], 'carpet');
for (const k of ['metal', 'buckle']) TEXTURE.set(T[k], 'brushed');
for (const k of ['crate', 'crateDk']) TEXTURE.set(T[k], 'wood');
TEXTURE.set(T.harness, 'fabric'); TEXTURE.set(T.strap, 'fabric'); TEXTURE.set(T.net, 'fabric');
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

// Where the pilot's eye is in the model: in the LEFT seat, a seated eye height over the deck floor,
// beside the crew door window and under the eyebrow window.
const EYE = { f: 0.6, g: -MULE76_INSIDE.seatG, overFloorM: 1.1 };
const WALL_M = 0.035;

// ── THE PROFILE ──────────────────────────────────────────────────────────────
export function mule2076Profile(doc = MESH_ROWS.prop_2076) {
  if (!doc) return null;
  const m = MULE76_LENGTH_M / modelLength(doc);
  const fE = EYE.f, gE = EYE.g, hE = MULE76_INSIDE.floorH + EYE.overFloorM / m;
  const X = (g) => (g - gE) * m, Y = (f) => (f - fE) * m, Z = (h) => (h - hE) * m;
  const toShell = (q) => [X(q[1]), Y(q[0]), Z(q[2])];
  const inset = WALL_M / m;
  const fB = MULE76_INSIDE.bulkheadF, zF = Z(MULE76_INSIDE.floorH);
  const G = { m, X, Y, Z, toShell, inset, fB, zF, fW: MULE76_GLASS.windscreen.f[0] };
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
  const D = MULE76_GLASS.door;
  const P = {
    label: 'Mule 2076 flight deck',
    xCentre, halfW,
    floor: z0 - 1e-6, roof: z1 + 1e-6, front: y1 + 1e-6, back: y0 - 1e-6,
    mPerUnit: m, glassAftY: Y(G.fW),
    // The side rays go out through the middle of each crew door window.
    winY: [Y(D.f[0] + 0.03), Y(D.f[1] - 0.03)], winZ: [Z(mulePoint(fE, D.a[0] + 6)[2]), Z(mulePoint(fE, D.a[1] - 6)[2])],
    dashY: DASH.yMid - DASH.sag * 0.2, dashZ: DASH.z0, headerZ: Z(mulePoint(G.fW, 80)[2]), pillarW: 0.03,
    seatZ: zF + 0.34, seatHalf: 0.25, seatY: [-0.34, 0.14], backZ: 0.02,
    roofGlass: false,          // straight up from the pilot is the overhead panel, between the eyebrows
    seats: 2, centrePost: 0,
    normalLit: true,
    floods: [{ p: [xCentre, 0.75, -0.2], r: 0.6 }, { p: [xCentre, -0.2, 0.45], r: 0.7 }],
    floodGain: 1.5, glare: 0.25,
    room: m76Shell,
    glass,
    m76: { ...G, faces: room.faces },
    hotspots(live) { return m76Hotspots(this, live); },
  };
  return P;
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
// Built once per profile: lining, headliner, the windscreen posts, the bulkhead and its doorway, the
// hold behind it, the floor, window reveals and the light that runs round the room. Nothing here moves.
function buildRoom(G) {
  const { toShell, inset, fB, zF, m } = G;
  const faces = [];
  const put = (p, n, tone, k, rgb, emis) => faces.push({ p, n, tone, k, rgb, emis: emis || 0 });
  const K = makeKit((fs, tone, k, fwd, rgb, emis) => { for (const f of fs) put(f.p, f.n, tone, k, rgb, emis); }, false);
  const S = (f, aDeg, inM = 0) => toShell(mulePoint(f, aDeg, -(inset + inM / m)));
  const inward = (f, a) => {
    const d = 1e-4;
    let n = norm(cross(sub(S(f + d, a), S(f - d, a)), sub(S(f, a + d * 50), S(f, a - d * 50))));
    const c = toShell([f, 0, muleSection(f).cz]);
    if (dot(n, sub(c, S(f, a))) < 0) n = mul(n, -1);
    return n;
  };
  const aboveFloor = (poly) => clipHalf(poly, (q) => q[2] - zF);
  const fH = MULE76_INSIDE.holdF, W = MULE76_GLASS.windscreen, E = MULE76_GLASS.eyebrow, Dg = MULE76_GLASS.door;

  // ── THE SHELL: the hold behind the bulkhead, then the flight deck, walked in the hull's own
  // (f, angle) with every pane cut out of it exactly (the rectangles in cabin-mule-2076.js, as holes).
  const FS = [fH, 0.4, 0.45, fB, 0.53, 0.565, 0.6, 0.64, 0.67, 0.68, W.f[0], 0.71, 0.735, 0.76, 0.785, 0.81, 0.83, W.f[1], 0.88, 0.91, 0.94];
  const NA = 64;
  const holes = [[[W.f[0], W.a[0]], [W.f[1], W.a[0]], [W.f[1], W.a[1]], [W.f[0], W.a[1]]]];
  for (const r of [E, Dg]) {
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
      const inHold = fm < fB;
      // The hold's ribs: a darker band every other bay.
      const rib = inHold && i % 2 === 0;
      for (const c of cells) {
        const poly = aboveFloor(c.map(([f, a]) => S(f, a)));
        if (poly.length < 3) continue;
        if (inHold) put(poly, n, 'pil', -0.15, rib ? T.holdRib : T.hold);
        else if (sn > 0.88) put(poly, n, 'hdr', -0.28, T.headliner);
        else if (sn < -0.25) put(poly, n, 'pil', -0.18, T.graphite);
        else put(poly, n, 'pil', -0.12, sn > 0.3 ? T.lining : T.liningDk);
      }
    }
  }

  // ── THE REVEALS: a graphite return round every window, from the lining out to the skin, and a lit
  // seal along its inner edge.
  const reveal = (pts, cF, cA, lit = true) => {
    for (let t = 1; t < pts.length; t++) {
      const [fa, aa] = pts[t - 1], [fb, ab] = pts[t];
      const i0 = S(fa, aa), i1 = S(fb, ab), o0 = toShell(mulePoint(fa, aa, -0.004 / m)), o1 = toShell(mulePoint(fb, ab, -0.004 / m));
      const fm = (fa + fb) / 2, am = (aa + ab) / 2;
      const toC = sub(S(cF, cA), S(fm, am));
      const out = norm(sub(toShell(mulePoint(fm, am, 0)), S(fm, am)));
      const rn = norm(sub(toC, mul(out, dot(toC, out))));
      if (i0[2] > zF && i1[2] > zF) put([i0, i1, o1, o0], rn, 'pil', 0.05, T.graphite);
      if (lit && i0[2] > zF + 0.01 && i1[2] > zF + 0.01) K.rod(S(fa, aa, 0.006), S(fb, ab, 0.006), 0.0035, 'pil', 0.1, T.glowDim, 0.35, 5, false);
    }
  };
  const edge = (f0, a0, f1, a1, n) => Array.from({ length: n + 1 }, (_, i) => [lerp(f0, f1, i / n), lerp(a0, a1, i / n)]);
  // The windscreen's aft arch, waist to waist over the top, and its sills.
  reveal(edge(W.f[0], W.a[0], W.f[0], W.a[1], 32), W.f[0] + 0.05, 90);
  reveal(edge(W.f[0], W.a[0], W.f[1], W.a[0], 8), (W.f[0] + W.f[1]) / 2, 60, false);
  reveal(edge(W.f[0], W.a[1], W.f[1], W.a[1], 8), (W.f[0] + W.f[1]) / 2, 120, false);
  for (const r of [E, Dg]) {
    for (const [aLo, aHi] of [r.a, [180 - r.a[1], 180 - r.a[0]]]) {
      const cF = (r.f[0] + r.f[1]) / 2, cA = (aLo + aHi) / 2;
      reveal([...edge(r.f[0], aLo, r.f[1], aLo, 6), ...edge(r.f[1], aLo, r.f[1], aHi, 6).slice(1), ...edge(r.f[1], aHi, r.f[0], aHi, 6).slice(1), ...edge(r.f[0], aHi, r.f[0], aLo, 6).slice(1)], cF, cA);
    }
  }
  // The windscreen posts, inside: graphite ribs down the glass where the exterior has its frames.
  for (const a of MULE76_GLASS.posts) {
    const pts = edge(W.f[0], a, W.f[1], a, 8).map(([f, aa]) => S(f, aa, -0.004));
    for (let k = 1; k < pts.length; k++) K.rod(pts[k - 1], pts[k], a === 90 ? 0.012 : 0.016, 'post', 0.05, T.graphite, 0, 6, false);
  }

  // ── THE CREW DOORS: a seam round each card, an armrest, a pull and a speaker ──
  for (const s of [1, -1]) {
    const A = (a) => (s > 0 ? a : 180 - a);
    // The armrest: a graphite blade along the card at elbow height, lit along its top edge.
    const aArm = A(-14);
    const ar0 = S(0.53, aArm, 0.05), ar1 = S(0.66, aArm, 0.05);
    const along = norm(sub(ar1, ar0));
    const aUp = norm(cross(cross(along, [0, 0, 1]), along));
    K.obox(mul(add(ar0, ar1), 0.5), along, aUp, norm(cross(along, aUp)), Math.hypot(...sub(ar1, ar0)) / 2, 0.025, 0.045, 'pil', 0.05, T.graphiteLt);
    K.rod(add(ar0, [0, 0, 0.026]), add(ar1, [0, 0, 0.026]), 0.004, 'pil', 0.2, T.glow, 0.9, 5);
    // The pull: a metal bar ahead of the armrest.
    const p0 = S(0.64, A(-2), 0.03), p1 = S(0.665, A(-2), 0.03);
    K.rod(p0, p1, 0.01, 'pil', 0.3, T.metal, 0, 8);
    for (const [q, f] of [[p0, 0.64], [p1, 0.665]]) K.rod(q, S(f, A(-2), 0.004), 0.007, 'pil', 0.3, T.metal, 0, 6);
    // The speaker, low on the card: a ring of holes in a graphite disc.
    const sc = S(0.6, A(-34), 0.004), sn2 = inward(0.6, A(-34)), sr = norm(cross([0, 0, 1], sn2)), su = cross(sn2, sr);
    const Sp = K.panel(add(sc, mul(sn2, 0.002)), sr, su, 'pil', 0.1);
    Sp.disc(0, 0, 0.06, T.graphite, 0, 0.001, 20);
    Sp.annulus(0, 0, 0.061, 0.067, T.glowDim, 0.5, 0.002, 20);
    for (let ring = 1; ring <= 2; ring++) for (let h = 0; h < ring * 8; h++) {
      const t = (h / (ring * 8)) * TAU, r = ring * 0.02;
      Sp.disc(Math.cos(t) * r, Math.sin(t) * r, 0.004, T.tub, 0, 0.002, 6);
    }
  }

  // ── THE BULKHEAD, with its doorway to the hold ──
  // The section at the bulkhead, clipped round a doorway on the centreline: three convex pieces.
  const NS = 72, bpts = [];
  for (let k = 0; k <= NS; k++) bpts.push(S(fB, -90 + (k / NS) * 360));
  const bulk = aboveFloor(bpts);
  const xC = G.X(0), yB = G.Y(fB), dw = MULE76_INSIDE.doorHalfM, dTop = zF + MULE76_INSIDE.doorTopM;
  for (const piece of [clipHalf(bulk, (q) => xC - dw - q[0]), clipHalf(bulk, (q) => q[0] - (xC + dw)), clipHalf(clipHalf(clipHalf(bulk, (q) => q[0] - (xC - dw)), (q) => xC + dw - q[0]), (q) => q[2] - dTop)]) {
    if (piece.length >= 3) put(piece, [0, 1, 0], 'post', -0.12, T.graphite);
  }
  // The doorway's frame: a lit return round three sides.
  for (const [a, b] of [[[xC - dw, yB, zF], [xC - dw, yB, dTop]], [[xC + dw, yB, zF], [xC + dw, yB, dTop]], [[xC - dw, yB, dTop], [xC + dw, yB, dTop]]]) {
    K.rod(a, b, 0.022, 'post', 0.05, T.graphiteLt, 0, 6);
    K.rod(add(a, [0, 0.024, 0]), add(b, [0, 0.024, 0]), 0.005, 'post', 0.2, T.glow, 0.7, 5);
  }
  // Two padded panels behind the seats, and a first-aid case on the pilot's side (a fixture).
  for (const cx of [0, 2 * xC]) {
    K.box(cx - 0.22, yB, zF + 0.4, cx + 0.22, yB + 0.03, zF + 1.15, 'post', -0.05, T.seatDk);
    for (let r = 1; r < 7; r++) K.box(cx - 0.22, yB + 0.03, zF + 0.4 + r * 0.107, cx + 0.22, yB + 0.034, zF + 0.404 + r * 0.107, 'post', -0.2, T.bolster);
  }
  K.box(-0.5, yB, zF + 1.25, -0.3, yB + 0.08, zF + 1.42, 'post', 0.05, [210, 212, 208]);
  K.box(-0.412, yB + 0.08, zF + 1.31, -0.388, yB + 0.082, zF + 1.36, 'post', 0.3, T.warn, 0.2);
  K.box(-0.43, yB + 0.08, zF + 1.325, -0.37, yB + 0.082, zF + 1.345, 'post', 0.3, T.warn, 0.2);

  // ── THE HOLD: its far wall, the cargo strapped to the floor, a net across the doorway's view ──
  const yH = G.Y(fH);
  const far = [];
  for (let k = 0; k <= NS; k++) far.push(S(fH, -90 + (k / NS) * 360));
  const farW = aboveFloor(far);
  if (farW.length >= 3) put(farW, [0, 1, 0], 'post', -0.2, T.holdRib);
  // Crates: three stacks, banded with straps to the floor rails.
  const crate = (cx, cy, w, d, h, z0) => {
    K.box(cx - w, cy - d, z0, cx + w, cy + d, z0 + h, 'post', 0.0, T.crate);
    K.box(cx - w - 0.004, cy - d - 0.004, z0 + h * 0.15, cx + w + 0.004, cy + d + 0.004, z0 + h * 0.2, 'post', -0.1, T.crateDk);
    K.box(cx - w - 0.004, cy - d - 0.004, z0 + h * 0.8, cx + w + 0.004, cy + d + 0.004, z0 + h * 0.85, 'post', -0.1, T.crateDk);
    K.box(cx - 0.02, cy - d - 0.006, z0, cx + 0.02, cy + d + 0.006, z0 + h + 0.006, 'post', 0.1, T.strap);
  };
  crate(xC - 0.5, yH + 0.35, 0.3, 0.25, 0.6, zF);
  crate(xC - 0.5, yH + 0.35, 0.24, 0.2, 0.42, zF + 0.6);
  crate(xC + 0.45, yH + 0.4, 0.32, 0.3, 0.75, zF);
  crate(xC + 0.05, yH + 0.25, 0.18, 0.18, 0.36, zF);
  // Tie-down rings along the rails, each a hoop standing on its pad.
  for (const dx of [-0.75, -0.25, 0.25, 0.75]) for (let k = 0; k < 4; k++) {
    const c = [xC + dx, yH + 0.15 + k * ((yB - yH - 0.3) / 3), zF + 0.016];
    K.rod(add(c, [-0.02, -0.02, -0.004]), add(c, [0.02, 0.02, -0.004]), 0.012, 'floor', 0.1, T.graphiteLt, 0, 6);
    K.torus(add(c, [0, 0, 0.012]), [0, 1, 0], [0, 0, 1], 0.014, 0.0025, 8, 'floor', 0.2, T.metal, 0);
  }
  // Floor rails, and a lit strip down the middle of the hold floor.
  for (const dx of [-0.75, -0.25, 0.25, 0.75]) K.box(xC + dx - 0.015, yH, zF, xC + dx + 0.015, yB, zF + 0.012, 'floor', 0.1, T.metal);
  K.box(xC - 0.006, yH, zF + 0.001, xC + 0.006, yB, zF + 0.004, 'floor', 0.2, T.glow, 0.6);
  // The cargo net, hung across the hold a stride aft of the bulkhead.
  const yN = yB - 0.25;
  for (let i = 0; i <= 8; i++) {
    const x = xC - 0.8 + i * 0.2;
    K.rod([x, yN, zF + 0.02], [x, yN, zF + 1.55], 0.006, 'post', 0, T.net, 0, 4, false);
  }
  for (let j = 0; j <= 7; j++) {
    const z = zF + 0.05 + j * 0.21;
    K.rod([xC - 0.8, yN, z], [xC + 0.8, yN, z], 0.006, 'post', 0, T.net, 0, 4, false);
  }

  // ── THE FLOOR: dark mats from the hold to under the deck, edged in light ──
  const floorHalf = (f) => {
    let prev = null;
    for (let a = -90; a <= 0; a += 1) {
      const q = mulePoint(f, a, -inset);
      if (prev && prev[2] < MULE76_INSIDE.floorH && q[2] >= MULE76_INSIDE.floorH) {
        const t = (MULE76_INSIDE.floorH - prev[2]) / (q[2] - prev[2]);
        return (prev[1] + (q[1] - prev[1]) * t) * m;
      }
      prev = q;
    }
    return 0;
  };
  const FF = [];
  for (let f = fH; f < 0.84; f += 0.02) FF.push(f);
  for (let i = 0; i < FF.length - 1; i++) {
    const f0 = FF[i], f1 = FF[i + 1], w0 = floorHalf(f0), w1 = floorHalf(f1);
    if (w0 <= 0.01 || w1 <= 0.01) continue;
    const hold = f1 <= fB + 1e-9;
    put([[xC - w0, G.Y(f0), zF], [xC + w0, G.Y(f0), zF], [xC + w1, G.Y(f1), zF], [xC - w1, G.Y(f1), zF]], [0, 0, 1], 'floor', -0.2, hold ? T.holdRib : (i % 5 === 4 ? T.floorEdge : T.floor));
    if (!hold) for (const s of [-1, 1]) K.box(xC + s * (w0 - 0.04) - 0.006, G.Y(f0), zF + 0.001, xC + s * (w0 - 0.04) + 0.006, G.Y(f1), zF + 0.004, 'floor', 0.2, T.glow, 0.85);
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
      panes.push([[fa, aa], [fb, aa], [fb, ab], [fa, ab]].map(([f, a]) => toShell(mulePoint(f, a, -d))));
    }
  };
  const W = MULE76_GLASS.windscreen, E = MULE76_GLASS.eyebrow, Dg = MULE76_GLASS.door;
  grid(W.f[0], W.f[1], W.a[0], W.a[1], 6, 28);
  for (const r of [E, Dg]) {
    grid(r.f[0], r.f[1], r.a[0], r.a[1], 3, 3);
    grid(r.f[0], r.f[1], 180 - r.a[1], 180 - r.a[0], 3, 3);
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
function m76Shell(P, live, push, rich) {
  const D = P.m76;
  for (const f of D.faces) push(f.one || (f.one = Object.assign([{ p: f.p, n: f.n }], { stable: true })), f.tone, f.k, false, f.rgb, f.emis || 0);
  seats(P, push);
  if (rich) m76Fit(P, live, push);
}

// ── THE READINGS ─────────────────────────────────────────────────────────────
const readings = (live) => {
  const L = live || {};
  const R = {
    L,
    pitch: num(L.pitch), bank: num(L.bank), hdg: num(L.hdg),
    ias: Math.max(0, num(L.ias)), alt: Math.max(0, num(L.alt)), vsi: num(L.vsi),
    rpm: clamp(num(L.rpm), 0, 1.1), thr: clamp(num(L.throttle), 0, 1),
    fuel: clamp(num(L.fuel, 1), 0, 1), hull: clamp(num(L.hull, 1), 0, 1),
    powered: L.powered !== false,
    ail: clamp(num(L.stickX), -1, 1), elev: clamp(num(L.stickY), -1, 1), rud: clamp(num(L.rudder), -1, 1),
    flap: clamp(Math.round(num(L.flapNotch)), 0, 3),
    land: !!L.landingLight, dome: !!L.dome, hour: num(L.hour, 12),
    phase: num(L.phase), stall: !!L.stall,
    // Each bank's lever and spool, left then right (cockpit.js splits them; the sim's two engines are
    // the two banks of four), falling back to the ganged pair.
    thrs: [0, 1].map((e) => clamp(num(L.throttles?.[e], num(L.throttle)), 0, 1)),
    rpms: [0, 1].map((e) => clamp(num(L.rpms?.[e], num(L.rpm)), 0, 1.1)),
    split: !!L.split,
  };
  // ⚠ THE ENERGY NUMBERS ARE DERIVED IN THE OPEN, from thrust and prop speed, never typed. The eight
  // motors draw up to 900 kW at full thrust and full rpm (two PT6s' worth, the Otter it replaces). The
  // hydrogen turbogenerator runs at a cruise setting under the demand and the buffer battery makes up
  // the difference, or soaks up the surplus when the demand is below it. Endurance is the tank (120 kg
  // of liquid hydrogen full) over the turbine's burn at 13.3 kWe per kg an hour.
  R.demand = R.powered ? Math.round(900 * clamp((R.thrs[0] * R.rpms[0] + R.thrs[1] * R.rpms[1]) / 2, 0, 1)) : 0;
  R.gen = R.powered && R.fuel > 0.005 && R.rpm > 0.05 ? Math.round(Math.min(520, 120 + R.demand * 0.55)) : 0;
  R.batt = R.demand - R.gen;                       // + discharging into the motors, - charging
  R.endur = R.gen > 0 ? Math.min(999, Math.round(R.fuel * 120 / (R.gen / 13.3) * 60)) : 0;
  R.handsOn = R.powered && (Math.abs(R.ail) > 0.03 || Math.abs(R.elev) > 0.03 || Math.abs(R.rud) > 0.03);
  return R;
};
const night = (R) => R.hour < 6.5 || R.hour > 19.5;
const panelOn = (R) => R.powered && (R.L.panelLight != null ? !!R.L.panelLight : night(R));

// ── WHERE THE CONTROLS ARE ───────────────────────────────────────────────────
// One place says where each thing you can grab or click is; the drawing and the hotspots both read it.
// Shell metres, the eye at the origin, the pilot in the left seat and the centreline to the right.
const STICK = { x: -0.42, y: 0.12, z: 0.53, len: 0.13 };             // z off the floor; outboard left
const PED = { hw: 0.12, y0: 0.0, y1: 0.66, top: 0.5, riserY: 0.54, riserTop: 0.56, nose: 0.86 };   // the pedestal, z off the floor
const LEVER = { pivotY: 0.3, len: 0.15, dx: [-0.035, 0.035] };      // twin thrust levers, left and right banks
const FLAP = { dx: 0.075, y0: 0.58, y1: 0.66 };                       // the flap lever on the riser, UP forward, FULL aft
function stickAt(P, R, x = STICK.x) {
  const base = [x, STICK.y, P.m76.zF + STICK.z];
  const dir = norm([R.ail * 0.32, R.elev * 0.32, 1]);
  return { base, top: add(base, mul(dir, STICK.len)), dir };
}
// `dx` is the lever's slot; its bank (left or right) picks which lever value it stands at. `t` overrides
// it, for the point between the two grips.
function leverAt(P, R, dx, t = R.thrs[dx < 0 ? 0 : 1]) {
  const pivot = [P.xCentre + dx, LEVER.pivotY, P.m76.zF + PED.top];
  const ang = -0.6 + t * 1.2;
  const dir = [0, Math.sin(ang), Math.cos(ang)];
  return { pivot, end: add(pivot, mul(dir, LEVER.len)), dir };
}
function flapKnob(P, R) {
  const y = lerp(FLAP.y0, FLAP.y1, 1 - R.flap / 3);
  return [P.xCentre + FLAP.dx, y, P.m76.zF + PED.riserTop + 0.07];
}

// ── THE DECK: one sculpted wing from door to door, and on its face toward the crew one band of glass ──
// The band runs wall to wall in a shallow arc centred on the aisle, so it comes round toward each
// seat, and every page, key and lamp sits on it. `curve(s)` gives the band's lower edge and the
// outward direction across the deck; the deck body is swept along the same curve, so the glass is the
// deck's own face.
const DASH = { xL: -0.6, xR: 1.46, yMid: 0.86, sag: 0.14, w: 1.03, z0: -0.4, h: 0.27, lean: 0.45 };
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

// ── THE PAGES on the band, booting in turn: the motors outboard of the pilot, the flight page in
// front of her, the map (the one page you click) by the aisle, the energy page, and the manifest in
// front of the right-hand seat. A flat page on the curved sheet is lifted clear of it at its ends.
const SCREENS = [
  { id: 'motors', x: -0.38, title: 'MOTORS', boot: 0.3 },
  { id: 'pfd', x: 0.0, title: 'FLIGHT', boot: 0 },
  { id: 'map', x: 0.47, title: 'NAV', boot: 0.15 },
  { id: 'energy', x: 0.82, title: 'ENERGY H2', boot: 0.45 },
  { id: 'manifest', x: 1.17, title: 'MANIFEST', boot: 0.6 },
];
const SW = 0.15, SH = 0.105, PAGE_V = 0.15;
const screenPanel = (K, P, sc) => bandPanel(K, P, sc.x, PAGE_V, 0.014);
// The status lamps along the band's foot, under the motors and the flight page.
const LAMP_X = [-0.5, -0.33, -0.16, 0.01, 0.18, 0.35], LAMP_V = 0.022;

// ── THE KEYS: four glass keys on the band between the flight page and the map ──
const BTN = { ids: ['master', 'land', 'panel', 'dome'], names: { master: 'PWR', land: 'LAND', panel: 'PANEL', dome: 'CABIN' } };
const BTN_AT = (i) => ({ x: [0.205, 0.27][i % 2], v: [0.19, 0.115][i >> 1] });
function switchOn(id, R) {
  if (id === 'master') return R.powered;
  if (id === 'land') return R.land;
  if (id === 'panel') return panelOn(R);
  if (id === 'dome') return R.dome && R.powered;
  return R.powered;
}

// ── THE WINDSCREEN HUD: where it is projected, ahead of the pilot and inside the hull ──
const HUD = { dist: 0.72, z: 0.01, hw: 0.21, hh: 0.11 };
// ── THE HOLOGRAM: over the deck's shelf, right of the pilot's line and clear of the HUD ──
const HOLO_AT = { x: 0.62, out: 0.27, rise: 0.07, scale: 0.095 };

export function m76Hotspots(P, live) {
  const R = readings(live), K = makeKit(() => {}), out = [];
  BTN.ids.forEach((id, i) => { const b = BTN_AT(i); out.push({ id: 'ck:' + id, p: bandPanel(K, P, b.x, b.v).pt(0, 0, 0.01), r: 0.028, kind: 'click' }); });
  out.push({ id: 'ck:flaps', p: flapKnob(P, R), r: 0.035, kind: 'click' });
  out.push({ id: 'yoke', p: add(stickAt(P, R).top, [0, 0, 0.04]), r: 0.06, kind: 'yoke' });
  // Each grip moves its own bank; a hand between the two moves the pair and brings them together.
  const lv = leverAt(P, R, 0, (R.thrs[0] + R.thrs[1]) / 2);
  out.push({ id: 'throttle', p: add(lv.end, mul(lv.dir, 0.03)), r: 0.025, kind: 'throttle' });
  LEVER.dx.forEach((dx, e) => { const g = leverAt(P, R, dx); out.push({ id: 'thr' + e, p: add(g.end, mul(g.dir, 0.03)), r: 0.04, kind: 'throttle', engine: e }); });
  out.push(gpsHotspot(screenPanel(K, P, SCREENS.find((sc) => sc.id === 'map')), 0, -0.012, 0.07));
  return out;
}

// ── THE SEATS: crew seats on rails, graphite shells and grey leather, a red stitch, five-point harness ──
function seats(P, push) {
  const K = makeKit(push, false);
  for (const cx of [0, 2 * P.xCentre]) crewSeat(K, P, cx);
}
function crewSeat(K, P, cx) {
  const h = P.seatHalf, [y0, y1] = P.seatY, sz = P.seatZ, zF = P.m76.zF;
  // The rails and the pedestal.
  for (const s of [-1, 1]) K.box(cx + s * 0.16 - 0.015, y0 - 0.05, zF, cx + s * 0.16 + 0.015, y1 + 0.1, zF + 0.03, 'seat', 0.1, T.metal);
  K.box(cx - 0.13, y0 + 0.06, zF + 0.03, cx + 0.13, y1 - 0.1, sz - 0.12, 'seat', -0.25, T.graphite);
  K.box(cx - h, y0, sz - 0.12, cx + h, y1, sz - 0.06, 'seat', 0.0, T.graphite);
  K.box(cx - h + 0.05, y0 + 0.02, sz - 0.06, cx + h - 0.05, y1 - 0.02, sz, 'seat', 0.08, T.seat);
  for (const s of [-1, 1]) {
    K.box(cx + s * h - s * 0.05, y0, sz - 0.06, cx + s * h, y1, sz + 0.06, 'seat', 0.05, T.bolster);
    K.box(cx + s * (h - 0.025) - 0.003, y0 + 0.02, sz + 0.06, cx + s * (h - 0.025) + 0.003, y1 - 0.02, sz + 0.064, 'seat', 0.2, T.red, 0.2);
  }
  // Quilting: rows across the cushion insert, and a field of perforations between them.
  for (let i = 1; i < 5; i++) {
    const y = lerp(y0 + 0.02, y1 - 0.02, i / 5);
    K.box(cx - h + 0.06, y - 0.003, sz + 0.0005, cx + h - 0.06, y + 0.003, sz + 0.002, 'seat', -0.3, T.seatDk);
  }
  for (let i = 0; i < 8; i++) for (let j = 0; j < 7; j++) {
    const y = lerp(y0 + 0.05, y1 - 0.05, i / 7), x = cx + lerp(-h + 0.09, h - 0.09, j / 6);
    K.box(x - 0.0035, y - 0.0035, sz + 0.0005, x + 0.0035, y + 0.0035, sz + 0.0018, 'seat', -0.3, T.seatDk);
  }
  const lean = 0.22, bb = [cx, y0 - 0.01, sz], up = [0, -Math.sin(lean), Math.cos(lean)], fw = [0, Math.cos(lean), Math.sin(lean)];
  const bH = 0.64;
  const bc = add(bb, mul(up, bH / 2));
  K.obox(add(bc, mul(fw, -0.06)), [1, 0, 0], up, fw, h, bH / 2, 0.04, 'seat', -0.06, T.graphite);
  K.obox(add(bc, mul(fw, -0.015)), [1, 0, 0], up, fw, h - 0.06, bH / 2 - 0.04, 0.012, 'seat', 0.0, T.seat);
  for (const s of [-1, 1]) K.obox(add(add(bc, mul(fw, -0.005)), [s * (h - 0.03), 0, 0]), [1, 0, 0], up, fw, 0.03, bH / 2, 0.04, 'seat', 0.0, T.bolster);
  for (let i = 1; i < 5; i++) K.obox(add(add(bb, mul(up, bH * i / 5)), mul(fw, -0.002)), [1, 0, 0], up, fw, h - 0.07, 0.003, 0.012, 'seat', -0.3, T.seatDk);
  const hc = add(bb, mul(up, bH + 0.11));
  K.obox(add(hc, mul(fw, -0.04)), [1, 0, 0], up, fw, 0.13, 0.10, 0.05, 'seat', 0.0, T.graphite);
  K.obox(add(hc, mul(fw, 0.012)), [1, 0, 0], up, fw, 0.10, 0.07, 0.008, 'seat', 0.0, T.seat);
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
export function m76Fit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live);
  const zF = P.m76.zF, xC = P.xCentre;
  const lit = R.powered, panel = panelOn(R);
  const amb = lit ? (night(R) ? 1 : 0.55) * (R.dome ? 1.2 : 1) : 0.05;
  const boot = bootAge(live);
  // The light lines carry the alert: teal, amber on low hydrogen, red and breathing on a hull or stall
  // warning. They are the first thing in the room to change colour.
  const warn = lit && (R.hull < 0.3 || R.stall), caution = lit && R.fuel < 0.15;
  const al = alertLight(caution, warn), lineK = (k) => (lit ? k * al.k : 0.05);
  // How near the hand is to a control: eased up while the pointer is over it or pressing it.
  const near = (key, ids) => eased('m76:near:' + key, live && ids.some((id) => live.hover === id || live.press === id) ? 1 : 0, 12);

  // ── THE DECK: a wing swept along the band's curve ──
  const curve = dashCurve(P);
  const gt = [DASH.h * DASH.lean / Math.hypot(1, DASH.lean), DASH.h / Math.hypot(1, DASH.lean)];   // the glass's top, across and up
  // The section, from the glass's foot up its face, under a brow that hoods the glass's top edge,
  // over the shelf, down the nose and back under to the lip. Set 4 mm in behind the glass, so the band
  // lies on the deck instead of in it.
  const g0 = 0.004;
  const SEC = [[g0, 0], [gt[0] + g0, gt[1]], [0.085, gt[1] + 0.022], [0.1, gt[1] + 0.036], [0.21, 0.29], [0.34, 0.272], [0.375, 0.2],
    [0.28, -0.05], [0.08, -0.13], [-0.06, -0.09], [-0.07, -0.04], [g0, 0]];
  const N = 36, rings = [];
  for (let i = 0; i <= N; i++) {
    // Toward each wall the wing thins and drops, as the hull closes in over it.
    const s = i / N, c = curve(s), e = Math.abs(2 * s - 1) ** 3, tap = 1 - 0.6 * e;
    rings.push(SEC.map(([f, z]) => {
      const ff = f > gt[0] + g0 ? gt[0] + g0 + (f - gt[0] - g0) * tap : f < 0 ? f * tap : f;
      return [c.p[0] + c.f[0] * ff, c.p[1] + c.f[1] * ff, c.p[2] + (z > gt[1] ? gt[1] + (z - gt[1]) * tap : z) - (z > 0.05 ? 0.05 * e : 0)];
    }));
  }
  sweep(K, rings, 'dash', 0.1, T.graphite);
  // The end caps: the section, shut, as a fan from its middle (the brow makes it not quite convex).
  for (const r of [rings[0], rings[N]]) {
    const pts = r.slice(0, -1), mid = mul(pts.reduce((a, q) => add(a, q), [0, 0, 0]), 1 / pts.length);
    const n = norm(cross(sub(r[5], r[1]), sub(r[8], r[1])));
    for (let j = 0; j < pts.length; j++) {
      const tri = [mid, pts[j], pts[(j + 1) % pts.length]];
      K.face(tri, n, 'dash', 0.05, T.graphiteLt);
      K.face(tri.slice().reverse(), mul(n, -1), 'dash', 0.05, T.graphiteLt);
    }
  }
  // A soft-touch strip along the shelf, light lines along the brow's edge, the lip under the glass and
  // the shelf's far edge, and a seam where the nose turns under.
  for (let i = 2; i < N - 2; i++) {
    const a = rings[i], b = rings[i + 1], lift = [0, 0, 0.003];
    const q = [add(a[4], lift), add(b[4], lift), add(lerp3(b[4], b[5], 0.85), lift), add(lerp3(a[4], a[5], 0.85), lift)];
    K.face(q, norm(cross(sub(q[1], q[0]), sub(q[3], q[0]))), 'dash', 0.15, T.tub);
  }
  lightLine(K, rings.slice(1, -1).map((r) => add(r[2], [0, 0, -0.002])), 0.0025, al.rgb, lineK(0.9));
  lightLine(K, rings.map((r) => r[9]), 0.003, al.rgb, lineK(0.8));
  lightLine(K, rings.slice(2, -2).map((r) => add(r[5], [0, 0, 0.002])), 0.002, al.rgb, lineK(0.35));
  lightLine(K, rings.slice(1, -1).map((r) => r[7]), 0.002, T.tub, 0);
  // The deck stands on two blades down to the floor, outboard of each pair of pedals, each with a lit
  // edge toward the cabin.
  for (const x of [-0.42, 2 * xC + 0.42]) {
    const c = curve(sOf(x)), top = add(add(c.p, mul(c.f, 0.1)), [0, 0, -0.1]), foot = [top[0], top[1] - 0.06, zF];
    const up = norm(sub(top, foot)), along = norm(cross([1, 0, 0], up)), mid = mul(add(top, foot), 0.5), half = Math.hypot(...sub(top, foot)) / 2;
    K.obox(mid, [1, 0, 0], up, along, 0.009, half, 0.045, 'dash', 0.05, T.graphite);
    lightLine(K, [add(foot, add(mul(along, -0.046), [0, 0, 0.04])), add(top, add(mul(along, -0.046), [0, 0, -0.02]))], 0.0025, al.rgb, lineK(0.6));
    K.obox(add(foot, [0, 0, 0.006]), [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.03, 0.006, 0.07, 'dash', 0.05, T.graphiteLt);
  }

  // ── THE BAND: one sheet of glass, the pages on it, booting in turn when the power comes on ──
  glassBand(K, curve, { h: DASH.h, lean: DASH.lean, segs: 36, lit, light: al.rgb, lightK: lineK(1), substrate: T.screen });
  for (const sc of SCREENS) {
    const Pn = screenPanel(K, P, sc), up = reveal(boot, sc.boot);
    if (!lit || up <= 0) continue;
    // The boot: a lit line sweeps up the page and the page comes up behind it.
    if (up < 1) {
      const y = lerp(-SH, SH, up);
      Pn.rect(-SW, -SH, SW, y, T.screen, 0.3 * up, 0.001);
      Pn.rect(-SW, y - 0.002, SW, y + 0.002, T.glow, 1, 0.0025);
      continue;
    }
    // One display language on every page: a lit edge along the top and the page's name under it,
    // teal for normal, amber for caution, red for a warning, the current value the brightest thing.
    Pn.rect(-SW, -SH, SW, SH, T.screen, 0.3, 0.0005);
    Pn.rect(-SW + 0.004, SH - 0.0035, SW - 0.004, SH - 0.0015, T.glow, 0.85, 0.0018);
    Pn.fitText(sc.title, 0, SH - 0.0185, SW * 1.4, 0.011, T.title, panel ? 0.9 : 0.7, 0.0026);
    if (sc.id === 'pfd') pfd(Pn, R);
    else if (sc.id === 'motors') motorsPage(Pn, R);
    else if (sc.id === 'energy') energyPage(Pn, R);
    else if (sc.id === 'map') mapPage(Pn, R, live);
    else if (sc.id === 'manifest') manifestPage(Pn, R, live);
  }
  // The status lamps along the foot of the band: what the aircraft thinks of you.
  {
    // ⚠ PILOT PRESENT IS THE RIDER'S LAMP: lit whenever the seat is powered and occupied, which is
    // whenever this cockpit is drawn. It is the one thing on the panel the insurer reads.
    const lamps = [
      ['PILOT PRESENT', lit, C.green], ['HANDS ON', R.handsOn, T.glow], ['AUTONOMY ADVISORY', lit, T.amber],
      ['LOW H2', caution, T.warn], ['STALL', lit && R.stall, T.warn], ['HULL', lit && R.hull < 0.3, T.warn],
    ];
    const up = reveal(boot, 0.75) >= 1;
    lamps.forEach(([name, on, rgb], i) => lensLamp(bandPanel(K, P, LAMP_X[i], LAMP_V, 0.012), 0, 0, 0.16, 0.028, on && up, rgb, name));
  }

  // ── THE KEYS: four glass keys on the band ──
  // A key sinks while pressed and comes back, its light eases on and off with the circuit, it
  // brightens as the hand comes over it, and a ring flashes round it when its state changes.
  BTN.ids.forEach((id, i) => {
    const b = BTN_AT(i), Kp = bandPanel(K, P, b.x, b.v, 0.006), on = switchOn(id, R);
    const pressed = !!live && live.press === 'ck:' + id;
    const rgb = id === 'master' ? C.green : T.glow;
    const glow = eased('m76:glow:' + id, on ? 1 : 0, 10), depth = eased('m76:dip:' + id, pressed ? 0.002 : 0.007, 30);
    const hand = near('key:' + id, ['ck:' + id]);
    Kp.rect(-0.031, -0.031, 0.031, 0.031, T.tub, 0, 0.0005);
    Kp.annulus(0, 0, 0.029, 0.031, T.glow, (lit ? 0.25 : 0) + hand * 0.75, 0.0012, 20);
    Kp.stud(0, 0, 0.026, 0.026, depth, rgb.map((c, k) => lerp([40, 46, 50][k], c, glow * 0.8)), glow * 0.85 + hand * 0.15, 0.0015);
    Kp.fitText(BTN.names[id], 0, -0.004, 0.044, 0.012, glow > 0.5 ? [10, 24, 22] : [214, 222, 220], glow > 0.5 ? 0 : (panel ? 0.6 : 0.25), depth + 0.0025);
    const flash = pressPulse('m76:key:' + id, on);
    if (flash > 0.02) Kp.annulus(0, 0, 0.034, 0.038, HALO, flash, 0.004, 18);
  });

  // ── THE WINDSCREEN HUD: projected, conformal, with both banks' levers, the stick, the pedals and
  // the flaps mirrored round its edges, so the forward view shows every low control ──
  if (lit) {
    const life = reveal(boot, 0.2);
    const Hp = windscreenHud(K, R, { ...HUD, warn, caution, boot: life, mirrors: { stick: [R.ail, R.elev], thrs: R.thrs, rud: R.rud } });
    if (life > 0) hudFlaps(Hp, R, warn ? HUD_RED : caution ? HUD_AMBER : HUD_LINE);
  }

  // ── THE HOLOGRAM over the deck's shelf: the Mule herself, flying as she flies ──
  // Pitched and banked with her, each bank's four props turning on the prop phase and ringed at that
  // bank's speed, standing on a projector whose arc is the hydrogen left.
  {
    const c0 = curve(sOf(HOLO_AT.x)), shelf = lerp(0.29, 0.272, (HOLO_AT.out - 0.21) / 0.13);
    const base = add(add(c0.p, mul(c0.f, HOLO_AT.out)), [0, 0, shelf + 0.003]);
    holoProjector(K, base, HOLO_AT.rise, 0.06, lit ? R.fuel : 0, R.fuel < 0.15 ? HOLO_RED : R.fuel < 0.3 ? HOLO_AMBER : HOLO_LINE);
    if (lit && reveal(boot, 0.7) > 0) holoMule(K, add(base, [0, 0, HOLO_AT.rise + 0.03]), R);
  }

  // ── THE PEDESTAL between the seats: swept, rising to the flap riser and running on under the deck ──
  const pt = zF + PED.top, rt = zF + PED.riserTop;
  {
    const top = (y) => lerp(pt, rt, smooth01((y - (PED.riserY - 0.03)) / 0.06));
    const NP = 16, prings = [];
    for (let i = 0; i <= NP; i++) {
      const y = lerp(PED.y0, PED.nose, i / NP), hw = PED.hw * (0.92 + 0.08 * i / NP) + 0.004;
      prings.push(roundSection(xC, y, hw, zF, top(y), 0.12));
    }
    sweep(K, prings, 'dash', 0.05, T.graphite);
    K.face(prings[0].slice(), [0, -1, 0], 'dash', 0.05, T.graphiteLt);
    for (const s of [1, 9]) lightLine(K, prings.map((r) => add(r[s], [0, 0, 0.003])), 0.0025, al.rgb, lineK(0.85));
    // The kick strip along each side at ankle height.
    for (const s of [0, 10]) lightLine(K, prings.slice(0, 10).map((r) => add(r[s], [s ? -0.002 : 0.002, 0, 0.07])), 0.003, T.tub, 0);
  }
  // The thrust gate: a slot for each lever and a lit tick every quarter, the full tick amber.
  for (const dx of LEVER.dx) {
    K.box(xC + dx - 0.009, LEVER.pivotY - 0.13, pt - 0.003, xC + dx + 0.009, LEVER.pivotY + 0.13, pt + 0.005, 'dash', -0.3, T.tub);
    for (let i = 0; i <= 4; i++) {
      const y = LEVER.pivotY - 0.11 + i * 0.055, t = R.thrs[dx < 0 ? 0 : 1], here = lit && Math.abs(i / 4 - t) < 0.13;
      K.box(xC + dx + (dx < 0 ? -0.026 : 0.012), y - 0.002, pt + 0.002, xC + dx + (dx < 0 ? -0.012 : 0.026), y + 0.002, pt + 0.006, 'dash', 0.2, i === 4 ? T.amber : here ? T.glow : T.glowDim, here || i === 4 ? 0.9 : 0.5);
    }
  }
  // The levers, left bank and right bank. Each moves its own bank of four motors; a grip lights as
  // the hand comes to it, and both light for the hand between them that moves the pair.
  for (const dx of LEVER.dx) {
    const e = dx < 0 ? 0 : 1, lv = leverAt(P, R, dx), t = R.thrs[e];
    const hand = near('thr' + e, ['thr' + e, 'throttle']);
    K.rod(lv.pivot, lv.end, 0.009, 'dash', 0.2, T.metal, 0, 8);
    const gripEnd = add(lv.end, mul(lv.dir, 0.05)), side = norm(cross([1, 0, 0], lv.dir));
    K.obox(mul(add(lv.end, gripEnd), 0.5), [1, 0, 0], lv.dir, side, 0.02, 0.03, 0.016, 'dash', 0.1, T.graphiteLt);
    K.obox(add(gripEnd, mul(lv.dir, 0.002)), [1, 0, 0], side, lv.dir, 0.016, 0.01, 0.003, 'dash', 0.3, T.glow, lit ? 0.3 + t * 0.5 + hand * 0.2 : 0);
    // The grip's light ring, the alert colour, brightening under the hand.
    K.obox(add(mul(add(lv.end, gripEnd), 0.5), mul(side, 0.0165)), [1, 0, 0], lv.dir, side, 0.021, 0.004, 0.001, 'dash', 0.3, al.rgb, lit ? 0.2 + hand * 0.8 : 0);
  }
  // The flap gate on the riser: four detents lettered UP 1 2 F, the lever and its lit knob.
  {
    const gx = xC + FLAP.dx;
    K.box(gx - 0.008, FLAP.y0 - 0.012, rt - 0.003, gx + 0.008, FLAP.y1 + 0.012, rt + 0.005, 'dash', -0.3, T.tub);
    const Fp = K.panel([gx - 0.06, (FLAP.y0 + FLAP.y1) / 2, rt + 0.0055], [1, 0, 0], [0, 1, 0], 'dash', 0.3);
    ['F', '2', '1', 'UP'].forEach((s, i) => {
      const v = lerp(FLAP.y0, FLAP.y1, i / 3) - (FLAP.y0 + FLAP.y1) / 2;
      Fp.rect(0.04, v - 0.0015, 0.052, v + 0.0015, 3 - i === R.flap ? T.white : T.glowDim, 0.8, 0.001);
      Fp.text(s, 0.018, v - 0.006, 0.013, 3 - i === R.flap ? T.white : T.dim, panel ? 0.7 : 0.35, 0.001);
    });
    const kb = flapKnob(P, R), base = [gx, kb[1], rt];
    const press = !!live && live.press === 'ck:flaps', hand = near('flaps', ['ck:flaps']);
    const dip = eased('m76:flapdip', press ? 0.008 : 0, 30);
    K.rod(base, add(kb, [0, 0, -0.012 - dip]), 0.006, 'dash', 0.2, T.metal, 0, 6);
    // The knob is an aerofoil section, the way flap levers are the world over.
    K.obox(add(kb, [0, 0, -dip]), [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.026, 0.012, 0.014, 'dash', 0.15, [214, 218, 220]);
    K.obox(add(kb, [0, 0, 0.0125 - dip]), [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.022, 0.006, 0.001, 'dash', 0.3, T.glow, lit ? 0.6 + hand * 0.4 : 0);
    K.obox(add(kb, [0, -0.0125, -dip]), [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.027, 0.003, 0.001, 'dash', 0.3, al.rgb, lit ? 0.15 + hand * 0.85 : 0);
    const flash = pressPulse('m76:flap', R.flap);
    if (flash > 0.02) facingPanel(K, kb, 'dash', 0).annulus(0, 0, 0.034, 0.039, HALO, flash, 0.003, 18);
  }

  // ── THE SIDESTICKS, outboard of each seat on a swept side console ──
  const stHand = near('yoke', ['yoke']);
  for (const [x, own] of [[STICK.x, true], [2 * xC - STICK.x, false]]) {
    const st = stickAt(P, R, x), arm = st.base, s = x < xC ? -1 : 1;
    const crings = [], pads = [];
    for (let i = 0; i <= 8; i++) {
      const y = lerp(-0.3, arm[1] + 0.1, i / 8);
      crings.push(roundSection(arm[0], y, 0.06, zF, arm[2] - 0.005, 0.1));
    }
    sweep(K, crings, 'dash', 0.05, T.graphite);
    K.face(crings[0].slice(), [0, -1, 0], 'dash', 0.05, T.graphiteLt);
    K.face(crings[8].slice().reverse(), [0, 1, 0], 'dash', 0.05, T.graphiteLt);
    // The leather pad the forearm rests on, a cushion along the console's top.
    for (let i = 0; i <= 6; i++) pads.push(roundSection(arm[0], lerp(-0.28, arm[1] - 0.05, i / 6), 0.05, arm[2] - 0.008, arm[2] + 0.014, 0.018));
    sweep(K, pads, 'dash', 0.1, T.seat);
    lightLine(K, crings.map((r) => add(r[s < 0 ? 0 : 10], [-s * 0.002, 0, 0.11])), 0.003, al.rgb, lineK(0.7 * amb / Math.max(0.05, amb)));
    const hand = own ? stHand : 0;
    K.rod(add(arm, [0, 0, -0.01]), add(arm, [0, 0, 0.012]), 0.035, 'dash', 0.1, T.tub, 0, 14);
    K.torus(add(arm, [0, 0, 0.012]), [1, 0, 0], [0, 1, 0], 0.036, 0.004, 18, 'dash', 0.2, R.handsOn && own ? C.green : al.rgb, lit ? 0.5 + 0.5 * hand : 0);
    K.rod(add(arm, [0, 0, 0.012]), add(arm, mul(st.dir, 0.04)), 0.022, 'dash', -0.1, T.tub, 0, 10);
    K.rod(add(arm, mul(st.dir, 0.03)), st.top, 0.011, 'dash', 0.2, T.metal, 0, 8);
    const gdir = norm(add(st.dir, [0, 0.12, 0]));
    const gTop = add(st.top, mul(gdir, 0.09));
    K.rod(st.top, gTop, 0.022, 'dash', 0.05, T.graphiteLt, 0, 12);
    K.rod(add(gTop, mul(gdir, -0.005)), add(gTop, mul(gdir, 0.008)), 0.016, 'dash', 0.2, T.graphite, 0, 12);
    K.obox(add(gTop, mul(gdir, 0.009)), [1, 0, 0], [0, 1, 0], gdir, 0.007, 0.007, 0.002, 'dash', 0.3, T.glow, lit ? 0.6 + 0.4 * hand : 0);
    K.obox(add(st.top, add(mul(gdir, 0.05), [0, 0.021, 0])), [1, 0, 0], gdir, [0, 1, 0], 0.006, 0.012, 0.005, 'dash', 0.2, T.graphite);
  }

  // ── THE PEDALS: a pair for each seat, sliding on rails, one forward as the other comes back ──
  for (const cx of [0, 2 * xC]) {
    const pz = zF + 0.14, py = 0.92;
    for (const [dx, sgn] of [[-0.1, -1], [0.1, 1]]) {
      const slide = clamp(R.rud * sgn, -1, 1) * 0.05;
      K.box(cx + dx - 0.012, py - 0.12, zF, cx + dx + 0.012, py + 0.12, zF + 0.02, 'dash', 0.1, T.metal);
      const c = [cx + dx, py + slide, pz];
      K.obox(c, [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.045, 0.1, 0.008, 'dash', 0.05, T.graphite);
      K.obox(add(c, mul(norm([0, -0.89, -0.45]), -0.009)), [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.038, 0.088, 0.002, 'dash', 0.1, T.tub);
      // The pedal's own light strip, brighter the further it is pressed.
      K.obox(add(c, mul(norm([0, -0.89, -0.45]), -0.012)), [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.004, 0.07, 0.001, 'dash', 0.2, al.rgb, lit ? 0.3 + 0.7 * clamp(R.rud * sgn, 0, 1) : 0);
      K.rod(add(c, [0, 0, -0.06]), [cx + dx, py + slide, zF + 0.02], 0.012, 'dash', 0.2, T.metal, 0, 6);
      contactShadow(K, [cx + dx, py + slide, zF], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.05, 0.11);
    }
  }

  // ── OVERHEAD: a graphite console between the eyebrow windows, light lines, the dome light ──
  // ⚠ NO CONTROL THE SIM DOES NOT HAVE: the overhead is a fixture, lights and a grille, nothing to pull.
  {
    const D = P.m76;
    const O = (f, a, inM) => D.toShell(mulePoint(f, a, -(D.inset + inM / D.m)));
    const fs = [0.52, 0.56, 0.6, 0.64, 0.68];
    for (let i = 0; i < fs.length - 1; i++) {
      const a0 = O(fs[i], 82, 0.01), a1 = O(fs[i], 98, 0.01), b0 = O(fs[i + 1], 82, 0.01), b1 = O(fs[i + 1], 98, 0.01);
      K.face([a0, b0, b1, a1], [0, 0, -1], 'hdr', 0.05, T.graphite, 0);
      K.face([add(a0, [0, 0, -0.04]), add(a1, [0, 0, -0.04]), add(b1, [0, 0, -0.04]), add(b0, [0, 0, -0.04])], [0, 0, -1], 'hdr', 0.05, T.graphiteLt, 0);
      for (const [p, q] of [[a0, b0], [a1, b1]]) K.face([p, q, add(q, [0, 0, -0.04]), add(p, [0, 0, -0.04])], norm([p[0] < xC ? 1 : -1, 0, 0]), 'hdr', 0.05, T.graphite, 0);
    }
    const s0 = add(O(0.52, 90, 0.01), [0, 0, -0.042]), s1 = add(O(0.68, 90, 0.01), [0, 0, -0.042]);
    const ohK = (lit ? al.k : 1) * Math.max(amb, 0.2);
    K.rod(add(s0, [-0.07, 0, 0]), add(s1, [-0.07, 0, 0]), 0.004, 'hdr', 0.2, al.rgb, ohK, 5);
    K.rod(add(s0, [0.07, 0, 0]), add(s1, [0.07, 0, 0]), 0.004, 'hdr', 0.2, al.rgb, ohK, 5);
    // The cabin air grille: a field of slots between the light lines (a fixture, not a control).
    for (let i = 0; i < 9; i++) for (const dx of [-0.035, 0.035]) {
      const c = add(O(0.6 + i * 0.008, 90, 0.01), [dx, 0, -0.0415]);
      K.box(c[0] - 0.022, c[1] - 0.004, c[2] - 0.002, c[0] + 0.022, c[1] + 0.004, c[2], 'hdr', -0.3, T.tub);
    }
    const dome = add(O(0.56, 90, 0.01), [0, 0, -0.045]);
    K.rod(dome, add(dome, [0, 0, -0.012]), 0.045, 'hdr', 0.1, R.dome && lit ? [240, 252, 248] : [80, 84, 84], R.dome && lit ? 1 : 0, 14);
  }

  hotspotHalo(K, m76Hotspots(P, live), live);
}

// A console's section at `y`: a flat crown `top` high that rolls over into two vertical sides
// `hw` either side of `cx`, `drop` of the roll, down to `z0`. Eleven points, floor to floor.
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
    const y = -0.032 - i * 0.012, sel = i === R.flap;
    Hp.rect(fx - (sel ? 0.008 : 0.004), y - (sel ? 0.0016 : 0.0008), fx + (sel ? 0.008 : 0.004), y + (sel ? 0.0016 : 0.0008), sel ? col : HUD_DIM, 1, 0.001);
  }
  Hp.text(['UP', '1', '2', 'F'][R.flap], fx - 0.002, -0.09, 0.011, col, 1, 0.001);
}

// ── THE HOLOGRAM: the Mule in miniature, 23 cm across ──
// Her boxy hull as section rings and four chines, the high wing and its struts, the eight motors on
// the leading edge with their props turning on the prop phase, each ringed in its bank's speed, the
// turbogenerator on the crown, and the T-tail. Drawn off the hull's own stations (cabin-mule-2076.js),
// so she is the shape of the aircraft outside. The frame is her pitch and bank.
const HOLO_WING = [{ g: 0.12, le: 0.37, te: -0.12, h: 0.19 }, { g: 1.1, le: 0.33, te: -0.08, h: 0.198 }, { g: 1.15, le: 0.325, te: -0.075, h: 0.198 }];
const HOLO_PROP = { f: 0.505, h: 0.165, r: 0.096 };
function holoMule(K, c, R) {
  const H = holoFrame(K, c, R.pitch, R.bank);
  const sc = HOLO_AT.scale;
  const M = (f, g, h) => [g * sc, (f - 0.05) * sc, (h - 0.08) * sc];
  // The hull: section rings at five stations, and the crown, keel and four chines nose to tail.
  const ST = [0.95, 0.81, 0.6, 0.3, -0.15, -0.44, -0.72, -0.92];
  const ring = (f) => Array.from({ length: 13 }, (_, i) => { const q = mulePoint(f, -90 + i * 30); return M(q[0], q[1], q[2]); });
  for (const f of [0.81, 0.6, -0.15, -0.58]) { const r = ring(f); for (let i = 0; i < 12; i++) H.line(r[i], r[i + 1], 0.0006); }
  for (const a of [-90, -45, -135, 45, 135, 90]) {
    const pts = [M(...MULE76_APEX), ...ST.map((f) => { const q = mulePoint(f, a); return M(q[0], q[1], q[2]); }), M(...MULE76_TAIL)];
    for (let i = 0; i + 1 < pts.length; i++) H.line(pts[i], pts[i + 1], a === 90 || a === -90 ? 0.0008 : 0.0006);
  }
  // The windscreen, a lit plate across the nose.
  {
    const W = MULE76_GLASS.windscreen, pts = [];
    for (const a of [0, 45, 90, 135, 180]) { const q = mulePoint(W.f[0] + 0.02, a); pts.push(M(q[0], q[1], q[2])); }
    for (const a of [180, 135, 90, 45, 0]) { const q = mulePoint(W.f[1] - 0.04, a); pts.push(M(q[0], q[1], q[2])); }
    for (let i = 0; i < 4; i++) H.plate([pts[i], pts[i + 1], pts[8 - i], pts[9 - i]], HOLO, 0.7);
  }
  // The high wing, each side a plate with its edges lined, a raked winglet, and a strut to the hull.
  for (const s of [1, -1]) {
    const le = HOLO_WING.map((w) => M(w.le, s * w.g, w.h)), te = HOLO_WING.map((w) => M(w.te, s * w.g, w.h));
    for (let i = 0; i + 1 < le.length; i++) {
      H.plate([le[i], le[i + 1], te[i + 1], te[i]], HOLO, 0.45);
      H.line(le[i], le[i + 1], 0.0008); H.line(te[i], te[i + 1], 0.0007);
    }
    H.line(le[le.length - 1], te[te.length - 1], 0.0007);
    H.line(M(0.3, s * 1.15, 0.2), M(0.02, s * 1.205, 0.3), 0.0007); H.line(M(0.02, s * 1.205, 0.3), M(-0.07, s * 1.15, 0.2), 0.0007);
    // The flaps' hinge line, and each flap drawn down to the notch.
    const fd = R.flap / 3 * 0.06;
    H.line(M(-0.03, s * 0.15, 0.19), M(-0.01, s * 1.0, 0.196), 0.0005, HOLO);
    H.line(M(-0.11 - fd * 0.3, s * 0.15, 0.19 - fd), M(-0.08 - fd * 0.3, s * 1.0, 0.196 - fd), 0.0007, R.flap ? HOLO_LINE : HOLO);
    H.line(M(0.12, s * 0.14, -0.06), M(0.14, s * 0.62, 0.185), 0.0006);
  }
  // The eight motors: a nacelle along the chord, the prop disc ahead of it ringed in its bank's speed
  // (the left four and the right four), and three blade lines turning on the prop phase.
  MOTOR_G.forEach((g, i) => {
    const e = g < 0 ? 0 : 1, frac = clamp(R.rpms[e] / 1.05, 0, 1), on = R.powered && R.rpms[e] > 0.02;
    const hub = M(HOLO_PROP.f, g, HOLO_PROP.h), rr = HOLO_PROP.r * sc;
    H.line(M(HOLO_PROP.f - 0.01, g, HOLO_PROP.h), M(0.12, g, HOLO_PROP.h + 0.02), 0.0012);
    H.ring(hub, [1, 0, 0], [0, 0, 1], rr, 10, HOLO, 0.35);
    if (frac > 0.01) H.ring(hub, [1, 0, 0], [0, 0, 1], rr * 1.12, Math.max(2, Math.round(12 * frac)), frac > 0.85 ? HOLO_LINE : HOLO_AMBER, on ? 1 : 0.4, Math.PI / 2, Math.PI / 2 - frac * TAU);
    const dir = (i % 2 ? 1 : -1) * (g < 0 ? -1 : 1);
    for (let b = 0; b < 3; b++) {
      const t = (on ? R.phase * 2.4 * dir : 0) + b * TAU / 3 + i * 0.4;
      H.line(hub, add(hub, [Math.cos(t) * rr * 0.92, 0, Math.sin(t) * rr * 0.92]), 0.0007, HOLO_LINE, on ? 1 : 0.5);
    }
  });
  // The turbogenerator nacelle on the crown behind the wing, two rings and its spine.
  H.line(M(-0.13, 0, 0.215), M(-0.42, 0, 0.215), 0.0008);
  for (const f of [-0.16, -0.38]) H.ring(M(f, 0, 0.215), [1, 0, 0], [0, 0, 1], 0.035 * sc, 8, HOLO_LINE, 0.8);
  // The fin, a plate with its edges, and the tailplane across its top.
  const fin = [M(-0.55, 0, 0.13), M(-0.9, 0, 0.13), M(-0.97, 0, 0.56), M(-0.8, 0, 0.56)];
  H.plate(fin, HOLO, 0.45);
  for (let i = 0; i < 4; i++) H.line(fin[i], fin[(i + 1) % 4], i === 3 ? 0.0006 : 0.0008);
  for (const s of [1, -1]) {
    const tp = [M(-0.79, 0, 0.562), M(-0.86, s * 0.4, 0.566), M(-0.98, s * 0.4, 0.566), M(-0.965, 0, 0.562)];
    H.plate(tp, HOLO, 0.45);
    H.line(tp[0], tp[1], 0.0008); H.line(tp[1], tp[2], 0.0007); H.line(tp[2], tp[3], 0.0007);
  }
}

// ── THE FLIGHT PAGE: attitude, speed and height tapes, a heading tape, the vertical speed ──
const LBL = [140, 176, 170];
function pfd(Pn, R) {
  Pn.attitude(0, -0.006, 0.066, R.pitch, R.bank);
  tape(Pn, -0.115, R.ias, 5, 10, 'KT');
  tape(Pn, 0.115, R.alt, 50, 100, 'FT');
  // The heading tape along the bottom: a tick every 5°, scrolling, the number in a box.
  const span = 30, w = 0.1, yb = -0.098;
  Pn.rect(-w, yb, w, yb + 0.016, [10, 18, 20], 0.3, 0.002);
  const h0 = Math.floor((R.hdg - span) / 5) * 5;
  for (let d = h0; d <= R.hdg + span; d += 5) {
    const u = ((d - R.hdg) / span) * w;
    if (Math.abs(u) > w - 0.002) continue;
    const big = ((d % 30) + 30) % 30 === 0;
    Pn.rect(u - 0.0008, yb + (big ? 0.002 : 0.008), u + 0.0008, yb + 0.016, T.glow, 0.7, 0.003);
  }
  Pn.rect(-0.02, yb - 0.002, 0.02, yb + 0.018, T.screen, 0.2, 0.0035);
  Pn.digits(-0.017, yb + 0.001, 0.013, String(Math.round(((R.hdg % 360) + 360) % 360)).padStart(3, '0'), T.white);
  // The vertical speed: a bar from the middle of the right edge, up or down.
  const vs = clamp(R.vsi / 1500, -1, 1);
  Pn.rect(0.143, -0.07, 0.147, 0.07, [20, 30, 32], 0.2, 0.002);
  if (Math.abs(vs) > 0.01) Pn.rect(0.142, Math.min(0, vs * 0.07), 0.148, Math.max(0, vs * 0.07), vs > 0 ? T.glow : T.amber, 0.9, 0.003);
  if (R.stall) Pn.rect(-0.07, 0.055, 0.07, 0.07, T.warn, 1, 0.004);
}
function tape(Pn, u, v, step, major, unit) {
  const hh = 0.066, w = 0.024, span = step * 6;
  Pn.rect(u - w, -hh, u + w, hh, [10, 18, 20], 0.3, 0.002);
  const v0 = Math.floor((v - span) / step) * step;
  for (let t = v0; t <= v + span; t += step) {
    if (t < 0) continue;
    const b = ((t - v) / span) * hh;
    if (Math.abs(b) > hh - 0.003) continue;
    const big = t % major === 0, side = u < 0 ? 1 : -1;
    Pn.rect(u + side * w - side * (big ? 0.012 : 0.006), b - 0.0007, u + side * w, b + 0.0007, T.glow, 0.7, 0.003);
  }
  Pn.rect(u - w - 0.003, -0.011, u + w + 0.003, 0.011, T.screen, 0.2, 0.0035);
  const s = String(Math.round(v));
  Pn.digits(u - w + 0.002, -0.007, 0.014, s.length > 5 ? s.slice(-5) : s, T.white, false);
  Pn.text(unit, u, -hh - 0.016, 0.012, LBL, 0.5, 0.003);
}

// ── THE MOTORS PAGE: the wing from above, the eight props turning, rpm round each, the levers, the flaps ──
const MOTOR_G = [-0.93, -0.71, -0.49, -0.27, 0.27, 0.49, 0.71, 0.93];
function motorsPage(Pn, R) {
  const sx = 0.13, wy = 0.03;
  // The wing: leading edge and trailing edge, the flaps drawn deflected to the notch.
  Pn.rect(-1.15 * sx, wy - 0.0012, 1.15 * sx, wy + 0.0012, [70, 120, 112], 0.6, 0.003);
  Pn.rect(-1.15 * sx, wy - 0.024, 1.15 * sx, wy - 0.022, [70, 120, 112], 0.6, 0.003);
  Pn.rect(-0.006, -0.03, 0.006, 0.06, [70, 120, 112], 0.4, 0.003);
  const fd = R.flap / 3, flapCol = R.flap ? T.white : T.glowDim;
  for (const s of [-1, 1]) Pn.rect(s > 0 ? 0.008 : -0.62 * sx * 1.15, wy - 0.026 - fd * 0.012, s > 0 ? 0.62 * sx * 1.15 : -0.008, wy - 0.024, flapCol, 0.8, 0.0035);
  const on = R.powered && R.rpm > 0.02;
  MOTOR_G.forEach((g, i) => {
    // Each motor shows its own bank's speed: the left four and the right four.
    const frac = clamp(R.rpms[i < 4 ? 0 : 1] / 1.05, 0, 1), ring = frac > 0.85 ? T.glow : T.amber;
    const cu = g * sx, cv = wy + 0.012;
    Pn.annulus(cu, cv, 0.0125, 0.0145, [30, 44, 44], 0.3, 0.003, 14);
    if (frac > 0.01) Pn.annulus(cu, cv, 0.0125, 0.0145, ring, 0.95, 0.0035, Math.max(2, Math.round(14 * frac)), Math.PI / 2, Math.PI / 2 - frac * TAU);
    // Five blades on the prop phase, neighbours turning opposite ways as on the aircraft.
    const dir = (i % 2 ? 1 : -1) * (i < 4 ? -1 : 1);
    for (let b = 0; b < 5; b++) Pn.spoke(cu, cv, (on ? R.phase * 2.4 * dir : 0) + b * TAU / 5 + i * 0.4, 0.002, 0.011, 0.0012, T.white, 0.85, 0.0045, 0.0006);
    Pn.disc(cu, cv, 0.0022, [200, 210, 210], 0.6, 0.005, 6);
  });
  // The thrust levers, mirrored: a bar for each bank, filled to the thrust, the idle and full marks.
  for (const [u, nm, e] of [[-0.118, 'L', 0], [0.118, 'R', 1]]) {
    const t = R.thrs[e];
    Pn.rect(u - 0.007, -0.088, u + 0.007, -0.01, [20, 30, 32], 0.3, 0.002);
    if (t > 0.005) Pn.rect(u - 0.005, -0.086, u + 0.005, lerp(-0.086, -0.012, t), t > 0.95 ? T.amber : T.glow, 0.9, 0.003);
    Pn.text(nm, u + (u < 0 ? 0.018 : -0.018), -0.088, 0.012, LBL, 0.5, 0.003);
  }
  // Big values: rpm and thrust as percentages, and the flap notch.
  Pn.text('RPM', -0.05, -0.028, 0.012, LBL, 0.5, 0.003);
  Pn.digits(-0.075, -0.06, 0.022, String(Math.round(R.rpm * 100)).padStart(3, ' '), on ? T.white : T.dim, false);
  Pn.text('FLAP', 0.05, -0.028, 0.012, LBL, 0.5, 0.003);
  Pn.text(['UP', '1', '2', 'FULL'][R.flap], 0.05, -0.058, 0.018, T.white, 0.9, 0.003);
  Pn.text((on ? '8/8 ON' : 'OFF'), 0, -0.094, 0.012, on ? T.glow : T.dim, 0.7, 0.003);
}

// ── THE ENERGY PAGE: the hydrogen tank, the turbogenerator, the buffer battery, the motors' draw ──
function energyPage(Pn, R) {
  // The tank: a capsule filled to the hydrogen left, its percentage big beside it.
  const tx = -0.11, ty0 = -0.085, ty1 = 0.06, col = R.fuel < 0.15 ? T.warn : R.fuel < 0.3 ? T.amber : T.glow;
  Pn.rect(tx - 0.022, ty0, tx + 0.022, ty1, [20, 30, 32], 0.3, 0.002);
  Pn.rect(tx - 0.018, ty0 + 0.004, tx + 0.018, lerp(ty0 + 0.004, ty1 - 0.004, R.fuel), col, 0.9, 0.003);
  for (let i = 1; i < 4; i++) Pn.rect(tx + 0.022, lerp(ty0, ty1, i / 4) - 0.0008, tx + 0.03, lerp(ty0, ty1, i / 4) + 0.0008, T.glowDim, 0.6, 0.003);
  Pn.text('H2', tx, ty1 + 0.006, 0.012, LBL, 0.5, 0.003);
  Pn.digits(-0.07, 0.038, 0.022, String(Math.round(R.fuel * 100)).padStart(3, ' '), col === T.glow ? T.white : col, false);
  Pn.text('PCT', 0.0, 0.043, 0.011, LBL, 0.5, 0.003);
  // Three flows in kilowatts, each a bar on one scale: the motors' demand, the turbogenerator, and the
  // battery, which charges (teal, left) or discharges (amber, right) to make up the difference.
  const row = (y, name, kw, max, rgb, signed = false) => {
    Pn.text(name, -0.055, y - 0.006, 0.011, LBL, 0.5, 0.003);
    const x0 = -0.02, x1 = 0.14;
    Pn.rect(x0, y - 0.004, x1, y + 0.004, [20, 30, 32], 0.3, 0.002);
    if (signed) {
      const mid = (x0 + x1) / 2, f = clamp(kw / max, -1, 1);
      Pn.rect(mid - 0.0006, y - 0.007, mid + 0.0006, y + 0.007, T.dim, 0.6, 0.003);
      if (Math.abs(f) > 0.01) Pn.rect(Math.min(mid, mid + f * (x1 - mid)), y - 0.003, Math.max(mid, mid + f * (x1 - mid)), y + 0.003, f > 0 ? T.amber : T.glow, 0.9, 0.0035);
    } else if (kw > 0) Pn.rect(x0, y - 0.003, lerp(x0, x1, clamp(kw / max, 0, 1)), y + 0.003, rgb, 0.9, 0.0035);
  };
  row(0.012, 'MOT', R.demand, 900, R.demand > 820 ? T.amber : T.glow);
  row(-0.018, 'GEN', R.gen, 900, T.glow);
  row(-0.048, 'BAT', R.batt, 450, T.glow, true);
  // The demand in kilowatts, big, and the endurance at this burn in minutes.
  Pn.text('KW', 0.03, -0.072, 0.011, LBL, 0.5, 0.003);
  Pn.digits(0.05, -0.08, 0.016, String(R.demand).padStart(3, ' '), T.white, false);
  Pn.text('MIN', -0.055, -0.072, 0.011, LBL, 0.5, 0.003);
  Pn.digits(-0.04, -0.098, 0.014, String(R.endur).padStart(3, ' '), R.gen ? T.white : T.dim, false);
}

// ── THE MAP: the kit's moving map, the distance to go, the heading ──
function mapPage(Pn, R, live) {
  panelGps(Pn, 0, -0.012, 0.14, 0.08, live, { label: false, bezel: [8, 14, 16] });
  const g = live && live.gpsTo;
  if (g && Number.isFinite(g.dist)) {
    Pn.text('DIST', 0.088, 0.06, 0.011, LBL, 0.5, 0.009);
    Pn.digits(0.07, 0.03, 0.014, String(Math.min(999, Math.round(g.dist))).padStart(3, ' '), T.white, false);
  }
  Pn.digits(-0.125, 0.045, 0.013, String(Math.round(((R.hdg % 360) + 360) % 360)).padStart(3, '0'), T.white, false);
}

// ── THE MANIFEST: the page the pilot is here to sign ──
// Signed whenever the seat is powered and occupied, because the signature is the pilot's presence;
// the warm hands state, the hull the cover depends on, and the distance left to the consignee.
function manifestPage(Pn, R, live) {
  const signed = R.powered;
  Pn.rect(-0.13, 0.03, 0.13, 0.075, signed ? [12, 40, 30] : [20, 24, 26], 0.4, 0.002);
  Pn.fitText(signed ? 'SIGNED' : 'UNSIGNED', 0, 0.045, 0.24, 0.018, signed ? C.green : T.amber, 0.9, 0.003);
  Pn.text('WARM HANDS', -0.06, 0.008, 0.011, LBL, 0.5, 0.003);
  Pn.rect(0.06, 0.006, 0.13, 0.022, R.handsOn ? C.green : [30, 40, 40], R.handsOn ? 0.9 : 0.2, 0.003);
  Pn.text(R.handsOn ? 'YES' : 'IDLE', 0.095, 0.009, 0.011, R.handsOn ? [10, 24, 16] : T.dim, R.handsOn ? 0 : 0.5, 0.004);
  // The hull, a bar in the colour of its state.
  Pn.text('HULL', -0.1, -0.022, 0.011, LBL, 0.5, 0.003);
  Pn.rect(-0.06, -0.026, 0.13, -0.014, [20, 30, 32], 0.3, 0.002);
  Pn.rect(-0.058, -0.024, lerp(-0.058, 0.128, R.hull), -0.016, R.hull < 0.3 ? T.warn : R.hull < 0.6 ? T.amber : T.glow, 0.9, 0.003);
  Pn.text('COVER', -0.1, -0.052, 0.011, LBL, 0.5, 0.003);
  Pn.text(signed ? 'IN FORCE' : 'VOID', 0.04, -0.052, 0.012, signed ? T.white : T.warn, 0.9, 0.003);
  const g = live && live.gpsTo;
  Pn.text('TO GO', -0.1, -0.082, 0.011, LBL, 0.5, 0.003);
  Pn.digits(0.01, -0.088, 0.014, g && Number.isFinite(g.dist) ? String(Math.min(999, Math.round(g.dist))).padStart(3, ' ') : '---', T.white, false);
}
