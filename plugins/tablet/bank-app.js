// Tablet OS — Bank app. Remote banking from anywhere, but throttled: a single
// transfer moves at most REMOTE_CAP credits in either direction. Bulk cash
// movement stays at the physical ATM (a terminal you have to be standing at,
// with a much higher network withdrawal_limit). Reuses the engine's
// transferCredits (server/engine/economy.js) — the exact function the ATM
// plugin's own deposit/withdraw commands call — and logs through atm's
// logBankTx so both paths share one ledger.
import { query } from '../../server/models/db.js';
import { transferCredits } from '../../server/engine/economy.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { registerTabletApp, normScreen } from './registry.js';

// Per-transfer ceiling for remote (tablet) banking. Bigger moves go through an ATM.
const REMOTE_CAP = 500;

// One remote move of each kind per 24 in-game hours (real time at the default 1×
// game speed). Deposit and withdraw run on separate timers — spending your
// withdraw doesn't lock out a deposit. Stored per-player as an epoch-second
// stamp of the last move; the ATM path is unaffected.
const COOLDOWN_SEC = 24 * 3600;
const FLAG = { deposit: 'tablet_bank_deposit_at', withdraw: 'tablet_bank_withdraw_at' };

function nowSec() { return Math.floor(Date.now() / 1000); }

// Seconds left on a deposit/withdraw timer, or 0 if ready.
async function cooldownLeft(player, kind) {
  const last = parseInt(await getFlag('player', FLAG[kind], player), 10);
  if (!Number.isFinite(last)) return 0;
  return Math.max(0, last + COOLDOWN_SEC - nowSec());
}

// "3h 12m" / "45m" / "30s" — coarse, human wait time.
function fmtWait(sec) {
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`;
  if (sec >= 60) return `${Math.ceil(sec / 60)}m`;
  return `${sec}s`;
}

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

  const depLeft = await cooldownLeft(player, 'deposit');
  const wdLeft = await cooldownLeft(player, 'withdraw');

  const depAction = depLeft > 0
    ? { id: 'deposit', label: `Deposit — ready in ${fmtWait(depLeft)}`, disabled: true }
    : { id: 'deposit', label: `Deposit (max ₵${REMOTE_CAP})`, prompt: `Deposit how much? (max ₵${REMOTE_CAP})` };
  const wdAction = wdLeft > 0
    ? { id: 'withdraw', label: `Withdraw — ready in ${fmtWait(wdLeft)}`, disabled: true }
    : { id: 'withdraw', label: `Withdraw (max ₵${REMOTE_CAP})`, prompt: `Withdraw how much? (max ₵${REMOTE_CAP})` };

  return {
    view: 'detail',
    breadcrumb: [],
    detail: {
      name: 'Bank',
      desc: `Remote banking — up to ₵${REMOTE_CAP} per transfer, once every 24h each way. Use an ATM to move more.`,
      rows: [
        { label: 'On hand', value: `${balances.credits}c` },
        { label: 'Banked', value: `${balances.bank_credits}c` },
        { label: 'Next deposit', value: depLeft > 0 ? `in ${fmtWait(depLeft)}` : 'ready' },
        { label: 'Next withdrawal', value: wdLeft > 0 ? `in ${fmtWait(wdLeft)}` : 'ready' },
      ],
    },
    actions: [depAction, wdAction, { id: 'nav_history', label: 'Transaction History' }],
  };
}

async function handleAction(player, actionId, params) {
  if (actionId === 'nav_history') return buildScreen(player, 'History', '');

  if (actionId === 'deposit' || actionId === 'withdraw') {
    const amount = parseInt(params, 10);
    if (!Number.isFinite(amount) || amount <= 0) return { view: 'error', message: 'Enter an amount to move.' };
    if (amount > REMOTE_CAP) {
      return { view: 'error', message: `Remote transfers cap at ₵${REMOTE_CAP}. Use an ATM to move more.` };
    }
    const left = await cooldownLeft(player, actionId);
    if (left > 0) {
      return { view: 'error', message: `Remote ${actionId} on cooldown — try again in ${fmtWait(left)} (or use an ATM).` };
    }
    if (!await transferCredits(player, amount, actionId)) {
      return { view: 'error', message: actionId === 'deposit'
        ? `You only have ${player.credits || 0}c on you.`
        : `You only have ${player.bank_credits || 0}c banked.` };
    }
    const { logBankTx } = await import('../atm/index.js');
    await logBankTx(player.id, actionId, amount, player.bank_credits);
    await setFlag('player', FLAG[actionId], nowSec(), player);
    return buildScreen(player, null, '');
  }

  return buildScreen(player, null, '');
}

registerTabletApp({
  id: 'bank', name: 'Bank', icon: '🏦', category: 'Finance',
  buildHome, buildScreen, handleAction,
});
