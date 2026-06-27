import { fileURLToPath } from 'url';
import { query } from '../db.js';

// One-time schema cleanup: the senses stat was removed from the engine. This
// drops the now-unused column from production. SCHEMA_SQL no longer declares it,
// so a fresh DB never gets the column; this just retires it on existing DBs.
// Guard: only runs when invoked directly.
async function dropStatSenses() {
  await query('ALTER TABLE players DROP COLUMN IF EXISTS stat_senses');
  console.log('✅ Dropped players.stat_senses (if it existed).');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  dropStatSenses().catch(e => { console.error(e); process.exit(1); });
}
