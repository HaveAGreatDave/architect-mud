// THE MULE 2076'S FUSELAGE AND GLASS, STATED ONCE.
//
// Two things are built off this: the exterior (scripts/shapes/concepts/mule-2076.mjs writes
// mesh_prop_2076.json's fuselage and its glass from it) and the cockpit (interior-mule-2076.js
// derives the flight deck from it). Neither types its own numbers for the hull or for where the
// glass is, so the inside of the windscreen is the windscreen you see from outside.
//
// Frame: f fore, g right, h up, in the Mule's model units (the Twin Otter's frame: f -0.98..1.0,
// span ±1.24, main wheels on the ground at h -0.285). An angle on a section is in degrees, 0 = the
// right waterline, +90 = the crown, -90 = the keel (scripts/shapes/fw-meshes/lib.mjs).
//
// Pure data and arithmetic: no imports, so the bake, the gates and the browser all read it.

// The fuselage, nose to tail: a boxy freighter section (boxy 0.92 is nearly square with rounded
// corners), a sloped nose under a wraparound windscreen, a constant-section hold, and a tail that
// sweeps up over the rear ramp.
export const MULE76_STATIONS = [
  [1.0, 0.022, 0.018, 0.02, -0.066, 0.3],
  [0.985, 0.05, 0.036, 0.042, -0.064, 0.5],
  [0.955, 0.08, 0.054, 0.064, -0.06, 0.64],
  [0.91, 0.105, 0.07, 0.083, -0.054, 0.76],
  [0.86, 0.123, 0.083, 0.098, -0.047, 0.84],
  [0.81, 0.134, 0.098, 0.108, -0.038, 0.88],
  [0.76, 0.14, 0.117, 0.116, -0.028, 0.9],
  [0.71, 0.144, 0.134, 0.121, -0.019, 0.91],
  [0.66, 0.146, 0.146, 0.125, -0.011, 0.92],
  [0.6, 0.147, 0.153, 0.128, -0.006, 0.92],
  [0.5, 0.148, 0.156, 0.13, -0.003, 0.92],
  [0.3, 0.148, 0.157, 0.131, 0, 0.92],
  [0.05, 0.148, 0.157, 0.131, 0, 0.92],
  [-0.15, 0.146, 0.155, 0.128, 0.004, 0.91],
  [-0.3, 0.14, 0.15, 0.115, 0.016, 0.89],
  [-0.44, 0.127, 0.14, 0.092, 0.038, 0.85],
  [-0.58, 0.108, 0.124, 0.068, 0.064, 0.78],
  [-0.72, 0.085, 0.104, 0.048, 0.088, 0.68],
  [-0.84, 0.06, 0.082, 0.032, 0.106, 0.55],
  [-0.92, 0.036, 0.058, 0.02, 0.116, 0.4],
  [-0.96, 0.016, 0.034, 0.012, 0.12, 0.25],
].map(([f, rg, rvT, rvB, cz, boxy]) => ({ f, rg, rvT, rvB, cz, boxy }));

// The nose apex, under the lidar fairing.
export const MULE76_APEX = [1.004, 0, -0.066];
// The tail apex, over the ramp hinge.
export const MULE76_TAIL = [-0.972, 0, 0.121];

// Where the glass is, as rectangles in (f, angle) on the hull. `f` runs [aft, fore]; `a` [low, high].
// Everything but the windscreen is mirrored for the left side (a -> 180 - a).
export const MULE76_GLASS = {
  // One wraparound sheet from waist to waist over the sloping nose, split by four posts.
  windscreen: { f: [0.69, 0.85], a: [-4, 184] },
  // The posts, as angles: the centre post and the two that turn the front panes into side panes.
  posts: [40, 90, 140],
  // The eyebrow windows over the crew's heads, either side of the crown.
  eyebrow: { f: [0.6, 0.68], a: [52, 78] },
  // The crew door windows: a big pane in each crew door, beside the pilot.
  door: { f: [0.53, 0.67], a: [4, 40] },
  // Cabin portholes, few and small: a freighter needs light, not a view.
  portholes: [0.36, 0.2, 0.04, -0.4].map((f) => ({ f: [f - 0.032, f], a: [10, 28] })),
};
// The crew doors: a seam a little bigger than the window. The cargo door is on the left, aft of
// the wing, and the rear ramp is under the upswept tail (its seam, from below).
export const MULE76_DOOR = { f: [0.505, 0.685], aLo: -38, aHi: 46 };
export const MULE76_CARGO = { f: [-0.38, -0.08], aLo: -44, aHi: 44 };
export const MULE76_RAMP = { f: [-0.66, -0.3], aLo: -150, aHi: -30 };
// Inside: the flight deck floor, the bulkhead behind the seats with its doorway to the hold, the
// hold's far wall (as far as you can see through the doorway), the seats' offset from the centreline.
export const MULE76_INSIDE = { floorH: -0.07, bulkheadF: 0.5, holdF: 0.36, seatG: 0.055, doorHalfM: 0.3, doorTopM: 1.75 };
// The 2076 Mule runs nose lidar to tailplane tip; a stretched Twin Otter (15.77 m) with the nose
// sensors and the T-tail added, measured off the mesh in the cockpit.
export const MULE76_LENGTH_M = 16.2;

// ── The hull as a surface ────────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t;
// The section at any station, interpolated linearly between stations (exact at the stations, which
// is where emitLoft puts its vertices).
export function muleSection(f) {
  const st = MULE76_STATIONS;
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
export function mulePoint(f, aDeg, out = 0) {
  const s = muleSection(f), a = aDeg * Math.PI / 180;
  const e = 1 - s.boxy * 0.55, cs = Math.cos(a), sn = Math.sin(a);
  const rg = s.rg + out, rvT = s.rvT + out, rvB = s.rvB + out;
  const g = Math.sign(cs) * Math.pow(Math.abs(cs), e) * rg;
  const h = sn >= 0 ? Math.pow(sn, e) * rvT : -Math.pow(-sn, e) * rvB;
  return [f, g, s.cz + h];
}
// Whether (f, a) is glass, and which pane, for either side.
export function muleGlassAt(f, aDeg) {
  const a = ((aDeg % 360) + 540) % 360 - 180;   // -180..180
  const inR = (r, aa) => f >= r.f[0] && f <= r.f[1] && aa >= r.a[0] && aa <= r.a[1];
  const W = MULE76_GLASS.windscreen;
  const aw = a < W.a[0] ? a + 360 : a;            // the windscreen's range crosses 180
  if (inR(W, aw)) return 'windscreen';
  for (const k of ['eyebrow', 'door']) {
    const r = MULE76_GLASS[k];
    if (inR(r, a) || inR(r, 180 - a)) return k;
  }
  for (const r of MULE76_GLASS.portholes) if (inR(r, a) || inR(r, 180 - a)) return 'porthole';
  return null;
}
