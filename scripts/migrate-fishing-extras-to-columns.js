// One-shot migration: move fishing-only pools out of scavenging_tables.messages.fishing
// into the dedicated fishing_monsters / fishing_bait_catches columns.
//
// Fishing reuses the scavenging_tables schema; its monster hooks + bait-gated catches
// used to ride in a messages.fishing sub-key. The scavenging dev panel rebuilds
// `messages` on every save and silently wiped that key (docs/audits/findings-2026-07-
// content-shape.md, finding B). The data now lives in real columns; this backfills
// existing rows and drops the stale messages.fishing key.
//
// SCHEMA_SQL already defines the columns; run db:schema first if the live DB lacks them.
// Idempotent: rows already migrated (empty messages.fishing) are left untouched.
// Run: node scripts/migrate-fishing-extras-to-columns.js
import { query } from '../server/models/db.js';

const { rows } = await query(
  `SELECT id, messages FROM scavenging_tables WHERE messages ? 'fishing'`
);
if (!rows.length) { console.log('No rows with messages.fishing — nothing to migrate.'); process.exit(0); }

for (const row of rows) {
  const fishing = row.messages.fishing || {};
  const monsters = Array.isArray(fishing.monsters) ? fishing.monsters : [];
  const baitCatches = Array.isArray(fishing.baitCatches) ? fishing.baitCatches : [];
  const messages = { ...row.messages };
  delete messages.fishing;
  await query(
    `UPDATE scavenging_tables
       SET fishing_monsters = $2, fishing_bait_catches = $3, messages = $4
     WHERE id = $1`,
    [row.id, JSON.stringify(monsters), JSON.stringify(baitCatches), JSON.stringify(messages)]
  );
  console.log(`migrated ${row.id}: ${monsters.length} monster(s), ${baitCatches.length} bait catch(es)`);
}
console.log(`Done — migrated ${rows.length} table(s).`);
process.exit(0);
