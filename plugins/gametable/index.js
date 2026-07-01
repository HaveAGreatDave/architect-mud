// GameTable plugin entry point.
// Exports commands; manages table lifecycle, dealer NPC chitchat, and persistence tick.

import { query } from '../../server/models/db.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getLivePlayer, getZone } from '../../server/engine/world.js';
import { GameTable, activeTables, MAX_SEATS } from './game-table.js';
import { renderPane } from './render-pane.js';
import { renderHandASCII } from './cards.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../../server/engine/sift.js';
import { registerAction } from '../../server/engine/actions.js';

// ── Boot ───────────────────────────────────────────────────────────────────────

GameTable.loadAll().catch(e => console.error('[gametable] load error:', e.message));

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

// ── Commands ───────────────────────────────────────────────────────────────────

async function cmdJoin(args, raw, player) {
  const existing = tableForPlayer(player);
  if (existing) return { type: 'error', message: 'You are already at a table. Type `leave` first.' };

  const t = tableInZone(player.current_zone, args.join(' ') || null);
  if (!t) return { type: 'error', message: 'No poker table here. Try a different zone.' };

  const result = await t.joinTable(player);
  if (!result.ok) return { type: 'error', message: result.error };

  t.pushPaneAll();
  return {
    type: 'poker_update',
    html: renderPane(t, player.id),
  };
}

// `seat <n>` — take a specific seat (1-4). Buys in if not yet seated, or moves
// between hands if already seated. (`sit` itself belongs to the posture plugin.)
async function cmdSeat(args, raw, player) {
  const t = tableForPlayer(player) || tableInZone(player.current_zone);
  if (!t) return { type: 'error', message: 'No poker table here.' };

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
    n = parseInt(raw0, 10) - 1; // player-facing 1-4 → 0-3
    if (isNaN(n) || n < 0 || n >= MAX_SEATS) {
      return { type: 'error', message: `Which seat? Try: seat 2   (seats 1-${MAX_SEATS})` };
    }
  }

  if (cur === n) return { type: 'error', message: `You're already in seat ${n + 1}.` };
  if (t.seats[n]) return { type: 'error', message: `Seat ${n + 1} is taken.` };

  if (cur >= 0) {
    // Already seated — move seats, but not in the middle of a live hand.
    if (t.phase === 'InProgress') return { type: 'error', message: "You can't change seats mid-hand." };
    t.seats[n] = { ...t.seats[cur], seatIdx: n };
    t.seats[cur] = null;
    t.pushPaneAll();
    return { type: 'poker_update', html: renderPane(t, player.id) };
  }

  // Not seated yet — buy in at the chosen seat.
  const result = await t.joinTable(player, n);
  if (!result.ok) return { type: 'error', message: result.error };
  t.pushPaneAll();
  return { type: 'poker_update', html: renderPane(t, player.id) };
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
    return { type: 'poker_update', html: renderPane(existing, player.id) };
  }
  const t = tableInZone(player.current_zone, args.join(' ') || null);
  if (!t) return { type: 'error', message: 'No poker table here.' };
  t.addSpectator(player.id);
  return { type: 'poker_update', html: renderPane(t, player.id) };
}

// ── `watch` router (poker table vs. TV disambiguation) ───────────────────────────
// `watch` is owned by the broadcast plugin for TVs. gametable loads after it, so
// it takes over `watch` and routes: TV-only rooms hand straight back to broadcast,
// poker-only rooms spectate, and rooms with both ask via SIFT which to watch.

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
  const bc = await import('../broadcast/index.js').catch(() => null);
  if (bc?.commands?.watch) return bc.commands.watch(args, raw, player, broadcast);
  return { type: 'error', message: 'There is nothing here to watch.' };
}

async function cmdWatchRouter(args, raw, player, broadcast) {
  const table = tableInZone(player.current_zone);
  if (!table) return watchTV(args, raw, player, broadcast); // no poker here — pure TV path

  const first = (args[0] || '').toLowerCase();
  if (POKER_WORDS.includes(first)) return cmdWatch([], raw, player);
  if (TV_WORDS.includes(first))    return watchTV(args, raw, player, broadcast);

  if (!(await zoneHasTV(player.current_zone))) return cmdWatch([], raw, player); // only the table

  // Both a TV and a poker table are here — ask which.
  const candidates = [
    { name: 'the poker table', kind: 'poker' },
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

  return { type: 'poker_update', html: renderPane(t, player.id) };
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
const cmdCall  = makeActionCmd('call');
const cmdFold  = makeActionCmd('fold');
const cmdAllIn = makeActionCmd('allin');

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

// ── Info commands ──────────────────────────────────────────────────────────────

async function cmdTable(args, raw, player) {
  const t = tableForPlayer(player) || tableInZone(player.current_zone);
  if (!t) return { type: 'error', message: 'No table here.' };
  const lines = [
    `<b>${t.name}</b> — ${t.phase}`,
    `Seats: ${t.seatedCount()} / 4`,
    `Blinds: ₵ ${t.config.smallBlind || 10} / ₵ ${t.config.bigBlind || 20}`,
    `Buy-in: ₵ ${t.config.buyIn || t.config.minBuyIn || 100}`,
  ];
  return { type: 'output', message: lines.join('<br>') };
}

async function cmdBoard(args, raw, player) {
  const t = tableForPlayer(player);
  if (!t || !t.game) return { type: 'error', message: 'No active hand.' };
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
  const lines = t.seats.map((s, i) => {
    if (!s) return `Seat ${i + 1}: [ empty ]`;
    const gs = t.game?.seats.find(x => x.playerId === s.playerId);
    const chips = gs ? gs.chips : s.chips;
    const status = gs?.folded ? ' (folded)' : gs?.allIn ? ' (all-in)' : '';
    return `Seat ${i + 1}: ${s.handle} — ₵ ${chips.toLocaleString()}${status}`;
  });
  return { type: 'output', message: lines.join('<br>') };
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
    `  <i>…or click the action buttons; </i>${y('bet')}<i>/</i>${y('raise')}<i> fill the box so you type the amount.</i>`,
    ``,
    h(`INFO & OUT`),
    `  ${y('board')}  ${y('pot')}  ${y('players')}  ${y('showhand')}  ${y('table')}`,
    `  ${y('leave')}        cash your chips back to credits and stand up`,
    ``,
    `<i>The dealer calls every hand; your money hits the felt as you bet.</i>`,
  ].join('<br>');
}

// Bare `help` while seated/spectating shows the poker help; otherwise fall
// through to the engine's general help. `help <topic>` always falls through.
async function cmdHelpRouter(args, raw, player) {
  if (args.length) return undefined;
  const t = tableForPlayer(player);
  if (!t) return undefined;
  return { type: 'output', message: pokerHelpHTML(t) };
}

// ── Room description hook ────────────────────────────────────────────────────────
// The poker chairs are individual furniture rows (Chair 1-4). Listing them all in
// the room's Furniture: line is noise, and the plain table link buries the way in.
// This hook suppresses the table's own furniture (chairs + table) from that line
// and renders a single poker panel: the table, its dealer, and sit/watch buttons.

function renderTablePanel(t, furniture) {
  const tableFurn = furniture.find(f => f.flags?.game_table_id === t.id && f.flags?.seat_idx == null);
  const tableName = tableFurn?.name || t.name;
  const dealer = t.dealerName();
  const dealerBit = dealer ? ` <span class="text-dim">— dealt by ${dealer}</span>` : '';

  const link = (action, target, label, title) =>
    `<span class="action-link furniture-link" data-action="${action}" data-target="${target}" title="${title}">${label}</span>`;

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
  return { suppressIds, html: renderTablePanel(t, furniture) };
}

// ── Tick ───────────────────────────────────────────────────────────────────────

let ticking = false;
async function tableTick() {
  if (ticking) return;
  ticking = true;
  try {
    for (const table of activeTables.values()) {
      await table.maybePersist();

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
      }
    }
  } finally {
    ticking = false;
  }
}

setInterval(() => tableTick().catch(e => console.error('[gametable] tick:', e.message)), 1000);

console.log('[gametable] Plugin loaded.');

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
  bet:       cmdBet,
  raise:     cmdRaise,
  fold:      cmdFold,
  allin:     cmdAllIn,
  table:     cmdTable,
  board:     cmdBoard,
  pot:       cmdPot,
  players:   cmdPlayers,
  showhand:  cmdShowHand,
};
