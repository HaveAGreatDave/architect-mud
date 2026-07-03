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
import { query, withTransaction } from '../models/db.js';
import { getFactionDiscount } from './factions.js';
import { adjustCredits } from './economy.js';
import { randomUUID } from 'crypto';
import { isStackable } from './tags.js';
import { isConsumerFurniture } from './furniture-shop.js';
import { getFlag, setFlag } from './flags.js';
import { emit } from './events.js';
import { vendorGrudgeRemaining, grudgeRefusal } from './vendor-grudge.js';

// Trust-gated vendors (e.g. the covert shadow dealer). When an NPC's flags carry
// a `trust_flag`, its shelf is not the random `vendor_stock` shelf but the full
// `vendor_inventory` catalogue, per-player-filtered by each entry's `min_trust`
// against that player's trust flag. Buying raises the flag (`trust_per_buy`),
// unlocking higher tiers. Reaching `trust_max` sets an optional payoff flag.
async function readTrust(npc, playerId) {
  const flagKey = npc.flags?.trust_flag;
  if (!flagKey) return null;
  return Number(await getFlag('player', flagKey, { id: playerId })) || 0;
}

// ─── Stock display ───────────────────────────────────────────────────────────

export async function getVendorStock(npc, playerId) {
  const catalogue = npc.vendor_inventory || [];
  const activeStock = npc.vendor_stock || [];
  if (!catalogue.length) return [];

  const trust = await readTrust(npc, playerId);
  // Trust vendor → shelf is the whole catalogue, gated per-entry by min_trust.
  // Normal vendor → shelf is the auto-managed random subset.
  const shelf = trust !== null
    ? catalogue.filter(e => (e.min_trust || 0) <= trust)
    : activeStock;
  if (!shelf.length) return [];

  const discount = npc.faction ? await getFactionDiscount(playerId, npc.faction) : 0;

  // Price lookup from catalogue
  const priceMap = {};
  for (const e of catalogue) priceMap[e.item_id] = e.price;

  const stock = [];
  for (const entry of shelf) {
    const { rows } = await query('SELECT * FROM items WHERE id = $1', [entry.item_id]);
    if (!rows.length) continue;
    const item = rows[0];
    // Vendors only sell furniture you can actually use (sit/lean/lie/watch);
    // non-consumer furniture (infrastructure) is ignored on the shelf.
    if (item.type === 'furniture' && !isConsumerFurniture(item)) continue;
    const basePrice = priceMap[entry.item_id] ?? item.value;
    const finalPrice = Math.max(1, Math.round(basePrice * (1 - discount)));
    stock.push({
      item_id: entry.item_id,
      name: item.name,
      description: item.tags?.description ?? item.description ?? '',
      type: item.type,
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
  const grudge = await vendorGrudgeRemaining(player.id, npc.id);
  if (grudge > 0) return { success: false, message: grudgeRefusal(npc, grudge) };

  const catalogue = npc.vendor_inventory || [];
  const activeStock = npc.vendor_stock || [];

  if (!catalogue.length) return { success: false, message: 'This NPC has nothing to sell.' };
  const catalogueEntry = catalogue.find(e => e.item_id === itemId);

  const trust = await readTrust(npc, player.id);
  if (trust !== null) {
    // Trust vendor: buyable if the catalogue entry is within the player's trust tier.
    if (!catalogueEntry || (catalogueEntry.min_trust || 0) > trust) {
      return { success: false, message: "They don't have that for you. Not yet." };
    }
  } else if (!activeStock.find(e => e.item_id === itemId)) {
    return { success: false, message: "That item isn't on the shelf right now. Come back later." };
  }

  const { rows: itemRows } = await query('SELECT * FROM items WHERE id = $1', [itemId]);
  if (!itemRows.length) return { success: false, message: 'Item not found.' };
  const item = itemRows[0];

  const discount = npc.faction ? await getFactionDiscount(player.id, npc.faction) : 0;
  const basePrice = catalogueEntry?.price ?? item.value;
  const price = Math.max(1, Math.round(basePrice * (1 - discount))) * quantity;

  // Debit, deliver the item, and pay the vendor safe as one atomic unit so a
  // failure between steps can't take credits without handing over the goods.
  const paid = await withTransaction(async (q) => {
    if (!await adjustCredits(player, -price, q)) return false;

    const { rows: existing } = await q(
      'SELECT id, quantity FROM player_inventory WHERE player_id = $1 AND item_id = $2 AND is_equipped = 0',
      [player.id, itemId]
    );
    if (existing.length && isStackable(item)) {
      await q('UPDATE player_inventory SET quantity = quantity + $1 WHERE id = $2', [quantity, existing[0].id]);
    } else {
      await q(
        'INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1, $2, $3, $4, 1.0)',
        [randomUUID(), player.id, itemId, quantity]
      );
    }

    // Accumulate credits in vendor's safe
    await q('UPDATE npcs SET vendor_credits = vendor_credits + $1 WHERE id = $2', [price, npc.id]);
    return true;
  });

  if (!paid) {
    return { success: false, message: `You can't afford that. Need ${price} credits, have ${player.credits || 0}.` };
  }

  // Trust vendor: each purchase earns trust, unlocking higher tiers. Reaching
  // the cap sets an optional payoff flag (a hook for future content / the "lead").
  let trustLine = '';
  if (trust !== null) {
    const cap = npc.flags?.trust_max ?? 100;
    const gain = (npc.flags?.trust_per_buy ?? 5) * quantity;
    const newTrust = Math.min(cap, trust + gain);
    if (newTrust !== trust) {
      await setFlag('player', npc.flags.trust_flag, String(newTrust), player);
      if (newTrust >= cap && npc.flags?.inner_circle_flag && !(await getFlag('player', npc.flags.inner_circle_flag, player))) {
        await setFlag('player', npc.flags.inner_circle_flag, 'true', player);
        trustLine = `\n<span class="msg-system">The figure holds your gaze a moment longer than usual. "You're solid. Anything I've got, you can have. And I might have work for someone like you."</span>`;
      }
    }
  }

  // A conspicuous spend is street news.
  if (price >= 500) emit('gossip.bigBuy', { player: { id: player.id, handle: player.handle }, itemName: item.name, price, zoneId: player.current_zone });

  return {
    success: true,
    message: `You buy ${quantity}x ${item.name} for ${price} credits. (${player.credits} remaining)${trustLine}`,
    credits_remaining: player.credits,
  };
}

// ─── Sell ────────────────────────────────────────────────────────────────────

// Per-unit sell payout: 40% of item value, boosted by the seller's Cool stat
// (+5% per point) and adjusted by faction reputation with the vendor — the same
// discount buy applies, but here friendly rep pays *more* (1+discount) and hostile
// rep pays less. Floored at 1. Single source of truth for the sell price so the
// panel preview and the actual sale can't drift.
export function computeSellUnitPrice(value, statCool, discount = 0) {
  const coolMult = 1 + (statCool || 0) * 0.05;
  return Math.max(1, Math.floor((value || 0) * 0.4 * coolMult * (1 + discount)));
}

// List the player's sellable items (excludes equipped + quest items), each with the
// sell price this vendor would pay. Drives the GUI shop's Sell tab.
export async function getSellableInventory(player, npc) {
  const { rows } = await query(
    `SELECT pi.id, pi.quantity, i.name, i.value, i.tags, p.stat_cool
     FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id
     JOIN players p ON p.id = pi.player_id
     WHERE pi.player_id = $1 AND pi.is_equipped = 0`,
    [player.id]
  );
  const discount = npc.faction ? await getFactionDiscount(player.id, npc.faction) : 0;
  return rows
    .filter(r => !r.tags?.quest_item)
    .map(r => ({
      inventory_id: r.id,
      name: r.name,
      quantity: r.quantity,
      price: computeSellUnitPrice(r.value, r.stat_cool, discount),
    }));
}

export async function sellToVendor(player, npc, inventoryId, quantity = 1) {
  const grudge = await vendorGrudgeRemaining(player.id, npc.id);
  if (grudge > 0) return { success: false, message: grudgeRefusal(npc, grudge) };

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
  const discount = npc.faction ? await getFactionDiscount(player.id, npc.faction) : 0;
  const sellPrice = computeSellUnitPrice(invItem.value, invItem.stat_cool, discount) * sellQty;

  // Pay out and remove the sold item together, so a crash can't credit the
  // player while leaving the item in their inventory (or vice versa).
  await withTransaction(async (q) => {
    await adjustCredits(player, sellPrice, q);
    if (invItem.quantity <= sellQty) {
      await q('DELETE FROM player_inventory WHERE id = $1', [inventoryId]);
    } else {
      await q('UPDATE player_inventory SET quantity = quantity - $1 WHERE id = $2', [sellQty, inventoryId]);
    }
  });

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
