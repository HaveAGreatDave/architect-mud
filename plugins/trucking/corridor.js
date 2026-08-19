// The Long Haul — the corridor: a highway generated across the void.
//
// The void has no placed tiles. It is a chain of transient ROOMS (plugins/voidwalking) with no
// grid coordinates at all, because walking it never needed any. Driving it does: the windshield
// renders a square window of surface cells, so a truck out there needs a world that isn't in the
// database.
//
// THE RULE THIS FILE EXISTS TO OBEY: synthesise the ZONE, never the finished render cell.
// `corridorAt` returns the same shape `surfaceAt` returns — { id, name, flags, danger } — and
// hands it to `deriveSurfaceCell` in plugins/flight/state.js, which is the ONE place that decides
// what a tile looks like. The alternative (emitting `{ kind, biome, road, rd… }` directly) forks
// that logic, and we know exactly how that ends: plugins/flight/snapshot.js kept its own copy and
// drifted twice, silently losing painted-only street tiles and then park features from the baked
// world. So: road auto-tiling, lane markings, biome, extrusion, fog, all of it comes for free, and
// stays correct when somebody improves the renderer without knowing this file exists.
//
// COORDINATE SPACE — REAL WORLD TILES. The road is laid between two actual zones: the rim tile the
// driver left and the destination zone's own `grid_x`/`grid_y`. This used to be a private frame
// ("origin at the gate, NOT world space, never overlaps it"), which was internally consistent and
// made the truck the only thing in the game using those numbers — a pilot overhead, a walker in the
// same crossing and a driver on the same road each had a different idea of where "here" was, and no
// two of them could be converted into each other. They are one frame now, which is what lets the
// windscreen show the basin receding behind you instead of blank air (see providerFor in state.js).
//
// A position is still (s, t):
//   s = distance travelled along the route, in tiles, 0 → L
//   t = lateral offset from the centreline, −R → +R
// The truck's odometer IS `s`, which is why `s` is the value the server defends hardest — though it
// is no longer monotonic, because a truck can now turn round exactly as a walker always could.
//
// ⚠ `corridorFor` STILL BUILDS THE OLD LOCAL FRAME when handed no anchor, and a good deal of the
// regress suite depends on that. Anchored and unanchored roads are the same code; only the origin,
// the initial heading and the length differ.
//
// SEEDING. Every cell is a pure function of (voidKey, destKey, window, x, y) using the same
// hashSeed/mulberry32 pair voidwalking seeds its rooms with, and the same weekly window. So
// everyone driving this route this week drives the identical road, a relog regenerates it
// byte-for-byte, and the regress suite can pin a window and get a fixed layout.
//
// NODES. `nodeAt(route, s)` maps a point on the road back to the void room the driver is standing
// in. Crossing a node boundary is the driving equivalent of a `move`, which is what lets
// encounters, detours, traces and the crossing's player_flags all work untouched — and it fires in
// EITHER direction now, which is the same thing that happens when a walker re-enters a room.
// It was `floor(s / TILES_PER_ROOM)` written out in five files; a room is a fraction of the road's
// real length now, so that division has one home. See roomLenOf below.

// Kept in step with plugins/voidwalking (TILES_PER_ROOM = 90). It is not exported from there as a
// public name, and importing the plugin for one integer would drag its whole boot in; the regress
// suite asserts the two agree, so a change there fails here loudly rather than silently halving
// the length of every haul.
export const TILES_PER_ROOM = 90;

// ── WHICH VOID ROOM AN ODOMETER READING IS IN ────────────────────────────────
// This was `Math.floor(s / TILES_PER_ROOM)` written out in five places, which was fine while the
// road's length was DEFINED as nodes × that constant — the division could not disagree with
// anything. An anchored road is as long as the real gap, so the room length is now a property of
// the route, and five copies of a division against a stale constant would put the cab, the text
// rung, the renderer and the node-crossing handler in four different rooms.
//
// ⚠ CLAMPED AT BOTH ENDS, and the low end is not paranoia — backtracking means `s` can now be
// driven to 0 and a touch below it through float error, and a negative node index reads off the
// front of the chain as `undefined`.
export function roomLenOf(route) { return route?.roomLen || TILES_PER_ROOM; }
export function nodeAt(route, s, cap = route?.nodes) {
  const n = Math.max(1, cap | 0);
  return Math.max(0, Math.min(n - 1, Math.floor(s / roomLenOf(route))));
}
// The inverse — where a room STARTS, in tiles. Used to place a resumed rig back on the road.
export function sOfNode(route, node) { return Math.max(0, node | 0) * roomLenOf(route); }

// Half-width of the PAVED corridor, in tiles. Past this you are off the road — which is a thing you
// may do (see OFFROAD_R below), not a thing that stops you. It is deliberately generous, because a
// road you keep falling off is a road nobody enjoys holding.
export const CORRIDOR_R = 6;
// HOW FAR OFF THE ROAD YOU CAN ACTUALLY GO, as a multiple of the paved half-width.
//
// The corridor used to end at `R`: past six tiles of centreline you were BOGGED, stalled, and put
// back on the shoulder by the engine. That was a wall wearing a penalty's clothes — the one thing
// rule 3 at the top of the plugin says the edge of the road must never be.
//
// It is a real verge now. Out to `OFFROAD_R` there is ground, and you may drive on it: slowly,
// badly, and at a cost that lands almost entirely on the tyres, which is what open country does to
// a truck. Only past THAT is there nothing at all — and there has to be an end, because the
// corridor is synthesised around a line and beyond some width there is no geometry to stand on.
// Far enough out that reaching it is a decision rather than a wobble.
export const OFFROAD_R = CORRIDOR_R * 4;

// ── Tiles into miles ─────────────────────────────────────────────────────────
// A distance a driver reads has to be in the units a driver thinks in, and until the signs went up
// nothing out here ever had to say one out loud — the `route` verb printed TILES, which is an
// engine unit that leaked into a player-facing line because nobody had needed another.
//
// THE CONVERSION MOVED TO client/shared/road-units.js AND IS RE-EXPORTED HERE, so every server-side
// importer of it is unchanged. It had to move because the third surface that prints it — the GPS
// strip on the dash — is drawn in the browser and could not import a server plugin, so it carried
// its own `/12` and quietly printed a quarter of the real figure. See that file for the full note.
// ⚠ IMPORTED AS WELL AS RE-EXPORTED, AND BOTH NAMES. `export … from` forwards a binding to this
// module's consumers without putting it in this module's own scope — so `rowsAt` below, which
// calls `milesOf` to word a sign, threw ReferenceError the first time a road was built WITH a
// plan. Every test that passed no plan built no signs and never touched it.
export { TILES_PER_MILE, milesOf } from '../../client/shared/road-units.js';
import { TILES_PER_MILE, milesOf } from '../../client/shared/road-units.js';

// ── Seeding (mirrors plugins/voidwalking) ────────────────────────────────────
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

// ── Route geometry ───────────────────────────────────────────────────────────
// The road is a CURVE: a heading integrated along arc length and sampled into short straight
// segments. It used to be a polyline of axis-aligned legs — long southbound runs broken by hard
// 90° jogs — on the stated grounds that the renderer's road pass could only paint lane markings
// toward connected tile EDGES, so a diagonal would come out as a staircase of hairpins. That was
// true of the icon (`rd`), and it is still true of the icon. It was never true of the PAINT: the
// marking primitives in drawGroundSurfaces (`stripeA`/`dashedA`) take an arbitrary axis vector and
// only ever got handed [1,0] or [0,1]. So the bend now lives in a heading we ship per tile
// (`flags.road_deg`), the icon stays axis-aligned as a fallback, and the road can actually turn.
//
// ⚠ THE MINIMUM TURN RADIUS IS A CORRECTNESS INVARIANT, NOT A TASTE SETTING. Every cell out here
// is classified by its DISTANCE FROM THE CENTRELINE, out to OFFROAD_R. Curve tighter than that
// radius and the verge band folds through itself: two distant parts of the same route claim the
// same tile, `locate` answers with whichever is nearer, and the odometer jumps backwards through
// the fold. So MIN_RADIUS must stay comfortably above OFFROAD_R — which is also just what a
// highway looks like. Regress asserts it.
const SEG = 4;              // tiles of arc length per sampled segment — the polyline's resolution
const MIN_RADIUS = 110;     // tiles — the tightest bend the road may ever hold (see the ⚠ above)
const STRAIGHT_MIN = 90;    // tiles — the shortest straight between two bends
const STRAIGHT_VAR = 150;   // …plus up to this much more
const ARC_MIN = 60;         // tiles — a bend shorter than this reads as a twitch, not a sweeper
const ARC_VAR = 130;
// The leash. Nodes are just buckets of `s`, so the road is free to wander anywhere it likes — but a
// route that wandered without limit would eventually double back and hand `locate` two answers for
// one tile. So the heading may never stray further than HOME_MAX from due south.
//
// ⚠ THE LEASH IS APPLIED WHEN A BEND IS CHOSEN, NEVER WHILE ONE IS DRIVEN. The first cut pulled the
// heading back toward south a little every tile, which is the obvious way to write it and quietly
// ruins the whole feature: a continuous correction means the STRAIGHTS are not straight either, so
// the wheel is never still, and the bends stop reading as events because everything is a bend. Past
// HOME_BIAS the next bend simply has to turn back, which keeps a straight perfectly straight and
// still guarantees the road comes home.
const HOME_MAX = 46;        // degrees — a bend is cut short rather than stray further than this
const HOME_BIAS = 24;       // degrees — past here the next bend must turn back toward south

const D2R = Math.PI / 180, R2D = 180 / Math.PI;

// How much longer than the straight line an anchored road is allowed to get before the builder
// gives up and lands it. A real highway across open ground runs maybe 15-25% long; this is the
// runaway cap, not the target — the leash decides the actual figure, and a road that hits this
// bound is a road whose wander never converged, which the arrival tail then rescues.
// ⚠ IT IS ALSO THE ONLY DIAL FOR "hauls are too short now". Raising it does not lengthen the road
// on its own (the leash still homes); moving the regions apart is what lengthens a haul. See the
// note on corridorFor.
const MAX_SINUOSITY = 1.6;

// Compass bearing of a vector in corridorFor's own convention (ux = sin θ, uy = −cos θ, so +y is
// due south). Hoisted deliberately: `bearingOf` further down this file is a const arrow declared
// AFTER corridorFor, so calling it from there would be a temporal-dead-zone throw at build time.
function bearingDegOf(vx, vy) { return (Math.atan2(vx, -vy) * R2D + 360) % 360; }
// Fold a degree difference into (−180, 180]. See the ⚠ in the build loop for why an anchored road
// cannot do without this and the old fixed-nominal road could.
function wrapDeg(d) { return ((d % 360) + 540) % 360 - 180; }

// Build the route for one crossing. Pure: same arguments always give the same road.
//   voidKey   region key the crossing leaves from (e.g. 'region_coldwater')
//   destKey   destination limb key from that void's `dests` (e.g. 'reach')
//   window    the weekly window (voidwalking's currentWindow())
//   nodes     how many void rooms the chain holds — the road is exactly that long
//   trunkNodes  how many of those rooms are the SHARED trunk, before the fork
//
// THE TRUNK IS ONE ROAD, NOT TWO THAT HAPPEN TO START TOGETHER. Every destination out of a void
// shares its first `trunk` rooms (plugins/voidwalking builds them once and hangs a limb per dest
// off the last one), so the tarmac over those rooms must be IDENTICAL whichever way you are
// eventually going. The first cut seeded the whole polyline on `destKey`, which meant the two
// roads out of Coldwater diverged from the gate — and that is not a cosmetic difference: changing
// your mind at the fork would have teleported the rig sideways onto a road that had been somewhere
// else the whole way. So the trunk is seeded WITHOUT the destination and the limb with it, and a
// leg is never allowed to straddle the boundary — which also puts a real bend at the junction,
// because the limb opens on a jog.
//   plan      the crossing as a whole — { origin, dests: [{ key, name, nodes }] }, every limb of it
//             including this one. See the note on `branches` below. Omitted (or null) builds a bare
//             road: no sibling limbs, no signs. The recursive call that builds each sibling passes
//             nothing, which is what stops this recursing forever.
//   anchor    { x0, y0, x1, y1 } in REAL WORLD TILES — the rim tile the road leaves from and the
//             tile it must arrive at. Omitted builds the legacy LOCAL frame: origin (0,0), heading
//             due south, length nodes × TILES_PER_ROOM.
//
// ── WHY THE ROAD IS ANCHORED, AND WHAT IT COSTS ──────────────────────────────
// The corridor used to be built in a frame of its own: start at (0,0), point due south, run for
// exactly nodes × 90 tiles. That draws a perfectly good road and it makes the game disagree with
// itself, because the truck was then the only thing in the world using those coordinates. A pilot
// over the same waste, a walker in the same crossing and a driver on the same road each had a
// different idea of where "here" was, and no two of them could be converted into each other.
//
// So the road is laid between two REAL tiles: the rim zone you drove off, and the destination
// zone's own grid coordinate. One consequence is worth stating rather than discovering: THE ROAD
// IS NOW AS LONG AS THE GAP ACTUALLY IS. Coldwater's south rim and the Reach are 95 tiles apart,
// not the 720 that `length: 8` produced, so hauls are much shorter until the regions are moved
// apart or MAX_SINUOSITY is dialled up. That is a tuning problem and is deliberately left as one —
// a road that lies about where it is cannot be tuned into honesty first.
//
// ⚠ THE LEASH IS RE-CENTRED, NOT REMOVED, AND THAT IS WHAT MAKES THE ROAD ARRIVE. In the local
// frame `off` was the heading's deviation from due south — a FIXED direction, which is precisely
// why the road needed a fixed length to stop at. Anchored, `off` is the deviation from the bearing
// to the TARGET, recomputed every segment. The existing HOME_BIAS/HOME_MAX rules then do the
// homing for free: a road that has strayed past the bias must turn back toward the target, and
// "toward the target" gets more specific the closer it gets. There is no separate convergence
// term and no blend weight — the leash was always a homing device, it was just homing on a
// compass point instead of on a place.
export function corridorFor(voidKey, destKey, window, nodes, trunkNodes = 0, plan = null, anchor = null) {
  const dests = plan?.dests || null;
  const n = Math.max(1, nodes | 0);
  const anch = anchor && [anchor.x0, anchor.y0, anchor.x1, anchor.y1].every(Number.isFinite)
    && Math.hypot(anchor.x1 - anchor.x0, anchor.y1 - anchor.y0) >= SEG ? anchor : null;
  // Unanchored keeps the exact legacy numbers, so every caller not yet taught about real
  // coordinates — and every regress case built on the old frame — behaves as it always did.
  // Anchored, the true length is not known until the road has been built, so `L` is a CAP while
  // building and the real arc length is written back onto the route at the end.
  const straight = anch ? Math.hypot(anch.x1 - anch.x0, anch.y1 - anch.y0) : 0;
  const L = anch ? straight * MAX_SINUOSITY : n * TILES_PER_ROOM;
  // ── THE BENDS HAVE TO SCALE WITH THE ROAD ────────────────────────────────────
  // ARC_MIN, STRAIGHT_MIN and MIN_RADIUS are absolute tile counts chosen for a 720-tile haul, where
  // a 60-tile arc is a sweeper you barely notice. Anchored to the real gap, Coldwater→Reach is 95
  // tiles — so ONE minimum arc was two thirds of the entire journey, the road thrashed from side to
  // side, and it overran the sinuosity cap and had to be cut off and landed by the tail rather than
  // arriving under its own steam. Same numbers, different road: the constants were never absolute,
  // they were a proportion of a length that used to be fixed.
  //
  // ⚠ THE RADIUS FLOOR IS THE FOLD INVARIANT AND IS NOT NEGOTIABLE. Cells are classified by
  // distance from the centreline out to OFFROAD_R, so a bend tighter than that band folds the verge
  // through itself and `locate` hands out two answers for one tile — the odometer then jumps
  // backwards through the fold. Scaling the radius down for a short road is fine; scaling it below
  // the band is the one thing that breaks the geometry, so it is floored well clear of it.
  const bendK = anch ? Math.max(0.15, Math.min(1, straight / (8 * TILES_PER_ROOM))) : 1;
  const arcMin = ARC_MIN * bendK, arcVar = ARC_VAR * bendK;
  const straightMin = STRAIGHT_MIN * bendK, straightVar = STRAIGHT_VAR * bendK;
  const minRadius = Math.max(OFFROAD_R * 1.8, MIN_RADIUS * bendK);
  const trunkL = Math.max(0, Math.min(L, anch
    ? L * (Math.min(n, Math.max(0, trunkNodes | 0)) / n)   // the same FRACTION of the road, in real tiles
    : (trunkNodes | 0) * TILES_PER_ROOM));
  const trunkRng = mulberry32(hashSeed(`${voidKey}|${window}|trunk`));
  const limbRng = mulberry32(hashSeed(`${voidKey}|${destKey}|${window}|corridor`));
  const legs = [];
  const bends = [];           // the s each ARC begins at — where the road changes direction (see signsFor)
  let s = 0, x = anch ? anch.x0 : 0, y = anch ? anch.y0 : 0;
  // Unanchored: due south, as it always was. Anchored: straight at the target — which is the same
  // statement ("point down the corridor") made about a real place instead of a compass bearing.
  let hdg = anch ? bearingDegOf(anch.x1 - anch.x0, anch.y1 - anch.y0) : 180;
  let hold = 0, kappa = 0;    // tiles left in the current straight-or-arc, and its curvature (°/tile)
  let forkedAt = -1;          // the s the fork bend was armed at, so it is armed exactly once
  // ── ANCHORED, THE ROAD STOPS WHEN IT GETS THERE ──────────────────────────────
  // Not when a tile count runs out: `L` is only a runaway cap (see MAX_SINUOSITY), and the real
  // terminator is getting close enough that the wander has nothing left to contribute.
  //
  // ⚠ "CLOSE ENOUGH" IS THE TURN RADIUS, AND THAT IS GEOMETRY RATHER THAN TASTE. A curve cannot
  // converge on a point tighter than the circle it is able to draw. Terminating at a fixed few
  // tiles put the builder into a LIMIT CYCLE: the road homed beautifully to about eight tiles out
  // and then orbited the destination for the rest of its budget, sweeping a full 360° of heading
  // and never getting closer, because every correction it made was on a 43-tile radius around an
  // 8-tile miss. It only ever arrived because the cap ran out and the tail below dragged it in —
  // so every anchored road ended with a hard kink nothing had chosen.
  //
  // Once inside the radius the honest thing is to stop steering and run straight in, which is also
  // what a real road does on the approach to somewhere.
  const approach = Math.max(SEG, minRadius * 1.05);
  const reached = () => anch && Math.hypot(anch.x1 - x, anch.y1 - y) <= approach;
  while (s < L && !reached()) {
    const onTrunk = s < trunkL;
    const rng = onTrunk ? trunkRng : limbRng;
    // The direction the leash is measured against. Unanchored that is due south for ever, which is
    // what made the old road need a fixed length. Anchored it is the bearing to the target FROM
    // WHERE WE NOW ARE, so every segment re-aims and the same leash becomes the homing.
    const nominal = anch ? bearingDegOf(anch.x1 - x, anch.y1 - y) : 180;
    // THE FORK IS A BEND YOU CAN SEE FROM THE CAB. Every destination out of a void shares its first
    // `trunk` rooms, so the tarmac over them must be identical whichever way you are eventually
    // going — which means the trunk is seeded WITHOUT destKey and the limb WITH it, and no piece of
    // road may straddle the boundary. The old geometry marked the junction with a forced sideways
    // jog; a curve marks it with a forced hard-as-allowed sweeper in a destination-seeded direction,
    // so the two limbs visibly peel apart at the same tile rather than a room name changing.
    // How far the road currently points off the nominal. ⚠ WRAPPED, which a fixed nominal never
    // needed: `hdg` stayed within a leash-width of 180 so a bare subtraction was safe. A nominal
    // that moves can sit either side of the 0/360 seam, and an unwrapped difference there reads as
    // ~350° off — the leash would slam the road round in the wrong direction at the seam.
    const off = wrapDeg(hdg - nominal);
    if (!onTrunk && trunkL > 0 && forkedAt < 0 && (L - s) > arcMin) {
      forkedAt = s;
      // ⚠ THE FORK ARC'S LENGTH MUST BE DESTINATION-SEEDED, NOT JUST ITS DIRECTION. Seeding only the
      // direction is the obvious way to write this and it does not work: where the leash forces the
      // turn, BOTH limbs are forced the same way, and a straight preserves heading — so two limbs
      // that leave the trunk on an identical arc then run parallel, tile for tile, for as long as
      // the next straight lasts. They were still one road 200 tiles past the junction. Varying the
      // arc LENGTH per destination makes the two headings differ the moment the bend ends, so the
      // limbs part company at the fork whichever way each of them happens to turn.
      hold = arcMin + Math.floor(limbRng() * arcVar);
      // The limb peels off hard, in a destination-seeded direction — unless that would breach the
      // leash, in which case it peels the other way. ⚠ The TIGHTNESS is seeded too, and that is what
      // actually guarantees the split: where the leash forces both limbs the same way, an identical
      // curvature keeps them on the same tiles until the arc ends, so the roads ran as one for a
      // full void room past the junction. Different curvature means different headings from the
      // first segment, so the limbs splay apart at the fork itself whichever way each one turns.
      const away = Math.abs(off) > HOME_BIAS ? -Math.sign(off) : (limbRng() < 0.5 ? -1 : 1);
      kappa = away * (1 / minRadius) * R2D * (0.5 + limbRng() * 0.5);
      bends.push({ s, fork: true });
    }
    if (hold <= 0) {
      // Straights and bends strictly alternate. Two arcs back to back is a chicane, and nobody
      // builds one of those across a waste.
      if (kappa === 0) {
        hold = arcMin + Math.floor(rng() * arcVar);
        // Curvature is capped at the minimum-radius invariant and then softened at random, so most
        // bends are gentler than the tightest one the road is allowed to hold.
        const tightness = 0.35 + rng() * 0.65;
        const dir = Math.abs(off) > HOME_BIAS ? -Math.sign(off) : (rng() < 0.5 ? -1 : 1);
        kappa = dir * (1 / minRadius) * R2D * tightness;
        bends.push({ s, fork: false });
      } else {
        hold = straightMin + Math.floor(rng() * straightVar);
        kappa = 0;
      }
    }
    // Never let a segment straddle the junction: the trunk's last segment ends exactly on trunkL.
    let len = Math.min(SEG, L - s, hold);
    if (onTrunk && trunkL > 0) len = Math.min(len, trunkL - s);
    if (len <= 0) break;

    const th = hdg * D2R, ux = Math.sin(th), uy = -Math.cos(th);
    legs.push({ s0: s, s1: s + len, x0: x, y0: y, ux, uy, len, trunk: onTrunk, deg: hdg });
    x += ux * len; y += uy * len; s += len; hold -= len;

    hdg += kappa * len;
    // Hard stop at the leash: the bend simply ends early rather than carrying the road round.
    // Measured against the nominal captured at the TOP of this iteration, so the clamp and the
    // decision that produced this segment are talking about the same direction.
    if (wrapDeg(hdg - nominal) > HOME_MAX) { hdg = nominal + HOME_MAX; hold = 0; }
    if (wrapDeg(hdg - nominal) < -HOME_MAX) { hdg = nominal - HOME_MAX; hold = 0; }
  }
  // ── THE LAST LEG LANDS ON THE TILE, EXACTLY ──────────────────────────────────
  // The loop stops within a segment of the target, which is close but not the same thing. A road
  // that ends "about here" would put the arrival check, the destination sign and the tile the rig
  // is handed to `leaveCorridor` at three slightly different places. So one final straight is laid
  // from wherever the wander finished onto the target itself.
  if (anch) {
    const dx = anch.x1 - x, dy = anch.y1 - y;
    const len = Math.hypot(dx, dy);
    if (len > 1e-6) {
      const ux = dx / len, uy = dy / len;
      legs.push({ s0: s, s1: s + len, x0: x, y0: y, ux, uy, len, trunk: s < trunkL, deg: bearingDegOf(dx, dy) });
      x = anch.x1; y = anch.y1; s += len;
    }
  }
  // ANCHORED, `L` IS WHAT THE ROAD TURNED OUT TO BE — the arc length actually laid down, not the
  // cap it was built under. Everything downstream (the odometer clamp, `legFrac`, the arrival
  // test, the mile boards) reads route.L, so this one assignment is what makes them all agree with
  // the geometry rather than with the estimate.
  const realL = anch ? s : L;
  const route = { voidKey, destKey, window, nodes: n, L: realL, R: CORRIDOR_R, legs, trunkL, bends,
    origin: plan?.origin || null,
    // WHAT ONE VOID ROOM IS WORTH, IN TILES. It used to be the global TILES_PER_ROOM, which was
    // correct precisely because the road's length was defined as nodes × that constant. Once the
    // road is as long as the real gap, the two stop being the same number and the ROOM COUNT is
    // what has to stay fixed — the crossing's chain, its encounters and its `zone.entered` calls
    // are all indexed by node, and a road that produced a different number of nodes than the void
    // has rooms would walk a driver off the end of the chain. So a room is a FRACTION of the road.
    roomLen: realL / n,
    // The same factor the bends were scaled by, carried so the SIGN pass can reach it. A board is
    // positioned in absolute tiles (stand SIGN_LEAD back from the bend, no two closer than
    // SIGN_APART, aim the arrow SIGN_LOOK down the road) and every one of those numbers was chosen
    // against a 720-tile haul. On a 98-tile road SIGN_APART alone collapses every board into one
    // and FORK_SPREAD aims the junction arrow past the far end of the road it is describing.
    bendK,
    anchored: !!anch };
  route.index = buildIndex(route);
  // ── THE OTHER LIMBS ARE ROAD, AND THEY WERE NEVER DRAWN ──────────────────────
  // A route is a trunk plus ONE limb, because that is all a driver's odometer runs along. That is
  // right for the physics and it was wrong for the window: `corridorAt` only ever asked this one
  // road what was at a tile, so the two roads you were choosing between at the junction did not
  // exist out the windscreen. The highway came down the trunk, swung once, and ended in open
  // waste — a highway that just stops, which is the one thing a highway never does.
  //
  // So a route carries its SIBLINGS, built from the identical trunk seed (see the note above) and
  // their own limb seeds, and `corridorAt` falls through to them for any tile this road does not
  // claim. Nothing about the drive changes: `locate`, the odometer clamp, the node crossing and
  // the fuel burn all still read `rig.route` and only `rig.route`. What changes is that the fork
  // is a fork you can SEE, and each limb runs off toward its own region instead of stopping.
  //
  // ⚠ THE SIBLINGS ARE BUILT WITHOUT A `dests` TABLE OF THEIR OWN, and that is load-bearing twice
  // over: it terminates the recursion, and it leaves them with no signs. A sign is a thing the
  // road you are ON tells you; sixty signs facing a road nobody is driving are just texture with a
  // per-tile cost.
  //
  // ⚠ AND A SIBLING IS ANCHORED TO ITS OWN DESTINATION, off the SAME origin. Handing it this
  // route's anchor would build three roads to one place — the fork would visibly reconverge — and
  // handing it none would build it in the legacy local frame, dropping a second road across the
  // real world at (0,0). A dest with no coordinates of its own simply falls back to unanchored,
  // which is the same road it has always drawn.
  route.branches = (dests || [])
    .filter((d) => d.key !== destKey && (d.nodes | 0) > 0)
    .map((d) => ({ key: d.key, name: d.name || d.key,
      route: corridorFor(voidKey, d.key, window, d.nodes, trunkNodes, null,
        anch && Number.isFinite(d.x) && Number.isFinite(d.y)
          ? { x0: anch.x0, y0: anch.y0, x1: d.x, y1: d.y } : null) }));
  route.signs = dests ? signsFor(route, dests) : [];
  return route;
}

// ── The signs ────────────────────────────────────────────────────────────────
// WHAT A SIGN IS FOR, out here: not decoration, and not a tutorial. The corridor is a curve across
// a featureless waste with no map, no landmarks and a fork in the middle of it, so the two things a
// driver cannot otherwise know are HOW FAR and WHICH WAY. Everything on a board answers one of
// those and nothing answers anything else.
//
// A row is `{ n, m, a }` — name, MILES (never tiles; see milesOf), and an arrow index 0-7 measured
// from the DRIVER'S OWN HEADING at that sign, clockwise from straight ahead. So the arrow is what
// a driver sees from the seat rather than a compass bearing they would have to convert.
//
// ⚠ THE ARROW IS TAKEN FROM A LOOK-AHEAD POINT ON THE ROAD, NEVER FROM THE DESTINATION ITSELF. The
// obvious implementation — bearing from the sign to where the road ends — reads plausibly and is
// wrong at exactly the moment a sign matters: both limbs out of Coldwater are leashed within 46° of
// south, so their far endpoints sit within one arrow step of each other and the junction board
// would have pointed BOTH ways ahead. What a driver needs at a junction is which way the road goes
// from HERE, so the bearing is measured to a point LOOK tiles along that road. On a straight that
// still resolves to "ahead", which is the correct answer there.
const SIGN_LOOK = 80;        // tiles down the road the arrow is aimed at
// ⚠ AND THE JUNCTION BOARD HAS TO LOOK FURTHER THAN THAT, or it points every limb straight on. A
// board stands SIGN_LEAD short of the fork, so an 80-tile look lands barely 60 tiles into a bend
// whose radius is 110 — the two roads have separated by about ten degrees at that point, which
// rounds to the same arrow. The limbs are properly apart a couple of hundred tiles down, and THAT
// is the direction a driver at the junction is choosing between. Measured from the fork itself
// rather than from the sign, so moving the board does not silently re-aim it.
const FORK_SPREAD = 210;     // tiles past the junction the fork board's arrows are aimed at
const SIGN_LEAD = 16;        // tiles BEFORE a bend a sign stands — you read it while still straight
const SIGN_APART = 40;       // tiles — two boards closer than this are one board
// Lateral offset: clear of the shoulder (2.4) with enough margin that rounding the post onto a tile
// centre can never push it back onto the graded dirt, and inboard of the structure band (off ≥ 4).
export const SIGN_OFF = 3.4;

// Compass bearing of a corridor-space vector, in degrees, matching corridorFor's heading convention
// (ux = sin θ, uy = −cos θ — so +y is due south).
const bearingOf = (vx, vy) => (Math.atan2(vx, -vy) * R2D + 360) % 360;
// Eight-point arrow, relative to the road's own heading. 0 = straight on, 2 = hard right, 4 = back
// the way you came, 6 = hard left.
function arrowFrom(hdg, vx, vy) {
  if (!vx && !vy) return 0;
  const rel = ((bearingOf(vx, vy) - hdg) % 360 + 540) % 360 - 180;
  return ((Math.round(rel / 45) % 8) + 8) % 8;
}
// The rows one board carries, at odometer `s`.
//
// PAST THE JUNCTION A SIGN STOPS NAMING THE OTHER PLACES, and that is honesty rather than
// tidiness: there is no cutting across out here (see `route`), so a board naming a town you can no
// longer reach is a board that lies. The ORIGIN is on every board, because the one route that is
// always available is the one behind you.
// ⚠ `hdg` IS A PARAMETER BECAUSE THE BOARD HAS TWO FACES. The distances on a sign are a property
// of the ROAD — how far along it a place is — and are the same whichever way you are pointing. The
// ARROWS are not: `a` is measured relative to the driver's own heading, so the identical row read
// from the other side of the board wants a different arrow. Passing the heading in is what lets one
// function author both faces without either of them being a special case of the other.
function rowsAt(route, s, dests, kind, hdg = null) {
  const here = corridorPos(route, s, 0);
  const hd = hdg == null ? here.heading : hdg;
  const rows = [];
  const aim = (r, target) => {
    const p = corridorPos(r, target, 0);
    return arrowFrom(hd, p.x - here.x, p.y - here.y);
  };
  const onTrunk = s <= route.trunkL;
  // Scaled with the road, for the same reason the bends are: a junction arrow aimed 210 tiles
  // past a fork on a road only 98 tiles long is aimed past the destination it is pointing at.
  const k = route.bendK || 1;
  const look = kind === 'fork' ? Math.max(SIGN_LOOK * k, route.trunkL - s + FORK_SPREAD * k) : SIGN_LOOK * k;
  for (const d of dests) {
    const r = d.key === route.destKey ? route : route.branches.find((b) => b.key === d.key)?.route;
    if (!r || (!onTrunk && r !== route)) continue;
    rows.push({ n: signLabel(d.name || d.key), m: milesOf(Math.max(0, r.L - s)), a: aim(r, Math.min(r.L, s + look)) });
  }
  if (s > 4) rows.push({ n: signLabel(route.origin || 'BACK'), m: milesOf(s), a: aim(route, Math.max(0, s - SIGN_LOOK)) });
  return rows;
}
// A board is a fixed-width object and a long name would render as a smear, so names are trimmed
// HERE — once, server-side — rather than in the renderer, so the `route` verb and the board can
// never disagree about what a place is called.
const SIGN_CHARS = 15;
const signLabel = (s) => String(s).toUpperCase().slice(0, SIGN_CHARS);

function signsFor(route, dests) {
  const at = [];
  const k = route.bendK || 1;
  const apart = SIGN_APART * k, lead = SIGN_LEAD * k;
  const head = Math.max(2, 6 * k), tail = Math.max(4, 12 * k);   // clear of both ends of the road
  const push = (s, kind) => {
    const cs = Math.round(Math.max(head, Math.min(route.L - tail, s)));
    if (cs < head || cs > route.L - tail) return;
    if (at.some((p) => Math.abs(p.s - cs) < apart)) return;
    at.push({ s: cs, kind });
  };
  // The gate board comes first so the collapse below can never drop it: a road that names its
  // destinations at the very moment you join it is the difference between a highway and a track.
  push(Math.max(2, 8 * k), 'gate');
  // The junction board, on the trunk, in advance of the fork — a sign AT a junction is a sign you
  // read as you take the wrong one.
  if (route.trunkL > apart) push(route.trunkL - lead, 'fork');
  for (const b of route.bends) push(b.s - lead, b.fork ? 'fork' : 'bend');
  return at
    .sort((a, b) => a.s - b.s)
    .map((p) => {
      // ⚠ A SIGN IS ONE TILE, RESOLVED HERE, NOT A TOLERANCE BAND RESOLVED IN corridorAt. The wreck
      // and the roadside structures match on a band because they are placed in (s, t) and have to
      // survive a curve turning that row of tiles into a diagonal — and a band is fine for a shed,
      // which is a whole tile wide anyway. A board is a post: matched on a band it comes out as
      // three or four identical boards in a row, which reads as a mistake rather than as a sign.
      // So the post is snapped to its tile ONCE, at build time, and the lookup is an equality.
      const at2 = corridorPos(route, p.s, SIGN_OFF);
      // BOTH FACES, AUTHORED HERE. A real motorway board is blank galvanised steel on the back
      // because the other carriageway has boards of its own; this road has one lane each way and one
      // post, so a driver running back toward the origin was passing a board they could not read —
      // and the renderer, mapping the same lettering onto a quad seen from behind, drew it mirrored.
      // The back is the same places at the same distances (a distance along the road does not care
      // which way you face) with the arrows re-measured against the reversed heading, which is the
      // only part of a row that is about the DRIVER rather than about the road.
      return { s: p.s, kind: p.kind, x: Math.round(at2.x), y: Math.round(at2.y), deg: at2.heading,
        rows: rowsAt(route, p.s, dests, p.kind),
        back: rowsAt(route, p.s, dests, p.kind, (at2.heading + 180) % 360) };
    })
    .filter((p) => p.rows.length);
}
// Every board between two odometer readings, for anything that wants to READ one rather than
// render it (the text rung has no windscreen, and a board only a 3-D client can see is a board half
// the players in the game do not have).
//
// ⚠ A SWEPT RANGE, NOT "AM I NEAR ONE". A board is one tile and the two rungs advance the odometer
// at wildly different granularities — the cab reconciles four times a second, the text run covers
// a whole slab of road per tick — so a proximity test would have the cab reading every board and
// the text rung stepping straight over most of them. Asking what was PASSED is the same question
// at both rates.
//
// ⚠ AND THE SWEEP IS UNSIGNED. It used to return nothing at all when `to < from`, which quietly
// meant a driver running back toward the origin passed every board on the road without one of them
// reaching the log — the boards existed only for traffic going one way, on a road that has always
// been drivable both. The RANGE is order-agnostic; which face was read is the caller's business
// (see passSign), because that is a fact about the driver and not about the road.
export function signsBetween(route, from, to) {
  const lo = Math.min(from, to), hi = Math.max(from, to);
  if (!(hi > lo)) return [];
  return (route?.signs || []).filter((g) => g.s > lo && g.s <= hi);
}
// The eight arrows, as words — the same order `arrowFrom` returns, shared by the text rung and by
// anything that has to say an arrow out loud.
export const ARROW_WORDS = ['straight on', 'bearing right', 'right', 'back and right',
  'back the way you came', 'back and left', 'left', 'bearing left'];

// Where is (s, t) in corridor XY? Used to place the truck and to seed the cab's start pose.
export function corridorPos(route, s, t = 0) {
  const cs = Math.max(0, Math.min(route.L, s));
  const leg = route.legs.find(l => cs >= l.s0 && cs <= l.s1) || route.legs[route.legs.length - 1];
  const d = cs - leg.s0;
  // Lateral is perpendicular to travel, and the perpendicular is now the segment's own normal
  // rather than "the other axis". Sign convention: +t is to the RIGHT of travel, matching locate.
  const px = leg.x0 + leg.ux * d + leg.uy * t;
  const py = leg.y0 + leg.uy * d - leg.ux * t;
  return { x: px, y: py, heading: ((leg.deg % 360) + 360) % 360 };
}

// The inverse, and the hot one: for a corridor XY, which segment is it on, how far along, how far
// off? Returns null when the point is on no segment — that is off-corridor, which renders as air.
const OFFROAD_MUL = OFFROAD_R / CORRIDOR_R;   // one road, one width — derived, never written twice
const EPS = 1e-6;

// ── The segment index ────────────────────────────────────────────────────────
// `locate` is called once per window cell per push — about 5,300 cells at the cab's radius — and a
// curved route is ~L/SEG segments, so a 720-tile haul is 180 of them. The old axis-aligned geometry
// had a handful of legs and a linear scan was genuinely cheaper than any index; at 180 segments the
// same scan is ~950k iterations per push, on a tick that also renders. So segments are bucketed
// into a coarse grid once at build time, and each bucket holds every segment whose ±OFFROAD_R band
// touches it. A lookup then tests two or three.
const BUCKET = 32;
const bkey = (bx, by) => `${bx},${by}`;
function buildIndex(route) {
  const m = new Map();
  const pad = route.R * OFFROAD_MUL;
  for (let i = 0; i < route.legs.length; i++) {
    const l = route.legs[i];
    const x1 = l.x0 + l.ux * l.len, y1 = l.y0 + l.uy * l.len;
    const bx0 = Math.floor((Math.min(l.x0, x1) - pad) / BUCKET), bx1 = Math.floor((Math.max(l.x0, x1) + pad) / BUCKET);
    const by0 = Math.floor((Math.min(l.y0, y1) - pad) / BUCKET), by1 = Math.floor((Math.max(l.y0, y1) + pad) / BUCKET);
    for (let bx = bx0; bx <= bx1; bx++) for (let by = by0; by <= by1; by++) {
      const k = bkey(bx, by);
      const arr = m.get(k); if (arr) arr.push(l); else m.set(k, [l]);
    }
  }
  return m;
}

// ⚠ THE OUTSIDE OF A BEND IS A WEDGE, AND REJECTING ON `d` PUTS A HOLE IN IT. Two consecutive
// segments overlap on the inside of a turn and leave a gap on the outside — a point out there is
// past the end of one segment and before the start of the next, so a strict `0 ≤ d ≤ len` test
// answers null for both and the renderer paints open air in the middle of the highway. So `d` is
// CLAMPED to the segment at internal joints and the true distance to the clamped point is what
// competes. The two genuine ends of the route are NOT clamped, because there the road really does
// stop and extending it would pave the ground before the gate and past the destination.
function locate(route, x, y) {
  // A route built before the index existed (or hand-made in a test) still works — just slowly.
  const near = route.index
    ? route.index.get(bkey(Math.floor(x / BUCKET), Math.floor(y / BUCKET)))
    : route.legs;
  if (!near) return null;
  let best = null, bestDist = Infinity;
  const limit = route.R * OFFROAD_MUL;
  for (const leg of near) {
    const px = x - leg.x0, py = y - leg.y0;
    const raw = px * leg.ux + py * leg.uy;    // along the segment
    const t = px * leg.uy - py * leg.ux;      // perpendicular, +t to the right of travel
    // ⚠ The route's two real ends need an epsilon, and it is not optional. The last segment's own
    // endpoint round-trips to `d = len + 1e-15`, so a bare `d > len` test rejects the final tile of
    // every haul and hands it to the previous segment — the odometer stops one segment short of the
    // destination, which looks like a gameplay bug and is a float comparison.
    if (raw < -EPS && leg.s0 <= 0) continue;
    if (raw > leg.len + EPS && leg.s1 >= route.L) continue;
    const d = raw < 0 ? 0 : raw > leg.len ? leg.len : raw;
    // Distance to the CLAMPED point — inside the segment this is just |t|, and in a joint wedge it
    // is the distance to the joint itself, which is what makes the wedge resolve to the nearer
    // segment instead of to nothing.
    const dist = Math.hypot(raw - d, t);
    // ⚠ THE VERGE IS INSIDE THE GEOMETRY, NOT OUTSIDE IT. Locating out to the off-road limit rather
    // than to the pavement edge is what makes driving off the road DRIVING rather than a stall: the
    // odometer still derives, the node still tracks, the cells still render. What changes out here
    // is the surface under the wheels, and the surface is the punishment.
    if (dist > limit) continue;
    // Nearest centreline wins. The paved answer therefore beats the verge one wherever two
    // segments both claim a tile, so a bend is a road rather than a seam.
    if (dist < bestDist) { bestDist = dist; best = { s: leg.s0 + d, t: t < 0 ? -dist : dist, leg }; }
  }
  return best;
}
export { locate as corridorLocate };

// ── Cell content ─────────────────────────────────────────────────────────────
const VERGE_NAMES = ['The Long Nothing', 'Cracked Hardpan', 'The Rust Flats', 'Ashfall', 'Bone Country'];
// Roadside structures, sparse. Every `bt` here is a type `drawTypeModel` ALREADY has a model for
// (checked against the case list in client/game/js/panels/windshield.js) — so a fuel yard or a
// junkyard comes up out of the haze as itself, with no new art and nothing falling back to a
// generic box. `motel`/`silo`/`shack` were the obvious names and are exactly the ones with no
// model, which is the trap: pick the type off the renderer's list, not off the fiction.
// Spacing is deliberately wide. On a long haul these are EVENTS, not scenery.
const ROADSIDE = [
  { bt: 'fuel_yard', name: 'Last Chance Diesel' },
  { bt: 'diner', name: 'The Greasy Axle' },
  { bt: 'garage', name: 'Wrench In The Works' },
  { bt: 'warehouse', name: 'A Dead Depot' },
  { bt: 'junkyard', name: 'The Boneyard' },
  { bt: 'ruins', name: 'Somebody Lived Here' },
  { bt: 'layover', name: 'The Long Layover' },
  { bt: 'reefer', name: 'A Stalled Reefer' },
];
const ROADSIDE_EVERY = 40;

// ── Wrecks, from real hauls ──────────────────────────────────────────────────
// The roadside props above are seeded scenery: the same eight buildings, in the same places, for
// everybody, forever. These are the opposite — one is left behind every time a driver gives up on
// a rig out here and walks, and it stands on the verge at the exact tile they stopped on.
//
// RAM ONLY, and that is a decision rather than a shortcut. The corridor itself is transient (the
// crossing's rooms are registered and torn down per instance) and the WINDOW rolls weekly, so a
// wreck's own address stops existing on the same clock the road does; persisting it would mean
// writing rows that describe a piece of geometry that no longer exists. What it costs is that a
// restart sweeps the road clean, and what it buys is a road whose wrecks are all from hauls that
// happened this week, to people who are still around to be asked about them.
//
// Keyed by void+dest+window so one week's ghosts never haunt the next week's road, and capped —
// a corridor lined end to end with dead trucks stops reading as "somebody died here" and starts
// reading as a scrapyard.
const WRECKS = new Map();
const WRECK_CAP = 12;
const wreckKey = (route) => `${route.voidKey}|${route.destKey}|${route.window}`;
export function addWreck(route, { s, what, who }) {
  if (!route) return null;
  const key = wreckKey(route);
  const list = WRECKS.get(key) || [];
  // Side and offset are derived from the tile, not rolled, so the same wreck is in the same place
  // for every driver who comes past it — including the one who left it.
  const at = Math.round(Math.max(0, Math.min(route.L, s)));
  if (list.some(w => Math.abs(w.s - at) < 6)) return null;      // one hulk per spot; they do not stack
  const rng = mulberry32(hashSeed(`${key}|wreck|${at}`));
  list.push({ s: at, side: rng() < 0.5 ? -1 : 1, off: 3 + Math.floor(rng() * 3), what: what || 'a truck', who: who || null });
  while (list.length > WRECK_CAP) list.shift();                 // the oldest ghost fades first
  WRECKS.set(key, list);
  return list[list.length - 1];
}
export const wrecksOn = (route) => (route ? WRECKS.get(wreckKey(route)) || [] : []);
// The nearest wreck ahead of `s`, for the CB to talk about. Deliberately a LOOK-AHEAD: a warning
// about something you have already driven past is not a warning.
export function wreckAhead(route, s, within = TILES_PER_ROOM * 2) {
  let best = null;
  for (const w of wrecksOn(route)) {
    const d = w.s - s;
    if (d < 0 || d > within) continue;
    if (!best || d < best.d) best = { ...w, d };
  }
  return best;
}
// The nearest wreck you are actually STANDING AT, in either direction — which is a different
// question from `wreckAhead` and must not be confused with it. That one is a warning and looks
// forward only; this one is "can I reach that hulk from here", and a hulk twenty yards behind the
// cab is as reachable as one twenty yards in front.
export function wreckNear(route, s, within = 4) {
  let best = null;
  for (const w of wrecksOn(route)) {
    const d = Math.abs(w.s - s);
    if (d > within) continue;
    if (!best || d < best.d) best = { w, d };
  }
  return best?.w || null;
}
export const _clearWrecks = () => WRECKS.clear();   // regress only — the road is per-process state

// Terrain for a node, seeded exactly as voidwalking seeds the room's own — so the ground under the
// wheels changes room by room, and matches the terrain the walked prose describes.
const TERRAINS = ['scrub', 'ash', 'redrock', 'marsh'];
function nodeTerrain(route, node) {
  return pick(mulberry32(hashSeed(`${route.voidKey}|${route.window}|${route.destKey}${node}`)), TERRAINS);
}

// The road piece for a tile: an EXPLICIT icon, always. It matters that this is authored rather
// than left to mapWindow's auto-tiler — the tiler ORs together every adjacent road cell, so a
// corridor whose shoulder is also `dirt_road` would come back 'nesw' on every single tile and the
// renderer would paint a crossroads for the entire length of the highway. Authoring `road_ns`
// takes the explicit-icon branch and a straight road stays straight. (Verified: an auto-tiled
// 3-wide band renders as nesw|nesw|nesw; the same band with icons renders ns|ns|ns.)
// THE ICON IS THE FALLBACK NOW, NOT THE ROAD. It is authored as the NEAREST AXIS and never as a
// bend piece: the actual direction of travel ships as `flags.road_deg` and the renderer paints lane
// markings along that vector, which is a thing the marking primitives could always do. A bend piece
// here would be wrong twice over — the curve is not a 90° elbow, and drawing one would put a second
// set of markings across the arm the road never takes.
const roadIcon = (hit) => 'road_' + (Math.abs(hit.leg.uy) >= Math.abs(hit.leg.ux) ? 'ns' : 'ew');
// The compass direction of a vector, for the roadside entrance facing.
const compassOf = (vx, vy) => Math.abs(vy) >= Math.abs(vx) ? (vy > 0 ? 'south' : 'north') : (vx > 0 ? 'east' : 'west');

// One surface cell of the corridor. THE contract: this returns the same shape `surfaceAt` does,
// or null for open air. It is called once per window cell per push (≈5300 cells at radius 36), so
// it allocates a little and queries nothing.
export function corridorAt(route, x, y) {
  const hit = locate(route, x, y);
  if (!hit) return branchAt(route, x, y);                 // not our road — try the ones we forked away from
  const { s, t } = hit;
  const node = nodeAt(route, s);
  const terrain = nodeTerrain(route, node);
  const at = Math.abs(t);
  const id = `corridor_${route.voidKey}_${route.destKey}_${x}_${y}`;
  const danger = 2;

  // The paved centreline.
  //
  // ⚠ THE BAND HAS TO BE WIDER THAN ONE TILE NOW, AND THAT IS CORRECTNESS RATHER THAN GENEROSITY.
  // The tarmac used to be |t| < 0.5 — a single tile — which is fine while the centreline runs along
  // an axis and disastrous the moment it doesn't: a one-tile band on a diagonal rasterises into
  // tiles that touch only at their CORNERS, so the highway comes apart into a dotted line of
  // squares with the verge showing between them. Regress walks the whole route asserting the paved
  // tiles stay 8-connected; that test is what this width exists to pass.
  // ⚠ A WIDE BAND MEANS EVERY TILE MUST PAINT THE SAME LINES, NOT ITS OWN. The renderer draws lane
  // markings relative to the TILE centre, which was right when the road was one tile across and is
  // wrong the moment it is three: each paved tile would lay down its own double-yellow and the
  // highway would come out with three centrelines running down it in parallel. So the tile also
  // ships its own lateral offset (`road_t`) and the renderer shifts the markings back by it — every
  // tile in the band then paints the identical world-space lines, overdrawing harmlessly, and the
  // paint sits on the real centreline rather than on whichever tile happens to be drawing it.
  // `road_w` is the paved half-width, so the marking spacing is derived here rather than being a
  // second copy of this file's numbers living in the renderer.
  //
  // ⚠ `road_wear` IS ONE AUTHORED FACT, NOT A TEXTURE. Nobody has resurfaced this road since the
  // thing that emptied the basin, and it has to LOOK like that or the void reads as a municipal
  // street somebody laid across a desert. The alternative — shipping per-tile crack/patch/drift
  // detail from here — would be authoring a texture over the wire at 3,700 cells a push, and worse,
  // it would put the appearance of the road in two places the first time anybody retunes it. So the
  // road states that it is unmaintained, ONCE, and the renderer derives the whole worn look from
  // that plus the tile's own world coordinates (windshield.js, wornAsphalt). Coldwater's streets
  // never set it and are pixel-identical.
  const deg = ((hit.leg.deg % 360) + 360) % 360;
  const PAVED = 1.2, SHOULDER = 2.4;
  if (at < PAVED) {
    return { id, name: 'The Highway', danger,
      flags: { terrain: 'road', icon: roadIcon(hit), road_deg: deg, road_t: +t.toFixed(3), road_w: PAVED,
        road_wear: 1, corridor_s: s, corridor_node: node } };
  }
  // The shoulder — graded dirt. `dirt_road` is what earns it the renderer's packed-dirt look
  // (ft:'dust'), so drifting onto it is visible before any penalty text fires.
  if (at < SHOULDER) {
    return { id, name: 'The Shoulder', danger,
      flags: { terrain: 'dirt_road', icon: roadIcon(hit), road_deg: deg, road_t: +(t - Math.sign(t) * ((PAVED + SHOULDER) / 2)).toFixed(3), road_w: (SHOULDER - PAVED) / 2,
        corridor_s: s, corridor_node: node } };
  }
  // The verge. Node terrain, and very occasionally something somebody built and left.
  const rng = mulberry32(hashSeed(`${route.voidKey}|${route.window}|${route.destKey}|${x},${y}`));
  const flags = { terrain, corridor_s: s, corridor_node: node };
  let name = pick(rng, VERGE_NAMES);
  // A wreck from a real haul, standing where its driver gave up on it. It borrows `reefer` — the
  // roadside table's own dead-truck model — rather than introducing a building type the renderer
  // has never heard of, which is the difference between a hulk on the verge and an untextured box.
  // ⚠ Placement is a TOLERANCE BAND, never `Math.round(t) === off`. On a straight run the tiles at
  // a fixed lateral offset form a clean row and rounding lands on exactly one of them; on a curve
  // that row is a diagonal and the rounding lands on none of them for stretches at a time, so an
  // equality test places the hulk intermittently or not at all.
  // A SIGN, on the right-hand verge, facing the traffic it is talking to. It sits between the
  // shoulder (2.4) and the structure band (3.4) on purpose: close enough to read at speed, far
  // enough out that a rig running wide does not have to be adjudicated against it.
  //
  // Same tolerance band as the wreck below, and for the same reason — on a curve the row of tiles
  // at a fixed lateral offset is a diagonal, so `Math.round(t) === SIGN_OFF` would stand the board
  // up on some stretches and not on others.
  const g = (route.signs || []).find(k => k.x === x && k.y === y);
  if (g) {
    // `face` is the road's own heading at the post; the renderer turns the panel 180° from it,
    // because the front of a sign is read by somebody coming the other way. `back` is the same
    // board seen from the far side — the renderer picks between the two off which side of the panel
    // the camera is on, and works out neither of them.
    flags.road_sign = { rows: g.rows, back: g.back, face: g.deg, kind: g.kind };
    return { id, name: 'A Roadside Sign', danger, flags };
  }
  const wreck = wrecksOn(route).find(w => Math.abs(w.s - s) < 1.6 && Math.abs(t - w.side * w.off) < 0.7);
  if (wreck) {
    flags.building_type = 'reefer';
    flags.building_name = wreck.what;
    flags.floors = 1;
    flags.wreck = true;
    return { id, name: wreck.what, danger, flags };
  }
  // A structure sits just off the verge, on ONE side, at a milepost. The roll is seeded on the
  // MILEPOST rather than on the cell, and the chosen side/offset is compared against this cell —
  // otherwise every cell in the perpendicular row rolls independently and a single milepost
  // sprouts five buildings in a line across the desert (it did: 61 structures over 720 tiles,
  // five of them stacked at s=0). One marker, one building.
  const mile = Math.round(s);
  if (at >= 3.4 && mile % ROADSIDE_EVERY === 0) {
    const mrng = mulberry32(hashSeed(`${route.voidKey}|${route.window}|${route.destKey}|mile${mile}`));
    if (mrng() < 0.55) {
      const side = mrng() < 0.5 ? -1 : 1;
      const off = 4 + Math.floor(mrng() * (route.R - 3));   // clear of the widened shoulder
      if (Math.abs(t - side * off) < 0.7) {                 // a band, not an equality — see the wreck note
        const b = pick(mrng, ROADSIDE);
        flags.building_type = b.bt;
        flags.building_name = b.name;
        flags.floors = 1 + Math.floor(mrng() * 2);
        // Face the door at the road, so it reads as something that once served it. The facing is
        // the segment's own normal pointing back toward the centreline — which on a curve is not
        // one of two axis answers, so it is snapped to the nearest compass point here.
        const leg = hit.leg;
        flags.entrance = compassOf(-Math.sign(t) * leg.uy, Math.sign(t) * leg.ux);
        name = b.name;
      }
    }
  }
  return { id, name, danger, flags };
}

// The tile belongs to a road we are not on — the limb we did not take, or the one we did not take
// yet. Rendered in full (tarmac, shoulder, verge, its own roadside junk) because it IS a road and
// half a road out the side window is worse than none, but stamped so nothing downstream can
// mistake it for the road under the wheels.
//
// ⚠ `corridor_s` AND `corridor_node` ARE STRIPPED, and that is not tidiness. They are the two
// numbers the drive is derived from, and a cell carrying a *sibling's* odometer reading is a
// number that is wrong in a way that would look right — the one shape of bug this whole file is
// arranged to avoid. A branch cell says which branch it is and nothing about how far along it any
// of us happen to be.
function branchAt(route, x, y) {
  for (const b of route.branches || []) {
    const cell = corridorAt(b.route, x, y);
    if (!cell) continue;
    const { corridor_s, corridor_node, ...flags } = cell.flags;
    return { ...cell, flags: { ...flags, corridor_branch: b.key } };
  }
  return null;
}

// Bind a route to a provider with the (x, y) signature mapWindow wants. Pass the result straight
// in as `at` — see plugins/flight/state.js mapWindow.
export function corridorProvider(route) {
  return (x, y) => corridorAt(route, x, y);
}
