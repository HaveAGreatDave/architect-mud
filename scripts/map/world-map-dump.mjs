// Writes tools/worldmap/world.json: the World Map payload the tablet app is sent (plugins/worldmap),
// for the dev page at tools/worldmap/index.html, which draws it with the same renderer
// (client/shared/worldmap-render.js). Read-only: boots the world like regress does.
//   node scripts/map/world-map-dump.mjs      then serve the repo root and open /tools/worldmap/
import { writeFileSync } from 'fs';
import { initWorld } from '../../server/engine/world.js';
import { loadPlugins } from '../../server/engine/plugins.js';

await initWorld();
await loadPlugins();
const { _test } = await import('../../plugins/worldmap/index.js');
const p = _test.worldPayload();
writeFileSync('tools/worldmap/world.json', JSON.stringify(p));
console.log(`wrote tools/worldmap/world.json — ${p.regions.length} regions, ${p.pieces.length} road pieces, ${p.trails.length} footpaths, week ${p.week}`);
process.exit(0);
