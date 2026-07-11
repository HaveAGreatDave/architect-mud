import { world } from './world.js';
import { neighborZoneIds } from './exits.js';

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
  if (f.water) return Infinity;
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
export function findPath(startId, targetId, { maxDistance = 60, roads = false } = {}) {
  if (startId === targetId) return [startId];
  if (roads) return findRoadPath(startId, targetId, maxDistance);

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
      if (!parent.has(neighborId)) {
        parent.set(neighborId, current);
        dist.set(neighborId, currentDist + 1);
        queue.push(neighborId);
      }
    }
  }

  return null;
}

// Least-cost search that hugs the road grid (see stepCost). `hops` tracks path length so
// `maxDistance` still bounds the route the same way BFS does. The graph is small (a few
// thousand zones) so a linear-scan frontier is plenty fast; no heap needed.
function findRoadPath(startId, targetId, maxDistance) {
  const parent = new Map([[startId, null]]);
  const cost = new Map([[startId, 0]]);
  const hops = new Map([[startId, 0]]);
  const frontier = new Set([startId]);

  while (frontier.size) {
    // Pop the cheapest frontier node.
    let current = null, best = Infinity;
    for (const id of frontier) { const c = cost.get(id); if (c < best) { best = c; current = id; } }
    frontier.delete(current);
    if (current === targetId) break;

    const hop = hops.get(current);
    if (hop >= maxDistance) continue;

    const zone = world.zones.get(current);
    if (!zone) continue;

    for (const neighborId of neighborZoneIds(zone)) {
      const nz = world.zones.get(neighborId);
      const step = stepCost(nz);
      if (!isFinite(step)) continue;                 // impassable (water)
      const nd = best + step;
      if (nd < (cost.get(neighborId) ?? Infinity)) {
        cost.set(neighborId, nd);
        hops.set(neighborId, hop + 1);
        parent.set(neighborId, current);
        frontier.add(neighborId);
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
