// BOOKIE: a house book on the game on the air. A bookie NPC (`flags.bookie`)
// stands in a room; there `odds` shows the line on whatever sports game is
// airing, `punt <amount> <team>` backs a side at those odds, and `slips` lists
// your open bets. Win or lose only: no spreads, no scores.
//
// The line comes off the league table (sportsleague.getStandings): each side's
// record is smoothed toward .500, the two are set against each other (log5) with
// a small edge to the home side, and the house adds its margin (VIG) on top.
// Decimal odds: a ₵100 punt at 2.40 returns ₵240 if it lands.
//
// The broadcast decides the whole game the moment it starts airing (the
// `sports.game` event carries the result), so the book only takes money for the
// first BOOK_OPEN_MS of an airing, before the score means anything. A game first
// seen in the minutes after boot is one already under way, so its book never
// opens. The result is written onto the slip when it's taken and paid by a
// one-minute sweep at the final, the same restart-safe pattern sportsbet uses.
import { randomUUID } from 'crypto';
import { createWorkGate } from '../../server/engine/worklist.js';
import { query } from '../../server/models/db.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { getZoneNpcs, getLivePlayer } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { on } from '../../server/engine/events.js';
import { schedule } from '../../server/engine/scheduler.js';

const BOOK_OPEN_MS = 4 * 60 * 1000;   // the book shuts four minutes into an airing
const BOOT_GRACE_MS = 90 * 1000;      // games first seen this soon after boot are already running
const VIG = 1.07;                     // the house's margin over a fair book
const HOME_EDGE = 0.04;
const MIN_PUNT = 5;
const MAX_PUNT = 2000;
const BOOT_AT = Date.now();

// channelId -> { gameId, sport, away, home, awayScore, homeScore, winner, endsAtMs, openUntil, line }
const games = new Map();

const SPORT_ICON = { baseball: '⚾', hockey: '🏒' };
const iconOf = (g) => SPORT_ICON[g?.sport] || '⚾';

// ── The line ─────────────────────────────────────────────────────────────────
// A side's strength: its win rate pulled toward .500 by four phantom games, so a
// club that's 1-0 isn't priced as a sure thing.
function strength(row) {
  const w = Number(row?.wins) || 0, l = Number(row?.losses) || 0;
  return (w + 2) / (w + l + 4);
}

// Probability the home side wins, from two strengths (log5) plus the home edge.
function homeWinProb(awayRow, homeRow) {
  const a = strength(awayRow), h = strength(homeRow);
  const p = (h * (1 - a)) / (h * (1 - a) + a * (1 - h));
  return Math.min(0.9, Math.max(0.1, p + HOME_EDGE));
}

// Decimal odds for a side the book thinks wins with probability p.
function priceOf(p) {
  return Math.max(1.05, Math.floor((1 / (p * VIG)) * 100) / 100);
}

function lineFor(away, home, rows) {
  const find = (name) => (rows || []).find(r => r.team === name) || null;
  const pHome = homeWinProb(find(away), find(home));
  return { away: priceOf(1 - pHome), home: priceOf(pHome), awayRow: find(away), homeRow: find(home) };
}

const recordOf = (row) => row ? `${row.wins || 0}-${row.losses || 0}` : '0-0';
const fmtOdds = (n) => n.toFixed(2);

on('sports.game', (g) => {
  if (!g?.gameId || !g.channelId) return;
  const prev = games.get(g.channelId);
  if (prev?.gameId === g.gameId) return;
  const now = Date.now();
  const entry = { ...g, openUntil: now - BOOT_AT < BOOT_GRACE_MS ? 0 : now + BOOK_OPEN_MS, line: null };
  games.set(g.channelId, entry);
  // Price it off the table now, once per game. Until this lands the book is shut.
  dispatchAction({ type: 'sportsleague.getStandings', params: { sport: g.sport || 'baseball' } })
    .catch(() => null)
    .then(res => { entry.line = lineFor(g.away, g.home, res?.rows); });
});

// Games still on the air, soonest-ending first.
function liveGames() {
  const now = Date.now();
  for (const [cid, g] of games) if (g.endsAtMs <= now) games.delete(cid);
  return [...games.values()].sort((a, b) => a.endsAtMs - b.endsAtMs);
}

function bookieHere(player) {
  return getZoneNpcs(player.current_zone).find(n => n?.flags?.bookie) || null;
}

function pickTeam(input, g) {
  const s = (input || '').toLowerCase().trim();
  if (!s) return null;
  const hit = (name) => { const n = name.toLowerCase(); return n.includes(s) || n.split(/\s+/).some(w => w === s); };
  const ma = hit(g.away), mh = hit(g.home);
  if (ma && !mh) return g.away;
  if (mh && !ma) return g.home;
  return null;
}

// "punt 50 rats" or "punt rats 50"
function parsePunt(args) {
  const toks = (args || []).filter(Boolean);
  const i = toks.findIndex(t => /^\d+$/.test(t));
  if (i < 0) return null;
  const amount = parseInt(toks[i], 10);
  const team = toks.filter((_, j) => j !== i).join(' ').trim();
  return team ? { amount, team } : null;
}

// ── Verbs ────────────────────────────────────────────────────────────────────
async function cmdOdds(args, raw, player) {
  const bookie = bookieHere(player);
  if (!bookie) return { type: 'error', message: "There's no bookie here to give you a line." };
  const live = liveGames();
  if (!live.length) return { type: 'output', message: `${bookie.name} doesn't look up from the form guide. "Nothing on. Come back when there's a game."` };
  const now = Date.now();
  const out = [`<b>${bookie.name}'s board</b>`];
  for (const g of live) {
    const icon = iconOf(g);
    if (!g.line) { out.push(`${icon} ${g.away} at ${g.home}: still chalking the price.`); continue; }
    const shut = now >= g.openUntil;
    out.push(`${icon} ${g.away} (${recordOf(g.line.awayRow)}) <b>${fmtOdds(g.line.away)}</b>  at  ${g.home} (${recordOf(g.line.homeRow)}) <b>${fmtOdds(g.line.home)}</b>${shut ? '  · book closed' : ''}`);
  }
  out.push(`<span class="msg-system">Back a side with <b>punt &lt;amount&gt; &lt;team&gt;</b> (₵${MIN_PUNT} to ₵${MAX_PUNT}). A ₵100 punt at 2.40 pays ₵240. The book shuts a few minutes into the game. <b>slips</b> shows your bets.</span>`);
  return { type: 'output', message: out.join('\n') };
}

async function cmdPunt(args, raw, player) {
  const bookie = bookieHere(player);
  if (!bookie) return { type: 'error', message: "There's no bookie here to take your money." };
  const p = parsePunt(args);
  if (!p) return { type: 'error', message: 'Usage: punt <amount> <team>. Type odds for the board.' };
  if (p.amount < MIN_PUNT || p.amount > MAX_PUNT) return { type: 'error', message: `${bookie.name} takes ₵${MIN_PUNT} to ₵${MAX_PUNT} a slip.` };

  const live = liveGames().filter(g => g.line);
  if (!live.length) return { type: 'error', message: `"Nothing on to bet," says ${bookie.name}.` };
  let game = null, team = null;
  for (const g of live) { const t = pickTeam(p.team, g); if (t) { if (game) return { type: 'error', message: 'That name fits more than one game. Be specific.' }; game = g; team = t; } }
  if (!game) return { type: 'error', message: `Nobody called "${p.team}" is playing. The board: ${live.map(g => `${g.away} at ${g.home}`).join('; ')}.` };
  if (Date.now() >= game.openUntil) return { type: 'error', message: `"Book's shut on that one. Game's under way," says ${bookie.name}.` };

  const odds = team === game.away ? game.line.away : game.line.home;
  if (!(await adjustCredits(player, -p.amount, undefined, 'bookie:stake'))) return { type: 'error', message: `You don't have ₵${p.amount}.` };

  try {
    await query(
      `INSERT INTO bookie_bets (id, game_id, player_id, player_handle, team, stake, odds,
         away_team, home_team, away_score, home_score, winner_team, resolve_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, to_timestamp($13/1000.0), 'open')`,
      [randomUUID(), game.gameId, player.id, player.handle, team, p.amount, odds,
       game.away, game.home, game.awayScore, game.homeScore, game.winner || null, game.endsAtMs]);
  } catch (e) {
    await adjustCredits(player, p.amount, undefined, 'bookie:refund').catch(() => {});
    console.error('[bookie] slip error:', e.message);
    return { type: 'error', message: `${bookie.name}'s pen runs dry. Your ₵${p.amount} comes back to you.` };
  }
  slipsGate.noteWork(game.endsAtMs);
  const returns = Math.floor(p.amount * odds);
  return { type: 'output', message: `${bookie.name} licks a pencil and writes you a slip: <b>₵${p.amount} on the ${team} at ${fmtOdds(odds)}</b>. Returns ₵${returns} if they win. Paid at the final.` };
}

async function cmdSlips(args, raw, player) {
  const { rows } = await query(
    `SELECT team, stake, odds, away_team, home_team FROM bookie_bets
      WHERE player_id=$1 AND status='open' ORDER BY created_at`, [player.id]).catch(() => ({ rows: [] }));
  if (!rows.length) return { type: 'output', message: "You've no slips open." };
  const lines = rows.map(r => `₵${r.stake} on the ${r.team} at ${fmtOdds(Number(r.odds))} (${r.away_team} at ${r.home_team}), returns ₵${Math.floor(r.stake * Number(r.odds))}`);
  return { type: 'output', message: `<b>Your slips</b>\n${lines.join('\n')}` };
}

// ── Settlement ───────────────────────────────────────────────────────────────
async function settleSlip(row) {
  const closed = await query(`UPDATE bookie_bets SET status='settled' WHERE id=$1 AND status='open'`, [row.id]);
  if (!closed.rowCount) return;
  const odds = Number(row.odds);
  const push = !row.winner_team;
  const won = !push && row.team === row.winner_team;
  const pay = push ? row.stake : won ? Math.floor(row.stake * odds) : 0;
  const live = getLivePlayer(row.player_id);
  if (pay > 0) await adjustCredits(live || { id: row.player_id, credits: 0 }, pay, undefined, push ? 'bookie:refund' : 'bookie:payout').catch(() => {});
  if (!live) return;
  const header = `🏁 FINAL: ${row.away_team} ${row.away_score}, ${row.home_team} ${row.home_score}.`;
  const outcome = push ? `A tie: your ₵${row.stake} slip is refunded.`
    : won ? `Your ₵${row.stake} on the ${row.team} lands at ${fmtOdds(odds)}. You collect ₵${pay}.`
    : `Your ₵${row.stake} on the ${row.team} goes in the bookie's pocket.`;
  sendToPlayer(row.player_id, { type: 'output', message: `<span class="msg-system">${header} ${outcome}</span>` });
}

const slipsGate = createWorkGate({
  name: 'bookie_bets',
  probe: async () => (await query(
    `SELECT COUNT(*)::int AS n, (EXTRACT(EPOCH FROM MIN(resolve_at)) * 1000)::bigint AS "nextDue"
       FROM bookie_bets WHERE status='open'`)).rows[0],
});

async function settleDue() {
  if (!await slipsGate.shouldRun()) return;
  const { rows } = await query(`SELECT * FROM bookie_bets WHERE status='open' AND resolve_at <= NOW()`).catch(() => ({ rows: [] }));
  for (const row of rows) await settleSlip(row).catch(e => console.error('[bookie] settle error:', e.message));
  slipsGate.noteWork();
}
schedule('1m', settleDue);
setTimeout(() => settleDue().catch(e => console.error('[bookie] boot settle error:', e.message)), 10000);

export const commands = { odds: cmdOdds, punt: cmdPunt, slips: cmdSlips };

export const _test = { strength, homeWinProb, priceOf, lineFor, parsePunt, pickTeam, games, VIG };

console.log('[bookie] Plugin loaded.');
