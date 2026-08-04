// GameTable — the poker felt: hand lifecycle, betting, chips, gambler bots.
//
// The seat/spectator/dealer-NPC/pane/persistence half lives in TableBase, which
// chess shares. Everything below here is Texas Hold'em and nothing else.

import { query } from '../../server/models/db.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { emit } from '../../server/engine/events.js';
import { getZonePlayers, getZoneNpcs } from '../../server/engine/world.js';
import { TableBase, activeTables } from './table-base.js';
import { HoldemGame } from './games/holdem.js';
import { renderPane } from './render-pane.js';
import { botId, isBotId, decideBotAction, botChatter, botOutcomeLine } from './bot-player.js';
import { narrateDeal, narrateStreet, narrateShowdown, narrateTurn, isTextMode } from './text-mode.js';

export const MAX_SEATS = 4;
const AUTO_START_DELAY_MS = 15_000; // wait this long after 2nd player joins before starting

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

// Old-school flavor for a text table (config.textTable): the dealer calls every
// card aloud "the old way," which doubles as the accessibility narration hook.
// Blended into _quip at ~50% when the table is flagged, so she stays in voice
// without drowning out the standard house lines.
const OLD_SCHOOL_LINES = {
  newHand: [
    "We do this the old way here, hon — cards called, not clicked. Ante up.",
    "No screens at my table. Cards in the air, and I read 'em as I call 'em.",
    "Old-school rules: I deal by hand, I call it aloud, you keep up. Shuffle up.",
  ],
  flop: [
    "Flop's out — I'll call it for the room. Old habits die hard.",
    "I read every card at this table, the way it was done before the machines.",
  ],
  turn: [
    "Turn card, called aloud like they did before the neon.",
    "Fourth street. I'll say it plain so everyone at the felt hears it.",
  ],
  river: [
    "River. Last one, and I'll call it clear.",
    "No screen to squint at here — just my voice and the felt.",
  ],
  showdown: [
    "Turn 'em up. I'll call the winner the old-fashioned way.",
    "Showdown, hon. I read the hands out loud — always have.",
  ],
  idle: [
    "This table's older than the neon out front, and so am I.",
    "Back when I started, we called every card aloud. Still do, right here.",
    "No blinking lights at my felt. Just cards, chips, and a voice that carries.",
  ],
};

export { activeTables };

export class GameTable extends TableBase {
  static MAX_SEATS = MAX_SEATS;

  constructor(row) {
    super(row);

    // playerIds who won the most recent completed hand (drives winner glow)
    this.lastWinners = [];

    // One-render animation flags (consumed by pushPaneAll, like game.dealPhase)
    this._betAnimPlayer = null;  // playerId whose bet pile should toss in
    this._sweepAnim = false;     // pot pile plays the sweep-in animation

    // Deck riffle loop — runs for the whole "SHUFFLING UP…" countdown (not a
    // one-render flag like the others above), started in _checkAutoStart and
    // stopped the instant startHand actually deals.
    this._shuffleAnim = false;
    this._shuffleSfxTimer = null;

    // Auto-start timer handle
    this._autoStartTimer = null;

    // Pending board run-out timer (set when everyone remaining is all-in)
    this._runoutTimer = null;

    // Restore the hand from DB if one was in progress (TableBase restored seats).
    const state = typeof row.state === 'string' ? JSON.parse(row.state) : (row.state || {});
    if (state.game && this.phase === 'InProgress') {
      const restored = HoldemGame.fromJSON(state.game, this.config);
      // Bots aren't persisted (they're transient, like AI blackboards). A hand
      // that still references one after a restart can't be resumed — abandon it
      // and drop back to waiting rather than stalling on a driverless bot seat.
      if (restored.seats.some(s => isBotId(s.playerId))) this.phase = 'WaitingForPlayers';
      else this.game = restored;
    }

  }

  // ── Presentation seams (TableBase contract) ────────────────────────────────

  get paneType() { return 'poker_update'; }
  get sfxType()  { return 'poker_sfx'; }
  renderPaneFor(playerId) { return renderPane(this, playerId); }
  inTextMode(playerId) { return isTextMode(playerId); }
  isSyntheticSeat(playerId) { return isBotId(playerId); }

  afterPush() {
    // Clear one-render animation flags after first push (_shuffleAnim is NOT
    // one-shot — it spans the whole countdown, see _startShuffleLoop/_stopShuffleLoop)
    if (this.game) this.game.dealPhase = false;
    this._betAnimPlayer = null;
    this._sweepAnim = false;
  }

  // ── Seating ────────────────────────────────────────────────────────────────

  botIdFor(npc) { return botId(npc.id); }

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

  // A gambler won't cross the city broke, and won't cross it at all straight
  // after being cleaned out. (The walking itself is TableBase.summonBot.)
  async _botPreflight(npc) {
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
    return { ok: true };
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
      const net = chips - (seat.buyIn || 0);
      const msg = net > 0 ? `You leave the table up ₵ ${net.toLocaleString()}.`
                : net < 0 ? `You leave the table down ₵ ${(-net).toLocaleString()}.`
                :           'You leave the table even.';
      sendToPlayer(playerId, { type: 'output', message: msg });
      // A big win is worth gossiping about (net of the buy-in).
      if (net >= 1000) {
        const { rows: pr } = await query('SELECT handle FROM players WHERE id=$1', [playerId]);
        if (pr.length) emit('gossip.pokerWin', { player: { id: playerId, handle: pr[0].handle }, amount: net, zoneId: this.zoneId });
      }
    }

    // A human leaving may strand a bot alone — bots don't play each other.
    if (!wasBot) this._removeLonelyBots();

    this._checkGameViable();
    this.pushPaneAll();
    await this._persist();
    return { ok: true };
  }

  // ── Game flow ──────────────────────────────────────────────────────────────

  startHand() {
    if (this.phase === 'InProgress') return;
    if (!this._dealerNpc()) { this._stopShuffleLoop(); this.phase = 'WaitingForDealer'; this.pushPaneAll(); return; }
    const active = this.seats
      .filter(Boolean)
      .map(s => ({ seatIdx: s.seatIdx, playerId: s.playerId, handle: s.handle, chips: s.chips }));
    if (active.length < 2) { this._stopShuffleLoop(); return; }

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

    this._stopShuffleLoop(); // shuffle's been running through the countdown — cut it the instant we deal
    this._pushSfx('deal');
    this.pushPaneAll();
    narrateDeal(this); // text-mode players get their hole cards in the log
    this._promptOrRunout();
    this._lastPersist = 0; // force persist on next tick
  }

  processAction(playerId, action, amount = 0) {
    if (!this.game || this.phase !== 'InProgress') return { ok: false, error: 'No active hand.' };
    const result = this.game.handleAction(playerId, action, amount);
    if (!result.ok) return result;

    // A genuine manual action clears the seat's inactivity strikes (the auto-fold
    // path sets _turnExpired first, so its own processAction call doesn't reset).
    if (!this._turnExpired) {
      const st = this.seats.find(s => s && s.playerId === playerId);
      if (st) st.autoFolds = 0;
    }

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
      narrateStreet(this, pr.phase); // text-mode players get the new board in the log
      this._promptOrRunout();
    } else if (pr.phase === 'showdown') {
      this._dealerSay(this._quip('showdown'));
      narrateShowdown(this); // final board to the log before the dealer calls winners
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
      }, (this.config.autoStartDelaySecs || 5) * 1000);
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
    }, 900);
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
    this._turnExpired = false; // distinguishes a manual action from the auto path

    // Private prompt so the acting player notices the action has reached them.
    this._pushSfx('turn', pid);
    narrateTurn(this, pid); // text-mode players get a compact "your turn" line

    const warnHandle = setTimeout(() => {
      sendToPlayer(pid, { type: 'output', message: '⚠ 10 seconds to act.' });
    }, (timerSecs - 10) * 1000);

    const foldHandle = setTimeout(() => {
      this._turnExpired = true;
      const action = this.game?.canCheck(pid) ? 'check' : 'fold';
      this.processAction(pid, action, 0);
      sendToPlayer(pid, { type: 'output', message: `Time expired — you were auto-${action}ed.` });
      this._registerAutoFold(pid);
    }, timerSecs * 1000);

    this._turnTimer = { warnHandle, foldHandle, playerId: pid };
  }

  // Count consecutive inactivity time-outs per seat: warn on the 2nd, remove on
  // the 3rd. A manual action (see processAction) resets the count to zero.
  _registerAutoFold(pid) {
    const seat = this.seats.find(s => s && s.playerId === pid);
    if (!seat || seat.isBot) return;
    seat.autoFolds = (seat.autoFolds || 0) + 1;
    if (seat.autoFolds >= 3) {
      sendToPlayer(pid, { type: 'output', message: 'Removed from the table — three auto-folds in a row. Sit back down when you\'re ready to play.' });
      this.leaveTable(pid);
    } else if (seat.autoFolds === 2) {
      sendToPlayer(pid, { type: 'output', message: '⚠ Auto-folded twice in a row. Act on your next turn or you\'ll be removed from the table.' });
    }
  }

  // Drive a bot seat's action after a short "thinking" pause, so it reads like a
  // deliberating opponent rather than an instant reflex.
  _scheduleBotMove(seat) {
    clearTimeout(this._botMoveTimer);
    const delay = 500 + Math.floor(Math.random() * 900);
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

  _quip(kind) {
    // On an old-school text table, half the time the dealer calls it "the old
    // way" instead of the standard house line.
    if (this.config.textTable && OLD_SCHOOL_LINES[kind] && Math.random() < 0.5) {
      const os = OLD_SCHOOL_LINES[kind];
      return os[Math.floor(Math.random() * os.length)];
    }
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

  // ── Helpers ────────────────────────────────────────────────────────────────

  _nextDealerSeatIdx() {
    // Rotate dealer each hand. Find first filled seat after current dealer.
    const current = this.game?.getDealerSeat()?.seatIdx ?? -1;
    for (let i = 1; i <= MAX_SEATS; i++) {
      const idx = (current + i) % MAX_SEATS;
      if (this.seats[idx]) return idx;
    }
    return 0;
  }

  // Kick off the deck riffle loop for the "SHUFFLING UP…" countdown — repeats
  // the shuffle sfx cue roughly on the animation's own beat until stopped.
  _startShuffleLoop() {
    this._shuffleAnim = true;
    clearInterval(this._shuffleSfxTimer);
    this._pushSfx('shuffle');
    this._shuffleSfxTimer = setInterval(() => this._pushSfx('shuffle'), 1800);
  }

  // Cut the shuffle loop — called the instant a hand actually deals, or if the
  // countdown is interrupted (a seat opens up, the dealer steps away, …).
  _stopShuffleLoop() {
    this._shuffleAnim = false;
    clearInterval(this._shuffleSfxTimer);
    this._shuffleSfxTimer = null;
  }

  _checkAutoStart() {
    clearTimeout(this._autoStartTimer);
    if (this.phase === 'InProgress') return;
    const n = this.seatedCount();
    if (n < 2) { this._stopShuffleLoop(); this.phase = 'WaitingForPlayers'; this.pushPaneAll(); return; }
    if (!this._dealerNpc()) {
      const wasWaiting = this.phase === 'WaitingForDealer';
      this._stopShuffleLoop();
      this.phase = 'WaitingForDealer';
      this.pushPaneAll();
      if (!wasWaiting) {
        for (const s of this.seats) {
          if (s && !s.isBot) sendToPlayer(s.playerId, { type: 'output', message: 'There\'s no dealer to run this table. Try `call dealer`.' });
        }
      }
      return;
    }
    this.phase = 'Ready';
    const delay = (this.config.autoStartDelaySecs || 5) * 1000;
    this._startShuffleLoop();
    this.pushPaneAll();
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
    await this._saveBotFlags(npcOrId, { poker_bankroll: Math.max(0, Math.floor(bankroll)) });
  }

  // The other half of a bust: the recovery cooldown, on the same flag path.
  async _saveBotCooldown(npcOrId, until) {
    await this._saveBotFlags(npcOrId, { poker_cooldown_until: until });
  }

  // Bots don't play each other — if no humans are left seated, any bots cash out.
  _removeLonelyBots() {
    if (this.seats.some(s => s && !s.isBot)) return;
    for (const s of this.seats.filter(s => s && s.isBot)) this.leaveTable(s.playerId);
  }

}
