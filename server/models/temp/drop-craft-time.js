import { fileURLToPath } from 'url';
import { query } from '../db.js';

// One-time schema cleanup: the recipes.craft_time column was scaffolded for a
// crafting-delay feature that was never built — no engine, plugin, or dev-panel
// code reads it. Drop it. SCHEMA_SQL and db/seed.sql have been updated to match.
// Idempotent (IF EXISTS); runs only when invoked directly.
async function dropCraftTime() {
  await query(`ALTER TABLE recipes DROP COLUMN IF EXISTS craft_time`);
  console.log('✅ Dropped recipes.craft_time (if it existed).');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  dropCraftTime().catch(e => { console.error(e); process.exit(1); });
}
