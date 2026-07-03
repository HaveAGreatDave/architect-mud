// Wire the existing Cherry Pit dancers + VIP room to the strippers plugin.
//
//  1. Each dancer gets flags.stripper, an ordered flags.clothing_layers outfit
//     (outermost → innermost, peeled by tips), and flags.mis_requires_zone_flag
//     = 'mis_ok' (so MIS is refused on the floor, allowed only in VIP).
//  2. The VIP room gets flags.mis_ok = true.
//  3. A locked viplock door is placed on the floor → VIP edge (north). The pass
//     earned by tipping 1000 is the only key; leaving VIP (south) stays free.
//
// Idempotent: flag merges are additive; the door upserts. Content-only — after
// running, hit /world/reload or restart the server so the world picks it up
// (the new strippers plugin needs a restart anyway).
import { query } from '../server/models/db.js';

const DANCERS = {
  npc_1783019600726: ['a sequined slip dress', 'a lace bralette', 'a satin thong'],        // Vesper Cole
  npc_1783019600618: ['a vinyl trench coat', 'a chrome-studded bra', 'a red lace thong'],  // Ruby Six
  npc_1783019600509: ['an oversized bomber jacket', 'a mesh crop top', 'a black g-string'],// Jinx Delacroix
};

for (const [id, layers] of Object.entries(DANCERS)) {
  const { rows } = await query('SELECT name, flags FROM npcs WHERE id=$1', [id]);
  if (!rows.length) { console.log(`SKIP  ${id}: not found`); continue; }
  const flags = { ...(rows[0].flags || {}), stripper: true, clothing_layers: layers, mis_requires_zone_flag: 'mis_ok' };
  await query('UPDATE npcs SET flags=$1 WHERE id=$2', [JSON.stringify(flags), id]);
  console.log(`WIRE  ${rows[0].name} (${id}) → ${layers.length} layers, stripper+vip-gated`);
}

// VIP room: MIS permitted here (main floor is not, so dancers refuse there).
{
  const { rows } = await query(`SELECT flags FROM zones WHERE id='zone_mq_cherry_vip'`);
  if (rows.length) {
    const flags = { ...(rows[0].flags || {}), mis_ok: true };
    await query(`UPDATE zones SET flags=$1 WHERE id='zone_mq_cherry_vip'`, [JSON.stringify(flags)]);
    console.log(`ZONE  zone_mq_cherry_vip → mis_ok:true`);
  } else console.log('SKIP  zone_mq_cherry_vip: not found');
}

// Locked VIP door on the floor's north edge (→ zone_mq_cherry_vip).
{
  const tags = {
    'lock:viplock': {
      messages: {
        lock:   'The red light over the door steadies. VIP is sealed.',
        unlock: 'The red light blinks to green. The VIP door releases.',
        denied: 'The bouncer plants a hand on your chest. "VIP only. Tip your way in."',
      },
    },
  };
  await query(
    `INSERT INTO doors (id, zone_id, exit_dir, door_type, is_open, hp, hp_max, lock_state, target_zone, tags, name, flags)
       VALUES ('door_cherry_vip','zone_mq_cherry_floor','north','basic',0,1000,1000,'locked','zone_mq_cherry_vip',$1,'The VIP Door','{}')
     ON CONFLICT (id) DO UPDATE SET
       zone_id=EXCLUDED.zone_id, exit_dir=EXCLUDED.exit_dir, lock_state='locked',
       target_zone=EXCLUDED.target_zone, tags=EXCLUDED.tags, name=EXCLUDED.name`,
    [JSON.stringify(tags)]);
  console.log(`DOOR  door_cherry_vip on zone_mq_cherry_floor 'north' → zone_mq_cherry_vip (locked, viplock)`);
}

console.log('\nDone.');
process.exit(0);
