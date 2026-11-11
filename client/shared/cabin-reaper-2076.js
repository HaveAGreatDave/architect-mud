// THE REAPER 2076'S FUSELAGE, CANOPY, ENGINES, WING AND TAIL, STATED ONCE.
//
// Two things are built off this: the exterior (scripts/shapes/concepts/reaper-2076.mjs writes
// mesh_gunship_2076.json's fuselage, its glass, its engines, wing and tail from it) and the cockpit
// (interior-reaper-2076.js derives the room, the stores page and the hologram from it). Neither
// types its own numbers for the hull, the glass, the wing or the tail, so the inside of the canopy is
// the canopy you see from outside and the hologram is the aircraft you climbed into.
//
// The shape: a chined nose over the gun, which hangs exposed in a trough under the chin and runs
// back into the belly to its drum; a frameless bubble perched on a slab-sided armoured tub; then the
// body flares into a broad flat engine deck with both engines buried in it, and the deck runs aft
// into a beavertail between two fins canted hard out.
//
// Frame: f fore, g right, h up, in the Reaper's model units (the stock mesh's frame and scale: the
// gun's muzzles at f 1.0, the tail cone's apex at -1.08, the wheels touching at h -0.279).
// An angle on a section is in degrees, 0 = the right waterline, +90 = the crown, -90 = the keel
// (scripts/shapes/fw-meshes/lib.mjs).
//
// Pure data and arithmetic: no imports, so the bake, the gates and the browser all read it.

// [f, rg, rvT, rvB, cz, boxy], nose to tail. `boxy` flattens the flanks: the tub is a slab. The
// belly is shallow forward of the cockpit so the gun hangs in the open under the chin. Aft of the
// cockpit the body widens into the engine deck (rg to 0.172, boxy 0.9, a flat-topped slab) and
// narrows to the tail cone's apex as a beavertail.
// ⚠ NOTHING FORWARD OF f 0.22 MAY CHANGE without the cockpit gate: the room is built inside it.
export const RP_STATIONS = [
  [0.965, 0.012, 0.012, 0.012, 0.004, 0.3],
  [0.94, 0.034, 0.03, 0.026, 0.004, 0.55],
  [0.9, 0.054, 0.048, 0.036, 0.002, 0.7],
  [0.84, 0.07, 0.064, 0.044, 0.0, 0.78],
  [0.76, 0.084, 0.078, 0.062, 0.0, 0.82],
  [0.69, 0.094, 0.09, 0.09, 0.002, 0.84],
  [0.64, 0.1, 0.106, 0.118, 0.004, 0.82],
  [0.6, 0.104, 0.136, 0.13, 0.004, 0.7],
  [0.55, 0.106, 0.178, 0.136, 0.004, 0.6],
  [0.5, 0.108, 0.206, 0.14, 0.005, 0.54],
  [0.45, 0.11, 0.214, 0.14, 0.005, 0.54],
  [0.4, 0.11, 0.206, 0.14, 0.005, 0.56],
  [0.35, 0.11, 0.18, 0.14, 0.006, 0.6],
  [0.3, 0.112, 0.152, 0.14, 0.006, 0.66],
  [0.22, 0.112, 0.134, 0.14, 0.008, 0.72],
  [0.1, 0.126, 0.126, 0.136, 0.01, 0.78],
  [-0.05, 0.152, 0.12, 0.124, 0.018, 0.84],
  [-0.2, 0.168, 0.108, 0.106, 0.03, 0.88],
  [-0.35, 0.172, 0.098, 0.09, 0.04, 0.9],
  [-0.5, 0.168, 0.088, 0.074, 0.048, 0.9],
  [-0.65, 0.162, 0.074, 0.058, 0.056, 0.9],
  [-0.8, 0.15, 0.056, 0.042, 0.062, 0.9],
  [-0.92, 0.12, 0.036, 0.028, 0.064, 0.88],
  [-1.0, 0.072, 0.022, 0.018, 0.064, 0.75],
  [-1.05, 0.026, 0.01, 0.008, 0.064, 0.5],
].map(([f, rg, rvT, rvB, cz, boxy]) => ({ f, rg, rvT, rvB, cz, boxy }));
export const RP_APEX_FORE = [0.985, 0, 0.004];
export const RP_APEX_AFT = [-1.08, 0, 0.064];

// Where the glass is, as rectangles in (f, angle) on the hull. `f` runs [aft, fore]; `a` [low, high].
export const RP_GLASS = {
  // The windscreen: one curved armoured pane with no posts, joined to the bubble under a thin bow.
  // ⚠ ITS FORE EDGE IS BELOW THE EYE, so the straight-ahead look runs out over the nose.
  windscreen: { f: [0.585, 0.665], a: [30, 150], posts: [] },
  // The bubble, one piece from the bow to the canopy's aft hoop, down to the sill each side.
  bubble: { f: [0.33, 0.575], a: [26, 154] },
};
// The canopy's sill (where the bubble meets the rail) and its bow and aft hoop stations.
export const RP_CANOPY = { sillA: 24, bowF: 0.58, hoopF: 0.326, hingeF: 0.3 };

// Inside: the tub floor, the front wall under the windscreen, the armour bulkhead behind the seat,
// and the eye. The eye sits where the stock Reaper's pilot sat (interior-reaper.js: three tenths
// along its canopy), a metre over the tub floor, which is above the drum and the gun's breech.
export const RP_INSIDE = { floorH: 0.044, frontF: 0.665, bulkheadF: 0.385, eyeF: 0.47, eyeH: 0.172 };
// The A-10A is 16.26 m long; this model runs muzzle to tail cone, f 1.0 to -1.08, as the stock does.
export const A10_LENGTH_M = 16.26;
export const RP_M = A10_LENGTH_M / 2.08;

// The engines: two turbofans buried in the engine deck, still high out of the dust a gun throws up.
// Each breathes through a dorsal intake on the deck's shoulder (`fanF`, the mouth; the fan is round an
// S-duct, out of sight) and blows out of a flat slot nozzle over the beavertail (`tailF`). The axes toe
// in aft by `toe` degrees, so the nozzles sit closer together than the intakes.
//   g, h   the right engine's axis at the intake mouth; r the duct's radius
export const RP_ENGINES = { g: 0.112, h: 0.12, r: 0.048, fanF: 0.03, tailF: -0.8, toe: 2.1 };
// The right engine's axis at station f, [g, h]; the left is its mirror. The exterior's nacelle group
// yaws by `toe` about f 0, so this is its own arithmetic.
export function rpEngineAxis(f) {
  const E = RP_ENGINES;
  return [E.g + (f - E.fanF) * Math.sin(E.toe * Math.PI / 180), E.h];
}

// The wing, starboard, as lib.mjs's foil stations [{ g, le, te, h, t }] (`t` is the thickness against
// a 12% section): a thick inner panel flat to the gear pods, the outer panel swept and up 7 degrees,
// and raked tips. A strake runs from the tub's flank out into the inner leading edge.
export const RP_WING = [
  { g: 0, le: 0.2, te: -0.25, h: -0.034, t: 1.25 },
  { g: 0.34, le: 0.15, te: -0.24, h: -0.034, t: 1.15 },
  { g: 0.98, le: 0.0, te: -0.2, h: 0.044, t: 0.85 },
  { g: 1.08, le: -0.07, te: -0.185, h: 0.052, t: 0.6 },
];
export const RP_STRAKE = [
  { g: 0.1, le: 0.32, te: 0.06, h: -0.03, t: 0.22 },
  { g: 0.3, le: 0.158, te: 0.08, h: -0.034, t: 0.3 },
];

// The tail: two fins canted hard out on the deck's edges ahead of the nozzles, and a swept tailplane
// each side of the beavertail. A fin is built about its own root (`fin`, foil stations with
// the span in `g`, lib.mjs's axis 'g') and placed by rpFinXf: roll out by `cant`, pitch by `pitch` so
// its root follows the deck down, then move to `at`. That is the mesh group's own transform
// (vehicle-mesh.js applyXf), so the hologram draws the fin the exterior has.
export const RP_TAIL = {
  fin: [{ g: 0, le: -0.5, te: -0.84, h: 0, t: 0.9 }, { g: 0.24, le: -0.79, te: -0.96, h: 0, t: 0.75 }],
  cant: 26, pitch: 7, at: [0, 0.145, 0.175],
  stab: [{ g: 0.06, le: -0.78, te: -0.99, h: 0.07, t: 0.7 }, { g: 0.38, le: -0.93, te: -1.04, h: 0.066, t: 0.55 }],
};
// A point in the right fin's own frame (f, span up h, g across its thickness) to the aircraft's.
export function rpFinXf([f, g, h]) {
  const T = RP_TAIL, rr = -T.cant * Math.PI / 180, rp = T.pitch * Math.PI / 180;
  const cr = Math.cos(rr), sr = Math.sin(rr), cp = Math.cos(rp), sp = Math.sin(rp);
  const g1 = g * cr - h * sr, h1 = g * sr + h * cr;
  const f2 = f * cp - h1 * sp, h2 = f * sp + h1 * cp;
  return [f2 + T.at[0], g1 + T.at[1], h2 + T.at[2]];
}

// The gun: a seven-barrel rotary cannon on the centreline. Its muzzles end at f 1.0 (where the
// stock gun's do, which is where the renderer finds them); the barrel cluster turns about its axis.
export const RP_GUN = { f: [0.5, 1.0], h: -0.064, ring: 0.019, barrel: 0.0055, n: 7, housing: 0.036, drumF: [0.12, 0.46], drumR: 0.07 };

// The stores, starboard (each hangs its mirror to port): the missile rail outboard, the glide bomb,
// and the targeting pod inboard. The exterior hangs them here and the stores page draws them here.
export const RP_STORES = { missile: 0.9, bomb: 0.62, pod: 0.48 };

// ── The hull as a surface ────────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t;
// The section at any station, interpolated linearly between stations (exact at the stations, which
// is where emitLoft puts its vertices).
export function rpSection(f) {
  const st = RP_STATIONS;
  if (f >= st[0].f) return { ...st[0], f };
  for (let i = 0; i < st.length - 1; i++) {
    const A = st[i], B = st[i + 1];
    if (f <= A.f && f >= B.f) {
      const t = (A.f - f) / (A.f - B.f || 1);
      return { f, rg: lerp(A.rg, B.rg, t), rvT: lerp(A.rvT, B.rvT, t), rvB: lerp(A.rvB, B.rvB, t), cz: lerp(A.cz, B.cz, t), boxy: lerp(A.boxy, B.boxy, t) };
    }
  }
  return { ...st[st.length - 1], f };
}
// A point on the section at angle `aDeg`, grown by `out` (negative goes in). lib.mjs secPt exactly.
export function rpPoint(f, aDeg, out = 0) {
  const s = rpSection(f), a = aDeg * Math.PI / 180;
  const e = 1 - s.boxy * 0.55, cs = Math.cos(a), sn = Math.sin(a);
  const rg = s.rg + out, rvT = s.rvT + out, rvB = s.rvB + out;
  const g = Math.sign(cs) * Math.pow(Math.abs(cs), e) * rg;
  const h = sn >= 0 ? Math.pow(sn, e) * rvT : -Math.pow(-sn, e) * rvB;
  return [f, g, s.cz + h];
}
// Whether (f, a) is glass, and which pane.
export function rpGlassAt(f, aDeg) {
  const a = ((aDeg % 360) + 540) % 360 - 180;
  const inR = (r) => f >= r.f[0] && f <= r.f[1] && a >= r.a[0] && a <= r.a[1];
  for (const k of ['windscreen', 'bubble']) if (inR(RP_GLASS[k])) return k;
  return null;
}
