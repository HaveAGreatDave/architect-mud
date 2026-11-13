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
//   flags.vend_price       the price. On a machine with vend_drink it is a flat override
//                          read by the drinks plugin; on a plain dispenser this plugin
//                          charges it itself (0 or absent = free).
// The clone-facility soylent dispenser is the first customer — free, joyless food
// so a fresh clone isn't dead of hunger before it reaches the street.
import { query, withTransaction } from '../../server/models/db.js';
import { dispatchAction, getRegisteredActions } from '../../server/engine/actions.js';
import { isStackable } from '../../server/engine/tags.js';
import { getZoneFurniture } from '../../server/engine/world.js';
import { getItem } from '../../server/engine/items-cache.js';
import { isPluggedIn } from '../appliances/index.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { giveItemById } from '../../server/engine/inventory.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { loggedPanelsSync } from '../../server/engine/presentation.js';
import { heldAs, lighterOf } from '../stands/index.js';

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

// A machine that holds more than one thing: flags.vend_menu, [{ item, price }]. It never runs out;
// the lacquered box in the Solenne Penthouse is the first. `flags.vends` stays its first item, so
// the VEND action still finds it.
const menuOf = (f) => (Array.isArray(f?.flags?.vend_menu) ? f.flags.vend_menu : [])
  .filter(e => e && e.item).map(e => ({ item: String(e.item), price: Math.max(0, Math.round(Number(e.price) || 0)) }));

async function cmdVend(args, raw, player, broadcast) {
  // A ROOM MAY HOLD MORE THAN ONE. This used to take the first machine it found,
  // which was fine while the only dispenser in the game was the lone one in the
  // clone facility — but it makes every dispenser after the first in a room
  // unreachable, with no error to say so. `vend <name>` picks; a bare `vend` in a
  // room of several lists them rather than silently choosing for you.
  const machines = getZoneFurniture(player.current_zone).filter(f => f.flags?.vends != null);
  if (!machines.length) return { type: 'error', message: "There's no dispenser here to vend from." };

  // The Room Stage asks `vend <machine> menu` for the box's menu card (stands.js openStandsMenu), and
  // its button sends `vend <machine> <item_id>`; the id is only the machine's own item, so it just buys.
  const words = (args || []).map(String);
  const last = words[words.length - 1]?.toLowerCase();
  const asMenu = last === 'menu', byId = last?.startsWith('item_');
  if (asMenu || byId) words.pop();
  let want = words.join(' ').trim().toLowerCase();
  let machine, chosen = byId ? last : null;
  // a machine with a menu (flags.vend_menu) can be asked for one thing by name: `vend box redline`
  if (want && !byId && !machines.some(f => String(f.name || '').toLowerCase().includes(want))) {
    for (const f of machines) {
      const hit = menuOf(f).find(e => { const it = getItem(e.item); return it && want.includes(String(it.name).toLowerCase()); });
      if (!hit) continue;
      const rest = want.replace(String(getItem(hit.item).name).toLowerCase(), '').trim();
      if (rest && !String(f.name || '').toLowerCase().includes(rest) && !String(f.flags?.aliases || '').toLowerCase().includes(rest)) continue;
      chosen = hit.item; want = String(f.name).toLowerCase();
      break;
    }
  }
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
  const menu = menuOf(machine);
  if (menu.length) {
    if (asMenu && !loggedPanelsSync(player)) {
      sendToPlayer(player.id, { type: 'stands_menu', target: machine.name, name: machine.name, description: machine.description || '', buy: `vend ${machine.name.toLowerCase()}`, credits: player.credits | 0,
        items: menu.map(e => ({ it: getItem(e.item), price: e.price })).filter(x => x.it).map(({ it, price }) => ({ id: it.id, name: it.name, description: it.tags?.description || it.description || '', price, kind: heldAs(it), drinkable: !!it.tags?.consumable })) });
      return { type: 'noop' };
    }
    if (!chosen) {
      const list = menu.map(e => ({ it: getItem(e.item), price: e.price })).filter(x => x.it).map(({ it, price }) => `<span class="item">${it.name}</span> ₵${price}`).join(', ');
      return { type: 'output', message: `The ${machine.name} holds ${list}. VEND ${machine.name.toUpperCase()} &lt;name&gt; to take one.` };
    }
    if (!menu.some(e => String(e.item).toLowerCase() === String(chosen).toLowerCase())) return { type: 'error', message: `The ${machine.name} doesn't hold that.` };
  }
  const entry = menu.find(e => String(e.item).toLowerCase() === String(chosen || '').toLowerCase()) || null;
  const itemId = entry ? entry.item : machine.flags?.vends;
  if (asMenu) {
    const it = getItem(itemId);
    if (!it || loggedPanelsSync(player)) return cmdVend(words, raw, player, broadcast);
    const held = heldAs(it);
    sendToPlayer(player.id, { type: 'stands_menu', target: machine.name, name: machine.name, description: machine.description || '', buy: `vend ${machine.name.toLowerCase()}`, credits: player.credits | 0,
      items: [{ id: it.id, name: it.name, description: it.tags?.description || it.description || '', price: machine.flags?.vend_drink ? 0 : Math.max(0, Math.round(Number(machine.flags?.vend_price) || 0)), kind: held === 'pour' && it.tags?.consumable ? 'drink' : held, drinkable: !!it.tags?.consumable }] });
    return { type: 'noop' };
  }
  if (byId && !entry && last !== String(itemId).toLowerCase()) return { type: 'error', message: `The ${machine.name} doesn't sell that.` };

  const defaultCooldown = machine.flags?.vend_drink ? MAKE_COOLDOWN_S : DROP_COOLDOWN_S;
  const cooldownMs = Math.max(0, Number(machine.flags?.vend_cooldown_s ?? defaultCooldown)) * 1000;
  const key = `${player.id}:${machine.id}`;
  const now = Date.now();
  if (cooldownMs && now - (lastVend.get(key) || 0) < cooldownMs) {
    return { type: 'error', message: `The ${machine.name} whirs and resets: it needs a moment before it'll serve you again.` };
  }

  const item = getItem(itemId);
  if (!item) return { type: 'error', message: `The ${machine.name} grinds emptily. Whatever it once dispensed is long gone.` };
  const stack = isStackable(item);

  // A PLAIN DISPENSER CAN CHARGE TOO. A drinks machine's price belongs to the drinks
  // plugin (below), so `vend_price` is read here only when there is no `vend_drink`.
  // The debit is inside the same transaction as the dispense: you pay and get the
  // packet, or neither happens.
  const price = machine.flags?.vend_drink ? 0 : Math.max(0, Math.round(Number(entry ? entry.price : machine.flags?.vend_price) || 0));
  let broke = false;
  let invId = null;
  await withTransaction(async (q) => {
    if (price > 0 && !(await adjustCredits(player, -price, q, 'vending:vend'))) { broke = true; return; }
    const given = await giveItemById(player.id, item.id, 1, { stack, q });
    if (given.created) invId = given.id;
  });
  if (broke) return { type: 'error', message: `The ${machine.name} wants ₵${price}, and you haven't got it.` };

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
  // What you can hold goes into your hands in first person, as a box's smokes do (stands-hands.js):
  // the humidor's cigar comes up in front of you to be cut and lit. A filled vessel is the drinks plugin's.
  const held = filled ? null : heldAs(item), kind = held === 'pour' && item.tags?.consumable ? 'drink' : held;
  if (kind && !loggedPanelsSync(player)) sendToPlayer(player.id, { type: 'stands_hand', item: { id: item.id, name: item.name, kind, drinkable: !!item.tags?.consumable, ...(kind === 'smoke' ? { lighter: await lighterOf(player.id) } : {}) } });

  const flavour = machine.flags?.vend_line || `The ${machine.name} clunks and drops something into the tray.`;
  const got = filled?.name || item.name;
  broadcast(player.current_zone, { type: 'zone_event', message: menu.length ? `${player.handle} lifts the lid of the ${machine.name} and takes out a ${got}.` : `The ${machine.name} clunks and coughs a ${got} into the tray for ${player.handle}.` }, player.id);
  // A FILLED VESSEL REPLACES THE TAIL rather than following it: "you take the
  // paper cup" and then "a flat white" is the same cup described twice, in the
  // wrong order. The machine's own vend_line has already said a cup arrived.
  const tail = filled?.note || `You take the <span class="item">${item.name}</span>.${price > 0 ? ` ₵${price}.` : ''}`;
  return { type: 'output', message: `${flavour} ${tail}` };
}

// VEND SHOWS ON EXAMINE. The manifest called this impossible for a long time —
// "flag values aren't tag-anchored, so availableActions can't surface it" — and
// it is not: registerSpecializedAction takes a `requiredFlag` beside its
// `requiredTag` for exactly this, a gate on a furniture flag KEY rather than on
// a tag. Declaration-only (handler null), so the verb still runs through the
// ordinary command above and re-checks everything it always did; all this adds
// is that the machine tells you it is there. Before it, a dispenser only worked
// for a player who already knew the word.
export const specializedActions = [
  { verb: 'vend', requiredFlag: 'vends', handler: null },
];

export const commands = { vend: cmdVend };
