// Cooking — `heat <food>` at a stove (flags.stove_tier) in the room, or a
// carried portable oven (tags.portable_oven), turns raw/frozen food into
// something safe to eat. Background/lazy, no tick — see cook.js.
// Verb note: `cook` already belongs to the synthesis plugin (drug-cooking
// minigames) — `heat` avoids that collision entirely.
import { getZoneFurniture } from '../../server/engine/world.js';
import { getZonePowerStatus } from '../../server/engine/environment.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { tagValue } from '../../server/engine/tags.js';
import { isPluggedIn } from '../appliances/index.js';
import { STOVE_SPEED, PORTABLE_OVEN_SPEED, PORTABLE_OVEN_CAPACITY_G } from './config.js';
import { startCook, checkCooking } from './cook.js';

function stovesInZone(zoneId) {
  return getZoneFurniture(zoneId).filter(f => f.flags?.stove_tier);
}
function findFreeStove(stoves) {
  const now = Date.now();
  return stoves.find(f => !f.flags?.busy_until || f.flags.busy_until <= now) || null;
}

async function cmdHeat(args, raw, player, broadcast) {
  const nameStr = args.join(' ').trim();
  if (!nameStr) return { type: 'error', message: 'Heat what?' };
  const foodRow = await resolveInventoryItem(player, { name: nameStr, topLevel: true });
  if (!foodRow) return { type: 'error', message: `You don't have "${nameStr}".` };
  const food = { ...foodRow, id: foodRow.inv_id, player_id: player.id };

  const stoves = stovesInZone(player.current_zone);
  let appliance = null;

  if (stoves.length) {
    const stove = findFreeStove(stoves);
    if (!stove) return { type: 'error', message: `Every stove here is already in use.` };
    if (stove.power_draw_kw != null) {
      const powered = ['powered', 'overloaded'].includes(getZonePowerStatus(player.current_zone));
      if (!powered || !isPluggedIn(stove)) {
        return { type: 'error', message: `The ${stove.name} clicks but doesn't heat — no power reaching it.` };
      }
    }
    appliance = { id: stove.id, name: stove.name, speed: STOVE_SPEED[stove.flags.stove_tier] || STOVE_SPEED.low, furnitureRow: stove };
  } else {
    const oven = await resolveInventoryItem(player, { tag: 'portable_oven', topLevel: true });
    if (!oven) return { type: 'error', message: `There's no stove here, and you're not carrying a portable oven.` };
    appliance = { id: oven.inv_id, name: oven.name, speed: PORTABLE_OVEN_SPEED, capacityG: tagValue(oven, 'oven_capacity_g', PORTABLE_OVEN_CAPACITY_G) };
  }

  const r = await startCook(food, appliance, player);
  if (r.error) return { type: 'error', message: r.error };
  broadcast?.(player.current_zone, { type: 'zone_event', message: `${player.handle} starts cooking something.` }, player.id);
  return { type: 'output', message: r.message };
}

export const commands = { heat: cmdHeat };
export const hooks = { 'item.checkCooking': (invRow) => checkCooking(invRow) };

// Exposed for the regression harness.
export const _test = { findFreeStove, stovesInZone };
