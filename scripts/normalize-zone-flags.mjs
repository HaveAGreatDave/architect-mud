// One-shot: normalize zones.flags bags ahead of catalog validation.
//
//   node scripts/normalize-zone-flags.mjs                        (local dev DB)
//   node --env-file=.env.prod scripts/normalize-zone-flags.mjs   (prod)
//   add --dry-run to report without writing
//
// The dev panel's saveZone historically packed junk values into flags —
// `is_building: false`, `building_name: null`, `world_exit_zone: ""` — on every
// save. Every engine reader is truthy-based (`zone.flags?.is_building`), so
// dropping null / false / '' values is behavior-neutral, but they matter now:
// zones.flags is becoming the catalog-validated zone tag bag, where presence IS
// the signal (hasTag), so a `sanctuary: false` would read as present.
// Idempotent — re-running is a no-op once bags are clean.
import { query } from '../server/models/db.js';

const dryRun = process.argv.includes('--dry-run');
const isJunk = (v) => v === null || v === false || v === '';

const { rows } = await query('SELECT id, flags FROM zones');
let touched = 0, removedTotal = 0;
for (const row of rows) {
  const flags = row.flags || {};
  const junkKeys = Object.entries(flags).filter(([, v]) => isJunk(v)).map(([k]) => k);
  if (!junkKeys.length) continue;
  const cleaned = { ...flags };
  for (const k of junkKeys) delete cleaned[k];
  touched++;
  removedTotal += junkKeys.length;
  console.log(`  ${row.id}: -${junkKeys.join(', -')}`);
  if (!dryRun) {
    await query('UPDATE zones SET flags=$1 WHERE id=$2', [JSON.stringify(cleaned), row.id]);
  }
}
console.log(`\n${dryRun ? '[dry-run] would clean' : 'cleaned'} ${touched}/${rows.length} zones (${removedTotal} junk keys removed)`);
process.exit(0);
