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
import { corridorAt, corridorLocate, composeRoad, bucketOf, routeBuckets, pairKey, OFFROAD_R, PAVED_R, SHOULDER_W } from './corridor.js';

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

// ── THE ROAD AS SOMETHING YOU CAN SEE FROM TEN MILES UP ──────────────────────
//
// `roadCellAt` answers one tile, which is the right question for a map window and the wrong one for
// a horizon: at 200 tiles the corridor is two pixels across and asking it tile by tile would be
// forty thousand lookups to draw a line. A route already IS a polyline — `legs` is a list of
// straight segments with an origin and a unit direction — so this hands that over and lets the
// client rasterise it onto the floor. See registerFarRoads in plugins/flight/state.js for why it
// must never become a cell provider.
//
// ⚠ THE SIMPLIFICATION IS THE FEATURE, NOT AN OPTIMISATION. A route is built to a minimum turn
// radius, so a long bend is dozens of legs each a degree or two off the last — several hundred
// points for a crossing, all of which project onto the same few pixels. Douglas-Peucker at a
// tolerance in TILES keeps exactly the points that would be visible as a change of direction, and
// the tolerance is deliberately coarse (a road is 1.9 tiles wide; half a tile of corner-cutting is
// invisible at the near end of this range and physically sub-pixel at the far end).
export const FAR_TOL = 0.5;   // Douglas-Peucker tolerance, tiles — regress asserts it stays under PAVED_R
// ⚠ THE POINT CAP IS THE RENDERER’S SEGMENT CAP, NOT A ROUND NUMBER. The floor shader carries a
// vec4[MAX_ROAD] and draws nothing past it (gl/floor.js, and MAX_ROAD_SEG beside it in
// windshield.js). P points over L lines is P−L segments, so capping POINTS at the shader’s array
// length can never overrun it — and anything above this would be bytes on a per-tick wire that the
// client throws away.
const FAR_MAX_PTS = 48;

// Perpendicular distance from p to the segment a-b, in tiles.
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  if (l2 < 1e-9) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Douglas-Peucker, iterative rather than recursive: a crossing can be several hundred points and a
// recursive split on a nearly-straight road recurses nearly that deep.
function simplify(pts, tol) {
  const n = pts.length / 2;
  if (n < 3) return pts;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    if (i1 - i0 < 2) continue;
    let best = -1, bestD = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const d = segDist(pts[i * 2], pts[i * 2 + 1], pts[i0 * 2], pts[i0 * 2 + 1], pts[i1 * 2], pts[i1 * 2 + 1]);
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best < 0) continue;
    keep[best] = 1;
    stack.push([i0, best], [best, i1]);
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

// One route as a flat [x0,y0, x1,y1, …] of ABSOLUTE world tiles, clipped to what is near (cx, cy).
//
// ⚠ CLIPPING KEEPS THE LEG THAT LEAVES THE CIRCLE, not just the legs inside it. Dropping a leg the
// moment its far end is out of range ends the road short of the horizon and puts a hard stop in
// mid-air; keeping one extra leg either side means the polyline always runs off past anything the
// floor can still draw.
function routeLine(route, cx, cy, radius) {
  const legs = route.legs || [];
  if (!legs.length) return null;
  const r2 = radius * radius;
  const near = (x, y) => { const dx = x - cx, dy = y - cy; return dx * dx + dy * dy <= r2; };
  const pts = [];
  let run = null;
  const runs = [];
  for (const l of legs) {
    const ax = l.x0, ay = l.y0, bx = l.x0 + l.ux * l.len, by = l.y0 + l.uy * l.len;
    // A leg counts as in range when either end is, OR when the circle sits beside its middle —
    // which is the case for the long leg you are flying along.
    const hit = near(ax, ay) || near(bx, by) || segDist(cx, cy, ax, ay, bx, by) <= radius;
    if (hit) { if (!run) { run = [ax, ay]; } run.push(bx, by); }
    else if (run) { runs.push(run); run = null; }
  }
  if (run) runs.push(run);
  if (!runs.length) return null;
  for (const r of runs) {
    const sm = simplify(r, FAR_TOL);
    if (sm.length >= 4) pts.push({ pts: sm, d: runDist(r, cx, cy) });
  }
  return pts.length ? pts : null;
}

// How near a run comes to the viewer, so the point budget can be spent on the road you are
// actually looking down before the one over the horizon behind you.
// The longest contiguous stretch of `pts` that fits in `budget` points, centred on the vertex
// nearest (cx, cy) and grown outward a point at a time from whichever side is nearer.
function aroundNearest(pts, cx, cy, budget) {
  const n = pts.length / 2;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const dx = pts[i * 2] - cx, dy = pts[i * 2 + 1] - cy, d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  let lo = best, hi = best;
  const distAt = (i) => { const dx = pts[i * 2] - cx, dy = pts[i * 2 + 1] - cy; return dx * dx + dy * dy; };
  while (hi - lo + 1 < budget && (lo > 0 || hi < n - 1)) {
    const canLo = lo > 0, canHi = hi < n - 1;
    if (canLo && (!canHi || distAt(lo - 1) <= distAt(hi + 1))) lo--; else hi++;
  }
  return pts.slice(lo * 2, (hi + 1) * 2);
}

function runDist(run, cx, cy) {
  let best = Infinity;
  for (let i = 0; i + 3 < run.length; i += 2) {
    const d = segDist(cx, cy, run[i], run[i + 1], run[i + 2], run[i + 3]);
    if (d < best) best = d;
  }
  return best;
}

// Every road within `radius` of (x, y), as polylines the client can draw.
//
// ⚠ ONE BAND, NOT TWO, AND THAT IS WHAT THE GROUND ACTUALLY LOOKS LIKE. `corridorAt` answers
// `terrain: 'road'` + `road_dirt` for the carriageway and `terrain: 'dirt_road'` for the shoulder,
// and `deriveSurfaceCell` turns BOTH into `ft: 'dust'` — the packed-dirt look. The only thing that
// tells them apart out the canopy is the lane markings, which are a near-field detail. So `w` is
// the outer edge of the graded strip, which is the whole width of the scar this road leaves.
//
// ⚠ ONE WIDTH FOR THE WHOLE ROAD, AND THAT IS A RANGE ARGUMENT RATHER THAN A SHORTCUT. `pavedAt`
// tapers the carriageway over the last 26 tiles at each end, which matters when you are driving
// onto it; this is drawn from 36 tiles out to the horizon, where the whole taper is a fraction of
// one pixel. The near half of the road is real cells and keeps the taper.
//
// ⚠ MEMOISED ON A COARSE CELL, BECAUSE THIS RUNS ON A PER-TICK PATH FOR EVERY PILOT AND EVERY CAB.
// Rebuilding it means walking every leg of every road in the world and simplifying each run — a few
// hundred segment-distance solves — to answer a question whose answer does not change while you
// move a few tiles. The query point is snapped to FAR_CELL and the clip radius grown by the
// snapping error, so the cached answer is valid everywhere inside the cell rather than merely
// close: without that margin a craft at the far corner of a cell would be handed a road clipped
// short of its own horizon. One slot, keyed on the network OBJECT — a new week or a moved gate
// builds a new network, and a stale entry cannot survive that.
const FAR_CELL = 48;
let _farMemo = null;
export function farRoadLines(x, y, radius) {
  const net = roadNetwork();
  if (!net.routes.length) return null;
  const cx = Math.round(x / FAR_CELL) * FAR_CELL, cy = Math.round(y / FAR_CELL) * FAR_CELL;
  const r = radius + FAR_CELL * 0.71;   // half a cell diagonal — the worst the snap can be out by
  const m = _farMemo;
  if (m && m.net === net && m.cx === cx && m.cy === cy && m.r === r) return m.out;
  const out = buildFarRoadLines(net, cx, cy, r);
  _farMemo = { net, cx, cy, r, out };
  return out;
}
// ⚠ WHAT A TIGHT BUDGET GIVES UP IS LENGTH, FROM THE FAR END, AND NEVER DETAIL OR THE NEAR END.
//
// Two obvious ways to bound this are both wrong. Coarsening the tolerance is wrong because the
// tolerance is what keeps the drawn line ON THE TARMAC — Douglas-Peucker cuts corners by up to its
// tolerance, so anything above the paved half-width draws a road running beside the real one, and
// the regress case for that is in plugins/trucking/regress.js. And slicing a run at its own start
// is wrong because a run is built in the ROUTE’S order, not yours: the part kept would be whichever
// end is nearest the road’s ORIGIN, which may be a hundred tiles behind you, so the road you are
// flying down would be the half that got dropped.
//
// So the budget is spent nearest-first, and a run too long for what is left is grown OUTWARD from
// its closest vertex until the budget runs out. The road then always reaches you and always runs
// away in both directions; what it loses is its far end, under the haze, where nothing can be seen
// of it anyway.
function buildFarRoadLines(net, x, y, radius) {
  const cand = [];
  for (const r of net.routes) {
    const lines = routeLine(r, x, y, radius);
    if (lines) for (const l of lines) cand.push(l);
  }
  cand.sort((a, b) => a.d - b.d);
  const out = [];
  let budget = FAR_MAX_PTS;
  for (const c of cand) {
    if (budget < 2) break;
    const line = c.pts.length / 2 <= budget ? c.pts : aroundNearest(c.pts, x, y, budget);
    if (line.length < 4) continue;   // a single point is not a road
    out.push(line);
    budget -= line.length / 2;
  }
  if (!out.length) return null;
  // Rounded to a tenth of a tile: this goes over the wire on a tick and a tenth of a tile is two
  // orders of magnitude finer than one far pixel.
  return { w: PAVED_R + SHOULDER_W, lines: out.map((p) => p.map((v) => Math.round(v * 10) / 10)) };
}

export const _test = { buildNetwork, mergeIndices };
