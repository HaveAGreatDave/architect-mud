/**
 * Player messaging primitive.
 *
 * Event subscribers (e.g. the quest plugin) react to fire-and-forget Events whose
 * payloads carry an actor but no broadcast function. They still need to push a line
 * to that one player's socket. This holds the broadcast function index.js owns and
 * exposes a narrow `sendToPlayer` so subscribers don't have to thread broadcast
 * through every Event. Mirrors the setBroadcast pattern already used by routes.js.
 */
let broadcastFn = null;

export function setBroadcast(fn) { broadcastFn = fn; }

// Push a single server message to one player by id. No-op if not wired/connected.
export function sendToPlayer(playerId, message) {
  if (broadcastFn && playerId) broadcastFn(null, message, null, playerId);
}

// Broadcast a message to all players currently in a zone.
export function sendToZone(zoneId, message) {
  if (broadcastFn && zoneId) broadcastFn(zoneId, message);
}
