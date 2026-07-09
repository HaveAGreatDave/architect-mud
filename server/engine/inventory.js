// server/engine/inventory.js
//
// Central inventory mutation service. Owns the player_inventory writes behind
// the generic Actions (TAKE/DROP/GIVE/EQUIP/UNEQUIP) so the stacking rules live
// in one place instead of being copy-pasted across command handlers. Mutations
// only — Events are emitted by the Action handlers that call these.
import { randomUUID } from 'crypto';
import { query } from '../models/db.js';
import { isStackable } from './tags.js';

const groundOwner = zoneId => `_ground_${zoneId}`;

// A fillable container holding fluid is unique (non-stackable) — only empty
// ones stack. The instance amount lives in custom_data.fluid_amount.
const rowHasFluid = row => (row?.custom_data?.fluid_amount || 0) > 0;

// Instance-distinguishing custom_data keys: a row carrying any of these is unique
// and must NEVER be stack-merged. Merging keeps only the target row's custom_data
// and deletes the incoming one — which would dupe or destroy a cooked drug's
// potency, a spliced compound's effects blob, a cigarette pack's charge count, a
// loose single's flag, or a crate's owner lock.
const INSTANCE_KEYS = ['fluid_amount', 'potency', 'effects', 'spliced', 'charges', 'ownerId', 'loose'];
const rowIsInstanced = row => {
  const cd = typeof row?.custom_data === 'string' ? (() => { try { return JSON.parse(row.custom_data); } catch { return {}; } })() : (row?.custom_data || {});
  return INSTANCE_KEYS.some(k => { const v = cd[k]; return v != null && v !== false && v !== 0; });
};
// SQL predicate: a stack row safe to merge into (carries none of the instance keys).
const NOT_INSTANCED_SQL = `(custom_data IS NULL OR NOT jsonb_exists_any(custom_data, ARRAY['fluid_amount','potency','effects','spliced','charges','ownerId','loose']))`;

// Move a ground inventory row into a player's inventory. Stacking-aware: a
// stackable item merges into an existing unequipped stack the player already
// holds. Returns the resulting row id.
export async function pickUp(row, player) {
  if (isStackable(row) && !rowIsInstanced(row)) {
    const { rows } = await query(
      `SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND is_equipped=0
         AND ${NOT_INSTANCED_SQL} LIMIT 1`,
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
export async function spawnOnGround(itemId, zoneId, qty = 1) {
  await query(
    'INSERT INTO player_inventory (id,player_id,item_id,quantity,is_equipped) VALUES ($1,$2,$3,$4,0)',
    [randomUUID(), groundOwner(zoneId), itemId, Math.max(1, Number(qty) || 1)]
  );
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
  if (isStackable(row) && !rowIsInstanced(row)) {
    const { rows } = await query(
      `SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND is_equipped=0 AND container_id IS NULL
         AND ${NOT_INSTANCED_SQL} LIMIT 1`,
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
