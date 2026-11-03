// THE MAYFLY 2076'S POD AND CANOPY, STATED ONCE.
//
// Two things are built off this: the exterior (scripts/shapes/concepts/mayfly-2076.mjs writes
// mesh_ultralight_2076.json's pod and its canopy from it) and the cockpit (interior-mayfly-2076.js
// derives the room from it). Neither types its own numbers for the pod or for where the glass is, so
// the inside of the canopy is the canopy you see from outside.
//
// Frame: f fore, g right, h up, in the Mayfly's model units (the Cessna's frame: f -1.0..0.8, span
// ±1.13, wheels on the ground at h -0.255). An angle on a section is in degrees, 0 = the right
// waterline, +90 = the crown, -90 = the keel (scripts/shapes/fw-meshes/lib.mjs).
//
// Pure data and arithmetic: no imports, so the bake, the gates and the browser all read it.

// The pod, nose to tail: a teardrop for one, deepest under the pilot, tapering into a tail that
// sweeps up to carry the aft wing, as the BlackFly's canoe does. A super-ellipse section (`boxy` flattens the flanks a little).
export const MAYFLY76_STATIONS = [
  [0.8, 0.016, 0.014, 0.016, -0.03, 0],
  [0.785, 0.045, 0.042, 0.046, -0.028, 0.04],
  [0.76, 0.074, 0.074, 0.078, -0.024, 0.07],
  [0.72, 0.1, 0.106, 0.11, -0.018, 0.1],
  [0.67, 0.122, 0.138, 0.138, -0.01, 0.12],
  [0.61, 0.138, 0.168, 0.16, -0.002, 0.14],
  [0.54, 0.149, 0.192, 0.175, 0.006, 0.16],
  [0.46, 0.155, 0.208, 0.184, 0.012, 0.17],
  [0.38, 0.157, 0.215, 0.188, 0.016, 0.17],
  [0.3, 0.156, 0.214, 0.187, 0.018, 0.17],
  [0.22, 0.152, 0.205, 0.182, 0.02, 0.16],
  [0.14, 0.144, 0.188, 0.172, 0.023, 0.15],
  [0.06, 0.13, 0.162, 0.156, 0.028, 0.14],
  [-0.02, 0.118, 0.135, 0.138, 0.036, 0.12],
  [-0.1, 0.104, 0.112, 0.118, 0.046, 0.1],
  [-0.18, 0.092, 0.094, 0.1, 0.056, 0.09],
  [-0.28, 0.08, 0.08, 0.084, 0.068, 0.08],
  [-0.4, 0.068, 0.07, 0.068, 0.082, 0.07],
  [-0.52, 0.058, 0.062, 0.056, 0.096, 0.06],
  [-0.64, 0.05, 0.056, 0.046, 0.11, 0.06],
  [-0.76, 0.042, 0.05, 0.038, 0.122, 0.05],
  [-0.86, 0.032, 0.04, 0.03, 0.13, 0.05],
  [-0.94, 0.02, 0.028, 0.02, 0.134, 0.04],
  [-0.985, 0.009, 0.013, 0.009, 0.136, 0.02],
].map(([f, rg, rvT, rvB, cz, boxy]) => ({ f, rg, rvT, rvB, cz, boxy }));

// The nose apex, under the lidar puck, and the tail's end, under the tail strobe.
export const MAYFLY76_APEX = [0.806, 0, -0.03];
export const MAYFLY76_TAIL = [-0.998, 0, 0.136];

// Where the glass is, as a rectangle in (f, angle) on the pod. `f` runs [aft, fore]; `a` [low, high].
// One bubble from behind the pilot's head to the nose, down past the elbows on both sides: the
// windscreen's range crosses 180, so the left side's low edge is 180 - a[0].
export const MAYFLY76_GLASS = {
  canopy: { f: [0.13, 0.75], a: [-9, 189] },
};
// The canopy's frame: it tilts forward on a hinge at its nose bow to let the pilot in, and its sill
// seals on a rail along each side. The bow is a station, the sills are angles.
export const MAYFLY76_FRAME = { bowF: 0.75, archF: 0.13, sillA: -9 };
// Inside: the floor, the bulkhead behind the seat (just inside the canopy's aft arch), one seat on
// the centreline.
export const MAYFLY76_INSIDE = { floorH: -0.14, bulkheadF: 0.1, seatG: 0 };
// Nose apex to boom end, measured off the compiled mesh in the cockpit. The Mayfly 2076 is a big
// ultralight for its class: a 172's footprint, a sixth of its weight.
export const MAYFLY76_LENGTH_M = 6.0;

// ── The pod as a surface ─────────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t;
// The section at any station, interpolated linearly between stations (exact at the stations, which
// is where emitLoft puts its vertices).
export function mayfly76Section(f) {
  const st = MAYFLY76_STATIONS;
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
export function mayfly76Point(f, aDeg, out = 0) {
  const s = mayfly76Section(f), a = aDeg * Math.PI / 180;
  const e = 1 - s.boxy * 0.55, cs = Math.cos(a), sn = Math.sin(a);
  const rg = s.rg + out, rvT = s.rvT + out, rvB = s.rvB + out;
  const g = Math.sign(cs) * Math.pow(Math.abs(cs), e) * rg;
  const h = sn >= 0 ? Math.pow(sn, e) * rvT : -Math.pow(-sn, e) * rvB;
  return [f, g, s.cz + h];
}
// Whether (f, a) is glass.
export function mayfly76GlassAt(f, aDeg) {
  const a = ((aDeg % 360) + 540) % 360 - 180;   // -180..180
  const C = MAYFLY76_GLASS.canopy;
  const aw = a < C.a[0] ? a + 360 : a;            // the canopy's range crosses 180
  return f >= C.f[0] && f <= C.f[1] && aw >= C.a[0] && aw <= C.a[1] ? 'canopy' : null;
}
