// THE MAYFLY 2076'S COCKPIT: the inside of the concept pod, as geometry.
//
// The Mayfly 2076 is the ultralight's concept body (mesh_ultralight_2076.json), after the Opener
// BlackFly and the Pivotal Helix: one seat in a carbon tub under a bubble that comes down past your
// elbows, eight electric props on two wings, and an aircraft that would rather fly itself. It is an
// ultralight, so it sits outside Halcyon's Warm Hands Rider altogether: nobody insures it, pilot or
// no pilot, and the panel says so, lit, all the time it has power (NO COVER).
//
// So the room is the 172's opposite. That was a steel panel of round gauges with two yokes coming
// out of it; this is one curved band of glass low across a swept dash, a centre stick ahead of the pilot
// sill, a single thrust lever on the left (one engine as the sim has it: the eight motors share one
// throttle), yaw pedals on rails, and the sky everywhere else. A miniature of the aircraft floats
// over the dash's right end and flies as she does.
//
// Sources read for this file:
//   https://en.wikipedia.org/wiki/Opener_BlackFly
//     single seat, eight motors on tandem wings that tilt the whole aircraft to take off, a joystick
//     and a few buttons, an ultralight under US Part 103.
//   https://www.pivotal.aero (the Helix, the BlackFly's production descendant): a three-axis
//     stick, a thrust control at the other hand, a small glass display, a ballistic parachute.
//
// ── ⚠ THE ROOM IS THE EXTERIOR'S POD ────────────────────────────────────────
//
// client/shared/cabin-mayfly-2076.js states the pod's stations and where its canopy is, and the
// exterior generator builds the shell and the bubble from the same file. The wall here is the pod's
// own section pushed in by a wall's thickness, the canopy is the absence of wall where the layout says
// glass, and the floor stops where it meets the hull. Nothing about the shape of the cabin is typed
// here.
//
// ── ⚠ ONE SCALE: THE CONCEPT'S LENGTH OVER THE MODEL'S ──────────────────────
//
// MAYFLY76_LENGTH_M over the compiled exterior's nose-to-tail length. Anything about a PERSON (the
// seat, the reach, a page's size) is honest metres.
//
// ── ⚠ ANIMATION IS LIVE STATE ───────────────────────────────────────────────
//
// The props turn on `live.phase`, the attitude and tapes on the flight state, the charge on the fuel.
// Decoration (the alert's breathing) may move on wall time; no readout does.
//
// Pure: no camera, no DOM. `live` arrives as an argument.
import { brandTrim } from './interior-brands.js';
import { makeKit, C, clamp, lerp, SHINY, PANE, TEXTURE } from './interior-kit.js';
import { contactShadow, hotspotHalo, panelGps, gpsHotspot, lensLamp, eased, pressPulse, HALO,
  bootAge, reveal, alertLight, sweep, lightLine, bandFrame, glassBand, holoFrame, holoProjector, windscreenHud,
  HOLO, HOLO_LINE, HOLO_AMBER, HOLO_RED, stickColumn } from './interior-cockpit-kit.js';
import { MESH_ROWS } from './vehicle-meshes.js';
import { compileMesh } from './vehicle-mesh.js';
import { MAYFLY76_STATIONS, MAYFLY76_GLASS, MAYFLY76_INSIDE, MAYFLY76_LENGTH_M, mayfly76Section, mayfly76Point } from './cabin-mayfly-2076.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ── THE STYLE ────────────────────────────────────────────────────────────────
// Carbon and the flight school's white, with the 172's blue kept as the light that runs round the
// tub. Grey technical fabric on the seat.
export const MF76_TRIM = {
  lining: [204, 208, 212], liningDk: [168, 174, 180],
  carbon: [32, 35, 40], carbonLt: [50, 55, 62], tub: [24, 27, 31],
  fabric: [92, 100, 112], fabricDk: [62, 68, 78], bolster: [40, 44, 50],
  blue: [36, 86, 170], glow: [127, 214, 255], glowDim: [40, 76, 104],
  floor: [38, 40, 44], floorEdge: [26, 28, 31], metal: [150, 156, 164],
  screen: [6, 10, 16], harness: [44, 70, 120], buckle: [176, 182, 190],
  red: [235, 60, 48], amber: [255, 176, 64],
};
const T = MF76_TRIM;
for (const k of ['lining', 'liningDk']) TEXTURE.set(T[k], 'paint');
for (const k of ['carbon', 'carbonLt', 'tub']) TEXTURE.set(T[k], 'plastic');
for (const k of ['fabric', 'fabricDk', 'bolster', 'harness']) TEXTURE.set(T[k], 'fabric');
for (const k of ['floor', 'floorEdge']) TEXTURE.set(T[k], 'carpet');
for (const k of ['metal', 'buckle']) TEXTURE.set(T[k], 'brushed');
SHINY.set(T.carbon, { spec: 0.45, pow: 30 });
SHINY.set(T.carbonLt, { spec: 0.4, pow: 26 });
SHINY.set(T.lining, { spec: 0.2, pow: 16 });
SHINY.set(T.metal, { spec: 0.7, pow: 36 });
SHINY.set(T.buckle, { spec: 0.8, pow: 40 });
SHINY.set(T.screen, { spec: 0.6, pow: 60 });
brandTrim(T, 'mayfly', TEXTURE, SHINY);

// ── THE EXTERIOR, MEASURED ──────────────────────────────────────────────────
function modelLength(doc) {
  let fMax = -Infinity, fMin = Infinity;
  for (const f of compileMesh(doc, { detail: 1 }).faces) {
    if (f.role === 'rotor') continue;
    for (const q of f.p) { if (q[0] > fMax) fMax = q[0]; if (q[0] < fMin) fMin = q[0]; }
  }
  return fMax - fMin;
}

// The pilot's eye: on the centreline over the one seat, a seated eye height over the floor, a hand
// ahead of the seat back.
const EYE = { f: 0.3, g: MAYFLY76_INSIDE.seatG, overFloorM: 0.95 };
const WALL_M = 0.03;                  // carbon tub plus the lining

// ── THE PROFILE ──────────────────────────────────────────────────────────────
export function mayfly2076Profile(doc = MESH_ROWS.ultralight_2076) {
  if (!doc) return null;
  const m = MAYFLY76_LENGTH_M / modelLength(doc);
  const fE = EYE.f, gE = EYE.g, hE = MAYFLY76_INSIDE.floorH + EYE.overFloorM / m;
  const X = (g) => (g - gE) * m, Y = (f) => (f - fE) * m, Z = (h) => (h - hE) * m;
  const toShell = (q) => [X(q[1]), Y(q[0]), Z(q[2])];
  const inset = WALL_M / m;
  const fB = MAYFLY76_INSIDE.bulkheadF, zF = Z(MAYFLY76_INSIDE.floorH);
  const G = { m, X, Y, Z, toShell, inset, fB, zF, fC: MAYFLY76_GLASS.canopy.f[0] };
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
  const seatZ = zF + 0.28;
  const sillZ = Z(mayfly76Point(fE, MAYFLY76_GLASS.canopy.a[0])[2]);
  const P = {
    label: 'Mayfly 2076 pod',
    xCentre, halfW,
    floor: z0 - 1e-6, roof: z1 + 1e-6, front: y1 + 1e-6, back: y0 - 1e-6,
    mPerUnit: m, glassAftY: Y(G.fC),
    sillZ,
    // The side rays go out through the bubble beside the pilot; it comes down past the elbows, so
    // the window line is the sill's and the tub is below it.
    winY: [Y(0.26), Y(0.4)], winZ: [sillZ + 0.15, sillZ + 0.4],
    dashY: DASH.yMid - DASH.sag, dashZ: DASH.z0, headerZ: z1, pillarW: 0.02,
    seatZ, seatHalf: 0.23, seatY: [-0.24, 0.2], backZ: 0.02,
    roofGlass: true,          // straight up from the pilot is the bubble and the sky
    seats: 1, centrePost: 0,
    normalLit: true,
    floods: [{ p: [0, 0.6, -0.36], r: 0.45 }, { p: [0, -0.2, 0.2], r: 0.6 }],
    floodGain: 1.6, glare: 0.25,
    room: mf76Shell,
    glass,
    mf76: { ...G, faces: room.faces },
    hotspots(live) { return mf76Hotspots(this, live); },
  };
  return P;
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
// Built once per profile: the tub below the canopy's sills, the bulkhead behind the seat, the floor,
// the reveals round the bubble's edge and the light that runs along it. Nothing here moves.
function buildRoom(G) {
  const { toShell, inset, fB, zF, m } = G;
  const faces = [];
  const put = (p, n, tone, k, rgb, emis) => faces.push({ p, n, tone, k, rgb, emis: emis || 0 });
  const K = makeKit((fs, tone, k, fwd, rgb, emis) => { for (const f of fs) put(f.p, f.n, tone, k, rgb, emis); }, false);
  const S = (f, aDeg, inM = 0) => toShell(mayfly76Point(f, aDeg, -(inset + inM / m)));
  const inward = (f, a) => {
    const d = 1e-4;
    let n = norm(cross(sub(S(f + d, a), S(f - d, a)), sub(S(f, a + d * 50), S(f, a - d * 50))));
    const c = toShell([f, 0, mayfly76Section(f).cz]);
    if (dot(n, sub(c, S(f, a))) < 0) n = mul(n, -1);
    return n;
  };
  const aboveFloor = (poly) => clipHalf(poly, (q) => q[2] - zF);

  // ── THE TUB: carbon below the sills, lining on the arch behind the head, walked in the pod's own
  // (f, angle) from the bulkhead to the nose with the canopy cut out of it exactly.
  const fN = MAYFLY76_STATIONS[1].f;
  const FS = [fB, 0.13, 0.17, 0.22, 0.27, 0.32, 0.37, 0.42, 0.47, 0.52, 0.57, 0.62, 0.67, 0.71, 0.75, fN];
  const NA = 72;
  const Cg = MAYFLY76_GLASS.canopy;
  const hole = [[Cg.f[0], Cg.a[0]], [Cg.f[1] + 0.01, Cg.a[0]], [Cg.f[1] + 0.01, Cg.a[1]], [Cg.f[0], Cg.a[1]]];
  for (let i = 0; i < FS.length - 1; i++) {
    for (let j = 0; j < NA; j++) {
      const f0 = FS[i], f1 = FS[i + 1], a0 = -90 + (j / NA) * 360, a1 = -90 + ((j + 1) / NA) * 360;
      let cells = [[[f0, a0], [f1, a0], [f1, a1], [f0, a1]]];
      cells = cells.flatMap((c) => (bbOverlap(c, hole) ? subtractConvex(c, hole) : [c]));
      const fm = (f0 + f1) / 2, am = (a0 + a1) / 2, sn = Math.sin(am * DEG);
      const n = inward(fm, am);
      for (const c of cells) {
        const poly = aboveFloor(c.map(([f, a]) => S(f, a)));
        if (poly.length < 3) continue;
        if (sn > 0.2) put(poly, n, 'hdr', -0.2, T.lining);
        else if (sn < -0.35) put(poly, n, 'pil', -0.18, T.tub);
        else put(poly, n, 'pil', -0.1, (i + j) % 9 === 0 ? T.carbonLt : T.carbon);
      }
    }
  }

  // ── THE REVEALS: a carbon return round the bubble's edge, from the lining out to the skin, and a
  // lit seal along its inner edge.
  const reveal = (pts, cF, cA) => {
    for (let t = 1; t < pts.length; t++) {
      const [fa, aa] = pts[t - 1], [fb, ab] = pts[t];
      const i0 = S(fa, aa), i1 = S(fb, ab), o0 = toShell(mayfly76Point(fa, aa, -0.004 / m)), o1 = toShell(mayfly76Point(fb, ab, -0.004 / m));
      const fm = (fa + fb) / 2, am = (aa + ab) / 2;
      const toC = sub(S(cF, cA), S(fm, am));
      const out = norm(sub(toShell(mayfly76Point(fm, am, 0)), S(fm, am)));
      const rn = norm(sub(toC, mul(out, dot(toC, out))));
      if (i0[2] > zF && i1[2] > zF) put([i0, i1, o1, o0], rn, 'pil', 0.05, T.carbon);
      if (i0[2] > zF + 0.01 && i1[2] > zF + 0.01) K.rod(S(fa, aa, 0.006), S(fb, ab, 0.006), 0.0035, 'pil', 0.1, T.glowDim, 0.35, 5, false);
    }
  };
  const edge = (f0, a0, f1, a1, n) => Array.from({ length: n + 1 }, (_, i) => [lerp(f0, f1, i / n), lerp(a0, a1, i / n)]);
  reveal(edge(Cg.f[0], Cg.a[0], Cg.f[0], Cg.a[1], 30), Cg.f[0] + 0.05, 90);   // the aft arch, over the head
  reveal(edge(Cg.f[0], Cg.a[0], 0.72, Cg.a[0], 14), 0.4, 60);                // the right sill
  reveal(edge(Cg.f[0], Cg.a[1], 0.72, Cg.a[1], 14), 0.4, 120);               // the left sill

  // ── THE SILLS: a padded rail along each, and the canopy latch by the right elbow ──
  for (const s of [1, -1]) {
    const A = (a) => (s > 0 ? a : 180 - a);
    const r0 = S(0.14, A(Cg.a[0] - 4), 0.012), r1 = S(0.5, A(Cg.a[0] - 4), 0.012);
    K.rod(r0, r1, 0.018, 'pil', 0.05, T.bolster, 0, 8);
    K.rod(add(r0, [0, 0, 0.016]), add(r1, [0, 0, 0.016]), 0.003, 'pil', 0.2, T.glowDim, 0.5, 4);
  }
  {
    // The latch handle: a fixture, not a control. The sim has no canopy to open.
    const l0 = S(0.24, Cg.a[0] - 7, 0.03), l1 = S(0.3, Cg.a[0] - 7, 0.03);
    K.rod(l0, l1, 0.009, 'pil', 0.3, T.metal, 0, 8);
    K.rod(S(0.235, Cg.a[0] - 7, 0.004), l0, 0.006, 'pil', 0.3, T.metal, 0, 6);
  }

  // ── THE BULKHEAD behind the seat: carbon, a padded panel and the parachute's housing ──
  const NS = 72, bpts = [];
  for (let k = 0; k <= NS; k++) bpts.push(S(fB, -90 + (k / NS) * 360));
  const bulk = aboveFloor(bpts);
  if (bulk.length >= 3) put(bulk, [0, 1, 0], 'post', -0.12, T.carbon);
  const yB = G.Y(fB);
  K.box(-0.2, yB, zF + 0.3, 0.2, yB + 0.03, zF + 0.95, 'post', -0.05, T.fabricDk);
  for (let r = 1; r < 6; r++) K.box(-0.2, yB + 0.03, zF + 0.3 + r * 0.108, 0.2, yB + 0.034, zF + 0.304 + r * 0.108, 'post', -0.2, T.bolster);

  // ── THE FLOOR: dark mats from the bulkhead to where the floor meets the hull, edged in light ──
  const floorHalf = (f) => {
    let prev = null;
    for (let a = -90; a <= 0; a += 1) {
      const q = mayfly76Point(f, a, -inset);
      if (prev && prev[2] < MAYFLY76_INSIDE.floorH && q[2] >= MAYFLY76_INSIDE.floorH) {
        const t = (MAYFLY76_INSIDE.floorH - prev[2]) / (q[2] - prev[2]);
        return (prev[1] + (q[1] - prev[1]) * t) * m;
      }
      prev = q;
    }
    return 0;
  };
  const FF = [];
  for (let f = fB; f < 0.66; f += 0.02) FF.push(f);
  for (let i = 0; i < FF.length - 1; i++) {
    const f0 = FF[i], f1 = FF[i + 1], w0 = floorHalf(f0), w1 = floorHalf(f1);
    if (w0 <= 0.01 || w1 <= 0.01) continue;
    put([[-w0, G.Y(f0), zF], [w0, G.Y(f0), zF], [w1, G.Y(f1), zF], [-w1, G.Y(f1), zF]], [0, 0, 1], 'floor', -0.2, i % 6 === 5 ? T.floorEdge : T.floor);
    if (w0 > 0.08 && w1 > 0.08) for (const s of [-1, 1]) K.box(s * (w0 - 0.04) - 0.005, G.Y(f0), zF + 0.001, s * (w0 - 0.04) + 0.005, G.Y(f1), zF + 0.004, 'floor', 0.2, T.glow, 0.85);
  }
  return { faces };
}

// ── THE GLASS ────────────────────────────────────────────────────────────────
// The bubble as film over the room, faceted in (f, angle) small enough to be flat, 5 mm inside the
// skin and outboard of every reveal.
function buildGlass(G) {
  const { toShell, m } = G;
  const d = 0.005 / m;
  const panes = [];
  const Cg = MAYFLY76_GLASS.canopy;
  for (let i = 0; i < 10; i++) for (let j = 0; j < 28; j++) {
    const fa = lerp(Cg.f[0], Cg.f[1], i / 10), fb = lerp(Cg.f[0], Cg.f[1], (i + 1) / 10);
    const aa = lerp(Cg.a[0], Cg.a[1], j / 28), ab = lerp(Cg.a[0], Cg.a[1], (j + 1) / 28);
    panes.push([[fa, aa], [fb, aa], [fb, ab], [fa, ab]].map(([f, a]) => toShell(mayfly76Point(f, a, -d))));
  }
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
function mf76Shell(P, live, push, rich) {
  const D = P.mf76;
  for (const f of D.faces) push(f.one || (f.one = Object.assign([{ p: f.p, n: f.n }], { stable: true })), f.tone, f.k, false, f.rgb, f.emis || 0);
  seat(P, push);
  if (rich) mf76Fit(P, live, push);
}

// ── THE READINGS ─────────────────────────────────────────────────────────────
const readings = (live) => {
  const L = live || {};
  return {
    L,
    pitch: num(L.pitch), bank: num(L.bank), hdg: num(L.hdg),
    ias: Math.max(0, num(L.ias)), alt: Math.max(0, num(L.alt)), vsi: num(L.vsi),
    rpm: clamp(num(L.rpm), 0, 1.1), thr: clamp(num(L.throttle), 0, 1),
    fuel: clamp(num(L.fuel, 1), 0, 1), hull: clamp(num(L.hull, 1), 0, 1),
    temp: clamp(num(L.oilTemp, 0.4), 0, 1),
    powered: L.powered !== false,
    ail: clamp(num(L.stickX), -1, 1), elev: clamp(num(L.stickY), -1, 1), rud: clamp(num(L.rudder), -1, 1),
    trim: clamp(num(L.trim), -1, 1), flap: clamp(Math.round(num(L.flapNotch)), 0, 3),
    land: !!L.landingLight, dome: !!L.dome, hour: num(L.hour, 12),
    phase: num(L.phase), stall: !!L.stall,
  };
};
const night = (R) => R.hour < 6.5 || R.hour > 19.5;
const panelOn = (R) => R.powered && (R.L.panelLight != null ? !!R.L.panelLight : night(R));

// ── WHERE THE CONTROLS ARE ───────────────────────────────────────────────────
// One place says where each thing you can grab is; the drawing and the hotspots both read it. The
// centre stick on its column, the thrust lever on the left; z is off the floor.
const STICK = { base: [0, 0.36, 0.4], len: 0.13 };
const LEVER = { x: -0.25, pivotY: 0.04, top: 0.48, len: 0.15 };
const CONSOLE = { x: 0.25, hw: 0.065, y0: -0.2, y1: 0.36, top: 0.47 };
function stickAt(P, R) {
  const base = [STICK.base[0], STICK.base[1], P.mf76.zF + STICK.base[2]];
  const dir = norm([R.ail * 0.32, -R.elev * 0.32, 1]);
  return { base, top: add(base, mul(dir, STICK.len)), dir };
}
function leverAt(P, R) {
  const pivot = [LEVER.x, LEVER.pivotY, P.mf76.zF + LEVER.top];
  const ang = -0.55 + R.thr * 1.1;                                   // back at idle, forward at full
  const dir = [0, Math.sin(ang), Math.cos(ang)];
  return { pivot, end: add(pivot, mul(dir, LEVER.len)), dir, ang };
}

// ── THE DASH: a low swept wing across the bubble, and on its face one band of glass ──
// A shallow arc round the pilot; `curve(s)` gives the band's lower edge and the outward direction
// across the dash. The dash is swept along the same curve, so the glass is the dash's own face.
const DASH = { xL: -0.36, xR: 0.36, yMid: 0.72, sag: 0.13, w: 0.38, z0: -0.47, h: 0.27, lean: 0.4 };
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
// Every key the sim has a circuit for is a glass key along the band's lower row, with the flap gate
// and the trim strip beside them, so a forward look shows each and its state. The stick, the
// thrust lever and the pedals sit low, so each is mirrored in the windscreen HUD (`windscreenHud`).
const BTN = { ids: ['master', 'land', 'panel', 'dome', 'flaps'], names: { master: 'PWR', land: 'LAND', panel: 'PANEL', dome: 'CABIN', flaps: 'FLAP' } };
const KEY_V = 0.082, KEY_X = [-0.3, -0.23, -0.16, -0.09, -0.02];
const TRIM = { x: 0.17, hw: 0.11, v: KEY_V };
function switchOn(id, R) {
  if (id === 'master') return R.powered;
  if (id === 'land') return R.land;
  if (id === 'panel') return panelOn(R);
  if (id === 'dome') return R.dome && R.powered;
  if (id === 'flaps') return R.flap > 0;
  return R.powered;
}

// ── THE PAGES on the band, and the status lamps along its foot ──
const SCREENS = [
  { id: 'motors', x: -0.27, w: 0.08, boot: 0.45 },
  { id: 'pfd', x: -0.085, w: 0.098, boot: 0 },
  { id: 'map', x: 0.1, w: 0.08, boot: 0.15 },        // the one screen you click (destinations)
  { id: 'energy', x: 0.272, w: 0.074, boot: 0.3 },
];
const SCREEN_H = 0.068, PAGE_V = 0.19;
const screenPanel = (K, sc) => bandPanel(K, sc.x, PAGE_V, 0.013);
const LAMP_V = 0.028, LAMP_X = [-0.295, -0.177, -0.059, 0.059, 0.177, 0.295], LAMP_W = 0.108;

export function mf76Hotspots(P, live) {
  const R = readings(live), K = makeKit(() => {}), out = [];
  BTN.ids.forEach((id, i) => out.push({ id: 'ck:' + id, p: bandPanel(K, KEY_X[i], KEY_V).pt(0, 0, 0.01), r: 0.026, kind: 'click' }));
  out.push({ id: 'trim', p: bandPanel(K, TRIM.x + R.trim * TRIM.hw * 0.85, TRIM.v).pt(0, 0, 0.01), r: 0.04, kind: 'trim' });
  out.push({ id: 'yoke', p: add(stickAt(P, R).top, [0, 0, 0.04]), r: 0.06, kind: 'yoke' });
  const lv = leverAt(P, R);
  out.push({ id: 'throttle', p: add(lv.end, mul(lv.dir, 0.03)), r: 0.045, kind: 'throttle' });
  out.push(gpsHotspot(screenPanel(K, SCREENS.find((sc) => sc.id === 'map')), 0, 0, 0.05));
  return out;
}

// ── THE SEAT: a sculpted carbon shell with fabric inserts and a five-point harness ──
function seat(P, push) {
  const K = makeKit(push, false);
  const h = P.seatHalf, [y0, y1] = P.seatY, sz = P.seatZ, zF = P.mf76.zF, cx = 0;
  K.box(cx - 0.11, y0 + 0.08, zF, cx + 0.11, y1 - 0.12, sz - 0.1, 'seat', -0.25, T.carbon);
  K.box(cx - h, y0, sz - 0.1, cx + h, y1, sz - 0.05, 'seat', 0.0, T.carbon);
  K.box(cx - h + 0.05, y0 + 0.02, sz - 0.05, cx + h - 0.05, y1 - 0.02, sz, 'seat', 0.08, T.fabric);
  for (const s of [-1, 1]) {
    K.box(cx + s * h - s * 0.05, y0, sz - 0.05, cx + s * h, y1, sz + 0.07, 'seat', 0.05, T.bolster);
    K.box(cx + s * (h - 0.025) - 0.003, y0 + 0.02, sz + 0.07, cx + s * (h - 0.025) + 0.003, y1 - 0.02, sz + 0.074, 'seat', 0.2, T.glow, 0.6);
  }
  // Quilting: rows of dark stitch lines across the cushion insert.
  for (let i = 1; i < 6; i++) {
    const y = lerp(y0 + 0.02, y1 - 0.02, i / 6);
    K.box(cx - h + 0.06, y - 0.002, sz + 0.0005, cx + h - 0.06, y + 0.002, sz + 0.002, 'seat', -0.3, T.fabricDk);
  }
  // The back, leaning, a carbon shell with a fabric insert and an integrated headrest.
  const lean = 0.22, bb = [cx, y0 - 0.01, sz], up = [0, -Math.sin(lean), Math.cos(lean)], fw = [0, Math.cos(lean), Math.sin(lean)];
  const bH = 0.56;
  const bc = add(bb, mul(up, bH / 2));
  K.obox(add(bc, mul(fw, -0.05)), [1, 0, 0], up, fw, h, bH / 2, 0.035, 'seat', -0.06, T.carbon);
  K.obox(add(bc, mul(fw, -0.012)), [1, 0, 0], up, fw, h - 0.06, bH / 2 - 0.04, 0.01, 'seat', 0.0, T.fabric);
  for (const s of [-1, 1]) K.obox(add(add(bc, mul(fw, -0.005)), [s * (h - 0.03), 0, 0]), [1, 0, 0], up, fw, 0.03, bH / 2, 0.035, 'seat', 0.0, T.bolster);
  const hc = add(bb, mul(up, bH + 0.09));
  K.obox(add(hc, mul(fw, -0.035)), [1, 0, 0], up, fw, 0.12, 0.085, 0.045, 'seat', 0.0, T.carbon);
  K.obox(add(hc, mul(fw, 0.011)), [1, 0, 0], up, fw, 0.09, 0.06, 0.007, 'seat', 0.0, T.fabric);
  K.obox(add(bb, mul(up, bH - 0.01)), [1, 0, 0], up, fw, 0.085, 0.02, 0.04, 'seat', -0.3, T.tub);
  K.obox(add(add(bb, mul(up, bH * 0.55)), mul(fw, -0.002)), [1, 0, 0], up, fw, h - 0.07, 0.004, 0.011, 'seat', 0.2, T.blue, 0.4);
  // Five-point harness in the 172's blue.
  const top = add(bb, mul(up, bH - 0.01)), buck = [cx, y1 - 0.15, sz + 0.13];
  for (const s of [-1, 1]) {
    K.rod(add(add(top, mul(fw, 0.03)), [s * 0.055, 0, 0]), add(buck, [s * 0.025, 0, 0.03]), 0.011, 'seat', 0.05, T.harness, 0, 4);
    K.rod([cx + s * (h - 0.04), y0 + 0.08, sz + 0.03], add(buck, [s * 0.025, 0, -0.01]), 0.011, 'seat', 0.05, T.harness, 0, 4);
  }
  K.rod([cx, y1 - 0.04, sz + 0.005], add(buck, [0, 0, -0.02]), 0.01, 'seat', 0.05, T.harness, 0, 4);
  K.rod(add(buck, [0, -0.008, 0]), add(buck, [0, 0.01, 0]), 0.032, 'seat', 0.3, T.buckle, 0, 12);
  K.rod(add(buck, [0, 0.01, 0]), add(buck, [0, 0.013, 0]), 0.011, 'seat', 0.3, T.glow, 0.4, 8);
}

// ── THE FIT-OUT ──────────────────────────────────────────────────────────────
export function mf76Fit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live);
  const zF = P.mf76.zF;
  const lit = R.powered, panel = panelOn(R);
  const amb = lit ? (night(R) ? 1 : 0.55) * (R.dome ? 1.2 : 1) : 0.05;
  const boot = bootAge(live);
  // The tub's light lines carry the alert: blue-teal, amber on low charge, red and breathing on a
  // hull or stall warning.
  const warn = lit && (R.hull < 0.3 || R.stall), caution = lit && R.fuel < 0.15;
  const al = alertLight(caution, warn, T.line), lineK = (k) => (lit ? k * al.k : 0.05);

  // ── THE DASH: a wing swept along the band's curve, thinning toward the sills ──
  const curve = dashCurve();
  const gt = [DASH.h * DASH.lean / Math.hypot(1, DASH.lean), DASH.h / Math.hypot(1, DASH.lean)];
  const SEC = [[0, 0], gt, [0.15, 0.255], [0.22, 0.24], [0.24, 0.19], [0.18, -0.03], [0.06, -0.11], [-0.05, -0.08], [-0.06, -0.035], [0, 0]];
  const N = 30, rings = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N, c = curve(s), e = Math.abs(2 * s - 1) ** 3, tap = 1 - 0.8 * e;
    rings.push(SEC.map(([f, z]) => {
      const ff = f > gt[0] ? gt[0] + (f - gt[0]) * tap : f < 0 ? f * tap : f;
      return [c.p[0] + c.f[0] * ff, c.p[1] + c.f[1] * ff, c.p[2] + (z > gt[1] ? gt[1] + (z - gt[1]) * tap : z) - (z > 0.05 ? 0.04 * e : 0)];
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
  // The column the dash stands on, down between the pedals.
  {
    const c = curve(0.5), top = add(add(c.p, mul(c.f, 0.1)), [0, 0, -0.1]);
    K.rod(top, [0, top[1] + 0.02, zF + 0.03], 0.024, 'dash', 0.1, T.carbon, 0, 10);
  }

  // ── THE BAND: one sheet of glass, the pages on it, booting in turn when the power comes on ──
  glassBand(K, curve, { h: DASH.h, lean: DASH.lean, segs: 30, lit, light: al.rgb, lightK: lineK(1), substrate: T.screen });
  for (const sc of SCREENS) {
    const Pn = screenPanel(K, sc), up = reveal(boot, sc.boot);
    if (!lit || up <= 0) continue;
    if (up < 1) {
      const y = lerp(-SCREEN_H, SCREEN_H, up);
      Pn.rect(-sc.w, -SCREEN_H, sc.w, y, T.screen, 0.3 * up, 0.001);
      Pn.rect(-sc.w, y - 0.002, sc.w, y + 0.002, T.glow, 1, 0.0025);
      continue;
    }
    Pn.rect(-sc.w + 0.004, SCREEN_H - 0.0035, sc.w - 0.004, SCREEN_H - 0.0015, T.glow, 0.85, 0.0018);
    if (sc.id === 'pfd') pfd(Pn, R);
    else if (sc.id === 'motors') motorPage(Pn, R);
    else if (sc.id === 'energy') energyPage(Pn, R);
    else if (sc.id === 'map') mapPage(Pn, R, live);
  }
  // The status lamps along the foot of the band: what the aircraft thinks of you, and of itself.
  {
    const handsOn = lit && (Math.abs(R.ail) > 0.03 || Math.abs(R.elev) > 0.03 || Math.abs(R.rud) > 0.03);
    // ⚠ NO COVER IS ALWAYS LIT WITH POWER: an ultralight is outside the Warm Hands Rider, so there
    // is no flight it is insured for. It is the lamp a 2076 buyer asks about first.
    const lamps = [
      ['PILOT PRESENT', lit, C.green], ['HANDS ON', handsOn, T.glow], ['AUTONOMY ADVISORY', lit, T.amber],
      ['NO COVER', lit, T.amber], ['LOW SOC', caution, T.red], ['HULL', lit && R.hull < 0.3, T.red],
    ];
    lamps.forEach(([name, on, rgb], i) => lensLamp(bandPanel(K, LAMP_X[i], LAMP_V, 0.01), 0, 0, LAMP_W, 0.026, on && reveal(boot, 0.6) >= 1, rgb, name));
  }

  // ── THE KEYS: glass keys along the band's lower row ──
  // A key sinks while pressed and comes back, its light eases with its circuit, it brightens as the
  // hand comes over it, and a ring flashes round it when its state changes. The flap key steps the
  // flaps through their notches, and its four pips show which.
  BTN.ids.forEach((id, i) => {
    const Kp = bandPanel(K, KEY_X[i], KEY_V, 0.004), on = switchOn(id, R);
    const pressed = !!live && live.press === 'ck:' + id, near = !!live && live.hover === 'ck:' + id;
    const rgb = id === 'master' ? C.green : T.glow;
    const glow = eased('mf76:glow:' + id, on ? 1 : 0, 10), depth = eased('mf76:dip:' + id, pressed ? 0.002 : 0.007, 30);
    const hand = eased('mf76:near:' + id, near ? 1 : 0, 14);
    Kp.rect(-0.031, -0.03, 0.031, 0.03, T.tub, 0, 0.0005);
    Kp.annulus(0, 0, 0.029, 0.031, T.glow, (lit ? 0.25 : 0) + hand * 0.75, 0.0012, 20);
    Kp.stud(0, 0, 0.026, 0.026, depth, rgb.map((c, k) => lerp([40, 46, 52][k], c, glow * 0.8)), glow * 0.85 + hand * 0.15, 0.0015);
    Kp.fitText(BTN.names[id], 0, -0.004, 0.044, 0.012, glow > 0.5 ? [10, 22, 30] : [214, 222, 228], glow > 0.5 ? 0 : (panel ? 0.6 : 0.25), depth + 0.0025);
    if (id === 'flaps') {
      for (let n = 0; n < 4; n++) Kp.rect(0.036, -0.024 + n * 0.0145, 0.044, -0.014 + n * 0.0145, n <= R.flap && lit ? (n === R.flap ? T.glow : T.glowDim) : [30, 36, 42], n <= R.flap && lit ? (n === R.flap ? 1 : 0.5) : 0, 0.002);
    }
    const flash = pressPulse('mf76:key:' + (id === 'flaps' ? 'flaps' + R.flap : id), id === 'flaps' ? true : on);
    const fl = id === 'flaps' ? pressPulse('mf76:flapnotch', R.flap) : flash;
    if (fl > 0.02) Kp.annulus(0, 0, 0.034, 0.038, HALO, fl, 0.004, 18);
  });

  // ── THE TRIM STRIP: a glass slider beside the keys; its thumb is the elevator trim ──
  {
    const Tp = bandPanel(K, TRIM.x, TRIM.v, 0.004);
    const near = eased('mf76:near:trim', live && (live.hover === 'trim' || live.press === 'trim') ? 1 : 0, 14);
    Tp.rect(-TRIM.hw, -0.016, TRIM.hw, 0.016, T.tub, 0, 0.0005);
    Tp.rect(-TRIM.hw * 0.85, -0.0012, TRIM.hw * 0.85, 0.0012, T.glowDim, lit ? 0.6 : 0.1, 0.0015);
    for (let k = -2; k <= 2; k++) Tp.rect(k * TRIM.hw * 0.425 - 0.0008, -0.008, k * TRIM.hw * 0.425 + 0.0008, k === 0 ? 0.01 : 0.006, T.glowDim, lit ? 0.6 : 0.1, 0.0016);
    const u = R.trim * TRIM.hw * 0.85;
    Tp.stud(u, 0, 0.009, 0.013, 0.006, lit ? T.glow : [60, 66, 72], lit ? 0.7 + near * 0.3 : 0, 0.0015);
    Tp.fitText('TRIM', 0, -0.026, 0.06, 0.011, [180, 200, 214], panel ? 0.5 : 0.25, 0.002);
  }

  // ── THE WINDSCREEN HUD: projected into the bubble, with the hands and feet mirrored ──
  if (lit) windscreenHud(K, R, { dist: 0.6, z: 0.01, hw: 0.19, hh: 0.09, warn, caution, boot: reveal(boot, 0.2),
    mirrors: { stick: [R.ail, R.elev], thrs: [R.thr], rud: R.rud } });

  // ── THE HOLOGRAM over the dash's right end: the Mayfly herself, flying as she flies ──
  // Pitched and banked with her, her eight props turning on the prop phase and ringed at their speed,
  // standing on a projector whose arc is the charge left.
  {
    const c0 = curve(sOf(0.2)), base = add(add(c0.p, mul(c0.f, 0.12)), [0, 0, 0.215]);
    holoProjector(K, base, 0.06, 0.055, lit ? R.fuel : 0, R.fuel < 0.15 ? HOLO_RED : R.fuel < 0.3 ? HOLO_AMBER : HOLO_LINE);
    if (lit && reveal(boot, 0.7) > 0) holoMayfly(K, add(base, [0, 0, 0.085]), R);
  }

  // ── THE SILL CONSOLES: swept carbon along each side, the stick on the right, the lever on the left ──
  for (const sx of [1, -1]) {
    const cx = CONSOLE.x * sx, cy0 = CONSOLE.y0, cy1 = CONSOLE.y1, ct = zF + CONSOLE.top;
    const crings = [];
    for (let i = 0; i <= 8; i++) {
      const y = lerp(cy0, cy1, i / 8), hw = CONSOLE.hw * (0.8 + 0.2 * Math.sin(Math.PI * i / 8));
      const sec = [];
      for (let j = 0; j <= 10; j++) {
        const a = Math.PI * j / 10, x = cx - Math.cos(a) * hw;
        const z = j === 0 || j === 10 ? zF + 0.12 : ct - (1 - Math.sin(a)) * 0.04 - (i === 0 || i === 8 ? 0.03 : 0);
        sec.push([x, y, z]);
      }
      crings.push(sec);
    }
    sweep(K, crings, 'dash', 0.1, T.carbon);
    K.face(crings[8].slice(), [0, 1, 0], 'dash', 0.05, T.carbonLt);
    K.face(crings[0].slice().reverse(), [0, -1, 0], 'dash', 0.05, T.carbonLt);
    lightLine(K, crings.map((r) => add(r[sx > 0 ? 1 : 9], [0, 0, 0.004])), 0.0025, al.rgb, lineK(0.85));
    // A padded elbow rest on each, aft of the control.
    K.box(cx - 0.05, cy0 + 0.02, ct + 0.001, cx + 0.05, cy0 + 0.2, ct + 0.012, 'dash', 0.05, T.fabricDk);
  }

  // ── THE THRUST LEVER: one carbon blade in a lit gate, forward for power ──
  // ⚠ ONE LEVER FOR EIGHT MOTORS: the sim gives the Mayfly one engine, so the lever is the set.
  const lv = leverAt(P, R), lvNear = eased('mf76:near:throttle', live && (live.hover === 'throttle' || live.press === 'throttle') ? 1 : 0, 12);
  const ctop = zF + CONSOLE.top;
  K.box(lv.pivot[0] - 0.012, LEVER.pivotY - 0.13, ctop - 0.004, lv.pivot[0] + 0.012, LEVER.pivotY + 0.13, ctop + 0.007, 'dash', -0.3, T.tub);
  for (let i = 0; i <= 4; i++) {
    const y = LEVER.pivotY - 0.11 + i * 0.055, here = lit && Math.abs(i / 4 - R.thr) < 0.13;
    K.box(lv.pivot[0] + 0.016, y - 0.002, ctop + 0.004, lv.pivot[0] + 0.03, y + 0.002, ctop + 0.008, 'dash', 0.2, here ? T.glow : T.glowDim, here ? 1 : 0.5);
  }
  K.rod(lv.pivot, lv.end, 0.01, 'dash', 0.2, T.metal, 0, 8);
  const gripEnd = add(lv.end, mul(lv.dir, 0.055));
  K.obox(mul(add(lv.end, gripEnd), 0.5), [1, 0, 0], lv.dir, norm(cross([1, 0, 0], lv.dir)), 0.02, 0.032, 0.017, 'dash', 0.1, T.carbon);
  K.obox(add(gripEnd, mul(lv.dir, 0.002)), [1, 0, 0], norm(cross([1, 0, 0], lv.dir)), lv.dir, 0.016, 0.011, 0.003, 'dash', 0.3, T.glow, lit ? 0.4 + R.thr * 0.4 + lvNear * 0.2 : 0);

  // ── THE STICK, on a column ahead of the pilot ──
  const st = stickAt(P, R), stNear = eased('mf76:near:yoke', live && (live.hover === 'yoke' || live.press === 'yoke') ? 1 : 0, 12);
  const arm = st.base;
  stickColumn(K, arm, zF, T.tub, T.metal);
  K.rod(add(arm, [0, 0, -0.01]), add(arm, [0, 0, 0.012]), 0.032, 'dash', 0.1, T.tub, 0, 14);
  K.torus(add(arm, [0, 0, 0.012]), [1, 0, 0], [0, 1, 0], 0.033, 0.004, 18, 'dash', 0.2, al.rgb, lit ? 0.6 + 0.4 * stNear : 0);
  K.rod(add(arm, [0, 0, 0.012]), add(arm, mul(st.dir, 0.035)), 0.02, 'dash', -0.1, T.tub, 0, 10);
  K.rod(add(arm, mul(st.dir, 0.03)), st.top, 0.01, 'dash', 0.2, T.metal, 0, 8);
  const gdir = norm(add(st.dir, [0, 0.12, 0]));
  const gTop = add(st.top, mul(gdir, 0.085));
  K.rod(st.top, gTop, 0.021, 'dash', 0.05, T.carbon, 0, 12);
  K.rod(add(gTop, mul(gdir, -0.005)), add(gTop, mul(gdir, 0.008)), 0.015, 'dash', 0.2, T.carbonLt, 0, 12);
  K.obox(add(gTop, mul(gdir, 0.009)), [1, 0, 0], [0, 1, 0], gdir, 0.007, 0.007, 0.002, 'dash', 0.3, T.glow, lit ? 0.6 + 0.4 * stNear : 0);
  K.obox(add(st.top, add(mul(gdir, 0.05), [0, 0.02, 0])), [1, 0, 0], gdir, [0, 1, 0], 0.006, 0.012, 0.005, 'dash', 0.2, T.carbonLt);

  // ── THE YAW PEDALS: two plates sliding on rails, one forward as the other comes back ──
  const pz = zF + 0.12, py = 0.56;
  for (const [dx, sgn] of [[-0.09, -1], [0.09, 1]]) {
    const slide = clamp(R.rud * sgn, -1, 1) * 0.045;
    K.box(dx - 0.011, py - 0.11, zF, dx + 0.011, py + 0.1, zF + 0.02, 'dash', 0.1, T.metal);
    const c = [dx, py + slide, pz];
    K.obox(c, [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.04, 0.09, 0.008, 'dash', 0.05, T.carbon);
    K.obox(add(c, mul(norm([0, -0.89, -0.45]), -0.009)), [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.034, 0.08, 0.002, 'dash', 0.1, T.tub);
    K.obox(add(c, mul(norm([0, -0.89, -0.45]), -0.012)), [1, 0, 0], norm([0, -0.45, 0.89]), norm([0, 0.89, 0.45]), 0.004, 0.065, 0.001, 'dash', 0.2, al.rgb, lit ? 0.3 + 0.7 * clamp(R.rud * sgn, 0, 1) : 0);
    K.rod(add(c, [0, 0, -0.055]), [dx, py + slide, zF + 0.02], 0.011, 'dash', 0.2, T.metal, 0, 6);
    contactShadow(K, [dx, py + slide, zF], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.045, 0.1);
  }

  // ── THE CABIN LIGHT: a lit ring round the canopy's aft arch, the dome circuit ──
  // ⚠ NO CONTROL THE SIM DOES NOT HAVE: the parachute's red handle is a real Helix fitting, and the
  // sim has no parachute, so the hatch is on the outside and nothing in here pulls it.
  {
    const D = P.mf76, Cg = MAYFLY76_GLASS.canopy, pts = [];
    for (let a = Cg.a[0] + 4; a <= Cg.a[1] - 4; a += 8) pts.push(D.toShell(mayfly76Point(Cg.f[0] - 0.006, a, -(D.inset + 0.014 / D.m))));
    for (let i = 0; i + 1 < pts.length; i++) K.rod(pts[i], pts[i + 1], 0.005, 'hdr', 0.2, al.rgb, (R.dome && lit ? 1 : 0.35) * Math.max(amb, 0.2) * (lit ? al.k : 1), 6);
  }

  hotspotHalo(K, mf76Hotspots(P, live), live);
}

// ── THE HOLOGRAM: the Mayfly in miniature, 15 cm nose to tail ──
// Her pod as section rings with the bubble's edge, the two wings as plates, the fins, and the eight
// props as discs with their blades turning on the prop phase, each ringed in its speed. Her frame is
// her pitch and bank. Model units scaled: f forward is y, g right is x, h up is z.
const HOLO_FM = [[0.655, 0.32, -0.083], [0.655, 0.68, -0.073]];
const HOLO_AM = [[-0.5, 0.4, 0.237], [-0.5, 0.8, 0.246]];
function holoMayfly(K, c, R) {
  // Turned three-quarters to the pilot, so she reads as an aircraft and not as a row of props; the
  // turn is fixed, and only her pitch and bank move.
  const H = holoFrame(K, c, R.pitch, R.bank, -18);
  const sc = 0.075, on = R.powered && R.rpm > 0.02, frac = clamp(R.rpm / 1.05, 0, 1);
  const M = (f, g, h) => [g * sc, (f + 0.1) * sc, (h - 0.05) * sc];
  // The pod: rings at its stations, and its keel and crown lines.
  const rings = [0.72, 0.55, 0.38, 0.2, 0.0, -0.3, -0.6, -0.9];
  const ringPts = rings.map((f) => Array.from({ length: 13 }, (_, i) => { const q = mayfly76Point(f, (i / 12) * 360); return M(q[0], q[1], q[2]); }));
  ringPts.forEach((pts, k) => { for (let i = 0; i < 12; i++) H.line(pts[i], pts[i + 1], k < 4 ? 0.0007 : 0.0006); });
  for (const a of [90, -90, 0, 180]) {
    const pts = [0.8, ...rings, -0.985].map((f) => { const q = mayfly76Point(f, a); return M(q[0], q[1], q[2]); });
    for (let i = 0; i + 1 < pts.length; i++) H.line(pts[i], pts[i + 1], 0.0007);
  }
  // The bubble, a lit plate over the cockpit.
  H.plate([M(0.7, -0.1, 0.12), M(0.7, 0.1, 0.12), M(0.2, 0.12, 0.22), M(0.2, -0.12, 0.22)], HOLO, 0.7);
  // The wings: forward low, aft high, each a plate with its leading edge lit.
  for (const s of [1, -1]) {
    const wf = [M(0.575, s * 0.1, -0.088), M(0.546, s * 0.9, -0.062), M(0.43, s * 0.9, -0.062), M(0.4, s * 0.1, -0.088)];
    const wa = [M(-0.6, s * 0.02, 0.235), M(-0.645, s * 1.1, 0.258), M(-0.84, s * 1.1, 0.258), M(-0.85, s * 0.02, 0.235)];
    for (const w of [wf, wa]) {
      H.plate(w, HOLO, 0.6);
      for (let k = 0; k < 3; k++) H.line(w[k], w[k + 1], k === 0 ? 0.0009 : 0.0007);
    }
    // The endplate fin at the aft wing's tip.
    H.plate([M(-0.71, s * 1.106, 0.16), M(-0.81, s * 1.106, 0.43), M(-0.905, s * 1.106, 0.43), M(-0.865, s * 1.106, 0.16)], HOLO, 0.5);
  }
  // The pylon from the tail up to the aft wing.
  H.line(M(-0.5, 0, 0.15), M(-0.6, 0, 0.232), 0.0008);
  H.line(M(-0.92, 0, 0.16), M(-0.86, 0, 0.232), 0.0008);
  // Eight props, each a ring in its speed colour with two of its five blades drawn turning.
  const props = [...HOLO_FM.map((q) => [...q, 0.092]), ...HOLO_AM.map((q) => [...q, 0.104])];
  let i = 0;
  for (const s of [1, -1]) for (const [f, g, h, r] of props) {
    const cc = M(f, s * g, h), rr = r * sc;
    H.ring(cc, [1, 0, 0], [0, 0, 1], rr, 14, frac > 0.85 ? HOLO_LINE : HOLO_AMBER, on ? 1 : 0.3);
    const t = (on ? R.phase * 2.2 * (i % 2 ? -1 : 1) : 0) + i * 0.6, d = [Math.cos(t) * rr * 0.92, 0, Math.sin(t) * rr * 0.92];
    H.line([cc[0] - d[0], cc[1], cc[2] - d[2]], [cc[0] + d[0], cc[1], cc[2] + d[2]], 0.001, HOLO_LINE, 1);
    i++;
  }
}

// ── THE PILOT'S PAGE: attitude, speed and height tapes, a heading tape, the vertical speed ──
function pfd(Pn, R) {
  Pn.attitude(0, -0.002, 0.048, R.pitch, R.bank);
  tape(Pn, -0.077, R.ias, 5, 10, 'KT');
  tape(Pn, 0.077, R.alt, 50, 100, 'FT');
  const span = 30, w = 0.06;
  Pn.rect(-w, 0.05, w, 0.064, [10, 18, 24], 0.3, 0.002);
  const h0 = Math.floor((R.hdg - span) / 5) * 5;
  for (let d = h0; d <= R.hdg + span; d += 5) {
    const u = ((d - R.hdg) / span) * w;
    if (Math.abs(u) > w - 0.002) continue;
    const big = ((d % 30) + 30) % 30 === 0;
    Pn.rect(u - 0.0008, big ? 0.051 : 0.056, u + 0.0008, 0.063, [200, 230, 244], 0.7, 0.003);
  }
  Pn.rect(-0.016, 0.048, 0.016, 0.066, T.screen, 0.2, 0.0035);
  Pn.digits(-0.0135, 0.0515, 0.011, String(Math.round(((R.hdg % 360) + 360) % 360)).padStart(3, '0'), T.glow);
  const vs = clamp(R.vsi / 1500, -1, 1);
  Pn.rect(0.094, -0.05, 0.098, 0.05, [20, 30, 36], 0.2, 0.002);
  if (Math.abs(vs) > 0.01) Pn.rect(0.093, Math.min(0, vs * 0.05), 0.099, Math.max(0, vs * 0.05), vs > 0 ? C.green : T.amber, 0.9, 0.003);
  if (R.stall) Pn.rect(-0.098, -0.066, 0.098, -0.058, T.red, 1, 0.003);
}
function tape(Pn, u, v, step, major, unit) {
  const hh = 0.05, w = 0.018, span = step * 6;
  Pn.rect(u - w, -hh, u + w, hh, [10, 18, 24], 0.3, 0.002);
  const v0 = Math.floor((v - span) / step) * step;
  for (let t = v0; t <= v + span; t += step) {
    if (t < 0) continue;
    const b = ((t - v) / span) * hh;
    if (Math.abs(b) > hh - 0.003) continue;
    const big = t % major === 0, side = u < 0 ? 1 : -1;
    Pn.rect(u + side * w - side * (big ? 0.009 : 0.005), b - 0.0007, u + side * w, b + 0.0007, [200, 230, 244], 0.7, 0.003);
  }
  Pn.rect(u - w - 0.003, -0.009, u + w + 0.003, 0.009, T.screen, 0.2, 0.0035);
  const s = String(Math.round(v));
  Pn.digits(u - w + 0.001, -0.006, 0.011, s.length > 4 ? s.slice(-4) : s, T.glow, false);
  Pn.text(unit, u, -hh - 0.011, 0.01, [160, 190, 206], 0.5, 0.003);
}

// ── THE MOTOR PAGE: the aircraft from above, both wings and their eight props turning ──
// One throttle drives all eight, so one speed rings each; the tilt is drawn in cruise as the body is.
function motorPage(Pn, R) {
  const sc = 0.04, cy = -0.004;
  const P2 = (f, g) => [g * sc * 1.0, cy + f * sc * 0.75];
  // The pod and tail, the two wings.
  for (let i = 0; i < 14; i++) {
    const t0 = (i / 14) * TAU, t1 = ((i + 1) / 14) * TAU;
    const a = P2(0.4 + Math.sin(t0) * 0.42, Math.cos(t0) * 0.15), b = P2(0.4 + Math.sin(t1) * 0.42, Math.cos(t1) * 0.15);
    Pn.plate([[a[0], a[1]], [b[0], b[1]], [b[0] * 0.97, b[1] * 0.97 + cy * 0.03], [a[0] * 0.97, a[1] * 0.97 + cy * 0.03]], [80, 130, 160], 0.6, 0.003);
  }
  { const [u0, v0] = P2(0.0, 0), [, v1] = P2(-0.95, 0); Pn.rect(u0 - 0.0018, v1, u0 + 0.0018, v0, [80, 130, 160], 0.6, 0.003); }
  for (const [le, te, g0, g1] of [[0.575, 0.4, 0.1, 0.9], [-0.6, -0.85, 0, 1.1]]) for (const s of [1, -1]) {
    const a = P2(le, s * g0), b = P2(le, s * g1), c = P2(te, s * g1), d = P2(te, s * g0);
    Pn.plate([a, b, c, d], [40, 70, 92], 0.4, 0.0028);
  }
  const on = R.powered && R.rpm > 0.02, frac = clamp(R.rpm / 1.05, 0, 1), col = frac > 0.85 ? T.glow : T.amber;
  let i = 0;
  for (const s of [1, -1]) for (const [f, g] of [...HOLO_FM, ...HOLO_AM]) {
    const [cu, cv] = P2(f + 0.05, s * g);
    Pn.annulus(cu, cv, 0.0085, 0.0105, [30, 44, 54], 0.3, 0.003, 16);
    if (frac > 0.01) Pn.annulus(cu, cv, 0.0085, 0.0105, col, 0.95, 0.0035, Math.max(2, Math.round(16 * frac)), Math.PI / 2, Math.PI / 2 - frac * TAU);
    const t = (on ? R.phase * 2.2 * (i % 2 ? -1 : 1) : 0) + i * 0.6;
    Pn.spoke(cu, cv, t, -0.008, 0.008, 0.0013, [210, 236, 248], 0.9, 0.0045);
    i++;
  }
  Pn.text('MOTORS', -0.05, 0.054, 0.011, [160, 190, 206], 0.5, 0.003);
  Pn.text(on ? '8/8' : 'OFF', 0.06, 0.054, 0.011, on ? T.glow : [120, 130, 136], 0.7, 0.003);
  Pn.text(String(Math.round(R.rpm * 100)) + ' PCT', 0, -0.06, 0.011, [200, 230, 244], 0.6, 0.003);
}

// ── THE ENERGY PAGE: state of charge, power drawn, cell temperature, minutes left ──
function energyPage(Pn, R) {
  const n = 10, soc = R.fuel;
  Pn.text('SOC', -0.05, 0.054, 0.011, [160, 190, 206], 0.5, 0.003);
  Pn.digits(-0.004, 0.041, 0.02, String(Math.round(soc * 100)).padStart(3, ' '), soc < 0.15 ? T.red : T.glow, false);
  for (let i = 0; i < n; i++) {
    const u = -0.068 + i * 0.0138, f = clamp(soc * n - i, 0, 1);
    Pn.rect(u, 0.012, u + 0.011, 0.036, [24, 34, 40], 0.3, 0.002);
    if (f > 0.02) Pn.rect(u + 0.0015, 0.0135, u + 0.0095, 0.0135 + 0.021 * f, soc < 0.15 ? T.red : soc < 0.3 ? T.amber : T.glow, 0.95, 0.003);
  }
  // Power: an ultralight's eight motors draw about 25 kW in cruise and 75 at full thrust.
  const kw = R.powered ? Math.round(lerp(2, 75, clamp(R.thr * R.rpm, 0, 1))) : 0;
  Pn.text('KW', -0.055, -0.006, 0.011, [160, 190, 206], 0.5, 0.003);
  Pn.rect(-0.04, -0.012, 0.03, 0.0, [24, 34, 40], 0.3, 0.002);
  if (kw > 0) Pn.rect(-0.039, -0.011, -0.039 + 0.068 * (kw / 75), -0.001, kw > 62 ? T.amber : T.glow, 0.9, 0.003);
  Pn.digits(0.038, -0.012, 0.012, String(kw).padStart(2, ' '), T.glow, false);
  // Minutes left at this draw: a 12 kWh pack over what is being spent.
  const mins = kw > 0 ? Math.min(99, Math.round(soc * 12 * 60 / Math.max(10, kw))) : 0;
  Pn.text('MIN', -0.045, -0.032, 0.011, [160, 190, 206], 0.5, 0.003);
  Pn.digits(0.0, -0.038, 0.013, String(mins).padStart(2, ' '), T.glow, false);
  // Cell temperature as a bar, green to amber to red.
  Pn.text('CELLS', -0.045, -0.058, 0.011, [160, 190, 206], 0.5, 0.003);
  Pn.rect(-0.012, -0.062, 0.068, -0.054, [24, 34, 40], 0.3, 0.002);
  Pn.rect(-0.011, -0.061, -0.011 + 0.078 * R.temp, -0.055, R.temp > 0.85 ? T.red : R.temp > 0.7 ? T.amber : C.green, 0.9, 0.003);
}

// ── THE MAP: the kit's moving map, the course line, the distance ──
function mapPage(Pn, R, live) {
  panelGps(Pn, 0, -0.004, 0.083, 0.06, live, { label: false, bezel: [8, 14, 18] });
  Pn.text('NAV', -0.06, 0.056, 0.011, [160, 190, 206], 0.5, 0.009);
  const g = live && live.gpsTo;
  if (g && Number.isFinite(g.dist)) Pn.digits(0.03, 0.05, 0.011, String(Math.min(999, Math.round(g.dist))).padStart(3, ' '), T.glow, false);
}
