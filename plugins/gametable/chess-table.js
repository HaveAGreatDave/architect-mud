// ChessTable — the two-seat board game on top of TableBase.
//
// Everything about sitting down, spectating, the host NPC, the pane push and
// persistence comes from TableBase. This file owns only what chess adds: whose
// move it is, the per-viewer square selection, draw offers, the wager, and what
// happens when somebody walks away mid-game.
//
// Two deliberate differences from the felt next door:
//   • No dealer is required. Poker can't deal without one; two people can play
//     chess on a bench. A host NPC is decoration here, not a gate.
//   • The stake is optional. `config.stake` of 0 (the default) is a free game
//     and no credits move at all — TableBase's buy-in path is skipped whole.

import { query } from '../../server/models/db.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { emit } from '../../server/engine/events.js';
import { TableBase } from './table-base.js';
import { ChessGame, fromAlgebraic, toAlgebraic, generateMoves } from './games/chess.js';
import { renderChessPane } from './render-chess.js';
import { narrateBoard, narrateMove, narrateResult, isChessTextMode } from './text-chess.js';
import { chessBotId, isChessBotId, decideBotMove } from './bot-chess.js';

const START_DELAY_MS = 4_000;   // beat between the second player sitting and the first move
const DEFAULT_MOVE_SECS = 120;  // chess is a thinking game; the felt's 30s would be cruel

export class ChessTable extends TableBase {
  static MAX_SEATS = 2;

  constructor(row) {
    super(row);

    // Per-viewer picked-up piece: playerId → 0x88 square. Purely presentational
    // and never persisted — a refresh should not leave a piece half-lifted.
    this._selection = new Map();

    // Live draw offer: { byPlayerId, toPlayerId } | null
    this._drawOffer = null;

    this._startTimer = null;
    this._botMoveTimer = null;

    // Alternate colours between games so nobody keeps the white advantage.
    this._swapColors = false;

    const state = typeof row.state === 'string' ? JSON.parse(row.state) : (row.state || {});
    if (state.game && this.phase === 'InProgress') {
      const restored = ChessGame.fromJSON(state.game, this.config);
      // Bot seats aren't persisted, so a restored game that references one has
      // nobody to move for it. Abandon rather than stall (same call as poker).
      if (restored.seats.some(s => isChessBotId(s.playerId))) this.phase = 'WaitingForPlayers';
      else this.game = restored;
    }
    if (this.game) this._startTurnTimer();
  }

  // ── TableBase contract ─────────────────────────────────────────────────────

  get paneType() { return 'table_update'; }
  renderPaneFor(playerId) { return renderChessPane(this, playerId); }
  inTextMode(playerId) { return isChessTextMode(playerId); }
  isSyntheticSeat(playerId) { return isChessBotId(playerId); }

  // A free table moves no credits; a staked one escrows the wager at the seat.
  buyInFor(_player) {
    return Math.max(0, Number(this.config.stake) || 0);
  }

  get stake() { return Math.max(0, Number(this.config.stake) || 0); }

  // ── Selection (the two-step click) ─────────────────────────────────────────

  selectionFor(playerId) {
    const sq = this._selection.get(playerId);
    return sq == null ? null : sq;
  }

  // Pick up a piece. `none` puts it back down. Rejects anything that isn't the
  // player's own piece with at least one legal move — a piece that can't go
  // anywhere lights no squares, and a board full of dead ends reads as broken.
  pickSquare(playerId, algebraic) {
    if (!this.game || this.game.isOver()) return { ok: false, error: 'No game in progress.' };
    const seat = this.game.seatByPlayer(playerId);
    if (!seat) return { ok: false, error: 'You are not playing this game.' };
    if (seat.color !== this.game.turn) return { ok: false, error: "It isn't your move." };

    if (!algebraic || algebraic === 'none') {
      this._selection.delete(playerId);
      this.pushPaneAll();
      return { ok: true };
    }

    const sq = fromAlgebraic(algebraic);
    if (sq < 0) return { ok: false, error: `"${algebraic}" isn't a square.` };
    const moves = generateMoves(this.game.position).filter(m => m.from === sq);
    if (!moves.length) return { ok: false, error: `Nothing on ${algebraic} can move.` };

    this._selection.set(playerId, sq);
    this.pushPaneAll();
    return { ok: true, moves };
  }

  // ── Game flow ──────────────────────────────────────────────────────────────

  _checkAutoStart() {
    clearTimeout(this._startTimer);
    if (this.phase === 'InProgress') return;
    if (this.seatedCount() < 2) {
      this.phase = 'WaitingForPlayers';
      this.pushPaneAll();
      return;
    }
    this.phase = 'Ready';
    this.pushPaneAll();
    this._startTimer = setTimeout(() => this.startGame(), START_DELAY_MS);
  }

  startGame() {
    if (this.phase === 'InProgress') return;
    const seated = this.seats.filter(Boolean);
    if (seated.length < 2) return;

    this.game = new ChessGame(this.config);
    const { whiteHandle, blackHandle } = this.game.startGame(seated, this._swapColors);
    this.phase = 'InProgress';
    this._selection.clear();
    this._drawOffer = null;
    this.bubbles = {};

    this._hostSay(`${whiteHandle} has White. ${blackHandle} has Black.`
      + (this.stake ? ` ₵ ${(this.stake * 2).toLocaleString()} on the board.` : ''));
    this.pushPaneAll();
    narrateBoard(this);
    this._startTurnTimer();
    this._lastPersist = 0; // force a persist on the next tick
  }

  // Play a move for a player. Returns { ok, error?, san? }.
  processMove(playerId, input) {
    if (!this.game || this.phase !== 'InProgress') return { ok: false, error: 'No game in progress.' };
    const result = this.game.handleMove(playerId, input);
    if (!result.ok) return result;

    this._selection.delete(playerId);
    this._drawOffer = null;
    const seat = this.seats.find(s => s && s.playerId === playerId);
    if (seat) seat.autoMisses = 0;
    this.bubbles[playerId] = result.san;

    this._clearTurnTimer();
    for (const evt of result.events) this._hostSay(evt);
    this.pushPaneAll();
    narrateMove(this, result.san);

    if (this.game.isOver()) this._finish();
    else this._startTurnTimer();

    return result;
  }

  // ── Draw offers ────────────────────────────────────────────────────────────

  offerDraw(playerId) {
    if (!this.game || this.game.isOver()) return { ok: false, error: 'No game in progress.' };
    const seat = this.game.seatByPlayer(playerId);
    if (!seat) return { ok: false, error: 'You are not playing this game.' };
    const other = this.game.seats.find(s => s.playerId !== playerId);
    if (!other) return { ok: false, error: 'There is nobody to offer a draw to.' };
    if (this._drawOffer?.byPlayerId === playerId) return { ok: false, error: 'You already offered a draw.' };

    this._drawOffer = { byPlayerId: playerId, toPlayerId: other.playerId };
    this._hostSay(`${seat.handle} offers a draw.`);
    sendToPlayer(other.playerId, { type: 'output', message: `${seat.handle} offers a draw. \`acceptdraw\` or \`declinedraw\`.` });
    this.pushPaneAll();
    return { ok: true, offeredTo: other.handle };
  }

  respondDraw(playerId, accept) {
    if (!this._drawOffer || this._drawOffer.toPlayerId !== playerId) {
      return { ok: false, error: 'No draw has been offered to you.' };
    }
    const by = this.game?.seatByPlayer(this._drawOffer.byPlayerId);
    this._drawOffer = null;
    if (!accept) {
      this._hostSay('Draw declined. Play on.');
      this.pushPaneAll();
      return { ok: true, accepted: false };
    }
    this.game.agreeDraw();
    this._hostSay(`Draw agreed with ${by?.handle || 'the other player'}.`);
    this._finish();
    return { ok: true, accepted: true };
  }

  drawOfferedTo(playerId) { return this._drawOffer?.toPlayerId === playerId; }

  drawOfferText(viewerId) {
    if (!this._drawOffer) return '';
    if (this._drawOffer.toPlayerId === viewerId) return '<span class="chess-offer">Draw offered to you</span>';
    if (this._drawOffer.byPlayerId === viewerId) return '<span class="chess-offer">Draw offer pending</span>';
    return '';
  }

  // ── Resignation and endings ────────────────────────────────────────────────

  resign(playerId) {
    if (!this.game || this.game.isOver()) return { ok: false, error: 'No game in progress.' };
    const res = this.game.resign(playerId);
    if (!res.ok) return res;
    this._finish();
    return res;
  }

  // Settle the game: call the result, pay the stake, then reset for a rematch.
  _finish() {
    this._clearTurnTimer();
    clearTimeout(this._botMoveTimer);
    this.phase = 'GameComplete';
    this._selection.clear();
    this._drawOffer = null;

    const line = this.game.resultLine();
    this._hostSay(line);
    this.pushPaneAll();
    narrateResult(this, line);

    this._settleStake().catch(e => console.error('[gametable] chess settle:', e.message));

    // Colours alternate on the rematch, and the board resets after a beat so the
    // final position stays up long enough to look at.
    this._swapColors = !this._swapColors;
    clearTimeout(this._startTimer);
    this._startTimer = setTimeout(() => {
      this.game = null;
      this.bubbles = {};
      this._checkAutoStart();
    }, (this.config.rematchDelaySecs || 12) * 1000);
  }

  // Pay out the escrowed wager. A win takes both stakes; a draw returns them.
  // Seat chips are zeroed first so leaveTable can never pay the same stake twice.
  async _settleStake() {
    if (!this.stake || !this.game?.result) return;
    const pot = this.seats.filter(Boolean).reduce((n, s) => n + (s.chips || 0), 0);
    if (!pot) return;

    const result = this.game.result;
    const payouts = [];

    if (result.drawn) {
      for (const s of this.seats.filter(Boolean)) {
        if (s.chips > 0) payouts.push([s, s.chips]);
        s.chips = 0;
      }
    } else {
      const winnerSeat = this.game.seatByColor(result.winnerColor);
      const winner = this.seats.find(s => s && s.playerId === winnerSeat?.playerId);
      for (const s of this.seats.filter(Boolean)) s.chips = 0;
      if (winner) payouts.push([winner, pot]);
    }

    for (const [seat, amount] of payouts) {
      if (seat.isBot || amount <= 0) continue;
      await query('UPDATE players SET credits = credits + $1 WHERE id = $2', [amount, seat.playerId]);
      const { rows } = await query('SELECT credits FROM players WHERE id=$1', [seat.playerId]);
      if (rows.length) sendToPlayer(seat.playerId, { type: 'player_update', credits: rows[0].credits });
      const net = amount - (seat.buyIn || 0);
      if (net > 0) {
        sendToPlayer(seat.playerId, { type: 'output', message: `You take the board — ₵ ${net.toLocaleString()} up.` });
        if (net >= 1000) {
          emit('gossip.pokerWin', { player: { id: seat.playerId, handle: seat.handle }, amount: net, zoneId: this.zoneId });
        }
      } else if (result.drawn) {
        sendToPlayer(seat.playerId, { type: 'output', message: 'A draw. Your stake comes back.' });
      }
    }
  }

  // Walking away from a live game is a forfeit — the stake goes with it. This is
  // the same rule as the disconnect path, which is deliberate: a losing player
  // must not be able to save the wager by closing the tab.
  async leaveTable(playerId) {
    const idx = this.seatedIndex(playerId);
    if (idx < 0) {
      this.spectators.delete(playerId);
      return { ok: true };
    }
    const seat = this.seats[idx];

    if (this.game && this.phase === 'InProgress' && this.game.seatByPlayer(playerId)) {
      const opponent = this.game.seats.find(s => s.playerId !== playerId);
      this.game.result = {
        over: true,
        winnerColor: opponent ? opponent.color : null,
        reason: 'forfeit',
        drawn: !opponent,
      };
      this._hostSay(`${seat.handle} walks away from the board.`);
      this._finish();
      await new Promise(r => setTimeout(r, 0)); // let _settleStake's payout land first
    }

    this.seats[idx] = null;
    this._selection.delete(playerId);
    clearTimeout(this._retainTimers[playerId]);
    delete this._retainTimers[playerId];

    // Anything still on the seat (an unplayed stake) goes back.
    if (!seat.isBot && seat.chips > 0) {
      await query('UPDATE players SET credits = credits + $1 WHERE id = $2', [seat.chips, playerId]);
      const { rows } = await query('SELECT credits FROM players WHERE id=$1', [playerId]);
      if (rows.length) sendToPlayer(playerId, { type: 'player_update', credits: rows[0].credits });
    }

    this._checkGameViable();
    this.pushPaneAll();
    await this._persist();
    return { ok: true };
  }

  _checkGameViable() {
    if (this.phase === 'InProgress' && this.seatedCount() < 2) {
      this._clearTurnTimer();
      this.phase = 'WaitingForPlayers';
      this.game = null;
    }
  }

  // ── Turn timer ─────────────────────────────────────────────────────────────

  // A move clock, not a chess clock: each move gets the same budget. Running out
  // twice in a row forfeits — an abandoned board must not hold a seat and a
  // stake hostage forever.
  _startTurnTimer() {
    this._clearTurnTimer();
    if (!this.game || this.game.isOver()) return;
    const actor = this.game.getCurrentActor();
    if (!actor) return;

    const seat = this.seats.find(s => s && s.playerId === actor.playerId);
    if (seat?.isBot) { this._scheduleBotMove(seat); return; }

    const secs = this.config.moveTimerSecs || DEFAULT_MOVE_SECS;
    const pid = actor.playerId;

    const warnHandle = setTimeout(() => {
      sendToPlayer(pid, { type: 'output', message: '⚠ 20 seconds to move.' });
    }, Math.max(1, secs - 20) * 1000);

    const foldHandle = setTimeout(() => {
      const st = this.seats.find(s => s && s.playerId === pid);
      if (!st) return;
      st.autoMisses = (st.autoMisses || 0) + 1;
      if (st.autoMisses >= 2) {
        sendToPlayer(pid, { type: 'output', message: 'You let the clock run out twice. You forfeit the game.' });
        this.leaveTable(pid).catch(e => console.error('[gametable] chess timeout:', e.message));
        return;
      }
      sendToPlayer(pid, { type: 'output', message: '⚠ Clock ran out. Move now or you forfeit.' });
      this._startTurnTimer();
    }, secs * 1000);

    this._turnTimer = { warnHandle, foldHandle, playerId: pid };
  }

  _scheduleBotMove(seat) {
    clearTimeout(this._botMoveTimer);
    // The pause scales a little with how sharp the opponent is, so a strong
    // hustler visibly thinks and a weak one slaps pieces down.
    const think = 700 + Math.floor(Math.random() * 1200) + (seat.persona?.depth || 2) * 300;
    this._botMoveTimer = setTimeout(() => {
      if (!this.game || this.phase !== 'InProgress') return;
      const actor = this.game.getCurrentActor();
      if (!actor || actor.playerId !== seat.playerId) return;
      const move = decideBotMove(this.game, seat);
      if (!move) return;
      const res = this.processMove(seat.playerId, move);
      if (!res.ok) {
        // Never leave the board stalled on a bot with no clock: play anything legal.
        const any = generateMoves(this.game.position)[0];
        if (any) this.processMove(seat.playerId, `${toAlgebraic(any.from)}${toAlgebraic(any.to)}`);
      }
    }, think);
  }

  // ── Host NPC (optional) ────────────────────────────────────────────────────

  // Chess needs no dealer, so a table with no NPC simply says nothing rather
  // than refusing to start. _dealerSay already no-ops without one.
  _hostSay(text) { this._dealerSay(text); }

  // Ambient chatter, driven by the plugin tick.
  hostIdle() {
    if (this.phase !== 'InProgress') return;
    const lines = [
      'Take your time. The board has nowhere to be.',
      'Somebody in this room is about to lose a bishop.',
      'I have seen better play. I have seen much worse.',
      "The clock is a player too, friend.",
    ];
    this._hostSay(lines[Math.floor(Math.random() * lines.length)]);
    this.pushPaneAll();
  }
}
