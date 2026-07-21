// One-shot: delete player_inventory rows holding `item_credits_small`.
//
// `item_credits_small` is a ghost id — it exists in no content file, no engine or
// plugin code, no script, and not even the retired seeds. Nothing generates it any
// more (0 references in enemies.loot_table, 0 in items.tags), and no `items` row
// defines it. It looks like a retired "small pack of credits" pickup, superseded by
// item_credit_chip.
//
// Two rows survived it. They cannot be examined, used or sold — the item does not
// resolve — so they are already dead weight in those players' packs; this only stops
// them being a dangling reference. They are NOT convertible: a credit chip carries
// its denomination in custom_data, and both rows have custom_data {} — the amount is
// gone, so any conversion would either mint worthless chips or invent a figure.
//
// Deliberately scoped to that one id rather than "everything dangling", so it can
// never sweep up a row that is transiently unresolvable for some other reason.
//
//   node --env-file=.env.prod scripts/purge-dangling-credits-small.mjs --dry
//   node --env-file=.env.prod scripts/purge-dangling-credits-small.mjs --yes
import { query } from '../server/models/db.js';

const GHOST = 'item_credits_small';
const commit = new Set(process.argv.slice(2)).has('--yes');
const host = (process.env.DATABASE_URL || '').replace(/^.*@/, '').split('/')[0];
console.log(`target: ${host}\n`);

// Refuse if the id has come BACK — if something re-authored the item, these rows are
// suddenly valid again and deleting them would be destroying real property.
const { rows: exists } = await query('SELECT id FROM items WHERE id=$1', [GHOST]);
if (exists.length) {
  console.error(`✗ ${GHOST} now EXISTS in items — these rows are valid again. Aborting.`);
  process.exit(1);
}

const { rows } = await query(
  'SELECT pi.id, pi.player_id, pi.quantity, pi.custom_data, p.handle FROM player_inventory pi LEFT JOIN players p ON p.id = pi.player_id WHERE pi.item_id=$1 ORDER BY pi.player_id',
  [GHOST]
);
if (!rows.length) { console.log('Nothing to do — no rows hold that id.'); process.exit(0); }

console.log('Rows to delete (recorded here so the loss is auditable):');
for (const r of rows) {
  console.log(`  ${(r.handle || '(no player row)').padEnd(20)} ${r.player_id}  x${r.quantity}  custom_data=${JSON.stringify(r.custom_data)}`);
}
console.log(`\n${rows.length} row(s).`);

if (!commit) { console.log('\nDRY RUN — pass --yes to apply.'); process.exit(0); }

const res = await query('DELETE FROM player_inventory WHERE item_id=$1', [GHOST]);
const { rows: left } = await query(
  'SELECT count(*)::int n FROM player_inventory pi LEFT JOIN items i ON i.id = pi.item_id WHERE i.id IS NULL'
);
console.log(`\n✓ Deleted ${res.rowCount} row(s). Dangling inventory rows remaining across the whole DB: ${left[0].n}`);
process.exit(0);
