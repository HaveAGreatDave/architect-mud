// Tablet OS — Bank app. Deposit-only (per spec: cash withdrawal stays ATM-only,
// a physical terminal you have to be standing at). Reuses the engine's
// transferCredits (server/engine/economy.js) — the exact function the ATM
// plugin's own `deposit` command calls — and logs through atm's logBankTx so
// both paths share one ledger.
import { query } from '../../server/models/db.js';
import { transferCredits } from '../../server/engine/economy.js';
import { registerTabletApp, normScreen } from './registry.js';

async function buildHome(player) {
  const { rows } = await query('SELECT credits, bank_credits FROM players WHERE id=$1', [player.id]);
  return { credits: rows[0]?.credits ?? 0, bank_credits: rows[0]?.bank_credits ?? 0 };
}

async function buildScreen(player, screenId, params) {
  const { rows } = await query('SELECT credits, bank_credits FROM players WHERE id=$1', [player.id]);
  const balances = { credits: rows[0]?.credits ?? 0, bank_credits: rows[0]?.bank_credits ?? 0 };

  if (normScreen(screenId) === 'history') {
    const { rows: txRows } = await query(
      'SELECT type, amount, balance_after, created_at FROM bank_transactions WHERE player_id=$1 ORDER BY created_at DESC LIMIT 50',
      [player.id]
    );
    return {
      view: 'list',
      breadcrumb: ['Transaction History'],
      items: txRows.map(t => ({
        id: String(t.created_at),
        label: `${t.type === 'deposit' ? '+' : '-'}${t.amount}c`,
        sub: `Balance after: ${t.balance_after}c · ${new Date(t.created_at * 1000).toLocaleString()}`,
      })),
    };
  }

  return {
    view: 'detail',
    breadcrumb: [],
    detail: {
      name: 'Bank',
      desc: `Carried: ${balances.credits}c · Banked: ${balances.bank_credits}c`,
      rows: [
        { label: 'On hand', value: `${balances.credits}c` },
        { label: 'Banked', value: `${balances.bank_credits}c` },
      ],
    },
    actions: [
      { id: 'deposit_all', label: 'Deposit All' },
      { id: 'nav_history', label: 'Transaction History' },
    ],
  };
}

async function handleAction(player, actionId, params) {
  if (actionId === 'nav_history') return buildScreen(player, 'History', '');

  if (actionId === 'deposit_all' || actionId === 'transfer') {
    const amount = actionId === 'transfer' ? parseInt(params, 10) : (player.credits || 0);
    if (!amount || amount <= 0) return { view: 'error', message: 'Nothing to deposit.' };
    if (!await transferCredits(player, amount, 'deposit')) {
      return { view: 'error', message: `You only have ${player.credits || 0}c on you.` };
    }
    const { logBankTx } = await import('../atm/index.js');
    await logBankTx(player.id, 'deposit', amount, player.bank_credits);
    return buildScreen(player, null, '');
  }

  return buildScreen(player, null, '');
}

registerTabletApp({
  id: 'bank', name: 'Bank', icon: '🏦', category: 'Finance',
  buildHome, buildScreen, handleAction,
});
