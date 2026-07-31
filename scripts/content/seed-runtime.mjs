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
import { loadItems } from '../../server/engine/items-cache.js';
import { query } from '../../server/models/db.js';

// The items cache is normally filled by server boot, which never happens here.
// restockSourcedContainers() reads item weight/existence straight off it and
// SKIPS any entry getItem() can't resolve — so without this every vendor's
// physical stock (shop-floor coolers, display cases, stockrooms) silently seeds
// EMPTY while the abstract `vendor_stock` shelf, which needs no cache, fills
// normally and hides the failure.
const primeItemCache = () => loadItems();

// atm_units is runtime-class (one row per placed ATM, drained/refilled by play), so
// content:import never writes it — but the row only ever gets created by the dev-panel
// furniture route. On a freshly-imported DB every authored ATM therefore has furniture
// and no unit, and the plugin degrades it to an UNLINKED "CENTRAL BANK" terminal with
// default cash. Provision the missing units from the furniture, and bind the brand from
// the authored `flags.atm_network` so a content-authored ATM keeps its network.
async function provisionAtmUnits() {
  await query(`
    INSERT INTO atm_units (id, network_id)
    SELECT f.id, n.id
      FROM furniture f
      LEFT JOIN atm_networks n ON n.id = f.flags->>'atm_network'
     WHERE jsonb_exists(f.flags, 'atm')
    ON CONFLICT (id) DO NOTHING`);
  // Late-authored network on an ATM that already had a unit — only ever fills a blank.
  await query(`
    UPDATE atm_units a SET network_id = n.id
      FROM furniture f
      JOIN atm_networks n ON n.id = f.flags->>'atm_network'
     WHERE f.id = a.id AND a.network_id IS NULL`);
}

// furniture.light_on is excluded from content (the power/day-night sim owns it), so
// every authored fixture imports OFF. That is not self-healing for interior lights:
// the first power tick backfills light_on_intended = COALESCE(intended, light_on) = 0
// and the fixture is then deliberately off forever — a freshly-imported building is
// dark with all its lights "installed". Switch on fixtures the sim has never touched
// (light_on_intended IS NULL); once it has, intended is non-null and this leaves the
// player's own switch decisions alone. Streetlights are excluded — syncStreetlights
// drives those off the day/night clock.
async function lightAuthoredFixtures() {
  const { rowCount } = await query(`
    UPDATE furniture SET light_on = 1
     WHERE object_type = 'light' AND light_on = 0
       AND light_on_intended IS NULL
       AND COALESCE(light_type, '') <> 'streetlight'
       AND COALESCE(lumen_output, 0) > 0`);
  if (rowCount) console.log(`[lighting] switched on ${rowCount} newly-imported fixture(s)`);
}

const TASKS = [
  ['prime item cache', primeItemCache],   // must precede 'restock vendors'
  ['restock vendors', restockAllVendors],
  ['provision ATM units', provisionAtmUnits],
  ['light authored fixtures', lightAuthoredFixtures],
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
