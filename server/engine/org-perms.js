// server/engine/org-perms.js
//
// Corp (org) permission bitmask + the hasPerm gate. Lives in the engine (not the
// corps plugin) so engine modules like apartments.js can import it without an
// engine -> plugin import cycle. The corps plugin re-exports these.
import { getPlayerMembership, getOrg } from './world.js';

// Permission bits. A rank's `permissions` column is the OR of these.
export const PERM = {
  INVITE:     1 << 0,
  KICK:       1 << 1,
  EDIT_RANKS: 1 << 2,
  DISBURSE:   1 << 3,
  EDIT_CORP:  1 << 4,
  MANAGE_HQ:  1 << 5,
  DISBAND:    1 << 6,
  RACKET:     1 << 7,   // establish/maintain protection rackets on shops in held turf
};

// Every bit set — the Founder rank.
export const PERM_ALL = Object.values(PERM).reduce((a, b) => a | b, 0);

// True if the player is in a corp and either owns it (owner implies every
// permission) or their rank's bitmask carries `bit`. Any-member actions
// (contribute) don't call this — they only check membership exists.
export function hasPerm(player, bit) {
  const m = getPlayerMembership(player.id);
  if (!m) return false;
  if (getOrg(m.org_id)?.owner_id === player.id) return true;
  return (m.permissions & bit) !== 0;
}
