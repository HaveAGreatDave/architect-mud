// THE REAPER 2076'S FUSELAGE, CANOPY AND WINGMEN, STATED ONCE.
//
// Two things are built off this: the exterior (scripts/shapes/concepts/reaper-2076.mjs writes
// mesh_gunship_2076.json's fuselage, its glass and its two wingmen from it) and the cockpit
// (interior-reaper-2076.js derives the room, the wingmen page and the hologram from it). Neither
// types its own numbers for the hull, the glass or where the wingmen ride, so the inside of the
// canopy is the canopy you see from outside.
//
// The shape: a chined nose over the gun, which hangs exposed in a trough under the chin and runs
// back into the belly to its drum; a bubble canopy perched on a slab-sided armoured tub; a deep,
// flat-sided body over the wing; then a long tail cone to the twin fins.
//
// Frame: f fore, g right, h up, in the Reaper's model units (the stock mesh's frame and scale: the
// gun's muzzles at f 1.0, the tail cone's apex at -1.08, the wheels touching at h -0.279).
// An angle on a section is in degrees, 0 = the right waterline, +90 = the crown, -90 = the keel
// (scripts/shapes/fw-meshes/lib.mjs).
//
// Pure data and arithmetic: no imports, so the bake, the gates and the browser all read it.

// [f, rg, rvT, rvB, cz, boxy], nose to tail. `boxy` flattens the flanks: the tub is a slab. The
// belly is shallow forward of the cockpit so the gun hangs in the open under the chin.
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
  [0.1, 0.11, 0.124, 0.136, 0.01, 0.74],
  [-0.05, 0.104, 0.118, 0.124, 0.018, 0.72],
  [-0.2, 0.094, 0.11, 0.106, 0.028, 0.68],
  [-0.35, 0.084, 0.1, 0.088, 0.036, 0.62],
  [-0.5, 0.07, 0.088, 0.07, 0.046, 0.56],
  [-0.7, 0.054, 0.07, 0.052, 0.056, 0.48],
  [-0.88, 0.038, 0.052, 0.036, 0.062, 0.4],
  [-1.0, 0.022, 0.032, 0.022, 0.064, 0.3],
  [-1.05, 0.012, 0.018, 0.012, 0.064, 0.2],
].map(([f, rg, rvT, rvB, cz, boxy]) => ({ f, rg, rvT, rvB, cz, boxy }));
export const RP_APEX_FORE = [0.985, 0, 0.004];
export const RP_APEX_AFT = [-1.08, 0, 0.064];

// Where the glass is, as rectangles in (f, angle) on the hull. `f` runs [aft, fore]; `a` [low, high].
export const RP_GLASS = {
  // The windscreen: an armoured centre pane between two posts and a quarter pane each side of it.
  // ⚠ ITS FORE EDGE IS BELOW THE EYE, so the straight-ahead look runs out over the nose.
  windscreen: { f: [0.585, 0.665], a: [30, 150], posts: [64, 116] },
  // The bubble, one piece from the bow to the canopy's aft hoop, down to the sill each side.
  bubble: { f: [0.33, 0.575], a: [26, 154] },
};
// The canopy's sill (where the bubble meets the rail) and its bow and aft hoop stations.
export const RP_CANOPY = { sillA: 24, bowF: 0.58, hoopF: 0.326, hingeF: 0.3 };

// Inside: the tub floor, the panel ahead, the armour bulkhead behind the seat, and the eye. The eye
// sits where the stock Reaper's pilot sat (interior-reaper.js: three tenths along its canopy).
export const RP_INSIDE = { floorH: -0.11, frontF: 0.66, bulkheadF: 0.3, eyeF: 0.47, eyeH: 0.172 };
// The A-10A is 16.26 m long; this model runs muzzle to tail cone, f 1.0 to -1.08, as the stock does.
export const A10_LENGTH_M = 16.26;
export const RP_M = A10_LENGTH_M / 2.08;

// The engines: two turbofans high on the rear fuselage, where the stock TF34s are.
export const RP_ENGINES = { g: 0.205, h: 0.14, r: 0.072, fanF: -0.2, tailF: -0.63 };

// The gun: a seven-barrel rotary cannon on the centreline. Its muzzles end at f 1.0 (where the
// stock gun's do, which is where the renderer finds them); the barrel cluster turns about its axis.
export const RP_GUN = { f: [0.5, 1.0], h: -0.064, ring: 0.019, barrel: 0.0055, n: 7, housing: 0.036, drumF: [0.12, 0.46], drumR: 0.07 };

// The wingmen: two loyal-wingman drones after the Boeing MQ-28 Ghost Bat, one docked conformal on
// the top of each outer wing panel, nose forward, rolled to the panel's dihedral. While the weapons
// are armed they lift off and fly in formation off each wingtip, a little aft and above: `out` is
// how far the right one moves, [f, g, h] (g flips on the left). The exterior's `wingmen` channel,
// the cockpit's wingmen page and the hologram all read this, so the three agree.
//   dock    the drone's centre on the right wing, [f, g, h], on the skin
//   roll    the outer panel's dihedral, degrees
//   len     nose to tail; span, tip to tip
export const RP_WINGMEN = {
  dock: [-0.035, 0.7, 0.0285],
  roll: 7.0,
  len: 0.34, span: 0.27,
  lift: 0.05,
  out: [-0.36, 0.82, 0.06],
  // The channel's stretch: lift clear of the cradle first, then fly out.
  liftSpan: [0, 0.22], flySpan: [0.22, 1],
};
// Where the right wingman's centre is at channel value `t` (the left's is its mirror).
export function rpWingmanAt(t) {
  const W = RP_WINGMEN, k = Math.max(0, Math.min(1, t));
  const r = (s) => Math.max(0, Math.min(1, (k - s[0]) / (s[1] - s[0])));
  const a = r(W.liftSpan), b = r(W.flySpan);
  return [W.dock[0] + W.out[0] * b, W.dock[1] + W.out[1] * b, W.dock[2] + W.lift * a + W.out[2] * b];
}

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
