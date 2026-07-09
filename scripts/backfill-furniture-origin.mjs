// One-shot: stamp furniture.origin for rows that predate the provenance column.
//
// Rule: a row whose id has a git file under content/furniture/ is authored
// (the column default). A fileless row is marked origin='player' when it
// matches a known player-writer signature; anything else fileless is listed
// for human review and left authored (status quo: the deploy can't touch a
// fileless row anyway).
//
// Also backfills owner_id where the owning system recorded it elsewhere
// (security_devices.owner_id, generators.flags.owner_id).
//
//   node scripts/backfill-furniture-origin.mjs                      (local)
//   node --env-file=.env.prod scripts/backfill-furniture-origin.mjs (prod — run AFTER the push that adds the column)
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { query } from '../server/models/db.js';

// Preflight: the origin column reaches this DB via SCHEMA_SQL — on prod that
// means the CODEX deploy (push to main), never a manual db:schema. Running the
// backfill first is a harmless ordering mistake; explain it instead of crashing.
const { rows: colCheck } = await query(
  `SELECT 1 FROM information_schema.columns WHERE table_name='furniture' AND column_name='origin'`);
if (!colCheck.length) {
  console.error(
    '✗ furniture.origin does not exist in this DB yet.\n' +
    '  This backfill runs AFTER the push that ships the column:\n' +
    '    1. push to main (CI applies SCHEMA_SQL + deploys the origin-stamping code)\n' +
    '    2. re-run this script.\n' +
    '  (On a local dev DB: npm run db:schema, then re-run.)');
  process.exit(1);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'furniture');
const fileIds = new Set();
for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
  try { fileIds.add(JSON.parse(readFileSync(join(dir, f), 'utf8')).id); } catch { /* lint owns malformed files */ }
}
console.log(`${fileIds.size} authored furniture ids in content/.`);

const { rows } = await query('SELECT id, object_type, flags FROM furniture WHERE origin=$1', ['authored']);
const player = [];
const review = [];
for (const r of rows) {
  if (fileIds.has(r.id)) continue; // git-backed → authored, correct as-is
  const f = r.flags || {};
  const isPlayerRow =
    /^furn_[0-9a-f]{8}$/.test(r.id) ||            // furniture-shop purchases
    f.security_device === true ||                  // planted surveillance gear
    r.object_type === 'generator_portable' ||      // portable generators
    f.hero_poster === true ||                      // hung posters
    f.corp_terminal === true;                      // corp HQ terminals
  (isPlayerRow ? player : review).push(r.id);
}

for (const id of player) {
  await query(`UPDATE furniture SET origin='player' WHERE id=$1`, [id]);
  console.log(`  → player: ${id}`);
}
if (review.length) {
  console.log(`\n${review.length} fileless row(s) left authored — review (system autobuild rows are expected here):`);
  for (const id of review) console.log(`    ? ${id}`);
}

// owner_id from the owning systems' own records.
const dev = await query(`
  UPDATE furniture f SET owner_id = sd.owner_id
  FROM security_devices sd
  WHERE f.id = sd.id AND f.origin='player' AND f.owner_id IS NULL AND sd.owner_id IS NOT NULL`);
const gen = await query(`
  UPDATE furniture f SET owner_id = g.flags->>'owner_id'
  FROM generators g
  WHERE f.flags->>'generator_id' = g.id AND f.origin='player' AND f.owner_id IS NULL AND g.flags->>'owner_id' IS NOT NULL`);
console.log(`\n✓ ${player.length} row(s) marked player; owner_id backfilled: ${dev.rowCount} device(s), ${gen.rowCount} generator(s).`);
process.exit(0);
