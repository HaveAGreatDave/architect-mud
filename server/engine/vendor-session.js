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

export function openShopSession(playerId, npcId) {
  closeShopSession(playerId); // clear any existing session for this player
  shoppingWith.set(playerId, npcId);
  shoppers.set(npcId, playerId);
  const npc = world.npcs.get(npcId);
  if (npc?._ai) npc._ai.shopPaused = true;
}

export function closeShopSession(playerId) {
  const npcId = shoppingWith.get(playerId);
  if (!npcId) return;
  shoppingWith.delete(playerId);
  shoppers.delete(npcId);
  const npc = world.npcs.get(npcId);
  if (npc?._ai) npc._ai.shopPaused = false;
}

export function getShopperForNpc(npcId) {
  return shoppers.get(npcId) ?? null;
}

export function getNpcForShopper(playerId) {
  return shoppingWith.get(playerId) ?? null;
}
