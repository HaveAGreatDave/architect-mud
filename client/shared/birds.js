/**
 * BIRDS — where a flock is, and what it is doing, and nothing else.
 *
 * ⚠ THIS FILE WAS goose.js UNTIL IT HELD SIX SPECIES. The Canada goose was the first bird built
 * and the file took its name; the SPECIES table, the flock cycle and flockAt/flockState now answer
 * for the gull, the pigeon, the starling, the hawk and the vulture too. Renamed because a starling
 * maxFlock living in a file called goose.js is the kind of thing that reads as a mistake every
 * time somebody new finds it.
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
export function flockAt(wx, wy, density = 1, species = 'goose') {
  // ⚠ THE SPECIES ROW IS READ THROUGH A LOOKUP RATHER THAN spOf, because there is no flock yet —
  // this is the function that makes one. An unknown id falls back to the goose, same as spOf.
  const sp = SPECIES[species] || SPECIES.goose;
  const want = (areaHash(wx, wy) > sp.areaBias ? sp.dense : sp.sparse) * density;
  if (tileHash(wx, wy) >= want) return null;
  // ⚠ NO `sp` KEY AT ALL FOR A GOOSE. Every gate and harness that predates the species table
  // compares flock objects by their own shape, and a new key on every flock would change all of
  // them; a goose flock is byte-identical to the one this returned before the table existed.
  return species === 'goose' ? { ax: wx, ay: wy } : { ax: wx, ay: wy, sp: species };
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
      // ⚠ THE CALLBACK MAY ANSWER WITH A SPECIES ID INSTEAD OF true, and that is the whole of how
      // a second bird reaches this loop. Only the caller has the map, so only the caller can say
      // what lives on a tile; `true` still means a goose, so nothing written before this changed.
      const h = isHabitat ? isHabitat(wx, wy) : true;
      if (!h) continue;
      const f = flockAt(wx, wy, density, typeof h === 'string' ? h : 'goose');
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
export const flockPeriod = (f) => spOf(f).period * (0.7 + frac(f.ax * 3.7 + f.ay * 11.9) * 0.7);

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
  const baseR = spOf(f).r;
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

// Where the circuit puts the flock at `t` in [0,1] of its airborne phase. Factored out because the
// HEADING is differenced from it — see the ⚠ in flockState — and a second copy of this arithmetic
// would be a flock pointing somewhere its own position never goes.
// A SPIRAL UP A THERMAL, then a long glide off it and back.
//
// ⚠ IT IS A SECOND GENERATOR AND NOT A SECOND SET OF NUMBERS. Every other species here flies the
// same bumped circle with its own radius and ceiling; a soaring raptor does something structurally
// different — it turns tightly on the spot while climbing, then leaves in a straight line and
// comes back. No amount of retuning the circle produces that, because the circle's radius is the
// same at the top as at the bottom and a thermal's is not.
//
// ⚠ AND IT RETURNS THE SAME SHAPE circuitAt DOES, deliberately. Everything downstream — the
// heading and turn rate differenced out of successive positions, the clearance profile, the strike
// test, the settle blend — reads {x, y, z, r, th} and nothing else. Branching INSIDE circuitAt
// rather than beside flockState is what lets all of that stay untouched: it is the one function
// every consumer already goes through.
function thermalAt(f, t, sp) {
  // Two phases: climb the spiral, then glide out and back. The climb is the longer half.
  const CLIMB = 0.62;
  const turns = 3 + Math.floor(frac(f.ax * 4.4 + f.ay * 9.2) * 3);
  const th0 = frac(f.ax * 2.3 + f.ay * 8.7) * TAU;
  if (t < CLIMB) {
    const u = t / CLIMB;
    // ⚠ THE RADIUS SHRINKS AS IT CLIMBS, which is the whole shape of a thermal: the lift is
    // strongest in the core, so a bird working one spirals TIGHTER the higher it gets. A constant
    // radius is a bird flying in circles, which is a different and much duller thing.
    const r = sp.r * (1 - 0.55 * u);
    const th = th0 + turns * TAU * u;
    // Climbs fast at first and levels off at the top, the way lift falls away near the cap.
    return { x: f.ax + Math.cos(th) * r, y: f.ay + Math.sin(th) * r, z: sp.z * Math.sqrt(u), r, th };
  }
  // The glide: out along one bearing and back, losing height the whole way.
  const u = (t - CLIMB) / (1 - CLIMB);
  const out = Math.sin(u * Math.PI);              // 0 at both ends, 1 in the middle
  const bear = th0 + turns * TAU * 1.0 + frac(f.ax * 7.1 + f.ay * 1.9) * 0.9;
  const reach = sp.r * 2.6 * out;
  return {
    x: f.ax + Math.cos(bear) * reach,
    y: f.ay + Math.sin(bear) * reach,
    z: sp.z * (1 - u) * (1 - u),
    r: Math.max(0.2, reach),
    th: bear,
  };
}

function circuitAt(f, t, clear) {
  const sp = spOf(f);
  // ⚠ SELECTED BY A NUMBER ON THE ROW rather than by the species id, so the buzzard and anything
  // else that soars gets it without this function learning another name.
  if (sp.circuit === 1) {
    const c = thermalAt(f, t, sp);
    const bump = Math.min(smooth(t / RAMP_UP), smooth((1 - t) / RAMP_DN));
    // The same ramp every other circuit rides, so a thermal still starts and ends ON the anchor —
    // which is what closes the cycle and stops anything spawning or teleporting.
    return { x: f.ax + (c.x - f.ax) * bump, y: f.ay + (c.y - f.ay) * bump, z: c.z * bump, r: c.r * bump, th: c.th };
  }
  const bump = Math.min(smooth(t / RAMP_UP), smooth((1 - t) / RAMP_DN));
  const turns = 1 + Math.floor(frac(f.ax * 7.7 + f.ay * 3.1) * 2);
  const th = frac(f.ax * 2.3 + f.ay * 8.7) * TAU + turns * TAU * t;
  const r = radiusAt(clear, th, sp.r) * bump;
  return { x: f.ax + Math.cos(th) * r, y: f.ay + Math.sin(th) * r, z: sp.z * bump, r, th };
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
export const flockSize = (f, opts = null) => {
  const sp = spOf(f);
  const roll = sp.minFlock + Math.floor(frac(f.ax * 4.11 + f.ay * 9.73) * (sp.maxFlock - sp.minFlock + 1));
  return seasonalSize(sp, roll, opts);
};

// ── THE YEAR AND THE EVENING ──────────────────────────────────────────────────
//
// ⚠ OFF BY DEFAULT, AND 0 IS THIS MODULE AS IT SHIPPED. `BIRD_TUNE.season = 0` returns the
// hash-rolled size for every species at every hour of every day, which is the one number that has
// ever come out of `flockSize`. It is a mutable object rather than a constant for the reason
// `RENDER_TUNE` is: this has to be A/B-able from a bench and from the console without a rebuild,
// and a gate has to be able to assert that 0 reproduces the old answer EXACTLY rather than nearly.
//
// ⚠ AND IT LIVES HERE RATHER THAN IN `RENDER_TUNE`, because `RENDER_TUNE` is a renderer dial and
// this is not a renderer question. The server prints the same flock into the room description out
// of this same module, so a flag only the windscreen could see would be the picture and the
// sentence disagreeing about how many starlings are over the park — the exact failure this whole
// file exists to prevent.
export const BIRD_TUNE = { season: 0 };

/**
 * Day of the year, 1–366, from a `YYYY-MM-DD` game date.
 *
 * ⚠ IT TAKES THE GAME DATE AND NEVER A `Date`. Everything else in this module is derived from the
 * WALL clock, which is right for a cycle measured in seconds and wrong for one measured in months:
 * the world clock runs at `timeScale` and its calendar is the only thing that knows what month the
 * Basin is in. A wall-clock month would have the starlings roosting by the machine's own calendar
 * while the sky over them was in a different season.
 */
export function doyOf(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1;
}

const YEAR = 365.2425;

/**
 * How far into its own year this species is, 0 (the lean season) to 1 (the peak).
 *
 * ⚠ THE SHAPE IS A COSINE RAISED TO A POWER, AND THE POWER IS THE WHOLE POINT. A plain cosine is
 * symmetric, which says a starling's year has as much high season as low — and it has not: the
 * roosts are full from November to January and the birds are in breeding pairs from April to July,
 * so the peak is NARROW and the trough is BROAD. The exponent buys that asymmetry out of one term
 * rather than out of a piecewise table nobody could retune.
 *
 * ⚠ AND IT NEVER REACHES ZERO. `floor` is the decision this feature was built around: an honest
 * breeding season means no murmuration at all for a quarter of the game year, and at `timeScale` 1
 * a game year is a real year — so a player could keep this game for three months and find the
 * feature simply absent, with nothing anywhere to say it existed. The floor keeps small parties in
 * the sky all summer, which is also what the bird does: they are still there, there are just very
 * few of them together at once.
 */
export function seasonFactor(sp, doy) {
  const w = sp.season;
  if (!w || doy == null) return 1;
  const s = (1 + Math.cos(TAU * (doy - w.peak) / YEAR)) / 2;      // 1 at the peak, 0 opposite it
  return w.floor + (1 - w.floor) * Math.pow(s, w.gamma);
}

/**
 * How far into the evening gathering this species is, 0 (feeding) to 1 (over the roost).
 *
 * ⚠ A MURMURATION IS A PRE-ROOST DISPLAY AND NOT A THING BIRDS DO ALL DAY. It happens in the last
 * half-hour or so of light, over the roost, and for the rest of the day the same birds are in small
 * parties working the turf and lining the wires. That is the half of this feature a player meets
 * EVERY DAY rather than for three months a year, and it is the half that turns finding one from a
 * thing you stumble on into a thing with a time and a place.
 *
 * ⚠ THE PEAK RIDES `dayEnd` RATHER THAN BEING A SECOND LITERAL BESIDE IT. `dayEnd` is already the
 * one statement of when this species stops being about; an authored peak hour would be a second
 * copy of dusk, and the two would drift the moment the day window moved — a flock gathering an hour
 * after it had stopped being drawn, which reads as the feature doing nothing at all.
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

// The fewest birds a flock may be reduced to by the two curves above. A party of one is a bird
// rather than a flock, and everything downstream — the skein, the mill, the spacing — is arithmetic
// about a bird's place among others.
//
// ⚠ IT IS A BAND AND NOT A NUMBER, AND THAT IS A FIX RATHER THAN A FLOURISH. Clamped to a single
// floor, the curves take 450–1700 down to 0.5–2 birds on a July afternoon and every one of them
// rounds to the same value — so EVERY starling party in the world was exactly six, everywhere, for
// four months. A field of identical flocks reads as a bug and not as a lean season, which is the
// same failure the Halcyon glazing shipped with (one fixed fraction over eleven towers reads as one
// building repeated). The band is carried by the anchor's own position within its species' roll, so
// it costs nothing and a rich roost is still a bigger summer party than a thin one.
export const PARTY_FLOOR = 6, PARTY_SPREAD = 10;

/**
 * The rolled size, after the year and the evening have had their say.
 *
 * ⚠ THE ROLL IS THE CEILING AND THE CURVES ONLY EVER TAKE AWAY. That is the coupling the note on
 * `flockSize` is about: the bird-strike radius in hazards.js is derived from the DECLARED
 * `maxFlock`, so a size that could exceed the roll would let a flock outgrow the thing that flies
 * into it. Multiplying down cannot, at any setting of any curve, for any species.
 *
 * ⚠ AND THE TWO CURVES MULTIPLY RATHER THAN COMPETING. A summer evening is a small gathering and a
 * winter afternoon is a small feeding party, and both are true at once on a summer afternoon; taking
 * the stronger of the two would make midsummer dusk as busy as midwinter dusk, which deletes the
 * season from the one moment of the day anybody is looking at it.
 */
export function seasonalSize(sp, roll, opts) {
  if (!BIRD_TUNE.season || !opts) return roll;
  const f = seasonFactor(sp, opts.doy) * roostFactor(sp, opts.hour);
  if (f >= 1) return roll;
  const band = sp.maxFlock - sp.minFlock;
  const rich = band > 0 ? (roll - sp.minFlock) / band : 0;          // where this roost sits in its own band
  const least = Math.min(roll, PARTY_FLOOR + Math.round(rich * PARTY_SPREAD));
  return Math.max(least, Math.round(roll * f));
}

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
export function flockState(f, now, clear = null, opts = null) {
  const ph = frac(f.ax * 19.1 + f.ay * 5.3);
  const period = flockPeriod(f);
  const u = (((now / period) + ph) % 1 + 1) % 1;

  const uG = spOf(f).uGround;
  if (u < uG) {
    return { airborne: false, u, period, cx: f.ax, cy: f.ay, z: 0, heading: frac(f.ax * 2.3 + f.ay * 8.7) * TAU, turn: 0, climb: 0, n: flockSize(f, opts) };
  }
  const t = (u - uG) / (1 - uG);
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
  const secs = (period * (1 - spOf(f).uGround)) / 1000;
  const DT = Math.min(0.24, 1.15 / Math.max(1e-6, secs));
  const t0 = Math.max(0, t - DT), t1 = Math.min(1, t + DT);
  const wa = circuitAt(f, t0, clear), wb = circuitAt(f, t1, clear), wm = circuitAt(f, (t0 + t1) / 2, clear);
  const s0 = Math.hypot(wm.x - wa.x, wm.y - wa.y), s1 = Math.hypot(wb.x - wm.x, wb.y - wm.y);
  const turn = (s0 > 1e-9 && s1 > 1e-9)
    ? angDiff(Math.atan2(wb.y - wm.y, wb.x - wm.x), Math.atan2(wm.y - wa.y, wm.x - wa.x)) / (((t1 - t0) / 2) * secs)
    : 0;
  const run = Math.hypot(vx, vy);
  const climb = run > 1e-6 ? (b.z - a.z) / run : 0;

  return { airborne: true, u, t, period, z: c.z, r: c.r, cx: c.x, cy: c.y, heading, turn, climb, n: flockSize(f, opts) };
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
  // ⚠ THE THREE-BIRD RULE IS A SKEIN RULE AND MUST NOT REACH A SPECIES THAT HAS NO SKEIN. A gull
  // flock of three is a loose three, not a line of three; falling through to 'ech' here would give
  // the one species built to have no formation a formation whenever it happened to be small.
  const forms = spOf(f).forms;
  const form = forms.length === 1 ? forms[0]
    : flockSize(f) <= 3 ? (h < 0.45 ? 'ech' : 'v')
      : forms[Math.floor(h * forms.length)];
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
    // ⚠ 'loose' IS NOT A SHAPE, IT IS THE ABSENCE OF ONE — and it is still expressed in arms and
    // ranks, because everything downstream (the wander, the breathe, the lift, the hand-over) is
    // written against those two numbers. A gull cloud is birds scattered across BOTH arms at
    // depths that do not line up, rather than a rank per bird down one side; hashing the slot
    // index is what makes it a cloud instead of a V with jitter on it.
    //
    // ⚠ AND IT MUST NOT COLLAPSE ONTO ONE POINT. Two birds on the same arm at the same rank are
    // two birds in the same air, so the rank carries the slot index in its integer part and the
    // scatter only moves it about within that.
    if (form === 'loose') {
      // ⚠ A CLOUD IS SPACED WIDER THAN A SKEIN, NOT THE SAME SPACING WITH NOISE ON IT. Adjacent
      // ranks are SKEIN_ALONG apart, which is 0.6 of a wingspan — fine in a V, where the arms
      // diverge and pull the birds apart anyway, and two birds in the same air the moment the
      // formation stops diverging. Measured at rank step 1 the closest pair was 0.089 tiles
      // against a gull's 0.163 span. The step below is what keeps them clear.
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
  // ⚠ A LONE BIRD HAS NO PLACE IN A FORMATION, and the arithmetic below does not know that. It
  // runs without error at n = 1 — the divide is guarded — but it still applies a station-keeping
  // wander meant for a bird holding position relative to others, and puts the only bird in the
  // flock most of a tile from the centre the whole rest of the system says it is at. A solitary
  // species IS its own centre.
  if (n <= 1) return { x: cx, y: cy, lift: 0, yaw: 0, beat: 0 };
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
  // ⚠ THE WIDEST CIRCUIT, NOT THE GOOSE'S. This is the cheap reject that decides which anchors are
  // worth testing at all, so it has to bound every species that could be out there — a gull flies a
  // 5-tile circuit against a goose's 3.4, and sized on the goose it would simply never find one.
  const reach = Math.hypot(bx - ax, by - ay) / 2 + WIDEST_R + STRIKE_PAD;
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

// ── THE SPECIES TABLE ─────────────────────────────────────────────────────────
//
// Everything above this line is a goose constant that turned out to be a BIRD constant with a
// goose's numbers in it. Rather than rewrite the module around a species argument — it is imported
// by the renderer, the text game, the bird-strike path and two harnesses, and a signature change
// would be a five-file commit with the server in it — a species is a ROW, and the row travels on
// the FLOCK. `flockAt` stamps it, everything downstream reads `f.sp`, and a flock without one is
// a goose. So every existing caller keeps working untouched and none of them had to learn anything.
//
// ⚠ THE GOOSE ROW IS THE OLD CONSTANTS, EXACTLY. GOOSE_PERIOD, GOOSE_Z, GOOSE_R, U_GROUND,
// MIN_FLOCK/MAX_FLOCK, DENSE/SPARSE and GOOSE_AREA_BIAS are still exported and still what they
// were; the row points at the same numbers rather than restating them, because two spellings of
// one constant is how the picture and the sentence start disagreeing.
export const SPECIES = {
  goose: {
    id: 'goose',
    habitat: GOOSE_HABITAT,
    dense: DENSE, sparse: SPARSE, areaBias: GOOSE_AREA_BIAS,
    period: GOOSE_PERIOD, uGround: U_GROUND, z: GOOSE_Z, r: GOOSE_R,
    minFlock: MIN_FLOCK, maxFlock: MAX_FLOCK,
    // How close together they stand when they are down, centre to centre — see groundPatchR. A
    // grazing goose keeps about three metres of grass to itself, which is what makes a flock of
    // eight a spread rather than a huddle.
    groundPitch: 0.27,
    forms: SKEIN_FORMS,
    dayStart: 6, dayEnd: 20,
    // How often this flock says anything, and how much it says when it does.
    callEvery: 96000, callBurst: [2, 4], callGap: 620,
    // How far off a bird of this size is still worth drawing, in tiles.
    drawRange: 14,
  },
  gull: {
    id: 'gull',
    // ⚠ THE ONLY SPECIES THAT WANTS BOTH GROUND STATES FROM ONE TABLE, which is exactly why
    // habitat had to stop being a single shared map: a gull rafts on the bay and walks the quay,
    // and GOOSE_HABITAT could only say one thing about one ground for everybody.
    habitat: {
      water: 'raft',
      dock: 'walk', pier: 'walk', docks: 'walk',
      // Inland, and only when it is rough out — see GULL_STORM below.
      concrete: 'walk', asphalt: 'walk', citycore: 'walk', marquee: 'walk', freight: 'walk',
    },
    dense: 0.09, sparse: 0.012, areaBias: 0.38,
    // Shorter circuits, lower, and much less of the cycle spent sitting down. A gull is
    // restless where a goose is not.
    period: 55000, uGround: 0.25, z: 1.6, r: 5.0,
    minFlock: 4, maxFlock: 12,
    // ⚠ NO V. A skein is a goose thing — gulls go about in a loose cloud, and giving them a
    // formation is the single fastest way to make two species read as one bird in two colours.
    forms: ['loose'],
    dayStart: 5, dayEnd: 21,
    preyable: true,
    // Measured off the reference recording: a cry is about 104 ms and the mean silence between
    // cries in a series is 147, so a gull's calls come about a quarter-second apart. They are
    // noisier than geese and they say it faster.
    callEvery: 54000, callBurst: [3, 6], callGap: 250,
    drawRange: 13,
    groundPitch: 0.23,       // a gull on a quay stands closer than a goose on a lawn
    // Ashore, a gull stands on a parapet as readily as on the quay — a roof ridge is the same
    // flat exposed thing a harbour wall is, and it is where they go when the tide is wrong.
    perch: { share: 0.42 },
  },

  // The feral pigeon. The city bird, and the only one of the three that is never on grass or
  // water — it lives on pavement, which is a ground the other two only reach in a storm.
  pigeon: {
    id: 'pigeon',
    // ⚠ NOT ON THE ROAD, AND THAT IS THE RENDERER'S RULE RATHER THAN THIS TABLE'S. The habitat
    // callback in windshield.js already refuses a tile with a carriageway on it, so what these
    // grounds resolve to in practice is the pavement, the plaza and the yard — which is where
    // pigeons actually crowd. A pigeon standing in the middle of the road would be a pigeon about
    // to be a problem for the traffic model.
    habitat: {
      concrete: 'walk', asphalt: 'walk', citycore: 'walk', marquee: 'walk',
      freight: 'walk', civic: 'walk', uptown: 'walk',
    },
    // Denser than either of the others: a city has far more pigeons than a bay has gulls.
    // ⚠ NOT AS DENSE AS A REAL CITY'S, and deliberately. Pigeons are the most numerous bird here
    // by a wide margin and they live on the ground the game is most expensive to draw, so the
    // number that matters is not how many a square holds but how many the frame can carry. See
    // BIRD_FACE_BUDGET in windshield.js for what that measured out at.
    dense: 0.05, sparse: 0.012, areaBias: 0.34,
    street: true,             // stands in the road, and can therefore perch on what lines it
    // ⚠ MOSTLY ON THE GROUND, AND UP OFTEN. A pigeon's whole cycle is the flush — up, a couple of
    // tight circuits, down again almost where it started — so the period is short and nearly four
    // fifths of it is spent walking about. That shape is what makes a passing truck look like the
    // cause of something the birds were going to do anyway.
    period: 27000, uGround: 0.78, z: 0.9, r: 1.6,
    minFlock: 4, maxFlock: 10,
    forms: ['loose'],
    dayStart: 6, dayEnd: 20,
    // A coo is slow, low and occasional — nothing like a gull's series.
    callEvery: 82000, callBurst: [2, 3], callGap: 950,
    // ⚠ MUCH SHORTER, AND IT IS NOT A BUDGET DODGE — a pigeon is a third of a goose and half a
    // gull, so at ten tiles it is already sub-pixel and drawing it there is spending a frame on
    // something nobody can see. It is also what stopped this species doubling the frame: pigeons
    // live on citycore, which is most of Coldwater, sixteen to a flock, and framecost went +112%
    // the moment they landed. The face budget caps the MESH; on the 2-D fallback every bird still
    // paints, and that path is what framecost measures.
    drawRange: 7,
    preyable: true,
    groundPitch: 0.10,       // pigeons crowd: half a metre apart on a pavement is normal
    // ⚠ THE HIGHEST SHARE IN THE TABLE, because the ledge is this animal's own word. A feral
    // pigeon is a cliff bird that took to cornices; the pavement is where it feeds and the ledge
    // is where it lives, so more than half of every ground phase is spent up on something.
    perch: { share: 0.55 },
  },

  // The songbird. Modelled on a starling, because a starling is what murmurates — and because the
  // speckles finally give the existing `patches` field a job that is anatomy rather than decoration.
  //
  // ⚠ THE ONLY SPECIES HERE THAT IS HEARD FURTHER THAN IT IS SEEN, and two numbers say so: the
  // shortest draw range in the table, because a bird this size is sub-pixel past a few tiles, and a
  // call range in windshield.js deliberately NOT shortened to match. At first light you hear them
  // across the park and never see one, which is the whole point of the species.
  songbird: {
    id: 'songbird',
    habitat: {
      grass: 'walk', parkland: 'walk', park: 'walk', forest: 'walk',
      // and the town, where a starling is at least as common as in a field
      citycore: 'walk', concrete: 'walk', uptown: 'walk', civic: 'walk',
    },
    dense: 0.06, sparse: 0.014, areaBias: 0.4,
    street: true,             // a starling is a city bird before it is anything else
    // Short restless cycles and a lot of time in the air — the opposite of a goose.
    //
    // ⚠ THE CIRCUIT IS SMALL AND SLOW, AND FOR THIS SPECIES THAT IS A CORRECTNESS INVARIANT RATHER
    // THAN A LOOK. Every other flock in this file is DERIVED from the circuit, so the circuit's
    // speed IS the flock's speed and nothing reads it twice. A murmuration is the one flock that is
    // SIMULATED on top of it: murmur() pulls every bird toward its own fixed station on the path
    // this centre has just flown, and that pull is quadratic in how far behind the bird has fallen
    // (`0.25 + over * over * 3`, against wHome 4.5, the strongest weight in that file). A bird's
    // velocity is renormalised to a fixed cruise every step, so once the home term dominates, every
    // bird's direction IS the direction to its own station — and the stations are fixed, so the
    // cloud stops being a cloud and becomes a rigid formation being towed. Separation, alignment
    // and cohesion are still computed every frame and can no longer be seen.
    //
    // It is purely the RATIO of centre speed to cruise. Measured over 120 birds and 14 s, as the
    // share of a bird's per-frame motion that is relative to the flock rather than shared with it
    // (1 = free jostling, 0 = a rigid body):
    //
    //     ratio  0.2   0.4   0.5   0.6   0.7   0.8   0.9   1.0
    //     share  0.95  0.75  0.76  0.65  0.51  0.39  0.23  0.10
    //
    // — the same curve at cruise 1.0 and at 1.4, so the absolute speeds do not matter and only this
    // ratio does. At `r: 2.4` over a 34 s period the centre's mean speed ran from 0.72 to 2.40
    // tiles/s across anchors, against a 1.4 cruise: ratios of 0.5 to 1.7, straddling the collapse.
    // That is why some flocks jostled and others moved as one object — the circuit is a pure
    // function of the anchor tile, so a given roost was always one or always the other, for ever.
    //
    // ⚠ AND IT IS THE SAME NUMBER THAT MADE THEM LOOK TOO FAST. 2.40 tiles/s is 26 m/s at 11 m to
    // the tile: nearly twice a starling's own cruise, and faster than the agitation wave that is
    // supposed to outrun the birds (WAVE_SPEED 1.21 = the measured 13.4 m/s). A murmuration MILLS
    // over its roost; it does not tour. The radius is what says so, and the longer period is what
    // stops the small circuit simply being flown round faster.
    period: 58000, uGround: 0.55, z: 1.4, r: 1.0,
    // ⚠ BIG FLOCKS, WHICH IS THE WHOLE REASON THIS SPECIES EXISTS. A murmuration of six is a
    // sentence with no subject. The budget share below is what stops that being a problem.
    // ⚠ AND THE SIZE IS SET BY THE SHARE, not the other way round. At 26 a flock is 1,040 faces
    // against its own 840 cap — and because a flock is charged WHOLE (half a skein reads as a
    // rendering fault, not as a budget), it would not have been rejected gracefully, it would
    // simply never have drawn. Twenty is what the share buys.
    minFlock: 450, maxFlock: 1700,
    // ⚠ AND THE CEILING IS SET BY THE BOIDS STEP AND THE WORLD TRANSFORM. murmur() finds each bird's
    // nearest neighbours by scanning all the others, so it is invisible to
    // every face count in the game. It USED to cost 0.54 ms at sixty and 16.3 ms at three hundred,
    // because it sorted every pair to read seven of them; selecting instead made it 7-17× cheaper
    // and moved the ceiling from sixty birds to two hundred. Measured whole, per frame, at 200:
    // ⚠ THE CEILING IS SET IN A BUILT-UP FRAME, AND THIS NUMBER SURVIVED ONE ROUND OF BEING
    // WRONG IN BOTH DIRECTIONS. Measured first over open forest, 1,172 birds cost 3.2 ms and 1200
    // looked free. Re-measured over a city block the same flock appeared to cost SEVENTEEN, which
    // sent it down to three hundred. Profiled, that seventeen was mostly NOISE: the scene own frame
    // wanders several ms run to run, and an A/B taken across two warm-ups reads that wander as the
    // subject. With the profiler on the same scene, the fauna pass end to end is 1.89 ms and the
    // frame delta is +2.5.
    //
    // ⚠ THE LESSON IS THE HARNESS, NOT THE BIRDS. A frame-time A/B in a scene this noisy is not
    // evidence unless the two halves are interleaved AND the phase is measured directly; the
    // renderer own profiler (__wsProfile) answers it in one run and was the thing that settled it.
    // boids 0.61 ms at three hundred on the grid, and the world transform is no longer paid past the dot
    // distance — see faunaDot. A 292-bird murmuration measured 6.2 ms of frame before that LOD and
    // 0.2 ms after it, so what bounds this now is the O(n²) neighbour search and nothing else.
    // The faces are what had to move to allow it: 300 × 55 = 16,500 against the 16,800 the GL
    // share now buys, and 'fauna.mjs' is what will notice when that headroom is spent.
    // ⚠ THINNABLE, WHICH A SKEIN IS NOT. A flock that does not fit the budget is skipped WHOLE,
    // because a skein with its back three birds missing reads as a rendering fault rather than as
    // a budget. A murmuration has no form to break — it is a cloud, and a smaller cloud is a
    // smaller cloud — so this one may be drawn short instead of dropped, which is what keeps it on
    // the canvas path where sixty birds could never fit. The number is the fewest it may be thinned
    // to: below about sixteen it stops reading as a murmuration and should not be drawn at all.
    // ⚠ AND THE FLOOR MUST ITSELF FIT THE SMALLEST BUDGET, or thinning does nothing: the loop
    // drops any flock whose cost still exceeds the cap, so a floor of 16 × 55 = 880 against the
    // canvas painter's 840 meant the canvas got NO murmuration at all while the gate's note
    // cheerfully said 'thinned to 16'. Fifteen is what 840 buys.
    thin: 15,
    forms: ['loose'],
    dayStart: 5, dayEnd: 21,
    callEvery: 70000, callBurst: [3, 6], callGap: 420,
    // ⚠ PEAK BEFORE SUNRISE, NOT AT IT. The first singers are up about an hour ahead of the sun,
    // and the chorus being loudest while it is still dark is the part worth reproducing.
    song: { peak: 5.2, span: 3.4, boost: 9 },
    // ⚠ THE ONLY SPECIES WITH A YEAR, AND THAT IS THE DESIGN RATHER THAN A FIRST INSTALMENT. The
    // other five are resident and go about in the same small parties in February as in August; the
    // starling is the one whose flock size swings by two orders of magnitude between its breeding
    // season and its winter roost, and the murmuration is a thing that happens at one end of that
    // swing. Giving the goose a `season` row would be authoring a phenomenon it does not have.
    //
    // Peak at the turn of the year and a broad lean season: the roosts are full from November to
    // January, swollen by continental birds, and from April to July the same starlings are
    // territorial pairs at a nest hole. `floor` is why a summer park still has starlings in it.
    season: { peak: 8, gamma: 1.7, floor: 0.06 },
    // The pre-roost gathering, in the last hour of light. `lead` is how long before `dayEnd` it
    // peaks and `span` how wide the swell is either side; `floor` is the rest of the day, when a
    // starling is in a feeding party of a few dozen at most and there is no display at all.
    roost: { lead: 0.7, span: 1.1, floor: 0.02 },
    drawRange: 6,
    // ⚠ A GOOSE IS NOT ON THIS LIST, and that is the fiction rather than an oversight: a hawk does
    // not take a bird several times its own weight. Gulls, pigeons and songbirds are all plausible
    // prey and all three are marked.
    preyable: true,
    // ⚠ AT MOST THIS SHARE OF THE ONE FACE BUDGET — see BIRD_FACE_BUDGET in windshield.js. A
    // murmuration is twenty-odd birds and would otherwise take the whole allowance, so a park with
    // geese in it would go empty whenever a starling cloud was up nearby. This is a SHARE of the
    // single total rather than a budget of its own: separate budgets that each look reasonable are
    // how five species each independently "bounded" add up to something nothing bounds.
    budgetShare: 0.6,
    // ⚠ THE SMALLEST PITCH THAT IS NOT A KNOT, AND THE SPECIES THIS WHOLE DERIVATION IS FOR. A
    // murmuration is hundreds of birds; at the old fixed radius all of them stood inside two thirds
    // of a tile. Starlings feeding on turf work a few feet apart, so the flock covers a field.
    groundPitch: 0.09,
    // Starlings line a parapet, a wire and a gutter before they go up, and come back to the same
    // one after. The pre-roost gathering is most of what anybody has ever watched them do.
    perch: { share: 0.5 },
  },

  // The hawk. Solitary, high, and the only bird here that is dangerous to the others.
  //
  // ⚠ minFlock === maxFlock === 1 IS A REAL CASE THIS MODULE HAS TO HANDLE, not a degenerate one.
  // The skein, the hand-over, the wingbeat phase lag and the station-keeping wander are all
  // arithmetic about a bird's place among others, and at n = 1 they run without error and produce
  // nonsense — a lone bird most of a tile from its own flock centre. See the guard at the top of
  // skeinSlot; everything else collapses harmlessly and is left alone.
  hawk: {
    id: 'hawk',
    habitat: {
      grass: 'walk', parkland: 'walk', park: 'walk', forest: 'walk',
      redrock: 'walk', scrub: 'walk', hardpan: 'walk',
      // and over the city, which is where the pigeons are
      citycore: 'walk', concrete: 'walk', uptown: 'walk',
    },
    // ⚠ AN ORDER OF MAGNITUDE RARER THAN ANYTHING ELSE, and it has to be: one bird per flock is
    // not one bird per field. At the goose's density the sky would be full of hawks, which is both
    // wrong and would make the thing they do to other birds routine.
    dense: 0.004, sparse: 0.0009, areaBias: 0.5,
    // Long, high and slow — a thermal is a patient way to get about.
    period: 150000, uGround: 0.18, z: 3.6, r: 1.9,
    minFlock: 1, maxFlock: 1,
    forms: ['loose'],
    circuit: 1,               // the spiral, not the circle
    // Thermals need sun. A hawk circling at first light is wrong.
    dayStart: 8, dayEnd: 18,
    // It barely calls, and when it does it is once.
    callEvery: 190000, callBurst: [1, 2], callGap: 1400,
    drawRange: 16,            // long: it is big and it is high up (the vulture goes further)
    // ⚠ HIGH, AND THAT IS THE HUNT RATHER THAN A PREFERENCE — see PERCH_STOOP_AT. An accipiter
    // is a still-hunter: it takes the best view it can find over ground that holds prey and goes
    // from there. `high` is what makes it pick the top setback of a tower over a shop parapet.
    perch: { share: 0.7, high: true },
  },

  // The vulture. The other half of the hawk, and deliberately its opposite in the one way that
  // matters: a hawk is a thing you watch pass over, and this is a thing you walk up to.
  //
  // ⚠ NAMED 'vulture' AND NEVER 'buzzard'. `buzzard` is already a building_type in this codebase —
  // Buzzard Field, the Reach's hangar, with a static `perchBird` silhouette on its ridge — and the
  // two would share a word in every grep for the rest of the project's life. The field is still
  // named after these; they simply are not named after it.
  //
  // ⚠ AND IT NEEDS NO NEW CIRCUIT, WHICH IS THE WHOLE REASON IT IS CHEAP. The hawk earned
  // `thermalAt` because a spiral that tightens as it climbs is structurally different from a
  // circle and no retuning produces one. Circle high, come down, feed, go back up is the circuit
  // every other species here already flies — the ANCHOR IS THE BODY, and the ground phase is the
  // meal. What is new is two numbers and a tight ground cluster.
  vulture: {
    id: 'vulture',
    habitat: {
      // The wastes, the dead ground, and the long road — and NOT one square of the green country
      // or the city. That is the split from the hawk and it is the whole species: a hawk hunts
      // over grass, parkland and rooftops, and this works the places where a thing that dies is
      // not found by anybody. `scrub` is the key that matters — it is the Reach (355 of its 391
      // tiles) AND one of the four terrains the void corridor rolls for its verge, so the two
      // places you actually see them are reached by one authored word.
      scrub: 'walk', ash: 'walk', deadwood: 'walk', basalt: 'walk', sinter: 'walk',
      redrock: 'walk', hardpan: 'walk', gravel: 'walk', plateau: 'walk', dirt: 'walk',
    },
    // Rarer than anything but the hawk, and for the same reason turned the other way up: a flock
    // is several birds, so the same density buys four times as many animals.
    dense: 0.006, sparse: 0.002, areaBias: 0.45,
    // The longest cycle, the highest ceiling and the widest circle in the table. A bird that does
    // this for a living is in no hurry about any of it.
    period: 210000, uGround: 0.42, z: 4.4, r: 3.2,
    // ⚠ THE LARGEST GROUND SHARE OF ANY SPECIES HERE, and that is the design rather than a tuning
    // choice: everything else touches down between flights, and this comes down TO something. If
    // the ground phase is short the species is a hawk with more birds in it.
    minFlock: 3, maxFlock: 7,
    forms: ['loose'],
    // ⚠ A KNOT, NOT A FLOCK IN A FIELD. Geese spread out because each one is finding its own food;
    // scavengers converge because there is ONE thing and they are all on it. This is the only
    // authored statement that there is a body there at all — no carcass is modelled, and it does
    // not need to be, because several birds crowded onto one spot in open waste reads as a kill
    // and nothing else does.
    groundSpread: 0.09,
    // ⚠ AND THE PITCH SAYS IT AGAIN IN THE UNITS THE PATCH IS DERIVED FROM. groundSpread bounds
    // how far ONE bird paces; what decides how far apart the birds STAND is this, and a knot that
    // kept the default would have spread out the moment the patch started scaling with the count.
    // At three to seven birds it reproduces the radius this species already had.
    groundPitch: 0.06,
    // Thermals, exactly as the hawk. A vulture flaps as little as it can get away with.
    dayStart: 8, dayEnd: 18,
    // ⚠ IT HAS NO SYRINX AND CANNOT CALL AT ALL — see BIRD_VOICES. What it does is hiss, and only
    // at each other over the body, which is why the rate is the lowest here and the burst is short.
    callEvery: 240000, callBurst: [1, 3], callGap: 700,
    drawRange: 18,            // the longest in the table: high, and a two-metre span
    budgetShare: 0.35,
    // A roost is a high dead thing — a snag, a mast, a water tower — and out where these live
    // there is usually nothing to stand on, so this mostly resolves to the ground and is right
    // when it does. It matters at the Reach, which is the one place they overlap with a roofline.
    perch: { share: 0.3, high: true },
    // ⚠ THE WING IS ONE TONE ON PURPOSE, and the next person to look at a turkey vulture will want
    // to change that. The real bird's field mark is a dark leading edge and a SILVER TRAILING HALF
    // — and it is on the UNDERSIDE, which is the one angle this renderer almost never shows: a
    // pilot and a driver both look down on a soaring bird, and the upper surface of a turkey
    // vulture is uniformly dark brown-black, which is what the model draws.
    //
    // It is also not expressible. There is one `wing` colour and no covert role — deliberately, see
    // the note in fauna3d.js — so a two-tone wing would need a new palette entry, a new schema
    // field and a new field on every future species, to say something visible from underneath a
    // bird nobody flies underneath. `primaryCol` is set paler than the body and measures 3.4% of
    // the projected area: the six separated fingertips, which is a pale fringe on the wingtip at
    // range and is all this vocabulary can honestly say.
  },
};

// Which grounds only hold gulls when the weather has driven them off the sea.
//
// ⚠ AND IT KEYS ON THE HEADLINE WEATHER, NEVER A LOCAL SAMPLE. The server reads the weather field
// authoritatively; the client gets a snapshot and ADVECTS IT ITSELF between packets, so the two
// are designed to look alike rather than to be equal. A bird gated on a per-cell precip reading
// would drift between the room description and the picture. The day-level headline is one value
// per tick and both sides get the same one — so it arrives here as an argument, exactly the way
// `hour` already does, and this module goes on knowing nothing about the weather system.
const GULL_INLAND = new Set(['concrete', 'asphalt', 'citycore', 'marquee', 'freight']);

// ⚠ THE WEATHER ARRIVES AS A NAME, NOT A NUMBER, because a name is what both surfaces actually
// hold. The server can compute a 0..1 severity from its own field; the client is sent the day's
// headline `weather` string and nothing else, so a numeric threshold here would be a number one
// side had to invent. These are the rough half of WEATHER_TYPES, and a gull comes ashore for them.
//
// ⚠ AND IT IS PRE-EMPTIVE IN THE FICTION RATHER THAN IN THE CODE. Gulls move inland BEFORE a gale
// because they feel the pressure drop — but a forecast is a different value on a different clock,
// and reading one here would be a second weather source to disagree with the first. The headline
// already turns over before the worst of it, so they arrive early enough to read as a warning
// without this module learning what a forecast is.
export const GULL_WEATHER = new Set(['rain', 'sleet', 'thunderstorm', 'storm', 'snow', 'blizzard']);
export const gullsAshore = (weather) => GULL_WEATHER.has(weather);

// ⚠ DERIVED FROM THE TABLE, BECAUSE A HAND-WRITTEN COPY OF IT IS A SPECIES THAT DOES NOT EXIST.
// This was a literal list, and the vulture was fully authored — a row, a model, a bake, a voice,
// prose and a gate — and lived nowhere in the world, because the one place that decides WHICH
// GROUND HOLDS WHAT never heard of it. Nothing failed: `speciesAt` answered null on every terrain
// it owned and hawk on the three it shares, which is a completely legitimate-looking answer.
//
// It is the same shape as the four two-list bugs recorded in CLAUDE.md, one layer down: prose says
// "the species table", two things are the species table, and the weaker one is the one that
// decides. The hawk's own arrival must have hit this and fixed it by adding a name, which leaves
// the trap armed for the next species instead of removing it.
//
// ⚠ AND THE ORDER IS LOAD-BEARING, so this is a derivation rather than a sort. The co-tenant hash
// indexes into this list, so changing the order changes which bird is on which shared tile across
// the whole world. Object.keys gives insertion order, which reproduces the old literal exactly —
// verified tile by tile over every shared ground before the change went in, not assumed.
// ── WHAT KIND OF PLACE IS THIS ────────────────────────────────────────────────
//
// ⚠ THE GROUND TINT IS NOT THE PLACE, AND THAT CONFUSION IS WHY THREE SPECIES HAD NO HOME.
// `biomeOf` answers "what colour is this ground" for the flight sim, and its first line is
// "authored terrain wins" — so Coldwater's streets, which are painted `redrock`, derive the
// redrock biome. The city birds' habitat keys (`citycore`, `docks`, `uptown`) are things that
// derivation can never produce here: measured over the whole world, the pigeon got ONE flock and
// the gull could only ever raft, because no tile is painted `dock`.
//
// ⚠ AND THE OBVIOUS FIX IS WORSE. Letting the district rule outrank the paint sends all 4,231
// Coldwater tiles to `badlands`, because the zone ids stopped matching districtBiome's prefix
// list long ago. That would repaint the city as desert to fix the birds.
//
// A place is STRUCTURAL, and the structure is in the map already:
//   the city is where the buildings are · the dock is the water's edge in the city · parks are
//   parks wherever they sit.
// So this takes the two facts a caller can see about a tile's NEIGHBOURS and answers what sort of
// place it is. It is the `speciesAt` arrangement exactly: only the caller has the map, so only the
// caller can count buildings — the windshield reads its own map window, the text game reads its own
// grid index, and the RULE is here, once, so the two cannot drift.
//
// ⚠ A PARK IN THE CITY IS STILL A PARK. 183 of Coldwater's 209 green tiles are inside the built-up
// area, so "buildings nearby ⇒ citycore" would delete the songbird's only real habitat in the same
// move that gave the pigeon one. Green ground keeps its own answer.
// ⚠ AND WATER IS STILL WATER — a bay tile with a warehouse on the bank is somewhere a gull rafts,
// not somewhere it stands.
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

const SPECIES_ORDER = Object.keys(SPECIES);

/**
 * Which species lives on this ground, or null.
 *
 * `opts.weather` is the day's headline weather name. Omitted, it is calm — which is the right
 * default for every caller that has not got one yet, because it means the inland grounds simply
 * do not answer and no existing behaviour changes.
 *
 * ⚠ THE TILE PICKS BETWEEN CO-TENANTS, NOT A PRIORITY ORDER. Geese and gulls both use open water;
 * ranking them puts every bay bird in the world into whichever came first in this list. Hashing on
 * the tile gives a bay with both on it, and gives the same answer on both surfaces.
 */
export function speciesAt(ground, wx, wy, opts = {}) {
  const rough = gullsAshore(opts.weather);
  const live = [];
  for (const id of SPECIES_ORDER) {
    const sp = SPECIES[id];
    if (!sp.habitat[ground]) continue;
    // ⚠ A ROAD IS HABITAT FOR A STREET BIRD AND FOR NOTHING ELSE. The renderer used to refuse
    // every road tile outright, which is right for a goose and wrong for a pigeon -- and it had
    // a second consequence nobody was looking for: a flock perches on a building among its own
    // EIGHT NEIGHBOURS, and downtown Coldwater is so solidly road-and-building that there was
    // nowhere for a flock to stand next to a tower. Measured on the baked city, 34 of 417
    // buildings could host a perching flock; every hawk, gull and vulture in the world sat on
    // the ground, and The Meridian -- 21 ledges across nine heights -- had no flock within
    // three tiles of it.
    // ⚠ AND A PATH THROUGH A PARK IS NOT A STREET. placeOf keeps green ground as itself, so
    // the built answers are the only ones a street bird may take a road on -- a park path and a
    // towpath stay refused, which is the rule the bt/road guard was carrying and the only part of
    // it worth keeping.
    if (opts.road && (!sp.street || GREEN_GROUND.has(ground))) continue;
    if (id === 'gull' && GULL_INLAND.has(ground) && !rough) continue;
    live.push(id);
  }
  if (!live.length) return null;
  if (live.length === 1) return live[0];
  return live[Math.floor(frac(wx * 13.77 + wy * 91.31 + 5.5) * live.length) % live.length];
}

/** What a given species DOES on a given ground: 'walk', 'raft', or null if it is not there. */
export const habitatState = (id, ground) => (SPECIES[id] || SPECIES.goose).habitat[ground] || null;

/** The row a flock belongs to. A flock with no species on it is a goose, which is what every
 *  caller that predates the table produces. */
export const spOf = (f) => (f && SPECIES[f.sp]) || SPECIES.goose;

/**
 * Is this species about at this hour?
 *
 * ⚠ IT TAKES THE HOUR RATHER THAN READING A SUN, for the reason gooseDaylight already gives: the
 * renderer has a sun curve and the text game has a game hour, and the two can differ by a few
 * minutes at dawn without ever differing by a whole night. A gull is up earlier and stays out
 * later than a goose, which is a real difference and the kind of thing the table exists for.
 */
// What each formation is CALLED, beside the list of formations itself.
//
// ⚠ IT LIVES HERE RATHER THAN IN THE PROSE, so that a species cannot be given a formation that has
// no word for it. describe.js imports this; when the word sat over there, adding 'loose' to a
// species row and adding a sentence for it were two edits in two files with nothing connecting
// them, and the failure mode is a room that says "undefined" at a player.
export const FORM_WORDS = {
  v: 'a loose V',
  j: 'a lopsided V, one arm longer than the other',
  ech: 'one long ragged line',
  // ⚠ A GULL SKEIN IS NOT A SHAPE, and the word has to admit that rather than borrowing one.
  loose: 'no shape at all, just a lot of them going the same way',
};

// ── WHEN A FLOCK CALLS ────────────────────────────────────────────────────────
//
// ⚠ BIRD SOUND IS RARE ON PURPOSE, and this is the half of that which is a fact about the birds
// rather than about the mixer. It is derived the way everything else in this file is — anchor and
// clock, nothing stored — so the same flock calls at the same instants on every machine, and the
// renderer never has to be told.
//
// ⚠ AND IT IS BURSTS SEPARATED BY SILENCE, NEVER AN EVEN TRICKLE. A flock says three or four
// things in a second and a half and then shuts up for most of a minute. That is what geese and
// gulls actually do, and it is also the only version that stays an EVENT: calls at the same low
// AVERAGE rate, evenly spaced, are heard as background inside about a minute, and background is
// exactly the fatigue this exists to avoid.
//
// ⚠ THE PLAYBACK BUDGET IS NOT HERE. How many calls may be HEARD at once, across every species, is
// a property of the listener and belongs with whatever is doing the listening — see the call
// limiter in windshield.js. This function answers what the flock DID, which is a different
// question from what you get to hear, and collapsing the two would put a mixer rule inside the
// shared world model, where the text game would also have to obey it.
const CALL_JITTER = 0.34;          // how much the silence between bursts varies, per flock

// ⚠ SOME BIRDS ARE LOUDEST AT A TIME OF DAY, AND THAT IS A RATE RATHER THAN A GATE. The day window
// answers whether a species is about at all; this answers how much it has to say while it is. The
// dawn chorus is the case it exists for: the first singers start about an hour before sunrise and
// have largely stopped by mid-morning — so a songbird is not a bird you see, it is a bird you hear
// early and stop hearing, which is a thing a player can learn to tell the time by.
//
// ⚠ IT TAKES THE HOUR AS AN ARGUMENT, exactly as the day window does, and for the reason the note
// on gooseDaylight gives: the renderer has a sun curve and the text game has a game hour, and the
// two may differ by minutes without ever differing by a night. A species with no song window
// ignores the argument entirely, which is why the other three are untouched.
function songFactor(sp, hour) {
  const w = sp.song;
  if (!w || hour == null) return 1;
  // Wrapped, so a window straddling midnight is not a case anybody has to remember.
  let d = Math.abs(hour - w.peak);
  if (d > 12) d = 24 - d;
  if (d >= w.span) return 1;
  const t = 1 - d / w.span;
  // Smooth, so the chorus swells and fades rather than switching on at the edge of the window.
  return 1 / (1 + (w.boost - 1) * t * t);
}

/**
 * Every call this flock makes in the window (fromMs, toMs]. Usually none.
 *
 * Each entry carries its position within the burst, so a caller can make the first cry of a
 * series carry further than the ones chasing it.
 */
export function callsIn(f, fromMs, toMs, opts = {}) {
  if (!(toMs > fromMs)) return [];
  const sp = spOf(f);
  // ⚠ A LONG WINDOW IS A DROPPED WINDOW, NOT A QUEUED ONE. A hidden tab, a stall or a debugger
  // pause hands this a gap of minutes, and answering it honestly would be a minute of birds
  // arriving at once the instant the frame resumes. What was missed is missed — the footstep
  // rule, for the footstep reason.
  if (toMs - fromMs > 1500) fromMs = toMs - 1500;
  const every = sp.callEvery * (0.72 + frac(f.ax * 5.31 + f.ay * 2.77) * (2 * CALL_JITTER))
    * songFactor(sp, opts.hour);
  const phase = frac(f.ax * 8.17 + f.ay * 13.9);
  const out = [];
  // Only the bursts either side of the window can contribute, so this is three candidates rather
  // than a search — the same reason nothing else in this file keeps a list.
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

// ── PERCHING ──────────────────────────────────────────────────────────────────
//
// A bird on the ground and a bird on a parapet are the same STATE — stationary, milling, startled
// by what comes near, takeable by a hawk — at two different heights. So this is not a third branch
// of the cycle, it is the ground phase with somewhere else to stand, and `flockState` is untouched.
//
// ⚠ THIS MODULE SAYS WHETHER, AND THE CALLER SAYS WHERE. A ledge is a property of a BUILDING MODEL
// — the setbacks a captured shape happens to have, which only GLASS knows — and this file has never
// been allowed to know what a building is. It is the `flocksNear(…, isHabitat)` and
// `hawkStoop(…, near)` arrangement exactly: only the caller has the map, so only the caller can
// find a ledge, and the RULE lives here once so the renderer and the room cannot drift apart.
//
// ⚠ AND A FLOCK THAT WANTS A LEDGE WITH NOTHING TO STAND ON IS SIMPLY ON THE GROUND. That is what
// makes this safe everywhere: over a field, a bay or the open waste the answer is still yes and
// there is no ledge to be had, so not one thing about those places changes.
//
// ── WHERE A LANDED FLOCK STANDS ───────────────────────────────────────────────
//
// ⚠ A PATCH, NOT A POINT, AND THE PATCH GROWS WITH THE FLOCK. The ground placement was one mill
// per bird — a slow figure inside a fixed radius, every bird on its own phase inside the SAME
// radius — so the area a flock covered was a property of the species and nothing else. That is
// survivable at six geese and it is not a flock at all at five hundred starlings: a murmuration
// coming down put every bird inside a 0.68-tile circle, which is twenty metres of birds in seven
// metres of ground, and it reads exactly as it was reported — the whole flock crowding one tile.
//
// So a bird gets a STATION — its own place in the patch, hashed once and fixed for as long as the
// flock is down — and mills about that. The patch is sized so that every bird has the same standing
// room whatever the count: n birds at `groundPitch` centres is `n · pitch²` of ground, and the
// radius of that much ground is `pitch · sqrt(n / π)`. So a flock of six covers what six birds
// cover and a flock of five hundred covers a field, with one number per species saying how close
// together they stand.
//
// ⚠ AND THE KNOT SURVIVES IT. The vulture's whole statement is that several birds are crowded onto
// one thing — see `groundSpread` on its row — and a patch that grows with the count would have
// spread the one species that must not spread. It says so with the PITCH instead (0.06 against a
// goose's 0.27), which is the same sentence in the units this now derives from: at its own flock
// sizes it lands within a hair of the radius it had before, and it stays a knot at any count.
//
// ⚠ NOTHING IS STORED, exactly as everywhere else in this file. A station is a hash of (anchor,
// bird index), so it survives a reload, a map-window recentre and the settle blend that eases the
// birds out of the formation they landed in — which is the one thing the take-off reads.
const GROUND_PITCH_DEFAULT = 0.27;

/** How far out the edge of a landed flock's patch is, in tiles. */
export function groundPatchR(f, n) {
  const pitch = spOf(f).groundPitch ?? GROUND_PITCH_DEFAULT;
  return pitch * Math.sqrt(Math.max(1, n) / Math.PI);
}

/**
 * How far one bird wanders about its own station.
 *
 * ⚠ BOUNDED BY THE PITCH, NOT BY THE PATCH. A mill as wide as the patch is every bird walking
 * through every other bird's station, which is the crowd this replaced with extra steps. Half the
 * spacing is as far as a bird can drift and still be recognisably in its own place.
 */
export function groundMill(f) {
  const sp = spOf(f);
  const pitch = sp.groundPitch ?? GROUND_PITCH_DEFAULT;
  return Math.min(sp.groundSpread ?? 0.34, pitch * 0.30);
}

/**
 * Where bird `i` of `n` stands at `now`, in world tiles, and which way it is facing — for a flock
 * that is down.
 *
 * ⚠ IT LIVES HERE RATHER THAN IN THE RENDERER, for the reason the skein does: the gate that checks
 * a vulture is a crowd and a goose is not had to copy this arithmetic to ask, and a copy of a
 * placement rule is a gate that goes on passing after the rule it is checking has changed.
 *
 * `alarm` opens the patch as well as speeding the mill: startled birds move APART, and scaling the
 * mill alone just made them each pace faster inside a flock that was the same size.
 */
export function groundSpot(f, i, n, now, alarm = 0) {
  const R = groundPatchR(f, n) * (1 + alarm * 2);
  // ⚠ A JITTERED SPIRAL, NOT A HASHED POINT IN THE DISC. Two independent hashes per bird is
  // uniform in the disc and it is POISSON, which means close pairs are not a bug in it — they are
  // what it is for. Measured over 120 starlings the nearest pair stood 0.005 tiles apart against a
  // 0.027-tile span: one bird inside another, in a patch with room for all of them, which is the
  // crowd this whole block replaced arriving again in six hundred smaller pieces. The golden angle
  // puts every bird about `pitch` from its neighbours by construction — it is how a sunflower
  // packs a disc — and the jitter is what stops that reading as a lattice.
  const th = i * 2.39996323 + frac(f.ax * 9.41 + f.ay * 27.3) * TAU;
  // `sqrt` on the index, or the rings crowd toward the rim: this is the radius that gives every
  // bird the same area of ground, which is the same statement `groundPatchR` makes about the flock.
  const r = R * Math.sqrt((i + 0.5) / Math.max(1, n));
  const j1 = frac(f.ax * 31.7 + f.ay * 13.9 + i * 7.13 + 2.7) - 0.5;
  const j2 = frac(f.ax * 11.3 + f.ay * 41.9 + i * 3.71 + 8.1) - 0.5;
  const jit = (spOf(f).groundPitch ?? GROUND_PITCH_DEFAULT) * 0.18;
  const sx = f.ax + Math.cos(th) * r + j1 * jit, sy = f.ay + Math.sin(th) * r + j2 * jit;

  const mill = groundMill(f) * (1 + alarm * 1.4);
  const s = frac(f.ax * 7.3 + f.ay * 3.9 + i * 17.1);
  const s2 = frac(f.ax * 2.1 + f.ay * 13.3 + i * 5.7);
  const rate = 0.00022 * (1 + alarm * 2.4);
  const a1 = now * rate + s * TAU, a2 = now * rate * 0.61 + s2 * TAU;
  return { x: sx + Math.cos(a1) * mill, y: sy + Math.sin(a2) * mill, heading: a1 + Math.PI / 2 };
}

// ⚠ THE CYCLE NUMBER IS THE ONE `flockState` AND `hawkStoop` ALREADY COUNT, and it has to be
// spelled the same way here or the three disagree about which flight this is — which reads as a
// hawk stooping from a perch it is not standing on, for a cycle the renderer spent on the pavement.
export function perchedNow(f, now) {
  const p = spOf(f).perch;
  if (!p || !p.share) return false;
  const period = flockPeriod(f);
  const ph = frac(f.ax * 19.1 + f.ay * 5.3);
  const cycle = Math.floor(now / period + ph);
  return frac(f.ax * 5.09 + f.ay * 7.71 + cycle * 3.37) < p.share;
}

/** Does this species want the highest ledge it can reach? A hunter does; a pigeon does not care. */
export const perchesHigh = (f) => !!(spOf(f).perch && spOf(f).perch.high);

// ── THE HAWK'S STOOP ──────────────────────────────────────────────────────────
//
// ⚠ A KILL HERE HAS NO ENTITY TO DELETE, and that is what makes it expressible at all. Fauna has
// no rows, no HP and no table — a flock is arithmetic — so a hawk taking a bird cannot be an
// event that mutates something. It has to be a DERIVATION that both surfaces can make
// independently and agree on, which means it is a pure function of the two anchors and the clock,
// exactly like everything else in this file.
//
// ⚠ ONE STOOP PER FLIGHT, at a known phase of the hawk's own cycle. Rolling per frame would make
// the attack rate depend on the frame rate, and storing "has it gone yet" would need somewhere to
// put it. The phase IS the schedule.
const STOOP_AT = 0.72;             // where in the airborne phase the stoop happens
// ⚠ TWENTY PER CENT, AND IT IS MEASURED RATHER THAN CHOSEN. Cooper's hawks were observed over 179
// attacks in an urban study with 35 kills — a hair under 20%. The number matters because it is the
// difference between a predator and a culling machine: four attacks in five come to nothing, and
// the ones that do not are worth seeing.
const STOOP_KILL = 0.20;
const STOOP_REACH = 9;             // tiles — how far a hawk will go for a flock
// ⚠ AND MOST FLIGHTS IT DOES NOT HUNT AT ALL. One stoop per cycle sounds conservative and is not:
// a hawk's cycle is two and a half minutes, so it works out at 450 attacks a day from a single
// bird, which is a bird that does nothing but hunt. Gating on the cycle keeps the stoop a thing
// that happens rather than a thing that is always happening — and it costs nothing, because the
// cycle number is already in hand and hashing it needs no memory of what it did last time.
const STOOP_ODDS = 0.16;           // share of flights that carry a hunt at all
// ⚠ AND A PERCHED HAWK HUNTS FROM THE PERCH, WHICH IS THE COMMONER MODE RATHER THAN A FLOURISH.
// An accipiter is a still-hunter: it sits somewhere with a view over ground that holds prey, waits,
// and goes in one short hard burst. Soaring is mostly how it gets from one of those places to the
// next. So on a perched cycle the schedule moves into the PERCH phase — and the odds go up, because
// a bird that has picked a vantage point over a street full of pigeons is there on purpose, where
// one crossing the town on a thermal is commuting.
const PERCH_STOOP_AT = 0.68;       // where in the PERCH phase the stoop happens
const PERCH_STOOP_ODDS = 0.38;

/**
 * Is this hawk stooping at `now`, and at what?
 *
 * `near` is the caller's list of candidate prey flocks — only the caller has the map, the same
 * rule every other function here follows. Returns null most of the time.
 */
export function hawkStoop(f, now, near) {
  const sp = spOf(f);
  if (sp.id !== 'hawk' || !near || !near.length) return null;
  const period = flockPeriod(f);
  const ph = frac(f.ax * 19.1 + f.ay * 5.3);
  const cycle = Math.floor(now / period + ph);
  // When, in wall-clock terms, this cycle's stoop happens.
  const uG = sp.uGround;
  const perched = perchedNow(f, now);
  const at = perched
    ? (cycle - ph + uG * PERCH_STOOP_AT) * period
    : (cycle - ph + uG + (1 - uG) * STOOP_AT) * period;
  const age = (now - at) / 1000;
  if (age < 0 || age > 3.0) return null;
  if (frac(f.ax * 1.77 + f.ay * 6.31 + cycle * 4.13) >= (perched ? PERCH_STOOP_ODDS : STOOP_ODDS)) return null;

  // ⚠ THE TARGET IS CHOSEN BY THE CLOCK, NOT BY WHO HAPPENS TO BE NEAREST THIS FRAME. A nearest-
  // wins rule reads the caller's list, and the renderer's list and the text game's are different
  // lengths — so the two would pick different victims for the same stoop. Hashing the cycle over a
  // list both sides can build the same way keeps them together.
  const prey = near.filter((p) => p !== f && spOf(p).preyable
    && Math.hypot(p.ax - f.ax, p.ay - f.ay) <= STOOP_REACH);
  if (!prey.length) return null;
  prey.sort((a, b) => (a.ax - b.ax) || (a.ay - b.ay));   // a stable order, not a camera's order
  const pick = prey[Math.floor(frac(f.ax * 3.3 + f.ay * 11.7 + cycle * 2.9) * prey.length) % prey.length];
  const hit = frac(f.ax * 8.8 + f.ay * 4.2 + cycle * 7.3) < STOOP_KILL;
  // ⚠ THE STOOP GOES WHERE THE BIRDS ARE, NEVER AT THEIR ANCHOR TILE, AND IT USED TO DO THE
  // SECOND. `pick.ax/ay` is the tile a flock is rolled ON; the flock itself flies a circuit around
  // it and sits a MEDIAN 2.4 TILES AWAY while airborne. `murmur` pushes the birds out of a Gaussian
  // bubble of radius SCARE_R (1.15 tiles), so a stoop aimed at the anchor reached the flock centre
  // at exp(-(2.4/1.15)^2) = 1.3% of full strength -- measured across 85 live stoops, best case 15%.
  // The hawk was diving at an empty patch of sky next door and the flock never reacted: the shape
  // with the scare applied and the shape without it differed by about 4% on every axis, which is
  // indistinguishable from the sim being switched off.
  //
  // ⚠ STILL PURE, WHICH IS THE PROPERTY THE WHOLE COMMENT ABOVE RESTS ON. `flockState` is a
  // function of the anchor and the clock and nothing else, so the server derives the same point the
  // renderer does and nothing crosses the wire. It is deliberately called WITHOUT a clearance term:
  // only the caller has the map, the server has never passed one, and a murmuration happens over
  // open ground where the clearance lift is zero anyway -- so taking it here would make the two
  // surfaces disagree to buy nothing.
  const ps = flockState(pick, now);
  return { at, age, x: ps.cx, y: ps.cy, prey: pick, hit, cycle };
}

/**
 * How many birds this flock is short, because something took one.
 *
 * ⚠ THE LOSS LASTS UNTIL THE FLOCK NEXT LANDS, and no longer. A dead bird staying dead needs a
 * record of which bird and a place to keep it, and this module has neither by design. A flock that
 * comes back one short for the rest of its flight and whole again next time out is the most a
 * stateless model can honestly say — and it is enough to be noticed, which is the point.
 */
export function lostTo(f, now, hawks, near) {
  if (!hawks || !hawks.length || !spOf(f).preyable) return 0;
  // ⚠ THE SAME LIST THE STOOP WAS RESOLVED AGAINST, AND THIS USED TO PASS `[f]`. `hawkStoop`
  // picks its victim by hashing the cycle over `near`, so a list of ONE always hashes to index 0:
  // every preyable flock inside a hawk's reach reported ITSELF short whenever that hawk's cycle
  // said kill. Measured over 300,000 moments, 649 of 2,687 flocks that were never hunted came back
  // a bird down.
  //
  // ⚠ AND THE NOTE ON hawkStoop ALREADY SAID SO -- "the renderer's list and the text game's are
  // different lengths, so the two would pick different victims for the same stoop". `[f]` was
  // exactly that, in the same file, one function below the warning.
  if (!near || !near.length) return 0;
  let lost = 0;
  for (const h of hawks) {
    const s = hawkStoop(h, now, near);
    if (s && s.hit && s.prey === f) lost++;
  }
  return lost;
}

export const birdDaylight = (id, hour) => {
  const sp = SPECIES[id] || SPECIES.goose;
  return hour >= sp.dayStart && hour < sp.dayEnd;
};

// The widest circuit any species flies. Derived rather than written down, so a species
// added to the table above cannot leave the strike search sized for the ones before it.
const WIDEST_R = Math.max(...Object.values(SPECIES).map((s2) => s2.r));
