// THE SHRIKE 2076'S HULL AND CANOPY, STATED ONCE.
//
// Two things are built off this: the exterior (scripts/shapes/concepts/shrike-2076.mjs writes
// mesh_divebomber_2076.json's hull, its canopy glass, its wing and its bay from it) and the cockpit
// (interior-shrike-2076.js derives the room from it). Neither types its own numbers for the hull or
// for where the glass is, so the inside of the canopy is the canopy you see from outside.
//
// Frame: f fore, g right, h up, in the Stuka's model units (mesh_divebomber.json: mains at f 0.21 on
// the ground at h -0.28, tailwheel at f -0.875 on the ground at h -0.104), so the 2076 body sits on
// the ground at the Stuka's 9 degrees and the flight view frames it the same. One unit is 5.34 m,
// the Ju 87's own scale (interior-shrike.js SHRIKE_LEN_M over its 2.06 units).
//
// Pure data and arithmetic: no imports, so the bake, the gates and the browser all read it.

export const SH76_M_PER_UNIT = 5.34;

// ── The section ──────────────────────────────────────────────────────────────
// Not a super-ellipse: a chined hull. Each station is a half-section, keel to crown, through seven
// control points, mirrored for the left side:
//   C0 the keel on the centreline           (0, -bot)
//   C1 the flat belly's edge                (kw·w, -bot·0.97)   the bomb bay's doors lie on this flat
//   C2 the lower flank                      (0.88·w, -bot·0.40)
//   C3 the chine, sharp                     (w, 0)              the hard edge that runs nose to tail
//   C4 the upper flank                      (fw·w, top·0.40)    the canopy's sill sits here
//   C5 the shoulder                         (sw·w, top·0.86)
//   C6 the crown on the centreline          (0, top)
// all measured from the chine's height `cz`. Each span between control points is cut into SEG pieces
// and bowed outward by BOW of its length, so the crown and shoulders are round and the chine is a
// knife.
const SEG = [2, 3, 2, 2, 3, 3];
const BOW = [0.02, 0.05, 0.03, 0.03, 0.1, 0.14];
// Points per half-section, keel to crown inclusive, and the ring (right side up, left side down).
export const SH76_HALF = SEG.reduce((a, b) => a + b, 0) + 1;   // 16
export const SH76_RING = (SH76_HALF - 1) * 2;                    // 30
// Ring indices of the control points, for anything placed on the skin by landmark.
export const SH76_K = { keel: 0, belly: 2, lower: 5, chine: 7, upper: 9, shoulder: 12, crown: 15 };

// The key stations, nose to tail: [f, w, cz, top, bot, kw, fw, sw].
// The nose is a long drooping beak (the Stuka's hook, kept) with a sensor chin under it and the chin
// intake under that (its duct is its own part, below); the canopy swells the crown from the
// windscreen's foot at 0.66 back to 0.20; the belly is flat over the bomb bay (kw); the tail tapers
// to the nozzle at -0.93.
const KEYS = [
  [1.2, 0.003, -0.068, 0.003, 0.003, 0.3, 0.84, 0.5],
  [1.15, 0.018, -0.058, 0.014, 0.014, 0.3, 0.84, 0.5],
  [1.09, 0.032, -0.047, 0.026, 0.026, 0.3, 0.84, 0.5],
  [1.02, 0.046, -0.036, 0.038, 0.04, 0.32, 0.84, 0.5],
  [0.94, 0.06, -0.026, 0.05, 0.054, 0.34, 0.84, 0.5],
  [0.86, 0.071, -0.016, 0.062, 0.064, 0.36, 0.84, 0.5],
  [0.78, 0.08, -0.01, 0.074, 0.072, 0.38, 0.84, 0.5],
  [0.72, 0.085, -0.006, 0.086, 0.078, 0.4, 0.84, 0.5],
  [0.66, 0.09, -0.002, 0.104, 0.082, 0.44, 0.86, 0.52],
  [0.6, 0.092, 0, 0.13, 0.086, 0.48, 0.86, 0.56],
  [0.53, 0.094, 0.001, 0.154, 0.09, 0.52, 0.84, 0.6],
  [0.46, 0.095, 0.002, 0.166, 0.093, 0.56, 0.84, 0.62],
  [0.39, 0.096, 0.003, 0.17, 0.095, 0.6, 0.84, 0.62],
  [0.32, 0.097, 0.004, 0.166, 0.097, 0.64, 0.84, 0.6],
  [0.26, 0.097, 0.005, 0.154, 0.098, 0.66, 0.84, 0.56],
  [0.2, 0.097, 0.007, 0.136, 0.098, 0.68, 0.84, 0.5],
  [0.12, 0.097, 0.009, 0.118, 0.098, 0.68, 0.84, 0.46],
  [0.04, 0.096, 0.011, 0.108, 0.098, 0.68, 0.84, 0.44],
  [-0.06, 0.094, 0.014, 0.102, 0.096, 0.68, 0.84, 0.42],
  [-0.18, 0.089, 0.017, 0.097, 0.088, 0.6, 0.84, 0.42],
  [-0.32, 0.081, 0.022, 0.091, 0.074, 0.5, 0.84, 0.42],
  [-0.48, 0.071, 0.028, 0.083, 0.06, 0.44, 0.84, 0.42],
  [-0.64, 0.062, 0.034, 0.074, 0.048, 0.4, 0.84, 0.42],
  [-0.8, 0.055, 0.04, 0.066, 0.04, 0.4, 0.84, 0.42],
  [-0.93, 0.05, 0.044, 0.06, 0.036, 0.4, 0.84, 0.42],
].map(([f, w, cz, top, bot, kw, fw, sw]) => ({ f, w, cz, top, bot, kw, fw, sw }));
// The stations the hull is skinned through: every key, and between each pair a station on the
// Catmull-Rom curve through its neighbours, so the beak and the canopy bend smoothly rather than in
// straight bays. A key station stays exactly where it is (the glass, the bay and the wing use them).
const CR = (p0, p1, p2, p3) => (-p0 + 9 * p1 + 9 * p2 - p3) / 16;   // the curve's value halfway from p1 to p2
export const SH76_STATIONS = KEYS.flatMap((B, i) => {
  if (i === KEYS.length - 1) return [B];
  const A = KEYS[Math.max(0, i - 1)], Cc = KEYS[i + 1], D = KEYS[Math.min(KEYS.length - 1, i + 2)], m = {};
  for (const k of Object.keys(B)) m[k] = Math.round(CR(A[k], B[k], Cc[k], D[k]) * 1e5) / 1e5;
  m.f = Math.round((B.f + Cc.f) / 2 * 1e5) / 1e5;
  return [B, m];
});

// Where the glass is: the canopy, as (f, ring index) on the hull, both sides of the crown. The
// windscreen runs from its foot at f 0.66 to the bow at 0.53; the canopy from there to its aft edge
// at 0.20. From the upper flank (C4, the sill) over the crown to the other sill.
export const SH76_GLASS = { f: [0.2, 0.66], bow: 0.53, k: [SH76_K.upper, SH76_RING - SH76_K.upper] };
// The bomb bay: a hole in the flat belly between the knees, closed by two doors hinged at its edges.
export const SH76_BAY = { f: [-0.18, 0.2], k: SH76_K.belly };
// The chin intake, where the Stuka's radiator hung: a duct under the belly, U-shaped in section, its
// mouth raked so the lower lip juts forward like a jaw under the beak. Stations [f, half-width,
// bottom h]; its top is buried in the hull at `topH`. The mouth's top edge is at the first station's
// f and its lower lip at `lipF`.
export const SH76_INTAKE = {
  topH: -0.05, lipF: 0.785,
  stations: [[0.725, 0.06, -0.136], [0.66, 0.064, -0.142], [0.56, 0.065, -0.141], [0.44, 0.062, -0.132], [0.34, 0.054, -0.118], [0.26, 0.04, -0.104], [0.21, 0.02, -0.096]],
};
// The nozzle at the tail: a flattened exit, wider than tall, at the last station.
export const SH76_NOZZLE = { f: -0.93, rw: 0.044, rh: 0.03, h: 0.042 };
// Inside: the floor, the seat (the pilot's hip), the panel's foot under the windscreen, the bulkhead
// behind the seat. The eye is over the hip; interior-shrike-2076.js puts it there.
export const SH76_INSIDE = { floorH: -0.03, pilotF: 0.37, panelF: 0.6, bulkheadF: 0.2 };

// The wing (starboard): an inverted gull, the Stuka's, cranked and swept. Down from the root to the
// knee where the legs hang, then up to the crank, and up and further back to a raked tip.
export const SH76_WING = {
  root: { g: 0, le: 0.36, te: -0.24, h: -0.012, t: 1.1 },
  inner: { g: 0.17, le: 0.335, te: -0.225, h: -0.062, t: 1.0 },
  knee: { g: 0.33, le: 0.29, te: -0.2, h: -0.096, t: 0.9 },
  crank: { g: 0.7, le: 0.17, te: -0.15, h: -0.01, t: 0.74 },
  tip: { g: 1.06, le: -0.0, te: -0.115, h: 0.068, t: 0.6 },
};
// The legs: fixed talons from the knees (the Stuka's trousers), the wheels exactly where hers were
// so the body rests where the class's contact geometry says it does.
export const SH76_GEAR = { main: { f: 0.21, g: 0.33, h: -0.24, r: 0.04, hw: 0.013 }, tail: { f: -0.875, h: -0.082, r: 0.022, hw: 0.009 } };

// ── The hull as a surface ────────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t;
export function sh76Station(f) {
  const st = SH76_STATIONS;
  if (f >= st[0].f) return { ...st[0], f };
  for (let i = 0; i < st.length - 1; i++) {
    const A = st[i], B = st[i + 1];
    if (f <= A.f && f >= B.f) {
      const t = (A.f - f) / (A.f - B.f || 1), o = { f };
      for (const k of ['w', 'cz', 'top', 'bot', 'kw', 'fw', 'sw']) o[k] = lerp(A[k], B[k], t);
      return o;
    }
  }
  return { ...st[st.length - 1], f };
}
// The half-section's points, keel to crown, as [g, h] (g >= 0), with `out` pushed along the normal.
export function sh76Half(s, out = 0) {
  const C = [[0, -s.bot], [s.kw * s.w, -s.bot * 0.97], [s.w * 0.88, -s.bot * 0.4], [s.w, 0], [s.w * s.fw, s.top * 0.4], [s.w * s.sw, s.top * 0.86], [0, s.top]];
  const pts = [];
  for (let i = 0; i < SEG.length; i++) {
    const [a, b] = [C[i], C[i + 1]], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    // The outward normal of a span walked keel to crown on the right side is (dy, -dx).
    const nx = dy / L, ny = -dx / L;
    for (let j = i ? 1 : 0; j <= SEG[i]; j++) {
      const u = j / SEG[i], bow = BOW[i] * L * Math.sin(Math.PI * u);
      pts.push([a[0] + dx * u + nx * bow, a[1] + dy * u + ny * bow]);
    }
  }
  if (!out) return pts.map(([g, h]) => [g, s.cz + h]);
  // Pushed out along each point's own normal (from its neighbours), the centreline points straight.
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let nx = b[1] - a[1], ny = -(b[0] - a[0]);
    if (i === 0) { nx = 0; ny = -1; } else if (i === pts.length - 1) { nx = 0; ny = 1; }
    const l = Math.hypot(nx, ny) || 1;
    return [Math.max(0, p[0] + nx / l * out), s.cz + p[1] + ny / l * out];
  });
}
// A point on the hull at station f, ring index k (0 keel, 15 crown, 30 keel again; fractional is
// fine; over 15 is the left side), `out` proud of the skin. Returns [f, g, h].
export function sh76Point(f, k, out = 0) {
  const s = sh76Station(f), H = sh76Half(s, out), n = SH76_HALF - 1;
  let kk = ((k % SH76_RING) + SH76_RING) % SH76_RING, side = 1;
  if (kk > n) { kk = SH76_RING - kk; side = -1; }
  const i = Math.min(n - 1, Math.floor(kk)), t = kk - i;
  const g = lerp(H[i][0], H[i + 1][0], t), h = lerp(H[i][1], H[i + 1][1], t);
  return [f, side * g, h];
}
// Whether (f, g, h) is inside the hull's section at f (the cockpit gate's inside-the-skin test).
export function sh76Inside(f, g, h, slack = 0) {
  const s = sh76Station(f), H = sh76Half(s, slack), ag = Math.abs(g);
  // Below the keel or over the crown is outside; otherwise inside if within the half-width at h.
  if (h < H[0][1] || h > H[H.length - 1][1]) return false;
  for (let i = 0; i < H.length - 1; i++) {
    const [g0, h0] = H[i], [g1, h1] = H[i + 1];
    if ((h - h0) * (h - h1) <= 0 && h0 !== h1) {
      const gw = lerp(g0, g1, (h - h0) / (h1 - h0));
      if (ag <= gw + 1e-9) return true;
    }
  }
  return false;
}
// Whether (f, k) is canopy glass, and which pane: the windscreen ahead of the bow, the canopy behind.
export function sh76GlassAt(f, k) {
  const G = SH76_GLASS;
  if (f < G.f[0] || f > G.f[1] || k < G.k[0] || k > G.k[1]) return null;
  return f >= G.bow ? 'windscreen' : 'canopy';
}
