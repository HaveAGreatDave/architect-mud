/**
 * MIS per-player consent — the third gate.
 *
 * The server setting and `players.mis_enabled` are both opt-ins to the SURFACE,
 * and both belong to the ACTOR. Neither is consent from the person on the other
 * end: two players who have each flipped the Maturity Slider could, before this,
 * be acted on by any stranger in the room with no accept step and nothing to
 * say no with. This module is the missing half.
 *
 * The model is a ONE-WAY GRANT, given by the person being acted on.
 * `consent <player>` means "I permit you to aim MIS verbs at me". It is not a
 * negotiation and not a handshake — only you can open yourself up, and nothing
 * anyone else types can move the state. Two people acting on each other need
 * two grants, which is exactly right.
 *
 * PERFORMANCE CONTRACT: `hasConsent` is SYNC and query-free. Every MIS act path
 * and every 8-second event beat calls it, so it reads a RAM Map hydrated once at
 * login (the `player_npc_relations` pattern — see docs/systems-relationships.md).
 * The table is written on the explicit consent/revoke verbs ONLY.
 */
import { query } from '../../server/models/db.js';

// granterId → Set<granteeId>. "Who has this player let in."
const grants = new Map();

// `${askerId}:${targetId}` → epoch ms of the last ask. RAM-only and deliberately
// not persisted: the rate limit exists to stop someone spamming the same person
// in a session, and losing it on restart costs nothing.
const asks = new Map();
export const ASK_COOLDOWN_MS = 10 * 60 * 1000;

// Pairs where the granter has revoked at least once this session. A revoke is a
// block: the revoked player cannot ask again. RAM-only on purpose — the grant
// itself is the durable state, and someone who wants to re-open a door just
// `consent`s them again, which clears this.
const revoked = new Map();

/**
 * Load a player's grants at login. Loads BOTH directions: the rows they granted
 * (so their own revocations are live) and the rows granted TO them by players
 * who may not be online (so acting on a consenting offline-granter still works
 * the moment they log in). One query, once, per login.
 */
export async function hydrateConsents(playerId) {
  if (!playerId) return;
  const { rows } = await query(
    `SELECT granter_id, grantee_id FROM mis_consents WHERE granter_id=$1 OR grantee_id=$1`,
    [playerId]);
  for (const r of rows) {
    if (!grants.has(r.granter_id)) grants.set(r.granter_id, new Set());
    grants.get(r.granter_id).add(r.grantee_id);
  }
}

/**
 * Has `targetId` permitted `actorId` to act on them?
 *
 * SYNC BY CONTRACT — do not make this async. Callers include the per-beat guard
 * inside the 8-second event loops.
 */
export function hasConsent(actorId, targetId) {
  if (!actorId || !targetId) return false;
  if (actorId === targetId) return true;      // self-verbs never need a grant
  return grants.get(targetId)?.has(actorId) === true;
}

/** Everyone this player has granted. */
export function grantedBy(granterId) {
  return [...(grants.get(granterId) || [])];
}

/** Everyone who has granted this player. */
export function grantedTo(granteeId) {
  const out = [];
  for (const [granter, set] of grants) if (set.has(granteeId)) out.push(granter);
  return out;
}

/** Grant. Returns false if it was already in place (so the caller can say so). */
export async function grant(granterId, granteeId) {
  if (granterId === granteeId) return false;
  if (hasConsent(granteeId, granterId)) return false;
  if (!grants.has(granterId)) grants.set(granterId, new Set());
  grants.get(granterId).add(granteeId);
  revoked.delete(`${granterId}:${granteeId}`);   // granting again lifts the block
  await query(
    `INSERT INTO mis_consents (granter_id, grantee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [granterId, granteeId]);
  return true;
}

/**
 * Revoke. Write-through: RAM and table move together, so the next event beat
 * (≤8s away, and the caller stops the event outright) already sees it gone.
 * A revoke is also a block — see `canAsk`.
 */
export async function revoke(granterId, granteeId) {
  const had = grants.get(granterId)?.delete(granteeId) === true;
  await query(`DELETE FROM mis_consents WHERE granter_id=$1 AND grantee_id=$2`, [granterId, granteeId]);
  revoked.set(`${granterId}:${granteeId}`, true);
  return had;
}

/**
 * The one refusal string for every failed target check. It is deliberately
 * IDENTICAL for "target has MIS off" and "target hasn't consented" — a distinct
 * message would let anyone probe who has the surface enabled, which is exactly
 * the thing the invisible-surface doctrine exists to prevent. It also never
 * notifies the target: telling someone that a stranger just tried turns a
 * refused act into a delivery mechanism for the act.
 */
export function refusal(handle) {
  return `${handle} hasn't consented to that.`;
}

/** Revoke everything this player has granted. Returns how many went. */
export async function revokeAll(granterId) {
  const set = grants.get(granterId);
  const n = set ? set.size : 0;
  if (set) for (const g of set) revoked.set(`${granterId}:${g}`, true);
  grants.delete(granterId);
  await query(`DELETE FROM mis_consents WHERE granter_id=$1`, [granterId]);
  return n;
}

/**
 * May `askerId` send `targetId` an ask right now? False when they were revoked,
 * when they already hold the grant, or when they asked inside the cooldown.
 * The caller must answer identically in all three cases — see cmdConsent.
 */
export function canAsk(askerId, targetId) {
  if (revoked.get(`${targetId}:${askerId}`)) return false;
  if (hasConsent(askerId, targetId)) return false;
  const last = asks.get(`${askerId}:${targetId}`) || 0;
  return Date.now() - last >= ASK_COOLDOWN_MS;
}

export function markAsked(askerId, targetId) {
  asks.set(`${askerId}:${targetId}`, Date.now());
}

/**
 * Drop a logged-out player's RAM footprint. Their GRANTS stay — those are
 * durable and live in the table — but the session-scoped ask/revoke bookkeeping
 * goes, and their own grant set is dropped since nobody can act on an absent
 * player anyway (it rehydrates at next login).
 */
export function forgetSession(playerId) {
  grants.delete(playerId);
  for (const k of [...asks.keys()]) if (k.startsWith(`${playerId}:`) || k.endsWith(`:${playerId}`)) asks.delete(k);
  for (const k of [...revoked.keys()]) if (k.startsWith(`${playerId}:`) || k.endsWith(`:${playerId}`)) revoked.delete(k);
}

// Test seams only. `_seedGrant`/`_dropGrant` move RAM without touching the
// table, which is what lets the regress suite exercise every gate without
// inserting rows for players that don't exist (the plugin-standard convention
// is that a suite creates no rows).
export function _resetConsents() { grants.clear(); asks.clear(); revoked.clear(); }
export function _seedGrant(granterId, granteeId) {
  if (!grants.has(granterId)) grants.set(granterId, new Set());
  grants.get(granterId).add(granteeId);
}
export function _dropGrant(granterId, granteeId) { grants.get(granterId)?.delete(granteeId); }
