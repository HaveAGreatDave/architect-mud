// THE VIPER 2076'S FUSELAGE AND FLIGHT DECK, STATED ONCE.
//
// Two things are built off this: the exterior (scripts/shapes/concepts/viper-2076.mjs writes
// mesh_heli_armed_2076.json's fuselage and its glass from it) and the cockpit (interior-viper-2076.js
// derives the room from it). Neither types its own numbers for the hull or for where the glass is, so
// the inside of the windscreen is the windscreen you see from outside.
//
// Frame: f fore, g right, h up, in the armed heli's model units (the mesh draws them at `scale` 2,
// as mesh_heli_armed.json does). An angle on a section is in degrees, 0 = the right waterline,
// +90 = the crown, -90 = the keel (scripts/shapes/fw-meshes/lib.mjs).
//
// Pure data and arithmetic: no imports, so the bake, the gates and the browser all read it.

// The hull's stations, nose to tail: a super-ellipse section (`boxy` flattens the flanks and belly),
// the same arithmetic emitLoft uses for `section: 'super'`. A pointed radome, a flight deck that sits
// lower than the cabin roof, a deep cabin under the wing, and a tail cone that rises to the V-tail.
export const VP76_STATIONS = [
  [0.875, 0.008, 0.008, 0.008, -0.02, 0],
  [0.86, 0.03, 0.026, 0.028, -0.019, 0.08],
  [0.835, 0.052, 0.046, 0.048, -0.016, 0.12],
  [0.8, 0.076, 0.072, 0.068, -0.01, 0.18],
  [0.75, 0.1, 0.103, 0.087, -0.002, 0.24],
  [0.69, 0.12, 0.135, 0.102, 0.008, 0.3],
  [0.62, 0.135, 0.16, 0.112, 0.016, 0.34],
  [0.555, 0.144, 0.175, 0.118, 0.022, 0.38],
  [0.47, 0.149, 0.185, 0.122, 0.026, 0.4],
  [0.38, 0.151, 0.192, 0.126, 0.03, 0.42],
  [0.28, 0.152, 0.198, 0.128, 0.034, 0.44],
  [0.15, 0.152, 0.202, 0.13, 0.038, 0.45],
  [0.02, 0.151, 0.204, 0.13, 0.042, 0.45],
  [-0.12, 0.147, 0.2, 0.128, 0.046, 0.45],
  [-0.26, 0.137, 0.186, 0.118, 0.054, 0.43],
  [-0.4, 0.117, 0.158, 0.098, 0.064, 0.39],
  [-0.54, 0.093, 0.124, 0.074, 0.076, 0.35],
  [-0.68, 0.07, 0.092, 0.054, 0.088, 0.31],
  [-0.8, 0.052, 0.068, 0.04, 0.098, 0.27],
  [-0.9, 0.036, 0.048, 0.028, 0.106, 0.22],
  [-0.97, 0.022, 0.03, 0.018, 0.111, 0.14],
  [-1.01, 0.01, 0.014, 0.008, 0.114, 0.05],
].map(([f, rg, rvT, rvB, cz, boxy]) => ({ f, rg, rvT, rvB, cz, boxy }));

// The radome's tip and the tail cone's.
export const VP76_APEX = [0.882, 0, -0.02];
export const VP76_TAIL = [-1.025, 0, 0.115];

// Where the glass is, as rectangles in (f, angle) on the hull. `f` runs [aft, fore]; `a` [low, high].
// The door glass and the cabin windows are mirrored for the left side (a → 180 - a).
export const VP76_GLASS = {
  // One wrapped windscreen from the A-pillar arch to the radome's ring, from just above the
  // waterline on one side over the crown to the other: the flight deck sits in the glass's chin.
  windscreen: { f: [0.555, 0.79], a: [4, 176] },
  // The crew door windows, beside the seats: A-pillar to the door's aft frame, the sill at the
  // pilot's shoulder.
  door: { f: [0.37, 0.548], a: [20, 62] },
  // The cabin's windows, two each side in the sliding door and one ahead of it (exterior only: the
  // cockpit's bulkhead is forward of all of them).
  cabin: [{ f: [0.17, 0.235], a: [16, 44] }, { f: [0.05, 0.115], a: [16, 44] }, { f: [-0.07, -0.005], a: [16, 44] }],
};
// The crew doors: their seams, a little bigger than the window. They hinge forward, car fashion.
export const VP76_DOOR = { f: [0.355, 0.552], aLo: -24, aHi: 66 };
// The cabin's sliding door, each side: where its seam runs and the rail it hangs off.
export const VP76_SLIDER = { f: [-0.09, 0.255], aLo: -40, aHi: 52 };
// Inside: the deck, the bulkhead behind the seats, the pilot's seat (right) and the eye.
export const VP76_INSIDE = { floorH: 0.02, bulkheadF: 0.315, seatG: 0.072, eyeF: 0.445 };
// The MV-75 (V-280 Valor) is 15.4 m long; this model runs radome tip to tail cone, measured off the mesh.
export const MV75_LENGTH_M = 15.4;

// ── The hull as a surface ────────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t;
// The section at any station, interpolated linearly between stations (exact at the stations, which
// is where emitLoft puts its vertices).
export function vp76Section(f) {
  const st = VP76_STATIONS;
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
export function vp76Point(f, aDeg, out = 0) {
  const s = vp76Section(f), a = aDeg * Math.PI / 180;
  const e = 1 - s.boxy * 0.55, cs = Math.cos(a), sn = Math.sin(a);
  const rg = s.rg + out, rvT = s.rvT + out, rvB = s.rvB + out;
  const g = Math.sign(cs) * Math.pow(Math.abs(cs), e) * rg;
  const h = sn >= 0 ? Math.pow(sn, e) * rvT : -Math.pow(-sn, e) * rvB;
  return [f, g, s.cz + h];
}
// Whether (f, a) is flight-deck glass, and which pane, for either side.
export function vp76GlassAt(f, aDeg) {
  const a = ((aDeg % 360) + 540) % 360 - 180;   // -180..180
  const inR = (r, aa) => f >= r.f[0] && f <= r.f[1] && aa >= r.a[0] && aa <= r.a[1];
  if (inR(VP76_GLASS.windscreen, a)) return 'windscreen';
  const D = VP76_GLASS.door;
  if (inR(D, a) || inR(D, 180 - a)) return 'door';
  return null;
}

// ── The weapons and the effects, where the exterior puts them ──────────────────
// The wing tips' nacelles, the proprotors on them, and the Air-Launched Effects: eight tube-launched
// drones, four in a bank each side of the aft fuselage, that fly out to a box round the aircraft
// while the master arm is on (the `drones` channel, cockpit.js classAnim). The cockpit's effects page
// and its hologram read the same numbers, so the page shows the formation the exterior flies.
export const VP76_NACELLE = { g: 0.80, f: 0.035, hWing: 0.262, hRotor: 0.452, rRotor: 0.6 };
export const VP76_ALE = {
  // Each tube on the right flank as (f, angle on the section); its mouth stands `mouth` proud.
  tubes: [[-0.2, 40], [-0.265, 40], [-0.33, 40], [-0.395, 40]],
  mouth: 0.014,
  // Where each drone holds station once out (right side; the left is the mirror).
  posts: [[0.95, 1.55, 0.32], [0.3, 1.95, 0.18], [-0.45, 1.85, 0.38], [-1.15, 1.45, 0.22]],
};
// A tube's mouth, right side.
export const aleMouth = (i) => vp76Point(VP76_ALE.tubes[i][0], VP76_ALE.tubes[i][1], VP76_ALE.mouth);
