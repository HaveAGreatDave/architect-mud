// One-shot: remove four prod-only playlist rows that shadow the KSAB schedule.
//
// WHY THIS IS A SCRIPT AND NOT A CONTENT COMMIT
// The CODEX deletion pass is git-diff driven: it removes rows for files deleted
// between the last-imported marker and HEAD. These four rows were created
// directly on prod (the `pl_` prefix is the panel's insert path) and were never
// exported, so no file was ever deleted and the pass cannot see them. A data
// transformation on existing rows is exactly the case CLAUDE.md reserves manual
// one-shots for.
//
// WHAT THEY ARE
// All four are days=127 — every day — duplicating a show the git grid already
// schedules with proper day gating. Same shadowing bug as the nine retired in
// c3cb0f89, which is why The Last Lot never aired: at 16:00 it was losing to an
// unconditional Raptor News row that only exists here.
//
// SAFETY
// Scoped to four literal ids. It counts what it matched before deleting and
// aborts without touching anything if the count is not exactly four — so a row
// already removed by hand cannot turn this into a wider delete than intended.
//
// RUN
//   node --env-file=.env.prod scripts/fix-playlist-drift.mjs
// Omit the flag to run it against your local DB instead (a no-op there: these
// rows only exist on prod).
import { query } from '../server/models/db.js';

const IDS = [
  'pl_cafdb576-24e6-4ced-b66c-1682c8ee9902', // 14:00 DOOMCAST — dupe of the gated row
  'pl_30b62af0-d863-4037-8534-8770d86a2202', // 16:00 Raptor News — the row shadowing The Last Lot
  'pl_3c063e65-daeb-4932-95ee-8f932400b123', // 18:00 Deadball — dupe of the Mon/Wed/Fri/Sun row
  'pl_f708b8e6-c95f-483e-b2e3-754b5838c473', // 21:00 Tonight Show — dupe
];

const before = await query(
  `SELECT p.id, p.start_time, p.days, b.name
     FROM media_channel_playlist p
     LEFT JOIN media_broadcasts b ON b.id = p.broadcast_id
    WHERE p.id = ANY($1)
    ORDER BY p.start_time`,
  [IDS]);

console.log(`matched ${before.rows.length} of ${IDS.length} target rows:`);
for (const r of before.rows) {
  const hh = String(Math.floor(r.start_time / 3600)).padStart(2, '0');
  console.log(`  ${hh}:00  days=${r.days}  ${r.name}`);
}

if (before.rows.length === 0) {
  console.log('\nNothing to do — already clean.');
  process.exit(0);
}
if (before.rows.length !== IDS.length) {
  console.log('\nCOUNT MISMATCH — expected exactly '
    + IDS.length + '. Nothing deleted; check the ids by hand.');
  process.exit(1);
}

const del = await query('DELETE FROM media_channel_playlist WHERE id = ANY($1)', [IDS]);
console.log(`\ndeleted: ${del.rowCount}`);

const after = await query('SELECT count(*)::int AS n FROM media_channel_playlist');
console.log(`playlist rows remaining: ${after.rows[0].n}`);
process.exit(0);
