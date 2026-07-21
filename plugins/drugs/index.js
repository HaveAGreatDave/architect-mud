/**
 * Drugs plugin — registers USE and INJECT as tag-gated specialized actions
 * (drug → Use/Inject). Both resolve a carried drug (an item with a row in the
 * drugs table) and delegate the effect to the engine's cmdUse, which applies
 * the drug and consumes it. `use` returns undefined when nothing drug-like
 * matches, so the built-in use path (cosmetic machines, consumables) still runs.
 */
import { query } from '../../server/models/db.js';
import { cmdUse } from '../../server/engine/commands/inventory.js';

async function findDrug(targetStr, player) {
  if (!targetStr) return false;
  const { rows } = await query(
    `SELECT pi.id FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id
     JOIN drugs d ON d.item_id = i.id
     WHERE pi.player_id=$1 AND (i.name ILIKE $2 OR pi.custom_data->>'name' ILIKE $2) LIMIT 1`,
    [player.id, `%${targetStr}%`]
  );
  return rows.length > 0;
}

// The route is the verb: injecting collapses the come-up and hits harder than
// swallowing the same dose. useDrug owns that law and quietly falls back to the
// neutral route for a drug that isn't flagged injectable, so `inject` on a pill
// still works — it just doesn't get the needle's speed.
const useVia = (route) => async (args, raw, player, broadcast) => {
  const targetStr = args.join(' ');
  if (!(await findDrug(targetStr, player))) return undefined;
  return cmdUse(targetStr, player, broadcast, route);
};

export const specializedActions = [
  { verb: 'use', requiredTag: 'drug', handler: useVia('use') },
  { verb: 'inject', requiredTag: 'drug', handler: useVia('inject') },
];
