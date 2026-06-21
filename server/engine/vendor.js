/**
 * Vendor / shop system — buy and sell items from NPCs.
 */
import { query } from '../models/db.js';
import { getFactionDiscount } from './factions.js';
import { randomUUID } from 'crypto';

export async function getVendorStock(npc, playerId) {
  if (!npc.vendor_inventory?.length) return [];

  const discount = npc.faction
    ? await getFactionDiscount(playerId, npc.faction)
    : 0;

  const stock = [];
  for (const entry of npc.vendor_inventory) {
    const { rows } = await query('SELECT * FROM items WHERE id = $1', [entry.item_id]);
    if (!rows.length) continue;
    const item = rows[0];
    const basePrice = entry.price || item.value;
    const finalPrice = Math.max(1, Math.round(basePrice * (1 - discount)));
    stock.push({
      item_id: entry.item_id,
      name: item.name,
      description: item.tags?.description ?? item.description ?? '',
      type: item.type,
      rarity: item.rarity,
      stock: entry.stock ?? 99,
      price: finalPrice,
      base_price: basePrice,
      discounted: discount > 0,
    });
  }
  return stock;
}

export async function buyFromVendor(player, npc, itemId, quantity = 1) {
  if (!npc.vendor_inventory?.length) return { success: false, message: 'This NPC has nothing to sell.' };

  const entry = npc.vendor_inventory.find(e => e.item_id === itemId);
  if (!entry) return { success: false, message: 'That item isn\'t available here.' };

  const { rows: itemRows } = await query('SELECT * FROM items WHERE id = $1', [itemId]);
  if (!itemRows.length) return { success: false, message: 'Item not found.' };
  const item = itemRows[0];

  const discount = npc.faction ? await getFactionDiscount(player.id, npc.faction) : 0;
  const price = Math.max(1, Math.round((entry.price || item.value) * (1 - discount))) * quantity;

  if ((player.credits || 0) < price) {
    return { success: false, message: `You can't afford that. Need ${price} credits, have ${player.credits || 0}.` };
  }

  // Deduct credits
  player.credits = (player.credits || 0) - price;
  await query('UPDATE players SET credits = $1 WHERE id = $2', [player.credits, player.id]);

  // Add item to inventory
  const { rows: existing } = await query(
    'SELECT id, quantity FROM player_inventory WHERE player_id = $1 AND item_id = $2 AND is_equipped = 0',
    [player.id, itemId]
  );

  if (existing.length && item.tags?.stackable) {
    await query('UPDATE player_inventory SET quantity = quantity + $1 WHERE id = $2', [quantity, existing[0].id]);
  } else {
    await query(
      'INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1, $2, $3, $4, 1.0)',
      [randomUUID(), player.id, itemId, quantity]
    );
  }

  return {
    success: true,
    message: `You buy ${quantity}x ${item.name} for ${price} credits. (${player.credits} remaining)`,
    credits_remaining: player.credits,
  };
}

export async function sellToVendor(player, npc, inventoryId, quantity = 1) {
  const { rows } = await query(
    `SELECT pi.*, i.name, i.value, i.tags FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id
     WHERE pi.id = $1 AND pi.player_id = $2`,
    [inventoryId, player.id]
  );

  if (!rows.length) return { success: false, message: 'Item not found in your inventory.' };
  const invItem = rows[0];

  if (invItem.tags?.quest_item) return { success: false, message: 'You can\'t sell quest items.' };
  if (invItem.is_equipped) return { success: false, message: 'Unequip it first.' };

  const sellQty = Math.min(quantity, invItem.quantity);
  const sellPrice = Math.max(1, Math.floor(invItem.value * 0.4)) * sellQty; // 40% of value

  player.credits = (player.credits || 0) + sellPrice;
  await query('UPDATE players SET credits = $1 WHERE id = $2', [player.credits, player.id]);

  if (invItem.quantity <= sellQty) {
    await query('DELETE FROM player_inventory WHERE id = $1', [inventoryId]);
  } else {
    await query('UPDATE player_inventory SET quantity = quantity - $1 WHERE id = $2', [sellQty, inventoryId]);
  }

  return {
    success: true,
    message: `You sell ${sellQty}x ${invItem.name} for ${sellPrice} credits. (${player.credits} total)`,
    credits: player.credits,
  };
}
