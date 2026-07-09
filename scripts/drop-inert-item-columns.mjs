// One-shot: drop the inert legacy behavior columns from items. The engine
// reads item behavior only from tags (docs/tags.md — this is the deferred
// "Phase 5"). type/description/flags are kept: vendor/commerce read type,
// vendor listings read description, and dual-read fallbacks still consult
// flags. Run only AFTER the code that stopped writing these columns is
// deployed (keycard/cassette INSERTs), and re-export content in the same
// change so content/items/*.json loses the keys.
//
//   node scripts/drop-inert-item-columns.mjs                      (local)
//   node --env-file=.env.prod scripts/drop-inert-item-columns.mjs (prod)
import { query } from '../server/models/db.js';

for (const col of ['subtype', 'is_stackable', 'is_unique', 'is_quest_item', 'effects', 'stat_modifiers', 'requirements']) {
  await query(`ALTER TABLE items DROP COLUMN IF EXISTS ${col}`);
  console.log(`✓ dropped items.${col}`);
}
process.exit(0);
