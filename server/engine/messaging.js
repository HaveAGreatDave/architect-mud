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

// Raw broadcast function access for callers (e.g. scheduled tasks outside
// gameLoop's tick.minute hook) that need the full broadcast(zoneId, message,
// excludeId, targetId) signature rather than the sendToPlayer/sendToZone wrappers.
export function getBroadcast() { return broadcastFn; }

// Push a single server message to one player by id. No-op if not wired/connected.
export function sendToPlayer(playerId, message) {
  if (broadcastFn && playerId) broadcastFn(null, message, null, playerId);
}

// Broadcast a message to all players currently in a zone, optionally excluding
// one player id (e.g. the actor who triggered the event).
export function sendToZone(zoneId, message, excludeId = null) {
  if (broadcastFn && zoneId) broadcastFn(zoneId, message, excludeId);
}

// ── Teaching a verb (house convention) ───────────────────────────────────────
// THE STANDARD: the first time any prose teaches a player a verb, the verb itself
// is highlighted and shimmers once (client `.verb-teach`) and is clickable like a
// room link. Use this for every first mention of a new verb, everywhere.
export function teachVerb(verb, action = verb, target = '') {
  const targetAttr = target ? ` data-target="${target}"` : '';
  const label = target ? `${verb} ${target}` : verb;
  return `<span class="action-link verb-teach" data-action="${action}"${targetAttr} title="${label}">${verb}</span>`;
}

// Draw the eye to something already listed in the room pane: its room link
// ripples a few times. A cosmetic nudge that says "click up there" — pairs with
// teachVerb when the thing to click is in the pane, not the prose.
export function pointAt(playerId, action, target) {
  sendToPlayer(playerId, { type: 'point_at', action, target });
}

// Broadcast to a zone while excluding a Set of player ids — e.g. an aircraft's own
// occupants, who share a stale ground `current_zone` but are up in the sky and must
// not hear ambience (their own overfly noise, ground reactions) about themselves.
export function sendToZoneExcept(zoneId, message, excludeSet = null) {
  if (broadcastFn && zoneId) broadcastFn(zoneId, message, null, null, null, excludeSet);
}
