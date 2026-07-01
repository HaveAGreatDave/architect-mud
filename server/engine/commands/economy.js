import { query } from '../../models/db.js';
import { getZoneNpcs } from '../world.js';
import { getVendorStock, buyFromVendor, sellToVendor } from '../vendor.js';
import { buyFurniture } from '../furniture-shop.js';
import { openShopSession, getNpcForShopper } from '../vendor-session.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../sift.js';

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

async function cmdShop(npcName, player) {
  if (!npcName) return { type:'error', message:'Browse whose shop? (shop <npc name>)' };
  const npcs = getZoneNpcs(player.current_zone);
  const r = siftResolve(npcName, npcs);
  if (r.type === 'none') return { type:'error', message:`Can't find "${npcName}" here.` };
  if (r.type === 'ambiguous') {
    createSelectionState(player.id, r.candidates, { verb: 'shop' });
    return { type:'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  const npc = r.candidate;
  if (!npc.vendor_inventory?.length) return { type:'error', message:`${npc.name} isn't a vendor.` };
  const stock = await getVendorStock(npc, player.id);
  if (!stock.length) return { type:'error', message:`${npc.name} is out of stock.` };
  openShopSession(player.id, npc.id); // remember this vendor for bare buy/sell; pause its wandering
  let msg = `<span class="inv-header">${npc.name.toUpperCase()} — SHOP</span>\nCredits: ${player.credits||0}\n\n`;
  for (const item of stock) {
    const disc = item.discounted ? ' <span class="equipped">(rep discount)</span>' : '';
    msg += `  [<span class="item-rarity-${item.rarity}">${item.name}</span>] ${item.price}cr${disc}\n    ${item.description}\n`;
  }
  msg += `\nUse: <span class="equipped">buy &lt;item name&gt;</span> or <span class="equipped">sell &lt;item name&gt;</span>`;
  return { type:'shop', message:msg, npc_id:npc.id, stock };
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
    createSelectionState(player.id, br.candidates, { verb: 'buy' });
    return { type:'output', message: formatSelectionPage({ allCandidates: br.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  const item = br.candidate;
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

export const handlers = {
  shop:    (args, raw, player) => cmdShop(args.join(' '), player),
  browse:  (args, raw, player) => cmdShop(args.join(' '), player),
  buy:     (args, raw, player) => cmdBuy(args, player),
  sell:    (args, raw, player) => cmdSell(args, player),
  balance: (args, raw, player) => cmdBalance(player),
};
