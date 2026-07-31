// server/engine/delivery.js
//
// Who receives a zone-scoped message.
//
// This used to live inside `broadcast()` in server/index.js, tangled up with the
// socket map — which meant the single most load-bearing decision in the server
// (does this room line reach this player?) had **no test coverage at all**,
// because regress drives commands with its own broadcast stub and never touches
// the real one. A wiring mistake there wouldn't throw; the room would just go
// quiet, and the first report would come from a confused player.
//
// So the decision lives here as a pure-ish function over world state, and
// index.js keeps only the part that genuinely needs sockets: id -> ws -> send.
//
// ── Why zone.players and not a socket index ──────────────────────────────────
// Delivery walks the zone's own occupant set rather than scanning every
// connected client (which made room chatter O(players) per message, and O(n^2)
// in aggregate once everyone is generating events). It deliberately does NOT
// introduce a parallel `zoneId -> socket` index: that would be a second copy of
// the truth needing maintenance across walking, teleporting, jail, void
// crossings, death respawn and flight, and missing ONE path means a player
// silently stops hearing their room. `zone.players` is already maintained by all
// of those paths — it is what `look` reads — so this derives from state that has
// to be correct anyway. `reconcileZoneMembership()` in world.js is the backstop.

import { getZone, getLivePlayer } from './world.js';
import { isDreamZone } from './dreamscape.js';

/**
 * Should this live player receive a message scoped to `zoneId`?
 * Exported for its own sake because each clause is a real rule someone can break.
 */
export function receivesZoneMessage(player, zoneId) {
  if (!player || !zoneId) return false;
  // The occupant set can lag a beat behind a move; current_zone is the truth.
  if (player.current_zone !== zoneId) return false;
  // Asleep players don't perceive the room around them — no actions, speech, or
  // ambience. EXCEPT the dream they are inside: that rule is about the real room
  // they are lying in, and a dreamer's own dreamscape is the only room they are
  // actually present in. Without this exception a dream room's authored ambience
  // is silently undeliverable, and the scheduled ambientTick — which already
  // walks transient zones — does all the work and drops it on the floor.
  if (player.sleeping && !isDreamZone(zoneId)) return false;
  // Aboard an airborne aircraft the player is up in the sky, not in the stale
  // ground zone they took off from — ground ambience (overfly noise, banter,
  // vendors, weather) must not leak into the cockpit. Their own game messages
  // arrive targeted, so they lose nothing they should be getting.
  if (player.posture === 'flying') return false;
  return true;
}

/**
 * The player ids that should receive a zone-scoped message, after exclusions.
 * Ghost sessions are NOT included — they watch a zone without standing in it, so
 * they never appear in `zone.players`; index.js serves them from its own set.
 *
 * @param {string} zoneId
 * @param {{ exclude?: (string|null)[], excludeSet?: Set<string>|null }} opts
 * @returns {string[]}
 */
export function zoneAudience(zoneId, { exclude = [], excludeSet = null } = {}) {
  const zone = getZone(zoneId);
  if (!zone) return [];
  const skip = new Set(exclude.filter(Boolean));
  const out = [];
  for (const pid of zone.players) {
    if (skip.has(pid)) continue;
    if (excludeSet && excludeSet.has(pid)) continue;
    if (!receivesZoneMessage(getLivePlayer(pid), zoneId)) continue;
    out.push(pid);
  }
  return out;
}
