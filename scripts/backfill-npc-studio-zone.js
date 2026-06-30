// One-time backfill: populate npcs.studio_zone_id for existing studio-staff NPCs
// from their current dynamic schedule assignment (channel.studio_zone_id via
// media_channel_playlist.conditions.npc_staff). Run once after the schema
// migration that added npcs.studio_zone_id; safe to re-run (idempotent).
import { query } from '../server/models/db.js';

async function main() {
  const { rows: channels } = await query(
    `SELECT id, studio_zone_id FROM media_channels WHERE studio_zone_id IS NOT NULL`
  );
  const studioZoneByChannel = new Map(channels.map(c => [c.id, c.studio_zone_id]));

  const { rows: items } = await query(
    `SELECT channel_id, conditions FROM media_channel_playlist WHERE channel_id = ANY($1)`,
    [[...studioZoneByChannel.keys()]]
  );

  const studioZoneByNpc = new Map();
  for (const item of items) {
    const studioZoneId = studioZoneByChannel.get(item.channel_id);
    if (!studioZoneId) continue;
    let cond = item.conditions;
    if (typeof cond === 'string') { try { cond = JSON.parse(cond); } catch { cond = {}; } }
    const staff = Array.isArray(cond?.npc_staff) ? cond.npc_staff : [];
    for (const npcId of staff) if (npcId) studioZoneByNpc.set(npcId, studioZoneId);
  }

  let updated = 0;
  for (const [npcId, studioZoneId] of studioZoneByNpc) {
    const { rowCount } = await query(
      `UPDATE npcs SET studio_zone_id = $1 WHERE id = $2 AND studio_zone_id IS NULL`,
      [studioZoneId, npcId]
    );
    updated += rowCount;
  }

  console.log(`Backfilled studio_zone_id for ${updated} NPC(s) across ${studioZoneByChannel.size} studio channel(s).`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
