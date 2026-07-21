// check-dangling — player-owned rows pointing at content that no longer exists.
//
//   node scripts/content/check-dangling.mjs                 against your local DB
//   node scripts/content/check-dangling.mjs --prod --yes    against production
//   node scripts/content/check-dangling.mjs --strict        exit 1 if anything dangles
//
// WHY. Content ids are renamed and retired through git, and the deploy's deletion
// pass removes the old rows — but player_inventory, player_quests and friends hold
// those ids with no foreign keys, so a rename silently orphans whatever players were
// carrying. There is no error, no log line, and the player just has something the
// game cannot render, use or sell.
//
// Two of these were found by hand in July 2026, both by accident: item_voidwalk
// stranded by the dead air rename, and item_credits_small — a retired pickup that had
// been sitting broken in two players' packs long enough that nobody could say when it
// broke. This is the check that would have caught both the week they happened.
//
// Non-blocking by default (::warning::, exit 0): the dangles it finds usually predate
// the deploy that surfaces them, and failing a content deploy over old data would
// just teach people to ignore it — the exact habit that let four failed deploys go
// unnoticed. --strict is there for when you want the gate to bite.
import { connectTarget } from './lib.mjs';

// player-owned column -> the content table it must resolve into. Discovered from
// information_schema; extend when a new player table starts holding a content id.
const REFS = [
  { table: 'player_inventory',  column: 'item_id',          into: 'items',     label: 'carried items' },
  { table: 'player_drug_state', column: 'drug_id',          into: 'drugs',     label: 'tolerance/addiction history' },
  { table: 'player_quests',     column: 'quest_id',         into: 'quests',    label: 'quest progress' },
  { table: 'player_mutations',  column: 'mutation_id',      into: 'mutations', label: 'mutations' },
  { table: 'players',           column: 'tracked_quest_id', into: 'quests',    label: 'tracked quest', playerCol: 'id' },
  { table: 'player_corpses',    column: 'zone_id',          into: 'zones',     label: 'corpse locations' },
];

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');

const { client, host } = await connectTarget({
  prod: args.has('--prod'), yes: args.has('--yes'), purpose: 'check dangling references in',
});
console.log(`Dangling-reference check — ${host}\n`);

let total = 0;
for (const r of REFS) {
  let rows;
  try {
    // Spliced compounds legitimately key player_drug_state on a composed id
    // ("drug_compound:a+b") that has no drugs row by design, so they are not dangles.
    const skipCompound = r.table === 'player_drug_state' ? ` AND p.${r.column} NOT LIKE '%:%'` : '';
    ({ rows } = await client.query(
      `SELECT p.${r.column} AS ref, count(*)::int AS rows, count(DISTINCT p.${r.playerCol || "player_id"})::int AS players
         FROM ${r.table} p
         LEFT JOIN ${r.into} c ON c.id = p.${r.column}
        WHERE p.${r.column} IS NOT NULL AND c.id IS NULL${skipCompound}
        GROUP BY p.${r.column} ORDER BY rows DESC`
    ));
  } catch (e) {
    console.log(`  ${r.table}.${r.column}: skipped (${e.message.split('\n')[0]})`);
    continue;
  }
  if (!rows.length) { console.log(`  ✓ ${r.label.padEnd(28)} (${r.table}.${r.column} → ${r.into})`); continue; }

  const n = rows.reduce((a, x) => a + x.rows, 0);
  total += n;
  console.log(`  ✗ ${r.label.padEnd(28)} ${n} row(s) pointing at missing ${r.into}:`);
  for (const x of rows) console.log(`      ${x.ref}  — ${x.rows} row(s), ${x.players} player(s)`);
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::warning title=Dangling ${r.into} reference::${n} ${r.table} row(s) point at ${r.into} that no longer exist: ${rows.map(x => x.ref).join(', ')}`);
  }
}

await client.end();
console.log(total ? `\n${total} dangling reference(s). Repoint or purge them with a one-shot (see scripts/repoint-* / scripts/purge-*).`
                  : `\nNo dangling references.`);
process.exit(strict && total ? 1 : 0);
