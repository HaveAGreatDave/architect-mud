/**
 * Vendor grudge — a vendor's refusal to trade with a player who robbed or
 * burgled them, lapsing after a cooldown.
 *
 * Stored as a persistent per-player flag keyed by vendor NPC id (`vendor_grudge:<npcId>`),
 * so it's per (player, vendor) and survives restarts — the same flag store that
 * backs trust/wanted. The value is the epoch-ms the grudge expires.
 *
 * Written by the vendor-safe plugin (safe hack) and the commerce plugin
 * (burglary in a vendor's zone). Read at every trade funnel: commerce
 * shop/buy, the dialogue OPEN_SHOP action, and the engine buy/sell guards.
 *
 * Game time runs 1:1 with real time (see environment.js), so N in-game days is
 * N real days — the cooldown is expressed straight in wall-clock ms.
 */
import { getFlag, setFlag } from './flags.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const GRUDGE_DAYS = 7;
const flagKey = (npcId) => `vendor_grudge:${npcId}`;

// Start (or refresh) a vendor's grudge against this player.
export async function holdVendorGrudge(player, npcId, days = GRUDGE_DAYS) {
  if (!player?.id || !npcId) return;
  await setFlag('player', flagKey(npcId), String(Date.now() + days * DAY_MS), player);
}

// Remaining grudge time in ms (0 if none / lapsed).
export async function vendorGrudgeRemaining(playerId, npcId) {
  if (!playerId || !npcId) return 0;
  const until = Number(await getFlag('player', flagKey(npcId), { id: playerId })) || 0;
  return Math.max(0, until - Date.now());
}

// Shared, in-character refusal so every trade funnel speaks with one voice.
export function grudgeRefusal(npc, remainingMs) {
  const days = Math.max(1, Math.ceil(remainingMs / DAY_MS));
  return `<span class="msg-system">${npc.name} sees you coming and their face goes cold. "After what you pulled? Get out of my sight." They won't deal with you for about ${days} more day${days === 1 ? '' : 's'}.</span>`;
}
