// ROLLING — turn loose leaf into smokeables.
//
// Loose cannabis / loose tobacco (content: item_loose_cannabis / item_loose_tobacco,
// stackable, quantity = grams) roll 1 gram → 1 product:
//   cannabis → item_joint      (stackable; merged into an existing stack)
//   tobacco  → item_cigarettes (a hand-rolled loose stack: quantity + custom_data.loose)
//
//   roll                 → roll 1 from whatever loose leaf you carry
//   roll <n> | roll all  → roll n (capped at grams on hand)
//   roll <n> cannabis|tobacco → disambiguate when you carry both
//
// The joint/cigarette items + the loose-leaf drugs are content (scripts/add-loose-leaf.js
// + scripts/add-joints.js + scripts/add-cigarettes.js); this plugin only owns the verb.
import { query, withTransaction } from '../../server/models/db.js';
import { randomUUID } from 'crypto';

// loose material → smokeable product. 1 unit of quantity (1 gram) makes 1 product.
const ROLLABLE = {
  cannabis: { loose: 'item_loose_cannabis', product: 'item_joint', stack: true, one: 'a joint', many: 'joints' },
  tobacco: { loose: 'item_loose_tobacco', product: 'item_cigarettes', stack: false, one: 'a cigarette', many: 'cigarettes' },
};
const ALIASES = {
  cannabis: 'cannabis', weed: 'cannabis', pot: 'cannabis', bud: 'cannabis', grass: 'cannabis', joint: 'cannabis', joints: 'cannabis',
  tobacco: 'tobacco', cig: 'tobacco', cigs: 'tobacco', cigarette: 'tobacco', cigarettes: 'tobacco', dart: 'tobacco', darts: 'tobacco',
};

async function looseRow(playerId, itemId) {
  const { rows } = await query(
    'SELECT id, quantity FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND is_equipped=0 ORDER BY quantity DESC LIMIT 1',
    [playerId, itemId]
  );
  return rows[0] || null;
}

async function cmdRoll(args, raw, player, broadcast) {
  // parse: roll [n|all] [cannabis|tobacco]
  let count = null, kind = null;
  for (const a of (args || [])) {
    const low = String(a).toLowerCase();
    if (low === 'all') count = 'all';
    else if (/^\d+$/.test(low)) count = parseInt(low, 10);
    else if (ALIASES[low]) kind = ALIASES[low];
  }

  const canna = await looseRow(player.id, ROLLABLE.cannabis.loose);
  const toba = await looseRow(player.id, ROLLABLE.tobacco.loose);

  let key;
  if (kind) key = kind;
  else if (canna && !toba) key = 'cannabis';
  else if (toba && !canna) key = 'tobacco';
  else if (canna && toba) return { type: 'error', message: 'Roll which — cannabis or tobacco? (e.g. "roll 3 cannabis")' };
  else return { type: 'error', message: "You've no loose cannabis or tobacco to roll." };

  const target = ROLLABLE[key];
  const row = key === 'cannabis' ? canna : toba;
  if (!row || row.quantity < 1) return { type: 'error', message: `You've no loose ${key} to roll.` };

  const avail = row.quantity;
  let n = count === 'all' ? avail : (count == null ? 1 : count);
  n = Math.max(1, Math.min(avail, n));

  await withTransaction(async (q) => {
    // consume n grams of loose leaf
    if (avail <= n) await q('DELETE FROM player_inventory WHERE id=$1', [row.id]);
    else await q('UPDATE player_inventory SET quantity=quantity-$1 WHERE id=$2', [n, row.id]);
    // produce n products
    if (target.stack) {
      const { rows: ex } = await q('SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND is_equipped=0 LIMIT 1', [player.id, target.product]);
      if (ex[0]) await q('UPDATE player_inventory SET quantity=quantity+$1 WHERE id=$2', [n, ex[0].id]);
      else await q('INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,$4,1.0)', [randomUUID(), player.id, target.product, n]);
    } else {
      // hand-rolled cigarettes: a loose (non-pack) stack, smoked one at a time
      await q('INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, custom_data) VALUES ($1,$2,$3,$4,1.0,$5)', [randomUUID(), player.id, target.product, n, JSON.stringify({ loose: true, handrolled: true })]);
    }
  });

  const made = n === 1 ? target.one : `${n} ${target.many}`;
  const left = avail - n;
  return {
    type: 'output',
    message: `<span class="ip-gain">You roll ${made}</span> from ${n} gram${n === 1 ? '' : 's'} of loose ${key}.${left > 0 ? ` <span class="msg-system">(${left}g left.)</span>` : ''}`,
  };
}

export const commands = { roll: cmdRoll };
