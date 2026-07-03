import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { query } from '../../server/models/db.js';
import { getLivePlayer, getAllLivePlayers } from '../../server/engine/world.js';

const OUTFIT_FILE = join(dirname(fileURLToPath(import.meta.url)), 'cyd-outfit.json');

// Hardcoded fallback — used when cyd-outfit.json doesn't exist yet.
const CYD_OUTFIT_DEFAULT = [
  { itemId: 'item_cat_boxers',               slot: 'legs',      layer: 1 },
  { itemId: 'item_reaper_tshirt',            slot: 'torso',     layer: 2 },
  { itemId: 'item_cyber_track_pants',        slot: 'legs',      layer: 2 },
  { itemId: 'item_insulated_gloves',         slot: 'hands',     layer: 2 },
  { itemId: 'item_gold_chain',               slot: 'accessory', layer: 2 },
  { itemId: 'item_finger_rings_set',         slot: 'accessory', layer: 2 },
  { itemId: 'item_onyx_malachite_bracelets', slot: 'accessory', layer: 2 },
  { itemId: 'item_cobalt_scarf',             slot: 'accessory', layer: 3 },
];

function loadOutfit() {
  try { return JSON.parse(readFileSync(OUTFIT_FILE, 'utf8')); } catch { return CYD_OUTFIT_DEFAULT; }
}

async function resolveCydId() {
  const online = getAllLivePlayers().find(p => p.handle.toLowerCase() === 'cyd');
  if (online) return online.id;
  const { rows } = await query(`SELECT id FROM players WHERE LOWER(handle)='cyd' LIMIT 1`);
  if (!rows.length) return null;
  return rows[0].id;
}

async function cmdDressCyd(args, raw, player) {
  if (!['admin', 'dev'].includes(player.role)) {
    return { type: 'error', message: 'Unknown command: ".dresscyd".' };
  }

  if (args[0] === 'save') {
    // Snapshot Cyd's current equipped items to disk.
    const cydId = await resolveCydId();
    if (!cydId) return { type: 'error', message: 'Player "cyd" not found.' };

    const { rows } = await query(
      `SELECT pi.item_id AS "itemId", pi.slot, pi.layer
       FROM player_inventory pi
       WHERE pi.player_id = $1 AND pi.is_equipped = 1
       ORDER BY pi.layer, pi.slot`,
      [cydId]
    );
    if (!rows.length) return { type: 'error', message: 'Cyd has no equipped items to save.' };

    writeFileSync(OUTFIT_FILE, JSON.stringify(rows, null, 2));
    return { type: 'output', message: `Outfit saved — ${rows.length} equipped items recorded.` };
  }

  // Apply outfit.
  const outfit = loadOutfit();
  const cydId = await resolveCydId();
  if (!cydId) return { type: 'error', message: 'Player "cyd" not found.' };

  const itemIds = outfit.map(e => e.itemId);
  const { rows: found } = await query(`SELECT id FROM items WHERE id = ANY($1)`, [itemIds]);
  const missing = itemIds.filter(id => !found.some(r => r.id === id));
  if (missing.length) {
    return { type: 'error', message: `Missing items in DB: ${missing.join(', ')}` };
  }

  await query(`DELETE FROM player_inventory WHERE player_id=$1 AND item_id = ANY($2)`, [cydId, itemIds]);

  for (const { itemId, slot, layer } of outfit) {
    await query(
      `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, is_equipped, slot, layer)
       VALUES ($1, $2, $3, 1, 1.0, 1, $4, $5)`,
      [randomUUID(), cydId, itemId, slot, layer]
    );
  }

  return { type: 'output', message: `Cyd is dressed. ${outfit.length} items equipped.` };
}

export const commands = {
  // NB: register the BARE verb — the dispatcher strips a leading `.`/`/` before
  // matching, so a `.dresscyd` key would never fire.
  dresscyd: cmdDressCyd,
};
