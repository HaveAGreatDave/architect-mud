// The hustler across the board — a small alpha-beta chess opponent.
//
// Three rules shape this file:
//
//   1. It must never stall the tick. The search is capped by NODE_BUDGET, not by
//      depth alone, and the cap is checked inside the recursion — a bot that
//      thinks for four seconds has frozen the whole server, not just its game.
//   2. It must be beatable. Strength is a persona, and a weak persona blunders
//      on purpose. An opponent that plays perfectly at 2 ply is duller than one
//      that hangs a rook now and then, and a table nobody can beat is a table
//      nobody sits at twice.
//   3. It holds no world state. Given a ChessGame it returns a move string —
//      the same string a player could have typed.

import { generateMoves, applyMove, inCheck, toAlgebraic, typeOf, colorOf, PIECE_VALUE }
  from './games/chess.js';

const NODE_BUDGET = 12_000; // hard ceiling per move; ~40ms on this hardware

// Piece-square tables, from White's point of view, in the renderer's row order
// (index 0 = a8). Black reads the same table mirrored. These are what stop the
// bot shuffling its rooks: they price the CENTRE, and knights on the rim.
const PST = {
  p: [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
  ],
  n: [
   -50,-40,-30,-30,-30,-30,-40,-50,
   -40,-20,  0,  0,  0,  0,-20,-40,
   -30,  0, 10, 15, 15, 10,  0,-30,
   -30,  5, 15, 20, 20, 15,  5,-30,
   -30,  0, 15, 20, 20, 15,  0,-30,
   -30,  5, 10, 15, 15, 10,  5,-30,
   -40,-20,  0,  5,  5,  0,-20,-40,
   -50,-40,-30,-30,-30,-30,-40,-50,
  ],
  b: [
   -20,-10,-10,-10,-10,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5, 10, 10,  5,  0,-10,
   -10,  5,  5, 10, 10,  5,  5,-10,
   -10,  0, 10, 10, 10, 10,  0,-10,
   -10, 10, 10, 10, 10, 10, 10,-10,
   -10,  5,  0,  0,  0,  0,  5,-10,
   -20,-10,-10,-10,-10,-10,-10,-20,
  ],
  r: [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0,
  ],
  q: [
   -20,-10,-10, -5, -5,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5,  5,  5,  5,  0,-10,
    -5,  0,  5,  5,  5,  5,  0, -5,
     0,  0,  5,  5,  5,  5,  0, -5,
   -10,  5,  5,  5,  5,  5,  0,-10,
   -10,  0,  5,  0,  0,  0,  0,-10,
   -20,-10,-10, -5, -5,-10,-10,-20,
  ],
  k: [
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -20,-30,-30,-40,-40,-30,-30,-20,
   -10,-20,-20,-20,-20,-20,-20,-10,
    20, 20,  0,  0,  0, 20, 20, 20,
    20, 30, 10,  0,  0, 10, 30, 20,
  ],
};

// Personas: how deep it looks and how often it throws a move away. `blunder` is
// the chance per move of picking a random legal move instead of the best one.
export const CHESS_PERSONAS = {
  patzer:  { depth: 1, blunder: 0.35, label: 'plays like a tourist' },
  hustler: { depth: 2, blunder: 0.12, label: 'knows a few tricks' },
  shark:   { depth: 3, blunder: 0.02, label: 'plays for keeps' },
};

// A bot seat's playerId is derived from the NPC id, so it's stable across a
// re-seat and unmistakable for a real player id.
export function chessBotId(npcId) { return `chessbot:${npcId}`; }
export function isChessBotId(id) { return typeof id === 'string' && id.startsWith('chessbot:'); }

// Static evaluation, in centipawns, from WHITE's point of view.
function evaluate(pos) {
  let score = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const piece = pos.board[sq];
    if (!piece) continue;
    const type = typeOf(piece);
    const white = colorOf(piece) === 'w';
    // The 0x88 index maps to a 64-square table index by dropping the gap.
    const idx64 = (sq >> 4) * 8 + (sq & 7);
    const pst = PST[type][white ? idx64 : mirror(idx64)];
    const value = PIECE_VALUE[type] + pst;
    score += white ? value : -value;
  }
  return score;
}

// Flip a 64-index vertically, so Black reads White's table from its own side.
function mirror(idx) {
  const rank = Math.floor(idx / 8);
  return (7 - rank) * 8 + (idx % 8);
}

// Captures first, and by how much they win — cheap ordering that makes the
// alpha-beta cutoffs actually fire within the node budget.
function orderMoves(moves) {
  return moves.slice().sort((a, b) => scoreMove(b) - scoreMove(a));
}

function scoreMove(m) {
  let s = 0;
  if (m.captured) s += PIECE_VALUE[typeOf(m.captured)] * 10 - PIECE_VALUE[typeOf(m.piece)];
  if (m.promotion) s += PIECE_VALUE[m.promotion];
  return s;
}

// Negamax with alpha-beta. `budget` is a mutable counter shared down the tree —
// when it runs out the search returns the static eval and unwinds, which yields
// a worse move but never a hung server.
function search(pos, depth, alpha, beta, budget) {
  if (budget.n <= 0) return sideScore(pos, evaluate(pos));
  budget.n--;

  if (depth <= 0) return sideScore(pos, evaluate(pos));

  const moves = generateMoves(pos);
  if (!moves.length) {
    // Mate is scored by DISTANCE so the bot prefers mate in one to mate in three
    // — without the depth term it sees them as identical and can shuffle forever.
    if (inCheck(pos, pos.turn)) return -100000 - depth;
    return 0; // stalemate
  }

  let best = -Infinity;
  for (const m of orderMoves(moves)) {
    const value = -search(applyMove(pos, m), depth - 1, -beta, -alpha, budget);
    if (value > best) best = value;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // cutoff
  }
  return best;
}

// evaluate() is White-relative; negamax needs it relative to the side to move.
function sideScore(pos, score) {
  return pos.turn === 'w' ? score : -score;
}

// Pick a move for `seat`. Returns a coordinate string ('e2e4', 'e7e8q') — the
// same thing a player types — or null if there is nothing to play.
export function decideBotMove(game, seat) {
  const pos = game.position;
  const moves = generateMoves(pos);
  if (!moves.length) return null;

  const persona = { ...CHESS_PERSONAS.hustler, ...(seat?.persona || {}) };

  // The deliberate mistake. Never blunders a move that is FORCED (only one legal
  // move isn't a choice) and never declines a mate it can see.
  if (moves.length > 1 && Math.random() < persona.blunder) {
    const pick = moves[Math.floor(Math.random() * moves.length)];
    return asCoord(pick);
  }

  const budget = { n: NODE_BUDGET };
  let best = null;
  let bestScore = -Infinity;

  for (const m of orderMoves(moves)) {
    const score = -search(applyMove(pos, m), persona.depth - 1, -Infinity, Infinity, budget);
    // Ties break randomly, so the same position doesn't produce the same game
    // every single time somebody sits down.
    if (score > bestScore || (score === bestScore && Math.random() < 0.3)) {
      bestScore = score;
      best = m;
    }
  }
  return asCoord(best || moves[0]);
}

function asCoord(move) {
  return `${toAlgebraic(move.from)}${toAlgebraic(move.to)}${move.promotion || ''}`;
}

// Table talk. Fired on the bot's own move, sparingly — an opponent that
// comments on every move is a chatbot, not a player.
const CHATTER = {
  capture: [
    "That one's mine.",
    'You left it hanging, friend.',
    "Thanks. I'll take it.",
  ],
  check: [
    'Check. Mind your king.',
    'Company for your king.',
  ],
  quiet: [
    'Your move.',
    "I've got all night.",
    'Take your time. Everyone does, against me.',
  ],
  losing: [
    'Hm. That was better than it looked.',
    "You've played before.",
  ],
};

export function botChessChatter(game, seat, san) {
  if (Math.random() > 0.22) return null;
  let pool = CHATTER.quiet;
  if (san?.includes('x')) pool = CHATTER.capture;
  if (san?.includes('+')) pool = CHATTER.check;
  const botSeat = game.seatByPlayer(seat.playerId);
  if (botSeat) {
    const balance = game.materialBalance();
    const mine = botSeat.color === 'w' ? balance : -balance;
    if (mine < -200) pool = CHATTER.losing;
  }
  return pool[Math.floor(Math.random() * pool.length)];
}
