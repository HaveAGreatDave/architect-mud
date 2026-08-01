// ONE-SHOT — strip the dead `flags.planner` provenance marker from zones.
//
// `tools/zone-planner` and its `bp_district` blueprint were deleted 2026-08-01: the
// Studio authors the map now, against content files. The flag it stamped was never
// read by the game — it only told the planner which tiles it was allowed to
// regenerate — so it went out of the catalog and out of all 5,309 content files in
// the same pass.
//
// The content deploy is additive (`INSERT … ON CONFLICT DO NOTHING`), so it can
// never REMOVE a key from a row that already exists. That's what this is for: the
// data transformation the pipeline structurally cannot do. Without it, live rows
// keep a flag the catalog no longer knows, and the regress zone-flag sweep fails on
// every one of them.
//
// Local:  node scripts/drop-planner-flag.mjs
// Prod:   node --env-file=.env.prod scripts/drop-planner-flag.mjs
// Idempotent; safe to re-run.
import pool, { query } from '../server/models/db.js';

const { rows: before } = await query(
  `SELECT count(*)::int AS n FROM zones WHERE flags ? 'planner'`);
console.log(`zones carrying flags.planner: ${before[0].n}`);

if (before[0].n) {
  const { rowCount } = await query(
    `UPDATE zones SET flags = flags - 'planner' WHERE flags ? 'planner'`);
  console.log(`stripped ${rowCount} row(s)`);
}

const { rows: after } = await query(
  `SELECT count(*)::int AS n FROM zones WHERE flags ? 'planner'`);
console.log(after[0].n === 0 ? '✓ none left' : `✗ ${after[0].n} still carry it`);
await pool.end();
