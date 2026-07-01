// GameTable — seat management, lifecycle, broadcasting.
// Contains no game rules; delegates to the attached game plugin (holdem.js).

import { query } from '../../server/models/db.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getLivePlayer, getZonePlayers } from '../../server/engine/world.js';
import { HoldemGame } from './games/holdem.js';
import { renderPane } from './render-pane.js';

export const MAX_SEATS = 4;
const AUTO_START_DELAY_MS = 15_000; // wait this long after 2nd player joins before starting
const SEAT_RETAIN_MS = 60_000;      // hold seat for disconnected player before auto-folding

// Dealer flavor lines by moment. Spoken quips (shown in the dealer's speech
// bubble) — brutal, dry, house-always-wins tone.
const DEALER_LINES = {
  newHand: [
    'Shuffle up and deal.',
    'Fresh deck, fresh regrets. Ante up.',
    'New hand. Try not to embarrass yourselves.',
    'Cards in the air. May the odds resent you.',
  ],
  flop: [
    'Here comes the flop.',
    "Flop's out. Somebody just got happy.",
    "Three on the felt. Read 'em and weep.",
  ],
  turn: [
    'The turn. Fourth street.',
    'Turn card. Still time to make a mistake.',
    'The trap tightens.',
  ],
  river: [
    'The river. Last card.',
    'No more cards, no more excuses.',
    "River's down. Pray to whatever's left.",
  ],
  showdown: [
    "Showdown. Turn 'em over.",
    'Cards up. Moment of truth.',
    "Let's see who was bluffing.",
  ],
  idle: [
    'Place your bets.',
    "Pot's right.",
    'No more bets after the deal.',
    'Keep your hands where I can see them.',
    'The house always eats.',
    'Take your time. The dead have plenty.',
  ],
};

// Lines for when a single player is sitting alone waiting for the table to fill.
// {name} is replaced with the lone player's handle.
const WAITING_LINES = {
  // Chatting up the one player who did sit down.
  solo: [
    'Just you and me, {name}. Cozy.',
    "You can't bluff the house, {name}, but I admire the ambition.",
    'Stick around, {name}. The suckers usually wander in eventually.',
    'One player, one dealer, zero action. Living the dream, {name}.',
    "Buy you a drink, {name}? Kidding. The bar's a smoking crater.",
  ],
  // Heckling other people standing in the room to sit down.
  recruit: [
    'Two open seats and a crowd too gutless to sit. Adorable.',
    "Come on — somebody in here has credits to lose. Don't be shy.",
    'I can see you lurking. The felt only bites a little. Sit.',
    'Free seats, warm cards, and not one spine between you. Pathetic.',
    "What's the matter, allergic to money? Park it.",
    "{name}'s waiting to take your credits. Rude to keep a player waiting.",
  ],
  // Nobody else in the room at all — the dealer riffs on the emptiness.
  emptyRoom: [
    "Nobody here but us, {name}. I've dealt to livelier morgues.",
    'Empty room, empty pot. At least you showed up, {name}.',
    "I'd call for players, but there's no one left alive to hear it. Just you, {name}.",
    'This is the part where a crowd gathers. Any second now. Annnny second.',
    'You, me, and a whole lot of nothing, {name}. Riveting stuff.',
    'Tumbleweed would liven this place up. Sit tight, {name}.',
  ],
};

// In-memory registry of all active GameTable instances keyed by table DB id.
export const activeTables = new Map();

export class GameTable {
  constructor(row) {
    this.id       = row.id;
    this.zoneId   = row.zone_id;
    this.name     = row.name;
    this.gameType = row.game_type || 'holdem';
    this.config   = typeof row.config === 'string' ? JSON.parse(row.config) : (row.config || {});
    this.phase    = row.phase || 'WaitingForPlayers';

    // seats: fixed array of 4. null = empty. Each entry: { playerId, handle, chips, seatIdx, disconnectedAt }
    this.seats = Array(MAX_SEATS).fill(null);

    // spectatorIds: Set of player IDs watching but not seated
    this.spectators = new Set();

    // Current game plugin instance
    this.game = null;

    // Last action speech bubbles: { playerId → actionLabel }
    this.bubbles = {};

    // Player chat bubbles from `say`: { playerId → text }
    this.chatBubbles = {};

    // Current dealer speech-bubble line (raw text), or null
    this.dealerBubble = null;

    // playerIds who won the most recent completed hand (drives winner glow)
    this.lastWinners = [];

    // Auto-clear timers for the bubbles above
    this._sayTimers = {};
    this._dealerBubbleTimer = null;

    // One-render animation flags (consumed by pushPaneAll, like game.dealPhase)
    this._betAnimPlayer = null;  // playerId whose bet pile should toss in
    this._sweepAnim = false;     // pot pile plays the sweep-in animation

    // Auto-start timer handle
    this._autoStartTimer = null;

    // Seat retention timers: { playerId → timeoutHandle }
    this._retainTimers = {};

    // Turn timer handles: { warnHandle, foldHandle, playerId }
    this._turnTimer = null;

    // Pending board run-out timer (set when everyone remaining is all-in)
    this._runoutTimer = null;

    // Last time state was persisted to DB
    this._lastPersist = 0;

    // Restore state from DB if a hand was in progress
    const state = typeof row.state === 'string' ? JSON.parse(row.state) : (row.state || {});
    if (state.seats) {
      for (const s of state.seats) {
        if (s && s.seatIdx >= 0 && s.seatIdx < MAX_SEATS) {
          this.seats[s.seatIdx] = s;
        }
      }
    }
    if (state.game && this.phase === 'InProgress') {
      this.game = HoldemGame.fromJSON(state.game, this.config);
    }

    activeTables.set(this.id, this);
  }

  // ── Seating ────────────────────────────────────────────────────────────────

  // Returns { ok, error, seatIdx }
  async joinTable(player, preferredSeat = null) {
    if (this.phase === 'Closed') return { ok: false, error: 'This table is closed.' };
    if (this.seatedIndex(player.id) >= 0) return { ok: false, error: 'You are already seated.' };
    if (this.openSeats() === 0) return { ok: false, error: 'No seats available.' };

    const buyIn = this.config.buyIn || this.config.minBuyIn || 100;
    if ((player.credits || 0) < buyIn) return { ok: false, error: `You need at least ₵ ${buyIn} to join.` };

    // Deduct credits
    const { rowCount } = await query(
      'UPDATE players SET credits = credits - $1 WHERE id = $2 AND credits >= $1',
      [buyIn, player.id]
    );
    if (!rowCount) return { ok: false, error: `You need at least ₵ ${buyIn} to join.` };

    // Assign seat
    let seatIdx = preferredSeat !== null && this.seats[preferredSeat] === null ? preferredSeat : null;
    if (seatIdx === null) {
      seatIdx = this.seats.findIndex(s => s === null);
    }

    this.seats[seatIdx] = { playerId: player.id, handle: player.handle, chips: buyIn, seatIdx };
    this.spectators.delete(player.id);

    // Send credit update to client
    const { rows: pRows } = await query('SELECT credits FROM players WHERE id=$1', [player.id]);
    if (pRows.length) {
      sendToPlayer(player.id, { type: 'player_update', credits: pRows[0].credits });
    }

    this._checkAutoStart();
    await this._persist();
    return { ok: true, seatIdx };
  }

  async leaveTable(playerId) {
    const idx = this.seatedIndex(playerId);
    if (idx < 0) {
      this.spectators.delete(playerId);
      return { ok: true };
    }

    const seat = this.seats[idx];
    const chips = seat.chips;

    // If game active, fold first
    if (this.game && this.phase === 'InProgress') {
      const gameSeat = this.game.seats.find(s => s.playerId === playerId);
      if (gameSeat && !gameSeat.folded) {
        const result = this.game.handleAction(playerId, 'fold', 0);
        if (result.ok) this._handleActionResult(result, playerId);
      }
    }

    this.seats[idx] = null;
    clearTimeout(this._retainTimers[playerId]);
    delete this._retainTimers[playerId];

    // Return chips to credits
    if (chips > 0) {
      await query('UPDATE players SET credits = credits + $1 WHERE id = $2', [chips, playerId]);
      const { rows } = await query('SELECT credits FROM players WHERE id=$1', [playerId]);
      if (rows.length) sendToPlayer(playerId, { type: 'player_update', credits: rows[0].credits });
      sendToPlayer(playerId, { type: 'output', message: `You cash out ₵ ${chips} from the table.` });
    }

    this._checkGameViable();
    this.pushPaneAll();
    await this._persist();
    return { ok: true };
  }

  addSpectator(playerId) {
    if (this.seatedIndex(playerId) < 0) this.spectators.add(playerId);
  }

  removeSpectator(playerId) {
    this.spectators.delete(playerId);
  }

  // ── Game flow ──────────────────────────────────────────────────────────────

  startHand() {
    if (this.phase === 'InProgress') return;
    const active = this.seats
      .filter(Boolean)
      .map(s => ({ seatIdx: s.seatIdx, playerId: s.playerId, handle: s.handle, chips: s.chips }));
    if (active.length < 2) return;

    this.game = new HoldemGame(this.config);
    const prevDealerSeatIdx = this._nextDealerSeatIdx();
    const info = this.game.startHand(active, prevDealerSeatIdx);
    this.phase = 'InProgress';
    this.bubbles = {};
    this.chatBubbles = {};
    this.lastWinners = [];

    // Broadcast deal event to room
    const dealerName = this.game.getDealerSeat()?.handle || '?';
    this._dealerSay(`New hand. Blinds: ₵ ${this.game.smallBlind} / ₵ ${this.game.bigBlind}. Dealer: ${dealerName}.`);
    this._dealerSay(`${info.sbHandle} posts small blind ₵ ${this.game.smallBlind}. ${info.bbHandle} posts big blind ₵ ${this.game.bigBlind}.`);
    this._dealerSay(this._quip('newHand'));

    this.pushPaneAll();
    this._promptOrRunout();
    this._lastPersist = 0; // force persist on next tick
  }

  processAction(playerId, action, amount = 0) {
    if (!this.game || this.phase !== 'InProgress') return { ok: false, error: 'No active hand.' };
    const result = this.game.handleAction(playerId, action, amount);
    if (!result.ok) return result;

    // Record bubble
    const labelMap = { fold: 'FOLD', check: 'CHECK', call: 'CALL', bet: `BET ${amount}`, raise: `RAISE ${amount}`, allin: 'ALL IN' };
    this.bubbles[playerId] = labelMap[action] || action.toUpperCase();

    // Money-committing actions toss their bill pile onto the felt this render.
    if (action === 'call' || action === 'bet' || action === 'raise' || action === 'allin') {
      this._betAnimPlayer = playerId;
    }

    this._handleActionResult(result, playerId);
    return result;
  }

  _handleActionResult(result, actorId) {
    this._clearTurnTimer();

    for (const evt of (result.events || [])) {
      this._dealerSay(evt);
    }

    if (result.phaseResult) {
      this._onPhaseResult(result.phaseResult);
    } else {
      this.pushPaneAll();
      this._startTurnTimer();
    }
  }

  _onPhaseResult(pr) {
    if (pr.phase === 'flop' || pr.phase === 'turn' || pr.phase === 'river') {
      this._dealerSay(this._quip(pr.phase));
      this._sweepAnim = true; // bets were just reset — animate the sweep to the pot
      this.pushPaneAll();
      this._promptOrRunout();
    } else if (pr.phase === 'showdown') {
      this._dealerSay(this._quip('showdown'));
      this.lastWinners = (pr.winners || []).map(w => w.seat.playerId);
      for (const w of (pr.winners || [])) {
        if (w.handName) {
          this._dealerSay(`${w.seat.handle} wins ₵ ${w.chips} with ${w.handName}.`);
        } else {
          this._dealerSay(`${w.seat.handle} wins ₵ ${w.chips} (${w.reason}).`);
        }
      }
      this.phase = 'HandComplete';
      this.pushPaneAll();
      // Apply chip totals from game back to seat objects
      for (const gs of this.game.seats) {
        const seat = this.seats.find(s => s && s.playerId === gs.playerId);
        if (seat) seat.chips = gs.chips;
      }
      // Remove broke players
      for (let i = 0; i < this.seats.length; i++) {
        if (this.seats[i] && this.seats[i].chips === 0) {
          sendToPlayer(this.seats[i].playerId, { type: 'output', message: 'You have no chips left. You leave the table.' });
          this.leaveTable(this.seats[i].playerId);
        }
      }
      // Auto-start next hand after delay
      this._autoStartTimer = setTimeout(() => {
        this.game = null;
        this.bubbles = {};
        this._checkAutoStart();
      }, (this.config.autoStartDelaySecs || 8) * 1000);
    }
  }

  // ── Turn timer ─────────────────────────────────────────────────────────────

  // Prompt the player to act, or — when no further betting is possible (everyone
  // remaining is all-in) — deal the rest of the board out automatically.
  _promptOrRunout() {
    if (this.game?.bettingOpen() && this.game.getCurrentActor()) {
      this._startTurnTimer();
    } else {
      this._scheduleRunout();
    }
  }

  _scheduleRunout() {
    this._clearTurnTimer();
    clearTimeout(this._runoutTimer);
    this._runoutTimer = setTimeout(() => {
      if (!this.game || this.phase !== 'InProgress') return;
      const pr = this.game._nextPhase();
      this._onPhaseResult(pr);
    }, 1500);
  }

  _startTurnTimer() {
    this._clearTurnTimer();
    const timerSecs = this.config.turnTimerSecs || 30;
    const actor = this.game?.getCurrentActor();
    if (!actor) return;
    const pid = actor.playerId;

    const warnHandle = setTimeout(() => {
      sendToPlayer(pid, { type: 'output', message: '⚠ 10 seconds to act.' });
    }, (timerSecs - 10) * 1000);

    const foldHandle = setTimeout(() => {
      const action = this.game?.canCheck(pid) ? 'check' : 'fold';
      this.processAction(pid, action, 0);
      sendToPlayer(pid, { type: 'output', message: `Time expired — you were auto-${action}ed.` });
    }, timerSecs * 1000);

    this._turnTimer = { warnHandle, foldHandle, playerId: pid };
  }

  _clearTurnTimer() {
    if (!this._turnTimer) return;
    clearTimeout(this._turnTimer.warnHandle);
    clearTimeout(this._turnTimer.foldHandle);
    this._turnTimer = null;
  }

  // ── Seat retention (disconnect) ────────────────────────────────────────────

  onPlayerDisconnect(playerId) {
    if (this.seatedIndex(playerId) < 0) return;
    clearTimeout(this._retainTimers[playerId]);
    this._retainTimers[playerId] = setTimeout(() => {
      const idx = this.seatedIndex(playerId);
      if (idx >= 0 && !getLivePlayer(playerId)) {
        this.leaveTable(playerId);
      }
    }, SEAT_RETAIN_MS);
  }

  onPlayerReconnect(playerId) {
    clearTimeout(this._retainTimers[playerId]);
    delete this._retainTimers[playerId];
  }

  // ── Broadcasting ───────────────────────────────────────────────────────────

  pushPaneAll() {
    const recipients = [
      ...this.seats.filter(Boolean).map(s => s.playerId),
      ...this.spectators,
    ];
    for (const pid of recipients) {
      sendToPlayer(pid, { type: 'poker_update', html: renderPane(this, pid) });
    }
    // Clear one-render animation flags after first push
    if (this.game) this.game.dealPhase = false;
    this._betAnimPlayer = null;
    this._sweepAnim = false;
  }

  _dealerSay(text) {
    if (!text) return;
    // Drive the dealer's on-table speech bubble. It clears itself after a lull
    // so it doesn't hang stale between hands. (No push here — the callers that
    // emit dealer lines already pushPaneAll immediately afterwards.)
    this.dealerBubble = text;
    clearTimeout(this._dealerBubbleTimer);
    this._dealerBubbleTimer = setTimeout(() => {
      this.dealerBubble = null;
      this.pushPaneAll();
    }, 7000);
    // Also echo to the room chat log so observers not watching the pane see it.
    // Import sendToZone lazily to avoid circular dep issues at load time.
    import('../../server/engine/messaging.js').then(({ sendToZone }) => {
      sendToZone(this.zoneId, { type: 'zone_event', message: `<span class="dealer-say">[Dealer] ${text}</span>` });
    });
  }

  _quip(kind) {
    const lines = DEALER_LINES[kind];
    if (!lines || !lines.length) return '';
    return lines[Math.floor(Math.random() * lines.length)];
  }

  // Ambient dealer chatter between actions (driven by the plugin tick).
  dealerIdle() {
    if (this.phase !== 'InProgress') return;
    this._dealerSay(this._quip('idle'));
    this.pushPaneAll();
  }

  // A lone player is waiting for the table to fill. The dealer chats them up,
  // heckles the room to sit down, or — if the room's empty — jokes about it.
  dealerWaitingBanter() {
    if (this.game || this.seatedCount() !== 1) return;
    const lone = this.seats.find(Boolean);
    if (!lone) return;

    const others = getZonePlayers(this.zoneId).filter(p => this.seatedIndex(p.id) < 0).length;
    let pool;
    if (others > 0) {
      // Mostly heckle the crowd to sit; sometimes just chat with the lone player.
      pool = Math.random() < 0.65 ? WAITING_LINES.recruit : WAITING_LINES.solo;
    } else {
      pool = WAITING_LINES.emptyRoom;
    }
    const line = pool[Math.floor(Math.random() * pool.length)].replace(/\{name\}/g, lone.handle);
    this._dealerSay(line);
    this.pushPaneAll();
  }

  // A seated player used `say` — float the line as a speech bubble over their seat.
  playerSay(playerId, text) {
    if (this.seatedIndex(playerId) < 0 || !text) return;
    this.chatBubbles[playerId] = text;
    clearTimeout(this._sayTimers[playerId]);
    this._sayTimers[playerId] = setTimeout(() => {
      delete this.chatBubbles[playerId];
      this.pushPaneAll();
    }, 7000);
    this.pushPaneAll();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  seatedIndex(playerId) {
    return this.seats.findIndex(s => s && s.playerId === playerId);
  }

  openSeats() {
    return this.seats.filter(s => s === null).length;
  }

  seatedCount() {
    return this.seats.filter(Boolean).length;
  }

  _nextDealerSeatIdx() {
    // Rotate dealer each hand. Find first filled seat after current dealer.
    const current = this.game?.getDealerSeat()?.seatIdx ?? -1;
    for (let i = 1; i <= MAX_SEATS; i++) {
      const idx = (current + i) % MAX_SEATS;
      if (this.seats[idx]) return idx;
    }
    return 0;
  }

  _checkAutoStart() {
    clearTimeout(this._autoStartTimer);
    if (this.phase === 'InProgress') return;
    const n = this.seatedCount();
    if (n < 2) { this.phase = 'WaitingForPlayers'; this.pushPaneAll(); return; }
    this.phase = 'Ready';
    this.pushPaneAll();
    const delay = (this.config.autoStartDelaySecs || 8) * 1000;
    this._autoStartTimer = setTimeout(() => this.startHand(), delay);
  }

  _checkGameViable() {
    if (this.phase !== 'InProgress') return;
    const alive = this.game?.seats.filter(s => !s.folded && !s.allIn) || [];
    if (this.seatedCount() < 2) {
      this._clearTurnTimer();
      this.phase = 'WaitingForPlayers';
      this.game = null;
    }
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  async _persist() {
    const state = {
      seats: this.seats.filter(Boolean),
      game: this.game ? this.game.toJSON() : null,
    };
    await query(
      'UPDATE game_tables SET state=$1, phase=$2, updated_at=NOW() WHERE id=$3',
      [JSON.stringify(state), this.phase, this.id]
    ).catch(e => console.error('[gametable] persist error:', e.message));
    this._lastPersist = Date.now();
  }

  // Called by plugin tick every 10s
  async maybePersist() {
    if (Date.now() - this._lastPersist > 10_000) await this._persist();
  }

  // ── Static loader ──────────────────────────────────────────────────────────

  static async loadAll() {
    const { rows } = await query('SELECT * FROM game_tables');
    for (const row of rows) {
      if (!activeTables.has(row.id)) new GameTable(row);
    }
  }
}
