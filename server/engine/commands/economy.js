import { query } from '../../models/db.js';
import { getZone, getZoneNpcs } from '../world.js';
import { getVendorStock, buyFromVendor, sellToVendor } from '../vendor.js';
import { transferCredits } from '../economy.js';

async function cmdShop(npcName, player) {
  if (!npcName) return { type:'error', message:'Browse whose shop? (shop <npc name>)' };
  const npcs = getZoneNpcs(player.current_zone);
  const npc = npcs.find(n => n.name.toLowerCase().includes(npcName));
  if (!npc) return { type:'error', message:`Can't find "${npcName}" here.` };
  if (!npc.vendor_inventory?.length) return { type:'error', message:`${npc.name} isn't a vendor.` };
  const stock = await getVendorStock(npc, player.id);
  if (!stock.length) return { type:'error', message:`${npc.name} is out of stock.` };
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
  const vendor = npcs.find(n => n.vendor_inventory?.length);
  if (!vendor) return { type:'error', message:'No vendor here.' };
  const stock = await getVendorStock(vendor, player.id);
  const item = stock.find(s => s.name.toLowerCase().includes(itemName));
  if (!item) return { type:'error', message:`"${itemName}" isn't available here.` };
  const result = await buyFromVendor(player, vendor, item.item_id, 1);
  return { type:result.success?'buy':'error', message:result.message, player_update:{credits:player.credits} };
}

async function cmdSell(args, player) {
  const itemName = args.join(' ');
  if (!itemName) return { type:'error', message:'Sell what?' };
  const npcs = getZoneNpcs(player.current_zone);
  const vendor = npcs.find(n => n.vendor_inventory?.length);
  if (!vendor) return { type:'error', message:'No vendor here.' };
  const { rows } = await query(`SELECT pi.id FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND i.name ILIKE $2 LIMIT 1`, [player.id, `%${itemName}%`]);
  if (!rows.length) return { type:'error', message:`You don't have "${itemName}".` };
  const result = await sellToVendor(player, vendor, rows[0].id, 1);
  return { type:result.success?'sell':'error', message:result.message, player_update:{credits:player.credits} };
}

async function cmdBalance(player) {
  return { type:'balance', message:`Carried: ${player.credits||0}c\nBanked: ${player.bank_credits||0}c` };
}

async function cmdDeposit(amountStr, player) {
  const zone = getZone(player.current_zone);
  if (!zone?.flags?.has_atm) return { type:'error', message:'There\'s no ATM here.' };
  const amount = amountStr === 'all' ? (player.credits||0) : parseInt(amountStr, 10);
  if (!amount || amount <= 0) return { type:'error', message:'Deposit how much? Try "deposit 50" or "deposit all".' };
  if (!await transferCredits(player, amount, 'deposit')) return { type:'error', message:`You only have ${player.credits||0} credits on you.` };
  return { type:'deposit', message:`You deposit ${amount}c. Carried: ${player.credits}c · Banked: ${player.bank_credits}c`, player_update:{credits:player.credits, bank_credits:player.bank_credits} };
}

async function cmdWithdraw(amountStr, player) {
  const zone = getZone(player.current_zone);
  if (!zone?.flags?.has_atm) return { type:'error', message:'There\'s no ATM here.' };
  const amount = amountStr === 'all' ? (player.bank_credits||0) : parseInt(amountStr, 10);
  if (!amount || amount <= 0) return { type:'error', message:'Withdraw how much? Try "withdraw 50" or "withdraw all".' };
  if (!await transferCredits(player, amount, 'withdraw')) return { type:'error', message:`You only have ${player.bank_credits||0} credits banked.` };
  return { type:'withdraw', message:`You withdraw ${amount}c. Carried: ${player.credits}c · Banked: ${player.bank_credits}c`, player_update:{credits:player.credits, bank_credits:player.bank_credits} };
}

export const handlers = {
  shop:    (args, raw, player) => cmdShop(args.join(' '), player),
  browse:  (args, raw, player) => cmdShop(args.join(' '), player),
  buy:     (args, raw, player) => cmdBuy(args, player),
  sell:    (args, raw, player) => cmdSell(args, player),
  balance: (args, raw, player) => cmdBalance(player),
  deposit:  (args, raw, player) => cmdDeposit(args[0], player),
  withdraw: (args, raw, player) => cmdWithdraw(args[0], player),
};
