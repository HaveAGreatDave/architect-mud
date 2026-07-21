// One-shot: repoint inventory rows left dangling by the drug_voidwalk -> drug_deadair
// rename (77182f31).
//
// The content deploy is additive-plus-git-diff-driven-deletions: it removed the old
// item rows and inserted the new ones, but player_inventory holds item ids and has no
// FK, so any row still holding item_voidwalk / item_raw_voidwalk now points at
// nothing. That surfaces as a broken inventory entry.
//
// This is a DATA transformation on existing rows — the one thing the deploy can never
// do for us, and exactly what CLAUDE.md reserves one-shots for.
//
//   node --env-file=.env.prod scripts/repoint-voidwalk-inventory.mjs --dry
//   node --env-file=.env.prod scripts/repoint-voidwalk-inventory.mjs --yes
import { query } from '../server/models/db.js';

const MAP = { item_voidwalk: 'item_deadair', item_raw_voidwalk: 'item_raw_deadair' };
const args = new Set(process.argv.slice(2));
const commit = args.has('--yes');

const host = (process.env.DATABASE_URL || '').replace(/^.*@/, '').split('/')[0];
console.log(`target: ${host}\n`);

// Refuse to repoint at an id that isn't there yet — pointing at a different
// nonexistent row would be no better than the dangle we're fixing.
const { rows: present } = await query('SELECT id FROM items WHERE id = ANY($1)', [Object.values(MAP)]);
const missing = Object.values(MAP).filter(id => !present.some(r => r.id === id));
if (missing.length) {
  console.error(`✗ Target item(s) not on this database yet: ${missing.join(', ')}`);
  console.error('  The content deploy has not landed here. Aborting rather than creating a new dangle.');
  process.exit(1);
}

const { rows } = await query(
  'SELECT id, player_id, item_id, quantity FROM player_inventory WHERE item_id = ANY($1) ORDER BY player_id',
  [Object.keys(MAP)]
);
if (!rows.length) { console.log('Nothing to do — no rows reference the old ids.'); process.exit(0); }

for (const r of rows) console.log(`  ${r.player_id.padEnd(24)} ${r.item_id} x${r.quantity}  ->  ${MAP[r.item_id]}`);
console.log(`\n${rows.length} row(s).`);

if (!commit) { console.log('\nDRY RUN — pass --yes to apply.'); process.exit(0); }

let moved = 0;
for (const [from, to] of Object.entries(MAP)) {
  const res = await query('UPDATE player_inventory SET item_id=$1 WHERE item_id=$2', [to, from]);
  moved += res.rowCount;
}
const { rows: left } = await query('SELECT count(*)::int n FROM player_inventory WHERE item_id = ANY($1)', [Object.keys(MAP)]);
console.log(`\n✓ Repointed ${moved} row(s). Remaining references to the old ids: ${left[0].n}`);
process.exit(left[0].n === 0 ? 0 : 1);
