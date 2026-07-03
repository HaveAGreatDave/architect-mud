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

// Move a ground inventory row into a player's inventory. Stacking-aware: a
// stackable item merges into an existing unequipped stack the player already
// holds. Returns the resulting row id.
export async function pickUp(row, player) {
  if (isStackable(row) && !rowHasFluid(row)) {
    const { rows } = await query(
      `SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND is_equipped=0
         AND COALESCE((custom_data->>'fluid_amount')::int,0)=0`,
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
    await query('UPDATE player_inventory SET player_id=$1, is_equipped=0, slot=NULL, container_id=NULL WHERE id=$2', [groundOwner(zoneId), row.id]);
  }
  return dropQty;
}

// Hand a player's inventory row to another player. Stacking-aware, mirroring pickUp.
export async function giveToPlayer(row, toPlayer) {
  if (isStackable(row) && !rowHasFluid(row)) {
    const { rows } = await query(
      `SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND is_equipped=0 AND container_id IS NULL
         AND COALESCE((custom_data->>'fluid_amount')::int,0)=0 LIMIT 1`,
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
export async function equipRow(row, player, slot, layer) {
  await query('UPDATE player_inventory SET is_equipped=0, slot=NULL, layer=NULL, equipped_at=NULL WHERE player_id=$1 AND slot=$2 AND layer=$3 AND id<>$4', [player.id, slot, layer, row.id]);
  await query('UPDATE player_inventory SET is_equipped=1, slot=$1, layer=$2, equipped_at=now() WHERE id=$3', [slot, layer, row.id]);
}

export async function unequipRow(row) {
  await query('UPDATE player_inventory SET is_equipped=0 WHERE id=$1', [row.id]);
}
