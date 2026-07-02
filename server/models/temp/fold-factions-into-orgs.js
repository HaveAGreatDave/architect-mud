/**
 * One-shot fold of the legacy `factions` table into the unified `orgs` table.
 *
 *  - Copies every factions row into orgs PRESERVING its id, as an owner-less
 *    NPC faction (is_npc=1). Preserving ids is the load-bearing invariant that
 *    keeps player_faction_rep.faction_id, npcs.faction, and atm_networks.faction_id
 *    resolving with zero data rewrite.
 *  - Flattens factions.hostile_to / friendly_to (JSONB arrays) into org_relations
 *    rows, skipping any target id that has no matching org.
 *
 * Requires `npm run db:schema` to have created the orgs/org_relations tables first.
 * Idempotent: ON CONFLICT DO NOTHING, safe to re-run. Run with:
 *   npm run db:fold-factions   (or: node server/models/temp/fold-factions-into-orgs.js)
 */
import { fileURLToPath } from 'url';
import { query } from '../db.js';

async function tableExists(table) {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_name=$1`, [table]
  );
  return rows.length > 0;
}

async function fold() {
  if (!(await tableExists('orgs')) || !(await tableExists('org_relations'))) {
    throw new Error('orgs/org_relations tables missing — run `npm run db:schema` first.');
  }
  if (!(await tableExists('factions'))) {
    console.log('• no legacy factions table — nothing to fold.');
    return;
  }

  // 1. Factions -> orgs (ids preserved, owner-less NPC factions).
  const ins = await query(`
    INSERT INTO orgs (id, name, description, color, is_npc, owner_id, treasury)
    SELECT id, name, description, color, 1, NULL, 0 FROM factions
    ON CONFLICT (id) DO NOTHING
  `);
  console.log(`✓ Folded ${ins.rowCount} faction(s) into orgs (is_npc=1).`);

  // 2. hostile_to / friendly_to -> org_relations (skip dangling targets).
  for (const [col, stance] of [['hostile_to', 'hostile'], ['friendly_to', 'friendly']]) {
    const rel = await query(`
      INSERT INTO org_relations (org_id, other_org_id, stance)
      SELECT f.id, elem, $1
      FROM factions f, jsonb_array_elements_text(f.${col}) elem
      WHERE EXISTS (SELECT 1 FROM orgs o WHERE o.id = elem)
      ON CONFLICT DO NOTHING
    `, [stance]);
    console.log(`✓ ${rel.rowCount} ${stance} relation(s) from ${col}.`);
  }

  // 3. Verify the fold is lossless.
  const { rows: [{ fc }] } = await query('SELECT COUNT(*)::int AS fc FROM factions');
  const { rows: [{ oc }] } = await query('SELECT COUNT(*)::int AS oc FROM orgs WHERE is_npc = 1');
  const { rows: mismatch } = await query(`
    SELECT id FROM factions WHERE id NOT IN (SELECT id FROM orgs WHERE is_npc = 1)
  `);
  console.log(`\n— Verify — factions: ${fc}, NPC orgs: ${oc}, unmatched ids: ${mismatch.length}`);
  if (mismatch.length) {
    console.log(`⚠ ${mismatch.length} faction id(s) not present as NPC orgs: ${mismatch.map(r => r.id).join(', ')}`);
  } else {
    console.log('✓ Every faction id is present as an NPC org — rep/vendor/ATM references intact.');
  }
  console.log('\n✅ Fold complete.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  fold().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
