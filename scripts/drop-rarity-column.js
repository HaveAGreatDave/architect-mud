// One-shot migration: drop the decorative `rarity` column from items and mutations.
// Rarity was never read by any game mechanic — it only colored UI text. Removed so a
// future "rare items" system can be designed deliberately rather than inheriting this
// base-rarity field. SCHEMA_SQL has already been updated to match; run this once against
// production to bring the live DB in line. Run: node scripts/drop-rarity-column.js
import { query } from '../server/models/db.js';

await query(`ALTER TABLE items DROP COLUMN IF EXISTS rarity`);
console.log('DROPPED items.rarity');

await query(`ALTER TABLE mutations DROP COLUMN IF EXISTS rarity`);
console.log('DROPPED mutations.rarity');

process.exit(0);
