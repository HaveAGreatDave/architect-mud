// Pluggable appliances — a generic `flags.plugged_in` concept any powered
// furniture (vending machines, fridges/freezers) can be gated on, plus the
// `power on/off <name>` verb and a shared "looks broken" examine hook.
// Absent/unset `plugged_in` is treated as plugged in, for backward
// compatibility with every furniture row that predates this tag.
// Verb note: `plug`/`unplug`/`connect`/`disconnect` are already the portable
// GENERATOR plugin's verbs (wiring a deployed generator into a junction box) —
// a different concept (a building's power source vs. one appliance's cord),
// so this uses `power on|off <name>` instead of colliding with those.
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

async function cmdPower(args, raw, player, broadcast) {
  const first = (args[0] || '').toLowerCase();
  if (first !== 'on' && first !== 'off') {
    return { type: 'error', message: 'Usage: power on/off <appliance name>' };
  }
  const targetState = first === 'on';
  const nameStr = args.slice(1).join(' ').trim();
  const machine = findPluggable(player.current_zone, nameStr);
  if (!machine) {
    return { type: 'error', message: nameStr
      ? `There's no powered appliance called "${nameStr}" here.`
      : `Power on/off what? There's more than one powered appliance here — name it.` };
  }
  const already = isPluggedIn(machine);
  if (already === targetState) {
    return { type: 'message', message: `The ${machine.name} is already ${targetState ? 'plugged in' : 'unplugged'}.` };
  }
  await updateFurniture(machine.id, { flags: JSON.stringify({ ...machine.flags, plugged_in: targetState }) });
  broadcast?.(player.current_zone, { type: 'zone_event', message: `${player.handle} ${targetState ? 'plugs in' : 'unplugs'} the ${machine.name}.` }, player.id);
  return { type: 'output', message: `You ${targetState ? 'plug in' : 'unplug'} the ${machine.name}.` };
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
export const _test = { findPluggable, cmdPower };
