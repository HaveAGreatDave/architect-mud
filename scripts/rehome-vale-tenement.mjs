// Move Sergeant Vale into The Yards Tenement with every other apartment-homed NPC.
// She was left behind by house-npcs-in-tenement.mjs because the (now deleted)
// vale-apology plugin was going to walk her out of Embassy Unit 1A in a scripted
// scene. With the plugin gone she'd stand in a player's (akerson's) apartment
// forever, so this moves her body as well as her deed.
//
// `npcs.zone_id` is runtime state (excluded from the content dump), so the content
// files can't carry it — hence the one-shot. Dry-run by default.
//
//   node scripts/rehome-vale-tenement.mjs            # local, dry run
//   node scripts/rehome-vale-tenement.mjs --apply    # local, write
//   node --env-file=.env.prod scripts/rehome-vale-tenement.mjs --apply   # prod
//
import 'dotenv/config';
import { query } from '../server/models/db.js';

const APPLY = process.argv.includes('--apply');
const ID   = 'npc_pd_officer';
const UNIT = 'zone_yards_tenement_u6_1';   // 1 resident (npc_yardmaster) → 2, within the density rule

async function main() {
  console.log(`=== rehome-vale-tenement (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
  const { rows: n } = await query(`SELECT zone_id, home_zone FROM npcs WHERE id=$1`, [ID]);
  if (!n.length) { console.log('  ✗ npc not found'); process.exit(1); }
  console.log(`  home_zone  ${n[0].home_zone} → ${UNIT}`);
  console.log(`  zone_id    ${n[0].zone_id} → ${UNIT}`);
  if (APPLY) {
    await query(`UPDATE npcs SET home_zone=$1, zone_id=$1 WHERE id=$2`, [UNIT, ID]);
    await query(`DELETE FROM npc_residences WHERE npc_id=$1 AND zone_id<>$2`, [ID, UNIT]);
  }
  console.log(APPLY ? `\n✓ APPLIED. Restart / world reload to pick up.` : `\nRe-run with --apply to write.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
