/**
 * Tracks active shopping sessions between players and vendor NPCs.
 * A player can only shop with one NPC at a time; an NPC can only be shopped
 * with by one player at a time.  While a session is active the NPC's AI is
 * suspended (shopPaused flag) so it doesn't wander away.
 */

import { world } from './world.js';

// playerId -> npcId
const shoppingWith = new Map();
// npcId -> playerId
const shoppers = new Map();
// playerId — set for the current session once they buy anything (drives the
// vendor's closing-time farewell: happy if they bought, whiny if they didn't).
const boughtThisSession = new Set();

export function openShopSession(playerId, npcId) {
  closeShopSession(playerId); // clear any existing session for this player
  shoppingWith.set(playerId, npcId);
  shoppers.set(npcId, playerId);
  boughtThisSession.delete(playerId); // fresh session, nothing bought yet
  const npc = world.npcs.get(npcId);
  if (npc?._ai) npc._ai.shopPaused = true;
}

export function closeShopSession(playerId) {
  const npcId = shoppingWith.get(playerId);
  if (!npcId) return;
  shoppingWith.delete(playerId);
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
