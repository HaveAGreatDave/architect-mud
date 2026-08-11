// buildFlightSnapshot — derive the static flight-sim world (client/game/flightsim-world.json)
// from the live world. The open flight-sim rig (client/game/flightsim.html) flies a baked
// snapshot with no server/DB at fly time, so it must be re-baked after a map change. This is
// the single source of that derivation, shared by:
//   - scripts/snapshot-flight-world.mjs   (CLI: boots the world headlessly, then writes the file)
//   - server route POST /maps/flight-snapshot  (dev panel button: re-bakes from the running world)
// Both call buildFlightSnapshot() over the same getAllZones(), so the two paths can never drift.

import { getAllZones } from '../../server/engine/world.js';
import { runwayFor, surfaceRank, deriveSurfaceCell } from './state.js';

// Derive one surface cell for the bake. This used to be a hand-maintained COPY of the per-cell
// logic in plugins/flight/state.js mapWindow, and it drifted twice — the bake silently lost the
// 144 painted-only street tiles a live flight draws, and then lost authored park features. It now
// calls the one shared derivation, so the baked rig and a live flight cannot disagree again.
// `live: false` skips the wall-clock yacht wake/transit pose — a snapshot must not freeze a
// hull that happened to be underway at bake time into the checked-in file.
// JSON.stringify drops the undefined keys, keeping the file compact.
const deriveCell = z => deriveSurfaceCell({ id: z.id, flags: z.flags || {}, danger: z.danger },
  z.grid_x, z.grid_y, undefined, false);

// Reproduce the exact per-cell shape the flight plugin streams to the cockpit for every
// map_world tile, plus every airfield's runway pose. Returns { bounds, fields, cells }.
export function buildFlightSnapshot() {
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  const cells = {};
  const cellRank = {};   // per-grid surfaceRank of the tile currently in `cells`, for collision precedence
  const fields = [];
  for (const z of getAllZones()) {
    if (z.map_id !== 'map_world' || z.grid_x == null || z.grid_y == null) continue;
    if (z.grid_z != null && z.grid_z !== 0) continue;   // surface only — the Under shares the grid (see buildCoordIndex)
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
