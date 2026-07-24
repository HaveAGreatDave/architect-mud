/**
 * Vendor / shop system.
 *
 * Data model:
 *   npc.vendor_inventory  = catalogue [{item_id, price?}]  — full list; managed in dev panel
 *   npc.vendor_stock      = active shelf [{item_id}]       — subset currently for sale; auto-managed
 *   npc.vendor_stock_size = max shelf size (default 10)
 *   npc.vendor_restock_rate = items added per 24 h tick (default 1)
 *   npc.vendor_credits    = credits earned from sales; physically held in the zone's vendor safe
 *
 * Sourced entries (physical stock, not the abstract shelf): a catalogue entry
 * may carry `sourceContainer` (a furniture id, e.g. a cold-storage unit) and
 * `restockToQty` (the delivery target). Such an entry always shows on the
 * shelf (real scarcity replaces the vendor_stock rotation) and buying it MOVES
 * a real player_inventory row out of that container instead of inserting a
 * fresh one — so a unit that's been sitting in the fridge keeps its own
 * freshness/cooked state right through the sale. Restocked by
 * restockSourcedContainers(), run alongside the normal 24h restock tick.
 */
import { query, withTransaction } from '../models/db.js';
import { getIdeologyDiscount } from './ideologies.js';
import { adjustCredits } from './economy.js';
import { randomUUID } from 'crypto';
import { isStackable } from './tags.js';
import { isConsumerFurniture } from './furniture-shop.js';
import { getFlag, setFlag } from './flags.js';
import { emit } from './events.js';
import { vendorGrudgeRemaining, grudgeRefusal } from './vendor-grudge.js';
import { markSessionPurchase } from './vendor-session.js';
import { vendorBuyReaction } from './vendor-reactions.js';
import { isVendorClosed, vendorClosedLine } from './ai-behaviour.js';
import { getItem } from './items-cache.js';
import { syncNpc, updateNpc } from './world.js';

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
  // Normal vendor → the auto-managed random subset, PLUS any sourced entries
  // (physical stock bypasses the abstract shelf-rotation gate entirely).
  const sourced = catalogue.filter(e => e.sourceContainer);
  const shelf = trust !== null
    ? catalogue.filter(e => (e.min_trust || 0) <= trust)
    : [...activeStock, ...sourced.filter(e => !activeStock.some(a => a.item_id === e.item_id))];
  if (!shelf.length) return [];

  const discount = npc.faction ? await getIdeologyDiscount(playerId, npc.faction) : 0;

  // Price lookup from catalogue
  const priceMap = {};
  for (const e of catalogue) priceMap[e.item_id] = e.price;
  const sourceMap = new Map(sourced.map(e => [e.item_id, e.sourceContainer]));

  // Item templates come from the boot-loaded items cache — the shelf listing
  // costs zero item round trips (was a batched SELECT, before that a serial one).
  const itemsById = new Map(shelf.map(e => [e.item_id, getItem(e.item_id)]).filter(([, i]) => i));

  const stock = [];
  for (const entry of shelf) {
    const item = itemsById.get(entry.item_id);
    if (!item) continue;
    // Vendors only sell furniture you can actually use (sit/lean/lie/watch);
    // non-consumer furniture (infrastructure) is ignored on the shelf.
    if (item.type === 'furniture' && !isConsumerFurniture(item)) continue;
    const basePrice = priceMap[entry.item_id] ?? item.value;
    const finalPrice = Math.max(1, Math.round(basePrice * (1 - discount)));
    const containerId = sourceMap.get(entry.item_id);
    const realStock = containerId
      ? Number((await query('SELECT COUNT(*)::int AS n FROM player_inventory WHERE container_id=$1 AND item_id=$2', [containerId, entry.item_id])).rows[0]?.n) || 0
      : 99;
    stock.push({
      item_id: entry.item_id,
      name: item.name,
      description: item.tags?.description ?? item.description ?? '',
      type: item.type,
      weight: item.weight,
      stock: realStock,
      price: finalPrice,
      base_price: basePrice,
      discounted: discount > 0,
    });
  }
  return stock;
}

// ─── Buy ─────────────────────────────────────────────────────────────────────

export async function buyFromVendor(player, npc, itemId, quantity = 1) {
  if (isVendorClosed(npc)) return { success: false, message: vendorClosedLine(npc) };
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
  } else if (!activeStock.find(e => e.item_id === itemId) && !catalogueEntry?.sourceContainer) {
    return { success: false, message: "That item isn't on the shelf right now. Come back later." };
  }

  const item = getItem(itemId);
  if (!item) return { success: false, message: 'Item not found.' };

  const sourceContainer = catalogueEntry?.sourceContainer;
  if (sourceContainer) {
    const { rows: n } = await query('SELECT COUNT(*)::int AS n FROM player_inventory WHERE container_id=$1 AND item_id=$2', [sourceContainer, itemId]);
    if ((n[0]?.n || 0) < quantity) {
      return { success: false, message: `${item.name} is out of stock — check back after the next delivery.` };
    }
  }

  const discount = npc.faction ? await getIdeologyDiscount(player.id, npc.faction) : 0;
  const basePrice = catalogueEntry?.price ?? item.value;
  const price = Math.max(1, Math.round(basePrice * (1 - discount))) * quantity;

  // Debit, deliver the item, and pay the vendor safe as one atomic unit so a
  // failure between steps can't take credits without handing over the goods.
  const paid = await withTransaction(async (q) => {
    if (!await adjustCredits(player, -price, q, 'vendor:buy')) return false;

    if (sourceContainer) {
      // Physical stock: MOVE real rows out of the container (never a fresh
      // INSERT), so whatever's been sitting there — freshness checkpoint,
      // cooked state — travels intact with the sale, exactly like `pull`.
      const { rows: picked } = await q(
        'SELECT id FROM player_inventory WHERE container_id=$1 AND item_id=$2 ORDER BY id LIMIT $3',
        [sourceContainer, itemId, quantity]
      );
      if (picked.length < quantity) return false; // sold out from under us mid-transaction
      await q(
        'UPDATE player_inventory SET container_id=NULL, player_id=$1, is_equipped=0 WHERE id = ANY($2::text[])',
        [player.id, picked.map(r => r.id)]
      );
    } else {
      const { rows: existing } = await q(
        'SELECT id, quantity FROM player_inventory WHERE player_id = $1 AND item_id = $2 AND is_equipped = 0',
        [player.id, itemId]
      );
      if (existing.length && isStackable(item)) {
        await q('UPDATE player_inventory SET quantity = quantity + $1 WHERE id = $2', [quantity, existing[0].id]);
      } else {
        // Templates may ship a `flags.prefill` bag (e.g. a jerry can sold full of
        // fuel) — seed it into the fresh instance's custom_data so the unit arrives
        // in that state. Non-stacking items (fillable containers are `unique`) get
        // their own row, so this can't smear across a stack.
        const prefill = item.flags?.prefill;
        await q(
          'INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, custom_data) VALUES ($1, $2, $3, $4, 1.0, $5)',
          [randomUUID(), player.id, itemId, quantity, JSON.stringify(prefill || {})]
        );
      }
    }

    // Accumulate credits in vendor's safe (SQL-side increment stays inside the
    // transaction; the RETURNING value keeps the live NPC in sync — see the
    // npcs write funnel in world.js).
    const { rows: vc } = await q('UPDATE npcs SET vendor_credits = vendor_credits + $1 WHERE id = $2 RETURNING vendor_credits', [price, npc.id]);
    if (vc.length) syncNpc(npc.id, { vendor_credits: vc[0].vendor_credits });
    return true;
  });

  if (!paid) {
    return { success: false, message: `You can't afford that. Need ${price} credits, have ${player.credits || 0}.\n${vendorBuyReaction(npc, 'poor')}` };
  }

  markSessionPurchase(player.id); // for the vendor's closing-time farewell line

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
        // NPC-configurable payoff line (flags.inner_circle_line) — lets a dealer
        // point a made regular at the next rung (e.g. the black-market fence).
        trustLine = `\n<span class="msg-system">${npc.flags.inner_circle_line || `The figure holds your gaze a moment longer than usual. "You're solid. Anything I've got, you can have. And I might have work for someone like you."`}</span>`;
      }
    }
  }

  // Neutral purchase seam — systems that care about *what* was bought (e.g. the
  // surveillance heat model watching bulk chemical buys) listen here and decide.
  emit('vendor.purchase', { player: { id: player.id, handle: player.handle }, npcId: npc?.id, itemId, tags: item.tags || {}, quantity, price, zoneId: player.current_zone });
  // A conspicuous spend is street news.
  if (price >= 500) emit('gossip.bigBuy', { player: { id: player.id, handle: player.handle }, itemName: item.name, price, zoneId: player.current_zone });

  return {
    success: true,
    message: `You buy ${quantity}x ${item.name} for ${price} credits. (${player.credits} remaining)\n${vendorBuyReaction(npc, 'success')}${trustLine}`,
    credits_remaining: player.credits,
  };
}

// ─── Sell ────────────────────────────────────────────────────────────────────

// Per-unit sell payout: 40% of item value, boosted by the seller's Cool stat
// (+5% per point) and adjusted by faction reputation with the vendor — the same
// discount buy applies, but here friendly rep pays *more* (1+discount) and hostile
// rep pays less. Floored at 1. Single source of truth for the sell price so the
// panel preview and the actual sale can't drift.
export function computeSellUnitPrice(value, statCool, discount = 0, { potency = 1, drugBuyer = false } = {}) {
  const coolMult = 1 + (statCool || 0) * 0.05;
  const rate = drugBuyer ? 0.7 : 0.4;                              // an underworld drug-buyer pays a premium; a legit vendor pays the flat 40%
  const pot = Math.min(3, Math.max(0.1, Number(potency) || 1));    // strength scales the payout — a great cook is worth more than a botch
  return Math.max(1, Math.floor((value || 0) * rate * pot * coolMult * (1 + discount)));
}

// List the player's sellable items (excludes equipped + quest items), each with the
// sell price this vendor would pay. Drives the GUI shop's Sell tab.
export async function getSellableInventory(player, npc) {
  const { rows } = await query(
    `SELECT pi.id, pi.quantity, pi.custom_data, i.name, i.value, i.tags, i.description, i.weight, p.stat_cool
     FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id
     JOIN players p ON p.id = pi.player_id
     WHERE pi.player_id = $1 AND pi.is_equipped = 0`,
    [player.id]
  );
  const discount = npc.faction ? await getIdeologyDiscount(player.id, npc.faction) : 0;
  const isDrugBuyer = !!npc.flags?.drug_buyer;
  return rows
    .filter(r => !r.tags?.quest_item)
    .map(r => {
      const cd = typeof r.custom_data === 'string' ? (() => { try { return JSON.parse(r.custom_data); } catch { return {}; } })() : (r.custom_data || {});
      return {
        inventory_id: r.id,
        name: r.name,
        quantity: r.quantity,
        description: r.tags?.description ?? r.description ?? '',
        weight: r.weight,
        price: computeSellUnitPrice(r.value, r.stat_cool, discount, { potency: Number(cd?.potency) || 1, drugBuyer: isDrugBuyer && !!r.tags?.drug }),
      };
    });
}

export async function sellToVendor(player, npc, inventoryId, quantity = 1) {
  if (isVendorClosed(npc)) return { success: false, message: vendorClosedLine(npc) };
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
  const discount = npc.faction ? await getIdeologyDiscount(player.id, npc.faction) : 0;
  const cd = typeof invItem.custom_data === 'string' ? (() => { try { return JSON.parse(invItem.custom_data); } catch { return {}; } })() : (invItem.custom_data || {});
  const sellPrice = computeSellUnitPrice(invItem.value, invItem.stat_cool, discount, { potency: Number(cd?.potency) || 1, drugBuyer: !!npc.flags?.drug_buyer && !!invItem.tags?.drug }) * sellQty;

  // Pay out and remove the sold item together, so a crash can't credit the
  // player while leaving the item in their inventory (or vice versa).
  await withTransaction(async (q) => {
    // Never remove the item unless the payout actually landed — a false return
    // rolls the whole transaction back so a sale can't destroy goods for free.
    if (!(await adjustCredits(player, sellPrice, q, 'vendor:sell'))) throw new Error('payout failed');
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

  await updateNpc(npc.id, { vendor_stock: newStock });
}

// Top up a vendor's sourced (physical-container) entries to their
// restockToQty target — a "delivery." Each unit is inserted as its own fresh
// quantity-1 row (never merged into an existing stack), so it starts life as
// an ordinary item and only becomes instanced the moment something actually
// checkpoints its freshness (examine/eat/stow/pull) — same lazy philosophy as
// everywhere else. Capped by the container's own weight capacity so a big
// delivery can't silently overfill it.
export async function restockSourcedContainers(npc) {
  const sourced = (npc.vendor_inventory || []).filter(e => e.sourceContainer && e.restockToQty > 0);
  for (const entry of sourced) {
    const item = getItem(entry.item_id);
    if (!item) continue;
    const { rows: cur } = await query(
      'SELECT COUNT(*)::int AS n FROM player_inventory WHERE container_id=$1 AND item_id=$2',
      [entry.sourceContainer, entry.item_id]
    );
    const need = entry.restockToQty - (cur[0]?.n || 0);
    if (need <= 0) continue;

    const { rows: cap } = await query('SELECT flags FROM furniture WHERE id=$1', [entry.sourceContainer]);
    const capacityG = cap[0]?.flags?.container ?? 60000;
    const { rows: used } = await query(
      `SELECT COALESCE(SUM(i.weight*pi.quantity),0)::float AS w FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.container_id=$1`,
      [entry.sourceContainer]
    );
    const room = Math.max(0, Math.floor((capacityG - (used[0]?.w || 0)) / (item.weight || 1)));
    const toAdd = Math.min(need, room);
    for (let i = 0; i < toAdd; i++) {
      await query(
        `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, container_id) VALUES ($1,'_restock',$2,1,1.0,$3)`,
        [randomUUID(), entry.item_id, entry.sourceContainer]
      );
    }
  }
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
    await restockSourcedContainers(npc).catch(err =>
      console.error(`[vendor] Sourced-container restock failed for ${npc.id}:`, err.message)
    );
  }
  if (vendors.length) console.log(`[vendor] Restocked ${vendors.length} vendor(s)`);
}
