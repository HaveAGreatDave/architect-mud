/**
 * Migration Script: Move furniture capabilities from the legacy `object_type`
 * string onto the unified tag system (furniture.flags), per ADR-0003.
 *
 * Capabilities affected: toilet, sink (→ water_source), cosmetic_machine.
 * (media_deck already carries flags.media_deck and needs no backfill.)
 *
 * The engine reads both `object_type='x'` and the flag during the transition,
 * so this backfill is what lets `object_type` eventually be retired. Idempotent:
 * only sets a flag where it is missing. Leaves `object_type` untouched.
 *
 * Run once against production: node scripts/migrate-furniture-capability-tags.js
 */

import { query } from '../server/models/db.js';

// object_type value → flag key to set on furniture.flags
const CAPABILITY_MAP = {
  toilet: 'toilet',
  sink: 'water_source',
  cosmetic_machine: 'cosmetic_machine',
};

async function migrateFurnitureCapabilities() {
  console.log('Backfilling furniture capability flags from object_type...');
  let total = 0;
  for (const [objectType, flag] of Object.entries(CAPABILITY_MAP)) {
    const { rowCount } = await query(
      `UPDATE furniture
         SET flags = COALESCE(flags, '{}'::jsonb) || jsonb_build_object($1::text, true)
       WHERE object_type = $2
         AND NOT (COALESCE(flags, '{}'::jsonb) ? $1)`,
      [flag, objectType]
    );
    console.log(`  ${objectType} → flags.${flag}: ${rowCount} row(s) updated`);
    total += rowCount;
  }
  console.log(`Done. ${total} furniture row(s) backfilled.`);
}

migrateFurnitureCapabilities()
  .then(() => process.exit(0))
  .catch((err) => { console.error('Migration failed:', err); process.exit(1); });
