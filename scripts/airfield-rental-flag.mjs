// scripts/airfield-rental-flag.mjs — one-shot data transformation.
//
// Splits the self-fly RENTAL desk off `airfield_charter` onto its own positive
// capability flag, `airfield_rental` — so the three airfield desks are finally
// independent: `airfield_dealer` (buy), `airfield_rental` (rent, you fly),
// `airfield_charter` (an NPC flies you).
//
// Why: opening a charter desk used to force a rental counter open with it, and
// the only suppressor was `charter_vtol_only`, which state.js:380 folds into
// `airfield_vtol_only` — that would have made the whole field VTOL-only and
// broken the fixed-wing raws runs off Buzzard Field's dirt strip.
//
// This backfills `airfield_rental: true` onto exactly the fields that offered
// rentals under the OLD rule (`airfield_charter && !charter_vtol_only`), so
// nothing changes anywhere except the Reach, which is deliberately left without
// one. Run this in the SAME deploy as the code change — until it runs, `rent`
// is closed at every field.
//
// Idempotent.
//
//   node scripts/airfield-rental-flag.mjs                     # local dev DB
//   node --env-file=.env.prod scripts/airfield-rental-flag.mjs # prod

import { writeFileSync } from 'node:fs';
import { query } from '../server/models/db.js';
import { contentEntries } from '../server/models/content-registry.js';
import { CONTENT_DIR, canonicalJson, fileNameForRow, rowToFileObject } from './content/lib.mjs';

// Buzzard Field charters but does NOT rent — a smuggler's haven doesn't run a
// hire counter. Excluded explicitly so a re-run never re-opens it.
const NO_RENTAL = ['zone_the_reach_870_1958'];

async function main() {
  const { rows: before } = await query(
    `SELECT id, flags->>'airfield_name' AS name
       FROM zones
      WHERE flags ? 'airfield_id'
        AND flags->>'airfield_charter' = 'true'
        AND COALESCE(flags->>'charter_vtol_only', 'false') <> 'true'
        AND NOT (id = ANY($1))
      ORDER BY id`, [NO_RENTAL]);

  for (const z of before) {
    await query(
      `UPDATE zones SET flags = jsonb_set(COALESCE(flags,'{}'::jsonb), '{airfield_rental}', 'true') WHERE id = $1`,
      [z.id]);
    console.log(`  ✓ rental desk: ${z.name || z.id}`);
  }

  // Mirror into content/ so a fresh import carries the flag too (content:import
  // is additive and could never add it to an existing row).
  const entry = contentEntries().find(e => e.table === 'zones');
  for (const z of before) {
    const { rows } = await query('SELECT * FROM zones WHERE id = $1', [z.id]);
    writeFileSync(`${CONTENT_DIR}/zones/${fileNameForRow(entry, rows[0])}`,
      canonicalJson(rowToFileObject(entry, rows[0])), 'utf8');
  }

  // Report the whole roster so the split is auditable at a glance.
  const { rows: all } = await query(
    `SELECT flags->>'airfield_name' AS name,
            COALESCE(flags->>'airfield_dealer','false')  AS buy,
            COALESCE(flags->>'airfield_rental','false')  AS rent,
            COALESCE(flags->>'airfield_charter','false') AS charter
       FROM zones WHERE flags ? 'airfield_id' ORDER BY id`);
  console.log('\n  field                    buy    rent   charter');
  for (const f of all) {
    const y = v => (v === 'true' ? 'yes' : '—').padEnd(6);
    console.log(`  ${String(f.name).padEnd(24)} ${y(f.buy)} ${y(f.rent)} ${y(f.charter)}`);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
