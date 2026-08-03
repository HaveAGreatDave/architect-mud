// GameTable plugin entry point.
// Exports commands; manages table lifecycle, dealer NPC chitchat, and persistence tick.

import { query } from '../../server/models/db.js';
import { schedule } from '../../server/engine/scheduler.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getLivePlayer, setLivePlayer, getZone, world, hasActivePlayers } from '../../server/engine/world.js';
import { GameTable, MAX_SEATS } from './game-table.js';
import { ChessTable } from './chess-table.js';
import { activeTables, loadAllTables } from './tables.js';
import { renderPane } from './render-pane.js';
import { parseMove, generateMoves, toAlgebraic } from './games/chess.js';
import { narrateBoard, boardASCII } from './text-chess.js';
import { renderHandASCII } from './cards.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../../server/engine/sift.js';
import { registerAction } from '../../server/engine/actions.js';
import { on } from '../../server/engine/events.js';
import { prefersTextMinigames, setDisplayRung, displayRung } from '../../server/engine/presentation.js';
import { textModePlayers, isTextMode } from './text-mode.js';
import { isVendorWorkTime } from '../../server/engine/ai-behaviour.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import { escAttr } from '../../server/engine/text.js';

// ── Boot ───────────────────────────────────────────────────────────────────────

loadAllTables().catch(e => console.error('[gametable] load error:', e.message));

// Walking out of the room drops you from any table you were seated at or
// watching. Otherwise pushPaneAll keeps blasting the poker pane at you (on every
// dealer quip or opponent action) long after you've left, re-covering your room.
on('zone.entered', ({ actor, zone }) => {
  for (const t of activeTables.values()) {
    if (t.zoneId === zone) continue;
    if (t.seatedIndex(actor.id) >= 0 || t.spectators.has(actor.id)) {
      t.leaveTable(actor.id).catch(e => console.error('[gametable] auto-leave:', e.message));
    }
  }
});

// A death from any cause (combat, radiation, seppuku, ...) teleports the player to
// the respawn zone without firing zone.entered, so the auto-leave above never runs.
// Drop them from the table the same way.
on('player.death', ({ player }) => {
  for (const t of activeTables.values()) {
    if (t.seatedIndex(player.id) >= 0 || t.spectators.has(player.id)) {
      t.leaveTable(player.id).catch(e => console.error('[gametable] death-leave:', e.message));
    }
  }
});

// A dropped connection shouldn't leave a ghost frozen in a seat. Drop them as a
// spectator at once (nothing to hold there) and put any seat on the retention
// timer, which cashes them out if they don't reconnect in time.
on('player.logout', ({ id }) => {
  for (const t of activeTables.values()) {
    t.removeSpectator(id);
    t.onPlayerDisconnect(id);
  }
});

// Reconnected in time — cancel the pending seat cash-out, and put the game back
// in the top pane. The login look has already been sent by the time this fires,
// so a returning player would otherwise be sitting at a table they can't see:
// still seated, still owed a move, with the room description on screen. The
// pane is the only place the felt or the board exists.
//
// A text-mode player is left on the room view by design — that IS their table —
// but a chess position doesn't repeat itself the way poker narrates each street,
// so hand them the board on the way back in.
on('player.login', ({ id }) => {
  for (const t of activeTables.values()) {
    t.onPlayerReconnect(id);
    if (t.seatedIndex(id) < 0) continue;   // spectators are dropped at logout
    restorePaneOnLogin(t, id).catch(e => console.error('[gametable] login-pane:', e.message));
  }
});

async function restorePaneOnLogin(t, id) {
  const player = getLivePlayer(id);
  if (!player) return;
  // The runtime text-mode Set doesn't survive a restart (and a seat can), so
  // re-derive this player's view from their stored Display Mode before pushing.
  await ensureTextPref(player, t);
  if (isTextMode(id)) {
    if (isChess(t) && t.game) narrateBoard(t, id);
    return;
  }
  sendToPlayer(id, { type: t.paneType, html: t.renderPaneFor(id) });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function out(pid, message) { sendToPlayer(pid, { type: 'output', message }); }
function err(pid, message) { sendToPlayer(pid, { type: 'error', message }); }

function tableForPlayer(player) {
  for (const t of activeTables.values()) {
    if (t.seatedIndex(player.id) >= 0 || t.spectators.has(player.id)) return t;
  }
  return null;
}

function tableInZone(zoneId, name = null) {
  for (const t of activeTables.values()) {
    if (t.zoneId !== zoneId) continue;
    if (name && t.name.toLowerCase() !== name.toLowerCase()) continue;
    return t;
  }
  return null;
}

// Sync a player's runtime text-mode membership when they sit or spectate (not a
// hot path). The narration code only ever consults the Set, never the DB.
//
// The player's own choice always wins. `config.textTable` is only the table's
// STARTING preference — what an old-school felt opens in for someone who has
// never expressed a view — and `text`/`visual` flip freely from there at any
// table. (It used to be a hard override that made `visual` impossible.)
//
// The stored choice is the game-wide Display Mode ladder
// (server/engine/presentation.js). Poker is a COMPOSITE surface — the felt both
// shows the board and is how you bet — so by the classification rule it goes with
// its blocking half and reads the MINIGAME axis: text from the `textgames` rung
// onward, not just at `log`.
//
// Its tri-state is what keeps the textTable default alive — `undefined` means
// never chosen, which is not the same as "visual".
async function ensureTextPref(player, table) {
  const v = await prefersTextMinigames(player);
  const wantsText = v === true ? true
    : v === false ? false
    : !!table?.config?.textTable;   // no stored choice → the table's default
  if (wantsText) textModePlayers.add(player.id);
  else textModePlayers.delete(player.id);
}

// The area-pane result after a seat/spectate/look. A player in the visual view
// gets the poker pane; a player in text view leaves the area pane as the room
// look and plays entirely in the text log — so hand them the room description.
// Per player, not per table.
async function paneOrLook(t, player) {
  if (isTextMode(player.id)) {
    const { describeZone } = await import('../../server/engine/commands/index.js');
    const zone = getZone(player.current_zone);
    if (!zone) return null;
    // A text-mode chess player still needs the position; poker's own narration
    // fires from the game's transition points, but a chess board is a THING you
    // arrive at, so hand it over on the way in.
    if (isChess(t) && t.game) narrateBoard(t, player.id);
    return { type: 'look', message: await describeZone(zone, player), zone: zone.id };
  }
  return { type: t.paneType, html: t.renderPaneFor(player.id) };
}

// Which game is this table running? Every shared command below branches on it.
function isChess(t) { return t instanceof ChessTable; }

// The noun to use when a command can't find a table — a chess player told
// "no poker table here" thinks they're in the wrong room.
function noTableMsg(zoneId) {
  return tableInZone(zoneId) ? 'No table here.' : 'No game table here.';
}

// ── Commands ───────────────────────────────────────────────────────────────────

async function cmdJoin(args, raw, player) {
  const existing = tableForPlayer(player);
  if (existing) return { type: 'error', message: 'You are already at a table. Type `leave` first.' };

  const t = tableInZone(player.current_zone, args.join(' ') || null);
  if (!t) return { type: 'error', message: 'No game table here. Try a different zone.' };

  const result = await t.joinTable(player);
  if (!result.ok) return { type: 'error', message: result.error };

  await ensureTextPref(player, t);
  t.pushPaneAll();
  return paneOrLook(t, player);
}

// `seat <n>` — take a specific seat (1-4). Buys in if not yet seated, or moves
// between hands if already seated. (`sit` itself belongs to the posture plugin.)
async function cmdSeat(args, raw, player) {
  const t = tableForPlayer(player) || tableInZone(player.current_zone);
  if (!t) return { type: 'error', message: noTableMsg(player.current_zone) };

  const maxSeats = t.constructor.MAX_SEATS;
  const cur = t.seatedIndex(player.id);

  // Resolve which seat. With no number given, default to the first open seat
  // (so a bare `seat` / the "sit" button just drops you in).
  let n;
  const raw0 = args[0];
  if (raw0 == null || raw0 === '') {
    if (cur >= 0) return { type: 'error', message: `You're in seat ${cur + 1}. Use \`seat <number>\` to move.` };
    n = t.seats.findIndex(s => s === null);
    if (n < 0) return { type: 'error', message: 'The table is full.' };
  } else {
    n = parseInt(raw0, 10) - 1; // player-facing 1-N → 0-based
    if (isNaN(n) || n < 0 || n >= maxSeats) {
      return { type: 'error', message: `Which seat? Try: seat 2   (seats 1-${maxSeats})` };
    }
  }

  if (cur === n) return { type: 'error', message: `You're already in seat ${n + 1}.` };
  if (t.seats[n]) return { type: 'error', message: `Seat ${n + 1} is taken.` };

  if (cur >= 0) {
    // Already seated — move seats, but not in the middle of a live game. (At
    // chess the seat IS your colour, so this would also swap sides mid-game.)
    if (t.phase === 'InProgress') {
      return { type: 'error', message: isChess(t) ? "You can't switch sides mid-game." : "You can't change seats mid-hand." };
    }
    t.seats[n] = { ...t.seats[cur], seatIdx: n };
    t.seats[cur] = null;
    t.pushPaneAll();
    return paneOrLook(t, player);
  }

  // Not seated yet — buy in at the chosen seat.
  const result = await t.joinTable(player, n);
  if (!result.ok) return { type: 'error', message: result.error };
  await ensureTextPref(player, t);
  t.pushPaneAll();
  return paneOrLook(t, player);
}

async function cmdLeave(args, raw, player) {
  const t = tableForPlayer(player);
  if (!t) return { type: 'error', message: 'You are not at any table.', closePoker: true };
  await t.leaveTable(player.id);
  // Revert this player's area pane from the table view back to the room.
  const { describeZone } = await import('../../server/engine/commands/index.js');
  const zone = getZone(player.current_zone);
  if (!zone) return null;
  return { type: 'look', message: await describeZone(zone, player), zone: zone.id };
}

async function cmdWatch(args, raw, player) {
  const existing = tableForPlayer(player);
  if (existing) {
    if (existing.seatedIndex(player.id) >= 0) return { type: 'error', message: 'You are seated. Type `leave` to just watch.' };
    return paneOrLook(existing, player);
  }
  const t = tableInZone(player.current_zone, args.join(' ') || null);
  if (!t) return { type: 'error', message: noTableMsg(player.current_zone) };
  t.addSpectator(player.id);
  await ensureTextPref(player, t);
  return paneOrLook(t, player);
}

// ── `watch` router (poker table vs. TV vs. furniture disambiguation) ─────────────
// Three plugins want `watch`: broadcast (TVs), interactions (furniture flavor),
// and gametable (spectating). gametable declares after:["broadcast","interactions"]
// so it wins the verb and routes: poker rooms spectate, TV rooms hand back to
// broadcast, rooms with both ask via SIFT, and plain rooms fall through to the
// interactions furniture emote.

const TV_WORDS    = ['tv', 'television', 'monitor', 'screen', 'tele', 'telly'];
const POKER_WORDS = ['poker', 'table', 'cards', 'game', 'felt'];

async function zoneHasTV(zoneId) {
  const { rows } = await query(
    "SELECT 1 FROM furniture WHERE zone_id=$1 AND flags::text LIKE '%broadcast_receiver%' LIMIT 1",
    [zoneId]
  );
  return rows.length > 0;
}

async function watchTV(args, raw, player, broadcast) {
  // Switching to the TV without leaving the room shouldn't leave you a live
  // poker spectator/seat holder — otherwise pushPaneAll keeps blasting the
  // poker pane over the TV view on every dealer quip or opponent action.
  const t = tableForPlayer(player);
  if (t) await t.leaveTable(player.id).catch(e => console.error('[gametable] leave-on-watch-tv:', e.message));

  const bc = await import('../broadcast/index.js').catch(() => null);
  if (bc?.commands?.watch) return bc.commands.watch(args, raw, player, broadcast);
  return { type: 'error', message: 'There is nothing here to watch.' };
}

// Plain rooms (no table, no TV): the interactions plugin's furniture-flavor
// watch ("You settle in and watch the …").
async function watchFurniture(args, raw, player, broadcast) {
  const ia = await import('../interactions/index.js').catch(() => null);
  if (ia?.commands?.watch) return ia.commands.watch(args, raw, player, broadcast);
  return { type: 'error', message: 'There is nothing here to watch.' };
}

async function cmdWatchRouter(args, raw, player, broadcast) {
  const table = tableInZone(player.current_zone);
  if (!table) {
    if (await zoneHasTV(player.current_zone)) return watchTV(args, raw, player, broadcast);
    return watchFurniture(args, raw, player, broadcast);
  }

  const first = (args[0] || '').toLowerCase();
  if (POKER_WORDS.includes(first)) return cmdWatch([], raw, player);
  if (TV_WORDS.includes(first))    return watchTV(args, raw, player, broadcast);

  if (!(await zoneHasTV(player.current_zone))) return cmdWatch([], raw, player); // only the table

  // Both a TV and a game table are here — ask which. Name the table, not the
  // game: a chess salon must not offer you a felt that isn't in the room.
  const candidates = [
    { name: table.name, kind: 'poker' },
    { name: 'the television',  kind: 'tv' },
  ];
  const r = siftResolve(args.join(' '), candidates);
  if (r.type === 'match') {
    return r.candidate.kind === 'poker' ? cmdWatch([], raw, player) : watchTV(['tv'], 'watch tv', player, broadcast);
  }
  createSelectionState(player.id, r.candidates || candidates, {
    dispatchType: 'gametable.watch_choice', dispatchParam: 'choice',
  });
  return { type: 'output', message: formatSelectionPage({ allCandidates: r.candidates || candidates, visibleIndex: 0, pageSize: 5 }) };
}

// SIFT selection replay for a plugin verb goes through the action dispatcher.
registerAction({
  type: 'gametable.watch_choice',
  handler: async ({ actor, params, context }) => {
    if (params.choice?.kind === 'poker') return cmdWatch([], 'watch', actor);
    return watchTV(['tv'], 'watch tv', actor, context?.broadcast);
  },
});

// Take a poker seat — dispatched by the interactions plugin when a player sits
// on a poker chair (params.seatIdx from the chair's flag) or picks the table in
// the bare-`sit` prompt (no seatIdx → first open seat).
registerAction({
  type: 'gametable.take_seat',
  handler: async ({ actor, params }) => {
    const seatIdx = params?.seatIdx;
    const args = Number.isInteger(seatIdx) ? [String(seatIdx + 1)] : [];
    return cmdSeat(args, 'seat', actor);
  },
});

// Intercept `say` while seated — float it as a speech bubble over the seat,
// then fall through (return undefined) so the engine still logs/broadcasts it.
async function cmdSay(args, raw, player) {
  const t = tableForPlayer(player);
  if (t && t.seatedIndex(player.id) >= 0) {
    const text = raw.replace(/^say\s*/i, '').trim();
    if (text) t.playerSay(player.id, text);
  }
  return undefined;
}

// Intercept look while at a table — return table view instead of room HTML.
async function cmdLook(args, raw, player) {
  // Only intercept a bare "look" (no target)
  if (args.length > 0) return; // fall through to engine look for "look <target>"

  const t = tableForPlayer(player);
  if (!t) return; // fall through to engine

  // In text view the game lives in the log, so `look` shows the room rather than
  // the visual pane. Fall through to the engine's room look.
  if (isTextMode(player.id)) return;

  return { type: t.paneType, html: t.renderPaneFor(player.id) };
}

// ── Betting commands ───────────────────────────────────────────────────────────

function makeActionCmd(action) {
  return async function(args, raw, player) {
    const t = tableForPlayer(player);
    if (!t || t.seatedIndex(player.id) < 0) return { type: 'error', message: 'You are not seated at a table.' };
    if (t.phase !== 'InProgress') return { type: 'error', message: 'No hand in progress.' };
    const amount = args.length ? parseInt(args[0], 10) : 0;
    const result = t.processAction(player.id, action, amount);
    if (!result.ok) return { type: 'error', message: result.error };
    return null; // pane update is pushed by processAction → pushPaneAll
  };
}

const cmdCheck = makeActionCmd('check');
const cmdFold  = makeActionCmd('fold');
const cmdAllIn = makeActionCmd('allin');

// `call` is the in-hand "match the bet" action, but `call <name>` while you're
// not in a live hand means "call a gambler over to the table" (summon) — or,
// for `call dealer`, rush the table's own dealer back to his post. Route
// accordingly so the natural phrasing works without a separate verb.
async function cmdCall(args, raw, player) {
  const t = tableForPlayer(player);
  const name = args.join(' ').trim();
  const inHand = t && t.phase === 'InProgress' && t.seatedIndex(player.id) >= 0;
  if (name && !inHand) {
    if (/^(the\s+)?dealer$/i.test(name)) return cmdCallDealer(args, raw, player);
    return cmdSummon(args, raw, player);
  }

  if (!t || t.seatedIndex(player.id) < 0) return { type: 'error', message: 'You are not seated at a table.' };
  if (t.phase !== 'InProgress') return { type: 'error', message: 'No hand in progress.' };
  const result = t.processAction(player.id, 'call', 0);
  if (!result.ok) return { type: 'error', message: result.error };
  return null;
}

// Summon a gambler NPC to an open seat. `deal in <name>`, `summon <name>`, or
// `call <name>`. He can be anywhere in the world — if he's not already in the
// room he walks in over the next several ticks (see GameTable.stepIncomingBots).
async function cmdSummon(args, raw, player) {
  const t = tableInZone(player.current_zone);
  if (!t) return { type: 'error', message: 'No game table here.' };
  const chess = isChess(t);
  // Sit down first — you call them over to join you, not to an empty table.
  if (t.seatedIndex(player.id) < 0) {
    return { type: 'error', message: chess
      ? 'Take a seat first, then call somebody over to play you.'
      : 'Take a seat first, then call a gambler over.' };
  }
  if (t.openSeats() === 0) return { type: 'error', message: chess ? 'Somebody is already sitting opposite.' : 'The table is full.' };

  // The two pools are deliberately separate flags: the Lucky Bastard's card crowd has
  // no business answering a summons to a chess salon eighteen floors up.
  //
  // Off-shift players are asleep, not antisocial — same reason `call dealer` won't
  // wake the dealer: their commute graph would walk them straight back out.
  const flag = chess ? 'chess_player' : 'poker_player';
  const gamblers = [...world.npcs.values()].filter(n =>
    n.flags?.[flag] && (n.hp == null || n.hp > 0) && !isOffShift(n));
  if (!gamblers.length) {
    return { type: 'error', message: chess
      ? "You don't know anyone who'd come out for a game at this hour."
      : "You don't know any card players who'd show at this hour." };
  }

  let npc;
  const name = args.join(' ').replace(/^in\s+/i, '').trim(); // allow "deal in <name>"
  if (!name) {
    // Bare `summon`/`deal`/the "call AI" button — no name needed. Prefer
    // whoever's actually free (off cooldown, not already seated or walking
    // over) so the one-click option doesn't just bounce off gamblers[0].
    const free = gamblers.filter(n =>
      !(n.flags?.poker_cooldown_until && Date.now() < n.flags.poker_cooldown_until)
      && t.seatedIndex(t.botIdFor(n)) < 0
      && !t._incomingBots.some(w => w.npc.id === n.id));
    const pool = free.length ? free : gamblers;
    npc = pool[Math.floor(Math.random() * pool.length)];
  } else {
    const r = siftResolve(name, gamblers.map(n => ({ name: n.name, npc: n })));
    if (r.type !== 'match') {
      return { type: 'error', message: chess ? 'Nobody you know by that name plays.' : 'No gambler you know by that name.' };
    }
    npc = r.candidate.npc;
  }

  const result = await t.summonBot(npc);
  if (!result.ok) return { type: 'error', message: result.error };
  if (result.walking) return { type: 'output', message: `<span style="color:var(--yellow)">Word goes out. ${npc.name} is on the way.</span>` };
  t.pushPaneAll();
  return { type: 'output', message: `<span style="color:var(--yellow)">${npc.name} ${chess ? 'takes the chair opposite and turns the board' : 'pulls out a chair and sits down'}.</span>` };
}

// `evict` — send a seated AI opponent packing (between hands only; folding a
// bot out mid-hand would just be a slower path to the same seat-clear, so
// simplest to block it and let the hand finish first). Mirrors cmdSummon's
// "take a seat first" gate for symmetry.
async function cmdEvict(args, raw, player) {
  const t = tableForPlayer(player);
  // `evict` is also the admin housing command (engine world.js). When the player
  // isn't at a poker table at all, this isn't a poker eviction — return undefined so
  // dispatch falls through to that engine handler instead of eating the verb here.
  if (!t) return undefined;
  const chess = isChess(t);
  if (t.seatedIndex(player.id) < 0) return { type: 'error', message: 'Take a seat first, then evict a gambler.' };
  if (t.phase === 'InProgress') {
    return { type: 'error', message: chess
      ? "You can't send them away mid-game — finish it, or resign."
      : "You can't evict anyone mid-hand." };
  }

  const bots = t.seats.filter(s => s && s.isBot);
  if (!bots.length) return { type: 'error', message: 'No AI players at this table.' };

  let seat;
  const name = args.join(' ').trim();
  if (name) {
    const r = siftResolve(name, bots.map(s => ({ name: s.handle, seat: s })));
    if (r.type !== 'match') return { type: 'error', message: 'No AI player you know by that name.' };
    seat = r.candidate.seat;
  } else {
    seat = bots[0];
  }

  await t.leaveTable(seat.playerId);
  t.pushPaneAll();
  return { type: 'output', message: `<span style="color:var(--yellow)">${seat.handle} ${chess ? 'sets the pieces back up and steps away from the board' : 'racks his chips and steps back from the table'}.</span>` };
}

// Find the NPC actually assigned to this table (explicit dealerNpcId, or
// tagged flags.table_id) — searched world-wide so he can be called back even
// if he's wandered off. Deliberately does NOT fall back to "any npc_type
// dealer" the way GameTable._dealerNpc()'s in-room flavor lookup does — that
// fallback is fine for zone-local narration, but summoning across the map
// should only ever reach the table's own dealer, never an unrelated one.
function findAssignedDealer(t) {
  const alive = n => n && (n.hp == null || n.hp > 0);
  if (t.dealerNpcId) return alive(world.npcs.get(t.dealerNpcId)) ? world.npcs.get(t.dealerNpcId) : null;
  for (const n of world.npcs.values()) {
    if (alive(n) && n.flags?.table_id === t.id) return n;
  }
  return null;
}

// A scheduled dealer who's currently off the clock. Without this, `call dealer`
// would haul a sleeping dealer out of bed and his own commute graph (GO_HOME)
// would immediately start walking him back — he'd abandon the table mid-hand.
// Dealers with no vendor_schedule (the Lucky Bastard back room, the covert dealers)
// are always available and never gated.
function isOffShift(npc) {
  if (!npc?.vendor_schedule || !Object.keys(npc.vendor_schedule).length) return false;
  return !isVendorWorkTime(npc, getEnvironmentState()).working;
}

// `call dealer` / `calldealer` — rush the table's own dealer back to his post
// if he's wandered off (and is free to come). Doesn't require a seat: calling
// staff back is different from summoning an opponent to play.
async function cmdCallDealer(args, raw, player) {
  const t = tableForPlayer(player) || tableInZone(player.current_zone);
  if (!t) return { type: 'error', message: noTableMsg(player.current_zone) };
  if (isChess(t)) return { type: 'error', message: 'Nobody deals at a chess board.' };
  if (t.hasDealer()) return { type: 'error', message: `${t.dealerName()} is already at the table.` };

  const npc = findAssignedDealer(t);
  if (!npc) return { type: 'error', message: 'This table has no dealer to call.' };
  if (isOffShift(npc)) {
    return { type: 'error', message: `${npc.name} isn't on the clock. The felt stays cold until he is.` };
  }

  const result = await t.summonDealer(npc);
  if (!result.ok) return { type: 'error', message: result.error };
  if (result.walking) return { type: 'output', message: `<span style="color:var(--yellow)">You call for ${npc.name}. He's rushing over.</span>` };
  t.pushPaneAll();
  return { type: 'output', message: `<span style="color:var(--yellow)">${npc.name} hurries back to his post.</span>` };
}

// Auto-invite: when a lone human has waited a while and no gambler is coming,
// the dealer rustles one up. Keeps a table alive when no players are around.
async function maybeAutoInvite(table) {
  if (table._incomingBots.length || table.openSeats() === 0) return;
  const lone = table.seats.find(Boolean);
  if (!lone || lone.isBot) return;
  const now = Date.now();
  if (!table._loneSince) table._loneSince = now;
  if (now - table._loneSince < 45_000) return;                                  // give real players time
  if (table._lastAutoInvite && now - table._lastAutoInvite < 120_000) return;   // don't spam invites

  const cand = [...world.npcs.values()].find(n =>
    n.flags?.poker_player && (n.hp == null || n.hp > 0) && !isOffShift(n)
    && !(n.flags.poker_cooldown_until && now < n.flags.poker_cooldown_until)
    && table.seatedIndex('npc:' + n.id) < 0
    && !table._incomingBots.some(w => w.npc.id === n.id));
  if (!cand) return;

  table._lastAutoInvite = now;
  const r = await table.summonBot(cand).catch(() => ({ ok: false }));
  if (r.ok && !r.walking) table.pushPaneAll();
}

async function cmdBet(args, raw, player) {
  const t = tableForPlayer(player);
  if (!t || t.seatedIndex(player.id) < 0) return { type: 'error', message: 'You are not seated.' };
  const amount = parseInt(args[0], 10);
  if (!amount) return { type: 'error', message: 'Usage: bet <amount>' };
  const result = t.processAction(player.id, 'bet', amount);
  if (!result.ok) return { type: 'error', message: result.error };
  return null;
}

async function cmdRaise(args, raw, player) {
  const t = tableForPlayer(player);
  // `raise` is also the engine's spend-IP-to-raise-a-stat command. If the player
  // isn't seated at a poker table, fall through so that still works.
  if (!t || t.seatedIndex(player.id) < 0) return undefined;
  const amount = parseInt(args[0], 10);
  if (!amount) return { type: 'error', message: 'Usage: raise <amount>' };
  const result = t.processAction(player.id, 'raise', amount);
  if (!result.ok) return { type: 'error', message: result.error };
  return null;
}

// ── Chess commands ─────────────────────────────────────────────────────────────

// The chess table this player is actually sitting at (or watching), or null.
function chessTableFor(player) {
  const t = tableForPlayer(player);
  return isChess(t) ? t : null;
}

// `chessmove e2e4` / `chessmove Nf3` — play a move.
async function cmdChessMove(args, raw, player) {
  const t = chessTableFor(player);
  if (!t) return { type: 'error', message: 'You are not at a chessboard.' };
  if (t.seatedIndex(player.id) < 0) return { type: 'error', message: 'You are watching, not playing.' };
  const input = args.join(' ').trim();
  if (!input) return { type: 'error', message: 'Usage: chessmove e2e4   (or chessmove Nf3)' };

  const result = t.processMove(player.id, input);
  if (!result.ok) return { type: 'error', message: result.error };
  return null; // the pane and the log are pushed by processMove
}

// `move` — owned here so `move e2e4` works at the board, but handed straight
// back to the engine's movement command for everything else. The guard is
// deliberately narrow: a table, a live game, YOUR turn, and an input that
// actually parses as a legal move. `move north` must never be eaten.
async function cmdMoveRouter(args, raw, player) {
  const t = chessTableFor(player);
  if (!t || !t.game || t.game.isOver()) return undefined;
  if (t.seatedIndex(player.id) < 0) return undefined;
  if (t.game.getCurrentActor()?.playerId !== player.id) return undefined;

  const input = args.join(' ').trim();
  if (!input) return undefined;
  if (!parseMove(t.game.position, input)) return undefined; // not a chess move — it's a direction

  return cmdChessMove(args, raw, player);
}

// `chesspick e2` — lift a piece so its legal squares light up. `chesspick none`
// puts it back. This is the first half of a board click; a player typing moves
// never needs it.
async function cmdChessPick(args, raw, player) {
  const t = chessTableFor(player);
  if (!t) return { type: 'error', message: 'You are not at a chessboard.' };
  const sq = (args[0] || '').toLowerCase();
  const result = t.pickSquare(player.id, sq);
  if (!result.ok) return { type: 'error', message: result.error };

  // In text view there are no glowing squares, so say what the piece can do.
  if (isTextMode(player.id) && result.moves?.length) {
    const dests = result.moves.map(m => toAlgebraic(m.to)).join(' · ');
    return { type: 'output', message: `From ${sq}: ${dests}` };
  }
  return null;
}

async function cmdResign(args, raw, player) {
  const t = chessTableFor(player);
  if (!t) return { type: 'error', message: 'You have no game to resign.' };
  const result = t.resign(player.id);
  if (!result.ok) return { type: 'error', message: result.error };
  return { type: 'output', message: 'You tip your king over.' };
}

async function cmdOfferDraw(args, raw, player) {
  const t = chessTableFor(player);
  if (!t) return { type: 'error', message: 'You are not at a chessboard.' };
  const result = t.offerDraw(player.id);
  if (!result.ok) return { type: 'error', message: result.error };
  return { type: 'output', message: `You offer ${result.offeredTo} a draw.` };
}

async function cmdAcceptDraw(args, raw, player) {
  const t = chessTableFor(player);
  if (!t) return { type: 'error', message: 'No draw has been offered to you.' };
  const result = t.respondDraw(player.id, true);
  if (!result.ok) return { type: 'error', message: result.error };
  return null;
}

async function cmdDeclineDraw(args, raw, player) {
  const t = chessTableFor(player);
  if (!t) return { type: 'error', message: 'No draw has been offered to you.' };
  const result = t.respondDraw(player.id, false);
  if (!result.ok) return { type: 'error', message: result.error };
  return { type: 'output', message: 'You decline the draw.' };
}

// ── Info commands ──────────────────────────────────────────────────────────────

async function cmdTable(args, raw, player) {
  const t = tableForPlayer(player) || tableInZone(player.current_zone);
  if (!t) return { type: 'error', message: 'No table here.' };
  if (isChess(t)) {
    const lines = [
      `<b>${t.name}</b> — ${t.phase}`,
      `Seats: ${t.seatedCount()} / ${t.constructor.MAX_SEATS}`,
      t.stake ? `Stake: ₵ ${t.stake.toLocaleString()} a side` : 'Stake: free game',
      `Move clock: ${t.config.moveTimerSecs || 120}s`,
    ];
    return { type: 'output', message: lines.join('<br>') };
  }
  const lines = [
    `<b>${t.name}</b> — ${t.phase}`,
    `Seats: ${t.seatedCount()} / ${t.constructor.MAX_SEATS}`,
    `Blinds: ₵ ${t.config.smallBlind || 10} / ₵ ${t.config.bigBlind || 20}`,
    `Buy-in: ₵ ${t.config.buyIn || t.config.minBuyIn || 100}`,
  ];
  return { type: 'output', message: lines.join('<br>') };
}

async function cmdBoard(args, raw, player) {
  const t = tableForPlayer(player);
  if (!t || !t.game) return { type: 'error', message: isChess(t) ? 'No game in progress.' : 'No active hand.' };
  if (isChess(t)) {
    // Always the written board, in both views — "let me look at it again" is
    // exactly as reasonable a request with the pane up as without it.
    const color = t.game.seatByPlayer(player.id)?.color || 'w';
    const turn = t.game.isOver()
      ? t.game.resultLine()
      : `${t.game.turn === 'w' ? 'White' : 'Black'} to move${t.game.inCheck() ? ' — in check' : ''}.`;
    return { type: 'output', message: `<pre>${boardASCII(t.game, color)}</pre>${turn}` };
  }
  const community = t.game.community;
  if (!community.length) return { type: 'output', message: 'No community cards yet.' };
  return { type: 'output', message: `<pre>${renderHandASCII(community)}</pre>` };
}

async function cmdPot(args, raw, player) {
  const t = tableForPlayer(player);
  if (!t || !t.game) return { type: 'error', message: 'No active hand.' };
  return { type: 'output', message: `Pot: ₵ ${t.game.pot.toLocaleString()}` };
}

async function cmdPlayers(args, raw, player) {
  const t = tableForPlayer(player) || tableInZone(player.current_zone);
  if (!t) return { type: 'error', message: 'No table here.' };
  if (isChess(t)) {
    const lines = t.seats.map((s, i) => {
      if (!s) return `Seat ${i + 1}: [ empty ]`;
      const cs = t.game?.seatByPlayer(s.playerId);
      const color = cs ? ` — ${cs.color === 'w' ? 'White' : 'Black'}` : '';
      const toMove = cs && !t.game.isOver() && t.game.turn === cs.color ? ' (to move)' : '';
      return `Seat ${i + 1}: ${s.handle}${color}${toMove}`;
    });
    return { type: 'output', message: lines.join('<br>') };
  }
  const lines = t.seats.map((s, i) => {
    if (!s) return `Seat ${i + 1}: [ empty ]`;
    const gs = t.game?.seats.find(x => x.playerId === s.playerId);
    const chips = gs ? gs.chips : s.chips;
    const status = gs?.folded ? ' (folded)' : gs?.allIn ? ' (all-in)' : '';
    return `Seat ${i + 1}: ${s.handle} — ₵ ${chips.toLocaleString()}${status}`;
  });
  return { type: 'output', message: lines.join('<br>') };
}

// Switch a player between the visual table (top pane) and the text version
// (room look in the pane, the game called out to the scrolling log). This is the
// same per-player pref the screen-reader `pokertext` mode uses — `textModePlayers`
// + the persisted Display Mode — so text view and narration are one switch. If the
// player is at a table, the top pane is flipped immediately; otherwise the pref is
// just stored for the next time they sit.
//
// It writes the GAME-WIDE preference (Tablet → Settings → Display Mode), so
// `text` at the felt also stops the 3D cockpit opening later. That's deliberate:
// there is one switch, and this is one of its handles.
//
// It moves the MINIGAME axis only. `text` here must not take away somebody's map
// and hangar bay as a side effect of how they wanted to play cards, so it lands
// on `textgames` rather than the bottom rung — unless they are ALREADY at `log`,
// in which case leaving them there is the honest no-op (dropping them a rung
// would silently hand back panels they had turned off).
async function applyPokerView(player, toText) {
  if (toText) textModePlayers.add(player.id);
  else textModePlayers.delete(player.id);
  const rung = await displayRung(player);
  if (toText) { if (rung !== 'log') await setDisplayRung(player, 'textgames'); }
  else await setDisplayRung(player, 'visual');

  const y = s => `<span style="color:var(--yellow)">${s}</span>`;
  const t = tableForPlayer(player);
  // What text mode actually GIVES you differs by game — hole cards and streets
  // at the felt, the position after every move at a board. Promise the right one.
  const textNote = isChess(t)
    ? `${y('Text mode.')} The board drops out of the top pane back to the room view; the position is written out to this log after every move. Type <b>visual</b> to bring the board back.`
    : `${y('Text mode.')} The table drops out of the top pane back to the room view; your hole cards, the board on every street, and your turn (pot + to-call) are called out to this log. Type <b>visual</b> to bring the table back.`;
  const note = toText
    ? textNote
    : `${y('Visual mode.')} The ${isChess(t) ? 'board' : 'table'} is back in the top pane. Type <b>text</b> to play in the log instead.`;

  if (!t) return { type: 'output', message: note };

  // At a table — confirm in the log, then flip the top pane itself.
  out(player.id, note);
  if (toText) {
    const { describeZone } = await import('../../server/engine/commands/index.js');
    const zone = getZone(player.current_zone);
    if (!zone) return null;
    if (isChess(t) && t.game) narrateBoard(t, player.id);
    return { type: 'look', message: await describeZone(zone, player), zone: zone.id };
  }
  return { type: t.paneType, html: t.renderPaneFor(player.id) };
}

// The same flip, driven from OUTSIDE the felt: the Settings "Display Mode" switch
// (plugins/tablet) has already written the preference, so this only syncs poker's
// runtime Set — which the narration hot path consults instead of the DB — and
// repaints the top pane for anyone currently seated. Silent: the player is looking
// at a settings screen, not the table, and that screen says it for us.
export async function syncDisplayMode(player, toText) {
  if (toText) textModePlayers.add(player.id);
  else textModePlayers.delete(player.id);
  const t = tableForPlayer(player);
  if (!t) return;
  if (toText) {
    const { describeZone } = await import('../../server/engine/commands/index.js');
    const zone = getZone(player.current_zone);
    if (zone) sendToPlayer(player.id, { type: 'look', message: await describeZone(zone, player), zone: zone.id });
    if (isChess(t) && t.game) narrateBoard(t, player.id);
    return;
  }
  sendToPlayer(player.id, { type: t.paneType, html: t.renderPaneFor(player.id) });
}

// `text` — switch this player to the text version of the game.
async function cmdTextView(args, raw, player) { return applyPokerView(player, true); }
// `visual` — switch this player back to the visual table.
async function cmdVisualView(args, raw, player) { return applyPokerView(player, false); }

// `pokertext [on|off]` — the original screen-reader alias for the same switch
// (on ⇒ text version, off ⇒ visual). Bare toggles from the current state.
async function cmdPokerText(args, raw, player) {
  const a = (args[0] || '').toLowerCase();
  const on = a === 'on' ? true : a === 'off' ? false : !textModePlayers.has(player.id);
  return applyPokerView(player, on);
}

async function cmdShowHand(args, raw, player) {
  const t = tableForPlayer(player);
  if (!t || !t.game) return { type: 'error', message: 'No active hand.' };
  const gs = t.game.getActiveSeat(player.id);
  if (!gs) return { type: 'error', message: 'You are not in this hand.' };
  return { type: 'output', message: `Your hand:\n<pre>${renderHandASCII(gs.hand)}</pre>` };
}

// ── Help ─────────────────────────────────────────────────────────────────────
// The "help" button on the table relays this, and bare `help` while at a table
// shows it (falling through to the engine help otherwise).

function pokerHelpHTML(t) {
  const y = (s) => `<span style="color:var(--yellow)">${s}</span>`;
  const h = (s) => `<span style="color:var(--accent)">${s}</span>`;
  const buyIn = t.config.buyIn || t.config.minBuyIn || 100;
  const sb = t.config.smallBlind || 10, bb = t.config.bigBlind || 20;
  return [
    `<b>♠ ${t.name} — TEXAS HOLD'EM ♠</b>`,
    `Buy in, outplay the table, walk away with their credits.`,
    `Buy-in ₵ ${buyIn}  ·  blinds ₵ ${sb} / ₵ ${bb}  ·  2-4 players, 2 to deal.`,
    ``,
    h(`JOIN`),
    `  ${y('join')}         buy in and take the next open seat`,
    `  ${y('seat &lt;n&gt;')}     take a specific seat 1-4 (bare ${y('seat')} = first open)`,
    `  ${y('spectate')}     watch a hand without playing`,
    `  <i>…or click the</i> ${y('sit')} <i>/</i> ${y('watch')} <i>buttons under the table.</i>`,
    ``,
    h(`PLAY`) + `  <i>(on your turn your seat glows gold)</i>`,
    `  ${y('check')}        pass when no bet is owed to you`,
    `  ${y('call')}         match the current bet`,
    `  ${y('bet &lt;amt&gt;')}    open the betting`,
    `  ${y('raise &lt;amt&gt;')}  raise the bet to &lt;amt&gt;`,
    `  ${y('fold')}         throw your hand away`,
    `  ${y('all-in')}       shove your whole stack`,
    `  <i>…or click the action buttons; </i>${y('bet')}<i>/</i>${y('raise')}<i> pop up a prompt for the amount.</i>`,
    ``,
    h(`NEED PEOPLE?`),
    `  ${y('summon')}        call any gambler over — bare (or the</i> ${y('call AI')} <i>button) picks whoever's free`,
    `  ${y('summon &lt;name&gt;')}  call a specific gambler by name (also: ${y('deal in &lt;name&gt;')})`,
    `  ${y('evict')}         send the AI opponent packing (also: ${y('evict &lt;name&gt;')})`,
    `  ${y('call dealer')}   no dealer? call him back to his post (also: ${y('calldealer')})`,
    ``,
    h(`INFO & OUT`),
    `  ${y('board')}  ${y('pot')}  ${y('players')}  ${y('showhand')}  ${y('table')}`,
    `  ${y('text')}         play in the log: the table leaves the top pane, hands are called out (also: ${y('pokertext')})`,
    `  ${y('visual')}       bring the visual table back to the top pane`,
    `  ${y('leave')}        cash your chips back to credits and stand up`,
    ``,
    `<i>Hands can't be dealt without the dealer present. Your money hits the felt as you bet.</i>`,
  ].join('<br>');
}

// Bare `help` while seated/spectating shows the poker help; otherwise fall
// through to the engine's general help. `help <topic>` always falls through.
function chessHelpHTML(t) {
  const y = (s) => `<span style="color:var(--yellow)">${s}</span>`;
  const h = (s) => `<span style="color:var(--accent)">${s}</span>`;
  return [
    `<b>♟ ${t.name} — CHESS ♟</b>`,
    t.stake
      ? `₵ ${t.stake.toLocaleString()} a side. Winner takes the board; a draw returns both stakes.`
      : `A free game. Nothing on it but your name.`,
    `Two players. Colours swap every game.`,
    ``,
    h(`PLAY`),
    `  <i>Click a piece, then click where it goes. That's the whole thing.</i>`,
    `  ${y('move e2e4')}    play a move by squares (also ${y('chessmove')})`,
    `  ${y('move Nf3')}     …or in proper notation, if that's your habit`,
    `  ${y('move O-O')}     castle (${y('O-O-O')} queenside)`,
    `  <i>Promotion picks a queen from the board; type</i> ${y('move e7e8r')} <i>for anything else.</i>`,
    ``,
    h(`THE OTHER WAYS IT ENDS`),
    `  ${y('offerdraw')}    offer a draw`,
    `  ${y('acceptdraw')}   ${y('declinedraw')}   answer one`,
    `  ${y('resign')}       tip your king over`,
    ``,
    h(`INFO & OUT`),
    `  ${y('board')}        the position as text, any time`,
    `  ${y('players')}  ${y('table')}`,
    `  ${y('text')}         play in the log — the board is called out move by move`,
    `  ${y('visual')}       bring the board back to the top pane`,
    `  ${y('leave')}        stand up. <i>Mid-game that's a forfeit — and the stake with it.</i>`,
    ``,
    `<i>Let the clock run out twice in a row and you forfeit. Chess is patient; the table isn't.</i>`,
  ].join('<br>');
}

async function cmdHelpRouter(args, raw, player) {
  if (args.length) return undefined;
  const t = tableForPlayer(player);
  if (!t) return undefined;
  return { type: 'output', message: isChess(t) ? chessHelpHTML(t) : pokerHelpHTML(t) };
}

// ── Room description hook ────────────────────────────────────────────────────────
// The poker chairs are individual furniture rows (Chair 1-4). Listing them all in
// the room's Furniture: line is noise, and the plain table link buries the way in.
// This hook suppresses the table's own furniture (chairs + table) from that line
// and renders a single poker panel: the table, its dealer, and sit/watch buttons.

// The chess version of the same panel: two seats, no chairs list worth
// collapsing, and the position's state instead of a chip count.
function renderChessPanel(t, furniture) {
  const tableFurn = furniture.find(f => f.flags?.game_table_id === t.id && f.flags?.seat_idx == null);
  const tableName = tableFurn?.name || t.name;
  const link = (action, target, label, title) =>
    `<span class="action-link furniture-link" data-action="${action}" data-target="${escAttr(target)}" title="${escAttr(title)}">${label}</span>`;

  const state = t.game && !t.game.isOver()
    ? ` <span class="text-dim">— ${t.game.turn === 'w' ? 'White' : 'Black'} to move</span>`
    : (t.seatedCount() === 1 ? ' <span class="text-dim">— one player waiting</span>' : '');

  const seatBits = t.seats.map((s, i) =>
    s
      ? `${i === 0 ? 'White' : 'Black'}: <span class="text-dim">${s.handle}</span>`
      : `${i === 0 ? 'White' : 'Black'}: ${link('seat', i + 1, '&lt;OPEN&gt;', `Take the ${i === 0 ? 'white' : 'black'} pieces`)}`,
  );

  const firstOpen = t.seats.findIndex(s => !s);
  const actions = [];
  if (firstOpen >= 0) actions.push(link('seat', firstOpen + 1, 'Play', 'Sit down and play'));
  actions.push(link('watch', 'chess', 'Watch', 'Watch the game'));
  if (tableFurn) actions.push(link('examine', tableFurn.name, 'Examine', `Examine ${tableFurn.name}`));

  return `<span class="furniture-label">Chess:</span> <span class="furniture-link">${tableName}</span>${state}`
    + `   ·   ${actions.join('   ')}`
    + `<div class="poker-chairs-list">${seatBits.join(' &nbsp;·&nbsp; ')}</div>`;
}

function renderTablePanel(t, furniture) {
  const tableFurn = furniture.find(f => f.flags?.game_table_id === t.id && f.flags?.seat_idx == null);
  const tableName = tableFurn?.name || t.name;
  const dealer = t.dealerName();
  const dealerBit = dealer ? ` <span class="text-dim">— dealt by ${dealer}</span>` : '';

  const link = (action, target, label, title) =>
    `<span class="action-link furniture-link" data-action="${action}" data-target="${escAttr(target)}" title="${escAttr(title)}">${label}</span>`;

  // Per-seat breakdown: empty seats are click-to-sit, taken seats show the handle.
  const seatBits = t.seats.map((s, i) =>
    s
      ? `${i + 1}: <span class="text-dim">${s.handle}</span>`
      : `${i + 1}: ${link('seat', i + 1, '&lt;EMPTY&gt;', `Take seat ${i + 1}`)}`,
  );

  // Header actions: Sit drops into the first open seat, Watch spectates.
  const firstOpen = t.seats.findIndex(s => !s);
  const actions = [];
  if (firstOpen >= 0) actions.push(link('seat', firstOpen + 1, 'Sit', 'Take a seat'));
  actions.push(link('watch', 'poker', 'Watch', 'Watch the game'));
  if (tableFurn) actions.push(link('examine', tableFurn.name, 'Examine', `Examine ${tableFurn.name}`));

  // The chairs list is collapsed by default — a <details> the player can open.
  return `<span class="furniture-label">Poker:</span> <span class="furniture-link">${tableName}</span>${dealerBit}`
    + `   ·   ${actions.join('   ')}`
    + `<details class="poker-chairs"><summary>Chairs <span class="text-dim">(${t.seatedCount()}/${MAX_SEATS})</span></summary>`
    + `<span class="poker-chairs-list">${seatBits.join(', ')}</span></details>`;
}

async function furniturePanel(zone, furniture, player) {
  const t = tableInZone(zone.id);
  if (!t) return undefined; // no table here — leave furniture rendering untouched
  const suppressIds = furniture
    .filter(f => f.flags?.game_table_id === t.id)
    .map(f => f.id);
  return { suppressIds, html: isChess(t) ? renderChessPanel(t, furniture) : renderTablePanel(t, furniture) };
}

// ── Tick ───────────────────────────────────────────────────────────────────────

let ticking = false;
async function tableTick() {
  // Idle-gate: a game table needs seated players; on an empty world there's
  // nothing to advance, and maybePersist()'s UPDATE would otherwise keep Neon's
  // compute awake. Registered on the scheduler's '1s' cadence, which applies this
  // gate by default — the explicit check is kept as a guard for any direct call.
  if (!hasActivePlayers()) return;
  if (ticking) return;
  ticking = true;
  try {
    for (const table of activeTables.values()) {
      await table.maybePersist();
      table.stepIncomingDealer(); // advance a rushing dealer/host, if one was called

      // Chess has no dealer gate — beyond walking an opponent in, its only tick
      // work is the persist above plus the occasional line from the host.
      if (isChess(table)) {
        table.stepIncomingBots();
        if (table.phase === 'InProgress' && table.seatedCount() > 0) {
          const now = Date.now();
          if (!table._lastDealerSay || now - table._lastDealerSay > 180_000) {
            table._lastDealerSay = now;
            table.hostIdle();
          }
        }
        continue;
      }

      table.stepIncomingBots(); // advance any gamblers walking in toward the table
      if (table.phase === 'WaitingForDealer' && table.hasDealer()) table._checkAutoStart();
      if (table.seatedCount() !== 1 || table.game) table._loneSince = null;

      // Ambient dealer chatter — a quip in the dealer's speech bubble now and
      // then, only while a hand is live and players are seated.
      if (table.phase === 'InProgress' && table.seatedCount() > 0) {
        const now = Date.now();
        if (!table._lastDealerSay || now - table._lastDealerSay > 150_000) {
          table._lastDealerSay = now;
          table.dealerIdle();
        }
      } else if (!table.game && table.seatedCount() === 1) {
        // A lone player is waiting for the table to fill — the dealer chats them
        // up and heckles the room to sit down, more often than idle chatter.
        const now = Date.now();
        if (!table._lastDealerSay || now - table._lastDealerSay > 90_000) {
          table._lastDealerSay = now;
          table.dealerWaitingBanter();
        }
        await maybeAutoInvite(table); // and eventually rustle up a gambler
      }
    }
  } finally {
    ticking = false;
  }
}

schedule('1s', () => tableTick().catch(e => console.error('[gametable] tick:', e.message)));

console.log('[gametable] Plugin loaded.');

// ── Admin route ─────────────────────────────────────────────────────────────────
// Dev panel "Clear all poker tables" — cash every seated player and bot out and
// drop every spectator from every table. Recovers stuck/ghost seats.

async function clearAllTables() {
  let tables = 0, cleared = 0;
  for (const t of activeTables.values()) {
    const occupants = [...t.seats.filter(Boolean).map(s => s.playerId), ...t.spectators];
    if (!occupants.length) continue;
    tables++;
    for (const pid of occupants) {
      await t.leaveTable(pid);
      cleared++;
      // Cash-out clears the table seat, but not a sitting posture — stand them up too.
      const lp = getLivePlayer(pid);
      if (lp && lp.posture === 'sitting') {
        setLivePlayer(pid, { ...lp, posture: 'standing', sittingOn: null });
        sendToPlayer(pid, { type: 'output', message: 'You stand up from the table.' });
      }
    }
  }
  return { tables, cleared };
}

// Dev panel "Games" section — live table roster + blind editing.
const DEVPANEL_ROLES = ['dev', 'admin', 'builder', 'designer'];

function listTables() {
  return [...activeTables.values()].map(t => ({
    id: t.id,
    name: t.name,
    zoneId: t.zoneId,
    zoneName: getZone(t.zoneId)?.name || t.zoneId,
    phase: t.phase,
    smallBlind: t.config.smallBlind || 10,
    bigBlind: t.config.bigBlind || 20,
    buyIn: t.config.buyIn || t.config.minBuyIn || 100,
    dealerName: t.dealerName(),
    spectatorCount: t.spectators.size,
    seats: t.seats.map((s, seatIdx) => s && {
      seatIdx, handle: s.handle, isBot: !!s.isBot, chips: s.chips,
    }),
  }));
}

export async function routeHandler(path, method, body, auth) {
  if (path === '/gametable/clear-all' && method === 'POST') {
    if (!auth || auth.role !== 'admin') return { status: 403, body: { error: 'Admin access required' } };
    const result = await clearAllTables();
    return { status: 200, body: { ok: true, ...result } };
  }

  if (path === '/gametable/tables' && method === 'GET') {
    if (!auth || !DEVPANEL_ROLES.includes(auth.role)) return { status: 403, body: { error: 'Access required' } };
    return { status: 200, body: listTables() };
  }

  const blindsMatch = path.match(/^\/gametable\/tables\/([^/]+)\/blinds$/);
  if (blindsMatch && method === 'POST') {
    if (!auth || auth.role !== 'admin') return { status: 403, body: { error: 'Admin access required' } };
    const t = activeTables.get(blindsMatch[1]);
    if (!t) return { status: 404, body: { error: 'Table not found' } };
    const smallBlind = parseInt(body?.smallBlind, 10);
    const bigBlind = parseInt(body?.bigBlind, 10);
    if (!Number.isFinite(smallBlind) || smallBlind <= 0) return { status: 400, body: { error: 'Invalid small blind' } };
    if (!Number.isFinite(bigBlind) || bigBlind <= smallBlind) return { status: 400, body: { error: 'Big blind must be greater than small blind' } };
    await t.setConfig({ smallBlind, bigBlind });
    return { status: 200, body: { ok: true } };
  }

  const buyInMatch = path.match(/^\/gametable\/tables\/([^/]+)\/buyin$/);
  if (buyInMatch && method === 'POST') {
    if (!auth || auth.role !== 'admin') return { status: 403, body: { error: 'Admin access required' } };
    const t = activeTables.get(buyInMatch[1]);
    if (!t) return { status: 404, body: { error: 'Table not found' } };
    const buyIn = parseInt(body?.buyIn, 10);
    if (!Number.isFinite(buyIn) || buyIn <= 0) return { status: 400, body: { error: 'Invalid buy-in' } };
    await t.setConfig({ buyIn });
    return { status: 200, body: { ok: true } };
  }

  return null;
}

// ── Exports ────────────────────────────────────────────────────────────────────

export const hooks = {
  'zone.furniturePanel': furniturePanel,
};

export const commands = {
  join:      cmdJoin,
  seat:      cmdSeat,
  leave:     cmdLeave,
  spectate:  cmdWatch,
  watch:     cmdWatchRouter,
  say:       cmdSay,
  look:      cmdLook,
  help:      cmdHelpRouter,
  check:     cmdCheck,
  call:      cmdCall,
  deal:      cmdSummon,
  summon:    cmdSummon,
  evict:     cmdEvict,
  calldealer: cmdCallDealer,
  bet:       cmdBet,
  raise:     cmdRaise,
  fold:      cmdFold,
  allin:     cmdAllIn,
  table:     cmdTable,
  board:     cmdBoard,
  pot:       cmdPot,
  players:   cmdPlayers,
  showhand:  cmdShowHand,
  pokertext: cmdPokerText,
  text:      cmdTextView,
  visual:    cmdVisualView,
  // Chess. `move` is shared with the engine's movement command and falls
  // through unless the input is a legal move on a board you're sitting at.
  move:        cmdMoveRouter,
  chessmove:   cmdChessMove,
  chesspick:   cmdChessPick,
  resign:      cmdResign,
  offerdraw:   cmdOfferDraw,
  acceptdraw:  cmdAcceptDraw,
  declinedraw: cmdDeclineDraw,
};

// Exposed for the regress suite.
export const _test = { isOffShift, ensureTextPref, restorePaneOnLogin };
