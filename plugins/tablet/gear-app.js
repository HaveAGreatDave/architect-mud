// Tablet OS — Gear app. A tablet-native view of the equipment screen: the worn
// loadout on a Vitruvian paperdoll, per-region soak, passive effects, and the
// carried-item tray — with the same drag-to-equip / drop-off interactions the
// desktop Inventory + Gear panels have. It reuses cmdGear/cmdInventory (for the
// data) and cmdEquipById/cmdUnequipById/cmdDropById (for the actions), all from
// server/engine/commands/inventory.js, so behaviour is identical to the desktop
// panels — one source of truth. The client (panels/tablet-os.js renderGear) draws
// the silhouette, per-slot boxes, layer selector, and tray.
import { registerTabletApp } from './registry.js';
import { cmdGear, cmdInventory, cmdEquipById, cmdUnequipById, cmdDropById } from '../../server/engine/commands/inventory.js';

async function buildGear(player) {
  const g = await cmdGear(player);          // equipped pieces (soak) + effects + carry
  const inv = await cmdInventory(player);   // full carried list → the tray
  return {
    view: 'gear',
    sex: player.biological_sex === 'female' ? 'female' : 'male',  // doll silhouette
    items: g.items,                         // equippable subset (the doll reads equipped)
    inventory: inv.items || [],             // every carried item (tray = unequipped subset)
    effects: g.effects,
    weight: g.weight,
    capacity: g.capacity,
  };
}

registerTabletApp({
  id: 'gear',
  name: 'Gear',
  icon: '🧥',
  category: 'General',
  buildScreen(player) {
    return buildGear(player);
  },
  // Drag/drop + drop-off route through here so one round trip both mutates and
  // returns the refreshed screen. params: "<inventoryId> [qty]".
  async handleAction(player, actionId, params, broadcast) {
    // Inventory row ids are UUIDs — pass the string straight through (a parseInt
    // here yields NaN and silently drops every equip/unequip/drop). Only qty is numeric.
    const [id, qtyStr] = String(params || '').trim().split(/\s+/);
    if (id) {
      if (actionId === 'equip') await cmdEquipById(id, player, broadcast);
      else if (actionId === 'unequip') await cmdUnequipById(id, player);
      else if (actionId === 'drop') await cmdDropById(id, player, broadcast, parseInt(qtyStr, 10) || 0);
    }
    return buildGear(player);
  },
});
