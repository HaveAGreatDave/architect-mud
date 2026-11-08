/**
 * Water plugin. Registers DRINK as a tag-gated specialized action for furniture
 * carrying the `water_source` capability (sinks, fountains, wells, ...). The verb
 * is blind to what the furniture actually is; it only asks the room for the
 * capability. Resolves a named (or any) water-source furniture in the zone,
 * confirms the tag, restores thirst, then persists. If no water source matches,
 * it returns undefined so the built-in drink handler runs as a fallback (e.g.
 * drinking a water bottle from inventory via cmdUse).
 *
 * `drink water` is different: it names no source, so it looks for the easiest
 * clean water in reach without leaving the room. See seekWater.
 *
 * Washing at a water source is handled engine-side: mis.js's wash/wash-hands
 * now recognise the same `water_source` capability (not just object_type='sink'),
 * so the existing cleaning logic stays the single source of truth.
 */
import { query } from '../../server/models/db.js';
import { hasTag, tagValue } from '../../server/engine/tags.js';
import { applyThirst } from '../../server/engine/bodily.js';
import { slakeLine, portionLine } from '../../server/engine/appetite.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { getZone, getZoneFurniture } from '../../server/engine/world.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { finishConsumeItem } from '../../server/engine/commands/inventory.js';
import { isToilet } from '../bodily/index.js';

const DEFAULT_RESTORE = 50;

// `drink water`, as the automation guide's example trigger writes it.
const ASKS_FOR_WATER = /^(?:(?:some|the)\s+)?water$/i;

// Plenty of sinks are called "the kitchen sink".
const bareName = (name) => (name || '').replace(/^(?:an?|the)\s+/i, '');

// Restore thirst from a source with no portion size, and say how it went.
async function swallow(source, player) {
  const amount = tagValue(source, 'restore_thirst', DEFAULT_RESTORE);
  const before = player.thirst || 0;
  applyThirst(player, amount);
  await query('UPDATE players SET thirst=$1, hydration_load=$2 WHERE id=$3',
    [player.thirst, player.hydration_load || 0, player.id]);
  // A tap is the one drink with no portion size, so it is also the one where a
  // player can stand there swallowing with the meter already full. Say so, in the
  // same words the `use` path uses.
  return `${slakeLine(player)}${portionLine('thirst', (player.thirst || 0) - before, amount)}`;
}

// bodily owns the filth state, so we ask it over the action registry.
const contaminationOf = (furniture) =>
  dispatchAction({ type: 'bodily.toiletContamination', params: { furnitureId: furniture.id } });

/**
 * `drink water`: the easiest clean water in reach, without leaving the room.
 * Carried first, and a container before a bottle, because a bottle is spent by
 * drinking it. Then the room's furniture, then the room itself, since a transient
 * zone can't hold furniture and carries `water_source` on its own flags.
 *
 * Toilet water never counts here, flushed or not, and nor does anything fouled.
 * Naming it still works: `drink toilet` is a decision, and this verb isn't.
 */
async function seekWater(player, broadcast) {
  // Checked first, or a full meter spends a bottle for nothing.
  if ((player.thirst || 0) >= 100) return { type: 'error', message: `You're not thirsty.` };

  const carried = await resolveInventoryItem(player, { tag: ['fillable', 'potable'], all: true });
  const container = await dispatchAction({
    type: 'fillable.drinkCarriedWater', actor: player, params: { rows: carried }, context: { broadcast },
  });
  if (container) return container;

  const bottle = carried.find(r => hasTag(r, 'potable') && !r.custom_data?.packaged);
  if (bottle) {
    const drunk = await finishConsumeItem(player, bottle.inv_id, broadcast, { takeLine: `You drink ${bottle.name}.` });
    if (drunk) return drunk;
  }

  for (const f of getZoneFurniture(player.current_zone)) {
    if (!hasTag(f, 'water_source') || isToilet(f)) continue;
    const contam = await contaminationOf(f);
    if (contam?.fouled || contam?.peed) continue;
    const slake = await swallow(f, player);
    return { type: 'use', message: `You drink from the ${bareName(f.name)}. ${slake}`, player_update: { thirst: player.thirst } };
  }

  const zoneFlags = getZone(player.current_zone)?.flags;
  if (zoneFlags?.water_source) {
    const slake = await swallow({ flags: zoneFlags }, player);
    return { type: 'use', message: `You drink the water here. ${slake}`, player_update: { thirst: player.thirst } };
  }

  return { type: 'error', message: `You can't find any clean water here.` };
}

async function drinkFrom(args, raw, player, broadcast) {
  const target = args.join(' ').replace(/^(from|at)\s+/i, '').trim();
  if (ASKS_FOR_WATER.test(target)) return seekWater(player, broadcast);

  // The room's furniture is already in memory (world.furniture, write-funneled),
  // so finding the tap costs nothing rather than a round trip per `drink`.
  const here = getZoneFurniture(player.current_zone);
  const needle = target.toLowerCase();
  const furniture = target
    ? here.find(f => (f.name || '').toLowerCase().includes(needle))
    : here.find(f => f.flags && 'water_source' in f.flags);
  if (!furniture || !hasTag(furniture, 'water_source')) return undefined; // fall through

  const slake = await swallow(furniture, player);
  const name = bareName(furniture.name);

  // A fouled/peed toilet still holds water_source, but that water is foul: you
  // drink (thirst restored above) and catch something.
  const contam = await contaminationOf(furniture);
  if (contam?.fouled || contam?.peed) {
    const foul = await dispatchAction({ type: 'bodily.drinkContaminated', actor: player, params: { fouled: contam.fouled } });
    return {
      type: 'use',
      message: `You drink from the ${name}. ${slake} ${foul.message}`,
      player_update: { thirst: player.thirst },
    };
  }

  return {
    type: 'use',
    message: `You drink from the ${name}. ${slake}`,
    player_update: { thirst: player.thirst },
  };
}

export const specializedActions = [
  { verb: 'drink', requiredTag: 'water_source', handler: drinkFrom },
];
