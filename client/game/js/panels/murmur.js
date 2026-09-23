// MURMUR — a starling cloud, simulated rather than derived.
//
// ⚠ THE SIMULATION ITSELF RUNS ON THE GPU (gl/murmur-gpu.js), AND ONLY THERE, since 2026-09-23. This
// file is what it is built from: the rule's numbers (MURMUR_RULES), the flock's own memory — its clock,
// the trail its centre has flown, the stoop — as `flockFrame`, the starting cloud as `seedPoints`, and
// the two travelling waves as closed forms. The per-bird step that used to live here was deleted when
// the GPU flock replaced it; the reasoning behind each of its terms is in git at d4dc4f7fa, and the
// numbers it settled on are the ones below.
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
//   3. IT NEEDS AN EVICTION RULE, and has one — `sweep` in gl/murmur-gpu.js. Somewhere to keep state
//      needs somewhere to throw it away, or a session walking across a city accumulates every cloud
//      it has ever seen.
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
const DT_MAX = 0.05;             // s. A stalled tab must not hand the integrator a second of travel.

// Tiles per second. 1 tile is about 11 m — derived from a bird whose wingspan is known, see the
// note in windshield.js — so these are real speeds rather than chosen ones.
// ⚠ ONE STATEMENT OF THE TILE SCALE, because three numbers in this file are quoted in metres and
// were each converting privately. A starling in a murmuration is measured at 12 m/s and that is
// 1.09 tiles/s here, so a tile is 11.0 m and every metric figure below derives from this.
const TILE_PER_M = 1.09 / 12;
// ⚠ HOW FAR APART TWO BIRDS FLY, DERIVED RATHER THAN CHOSEN, because something outside this
// file needs it: a cloud whose birds are closer together on screen than a pixel cannot show
// how many of it there are, so this is what decides the distance past which drawing more of
// them buys nothing. 0.67 m is the nearest-neighbour distance the separation radius was tuned
// to in the sepR sweep below, and it is quoted there in metres like everything else here.
export const MURMUR_NND_TILES = 0.67 * TILE_PER_M;

const WAVE_SPEED = 1.21;         // 13.4 m/s, measured (Hemelrijk)
const WAVE_WIDTH = 0.35;         // how wide the dark band is, in tiles
const WAVE_LIFE = 2.6;           // s before a pulse has damped to nothing

// How long a bird takes to fade out of a thinned flock, or back into it. Long enough that no
// single frame shows a step in opacity; short enough that the simulation saving arrives while
// the load that asked for it is still happening.
const SHOW_FADE_S = 0.6;

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
// ⚠ THE CLOUD'S FIRST ARRANGEMENT AND ITS BAND SEED, AS A PURE FUNCTION, because the GPU flock
// (gl/murmur-gpu.js) starts from exactly the same birds in exactly the same places and must not grow
// a second copy of the hash that decides them.
export function seedPoints(key, n, cx, cy, cz, spread) {
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
  return { pts, sd };
}

// ⚠ WHERE BIRD i IS PLACED, AS A UNIT OFFSET, when it first appears and when it fades back in after
// thinning: the same three hashes seedPoints uses, times a radius the caller picks. The GPU flock reads
// its offsets from here.
export function scatterOf(i) {
  const a = frac(i * 12.9898 + 1.3) * Math.PI * 2, r = Math.sqrt(frac(i * 78.233 + 4.1));
  return [Math.cos(a) * r, Math.sin(a) * r, frac(i * 5.77 + 9.1) - 0.5];
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
// `bandWaves` builds the table here, once a frame, and the GPU flock evaluates it at every bird.
const BAND_SLOTS = 4;            // c, s, front, amp

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

// ⚠ THE STOOP WAVE AS FOUR NUMBERS FOR A SHADER: its origin, how far the front has travelled and how
// strong it still is. agitation() below evaluates the same wave at one bird; the GPU flock evaluates it
// at every bird from these. Kept beside it so the two cannot drift apart unnoticed.
export function agitationWave(ev, now, maxRoll = 1.3) {
  if (!ev) return null;
  const age = (now - ev.at) / 1000;
  if (age < 0 || age > WAVE_LIFE) return null;
  const damp = 1 - age / WAVE_LIFE;
  return { x: ev.x, y: ev.y, front: WAVE_SPEED * age, amp: maxRoll * damp * damp };
}

// ── WHAT A FLOCK IS DOING THIS FRAME, BEFORE ANY BIRD IS ASKED ───────────────────
//
// ⚠ THE FLOCK'S MEMORY STAYS IN JAVASCRIPT. Everything about a murmuration that is a property of the
// FLOCK rather than of a bird — how long since it was last stepped, the path its centre has flown,
// where along that path the stations sit, how far the cloud may spread, whether a hawk is in it — is
// worked out here, once a frame, and handed to the GPU flock (gl/murmur-gpu.js) as uniforms. Only the
// per-bird rule is a shader; this is a few dozen points.
//
// ⚠ IT ADVANCES THE CLOCK AND THEN RECORDS THE TRAIL, and only records it when the clock moved. A dt
// of 0 returns before the trail is touched, so painting the same instant twice changes nothing.
export function flockFrame(c, cx, cy, cz, now, spread, opts = {}) {
  const dt = c.last == null ? 0 : clamp((now - c.last) / 1000, 0, DT_MAX);
  c.last = now;
  if (!dt) return { dt };
  const head = c.trail[c.trail.length - 1];
  if (!head || Math.hypot(cx - head.x, cy - head.y, cz - head.z) >= TRAIL_STEP) {
    c.trail.push({ x: cx, y: cy, z: cz });
    if (c.trail.length > TRAIL_MAX) c.trail.shift();
  }
  const trailW = clamp(opts.trail ?? 0, 0, 1);
  const samp = trailW > 0 ? trailSamples(c.trail) : null;
  const localSpread = samp ? spread * (1 - trailW * 0.62) : spread;
  let offX = 0, offY = 0, offZ = 0;
  if (samp) { const m = trailMid(samp); offX = cx - m.x; offY = cy - m.y; offZ = cz - m.z; }
  const scare = opts.scare && (now - opts.scare.at) >= 0
    && (now - opts.scare.at) / 1000 < WAVE_LIFE ? opts.scare : null;
  const scareDamp = scare ? 1 - ((now - scare.at) / 1000) / WAVE_LIFE : 0;
  return { dt, trailW, samp, localSpread, offX, offY, offZ, scare, scareDamp };
}

// ⚠ THE RULE'S NUMBERS, IN ONE PLACE. gl/murmur-gpu.js interpolates these into its shader rather than
// retyping them. The notes below are the CPU step's own, from when these were measured against it.
//
// sepR, how close is too close:
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
//
// speed, the cruise every bird is renormalised to:
// ⚠ AND IT MUST STAY ABOVE THE SPEED THE DERIVED CENTRE TRAVELS AT, which is a constraint on the
// SPECIES ROW rather than on this number — see the circuit note on `songbird` in birds.js. A bird
// that cannot keep up with its own station spends its whole velocity budget on the home term, and
// since the vector is renormalised to this speed every step, the three local rules then
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
// turnG, the bank limit:
// ⚠ AND THE DIRECTION IS BANK-LIMITED, WHICH IS THE ONE THING THE RENORMALISE TO CRUISE TAKES AWAY.
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
export const MURMUR_RULES = Object.freeze({
  wSep: 2.2, wAli: 0.85, wCoh: 0.55, wHome: 4.5, wScare: 9.0,
  FLAT_Z, Z_SOFT, SCARE_R, TILE_PER_M, K: K_NEIGHBOURS, DT_MAX, SHOW_FADE_S,
  TRAIL_SAMP, BAND_N, BAND_WIDTH, WAVE_SPEED, WAVE_WIDTH, WAVE_LIFE,
  sepR: 0.15, speed: 1.09, turnG: 3.0,
});
