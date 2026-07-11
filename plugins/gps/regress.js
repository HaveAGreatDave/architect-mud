// GPS plugin regression — exercises SIFT location resolution + route plotting
// against the live world without touching the client-side minimap overlay.
import { getZone, getAllZones } from '../../server/engine/world.js';
import { findPath } from '../../server/engine/pathfinding.js';

const isRoadTile = (z) => !!z && (/^(road_|runway_)/.test(z.flags?.icon || '') || !!z.flags?.artery);

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  const savedZone = p.current_zone;

  let r = await run('gps');
  check('gps with no args prompts for a destination', r?.type === 'error' && /where/i.test(r?.message || ''), r?.message);

  r = await run('gps __nonexistent_place_xyz__');
  check('gps with an unmatched name errors', r?.type === 'error' && /no location/i.test(r?.message || ''), r?.message);

  const here = getZone(p.current_zone);
  r = await run(`gps ${here.name}`);
  check('gps to your own location says so, no route', r?.type === 'output' && /already at/i.test(r?.message || ''), r?.message);

  // A non-water neighbour: water is invisible to GPS (and impassable), so routing to
  // a Cold Channel tile can't produce a path — pick a dry neighbour to route to.
  const neighborId = Object.values(here.exits || {}).flat().find(id => { const z = getZone(id); return z && !z.flags?.water; });
  if (neighborId) {
    const neighbor = getAllZones().find(z => z.id === neighborId);
    r = await run(`gps ${neighbor.name}`);
    check(
      'gps to a reachable neighbour plots a route',
      r?.type === 'gps_route' && Array.isArray(r.path) && r.path[0] === p.current_zone && r.path[r.path.length - 1] === neighborId,
      `type=${r?.type} path=${JSON.stringify(r?.path)}`,
    );
  }

  // Road-preferring routing: a route between two street tiles should stay ON the street
  // grid — its interior hops are all roads/street tiles, never routed through a building
  // facade. Find one real road-to-road route a handful of hops long and assert it hugs
  // roads. Skip-safe: if the sampled world has no such pair in range, don't fail.
  const roadTiles = getAllZones().filter((z) => z.map_id === 'map_world' && isRoadTile(z));
  if (roadTiles.length > 1) {
    const start = roadTiles[0];
    let routed = null;
    for (const dest of roadTiles.slice(1, 60)) {
      const path = findPath(start.id, dest.id, { roads: true, maxDistance: 30 });
      if (path && path.length >= 4 && path.length <= 14) { routed = path; break; }
    }
    if (routed) {
      const interior = routed.slice(1, -1).map((id) => getZone(id));
      const hugsRoads = interior.every((z) => isRoadTile(z) || z?.flags?.street_life);
      check(
        'gps route between street tiles hugs the road grid (no facade cut-through)',
        hugsRoads,
        interior.map((z) => z?.flags?.icon || (z?.flags?.facade ? 'FACADE' : '?')).join(' > '),
      );
    }
  }

  // Run mode: a bare `run` toggles player.running; `run on/off` and `walk` are explicit.
  const savedRunning = p.running;
  p.running = false;
  r = await run('run');
  check('bare run toggles running on', r?.type === 'run_state' && r.running === true && p.running === true, JSON.stringify(r));
  r = await run('run');
  check('bare run toggles running off', r?.type === 'run_state' && r.running === false && p.running === false, JSON.stringify(r));
  r = await run('run on');
  check('run on forces running', r?.running === true && p.running === true, JSON.stringify(r));
  r = await run('walk');
  check('walk clears running', r?.type === 'run_state' && r.running === false && p.running === false, JSON.stringify(r));
  p.running = savedRunning;

  p.current_zone = savedZone;
}
