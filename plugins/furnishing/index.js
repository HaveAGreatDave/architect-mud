/**
 * Furnishing: players furnish the rooms they control.
 *
 *   place <item>  - set a carried furniture item down here as a piece.
 *   take <piece>  - pick your own piece back up as an item (a specialized
 *                   action, so every other `take` still reaches the engine).
 *
 * And when a property is released (unrent, eviction, storefront repossession,
 * corp HQ teardown), every piece a player placed there goes back to whoever
 * placed it, with anything stored inside.
 *
 * Every write here is a typed verb or a release, never a tick. Rows go through
 * the world.js furniture funnel, so room descriptions keep reading the cache.
 */
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { on, emit } from '../../server/engine/events.js';
import { world, getZoneFurniture, getZonePlayers, getZoneNpcs, getApartment, deleteFurnitureWhere } from '../../server/engine/world.js';
import { ownsZone } from '../../server/engine/zone-filth.js';
import { playerControlsApt } from '../../server/engine/apartments.js';
import { giveItemById } from '../../server/engine/inventory.js';
import { carryCapacity, computeCarriedWeight, formatWeight } from '../../server/engine/commands/inventory.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { placeFurnitureFromItem, itemForPlacedPiece, canCarryExtra } from '../../server/engine/furniture-shop.js';

// Player pieces a room can hold. Keeps the room text readable and the cache small.
export const MAX_PIECES_PER_ROOM = 12;

// The furniture rows this plugin may take up or box. Generators, media decks,
// terminals, posters and security devices have their own verbs and teardown.
const MOVABLE_TYPES = new Set(['furniture', 'container']);

// A rented flat, a corp HQ the player manages, or their own storefront.
export function controlsRoom(player, zoneId) {
  return playerControlsApt(player, getApartment(zoneId)) || ownsZone(zoneId, player?.id);
}

function isMovablePlayerPiece(f) {
  return f.origin === 'player' && MOVABLE_TYPES.has(f.object_type) && !f.flags?.dead_drop;
}

function placedPieces(zoneId) {
  return getZoneFurniture(zoneId).filter(isMovablePlayerPiece);
}

function cleanTarget(args) {
  return args.join(' ').replace(/^(the|a|an|my)\s+/i, '').trim().toLowerCase();
}

// Pick one row by name: an exact name beats a partial match. Returns
// { hit } or { ambiguous: [names] } or {} for nothing.
function pickByName(rows, target, nameOf = r => r.name) {
  if (!target) return {};
  const exact = rows.filter(r => String(nameOf(r)).toLowerCase() === target);
  if (exact.length) return { hit: exact[0] };
  const partial = rows.filter(r => String(nameOf(r)).toLowerCase().includes(target));
  const names = [...new Set(partial.map(nameOf))];
  if (names.length > 1) return { ambiguous: names };
  return partial.length ? { hit: partial[0] } : {};
}

// ── place <item> ─────────────────────────────────────────────────────────────
async function cmdPlace(args, raw, player, broadcast) {
  const zoneId = player.current_zone;
  const { rows: carried } = await query(
    `SELECT pi.id AS inv_id, pi.quantity, i.*
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1 AND pi.container_id IS NULL AND pi.is_equipped = 0 AND i.type = 'furniture'`,
    [player.id]
  );
  const target = cleanTarget(args);
  if (!target) {
    if (!carried.length) return { type: 'error', message: "You aren't carrying any furniture. Buy a piece and carry it out, or `take` one of yours." };
    return { type: 'output', message: `Place what? You're carrying: ${[...new Set(carried.map(r => r.name))].join(', ')}.` };
  }

  const { hit: row, ambiguous } = pickByName(carried, target);
  if (ambiguous) return { type: 'error', message: `Which one? ${ambiguous.join(', ')}.` };
  if (!row) return { type: 'error', message: `You aren't carrying any furniture called "${target}".` };

  if (!controlsRoom(player, zoneId)) {
    return { type: 'error', message: `This isn't your place. Furniture goes in a flat you rent, your corp's HQ or a shop you own.` };
  }
  if (placedPieces(zoneId).length >= MAX_PIECES_PER_ROOM) {
    return { type: 'error', message: `There's no room for the ${row.name}. This room already holds ${MAX_PIECES_PER_ROOM} pieces of yours; \`take\` one first.` };
  }

  // Use up the carried row FIRST, conditionally, so a doubled command can't
  // place one item twice.
  const used = row.quantity > 1
    ? await query('UPDATE player_inventory SET quantity = quantity - 1 WHERE id = $1 AND player_id = $2 AND quantity > 1 RETURNING id', [row.inv_id, player.id])
    : await query('DELETE FROM player_inventory WHERE id = $1 AND player_id = $2 RETURNING id', [row.inv_id, player.id]);
  if (!used.rows.length) return { type: 'error', message: `You aren't carrying the ${row.name} any more.` };

  try {
    await placeFurnitureFromItem(row, zoneId, player.id, { price: row.value });
  } catch (e) {
    await giveItemById(player.id, row.id, 1).catch(() => {});
    console.error('[furnishing] place failed:', e.message);
    return { type: 'error', message: `You can't get the ${row.name} to stand right. Try again.` };
  }
  emit('inventory.changed', { actor: player });
  broadcast(zoneId, { type: 'zone_event', message: `${player.handle} sets down a ${row.name}.`, refresh: true }, player.id);
  return { type: 'output', message: `You set the ${row.name} down. It looks like it's always been there.` };
}

// ── take <piece> ─────────────────────────────────────────────────────────────
function inUse(f, zoneId) {
  const seated = getZonePlayers(zoneId).some(p =>
    (p.posture === 'sitting' || p.posture === 'lying') && p.sittingOn === f.name);
  if (seated) return true;
  return getZoneNpcs(zoneId).some(n => n.onFurniture === f.name || (n.posture === 'sitting' && n.sittingOn === f.name));
}

async function takePiece(args, raw, player, broadcast) {
  const target = cleanTarget(args);
  // No target, "all" and "take X from Y" are the engine's.
  if (!target || target === 'all' || target.includes(' from ')) return undefined;

  const zoneId = player.current_zone;
  const mine = placedPieces(zoneId).filter(f => String(f.owner_id) === String(player.id));
  const { hit: piece, ambiguous } = pickByName(mine, target);
  if (ambiguous) return { type: 'error', message: `Which one? ${ambiguous.join(', ')}.` };
  if (!piece) return undefined; // not one of yours: the engine's take

  const item = itemForPlacedPiece(piece);
  if (!item) return { type: 'error', message: `The ${piece.name} is in here for good. It won't come apart.` };
  if (inUse(piece, zoneId)) return { type: 'error', message: `Someone's using the ${piece.name}.` };
  if (piece.object_type === 'container') {
    const { rows } = await query('SELECT 1 FROM player_inventory WHERE container_id = $1 LIMIT 1', [piece.id]);
    if (rows.length) return { type: 'error', message: `Empty the ${piece.name} first.` };
  }
  if (!await canCarryExtra(player, item.weight)) {
    const carried = await computeCarriedWeight(player);
    return { type: 'error', message: `The ${piece.name} weighs ${formatWeight(item.weight)}. You're already carrying ${formatWeight(carried)} of ${formatWeight(carryCapacity(player))}. It stays where it is.` };
  }

  // Remove the row BEFORE handing the item over: a second quick take finds
  // nothing to delete and can't duplicate the piece.
  const gone = await deleteFurnitureWhere(
    `DELETE FROM furniture WHERE id = $1 AND owner_id = $2 AND origin = 'player'`, [piece.id, player.id]);
  if (!gone.length) return { type: 'error', message: `The ${piece.name} isn't there any more.` };
  await giveItemById(player.id, item.id, 1);
  emit('inventory.changed', { actor: player });
  broadcast(zoneId, { type: 'zone_event', message: `${player.handle} picks up the ${piece.name}.`, refresh: true }, player.id);
  return { type: 'take', message: `You pick up the ${piece.name}.` };
}

// ── Boxing on release ────────────────────────────────────────────────────────
// Every movable player piece in the room goes back to whoever placed it, and so
// does anything stored inside one. A placer who no longer exists gets nothing;
// their pieces just go. Returns { boxed: [{ ownerId, name }], dropped }.
export async function boxPlacedFurniture(zoneId) {
  const pieces = placedPieces(zoneId).filter(f => f.owner_id);
  if (!pieces.length) return { boxed: [], dropped: 0 };

  const ownerIds = [...new Set(pieces.map(f => String(f.owner_id)))];
  const { rows: alive } = await query('SELECT id FROM players WHERE id = ANY($1)', [ownerIds]);
  const living = new Set(alive.map(r => String(r.id)));

  const gone = await deleteFurnitureWhere(
    `DELETE FROM furniture WHERE id = ANY($1) AND origin = 'player'`, [pieces.map(f => f.id)]);
  const goneIds = new Set(gone.map(r => r.id));

  const ids = [], owners = [], itemIds = [], containers = [], containerOwners = [];
  const boxed = [];
  let dropped = 0;
  for (const f of pieces) {
    if (!goneIds.has(f.id)) continue;
    const owner = String(f.owner_id);
    const item = itemForPlacedPiece(f);
    if (!living.has(owner) || !item) { dropped++; continue; }
    ids.push(randomUUID()); owners.push(owner); itemIds.push(item.id);
    if (f.object_type === 'container') { containers.push(f.id); containerOwners.push(owner); }
    boxed.push({ ownerId: owner, name: f.name });
  }

  if (ids.length) {
    await query(
      `INSERT INTO player_inventory (id, player_id, item_id, quantity, is_equipped)
       SELECT id, owner, item, 1, 0 FROM unnest($1::text[], $2::text[], $3::text[]) AS t(id, owner, item)`,
      [ids, owners, itemIds]
    );
  }
  if (containers.length) {
    // What was stored in a piece comes out loose to its owner, and anything
    // nested in a box among it follows that box to the same owner.
    await query(
      `WITH map AS (SELECT * FROM unnest($1::text[], $2::text[]) AS m(container_id, owner)),
            top AS (
              UPDATE player_inventory pi SET player_id = map.owner, container_id = NULL
                FROM map WHERE pi.container_id = map.container_id
              RETURNING pi.id, map.owner)
       UPDATE player_inventory pi SET player_id = top.owner FROM top WHERE pi.container_id = top.id`,
      [containers, containerOwners]
    );
  }

  for (const ownerId of new Set(boxed.map(b => b.ownerId))) {
    const live = world.players.get(ownerId);
    if (live) emit('inventory.changed', { actor: live });
    const names = boxed.filter(b => b.ownerId === ownerId).map(b => b.name);
    const where = world.zones.get(zoneId)?.name || 'your old place';
    sendToPlayer(ownerId, {
      type: 'output',
      message: `Your furniture from ${where} has been boxed up and handed back: ${names.join(', ')}. If it's too heavy to walk with, drop something, or \`place\` it somewhere you own.`,
    });
  }
  return { boxed, dropped };
}

on('property.released', ({ zoneId }) => {
  if (!zoneId) return;
  return boxPlacedFurniture(zoneId).catch(e => console.error('[furnishing] boxing failed:', e.message));
});

export const commands = { place: cmdPlace };

export const specializedActions = [{ verb: 'take', handler: takePiece }];
