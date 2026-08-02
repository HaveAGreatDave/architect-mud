/**
 * Water plugin — registers DRINK as a tag-gated specialized action for furniture
 * carrying the `water_source` capability (sinks, fountains, wells, …). The verb
 * is blind to what the furniture actually is; it only asks the room for the
 * capability. Resolves a named (or any) water-source furniture in the zone,
 * confirms the tag, restores thirst, then persists. If no water source matches,
 * it returns undefined so the built-in drink handler runs as a fallback (e.g.
 * drinking a water bottle from inventory via cmdUse).
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

const DEFAULT_RESTORE = 50;

async function drinkFrom(args, raw, player) {
  const target = args.join(' ').replace(/^(from|at)\s+/i, '').trim();

  const { rows } = target
    ? await query(
        `SELECT * FROM furniture WHERE zone_id=$1 AND name ILIKE $2 LIMIT 1`,
        [player.current_zone, `%${target}%`])
    : await query(
        `SELECT * FROM furniture WHERE zone_id=$1 AND jsonb_exists(flags,'water_source') LIMIT 1`,
        [player.current_zone]);

  const furniture = rows[0];
  if (!furniture || !hasTag(furniture, 'water_source')) return undefined; // fall through

  const amount = tagValue(furniture, 'restore_thirst', DEFAULT_RESTORE);
  const before = player.thirst || 0;
  applyThirst(player, amount);
  // A tap is the one drink with no portion size, so it is also the one where a
  // player can stand there swallowing with the meter already full. Say so, in the
  // same words the `use` path uses.
  const slake = `${slakeLine(player)}${portionLine('thirst', (player.thirst || 0) - before, amount)}`;
  await query('UPDATE players SET thirst=$1, hydration_load=$2 WHERE id=$3',
    [player.thirst, player.hydration_load || 0, player.id]);

  // A fouled/peed toilet still holds water_source, but that water is foul: you
  // drink (thirst restored above) and catch something. bodily owns the filth
  // state + the sickness — we just ask it over the action registry.
  const contam = await dispatchAction({ type: 'bodily.toiletContamination', params: { furnitureId: furniture.id } });
  if (contam?.fouled || contam?.peed) {
    const foul = await dispatchAction({ type: 'bodily.drinkContaminated', actor: player, params: { fouled: contam.fouled } });
    return {
      type: 'use',
      message: `You drink from the ${furniture.name}. ${slake} ${foul.message}`,
      player_update: { thirst: player.thirst },
    };
  }

  return {
    type: 'use',
    message: `You drink from the ${furniture.name}. ${slake}`,
    player_update: { thirst: player.thirst },
  };
}

export const specializedActions = [
  { verb: 'drink', requiredTag: 'water_source', handler: drinkFrom },
];
