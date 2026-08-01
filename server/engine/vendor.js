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
import { weaponSkillRequirement } from './combat.js';
import { effectiveSkill } from './skills.js';
import { fireHook } from './plugins.js';
import { vendorGrudgeRemaining, grudgeRefusal } from './vendor-grudge.js';
import { markSessionPurchase } from './vendor-session.js';
import { vendorBuyReaction } from './vendor-reactions.js';
import { isVendorClosed, vendorClosedLine } from './ai-behaviour.js';
import { getItem } from './items-cache.js';
import { syncNpc, updateNpc, getLivePlayer } from './world.js';
import { relationHelp, recordPurchase } from './relations.js';

// Per-purchase instance stamps. `flags.prefill` on an item template covers STATIC
// per-instance state (a jerry can sold full), but some goods are only meaningful
// as a dated document — a ticket is for one showing, not for tickets in general.
// A plugin registers a stamper for its item id; it runs inside the sale and
// returns either a custom_data bag to seed onto the fresh row, or a string, which
// refuses the sale with that string as the vendor's line. A stamped unit NEVER
// merges into an existing stack (two tickets to different showings are not two of
// the same thing) — the stamp key must also be listed in inventory.js INSTANCE_KEYS
// so pickUp/give/drop honour that too.
const purchaseStamps = new Map();   // item_id -> async (player, npc, item) => object | string

// Thrown to abort a sale from inside the transaction. See buyFromVendor's comment:
// `withTransaction` commits on a falsy return and only rolls back on a throw, so any
// mid-sale bail-out MUST throw. `reason` becomes the vendor's refusal line.
class VendorAbort extends Error {
  constructor(reason) { super(reason || 'vendor abort'); this.reason = reason || null; }
}

// Per-purchase DELIVERY override. Sibling of the stamps above, and the same shape,
// but it answers a different question: not "what state does this unit arrive in" but
// "where does it arrive at all". Almost everything a vendor sells is handed across the
// counter into your hands — but some goods are bought here and delivered ELSEWHERE: a
// 150kg pallet of crop run out to a dead drop in the waste (plugins/flight), a
// cipher-locked crate a drone drops at the Scald (plugins/smuggle).
//
// Registered against an NPC FLAG KEY, not an item tag, because "does this counter
// deliver rather than hand over" is a property of the VENDOR. Keying it on the goods
// instead would make two fences selling the same raws collide — which they do.
//
// The handler runs INSIDE the sale transaction, after credits are debited and in place
// of the inventory insert. It returns:
//   • a string        → the receipt line; the handler now owns the goods
//   • '!reason'       → refuse, roll the sale back, show `reason`
//   • null            → NOT MINE: fall through to ordinary inventory delivery (a
//                       counter that also sells a shotgun over the counter)
//   • anything else, or a throw → abort and roll back, because a purchase must never
//                       take credits and deliver nothing anywhere
const purchaseDeliveries = new Map();   // npc flag key -> async (player, npc, item, quantity, q) => string|null
export function registerPurchaseDelivery(npcFlagKey, fn) {
  if (typeof fn !== 'function') throw new Error('registerPurchaseDelivery: fn required');
  purchaseDeliveries.set(npcFlagKey, fn);
}
function deliveryFor(npc) {
  for (const key of Object.keys(npc?.flags || {})) {
    if (!npc.flags[key]) continue;
    const fn = purchaseDeliveries.get(key);
    if (fn) return fn;
  }
  return null;
}

export function registerPurchaseStamp(itemId, fn) {
  if (typeof fn !== 'function') throw new Error('registerPurchaseStamp: fn required');
  purchaseStamps.set(itemId, fn);
}

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

// How well this vendor treats you, as one number the four pricing sites share
// (shelf listing, buy, sell listing, sell). Two independent channels:
//
//   • IDEOLOGY — where you stand with the org they belong to. Institutional.
//   • RELATIONSHIP — how they feel about YOU personally (engine/relations.js).
//     Zero round trips: read from the live player's hydrated Map.
//
// Additive, then clamped. They stack because they're genuinely different things
// — being an Ascendant in good standing AND her regular should beat either
// alone — but the clamp stops the combination from ever making goods free or
// the markup punitive.
const DISCOUNT_MAX = 0.4;
const MARKUP_MAX = -0.35;
export async function vendorDiscount(playerId, npc) {
  const ideological = npc.faction ? await getIdeologyDiscount(playerId, npc.faction) : 0;
  // A player who isn't online has no hydrated relations; personal standing then
  // contributes nothing rather than erroring. Institutional standing still applies.
  const personal = relationHelp(getLivePlayer(playerId), npc.id);
  return Math.max(MARKUP_MAX, Math.min(DISCOUNT_MAX, ideological + personal));
}

// ─── Examine metadata (shared by Buy stock + Sell inventory) ──────────────────

// A short category label for the examine pane, derived from tags (there is no
// more `type` routing — see items.md). Body-slot armor/apparel vs. weapon vs.
// consumable etc. `type` is only consulted for furniture, which the cache still
// carries as a column.
export function vendorCategory(tags = {}, type) {
  if (tags.weapon) return 'Weapon';
  if (tags.armor_soak) return 'Armor';
  const BODY = ['head', 'torso', 'hands', 'legs', 'feet'];
  if (BODY.includes(tags.slot)) return 'Apparel';
  if (tags.slot === 'accessory') return 'Accessory';
  if (tags.drug) return 'Drug';
  if (tags.consumable) return 'Consumable';
  if (tags.container) return 'Container';
  if (type === 'furniture') return 'Furniture';
  if (tags.material) return 'Material';
  return 'Goods';
}

// Display-ready gameplay stat lines for the examine pane. Derived purely from
// tags so a template (Buy) and an inventory row (Sell) render identically. `c`
// is a colour hint the client maps to a class (dmg/soak/good).
export function vendorStatLines(tags = {}) {
  const lines = [];
  if (tags.damage && tags.damage.min != null) {
    const dt = tags.damage_type ? ` ${tags.damage_type}` : '';
    lines.push({ k: 'Damage', v: `${tags.damage.min}–${tags.damage.max}${dt}`, c: 'dmg' });
  }
  if (tags.armor_soak && typeof tags.armor_soak === 'object') {
    const soak = Object.entries(tags.armor_soak).filter(([, n]) => n).map(([t, n]) => `${n} ${t}`).join(', ');
    if (soak) lines.push({ k: 'Soak', v: soak, c: 'soak' });
  }
  const RESTORE = { restore_hp: 'HP', restore_hunger: 'Food', restore_thirst: 'Water', restore_radiation: 'Rads', restore_sanity: 'Sanity' };
  for (const [key, label] of Object.entries(RESTORE)) {
    if (tags[key]) lines.push({ k: label, v: `${tags[key] > 0 ? '+' : ''}${tags[key]}`, c: 'good' });
  }
  if (tags.stat_bonus && typeof tags.stat_bonus === 'object') {
    const b = Object.entries(tags.stat_bonus).filter(([, n]) => n).map(([s, n]) => `${n > 0 ? '+' : ''}${n} ${s.replace(/^stat_/, '')}`).join(', ');
    if (b) lines.push({ k: 'Bonus', v: b });
  }
  return lines;
}

// ─── Stock display ───────────────────────────────────────────────────────────

// `shelfKey` selects which of the NPC's shelves is being browsed. A vendor may keep
// more than one: entries with no `shelf` are the FRONT COUNTER (what `shop` and the
// implicit "Browse your wares" open), and an entry tagged `shelf: 'back_room'` is only
// ever visible to an OPEN_SHOP that named that shelf. This is what lets one NPC be
// both a bartender selling swill and a fence selling precursor without the bar list
// ever leaking contraband — the covert half stays covert.
export async function getVendorStock(npc, playerId, shelfKey = null) {
  const catalogue = (npc.vendor_inventory || []).filter(e => (e.shelf || null) === (shelfKey || null));
  const activeStock = (npc.vendor_stock || []).filter(e => (e.shelf || null) === (shelfKey || null));
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

  const discount = await vendorDiscount(playerId, npc);

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
      category: vendorCategory(item.tags, item.type),
      stats: vendorStatLines(item.tags),
      stackable: isStackable(item),
      weight: item.weight,
      stock: realStock,
      price: finalPrice,
      base_price: basePrice,
      discounted: discount > 0,
    });
  }
  // A shelf a plugin may annotate. The cooking plugin uses it to mark what's on
  // your shopping list — a list you have to hold up against the shelf yourself is
  // only half a list. Handlers mutate entries in place (setting `wanted`); an
  // unhooked shelf is byte-identical to what it was before this existed.
  await fireHook('shop.stock', { stock, npc, playerId });
  return stock;
}

// ─── Buy ─────────────────────────────────────────────────────────────────────

export async function buyFromVendor(player, npc, itemId, quantity = 1, shelfKey = null) {
  if (isVendorClosed(npc)) return { success: false, message: vendorClosedLine(npc) };
  const grudge = await vendorGrudgeRemaining(player.id, npc.id);
  if (grudge > 0) return { success: false, message: grudgeRefusal(npc, grudge) };

  // Only the shelf the player actually has open is buyable — the client sends an item
  // id, so without this a front-counter session could buy straight off the back room.
  const catalogue = (npc.vendor_inventory || []).filter(e => (e.shelf || null) === (shelfKey || null));
  const activeStock = (npc.vendor_stock || []).filter(e => (e.shelf || null) === (shelfKey || null));

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

  // A shopkeeper will not sell you a weapon you visibly cannot handle. This is a
  // HARD gate on buying and a soft one on using: nothing stops you looting the
  // same weapon off a corpse, you will just be terrible with it (see
  // `underskilledPenalty` in combat.js). Keeps the good gear out of a fresh
  // character's hands without ever confiscating something they earned.
  const req = weaponSkillRequirement(item.tags);
  if (req) {
    const have = await effectiveSkill(player, req.skillId);
    if (have < req.need) {
      return {
        success: false,
        message: `${npc.name} looks at the ${item.name}, then at you, and puts it back. "Come back when you know which end is which."`,
      };
    }
  }

  const sourceContainer = catalogueEntry?.sourceContainer;
  if (sourceContainer) {
    const { rows: n } = await query('SELECT COUNT(*)::int AS n FROM player_inventory WHERE container_id=$1 AND item_id=$2', [sourceContainer, itemId]);
    if ((n[0]?.n || 0) < quantity) {
      return { success: false, message: `${item.name} is out of stock — check back after the next delivery.` };
    }
  }

  // Run any per-purchase stamper before we touch credits, so a refusal ("nothing
  // tapes tonight") costs the player nothing.
  let stamp = null;
  let stampLine = '';   // optional flavour the stamper wants shown on the receipt
  const stamper = purchaseStamps.get(itemId);
  if (stamper) {
    stamp = await stamper(player, npc, item).catch(() => null);
    if (typeof stamp === 'string') return { success: false, message: stamp };
    if (stamp && typeof stamp !== 'object') stamp = null;
    if (stamp?._line) { stampLine = `\n<span class="msg-system">${stamp._line}</span>`; delete stamp._line; }
  }

  const delivery = deliveryFor(npc);
  let deliveryLine = '';      // receipt flavour from a delivery handler
  let deliveryRefusal = null; // its own refusal text, when it declined the sale

  const discount = await vendorDiscount(player.id, npc);
  const basePrice = catalogueEntry?.price ?? item.value;
  const price = Math.max(1, Math.round(basePrice * (1 - discount))) * quantity;

  // Debit, deliver the item, and pay the vendor safe as one atomic unit so a
  // failure between steps can't take credits without handing over the goods.
  //
  // ABORT BY THROWING, never by returning false. `withTransaction` only rolls back on
  // a throw — a falsy RETURN commits everything done so far, which is why the
  // sold-out-mid-transaction path below used to take the credits and hand over
  // nothing. VendorAbort is caught immediately outside and becomes the refusal.
  let paid = false;
  try {
    paid = await withTransaction(async (q) => {
    if (!await adjustCredits(player, -price, q, 'vendor:buy')) throw new VendorAbort();

    // Bought here, delivered elsewhere — the handler owns the goods from this point
    // and nothing lands in inventory. Anything short of a receipt line rolls the
    // sale back, so a failed delivery can never keep the money.
    let handled = false;
    if (delivery) {
      let line;
      try { line = await delivery(player, npc, item, quantity, q); }
      catch (err) {
        if (err instanceof VendorAbort) throw err;
        console.warn(`[vendor] purchase delivery for ${itemId} threw: ${err.message}`);
        throw new VendorAbort();
      }
      // null = "not mine" — this counter delivers pallets, but is also selling you a
      // shotgun across the desk. Fall through to the ordinary inventory path.
      if (line !== null && line !== undefined) {
        if (typeof line !== 'string' || !line || line.startsWith('!'))
          throw new VendorAbort(typeof line === 'string' && line.startsWith('!') ? line.slice(1) : null);
        deliveryLine = `\n<span class="msg-system">${line}</span>`;
        handled = true;
      }
    }
    if (handled) {
      // The goods are the handler's now — there is nothing to put in a pocket.
    } else if (sourceContainer) {
      // Physical stock: MOVE real rows out of the container (never a fresh
      // INSERT), so whatever's been sitting there — freshness checkpoint,
      // cooked state — travels intact with the sale, exactly like `pull`.
      const { rows: picked } = await q(
        'SELECT id FROM player_inventory WHERE container_id=$1 AND item_id=$2 ORDER BY id LIMIT $3',
        [sourceContainer, itemId, quantity]
      );
      if (picked.length < quantity)   // sold out from under us mid-transaction
        throw new VendorAbort(`${item.name} is out of stock — check back after the next delivery.`);
      await q(
        'UPDATE player_inventory SET container_id=NULL, player_id=$1, is_equipped=0 WHERE id = ANY($2::text[])',
        [player.id, picked.map(r => r.id)]
      );
    } else {
      const { rows: existing } = await q(
        'SELECT id, quantity FROM player_inventory WHERE player_id = $1 AND item_id = $2 AND is_equipped = 0',
        [player.id, itemId]
      );
      if (existing.length && isStackable(item) && !stamp) {
        await q('UPDATE player_inventory SET quantity = quantity + $1 WHERE id = $2', [quantity, existing[0].id]);
      } else {
        // Templates may ship a `flags.prefill` bag (e.g. a jerry can sold full of
        // fuel) — seed it into the fresh instance's custom_data so the unit arrives
        // in that state. Non-stacking items (fillable containers are `unique`) get
        // their own row, so this can't smear across a stack. A per-purchase stamp
        // (a ticket's showing) layers on top and forces its own row regardless.
        const prefill = item.flags?.prefill;
        await q(
          'INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, custom_data) VALUES ($1, $2, $3, $4, 1.0, $5)',
          [randomUUID(), player.id, itemId, quantity, JSON.stringify({ ...(prefill || {}), ...(stamp || {}) })]
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
  } catch (err) {
    if (!(err instanceof VendorAbort)) throw err;
    deliveryRefusal = err.reason || null;
    // The rollback restored the row, but `adjustCredits` already mirrored the debit
    // onto the live player object — put it back or the session shows money it still has.
    const { rows: cr } = await query('SELECT credits FROM players WHERE id=$1', [player.id]);
    if (cr.length) player.credits = cr[0].credits;
  }

  if (!paid) {
    // A delivery handler that declined gets to say why — "you already have six
    // pallets sitting out there" is not "you can't afford that".
    if (deliveryRefusal) return { success: false, message: deliveryRefusal };
    return { success: false, message: `You can't afford that. Need ${price} credits, have ${player.credits || 0}.\n${vendorBuyReaction(npc, 'poor')}` };
  }

  markSessionPurchase(player.id); // for the vendor's closing-time farewell line

  // Being a customer is how you come to be known behind a counter — which is the
  // ladder an authored gate like `{ relation: 'familiar' }` hangs off. The
  // weights (and the per-sale warmth cap) live in relations.js beside the tier
  // thresholds they have to stay calibrated against; this is the one call site.
  //
  // Sync and query-free by contract (docs/systems-relationships.md), so no round
  // trip is added to a purchase.
  if (npc?.id) recordPurchase(player, npc.id, price);

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
    message: `You buy ${quantity}x ${item.name} for ${price} credits. (${player.credits} remaining)\n${vendorBuyReaction(npc, 'success')}${stampLine}${deliveryLine}${trustLine}`,
    credits_remaining: player.credits,
  };
}

// ─── Sell ────────────────────────────────────────────────────────────────────

// Per-unit sell payout: 40% of item value, boosted by the seller's Cool stat
// (+5% per point) and adjusted by faction reputation with the vendor — the same
// discount buy applies, but here friendly rep pays *more* (1+discount) and hostile
// rep pays less. Floored at 1. Single source of truth for the sell price so the
// panel preview and the actual sale can't drift.
// What a plated meal is worth, by the band stamped on it. Same shape as drug
// potency and the same 0.1–3 ceiling: a botched plate is worth a fraction of the
// ingredients that went into it, a masterful one is worth cooking for a living.
// Lives in the engine next to the price maths for the same reason
// COOK_QUALITY_MULT lives next to the eat path — the plugin decides what band a
// meal earns, the engine decides what a band is worth.
export const COOK_QUALITY_PRICE = {
  poor: 0.4, grim: 0.6, acceptable: 1.0, decent: 1.15, good: 1.4,
  'very good': 1.7, excellent: 2.1, superb: 2.6, masterful: 3.0,
};

export function computeSellUnitPrice(value, statCool, discount = 0, { potency = 1, drugBuyer = false, cookQuality = null, foodBuyer = false, portion = 1 } = {}) {
  const coolMult = 1 + (statCool || 0) * 0.05;
  // A specialist pays a premium for what they specialise in; a general vendor
  // pays the flat 40% for anything.
  const rate = (drugBuyer || foodBuyer) ? 0.7 : 0.4;
  const pot = Math.min(3, Math.max(0.1, Number(potency) || 1));    // strength scales the payout — a great cook is worth more than a botch
  const qual = cookQuality ? (COOK_QUALITY_PRICE[cookQuality] ?? 1) : 1;
  // Half a dish is worth half. Same rule as the nourishment it carries.
  const part = Math.min(1, Math.max(0.05, Number(portion) || 1));
  return Math.max(1, Math.floor((value || 0) * rate * pot * qual * part * coolMult * (1 + discount)));
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
  const discount = await vendorDiscount(player.id, npc);
  const isDrugBuyer = !!npc.flags?.drug_buyer;
  const isFoodBuyer = !!npc.flags?.food_buyer;
  return rows
    .filter(r => !r.tags?.quest_item)
    .map(r => {
      const cd = typeof r.custom_data === 'string' ? (() => { try { return JSON.parse(r.custom_data); } catch { return {}; } })() : (r.custom_data || {});
      return {
        inventory_id: r.id,
        name: r.name,
        quantity: r.quantity,
        description: r.tags?.description ?? r.description ?? '',
        category: vendorCategory(r.tags),
        stats: vendorStatLines(r.tags),
        weight: r.weight,
        price: computeSellUnitPrice(r.value, r.stat_cool, discount, { potency: Number(cd?.potency) || 1, drugBuyer: isDrugBuyer && !!r.tags?.drug, cookQuality: cd?.cook_quality || null, foodBuyer: isFoodBuyer && !!cd?.cook_quality, portion: (Number(cd?.portion) || 1) * (Number(cd?.yield) || 1) }),
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
  const discount = await vendorDiscount(player.id, npc);
  const cd = typeof invItem.custom_data === 'string' ? (() => { try { return JSON.parse(invItem.custom_data); } catch { return {}; } })() : (invItem.custom_data || {});
  const sellPrice = computeSellUnitPrice(invItem.value, invItem.stat_cool, discount, { potency: Number(cd?.potency) || 1, drugBuyer: !!npc.flags?.drug_buyer && !!invItem.tags?.drug, cookQuality: cd?.cook_quality || null, foodBuyer: !!npc.flags?.food_buyer && !!cd?.cook_quality, portion: (Number(cd?.portion) || 1) * (Number(cd?.yield) || 1) }) * sellQty;

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
//
// The BACK ROOM is stocked by the same pass, one step behind the floor. A case
// flagged `backstock: <containerId>` is filled from that container first (real
// rows walked forward, keeping whatever freshness they've accrued), and only the
// shortfall is minted; then the back room itself is topped up to
// `backstock_depth × restockToQty` (default 2 — a couple of deliveries in
// reserve). Without that second half the stockroom stays empty forever, the
// walk-forward never fires, and "backstock" is decoration: every delivery just
// mints onto the floor. It also makes the stockroom worth walking into — there
// is real, liftable stock behind the shop.

// How many more units of `item` fit in a container, by weight. Shared by the
// floor top-up and the back-room top-up so neither can overfill its box.
async function containerRoomFor(containerId, item, capacityG) {
  const { rows: used } = await query(
    `SELECT COALESCE(SUM(i.weight*pi.quantity),0)::float AS w FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.container_id=$1`,
    [containerId]
  );
  return Math.max(0, Math.floor((capacityG - (used[0]?.w || 0)) / (item.weight || 1)));
}

// Mint `need` fresh quantity-1 rows of `item` into `containerId`, capped by room.
// A short delivery is LOGGED: the cap is applied per entry in catalogue order, so
// an over-subscribed case silently starves whichever items are authored last —
// they read `stock: 0` on the shelf forever and look like a content bug rather
// than a case that needs a bigger `container` capacity.
async function mintInto(containerId, item, need, capacityG) {
  if (need <= 0) return 0;
  const room = await containerRoomFor(containerId, item, capacityG);
  const toAdd = Math.min(need, room);
  if (toAdd < need) {
    console.warn(`[vendor] ${containerId} is full — short ${need - toAdd}x ${item.id} this delivery; raise its flags.container capacity.`);
  }
  for (let i = 0; i < toAdd; i++) {
    await query(
      `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, container_id) VALUES ($1,'_restock',$2,1,1.0,$3)`,
      [randomUUID(), item.id, containerId]
    );
  }
  return toAdd;
}

const countIn = async (containerId, itemId) => Number((await query(
  'SELECT COUNT(*)::int AS n FROM player_inventory WHERE container_id=$1 AND item_id=$2',
  [containerId, itemId]
)).rows[0]?.n) || 0;

export async function restockSourcedContainers(npc) {
  const sourced = (npc.vendor_inventory || []).filter(e => e.sourceContainer && e.restockToQty > 0);
  // Container flags are read once per container, not once per catalogue entry —
  // a grocer sources 30 items off one case and this ran 30 identical lookups.
  const flagCache = new Map();
  const flagsFor = async (id) => {
    if (!flagCache.has(id)) {
      const { rows } = await query('SELECT flags FROM furniture WHERE id=$1', [id]);
      flagCache.set(id, rows[0]?.flags || null);
    }
    return flagCache.get(id);
  };

  for (const entry of sourced) {
    const item = getItem(entry.item_id);
    if (!item) continue;

    const flags = await flagsFor(entry.sourceContainer);
    if (!flags) continue;                              // case has been deleted
    const capacityG = flags.container ?? 60000;
    const backstock = flags.backstock;

    let need = entry.restockToQty - (await countIn(entry.sourceContainer, entry.item_id));

    // Walk the back room forward onto the floor first.
    if (backstock && need > 0) {
      const { rows: moved } = await query(
        'SELECT id FROM player_inventory WHERE container_id=$1 AND item_id=$2 ORDER BY id LIMIT $3',
        [backstock, entry.item_id, need]
      );
      if (moved.length) {
        await query('UPDATE player_inventory SET container_id=$1 WHERE id = ANY($2::text[])', [entry.sourceContainer, moved.map(r => r.id)]);
        need -= moved.length;
      }
    }

    await mintInto(entry.sourceContainer, item, need, capacityG);

    // Then the delivery to the back room. Runs whether or not the floor needed
    // anything — a full case with an empty stockroom is exactly the state that
    // used to persist forever.
    if (backstock) {
      const bFlags = await flagsFor(backstock);
      if (!bFlags) continue;
      const depth = Math.max(0, Number(bFlags.backstock_depth ?? 2));
      const target = Math.floor(entry.restockToQty * depth);
      await mintInto(backstock, item, target - (await countIn(backstock, entry.item_id)), bFlags.container ?? 60000);
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
