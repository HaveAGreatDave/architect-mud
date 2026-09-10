// Chess in the log — the written half of the board.
//
// The isometric pane is unusable to a screen reader and invisible at the `log`
// rung, so an opted-in player gets the position as text: a plain ASCII board,
// each move as it lands, and the result. This is the whole game, not a summary —
// if the record in the log isn't enough to keep playing from, this rung isn't
// done (see docs/systems-display-mode.md).
//
// PUSH A MOVE, PULL A POSITION. The board used to be re-sent after every
// half-move, which re-sends what the reader already has: `#output` is the one
// live region, so that is a 12-line grid spoken twice per move pair with the one
// new fact — what the opponent played — buried at the top of it. So a move
// pushes a MOVE (and its consequence: capture, check, mate), and the position is
// pulled with `board`. The rung contract still holds — the move stream is a game
// record you can play from, and `board` reconstructs the position at any time.
//
// The preference is the SAME one the felt uses. A player who reads poker in the
// log reads chess in the log; there is no second switch to find.
//
// A grid is not text: the board is drawn inside a <pre> with two columns per
// square, because a single-column board is unreadably narrow and a per-character
// span is a different problem entirely (see the map's own lesson).

import { sendToPlayer } from '../../server/engine/messaging.js';
import { isTextMode } from './text-mode.js';
import {
  typeOf, colorOf, opposite, onBoard, toAlgebraic, isAttacked,
  PIECE_NAMES, PIECE_VALUE,
} from './games/chess.js';

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

// Every occupied square, by side, grouped by piece. This is how a player who
// can't see the grid actually holds a position — thirty named facts rather than
// sixty-four cells to scan for dots. King first, then down the value ladder.
const LIST_ORDER = ['k', 'q', 'r', 'b', 'n', 'p'];

export function piecesLine(game) {
  const pos = game.position;
  const found = { w: {}, b: {} };
  for (let sq = 0; sq < 128; sq++) {
    if (!onBoard(sq)) { sq += 7; continue; }
    const p = pos.board[sq];
    if (!p) continue;
    const c = colorOf(p), t = typeOf(p);
    (found[c][t] = found[c][t] || []).push(toAlgebraic(sq));
  }
  const side = (c) => {
    const parts = [];
    for (const t of LIST_ORDER) {
      const squares = found[c][t];
      if (!squares?.length) continue;
      const name = squares.length > 1 ? `${PIECE_NAMES[t]}s` : PIECE_NAMES[t];
      parts.push(`${name} ${squares.join(' ')}`);
    }
    return parts.join(', ') || 'nothing left';
  };
  return `White: ${side('w')}.<br>Black: ${side('b')}.`;
}

// What's attacking what. The pane gives danger away for free — a piece with a
// ring round it reads as threatened at a glance — so the written board owes the
// same answer, or the text player is the only one playing blind.
export function threatLines(game, color) {
  const pos = game.position;
  const them = opposite(color);
  const yours = [], theirs = [];
  for (let sq = 0; sq < 128; sq++) {
    if (!onBoard(sq)) { sq += 7; continue; }
    const p = pos.board[sq];
    if (!p || typeOf(p) === 'k') continue;
    const c = colorOf(p);
    const name = `${PIECE_NAMES[typeOf(p)]} ${toAlgebraic(sq)}`;
    if (c === color) {
      if (!isAttacked(pos, sq, them)) continue;
      yours.push(isAttacked(pos, sq, color) ? name : `${name} (undefended)`);
    } else {
      // Theirs is only worth saying when it's free — an attacked-but-defended
      // piece is a trade, not a threat, and listing every one is noise.
      if (!isAttacked(pos, sq, color) || isAttacked(pos, sq, them)) continue;
      if (PIECE_VALUE[typeOf(p)] <= 0) continue;
      theirs.push(name);
    }
  }
  const out = [];
  out.push(yours.length ? `Under attack: ${yours.join(', ')}.` : 'Nothing of yours is attacked.');
  if (theirs.length) out.push(`Hanging for you: ${theirs.join(', ')}.`);
  if (game.inCheck() && game.turn === color) out.push("You're in check.");
  return out.join('<br>');
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
      : "You're watching.";
    const turn = g.isOver()
      ? g.resultLine()
      : `${g.turn === 'w' ? 'White' : 'Black'} to move${g.inCheck() ? ' — in check' : ''}.`;
    sendToPlayer(pid, {
      type: 'output',
      message: [
        `<span style="color:var(--accent)">♟ ${table.name}</span>`,
        `<pre>${boardASCII(g, color)}</pre>`,
        `${piecesLine(g)}<br>`,
        `${you} ${turn} ${materialLine(g)}`,
      ].join(''),
    });
  }
}

// One move, as it happens — the move and what it did, never the whole board.
// The mover already knows what they played; the opponent needs the move called,
// and both need the consequence, which is the thing a grid makes you hunt for.
export function narrateMove(table, san) {
  const g = table.game;
  if (!g) return;
  const last = g.lastMove();
  if (!last) return;
  const mover = g.seatByColor(last.color);

  // What it did, in words. The SAN already carries `+`/`#`, but a reader
  // shouldn't have to parse punctuation off the end of a spoken token to hear
  // "check". Captures are deliberately NOT repeated here — `handleMove` already
  // says "X takes the knight" to the room, and the room log is the same log.
  const consequence = /#$/.test(san)
    ? ' — <b>checkmate</b>.'
    : (/\+$/.test(san) || g.inCheck()) ? ' — check.' : '';

  for (const pid of textWatchers(table)) {
    const color = g.seatByPlayer(pid)?.color || 'w';
    const isMover = mover?.playerId === pid;
    const head = isMover
      ? `<span class="text-dim">You play ${san}.</span>`
      : `<span style="color:var(--yellow)">${mover?.handle || 'Your opponent'} plays ${san}.</span>`;
    const yourTurn = !g.isOver() && g.turn === color
      ? ` <span style="color:var(--yellow)">▶ Your move.</span> <span class="text-dim">(a move like e2e4 or Nf3 · <b>board</b> to re-read · <b>threats</b> for what's attacked)</span>`
      : '';
    sendToPlayer(pid, {
      type: 'output',
      message: `${head}${consequence}${yourTurn}`,
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
  sendToPlayer(playerId, { type: 'output', message: movesLine(moves, from) });
}

// A destination list with the captures marked — the pane draws a dot for an
// empty square and a ring for an occupied one, because "go here" and "take that"
// are different decisions. Same two marks, in words.
export function movesLine(moves, from) {
  const list = moves.map(m => {
    const sq = toAlgebraic(m.to);
    return m.captured ? `${sq} (takes ${PIECE_NAMES[typeOf(m.captured)]})` : sq;
  }).join(' · ');
  return `From ${from}: ${list}`;
}
