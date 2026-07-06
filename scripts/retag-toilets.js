// One-shot: retag furniture that is clearly a toilet but was created with the
// wrong object_type ('furniture' / 'fixture'), so the bodily system recognises
// it. The plugin now also matches toilets by name at runtime, but this makes the
// stored data canonical (object_type='toilet').
//
// Idempotent: only touches rows named like a toilet that aren't already tagged.
// Run local:  node scripts/retag-toilets.js
// Run prod:   node --env-file=.env.prod scripts/retag-toilets.js
import { query } from '../server/models/db.js';

const { rows } = await query(
  `UPDATE furniture
      SET object_type = 'toilet'
    WHERE name ILIKE '%toilet%'
      AND object_type IS DISTINCT FROM 'toilet'
      AND NOT jsonb_exists(flags, 'toilet')
  RETURNING id, name, zone_id`
);

if (!rows.length) {
  console.log('No mistyped toilets — nothing to retag.');
} else {
  console.log(`Retagged ${rows.length} toilet(s) to object_type='toilet':`);
  for (const r of rows) console.log(`  ${r.id}  "${r.name}"  (${r.zone_id})`);
}
process.exit(0);
