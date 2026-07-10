// economy-ledger — append-only audit trail for the game economy.
//
// Two subscriptions, no verbs, no state anyone else reads:
//  • credits.changed (emitted by server/engine/economy.js adjustCredits) →
//    one economy_ledger row per credit mutation, labeled with the caller's
//    reason ('vendor:sell', 'quest:reward', … or null for unlabeled calls).
//  • environment.dayRollover → one economy_snapshots row totaling every
//    credit pool (players carried/banked, org treasuries, vendor floats,
//    ATM cassettes).
//
// Raw-SQL credit writes that bypass economy.js (flight, insurance, jail,
// gametable, surveillance, rent, clone-vat) are deliberately NOT hooked —
// per the hybrid design they show up as unattributed drift between snapshot
// deltas and ledger sums in tools/economy-report, which is the migration
// worklist. See docs/systems-economy.md.
import { on } from '../../server/engine/events.js';
import { query } from '../../server/models/db.js';

function recordLedger({ playerId, delta, reason, after }) {
  return query(
    'INSERT INTO economy_ledger (player_id, delta, reason, credits_after) VALUES ($1, $2, $3, $4)',
    [playerId, delta, reason ?? null, after ?? null]
  );
}

// Exported for the regress suite; wired to environment.dayRollover below.
export async function takeSnapshot(gameDate = null) {
  const totals = (await query(`
    SELECT
      (SELECT COALESCE(SUM(credits), 0) FROM players)::bigint AS player_credits,
      (SELECT COALESCE(SUM(bank_credits), 0) FROM players)::bigint AS player_bank,
      (SELECT COALESCE(SUM(treasury), 0) FROM orgs)::bigint AS org_treasury,
      (SELECT COALESCE(SUM(COALESCE(vendor_credits, 0) + COALESCE(vendor_bank_credits, 0)), 0) FROM npcs)::bigint AS vendor_credits,
      (SELECT COALESCE(SUM(cash_stock), 0) FROM atm_units)::bigint AS atm_cash
  `)).rows[0];
  await query(
    `INSERT INTO economy_snapshots (game_date, player_credits, player_bank, org_treasury, vendor_credits, atm_cash)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [gameDate, totals.player_credits, totals.player_bank, totals.org_treasury, totals.vendor_credits, totals.atm_cash]
  );
  return totals;
}

on('credits.changed', recordLedger);
on('environment.dayRollover', payload => takeSnapshot(payload?.date ?? null));
