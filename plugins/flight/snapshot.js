// buildFlightSnapshot — derive the static flight-sim world (client/game/flightsim-world.json)
// from the live world. The open flight-sim rig (client/game/flightsim.html) flies a baked
// snapshot with no server/DB at fly time, so it must be re-baked after a map change. This is
// the single source of that derivation, shared by:
//   - scripts/snapshot-flight-world.mjs   (CLI: boots the world headlessly, then writes the file)
//   - server route POST /maps/flight-snapshot  (dev panel button: re-bakes from the running world)
// Both call buildFlightSnapshot() over the same getAllZones(), so the two paths can never drift.

import { getAllZones, getZone, buildingEntranceDir } from '../../server/engine/world.js';
import { runwayFor, surfaceRank, curtainRun } from './state.js';
import { biomeOf } from './biomes.js';

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
  const mark = flags.yacht ? 'yacht' : flags.perimeter_gate ? 'gate' : /^statue/.test(flags.icon || '') ? 'statue' : undefined;
  let rd;
  const im = /^road_([nesw]+|x)$/.exec(flags.icon || '');
  if (im) rd = im[1] === 'x' ? 'nesw' : im[1];
  // The Curtain energy wall — carry its run directions (see plugins/flight state.js curtainRun) so
  // the baked rig stands the same shimmer barrier a live flight does over the city's land edges.
  // The gate tile (perimeter_gate) has no curtain flag but needs the wall's run so its pylons align.
  const cur = (flags.curtain || flags.perimeter_gate) ? curtainRun(z.grid_x, z.grid_y) : undefined;
  // Authored park feature (grove/pond/benches/…), same channel the live flight streams
  // (plugins/flight state.js: pf). Without this the baked rig ignores the painted feature
  // and falls back to seed%5, so park tiles look different from a live flight.
  const pf = flags.park_feature || undefined;
  // JSON.stringify drops the undefined keys, keeping the file compact.
  return { kind, biome, road, danger: z.danger, bt, bn, ent, flr, mark, rd, cur, pf };
}

// Reproduce the exact per-cell shape the flight plugin streams to the cockpit for every
// map_world tile, plus every airfield's runway pose. Returns { bounds, fields, cells }.
export function buildFlightSnapshot() {
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
  return { bounds: { minx, maxx, miny, maxy }, fields, cells };
}
