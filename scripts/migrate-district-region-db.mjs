// One-shot DB migration: rename the spatial-district concept to "region" in a live
// database. The additive content deploy (INSERT … ON CONFLICT DO NOTHING) can never
// rewrite existing rows, so this transforms them in place. Run once per DB, AFTER the
// schema carrying the `regions` table has been applied (local: `npm run db:schema`;
// prod: the CODEX deploy).
//
//   local: node scripts/migrate-district-region-db.mjs
//   prod:  node --env-file=.env.prod scripts/migrate-district-region-db.mjs
//
// Steps (idempotent — safe to re-run):
//   1. copy any legacy `districts` rows into `regions`, remapping id district_→region_
//   2. rewrite zones.flags: key district_id → region_id, value district_<slug> → region_<slug>
//   3. drop the old `districts` table
import { query } from '../server/models/db.js';

// 1. Carry legacy district rows across (only if the old table is still present).
const { rows: [{ t }] } = await query("SELECT to_regclass('public.districts') AS t");
if (t) {
  const r = await query(`INSERT INTO regions (id, name, base_terrain, grid_z, created_by, updated_at)
    SELECT regexp_replace(id, '^district_', 'region_'), name, base_terrain, grid_z, created_by, updated_at
    FROM districts
    ON CONFLICT (id) DO NOTHING`);
  console.log(`✓ regions: carried ${r.rowCount} row(s) over from the legacy districts table`);
} else {
  console.log('· no legacy districts table — regions table is authoritative');
}

// 2. Rewrite the zone membership flag on every tile that still carries it.
const z = await query(`UPDATE zones
  SET flags = (flags - 'district_id')
    || jsonb_build_object('region_id', regexp_replace(flags->>'district_id', '^district_', 'region_'))
  WHERE flags ? 'district_id'`);
console.log(`✓ zones: rewrote district_id → region_id on ${z.rowCount} row(s)`);

// 3. Retire the old table.
await query('DROP TABLE IF EXISTS districts');
console.log('✓ dropped the legacy districts table');
console.log('Done.');
process.exit(0);
