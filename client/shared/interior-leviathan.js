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
import { makeKit, C, clamp, pedal, SHINY, PANE, TEXTURE } from './interior-kit.js';
import { contactShadow, eased, pressPulse, hotspotHalo } from './interior-cockpit-kit.js';
import { FW_ROWS } from './vehicle-models.js';

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const TAU = Math.PI * 2;

// ── THE SCALE AND THE EYE ────────────────────────────────────────────────────
export const LEV_REAL_LENGTH_M = 69.1;
// The captain's eye, in the exterior's own (f, g, h) units. f 0.735 is in the windscreen bay, which
// is where the real pilots sit — under the forward edge of the upper deck with the screen in front
// of their knees. g puts him 0.55 m left of the centreline (a transport's pilot seats are ~1.1 m
// apart). h is solved against the glass: a level ray from here has to leave through the windscreen
// (between the crown at f 0.78 and the crown at f 0.70), which only a band 1 m tall allows.
const EYE_U = { f: 0.735, dx: -0.55, h: 0.224 };
const WALL_M = 0.10;          // how thick the lining is, inside the skin
const FLOOR_BELOW_EYE = 1.20;  // a seated eye over the deck
const ROOM_F = [0.585, 0.78];  // aft bulkhead .. the front of the windscreen bay

// ── THE TRIM ─────────────────────────────────────────────────────────────────
// Authored here for the Drake's reason: this is one aircraft's own interior, not a colourway on sale.
export const LEV_TRIM = {
  lining: [138, 154, 150], liningDk: [120, 136, 133], frame: [92, 100, 102],
  enamel: [70, 118, 116], enamelDk: [50, 86, 86], enamelLt: [96, 146, 142],    // the Antonov turquoise-grey
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
for (const k of ['enamel', 'enamelDk', 'enamelLt', 'frame']) TEXTURE.set(T[k], 'paint');
for (const k of ['lining', 'liningDk', 'seat', 'seatDk', 'sheep', 'harness']) TEXTURE.set(T[k], 'fabric');
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
    // The pilot's own glass: the windscreen band wraps down both cheeks, so the side-window sight
    // line the gate casts is aimed low and a little ahead, over the side console, at the cheek.
    dashY: 0.66, dashZ: -0.30, headerZ: 0.30, pillarW: 0.06,
    winY: [0.20, 0.60], winZ: [-0.86, -0.80],
    seatZ: -0.76, seatHalf: 0.27, seatY: [-0.48, 0.06], backZ: 0.12,
    seats: 2, centrePost: 0,
    // The windscreen band crosses the crown over the pilots (the real aeroplane's eyebrow glass):
    // straight up from the eye is sky, and the gate asserts it.
    roofGlass: [Y(p.glaze.f1), Y(p.glaze.f0)],
    fit: 'leviathan', craft: 'leviathan',
    normalLit: true,
    floods: [
      { p: [0.00, 0.60, -0.26], r: 0.55 }, { p: [xCentre, 0.60, -0.26], r: 0.55 }, { p: [2 * xCentre, 0.60, -0.26], r: 0.55 },
      { p: [xCentre, 0.10, -0.50], r: 0.45 },                                   // the pedestal
      { p: [xCentre + 1.95, -2.30, -0.10], r: 0.70 }, { p: [xCentre - 2.55, -2.30, -0.20], r: 0.60 },   // engineer, navigator
    ],
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
  // THE WINDSCREEN'S OWN STRUCTURE: a slim centre post up the crown seam (4 cm, the real screen's
  // post width), and an eyebrow bar across the crown just AFT of the eye, above the eye line, which is
  // where the real deck's eyebrow panes begin. ⚠ Nothing crosses the forward view at eye level: an
  // arch or corner post laid over the band from the cheeks read as two grey slabs across the screen.
  // ⚠ The exterior's canopy art draws this band undivided; these two members are the one departure.
  {
    const onGlass = (f, k) => { const q = L.inner(f, k), a = L.axis(f), d = norm(sub(a, q)); return add(q, mul(d, 0.03)); };
    const fBrow = L.fE - 0.25 / L.m;
    let prev = null;
    for (let i = 0; i <= 8; i++) {
      const q = onGlass(fBrow, 4.5 + i * 0.375);
      if (prev && q[2] > 0.12 && prev[2] > 0.12) K.rod(prev, q, 0.03, 'pil', 0.2, T.frame, 0, 6);
      prev = q;
    }
    let a = onGlass(0.78 - 0.004, 6), b = onGlass(0.70 + 0.004, 6);
    K.rod(a, b, 0.04, 'pil', 0.2, T.frame, 0, 6);
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
      K.rod(a, b, 0.03, 'post', 0.05, T.frame, 0, 6);
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
      K.rod(a, b, 0.03, 'pil', 0.2, T.frame, 0, 6);
    }
  }
}

// ── STATIC FIT: consoles, seats, desks, the room's furniture ─────────────────
function staticFit(P, push) {
  const K = makeKit(push), L = P.lev, cx = P.xCentre, zF = L.zF;
  // SIDE CONSOLES along each cheek, from the deck up to the sill, following the lining.
  const sill = (side, ya, yb, zTop, xIn, rgb = T.enamel) => {
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
  // Console faces: the tiller on the captain's, oxygen and intercom panels on both.
  for (const side of [-1, 1]) {
    const xIn = side < 0 ? -0.62 : 2 * cx + 0.62;
    const Cp = K.panel([xIn - side * 0.25, -0.20, -0.619], [1, 0, 0], [0, 1, 0]);
    Cp.rect(-0.20, -0.62, 0.20, 0.72, T.enamelLt, 0, 0.001);
    for (let i = 0; i < 4; i++) Cp.grille(-0.16, -0.55 + i * 0.30, 0.16, -0.40 + i * 0.30, 3, [30, 34, 36]);
    for (let i = 0; i < 6; i++) Cp.knob(-0.12 + (i % 3) * 0.12, 0.45 + Math.floor(i / 3) * 0.10, 0.012, 0.014, T.knobK, 0);
    // The oxygen mask stowage box on the aft end, and its orange quick-don handle.
    K.box(xIn - side * 0.05, -0.92, -0.62, xIn - side * 0.34, -0.70, -0.44, 'dash', 0.05, [40, 44, 46]);
    K.box(xIn - side * 0.14, -0.86, -0.44, xIn - side * 0.24, -0.76, -0.41, 'dash', 0.2, [226, 118, 40]);
  }
  // Nosewheel tiller on the captain's console: a small wheel on a boss.
  K.torus([-0.87, 0.28, -0.56], [1, 0, 0], [0, 1, 0], 0.07, 0.009, 14, 'dash', 0.1, T.knobK, 0);
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
  K.obox(Mp.pt(0, 0, -0.10), Mp.r, Mp.u, Mp.n, HW, 0.29, 0.10, 'dash', -0.2, T.enamelDk, 0);
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
  Ped.rect(-pw, -0.60, pw, 0.55, T.enamel, 0, 0);
  // Lever gates, one slot per thrust lever, and the flap gate on the right.
  for (let i = 0; i < 4; i++) Ped.rect(-0.135 + i * 0.07 - 0.008, -0.05, -0.135 + i * 0.07 + 0.008, 0.40, [16, 18, 20], 0, 0.002);
  Ped.rect(0.195 - 0.008, -0.05, 0.195 + 0.008, 0.40, [16, 18, 20], 0, 0.002);
  for (let n = 0; n < 4; n++) Ped.rect(0.21, 0.35 - n * 0.12 - 0.003, 0.23, 0.35 - n * 0.12 + 0.003, C.white, 0.2, 0.002);
  // The radio heads aft on the pedestal: two panels of knobs and a frequency window each.
  for (let i = 0; i < 2; i++) {
    const v = -0.24 - i * 0.20;
    Ped.rect(-0.21, v - 0.08, 0.21, v + 0.08, [34, 38, 40], 0, 0.002);
    Ped.digits(-0.14, v - 0.02, 0.035, '118.5', C.amber);
    for (let j = 0; j < 3; j++) Ped.knob(0.08 + j * 0.05, v, 0.014, 0.016, T.knobK, 0);
  }

  // THE PILOTS' SEATS: in the round, sheepskin on the cloth, five-point harness, armrests.
  for (const x of [0, 2 * cx]) pilotSeat(K, P, x, 0);
  // THE OVERHEAD: a long panel hung between the pilots' heads from a spine under the glass.
  // ⚠ NEVER OVER x = 0: straight up from the captain's eye is the eyebrow glass, and the gate looks.
  {
    const x0 = cx - 0.36, x1 = cx + 0.36;
    // Hung from the lining on two hangers, each cut to the lining's own height over it.
    for (const y of [-0.95, -0.30]) K.rod([cx, y, 0.27], [cx, y, L.liningZ(y, cx) - 0.01], 0.025, 'pil', 0.1, T.frame, 0, 6);
    K.box(x0, -1.05, 0.20, x1, -0.10, 0.27, 'hdr', -0.1, T.enamelDk);
    const O = K.panel([cx, -0.575, 0.199], [1, 0, 0], [0, 1, 0], 'hdr', -0.1);
    O.rect(-0.35, -0.47, 0.35, 0.47, T.enamel, 0, 0);
    for (const v of [-0.26, 0.0, 0.26]) O.rect(-0.35, v - 0.004, 0.35, v + 0.004, T.enamelDk, 0, 0.002);
    // The fuel system mimic: pipe lines painted in white between the valve toggles.
    for (let i = 0; i < 4; i++) O.rect(-0.30 + i * 0.18, -0.46, -0.30 + i * 0.18 + 0.004, -0.30, C.white, 0.1, 0.002);
    O.rect(-0.30, -0.305, 0.244, -0.30, C.white, 0.1, 0.002);
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

// ── THE DENSITY: switch fields on every surface a hand reaches ─────────────
// A working heavy's deck has no bare surface a crewman can reach: the console tops, the pedestal
// flanks, the glareshield face and the kick panels all carry switches, knobs and placards. Each field
// is a painted panel with its own rows, so nothing reads as a slab from the seat.
function switchField(Pn, a0, b0, a1, b1, cols, rows, seed) {
  Pn.rect(a0, b0, a1, b1, T.enamelLt, 0, 0.001);
  Pn.rect(a0, b1 - 0.004, a1, b1, T.enamelDk, 0, 0.0015);
  const da = (a1 - a0) / cols, db = (b1 - b0) / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = a0 + da * (c + 0.5), b = b0 + db * (r + 0.5), h = (c * 7 + r * 13 + seed) % 6;
    if (h < 3) Pn.toggle(a, b, (c + r + seed) % 2 === 0);
    else if (h < 5) Pn.knob(a, b, Math.min(da, db) * 0.28, 0.014, T.knobK, 0);
    else Pn.rect(a - da * 0.3, b - db * 0.12, a + da * 0.3, b + db * 0.12, C.white, 0.15, 0.002);
    Pn.rect(a - da * 0.35, b + db * 0.30, a + da * 0.35, b + db * 0.36, C.white, 0.1, 0.0015);   // the placard
  }
}
function denseFit(K, P) {
  const L = P.lev, cx = P.xCentre;
  // The side console tops: two fields each, kept to the inboard half so the sight line out of the
  // cheek glass still clears the console's outboard edge.
  for (const side of [-1, 1]) {
    const xIn = side < 0 ? -0.62 : 2 * cx + 0.62;
    const w = Math.abs(L.wallX(-0.2, -0.62, side) - xIn);
    const Cp = K.panel([xIn - side * w * 0.22, -0.20, -0.617], [1, 0, 0], [0, 1, 0]);
    const hw = w * 0.17;
    switchField(Cp, -hw, -0.10, hw, 0.35, 3, 6, side < 0 ? 1 : 4);
    switchField(Cp, -hw, -0.62, hw, -0.45, 3, 2, side < 0 ? 2 : 5);
    // The inboard face of the console: circuit breakers down its length.
    const Fp = K.panel([xIn - side * 0.001, -0.20, -0.86], [0, 1, 0], [0, 0, 1]);
    Fp.rect(-0.55, -0.20, 0.55, 0.20, T.enamel, 0, 0);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 14; c++) Fp.disc(-0.50 + c * 0.077, -0.14 + r * 0.09, 0.011, [20, 20, 22], 0, 0.004, 6);
  }
  // The pedestal flanks: breakers.
  for (const s of [-1, 1]) {
    const Fp = K.panel([cx + s * 0.241, 0.18, -0.93], [0, 1, 0], [0, 0, 1]);
    Fp.rect(-0.50, -0.20, 0.50, 0.20, T.enamel, 0, 0);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 10; c++) Fp.disc(-0.42 + c * 0.09, -0.13 + r * 0.10, 0.012, [20, 20, 22], 0, 0.004, 6);
  }
  // The kick panels under the main board: hydraulic and anti-ice fields.
  for (const x of [0, 2 * cx]) {
    const Kp = K.panel([x, 0.779, -0.95], [1, 0, 0], [0, 0, 1]);
    switchField(Kp, -0.36, -0.20, 0.36, 0.06, 6, 3, x > 0 ? 3 : 0);
  }
  // The glareshield face, both sides of the autopilot: course/heading knobs and mode buttons.
  const GW = glareHW(P);
  const G = K.panel([cx, 0.658, -0.255], [1, 0, 0], [0, 0, 1]);
  for (const s of [-1, 1]) {
    const a0 = s < 0 ? -GW + 0.04 : 0.42, a1 = s < 0 ? -0.46 : GW - 0.04;
    if (a1 - a0 < 0.08) continue;
    G.rect(a0, -0.022, a1, 0.022, [40, 44, 46], 0, 0.001);
    const n = Math.floor((a1 - a0) / 0.05);
    for (let i = 0; i < n; i++) {
      const a = a0 + (i + 0.5) * (a1 - a0) / n;
      if (i % 3 === 0) G.knob(a, 0, 0.014, 0.016, T.knobK, 0);
      else G.stud(a, 0, 0.012, 0.010, 0.006, [60, 64, 66], 0, 0.001);
    }
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

function liveFit(P, live, push) {
  const K = makeKit(push), R = readLive(live), cx = P.xCentre, zF = P.lev.zF;
  const lit = R.powered, back = lit && R.night ? 0.55 : 0;       // panel backlighting after dark
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
    // Master caution / warning lamps at the top of the board.
    Mp.lamp(pc - 0.05, 0.24, 0.022, 0.014, lit && R.hull < 0.5, C.red, 'WARN');
    Mp.lamp(pc + 0.05, 0.24, 0.022, 0.014, lit && (R.fuel < 0.15 || R.hull < 0.8), C.amber, 'CAUTION');
    // The stab trim indicator: a vertical scale with a pointer.
  }
  // ── THE CENTRE BOARD: four engines in columns (N1, EGT, fuel flow), then the gear lever. ──
  for (let i = 0; i < 4; i++) {
    const u = -0.195 + i * 0.13, n1 = clamp(R.rpm * (1 - i * 0.012), 0, 1.05);
    Mp.dial(u, 0.17, 0.048, n1 / 1.05, dialO({ ticks: 10, major: 2, arcs: [[0.2, 0.9, C.green]], red: 0.95, name: 'N1' }));
    Mp.dial(u, 0.03, 0.042, clamp(0.25 + n1 * 0.6, 0, 1), dialO({ ticks: 8, major: 2, arcs: [[0.3, 0.8, C.green]], red: 0.9, name: 'EGT' }));
    Mp.bar(u, -0.13, -0.05, 0.012, R.thr * n1, lit ? C.green : C.lampOff, 'FF');
    Mp.digits(u - 0.03, -0.17, 0.022, String(Math.round(n1 * 100)).padStart(3, ' '), lit ? C.green : C.lampOff);
  }
  // The gear handle: a white wheel-shaped knob on a lever, and the three greens beside it.
  {
    const g = GEARL(P, R), base = Mp.pt(0.20, -0.235, 0);
    Mp.rect(0.175, -0.295, 0.225, -0.175, [22, 24, 26], 0, 0.002);
    K.rod(base, g, 0.008, 'dash', 0.1, C.chrome, 0, 6);
    K.rod(sub(g, [0, 0.02, 0]), add(g, [0, 0.015, 0]), 0.022, 'dash', 0.2, T.knobW, 0, 12);
    for (let j = 0; j < 3; j++) Mp.lamp(0.145, -0.20 - j * 0.035, 0.010, 0.010, lit, R.gear ? C.green : C.red);
    Mp.text('GEAR', 0.145, -0.175, 0.0085);   // one name over the three; they sit too close to letter each
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
  // ── THE FOUR THRUST LEVERS, the flap lever and the spoiler lever on the pedestal. ──
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
  {
    const piv = [cx - 0.205, 0.17, -0.70], tip = add(piv, [0, Math.sin(-0.4) * 0.18, Math.cos(-0.4) * 0.18]);
    K.rod(piv, tip, 0.007, 'dash', 0.1, T.lever, 0, 6);
    K.obox(tip, [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.016, 0.012, 0.016, 'dash', 0.2, T.leverRed, 0);
  }
  // ── THE GLARESHIELD: the autopilot and the lamps along its face. ──
  const G = K.panel([cx, 0.659, -0.235], [1, 0, 0], [0, 0, 1]);
  G.digits(-0.30, -0.012, 0.024, String(Math.round(R.hdg) % 360).padStart(3, '0'), lit ? C.amber : C.lampOff);
  G.digits(0.10, -0.012, 0.024, String(Math.round(R.alt / 100)).padStart(3, '0'), lit ? C.amber : C.lampOff);
  const AP_MODE = ['AP', 'AT', 'HDG', 'ALT', 'VS', 'APP'];
  for (let i = 0; i < 6; i++) G.lamp(-0.42 + i * 0.07 + (i > 2 ? 0.63 : 0), 0, 0.014, 0.010, lit && i % 2 === 0, C.green, AP_MODE[i]);
  // ── THE OVERHEAD: toggles that follow the aircraft's electrics, the landing and dome switches. ──
  {
    const O = overheadPanel(K, cx, 'hdr', -0.1);
    for (let r = 0; r < 7; r++) for (let c = 0; c < 9; c++) {
      const a = -0.31 + c * 0.075, b = -0.40 + r * 0.12;
      if (r === 6 && c >= 6) continue;                              // where the landing and dome switches sit
      if ((r + c) % 4 === 3) O.knob(a, b, 0.012, 0.014, T.knobK, 0);
      else O.toggle(a, b, lit && (r * 9 + c) % 5 !== 0);
      O.rect(a - 0.025, b + 0.028, a + 0.025, b + 0.034, C.white, 0.1, 0.0015);
    }
    const land = eased('lev:land', R.land ? 1 : 0, 18) - pressPulse('lev:land', R.land) * 0.3;
    O.rect(0.15, 0.40, 0.30, 0.48, [22, 24, 26], 0, 0.002);
    O.stud(0.19, 0.44 + (land * 2 - 1) * 0.008, 0.010, 0.012, 0.01, T.knobW, 0, 0.003);
    O.stud(0.26, 0.44 + ((R.dome ? 1 : 0) * 2 - 1) * 0.008, 0.010, 0.012, 0.01, T.knobW, 0, 0.003);
    O.lamp(0.19, 0.38, 0.01, 0.006, lit && R.land, C.amber, 'LAND');
    O.text('DOME', 0.26, 0.3645, 0.0085);
    for (let i = 0; i < 4; i++) O.lamp(-0.30 + i * 0.18, -0.30, 0.018, 0.010, lit && R.fuel > 0.02, C.green, 'PUMP ' + (i + 1));
    O.lamp(-0.30, 0.45, 0.02, 0.01, lit && R.fuel < 0.15, C.red, 'LO FUEL');
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
    for (let i = 0; i < 4; i++) {
      const u = -0.50 + i * 0.15, n1 = clamp(R.rpm * (1 - i * 0.012), 0, 1.05);
      E.dial(u, 0.22, 0.05, n1 / 1.05, dialO({ ticks: 10, major: 2, red: 0.95, name: 'N1' }));
      E.dial(u, 0.08, 0.045, clamp(0.2 + n1 * 0.55, 0, 1), dialO({ ticks: 8, major: 2, arcs: [[0.3, 0.8, C.green]], name: 'EGT' }));
      E.dial(u, -0.05, 0.04, clamp(0.3 + 0.5 * (lit ? 1 : 0) * R.hull, 0, 1), dialO({ ticks: 6, major: 2, name: 'OIL P' }));
    }
    // The fuel: eight tank gauges in two rows, all reading the one quantity the sim carries.
    for (let i = 0; i < 8; i++) E.bar(0.12 + (i % 4) * 0.12, i < 4 ? 0.06 : -0.22, i < 4 ? 0.30 : 0.02, 0.018, R.fuel * (1 - (i % 4) * 0.04), R.fuel < 0.15 ? C.amber : C.green, 'TK ' + (i + 1));
    E.digits(0.14, -0.30, 0.03, String(Math.round(R.fuel * 212)).padStart(3, ' '), lit ? C.amber : C.lampOff);
    for (let i = 0; i < 6; i++) E.lamp(-0.50 + i * 0.09, -0.24, 0.018, 0.012, lit && (i === 5 ? R.hull < 0.5 : R.rpm > 0.1), i === 5 ? C.red : C.green, i < 4 ? 'GEN ' + (i + 1) : i === 4 ? 'HYD' : 'FIRE');
    // Engine-start panel along the bottom: one guarded switch per engine.
    for (let i = 0; i < 4; i++) E.toggle(-0.50 + i * 0.15, -0.30, R.rpm > 0.05, 'START ' + (i + 1));
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
    for (let i = 0; i < 4; i++) {
      const u = -0.31 + i * 0.205;
      Rp.rect(u - 0.09, -0.22, u + 0.09, 0.22, T.enamelDk, 0, 0.001);
      Rp.digits(u - 0.07, 0.12, 0.022, ['118', '121', '4.5', '8.9'][i] + (i < 2 ? '5' : '0'), lit ? C.amber : C.lampOff);
      Rp.dial(u, 0.0, 0.05, lit ? clamp(0.3 + 0.1 * i + R.thr * 0.2, 0, 1) : 0, dialO({ a0: Math.PI * 0.8, sweep: Math.PI * 0.6, ticks: 6, major: 2, name: 'SIG' }));
      for (let j = 0; j < 2; j++) Rp.knob(u - 0.04 + j * 0.08, -0.14, 0.016, 0.02, T.knobK, 0);
      Rp.lamp(u + 0.06, 0.19, 0.008, 0.006, lit && i === 0, C.green, 'TX');
      Rp.text(['VHF 1', 'VHF 2', 'HF 1', 'HF 2'][i], u - 0.03, 0.19, 0.012);
    }
  }
  // ── THE ANNUNCIATOR STRIPS under each pilot's board, and the flap position dial on the centre. ──
  {
    const warn = [lit && !R.gear, lit && R.fuel < 0.15, lit && R.hull < 0.5, lit && R.hull < 0.8, lit && R.rpm < 0.05, lit && R.flap > 0, lit && R.land, lit && R.thr > 0.95];
    const cols = [C.red, C.amber, C.red, C.amber, C.amber, C.green, C.green, C.amber];
    const names = ['GEAR', 'FUEL', 'HULL', 'CAUT', 'ENG', 'FLAP', 'LAND', 'THR'];
    for (const side of [-1, 1]) for (let i = 0; i < 8; i++) Mp.lamp(side * P.xCentre - 0.21 + i * 0.06, -0.272, 0.022, 0.010, warn[i], cols[i], names[i]);
    Mp.dial(-0.02, -0.235, 0.034, R.flap / 3, dialO({ a0: Math.PI * 0.9, sweep: Math.PI * 0.9, ticks: 3, major: 1, needle: C.white, name: 'FLAP' }));
    Mp.dial(0.08, -0.235, 0.034, clamp(0.5 + R.trim * 0.45, 0, 1), dialO({ a0: Math.PI * 1.25, sweep: Math.PI * 0.5, ticks: 4, major: 2, needle: C.amber, name: 'TRIM' }));
    Mp.dial(-0.12, -0.235, 0.034, clamp(R.hull, 0, 1) * 0.9, dialO({ ticks: 6, major: 2, arcs: [[0.6, 1, C.green]], name: 'HYD' }));
    Mp.dial(-0.22, -0.235, 0.034, R.fuel, dialO({ ticks: 8, major: 2, arcs: [[0, 0.15, C.red]], name: 'FUEL' }));
  }
  hotspotHalo(K, levHotspots(P, live), live);
}

// The overhead panel, one frame for the drawing and the hotspots. It is behind your head, so you read
// it turned round: across is −x and up is forward (docs/reference/cockpit-lettering.md rule 7). With
// across +x every label on it read mirrored.
const overheadPanel = (K, cx, tone, k) => K.panel([cx, -0.575, 0.199], [-1, 0, 0], [0, 1, 0], tone, k);

// ── THE CONTROLS YOU CAN TOUCH ────────────────────────────────────────────────
// The same `ck:*` ids cockpit.js already acts on, at the places the drawing puts them.
export function levHotspots(P, live) {
  const R = readLive(live), cx = P.xCentre;
  const out = [
    { id: 'yoke', p: YOKE(0, R), r: 0.12, kind: 'yoke' },
    { id: 'throttle', p: LEVER(P, R, 1).tip, r: 0.06, kind: 'throttle' },
    { id: 'ck:flaps', p: FLAPL(P, R).tip, r: 0.03, kind: 'click' },
    { id: 'ck:gear', p: GEARL(P, R), r: 0.03, kind: 'click' },
  ];
  const O = overheadPanel(makeKit(() => {}), cx);
  out.push({ id: 'ck:land', p: O.pt(0.19, 0.44, 0.01), r: 0.016, kind: 'click' });
  out.push({ id: 'ck:dome', p: O.pt(0.26, 0.44, 0.01), r: 0.016, kind: 'click' });
  return out;
}
