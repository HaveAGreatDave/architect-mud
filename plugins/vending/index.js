// VENDING — dumb dispenser furniture. A machine in the room carries `flags.vends`
// (an item id); `vend` drops one into your bag and coughs a line to the room.
// Fully data-driven so any dispenser reuses it:
//   flags.vends            the item id to dispense (required)
//   flags.vend_line        flavour shown to the vender (optional)
//   flags.vend_cooldown_s  per-machine throttle in seconds (optional; 0 = off).
//                          Defaults to 60 for a machine that has to MAKE the thing
//                          it hands over (see vend_drink) and 20 for one that just
//                          drops a packet.
//   flags.vend_drink       a drinks recipe key. The dispenser fills the vessel it
//                          hands you instead of handing it over empty, and charges
//                          for it. Everything about what that means lives in
//                          plugins/drinks — see FILL_ACTION below.
//   flags.vend_price       flat price override, read by that plugin (0 = free).
// The clone-facility soylent dispenser is the first customer — free, joyless food
// so a fresh clone isn't dead of hunger before it reaches the street.
import { query, withTransaction } from '../../server/models/db.js';
import { dispatchAction, getRegisteredActions } from '../../server/engine/actions.js';
import { isStackable } from '../../server/engine/tags.js';
import { getZoneFurniture } from '../../server/engine/world.js';
import { getItem } from '../../server/engine/items-cache.js';
import { isPluggedIn } from '../appliances/index.js';
import { randomUUID } from 'crypto';

// playerId:furnitureId -> last-vend timestamp. In-memory: a soft anti-spam guard,
// not persisted (a restart forgives it, which is fine for grey slurry).
const lastVend = new Map();

// The seam a filling dispenser goes through. Named once so the guard and the
// dispatch cannot drift apart, and guarded at all because dispatchAction
// answers an unregistered type with an ERROR object rather than silence.
const FILL_ACTION = 'drinks.serveVended';

// Pulling a cup takes a machine longer than dropping a packet, and a coffee
// you can buy every twenty seconds is a hot-drink faucet in a cold snap.
// Derived from whether the machine makes anything, so a sixth espresso rig
// authored next year gets the minute without anybody remembering to type it.
const MAKE_COOLDOWN_S = 60;
const DROP_COOLDOWN_S = 20;

async function cmdVend(args, raw, player, broadcast) {
  // A ROOM MAY HOLD MORE THAN ONE. This used to take the first machine it found,
  // which was fine while the only dispenser in the game was the lone one in the
  // clone facility — but it makes every dispenser after the first in a room
  // unreachable, with no error to say so. `vend <name>` picks; a bare `vend` in a
  // room of several lists them rather than silently choosing for you.
  const machines = getZoneFurniture(player.current_zone).filter(f => f.flags?.vends != null);
  if (!machines.length) return { type: 'error', message: "There's no dispenser here to vend from." };

  const want = (args || []).join(' ').trim().toLowerCase();
  let machine;
  if (want) {
    const hits = machines.filter(f => String(f.name || '').toLowerCase().includes(want));
    if (!hits.length) return { type: 'error', message: `There's no "${want}" here to vend from.` };
    if (hits.length > 1) return { type: 'error', message: `Which one? ${hits.map(f => f.name).join(', ')}.` };
    machine = hits[0];
  } else if (machines.length > 1) {
    return { type: 'output', message: `Several machines here. VEND what? ${machines.map(f => `<span class="item">${f.name}</span>`).join(', ')}.` };
  } else {
    machine = machines[0];
  }
  if (!isPluggedIn(machine)) return { type: 'error', message: `You press the button, but nothing happens. The ${machine.name} must be broken.` };
  const itemId = machine.flags?.vends;

  const defaultCooldown = machine.flags?.vend_drink ? MAKE_COOLDOWN_S : DROP_COOLDOWN_S;
  const cooldownMs = Math.max(0, Number(machine.flags?.vend_cooldown_s ?? defaultCooldown)) * 1000;
  const key = `${player.id}:${machine.id}`;
  const now = Date.now();
  if (cooldownMs && now - (lastVend.get(key) || 0) < cooldownMs) {
    return { type: 'error', message: `The ${machine.name} whirs and resets — it needs a moment before it'll serve you again.` };
  }

  const item = getItem(itemId);
  if (!item) return { type: 'error', message: `The ${machine.name} grinds emptily. Whatever it once dispensed is long gone.` };
  const stack = isStackable(item);

  let invId = null;
  await withTransaction(async (q) => {
    let existing = [];
    if (stack) {
      const r = await q('SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND is_equipped=0 LIMIT 1', [player.id, item.id]);
      existing = r.rows;
    }
    if (existing.length) await q('UPDATE player_inventory SET quantity=quantity+1 WHERE id=$1', [existing[0].id]);
    else {
      invId = randomUUID();
      await q('INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,1,1.0)', [invId, player.id, item.id]);
    }
  });

  // SOME DISPENSERS FILL WHAT THEY HAND YOU. An espresso rig makes the cup AND
  // puts a coffee in it, which this plugin deliberately knows nothing about: it
  // offers the row it just made to whoever owns drinks, and that plugin decides
  // the recipe, the quality, the heat and the price. A machine with no
  // `vend_drink`, or a world with the drinks plugin unloaded, gets undefined
  // back and carries on dispensing an empty cup exactly as it always did.
  //
  // A REFUSAL UNDOES THE DISPENSE. You can't afford it, so you never had it —
  // and the cooldown below is armed only on the way out, so a machine that
  // wouldn't serve you hasn't started its minute either.
  let filled;
  if (invId && getRegisteredActions().includes(FILL_ACTION)) {
    filled = await dispatchAction({ type: FILL_ACTION, actor: player, params: { invId, machine, item } });
    if (filled && filled.ok === false) {
      await query('DELETE FROM player_inventory WHERE id=$1', [invId]).catch(() => {});
      return { type: 'error', message: filled.message || `The ${machine.name} declines.` };
    }
  }
  lastVend.set(key, now);

  const flavour = machine.flags?.vend_line || `The ${machine.name} clunks and drops something into the tray.`;
  const got = filled?.name || item.name;
  broadcast(player.current_zone, { type: 'zone_event', message: `The ${machine.name} clunks and coughs a ${got} into the tray for ${player.handle}.` }, player.id);
  // A FILLED VESSEL REPLACES THE TAIL rather than following it: "you take the
  // paper cup" and then "a flat white" is the same cup described twice, in the
  // wrong order. The machine's own vend_line has already said a cup arrived.
  const tail = filled?.note || `You take the <span class="item">${item.name}</span>.`;
  return { type: 'output', message: `${flavour} ${tail}` };
}

export const commands = { vend: cmdVend };
