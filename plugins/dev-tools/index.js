import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getLivePlayer, getAllLivePlayers } from '../../server/engine/world.js';

// Items to give and equip on Cyd, in order (underwear first so layers stack correctly).
const CYD_OUTFIT = [
  { itemId: 'item_cat_boxers',              slot: 'legs',      layer: 1 },
  { itemId: 'item_reaper_tshirt',           slot: 'torso',     layer: 2 },
  { itemId: 'item_cyber_track_pants',       slot: 'legs',      layer: 2 },
  { itemId: 'item_gold_chain',              slot: 'accessory', layer: 2 },
  { itemId: 'item_onyx_malachite_bracelets',slot: 'accessory', layer: 2 },
  { itemId: 'item_cobalt_scarf',            slot: 'accessory', layer: 3 },
];

async function cmdDressCyd(args, raw, player) {
  if (!['admin', 'dev'].includes(player.role)) {
    return { type: 'error', message: 'Unknown command: ".dresscyd".' };
  }

  // Find Cyd — online first, fall back to DB for the player ID.
  let cydId;
  const online = getAllLivePlayers().find(p => p.handle.toLowerCase() === 'cyd');
  if (online) {
    cydId = online.id;
  } else {
    const { rows } = await query(`SELECT id FROM players WHERE LOWER(handle)='cyd' LIMIT 1`);
    if (!rows.length) return { type: 'error', message: 'Player "cyd" not found.' };
    cydId = rows[0].id;
  }

  // Verify every item exists in the items table.
  const itemIds = CYD_OUTFIT.map(e => e.itemId);
  const { rows: found } = await query(
    `SELECT id FROM items WHERE id = ANY($1)`,
    [itemIds]
  );
  const missing = itemIds.filter(id => !found.some(r => r.id === id));
  if (missing.length) {
    return { type: 'error', message: `Missing items in DB: ${missing.join(', ')}` };
  }

  // Unequip and delete any existing copies of these items from Cyd's inventory.
  await query(
    `DELETE FROM player_inventory WHERE player_id=$1 AND item_id = ANY($2)`,
    [cydId, itemIds]
  );

  // Insert each item as equipped.
  for (const { itemId, slot, layer } of CYD_OUTFIT) {
    await query(
      `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, is_equipped, slot, layer)
       VALUES ($1, $2, $3, 1, 1.0, 1, $4, $5)`,
      [randomUUID(), cydId, itemId, slot, layer]
    );
  }

  return { type: 'output', message: `Cyd is dressed. ${CYD_OUTFIT.length} items equipped.` };
}

export const commands = {
  '.dresscyd': cmdDressCyd,
};
