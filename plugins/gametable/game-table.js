// GameTable — seat management, lifecycle, broadcasting.
// Contains no game rules; delegates to the attached game plugin (holdem.js).

import { query } from '../../server/models/db.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { getLivePlayer, getZonePlayers, getZoneNpcs } from '../../server/engine/world.js';
import { moveEntity } from '../../server/engine/ai-behaviour.js';
import { findPath } from '../../server/engine/pathfinding.js';
import { HoldemGame } from './games/holdem.js';
import { renderPane } from './render-pane.js';
import { botId, isBotId, decideBotAction, botChatter, botOutcomeLine } from './bot-player.js';

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

    // Optional explicit dealer NPC id; otherwise resolved from the zone by flag.
    this.dealerNpcId  = this.config.dealerNpcId || null;

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

    // Pending bot-move timer (set when the action reaches a bot seat)
    this._botMoveTimer = null;

    // Gambler NPCs walking in toward the table: [{ npc, path, step }]
    this._incomingBots = [];

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
      const restored = HoldemGame.fromJSON(state.game, this.config);
      // Bots aren't persisted (they're transient, like AI blackboards). A hand
      // that still references one after a restart can't be resumed — abandon it
      // and drop back to waiting rather than stalling on a driverless bot seat.
      if (restored.seats.some(s => isBotId(s.playerId))) this.phase = 'WaitingForPlayers';
      else this.game = restored;
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

  // Seat a bot (gambler NPC) at the table. Draws the buy-in from the NPC's
  // persistent bankroll (flags.poker_bankroll) instead of a player's credits.
  // Returns { ok, error, seatIdx }.
  async seatBot(npc, preferredSeat = null) {
    if (this.phase === 'Closed') return { ok: false, error: 'This table is closed.' };
    const id = botId(npc.id);
    if (this.seatedIndex(id) >= 0) return { ok: false, error: `${npc.name} is already seated.` };
    if (this.openSeats() === 0) return { ok: false, error: 'No seats available.' };

    const persona = npc.flags?.poker_persona || {};
    const buyIn = persona.buyIn || this.config.buyIn || this.config.minBuyIn || 100;
    const bankroll = npc.flags?.poker_bankroll ?? persona.bankroll ?? 0;
    if (bankroll < buyIn) return { ok: false, error: `${npc.name} is tapped out.` };

    let seatIdx = preferredSeat !== null && this.seats[preferredSeat] === null ? preferredSeat : null;
    if (seatIdx === null) seatIdx = this.seats.findIndex(s => s === null);

    this.seats[seatIdx] = { playerId: id, npcId: npc.id, handle: npc.name, chips: buyIn, seatIdx, isBot: true, persona };
    if (npc._ai) npc._ai.waitUntil = Date.now() + 3_600_000; // freeze his AI so he stays seated
    await this._saveBotBankroll(npc, bankroll - buyIn);

    this._checkAutoStart();
    await this._persist();
    return { ok: true, seatIdx };
  }

  // Bring a gambler NPC to the table. If he's already in the room he sits at once;
  // otherwise he walks in over the next several ticks (see stepIncomingBots).
  // Returns { ok, error, walking?, seatIdx? }.
  async summonBot(npc) {
    if (this.phase === 'Closed') return { ok: false, error: 'This table is closed.' };
    if (this.openSeats() === 0) return { ok: false, error: 'No seats available.' };
    if (this.seatedIndex(botId(npc.id)) >= 0) return { ok: false, error: `${npc.name} is already at the table.` };
    if (this._incomingBots.some(w => w.npc.id === npc.id)) return { ok: false, error: `${npc.name} is already on his way.` };

    const persona = npc.flags?.poker_persona || {};
    const buyIn = persona.buyIn || this.config.buyIn || this.config.minBuyIn || 100;
    if (npc.flags?.poker_cooldown_until && Date.now() < npc.flags.poker_cooldown_until) {
      return { ok: false, error: `${npc.name} just got cleaned out — he's licking his wounds. Try again later.` };
    }
    // Broke but off cooldown → a backer restakes him to a fresh bankroll.
    let bankroll = npc.flags?.poker_bankroll ?? persona.bankroll ?? 0;
    if (bankroll < buyIn) {
      bankroll = Math.max(persona.bankroll || 0, buyIn * 10);
      await this._saveBotBankroll(npc, bankroll);
    }

    if (npc.zone_id === this.zoneId) return this.seatBot(npc);

    const path = findPath(npc.zone_id, this.zoneId, { maxDistance: 60 });
    if (!path || path.length < 2) return { ok: false, error: `${npc.name} can't get here from where he is.` };
    if (npc._ai) npc._ai.waitUntil = Date.now() + 3_600_000; // freeze his AI while we drive him
    this._incomingBots.push({ npc, path, step: 1 });          // step 0 is his current zone
    return { ok: true, walking: true };
  }

  // Advance each incoming gambler one zone toward the table; seat on arrival.
  // Called from the plugin tick.
  stepIncomingBots() {
    if (!this._incomingBots.length) return;
    const still = [];
    for (const w of this._incomingBots) {
      const next = w.path[w.step];
      const moved = next && moveEntity(w.npc, next, sendToZone, query);
      if (!moved) { if (w.npc._ai) w.npc._ai.waitUntil = null; continue; } // arrived-off-path or blocked
      w.step++;
      if (w.npc.zone_id === this.zoneId) {
        this.seatBot(w.npc)
          .then(r => {
            if (r.ok) this._dealerSay(`${w.npc.name} takes a seat.`);
            else if (w.npc._ai) w.npc._ai.waitUntil = null; // couldn't seat — let him resume his life
          })
          .catch(e => console.error('[gametable] seat incoming bot:', e.message));
      } else {
        still.push(w);
      }
    }
    this._incomingBots = still;
  }

  // A bot lost its last chip: park it on a recovery cooldown and stand it up.
  async _bustBot(seat) {
    const npc = getZoneNpcs(this.zoneId).find(n => n.id === seat.npcId);
    const until = Date.now() + (this.config.botBustCooldownMs || 10 * 60 * 1000);
    if (npc) { npc.flags = npc.flags || {}; npc.flags.poker_cooldown_until = until; }
    await this._saveBotCooldown(seat.npcId, until);
    const line = botOutcomeLine(seat, 'busted', this._anyHumanName());
    if (line) this.botSay(seat, line);
    await this.leaveTable(seat.playerId); // returns 0, thaws his AI → he wanders off
  }

  async leaveTable(playerId) {
    const idx = this.seatedIndex(playerId);
    if (idx < 0) {
      this.spectators.delete(playerId);
      return { ok: true };
    }

    const seat = this.seats[idx];
    const chips = seat.chips;
    const wasBot = !!seat.isBot;

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

    // Return chips: bots to their bankroll, players to their credits.
    if (wasBot) {
      const npc = getZoneNpcs(this.zoneId).find(n => n.id === seat.npcId);
      if (chips > 0) {
        const bankroll = (npc?.flags?.poker_bankroll ?? 0) + chips;
        await this._saveBotBankroll(npc || seat.npcId, bankroll);
      }
      if (npc?._ai) npc._ai.waitUntil = null; // resume his world life — he wanders off
    } else if (chips > 0) {
      await query('UPDATE players SET credits = credits + $1 WHERE id = $2', [chips, playerId]);
      const { rows } = await query('SELECT credits FROM players WHERE id=$1', [playerId]);
      if (rows.length) sendToPlayer(playerId, { type: 'player_update', credits: rows[0].credits });
      sendToPlayer(playerId, { type: 'output', message: `You cash out ₵ ${chips} from the table.` });
    }

    // A human leaving may strand a bot alone — bots don't play each other.
    if (!wasBot) this._removeLonelyBots();

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

    // Tilt cools off over a few hands (Phase 3).
    for (const s of this.seats) if (s?.isBot && s.tilt) s.tilt = Math.max(0, s.tilt - 0.34);

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

    this._pushSfx('shuffle');
    this._pushSfx('deal');
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

    // Action sound cue: call = chips in; bet/raise = bigger chips in; all-in gets
    // its own dramatic shove; check = knock; fold = the sad sigh.
    const sfxMap = { fold: 'fold', check: 'check', call: 'call', bet: 'raise', raise: 'raise', allin: 'allin' };
    if (sfxMap[action]) this._pushSfx(sfxMap[action]);

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
      this._pushSfx('deal');  // community cards hit the felt
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
      this._pushSfx('win'); // triumphant fanfare for the completed round
      this.pushPaneAll();
      // Apply chip totals from game back to seat objects
      for (const gs of this.game.seats) {
        const seat = this.seats.find(s => s && s.playerId === gs.playerId);
        if (seat) seat.chips = gs.chips;
      }
      // Bot reactions (Phases 3–4): needle on a win, tilt + bad-beat on a loss.
      for (const seat of this.seats) {
        if (!seat?.isBot) continue;
        const gs = this.game.seats.find(g => g.playerId === seat.playerId);
        if (!gs || gs.folded) continue; // only bots who reached showdown react
        const name = this._anyHumanName();
        if (this.lastWinners.includes(seat.playerId)) {
          const l = botOutcomeLine(seat, 'won', name);
          if (l) this.botSay(seat, l);
        } else {
          const strong = gs.bestHand && gs.bestHand.rank >= 2; // lost with two pair+ = a beat
          seat.tilt = Math.min(1, (seat.tilt || 0) + (strong ? 0.7 : 0.2));
          const l = botOutcomeLine(seat, strong ? 'badbeat' : 'lost', name);
          if (l) this.botSay(seat, l);
        }
      }
      // Remove broke players (and busted bots)
      for (let i = 0; i < this.seats.length; i++) {
        if (this.seats[i] && this.seats[i].chips === 0) {
          const s = this.seats[i];
          if (s.isBot) {
            this._bustBot(s); // sets a recovery cooldown, then stands up (returns 0)
          } else {
            this._pushSfx('broke', s.playerId); // private sad send-off
            sendToPlayer(s.playerId, { type: 'output', message: 'You have no chips left. You leave the table.' });
            this.leaveTable(s.playerId);
          }
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
    const actor = this.game?.getCurrentActor();
    if (!actor) return;

    // Bot seats are driven by the server, not a socket — schedule their move
    // instead of a fold timer, and skip the private "your turn" cue.
    const seat = this.seats.find(s => s && s.playerId === actor.playerId);
    if (seat?.isBot) { this._scheduleBotMove(seat); return; }

    const timerSecs = this.config.turnTimerSecs || 30;
    const pid = actor.playerId;

    // Private prompt so the acting player notices the action has reached them.
    this._pushSfx('turn', pid);

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
    clearTimeout(this._botMoveTimer);
    this._botMoveTimer = null;
    if (!this._turnTimer) return;
    clearTimeout(this._turnTimer.warnHandle);
    clearTimeout(this._turnTimer.foldHandle);
    this._turnTimer = null;
  }

  // Drive a bot seat's action after a short "thinking" pause, so it reads like a
  // deliberating opponent rather than an instant reflex.
  _scheduleBotMove(seat) {
    clearTimeout(this._botMoveTimer);
    const delay = 900 + Math.floor(Math.random() * 1600);
    this._botMoveTimer = setTimeout(() => {
      if (!this.game || this.phase !== 'InProgress') return;
      const actor = this.game.getCurrentActor();
      if (!actor || actor.playerId !== seat.playerId) return; // the spot moved on
      const { action, amount, tag } = decideBotAction(this, seat);
      const res = this.processAction(seat.playerId, action, amount || 0);
      // Belt-and-suspenders: an illegal sizing must never leave the table stalled
      // on a bot with no timer. Fall back to the always-legal check-or-fold.
      if (!res.ok) {
        const fallback = this.game.canCheck(seat.playerId) ? 'check' : 'fold';
        this.processAction(seat.playerId, fallback, 0);
        return;
      }
      // Table talk (Phase 4) — sometimes needle the table, with true & false tells.
      const line = botChatter(seat, tag, this._anyHumanName());
      if (line) this.botSay(seat, line);
    }, delay);
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
      ...this.seats.filter(s => s && !s.isBot).map(s => s.playerId),
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

  // Push a poker sound-effect cue. Without playerId it goes to everyone watching
  // the table (seated + spectators); with one it's private (e.g. going broke).
  // The client (poker-sfx.js) owns the actual synth def for each cue.
  _pushSfx(cue, playerId = null) {
    if (playerId) { if (!isBotId(playerId)) sendToPlayer(playerId, { type: 'poker_sfx', cue }); return; }
    const recipients = [
      ...this.seats.filter(s => s && !s.isBot).map(s => s.playerId),
      ...this.spectators,
    ];
    for (const pid of recipients) sendToPlayer(pid, { type: 'poker_sfx', cue });
  }

  // The live dealer NPC for this table: the one flagged with our table_id, an
  // explicitly configured id, or any dealer-type NPC in the room. null if none
  // is present (dead, despawned, or a table with no NPC). Dead NPCs are already
  // removed from the zone set on death, but the hp guard is belt-and-suspenders.
  _dealerNpc() {
    const alive = n => n && (n.hp == null || n.hp > 0);
    const npcs = getZoneNpcs(this.zoneId).filter(alive);
    if (this.dealerNpcId) return npcs.find(n => n.id === this.dealerNpcId) || null;
    return npcs.find(n => n.flags?.table_id === this.id)
        || npcs.find(n => n.npc_type === 'dealer')
        || null;
  }

  // The living dealer NPC's name, or null if none is present.
  dealerName() {
    const npc = this._dealerNpc();
    return npc ? npc.name : null;
  }

  _dealerSay(text) {
    if (!text) return;
    // No living dealer NPC at the table — no one to speak. The table falls
    // silent: no speech bubble, no chat line. (A dead dealer stops narrating.)
    const npc = this._dealerNpc();
    if (!npc) return;
    // Drive the dealer's on-table speech bubble. It clears itself after a lull
    // so it doesn't hang stale between hands. (No push here — the callers that
    // emit dealer lines already pushPaneAll immediately afterwards.)
    this.dealerBubble = text;
    clearTimeout(this._dealerBubbleTimer);
    this._dealerBubbleTimer = setTimeout(() => {
      this.dealerBubble = null;
      this.pushPaneAll();
    }, 7000);
    // Echo to the room chat log as the dealer NPC's own speech, matching the
    // engine's standard NPC say format so it reads identically to `Orion Dex
    // says: "..."`. Import sendToZone lazily to avoid circular dep at load.
    import('../../server/engine/messaging.js').then(({ sendToZone }) => {
      sendToZone(this.zoneId, { type: 'output', message: `<span style="color:var(--yellow)">${npc.name} says: "${text}"</span>` });
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

  // Name of any seated human, for the bot to needle. Falls back to 'friend'.
  _anyHumanName() {
    const h = this.seats.find(s => s && !s.isBot);
    return h ? h.handle : 'friend';
  }

  // A bot's speech: float a bubble over its seat AND echo to the room chat, like
  // the dealer's narration. (Mirrors playerSay + _dealerSay.)
  botSay(seat, text) {
    if (!text || !seat) return;
    this.chatBubbles[seat.playerId] = text;
    clearTimeout(this._sayTimers[seat.playerId]);
    this._sayTimers[seat.playerId] = setTimeout(() => {
      delete this.chatBubbles[seat.playerId];
      this.pushPaneAll();
    }, 7000);
    sendToZone(this.zoneId, { type: 'output', message: `<span style="color:var(--yellow)">${seat.handle} says: "${text}"</span>` });
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

  // Persist the bot's bankroll back to its NPC row (flags.poker_bankroll) and to
  // the in-memory world cache so a later re-seat sees the new balance.
  async _saveBotBankroll(npcOrId, bankroll) {
    const npcId = typeof npcOrId === 'string' ? npcOrId : npcOrId.id;
    const value = Math.max(0, Math.floor(bankroll));
    const npc = typeof npcOrId === 'object' ? npcOrId
      : getZoneNpcs(this.zoneId).find(n => n.id === npcId);
    if (npc) { npc.flags = npc.flags || {}; npc.flags.poker_bankroll = value; }
    await query(
      "UPDATE npcs SET flags = jsonb_set(coalesce(flags,'{}'::jsonb), '{poker_bankroll}', to_jsonb($1::bigint), true) WHERE id=$2",
      [value, npcId]
    ).catch(e => console.error('[gametable] bot bankroll persist:', e.message));
  }

  // Bots don't play each other — if no humans are left seated, any bots cash out.
  _removeLonelyBots() {
    if (this.seats.some(s => s && !s.isBot)) return;
    for (const s of this.seats.filter(s => s && s.isBot)) this.leaveTable(s.playerId);
  }

  async _persist() {
    const state = {
      seats: this.seats.filter(s => s && !s.isBot), // bots are transient (see constructor)
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
