/**
 * Personality- and sex-based clothing backfill.
 *
 * Gives every existing NPC a personality-appropriate outfit for their sex
 * (flags.clothing_layers, an ordered outermost→innermost array of descriptive
 * strings rendered on examine by engine/commands/world.js `npcClothingLine()`;
 * the innermost layer is gendered underwear), EXCEPT:
 *   - Strippers (flags.stripper) — authored clothing kept, always skipped.
 *   - NPCs with no archetype (flags.personality unset) — skipped; their static
 *     description already covers their appearance.
 *   - NPCs whose archetype has no wardrobe defined — skipped.
 *
 * Outfits come from the CLOTHING table in engine/npc-personality.js (a random
 * variant per NPC from the sex-appropriate set), the same source apiCreateNpc uses.
 *
 * By default only clothes NPCs that have NO clothing_layers yet. Pass --reclothe
 * to also re-pick for NPCs that were already auto-clothed (e.g. to apply the
 * sex-aware wardrobe over an earlier unisex pass); strippers are still skipped.
 *
 * Dry-run unless --apply.
 *   node server/models/temp/backfill-npc-clothing.js                       # preview new
 *   node server/models/temp/backfill-npc-clothing.js --reclothe            # preview re-pick
 *   node server/models/temp/backfill-npc-clothing.js --reclothe --apply    # write re-pick
 */
import 'dotenv/config';
import { query } from '../db.js';
import { pickClothingForPersonality } from '../../engine/npc-personality.js';

const APPLY    = process.argv.includes('--apply');
const RECLOTHE = process.argv.includes('--reclothe');

function parseJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return fallback; } }
  return v;
}

async function main() {
  console.log(`=== backfill-npc-clothing (${APPLY ? 'APPLY' : 'DRY RUN'}${RECLOTHE ? ', RECLOTHE' : ''}) ===\n`);

  const { rows: npcs } = await query('SELECT id, name, sex, flags FROM npcs ORDER BY name');

  const assign = [];   // { npc, flags, outfit }
  const skipped = [];  // { npc, reason }

  for (const npc of npcs) {
    const flags = parseJson(npc.flags, {});
    if (flags.stripper) { skipped.push({ npc, reason: 'stripper — authored clothing kept' }); continue; }
    if (!flags.personality) { skipped.push({ npc, reason: 'no personality archetype' }); continue; }
    const outfit = pickClothingForPersonality(flags.personality, npc.sex);
    if (!outfit) { skipped.push({ npc, reason: `no wardrobe for archetype "${flags.personality}"` }); continue; }
    const hasClothes = Array.isArray(flags.clothing_layers) && flags.clothing_layers.length;
    if (hasClothes && !RECLOTHE) { skipped.push({ npc, reason: 'already clothed (use --reclothe to overwrite)' }); continue; }
    assign.push({ npc, flags, outfit, persona: flags.personality, sex: npc.sex || 'male' });
  }

  console.log(`Total NPCs: ${npcs.length}`);
  console.log(`  → will clothe: ${assign.length}    → skip: ${skipped.length}\n`);

  console.log('── PROPOSED OUTFITS ───────────────────────────────────────');
  for (const a of assign) {
    console.log(`  ${(a.sex||'?').padEnd(7)} ${a.persona.padEnd(18)} ${(a.npc.name||'').padEnd(20)} → ${a.outfit.join(' / ')}`);
  }

  console.log('\n── SKIPPED ────────────────────────────────────────────────');
  for (const s of skipped) {
    console.log(`  ${(s.npc.name||'').padEnd(24)} — ${s.reason}`);
  }

  if (!APPLY) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`\nDry run. Re-run with --apply${RECLOTHE ? ' --reclothe' : ''} to clothe the ${assign.length} NPC(s).`);
    process.exit(0);
  }

  console.log(`\nApplying ${assign.length} outfit(s)...\n`);
  let changed = 0;
  for (const a of assign) {
    a.flags.clothing_layers = a.outfit; // preserve every other flag
    await query('UPDATE npcs SET flags=$1 WHERE id=$2', [JSON.stringify(a.flags), a.npc.id]);
    console.log(`  ✓ ${a.npc.name} (${a.sex}) → ${a.outfit[0]}`);
    changed++;
  }
  console.log(`\n${changed} NPC(s) clothed. Trigger a world reload / restart to see them.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
