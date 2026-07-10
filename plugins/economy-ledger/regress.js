// economy-ledger regression — proves the two subscriptions are wired end-to-end.
// Both probes clean up their own rows (the suite contract is side-effect-free).
import { emit } from '../../server/engine/events.js';
import { query } from '../../server/models/db.js';
import { takeSnapshot } from './index.js';

export default async function regress({ check }) {
  // credits.changed → ledger row
  const probe = `regress_probe_${process.pid}`;
  emit('credits.changed', { playerId: probe, delta: 7, reason: 'regress:probe', after: 7 });
  await new Promise(r => setTimeout(r, 150)); // emit is fire-and-forget; let the async insert land
  const row = (await query('SELECT delta, reason FROM economy_ledger WHERE player_id = $1', [probe])).rows[0];
  check('credits.changed writes a ledger row', row?.delta === 7 && row?.reason === 'regress:probe', JSON.stringify(row));
  await query('DELETE FROM economy_ledger WHERE player_id = $1', [probe]);

  // snapshot totals every pool without throwing
  const totals = await takeSnapshot('regress-probe');
  check('snapshot totals all five pools',
    ['player_credits', 'player_bank', 'org_treasury', 'vendor_credits', 'atm_cash'].every(k => totals[k] !== undefined),
    JSON.stringify(totals));
  await query(`DELETE FROM economy_snapshots WHERE game_date = 'regress-probe'`);
}
