/**
 * BIRDS: where a flock is and what it's doing, for every species in SPECIES.
 *
 * Shared by the windshield and the text game so the picture and the sentence agree.
 * ⚠ A flock is a pure function of its anchor tile and the wall clock: no table, no server state,
 * no tick. Server and client must compute the same answer.
 * ⚠ It never decides habitat itself; only the caller has the map. GOOSE_HABITAT is the shared table.
 */

// ── Where a flock is ──────────────────────────────────────────────────────────
// ⚠ The roll is per habitat tile. A lattice of candidate tiles landed almost every anchor off
// habitat (three flocks in the whole world).
export const FLOCK_AREA = 12;          // tiles per coarse-bias block: about a field
export const GOOSE_AREA_BIAS = 0.45;   // above this a block is goose country; below it, they're rare
const DENSE = 0.075, SPARSE = 0.006;   // per-habitat-tile chance in each case
import { liveColumnNear } from './thermals.js';

// ── The world scale ─────────────────────────────────────────────────────────────
// One storey is 0.196 tiles and 3.5 m, so a tile is 17.9 m. Metric bird facts go through `M`;
// map facts stay in tiles. murmur.js and windshield.js read this constant.
export const BIRD_M_PER_TILE = 3.5 / 0.196;
const M = (m) => m / BIRD_M_PER_TILE;

const frac = (n) => { const x = Math.sin(n) * 43758.5453; return x - Math.floor(x); };
// ⚠ Offset from the tree scatter's hash constants, or every flock lands in a wood.
const areaHash = (wx, wy) => frac(Math.floor(wx / FLOCK_AREA) * 71.7 + Math.floor(wy / FLOCK_AREA) * 131.3 + 17.3);
const tileHash = (wx, wy) => frac(wx * 57.1 + wy * 199.7 + 41.9);

/**
 * Does this tile hold a flock? A coarse block decides goose country, then the tile rolls.
 * ⚠ It must not ask whether the tile is habitat: call `gooseHabitat` first and roll only on true.
 */
export function flockAt(wx, wy, density = 1, species = 'goose', ground = null) {
  // No flock exists yet, so no spOf; an unknown id falls back to the goose.
  const sp = SPECIES[species] || SPECIES.goose;
  const want = (areaHash(wx, wy) > sp.areaBias ? sp.dense : sp.sparse) * density;
  const claim = tileHash(wx, wy);
  if (claim >= want) return null;
  // ⚠ A territorial species holds ground alone: a rival in range with a lower hash wins. The
  // rival's habitat isn't checked, which only makes it stricter and keeps both callers agreeing.
  const T = sp.territory | 0;
  if (T > 0) {
    for (let dy = -T; dy <= T; dy++) for (let dx = -T; dx <= T; dx++) {
      if (!dx && !dy) continue;
      const ox = wx + dx, oy = wy + dy;
      const c2 = tileHash(ox, oy);
      if (c2 < claim && c2 < (areaHash(ox, oy) > sp.areaBias ? sp.dense : sp.sparse) * density) return null;
    }
  }
  // ⚠ No `sp` key on a goose flock: gates compare flock objects by shape.
  if (species === 'goose') return { ax: wx, ay: wy };
  // ⚠ `roost` rides only where a row has `grand.on`, for the same reason. 1 on a roost site, 0 off
  // one; absent means the caller never said, which isGrandRoost reads as anywhere.
  const on = sp.grand && sp.grand.on;
  return on && ground != null ? { ax: wx, ay: wy, sp: species, roost: on.includes(ground) ? 1 : 0 } : { ax: wx, ay: wy, sp: species };
}

/** Every flock within `R` tiles of a centre. `isHabitat(wx, wy)` is the caller's map question. */
export function flocksNear(wcx, wcy, R, density = 1, isHabitat = null) {
  const out = [];
  for (let wy = Math.ceil(wcy - R); wy <= Math.floor(wcy + R); wy++) {
    for (let wx = Math.ceil(wcx - R); wx <= Math.floor(wcx + R); wx++) {
      // The callback answers true (a goose), a species id, or { sp, ground } (for `grand.on`).
      const h = isHabitat ? isHabitat(wx, wy) : true;
      if (!h) continue;
      const f = typeof h === 'object' ? flockAt(wx, wy, density, h.sp, h.ground) : flockAt(wx, wy, density, typeof h === 'string' ? h : 'goose');
      if (f) out.push(f);
    }
  }
  return out;
}

// ── Habitat ───────────────────────────────────────────────────────────────────
// One table keyed by both the renderer's biome and the text game's terrain names (`grass` and
// `parkland` are one surface; see TERRAIN_BIOME in plugins/flight/biomes.js).
// ⚠ No `marsh`: it maps to the `badlands` biome, so geese would land on every dry flat.
export const GOOSE_HABITAT = {
  grass: 'walk', parkland: 'walk', park: 'walk',
  water: 'raft',
};
export const gooseHabitat = (ground) => GOOSE_HABITAT[ground] || null;

// ── The cycle ─────────────────────────────────────────────────────────────────
// A flock is grounded for the first part of its period and airborne for the rest. Period and phase
// are derived from the anchor, so neighbouring flocks are never in step.
export const GOOSE_PERIOD = 100000;   // ms, before the per-flock jitter below
export const U_GROUND = 0.40;         // the share of a period spent on the ground
export const GOOSE_Z = 2.2;           // tiles (about 39 m), the top of the circuit
// Circuit radius, set by speed: 99 m gives about 15 m/s against a Canada goose's 18 m/s cruise.
export const GOOSE_R = M(99);

const smooth = (t) => { const x = t < 0 ? 0 : t > 1 ? 1 : t; return x * x * (3 - 2 * x); };
const TAU = Math.PI * 2;
// Short way round; a raw subtraction across ±π spins the bird a full circle for one frame.
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// How long a flock takes to gather before lifting and to spread after landing. Exported for gates.
export const GOOSE_SETTLE_MS = 2600;

/** A flock's own period, in ms. Jittered off its anchor so no two are ever in step. */
export const flockPeriod = (f) => spOf(f).period * (0.7 + frac(f.ax * 3.7 + f.ay * 11.9) * 0.7);

// How much of the airborne phase is spent climbing away from the anchor and settling back onto it.
const RAMP_UP = 0.18, RAMP_DN = 0.22;
// How far a soaring bird will go from its perch to reach a thermal column, tiles (about one block).
const THERMAL_REACH = 8;
// The fastest a circling flock may sweep round its anchor, degrees a second; faster reads as pivoting.
const CIRCUIT_MAX_DEG_S = 70;
const CIRCUIT_PEAK_DEG_S = 90;   // the sharpest a circuit's tightest bend may be flown (see circuitAt)

// ── Flying ROUND things ───────────────────────────────────────────────────────
// ── Flying round things ───────────────────────────────────────────────────────
// ⚠ The circuit radius is a profile per spoke, so one shed doesn't shrink the whole loop. Each
// blocked tile is projected onto each spoke (`along`/`perp`); a ray march misses a shed between spokes.
// ⚠ No tune flag: `flockOnSegment` (the bird strike) reads the same circuit on the server.
// `isBlocked(wx, wy)` is the caller's map question. ⚠ Answer false for a tile you can't see, or the
// circuit changes shape as the map window recentres.
export const CLEAR_DIRS = 12;         // spokes round the compass, 30° apart
const CLEAR_BAND = 1.0;               // how near a spoke a blocked tile has to be to count, in tiles
const CLEAR_MARGIN = 0.15;            // and how far short of it the birds then turn
// The margin also takes one rank (SKEIN_ACROSS) for the flock's width, read at the use site because
// ⚠ SKEIN_ACROSS is declared further down: reading it here is a ReferenceError at load.
// ⚠ The floor is the tightest turn and must stay under half a tile, or an anchor beside a building
// puts the birds inside it.
export const GOOSE_R_MIN = 0.40;
// How much the radius may grow from one spoke to the next (it may shrink freely).
const MAX_SLEW = 0.62;

const SPOKE_C = [], SPOKE_S = [];
for (let i = 0; i < CLEAR_DIRS; i++) { SPOKE_C.push(Math.cos((i / CLEAR_DIRS) * TAU)); SPOKE_S.push(Math.sin((i / CLEAR_DIRS) * TAU)); }
// Scratch for a flock's built tiles. Safe because nothing here yields and no caller keeps them.
const _hx = [], _hy = [];

/**
 * The largest circuit radius per spoke that keeps the birds off buildings, or null when nothing
 * in reach is built on.
 * ⚠ No cache: the answer depends on what the caller can see now, and a cached "nothing here" taken
 * at the window's edge outlives the window. It costs 23-61 µs for ten flocks.
 */
export function flockClearance(f, isBlocked) {
  if (typeof isBlocked !== 'function') return null;
  // a species that sweeps a roost rather than flying a circle is kept clear over the whole roost
  const baseR = spOf(f).roam ?? spOf(f).r;
  const REACH = Math.ceil(baseR + CLEAR_BAND), R2 = (baseR + CLEAR_BAND) * (baseR + CLEAR_BAND);
  let n = 0;
  for (let dy = -REACH; dy <= REACH; dy++) {
    for (let dx = -REACH; dx <= REACH; dx++) {
      if (!dx && !dy) continue;                       // the anchor is habitat by construction
      if (dx * dx + dy * dy > R2) continue;
      if (isBlocked(f.ax + dx, f.ay + dy)) { _hx[n] = dx; _hy[n] = dy; n++; }
    }
  }
  if (!n) return null;
  const out = new Array(CLEAR_DIRS).fill(baseR);
  for (let i = 0; i < CLEAR_DIRS; i++) {
    const cs = SPOKE_C[i], sn = SPOKE_S[i];
    for (let k = 0; k < n; k++) {
      const dx = _hx[k], dy = _hy[k];
      const along = dx * cs + dy * sn;
      if (along <= 0) continue;                       // behind the spoke: a different direction's problem
      const perp = Math.abs(dy * cs - dx * sn);
      if (perp >= CLEAR_BAND) continue;
      // Where the spoke first comes within CLEAR_BAND of the tile centre, less the turn-in margin.
      const r = along - Math.sqrt(CLEAR_BAND * CLEAR_BAND - perp * perp) - CLEAR_MARGIN - SKEIN_ACROSS;
      if (r < out[i]) out[i] = r;
    }
    if (out[i] < GOOSE_R_MIN) out[i] = GOOSE_R_MIN;
  }
  // ⚠ Slew-limited because the renderer banks the birds on the turn rate; a raw step flips the
  // skein from full left bank to full right. ⚠ It only ever lowers: raising a sample can put the
  // birds back through the wall.
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < CLEAR_DIRS; k++) {
      const i = (k + CLEAR_DIRS) % CLEAR_DIRS, j = (i + 1) % CLEAR_DIRS;
      if (out[j] > out[i] + MAX_SLEW) out[j] = out[i] + MAX_SLEW;
    }
    for (let k = CLEAR_DIRS - 1; k >= 0; k--) {
      const i = (k + CLEAR_DIRS) % CLEAR_DIRS, j = (i - 1 + CLEAR_DIRS) % CLEAR_DIRS;
      if (out[j] > out[i] + MAX_SLEW) out[j] = out[i] + MAX_SLEW;
    }
  }
  return out;
}

/**
 * The circuit radius at a bearing, interpolated between the spokes.
 * ⚠ Catmull-Rom, never smoothstep: smoothstep's zero slope at each spoke rocks the bank angle.
 * ⚠ Clamped to the higher neighbour so an overshoot can't bulge the loop into a building.
 */
function radiusAt(clear, th, baseR = GOOSE_R) {
  if (!clear) return baseR;
  const p = (th / TAU) * CLEAR_DIRS;
  const i = Math.floor(p), u = p - i;
  const at = (k) => clear[(((i + k) % CLEAR_DIRS) + CLEAR_DIRS) % CLEAR_DIRS];
  const p0 = at(-1), p1 = at(0), p2 = at(1), p3 = at(2);
  const r = 0.5 * ((2 * p1) + (-p0 + p2) * u
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u
    + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
  const hi = p1 > p2 ? p1 : p2;
  return r > hi ? hi : r < GOOSE_R_MIN ? GOOSE_R_MIN : r;
}

// A soaring raptor's path: a spiral up a thermal, then a glide out and back.
// ⚠ Returns the same {x, y, z, r, th} shape as circuitAt, which branches into it, so heading,
// clearance, strike test and settle blend all work unchanged.
// ⚠ Centred on a real column (thermals.js) within THERMAL_REACH, so a circling hawk marks usable
// lift. The column is clock-free, so this stays a pure function of the anchor; hashes key on the anchor.
function thermalAt(f, t, sp, cx = f.ax, cy = f.ay, cr = null) {
  // On a real column the spiral stays inside its core; a bare anchor keeps the authored radius.
  const R0 = cr ? Math.min(sp.r, cr * 0.55) : sp.r;
  const CLIMB = 0.62;   // the climb's share of the flight
  const turns = (sp.turns ?? 3) + Math.floor(frac(f.ax * 4.4 + f.ay * 9.2) * 3);
  const th0 = frac(f.ax * 2.3 + f.ay * 8.7) * TAU;
  if (t < CLIMB) {
    const u = t / CLIMB;
    // The spiral tightens as it climbs, and the climb levels off near the cap.
    const r = R0 * (1 - 0.55 * u);
    const th = th0 + turns * TAU * u;
    return { x: cx + Math.cos(th) * r, y: cy + Math.sin(th) * r, z: sp.z * Math.sqrt(u), r, th };
  }
  const u = (t - CLIMB) / (1 - CLIMB);
  const out = Math.sin(u * Math.PI);              // 0 at both ends, 1 in the middle
  const bear = th0 + turns * TAU * 1.0 + frac(f.ax * 7.1 + f.ay * 1.9) * 0.9;
  const reach = sp.r * 2.6 * out;
  // ⚠ The glide starts from the spiral's last point and eases back to the anchor, or the bird jumps.
  const topR = R0 * 0.45, topTh = th0 + turns * TAU;
  const bx = Math.cos(topTh) * topR * (1 - u), by = Math.sin(topTh) * topR * (1 - u);
  return {
    x: cx + bx + Math.cos(bear) * reach,
    y: cy + by + Math.sin(bear) * reach,
    z: sp.z * (1 - u) * (1 - u),
    r: Math.max(M(2.2), reach),
    th: bear,
  };
}

// A murmuration sweeping its roost at the birds' own speed (about 10 m/s; Cavagna et al. 2010), as a
// sum of three epicycles in seconds of flight.
// ⚠ The server evaluates this too: keep it cheap and a pure function of (anchor, t, clear).
// ⚠ Anchored at both ends by subtracting the pattern's start and end; a smoothstep ramp on a roost
// this wide flings the flock outward at take-off.
function wanderAt(f, t, sp, clear, span = 1) {
  const w = sp.wander;
  // a held flock's flight is `span` flights long (flightPhase); climb and descent keep their own length
  const secsN = (flockPeriod(f) * (1 - sp.uGround)) / 1000, secs = secsN * span;
  // a bigger roost ranges further, by the cube root of its count
  const R = (sp.roam ?? sp.r) * Math.max(1, Math.cbrt(flockSize(f) / w.refN));
  const h = (k) => frac(f.ax * (3.1 + k * 1.7) + f.ay * (7.9 - k * 2.3) + k * 0.37);
  const s1 = h(0) < 0.5 ? 1 : -1;
  const A1 = R * w.a1, w1 = (w.v1 * (0.9 + 0.2 * h(1))) / A1;
  const w2 = w1 * (0.8 + 0.4 * h(2)), A2 = (w.v2 * (0.9 + 0.2 * h(3))) / w2;
  const w3 = w1 * (2.3 + 0.8 * h(4)), A3 = w.v3 / w3;
  const p1 = h(5) * TAU, p2 = h(6) * TAU, p3 = h(7) * TAU;
  const W = (T) => {
    const a = s1 * w1 * T + p1, b = -s1 * w2 * T + p2, c = s1 * w3 * T + p3;
    return [A1 * Math.cos(a) + A2 * Math.cos(b) + A3 * Math.cos(c), A1 * Math.sin(a) + A2 * Math.sin(b) + A3 * Math.sin(c)];
  };
  const tau = t * secs, w0 = W(0), wE = W(secs), c = W(tau);
  let ox = c[0] - w0[0] * (1 - t) - wE[0] * t, oy = c[1] - w0[1] * (1 - t) - wE[1] * t;
  // Compress the pattern toward open ground, using the circle's clearance profile.
  if (clear && (ox || oy)) {
    const base = sp.roam ?? sp.r, k = radiusAt(clear, Math.atan2(oy, ox), base) / base;
    ox *= k; oy *= k;
  }
  const bump = Math.min(smooth(tau / (RAMP_UP * secsN)), smooth((secs - tau) / (RAMP_DN * secsN)));
  return { x: f.ax + ox, y: f.ay + oy, z: sp.z * bump, r: sp.r * bump, th: Math.atan2(oy, ox) };
}

// ⚠ The angle advances with the integrated radius ramp, so a flock climbs out nearly straight
// instead of spinning on a tiny circle. Closed form: ∫smooth = x³ − x⁴/2 over each ramp.
const rampInt = (x) => { const c = x < 0 ? 0 : x > 1 ? 1 : x; return c * c * c - 0.5 * c * c * c * c; };
const SWEEP_TOTAL = 1 - RAMP_UP / 2 - RAMP_DN / 2;
function sweepAt(t) {
  const up = RAMP_UP * rampInt(t / RAMP_UP);
  const mid = Math.max(0, Math.min(t, 1 - RAMP_DN) - RAMP_UP);
  const dn = t > 1 - RAMP_DN ? RAMP_DN * (0.5 - rampInt((1 - t) / RAMP_DN)) : 0;
  return (up + mid + dn) / SWEEP_TOTAL;
}

// A bent circuit is timed by distance, with speed falling as the square root of the turn radius,
// so birds slow in tight bends. Lap time and closure on the anchor are unchanged; without
// clearance nothing is re-timed.
const LAP_N = 96;
const _lapMemo = new WeakMap();   // clear array → Map(key → cumulative cost table)
function lapTable(clear, baseR, th0) {
  let m = _lapMemo.get(clear);
  if (!m) { m = new Map(); _lapMemo.set(clear, m); }
  const key = baseR + ':' + th0;
  let cum = m.get(key);
  if (cum) return cum;
  const px = new Float64Array(LAP_N), py = new Float64Array(LAP_N);
  for (let i = 0; i < LAP_N; i++) {
    const th = th0 + (i / LAP_N) * TAU, r = radiusAt(clear, th, baseR);
    px[i] = Math.cos(th) * r; py[i] = Math.sin(th) * r;
  }
  const floorR = Math.max(0.05, baseR);
  cum = new Float64Array(LAP_N + 1);
  const dh = new Float64Array(LAP_N);
  for (let i = 0; i < LAP_N; i++) {
    const a = (i - 1 + LAP_N) % LAP_N, b = i, c = (i + 1) % LAP_N;
    const ab = Math.hypot(px[b] - px[a], py[b] - py[a]), bc = Math.hypot(px[c] - px[b], py[c] - py[b]);
    const ca = Math.hypot(px[a] - px[c], py[a] - py[c]);
    const cross = Math.abs((px[b] - px[a]) * (py[c] - py[a]) - (py[b] - py[a]) * (px[c] - px[a]));
    const rc = cross > 1e-12 ? (ab * bc * ca) / (2 * cross) : Infinity;   // circumradius = radius of the turn here
    const v = Math.max(0.35, Math.min(1, Math.sqrt(rc / floorR)));
    cum[i + 1] = cum[i] + bc / v;
    const h1 = Math.atan2(py[b] - py[a], px[b] - px[a]), h2 = Math.atan2(py[c] - py[b], px[c] - px[b]);
    dh[i] = Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)));
  }
  const tot = cum[LAP_N];
  for (let i = 0; i <= LAP_N; i++) cum[i] /= tot;
  // Peak heading change per unit of lap time, which caps how fast the lap may be flown (circuitAt).
  let peak = 0;
  for (let i = 0; i < LAP_N; i++) { const dc = cum[i + 1] - cum[i]; if (dc > 0) peak = Math.max(peak, dh[i] / dc); }
  cum.peak = peak;
  m.set(key, cum);
  return cum;
}
/** Laps flown (a real number, in time) → laps swept (in angle), for a bent circuit. */
function lapTiming(clear, baseR, th0, laps) {
  const L = Math.floor(laps), fr = laps - L;
  const cum = lapTable(clear, baseR, th0);
  let lo = 0, hi = LAP_N;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= fr) lo = mid; else hi = mid; }
  const span = cum[hi] - cum[lo];
  return L + (lo + (span > 0 ? (fr - cum[lo]) / span : 0)) / LAP_N;
}

function circuitAt(f, t, clear, span = 1, now = null) {
  const sp = spOf(f);
  if (sp.circuit === 2) return wanderAt(f, t, sp, clear, span);
  if (sp.circuit === 1) {
    // Ride the nearest column live when THIS flight starts, so the bird never swaps mid-spiral.
    // `now` is null only for the edge-heading probe, where the ramps hold the bird on its anchor.
    let col = null;
    if (now != null) {
      const period = flockPeriod(f), ph = frac(f.ax * 19.1 + f.ay * 5.3);
      const start = (Math.floor(now / period + ph) - ph) * period;
      col = liveColumnNear(f.ax, f.ay, start, THERMAL_REACH, 0.2);
    }
    const c = col ? thermalAt(f, t, sp, col.cx, col.cy, col.r) : thermalAt(f, t, sp);
    const bump = Math.min(smooth(t / RAMP_UP), smooth((1 - t) / RAMP_DN));
    // ⚠ The shared ramp starts and ends on the anchor, which closes the cycle.
    return { x: f.ax + (c.x - f.ax) * bump, y: f.ay + (c.y - f.ay) * bump, z: c.z * bump, r: c.r * bump, th: c.th };
  }
  const bump = Math.min(smooth(t / RAMP_UP), smooth((1 - t) / RAMP_DN));
  // `turns` on the row is the laps a flight makes (plus 0-1): a soaring bird circles a thermal many times.
  const turns = (sp.turns ?? 1) + Math.floor(frac(f.ax * 7.7 + f.ay * 3.1) * 2);
  // A smaller circuit is flown with more laps, scaled by the flock's mean clearance (constant per
  // flock, so laps still close on the anchor) and capped at a bank a goose can hold.
  let lapK = 1;
  if (clear) {
    let m = 0;
    for (let i = 0; i < clear.length; i++) m += clear[i];
    m /= clear.length;
    const secs = (flockPeriod(f) * (1 - sp.uGround) * span) / 1000;
    // Peak rate, not mean: the eased sweep below spends the ramps turning slowly and the middle faster.
    const degPerS = (turns * 360) / Math.max(1e-6, secs * SWEEP_TOTAL);
    lapK = Math.max(1, Math.min(sp.r / Math.max(GOOSE_R_MIN, m), CIRCUIT_MAX_DEG_S / Math.max(1e-6, degPerS)));
  }
  const th0 = frac(f.ax * 2.3 + f.ay * 8.7) * TAU;
  // The lap rate is also capped by the tightest bend, which may take it below one. Fewer laps is
  // safe: r is zero at both ends of the flight.
  if (clear) {
    const secs = (flockPeriod(f) * (1 - sp.uGround) * span) / 1000;
    const peak = lapTable(clear, sp.r, th0).peak;   // rad per lap-time
    const lapSecs = secs * SWEEP_TOTAL / Math.max(1e-6, turns * lapK);
    const peakDegS = (peak / lapSecs) * 180 / Math.PI;
    // floored at half: below that a pinched flock hangs in the air, which reads worse than a hard bank
    if (peakDegS > CIRCUIT_PEAK_DEG_S) lapK *= Math.max(0.5, CIRCUIT_PEAK_DEG_S / peakDegS);
  }
  const laps = turns * lapK * sweepAt(t);
  const th = clear ? th0 + TAU * lapTiming(clear, sp.r, th0, laps) : th0 + TAU * laps;
  const r = radiusAt(clear, th, sp.r) * bump;
  return { x: f.ax + Math.cos(th) * r, y: f.ay + Math.sin(th) * r, z: sp.z * bump, r, th };
}

/**
 * How many birds.
 * ⚠ Rolled from the declared min/max: the bird strike's radius is derived from MAX_FLOCK, so the
 * flock must never outgrow it.
 */
export const MIN_FLOCK = 3, MAX_FLOCK = 6;
export const flockSize = (f, opts = null) => {
  const sp = spOf(f);
  const u = frac(f.ax * 4.11 + f.ay * 9.73);
  // A grand-roost species rolls two bands: a `grand.share` of anchors draws from the top band
  // (skewed low by u squared), the rest from the ordinary one. `maxFlock` caps both.
  const g = sp.grand;
  const roll = !g ? sp.minFlock + Math.floor(u * (sp.maxFlock - sp.minFlock + 1))
    : isGrandRoost(f) ? g.from + Math.floor(u * u * (sp.maxFlock - g.from + 1))
    : sp.minFlock + Math.floor(u * (g.below - sp.minFlock + 1));
  return seasonalSize(sp, roll, opts);
};
/** Is this anchor one of its species' grand roosts? Off its own hash, so it never changes. */
// Only on a roost site when the caller passed the ground (f.roost); anywhere when it didn't (benches).
export const isGrandRoost = (f) => {
  const g = spOf(f).grand;
  if (!g) return false;
  if (f.roost === 0) return false;
  return frac(f.ax * 6.37 + f.ay * 2.91) < (f.roost === 1 && g.onShare != null ? g.onShare : g.share);
};

// ── The year and the evening ──────────────────────────────────────────────────
// `season` is the yearly cycle (off until launch), `dusk` the evening gathering (on). 0 on a key
// reproduces the plain hash-rolled answer exactly, which gates assert.
// ⚠ Lives here, not in RENDER_TUNE: the server prints the same flock, so both sides must see it.
export const BIRD_TUNE = { season: 0, dusk: 1, flockRange: 1 };

// doyOf lives in moon.js so environment.js can read it without loading this module at boot.
export { doyOf } from './moon.js';

const YEAR = 365.2425;

/**
 * How far into its own year this species is, 0 (the lean season) to 1 (the peak).
 * A cosine raised to `gamma` gives a narrow peak and a broad trough.
 * ⚠ Never zero (`floor`): small parties stay in the sky all summer.
 */
export function seasonFactor(sp, doy) {
  const w = sp.season;
  if (!w || doy == null) return 1;
  const s = (1 + Math.cos(TAU * (doy - w.peak) / YEAR)) / 2;      // 1 at the peak, 0 opposite it
  return w.floor + (1 - w.floor) * Math.pow(s, w.gamma);
}

/**
 * How far into the evening gathering this species is, 0 (feeding) to 1 (over the roost).
 * ⚠ The peak is `dayEnd - lead`, never its own literal, so it can't drift from dusk.
 */
export function roostFactor(sp, hour) {
  const w = sp.roost;
  if (!w || hour == null) return 1;
  const peak = (sp.dayEnd ?? 21) - w.lead;
  let d = Math.abs(hour - peak);
  if (d > 12) d = 24 - d;                                          // wrapped, like songFactor
  if (d >= w.span) return w.floor;
  const t = 1 - d / w.span;
  return w.floor + (1 - w.floor) * t * t * (3 - 2 * t);            // smooth, so it swells and fades
}

// The fewest birds the two curves may leave. ⚠ A band, carried by the anchor's place in its roll:
// a single floor made every summer starling party in the world the same size.
export const PARTY_FLOOR = 6, PARTY_SPREAD = 10;

// ── Flock size and draw range ────────────────────────────────────────────────
// The renderer grows a cloud by the cube root of its count; the draw range grows by the same
// factor so a big murmuration is seen as far off as its size warrants. ⚠ Clamped at 1, so it only
// ever extends (in practice only the starling reaches FLOCK_REF).
export const FLOCK_REF = 20;
export const flockSpreadScale = (n) => Math.cbrt(Math.max(n, 1) / FLOCK_REF);
export function flockDrawRange(sp, f, opts = null) {
  const base = sp.drawRange;
  // 0 is the flat constant exactly. In BIRD_TUNE for the same reason as `season`.
  if (!BIRD_TUNE.flockRange) return base;
  // A species that cannot reach the reference can never extend, so its size is never computed.
  if (!(sp.maxFlock > FLOCK_REF)) return base;
  return base * Math.max(1, flockSpreadScale(flockSize(f, opts)));
}

/**
 * The rolled size, after the year and the evening.
 * ⚠ The roll is the ceiling and the curves only take away (see flockSize). The two multiply, so
 * midsummer dusk stays smaller than midwinter dusk.
 */
export function seasonalSize(sp, roll, opts) {
  if (!(BIRD_TUNE.season || BIRD_TUNE.dusk) || !opts) return roll;
  const f = (BIRD_TUNE.season ? seasonFactor(sp, opts.doy) : 1) * (BIRD_TUNE.dusk ? roostFactor(sp, opts.hour) : 1);
  if (f >= 1) return roll;
  const band = sp.maxFlock - sp.minFlock;
  const rich = band > 0 ? (roll - sp.minFlock) / band : 0;          // where this roost sits in its own band
  const least = Math.min(roll, PARTY_FLOOR + Math.round(rich * PARTY_SPREAD));
  return Math.max(least, Math.round(roll * f));
}

/**
 * The end of a starling's evening: one unbroken display (about 26 minutes; Goodenough et al. 2017),
 * then down onto the roost for the night. Returns null for the ordinary cycle, `{ t: null }` for a
 * flock roosting, and `{ t, span }` partway through the display.
 * ⚠ A pure function of the game clock, so room text and renderer agree. `opts.hour` is fractional,
 * `opts.hourMs` the wall time it was true at, `opts.rate` the timeScale. ⚠ The show is laid out in
 * real seconds of flight, or at timeScale 3 the birds fly three times their speed.
 */
function roostShow(f, now, opts) {
  const sp = spOf(f), w = sp.roost;
  if (!BIRD_TUNE.dusk || !w || !w.show || !opts || opts.hour == null || !Number.isFinite(opts.hour)) return null;
  // the year may call off a show only when the year is switched on
  if (BIRD_TUNE.season && seasonFactor(sp, opts.doy) < (w.minSeason ?? 0)) return null;
  const rate = opts.rate > 0 ? opts.rate : 1;
  let gh = opts.hour + (Number.isFinite(opts.hourMs) ? ((now - opts.hourMs) / 3.6e6) * rate : 0);
  gh = ((gh % 24) + 24) % 24;
  const diveAt = (sp.dayEnd ?? 21) - w.dive + (frac(f.ax * 5.9 + f.ay * 12.7) - 0.5) * 2 * w.jitter;
  const showH = (w.show / 60) * (0.8 + 0.4 * frac(f.ax * 8.3 + f.ay * 4.1));
  const start = diveAt - showH;
  // After the dive and through the night until the morning cycle takes over, the flock is roosting.
  if (gh >= diveAt || gh < (sp.dayStart ?? 5)) return { t: null };
  // ⚠ For one period before the show no flight starts, so the flock is on its anchor at the hand-over.
  const gap = (flockPeriod(f) / 3.6e6) * rate;
  if (gh < start - gap) return null;
  if (gh < start) {
    const ph = frac(f.ax * 19.1 + f.ay * 5.3), u = (((now / flockPeriod(f)) + ph) % 1 + 1) % 1;
    const tookOff = gh - ((u - sp.uGround) * flockPeriod(f) / 3.6e6) * rate;
    return u >= sp.uGround && tookOff < start - gap ? null : { t: null };
  }
  const secsN = (flockPeriod(f) * (1 - sp.uGround)) / 1000;
  const secs = (showH * 3600) / rate;
  return { t: (gh - start) / showH, span: secs / secsN };
}

// ── The weather tell ─────────────────────────────────────────────────────────
// A hawk spends more of its cycle down on a bad day and on the afternoon before one.
// ⚠ Both surfaces pass the same `opts.wx` ([today, tomorrow]) and `opts.hour`; without them it's 0.
const WX_BAD = new Set(['storm', 'thunderstorm', 'blizzard', 'sleet']);
const WX_WET = new Set(['rain', 'snow']);
const TELL_HOLD = 0.8;             // at a full tell, this share of the flight time is spent down instead
/** How strongly the weather keeps a hawk down, 0..1, from today's weather, tomorrow's and the hour. */
export function weatherTell(today, tomorrow, hour) {
  const now = WX_BAD.has(today) ? 1 : WX_WET.has(today) ? 0.5 : 0;
  const h = Number.isFinite(hour) ? hour : 0;
  const ahead = WX_BAD.has(tomorrow) ? Math.max(0, Math.min(1, (h - 11) / 6)) * 0.8 : 0;
  return Math.max(now, ahead);
}
/** A flock's ground share, lengthened by the weather tell for a species that reads it. */
export function groundShareOf(f, opts) {
  const sp = spOf(f), uG = sp.uGround;
  if (!sp.weatherTell || !opts || !opts.wx) return uG;
  const tell = weatherTell(opts.wx[0], opts.wx[1], opts.hour);
  return uG + (1 - uG) * TELL_HOLD * tell;
}

// Where in its cycle a flock is: `u` of the period, and `t` through its flight (null on the ground).
// ⚠ One helper for flockState and flockCentreAt, so they can't disagree about when it's up.
function flightPhase(f, now, opts) {
  const ph = frac(f.ax * 19.1 + f.ay * 5.3);
  const period = flockPeriod(f);
  const u = (((now / period) + ph) % 1 + 1) % 1;
  const uG = groundShareOf(f, opts);
  const forced = !!(opts && opts.air && opts.air === f?.sp);
  if (!forced) {
    const R = roostShow(f, now, opts);
    if (R) return { u, period, uG, t: R.t, span: R.span ?? 1 };
  }
  if (!forced && u < uG) return { u, period, uG, t: null, span: 1 };
  // A held flock flies `forcedSpan` flights in one, so a murmuration isn't shattered by a lap snap
  // every half-minute.
  const span = forced ? (spOf(f).forcedSpan ?? 1) : 1;
  const t = forced ? (((now / (period * (1 - uG) * span)) + ph) % 1 + 1) % 1 : (u - uG) / (1 - uG);
  return { u, period, uG, t, span };
}

/**
 * The flock's centre at any time, past or ahead, as [x, y, z]. The GPU murmuration steers by it
 * both ways so the relay is centred on the present rather than trailing it.
 */
export function flockCentreAt(f, now, clear = null, opts = null) {
  const P = flightPhase(f, now, opts);
  if (P.t == null) return [f.ax, f.ay, 0];
  const c = circuitAt(f, P.t, clear, P.span, now);
  return [c.x, c.y, c.z];
}

/**
 * What a flock is doing at `now`: centre, height, heading, turn and climb.
 * `clear` is the flockClearance profile, or null for the plain circle.
 * ⚠ The circuit is centred on the anchor with its radius on the height ramp, which closes the cycle.
 * ⚠ `clear` changes where, never whether: airborne, u, period and n come first, so a caller with
 * no map gets the same answer. ⚠ `turn` (rad per wall second) and `climb` (a gradient) come from
 * the same differencing as the heading; never re-derive them in the renderer.
 */
export function flockState(f, now, clear = null, opts = null) {
  const P = flightPhase(f, now, opts);
  const { u, period, span } = P;

  const uG = P.uG;
  // ⚠ `opts.air` is a test seam (`.murmur`) that loops the airborne phase for one species. The
  // server never passes it, so it moves the picture and nothing else.
  if (P.t == null) {
    return { airborne: false, u, period, cx: f.ax, cy: f.ay, z: 0, heading: frac(f.ax * 2.3 + f.ay * 8.7) * TAU, turn: 0, climb: 0, n: flockSize(f, opts) };
  }
  const t = P.t;
  const c = circuitAt(f, t, clear, span, now);

  // ⚠ The heading is the velocity (tangential plus radial), never the circle's tangent, or the flock
  // flies sideways through the climb. Differenced because `bump`'s derivative is discontinuous.
  const D = 0.004;
  const a = circuitAt(f, Math.max(0, t - D / span), clear, span, now), b = circuitAt(f, Math.min(1, t + D / span), clear, span, now);
  const vx = b.x - a.x, vy = b.y - a.y;
  // Not moving: fall back to the tangent rather than atan2(0, 0).
  const heading = (vx || vy) ? Math.atan2(vy, vx) : c.th + Math.PI / 2;

  // The turn rate from two half-steps. ⚠ Each is checked for length, because `t` clamps at the
  // ends and a zero step snaps the bird into a hard bank. ⚠ The window (about a wall second) is
  // much wider than the heading's, so the bank rolls in rather than jumping.
  const secs = (period * (1 - spOf(f).uGround) * span) / 1000;
  const DT = Math.min(0.24, 1.15 / Math.max(1e-6, secs));
  const t0 = Math.max(0, t - DT), t1 = Math.min(1, t + DT);
  const wa = circuitAt(f, t0, clear, span, now), wb = circuitAt(f, t1, clear, span, now), wm = circuitAt(f, (t0 + t1) / 2, clear, span, now);
  const s0 = Math.hypot(wm.x - wa.x, wm.y - wa.y), s1 = Math.hypot(wb.x - wm.x, wb.y - wm.y);
  const turn = (s0 > 1e-9 && s1 > 1e-9)
    ? angDiff(Math.atan2(wb.y - wm.y, wb.x - wm.x), Math.atan2(wm.y - wa.y, wm.x - wa.x)) / (((t1 - t0) / 2) * secs)
    : 0;
  const run = Math.hypot(vx, vy);
  const climb = run > 1e-6 ? (b.z - a.z) / run : 0;

  return { airborne: true, u, t, period, span, z: c.z, r: c.r, cx: c.x, cy: c.y, heading, turn, climb, n: flockSize(f, opts) };
}

/** The course the flock lifts off on (`takingOff`) or touches down on, at the anchor. */
export function flockEdgeHeading(f, takingOff, clear = null) {
  const D = 0.004;
  const t0 = takingOff ? 0 : 1 - D, t1 = takingOff ? D : 1;
  const a = circuitAt(f, t0, clear), b = circuitAt(f, t1, clear);
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** How alarmed a flock is by something `d` tiles away, 0..1. A pure function of distance, no memory. */
export const STARTLE_R = M(55);   // metres: a flock looks up at about this range
export const alarmAt = (d) => smooth((STARTLE_R - d) / STARTLE_R);

// ── The skein ─────────────────────────────────────────────────────────────────
// How a flock is arranged in the air: a V, J or echelon, birds more than a span apart with a ragged
// station-keeping wander, a breathing angle and a rotating lead. Sources: Cutts & Speakman 1994,
// Portugal et al. 2014, Mirzaeinia & Hassanalian 2019/2020.
// ⚠ All derived from (anchor, bird index, clock) and never stored.

// A Canada goose's span. ⚠ fauna3d.js sizes the model from this and `fauna.mjs` asserts they agree.
export const GOOSE_SPAN_M = 1.65;
export const GOOSE_SPAN = M(GOOSE_SPAN_M);
// Centre to centre across (wing-tip gap a ninth of a span) and behind, for an included angle of 124°.
export const SKEIN_ACROSS = GOOSE_SPAN * 1.11;
export const SKEIN_ALONG = GOOSE_SPAN * 0.60;
// The cruise is a lap of the nominal circle in the airborne share of a period.
export const GOOSE_FLAP_HZ = 1.5;
export const GOOSE_CRUISE = (TAU * GOOSE_R) / (GOOSE_PERIOD * (1 - U_GROUND) / 1000);
const FLAP_WAVELENGTH = GOOSE_CRUISE / GOOSE_FLAP_HZ;

// How far out of its slot a bird drifts, as a share of the spacing. It grows down the arm, so the
// point of the V holds steady and the tail is ragged.
const WANDER_ACROSS = 0.34, WANDER_ALONG = 0.55, WANDER_LIFT = M(0.6);
const LIFT_FLOOR = M(2.4);            // altitude below which the skein comes level
const WANDER_RANK = 0.45;             // the share of the amplitude a rank-0 bird gets
const WANDER_SLOW = 0.00061, WANDER_FAST = 0.00103;   // rad/ms: a drift of seconds, never a jitter
// How much the V opens and closes, and how slowly.
const BREATHE = 0.28, BREATHE_RATE = 0.00017;
// A lead lasts about this long, and the change of places takes this share of it.
const HANDOVER_MS = 26000, HANDOVER_SWAP = 0.30;

// Which shape this flock's skein takes, and which way it leans.
// ⚠ Per flock, never per flight: the settle blend eases birds out of the formation they landed in.
const SKEIN_FORMS = ['v', 'v', 'j', 'j', 'ech'];
export function skeinForm(f) {
  const h = frac(f.ax * 6.77 + f.ay * 2.31 + 3.1);
  // Three birds fly a line about as readily as a V.
  // ⚠ Only for species with skeins: a single-form species (the gull's 'loose') keeps its form.
  const forms = spOf(f).forms;
  const form = forms.length === 1 ? forms[0]
    : flockSize(f) <= 3 ? (h < 0.45 ? 'ech' : 'v')
      : forms[Math.floor(h * forms.length)];
  return { form, lean: frac(f.ax * 1.93 + f.ay * 7.41) < 0.5 ? 1 : -1 };
}

// The slots in path order: the point, down one arm, back up the other.
// ⚠ The order is the hand-over: a lead change shifts every bird one step along it. Ordered by rank,
// birds would swing across the middle of the formation.
const _slots = new Map();
function slotPath(form, n, lean) {
  const key = form + n + lean;
  const hit = _slots.get(key);
  if (hit) return hit;
  const all = [{ arm: 0, rank: 0 }];
  for (let s = 1; s < n; s++) {
    // 'loose' is a cloud still written in arms and ranks, which everything downstream reads.
    // ⚠ The rank's integer part carries the slot index so two birds never share air, and the
    // 2.6 rank step keeps a cloud wider than a skein (a step of 1 put gulls inside each other).
    if (form === 'loose') {
      const h1 = frac(s * 12.9898 + 4.1414), h2 = frac(s * 78.233 + 1.7);
      all.push({ arm: h1 < 0.5 ? lean : -lean, rank: 1 + Math.floor(s / 2) * 2.6 + (h2 - 0.5) * 1.1 });
    } else if (form === 'ech') all.push({ arm: lean, rank: s });
    else if (form === 'j') {
      // Two down the long arm for every one down the short: the lopsided V.
      const r = Math.floor((s - 1) / 3), m = (s - 1) % 3;
      all.push(m === 2 ? { arm: -lean, rank: r + 1 } : { arm: lean, rank: r * 2 + m + 1 });
    } else all.push({ arm: s % 2 ? lean : -lean, rank: Math.ceil(s / 2) });
  }
  const near = all.filter((o) => o.arm === lean).sort((a, b) => a.rank - b.rank);
  const far = all.filter((o) => o.arm === -lean).sort((a, b) => b.rank - a.rank);
  const out = [all[0], ...near, ...far];
  _slots.set(key, out);
  return out;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Where bird `i` of `n` is at `now`, in world tiles, around a flock centred on (cx, cy) pointing
 * along `heading`: position, lift above the flock, yaw against the course, and wingbeat offset.
 * The wingbeat lags by depth over the distance flown per beat, so a wave runs down the arm
 * (Portugal et al. 2014). No slot is directly astern of another, so the anti-phase rule never applies.
 */
export function skeinSlot(f, i, n, now, cx, cy, heading, z = 0, trail = null) {
  // ⚠ A lone bird is its own centre; the wander below would carry it off it.
  if (n <= 1) return { x: cx, y: cy, lift: 0, yaw: 0, beat: 0 };
  const { form, lean } = skeinForm(f);
  const path = slotPath(form, n, lean);
  const m = path.length;

  // The V breathes: depth swells and shrinks, walking the included angle between about 108° and 136°.
  const depthK = 1 + BREATHE * Math.sin(now * BREATHE_RATE + frac(f.ax * 3.31 + f.ay * 9.17) * TAU);

  // The hand-over, as a position between two slots rather than as an event.
  const hv = now / HANDOVER_MS + frac(f.ax * 8.13 + f.ay * 3.77) * 7;
  const k = Math.floor(hv);
  const e = smooth(clamp01((hv - k) / HANDOVER_SWAP));
  const A = path[(i + k) % m], B = path[(i + k + 1) % m];

  const aAlong = A.rank * SKEIN_ALONG * depthK, aAcross = A.arm * A.rank * SKEIN_ACROSS;
  const bAlong = B.rank * SKEIN_ALONG * depthK, bAcross = B.arm * B.rank * SKEIN_ACROSS;
  let along = aAlong + (bAlong - aAlong) * e;
  let across = aAcross + (bAcross - aAcross) * e;
  const rank = A.rank + (B.rank - A.rank) * e;

  // ⚠ The move bows round, never through the formation: outward on one arm, backward at the tail.
  if (e > 0.001 && e < 0.999) {
    const sweep = Math.hypot(bAlong - aAlong, bAcross - aAcross);
    const bow = 4 * e * (1 - e) * sweep * 0.35;
    if (aAcross * bAcross < 0) along += bow;                             // round the back
    else across += bow * ((aAcross + bAcross) >= 0 ? 1 : -1);            // out to the side
  }

  // Station-keeping: two slow sines a side, scaled down the arm (WANDER_RANK).
  const p1 = frac(f.ax * 12.91 + f.ay * 7.33 + i * 3.77) * TAU;
  const p2 = frac(f.ax * 4.41 + f.ay * 19.73 + i * 8.31) * TAU;
  const p3 = frac(f.ax * 2.71 + f.ay * 11.13 + i * 5.19) * TAU;
  const rk = WANDER_RANK + (1 - WANDER_RANK) * clamp01(rank / Math.max(1, m - 1));
  const wA = WANDER_ACROSS * SKEIN_ACROSS * rk;
  across += (Math.sin(now * WANDER_SLOW + p1) * 0.6 + Math.sin(now * WANDER_FAST + p2) * 0.4) * wA;
  along += (Math.sin(now * WANDER_SLOW * 0.83 + p2) * 0.6 + Math.sin(now * WANDER_FAST * 1.21 + p3) * 0.4)
    * WANDER_ALONG * SKEIN_ALONG * rk;
  // ⚠ Lift flattens below LIFT_FLOOR, or a bird holding station low is under the turf at z = 0.
  const lift = (Math.sin(now * WANDER_SLOW * 0.71 + p3) * 0.7 + Math.sin(now * WANDER_FAST * 0.91 + p1) * 0.3)
    * WANDER_LIFT * rk * clamp01(z / LIFT_FLOOR);

  // Each bird yaws by its own correction: the wander's lateral rate (analytic) over the cruise.
  const rate = (Math.cos(now * WANDER_SLOW + p1) * WANDER_SLOW * 0.6
    + Math.cos(now * WANDER_FAST + p2) * WANDER_FAST * 0.4) * wA * 1000;
  const yaw = Math.atan2(rate, GOOSE_CRUISE);

  // Each bird follows the leader's track: `trail(lagMs)` gives the leader's centre and heading that
  // long ago, so the tail doesn't swing round like a clock hand. Without a trail, a rigid V.
  if (trail && along > 0) {
    const lag = Math.min(3000, (along / GOOSE_CRUISE) * 1000);
    const p = trail(lag);
    if (p) {
      // ⚠ Blended back to the rigid V near the ground, where groundSpot starts from the rigid slots.
      const w = clamp01(z / LIFT_FLOOR);
      const c0 = Math.cos(p.heading), s0 = Math.sin(p.heading);
      const ch = Math.cos(heading), sh = Math.sin(heading);
      const rx = cx - ch * along - sh * across, ry = cy - sh * along + ch * across;
      const dh = Math.atan2(Math.sin(p.heading - heading), Math.cos(p.heading - heading));
      return {
        x: rx + (p.cx - s0 * across - rx) * w,
        y: ry + (p.cy + c0 * across - ry) * w,
        lift, yaw, headingNow: heading + dh * w,
        beat: frac(f.ax * 5.51 + f.ay * 2.27) - along / FLAP_WAVELENGTH,
      };
    }
  }
  const ch = Math.cos(heading), sh = Math.sin(heading);
  return {
    x: cx - ch * along - sh * across,
    y: cy - sh * along + ch * across,
    lift,
    yaw,
    // Minus: a bird further back is later in the beat.
    beat: frac(f.ax * 5.51 + f.ay * 2.27) - along / FLAP_WAVELENGTH,
  };
}

/** Every bird in an airborne flock, for the strike test and shape harnesses. */
export function skeinBirds(f, now, st) {
  const out = [];
  for (let i = 0; i < st.n; i++) out.push(skeinSlot(f, i, st.n, now, st.cx, st.cy, st.heading, st.z));
  return out;
}

// ⚠ The strike test asks about each bird, never a disc round the flock, which is why the formation
// lives in this file. ⚠ The radius is the bird, not a difficulty dial: it was measured to keep the
// strike rate (about one per 5-14 min of low flying over habitat). Don't widen it by feel.
export const STRIKE_R = GOOSE_SPAN * 0.6;
// The furthest a bird ever gets from its centre. Derived, so the flock search never drops the tail.
export const SKEIN_EXTENT = (MAX_FLOCK - 1) * Math.hypot(SKEIN_ALONG * (1 + BREATHE), SKEIN_ACROSS) * 1.15;
const STRIKE_PAD = SKEIN_EXTENT + 0.2;    // how far either side of the leg to look for flocks at all

// ── Flying into them ──────────────────────────────────────────────────────────
/**
 * Did the path from (ax,ay) to (bx,by) go through an airborne flock at `now`?
 * ⚠ Lives here so the strike and the picture are the same arithmetic; never copy it into plugins/flight.
 * ⚠ A swept segment, never a point: a 3 s flight tick covers several tiles.
 */

const distToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
};

// ⚠ Pass `isBlocked` unless you truly have no map (a bench, a fixture): without it the test uses
// the plain circle while the windscreen paints the bent one.
export function flockOnSegment(ax, ay, bx, by, now, isHabitat, radius = STRIKE_R, density = 1, isBlocked = null) {
  if (![ax, ay, bx, by].every(Number.isFinite)) return null;
  const midX = (ax + bx) / 2, midY = (ay + by) / 2;
  // ⚠ The cheap reject must use the widest circuit of any species, not the goose's.
  const reach = Math.hypot(bx - ax, by - ay) / 2 + WIDEST_R + STRIKE_PAD;
  for (const fl of flocksNear(midX, midY, reach, density, isHabitat)) {
    const st = flockState(fl, now, flockClearance(fl, isBlocked));
    if (!st.airborne) continue;
    // Cheap reject on the whole flock, then the birds themselves.
    if (distToSegment(st.cx, st.cy, ax, ay, bx, by) > radius + SKEIN_EXTENT) continue;
    const birds = skeinBirds(fl, now, st);
    for (let i = 0; i < birds.length; i++) {
      if (distToSegment(birds[i].x, birds[i].y, ax, ay, bx, by) <= radius) return { ...st, anchor: fl, bird: i };
    }
  }
  return null;
}

// ── Contact ───────────────────────────────────────────────────────────────────
// A strike steps the airframe along its 3D path in time and counts each bird inside its body.
// Nothing is rolled.
// ⚠ Murmuration birds exist only in the client (murmur.js), so a starling cloud is an ellipsoid
// (Ballerini's 1 : 2.8 : 5.6) at MURMUR_M3_PER_BIRD, and the count is the expected birds swept.

// Masses for a strike's energy (½mv²), in kg.
export const BIRD_MASS_KG = { goose: 4.0, gull: 1.0, pigeon: 0.35, songbird: 0.08, hawk: 1.0, peregrine: 0.9, vulture: 1.9 };
// Space per bird in a murmuration, the median of Ballerini et al. 2008.
export const MURMUR_M3_PER_BIRD = 2.47;
// The highest any flock flies, in tiles. ⚠ A function because SPECIES is declared further down.
export const birdCeiling = () => Math.max(...Object.values(SPECIES).map((s2) => s2.z)) + 0.5;

// ── Evasion ───────────────────────────────────────────────────────────────────
// Birds react at a distance (Blackwell et al. 2009, 2012): notice at EVADE_DETECT_M, react after
// EVADE_LATENCY_S, then accelerate down and away up to EVADE_MAX_M. Faster aircraft leave less time.
// ⚠ Solved from the current velocity with no memory, so server and canopy agree on who got clear.
export const EVADE_DETECT_M = 40;
export const EVADE_LATENCY_S = 0.25;
export const EVADE_ACCEL_G = 1.0;
export const EVADE_MAX_M = 8;
const EVADE_RELAX_S = 2.5;
export const BIRD_TUNE_EVADE = { on: 1 };

/** How far a bird at (bx, by, bz) has moved out of the way of `ac` ({x, y, z, vx, vy, vz}, tiles and
 *  tiles/s), as [dx, dy, dz] in tiles, or null. */
export function birdEvade(bx, by, bz, ac) {
  if (!BIRD_TUNE_EVADE.on || !ac) return null;
  const v2 = ac.vx * ac.vx + ac.vy * ac.vy + ac.vz * ac.vz;
  if (v2 < 1e-6) return null;
  const D = EVADE_DETECT_M / BIRD_M_PER_TILE;
  const rx = bx - ac.x, ry = by - ac.y, rz = bz - ac.z;
  const rv = rx * ac.vx + ry * ac.vy + rz * ac.vz, r2 = rx * rx + ry * ry + rz * rz;
  const disc = rv * rv - v2 * (r2 - D * D);
  if (disc < 0) return null;                         // it never comes within reach of noticing
  const td = (rv - Math.sqrt(disc)) / v2;            // when it came within D (negative: already has)
  if (td > 0) return null;                           // not yet
  const tc = rv / v2;                                // closest approach
  const A = EVADE_ACCEL_G * 9.81 / BIRD_M_PER_TILE, cap = EVADE_MAX_M / BIRD_M_PER_TILE;
  const move = (s) => Math.min(cap, 0.5 * A * Math.max(0, s - EVADE_LATENCY_S) ** 2);
  const disp = tc >= 0 ? move(-td) : move(tc - td) * Math.exp(tc / EVADE_RELAX_S);
  if (disp < 1e-5) return null;
  // Away from the line and down; a bird dead ahead picks a side off its own position.
  let wx = rx - ac.vx * tc, wy = ry - ac.vy * tc;
  const wl = Math.hypot(wx, wy);
  if (wl < 1e-4) { const s = frac(bx * 7.13 + by * 3.71) < 0.5 ? 1 : -1, hl = Math.sqrt(ac.vx * ac.vx + ac.vy * ac.vy) || 1; wx = -ac.vy / hl * s; wy = ac.vx / hl * s; }
  else { wx /= wl; wy /= wl; }
  const k = Math.SQRT1_2;
  return [wx * disp * k, wy * disp * k, -Math.min(disp * k, Math.max(0, bz - 0.05))];
}

/** How far a bird sitting exactly on the aircraft's line manages to move before it arrives, in tiles. */
export function evadeOnLine(V) {
  if (!BIRD_TUNE_EVADE.on) return 0;
  const sp = Math.hypot(V.vx, V.vy, V.vz);
  if (sp < 1e-6) return 0;
  const s = (EVADE_DETECT_M / BIRD_M_PER_TILE) / sp - EVADE_LATENCY_S;
  const A = EVADE_ACCEL_G * 9.81 / BIRD_M_PER_TILE;
  return s > 0 ? Math.min(EVADE_MAX_M / BIRD_M_PER_TILE, 0.5 * A * s * s) : 0;
}

/**
 * Every bird the airframe went through between two moments.
 *
 * `a` and `b` are `{ x, y, z, ms }`: grid tiles, height in tiles, wall time. `opts`:
 *   isHabitat(wx, wy) → species id or false, as flocksNear takes it;
 *   isBlocked(wx, wy), for the clearance every circuit bends round (see flockOnSegment's ⚠);
 *   halfSpan / halfHeight, the airframe's body in tiles;
 *   daylight(speciesId) → bool, the caller's clock.
 * Returns `{ hits: [{ sp, n }], birds, energyJ }`, energy at `speed` m/s closing speed, or null.
 */
export function birdContacts(a, b, opts = {}) {
  if (![a.x, a.y, a.z, b.x, b.y, b.z].every(Number.isFinite)) return null;
  if (Math.min(a.z, b.z) - (opts.halfHeight ?? 0) > birdCeiling()) return null;
  const hs = opts.halfSpan ?? 0.5, hh = opts.halfHeight ?? 0.14;
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const reach = len / 2 + WIDEST_R + STRIKE_PAD + hs;
  const flocks = flocksNear((a.x + b.x) / 2, (a.y + b.y) / 2, reach, opts.density ?? 1, opts.isHabitat);
  if (!flocks.length) return null;
  // Substeps no longer than half the span, so a bird can't slip between two.
  const steps = Math.max(1, Math.min(80, Math.ceil(len / Math.max(0.05, hs))));
  const hx = (b.x - a.x) / (len || 1), hy = (b.y - a.y) / (len || 1);
  // The aircraft's velocity over the leg, tiles/s, for evasion.
  const dtS = Math.max(1e-3, (b.ms - a.ms) / 1000);
  const V = { vx: (b.x - a.x) / dtS, vy: (b.y - a.y) / dtS, vz: (b.z - a.z) / dtS };
  const out = new Map(), struck = [];
  let energy = 0;
  const speed = opts.speed ?? 0;
  for (const fl of flocks) {
    const sid = fl.sp || 'goose', sp = spOf(fl);
    if (opts.daylight && !opts.daylight(sid)) continue;
    const clear = flockClearance(fl, opts.isBlocked);
    const hit = new Set();
    // Hit points for the canopy's puffs (bird-strikes.js), capped at a dozen.
    const pts = [];
    let cloud = 0;
    for (let k = 0; k <= steps; k++) {
      const u = k / steps, ms = a.ms + (b.ms - a.ms) * u;
      const px = a.x + (b.x - a.x) * u, py = a.y + (b.y - a.y) * u, pz = a.z + (b.z - a.z) * u;
      const st = flockState(fl, ms, clear, opts.when);
      if (!st.airborne) continue;
      if (sp.circuit === 2) {
        // Inside the ellipsoid? Then count the birds in the swept slab of frontal area.
        const vol = st.n * MURMUR_M3_PER_BIRD / BIRD_M_PER_TILE ** 3;
        const c = Math.cbrt((3 * vol) / (4 * Math.PI * 2.8 * 5.6));
        const aT = c, aW = 2.8 * c, aL = 5.6 * c;
        // murmur.js flies the long axis broadside to the course; the width runs along it.
        // ⚠ The cloud is where the pilot saw it: the client sends the GPU flock's drift
        // (opts.cloudOffset), clamped to the body's length so a client can't carry it elsewhere.
        let ox = 0, oy = 0, oz = 0;
        const off = opts.cloudOffset ? opts.cloudOffset(fl) : null;
        if (off) {
          const r = Math.hypot(off.dx, off.dy), cap = aL * 1.5, kk = r > cap ? cap / r : 1;
          ox = off.dx * kk; oy = off.dy * kk; oz = Math.max(-aT * 2, Math.min(aT * 2, off.dz || 0));
        }
        const dx = px - st.cx - ox, dy = py - st.cy - oy, dz = pz - st.z - oz;
        const ch = Math.cos(st.heading), sh = Math.sin(st.heading);
        const along = dx * ch + dy * sh, side = -dx * sh + dy * ch;
        if ((side / aL) ** 2 + (along / aW) ** 2 + (dz / aT) ** 2 <= 1) {
          const seg = len / steps * (k === 0 || k === steps ? 0.5 : 1);
          // The cloud evades as a share: the part that moves clear of the frontal area is spared.
          const moved = evadeOnLine(V);
          const k2 = Math.SQRT1_2;
          const left = Math.max(0, 1 - (moved * k2) / (2 * hs)) * Math.max(0, 1 - (moved * k2) / (2 * hh));
          const add = left * seg * (2 * hs) * (2 * hh) * BIRD_M_PER_TILE ** 3 / MURMUR_M3_PER_BIRD;
          cloud += add;
          if (add > 0.5 && pts.length < 12) pts.push([px, py, pz]);
        }
        continue;
      }
      if (Math.hypot(st.cx - px, st.cy - py) > SKEIN_EXTENT + 3 + hs) continue;
      const birds = skeinBirds(fl, ms, st);
      for (let i = 0; i < birds.length; i++) {
        if (hit.has(i)) continue;
        let bxx = birds[i].x, byy = birds[i].y, bz = st.z + (birds[i].lift || 0);
        // The bird as it is after getting out of the way of this aircraft (birdEvade).
        const ev = birdEvade(bxx, byy, bz, { x: px, y: py, z: pz, ...V });
        if (ev) { bxx += ev[0]; byy += ev[1]; bz += ev[2]; }
        if (Math.abs(bz - pz) > hh) continue;
        // Across the airframe (its span) and along it (a bird within half a substep of the nose).
        const rx = bxx - px, ry = byy - py;
        // ⚠ A zero-length path has no direction; a hovering aircraft is a disc of its own span.
        const inside = len < 1e-6 ? Math.hypot(rx, ry) <= hs
          : Math.abs(-rx * hy + ry * hx) <= hs && Math.abs(rx * hx + ry * hy) <= Math.max(hs * 0.5, len / steps);
        if (inside) { hit.add(i); if (pts.length < 12) pts.push([bxx, byy, bz]); }
      }
    }
    const n = hit.size + Math.round(cloud);
    if (!n) continue;
    out.set(sid, (out.get(sid) || 0) + n);
    // Until it lands: a struck flock flies on short, the way a hawk's kill leaves one (lostTo).
    const sb = flockState(fl, b.ms, clear, opts.when);
    const left = sb.airborne ? (1 - sb.t) * sb.period * (1 - sp.uGround) * (sb.span || 1) : 0;
    struck.push({ ax: fl.ax, ay: fl.ay, sp: sid, n, untilMs: b.ms + left, pts: pts.map((p) => p.map((q) => Math.round(q * 1000) / 1000)) });
    energy += n * 0.5 * (BIRD_MASS_KG[sid] ?? 1) * speed * speed;
  }
  if (!out.size) return null;
  const hits = [...out].map(([sp, n]) => ({ sp, n }));
  return { hits, flocks: struck, birds: hits.reduce((s, h) => s + h.n, 0), energyJ: energy };
}

// ── Daylight ──────────────────────────────────────────────────────────────────
// Geese fly by day. The renderer gates on `sky.night` and the text game on this hour; they may
// differ by minutes at dawn and dusk, never by a night.
export const GOOSE_DAY_START = 6, GOOSE_DAY_END = 20;
export const gooseDaylight = (hour) => hour >= GOOSE_DAY_START && hour < GOOSE_DAY_END;

// ── The species table ─────────────────────────────────────────────────────────
// A species is a row that travels on the flock: `flockAt` stamps `f.sp`, and a flock without one
// is a goose. ⚠ The goose row points at the exported GOOSE_* constants; never restate them.
export const SPECIES = {
  goose: {
    id: 'goose',
    // Take-off, drawing only: `run` metres on its feet before lifting, `beat` the launch beat
    // multiplier, `hop` the stride bounce. A goose is too heavy to jump off.
    takeoff: { run: 12, beat: 1.4, hop: M(0.044) },
    // `skid`: metres it skis on its feet landing on water (drawing only)
    landing: { skid: 6 },
    habitat: GOOSE_HABITAT,
    dense: DENSE, sparse: SPARSE, areaBias: GOOSE_AREA_BIAS,
    period: GOOSE_PERIOD, uGround: U_GROUND, z: GOOSE_Z, r: GOOSE_R,
    minFlock: MIN_FLOCK, maxFlock: MAX_FLOCK,
    // Spacing on the ground, centre to centre (see groundPatchR).
    groundPitch: M(3),
    forms: SKEIN_FORMS,
    dayStart: 6, dayEnd: 20,
    callEvery: 96000, callBurst: [2, 4], callGap: 620,
    // Tiles. ⚠ Every drawRange is where the bird is about 1.5 px across on the 640-wide frame.
    drawRange: 14,
  },
  gull: {
    id: 'gull',
    // a few quick steps or a hop into the wind, then open wings: a short run
    takeoff: { run: 3, beat: 1.4, hop: M(0.066) },
    landing: { skid: 1.5 },   // a gull drops on to water with a short skid
    habitat: {
      water: 'raft',
      dock: 'walk', pier: 'walk', docks: 'walk',
      // Inland, only when it's rough out (GULL_STORM).
      concrete: 'walk', asphalt: 'walk', citycore: 'walk', marquee: 'walk', freight: 'walk',
    },
    dense: 0.09, sparse: 0.012, areaBias: 0.38,
    // Set by speed (about 13 m/s). ⚠ The fauna gate holds it wider than the goose on a shorter cycle.
    period: 79000, uGround: 0.08, z: 1.6, r: M(105),
    minFlock: 4, maxFlock: 12,
    // No V: gulls go in a loose cloud.
    forms: ['loose'],
    dayStart: 5, dayEnd: 21,
    preyable: true,
    // Cries come about a quarter-second apart (measured off the reference recording).
    callEvery: 54000, callBurst: [3, 6], callGap: 250,
    drawRange: 12,
    groundPitch: M(2.5),
    perch: { share: 0.42 },
  },

  // The feral pigeon: the city bird, on pavement.
  pigeon: {
    id: 'pigeon',
    // near-vertical burst with a wing clap, no run
    takeoff: { run: 0, beat: 2.0, hop: 0 },
    // The habitat callback in windshield.js keeps them off carriageways.
    habitat: {
      concrete: 'walk', asphalt: 'walk', citycore: 'walk', marquee: 'walk',
      freight: 'walk', civic: 'walk', uptown: 'walk',
    },
    // ⚠ Kept below a real city's density for frame cost (BIRD_FACE_BUDGET in windshield.js).
    dense: 0.05, sparse: 0.012, areaBias: 0.34,
    street: true,             // stands in the road, so can perch on what lines it
    // Mostly down and up often: the flush. Period set by speed (about 12 m/s); the 0.78 ground
    // share sets how many pigeons are airborne, which framecost pays for.
    period: 63600, uGround: 0.78, z: 0.9, r: M(18),
    minFlock: 4, maxFlock: 10,
    forms: ['loose'],
    dayStart: 6, dayEnd: 20,
    callEvery: 82000, callBurst: [2, 3], callGap: 950,
    // ⚠ Short because the bird is small; it also keeps the 2-D fallback's framecost in check.
    drawRange: 5.5,
    preyable: true,
    groundPitch: M(1.1),
    perch: { share: 0.55 },     // the highest: the ledge is where a pigeon lives
  },

  // The songbird, modelled on a starling. Heard further than it's seen: the call range in
  // windshield.js is deliberately not shortened to match drawRange.
  songbird: {
    id: 'songbird',
    // a jump launch, no run (the GPU flock's own take-off pose)
    takeoff: { run: 0, beat: 1.5, hop: 0 },
    habitat: {
      grass: 'walk', parkland: 'walk', park: 'walk', forest: 'walk',
      citycore: 'walk', concrete: 'walk', uptown: 'walk', civic: 'walk',
    },
    dense: 0.06, sparse: 0.014, areaBias: 0.4,
    street: true,
    // It sweeps a roost (`circuit: 2`, wanderAt). `roam` is the roost radius at `wander.refN` birds,
    // growing by the cube root; `wander` holds the epicycles' shares and speeds (m/s). `r` stays the
    // nominal radius that cloud size and clearance margins key on.
    // ⚠ Its centre moves at about the birds' own speed: murmur.js birds fly the centre's course.
    // z 2.2 tiles (~39 m), among the roofs; over towers the drawn flock rides the skyline
    // (skylineUnder in windshield.js) while the server keeps this height.
    period: 300000, uGround: 0.7, z: 2.2, r: M(11),
    // A smaller roam makes the flock mill and double back over one place instead of touring.
    circuit: 2, roam: M(27.5), forcedSpan: 12,
    // ⚠ Its own wingbeat (Kirchhefer et al. 2013: 13.3 Hz at 12 m/s); the goose's 1.5 Hz made it skate.
    // It glides between bursts (Tobalske 1995): `glide` is the held-wing share of each cycle,
    // `glideHz` cycles a second.
    flapHz: 13, glide: 0.28, glideHz: 1.4,
    wander: { refN: 1700, a1: 0.62, v1: M(4.0), v2: M(1.0), v3: M(0.33) },
    minFlock: 450, maxFlock: 60000,
    // A rare share of roosts is enormous, drawn by the GPU flock (gl/murmur-gpu.js); see flockSize.
    // The 60,000 cap is a taste call, not a cost one. Under frame pressure a grand roost thins to
    // RENDER_TUNE.murmurFloor. Only on woodland and city centre, never open field (where they feed);
    // `onShare` is higher than `share` because it's drawn from fewer anchors.
    grand: { share: 0.04, onShare: 0.08, from: 4000, below: 1700, on: ['forest', 'citycore'] },
    // A murmuration may be drawn thinned where a skein is skipped whole. ⚠ The floor must fit the
    // smallest budget (15 × 55 under the canvas painter's 840), or the canvas draws none at all.
    thin: 15,
    forms: ['loose'],
    // ⚠ 18.6 is when windshield.js stops drawing birds (GOOSE_NIGHT_OFF at sky.night 0.55). The dusk
    // peak and dive key off dayEnd: move one and move the other.
    dayStart: 5, dayEnd: 18.6,
    callEvery: 70000, callBurst: [3, 6], callGap: 420,
    // The dawn chorus peaks before sunrise.
    song: { peak: 5.2, span: 3.4, boost: 9 },
    // The only species with a year: murmurations peak in early February (Goodenough et al. 2017);
    // `floor` keeps starlings in a summer park.
    season: { peak: 36, gamma: 1.7, floor: 0.06 },
    // The pre-roost gathering: peaks `lead` hours before dayEnd, `span` wide, `floor` the rest of the
    // day. `dive`, `show` (minutes) and `jitter` time the display and descent (roostShow);
    // `minSeason` stops a tiny summer party staging a show.
    roost: { lead: 0.7, span: 1.1, floor: 0.02, dive: 0.25, show: 26, jitter: 0.1, minSeason: 0.35 },
    drawRange: 3.5,
    // Gulls, pigeons and songbirds are prey; a goose is too big for a hawk.
    preyable: true,
    // ⚠ A share of the one BIRD_FACE_BUDGET (windshield.js), never a budget of its own.
    budgetShare: 0.6,
    groundPitch: M(1.0),
    perch: { share: 0.5 },
    // ⚠ Most starling anchors are road or paving, so the renderer moves the landing up to `reach`
    // tiles to a wire or lawn (landSite in windshield.js). `perchedNow` keeps room text in step.
    land: { reach: 3 },
  },

  // The red-tailed hawk: solitary, out in the open, takes rodents off the ground and never hunts
  // birds (the peregrine does). ⚠ n = 1 is real; see the guard in skeinSlot.
  hawk: {
    id: 'hawk',
    // drops off a perch into a glide, or jumps up with a few beats: no run
    takeoff: { run: 0, beat: 1.3, hop: 0 },
    habitat: {
      // ⚠ Not green ground: a territorial claim on a park tile takes it from the geese and songbirds.
      redrock: 'walk', scrub: 'walk', hardpan: 'walk',
      badlands: 'walk', cliff: 'walk', plateau: 'walk', deadwood: 'walk', basalt: 'walk', alkali: 'walk',
      // ⚠ The terrains that map to the 'badlands' biome, so the room text agrees with the window.
      dirt: 'walk', sand: 'walk', gravel: 'walk', marsh: 'walk',
    },
    // Rare; the territory thins it further to at most one per 15x15 block.
    dense: 0.012, sparse: 0.003, areaBias: 0.5,
    // Tiles each way one bird holds (see flockAt).
    territory: 7,
    // Claims a tile only where its own roll lands, never through the co-tenant pick (speciesAt).
    streetHunt: true,
    // Half the cycle perched; a long period keeps each flight a proper climb.
    period: 240000, uGround: 0.5, z: 3.6, r: M(21),
    minFlock: 1, maxFlock: 1,
    forms: ['loose'],
    circuit: 1,               // the spiral, not the circle
    // Laps set by speed: about 10 m/s round a thermal.
    turns: 8,
    // Thermals need sun.
    dayStart: 9, dayEnd: 17,
    callEvery: 190000, callBurst: [1, 2], callGap: 1400,
    drawRange: 10,
    perch: { share: 0.7, high: true },
    // Hunts critters on the ground (crittersAt, groundStrike); never touches a flock.
    groundHunt: { odds: 0.15, perchOdds: 0.5 },
    // Sits tight when the weather turns (weatherTell).
    weatherTell: true,
  },

  // The peregrine: the city's hunter, perched on tower setbacks most of the day, taking pigeons in a
  // stoop. About 15 dives a day; the hour gate is the caller's (the hunt in windshield.js).
  peregrine: {
    id: 'peregrine',
    takeoff: { run: 0, beat: 1.5, hop: 0 },
    habitat: { citycore: 'walk', concrete: 'walk', uptown: 'walk', docks: 'walk' },
    dense: 0.006, sparse: 0.0012, areaBias: 0.5,
    // ⚠ Wider than HUNT_REACH (6, windshield.js) so two falcons never share a tower.
    territory: 7,
    // May claim a road tile, but only where its own roll lands (see speciesAt).
    streetHunt: true,
    period: 900000, uGround: 0.8, z: 4.4, r: M(15.4),
    minFlock: 1, maxFlock: 1,
    forms: ['loose'],
    circuit: 1,
    // About 8 m/s round a 15 m circle.
    turns: 14,
    dayStart: 6, dayEnd: 20,
    callEvery: 240000, callBurst: [3, 6], callGap: 160,
    drawRange: 8.5,
    perch: { share: 0.9, high: true },
    // ⚠ The only species that stoops (falconStoop); a row without it never attacks.
    stoop: { odds: 0.10, perchOdds: 0.28 },
  },

  // The vulture: circles high, comes down to a body (the anchor), feeds, goes back up.
  // ⚠ Never 'buzzard': that's a building_type (Buzzard Field).
  vulture: {
    id: 'vulture',
    // heavy: several hopping strides before it lifts
    takeoff: { run: 8, beat: 1.3, hop: M(0.13) },
    habitat: {
      // The wastes only, never green ground or the city. `scrub` covers the Reach and the void
      // corridor's verge.
      scrub: 'walk', ash: 'walk', deadwood: 'walk', basalt: 'walk', sinter: 'walk',
      redrock: 'walk', hardpan: 'walk', gravel: 'walk', plateau: 'walk', dirt: 'walk',
    },
    // Rare, but a flock is several birds.
    dense: 0.006, sparse: 0.002, areaBias: 0.45,
    // Laps set by speed: about 10 m/s round a thermal.
    period: 210000, uGround: 0.42, z: 4.4, r: M(35), turns: 6,
    minFlock: 3, maxFlock: 7,
    forms: ['loose'],
    // A tight knot on the ground reads as a kill; no carcass is modelled.
    groundSpread: M(1.0),
    // ⚠ groundSpread bounds one bird's pacing; the pitch sets how far apart they stand, so it must
    // stay tight too or the knot spreads out with the count.
    groundPitch: M(0.66),
    dayStart: 8, dayEnd: 18,
    // No syrinx: it only hisses, over the body (see BIRD_VOICES).
    callEvery: 240000, callBurst: [1, 3], callGap: 700,
    drawRange: 14.5,          // the longest in the table: high, and a 1.7 m span
    budgetShare: 0.35,
    perch: { share: 0.3, high: true },
    // The wing is one tone on purpose: the silver trailing half is on the underside, which the
    // camera almost never sees, and the palette has one `wing` colour (see fauna3d.js).
  },
};

// Grounds that hold gulls only when the weather drives them off the sea.
// ⚠ Keyed on the day's headline weather name, never a local sample or a forecast: it's the one
// value both surfaces hold identically.
const GULL_INLAND = new Set(['concrete', 'asphalt', 'citycore', 'marquee', 'freight']);

export const GULL_WEATHER = new Set(['rain', 'sleet', 'thunderstorm', 'storm', 'snow', 'blizzard']);
export const gullsAshore = (weather) => GULL_WEATHER.has(weather);

// ── What kind of place is this ────────────────────────────────────────────────
// ⚠ The ground tint isn't the place: Coldwater's streets are painted `redrock`, so the city birds'
// keys (`citycore`, `docks`) never come out of biomeOf. Place is structural: buildings among the
// neighbours make a city, and water beside them a dock. The caller counts its neighbours; the rule
// lives here once. ⚠ Green ground and water keep their own answer, or city parks lose their birds.
const GREEN_GROUND = new Set(['parkland', 'park', 'forest', 'grass']);

/**
 * @param {string} biome  what the ground derivation says this tile is
 * @param {number} bld    how many of the eight neighbours are buildings
 * @param {boolean} shore whether any neighbour is water
 */
export function placeOf(biome, bld, shore) {
  if (!biome) return biome;
  if (biome === 'water') return biome;
  if (GREEN_GROUND.has(biome)) return biome;
  if (!bld) return biome;                    // open country, whatever it is painted
  return shore ? 'docks' : 'citycore';
}

// ⚠ Derived from SPECIES, never a hand-written list (a missing name leaves a species nowhere).
// ⚠ The order matters: the co-tenant hash indexes into it, so reordering moves birds worldwide.
const SPECIES_ORDER = Object.keys(SPECIES);

/**
 * Which species lives on this ground, or null. `opts.weather` is the headline weather (calm if
 * omitted). ⚠ Co-tenants are picked by a tile hash, never a priority order.
 */
export function speciesAt(ground, wx, wy, opts = {}) {
  // An airfield is kept mostly clear, by a tile hash so every surface agrees.
  if (opts.airfield && frac(wx * 7.31 + wy * 19.17 + 0.41) > AIRFIELD_BIRDS) return null;
  const rough = gullsAshore(opts.weather);
  const live = [];
  for (const id of SPECIES_ORDER) {
    const sp = SPECIES[id];
    if (!sp.habitat[ground]) continue;
    // A road is habitat for a street bird only, and a path through green ground never is.
    // ⚠ A `streetHunt` species claims a tile only where its own territory-thinned roll lands and
    // never enters the co-tenant pick, so it costs others a tile only where it really lives.
    if (sp.streetHunt) {
      if (!(opts.road && GREEN_GROUND.has(ground)) && flockAt(wx, wy, 1, id)) return id;
      continue;
    }
    if (opts.road && (!sp.street || GREEN_GROUND.has(ground))) continue;
    if (id === 'gull' && GULL_INLAND.has(ground) && !rough) continue;
    live.push(id);
  }
  if (!live.length) return null;
  if (live.length === 1) return live[0];
  return live[Math.floor(frac(wx * 13.77 + wy * 91.31 + 5.5) * live.length) % live.length];
}

/** The share of airfield tiles that still hold a flock (speciesAt). */
export const AIRFIELD_BIRDS = 0.12;

/** What a given species DOES on a given ground: 'walk', 'raft', or null if it is not there. */
export const habitatState = (id, ground) => (SPECIES[id] || SPECIES.goose).habitat[ground] || null;

/** The row a flock belongs to. A flock with no species is a goose. */
export const spOf = (f) => (f && SPECIES[f.sp]) || SPECIES.goose;

// What each formation is called. ⚠ Kept beside the forms so describe.js never prints "undefined"
// for a new one.
export const FORM_WORDS = {
  v: 'a loose V',
  j: 'a lopsided V, one arm longer than the other',
  ech: 'one long ragged line',
  loose: 'no shape at all, just a lot of them going the same way',
};

// ── When a flock calls ────────────────────────────────────────────────────────
// Bursts separated by long silences, from anchor and clock, so every machine hears the same calls.
// ⚠ The playback budget (how many are heard at once) belongs to the listener: the call limiter in
// windshield.js, never this shared model.
const CALL_JITTER = 0.34;          // how much the silence between bursts varies, per flock

// How much more a species calls near its `song` peak hour (the dawn chorus): a rate, not a gate.
function songFactor(sp, hour) {
  const w = sp.song;
  if (!w || hour == null) return 1;
  // wrapped across midnight
  let d = Math.abs(hour - w.peak);
  if (d > 12) d = 24 - d;
  if (d >= w.span) return 1;
  const t = 1 - d / w.span;
  return 1 / (1 + (w.boost - 1) * t * t);
}

/** Every call this flock makes in (fromMs, toMs], each with its index in the burst. Usually none. */
export function callsIn(f, fromMs, toMs, opts = {}) {
  if (!(toMs > fromMs)) return [];
  const sp = spOf(f);
  // ⚠ A long window (hidden tab, stall) is dropped, never replayed as a burst of birds at once.
  if (toMs - fromMs > 1500) fromMs = toMs - 1500;
  const every = sp.callEvery * (0.72 + frac(f.ax * 5.31 + f.ay * 2.77) * (2 * CALL_JITTER))
    * songFactor(sp, opts.hour);
  const phase = frac(f.ax * 8.17 + f.ay * 13.9);
  const out = [];
  // Only the bursts either side of the window can contribute: three candidates.
  const k0 = Math.floor(fromMs / every - phase);
  for (let k = k0; k <= k0 + 2; k++) {
    const start = (k + phase) * every;
    const h = frac(f.ax * 3.19 + f.ay * 7.03 + k * 1.77);
    const n = sp.callBurst[0] + Math.floor(h * (sp.callBurst[1] - sp.callBurst[0] + 1));
    for (let i = 0; i < n; i++) {
      const at = start + i * sp.callGap * (0.78 + frac(k * 2.7 + i * 5.3) * 0.44);
      if (at > fromMs && at <= toMs) out.push({ at, index: i, burst: k });
    }
  }
  return out;
}

// ── Perching ──────────────────────────────────────────────────────────────────
// A perch is the ground phase at a different height; flockState is untouched.
// ⚠ This module says whether, the caller says where: only GLASS knows a building's ledges. A flock
// that wants a ledge with none in reach is simply on the ground.

// ── Where a landed flock stands ───────────────────────────────────────────────
// Each bird has a fixed station (a hash of anchor and index, never stored) and mills about it. The
// patch radius is `pitch · sqrt(n / π)`, so every bird gets the same standing room at any count.
const GROUND_PITCH_DEFAULT = M(3);

/** How far out the edge of a landed flock's patch is, in tiles. */
export function groundPatchR(f, n) {
  const pitch = spOf(f).groundPitch ?? GROUND_PITCH_DEFAULT;
  return pitch * Math.sqrt(Math.max(1, n) / Math.PI);
}

/** How far one bird wanders about its station. ⚠ Bounded by the pitch, or birds walk through each other. */
export function groundMill(f) {
  const sp = spOf(f);
  const pitch = sp.groundPitch ?? GROUND_PITCH_DEFAULT;
  return Math.min(sp.groundSpread ?? M(3.7), pitch * 0.30);
}

/**
 * Where bird `i` of `n` stands at `now` in a landed flock, and its facing. Here so gates share it.
 * `alarm` opens the patch as well as speeding the mill: startled birds move apart.
 */
export function groundSpot(f, i, n, now, alarm = 0) {
  const R = groundPatchR(f, n) * (1 + alarm * 2);
  const P = groundSpotParts(f, i, n);
  const r = R * P.q;
  const sx = f.ax + P.c * r + P.jx, sy = f.ay + P.sn * r + P.jy;
  const mill = groundMill(f) * (1 + alarm * 1.4);
  const rate = 0.00022 * (1 + alarm * 2.4);
  const a1 = now * rate + P.s * TAU, a2 = now * rate * 0.61 + P.s2 * TAU;
  return { x: sx + Math.cos(a1) * mill, y: sy + Math.sin(a2) * mill, heading: a1 + Math.PI / 2 };
}

/**
 * The fixed parts of bird `i`'s place on the patch: direction (c, sn), share of the radius (q),
 * jitter (jx, jy) and mill phases (s, s2). ⚠ gl/murmur-gpu.js bakes these into a texture, so this
 * stays the one copy.
 */
export function groundSpotParts(f, i, n) {
  // ⚠ A jittered golden-angle spiral, never two hashes per bird: Poisson points put birds inside each other.
  const th = i * 2.39996323 + frac(f.ax * 9.41 + f.ay * 27.3) * TAU;
  // sqrt on the index gives every bird equal area.
  const q = Math.sqrt((i + 0.5) / Math.max(1, n));
  const j1 = frac(f.ax * 31.7 + f.ay * 13.9 + i * 7.13 + 2.7) - 0.5;
  const j2 = frac(f.ax * 11.3 + f.ay * 41.9 + i * 3.71 + 8.1) - 0.5;
  const jit = (spOf(f).groundPitch ?? GROUND_PITCH_DEFAULT) * 0.18;
  return {
    c: Math.cos(th), sn: Math.sin(th), q, jx: j1 * jit, jy: j2 * jit,
    s: frac(f.ax * 7.3 + f.ay * 3.9 + i * 17.1), s2: frac(f.ax * 2.1 + f.ay * 13.3 + i * 5.7),
  };
}

// ⚠ The cycle number must be computed exactly as flightPhase and falconStoop do.
export function perchedNow(f, now) {
  const p = spOf(f).perch;
  if (!p || !p.share) return false;
  // ⚠ A grand roost lands on open ground, where the GPU flock draws every bird; a perched flock is
  // CPU-drawn and thinned.
  if (isGrandRoost(f)) return false;
  const period = flockPeriod(f);
  const ph = frac(f.ax * 19.1 + f.ay * 5.3);
  const cycle = Math.floor(now / period + ph);
  return frac(f.ax * 5.09 + f.ay * 7.71 + cycle * 3.37) < p.share;
}

/** Does this species want the highest ledge it can reach? A hunter does; a pigeon does not care. */
export const perchesHigh = (f) => !!(spOf(f).perch && spOf(f).perch.high);

// ── The falcon's stoop ───────────────────────────────────────────────────────
// ⚠ A kill mutates nothing: it's a pure function of both anchors and the clock, so both surfaces
// derive it. At most one stoop per cycle, at a fixed phase, so the rate never depends on frame rate.
const STOOP_AT = 0.72;             // where in the airborne phase the stoop happens
// Measured: Cooper's hawks killed in 35 of 179 urban attacks.
const STOOP_KILL = 0.20;
const STOOP_REACH = 9;             // tiles: how far a hawk will go for a flock
const STOOP_ODDS = 0.16;           // share of flights that carry a hunt at all
// A perched cycle hunts from the perch, with better odds.
const PERCH_STOOP_AT = 0.68;       // where in the PERCH phase the stoop happens
const PERCH_STOOP_ODDS = 0.38;

/** Is this hawk stooping at `now`, and at what? `near` is the caller's candidate prey list. */
export function falconStoop(f, now, near) {
  const sp = spOf(f);
  if (!sp.stoop || !near || !near.length) return null;
  const period = flockPeriod(f);
  const ph = frac(f.ax * 19.1 + f.ay * 5.3);
  const cycle = Math.floor(now / period + ph);
  const uG = sp.uGround;
  const perched = perchedNow(f, now);
  const at = perched
    ? (cycle - ph + uG * PERCH_STOOP_AT) * period
    : (cycle - ph + uG + (1 - uG) * STOOP_AT) * period;
  const age = (now - at) / 1000;
  if (age < 0 || age > 3.0) return null;
  if (frac(f.ax * 1.77 + f.ay * 6.31 + cycle * 4.13) >= (perched ? (sp.stoop.perchOdds ?? PERCH_STOOP_ODDS) : (sp.stoop.odds ?? STOOP_ODDS))) return null;

  // ⚠ The target is a cycle hash over a stably sorted list, never the nearest this frame.
  const prey = near.filter((p) => p !== f && spOf(p).preyable
    && Math.hypot(p.ax - f.ax, p.ay - f.ay) <= STOOP_REACH);
  if (!prey.length) return null;
  prey.sort((a, b) => (a.ax - b.ax) || (a.ay - b.ay));   // a stable order, not a camera's order
  const pick = prey[Math.floor(frac(f.ax * 3.3 + f.ay * 11.7 + cycle * 2.9) * prey.length) % prey.length];
  const hit = frac(f.ax * 8.8 + f.ay * 4.2 + cycle * 7.3) < STOOP_KILL;
  // ⚠ Aim at the flock's centre, never its anchor tile (an airborne flock is tiles away).
  // ⚠ Called without clearance on purpose: the server has no map, so both sides must skip it.
  const ps = flockState(pick, now);
  return { at, age, x: ps.cx, y: ps.cy, prey: pick, hit, cycle };
}

/** How many birds this flock is short, until it next lands (nothing is stored). */
export function lostTo(f, now, falcons, near) {
  if (!falcons || !falcons.length || !spOf(f).preyable) return 0;
  // ⚠ Pass the same `near` list the stoop resolved against; a list of one always picks itself.
  if (!near || !near.length) return 0;
  let lost = 0;
  for (const h of falcons) {
    const s = falconStoop(h, now, near);
    if (s && s.hit && s.prey === f) lost++;
  }
  return lost;
}

// ── Ground prey: what a red-tail eats ─────────────────────────────────────────
// Voles, jackrabbits and lizards that sit still and dart every few seconds.
// ⚠ A pure function of tile and wall clock, like the flocks. Ask `critterGround` first.
// ⚠ No cliff or plateau: they're raised ground, and a critter is placed at z 0.
const CRITTER_GROUND = new Set(['redrock', 'scrub', 'hardpan', 'badlands', 'basalt', 'alkali', 'deadwood']);
export const critterGround = (ground) => CRITTER_GROUND.has(ground);
export const CRITTER_KINDS = ['vole', 'jackrabbit', 'lizard'];
// How long one hop lasts (ms), and the share of it spent moving.
const CRITTER_HOP = { vole: [5200, 0.14], jackrabbit: [9000, 0.10], lizard: [6800, 0.08] };
const CRITTER_WANDER = 0.14;       // tiles a critter strays from its home spot
const ch = (wx, wy, k) => frac(wx * 12.9898 + wy * 78.233 + k * 37.719 + 3.1);

/** The critters on one tile at `now`: [{id, kind, x, y, heading, moving}], usually empty. */
export function crittersAt(wx, wy, now) {
  const n = ch(wx, wy, 1) < 0.30 ? (ch(wx, wy, 2) < 0.35 ? 2 : 1) : 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const kind = CRITTER_KINDS[Math.floor(ch(wx, wy, 3 + i) * CRITTER_KINDS.length) % CRITTER_KINDS.length];
    const hx = wx + (ch(wx, wy, 5 + i) - 0.5) * 0.7, hy = wy + (ch(wx, wy, 7 + i) - 0.5) * 0.7;
    const [P, runShare] = CRITTER_HOP[kind];
    const ph = ch(wx, wy, 9 + i);
    const k = Math.floor(now / P + ph), u = now / P + ph - k;
    const spot = (j) => {
      const a = frac(j * 0.618 + ch(wx, wy, 11 + i)) * Math.PI * 2, r = CRITTER_WANDER * Math.sqrt(frac(j * 0.377 + ph));
      return [hx + Math.cos(a) * r, hy + Math.sin(a) * r];
    };
    const A = spot(k), B = spot(k + 1);
    const moving = u < runShare, t = moving ? u / runShare : 1;
    const e = t * t * (3 - 2 * t);
    out.push({ id: wx + ',' + wy + ',' + i, kind, ax: wx, ay: wy,
      x: A[0] + (B[0] - A[0]) * e, y: A[1] + (B[1] - A[1]) * e,
      heading: Math.atan2(B[1] - A[1], B[0] - A[0]), moving });
  }
  return out;
}

// The red-tail's strike: scheduled exactly as falconStoop, aimed at a critter picked by a cycle
// hash over a stably sorted list.
const GROUND_REACH = 3;            // tiles
const GROUND_KILL = 0.30;          // share of strikes that take something
const GROUND_STRIKE_Z = M(0.125);  // a hawk standing over its catch, body centre
// Seconds it mantles over a kill. The renderer's dive reads it, so both agree when it leaves.
export const MANTLE_S = 20;
function groundStrikeOf(f, cycle, prey) {
  const sp = spOf(f), gh = sp.groundHunt;
  if (!gh || !prey || !prey.length) return null;
  const period = flockPeriod(f);
  const ph = frac(f.ax * 19.1 + f.ay * 5.3);
  const uG = sp.uGround;
  const perched = perchedNow(f, (cycle - ph + uG * 0.5) * period);
  const at = perched
    ? (cycle - ph + uG * PERCH_STOOP_AT) * period
    : (cycle - ph + uG + (1 - uG) * STOOP_AT) * period;
  if (frac(f.ax * 1.77 + f.ay * 6.31 + cycle * 4.13) >= (perched ? gh.perchOdds : gh.odds)) return null;
  const near = prey.filter((c) => Math.hypot(c.ax - f.ax, c.ay - f.ay) <= GROUND_REACH)
    .sort((a, b) => (a.ax - b.ax) || (a.ay - b.ay) || (a.id < b.id ? -1 : 1));
  if (!near.length) return null;
  const pick = near[Math.floor(frac(f.ax * 3.3 + f.ay * 11.7 + cycle * 2.9) * near.length) % near.length];
  // The dive goes where the critter is at the moment of the strike.
  const c = crittersAt(pick.ax, pick.ay, at).find((q) => q.id === pick.id) || pick;
  // ⚠ tz is the hawk's body-centre height, not the ground, or half the bird is under the floor.
  return { at, x: c.x, y: c.y, tz: GROUND_STRIKE_Z, prey: c, hit: frac(f.ax * 8.8 + f.ay * 4.2 + cycle * 7.3) < GROUND_KILL,
    cycle, ground: true, period, ph };
}

/** Is this red-tail striking at `now`, and at what? `prey` is the caller's critter list. */
export function groundStrike(f, now, prey) {
  if (!spOf(f).groundHunt) return null;
  const period = flockPeriod(f);
  const cycle = Math.floor(now / period + frac(f.ax * 19.1 + f.ay * 5.3));
  const s = groundStrikeOf(f, cycle, prey);
  if (!s) return null;
  const age = (now - s.at) / 1000;
  if (age < 0 || age > 3.0 + (s.hit ? MANTLE_S : 0)) return null;
  return { ...s, age };
}

/**
 * Every kill this red-tail made in the last `sinceMs`: [{ at, x, y, ax, ay, kind }]. The server uses
 * it for `search`, rederiving the strikes the renderer drew. `prey` is built as groundStrike's is.
 */
export function groundKillsSince(f, now, sinceMs, prey) {
  if (!spOf(f).groundHunt || !prey || !prey.length) return [];
  const period = flockPeriod(f), ph = frac(f.ax * 19.1 + f.ay * 5.3);
  const c1 = Math.floor(now / period + ph), c0 = Math.floor((now - sinceMs) / period + ph);
  const out = [];
  for (let c = c0; c <= c1; c++) {
    const s = groundStrikeOf(f, c, prey);
    if (!s || !s.hit) continue;
    const landed = s.at + 1000;
    if (landed > now || landed < now - sinceMs) continue;
    out.push({ at: landed, x: s.x, y: s.y, ax: s.prey.ax, ay: s.prey.ay, kind: s.prey.kind });
  }
  return out;
}

/** Has a red-tail taken this critter? From the strike landing to the end of that hawk's cycle. */
export function critterTaken(c, now, hawks, prey) {
  for (const h of hawks) {
    const period = flockPeriod(h);
    const cycle = Math.floor(now / period + frac(h.ax * 19.1 + h.ay * 5.3));
    const s = groundStrikeOf(h, cycle, prey);
    if (s && s.hit && s.prey.id === c.id && now >= s.at + 1000) return true;
  }
  return false;
}

export const birdDaylight = (id, hour) => {
  const sp = SPECIES[id] || SPECIES.goose;
  return hour >= sp.dayStart && hour < sp.dayEnd;
};

// The widest circuit any species flies, derived so the strike search covers every species.
const WIDEST_R = Math.max(...Object.values(SPECIES).map((s2) => s2.r));
