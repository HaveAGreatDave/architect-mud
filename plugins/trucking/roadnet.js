// plugins/trucking/roadnet.js — THE WEEK'S WHOLE ROAD, AS SOMETHING THAT EXISTS WHETHER OR NOT
// ANYBODY IS DRIVING IT.
//
// Until now a corridor was a thing a RIG had. `providerFor` composed one rig's own route over the
// world, and everybody else got `surfaceAt` — so the highway between two regions existed for the
// driver on it and for nobody else. A pilot flying Coldwater→Terminus crossed 282 tiles of
// `kind: 'air'`: not open country, not desert, nothing at all, over ground carrying a four-lane
// road with boards counting down the miles. Three people could be on the same journey and no two
// of them could describe it to each other.
//
// THE ROAD WAS ALREADY GLOBAL. Nothing here invents geometry:
//
//   • `networkRoute` seeds the middle on `pairKey` (the sorted gate ids) and REVERSES it for the
//     other direction, so Coldwater→Reach and Reach→Coldwater are literally the same tarmac. There
//     is one road per pair of gates, not one per driver and not one per direction.
//   • Every argument that road takes is static: `gatePair` derives the mouths from the map,
//     `destsFor` derives the room counts, and the week gives the seed. `previewRoute` has relied on
//     exactly that since the approach stopped popping in at the rim.
//
// So the network is a pure function of (gates, week) and this module is bookkeeping: build each
// road once, index them together, and answer "what is at this tile" for anyone who asks.
//
// ⚠ RENDER AND TRAFFIC ONLY. THIS MUST NEVER REACH `surfaceAt`.
//
// `surfaceAt` is the index of PLACED tiles, and three separate systems ask it a question whose
// whole meaning is "the world stops here":
//
//   • `regionGates` (state.js) finds a region's road mouths by testing `!surfaceAt(x±1, y±1)` —
//     a rim tile is one the map genuinely stops beside. Fold the corridor into `surfaceAt` and
//     every gate tile grows a neighbour, no region has a rim any more, and the gates this module
//     is built out of vanish.
//   • voidwalking's `isMapRim` asks the same question of the placed-coord set. No rim means no
//     `movement.edge`, which means no muster, which means the void has no entrance at all.
//   • `bounds`, `nearestAirfield` and the landing paths all read placed ground.
//
// The overlay is therefore handed to `mapWindow` as a CELL PROVIDER — the parameter that already
// exists for exactly this, and the one the cab has used since the corridor was built — and never
// installed under the index. See `registerCellOverlay` in plugins/flight/state.js.
import { VOIDS, currentWindow } from '../voidwalking/index.js';
import { surfaceAt } from '../flight/state.js';
import { buildRoad, destsFor, gatePair, gateGeneration } from './state.js';
import { corridorAt, corridorLocate, composeRoad, bucketOf, routeBuckets, pairKey, OFFROAD_R } from './corridor.js';

// One built network per (week, gate generation). The roads are a pure function of exactly those two
// things, so this is a memo rather than a cache with a coherence problem.
//
// ⚠ THE GATE GENERATION IS HALF THE KEY, AND IT IS NOT DEFENSIVE PROGRAMMING. Every metre of every
// road here is anchored on a pair of rim gates, which are derived from tile positions and memoised
// in state.js. Move a region in the editor and those mouths move; a network still holding the old
// ones is a highway running to where a gate used to be — drivable, drawn, and wrong, with nothing
// anywhere saying so. Keying on `gateGeneration()` means the two caches cannot be left in different
// eras, which "remember to call clearRoadNet too" would not: regress already clears gates directly,
// in the middle of a suite, and would have been the first thing to get it wrong.
//
// ⚠ THE KEY IS TWO NUMBERS, NOT A STRING. This is checked once per CELL — 26,000 times per window
// push — so a `${window}|${gen}` template built on every call is 26,000 throwaway strings a push,
// which measured as a third of the whole overlay's cost. Two integer comparisons cost nothing.
let _net = null;         // { window, routes, index, minX, maxX, minY, maxY }
let _netWindow = -1;     // the week it was built for
let _netGen = -1;        // the gate generation it was built against

// ── BUILDING IT ──────────────────────────────────────────────────────────────
//
// ⚠ ONE ROAD PER PAIR OF GATES, NOT ONE PER DESTINATION ROW. `VOIDS` lists both directions of every
// leg (Coldwater→Reach and Reach→Coldwater are two rows), and `networkRoute` hands back the same
// tarmac for both — so building every row would lay each highway twice on top of itself. Doubling
// the per-cell cost is the least of it: the two copies carry different `destKey`s and different
// boards, so which one answered for a tile would depend on iteration order.
//
// `pairKey` is the identity for the same reason it is the seed: the unordered pair of gate ids.
// Whichever direction we reach first builds it, and the other is skipped rather than reconciled,
// because there is nothing to reconcile — it is the same road.
function buildNetwork(window) {
  const routes = [];
  const seen = new Set();
  for (const fromKey of Object.keys(VOIDS)) {
    // The same list the approach preview and the live drive read. A road whose room count came from
    // anywhere else would be a different length from the one a truck actually drives.
    const dests = destsFor(fromKey, null);
    for (const d of dests) {
      const pair = d.region ? gatePair(fromKey, d.region) : null;
      if (!pair) continue;                       // no mouth at one end — that leg has no road
      const key = pairKey(pair.from.id, pair.to.id);
      if (seen.has(key)) continue;
      seen.add(key);
      // ⚠ `withSiblings: false`. Sibling branches are how a DRIVEN road shows you the other limbs
      // out of the junction you are approaching; here every limb in the world is already its own
      // top-level entry, so siblings would be a second copy of roads this list already holds.
      //
      // `dests` IS passed, so the road gets its boards. They face the direction it was built in,
      // which is the one visible asymmetry in the whole network: a pilot sees the canonical
      // direction's mile boards, and a driver running the other way sees their own (their cab
      // composes their OWN route — see providerFor — so nothing about the drive changes). Both sets
      // stand on the same road and say the same distances; only the tiles they stand on differ.
      const road = buildRoad(fromKey, d.key, d.region, window, d.nodes, dests, false);
      if (road) routes.push(road);
    }
  }
  return { window, routes, index: mergeIndices(routes), paved: mergePaved(routes), ...netBounds(routes) };
}

// The rectangle every road in the world fits inside. Four numeric comparisons, and it rejects a
// caller nowhere near the road network at all — the Echelon's helm window up in the basin, a tile
// probe out past the map. It does NOT help a pilot over Coldwater: the highway to Terminus runs
// along the city's own south edge, so the city is inside this rectangle. That case is what the
// narrow `paved` index below exists for.
function netBounds(routes) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const r of routes) {
    for (const l of r.legs || []) {
      const x1 = l.x0 + l.ux * l.len, y1 = l.y0 + l.uy * l.len;
      minX = Math.min(minX, l.x0, x1); maxX = Math.max(maxX, l.x0, x1);
      minY = Math.min(minY, l.y0, y1); maxY = Math.max(maxY, l.y0, y1);
    }
  }
  // The pad is what a route claims either side of its centreline — the same OFFROAD_R band
  // `corridorAt` will answer for — plus a tile of slack for the rounding a caller has already done.
  const pad = OFFROAD_R + 1;
  return { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };
}

// Every route's own bucket index, merged into one bucket → routes map.
//
// A pilot's window is 73×73, and `deriveSurfaceCell` probes four neighbours per cell for the road
// auto-tiler, so a single push asks this ~26,000 times. Walking the route list per cell would be
// one Map get per road per cell for an answer that is almost always "no road here". Merged, a miss
// is ONE Map get and returns null; a hit hands back the one or two roads that could possibly claim
// the tile, and `corridorAt` does the real work only for those.
function mergeIndices(routes) {
  const idx = new Map();
  for (const r of routes) {
    if (!r.index) continue;                      // a hand-made route in a test — it just runs slowly
    for (const k of r.index.keys()) {
      const arr = idx.get(k);
      if (arr) { if (!arr.includes(r)) arr.push(r); } else idx.set(k, [r]);
    }
  }
  return idx;
}

// THE NARROW INDEX — the buckets a road's TARMAC could possibly be in.
//
// The full index above pads every leg by the off-road band, twenty-four tiles either side, because
// that is the range `locate` answers over. Tarmac is `|t| < pavedAt`, which never exceeds `PAVED_R`
// — under a tile. So over placed ground, where only tarmac can beat the world, almost every lookup
// the wide index accepts is one the narrow index rejects outright.
//
// ⚠ THE PAD IS GENEROUS ON PURPOSE. `PAVED_R` is the half-width at the centreline, and a caller
// asks about a TILE CENTRE that may sit a little off it, on a road running diagonally, at a bend.
// Three tiles is far more slack than any of that needs and still rejects the overwhelming majority;
// too tight and the highway develops holes over the one place they would be hardest to notice.
const PAVED_PAD = 3;
function mergePaved(routes) {
  const idx = new Map();
  for (const r of routes) {
    for (const k of routeBuckets(r, PAVED_PAD)) {
      const arr = idx.get(k);
      if (arr) arr.push(r); else idx.set(k, [r]);
    }
  }
  return idx;
}

// The tarmac-only lookup `composeRoad` takes as its fast path. Same answer as `roadCellAt` whenever
// there IS tarmac here; null rather than a verge cell when there is not, which is all the caller
// needs to know because the placed world wins that case anyway.
function tarmacCellAt(x, y) {
  const net = roadNetwork();
  if (x < net.minX || x > net.maxX || y < net.minY || y > net.maxY) return null;
  const near = net.paved.get(bucketOf(x, y));
  if (!near) return null;
  let best = null, bestD = Infinity;
  for (const r of near) {
    const loc = corridorLocate(r, x, y);
    if (!loc) continue;
    const d = Math.abs(loc.t);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best ? corridorAt(best, x, y) : null;
}

export function roadNetwork(window = currentWindow()) {
  const gen = gateGeneration();
  if (_net && _netWindow === window && _netGen === gen) return _net;
  const built = buildNetwork(window);
  // ⚠ AN EMPTY NETWORK IS NOT MEMOISED. `regionGates` sweeps `getAllZones()`, so asking this before
  // the world is in memory answers "no roads anywhere" — and caching that would leave the highway
  // switched off for the life of the process, on a key nothing would ever invalidate. Every real
  // caller runs long after boot; this costs one wasted pass in the case that would otherwise be
  // silent and permanent.
  if (!built.routes.length) return built;
  _net = built;
  _netWindow = window;
  _netGen = gen;
  return _net;
}

// Drop the built network by hand. The gate generation above already covers an editor moving a
// region, so this is for a caller that has changed something else the roads are built out of —
// principally the regress suite, which rebuilds the world between suites.
export function clearRoadNet() { _net = null; _netWindow = -1; _netGen = -1; }

// ── ASKING IT ────────────────────────────────────────────────────────────────

// The corridor cell at a world tile, from whichever road claims it — or null for "no road here".
// Same shape `corridorAt` returns, which is the same shape `surfaceAt` returns, which is the whole
// contract that lets this go anywhere a cell provider goes.
//
// ⚠ NEAREST CENTRELINE WINS, AND BOTH SIMPLER RULES ARE WRONG. `corridorAt` answers for the whole
// band a road claims — carriageway, shoulder, and open filler out to OFFROAD_R, twenty-four tiles
// either side — so roads near each other overlap in their FILLER long before they overlap in their
// tarmac. The Coldwater→Terminus highway passes within thirteen tiles of the Scarletwastes road's
// mouth and claims it as open hardpan.
//
//   • FIRST ANSWER WINS put a hole in the Scarletwastes highway wherever the two overlapped:
//     carriageway for the driver on it, hardpan for the pilot above.
//   • CARRIAGEWAY BEATS VERGE looks like the fix and is not, because `isCarriageway` is true of the
//     SHOULDER as well as the tarmac (that is its job — it is the test for "a road is laid here").
//     So it picked one road's shoulder over another road's highway, which is how the Deadwater
//     road's mouth came out as the Reach road's dirt margin.
//
// This is the rule corridor.js already applies BETWEEN SEGMENTS of one route — "nearest centreline
// wins, so a bend is a road rather than a seam" — applied one level up, between roads. Where two
// genuinely share tarmac (the spoke out of a gate, which every road leaving it runs down) the
// distances tie and either answer is the same piece of road.
export function roadCellAt(x, y) {
  const net = roadNetwork();
  if (x < net.minX || x > net.maxX || y < net.minY || y > net.maxY) return null;
  const near = net.index.get(bucketOf(x, y));
  if (!near) return null;
  // The overwhelmingly common case, and it skips the locate-then-locate-again below. Network routes
  // are built `withSiblings: false`, so `corridorAt`'s branch fallthrough is a no-op here either way.
  if (near.length === 1) return corridorAt(near[0], x, y);
  let best = null, bestD = Infinity;
  for (const r of near) {
    const loc = corridorLocate(r, x, y);
    if (!loc) continue;
    const d = Math.abs(loc.t);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best ? corridorAt(best, x, y) : null;
}

// THE PROVIDER EVERYBODY WHO IS NOT DRIVING GETS.
//
// Bound once and reused: `composeRoad` closes over two functions and allocating a fresh closure per
// push would be pointless garbage on a 3s tick. The composition rule is corridor.js's — the same
// one `providerFor` binds for a driver — so the ground under a truck and the ground under the plane
// above it come out of the same decision rather than out of two that happen to agree.
const _provider = composeRoad(roadCellAt, surfaceAt, tarmacCellAt);
export function worldRoadProvider() { return _provider; }

// Is this tile on the carriageway of any road in the world? The traffic question, not the render
// one: it is what lets a rig out on the corridor be reported as traffic to a pilot overhead, and it
// deliberately reads the same geometry the pilot is looking at rather than a range check.
export function onRoadNetwork(x, y) {
  const c = roadCellAt(Math.round(x), Math.round(y));
  return !!c;
}

export const _test = { buildNetwork, mergeIndices };
