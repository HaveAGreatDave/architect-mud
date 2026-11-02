// THE LOCUST 2076'S FUSELAGE AND COCKPIT GLASS, STATED ONCE.
//
// Two things are built off this: the exterior (scripts/shapes/concepts/locust-2076.mjs writes
// mesh_locust_2076.json's fuselage and its glass from it) and the cockpit (interior-locust-2076.js
// derives the room from it). Neither types its own numbers for the hull or for where the glass is,
// so the inside of the windscreen is the windscreen you see from outside.
//
// The shape: an electric motor nacelle at the nose, then the slab-sided hopper, then a tall glass
// cockpit set high behind it for seeing the ground in a turn, then a tapering tail cone. The hopper
// top sits below the pilot's eye, so the view forward runs out over it.
//
// Frame: f fore, g right, h up, in the Locust's model units (the stock mesh's frame and scale).
// An angle on a section is in degrees, 0 = the right waterline, +90 = the crown, -90 = the keel
// (scripts/shapes/fw-meshes/lib.mjs).
//
// Pure data and arithmetic: no imports, so the bake, the gates and the browser all read it.

// [f, rg, rvT, rvB, cz, boxy], nose to tail. `boxy` flattens the flanks: the hopper is a slab.
export const LC_STATIONS = [
  [1.0, 0.048, 0.048, 0.048, 0.02, 0.2],
  [0.975, 0.06, 0.06, 0.062, 0.02, 0.3],
  [0.93, 0.068, 0.068, 0.072, 0.018, 0.4],
  [0.86, 0.075, 0.074, 0.078, 0.016, 0.5],
  [0.78, 0.08, 0.08, 0.084, 0.016, 0.6],
  [0.72, 0.09, 0.085, 0.09, 0.016, 0.72],
  [0.66, 0.1, 0.085, 0.096, 0.016, 0.8],
  [0.56, 0.104, 0.086, 0.1, 0.016, 0.82],
  [0.46, 0.104, 0.086, 0.1, 0.016, 0.82],
  [0.4, 0.104, 0.09, 0.1, 0.014, 0.8],
  [0.36, 0.104, 0.115, 0.1, 0.012, 0.72],
  [0.32, 0.104, 0.165, 0.1, 0.01, 0.62],
  [0.28, 0.103, 0.215, 0.1, 0.008, 0.56],
  [0.22, 0.101, 0.245, 0.1, 0.008, 0.52],
  [0.14, 0.098, 0.25, 0.098, 0.01, 0.52],
  [0.07, 0.094, 0.24, 0.094, 0.012, 0.52],
  [0.02, 0.088, 0.21, 0.088, 0.015, 0.5],
  [-0.04, 0.082, 0.165, 0.084, 0.02, 0.48],
  [-0.12, 0.072, 0.12, 0.074, 0.03, 0.45],
  [-0.24, 0.062, 0.088, 0.062, 0.038, 0.42],
  [-0.45, 0.05, 0.064, 0.048, 0.044, 0.4],
  [-0.7, 0.036, 0.05, 0.032, 0.05, 0.34],
  [-0.9, 0.022, 0.038, 0.018, 0.052, 0.28],
  [-0.97, 0.012, 0.022, 0.01, 0.052, 0.2],
].map(([f, rg, rvT, rvB, cz, boxy]) => ({ f, rg, rvT, rvB, cz, boxy }));
export const LC_APEX_AFT = [-0.99, 0, 0.052];

// Where the glass is, as rectangles in (f, angle) on the hull. `f` runs [aft, fore]; `a` [low, high].
// The side glass and the quarter lights are mirrored for the left side (a -> 180 - a).
export const LC_GLASS = {
  // The windscreen: across the front slope from the hopper's aft edge up to the roof.
  windscreen: { f: [0.27, 0.335], a: [24, 156] },
  // The side glass: tall, down to 12 degrees above the waterline, so the field is in it in a turn.
  side: { f: [0.06, 0.262], a: [12, 76] },
  // A skylight over the seat, between the roof rails.
  roof: { f: [0.08, 0.25], a: [84, 96] },
  // A small quarter light behind the seat.
  quarter: { f: [-0.05, 0.035], a: [30, 66] },
};
// The cockpit door on the left: its seam, a little bigger than the side glass.
export const LC_DOOR = { f: [0.045, 0.27], aLo: -30, aHi: 80 };
// Inside: the floor, the firewall-to-hopper wall ahead, the bulkhead behind the seat, and the eye.
export const LC_INSIDE = { floorH: -0.055, frontF: 0.345, bulkheadF: -0.04, eyeF: 0.13, eyeOverFloorM: 1.0 };
// The Air Tractor AT-802 is 10.95 m long; this model runs spinner apex to tail cone.
export const AT802_LENGTH_M = 10.95;

// The spray drones: five docked on the top of each wing, in cradles across the main box, ahead of the
// flaps. `g` is each cradle's span station on the right wing (the left is its mirror), `x` the chord
// fraction from the leading edge. While the aircraft sprays they lift out and fly in a line off each
// wingtip, a little aft and above the wing, to work the edges of the swath: `out(i)` is how far the
// i-th drone moves, [f, g, h], on the right (g flips on the left). The exterior's `spray` channel and
// the cockpit's drone page and hologram all read this, so the three agree.
export const LC_DRONES = {
  g: [0.26, 0.42, 0.58, 0.74, 0.9],
  x: 0.36,
  arm: 0.038, rotor: 0.027, guard: 0.03,
  out: (i) => [-0.1 - 0.05 * i, 1.32 + 0.17 * i - [0.26, 0.42, 0.58, 0.74, 0.9][i], 0.05 + 0.012 * i],
};

// ── The hull as a surface ────────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t;
// The section at any station, interpolated linearly between stations (exact at the stations, which
// is where emitLoft puts its vertices).
export function lcSection(f) {
  const st = LC_STATIONS;
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
export function lcPoint(f, aDeg, out = 0) {
  const s = lcSection(f), a = aDeg * Math.PI / 180;
  const e = 1 - s.boxy * 0.55, cs = Math.cos(a), sn = Math.sin(a);
  const rg = s.rg + out, rvT = s.rvT + out, rvB = s.rvB + out;
  const g = Math.sign(cs) * Math.pow(Math.abs(cs), e) * rg;
  const h = sn >= 0 ? Math.pow(sn, e) * rvT : -Math.pow(-sn, e) * rvB;
  return [f, g, s.cz + h];
}
// Whether (f, a) is glass, and which pane, for either side.
export function lcGlassAt(f, aDeg) {
  const a = ((aDeg % 360) + 540) % 360 - 180;
  const inR = (r, aa) => f >= r.f[0] && f <= r.f[1] && aa >= r.a[0] && aa <= r.a[1];
  for (const k of ['windscreen', 'roof']) if (inR(LC_GLASS[k], a)) return k;
  for (const k of ['side', 'quarter']) if (inR(LC_GLASS[k], a) || inR(LC_GLASS[k], 180 - a)) return k;
  return null;
}
