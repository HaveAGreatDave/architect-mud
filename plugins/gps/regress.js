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

  // Option D — a name shared by many tiles (filler terrain / a long street) routes to
  // the NEAREST one, not a picker or a tie-break-arbitrary far tile. Find such a name
  // the player isn't already standing on, then assert it plots a route to a same-named
  // tile and that no other same-named tile is grid-closer than the one chosen.
  {
    const land = getAllZones().filter(z => !z.flags?.water && z.grid_x != null);
    const byName = {};
    for (const z of land) (byName[(z.name || '').toLowerCase()] = byName[(z.name || '').toLowerCase()] || []).push(z);
    const here = getZone(p.current_zone);
    const dupName = Object.keys(byName).find(n =>
      n && byName[n].length > 3 && n !== (here.name || '').toLowerCase());
    if (dupName) {
      const group = byName[dupName];
      r = await run(`gps ${group[0].name}`);
      const endId = r?.type === 'gps_route' ? r.path[r.path.length - 1] : null;
      const end = endId && getZone(endId);
      const sq = (a, b) => (a.grid_x - b.grid_x) ** 2 + (a.grid_y - b.grid_y) ** 2;
      const chosenD = end ? sq(here, end) : Infinity;
      const closest = Math.min(...group.filter(z => z.id !== here.id).map(z => sq(here, z)));
      check(
        'gps to a many-tile name routes to a same-named tile',
        r?.type === 'gps_route' && end && (end.name || '').toLowerCase() === dupName,
        `type=${r?.type} end=${end?.name}`,
      );
      check(
        'gps to a many-tile name picks (near) the closest tile',
        chosenD <= closest * 1.05 + 1, // exact closest may be unreachable; allow the fallthrough
        `chosen²=${chosenD} closest²=${closest}`,
      );
    }
  }

  // Option A — a bare grid coordinate ("x,y") and a raw zone id each resolve straight
  // to that one tile, no name matching. Pick a reachable dry tile a few hops out.
  {
    const here = getZone(p.current_zone);
    // Coords must be unique on this map for a coord lookup to be deterministic — interior
    // maps can stack tiles at one (x,y). Count occupancy so we only test a lone tile.
    const coordCount = {};
    for (const z of getAllZones())
      if (z.map_id === here.map_id && z.grid_x != null) {
        const k = `${z.grid_x},${z.grid_y},${z.grid_z ?? 0}`;
        coordCount[k] = (coordCount[k] || 0) + 1;
      }
    // Coord syntax "x,y" resolves on the player's current z-level, so the target must
    // share it (interior maps stack floors at one (x,y) across grid_z).
    const target = getAllZones().find(z =>
      z.map_id === here.map_id && !z.flags?.water && z.grid_x != null && z.id !== here.id &&
      (z.grid_z ?? 0) === (here.grid_z ?? 0) &&
      coordCount[`${z.grid_x},${z.grid_y},${z.grid_z ?? 0}`] === 1 &&
      (findPath(here.id, z.id, { roads: true, maxDistance: 40 }) || []).length >= 2);
    if (target) {
      r = await run(`gps ${target.grid_x},${target.grid_y}`);
      check(
        'gps to "x,y" coordinates routes to that tile',
        r?.type === 'gps_route' && r.path[r.path.length - 1] === target.id,
        `type=${r?.type} end=${r?.path?.[r.path.length - 1]} want=${target.id}`,
      );
      r = await run(`gps ${target.id}`);
      check(
        'gps to a raw zone id routes to that tile',
        r?.type === 'gps_route' && r.path[r.path.length - 1] === target.id,
        `type=${r?.type} end=${r?.path?.[r.path.length - 1]} want=${target.id}`,
      );
    }
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
