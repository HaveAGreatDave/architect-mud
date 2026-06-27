// One-shot migration: convert item weights and container capacities from kg to grams (×1000).
// Run ONCE: node scripts/migrate-weight-to-grams.js
//
// WARNING: running this twice multiplies by 1,000,000. The guard below aborts if
// it looks like values are already in grams (any item weight >= 1000), but verify
// before re-running.
import { query } from '../server/models/db.js';

const { rows: probe } = await query('SELECT COUNT(*) AS n FROM items WHERE weight >= 1000');
if (Number(probe[0].n) > 0) {
  console.error(`Aborting: ${probe[0].n} item(s) already have weight >= 1000 — looks already migrated.`);
  process.exit(1);
}

// Item carry weight: kg → grams.
const r1 = await query('UPDATE items SET weight = ROUND(weight * 1000)');
console.log(`items.weight: ${r1.rowCount} rows ×1000`);

// Item container capacity (tags.container JSON value): kg → grams.
const r2 = await query(
  `UPDATE items SET tags = jsonb_set(tags, '{container}',
     to_jsonb(ROUND((tags->>'container')::numeric * 1000)))
   WHERE tags ? 'container'`
);
console.log(`items.tags.container: ${r2.rowCount} rows ×1000`);

// Furniture container capacity (flags.container JSON value): kg → grams.
const r3 = await query(
  `UPDATE furniture SET flags = jsonb_set(flags, '{container}',
     to_jsonb(ROUND((flags->>'container')::numeric * 1000)))
   WHERE flags ? 'container'`
);
console.log(`furniture.flags.container: ${r3.rowCount} rows ×1000`);

console.log('\nDone.');
process.exit(0);
