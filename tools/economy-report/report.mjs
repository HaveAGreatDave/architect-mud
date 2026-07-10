// Economy report — circulation over time (daily snapshots), faucet/sink balance
// per reason label (economy_ledger), and unattributed drift: the credit flow
// explained only by raw-SQL paths that bypass economy.js adjustCredits.
//
//   npm run db:economy-report
//   node --env-file=.env.prod tools/economy-report/report.mjs
//
// Data comes from the economy-ledger plugin's two tables. Drift math compares
// Δ(carried+bank) between snapshots to the ledger sum over the same window —
// bank transfers are net-zero across the pair, so any residue is bypass flow.
import { query } from '../../server/models/db.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const rows = async (sql, params) => (await query(sql, params)).rows;

const snapshots = await rows(`SELECT * FROM economy_snapshots ORDER BY created_at`);
const reasons = await rows(`
  SELECT COALESCE(reason, '(unlabeled)') AS reason,
         SUM(delta) FILTER (WHERE delta > 0)::bigint AS inflow,
         SUM(delta) FILTER (WHERE delta < 0)::bigint AS outflow,
         COUNT(*)::int AS events
  FROM economy_ledger GROUP BY 1 ORDER BY SUM(ABS(delta)) DESC`);
const recent = await rows(`
  SELECT reason, delta, created_at FROM economy_ledger
  ORDER BY created_at DESC LIMIT 50`);
const holders = await rows(`
  SELECT handle, credits, bank_credits, (credits + bank_credits) AS total
  FROM players ORDER BY total DESC LIMIT 15`);
const current = (await rows(`
  SELECT
    (SELECT COALESCE(SUM(credits), 0) FROM players)::bigint AS player_credits,
    (SELECT COALESCE(SUM(bank_credits), 0) FROM players)::bigint AS player_bank,
    (SELECT COALESCE(SUM(treasury), 0) FROM orgs)::bigint AS org_treasury,
    (SELECT COALESCE(SUM(COALESCE(vendor_credits,0) + COALESCE(vendor_bank_credits,0)), 0) FROM npcs)::bigint AS vendor_credits,
    (SELECT COALESCE(SUM(cash_stock), 0) FROM atm_units)::bigint AS atm_cash`))[0];

// drift per snapshot window: Δ(carried+bank) − Σ ledger deltas in the window
const drift = [];
for (let i = 1; i < snapshots.length; i++) {
  const a = snapshots[i - 1], b = snapshots[i];
  const ledger = (await rows(
    `SELECT COALESCE(SUM(delta), 0)::bigint AS s FROM economy_ledger WHERE created_at > $1 AND created_at <= $2`,
    [a.created_at, b.created_at]))[0].s;
  const poolDelta = (+b.player_credits + +b.player_bank) - (+a.player_credits + +a.player_bank);
  drift.push({ from: a.game_date, to: b.game_date, poolDelta, ledger: +ledger, drift: poolDelta - +ledger });
}

const data = { generatedAt: new Date().toISOString(), snapshots, reasons, recent, holders, current, drift };
let html = readFileSync(path.join(dir, 'template.html'), 'utf8');
html = html.replace('/*__DATA__*/', JSON.stringify(data));
writeFileSync(path.join(dir, 'economy-report.html'), html);

console.log(`snapshots=${snapshots.length} reasons=${reasons.length} ledgerWindows=${drift.length}`);
console.log(`circulation now: carried=${current.player_credits} bank=${current.player_bank} treasury=${current.org_treasury} vendors=${current.vendor_credits} atm=${current.atm_cash}`);
console.log(`wrote ${path.join(dir, 'economy-report.html')}`);
process.exit(0);
