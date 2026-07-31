// One-shot: run Dell Fry's (npc_ration_cook) sourced-container restock once,
// so Ration Nine's shop-floor chiller case and frozen well are populated immediately
// (drawing from the stockroom Ironchills first) instead of waiting for the next
// 24h dailyMaintenance() tick.
// Local:  node scripts/seed-ration9-stock.mjs
// Prod:   node --env-file=.env.prod scripts/seed-ration9-stock.mjs   (run once, after the deploy)
import { query } from '../server/models/db.js';
import { loadItems } from '../server/engine/items-cache.js';
import { restockSourcedContainers } from '../server/engine/vendor.js';

await loadItems(); // restockSourcedContainers reads item weight/existence off this cache

const { rows } = await query(`SELECT id, vendor_inventory FROM npcs WHERE id = 'npc_ration_cook'`);
if (!rows.length) {
  console.log('npc_ration_cook not found.');
  process.exit(1);
}

await restockSourcedContainers(rows[0]);

const { rows: counts } = await query(
  `SELECT container_id, item_id, COUNT(*)::int AS n FROM player_inventory
    WHERE container_id IN ('furn_ration9_case_chiller','furn_ration9_case_freezer','furn_ration9_fridge','furn_ration9_freezer')
    GROUP BY container_id, item_id ORDER BY container_id, item_id`
);
console.log('Ration Nine cold-storage contents:', counts);
process.exit(0);
