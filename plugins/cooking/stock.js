// Stocking the kitchen: food and kit delivered to whoever is standing at a stove.
//
// `kitchenstock` sends the catalogue the Kitchen Stage's stock-up screen draws ('kitchen_stock');
// `kitchenorder <item> [qty]` buys and delivers. The catalogue is only what some vendor in town
// deals in (stockists.js), and a delivery costs half as much again as the item's value, so walking
// to the shop is still the cheap way.
import { withTransaction } from '../../server/models/db.js';
import { getZoneFurniture, getZone } from '../../server/engine/world.js';
import { getItemCache } from '../../server/engine/items-cache.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { giveItemById } from '../../server/engine/inventory.js';
import { stockedItemIds } from './stockists.js';
import { gearKeysOf, GEAR } from './gear.js';

const DELIVERY = 1.5;
const MAX_QTY = 20;

const inKitchen = (player) =>
  getZoneFurniture(player.current_zone).some(f => f.flags?.stove_tier) || !!getZone(player.current_zone)?.flags?.stove_tier;

// 'food', 'kit' or null for an item the screen doesn't sell.
function shelfOf(item) {
  const t = item?.tags || {};
  if (t.quest_item) return null;
  if (t.food_profile || t.needs_cooking) return 'food';
  if (t.dishware || gearKeysOf(t).some(k => GEAR[k]?.shoppable)) return 'kit';
  return null;
}

const priceOf = (item) => Math.max(1, Math.ceil((Number(item.value) || 1) * DELIVERY));

export async function catalogue() {
  const cache = getItemCache(), out = [];
  for (const id of await stockedItemIds()) {
    const item = cache.get(id), shelf = shelfOf(item);
    if (!shelf) continue;
    out.push({ id, name: item.name, shelf, price: priceOf(item), note: item.tags?.description || null });
  }
  return out.sort((a, b) => a.shelf.localeCompare(b.shelf) || a.name.localeCompare(b.name));
}

export async function cmdKitchenStock(args, raw, player) {
  if (!inKitchen(player)) return { type: 'error', message: `You need to be in a kitchen to have things delivered.` };
  return { type: 'kitchen_stock', items: await catalogue(), credits: player.credits ?? 0 };
}

export async function cmdKitchenOrder(args, raw, player) {
  if (!inKitchen(player)) return { type: 'error', message: `You need to be in a kitchen to have things delivered.` };
  const [id, q] = args;
  const qty = Math.max(1, Math.min(MAX_QTY, parseInt(q, 10) || 1));
  const row = (await catalogue()).find(c => c.id === id);
  if (!row) return { type: 'error', message: `Nobody delivers that.` };
  const cost = row.price * qty;
  const ok = await withTransaction(async (exec) => {
    if (!(await adjustCredits(player, -cost, exec, 'cooking:delivery'))) return false;
    await giveItemById(player.id, id, qty, { q: exec });
    return true;
  });
  if (!ok) return { type: 'error', message: `That's ₵${cost}, and you've got ₵${player.credits ?? 0}.` };
  return { type: 'output', message: `A runner drops off ${qty > 1 ? `${qty} × ${row.name}` : `the ${row.name}`}. ₵${cost}.` };
}
