// GPS plugin regression — exercises SIFT location resolution + route plotting
// against the live world without touching the client-side minimap overlay.
import { getZone, getAllZones } from '../../server/engine/world.js';

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

  const neighborId = Object.values(here.exits || {})[0];
  if (neighborId) {
    const neighbor = getAllZones().find(z => z.id === neighborId);
    r = await run(`gps ${neighbor.name}`);
    check(
      'gps to a reachable neighbour plots a route',
      r?.type === 'gps_route' && Array.isArray(r.path) && r.path[0] === p.current_zone && r.path[r.path.length - 1] === neighborId,
      `type=${r?.type} path=${JSON.stringify(r?.path)}`,
    );
  }

  p.current_zone = savedZone;
}
