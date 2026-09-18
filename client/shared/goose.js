/**
 * GEESE — where a flock is, and what it is doing, and nothing else.
 *
 * Shared for the reason client/shared/traffic.js is shared, and it is worth restating because it is
 * the whole design: a flock of geese is one of the few things in this game that has to look the
 * same from two completely different surfaces. The windshield paints birds on the grass; the text
 * game prints a sentence about the field you are standing in. If those two ever disagree, a player
 * reads "a dozen geese are working the grass" over an empty lawn. So the answer lives here once and
 * both import it.
 *
 * ⚠ IT IS DERIVED FROM THE CLOCK AND THE MAP, AND IT STORES NOTHING. No table, no server state, no
 * per-flock record, nothing to evict, and no tick. Two players in the same park see the same geese
 * because they share a wall clock and the same per-flock offset, not because anybody synchronised
 * them — the same bargain the traffic lights make. It also means the answer survives a map-window
 * recentre for free, which the renderer does constantly, and a server restart, which it does not.
 *
 * ⚠ AND IT DECIDES NOTHING ABOUT HABITAT ON ITS OWN. It cannot: only the caller has the map. It
 * answers "is this tile a flock anchor, and what is that flock doing now"; the caller asks its own
 * world whether the tile is grass. `GOOSE_HABITAT` below is the one table both callers read.
 */

// ── Where a flock is ──────────────────────────────────────────────────────────
/**
 * ⚠ THE ROLL IS PER TILE, AND THE CALLER ONLY EVER ROLLS ON GROUND GEESE WOULD STAND ON. That is
 * the whole of it, and the first design got it backwards: a lattice picked one candidate tile per
 * 7×7 cell and then asked whether that tile happened to be habitat.
 *
 * It measured terribly, which is the only reason this is written down. Habitat is a small fraction
 * of this world — 1,315 tiles of grass, park and water against tens of thousands — so a lattice
 * spread evenly over the map lands almost all of its anchors on roads, rock and rooftops and
 * discards them. Swept over the real content it produced THREE flocks in the entire world, all
 * three on water, none on a single one of the 385 tiles of grass and park the feature is for. A
 * player could have walked Coldwater for a week without meeting a goose.
 *
 * Rolling per tile inverts it: every roll is already on ground a goose would use, so the density
 * below means what it says, and a field of turf gets flocks in proportion to how much turf it is.
 * It also costs the callers nothing they were not already paying — the renderer walks its visible
 * tiles anyway, and the text game has exactly one tile to ask about.
 */
export const FLOCK_AREA = 12;          // tiles per coarse-bias block — a "field" is about this big
export const GOOSE_AREA_BIAS = 0.45;   // above this a block is goose country; below it, they are rare
const DENSE = 0.075, SPARSE = 0.006;   // per-habitat-tile chance in each case

const frac = (n) => { const x = Math.sin(n) * 43758.5453; return x - Math.floor(x); };
// ⚠ THE HASH CONSTANTS ARE OFFSET FROM THE TREE ONES. The scatter pass picks wooded patches with
// `frac(floor(wx/4)*71.7 + floor(wy/4)*131.3)` and `frac(wx*57.1 + wy*199.7)`. Reusing those on a
// field that shares a factor with the tile grid correlates the two — every flock in a wood,
// deterministically, so it reads as a decision somebody made rather than as a collision.
const areaHash = (wx, wy) => frac(Math.floor(wx / FLOCK_AREA) * 71.7 + Math.floor(wy / FLOCK_AREA) * 131.3 + 17.3);
const tileHash = (wx, wy) => frac(wx * 57.1 + wy * 199.7 + 41.9);

/**
 * Does this tile hold a flock?
 *
 * ⚠ IT DOES NOT ASK WHETHER THE TILE IS HABITAT, AND MUST NOT. Only the caller has the map: the
 * renderer reads a cell's biome, the text game reads a zone's terrain, and neither can answer for
 * the other. Ask `gooseHabitat` first and only roll on ground that came back true — everything
 * this module promises about density is a promise about rolls made that way.
 *
 * The two-level hash is the same shape the trees use: a coarse block decides whether this is goose
 * country at all, then the tile itself rolls. That is what makes them come in fields rather than
 * one bird per pond across the whole map.
 */
export function flockAt(wx, wy, density = 1) {
  const want = (areaHash(wx, wy) > GOOSE_AREA_BIAS ? DENSE : SPARSE) * density;
  if (tileHash(wx, wy) >= want) return null;
  return { ax: wx, ay: wy };
}

/**
 * Every flock within `R` tiles of a centre, over whatever ground the caller says is habitat.
 *
 * `isHabitat(wx, wy)` is the caller's own map question — the renderer's reads its window, and a
 * caller that has no map (the text game) has one tile and uses `flockAt` directly instead.
 */
export function flocksNear(wcx, wcy, R, density = 1, isHabitat = null) {
  const out = [];
  for (let wy = Math.ceil(wcy - R); wy <= Math.floor(wcy + R); wy++) {
    for (let wx = Math.ceil(wcx - R); wx <= Math.floor(wcx + R); wx++) {
      if (isHabitat && !isHabitat(wx, wy)) continue;
      const f = flockAt(wx, wy, density);
      if (f) out.push(f);
    }
  }
  return out;
}

// ── Habitat ───────────────────────────────────────────────────────────────────
/**
 * ⚠ ONE TABLE, KEYED BY BOTH SPELLINGS OF THE SAME GROUND. The renderer holds a cell whose ground
 * is a BIOME; the text game holds a zone whose ground is a TERRAIN. `grass` and `parkland` are the
 * two names for one surface (see TERRAIN_BIOME in plugins/flight/biomes.js); `park` and `water` are
 * spelled the same on both sides. Answering both from one table is what makes it impossible for
 * the picture and the sentence to disagree about where geese live.
 *
 * ⚠ MARSH IS NOT HERE, AND THAT IS NOT AN OVERSIGHT. Canada geese are waterfowl and a marsh is the
 * obvious place to put them — but `marsh` maps to the biome `badlands`, deliberately ("the
 * wildlands read arid & desolate … never water"), which it shares with `dirt`, `sand` and `gravel`.
 * Geese on marsh is geese on every dry flat in the wastes. The waterfowl half is `water` itself.
 */
export const GOOSE_HABITAT = {
  grass: 'walk', parkland: 'walk', park: 'walk',
  water: 'raft',
};
export const gooseHabitat = (ground) => GOOSE_HABITAT[ground] || null;

// ── The cycle ─────────────────────────────────────────────────────────────────
// A flock is on the ground for the first part of its own period and airborne for the rest. Every
// flock has its own period and its own phase offset, both derived from where it lives, so from one
// vantage you see one lifting off, another already circling and a third still grazing — and none
// of them in step. That is the whole of "lands every once in a while at random", with no
// randomness in it anywhere.
export const GOOSE_PERIOD = 100000;   // ms, before the per-flock jitter below
export const U_GROUND = 0.40;         // the share of a period spent on the ground
export const GOOSE_Z = 2.2;           // tiles, the top of the circuit
export const GOOSE_R = 3.4;           // tiles, the radius of the circuit

const smooth = (t) => { const x = t < 0 ? 0 : t > 1 ? 1 : t; return x * x * (3 - 2 * x); };
const TAU = Math.PI * 2;
// Two courses, the short way round. Subtracting them raw walks the long way whenever they straddle
// ±π, which on a turn RATE is one frame of a bird spinning through a full circle.
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// How long a flock takes to gather into the skein before it lifts, and to spread back out after it
// lands. Here rather than in the renderer because it is a fact about the BIRDS, and because a gate
// that wants a settled flock has to be able to ask for one rather than guess a moment.
export const GOOSE_SETTLE_MS = 2600;

/** A flock's own period, in ms. Jittered off its anchor so no two are ever in step. */
export const flockPeriod = (f) => GOOSE_PERIOD * (0.7 + frac(f.ax * 3.7 + f.ay * 11.9) * 0.7);

// How much of the airborne phase is spent climbing away from the anchor and settling back onto it.
const RAMP_UP = 0.18, RAMP_DN = 0.22;

// ── Flying ROUND things ───────────────────────────────────────────────────────
/**
 * The circuit used to be a circle of `GOOSE_R`, and a circle of three and a half tiles drawn round
 * a park tile goes through whatever is standing next to the park. Reported exactly that way: the
 * flock flies through the buildings.
 *
 * ⚠ THE RADIUS IS A PROFILE, NOT A SCALAR, AND THAT IS THE WHOLE DESIGN. Fitting ONE radius to the
 * clear space is the obvious version and it is worse than it sounds: it takes the MINIMUM over the
 * compass, so a single shed on one edge of a field collapses the flock's whole circuit into a tight
 * buzz over its own anchor. A radius per direction lets the loop stay wide over the open half and
 * pull in only where the ground is built on — which is what "pathing around them" actually looks
 * like, and it is a closed loop rather than a detour because the circuit still starts and ends on
 * the anchor with zero radius.
 *
 * ⚠ AND IT IS MEASURED AGAINST THE TILES, NEVER RAY-MARCHED ALONG THE SPOKES. A building is about
 * one tile across and twelve spokes are 30° apart, so at three tiles out a shed can sit squarely
 * BETWEEN two spokes and be missed by both — a march finds nothing and the flock flies through it,
 * which is the bug wearing the fix's clothes. Each blocked tile is projected onto each spoke
 * instead (`along`/`perp`), so a tile off the axis still pulls in the spokes either side of it.
 *
 * ⚠ THERE IS NO TUNE FLAG FOR THIS, DELIBERATELY. `flockOnSegment` — the bird strike — reads the
 * same circuit, and a renderer flag the server does not share is a strike that fires over empty sky
 * or a flock you can watch a wing pass through, which is the one failure this whole module exists
 * to prevent. Both surfaces avoid buildings or neither does.
 *
 * `isBlocked(wx, wy)` is the caller's own map question, exactly as `isHabitat` is: the renderer
 * reads its window's cell, the server reads the zone. Answer FALSE for a tile you cannot see — an
 * unknown tile treated as built shrinks a flock's circuit as it enters the map window and grows it
 * again as the window recentres, which is a flock changing shape as you drive past.
 */
export const CLEAR_DIRS = 12;         // spokes round the compass — 30° apart
const CLEAR_BAND = 1.0;               // how near a spoke a blocked tile has to be to count, in tiles
const CLEAR_MARGIN = 0.15;            // …and how far short of it the birds then turn
// ⚠ AND THE FLOCK IS WIDER THAN ITS CENTRE. The clearance bends the CIRCUIT, which is where the
// flock's middle goes; the birds are spread a good way either side of it, so a margin that only
// clears the centre puts the outside of an arm over the roof it is meant to be avoiding. ONE rank,
// not the half-width: the cut a blocked tile makes is slew-limited into its neighbours, so holding
// the circuit off by the width of a six-bird echelon drags the OPEN side of the lap in with it and
// a shed on one side of a park shrinks the whole circuit. What the margin can promise is that the
// flock goes round; the outermost bird of a wide skein still clips a roof corner, as a real one does.
// ⚠ Read where it is used rather than folded in here, because SKEIN_ACROSS is declared further down
// the file: a constant that reaches forward for it is a ReferenceError at load.
// ⚠ THE FLOOR IS THE TIGHTEST TURN, NOT A MINIMUM CIRCUIT, AND IT HAS TO BE UNDER HALF A TILE. An
// anchor can sit directly against a building — one tile from its centre — and a floor of 0.85 puts
// the birds 0.15 from that centre, which is not "close to the wall", it is inside the room. Under
// 0.5 they stay in their own tile whatever is next door, which is the only floor that keeps the
// promise on the worst case rather than on the average one. The cost is a flock hemmed in on every
// side circling very tightly over its own lawn — rare, and the right thing for it to do.
export const GOOSE_R_MIN = 0.40;
// How much the circuit radius may GROW from one spoke to the next. It may shrink as fast as it
// likes — see the slew pass at the end of flockClearance.
const MAX_SLEW = 0.62;

// The spokes' own directions, once. Twenty-four trig calls per flock per frame is not a lot and it
// is not nothing either, and they are the same twenty-four every time.
const SPOKE_C = [], SPOKE_S = [];
for (let i = 0; i < CLEAR_DIRS; i++) { SPOKE_C.push(Math.cos((i / CLEAR_DIRS) * TAU)); SPOKE_S.push(Math.sin((i / CLEAR_DIRS) * TAU)); }
// Scratch, reused across calls: a flock's built tiles, flat, so a park edge does not mint forty
// little arrays ten times a frame. Safe because nothing here yields and no caller keeps the arrays.
const _hx = [], _hy = [];

/**
 * The largest circuit radius in each of `CLEAR_DIRS` directions that keeps the birds off the
 * buildings. Returns NULL when nothing within reach is built on — which is the common case, is one
 * allocation saved per flock per frame, and makes the plain circle provably the path a flock over
 * open country still flies.
 *
 * ⚠ THERE IS DELIBERATELY NO CACHE ON THIS, and it was written with one first. Buildings do not
 * move, so memoising on the anchor looks free — and the profile also depends on which tiles the
 * CALLER can currently see, which for the renderer is its map window. A cached "nothing is built
 * here" taken while half the disc was outside the window is then held for the life of the page, and
 * the flock goes on flying through a block the client can now see perfectly well. The gate caught
 * it as exactly that. Measured instead at the per-frame flock cap of ten: 23 µs over open country,
 * 37 in a dense city block, 61 along a park edge — against a cab frame of 2.8 ms and a pass that
 * already sweeps two thousand tiles to find the flocks in the first place. A cache is only as safe
 * as its invalidation rule, and this one has no rule to write.
 */
export function flockClearance(f, isBlocked) {
  if (typeof isBlocked !== 'function') return null;
  const REACH = Math.ceil(GOOSE_R + CLEAR_BAND), R2 = (GOOSE_R + CLEAR_BAND) * (GOOSE_R + CLEAR_BAND);
  let n = 0;
  for (let dy = -REACH; dy <= REACH; dy++) {
    for (let dx = -REACH; dx <= REACH; dx++) {
      if (!dx && !dy) continue;                       // the anchor is habitat by construction
      if (dx * dx + dy * dy > R2) continue;
      if (isBlocked(f.ax + dx, f.ay + dy)) { _hx[n] = dx; _hy[n] = dy; n++; }
    }
  }
  if (!n) return null;
  const out = new Array(CLEAR_DIRS).fill(GOOSE_R);
  for (let i = 0; i < CLEAR_DIRS; i++) {
    const cs = SPOKE_C[i], sn = SPOKE_S[i];
    for (let k = 0; k < n; k++) {
      const dx = _hx[k], dy = _hy[k];
      const along = dx * cs + dy * sn;
      if (along <= 0) continue;                       // behind the spoke — a different direction's problem
      const perp = Math.abs(dy * cs - dx * sn);
      if (perp >= CLEAR_BAND) continue;
      // Where the spoke first comes within CLEAR_BAND of the tile centre, less the turn-in margin.
      const r = along - Math.sqrt(CLEAR_BAND * CLEAR_BAND - perp * perp) - CLEAR_MARGIN - SKEIN_ACROSS;
      if (r < out[i]) out[i] = r;
    }
    if (out[i] < GOOSE_R_MIN) out[i] = GOOSE_R_MIN;
  }
  // ⚠ AND THE PROFILE IS SLEW-LIMITED, WHICH IS NOT COSMETIC. A building sampled at one spoke and
  // clear air at the next is a step of two and a half tiles across 30°, and what the renderer reads
  // off this is not the position but the TURN RATE — it banks the birds into it. Measured on a
  // shed beside a park, the raw profile swung the flock's turn rate from +73°/s to -103°/s and back
  // seven times in one pass, which is a skein flipping from full left bank to full right and back
  // at about 2 Hz. Anybody watching would call that broken, and rightly.
  //
  // ⚠ IT ONLY EVER LOWERS. The sweep is round the ring twice, each way, allowing the radius to fall
  // as fast as it likes and to rise by at most MAX_SLEW a spoke — so a value can be pulled IN by a
  // neighbouring obstruction but never pushed OUT past one. Any filter that could raise a sample is
  // a filter that can put the birds back through the wall it was taken to avoid.
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
 *
 * ⚠ CATMULL-ROM, AND SMOOTHSTEP IS THE TRAP IT REPLACED. Smoothstep between two neighbours is C1,
 * cannot overshoot, and is therefore the obvious safe choice — and its derivative is ZERO AT EVERY
 * SPOKE, so the loop flattens at each one and swings between them. On the position that is a 0.07-
 * tile scallop nobody would notice. On the TURN RATE, which is what banks the birds, it is a swing
 * of a hundred degrees a second once per spoke: a skein rolling left, right, left, right round the
 * pinch. Catmull-Rom matches tangents at the spokes instead, which is the whole point here.
 *
 * ⚠ AND IT IS CLAMPED TO THE HIGHER OF ITS TWO NEIGHBOURS. That is the overshoot smoothstep was
 * chosen to avoid, and an overshoot here is the loop bulging back into the tile a sample was taken
 * to keep it out of. Clamped, it is exactly as safe as smoothstep was at the spokes and smooth
 * between them; the slew limit in `flockClearance` is what keeps the clamp from ever biting hard
 * enough to reintroduce a corner.
 */
function radiusAt(clear, th) {
  if (!clear) return GOOSE_R;
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

// Where the circuit puts the flock at `t` in [0,1] of its airborne phase. Factored out because the
// HEADING is differenced from it — see the ⚠ in flockState — and a second copy of this arithmetic
// would be a flock pointing somewhere its own position never goes.
function circuitAt(f, t, clear) {
  const bump = Math.min(smooth(t / RAMP_UP), smooth((1 - t) / RAMP_DN));
  const turns = 1 + Math.floor(frac(f.ax * 7.7 + f.ay * 3.1) * 2);
  const th = frac(f.ax * 2.3 + f.ay * 8.7) * TAU + turns * TAU * t;
  const r = radiusAt(clear, th) * bump;
  return { x: f.ax + Math.cos(th) * r, y: f.ay + Math.sin(th) * r, z: GOOSE_Z * bump, r, th };
}

/**
 * How many birds. Small, always — this is a family party, not a migration.
 *
 * ⚠ MIN and MAX ARE THE DECLARED ONES, not a literal that happens to agree with them. The bird
 * strike's radius is derived from MAX_FLOCK, so a size rolled from numbers written here would
 * let the flock outgrow the thing that flies into it, silently — the same coupling the skein
 * spacing was moved into this file to close.
 */
export const MIN_FLOCK = 3, MAX_FLOCK = 6;
export const flockSize = (f) => MIN_FLOCK + Math.floor(frac(f.ax * 4.11 + f.ay * 9.73) * (MAX_FLOCK - MIN_FLOCK + 1));

/**
 * What a flock is doing at `now`: where its centre is, how high, which way it is pointing.
 *
 * ⚠ THE CIRCUIT IS CENTRED ON THE ANCHOR AND ITS RADIUS RIDES THE SAME RAMP AS ITS HEIGHT. That is
 * what closes the cycle: the flock leaves the anchor, goes round, and comes back to it, so `u`
 * wrapping from 1 to 0 moves nothing. Centre the circuit on a point OFFSET from the anchor and it
 * does not close — the flock teleports once per period, which is invisible in a short test and
 * obvious to anybody watching one field for two minutes.
 *
 * `clear` is the profile `flockClearance` answered for this flock, or null for the plain circle.
 *
 * ⚠ IT CHANGES WHERE, NEVER WHETHER. `airborne`, `u`, `period` and `n` are all read before `clear`
 * is touched, so a caller that has no map — the text game, which has one tile and a sentence to
 * print — gets the same answer about whether the flock is up as the renderer painting the same
 * field with the full window in hand. That is what stops "a skein goes over" being printed over a
 * lawn the windscreen has drawn empty, which is the failure this whole module exists to prevent,
 * and it is a property of the ORDER of these lines rather than of anybody's good intentions.
 *
 * ⚠ `turn` AND `climb` ARE BYPRODUCTS OF THE HEADING, NOT A SECOND DERIVATION. The renderer banks a
 * bird into its turn and pitches it into its climb, and solving either from the circuit a second
 * time over there is how a flock ends up banking the wrong way round a loop its own position never
 * flew. `turn` is radians per second of WALL time, so a caller can use it without knowing this
 * flock's period; `climb` is a gradient — rise over horizontal run — so it is an angle's tangent
 * and needs no speed at all.
 */
export function flockState(f, now, clear = null) {
  const ph = frac(f.ax * 19.1 + f.ay * 5.3);
  const period = flockPeriod(f);
  const u = (((now / period) + ph) % 1 + 1) % 1;

  if (u < U_GROUND) {
    return { airborne: false, u, period, cx: f.ax, cy: f.ay, z: 0, heading: frac(f.ax * 2.3 + f.ay * 8.7) * TAU, turn: 0, climb: 0, n: flockSize(f) };
  }
  const t = (u - U_GROUND) / (1 - U_GROUND);
  const c = circuitAt(f, t, clear);

  // ⚠ THE HEADING IS THE VELOCITY, NOT THE TANGENT TO THE CIRCLE, AND THAT COST A FLOCK THAT FLEW
  // SIDEWAYS. The circuit has TWO moving terms — the angle round it and the radius, which rides the
  // same ramp as the height — so the flock's actual course is tangential plus radial. Through the
  // climb and the descent the radial term is the bigger one (mid-climb it is about 2.6x the
  // tangential), and at the two ends the radius is zero, so the tangential part vanishes and the
  // flock is flying PERFECTLY sideways to the way it is pointed. That is 40% of every flight, and
  // it is what "they look like they're flying sideways sometimes" is.
  //
  // Differenced rather than solved, because `bump` is a min() of two smoothsteps and its derivative
  // is discontinuous at the crossover — a closed form needs a branch there, and a branch is a place
  // to be subtly wrong about the one thing this is for. Three cheap evaluations, at most ten flocks
  // a frame.
  const D = 0.004;
  const a = circuitAt(f, Math.max(0, t - D), clear), b = circuitAt(f, Math.min(1, t + D), clear);
  const vx = b.x - a.x, vy = b.y - a.y;
  // A flock that is not moving at all has no course to point along; the tangent is the honest
  // fallback rather than atan2(0, 0), which is a confident zero.
  const heading = (vx || vy) ? Math.atan2(vy, vx) : c.th + Math.PI / 2;

  // The two half-steps either side of `t`, which is what a turn RATE needs and a single centred
  // difference cannot give: the same three evaluations, read as two courses instead of one.
  //
  // ⚠ EACH HALF-STEP IS CHECKED FOR LENGTH, because `t` is clamped at both ends of the phase — at
  // t = 0 the leading sample IS the centre one, `atan2(0, 0)` is a confident zero, and the turn
  // rate comes out as whatever the other half-step happens to be, divided by D. That is a bird
  // snapping into a hard bank the instant it leaves the ground.
  //
  // ⚠ AND THE TURN IS DIFFERENCED OVER A MUCH WIDER WINDOW THAN THE HEADING, on purpose. The
  // heading wants the instantaneous course, so its window is small. The turn is read as a BANK, and
  // a bank is not instantaneous — a bird rolls into a turn over about a second, which is exactly
  // what a wide window models for free. Differenced at D like the heading, a circuit bending round
  // a building hands the renderer a bank that moves 20° in a tenth of a second; over DT it is a
  // roll. The window is a fraction of the AIRBORNE phase, so it is about a second of wall clock
  // whatever this flock's own period happens to be.
  const secs = (period * (1 - U_GROUND)) / 1000;
  const DT = Math.min(0.24, 1.15 / Math.max(1e-6, secs));
  const t0 = Math.max(0, t - DT), t1 = Math.min(1, t + DT);
  const wa = circuitAt(f, t0, clear), wb = circuitAt(f, t1, clear), wm = circuitAt(f, (t0 + t1) / 2, clear);
  const s0 = Math.hypot(wm.x - wa.x, wm.y - wa.y), s1 = Math.hypot(wb.x - wm.x, wb.y - wm.y);
  const turn = (s0 > 1e-9 && s1 > 1e-9)
    ? angDiff(Math.atan2(wb.y - wm.y, wb.x - wm.x), Math.atan2(wm.y - wa.y, wm.x - wa.x)) / (((t1 - t0) / 2) * secs)
    : 0;
  const run = Math.hypot(vx, vy);
  const climb = run > 1e-6 ? (b.z - a.z) / run : 0;

  return { airborne: true, u, t, period, z: c.z, r: c.r, cx: c.x, cy: c.y, heading, turn, climb, n: flockSize(f) };
}

/**
 * The course the flock lifts off on (`takingOff`) or touches down on, at the anchor.
 *
 * Both ends of the circuit sit exactly on the anchor tile with zero radius, so a skein there is
 * placed by its heading alone — which is what lets the renderer gather the birds into formation
 * before a take-off and spill them out of it after a landing without storing anything.
 */
export function flockEdgeHeading(f, takingOff, clear = null) {
  const D = 0.004;
  const t0 = takingOff ? 0 : 1 - D, t1 = takingOff ? D : 1;
  const a = circuitAt(f, t0, clear), b = circuitAt(f, t1, clear);
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/**
 * How alarmed a flock is by something `d` tiles away, 0..1.
 *
 * ⚠ A PURE FUNCTION OF THE CURRENT DISTANCE, with no easing and no memory. An eased startle needs a
 * previous value, a previous value needs somewhere to keep it, and somewhere to keep it needs an
 * eviction rule — for an effect that is spent entirely on how fast the birds are walking and how
 * far apart they stand. Nothing about the silhouette changes, so it costs no texture either.
 */
export const STARTLE_R = 5;
export const alarmAt = (d) => smooth((STARTLE_R - d) / STARTLE_R);

// ── THE SKEIN ─────────────────────────────────────────────────────────────────
//
// How a flock is arranged in the air. It is a V because of the vortex trailing off each wingtip: a
// bird sitting outboard of and behind its neighbour flies in rising air and saves work. What the
// measurements say about how they actually hold that is more interesting than the diagram, and all
// four of these facts are visible from the ground.
//
// ⚠ THEY SIT MORE THAN A WINGSPAN APART. Cutts & Speakman photographed 54 skeins of pink-footed
// geese from directly underneath and measured a mean WING-TIP SPACING of 16.9 cm — about a ninth of
// a span — so centre to centre is a span and a bit. A skein is a row of separate animals with sky
// between them, which is what the first version of this got wrong: at 0.075 tiles across on a
// model 0.145 wide, every bird overlapped its neighbours and the flock read as one moving lump.
//
// ⚠ AND THEY ARE BAD AT IT, DELIBERATELY. The variation in that spacing is high, and the mean sits
// OUTBOARD of the position that would save the most — they bank 14% of induced power out of a
// possible 45%, because holding station to the centimetre in moving air is not something a goose
// can do, and erring outboard is the safe side to err on. So the wander below is not noise added to
// taste: a skein that holds a lattice is the thing that looks wrong.
//
// ⚠ THE V IS RARELY A V. The J — one arm longer than the other — is at least as common, a small
// group flies a plain diagonal echelon, and a flock slides between the three as birds shuffle. The
// included angle is not a constant either: about 110-130° for small Canada goose flocks against
// ~90° for ibis, and it breathes constantly with the air.
//
// ⚠ AND THE BIRD IN FRONT IS WORKING. It gets nothing from anybody's wake, so the lead changes:
// the leader drops back into the formation and another takes the point. Measured on Canada geese,
// sharing that work is worth more than 40% of the flock's range.
//
// Sources: Cutts & Speakman 1994 (J. Exp. Biol. 189:251), Portugal et al. 2014 (Nature 505:399),
// Mirzaeinia & Hassanalian 2019/2020 on Canada goose repositioning.
//
// ⚠ ALL OF IT IS DERIVED FROM (anchor, bird index, clock) AND NONE OF IT IS STORED, which is the
// bargain this whole file makes. A flock has no memory of its own formation; it is recomputed from
// scratch every frame and comes out the same on two machines because they share a wall clock.

// The drawn model's wingtip-to-wingtip, in tiles. ⚠ STATED HERE RATHER THAN IMPORTED: this file is
// shared with the server, which has no renderer to reach into — so `fauna.mjs` asserts the two
// agree instead, because a spacing written against a model that has since been resized is a flock
// that silently goes back to being a lump.
export const GOOSE_SPAN = 0.145;
// Centre to centre across the formation, and behind. The measured wing-tip GAP is a ninth of a
// span, so centre to centre is 1.11 of one; 0.6 spans of depth is what puts the arm at about 62°
// off the axis, an included angle of 124°, which is where small goose skeins are measured.
export const SKEIN_ACROSS = GOOSE_SPAN * 1.11;
export const SKEIN_ALONG = GOOSE_SPAN * 0.60;
// How far a flock travels in a wingbeat, which is what "spatially in phase" is measured against.
// The cruise is the circuit's own: a lap of the nominal circle in the airborne share of a period.
export const GOOSE_FLAP_HZ = 1.5;
export const GOOSE_CRUISE = (TAU * GOOSE_R) / (GOOSE_PERIOD * (1 - U_GROUND) / 1000);
const FLAP_WAVELENGTH = GOOSE_CRUISE / GOOSE_FLAP_HZ;

// How far out of its slot a bird drifts, as a share of the spacing, and how long it takes about it.
// ⚠ IT GROWS DOWN THE ARM. The leader has no station to keep — it IS the station — and every bird
// behind is holding position on the one in front, so the error accumulates and the tail of a skein
// is the raggedest part of it. A flat amplitude makes the point of the V wobble, which reads as the
// whole formation being blown about rather than as birds station-keeping.
const WANDER_ACROSS = 0.34, WANDER_ALONG = 0.55, WANDER_LIFT = 0.055;
const LIFT_FLOOR = 0.22;              // tiles of altitude below which the skein comes level
const WANDER_RANK = 0.45;             // the share of the amplitude a rank-0 bird gets
const WANDER_SLOW = 0.00061, WANDER_FAST = 0.00103;   // rad/ms — a drift of seconds, never a jitter
// How much the V opens and closes, and how slowly.
const BREATHE = 0.28, BREATHE_RATE = 0.00017;
// A lead lasts about this long, and the change of places takes this share of it.
const HANDOVER_MS = 26000, HANDOVER_SWAP = 0.30;

// Which shape this flock's skein takes, and which way it leans.
//
// ⚠ PER FLOCK, NOT PER FLIGHT. A field keeps its own skein. A shape that re-rolled between flights
// would have to change during the GROUND phase, and the first half of that phase is exactly where
// the settle blend is easing the birds OUT of the formation they landed in — so they would ease out
// of a formation they never flew.
const SKEIN_FORMS = ['v', 'v', 'j', 'j', 'ech'];
export function skeinForm(f) {
  const h = frac(f.ax * 6.77 + f.ay * 2.31 + 3.1);
  // Three birds fly a line about as readily as a V; a bigger skein nearly always has a point on it.
  const form = flockSize(f) <= 3 ? (h < 0.45 ? 'ech' : 'v') : SKEIN_FORMS[Math.floor(h * SKEIN_FORMS.length)];
  return { form, lean: frac(f.ax * 1.93 + f.ay * 7.41) < 0.5 ? 1 : -1 };
}

// The slots, in PATH order: the point, down one arm, and back up the other.
//
// ⚠ THE ORDER IS THE HAND-OVER. A lead change shifts every bird one step along this list, so each
// move is to the next slot on its own arm and the two long ones are the pair that matter — the
// leader dropping back off the point, and the bird at the head of the far arm coming up to take it.
// Ordered by rank instead, the same shift would swing birds across the middle of their own
// formation, which is the one thing a skein never does.
const _slots = new Map();
function slotPath(form, n, lean) {
  const key = form + n + lean;
  const hit = _slots.get(key);
  if (hit) return hit;
  const all = [{ arm: 0, rank: 0 }];
  for (let s = 1; s < n; s++) {
    if (form === 'ech') all.push({ arm: lean, rank: s });
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
 * Where bird `i` of `n` is, and what it is doing, at `now` — in world tiles, around a flock centred
 * on (cx, cy) pointing along `heading`.
 *
 * Returns the position, how far it is above the flock's own altitude, the yaw it is holding
 * relative to the formation's course, and the offset to add to the wingbeat phase.
 *
 * ⚠ THE WINGBEAT PHASE IS PART OF THE FORMATION, NOT A PER-BIRD RANDOM. Portugal et al. filmed
 * ibises holding wingtip-path coherence: a trailing bird flaps so that its own tip traces the path
 * the leader's tip traced, which means its phase LAGS by exactly the time it takes to cover the gap
 * between them. So the offset is the depth divided by how far the flock moves in one beat, and a
 * skein comes out looking like a wave running back down the arm rather than like six birds flapping
 * to their own clocks.
 *
 * ⚠ THE OTHER HALF OF THAT PAPER IS NOT REACHABLE HERE AND IS NOT MISSING: a bird flying DIRECTLY
 * astern of another flaps in spatial ANTI-phase instead, to stay out of the downwash. No slot in a
 * V, a J or an echelon is directly astern of another one — that is the entire point of the shape —
 * so there is nothing here for the rule to apply to.
 */
export function skeinSlot(f, i, n, now, cx, cy, heading, z = 0) {
  const { form, lean } = skeinForm(f);
  const path = slotPath(form, n, lean);
  const m = path.length;

  // The V breathes. The measured included angle is not a constant and neither is this one: the
  // depth swells and shrinks while the across stays put, which walks the arm between about 108°
  // and 136° — inside the range small goose skeins are measured at.
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

  // ⚠ AND IT GOES ROUND, NEVER THROUGH. A straight line between two slots crosses whatever is
  // between them, which for the ex-leader is its entire formation. The move bows: outward when the
  // two slots are on one arm, and BACKWARD when it changes arms at the tail, which is the only
  // place a skein ever does change arms.
  if (e > 0.001 && e < 0.999) {
    const sweep = Math.hypot(bAlong - aAlong, bAcross - aAcross);
    const bow = 4 * e * (1 - e) * sweep * 0.35;
    if (aAcross * bAcross < 0) along += bow;                             // round the back
    else across += bow * ((aAcross + bAcross) >= 0 ? 1 : -1);            // out to the side
  }

  // Station-keeping. Two slow sines a side, so it drifts over seconds and never jitters, scaled by
  // how far down the arm the bird is — see WANDER_RANK.
  const p1 = frac(f.ax * 12.91 + f.ay * 7.33 + i * 3.77) * TAU;
  const p2 = frac(f.ax * 4.41 + f.ay * 19.73 + i * 8.31) * TAU;
  const p3 = frac(f.ax * 2.71 + f.ay * 11.13 + i * 5.19) * TAU;
  const rk = WANDER_RANK + (1 - WANDER_RANK) * clamp01(rank / Math.max(1, m - 1));
  const wA = WANDER_ACROSS * SKEIN_ACROSS * rk;
  across += (Math.sin(now * WANDER_SLOW + p1) * 0.6 + Math.sin(now * WANDER_FAST + p2) * 0.4) * wA;
  along += (Math.sin(now * WANDER_SLOW * 0.83 + p2) * 0.6 + Math.sin(now * WANDER_FAST * 1.21 + p3) * 0.4)
    * WANDER_ALONG * SKEIN_ALONG * rk;
  // ⚠ AND IT FLATTENS ONTO THE DECK. A skein is not coplanar in the air, and it cannot be anything
  // else near the ground: the flock's own altitude is exactly 0 at both ends of the cycle, so a bird
  // holding station a little LOW is a bird under the turf. Squeezing the offset out over the last
  // fifth of a tile is also what a real flock does on short finals — they come level to land.
  const lift = (Math.sin(now * WANDER_SLOW * 0.71 + p3) * 0.7 + Math.sin(now * WANDER_FAST * 0.91 + p1) * 0.3)
    * WANDER_LIFT * rk * clamp01(z / LIFT_FLOOR);

  // ⚠ A BIRD POINTS WHERE IT IS GOING, and where it is going is the formation's course plus its own
  // correction. Handing every bird the flock's heading is most of what makes a skein read as one
  // rigid object: six identical arrows translating together. The lateral rate is the derivative of
  // the two sines above — free, rather than differenced — over the cruise, which is the small-angle
  // answer for a shallow correction and the only kind there is here.
  const rate = (Math.cos(now * WANDER_SLOW + p1) * WANDER_SLOW * 0.6
    + Math.cos(now * WANDER_FAST + p2) * WANDER_FAST * 0.4) * wA * 1000;
  const yaw = Math.atan2(rate, GOOSE_CRUISE);

  const ch = Math.cos(heading), sh = Math.sin(heading);
  return {
    x: cx - ch * along - sh * across,
    y: cy - sh * along + ch * across,
    lift,
    yaw,
    // Minus, because a bird further back is LATER in the beat: it reaches the leader's air after
    // the leader has left it.
    beat: frac(f.ax * 5.51 + f.ay * 2.27) - along / FLAP_WAVELENGTH,
  };
}

/**
 * Every bird in an airborne flock, for a caller that has to ask about all of them at once — the
 * strike test below, and any harness measuring the shape rather than drawing it.
 */
export function skeinBirds(f, now, st) {
  const out = [];
  for (let i = 0; i < st.n; i++) out.push(skeinSlot(f, i, st.n, now, st.cx, st.cy, st.heading, st.z));
  return out;
}

// ⚠ THE STRIKE TEST ASKS ABOUT THE BIRDS, NOT ABOUT A DISC ROUND THEM, and that is the whole
// reason the formation lives in this file. A skein is mostly empty sky — spreading out is what the
// shape is FOR — so a disc sized to hold all of it charges an aircraft for flying through the gaps,
// and a disc sized to the core lets one pass clean through an arm. Now that every bird has a
// position, the honest question is whether the leg went within a wingspan of one of them, which is
// also the only version a player can argue with: you either hit a goose or you did not.
//
// ⚠ AND THE RADIUS IS THE BIRD, NOT A DIFFICULTY DIAL. Swapping one disc for six had to leave the
// balance where it was found, so it was measured rather than assumed: 1,320 minutes of continuous
// low flying at the 1.1-tiles-a-tick the old figure was taken at, over solid habitat, through both
// geometries — 529 strikes the old way against 480 this way, a ratio of 0.91. The rate the old
// whole-flock disc was tuned to (one per 5-14 min of low flying over the bay or the parks, against
// the one a MINUTE that `Math.random() < 0.05` gave with nothing in the world behind it) survives
// the change intact. Widening this by feel is how it goes back to being a dice roll with extra steps.
export const STRIKE_R = GOOSE_SPAN * 0.6;
// The furthest from its own centre a bird ever gets: the longest arm a flock this size can have, at
// the top of the breathe, with the wander and the hand-over's bow on top. Derived, because it is
// what decides which flocks are even worth asking about below, and a hand-written pad that stopped
// short of the arm would drop the strikes at the tail of every big skein.
export const SKEIN_EXTENT = (MAX_FLOCK - 1) * Math.hypot(SKEIN_ALONG * (1 + BREATHE), SKEIN_ACROSS) * 1.15;
const STRIKE_PAD = SKEIN_EXTENT + 0.2;    // how far either side of the leg to look for flocks at all

// ── Flying into them ──────────────────────────────────────────────────────────
/**
 * Did the path from (ax,ay) to (bx,by) go through an airborne flock at `now`?
 *
 * ⚠ IT LIVES HERE, NOT IN THE HAZARD THAT CALLS IT. A bird strike has to come from a flock the
 * pilot could see, and the only way to guarantee that is for the strike and the picture to be the
 * same arithmetic. A copy of this in plugins/flight would be a strike that fires over empty sky, or
 * a flock you can watch a wing pass through — the failure this whole module exists to prevent.
 *
 * ⚠ AND IT IS A SWEPT SEGMENT, NEVER A POINT. The flight tick is 3 s and an aircraft covers several
 * tiles in that time, so "is there a flock near me now" misses the one you went clean through
 * between two samples. The trucking model records the identical trap for its road signs.
 *
 * `isHabitat(wx, wy)` is the caller's own map question, exactly as `flocksNear` takes it — the
 * renderer answers it from a cell's biome and the server from a zone's terrain.
 */

const distToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
};

// ⚠ `isBlocked` IS NOT OPTIONAL FOR ANYBODY WHO DRAWS OR FLIES INTO THESE BIRDS. It is the same
// predicate `flockClearance` takes, and the circuit BENDS around what it reports — so a caller that
// leaves it out is testing against the plain circle while the windscreen paints the bent one. That
// is a strike over empty sky, and a flock you can watch a wing pass through. The default exists for
// the two callers who genuinely have no map (a bench, a fixture), not as a convenience.
export function flockOnSegment(ax, ay, bx, by, now, isHabitat, radius = STRIKE_R, density = 1, isBlocked = null) {
  if (![ax, ay, bx, by].every(Number.isFinite)) return null;
  const midX = (ax + bx) / 2, midY = (ay + by) / 2;
  const reach = Math.hypot(bx - ax, by - ay) / 2 + GOOSE_R + STRIKE_PAD;
  for (const fl of flocksNear(midX, midY, reach, density, isHabitat)) {
    const st = flockState(fl, now, flockClearance(fl, isBlocked));
    if (!st.airborne) continue;          // a goose on the grass is not in anybody's way
    // Cheap reject on the whole flock first, then the birds themselves — see the ⚠ on STRIKE_R.
    if (distToSegment(st.cx, st.cy, ax, ay, bx, by) > radius + SKEIN_EXTENT) continue;
    const birds = skeinBirds(fl, now, st);
    for (let i = 0; i < birds.length; i++) {
      if (distToSegment(birds[i].x, birds[i].y, ax, ay, bx, by) <= radius) return { ...st, anchor: fl, bird: i };
    }
  }
  return null;
}

// ── Daylight ──────────────────────────────────────────────────────────────────
/**
 * Geese are a daylight thing, as the ambient high birds already are.
 *
 * ⚠ THE TWO SURFACES ASK THIS IN DIFFERENT CLOCKS, AND THAT IS THE BEST AVAILABLE. The renderer has
 * `sky.night`, a continuous 0..1 off the real sun curve, and gates on it directly — which is the
 * more honest gate, because it is the same number that decides whether the frame is lit at all. The
 * text game has the game hour and nothing sun-shaped, so it asks here. The two can disagree by a few
 * minutes at dawn and dusk; what matters is that they cannot disagree by a whole night, which is
 * what a hard-coded hour on one side and a sun curve on the other would eventually produce.
 */
export const GOOSE_DAY_START = 6, GOOSE_DAY_END = 20;
export const gooseDaylight = (hour) => hour >= GOOSE_DAY_START && hour < GOOSE_DAY_END;
