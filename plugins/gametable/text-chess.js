// Chess in the log — the written half of the board.
//
// The isometric pane is unusable to a screen reader and invisible at the `log`
// rung, so an opted-in player gets the position as text: a plain ASCII board,
// each move as it lands, and the result. This is the whole game, not a summary —
// if the record in the log isn't enough to keep playing from, this rung isn't
// done (see docs/systems-display-mode.md).
//
// The preference is the SAME one the felt uses. A player who reads poker in the
// log reads chess in the log; there is no second switch to find.
//
// A grid is not text: the board is drawn inside a <pre> with two columns per
// square, because a single-column board is unreadably narrow and a per-character
// span is a different problem entirely (see the map's own lesson).

import { sendToPlayer } from '../../server/engine/messaging.js';
import { isTextMode } from './text-mode.js';
import { typeOf, colorOf } from './games/chess.js';

export const isChessTextMode = isTextMode;

// Letters, not glyphs: uppercase is White, lowercase is Black. A screen reader
// says "capital R" and "R" differently, and ♜ is read as nothing useful at all.
function pieceChar(piece) {
  if (!piece) return '.';
  return piece;
}

// Seated humans + spectators who've opted in.
function textWatchers(table) {
  const out = [];
  for (const s of table.seats) if (s && !s.isBot && isTextMode(s.playerId)) out.push(s.playerId);
  for (const pid of table.spectators) if (isTextMode(pid)) out.push(pid);
  return out;
}

// The board as text, from `color`'s side of it.
export function boardASCII(game, color = 'w') {
  const grid = game.grid();
  const lines = [];
  const files = color === 'b' ? 'h g f e d c b a' : 'a b c d e f g h';

  for (let i = 0; i < 8; i++) {
    const r = color === 'b' ? 7 - i : i;
    const rank = 8 - r;
    const cells = [];
    for (let j = 0; j < 8; j++) {
      const f = color === 'b' ? 7 - j : j;
      cells.push(pieceChar(grid[r][f]));
    }
    lines.push(`${rank} | ${cells.join(' ')} | ${rank}`);
  }
  const edge = '  +-----------------+';
  return [`    ${files}`, edge, ...lines, edge, `    ${files}`].join('\n');
}

// A one-line material read, so a text player knows where they stand without
// counting letters off the board every move.
function materialLine(game) {
  const balance = game.materialBalance();
  if (!balance) return 'Material is level.';
  const who = balance > 0 ? 'White' : 'Black';
  return `${who} is up ${Math.abs(Math.round(balance / 100))} in material.`;
}

// The full position — sent at the start of a game and by the `board` command.
export function narrateBoard(table, onlyPlayerId = null) {
  const g = table.game;
  if (!g) return;
  const targets = onlyPlayerId
    ? (isTextMode(onlyPlayerId) ? [onlyPlayerId] : [])
    : textWatchers(table);

  for (const pid of targets) {
    const color = g.seatByPlayer(pid)?.color || 'w';
    const you = g.seatByPlayer(pid)
      ? `You are ${color === 'w' ? 'White' : 'Black'}.`
      : 'You are watching.';
    const turn = g.isOver()
      ? g.resultLine()
      : `${g.turn === 'w' ? 'White' : 'Black'} to move${g.inCheck() ? ' — in check' : ''}.`;
    sendToPlayer(pid, {
      type: 'output',
      message: [
        `<span style="color:var(--accent)">♟ ${table.name}</span>`,
        `<pre>${boardASCII(g, color)}</pre>`,
        `${you} ${turn} ${materialLine(g)}`,
      ].join(''),
    });
  }
}

// One move, as it happens. The mover already knows what they played, so they get
// the board back; the opponent gets the move called first — that's the beat that
// matters when you can't see the pieces.
export function narrateMove(table, san) {
  const g = table.game;
  if (!g) return;
  const last = g.lastMove();
  if (!last) return;
  const mover = g.seatByColor(last.color);

  for (const pid of textWatchers(table)) {
    const color = g.seatByPlayer(pid)?.color || 'w';
    const isMover = mover?.playerId === pid;
    const head = isMover
      ? `<span class="text-dim">You play ${san}.</span>`
      : `<span style="color:var(--yellow)">${mover?.handle || 'Your opponent'} plays ${san}.</span>`;
    const yourTurn = !g.isOver() && g.turn === color
      ? ` <span style="color:var(--yellow)">▶ Your move.</span> <span class="text-dim">(type a move like e2e4 or Nf3 · <b>board</b> to re-read)</span>`
      : '';
    sendToPlayer(pid, {
      type: 'output',
      message: `${head}<pre>${boardASCII(g, color)}</pre>${yourTurn}`,
    });
  }
}

// How it ended. The host NPC's line already reaches the room log, but a table
// with no host says nothing at all — so the result is pushed here regardless.
export function narrateResult(table, line) {
  for (const pid of textWatchers(table)) {
    sendToPlayer(pid, { type: 'output', message: `<span style="color:var(--accent)">♟ ${line}</span>` });
  }
}

// The legal moves for the piece on a square — the text answer to "which squares
// are glowing?", which is the one thing the pane gives away for free.
export function narrateMoves(table, playerId, moves, from) {
  if (!moves.length) return;
  const list = moves.map(m => m.san || '').filter(Boolean).join(' · ');
  sendToPlayer(playerId, {
    type: 'output',
    message: `From ${from}: ${list}`,
  });
}
