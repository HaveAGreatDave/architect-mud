/**
 * Food plugin — registers EAT as a tag-gated specialized action (edible → Eat,
 * keyed on the existing `consumable` tag). Resolves the named item, confirms it
 * carries the tag, then delegates the actual effect to the engine's cmdUse. If
 * nothing edible matches, it returns undefined so the built-in eat handler runs
 * as a fallback (e.g. for drugs, which cmdUse resolves separately).
 */
import { query } from '../../server/models/db.js';
import { hasTag } from '../../server/engine/tags.js';
import { cmdUse } from '../../server/engine/commands/inventory.js';

async function eat(args, raw, player) {
  const targetStr = args.join(' ');
  if (!targetStr) return undefined;
  const { rows } = await query(
    `SELECT i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id
     WHERE pi.player_id=$1 AND i.name ILIKE $2 LIMIT 1`,
    [player.id, `%${targetStr}%`]
  );
  if (!rows.length || !hasTag(rows[0], 'consumable')) return undefined;
  return cmdUse(targetStr, player);
}

export const specializedActions = [
  { verb: 'eat', requiredTag: 'consumable', handler: eat },
];
