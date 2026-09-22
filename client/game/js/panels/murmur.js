// MURMUR — a starling cloud, simulated rather than derived.
//
// ⚠ THIS IS THE ONE PLACE IN THE FAUNA SYSTEM THAT KEEPS STATE, and the exception is deliberate
// and narrow. Everything else about a flock — which tiles hold one, when it is up, where its
// centre is, how many birds are in it — is a pure function of (anchor, wall clock) in
// client/shared/birds.js, because the server prints those same facts into the room description and
// the two surfaces must agree. None of that changes here. What is simulated is only the ARRANGEMENT
// of the birds inside a flock whose position the shared model still owns.
//
// The line is worth stating precisely, because it is what keeps the exception from spreading:
//
//   DERIVED, and identical on every machine   the flock's tile, its cycle, its centre, its
//                                             altitude, its heading, how many birds
//   SIMULATED, and local to this client       where each bird sits inside that cloud
//
// So a player reading the room and a player looking out of the windscreen still agree about
// whether there are birds over the park and roughly where. They no longer agree about the shape of
// the cloud, and nothing in the game asks them to.
//
// ⚠ FOUR THINGS THIS COSTS, all of them accepted on purpose rather than overlooked:
//   1. TWO PLAYERS SEE DIFFERENT CLOUDS. Two integrators that started at different moments never
//      reconverge. Fine for texture; it would not be fine for anything a player could be wrong
//      about, which is why the derived half above stays derived.
//   2. A SONGBIRD IS NOT IN THE BIRD-STRIKE PATH. `flockOnSegment` in birds.js is server-side and
//      reads positions; a simulated bird has none the server can see. A sparrow is not an airframe
//      hazard, so this is a real exclusion rather than a hole.
//   3. IT NEEDS AN EVICTION RULE, and has one — see `sweep` below. Somewhere to keep state needs
//      somewhere to throw it away, or a session walking across a city accumulates every cloud it
//      has ever seen.
//   4. A RELOAD OR A HIDDEN TAB POPS THE CLOUD, because the integrator restarts from the seed.
//      Unavoidable, and the seed is at least the derived centre, so it pops into the right place.
//
// ── WHAT THE RESEARCH ACTUALLY SAYS ─────────────────────────────────────────
//
// ⚠ NEIGHBOURS ARE TOPOLOGICAL, NOT METRIC, and this is the single finding that makes a cloud hold
// together. Ballerini et al. (PNAS 105, 1232, 2008) tracked real starling flocks and found each
// bird attends to its SIX OR SEVEN NEAREST NEIGHBOURS REGARDLESS OF DISTANCE — not to everything
// inside some radius. The consequence is the whole point: a metric rule loses cohesion the moment
// the flock stretches, because a thinned-out bird ends up with nobody in range and flies off alone.
// A topological rule has exactly K neighbours whatever the density, so the flock survives being
// pulled about. Getting this wrong is the difference between a murmuration and a diffusing cloud
// of dots, and it costs nothing extra to implement — it is a sort rather than a filter.
//
// ⚠ AND THE DARK BANDS ARE NOT BIRDS BUNCHING UP. The striking part of a murmuration under attack
// is a wave of darkness travelling through it, and Hemelrijk's group established that it is birds
// BANKING: a bird rolled on its side shows its whole wing area for a moment, so it darkens. The
// underlying move is a "zig" — roll over and back, half a zigzag — and one roll makes one band.
// It travels away from the predator at about 13.4 m/s, and it damps because the maximum bank angle
// falls rather than because fewer birds copy it.
//
// That is why the wave is NOT simulated here. Attanasi et al. (Nature Physics 10, 691, 2014)
// measured these turning waves propagating with a linear dispersion law and negligible
// attenuation — non-dispersive, which is to say a clean travelling wave. A clean travelling wave
// is a closed form: roll = amplitude(age) × pulse(distance − speed × age). So it needs no state,
// it is exact, and it will be identical on every machine even though the cloud under it is not.
// See `agitation` below. The predator is the hawk: `hawkStoop` in birds.js resolves one origin and
// one time per frame, and an origin and a time are the whole of what this needs from it.

export const K_NEIGHBOURS = 7;   // Ballerini: six or seven, whatever the density
// ⚠ WHO YOUR SEVEN NEIGHBOURS ARE CHANGES FAR MORE SLOWLY THAN WHERE THEY ARE, and finding them
// is 80% of this step -- measured 2.51 ms of 3.14 at 1,013 birds, against 0.36 for the forces and
// the integration put together. So the SET is re-scanned every few frames and the forces are
// applied every frame from the current positions. The motion stays fully smooth, nothing about the
// shape changes, and none of it touches `dt`, which is what makes this a better lever than
// integrating less often: that halves the forces too and runs into DT_MAX.
//
// ⚠ THE REFRESH IS STAGGERED PER BIRD, NOT PER FLOCK. Re-scanning everybody on the same frame
// puts the whole 2.5 ms back every Nth frame -- the average is lovely and the frame that pays it
// is the one that drops. `(frame + i) % NBR_REFRESH` spreads it so every frame re-scans the same
// small share.
// ⚠ 2 RATHER THAN 4, AND THE DIFFERENCE IS FIDELITY NOT TASTE. Staleness has a price: a bird
// whose nearest neighbour changed between scans does not separate from the newcomer, and the flock
// packs slightly tighter and flatter for it. Measured on the gate scene: proportions 1 : 3.1 : 5.3
// with no cache, 1 : 3.5 : 5.5 at every 2, 1 : 3.6 : 5.3 at every 4, against real starlings at
// 1 : 2.8 : 5.6. The MEAN spacing is untouched at every interval -- only the closest pair tightens.
// 2 buys 1.8x for the smaller drift; 4 buys 2.9x and is there if the frame ever needs it.
// ⚠ AND FLAT_Z CANNOT PAY IT BACK. Lowering it to 2.6 restores the flat ratio and costs the plan
// one instead (1 : 3.2 : 4.8) -- the two axes trade rather than both recovering.
const NBR_REFRESH = 2;
const DT_MAX = 0.05;             // s. A stalled tab must not hand the integrator a second of travel.
const IDLE_EVICT_MS = 4000;      // a cloud nobody has asked about for this long is dropped
const MAX_CLOUDS = 12;           // and a hard ceiling, because an eviction rule can be forgotten

// Tiles per second. 1 tile is about 11 m — derived from a bird whose wingspan is known, see the
// note in windshield.js — so these are real speeds rather than chosen ones.
// ⚠ ONE STATEMENT OF THE TILE SCALE, because three numbers in this file are quoted in metres and
// were each converting privately. A starling in a murmuration is measured at 12 m/s and that is
// 1.09 tiles/s here, so a tile is 11.0 m and every metric figure below derives from this.
const TILE_PER_M = 1.09 / 12;
const WAVE_SPEED = 1.21;         // 13.4 m/s, measured (Hemelrijk)
const WAVE_WIDTH = 0.35;         // how wide the dark band is, in tiles
const WAVE_LIFE = 2.6;           // s before a pulse has damped to nothing

// How long a bird takes to fade out of a thinned flock, or back into it. Long enough that no
// single frame shows a step in opacity; short enough that the simulation saving arrives while
// the load that asked for it is still happening.
const SHOW_FADE_S = 0.6;

const clouds = new Map();

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Deterministic unit-ish scatter, so a cloud seeds in the same shape it would have grown into. */
const frac = (n) => { const x = Math.sin(n) * 43758.5453; return x - Math.floor(x); };

// ── THE FLOCK OWN WAKE ────────────────────────────────────────────────────────
//
// ⚠ A POINT ATTRACTOR CAN ONLY EVER MAKE A BALL, AND THAT IS WHAT THIS WAS. `wHome` is 4.5 --
// far and away the strongest of the four weights -- and it pulled every bird toward the single
// derived centre, so the equilibrium shape is a sphere that travels. Measured over 600 frames with
// the centre moving, the cloud settled at 1.0-1.8x elongation. A real murmuration is a ribbon: a
// dense head with a long tail strung out behind it, rolling as the head turns.
//
// ⚠ SO THE ATTRACTOR IS A CURVE -- THE PATH THE FLOCK HAS JUST FLOWN. Each bird holds a fixed
// STATION along that path, and the shape follows for free: the head is where the centre is now,
// the tail is where it was, and when the head turns the tail keeps the old line and the whole
// thing rolls over. Nothing here steers; the shape is a consequence of the centre having a past.
//
// ⚠ STATIONS ARE FIXED PER BIRD, NOT NEAREST-POINT. Pulling each bird to the closest point on
// the path is the obvious version and it collapses: birds bunch wherever the curve doubles back,
// and a flock that turns tightly folds into a knot. A station is stable, so a bird keeps its place
// in the ribbon and the formation survives a turn.
//
// ⚠ AND THEY ARE BIASED TOWARD THE HEAD (`TRAIL_BIAS`), because a murmuration is not a uniform
// tube. Spread evenly the flock reads as a sausage; a power over the station crowds most of the
// birds into the leading third and thins the tail, which is the shape in the photographs.
const TRAIL_STEP = 0.30;     // tiles the centre must travel before the path records another point
const TRAIL_MAX  = 26;       // points kept -- TRAIL_STEP x this is how long the ribbon can get
const TRAIL_BIAS = 1.9;      // above 1 crowds the birds toward the head
const TRAIL_SAMP = 64;       // evenly-spaced samples along the path, rebuilt once a frame
// ⚠ A STARLING FLOCK IS A PANCAKE, AND THAT IS WHERE ITS FAMOUS PROPORTION COMES FROM.
// Ballerini et al. measured the three principal axes of real flocks at an average of 1 : 2.8 : 5.6,
// stable across flocks of wildly different size -- and the SHORT axis is parallel to gravity and
// orthogonal to the velocity. So the big number is vertical FLATTENING, not length: in plan a real
// flock is only about 2:1. Ours was 1 : 1.3 : 7.0 -- barely flattened at all and stretched more
// than twice as far as it should be, which is a tube rather than a flock and reads as a smear.
//
// ⚠ SO THE VERTICAL PULL IS STIFFER THAN THE HORIZONTAL ONE. Flocks slide parallel to the ground
// because birds hold an altitude; nothing else in these four rules expresses that, and an isotropic
// attractor cannot produce an anisotropic shape however it is weighted.
const FLAT_Z   = 3.0;      // how much harder the home pull works vertically than horizontally
// ⚠ AND THE FLOCK IS KEPT FLAT BY DAMPING VERTICAL WANDER, NOT BY PULLING HARDER. The bank limit
// bounds how fast a bird may turn AT ALL, so the vertical stiffness FLAT_Z asserts can no longer
// simply be spent -- a clamped bird has one turn budget and the pancake was being paid for out of
// it. Measured, the limit on its own took the flat ratio to 1.61 against the 2.5-4 the gate wants.
//
// ⚠ AND THE TWO OBVIOUS REPAIRS BOTH FAIL, WHICH IS WHY THIS IS THE THIRD. Raising FLAT_Z spends
// MORE of that one budget on the vertical and starves station-keeping: it took the cloud 0.40
// tiles off the centre the shared model named, and raising the home pull to recover that made each
// bird chase its own station instead of its neighbours, so heading agreement fell to 1.50x chance
// against the 2 that separates banding from flicker -- a chain of compensations, each fixing the
// last one's damage. Letting the vertical turn faster than the horizontal is the other, and it
// works by giving the acceleration back: at the ratio that passed the gate the flock was up to
// 8.8 g again, against the 15.0 this whole change exists to remove.
//
// So the vertical is made CALM rather than STIFF. Separation, alignment and cohesion are what puff
// a flat cloud back into a ball, and scaling only their vertical component holds the flock thin
// while COSTING turn budget rather than spending it -- flat 2.5-4 and cohesion both hold with the
// four weights and FLAT_Z exactly as they shipped, and nothing over 3.0 g.
const Z_SOFT = 0.2;        // how much of the three local rules acts vertically
const SCARE_R    = 1.15;     // tiles -- how wide a hole a stoop opens

// Resample the path at even arc length, so a station means the same thing whatever spacing the
// centre happened to lay its points down at. Returns null when there is not enough path yet, which
// is what makes a newly seeded flock behave exactly as it did before any of this existed.
// Where the MEAN bird sits along the path, for a given station bias. Stations are u = v^BIAS with
// v uniform, so the share of birds inside station x is x^(1/BIAS) -- which is all that is needed to
// weight the samples without walking the flock.
function trailMid(samp) {
  let wx = 0, wy = 0, wz = 0, tot = 0;
  for (let k = 0; k < TRAIL_SAMP; k++) {
    const a = k / (TRAIL_SAMP - 1), b = (k + 1) / (TRAIL_SAMP - 1);
    const w = Math.pow(Math.min(1, b), 1 / TRAIL_BIAS) - Math.pow(a, 1 / TRAIL_BIAS);
    wx += samp[k].x * w; wy += samp[k].y * w; wz += samp[k].z * w; tot += w;
  }
  return tot > 0 ? { x: wx / tot, y: wy / tot, z: wz / tot } : samp[0];
}

function trailSamples(trail) {
  if (!trail || trail.length < 2) return null;
  let total = 0;
  const seg = [];
  for (let i = trail.length - 1; i > 0; i--) {
    const a = trail[i], b = trail[i - 1];
    const L = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    seg.push({ a, b, L }); total += L;
  }
  if (!(total > 1e-3)) return null;
  const out = new Array(TRAIL_SAMP);
  let si = 0, acc = 0;
  for (let k = 0; k < TRAIL_SAMP; k++) {
    const want = (k / (TRAIL_SAMP - 1)) * total;
    while (si < seg.length - 1 && acc + seg[si].L < want) { acc += seg[si].L; si++; }
    const f = seg[si].L > 1e-6 ? clamp((want - acc) / seg[si].L, 0, 1) : 0;
    out[k] = { x: seg[si].a.x + (seg[si].b.x - seg[si].a.x) * f,
               y: seg[si].a.y + (seg[si].b.y - seg[si].a.y) * f,
               z: seg[si].a.z + (seg[si].b.z - seg[si].a.z) * f };
  }
  return out;
}
function seed(key, n, cx, cy, cz, spread) {
  // One number per flock, so two clouds in one sky do not band in step.
  let sd = 0;
  for (let i = 0; i < key.length; i++) sd = (sd * 31 + key.charCodeAt(i)) % 100000;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = frac(i * 12.9898 + 1.3) * Math.PI * 2;
    const r = Math.sqrt(frac(i * 78.233 + 4.1)) * spread;
    pts.push({
      x: cx + Math.cos(a) * r,
      y: cy + Math.sin(a) * r,
      z: cz + (frac(i * 5.77 + 9.1) - 0.5) * spread * (0.6 / FLAT_Z),
      vx: 0, vy: 0, vz: 0,
      // Its fixed place along the flock path. Rolled ONCE: a station is a property of the bird,
      // and recomputing a pow per bird per frame showed up as 1.5 ms on a 1200-bird cloud.
      st: Math.pow(frac(i * 0.61803 + 0.137), TRAIL_BIAS),
      // ⚠ A Math.sin PER BIRD PER FRAME, FOR A NUMBER THAT ONLY DEPENDS ON i. `frac` is a sine,
      // and the airspeed jitter was being re-derived seventeen hundred times a frame to produce the
      // same seventeen hundred constants. Rolled once here, exactly as `st` above is.
      wk: 0.85 + 0.3 * frac(i * 3.1 + 7.7),
      roll: 0,
      // Fully present, and its place in the order birds are given up in. See the thinning note.
      // ⚠ A GOLDEN-RATIO SEQUENCE RATHER THAN A HASH, because what matters is not that the rank
      // is unpredictable but that every PREFIX of it is spread evenly through the flock. A hash
      // clumps at any threshold, and a clump is a hole in the cloud rather than a thinner cloud.
      vis: 1,
      // ⚠ AND IT IS THE PLASTIC NUMBER, NOT THE GOLDEN RATIO, BECAUSE `st` ABOVE IS ALREADY THE
      // GOLDEN ONE. Two low-discrepancy sequences over the same index with the same irrational are
      // the SAME SEQUENCE shifted, so a rank built that way is a near-function of a bird's station
      // along the ribbon — and thinning by it then takes out stretches of the flock rather than a
      // scatter through it. Measured over the octants of a real cloud: 20% off the expected share
      // in the worst eighth with the golden ratio against 17% with this, where 17% is about what
      // the binomial noise at seventy-odd birds an octant comes to on its own.
      rank: (i * 0.7548776662466927) % 1,
    });
  }
  const c = { pts, last: null, seen: 0, trail: [], nbr: null, nbrN: null, frame: 0, sd };
  clouds.set(key, c);
  return c;
}

// ── THE ROLLING BANDS ───────────────────────────────────
//
// ⚠ A MURMURATION BANDS WHEN NOTHING IS HUNTING IT, AND OURS COULD NOT. `agitation` below is a
// wave and it is the RIGHT wave -- it is just the PREDATOR's, so it fires only during a stoop,
// lives 2.6s, and happens to almost no flock on almost no evening. Measured in pixels against a
// Poisson speckle floor, a stooped flock banded 0.46 and an ordinary one 0.33, and both readings
// were the flock's own lens-shaped envelope rather than stripes: cropped and zoomed, every bird
// was the same darkness. The one most recognisable thing about a murmuration was missing.
//
// ⚠ SO THE WAVES ARE CONTINUOUS, AND THERE ARE SEVERAL AT ONCE. That is what a real flock does:
// a bird turns, its neighbours copy within a few tens of milliseconds, and the turn crosses the
// mass as a front. They are born on the RIM rather than in the middle, because that is where one
// starts -- something startles an edge bird -- and BAND_N of them overlap, so the flock carries
// more than one stripe and they cross each other rather than pulsing in unison.
//
// ⚠ AND IT IS A CLOSED FORM, LIKE `agitation` AND FOR THE SAME REASONS. A pure function of
// position and time: no state to keep, nothing to rebuild when the cloud is recentred or evicted,
// and the server can derive the same bands the renderer is drawing without anything crossing the
// wire. The wave index comes off the clock and its origin off a hash of that index, so two
// machines watching one flock see one set of bands.
//
// ⚠ THE SIGN IS HASHED, NOT ALTERNATED BY POSITION IN THE LOOP. `bank` is |sin(roll)| so the sign
// does not reach the flash at all -- but it does reach the drawn bird, and indexing the alternation
// off the loop counter would flip a given wave's roll every BAND_EVERY seconds as the window
// slides, which is a whole flock snapping over mid-sweep.
const BAND_EVERY = 0.75;         // s between one wave and the next
const BAND_N     = 2;            // how many are crossing the flock at once
const BAND_LIFE  = 2.6;          // s before a wave has damped out -- one crossing at WAVE_SPEED
const BAND_WIDTH = 0.42;         // tiles -- how thick the stripe is
const BAND_ROLL  = 1.35;         // rad at the crest

// ⚠ THE WAVE TABLE IS A PROPERTY OF THE FRAME AND WAS BEING REBUILT PER BIRD. `th` comes off a
// hash of the wave index, and the front position and the damping come off its age -- none of the
// three has anything to do with which bird is asking. Evaluated per bird it cost a `frac` (which is
// a Math.sin), a Math.cos and a Math.sin PER WAVE PER BIRD: six transcendentals a bird a frame, all
// of them recomputing the same two numbers seventeen hundred times.
//
// ⚠ AND THERE IS STILL ONLY ONE IMPLEMENTATION OF THE ARITHMETIC. The obvious way to make this
// fast is a second copy inlined into the step, which is how the renderer and the gate end up
// disagreeing about where a band is. `bandWaves` builds the table, `bandAt` evaluates it, and
// `bandRoll` is those two called together -- so the gate and the hot loop run the same expression.
const BAND_SLOTS = 4;            // c, s, front, amp
const BAND_SCRATCH = new Float64Array(BAND_N * BAND_SLOTS);

/** Fill `out` with the waves alive at `now`; returns how many. */
export function bandWaves(r, sd, now, out) {
  const t = now / 1000;
  const k0 = Math.floor(t / BAND_EVERY);
  let n = 0;
  for (let i = 0; i < BAND_N; i++) {
    const k = k0 - i;
    const age = t - k * BAND_EVERY;
    if (age < 0 || age > BAND_LIFE) continue;
    const th = frac(sd * 0.7351 + k * 0.3179) * Math.PI * 2;
    const damp = 1 - age / BAND_LIFE;
    const o = n * BAND_SLOTS;
    out[o] = Math.cos(th); out[o + 1] = Math.sin(th);
    out[o + 2] = -r + WAVE_SPEED * age;
    out[o + 3] = BAND_ROLL * damp * damp;
    n++;
  }
  return n;
}

/** The bank at one point, given a table `bandWaves` already built. */
export function bandAt(out, n, bx, by, cx, cy) {
  let acc = 0;
  const ux = bx - cx, uy = by - cy;
  for (let i = 0; i < n; i++) {
    const o = i * BAND_SLOTS;
    const u = (ux * out[o] + uy * out[o + 1] - out[o + 2]) / BAND_WIDTH;
    if (u < -3 || u > 3) continue;
    acc += out[o + 3] * Math.exp(-u * u);
  }
  return acc;
}

/**
 * The bank this bird is carrying from the flock's own rolling waves, in radians.
 *
 * `r` is the flock's spread, which is where a wave is born; `sd` is a per-flock number so two
 * flocks in one sky do not band in step.
 */
export function bandRoll(bx, by, cx, cy, r, sd, now) {
  return bandAt(BAND_SCRATCH, bandWaves(r, sd, now, BAND_SCRATCH), bx, by, cx, cy);
}

/**
 * The agitation wave, as a closed form.
 *
 * `ev` is {x, y, at} — where the predator struck and when, in the same clock the caller is using.
 * Returns the bank angle this bird should be carrying, in radians, 0 when there is nothing going on.
 *
 * ⚠ IT IS A FUNCTION OF POSITION AND TIME AND NOTHING ELSE, which is what lets the one genuinely
 * eye-catching part of a murmuration stay exact while the cloud underneath drifts. Two players
 * watching the same hawk see the same wave crossing two different clouds.
 */
export function agitation(bx, by, ev, now, maxRoll = 1.3) {
  if (!ev) return 0;
  const age = (now - ev.at) / 1000;
  if (age < 0 || age > WAVE_LIFE) return 0;
  const d = Math.hypot(bx - ev.x, by - ev.y);
  // The band: a pulse centred on the wavefront, which travels outward at the measured speed.
  const front = WAVE_SPEED * age;
  const u = (d - front) / WAVE_WIDTH;
  if (u < -3 || u > 3) return 0;
  const band = Math.exp(-u * u);
  // ⚠ DAMPED BY ANGLE, NOT BY HOW MANY BIRDS JOIN IN. Hemelrijk and Costanzo found the pulse
  // weakens because the maximum bank falls as it travels, not because the copying tails off — so
  // the decay belongs on the amplitude and the shape of the band stays put.
  const damp = 1 - age / WAVE_LIFE;
  // The bird rolls one way and back: half a zigzag, which is what makes ONE band rather than two.
  return maxRoll * band * damp * damp;
}

/**
 * Advance one cloud and hand back where its birds are.
 *
 * The caller owns the flock: `cx, cy, cz` is the centre the shared model derived, `n` is the size
 * it derived, and this only decides the arrangement around it. `heading` is the direction the
 * derived flock is travelling, which the cloud leans into rather than computing for itself.
 */
// -- THE NEIGHBOUR SEARCH, ON A GRID, STILL EXACT --------------------------
//
// Selecting the K nearest instead of sorting all of them made this 7-17x faster and left it
// O(n2): every bird still LOOKS at every other bird, it just stopped sorting them. That is the
// wall, and past about six hundred birds it is the only thing in a murmuration that costs.
//
// ⚠ THE RULE IS TOPOLOGICAL AND A GRID IS METRIC, WHICH IS THE WHOLE DIFFICULTY. Ballerini and
// the comment in the loop below both say it: a starling tracks its seven nearest neighbours
// WHATEVER THE DISTANCE, so there is no radius to bin by -- in a sparse corner of the cloud the
// seventh-nearest may be far outside any cell you would have chosen. A fixed search radius answers
// a different question and quietly changes how the flock behaves where it is thin.
//
// So cells are searched in expanding SHELLS and the stop condition is a proof rather than a
// radius: once every cell within Chebyshev distance r has been visited, nothing unvisited can be
// nearer than r*h, so the moment the K-th best is inside r*h the answer cannot change. That makes
// this EXACTLY the brute-force result rather than an approximation of it, which is the claim the
// equivalence check pins and the reason it is worth writing this way.
//
// ⚠ AND THE TIE-BREAK HAD TO BECOME EXPLICIT. Brute force scans j in index order and inserts on
// a STRICT improvement, so equal distances resolve to the lower index by accident of the scan; a
// grid visits j in cell order and would resolve them the other way. Two birds exactly equidistant
// is rare in floating point and perfectly possible from a symmetric seed, and it is the one thing
// that would make the two paths disagree. Both break ties on the index now, which is what brute
// force was already doing.
const MAX_CELLS = 32768;
let _gCnt = null, _gStart = null, _gItem = null;

function buildGrid(px, py, pz, n) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const qx = px[i], qy = py[i], qz = pz[i];
    if (qx < x0) x0 = qx; if (qx > x1) x1 = qx;
    if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
    if (qz < z0) z0 = qz; if (qz > z1) z1 = qz;
  }
  const ex = Math.max(x1 - x0, 1e-4), ey = Math.max(y1 - y0, 1e-4), ez = Math.max(z1 - z0, 1e-4);
  // A cell holding well under a bird, so the shell walk reaches K in the first ring or two.
  //
  // ⚠ THE CELL SIZE IS A PURE SPEED KNOB AND CHANGES NO ANSWER, which is what makes it worth
  // sweeping rather than reasoning about. The shell walk stops on a PROOF -- once every cell within
  // Chebyshev distance r-1 has been visited, nothing unseen can be nearer than (r-1)*h -- and that
  // proof holds for any h at all. So the neighbours that come back are identical at every setting
  // and only the number of cells and candidates touched moves.
  //
  // ⚠ AND THE OLD VALUE WAS ON THE WRONG SIDE OF THE CURVE. 1.3 put a couple of birds in a cell,
  // on the reasoning that fewer cells means fewer to walk; measured, it is the CANDIDATES that cost,
  // because a fat cell hands the K-buffer a pile of birds that lose one compare and are dropped.
  // Swept over three runs each at 1,700 birds: 0.85 gives 2.01-2.15 ms and 1.3 gives 2.32-2.51, and
  // at 3,200 it is 3.94-4.02 against 4.68-5.09. Past about 1.6 it degrades quickly (4.69 ms at 2.5).
  // Below ~0.75 it flattens and then wanders, because the grid starts hitting MAX_CELLS and h is
  // grown back anyway.
  let h = Math.cbrt((ex * ey * ez) / Math.max(n, 1)) * 0.85;
  if (!(h > 1e-6)) h = 1e-3;
  let nx = 1, ny = 1, nz = 1, cells = 1;
  // ⚠ A CLOUD CAN BE LONG AND THIN, so the cell count is capped rather than trusted: a flock
  // strung along a circuit leg would otherwise ask for millions of empty cells.
  for (let g = 0; g < 12; g++) {
    nx = Math.max(1, Math.floor(ex / h) + 1);
    ny = Math.max(1, Math.floor(ey / h) + 1);
    nz = Math.max(1, Math.floor(ez / h) + 1);
    cells = nx * ny * nz;
    if (cells <= MAX_CELLS) break;
    h *= 1.7;
  }
  if (!_gCnt || _gCnt.length < cells + 1) { _gCnt = new Int32Array(cells + 1); _gStart = new Int32Array(cells + 1); }
  else { _gCnt.fill(0, 0, cells + 1); }
  if (!_gItem || _gItem.length < n) _gItem = new Int32Array(n);
  const cellOf = (i) => {
    const ix = Math.min(nx - 1, Math.max(0, (px[i] - x0) / h | 0));
    const iy = Math.min(ny - 1, Math.max(0, (py[i] - y0) / h | 0));
    const iz = Math.min(nz - 1, Math.max(0, (pz[i] - z0) / h | 0));
    return (iz * ny + iy) * nx + ix;
  };
  for (let i = 0; i < n; i++) _gCnt[cellOf(i)]++;
  let run = 0;
  for (let c = 0; c < cells; c++) { _gStart[c] = run; run += _gCnt[c]; }
  _gStart[cells] = run;
  for (let c = 0; c < cells; c++) _gCnt[c] = _gStart[c];
  for (let i = 0; i < n; i++) _gItem[_gCnt[cellOf(i)]++] = i;
  return { x0, y0, z0, h, nx, ny, nz, start: _gStart, item: _gItem };
}

export function murmur(key, n, cx, cy, cz, heading, now, opts = {}) {
  const spread = opts.spread ?? 0.5;
  let c = clouds.get(key);
  if (!c || c.pts.length !== n) c = seed(key, n, cx, cy, cz, spread);
  c.seen = now;

  const dt = c.last == null ? 0 : clamp((now - c.last) / 1000, 0, DT_MAX);
  c.last = now;
  const pts = c.pts;
  if (!dt) return pts;

  // ⚠ THE PATH IS RECORDED BY DISTANCE, NEVER BY TIME. A flock hovering over its roost would
  // otherwise fill the whole buffer with the same point, the resampler would find no length in it,
  // and the ribbon would collapse to the ball it replaced at exactly the moment it is most seen.

  // ⚠ A FLOCK NOBODY CAN SEE IS FROZEN, NOT SKIPPED, AND THE DIFFERENCE IS THE JUMP. Skipping
  // means the next real step gets a dt of however long you looked away, clamped at DT_MAX, while
  // the flock's CENTRE has kept moving the whole time -- the centre is pure arithmetic off the
  // cycle and does not care whether anyone drew it. The cloud would come back stale, a long way
  // behind where it belongs, and the home pull would haul a thousand birds across the sky at
  // cruising speed in front of whoever just turned round.
  //
  // ⚠ SO THE CLOUD IS CARRIED WITH ITS CENTRE INSTEAD. A murmuration is defined relative to that
  // centre, so translating every bird by the centre's own delta preserves the internal structure
  // exactly and puts it back in the right patch of sky for nothing. What is lost while frozen is
  // only the churn inside the cloud, which is the part nobody was looking at.
  //
  // ⚠ AND THE PATH IS STILL RECORDED, because the ribbon's shape comes from where the flock has
  // BEEN. Dropping the trail while frozen would hand back a ball for the next 26 points of travel
  // -- several seconds of a flock visibly pulling itself into shape as you look at it.
  const head = c.trail[c.trail.length - 1];
  if (!head || Math.hypot(cx - head.x, cy - head.y, cz - head.z) >= TRAIL_STEP) {
    c.trail.push({ x: cx, y: cy, z: cz });
    if (c.trail.length > TRAIL_MAX) c.trail.shift();
  }

  if (opts.frozen) {
    const ddx = cx - (c.fx ?? cx), ddy = cy - (c.fy ?? cy), ddz = cz - (c.fz ?? cz);
    if (ddx || ddy || ddz) {
      for (let i = 0; i < pts.length; i++) { const q = pts[i]; q.x += ddx; q.y += ddy; q.z += ddz; }
    }
    c.fx = cx; c.fy = cy; c.fz = cz;
    return pts;
  }
  c.fx = cx; c.fy = cy; c.fz = cz;
  const trailW = clamp(opts.trail ?? 0, 0, 1);
  const samp = trailW > 0 ? trailSamples(c.trail) : null;
  // ⚠ A RIBBON IS NARROW. `spread` sizes a BALL, and spent unchanged around every station it makes
  // a tube two spreads wide and the whole path long -- a sausage rather than a flock. The length
  // now comes from the path, so the local scatter has to give most of its radius back.
  // ⚠ THE PATH GIVES THE SHAPE AND THE DERIVED CENTRE STILL GIVES THE PLACE. Hung straight off the
  // path, the ribbon trails BEHIND the centre -- measured at 2.5 tiles of centroid drift against
  // 0.58 for the point attractor -- and that is not a matter of taste: the note on the home pull
  // calls it the bridge that keeps a simulated cloud honest about the one fact describe.js is also
  // stating to the player. So the whole ribbon is translated until its own centre of mass lands on
  // the tile the shared model named. Shape from the history, position from the model, neither
  // paying for the other.
  const localSpread = samp ? spread * (1 - trailW * 0.62) : spread;
  let offX = 0, offY = 0, offZ = 0;
  if (samp) { const m = trailMid(samp); offX = cx - m.x; offY = cy - m.y; offZ = cz - m.z; }

  // ── THINNING: FEWER BIRDS SIMULATED, WITHOUT ANY OF THEM BEING SEEN TO GO ────────────────────
  //
  // ⚠ THE BOIDS STEP IS THE ONE FAUNA COST NO BUDGET CAN SHED, which is why this exists. Every
  // other dial in the renderer gives back FACES — the detail controller in windshield.js can take a
  // bird from 55 faces to 3 — and the simulation underneath is paid in full whichever rung a bird
  // is drawn at. Measured, 1,700 birds is 1.93 ms a frame and 3,200 is 3.73: a floor the controller
  // cannot lower, and the one number that can push a machine into the 30 fps fallback with nothing
  // left to trade. `show` is the knob that makes it sheddable.
  //
  // ⚠ AND A BIRD MAY NOT SIMPLY STOP BEING THERE. The obvious implementation is to hand murmur() a
  // smaller `n`, and the guard at the top does exactly what it should with that — `c.pts.length !==
  // n` RESEEDS THE WHOLE CLOUD, so every surviving bird is teleported to a fresh scatter. That is
  // not a thinned flock, it is a new one, and at any size a player can see it happen.
  //
  // So the flock keeps its full length and its indices — the renderer still reads `cloud[i]` for
  // every i, which is the contract it was written against — and each bird carries a visibility it
  // fades over. Three separate things then have to be true, and the third is the one that is easy
  // to miss:
  //
  //   it leaves by fading      a bird ramps to transparent BEFORE it stops being simulated, so
  //                            nothing ever blinks out of a frame
  //   it arrives at its post   a bird coming back is put where its own station on the current path
  //                            already is, not where it was when it left, and fades UP from nothing
  //   it is not a ghost        a dormant bird holds a stale position, so it must be out of the
  //                            NEIGHBOUR SEARCH as well as out of the draw — otherwise live birds
  //                            separate from, align with and steer around birds that are not there
  //
  // ⚠ THE LAST ONE IS INVISIBLE AND WOULD BE THE REAL BUG. Nothing on screen would say that a
  // starling is avoiding a hole in the air, and the flock would simply move a little wrongly for
  // ever. It is why the live birds are PARTITIONED to the front of the array rather than filtered
  // at each of the four loops below: the grid, the scratch buffers and the neighbour cache are all
  // indexed densely from zero, so a partition leaves every one of them correct with no mapping to
  // keep in step.
  //
  // ⚠ AND A PARTITION INVALIDATES THE NEIGHBOUR CACHE, because that cache stores INDICES and a
  // partition is exactly a change of what lives at an index. Missing that would have every bird
  // steering by whoever happens to have been swapped into its old neighbour's slot — the same
  // ghost, arrived by the fix for it.
  //
  // ⚠ WHO GOES IS A LOW-DISCREPANCY SEQUENCE, NOT A RANDOM DRAW AND NOT THE TAIL. Dropping the
  // tail of the ribbon shortens the flock, which is a change of SHAPE and is the one thing about a
  // murmuration anybody would notice; a random draw clumps, so a flock loses a patch rather than
  // getting sparser. A golden-ratio rank makes every prefix an evenly spread subset, so what
  // changes is density and only density.
  const show = clamp(opts.show ?? 1, 0, 1);
  const fadeK = dt / Math.max(0.05, opts.showFade ?? SHOW_FADE_S);
  let liveN = c.liveN == null ? pts.length : c.liveN;
  if (show >= 1 && liveN === pts.length && c.thinned !== true) {
    // ⚠ THE UNTHINNED PATH IS A SEPARATE BRANCH ON PURPOSE, so `show: 1` is provably the flock that
    // shipped: no rank test, no fade arithmetic, no partition, no invalidation. The cost of the
    // feature when it is not in use is this one comparison.
    c.liveN = liveN = pts.length;
  } else {
    c.thinned = true;
    let moved = 0;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i];
      const want = q.rank < show;
      const was = q.vis > 0;
      q.vis = want ? Math.min(1, q.vis + fadeK) : Math.max(0, q.vis - fadeK);
      if (!was && q.vis > 0) {
        // Coming back: stand it where its station already is, so the fade-in happens in the right
        // patch of sky rather than flying in from wherever it was abandoned.
        if (samp) {
          const s = samp[Math.min(TRAIL_SAMP - 1, Math.floor(q.st * (TRAIL_SAMP - 1)))];
          q.x = cx + (s.x + offX - cx) * trailW; q.y = cy + (s.y + offY - cy) * trailW; q.z = cz + (s.z + offZ - cz) * trailW;
        } else { q.x = cx; q.y = cy; q.z = cz; }
        const a = frac(i * 12.9898 + 1.3) * Math.PI * 2, r = Math.sqrt(frac(i * 78.233 + 4.1)) * localSpread;
        q.x += Math.cos(a) * r; q.y += Math.sin(a) * r; q.z += (frac(i * 5.77 + 9.1) - 0.5) * localSpread * (0.6 / FLAT_Z);
        // ⚠ FLYING, NOT STATIONARY. A bird handed zero velocity is renormalised to cruise on its
        // first step in whatever direction the forces happen to point, which on a newcomer sitting
        // exactly on its own station is very nearly nothing — so it sets off at full speed in an
        // arbitrary direction. The flock's own heading is the only answer that cannot look wrong.
        const sp0 = (opts.speed ?? 1.09) * q.wk;
        q.vx = Math.cos(heading) * sp0; q.vy = Math.sin(heading) * sp0; q.vz = 0;
      }
      if ((q.vis > 0) !== was) moved++;
    }
    if (moved) {
      // Partition: everything still visible to the front, order within each half irrelevant.
      let a = 0, b = pts.length - 1;
      while (a <= b) {
        if (pts[a].vis > 0) { a++; continue; }
        if (pts[b].vis <= 0) { b--; continue; }
        const t = pts[a]; pts[a] = pts[b]; pts[b] = t; a++; b--;
      }
      liveN = a;
      c.liveN = liveN;
      if (c.nbrN) { c.nbrN.fill(0); c.frame = 0; }
    }
    liveN = c.liveN == null ? pts.length : c.liveN;
  }


  // ⚠ 0.15 RATHER THAN 0.09, AND IT IMPROVED THE SHAPE AS WELL AS THE SPACING. Ballerini puts a
  // starling’s nearest-neighbour distance at 0.7-1.5 m, comparable to its wingspan, and ours sat at
  // 0.54 -- tighter than real birds fly. 0.20 tiles is about 1.4 m, between what shipped and the
  // 2.2 m separation radius StarDisplay uses.
  //
  // ⚠ AND NOTHING DOMINATES -- THE MODEL TRADES SPACING AGAINST ELONGATION. Swept against the
  // measured 1 : 2.8 : 5.6 and an NND of 0.7-1.5 m: 0.09 gives 0.50 m and 1 : 3.5 : 5.5, 0.12 gives
  // 0.57 and 1 : 2.9 : 4.6, 0.15 gives 0.67 and 1 : 2.4 : 4.0, 0.20 gives 0.74 and 1 : 2.3 : 3.2.
  // Spacing and the flat ratio improve together as it rises and I3 falls away, so 0.15 is the point
  // where the spacing is honest and nothing else has left its band.
  //
  // ⚠ AND IT WAS EXPECTED TO COST THE PANCAKE, WHICH IS WHY IT WAS LEFT ALONE FOR SO LONG. An
  // earlier sweep had a bigger radius de-flattening the flock, so the plan was an anisotropic push
  // -- separation carrying the same vertical stiffness FLAT_Z asserts. Measured, that was not
  // needed and was worse: at 0.20 the isotropic push gives NND 0.81 m AND flat 2.55, against the
  // measured 2.8, where scaling the vertical share to 0.45 overshoots to 4.12. Both axes moved the
  // right way from one number, so the knob was not kept.
  const sepR = opts.sep ?? 0.15;         // how close is too close, in tiles
  // ⚠ AND IT MUST STAY ABOVE THE SPEED THE DERIVED CENTRE TRAVELS AT, which is a constraint on the
  // SPECIES ROW rather than on this number — see the circuit note on `songbird` in birds.js. A bird
  // that cannot keep up with its own station spends its whole velocity budget on the home term, and
  // since the vector is renormalised to this speed a few lines below, the three local rules then
  // contribute nothing anybody can see: the cloud goes rigid. Under about 0.6 of this it jostles.
  //
  // ⚠ IT IS THE MEASURED MURMURATION SPEED, NOT THE SPECIES' TOP SPEED, AND THOSE ARE DIFFERENT
  // NUMBERS BY A FACTOR OF TWO. A common starling in directed flight is quoted at 70-80 km/h, which
  // is what "how fast is a starling" answers and is a commuting bird on a straight line. INSIDE a
  // murmuration the same bird is turning constantly, and the STARFLAG group measured it: Ballerini
  // et al. (PNAS 105, 1232, 2008) and Cavagna et al. report a mean of about 12 m/s over the same
  // flocks the topological-neighbour finding above came out of. That is the number this simulates,
  // so it is the one to use — the flocks in this file are milling over a roost, never commuting.
  //
  // ⚠ AND IT CROSS-CHECKS AGAINST WAVE_SPEED. Hemelrijk's agitation wave travels at 13.4 m/s and is
  // measured OUTRUNNING the birds it passes through. At the 1.4 this shipped with, the birds flew at
  // 15.4 m/s and overtook their own panic wave, which is backwards. At 12 they do not.
  //
  // ⚠ AND IT MUST STAY ABOVE THE SPEED THE DERIVED CENTRE TRAVELS AT — see above.
  const speed = opts.speed ?? 1.09;      // cruising speed, tiles/s — 12 m/s, measured (Ballerini)
  // How hard a bird is allowed to turn, in g. See the bank limit at the renormalise below.
  const TURN_G = opts.turnG ?? 3.0;
  const wSep = 2.2, wAli = 0.85, wCoh = 0.55, wHome = 4.5, wScare = 9.0;
  // The stoop, if one is live. Absent, not one line below it costs anything.
  const scare = opts.scare && (now - opts.scare.at) >= 0
    && (now - opts.scare.at) / 1000 < WAVE_LIFE ? opts.scare : null;
  const scareDamp = scare ? 1 - ((now - scare.at) / 1000) / WAVE_LIFE : 0;
  const hx = Math.cos(heading), hy = Math.sin(heading);

  // ⚠ ONE PASS OVER A COPY. Integrating in place means the second bird already sees the first one's
  // new position, which quietly turns a symmetric rule into a sequential one — the flock then
  // drifts in list order, which looks like a current nobody put there.
  // ⚠ THE COPY IS REUSED RATHER THAN REALLOCATED, AND THE p90 IS WHY. This was `pts.map(p => ({…}))`
  // -- a fresh object per bird per frame, 1,013 of them on a real murmuration, which is a garbage
  // rate rather than a cost: caching the neighbour sets cut the fauna phase 9.04 -> 6.06 ms and left
  // the frame's p90 at 24.5, because the spikes were never the search. Six flat arrays on the cloud,
  // written in place, allocate nothing after the first frame.
  //
  // ⚠ Float64, NOT Float32. The point is to stop allocating, not to change the arithmetic: every
  // force below is computed from these, and dropping to single precision would move the flock a
  // little for no saving that matters at this size.
  if (!c.sx || c.sx.length !== pts.length) {
    c.sx = new Float64Array(pts.length); c.sy = new Float64Array(pts.length); c.sz = new Float64Array(pts.length);
    c.svx = new Float64Array(pts.length); c.svy = new Float64Array(pts.length); c.svz = new Float64Array(pts.length);
  }
  const sxA = c.sx, syA = c.sy, szA = c.sz, svxA = c.svx, svyA = c.svy, svzA = c.svz;
  // ⚠ LIVE BIRDS ONLY, AND THIS IS THE LINE THAT STOPS THE GHOSTS. A dormant bird's position is
  // wherever it was abandoned; copied in here it joins the grid, gets found by the neighbour search
  // and every live bird near it separates from, aligns with and steers around something that is not
  // in the sky. Nothing would look wrong — the flock would just move slightly incorrectly for ever.
  for (let i = 0; i < liveN; i++) {
    const q = pts[i];
    sxA[i] = q.x; syA[i] = q.y; szA[i] = q.z;
    svxA[i] = q.vx; svyA[i] = q.vy; svzA[i] = q.vz;
  }
  // ⚠ SMALL FLOCKS SKIP THE GRID. Binning, prefix-summing and walking shells is real work, and
  // under about eighty birds the plain scan is simply faster -- the grid exists for the case that
  // was impossible before it. Both paths pick the same seven neighbours, so this is a speed switch
  // and never a behaviour one, which is what the equivalence check is for.
  // ⚠ A RESEED INVALIDATES THE CACHE BY CONSTRUCTION, because seed() builds a fresh `c`. Sizing
  // the buffers off the live bird count here also means a flock that changes size cannot read a
  // stale index: the arrays are rebuilt and every bird is marked due.
  const K = K_NEIGHBOURS;
  if (!c.nbr || c.nbrN.length !== pts.length) {
    c.nbr = new Int32Array(pts.length * K);
    c.nbrN = new Int8Array(pts.length);          // 0 also means 'never scanned', which is what we want
    c.frame = 0;
  }
  c.frame++;
  const refresh = Math.max(1, opts.nbrRefresh ?? NBR_REFRESH);
  const grid = liveN >= (opts.gridFrom ?? 80) ? buildGrid(sxA, syA, szA, liveN) : null;
  // ⚠ THE K NEAREST, SELECTED RATHER THAN SORTED, INTO BUFFERS THAT ARE NEVER REALLOCATED.
  // This loop used to push {j, d2} for every pair and then sort the whole lot to take seven of
  // them, which is two costs and neither is the O(n²) everyone assumes: an OBJECT PER PAIR (39,800
  // a frame at two hundred birds, all of it garbage) and a full comparison sort of n−1 elements
  // per bird, so the real shape was O(n² log n). Only K of that ordering was ever read.
  //
  // What replaces it is an insertion into a K-long buffer, which is exactly the same seven
  // neighbours — ties break differently and they were arbitrary before too. Most candidates cost
  // one compare against the current worst and are dropped.
  const nj = new Int32Array(K_NEIGHBOURS), nd = new Float64Array(K_NEIGHBOURS);

  // ⚠ ONCE A FRAME. See the note on `bandWaves`: none of this depends on which bird is asking.
  const bandN = bandWaves(spread, c.sd, now, BAND_SCRATCH);
  // ⚠ ONE CLOSURE FOR THE WHOLE FLOCK, NOT ONE PER BIRD. `offer` was declared inside the loop, so
  // a seventeen-hundred-bird flock allocated seventeen hundred of them a frame -- and worse than the
  // allocation, it CAPTURES AND MUTATES `cnt` and `worst`, which forces both into a heap context
  // object instead of registers, for the two hottest variables in the hottest loop in this file.
  // Hoisted, there is one context for the whole flock and the per-bird state is handed to it.
  //
  // ⚠ IT IS THE SAME SEARCH, NOT AN APPROXIMATION OF IT. The tie rule, the insertion order and the
  // K-buffer are untouched, so which neighbours come back is unchanged -- which is the property the
  // note on buildGrid depends on, and the reason this was safe to do at all.
  let _cnt = 0, _worst = Infinity, _i = 0, _px = 0, _py = 0, _pz = 0;
  // One candidate offered to the K-buffer. Ties resolve to the LOWER INDEX so the grid and the
  // plain scan cannot disagree -- see the ⚠  on buildGrid.
  const offer = (j) => {
    if (j === _i) return;
    const dx = sxA[j] - _px, dy = syA[j] - _py, dz = szA[j] - _pz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (_cnt === K_NEIGHBOURS && (d2 > _worst || (d2 === _worst && j > nj[K_NEIGHBOURS - 1]))) return;
    let m = _cnt < K_NEIGHBOURS ? _cnt++ : K_NEIGHBOURS - 1;
    while (m > 0 && (nd[m - 1] > d2 || (nd[m - 1] === d2 && nj[m - 1] > j))) {
      nd[m] = nd[m - 1]; nj[m] = nj[m - 1]; m--;
    }
    nd[m] = d2; nj[m] = j;
    _worst = _cnt === K_NEIGHBOURS ? nd[K_NEIGHBOURS - 1] : Infinity;
  };

  // ⚠ AND THE INTEGRATION RUNS OVER THE LIVE PREFIX TOO. A dormant bird is not stepped at all —
  // that IS the saving, and it is the reason it has to be put back on its station when it returns
  // rather than resumed from where it was left.
  for (let i = 0; i < liveN; i++) {
    const p = pts[i];
    const slot = i * K;
    // Due a re-scan, or has never had one.
    const due = c.nbrN[i] === 0 || ((c.frame + i) % refresh) === 0;
    // ── Topological neighbours: the K nearest, whatever the distance ──────
    let cnt = 0;
    _cnt = 0; _worst = Infinity; _i = i; _px = p.x; _py = p.y; _pz = p.z;
    if (!due) { /* the cached set is restored below */ }
    else if (!grid) {
      for (let j = 0; j < liveN; j++) offer(j);
    } else {
      const ix = Math.min(grid.nx - 1, Math.max(0, (p.x - grid.x0) / grid.h | 0));
      const iy = Math.min(grid.ny - 1, Math.max(0, (p.y - grid.y0) / grid.h | 0));
      const iz = Math.min(grid.nz - 1, Math.max(0, (p.z - grid.z0) / grid.h | 0));
      const rMax = Math.max(grid.nx, Math.max(grid.ny, grid.nz));
      for (let r = 0; r <= rMax; r++) {
        // The proof: every cell within Chebyshev distance r-1 has been visited, so nothing unseen
        // is nearer than (r-1)*h.
        // ⚠ THESE ARE THE HOISTED ONES, AND READING THE LOCALS HERE COSTS THE WHOLE PROOF. The
        // early break is what makes this search O(k) instead of O(n): once every cell within r-1 has
        // been visited, nothing unseen can be nearer. Pointed at the per-bird `cnt`, which the search
        // no longer writes, the test is false at every shell and the loop walks the entire grid for
        // every bird -- measured 2.41 ms to 28.87 at 1,700 birds, an O(n^2) scan wearing a grid.
        // ⚠ AND IT DOES NOT THROW, which is why it has to be said here: `&&` short-circuits, so a
        // `worst` that no longer exists is never evaluated and the mistake is silent.
        if (_cnt === K_NEIGHBOURS && r > 0) {
          const reach = (r - 1) * grid.h;
          if (reach > 0 && _worst <= reach * reach) break;
        }
        const zl = Math.max(0, iz - r), zh = Math.min(grid.nz - 1, iz + r);
        for (let z = zl; z <= zh; z++) {
          const edgeZ = (z === iz - r || z === iz + r);
          const yl = Math.max(0, iy - r), yh = Math.min(grid.ny - 1, iy + r);
          for (let y = yl; y <= yh; y++) {
            const edgeY = (y === iy - r || y === iy + r);
            const xl = Math.max(0, ix - r), xh = Math.min(grid.nx - 1, ix + r);
            // Only the SHELL: a row interior in both z and y contributes just its two end cells.
            const face = edgeZ || edgeY;
            for (let x = xl; x <= xh; x++) {
              if (!face && x !== ix - r && x !== ix + r) continue;
              const c = (z * grid.ny + y) * grid.nx + x;
              const e = grid.start[c + 1];
              for (let t = grid.start[c]; t < e; t++) offer(grid.item[t]);
            }
          }
        }
      }
    }
    // ⚠ THE INDICES ARE CACHED AND THE DISTANCES NEVER ARE. Everything has moved since the scan,
    // and `nd` is what weights separation -- reusing a stale distance is the one way this could
    // change the flock rather than only its cost. Seven square roots is nothing beside the search.
    cnt = _cnt;
    if (due) {
      c.nbrN[i] = cnt;
      for (let m = 0; m < cnt; m++) c.nbr[slot + m] = nj[m];
    } else {
      cnt = c.nbrN[i];
      for (let m = 0; m < cnt; m++) {
        const j = c.nbr[slot + m];
        nj[m] = j;
        const ddx = sxA[j] - p.x, ddy = syA[j] - p.y, ddz = szA[j] - p.z;
        nd[m] = ddx * ddx + ddy * ddy + ddz * ddz;
      }
    }
    // ⚠ AFTER THE RESTORE, NEVER BEFORE IT. This sat above the block and read the cnt the SEARCH
    // left behind -- which on a cached frame is 0, because the search did not run. The force loop
    // then iterated no neighbours at all: no separation, no alignment, no cohesion, on three
    // frames out of four. It measured as a 3.3x speedup and was the boids doing nothing.
    const k = cnt;

    let sx = 0, sy = 0, sz = 0;          // separation
    let ax = 0, ay = 0, az = 0;          // alignment
    let gx = 0, gy = 0, gz = 0;          // cohesion
    for (let m = 0; m < k; m++) {
      const j = nj[m];
      const d = Math.sqrt(nd[m]) || 1e-4;
      // ⚠ SEPARATION IS THE ONE RULE THAT IS STILL METRIC, and Ballerini says so explicitly: a bird
      // keeps its physical distance from anything inside its exclusion zone, and only stops caring
      // about distance for the neighbours beyond it. A purely topological separation would let a
      // dense flock fly through itself.
      if (d < sepR) {
        const push = (sepR - d) / sepR / d;
        sx += (p.x - sxA[j]) * push; sy += (p.y - syA[j]) * push; sz += (p.z - szA[j]) * push;
      }
      ax += svxA[j]; ay += svyA[j]; az += svzA[j];
      gx += sxA[j]; gy += syA[j]; gz += szA[j];
    }
    if (k) {
      ax /= k; ay /= k; az /= k;
      gx = gx / k - p.x; gy = gy / k - p.y; gz = gz / k - p.z;
    }

    // ⚠ AND A PULL BACK TO THE DERIVED CENTRE, which is the whole bridge between the two halves of
    // this system. Boids on their own wander wherever their history takes them; the shared model
    // says where this flock IS, and the room description says so too. This is what keeps a
    // simulated cloud honest about the one fact somebody else is also stating.
    // ⚠ EACH BIRD OWN STATION ON THE PATH, NOT THE ONE CENTRE. `trailW` blends between the two,
    // so 0 is the point attractor that shipped, arithmetically and not merely in effect.
    let tx = cx, ty = cy, tz = cz;
    if (samp) {
      const q = samp[Math.min(TRAIL_SAMP - 1, Math.floor(p.st * (TRAIL_SAMP - 1)))];
      tx = cx + (q.x + offX - cx) * trailW;
      ty = cy + (q.y + offY - cy) * trailW;
      tz = cz + (q.z + offZ - cz) * trailW;
    }
    const dxh = tx - p.x, dyh = ty - p.y, dzh = tz - p.z;
    // ⚠ sqrt RATHER THAN Math.hypot, AND THAT IS A REAL DIFFERENCE IN V8. Math.hypot rescales its
    // arguments so a huge or tiny magnitude cannot overflow or underflow the square -- correct, and
    // several times the cost of the obvious expression. These are tile offsets inside one flock:
    // they are never near the float limits, so the safety buys nothing and is paid for twice a bird
    // a frame.
    const dh = Math.sqrt(dxh * dxh + dyh * dyh + dzh * dzh) || 1e-4;
    // ⚠ THE PULL IS ALWAYS ON, AND SOFT INSIDE THE CLOUD RATHER THAN ABSENT. Written as a hard
    // "only past the spread" it let the whole cloud drift out to two and a half tiles across on a
    // half-tile spread: nothing pulled until a bird was already outside, so the cloud settled at
    // whatever radius the other three rules happened to balance at. Quadratic in the excess, with
    // a small constant term inside, holds it near the size it was asked for and still lets the
    // edges breathe.
    const over = Math.max(0, dh - localSpread) / localSpread;
    const pull = 0.25 + over * over * 3;

    // ⚠ AND THERE IS NO CONSTANT FORWARD PUSH. It was hx/hy × 0.6, on the reasoning that a flock
    // needs a facing — and the derived centre is ALREADY travelling, so the push was added on top
    // of motion the cloud was going to inherit anyway. Measured, the birds ran three quarters of a
    // tile ahead of the centre the room description says they are at. Following a moving target is
    // what makes them move; the heading is only for how they lean.
    // ⚠ AND THE HAWK PUSHES, WHICH UNTIL NOW IT DID NOT. `agitation()` models a stoop as a wave
    // of BANKING and nothing else, so the flock changed how it caught the light and never moved
    // out of the way. This is the other half: a soft bubble centred on the stoop that the birds
    // steer around, which is what opens the hole and splits the cloud.
    //
    // ⚠ IT IS A BUBBLE RATHER THAN A CONE, because a falcon threat is a PLACE for as long as the
    // memory of it lasts, and birds well past it are already coming back together. Damped on age
    // exactly as the banking wave is, so both halves of one stoop fade together instead of the
    // flock flinching on after it has visibly stopped flinching.
    let ex = 0, ey = 0, ez = 0;
    if (scare) {
      const sdx = p.x - scare.x, sdy = p.y - scare.y;
      const sd = Math.sqrt(sdx * sdx + sdy * sdy) || 1e-4;
      const k = Math.exp(-(sd / SCARE_R) * (sd / SCARE_R)) * scareDamp;
      if (k > 1e-4) { ex = (sdx / sd) * k; ey = (sdy / sd) * k; ez = 0.35 * k; }
    }
    let vx = p.vx + (sx * wSep + ax * wAli + gx * wCoh + (dxh / dh) * pull * wHome + ex * wScare) * dt;
    let vy = p.vy + (sy * wSep + ay * wAli + gy * wCoh + (dyh / dh) * pull * wHome + ey * wScare) * dt;
    // ⚠ THE VERTICAL TERM CARRIES FLAT_Z AND THE OTHER TWO DO NOT -- that asymmetry IS the shape.
    let vz = p.vz + ((sz * wSep + az * wAli + gz * wCoh) * Z_SOFT + (dzh / dh) * pull * wHome * FLAT_Z + ez * wScare) * dt;

    // Hold a roughly constant airspeed: birds do not coast to a stop and do not accelerate away.
    const sp = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1e-4;
    const want = speed * p.wk;
    vx = (vx / sp) * want; vy = (vy / sp) * want; vz = (vz / sp) * want;

    // ⚠ AND THE DIRECTION IS BANK-LIMITED, WHICH IS THE ONE THING THE RENORMALISE ABOVE TAKES AWAY.
    // Rescaling to cruise fixes the SPEED and says nothing at all about how far the heading may
    // swing in one step, so a spike in the force sum turns a bird through any angle it likes
    // between two frames. Measured on the flock that shipped: a mean lateral acceleration of 1.10 g
    // -- which is right, and is why nothing looked wrong on average -- against a p99 of 4.99 g and a
    // worst of 15.0, at turn rates up to 11.05 rad/s (633 deg/s). That tail is the whole of what
    // reads as fast and chaotic: most of the flock is behaving and a few per cent of it is snapping.
    //
    // ⚠ IT IS A TURN RATE AND NEVER A DAMPING ON THE FORCES. Softening the weights costs the
    // structure the forces exist to produce -- separation stops holding spacing, the home pull stops
    // holding the cloud to the tile the shared model named -- and it would bound nothing, because
    // the renormalise hands the direction back whatever magnitude went in. Clamping the ANGLE leaves
    // every force at full strength and only limits how quickly a bird may act on them, which is what
    // an animal with wings is actually subject to.
    //
    // ⚠ THE NUMBER IS A BANK ANGLE, NOT A FEEL. A bird in a coordinated turn banks at phi and turns
    // at g*tan(phi)/v; Cavagna and the STARFLAG measurements put a starling's accelerations inside a
    // murmuration around 1 g with peaks of two to three, so TURN_G is that ceiling and the rate falls
    // out of the cruise speed rather than being chosen beside it. At 2.2 g and 12 m/s that is
    // 1.80 rad/s -- 103 deg/s, a bird crossing its own flock in a sweep rather than a flick.
    //
    // ⚠ AND THE ROTATION IS TOWARD THE NEW DIRECTION, NOT A BLEND WITH IT. Interpolating the two
    // vectors and renormalising shortens the step as the angle grows and goes undefined at a
    // reversal; rotating the old heading by a bounded angle in the plane the two span is exact at
    // every angle, including the 180 degrees a bird hit by the scare bubble can be asked for.
    // ⚠ AND THE HORIZONTAL-ONLY VERSION OF THIS IS WRONG, WHICH IS WORTH RECORDING BECAUSE IT IS THE
    // PHYSICALLY OBVIOUS ONE. A bank angle limits a HORIZONTAL turn and a bird changing height is
    // pitching rather than rolling, so limiting the heading alone and letting the vertical component
    // through looks like the honest reading -- and measured it is worse on three counts at once: the
    // flock drifts 0.39 tiles off the centre the shared model named, the exclusion zone stops doing
    // anything (separation between birds at one height is almost entirely horizontal, so it is the
    // component being clamped), and the pancake does not come back anyway. The limit is on the whole
    // direction.
    const ovx = p.vx, ovy = p.vy, ovz = p.vz;
    const osp = Math.sqrt(ovx * ovx + ovy * ovy + ovz * ovz);
    if (osp > 1e-6) {
      const ux = ovx / osp, uy = ovy / osp, uz = ovz / osp;
      const wx = vx / want, wy = vy / want, wz = vz / want;
      const cosA = clamp(ux * wx + uy * wy + uz * wz, -1, 1);
      // g in tiles/s^2, derived from the one place this file states the tile-to-metre scale: the
      // cruise speed is 12 m/s by measurement and the shipped `speed` is that same figure in tiles.
      const maxA = (TURN_G * 9.81 * TILE_PER_M) / Math.max(want, 1e-4) * dt;
      if (cosA < Math.cos(maxA)) {
        // Gram-Schmidt: the component of the wanted direction perpendicular to the current one.
        let ex2 = wx - ux * cosA, ey2 = wy - uy * cosA, ez2 = wz - uz * cosA;
        const el = Math.sqrt(ex2 * ex2 + ey2 * ey2 + ez2 * ez2);
        if (el > 1e-9) {
          ex2 /= el; ey2 /= el; ez2 /= el;
          const ca = Math.cos(maxA), sa = Math.sin(maxA);
          vx = (ux * ca + ex2 * sa) * want;
          vy = (uy * ca + ey2 * sa) * want;
          vz = (uz * ca + ez2 * sa) * want;
        }
      }
    }

    p.vx = vx; p.vy = vy; p.vz = vz;
    p.x += vx * dt; p.y += vy * dt; p.z += vz * dt;
    // A bank of its own from turning, plus the flock's own rolling bands. The PREDATOR's wave is
    // still added on top of this by the caller -- the two are different things and the caller owns
    // which predator is causing what.
    //
    // ⚠ THE BAND TERM IS NOT CLAMPED INTO THE TURNING ONE. The turn is clamped to ±1.2 and
    // halved because a bird leaning into its own turn leans a little; a wave crest is a bird going
    // over on its side, which is a bigger thing and the whole reason the stripe is visible.
    // ⚠ THE TURNING TERM IS SMALL BECAUSE IT WAS SATURATED. At *0.5 it pinned 68.7% of the
    // flock against its own clamp with a mean of -0.532 rad, so almost every bird was permanently
    // banked 30 degrees the same way -- a constant, carrying no information, and `bank` is |sin(roll)|
    // so that constant set the floor the wave had to climb out of. The wave is the thing that should
    // move this number.
    p.roll = clamp(Math.atan2(vy, vx) - heading, -1.2, 1.2) * 0.16
      + bandAt(BAND_SCRATCH, bandN, p.x, p.y, cx, cy);
  }
  return pts;
}

/** Drop clouds nobody has asked about, and hold a hard ceiling in case somebody stops asking. */
export function sweep(now) {
  for (const [k, c] of clouds) if (now - c.seen > IDLE_EVICT_MS) clouds.delete(k);
  if (clouds.size > MAX_CLOUDS) {
    const oldest = [...clouds.entries()].sort((a, b) => a[1].seen - b[1].seen);
    for (let i = 0; i < oldest.length - MAX_CLOUDS; i++) clouds.delete(oldest[i][0]);
  }
}

/** What the simulator is holding — for the gate, because an eviction rule nobody measures is a leak. */
export const murmurStats = () => ({
  clouds: clouds.size,
  birds: [...clouds.values()].reduce((a, c) => a + c.pts.length, 0),
  flown: [...clouds.values()].reduce((a, c) => a + (c.liveN == null ? c.pts.length : c.liveN), 0),
  // ⚠ NEIGHBOUR REFERENCES POINTING AT A BIRD THAT IS NOT IN THE SKY, WHICH IS THE ONE THINNING
  // FAILURE NOTHING BEHAVIOURAL CAN SEE. A dormant bird is frozen wherever it was abandoned; if it
  // is still in the neighbour search the live birds separate from, align with and steer around it,
  // and the picture looks completely normal while the flock moves slightly wrongly for ever.
  //
  // ⚠ AND IT CANNOT BE TESTED BY PUTTING A GHOST SOMEWHERE AND WATCHING, which is what was tried
  // first, twice. Park the dormant birds in the middle of the cloud and the effect is ambiguous in
  // SIGN — separation only reaches `sepR` so most live birds feel no push, while cohesion pulls
  // them in, and the region gets BUSIER either way. Park them well clear and the effect is zero by
  // construction, because neighbours here are TOPOLOGICAL: a bird's seven nearest are always live
  // birds a few hundredths of a tile away, so a ghost three tiles off is never among them however
  // wrong the loops are. Both readings passed with every bound widened.
  //
  // So it is asserted structurally instead: the loops are bounded by `liveN`, so an index at or
  // above it is impossible rather than merely unlikely, and a single one is a real defect.
  // ⚠ AND THE PARTITION'S OWN INVARIANT, WHICH `ghostRefs` CANNOT SPEAK FOR. That counter asks
  // whether a neighbour index reaches PAST `liveN`; it is blind to a dormant bird sitting BELOW it,
  // which is exactly what a partition that has stopped swapping leaves behind — the count is still
  // right, the membership is not, and every loop then flies a bird that is not there and skips one
  // that is. Mutation-tested: disabling the swap is invisible to every other check in this file.
  misplaced: [...clouds.values()].reduce((a, c) => {
    if (c.liveN == null) return a;
    let bad = 0;
    for (let i = 0; i < c.pts.length; i++) if ((c.pts[i].vis > 0) !== (i < c.liveN)) bad++;
    return a + bad;
  }, 0),
  ghostRefs: [...clouds.values()].reduce((a, c) => {
    if (!c.nbr || c.liveN == null) return a;
    let bad = 0;
    for (let i = 0; i < c.liveN; i++) {
      const n = c.nbrN ? c.nbrN[i] : 0;
      for (let k = 0; k < n; k++) if (c.nbr[i * K_NEIGHBOURS + k] >= c.liveN) bad++;
    }
    return a + bad;
  }, 0),
});

/** Testing seam: forget everything, so a gate can start from a known state. */
export const murmurReset = () => clouds.clear();
