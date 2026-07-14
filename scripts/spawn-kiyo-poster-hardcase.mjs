// Replace the Kiyo poster that the hardcase destroyed (old trash-bin bug) by
// spawning a fresh `item_poster_kiyo` INSIDE furniture_apt2_hardcase.
//
// Furniture-container contents are player_inventory rows keyed by container_id;
// buildContainerView shows them by container_id alone (no player filter), and
// `pull` reassigns ownership to whoever pulls. So we use the codebase's
// `_ground_<zone>` sentinel player_id — anyone who opens the case can take it.
//
// Idempotent: no-op if a Kiyo poster already sits in the case.
// Local:  node scripts/spawn-kiyo-poster-hardcase.mjs
// Prod:   node --env-file=.env.prod scripts/spawn-kiyo-poster-hardcase.mjs
import { randomUUID } from 'crypto';
import { query } from '../server/models/db.js';

const CASE = 'furniture_apt2_hardcase';
const ITEM = 'item_poster_kiyo';

const { rows: f } = await query(`SELECT id, zone_id FROM furniture WHERE id=$1`, [CASE]);
if (!f.length) { console.log(`SKIP  ${CASE}: hardcase not found`); process.exit(0); }
const { rows: i } = await query(`SELECT id FROM items WHERE id=$1`, [ITEM]);
if (!i.length) { console.log(`SKIP  ${ITEM}: item not found`); process.exit(0); }

const { rows: existing } = await query(
  `SELECT id FROM player_inventory WHERE container_id=$1 AND item_id=$2 LIMIT 1`,
  [CASE, ITEM]
);
if (existing.length) { console.log(`SKIP  ${ITEM} already in ${CASE}`); process.exit(0); }

await query(
  `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, container_id)
   VALUES ($1,$2,$3,1,1.0,$4)`,
  [randomUUID(), `_ground_${f[0].zone_id}`, ITEM, CASE]
);
console.log(`SPAWNED  ${ITEM} → ${CASE}`);
process.exit(0);
