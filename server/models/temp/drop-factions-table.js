/**
 * One-shot: drop the legacy `factions` table after the fold into `orgs`.
 *
 * Safety-gated: refuses to drop unless every factions row is already present as
 * an NPC org (is_npc=1) with a matching id — so the drop can't lose data. Run the
 * fold first (npm run db:fold-factions). No FK references `factions`, so the drop
 * is clean; player_faction_rep is untouched (its faction_id now points at orgs.id).
 *
 * Idempotent: if the table is already gone, it's a no-op. Run with:
 *   npm run db:drop-factions
 */
import { fileURLToPath } from 'url';
import { query } from '../db.js';

async function tableExists(table) {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_name=$1`, [table]
  );
  return rows.length > 0;
}

async function drop() {
  if (!(await tableExists('factions'))) {
    console.log('• factions table already gone — nothing to drop.');
    return;
  }
  // Safety: every factions id must exist as an NPC org before we drop.
  const { rows } = await query(`
    SELECT id FROM factions WHERE id NOT IN (SELECT id FROM orgs WHERE is_npc = 1)
  `);
  if (rows.length) {
    throw new Error(
      `Refusing to drop: ${rows.length} faction(s) not yet folded into orgs ` +
      `(${rows.map(r => r.id).join(', ')}). Run "npm run db:fold-factions" first.`
    );
  }
  await query('DROP TABLE factions');
  console.log('✓ Dropped legacy factions table. NPC factions live in orgs (is_npc=1).');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  drop().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
}
