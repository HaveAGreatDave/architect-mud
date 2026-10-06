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
import { liveColumnNear } from './thermals.js';

// ── THE WORLD SCALE ─────────────────────────────────────────────────────────────
// ⚠ ONE STATEMENT OF IT, for every bird in the game. GLASS pins the world to the building storey:
// a storey is 0.196 tiles and 3.5 m, so a tile is 17.9 m, and aircraft, people and trees are drawn
// on the same number. Everything metric about a bird (a speed, a gap, a radius flown at a speed) is
// written in metres and goes through `M`; what is written in tiles is a fact about the MAP (how
// big a field is, how near a building may be) and stays in tiles. murmur.js and windshield.js read
// this constant rather than stating their own.
export const BIRD_M_PER_TILE = 3.5 / 0.196;
const M = (m) => m / BIRD_M_PER_TILE;

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
export function flockAt(wx, wy, density = 1, species = 'goose', ground = null) {
  // ⚠ THE SPECIES ROW IS READ THROUGH A LOOKUP RATHER THAN spOf, because there is no flock yet —
  // this is the function that makes one. An unknown id falls back to the goose, same as spOf.
  const sp = SPECIES[species] || SPECIES.goose;
  const want = (areaHash(wx, wy) > sp.areaBias ? sp.dense : sp.sparse) * density;
  const claim = tileHash(wx, wy);
  if (claim >= want) return null;
  // ⚠ A TERRITORIAL SPECIES HOLDS GROUND ALONE. The tile hash clusters (a sin hash has lattice
  // structure), so hawks rolled on neighbouring tiles and read as a hunting party of three, all
  // taking the same highest ledge. A rival inside the territory with a stronger claim (a lower
  // hash) wins it. Still a pure function of the tile, so the room and the renderer agree.
  // ⚠ It does not ask whether the rival tile is habitat — it cannot, see above — which only ever
  // makes it stricter, and both callers make the same answer.
  const T = sp.territory | 0;
  if (T > 0) {
    for (let dy = -T; dy <= T; dy++) for (let dx = -T; dx <= T; dx++) {
      if (!dx && !dy) continue;
      const ox = wx + dx, oy = wy + dy;
      const c2 = tileHash(ox, oy);
      if (c2 < claim && c2 < (areaHash(ox, oy) > sp.areaBias ? sp.dense : sp.sparse) * density) return null;
    }
  }
  // ⚠ NO `sp` KEY AT ALL FOR A GOOSE. Every gate and harness that predates the species table
  // compares flock objects by their own shape, and a new key on every flock would change all of
  // them; a goose flock is byte-identical to the one this returned before the table existed.
  if (species === 'goose') return { ax: wx, ay: wy };
  // ⚠ THE GROUND RIDES ON THE FLOCK ONLY WHERE A ROW ASKS WHAT IT IS (`grand.on`), so every other
  // flock keeps the shape every gate compares. `roost` is 1 on a roost site and 0 off one; absent means
  // the caller never said, which isGrandRoost reads as the old anywhere rule.
  const on = sp.grand && sp.grand.on;
  return on && ground != null ? { ax: wx, ay: wy, sp: species, roost: on.includes(ground) ? 1 : 0 } : { ax: wx, ay: wy, sp: species };
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
      // ⚠ OR WITH { sp, ground }, when the caller knows the place: that is what lets a species put its
      // great roosts on the ground it really roosts on (see `grand.on`).
      const h = isHabitat ? isHabitat(wx, wy) : true;
      if (!h) continue;
      const f = typeof h === 'object' ? flockAt(wx, wy, density, h.sp, h.ground) : flockAt(wx, wy, density, typeof h === 'string' ? h : 'goose');
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
// The radius of the circuit, 99 m. ⚠ SET BY SPEED: a 60 s flight round 37 m was a 5.7 m/s median
// against a Canada goose's 18 m/s cruise; at 99 m it is 15 m/s, peaking at 29 on the climb out.
// (GOOSE_Z above is a height against the skyline, so it stays in tiles: 2.2 is about 39 m.)
export const GOOSE_R = M(99);

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
// How far a soaring bird will go from its perch to reach a thermal column, tiles.
const THERMAL_REACH = 8;   // about one column block: far enough that most flights find a live one
// The fastest a circling flock may sweep round its anchor, degrees a second. A goose at cruise banks
// round a circle of thirty-odd metres at best; tighter than this reads as a bird pivoting in place.
const CIRCUIT_MAX_DEG_S = 70;
const CIRCUIT_PEAK_DEG_S = 90;   // the sharpest a circuit's tightest bend may be flown (see circuitAt)

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
// ⚠ THE SPIRAL IS CENTRED ON A REAL COLUMN (client/shared/thermals.js) when one stands within
// THERMAL_REACH tiles of the anchor, so a circling hawk marks lift an aircraft can use there.
// The column's centre is ground- and clock-free, so this stays a pure function of the anchor
// and the server's copy of the hawk agrees with the window's. The hashes below still key on
// the ANCHOR, so moving the centre changes where the bird flies and nothing else about it.
function thermalAt(f, t, sp, cx = f.ax, cy = f.ay, cr = null) {
  // On a real column the spiral stays inside its core (a red-tail turns in ~30 m inside a core
  // 100-200 m across); circling a bare anchor keeps the authored radius.
  const R0 = cr ? Math.min(sp.r, cr * 0.55) : sp.r;
  // Two phases: climb the spiral, then glide out and back. The climb is the longer half.
  const CLIMB = 0.62;
  const turns = (sp.turns ?? 3) + Math.floor(frac(f.ax * 4.4 + f.ay * 9.2) * 3);
  const th0 = frac(f.ax * 2.3 + f.ay * 8.7) * TAU;
  if (t < CLIMB) {
    const u = t / CLIMB;
    // ⚠ THE RADIUS SHRINKS AS IT CLIMBS, which is the whole shape of a thermal: the lift is
    // strongest in the core, so a bird working one spirals TIGHTER the higher it gets. A constant
    // radius is a bird flying in circles, which is a different and much duller thing.
    const r = R0 * (1 - 0.55 * u);
    const th = th0 + turns * TAU * u;
    // Climbs fast at first and levels off at the top, the way lift falls away near the cap.
    return { x: cx + Math.cos(th) * r, y: cy + Math.sin(th) * r, z: sp.z * Math.sqrt(u), r, th };
  }
  // The glide: out along one bearing and back, losing height the whole way.
  const u = (t - CLIMB) / (1 - CLIMB);
  const out = Math.sin(u * Math.PI);              // 0 at both ends, 1 in the middle
  const bear = th0 + turns * TAU * 1.0 + frac(f.ax * 7.1 + f.ay * 1.9) * 0.9;
  const reach = sp.r * 2.6 * out;
  // ⚠ THE GLIDE LEAVES FROM THE TOP OF THE SPIRAL, NOT FROM THE ANCHOR. The climb ends 0.45 r off the
  // anchor and the glide used to start on it, so the bird jumped most of a tile in one frame — measured
  // at 188 m/s. The spiral's last point is carried in and drawn back to the anchor over the glide.
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

// ⚠ A MURMURATION SWEEPS ITS ROOST AT THE BIRDS' OWN SPEED, and this is the third generator for that
// reason rather than a retuning of the circle. A real flock travels as one aligned body at 10-12 m/s
// (polarisation 0.96, Cavagna et al. 2010) and wanders over a roost of a hundred metres or more (Ballerini
// 2008b; StarDisplay bounds it at 150 m). The circle every other species flies puts the centre on a
// one-tile loop at about a metre a second, which leaves twelve-metre-a-second birds nothing to do but orbit
// it — milling, the one thing the measurement says a murmuration does not do.
//
// ⚠ A SUM OF THREE EPICYCLES, IN SECONDS OF FLIGHT, SO IT IS STILL A CLOSED FORM. The main term carries
// the flock round the roost at about 10 m/s, the second counter-rotates at a different rate so the loop
// stretches into sweeps with turns at their ends and never repeats within a flight, and the third is a
// small fast wobble. Speed then drifts between about 7 and 13 m/s with the geometry, which is what a real
// flock's does. The server evaluates this for the room description and the hawk; it must stay cheap and
// it must stay a pure function of (anchor, t, clear).
//
// ⚠ ANCHORED AT BOTH ENDS BY SUBTRACTION, NOT BY A RAMP. The circle is scaled by a smoothstep so it
// starts and ends on the anchor; a roost several tiles across scaled that way would fling the flock
// outward at up to twice its cruise as it takes off. Instead the pattern's own start and end are
// subtracted, blended across the flight, which costs a drift of well under half a tile a second.
function wanderAt(f, t, sp, clear, span = 1) {
  const w = sp.wander;
  // a held flock's flight is `span` flights long (flightPhase); the climb and the descent keep their own length
  const secsN = (flockPeriod(f) * (1 - sp.uGround)) / 1000, secs = secsN * span;
  // a bigger roost ranges further, by the cube root of its count like everything else about its size
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
  // Where something stands, the whole pattern is compressed in that direction, smoothly — the same
  // clearance profile the circle reads, so a roost beside a tower sweeps the open side of it.
  if (clear && (ox || oy)) {
    const base = sp.roam ?? sp.r, k = radiusAt(clear, Math.atan2(oy, ox), base) / base;
    ox *= k; oy *= k;
  }
  const bump = Math.min(smooth(tau / (RAMP_UP * secsN)), smooth((secs - tau) / (RAMP_DN * secsN)));
  return { x: f.ax + ox, y: f.ay + oy, z: sp.z * bump, r: sp.r * bump, th: Math.atan2(oy, ox) };
}

// ⚠ THE ANGLE ROUND THE CIRCUIT ADVANCES WITH THE RADIUS, NOT WITH THE CLOCK. θ was linear in t while
// r rode the ramp up from zero, so just after take-off and just before landing the flock was sweeping
// full angular speed round a circle a few metres across — a heading swinging through a right angle in
// a fraction of a second, which is "the geese turn too suddenly". Integrating the ramp instead keeps
// the turn rate (speed over radius) roughly constant: they climb out nearly straight and bend into
// the circuit as it opens. Closed form of ∫bump: ∫smooth = x³ − x⁴/2 over each ramp.
const rampInt = (x) => { const c = x < 0 ? 0 : x > 1 ? 1 : x; return c * c * c - 0.5 * c * c * c * c; };
const SWEEP_TOTAL = 1 - RAMP_UP / 2 - RAMP_DN / 2;
function sweepAt(t) {
  const up = RAMP_UP * rampInt(t / RAMP_UP);
  const mid = Math.max(0, Math.min(t, 1 - RAMP_DN) - RAMP_UP);
  const dn = t > 1 - RAMP_DN ? RAMP_DN * (0.5 - rampInt((1 - t) / RAMP_DN)) : 0;
  return (up + mid + dn) / SWEEP_TOTAL;
}

// ⚠ A BENT CIRCUIT IS FLOWN BY DISTANCE, NOT BY ANGLE, AND A TIGHT BEND COSTS SPEED. θ advanced at a
// constant rate, so where the clearance pinched the loop the birds swept through the same angle per
// second on a far smaller radius: measured beside a wall, 143-247°/s of turn and FASTER in the hard
// turns (2.6 tiles/s) than on the straights (0.4) — a flock whipping round every corner. A real bird
// carries its speed into a bend and bleeds it off banking through; so each lap is re-timed by the
// effort of flying it — segment length over a speed that falls with the square root of the turn
// radius below the species' own circle — and θ is read back off that. Laps, period and the closure
// on the anchor are untouched (a lap still takes the same total time); only where in the lap the
// time is spent moves. No clearance, nothing to re-time: an open-air flock is bit-for-bit what it was.
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
  // Peak heading change per unit of lap TIME — what caps how fast the lap may be flown (circuitAt).
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
  // ⚠ SELECTED BY A NUMBER ON THE ROW rather than by the species id, so the buzzard and anything
  // else that soars gets it without this function learning another name.
  if (sp.circuit === 1) {
    // Ride a real column: the nearest one in reach that is working when THIS flight starts, so
    // the bird commits for the whole flight rather than swapping columns mid-spiral. With no
    // live column in reach it circles its anchor as before. The takeoff and landing ramps below
    // carry it between its perch and the column. `now` is null only for the edge-heading probe,
    // which samples the very ends of the flight where the ramps put the bird on its anchor anyway.
    let col = null;
    if (now != null) {
      const period = flockPeriod(f), ph = frac(f.ax * 19.1 + f.ay * 5.3);
      const start = (Math.floor(now / period + ph) - ph) * period;
      col = liveColumnNear(f.ax, f.ay, start, THERMAL_REACH, 0.2);
    }
    const c = col ? thermalAt(f, t, sp, col.cx, col.cy, col.r) : thermalAt(f, t, sp);
    const bump = Math.min(smooth(t / RAMP_UP), smooth((1 - t) / RAMP_DN));
    // The same ramp every other circuit rides, so a thermal still starts and ends ON the anchor —
    // which is what closes the cycle and stops anything spawning or teleporting.
    return { x: f.ax + (c.x - f.ax) * bump, y: f.ay + (c.y - f.ay) * bump, z: c.z * bump, r: c.r * bump, th: c.th };
  }
  const bump = Math.min(smooth(t / RAMP_UP), smooth((1 - t) / RAMP_DN));
  // `turns` on the row is the laps a flight makes (plus 0-1): a soaring bird circles a thermal many times.
  const turns = (sp.turns ?? 1) + Math.floor(frac(f.ax * 7.7 + f.ay * 3.1) * 2);
  // ⚠ A BIRD HAS MOMENTUM, SO A SMALLER CIRCUIT IS FLOWN FASTER ROUND, NOT SLOWER ALONG. The lap count
  // was fixed whatever the clearance, so a flock hemmed in by buildings to a 0.4-tile loop crept round
  // it at 1.2 m/s turning 15°/s — a goose hanging in the air and rotating on the spot. The angular rate
  // is scaled by the flock's MEAN clearance (a constant per flock, so θ stays linear in t and the laps
  // still close on the anchor, where r is zero), capped at a bank a goose can actually hold.
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
  // ⚠ AND THE LAP RATE IS CAPPED BY THE TIGHTEST BEND IN IT, which may take it BELOW one. The mean
  // cap above bounds the turn averaged round the lap; a loop pinched to a hairpin by a wall still put
  // 100-250°/s through the hairpin. Here the whole lap slows until its sharpest bend is flyable, so a
  // flock hemmed in circles slowly rather than whipping round. Fewer laps is safe: r is zero at both
  // ends of the flight, so the circuit still closes on the anchor.
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
  const u = frac(f.ax * 4.11 + f.ay * 9.73);
  // ⚠ A SPECIES WITH A GRAND ROOST ROLLS TWO BANDS, NOT ONE WIDE ONE. A roll across 450 to 80,000
  // would make the ordinary starling flock ten thousand birds strong and the great roost ordinary; a
  // share of anchors (`grand.share`, off its own hash) draws from the top band and the rest keep the
  // band they always had. The top band is skewed low (u squared), so twenty thousand is the rare
  // end of a rare thing. `maxFlock` stays the declared ceiling for both, as the note above requires.
  const g = sp.grand;
  const roll = !g ? sp.minFlock + Math.floor(u * (sp.maxFlock - sp.minFlock + 1))
    : isGrandRoost(f) ? g.from + Math.floor(u * u * (sp.maxFlock - g.from + 1))
    : sp.minFlock + Math.floor(u * (g.below - sp.minFlock + 1));
  return seasonalSize(sp, roll, opts);
};
/** Is this anchor one of its species' grand roosts? Off its own hash, so it never changes. */
// ⚠ ON A ROOST SITE WHEN THE CALLER SAID WHERE (f.roost), ANYWHERE WHEN IT DID NOT. Every game surface
// passes the ground (the window, the room, the dev census), so a great roost only forms over woodland
// or the town; a bench that builds flocks with no map keeps the old rule rather than finding none.
export const isGrandRoost = (f) => {
  const g = spOf(f).grand;
  if (!g) return false;
  if (f.roost === 0) return false;
  return frac(f.ax * 6.37 + f.ay * 2.91) < (f.roost === 1 && g.onShare != null ? g.onShare : g.share);
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
// ⚠ `dusk` IS THE EVENING HALF ON ITS OWN, and it is on. The two cycles were one flag, so a murmuration
// that gathers at dusk and roosts overnight could not ship without the year coming with it, and the year
// makes a big murmuration a winter-only event, which is wrong for testing. With `dusk` on and `season`
// off, every day has small feeding parties, one evening gathering and show over the roost, and a night on
// it; the year never thins them. 0 on both is this module as it shipped.
export const BIRD_TUNE = { season: 0, dusk: 1, flockRange: 1 };

// doyOf lives in moon.js now, beside moonPhaseOf: environment.js needs it at boot, and
// importing it from here pulled this whole 175 KB module into every first page load.
export { doyOf } from './moon.js';

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

// ── HOW BIG A FLOCK IS, AND THEREFORE HOW FAR OFF YOU CAN SEE IT ────────────
//
// ⚠ ONE LAW, TWO READERS, AND THE SECOND ONE WAS MISSING. The renderer already grows a cloud
// by the CUBE ROOT of its count so that birds-per-volume stays constant — a flock of 695 is
// 3.3x the linear extent of the party of twenty the number was tuned at. `drawRange` was a flat
// per-species constant, so that 3.3x-bigger object was cut off at exactly the same distance as
// the party, and the one bird in the table whose size swings by two orders of magnitude was the
// one being told it is always the size of a hedge full of sparrows.
//
// ⚠ IT MAY ONLY EVER EXTEND, WHICH IS WHAT MAKES IT PROVABLY ADDITIVE. The scale is clamped at
// 1, so a flock SMALLER than the reference keeps the range its species authored rather than
// quietly losing some of it. Every other bird in the table maxes out at twelve — under the
// reference — so this fires for the starling ALONE, by arithmetic rather than by a species
// check, and the other five are untouched at every hour of every day.
//
// ⚠ AND IT IS A LINEAR EXTENT AGAINST A DISTANCE, WHICH IS WHY IT IS THE CUBE ROOT AND NOT THE
// COUNT. Apparent size is extent over distance, so holding the cloud at the same apparent size
// means moving the range by the same factor the extent moved. Scaling by the count itself would
// put a 1,700-bird roost at eighty-five times the range, which is most of the basin.
export const FLOCK_REF = 20;
export const flockSpreadScale = (n) => Math.cbrt(Math.max(n, 1) / FLOCK_REF);
export function flockDrawRange(sp, f, opts = null) {
  const base = sp.drawRange;
  // A species that cannot reach the reference can never extend, so its size is never computed.
  // ⚠ 0 IS THE FLAT CONSTANT, BIT FOR BIT. `flockRange` sits beside `season` and not in
  // `RENDER_TUNE` for that flag's own stated reason: the server prints the same flock into a
  // room description out of this module, so a switch only the windscreen could see would be
  // the picture and the sentence disagreeing about how far off a murmuration can be seen.
  if (!BIRD_TUNE.flockRange) return base;
  // A species that cannot reach the reference can never extend, so its size is never computed.
  if (!(sp.maxFlock > FLOCK_REF)) return base;
  return base * Math.max(1, flockSpreadScale(flockSize(f, opts)));
}

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
  if (!(BIRD_TUNE.season || BIRD_TUNE.dusk) || !opts) return roll;
  const f = (BIRD_TUNE.season ? seasonFactor(sp, opts.doy) : 1) * (BIRD_TUNE.dusk ? roostFactor(sp, opts.hour) : 1);
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
/**
 * The end of a starling's evening: one unbroken display, then down onto the roost for the night.
 * Returns null when the ordinary cycle applies, `{ t: null }` for a flock roosting, and `{ t, span }`
 * for a flock partway through its display.
 *
 * ⚠ A MURMURATION DOES NOT LAND EVERY HALF-MINUTE. The ordinary cycle is right for a feeding party and
 * wrong at dusk: a real display runs about 26 minutes without a break and ends with the whole flock
 * pouring down into the roost in under a minute, then staying there until morning (Goodenough et al.,
 * PLOS ONE 12:e0179277, 2017). So in that window the flock flies ONE flight whose length is the show,
 * and the descent at the end of it is the ordinary landing ramp — which means the dive arrives at the
 * anchor exactly when the show ends, with no position anywhere that jumps.
 *
 * ⚠ IT IS A FUNCTION OF THE GAME CLOCK, NEVER OF A DECISION ANYBODY STORED. The server's room text and
 * the renderer ask the same question and get the same answer. `opts.hour` is FRACTIONAL here and
 * `opts.hourMs` is the wall time it was true at, so a caller asking about a moment behind or ahead of
 * now (the relay history) gets the clock at that moment rather than at the last sky push; `opts.rate` is
 * game hours per real hour (the world's timeScale, 1 when not told). ⚠ The show is laid out in REAL
 * seconds of flight — at timeScale 3 a 26-game-minute display is under nine real minutes, and taken in
 * game time the birds would fly it at three times their own speed.
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
  // ⚠ THE HAND-OVER NEEDS A GAP ON THE GROUND. The show starts at the anchor and the ordinary cycle
  // may be anywhere on its circuit at that moment, so switching straight over teleports the flock.
  // For one period before the show, a flight already under way finishes and lands, and none starts.
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

// Where in its cycle a flock is at `now`: the share of the period `u`, and `t`, how far through its
// flight, or null on the ground. ⚠ ONE HELPER FOR flockState AND flockCentreAt, so the centre the GPU
// flock is steered by and the centre every other reader is handed cannot disagree about when it is up.
// ── THE WEATHER TELL ─────────────────────────────────────────────────────────
//
// A red-tail soars on thermals and sits tight when the weather turns: it spends more of its cycle
// down, on a perch or the ground, on a bad day and on the afternoon before one — birds feel a front
// coming before the sky shows it. So a player who has learned to read the hawks gets a warning.
//
// ⚠ BOTH SURFACES HAND OVER THE SAME PAIR (today's headline, tomorrow's forecast) through `opts.wx`,
// and the hour through `opts.hour`, exactly as the season reaches `flockSize`; a surface that has
// not been told answers 0, which is the bird as it always flew. Only a species with `weatherTell`
// reads it.
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
  // ⚠ A HELD FLOCK FLIES ONE LONG FLIGHT, NOT THE SHORT ONE ON A LOOP, when its row says so (`forcedSpan`).
  // Looped, every lap ends with the course snapping from wherever the flight left it to wherever the next
  // one starts, and a murmuration steered by its course shatters at the snap — measured, the flock's
  // polarisation fell from 0.99 to 0.52 at the lap. A lap twelve flights long touches down every few
  // minutes instead of every half-minute.
  const span = forced ? (spOf(f).forcedSpan ?? 1) : 1;
  const t = forced ? (((now / (period * (1 - uG) * span)) + ph) % 1 + 1) % 1 : (u - uG) / (1 - uG);
  return { u, period, uG, t, span };
}

/**
 * The flock's centre at any time — past, present or a moment ahead — as [x, y, z], and nothing else.
 *
 * ⚠ THE GPU MURMURATION IS STEERED BY THIS, AHEAD OF NOW AS WELL AS BEHIND. A turn crosses a real flock
 * as a relay, so each bird steers by the course as it was some time ago; steered only by the past, the
 * whole body trails the centre by that time times its speed — measured at 1.3 tiles in a steady turn.
 * The course a moment AHEAD is as derivable as the one behind, so the relay is centred on the present:
 * the middle of the flock flies the course now, the edge the turn starts at a little ahead of it.
 */
export function flockCentreAt(f, now, clear = null, opts = null) {
  const P = flightPhase(f, now, opts);
  if (P.t == null) return [f.ax, f.ay, 0];
  const c = circuitAt(f, P.t, clear, P.span, now);
  return [c.x, c.y, c.z];
}

export function flockState(f, now, clear = null, opts = null) {
  const P = flightPhase(f, now, opts);
  const { u, period, span } = P;

  const uG = P.uG;
  // ⚠ `opts.air` IS A TEST SEAM AND NOTHING IN THE GAME PASSES IT. It names one species whose
  // flocks are held in the air, so a murmuration can be looked at on demand rather than waited
  // for (`.murmur` in the client). It LOOPS THE AIRBORNE PHASE ON ITS OWN CLOCK rather than
  // pinning `t`: a pinned `t` is a flock hanging still, and the ribbon a murmuration is drawn
  // from is the record of its centre MOVING, so a frozen centre is a ball rather than a cloud.
  // Looped, the flight runs at its own natural speed and touches down for an instant at the
  // anchor between laps — the circuit starts and ends there, so the position never jumps.
  // ⚠ The server never passes it (describe.js hands `{ hour, doy }`), so the room text goes on
  // describing the real flock, and so does everything in this file that calls without opts —
  // the hawk's prey pick and the strike search. It moves the PICTURE and nothing else.
  if (P.t == null) {
    return { airborne: false, u, period, cx: f.ax, cy: f.ay, z: 0, heading: frac(f.ax * 2.3 + f.ay * 8.7) * TAU, turn: 0, climb: 0, n: flockSize(f, opts) };
  }
  const t = P.t;
  const c = circuitAt(f, t, clear, span, now);

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
  const a = circuitAt(f, Math.max(0, t - D / span), clear, span, now), b = circuitAt(f, Math.min(1, t + D / span), clear, span, now);
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
export const STARTLE_R = M(55);   // metres: a flock looks up at about this range
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
// between them, which is what the first version of this got wrong: at half a span across,
// every bird overlapped its neighbours and the flock read as one moving lump.
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

// The drawn model's wingtip-to-wingtip: a Canada goose's 1.65 m. ⚠ STATED HERE, AND fauna3d.js
// SIZES THE MODEL FROM IT: this file is shared with the server, which has no renderer to reach
// into, so the renderer reads this one (FAUNA_TILE) and `fauna.mjs` asserts the two agree, because
// a spacing written against a model that has since been resized is a flock that silently goes
// back to being a lump.
export const GOOSE_SPAN_M = 1.65;
export const GOOSE_SPAN = M(GOOSE_SPAN_M);
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
const WANDER_ACROSS = 0.34, WANDER_ALONG = 0.55, WANDER_LIFT = M(0.6);
const LIFT_FLOOR = M(2.4);            // altitude below which the skein comes level
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
export function skeinSlot(f, i, n, now, cx, cy, heading, z = 0, trail = null) {
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

  // ⚠ A BIRD FOLLOWS THE LEADER'S TRACK, NOT A RIGID V. Placed by the flock's heading NOW, the whole
  // skein swings round its leader like a clock hand in a turn, so the tail of each arm is carried
  // round far faster than any goose flies — a turn that looks accelerated instead of one the birds
  // are carried into. `trail(lagMs)` hands back the leader's centre and heading `lagMs` ago; a bird
  // `along` behind sits where the leader was when it was there, keeps its momentum into the turn
  // and bends through it after the leader has. The across offset is taken off THAT heading. A
  // caller with no trail (a bench, the strike test without a map) gets the old rigid V.
  if (trail && along > 0) {
    const lag = Math.min(3000, (along / GOOSE_CRUISE) * 1000);
    const p = trail(lag);
    if (p) {
      // ⚠ BLENDED BACK TO THE RIGID V NEAR THE GROUND, because the ground layout starts from the
      // rigid slots (groundSpot) and a bird still on the leader's track at touchdown jumps to them.
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

// ── Contact ───────────────────────────────────────────────────────────────────
//
// ⚠ A STRIKE IS THE AIRFRAME PASSING THROUGH A BIRD, IN THREE DIMENSIONS AND IN TIME. The segment test
// above asks whether a flat line passed within a goose's wingspan of a goose frozen at the end of the
// tick, and only a goose. This one steps the aircraft along what it actually flew, from where it was to
// where it is, at the altitudes it held; moves every bird with the same wall clock the canopy draws
// them by; and counts each bird that was inside the airframe's own body at that moment. Nothing is
// rolled. A bird 200 ft below you is a bird you missed, a pigeon counts as much as a goose, and flying
// the width of an aircraft into a skein takes out more than one.
//
// ⚠ A MURMURATION HAS NO BIRD POSITIONS ON THE SERVER. Those are integrated in the client (murmur.js)
// and nobody else has them, so a starling cloud is its measured SHAPE and DENSITY instead: an ellipsoid
// in Ballerini's 1 : 2.8 : 5.6, broadside to its course as murmur.js flies it, holding one bird per
// `MURMUR_M3_PER_BIRD` cubic metres. The count is how much of that volume the airframe's frontal area
// swept through. It is the expected number of birds in that volume, not a roll against it.

// The masses a strike's energy is taken from, in kg: Canada goose, herring gull, feral pigeon,
// European starling, a buteo, a vulture. ½mv² is what the airframe absorbs.
export const BIRD_MASS_KG = { goose: 4.0, gull: 1.0, pigeon: 0.35, songbird: 0.08, hawk: 1.0, peregrine: 0.9, vulture: 1.9 };
// Space per bird in a murmuration: 834 starlings in 2,057 m³ over Rome (Ballerini et al. 2008), the
// median of the ten flocks measured.
export const MURMUR_M3_PER_BIRD = 2.47;
// The highest any flock flies, in tiles, so a caller can skip the whole test above it.
// A function, not a constant: SPECIES is declared further down this file.
export const birdCeiling = () => Math.max(...Object.values(SPECIES).map((s2) => s2.z)) + 0.5;

// ── Evasion ───────────────────────────────────────────────────────────────────
//
// ⚠ A BIRD SEES AN AIRCRAFT COMING AND GETS OUT OF THE WAY, WHEN IT HAS TIME TO. Blackwell and
// colleagues' FAA work (Blackwell et al. 2009, 2012; Bernhardt et al. 2010) found that birds judge an
// approaching vehicle by its DISTANCE rather than its time to arrive, so they react at about the same
// range whatever it is doing and fail more often the faster it comes. That is this model and nothing
// more: notice at EVADE_DETECT_M, spend EVADE_LATENCY_S reacting, then accelerate at EVADE_ACCEL_G
// down and away from the aircraft's line, up to EVADE_MAX_M. A light aircraft at 60 kt gives a bird on
// its line 1.1 s and about 5 m of escape; at 120 kt, 0.4 s and under a metre.
//
// ⚠ IT IS GEOMETRY OF THIS MOMENT, NOT A MEMORY. The aircraft is taken to be flying straight at its
// current velocity, so when the bird noticed it and when it will pass are both solved rather than
// recorded. The server applies it before the contact test and the canopy applies the same function
// round its own aircraft, so a bird that got out of your way in the picture got out of it on the server.
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
  // Away from the line it is flying, and down: the offset of the bird from the path at closest
  // approach, flattened, with a side off its own position when it is dead ahead.
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
 * `a` and `b` are `{ x, y, z, ms }` — grid tiles, height in tiles, wall time. `opts`:
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
  // Substeps no longer than half the airframe's span, so a bird cannot slip between two of them.
  const steps = Math.max(1, Math.min(80, Math.ceil(len / Math.max(0.05, hs))));
  const hx = (b.x - a.x) / (len || 1), hy = (b.y - a.y) / (len || 1);
  // The aircraft's velocity over the leg, in tiles/s, for the birds deciding whether to get out of it.
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
    // Where the birds were hit, for the puff the canopy draws at each (bird-strikes.js). Capped: a pass
    // through a murmuration is hundreds of birds and a dozen puffs already reads as the whole of it.
    const pts = [];
    let cloud = 0;
    for (let k = 0; k <= steps; k++) {
      const u = k / steps, ms = a.ms + (b.ms - a.ms) * u;
      const px = a.x + (b.x - a.x) * u, py = a.y + (b.y - a.y) * u, pz = a.z + (b.z - a.z) * u;
      const st = flockState(fl, ms, clear, opts.when);
      if (!st.airborne) continue;
      if (sp.circuit === 2) {
        // The cloud: is this substep inside the ellipsoid, and if so, how many birds does the swept
        // slab of frontal area hold. Semi-axes from the flock's volume at the measured density.
        const vol = st.n * MURMUR_M3_PER_BIRD / BIRD_M_PER_TILE ** 3;
        const c = Math.cbrt((3 * vol) / (4 * Math.PI * 2.8 * 5.6));
        const aT = c, aW = 2.8 * c, aL = 5.6 * c;
        // murmur.js flies the long axis broadside to the course; the width runs along it.
        // ⚠ THE CLOUD IS WHERE THE PILOT SAW IT (opts.cloudOffset). The GPU flock drifts off the shared
        // centre under its free rules, so the ellipsoid on the centre alone charged strikes over empty
        // sky and let a pass through visible birds go free. The client measures that drift for the
        // hawk (MURMUR_MEASURED) and sends it up; it is clamped to the body's own length, so a client
        // can move the cloud about its roost and never carry it off to somewhere else.
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
          // ⚠ AND THE CLOUD GETS OUT OF THE WAY TOO, as a share rather than bird by bird: a starling on
          // the line has had the time a bird at the edge of noticing has had, and one spread evenly
          // across the airframe's frontal area clears it if it moves further than it had to go. The
          // share still inside is what the aircraft meets.
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
        // ⚠ A PATH WITH NO LENGTH HAS NO DIRECTION, and resolving a bird onto (0, 0) puts every bird
        // at the right height "inside" the airframe. A hovering aircraft is a disc of its own span.
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
    // ⚠ HOW IT LEAVES THE GROUND (the renderer only; the flock's own height is untouched). `run` is the
    // distance in metres it covers on its feet before the body lifts, `beat` how much faster it beats while
    // launching, `hop` how high each stride bounces it (M: metres to tiles). A Canada goose is heavy with a high wing
    // loading and cannot jump off: it runs, pattering and beating hard, for several metres on land or water.
    takeoff: { run: 12, beat: 1.4, hop: M(0.044) },
    // and on to WATER it comes in low, sets its feet forward and skis on them for a few metres before it
    // settles: `skid` is that distance in metres (drawing only, like the run)
    landing: { skid: 6 },
    habitat: GOOSE_HABITAT,
    dense: DENSE, sparse: SPARSE, areaBias: GOOSE_AREA_BIAS,
    period: GOOSE_PERIOD, uGround: U_GROUND, z: GOOSE_Z, r: GOOSE_R,
    minFlock: MIN_FLOCK, maxFlock: MAX_FLOCK,
    // How close together they stand when they are down, centre to centre — see groundPatchR. A
    // grazing goose keeps about three metres of grass to itself, which is what makes a flock of
    // eight a spread rather than a huddle.
    groundPitch: M(3),
    forms: SKEIN_FORMS,
    dayStart: 6, dayEnd: 20,
    // How often this flock says anything, and how much it says when it does.
    callEvery: 96000, callBurst: [2, 4], callGap: 620,
    // How far off a bird of this size is still worth drawing, in tiles. ⚠ EVERY drawRange IS WHERE
    // THE REAL-SIZED BIRD IS ABOUT 1.5 px ACROSS on the 640-wide reference frame (FL 228), so a small
    // bird's range is short because the bird is, and none of them pops out while still a clear dot.
    drawRange: 14,
  },
  gull: {
    id: 'gull',
    // a few quick steps or a hop into the wind, then open wings: a short run
    takeoff: { run: 3, beat: 1.4, hop: M(0.066) },
    landing: { skid: 1.5 },   // a gull drops on to water with a short skid
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
    // Wider circuits, lower, and much less of the cycle spent sitting down. A gull is
    // restless where a goose is not.
    // ⚠ THE FLIGHT IS SET BY ITS SPEED, and it is wider than the goose on a shorter cycle, both of
    // which the fauna gate holds it to. With the
    // goose at 99 m (its own 18 m/s) that leaves a restless bird: 105 m, a 79 s cycle, seven
    // seconds down between flights, and about 13 m/s, the top of a herring gull's cruise.
    period: 79000, uGround: 0.08, z: 1.6, r: M(105),
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
    drawRange: 12,
    groundPitch: M(2.5),       // a gull on a quay stands closer than a goose on a lawn
    // Ashore, a gull stands on a parapet as readily as on the quay — a roof ridge is the same
    // flat exposed thing a harbour wall is, and it is where they go when the tide is wrong.
    perch: { share: 0.42 },
  },

  // The feral pigeon. The city bird, and the only one of the three that is never on grass or
  // water — it lives on pavement, which is a ground the other two only reach in a storm.
  pigeon: {
    id: 'pigeon',
    // near-vertical burst: a leg push and fast, loud beats (the wing clap), climbing steeply with no run
    takeoff: { run: 0, beat: 2.0, hop: 0 },
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
    // ⚠ THE FLIGHT IS SET BY ITS SPEED. Six seconds round this circuit was a 27 m/s median and a 52 m/s
    // peak, twice a feral pigeon's 17-20 cruise; fourteen is 12 and 22, and 29 at worst with the step
    // onto a ledge added (perchLeg in windshield.js). The ground share stays 0.78, so it sits 50 s
    // rather than 21 and the share of pigeons in the air at any moment (which framecost pays for) is unchanged.
    period: 63600, uGround: 0.78, z: 0.9, r: M(18),
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
    drawRange: 5.5,
    preyable: true,
    groundPitch: M(1.1),       // pigeons crowd: half a metre apart on a pavement is normal
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
    // a jump launch: the legs do the first push, then fast beats, no run (the GPU flock's own take-off pose)
    takeoff: { run: 0, beat: 1.5, hop: 0 },
    habitat: {
      grass: 'walk', parkland: 'walk', park: 'walk', forest: 'walk',
      // and the town, where a starling is at least as common as in a field
      citycore: 'walk', concrete: 'walk', uptown: 'walk', civic: 'walk',
    },
    dense: 0.06, sparse: 0.014, areaBias: 0.4,
    street: true,             // a starling is a city bird before it is anything else
    // Short restless cycles and a lot of time in the air — the opposite of a goose.
    //
    // ⚠ IT SWEEPS A ROOST RATHER THAN FLYING THE CIRCLE (`circuit: 2`, wanderAt). `roam` is the
    // roost's radius at `wander.refN` birds, growing by the cube root past it; `wander` is the three
    // epicycles' share of it and their speeds (in metres a second, through M). `r` stays the nominal circuit
    // radius the cloud's size and the clearance margins are keyed on, which is why it did not change.
    //
    // ⚠ WHAT FOLLOWS IS THE HISTORY OF WHY THE OLD CIRCLE WAS SMALL AND SLOW, kept because the reasoning
    // was right for the rule it served: every bird was pulled to a fixed STATION on the path its centre had
    // flown, so a fast centre towed a rigid formation. The stations are gone (murmur.js), every bird now
    // flies the centre's own course, and a centre moving at the birds' speed is what the rule needs.
    //
    // ⚠ THE CIRCUIT WAS SMALL AND SLOW, AND FOR THIS SPECIES THAT WAS A CORRECTNESS INVARIANT RATHER
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
    // ⚠ AND IT IS THE SAME NUMBER THAT MADE THEM LOOK TOO FAST. 2.40 tiles/s was 26 m/s at the 11 m
    // tile it was measured on: nearly twice a starling's own cruise, and faster than the agitation wave that is
    // supposed to outrun the birds (WAVE_SPEED 1.21 = the measured 13.4 m/s). A murmuration MILLS
    // over its roost; it does not tour. The radius is what says so, and the longer period is what
    // stops the small circuit simply being flown round faster.
    // z 2.2 tiles (~39 m), down from 5.0: among the roofs rather than over all of them. Over a block of towers
    // the drawn flock rides the skyline instead (windshield.js, skylineUnder); the server keeps this height.
    period: 300000, uGround: 0.7, z: 2.2, r: M(11),
    // ⚠ roam 5 -> 2.5 (2026-09-25): at 5 a 20,000-bird roost swept ~11 tiles of radius (cube-root growth),
    // which read as a flock touring the district rather than milling over one place. The epicycle speeds
    // in `wander` are tiles/s and did not move, so the smaller roost is swept round faster — the flock
    // turns and doubles back more often inside less ground, which is the ask.
    circuit: 2, roam: M(27.5), forcedSpan: 12,
    // ⚠ ITS OWN WINGBEAT, BECAUSE THE GOOSE'S MADE IT SKATE. Every bird beats at GOOSE_FLAP_HZ unless its
    // row says otherwise, and at 1.5 Hz a starling flying 10 m/s covers about twenty-three wingspans a
    // beat: a tiny bird sliding across the sky on nearly still wings, which is paper, not flight. A goose
    // here covers 2.4 spans a beat and a gull about 4. A starling's wings beat at 13.3 Hz at 12 m/s in a
    // wind tunnel (Kirchhefer et al. 2013, PLoS ONE e80086: 78 g, 38.2 cm span, 6 cm mean chord, stroke
    // +19° to −55°), and Tobalske 1995 found the rate rises with speed — 2.3 spans a beat here. It was 10
    // until 2026-09-23, which undershot every measured figure.
    // ⚠ AND IT GLIDES BETWEEN BURSTS. Starlings alternate flapping with glides and bounds at every speed
    // (Tobalske, J Exp Biol 198:1259, 1995): `glide` is the share of each burst-and-glide cycle spent with
    // the wings held out, and `glideHz` how many such cycles a second — about six beats, then a glide.
    flapHz: 13, glide: 0.28, glideHz: 1.4,
    wander: { refN: 1700, a1: 0.62, v1: M(4.0), v2: M(1.0), v3: M(0.33) },
    // ⚠ BIG FLOCKS, WHICH IS THE WHOLE REASON THIS SPECIES EXISTS. A murmuration of six is a
    // sentence with no subject. The budget share below is what stops that being a problem.
    // ⚠ AND THE SIZE IS SET BY THE SHARE, not the other way round. At 26 a flock is 1,040 faces
    // against its own 840 cap — and because a flock is charged WHOLE (half a skein reads as a
    // rendering fault, not as a budget), it would not have been rejected gracefully, it would
    // simply never have drawn. Twenty is what the share buys.
    minFlock: 450, maxFlock: 60000,
    // ⚠ AND A FEW ROOSTS ARE ENORMOUS. One anchor in `share` draws from `from` to maxFlock instead of
    // from minFlock to `below`; see flockSize. That is what the GPU flock (gl/murmur-gpu.js) was built
    // to afford, and it is a rarity on purpose: a murmuration of that size over every park would be
    // the ordinary thing rather than the spectacle. The top of the band is capped at 60,000 for now
    // (2026-10-04). It was 300,000, then 150,000, and both read as overwhelming rather than as a
    // spectacle. 300,000 measured 17 ms a step on an RTX 2070 SUPER once the grid was made cache-local,
    // stepped every 2nd or 3rd frame by its measured GPU cost (STEP_BUDGET_MS in gl/murmur-gpu.js);
    // before that 80,000 was 3.5 ms a step against 1.3 at 40,000. The GPU can afford more, so raising
    // this again is a taste call, not a cost one. Under frame-time pressure a roost that big thins to
    // RENDER_TUNE.murmurFloor birds rather than to the ordinary floor (see its note in windshield.js).
    // ⚠ AND ONLY WHERE STARLINGS REALLY ROOST: woodland and a city centre (buildings, piers, bridges),
    // never an open field, which is where they FEED. `onShare` is the share of those sites that are
    // great roosts; it is higher than `share` because it is drawn from fewer anchors.
    grand: { share: 0.04, onShare: 0.08, from: 4000, below: 1700, on: ['forest', 'citycore'] },
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
    // ⚠ 18.6 IS WHEN THE SKY STOPS DRAWING A BIRD, not a guess at sunset: windshield.js cuts every bird at
    // sky.night 0.55 (GOOSE_NIGHT_OFF), which its SKY table passes at about 18:35. At 21 the dusk peak
    // (dayEnd - roost.lead) landed at 20:18 and the dive at about 20:45, both after the birds had stopped
    // being drawn, so the evening show happened in the dark. Move one and move the other.
    dayStart: 5, dayEnd: 18.6,
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
    // ⚠ PEAK IN EARLY FEBRUARY, NOT AT THE TURN OF THE YEAR. Mean murmuration size rises from October to
    // a peak in early February and falls away through March, a skewed bell (Goodenough et al., PLOS ONE
    // 12:e0179277, 2017 — citizen science, so the shape is better than any one number in it). It was day
    // 8 until 2026-09-23, a month early. From April to July the same starlings are territorial pairs at
    // a nest hole; `floor` is why a summer park still has starlings in it.
    season: { peak: 36, gamma: 1.7, floor: 0.06 },
    // The pre-roost gathering, in the last hour of light. `lead` is how long before `dayEnd` it
    // peaks and `span` how wide the swell is either side; `floor` is the rest of the day, when a
    // starling is in a feeding party of a few dozen at most and there is no display at all.
    // `dive`, `show` and `jitter` are the end of the evening (roostShow): the flock flies one unbroken
    // display of `show` minutes and goes down onto the roost `dive` hours before `dayEnd`, each roost
    // up to `jitter` hours either side of that. 26 minutes is the mean over Goodenough's surveys;
    // `minSeason` keeps a July party of six from staging a display nobody has ever seen one give.
    roost: { lead: 0.7, span: 1.1, floor: 0.02, dive: 0.25, show: 26, jitter: 0.1, minSeason: 0.35 },
    drawRange: 3.5,
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
    groundPitch: M(1.0),
    // Starlings line a parapet, a wire and a gutter before they go up, and come back to the same
    // one after. The pre-roost gathering is most of what anybody has ever watched them do.
    perch: { share: 0.5 },
    // ⚠ WHERE IT COMES DOWN IS NOT WHERE IT LIVES. Most starling anchors are road or paving, and a
    // starling feeds on short grass and waits on wires; it does not stand about on a road. The renderer
    // takes the party up to `reach` tiles to a wire or a lawn, and to the road only when there is
    // neither and no ledge either (landSite in windshield.js). `perchedNow` still says which cycles
    // are spent up on something, so the room text and the picture agree about that much.
    land: { reach: 3 },
  },

  // The hawk. Solitary, high, and the only bird here that is dangerous to the others.
  //
  // ⚠ minFlock === maxFlock === 1 IS A REAL CASE THIS MODULE HAS TO HANDLE, not a degenerate one.
  // The skein, the hand-over, the wingbeat phase lag and the station-keeping wander are all
  // arithmetic about a bird's place among others, and at n = 1 they run without error and produce
  // nonsense — a lone bird most of a tile from its own flock centre. See the guard at the top of
  // skeinSlot; everything else collapses harmlessly and is left alone.
  //
  // ⚠ A RED-TAILED HAWK, OUT IN THE OPEN, AND IT DOES NOT HUNT BIRDS. This row used to be a buteo
  // (soaring on thermals) and an accipiter (a still-hunter taking pigeons off a tower) in one
  // animal, and the city half was really a peregrine's life. The peregrine has its own row now;
  // this bird circles open country, sits on posts and snags, and takes rodents off the ground,
  // so it carries no `stoop` and is never a danger to another flock.
  hawk: {
    id: 'hawk',
    // drops off a perch into a glide, or jumps up with a few powerful beats: no run
    takeoff: { run: 0, beat: 1.3, hop: 0 },
    habitat: {
      // ⚠ NOT THE GREEN GROUND (grass, parkland, park, forest). This bird's job is the wastes —
      // the weather tell, the thermals over hot rock, the Wildblood — and a territorial claim on a
      // park tile takes that tile from the geese and songbirds that make a park read as a park.
      redrock: 'walk', scrub: 'walk', hardpan: 'walk',
      // ⚠ AND THE BROKEN COUNTRY, WHICH IS WHERE A RED-TAIL ACTUALLY LIVES: cliffs and mesas to
      // ride the updraughts off, dead stands to sit in, and flats to hunt over. Without these it
      // came out at 14 birds in the whole world, all on redrock.
      badlands: 'walk', cliff: 'walk', plateau: 'walk', deadwood: 'walk', basalt: 'walk', alkali: 'walk',
      // ⚠ AND THE TERRAIN NAMES THAT BECOME 'badlands'. The windscreen asks by BIOME and the room text by
      // TERRAIN (see GOOSE_HABITAT's note on keying both spellings), and four terrains share that one
      // biome: without these the window draws a hawk the room says is not there.
      dirt: 'walk', sand: 'walk', gravel: 'walk', marsh: 'walk',
    },
    // ⚠ AN ORDER OF MAGNITUDE RARER THAN ANYTHING ELSE, and it has to be: one bird per flock is
    // not one bird per field. At the goose's density the sky would be full of hawks, which is both
    // wrong and would make the thing they do to other birds routine.
    // The territory below thins it to at most one bird per 15x15 block, so the per-tile roll is
    // well above the density that comes out.
    dense: 0.012, sparse: 0.003, areaBias: 0.5,
    // ⚠ TILES EACH WAY THAT ONE BIRD HOLDS, so hawks never roll in clusters (see flockAt).
    territory: 7,
    // Claims a tile only where its own roll lands, never through the co-tenant pick (speciesAt).
    streetHunt: true,
    // Long, high and slow — a thermal is a patient way to get about.
    // ⚠ HALF THE CYCLE DOWN, where it was 18%. A red-tail spends most of its day perched and only
    // soars when the thermals are up; the longer period keeps each flight a proper climb.
    period: 240000, uGround: 0.5, z: 3.6, r: M(21),
    minFlock: 1, maxFlock: 1,
    forms: ['loose'],
    circuit: 1,               // the spiral, not the circle
    // ⚠ LAPS SET BY SPEED: a buteo circles a thermal at about 10 m/s airspeed, and eight to ten
    // laps of a two-minute flight put its peak at 19.
    turns: 8,
    // Thermals need sun. A hawk circling at first light is wrong.
    dayStart: 9, dayEnd: 17,
    // It barely calls, and when it does it is once.
    callEvery: 190000, callBurst: [1, 2], callGap: 1400,
    drawRange: 10,            // long: it is high up (the vulture goes further)
    // High because a hunting perch is the tallest post, snag or rock in sight — a vantage over
    // grass, not a view of the street.
    perch: { share: 0.7, high: true },
    // ⚠ IT HUNTS THE GROUND, NOT THE SKY: voles, jackrabbits and lizards (crittersAt), mostly by
    // dropping off its perch. Read by groundStrike; it never touches a flock.
    groundHunt: { odds: 0.15, perchOdds: 0.5 },
    // Sits tight when the weather turns (weatherTell): a player can read a storm off the hawks.
    weatherTell: true,
  },

  // The peregrine. The city's hunter: a falcon that treats a tower as a cliff, sits on its upper
  // setbacks most of the day, and takes pigeons out of the air in a stoop. Always one bird.
  //
  // ⚠ PERCHED MOST OF THE TIME, WHICH IS THE BIRD. A cycle is ~15 minutes with 80% of it down; on
  // nine cycles in ten "down" is a high ledge (perch share 0.9), and on the tenth it is on a wall or
  // the pavement over what it caught, which is what the ground prose says.
  // ⚠ AND IT HUNTS A HANDFUL OF TIMES A DAY, NOT HUNDREDS. About 56 cycles fit in its 14 daylight hours,
  // and at the odds below that is ~15 dives a day, roughly one in five a kill. (The hour gate is the
  // caller's: see the hunt in windshield.js.)
  peregrine: {
    id: 'peregrine',
    takeoff: { run: 0, beat: 1.5, hop: 0 },
    // The built city and the quays. Nothing open: out on the flat is the red-tail's.
    habitat: { citycore: 'walk', concrete: 'walk', uptown: 'walk', docks: 'walk' },
    // Rare, and thinned further by the territory: roughly one bird per tower cluster.
    dense: 0.006, sparse: 0.0012, areaBias: 0.5,
    // ⚠ TILES EACH WAY THAT ONE BIRD HOLDS. Wider than HUNT_REACH (6, windshield.js) so two
    // falcons can't both reach the same tower and share its top ledge.
    territory: 7,
    // May claim a road tile, but only where its own roll lands (see speciesAt).
    streetHunt: true,
    period: 900000, uGround: 0.8, z: 4.4, r: M(15.4),
    minFlock: 1, maxFlock: 1,
    forms: ['loose'],
    circuit: 1,
    // About 8 m/s round a 15 m circle over a three-minute flight.
    turns: 14,
    // Hunts from first light to dusk, and the city's lights keep it at it a little later.
    dayStart: 6, dayEnd: 20,
    // The "kek-kek-kek" near the eyrie, not often.
    callEvery: 240000, callBurst: [3, 6], callGap: 160,
    drawRange: 8.5,
    perch: { share: 0.9, high: true },
    // ⚠ THE ONLY SPECIES THAT STOOPS. Read by falconStoop; a row without it never attacks.
    stoop: { odds: 0.10, perchOdds: 0.28 },
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
    // heavy: several hopping strides flapping hard, usually into the wind, before it lifts
    takeoff: { run: 8, beat: 1.3, hop: M(0.13) },
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
    // ⚠ LAPS SET BY SPEED: one or two circles in a two-minute flight moved a vulture at 2.7 m/s, and a
    // soaring vulture circles a thermal at about 10. Six or seven laps of the same circle is 10.4.
    period: 210000, uGround: 0.42, z: 4.4, r: M(35), turns: 6,
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
    groundSpread: M(1.0),
    // ⚠ AND THE PITCH SAYS IT AGAIN IN THE UNITS THE PATCH IS DERIVED FROM. groundSpread bounds
    // how far ONE bird paces; what decides how far apart the birds STAND is this, and a knot that
    // kept the default would have spread out the moment the patch started scaling with the count.
    // At three to seven birds it reproduces the radius this species already had.
    groundPitch: M(0.66),
    // Thermals, exactly as the hawk. A vulture flaps as little as it can get away with.
    dayStart: 8, dayEnd: 18,
    // ⚠ IT HAS NO SYRINX AND CANNOT CALL AT ALL — see BIRD_VOICES. What it does is hiss, and only
    // at each other over the body, which is why the rate is the lowest here and the burst is short.
    callEvery: 240000, callBurst: [1, 3], callGap: 700,
    drawRange: 14.5,          // the longest in the table: high, and a 1.7 m span
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
  // ⚠ AN AIRFIELD IS KEPT MOSTLY CLEAR. Airports scare birds off their movement area, so a field
  // tile keeps a flock only one time in eight. It is a hash of the tile, so the picture, the room
  // and the strike test all agree about which few birds are on the airfield.
  if (opts.airfield && frac(wx * 7.31 + wy * 19.17 + 0.41) > AIRFIELD_BIRDS) return null;
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
    // ⚠ A HUNTER TAKES A STREET ONLY WHERE IT ACTUALLY LIVES. Making the hawk a street bird outright
    // gave it a share of every road tile and cost the pigeons and songbirds a third of the city for
    // hawks that almost never rolled. Here it claims the tile first, and only when its own
    // territory-thinned roll succeeds on it — about one street tile in a hundred and fifty — which
    // is what finally puts a still-hunter within reach of the downtown towers.
    // ⚠ AND OFF THE ROAD TOO: it never enters the random co-tenant pick below, so it costs another
    // species a tile only where a hawk really lives, and the territory is what bounds how many.
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
// `falconStoop(…, near)` arrangement exactly: only the caller has the map, so only the caller can
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
// spread the one species that must not spread. It says so with the PITCH instead (0.66 m against a
// goose's 3 m), which is the same sentence in the units this now derives from: at its own flock
// sizes it lands within a hair of the radius it had before, and it stays a knot at any count.
//
// ⚠ NOTHING IS STORED, exactly as everywhere else in this file. A station is a hash of (anchor,
// bird index), so it survives a reload, a map-window recentre and the settle blend that eases the
// birds out of the formation they landed in — which is the one thing the take-off reads.
const GROUND_PITCH_DEFAULT = M(3);

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
  return Math.min(sp.groundSpread ?? M(3.7), pitch * 0.30);
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
  const P = groundSpotParts(f, i, n);
  const r = R * P.q;
  const sx = f.ax + P.c * r + P.jx, sy = f.ay + P.sn * r + P.jy;
  const mill = groundMill(f) * (1 + alarm * 1.4);
  const rate = 0.00022 * (1 + alarm * 2.4);
  const a1 = now * rate + P.s * TAU, a2 = now * rate * 0.61 + P.s2 * TAU;
  return { x: sx + Math.cos(a1) * mill, y: sy + Math.sin(a2) * mill, heading: a1 + Math.PI / 2 };
}

/**
 * The parts of bird `i`'s place on the patch that do not change while the flock is down: which way
 * from the centre (c, sn), how far out as a share of the patch (q), its jitter (jx, jy) and the two
 * phases of its mill (s, s2). `groundSpot` puts them together; the GPU flock (gl/murmur-gpu.js)
 * bakes them into a texture once and puts them together in a shader, so there is one copy of where
 * a landed starling stands.
 */
export function groundSpotParts(f, i, n) {
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
  const q = Math.sqrt((i + 0.5) / Math.max(1, n));
  const j1 = frac(f.ax * 31.7 + f.ay * 13.9 + i * 7.13 + 2.7) - 0.5;
  const j2 = frac(f.ax * 11.3 + f.ay * 41.9 + i * 3.71 + 8.1) - 0.5;
  const jit = (spOf(f).groundPitch ?? GROUND_PITCH_DEFAULT) * 0.18;
  return {
    c: Math.cos(th), sn: Math.sin(th), q, jx: j1 * jit, jy: j2 * jit,
    s: frac(f.ax * 7.3 + f.ay * 3.9 + i * 17.1), s2: frac(f.ax * 2.1 + f.ay * 13.3 + i * 5.7),
  };
}

// ⚠ THE CYCLE NUMBER IS THE ONE `flockState` AND `falconStoop` ALREADY COUNT, and it has to be
// spelled the same way here or the three disagree about which flight this is — which reads as a
// hawk stooping from a perch it is not standing on, for a cycle the renderer spent on the pavement.
export function perchedNow(f, now) {
  const p = spOf(f).perch;
  if (!p || !p.share) return false;
  // ⚠ A GRAND ROOST COMES DOWN ONTO OPEN GROUND, NEVER ONTO A LEDGE. Thousands of starlings do not
  // line one gutter, and a perched flock is drawn a bird at a time on the CPU and thinned to its face
  // budget, so ten thousand on a parapet would be drawn as eighteen hundred. On the ground the GPU
  // flock (gl/murmur-gpu.js) keeps every bird. Asked here so the room text says the same.
  if (isGrandRoost(f)) return false;
  const period = flockPeriod(f);
  const ph = frac(f.ax * 19.1 + f.ay * 5.3);
  const cycle = Math.floor(now / period + ph);
  return frac(f.ax * 5.09 + f.ay * 7.71 + cycle * 3.37) < p.share;
}

/** Does this species want the highest ledge it can reach? A hunter does; a pigeon does not care. */
export const perchesHigh = (f) => !!(spOf(f).perch && spOf(f).perch.high);

// ── THE FALCON'S STOOP ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
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
export function falconStoop(f, now, near) {
  const sp = spOf(f);
  if (!sp.stoop || !near || !near.length) return null;
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
  if (frac(f.ax * 1.77 + f.ay * 6.31 + cycle * 4.13) >= (perched ? (sp.stoop.perchOdds ?? PERCH_STOOP_ODDS) : (sp.stoop.odds ?? STOOP_ODDS))) return null;

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
export function lostTo(f, now, falcons, near) {
  if (!falcons || !falcons.length || !spOf(f).preyable) return 0;
  // ⚠ THE SAME LIST THE STOOP WAS RESOLVED AGAINST, AND THIS USED TO PASS `[f]`. `falconStoop`
  // picks its victim by hashing the cycle over `near`, so a list of ONE always hashes to index 0:
  // every preyable flock inside a hawk's reach reported ITSELF short whenever that hawk's cycle
  // said kill. Measured over 300,000 moments, 649 of 2,687 flocks that were never hunted came back
  // a bird down.
  //
  // ⚠ AND THE NOTE ON falconStoop ALREADY SAID SO -- "the renderer's list and the text game's are
  // different lengths, so the two would pick different victims for the same stoop". `[f]` was
  // exactly that, in the same file, one function below the warning.
  if (!near || !near.length) return 0;
  let lost = 0;
  for (const h of falcons) {
    const s = falconStoop(h, now, near);
    if (s && s.hit && s.prey === f) lost++;
  }
  return lost;
}

// ── GROUND PREY: WHAT A RED-TAIL EATS ─────────────────────────────────────────
//
// Voles, jackrabbits and lizards in the open country. ⚠ ARITHMETIC, LIKE EVERY FLOCK IN THIS FILE: a
// critter is a pure function of its tile and the wall clock, so there is nothing to store and the
// server and the renderer agree about where it is without anything crossing the wire. It sits still
// most of the time and darts to a new spot every few seconds, which is what small prey does and is
// what makes it readable at all at the size it is drawn.
//
// ⚠ THE CALLER DECIDES WHETHER A TILE IS CRITTER GROUND, for the rule every function here follows:
// only the caller has the map. Ask `critterGround` first.
// ⚠ NO CLIFF AND NO PLATEAU: both are RAISED ground, and a critter is placed at z 0.
const CRITTER_GROUND = new Set(['redrock', 'scrub', 'hardpan', 'badlands', 'basalt', 'alkali', 'deadwood']);
export const critterGround = (ground) => CRITTER_GROUND.has(ground);
export const CRITTER_KINDS = ['vole', 'jackrabbit', 'lizard'];
// How long one hop lasts, and the share of it spent moving. A jackrabbit sits longest and runs fastest.
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

// ⚠ THE RED-TAIL'S STRIKE, WHICH HAS THE FALCON'S SHAPE AND A DIFFERENT TARGET. Same scheduling as
// `falconStoop` — one chance per cycle, from the perch on a perched cycle, late in the flight
// otherwise — so both surfaces agree about when it happens; the target is a critter within reach
// rather than a flock, picked by hashing the cycle over a list sorted into a stable order.
const GROUND_REACH = 3;            // tiles: a red-tail drops on what it can see from where it sits
const GROUND_KILL = 0.30;          // share of strikes that take something
const GROUND_STRIKE_Z = M(0.125);  // a hawk standing over its catch, body centre
// ⚠ AFTER A KILL IT STAYS DOWN, wings spread over the catch (mantling), before it climbs away. A real
// red-tail can sit over prey for many minutes; this is long enough to be seen and short enough that the
// sky is not emptied of hawks. The renderer's dive reads it, so the two agree on when it leaves.
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
  // Where the critter is at the moment of the strike, which is where the dive goes.
  const c = crittersAt(pick.ax, pick.ay, at).find((q) => q.id === pick.id) || pick;
  // ⚠ tz IS THE HAWK'S OWN HEIGHT OVER THE ANIMAL, NOT THE GROUND: the dive puts the bird's body
  // centre there, and at 0 half of it is under the floor.
  return { at, x: c.x, y: c.y, tz: GROUND_STRIKE_Z, prey: c, hit: frac(f.ax * 8.8 + f.ay * 4.2 + cycle * 7.3) < GROUND_KILL,
    cycle, ground: true, period, ph };
}

/**
 * Is this red-tail striking at `now`, and at what? `prey` is the caller's list of critters near it,
 * from `crittersAt` on critter ground — only the caller has the map. Null most of the time.
 */
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
 * Every kill this red-tail made in the last `sinceMs`: [{ at, x, y, ax, ay, kind }]. What a kill leaves
 * on the ground outlasts the hawk, so this is how the server answers "did something die here?" for
 * `search` — the same strikes the renderer drew, derived again rather than remembered.
 * `prey` is the hawk's critter list, built the way groundStrike's is.
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

/**
 * Has a red-tail taken this critter? From the moment the strike lands to the end of that hawk's
 * cycle — the same rule a flock follows when it comes back a bird short, for the same reason.
 */
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

// The widest circuit any species flies. Derived rather than written down, so a species
// added to the table above cannot leave the strike search sized for the ones before it.
const WIDEST_R = Math.max(...Object.values(SPECIES).map((s2) => s2.r));
