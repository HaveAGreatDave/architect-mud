import { world, propsOf } from './world.js';
import { neighborZoneIds } from './exits.js';

// Can a route cross this tile? The resolved `routable` property answers it — terrain
// water presets it false, and a tile overrides it either way (a frozen bay is water
// you CAN walk). Asking the capability instead of the paint is the point:
// docs/proposals/terrain-property-presets.md.
//
// This used to test a `flags.water` boolean that had been migrated away and sat on no
// row, so both checks below were silently no-ops and routes crossed a 945-tile basin.
function isBlocked(zone) { return !!zone && !propsOf(zone.id).routable; }

// A walkable street tile: an actual road/runway surface, or a tagged artery. These are
// the tiles a route should hug. Building facades, interiors, plazas and lots are not.
function isRoadZone(zone) {
  const f = zone?.flags || {};
  return /^(road_|runway_)/.test(f.icon || '') || !!f.artery;
}
// Cost to ENTER a zone in the road-preferring search. Roads are cheap so the route sticks
// to the street grid; buildings/interiors are dear so the path only touches them at the
// unavoidable origin and destination. Returns Infinity for tiles a walker can't stand on
// (open water) so they're never routed through.
function stepCost(zone) {
  if (!zone) return 8;
  const f = zone.flags || {};
  if (isBlocked(zone)) return Infinity;
  if (isRoadZone(zone)) return 1;
  if (f.street_life) return 2;          // outdoor street tile that isn't a marked road
  if (f.facade || f.is_building) return 60;   // a building face — endpoints only
  return 10;                            // interiors, plazas, lots, misc
}

// Path over the zone.exits adjacency graph, returning zone IDs from startId → targetId
// (inclusive), or null if unreachable. Crosses map boundaries freely — interior↔exterior
// traversal works because exits already encode those links.
//
// `roads: true` runs a road-preferring least-cost search (Dijkstra over stepCost) instead
// of plain BFS, so GPS routes stay on the street grid, leaving it only for the start/end
// building. `maxDistance` bounds the route in HOPS in both modes.
//
// `avoid` (a Set of zone ids) removes tiles from the search entirely — used by GPS
// auto-walk to route AROUND a tile whose entrance turned out to be blocked (a locked
// door, a gated apartment) instead of dead-ending at it. The target is never avoided,
// so "route to a tile behind a locked door" still resolves (and legitimately fails
// only when there's no other way in).
//
// Results without `avoid` are cached (see ROUTE_CACHE below): NPC AI asked for the
// same routes every 15 s tick and the searches were half the server's idle CPU.
export function findPath(startId, targetId, { maxDistance = 60, roads = false, avoid = null } = {}) {
  if (startId === targetId) return [startId];
  if (avoid?.size) return search(startId, targetId, maxDistance, roads, avoid);
  const key = `${roads ? 'r' : 'b'}${maxDistance}|${targetId}|`;
  const hit = cachedRoute(key, startId);
  if (hit !== undefined) return hit;
  const path = search(startId, targetId, maxDistance, roads, null);
  storeRoute(key, startId, path);
  return path ? path.slice() : null;
}

// ── Route cache ──────────────────────────────────────────────────────────────
// Exits are edited in place from many sites, so there's no "graph changed" event to
// key on. Entries expire instead, and a hit is reused only if its first step is
// still an exit of the start tile. A found route also caches each of its tails
// (every tail of a least-cost route is least-cost from that tile), so an NPC
// walking a route hits the cache on every step. Failures are cached longer: an
// NPC with no way to work used to rerun a 150-room search every tick.
const ROUTE_TTL_MS = 2 * 60_000;
const FAIL_TTL_MS = 5 * 60_000;
const ROUTE_CACHE_MAX = 20_000;
const routeCache = new Map();   // key + startId → { path, i, until } | { path: null, until }

function cachedRoute(key, startId) {
  const e = routeCache.get(key + startId);
  if (!e) return undefined;
  if (Date.now() > e.until) { routeCache.delete(key + startId); return undefined; }
  if (!e.path) return null;
  const next = e.path[e.i + 1];
  if (next !== undefined && !neighborZoneIds(world.zones.get(startId)).includes(next)) {
    routeCache.delete(key + startId);
    return undefined;
  }
  return e.path.slice(e.i);
}

function storeRoute(key, startId, path) {
  if (routeCache.size > ROUTE_CACHE_MAX) routeCache.clear();
  const now = Date.now();
  if (!path) { routeCache.set(key + startId, { path: null, until: now + FAIL_TTL_MS }); return; }
  const until = now + ROUTE_TTL_MS;
  for (let i = 0; i < path.length - 1; i++) routeCache.set(key + path[i], { path, i, until });
}

// Drop every cached route. For anything that rewires the map wholesale (a content
// reload); a single exit edit is caught by the first-step check or the expiry.
export function clearRouteCache() { routeCache.clear(); }

function search(startId, targetId, maxDistance, roads, avoid) {
  if (roads) return findRoadPath(startId, targetId, maxDistance, avoid);

  const parent = new Map([[startId, null]]);
  const dist = new Map([[startId, 0]]);
  const queue = [startId];

  while (queue.length) {
    const current = queue.shift();
    const currentDist = dist.get(current);

    if (current === targetId) {
      const path = [];
      let node = targetId;
      while (node !== null) {
        path.unshift(node);
        node = parent.get(node);
      }
      return path;
    }

    if (currentDist >= maxDistance) continue;

    const zone = world.zones.get(current);
    if (!zone) continue;

    for (const neighborId of neighborZoneIds(zone)) {
      if (avoid && neighborId !== targetId && avoid.has(neighborId)) continue;
      // Open water isn't standable — skip it even in the plain-BFS fallback so the
      // initial GPS line routes around the basin instead of cutting straight across
      // it (the target itself is exempt, matching the road search / avoid handling).
      if (neighborId !== targetId && isBlocked(world.zones.get(neighborId))) continue;
      if (!parent.has(neighborId)) {
        parent.set(neighborId, current);
        dist.set(neighborId, currentDist + 1);
        queue.push(neighborId);
      }
    }
  }

  return null;
}

// A tiny binary min-heap of [cost, id] pairs — the priority frontier for the road search.
// Keeps findRoadPath at O(E log V) so it's cheap enough for NPC AI to path every tick, not
// just an on-demand player GPS lookup. Lazy deletion: a node can be pushed more than once as
// cheaper routes to it are found; the pop loop skips entries whose cost is already stale.
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(cost, id) {
    const a = this.a; a.push([cost, id]); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; const n = a.length; let i = 0;
      for (;;) { let s = i; const l = 2 * i + 1, r = l + 1;
        if (l < n && a[l][0] < a[s][0]) s = l;
        if (r < n && a[r][0] < a[s][0]) s = r;
        if (s === i) break; [a[s], a[i]] = [a[i], a[s]]; i = s;
      }
    }
    return top;
  }
}

// Least-cost search that hugs the road grid (see stepCost), Dijkstra over a binary heap.
// `hops` tracks path length so `maxDistance` still bounds the route the same way BFS does.
// `avoid` (Set of zone ids, target exempt) prunes tiles from the frontier — see findPath.
function findRoadPath(startId, targetId, maxDistance, avoid = null) {
  const parent = new Map([[startId, null]]);
  const cost = new Map([[startId, 0]]);
  const hops = new Map([[startId, 0]]);
  const heap = new MinHeap(); heap.push(0, startId);

  while (heap.size) {
    const [d, current] = heap.pop();
    if (current === targetId) break;
    if (d > (cost.get(current) ?? Infinity)) continue;   // stale heap entry — a cheaper one already settled this node

    const hop = hops.get(current);
    if (hop >= maxDistance) continue;

    const zone = world.zones.get(current);
    if (!zone) continue;

    for (const neighborId of neighborZoneIds(zone)) {
      if (avoid && neighborId !== targetId && avoid.has(neighborId)) continue;
      const nz = world.zones.get(neighborId);
      const step = stepCost(nz);
      if (!isFinite(step)) continue;                 // impassable (water)
      const nd = d + step;
      if (nd < (cost.get(neighborId) ?? Infinity)) {
        cost.set(neighborId, nd);
        hops.set(neighborId, hop + 1);
        parent.set(neighborId, current);
        heap.push(nd, neighborId);
      }
    }
  }

  if (!parent.has(targetId)) return null;
  const path = [];
  let node = targetId;
  while (node != null) { path.unshift(node); node = parent.get(node); }
  return path[0] === startId ? path : null;
}

// BFS outward from origin, returning a Map<zoneId, distance> up to maxHops.
export function getZonesInRadius(originId, maxHops) {
  const reach = new Map([[originId, 0]]);
  const queue = [[originId, 0]];
  while (queue.length) {
    const [zoneId, dist] = queue.shift();
    if (dist >= maxHops) continue;
    const zone = world.zones.get(zoneId);
    if (!zone) continue;
    for (const neighborId of neighborZoneIds(zone)) {
      if (!reach.has(neighborId)) {
        reach.set(neighborId, dist + 1);
        queue.push([neighborId, dist + 1]);
      }
    }
  }
  return reach;
}
