// THE VIPER'S COCKPIT: the pilot's station of an AH-64 Apache, as geometry.
//
// The Viper is an Apache reimagined, and its exterior says so in one line: a chined gunship hull
// whose canopy IS the hull. There is no bubble set on top of a fuselage. Stations 2 to 5 of the
// `fuselage` loft carry a greenhouse profile over their upper half, and the facets of that profile
// are glazed. So the room is that loft seen from inside, and the windows are those facets.
//
// You sit where an Apache pilot sits: in the REAR seat, raised about half a metre over the
// co-pilot/gunner, who is ahead of you and below. You look forward over his head and the top of his
// glareshield. Between you is the transparent blast shield. In front of you are two MPDs with the
// EUFD between them, the three standby instruments with the whet compass on the glareshield above,
// the keyboard unit low on the left and the armament panel low on the right. The power levers are
// on the left console ahead of the collective, the cyclic is between your knees with the weapons
// grip on it, and the IHADSS helmet display unit hangs on its stowage hook on the right console.
//
// Sources read for the layout (2026-09-24):
//   https://www.gamepressure.com/digital-combat-simulator-ah-64d/cockpits-and-controls/z7fa00
//     (pilot front panel left to right: KU, MPD, EUFD, MPD, armament panel, IHADSS adjust; standby
//      ADI/ASI/ALT with the compass on top; cyclic and collective grip functions)
//   https://ah-64d-apache-official-project.github.io/cockpit.html
//     (left console: power levers with OFF/IDLE/FLY detents, lights and start panel; fire panel on
//      the front panel; right console carries the HDU stowage)
//   https://en.wikipedia.org/wiki/Boeing_AH-64_Apache
//     (tandem crew, pilot behind and ABOVE the CPG, transparent blast shield between them;
//      58 ft 2 in / 17.73 m long with the rotors turning)
//
// ── ⚠ THE ROOM IS THE EXTERIOR'S LOFT, NEVER A SECOND DESCRIPTION OF IT ──────
//
// Same rule the Drake runs on. Every wall below is a facet of `MESH_ROWS.heli_armed`'s `fuselage`
// loft, rebuilt with the loft's own ring function (emitLoft's `super` branch plus its `upper`
// greenhouse profile), pushed in by one wall thickness. A cell is a window exactly when the
// exterior's own `regions` say that facet is glass, so the hole inside and the glass outside are the
// same polygon: there's no second window shape anywhere in this file.
//
// ⚠ ONE SCALE, DERIVED: metres per model unit is the AH-64's 17.73 m (rotors turning) over the
// model's own length from the main rotor's forward tip to the tail rotor's aft tip, both read off
// the row. That comes to about 7.85. Everything about the HULL goes through it; everything about a
// PERSON (a seat, a grip, a 6×8 inch MPD) is honest metres, because a pilot doesn't scale with a
// fuselage.
//
// ⚠ WHAT THE EXTERIOR CAN'T CARRY. The loft has ten sides, so the cockpit's walls are ten flat
// plates round the section. That's right for an Apache (it is flat-plate everywhere) but it means
// the chine is a hard corner at elbow-minus-a-bit rather than the real canopy sill. The Viper's
// glazing runs down to that chine, lower than an Apache's does, so the side consoles sit behind the
// bottom of the side panes. From outside you'd see the consoles through the glass. That's the
// honest consequence of the exterior, and it's left that way rather than growing a sill the
// exterior doesn't have.
//
// Pure, like the rest of the interior: no clock, no camera, no DOM, apart from the eased switch
// throw that interior-cockpit-kit.js keeps for every cockpit. `live` arrives as an argument.
import { makeKit, C, clamp, pedal, SHINY, PANE, TEXTURE } from './interior-kit.js';
import { eased, pressPulse, hotspotHalo, contactShadow } from './interior-cockpit-kit.js';
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

// ── THE CABIN ANCHOR ─────────────────────────────────────────────────────────
//
// What the mesh file would carry in a `cabin` block (mesh_drake.json has one). Kept here so the
// mesh bake doesn't have to move while other rows are being edited; it NAMES the loft and states
// the eye and the two decks, and restates no shape. `pilotEye` is [f, g, h] in model units: half
// way along the pilot's full-glazed bay (0.29 to 0.14), on the centreline, a hand under the crown.
export const VIPER_CABIN = {
  hull: 'fuselage',
  realLengthM: 17.73,            // AH-64D, rotors turning (Wikipedia)
  pilotEye: [0.215, 0, 0.16],
  back: 0.04, front: 0.60,       // the aft and forward exterior stations the room runs between
  shieldF: 0.33,                 // the blast shield: in the frame bay whose sides are solid outside too
  cpgF: 0.43,                    // the gunner's eye station
  wallM: 0.045,                  // the skin plus the lining, metres
  eyeOverDeckM: 1.05,            // a seated eye over the deck it sits on
  cpgDropM: 0.48,                // how much lower the gunner's deck is than yours
};

// ── COLOURS ──────────────────────────────────────────────────────────────────
// An Apache is grey-black inside and every panel is black with white lettering that's edge-lit at
// night. Those greys aren't in any colourway, so they are stated.
const V = {
  wall: [58, 62, 64], wallAlt: [52, 56, 58], wallDk: [44, 47, 49], floor: [38, 40, 40], tread: [52, 54, 52],
  panel: [46, 50, 53], panelDk: [30, 33, 35], console: [40, 43, 45], key: [96, 100, 102],
  grip: [30, 32, 36], steel: [104, 110, 120], chrome: [150, 158, 170], rim: [70, 76, 80],
  frame: [20, 21, 23], reveal: [70, 74, 76],
  seat: [66, 70, 58], seatDk: [48, 52, 42], armour: [86, 88, 80], belt: [86, 94, 70], buckle: [168, 172, 178],
  ink: [214, 218, 212], nvis: [150, 226, 170], mpdGlass: [10, 14, 13], mpdBezel: [32, 34, 36],
  hazardY: [226, 186, 30], hazardK: [18, 18, 18], lens: [40, 60, 70], visor: [30, 34, 40],
};
SHINY.set(V.frame, { spec: 0.35, pow: 30 });
SHINY.set(V.mpdGlass, { spec: 0.7, pow: 60 });
SHINY.set(V.buckle, { spec: 0.8, pow: 24, ramp: [[70, 72, 78], [236, 238, 242]], glint: 0.3, albedo: [230, 232, 236], envK: 0.7 });
SHINY.set(V.visor, { spec: 0.9, pow: 70 });
SHINY.set(V.lens, { spec: 0.9, pow: 80 });
SHINY.set(V.chrome, { spec: 0.8, pow: 22 }); SHINY.set(V.steel, { spec: 0.45, pow: 18 });
// Surface texture. An Apache's panels and lining are painted metal and moulded panel, its decks are
// rubber matting, its seat is fabric over an armoured bucket. Lamps, screens, dials and glass are
// deliberately left out: they're lit or read, not surfaces.
for (const k of ['wall', 'wallAlt', 'panel', 'panelDk', 'console', 'reveal', 'mpdBezel']) TEXTURE.set(V[k], 'paint');
for (const k of ['wallDk', 'frame', 'armour']) TEXTURE.set(V[k], 'cast');
for (const k of ['floor', 'tread', 'grip']) TEXTURE.set(V[k], 'rubber');
for (const k of ['seat', 'seatDk', 'belt']) TEXTURE.set(V[k], 'fabric');
for (const k of ['steel', 'chrome', 'buckle']) TEXTURE.set(V[k], 'brushed');
TEXTURE.set(V.key, 'plastic');
// A soft sheen laid over each MPD's glass: a translucent pane, so you can still read through it.
const MPD_GLINT = [210, 230, 240];
PANE.set(MPD_GLINT, 0.08);
// The canopy frame colour, by identity: the gate tells a frame from a cut wall with it.
export const VIPER_FRAME = V.frame;

// ── THE LOFT, EVALUATED ──────────────────────────────────────────────────────
const findPart = (parts, name) => {
  for (const p of parts || []) {
    if (p.name === name) return p;
    const q = findPart(p.parts, name);
    if (q) return q;
  }
  return null;
};

// emitLoft's ring, as (g, h) pairs: the `super` section with its `upper` greenhouse profile.
function rawRing(p, s) {
  const n = p.sides, [eg, et, eb] = p.exp || [1, 1, 1], UP = p.upper;
  const bot = s.keel == null ? s.rvB : s.rvB + s.keel, o = [];
  for (let k = 0; k < n; k++) {
    if (s.upper && UP && k < UP.length) { o.push([UP[k][0] * s.rg, s.cz + UP[k][1] * s.rvT]); continue; }
    const a = k / n * TAU, cs = Math.cos(a), sn = Math.sin(a);
    o.push([Math.sign(cs) * Math.pow(Math.abs(cs), eg) * s.rg, s.cz + (sn >= 0 ? Math.pow(sn, et) * s.rvT : -Math.pow(-sn, eb) * bot)]);
  }
  return o;
}

// A convex ring pushed in by `d`: each corner moves along the mitre of its two edges' inward normals,
// so every plate moves in square to itself by exactly `d` and stays parallel to the skin outside.
function insetRing(r, d) {
  const n = r.length, en = [];
  for (let i = 0; i < n; i++) {
    const a = r[i], b = r[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    en.push([-dy / l, dx / l]);       // counter-clockwise ring: the inside is on the left
  }
  return r.map((q, i) => {
    const n1 = en[(i + n - 1) % n], n2 = en[i], s = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    return [q[0] + d * (n1[0] + n2[0]) / s, q[1] + d * (n1[1] + n2[1]) / s];
  });
}

// ── 3-D CLIPPING ─────────────────────────────────────────────────────────────
function clipHalf(poly, s) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], sa = s(a), sb = s(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) { const t = sa / (sa - sb); out.push(a.map((v, k) => v + (b[k] - v) * t)); }
  }
  return out;
}

// ── THE PROFILE ──────────────────────────────────────────────────────────────
let CACHE = null;
export function viperProfile(doc = MESH_ROWS.heli_armed) {
  if (CACHE && CACHE.doc === doc) return CACHE.P;
  const hull = doc && findPart(doc.parts, VIPER_CABIN.hull);
  if (!hull) return null;
  const cab = VIPER_CABIN;

  // One scale. The main rotor's forward tip and the tail rotor's aft tip are both authored on the row.
  const mr = doc.rotors[0], tr = doc.rotors[1];
  const lengthU = (mr.at[0] + mr.r) - (tr.at[0] - tr.r);
  const m = cab.realLengthM / lengthU;

  const [fE, gE, hE] = cab.pilotEye;
  const X = (g) => (g - gE) * m, Y = (f) => (f - fE) * m, Z = (h) => (h - hE) * m;
  const d = cab.wallM / m;
  const sts = hull.stations.slice().sort((a, b) => b.f - a.f);
  const rings = sts.map((s) => rawRing(hull, s));
  const ringAt = (f) => {
    for (let i = 0; i < sts.length - 1; i++) {
      const A = sts[i], B = sts[i + 1];
      if (f <= A.f + 1e-9 && f >= B.f - 1e-9) {
        const t = (A.f - f) / (A.f - B.f);
        return { r: rings[i].map((q, k) => [lerp(q[0], rings[i + 1][k][0], t), lerp(q[1], rings[i + 1][k][1], t)]), cz: lerp(A.cz, B.cz, t) };
      }
    }
    return null;
  };
  // Which exterior bay a room cell sits in, and whether the exterior glazed that facet.
  const bayOf = (fHi) => { let best = null; for (const s of sts) if (s.f >= fHi - 1e-9 && (!best || s.f < best.f)) best = s; return best; };
  const glassAt = (fHi, k) => {
    const A = bayOf(fHi);
    if (!A) return false;
    for (const rg of hull.regions || []) {
      if (!rg.at.includes(A.f)) continue;
      if (rg.k === 'all' || rg.k == null || rg.k.includes(k)) return rg.role === 'glass';
    }
    return false;
  };

  const zP = -cab.eyeOverDeckM, zG = zP - cab.cpgDropM;
  const V3 = (f, q) => [X(q[0]), Y(f), Z(q[1])];
  const geo = { m, X, Y, Z, d, ringAt, glassAt, zP, zG, V3, hull, sts, n: hull.sides };
  const room = buildRoom(geo);

  const P = {
    label: 'Viper pilot station (AH-64)',
    xCentre: 0,
    // ── a person, in metres ──
    dashY: 0.60, dashZ: -0.23, headerZ: 0.45, pillarW: 0.04,
    seatZ: -0.72, seatHalf: 0.24, seatY: [-0.40, 0.06], backZ: -0.10,
    seats: 1, centrePost: 0,
    fit: 'viper', craft: 'viper',
    normalLit: true,
    floods: [
      { p: [-0.30, 0.56, -0.30], r: 0.40 }, { p: [0.30, 0.56, -0.30], r: 0.40 },
      { p: [-0.72, -0.05, -0.42], r: 0.32 }, { p: [0.72, -0.05, -0.42], r: 0.32 },
    ],
    room: viperShell,
    viper: { ...geo, room: room.faces, rimPts: room.rimPts, deckW: room.deckW },
  };
  // The static fit-out is built once too, then replayed each frame with the room.
  P.viper.fixed = recordFixed(P);

  // Measure what was built (room and fixed fit), as the Drake does: a bound sampled off its own
  // grid comes out a rounding error inside the thing it bounds.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const f of [...room.faces, ...P.viper.fixed]) for (const q of f.p) {
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]);
    y1 = Math.max(y1, q[1]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]);
  }
  P.halfW = Math.max(-x0, x1) + 1e-6;
  P.floor = z0 - 1e-6; P.roof = z1 + 1e-6; P.front = y1 + 1e-6; P.back = y0 - 1e-6;
  // Every roof bay over the room is glazed outside (regions k1-3 run the whole canopy), so the
  // headlining is glass from end to end.
  P.roofGlass = [P.back, P.front];

  // The side-window rays aim through the middle of the pilot's own side pane (facet k0 of the bay
  // the eye is in), extended out to the bound, so a pane that moves takes its test with it.
  const fA = 0.29, fB = 0.14, ra = ringAt(fA).r, rb = ringAt(fB).r;
  const ia = insetRing(ra, d), ib = insetRing(rb, d);
  const mid = mul(add(add(V3(fA, ia[0]), V3(fA, ia[1])), add(V3(fB, ib[0]), V3(fB, ib[1]))), 0.25);
  const t = P.halfW / mid[0];
  const wy = mid[1] * t, wz = mid[2] * t;
  P.winY = [wy - 0.08, wy + 0.08]; P.winZ = [wz - 0.08, wz + 0.08];
  P.hotspots = function (live) { return viperHotspots(this, live); };
  // ── THE GLASS: one flat plate per glazed facet of the loft, and the blast shield ──
  // Each pane is the exterior facet itself, on the exterior's own stations (not the room's, which add
  // the shield station), pulled 3 mm in from the skin so it sits in the aperture, outboard of the
  // frames. Drawn by the renderer as film after the room; never part of shellFaces.
  {
    const skin = 0.003 / m, panes = [];
    const exF = sts.map((s) => s.f).filter((f) => f >= cab.back - 1e-9 && f <= cab.front + 1e-9);
    for (let i = 0; i < exF.length - 1; i++) {
      const fHi = exF[i], fLo = exF[i + 1];
      const ra = insetRing(ringAt(fHi).r, skin), rb = insetRing(ringAt(fLo).r, skin);
      for (let k = 0; k < hull.sides; k++) {
        if (!glassAt(fHi, k)) continue;
        const j = (k + 1) % hull.sides;
        panes.push([V3(fLo, rb[k]), V3(fLo, rb[j]), V3(fHi, ra[j]), V3(fHi, ra[k])]);
      }
    }
    // The blast shield: the section at the shield station, from the top of your glareshield up to
    // the canopy, a hand inside the frame. Transparent acrylic, so it is glass too.
    const shield = clipHalf(insetRing(ringAt(cab.shieldF).r, d + 0.03 / m).map((q) => V3(cab.shieldF, q)), (p) => p[2] - P.dashZ);
    if (shield.length >= 3) panes.push(shield);
    P.glass = panes;
  }
  CACHE = { doc, P };
  return P;
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
function buildRoom(G) {
  const { ringAt, glassAt, zP, zG, V3, d, Y, Z, n } = G;
  const cab = VIPER_CABIN;
  const faces = [], rimPts = [];
  const put = (p, nn, tone, k, rgb, emis) => faces.push({ p, n: nn, tone, k, rgb, emis: emis || 0 });
  // The room's stations: the exterior's own, plus the blast shield, where the two decks meet.
  const fs = [...new Set([cab.back, cab.front, cab.shieldF, ...G.sts.map((s) => s.f)])]
    .filter((f) => f >= cab.back - 1e-9 && f <= cab.front + 1e-9).sort((a, b) => a - b);
  const extF = new Set(G.sts.map((s) => s.f));
  const R = fs.map((f) => { const r = ringAt(f); return { f, cz: r.cz, raw: r.r, ins: insetRing(r.r, d), rod: insetRing(r.r, d + 0.02 / G.m) }; });
  const deckAt = (f) => (f < cab.shieldF - 1e-9 ? zP : zG);
  const inwardOf = (poly, f, cz) => {
    let nn = norm(cross(sub(poly[1], poly[0]), sub(poly[2], poly[0])));
    const c = [0, Y(f), Z(cz)], p0 = poly[0];
    if (dot(nn, sub(c, p0)) < 0) nn = mul(nn, -1);
    return nn;
  };

  // ── THE WALLS: every solid facet, split in two triangles (a lofted quad needn't be planar) ──
  for (let i = 0; i < R.length - 1; i++) {
    const A = R[i], B = R[i + 1];                // A aft, B forward
    const zF = deckAt((A.f + B.f) / 2);
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      if (glassAt(B.f, k)) continue;             // the exterior glazed this facet: it's a window
      const q = [V3(A.f, A.ins[k]), V3(A.f, A.ins[j]), V3(B.f, B.ins[j]), V3(B.f, B.ins[k])];
      const cz = (A.cz + B.cz) / 2, fm = (A.f + B.f) / 2;
      const up = k < n / 2;                      // the upper half is the grey lining, the lower the darker
      // ⚠ EACH FACET IS A GRID OF LINING PANELS, not one sheet: an Apache's walls are Dzus-fastened
      // trim panels, and a plate the size of a door reads as a cardboard box from the seat. The grid
      // lies ON the facet (bilinear in its own corners), so it moves with the exterior.
      const bl = (u, v) => { const a = add(q[0], mul(sub(q[1], q[0]), u)), b = add(q[3], mul(sub(q[2], q[3]), u)); return add(a, mul(sub(b, a), v)); };
      const NU = 4, NV = Math.max(2, Math.round(Math.hypot(...sub(q[3], q[0])) / 0.2));
      for (let a = 0; a < NU; a++) for (let b = 0; b < NV; b++) {
        const c = [bl(a / NU, b / NV), bl((a + 1) / NU, b / NV), bl((a + 1) / NU, (b + 1) / NV), bl(a / NU, (b + 1) / NV)];
        const alt = (a + b) & 1;
        for (const tri of [[c[0], c[1], c[2]], [c[0], c[2], c[3]]]) {
          const poly = clipHalf(tri, (p) => p[2] - zF);
          if (poly.length < 3) continue;
          put(poly, inwardOf(tri, fm, cz), 'pil', (up ? -0.05 : -0.2) + (alt ? 0.04 : 0), up ? (alt ? V.wall : V.wallAlt) : V.wallDk);
        }
        // A fastener at each panel's corner.
        const sc = bl((a + 0.1) / NU, (b + 0.1) / NV), nn = inwardOf(q.slice(0, 3), fm, cz);
        if (sc[2] > zF + 0.01) {
          const du = norm(sub(q[1], q[0])), dv = norm(cross(nn, du)), r = 0.006, o = add(sc, mul(nn, 0.002));
          put([add(o, mul(du, r)), add(o, mul(dv, r)), add(o, mul(du, -r)), add(o, mul(dv, -r))], nn, 'pil', 0.2, V.steel);
        }
      }
    }
  }

  // ── THE WINDOWS: a reveal through the skin round every glazed cell, and a frame on every edge ──
  // A reveal is only where glass meets something that isn't glass (wall, or the end of the room);
  // a frame is on every exterior facet edge a pane touches, which is what makes flat-plate glazing.
  const glass = (i, k) => i >= 0 && i < R.length - 1 && glassAt(R[i + 1].f, ((k % n) + n) % n);
  const edges = [];
  for (let i = 0; i < R.length - 1; i++) {
    for (let k = 0; k < n; k++) {
      if (!glass(i, k)) continue;
      const A = R[i], B = R[i + 1], j = (k + 1) % n;
      // Four edges: along k (aft station), along k (fore station), the k line, the j line.
      const cand = [
        { a: [i, k], b: [i, j], other: glass(i - 1, k), station: A.f },
        { a: [i + 1, k], b: [i + 1, j], other: glass(i + 1, k), station: B.f },
        { a: [i, k], b: [i + 1, k], other: glass(i, k - 1), station: null },
        { a: [i, j], b: [i + 1, j], other: glass(i, k + 1), station: null },
      ];
      for (const e of cand) {
        const cellC = mul(add(add(V3(A.f, A.ins[k]), V3(A.f, A.ins[j])), add(V3(B.f, B.ins[j]), V3(B.f, B.ins[k]))), 0.25);
        if (!e.other) {
          // The reveal: the wall's own thickness from the lining out to the glass.
          const [ia, ka] = e.a, [ib, kb] = e.b;
          const i0 = V3(R[ia].f, R[ia].ins[ka]), i1 = V3(R[ib].f, R[ib].ins[kb]);
          const o0 = V3(R[ia].f, R[ia].raw[ka]), o1 = V3(R[ib].f, R[ib].raw[kb]);
          const midE = mul(add(i0, i1), 0.5), edgeIn = norm(sub(midE, mul(add(o0, o1), 0.5)));
          let rn = sub(cellC, midE); rn = norm(sub(rn, mul(edgeIn, dot(rn, edgeIn))));
          put([i0, i1, o1, o0], rn, 'pil', 0.12, V.reveal);
          rimPts.push(o0, o1);
        }
        // Frame on every exterior edge a pane touches; not across a pane at the shield station.
        if (e.station != null && !extF.has(e.station) && e.other) continue;
        if (e.other) {
          // Between two panes the frame is a web through the skin: the flat-plate canopy's mullion.
          const [ia, ka] = e.a, [ib, kb] = e.b;
          const i0 = V3(R[ia].f, R[ia].ins[ka]), i1 = V3(R[ib].f, R[ib].ins[kb]);
          const o0 = V3(R[ia].f, R[ia].raw[ka]), o1 = V3(R[ib].f, R[ib].raw[kb]);
          put([i0, i1, o1, o0], norm(cross(sub(i1, i0), sub(o0, i0))), 'pil', 0.05, V.frame);
          rimPts.push(o0, o1);
        }
        const key = [e.a.join(','), e.b.join(',')].sort().join('|');
        if (!edges.includes(key)) edges.push(key);
      }
    }
  }
  const K = makeKit((fs2, tone, k, fwd, rgb, emis) => { for (const f of fs2) put(f.p, f.n, tone, k, rgb, emis); }, false);
  for (const key of edges) {
    const [a, b] = key.split('|').map((s) => s.split(',').map(Number));
    const pa = V3(R[a[0]].f, R[a[0]].rod[a[1]]), pb = V3(R[b[0]].f, R[b[0]].rod[b[1]]);
    K.rod(pa, pb, 0.013, 'pil', 0.15, V.frame, 0, 8);
  }

  // ── THE DECKS: yours, raised, and the gunner's, half a metre down, with the step between ──
  const halfAt = (f, z) => {
    const r = insetRing(ringAt(f).r, d);
    let w = 0;
    for (let k = 0; k < r.length; k++) {
      const a = V3(f, r[k]), b = V3(f, r[(k + 1) % r.length]);
      if ((a[2] - z) * (b[2] - z) > 0) continue;
      const t = (z - a[2]) / ((b[2] - a[2]) || 1e-9);
      w = Math.max(w, Math.abs(lerp(a[0], b[0], t)));
    }
    return w;
  };
  const deckW = [];
  const deck = (f0, f1, z, rgb) => {
    const N = Math.max(2, Math.ceil((f1 - f0) / 0.03));
    for (let s = 0; s < N; s++) {
      const fa = lerp(f0, f1, s / N), fb = lerp(f0, f1, (s + 1) / N);
      const wa = halfAt(fa, z), wb = halfAt(fb, z);
      deckW.push([Y(fa), z, wa]);
      put([[-wa, Y(fa), z], [wa, Y(fa), z], [wb, Y(fb), z], [-wb, Y(fb), z]], [0, 0, 1], 'floor', -0.25, rgb);
    }
  };
  deck(cab.back, cab.shieldF, zP, V.floor);
  deck(cab.shieldF, cab.front, zG, V.floor);
  const ws = halfAt(cab.shieldF, zP), ys = Y(cab.shieldF);
  put([[ws, ys, zG], [-ws, ys, zG], [-ws, ys, zP], [ws, ys, zP]], [0, 1, 0], 'post', -0.15, V.wallDk);
  // Non-slip treads down the middle of your deck, where the boots go.
  for (const x of [-0.16, 0.16]) put([[x - 0.07, Y(cab.back) + 0.35, zP + 0.002], [x + 0.07, Y(cab.back) + 0.35, zP + 0.002], [x + 0.07, ys - 0.05, zP + 0.002], [x - 0.07, ys - 0.05, zP + 0.002]], [0, 0, 1], 'floor', -0.2, V.tread);

  // ── THE ENDS: the bulkhead behind you and the nose bulkhead in front of the gunner ──
  const cap = (f, zF, nY) => {
    const r = insetRing(ringAt(f).r, d).map((q) => V3(f, q));
    const poly = clipHalf(r, (p) => p[2] - zF);
    if (poly.length >= 3) put(poly, [0, nY, 0], 'post', nY > 0 ? -0.12 : -0.22, V.wallDk);
  };
  cap(cab.back, zP, 1);
  cap(cab.front, zG, -1);
  return { faces, rimPts, deckW };
}

// ── THE SHELL, AS interior-shell.js CALLS IT ─────────────────────────────────
function viperShell(P, live, push, rich) {
  const Vp = P.viper;
  for (const f of Vp.room) push([f], f.tone, f.k, false, f.rgb, f.emis);
  if (!rich) return;
  for (const f of Vp.fixed) push([f], f.tone, f.k, f.fwd, f.rgb, f.emis, f.mat);
  viperFit(P, live, push);
}

// ── SHARED PLACES ────────────────────────────────────────────────────────────
// Where everything you can touch is, stated once, read by both the drawing and the hotspots.
const PANEL = { o: [0, 0.64, -0.50], u: norm([0, 0.26, 0.97]) };
const LCON = { x0: -0.93, x1: -0.60, y0: -0.36, y1: 0.46, top: -0.54 };
const RCON = { x0: 0.60, x1: 0.93, y0: -0.36, y1: 0.46, top: -0.54 };
const LSW = { o: [-0.765, -0.14, LCON.top + 0.001] };      // the lights/start panel on the left console
// ⚠ EVERY ONE IS CLICKABLE. The fourth was NAV, drawn and never wired, and the sim has no nav circuit;
// it is the panel lights now, which it has.
const LSW_IDS = [['ck:master', -0.06], ['ck:land', -0.02], ['ck:dome', 0.02], ['ck:panel', 0.06]];
const QUAD = { x: -0.74, y: 0.26, z: LCON.top };             // the power lever quadrant, ahead of the collective
const COLL = { pivot: [-0.36, -0.34, -0.86], len: 0.60 };
const CYC = { base: [0, 0.30, -1.05] };
const PED = { y: 0.60, z: -0.78, x: 0.17 };
const ARM = { a: 0.30, b: -0.13 };                           // the armament panel's master arm, on the front panel

const panelKit = (K) => K.panel(PANEL.o, [1, 0, 0], PANEL.u, 'dash', 0.3);
const collectiveGrip = (thr) => {
  // The collective hinges beside your hip and rises as you pull it. 0 to 1 is 0° to 16° up.
  const a = (2 + clamp(thr, 0, 1) * 16) * Math.PI / 180;
  return add(COLL.pivot, [0, Math.cos(a) * COLL.len, Math.sin(a) * COLL.len]);
};
const cyclicTip = (ail, elev) => [CYC.base[0] + ail * 0.08, CYC.base[1] + elev * 0.09, -0.52];

function viperHotspots(P, live) {
  const L = live || {};
  const K = makeKit(() => {});
  const Sp = K.panel(LSW.o, [1, 0, 0], [0, 1, 0]);
  const Pn = panelKit(K);
  const out = LSW_IDS.map(([id, b]) => ({ id, p: Sp.pt(0, b, 0.01), r: 0.014, kind: 'click' }));
  out.push({ id: 'ck:arm', p: Pn.pt(ARM.a, ARM.b, 0.01), r: 0.016, kind: 'click' });
  const tip = cyclicTip(clamp(num(L.stickX), -1, 1), clamp(num(L.stickY), -1, 1));
  out.push({ id: 'yoke', p: add(tip, [0, 0.01, 0.07]), r: 0.07, kind: 'yoke' });
  out.push({ id: 'throttle', p: collectiveGrip(num(L.throttle)), r: 0.04, kind: 'throttle' });
  out.push({ id: 'rudderL', p: [-PED.x, PED.y, PED.z - 0.16], r: 0.05, kind: 'rudder' });
  out.push({ id: 'rudderR', p: [PED.x, PED.y, PED.z - 0.16], r: 0.05, kind: 'rudder' });
  return out;
}

// ── THE FIXED FIT-OUT: everything that doesn't move, built once ───────────────
function recordFixed(P) {
  const list = [];
  const push = (fs, tone, k, fwd, rgb, emis, mat) => { for (const f of fs) list.push({ p: f.p, n: f.n, tone, k, fwd: fwd ? 1 : 0, rgb, emis: emis || 0, mat }); };
  const K = makeKit(push);
  const zP = P.viper.zP, zG = P.viper.zG, Y = P.viper.Y;

  // ── THE SIDE CONSOLES, one down each wall from behind the seat to the panel ──
  for (const c of [LCON, RCON]) {
    const inner = c === LCON ? c.x1 : c.x0, outer = c === LCON ? c.x0 : c.x1;
    K.box(Math.min(inner, outer), c.y0, zP, Math.max(inner, outer), c.y1, c.top - 0.004, 'dash', -0.1, V.console);
    const Pc = K.panel([(inner + outer) / 2, (c.y0 + c.y1) / 2, c.top], [1, 0, 0], [0, 1, 0], 'dash', 0.2);
    Pc.rect(-0.16, -0.41, 0.16, 0.41, V.panelDk, 0, 0.001);
    // Dzus-fastened panels, each with its placard lines: the rows of black plates an Apache console is.
    for (const [b0, b1] of [[-0.40, -0.26], [-0.25, -0.05], [-0.04, 0.12], [0.13, 0.40]]) {
      Pc.rect(-0.155, b0, 0.155, b1, V.panel, 0, 0.002);
      for (const [a, b] of [[-0.145, b0 + 0.008], [0.145, b0 + 0.008], [-0.145, b1 - 0.008], [0.145, b1 - 0.008]]) Pc.disc(a, b, 0.004, V.steel, 0.1, 0.003, 6);
    }
    // The console's inboard face, and a lip along its top edge.
    K.rod([inner, c.y0, c.top], [inner, c.y1, c.top], 0.008, 'dash', 0.2, V.frame, 0, 5);
  }
  // Right console: the communications panel, and the IHADSS helmet display unit on its stowage hook.
  {
    const Pr = K.panel([(RCON.x0 + RCON.x1) / 2, (RCON.y0 + RCON.y1) / 2, RCON.top], [1, 0, 0], [0, 1, 0], 'dash', 0.2);
    for (let i = 0; i < 6; i++) Pr.knob(-0.11 + (i % 3) * 0.11, 0.28 + (i >> 1 & 1) * 0, 0.011, 0.012, C.black, 0);
    for (let i = 0; i < 3; i++) Pr.knob(-0.11 + i * 0.11, 0.20, 0.014, 0.016, C.black, 0);
    for (let i = 0; i < 8; i++) Pr.stud(-0.12 + (i % 4) * 0.08, 0.02 + (i >> 2) * 0.05, 0.012, 0.009, 0.006, [40, 42, 44], 0);
    // The circuit-breaker panel aft: rows of black collars with white bands, the pilot's fuse box.
    for (let r = 0; r < 5; r++) for (let c2 = 0; c2 < 9; c2++) {
      const a = -0.13 + c2 * 0.0325, b = -0.37 + r * 0.045;
      Pr.knob(a, b, 0.0065, 0.009, C.black, 0);
      Pr.rect(a - 0.009, b - 0.016, a + 0.009, b - 0.013, [200, 204, 200], 0.1, 0.003);
    }
    // The HDU: a monocle combiner on an arm, with its cable, parked on the hook aft.
    const hook = [0.72, -0.22, RCON.top + 0.02];
    K.rod([0.72, -0.22, RCON.top], hook, 0.006, 'dash', 0.1, V.steel, 0, 5);
    K.obox(add(hook, [0, 0, 0.03]), [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.02, 0.045, 0.018, 'dash', 0.2, V.visor, 0);
    K.obox(add(hook, [0, 0.05, 0.045]), [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.017, 0.017, 0.004, 'dash', 0.4, V.lens, 0.05);
    let prev = add(hook, [0, -0.05, 0.03]);
    for (let i = 1; i <= 5; i++) { const p = [0.72 - i * 0.012, -0.22 - i * 0.03, RCON.top + 0.02 + Math.sin(i * 0.8) * 0.01]; K.rod(prev, p, 0.005, 'dash', 0, C.black, 0, 4, false); prev = p; }
  }

  // ── THE PANEL: slab, glareshield, and the fixed parts of the instruments ──
  K.box(-0.60, 0.70, zP, 0.60, 0.95, -0.25, 'dash', -0.2, V.panel);
  K.box(-0.60, 0.58, zP, 0.60, 0.70, -0.76, 'dash', -0.25, V.panel);
  // The glareshield, with its lip overhanging the displays (the floods hang under it).
  K.box(-0.60, 0.55, -0.26, 0.60, 0.95, -0.23, 'dash', 0.3, V.panelDk);
  K.rod([-0.60, 0.55, -0.245], [0.60, 0.55, -0.245], 0.012, 'dash', 0.1, C.rubber, 0, 6);
  const Pn = panelKit(K);
  Pn.rect(-0.58, -0.25, 0.58, 0.23, V.panel, 0, 0.001);
  for (const sx of [-0.27, 0.27]) {
    Pn.rect(sx - 0.125, -0.125, sx + 0.125, 0.125, V.mpdBezel, 0, 0.003);
    // Six variable action buttons along each side of the screen, T1–T6 and B1–B6 top and bottom.
    for (let i = 0; i < 6; i++) {
      const u = sx - 0.075 + i * 0.03;
      Pn.stud(u, 0.112, 0.009, 0.007, 0.006, [60, 62, 64], 0, 0.003);
      Pn.stud(u, -0.112, 0.009, 0.007, 0.006, [60, 62, 64], 0, 0.003);
      Pn.stud(sx - 0.112, 0.075 - i * 0.03, 0.007, 0.009, 0.006, [60, 62, 64], 0, 0.003);
      Pn.stud(sx + 0.112, 0.075 - i * 0.03, 0.007, 0.009, 0.006, [60, 62, 64], 0, 0.003);
    }
    // The fixed action buttons along the bottom edge, and the brightness rocker.
    for (let i = 0; i < 6; i++) Pn.stud(sx - 0.075 + i * 0.03, -0.14, 0.010, 0.006, 0.005, [44, 46, 48], 0, 0.002);
  }
  // The keyboard unit: forty keys under a scratchpad, low on the left.
  Pn.rect(-0.56, -0.25, -0.16, -0.155, V.panelDk, 0, 0.002);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 12; c++) Pn.stud(-0.545 + c * 0.031, -0.235 + r * 0.023, 0.011, 0.008, 0.005, V.key, 0, 0.003);
  // The standby cluster's bezels between the displays; the dials themselves are live.
  Pn.rect(-0.14, -0.25, 0.14, -0.155, V.panelDk, 0, 0.002);
  // Rounded bezels round the three standby instruments, so each reads as a round-bodied gauge set
  // into the panel rather than a disc painted on it.
  for (const [a, b, r] of [[-0.065, 0.06, 0.036], [0.065, 0.06, 0.036], [0, -0.055, 0.045]]) Pn.torus(a, b, r * 1.16, r * 1.34, V.mpdBezel, 0, 0.002, 28, 4);
  // The fire panel along the top of the panel: ENG 1, APU and ENG 2 under guards.
  for (const a of [-0.07, 0, 0.07]) {
    Pn.rect(a - 0.024, 0.19, a + 0.024, 0.225, C.black, 0, 0.003);
  }
  // The whet compass on the glareshield, on its bracket.
  K.box(-0.035, 0.70, -0.23, 0.035, 0.76, -0.20, 'dash', 0.1, C.black);
  K.obox([0, 0.72, -0.17], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.03, 0.03, 0.03, 'dash', 0.2, V.panelDk, 0);
  // The boresight reticle unit on the right of the glareshield, the IHADSS's alignment reference.
  K.obox([0.36, 0.66, -0.205], [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.04, 0.025, 0.05, 'dash', 0.2, C.black, 0);
  K.obox([0.36, 0.605, -0.205], [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.018, 0.012, 0.003, 'dash', 0.6, V.lens, 0.1);

  // ── THE BLAST SHIELD'S FRAME: a post each side on the solid frame bay, and its sill ──
  // The shield itself is transparent and has no surface here, for the reason the windscreen has
  // none: it would write depth across the whole forward view.
  {
    const ys = Y(VIPER_CABIN.shieldF) + 0.01;
    for (const s of [-1, 1]) {
      K.box(s * 0.80, ys - 0.03, -0.26, s * 0.86, ys + 0.03, 0.10, 'pil', 0.2, V.frame);
      // The canopy jettison handle, yellow and black, on the right post.
      if (s > 0) for (let i = 0; i < 5; i++) K.box(0.785, ys - 0.02, -0.18 + i * 0.04, 0.80, ys + 0.02, -0.14 + i * 0.04, 'pil', 0.2, i & 1 ? V.hazardK : V.hazardY);
    }
    // The canopy latch on the right sill, which is the side the pilot's door hinges from.
    K.obox([0.84, -0.10, -0.46], [0, 1, 0], [0, 0, 1], [-1, 0, 0], 0.06, 0.012, 0.015, 'pil', 0.2, V.steel, 0);
  }

  // ── YOUR SEAT: the armoured crashworthy seat, in the round ──
  armouredSeat(K, 0, P.seatY, P.seatZ, zP, P.backZ);

  // ── THE GUNNER'S STATION, ahead and below: what you see over your glareshield ──
  {
    const yc = Y(VIPER_CABIN.cpgF), zs = zG + (P.seatZ - zP);
    armouredSeat(K, 0, [yc - 0.40, yc + 0.06], zs, zG, zs + (P.backZ - P.seatZ));
    // His consoles, his panel, and the TEDAC: the big display with a handgrip each side.
    for (const s of [-1, 1]) K.box(s * 0.55, yc - 0.30, zG, s * 0.80, yc + 0.80, zs + 0.18, 'dash', -0.1, V.console);
    const yP = yc + 0.86;
    K.box(-0.55, yP, zG, 0.55, yP + 0.25, zs + 0.40, 'dash', -0.2, V.panel);
    K.box(-0.55, yP - 0.08, zs + 0.40, 0.55, yP + 0.25, zs + 0.43, 'dash', 0.3, V.panelDk);
    K.obox([0, yP - 0.10, zs + 0.28], [1, 0, 0], norm([0, 0.3, 0.95]), norm([0, -0.95, 0.3]), 0.14, 0.11, 0.06, 'dash', 0.1, V.panelDk, 0);
    for (const s of [-1, 1]) K.rod([s * 0.16, yP - 0.14, zs + 0.24], [s * 0.19, yP - 0.18, zs + 0.34], 0.018, 'dash', 0.05, V.grip, 0, 6);
    // His side-stick cyclic on the right console and collective on the left: the Apache's CPG flies
    // from the side consoles because the TEDAC is where a centre stick would be.
    K.rod([0.66, yc + 0.20, zs + 0.18], [0.64, yc + 0.24, zs + 0.34], 0.014, 'dash', 0, C.black, 0, 6);
    K.rod([-0.62, yc - 0.20, zs + 0.18], [-0.62, yc + 0.25, zs + 0.24], 0.016, 'dash', 0, V.steel, 0, 6);
    contactShadow(K, [0, yc - 0.15, zG], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.30, 0.36);
  }

  // ── CONTACT SHADOWS on your deck and your console tops ──
  contactShadow(K, [0, (P.seatY[0] + P.seatY[1]) / 2 - 0.05, zP], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.30, 0.34);
  contactShadow(K, [CYC.base[0], CYC.base[1], zP], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.09, 0.09);
  contactShadow(K, [QUAD.x, QUAD.y, QUAD.z], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.07, 0.12);
  contactShadow(K, [0, 0.62, -0.23], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.08, 0.05);
  return list;
}

// An armoured crashworthy seat: bucket, reclined back, the side armour wings, a headrest and a
// five-point harness with its rotary buckle. `cx` its centreline, `sy` [aft, fore] of the cushion,
// `sz` the cushion top, `zF` the deck it stands on, `bz` the top of the backrest.
function armouredSeat(K, cx, sy, sz, zF, bz) {
  const hw = 0.24, [y0, y1] = sy;
  // The stroking frame under the bucket: four legs and the energy-attenuator tubes behind.
  for (const [x, y] of [[-0.18, y0 + 0.05], [0.18, y0 + 0.05], [-0.18, y1 - 0.06], [0.18, y1 - 0.06]]) K.rod([cx + x, y, zF], [cx + x, y, sz - 0.12], 0.014, 'seat', 0, V.steel, 0, 6);
  for (const s of [-1, 1]) K.rod([cx + s * 0.14, y0 - 0.14, zF], [cx + s * 0.14, y0 - 0.14, bz - 0.05], 0.022, 'seat', 0.05, V.steel, 0, 8);
  // Bucket pan and cushion.
  K.box(cx - hw, y0, sz - 0.12, cx + hw, y1, sz - 0.06, 'seat', 0, V.seatDk);
  K.box(cx - hw + 0.03, y0 + 0.02, sz - 0.06, cx + hw - 0.03, y1 - 0.01, sz, 'seat', 0.08, V.seat);
  // The back, reclined about 13°.
  const lean = 13 * Math.PI / 180, bh = (bz - sz) / Math.cos(lean);
  const bu = [0, -Math.sin(lean), Math.cos(lean)], bn = [0, Math.cos(lean), Math.sin(lean)];
  const bc = add([cx, y0 - 0.02, sz], mul(bu, bh / 2));
  K.obox(add(bc, mul(bn, -0.05)), [1, 0, 0], bu, bn, hw, bh / 2, 0.03, 'seat', -0.1, V.seatDk, 0);
  K.obox(add(bc, mul(bn, 0.01)), [1, 0, 0], bu, bn, hw - 0.04, bh / 2 - 0.02, 0.03, 'seat', 0.02, V.seat, 0);
  // The side armour wings, standing forward of the back at shoulder height.
  for (const s of [-1, 1]) {
    const c = add(add(bc, mul(bn, 0.03)), [s * (hw + 0.01), 0, 0.02]);
    K.obox(c, bn, bu, [s, 0, 0], 0.10, bh / 2 - 0.04, 0.012, 'seat', 0.05, V.armour, 0);
  }
  // Headrest, on the top of the armour.
  const top = add([cx, y0 - 0.02, sz], mul(bu, bh));
  K.obox(add(top, [0, -0.03, 0.10]), [1, 0, 0], bu, bn, 0.12, 0.09, 0.035, 'seat', 0.02, V.seat, 0);
  // The harness: two shoulder straps over the top of the back, two lap belts, a crotch strap, and
  // the rotary buckle where they meet.
  const buckle = [cx, y1 - 0.16, sz + 0.10];
  for (const s of [-1, 1]) {
    const sh = add(top, [s * 0.10, 0.03, -0.04]);
    K.rod(sh, add(buckle, [s * 0.03, 0, 0.03]), 0.012, 'seat', 0, V.belt, 0, 4);
    K.rod([cx + s * hw * 0.9, y0 + 0.06, sz + 0.02], add(buckle, [s * 0.03, 0, -0.01]), 0.012, 'seat', 0, V.belt, 0, 4);
  }
  K.rod([cx, y1 - 0.03, sz + 0.005], add(buckle, [0, 0, -0.03]), 0.011, 'seat', 0, V.belt, 0, 4);
  K.rod(add(buckle, [0, -0.012, 0]), add(buckle, [0, 0.012, 0]), 0.036, 'seat', 0.3, V.buckle, 0, 12);
  K.rod(add(buckle, [0, 0.012, 0]), add(buckle, [0, 0.02, 0]), 0.014, 'seat', 0.3, C.black, 0, 8);
}

// ── THE LIVE FIT-OUT: everything that moves or lights, rebuilt each frame ─────
export function viperFit(P, live, push) {
  const K = makeKit(push);
  const L = live || {};
  const zP = P.viper.zP;
  const pitch = num(L.pitch), bank = num(L.bank), hdg = num(L.hdg);
  const ias = Math.max(0, num(L.ias)), vne = Math.max(40, num(L.vne, 197));
  const alt = Math.max(0, num(L.alt)), vsi = num(L.vsi);
  const rpm = clamp(num(L.rpm, 1), 0, 1.1), thr = clamp(num(L.throttle), 0, 1);
  const fuel = clamp(num(L.fuel, 1), 0, 1), hull = clamp(num(L.hull, 1), 0, 1);
  const powered = L.powered !== false;
  const ail = clamp(num(L.stickX), -1, 1), elev = clamp(num(L.stickY), -1, 1), rud = clamp(num(L.rudder), -1, 1);
  const armed = !!(L.armed || L.weaponsArmed || L.gunsArmed);
  const missiles = clamp(Math.round(num(L.missiles, 16)), 0, 16);
  const hour = num(L.hour, 12);
  const night = hour < 6.5 || hour > 19.5 ? 1 : (hour < 7.5 ? 7.5 - hour : hour > 18.5 ? hour - 18.5 : 0);
  // The edge-lit lettering is the PANEL switch (cockpit.js 'ck:panel'); a view that sends no switch
  // state, a seat shot, lights it after dark.
  const panelOn = powered && (L.panelLight != null ? !!L.panelLight : night > 0.5);
  const lit = powered ? 0.25 + (panelOn ? Math.max(night, 0.4) * 0.7 : 0) : 0;
  const ink = panelOn && night > 0.3 ? V.nvis : V.ink;

  // ── THE FRONT PANEL ──
  const Pn = panelKit(K);
  // The two MPDs. ⚠ BRIGHT AND FULL, because they're read from 0.7 m at a glance: green symbology on
  // a lit black ground, filling the glass edge to edge, with the numbers big enough to read from the
  // seat. Left is the engine page (torque, rotor speed, fuel, the caution list); right is the flight
  // page (attitude, speed and height boxes, the heading tape, climb, and the weapon block).
  const G = [70, 236, 130], Gd = [30, 120, 70], BG = [6, 24, 14];
  const weapon = String(L.weapon || (missiles > 0 ? 'missile' : 'gun')).toLowerCase();
  const ammo = Math.max(0, Math.round(num(L.ammo, 1200)));
  const MW = 0.112;
  for (const [sx, page] of [[-0.27, 'eng'], [0.27, 'flt']]) {
    Pn.rect(sx - MW, -MW, sx + MW, MW, powered ? BG : V.mpdGlass, powered ? 0.85 : 0, 0.004);
    Pn.rect(sx - MW, -MW, sx + MW, MW, MPD_GLINT, 0, 0.0075);
    if (!powered) continue;
    // The page frame and its button legends round the edge, which is what makes it read as an MPD.
    const topN = ['TSD', 'FLT', 'WPN', 'FCR', 'COM', 'VID'], botN = ['DMS', 'ENG', 'FUEL', 'UTIL', 'A/C', 'MENU'];
    for (let i = 0; i < 6; i++) {
      const u = sx - 0.075 + i * 0.03;
      Pn.fitText(topN[i], u, 0.101, 0.022, 0.0065, i === 1 ? G : Gd, 0.9, 0.006);
      Pn.fitText(botN[i], u, -0.101, 0.022, 0.0065, i === 2 ? G : Gd, 0.9, 0.006);
    }
    if (page === 'eng') {
      const tq = clamp(thr * 0.9 + 0.1, 0, 1.2);
      const bars = [[-0.075, tq, 'tq', 'TQ1'], [-0.045, tq * 0.98, 'tq', 'TQ2'], [-0.005, rpm, 'nr', 'NR'], [0.025, rpm * 0.99, 'np', 'NP']];
      for (const [a, v, kind, nm] of bars) {
        Pn.fitText(nm, sx + a, 0.084, 0.024, 0.007, G, 0.9, 0.006);
        const bad = kind === 'tq' ? v > 1 : v < 0.95;
        Pn.rect(sx + a - 0.011, -0.07, sx + a + 0.011, 0.075, [14, 40, 24], 0.8, 0.005);
        const top = -0.068 + clamp(v / 1.2, 0, 1) * 0.14;
        Pn.rect(sx + a - 0.009, -0.068, sx + a + 0.009, top, bad ? (kind === 'tq' ? C.red : C.amber) : G, 0.95, 0.006);
        for (let t = 0; t <= 6; t++) Pn.rect(sx + a + 0.011, -0.068 + t * 0.0233 - 0.0006, sx + a + 0.015, -0.068 + t * 0.0233 + 0.0006, Gd, 0.9, 0.006);
      }
      Pn.rect(sx - 0.09, 0.0475, sx + 0.04, 0.0495, C.red, 0.9, 0.0065);          // the 100% line
      // Fuel, big, in the right column, and the caution list under it.
      Pn.digits(sx + 0.048, 0.045, 0.02, String(Math.round(fuel * 25)).padStart(2, ' '), fuel < 0.15 ? C.amber : G, false);
      Pn.bar(sx + 0.085, -0.07, 0.035, 0.008, fuel, fuel < 0.15 ? C.amber : G, 'FUEL');
      const cautions = [fuel < 0.15, hull < 0.6, hull < 0.35, rpm < 0.9];
      const cautionN = ['FUEL LOW', 'DAMAGE', 'HULL', 'NR LOW'];
      cautions.forEach((on, i) => {
        Pn.rect(sx + 0.048, -0.02 - i * 0.014, sx + 0.1, -0.012 - i * 0.014, on ? (i === 2 ? C.red : C.amber) : [18, 48, 30], on ? 1 : 0.7, 0.006);
        Pn.fitText(cautionN[i], sx + 0.074, -0.016 - i * 0.014, 0.048, 0.006, on ? [10, 10, 8] : Gd, on ? 0 : 0.9, 0.0075);
      });
      Pn.digits(sx - 0.085, -0.094, 0.016, String(Math.round(rpm * 101)).padStart(3, ' '), G, false);
    } else {
      // The heading tape along the top: ticks every 10° that slide as the nose turns, and the box.
      for (let i = -5; i <= 5; i++) {
        const a = sx + (i - (((hdg % 10) + 10) % 10) / 10) * 0.018;
        if (Math.abs(a - sx) < 0.095) Pn.rect(a - 0.0012, 0.078, a + 0.0012, 0.088 + (i % 3 === 0 ? 0.004 : 0), G, 0.95, 0.006);
      }
      Pn.digits(sx - 0.018, 0.06, 0.013, String(((Math.round(hdg) % 360) + 360) % 360).padStart(3, '0'), G, false);
      Pn.attitude(sx, -0.005, 0.058, pitch, bank);
      // Airspeed box on the left, height box on the right, the climb bar beside it.
      Pn.rect(sx - 0.108, -0.012, sx - 0.064, 0.016, [0, 0, 0], 0, 0.0055);
      Pn.digits(sx - 0.104, -0.008, 0.02, String(Math.round(ias)).padStart(3, ' '), G, false);
      Pn.fitText('KTS', sx - 0.086, 0.024, 0.03, 0.007, Gd, 0.9, 0.006);
      Pn.fitText('ALT', sx + 0.085, 0.024, 0.03, 0.007, Gd, 0.9, 0.006);
      Pn.rect(sx + 0.062, -0.012, sx + 0.108, 0.016, [0, 0, 0], 0, 0.0055);
      Pn.digits(sx + 0.066, -0.008, 0.02, String(Math.round(alt / 10) % 1000).padStart(3, ' '), G, false);
      Pn.bar(sx + 0.1, -0.075, -0.02, 0.004, clamp(0.5 + vsi / 4000, 0, 1), G, 'VSI');
      // The weapon block along the bottom: GUN / RKT / MSL with the live one boxed, and its count.
      [['gun', 0, 'GUN'], ['rocket', 1, 'RKT'], ['missile', 2, 'MSL']].forEach(([w, i, nm]) => {
        const u = sx - 0.09 + i * 0.03, sel = weapon.startsWith(w.slice(0, 3));
        Pn.rect(u, -0.09, u + 0.024, -0.078, sel ? (armed ? C.amber : G) : [18, 48, 30], sel ? 1 : 0.7, 0.006);
        Pn.fitText(nm, u + 0.012, -0.084, 0.02, 0.0065, sel ? [10, 10, 8] : Gd, sel ? 0 : 0.9, 0.0075);
      });
      Pn.digits(sx + 0.012, -0.094, 0.018, String(weapon.startsWith('gun') ? ammo : missiles).padStart(4, ' '), armed ? C.amber : G, false);
    }
  }
  // The EUFD above the standby cluster: fuel and rotor speed, and the master warning/caution lamps.
  Pn.rect(-0.13, 0.13, 0.13, 0.18, powered ? [6, 16, 10] : V.mpdGlass, powered ? 0.4 : 0, 0.003);
  if (powered) {
    Pn.digits(-0.12, 0.14, 0.028, String(Math.round(fuel * 100)).padStart(3, ' '), fuel < 0.15 ? C.amber : C.lcd, false);
    Pn.digits(0.03, 0.14, 0.028, String(Math.round(rpm * 101)).padStart(3, ' '), C.lcd, false);
    Pn.fitText('FUEL', -0.035, 0.148, 0.03, 0.007, C.lcd, 0.8, 0.004);
    Pn.fitText('NR', 0.11, 0.148, 0.03, 0.007, C.lcd, 0.8, 0.004);
  }
  Pn.lamp(-0.19, 0.20, 0.022, 0.012, powered && hull < 0.35, C.red, 'WARN');
  Pn.lamp(0.19, 0.20, 0.022, 0.012, powered && (fuel < 0.15 || hull < 0.6), C.amber, 'CAUTION');
  // The fire buttons light when their engine is burning; the hull is what the game has for that.
  // Lettered on the lens: the EUFD's placard is directly under them.
  for (const [a, nm] of [[-0.07, 'FIRE 1'], [0.07, 'FIRE 2'], [0, 'APU']]) {
    const on = a !== 0 && powered && hull < 0.2;
    Pn.lamp(a, 0.207, 0.018, 0.012, on, C.red);
    Pn.fitText(nm, a, 0.207, 0.03, 0.008, on ? [40, 6, 4] : [200, 120, 110], 0, 0.008);
  }
  // The standby cluster: airspeed and altimeter over the attitude indicator.
  Pn.dial(-0.065, 0.06, 0.036, clamp(ias / (vne * 1.1), 0, 1), { ticks: 12, major: 3, arcs: [[0.1, 0.82, C.green]], red: 0.91, name: 'KTS' });
  Pn.dial(0.065, 0.06, 0.036, (alt % 1000) / 1000, { a0: Math.PI / 2, sweep: TAU, ticks: 10, major: 1, frac2: (alt % 10000) / 10000, name: 'ALT' });
  Pn.attitude(0, -0.055, 0.045, pitch, bank);
  // The scratchpad over the keyboard unit.
  Pn.rect(-0.54, -0.152, -0.18, -0.13, powered ? [6, 16, 10] : V.mpdGlass, powered ? 0.3 : 0, 0.003);
  // Standby magnetic compass card, turning in its bowl on the glareshield.
  {
    const Cp = K.panel([0, 0.689, -0.17], [1, 0, 0], [0, 0, 1], 'dash', 0.2);
    Cp.compass(0, 0, 0.022, hdg);
  }
  // The armament panel: MASTER ARM, and a lamp for each Hellfire rail station.
  Pn.rect(ARM.a - 0.10, -0.25, ARM.a + 0.18, -0.155, V.panelDk, 0, 0.002);
  const fArm = eased('viper:arm', armed ? 1 : 0, 18) - pressPulse('viper:arm', armed) * 0.3;
  Pn.rect(ARM.a - 0.012, ARM.b - 0.02, ARM.a + 0.012, ARM.b + 0.02, C.black, 0, 0.003);
  K.rod(Pn.pt(ARM.a, ARM.b, 0.004), Pn.pt(ARM.a, ARM.b + (fArm * 2 - 1) * 0.013, 0.024), 0.003, 'dash', 0.2, V.chrome, 0, 5);
  Pn.lamp(ARM.a + 0.04, ARM.b, 0.012, 0.008, armed && powered, C.red, 'ARMED');
  Pn.fitText('ARM', ARM.a - 0.028, ARM.b, 0.018, 0.007, lit ? ink : [120, 124, 120], lit, 0.004);
  for (let i = 0; i < 16; i++) Pn.lamp(ARM.a + 0.075 + (i % 4) * 0.022, -0.18 - (i >> 2) * 0.016, 0.006, 0.005, powered && armed && i < missiles, C.amber);
  // The placards, edge-lit: a line of lettering under each group, lit when the panel is.
  // The right MPD's line stops short of MASTER ARM, which stands in it.
  for (const [a0, a1, b, nm] of [[-0.39, -0.15, -0.135, 'MPD L'], [0.17, 0.25, -0.135, 'MPD R'], [-0.13, 0.13, 0.185, 'EUFD'], [ARM.a - 0.09, ARM.a + 0.17, -0.245, 'ARMAMENT'], [-0.55, -0.17, -0.245, 'KEYBOARD']]) {
    Pn.fitText(nm, (a0 + a1) / 2, b, a1 - a0, 0.007, lit ? ink : [120, 124, 120], lit, 0.004);
  }

  // ── THE LEFT CONSOLE: lights and start panel, the power levers, the collective ──
  {
    const Sp = K.panel(LSW.o, [1, 0, 0], [0, 1, 0], 'dash', 0.2);
    const st = { 'ck:master': powered, 'ck:land': !!L.landingLight, 'ck:dome': !!L.dome, 'ck:panel': panelOn };
    const LSW_NAME = { 'ck:master': 'MASTER', 'ck:land': 'LAND', 'ck:dome': 'DOME', 'ck:panel': 'PANEL' };
    for (const [id, b] of LSW_IDS) {
      const on = !!st[id];
      const f = eased('viper:' + id, on ? 1 : 0, 18) - pressPulse('viper:' + id, on) * 0.3;
      Sp.rect(-0.012, b - 0.014, 0.012, b + 0.014, C.black, 0, 0.003);
      K.rod(Sp.pt(0, b, 0.004), Sp.pt((f * 2 - 1) * 0.012, b, 0.022), 0.0028, 'dash', 0.2, id === 'ck:master' ? C.red : V.chrome, 0, 5);
      Sp.fitText(LSW_NAME[id], 0.05, b, 0.04, 0.0065, lit ? ink : [120, 124, 120], lit, 0.003);
    }
    // The power lever quadrant: two levers in a gated slot, OFF, IDLE and FLY. The levers sit at FLY
    // once the engines are up, at IDLE while they wind, and OFF when the aircraft is dead.
    const Q = K.panel([QUAD.x, QUAD.y, QUAD.z + 0.001], [1, 0, 0], [0, 1, 0], 'dash', 0.2);
    Q.rect(-0.05, -0.10, 0.05, 0.10, C.black, 0, 0.002);
    for (const [b, l, nm] of [[-0.07, 0.4, 'OFF'], [0, 0.6, 'IDLE'], [0.07, 0.9, 'FLY']]) Q.fitText(nm, 0.0375, b, 0.019, 0.006, lit ? ink : C.white, l * lit, 0.003);
    const pos = powered ? clamp(rpm, 0, 1) : -1;             // -1 OFF, 0 IDLE, 1 FLY
    for (const [i, x] of [[0, -0.018], [1, 0.018]]) {
      const a = (pos * 34 - (i ? 1.5 : 0)) * Math.PI / 180;
      const piv = [QUAD.x + x, QUAD.y, QUAD.z - 0.02];
      const tip = add(piv, [0, Math.sin(a) * 0.12, Math.cos(a) * 0.12]);
      K.rod(piv, tip, 0.006, 'dash', 0.1, V.chrome, 0, 6);
      K.obox(tip, [1, 0, 0], [0, Math.sin(a), Math.cos(a)], [0, Math.cos(a), -Math.sin(a)], 0.011, 0.02, 0.011, 'dash', 0.1, C.black, 0);
    }
    // The collective: a tube from its hinge beside your hip, the friction collar, and the flight grip
    // at the end with its switch box (searchlight, cursor, sight select).
    const g = collectiveGrip(thr);
    K.obox(COLL.pivot, [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.04, 0.05, 0.035, 'dash', 0, C.black, 0);
    K.rod(COLL.pivot, g, 0.017, 'dash', 0.1, V.steel, 0, 8);
    const dir = norm(sub(g, COLL.pivot));
    K.rod(add(COLL.pivot, mul(dir, 0.30)), add(COLL.pivot, mul(dir, 0.34)), 0.024, 'dash', 0.1, C.black, 0, 8);
    K.rod(add(g, mul(dir, -0.12)), g, 0.023, 'dash', 0.05, V.grip, 0, 8);
    const box = add(g, mul(dir, 0.04));
    K.obox(box, [1, 0, 0], dir, norm(cross([1, 0, 0], dir)), 0.035, 0.04, 0.03, 'dash', 0.1, [36, 38, 40], 0);
    K.obox(add(box, [0, 0, 0.032]), [1, 0, 0], dir, [0, 0, 1], 0.008, 0.008, 0.004, 'dash', 0.3, L.landingLight ? C.lampOn : C.white, L.landingLight && powered ? 0.8 : 0);
  }

  // ── THE CYCLIC: boot, shaft and the weapons grip, leaning with your hand ──
  {
    const tip = cyclicTip(ail, elev);
    const base = CYC.base;
    K.obox([base[0], base[1], zP + 0.02], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.07, 0.07, 0.02, 'dash', 0, C.black, 0);
    // The boot: a cone of rubber round the base, bent the way the stick leans.
    const bootTop = add(base, mul(norm(sub(tip, base)), 0.14));
    K.rod([base[0], base[1], zP + 0.04], bootTop, 0.035, 'dash', 0, C.rubber, 0, 8);
    K.rod(bootTop, tip, 0.013, 'dash', 0.1, C.black, 0, 6);
    const ax = norm(sub(tip, base));
    const gTop = add(tip, mul(ax, 0.13));
    K.rod(tip, gTop, 0.021, 'dash', 0.05, V.grip, 0, 8);
    // The two-stage weapons trigger forward, its guard, the force-trim button and the hat switches.
    const fw = norm(cross([1, 0, 0], ax));
    K.obox(add(add(tip, mul(ax, 0.06)), mul(fw, 0.028)), [1, 0, 0], ax, fw, 0.007, 0.014, 0.008, 'dash', 0.2, armed ? C.red : C.black, 0);
    K.rod(add(add(tip, mul(ax, 0.03)), mul(fw, 0.022)), add(add(tip, mul(ax, 0.095)), mul(fw, 0.034)), 0.003, 'dash', 0.1, C.black, 0, 4);
    K.obox(add(gTop, mul(ax, 0.008)), [1, 0, 0], fw, ax, 0.024, 0.02, 0.012, 'dash', 0.1, [38, 40, 42], 0);
    for (const [s, rgb] of [[-0.012, C.black], [0.012, V.steel]]) K.obox(add(gTop, add(mul(ax, 0.022), [s, 0, 0])), [1, 0, 0], fw, ax, 0.006, 0.006, 0.005, 'dash', 0.2, rgb, 0);
    K.obox(add(add(gTop, mul(ax, -0.02)), mul(fw, -0.024)), [1, 0, 0], ax, mul(fw, -1), 0.007, 0.007, 0.004, 'dash', 0.3, C.red, 0.1);
  }

  // ── THE PEDALS, on their arms under the panel ──
  pedal(K, [-PED.x, PED.y, PED.z], 0.045, 0.22, Math.max(0, -rud), V.steel);
  pedal(K, [PED.x, PED.y, PED.z], 0.045, 0.22, Math.max(0, rud), V.steel);
  K.rod([-PED.x - 0.06, PED.y + 0.01, PED.z], [PED.x + 0.06, PED.y + 0.01, PED.z], 0.012, 'dash', 0, V.steel, 0, 6);

  // ── THE UTILITY LIGHT on the left canopy frame, lit by the cabin light ──
  {
    const on = !!L.dome && powered;
    const c = [-0.80, -0.30, 0.06];
    K.obox(c, [0, 1, 0], [0, 0, 1], [1, 0, 0], 0.03, 0.02, 0.02, 'pil', 0.1, C.black, 0);
    K.obox(add(c, [0.022, 0, 0]), [0, 1, 0], [0, 0, 1], [1, 0, 0], 0.013, 0.013, 0.003, 'pil', 0.4, on ? [255, 214, 150] : V.lens, on ? 1 : 0);
  }

  // ── THE GUNNER'S DISPLAYS, lit with yours ──
  {
    const yc = P.viper.Y(VIPER_CABIN.cpgF), zs = P.viper.zG + (P.seatZ - zP);
    const Gp = K.panel([0, yc + 0.76, zs + 0.30], [1, 0, 0], [0, 0.3, 0.95], 'dash', 0.2);
    Gp.rect(-0.10, -0.08, 0.10, 0.08, powered ? [6, 20, 12] : V.mpdGlass, powered ? 0.55 : 0, 0.003);
    if (powered) Gp.attitude(0, 0, 0.05, pitch, bank);
  }

  hotspotHalo(K, viperHotspots(P, L), L);
}

// The palette, for the livery cabin retint (interior-shell.js CABIN_WALLS).
export { V as VIPER_TRIM };
