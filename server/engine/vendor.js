/**
 * Vendor / shop system.
 *
 * Data model:
 *   npc.vendor_inventory  = catalogue [{item_id, price?}]  — full list; managed in dev panel
 *   npc.vendor_stock      = active shelf [{item_id}]       — subset currently for sale; auto-managed
 *   npc.vendor_stock_size = max shelf size (default 10)
 *   npc.vendor_restock_rate = items added per 24 h tick (default 1)
 *   npc.vendor_credits    = credits earned from sales; physically held in the zone's vendor safe
 */
import { query } from '../models/db.js';
import { getFactionDiscount } from './factions.js';
import { adjustCredits } from './economy.js';
import { randomUUID } from 'crypto';
import { isStackable } from './tags.js';

// ─── Stock display ───────────────────────────────────────────────────────────

export async function getVendorStock(npc, playerId) {
  const catalogue = npc.vendor_inventory || [];
  const activeStock = npc.vendor_stock || [];
  if (!catalogue.length || !activeStock.length) return [];

  const discount = npc.faction ? await getFactionDiscount(playerId, npc.faction) : 0;

  // Price lookup from catalogue
  const priceMap = {};
  for (const e of catalogue) priceMap[e.item_id] = e.price;

  const stock = [];
  for (const entry of activeStock) {
    const { rows } = await query('SELECT * FROM items WHERE id = $1', [entry.item_id]);
    if (!rows.length) continue;
    const item = rows[0];
    const basePrice = priceMap[entry.item_id] ?? item.value;
    const finalPrice = Math.max(1, Math.round(basePrice * (1 - discount)));
    stock.push({
      item_id: entry.item_id,
      name: item.name,
      description: item.tags?.description ?? item.description ?? '',
      type: item.type,
      rarity: item.rarity,
      stock: 99,
      price: finalPrice,
      base_price: basePrice,
      discounted: discount > 0,
    });
  }
  return stock;
}

// ─── Buy ─────────────────────────────────────────────────────────────────────

export async function buyFromVendor(player, npc, itemId, quantity = 1) {
  const catalogue = npc.vendor_inventory || [];
  const activeStock = npc.vendor_stock || [];

  if (!catalogue.length) return { success: false, message: 'This NPC has nothing to sell.' };
  if (!activeStock.find(e => e.item_id === itemId)) {
    return { success: false, message: "That item isn't on the shelf right now. Come back later." };
  }

  const catalogueEntry = catalogue.find(e => e.item_id === itemId);
  const { rows: itemRows } = await query('SELECT * FROM items WHERE id = $1', [itemId]);
  if (!itemRows.length) return { success: false, message: 'Item not found.' };
  const item = itemRows[0];

  const discount = npc.faction ? await getFactionDiscount(player.id, npc.faction) : 0;
  const basePrice = catalogueEntry?.price ?? item.value;
  const price = Math.max(1, Math.round(basePrice * (1 - discount))) * quantity;

  if (!await adjustCredits(player, -price)) {
    return { success: false, message: `You can't afford that. Need ${price} credits, have ${player.credits || 0}.` };
  }

  const { rows: existing } = await query(
    'SELECT id, quantity FROM player_inventory WHERE player_id = $1 AND item_id = $2 AND is_equipped = 0',
    [player.id, itemId]
  );
  if (existing.length && isStackable(item)) {
    await query('UPDATE player_inventory SET quantity = quantity + $1 WHERE id = $2', [quantity, existing[0].id]);
  } else {
    await query(
      'INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1, $2, $3, $4, 1.0)',
      [randomUUID(), player.id, itemId, quantity]
    );
  }

  // Accumulate credits in vendor's safe
  await query('UPDATE npcs SET vendor_credits = vendor_credits + $1 WHERE id = $2', [price, npc.id]);

  return {
    success: true,
    message: `You buy ${quantity}x ${item.name} for ${price} credits. (${player.credits} remaining)`,
    credits_remaining: player.credits,
  };
}

// ─── Sell ────────────────────────────────────────────────────────────────────

export async function sellToVendor(player, npc, inventoryId, quantity = 1) {
  const { rows } = await query(
    `SELECT pi.*, i.name, i.value, i.tags, p.stat_cool FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id
     JOIN players p ON p.id = pi.player_id
     WHERE pi.id = $1 AND pi.player_id = $2`,
    [inventoryId, player.id]
  );

  if (!rows.length) return { success: false, message: 'Item not found in your inventory.' };
  const invItem = rows[0];

  if (invItem.tags?.quest_item) return { success: false, message: "You can't sell quest items." };
  if (invItem.is_equipped) return { success: false, message: 'Unequip it first.' };

  const sellQty = Math.min(quantity, invItem.quantity);
  const coolMult = 1 + (invItem.stat_cool || 0) * 0.05;
  const sellPrice = Math.max(1, Math.floor(invItem.value * 0.4 * coolMult)) * sellQty;

  await adjustCredits(player, sellPrice);

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

// ─── Restock ─────────────────────────────────────────────────────────────────

/**
 * Add up to vendor_restock_rate random items from the catalogue
 * that aren't already on the active shelf, without exceeding vendor_stock_size.
 * Also prunes stock items that have been removed from the catalogue.
 */
export async function restockVendor(npc) {
  const catalogue = npc.vendor_inventory || [];
  if (!catalogue.length) return;

  const stockSize = npc.vendor_stock_size ?? 10;
  const rate = npc.vendor_restock_rate ?? 1;
  const activeStock = [...(npc.vendor_stock || [])];

  // Drop shelf items no longer in catalogue
  const catalogueIds = new Set(catalogue.map(e => e.item_id));
  const cleanedStock = activeStock.filter(e => catalogueIds.has(e.item_id));

  // Items in catalogue not on shelf
  const stockIds = new Set(cleanedStock.map(e => e.item_id));
  const unstocked = catalogue.filter(e => !stockIds.has(e.item_id));

  const slots = stockSize - cleanedStock.length;
  let newStock = cleanedStock;

  if (slots > 0 && unstocked.length) {
    const additions = unstocked
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(rate, slots))
      .map(e => ({ item_id: e.item_id }));
    newStock = [...cleanedStock, ...additions];
  }

  await query('UPDATE npcs SET vendor_stock=$1 WHERE id=$2', [JSON.stringify(newStock), npc.id]);
}

/**
 * Run restockVendor for every NPC that has a non-empty vendor_inventory.
 * Called by dailyMaintenance() every 24 h.
 */
export async function restockAllVendors() {
  const { rows: vendors } = await query(
    `SELECT id, vendor_inventory, vendor_stock, vendor_stock_size, vendor_restock_rate
     FROM npcs WHERE jsonb_array_length(vendor_inventory) > 0`
  );
  for (const npc of vendors) {
    await restockVendor(npc).catch(err =>
      console.error(`[vendor] Restock failed for ${npc.id}:`, err.message)
    );
  }
  if (vendors.length) console.log(`[vendor] Restocked ${vendors.length} vendor(s)`);
}
