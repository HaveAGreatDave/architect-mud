// One-shot: drop the legacy 6-stat columns from players. The live stat system
// is stat_brawn/reflexes/endurance/brains/cool/senses; nothing reads these
// (grep gate: only schema.js named them). Content that referenced legacy keys
// (mutations, drug_buzz) was remapped in the same change.
//
//   node scripts/drop-legacy-stats.mjs                      (local dev DB)
//   node --env-file=.env.prod scripts/drop-legacy-stats.mjs (prod, deliberate)
import { query } from '../server/models/db.js';

for (const col of ['stat_str', 'stat_agi', 'stat_int', 'stat_wil', 'stat_end', 'stat_cha']) {
  await query(`ALTER TABLE players DROP COLUMN IF EXISTS ${col}`);
  console.log(`✓ dropped players.${col}`);
}
process.exit(0);
