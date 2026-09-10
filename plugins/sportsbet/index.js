// Player-vs-player sports betting on the live baseball broadcast (DEADBALL).
//
// Flow: `wager <player> <amount> <team> [away-home]` proposes a bet on the game
// currently airing — you stake <amount> that <team> wins, optionally calling the
// exact final score. The opponent `takewager [away-home]` locks it, taking the
// OTHER team. Both stakes are escrowed (debited) on lock; when that airing's game
// reaches its final the pot is paid out and both players are notified with the
// winner, final score, and the bet details. `cancelwager` pulls an un-taken offer.
//
// Payout rule (honours "winner + exact-score bonus"): normally the player who
// called the winning team takes the pot — BUT a correctly-called EXACT final
// score trumps the team pick (so an underdog bettor who nails the score steals
// it). If both call the same exact score, or the game ties, it's a push (refund).
//
// The whole game is decided the instant it airs (the broadcast just reveals it),
// so the outcome is captured at lock time and stored on the bet row; the payout
// is scheduled for the broadcast's final. Locked bets persist in `sports_bets`
// and settle via a 1-minute sweep, so a restart never loses or double-pays one.
import { randomUUID } from 'crypto';
import { createWorkGate } from '../../server/engine/worklist.js';
import { query, withTransaction } from '../../server/models/db.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { getZonePlayers, getLivePlayer } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { resolve as siftResolve } from '../../server/engine/sift.js';
import { on } from '../../server/engine/events.js';
import { schedule } from '../../server/engine/scheduler.js';

const OFFER_TTL_MS = 60000;

// Latest game per channel, from the broadcast's `sports.game` event.
const activeGames = new Map();   // channelId -> { gameId, channelId, away, home, awayScore, homeScore, winner, endsAtMs }
// Un-taken wager offers, keyed by the invited opponent.
const pendingWagers = new Map(); // opponentId -> { fromId, fromHandle, amount, team, score, game, timer }

on('sports.game', (g) => {
  if (!g?.gameId || !g.channelId) return;
  activeGames.set(g.channelId, { ...g });
});

// The desk takes action on whatever is on the air, so its wording follows the sport
// rather than assuming a ballgame — a hockey wager confirmed with a baseball emoji
// reads as a bug even though the money is right. The event carries `sport`; anything
// that doesn't declare one is Deadball, which is what shipped first.
const SPORT_LABEL = { baseball: { icon: '⚾', noun: 'baseball' }, hockey: { icon: '🏒', noun: 'hockey' } };
const labelOf = (g) => SPORT_LABEL[g?.sport] || SPORT_LABEL.baseball;

// The game currently on the air (soonest to wrap), pruning any that have ended.
function currentGame() {
  const now = Date.now();
  let best = null;
  for (const [cid, g] of activeGames) {
    if (g.endsAtMs <= now) { activeGames.delete(cid); continue; }
    if (!best || g.endsAtMs < best.endsAtMs) best = g;
  }
  return best;
}

function parseScore(tok) {
  const m = /^(\d+)-(\d+)$/.exec(tok || '');
  return m ? { away: parseInt(m[1], 10), home: parseInt(m[2], 10) } : null;
}

// "wager <player> <amount> <team...> [away-home]"
function parseWager(args) {
  const toks = args.filter(Boolean);
  const amtIdx = toks.findIndex(t => /^\d+$/.test(t));
  if (amtIdx <= 0) return null;                       // need a name before the amount
  const who = toks.slice(0, amtIdx).join(' ');
  const amount = parseInt(toks[amtIdx], 10);
  let rest = toks.slice(amtIdx + 1);
  let score = null;
  if (rest.length && /^\d+-\d+$/.test(rest[rest.length - 1])) { score = parseScore(rest[rest.length - 1]); rest = rest.slice(0, -1); }
  return { who, amount, team: rest.join(' ').trim(), score };
}

// Match a free-text team guess to one of the game's two teams. Returns the exact
// stored team name, or null if it fits neither / both ambiguously.
function pickTeam(input, game) {
  const s = (input || '').toLowerCase().trim();
  if (!s) return null;
  const a = game.away.toLowerCase(), h = game.home.toLowerCase();
  const hit = (name) => name.includes(s) || s.includes(name) || name.split(/\s+/).some(w => w === s);
  const ma = hit(a), mh = hit(h);
  if (ma && !mh) return game.away;
  if (mh && !ma) return game.home;
  return null;
}

function scoreEq(guess, awayScore, homeScore) {
  return !!guess && guess.away === awayScore && guess.home === homeScore;
}

function clearOffer(opponentId) {
  const o = pendingWagers.get(opponentId);
  if (o?.timer) clearTimeout(o.timer);
  pendingWagers.delete(opponentId);
}

async function cmdWager(args, raw, player, broadcast) {
  const parsed = parseWager(args);
  if (!parsed || !parsed.team) return { type: 'error', message: 'Usage: wager <player> <amount> <team> [away-home].' };
  const { who, amount, team, score } = parsed;
  if (amount <= 0) return { type: 'error', message: 'Wager a positive amount.' };

  const game = currentGame();
  if (!game) return { type: 'error', message: "There's no game on the air right now — nothing to bet on." };
  const myTeam = pickTeam(team, game);
  if (!myTeam) return { type: 'error', message: `Pick a side: ${game.away} or ${game.home}.` };

  const pool = getZonePlayers(player.current_zone).filter(p => p.id !== player.id).map(p => ({ ...p, name: p.handle }));
  if (!pool.length) return { type: 'error', message: 'Nobody here to bet with.' };
  const r = siftResolve(who, pool);
  if (r.type === 'none') return { type: 'error', message: `There's no "${who}" here.` };
  if (r.type === 'ambiguous') return { type: 'error', message: `Who do you mean — ${r.candidates.map(c => c.handle).join(', ')}?` };
  const target = r.candidate;
  if ((player.credits || 0) < amount) return { type: 'error', message: `You don't have ₵${amount} to stake.` };

  const otherTeam = myTeam === game.away ? game.home : game.away;
  const scoreNote = score ? ` (calling it ${score.away}-${score.home})` : '';
  clearOffer(target.id);
  const timer = setTimeout(() => {
    const o = pendingWagers.get(target.id);
    if (!o || o.fromId !== player.id) return;
    pendingWagers.delete(target.id);
    sendToPlayer(player.id, { type: 'output', message: `<span class="msg-system">${target.handle} never took your wager. It's off.</span>` });
    sendToPlayer(target.id, { type: 'output', message: `<span class="msg-system">${player.handle}'s wager offer lapses.</span>` });
  }, OFFER_TTL_MS);
  pendingWagers.set(target.id, { fromId: player.id, fromHandle: player.handle, amount, team: myTeam, score, game, timer });

  sendToPlayer(target.id, { type: 'output', message: `<span class="msg-system">${labelOf(game).icon} ${player.handle} wagers <b>₵${amount}</b> that the <b>${myTeam}</b> beat the ${otherTeam}${scoreNote}. Type <b>takewager</b> to take the ${otherTeam} (add a score guess like <b>takewager 5-3</b>), or just ignore it to pass.</span>` });
  return { type: 'output', message: `You offer ${target.handle} a ₵${amount} wager on the ${myTeam}${scoreNote}. Waiting on them to take it.` };
}

async function cmdTakeWager(args, raw, player, broadcast) {
  const offer = pendingWagers.get(player.id);
  if (!offer) return { type: 'error', message: "Nobody's offered you a wager." };

  // The game must still be the one on the air (a new airing means a new game).
  const live = currentGame();
  if (!live || live.gameId !== offer.game.gameId) { clearOffer(player.id); return { type: 'error', message: 'That game is over — the wager lapsed.' }; }

  const proposer = getLivePlayer(offer.fromId);
  if (!proposer) { clearOffer(player.id); return { type: 'error', message: "Whoever offered that's gone." }; }
  clearOffer(player.id);

  const g = offer.game;
  const myTeam = offer.team === g.away ? g.home : g.away;   // acceptor takes the other side
  const myScore = parseScore(args[0]) || null;

  // Escrow both stakes atomically. Either side short → nothing moves.
  let failed = null;
  try {
    await withTransaction(async (tx) => {
      if (!(await adjustCredits(proposer, -offer.amount, tx, 'sportsbet:stake'))) { failed = proposer.handle; throw new Error('rollback'); }
      if (!(await adjustCredits(player, -offer.amount, tx, 'sportsbet:stake'))) { failed = player.handle; throw new Error('rollback'); }
    });
  } catch {
    return { type: 'error', message: failed ? `${failed} can't cover the stake — the bet's off.` : 'The wager glitched — nothing moved.' };
  }

  const betId = randomUUID();
  try {
    await query(
      `INSERT INTO sports_bets
         (id, game_id, channel_id, amount, proposer_id, proposer_handle, proposer_team, proposer_score,
          acceptor_id, acceptor_handle, acceptor_team, acceptor_score,
          away_team, home_team, away_score, home_score, winner_team, resolve_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, to_timestamp($18/1000.0), 'locked')`,
      [betId, g.gameId, g.channelId, offer.amount,
       proposer.id, proposer.handle, offer.team, offer.score ? JSON.stringify(offer.score) : null,
       player.id, player.handle, myTeam, myScore ? JSON.stringify(myScore) : null,
       g.away, g.home, g.awayScore, g.homeScore, g.winner || null, g.endsAtMs]
    );
  } catch (e) {
    // Insert failed — unwind the escrow so nobody's stake vanishes.
    await adjustCredits(proposer, offer.amount, undefined, 'sportsbet:payout').catch(() => {});
    await adjustCredits(player, offer.amount, undefined, 'sportsbet:payout').catch(() => {});
    console.error('[sportsbet] lock error:', e.message);
    return { type: 'error', message: 'The wager desk glitched — your stakes are refunded, nothing locked.' };
  }

  betsGate.noteWork();   // something is now locked and will need settling
  const pot = offer.amount * 2;
  const line = `${labelOf(g).icon} Bet locked — ₵${offer.amount} each (₵${pot} pot). ${proposer.handle}: ${offer.team}${offer.score ? ` ${offer.score.away}-${offer.score.home}` : ''} · ${player.handle}: ${myTeam}${myScore ? ` ${myScore.away}-${myScore.home}` : ''}. Settles when the ${g.away}–${g.home} game ends.`;
  sendToPlayer(proposer.id, { type: 'output', message: `<span class="msg-system">${line}</span>` });
  return { type: 'output', message: `<span class="msg-system">${line}</span>` };
}

async function cmdCancelWager(args, raw, player) {
  for (const [oid, o] of pendingWagers) {
    if (o.fromId === player.id) {
      clearOffer(oid);
      const opp = getLivePlayer(oid);
      if (opp) sendToPlayer(opp.id, { type: 'output', message: `<span class="msg-system">${player.handle} pulls their wager offer.</span>` });
      return { type: 'output', message: `You pull back your ₵${o.amount} wager.` };
    }
  }
  return { type: 'error', message: "You've no pending wager to cancel." };
}

// ── Settlement ────────────────────────────────────────────────────────────────
// Decide who the pot goes to for one locked bet, pay it, and notify both sides.
async function settleBet(row) {
  const pot = row.amount * 2;
  const pScore = row.proposer_score || null;   // jsonb → object (or null)
  const aScore = row.acceptor_score || null;
  const pExact = scoreEq(pScore, row.away_score, row.home_score);
  const aExact = scoreEq(aScore, row.away_score, row.home_score);

  // winnerId: who takes the pot. null = push (split/refund).
  let winnerId = null, reason = '';
  if (pExact && !aExact) { winnerId = row.proposer_id; reason = 'exact-score call'; }
  else if (aExact && !pExact) { winnerId = row.acceptor_id; reason = 'exact-score call'; }
  else if (row.winner_team && !(pExact && aExact)) {
    if (row.proposer_team === row.winner_team) { winnerId = row.proposer_id; reason = 'called the winner'; }
    else if (row.acceptor_team === row.winner_team) { winnerId = row.acceptor_id; reason = 'called the winner'; }
  }
  // else: tie game, or both nailed the same exact score → push.

  // Pay out. A live player's in-memory balance is updated; an offline one is a
  // pure DB write (they see the balance on return).
  const credit = async (pid, amount) => {
    const live = getLivePlayer(pid);
    await adjustCredits(live || { id: pid, credits: 0 }, amount, undefined, 'sportsbet:payout').catch(() => {});
    return live;
  };
  if (winnerId) {
    await credit(winnerId, pot);
  } else {
    await credit(row.proposer_id, row.amount);   // push — hand each their stake back
    await credit(row.acceptor_id, row.amount);
  }
  await query(`UPDATE sports_bets SET status='settled' WHERE id=$1`, [row.id]).catch(() => {});

  // Notify both with the game result + the bet's outcome.
  const winLabel = row.winner_team ? `${row.winner_team} take it` : 'it ends in a tie';
  // Neutral marker here on purpose: settlement reads from the `sports_bets` row, which
  // has no sport column, and a bet can settle after a restart with no live game left to
  // ask. A chequered flag is true of both codes and needs no schema change to stay true.
  const header = `🏁 FINAL — ${row.away_team} ${row.away_score}, ${row.home_team} ${row.home_score}. ${winLabel}.`;
  const tell = (pid, team, won, push) => {
    let outcome;
    if (push) outcome = `Push — your ₵${row.amount} stake is returned.`;
    else if (won) outcome = `You called the ${team} (${reason}) — you win the ₵${pot} pot!`;
    else outcome = `You had the ${team} — the ₵${pot} pot goes the other way.`;
    sendToPlayer(pid, { type: 'output', message: `<span class="msg-system">${header} ${outcome}</span>` });
  };
  const push = !winnerId;
  tell(row.proposer_id, row.proposer_team, winnerId === row.proposer_id, push);
  tell(row.acceptor_id, row.acceptor_team, winnerId === row.acceptor_id, push);
}

// Sweep due bets every minute — settles anything whose game has wrapped, including
// bets that came due while the server was down (restart-safe; no per-bet timers).
// Locked bets are the exception, not the rule, and this sweep runs every minute
// forever. Two writers touch the locked set — the wager INSERT and the settle
// UPDATE — so the gate's counter is easy to keep honest, and worklist.js's
// re-probe covers it if it ever isn't.
const betsGate = createWorkGate({
  name: 'sports_bets',
  probe: async () => (await query(`SELECT COUNT(*)::int AS n FROM sports_bets WHERE status='locked'`)).rows[0].n,
});

async function settleDue() {
  if (!await betsGate.shouldRun()) return;
  const { rows } = await query(`SELECT * FROM sports_bets WHERE status='locked' AND resolve_at <= NOW()`).catch(() => ({ rows: [] }));
  for (const row of rows) await settleBet(row).catch(e => console.error('[sportsbet] settle error:', e.message));
}
schedule('1m', settleDue);
// Catch up shortly after boot (settles anything overdue from downtime).
setTimeout(() => settleDue().catch(e => console.error('[sportsbet] boot settle error:', e.message)), 8000);

on('player.logout', ({ id }) => {
  clearOffer(id);
  for (const [oid, o] of pendingWagers) if (o.fromId === id) clearOffer(oid);
});

export const commands = {
  wager: cmdWager,
  takewager: cmdTakeWager,
  cancelwager: cmdCancelWager,
};

export const _test = { parseWager, parseScore, pickTeam, scoreEq };

console.log('[sportsbet] Plugin loaded.');
