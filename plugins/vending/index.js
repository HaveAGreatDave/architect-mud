// VENDING — dumb dispenser furniture. A machine in the room carries `flags.vends`
// (an item id); `vend` drops one into your bag and coughs a line to the room.
// Fully data-driven so any dispenser reuses it:
//   flags.vends            the item id to dispense (required)
//   flags.vend_line        flavour shown to the vender (optional)
//   flags.vend_cooldown_s  per-machine throttle in seconds (optional, default 20; 0 = off)
// The clone-facility soylent dispenser is the first customer — free, joyless food
// so a fresh clone isn't dead of hunger before it reaches the street.
import { withTransaction } from '../../server/models/db.js';
import { isStackable } from '../../server/engine/tags.js';
import { getZoneFurniture } from '../../server/engine/world.js';
import { getItem } from '../../server/engine/items-cache.js';
import { randomUUID } from 'crypto';

// playerId:furnitureId -> last-vend timestamp. In-memory: a soft anti-spam guard,
// not persisted (a restart forgives it, which is fine for grey slurry).
const lastVend = new Map();

async function cmdVend(args, raw, player, broadcast) {
  const machine = getZoneFurniture(player.current_zone).find(f => f.flags?.vends != null);
  if (!machine) return { type: 'error', message: "There's no dispenser here to vend from." };
  const itemId = machine.flags?.vends;

  const cooldownMs = Math.max(0, Number(machine.flags?.vend_cooldown_s ?? 20)) * 1000;
  const key = `${player.id}:${machine.id}`;
  const now = Date.now();
  if (cooldownMs && now - (lastVend.get(key) || 0) < cooldownMs) {
    return { type: 'error', message: `The ${machine.name} whirs and resets — it needs a moment before it'll serve you again.` };
  }

  const item = getItem(itemId);
  if (!item) return { type: 'error', message: `The ${machine.name} grinds emptily. Whatever it once dispensed is long gone.` };
  const stack = isStackable(item);

  await withTransaction(async (q) => {
    let existing = [];
    if (stack) {
      const r = await q('SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND is_equipped=0 LIMIT 1', [player.id, item.id]);
      existing = r.rows;
    }
    if (existing.length) await q('UPDATE player_inventory SET quantity=quantity+1 WHERE id=$1', [existing[0].id]);
    else await q('INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,1,1.0)', [randomUUID(), player.id, item.id]);
  });
  lastVend.set(key, now);

  const flavour = machine.flags?.vend_line || `The ${machine.name} clunks and drops something into the tray.`;
  broadcast(player.current_zone, { type: 'zone_event', message: `The ${machine.name} clunks and coughs a ${item.name} into the tray for ${player.handle}.` }, player.id);
  return { type: 'output', message: `${flavour} You take the <span class="item">${item.name}</span>.` };
}

export const commands = { vend: cmdVend };
