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
// COORDINATE SPACE. The corridor has its own integer grid, origin at the gate. It is NOT world
// space and never overlaps it — void rooms carry `grid_x: null`, so there is nothing to collide
// with. A position is (s, t):
//   s = distance travelled along the route, in tiles, 0 → L
//   t = lateral offset from the centreline, −R → +R
// The truck's odometer IS `s`, which is why `s` is the value the server defends hardest.
//
// SEEDING. Every cell is a pure function of (voidKey, destKey, window, x, y) using the same
// hashSeed/mulberry32 pair voidwalking seeds its rooms with, and the same weekly window. So
// everyone driving this route this week drives the identical road, a relog regenerates it
// byte-for-byte, and the regress suite can pin a window and get a fixed layout.
//
// NODES. `node = floor(s / TILES_PER_ROOM)` maps a point on the road back to the void room the
// driver is standing in. Crossing a node boundary is the driving equivalent of a `move`, which is
// what lets encounters, detours, traces and the crossing's player_flags all work untouched.

// Kept in step with plugins/voidwalking (TILES_PER_ROOM = 90). It is not exported from there as a
// public name, and importing the plugin for one integer would drag its whole boot in; the regress
// suite asserts the two agree, so a change there fails here loudly rather than silently halving
// the length of every haul.
export const TILES_PER_ROOM = 90;

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
export function corridorFor(voidKey, destKey, window, nodes, trunkNodes = 0) {
  const n = Math.max(1, nodes | 0);
  const L = n * TILES_PER_ROOM;
  const trunkL = Math.max(0, Math.min(L, (trunkNodes | 0) * TILES_PER_ROOM));
  const trunkRng = mulberry32(hashSeed(`${voidKey}|${window}|trunk`));
  const limbRng = mulberry32(hashSeed(`${voidKey}|${destKey}|${window}|corridor`));
  const legs = [];
  let s = 0, x = 0, y = 0;
  let hdg = 180;              // leave the gate heading down-corridor (due south, +y)
  let hold = 0, kappa = 0;    // tiles left in the current straight-or-arc, and its curvature (°/tile)
  let forkedAt = -1;          // the s the fork bend was armed at, so it is armed exactly once
  while (s < L) {
    const onTrunk = s < trunkL;
    const rng = onTrunk ? trunkRng : limbRng;
    // THE FORK IS A BEND YOU CAN SEE FROM THE CAB. Every destination out of a void shares its first
    // `trunk` rooms, so the tarmac over them must be identical whichever way you are eventually
    // going — which means the trunk is seeded WITHOUT destKey and the limb WITH it, and no piece of
    // road may straddle the boundary. The old geometry marked the junction with a forced sideways
    // jog; a curve marks it with a forced hard-as-allowed sweeper in a destination-seeded direction,
    // so the two limbs visibly peel apart at the same tile rather than a room name changing.
    const off = hdg - 180;   // how far the road currently points from due south
    if (!onTrunk && trunkL > 0 && forkedAt < 0 && (L - s) > ARC_MIN) {
      forkedAt = s;
      // ⚠ THE FORK ARC'S LENGTH MUST BE DESTINATION-SEEDED, NOT JUST ITS DIRECTION. Seeding only the
      // direction is the obvious way to write this and it does not work: where the leash forces the
      // turn, BOTH limbs are forced the same way, and a straight preserves heading — so two limbs
      // that leave the trunk on an identical arc then run parallel, tile for tile, for as long as
      // the next straight lasts. They were still one road 200 tiles past the junction. Varying the
      // arc LENGTH per destination makes the two headings differ the moment the bend ends, so the
      // limbs part company at the fork whichever way each of them happens to turn.
      hold = ARC_MIN + Math.floor(limbRng() * ARC_VAR);
      // The limb peels off hard, in a destination-seeded direction — unless that would breach the
      // leash, in which case it peels the other way. ⚠ The TIGHTNESS is seeded too, and that is what
      // actually guarantees the split: where the leash forces both limbs the same way, an identical
      // curvature keeps them on the same tiles until the arc ends, so the roads ran as one for a
      // full void room past the junction. Different curvature means different headings from the
      // first segment, so the limbs splay apart at the fork itself whichever way each one turns.
      const away = Math.abs(off) > HOME_BIAS ? -Math.sign(off) : (limbRng() < 0.5 ? -1 : 1);
      kappa = away * (1 / MIN_RADIUS) * R2D * (0.5 + limbRng() * 0.5);
    }
    if (hold <= 0) {
      // Straights and bends strictly alternate. Two arcs back to back is a chicane, and nobody
      // builds one of those across a waste.
      if (kappa === 0) {
        hold = ARC_MIN + Math.floor(rng() * ARC_VAR);
        // Curvature is capped at the minimum-radius invariant and then softened at random, so most
        // bends are gentler than the tightest one the road is allowed to hold.
        const tightness = 0.35 + rng() * 0.65;
        const dir = Math.abs(off) > HOME_BIAS ? -Math.sign(off) : (rng() < 0.5 ? -1 : 1);
        kappa = dir * (1 / MIN_RADIUS) * R2D * tightness;
      } else {
        hold = STRAIGHT_MIN + Math.floor(rng() * STRAIGHT_VAR);
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
    if (hdg - 180 > HOME_MAX) { hdg = 180 + HOME_MAX; hold = 0; }
    if (hdg - 180 < -HOME_MAX) { hdg = 180 - HOME_MAX; hold = 0; }
  }
  const route = { voidKey, destKey, window, nodes: n, L, R: CORRIDOR_R, legs, trunkL };
  route.index = buildIndex(route);
  return route;
}

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
  if (!hit) return null;                                  // beyond the corridor: open air
  const { s, t } = hit;
  const node = Math.max(0, Math.min(route.nodes - 1, Math.floor(s / TILES_PER_ROOM)));
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
  const deg = ((hit.leg.deg % 360) + 360) % 360;
  const PAVED = 1.2, SHOULDER = 2.4;
  if (at < PAVED) {
    return { id, name: 'The Highway', danger,
      flags: { terrain: 'road', icon: roadIcon(hit), road_deg: deg, road_t: +t.toFixed(3), road_w: PAVED,
        corridor_s: s, corridor_node: node } };
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

// Bind a route to a provider with the (x, y) signature mapWindow wants. Pass the result straight
// in as `at` — see plugins/flight/state.js mapWindow.
export function corridorProvider(route) {
  return (x, y) => corridorAt(route, x, y);
}
