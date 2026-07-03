// One-shot script: bolt a prison weight bench into Precinct 9's holding cell.
// Run once:  DB_POOL_MAX=1 node scripts/create-cell-weightbench.js
//
// Furniture is queried live per-interaction (see plugins/interactions, plugins/
// weightbench), so no /world/reload is needed — it's usable the moment it lands.
// The bench carries both interactions: "lie" (get into position) and "lift"
// (the workout). See plugins/weightbench for the mechanic.
import { query } from '../server/models/db.js';

const ID = 'furn_cell_weightbench';
const ZONE = 'zone_mq_precinct_holding';

const { rows: existing } = await query('SELECT id FROM furniture WHERE id=$1', [ID]);
if (existing.length) {
  console.log('Already exists:', ID);
  process.exit(0);
}

await query(
  `INSERT INTO furniture (id, zone_id, name, description, object_type, flags)
   VALUES ($1, $2, $3, $4, 'furniture', $5::jsonb)`,
  [
    ID,
    ZONE,
    'prison weight bench',
    'A slab of a bench welded from scrap rebar and a cracked vinyl pad, bolted to the floor so nobody gets ideas about swinging it. The plates are mismatched chunks of poured concrete on a bent bar, worn smooth by a thousand bored inmates. It is, somehow, the most honest thing in the building.',
    JSON.stringify({ interactions: ['lie', 'lift'] }),
  ]
);

console.log(`Created: ${ID} in ${ZONE}`);
console.log('In-game: go to the holding cell, then `lie on weight bench`, then `lift`.');
process.exit(0);
