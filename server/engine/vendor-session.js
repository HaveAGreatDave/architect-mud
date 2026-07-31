/**
 * Tracks active shopping sessions between players and vendor NPCs.
 * A player can only shop with one NPC at a time; an NPC can only be shopped
 * with by one player at a time.  While a session is active the NPC's AI is
 * suspended (shopPaused flag) so it doesn't wander away.
 */

import { world } from './world.js';

// playerId -> npcId
const shoppingWith = new Map();
// playerId -> shelf label, for a vendor with more than one shelf. A front counter is
// the unlabelled shelf (null); a named shelf is a BACK ROOM, opened only by whatever
// authored the OPEN_SHOP that named it. Held on the session, not the player, so it
// dies with the conversation — you never keep back-room access by leaving the panel
// open. See getVendorStock's shelf filter.
const shelfOf = new Map();
// npcId -> playerId
const shoppers = new Map();
// playerId — set for the current session once they buy anything (drives the
// vendor's closing-time farewell: happy if they bought, whiny if they didn't).
const boughtThisSession = new Set();

export function openShopSession(playerId, npcId, shelf = null) {
  closeShopSession(playerId); // clear any existing session for this player
  shoppingWith.set(playerId, npcId);
  if (shelf) shelfOf.set(playerId, String(shelf));
  shoppers.set(npcId, playerId);
  boughtThisSession.delete(playerId); // fresh session, nothing bought yet
  const npc = world.npcs.get(npcId);
  if (npc?._ai) npc._ai.shopPaused = true;
}

export function closeShopSession(playerId) {
  const npcId = shoppingWith.get(playerId);
  if (!npcId) return;
  shoppingWith.delete(playerId);
  shelfOf.delete(playerId);
  shoppers.delete(npcId);
  boughtThisSession.delete(playerId);
  const npc = world.npcs.get(npcId);
  if (npc?._ai) npc._ai.shopPaused = false;
}

export function markSessionPurchase(playerId) {
  if (shoppingWith.has(playerId)) boughtThisSession.add(playerId);
}

export function didBuyThisSession(playerId) {
  return boughtThisSession.has(playerId);
}

export function getShopperForNpc(npcId) {
  return shoppers.get(npcId) ?? null;
}

export function getNpcForShopper(playerId) {
  return shoppingWith.get(playerId) ?? null;
}

// Which shelf this player currently has open — null for the ordinary front counter.
export function getShopShelf(playerId) {
  return shelfOf.get(playerId) ?? null;
}
