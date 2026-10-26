// THE LEVIATHAN'S FLIGHT DECK: an An-124 Ruslan's office, as geometry.
//
// The real aeroplane is flown from the front of its upper deck: two pilots side by side under a
// wide raked windscreen, the four thrust levers on a broad centre pedestal between them, an overhead
// panel between their heads, and behind them the rest of a Soviet heavy crew — the navigator at a
// desk on the left wall, the flight engineer facing a whole wall of engine gauges on the right, and
// a door aft into the relief crew's compartment. Panels are the grey-turquoise enamel every Antonov
// and Ilyushin of the period was painted in, the instruments are black-faced round dials, and the
// yokes are the Antonov "ram's horn" pair on floor columns.
//
// Sources read for this (layout, crew stations, dimensions):
//   https://en.wikipedia.org/wiki/Antonov_An-124_Ruslan            (69.1 m long; crew of six on the
//        flight deck at the front of the upper deck; pilot, copilot, navigator, two engineers, radio)
//   https://www.airforce-technology.com/projects/an124/             (crew stations in pairs; the
//        loadmaster is below on the lobby deck; nav/autopilot systems the panels carry)
//   https://aeropedia.com.au/content/antonov-an-124-ruslan/         (the visor nose lifts OVER the
//        flight deck; relief crew compartment aft of it on the same deck)
// Photos the room was held against (Wikimedia Commons), for what the deck looks like from the seat:
//   File:AN-124_flight_deck_(3940749148).jpg       (from behind the seats: ram's-horn yokes on floor
//        columns, one blue board under a black hood, the four-lever pedestal, the overhead stepping
//        down to the windscreen header, blue cloth seats)
//   File:Polet_Antonov_An-124_cockpit_Pashnin.jpg  (from the door: a cream ceiling, the side walls
//        switch panels over laminate desks, curtains at the side glass)
//   File:Polet_Antonov_An-124-100_cockpit_Petrov.jpg
//
// ── ⚠ THE ROOM IS THE EXTERIOR'S HULL, NEVER A SECOND DESCRIPTION OF IT ──────
//
// The exterior is a parametric fixed-wing (aircraft3d.js `buildFixedWing`, row FW_ROWS.heavy): 24
// ring vertices per station, the stations the row's `extraF` pins, and the flight-deck glass is the
// row's own `glaze` block — whole facets of the hull between two stations, not a blister. This file
// evaluates the SAME ring formula off the SAME row, interpolates between the SAME stations the way
// the exterior's quads do, insets it by a wall thickness, and cuts a hole at exactly the facets the
// exterior glazes. Retune the row in the Modelshop and the room, its windows and its floor follow.
//
// ONE SCALE: metres per model unit `M_PER_U` = 69.1 m (the real aeroplane nose to tail) / 2.27 u
// (the row's noseF 1.15 to tailF −1.12) = 30.44. At that scale the row's half-width fr 0.12 u is
// 3.65 m, the real hull's ~7.3 m across, so the deck comes out ~5 m wide at the floor. ⚠ EVERY FITTING
// THAT MEETS THE HULL IS PLACED OFF IT (wallX, liningZ, halfAt), never in fixed metres: the row was
// once fr 0.205 and a panel authored for that deck stood through the skin of this one. The glazing —
// facets 45°–135° over the windscreen bay — wraps up over the crown and down to below the deck, which
// is what the outside draws, so the windows are larger than the real type's; the sill consoles and side consoles stand in
// front of their lower part, which is where the real aeroplane's are.
//
// What is NOT derived is anything about a PERSON: seats, yokes, levers, dials. Those are honest
// metres, off the real deck.
//
// Pure, like the rest of the interior: no clock, no camera, no DOM. `live` arrives as an argument.
import { makeKit, C, clamp, lerp, pedal, SHINY, PANE, TEXTURE } from './interior-kit.js';
import { contactShadow, eased, pressPulse, hotspotHalo, panelGps, gpsHotspot, lensLamp } from './interior-cockpit-kit.js';
import { FW_ROWS } from './vehicle-models.js';

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const TAU = Math.PI * 2;

// ── THE SCALE AND THE EYE ────────────────────────────────────────────────────
export const LEV_REAL_LENGTH_M = 69.1;
// The captain's eye, in the exterior's own (f, g, h) units. f 0.735 is in the windscreen bay, which
// is where the real pilots sit — under the forward edge of the upper deck with the screen in front
// of their knees. g puts him 0.55 m left of the centreline (a transport's pilot seats are ~1.1 m
// apart). h is solved against the glass: a level ray from here has to leave through the windscreen
// (the bay from f 0.78 back to the station at 0.745, just ahead of the eye), and the roof over the
// captain has to clear his head: at 0.219 the lining is 0.33 m over the eye and the windscreen
// header 0.22 m over it, 0.3 m ahead. At 0.224 the header crossed the top of the forward view.
const EYE_U = { f: 0.735, dx: -0.55, h: 0.219 };
const WALL_M = 0.10;          // how thick the lining is, inside the skin
const FLOOR_BELOW_EYE = 1.20;  // a seated eye over the deck
const ROOM_F = [0.585, 0.78];  // aft bulkhead .. the front of the windscreen bay

// ── THE TRIM ─────────────────────────────────────────────────────────────────
// Authored here for the Drake's reason: this is one aircraft's own interior, not a colourway on sale.
// The headliner is the cream-grey moulded panelling of the real deck (the Commons photos named in
// the header), not cloth. `enamelTop` is the same turquoise for faces that look UP: the shell lights
// a face by which way it points, and the sky term took the ordinary enamel to near white.
export const LEV_TRIM = {
  lining: [182, 182, 172], liningDk: [164, 165, 156], frame: [92, 100, 102],
  enamel: [70, 118, 116], enamelDk: [50, 86, 86], enamelLt: [96, 146, 142],    // the Antonov turquoise-grey
  enamelTop: [30, 54, 56],
  deck: [46, 48, 50], mat: [62, 56, 50], tread: [84, 86, 86],
  seat: [64, 74, 92], seatDk: [48, 56, 72], sheep: [196, 184, 162],             // blue-grey cloth, sheepskin covers
  harness: [44, 58, 40], buckle: [172, 176, 180],
  wood: [118, 84, 52], paper: [222, 214, 190], crt: [18, 44, 26], crtLine: [110, 255, 150],
  knobW: [226, 224, 214], knobK: [22, 22, 24], leverRed: [196, 40, 32],
};
const T = LEV_TRIM;
SHINY.set(T.enamel, { spec: 0.22, pow: 30 }); SHINY.set(T.enamelLt, { spec: 0.22, pow: 30 });
SHINY.set(T.buckle, { spec: 0.8, pow: 26, ramp: [[70, 72, 76], [236, 238, 242]], glint: 0.3, albedo: [236, 238, 242], envK: 0.8 });
SHINY.set(T.knobW, { spec: 0.35, pow: 40 });
// Surface texture, by colour identity. Painted metal for everything enamelled and every frame, cloth
// for the lining and the seats, rubber for the runners and the grips, cast for the tread plates.
// ⚠ Lamps, dial faces and screens are never registered: they are lit, not surfaced.
T.lever = [168, 172, 178];
for (const k of ['enamel', 'enamelDk', 'enamelLt', 'enamelTop', 'frame']) TEXTURE.set(T[k], 'paint');
for (const k of ['lining', 'liningDk']) TEXTURE.set(T[k], 'plastic');
for (const k of ['seat', 'seatDk', 'sheep', 'harness']) TEXTURE.set(T[k], 'fabric');
for (const k of ['deck', 'mat', 'knobK']) TEXTURE.set(T[k], 'rubber');
TEXTURE.set(T.tread, 'cast'); TEXTURE.set(T.wood, 'wood'); TEXTURE.set(T.lever, 'brushed'); TEXTURE.set(T.buckle, 'brushed');
SHINY.set(T.lever, { spec: 0.7, pow: 24 });
const GLINT = [255, 252, 240]; PANE.set(GLINT, 0.18);
const SOFT = [0, 1, 0]; PANE.set(SOFT, 0.18);

// ── THE EXTERIOR'S RING, EVALUATED OFF ITS OWN ROW ───────────────────────────
//
// `buildFixedWing`'s `ring(f)` at detail 1, transcribed term for term (czAt, radAt, radVAt, the
// hump, the flat belly, the super-ellipse). A change to that formula must be made here too;
// `scripts/shapes/cockpit-leviathan.mjs` builds the exterior mesh itself and fails if the two stop
// agreeing about where the glass is.
export function levRing(f, p = FW_ROWS.heavy) {
  const sides = p.sides || 12, noseK = p.noseBlunt || 2.4, tube = p.bodyTube || 0, cowl = p.noseCowl || 0;
  const czAt = (f) => {
    if (f < 0) return (p.tailUp ?? 0.05) * (f / p.tailF);
    const u = Math.min(1, f / p.noseF), t = tube ? Math.max(0, (u - tube) / (1 - tube)) : u;
    return (p.noseZ ?? 0.02) * Math.pow(t, p.noseDroopK ?? 1);
  };
  const radAt = (f) => {
    let u = Math.min(1, Math.abs(f >= 0 ? f / p.noseF : f / p.tailF));
    u = u <= tube ? 0 : (u - tube) / (1 - tube);
    if (f >= 0) { const s = Math.pow(Math.max(0, 1 - Math.pow(u, noseK)), 1 / noseK); return cowl + (1 - cowl) * s; }
    return Math.pow(1 - u, 0.8);
  };
  const vFloor = p.noseVFloor || 0;
  const radVAt = (f) => {
    const rH = radAt(f);
    if (!(p.noseVTaper && f > 0)) return rH;
    const u = Math.min(1, f / p.noseF), t = u <= tube ? 0 : (u - tube) / (1 - tube);
    return rH * (vFloor + (1 - vFloor) * Math.pow(1 - t, p.noseVTaper));
  };
  const humpAt = (f) => {
    const Hp = p.hump;
    if (!Hp || f <= Hp.f0 || f >= Hp.f1) return 0;
    return Hp.h * 0.5 * (1 - Math.cos(2 * Math.PI * (f - Hp.f0) / (Hp.f1 - Hp.f0)));
  };
  const shapeExp = 1 - (p.boxy || 0) * 0.55, flatK = p.bellyFlat || 0;
  const rW = radAt(f), rH = radVAt(f), cz = czAt(f), hb = humpAt(f), out = [];
  for (let k = 0; k < sides; k++) {
    const a = k / sides * TAU, ca = Math.cos(a), sa = Math.sin(a);
    const g = Math.sign(ca) * Math.pow(Math.abs(ca), shapeExp) * p.fr * rW;
    let h = Math.sign(sa) * Math.pow(Math.abs(sa), shapeExp) * p.fv * rH;
    if (flatK && sa < 0) { const fl = -p.fv * rH * Math.min(1, Math.abs(sa) * 3); h = h * (1 - flatK) + fl * flatK; }
    out.push([f, g, cz + h + hb * Math.max(0, sa)]);
  }
  return { pts: out, cz };
}

// The exterior's stations, as `buildFixedWing` lays them out, and which facet of which bay is glass.
export function levStations(p = FW_ROWS.heavy) {
  let st = [p.noseF, p.noseF * 0.66, p.noseF * 0.33, 0, p.tailF * 0.35, p.tailF * 0.7, p.tailF];
  if (p.extraF) {
    const keep = st.filter((f) => f === p.noseF || f === p.tailF || !p.extraF.some((e) => Math.abs(e - f) < 0.03));
    st = [...keep, ...p.extraF].sort((a, b) => b - a);
  }
  return st;
}
export function levGlassAt(fA, fB, k, p = FW_ROWS.heavy) {
  const GZ = p.glaze;
  if (!GZ) return false;
  const inGlaze = fB > GZ.f1 - 1e-6 && fA < GZ.f0 + 1e-6;
  const gks = (GZ.wsKs && fA >= GZ.wsF - 1e-6) ? GZ.wsKs : GZ.ks;
  return inGlaze && gks.includes(k);
}

// ── 3-D CLIP ─────────────────────────────────────────────────────────────────
function clipHalf(poly, s) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], sa = s(a), sb = s(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) { const t = sa / (sa - sb); out.push(a.map((v, j) => v + (b[j] - v) * t)); }
  }
  return out;
}
function subtract2(cell, hole) {
  const area = (P) => { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  const pieces = []; let rest = cell;
  for (let i = 0; i < hole.length && rest.length >= 3; i++) {
    const a = hole[i], b = hole[(i + 1) % hole.length];
    const side = (q) => (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
    const o = clipHalf(rest, (q) => -side(q));
    if (o.length >= 3 && Math.abs(area(o)) > 1e-9) pieces.push(o);
    rest = clipHalf(rest, side);
  }
  return pieces;
}

// ── THE PROFILE ──────────────────────────────────────────────────────────────
export function leviathanProfile(p = FW_ROWS.heavy) {
  if (!p || !p.glaze) return null;
  const m = LEV_REAL_LENGTH_M / (p.noseF - p.tailF);
  const fE = EYE_U.f, gE = EYE_U.dx / m, hE = EYE_U.h;
  const X = (g) => (g - gE) * m, Y = (f) => (f - fE) * m, Z = (h) => (h - hE) * m;
  const toShell = (q) => [X(q[1]), Y(q[0]), Z(q[2])];
  const sides = p.sides || 12;
  const zF = -FLOOR_BELOW_EYE, hF = hE + zF / m;
  const insetU = WALL_M / m;

  // The stations that bound the room, and the ring (exterior, then inset) at each.
  const all = levStations(p);
  const [fB, fF] = ROOM_F;
  const stat = all.filter((f) => f < fF - 1e-9 && f > fB + 1e-9);
  const cuts = [fF, ...stat, fB];                          // fore → aft
  const bayOf = (f) => { for (let i = 0; i < all.length - 1; i++) if (f <= all[i] + 1e-9 && f >= all[i + 1] - 1e-9) return i; return 0; };
  const RING = new Map();
  const ringU = (f) => { if (!RING.has(f)) RING.set(f, levRing(f, p)); return RING.get(f); };
  // A point on the EXTERIOR skin at station f and facet-parameter kf (0..sides), the exterior's own
  // quad interpolated bilinearly — its surface, not a re-evaluation of the formula between stations.
  const skinU = (f, kf) => {
    const i = bayOf(f), fa = all[i], fb = all[i + 1], A = ringU(fa).pts, Bq = ringU(fb).pts;
    const t = (fa - f) / (fa - fb || 1);
    const k0 = Math.floor(kf) % sides, k1 = (k0 + 1) % sides, s = kf - Math.floor(kf);
    const a = lerp3(A[k0], A[k1], s), b = lerp3(Bq[k0], Bq[k1], s);
    return lerp3(a, b, t);
  };
  const czU = (f) => { const i = bayOf(f), fa = all[i], fb = all[i + 1], t = (fa - f) / (fa - fb || 1); return lerp(ringU(fa).cz, ringU(fb).cz, t); };
  const innerU = (f, kf) => {
    const q = skinU(f, kf), c = czU(f), dg = q[1], dh = q[2] - c, L = Math.hypot(dg, dh) || 1;
    return [q[0], q[1] - dg / L * insetU, q[2] - dh / L * insetU];
  };
  const inner = (f, kf) => toShell(innerU(f, kf));
  const axis = (f) => toShell([f, 0, czU(f)]);

  // The lining's g at height h on one side, at station f: walk the inset ring's edges.
  const wallGU = (f, h, side) => {
    let best = null;
    for (let k = 0; k < sides; k++) {
      const a = innerU(f, k), b = innerU(f, k + 1);
      if ((a[2] - h) * (b[2] - h) > 0 || a[2] === b[2]) continue;
      const t = (h - a[2]) / (b[2] - a[2]), g = lerp(a[1], b[1], t);
      if (Math.sign(g) !== side) continue;
      if (best == null || Math.abs(g) > Math.abs(best)) best = g;
    }
    return best ?? 0;
  };
  const wallX = (y, z, side) => { const f = fE + y / m; return X(wallGU(f, hE + z / m, side)); };
  // The lining's height over (x, y): the upper half of the inset ring, crossed at g.
  const liningZ = (y, x) => {
    const f = fE + y / m, gu = gE + x / m;
    for (let k = 0; k < sides / 2; k++) {
      const a = innerU(f, k), b = innerU(f, k + 1);
      if ((a[1] - gu) * (b[1] - gu) > 0 || a[1] === b[1]) continue;
      return Z(lerp(a[2], b[2], (gu - a[1]) / (b[1] - a[1])));
    }
    return 0;
  };

  const room = buildRoom({ p, m, sides, cuts, all, inner, innerU, axis, toShell, X, Y, Z, zF, hF, wallGU, fE, hE, levGlass: levGlassAt, bayOf });

  // ⚠ THE BOUNDS ARE MEASURED OVER THE ROOM AND ITS FRAMES AND FURNITURE, built here once: a frame
  // rod round a pane stands its own radius off the lining, and a bound taken off the lining alone
  // refuses the frame for being outside the room it is the edge of.
  const lev = { m, X, Y, Z, fE, gE, hE, zF, hF, insetU, toShell, inner, innerU, wallX, wallGU, liningZ, room: room.faces, holes: room.holes, rims: room.rims, rows: room.rows, cuts, axis, glassAt: (f, k) => { const i = bayOf(f); return levGlassAt(all[i], all[i + 1], k, p); }, sides };
  const pre = { xCentre: X(0), seatZ: -0.76, seatHalf: 0.27, seatY: [-0.48, 0.06], backZ: 0.12, back: Y(ROOM_F[0]), lev };
  buildStatic(pre);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  // The glass film is part of the room too: a side pane reaches the deck 1.5 cm outboard of the lining.
  const glassPolys = levGlass(lev, room.holes);
  for (const f of [...lev.staticFaces, ...glassPolys.map((p) => ({ p }))]) for (const q of f.p) {
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]);
    y1 = Math.max(y1, q[1]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]);
  }
  const xCentre = X(0);
  const halfW = Math.max(xCentre - x0, x1 - xCentre) + 1e-6;

  const P = {
    label: 'An-124 flight deck (the Leviathan)',
    xCentre, halfW,
    floor: z0 - 1e-6, roof: z1 + 1e-6, front: y1 + 1e-6, back: y0 - 1e-6,
    // The pilot's own glass: the side panes are the row's shoulder facets (glaze.ks), level with the
    // eye. The gate casts its side-window sight line through the middle of this band and its "door
    // card below the glass" line 0.2 m under it, which has to pass beneath the pane's lower edge (the
    // left pane's lower corner is 0.55 m down, 1.3 m out).
    dashY: 0.66, dashZ: -0.30, headerZ: 0.30, pillarW: 0.06,
    winY: [-0.40, 0.50], winZ: [-0.80, 0.10],
    seatZ: -0.76, seatHalf: 0.27, seatY: [-0.48, 0.06], backZ: 0.12,
    seats: 2, centrePost: 0,
    // ⚠ NO GLASS OVERHEAD. The windscreen is the bay forward of the row's `wsF`, which stands just
    // ahead of the eye, so the roof over the pilots is lining and the overhead panel hangs from it,
    // as on the real deck. Until 2026-10-26 the windscreen bay ran back over their heads, and the
    // flight deck was a tub open to the sky.
    fit: 'leviathan', craft: 'leviathan',
    normalLit: true,
    floods: [
      { p: [0.00, 0.60, -0.26], r: 0.55 }, { p: [xCentre, 0.60, -0.26], r: 0.55 }, { p: [2 * xCentre, 0.60, -0.26], r: 0.55 },
      { p: [xCentre, 0.10, -0.50], r: 0.45 },                                   // the pedestal
      { p: [xCentre + 1.95, -2.30, -0.10], r: 0.70 }, { p: [xCentre - 2.55, -2.30, -0.20], r: 0.60 },   // engineer, navigator
      { p: [xCentre, 0.05, 0.08], r: 0.60 },                                    // under the front of the overhead
    ],
    // After dark the floods are bright enough to read the board by, as the Drake's are (its 2.2 is
    // the bar), and the lit deck shows faintly in the windscreen.
    floodGain: 1.8, glare: 0.6,
    room: levShell,
    lev,
    hotspots(live) { return levHotspots(this, live); },
    // THE GLASS: one film per exterior glazed facet, on the exterior's own quad pushed 6 cm inside
    // the skin — outboard of the frame rods, which stand 3 cm proud of the lining 10 cm in. Split in
    // two triangles because a facet between two rings is not planar, and cut at the deck, since
    // what is under it is under the floor. Not part of shellFaces: the renderer draws it as film.
    glass: glassPolys,
  };
  return P;
}

const GLASS_IN_M = 0.06;
function levGlass(L, holes) {
  const out = [];
  for (const h of holes) {
    const ga = Math.min(h.fa, L.cuts[0]), gb = Math.max(h.fb, L.cuts[L.cuts.length - 1]);
    // The inner lining point, moved back out toward the skin by (wall − GLASS_IN).
    const at = (f, kf) => {
      const q = L.inner(f, kf), a = L.axis(f), d = norm(sub(q, a));
      return add(q, mul(d, 0.10 - GLASS_IN_M));
    };
    const c = [at(ga, h.k), at(ga, h.k + 1), at(gb, h.k + 1), at(gb, h.k)];
    for (const tri of [[c[0], c[1], c[2]], [c[0], c[2], c[3]]]) {
      const poly = clipHalf(tri, (q) => q[2] - L.zF);
      if (poly.length >= 3) { poly.facet = h.k + '@' + h.fa; out.push(poly); }
    }
  }
  return out;
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
// The lining, the deck, the two bulkheads and the window frames. Built once.
function buildRoom(o) {
  const { p, m, sides, cuts, inner, innerU, axis, toShell, zF, hF, wallGU, levGlass, all, bayOf } = o;
  const faces = [], holes = [], rims = [];
  const put = (pts, n, tone, k, rgb) => faces.push({ p: pts, n, tone, k, rgb });
  const floorClip = (poly) => clipHalf(poly, (q) => q[2] - zF);
  // ⚠ SUB-ROWS ARE SPLIT AT THE EXTERIOR'S OWN STATIONS, never across one: a lining cell that
  // straddled a station would be a straight chord across the exterior's crease and stand proud of it.
  const rows = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const fa = cuts[i], fb = cuts[i + 1], n = Math.max(1, Math.ceil((fa - fb) * m / 0.62));
    for (let j = 0; j < n; j++) rows.push([lerp(fa, fb, j / n), lerp(fa, fb, (j + 1) / n), i]);
  }
  const NA = 3;
  // Which exterior bay a room row sits in — its glass is the exterior's glass for that bay.
  const glassAt = (fa, fb, k) => { const i = bayOf((fa + fb) / 2); return levGlass(all[i], all[i + 1], k, p); };
  // The holes, in the exterior's facet grid: for the gate, and for the frames.
  for (let i = 0; i < all.length - 1; i++) {
    const fa = all[i], fb = all[i + 1];
    if (fb >= cuts[0] || fa <= cuts[cuts.length - 1]) continue;
    for (let k = 0; k < sides; k++) if (levGlass(fa, fb, k, p)) {
      const ga = Math.min(fa, cuts[0]), gb = Math.max(fb, cuts[cuts.length - 1]);
      holes.push({ k, fa, fb, rimU: [innerU(ga, k), innerU(ga, k + 1), innerU(gb, k + 1), innerU(gb, k)] });
    }
  }
  // THE LINING: insulation panels in two tones, each exterior facet in two, above the deck.
  for (const [fa, fb] of rows) {
    for (let k = 0; k < sides; k++) {
      if (glassAt(fa, fb, k)) continue;
      for (let j = 0; j < NA; j++) {
        const k0 = k + j / NA, k1 = k + (j + 1) / NA;
        const q = [inner(fa, k0), inner(fa, k1), inner(fb, k1), inner(fb, k0)];
        if (Math.max(q[0][2], q[1][2], q[2][2], q[3][2]) < zF) continue;
        const poly = floorClip(q);
        if (poly.length < 3) continue;
        let n = norm(cross(sub(q[2], q[0]), sub(q[3], q[1])));
        const c = poly.reduce((s, v) => add(s, mul(v, 1 / poly.length)), [0, 0, 0]);
        if (dot(n, sub(axis((fa + fb) / 2), c)) < 0) n = mul(n, -1);
        // ⚠ A PANEL READS BY ITS SEAM: alternate tones per exterior facet and per row, so the
        // lining is a grid of fitted boards rather than one grey sheet.
        const alt = ((k + Math.round(fa * 50)) & 1) ? T.liningDk : T.lining;
        put(poly, n, 'post', -0.12, alt);
      }
    }
  }
  // THE DECK: a trapezoid per row, from lining to lining at deck height, with a rubber runner up
  // the middle and a tread plate in each footwell.
  for (const [fa, fb] of rows) {
    const gL0 = wallGU(fa, hF, -1), gR0 = wallGU(fa, hF, 1), gL1 = wallGU(fb, hF, -1), gR1 = wallGU(fb, hF, 1);
    const A = (g, f) => toShell([f, g, hF]);
    put([A(gL1, fb), A(gR1, fb), A(gR0, fa), A(gL0, fa)], [0, 0, 1], 'floor', -0.30, T.deck);
  }
  // THE FRONT BULKHEAD: the inside of the nose under the windscreen, from the deck up to the glass.
  {
    const f = cuts[0], ring = [];
    for (let k = 0; k < sides; k++) ring.push(inner(f, k));
    const poly = floorClip(ring);
    if (poly.length >= 3) {
      const c = poly.reduce((s, v) => add(s, mul(v, 1 / poly.length)), [0, 0, 0]);
      for (let i = 0; i < poly.length; i++) put([c, poly[i], poly[(i + 1) % poly.length]], [0, -1, 0], 'dash', -0.2, T.enamelDk);
    }
  }
  // THE AFT BULKHEAD, with the door to the relief crew's compartment on the centreline.
  {
    const f = cuts[cuts.length - 1], ring = [];
    for (let k = 0; k < sides; k++) ring.push(inner(f, k));
    const poly = floorClip(ring);
    const y = poly[0][1], xc = toShell([f, 0, 0])[0];
    const hole = [[xc - 0.40, zF], [xc + 0.40, zF], [xc + 0.40, zF + 1.85], [xc - 0.40, zF + 1.85]];
    const pieces = subtract2(poly.map((q) => [q[0], q[2]]), hole.map((q) => [q[0], q[1] - 1e-4]));
    for (const pc of pieces) put(pc.map(([x, z]) => [x, y, z]), [0, 1, 0], 'post', -0.16, T.lining);
    // The door itself, set into the opening, and its jambs as solids.
    put([[xc + 0.40, y + 0.03, zF], [xc - 0.40, y + 0.03, zF], [xc - 0.40, y + 0.03, zF + 1.85], [xc + 0.40, y + 0.03, zF + 1.85]], [0, 1, 0], 'post', -0.24, T.frame);
    rims.push({ door: [xc, y + 0.03] });
  }
  return { faces, holes, rims, rows };
}

// ── THE SHELL: the cached room + static fit, then the live parts ─────────────
function buildStatic(P) {
  const L = P.lev, arr = [];
  const pushS = (fs, tone, k, fwd, rgb, emis, mat) => { for (const f of fs) arr.push({ p: f.p, n: f.n, tone, k, fwd, rgb, emis, mat }); };
  for (const f of L.room) pushS([{ p: f.p, n: f.n }], f.tone, f.k, false, f.rgb, 0);
  windowFrames(P, pushS);
  staticFit(P, pushS);
  L.staticFaces = arr;
}
function levShell(P, live, push, rich) {
  const L = P.lev;
  if (!L.staticFaces) buildStatic(P);
  for (const f of L.staticFaces) push(f.one || (f.one = Object.assign([{ p: f.p, n: f.n }], { stable: true })), f.tone, f.k, f.fwd, f.rgb, f.emis, f.mat);
  if (rich) liveFit(P, live, push);
}

// The frame round every pane: the lining's own rim, as a rod, cut off at the deck.
function windowFrames(P, push) {
  const K = makeKit(push, false), L = P.lev;
  // THE WINDSCREEN'S CENTRE POST up the crown seam (4 cm, the real screen's post width), from the
  // nose to the windscreen's aft station (cuts[1]): aft of that the crown is roof, not glass.
  // ⚠ Nothing crosses the forward view at eye level: an arch or corner post laid over the band from
  // the cheeks read as two grey slabs across the screen. The exterior's canopy art draws this band
  // undivided; the post is the one departure.
  {
    const onGlass = (f, k) => { const q = L.inner(f, k), a = L.axis(f), d = norm(sub(a, q)); return add(q, mul(d, 0.03)); };
    K.rod(onGlass(L.cuts[0] - 0.004, 6), onGlass(L.cuts[1] + 0.002, 6), 0.035, 'pil', 0.2, T.frame, 0, 6);
  }
  // THE FRAMES OF THE HULL: a rib round the lining at every row boundary, standing 4 cm proud, and
  // never across a pane — a rib is where the lining is, and the lining stops at the glass.
  const proud = (f, k) => { const q = L.inner(f, k), a = L.axis(f), d = norm(sub(a, q)); return add(q, mul(d, 0.04)); };
  const ribFs = [...new Set(L.rows.map((r) => r[1]).slice(0, -1))];
  for (const f of ribFs) {
    for (let k = 0; k < L.sides; k++) {
      if (L.glassAt(f + 1e-4, k) || L.glassAt(f - 1e-4, k)) continue;
      let a = proud(f, k), b = proud(f, k + 1);
      if (a[2] < L.zF + 0.05 && b[2] < L.zF + 0.05) continue;
      const zc = L.zF + 0.05;
      if (a[2] < zc || b[2] < zc) { const t = (zc - a[2]) / (b[2] - a[2]); const q = lerp3(a, b, t); if (a[2] < zc) a = q; else b = q; }
      K.rod(a, b, 0.02, 'post', 0.05, T.frame, 0, 6);
    }
  }
  const seen = new Set();
  for (const h of L.holes) {
    const r = h.rimU.map((q) => L.toShell(q));
    for (let i = 0; i < 4; i++) {
      let a = r[i], b = r[(i + 1) % 4];
      const key = [a, b].map((q) => q.map((v) => v.toFixed(3)).join(',')).sort().join('|');
      if (seen.has(key)) continue;            // an edge between two panes is one frame, not two
      seen.add(key);
      if (a[2] < L.zF && b[2] < L.zF) continue;
      if (a[2] < L.zF || b[2] < L.zF) { const t = (L.zF - a[2]) / (b[2] - a[2]); const q = lerp3(a, b, t); if (a[2] < L.zF) a = q; else b = q; }
      // ⚠ NO FRAME ACROSS THE PANE THE PILOT LOOKS THROUGH: the exterior draws this band UNDIVIDED
      // (aircraft3d.js art 'leviathan', no posts, no hairlines), so only the perimeter and the seams
      // to painted hull get a member. An interior seam between two glazed facets is not a frame.
      K.rod(a, b, 0.022, 'pil', 0.2, T.frame, 0, 6);
    }
  }
}

// ── STATIC FIT: consoles, seats, desks, the room's furniture ─────────────────
function staticFit(P, push) {
  const K = makeKit(push), L = P.lev, cx = P.xCentre, zF = L.zF;
  // SIDE CONSOLES along each cheek, from the deck up to the sill, following the lining.
  const sill = (side, ya, yb, zTop, xIn, rgb = T.enamelTop) => {
    const N = 5;
    for (let i = 0; i < N; i++) {
      const y0 = lerp(ya, yb, i / N), y1 = lerp(ya, yb, (i + 1) / N);
      const w0 = L.wallX(y0, zTop, side) - side * 0.01, w1 = L.wallX(y1, zTop, side) - side * 0.01;
      const f0 = L.wallX(y0, zF, side) - side * 0.01, f1 = L.wallX(y1, zF, side) - side * 0.01;
      const top = [[xIn, y0, zTop], [w0, y0, zTop], [w1, y1, zTop], [xIn, y1, zTop]];
      push([{ p: top, n: [0, 0, 1] }], 'dash', 0.1, true, rgb, 0);
      push([{ p: [[xIn, y0, zF], [xIn, y1, zF], [xIn, y1, zTop], [xIn, y0, zTop]], n: [-side, 0, 0] }], 'dash', -0.1, true, T.enamelDk, 0);
      // The face down to the lining: the console's outboard skirt, the chord from sill to deck.
      const out = [[w0, y0, zTop], [f0, y0, zF], [f1, y1, zF], [w1, y1, zTop]];
      let n = norm(cross(sub(out[1], out[0]), sub(out[3], out[0])));
      if (n[0] * side > 0) n = mul(n, -1);
      push([{ p: out, n }], 'post', -0.1, true, T.enamelDk, 0);
    }
    for (const [y, w, f] of [[ya, L.wallX(ya, zTop, side), L.wallX(ya, zF, side)], [yb, L.wallX(yb, zTop, side), L.wallX(yb, zF, side)]]) {
      push([{ p: [[xIn, y, zF], [f - side * 0.01, y, zF], [w - side * 0.01, y, zTop], [xIn, y, zTop]], n: [0, y === ya ? -1 : 1, 0] }], 'dash', -0.05, true, T.enamelDk, 0);
    }
  };
  // The captain's (left) console: from behind the seat to the panel. The F/O's mirrors it.
  sill(-1, -0.95, 0.62, -0.62, -0.62);
  sill(1, -0.95, 0.62, -0.62, 2 * cx + 0.62);
  // Console tops: two speaker grilles aft, and the oxygen box. What reads the sim is in liveFields.
  for (const side of [-1, 1]) {
    const xIn = side < 0 ? -0.62 : 2 * cx + 0.62;
    const Cp = K.panel([xIn - side * 0.25, -0.20, -0.619], [1, 0, 0], [0, 1, 0]);
    Cp.rect(-0.20, -0.62, 0.20, 0.72, T.enamelTop, 0, 0.001);
    for (let i = 0; i < 2; i++) Cp.grille(-0.16, -0.55 + i * 0.30, 0.16, -0.40 + i * 0.30, 3, [30, 34, 36]);
    // The oxygen mask stowage box on the aft end, and its orange quick-don handle.
    K.box(xIn - side * 0.05, -0.92, -0.62, xIn - side * 0.34, -0.70, -0.44, 'dash', 0.05, [40, 44, 46]);
    K.box(xIn - side * 0.14, -0.86, -0.44, xIn - side * 0.24, -0.76, -0.41, 'dash', 0.2, [226, 118, 40]);
  }
  // The nosewheel tiller's boss on the captain's console; the wheel turns with the rudder (liveFit).
  K.rod([-0.87, 0.28, -0.62], [-0.87, 0.28, -0.56], 0.02, 'dash', 0, C.steel, 0, 8);

  // THE MAIN PANEL: one board across both pilots, raked back 12°, turquoise-grey enamel.
  const rk = 12 * Math.PI / 180, up = [0, -Math.sin(rk), Math.cos(rk)];
  const Mp = K.panel([cx, 0.78, -0.50], [1, 0, 0], up);
  // ⚠ ITS WIDTH IS THE HULL'S, measured at its top edge where the nose has closed in most, so the
  // board is exactly as wide as the deck lets it be and a retuned exterior takes the panel with it.
  const HW = panelHW(P);
  Mp.rect(-HW, -0.30, HW, 0.28, T.enamel, 0, 0);
  // Panel subdivisions: the three boards (captain, centre, F/O) are separate plates with seams.
  for (const a of [-0.28, 0.28]) Mp.rect(a - 0.006, -0.30, a + 0.006, 0.28, T.enamelDk, 0, 0.002);
  // The back of the panel and its underside, so it is a solid seen from the jump seat.
  K.obox(Mp.pt(0, 0, -0.10), Mp.r, Mp.u, Mp.n, HW, 0.29, 0.10, 'dash', -0.2, T.enamelTop, 0);
  // Knee-well kick panels under the board, down to the deck, either side of the pedestal.
  for (const x of [0, 2 * cx]) {
    K.box(x - 0.42, 0.78, zF, x + 0.42, 0.82, -0.88, 'dash', -0.25, T.enamelDk);
  }
  // THE GLARESHIELD: a black hood over the whole board, and the autopilot strip along its face.
  const GW = glareHW(P);
  K.box(cx - GW, 0.66, -0.225, cx + GW, 0.88, -0.19, 'dash', 0.25, [24, 26, 28]);
  K.box(cx - GW, 0.66, -0.28, cx + GW, 0.70, -0.19, 'dash', 0.1, [30, 32, 34]);
  // THE PEDESTAL between the seats: a sloped box from the deck, running aft under the throttles.
  const pw = 0.24;
  K.box(cx - pw, -0.40, zF, cx + pw, 0.76, -0.66, 'dash', -0.15, T.enamelDk);
  const Ped = pedestalPanel(K, P);
  Ped.rect(-pw, -0.60, pw, 0.55, T.enamelTop, 0, 0);
  // Lever gates, one slot per thrust lever, and the flap gate on the right.
  for (let i = 0; i < 4; i++) Ped.rect(-0.135 + i * 0.07 - 0.008, -0.05, -0.135 + i * 0.07 + 0.008, 0.40, [16, 18, 20], 0, 0.002);
  Ped.rect(0.195 - 0.008, -0.05, 0.195 + 0.008, 0.40, [16, 18, 20], 0, 0.002);
  for (let n = 0; n < 4; n++) Ped.rect(0.21, 0.35 - n * 0.12 - 0.003, 0.23, 0.35 - n * 0.12 + 0.003, C.white, 0.2, 0.002);
  // The radio heads aft on the pedestal: a frequency window each; their lamps are in liveFit.
  for (let i = 0; i < 2; i++) {
    const v = -0.24 - i * 0.20;
    Ped.rect(-0.21, v - 0.08, 0.21, v + 0.08, [34, 38, 40], 0, 0.002);
    Ped.digits(-0.17, v - 0.02, 0.035, i ? '121.5' : '118.5', C.amber);
  }

  // THE PILOTS' SEATS: in the round, sheepskin on the cloth, five-point harness, armrests.
  for (const x of [0, 2 * cx]) pilotSeat(K, P, x, 0);
  // THE OVERHEAD: one sloped board on the centreline, from just behind the windscreen header back
  // over both seats, as on the real deck. The face is built in liveFit; this is its body: a backing
  // the thickness of the board, and skirts from its edges up to the lining, so from the seat it is
  // a solid hung from the roof and never a plate floating under it.
  {
    const O = overheadPanel(K, cx, 'hdr', -0.1), hl = OVH.len / 2, hw = OVH.hw;
    K.obox(O.pt(0, 0, -0.03), O.r, O.u, O.n, hw, hl, 0.03, 'hdr', -0.15, T.enamelDk, 0);
    const up = (u, v) => { const q = O.pt(u, v, -0.06); return [q, [q[0], q[1], L.liningZ(q[1], q[0]) - 0.01]]; };
    const N = 6;
    for (const s of [-1, 1]) for (let i = 0; i < N; i++) {
      const [a0, a1] = up(s * hw, -hl + (2 * hl * i) / N), [b0, b1] = up(s * hw, -hl + (2 * hl * (i + 1)) / N);
      K.face(s < 0 ? [a0, b0, b1, a1] : [a0, a1, b1, b0], [s, 0, 0], 'hdr', -0.2, T.enamelDk, 0);
    }
    for (const v of [-hl, hl]) for (let i = 0; i < N; i++) {
      const [a0, a1] = up(-hw + (2 * hw * i) / N, v), [b0, b1] = up(-hw + (2 * hw * (i + 1)) / N, v);
      K.face(v < 0 ? [a0, a1, b1, b0] : [a0, b0, b1, a1], [0, v < 0 ? 1 : -1, 0], 'hdr', -0.2, T.enamelDk, 0);
    }
  }
  // THE NAVIGATOR: a desk on the left wall behind the captain, a radar scope, a chart, a swivel seat.
  navStation(K, P);
  denseFit(K, P);
  // THE FLIGHT ENGINEER: a wall of engine gauges on the right behind the F/O, a desk, a seat.
  engStation(K, P);
  // THE RADIO OPERATOR: aft of the navigator on the same wall, a desk and a rack of sets.
  radioStation(K, P);
  // A jump seat folded against the aft bulkhead, left of the door, and a crash axe on its bracket.
  const yb = P.back + 0.04, xd = L.toShell([0.585, 0, 0])[0];
  K.box(xd - 1.10, yb, -0.75, xd - 0.62, yb + 0.08, -0.25, 'seat', 0.02, T.seatDk);
  K.rod([xd + 0.75, yb + 0.03, -0.55], [xd + 0.75, yb + 0.03, -0.05], 0.018, 'dash', 0.1, T.wood, 0, 6);
  K.obox([xd + 0.75, yb + 0.04, -0.03], [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.08, 0.04, 0.008, 'dash', 0.2, T.leverRed, 0);
  // Circuit-breaker panels on the bulkhead either side of the door: rows of little black buttons.
  for (const s of [-1, 1]) {
    const cbx = Math.min(1.05, halfAt(P, yb + 0.05, 0.33) - 0.36);
    const B = K.panel([xd + s * cbx, yb + 0.005, 0.05], [1, 0, 0], [0, 0, 1], 'post', 0);
    B.rect(-0.30, -0.28, 0.30, 0.28, T.enamel, 0, 0.001);
    for (let r = 0; r < 7; r++) for (let c = 0; c < 10; c++) B.disc(-0.25 + c * 0.055, -0.22 + r * 0.07, 0.009, [20, 20, 22], 0, 0.003, 6);
  }
  // Rubber runners on the deck: the aisle and a tread plate in each footwell.
  K.box(cx - 0.30, -3.9, zF, cx + 0.30, -0.42, zF + 0.006, 'floor', -0.2, T.mat);
  for (const x of [0, 2 * cx]) K.box(x - 0.35, 0.30, zF, x + 0.35, 0.76, zF + 0.006, 'floor', -0.1, T.tread);
  // Contact shadows under the things that stand on the deck.
  for (const [x, y, a, b] of [[0, -0.18, 0.34, 0.38], [2 * cx, -0.18, 0.34, 0.38], [cx, 0.18, 0.30, 0.62]]) {
    contactShadow(K, [x, y, zF + 0.007], [1, 0, 0], [0, 1, 0], [0, 0, 1], a, b);
  }
}

// How wide the main panel and the glareshield may be: the lining's half-width about the centreline at
// the narrowest point each one occupies, less a hand's clearance.
const halfAt = (P, y, z) => Math.min(P.xCentre - P.lev.wallX(y, z, -1), P.lev.wallX(y, z, 1) - P.xCentre);
function panelHW(P) { return Math.min(halfAt(P, 0.72, -0.22), halfAt(P, 0.92, -0.22), halfAt(P, 0.80, -0.32), 1.40) - 0.04; }
function glareHW(P) { return Math.min(halfAt(P, 0.88, -0.19), halfAt(P, 0.66, -0.19), 1.45) - 0.04; }

// The pedestal's top: sloped up toward the panel, in the pedestal's own (across, along) coords.
function pedestalPanel(K, P) {
  const s = 6 * Math.PI / 180;
  return K.panel([P.xCentre, 0.18, -0.659], [1, 0, 0], [0, Math.cos(s), Math.sin(s)]);
}

// ── THE DENSITY: every surface a hand reaches carries something that reads ─────
// A working heavy's deck has no bare surface a crewman can reach. ⚠ NONE OF IT IS A SWITCH: a
// switch with nothing behind it is removed (docs/reference/cockpit-lettering.md), so the console
// tops, the kick panels and the glareshield carry lamps, gauges and readouts that follow the sim
// (liveFields), and the faces low down carry rows of circuit breakers, each row lettered. Until
// 2026-10-26 these were fields of toggles and knobs under blank placards that did nothing.
const INK = [226, 230, 224];
function denseFit(K, P) {
  const L = P.lev, cx = P.xCentre;
  // The inboard face of each console: four rows of breakers down its length, each row named. Read
  // from across the deck, so the across axis runs the way the face is seen (rule 7): forward on the
  // captain's, aft on the F/O's.
  for (const side of [-1, 1]) {
    const xIn = side < 0 ? -0.62 : 2 * cx + 0.62;
    const Fp = K.panel([xIn - side * 0.001, -0.20, -0.86], [0, -side, 0], [0, 0, 1]);
    Fp.rect(-0.55, -0.20, 0.55, 0.20, T.enamel, 0, 0);
    for (let r = 0; r < 4; r++) {
      Fp.text('BUS ' + (side < 0 ? r + 1 : r + 5), -0.475, -0.14 + r * 0.09, 0.014, INK, 0.35);
      for (let c = 0; c < 12; c++) Fp.disc(-0.38 + c * 0.075, -0.14 + r * 0.09, 0.011, [20, 20, 22], 0, 0.004, 6);
    }
  }
  // The pedestal flanks: three named rows of breakers each.
  const FLANK = [['AVION', 'LIGHTS', 'ENG'], ['FUEL', 'HYD', 'ICE']];
  for (const s of [-1, 1]) {
    const Fp = K.panel([cx + s * 0.241, 0.18, -0.93], [0, s, 0], [0, 0, 1]);
    Fp.rect(-0.50, -0.20, 0.50, 0.20, T.enamel, 0, 0);
    for (let r = 0; r < 3; r++) {
      Fp.text(FLANK[s < 0 ? 0 : 1][r], -0.40, -0.13 + r * 0.10, 0.016, INK, 0.35);
      for (let c = 0; c < 8; c++) Fp.disc(-0.26 + c * 0.09, -0.13 + r * 0.10, 0.012, [20, 20, 22], 0, 0.004, 6);
    }
  }
  // The kick panels under the main board and the glareshield strips: their backing plates. What is
  // on them follows the sim, so it is drawn in liveFields.
  for (const x of [0, 2 * cx]) {
    const Kp = K.panel([x, 0.779, -0.95], [1, 0, 0], [0, 0, 1]);
    Kp.rect(-0.36, -0.20, 0.36, 0.06, T.enamelLt, 0, 0.001);
    Kp.rect(-0.36, 0.056, 0.36, 0.06, T.enamelDk, 0, 0.0015);
  }
  const GW = glareHW(P);
  const G = K.panel([cx, 0.658, -0.255], [1, 0, 0], [0, 0, 1]);
  for (const s of [-1, 1]) {
    const a0 = s < 0 ? -GW + 0.04 : 0.42, a1 = s < 0 ? -0.46 : GW - 0.04;
    if (a1 - a0 >= 0.08) G.rect(a0, -0.022, a1, 0.022, [40, 44, 46], 0, 0.001);
  }
}

// What the density shows, drawn live: every lamp, gauge and readout here is a value the sim has.
function liveFields(K, P, R, back) {
  const cx = P.xCentre, lit = R.powered;
  const ink = back ? [250, 244, 226] : INK, inkE = back ? 0.9 : 0.35;
  const dialO = (o) => ({ face: [16, 18, 20], tick: back ? [240, 236, 220] : C.tick, ...o });
  const hydP = lit && R.rpm > 0.1 ? 0.55 + 0.35 * R.hull : 0.05;
  // THE CONSOLE TOPS, inboard of the grilles: three rows each, lettered on the lens, read looking
  // down with the top of the letters forward.
  const CON = [
    [['NWS', lit && R.gear, C.green], ['BRAKE', lit && R.ias < 40, C.amber], ['HYD', lit && R.rpm > 0.1 && R.hull > 0.3, C.green], ['OXY', lit, C.green]],
    [['BUS A', lit, C.green], ['BUS B', lit, C.green], ['PITOT', lit, C.green], ['INV', lit && R.rpm > 0.1, C.green]],
  ];
  for (const side of [-1, 1]) {
    const xIn = side < 0 ? -0.62 : 2 * cx + 0.62;
    const Cp = K.panel([xIn - side * 0.25, -0.20, -0.617], [1, 0, 0], [0, 1, 0]);
    CON[side < 0 ? 0 : 1].forEach(([nm, on, rgb], i) => lensLamp(Cp, (i % 2 ? 0.09 : -0.09), 0.02 + Math.floor(i / 2) * 0.10, 0.16, 0.05, on, rgb, nm));
    const g = side < 0 ? [['HYD P', hydP], ['BRK P', lit ? 0.2 + 0.6 * R.hull : 0.1]] : [['VOLTS', lit ? 0.8 : 0], ['AMPS', lit ? 0.3 + 0.5 * R.rpm : 0]];
    g.forEach(([nm, f], i) => Cp.dial(i ? 0.09 : -0.09, 0.30, 0.045, clamp(f, 0, 1), dialO({ ticks: 8, major: 2, name: nm, nameH: 0.014 })));
  }
  // THE KICK PANELS: the captain's hydraulics, the F/O's oil, one lamp per engine and two gauges.
  for (const x of [0, 2 * cx]) {
    const Kp = K.panel([x, 0.779, -0.95], [1, 0, 0], [0, 0, 1]), cap = x === 0;
    for (let i = 0; i < 4; i++) {
      const run = lit && R.rpm > 0.1;
      lensLamp(Kp, -0.27 + i * 0.18, -0.02, 0.15, 0.05, cap ? run && R.hull > 0.3 : run && R.hull < 0.4, cap ? C.green : C.amber, (cap ? 'HYD ' : 'OIL ') + (i + 1));
    }
    const g = cap ? [['HYD P', hydP], ['BRK P', lit ? 0.2 + 0.6 * R.hull : 0.1]] : [['OIL T', lit ? 0.3 + 0.5 * R.rpm : 0.1], ['OIL P', lit && R.rpm > 0.1 ? 0.4 + 0.4 * R.hull : 0]];
    g.forEach(([nm, f], i) => Kp.dial(i ? 0.15 : -0.15, -0.13, 0.045, clamp(f, 0, 1), dialO({ ticks: 8, major: 2, name: nm, nameH: 0.014 })));
  }
  // THE GLARESHIELD STRIPS either side of the autopilot: readouts of what the sim knows.
  const GW = glareHW(P);
  const G = K.panel([cx, 0.659, -0.255], [1, 0, 0], [0, 0, 1]);
  const pad = (v, n) => String(Math.max(0, Math.round(v))).padStart(n, ' ').slice(-n);
  for (const s of [-1, 1]) {
    const a0 = s < 0 ? -GW + 0.04 : 0.42, a1 = s < 0 ? -0.46 : GW - 0.04;
    if (a1 - a0 < 0.30) continue;
    const pairs = s < 0 ? [['IAS', pad(R.ias, 3)], ['N1', pad(R.rpm * 100, 3)]] : [['FUEL', pad(R.fuel * 212, 3)], ['FLAP', pad(R.flap * 10, 2)]];
    pairs.forEach(([nm, v], i) => {
      const a = a0 + 0.03 + i * (a1 - a0) / 2;
      G.text(nm, a + 0.035, 0, 0.016, ink, inkE);
      G.digits(a + 0.08, -0.01, 0.02, v, lit ? C.amber : C.lampOff);
    });
  }
}

// A pilot's seat in the round: pedestal base on rails, cushion, backrest with bolsters, headrest,
// armrests, the sheepskin cover every Soviet crew seat wore, and a five-point harness.
function pilotSeat(K, P, x, yOff) {
  const zF = P.lev.zF, sz = P.seatZ, h = P.seatHalf, [y0, y1] = P.seatY.map((v) => v + yOff);
  // Rails and the column the seat rides up and down on.
  for (const s of [-1, 1]) K.box(x + s * 0.20 - 0.02, y0 - 0.10, zF, x + s * 0.20 + 0.02, y1 + 0.10, zF + 0.03, 'dash', 0.1, C.steel);
  K.box(x - 0.14, y0 + 0.05, zF + 0.03, x + 0.14, y1 - 0.10, sz - 0.12, 'dash', -0.1, [40, 42, 44]);
  K.box(x - h, y0, sz - 0.12, x + h, y1, sz - 0.04, 'seat', 0.0, T.seatDk);
  // The cushion, crowned: a raised middle and two bolsters.
  K.box(x - h + 0.06, y0, sz - 0.04, x + h - 0.06, y1, sz, 'seat', 0.08, T.sheep);
  for (const s of [-1, 1]) K.box(x + s * (h - 0.03) - 0.03, y0, sz - 0.04, x + s * (h - 0.03) + 0.03, y1, sz + 0.04, 'seat', 0.08, T.seat);
  // The backrest, leaning back 12°, with its bolsters and the sheepskin over the middle.
  const lean = 12 * Math.PI / 180, U = [0, -Math.sin(lean), Math.cos(lean)], F = [0, Math.cos(lean), Math.sin(lean)];
  const bh = (P.backZ - sz) / 2, bc = add([x, y0 - 0.06, sz], mul(U, bh));
  K.obox(bc, [1, 0, 0], U, F, h, bh, 0.06, 'seat', -0.02, T.seat);
  K.obox(add(bc, mul(F, 0.065)), [1, 0, 0], U, F, h - 0.07, bh - 0.03, 0.008, 'seat', 0.02, T.sheep);
  for (const s of [-1, 1]) K.obox(add(bc, add(mul([1, 0, 0], s * (h - 0.03)), mul(F, 0.05))), [1, 0, 0], U, F, 0.035, bh - 0.02, 0.05, 'seat', 0.0, T.seat);
  // The headrest, behind the eye — never at it.
  const top = add([x, y0 - 0.06, sz], mul(U, bh * 2 + 0.14));
  K.obox(top, [1, 0, 0], U, F, 0.14, 0.10, 0.06, 'seat', -0.04, T.seatDk);
  // Armrests, on the outboard and inboard side, folded down.
  for (const s of [-1, 1]) {
    K.box(x + s * (h + 0.005) - 0.035, y0 - 0.02, sz + 0.18, x + s * (h + 0.005) + 0.035, y1 - 0.14, sz + 0.23, 'seat', 0.05, T.seatDk);
    K.rod([x + s * (h + 0.005), y0 + 0.02, sz + 0.02], [x + s * (h + 0.005), y0 + 0.02, sz + 0.18], 0.012, 'dash', 0, C.steel, 0, 5);
  }
  // THE HARNESS: two shoulder straps over the top of the back to a rotary buckle at the lap, the
  // two lap straps from the hips, and the crotch strap up from the front of the cushion.
  const buckle = [x, y1 - 0.20, sz + 0.12];
  const bf = add(bc, mul(F, 0.08));
  for (const s of [-1, 1]) {
    const shoulder = add(add([x, y0 - 0.06, sz], mul(U, bh * 2 - 0.02)), [s * 0.10, 0.08, 0]);
    K.rod(shoulder, add(buckle, [s * 0.05, 0, 0.03]), 0.018, 'dash', 0, T.harness, 0, 4);
    K.rod([x + s * (h - 0.04), y0 + 0.02, sz + 0.02], add(buckle, [s * 0.04, 0, -0.01]), 0.018, 'dash', 0, T.harness, 0, 4);
    K.obox(add(shoulder, [0, 0.02, -0.18]), [1, 0, 0], U, F, 0.022, 0.03, 0.006, 'dash', 0.3, T.buckle, 0);
  }
  void bf;
  K.rod([x, y1 - 0.02, sz + 0.005], buckle, 0.018, 'dash', 0, T.harness, 0, 4);
  K.rod(add(buckle, [0, 0, -0.015]), add(buckle, [0, 0, 0.015]), 0.04, 'dash', 0.3, T.buckle, 0, 10);
}

// A crew seat that swivels to face `yaw` (radians, 0 = forward).
function crewSeat(K, P, x, y, yaw) {
  const zF = P.lev.zF, sz = -0.72, R = [Math.cos(yaw), -Math.sin(yaw), 0], F = [Math.sin(yaw), Math.cos(yaw), 0];
  K.rod([x, y, zF], [x, y, sz - 0.08], 0.04, 'dash', 0, C.steel, 0, 8);
  for (let i = 0; i < 5; i++) { const t = (i / 5) * TAU; K.rod([x, y, zF + 0.04], [x + Math.cos(t) * 0.28, y + Math.sin(t) * 0.28, zF + 0.02], 0.018, 'dash', 0, [40, 42, 44], 0, 4); }
  K.obox([x, y, sz - 0.04], R, [0, 0, 1], F, 0.24, 0.05, 0.24, 'seat', 0.06, T.seat);
  K.obox(add([x, y, sz + 0.30], mul(F, -0.22)), R, [0, 0, 1], F, 0.22, 0.30, 0.05, 'seat', -0.02, T.seat);
  K.obox(add([x, y, sz + 0.31], mul(F, -0.165)), R, [0, 0, 1], F, 0.17, 0.26, 0.006, 'seat', 0.02, T.sheep);
}

function navStation(K, P) {
  const L = P.lev, zF = L.zF, zTop = -0.40, ya = -3.25, yb = -1.45;
  const xIn = L.wallX(-2.3, zTop, -1) + 0.62;
  // The desk: a slab from the lining to xIn, and its modesty panel down to the deck.
  const N = 4;
  for (let i = 0; i < N; i++) {
    const y0 = lerp(ya, yb, i / N), y1 = lerp(ya, yb, (i + 1) / N);
    const w0 = L.wallX(y0, zTop, -1) + 0.01, w1 = L.wallX(y1, zTop, -1) + 0.01;
    K.face([[w0, y0, zTop], [xIn, y0, zTop], [xIn, y1, zTop], [w1, y1, zTop]], [0, 0, 1], 'dash', 0.1, T.wood, 0);
  }
  K.box(xIn - 0.04, ya, zF, xIn, yb, zTop, 'dash', -0.1, T.enamelDk);
  // The chart on the desk and a pair of dividers on it.
  const D = K.panel([xIn - 0.30, -2.35, zTop + 0.002], [1, 0, 0], [0, 1, 0]);
  D.rect(-0.18, -0.30, 0.18, 0.30, T.paper, 0.05, 0.001);
  for (let i = 0; i < 5; i++) D.rect(-0.16, -0.26 + i * 0.12, 0.16, -0.258 + i * 0.12, [120, 150, 190], 0.05, 0.002);
  K.rod([xIn - 0.35, -2.40, zTop + 0.01], [xIn - 0.22, -2.20, zTop + 0.01], 0.003, 'dash', 0.4, C.chrome, 0, 4);
  // The equipment rack above the desk, standing off the lining: a sloped panel facing inboard.
  crewSeat(K, P, xIn + 0.45, -2.35, -Math.PI / 2);
}

function engStation(K, P) {
  const L = P.lev, zF = L.zF, zTop = -0.52, ya = -3.35, yb = -1.35;
  const xIn = L.wallX(-2.3, zTop, 1) - 0.70;
  const N = 4;
  for (let i = 0; i < N; i++) {
    const y0 = lerp(ya, yb, i / N), y1 = lerp(ya, yb, (i + 1) / N);
    const w0 = L.wallX(y0, zTop, 1) - 0.01, w1 = L.wallX(y1, zTop, 1) - 0.01;
    K.face([[xIn, y0, zTop], [w0, y0, zTop], [w1, y1, zTop], [xIn, y1, zTop]], [0, 0, 1], 'dash', 0.1, T.enamel, 0);
  }
  K.box(xIn, ya, zF, xIn + 0.04, yb, zTop, 'dash', -0.1, T.enamelDk);
  crewSeat(K, P, xIn - 0.45, -2.35, Math.PI / 2);
}

function radioStation(K, P) {
  const L = P.lev, zF = L.zF, zTop = -0.42, ya = -4.40, yb = -3.45;
  const xIn = L.wallX(-3.9, zTop, -1) + 0.58;
  for (let i = 0; i < 2; i++) {
    const y0 = lerp(ya, yb, i / 2), y1 = lerp(ya, yb, (i + 1) / 2);
    const w0 = L.wallX(y0, zTop, -1) + 0.01, w1 = L.wallX(y1, zTop, -1) + 0.01;
    K.face([[w0, y0, zTop], [xIn, y0, zTop], [xIn, y1, zTop], [w1, y1, zTop]], [0, 0, 1], 'dash', 0.1, T.wood, 0);
  }
  K.box(xIn - 0.04, ya, zF, xIn, yb, zTop, 'dash', -0.1, T.enamelDk);
  // A morse key and a headset on the desk.
  K.box(xIn - 0.22, -3.95, zTop, xIn - 0.12, -3.85, zTop + 0.02, 'dash', 0.1, T.knobK);
  K.rod([xIn - 0.17, -3.93, zTop + 0.02], [xIn - 0.17, -3.84, zTop + 0.04], 0.004, 'dash', 0.3, C.chrome, 0, 4);
  K.torus([xIn - 0.35, -3.70, zTop + 0.07], [0, 1, 0], [0, 0, 1], 0.07, 0.01, 10, 'dash', 0.1, T.knobK, 0, 0, Math.PI);
  crewSeat(K, P, xIn + 0.42, -3.92, -Math.PI / 2);
}
function radioPanel(K, P) {
  const L = P.lev, zc = -0.12, rk = 14 * Math.PI / 180, zTopEdge = zc + 0.26 * Math.cos(rk);
  const xc = L.wallX(-3.92, zTopEdge, -1) + 0.08 + 0.26 * Math.sin(rk);
  return K.panel([xc, -3.92, zc], [0, 1, 0], [-Math.sin(rk), 0, Math.cos(rk)]);
}

// The engineer's gauge wall: a panel standing on his desk, raked back toward him.
function engPanel(K, P) {
  // Its top edge leans outboard toward the lining, so it is set off the lining at the height of that
  // edge, never off the desk: the lining closes in overhead and a panel placed from below goes through it.
  const L = P.lev, zc = -0.18, rk = 18 * Math.PI / 180, zTopEdge = zc + 0.34 * Math.cos(rk);
  const xc = L.wallX(-2.35, zTopEdge, 1) - 0.08 - 0.34 * Math.sin(rk);
  return K.panel([xc, -2.35, zc], [0, -1, 0], [Math.sin(rk), 0, Math.cos(rk)]);
}
function navPanel(K, P) {
  const L = P.lev, zc = -0.06, rk = 18 * Math.PI / 180, zTopEdge = zc + 0.30 * Math.cos(rk);
  const xc = L.wallX(-2.35, zTopEdge, -1) + 0.08 + 0.30 * Math.sin(rk);
  return K.panel([xc, -2.35, zc], [0, 1, 0], [-Math.sin(rk), 0, Math.cos(rk)]);
}

// ── THE LIVE STATE ───────────────────────────────────────────────────────────
function readLive(live) {
  const L = live || {};
  const hour = num(L.hour, 12);
  return {
    L, pitch: num(L.pitch), bank: num(L.bank), hdg: num(L.hdg),
    ias: Math.max(0, num(L.ias)), vne: Math.max(40, num(L.vne, 300)),
    alt: Math.max(0, num(L.alt)), vsi: num(L.vsi),
    rpm: clamp(num(L.rpm), 0, 1.05), thr: clamp(num(L.throttle), 0, 1),
    fuel: clamp(num(L.fuel, 1), 0, 1), hull: clamp(num(L.hull, 1), 0, 1),
    powered: L.powered !== false,
    ail: clamp(num(L.stickX), -1, 1), elev: clamp(num(L.stickY), -1, 1), rud: clamp(num(L.rudder), -1, 1),
    flap: clamp(Math.round(num(L.flapNotch)), 0, 3), gear: L.gearDown !== false, trim: clamp(num(L.trim), -1, 1),
    land: !!L.landingLight, dome: !!L.dome, hour,
    night: hour < 6.5 || hour > 19.5,
    // The PANEL switch (cockpit.js 'ck:panel'). A view that sends no switch state, as a seat shot
    // does, gets the lights the hour would have them on with.
    panel: L.panelLight != null ? !!L.panelLight : hour < 6.5 || hour > 19.5,
  };
}

// Where each moving control is, shared by the drawing and the hotspots.
const YOKE = (x, R) => [x, 0.42 - R.elev * 0.12, -0.40];
const LEVER = (P, R, i) => {
  const piv = [P.xCentre - 0.135 + i * 0.07, 0.17, -0.70];
  const a = (-32 + 64 * R.thr * (1 - i * 0.008)) * Math.PI / 180;
  return { piv, tip: add(piv, [0, Math.sin(a) * 0.26, Math.cos(a) * 0.26]) };
};
const FLAPL = (P, R) => { const piv = [P.xCentre + 0.195, 0.17, -0.70], a = (26 - R.flap * 17) * Math.PI / 180; return { piv, tip: add(piv, [0, Math.sin(a) * 0.20, Math.cos(a) * 0.20]) }; };
const MAIN = (P) => { const rk = 12 * Math.PI / 180; return makeKit(() => {}).panel([P.xCentre, 0.78, -0.50], [1, 0, 0], [0, -Math.sin(rk), Math.cos(rk)]); };
// Down is down: the handle sits low on the board with the gear down and high with it up.
const GEARL = (P, R) => MAIN(P).pt(0.20, R.gear ? -0.28 : -0.19, 0.09);
// The GPS, on the bare board outboard of the captain's airspeed, high enough to clear the yoke's horn.
const GPS = { u: -0.90, v: 0.12, hw: 0.08, hh: 0.07 };

function liveFit(P, live, push) {
  const K = makeKit(push), R = readLive(live), cx = P.xCentre, zF = P.lev.zF;
  const lit = R.powered, back = lit && R.panel ? 0.55 : 0;       // panel backlighting, on the PANEL switch
  const rk = 12 * Math.PI / 180, up = [0, -Math.sin(rk), Math.cos(rk)];
  const Mp = K.panel([cx, 0.78, -0.50], [1, 0, 0], up);
  const dialO = (o) => ({ face: [16, 18, 20], tick: back ? [240, 236, 220] : C.tick, ...o });
  // ── EACH PILOT'S BOARD: clock, ASI, ADI, altimeter / HSI, VSI below. Mirrored for the F/O. ──
  for (const side of [-1, 1]) {
    const pc = side * P.xCentre, r = 0.066, dx = 0.17, r1 = 0.10, r2 = -0.12;
    Mp.dial(pc - dx, r1, r, clamp(R.ias / (R.vne * 1.1), 0, 1), dialO({ ticks: 16, major: 4, arcs: [[0.25, 0.8, C.green], [0.8, 0.9, C.amber]], red: 0.9, name: 'KTS' }));
    Mp.attitude(pc, r1, r * 1.12, R.pitch, R.bank);
    Mp.dial(pc + dx, r1, r, (R.alt % 1000) / 1000, dialO({ a0: Math.PI / 2, sweep: TAU, ticks: 10, major: 1, frac2: (R.alt % 10000) / 10000, name: 'ALT' }));
    Mp.compass(pc, r2, r * 1.12, R.hdg);
    Mp.dial(pc + dx, r2, r * 0.9, clamp(0.5 + R.vsi / 6000, 0, 1), dialO({ a0: Math.PI, sweep: Math.PI * 1.8, ticks: 8, major: 2, name: 'VSI' }));
    // The clock, the hour off the world: two hands on a small face.
    const h = R.hour, cxk = pc - dx, czk = r2;
    Mp.dial(cxk, czk, r * 0.8, (h % 12) / 12, dialO({ a0: Math.PI / 2, sweep: TAU, ticks: 12, major: 3, frac2: (h % 1), needle: C.white, needle2: C.white, name: 'CLOCK' }));
    // The ADI's warning flag, dropped in when the aircraft is dead.
    if (!lit) Mp.rect(pc + 0.03, r1 - 0.05, pc + 0.07, r1 - 0.02, C.red, 0.3, 0.012);
    // A glint across each dial glass.
    for (const [a, b, rr] of [[pc, r1, r * 1.12], [pc, r2, r * 1.12]]) Mp.annulus(a, b, rr * 0.7, rr * 0.84, GLINT, 0.4, 0.011, 6, Math.PI * 0.55, Math.PI * 0.95);
    // Master warning and caution at the top of the board, lettered on the lens.
    lensLamp(Mp, pc - 0.06, 0.24, 0.09, 0.03, lit && R.hull < 0.5, C.red, 'WARN');
    lensLamp(Mp, pc + 0.06, 0.24, 0.09, 0.03, lit && (R.fuel < 0.15 || R.hull < 0.8), C.amber, 'CAUT');
    // The stab trim indicator: a vertical scale with a pointer.
  }
  // ── THE CENTRE BOARD: four engines in columns (N1, EGT, fuel flow), then the gear lever. ──
  for (let i = 0; i < 4; i++) {
    const u = -0.195 + i * 0.13, n1 = clamp(R.rpm * (1 - i * 0.012), 0, 1.05);
    Mp.dial(u, 0.17, 0.048, n1 / 1.05, dialO({ ticks: 10, major: 2, arcs: [[0.2, 0.9, C.green]], red: 0.95, name: 'N1' }));
    Mp.dial(u, 0.03, 0.042, clamp(0.25 + n1 * 0.6, 0, 1), dialO({ ticks: 8, major: 2, arcs: [[0.3, 0.8, C.green]], red: 0.9, name: 'EGT' }));
    Mp.bar(u, -0.13, -0.05, 0.012, R.thr * n1, lit ? C.green : C.lampOff);
    Mp.text('FF', u + 0.035, -0.09, 0.013, back ? [250, 244, 226] : C.tick, back ? 0.9 : 0.35);
    Mp.digits(u - 0.03, -0.17, 0.022, String(Math.round(n1 * 100)).padStart(3, ' '), lit ? C.green : C.lampOff);
  }
  // The gear handle: a white wheel-shaped knob on a lever, and the three greens beside it.
  {
    const g = GEARL(P, R), base = Mp.pt(0.20, -0.235, 0);
    Mp.rect(0.175, -0.295, 0.225, -0.175, [22, 24, 26], 0, 0.002);
    K.rod(base, g, 0.008, 'dash', 0.1, C.chrome, 0, 6);
    K.rod(sub(g, [0, 0.02, 0]), add(g, [0, 0.015, 0]), 0.022, 'dash', 0.2, T.knobW, 0, 12);
    for (let j = 0; j < 3; j++) Mp.lamp(0.145, -0.20 - j * 0.035, 0.010, 0.010, lit, R.gear ? C.green : C.red);
    Mp.text('GEAR', 0.258, -0.235, 0.013);   // one name, beside the handle and its three lamps
  }
  // ── THE YOKES: ram's-horn wheels on floor columns, both moving together. ──
  for (const x of [0, 2 * cx]) {
    const hub = YOKE(x, R), base = [x, 0.70, zF + 0.05];
    K.box(x - 0.08, 0.64, zF, x + 0.08, 0.76, zF + 0.10, 'dash', -0.1, [30, 32, 34]);
    K.rod(base, add(hub, [0, 0.06, -0.02]), 0.03, 'dash', 0.05, [44, 46, 48], 0, 8);
    const a = R.ail * 60 * Math.PI / 180, Rr = [Math.cos(a), 0, -Math.sin(a)], Ur = [Math.sin(a), 0, Math.cos(a)];
    const at = (u, v) => add(hub, add(mul(Rr, u), mul(Ur, v)));
    K.obox(hub, Rr, Ur, [0, -1, 0], 0.07, 0.05, 0.035, 'dash', 0.1, [34, 36, 38], 0);
    for (const s of [-1, 1]) {
      K.rod(at(s * 0.05, 0), at(s * 0.17, -0.02), 0.018, 'dash', 0.1, [34, 36, 38], 0, 6);
      K.rod(at(s * 0.17, -0.02), at(s * 0.19, 0.11), 0.024, 'dash', 0.05, T.knobK, 0, 8);      // the horn grip
      K.obox(at(s * 0.18, 0.10), Rr, Ur, [0, -1, 0], 0.012, 0.012, 0.01, 'dash', 0.3, T.leverRed, 0);   // autopilot disconnect
    }
    // The emblem plate in the middle of the wheel.
    const Hp = K.panel(add(hub, [0, -0.036, 0]), Rr, Ur);
    Hp.disc(0, 0, 0.03, T.enamelLt, 0.05, 0.001, 12);
  }
  // ── THE RUDDER PEDALS, both pairs. ──
  for (const x of [0, 2 * cx]) {
    pedal(K, [x - 0.13, 0.70, -0.86], 0.05, 0.22, Math.max(0, -R.rud), [30, 32, 34]);
    pedal(K, [x + 0.13, 0.70, -0.86], 0.05, 0.22, Math.max(0, R.rud), [30, 32, 34]);
  }
  // ── THE FOUR THRUST LEVERS and the flap lever on the pedestal. (No spoiler lever: the sim has no spoilers.) ──
  for (let i = 0; i < 4; i++) {
    const { piv, tip } = LEVER(P, R, i);
    K.rod(piv, tip, 0.009, 'dash', 0.1, T.lever, 0, 6);
    K.obox(tip, [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.026, 0.02, 0.018, 'dash', 0.15, T.knobW, 0);
    // The reverser latch on the front of each lever.
    K.obox(add(tip, [0, 0.03, -0.035]), [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.012, 0.01, 0.012, 'dash', 0.1, T.knobK, 0);
  }
  // A crossbar across all four grips when they are together, so one hand moves the set.
  { const a = LEVER(P, R, 0).tip, b = LEVER(P, R, 3).tip; K.rod(add(a, [-0.02, 0, 0.022]), add(b, [0.02, 0, 0.022]), 0.008, 'dash', 0.2, C.chrome, 0, 5); }
  {
    const { piv, tip } = FLAPL(P, R);
    K.rod(piv, tip, 0.008, 'dash', 0.1, T.lever, 0, 6);
    K.obox(tip, [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.022, 0.012, 0.02, 'dash', 0.2, [210, 208, 200], 0);
  }
  // ── THE GLARESHIELD: the autopilot and the lamps along its face. ──
  const G = K.panel([cx, 0.659, -0.235], [1, 0, 0], [0, 0, 1]);
  G.digits(-0.30, -0.012, 0.024, String(Math.round(R.hdg) % 360).padStart(3, '0'), lit ? C.amber : C.lampOff);
  G.digits(0.10, -0.012, 0.024, String(Math.round(R.alt / 100)).padStart(3, '0'), lit ? C.amber : C.lampOff);
  const AP_MODE = ['AP', 'AT', 'HDG', 'ALT', 'VS', 'APP'];
  // The sim has no autopilot, so its modes are dark; APP comes on configured for an approach.
  const apOn = [false, false, false, false, false, lit && R.gear && R.flap >= 2];
  for (let i = 0; i < 6; i++) G.lamp(-0.42 + i * 0.07 + (i > 2 ? 0.63 : 0), 0, 0.014, 0.010, apOn[i], C.green, AP_MODE[i]);
  // ── THE OVERHEAD: the working switches up front, then the systems as lamps that read the sim. ──
  // Every lamp is lettered on its lens, as an annunciator is; nothing here is a switch but the five
  // in the front row (OVH_SW), so nothing takes the hand cursor and does nothing.
  {
    const O = overheadPanel(K, cx, 'hdr', -0.1), hl = OVH.len / 2, hw = OVH.hw;
    O.rect(-hw, -hl, hw, hl, T.enamel, 0, 0);
    const ink = back ? [250, 244, 226] : [226, 230, 224], inkE = back ? 0.9 : 0.35;
    // Section seams across the board, each with the name of the section aft of it just behind it.
    const SEC = [[-hl + 0.17, 'ELEC'], [-hl + 0.40, 'FUEL'], [-hl + 0.66, 'FIRE'], [-hl + 0.92, 'PRESS']];
    for (const [v, nm] of SEC) {
      O.rect(-hw, v - 0.006, hw, v + 0.006, T.enamelDk, 0, 0.002);
      O.text(nm, 0, v + 0.055, 0.018, ink, inkE);
    }
    // The working row. A bat that eases between its stops and gives when it is thrown.
    const swOn = { 'ck:master': R.powered, 'ck:panel': R.panel, 'ck:land': R.land, 'ck:taxi': R.land, 'ck:dome': R.dome };
    OVH_SW.forEach(([id, nm], i) => {
      const [u, v] = ovhSwAt(i), on = !!swOn[id];
      const f = eased('lev:' + id, on ? 1 : 0, 18) - pressPulse('lev:' + id, on) * 0.3;
      O.rect(u - 0.016, v - 0.028, u + 0.016, v + 0.028, [22, 24, 26], 0, 0.002);
      O.stud(u, v + (f * 2 - 1) * 0.012, 0.009, 0.012, 0.012, id === 'ck:master' ? T.leverRed : T.knobW, 0, 0.003);
      O.text(nm, u, v + 0.045, 0.013, ink, inkE);
    });
    const ann = (u, v, w, on, rgb, nm) => lensLamp(O, u, v, w, 0.028, on, rgb, nm);
    for (let i = 0; i < 4; i++) {
      const u = -0.27 + i * 0.18, run = lit && R.rpm > 0.1;
      ann(u, -hl + 0.31, 0.11, run, C.green, 'GEN ' + (i + 1));
      ann(u, -hl + 0.56, 0.11, lit && R.fuel > 0.02, C.green, 'PUMP ' + (i + 1));
      ann(u, -hl + 0.82, 0.11, lit && R.hull < 0.25, C.red, 'FIRE ' + (i + 1));
    }
    ann(0.27, -hl + 0.10, 0.11, lit && R.fuel < 0.15, C.red, 'LO FUEL');
    ann(0.27, -hl + 0.62, 0.11, lit && R.fuel < 0.15, C.amber, 'XFEED');
    // The cabin pressure dial at the aft end: the cabin climbs a fifth as fast as the aeroplane.
    O.dial(0.0, hl - 0.11, 0.06, clamp(R.alt * 0.2 / 8000, 0, 1), dialO({ ticks: 8, major: 2, name: 'CABIN', nameH: 0.014 }));
  }
  // Dome lamps in the crown aft of the glass, lit with the dome switch.
  for (const y of [-1.8, -2.8]) {
    // The crown is far over the deck here, so each lamp hangs on a stem cut to the lining.
    const z = P.lev.liningZ(y, cx) - 0.02;
    K.rod([cx, y, z], [cx, y, z - 0.16], 0.01, 'hdr', 0, C.steel, 0, 4);
    K.obox([cx, y, z - 0.18], [1, 0, 0], [0, 1, 0], [0, 0, -1], 0.10, 0.06, 0.02, 'hdr', 0.2, R.dome && lit ? [255, 236, 200] : [70, 70, 64], R.dome && lit ? 1 : 0);
  }
  // ── THE ENGINEER'S WALL: four engine columns, fuel tanks, hydraulics, and his own four levers. ──
  {
    const E = engPanel(K, P);
    E.rect(-0.62, -0.34, 0.62, 0.34, T.enamel, 0, 0);
    E.rect(-0.62, -0.34, 0.62, -0.33, T.enamelDk, 0, 0.001);
    // ⚠ READ FROM THE CAPTAIN'S SEAT, 3 m off, so the lettering is 2 cm tall: each column is named
    // once by its engine number and each dial by what it measures, as the real engineer's board is.
    const big = 0.021, ink = back ? [250, 244, 226] : [226, 230, 224], inkE = back ? 0.9 : 0.35;
    for (let i = 0; i < 4; i++) {
      const u = -0.50 + i * 0.15, n1 = clamp(R.rpm * (1 - i * 0.012), 0, 1.05);
      E.text(String(i + 1), u, 0.31, big, ink, inkE);
      E.dial(u, 0.22, 0.05, n1 / 1.05, dialO({ ticks: 10, major: 2, red: 0.95, name: 'N1', nameH: big }));
      E.dial(u, 0.08, 0.045, clamp(0.2 + n1 * 0.55, 0, 1), dialO({ ticks: 8, major: 2, arcs: [[0.3, 0.8, C.green]], name: 'EGT', nameH: big }));
      E.dial(u, -0.05, 0.04, clamp(0.3 + 0.5 * (lit ? 1 : 0) * R.hull, 0, 1), dialO({ ticks: 6, major: 2, name: 'OIL', nameH: big }));
      lensLamp(E, u, -0.17, 0.12, 0.04, lit && R.rpm > 0.1, C.green, 'GEN ' + (i + 1));
    }
    // The fuel: eight tank gauges in a row under one name, all reading the one quantity the sim carries.
    E.text('FUEL', 0.33, 0.30, big, ink, inkE);
    for (let i = 0; i < 8; i++) {
      const u = 0.10 + i * 0.065;
      E.bar(u, -0.02, 0.26, 0.018, R.fuel * (1 - (i % 4) * 0.04), R.fuel < 0.15 ? C.amber : C.green);
      E.text(String(i + 1), u, -0.05, 0.022, ink, inkE);
    }
    E.digits(0.14, -0.13, 0.03, String(Math.round(R.fuel * 212)).padStart(3, ' '), lit ? C.amber : C.lampOff);
    E.text('TOTAL', 0.30, -0.115, big, ink, inkE);
    lensLamp(E, 0.22, -0.25, 0.16, 0.05, lit && R.hull < 0.8, C.amber, 'HYD');
    lensLamp(E, 0.44, -0.25, 0.16, 0.05, lit && R.hull < 0.25, C.red, 'FIRE');
  }
  // ── THE NAVIGATOR'S SCOPE: a round CRT whose sweep turns with the heading. ──
  {
    const N = navPanel(K, P);
    N.rect(-0.55, -0.30, 0.55, 0.30, T.enamel, 0, 0);
    N.disc(-0.20, 0.0, 0.20, T.crt, lit ? 0.4 : 0, 0.002, 24);
    N.annulus(-0.20, 0.0, 0.20, 0.23, [30, 34, 36], 0, 0.002, 24);
    if (lit) {
      for (const rr of [0.06, 0.12, 0.18]) N.annulus(-0.20, 0.0, rr - 0.002, rr, T.crtLine, 0.8, 0.004, 24);
      N.spoke(-0.20, 0.0, Math.PI / 2 - R.hdg * Math.PI / 180, 0, 0.19, 0.004, T.crtLine, 1, 0.006);
    }
    N.compass(0.22, 0.12, 0.09, R.hdg);
    N.digits(0.10, -0.20, 0.03, String(Math.round(R.alt)).padStart(5, ' ').slice(-5), lit ? C.green : C.lampOff);
  }
  // ── THE RADIO RACK: four sets, each a frequency window, a meter and its knobs. ──
  {
    const Rp = radioPanel(K, P);
    Rp.rect(-0.42, -0.26, 0.42, 0.26, [52, 58, 60], 0, 0);
    // 4 m from the captain's eye, so each set's name and its lamp are lettered 2.6 cm tall.
    const ink = back ? [250, 244, 226] : [226, 230, 224], inkE = back ? 0.9 : 0.35;
    for (let i = 0; i < 4; i++) {
      const u = -0.31 + i * 0.205;
      Rp.rect(u - 0.09, -0.22, u + 0.09, 0.22, T.enamelDk, 0, 0.001);
      Rp.text(['VHF 1', 'VHF 2', 'HF 1', 'HF 2'][i], u - 0.026, 0.185, 0.026, ink, inkE);
      lensLamp(Rp, u + 0.062, 0.185, 0.056, 0.05, lit && i === 0, C.green, 'TX');
      Rp.digits(u - 0.07, 0.11, 0.022, ['118', '121', '4.5', '8.9'][i] + (i < 2 ? '5' : '0'), lit ? C.amber : C.lampOff);
      Rp.dial(u, 0.0, 0.05, lit ? clamp(0.3 + 0.1 * i + R.thr * 0.2, 0, 1) : 0, dialO({ a0: Math.PI * 0.8, sweep: Math.PI * 0.6, ticks: 6, major: 2, name: 'SIG', nameH: 0.026 }));
      lensLamp(Rp, u - 0.044, -0.15, 0.08, 0.05, lit, C.green, 'PWR');
      lensLamp(Rp, u + 0.044, -0.15, 0.08, 0.05, lit && i === 0, C.amber, 'RX');
    }
  }
  // ── THE ANNUNCIATOR STRIPS under each pilot's board, and the flap position dial on the centre. ──
  {
    const warn = [lit && !R.gear, lit && R.fuel < 0.15, lit && R.hull < 0.5, lit && R.hull < 0.8, lit && R.rpm < 0.05, lit && R.flap > 0, lit && R.land, lit && R.thr > 0.95];
    const cols = [C.red, C.amber, C.red, C.amber, C.amber, C.green, C.green, C.amber];
    const names = ['GEAR', 'FUEL', 'HULL', 'CAUT', 'ENG', 'FLAP', 'LAND', 'THR'];
    for (const side of [-1, 1]) for (let i = 0; i < 8; i++) lensLamp(Mp, side * P.xCentre - 0.21 + i * 0.06, -0.272, 0.054, 0.024, warn[i], cols[i], names[i]);
    const small = { nameH: 0.012 };
    Mp.dial(-0.02, -0.235, 0.034, R.flap / 3, dialO({ a0: Math.PI * 0.9, sweep: Math.PI * 0.9, ticks: 3, major: 1, needle: C.white, name: 'FLAP', ...small }));
    Mp.dial(0.08, -0.235, 0.034, clamp(0.5 + R.trim * 0.45, 0, 1), dialO({ a0: Math.PI * 1.25, sweep: Math.PI * 0.5, ticks: 4, major: 2, needle: C.amber, name: 'TRIM', ...small }));
    Mp.dial(-0.12, -0.235, 0.034, clamp(R.hull, 0, 1) * 0.9, dialO({ ticks: 6, major: 2, arcs: [[0.6, 1, C.green]], name: 'HYD', ...small }));
    Mp.dial(-0.22, -0.235, 0.034, R.fuel, dialO({ ticks: 8, major: 2, arcs: [[0, 0.15, C.red]], name: 'FUEL', ...small }));
  }
  liveFields(K, P, R, back);
  // The radio heads' lamps on the pedestal, and the tiller, turned with the rudder.
  {
    const Ped = pedestalPanel(K, P);
    for (let i = 0; i < 2; i++) lensLamp(Ped, 0.12, -0.24 - i * 0.20, 0.13, 0.05, lit, C.green, 'COM ' + (i + 1));
    const a = R.rud * 1.2, Rr = [Math.cos(a), Math.sin(a), 0], Ur = [-Math.sin(a), Math.cos(a), 0];
    K.torus([-0.87, 0.28, -0.56], Rr, Ur, 0.07, 0.009, 14, 'dash', 0.1, T.knobK, 0);
    K.rod([-0.87, 0.28, -0.555], add([-0.87, 0.28, -0.555], mul(Rr, 0.06)), 0.008, 'dash', 0.1, T.knobK, 0, 5);
  }
  panelGps(Mp, GPS.u, GPS.v, GPS.hw, GPS.hh, live);
  hotspotHalo(K, levHotspots(P, live), live);
}

// The overhead panel, one frame for the drawing and the hotspots: a board 0.8 m across on the
// centreline, sloping up from just behind the windscreen header (y0, z0) to over the backs of the
// seats (y1, z1). You read it by tipping your head back, facing forward, so across is +x and up runs
// aft (docs/reference/cockpit-lettering.md rule 7); v is −len/2 at the front edge.
const OVH = { y0: 0.16, z0: 0.15, y1: -0.95, z1: 0.60, hw: 0.40 };
OVH.len = Math.hypot(OVH.y1 - OVH.y0, OVH.z1 - OVH.z0);
const overheadPanel = (K, cx, tone, k) => K.panel([cx, (OVH.y0 + OVH.y1) / 2, (OVH.z0 + OVH.z1) / 2], [1, 0, 0],
  [0, (OVH.y1 - OVH.y0) / OVH.len, (OVH.z1 - OVH.z0) / OVH.len], tone, k);
// The working switches, front row on the captain's half, where his right hand finds them: each is a
// circuit cockpit.js switches (DK_ACT), and nothing else on the board is a switch.
const OVH_SW = [['ck:master', 'MASTER'], ['ck:panel', 'PANEL'], ['ck:land', 'LAND'], ['ck:taxi', 'TAXI'], ['ck:dome', 'DOME']];
const ovhSwAt = (i) => [-0.33 + i * 0.075, -OVH.len / 2 + 0.085];

// ── THE CONTROLS YOU CAN TOUCH ────────────────────────────────────────────────
// The same `ck:*` ids cockpit.js already acts on, at the places the drawing puts them.
export function levHotspots(P, live) {
  const R = readLive(live), cx = P.xCentre;
  const out = [
    { id: 'yoke', p: YOKE(0, R), r: 0.12, kind: 'yoke' },
    { id: 'throttle', p: LEVER(P, R, 1).tip, r: 0.06, kind: 'throttle' },
    { id: 'ck:flaps', p: FLAPL(P, R).tip, r: 0.03, kind: 'click' },
    { id: 'ck:gear', p: GEARL(P, R), r: 0.03, kind: 'click' },
    gpsHotspot(MAIN(P), GPS.u, GPS.v, 0.07),
  ];
  const O = overheadPanel(makeKit(() => {}), cx);
  OVH_SW.forEach(([id], i) => { const [u, v] = ovhSwAt(i); out.push({ id, p: O.pt(u, v, 0.015), r: 0.03, kind: 'click' }); });
  return out;
}
