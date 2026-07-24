// Pluggable appliances — a generic `flags.plugged_in` concept any powered
// furniture (vending machines, fridges/freezers) can be gated on, plus the
// `power on/off <name>` verb and a shared "looks broken" examine hook.
// Absent/unset `plugged_in` is treated as plugged in, for backward
// compatibility with every furniture row that predates this tag.
// Verb note: `plug`/`unplug`/`connect`/`disconnect` are already the portable
// GENERATOR plugin's verbs (wiring a deployed generator into a junction box).
// Rather than fight players over the natural "plug in <machine>" phrasing,
// the generator plugin falls through to togglePluggedByName() (exported here)
// whenever it finds no deployed generator matching — see plugins/generator's
// connect/disconnect. `power on/off <name>` is the collision-free alternative
// verb for the same action.
import { getZoneFurniture, updateFurniture } from '../../server/engine/world.js';

// True unless a furniture row has been explicitly unplugged.
export function isPluggedIn(furniture) {
  return furniture?.flags?.plugged_in !== false;
}

function findPluggable(zoneId, nameStr) {
  const candidates = getZoneFurniture(zoneId).filter(f => f.power_draw_kw != null);
  if (!nameStr) return candidates.length === 1 ? candidates[0] : null;
  const needle = nameStr.toLowerCase();
  return candidates.find(f => f.name.toLowerCase().includes(needle)) || null;
}

// Shared core: connects/disconnects a room appliance to the building's own
// supply (its `power_draw_kw` draws from the zone's junction-box-fed grid,
// same as a light — no deployed generator involved). Returns null if no
// matching appliance exists in the room, so a caller (cmdPower, or the
// generator plugin's plug/unplug fallback) can decide its own not-found
// message. `broadcast` is optional (the generator fallback may not have one).
export async function togglePluggedByName(player, nameStr, targetState, broadcast) {
  const machine = findPluggable(player.current_zone, nameStr);
  if (!machine) return null;
  const already = isPluggedIn(machine);
  if (already === targetState) {
    return { type: 'message', message: `The ${machine.name} is already ${targetState ? 'plugged in' : 'unplugged'}.` };
  }
  await updateFurniture(machine.id, { flags: JSON.stringify({ ...machine.flags, plugged_in: targetState }) });
  broadcast?.(player.current_zone, { type: 'zone_event', message: `${player.handle} ${targetState ? 'plugs in' : 'unplugs'} the ${machine.name}.` }, player.id);
  return { type: 'output', message: `You ${targetState ? 'plug in' : 'unplug'} the ${machine.name} — it draws straight off the building's supply.` };
}

async function cmdPower(args, raw, player, broadcast) {
  const first = (args[0] || '').toLowerCase();
  if (first !== 'on' && first !== 'off') {
    return { type: 'error', message: 'Usage: power on/off <appliance name>' };
  }
  const targetState = first === 'on';
  const nameStr = args.slice(1).join(' ').trim();
  const result = await togglePluggedByName(player, nameStr, targetState, broadcast);
  if (result) return result;
  return { type: 'error', message: nameStr
    ? `There's no powered appliance called "${nameStr}" here.`
    : `Power on/off what? There's more than one powered appliance here — name it.` };
}

// Generic "looks broken" flavor for any unplugged powered appliance, surfaced
// on examine via the existing furniture.describe hook.
function onFurnitureDescribe(f) {
  if (f.power_draw_kw == null || isPluggedIn(f)) return undefined;
  return `<span class="text-dim">It's unplugged. Looks broken.</span>`;
}

export const commands = { power: cmdPower };
export const hooks = { 'furniture.describe': onFurnitureDescribe };

// Exposed for the regression harness.
export const _test = { findPluggable, cmdPower, togglePluggedByName };
