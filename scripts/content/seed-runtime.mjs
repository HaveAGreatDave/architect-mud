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

// ── THE DEPOT FRIDGES ────────────────────────────────────────────────────────
// Every truck depot has a bunkroom and every bunkroom has a fridge with something in it. The food
// is INVENTORY rather than authored content, for the reason all runtime state is: a tin of
// something in a content file is a tin that reappears on every deploy and is gone forever the
// moment somebody eats it.
//
// ⚠ IT TOPS UP, IT DOES NOT REFILL. The count is a floor, not a target — if a driver has taken
// three tins and left two, this puts one back, and if the fridge is full it does nothing at all.
// That is what makes it safe to run on every import (the whole file's contract) and it is also the
// right fiction: somebody restocks the fridge, they do not audit it.
//
// The rows are minted against the same '_restock' pseudo-owner the vendor system already uses, so
// nothing new owns them and the orphan sweep already understands them.
const BUNK_FRIDGE_STOCK = [
  ['item_ration', 4],
  ['item_water_bottle', 4],
  ['item_flat_bread', 2],
  ['item_ration_cheese', 2],
  ['item_bar_jerky', 2],
];
async function stockBunkFridges() {
  const { rows: fridges } = await query(
    "SELECT id FROM furniture WHERE flags->>'truck_bunk_fridge' = 'true'");
  if (!fridges.length) return;
  let added = 0;
  for (const f of fridges) {
    for (const [itemId, floor] of BUNK_FRIDGE_STOCK) {
      const { rows: [{ n }] } = await query(
        'SELECT COUNT(*)::int AS n FROM player_inventory WHERE container_id = $1 AND item_id = $2',
        [f.id, itemId]);
      const need = floor - n;
      if (need <= 0) continue;
      // One statement per shortfall rather than a row at a time: `generate_series` mints the whole
      // delivery in a single round trip, which matters because this runs against a remote Postgres
      // on every local import.
      await query(
        `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, container_id)
         SELECT gen_random_uuid()::text, '_restock', $2, 1, 1.0, $1 FROM generate_series(1, $3)`,
        [f.id, itemId, need]);
      added += need;
    }
  }
  if (added) console.log(`[bunkrooms] put ${added} item(s) into ${fridges.length} depot fridge(s)`);
}

const TASKS = [
  ['prime item cache', primeItemCache],   // must precede 'restock vendors'
  ['restock vendors', restockAllVendors],
  ['provision ATM units', provisionAtmUnits],
  ['light authored fixtures', lightAuthoredFixtures],
  ['stock depot bunkroom fridges', stockBunkFridges],
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
