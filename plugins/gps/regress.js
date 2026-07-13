// GPS plugin regression — exercises SIFT location resolution + route plotting
// against the live world without touching the client-side minimap overlay.
import { getZone, getAllZones } from '../../server/engine/world.js';
import { findPath } from '../../server/engine/pathfinding.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { getBroadcast, setBroadcast } from '../../server/engine/messaging.js';

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
  // a Coldwater Basin tile can't produce a path — pick a dry neighbour to route to.
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
  // the NEAREST reachable one, not a picker or a tie-break-arbitrary far tile. GPS mirrors
  // this in routeToNearest: it road-routes to the first of its 8 grid-closest same-named
  // tiles that a road path reaches, and correctly ERRORS when none of them do — vast
  // off-road filler ("grasslands", hundreds of tiles) is a legitimate no-route. So the
  // fixture can't just grab the first same-named cluster + first stand tile: it must stand
  // on a tile from which GPS can actually reach a same-named tile. Scan for such a
  // (cluster, stand) pair — reproducing GPS's closest-8 window — and remember the tile GPS
  // will pick as `expected`; skip the assertion if the sampled world offers no routable
  // pair. Clusters live on ONE map (findPath is single-map, grid coords aren't comparable
  // across maps), so the stand is always on the cluster's own map.
  {
    const sq = (a, b) => (a.grid_x - b.grid_x) ** 2 + (a.grid_y - b.grid_y) ** 2;
    const byName = {};
    for (const z of getAllZones().filter(z => !z.flags?.water && z.grid_x != null))
      (byName[(z.name || '').toLowerCase()] = byName[(z.name || '').toLowerCase()] || []).push(z);
    let dupName, group, stand, expected;
    for (const n of Object.keys(byName)) {
      if (!n || byName[n].length <= 3) continue;
      const g = byName[n], gIds = new Set(g.map(z => z.id)), gMap = g[0].map_id;
      const stands = getAllZones().filter(z =>
        z.map_id === gMap && !gIds.has(z.id) && !z.flags?.water && z.grid_x != null &&
        z.exits && Object.keys(z.exits).length > 0);
      // Bounded stand probe: for each candidate stand, does GPS's closest-8 window contain
      // a road-reachable same-named tile? First hit wins. Cap the probe so a huge off-road
      // cluster never fans out an unbounded BFS sweep before falling through to the next name.
      for (const s of stands.slice(0, 40)) {
        const near8 = g.slice().sort((a, b) => sq(s, a) - sq(s, b)).slice(0, 8);
        const pick = near8.find(t => (findPath(s.id, t.id, { roads: true, maxDistance: 200 }) || []).length >= 2);
        if (pick) { dupName = n; group = g; stand = s; expected = pick; break; }
      }
      if (stand) break;
    }
    if (stand) {
      const savedGpsZone = p.current_zone;
      p.current_zone = stand.id;
      const here = getZone(stand.id);
      r = await run(`gps ${group[0].name}`);
      const endId = r?.type === 'gps_route' ? r.path[r.path.length - 1] : null;
      const end = endId && getZone(endId);
      const chosenD = end ? sq(here, end) : Infinity;
      const closest = sq(here, expected); // the nearest same-named tile GPS can actually reach
      check(
        'gps to a many-tile name routes to a same-named tile',
        r?.type === 'gps_route' && end && (end.name || '').toLowerCase() === dupName,
        `type=${r?.type} end=${end?.name}`,
      );
      check(
        'gps to a many-tile name picks (near) the closest reachable tile',
        chosenD <= closest * 1.05 + 1, // GPS routes to the closest reachable; slack for path ties
        `chosen²=${chosenD} closest²=${closest}`,
      );
      p.current_zone = savedGpsZone;
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

  // Per-hop directions + reroute-around-obstacle. A gps_route now carries a `dirs`
  // array (the exact direction to step at each hop) so the client walker can follow a
  // second same-direction exit it couldn't resolve from its own minimap node; and a
  // `!avoid a,b` flag lets an auto-walk reroute route AROUND a blocked tile instead of
  // dead-stopping. Find a start tile with a 3+ tile route (has an intermediate to
  // avoid) and assert both. Skip-safe if the sampled world offers no such route.
  {
    const leadsTo = (z, dir, next) => { const v = z?.exits?.[dir]; return (Array.isArray(v) ? v : [v]).includes(next); };
    const cand = getAllZones().filter(z =>
      z.map_id === 'map_world' && z.grid_x != null && !z.flags?.water &&
      z.exits && Object.keys(z.exits).length > 0);
    let start = null, path = null;
    for (const s of cand.slice(0, 40)) {
      for (const d of cand.slice(0, 60)) {
        if (d.id === s.id) continue;
        const pth = findPath(s.id, d.id, { roads: true, maxDistance: 40 });
        if (pth && pth.length >= 3) { start = s; path = pth; break; }
      }
      if (start) break;
    }
    if (start) {
      const savedGps = p.current_zone;
      p.current_zone = start.id;
      const destId = path[path.length - 1];
      let r = await run(`gps ${destId}`);
      check(
        'gps route carries a per-hop dirs array aligned to the path',
        r?.type === 'gps_route' && Array.isArray(r.dirs) && r.dirs.length === r.path.length - 1 &&
          r.dirs.every((dir, k) => typeof dir === 'string' && leadsTo(getZone(r.path[k]), dir, r.path[k + 1])),
        `dirs=${JSON.stringify(r?.dirs)} path=${JSON.stringify(r?.path)}`,
      );
      // Route around an intermediate tile: the new path must not pass through it — or
      // legitimately error when it was the only way through. `!resume` suppresses the
      // y/n prompt and the "GPS locked" line (an in-progress reroute, not a new plot).
      const avoidTile = r?.path?.[1];
      r = await run(`gps ${destId} !avoid ${avoidTile} !resume`);
      check(
        'gps !avoid routes around the tile; !resume suppresses the prompt',
        r?.type === 'error' ||
          (r?.type === 'gps_route' && !r.path.includes(avoidTile) && r.promptAutoWalk === false && r.message === ''),
        `type=${r?.type} avoided=${avoidTile} inPath=${r?.path?.includes(avoidTile)} prompt=${r?.promptAutoWalk} msg="${r?.message}"`,
      );
      p.current_zone = savedGps;
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

  // GPS_TO action — an NPC (e.g. the Hall of Records archivist) plotting a route straight
  // onto the player's map from dialogue. Dispatch it and confirm a gps_route is pushed to
  // the player via sendToPlayer/broadcast, with NO auto-walk prompt, and that being already
  // at the destination sends nothing. Spy on broadcast and restore it afterward.
  {
    const savedBc = getBroadcast();
    const savedCur = p.current_zone;
    const sent = [];
    setBroadcast((zoneId, message, excludeId, targetId) => { sent.push({ targetId, message }); });
    // Pick a reachable origin/dest pair from the live map: a building tile and any other
    // building tile a road route connects to. Deterministic enough (first reachable pair).
    const buildings = getAllZones().filter(z => z.flags?.building_type && z.map_id === 'map_world');
    let origin = null, dest = null;
    for (const o of buildings) {
      const d = buildings.find(z => z.id !== o.id && (findPath(o.id, z.id, { roads: false, maxDistance: 300 })?.length || 0) > 1);
      if (d) { origin = o.id; dest = d.id; break; }
    }
    try {
      if (origin && dest) {
        p.current_zone = origin;
        await dispatchAction({ type: 'GPS_TO', actor: p, params: { zone: dest } });
        const route = sent.find(s => s.message?.type === 'gps_route');
        check(
          'GPS_TO pushes a gps_route to the player with no auto-walk prompt',
          !!route && route.targetId === p.id && Array.isArray(route.message.path) &&
            route.message.path.length > 1 && route.message.promptAutoWalk === undefined,
          JSON.stringify(route ? { target: route.targetId, hops: route.message.path?.length, prompt: route.message.promptAutoWalk } : sent),
        );
        sent.length = 0;
        p.current_zone = dest;
        await dispatchAction({ type: 'GPS_TO', actor: p, params: { zone: dest } });
        check('GPS_TO no-ops when already at the destination', !sent.some(s => s.message?.type === 'gps_route'), `sent=${sent.length}`);
      } else {
        check('GPS_TO: found a reachable building pair to test', false, 'no reachable building pair on map_world');
      }
    } finally { setBroadcast(savedBc); p.current_zone = savedCur; }
  }

  p.current_zone = savedZone;
}
