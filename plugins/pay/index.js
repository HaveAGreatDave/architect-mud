// Player-to-player credit transfer — the "safe", agreed-upon way to hand cash
// over. `pay <player> <amount>` opens an offer the recipient must `acceptpay`
// (or `declinepay`); nothing moves until they agree. Offers are same-room and
// expire after 60s.
//
// No escrow: the debit + credit happen atomically at accept time (one
// transaction), so funds are re-checked then. That means nothing sits in limbo
// across a restart, and the payer can't be double-charged — if they've spent the
// money by the time the recipient accepts, the accept simply fails.
import { adjustCredits } from '../../server/engine/economy.js';
import { withTransaction } from '../../server/models/db.js';
import { getZonePlayers, getLivePlayer } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { resolve as siftResolve } from '../../server/engine/sift.js';
import { on } from '../../server/engine/events.js';

const OFFER_TTL_MS = 60000;
const pendingPay = new Map();   // recipientId -> { fromId, fromHandle, amount, timer }

function clearOffer(recipientId) {
  const o = pendingPay.get(recipientId);
  if (o?.timer) clearTimeout(o.timer);
  pendingPay.delete(recipientId);
}

// Parse "pay <who> <amount>" — the amount is the numeric token, the rest is the name.
function parsePay(args) {
  let amount = null; const nameToks = [];
  for (const t of args.filter(Boolean)) {
    if (amount === null && /^\d+$/.test(t)) amount = parseInt(t, 10);
    else nameToks.push(t);
  }
  return { who: nameToks.join(' ').trim(), amount };
}

async function cmdPay(args, raw, player, broadcast) {
  const { who, amount } = parsePay(args);
  if (!who || amount === null) return { type: 'error', message: 'Usage: pay <player> <amount>.' };
  if (amount <= 0) return { type: 'error', message: 'Pay a positive amount.' };
  const pool = getZonePlayers(player.current_zone).filter(p => p.id !== player.id).map(p => ({ ...p, name: p.handle }));
  if (!pool.length) return { type: 'error', message: 'Nobody here to pay.' };
  const r = siftResolve(who, pool);
  if (r.type === 'none') return { type: 'error', message: `There's no "${who}" here.` };
  if (r.type === 'ambiguous') return { type: 'error', message: `Who do you mean — ${r.candidates.map(c => c.handle).join(', ')}?` };
  const target = r.candidate;
  if ((player.credits || 0) < amount) return { type: 'error', message: `You don't have ₵${amount} on hand.` };

  clearOffer(target.id);
  const timer = setTimeout(() => {
    const o = pendingPay.get(target.id);
    if (!o || o.fromId !== player.id) return;
    pendingPay.delete(target.id);
    sendToPlayer(player.id, { type: 'output', message: `<span class="msg-system">${target.handle} never took your ₵${amount}. You pocket it again.</span>` });
    sendToPlayer(target.id, { type: 'output', message: `<span class="msg-system">The ₵${amount} ${player.handle} offered goes unclaimed.</span>` });
  }, OFFER_TTL_MS);
  pendingPay.set(target.id, { fromId: player.id, fromHandle: player.handle, amount, timer });

  sendToPlayer(target.id, { type: 'output', message: `<span class="msg-system">${player.handle} offers you <b>₵${amount}</b>. Type <b>acceptpay</b> to take it, or <b>declinepay</b> to wave it off.</span>` });
  return { type: 'output', message: `You hold out ₵${amount} to ${target.handle} — waiting on them to accept.` };
}

async function cmdAcceptPay(args, raw, player) {
  const offer = pendingPay.get(player.id);
  if (!offer) return { type: 'error', message: "Nobody's offering you any credits." };
  const payer = getLivePlayer(offer.fromId);
  if (!payer) { clearOffer(player.id); return { type: 'error', message: "Whoever offered that's gone." }; }
  clearOffer(player.id);

  let failed = null;
  try {
    await withTransaction(async (tx) => {
      if (!(await adjustCredits(payer, -offer.amount, tx, 'pay:send'))) { failed = 'funds'; throw new Error('rollback'); }
      await adjustCredits(player, offer.amount, tx, 'pay:receive');
    });
  } catch {
    if (failed === 'funds') return { type: 'error', message: `${payer.handle} can't cover that anymore.` };
    return { type: 'error', message: 'The transfer glitched — nothing moved.' };
  }
  sendToPlayer(payer.id, { type: 'output', message: `<span class="msg-system">${player.handle} accepts your ₵${offer.amount}. (Balance: ₵${payer.credits})</span>` });
  return { type: 'output', message: `You take ₵${offer.amount} from ${payer.handle}. (Balance: ₵${player.credits})` };
}

async function cmdDeclinePay(args, raw, player) {
  const offer = pendingPay.get(player.id);
  if (!offer) return { type: 'error', message: "Nobody's offering you any credits." };
  clearOffer(player.id);
  const payer = getLivePlayer(offer.fromId);
  if (payer) sendToPlayer(payer.id, { type: 'output', message: `<span class="msg-system">${player.handle} waves off your ₵${offer.amount}.</span>` });
  return { type: 'output', message: `You decline ${offer.fromHandle}'s ₵${offer.amount}.` };
}

async function cmdCancelPay(args, raw, player) {
  for (const [rid, o] of pendingPay) {
    if (o.fromId === player.id) {
      clearOffer(rid);
      const rec = getLivePlayer(rid);
      if (rec) sendToPlayer(rec.id, { type: 'output', message: `<span class="msg-system">${player.handle} pulls back their ₵${o.amount} offer.</span>` });
      return { type: 'output', message: `You pull back your ₵${o.amount} offer.` };
    }
  }
  return { type: 'error', message: "You've no pending payment to cancel." };
}

// A player leaving clears any offer waiting on them and any they were making.
on('player.logout', ({ id }) => {
  clearOffer(id);
  for (const [rid, o] of pendingPay) if (o.fromId === id) clearOffer(rid);
});

export const commands = {
  pay: cmdPay,
  acceptpay: cmdAcceptPay,
  declinepay: cmdDeclinePay,
  cancelpay: cmdCancelPay,
};

export const _test = { parsePay };

console.log('[pay] Plugin loaded.');
