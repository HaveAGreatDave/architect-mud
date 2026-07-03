/**
 * NPC sex backfill.
 *
 * NPC `sex` was never settable through the dev-panel editor, so many NPCs sit at
 * the 'male' default regardless of how they're written. This infers each NPC's
 * sex from its name + description (which almost always carry gendered pronouns/
 * nouns) and corrects the column where the two disagree. NPCs with no gendered
 * signal are left as-is (no random churn on existing content).
 *
 * After running this, re-run the clothing pass to align outfits to any corrected
 * sexes:  node server/models/temp/backfill-npc-clothing.js --reclothe --apply
 *
 * Dry-run unless --apply.
 *   node server/models/temp/backfill-npc-sex.js
 *   node server/models/temp/backfill-npc-sex.js --apply
 */
import 'dotenv/config';
import { query } from '../db.js';
import { inferSex, stableFlipSex } from '../../engine/npc-sex.js';

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`=== backfill-npc-sex (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
  const { rows } = await query('SELECT id, name, sex, description FROM npcs ORDER BY name');

  const changes = [];
  const kept = [];
  for (const npc of rows) {
    const inferred = inferSex(npc.name, npc.description);
    const isBinary = npc.sex === 'male' || npc.sex === 'female';
    if (inferred && inferred !== npc.sex) {
      // Clear gendered language disagrees with the stored value → correct it.
      changes.push({ npc, to: inferred, why: 'inferred' });
    } else if (!isBinary) {
      // 'other' / null / anything non-binary must be resolved — no NPC stays
      // 'other'. Infer if we can, else the stable per-id fallback.
      changes.push({ npc, to: inferred || stableFlipSex(npc.id), why: inferred ? 'inferred' : 'fallback (neutral text)' });
    } else {
      kept.push({ npc, reason: inferred ? `matches (${npc.sex})` : `no signal — keep ${npc.sex}` });
    }
  }

  console.log(`Total NPCs: ${rows.length}   → correct: ${changes.length}   → keep: ${kept.length}\n`);
  console.log('── CORRECTIONS ────────────────────────────────────────────');
  for (const c of changes) console.log(`  ${(c.npc.name||'').padEnd(24)} ${(c.npc.sex||'?')} → ${c.to}  [${c.why}]`);
  console.log('\n── KEPT ───────────────────────────────────────────────────');
  for (const k of kept) console.log(`  ${(k.npc.name||'').padEnd(24)} — ${k.reason}`);

  if (!APPLY) {
    console.log(`\nDry run. Re-run with --apply to correct the ${changes.length} NPC(s).`);
    process.exit(0);
  }

  console.log(`\nApplying ${changes.length} correction(s)...\n`);
  for (const c of changes) {
    await query('UPDATE npcs SET sex=$1 WHERE id=$2', [c.to, c.npc.id]);
    console.log(`  ✓ ${c.npc.name} → ${c.to}`);
  }
  console.log('\nDone. Now re-run the clothing pass to match:');
  console.log('  node server/models/temp/backfill-npc-clothing.js --reclothe --apply');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
