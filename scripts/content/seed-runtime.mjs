// content:seed-runtime — initialise runtime-managed state on a freshly-imported DB.
//
//   npm run content:seed-runtime                                   # local (DATABASE_URL)
//   node --env-file=.env.prod scripts/content/seed-runtime.mjs     # prod, deliberately
//
// content:import loads AUTHORED rows, but runtime-managed columns are excluded
// from content files (see content-registry excludeColumns) and therefore start at
// their table defaults on a fresh DB — most visibly every vendor's active shelf
// (npcs.vendor_stock = '[]'). Those shelves only fill on the in-game daily tick
// (environment.dayRollover → dailyMaintenance → restockAllVendors), so a fresh DB
// has empty shops until then. This seeds that runtime state up front.
//
// Auto-invoked by content:import for LOCAL targets. Prod's runtime state persists
// across deploys, so it's a manual step there (only ever needed on a truly fresh
// prod DB). Every task must be IDEMPOTENT — this may run on every local import.
//
// Add a fresh-start task by appending to TASKS below.
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { restockAllVendors } from '../../server/engine/vendor.js';

const TASKS = [
  ['restock vendors', restockAllVendors],
  // ['<label>', <async fn>],  ← add future fresh-start tasks here
];

export async function seedRuntime() {
  for (const [label, fn] of TASKS) {
    try {
      await fn();
    } catch (e) {
      console.error(`[seed-runtime] ${label} failed:`, e.message);
    }
  }
}

// Only self-run when executed directly; a no-op when imported by import.mjs.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await seedRuntime();
  process.exit(0);
}
