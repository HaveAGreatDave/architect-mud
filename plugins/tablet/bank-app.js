// Tablet OS — Bank app. Remote banking from anywhere, but throttled: a single
// transfer moves at most REMOTE_CAP credits in either direction. Bulk cash
// movement stays at the physical ATM (a terminal you have to be standing at,
// with a much higher network withdrawal_limit) — and past THAT ceiling, at a
// bank counter with a `bank_teller` NPC, which is uncapped. Reuses the engine's
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

// ── Home widget: what's in your pocket, and the thing nobody tells you ───────
// The numbers are already on the live player object, so this costs nothing (the
// buildWidget contract in index.js forbids a query here). What earns it a slot is
// the SECOND line: cash on hand is what a mugging, a booking or a death takes off
// you, and banked cash isn't. That is the single most expensive thing a new player
// learns the hard way.
function buildWidget(player) {
  const cash = Number(player.credits) || 0;
  const banked = Number(player.bank_credits) || 0;
  const total = cash + banked;
  const exposed = cash >= 500;
  // DRAWN, not listed. The bar makes the point the two figures never did: how much
  // of your money is walking around with you. A wide red band is a warning you read
  // before you've read a number — which is the whole reason to draw it.
  return {
    id: 'pocket',
    title: 'Pocket',
    kind: 'bar',
    segments: [
      { pct: total ? (cash / total) * 100 : 0, tone: exposed ? 'bad' : 'warn', label: `₵${cash.toLocaleString()} on you` },
      { pct: total ? (banked / total) * 100 : 100, tone: 'good', label: `₵${banked.toLocaleString()} banked` },
    ],
    note: total === 0 ? 'Broke. The job board pays.'
      : exposed ? 'Carried credits are lost if you are robbed, booked or killed.'
      : 'Banked credits survive anything. An ATM does it in one command.',
  };
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

// ── `wire` — the remote transfer, by typing ──────────────────────────────────
// `deposit`/`withdraw` (plugins/atm) need an ATM or a teller in the room. The
// small-and-slow remote move — capped, once a day, no machine required — existed
// only as this app's two buttons, so a player without a tablet had no way to
// touch their account away from a terminal. Deliberately a DIFFERENT verb rather
// than a fallback inside `deposit`: the ATM path has no cap and no cooldown, and
// silently routing a machineless `deposit` through the capped path would make one
// verb mean two quite different things depending on where you stood.
export async function cmdWire(args, raw, player) {
  const kind = (args[0] || '').toLowerCase() === 'withdraw' ? 'withdraw'
    : (args[0] || '').toLowerCase() === 'deposit' ? 'deposit' : null;

  if (!kind) {
    const dep = await cooldownLeft(player, 'deposit');
    const wd = await cooldownLeft(player, 'withdraw');
    return {
      type: 'output',
      message: `<span class="text-cyan">REMOTE BANKING</span> <span class="text-dim">— cap ₵${REMOTE_CAP} per move, once a day each way</span>\n`
        + `  On you: ₵${player.credits || 0} · Banked: ₵${player.bank_credits || 0}\n`
        + `  <span class="text-dim">deposit ${dep > 0 ? `ready in ${fmtWait(dep)}` : 'ready'}`
        + ` · withdraw ${wd > 0 ? `ready in ${fmtWait(wd)}` : 'ready'}</span>\n`
        + `<span class="text-dim">wire deposit &lt;amount&gt; · wire withdraw &lt;amount&gt; · an ATM moves any sum with no wait</span>`,
    };
  }

  const amount = parseInt(args[1], 10);
  if (!Number.isFinite(amount) || amount <= 0) return { type: 'error', message: `How much? "wire ${kind} <amount>".` };
  if (amount > REMOTE_CAP) return { type: 'error', message: `Remote transfers cap at ₵${REMOTE_CAP}. Use an ATM to move more.` };

  const left = await cooldownLeft(player, kind);
  if (left > 0) return { type: 'error', message: `Remote ${kind} on cooldown — try again in ${fmtWait(left)} (or use an ATM).` };

  if (!await transferCredits(player, amount, kind)) {
    return { type: 'error', message: kind === 'deposit'
      ? `You only have ₵${player.credits || 0} on you.`
      : `You only have ₵${player.bank_credits || 0} banked.` };
  }
  const { logBankTx } = await import('../atm/index.js');
  await logBankTx(player.id, kind, amount, player.bank_credits);
  await setFlag('player', FLAG[kind], nowSec(), player);
  return {
    type: 'output',
    message: `<span class="msg-system">₵${amount} ${kind === 'deposit' ? 'in' : 'out'}. Banked: ₵${player.bank_credits || 0} · On you: ₵${player.credits || 0}</span>`,
    player_update: { credits: player.credits, bank_credits: player.bank_credits },
  };
}

registerTabletApp({
  id: 'bank', name: 'Bank', icon: '🏦', category: 'Finance',
  buildHome, buildScreen, handleAction, buildWidget,
});
