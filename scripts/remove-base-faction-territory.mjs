// One-shot DATA transformation: pull the base (NPC) factions out of the territory
// system. The seed factions (Custodians, Breakers, Glitch, Franchise, Archivists —
// every `orgs` row with is_npc=1) are becoming standalone ideologies and no longer
// hold or contest `zone_control`. Territory belongs to player corps alone.
//
// This is NOT covered by the additive CODEX deploy (which never touches existing
// rows), so it's a deliberate one-shot per CLAUDE.md.
//
//   node scripts/remove-base-faction-territory.mjs             # local dev DB
//   node --env-file=.env.prod scripts/remove-base-faction-territory.mjs   # prod
//
// Effect:
//   • Any zone an NPC faction *controls* → its zone_control row is deleted, so the
//     zone becomes fully unclaimed and open for a player corp to take.
//   • Any zone an NPC faction is *challenging* (a player-held zone) → the stale
//     challenger is cleared so the contest resolves cleanly.
//
// After running: restart the server (or /world reload) to resync world.zoneControl.
import { query } from '../server/models/db.js';

async function run() {
  const { rows: npcOrgs } = await query('SELECT id, name FROM orgs WHERE is_npc = 1');
  const ids = npcOrgs.map(o => o.id);
  if (!ids.length) {
    console.log('No NPC factions found — nothing to do.');
    return;
  }
  console.log(`NPC factions: ${npcOrgs.map(o => o.name).join(', ')}`);

  const del = await query('DELETE FROM zone_control WHERE org_id = ANY($1)', [ids]);
  console.log(`✓ Deleted ${del.rowCount} zone_control row(s) controlled by base factions.`);

  const cleared = await query(
    'UPDATE zone_control SET challenger_org_id = NULL WHERE challenger_org_id = ANY($1)', [ids]);
  console.log(`✓ Cleared ${cleared.rowCount} stale base-faction challenger(s) on player-held zones.`);

  console.log('\nDone. Restart the server (or /world reload) to resync the zone_control cache.');
}

run().then(() => process.exit(0)).catch(e => { console.error('✗ failed:', e); process.exit(1); });
