// THE GRASSHOPPER 2076'S POD AND CANOPY, STATED ONCE.
//
// Two things are built off this: the exterior (scripts/shapes/concepts/grasshopper-2076.mjs writes
// mesh_grasshopper_2076.json's pod, its canopy glass and its wing from it) and the cockpit
// (interior-grasshopper-2076.js derives the room from it). Neither types its own numbers for the pod
// or for where the glass is, so the inside of the bubble is the bubble you see from outside.
//
// Frame: f fore, g right, h up, in the Cub's model units (mesh_grasshopper.json: spinner apex at
// f 0.865, mains at f 0.34, tailwheel at f -1.005, wheels on the ground at h -0.317), so the 2076
// body sits on the ground the way the Cub does. An angle on a section is in degrees, 0 = the right
// waterline, +90 = the crown, -90 = the keel (scripts/shapes/fw-meshes/lib.mjs).
//
// Pure data and arithmetic: no imports, so the bake, the gates and the browser all read it.

// The pod's stations, nose to tail: a super-ellipse section (`boxy` flattens the flanks), the same
// arithmetic emitLoft uses for `section: 'super'`. The crown (`rvT`) swells into the canopy over the
// two seats, highest over the pilot in front, and falls away into the tail boom behind the rear seat.
// The nose is the motor's cowl: its face at f 0.80 is the spinner's backplate, at the Cub's own
// propeller station.
export const GH76_STATIONS = [
  [0.80, 0.040, 0.040, 0.040, 0.030, 0.10],
  [0.77, 0.050, 0.050, 0.050, 0.028, 0.14],
  [0.72, 0.060, 0.060, 0.060, 0.024, 0.20],
  [0.66, 0.068, 0.072, 0.068, 0.019, 0.26],
  [0.61, 0.074, 0.100, 0.072, 0.015, 0.30],
  [0.55, 0.078, 0.140, 0.075, 0.012, 0.32],
  [0.48, 0.080, 0.170, 0.077, 0.010, 0.34],
  [0.41, 0.081, 0.186, 0.077, 0.010, 0.34],
  [0.34, 0.081, 0.192, 0.077, 0.010, 0.34],
  [0.27, 0.081, 0.190, 0.077, 0.010, 0.34],
  [0.20, 0.080, 0.182, 0.076, 0.012, 0.34],
  [0.12, 0.079, 0.174, 0.075, 0.014, 0.34],
  [0.04, 0.077, 0.164, 0.072, 0.016, 0.33],
  [-0.04, 0.072, 0.146, 0.066, 0.020, 0.31],
  [-0.12, 0.064, 0.112, 0.058, 0.026, 0.28],
  [-0.24, 0.054, 0.080, 0.048, 0.034, 0.24],
  [-0.40, 0.042, 0.058, 0.038, 0.044, 0.20],
  [-0.60, 0.031, 0.042, 0.028, 0.056, 0.16],
  [-0.80, 0.022, 0.032, 0.020, 0.068, 0.12],
  [-0.98, 0.014, 0.022, 0.013, 0.080, 0.08],
  [-1.03, 0.009, 0.013, 0.008, 0.083, 0.04],
].map(([f, rg, rvT, rvB, cz, boxy]) => ({ f, rg, rvT, rvB, cz, boxy }));
// The tail apex, under the rudder's foot.
export const GH76_TAIL = [-1.04, 0, 0.083];

// Where the glass is, as rectangles in (f, angle) on the pod: `f` runs [aft, fore], `a` [low, high].
// The pilot's bubble runs from the windscreen's foot back to the hoop, from sill to sill over the
// crown. Behind the hoop the crown is the wing's pylon, so the rear seat has a window each side of it
// (`rear`, mirrored for the left: a -> 180 - a).
export const GH76_GLASS = {
  bubble: { f: [0.165, 0.625], a: [14, 166] },
  rear: { f: [-0.06, 0.15], a: [14, 70] },
};
// The canopy's frames: the hoop between the bubble and the rear windows (where the bubble hinges up
// and forward on a gas strut), and the pylon's foot along the crown behind it.
export const GH76_FRAMES = { hoop: 0.158, pylonA: [74, 106] };
// Inside: the floor, the bulkhead behind the rear seat, the two seats in tandem (the pilot in front;
// the rear seat watches the sensor), and the panel's foot under the windscreen.
export const GH76_INSIDE = { floorH: -0.045, bulkheadF: -0.075, pilotF: 0.33, rearF: 0.05, panelF: 0.56 };
// The one real number the scale comes from: the span. A solar scout's wing is long; the Velis
// Electro's is 10.7 m and the Zephyr's 25 m. This one is 14.4 m, so the pod (0.75 m across) is a
// Cub's width and the room is honest metres.
export const SCOUT_SPAN_M = 14.4;
// The wing, as the exterior builds it: root, kink and tip stations (starboard). It sits on a pylon
// over the rear seat, its leading edge just behind the pilot's head, and its dihedral grows outboard
// as a Zephyr's does in flight.
export const GH76_WING = {
  root: { g: 0, le: 0.13, te: -0.165, h: 0.238, t: 1.0 },
  kink: { g: 1.0, le: 0.116, te: -0.134, h: 0.272, t: 0.86 },
  tip: { g: 1.565, le: 0.098, te: -0.104, h: 0.318, t: 0.7 },
};
// The propeller: its hub on the spinner's backplate, as the Cub's is (aircraft3d.js PROP_STATIONS).
export const GH76_PROP = { f: 0.812, h: 0.03, r: 0.2, blades: 3 };
// The sensor ball under the chin: a gimballed electro-optical turret on a short mast.
export const GH76_BALL = { f: 0.585, h: -0.118, r: 0.042 };

// ── The pod as a surface ─────────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t;
// The section at any station, interpolated linearly between stations (exact at the stations, which
// is where emitLoft puts its vertices).
export function gh76Section(f) {
  const st = GH76_STATIONS;
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
export function gh76Point(f, aDeg, out = 0) {
  const s = gh76Section(f), a = aDeg * Math.PI / 180;
  const e = 1 - s.boxy * 0.55, cs = Math.cos(a), sn = Math.sin(a);
  const rg = s.rg + out, rvT = s.rvT + out, rvB = s.rvB + out;
  const g = Math.sign(cs) * Math.pow(Math.abs(cs), e) * rg;
  const h = sn >= 0 ? Math.pow(sn, e) * rvT : -Math.pow(-sn, e) * rvB;
  return [f, g, s.cz + h];
}
// Whether (f, a) is glass, and which pane, for either side.
export function gh76GlassAt(f, aDeg) {
  const a = ((aDeg % 360) + 540) % 360 - 180;
  const inR = (r, aa) => f >= r.f[0] && f <= r.f[1] && aa >= r.a[0] && aa <= r.a[1];
  if (inR(GH76_GLASS.bubble, a)) return 'bubble';
  if (inR(GH76_GLASS.rear, a) || inR(GH76_GLASS.rear, 180 - a)) return 'rear';
  return null;
}
