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
import { getLivePlayer, getZoneNpcs, world, updateNpc, doorOnLink, getZone } from '../../server/engine/world.js';
import { emit } from '../../server/engine/events.js';

// ⚠ Keep the live player in step with the DB. Other code writes the balance
// back from memory (SET credits=$1 with player.credits), so a DB-only change
// here left memory stale and the next such write undid it: a buy-in refunded
// itself, winnings vanished.
export function syncLiveCredits(playerId, credits) {
  const live = getLivePlayer(playerId);
  if (live && Number.isFinite(Number(credits))) live.credits = Number(credits);
}
import { moveEntity } from '../../server/engine/ai-behaviour.js';
import { findPath } from '../../server/engine/pathfinding.js';
import { isGuest, guestRefusal } from '../../server/engine/guest.js';

// Somebody on their way to a table never lets themselves in. At a shut door they knock, KNOCK_TIMES times
// KNOCK_EVERY_MS apart, and if nobody's opened it a KNOCK_EVERY_MS after the last knock they go home.
export const KNOCK_EVERY_MS = 30_000, KNOCK_TIMES = 5;
// A dealer hired in for a private table comes over from wherever she was: this long until she's at the door.
const HIRED_COMING_MS = 15_000;

const OPPOSITE_DIR = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up', in: 'out', out: 'in',
  northeast: 'southwest', southwest: 'northeast', northwest: 'southeast', southeast: 'northwest' };
// Which way the door is from `zoneId`, one of its two sides, or null.
export function doorDirFrom(door, zoneId) {
  if (!door?.exit_dir) return null;
  return door.zone_id === zoneId ? door.exit_dir : door.target_zone === zoneId ? OPPOSITE_DIR[door.exit_dir] || null : null;
}

// The door a visitor has to knock at to step from `a` to `b` on their way to a table in `tableZone`, or null to
// walk on. It's shut and whole, and it leads into the table's room or the building it's in: the doors they leave
// their own place by, or pass in the street, aren't knocked at. Somebody who lives or works in that building has a
// key and walks in, as moveEntity lets them. `npc` may be null (a hired dealer, who has no home here).
export function knockDoorBetween(npc, a, b, tableZone) {
  const d = doorOnLink(a, null, b) || doorOnLink(b, null, a);
  if (!d || !(d.hp > 0) || d.is_open) return null;
  const mapOf = (z) => getZone(z)?.map_id || null, tableMap = mapOf(tableZone);
  const inside = (z) => z === tableZone || (!!tableMap && tableMap !== 'map_world' && mapOf(z) === tableMap);
  if (!inside(b)) return null;
  if (npc && [npc.home_zone, npc.work_zone_id].some((z) => z && inside(z))) return null;
  return d;
}
// The door into a room from outside it, and the zone on its far side. An en-suite's door doesn't count: its far
// side is a room whose parent is this one.
export function entryDoorOf(zoneId) {
  for (const d of world.doors.values()) {
    if (d.zone_id !== zoneId && d.target_zone !== zoneId) continue;
    const far = d.zone_id === zoneId ? d.target_zone : d.zone_id;
    if (!far || getZone(far)?.parent_zone === zoneId) continue;
    return { door: d, outside: far };
  }
  return null;
}

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
    // A table may ask for its own seat count (config.seats); a game class caps it at MAX_SEATS_LIMIT.
    const cap = this.constructor.MAX_SEATS_LIMIT || this.constructor.MAX_SEATS;
    const want = Number(this.config.seats) || this.constructor.MAX_SEATS;
    this.seats = Array(Math.max(2, Math.min(cap, want))).fill(null);

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
        if (s && s.seatIdx >= 0 && s.seatIdx < this.seats.length) {
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
      // Chips lost at a table are credits moved to another player.
      if (isGuest(player)) return { ok: false, error: guestRefusal('play for money').message };
      if ((player.credits || 0) < buyIn) return { ok: false, error: `You need at least ₵ ${buyIn} to join.` };

      // Deduct credits, and keep the live balance in step (see syncLiveCredits).
      const { rowCount, rows: paid } = await query(
        'UPDATE players SET credits = credits - $1 WHERE id = $2 AND credits >= $1 RETURNING credits',
        [buyIn, player.id]
      );
      if (!rowCount) return { ok: false, error: `You need at least ₵ ${buyIn} to join.` };
      player.credits = paid[0].credits;
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
    // a dealer hired in for a self-dealt table (`calldealer` there): RAM only, gone on a restart
    if (this.hiredDealer) return this.hiredDealer;
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
  // `config.selfDeal`: a private table with no dealer NPC; the players deal it themselves.
  // A table nobody's assigned to deal (no `dealerNpcId`, no NPC with `flags.table_id`) is dealt by its players too,
  // the button going round; an establishment's table, whose dealer is on the books, still waits for them.
  hasDealer() {
    return !!this.config.selfDeal || !!this._dealerNpc() || !this.hasOwnDealer();
  }

  // Whether the table has a dealer on its books, here or not (alive).
  hasOwnDealer() {
    const alive = (n) => n && (n.hp == null || n.hp > 0);
    if (this.dealerNpcId) return alive(world.npcs.get(this.dealerNpcId));
    for (const n of world.npcs.values()) if (alive(n) && n.flags?.table_id === this.id) return true;
    return false;
  }

  // Nobody dealing but the players: the button deals.
  selfDealt() { return !this._dealerNpc(); }

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
      return { ok: false, error: `${npc.name} is tied up right now: try again shortly.` };
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

  // A knock at a shut door on somebody's way in: the room inside hears it (plugins/audio plays it on both sides),
  // and the corridor sees them at the door (plugins/roomstage). `who` is { id, name } and may be a hired dealer
  // with no zone. `n` is which knock this is, 1 to KNOCK_TIMES.
  _knock(who, door, outside, inside, n = 1) {
    const dir = doorDirFrom(door, inside), at = dir ? `the ${dir} door` : 'the door';
    const last = n >= KNOCK_TIMES;
    const heard = n === 1 ? `Somebody knocks at ${at}.${dir ? ` <i>(open door ${dir} to let them in)</i>` : ''}`
      : last ? `Somebody knocks at ${at} again, harder.` : `Somebody knocks at ${at} again.`;
    sendToZone(inside, { type: 'zone_event', message: `<span style="color:var(--yellow)">${heard}</span>` });
    if (outside && getZone(outside)) {
      sendToZone(outside, { type: 'zone_event', message: last ? `${who.name} knocks on the door one more time.` : `${who.name} knocks on the door and waits.` });
    }
    // waitMs: they stand at the door until the next knock, or until they give up after the last
    emit('door.knock', { door, outside, inside, knockerId: who.id, name: who.name, waitMs: KNOCK_EVERY_MS + 2_000 });
  }

  // One tick of somebody stood at a shut door: knock when it's time, and say whether they're still there. `w`
  // carries the count. After the last knock they give it one more wait, then go: false, and the count resets.
  _waitAtDoor(w, who, door, outside, inside) {
    const now = Date.now();
    if (now - (w.knockAt || 0) < KNOCK_EVERY_MS) return true;
    if ((w.knocks || 0) >= KNOCK_TIMES) {
      w.knocks = 0; w.knockAt = 0;
      sendToZone(inside, { type: 'zone_event', message: `<span style="color:var(--yellow)">Whoever was at the door has gone.</span>` });
      return false;
    }
    w.knocks = (w.knocks || 0) + 1; w.knockAt = now;
    this._knock(who, door, outside, inside, w.knocks);
    return true;
  }

  // Hire a dealer in (`calldealer` at a private table): she's sent for, walks over and comes in at the door. A
  // shut door keeps her knocking outside until somebody opens it. RAM only, like the hand.
  sendForHiredDealer(name) {
    const e = entryDoorOf(this.zoneId);
    this._hiredComing = { name, at: Date.now() + HIRED_COMING_MS, door: e?.door?.id || null, outside: e?.outside || null, knocks: 0, knockAt: 0 };
  }
  stepHiredDealer() {
    const w = this._hiredComing, now = Date.now();
    if (!w || now < w.at) return;
    const door = w.door ? world.doors.get(w.door) : null, who = { id: `hired_dealer_${this.id}`, name: w.name };
    if (door && door.hp > 0 && !door.is_open) {
      if (!this._waitAtDoor(w, who, door, w.outside, this.zoneId)) {
        this._hiredComing = null;
        sendToZone(this.zoneId, { type: 'zone_event', message: `<span style="color:var(--yellow)">Nobody's answered. ${w.name} gives up and goes home.</span>` });
      }
      return;
    }
    this._hiredComing = null;
    this.hiredDealer = { id: who.id, name: w.name, sex: 'female', npc_type: 'dealer', hp: null, flags: { table_id: this.id }, hired: true };
    this.markWalkIn(who.id);
    sendToZone(this.zoneId, { type: 'zone_event', message: `<span style="color:var(--yellow)">${w.name} comes in, shakes out the deck and takes the end of the table.</span>` });
    this._dealerSay('Evening. House rules: no string bets, no crying on the felt.');
    this.pushPaneAll();
  }
  // Somebody just came in at the door: the Room Stage walks them from it to their place rather than putting them
  // there (plugins/gametable `room.tablePeople` passes `entered` on). Forgotten after a minute.
  markWalkIn(id) {
    (this._walkIns ||= new Map()).set(id, Date.now());
    for (const [k, t] of this._walkIns) if (Date.now() - t > 60_000) this._walkIns.delete(k);
  }
  walkInOf(id) { const t = this._walkIns?.get(id); return t && Date.now() - t < 60_000 ? t : null; }

  // Advance the incoming dealer two zones per tick: he's rushing, not strolling. A shut door into the room he
  // has no key to, he knocks at like anybody else. Called from the plugin tick.
  stepIncomingDealer() {
    this.stepHiredDealer();
    const w = this._incomingDealer;
    if (!w) return;
    for (let hop = 0; hop < 2; hop++) {
      const next = w.path[w.step];
      if (!next) break;
      const door = knockDoorBetween(w.npc, w.npc.zone_id, next, this.zoneId);
      if (door) {
        if (!this._waitAtDoor(w, w.npc, door, w.npc.zone_id, next)) {
          this._incomingDealer = null;
          sendToZone(w.npc.zone_id, { type: 'zone_event', message: `${w.npc.name} gives up on the door and wanders off.` });
        }
        return;
      }
      if (!moveEntity(w.npc, next, sendToZone, query)) { this._incomingDealer = null; return; }
      w.knocks = 0; w.knockAt = 0;
      w.step++;
      if (w.npc.zone_id === this.zoneId) break;
    }
    if (w.npc.zone_id === this.zoneId) {
      this._incomingDealer = null;
      this.markWalkIn(w.npc.id);
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

    // they come from wherever they are, on foot; a shut door into the room stops them knocking (stepIncomingBots)
    let path = findPath(npc.zone_id, this.zoneId, { maxDistance: 60 });
    if ((!path || path.length < 2) && this.config.selfDeal) {
      // too far to walk the whole way: they turn up outside the door, as somebody who took a cab would
      const e = entryDoorOf(this.zoneId);
      if (e && moveEntity(npc, e.outside, sendToZone, query, { teleport: true })) path = [e.outside, this.zoneId];
    }
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
      // A shut door into the table's room or building: they knock and wait for somebody to open it, never let
      // themselves in. A locked door anywhere else on the way that won't let them by is knocked at too.
      let door = next && knockDoorBetween(w.npc, w.npc.zone_id, next, this.zoneId);
      const moved = !door && next && moveEntity(w.npc, next, sendToZone, query);
      if (!moved) {
        if (!door && next) {
          const d = doorOnLink(w.npc.zone_id, null, next) || doorOnLink(next, null, w.npc.zone_id);
          if (d && d.hp > 0 && d.lock_state === 'locked') door = d;
        }
        if (door) {
          if (this._waitAtDoor(w, w.npc, door, w.npc.zone_id, next)) { still.push(w); continue; }
          sendToZone(w.npc.zone_id, { type: 'zone_event', message: `${w.npc.name} gives up on the door and wanders off.` });
        }
        if (w.npc._ai) w.npc._ai.waitUntil = null;
        continue;
      } // arrived-off-path or blocked
      w.knocks = 0; w.knockAt = 0;
      w.step++;
      if (w.npc.zone_id === this.zoneId) {
        this.markWalkIn(w.npc.id);
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
