// Snapshot the live map_world surface into a static file the open flight-sim rig
// (client/game/flightsim.html) flies through — so the no-login test flies over the
// REAL Coldwater map instead of the procedural hash.
//
// It boots the world headlessly (initWorld) and reproduces, for every map_world tile,
// the EXACT per-cell shape the flight plugin streams to the cockpit. The derivation
// itself lives in plugins/flight/snapshot.js (buildFlightSnapshot), shared with the
// dev-panel "re-bake" button (POST /maps/flight-snapshot) so the two never drift.
// Output → client/game/flightsim-world.json (a plain static asset; no server, no DB at fly time).
//
//   Local dev DB:  node scripts/snapshot-flight-world.mjs
//   Prod content:  node --env-file=.env.prod scripts/snapshot-flight-world.mjs
//
// Re-run whenever the world map changes and you want the sim to reflect it (or just hit
// the Maps-tab "⟳ Re-bake flight sim" button while the dev server is running).

import { writeFileSync } from 'fs';
import { initWorld } from '../server/engine/world.js';
import { buildFlightSnapshot } from '../plugins/flight/snapshot.js';
import { stopAll } from '../server/engine/scheduler.js';

await initWorld();

const snap = buildFlightSnapshot();
const out = new URL('../client/game/flightsim-world.json', import.meta.url);
writeFileSync(out, JSON.stringify(snap));
const { minx, maxx, miny, maxy } = snap.bounds;
console.log(`snapshot → ${out.pathname}`);
console.log(`  ${Object.keys(snap.cells).length} tiles · bounds x[${minx}..${maxx}] y[${miny}..${maxy}] · ${snap.fields.length} airfields`);
for (const f of snap.fields) console.log(`    ✈ ${f.name} (${f.id}) @ ${f.gx},${f.gy}${f.runway ? ` runway hdg ${f.runway.hdg} len ${f.runway.len}` : ' (no runway)'}`);
stopAll();
process.exit(0);
