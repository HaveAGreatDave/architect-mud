// Commerce plugin — the shop/browse/buy/sell/balance verbs. Extracted from
// server/engine/commands/economy.js (Phase 2, docs/proposals/engine-plugin-boundary.md).
// The vendor *services* (stock, pricing, trust, restock — vendor.js,
// furniture-shop.js, vendor-session.js, economy.js) stay engine, same pattern
// as combat math. SIFT ambiguous picks replay through the commerce.shop_vendor /
// commerce.buy_item Actions (builtin replay can't reach plugin verbs).
import { query } from '../../server/models/db.js';
import { getZoneNpcs, world } from '../../server/engine/world.js';
import { getVendorStock, getSellableInventory, buyFromVendor, sellToVendor } from '../../server/engine/vendor.js';
import { buyFurniture } from '../../server/engine/furniture-shop.js';
import { openShopSession, getNpcForShopper } from '../../server/engine/vendor-session.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../../server/engine/sift.js';
import { registerAction } from '../../server/engine/actions.js';
import { on } from '../../server/engine/events.js';
import { vendorGrudgeRemaining, holdVendorGrudge, grudgeRefusal } from '../../server/engine/vendor-grudge.js';

// Resolve which vendor a bare buy/sell targets: the one the player is actively
// shopping with (if still in the zone), else the first vendor present. Without this,
// two vendors in a room would always route buy/sell to the first one regardless of
// which shop the player opened.
function resolveVendor(player, npcs) {
  const sessionNpcId = getNpcForShopper(player.id);
  if (sessionNpcId) {
    const sv = npcs.find(n => n.id === sessionNpcId && n.vendor_inventory?.length);
    if (sv) return sv;
  }
  return npcs.find(n => n.vendor_inventory?.length) || null;
}

async function openShopFor(npc, player) {
  if (!npc.vendor_inventory?.length) return { type:'error', message:`${npc.name} isn't a vendor.` };
  const grudge = await vendorGrudgeRemaining(player.id, npc.id);
  if (grudge > 0) return { type:'error', message: grudgeRefusal(npc, grudge) };
  const stock = await getVendorStock(npc, player.id);
  if (!stock.length) return { type:'error', message:`${npc.name} is out of stock.` };
  openShopSession(player.id, npc.id); // remember this vendor for bare buy/sell; pause its wandering
  // Open the GUI shop pane — same payload shape as the click-a-vendor dialogue path
  // (server/index.js sendShopPanel), so the `shop <npc>` command and clicking share one UI.
  const inventory = await getSellableInventory(player, npc);
  return {
    type: 'dialogue_shop',
    npcId: npc.id,
    npcName: npc.name,
    stock,
    inventory,
    credits: player.credits || 0,
  };
}

async function cmdShop(npcName, player) {
  if (!npcName) return { type:'error', message:'Browse whose shop? (shop <npc name>)' };
  const npcs = getZoneNpcs(player.current_zone);
  const r = siftResolve(npcName, npcs);
  if (r.type === 'none') return { type:'error', message:`Can't find "${npcName}" here.` };
  if (r.type === 'ambiguous') {
    createSelectionState(player.id, r.candidates, { dispatchType: 'commerce.shop_vendor', dispatchParam: 'target' });
    return { type:'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  return openShopFor(r.candidate, player);
}

async function buyStockItem(item, vendor, player) {
  const grudge = await vendorGrudgeRemaining(player.id, vendor.id);
  if (grudge > 0) return { type:'error', message: grudgeRefusal(vendor, grudge) };
  // Furniture is delivered to an owned apartment rather than carried in inventory.
  if (item.type === 'furniture') {
    const { rows } = await query('SELECT * FROM items WHERE id=$1', [item.item_id]);
    if (!rows.length) return { type:'error', message:'Item not found.' };
    const catalogueEntry = (vendor.vendor_inventory || []).find(e => e.item_id === item.item_id);
    return await buyFurniture(player, vendor, rows[0], catalogueEntry);
  }
  const result = await buyFromVendor(player, vendor, item.item_id, 1);
  return { type:result.success?'buy':'error', message:result.message, player_update:{credits:player.credits} };
}

async function cmdBuy(args, player) {
  const itemName = args.join(' ');
  if (!itemName) return { type:'error', message:'Buy what?' };
  const npcs = getZoneNpcs(player.current_zone);
  const vendor = resolveVendor(player, npcs);
  if (!vendor) return { type:'error', message:'No vendor here.' };
  const stock = await getVendorStock(vendor, player.id);
  const br = siftResolve(itemName, stock);
  if (br.type === 'none') return { type:'error', message:`"${itemName}" isn't available here.` };
  if (br.type === 'ambiguous') {
    createSelectionState(player.id, br.candidates, { dispatchType: 'commerce.buy_item', dispatchParam: 'target' });
    return { type:'output', message: formatSelectionPage({ allCandidates: br.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  return buyStockItem(br.candidate, vendor, player);
}

async function cmdSell(args, player) {
  const itemName = args.join(' ');
  if (!itemName) return { type:'error', message:'Sell what?' };
  const npcs = getZoneNpcs(player.current_zone);
  const vendor = resolveVendor(player, npcs);
  if (!vendor) return { type:'error', message:'No vendor here.' };
  const { rows } = await query(`SELECT pi.id FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND i.name ILIKE $2 LIMIT 1`, [player.id, `%${itemName}%`]);
  if (!rows.length) return { type:'error', message:`You don't have "${itemName}".` };
  const result = await sellToVendor(player, vendor, rows[0].id, 1);
  return { type:result.success?'sell':'error', message:result.message, player_update:{credits:player.credits} };
}

async function cmdBalance(player) {
  return { type:'balance', message:`Carried: ${player.credits||0}c\nBanked: ${player.bank_credits||0}c` };
}

// SIFT selection replays.
registerAction({
  type: 'commerce.shop_vendor',
  handler: ({ actor, params }) => openShopFor(params.target, actor),
});
registerAction({
  type: 'commerce.buy_item',
  handler: ({ actor, params }) => {
    const vendor = resolveVendor(actor, getZoneNpcs(actor.current_zone));
    if (!vendor) return { type:'error', message:'No vendor here.' };
    return buyStockItem(params.target, vendor, actor);
  },
});

// Burgle an apartment an NPC vendor owns and they hold it against you — refusing
// to trade until the grudge lapses (7 in-game days). doors.js resolves the
// break-in to the apartment's real owner (ownerId/ownerType from the table), so
// this fires whether or not the owner was home. The safe-hack grudge is set
// directly by the vendor-safe plugin; this covers their hololocked residence.
on('hololock.breached', ({ player, ownerId }) => {
  if (!player?.id || !ownerId) return;
  // Attribute by resolving the owner id to an NPC vendor — player and NPC id
  // namespaces don't collide, so this catches NPC-owned apartments even when the
  // row's owner_type was never changed from the 'player' default.
  const npc = world.npcs.get(ownerId);
  if (npc?.vendor_inventory?.length) holdVendorGrudge(player, ownerId).catch(() => {});
});

export const commands = {
  shop:    (args, raw, player) => cmdShop(args.join(' '), player),
  browse:  (args, raw, player) => cmdShop(args.join(' '), player),
  buy:     (args, raw, player) => cmdBuy(args, player),
  sell:    (args, raw, player) => cmdSell(args, player),
  balance: (args, raw, player) => cmdBalance(player),
};

console.log('[commerce] Plugin loaded.');
