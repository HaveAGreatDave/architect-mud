/**
 * Food plugin — registers EAT as a tag-gated specialized action (edible → Eat,
 * keyed on the existing `consumable` tag). Resolves the named item, confirms it
 * carries the tag, then delegates the actual effect to the engine's cmdUse. If
 * nothing edible matches, it returns undefined so the built-in eat handler runs
 * as a fallback (e.g. for drugs, which cmdUse resolves separately).
 */
import { hasTag } from '../../server/engine/tags.js';
import { cmdUse } from '../../server/engine/commands/inventory.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';

async function eat(args, raw, player) {
  const targetStr = args.join(' ');
  if (!targetStr) return undefined;
  const row = await resolveInventoryItem(player, { name: targetStr, topLevel: false });
  if (!row || !hasTag(row, 'consumable')) return undefined;
  return cmdUse(targetStr, player);
}

export const specializedActions = [
  { verb: 'eat', requiredTag: 'consumable', handler: eat },
];
