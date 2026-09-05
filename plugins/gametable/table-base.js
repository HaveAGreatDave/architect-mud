// TableBase — the game-agnostic half of a seated table.
//
// This file holds everything that is true of ANY table game in the world: who is
// sitting down, what it cost them to sit, who is watching, which NPC is running
// the table and how he gets here, the speech bubbles, the pane push, and the
// persistence. It knows nothing about cards, chips-per-street, boards or pieces.
//
// The rules-shaped half — dealing, turn advancement, what ends a round and who
// won — lives in the subclass. `GameTable` (poker) and `ChessTable` are the two
// implementations. A subclass MUST provide:
//
//   get paneType()      wire message type for its rendered pane
//   renderPaneFor(pid)  HTML string for one viewer
//   _checkAutoStart()   called whenever the seat count changes
//   _checkGameViable()  called after someone leaves
//
// and MAY override `inTextMode(pid)` (default: nobody is), `get sfxType()`
// (default: null, meaning the table makes no sound) and `static MAX_SEATS`.
//
// Extracted from game-table.js — the methods here are unchanged in behaviour;
// poker's own regress suite is the proof.

import { query } from '../../server/models/db.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { getLivePlayer, getZoneNpcs, world, updateNpc } from '../../server/engine/world.js';
import { moveEntity } from '../../server/engine/ai-behaviour.js';
import { findPath } from '../../server/engine/pathfinding.js';

const SEAT_RETAIN_MS = 60_000; // hold seat for a disconnected player before standing them up

// In-memory registry of all active table instances keyed by table DB id.
// Shared across game types — one room could hold a felt and a chessboard.
export const activeTables = new Map();

export class TableBase {
  static MAX_SEATS = 4;

  constructor(row) {
    this.id       = row.id;
    this.zoneId   = row.zone_id;
    this.name     = row.name;
    this.gameType = row.game_type || 'holdem';
    this.config   = typeof row.config === 'string' ? JSON.parse(row.config) : (row.config || {});
    this.phase    = row.phase || 'WaitingForPlayers';

    // Optional explicit dealer NPC id; otherwise resolved from the zone by flag.
    this.dealerNpcId = this.config.dealerNpcId || null;

    // seats: fixed array. null = empty. Each entry at minimum:
    // { playerId, handle, seatIdx } — subclasses add their own fields (chips, …)
    this.seats = Array(this.constructor.MAX_SEATS).fill(null);

    // spectators: Set of player IDs watching but not seated
    this.spectators = new Set();

    // Current game-rules instance (subclass owns its type)
    this.game = null;

    // Last action speech bubbles: { playerId → actionLabel }
    this.bubbles = {};

    // Player chat bubbles from `say`: { playerId → text }
    this.chatBubbles = {};

    // Current dealer speech-bubble line (raw text), or null
    this.dealerBubble = null;

    this._sayTimers = {};
    this._dealerBubbleTimer = null;

    // Seat retention timers: { playerId → timeoutHandle }
    this._retainTimers = {};

    // Turn timer handles: { warnHandle, foldHandle, playerId }
    this._turnTimer = null;

    // Pending bot-move timer (set when the action reaches a bot seat)
    this._botMoveTimer = null;

    // The table's assigned dealer, rushing in after a `call dealer` — { npc, path, step } | null
    this._incomingDealer = null;

    // AI opponents walking in toward the table: [{ npc, path, step }]
    this._incomingBots = [];

    // Last time state was persisted to DB
    this._lastPersist = 0;

    // Restore seats from DB (the subclass constructor restores this.game).
    const state = typeof row.state === 'string' ? JSON.parse(row.state) : (row.state || {});
    if (state.seats) {
      for (const s of state.seats) {
        if (s && s.seatIdx >= 0 && s.seatIdx < this.constructor.MAX_SEATS) {
          this.seats[s.seatIdx] = s;
        }
      }
    }

    activeTables.set(this.id, this);
  }

  // ── Subclass contract ──────────────────────────────────────────────────────

  get paneType() { throw new Error('paneType not implemented'); }
  get sfxType()  { return null; }
  renderPaneFor(_playerId) { throw new Error('renderPaneFor not implemented'); }
  inTextMode(_playerId) { return false; }
  _checkAutoStart() {}
  _checkGameViable() {}

  // ── Seating ────────────────────────────────────────────────────────────────

  // Returns { ok, error, seatIdx }. A buy-in of 0 is a free table: no credits move.
  async joinTable(player, preferredSeat = null) {
    if (this.phase === 'Closed') return { ok: false, error: 'This table is closed.' };
    if (this.seatedIndex(player.id) >= 0) return { ok: false, error: "You're already seated." };
    if (this.openSeats() === 0) return { ok: false, error: 'No seats available.' };

    const buyIn = this.buyInFor(player);
    if (buyIn > 0) {
      if ((player.credits || 0) < buyIn) return { ok: false, error: `You need at least ₵ ${buyIn} to join.` };

      // Deduct credits
      const { rowCount } = await query(
        'UPDATE players SET credits = credits - $1 WHERE id = $2 AND credits >= $1',
        [buyIn, player.id]
      );
      if (!rowCount) return { ok: false, error: `You need at least ₵ ${buyIn} to join.` };
    }

    // Assign seat
    let seatIdx = preferredSeat !== null && this.seats[preferredSeat] === null ? preferredSeat : null;
    if (seatIdx === null) {
      seatIdx = this.seats.findIndex(s => s === null);
    }

    this.seats[seatIdx] = { playerId: player.id, handle: player.handle, chips: buyIn, buyIn, seatIdx };
    this.spectators.delete(player.id);

    if (buyIn > 0) {
      // Send credit update to client
      const { rows: pRows } = await query('SELECT credits FROM players WHERE id=$1', [player.id]);
      if (pRows.length) {
        sendToPlayer(player.id, { type: 'player_update', credits: pRows[0].credits });
      }
    }

    this._checkAutoStart();
    await this._persist();
    return { ok: true, seatIdx };
  }

  // What it costs this player to sit. Poker uses the configured buy-in; a free
  // table (chess with no wager) returns 0 and the credits path is skipped whole.
  buyInFor(_player) {
    return this.config.buyIn || this.config.minBuyIn || 100;
  }

  addSpectator(playerId) {
    if (this.seatedIndex(playerId) < 0) this.spectators.add(playerId);
  }

  removeSpectator(playerId) {
    this.spectators.delete(playerId);
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

  _clearTurnTimer() {
    clearTimeout(this._botMoveTimer);
    this._botMoveTimer = null;
    if (!this._turnTimer) return;
    clearTimeout(this._turnTimer.warnHandle);
    clearTimeout(this._turnTimer.foldHandle);
    this._turnTimer = null;
  }

  // ── Broadcasting ───────────────────────────────────────────────────────────

  pushPaneAll() {
    const recipients = [
      ...this.seats.filter(s => s && !s.isBot).map(s => s.playerId),
      ...this.spectators,
    ];
    for (const pid of recipients) {
      // Purely per-player. A player in text view plays in the log — their top
      // pane is the room look, not the table — so don't blast the table pane
      // back over it on every action/quip.
      if (this.inTextMode(pid)) continue;
      sendToPlayer(pid, { type: this.paneType, html: this.renderPaneFor(pid) });
    }
    this.afterPush();
  }

  // Hook for clearing one-render animation flags after a push.
  afterPush() {}

  // Push a sound-effect cue. Without playerId it goes to everyone watching the
  // table (seated + spectators); with one it's private (e.g. going broke).
  //
  // Several cues legitimately resolve on the same tick — shuffle + deal at hand
  // start, a hand-ending fold immediately followed by the win fanfare — and fired
  // together they smear into one "doubled" sound. Space cues at least MIN_SFX_GAP_MS
  // apart so each lands cleanly; cues already spread out pass straight through.
  _pushSfx(cue, playerId = null) {
    if (!this.sfxType) return;
    const MIN_SFX_GAP_MS = 260;
    const now = Date.now();
    const wait = Math.max(0, (this._lastSfxAt || 0) + MIN_SFX_GAP_MS - now);
    this._lastSfxAt = now + wait;
    if (wait > 0) { setTimeout(() => this._emitSfx(cue, playerId), wait); return; }
    this._emitSfx(cue, playerId);
  }

  _emitSfx(cue, playerId = null) {
    if (!this.sfxType) return;
    if (playerId) { if (!this.isSyntheticSeat(playerId)) sendToPlayer(playerId, { type: this.sfxType, cue }); return; }
    const recipients = [
      ...this.seats.filter(s => s && !s.isBot).map(s => s.playerId),
      ...this.spectators,
    ];
    for (const pid of recipients) sendToPlayer(pid, { type: this.sfxType, cue });
  }

  // Is this "player id" actually a server-driven bot seat rather than a socket?
  isSyntheticSeat(playerId) {
    return this.seats.some(s => s && s.isBot && s.playerId === playerId);
  }

  // ── Dealer / host NPC ──────────────────────────────────────────────────────

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

  // Is a dealer physically present at the table right now?
  hasDealer() {
    return !!this._dealerNpc();
  }

  // Rush the table's assigned dealer to the felt if he's elsewhere and free.
  // Only the NPC already tagged as this table's dealer may be summoned this
  // way — the caller resolves which NPC that is.
  // Returns { ok, error, walking?, arrived? }.
  async summonDealer(npc) {
    if (this.phase === 'Closed') return { ok: false, error: 'This table is closed.' };
    if (this._dealerNpc()?.id === npc.id) return { ok: false, error: `${npc.name} is already at the table.` };
    if (this._incomingDealer?.npc.id === npc.id) return { ok: false, error: `${npc.name} is already on his way.` };
    if (npc.hp != null && npc.hp <= 0) return { ok: false, error: `${npc.name} is in no condition to deal.` };
    if (npc._ai?.waitUntil && Date.now() < npc._ai.waitUntil) {
      return { ok: false, error: `${npc.name} is tied up right now — try again shortly.` };
    }

    if (npc.zone_id === this.zoneId) {
      this._checkAutoStart();
      this.pushPaneAll();
      return { ok: true, arrived: true };
    }

    const path = findPath(npc.zone_id, this.zoneId, { maxDistance: 60 });
    if (!path || path.length < 2) return { ok: false, error: `${npc.name} can't get here from where he is.` };
    this._incomingDealer = { npc, path, step: 1 };
    return { ok: true, walking: true };
  }

  // Advance the incoming dealer two zones per tick — he's rushing, not
  // strolling. Called from the plugin tick.
  stepIncomingDealer() {
    const w = this._incomingDealer;
    if (!w) return;
    for (let hop = 0; hop < 2; hop++) {
      const next = w.path[w.step];
      if (!next) break;
      if (!moveEntity(w.npc, next, sendToZone, query)) { this._incomingDealer = null; return; }
      w.step++;
      if (w.npc.zone_id === this.zoneId) break;
    }
    if (w.npc.zone_id === this.zoneId) {
      this._incomingDealer = null;
      this._checkAutoStart();
      this._dealerSay("Sorry, folks. Let's get back to it.");
      this.pushPaneAll();
    }
  }

  // ── AI opponents ───────────────────────────────────────────────────────────
  //
  // Summoning an opponent is the same act in both games — you call somebody over,
  // and if they aren't in the room they walk here — so it lives here rather than
  // being written twice. What DIFFERS is money, and that is the whole reason for
  // the seams below: a gambler needs a bankroll and a bust cooldown before he'll
  // cross the city, and a chess player needs neither. A table that overrides
  // nothing simply has no AI opponents.

  // The synthetic seat id this table gives an NPC. Must agree with
  // isSyntheticSeat(). Null means this game has no AI opponents.
  botIdFor(_npc) { return null; }

  // Seat the NPC. Subclasses own the seat row, because they own its fields.
  async seatBot(_npc, _preferredSeat = null) {
    return { ok: false, error: 'Nobody plays this game for you.' };
  }

  // Everything the game wants settled BEFORE an opponent sets off walking —
  // cooldowns, stake, a backer's restake. Runs once, at summon time, so a bot
  // never crosses the map only to be turned away at the seat.
  async _botPreflight(_npc) { return { ok: true }; }

  // What the table says when an opponent arrives on foot.
  _botArrivedLine(npc) { return `${npc.name} takes a seat.`; }

  // Bring an NPC to the table. If they're already in the room they sit at once;
  // otherwise they walk in over the next several ticks (see stepIncomingBots).
  // Returns { ok, error, walking?, seatIdx? }.
  async summonBot(npc) {
    const id = this.botIdFor(npc);
    if (!id) return { ok: false, error: 'Nobody plays this game for you.' };
    if (this.phase === 'Closed') return { ok: false, error: 'This table is closed.' };
    if (this.openSeats() === 0) return { ok: false, error: 'No seats available.' };
    if (this.seatedIndex(id) >= 0) return { ok: false, error: `${npc.name} is already at the table.` };
    if (this._incomingBots.some(w => w.npc.id === npc.id)) return { ok: false, error: `${npc.name} is already on the way.` };

    const pre = await this._botPreflight(npc);
    if (!pre.ok) return pre;

    if (npc.zone_id === this.zoneId) return this.seatBot(npc);

    const path = findPath(npc.zone_id, this.zoneId, { maxDistance: 60 });
    if (!path || path.length < 2) return { ok: false, error: `${npc.name} can't get here from where they are.` };
    if (npc._ai) npc._ai.waitUntil = Date.now() + 3_600_000; // freeze their AI while we drive them
    this._incomingBots.push({ npc, path, step: 1 });          // step 0 is their current zone
    return { ok: true, walking: true };
  }

  // Advance each incoming opponent one zone toward the table; seat on arrival.
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
            if (r.ok) this._dealerSay(this._botArrivedLine(w.npc));
            else if (w.npc._ai) w.npc._ai.waitUntil = null; // couldn't seat — let them resume their life
          })
          .catch(e => console.error('[gametable] seat incoming bot:', e.message));
      } else {
        still.push(w);
      }
    }
    this._incomingBots = still;
  }

  // Hand an NPC back its own life after it leaves a seat. Safe to call twice.
  _thawBot(npcId) {
    if (!npcId) return;
    const npc = getZoneNpcs(this.zoneId).find(n => n.id === npcId);
    if (npc?._ai) npc._ai.waitUntil = null;
  }

  _dealerSay(text) {
    if (!text) return;
    // No living dealer NPC at the table — no one to speak. The table falls
    // silent: no speech bubble, no chat line. (A dead dealer stops narrating.)
    const npc = this._dealerNpc();
    if (!npc) return;
    // Drive the dealer's on-table speech bubble. It clears itself after a lull
    // so it doesn't hang stale between rounds. (No push here — the callers that
    // emit dealer lines already pushPaneAll immediately afterwards.)
    this.dealerBubble = text;
    clearTimeout(this._dealerBubbleTimer);
    this._dealerBubbleTimer = setTimeout(() => {
      this.dealerBubble = null;
      this.pushPaneAll();
    }, 7000);
    // Echo to the room chat log as the dealer NPC's own speech, matching the
    // engine's standard NPC say format so it reads identically to `Orion Dex
    // says, "..."`. Import sendToZone lazily to avoid circular dep at load.
    import('../../server/engine/messaging.js').then(({ sendToZone }) => {
      sendToZone(this.zoneId, { type: 'output', message: `<span class="speech-line">${npc.name} says, "${text}"</span>` });
    });
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

  // Name of any seated human, for a bot to needle. Falls back to 'friend'.
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
    sendToZone(this.zoneId, { type: 'output', message: `<span class="speech-line">${seat.handle} says, "${text}"</span>` });
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

  // ── Persistence ────────────────────────────────────────────────────────────

  // Merge a patch into an AI opponent's NPC flags — a bankroll, a cooldown —
  // writing the in-memory world copy as well as the row, so a re-seat later in
  // the same session sees the new number. Both money games keep their money on
  // the NPC this way; the flag KEYS are the subclass's business, not this one's.
  async _saveBotFlags(npcOrId, patch) {
    const npcId = typeof npcOrId === 'string' ? npcOrId : npcOrId?.id;
    if (!npcId) return;
    const npc = world.npcs.get(npcId) || (typeof npcOrId === 'object' ? npcOrId : null);
    const flags = { ...(npc?.flags || {}), ...patch };
    if (npc) npc.flags = flags;
    await updateNpc(npcId, { flags })
      .catch(e => console.error('[gametable] bot flag persist:', e.message));
  }

  // Dev-panel config edit (blinds, buy-in, …) — merges into the live config so
  // it takes effect on the next round, and persists so it survives a restart.
  async setConfig(patch) {
    Object.assign(this.config, patch);
    await query('UPDATE game_tables SET config=$1 WHERE id=$2', [JSON.stringify(this.config), this.id])
      .catch(e => console.error('[gametable] config persist error:', e.message));
  }

  async _persist() {
    const state = {
      seats: this.seats.filter(s => s && !s.isBot), // bots are transient (see subclass constructor)
      game: this.game ? this.game.toJSON() : null,
    };
    const json = JSON.stringify(state);

    // Skip the write when nothing actually changed. maybePersist() fires every
    // 10 s per table for as long as the server is up, and an empty table's state
    // is byte-identical forever — that was ~18 pointless UPDATEs a minute on a
    // world where nobody was playing cards, each one keeping Neon's compute from
    // suspending. The row already holds exactly what we were about to write, so
    // not writing it changes nothing on restart.
    if (json === this._persistedJson && this.phase === this._persistedPhase) {
      this._lastPersist = Date.now();
      return;
    }

    await query(
      'UPDATE game_tables SET state=$1, phase=$2, updated_at=NOW() WHERE id=$3',
      [json, this.phase, this.id]
    ).catch(e => console.error('[gametable] persist error:', e.message));
    this._persistedJson = json;
    this._persistedPhase = this.phase;
    this._lastPersist = Date.now();
  }

  // Called by plugin tick every 10s
  async maybePersist() {
    if (Date.now() - this._lastPersist > 10_000) await this._persist();
  }
}
