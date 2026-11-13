// THE DRAGONFLY 2076'S COCKPIT: the inside of the concept pod, as geometry.
//
// The Dragonfly 2076 is the heli's concept body (mesh_heli_2076.json), after the EHang EH216-S: a
// two-seat electric pod that can fly itself, and does unless somebody is sitting in the right-hand
// seat with their hands on something. Halcyon's Warm Hands Rider voids the hull cover on any flight
// logged without a living pilot at the controls, so the controls are there and they work, and the
// panel says, politely and all the time, that they are advisory.
//
// So this is the opposite room to the Mini-500's. That was grey cloth and a vacu-formed pod on a
// post; this is a carbon tub under a bubble that wraps from your feet to over your head, two
// sculpted seats, a centre stick on a column, a thrust lever on the console, yaw pedals that
// slide on rails, and one long display across the front with the attitude, the eight rotors, the
// battery and the map on it. A head-up combiner stands over the pilot's screen.
//
// Sources read for this file:
//   https://en.wikipedia.org/wiki/EHang_216
//     two seats side by side, eight arms with coaxial rotors (16 props on the production EH216-S;
//     this one has four arms and eight), electric, autonomous, 5.73 m long.
//   The EH216-S cabin as photographed at its 2023 type certification: two seats, a full-width
//     touch display, no flight controls for the occupants. The controls here are the game's fiction.
//
// ── ⚠ THE ROOM IS THE EXTERIOR'S POD ────────────────────────────────────────
//
// client/shared/cabin-dragonfly-2076.js states the pod's stations and where its glass is, and the
// exterior generator builds the shell and the panes from the same file. Everything here is read off
// it: the wall is the pod's own section walked at its own stations and pushed in by a wall's
// thickness, the windows are the absence of wall where the layout says glass, and the floor stops
// where it meets the hull. Nothing about the shape of the cabin is typed here.
//
// ── ⚠ ONE SCALE: THE EH216-S'S LENGTH OVER THE MODEL'S ──────────────────────
//
// 5.73 m over the compiled exterior's nose-to-tail length, so the room and the airframe agree about
// what a metre is. Anything about a PERSON (seat width, reach, a screen's size) is honest metres.
//
// ── ⚠ ANIMATION IS LIVE STATE, NEVER A CLOCK ────────────────────────────────
//
// The rotor diagram's blades turn on `live.phase` (the rotor phase cockpit.js already integrates for
// the exterior), the attitude and the tapes on the flight state, the battery on the fuel. So the gate
// can drive every moving thing to both stops headlessly, as it can every other cockpit.
//
// Pure: no clock, no camera, no DOM. `live` arrives as an argument.
import { nightAt } from './sky-keys.js';
import { brandTrim } from './interior-brands.js';
import { makeKit, C, clamp, lerp, SHINY, PANE, TEXTURE } from './interior-kit.js';
import { contactShadow, hotspotHalo, panelGps, gpsHotspot, lensLamp, eased, pressPulse, HALO,
  bootAge, reveal, alertLight, sweep, lightLine, bandFrame, glassBand, holoFrame, holoProjector, windscreenHud,
  HOLO, HOLO_LINE, HOLO_AMBER, HOLO_RED, stickColumn } from './interior-cockpit-kit.js';
import { MESH_ROWS } from './vehicle-meshes.js';
import { compileMesh } from './vehicle-mesh.js';
import { CAB_STATIONS, CAB_GLASS, CAB_DOOR, CAB_INSIDE, EH216_LENGTH_M, cabSection, cabPoint, cabGlassAt } from './cabin-dragonfly-2076.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ── THE STYLE ────────────────────────────────────────────────────────────────
// Pearl and carbon, the exterior's own two materials, with the stock teal as the light that runs
// round the room. Perforated grey leather on the seats.
export const DF76_TRIM = {
  lining: [214, 216, 212], liningDk: [182, 186, 184], headliner: [196, 200, 198],
  carbon: [34, 37, 40], carbonLt: [52, 56, 60], tub: [28, 30, 33],
  leather: [150, 154, 156], leatherDk: [96, 100, 104], bolster: [44, 48, 52],
  teal: [31, 122, 110], glow: [120, 236, 214], glowDim: [40, 92, 84],
  floor: [40, 42, 44], floorEdge: [26, 28, 30], metal: [150, 156, 164], brushed: [120, 126, 134],
  screen: [6, 12, 14], screenDk: [10, 12, 14], bezel: [18, 20, 22], harness: [70, 76, 82], buckle: [176, 182, 190],
  combiner: [120, 220, 200], red: [235, 60, 48], amber: [255, 176, 64],
};
const T = DF76_TRIM;
for (const k of ['lining', 'liningDk', 'headliner']) TEXTURE.set(T[k], 'paint');
for (const k of ['carbon', 'carbonLt', 'tub', 'bezel']) TEXTURE.set(T[k], 'plastic');
for (const k of ['leather', 'leatherDk', 'bolster']) TEXTURE.set(T[k], 'leather');
for (const k of ['floor', 'floorEdge']) TEXTURE.set(T[k], 'carpet');
for (const k of ['metal', 'brushed', 'buckle']) TEXTURE.set(T[k], 'brushed');
TEXTURE.set(T.harness, 'fabric');
SHINY.set(T.carbon, { spec: 0.45, pow: 30 });
SHINY.set(T.carbonLt, { spec: 0.4, pow: 26 });
SHINY.set(T.lining, { spec: 0.2, pow: 16 });
SHINY.set(T.metal, { spec: 0.7, pow: 36 });
SHINY.set(T.buckle, { spec: 0.8, pow: 40 });
SHINY.set(T.screen, { spec: 0.6, pow: 60 });
brandTrim(T, 'dragonfly', TEXTURE, SHINY);
// The head-up combiner: a sheet of tinted glass you read the symbology on and look through.
PANE.set(T.combiner, 0.12);

// ── THE EXTERIOR, MEASURED ──────────────────────────────────────────────────
// The model's length, nose apex to the aft-most face the renderer draws, off the compiled mesh.
function modelLength(doc) {
  let fMax = -Infinity, fMin = Infinity;
  for (const f of compileMesh(doc, { detail: 1 }).faces) {
    if (f.role === 'rotor') continue;
    for (const q of f.p) { if (q[0] > fMax) fMax = q[0]; if (q[0] < fMin) fMin = q[0]; }
  }
  return fMax - fMin;
}

// Where the pilot's eye is in the model: right of the centreline over the right-hand seat, a seated
// eye height (1.05 m) over the cabin floor, a hand's width ahead of the seat back.
const EYE = { f: 0.10, g: CAB_INSIDE.seatG, overFloorM: 1.05 };
const WALL_M = 0.035;                 // carbon skin plus the lining

// ── THE PROFILE ──────────────────────────────────────────────────────────────
export function dragonfly2076Profile(doc = MESH_ROWS.heli_2076) {
  if (!doc) return null;
  const m = EH216_LENGTH_M / modelLength(doc);
  const fE = EYE.f, gE = EYE.g, hE = CAB_INSIDE.floorH + EYE.overFloorM / m;
  const X = (g) => (g - gE) * m, Y = (f) => (f - fE) * m, Z = (h) => (h - hE) * m;
  const toShell = (q) => [X(q[1]), Y(q[0]), Z(q[2])];
  const inset = WALL_M / m;
  const fB = CAB_INSIDE.bulkheadF, zF = Z(CAB_INSIDE.floorH);
  const G = { m, X, Y, Z, toShell, inset, fB, zF, fW: CAB_GLASS.windscreen.f[0] };
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
  const seatZ = zF + 0.32;
  const P = {
    label: 'Dragonfly 2076 pod',
    xCentre, halfW,
    floor: z0 - 1e-6, roof: z1 + 1e-6, front: y1 + 1e-6, back: y0 - 1e-6,
    mPerUnit: m, glassAftY: Y(G.fW),
    // The side rays go out through the middle of each door window.
    winY: [Y(0.06), Y(0.22)], winZ: [Z(0.12), Z(0.22)],
    dashY: Y(0.33) - 0.06, dashZ: -0.36, headerZ: Z(0.28), pillarW: 0.03,
    seatZ, seatHalf: 0.25, seatY: [-0.26, 0.20], backZ: 0.02,
    roofGlass: true,          // straight up from the pilot is door glass and sky, as in the real bubble
    seats: 2, centrePost: 0,
    normalLit: true,
    floods: [{ p: [xCentre * 0.5, 0.7, -0.30], r: 0.5 }, { p: [xCentre, 0.05, 0.28], r: 0.65 }],
    floodGain: 1.6, glare: 0.25,
    room: df76Shell,
    glass,
    df76: { ...G, faces: room.faces },
    hotspots(live) { return df76Hotspots(this, live); },
  };
  return P;
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
// Built once per profile: lining, door cards, headliner, bulkhead, floor, window reveals and the
// light that runs round the room. Nothing here moves.
function buildRoom(G) {
  const { toShell, inset, fB, zF, m } = G;
  const faces = [];
  const put = (p, n, tone, k, rgb, emis) => faces.push({ p, n, tone, k, rgb, emis: emis || 0 });
  const K = makeKit((fs, tone, k, fwd, rgb, emis) => { for (const f of fs) put(f.p, f.n, tone, k, rgb, emis); }, false);
  const S = (f, aDeg, inM = 0) => toShell(cabPoint(f, aDeg, -(inset + inM / m)));
  const inward = (f, a) => {
    const d = 1e-4;
    let n = norm(cross(sub(S(f + d, a), S(f - d, a)), sub(S(f, a + d * 50), S(f, a - d * 50))));
    const c = toShell([f, 0, cabSection(f).cz]);
    if (dot(n, sub(c, S(f, a))) < 0) n = mul(n, -1);
    return n;
  };
  const aboveFloor = (poly) => clipHalf(poly, (q) => q[2] - zF);

  // ── THE SHELL: lining over the crown, carbon below the waist, door cards on the doors ──
  // Walked in the pod's own (f, angle), from the bulkhead to the nose, with every pane of glass cut
  // out of it exactly (the rectangles in cabin-dragonfly-2076.js, as holes).
  const fN = CAB_STATIONS[1].f;
  const FS = [];
  for (const f of [fB, -0.03, 0.01, 0.06, 0.11, 0.16, 0.21, 0.26, 0.31, 0.33, 0.36, 0.405, 0.455, 0.515, 0.565, 0.605, 0.635, fN]) FS.push(f);
  const NA = 72;
  const holes = [];
  const W = CAB_GLASS.windscreen;
  holes.push([[W.f[0], W.a[0]], [W.f[1] + 0.01, W.a[0]], [W.f[1] + 0.01, W.a[1]], [W.f[0], W.a[1]]]);
  for (const k of ['door', 'skylight']) {
    const r = CAB_GLASS[k];
    holes.push([[r.f[0], r.a[0]], [r.f[1], r.a[0]], [r.f[1], r.a[1]], [r.f[0], r.a[1]]]);
    if (k === 'door') holes.push([[r.f[0], 180 - r.a[1]], [r.f[1], 180 - r.a[1]], [r.f[1], 180 - r.a[0]], [r.f[0], 180 - r.a[0]]]);
  }
  const D = CAB_DOOR;
  for (let i = 0; i < FS.length - 1; i++) {
    for (let j = 0; j < NA; j++) {
      const f0 = FS[i], f1 = FS[i + 1], a0 = -90 + (j / NA) * 360, a1 = -90 + ((j + 1) / NA) * 360;
      let cells = [[[f0, a0], [f1, a0], [f1, a1], [f0, a1]]];
      for (const h of holes) cells = cells.flatMap((c) => (bbOverlap(c, h) ? subtractConvex(c, h) : [c]));
      const fm = (f0 + f1) / 2, am = (a0 + a1) / 2, sn = Math.sin(am * DEG);
      const n = inward(fm, am);
      const side = Math.abs(Math.cos(am * DEG)) > 0.2;
      const aSide = am > 90 ? 180 - am : am;
      const inDoor = side && fm > D.f[0] && fm < D.f[1] && aSide > D.aLo && aSide < D.aHi;
      for (const c of cells) {
        const poly = aboveFloor(c.map(([f, a]) => S(f, a)));
        if (poly.length < 3) continue;
        if (sn > 0.9) put(poly, n, 'hdr', -0.28, T.headliner);
        else if (inDoor) put(poly, n, 'pil', -0.06, aSide < 4 ? T.carbonLt : T.lining);
        else if (sn < -0.2) put(poly, n, 'pil', -0.18, T.tub);
        else put(poly, n, 'pil', -0.12, T.liningDk);
      }
    }
  }

  // ── THE REVEALS: a carbon return round every window, from the lining out to the skin, and a lit
  // seal along its inner edge. The windscreen's aft edge is the A-pillar arch all the way round.
  const reveal = (pts, cF, cA) => {
    for (let t = 1; t < pts.length; t++) {
      const [fa, aa] = pts[t - 1], [fb, ab] = pts[t];
      const i0 = S(fa, aa), i1 = S(fb, ab), o0 = toShell(cabPoint(fa, aa, -0.004 / m)), o1 = toShell(cabPoint(fb, ab, -0.004 / m));
      const fm = (fa + fb) / 2, am = (aa + ab) / 2;
      const toC = sub(S(cF, cA), S(fm, am));
      const out = norm(sub(toShell(cabPoint(fm, am, 0)), S(fm, am)));
      const rn = norm(sub(toC, mul(out, dot(toC, out))));
      if (i0[2] > zF && i1[2] > zF) put([i0, i1, o1, o0], rn, 'pil', 0.05, T.carbon);
      if (i0[2] > zF + 0.01 && i1[2] > zF + 0.01) K.rod(S(fa, aa, 0.006), S(fb, ab, 0.006), 0.0035, 'pil', 0.1, T.glowDim, 0.35, 5, false);
    }
  };
  const edge = (f0, a0, f1, a1, n) => Array.from({ length: n + 1 }, (_, i) => [lerp(f0, f1, i / n), lerp(a0, a1, i / n)]);
  // The A-pillar arch: the windscreen's aft edge, from chin line to chin line over the top.
  reveal(edge(W.f[0], W.a[0], W.f[0], W.a[1], 30), W.f[0] + 0.05, 90);
  // The chin lines, each side, from the arch to the nose.
  reveal(edge(W.f[0], W.a[0], 0.62, W.a[0], 10), 0.48, 60);
  reveal(edge(W.f[0], W.a[1], 0.62, W.a[1], 10), 0.48, 120);
  for (const k of ['door', 'skylight']) {
    const r = CAB_GLASS[k];
    const rects = k === 'door' ? [r.a, [180 - r.a[1], 180 - r.a[0]]] : [r.a];
    for (const [aLo, aHi] of rects) {
      const cF = (r.f[0] + r.f[1]) / 2, cA = (aLo + aHi) / 2;
      reveal([...edge(r.f[0], aLo, r.f[1], aLo, 8), ...edge(r.f[1], aLo, r.f[1], aHi, 6).slice(1), ...edge(r.f[1], aHi, r.f[0], aHi, 8).slice(1), ...edge(r.f[0], aHi, r.f[0], aLo, 6).slice(1)], cF, cA);
    }
  }

  // ── THE DOORS: the gull-wing seam round each card, an armrest, a pull and a speaker ──
  for (const s of [1, -1]) {
    const A = (a) => (s > 0 ? a : 180 - a);
    const seam = [...edge(D.f[1], D.aLo + 6, D.f[1], D.aHi, 10), ...edge(D.f[1], D.aHi, D.f[0] + 0.01, D.aHi, 10).slice(1), ...edge(D.f[0] + 0.01, D.aHi, D.f[0] + 0.01, D.aLo + 6, 10).slice(1)];
    const pts = seam.map(([f, a]) => S(f, A(a), 0.006)).filter((q) => q[2] > zF + 0.02);
    for (let k = 1; k < pts.length; k++) K.rod(pts[k - 1], pts[k], 0.005, 'pil', -0.3, T.carbon, 0, 4, false);
    // The armrest: a carbon blade along the card at elbow height, lit along its top edge.
    const aArm = A(-6);
    const ar0 = S(-0.02, aArm, 0.05), ar1 = S(0.24, aArm, 0.05), an = inward(0.11, aArm);
    const along = norm(sub(ar1, ar0));
    const aUp = norm(cross(cross(along, [0, 0, 1]), along));
    K.obox(mul(add(ar0, ar1), 0.5), along, aUp, norm(cross(along, aUp)), Math.hypot(...sub(ar1, ar0)) / 2, 0.025, 0.045, 'pil', 0.05, T.carbon);
    K.rod(add(ar0, [0, 0, 0.026]), add(ar1, [0, 0, 0.026]), 0.004, 'pil', 0.2, T.glow, 0.9, 5);
    // The pull: a recessed bar ahead of the armrest.
    const p0 = S(0.22, A(14), 0.03), p1 = S(0.29, A(14), 0.03);
    K.rod(p0, p1, 0.01, 'pil', 0.3, T.metal, 0, 8);
    for (const q of [p0, p1]) K.rod(q, S(q === p0 ? 0.22 : 0.29, A(14), 0.004), 0.007, 'pil', 0.3, T.metal, 0, 6);
    // The speaker, low on the card: a ring of holes in a carbon disc.
    const sc = S(0.08, A(-24), 0.004), sn2 = inward(0.08, A(-24)), sr = norm(cross([0, 0, 1], sn2)), su = cross(sn2, sr);
    const Sp = K.panel(add(sc, mul(sn2, 0.002)), sr, su, 'pil', 0.1);
    Sp.disc(0, 0, 0.065, T.carbon, 0, 0.001, 24);
    Sp.annulus(0, 0, 0.066, 0.072, T.glowDim, 0.5, 0.002, 24);
    for (let ring = 1; ring <= 3; ring++) for (let h = 0; h < ring * 8; h++) {
      const t = (h / (ring * 8)) * TAU, r = ring * 0.017;
      Sp.disc(Math.cos(t) * r, Math.sin(t) * r, 0.0035, T.tub, 0, 0.002, 6);
    }
  }

  // ── THE BULKHEAD: carbon, with two padded panels behind the seats and a light bar over them ──
  const NS = 72, bpts = [];
  for (let k = 0; k <= NS; k++) bpts.push(S(fB, -90 + (k / NS) * 360));
  const bulk = aboveFloor(bpts);
  if (bulk.length >= 3) put(bulk, [0, 1, 0], 'post', -0.12, T.carbon);
  const yB = G.Y(fB), xC = G.X(0);
  for (const cx of [0, 2 * xC]) {
    K.box(cx - 0.23, yB, zF + 0.40, cx + 0.23, yB + 0.03, zF + 1.05, 'post', -0.05, T.leatherDk);
    for (let r = 1; r < 6; r++) K.box(cx - 0.23, yB + 0.03, zF + 0.40 + r * 0.108, cx + 0.23, yB + 0.034, zF + 0.404 + r * 0.108, 'post', -0.2, T.bolster);
  }
  K.box(2 * xC - 0.25, yB + 0.005, zF + 1.10, 0.25, yB + 0.02, zF + 1.12, 'post', 0.2, T.glow, 0.9);
  // The first-aid case on the bulkhead over the console: a fixture, not a control.
  K.box(xC - 0.11, yB, zF + 0.80, xC + 0.11, yB + 0.07, zF + 0.95, 'post', 0.05, [210, 212, 208]);
  K.box(xC - 0.012, yB + 0.07, zF + 0.85, xC + 0.012, yB + 0.072, zF + 0.90, 'post', 0.3, T.red, 0.2);
  K.box(xC - 0.03, yB + 0.07, zF + 0.865, xC + 0.03, yB + 0.072, zF + 0.885, 'post', 0.3, T.red, 0.2);

  // ── THE FLOOR: dark mats from the bulkhead to where the floor meets the hull, edged in light ──
  const floorHalf = (f) => {
    // The inset section's half-width at the floor's height: walk the lower right quarter.
    let prev = null;
    for (let a = -90; a <= 0; a += 1) {
      const q = cabPoint(f, a, -inset);
      if (prev && prev[2] < CAB_INSIDE.floorH && q[2] >= CAB_INSIDE.floorH) {
        const t = (CAB_INSIDE.floorH - prev[2]) / (q[2] - prev[2]);
        return (prev[1] + (q[1] - prev[1]) * t) * m;
      }
      prev = q;
    }
    return 0;
  };
  const FF = [];
  for (let f = fB; f < 0.62; f += 0.025) FF.push(f);
  for (let i = 0; i < FF.length - 1; i++) {
    const f0 = FF[i], f1 = FF[i + 1], w0 = floorHalf(f0), w1 = floorHalf(f1);
    if (w0 <= 0.01 || w1 <= 0.01) continue;
    put([[xC - w0, G.Y(f0), zF], [xC + w0, G.Y(f0), zF], [xC + w1, G.Y(f1), zF], [xC - w1, G.Y(f1), zF]], [0, 0, 1], 'floor', -0.2, i % 6 === 5 ? T.floorEdge : T.floor);
    // The edge light, both sides, a hand in from where the floor meets the wall.
    for (const s of [-1, 1]) K.box(xC + s * (w0 - 0.04) - 0.006, G.Y(f0), zF + 0.001, xC + s * (w0 - 0.04) + 0.006, G.Y(f1), zF + 0.004, 'floor', 0.2, T.glow, 0.85);
  }

  return { faces };
}

// ── THE GLASS ────────────────────────────────────────────────────────────────
// The panes the renderer lays over the room as film: each window in the layout, faceted along the
// pod in (f, angle) small enough to be flat, 5 mm inside the skin and outboard of every reveal.
function buildGlass(G) {
  const { toShell, m } = G;
  const d = 0.005 / m;
  const panes = [];
  const grid = (f0, f1, a0, a1, nf, na) => {
    for (let i = 0; i < nf; i++) for (let j = 0; j < na; j++) {
      const fa = lerp(f0, f1, i / nf), fb = lerp(f0, f1, (i + 1) / nf), aa = lerp(a0, a1, j / na), ab = lerp(a0, a1, (j + 1) / na);
      panes.push([[fa, aa], [fb, aa], [fb, ab], [fa, ab]].map(([f, a]) => toShell(cabPoint(f, a, -d))));
    }
  };
  const W = CAB_GLASS.windscreen;
  grid(W.f[0], CAB_STATIONS[1].f, W.a[0], W.a[1], 8, 24);
  panes.bubble = panes.length;
  const Dg = CAB_GLASS.door, Sk = CAB_GLASS.skylight;
  grid(Dg.f[0], Dg.f[1], Dg.a[0], Dg.a[1], 4, 4);
  grid(Dg.f[0], Dg.f[1], 180 - Dg.a[1], 180 - Dg.a[0], 4, 4);
  grid(Sk.f[0], Sk.f[1], Sk.a[0], Sk.a[1], 4, 1);
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
function df76Shell(P, live, push, rich) {
  const D = P.df76;
  for (const f of D.faces) push(f.one || (f.one = Object.assign([{ p: f.p, n: f.n }], { stable: true })), f.tone, f.k, false, f.rgb, f.emis || 0);
  seats(P, push);
  if (rich) df76Fit(P, live, push);
}

// ── THE READINGS ─────────────────────────────────────────────────────────────
const readings = (live) => {
  const L = live || {};
  return {
    L,
    pitch: num(L.pitch), bank: num(L.bank), hdg: num(L.hdg),
    ias: Math.max(0, num(L.ias)), vne: Math.max(40, num(L.vne, 90)),
    alt: Math.max(0, num(L.alt)), vsi: num(L.vsi),
    rpm: clamp(num(L.rpm), 0, 1.1), thr: clamp(num(L.throttle), 0, 1),
    fuel: clamp(num(L.fuel, 1), 0, 1), hull: clamp(num(L.hull, 1), 0, 1),
    temp: clamp(num(L.oilTemp, 0.4), 0, 1),
    powered: L.powered !== false,
    ail: clamp(num(L.stickX), -1, 1), elev: clamp(num(L.stickY), -1, 1), rud: clamp(num(L.rudder), -1, 1),
    land: !!L.landingLight, dome: !!L.dome, hour: num(L.hour, 12),
    phase: num(L.phase), stall: !!L.stall,
  };
};
const night = (R) => nightAt(R.hour);
const panelOn = (R) => R.powered && (R.L.panelLight != null ? !!R.L.panelLight : night(R));

// ── WHERE THE CONTROLS ARE ───────────────────────────────────────────────────
// One place says where each thing you can grab is; the drawing and the hotspots both read it.
// The centre stick on its column; the thrust lever on the console at the pilot's left hand.
const STICK = { base: [0, 0.42, 0.56], len: 0.15 };
const ARMREST = [0.30, 0.16, 0.56];            // z off the floor
const LEVER = { dx: 0.08, pivotY: -0.02, top: 0.50, len: 0.20 };  // dx right of the console's middle
const CONSOLE = { hw: 0.11, y0: -0.36, y1: 0.42, top: 0.46 };
function stickAt(P, R) {
  const base = [STICK.base[0], STICK.base[1], P.df76.zF + STICK.base[2]];
  const dir = norm([R.ail * 0.32, -R.elev * 0.32, 1]);
  return { base, top: add(base, mul(dir, STICK.len)), dir };
}
function leverAt(P, R) {
  const pivot = [P.xCentre + LEVER.dx, LEVER.pivotY, P.df76.zF + LEVER.top];
  const ang = -0.55 + R.thr * 1.1;                                   // back at idle, forward at full
  const dir = [0, Math.sin(ang), Math.cos(ang)];
  return { pivot, end: add(pivot, mul(dir, LEVER.len)), dir, ang };
}

// ── THE DASH: one sculpted wing across the cabin, and on its face toward you one band of glass ──
// The band runs door to door in a shallow curve round the pilot, and every page, key and lamp sits
// on it. `curve(s)` gives the band's lower edge and the outward direction across the dash; the dash
// body is swept along the same curve, so the glass is the dash's own face.
const DASH = { xL: -0.93, xR: 0.31, yMid: 0.76, sag: 0.16, w: 0.66, z0: -0.48, h: 0.25, lean: 0.45 };
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
// The four keys the sim has (power and three lighting circuits) are glass keys on the band's right
// end, beside the pilot's page, so a forward look shows every one and its state. The stick, the
// thrust lever and the pedals sit low, so each is mirrored in the windscreen HUD (`windscreenHud`):
// the pilot sees what every hand and foot is doing without looking down.
const BTN = { ids: ['master', 'land', 'panel', 'dome'], names: { master: 'PWR', land: 'LAND', panel: 'PANEL', dome: 'CABIN' } };
const BTN_AT = (i) => ({ x: [0.212, 0.272][i % 2], v: [0.175, 0.105][i >> 1] });
function switchOn(id, R) {
  if (id === 'master') return R.powered;
  if (id === 'land') return R.land;
  if (id === 'panel') return panelOn(R);
  if (id === 'dome') return R.dome && R.powered;
  return R.powered;
}

// ── THE PAGES on the band, and the status lamps along its foot ──
const SCREENS = [
  { id: 'rotors', x: -0.80, w: 0.17, boot: 0.45 },
  { id: 'energy', x: -0.52, w: 0.15, boot: 0.3 },
  { id: 'map', x: -0.25, w: 0.15, boot: 0.15 },     // the one screen you click (destinations): inside the forward view
  { id: 'pfd', x: 0.0, w: 0.17, boot: 0 },
];
const SCREEN_H = 0.095, PAGE_V = 0.135;
// Lifted clear of the band: a flat page on a curved sheet stands off it by about a centimetre at its ends.
const screenPanel = (K, P, sc) => bandPanel(K, P, sc.x, PAGE_V, 0.014);
const LAMP_X = [-0.80, -0.63, -0.455, -0.28, -0.105];

export function df76Hotspots(P, live) {
  const R = readings(live), K = makeKit(() => {}), out = [];
  BTN.ids.forEach((id, i) => { const b = BTN_AT(i); out.push({ id: 'ck:' + id, p: bandPanel(K, P, b.x, b.v).pt(0, 0, 0.01), r: 0.026, kind: 'click' }); });
  out.push({ id: 'yoke', p: add(stickAt(P, R).top, [0, 0, 0.04]), r: 0.06, kind: 'yoke' });
  const lv = leverAt(P, R);
  out.push({ id: 'throttle', p: add(lv.end, mul(lv.dir, 0.03)), r: 0.045, kind: 'throttle' });
  out.push(gpsHotspot(screenPanel(K, P, SCREENS.find((sc) => sc.id === 'map')), 0, 0, 0.06));
  return out;
}

// ── THE SEATS: sculpted carbon shells with perforated leather, a five-point harness each ──
function seats(P, push) {
  const K = makeKit(push, false);
  for (const cx of [0, 2 * P.xCentre]) shell(K, P, cx);
}
function shell(K, P, cx) {
  const h = P.seatHalf, [y0, y1] = P.seatY, sz = P.seatZ, zF = P.df76.zF;
  // The pedestal and the shell's pan.
  K.box(cx - 0.12, y0 + 0.08, zF, cx + 0.12, y1 - 0.12, sz - 0.12, 'seat', -0.25, T.carbon);
  K.box(cx - h, y0, sz - 0.12, cx + h, y1, sz - 0.06, 'seat', 0.0, T.carbon);
  K.box(cx - h + 0.05, y0 + 0.02, sz - 0.06, cx + h - 0.05, y1 - 0.02, sz, 'seat', 0.08, T.leather);
  // Side bolsters, carbon outside and leather on top, with a lit seam.
  for (const s of [-1, 1]) {
    K.box(cx + s * h - s * 0.05, y0, sz - 0.06, cx + s * h, y1, sz + 0.07, 'seat', 0.05, T.bolster);
    K.box(cx + s * (h - 0.025) - 0.003, y0 + 0.02, sz + 0.07, cx + s * (h - 0.025) + 0.003, y1 - 0.02, sz + 0.074, 'seat', 0.2, T.glow, 0.6);
  }
  // Perforations: rows of small dark dots across the cushion insert.
  for (let i = 0; i < 6; i++) for (let j = 0; j < 7; j++) {
    const y = lerp(y0 + 0.06, y1 - 0.06, i / 5), x = cx + lerp(-h + 0.09, h - 0.09, j / 6);
    K.box(x - 0.004, y - 0.004, sz + 0.0005, x + 0.004, y + 0.004, sz + 0.002, 'seat', -0.3, T.leatherDk);
  }
  // The back, leaning 14°, a carbon shell with a leather insert and an integrated headrest.
  const lean = 0.2, bb = [cx, y0 - 0.01, sz], up = [0, -Math.sin(lean), Math.cos(lean)], fw = [0, Math.cos(lean), Math.sin(lean)];
  const bH = 0.62;
  const bc = add(bb, mul(up, bH / 2));
  K.obox(add(bc, mul(fw, -0.06)), [1, 0, 0], up, fw, h, bH / 2, 0.04, 'seat', -0.06, T.carbon);
  K.obox(add(bc, mul(fw, -0.015)), [1, 0, 0], up, fw, h - 0.06, bH / 2 - 0.04, 0.012, 'seat', 0.0, T.leather);
  for (const s of [-1, 1]) K.obox(add(add(bc, mul(fw, -0.005)), [s * (h - 0.03), 0, 0]), [1, 0, 0], up, fw, 0.03, bH / 2, 0.04, 'seat', 0.0, T.bolster);
  const hc = add(bb, mul(up, bH + 0.11));
  K.obox(add(hc, mul(fw, -0.04)), [1, 0, 0], up, fw, 0.13, 0.10, 0.05, 'seat', 0.0, T.carbon);
  K.obox(add(hc, mul(fw, 0.012)), [1, 0, 0], up, fw, 0.10, 0.07, 0.008, 'seat', 0.0, T.leather);
  // The harness slot through the headrest's root, and the teal stitch across the back.
  K.obox(add(add(bb, mul(up, bH - 0.01)), mul(fw, 0.0)), [1, 0, 0], up, fw, 0.09, 0.02, 0.045, 'seat', -0.3, T.tub);
  K.obox(add(add(bb, mul(up, bH * 0.55)), mul(fw, -0.002)), [1, 0, 0], up, fw, h - 0.07, 0.004, 0.012, 'seat', 0.2, T.teal, 0.3);
  // Five-point harness: two shoulder straps out of the slot, two lap belts, the crotch strap, a
  // rotary buckle.
  const top = add(bb, mul(up, bH - 0.01)), buck = [cx, y1 - 0.16, sz + 0.14];
  for (const s of [-1, 1]) {
    K.rod(add(add(top, mul(fw, 0.03)), [s * 0.06, 0, 0]), add(buck, [s * 0.025, 0, 0.03]), 0.012, 'seat', 0.05, T.harness, 0, 4);
    K.rod([cx + s * (h - 0.04), y0 + 0.08, sz + 0.03], add(buck, [s * 0.025, 0, -0.01]), 0.012, 'seat', 0.05, T.harness, 0, 4);
  }
  K.rod([cx, y1 - 0.04, sz + 0.005], add(buck, [0, 0, -0.02]), 0.01, 'seat', 0.05, T.harness, 0, 4);
  K.rod(add(buck, [0, -0.008, 0]), add(buck, [0, 0.01, 0]), 0.034, 'seat', 0.3, T.buckle, 0, 12);
  K.rod(add(buck, [0, 0.01, 0]), add(buck, [0, 0.013, 0]), 0.012, 'seat', 0.3, T.teal, 0.4, 8);
}

// ── THE FIT-OUT ──────────────────────────────────────────────────────────────
export function df76Fit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live);
  const zF = P.df76.zF, xC = P.xCentre;
  const lit = R.powered, panel = panelOn(R);
  const amb = lit ? (night(R) ? 1 : 0.55) * (R.dome ? 1.2 : 1) : 0.05;
  const boot = bootAge(live);
  // The cabin's own light lines carry the alert: teal, amber on low charge, red and breathing on a
  // hull or stall warning. They are the first thing to change colour.
  const warn = lit && (R.hull < 0.3 || R.stall), caution = lit && R.fuel < 0.15;
  const al = alertLight(caution, warn, T.line), lineK = (k) => (lit ? k * al.k : 0.05);

  // ── THE DASH: a wing swept along the band's curve ──
  const curve = dashCurve(P);
  const gt = [DASH.h * DASH.lean / Math.hypot(1, DASH.lean), DASH.h / Math.hypot(1, DASH.lean)];   // the glass's top, across and up
  const SEC = [[0, 0], gt, [0.19, 0.245], [0.31, 0.23], [0.34, 0.17], [0.26, -0.05], [0.07, -0.13], [-0.06, -0.09], [-0.07, -0.04], [0, 0]];
  const N = 30, rings = [];
  for (let i = 0; i <= N; i++) {
    // Toward each door the wing thins and drops, as the pod's skin closes in over it.
    const s = i / N, c = curve(s), e = Math.abs(2 * s - 1) ** 3, tap = 1 - 0.6 * e;
    rings.push(SEC.map(([f, z]) => {
      const ff = f > gt[0] ? gt[0] + (f - gt[0]) * tap : f < 0 ? f * tap : f;
      return [c.p[0] + c.f[0] * ff, c.p[1] + c.f[1] * ff, c.p[2] + (z > gt[1] ? gt[1] + (z - gt[1]) * tap : z) - (z > 0.05 ? 0.05 * e : 0)];
    }));
  }
  sweep(K, rings, 'dash', 0.1, T.carbon);
  // End caps: the section, shut.
  for (const r of [rings[0], rings[N]]) {
    const n = norm(cross(sub(r[3], r[1]), sub(r[6], r[1])));
    K.face(r.slice(0, -1), n, 'dash', 0.05, T.carbonLt);
    K.face(r.slice(0, -1).reverse(), mul(n, -1), 'dash', 0.05, T.carbonLt);
  }
  // A light line along the lip under the glass, and one along the shelf's front edge.
  lightLine(K, rings.map((r) => r[7]), 0.003, al.rgb, lineK(0.8));
  lightLine(K, rings.slice(2, -2).map((r) => add(r[3], [0, 0, 0.002])), 0.002, al.rgb, lineK(0.35));
  // The struts the dash hangs off, down to the floor between the footwells.
  for (const x of [xC, xC - 0.5, 0.21]) {
    const c = curve(sOf(x)), top = add(add(c.p, mul(c.f, 0.15)), [0, 0, -0.12]);
    K.rod(top, [top[0], top[1] - 0.05, zF + 0.03], 0.02, 'dash', 0.1, T.carbon, 0, 8);
  }

  // ── THE BAND: one sheet of glass, the pages on it, booting in turn when the power comes on ──
  glassBand(K, curve, { h: DASH.h, lean: DASH.lean, segs: 30, lit, light: al.rgb, lightK: lineK(1), substrate: T.screen });
  for (const sc of SCREENS) {
    const Pn = screenPanel(K, P, sc), up = reveal(boot, sc.boot);
    if (!lit || up <= 0) continue;
    // The boot: a lit line sweeps up the page and the page comes up behind it.
    if (up < 1) {
      const y = lerp(-SCREEN_H, SCREEN_H, up);
      Pn.rect(-sc.w, -SCREEN_H, sc.w, y, T.screen, 0.3 * up, 0.001);
      Pn.rect(-sc.w, y - 0.002, sc.w, y + 0.002, T.glow, 1, 0.0025);
      continue;
    }
    // One display language on every page: a lit edge along the top, teal for normal, amber for
    // caution, red for a warning, and the current value always the brightest thing.
    Pn.rect(-sc.w + 0.004, SCREEN_H - 0.0035, sc.w - 0.004, SCREEN_H - 0.0015, T.glow, 0.85, 0.0018);
    if (sc.id === 'pfd') pfd(Pn, R);
    else if (sc.id === 'rotors') rotorPage(Pn, R);
    else if (sc.id === 'energy') energyPage(Pn, R);
    else if (sc.id === 'map') mapPage(Pn, R, live);
  }
  // The status lamps along the foot of the band: what the aircraft thinks of you.
  {
    const handsOn = lit && (Math.abs(R.ail) > 0.03 || Math.abs(R.elev) > 0.03 || Math.abs(R.rud) > 0.03);
    // ⚠ PILOT PRESENT IS THE RIDER'S LAMP: lit whenever the seat is powered and occupied, which is
    // whenever this cockpit is drawn. It is the one thing on the panel the insurer reads.
    const lamps = [
      ['PILOT PRESENT', lit, C.green], ['HANDS ON', handsOn, T.glow], ['AUTONOMY ADVISORY', lit, T.amber],
      ['LOW SOC', caution, T.red], ['HULL', lit && R.hull < 0.3, T.red],
    ];
    lamps.forEach(([name, on, rgb], i) => lensLamp(bandPanel(K, P, LAMP_X[i], 0.024, 0.012), 0, 0, 0.16, 0.03, on && reveal(boot, 0.6) >= 1, rgb, name));
  }

  // ── THE KEYS: four glass keys on the band's right end ──
  // Feedback: a key sinks while pressed and comes back, its light eases on and off with the circuit,
  // it brightens as the hand comes over it, and a ring flashes round it when its state changes.
  BTN.ids.forEach((id, i) => {
    const b = BTN_AT(i), Kp = bandPanel(K, P, b.x, b.v, 0.004), on = switchOn(id, R);
    const pressed = !!live && live.press === 'ck:' + id, near = !!live && live.hover === 'ck:' + id;
    const rgb = id === 'master' ? C.green : T.glow;
    const glow = eased('df76:glow:' + id, on ? 1 : 0, 10), depth = eased('df76:dip:' + id, pressed ? 0.002 : 0.007, 30);
    const hand = eased('df76:near:' + id, near ? 1 : 0, 14);
    Kp.rect(-0.031, -0.03, 0.031, 0.03, T.tub, 0, 0.0005);
    Kp.annulus(0, 0, 0.029, 0.031, T.glow, (lit ? 0.25 : 0) + hand * 0.75, 0.0012, 20);
    Kp.stud(0, 0, 0.026, 0.026, depth, rgb.map((c, k) => lerp([40, 46, 50][k], c, glow * 0.8)), glow * 0.85 + hand * 0.15, 0.0015);
    Kp.fitText(BTN.names[id], 0, -0.004, 0.044, 0.012, glow > 0.5 ? [10, 24, 22] : [214, 222, 220], glow > 0.5 ? 0 : (panel ? 0.6 : 0.25), depth + 0.0025);
    const flash = pressPulse('df76:key:' + id, on);
    if (flash > 0.02) Kp.annulus(0, 0, 0.034, 0.038, HALO, flash, 0.004, 18);
  });

  // ── THE WINDSCREEN HUD: projected, conformal, with the hands and feet mirrored in its corners ──
  if (lit) windscreenHud(K, R, { dist: 0.62, z: 0.01, hw: 0.2, hh: 0.095, warn, caution, boot: reveal(boot, 0.2),
    mirrors: { stick: [R.ail, R.elev], thrs: [R.thr], rud: R.rud } });

  // ── THE HOLOGRAM over the dash's middle: the aircraft herself, flying as she flies ──
  // Pitched and banked with her, her eight rotors turning on the rotor phase and ringed at their
  // speed, standing on a projector whose arc is the charge left.
  {
    const c0 = curve(sOf(xC - 0.12)), base = add(add(c0.p, mul(c0.f, 0.21)), [0, 0, 0.246]);
    holoProjector(K, base, 0.07, 0.06, lit ? R.fuel : 0, R.fuel < 0.15 ? HOLO_RED : R.fuel < 0.3 ? HOLO_AMBER : HOLO_LINE);
    if (lit && reveal(boot, 0.7) > 0) holoDragonfly(K, add(base, [0, 0, 0.1]), R);
  }

  // ── THE CONSOLE between the seats: the thrust lever, a cup and a pocket ──
  const cy0 = CONSOLE.y0, cy1 = CONSOLE.y1, ct = zF + CONSOLE.top;
  {
    // Swept, not boxed: a rounded section along the console's length, narrowing aft.
    const crings = [];
    for (let i = 0; i <= 8; i++) {
      const y = lerp(cy0, cy1, i / 8), hw = CONSOLE.hw * (0.85 + 0.15 * i / 8);
      const sec = [];
      for (let j = 0; j <= 10; j++) {
        const a = Math.PI * j / 10, x = xC - Math.cos(a) * hw, z = j === 0 || j === 10 ? zF : ct - (1 - Math.sin(a)) * 0.05 + Math.sin(a) * 0.004;
        sec.push([x, y, j === 0 || j === 10 ? zF : Math.max(zF + 0.02, z)]);
      }
      crings.push(sec);
    }
    sweep(K, crings, 'dash', 0.1, T.carbon);
    K.face(crings[8].slice(), [0, 1, 0], 'dash', 0.05, T.carbonLt);
    for (const s of [-1, 1]) lightLine(K, crings.map((r) => add(r[s < 0 ? 1 : 9], [0, 0, 0.004])), 0.0025, al.rgb, lineK(0.85 * amb / Math.max(0.05, amb)));
  }
  // The console's lid, the cup well and the phone pocket aft of the gate.
  K.box(xC - 0.08, 0.16, ct + 0.002, xC + 0.08, 0.40, ct + 0.006, 'dash', 0.2, T.leatherDk);
  K.rod([xC - 0.04, -0.12, ct - 0.08], [xC - 0.04, -0.12, ct + 0.001], 0.04, 'dash', -0.2, T.tub, 0, 14);
  K.box(xC + 0.01, -0.30, ct - 0.03, xC + 0.09, -0.18, ct + 0.001, 'dash', -0.25, T.tub);

  // ── THE THRUST LEVER: a carbon blade in a gate, forward for lift; it lights as the hand nears ──
  const lv = leverAt(P, R), lvNear = eased('df76:near:throttle', live && (live.hover === 'throttle' || live.press === 'throttle') ? 1 : 0, 12);
  K.box(lv.pivot[0] - 0.012, LEVER.pivotY - 0.16, ct - 0.004, lv.pivot[0] + 0.012, LEVER.pivotY + 0.16, ct + 0.007, 'dash', -0.3, T.tub);
  for (let i = 0; i <= 4; i++) {
    const y = LEVER.pivotY - 0.14 + i * 0.07, here = lit && Math.abs(i / 4 - R.thr) < 0.13;
    K.box(lv.pivot[0] + 0.016, y - 0.002, ct + 0.004, lv.pivot[0] + 0.03, y + 0.002, ct + 0.008, 'dash', 0.2, here ? T.glow : T.glowDim, here ? 1 : 0.5);
  }
  K.rod(lv.pivot, lv.end, 0.011, 'dash', 0.2, T.metal, 0, 8);
  const gripEnd = add(lv.end, mul(lv.dir, 0.06));
  K.obox(mul(add(lv.end, gripEnd), 0.5), [1, 0, 0], lv.dir, norm(cross([1, 0, 0], lv.dir)), 0.022, 0.035, 0.018, 'dash', 0.1, T.carbon);
  K.obox(add(gripEnd, mul(lv.dir, 0.002)), [1, 0, 0], norm(cross([1, 0, 0], lv.dir)), lv.dir, 0.018, 0.012, 0.003, 'dash', 0.3, T.glow, lit ? 0.4 + R.thr * 0.4 + lvNear * 0.2 : 0);

  // ── THE STICK, on a column ahead of the pilot, and the right armrest ──
  const st = stickAt(P, R), stNear = eased('df76:near:yoke', live && (live.hover === 'yoke' || live.press === 'yoke') ? 1 : 0, 12);
  const arm = st.base, rest = [ARMREST[0], ARMREST[1], zF + ARMREST[2]];
  K.box(rest[0] - 0.05, -0.30, zF + 0.42, rest[0] + 0.05, rest[1] + 0.06, rest[2] - 0.005, 'dash', 0.05, T.carbon);
  K.box(rest[0] - 0.045, -0.28, rest[2] - 0.006, rest[0] + 0.045, rest[1] - 0.04, rest[2] + 0.012, 'dash', 0.1, T.leather);
  stickColumn(K, arm, zF, T.tub, T.metal);
  K.rod(add(arm, [0, 0, -0.01]), add(arm, [0, 0, 0.012]), 0.035, 'dash', 0.1, T.tub, 0, 14);
  K.torus(add(arm, [0, 0, 0.012]), [1, 0, 0], [0, 1, 0], 0.036, 0.004, 18, 'dash', 0.2, al.rgb, lit ? 0.6 + 0.4 * stNear : 0);
  K.rod(add(arm, [0, 0, 0.012]), add(arm, mul(st.dir, 0.04)), 0.022, 'dash', -0.1, T.tub, 0, 10);
  K.rod(add(arm, mul(st.dir, 0.03)), st.top, 0.011, 'dash', 0.2, T.metal, 0, 8);
  const gdir = norm(add(st.dir, [0, 0.12, 0]));
  const gTop = add(st.top, mul(gdir, 0.09));
  K.rod(st.top, gTop, 0.022, 'dash', 0.05, T.carbon, 0, 12);
  K.rod(add(gTop, mul(gdir, -0.005)), add(gTop, mul(gdir, 0.008)), 0.016, 'dash', 0.2, T.carbonLt, 0, 12);
  K.obox(add(gTop, mul(gdir, 0.009)), [1, 0, 0], [0, 1, 0], gdir, 0.007, 0.007, 0.002, 'dash', 0.3, T.glow, lit ? 0.6 + 0.4 * stNear : 0);
  K.obox(add(st.top, add(mul(gdir, 0.05), [0, 0.021, 0])), [1, 0, 0], gdir, [0, 1, 0], 0.006, 0.012, 0.005, 'dash', 0.2, T.carbonLt);

  // ── THE YAW PEDALS: two plates sliding on rails, one forward as the other comes back ──
  const pz = zF + 0.12, py = 0.80;
  for (const [dx, sgn] of [[-0.10, -1], [0.10, 1]]) {
    const slide = clamp(R.rud * sgn, -1, 1) * 0.05;
    K.box(dx - 0.012, py - 0.12, zF, dx + 0.012, py + 0.12, zF + 0.02, 'dash', 0.1, T.metal);
    const c = [dx, py + slide, pz];
    K.obox(c, [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.045, 0.10, 0.008, 'dash', 0.05, T.carbon);
    K.obox(add(c, mul(norm([0, -0.89, -0.45]), -0.009)), [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.038, 0.088, 0.002, 'dash', 0.1, T.tub);
    // The pedal's own light strip, brighter the further it is pressed.
    K.obox(add(c, mul(norm([0, -0.89, -0.45]), -0.012)), [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.004, 0.07, 0.001, 'dash', 0.2, al.rgb, lit ? 0.3 + 0.7 * clamp(R.rud * sgn, 0, 1) : 0);
    K.rod(add(c, [0, 0, -0.06]), [dx, py + slide, zF + 0.02], 0.012, 'dash', 0.2, T.metal, 0, 6);
    contactShadow(K, [dx, py + slide, zF], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.05, 0.11);
  }
  // The passenger's foot rest, an angled carbon plate with a lit edge.
  const px = 2 * xC;
  K.obox([px, 0.72, zF + 0.09], [1, 0, 0], norm([0, -0.6, 0.8]), norm([0, 0.8, 0.6]), 0.14, 0.09, 0.008, 'dash', 0.05, T.carbon);
  K.rod([px - 0.14, 0.66, zF + 0.012], [px + 0.14, 0.66, zF + 0.012], 0.004, 'dash', 0.2, al.rgb, lineK(0.7 * amb), 5);

  // ── OVERHEAD: the light ring round the skylight ──
  // ⚠ NO CONTROL THE SIM DOES NOT HAVE: a parachute handle and a battery isolator were here, and both
  // looked like things you could pull. Every control in this cockpit is a working one.
  {
    const Sk = CAB_GLASS.skylight, D = P.df76;
    const ring = [];
    for (const [f, a] of [[Sk.f[0], Sk.a[0] - 3], [Sk.f[1], Sk.a[0] - 3], [Sk.f[1], Sk.a[1] + 3], [Sk.f[0], Sk.a[1] + 3]]) ring.push(D.toShell(cabPoint(f, a, -(D.inset + 0.012 / D.m))));
    for (let i = 0; i < 4; i++) K.rod(ring[i], ring[(i + 1) % 4], 0.006, 'hdr', 0.2, al.rgb, (R.dome && lit ? 1 : 0.4) * Math.max(amb, 0.2) * (lit ? al.k : 1), 6);
    const dome = [xC, 0.05, P.roof - 0.04];
    K.rod(add(dome, [0, 0, -0.01]), add(dome, [0, 0, 0.03]), 0.05, 'hdr', 0.1, R.dome && lit ? [240, 252, 248] : [80, 84, 84], R.dome && lit ? 1 : 0, 14);
  }

  hotspotHalo(K, df76Hotspots(P, live), live);
}

// ── THE HOLOGRAM: the Dragonfly in miniature, 15 cm across ──
// Her pod as three rings, the four arms, the eight rotors as discs with their two blades turning on
// the rotor phase, each disc ringed in its speed, the tail. The frame is her pitch and bank.
function holoDragonfly(K, c, R) {
  const H = holoFrame(K, c, R.pitch, R.bank);
  const sc = 0.085, on = R.powered && R.rpm > 0.02, frac = clamp(R.rpm / 1.05, 0, 1);
  // The pod: an egg along y, three section rings and a keel line.
  for (const [y, rx, rz] of [[0.45, 0.10, 0.12], [0.15, 0.22, 0.26], [-0.2, 0.20, 0.22], [-0.45, 0.10, 0.12]]) {
    const pts = [];
    for (let i = 0; i <= 14; i++) { const t = i * TAU / 14; pts.push([Math.cos(t) * rx * sc, y * sc, Math.sin(t) * rz * sc]); }
    for (let i = 0; i < 14; i++) H.line(pts[i], pts[i + 1], 0.0007);
  }
  const egg = [[0, 0.62, 0], [0, 0.45, 0.12], [0, 0.15, 0.26], [0, -0.2, 0.22], [0, -0.45, 0.12], [0, -0.6, 0]];
  for (let i = 0; i + 1 < egg.length; i++) for (const s of [1, -1]) H.line(egg[i].map((v, k) => (k === 2 ? v * s : v) * sc), egg[i + 1].map((v, k) => (k === 2 ? v * s : v) * sc), 0.0007);
  // The tail boom and fin.
  H.line([0, -0.6 * sc, 0], [0, -1.15 * sc, 0.05 * sc], 0.0009);
  H.plate([[0, -0.95 * sc, 0.05 * sc], [0, -1.15 * sc, 0.05 * sc], [0, -1.12 * sc, 0.2 * sc]]);
  // Four arms out to eight rotors (a coaxial pair at each tip), each ringed at its speed.
  ROTOR_PLAN.forEach(([f, g], i) => {
    const tip = [g * 1.4 * sc, f * 1.2 * sc, 0.2 * sc];
    H.line([0, 0.05 * sc, 0.25 * sc], tip, 0.0009);
    const rr = 0.38 * sc;
    H.ring(tip, [1, 0, 0], [0, 1, 0], rr, 18, frac > 0.85 ? HOLO_LINE : HOLO_AMBER, on ? 1 : 0.3);
    H.plate(Array.from({ length: 12 }, (_, j) => { const t = j * TAU / 12; return [tip[0] + Math.cos(t) * rr, tip[1] + Math.sin(t) * rr, tip[2]]; }), HOLO, 0.5);
    for (const [dz, dir] of [[0.012, 1], [-0.004, -1]]) {
      const t = (on ? R.phase * 2.2 * dir : 0) + i * 0.7, d = [Math.cos(t) * rr * 0.92, Math.sin(t) * rr * 0.92, 0];
      H.line([tip[0] - d[0], tip[1] - d[1], tip[2] + dz], [tip[0] + d[0], tip[1] + d[1], tip[2] + dz], 0.0011, HOLO_LINE, 1);
    }
  });
}

// ── THE PILOT'S SCREEN: attitude, speed and height tapes, a heading tape, the vertical speed ──
function pfd(Pn, R) {
  // The attitude, big and square in the middle: the kit's own ball, rolled and pitched.
  Pn.attitude(0, 0.004, 0.072, R.pitch, R.bank);
  // The speed tape on the left: ticks every 5 kt scrolling past a box with the reading in it.
  tape(Pn, -0.13, R.ias, 5, 10, 'KT');
  tape(Pn, 0.13, R.alt, 50, 100, 'FT');
  // The heading tape across the top: a tick every 5°, scrolling, the number in a box.
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
  // The vertical speed: a bar from the middle of the right edge, up or down.
  const vs = clamp(R.vsi / 1500, -1, 1);
  Pn.rect(0.158, -0.07, 0.164, 0.07, [20, 30, 32], 0.2, 0.002);
  if (Math.abs(vs) > 0.01) Pn.rect(0.157, Math.min(0, vs * 0.07), 0.165, Math.max(0, vs * 0.07), vs > 0 ? C.green : T.amber, 0.9, 0.003);
  Pn.text('VS', 0.161, -0.085, 0.01, [160, 196, 190], 0.5, 0.003);
  // The stall bar: a red band across the bottom when the margin is gone.
  if (R.stall) Pn.rect(-0.16, -0.103, 0.16, -0.093, T.red, 1, 0.003);
}
// A tape: the value's ticks scroll past a fixed pointer box, the reading in the box.
function tape(Pn, u, v, step, major, unit) {
  const hh = 0.075, w = 0.026, span = step * 6;
  Pn.rect(u - w, -hh, u + w, hh, [10, 18, 20], 0.3, 0.002);
  const v0 = Math.floor((v - span) / step) * step;
  for (let t = v0; t <= v + span; t += step) {
    if (t < 0) continue;
    const b = ((t - v) / span) * hh;
    if (Math.abs(b) > hh - 0.003) continue;
    const big = t % major === 0;
    const side = u < 0 ? 1 : -1;
    Pn.rect(u + side * w - side * (big ? 0.012 : 0.006), b - 0.0007, u + side * w, b + 0.0007, [200, 236, 226], 0.7, 0.003);
  }
  Pn.rect(u - w - 0.003, -0.011, u + w + 0.003, 0.011, T.screen, 0.2, 0.0035);
  const s = String(Math.round(v));
  Pn.digits(u - w + 0.002, -0.007, 0.014, s.length > 5 ? s.slice(-5) : s, T.glow, false);
  Pn.text(unit, u, -hh - 0.012, 0.011, [160, 196, 190], 0.5, 0.003);
}

// ── THE ROTOR PAGE: the aircraft from above, the eight rotors turning, each one's speed as a ring ──
const ROTOR_PLAN = [[0.5, 0.6], [0.5, -0.6], [-0.42, 0.6], [-0.42, -0.6]];
function rotorPage(Pn, R) {
  const sc = 0.07, cy = -0.006;
  const P2 = (f, g) => [g * sc, cy + f * sc];
  // The pod and the tail, in outline.
  for (let i = 0; i < 12; i++) {
    const t0 = (i / 12) * TAU, t1 = ((i + 1) / 12) * TAU;
    const a = P2(0.18 + Math.sin(t0) * 0.45, Math.cos(t0) * 0.22), b = P2(0.18 + Math.sin(t1) * 0.45, Math.cos(t1) * 0.22);
    Pn.plate([[a[0], a[1]], [b[0], b[1]], [b[0] * 0.98, b[1] * 0.98 + cy * 0.02], [a[0] * 0.98, a[1] * 0.98 + cy * 0.02]], [90, 140, 132], 0.6, 0.003);
  }
  Pn.rect(-0.002, cy - 0.9 * sc, 0.002, cy - 0.27 * sc, [90, 140, 132], 0.6, 0.003);
  const on = R.powered && R.rpm > 0.02;
  ROTOR_PLAN.forEach(([f, g], i) => {
    const [cu, cv] = P2(f, g);
    // The arm, from the roof hub out to the rotor.
    const [hu, hv] = P2(0.05, 0), ta = Math.atan2(cv - hv, cu - hu);
    Pn.spoke(hu, hv, ta, 0.006, Math.hypot(cu - hu, cv - hv) - 0.004, 0.0018, [70, 110, 104], 0.5, 0.0028);
    // The speed ring: a sweep round each rotor in proportion to its rpm, teal in the band, amber low.
    const frac = clamp(R.rpm / 1.05, 0, 1), col = frac > 0.85 ? T.glow : T.amber;
    Pn.annulus(cu, cv, 0.019, 0.022, [30, 44, 44], 0.3, 0.003, 20);
    if (frac > 0.01) Pn.annulus(cu, cv, 0.019, 0.022, col, 0.95, 0.0035, Math.max(2, Math.round(20 * frac)), Math.PI / 2, Math.PI / 2 - frac * TAU);
    // Two blades, upper and lower, counter-rotating: they turn on the rotor phase.
    for (const [r0, dir, rgb] of [[0.017, 1, [210, 240, 232]], [0.0125, -1, [130, 170, 164]]]) {
      const t = (on ? R.phase * 2.2 * dir : 0) + i * 0.7 + (dir < 0 ? 0.5 : 0);
      Pn.spoke(cu, cv, t, -r0, r0, 0.0016, rgb, 0.9, dir > 0 ? 0.0045 : 0.004);
    }
    Pn.disc(cu, cv, 0.003, [200, 210, 210], 0.6, 0.005, 8);
  });
  Pn.text('ROTORS', -0.11, 0.088, 0.012, [160, 196, 190], 0.5, 0.003);
  Pn.text(on ? '8/8' : 'OFF', 0.11, 0.088, 0.012, on ? T.glow : [120, 130, 130], 0.7, 0.003);
  Pn.text(String(Math.round(R.rpm * 100)).padStart(3, ' ').trim() + ' PCT', 0, -0.09, 0.012, [200, 236, 226], 0.6, 0.003);
}

// ── THE ENERGY PAGE: state of charge, power drawn, cell temperature ──
function energyPage(Pn, R) {
  // The pack: twelve cells in a row, filled to the charge.
  const n = 12, soc = R.fuel;
  Pn.text('SOC', -0.115, 0.088, 0.012, [160, 196, 190], 0.5, 0.003);
  Pn.digits(-0.01, 0.075, 0.022, String(Math.round(soc * 100)).padStart(3, ' '), soc < 0.15 ? T.red : T.glow, false);
  for (let i = 0; i < n; i++) {
    const u = -0.13 + i * 0.0225, f = clamp(soc * n - i, 0, 1);
    Pn.rect(u, 0.02, u + 0.018, 0.06, [24, 34, 34], 0.3, 0.002);
    if (f > 0.02) Pn.rect(u + 0.002, 0.022, u + 0.016, 0.022 + 0.036 * f, soc < 0.15 ? T.red : soc < 0.3 ? T.amber : T.glow, 0.95, 0.003);
  }
  // Power: the draw in kilowatts, as a bar and a number. Hover in a two-seat octocopter is about
  // 120 kW; full thrust nearer 240.
  const kw = R.powered ? Math.round(lerp(8, 240, clamp(R.thr * R.rpm, 0, 1))) : 0;
  Pn.text('KW', -0.115, -0.005, 0.012, [160, 196, 190], 0.5, 0.003);
  Pn.rect(-0.095, -0.012, 0.11, 0.002, [24, 34, 34], 0.3, 0.002);
  if (kw > 0) Pn.rect(-0.093, -0.010, -0.093 + 0.201 * (kw / 240), 0.000, kw > 200 ? T.amber : T.glow, 0.9, 0.003);
  Pn.digits(0.04, -0.045, 0.02, String(kw).padStart(3, ' '), T.glow, false);
  // Cell temperature, a dial with its green band.
  Pn.dial(-0.08, -0.058, 0.032, R.temp, { a0: Math.PI * 1.15, sweep: Math.PI * 1.3, ticks: 6, major: 3, arcs: [[0.2, 0.7, C.green], [0.7, 0.85, C.amber]], red: 0.85, name: 'CELLS' });
  // Range at this draw: what is left over what is being spent, in minutes.
  const mins = kw > 0 ? Math.min(99, Math.round(soc * 25 * 60 / Math.max(30, kw))) : 0;
  Pn.text('MIN', 0.12, -0.095, 0.011, [160, 196, 190], 0.5, 0.003);
  Pn.digits(0.075, -0.1, 0.016, String(mins).padStart(2, ' '), T.glow, false);
}

// ── THE MAP: the kit's moving map, with a range ring and the course line ──
function mapPage(Pn, R, live) {
  panelGps(Pn, 0, 0, 0.14, 0.098, live, { label: false, bezel: [8, 14, 16] });
  Pn.text('NAV', -0.13, 0.088, 0.012, [160, 196, 190], 0.5, 0.009);
  const g = live && live.gpsTo;
  if (g && Number.isFinite(g.dist)) Pn.digits(0.06, 0.078, 0.014, String(Math.min(999, Math.round(g.dist))).padStart(3, ' '), T.glow, false);
  // The heading, top centre.
  Pn.digits(-0.02, -0.093, 0.012, String(Math.round(((R.hdg % 360) + 360) % 360)).padStart(3, '0'), [200, 236, 226], false);
}
