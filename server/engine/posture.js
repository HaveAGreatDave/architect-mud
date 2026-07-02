// Posture substrate — the engine-owned mutation API for player.posture /
// player.sittingOn. Plugins own the posture *verbs* (sit, stand, scavenge,
// butcher…); this module owns the *writes*, so the field contract lives in
// exactly one place and every change announces itself.
//
// Contract notes:
// - Mutates the live player object IN PLACE. Never clone-and-replace via
//   setLivePlayer for posture: the game loop holds direct references while it
//   ticks, and a replaced object silently orphans them (the split-system bug
//   class — docs/systems-posture.md).
// - Every transition emits 'posture.changed' { player, from, to, forced?,
//   reason? }. Activity plugins (scavenging, butchering) may react to it or
//   keep noticing the flip in their own tick — both work.
//
// forceStand() is THE interruption trigger: attack initiation, incoming hits,
// movement, waking. It clears ANY non-standing posture.
import { emit } from './events.js';

export function getPosture(player) {
  return player.posture || 'standing';
}

// Returns the previous posture.
export function setPosture(player, posture, { sittingOn = null } = {}) {
  const from = getPosture(player);
  player.posture = posture;
  player.sittingOn = sittingOn;
  if (from !== posture) emit('posture.changed', { player, from, to: posture });
  return from;
}

// Clears any non-standing posture. Returns the interrupted posture, or null
// if the player was already standing (i.e. nothing was interrupted).
export function forceStand(player, reason = null) {
  const from = getPosture(player);
  if (from === 'standing') return null;
  player.posture = 'standing';
  player.sittingOn = null;
  emit('posture.changed', { player, from, to: 'standing', forced: true, reason });
  return from;
}
