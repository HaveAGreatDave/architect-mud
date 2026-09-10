// Two-sided player trade — the safe, mutual way to swap items AND credits, driven
// by a shared two-panel window (client/game/js/panels/trade.js). The panel is the
// default interface; its buttons fire the same commands you can type.
//
// Flow: `trade <player>` (same room) sends an invite; they `trade <you>` (or click
// Accept) to open the window for both. Each side stakes items (`tradeoffer <id>
// [qty]`) and/or credits (`tradeoffer credits <n>`), retracts (`traderetract …`),
// and locks in (`tradeready`). ANY change to either offer unlocks BOTH sides — the
// classic anti-scam rule, so nobody can swap in junk after you've confirmed. When
// both are locked, the swap runs as ONE transaction: items move both ways, credits
// move both ways, all-or-nothing. Nothing is escrowed — staged goods stay in your
// inventory until the swap, and the transaction re-validates ownership at execute,
// so a session lost to a restart simply never happened (no goods in limbo).
import { randomUUID } from 'crypto';
import { query, withTransaction } from '../../server/models/db.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { getZonePlayers, getLivePlayer } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { resolve as siftResolve } from '../../server/engine/sift.js';
import { on } from '../../server/engine/events.js';
import { prefersLoggedPanelsOrDefault } from '../../server/engine/presentation.js';

const INVITE_TTL_MS = 60000;
const sessions = new Map();   // playerId -> session (both participants map to the same object)
const invites = new Map();    // targetId -> { fromId, fromHandle, timer }

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// The player's swappable inventory: carried, un-equipped, non-quest.
async function tradeableRows(playerId) {
  const { rows } = await query(
    `SELECT pi.id, pi.item_id, pi.quantity, i.name
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1 AND pi.is_equipped = 0 AND pi.container_id IS NULL
        AND NOT (i.tags @> '{"quest_item":true}')
      ORDER BY i.name`,
    [playerId]
  ).catch(() => ({ rows: [] }));
  return rows;
}

function otherOf(session, id) { return session.players.find(p => p !== id); }
function resetReady(session) { for (const p of session.players) session.offers[p].ready = false; }

function clearInvite(targetId) {
  const inv = invites.get(targetId);
  if (inv?.timer) clearTimeout(inv.timer);
  invites.delete(targetId);
}

// ── Rendering (server owns the HTML; the client just injects it) ───────────────
async function renderFor(session, viewerId) {
  const otherId = otherOf(session, viewerId);
  const me = session.offers[viewerId], them = session.offers[otherId];
  const theirHandle = esc(session.handles[otherId]);

  const stakedItem = (it, mine) =>
    `<div class="trade-item"><span>${esc(it.name)}${it.qty > 1 ? ` ×${it.qty}` : ''}</span>${mine ? `<button class="trade-btn" data-cmd="traderetract ${it.invId}">✕</button>` : ''}</div>`;

  const sideHtml = (off, mine) => {
    const rows = off.items.map(it => stakedItem(it, mine)).join('');
    const credits = off.credits > 0
      ? `<div class="trade-item"><span>₵${off.credits}</span>${mine ? `<button class="trade-btn" data-cmd="traderetract credits">✕</button>` : ''}</div>`
      : '';
    const empty = (!off.items.length && off.credits <= 0) ? `<div class="trade-empty">— nothing —</div>` : '';
    const ready = off.ready ? `<div class="trade-ready on">✓ locked in</div>` : `<div class="trade-ready">not locked</div>`;
    return `${rows}${credits}${empty}${ready}`;
  };

  const staged = new Set(me.items.map(i => i.invId));
  const avail = (await tradeableRows(viewerId)).filter(r => !staged.has(r.id));
  const invRows = avail.map(r =>
    `<div class="trade-inv-row"><span>${esc(r.name)}${r.quantity > 1 ? ` (×${r.quantity})` : ''}</span>` +
    (r.quantity > 1 ? `<input class="trade-qty" data-qty-for="${r.id}" type="number" min="1" max="${r.quantity}" value="${r.quantity}">` : '') +
    `<button class="trade-btn" data-add="${r.id}">Add</button></div>`
  ).join('') || `<div class="trade-empty">Nothing to offer.</div>`;

  const lockBtn = me.ready
    ? `<button class="trade-btn on" data-cmd="tradeready">Unlock</button>`
    : `<button class="trade-btn" data-cmd="tradeready">Lock in offer</button>`;

  return `
    <div class="trade-title">TRADE — you ⇄ ${theirHandle}</div>
    <div class="trade-cols">
      <div class="trade-col"><h4>YOUR OFFER</h4>${sideHtml(me, true)}</div>
      <div class="trade-col"><h4>${theirHandle.toUpperCase()}'S OFFER</h4>${sideHtml(them, false)}</div>
    </div>
    <div class="trade-credits-row">
      <input id="trade-credits-input" type="number" min="0" placeholder="credits…">
      <button class="trade-btn" data-credits-stake>Stake ₵</button>
    </div>
    <div class="trade-inv"><h4>YOUR ITEMS</h4>${invRows}</div>
    <div class="trade-foot">${lockBtn}<button class="trade-btn trade-cancel" data-cmd="tradecancel">Cancel</button></div>`;
}

// ── The written record ───────────────────────────────────────────────────────
// THE ANTI-SCAM RULE IS WHY THIS EXISTS. "Any change to either offer unlocks both
// sides" only protects you if you can SEE what the other side is offering — a
// player who can't is being asked to lock in blind, which is worse than having no
// protection at all because the rule implies one.
//
// Until now four of the five pushBoth call sites passed no message, so staking,
// retracting, locking and unlocking produced ZERO log output: the entire trade was
// in a panel, and the buttons submitted silently (sendCmdSilent), so even the
// commands didn't appear. Closing the window mid-trade left no trace of what had
// been agreed.
//
// So the log now carries the record for EVERYONE, not just players on a text rung.
// The panel is the show; this is the receipt.
function offerLines(session, viewerId) {
  const otherId = otherOf(session, viewerId);
  const me = session.offers[viewerId], them = session.offers[otherId];
  const side = (off, who) => {
    const bits = off.items.map(it => `${esc(it.name)}${it.qty > 1 ? ` ×${it.qty}` : ''}`);
    if (off.credits > 0) bits.push(`₵${off.credits}`);
    const lock = off.ready
      ? '<span class="text-green">✓ locked in</span>'
      : '<span class="text-dim">not locked</span>';
    return `  <b>${who}</b>: ${bits.length ? bits.join(', ') : '<span class="text-dim">nothing</span>'} — ${lock}`;
  };
  return [
    side(me, 'You'),
    side(them, esc(session.handles[otherId])),
  ].join('\n');
}

// `trade status` and every state change print this.
//
// The RECORD — the headline and the offer lines — is identical both ways, so what
// you re-read on demand is exactly what you were told. What differs is the footer
// of available verbs: it prints when you ASK for the board, and not on each state
// change. It is four lines of unchanging boilerplate that was being pushed to both
// players on every offer, retraction and ready toggle, which in a busy trade is
// most of what the log contains. Nothing is lost — `trade status` is itself listed
// in that footer, and a player who wants the verbs back asks for them.
function statusBlock(session, viewerId, headline, withVerbs = true) {
  const board = `${headline ? `${headline}\n` : ''}${offerLines(session, viewerId)}`;
  if (!withVerbs) return board;
  return `${board}\n`
    + `<span class="text-dim">tradeoffer &lt;item&gt; · tradeoffer credits &lt;n&gt; · traderetract &lt;item&gt; · `
    + `<span class="action-link" data-action="cmd" data-cmd="trade status">trade status</span> · `
    + `<span class="action-link" data-action="cmd" data-cmd="tradeready">tradeready</span> · `
    + `<span class="action-link" data-action="cmd" data-cmd="tradecancel">tradecancel</span></span>`;
}

// `headline` is what just happened, phrased per viewer — "You staked X" vs
// "Cyd staked X" — so the log reads as a conversation rather than a diff.
async function pushBoth(session, sysMsg, headlineFor) {
  for (const pid of session.players) {
    // A player on the bottom Display Mode rung gets no panel at all; the log IS
    // their trade window. Everyone else gets both — the panel to act in, the log
    // as the record.
    if (!(await prefersLoggedPanelsOrDefault(getLivePlayer(pid) || { id: pid }))) {
      const html = await renderFor(session, pid);
      sendToPlayer(pid, { type: 'trade_update', html });
    }
    const headline = typeof headlineFor === 'function' ? headlineFor(pid) : null;
    // withVerbs:false — this is a state change, not a request for the board.
    if (headline) sendToPlayer(pid, { type: 'output', message: statusBlock(session, pid, headline, false) });
    if (sysMsg) sendToPlayer(pid, { type: 'output', message: sysMsg });
  }
}

// ── Session lifecycle ─────────────────────────────────────────────────────────
async function openSession(a, b) {
  const session = {
    players: [a.id, b.id],
    handles: { [a.id]: a.handle, [b.id]: b.handle },
    zone: a.current_zone,
    offers: { [a.id]: { items: [], credits: 0, ready: false }, [b.id]: { items: [], credits: 0, ready: false } },
  };
  sessions.set(a.id, session);
  sessions.set(b.id, session);
  await pushBoth(session, null, (pid) => `<span class="msg-system">Trade open with ${esc(session.handles[otherOf(session, pid)])}.</span>`);
}

function closeSession(session, perPlayerMsg) {
  for (const pid of session.players) {
    sessions.delete(pid);
    sendToPlayer(pid, { type: 'trade_close' });
    const msg = typeof perPlayerMsg === 'function' ? perPlayerMsg(pid) : perPlayerMsg;
    if (msg) sendToPlayer(pid, { type: 'output', message: msg });
  }
}

async function cancelFor(playerId, reason) {
  const session = sessions.get(playerId);
  if (!session) return false;
  closeSession(session, `<span class="msg-system">${reason}</span>`);
  return true;
}

// ── Commands ──────────────────────────────────────────────────────────────────
function acceptInvite(player, inv) {
  const a = getLivePlayer(inv.fromId);
  clearInvite(player.id);
  if (!a) return { type: 'error', message: 'They\'re no longer around.' };
  if (a.current_zone !== player.current_zone) return { type: 'error', message: `You need to be in the same room as ${a.handle} to trade.` };
  if (sessions.get(a.id)) return { type: 'error', message: `${a.handle} is already in a trade.` };
  openSession(a, player);
  return { type: 'noop' };
}

async function cmdTrade(args, raw, player, broadcast) {
  // `trade status` — re-read both offers on demand. For EVERYONE, not just players
  // on a text rung: the anti-scam rule ("any change unlocks both sides") is only a
  // protection if you can check what you are about to lock in against, and after a
  // few lines of combat spam a visual player has lost the panel's history too.
  if (/^(status|check|show)$/i.test((args[0] || '').trim())) {
    const s = sessions.get(player.id);
    if (!s) return { type: 'error', message: "You aren't in a trade." };
    return { type: 'output', message: statusBlock(s, player.id, '<span class="text-cyan">TRADE</span>') };
  }

  if (sessions.get(player.id)) return { type: 'error', message: 'Finish your current trade first (or `tradecancel`).' };
  const who = args.join(' ').trim();
  const inv = invites.get(player.id);
  if (!who) return inv ? acceptInvite(player, inv) : { type: 'error', message: 'Trade with whom?' };

  const pool = getZonePlayers(player.current_zone).filter(p => p.id !== player.id).map(p => ({ ...p, name: p.handle }));
  if (!pool.length) return { type: 'error', message: 'Nobody here to trade with.' };
  const r = siftResolve(who, pool);
  if (r.type === 'none') return { type: 'error', message: `There's no "${who}" here.` };
  if (r.type === 'ambiguous') return { type: 'error', message: `Who do you mean — ${r.candidates.map(c => c.handle).join(', ')}?` };
  const target = r.candidate;

  if (inv && inv.fromId === target.id) return acceptInvite(player, inv);   // they invited me → accept
  if (sessions.get(target.id)) return { type: 'error', message: `${target.handle} is already in a trade.` };

  clearInvite(target.id);
  const timer = setTimeout(() => {
    if (invites.get(target.id)?.fromId === player.id) {
      invites.delete(target.id);
      sendToPlayer(player.id, { type: 'output', message: `<span class="msg-system">${target.handle} didn't respond to your trade request.</span>` });
    }
  }, INVITE_TTL_MS);
  invites.set(target.id, { fromId: player.id, fromHandle: player.handle, timer });
  sendToPlayer(target.id, { type: 'output', message: `<span class="msg-system">${player.handle} wants to trade. <span class="action-link" data-raw-cmd="trade ${esc(player.handle)}" data-label="accept trade">Accept</span>, or type <b>trade ${esc(player.handle)}</b>.</span>` });
  return { type: 'output', message: `You offer to trade with ${target.handle}. Waiting on them.` };
}

async function cmdTradeoffer(args, raw, player) {
  const session = sessions.get(player.id);
  if (!session) return { type: 'error', message: "You aren't in a trade." };
  const off = session.offers[player.id];

  if ((args[0] || '').toLowerCase() === 'credits') {
    const n = Math.max(0, parseInt(args[1], 10) || 0);
    if (n <= 0) return { type: 'error', message: 'Stake how many credits?' };
    const have = getLivePlayer(player.id)?.credits ?? player.credits ?? 0;
    if (n > have) return { type: 'error', message: `You only have ₵${have}.` };
    off.credits = n;
  } else {
    const token = args[0];
    if (!token) return { type: 'error', message: 'Offer what?' };
    const qty = Math.max(1, parseInt(args[1], 10) || 1);
    const rows = await tradeableRows(player.id);
    let row = rows.find(r => r.id === token);
    if (!row) { const r = siftResolve(token, rows.map(x => ({ ...x, name: x.name }))); row = r.type === 'match' ? r.candidate : null; }
    if (!row) return { type: 'error', message: `You've nothing tradeable matching "${token}".` };
    off.items = off.items.filter(i => i.invId !== row.id);   // restage if already there
    off.items.push({ invId: row.id, qty: Math.min(qty, row.quantity), name: row.name });
  }
  resetReady(session);
  const staked = (args[0] || '').toLowerCase() === 'credits'
    ? `₵${off.credits}`
    : (off.items[off.items.length - 1]?.name || 'something');
  await pushBoth(session, null, (pid) => pid === player.id
    ? `<span class="msg-system">You stake ${esc(staked)}. Both sides unlocked.</span>`
    : `<span class="msg-system">${esc(player.handle)} stakes ${esc(staked)}. Both sides unlocked.</span>`);
  return { type: 'noop' };
}

async function cmdTraderetract(args, raw, player) {
  const session = sessions.get(player.id);
  if (!session) return { type: 'error', message: "You aren't in a trade." };
  const off = session.offers[player.id];
  const token = (args[0] || '').trim();
  if (token.toLowerCase() === 'credits') off.credits = 0;
  else if (token) off.items = off.items.filter(i => i.invId !== token && !i.name.toLowerCase().includes(token.toLowerCase()));
  else return { type: 'error', message: 'Retract what?' };
  resetReady(session);
  await pushBoth(session, null, (pid) => pid === player.id
    ? '<span class="msg-system">You take something back off the table. Both sides unlocked.</span>'
    : `<span class="msg-system">${esc(player.handle)} takes something back off the table. Both sides unlocked.</span>`);
  return { type: 'noop' };
}

async function cmdTradeready(args, raw, player) {
  const session = sessions.get(player.id);
  if (!session) return { type: 'error', message: "You aren't in a trade." };
  const off = session.offers[player.id];
  off.ready = !off.ready;
  if (session.players.every(p => session.offers[p].ready)) { await executeTrade(session); return { type: 'noop' }; }
  await pushBoth(session, null, (pid) => pid === player.id
    ? `<span class="msg-system">You ${off.ready ? 'lock in' : 'unlock'} your offer.</span>`
    : `<span class="msg-system">${esc(player.handle)} ${off.ready ? 'locks in' : 'unlocks'}.</span>`);
  return { type: 'noop' };
}

async function cmdTradecancel(args, raw, player) {
  if (!(await cancelFor(player.id, 'Trade cancelled.'))) return { type: 'error', message: "You aren't in a trade." };
  return { type: 'noop' };
}

// ── The swap ──────────────────────────────────────────────────────────────────
// Move `qty` units of an inventory row to another player, splitting the stack when
// it's a partial move. Throws if the row vanished or is now equipped (→ rollback).
async function moveItem(tx, invId, toPlayerId, qty) {
  const { rows } = await tx('SELECT id, item_id, quantity, condition, is_equipped, custom_data FROM player_inventory WHERE id=$1', [invId]);
  const r = rows[0];
  if (!r || r.is_equipped) throw new Error('gone');
  const q = Math.min(qty, r.quantity);
  if (q <= 0) throw new Error('gone');
  if (q >= r.quantity) {
    await tx('UPDATE player_inventory SET player_id=$1, slot=NULL, layer=NULL, is_equipped=0, container_id=NULL WHERE id=$2', [toPlayerId, invId]);
  } else {
    await tx('UPDATE player_inventory SET quantity=quantity-$1 WHERE id=$2', [q, invId]);
    await tx('INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, is_equipped, custom_data) VALUES ($1,$2,$3,$4,$5,0,$6)',
      [randomUUID(), toPlayerId, r.item_id, q, r.condition ?? 1.0, r.custom_data ? JSON.stringify(r.custom_data) : '{}']);
  }
}

async function resyncCredits(pid) {
  const live = getLivePlayer(pid);
  if (!live) return;
  const { rows } = await query('SELECT credits FROM players WHERE id=$1', [pid]).catch(() => ({ rows: [] }));
  if (rows[0]) live.credits = rows[0].credits;
}

async function executeTrade(session) {
  const [aId, bId] = session.players;
  const aOff = session.offers[aId], bOff = session.offers[bId];
  const aP = getLivePlayer(aId), bP = getLivePlayer(bId);

  try {
    await withTransaction(async (tx) => {
      for (const it of aOff.items) await moveItem(tx, it.invId, bId, it.qty);
      for (const it of bOff.items) await moveItem(tx, it.invId, aId, it.qty);
      if (aOff.credits > 0) {
        if (!(await adjustCredits(aP || { id: aId, credits: 0 }, -aOff.credits, tx, 'trade:credits'))) throw new Error('credits');
        await adjustCredits(bP || { id: bId, credits: 0 }, aOff.credits, tx, 'trade:credits');
      }
      if (bOff.credits > 0) {
        if (!(await adjustCredits(bP || { id: bId, credits: 0 }, -bOff.credits, tx, 'trade:credits'))) throw new Error('credits');
        await adjustCredits(aP || { id: aId, credits: 0 }, bOff.credits, tx, 'trade:credits');
      }
    });
  } catch (e) {
    // Rolled back — un-ready both and re-render so they can retry.
    await resyncCredits(aId); await resyncCredits(bId);
    resetReady(session);
    await pushBoth(session, `<span class="text-red">The trade fell through — someone no longer has what they staked. Both sides unlocked.</span>`);
    return;
  }

  await resyncCredits(aId); await resyncCredits(bId);
  const gotLine = (off) => {
    const parts = off.items.map(i => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}`);
    if (off.credits > 0) parts.push(`₵${off.credits}`);
    return parts.length ? parts.join(', ') : 'nothing';
  };
  closeSession(session, (pid) => {
    const theirs = pid === aId ? bOff : aOff;
    return `<span class="msg-system">Trade complete — you received: ${esc(gotLine(theirs))}.</span>`;
  });
}

// ── Cancellation triggers ─────────────────────────────────────────────────────
on('player.logout', ({ id }) => {
  clearInvite(id);
  for (const [tid, o] of invites) if (o.fromId === id) clearInvite(tid);
  cancelFor(id, 'The other trader disconnected — trade cancelled.');
});

// Walking out of the room ends the trade (trades are face-to-face).
on('zone.entered', ({ actor, zone }) => {
  const s = actor?.id ? sessions.get(actor.id) : null;
  if (s && zone !== s.zone) cancelFor(actor.id, 'You left the room — trade cancelled.');
});

export const commands = {
  trade: cmdTrade,
  tradeoffer: cmdTradeoffer,
  traderetract: cmdTraderetract,
  tradeready: cmdTradeready,
  tradecancel: cmdTradecancel,
};

export const _test = { tradeableRows, esc, offerLines, statusBlock };

console.log('[trade] Plugin loaded.');
