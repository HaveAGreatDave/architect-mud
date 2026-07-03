import { fileURLToPath } from 'url';
import { query } from '../db.js';

// One-time schema change: the senses stat is being brought back (it was dropped
// by drop-stat-senses.js). This re-adds the column on existing DBs. SCHEMA_SQL
// declares it again, so a fresh DB gets it via `npm run db:schema`; this just
// backfills production. New characters start at 1 (set in the creation INSERT);
// existing survivors default to 0 and can `raise` it. Guard: direct-invoke only.
async function addStatSenses() {
  await query('ALTER TABLE players ADD COLUMN IF NOT EXISTS stat_senses INTEGER DEFAULT 0');
  console.log('✅ Added players.stat_senses (if it did not exist).');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  addStatSenses().catch(e => { console.error(e); process.exit(1); });
}
