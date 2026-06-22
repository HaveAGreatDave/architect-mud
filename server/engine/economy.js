// server/engine/economy.js
//
// Central credit mutation service. Every spend/gain path routes through here
// so the "credits can't go negative" invariant is enforced in one place.
import { query } from '../models/db.js';

// Adjust carried credits by delta (positive = gain, negative = spend).
// Returns false if the player can't afford it.
export async function adjustCredits(player, delta) {
  const next = (player.credits || 0) + delta;
  if (next < 0) return false;
  player.credits = next;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  return true;
}

// Move credits between carried and banked (type: 'deposit' | 'withdraw').
// Returns false if insufficient funds.
export async function transferCredits(player, amount, type) {
  if (type === 'deposit') {
    if ((player.credits || 0) < amount) return false;
    player.credits      = (player.credits     || 0) - amount;
    player.bank_credits = (player.bank_credits || 0) + amount;
  } else {
    if ((player.bank_credits || 0) < amount) return false;
    player.bank_credits = (player.bank_credits || 0) - amount;
    player.credits      = (player.credits      || 0) + amount;
  }
  await query('UPDATE players SET credits=$1, bank_credits=$2 WHERE id=$3',
    [player.credits, player.bank_credits, player.id]);
  return true;
}
