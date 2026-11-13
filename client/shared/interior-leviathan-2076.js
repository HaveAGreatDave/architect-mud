// THE LEVIATHAN 2076'S FLIGHT DECK: the inside of the concept freighter's cab, as geometry.
//
// The Leviathan 2076 is the heavy class's concept body (mesh_heavy_2076.json): the An-124 fifty years
// on, after JetZero's blended wing body and Radia's WindRunner. One lifting body as wide as the hold,
// four hydrogen turbofans on its back, and the cargo visor kept: the whole nose swings up to load, and
// the flight deck rides up with it, in a glazed cab standing proud on the nose. She can fly herself.
// Halcyon's Warm Hands Rider voids the hull cover on any flight logged without a living pilot at the
// controls, so the controls are there, they work, and the panel says politely that they are advisory.
//
// So it is a working room, and a big one: two crew side by side a long way apart, the captain on the
// LEFT, a centre stick ahead of each seat, a pedestal between them with four thrust levers and the
// flap lever, and a sculpted deck from wall to wall with one curved band of glass across it carrying
// every page, key and lamp. The flight symbology is projected into the windscreen, and a hologram of
// the aircraft stands on the deck's shelf with her nose coming up when the visor does. Behind the
// seats is a bulkhead with a doorway to the crew rest.
//
// Sources read for this file:
//   https://en.wikipedia.org/wiki/Antonov_An-124_Ruslan  (68.96 m long, crew of six, nose visor)
//   https://www.jetzero.aero (the Z4 blended wing body: a flight deck in the nose of the centrebody)
//   https://www.radia.com (the WindRunner: an outsize freighter for wind turbine blades)
//   The cockpit fit-out here is the game's fiction; nothing above is a source for a dimension inside.
//
// ── ⚠ THE ROOM IS THE EXTERIOR'S CAB ────────────────────────────────────────
//
// client/shared/cabin-leviathan-2076.js states the cab's stations and where its glass is, and the
// exterior generator builds the cab and the panes from the same file. Everything here is read off it:
// the wall is the cab's own section walked at its own stations and pushed in by a wall's thickness,
// the windows are the absence of wall where the layout says glass, and the floor stops where it meets
// the cab. Nothing about the shape of the flight deck is typed here.
//
// ── ⚠ ONE SCALE: THE CONCEPT'S LENGTH OVER THE MODEL'S ──────────────────────
//
// LEV76_LENGTH_M over the compiled exterior's nose-to-tail length, so the room and the airframe agree
// about what a metre is. Anything about a PERSON (seat width, reach, a screen's size) is honest metres.
//
// ── ⚠ EVERY CONTROL IN ONE FORWARD VIEW, AND EVERY VALUE A REAL ONE ─────────
//
// The four keys the sim has (power and three lighting circuits) and the gear lever are on the band,
// the flap lever stands on the pedestal's riser and the map is the one page you click; all of them are
// inside the forward look. The stick, the four thrust levers, the pedals and the flaps sit low,
// so each is mirrored in the windscreen HUD (four thrust carets, one per engine) and the levers again
// on the engines page. Every number on every page is a live value or derived from one in the open.
// The sim carries no cargo mass, so the cargo page shows the visor, the ramp and the throttle baulk
// the open nose puts on, and says plainly that the load is not sensed.
//
// ── ⚠ ANIMATION IS LIVE STATE, NEVER A CLOCK ────────────────────────────────
//
// The fans on the engines page and in the hologram turn on `live.phase`, each ringed in its own
// engine's rpm; the attitude and the tapes on the flight state; the tank and the projector's arc on
// the hydrogen; the hologram's nose and the cargo page's visor on `live.noseVisor`. Decoration alone
// moves on wall time: the keys and the hand glow ease through the kit's `eased`, the pages boot on
// `live.powerAge` (absent means long booted), and a warning's light lines breathe.
//
// Pure apart from that easing: no camera, no DOM. `live` arrives as an argument.
import { nightAt } from './sky-keys.js';
import { brandTrim } from './interior-brands.js';
import { makeKit, C, clamp, lerp, SHINY, TEXTURE } from './interior-kit.js';
import { contactShadow, hotspotHalo, panelGps, gpsHotspot, lensLamp, facingPanel, eased, pressPulse, HALO,
  bootAge, reveal, alertLight, sweep, lightLine, bandFrame, glassBand, holoFrame, holoProjector, windscreenHud,
  HOLO, HOLO_LINE, HOLO_AMBER, HOLO_RED, HUD_DIM, HUD_LINE, HUD_AMBER, HUD_RED, stickColumn } from './interior-cockpit-kit.js';
import { MESH_ROWS } from './vehicle-meshes.js';
import { compileMesh } from './vehicle-mesh.js';
import { LEV76_BODY, LEV76_BODY_APEX, LEV76_BODY_TE, LEV76_CAB_APEX, LEV76_GLASS, LEV76_INSIDE, LEV76_LENGTH_M, LEV76_VISOR,
  levCabSection, levCabPoint, levBodySection, levBodyPoint, levBodySurface } from './cabin-leviathan-2076.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ── THE STYLE ────────────────────────────────────────────────────────────────
// Cool pearl lining and graphite, the freight line's blue as the stitch on the seats. The light that
// runs round the room and every display's normal colour is teal; amber is caution, red a warning,
// white the current value (one code on every screen).
export const LEV76_TRIM = {
  lining: [184, 188, 192], liningDk: [134, 138, 144], headliner: [204, 208, 212], rest: [104, 108, 114], restRib: [84, 88, 94],
  graphite: [38, 41, 46], graphiteLt: [58, 62, 68], tub: [24, 26, 30],
  seat: [70, 74, 82], seatDk: [50, 52, 58], bolster: [36, 38, 42], blue: [40, 90, 180],
  glow: [110, 230, 210], glowDim: [40, 92, 84],
  floor: [44, 46, 50], floorEdge: [30, 32, 36], metal: [150, 156, 164], harness: [70, 76, 82], buckle: [176, 182, 190],
  screen: [6, 12, 14], title: [70, 190, 172],
  warn: [235, 60, 48], amber: [255, 176, 64], white: [236, 244, 240], dim: [140, 170, 166],
  bunk: [62, 70, 84], blanket: [40, 72, 140],
};
const T = LEV76_TRIM;
for (const k of ['lining', 'liningDk', 'headliner', 'rest']) TEXTURE.set(T[k], 'paint');
for (const k of ['graphite', 'graphiteLt', 'tub', 'restRib']) TEXTURE.set(T[k], 'plastic');
for (const k of ['seat', 'seatDk', 'bolster', 'bunk']) TEXTURE.set(T[k], 'leather');
for (const k of ['floor', 'floorEdge']) TEXTURE.set(T[k], 'carpet');
for (const k of ['metal', 'buckle']) TEXTURE.set(T[k], 'brushed');
TEXTURE.set(T.harness, 'fabric'); TEXTURE.set(T.blanket, 'fabric');
SHINY.set(T.graphite, { spec: 0.4, pow: 28 });
SHINY.set(T.graphiteLt, { spec: 0.35, pow: 24 });
SHINY.set(T.metal, { spec: 0.7, pow: 36 });
SHINY.set(T.buckle, { spec: 0.8, pow: 40 });
SHINY.set(T.screen, { spec: 0.6, pow: 60 });
brandTrim(T, 'leviathan', TEXTURE, SHINY);

// ── THE EXTERIOR, MEASURED ──────────────────────────────────────────────────
function modelLength(doc) {
  let fMax = -Infinity, fMin = Infinity;
  for (const f of compileMesh(doc, { detail: 1 }).faces) {
    if (f.role === 'rotor' || f.role === 'interior' || f.role === 'ramp') continue;
    for (const q of f.p) { if (q[0] > fMax) fMax = q[0]; if (q[0] < fMin) fMin = q[0]; }
  }
  return fMax - fMin;
}

// Where the captain's eye is in the model: in the LEFT seat, a seated eye height over the deck floor.
const EYE = { f: LEV76_INSIDE.eyeF, g: -LEV76_INSIDE.seatG, overFloorM: 1.1 };
const WALL_M = 0.04;

// ── THE PROFILE ──────────────────────────────────────────────────────────────
export function leviathan2076Profile(doc = MESH_ROWS.heavy_2076) {
  if (!doc) return null;
  const m = LEV76_LENGTH_M / modelLength(doc);
  const fE = EYE.f, gE = EYE.g, hE = LEV76_INSIDE.floorH + EYE.overFloorM / m;
  const X = (g) => (g - gE) * m, Y = (f) => (f - fE) * m, Z = (h) => (h - hE) * m;
  const toShell = (q) => [X(q[1]), Y(q[0]), Z(q[2])];
  const inset = WALL_M / m;
  const fB = LEV76_INSIDE.bulkheadF, zF = Z(LEV76_INSIDE.floorH);
  const G = { m, X, Y, Z, toShell, inset, fB, zF, fW: LEV76_GLASS.windscreen.f[0] };
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
  const S = LEV76_GLASS.side;
  const P = {
    label: 'Leviathan 2076 flight deck',
    xCentre, halfW,
    floor: z0 - 1e-6, roof: z1 + 1e-6, front: y1 + 1e-6, back: y0 - 1e-6,
    mPerUnit: m, glassAftY: Y(G.fW),
    // The side rays go out through the middle of each side window.
    winY: [Y(S.f[0] + 0.01), Y(S.f[1] - 0.01)], winZ: [Z(levCabPoint(fE, S.a[0])[2]), Z(levCabPoint(fE, S.a[1])[2])],
    dashY: DASH.yMid - DASH.sag * 0.2, dashZ: DASH.z0, headerZ: Z(levCabPoint(G.fW, 80)[2]), pillarW: 0.03,
    seatZ: zF + 0.34, seatHalf: 0.25, seatY: [-0.34, 0.14], backZ: 0.02,
    roofGlass: false,          // straight up from the captain is the overhead console, under the brow
    seats: 2, centrePost: 0,
    normalLit: true,
    floods: [{ p: [xCentre, 0.9, -0.2], r: 0.8 }, { p: [xCentre, -0.4, 0.6], r: 1.0 }],
    floodGain: 1.5, glare: 0.25,
    room: levShell,
    glass,
    lev76: { ...G, faces: room.faces },
    hotspots(live) { return lev76Hotspots(this, live); },
  };
  return P;
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
// Built once per profile: lining, headliner, the windscreen posts, the bulkhead and its doorway, the
// crew rest behind it, the floor, window reveals and the light that runs round the room.
function buildRoom(G) {
  const { toShell, inset, fB, zF, m } = G;
  const faces = [];
  const put = (p, n, tone, k, rgb, emis) => faces.push({ p, n, tone, k, rgb, emis: emis || 0 });
  const K = makeKit((fs, tone, k, fwd, rgb, emis) => { for (const f of fs) put(f.p, f.n, tone, k, rgb, emis); }, false);
  const S = (f, aDeg, inM = 0) => toShell(levCabPoint(f, aDeg, -(inset + inM / m)));
  const inward = (f, a) => {
    const d = 1e-4;
    let n = norm(cross(sub(S(f + d, a), S(f - d, a)), sub(S(f, a + d * 50), S(f, a - d * 50))));
    const c = toShell([f, 0, levCabSection(f).cz]);
    if (dot(n, sub(c, S(f, a))) < 0) n = mul(n, -1);
    return n;
  };
  const aboveFloor = (poly) => clipHalf(poly, (q) => q[2] - zF);
  const fR = LEV76_INSIDE.restF, W = LEV76_GLASS.windscreen, SW = LEV76_GLASS.side;

  // ── THE SHELL: the crew rest behind the bulkhead, then the flight deck, walked in the cab's own
  // (f, angle) with every pane cut out of it exactly (the rectangles in cabin-leviathan-2076.js).
  const FS = [fR, 0.815, 0.83, fB, 0.86, SW.f[0], 0.89, 0.9, 0.912, 0.924, SW.f[1], W.f[0], 0.955, 0.97, 0.985, 1.0, 1.012, 1.024, W.f[1]];
  const NA = 64;
  const holes = [[[W.f[0], W.a[0]], [W.f[1], W.a[0]], [W.f[1], W.a[1]], [W.f[0], W.a[1]]]];
  holes.push([[SW.f[0], SW.a[0]], [SW.f[1], SW.a[0]], [SW.f[1], SW.a[1]], [SW.f[0], SW.a[1]]]);
  holes.push([[SW.f[0], 180 - SW.a[1]], [SW.f[1], 180 - SW.a[1]], [SW.f[1], 180 - SW.a[0]], [SW.f[0], 180 - SW.a[0]]]);
  for (let i = 0; i < FS.length - 1; i++) {
    for (let j = 0; j < NA; j++) {
      const f0 = FS[i], f1 = FS[i + 1], a0 = -90 + (j / NA) * 360, a1 = -90 + ((j + 1) / NA) * 360;
      let cells = [[[f0, a0], [f1, a0], [f1, a1], [f0, a1]]];
      for (const h of holes) cells = cells.flatMap((c) => (bbOverlap(c, h) ? subtractConvex(c, h) : [c]));
      const fm = (f0 + f1) / 2, am = (a0 + a1) / 2, sn = Math.sin(am * DEG);
      const n = inward(fm, am);
      const inRest = fm < fB;
      const rib = inRest && i % 2 === 0;
      for (const c of cells) {
        const poly = aboveFloor(c.map(([f, a]) => S(f, a)));
        if (poly.length < 3) continue;
        if (inRest) put(poly, n, 'pil', -0.15, rib ? T.restRib : T.rest);
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
      const i0 = S(fa, aa), i1 = S(fb, ab), o0 = toShell(levCabPoint(fa, aa, -0.004 / m)), o1 = toShell(levCabPoint(fb, ab, -0.004 / m));
      const fm = (fa + fb) / 2, am = (aa + ab) / 2;
      const toC = sub(S(cF, cA), S(fm, am));
      const out = norm(sub(toShell(levCabPoint(fm, am, 0)), S(fm, am)));
      const rn = norm(sub(toC, mul(out, dot(toC, out))));
      if (i0[2] > zF && i1[2] > zF) put([i0, i1, o1, o0], rn, 'pil', 0.05, T.graphite);
      if (lit && i0[2] > zF + 0.01 && i1[2] > zF + 0.01) K.rod(S(fa, aa, 0.008), S(fb, ab, 0.008), 0.0045, 'pil', 0.1, T.glowDim, 0.35, 5, false);
    }
  };
  const edge = (f0, a0, f1, a1, n) => Array.from({ length: n + 1 }, (_, i) => [lerp(f0, f1, i / n), lerp(a0, a1, i / n)]);
  reveal(edge(W.f[0], W.a[0], W.f[0], W.a[1], 36), W.f[0] + 0.03, 90);
  reveal(edge(W.f[0], W.a[0], W.f[1], W.a[0], 10), (W.f[0] + W.f[1]) / 2, 60, false);
  reveal(edge(W.f[0], W.a[1], W.f[1], W.a[1], 10), (W.f[0] + W.f[1]) / 2, 120, false);
  for (const [aLo, aHi] of [SW.a, [180 - SW.a[1], 180 - SW.a[0]]]) {
    const cF = (SW.f[0] + SW.f[1]) / 2, cA = (aLo + aHi) / 2;
    reveal([...edge(SW.f[0], aLo, SW.f[1], aLo, 6), ...edge(SW.f[1], aLo, SW.f[1], aHi, 6).slice(1), ...edge(SW.f[1], aHi, SW.f[0], aHi, 6).slice(1), ...edge(SW.f[0], aHi, SW.f[0], aLo, 6).slice(1)], cF, cA);
  }
  // The windscreen posts, inside: graphite ribs down the glass where the exterior has its frames.
  for (const a of LEV76_GLASS.posts) {
    const pts = edge(W.f[0] + 0.002, a, W.f[1] - 0.008, a, 10).map(([f, aa]) => S(f, aa, 0.016));
    for (let k = 1; k < pts.length; k++) K.rod(pts[k - 1], pts[k], a === 90 ? 0.014 : 0.02, 'post', 0.05, T.graphite, 0, 6, false);
  }

  // ── THE SIDE WALLS: an armrest along each, lit along its top, and a speaker below it ──
  for (const s of [1, -1]) {
    const A = (a) => (s > 0 ? a : 180 - a);
    const ar0 = S(0.862, A(-3), 0.06), ar1 = S(0.91, A(-3), 0.06);
    const along = norm(sub(ar1, ar0));
    const aUp = norm(cross(cross(along, [0, 0, 1]), along));
    K.obox(mul(add(ar0, ar1), 0.5), along, aUp, norm(cross(along, aUp)), Math.hypot(...sub(ar1, ar0)) / 2, 0.03, 0.05, 'pil', 0.05, T.graphiteLt);
    K.rod(add(ar0, [0, 0, 0.031]), add(ar1, [0, 0, 0.031]), 0.004, 'pil', 0.2, T.glow, 0.9, 5);
    const sc = S(0.885, A(-9), 0.004), sn2 = inward(0.885, A(-9)), sr = norm(cross([0, 0, 1], sn2)), su = cross(sn2, sr);
    const Sp = K.panel(add(sc, mul(sn2, 0.002)), sr, su, 'pil', 0.1);
    Sp.disc(0, 0, 0.07, T.graphite, 0, 0.001, 20);
    Sp.annulus(0, 0, 0.071, 0.078, T.glowDim, 0.5, 0.002, 20);
    for (let ring = 1; ring <= 2; ring++) for (let h = 0; h < ring * 8; h++) {
      const t = (h / (ring * 8)) * TAU, r = ring * 0.024;
      Sp.disc(Math.cos(t) * r, Math.sin(t) * r, 0.005, T.tub, 0, 0.002, 6);
    }
  }

  // ── THE BULKHEAD, with its doorway to the crew rest ──
  const NS = 72, bpts = [];
  for (let k = 0; k <= NS; k++) bpts.push(S(fB, -90 + (k / NS) * 360));
  const bulk = aboveFloor(bpts);
  const xC = G.X(0), yB = G.Y(fB), dw = LEV76_INSIDE.doorHalfM, dTop = zF + LEV76_INSIDE.doorTopM;
  for (const piece of [clipHalf(bulk, (q) => xC - dw - q[0]), clipHalf(bulk, (q) => q[0] - (xC + dw)), clipHalf(clipHalf(clipHalf(bulk, (q) => q[0] - (xC - dw)), (q) => xC + dw - q[0]), (q) => q[2] - dTop)]) {
    if (piece.length >= 3) put(piece, [0, 1, 0], 'post', -0.12, T.graphite);
  }
  for (const [a, b] of [[[xC - dw, yB, zF], [xC - dw, yB, dTop]], [[xC + dw, yB, zF], [xC + dw, yB, dTop]], [[xC - dw, yB, dTop], [xC + dw, yB, dTop]]]) {
    K.rod(a, b, 0.024, 'post', 0.05, T.graphiteLt, 0, 6);
    K.rod(add(a, [0, 0.026, 0]), add(b, [0, 0.026, 0]), 0.005, 'post', 0.2, T.glow, 0.7, 5);
  }
  // Padded panels behind each seat, and a first-aid case and an oxygen bottle on the captain's side.
  for (const cx of [0, 2 * xC]) {
    K.box(cx - 0.24, yB, zF + 0.4, cx + 0.24, yB + 0.03, zF + 1.2, 'post', -0.05, T.seatDk);
    for (let r = 1; r < 7; r++) K.box(cx - 0.24, yB + 0.03, zF + 0.4 + r * 0.114, cx + 0.24, yB + 0.034, zF + 0.404 + r * 0.114, 'post', -0.2, T.bolster);
  }
  K.box(-0.7, yB, zF + 1.3, -0.5, yB + 0.08, zF + 1.47, 'post', 0.05, [210, 212, 208]);
  K.box(-0.612, yB + 0.08, zF + 1.36, -0.588, yB + 0.082, zF + 1.41, 'post', 0.3, T.warn, 0.2);
  K.box(-0.63, yB + 0.08, zF + 1.375, -0.57, yB + 0.082, zF + 1.395, 'post', 0.3, T.warn, 0.2);
  K.rod([-0.85, yB + 0.08, zF + 0.5], [-0.85, yB + 0.08, zF + 1.05], 0.07, 'post', 0.1, [90, 150, 96], 0, 12);

  // ── THE CREW REST through the doorway: its far wall, a bunk, two jump seats, a lit floor line ──
  const yR = G.Y(fR);
  const far = [];
  for (let k = 0; k <= NS; k++) far.push(S(fR, -90 + (k / NS) * 360));
  const farW = aboveFloor(far);
  if (farW.length >= 3) put(farW, [0, 1, 0], 'post', -0.2, T.restRib);
  K.box(xC - 1.0, yR + 0.05, zF + 0.45, xC + 1.0, yR + 0.75, zF + 0.55, 'post', 0.0, T.bunk);
  K.box(xC - 0.95, yR + 0.08, zF + 0.55, xC + 0.95, yR + 0.72, zF + 0.6, 'post', 0.05, T.blanket);
  for (const dx of [-0.9, 0.9]) K.rod([xC + dx, yR + 0.4, zF], [xC + dx, yR + 0.4, zF + 0.45], 0.02, 'post', 0.1, T.metal, 0, 6);
  for (const dx of [-0.6, 0.6]) {
    K.box(xC + dx - 0.2, yR + 0.9, zF + 0.4, xC + dx + 0.2, yR + 1.15, zF + 0.47, 'post', 0.05, T.seat);
    K.box(xC + dx - 0.2, yR + 0.88, zF + 0.47, xC + dx + 0.2, yR + 0.92, zF + 1.0, 'post', 0.0, T.seat);
  }
  K.box(xC - 0.006, yR, zF + 0.001, xC + 0.006, yB, zF + 0.004, 'floor', 0.2, T.glow, 0.6);

  // ── THE FLOOR: dark mats from the rest to under the deck, edged in light ──
  const floorHalf = (f) => {
    let prev = null;
    for (let a = -90; a <= 0; a += 1) {
      const q = levCabPoint(f, a, -inset);
      if (prev && prev[2] < LEV76_INSIDE.floorH && q[2] >= LEV76_INSIDE.floorH) {
        const t = (LEV76_INSIDE.floorH - prev[2]) / (q[2] - prev[2]);
        return (prev[1] + (q[1] - prev[1]) * t) * m;
      }
      prev = q;
    }
    return 0;
  };
  const FF = [];
  for (let f = fR; f < 1.0; f += 0.008) FF.push(f);
  for (let i = 0; i < FF.length - 1; i++) {
    const f0 = FF[i], f1 = FF[i + 1], w0 = floorHalf(f0), w1 = floorHalf(f1);
    if (w0 <= 0.01 || w1 <= 0.01) continue;
    const rest = f1 <= fB + 1e-9;
    put([[xC - w0, G.Y(f0), zF], [xC + w0, G.Y(f0), zF], [xC + w1, G.Y(f1), zF], [xC - w1, G.Y(f1), zF]], [0, 0, 1], 'floor', -0.2, rest ? T.restRib : (i % 5 === 4 ? T.floorEdge : T.floor));
    if (!rest) for (const s of [-1, 1]) K.box(xC + s * (w0 - 0.05) - 0.006, G.Y(f0), zF + 0.001, xC + s * (w0 - 0.05) + 0.006, G.Y(f1), zF + 0.004, 'floor', 0.2, T.glow, 0.85);
  }
  return { faces };
}

// ── THE GLASS ────────────────────────────────────────────────────────────────
// The panes the renderer lays over the room as film: the windscreen, the side windows and the glazed
// nose cap, faceted along the cab in (f, angle) small enough to be flat, 5 mm inside the skin.
function buildGlass(G) {
  const { toShell, m } = G;
  const d = 0.005 / m;
  const panes = [];
  const grid = (f0, f1, a0, a1, nf, na) => {
    for (let i = 0; i < nf; i++) for (let j = 0; j < na; j++) {
      const fa = lerp(f0, f1, i / nf), fb = lerp(f0, f1, (i + 1) / nf), aa = lerp(a0, a1, j / na), ab = lerp(a0, a1, (j + 1) / na);
      panes.push([[fa, aa], [fb, aa], [fb, ab], [fa, ab]].map(([f, a]) => toShell(levCabPoint(f, a, -d))));
    }
  };
  const W = LEV76_GLASS.windscreen, SW = LEV76_GLASS.side;
  grid(W.f[0], W.f[1], W.a[0], W.a[1], 8, 36);
  grid(SW.f[0], SW.f[1], SW.a[0], SW.a[1], 3, 4);
  grid(SW.f[0], SW.f[1], 180 - SW.a[1], 180 - SW.a[0], 3, 4);
  // The nose cap ahead of the windscreen, glass on the exterior too, as a fan to the apex.
  const apex = toShell([LEV76_CAB_APEX[0] - d, 0, LEV76_CAB_APEX[2]]);
  for (let j = 0; j < 12; j++) {
    const a0 = W.a[0] + (W.a[1] - W.a[0]) * j / 12, a1 = W.a[0] + (W.a[1] - W.a[0]) * (j + 1) / 12;
    panes.push([toShell(levCabPoint(W.f[1], a0, -d)), toShell(levCabPoint(W.f[1], a1, -d)), apex]);
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
function levShell(P, live, push, rich) {
  const D = P.lev76;
  for (const f of D.faces) push(f.one || (f.one = Object.assign([{ p: f.p, n: f.n }], { stable: true })), f.tone, f.k, false, f.rgb, f.emis || 0);
  seats(P, push);
  if (rich) lev76Fit(P, live, push);
}

// ── THE READINGS ─────────────────────────────────────────────────────────────
const NENG = 4;
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
    gearDown: L.gearDown !== false,
    visor: clamp(num(L.noseVisor), 0, 1),
    // Each engine's lever and spool, left to right (cockpit.js sends one per engine), falling back to
    // the ganged lever and the one rpm.
    thrs: Array.from({ length: NENG }, (_, e) => clamp(num(L.throttles?.[e], num(L.throttle)), 0, 1)),
    rpms: Array.from({ length: NENG }, (_, e) => clamp(num(L.rpms?.[e], num(L.rpm)), 0, 1.1)),
    split: !!L.split,
  };
  // ⚠ THE HYDROGEN NUMBERS ARE DERIVED IN THE OPEN, from thrust and spool, never typed. The tanks hold
  // 60 t of liquid hydrogen full; each fan burns up to 1.5 t an hour at full thrust and full spool, in
  // proportion to thrust times spool. Endurance is what is left over that burn.
  R.flows = R.thrs.map((t, e) => (R.powered ? 1.5 * t * clamp(R.rpms[e], 0, 1) : 0));
  R.burn = R.flows.reduce((a, b) => a + b, 0);
  R.endur = R.burn > 0.01 ? Math.min(999, Math.round(R.fuel * 60 / R.burn * 60)) : 0;
  R.handsOn = R.powered && (Math.abs(R.ail) > 0.03 || Math.abs(R.elev) > 0.03 || Math.abs(R.rud) > 0.03);
  // The nose: locked, travelling or open, and the ramp, which follows the visor over its last 42%
  // (the exterior's ramp is on the same channel, span 0.58..1). An open nose baulks the throttles.
  R.nose = R.visor <= 0.02 ? 'LOCKED' : R.visor >= 0.98 ? 'OPEN' : 'MOVING';
  R.ramp = clamp((R.visor - 0.58) / 0.42, 0, 1);
  R.baulk = R.visor > 0.02;
  return R;
};
const night = (R) => nightAt(R.hour);
const panelOn = (R) => R.powered && (R.L.panelLight != null ? !!R.L.panelLight : night(R));

// ── WHERE THE CONTROLS ARE ───────────────────────────────────────────────────
// One place says where each thing you can grab or click is; the drawing and the hotspots both read it.
// Shell metres, the eye at the origin, the captain in the left seat and the centreline to the right.
const STICK = { x: 0, y: 0.42, z: 0.55, len: 0.13 };                  // dead ahead of the captain
const ARMREST = { x: -0.44, y: 0.12, z: 0.55 };                       // the outboard console, a forearm rest
const PED = { hw: 0.15, y0: 0.0, y1: 0.68, top: 0.52, riserY: 0.56, riserTop: 0.6, nose: 0.9 };
const LEVER = { pivotY: 0.3, len: 0.15, dx: [-0.075, -0.025, 0.025, 0.075] };   // four thrust levers, engines 1 to 4
const FLAP = { dx: -0.115, y0: 0.6, y1: 0.68 };                                    // on the riser's left, UP forward
function stickAt(P, R, x = STICK.x) {
  const base = [x, STICK.y, P.lev76.zF + STICK.z];
  const dir = norm([R.ail * 0.32, -R.elev * 0.32, 1]);
  return { base, top: add(base, mul(dir, STICK.len)), dir };
}
// Engine `e`'s lever; `t` overrides its value, for the crossbar between the grips.
function leverAt(P, R, e, t = R.thrs[e]) {
  const pivot = [P.xCentre + LEVER.dx[e], LEVER.pivotY, P.lev76.zF + PED.top];
  const ang = -0.6 + t * 1.2;
  const dir = [0, Math.sin(ang), Math.cos(ang)];
  return { pivot, end: add(pivot, mul(dir, LEVER.len)), dir };
}
const meanThr = (R) => R.thrs.reduce((a, b) => a + b, 0) / NENG;
function flapKnob(P, R) {
  const y = lerp(FLAP.y0, FLAP.y1, 1 - R.flap / 3);
  return [P.xCentre + FLAP.dx, y, P.lev76.zF + PED.riserTop + 0.07];
}

// ── THE DECK: one sculpted wing from wall to wall, and on its face toward the crew one band of glass ──
const DASH = { xL: -1.3, xR: 2.46, yMid: 0.98, sag: 0.26, w: 1.88, z0: -0.54, h: 0.3, lean: 0.45 };
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

// ── THE PAGES on the band, booting in turn: the engines outboard of the captain, the flight page in
// front of her, the map (the one page you click) by the aisle, then the cargo and hydrogen pages and
// the first officer's flight page across the right.
const SCREENS = [
  { id: 'engines', x: -0.64, title: 'ENGINES', boot: 0.3 },
  { id: 'pfd', x: 0.0, title: 'FLIGHT', boot: 0 },
  { id: 'map', x: 0.62, title: 'NAV', boot: 0.15 },
  { id: 'cargo', x: 0.98, title: 'CARGO', boot: 0.45 },
  { id: 'pfd2', x: 1.34, title: 'FLIGHT', boot: 0.1 },
  { id: 'h2', x: 1.72, title: 'H2', boot: 0.6 },
];
const SW = 0.15, SH = 0.105, PAGE_V = 0.16;
const screenPanel = (K, P, sc) => bandPanel(K, P, sc.x, PAGE_V, 0.014);
// The status lamps along the band's foot, under the engines and the flight page.
const LAMP_X = [-0.98, -0.81, -0.64, -0.47, -0.3, -0.13, 0.04, 0.21];
const LAMP_V = 0.024;

// ── THE KEYS: four glass keys on the band between the flight page and the map, the gear lever beside ──
const BTN = { ids: ['master', 'land', 'panel', 'dome'], names: { master: 'PWR', land: 'LAND', panel: 'PANEL', dome: 'CABIN' } };
const BTN_AT = (i) => ({ x: [0.2, 0.27][i % 2], v: [0.21, 0.135][i >> 1] });
const GEAR = { x: 0.385, vUp: 0.235, vDn: 0.1 };
function switchOn(id, R) {
  if (id === 'master') return R.powered;
  if (id === 'land') return R.land;
  if (id === 'panel') return panelOn(R);
  if (id === 'dome') return R.dome && R.powered;
  return R.powered;
}

// ── THE WINDSCREEN HUD: projected ahead of the captain, inside the cab ──
const HUD = { dist: 1.1, z: 0.02, hw: 0.34, hh: 0.15 };
// ── THE HOLOGRAM: over the deck's shelf, right of the captain's line and clear of the HUD ──
const HOLO_AT = { x: 0.66, out: 0.27, rise: 0.08, scale: 0.15 };

export function lev76Hotspots(P, live) {
  const R = readings(live), K = makeKit(() => {}), out = [];
  BTN.ids.forEach((id, i) => { const b = BTN_AT(i); out.push({ id: 'ck:' + id, p: bandPanel(K, P, b.x, b.v).pt(0, 0, 0.01), r: 0.03, kind: 'click' }); });
  out.push({ id: 'ck:gear', p: bandPanel(K, P, GEAR.x, R.gearDown ? GEAR.vDn : GEAR.vUp).pt(0, 0, 0.02), r: 0.035, kind: 'click' });
  out.push({ id: 'ck:flaps', p: flapKnob(P, R), r: 0.035, kind: 'click' });
  out.push({ id: 'yoke', p: add(stickAt(P, R).top, [0, 0, 0.04]), r: 0.06, kind: 'yoke' });
  // The crossbar moves the set; each grip moves its own engine and splits them.
  const lv = leverAt(P, R, 0, meanThr(R));
  out.push({ id: 'throttle', p: [P.xCentre, ...add(lv.end, mul(lv.dir, 0.03)).slice(1)], r: 0.025, kind: 'throttle' });
  for (let e = 0; e < NENG; e++) { const g = leverAt(P, R, e); out.push({ id: 'thr' + e, p: add(g.end, mul(g.dir, 0.035)), r: 0.022, kind: 'throttle', engine: e }); }
  out.push(gpsHotspot(screenPanel(K, P, SCREENS.find((sc) => sc.id === 'map')), 0, -0.012, 0.07));
  return out;
}

// ── THE SEATS: crew seats on rails, graphite shells and grey leather, a blue stitch, five-point harness ──
function seats(P, push) {
  const K = makeKit(push, false);
  for (const cx of [0, 2 * P.xCentre]) crewSeat(K, P, cx);
}
function crewSeat(K, P, cx) {
  const h = P.seatHalf, [y0, y1] = P.seatY, sz = P.seatZ, zF = P.lev76.zF;
  for (const s of [-1, 1]) K.box(cx + s * 0.16 - 0.015, y0 - 0.05, zF, cx + s * 0.16 + 0.015, y1 + 0.1, zF + 0.03, 'seat', 0.1, T.metal);
  K.box(cx - 0.13, y0 + 0.06, zF + 0.03, cx + 0.13, y1 - 0.1, sz - 0.12, 'seat', -0.25, T.graphite);
  K.box(cx - h, y0, sz - 0.12, cx + h, y1, sz - 0.06, 'seat', 0.0, T.graphite);
  K.box(cx - h + 0.05, y0 + 0.02, sz - 0.06, cx + h - 0.05, y1 - 0.02, sz, 'seat', 0.08, T.seat);
  for (const s of [-1, 1]) {
    K.box(cx + s * h - s * 0.05, y0, sz - 0.06, cx + s * h, y1, sz + 0.06, 'seat', 0.05, T.bolster);
    K.box(cx + s * (h - 0.025) - 0.003, y0 + 0.02, sz + 0.06, cx + s * (h - 0.025) + 0.003, y1 - 0.02, sz + 0.064, 'seat', 0.2, T.blue, 0.2);
  }
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
  K.obox(add(add(bb, mul(up, bH * 0.9)), mul(fw, -0.002)), [1, 0, 0], up, fw, h - 0.07, 0.004, 0.012, 'seat', 0.2, T.blue, 0.3);
  const top = add(bb, mul(up, bH - 0.01)), buck = [cx, y1 - 0.16, sz + 0.14];
  for (const s of [-1, 1]) {
    K.rod(add(add(top, mul(fw, 0.03)), [s * 0.06, 0, 0]), add(buck, [s * 0.025, 0, 0.03]), 0.012, 'seat', 0.05, T.harness, 0, 4);
    K.rod([cx + s * (h - 0.04), y0 + 0.08, sz + 0.03], add(buck, [s * 0.025, 0, -0.01]), 0.012, 'seat', 0.05, T.harness, 0, 4);
  }
  K.rod([cx, y1 - 0.04, sz + 0.005], add(buck, [0, 0, -0.02]), 0.01, 'seat', 0.05, T.harness, 0, 4);
  K.rod(add(buck, [0, -0.008, 0]), add(buck, [0, 0.01, 0]), 0.034, 'seat', 0.3, T.buckle, 0, 12);
}

// ── THE FIT-OUT ──────────────────────────────────────────────────────────────
export function lev76Fit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live);
  const zF = P.lev76.zF, xC = P.xCentre;
  const lit = R.powered, panel = panelOn(R);
  const amb = lit ? (night(R) ? 1 : 0.55) * (R.dome ? 1.2 : 1) : 0.05;
  const boot = bootAge(live);
  // The light lines carry the alert: teal, amber on low hydrogen or an open nose, red and breathing
  // on a hull or stall warning.
  const warn = lit && (R.hull < 0.3 || R.stall), caution = lit && (R.fuel < 0.15 || R.baulk);
  const al = alertLight(caution, warn, T.line), lineK = (k) => (lit ? k * al.k : 0.05);
  const near = (key, ids) => eased('lev76:near:' + key, live && ids.some((id) => live.hover === id || live.press === id) ? 1 : 0, 12);

  // ── THE DECK: a wing swept along the band's curve ──
  const curve = dashCurve(P);
  const gt = [DASH.h * DASH.lean / Math.hypot(1, DASH.lean), DASH.h / Math.hypot(1, DASH.lean)];
  const g0 = 0.004;
  const SEC = [[g0, 0], [gt[0] + g0, gt[1]], [0.09, gt[1] + 0.024], [0.11, gt[1] + 0.038], [0.22, 0.31], [0.36, 0.29], [0.4, 0.21],
    [0.3, -0.05], [0.09, -0.14], [-0.06, -0.1], [-0.07, -0.04], [g0, 0]];
  const N = 44, rings = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N, c = curve(s), e = Math.abs(2 * s - 1) ** 3, tap = 1 - 0.6 * e;
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
  for (let i = 2; i < N - 2; i++) {
    const a = rings[i], b = rings[i + 1], lift = [0, 0, 0.003];
    const q = [add(a[4], lift), add(b[4], lift), add(lerp3(b[4], b[5], 0.85), lift), add(lerp3(a[4], a[5], 0.85), lift)];
    K.face(q, norm(cross(sub(q[1], q[0]), sub(q[3], q[0]))), 'dash', 0.15, T.tub);
  }
  lightLine(K, rings.slice(1, -1).map((r) => add(r[2], [0, 0, -0.002])), 0.0028, al.rgb, lineK(0.9));
  lightLine(K, rings.map((r) => r[9]), 0.0032, al.rgb, lineK(0.8));
  lightLine(K, rings.slice(2, -2).map((r) => add(r[5], [0, 0, 0.002])), 0.002, al.rgb, lineK(0.35));
  lightLine(K, rings.slice(1, -1).map((r) => r[7]), 0.002, T.tub, 0);
  // The deck stands on blades down to the floor, outboard of each pair of pedals.
  for (const x of [-0.44, 2 * xC + 0.44]) {
    const c = curve(sOf(x)), top = add(add(c.p, mul(c.f, 0.1)), [0, 0, -0.1]), foot = [top[0], top[1] - 0.06, zF + 0.008];
    const up = norm(sub(top, foot)), along = norm(cross([1, 0, 0], up)), mid = mul(add(top, foot), 0.5), half = Math.hypot(...sub(top, foot)) / 2;
    K.obox(mid, [1, 0, 0], up, along, 0.009, half, 0.05, 'dash', 0.05, T.graphite);
    lightLine(K, [add(foot, add(mul(along, -0.051), [0, 0, 0.04])), add(top, add(mul(along, -0.051), [0, 0, -0.02]))], 0.0025, al.rgb, lineK(0.6));
    K.obox(add(foot, [0, 0, 0.006]), [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.03, 0.006, 0.08, 'dash', 0.05, T.graphiteLt);
  }

  // ── THE BAND: one sheet of glass, the pages on it, booting in turn when the power comes on ──
  glassBand(K, curve, { h: DASH.h, lean: DASH.lean, segs: 44, lit, light: al.rgb, lightK: lineK(1), substrate: T.screen });
  for (const sc of SCREENS) {
    const Pn = screenPanel(K, P, sc), up = reveal(boot, sc.boot);
    if (!lit || up <= 0) continue;
    if (up < 1) {
      const y = lerp(-SH, SH, up);
      Pn.rect(-SW, -SH, SW, y, T.screen, 0.3 * up, 0.001);
      Pn.rect(-SW, y - 0.002, SW, y + 0.002, T.glow, 1, 0.0025);
      continue;
    }
    Pn.rect(-SW, -SH, SW, SH, T.screen, 0.3, 0.0005);
    Pn.rect(-SW + 0.004, SH - 0.0035, SW - 0.004, SH - 0.0015, T.glow, 0.85, 0.0018);
    Pn.fitText(sc.title, 0, SH - 0.019, SW * 1.4, sc.x > 1.5 ? 0.0135 : 0.011, T.title, panel ? 0.9 : 0.7, 0.0026);
    if (sc.id === 'pfd' || sc.id === 'pfd2') pfd(Pn, R);
    else if (sc.id === 'engines') enginesPage(Pn, R);
    else if (sc.id === 'h2') h2Page(Pn, R);
    else if (sc.id === 'map') mapPage(Pn, R, live);
    else if (sc.id === 'cargo') cargoPage(Pn, R);
  }
  // The status lamps along the foot of the band.
  {
    // ⚠ PILOT PRESENT IS THE RIDER'S LAMP: lit whenever the seat is powered and occupied, which is
    // whenever this cockpit is drawn. It is the one thing on the panel the insurer reads.
    const lamps = [
      ['PILOT PRESENT', lit, C.green], ['HANDS ON', R.handsOn, T.glow], ['AUTONOMY ADVISORY', lit, T.amber],
      ['NOSE OPEN', lit && R.baulk, T.amber], ['GEAR DOWN', lit && R.gearDown, C.green],
      ['LOW H2', lit && R.fuel < 0.15, T.warn], ['STALL', lit && R.stall, T.warn], ['HULL', lit && R.hull < 0.3, T.warn],
    ];
    const up = reveal(boot, 0.75) >= 1;
    lamps.forEach(([name, on, rgb], i) => lensLamp(bandPanel(K, P, LAMP_X[i], LAMP_V, 0.012), 0, 0, 0.16, 0.03, on && up, rgb, name));
  }

  // ── THE KEYS: four glass keys on the band ──
  BTN.ids.forEach((id, i) => {
    const b = BTN_AT(i), Kp = bandPanel(K, P, b.x, b.v, 0.006), on = switchOn(id, R);
    const pressed = !!live && live.press === 'ck:' + id;
    const rgb = id === 'master' ? C.green : T.glow;
    const glow = eased('lev76:glow:' + id, on ? 1 : 0, 10), depth = eased('lev76:dip:' + id, pressed ? 0.002 : 0.007, 30);
    const hand = near('key:' + id, ['ck:' + id]);
    Kp.rect(-0.031, -0.031, 0.031, 0.031, T.tub, 0, 0.0005);
    Kp.annulus(0, 0, 0.029, 0.031, T.glow, (lit ? 0.25 : 0) + hand * 0.75, 0.0012, 20);
    Kp.stud(0, 0, 0.026, 0.026, depth, rgb.map((c, k) => lerp([40, 46, 50][k], c, glow * 0.8)), glow * 0.85 + hand * 0.15, 0.0015);
    Kp.fitText(BTN.names[id], 0, -0.004, 0.044, 0.012, glow > 0.5 ? [10, 24, 22] : [214, 222, 220], glow > 0.5 ? 0 : (panel ? 0.6 : 0.25), depth + 0.0025);
    const flash = pressPulse('lev76:key:' + id, on);
    if (flash > 0.02) Kp.annulus(0, 0, 0.034, 0.038, HALO, flash, 0.004, 18);
  });
  // ── THE GEAR LEVER on the band: a slot, a wheel-shaped knob up or down, green when down ──
  {
    const Gp = bandPanel(K, P, GEAR.x, (GEAR.vUp + GEAR.vDn) / 2, 0.006), mid = (GEAR.vUp + GEAR.vDn) / 2;
    const pos = eased('lev76:gear', R.gearDown ? 0 : 1, 6), kv = lerp(GEAR.vDn, GEAR.vUp, pos) - mid;
    const hand = near('gear', ['ck:gear']), press = !!live && live.press === 'ck:gear';
    Gp.rect(-0.007, GEAR.vDn - mid - 0.012, 0.007, GEAR.vUp - mid + 0.012, T.tub, 0, 0.001);
    Gp.text('GEAR', 0, GEAR.vUp - mid + 0.022, 0.012, T.dim, panel ? 0.7 : 0.35, 0.002);
    Gp.text('UP', 0.042, GEAR.vUp - mid - 0.006, 0.012, !R.gearDown ? T.white : T.dim, lit ? 0.7 : 0.3, 0.002);
    Gp.text('DN', 0.042, GEAR.vDn - mid - 0.006, 0.012, R.gearDown ? T.white : T.dim, lit ? 0.7 : 0.3, 0.002);
    Gp.disc(0, kv, 0.019, [214, 218, 220], 0.1 + hand * 0.2, press ? 0.012 : 0.02, 16);
    Gp.annulus(0, kv, 0.019, 0.023, R.gearDown ? C.green : T.amber, lit ? 0.5 + hand * 0.5 : 0, press ? 0.013 : 0.021, 16);
    const flash = pressPulse('lev76:gear', R.gearDown);
    if (flash > 0.02) Gp.annulus(0, kv, 0.028, 0.032, HALO, flash, 0.024, 18);
  }

  // ── THE WINDSCREEN HUD: projected, conformal, with the four thrust levers, the stick, the pedals,
  // the flaps and the gear mirrored round its edges ──
  if (lit) {
    const life = reveal(boot, 0.2);
    const Hp = windscreenHud(K, R, { ...HUD, warn, caution, boot: life, mirrors: { stick: [R.ail, R.elev], thrs: R.thrs, rud: R.rud } });
    if (life > 0) hudFlapsGear(Hp, R, warn ? HUD_RED : caution ? HUD_AMBER : HUD_LINE);
  }

  // ── THE HOLOGRAM over the deck's shelf: the Leviathan herself, flying as she flies ──
  {
    const c0 = curve(sOf(HOLO_AT.x)), shelf = lerp(0.31, 0.29, (HOLO_AT.out - 0.22) / 0.14);
    const base = add(add(c0.p, mul(c0.f, HOLO_AT.out)), [0, 0, shelf + 0.003]);
    holoProjector(K, base, HOLO_AT.rise, 0.07, lit ? R.fuel : 0, R.fuel < 0.15 ? HOLO_RED : R.fuel < 0.3 ? HOLO_AMBER : HOLO_LINE);
    if (lit && reveal(boot, 0.7) > 0) holoLeviathan(K, add(base, [0, 0, HOLO_AT.rise + 0.035]), R);
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
    for (const s of [0, 10]) lightLine(K, prings.slice(0, 10).map((r) => add(r[s], [s ? -0.002 : 0.002, 0, 0.07])), 0.003, T.tub, 0);
  }
  // The thrust gate: a slot for each lever, a lit tick every quarter beside the outer two, full amber.
  for (let e = 0; e < NENG; e++) {
    const dx = LEVER.dx[e];
    K.box(xC + dx - 0.008, LEVER.pivotY - 0.13, pt - 0.003, xC + dx + 0.008, LEVER.pivotY + 0.13, pt + 0.005, 'dash', -0.3, T.tub);
    if (e !== 0 && e !== NENG - 1) continue;
    for (let i = 0; i <= 4; i++) {
      const y = LEVER.pivotY - 0.11 + i * 0.055, t = R.thrs[e], here = lit && Math.abs(i / 4 - t) < 0.13;
      K.box(xC + dx + (dx < 0 ? -0.03 : 0.014), y - 0.002, pt + 0.002, xC + dx + (dx < 0 ? -0.014 : 0.03), y + 0.002, pt + 0.006, 'dash', 0.2, i === 4 ? T.amber : here ? T.glow : T.glowDim, here || i === 4 ? 0.9 : 0.5);
    }
  }
  // The four levers, engines 1 to 4 from the left, and a crossbar between the grips that moves the set.
  // Each grip lights as the hand comes to it, and all four for the hand on the crossbar.
  const grips = [];
  for (let e = 0; e < NENG; e++) {
    const lv = leverAt(P, R, e), t = R.thrs[e];
    const hand = near('thr' + e, ['thr' + e, 'throttle']);
    K.rod(lv.pivot, lv.end, 0.008, 'dash', 0.2, T.metal, 0, 8);
    const gripEnd = add(lv.end, mul(lv.dir, 0.05)), side = norm(cross([1, 0, 0], lv.dir));
    K.obox(mul(add(lv.end, gripEnd), 0.5), [1, 0, 0], lv.dir, side, 0.016, 0.03, 0.016, 'dash', 0.1, T.graphiteLt);
    K.obox(add(gripEnd, mul(lv.dir, 0.002)), [1, 0, 0], side, lv.dir, 0.013, 0.01, 0.003, 'dash', 0.3, T.glow, lit ? 0.3 + t * 0.5 + hand * 0.2 : 0);
    K.obox(add(mul(add(lv.end, gripEnd), 0.5), mul(side, 0.0165)), [1, 0, 0], lv.dir, side, 0.017, 0.004, 0.001, 'dash', 0.3, al.rgb, lit ? 0.2 + hand * 0.8 : 0);
    grips.push(mul(add(lv.end, gripEnd), 0.5));
  }
  {
    const bar = near('throttle', ['throttle']);
    for (let e = 0; e + 1 < NENG; e++) K.rod(add(grips[e], [0, -0.022, 0.012]), add(grips[e + 1], [0, -0.022, 0.012]), 0.004, 'dash', 0.2, bar > 0.05 ? al.rgb : T.metal, lit ? bar * 0.8 : 0, 6);
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
    const dip = eased('lev76:flapdip', press ? 0.008 : 0, 30);
    K.rod(base, add(kb, [0, 0, -0.012 - dip]), 0.006, 'dash', 0.2, T.metal, 0, 6);
    K.obox(add(kb, [0, 0, -dip]), [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.026, 0.012, 0.014, 'dash', 0.15, [214, 218, 220]);
    K.obox(add(kb, [0, 0, 0.0125 - dip]), [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.022, 0.006, 0.001, 'dash', 0.3, T.glow, lit ? 0.6 + hand * 0.4 : 0);
    K.obox(add(kb, [0, -0.0125, -dip]), [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.027, 0.003, 0.001, 'dash', 0.3, al.rgb, lit ? 0.15 + hand * 0.85 : 0);
    const flash = pressPulse('lev76:flap', R.flap);
    if (flash > 0.02) facingPanel(K, kb, 'dash', 0).annulus(0, 0, 0.034, 0.039, HALO, flash, 0.003, 18);
  }

  // ── THE STICKS, one on a column ahead of each seat, and the swept side consoles as armrests ──
  const stHand = near('yoke', ['yoke']);
  for (const [x, own] of [[STICK.x, true], [2 * xC - STICK.x, false]]) {
    const con = [own ? ARMREST.x : 2 * xC - ARMREST.x, ARMREST.y, zF + ARMREST.z];
    const st = stickAt(P, R, x), arm = st.base, s = con[0] < xC ? -1 : 1;
    const crings = [], pads = [];
    for (let i = 0; i <= 8; i++) {
      const y = lerp(-0.3, con[1] + 0.1, i / 8);
      crings.push(roundSection(con[0], y, 0.065, zF, con[2] - 0.005, 0.1));
    }
    sweep(K, crings, 'dash', 0.05, T.graphite);
    K.face(crings[0].slice(), [0, -1, 0], 'dash', 0.05, T.graphiteLt);
    K.face(crings[8].slice().reverse(), [0, 1, 0], 'dash', 0.05, T.graphiteLt);
    for (let i = 0; i <= 6; i++) pads.push(roundSection(con[0], lerp(-0.28, con[1] - 0.05, i / 6), 0.055, con[2] - 0.008, con[2] + 0.014, 0.018));
    sweep(K, pads, 'dash', 0.1, T.seat);
    lightLine(K, crings.map((r) => add(r[s < 0 ? 0 : 10], [-s * 0.002, 0, 0.11])), 0.003, al.rgb, lineK(0.7 * amb / Math.max(0.05, amb)));
    const hand = own ? stHand : 0;
    stickColumn(K, arm, zF, T.tub, T.metal);
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
    const pz = zF + 0.14, py = PEDAL_Y;
    for (const [dx, sgn] of [[-0.1, -1], [0.1, 1]]) {
      const slide = clamp(R.rud * sgn, -1, 1) * 0.05;
      K.box(cx + dx - 0.012, py - 0.12, zF, cx + dx + 0.012, py + 0.12, zF + 0.02, 'dash', 0.1, T.metal);
      const c = [cx + dx, py + slide, pz];
      K.obox(c, [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.045, 0.1, 0.008, 'dash', 0.05, T.graphite);
      K.obox(add(c, mul(norm([0, -0.89, -0.45]), -0.009)), [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.038, 0.088, 0.002, 'dash', 0.1, T.tub);
      K.obox(add(c, mul(norm([0, -0.89, -0.45]), -0.012)), [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.004, 0.07, 0.001, 'dash', 0.2, al.rgb, lit ? 0.3 + 0.7 * clamp(R.rud * sgn, 0, 1) : 0);
      K.rod(add(c, [0, 0, -0.06]), [cx + dx, py + slide, zF + 0.02], 0.012, 'dash', 0.2, T.metal, 0, 6);
      contactShadow(K, [cx + dx, py + slide, zF], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.05, 0.11);
    }
  }

  // ── OVERHEAD: a graphite console under the cab's crown, light lines, the dome light ──
  // ⚠ NO CONTROL THE SIM DOES NOT HAVE: the overhead is a fixture, lights and a grille, nothing to pull.
  {
    const D = P.lev76;
    const O = (f, a, inM) => D.toShell(levCabPoint(f, a, -(D.inset + inM / D.m)));
    const fs = [0.855, 0.875, 0.895, 0.915, 0.935];
    for (let i = 0; i < fs.length - 1; i++) {
      const a0 = O(fs[i], 80, 0.01), a1 = O(fs[i], 100, 0.01), b0 = O(fs[i + 1], 80, 0.01), b1 = O(fs[i + 1], 100, 0.01);
      K.face([a0, b0, b1, a1], [0, 0, -1], 'hdr', 0.05, T.graphite, 0);
      K.face([add(a0, [0, 0, -0.05]), add(a1, [0, 0, -0.05]), add(b1, [0, 0, -0.05]), add(b0, [0, 0, -0.05])], [0, 0, -1], 'hdr', 0.05, T.graphiteLt, 0);
      for (const [p, q] of [[a0, b0], [a1, b1]]) K.face([p, q, add(q, [0, 0, -0.05]), add(p, [0, 0, -0.05])], norm([p[0] < xC ? 1 : -1, 0, 0]), 'hdr', 0.05, T.graphite, 0);
    }
    const s0 = add(O(0.855, 90, 0.01), [0, 0, -0.052]), s1 = add(O(0.935, 90, 0.01), [0, 0, -0.052]);
    const ohK = (lit ? al.k : 1) * Math.max(amb, 0.2);
    K.rod(add(s0, [-0.1, 0, 0]), add(s1, [-0.1, 0, 0]), 0.004, 'hdr', 0.2, al.rgb, ohK, 5);
    K.rod(add(s0, [0.1, 0, 0]), add(s1, [0.1, 0, 0]), 0.004, 'hdr', 0.2, al.rgb, ohK, 5);
    for (let i = 0; i < 9; i++) for (const dx of [-0.045, 0.045]) {
      const c = add(O(0.895 + i * 0.0035, 90, 0.01), [dx, 0, -0.0515]);
      K.box(c[0] - 0.028, c[1] - 0.004, c[2] - 0.002, c[0] + 0.028, c[1] + 0.004, c[2], 'hdr', -0.3, T.tub);
    }
    const dome = add(O(0.87, 90, 0.01), [0, 0, -0.055]);
    K.rod(dome, add(dome, [0, 0, -0.012]), 0.05, 'hdr', 0.1, R.dome && lit ? [240, 252, 248] : [80, 84, 84], R.dome && lit ? 1 : 0, 14);
  }

  hotspotHalo(K, lev76Hotspots(P, live), live);
}
const PEDAL_Y = 0.96;

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

// ── THE HUD'S FLAPS AND GEAR: four detents down the right edge, the selected one lit, and three gear
// marks under them, filled when the gear is down ──
function hudFlapsGear(Hp, R, col) {
  const fx = HUD.hw - 0.014;
  for (let i = 0; i <= 3; i++) {
    const y = -0.03 - i * 0.012, sel = i === R.flap;
    Hp.rect(fx - (sel ? 0.008 : 0.004), y - (sel ? 0.0016 : 0.0008), fx + (sel ? 0.008 : 0.004), y + (sel ? 0.0016 : 0.0008), sel ? col : HUD_DIM, 1, 0.001);
  }
  Hp.text(['UP', '1', '2', 'F'][R.flap], fx - 0.002, -0.094, 0.012, col, 1, 0.001);
  for (const dx of [-0.012, 0, 0.012]) {
    const gy = -0.118, w = R.gearDown ? 0.004 : 0.0015;
    Hp.rect(fx + dx - w, gy - w, fx + dx + w, gy + w, R.gearDown ? col : HUD_DIM, 1, 0.001);
  }
}

// ── THE HOLOGRAM: the Leviathan in miniature, 32 cm across ──
// The lifting body as its outline and a crown line, the outer wings and winglets as plates, the canted
// fins, the four fans on the deck turning on the prop phase and each ringed in its own rpm, and the nose
// drawn on its hinge, swinging up with the visor. Drawn off the body's own stations
// (cabin-leviathan-2076.js), so she is the shape of the aircraft outside. The frame is her pitch and bank.
const HOLO_WING = [{ g: 0.42, le: 0.28, te: -0.86, h: 0.02 }, { g: 0.62, le: 0.0, te: -0.74, h: 0.034 }, { g: 1.0, le: -0.35, te: -0.62, h: 0.074 }];
const HOLO_ENG = { g: [-0.36, -0.15, 0.15, 0.36], f: -0.24, len: 0.4, r: 0.058 };
function holoLeviathan(K, c, R) {
  const H = holoFrame(K, c, R.pitch, R.bank);
  const sc = HOLO_AT.scale;
  const M = (f, g, h) => [g * sc, (f + 0.02) * sc, (h - 0.05) * sc];
  // The nose's hinge: a point ahead of the joint swings up about the crown pivot with the visor.
  const V = LEV76_VISOR, th = R.visor * V.swing * DEG, cs = Math.cos(th), sn = Math.sin(th);
  const hinge = (f, g, h) => {
    if (f <= V.cut) return M(f, g, h);
    const df = f - V.pivot[0], dh = h - V.pivot[2];
    return M(V.pivot[0] + cs * df + sn * dh, g, V.pivot[2] - sn * df + cs * dh);
  };
  // The body: its planform outline, the crown and keel lines, and section rings at the joint and aft.
  const ST = [...LEV76_BODY.map((s) => s.f)];
  for (const sgn of [1, -1]) {
    const pts = [hinge(...LEV76_BODY_APEX), ...ST.map((f) => { const q = levBodyPoint(f, sgn > 0 ? 0 : 180); return hinge(q[0], q[1], q[2]); })];
    for (let i = 0; i + 1 < pts.length; i++) H.line(pts[i], pts[i + 1], 0.0009);
  }
  for (const a of [90, -90, 45, 135]) {
    const pts = [hinge(...LEV76_BODY_APEX), ...ST.map((f) => { const q = levBodyPoint(f, a); return hinge(q[0], q[1], q[2]); })];
    for (let i = 0; i + 1 < pts.length; i++) H.line(pts[i], pts[i + 1], a === 90 ? 0.0008 : 0.0006);
  }
  for (const f of [V.cut + 0.002, V.cut - 0.004, 0.0, -0.5]) {
    const r = Array.from({ length: 17 }, (_, i) => { const q = levBodyPoint(f, i * 360 / 16); return hinge(q[0], q[1], q[2]); });
    for (let i = 0; i < 16; i++) H.line(r[i], r[i + 1], f === V.cut + 0.002 && R.visor > 0.02 ? 0.0011 : 0.0005, f > V.cut && R.visor > 0.02 ? HOLO_AMBER : HOLO_LINE);
  }
  // The body's top as plates either side of the crown, so she reads as one lifting surface.
  for (let i = 0; i + 1 < ST.length; i++) for (const [a0, a1] of [[0, 45], [45, 90], [90, 135], [135, 180]]) {
    const q = [levBodyPoint(ST[i], a0), levBodyPoint(ST[i], a1), levBodyPoint(ST[i + 1], a1), levBodyPoint(ST[i + 1], a0)];
    H.plate(q.map((p) => hinge(p[0], p[1], p[2])), HOLO, 0.4);
  }
  // The cab, a lit plate on the nose, riding the visor.
  {
    const W = LEV76_GLASS.windscreen, pts = [];
    for (const a of [10, 50, 90, 130, 170]) { const q = levCabPoint(W.f[0], a); pts.push(hinge(q[0], q[1], q[2])); }
    for (const a of [170, 130, 90, 50, 10]) { const q = levCabPoint(W.f[1], a); pts.push(hinge(q[0], q[1], q[2])); }
    for (let i = 0; i < 4; i++) H.plate([pts[i], pts[i + 1], pts[8 - i], pts[9 - i]], HOLO_LINE, 0.6);
  }
  // The outer wings, each a plate with its edges lined, a raked winglet, the flaps down to the notch.
  for (const s of [1, -1]) {
    const le = HOLO_WING.map((w) => M(w.le, s * w.g, w.h)), te = HOLO_WING.map((w) => M(w.te, s * w.g, w.h));
    for (let i = 0; i + 1 < le.length; i++) {
      H.plate([le[i], le[i + 1], te[i + 1], te[i]], HOLO, 0.45);
      H.line(le[i], le[i + 1], 0.0009); H.line(te[i], te[i + 1], 0.0008);
    }
    H.line(le[le.length - 1], te[te.length - 1], 0.0008);
    H.line(M(-0.36, s * 1.03, 0.078), M(-0.5, s * 1.07, 0.2), 0.0008); H.line(M(-0.5, s * 1.07, 0.2), M(-0.58, s * 1.07, 0.2), 0.0008); H.line(M(-0.58, s * 1.07, 0.2), M(-0.615, s * 1.03, 0.078), 0.0008);
    const fd = R.flap / 3 * 0.05;
    H.line(M(-0.84 - fd, s * 0.45, 0.02 - fd), M(-0.72 - fd, s * 0.75, 0.05 - fd), 0.0008, R.flap ? HOLO_LINE : HOLO);
    // The canted fin, raked out 20°.
    const fin = [[-0.5, 0], [-0.86, 0], [-1.06, 0.33], [-0.86, 0.33]].map(([f, z]) => M(f, s * (0.56 + Math.sin(20 * DEG) * z), 0.04 + Math.cos(20 * DEG) * z));
    H.plate(fin, HOLO, 0.45);
    for (let i = 0; i < 4; i++) H.line(fin[i], fin[(i + 1) % 4], 0.0008);
  }
  // The four fans on the deck: a nacelle along the chord, the fan ringed in its own engine's rpm, and
  // four blade lines turning on the prop phase.
  HOLO_ENG.g.forEach((g, e) => {
    const frac = clamp(R.rpms[e] / 1.05, 0, 1), on = R.powered && R.rpms[e] > 0.02;
    const h = levBodySurface(-0.45, g) + 0.084, hub = M(HOLO_ENG.f, g, h), rr = HOLO_ENG.r * sc * 1.1;
    H.line(hub, M(HOLO_ENG.f - HOLO_ENG.len, g, h), 0.0014);
    H.ring(M(HOLO_ENG.f - HOLO_ENG.len, g, h), [1, 0, 0], [0, 0, 1], rr * 0.55, 8, HOLO, 0.5);
    H.ring(hub, [1, 0, 0], [0, 0, 1], rr, 12, HOLO, 0.4);
    if (frac > 0.01) H.ring(hub, [1, 0, 0], [0, 0, 1], rr * 1.18, Math.max(2, Math.round(14 * frac)), frac > 0.85 ? HOLO_LINE : HOLO_AMBER, on ? 1 : 0.4, Math.PI / 2, Math.PI / 2 - frac * TAU);
    for (let b = 0; b < 4; b++) {
      const t = (on ? R.phase * 3 : 0) + b * TAU / 4 + e * 0.5;
      H.line(hub, add(hub, [Math.cos(t) * rr * 0.9, 0, Math.sin(t) * rr * 0.9]), 0.0007, HOLO_LINE, on ? 1 : 0.5);
    }
  });
  // The trailing edge, closing the body.
  H.line(M(LEV76_BODY_TE, -0.46, 0.02), M(LEV76_BODY_TE, 0.46, 0.02), 0.0008);
}

// ── THE FLIGHT PAGE: attitude, speed and height tapes, a heading tape, the vertical speed ──
const LBL = [140, 176, 170];
function pfd(Pn, R) {
  Pn.attitude(0, -0.006, 0.066, R.pitch, R.bank);
  tape(Pn, -0.115, R.ias, 5, 10, 'KT');
  tape(Pn, 0.115, R.alt, 50, 100, 'FT');
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

// ── THE ENGINES PAGE: four fans in a row, each turning, ringed in its own rpm, its own lever under it ──
function enginesPage(Pn, R) {
  const US = [-0.105, -0.035, 0.035, 0.105], fv = 0.04, fr = 0.024;
  for (let e = 0; e < NENG; e++) {
    const u = US[e], frac = clamp(R.rpms[e] / 1.05, 0, 1), on = R.powered && R.rpms[e] > 0.02;
    const ring = frac > 0.85 ? T.glow : T.amber;
    Pn.annulus(u, fv, fr - 0.003, fr, [30, 44, 44], 0.3, 0.003, 18);
    if (frac > 0.01) Pn.annulus(u, fv, fr - 0.003, fr, ring, 0.95, 0.0035, Math.max(2, Math.round(18 * frac)), Math.PI / 2, Math.PI / 2 - frac * TAU);
    // Nine wide-chord blades on the prop phase.
    for (let b = 0; b < 9; b++) Pn.spoke(u, fv, (on ? R.phase * 3 : 0) + b * TAU / 9 + e * 0.5, 0.004, fr - 0.005, 0.002, T.white, 0.8, 0.0045, 0.0006);
    Pn.disc(u, fv, 0.004, [200, 210, 210], 0.6, 0.005, 8);
    Pn.text(String(e + 1), u, fv + fr + 0.004, 0.012, LBL, 0.5, 0.003);
    // The spool as a percentage, and the lever as a bar filled to its thrust.
    Pn.digits(u - 0.024, -0.008, 0.014, String(Math.round(R.rpms[e] * 100)).padStart(3, ' '), on ? T.white : T.dim, false);
    const t = R.thrs[e];
    Pn.rect(u - 0.007, -0.088, u + 0.007, -0.025, [20, 30, 32], 0.3, 0.002);
    if (t > 0.005) Pn.rect(u - 0.005, -0.086, u + 0.005, lerp(-0.086, -0.027, t), t > 0.95 ? T.amber : R.baulk ? T.warn : T.glow, 0.9, 0.003);
  }
  Pn.text('N1', -0.14, -0.006, 0.011, LBL, 0.5, 0.003);
  Pn.text('THR', -0.137, -0.06, 0.011, LBL, 0.5, 0.003);
  Pn.text(R.baulk ? 'BAULKED' : R.split ? 'SPLIT' : 'SET', 0, -0.1, 0.012, R.baulk ? T.amber : R.split ? T.white : T.glow, 0.7, 0.003);
}

// ── THE H2 PAGE: the tanks, each fan's burn, the total, the endurance at this burn ──
function h2Page(Pn, R) {
  const tx = -0.11, ty0 = -0.085, ty1 = 0.06, col = R.fuel < 0.15 ? T.warn : R.fuel < 0.3 ? T.amber : T.glow;
  Pn.rect(tx - 0.022, ty0, tx + 0.022, ty1, [20, 30, 32], 0.3, 0.002);
  Pn.rect(tx - 0.018, ty0 + 0.004, tx + 0.018, lerp(ty0 + 0.004, ty1 - 0.004, R.fuel), col, 0.9, 0.003);
  for (let i = 1; i < 4; i++) Pn.rect(tx + 0.022, lerp(ty0, ty1, i / 4) - 0.0008, tx + 0.03, lerp(ty0, ty1, i / 4) + 0.0008, T.glowDim, 0.6, 0.003);
  Pn.text('LH2', tx, ty1 + 0.006, 0.0145, LBL, 0.5, 0.003);
  Pn.digits(-0.07, 0.04, 0.022, String(Math.round(R.fuel * 100)).padStart(3, ' '), col === T.glow ? T.white : col, false);
  Pn.text('PCT', 0.0, 0.045, 0.0145, LBL, 0.5, 0.003);
  // Each fan's burn, a bar on one scale.
  R.flows.forEach((fl, e) => {
    const y = 0.016 - e * 0.016;
    Pn.text(String(e + 1), -0.055, y - 0.006, 0.0145, LBL, 0.5, 0.003);
    Pn.rect(-0.04, y - 0.004, 0.14, y + 0.004, [20, 30, 32], 0.3, 0.002);
    if (fl > 0.005) Pn.rect(-0.04, y - 0.003, lerp(-0.04, 0.14, clamp(fl / 1.5, 0, 1)), y + 0.003, fl > 1.4 ? T.amber : T.glow, 0.9, 0.0035);
  });
  Pn.text('T/H', 0.0, -0.066, 0.0145, LBL, 0.5, 0.003);
  Pn.digits(0.03, -0.074, 0.016, R.burn.toFixed(1).padStart(4, ' '), T.white, false);
  Pn.text('MIN', -0.055, -0.092, 0.0145, LBL, 0.5, 0.003);
  Pn.digits(0.03, -0.1, 0.014, String(R.endur).padStart(3, ' '), R.burn > 0.01 ? T.white : T.dim, false);
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

// ── THE CARGO PAGE: the nose in side elevation on its hinge, the ramp, the visor's travel, the baulk ──
// ⚠ NO LOAD FIGURE: the sim carries no cargo mass, so the page shows what it does know (the visor, the
// ramp that follows it, the throttle baulk an open nose puts on) and says the load is not sensed.
function cargoPage(Pn, R) {
  const ox = 0.035, oy = -0.023, k = 0.13;   // the drawing, on the right half: f to the right, h up, the joint at ox
  const V = LEV76_VISOR, th = R.visor * V.swing * DEG, cs = Math.cos(th), sn = Math.sin(th);
  const at = (f, h, nose) => {
    if (nose) { const df = f - V.pivot[0], dh = h - V.pivot[2]; f = V.pivot[0] + cs * df + sn * dh; h = V.pivot[2] - sn * df + cs * dh; }
    return [ox + (f - V.cut) * k, oy + h * k];
  };
  const seg = (a, b, w, rgb, e) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, px = -dy / L * w, py = dx / L * w;
    Pn.plate([[a[0] - px, a[1] - py], [b[0] - px, b[1] - py], [b[0] + px, b[1] + py], [a[0] + px, a[1] + py]], rgb, e, 0.003);
  };
  const crown = (f) => levBodyPoint(f, 90)[2], keel = (f) => levBodyPoint(f, -90)[2];
  // The body aft of the joint, crown and keel back across the page.
  const aft = [V.cut, 0.5, 0.4, 0.3];
  for (let i = 0; i + 1 < aft.length; i++) { seg(at(aft[i], crown(aft[i])), at(aft[i + 1], crown(aft[i + 1])), 0.0012, T.glowDim, 0.7); seg(at(aft[i], keel(aft[i])), at(aft[i + 1], keel(aft[i + 1])), 0.0012, T.glowDim, 0.7); }
  // The nose, on its hinge: its crown, its keel and the cab, amber while it is not locked.
  const nc = R.visor > 0.02 ? T.amber : T.glow;
  const fore = [V.cut, 0.7, 0.8, 0.9, 0.97, 1.02, 1.06];
  for (let i = 0; i + 1 < fore.length; i++) {
    seg(at(fore[i], crown(fore[i]), 1), at(fore[i + 1], crown(fore[i + 1]), 1), 0.0014, nc, 0.9);
    seg(at(fore[i], keel(fore[i]), 1), at(fore[i + 1], keel(fore[i + 1]), 1), 0.0014, nc, 0.9);
  }
  seg(at(fore[fore.length - 1], crown(fore[fore.length - 1]), 1), at(LEV76_BODY_APEX[0], LEV76_BODY_APEX[2], 1), 0.0014, nc, 0.9);
  seg(at(fore[fore.length - 1], keel(fore[fore.length - 1]), 1), at(LEV76_BODY_APEX[0], LEV76_BODY_APEX[2], 1), 0.0014, nc, 0.9);
  const cab = [0.9, 0.95, 1.0, 1.03].map((f) => at(f, levCabPoint(f, 90)[2], 1));
  for (let i = 0; i + 1 < cab.length; i++) seg(cab[i], cab[i + 1], 0.0012, nc, 0.9);
  // The hinge, a dot; the ramp, unfolding from the hold floor to the ground over the visor's last stretch.
  Pn.disc(...at(V.pivot[0], V.pivot[2]), 0.003, T.white, 0.9, 0.004, 8);
  if (R.ramp > 0.001) {
    const ang = (-105 + 105 * R.ramp) * DEG, L = 0.47, a0 = at(V.cut, -0.125);
    seg(a0, [a0[0] + Math.cos(-0.36 + ang) * L * k, a0[1] + Math.sin(-0.36 + ang) * L * k], 0.0015, T.white, 0.9);
  }
  // The ground.
  seg([-0.01, oy - 0.285 * k], [0.14, oy - 0.285 * k], 0.0006, T.glowDim, 0.5);
  // The readings: the nose's state, its travel, the ramp, the baulk, and the load the sim does not know.
  Pn.text('NOSE', -0.105, 0.064, 0.011, LBL, 0.5, 0.003);
  Pn.text(R.nose, -0.09, 0.04, 0.013, R.visor > 0.02 ? T.amber : T.white, 0.9, 0.003);
  Pn.digits(-0.135, 0.006, 0.016, String(Math.round(R.visor * 100)).padStart(3, ' '), T.white, false);
  Pn.text('PCT', -0.06, 0.009, 0.011, LBL, 0.5, 0.003);
  Pn.text('RAMP', -0.105, -0.022, 0.011, LBL, 0.5, 0.003);
  Pn.text(R.ramp >= 0.99 ? 'DOWN' : R.ramp > 0.001 ? 'MOVING' : 'STOWED', -0.09, -0.044, 0.013, R.ramp > 0.001 ? T.amber : T.white, 0.9, 0.003);
  Pn.text(R.baulk ? 'THR BAULK' : 'THR FREE', -0.085, -0.072, 0.012, R.baulk ? T.amber : T.glow, 0.8, 0.003);
  Pn.fitText('LOAD NOT SENSED', 0, -0.094, 0.2, 0.012, T.dim, 0.6, 0.003);
}
