// Vending plugin regression — seeds a throwaway dispenser + item and drives the
// real `vend` verb end-to-end (routing, dispense, inventory write, cooldown).
import { query } from '../../server/models/db.js';
import { reloadItem, deleteItemCache } from '../../server/engine/items-cache.js';
import { insertFurniture, updateFurniture, deleteFurniture } from '../../server/engine/world.js';

export default async function regress({ run, check, getPlayer }) {
  const player = getPlayer();
  const saved = player.current_zone;
  const Z = 'zone_vend_regress';
  const ITEM = 'item_vend_regress';
  const FURN = 'furn_vend_regress';

  try {
    // No dispenser in the room → clean error, no throw.
    player.current_zone = 'zone_vend_regress_empty';
    let r = await run('vend');
    check('vend with no dispenser errors cleanly', r?.type === 'error', JSON.stringify(r));

    // Seed a machine (cooldown off) + a stackable item. `description` is NOT NULL
    // on both tables, so it must be supplied.
    await query(
      `INSERT INTO items (id,name,description,type,value,weight,tags) VALUES ($1,'test slop','test slop','consumable',1,10,$2)
       ON CONFLICT (id) DO UPDATE SET tags=$2`,
      [ITEM, JSON.stringify({ consumable: true, stackable: true, restore_hunger: 5 })]
    );
    await reloadItem(ITEM);
    await insertFurniture({
      id: FURN, name: 'test dispenser', description: 'a test dispenser', object_type: 'fixture',
      zone_id: Z, flags: JSON.stringify({ vends: ITEM, vend_cooldown_s: 0 }),
    }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id');
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, ITEM]);

    player.current_zone = Z;
    r = await run('vend');
    check('vend dispenses from the machine', r?.type === 'output', JSON.stringify(r)?.slice(0, 160));
    let inv = await query('SELECT quantity FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, ITEM]);
    check('vend adds the item to inventory', Number(inv.rows[0]?.quantity) === 1, JSON.stringify(inv.rows));

    // Cooldown off → a second vend stacks it (merges, not a new row).
    r = await run('vend');
    inv = await query('SELECT COUNT(*)::int AS rows, COALESCE(SUM(quantity),0)::int AS qty FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, ITEM]);
    check('a second vend stacks the item (one row, qty 2)', inv.rows[0]?.rows === 1 && inv.rows[0]?.qty === 2, JSON.stringify(inv.rows));

    // Cooldown honoured when set.
    await updateFurniture(FURN, { flags: JSON.stringify({ vends: ITEM, vend_cooldown_s: 999 }) });
    await run('vend'); // arms cooldown
    r = await run('vend');
    check('vend respects the cooldown', r?.type === 'error', JSON.stringify(r)?.slice(0, 120));
  } finally {
    // Always restore state + clean up, even if an assertion above threw, so a
    // failure here can't strand the fake player in a nonexistent zone.
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, ITEM]).catch(() => {});
    await deleteFurniture(FURN).catch(() => {});
    await query('DELETE FROM items WHERE id=$1', [ITEM]).catch(() => {});
    deleteItemCache(ITEM);
    player.current_zone = saved;
  }
}
