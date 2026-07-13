// Snapshot the live map_world surface into a static file the open flight-sim rig
// (client/game/flightsim.html) flies through — so the no-login test flies over the
// REAL Coldwater map instead of the procedural hash.
//
// It boots the world headlessly (initWorld) and, for every map_world tile, reproduces
// the EXACT per-cell shape the flight plugin streams to the cockpit (plugins/flight
// state.js mapWindow): { kind, biome, road, danger, bt, bn, ent, flr, mark, rd }. It
// also emits every airfield + its runway pose (runwayFor) so the rig can spawn on a
// real strip. Output → client/game/flightsim-world.json (a plain static asset; no
// server, no DB at fly time).
//
//   Local dev DB:  node scripts/snapshot-flight-world.mjs
//   Prod content:  node --env-file=.env.prod scripts/snapshot-flight-world.mjs
//
// Re-run whenever the world map changes and you want the sim to reflect it.

import { writeFileSync } from 'fs';
import { initWorld, getAllZones, getZone, buildingEntranceDir } from '../server/engine/world.js';
import { runwayFor, surfaceRank } from '../plugins/flight/state.js';
import { biomeOf } from '../plugins/flight/biomes.js';
import { stopAll } from '../server/engine/scheduler.js';

await initWorld();

// Derive one surface cell exactly like plugins/flight/state.js mapWindow does, so the
// windshield renders these snapshot tiles identically to a live flight.
function deriveCell(z) {
  const flags = z.flags || {};
  const biome = biomeOf({ id: z.id, flags, danger: z.danger });
  const road = (Array.isArray(flags.artery) && flags.artery.length) || /^(road_|runway_)/.test(flags.icon || '') ? 1 : 0;
  const kind = flags.airfield_id ? 'field' : flags.airspace_restricted ? 'nofly' : 'land';
  const bt = flags.building_type || undefined;
  const bn = flags.building_name || undefined;
  let ent, flr;
  if (bt) {
    const zz = getZone(z.id);
    ent = (zz && buildingEntranceDir(zz)) || undefined;
    flr = flags.floors || undefined;
  }
  // Bespoke landmarks the windshield raises off the `mark` channel — mirror plugins/flight
  // state.js: the Echelon's exterior tile (flags.yacht) → the black superyacht + helipad, a
  // statue-* map icon → the town-square monument. A field/water tile is otherwise culled, so
  // without this the baked rig would never draw the Echelon (unlike a live flight).
  const mark = flags.yacht ? 'yacht' : /^statue/.test(flags.icon || '') ? 'statue' : undefined;
  let rd;
  const im = /^road_([nesw]+|x)$/.exec(flags.icon || '');
  if (im) rd = im[1] === 'x' ? 'nesw' : im[1];
  // JSON.stringify drops the undefined keys, keeping the file compact.
  return { kind, biome, road, danger: z.danger, bt, bn, ent, flr, mark, rd };
}

let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
const cells = {};
const cellRank = {};   // per-grid surfaceRank of the tile currently in `cells`, for collision precedence
const fields = [];
for (const z of getAllZones()) {
  if (z.map_id !== 'map_world' || z.grid_x == null || z.grid_y == null) continue;
  const key = `${z.grid_x},${z.grid_y}`, rank = surfaceRank(z.flags || {});
  // Same collision rule as buildCoordIndex: a landmark/building tile (the Echelon) must win
  // its grid over a bare terrain tile stamped on the same cell, not lose to iteration order.
  if (cells[key] === undefined || rank > cellRank[key]) { cells[key] = deriveCell(z); cellRank[key] = rank; }
  minx = Math.min(minx, z.grid_x); maxx = Math.max(maxx, z.grid_x);
  miny = Math.min(miny, z.grid_y); maxy = Math.max(maxy, z.grid_y);
  if (z.flags?.airfield_id) {
    const rw = runwayFor(z);
    fields.push({ id: z.flags.airfield_id, name: z.name, gx: z.grid_x, gy: z.grid_y, runway: rw || null });
  }
}

const snap = { bounds: { minx, maxx, miny, maxy }, fields, cells };
const out = new URL('../client/game/flightsim-world.json', import.meta.url);
writeFileSync(out, JSON.stringify(snap));
console.log(`snapshot → ${out.pathname}`);
console.log(`  ${Object.keys(cells).length} tiles · bounds x[${minx}..${maxx}] y[${miny}..${maxy}] · ${fields.length} airfields`);
for (const f of fields) console.log(`    ✈ ${f.name} (${f.id}) @ ${f.gx},${f.gy}${f.runway ? ` runway hdg ${f.runway.hdg} len ${f.runway.len}` : ' (no runway)'}`);
stopAll();
process.exit(0);
