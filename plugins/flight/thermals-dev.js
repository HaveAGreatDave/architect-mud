// THE THERMAL MAP, as the dev panel's Thermals tab reads it.
//
// The field itself is client/shared/thermals.js, a pure function of place, time and sky; this
// only hands the dev panel the three inputs it cannot compute in a browser: the ground heat of
// every surface tile, today's sky, and where every live aircraft is. The panel then runs the
// same functions the cockpit and the server run, so what it draws is what they fly in.
//
// ⚠ DEV ONLY. Thermals must never get a player-facing map: pilots find lift by cumulus caps,
// dust devils, circling hawks and the variometer, and a map would make all four pointless.
//
// ⚠ ZERO QUERIES. The zones are in RAM and the rest is arithmetic.
import { getAllZones } from '../../server/engine/world.js';
import { biomeOf } from './biomes.js';
import { isRoadCell, liveAircraft, thermalSky } from './state.js';
import { heatOfCell, thermalLift } from '../../client/shared/thermals.js';
import { placeOf } from '../../client/shared/birds.js';

export function apiThermalWorld() {
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  const tiles = [];
  const heat = new Map();
  for (const z of getAllZones()) {
    if (z.map_id !== 'map_world' || z.grid_x == null || z.grid_y == null) continue;
    if (z.grid_z != null && z.grid_z !== 0) continue;   // the surface only; the Under shares the grid
    const biome = biomeOf(z), road = isRoadCell(z) ? 1 : 0, bt = z.flags?.building_type || null;
    const h = heatOfCell({ biome, road, bt });
    const key = z.grid_x + ',' + z.grid_y;
    if (heat.has(key) && heat.get(key) >= h) continue;
    heat.set(key, h);
    // `g` is the habitat key birds.js asks about, so the panel can find the hawks.
    tiles.push([z.grid_x, z.grid_y, Math.round(h * 100) / 100, placeOf(biome, bt, false) || '', road]);
    minx = Math.min(minx, z.grid_x); maxx = Math.max(maxx, z.grid_x);
    miny = Math.min(miny, z.grid_y); maxy = Math.max(maxy, z.grid_y);
  }
  const sky = thermalSky();
  const now = Date.now();
  const heatAt = (x, y) => heat.get(x + ',' + y) || 0;
  const aircraft = [];
  for (const live of liveAircraft.values()) {
    const a = live.row;
    if (!a?.airborne) continue;
    const x = live.fx ?? a.grid_x, y = live.fy ?? a.grid_y, alt = live.cont?.altitude ?? 0;
    aircraft.push({ x, y, alt: Math.round(alt), vs: Math.round(live.cont?.vs ?? 0), name: live.type?.name || a.name || '?',
      lift: Math.round(thermalLift(x, y, alt, now, sky, heatAt)) });
  }
  return { bounds: { minx, maxx, miny, maxy }, tiles, sky, now, aircraft };
}
