// server/engine/economy.js
//
// Central credit mutation service. Every spend/gain path routes through here
// so the "credits can't go negative" invariant is enforced in one place.
import { query } from '../models/db.js';

// Adjust carried credits by delta (positive = gain, negative = spend).
// Returns false if the player can't afford it.
//
// The affordability check and the write are a single guarded UPDATE, so the
// "credits can't go negative" invariant holds even under concurrent spends —
// no read-modify-write off a possibly-stale cached balance. The in-memory
// mirror is synced from the DB's RETURNING value, which stays the source of truth.
//
// `exec` defaults to the pooled `query`; pass a transaction runner (from
// `withTransaction`) to make the debit part of a larger atomic op (debit + the
// follow-on inventory write commit or roll back together).
export async function adjustCredits(player, delta, exec = query) {
  // The floor only applies to spends. A gain (delta >= 0) must always succeed —
  // otherwise a player already in the red (e.g. from rent) can never be paid,
  // and the guarded UPDATE silently rejects the payout while the caller's
  // transaction still removes the sold item.
  const res = await exec(
    'UPDATE players SET credits = credits + $1 WHERE id = $2 AND (credits + $1 >= 0 OR $1 >= 0) RETURNING credits',
    [delta, player.id]);
  if (res.rowCount === 0) return false;
  player.credits = res.rows[0].credits;
  return true;
}

// Move credits between carried and banked (type: 'deposit' | 'withdraw').
// Returns false if insufficient funds. Like adjustCredits, the balance check
// and both column writes happen in one atomic guarded UPDATE, and `exec` lets
// the move join a caller's transaction.
export async function transferCredits(player, amount, type, exec = query) {
  if (!(amount >= 0)) return false;
  const sql = type === 'deposit'
    ? 'UPDATE players SET credits = credits - $1, bank_credits = bank_credits + $1 WHERE id = $2 AND credits >= $1 RETURNING credits, bank_credits'
    : 'UPDATE players SET credits = credits + $1, bank_credits = bank_credits - $1 WHERE id = $2 AND bank_credits >= $1 RETURNING credits, bank_credits';
  const res = await exec(sql, [amount, player.id]);
  if (res.rowCount === 0) return false;
  player.credits      = res.rows[0].credits;
  player.bank_credits = res.rows[0].bank_credits;
  return true;
}
