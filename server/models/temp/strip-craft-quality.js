import { fileURLToPath } from 'url';
import { query } from '../db.js';

// One-time data cleanup: crafting no longer stamps a `quality` tier onto items.
// This strips the now-dead `quality` key from existing player_inventory rows,
// leaving the rest of each row's custom_data (e.g. drug `potency`) intact.
// `quality` was never a column, so SCHEMA_SQL is unaffected. Runs only when
// invoked directly.
async function stripCraftQuality() {
  const { rowCount } = await query(
    `UPDATE player_inventory SET custom_data = custom_data - 'quality' WHERE custom_data ? 'quality'`
  );
  console.log(`✅ Stripped custom_data.quality from ${rowCount} inventory row(s).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  stripCraftQuality().catch(e => { console.error(e); process.exit(1); });
}
