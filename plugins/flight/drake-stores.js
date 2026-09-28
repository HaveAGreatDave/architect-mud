// The Drake's two cockpit compartments, under the dash either side of the footwell
// (interior-drake.js drakeFascia).
//
//   pantry — the left one. A stasis larder: whatever you put in it stops ageing, so food comes out
//            exactly as fresh as it went in, and you can eat straight out of it in the air.
//   locker — the right one. Dry storage for anything that does not go off; where a working
//            aircraft would keep its ammunition and a side arm.
//
// ⚠ THE CONTENTS BELONG TO THE AIRCRAFT, NOT THE PILOT. They are ordinary player_inventory rows
// whose owner is `_aircraft_<id>_<store>` (the `_ground_<zone>` idiom), so they stay aboard when
// you get out, go with the aircraft if it is sold, and are reachable by whoever flies it next.
//
// ⚠ STASIS IS DONE BY MOVING THE CLOCK, NOT BY A TIER. Preservation decays from
// `freshness.checkpointAt`, so the item is checkpointed on the way in and its checkpoint is moved
// forward by the time it spent inside on the way out. No hook, no tick, and the preservation plugin
// never learns this box exists.
import { query } from '../../server/models/db.js';
import { fireHook } from '../../server/engine/plugins.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { liveAircraft } from './state.js';
import { getLivePlayer } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { loggedPanelsSync } from '../../server/engine/presentation.js';

// ⚠ SMALLER THAN A KITCHEN FRIDGE ON PURPOSE. The cheapest fridge in the game (the Coldbox) holds
// 15 kg; a compartment under an aircraft's dash is a bar fridge. Refrigerated only, never a freezer.
// Both grow with `<store> upgrade`, a per-aircraft refit kept on aircraft.custom_data.stores, so it
// goes with the airframe like the contents do. Tier 2 pantry is exactly a Coldbox.
const STORES = {
  pantry: { label: 'pantry', title: 'Pantry', cap: 6, grams: 6000, verb: 'The pantry' },
  locker: { label: 'weapons locker', title: 'Weapons Locker', cap: 8, grams: 16000, verb: 'The locker' },
};
const TIER_MUL = [1, 1.75, 2.5];
const UPGRADE_COST = [0, 1500, 3500];   // price of reaching that tier
const tierOf = (live, store) => Math.max(0, Math.min(TIER_MUL.length - 1, Number(live?.row?.custom_data?.stores?.[store]) || 0));
const limits = (live, store) => { const k = TIER_MUL[tierOf(live, store)]; return { cap: Math.round(STORES[store].cap * k), grams: Math.round(STORES[store].grams * k) }; };
const ownerOf = (aircraftId, store) => `_aircraft_${aircraftId}_${store}`;

function drakeFor(player) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  return live && live.type?.class === 'drake' ? live : null;
}

async function listStore(owner) {
  const { rows } = await query(
    `SELECT pi.*, COALESCE(pi.custom_data->>'name', i.name) AS name, i.tags, i.weight
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1 ORDER BY pi.created_at`, [owner]);
  return rows;
}
const weightOf = (rows) => rows.reduce((w, r) => w + (Number(r.weight) || 0) * (Number(r.quantity) || 1), 0);
// What each compartment accepts, the split putIn already enforces: the pantry is the fridge (only
// what spoils), the locker is dry storage (anything that does not).
const accepts = (store, tags) => (store === 'pantry' ? !!tags?.perishable : !tags?.perishable);

// The ordinary container panel (client container.js), fed from the aircraft's own rows. It carries
// `storeVerb`, so every stow/take the panel makes comes back through this verb as putid/takeid
// rather than the engine's stowid/pullid, which only know container rows. The pantry reports
// itself as refrigerated so it wears the same cold theme and readout as every other fridge.
async function storeView(store, player, owner) {
  const [held, inv] = await Promise.all([
    listStore(owner),
    query(`SELECT pi.*, COALESCE(pi.custom_data->>'name', i.name) AS name, i.tags, i.weight
             FROM player_inventory pi JOIN items i ON i.id = pi.item_id
            WHERE pi.player_id = $1 AND pi.container_id IS NULL AND pi.is_equipped = 0 ORDER BY i.name`, [player.id]),
  ]);
  const all = inv.rows.filter((r) => !r.tags?.quest_item);
  const invItems = all.filter((r) => accepts(store, r.tags));
  const view = {
    type: 'container_view', compact: true, storeVerb: store, containerId: `drake_${store}`, containerName: STORES[store].title,
    capacity: limits(drakeFor(player), store).grams, usedWeight: Math.round(weightOf(held) * 10) / 10,
    containerItems: held, invItems,
    preserves: store === 'pantry' ? 'refrigerated' : null, applianceGrade: store === 'pantry' ? 'commercial' : null,
  };
  const hidden = all.length - invItems.length;
  if (hidden) view.invNote = `Only ${store === 'pantry' ? 'perishables' : 'dry goods'}: ${hidden} other item${hidden === 1 ? '' : 's'} hidden.`;
  return view;
}

// Move a row, or part of a stack, to another owner by inventory row id.
async function moveRow(row, toOwner, qty, customData) {
  if (qty && qty > 0 && qty < row.quantity) {
    await query(`UPDATE player_inventory SET quantity = quantity - $2 WHERE id = $1`, [row.id, qty]);
    await query(
      `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, custom_data)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5)`, [toOwner, row.item_id, qty, row.condition ?? 1, customData]);
  } else {
    await query(`UPDATE player_inventory SET player_id = $2, container_id = NULL, custom_data = $3 WHERE id = $1`, [row.id, toOwner, customData]);
  }
}

async function putById(store, player, owner, id, qty) {
  const { rows } = await query(
    `SELECT pi.*, COALESCE(pi.custom_data->>'name', i.name) AS name, i.tags, i.weight
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.id = $1 AND pi.player_id = $2 AND pi.container_id IS NULL AND pi.is_equipped = 0`, [id, player.id]);
  const item = rows[0];
  if (!item) return { type: 'container_error', message: 'Item not found in your inventory.' };
  if (!accepts(store, item.tags)) {
    return { type: 'container_error', message: store === 'pantry' ? 'The pantry is for food that would spoil.' : `The locker is dry storage. The ${item.name} would go off in there.` };
  }
  const held = await listStore(owner);
  const n = qty && qty < item.quantity ? qty : item.quantity;
  if (weightOf(held) + (Number(item.weight) || 0) * n > limits(drakeFor(player), store).grams) return { type: 'container_error', message: `${STORES[store].verb} is full.` };
  if (held.length >= limits(drakeFor(player), store).cap) return { type: 'container_error', message: `${STORES[store].verb} is full.` };
  // Checkpoint the freshness first, off the row the hook was handed (see putIn).
  const row = { ...item, custom_data: { ...(item.custom_data || {}) } };
  if (item.tags?.perishable) await fireHook('item.checkFreshness', row, player);
  const cd = { ...row.custom_data };
  if (store === 'pantry' && cd.freshness) cd.stasis_at = Date.now();
  await moveRow(item, owner, qty, cd);
  return storeView(store, player, owner);
}

async function takeById(store, player, owner, id, qty) {
  const { rows } = await query(`SELECT * FROM player_inventory WHERE id = $1 AND player_id = $2`, [id, owner]);
  if (!rows[0]) return { type: 'container_error', message: 'Item not found.' };
  await moveRow(rows[0], player.id, qty, thaw(rows[0].custom_data || {}));
  return storeView(store, player, owner);
}

// Stasis: move the freshness clock forward by the time spent inside, so no decay accrued.
function thaw(cd) {
  if (!cd?.stasis_at) return cd;
  const out = { ...cd };
  const held = Math.max(0, Date.now() - Number(cd.stasis_at));
  if (out.freshness?.checkpointAt) out.freshness = { ...out.freshness, checkpointAt: out.freshness.checkpointAt + held };
  delete out.stasis_at;
  return out;
}

async function putIn(store, player, owner, name) {
  const item = await resolveInventoryItem(player, { name });
  if (!item) return { type: 'error', message: `You aren't carrying any "${name}".` };
  if (item.is_equipped) return { type: 'error', message: `Take the ${item.name} off first.` };
  if (store === 'locker' && item.tags?.perishable) {
    return { type: 'error', message: `The locker is dry storage. The ${item.name} would go off in there. Try the pantry.` };
  }
  const held = await listStore(owner);
  if (weightOf(held) + (Number(item.weight) || 0) * (item.quantity || 1) > limits(drakeFor(player), store).grams) return { type: 'error', message: `${STORES[store].verb} is full.` };
  if (held.length >= limits(drakeFor(player), store).cap) return { type: 'error', message: `${STORES[store].verb} is full.` };
  // Checkpoint first, so the stasis stamp starts from an up-to-date freshness.
  // ⚠ Read the checkpoint off the row the hook was handed: it skips the write when nothing moved,
  // so re-reading the DB can come back with no freshness at all.
  const row = { ...item, id: item.inv_id, custom_data: { ...(item.custom_data || {}) } };
  if (item.tags?.perishable) await fireHook('item.checkFreshness', row, player);
  const cd = { ...row.custom_data };
  if (store === 'pantry' && cd.freshness) cd.stasis_at = Date.now();
  await query(`UPDATE player_inventory SET player_id = $2, container_id = NULL, custom_data = $3 WHERE id = $1`,
    [item.inv_id, owner, cd]);
  const how = store === 'pantry'
    ? `You slide the ${item.name} into the pantry. The gantry screen folds shut over it with a soft hiss of cold.`
    : `You stow the ${item.name} in the locker and the drawer closes on its latch.`;
  return { type: 'info', message: how };
}

async function takeOut(player, owner, name, { one = false } = {}) {
  const item = await resolveInventoryItem(owner, { name });
  if (!item) return null;
  const cd = thaw(item.custom_data || {});
  if (one && item.quantity > 1) {
    await query(`UPDATE player_inventory SET quantity = quantity - 1 WHERE id = $1`, [item.inv_id]);
    await query(
      `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, custom_data)
       VALUES (gen_random_uuid()::text, $1, $2, 1, $3, $4)`, [player.id, item.item_id, item.condition ?? 1, cd]);
  } else {
    await query(`UPDATE player_inventory SET player_id = $2, custom_data = $3 WHERE id = $1`, [item.inv_id, player.id, cd]);
  }
  return item;
}

// ── The galley quick-actions panel (client galley.js) ────────────────────────
// A small floating panel over whatever vehicle you are in: what the galley holds, your hunger and
// thirst, and who else is aboard. Like the truck's galley flap it holds no logic of its own — every
// button is a verb string (`pantry eatid <id>`, `pantry sendid <id> <pid>`) that comes back here.
// The message shape (`galley_view`) is vehicle-agnostic: another vehicle with a galley answers with
// the same shape under its own `verb` and the same panel draws it.
async function galleyView(player, live, owner) {
  const held = await listStore(owner);
  const items = held.map((r) => {
    const t = r.tags || {};
    const food = Number(t.restore_hunger) || 0, water = Number(t.restore_thirst) || 0;
    return { id: r.id, name: r.name, qty: r.quantity || 1, verb: water > food ? 'drink' : 'eat', food, water };
  });
  const aboard = [];
  for (const pid of live.occupants) {
    if (pid === player.id) continue;
    const p = getLivePlayer(pid);
    if (p) aboard.push({ id: p.id, name: p.name, hunger: p.hunger, thirst: p.thirst });
  }
  return {
    type: 'galley_view', verb: 'pantry', title: `${live.row.name || 'Drake'}: galley`,
    items, hunger: player.hunger, thirst: player.thirst, passengers: aboard,
  };
}

// Hand one of a stack to somebody else aboard. The item goes into their own inventory, and they are
// told who sent it, so "send food to a passenger" is an ordinary give that never left the aircraft.
async function sendOne(player, live, owner, id, toPid) {
  if (!live.occupants.has(toPid) || toPid === player.id) return { type: 'error', message: "They aren't aboard." };
  const to = getLivePlayer(toPid);
  const { rows } = await query(
    `SELECT pi.*, COALESCE(pi.custom_data->>'name', i.name) AS name FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.id = $1 AND pi.player_id = $2`, [id, owner]);
  const row = rows[0];
  if (!row || !to) return { type: 'error', message: "That isn't in the galley any more." };
  await moveRow(row, to.id, 1, thaw(row.custom_data || {}));
  sendToPlayer(to.id, { type: 'info', message: `${player.name} passes you ${row.name} from the galley.` });
  sendToPlayer(player.id, await galleyView(player, live, owner));
  return { type: 'info', message: `You pass ${to.name} the ${row.name}.` };
}

function makeCmd(store) {
  return async (args, raw, player, broadcast) => {
    const live = drakeFor(player);
    const S = STORES[store];
    if (!live) return { type: 'error', message: `There's no ${S.label} here.` };
    const owner = ownerOf(live.row.id, store);
    const [sub, ...rest] = args;
    const name = rest.join(' ').trim();
    const op = (sub || '').toLowerCase();

    // The panel's own round trips (a click on the compartment in the cockpit, and every stow/take).
    // At the log rung the panel is not shown, so a click answers with the written list instead.
    const panel = !loggedPanelsSync(player);
    if (op === 'view' && panel) return storeView(store, player, owner);
    if (op === 'putid' || op === 'takeid') {
      const [id, q] = rest;
      const qty = /^[0-9]+$/.test(q || '') ? parseInt(q, 10) : null;
      return op === 'putid' ? putById(store, player, owner, id, qty) : takeById(store, player, owner, id, qty);
    }
    if (!op || op === 'view' || op === 'look' || op === 'list' || op === 'open') {
      const rows = await listStore(owner);
      const open = store === 'pantry'
        ? 'The gantry screen slides up out of the left of the dash, lit cold blue, over a chilled shelf.'
        : 'The right-hand drawers roll out on their runners.';
      if (!rows.length) return { type: 'info', message: `${open} It's empty. <span class="text-dim">(${store} put &lt;item&gt;)</span>` };
      const list = rows.map((r) => `  ${r.name}${r.quantity > 1 ? ` ×${r.quantity}` : ''}`).join('\n');
      const hint = store === 'pantry' ? `${store} take|eat|drink &lt;item&gt;` : `${store} take &lt;item&gt;`;
      return { type: 'info', message: `${open}\n${list}\n<span class="text-dim">(${hint}, ${rows.length}/${limits(live, store).cap} slots)</span>` };
    }
    if (store === 'pantry' && op === 'galley') return galleyView(player, live, owner);
    if (store === 'pantry' && op === 'sendid') return sendOne(player, live, owner, rest[0], rest[1]);
    if (store === 'pantry' && (op === 'eatid' || op === 'drinkid')) {
      const { rows } = await query(
        `SELECT pi.*, COALESCE(pi.custom_data->>'name', i.name) AS name FROM player_inventory pi JOIN items i ON i.id = pi.item_id
          WHERE pi.id = $1 AND pi.player_id = $2`, [rest[0], owner]);
      if (!rows[0]) return { type: 'error', message: "That isn't in the galley any more." };
      const item = await takeOut(player, owner, rows[0].name, { one: true });
      if (!item) return { type: 'error', message: "That isn't in the galley any more." };
      const { handleCommand } = await import('../../server/engine/commands/index.js');
      const res = await handleCommand(`${op === 'eatid' ? 'eat' : 'drink'} ${item.name}`, player, broadcast);
      sendToPlayer(player.id, await galleyView(player, live, owner));
      return res;
    }
    if (op === 'upgrade' || op === 'refit') {
      const t = tierOf(live, store);
      if (t >= TIER_MUL.length - 1) return { type: 'info', message: `${S.verb} is already refitted as far as it goes.` };
      const cost = UPGRADE_COST[t + 1];
      if (rest[0] !== 'confirm') {
        const nx = { cap: Math.round(S.cap * TIER_MUL[t + 1]), grams: Math.round(S.grams * TIER_MUL[t + 1]) };
        return { type: 'info', message: `A refit takes the ${S.label} to ${nx.cap} slots and ${nx.grams / 1000} kg for ₵${cost}. <span class="text-dim">(${store} upgrade confirm)</span>` };
      }
      if ((player.credits || 0) < cost) return { type: 'error', message: `The refit is ₵${cost}. You have ₵${player.credits || 0}.` };
      player.credits -= cost;
      const cd = { ...(live.row.custom_data || {}) };
      cd.stores = { ...(cd.stores || {}), [store]: t + 1 };
      live.row.custom_data = cd;
      await Promise.all([
        query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]),
        query('UPDATE aircraft SET custom_data=$1 WHERE id=$2', [JSON.stringify(cd), live.row.id]),
      ]);
      const L = limits(live, store);
      return { type: 'info', message: `The ${S.label} is refitted: ${L.cap} slots, ${L.grams / 1000} kg.`, player_update: { credits: player.credits } };
    }
    if (!name) return { type: 'error', message: `${op[0].toUpperCase() + op.slice(1)} what?` };
    if (op === 'put' || op === 'stow' || op === 'store') return putIn(store, player, owner, name);
    if (op === 'take' || op === 'get' || op === 'remove') {
      const item = await takeOut(player, owner, name);
      if (!item) return { type: 'error', message: `There's no "${name}" in the ${S.label}.` };
      return { type: 'info', message: `You take the ${item.name} out of the ${S.label}.` };
    }
    if (store === 'pantry' && (op === 'eat' || op === 'drink')) {
      const item = await takeOut(player, owner, name, { one: true });
      if (!item) return { type: 'error', message: `There's no "${name}" in the pantry.` };
      // Eaten through the engine's own verb, so hunger, poisoning and freshness all behave exactly
      // as they do anywhere else. Imported late: the command index loads the plugins.
      const { handleCommand } = await import('../../server/engine/commands/index.js');
      return handleCommand(`${op} ${item.name}`, player, broadcast);
    }
    return { type: 'error', message: `Try: ${store}, ${store} put <item>, ${store} take <item>${store === 'pantry' ? ', pantry eat <item>' : ''}.` };
  };
}

export const commands = { pantry: makeCmd('pantry'), locker: makeCmd('locker') };
export const _test = { thaw, ownerOf };
