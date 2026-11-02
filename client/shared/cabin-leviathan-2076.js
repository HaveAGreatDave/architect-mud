// THE LEVIATHAN 2076'S BODY, FLIGHT DECK AND GLASS, STATED ONCE.
//
// Two things are built off this: the exterior (scripts/shapes/concepts/leviathan-2076.mjs writes
// mesh_heavy_2076.json's centrebody, its flight deck cab and its glass from it) and the cockpit
// (interior-leviathan-2076.js derives the flight deck from the cab). Neither types its own numbers
// for the hull or for where the glass is, so the inside of the windscreen is the windscreen you see
// from outside.
//
// Frame: f fore, g right, h up, in the Leviathan's model units (the An-124's frame: f -1.12..1.08,
// span ±1.05, main wheels on the ground at h -0.285). An angle on a section is in degrees, 0 = the
// right waterline, +90 = the crown, -90 = the keel (scripts/shapes/fw-meshes/lib.mjs).
//
// Two lofts. The CENTREBODY is the blended wing's middle: a lifting body as wide as the hold, nose
// to trailing edge, its section a lens (boxy below zero sharpens the super-ellipse at the sides) that
// thins to the edge where the outer wing takes over. The CAB is the flight deck: a smaller loft
// standing proud on top of the nose, glazed at the front, sunk into the centrebody aft. The cargo
// visor is everything ahead of LEV76_VISOR.cut: the nose of the centrebody and the whole cab ride up
// together, as the ancestor's did, so the camera tilt cockpit.js applies to every heavy stays true.
//
// Pure data and arithmetic: no imports, so the bake, the gates and the browser all read it.

// ── The centrebody ───────────────────────────────────────────────────────────
// [f, half width, crown h, keel h, centre h, boxy]. The planform is a rounded ogive widening to the
// hold's full width by mid-chord, then straight to the trailing edge; the crown and keel follow a
// thick aerofoil, highest a third of the way back, closing to a thin trailing edge.
const BODY = [
  [1.06, 0.07, 0.04, -0.045, -0.004, -0.1],
  [1.04, 0.12, 0.058, -0.068, -0.003, -0.22],
  [1.01, 0.165, 0.07, -0.09, -0.002, -0.32],
  [0.97, 0.205, 0.084, -0.106, 0.0, -0.4],
  [0.92, 0.24, 0.1, -0.12, 0.002, -0.46],
  [0.85, 0.272, 0.12, -0.132, 0.005, -0.5],
  [0.77, 0.305, 0.143, -0.144, 0.01, -0.52],
  [0.68, 0.335, 0.168, -0.152, 0.014, -0.52],
  [0.6, 0.36, 0.188, -0.157, 0.018, -0.52],
  [0.5, 0.385, 0.204, -0.16, 0.02, -0.52],
  [0.38, 0.41, 0.214, -0.162, 0.02, -0.52],
  [0.22, 0.432, 0.219, -0.162, 0.02, -0.52],
  [0.05, 0.447, 0.217, -0.16, 0.02, -0.52],
  [-0.12, 0.456, 0.208, -0.152, 0.02, -0.52],
  [-0.3, 0.46, 0.19, -0.138, 0.02, -0.52],
  [-0.46, 0.46, 0.165, -0.118, 0.02, -0.52],
  [-0.6, 0.46, 0.136, -0.094, 0.02, -0.52],
  [-0.72, 0.46, 0.104, -0.066, 0.02, -0.52],
  [-0.82, 0.46, 0.07, -0.04, 0.02, -0.52],
  [-0.9, 0.46, 0.036, 0.006, 0.02, -0.52],
];
const toStation = ([f, rg, top, bot, cz, boxy]) => ({ f, rg, rvT: +(top - cz).toFixed(4), rvB: +(cz - bot).toFixed(4), cz, boxy });
export const LEV76_BODY = BODY.map(toStation);
// The nose apex of the centrebody, under the cab's chin, and the trailing edge's own line.
export const LEV76_BODY_APEX = [1.075, 0, -0.005];
export const LEV76_BODY_TE = -0.9;

// ── The flight deck cab ──────────────────────────────────────────────────────
// Standing proud of the nose: the windscreen wraps its front, a side window either side, and aft of
// the bulkhead it fairs down into the centrebody's crown.
const CAB = [
  [1.036, 0.03, 0.098, 0.07, 0.078, 0.2],
  [1.025, 0.05, 0.116, 0.064, 0.08, 0.36],
  [1.005, 0.064, 0.132, 0.056, 0.082, 0.5],
  [0.98, 0.073, 0.145, 0.046, 0.084, 0.58],
  [0.95, 0.078, 0.153, 0.036, 0.086, 0.62],
  [0.92, 0.08, 0.156, 0.03, 0.088, 0.64],
  [0.88, 0.08, 0.156, 0.03, 0.09, 0.64],
  [0.84, 0.077, 0.155, 0.036, 0.094, 0.62],
  [0.8, 0.07, 0.153, 0.05, 0.1, 0.58],
  [0.75, 0.056, 0.152, 0.08, 0.112, 0.5],
  [0.7, 0.036, 0.158, 0.11, 0.13, 0.4],
];
export const LEV76_CAB = CAB.map(toStation);
export const LEV76_CAB_APEX = [1.042, 0, 0.078];
export const LEV76_CAB_TAIL = [0.67, 0, 0.14];

// Where the glass is, as rectangles in (f, angle) on the cab. `f` runs [aft, fore]; `a` [low, high].
// The side windows are mirrored for the left side (a -> 180 - a).
export const LEV76_GLASS = {
  // One wraparound sheet over the cab's brow, waist to waist, split by three posts.
  windscreen: { f: [0.94, 1.036], a: [4, 176] },
  posts: [48, 90, 132],
  // A side window either side of the crew, aft of the windscreen's corner.
  side: { f: [0.875, 0.928], a: [14, 50] },
};

// ── The cargo visor ──────────────────────────────────────────────────────────
// Everything ahead of `cut` swings up about a hinge on the crown, by the fw_heavy row's own angle
// (visor.maxAng 1.2 rad), on the noseVisor channel, exactly as the ancestor's nose does.
export const LEV76_VISOR = { cut: 0.6, pivot: [0.596, 0, 0.188], swing: -(1.2 * 180 / Math.PI) };
// The hold behind it: a box inside the centrebody, and the ramp that walks down out of it.
export const LEV76_HOLD = { f0: 0.6, f1: -0.34, floor: -0.125, ceil: 0.16, halfW: 0.25, rampFoot: [1.04, -0.285], rampHalfW: 0.13 };

// Inside the cab: the deck floor, the bulkhead behind the seats with its doorway, how far you can
// see into the crew rest through it, and the seats' offset from the centreline.
export const LEV76_INSIDE = { floorH: 0.062, bulkheadF: 0.845, restF: 0.77, seatG: 0.018, eyeF: 0.93, doorHalfM: 0.32, doorTopM: 1.85 };
// The 2076 Leviathan runs from the cab's nose to the fin tips: an An-124's length (68.96 m), give or
// take, measured off the mesh in the cockpit.
export const LEV76_LENGTH_M = 70;

// ── The lofts as surfaces ────────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t;
function sectionOf(st, f) {
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
// A point on a section at angle `aDeg`, grown by `out` (negative goes in). lib.mjs secPt exactly.
function pointOf(s, aDeg, out) {
  const a = aDeg * Math.PI / 180;
  const e = 1 - s.boxy * 0.55, cs = Math.cos(a), sn = Math.sin(a);
  const rg = s.rg + out, rvT = s.rvT + out, rvB = s.rvB + out;
  const g = Math.sign(cs) * Math.pow(Math.abs(cs), e) * rg;
  const h = sn >= 0 ? Math.pow(sn, e) * rvT : -Math.pow(-sn, e) * rvB;
  return [s.f, g, s.cz + h];
}
export const levCabSection = (f) => sectionOf(LEV76_CAB, f);
export const levCabPoint = (f, aDeg, out = 0) => pointOf(levCabSection(f), aDeg, out);
export const levBodySection = (f) => sectionOf(LEV76_BODY, f);
export const levBodyPoint = (f, aDeg, out = 0) => pointOf(levBodySection(f), aDeg, out);
// The centrebody's upper and lower surface at (f, g): what the engines, fins and gear stand on.
export function levBodySurface(f, g, upper = true) {
  const s = levBodySection(f), e = 1 - s.boxy * 0.55;
  const c = Math.min(1, Math.abs(g) / s.rg);
  const cs = Math.pow(c, 1 / e), sn = Math.sqrt(Math.max(0, 1 - cs * cs));
  return upper ? s.cz + Math.pow(sn, e) * s.rvT : s.cz - Math.pow(sn, e) * s.rvB;
}
// Whether (f, a) on the cab is glass, and which pane, for either side.
export function levGlassAt(f, aDeg) {
  const a = ((aDeg % 360) + 540) % 360 - 180;
  const inR = (r, aa) => f >= r.f[0] && f <= r.f[1] && aa >= r.a[0] && aa <= r.a[1];
  if (inR(LEV76_GLASS.windscreen, a)) return 'windscreen';
  const S = LEV76_GLASS.side;
  if (inR(S, a) || inR(S, 180 - a)) return 'side';
  return null;
}
