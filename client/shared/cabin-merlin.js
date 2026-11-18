// THE CORVANE MERLIN'S BODY, GLASS AND DOORS, STATED ONCE.
//
// Two things are built off this: the exterior (scripts/shapes/concepts/merlin.mjs writes
// mesh_merlin.json's body, glass, doors and ducts from it) and the cockpit (interior-merlin.js derives
// the room from it). Neither types its own numbers for the body, the glass or where the fans are, so
// the inside of the windscreen is the windscreen you see from outside.
//
// The Merlin is a two-seat mini VTOL built like a late-century wedge supercar: a long knife nose, the
// cab pushed forward under a steep raked windscreen that wraps into the side glass, a long louvred
// engine deck behind, a wing on the tail, and gull-wing doors, hinged on the roof rail. Four ducted fans
// stand out at the corners where the wheels would be, so the duct housings are the wheel arches.
// See docs/proposals/road-vtol.md.
//
// Frame: f fore, g right, h up, in model units (MERLIN_LENGTH_M over the compiled mesh's length, which
// the cockpit measures). An angle on a section is in degrees, 0 = the right waterline, +90 = the
// crown, -90 = the keel (scripts/shapes/fw-meshes/lib.mjs).
//
// Pure data and arithmetic: no imports, so the bake, the gates and the browser all read it.

// The body's stations, nose to tail: a super-ellipse section (`boxy` squares the flanks and belly),
// the same arithmetic emitLoft uses for `section: 'super'`. A knife nose barely off the ground, the
// windscreen climbing steeply from its foot at 0.38 to the roof at 0.08, the roof's peak over the
// seats, then the engine cover falling in a long straight line to a squared tail.
export const MERLIN_STATIONS = [
  [0.80, 0.040, 0.010, 0.012, -0.060, 0.2],
  [0.77, 0.130, 0.025, 0.035, -0.058, 0.5],
  [0.70, 0.190, 0.038, 0.050, -0.054, 0.6],
  [0.60, 0.215, 0.050, 0.062, -0.048, 0.65],
  [0.48, 0.228, 0.066, 0.072, -0.040, 0.65],
  [0.38, 0.236, 0.092, 0.082, -0.030, 0.6],
  [0.28, 0.242, 0.152, 0.090, -0.020, 0.5],
  [0.18, 0.246, 0.222, 0.094, -0.012, 0.45],
  [0.08, 0.248, 0.274, 0.098, -0.006, 0.45],
  [-0.04, 0.248, 0.290, 0.100, -0.004, 0.45],
  [-0.16, 0.246, 0.272, 0.100, 0.000, 0.48],
  [-0.28, 0.242, 0.212, 0.100, 0.004, 0.55],
  [-0.42, 0.236, 0.166, 0.098, 0.008, 0.6],
  [-0.56, 0.226, 0.136, 0.094, 0.012, 0.62],
  [-0.68, 0.212, 0.112, 0.086, 0.018, 0.64],
  [-0.76, 0.194, 0.098, 0.076, 0.024, 0.64],
  [-0.80, 0.176, 0.088, 0.068, 0.028, 0.62],
].map(([f, rg, rvT, rvB, cz, boxy]) => ({ f, rg, rvT, rvB, cz, boxy }));
// The loft's side count. ⚠ The glass below is whole faces of the loft (9 degrees a face), so changing
// this moves every pane.
export const MERLIN_SIDES = 40;

// Where the glass is, in (f, angle) on the body. `f` runs [aft, fore]; `a` [low, high]. Each is a run
// of whole loft faces, so the exterior glazes the loft itself rather than laying a pane on its skin.
// The side glass is mirrored for the left (a -> 180 - a).
export const MERLIN_GLASS = {
  // The windscreen: one canopy with no A-pillars, from its foot up over the roof to the peak above
  // the seats and down both sides to the waist at 9 degrees, so a nose-down pilot still sees ahead.
  windscreen: { f: [-0.04, 0.38], a: [9, 171] },
  // The door glass behind it, back to the B-pillar behind the seats.
  side: { f: [-0.16, -0.04], a: [9, 54] },
};
// The doors: gull-wing doors, hinged along the roof rail (aHi). Their seams are a little outside
// the glass; the top edge runs along the roof rail.
export const MERLIN_DOOR = { f: [-0.20, 0.32], aLo: -40, aHi: 56, hingeF: -0.20 };
// Inside: the tub floor, the firewall behind the seats, and the seats either side of the tunnel.
export const MERLIN_INSIDE = { floorH: -0.072, bulkheadF: -0.21, seatG: 0.098 };

// The fans: four ducts where the wheels would be. `at` is each duct's centre on the right side;
// the left is the mirror. The rotor disc sits in the duct's throat at `fanH`.
export const MERLIN_DUCTS = {
  at: [[0.50, 0.335], [-0.50, 0.335]],
  rOut: 0.128, rIn: 0.108, h0: -0.128, h1: -0.024, fanH: -0.07, fanR: 0.100,
};
// The ground under the feet, and the three feet: one under the nose, two under the engine.
export const MERLIN_GROUND_H = -0.200;
export const MERLIN_FEET = [[0.52, 0], [-0.42, 0.15], [-0.42, -0.15]];
// The rear pusher, a small duct in the tail between the lights.
export const MERLIN_PUSHER = { f: -0.80, h: 0.03, r: 0.05 };
// A Corvane Merlin is 4.6 m from the nose to the tail light bar.
export const MERLIN_LENGTH_M = 4.6;

// ── The body as a surface ────────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t;
// The section at any station, interpolated linearly between stations (exact at the stations, which
// is where emitLoft puts its vertices).
export function merlinSection(f) {
  const st = MERLIN_STATIONS;
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
export function merlinPoint(f, aDeg, out = 0) {
  const s = merlinSection(f), a = aDeg * Math.PI / 180;
  const e = 1 - s.boxy * 0.55, cs = Math.cos(a), sn = Math.sin(a);
  const rg = s.rg + out, rvT = s.rvT + out, rvB = s.rvB + out;
  const g = Math.sign(cs) * Math.pow(Math.abs(cs), e) * rg;
  const h = sn >= 0 ? Math.pow(sn, e) * rvT : -Math.pow(-sn, e) * rvB;
  return [f, g, s.cz + h];
}
// The glass as rectangles in (f, angle), both sides: what the cockpit cuts out of its walls.
export function merlinPanes() {
  const W = MERLIN_GLASS.windscreen, S = MERLIN_GLASS.side;
  return [
    { id: 'windscreen', f: W.f, a: W.a },
    { id: 'side', f: S.f, a: S.a },
    { id: 'side', f: S.f, a: [180 - S.a[1], 180 - S.a[0]] },
  ];
}
// Which pane (f, a) is in, or null.
export function merlinGlassAt(f, aDeg) {
  const a = ((aDeg % 360) + 540) % 360 - 180;
  for (const p of merlinPanes()) if (f >= p.f[0] && f <= p.f[1] && a >= p.a[0] && a <= p.a[1]) return p.id;
  return null;
}
// The loft's face indices k (k spans k*9 to (k+1)*9 degrees) covering [a0, a1].
export const faceKs = (a0, a1) => {
  const step = 360 / MERLIN_SIDES, out = [];
  for (let k = Math.round(a0 / step); k < Math.round(a1 / step); k++) out.push(((k % MERLIN_SIDES) + MERLIN_SIDES) % MERLIN_SIDES);
  return out;
};
