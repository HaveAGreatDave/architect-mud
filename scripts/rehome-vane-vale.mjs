// Move Cassius Vane and Sergeant Vale out of Embassy Unit 1A — a player (akerson)
// owns it, yet both NPCs were homed there — into two free Embassy units, keeping
// them in the building they already live in. Neither has a work_zone_id, so there's
// no "near work" to optimise for; this just gets them off a player's deed. Registers
// them in npc_residences so the units become un-rentable.
//
// Data-transform on existing rows → the reserved one-shot. Dry-run by default.
//
//   node scripts/rehome-vane-vale.mjs            # local, dry run
//   node scripts/rehome-vane-vale.mjs --apply    # local, write
//   node --env-file=.env.prod scripts/rehome-vane-vale.mjs --apply   # prod
//
import 'dotenv/config';
import { query } from '../server/models/db.js';

const APPLY = process.argv.includes('--apply');
const ASSIGN = [
  { id: 'npc_cash_vane',  name: 'Cassius Vane',  unit: 'zone_apt_5' }, // Embassy Unit 2A
  { id: 'npc_pd_officer', name: 'Sergeant Vale', unit: 'zone_apt_6' }, // Embassy Unit 2B
];

async function main() {
  console.log(`=== rehome-vane-vale (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
  for (const a of ASSIGN) {
    const { rows: z } = await query(`SELECT flags->>'is_apartment' AS apt FROM zones WHERE id=$1`, [a.unit]);
    const { rows: owned } = await query(`SELECT owner_handle FROM apartments WHERE zone_id=$1 AND owner_id IS NOT NULL`, [a.unit]);
    const { rows: occ } = await query(`SELECT npc_id FROM npc_residences WHERE zone_id=$1 AND npc_id<>$2`, [a.unit, a.id]);
    const { rows: n } = await query(`SELECT home_zone FROM npcs WHERE id=$1`, [a.id]);
    const bad = !n.length ? 'npc not found'
      : z[0]?.apt !== 'true' ? 'target not an apartment'
      : owned.length ? `target owned by ${owned[0].owner_handle}`
      : occ.length ? `target already ${occ[0].npc_id}` : null;
    console.log(`  ${a.name.padEnd(14)} ${n[0]?.home_zone ?? '?'} → ${a.unit}  ${bad ? '✗ ' + bad : '✓'}`);
    if (bad) continue;
    if (APPLY) {
      await query(`UPDATE npcs SET home_zone=$1 WHERE id=$2`, [a.unit, a.id]);
      await query(`INSERT INTO npc_residences (zone_id, npc_id) VALUES ($1,$2)
                   ON CONFLICT (zone_id) DO UPDATE SET npc_id=$2`, [a.unit, a.id]);
    }
  }
  console.log(APPLY ? `\n✓ APPLIED. Restart / world reload to pick up.` : `\nRe-run with --apply to write.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
