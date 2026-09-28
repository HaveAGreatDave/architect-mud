// THE DRAGONFLY'S COCKPIT: the inside of its glass bubble, as geometry.
//
// The Dragonfly is a Revolution Mini-500: a kit-built light helicopter, a Rotax 582 two-stroke
// behind your back, a fibreglass egg of a cabin with a vacu-formed glass bubble over the front of
// it, and a panel far enough away that the flight-test pilot had to reach for the radio. It is the
// cheapest thing in the game that hovers, and the cockpit should look like it: grey cloth, bare
// fibreglass, a rubber boot round the stick, and a lot of glass.
//
// Sources read for this file:
//   https://en.wikipedia.org/wiki/Revolution_Mini-500
//     22 ft 6 in (6.9 m) long, 19 ft rotor, Rotax 582, single seat, "a foam and glass-fibre cabin".
//   https://www.redbackaviation.com/mini-500-helicopter-flight-test/
//     cabin 34.5 in wide, 52.75 in high, 51 in long; cyclic mounted high; collective on the left
//     with adjustable friction and a twist-grip throttle; pedals with a lip that cups the foot well;
//     a tunnel down the middle of the cabin for the cyclic linkage under a fabric boot; flyable
//     with the doors off; a low-rotor-rpm warning light "prominently affixed to the panel".
//   https://www.redbackaviation.com/revolution-helicopters-mini-500-introduction/
//     the vacu-formed panel: dual engine/rotor tacho, altimeter, magnetic compass, slip and bank,
//     VSI, ASI, coolant temperature, hourmeter; electric clutch engagement; electric start;
//     control friction locks; 15 gal fuel; a form-fitted upholstered seat, carpet and trim.
//
// ── ⚠ THE ROOM IS THE EXTERIOR'S CABIN LOFT ─────────────────────────────────
//
// mesh_heli.json's `cabin` part is an ellipse loft of seven stations, and its `regions` say which
// bays are glass: the two that START at f 0.60 and f 0.46, plus the fore apex cap. So the glass
// runs from the nose apex back to the station after the last glazed bay, which is f 0.30, all the
// way round. Everything here is read off that part: the wall is the loft's own section walked at
// its own stations and pushed in by a wall thickness, the glass is the absence of wall forward of
// the station the regions end at, and the bubble's frame is the exterior's own centre post, door
// arches and sill hoops, pulled in off the skin. Nothing about the shape of the cabin is typed here.
//
// ── ⚠ ONE SCALE: 3.833 m PER MODEL UNIT ─────────────────────────────────────
//
// The real aircraft is 6.9 m nose to tail. The model runs from the nose apex at f 0.70 to the fin's
// trailing edge at f -1.10: 1.80 units. 6.9 / 1.80 = 3.833 m a unit, derived below from the exterior
// itself (the apex and the fin outline), not typed. At that scale the loft is 1.61 m wide outside at
// its waist and 1.65 m tall, which is the Wikipedia "cabin width 1.6 m" almost exactly.
//
// ── ⚠ TWO SEATS, NOT ONE, AND WHY ────────────────────────────────────────────
//
// The real Mini-500 is a single-seater in a cabin 0.88 m wide inside. This one is not: the game sells
// the Dragonfly with two seats (ac_dragonfly.json), and the exterior at the length-derived scale is a
// 1.6 m egg, which is Robinson R22 width with room to spare. A single seat on the centreline of that
// egg would be a seat floating in a room built for two. So it is two seats side by side, the pilot on
// the RIGHT (the helicopter convention), 0.29 m off the centreline, with the
// Mini-500's centre tunnel between them, the collective hinged on the tunnel top at the pilot's left hand,
// and one set of controls. The passenger gets a foot rest and a grab handle, not a cyclic.
//
// What is NOT derived is anything about a PERSON: seat width, reach, dial size. Those are honest
// metres. The exterior's 14-gon section is also too coarse to carry a door seam or a sill, so the
// door outline is authored on the wall in metres and only its extent (the aft station of the glass
// and the door arch) is read off the model.
//
// Pure: no clock, no camera, no DOM. `live` arrives as an argument.
import { makeKit, C, clamp, pedal, SHINY, PANE, TEXTURE } from './interior-kit.js';
import { contactShadow, hotspotHalo } from './interior-cockpit-kit.js';
import { MESH_ROWS } from './vehicle-meshes.js';

const TAU = Math.PI * 2;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;

// ── THE STYLE ────────────────────────────────────────────────────────────────
// A kit helicopter: grey cloth on the seat and door cards, bare white fibreglass up top, a black
// vacu-formed panel, charcoal carpet. The frame is the exterior's black mullion tube.
export const DRAGONFLY_TRIM = {
  cloth: [74, 80, 90], clothDk: [58, 63, 72], piping: [36, 40, 46],
  glassFibre: [208, 206, 198], glassFibreDk: [176, 174, 166],
  carpet: [44, 44, 48], carpetEdge: [30, 30, 34],
  panel: [26, 27, 30], panelDk: [16, 17, 19],
  frame: [30, 32, 36], boot: [22, 22, 24],
  harness: [40, 70, 150], buckle: [176, 180, 188],
  seatShell: [60, 62, 68],
  headliner: [196, 194, 186], reveal: [150, 150, 146], seal: [18, 18, 20],
  steel: [128, 134, 142], grip: [28, 29, 32],
};
const T = DRAGONFLY_TRIM;
// What each surface is made of, for the GL pass's per-pixel grain (interior-kit.js TEXTURE). Lamps,
// dial faces, digits and glass are left unregistered on purpose: they must stay flat.
for (const k of ['cloth', 'clothDk', 'piping', 'headliner', 'harness']) TEXTURE.set(T[k], 'fabric');
for (const k of ['glassFibre', 'glassFibreDk', 'reveal', 'frame']) TEXTURE.set(T[k], 'paint');
for (const k of ['carpet', 'carpetEdge']) TEXTURE.set(T[k], 'carpet');
for (const k of ['panel', 'panelDk', 'seatShell']) TEXTURE.set(T[k], 'plastic');
for (const k of ['boot', 'seal', 'grip']) TEXTURE.set(T[k], 'rubber');
for (const k of ['buckle', 'steel']) TEXTURE.set(T[k], 'brushed');
SHINY.set(T.buckle, { spec: 0.8, pow: 40 });
SHINY.set(T.steel, { spec: 0.5, pow: 24 });
SHINY.set(T.frame, { spec: 0.25, pow: 18 });
SHINY.set(T.panel, { spec: 0.15, pow: 10 });
// The dial glass catches a crescent of the bubble's light.
const DIAL_GLINT = [255, 252, 244];
PANE.set(DIAL_GLINT, 0.2);
// The compass's liquid bowl, which you see the card through.
const BOWL = [180, 200, 210];
PANE.set(BOWL, 0.25);
const LOW_RPM = [255, 60, 44];
const LENS_INK = [30, 12, 10];   // letters painted on a lamp's lens
const SW_NAME = { master: 'BAT', clutch: 'CLUTCH', land: 'LAND', nav: 'NAV', strobe: 'STROBE', dome: 'DOME' };

// ── THE EXTERIOR, READ ───────────────────────────────────────────────────────
const findPart = (parts, name) => {
  for (const p of parts || []) {
    if (p.name === name) return p;
    const q = findPart(p.parts, name);
    if (q) return q;
  }
  return null;
};

// The cabin loft as a surface at any station and angle. Linear between stations is EXACT against the
// exterior at its vertices, because emitLoft skins ring k of one station to ring k of the next.
// `a` is measured from +g (the right flank) toward the crown, which is how the loft's rings go round.
function loftSurface(p) {
  const st = p.stations.slice().sort((x, y) => y.f - x.f);
  const sec = (f) => {
    if (f >= st[0].f) return st[0];
    if (f <= st[st.length - 1].f) return st[st.length - 1];
    for (let i = 0; i < st.length - 1; i++) {
      const A = st[i], B = st[i + 1];
      if (f <= A.f && f >= B.f) {
        const t = (A.f - f) / (A.f - B.f);
        return { f, rg: lerp(A.rg, B.rg, t), rv: lerp(A.rv, B.rv, t), cz: lerp(A.cz, B.cz, t) };
      }
    }
    return st[0];
  };
  const pt = (f, a, inset = 0) => {
    const s = sec(f), g = Math.cos(a) * s.rg, h = Math.sin(a) * s.rv, L = Math.hypot(g, h) || 1;
    return [f, g - (g / L) * inset, s.cz + h - (h / L) * inset];
  };
  // The half-width of the inset section at height `h`, or 0 when `h` is outside it.
  const halfAt = (f, h, inset = 0) => {
    const s = sec(f), rg = s.rg - inset, rv = s.rv - inset, d = (h - s.cz) / rv;
    return Math.abs(d) >= 1 ? 0 : rg * Math.sqrt(1 - d * d);
  };
  return { sec, pt, halfAt, stations: st };
}

// Where the glass stops, read off `regions`: the bay that starts at the aft-most glazed `at` ends at
// the next station aft of it.
function glassAftOf(p) {
  const fs = p.stations.map((s) => s.f).sort((a, b) => b - a);
  const glazed = [];
  for (const rg of p.regions || []) if (rg.role === 'glass') glazed.push(...rg.at);
  if (!glazed.length) return null;
  const last = Math.min(...glazed), i = fs.indexOf(last);
  return i >= 0 && i < fs.length - 1 ? fs[i + 1] : last;
}

// The model's overall length, nose apex to the aft-most point of any part: what 6.9 m is measured
// over. Walked off the part tree so a longer boom takes the scale with it.
function modelLength(doc) {
  let fMax = -Infinity, fMin = Infinity;
  const see = (f) => { if (Number.isFinite(f)) { fMax = Math.max(fMax, f); fMin = Math.min(fMin, f); } };
  const walk = (ps) => {
    for (const p of ps || []) {
      if (p.stations) p.stations.forEach((s) => see(s.f));
      if (p.capFore && p.capFore.at) see(p.capFore.at[0]);
      if (p.pts) p.pts.forEach((q) => see(q[0]));
      if (p.outline) p.outline.forEach((q) => see(q[0]));
      if (p.faces) p.faces.forEach((fc) => (fc.p || []).forEach((q) => see(q[0])));
      walk(p.parts);
    }
  };
  walk(doc.parts);
  return fMax - fMin;
}

// ── THE PERSON, IN METRES AND MODEL UNITS ────────────────────────────────────
export const MINI500_LENGTH_M = 6.9;
// Where the pilot's eye is in the model: 0.09 right of the centreline (a seat's width from the
// passenger's), over the cabin waist, a seated eye height (1.08 m) above the cabin floor.
const CAB = {
  eyeF: 0.18, eyeG: 0.075,
  floorH: -0.14,            // the cabin floor; the skid cross-tubes meet the belly just under it
  eyeOverFloor: 1.08,       // seat pan 0.30 + a seated eye 0.78, metres
  back: 0.0,                // the bulkhead the seat backs stand against, just aft of the waist
  chin: 0.40,               // where the floor pan stops and the chin glass starts, under the pedals
  wall: 0.045,              // fibreglass skin plus the lining, metres
};

// ── THE PROFILE ──────────────────────────────────────────────────────────────
export function dragonflyProfile(doc = MESH_ROWS.heli) {
  if (!doc) return null;
  const cab = findPart(doc.parts, 'cabin');
  if (!cab || !cab.stations) return null;
  const m = MINI500_LENGTH_M / modelLength(doc);
  const S = loftSurface(cab);
  const fG = glassAftOf(cab);
  const apex = cab.capFore && cab.capFore.at;
  const fE = CAB.eyeF, gE = CAB.eyeG, hE = CAB.floorH + CAB.eyeOverFloor / m;
  const X = (g) => (g - gE) * m, Y = (f) => (f - fE) * m, Z = (h) => (h - hE) * m;
  const toShell = (q) => [X(q[1]), Y(q[0]), Z(q[2])];
  const inset = CAB.wall / m;
  const G = { doc, cab, S, m, X, Y, Z, toShell, inset, fG, fB: CAB.back, fC: CAB.chin, zF: Z(CAB.floorH), apex };

  const room = buildRoom(G);
  const glass = bubbleGlass(G, room.wins);
  // ⚠ THE BOUNDS ARE THE BUBBLE AS WELL AS THE ROOM: the glass is not a face, but the space inside it
  // is cabin, and the pod, the pedals and the frame all stand in it.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const see = (q) => {
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]);
    y1 = Math.max(y1, q[1]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]);
  };
  for (const f of room.faces) f.p.forEach(see);
  const fFront = (apex ? apex[0] : S.stations[0].f) - 0.02;
  for (let i = 0; i <= 12; i++) for (let j = 0; j < 36; j++) {
    const q = toShell(S.pt(lerp(fG, S.stations[0].f, i / 12), (j / 36) * TAU, inset));
    if (q[2] >= G.zF) see(q);
  }
  see([X(0), Y(fFront), G.zF]);
  // The panes are cabin too: the belly glass under the chin runs below the floor pan.
  for (const pn of glass) pn.forEach(see);
  const xCentre = X(0);
  const halfW = Math.max(xCentre - x0, x1 - xCentre) + 1e-6;

  const zF = G.zF;
  const seatZ = zF + 0.30;
  const P = {
    label: 'Dragonfly bubble (Mini-500)',
    xCentre, halfW,
    floor: z0 - 1e-6, roof: z1 + 1e-6, front: y1 + 1e-6, back: y0 - 1e-6,
    // ── measured off the exterior ──
    glassAftY: Y(fG), chinY: Y(CAB.chin), mPerUnit: m,
    // The side rays go out through the bubble below the door arch and ahead of the sill hoop's
    // aft end: the part of the glass beside your knees that the real thing is bought for.
    winY: [1.40, 1.70], winZ: [-0.52, -0.28],
    // ── a person, in metres ──
    dashY: 0.93, dashZ: -0.40, headerZ: 0.30, pillarW: 0.03,
    seatZ, seatHalf: 0.22, seatY: [-0.40, 0.08], backZ: -0.08,
    seats: 2, centrePost: 0,
    normalLit: true,
    // Panel floods: under the pod's visor, and a map light on the bulkhead over the tunnel.
    floods: [{ p: [xCentre * 0.45, 0.86, -0.28], r: 0.40 }, { p: [xCentre, -0.50, 0.05], r: 0.55 }],
    room: dragonflyShell,
    // The glass: every glazed facet of the exterior bubble, and the two door windows. Static, so built
    // once here. NOT part of shellFaces: the renderer lays it over the room as film.
    glass,
    dragonfly: { ...G, faces: room.faces, frame: room.frame },
    hotspots(live) { return dragonflyHotspots(this, live); },
  };
  return P;
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
// Built once per profile: walls, bulkhead, floor, tunnel, the bubble's frame. Nothing here moves.
function buildRoom(G) {
  const { S, X, Y, Z, toShell, inset, fG, fB, fC, zF, doc } = G;
  const faces = [];
  const put = (p, n, tone, k, rgb, emis) => faces.push({ p, n, tone, k, rgb, emis: emis || 0 });
  const K = makeKit((fs, tone, k, fwd, rgb, emis) => { for (const f of fs) put(f.p, f.n, tone, k, rgb, emis); }, false);
  const P3 = (f, a) => toShell(S.pt(f, a, inset));
  const aboveFloor = (poly) => clipHalf(poly, (q) => q[2] - zF);
  const inward = (f, a) => {
    const d = 1e-4;
    let n = norm(cross(sub(P3(f + d, a), P3(f - d, a)), sub(P3(f, a + d), P3(f, a - d))));
    const c = toShell([f, 0, S.sec(f).cz]);
    if (dot(n, sub(c, P3(f, a))) < 0) n = mul(n, -1);
    return n;
  };

  // ── THE WALLS: fibreglass lining over the crown, cloth door cards below the waist ──
  // Walked at the loft's own stations between the bulkhead and the glass, subdivided.
  const NF = 16, NA = 64;
  const fAt = (i) => lerp(fB, fG, i / NF);
  const aAt = (j) => -Math.PI / 2 + (j / NA) * TAU;
  // The doors: each side, from the arch at the glass back to 0.08, below the crown. Authored in
  // angle and station on the loft, because the 14-gon has no door edge to read.
  const DOOR_F0 = 0.07, DOOR_A = 0.95;   // the door's aft edge, and how far up the side it reaches (rad)
  // ⚠ ONE COLOUR PER SURFACE, NEVER A CHECKER. The first cut alternated two tones cell by cell, and
  // from the seat the whole headliner read as a placeholder texture. The grain is the GL pass's job
  // (TEXTURE, registered at the top); the cells only carry the curve.
  //
  // ⚠ AND THE DOOR HAS A WINDOW. The Mini-500's doors are glazed from above the waist, and the
  // exterior's body loft is too coarse to say so (its door bays are painted shell), so the window is
  // cut here in the loft's own (f, a) parameters, which makes the cut follow the curve exactly: from a
  // hand above the waist to a hand under the crown, between the door's aft edge and the door arch.
  const WIN = { f0: DOOR_F0 + 0.03, f1: fG - 0.022, a0: 0.12, a1: DOOR_A - 0.14 };
  const winOf = (sd) => (sd > 0 ? [[WIN.f0, WIN.a0], [WIN.f1, WIN.a0], [WIN.f1, WIN.a1], [WIN.f0, WIN.a1]]
    : [[WIN.f0, Math.PI - WIN.a1], [WIN.f1, Math.PI - WIN.a1], [WIN.f1, Math.PI - WIN.a0], [WIN.f0, Math.PI - WIN.a0]]);
  const wins = [winOf(1), winOf(-1)];
  for (let i = 0; i < NF; i++) {
    for (let j = 0; j < NA; j++) {
      const f0 = fAt(i), f1 = fAt(i + 1), a1 = aAt(j), a2 = aAt(j + 1);
      let cells = [[[f0, a1], [f1, a1], [f1, a2], [f0, a2]]];
      for (const w of wins) cells = cells.flatMap((c) => (bbOverlap(c, w) ? subtractConvex(c, w) : [c]));
      const am = (a1 + a2) / 2, fm = (f0 + f1) / 2, sn = Math.sin(am), side = Math.abs(Math.cos(am)) > 0.25;
      const n = inward(fm, am);
      const inDoor = side && fm > DOOR_F0 && Math.abs(Math.asin(clamp(sn, -1, 1))) < DOOR_A;
      for (const c of cells) {
        const poly = aboveFloor(c.map(([f, a]) => P3(f, a)));
        if (poly.length < 3) continue;
        if (sn > 0.72) put(poly, n, 'hdr', -0.30, T.headliner);
        else if (inDoor) put(poly, n, 'pil', -0.08, T.cloth);
        else put(poly, n, 'pil', -0.16, T.clothDk);
      }
    }
  }
  // The window's frame: a moulded reveal round the opening, from the lining out to the skin, and a
  // black rubber seal along its inner edge.
  for (const w of wins) {
    const cF = (w[0][0] + w[2][0]) / 2, cA = (w[0][1] + w[2][1]) / 2;
    for (let k = 0; k < 4; k++) {
      const [fa, aa] = w[k], [fb, ab] = w[(k + 1) % 4];
      const seg = [];
      for (let t = 0; t <= 6; t++) seg.push([lerp(fa, fb, t / 6), lerp(aa, ab, t / 6)]);
      for (let t = 1; t < seg.length; t++) {
        const A = seg[t - 1], Bq = seg[t], mid = [(A[0] + Bq[0]) / 2, (A[1] + Bq[1]) / 2];
        const i0 = P3(A[0], A[1]), i1 = P3(Bq[0], Bq[1]);
        const o0 = toShell(S.pt(A[0], A[1], 0.022 / G.m)), o1 = toShell(S.pt(Bq[0], Bq[1], 0.022 / G.m));
        const toC = sub(toShell(S.pt(cF, cA, inset)), toShell(S.pt(mid[0], mid[1], inset)));
        const out = norm(sub(toShell(S.pt(mid[0], mid[1], 0)), toShell(S.pt(mid[0], mid[1], inset))));
        const rn = norm(sub(toC, mul(out, dot(toC, out))));
        put([i0, i1, o1, o0], rn, 'pil', 0.05, T.reveal);
        K.rod(toShell(S.pt(A[0], A[1], inset + 0.006 / G.m)), toShell(S.pt(Bq[0], Bq[1], inset + 0.006 / G.m)), 0.008, 'pil', 0.1, T.seal, 0, 5, false);
      }
    }
  }
  // The door seams: a dark rod round each door on the lining, and a pull handle and a map pocket.
  for (const s of [1, -1]) {
    const aSide = (a) => (s > 0 ? a : Math.PI - a);
    const seam = [];
    const aLo = Math.asin(clamp((zF + 0.05 - toShell(S.pt(DOOR_F0, 0))[2]) / (S.sec(DOOR_F0).rv * G.m), -0.99, 0.99));
    for (let k = 0; k <= 6; k++) seam.push([DOOR_F0, lerp(aLo, DOOR_A, k / 6)]);
    for (let k = 1; k <= 4; k++) seam.push([lerp(DOOR_F0, fG - 0.005, k / 4), DOOR_A]);
    for (let k = 1; k <= 6; k++) seam.push([fG - 0.005, lerp(DOOR_A, aLo, k / 6)]);
    const pts = seam.map(([f, a]) => toShell(S.pt(f, aSide(a), inset + 0.012 / G.m)));
    for (let k = 1; k < pts.length; k++) K.rod(pts[k - 1], pts[k], 0.006, 'pil', -0.3, T.piping, 0, 4, false);
    // The pull, on the door card under your elbow.
    const fh = 0.15, ah = aSide(0.02);
    const h0 = toShell(S.pt(fh - 0.03, ah, inset + 0.03 / G.m)), h1 = toShell(S.pt(fh + 0.03, ah, inset + 0.03 / G.m));
    K.rod(h0, h1, 0.011, 'pil', 0.1, C.black, 0, 6);
    K.rod(h0, toShell(S.pt(fh - 0.03, ah, inset + 0.004 / G.m)), 0.008, 'pil', 0.1, C.black, 0, 5);
    K.rod(h1, toShell(S.pt(fh + 0.03, ah, inset + 0.004 / G.m)), 0.008, 'pil', 0.1, C.black, 0, 5);
    // The map pocket, low on the card: a lip standing off it.
    const ap = aSide(-0.45);
    const p0 = toShell(S.pt(0.10, ap, inset + 0.004 / G.m)), p1 = toShell(S.pt(0.26, ap, inset + 0.004 / G.m));
    const pn = inward(0.18, ap);
    K.obox(mul(add(p0, p1), 0.5), norm(sub(p1, p0)), norm(cross(pn, norm(sub(p1, p0)))), pn,
      Math.hypot(...sub(p1, p0)) / 2, 0.06, 0.012, 'pil', -0.2, T.clothDk);
    // The card is pleated: a stitched roll every few inches, running fore and aft along the curve.
    for (const a of [-0.30, -0.18, -0.06]) {
      let prev = null;
      for (let k = 0; k <= 8; k++) {
        const q = toShell(S.pt(lerp(DOOR_F0 + 0.015, fG - 0.02, k / 8), aSide(a), inset + 0.006 / G.m));
        if (prev) K.rod(prev, q, 0.007, 'pil', -0.05, T.cloth, 0, 5, false);
        prev = q;
      }
    }
    // The slide vent: a small sliding pane in the window's lower aft corner, its track and its tab.
    const vf0 = WIN.f0 + 0.01, vf1 = WIN.f0 + 0.07, va = aSide(WIN.a0 + 0.12);
    K.rod(toShell(S.pt(vf0, va, inset + 0.004 / G.m)), toShell(S.pt(vf1, va, inset + 0.004 / G.m)), 0.005, 'pil', 0.2, T.seal, 0, 4);
    K.rod(toShell(S.pt(vf1, aSide(WIN.a0), inset + 0.004 / G.m)), toShell(S.pt(vf1, va, inset + 0.004 / G.m)), 0.005, 'pil', 0.2, T.seal, 0, 4);
  }

  // ── THE BULKHEAD: the firewall between you and a two-stroke, padded ──
  const NS = 48, bpts = [];
  for (let k = 0; k <= NS; k++) bpts.push(P3(fB, -Math.PI / 2 + (k / NS) * TAU));
  const bulk = aboveFloor(bpts);
  if (bulk.length >= 3) put(bulk, [0, 1, 0], 'post', -0.14, T.clothDk);
  const yB = Y(fB), xC = X(0);
  // Two stitched pads behind the seats and a stringer between them over the tunnel.
  for (const cx of [0, 2 * xC]) {
    K.box(cx - 0.20, yB, zF + 0.34, cx + 0.20, yB + 0.035, zF + 0.95, 'post', -0.05, T.cloth);
    for (let r = 1; r < 4; r++) K.box(cx - 0.20, yB + 0.035, zF + 0.34 + r * 0.15, cx + 0.20, yB + 0.040, zF + 0.345 + r * 0.15, 'post', -0.2, T.piping);
  }
  // The fuel-shutoff T handle, red, on the bulkhead over the tunnel.
  K.rod([xC, yB, zF + 0.55], [xC, yB + 0.06, zF + 0.55], 0.006, 'post', 0.1, T.steel, 0, 5);
  K.box(xC - 0.035, yB + 0.06, zF + 0.54, xC + 0.035, yB + 0.08, zF + 0.56, 'post', 0.1, C.fireRed);
  // An extinguisher clipped to the bulkhead by the passenger's shoulder.
  const ex = 2 * xC - 0.02;
  K.rod([ex, yB + 0.08, zF + 0.10], [ex, yB + 0.08, zF + 0.42], 0.04, 'post', 0.1, C.fireRed, 0.05, 10);
  K.rod([ex, yB + 0.08, zF + 0.42], [ex, yB + 0.08, zF + 0.47], 0.013, 'post', 0.1, C.black, 0, 6);
  for (const z of [0.18, 0.35]) K.box(ex - 0.045, yB, zF + z, ex + 0.045, yB + 0.012, zF + z + 0.02, 'post', 0, T.steel);

  // ── THE FLOOR: carpet from the bulkhead to the chin glass, out to the lining at floor height ──
  const NFl = 14;
  const fFl = (i) => lerp(fB, fC, i / NFl);
  const floorHalf = (f) => Math.max(0, S.halfAt(f, CAB.floorH, inset) * G.m + 0.004);
  for (let i = 0; i < NFl; i++) {
    const f0 = fFl(i), f1 = fFl(i + 1), w0 = floorHalf(f0), w1 = floorHalf(f1);
    if (w0 <= 0 && w1 <= 0) continue;
    put([[xC - w0, Y(f0), zF], [xC + w0, Y(f0), zF], [xC + w1, Y(f1), zF], [xC - w1, Y(f1), zF]], [0, 0, 1], 'floor', -0.2, i & 1 ? T.carpet : T.carpetEdge);
  }
  // The floor pan's front edge, a lip where the chin glass starts, and the keel under the glass
  // running on to the bubble's belly: what the chin window is framed by.
  const yC = Y(fC), wC = floorHalf(fC);
  K.box(xC - wC, yC - 0.03, zF - 0.02, xC + wC, yC, zF + 0.025, 'post', 0.1, T.frame);
  const keelEnd = toShell(S.pt(fC + 0.10, -Math.PI / 2, inset + 0.02 / G.m));
  K.rod([xC, yC, zF - 0.01], keelEnd, 0.018, 'post', 0.1, T.frame, 0, 6);

  // ── THE TUNNEL: the Mini-500's cyclic linkage runs down the middle under a fabric boot ──
  const tw = TUNNEL.hw, tTop = zF + TUNNEL.h;
  K.box(xC - tw, yB, zF, xC + tw, yC - 0.06, tTop, 'post', -0.05, T.clothDk);
  K.box(xC - tw - 0.006, yB, tTop - 0.004, xC + tw + 0.006, yC - 0.06, tTop + 0.006, 'post', 0.1, T.piping);
  // The boot's zip and a row of fasteners along each side.
  K.box(xC - 0.004, yB + 0.05, tTop + 0.006, xC + 0.004, yC - 0.10, tTop + 0.010, 'post', 0.2, T.buckle);
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) {
    const y = lerp(yB + 0.08, yC - 0.12, i / 5);
    K.box(xC + s * (tw + 0.001), y - 0.008, tTop - 0.05, xC + s * (tw + 0.006), y + 0.008, tTop - 0.035, 'post', 0.2, T.buckle);
  }

  // ── THE BUBBLE'S FRAME: the exterior's own tubes, pulled in off the skin ──
  // ⚠ READ BY NAME FROM mesh_heli.json, so a mullion moved in the Modelshop moves in here too. Each
  // point is pushed in toward the section's middle by the wall plus the tube's own radius, which is
  // what keeps it inside the room and off the glass it is holding.
  const frame = [];
  // ⚠ A TUBE ENDING AT THE NOSE APEX IS CUT BACK TO THE FIRST STATION: forward of it the section is a
  // cap, not a ring, so there is no middle to pull the tube in toward and it would stand outside.
  const fTop = S.stations[0].f - 0.01;
  const trim = (pts) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      if (a[0] <= fTop) { out.push(a); continue; }
      const b = pts[i + 1] || pts[i - 1];
      if (b && b[0] <= fTop) { const t = (a[0] - fTop) / (a[0] - b[0]); out.push(a.map((v, k) => v + (b[k] - v) * t)); }
    }
    return out;
  };
  const tube = (pts0, rad) => {
    const pts = trim(pts0);
    const q = pts.map(([f, g, h]) => {
      const s = S.sec(f), dg = g, dh = h - s.cz, L = Math.hypot(dg, dh) || 1;
      const pull = inset + (rad + 0.006) / G.m;
      return toShell([f, g - (dg / L) * pull, h - (dh / L) * pull]);
    });
    for (let i = 1; i < q.length; i++) K.rod(q[i - 1], q[i], rad, 'post', 0.2, T.frame, 0, 6);
    frame.push(q);
  };
  const post = findPart(doc.parts, 'windscreen centre post');
  if (post) tube(post.pts, 0.016);
  const arch = findPart(doc.parts, 'door arch'), sill = findPart(doc.parts, 'sill hoop');
  for (const s of [1, -1]) {
    if (arch) tube(arch.pts.map(([f, g, h]) => [f, g * s, h]), 0.018);
    if (sill) tube(sill.pts.map(([f, g, h]) => [f, g * s, h]), 0.014);
  }
  // The aft rim of the glass: the frame the bubble is bonded to, all the way round at the station the
  // glazed regions end at.
  const rim = [];
  for (let k = 0; k <= 40; k++) rim.push(toShell(S.pt(fG, -Math.PI / 2 + (k / 40) * TAU, inset + 0.022 / G.m)));
  const rimUp = rim.filter((q) => q[2] > zF + 0.02);
  for (let i = 1; i < rim.length; i++) if (rim[i - 1][2] > zF + 0.02 && rim[i][2] > zF + 0.02) K.rod(rim[i - 1], rim[i], 0.02, 'post', 0.15, T.frame, 0, 6);
  // The screws the bubble is held to the frame by, a hand's width apart round the rim.
  for (let k = 0; k < 80; k++) {
    const a = -Math.PI / 2 + ((k + 0.5) / 80) * TAU, q = toShell(S.pt(fG + 0.004, a, inset + 0.024 / G.m));
    if (q[2] < zF + 0.03) continue;
    const n = inward(fG, a), r = norm(cross(n, [0, 1, 0]));
    K.obox(add(q, mul(n, 0.018)), r, [0, 1, 0], n, 0.005, 0.005, 0.003, 'post', 0.4, T.buckle);
  }
  frame.push(rimUp);
  return { faces, frame, wins };
}

// ── THE GLASS ────────────────────────────────────────────────────────────────
//
// ⚠ ONE PANE PER EXTERIOR GLASS FACET, off the same loft and the same `regions` the room's aperture
// is cut from. emitLoft skins ring k of one station to ring k of the next, `sides` round, and the
// fore cap fans the first ring to the apex; each of those glazed faces is a pane here, at the skin's
// own vertices pulled 5 mm in toward the section's middle (the apex pulled 5 mm aft). So the film
// sits just inside the drawn glass and outboard of every frame tube, which stand off the lining.
// The door windows are two more, faceted along the loft in (f, a) so each piece is small enough to be
// flat: the exterior has no door glass to copy (its door bays are painted shell), so these follow the
// room's own cut.
function bubbleGlass(G, wins) {
  const { cab, toShell, m } = G;
  const n = cab.sides || 14, d = 0.005 / m;
  const st = cab.stations.slice().sort((a, b) => b.f - a.f);
  const ring = (s) => Array.from({ length: n }, (_, k) => {
    const a = (k / n) * TAU, g = Math.cos(a) * s.rg, h = Math.sin(a) * s.rv, L = Math.hypot(g, h) || 1;
    return toShell([s.f, g - (g / L) * d, s.cz + h - (h / L) * d]);
  });
  const glazedAt = new Set();
  for (const rg of cab.regions || []) if (rg.role === 'glass') for (const f of rg.at) glazedAt.add(f);
  const panes = [];
  for (let i = 0; i < st.length - 1; i++) {
    if (!glazedAt.has(st[i].f)) continue;
    const A = ring(st[i]), B = ring(st[i + 1]);
    for (let k = 0; k < n; k++) { const j = (k + 1) % n; panes.push([A[k], A[j], B[j], B[k]]); }
  }
  const cap = cab.capFore;
  if (cap && cap.kind === 'apex' && cap.role === 'glass') {
    const apex = toShell([cap.at[0] - d, cap.at[1], cap.at[2]]), A = ring(st[0]);
    for (let k = 0; k < n; k++) panes.push([apex, A[k], A[(k + 1) % n]]);
  }
  const bubble = panes.length;
  // The door windows: 3 x 3 facets each, 2.2 cm in, just inside the reveal's outer edge.
  const S = G.S, di = 0.022 / m;
  for (const w of wins || []) {
    const [f0, a0] = w[0], [f1, a1] = w[2];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const fa = f0 + (f1 - f0) * i / 3, fb = f0 + (f1 - f0) * (i + 1) / 3, aa = a0 + (a1 - a0) * j / 3, ab = a0 + (a1 - a0) * (j + 1) / 3;
      panes.push([[fa, aa], [fb, aa], [fb, ab], [fa, ab]].map(([f, a]) => toShell(S.pt(f, a, di))));
    }
  }
  panes.bubble = bubble;
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

// Sutherland-Hodgman against one plane: keep `s(q) >= 0`.
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
function dragonflyShell(P, live, push, rich) {
  const D = P.dragonfly;
  for (const f of D.faces) push([{ p: f.p, n: f.n }], f.tone, f.k, false, f.rgb, f.emis || 0);
  seats(P, push);
  if (rich) dragonflyFit(P, live, push);
}

// ── THE CONTROLS, WHERE THEY ARE ─────────────────────────────────────────────
// One place says where each thing you can grab is, and both the drawing and the hotspots read it.
const CYC = { base: [0, 0.26, 0], len: 0.62, lean: 0.20 };        // base is off the floor, z added
// ⚠ ON THE TUNNEL, BETWEEN THE SEATS: in a cabin this round the pilot sits 0.29 m off the centreline,
// and a lever beside the seat on the outboard side of the tunnel would be inside the tunnel. So the
// collective hinges on the tunnel's top, at the pilot's left hand, which is also where an R22's is.
const TUNNEL = { hw: 0.075, h: 0.20 };
const COLL = { pivotY: -0.26, len: 0.50, rise: 0.05 };
const readings = (live) => {
  const L = live || {};
  return {
    L,
    pitch: num(L.pitch), bank: num(L.bank), hdg: num(L.hdg),
    ias: Math.max(0, num(L.ias)), vne: Math.max(40, num(L.vne, 90)),
    alt: Math.max(0, num(L.alt)), vsi: num(L.vsi),
    rpm: clamp(num(L.rpm), 0, 1.1), thr: clamp(num(L.throttle), 0, 1),
    fuel: clamp(num(L.fuel, 1), 0, 1), hull: clamp(num(L.hull, 1), 0, 1),
    temp: clamp(num(L.oilTemp, 0.55), 0, 1),
    powered: L.powered !== false,
    ail: clamp(num(L.stickX), -1, 1), elev: clamp(num(L.stickY), -1, 1), rud: clamp(num(L.rudder), -1, 1),
    land: !!L.landingLight, dome: !!L.dome, hour: num(L.hour, 12),
  };
};
// The cyclic: a stick from a boot on the floor, leaning with the disc. Returns the base and grip.
function cyclicAt(P, R) {
  const base = [CYC.base[0], CYC.base[1], P.dragonfly.zF + 0.05];
  const dir = norm([R.ail * 0.34, -CYC.lean + R.elev * 0.30, 1]);
  const top = add(base, mul(dir, CYC.len));
  return { base, top, dir };
}
// The collective: a lever hinged at the seat's front-left corner, raised by the collective (live
// `throttle` in this sim). Returns the pivot, the end of the lever and its direction.
function collectiveAt(P, R) {
  const pivot = [P.xCentre + 0.02, COLL.pivotY, P.dragonfly.zF + TUNNEL.h + COLL.rise];
  const ang = 0.10 + R.thr * 0.36;                          // radians up from horizontal: ~6° to 27°
  const dir = [0, Math.cos(ang), Math.sin(ang)];
  return { pivot, end: add(pivot, mul(dir, COLL.len)), dir, ang };
}
// The pod, and the switch row along the bottom of it.
const POD = { hw: 0.30, hh: 0.14, rake: 0.42 };
function podPanel(K, P) {
  const o = [P.xCentre * 0.45, P.dashY, P.dashZ];
  return K.panel(o, [1, 0, 0], [0, Math.sin(POD.rake), Math.cos(POD.rake)]);
}
const SW = { v: -0.118, u0: 0.02, pitch: 0.036, ids: ['master', 'clutch', 'land', 'nav', 'strobe', 'dome'] };
function switchOn(id, R) {
  if (id === 'master') return R.powered;
  if (id === 'clutch') return R.powered && R.rpm > 0.2;
  if (id === 'land') return R.land;
  if (id === 'dome') return R.dome && R.powered;
  return R.powered;
}

export function dragonflyHotspots(P, live) {
  const R = readings(live), Pn = podPanel(makeKit(() => {}), P), out = [];
  SW.ids.forEach((id, i) => { if (id !== 'clutch') out.push({ id: 'ck:' + id, p: Pn.pt(SW.u0 + i * SW.pitch, SW.v, 0.01), r: 0.014, kind: 'click' }); });
  out.push({ id: 'yoke', p: add(cyclicAt(P, R).top, [0, 0, 0.06]), r: 0.07, kind: 'yoke' });
  const c = collectiveAt(P, R);
  out.push({ id: 'throttle', p: add(c.end, mul(c.dir, 0.06)), r: 0.04, kind: 'throttle' });
  return out;
}

// ── THE SEATS: a form-fitted upholstered bucket each, in the round, with a four-point harness ──
function seats(P, push) {
  const K = makeKit(push, false);
  for (const cx of [0, 2 * P.xCentre]) bucket(K, P, cx);
}
function bucket(K, P, cx) {
  const h = P.seatHalf, [y0, y1] = P.seatY, sz = P.seatZ, zF = P.dragonfly.zF;
  // The fibreglass base down to the floor, and the cushion on it with a front roll.
  K.box(cx - h + 0.08, y0 + 0.02, zF, cx + h - 0.08, y1 - 0.06, sz - 0.10, 'seat', -0.25, T.seatShell);
  K.box(cx - h, y0, sz - 0.10, cx + h, y1 - 0.04, sz, 'seat', 0.08, T.cloth);
  K.rod([cx - h + 0.01, y1 - 0.04, sz - 0.05], [cx + h - 0.01, y1 - 0.04, sz - 0.05], 0.05, 'seat', 0.02, T.cloth, 0, 8);
  // Bolsters on the cushion, which is what "form-fitted" looks like from the next seat.
  for (const s of [-1, 1]) K.box(cx + s * h - s * 0.05, y0, sz, cx + s * h, y1 - 0.06, sz + 0.06, 'seat', 0.05, T.clothDk);
  // Tuck-and-roll across the cushion between the bolsters.
  for (let i = 0; i < 5; i++) { const y = lerp(y0 + 0.05, y1 - 0.10, i / 4); K.rod([cx - h + 0.05, y, sz + 0.004], [cx + h - 0.05, y, sz + 0.004], 0.012, 'seat', 0.02, T.cloth, 0, 6, false); }
  // The back, leaning 12°, with its own bolsters and piping down the seams.
  const lean = 0.14, bb = [cx, y0 - 0.02, sz], up = [0, -Math.sin(lean), Math.cos(lean)], fw = [0, Math.cos(lean), Math.sin(lean)];
  const bH = P.backZ - sz;
  const bc = add(bb, mul(up, bH / 2));
  K.obox(add(bc, mul(fw, -0.05)), [1, 0, 0], up, fw, h, bH / 2, 0.05, 'seat', -0.06, T.cloth);
  for (const s of [-1, 1]) K.obox(add(add(bc, mul(fw, 0.005)), [s * (h - 0.03), 0, 0]), [1, 0, 0], up, fw, 0.03, bH / 2, 0.05, 'seat', -0.02, T.clothDk);
  for (const s of [-0.09, 0.09]) K.obox(add(bc, [s, 0, 0]), [1, 0, 0], up, fw, 0.004, bH / 2 - 0.02, 0.002, 'seat', -0.3, T.piping);
  // The harness: two shoulder straps from the bulkhead over the top of the back, two lap belts, and
  // a rotary buckle at the belly. Blue, because every aftermarket harness is.
  // And up the back.
  for (let i = 0; i < 6; i++) { const c = add(add(bb, mul(up, lerp(0.08, bH - 0.06, i / 5))), mul(fw, 0.002)); K.rod(add(c, [-h + 0.06, 0, 0]), add(c, [h - 0.06, 0, 0]), 0.012, 'seat', -0.04, T.cloth, 0, 6, false); }
  const top = add(bb, mul(up, bH)), buck = [cx, y1 - 0.14, sz + 0.14];
  for (const s of [-1, 1]) {
    K.rod(add(top, [s * 0.08, 0.02, 0.0]), add(buck, [s * 0.02, 0, 0.03]), 0.012, 'seat', 0.05, T.harness, 0, 4);
    K.rod([cx + s * (h - 0.02), y0 + 0.06, sz + 0.02], add(buck, [s * 0.02, 0, -0.01]), 0.012, 'seat', 0.05, T.harness, 0, 4);
  }
  K.rod(add(buck, [0, -0.006, 0]), add(buck, [0, 0.008, 0]), 0.03, 'seat', 0.2, T.buckle, 0, 10);
}

// ── THE FIT-OUT ──────────────────────────────────────────────────────────────
export function dragonflyFit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live);
  const zF = P.dragonfly.zF, xC = P.xCentre;
  const night = R.hour < 6.5 || R.hour > 19.5;
  const lit = R.powered;
  // Instrument lighting: the dials' own emission is the kit's; at night with the master on, the
  // lettering glows a little more.
  const glow = lit && night ? 1 : 0.35;

  // ── THE POD: the vacu-formed panel on a post off the front of the tunnel ──
  const Pn = podPanel(K, P);
  const { hw, hh } = POD;
  // The post and the pod's body behind the face.
  const base = [Pn.pt(0, -hh, 0)[0], P.chinY - 0.10, zF + 0.20];
  K.rod([base[0], P.chinY - 0.10, zF + 0.02], Pn.pt(0, -hh * 0.6, -0.08), 0.035, 'dash', -0.1, T.panelDk, 0, 8);
  K.obox(Pn.pt(0, 0, -0.06), Pn.r, Pn.u, Pn.n, hw + 0.015, hh + 0.015, 0.06, 'dash', -0.1, T.panel);
  Pn.rect(-hw, -hh, hw, hh, T.panel, 0, 0.0);
  // The visor over the top, which is what the floods hide under.
  K.obox(Pn.pt(0, hh + 0.01, 0.04), Pn.r, norm([0, 0.35, 0.94]), norm([0, -0.94, 0.35]), hw + 0.02, 0.012, 0.05, 'dash', 0.25, T.panel);
  // Top row, left to right: ASI, altimeter, the dual tacho (the big one, in front of you), VSI.
  const r1 = 0.058, R1 = 0.046, R2 = 0.036;
  Pn.dial(-0.21, r1, R1, clamp(R.ias / (R.vne * 1.15), 0, 1), { ticks: 12, major: 3, arcs: [[0.10, 0.70, C.green], [0.70, 0.86, C.amber]], red: 0.87, name: 'KTS' });
  Pn.dial(-0.10, r1, R1, (R.alt % 1000) / 1000, { a0: Math.PI / 2, sweep: TAU, ticks: 10, major: 1, frac2: (R.alt % 10000) / 10000, name: 'ALT' });
  // The dual tacho: engine and rotor on one face, their needles married when the clutch is in and
  // split when it is not — which is the one instrument a helicopter pilot actually watches.
  const eng = clamp(R.rpm / 1.1, 0, 1), rot = clamp((R.powered ? R.rpm * 0.985 : R.rpm * 0.6) / 1.1, 0, 1);
  Pn.dial(0.03, r1 - 0.004, 0.056, eng, { ticks: 11, major: 1, frac2: rot, needle: C.lampOn, needle2: C.amber, arcs: [[0.80, 0.93, C.green]], red: 0.95, name: 'RPM' });
  Pn.dial(0.16, r1, R1, clamp(0.5 + R.vsi / 3000, 0, 1), { a0: Math.PI, sweep: Math.PI * 1.8, ticks: 8, major: 2, name: 'VSI' });
  // The low rotor rpm light, "prominently affixed": big, red, over the tacho.
  const lowRpm = R.powered && R.rpm < 0.9;
  Pn.lamp(0.03, 0.128, 0.034, 0.008, lowRpm || !!R.L.stall, LOW_RPM);
  // Lettered on the lens, as the real one is: under it is the tacho's bezel.
  Pn.text('LOW RPM', 0.03, 0.128, 0.009, LENS_INK, 0, 0.007);
  // Bottom row: slip and bank, coolant temperature, fuel, the hourmeter, and the warning lamps.
  const r2 = -0.052;
  slipBank(Pn, -0.21, r2, R2, R.bank, R.rud);
  Pn.dial(-0.115, r2, R2 * 0.85, R.temp, { a0: Math.PI * 1.1, sweep: Math.PI * 1.2, ticks: 6, major: 3, arcs: [[0.25, 0.75, C.green]], red: 0.85, name: 'TEMP' });
  Pn.rect(-0.07, r2 - 0.035, -0.03, r2 + 0.035, T.panelDk, 0, 0.002);
  Pn.bar(-0.05, r2 - 0.03, r2 + 0.03, 0.009, R.fuel, R.fuel < 0.15 ? C.red : C.green, 'FUEL');
  // Magnetic compass (a whisky compass, on the visor) and the hourmeter: tenths off the day's clock.
  const hrs = String(Math.floor(318 + R.hour * 10) % 10000).padStart(4, '0');
  Pn.digits(0.10, r2 + 0.012, 0.018, hrs, lit ? C.lcd : C.lampOff);
  [[R.fuel < 0.15, C.amber], [R.hull < 0.3, C.red], [R.temp > 0.85, C.red], [switchOn('clutch', R), C.green]]
    .forEach(([on, rgb], i) => {
      const a = 0.005 + (i % 2) * 0.05, b = r2 + 0.02 - (i >> 1) * 0.03;
      Pn.lamp(a, b, 0.017, 0.009, lit && on, rgb);
      // The rows are too close for a name under each, so it goes on the lens.
      Pn.fitText(['FUEL', 'WARN', 'TEMP', 'CLTCH'][i], a, b, 0.03, 0.008, LENS_INK, 0, 0.007);
    });
  // Polished bezels: a half-round ring round each top-row dial, so they catch the bubble's light.
  for (const [u, v, rr] of [[-0.21, r1, R1], [-0.10, r1, R1], [0.03, r1 - 0.004, 0.056], [0.16, r1, R1]]) Pn.torus(u, v, rr * 1.12, rr * 1.30, C.chrome, 0, 0.002, 24, 3);
  for (const [u, rr] of [[-0.21, R2], [-0.115, R2 * 0.85]]) Pn.torus(u, r2, rr * 1.10, rr * 1.26, C.chrome, 0, 0.002, 20, 3);
  // The dial glass glints.
  for (const [u, v, rr] of [[-0.21, r1, R1], [-0.10, r1, R1], [0.03, r1, 0.056], [0.16, r1, R1]]) {
    Pn.annulus(u, v, rr * 0.55, rr * 0.92, DIAL_GLINT, 0.4, 0.012, 6, 1.9, 2.7);
  }
  // Night: the lettering glows. A thin band of emissive white under each top-row dial.
  if (glow > 0.5) for (const u of [-0.21, -0.10, 0.03, 0.16]) Pn.rect(u - 0.02, r1 - 0.07, u + 0.02, r1 - 0.066, [255, 240, 210], 0.8, 0.004);
  // The switch row along the bottom: master, clutch (the electric clutch the rotor is engaged
  // with), landing light, nav, strobe, dome. Each placard white, each bat up when on.
  SW.ids.forEach((id, i) => {
    const u = SW.u0 + i * SW.pitch, on = switchOn(id, R);
    // The name goes where the placard was: under the switch is the pod's bottom edge.
    Pn.fitText(SW_NAME[id], u, SW.v + 0.0205, 0.034, 0.007, [214, 212, 204], lit && night ? 0.5 : 0.1, 0.002);
    Pn.toggle(u, SW.v, on);
    if (id === 'clutch') Pn.rect(u - 0.013, SW.v - 0.016, u + 0.013, SW.v + 0.016, [200, 40, 30], 0, 0.001);
  });
  // The ignition: two magneto-style switches for the Rotax's dual ignition, and the key.
  for (const [u, on, s] of [[-0.24, R.powered, 'MAG 1'], [-0.20, R.powered, 'MAG 2']]) { Pn.toggle(u, SW.v, on); Pn.fitText(s, u, SW.v + 0.0205, 0.036, 0.007, [214, 212, 204], 0.1, 0.002); }
  Pn.disc(-0.14, SW.v, 0.014, C.chrome, 0.1, 0.003, 12);
  Pn.stud(-0.14, SW.v, 0.004, 0.011, 0.012, T.buckle, 0, 0.003);
  Pn.text('START', -0.14, SW.v + 0.0205, 0.007, [214, 212, 204], 0.1, 0.002);
  // The circuit breakers: a row of push-pull buttons along the right-hand edge, above the switches.
  for (let i = 0; i < 6; i++) { const u = 0.07 + i * 0.03; Pn.disc(u, -0.087, 0.007, C.black, 0, 0.002, 8); Pn.knob(u, -0.087, 0.0045, 0.010, i === 5 && R.hull < 0.3 ? C.white : [40, 42, 46], 0); }
  // ── THE RADIO: a COM and a transponder in a sub-panel hung under the pod, where the kit's "room for
  // avionics" is. The COM shows a real tower frequency; the squawk is 1200, VFR.
  const Rp = K.panel(Pn.pt(-0.07, -hh - 0.085, 0.02), Pn.r, Pn.u);
  K.obox(Pn.pt(-0.07, -hh - 0.085, -0.03), Pn.r, Pn.u, Pn.n, 0.19, 0.075, 0.05, 'dash', -0.12, T.panelDk);
  Rp.rect(-0.18, -0.068, 0.18, 0.068, T.panel, 0, 0.0);
  Rp.rect(-0.17, 0.004, 0.17, 0.060, [20, 21, 24], 0, 0.002);
  Rp.digits(-0.155, 0.015, 0.03, '122', lit ? C.lcd : C.lampOff);
  Rp.digits(-0.075, 0.015, 0.03, '80', lit ? C.lcd : C.lampOff);
  Rp.rect(-0.084, 0.015, -0.080, 0.019, lit ? C.lcd : C.lampOff, lit ? 0.95 : 0, 0.006);
  Rp.digits(0.03, 0.015, 0.03, '1200', lit ? C.amber : C.lampOff);
  Rp.rect(-0.17, -0.060, 0.17, -0.004, [20, 21, 24], 0, 0.002);
  for (const u of [-0.14, -0.10, 0.06, 0.11, 0.15]) { Rp.knob(u, -0.032, 0.012, 0.014, C.black, 0); Rp.knob(u, -0.032, 0.007, 0.022, [60, 62, 66], 0); }
  Rp.lamp(-0.03, -0.032, 0.008, 0.005, lit, C.green, 'PWR');
  Rp.lamp(0.02, -0.032, 0.008, 0.005, lit && R.alt > 50, C.amber, 'REPLY');
  // The whisky compass on the visor, its card turning under the lubber line.
  const vc = Pn.pt(0.03, hh + 0.035, 0.06);
  K.obox(vc, Pn.r, [0, 0, 1], [0, -1, 0], 0.035, 0.028, 0.030, 'dash', 0.1, C.black);
  const Cp = K.panel(add(vc, [0, -0.031, 0]), [1, 0, 0], [0, 0, 1]);
  Cp.compass(0, 0, 0.022, R.hdg);
  Cp.disc(0, 0, 0.026, BOWL, 0.3, 0.004, 14);

  // ── THE CYCLIC ──
  const cy = cyclicAt(P, R);
  // The boot on the floor: a rubber cone, and a shadow round its foot.
  for (let i = 0; i < 3; i++) K.rod(add(cy.base, mul(cy.dir, i * 0.03)), add(cy.base, mul(cy.dir, (i + 1) * 0.03)), 0.06 - i * 0.015, 'dash', -0.1, T.boot, 0, 10, i === 2);
  contactShadow(K, [cy.base[0], cy.base[1], zF], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.09, 0.09);
  K.rod(cy.base, cy.top, 0.013, 'dash', 0.1, T.steel, 0, 8);
  // The grip: canted forward, with the radio trigger on the front and a trim-less top (the Mini has
  // no cyclic trim), a friction ring at the root.
  const gdir = norm(add(cy.dir, [0, 0.25, 0]));
  const gTop = add(cy.top, mul(gdir, 0.12));
  K.rod(cy.top, gTop, 0.021, 'dash', 0.05, T.grip, 0, 10);
  K.rod(add(cy.top, mul(gdir, -0.01)), add(cy.top, mul(gdir, 0.012)), 0.025, 'dash', 0.1, C.black, 0, 10);
  K.obox(add(cy.top, add(mul(gdir, 0.06), [0, 0.022, 0])), [1, 0, 0], gdir, [0, 1, 0], 0.006, 0.014, 0.006, 'dash', 0.2, C.black);
  K.obox(add(gTop, mul(gdir, 0.004)), [1, 0, 0], [0, 1, 0], gdir, 0.008, 0.008, 0.004, 'dash', 0.3, C.red, 0.25);

  // ── THE COLLECTIVE, with the twist-grip throttle ──
  const co = collectiveAt(P, R);
  // The friction lock at the pivot: a housing, and the knurled knob on its outboard end.
  const cxp = co.pivot[0];
  K.box(cxp - 0.03, COLL.pivotY - 0.06, zF + TUNNEL.h, cxp + 0.03, COLL.pivotY + 0.05, co.pivot[2] - 0.015, 'dash', -0.15, T.panelDk);
  K.rod([cxp - 0.03, COLL.pivotY, co.pivot[2]], [cxp - 0.06, COLL.pivotY, co.pivot[2]], 0.018, 'dash', 0.1, C.black, 0, 10);
  K.rod([cxp + 0.03, COLL.pivotY, co.pivot[2]], [cxp - 0.03, COLL.pivotY, co.pivot[2]], 0.012, 'dash', 0.1, T.steel, 0, 8);
  K.rod(co.pivot, co.end, 0.014, 'dash', 0.1, T.steel, 0, 8);
  // The twist grip: a sleeve over the lever's last 13 cm that turns with the throttle — the engine
  // rpm, in this sim, since the governor's job is done by the hand. An index stripe goes round with it.
  const gs = add(co.end, mul(co.dir, 0.01)), ge = add(co.end, mul(co.dir, 0.14));
  K.rod(gs, ge, 0.022, 'dash', 0.05, T.grip, 0, 12);
  for (const t of [0.03, 0.06, 0.09, 0.12]) K.rod(add(co.end, mul(co.dir, t)), add(co.end, mul(co.dir, t + 0.006)), 0.0235, 'dash', 0, C.black, 0, 12, false);
  const twist = -0.2 + clamp(R.rpm, 0, 1.1) * 1.9;             // radians about the lever, toward the outside
  const side = norm(cross(co.dir, [0, 0, 1])), upL = cross(side, co.dir);
  const mark = add(mul(side, Math.sin(twist)), mul(upL, Math.cos(twist)));
  K.obox(add(add(gs, mul(co.dir, 0.065)), mul(mark, 0.0225)), co.dir, cross(mark, co.dir), mark, 0.06, 0.004, 0.0015, 'dash', 0.3, C.white, 0.2);
  // The start button and the idle-release on the collective head.
  K.obox(add(co.end, add(mul(co.dir, -0.02), [0, 0, 0.026])), [1, 0, 0], co.dir, [0, 0, 1], 0.012, 0.018, 0.010, 'dash', 0.1, C.black);
  K.obox(add(co.end, add(mul(co.dir, -0.02), [0, 0, 0.037])), [1, 0, 0], co.dir, [0, 0, 1], 0.006, 0.006, 0.003, 'dash', 0.3, C.red, 0.1);

  // ── THE PEDALS: the pilot's pair, each with the lip that cups the foot well ──
  const pv = 0.60, pz = zF + 0.30;
  for (const [dx, press] of [[-0.09, Math.max(0, -R.rud)], [0.09, Math.max(0, R.rud)]]) {
    pedal(K, [dx, pv, pz], 0.045, 0.22, press, T.steel);
    const t = 0.30 + press * 0.45, foot = add([dx, pv, pz], mul([0, Math.sin(t), -Math.cos(t)], 0.22));
    K.box(dx - 0.045, foot[1] - 0.025, foot[2] - 0.075, dx + 0.045, foot[1] - 0.012, foot[2] - 0.050, 'dash', 0.1, T.steel);
    contactShadow(K, [dx, foot[1], zF], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.035, 0.07);
  }
  // The pedal cross-shaft, on its bearings.
  K.rod([-0.14, pv, pz], [0.14, pv, pz], 0.012, 'dash', 0.1, T.steel, 0, 6);
  for (const s of [-0.13, 0.13]) K.box(s - 0.02, pv - 0.02, zF, s + 0.02, pv + 0.02, pz - 0.01, 'dash', -0.1, T.panelDk);
  // The passenger's foot rest: an angled plate.
  const px = 2 * xC;
  K.obox([px, 0.55, zF + 0.09], [1, 0, 0], norm([0, -0.6, 0.8]), norm([0, 0.8, 0.6]), 0.11, 0.10, 0.010, 'dash', 0.05, T.steel);
  // A grab handle for the passenger, on the tunnel.
  K.rod([xC - 0.06, 0.30, zF + 0.20], [xC - 0.06, 0.30, zF + 0.34], 0.012, 'dash', 0.1, C.black, 0, 6);
  K.rod([xC - 0.06, 0.30, zF + 0.34], [xC - 0.06, 0.46, zF + 0.34], 0.012, 'dash', 0.1, C.black, 0, 6);
  K.rod([xC - 0.06, 0.46, zF + 0.34], [xC - 0.06, 0.46, zF + 0.20], 0.012, 'dash', 0.1, C.black, 0, 6);

  // ── THE HEADSETS: hung on hooks on the tunnel's aft end, a cord each to a jack ──
  for (const s of [-1, 1]) {
    const hx = xC + s * 0.10, hy = P.dragonfly.Y(P.dragonfly.fB) + 0.05, hz = zF + 1.02;
    K.torus([hx, hy, hz], [1, 0, 0], [0, 0, 1], 0.08, 0.009, 9, 'dash', 0.05, C.black, 0, 0, Math.PI);
    for (const e of [-1, 1]) K.rod([hx + e * 0.08, hy - 0.02, hz - 0.03], [hx + e * 0.08, hy + 0.02, hz - 0.03], 0.036, 'dash', 0.05, s > 0 ? [60, 62, 66] : [110, 112, 50], 0, 10);
  }

  // ── THE DOME LIGHT over the tunnel, and the landing-light tell-tale ──
  const dome = [xC, -0.25, P.roof - 0.03];
  K.rod(add(dome, [0, 0, -0.012]), add(dome, [0, 0, 0.02]), 0.05, 'hdr', 0.1, R.dome && lit ? [255, 238, 200] : [70, 70, 66], R.dome && lit ? 1 : 0, 12);

  hotspotHalo(K, dragonflyHotspots(P, live), live);
}

// Slip and bank: the ball in its curved tube under a turn needle. The needle leans with the bank; the
// ball sits out of the middle by how much rudder is not being fed.
function slipBank(Pn, ca, cb, R, bank, rud) {
  Pn.annulus(ca, cb, R, R * 1.16, C.bezel, 0.04, 0.004, 22);
  Pn.disc(ca, cb, R, C.face, 0, 0.001, 22);
  for (const d of [-1, 1]) Pn.spoke(ca, cb, Math.PI / 2 + d * 0.35, R * 0.78, R * 0.95, R * 0.04, C.white, 0.5, 0.004);
  Pn.spoke(ca, cb, Math.PI / 2 - clamp(bank, -40, 40) * Math.PI / 180, -R * 0.1, R * 0.8, R * 0.05, C.lampOn, 0.9, 0.007);
  // The tube: a shallow arc of dark segments, and the ball.
  for (let i = 0; i < 8; i++) {
    const t0 = -Math.PI / 2 - 0.45 + (i / 8) * 0.9, t1 = t0 + 0.9 / 8;
    Pn.plate([[ca + Math.cos(t0) * R * 0.52, cb + 0.55 * R + Math.sin(t0) * R * 0.52], [ca + Math.cos(t1) * R * 0.52, cb + 0.55 * R + Math.sin(t1) * R * 0.52],
      [ca + Math.cos(t1) * R * 0.72, cb + 0.55 * R + Math.sin(t1) * R * 0.72], [ca + Math.cos(t0) * R * 0.72, cb + 0.55 * R + Math.sin(t0) * R * 0.72]], [40, 44, 40], 0.1, 0.004);
  }
  const slip = clamp(-bank / 40 - rud * 0.3, -1, 1), tb = -Math.PI / 2 + slip * 0.38;
  Pn.disc(ca + Math.cos(tb) * R * 0.62, cb + 0.55 * R + Math.sin(tb) * R * 0.62, R * 0.09, C.black, 0, 0.006, 8);
}
