// THE CARCASS 2076'S FUSELAGE AND CANOPY, STATED ONCE.
//
// Two things are built off this: the exterior (scripts/shapes/concepts/carcass-2076.mjs writes
// mesh_wreck_2076.json's fuselage, its canopy glass, its wing and its tail from it) and the cockpit
// (interior-carcass-2076.js derives the room from it). Neither types its own numbers for the
// fuselage or for where the glass is, so the inside of the canopy is the canopy you see from outside.
//
// Frame: f fore, g right, h up, in the Carcass's model units (mesh_wreck.json: the prop hub at
// f 1.062, mains at f 0.44 on the ground at h -0.328, the tailwheel at f -0.955 on the ground at
// h -0.019, wing tips at g 1.535), so the 2076 body sits on the ground the way the Fly Baby does and
// at her 12.5°. An angle on a section is in degrees, 0 = the right waterline, +90 = the crown, -90 =
// the keel (scripts/shapes/fw-meshes/lib.mjs).
//
// Pure data and arithmetic: no imports, so the bake, the gates and the browser all read it.

// The fuselage's stations, nose to tail: a super-ellipse section (`boxy` flattens the flanks), the
// same arithmetic emitLoft uses for `section: 'super'`. The crown swells into the canopy over the seat
// and falls away into a slim tail cone. The nose is the engine's cowl, its face at f 1.04 the
// spinner's backplate, on the Fly Baby's own propeller station.
export const CR76_STATIONS = [
  [1.04, 0.050, 0.050, 0.052, 0.020, 0.10],
  [1.00, 0.074, 0.074, 0.078, 0.018, 0.20],
  [0.94, 0.091, 0.090, 0.098, 0.015, 0.30],
  [0.86, 0.101, 0.100, 0.108, 0.012, 0.35],
  [0.78, 0.107, 0.106, 0.112, 0.010, 0.38],
  [0.70, 0.111, 0.112, 0.114, 0.008, 0.40],
  [0.60, 0.115, 0.122, 0.116, 0.006, 0.42],
  [0.50, 0.119, 0.140, 0.118, 0.004, 0.42],
  [0.42, 0.122, 0.165, 0.118, 0.002, 0.42],
  [0.34, 0.124, 0.205, 0.118, 0.000, 0.42],
  [0.26, 0.125, 0.245, 0.118, 0.000, 0.42],
  [0.18, 0.126, 0.272, 0.118, 0.000, 0.42],
  [0.10, 0.126, 0.288, 0.117, 0.000, 0.42],
  [0.02, 0.125, 0.295, 0.116, 0.000, 0.42],
  [-0.06, 0.123, 0.292, 0.114, 0.002, 0.42],
  [-0.14, 0.119, 0.278, 0.110, 0.006, 0.40],
  [-0.22, 0.112, 0.250, 0.104, 0.010, 0.38],
  [-0.30, 0.102, 0.205, 0.096, 0.016, 0.36],
  [-0.40, 0.090, 0.160, 0.086, 0.022, 0.34],
  [-0.52, 0.076, 0.122, 0.074, 0.030, 0.30],
  [-0.66, 0.060, 0.090, 0.060, 0.040, 0.26],
  [-0.80, 0.044, 0.064, 0.046, 0.050, 0.22],
  [-0.92, 0.032, 0.046, 0.034, 0.058, 0.18],
  [-1.02, 0.020, 0.030, 0.022, 0.064, 0.12],
  [-1.08, 0.010, 0.016, 0.012, 0.066, 0.06],
].map(([f, rg, rvT, rvB, cz, boxy]) => ({ f, rg, rvT, rvB, cz, boxy }));
// The tail apex, under the rudder's heel.
export const CR76_TAIL = [-1.1, 0, 0.066];

// Where the glass is, as a rectangle in (f, angle) on the fuselage: `f` runs [aft, fore], `a` [low,
// high]. One blown bubble from the cowl's deck back to the turtle deck, sill to sill, the way the
// small composite single-seaters do it. Its edges are on the loft's own stations and on its 10°
// facets, so the hull is cut out under it exactly and the room inside can be seen through it.
export const CR76_GLASS = {
  bubble: { f: [-0.3, 0.42], a: [20, 160] },
};
// The bubble's frame: its foot across the front, its aft hoop, and the sill rails it slides on.
export const CR76_FRAMES = { foot: 0.42, hoop: -0.3, railA: 18 };
// Inside: the floor, the bulkhead behind the seat, the seat, the dash's foot and the firewall.
export const CR76_INSIDE = { floorH: -0.072, bulkheadF: -0.3, seatF: -0.02, panelF: 0.2, firewallF: 0.7 };
// The one real number the scale comes from: the span. The Fly Baby's is 8.38 m over 3.07 units of
// mesh, and the 2076 airframe keeps it, so a metre in the cockpit is a metre in the old tub.
export const CR76_SPAN_M = 8.38;
// The wing, as the exterior builds it: root, splice and tip stations (starboard). Low, straight-ish
// and tapered. The port panel outboard of the splice is a donor's (see the generator).
export const CR76_WING = {
  root: { g: 0.1, le: 0.405, te: -0.055, h: -0.082, t: 1.0 },
  splice: { g: 0.85, le: 0.375, te: -0.025, h: -0.05, t: 0.88 },
  tip: { g: 1.535, le: 0.33, te: 0.025, h: -0.022, t: 0.66 },
};
// The propeller: three composite blades on the Fly Baby's hub station.
export const CR76_PROP = { f: 1.064, h: 0.02, r: 0.29, blades: 3 };
// The flight recorder: an orange box in the tail cone behind a starboard access hatch, which is gone.
export const CR76_RECORDER = { f: [-0.8, -0.66], a: [-20, 30] };

// ── The fuselage as a surface ────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t;
// The section at any station, interpolated linearly between stations (exact at the stations, which
// is where emitLoft puts its vertices).
export function cr76Section(f) {
  const st = CR76_STATIONS;
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
export function cr76Point(f, aDeg, out = 0) {
  const s = cr76Section(f), a = aDeg * Math.PI / 180;
  const e = 1 - s.boxy * 0.55, cs = Math.cos(a), sn = Math.sin(a);
  const rg = s.rg + out, rvT = s.rvT + out, rvB = s.rvB + out;
  const g = Math.sign(cs) * Math.pow(Math.abs(cs), e) * rg;
  const h = sn >= 0 ? Math.pow(sn, e) * rvT : -Math.pow(-sn, e) * rvB;
  return [f, g, s.cz + h];
}
// Whether (f, a) is glass, and which pane, for either side.
export function cr76GlassAt(f, aDeg) {
  const a = ((aDeg % 360) + 540) % 360 - 180;
  const inR = (r) => f >= r.f[0] && f <= r.f[1] && a >= r.a[0] && a <= r.a[1];
  if (inR(CR76_GLASS.bubble)) return 'bubble';
  return null;
}
