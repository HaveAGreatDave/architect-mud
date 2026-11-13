// A chess table with a regular: somebody who sits at it on their own and plays both sides.
//
// A table's config names its regular (`practice.npc`). While nobody is seated and the regular is
// in the room, awake and off shift, they take their chair (`practice.chair`, a furniture id) and
// play a game against themselves, one move every so often, and now and then say a line from their
// own `flags.chess_lore`. The practice game is RAM only: it's a ChessGame the table holds beside
// its real one, never persisted and never staked.
//
// Sitting down opposite them is asking for a game. If they know you well enough (`practice.tier`,
// a relations tier, `known` when unset) they sweep the board and play you for real through the
// ordinary seat (seatBot), at whatever the table's minimum bet is. If they don't, they say so and
// carry on with their own game.
//
// The board the Room Stage draws is `boardOf(table)`: the real game when there is one, else the
// practice game, else the opening position. A change is announced as `room.boardChanged`.
//
// ⚠ Nothing here is Coldwater. The regular, their chair, the gate and every word they say are in
// content (the game_tables config and the NPC's flags).

import { world, getZoneNpcs, getZonePlayers, getLivePlayer, getZoneFurniture } from '../../server/engine/world.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { emit } from '../../server/engine/events.js';
import { setPosture, getPosture } from '../../server/engine/posture.js';
import { isNpcAsleep, isVendorWorkTime } from '../../server/engine/ai-behaviour.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import { getRelation, relationAtLeast } from '../../server/engine/relations.js';
import { ChessGame, START_FEN, parseFen, typeOf, colorOf, toAlgebraic } from './games/chess.js';
import { decideBotMove, chessBotId } from './bot-chess.js';

const MOVE_MS = [9_000, 22_000];     // how long the regular looks at the board between moves
const NEXT_GAME_MS = 45_000;         // the finished position stays up this long
const LORE_MS = [100_000, 190_000];  // between lines, while somebody's in the room to hear them
const MAX_PLIES = 160;               // a practice game that hasn't ended by then is set up again
const PRACTICE_PERSONA = { depth: 2, blunder: 0.08 };

const rand = ([a, b]) => a + Math.floor(Math.random() * (b - a));

export function practiceOf(table) {
  const p = table.config?.practice;
  return p && typeof p.npc === 'string' ? p : null;
}

// The regular, if they're here and able to play.
export function regularHere(table) {
  const p = practiceOf(table);
  if (!p) return null;
  const npc = getZoneNpcs(table.zoneId).find((n) => n.id === p.npc);
  if (!npc || (npc.hp != null && npc.hp <= 0) || isNpcAsleep(npc)) return null;
  if (npc.vendor_schedule && Object.keys(npc.vendor_schedule).length && isVendorWorkTime(npc, getEnvironmentState()).working) return null;
  return npc;
}

const chairName = (table) => {
  const id = practiceOf(table)?.chair;
  return (id && getZoneFurniture(table.zoneId).find((x) => x.id === id)?.name) || null;
};

// ── the board for the Room Stage ──────────────────────────────────────────────────────────────

// 64 characters, rank 8 to rank 1 and a to h along each: a piece letter (White upper case) or '.'.
export function boardString(pos) {
  let s = '';
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = pos.board[r * 16 + f];
    if (!p) { s += '.'; continue; }
    const t = typeOf(p);
    s += colorOf(p) === 'w' ? t.toUpperCase() : t;
  }
  return s;
}

const START_BOARD = boardString(parseFen(START_FEN));

export function boardOf(table) {
  const g = table.game || table._practice?.game || null;
  if (!g) return { board: START_BOARD, turn: 'w', last: null, practice: false };
  const last = g.lastMove();
  return {
    board: boardString(g.position), turn: g.turn,
    last: last && last.from != null ? [toAlgebraic(last.from), toAlgebraic(last.to)] : null,
    practice: !table.game,
  };
}

function changed(table) {
  emit('room.boardChanged', { zoneId: table.zoneId, tableId: table.id });
}

// ── speech ────────────────────────────────────────────────────────────────────────────────────

function say(table, npc, text) {
  if (!text) return;
  sendToZone(table.zoneId, { type: 'output', message: `<span class="speech-line">${npc.name} says, "${text}"</span>` });
}

function lore(npc) {
  const lines = npc.flags?.chess_lore;
  if (!Array.isArray(lines) || !lines.length) return null;
  return lines[Math.floor(Math.random() * lines.length)];
}

function line(npc, key, fallback) {
  const pool = npc.flags?.chess_lines?.[key];
  if (Array.isArray(pool) && pool.length) return pool[Math.floor(Math.random() * pool.length)];
  return fallback;
}

// ── sitting ───────────────────────────────────────────────────────────────────────────────────

function sitDown(table, npc) {
  const name = chairName(table);
  if (!name) return;
  if (getPosture(npc) !== 'sitting' || npc.sittingOn !== name) setPosture(npc, 'sitting', { sittingOn: name });
  // stay put while at the board; standUp hands the life back
  if (npc._ai) npc._ai.waitUntil = Date.now() + 120_000;
}

function standUp(table, npc) {
  const name = chairName(table);
  if (name && npc.sittingOn === name) setPosture(npc, 'standing');
  if (npc._ai) npc._ai.waitUntil = null;
}

// ── the tick ──────────────────────────────────────────────────────────────────────────────────

// Called once a second from the plugin tick for every chess table.
export function practiceTick(table, now = Date.now()) {
  const p = practiceOf(table);
  if (!p) return;
  const npc = regularHere(table);
  const P = table._practice ||= { game: null, nextMove: 0, nextLore: now + rand(LORE_MS), refused: new Set(), sitting: false };

  if (!npc) {
    // they've gone (to work, to bed): the game they left stays on the board
    if (P.sitting) { const n = world.npcs.get(p.npc); if (n) standUp(table, n); P.sitting = false; }
    return;
  }

  const botId = chessBotId(npc.id);
  const humans = table.seats.filter((s) => s && !s.isBot);
  const theyPlay = table.seatedIndex(botId) >= 0;

  // somebody sat down opposite: a game, if they're liked
  if (humans.length && !theyPlay && table.openSeats() > 0 && !table.game) {
    for (const s of humans) {
      if (P.refused.has(s.playerId)) continue;
      const pl = getLivePlayer(s.playerId);
      if (pl && relationAtLeast(getRelation(pl, npc.id), p.tier || 'known')) {
        P.game = null;
        say(table, npc, line(npc, 'accept', 'Go on, then. Let me set them up again.'));
        table.seatBot(npc).then((r) => { if (r.ok) { sitDown(table, npc); table.pushPaneAll(); changed(table); } })
          .catch((e) => console.error('[gametable] practice seat:', e.message));
        return;
      }
      P.refused.add(s.playerId);
      say(table, npc, line(npc, 'refuse', "I'm in the middle of something. With myself. It's going very well."));
    }
  }
  // the refusals are forgotten once they get up
  for (const id of [...P.refused]) if (table.seatedIndex(id) < 0) P.refused.delete(id);

  if (theyPlay) { sitDown(table, npc); P.sitting = true; return; }

  // the practice game itself, from their own chair
  sitDown(table, npc);
  P.sitting = true;
  if (!P.game || (P.game.isOver() && now >= P.nextMove) || P.game.history.length >= MAX_PLIES) {
    const fresh = !P.game;
    P.game = new ChessGame({});
    P.game.startGame([
      { seatIdx: 0, playerId: `${botId}:w`, handle: npc.name, isBot: true },
      { seatIdx: 1, playerId: `${botId}:b`, handle: npc.name, isBot: true },
    ]);
    P.nextMove = now + rand(MOVE_MS);
    if (!fresh) changed(table);
    return;
  }
  if (!P.game.isOver() && now >= P.nextMove) {
    const actor = P.game.getCurrentActor();
    const mv = decideBotMove(P.game, { persona: PRACTICE_PERSONA });
    const r = mv ? P.game.handleMove(actor.playerId, mv) : { ok: false };
    P.nextMove = now + (P.game.isOver() ? NEXT_GAME_MS : rand(MOVE_MS));
    if (r.ok) changed(table);
  }
  if (now >= P.nextLore) {
    P.nextLore = now + rand(LORE_MS);
    const anyone = getZonePlayers(table.zoneId).length > 0;
    if (anyone) say(table, npc, lore(npc));
  }
}

export const _test = { boardString, START_BOARD };
