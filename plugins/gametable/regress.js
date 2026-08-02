// GameTable plugin regression — covers the screen-reader "text mode" opt-in:
// the `pokertext` toggle (runtime Set + persisted player_flag) and that the
// narration builders are safe no-ops for players who haven't opted in. The full
// Hold'em flow is exercised live in-game; here we pin the accessibility seam.
import { query } from '../../server/models/db.js';
import { world } from '../../server/engine/world.js';
import { commands, _test } from './index.js';
import { textModePlayers, isTextMode, narrateTurn, narrateStreet, narrateDeal } from './text-mode.js';
import { getEnvironmentState } from '../../server/engine/environment.js';

export default async function regress({ check }) {
  const PID = `gametable_regress_${process.pid}`;
  const noop = () => {};
  const pokertext = (input, p) => commands.pokertext(input.split(/\s+/).filter(Boolean).slice(1), input, p, noop);
  // The stored preference is the game-wide Display Mode LADDER (server/engine/
  // presentation.js) — poker no longer keeps a `poker_text_mode` flag of its own.
  // Values are 'visual' / 'textgames' / 'log'.
  //
  // Poker's own `text` writes the MIDDLE rung, not the bottom one: it must not
  // take away somebody's map and hangar bay as a side effect of how they chose to
  // play cards. (A player already at `log` stays there — see applyPokerView.)
  const flagVal = async () =>
    (await query('SELECT flag_value FROM player_flags WHERE player_id=$1 AND flag_key=$2', [PID, 'display_mode'])).rows[0]?.flag_value;

  const player = { id: PID, handle: 'CardCounter', current_zone: 'void' };
  world.players.set(PID, player);

  // Off-shift gate: `call dealer` / `summon` must not haul scheduled staff out of
  // bed, because their own commute graph would walk them straight back out again.
  // Unscheduled staff (the Lucky Bastard back room, covert dealers) are never gated.
  // Built against the live GAME clock (not wall time) so the assertions hold at
  // whatever hour the suite happens to run.
  const gameHour = getEnvironmentState().hour;
  const everyDay = (blocks) => Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => [d, blocks]));
  const onNow  = everyDay([{ from: gameHour, to: gameHour + 1 }]);          // covers right now
  const offNow = everyDay([{ from: (gameHour + 2) % 24, to: (gameHour + 3) % 24 }]);

  check('isOffShift: no schedule means always available', _test.isOffShift({ vendor_schedule: {} }) === false);
  check('isOffShift: null schedule means always available', _test.isOffShift({}) === false);
  check('isOffShift: a dealer scheduled for this hour is on', _test.isOffShift({ vendor_schedule: onNow }) === false, `hour=${gameHour}`);
  check('isOffShift: a dealer scheduled for another hour is off', _test.isOffShift({ vendor_schedule: offNow }) === true, `hour=${gameHour}`);

  try {
    // Real players row so the player_flags write has a valid owner.
    await query('DELETE FROM players WHERE id=$1', [PID]).catch(() => {});
    await query('INSERT INTO players (id, username, handle, password_hash) VALUES ($1,$1,$2,$3)', [PID, player.handle, 'x']);
    textModePlayers.delete(PID);

    // `pokertext on` — opts in at runtime and persists.
    let r = await pokertext('pokertext on', player);
    check('pokertext on returns output', r?.type === 'output', JSON.stringify(r)?.slice(0, 120));
    check('pokertext on adds to the runtime set', isTextMode(PID), 'not in textModePlayers');
    check('pokertext on persists the middle rung, not the bottom one', (await flagVal()) === 'textgames', `flag=${await flagVal()}`);

    // `pokertext off` — opts back out and persists.
    r = await pokertext('pokertext off', player);
    check('pokertext off removes from the runtime set', !isTextMode(PID), 'still in textModePlayers');
    check('pokertext off persists the flag', (await flagVal()) === 'visual', `flag=${await flagVal()}`);

    // Bare `pokertext` toggles from the current state.
    await pokertext('pokertext', player);
    check('bare pokertext toggles on', isTextMode(PID), 'toggle did not turn on');
    await pokertext('pokertext', player);
    check('bare pokertext toggles off', !isTextMode(PID), 'toggle did not turn off');

    // `text` / `visual` are the same switch under natural names. With no table
    // here they just store the pref (and return an output note, not a pane).
    let tr = await commands.text([], 'text', player, noop);
    check('text switches to text mode', isTextMode(PID), 'text did not opt in');
    check('text with no table returns output', tr?.type === 'output', JSON.stringify(tr)?.slice(0, 120));
    check('text at the felt persists the middle rung', (await flagVal()) === 'textgames', `flag=${await flagVal()}`);
    let vr = await commands.visual([], 'visual', player, noop);
    check('visual switches back to visual mode', !isTextMode(PID), 'visual did not opt out');
    check('visual persists the flag', (await flagVal()) === 'visual', `flag=${await flagVal()}`);

    // `config.textTable` is the table's OPENING DEFAULT, never an override: it
    // decides the view only for a player with no stored preference, and a stored
    // preference beats it at every table in both directions.
    const plainTable = { config: {} };
    const oldSchool  = { config: { textTable: true } };

    await query('DELETE FROM player_flags WHERE player_id=$1', [PID]);
    await _test.ensureTextPref(player, plainTable);
    check('no stored pref at a normal table → visual', !isTextMode(PID));
    await _test.ensureTextPref(player, oldSchool);
    check('no stored pref at a textTable → opens in text', isTextMode(PID));

    await commands.visual([], 'visual', player, noop);          // store an explicit "visual"
    await _test.ensureTextPref(player, oldSchool);
    check('an explicit `visual` beats a textTable default', !isTextMode(PID), 'textTable overrode the player');

    await commands.text([], 'text', player, noop);              // store an explicit "text"
    await _test.ensureTextPref(player, plainTable);
    check('an explicit `text` survives at a normal table', isTextMode(PID));

    // …and `visual` must never be refused, at any table.
    const vAtOldSchool = await commands.visual([], 'visual', player, noop);
    check('`visual` is not refused at a textTable', vAtOldSchool?.type !== 'error', JSON.stringify(vAtOldSchool)?.slice(0, 120));
    await query('DELETE FROM player_flags WHERE player_id=$1', [PID]);

    // Narration builders must be safe no-ops when nobody at the table is opted in.
    const fakeGame = {
      pot: 100, currentBet: 40, bigBlind: 20, smallBlind: 10, dealerIdx: 0, community: [{ rank: 'A', suit: 's' }],
      seats: [{ playerId: PID, seatIdx: 0, chips: 480, bet: 0, hand: [{ rank: 'K', suit: 'h' }, { rank: 'K', suit: 'd' }] }],
    };
    const fakeTable = { game: fakeGame, seats: [{ playerId: PID, seatIdx: 0, isBot: false }], spectators: new Set() };
    let threw = false;
    try {
      narrateTurn(fakeTable, PID);    // opted out → should short-circuit
      narrateStreet(fakeTable, 'flop');
      narrateDeal(fakeTable);
      textModePlayers.add(PID);
      narrateTurn(fakeTable, PID);    // opted in → builds + sends (no live socket = harmless)
      narrateStreet(fakeTable, 'flop');
      narrateDeal(fakeTable);
    } catch (e) { threw = true; check('narration builders do not throw', false, e.message); }
    check('narration builders run cleanly', !threw, 'a builder threw');

    await chessRegress(check);
  } finally {
    textModePlayers.delete(PID);
    await query('DELETE FROM player_flags WHERE player_id=$1', [PID]).catch(() => {});
    await query('DELETE FROM players WHERE id=$1', [PID]).catch(() => {});
    world.players.delete(PID);
  }
}

// ── Chess ────────────────────────────────────────────────────────────────────
// The rules are pure and DB-free, so they're tested directly rather than driven
// through a live table. What's pinned here is the stuff that silently rots: the
// three special moves everyone forgets, the endings, and the round trip through
// persistence. Correct move GENERATION is proved separately by perft — these are
// the cases where a passing perft can still hide a broken game.
async function chessRegress(check) {
  const { ChessGame, parseFen, generateMoves, applyMove, parseMove, moveToSan, toAlgebraic }
    = await import('./games/chess.js');
  const { decideBotMove } = await import('./bot-chess.js');
  const { boardASCII } = await import('./text-chess.js');

  const newGame = (fen) => {
    const g = new ChessGame(fen ? { startFen: fen } : {});
    g.startGame([
      { seatIdx: 0, playerId: 'white', handle: 'White' },
      { seatIdx: 1, playerId: 'black', handle: 'Black' },
    ]);
    if (fen) g.position = parseFen(fen);
    return g;
  };
  const play = (g, moves) => {
    for (const m of moves) {
      const pid = g.turn === 'w' ? 'white' : 'black';
      const r = g.handleMove(pid, m);
      if (!r.ok) return { ok: false, failed: m, error: r.error };
    }
    return { ok: true };
  };
  const countFrom = (fen, from) =>
    generateMoves(parseFen(fen)).filter(m => toAlgebraic(m.from) === from).length;

  // Move legality — the three special cases.
  const epFen = 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3';
  const epMoves = generateMoves(parseFen(epFen)).filter(m => m.flags.includes('e'));
  check('chess: en passant is offered on the move after a double push', epMoves.length === 1,
    `found ${epMoves.length}`);
  const staleEp = 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3';
  check('chess: en passant expires after one move',
    generateMoves(parseFen(staleEp)).filter(m => m.flags.includes('e')).length === 0);

  // Castling: legal when the path is clear, refused THROUGH check, and the
  // king's own square being attacked refuses it too.
  const castleOk = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  check('chess: both castles are legal with a clear back rank',
    generateMoves(parseFen(castleOk)).filter(m => /[kq]/.test(m.flags)).length === 2);
  const throughCheck = 'r3k2r/8/8/8/8/5q2/8/R3K2R w KQkq - 0 1'; // f3 queen hits f1
  check('chess: castling through an attacked square is refused',
    generateMoves(parseFen(throughCheck)).filter(m => m.flags.includes('k')).length === 0);
  const inCheckFen = 'r3k2r/8/8/8/8/4q3/8/R3K2R w KQkq - 0 1';   // e3 queen hits e1
  check('chess: castling out of check is refused',
    generateMoves(parseFen(inCheckFen)).filter(m => /[kq]/.test(m.flags)).length === 0);

  // Capturing a rook on its home square must remove that castling right — the
  // half of the rule that gets forgotten, and it lets an illegal castle happen
  // several moves later with nothing on the board to explain it.
  const grabFen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  const grabPos = parseFen(grabFen);
  const rxa8 = generateMoves(grabPos)
    .find(m => toAlgebraic(m.from) === 'a1' && toAlgebraic(m.to) === 'a8');
  const grabbed = rxa8 && applyMove(grabPos, rxa8);
  check('chess: capturing a rook on its home square kills that castling right',
    grabbed && !grabbed.castling.includes('q'), `castling=${grabbed?.castling}`);
  check('chess: …and leaves the other rights alone',
    grabbed && grabbed.castling.includes('k'), `castling=${grabbed?.castling}`);
  // Moving your own rook off its corner costs the same right.
  const movedRook = applyMove(grabPos,
    generateMoves(grabPos).find(m => toAlgebraic(m.from) === 'h1' && toAlgebraic(m.to) === 'g1'));
  check('chess: moving a rook off its corner kills that castling right',
    movedRook && !movedRook.castling.includes('K') && movedRook.castling.includes('Q'),
    `castling=${movedRook?.castling}`);

  // A pinned piece cannot move — the whole point of filtering pseudo-legal moves
  // rather than trusting generation.
  check('chess: a piece pinned to its king cannot step aside',
    countFrom('4k3/4r3/8/8/8/4N3/8/4K3 w - - 0 1', 'e3') === 0);
  check('chess: an unpinned knight in the same spot moves freely',
    countFrom('4k3/8/8/8/8/4N3/8/4K3 w - - 0 1', 'e3') === 8);

  // Promotion offers all four pieces, and the coordinate form defaults to queen.
  const promoFen = '8/4P3/8/8/8/8/8/4K2k w - - 0 1';
  check('chess: a pawn on the seventh promotes four ways',
    generateMoves(parseFen(promoFen)).filter(m => m.promotion).length === 4);
  const promoPick = parseMove(parseFen(promoFen), 'e7e8');
  check('chess: an unqualified promotion means a queen', promoPick?.promotion === 'q',
    `got ${promoPick?.promotion}`);
  const promoRook = parseMove(parseFen(promoFen), 'e7e8r');
  check('chess: underpromotion is reachable by typing it', promoRook?.promotion === 'r');

  // Endings.
  let g = newGame();
  let r = play(g, ['f3', 'e5', 'g4', 'Qh4']);
  check('chess: Fool\'s Mate is playable move for move', r.ok, `${r.failed}: ${r.error}`);
  check('chess: Fool\'s Mate ends in checkmate', g.result?.reason === 'checkmate' && !g.result.drawn);
  check('chess: the loser is not the winner', g.result?.winnerColor === 'b');
  check('chess: checkmate is marked with # in the log', g.history.at(-1)?.san === 'Qh4#',
    g.history.at(-1)?.san);

  g = newGame('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  g._checkGameEnd();
  check('chess: stalemate is a draw, not a loss', g.result?.drawn && g.result.reason === 'stalemate',
    JSON.stringify(g.result));

  g = newGame('4k3/8/4K3/8/8/8/8/8 w - - 0 1');
  g._checkGameEnd();
  check('chess: bare kings is insufficient material', g.result?.drawn === true);

  g = newGame('4k3/8/8/8/8/8/8/4K3 w - - 99 1');
  g.position.halfmove = 100;
  g._checkGameEnd();
  check('chess: the fifty-move rule draws', g.result?.reason === 'the fifty-move rule');

  // Threefold repetition — knights out and back, twice.
  g = newGame();
  r = play(g, ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']);
  check('chess: a repeated position is playable', r.ok, `${r.failed}: ${r.error}`);
  check('chess: threefold repetition draws', g.result?.reason === 'threefold repetition',
    JSON.stringify(g.result));

  // Resignation.
  g = newGame();
  const res = g.resign('white');
  check('chess: resigning hands the game to the other side',
    res.ok && g.result.winnerColor === 'b' && g.result.reason === 'resignation');
  check('chess: a finished game refuses further moves', g.handleMove('black', 'e5').ok === false);

  // Turn order and ownership — the two ways a player cheats by accident.
  g = newGame();
  check('chess: you cannot move on your opponent\'s turn', g.handleMove('black', 'e5').ok === false);
  check('chess: a spectator cannot move', g.handleMove('nobody', 'e4').ok === false);
  check('chess: an illegal move is refused with a reason',
    g.handleMove('white', 'e2e5').ok === false);

  // Persistence round trip — a game restored mid-play must be the same game.
  g = newGame();
  play(g, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
  const restored = ChessGame.fromJSON(JSON.parse(JSON.stringify(g.toJSON())), {});
  check('chess: a restored game is on the same move', restored.turn === g.turn);
  check('chess: a restored game has the same legal moves',
    generateMoves(restored.position).length === generateMoves(g.position).length);
  check('chess: a restored game keeps its move log', restored.history.length === 6);
  check('chess: a restored game keeps both players',
    restored.seatByColor('w')?.playerId === 'white');
  const replay = restored.handleMove('white', 'Ba4');
  check('chess: a restored game can be played on', replay.ok, replay.error);

  // Input forms — everything a player might reasonably type for one move.
  const startPos = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  for (const form of ['e2e4', 'E2E4', 'e2-e4', 'e4']) {
    const m = parseMove(startPos, form);
    check(`chess: "${form}" is understood as e2e4`,
      m && toAlgebraic(m.from) === 'e2' && toAlgebraic(m.to) === 'e4');
  }
  const castlePos = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  for (const form of ['O-O', 'o-o', '0-0', 'OO']) {
    check(`chess: "${form}" castles kingside`, parseMove(castlePos, form)?.flags.includes('k') === true);
  }
  check('chess: "O-O-O" castles queenside', parseMove(castlePos, 'O-O-O')?.flags.includes('q') === true);
  check('chess: nonsense is refused, not guessed', parseMove(startPos, 'banana') === null);
  check('chess: a legal-looking but illegal move is refused', parseMove(startPos, 'e2e5') === null);

  // SAN disambiguation — two rooks that can both reach the same square must name
  // which one moved, or the move log is ambiguous and can't be replayed.
  // The king is parked off the back rank on purpose: with it on e1 it also
  // reaches d1, and "two pieces can reach d1" stops being a test about ROOKS.
  const twoRooks = parseFen('4k3/8/8/8/4K3/8/8/R6R w - - 0 1');
  const toD1 = generateMoves(twoRooks).filter(m => toAlgebraic(m.to) === 'd1');
  check('chess: both rooks can reach d1', toD1.length === 2, `${toD1.length}`);
  check('chess: two rooks reaching one square disambiguate by file',
    toD1.every(m => /^R[ah]d1$/.test(moveToSan(twoRooks, m))),
    toD1.map(m => moveToSan(twoRooks, m)).join(','));
  // …and a lone piece must NOT be disambiguated — "Rd1" when only one rook can
  // get there, not "Rad1". Noise in the log is its own bug.
  const oneRook = parseFen('4k3/8/8/8/4K3/8/8/R7 w - - 0 1');
  const soloD1 = generateMoves(oneRook).find(m => toAlgebraic(m.to) === 'd1');
  check('chess: a lone rook is not disambiguated', moveToSan(oneRook, soloD1) === 'Rd1',
    moveToSan(oneRook, soloD1));

  // The bot: must return a legal move, from any position, inside the budget.
  for (const [label, fen] of [
    ['the opening', null],
    ['a middlegame', 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1'],
    ['a king-and-pawn ending', '8/5k2/8/4P3/8/8/5K2/8 w - - 0 1'],
  ]) {
    const bg = newGame(fen);
    bg.seats[0].isBot = true;
    const started = Date.now();
    const mv = decideBotMove(bg, { playerId: 'white', persona: { depth: 2, blunder: 0 } });
    const elapsed = Date.now() - started;
    check(`chess bot: plays a legal move in ${label}`,
      mv != null && parseMove(bg.position, mv) != null, String(mv));
    check(`chess bot: answers ${label} inside the tick budget`, elapsed < 2000, `${elapsed}ms`);
  }
  // A bot that can mate in one must take it — the cheapest possible proof that
  // the search is looking at the position rather than shuffling.
  const mateIn1 = newGame('7k/6Q1/6K1/8/8/8/8/8 w - - 0 1');
  const best = decideBotMove(mateIn1, { playerId: 'white', persona: { depth: 2, blunder: 0 } });
  const chosen = parseMove(mateIn1.position, best);
  const after = chosen && applyMove(mateIn1.position, chosen);
  check('chess bot: takes a mate in one when offered',
    after && generateMoves(after).length === 0, String(best));

  // The written board must actually contain a board.
  const textGame = newGame();
  const ascii = boardASCII(textGame, 'w');
  check('chess text: the written board has all eight ranks', ascii.split('\n').length === 12, `${ascii.split('\n').length} lines`);
  check('chess text: the written board is oriented for the reader',
    ascii.split('\n')[2].startsWith('8 |') && ascii.split('\n')[9].startsWith('1 |'));
  const flipped = boardASCII(textGame, 'b');
  check('chess text: Black reads the board from Black\'s side',
    flipped.split('\n')[2].startsWith('1 |'));
}
