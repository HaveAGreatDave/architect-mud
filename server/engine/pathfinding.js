import { world } from './world.js';
import { neighborZoneIds } from './exits.js';

// BFS pathfinding over zone.exits adjacency graph.
// Crosses map boundaries freely — interior→exterior traversal works naturally
// because exits JSONB already encodes those connections.
// Returns an array of zone IDs from startId → targetId (inclusive), or null if unreachable.
export function findPath(startId, targetId, { maxDistance = 60 } = {}) {
  if (startId === targetId) return [startId];

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
