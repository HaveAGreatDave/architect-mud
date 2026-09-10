// Chess rules for a GameTable seat pair.
//
// Full legal chess: castling (including the through-check rule), en passant with
// its one-move window, promotion, check/checkmate/stalemate, threefold
// repetition, the fifty-move rule and insufficient material.
//
// Board representation is 0x88 — a 128-entry array where a square is off-board
// iff (i & 0x88). That single test replaces every rank/file bounds check in move
// generation, which is why sliding pieces below are eight lines instead of forty.
// Index 0 is a8 and index 119 is h1, so White advances toward LOWER indices.
//
// This module holds no world state: no players, no credits, no messaging. It is
// handed two seat records and asked whose turn it is. ChessTable owns the rest.

// ── Board constants ──────────────────────────────────────────────────────────

const WHITE = 'w';
const BLACK = 'b';

// Offsets, in 0x88 terms.
const KNIGHT_OFFSETS = [-33, -31, -18, -14, 14, 18, 31, 33];
const BISHOP_OFFSETS = [-17, -15, 15, 17];
const ROOK_OFFSETS   = [-16, -1, 1, 16];
const ROYAL_OFFSETS  = [...BISHOP_OFFSETS, ...ROOK_OFFSETS];

const SLIDERS = { b: BISHOP_OFFSETS, r: ROOK_OFFSETS, q: ROYAL_OFFSETS };

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Piece values for the bot's evaluation and for the insufficient-material test.
export const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

export const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

// ── Square helpers ───────────────────────────────────────────────────────────

export function onBoard(sq) { return (sq & 0x88) === 0; }
export function fileOf(sq)  { return sq & 15; }
export function rankOf(sq)  { return sq >> 4; }

// 0x88 index → algebraic ('e4'). Index 0 is a8.
export function toAlgebraic(sq) {
  return 'abcdefgh'[fileOf(sq)] + (8 - rankOf(sq));
}

// Algebraic ('e4') → 0x88 index, or -1.
export function fromAlgebraic(str) {
  if (typeof str !== 'string' || str.length !== 2) return -1;
  const f = 'abcdefgh'.indexOf(str[0].toLowerCase());
  const r = '12345678'.indexOf(str[1]);
  if (f < 0 || r < 0) return -1;
  return (7 - r) * 16 + f;
}

function colorOf(piece) {
  if (!piece) return null;
  return piece === piece.toUpperCase() ? WHITE : BLACK;
}

function typeOf(piece) {
  return piece ? piece.toLowerCase() : null;
}

function opposite(color) { return color === WHITE ? BLACK : WHITE; }

// ── Position ─────────────────────────────────────────────────────────────────

// A plain position: board + the four pieces of state FEN carries beyond it.
// Kept as a bare object rather than a class so structuredClone-free copies are
// cheap — the bot search makes and unmakes thousands of these.
function parseFen(fen) {
  const [placement, active, castling, ep, half, full] = fen.trim().split(/\s+/);
  const board = new Array(128).fill(null);
  let sq = 0;
  for (const ch of placement) {
    if (ch === '/') { sq += 8; continue; }
    if (ch >= '1' && ch <= '8') { sq += Number(ch); continue; }
    board[sq] = ch;
    sq++;
  }
  return {
    board,
    turn: active === BLACK ? BLACK : WHITE,
    castling: castling && castling !== '-' ? castling : '',
    ep: ep && ep !== '-' ? fromAlgebraic(ep) : null,
    halfmove: Number(half) || 0,
    fullmove: Number(full) || 1,
  };
}

function toFen(pos) {
  let placement = '';
  for (let r = 0; r < 8; r++) {
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const piece = pos.board[r * 16 + f];
      if (!piece) { empty++; continue; }
      if (empty) { placement += empty; empty = 0; }
      placement += piece;
    }
    if (empty) placement += empty;
    if (r < 7) placement += '/';
  }
  return [
    placement,
    pos.turn,
    pos.castling || '-',
    pos.ep != null ? toAlgebraic(pos.ep) : '-',
    pos.halfmove,
    pos.fullmove,
  ].join(' ');
}

function clonePosition(pos) {
  return {
    board: pos.board.slice(),
    turn: pos.turn,
    castling: pos.castling,
    ep: pos.ep,
    halfmove: pos.halfmove,
    fullmove: pos.fullmove,
  };
}

// ── Attack detection ─────────────────────────────────────────────────────────

// Is `sq` attacked by any piece of `byColor`? Used for check, for castling
// legality (all three king squares), and by the bot for hanging-piece checks.
export function isAttacked(pos, sq, byColor) {
  for (let from = 0; from < 128; from++) {
    if (!onBoard(from)) { from += 7; continue; }
    const piece = pos.board[from];
    if (!piece || colorOf(piece) !== byColor) continue;
    const type = typeOf(piece);

    if (type === 'p') {
      // Pawns capture diagonally FORWARD; white's forward is -16.
      const dir = byColor === WHITE ? -16 : 16;
      if (from + dir - 1 === sq || from + dir + 1 === sq) {
        // Guard the 0x88 file wrap: a pawn on the a-file can't attack the h-file.
        if (Math.abs(fileOf(from) - fileOf(sq)) === 1) return true;
      }
      continue;
    }

    if (type === 'n') {
      for (const off of KNIGHT_OFFSETS) if (from + off === sq && onBoard(sq)) return true;
      continue;
    }

    if (type === 'k') {
      for (const off of ROYAL_OFFSETS) if (from + off === sq) return true;
      continue;
    }

    const offsets = SLIDERS[type];
    if (!offsets) continue;
    for (const off of offsets) {
      let to = from + off;
      while (onBoard(to)) {
        if (to === sq) return true;
        if (pos.board[to]) break; // blocked
        to += off;
      }
    }
  }
  return false;
}

function findKing(pos, color) {
  const target = color === WHITE ? 'K' : 'k';
  for (let sq = 0; sq < 128; sq++) {
    if (!onBoard(sq)) { sq += 7; continue; }
    if (pos.board[sq] === target) return sq;
  }
  return -1;
}

export function inCheck(pos, color = pos.turn) {
  const king = findKing(pos, color);
  if (king < 0) return false;
  return isAttacked(pos, king, opposite(color));
}

// ── Move generation ──────────────────────────────────────────────────────────

// A move: { from, to, piece, captured?, promotion?, flags }
// flags is a set of single chars: 'n' normal, 'c' capture, 'b' big pawn (double
// push), 'e' en passant, 'k' kingside castle, 'q' queenside castle, 'p' promotion.

function addPawnMoves(pos, from, out) {
  const color = pos.turn;
  const dir = color === WHITE ? -16 : 16;
  const startRank = color === WHITE ? 6 : 1;
  const promoRank = color === WHITE ? 0 : 7;
  const piece = pos.board[from];

  const one = from + dir;
  if (onBoard(one) && !pos.board[one]) {
    if (rankOf(one) === promoRank) {
      for (const promo of 'qrbn') out.push({ from, to: one, piece, promotion: promo, flags: 'p' });
    } else {
      out.push({ from, to: one, piece, flags: 'n' });
      const two = from + dir * 2;
      if (rankOf(from) === startRank && !pos.board[two]) {
        out.push({ from, to: two, piece, flags: 'b' });
      }
    }
  }

  for (const side of [-1, 1]) {
    const to = from + dir + side;
    if (!onBoard(to)) continue;
    if (Math.abs(fileOf(from) - fileOf(to)) !== 1) continue; // file wrap guard
    const target = pos.board[to];
    if (target && colorOf(target) !== color) {
      if (rankOf(to) === promoRank) {
        for (const promo of 'qrbn') out.push({ from, to, piece, captured: target, promotion: promo, flags: 'pc' });
      } else {
        out.push({ from, to, piece, captured: target, flags: 'c' });
      }
    } else if (!target && pos.ep != null && to === pos.ep) {
      // En passant: the captured pawn is beside us, not on the target square.
      out.push({ from, to, piece, captured: pos.board[to - dir], flags: 'e' });
    }
  }
}

function addCastleMoves(pos, from, out) {
  const color = pos.turn;
  const enemy = opposite(color);
  const rights = color === WHITE ? { k: 'K', q: 'Q' } : { k: 'k', q: 'q' };
  const piece = pos.board[from];

  // Can't castle out of check — tested once here rather than per side.
  if (isAttacked(pos, from, enemy)) return;

  if (pos.castling.includes(rights.k)) {
    const f1 = from + 1, f2 = from + 2;
    if (!pos.board[f1] && !pos.board[f2]
        && !isAttacked(pos, f1, enemy) && !isAttacked(pos, f2, enemy)) {
      out.push({ from, to: f2, piece, flags: 'k' });
    }
  }
  if (pos.castling.includes(rights.q)) {
    const d1 = from - 1, d2 = from - 2, d3 = from - 3;
    // b1/b8 must be empty but may be attacked — the king never crosses it.
    if (!pos.board[d1] && !pos.board[d2] && !pos.board[d3]
        && !isAttacked(pos, d1, enemy) && !isAttacked(pos, d2, enemy)) {
      out.push({ from, to: d2, piece, flags: 'q' });
    }
  }
}

// All pseudo-legal moves for the side to move (may leave the king in check).
function generatePseudo(pos) {
  const out = [];
  const color = pos.turn;

  for (let from = 0; from < 128; from++) {
    if (!onBoard(from)) { from += 7; continue; }
    const piece = pos.board[from];
    if (!piece || colorOf(piece) !== color) continue;
    const type = typeOf(piece);

    if (type === 'p') { addPawnMoves(pos, from, out); continue; }

    if (type === 'n' || type === 'k') {
      const offsets = type === 'n' ? KNIGHT_OFFSETS : ROYAL_OFFSETS;
      for (const off of offsets) {
        const to = from + off;
        if (!onBoard(to)) continue;
        const target = pos.board[to];
        if (target && colorOf(target) === color) continue;
        out.push(target
          ? { from, to, piece, captured: target, flags: 'c' }
          : { from, to, piece, flags: 'n' });
      }
      if (type === 'k') addCastleMoves(pos, from, out);
      continue;
    }

    const offsets = SLIDERS[type];
    if (!offsets) continue;
    for (const off of offsets) {
      let to = from + off;
      while (onBoard(to)) {
        const target = pos.board[to];
        if (!target) { out.push({ from, to, piece, flags: 'n' }); to += off; continue; }
        if (colorOf(target) !== color) out.push({ from, to, piece, captured: target, flags: 'c' });
        break;
      }
    }
  }
  return out;
}

// Apply a move to a position, returning the NEW position. Nothing is mutated —
// the search relies on that, and so does move legality below.
function applyMove(pos, move) {
  const next = clonePosition(pos);
  const color = pos.turn;
  const type = typeOf(move.piece);

  next.board[move.from] = null;
  next.board[move.to] = move.promotion
    ? (color === WHITE ? move.promotion.toUpperCase() : move.promotion)
    : move.piece;

  // En passant removes a pawn that isn't on the destination square.
  if (move.flags.includes('e')) {
    const dir = color === WHITE ? -16 : 16;
    next.board[move.to - dir] = null;
  }

  // Castling drags the rook across with the king.
  if (move.flags.includes('k')) {
    next.board[move.to - 1] = next.board[move.to + 1];
    next.board[move.to + 1] = null;
  } else if (move.flags.includes('q')) {
    next.board[move.to + 1] = next.board[move.to - 2];
    next.board[move.to - 2] = null;
  }

  // Castling rights: lost by moving the king or a rook, and by CAPTURING a rook
  // on its home square — the forgotten half that lets an illegal castle survive.
  let rights = next.castling;
  if (type === 'k') {
    rights = rights.replace(color === WHITE ? /[KQ]/g : /[kq]/g, '');
  }
  const CORNERS = { 112: 'Q', 119: 'K', 0: 'q', 7: 'k' };
  if (CORNERS[move.from]) rights = rights.replace(CORNERS[move.from], '');
  if (CORNERS[move.to])   rights = rights.replace(CORNERS[move.to], '');
  next.castling = rights;

  // En passant square is offered for exactly one ply.
  next.ep = move.flags.includes('b') ? (move.from + move.to) / 2 : null;

  // Fifty-move counter resets on a pawn move or any capture.
  next.halfmove = (type === 'p' || move.captured) ? 0 : pos.halfmove + 1;
  if (color === BLACK) next.fullmove = pos.fullmove + 1;
  next.turn = opposite(color);

  return next;
}

// Legal moves: pseudo-legal minus those that leave your own king attacked.
export function generateMoves(pos) {
  const color = pos.turn;
  return generatePseudo(pos).filter(m => !inCheck(applyMove(pos, m), color));
}

// ── SAN ──────────────────────────────────────────────────────────────────────

// Render a move in Standard Algebraic Notation, disambiguating only as far as
// the position actually requires (Nbd7, R1e2, Qh4e1).
export function moveToSan(pos, move, legalMoves = null) {
  if (move.flags.includes('k')) return withCheckMark(pos, move, 'O-O');
  if (move.flags.includes('q')) return withCheckMark(pos, move, 'O-O-O');

  const type = typeOf(move.piece);
  const capture = !!move.captured;
  let san = '';

  if (type === 'p') {
    if (capture) san += 'abcdefgh'[fileOf(move.from)] + 'x';
    san += toAlgebraic(move.to);
    if (move.promotion) san += '=' + move.promotion.toUpperCase();
    return withCheckMark(pos, move, san);
  }

  san += type.toUpperCase();

  // Disambiguation: which other same-type pieces could legally reach `to`?
  const moves = legalMoves || generateMoves(pos);
  const rivals = moves.filter(m =>
    m.to === move.to && m.from !== move.from && typeOf(m.piece) === type);
  if (rivals.length) {
    const sameFile = rivals.some(m => fileOf(m.from) === fileOf(move.from));
    const sameRank = rivals.some(m => rankOf(m.from) === rankOf(move.from));
    if (!sameFile) san += 'abcdefgh'[fileOf(move.from)];
    else if (!sameRank) san += String(8 - rankOf(move.from));
    else san += toAlgebraic(move.from);
  }

  if (capture) san += 'x';
  san += toAlgebraic(move.to);
  return withCheckMark(pos, move, san);
}

function withCheckMark(pos, move, san) {
  const after = applyMove(pos, move);
  if (!inCheck(after, after.turn)) return san;
  return generateMoves(after).length === 0 ? san + '#' : san + '+';
}

// Parse player input into one of `legalMoves`, or null.
// Accepts SAN (Nf3, exd6, O-O, e8=Q, with or without +/#/x) and the coordinate
// form (e2e4, e7e8q) — the latter is what the board's click-to-move sends, and
// what a player who doesn't know SAN will type anyway.
export function parseMove(pos, input, legalMoves = null) {
  if (!input) return null;
  const moves = legalMoves || generateMoves(pos);
  const raw = String(input).trim();

  // Castling, in all the spellings people actually use (0-0, o-o, OO).
  const castle = raw.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (castle === 'oo' || castle === '00') return moves.find(m => m.flags.includes('k')) || null;
  if (castle === 'ooo' || castle === '000') return moves.find(m => m.flags.includes('q')) || null;

  // Coordinate form.
  const coord = raw.replace(/[\s-]/g, '').toLowerCase();
  const coordMatch = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(coord);
  if (coordMatch) {
    const from = fromAlgebraic(coordMatch[1]);
    const to = fromAlgebraic(coordMatch[2]);
    const promo = coordMatch[3];
    const hits = moves.filter(m => m.from === from && m.to === to
      && (!m.promotion || !promo || m.promotion === promo));
    if (!hits.length) return null;
    // An unqualified promotion means a queen — nobody types e7e8 meaning a rook.
    return hits.find(m => !m.promotion || m.promotion === (promo || 'q')) || hits[0];
  }

  // SAN. Compare against generated SAN with the check/mate marks stripped, so a
  // player who omits (or adds) '+' is not punished for it.
  const want = raw.replace(/[+#!?]/g, '');
  const exact = moves.filter(m => moveToSan(pos, m, moves).replace(/[+#!?]/g, '') === want);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null; // genuinely ambiguous — make them say which

  // Lenient pass: same target square and piece letter, ignoring an omitted 'x'.
  const loose = /^([KQRBN])?([a-h])?([1-8])?x?([a-h][1-8])(?:=([QRBN]))?$/.exec(want);
  if (!loose) return null;
  const [, letter, fFile, fRank, target, promo] = loose;
  const to = fromAlgebraic(target);
  const cands = moves.filter(m =>
    m.to === to
    && typeOf(m.piece) === (letter ? letter.toLowerCase() : 'p')
    && (!fFile || fileOf(m.from) === 'abcdefgh'.indexOf(fFile))
    && (!fRank || rankOf(m.from) === 8 - Number(fRank))
    && (!promo || m.promotion === promo.toLowerCase()));
  return cands.length === 1 ? cands[0] : null;
}

// ── Game ─────────────────────────────────────────────────────────────────────

// Result codes. `winnerColor` is null for every drawn kind.
const DRAW_REASONS = {
  stalemate: 'stalemate',
  fiftyMove: 'the fifty-move rule',
  repetition: 'threefold repetition',
  material: 'insufficient material',
  agreed: 'agreement',
};

export class ChessGame {
  constructor(config = {}) {
    this.config = config;
    // Kept because the repetition count needs the position the game STARTED from,
    // which is never in `history`.
    this.startFen = config.startFen || START_FEN;
    this.position = parseFen(this.startFen);
    // seats: [{ seatIdx, playerId, handle, color }] — index 0 is White.
    this.seats = [];
    // Move log: [{ san, fen, color }] — fen is the position AFTER the move, and
    // is what the repetition test counts.
    this.history = [];
    this.result = null; // { over, winnerColor, reason, drawn }
    this.drawOfferedBy = null; // playerId with a live draw offer
  }

  // Assign colours and start the clock. White is whoever holds the lower seat
  // index unless config.swapColors flips it, so a rematch can alternate.
  startGame(seats, swap = false) {
    this.startFen = this.config.startFen || START_FEN;
    this.position = parseFen(this.startFen);
    this.history = [];
    this.result = null;
    this.drawOfferedBy = null;

    const ordered = [...seats].sort((a, b) => a.seatIdx - b.seatIdx);
    this.seats = ordered.map((s, i) => ({
      seatIdx: s.seatIdx,
      playerId: s.playerId,
      handle: s.handle,
      isBot: !!s.isBot,
      color: (swap ? i === 1 : i === 0) ? WHITE : BLACK,
    }));
    return { whiteHandle: this.seatByColor(WHITE)?.handle, blackHandle: this.seatByColor(BLACK)?.handle };
  }

  seatByColor(color) { return this.seats.find(s => s.color === color) || null; }
  seatByPlayer(playerId) { return this.seats.find(s => s.playerId === playerId) || null; }

  get turn() { return this.position.turn; }

  // Whose move it is, as a seat — the name GameTable's turn timer expects.
  getCurrentActor() {
    if (this.result) return null;
    return this.seatByColor(this.position.turn);
  }

  isOver() { return !!this.result; }

  legalMoves() { return generateMoves(this.position); }

  inCheck() { return inCheck(this.position, this.position.turn); }

  // Play a move. Returns { ok, error?, san?, move?, result?, events[] }.
  handleMove(playerId, input) {
    if (this.result) return { ok: false, error: 'The game is over.' };
    const seat = this.seatByPlayer(playerId);
    if (!seat) return { ok: false, error: "You aren't playing this game." };
    if (seat.color !== this.position.turn) return { ok: false, error: "It isn't your move." };

    const moves = generateMoves(this.position);
    const move = parseMove(this.position, input, moves);
    if (!move) {
      return { ok: false, error: `"${input}" isn't a legal move. Try a square pair like e2e4, or Nf3.` };
    }

    const san = moveToSan(this.position, move, moves);
    this.position = applyMove(this.position, move);
    this.history.push({ san, fen: toFen(this.position), color: seat.color, from: move.from, to: move.to });
    this.drawOfferedBy = null; // a move declines any outstanding offer

    const events = [];
    if (move.captured) {
      events.push(`${seat.handle} takes the ${PIECE_NAMES[typeOf(move.captured)]}.`);
    }

    this._checkGameEnd(events);
    return { ok: true, san, move, result: this.result, events };
  }

  // Decide whether the position that just arose ends the game.
  _checkGameEnd(events = []) {
    const moves = generateMoves(this.position);
    const checked = inCheck(this.position, this.position.turn);

    if (!moves.length) {
      if (checked) {
        const winner = opposite(this.position.turn);
        this.result = { over: true, winnerColor: winner, reason: 'checkmate', drawn: false };
        events.push('Checkmate.');
      } else {
        this.result = { over: true, winnerColor: null, reason: DRAW_REASONS.stalemate, drawn: true };
        events.push('Stalemate — a draw.');
      }
      return;
    }

    if (checked) events.push('Check.');

    if (this.position.halfmove >= 100) {
      this.result = { over: true, winnerColor: null, reason: DRAW_REASONS.fiftyMove, drawn: true };
      return;
    }
    if (this._isRepetition()) {
      this.result = { over: true, winnerColor: null, reason: DRAW_REASONS.repetition, drawn: true };
      return;
    }
    if (this._insufficientMaterial()) {
      this.result = { over: true, winnerColor: null, reason: DRAW_REASONS.material, drawn: true };
    }
  }

  // Threefold repetition compares the position only — piece placement, side to
  // move, castling rights and the ep square — never the move counters, which is
  // why the FEN is truncated to its first four fields here.
  //
  // The count runs over the STARTING position followed by the position after
  // every move, because the opening position is a repetition candidate like any
  // other and lives nowhere in `history`. Counting the live board separately
  // instead double-counts the last move, which is a threefold that fires on the
  // second occurrence — a draw nobody asked for, and it took a regress case
  // shaped like Nf3 Nf6 Ng1 Ng8 ×2 to see it.
  _isRepetition() {
    const key = fen => fen.split(' ').slice(0, 4).join(' ');
    const seen = [key(this.startFen), ...this.history.map(h => key(h.fen))];
    const current = seen[seen.length - 1];
    return seen.filter(k => k === current).length >= 3;
  }

  _insufficientMaterial() {
    const pieces = [];
    for (let sq = 0; sq < 128; sq++) {
      if (!onBoard(sq)) { sq += 7; continue; }
      const p = this.position.board[sq];
      if (p && typeOf(p) !== 'k') pieces.push({ type: typeOf(p), color: colorOf(p), sq });
    }
    if (!pieces.length) return true;                                  // K v K
    if (pieces.length === 1 && ['n', 'b'].includes(pieces[0].type)) return true; // K+minor v K
    if (pieces.length === 2 && pieces.every(p => p.type === 'b')
        && pieces[0].color !== pieces[1].color) {
      // Opposite-coloured kings' bishops on the SAME square colour can't mate.
      const shade = p => (fileOf(p.sq) + rankOf(p.sq)) % 2;
      if (shade(pieces[0]) === shade(pieces[1])) return true;
    }
    return false;
  }

  // Resign / draw agreement / forfeit — the endings that aren't on the board.
  resign(playerId) {
    if (this.result) return { ok: false, error: 'The game is already over.' };
    const seat = this.seatByPlayer(playerId);
    if (!seat) return { ok: false, error: "You aren't playing this game." };
    this.result = {
      over: true,
      winnerColor: opposite(seat.color),
      reason: 'resignation',
      drawn: false,
    };
    return { ok: true, result: this.result, seat };
  }

  agreeDraw(reason = DRAW_REASONS.agreed) {
    this.result = { over: true, winnerColor: null, reason, drawn: true };
    return this.result;
  }

  // A one-line description of how it ended, for the dealer to call aloud.
  resultLine() {
    if (!this.result) return null;
    const { winnerColor, reason, drawn } = this.result;
    if (drawn) return `Draw by ${reason}.`;
    const winner = this.seatByColor(winnerColor);
    const loser = this.seatByColor(opposite(winnerColor));
    if (reason === 'resignation') return `${loser?.handle || 'Black'} resigns. ${winner?.handle || 'White'} wins.`;
    if (reason === 'forfeit') return `${winner?.handle || 'White'} wins by forfeit.`;
    return `Checkmate. ${winner?.handle || 'White'} wins.`;
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  // FEN plus the SAN log: compact, and legible in the game_tables.state JSONB
  // when you're staring at a stuck row wondering what happened.
  toJSON() {
    return {
      fen: toFen(this.position),
      startFen: this.startFen,
      seats: this.seats,
      history: this.history,
      result: this.result,
    };
  }

  static fromJSON(data, config = {}) {
    const g = new ChessGame(config);
    g.position = parseFen(data.fen || START_FEN);
    g.startFen = data.startFen || START_FEN;
    g.seats = data.seats || [];
    g.history = data.history || [];
    g.result = data.result || null;
    return g;
  }

  // ── Read-only views (renderers and the bot) ────────────────────────────────

  // The board as 8 rows of 8, from White's side (row 0 = rank 8).
  grid() {
    const rows = [];
    for (let r = 0; r < 8; r++) {
      const row = [];
      for (let f = 0; f < 8; f++) row.push(this.position.board[r * 16 + f]);
      rows.push(row);
    }
    return rows;
  }

  // Material taken by each side, as piece letters, for the captured-pieces rail.
  captured() {
    const START = { p: 8, n: 2, b: 2, r: 2, q: 1 };
    const alive = { w: {}, b: {} };
    for (let sq = 0; sq < 128; sq++) {
      if (!onBoard(sq)) { sq += 7; continue; }
      const p = this.position.board[sq];
      if (!p || typeOf(p) === 'k') continue;
      const c = colorOf(p);
      alive[c][typeOf(p)] = (alive[c][typeOf(p)] || 0) + 1;
    }
    const out = { w: [], b: [] };
    for (const color of [WHITE, BLACK]) {
      for (const [type, n] of Object.entries(START)) {
        const missing = n - (alive[color][type] || 0);
        // A piece missing from White's army is one BLACK has captured.
        for (let i = 0; i < missing; i++) out[opposite(color)].push(type);
      }
    }
    return out;
  }

  // Material balance in centipawns, positive = White ahead.
  materialBalance() {
    let score = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (!onBoard(sq)) { sq += 7; continue; }
      const p = this.position.board[sq];
      if (!p) continue;
      const v = PIECE_VALUE[typeOf(p)];
      score += colorOf(p) === WHITE ? v : -v;
    }
    return score;
  }

  lastMove() { return this.history[this.history.length - 1] || null; }
}

export { WHITE, BLACK, START_FEN, toFen, parseFen, applyMove, opposite, typeOf, colorOf };
