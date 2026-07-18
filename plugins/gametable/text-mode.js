// Poker "text mode" — a per-player accessibility opt-in for screen-reader players.
//
// The visual poker table lives entirely in the area pane (poker_update HTML),
// which a screen reader can't follow. Most narration (opponent actions, dealer
// quips, winners) already reaches the scrolling text log via _dealerSay. Three
// things are pane-only, and this module pushes them to the log as text for
// opted-in players: your hole cards at the deal, the community board on each
// street, and a compact "your turn" prompt with pot / to-call / commands.
//
// No game rules here — GameTable calls these at the transition points. Cards are
// rendered with the same ASCII the `board`/`showhand` commands use.

import { sendToPlayer } from '../../server/engine/messaging.js';
import { renderHandASCII } from './cards.js';

// Runtime set of playerIds currently in text mode. Persisted per player in
// player_flags.poker_text_mode; this Set is the hot-path check so narration
// never touches the DB. Kept in sync by index.js (toggle + on-join load).
export const textModePlayers = new Set();

export function isTextMode(pid) { return textModePlayers.has(pid); }

// Seated humans + spectators who've opted in — the audience for shared board news.
function textWatchers(table) {
  const out = [];
  for (const s of table.seats) if (s && !s.isBot && isTextMode(s.playerId)) out.push(s.playerId);
  for (const pid of table.spectators) if (isTextMode(pid)) out.push(pid);
  return out;
}

const CR = '₵';
const cred = n => `${CR} ${Number(n || 0).toLocaleString()}`;

// The deal — private to each opted-in seated human: their two hole cards + role.
export function narrateDeal(table) {
  const g = table.game;
  if (!g) return;
  for (const seat of table.seats) {
    if (!seat || seat.isBot || !isTextMode(seat.playerId)) continue;
    const gs = g.seats.find(s => s.playerId === seat.playerId);
    if (!gs || !gs.hand?.length) continue;

    // Blinds are posted before any action, so gs.bet at deal time tells us the
    // seat's role without recomputing the sb/bb indices.
    let role = '';
    if (gs.bet === g.bigBlind) role = `You post the big blind (${cred(g.bigBlind)}).`;
    else if (gs.bet === g.smallBlind) role = `You post the small blind (${cred(g.smallBlind)}).`;
    else if (g.seats.indexOf(gs) === g.dealerIdx) role = 'You have the dealer button.';

    const parts = [
      `<span style="color:var(--accent)">♠ New hand — your hole cards:</span>`,
      `<pre>${renderHandASCII(gs.hand)}</pre>`,
    ];
    if (role) parts.push(role);
    sendToPlayer(seat.playerId, { type: 'output', message: parts.join('') });
  }
}

// A street landed — the community board, shared with every opted-in watcher.
export function narrateStreet(table, phase) {
  const g = table.game;
  if (!g) return;
  const label = { flop: 'FLOP', turn: 'TURN', river: 'RIVER' }[phase];
  if (!label) return;
  const msg = [
    `<span style="color:var(--accent)">${label}:</span>`,
    `<pre>${renderHandASCII(g.community)}</pre>`,
    `Pot: ${cred(g.pot)}.`,
  ].join('');
  for (const pid of textWatchers(table)) sendToPlayer(pid, { type: 'output', message: msg });
}

// Showdown — the final board, so a text player has the full run-out in the log
// before the dealer narrates the winners (which already broadcasts to the room).
export function narrateShowdown(table) {
  const g = table.game;
  if (!g || !g.community.length) return;
  const msg = [
    `<span style="color:var(--accent)">SHOWDOWN — final board:</span>`,
    `<pre>${renderHandASCII(g.community)}</pre>`,
  ].join('');
  for (const pid of textWatchers(table)) sendToPlayer(pid, { type: 'output', message: msg });
}

// Your turn — a compact one-line prompt (no ASCII; you have the cards already,
// and `board` / `showhand` re-show them on demand). This is the signal a screen
// reader otherwise never gets: today "your turn" is only a sound cue.
export function narrateTurn(table, playerId) {
  const g = table.game;
  if (!g || !isTextMode(playerId)) return;
  const gs = g.seats.find(s => s.playerId === playerId);
  if (!gs) return;
  const toCall = Math.max(0, g.currentBet - gs.bet);
  const opts = toCall > 0
    ? `To call ${cred(toCall)}. Type: <b>call</b> · <b>raise &lt;amt&gt;</b> · <b>fold</b>`
    : `Type: <b>check</b> · <b>bet &lt;amt&gt;</b> · <b>fold</b>`;
  const msg = `<span style="color:var(--yellow)">▶ Your turn</span> — pot ${cred(g.pot)}, `
    + `your stack ${cred(gs.chips)}. ${opts}`
    + ` <span class="text-dim">(board · showhand to review cards)</span>`;
  sendToPlayer(playerId, { type: 'output', message: msg });
}
