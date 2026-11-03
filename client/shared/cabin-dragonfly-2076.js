// THE DRAGONFLY 2076'S CABIN, STATED ONCE.
//
// Two things are built off this: the exterior (scripts/shapes/concepts/dragonfly-2076.mjs writes
// mesh_heli_2076.json's cabin pod and its glass from it) and the cockpit (interior-dragonfly-2076.js
// derives the room from it). Neither types its own numbers for the pod or for where the glass is, so
// the inside of the windscreen is the windscreen you see from outside.
//
// Frame: f fore, g right, h up, in the heli's model units. An angle on a section is in degrees,
// 0 = the right waterline, +90 = the crown, -90 = the keel (scripts/shapes/fw-meshes/lib.mjs).
//
// Pure data and arithmetic: no imports, so the bake, the gates and the browser all read it.

// The pod's stations, nose to tail: a super-ellipse section (`boxy` flattens the flanks and belly),
// the same arithmetic emitLoft uses for `section: 'super'`.
export const CAB_STATIONS = [
  [0.668, 0.012, 0.012, 0.012, 0.0, 0],
  [0.655, 0.05, 0.052, 0.046, 0.002, 0.05],
  [0.635, 0.085, 0.09, 0.075, 0.004, 0.08],
  [0.605, 0.118, 0.126, 0.1, 0.008, 0.1],
  [0.565, 0.148, 0.16, 0.124, 0.012, 0.13],
  [0.515, 0.175, 0.19, 0.146, 0.017, 0.15],
  [0.455, 0.198, 0.214, 0.165, 0.022, 0.17],
  [0.385, 0.216, 0.233, 0.18, 0.027, 0.19],
  [0.31, 0.229, 0.246, 0.192, 0.031, 0.2],
  [0.23, 0.237, 0.254, 0.2, 0.035, 0.21],
  [0.15, 0.24, 0.257, 0.204, 0.038, 0.21],
  [0.07, 0.238, 0.256, 0.204, 0.042, 0.21],
  [-0.01, 0.231, 0.25, 0.2, 0.047, 0.2],
  [-0.08, 0.218, 0.238, 0.191, 0.053, 0.19],
  [-0.14, 0.198, 0.219, 0.176, 0.059, 0.17],
  [-0.19, 0.172, 0.193, 0.155, 0.065, 0.15],
  [-0.23, 0.141, 0.16, 0.128, 0.071, 0.12],
  [-0.26, 0.106, 0.122, 0.097, 0.076, 0.09],
  [-0.28, 0.07, 0.083, 0.066, 0.08, 0.06],
].map(([f, rg, rvT, rvB, cz, boxy]) => ({ f, rg, rvT, rvB, cz, boxy }));

// The nose apex, glazed: the windscreen closes on it.
export const CAB_APEX = [0.672, 0, 0];

// Where the glass is, as rectangles in (f, angle) on the pod. `f` runs [aft, fore]; `a` [low, high].
// The door glass, the quarter lights and their frames are mirrored for the left side (a → 180 - a).
export const CAB_GLASS = {
  // One bubble from the nose back to the A-pillar, down to a chin line at -34° each side.
  windscreen: { f: [0.33, 0.668], a: [-34, 214] },
  // Door windows: A-pillar to B-pillar, sill at 8°, header at 74°.
  door: { f: [-0.03, 0.31], a: [8, 74] },
  // The skylight over the seats, between the roof rails.
  skylight: { f: [-0.03, 0.31], a: [84, 96] },
  // The rear quarter lights, behind the B-pillar (aft of the cabin's bulkhead, so luggage bay glass).
  quarter: { f: [-0.15, -0.06], a: [30, 66] },
};
// The gull-wing doors: their seams, a little bigger than the window, hinged at the roof rail.
export const CAB_DOOR = { f: [-0.05, 0.325], aLo: -42, aHi: 80 };
// Inside: the cabin floor, the bulkhead behind the seats (just aft of the B-pillar), and the seats.
export const CAB_INSIDE = { floorH: -0.1, bulkheadF: -0.06, seatG: 0.095 };
// The real EH216-S is 5.73 m long; this model runs nose apex to tail strobe, measured off the mesh.
export const EH216_LENGTH_M = 5.73;

// ── The pod as a surface ─────────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t;
// The section at any station, interpolated linearly between stations (exact at the stations, which
// is where emitLoft puts its vertices).
export function cabSection(f) {
  const st = CAB_STATIONS;
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
export function cabPoint(f, aDeg, out = 0) {
  const s = cabSection(f), a = aDeg * Math.PI / 180;
  const e = 1 - s.boxy * 0.55, cs = Math.cos(a), sn = Math.sin(a);
  const rg = s.rg + out, rvT = s.rvT + out, rvB = s.rvB + out;
  const g = Math.sign(cs) * Math.pow(Math.abs(cs), e) * rg;
  const h = sn >= 0 ? Math.pow(sn, e) * rvT : -Math.pow(-sn, e) * rvB;
  return [f, g, s.cz + h];
}
// Whether (f, a) is glass, and which pane, for either side.
export function cabGlassAt(f, aDeg) {
  const a = ((aDeg % 360) + 540) % 360 - 180;   // -180..180
  const inR = (r, aa) => f >= r.f[0] && f <= r.f[1] && aa >= r.a[0] && aa <= r.a[1];
  const W = CAB_GLASS.windscreen;
  const aw = a < W.a[0] ? a + 360 : a;           // the windscreen's range crosses 180
  if (inR(W, aw)) return 'windscreen';
  for (const k of ['door', 'skylight', 'quarter']) {
    const r = CAB_GLASS[k];
    if (inR(r, a) || inR(r, 180 - a)) return k;
  }
  return null;
}
