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
// The road is a polyline of axis-aligned LEGS. Axis-aligned because the renderer's road pass
// paints lane markings toward connected tile edges (`rd`), so a diagonal would have to be drawn as
// a staircase of turn pieces and would read as a series of hairpins rather than a curve. A long
// leg with an occasional jog reads as a highway; that is the whole geometry budget.
const LEG_MIN = 140;      // tiles — a leg shorter than this reads as a wiggle, not a bend
const LEG_JOG = 26;       // tiles of lateral travel in a jog leg

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
  let s = 0, x = 0, y = 0, jog = false;   // leave the gate heading down-corridor (+y)
  while (s < L) {
    const onTrunk = s < trunkL;
    const rng = onTrunk ? trunkRng : limbRng;
    // A run is long; a jog is short and lateral. They strictly alternate, because two jogs in a
    // row is a chicane and nobody builds one of those across a waste. The last leg is always a
    // run and is trimmed to land exactly on L, so the road ends where the room chain ends.
    let len = jog
      ? Math.min(L - s, LEG_JOG)
      : Math.min(L - s, LEG_MIN + Math.floor(rng() * LEG_MIN));
    if (onTrunk) len = Math.min(len, trunkL - s);          // never straddle the junction
    const ux = jog ? (rng() < 0.5 ? -1 : 1) : 0;
    const uy = jog ? 0 : 1;
    legs.push({ s0: s, s1: s + len, x0: x, y0: y, ux, uy, len, trunk: onTrunk });
    x += ux * len; y += uy * len; s += len;
    // Only jog if there's room for a full run afterwards — otherwise the route would end on a
    // sideways stub pointing away from the destination. The one forced jog is the FORK itself:
    // the limb leaves the trunk sideways, so a junction is something you can see from the cab
    // rather than a room name changing.
    if (onTrunk && s >= trunkL && trunkL > 0 && (L - s) > LEG_MIN) jog = true;
    else jog = !jog && (L - s) > LEG_MIN && rng() < 0.55;
  }
  return { voidKey, destKey, window, nodes: n, L, R: CORRIDOR_R, legs, trunkL };
}

// Where is (s, t) in corridor XY? Used to place the truck and to seed the cab's start pose.
export function corridorPos(route, s, t = 0) {
  const cs = Math.max(0, Math.min(route.L, s));
  const leg = route.legs.find(l => cs >= l.s0 && cs <= l.s1) || route.legs[route.legs.length - 1];
  const d = cs - leg.s0;
  // Lateral is perpendicular to travel: a north-south leg offsets in x, an east-west leg in y.
  const px = leg.x0 + leg.ux * d + (leg.uy ? t : 0);
  const py = leg.y0 + leg.uy * d + (leg.ux ? t : 0);
  return { x: px, y: py, heading: leg.uy ? 180 : (leg.ux > 0 ? 90 : 270) };
}

// The inverse, and the hot one: for a corridor XY, which leg is it on, how far along, how far off?
// Returns null when the point is on no leg — that is off-corridor, which renders as open air.
// Legs are few (a handful per route) so a linear scan is cheaper than any index.
const OFFROAD_MUL = 4;   // must match OFFROAD_R's multiple — one road, one width
function locate(route, x, y) {
  let best = null;
  for (const leg of route.legs) {
    let d, t;
    if (leg.uy) { d = y - leg.y0; t = x - leg.x0; }        // running in +y, lateral is x
    else { d = (x - leg.x0) * leg.ux; t = y - leg.y0; }    // running in ±x, lateral is y
    if (d < 0 || d > leg.len) continue;
    // ⚠ THE VERGE IS INSIDE THE GEOMETRY, NOT OUTSIDE IT. Locating out to the off-road limit rather
    // than to the pavement edge is what makes driving off the road DRIVING rather than a stall: the
    // odometer still derives, the node still tracks, the cells still render. What changes out here
    // is the surface under the wheels, and the surface is the punishment.
    if (Math.abs(t) > route.R * OFFROAD_MUL) continue;
    const cand = { s: leg.s0 + d, t, leg };
    // Near a joint two legs both claim the tile; the paved one (smaller |t|) wins, so the corner
    // gets a road tile rather than a hole where the two runs fail to meet.
    if (!best || Math.abs(t) < Math.abs(best.t)) best = cand;
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
// Which way does a leg travel, as a compass letter? (+y is south, matching the world grid.)
const legDir = leg => leg.uy ? 's' : (leg.ux > 0 ? 'e' : 'w');
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };

function roadIcon(route, hit) {
  const { leg, s } = hit;
  // A bend carries the direction the road ARRIVED from and the direction it LEAVES in — 'nw' for
  // a southbound run turning west, not the union of both axes. Unioning gives 'nesw', which the
  // renderer draws as a four-way crossroads, so every bend in the highway would sprout two lane
  // markings into empty desert.
  for (const other of route.legs) {
    if (other === leg) continue;
    if (other.s0 === leg.s1 && Math.abs(s - leg.s1) <= 1) {
      return `road_${OPP[legDir(leg)]}${legDir(other)}`;          // this leg ends here, that one starts
    }
    if (other.s1 === leg.s0 && Math.abs(s - leg.s0) <= 1) {
      return `road_${OPP[legDir(other)]}${legDir(leg)}`;          // that leg ends here, this one starts
    }
  }
  return 'road_' + (leg.uy ? 'ns' : 'ew');
}

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
  if (at < 0.5) {
    return { id, name: 'The Highway', danger,
      flags: { terrain: 'road', icon: roadIcon(route, hit), corridor_s: s, corridor_node: node } };
  }
  // The shoulder — graded dirt. `dirt_road` is what earns it the renderer's packed-dirt look
  // (ft:'dust'), so drifting onto it is visible before any penalty text fires.
  if (at < 1.5) {
    return { id, name: 'The Shoulder', danger,
      flags: { terrain: 'dirt_road', icon: roadIcon(route, hit), corridor_s: s, corridor_node: node } };
  }
  // The verge. Node terrain, and very occasionally something somebody built and left.
  const rng = mulberry32(hashSeed(`${route.voidKey}|${route.window}|${route.destKey}|${x},${y}`));
  const flags = { terrain, corridor_s: s, corridor_node: node };
  let name = pick(rng, VERGE_NAMES);
  // A wreck from a real haul, standing where its driver gave up on it. It borrows `reefer` — the
  // roadside table's own dead-truck model — rather than introducing a building type the renderer
  // has never heard of, which is the difference between a hulk on the verge and an untextured box.
  const wreck = wrecksOn(route).find(w => Math.abs(w.s - s) < 1.2 && Math.round(t) === w.side * w.off);
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
  if (at >= 2.5 && mile % ROADSIDE_EVERY === 0) {
    const mrng = mulberry32(hashSeed(`${route.voidKey}|${route.window}|${route.destKey}|mile${mile}`));
    if (mrng() < 0.55) {
      const side = mrng() < 0.5 ? -1 : 1;
      const off = 3 + Math.floor(mrng() * (route.R - 2));   // 3 .. R
      if (Math.round(t) === side * off) {
        const b = pick(mrng, ROADSIDE);
        flags.building_type = b.bt;
        flags.building_name = b.name;
        flags.floors = 1 + Math.floor(mrng() * 2);
        // Face the door at the road, so it reads as something that once served it. The facing is
        // perpendicular to the leg being driven, on the side the building actually sits.
        const leg = hit.leg;
        flags.entrance = leg.uy ? (t > 0 ? 'west' : 'east') : (t > 0 ? 'north' : 'south');
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
