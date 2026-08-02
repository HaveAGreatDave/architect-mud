/**
 * `preserve <food>` — dose a perishable with an antioxidant so it stops going
 * off so fast.
 *
 * The reagent this spends is `item_stabilizer`, a vial of butylated
 * hydroxytoluene. That is deliberate and it is the whole point of the verb: BHT
 * is a real compound with exactly two real jobs — it keeps a synthesised
 * compound from tearing itself apart, and it keeps fats from going rancid on a
 * shelf. The splice bench already knew about the first one. This is the second,
 * so the expensive vial in your bag is a chemical rather than a quest token.
 *
 * Rules worth keeping:
 *  - It is a RATE multiplier, never a top-up. Nothing in this file writes
 *    `freshness.value` upward; rot already underway is refused outright
 *    (ADDITIVE_MIN_FRESHNESS) instead of being sold back to the player.
 *  - It stacks with refrigeration rather than replacing it — the dose lands in
 *    decayMultiplier alongside the tier factor, so a dosed pie in a fridge is
 *    better off than either alone.
 *  - The dose lives on the inventory row's custom_data, which means it travels
 *    with the food into a pack, a cold box, or somebody else's hands via trade.
 */
import { query } from '../../server/models/db.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { hasTag } from '../../server/engine/tags.js';
import { ensureFreshnessCurrent } from './decay.js';
import { ADDITIVE_FACTOR, ADDITIVE_MIN_FRESHNESS, stateFor } from './config.js';

const sys = (s) => `<span class="msg-system">${s}</span>`;
const dim = (s) => `<span class="text-dim">${s}</span>`;

export async function cmdPreserve(args, raw, player) {
  const targetStr = args.join(' ').trim();
  if (!targetStr) return { type: 'output', message: sys('Preserve what?') };

  const vial = await resolveInventoryItem(player, { tag: 'preservative', topLevel: false });
  if (!vial) {
    return { type: 'output', message: sys("You've nothing to preserve it with. That takes an antioxidant — a vial of BHT, if you can find one.") };
  }

  const food = await resolveInventoryItem(player, { name: targetStr, topLevel: false });
  if (!food) return { type: 'output', message: sys(`You aren't carrying any "${targetStr}".`) };
  if (!hasTag(food, 'perishable')) {
    return { type: 'output', message: sys(`The ${food.name} isn't going to spoil. Save the vial for something that will.`) };
  }

  // Checkpoint first: the dose must not retroactively slow the hours this thing
  // already spent sweating on a counter. ensureFreshnessCurrent wants a raw
  // player_inventory row (`id`, `container_id`) and resolveInventoryItem hands
  // back the presentation shape (`inv_id`, no container), so read the two
  // columns it needs — this is a cold verb, not a hot path.
  const { rows: [raw_] } = await query('SELECT id, container_id, custom_data FROM player_inventory WHERE id=$1', [food.inv_id]);
  const foodRow = { ...raw_, tags: food.tags };
  const fresh = await ensureFreshnessCurrent(foodRow, player);
  const value = fresh?.value ?? 100;

  if (foodRow.custom_data?.freshness?.additive != null) {
    return { type: 'output', message: sys(`The ${food.name} has already been dosed. A second vial would just make it taste of aspirin.`) };
  }
  if (value < ADDITIVE_MIN_FRESHNESS) {
    return {
      type: 'output',
      message: sys(`The ${food.name} is already ${stateFor(value)}. An antioxidant slows rot; it doesn't argue with rot that has already won.`),
    };
  }

  await query(
    `UPDATE player_inventory
        SET custom_data = COALESCE(custom_data,'{}'::jsonb)
          || jsonb_build_object('freshness', COALESCE(custom_data->'freshness','{}'::jsonb) || jsonb_build_object('additive', $2::numeric))
      WHERE id=$1`,
    [food.inv_id, ADDITIVE_FACTOR]
  );

  // Spend the vial — one dose, whatever the stack it went into.
  if ((vial.quantity ?? 1) > 1) {
    await query('UPDATE player_inventory SET quantity = quantity - 1 WHERE id=$1', [vial.inv_id]);
  } else {
    await query('DELETE FROM player_inventory WHERE id=$1', [vial.inv_id]);
  }

  const many = (food.quantity ?? 1) > 1 ? ` <span class="text-dim">(all ${food.quantity} of them)</span>` : '';
  return {
    type: 'output',
    message: sys(`You work the BHT through the ${food.name}${many}. It tastes of nothing, which is the entire idea.`)
      + `\n${dim('It will keep for a great deal longer now, wherever you put it.')}`,
  };
}

export const _test = { cmdPreserve };
