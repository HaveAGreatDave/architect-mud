// MURMUR — a starling cloud, simulated rather than derived.
//
// ⚠ THE SIMULATION ITSELF RUNS ON THE GPU (gl/murmur-gpu.js), AND ONLY THERE, since 2026-09-23. This
// file is what it is built from: the rule's numbers (MURMUR_RULES), the flock's own memory — its clock,
// the recent course of its centre, the orientation of its body — as `flockFrame`, the starting cloud as
// `seedPoints`, and the hawk's pulse train as a closed form. The per-bird step lives in the shader.
//
// ⚠ THIS IS THE ONE PLACE IN THE FAUNA SYSTEM THAT KEEPS STATE, and the exception is deliberate
// and narrow. Everything else about a flock — which tiles hold one, when it is up, where its
// centre is, how many birds are in it — is a pure function of (anchor, wall clock) in
// client/shared/birds.js, because the server prints those same facts into the room description and
// the two surfaces must agree. None of that changes here. What is simulated is only the ARRANGEMENT
// of the birds inside a flock whose position the shared model still owns.
//
//   DERIVED, and identical on every machine   the flock's tile, its cycle, its centre, its
//                                             altitude, its course, how many birds
//   SIMULATED, and local to this client       where each bird sits inside that cloud
//
// ⚠ FOUR THINGS THIS COSTS, all of them accepted on purpose rather than overlooked:
//   1. TWO PLAYERS SEE DIFFERENT CLOUDS. Two integrators that started at different moments never
//      reconverge. Fine for texture; it would not be fine for anything a player could be wrong
//      about, which is why the derived half above stays derived.
//   2. A SONGBIRD IS NOT IN THE BIRD-STRIKE PATH. `flockOnSegment` in birds.js is server-side and
//      reads positions; a simulated bird has none the server can see.
//   3. IT NEEDS AN EVICTION RULE, and has one — `sweep` in gl/murmur-gpu.js.
//   4. A RELOAD OR A HIDDEN TAB POPS THE CLOUD, because the integrator restarts from the seed.
//
// ── WHAT A REAL MURMURATION DOES, AND WHAT THAT MEANS HERE ──────────────────────────────────────
//
// Almost every number below is from the STARFLAG/COBBS group's 3-D reconstructions of starling flocks
// over Rome (Ballerini 2008, Cavagna 2010, Attanasi 2014-15, Bialek 2014), plus Hemelrijk's StarDisplay
// model and Storms 2019's 795 filmed escape events. Those flocks were chosen to be low and compact, so
// they describe the ordinary cloud rather than the vast high roost.
//
// ⚠ NEIGHBOURS ARE TOPOLOGICAL, NOT METRIC. Each bird attends to its six or seven nearest neighbours
// whatever the distance (Ballerini et al., PNAS 105:1232, 2008). A metric rule sheds stragglers as the
// flock stretches; a topological one has exactly K neighbours at any density.
//
// ⚠ THE FLOCK TRAVELS AS ONE BODY. Polarisation — how nearly every bird points the same way — is 0.96 ±
// 0.03 over 24 real flocks (Cavagna et al., PNAS 107:11865, 2010), with the centre moving at 10-12 m/s.
// This file used to hold every bird to a fixed STATION on the path its centre had just flown, with the
// centre looping a one-tile circle at about 1 m/s: twelve-metre-a-second birds orbiting a point that
// barely moved is milling, which is the one thing the 0.96 says a murmuration does not do. There are no
// stations now. The centre sweeps the roost at the birds' own speed (the `wander` circuit in birds.js)
// and every bird flies the course the centre flew.
//
// ⚠ AND IT TURNS BY RELAY, AT EQUAL RADIUS. A turn starts with a few birds at a side edge and crosses
// the flock as a front at 20-40 m/s — 400 birds crossed in a little over half a second — without
// noticeably damping (Attanasi et al., Nature Physics 10:691, 2014). Every bird turns on the same radius, so the flock
// keeps its orientation in the world while its heading swings and birds that were at the side end up at
// the front (Attanasi 2015). Both fall out of one rule: bird i steers by the centre's course as it was
// `delay_i` ago, and delay_i is its distance from the edge the turn started at over the relay speed.
// Nothing about it needs neighbour-to-neighbour state, so it is exact and identical in every step.
//
// ⚠ THE BODY IS FLAT AND BROADSIDE. Real flocks are 1 : 2.8 : 5.6 (thickness : width : length), the
// thin axis vertical, and in straight flight the LONG axis is across the direction of travel, 60-90°
// from it (Attanasi et al., J R Soc Interface 12:20150319, 2015). The ribbon this replaced put the long
// axis along the path, the one orientation the data argue against. The body is held in an ellipsoid of
// those proportions: free inside, pushed back at the rim. The push ramps in over the outer band, which is
// also what makes the edge denser than the middle — a finding in all ten of Ballerini's flocks, and what
// StarDisplay produces by making peripheral birds cohere harder. The ellipsoid keeps its world
// orientation through a turn and relaxes back to broadside after it, and its plane banks into the turn.
//
// ⚠ AND THE DARK BANDS ARE WINGS, NOT DENSITY. A bird banked toward you shows its whole wing; one banked
// away shows its edge (Hemelrijk, van Zuidam & Hildenbrandt, Behav Ecol Sociobiol 69:755, 2015 — replace
// the birds with spheres and the wave disappears). So a bird's bank is its real turn, g·tan φ = v·ω, and
// the draw shades each bird by how much wing it shows the camera. A turn front then darkens or lightens
// as it crosses, with nothing painted on.
//
// ⚠ BANDS THAT TRAVEL ARE A RESPONSE TO A HAWK. Every source ties pulse trains to an attack (Procaccini
// et al., Anim Behav 82:759, 2011; Storms et al., Behav Ecol Sociobiol 73:10, 2019): a wave event is 1-6
// pulses (mean 2.9), 0.86 s apart, each travelling away from the predator at 13.4 m/s with its bank
// shrinking at every relay. That is `agitation` below. The constant rolling bands this file used to lay
// on every flock, every 0.75 s, are gone: no undisturbed flock does that.

import { BIRD_M_PER_TILE } from '../../../shared/birds.js';

export const K_NEIGHBOURS = 7;   // Ballerini: six or seven, whatever the density
const DT_MAX = 0.05;             // s. A stalled tab must not hand the integrator a second of travel.

// ⚠ THE TILE SCALE IS birds.js's BIRD_M_PER_TILE (a storey is 0.196 tiles = 3.5 m, so 17.9 m), and
// every metric figure below derives from it. It was 11 m here, stated separately, until 2026-09-29.
const TILE_PER_M = 1 / BIRD_M_PER_TILE;
const G_TILES = 9.81 * TILE_PER_M;

// ⚠ HOW FAR APART TWO BIRDS FLY, as measured on the GPU flock the envelope below produces (median nearest
// neighbour, __glMurmurParity). Something outside this file needs it: a cloud whose birds are closer
// together on screen than a pixel cannot show how many of it there are, so this decides the distance
// past which drawing more of them buys nothing. Real flocks: 0.68-1.51 m (Ballerini 2008).
export const MURMUR_NND_TILES = 0.82 * TILE_PER_M;

// ── THE HAWK'S PULSE TRAIN ──────────────────────────────────────────────────────────────────────
const WAVE_SPEED = 13.4 * TILE_PER_M;   // 13.4 m/s, measured (Procaccini 2011)
const WAVE_WIDTH = 3.85 * TILE_PER_M;   // how wide one dark band is, 3.85 m
const WAVE_LIFE = 2.6;           // s before one pulse has damped to nothing
const PULSE_GAP = 0.86;          // s between pulses (Storms 2019: 0.86 ± 0.44)
const PULSE_DECAY = 0.72;        // each relay banks less than the last (Hemelrijk 2019)
export const PULSE_MAX = 5;
// How many pulses a wave event has, off a hash of the stoop's own time so every machine agrees:
// 1-5, mean 3.1 against Storms's 2.88 (range 1-6; the sixth is dropped so an event is over in six seconds).
const PULSE_COUNTS = [1, 2, 2, 3, 3, 3, 3, 4, 5, 5];
// ⚠ A HOLE IN THE FLOCK IS NOT WHAT EVERY ATTACK DOES. Flash expansion followed 25% of attacks, within
// five seconds, and 83% of flash expansions came straight after one (Storms 2019). The pulse train goes
// with every stoop; the hole with one in four, off the same hash. A caller may force it with `ev.flash`.
const FLASH_EXPAND_P = 0.25;

// How long a bird takes to fade out of a thinned flock, or back into it.
const SHOW_FADE_S = 0.6;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

/** Deterministic unit-ish scatter, so a cloud seeds in the same shape every time. */
const frac = (n) => { const x = Math.sin(n) * 43758.5453; return x - Math.floor(x); };

// ── THE BODY ────────────────────────────────────────────────────────────────────────────────────
//
// The ellipsoid's semi-axes, in units of the record's `spread` (0.35 x cbrt(n / 20) x murmurPack in
// the game, in metres through TILE_PER_M). At the shipping pack of 0.5 that makes 1,000 birds a rim
// about 55 x 19 x 11 m across.
// ⚠ THE RIM IS NOT 1 : 2.8 : 5.6, AND THE BODY INSIDE IT IS. Birds fill the rim unevenly — more of its width
// along the course, less of its depth — so these were set by measuring the body the birds actually make:
// 1 : 2.8 : 5.1 at 0.82 m apart on the game's own path (__glMurmurParity), against Ballerini's 1 : 2.8 : 5.6.
const ENV_L = 3.90, ENV_W = 1.35, ENV_T = 0.75;
// The outer share of the ellipsoid where the push back in ramps up: inside ENV_IN a bird is free.
const ENV_IN = 0.78;
// How long the body takes to swing back to broadside after a turn. Nothing measures it. At 6 s the
// body never got there: the roost path turns at about 0.3 rad/s, so the axis lagged the course by most of
// a right angle. At 1 s it is broadside in a straight (87-88°) and swung by a turn while it lasts.
const ENV_TAU = 1.0;
// How far the body's plane banks into a turn, as a share of what one bird in that turn would bank.
const BANK_SHARE = 0.5;

// ── THE RELAY ───────────────────────────────────────────────────────────────────────────────────
//
// The course a bird steers by is the centre's own, some time ago. CMD_N samples CMD_DT apart hold the
// last 2.3 s of it; RELAY_SPEED is how fast a turn crosses the flock (30 m/s, the middle of the 20-40 m/s
// Attanasi 2014 measured over twelve turns; it was 17 until 2026-09-23, from assuming a metre between
// neighbours over a 60 ms hop). A flock too wide to cross in the history relays faster instead, so the
// far edge is never left flying a course older than the table holds.
export const CMD_N = 24;
const CMD_DT = 0.1;
const RELAY_SPEED = 30 * TILE_PER_M;
// How firmly a turn has to be under way before one side counts as its inside, in rad/s.
const TURN_SIDE = 0.08;
const HIST_KEEP_MS = (CMD_N * CMD_DT + 1.0) * 1000;

/** The body's semi-axes for a cloud of this spread, in tiles. */
export function murmurEnvelope(spread) {
  return { aL: ENV_L * spread, aW: ENV_W * spread, aT: ENV_T * spread };
}

// A bird's rank, 0..1: its place in the thinning order and in the landing and take-off order (waveTurn).
// The ranks of any n birds are the same n numbers whatever order the birds are stored in.
export const rankOf = (i) => (i * 0.7548776662466927) % 1;

// ⚠ WHEN EACH BIRD GOES DOWN OR UP, OFF ITS RANK. Ranks are spread evenly, so the share of a flock ranked
// under r is r. A big flock pours down and lifts off in WAVE_GROUPS waves with a little jitter. A party
// (`trickle`) goes one bird at a time instead, the first few close together and a few stragglers last
// (rank to the power TRICKLE_POW): four tidy waves of seven starlings read as squads, not as a party
// dropping onto a lawn. The step shader's copy (gl/murmur-gpu.js) is generated from these numbers, and
// windshield.js counts the birds already down off this function for the weight on a wire.
export const WAVE_GROUPS = 4, WAVE_JITTER = 0.15, TRICKLE_POW = 1.6;
export function waveTurn(r, spread, trickle) {
  if (trickle) return Math.pow(r, TRICKLE_POW) * spread;
  return (Math.floor(r * WAVE_GROUPS) / WAVE_GROUPS * (1 - WAVE_JITTER) + ((r * 7.13) % 1) * WAVE_JITTER) * spread;
}

// ⚠ THE CLOUD'S FIRST ARRANGEMENT, AS A PURE FUNCTION: the body's own ellipsoid, broadside to the course
// it starts on. The GPU flock starts from exactly these birds.
export function seedPoints(key, n, cx, cy, cz, spread, heading = 0) {
  // One number per flock, so two clouds in one sky do not do anything in step.
  let sd = 0;
  for (let i = 0; i < key.length; i++) sd = (sd * 31 + key.charCodeAt(i)) % 100000;
  const E = murmurEnvelope(spread);
  const lx = -Math.sin(heading), ly = Math.cos(heading);      // the long axis, across the course
  const pts = [];
  for (let i = 0; i < n; i++) {
    const [a, b, c] = scatterOf(i);
    const L = a * E.aL * ENV_IN, W = b * E.aW * ENV_IN;
    pts.push({
      x: cx + lx * L + ly * W,
      y: cy + ly * L - lx * W,
      z: cz + c * E.aT * ENV_IN,
      // ⚠ A GOLDEN-RATIO-FAMILY SEQUENCE RATHER THAN A HASH, because what matters for thinning is that
      // every PREFIX of the order is spread evenly through the flock; a hash clumps at any threshold, and
      // a clump is a hole in the cloud rather than a thinner cloud. The plastic number, because scatterOf
      // already spends the golden ratio's neighbourhood on position.
      rank: rankOf(i),
    });
  }
  // ⚠ IN SPACE ORDER, SO BIRDS THAT ARE NEAR EACH OTHER ARE NEAR EACH OTHER IN MEMORY. The GPU step reads
  // every neighbour's state by index; in scatter order those reads land all over a texture several
  // megabytes big and miss the cache on nearly every one. A murmuration keeps its neighbours for a long
  // time, so sorting once at the seed holds: measured at 300,000 birds the step went 27 to 15.6 ms and
  // was still 14.1 after 300 frames. A bird's rank travels with it, so thinning is unaffected.
  mortonSort(pts);
  return { pts, sd };
}

function mortonSort(pts) {
  if (pts.length < 2) return;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  const q = (v, lo, hi) => Math.min(1023, Math.floor(((v - lo) / Math.max(1e-9, hi - lo)) * 1024));
  const spread3 = (v) => { v = (v | (v << 16)) & 0x30000FF; v = (v | (v << 8)) & 0x300F00F; v = (v | (v << 4)) & 0x30C30C3; return (v | (v << 2)) & 0x9249249; };
  const keys = new Float64Array(pts.length), order = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    keys[i] = spread3(q(p.x, x0, x1)) + spread3(q(p.y, y0, y1)) * 2 + spread3(q(p.z, z0, z1)) * 4;
    order[i] = i;
  }
  order.sort((a, b) => keys[a] - keys[b] || a - b);
  const copy = pts.slice();
  for (let i = 0; i < pts.length; i++) pts[i] = copy[order[i]];
}

// ⚠ WHERE BIRD i IS PLACED, AS A UNIT OFFSET IN THE BODY'S OWN FRAME (long, wide, thick), when it first
// appears and when it fades back in after thinning. Uniform over a disc in plan, thin vertically.
export function scatterOf(i) {
  const a = frac(i * 12.9898 + 1.3) * Math.PI * 2, r = Math.sqrt(frac(i * 78.233 + 4.1));
  return [Math.cos(a) * r, Math.sin(a) * r, (frac(i * 5.77 + 9.1) - 0.5) * 2 * Math.sqrt(Math.max(0, 1 - r * r))];
}

// ── THE HAWK ────────────────────────────────────────────────────────────────────────────────────

/** The pulses a stoop sets off, and whether it opens a hole. Pure: every machine gets the same. */
function stoopEvent(ev) {
  const h = frac(ev.at * 0.000137 + ev.x * 1.91 + ev.y * 7.03);
  const n = PULSE_COUNTS[Math.min(PULSE_COUNTS.length - 1, Math.floor(h * PULSE_COUNTS.length))];
  const flash = ev.flash ?? (frac(h * 91.7 + 0.31) < FLASH_EXPAND_P);
  return { n, flash };
}

/**
 * The live pulses of a stoop's wave event at `now`: each {x, y, front, amp}, or null when none is.
 * Each pulse leaves the stoop PULSE_GAP after the last, travels at the measured 13.4 m/s and damps by
 * angle — its amplitude, never its shape — as Hemelrijk found the real ones do.
 */
export function agitationWave(ev, now, maxRoll = 1.3) {
  if (!ev) return null;
  const { n } = stoopEvent(ev);
  const out = [];
  for (let k = 0; k < n; k++) {
    const age = (now - ev.at) / 1000 - k * PULSE_GAP;
    if (age < 0 || age > WAVE_LIFE) continue;
    const damp = 1 - age / WAVE_LIFE;
    out.push({ x: ev.x, y: ev.y, front: WAVE_SPEED * age, amp: maxRoll * Math.pow(PULSE_DECAY, k) * damp * damp });
  }
  return out.length ? out : null;
}

/**
 * The bank the hawk's pulse train puts on a bird at (bx, by), in radians; 0 with nothing going on.
 *
 * ⚠ IT IS A FUNCTION OF POSITION AND TIME AND NOTHING ELSE, which is what lets the most eye-catching
 * part of a murmuration stay exact while the cloud underneath drifts: two players watching the same hawk
 * see the same bands crossing two different clouds.
 */
export function agitation(bx, by, ev, now, maxRoll = 1.3) {
  const w = agitationWave(ev, now, maxRoll);
  if (!w) return 0;
  const d = Math.hypot(bx - ev.x, by - ev.y);
  let roll = 0;
  for (const p of w) {
    const u = (d - p.front) / WAVE_WIDTH;
    if (u > -3 && u < 3) roll += p.amp * Math.exp(-u * u);
  }
  return Math.min(maxRoll, roll);
}

// ── WHAT A FLOCK IS DOING THIS FRAME, BEFORE ANY BIRD IS ASKED ───────────────────────────────────
//
// ⚠ THE FLOCK'S MEMORY STAYS IN JAVASCRIPT. The recent course of the centre, the orientation of the body
// and whether a hawk is in it are worked out here, once a frame, and handed to the shader as uniforms.
//
// ⚠ THE COURSE IS REMEMBERED FROM THE CENTRE THE CALLER HANDS IN, NOT RE-DERIVED. The centre is a pure
// function of the clock in birds.js and could be asked for at any past time — but only the caller has
// the flock and the map that function needs, and every bench drives a centre of its own. What the caller
// hands in each frame IS the course; this keeps the last few seconds of it.
//
// ⚠ IT ADVANCES THE CLOCK AND THEN RECORDS, and only when the clock moved. A dt of 0 returns before
// anything is touched, so painting the same instant twice changes nothing.
export function flockFrame(c, cx, cy, cz, now, spread, opts = {}) {
  const dt = c.last == null ? 0 : clamp((now - c.last) / 1000, 0, DT_MAX);
  if (!c.hist) c.hist = [];
  const H = c.hist;
  if (c.last == null || now > c.last) {
    H.push({ t: now, x: cx, y: cy, z: cz });
    while (H.length > 2 && now - H[1].t > HIST_KEEP_MS) H.shift();
  }
  c.last = now;
  if (!dt) return { dt };

  // The centre at time T, interpolated from the history; past the oldest entry it is extrapolated from
  // the oldest velocity, so a new cloud does not read a standing start into its own past.
  const at = (T) => {
    if (H.length < 2) return null;
    if (T <= H[0].t) {
      const a = H[0], b = H[1], s = (b.t - a.t) || 1, k = (T - a.t) / s;
      return [a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k];
    }
    for (let i = H.length - 1; i > 0; i--) {
      const a = H[i - 1], b = H[i];
      if (T >= a.t) { const k = (T - a.t) / ((b.t - a.t) || 1); return [a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k]; }
    }
    return [H[0].x, H[0].y, H[0].z];
  };
  // ⚠ THE CENTRE AT ANY TIME: the caller's `course` function when it has one — the shared model, which
  // can answer for a moment ahead as readily as a moment behind — and otherwise the history above.
  const pos = typeof opts.course === 'function' ? opts.course : at;
  const velAt = (T) => { const a = pos(T), b = pos(T - CMD_DT * 1000); return a && b ? [(a[0] - b[0]) / CMD_DT, (a[1] - b[1]) / CMD_DT, (a[2] - b[2]) / CMD_DT] : null; };
  const h0 = opts.heading ?? 0, s0 = MURMUR_RULES.speed;
  const vNow = velAt(now) || [Math.cos(h0) * s0, Math.sin(h0) * s0, 0];
  const vWas = velAt(now - 3 * CMD_DT * 1000) || vNow;

  // The course now, how fast it is turning, and which side is the inside of the turn.
  const v0 = Math.hypot(vNow[0], vNow[1]);
  const course = v0 > 1e-3 ? Math.atan2(vNow[1], vNow[0]) : (c.course ?? h0);
  c.course = course;
  const vb = Math.hypot(vWas[0], vWas[1]);
  const turn = v0 > 1e-3 && vb > 1e-3 ? angDiff(course, Math.atan2(vWas[1], vWas[0])) / (3 * CMD_DT) : 0;
  const side = Math.tanh(turn / TURN_SIDE);          // +1: turning left, so the left edge leads
  const latX = -Math.sin(course), latY = Math.cos(course);

  // ⚠ THE BODY'S LONG AXIS HOLDS ITS WORLD ORIENTATION AND RELAXES TO BROADSIDE, never turns with the
  // course. That IS equal-radius turning seen from outside. The long axis is an axis, so broadside is
  // whichever of course ± 90° is nearer.
  const want = course + Math.PI / 2;
  if (c.psi == null) c.psi = want;
  let d = angDiff(want, c.psi);
  if (d > Math.PI / 2) d -= Math.PI; else if (d < -Math.PI / 2) d += Math.PI;
  if (v0 > 0.2) c.psi += d * Math.min(1, dt / ENV_TAU);
  const E = murmurEnvelope(spread);
  // ⚠ THE PLANE BANKS INTO THE TURN: a left turn drops the left side. tan β, sheared into the height the
  // shader measures a bird against, so a bird on the left is at home lower down.
  const tanB = Math.tan(BANK_SHARE * Math.atan(v0 * turn / G_TILES));

  // How far across the flock a turn has to travel, and so how fast it must go to arrive in time.
  const cp = Math.cos(c.psi - course - Math.PI / 2), sp = Math.sin(c.psi - course - Math.PI / 2);
  const halfL = Math.abs(cp) * E.aL + Math.abs(sp) * E.aW;
  const cs = Math.max(RELAY_SPEED, (2 * halfL) / ((CMD_N - 1) * CMD_DT));

  // The course table: the centre's velocity at lags 0, CMD_DT, 2 CMD_DT, … counted back from `lead`.
  // ⚠ WITH THE FUTURE KNOWN, LEAD IS THE MEAN DELAY, so the bird in the middle of the relay steers by the
  // course NOW and the body sits on its centre; from history alone it is 0 and the body trails by it.
  const lead = typeof opts.course === 'function' ? halfL / cs : 0;
  const cmd = new Float32Array(CMD_N * 3);
  for (let k = 0; k < CMD_N; k++) {
    const v = velAt(now + (lead - k * CMD_DT) * 1000) || vNow, o = k * 3;
    cmd[o] = v[0]; cmd[o + 1] = v[1]; cmd[o + 2] = v[2];
  }

  let scare = null, scareDamp = 0;
  if (opts.scare && (now - opts.scare.at) >= 0 && (now - opts.scare.at) / 1000 < WAVE_LIFE && stoopEvent(opts.scare).flash) {
    scare = opts.scare; scareDamp = 1 - ((now - scare.at) / 1000) / WAVE_LIFE;
  }
  return {
    dt, cmd, cmdDt: CMD_DT, course, turn,
    env: { ...E, psi: c.psi, tanB }, relay: { latX, latY, halfL, cs, side },
    localSpread: spread, scare, scareDamp,
  };
}

// ⚠ THE RULE'S NUMBERS, IN ONE PLACE. gl/murmur-gpu.js interpolates these into its shader rather than
// retyping them.
//
// sepR, how close is too close: 1.32 m, smooth fall-off. StarDisplay's separation radii of
// 1.6-5.4 m gave nearest neighbours of 0.70-1.54 m (Hildenbrandt, Carere & Hemelrijk, Behav Ecol
// 21:1349, 2010); this sits at the dense end, where the low compact flocks are.
//
// speed, the cruise when the centre gives no course: 11 m/s, the median centre-of-mass speed over 21
// flocks (Bialek et al., PNAS 111:7212, 2014). In flight a bird's speed is the CENTRE's, which the wander
// circuit sweeps between about 7 and 15 m/s, clamped to what a starling flies (speedLo-speedHi), times a
// deviation of a few per cent that is shared by neighbours and changes slowly: speed is correlated
// across a real flock as widely as heading (Cavagna 2022), and slowing down comes easier than speeding
// up. The old fixed per-bird factor of 0.85-1.15 was too big and had the wrong structure.
//
// turnG, the bank limit: nobody has measured a starling's, so 3 g stands as the escape ceiling it was.
// It bounds how fast any bird may swing its direction, which is what a coordinated turn at 12 m/s is.
//
// blindCos: behind a bird is a blind sector of 2 x 45° that alignment and cohesion ignore and avoidance
// does not (StarDisplay), which is what gives real flocks their shortage of neighbours fore and aft.
//
// wCmd: how hard a bird holds the relayed course; wEnv, how hard the rim pushes back; catchK, how much a
// bird at the back of the body speeds up and one at the front eases off to keep it together.
// ⚠ WHERE EACH MURMURATION REALLY IS, against its shared centre: key -> { dx, dy, dz }. Written by the GPU
// flock's readback (gl/murmur-gpu.js, readSample) and read by windshield.js, which must not import GL code,
// so the hawk can dive at the birds rather than at the point the flock was derived round. Local to this
// client: the server has no birds to measure and never reads it.
export const MURMUR_MEASURED = new Map();

export const MURMUR_RULES = Object.freeze({
  wSep: 2.2, wAli: 1.6, wCoh: 0.55, wCmd: 4.0, wEnv: 3.2, wScare: 9.0,
  Z_SOFT: 0.2, SCARE_R: 12.65 * TILE_PER_M,
  // an aircraft: noticed at 60 m (a flock sees further than birdEvade's single bird at 40), pushing
  // birds within about 18 m of its line
  AC_DETECT: 60 * TILE_PER_M, AC_LANE: 18 * TILE_PER_M, TILE_PER_M, G_TILES, K: K_NEIGHBOURS, DT_MAX, SHOW_FADE_S,
  WAVE_SPEED, WAVE_WIDTH, WAVE_LIFE, PULSE_GAP, PULSE_DECAY, PULSE_MAX, ENV_IN, CMD_N,
  sepR: 1.32 * TILE_PER_M, speed: 11 * TILE_PER_M, speedLo: 6 * TILE_PER_M, speedHi: 16 * TILE_PER_M,
  speedDev: 0.035, turnG: 3.0, blindCos: -Math.SQRT1_2, catchK: 0.30, rollTau: 0.12, rollMax: 1.25,
});
