// Pluggable appliances — a generic `flags.plugged_in` concept any powered
// furniture (vending machines, fridges/freezers) can be gated on, plus the
// `unplug <name>` verb and a shared "looks broken" examine hook.
// Absent/unset `plugged_in` is treated as plugged in, for backward
// compatibility with every furniture row that predates this tag.
//
// Verb note: the pair is split across two plugins on purpose.
//   plug/connect <name> — owned by the portable GENERATOR plugin (wiring a
//     deployed generator into a junction box). Rather than fight players over
//     the natural "plug in <machine>" phrasing, generator falls through to
//     togglePluggedByName() (exported here) when no deployed generator
//     matches — see plugins/generator's connect/disconnect.
//   unplug <name> — owned here; nothing else claims the bare verb (generator
//     only exposes unplug as a `generator unplug` subcommand).
// This previously used `power on/off <name>`, which the weapon plugin's combat
// verbs later claimed (`pow`/`power`); weapon loads after appliances and won
// the collision outright, silently shadowing it. Combat has the stronger claim
// on that word, so the appliance side moved to the plug/unplug pair instead.
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
// matching appliance exists in the room, so a caller (cmdUnplug, or the
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
  // Only the plug-in side names the building supply — on the way out it's both
  // contradictory and something the player has no use for.
  return { type: 'output', message: targetState
    ? `You plug in the ${machine.name} — it draws straight off the building's supply.`
    : `You unplug the ${machine.name}.` };
}

// `unplug <name>` — pull a room appliance off the building's supply. The
// inverse (`plug <name>`) arrives via the generator plugin's fallback.
async function cmdUnplug(args, raw, player, broadcast) {
  // Tolerate the natural phrasings: "unplug the fridge", "unplug in fridge".
  const nameStr = args.join(' ').trim().replace(/^(the|in)\s+/i, '');
  const result = await togglePluggedByName(player, nameStr, false, broadcast);
  if (result) return result;
  return { type: 'error', message: nameStr
    ? `There's no powered appliance called "${nameStr}" here. (To disconnect a deployed generator, use \`gen disconnect\`.)`
    : `Unplug what? There's more than one powered appliance here — name it.` };
}

// Generic "looks broken" flavor for any unplugged powered appliance, surfaced
// on examine via the existing furniture.describe hook.
function onFurnitureDescribe(f) {
  if (f.power_draw_kw == null || isPluggedIn(f)) return undefined;
  return `<span class="text-dim">It's unplugged. Looks broken.</span>`;
}

export const commands = { unplug: cmdUnplug };
export const hooks = { 'furniture.describe': onFurnitureDescribe };

// Exposed for the regression harness.
export const _test = { findPluggable, cmdUnplug, togglePluggedByName };
