// server/engine/inventory.js
//
// Central inventory mutation service. Owns the player_inventory writes behind
// the generic Actions (TAKE/DROP/GIVE/EQUIP/UNEQUIP) so the stacking rules live
// in one place instead of being copy-pasted across command handlers. Mutations
// only — Events are emitted by the Action handlers that call these.
import { randomUUID } from 'crypto';
import { query } from '../models/db.js';
import { isStackable } from './tags.js';
import { on } from './events.js';

const groundOwner = zoneId => `_ground_${zoneId}`;

// The player's equipped weapon row (items.* columns), or null when unarmed.
// This exact lookup used to be copy-pasted at five call sites and re-queried on
// EVERY combat swing (weapon plugin, pvpSwing, door bash). Cached on the live
// player like carried weight: inventory.changed busts it instantly on the
// equip/unequip/drop paths, and the short TTL bounds staleness from plugin
// writers that mutate player_inventory without emitting (e.g. jail
// confiscation — a jailed player isn't mid-swing, so seconds of staleness
// can't land a hit with a weapon they no longer hold).
const EQUIPPED_WEAPON_TTL_MS = 5000;
on('inventory.changed', ({ actor }) => { if (actor) delete actor._equippedWeapon; });
export async function getEquippedWeapon(player) {
  const cached = player._equippedWeapon;
  if (cached && Date.now() - cached.at < EQUIPPED_WEAPON_TTL_MS) return cached.row;
  // `pi.id`/`pi.condition` ride along so wear can be applied on the swing path
  // without a query of its own (server/engine/durability.js) — the row this
  // cache already holds is the row that wears.
  const { rows } = await query(
    `SELECT i.*, pi.id AS inv_id, pi.condition, pi.custom_data
       FROM player_inventory pi JOIN items i ON i.id=pi.item_id
     WHERE pi.player_id=$1 AND pi.is_equipped=1 AND jsonb_exists(i.tags,'weapon') LIMIT 1`,
    [player.id]
  );
  const row = rows[0] || null;
  player._equippedWeapon = { row, at: Date.now() };
  return row;
}

// Resolve carried item row(s) by tag and/or name — the shared form of the
// `player_inventory JOIN items` lookup that ~20 plugins each hand-rolled (flashlight,
// fishing rod/bait, hack decks, butchering tools, amp cassettes, …). Same round-trip
// count as the copies it replaces; the point is one place for the carried-item rules
// (top-level vs. contained, equipped filter) instead of twenty subtly-drifting ones.
//
//   opts.tag       string | string[]  require jsonb_exists(i.tags, X); an array is OR
//   opts.name      string             i.name ILIKE %name% (substring, case-insensitive)
//   opts.topLevel  bool (default true) only uncontained rows (container_id IS NULL)
//   opts.equipped  true | false | undefined   worn-only / not-worn / either
//   opts.orderBy   string             raw ORDER BY clause — LITERAL only, never user input
//   opts.all       bool (default false) return every match instead of just the first
//   opts.includeFried bool (default false) include EMP-fried instances
//   opts.fromNearby bool (default false) on a MISS, also search furniture in the
//                   player's zone flagged `dish_cabinet` (a rack, a cupboard, a
//                   bar back-shelf). Opt-in, and deliberately narrow: it exists
//                   so a kitchen you own can hold its own pots instead of you
//                   carrying a stock pot around a gunfight. Costs ONE extra
//                   round trip and only when the ordinary lookup found nothing,
//                   so no hot path pays for it. A row found this way carries
//                   `fromNearby: <furniture name>` and is used IN PLACE — never
//                   moved into the pack — so nothing silently accumulates.
//
// Fried rows are excluded BY DEFAULT and on purpose. `custom_data.fried` is only
// ever set on an `electronic` item an EMP pulse cooked, and this is the one
// funnel every device lookup already goes through — so a fried deck, tablet or
// torch simply isn't there, and each plugin's existing "you don't have one"
// message does the work with no per-plugin gate. The repair path passes
// includeFried to find the thing it's meant to be fixing.
//
// Rows carry: inv_id, item_id, quantity, condition, is_equipped, layer, slot,
// custom_data, name, description, weight, tags, flags. Returns the first row (or
// null), or an array with `all`.
export async function resolveInventoryItem(player, opts = {}) {
  const playerId = typeof player === 'object' ? player.id : player;
  const { tag, name, topLevel = true, equipped, orderBy, all = false, includeFried = false,
          fromNearby = false } = opts;
  const where = ['pi.player_id = $1'];
  const params = [playerId];
  if (topLevel) where.push('pi.container_id IS NULL');
  if (equipped === true) where.push('pi.is_equipped = 1');
  else if (equipped === false) where.push('pi.is_equipped = 0');
  if (tag) {
    const tags = Array.isArray(tag) ? tag : [tag];
    const ors = tags.map(t => { params.push(t); return `jsonb_exists(i.tags, $${params.length})`; });
    where.push(`(${ors.join(' OR ')})`);
  }
  // Match the name the PLAYER sees. `inventory` prints `custom_data.name` when a
  // row carries one (a stamped credit chip, butchered "feral dog meat", a minced
  // cut), so resolving on the catalog name alone made those rows unreachable by
  // the only name anybody had ever been shown.
  if (name) { params.push(`%${name}%`); where.push(`(i.name ILIKE $${params.length} OR pi.custom_data->>'name' ILIKE $${params.length})`); }
  if (!includeFried) where.push(`COALESCE(pi.custom_data->>'fried', 'false') <> 'true'`);
  const sql =
    `SELECT pi.id AS inv_id, pi.item_id, pi.quantity, pi.condition,
            pi.is_equipped, pi.layer, pi.slot, pi.custom_data,
            i.name, i.description, i.weight, i.tags, i.flags
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE ${where.join(' AND ')}${orderBy ? `\n      ORDER BY ${orderBy}` : ''}${all ? '' : '\n      LIMIT 1'}`;
  const { rows } = await query(sql, params);
  if (rows.length || !fromNearby) return all ? rows : (rows[0] || null);

  // MISS, and the caller opted into the cabinet. Furniture containers already
  // store their contents as ordinary player_inventory rows keyed by
  // container_id, so this is the same SELECT with a different owner clause —
  // no new storage, no new machinery, and `loadContainerById` already treats
  // furniture flags as tags so everything downstream behaves identically.
  const zoneId = typeof player === 'object' ? player.current_zone : null;
  if (!zoneId) return all ? [] : null;
  const nearWhere = [
    `pi.container_id IN (SELECT id FROM furniture
                          WHERE zone_id = $1 AND object_type = 'container'
                            AND jsonb_exists(flags, 'dish_cabinet'))`,
  ];
  const nearParams = [zoneId];
  if (equipped === true) nearWhere.push('pi.is_equipped = 1');
  else if (equipped === false) nearWhere.push('pi.is_equipped = 0');
  if (tag) {
    const tags = Array.isArray(tag) ? tag : [tag];
    const ors = tags.map(t => { nearParams.push(t); return `jsonb_exists(i.tags, $${nearParams.length})`; });
    nearWhere.push(`(${ors.join(' OR ')})`);
  }
  if (name) { nearParams.push(`%${name}%`); nearWhere.push(`(i.name ILIKE $${nearParams.length} OR pi.custom_data->>'name' ILIKE $${nearParams.length})`); }
  if (!includeFried) nearWhere.push(`COALESCE(pi.custom_data->>'fried', 'false') <> 'true'`);
  const nearSql =
    `SELECT pi.id AS inv_id, pi.item_id, pi.quantity, pi.condition,
            pi.is_equipped, pi.layer, pi.slot, pi.custom_data,
            i.name, i.description, i.weight, i.tags, i.flags,
            f.name AS from_nearby
       FROM player_inventory pi
       JOIN items i ON i.id = pi.item_id
       JOIN furniture f ON f.id = pi.container_id
      WHERE ${nearWhere.join(' AND ')}${orderBy ? `\n      ORDER BY ${orderBy}` : ''}${all ? '' : '\n      LIMIT 1'}`;
  const near = await query(nearSql, nearParams);
  return all ? near.rows : (near.rows[0] || null);
}

/**
 * The same read as resolveInventoryItem, for MANY players in ONE round trip.
 *
 * Exists because per-minute ticks were calling resolveInventoryItem once per
 * live player — one remote round trip each, every minute, whether or not that
 * player owned anything relevant. That is a straight O(players) tax on a table
 * that answers all of them in a single `= ANY($1)`.
 *
 * Same option semantics as resolveInventoryItem (tag / equipped / topLevel /
 * includeFried); `all` and `name` don't apply. Returns Map<playerId, rows[]> —
 * players with no matching rows are simply absent, so callers should treat a
 * missing key as an empty list.
 */
export async function resolveInventoryForPlayers(playerIds, opts = {}) {
  const ids = [...new Set((playerIds || []).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;

  const { tag, topLevel = false, equipped, includeFried = false } = opts;
  const where = ['pi.player_id = ANY($1)'];
  const params = [ids];
  if (topLevel) where.push('pi.container_id IS NULL');
  if (equipped === true) where.push('pi.is_equipped = 1');
  else if (equipped === false) where.push('pi.is_equipped = 0');
  if (tag) {
    const tags = Array.isArray(tag) ? tag : [tag];
    const ors = tags.map(t => { params.push(t); return `jsonb_exists(i.tags, $${params.length})`; });
    where.push(`(${ors.join(' OR ')})`);
  }
  if (!includeFried) where.push(`COALESCE(pi.custom_data->>'fried', 'false') <> 'true'`);

  const { rows } = await query(
    `SELECT pi.player_id, pi.id AS inv_id, pi.item_id, pi.quantity, pi.condition,
            pi.is_equipped, pi.layer, pi.slot, pi.custom_data,
            i.name, i.description, i.weight, i.tags, i.flags
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE ${where.join(' AND ')}`,
    params
  );
  for (const r of rows) {
    let arr = out.get(r.player_id);
    if (!arr) { arr = []; out.set(r.player_id, arr); }
    arr.push(r);
  }
  return out;
}

/**
 * Apply a custom_data patch to MANY inventory rows in ONE round trip — the
 * write-side twin of the above, mirroring flushDirtyResources in combat.js.
 * `patches` is [[invId, objectToMerge], …]; merge semantics are identical to the
 * per-row `COALESCE(custom_data,'{}') || $patch` these callers already used.
 */
export async function patchInventoryCustomData(patches) {
  const list = (patches || []).filter(p => p && p[0]);
  if (!list.length) return 0;
  const vals = list.map((_, i) => `($${i * 2 + 1}::text, $${i * 2 + 2}::jsonb)`).join(', ');
  const params = list.flatMap(([id, patch]) => [id, JSON.stringify(patch)]);
  const { rowCount } = await query(
    `UPDATE player_inventory pi
        SET custom_data = COALESCE(pi.custom_data, '{}'::jsonb) || v.patch
       FROM (VALUES ${vals}) AS v(id, patch)
      WHERE pi.id = v.id`,
    params
  );
  return rowCount;
}

// A fillable container holding fluid is unique (non-stackable) — only empty
// ones stack. The instance amount lives in custom_data.fluid_amount.
const rowHasFluid = row => (row?.custom_data?.fluid_amount || 0) > 0;

// Instance-distinguishing custom_data keys: a row carrying any of these is unique
// and must NEVER be stack-merged. Merging keeps only the target row's custom_data
// and deletes the incoming one — which would dupe or destroy a cooked drug's
// potency, a spliced compound's effects blob, a cigarette pack's charge count, a
// loose single's flag, or a crate's owner lock.
// 'freshness' joins this list once a perishable item gets its first checkpoint —
// merging it into another stack would silently drop its independent decay history.
// 'cooking' joins it the moment a cook session starts, for the same reason, and
// 'cook_quality' stays on for good once plated — a Masterful steak must never
// merge into a Poor one.
// 'unpaid' joins this list for goods lifted out of a shop's display cooler: an
// unpaid steak must never merge into a steak you already own and launder itself
// clean on the way to the door.
// 'show_pass' joins it because a ticket is a dated document: two passes to two
// different tapings are not two of the same thing, and merging them would hand
// the holder one pass carrying the wrong night's showing.
const INSTANCE_KEYS = ['fluid_amount', 'potency', 'effects', 'spliced', 'charges', 'ownerId', 'loose', 'freshness', 'cooking', 'cook_quality', 'unpaid', 'dish', 'food_noun', 'crafted_quality', 'portion', 'minced', 'tasted', 'scored', 'tenderised', 'marinated_at', 'show_pass'];
export const rowIsInstanced = row => {
  const cd = typeof row?.custom_data === 'string' ? (() => { try { return JSON.parse(row.custom_data); } catch { return {}; } })() : (row?.custom_data || {});
  return INSTANCE_KEYS.some(k => { const v = cd[k]; return v != null && v !== false && v !== 0; });
};
// SQL predicate: a stack row safe to merge into (carries none of the instance keys).
// DERIVED from INSTANCE_KEYS rather than hand-listed, because the two drifted:
// the old literal omitted 'minced', 'portion', 'scored', 'tenderised',
// 'marinated_at', 'food_noun' and 'dish', so any merge guarded only by this
// predicate would happily eat a minced cut into a plain one. A key present but
// falsy makes this stricter than rowIsInstanced, which only ever costs a merge
// that didn't have to happen.
export const NOT_INSTANCED_SQL = `(custom_data IS NULL OR NOT jsonb_exists_any(custom_data, ARRAY[${INSTANCE_KEYS.map(k => `'${k}'`).join(',')}]))`;

// ── Wear splits a stack ──────────────────────────────────────────────────────
//
// `condition` is a COLUMN, not an instance key, so the predicate above says
// nothing about it — and two coats merging into `×2` used to keep the surviving
// row's condition and throw the other's away. Since durability shipped, that
// silently repaired one coat or ruined the other every time you tidied up.
//
// The rule: A ROW THAT HAS TAKEN ANY WEAR NEVER MERGES, in either direction.
// Not "merge within a band" — Battered is a range, and two Battered coats are
// still two different coats. Untouched is exactly 1.0, and only an item that
// wears ever leaves it, so every stack that stacks today still stacks: ammo,
// food and cassettes sit at 1.0 for life. The first scratch is what makes a
// thing its own object, permanently — which is also what lets the container
// panel offer a stack you can open and pick the good one out of.
const FULL_CONDITION = 0.9999;                // REAL column; never compare to 1 exactly
export const rowIsMergeable = (row) =>
  !rowIsInstanced(row) && Number(row?.condition ?? 1) >= FULL_CONDITION;
export const MERGEABLE_SQL = `${NOT_INSTANCED_SQL} AND (condition IS NULL OR condition >= ${FULL_CONDITION})`;

// Move a ground inventory row into a player's inventory. Stacking-aware: a
// stackable item merges into an existing unequipped stack the player already
// holds. Returns the resulting row id.
export async function pickUp(row, player) {
  if (isStackable(row) && rowIsMergeable(row)) {
    const { rows } = await query(
      `SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND is_equipped=0
         AND ${MERGEABLE_SQL} LIMIT 1`,
      [player.id, row.item_id]
    );
    if (rows.length) {
      await query('UPDATE player_inventory SET quantity = quantity + $1 WHERE id = $2', [row.quantity, rows[0].id]);
      await query('DELETE FROM player_inventory WHERE id=$1', [row.id]);
      return rows[0].id;
    }
  }
  await query('UPDATE player_inventory SET player_id=$1 WHERE id=$2', [player.id, row.id]);
  return row.id;
}

// Move a player's inventory row to the ground. With a partial qty, splits the
// stack and leaves the remainder carried. Returns the quantity dropped.
export async function dropToGround(row, zoneId, qty) {
  const dropQty = (qty && qty > 0 && qty < row.quantity) ? qty : row.quantity;
  if (dropQty < row.quantity) {
    await query('UPDATE player_inventory SET quantity=quantity-$1 WHERE id=$2', [dropQty, row.id]);
    await query('INSERT INTO player_inventory (id,player_id,item_id,quantity,is_equipped) VALUES ($1,$2,$3,$4,0)', [randomUUID(), groundOwner(zoneId), row.item_id, dropQty]);
  } else {
    await query('UPDATE player_inventory SET player_id=$1, is_equipped=0, slot=NULL, layer=NULL, container_id=NULL WHERE id=$2', [groundOwner(zoneId), row.id]);
  }
  return dropQty;
}

// Spawn a fresh copy of an item onto a zone's ground, with no source inventory
// row — used by quest auto-spawn to seed a retrievable objective item into the
// world so it's there to be found. Bare row (item_id + qty); the look/take path
// enriches it from `items` like any other ground drop.
// Spawn a fresh copy of an item INSIDE a container — a furniture container
// (player_inventory rows whose container_id is the furniture id) or another
// inventory row acting as a box. This is the dead-drop primitive: the item is
// really there and really retrievable, but it isn't lying on the floor where
// the next person through the room sees it.
// Contents are looked up by container_id alone, so player_id is inert here —
// but it must not be a real player's, or the row would count against someone's
// carry weight. Use a synthetic owner, same convention as `_ground_<zone>`.
// Taking the item out sets player_id to the taker and clears container_id.
const containerOwner = containerId => `_container_${containerId}`;

export async function spawnInContainer(itemId, containerId, qty = 1) {
  await query(
    'INSERT INTO player_inventory (id,player_id,item_id,quantity,is_equipped,container_id) VALUES ($1,$2,$3,$4,0,$5)',
    [randomUUID(), containerOwner(containerId), itemId, Math.max(1, Number(qty) || 1), containerId]
  );
}

// Returns the new row's id, so a caller that may need to take the item back out of
// the world later (a quest cleaning up after itself when it's abandoned) can name
// exactly the row it created rather than guessing by item_id and zone — which would
// also match items placed by an author or dropped by another player.
export async function spawnOnGround(itemId, zoneId, qty = 1) {
  const id = randomUUID();
  await query(
    'INSERT INTO player_inventory (id,player_id,item_id,quantity,is_equipped) VALUES ($1,$2,$3,$4,0)',
    [id, groundOwner(zoneId), itemId, Math.max(1, Number(qty) || 1)]
  );
  return id;
}

// Burn one charge from a charged-pack row (item tag `pack_size` > 1, e.g. a pack
// of cigarettes). Remaining charges ride on the row's custom_data.charges; a
// sealed pack (no `charges` key) counts as full. The row is destroyed only on the
// last charge — unless a fresh sealed pack is stacked behind it (quantity > 1), in
// which case that next one is opened. Non-pack rows are left untouched.
// Returns { charged, remaining, opened, destroyed }.
export async function burnCharge(row, itemTags) {
  const packSize = Math.max(0, Number(itemTags?.pack_size) || 0);
  if (packSize <= 1) return { charged: false };
  const cd = typeof row.custom_data === 'string'
    ? (() => { try { return JSON.parse(row.custom_data); } catch { return {}; } })()
    : (row.custom_data || {});
  // A hand-rolled / bummed single (custom_data.loose) is NOT a pack: burn one unit
  // of the stack, never the 10-charge pack accounting. (Reusing the packed
  // item_cigarettes item id for loose singles is why this special-case exists.)
  if (cd.loose) {
    if (row.quantity > 1) {
      await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [row.id]);
      return { charged: true, remaining: 0, opened: false, destroyed: false, loose: true };
    }
    await query('DELETE FROM player_inventory WHERE id=$1', [row.id]);
    return { charged: true, remaining: 0, opened: false, destroyed: true, loose: true };
  }
  const remaining = (cd.charges != null ? Number(cd.charges) : packSize) - 1;
  if (remaining > 0) {
    cd.charges = remaining;
    await query('UPDATE player_inventory SET custom_data=$1 WHERE id=$2', [JSON.stringify(cd), row.id]);
    return { charged: true, remaining, opened: false, destroyed: false };
  }
  if (row.quantity > 1) {
    delete cd.charges;   // finished this one; a fresh sealed pack is stacked behind it
    await query('UPDATE player_inventory SET quantity=quantity-1, custom_data=$1 WHERE id=$2', [JSON.stringify(cd), row.id]);
    return { charged: true, remaining: 0, opened: true, destroyed: false };
  }
  await query('DELETE FROM player_inventory WHERE id=$1', [row.id]);
  return { charged: true, remaining: 0, opened: false, destroyed: true };
}

// Hand a player's inventory row to another player. Stacking-aware, mirroring pickUp.
export async function giveToPlayer(row, toPlayer) {
  if (isStackable(row) && rowIsMergeable(row)) {
    const { rows } = await query(
      `SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND is_equipped=0 AND container_id IS NULL
         AND ${MERGEABLE_SQL} LIMIT 1`,
      [toPlayer.id, row.item_id]
    );
    if (rows.length) {
      await query('UPDATE player_inventory SET quantity = quantity + $1 WHERE id = $2', [row.quantity, rows[0].id]);
      await query('DELETE FROM player_inventory WHERE id=$1', [row.id]);
      return;
    }
  }
  await query('UPDATE player_inventory SET player_id=$1, is_equipped=0, slot=NULL, layer=NULL, container_id=NULL WHERE id=$2', [toPlayer.id, row.id]);
}

// Equip a row into a slot/layer, first clearing whatever occupies that slot+layer.
// equipped_at orders the worn set (used to evict the oldest accessory when full).
// A garment with a `covers` tag fills extra slots too (a jumpsuit on the torso
// also fills the legs): it clears — and is cleared by — anything at this layer in
// any slot it occupies, matched by the worn piece's own slot OR its own `covers`,
// so a jumpsuit and separate pants displace each other symmetrically.
export async function equipRow(row, player, slot, layer) {
  const covers = Array.isArray(row?.tags?.covers) ? row.tags.covers : [];
  const occupies = [slot, ...covers];
  await query(
    `UPDATE player_inventory pi SET is_equipped=0, slot=NULL, layer=NULL, equipped_at=NULL
       FROM items i
      WHERE i.id = pi.item_id AND pi.player_id=$1 AND pi.is_equipped=1 AND pi.layer=$2 AND pi.id<>$3
        AND (pi.slot = ANY($4::text[]) OR jsonb_exists_any(i.tags->'covers', $4::text[]))`,
    [player.id, layer, row.id, occupies]
  );
  await query('UPDATE player_inventory SET is_equipped=1, slot=$1, layer=$2, equipped_at=now() WHERE id=$3', [slot, layer, row.id]);
}

export async function unequipRow(row) {
  await query('UPDATE player_inventory SET is_equipped=0 WHERE id=$1', [row.id]);
}
