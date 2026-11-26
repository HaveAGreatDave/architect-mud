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
import { emit, on } from '../../server/engine/events.js';
import { setNpcMood } from '../../server/engine/npc-mood.js';
import { setPosture, getPosture } from '../../server/engine/posture.js';
import { isNpcAsleep, isVendorWorkTime } from '../../server/engine/ai-behaviour.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import { getRelation, relationAtLeast, adjustRelation } from '../../server/engine/relations.js';
import { ChessGame, START_FEN, parseFen, typeOf, colorOf, toAlgebraic, inCheck } from './games/chess.js';
import { decideBotMove, chessBotId, quickEval } from './bot-chess.js';

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

// Whether the regular is at home and able to play: alive, awake, off shift, and in the table's room or one of
// their home's (`practice.home`, zone ids; their own home_zone always counts). Being home is what a challenge
// needs; they walk to the board from wherever in it they are.
export function regularHome(table) {
  const p = practiceOf(table);
  const npc = p && world.npcs.get(p.npc);
  if (!npc || (npc.hp != null && npc.hp <= 0) || isNpcAsleep(npc)) return null;
  if (npc.vendor_schedule && Object.keys(npc.vendor_schedule).length && isVendorWorkTime(npc, getEnvironmentState()).working) return null;
  const home = new Set([table.zoneId, npc.home_zone, ...(Array.isArray(p.home) ? p.home : [])].filter(Boolean));
  return home.has(npc.zone_id) ? npc : null;
}

// The table whose regular this NPC is, if any.
export function tableOfRegular(tables, npcId) {
  for (const t of tables) if (practiceOf(t)?.npc === npcId) return t;
  return null;
}

// Somebody asked the regular for a game (the dialogue action CHESS_CHALLENGE in index.js). An asked game skips the
// "do I know you" gate. Returns { ok, line }, `line` being what they say back.
export async function challengeRegular(table, player) {
  const p = practiceOf(table);
  const npc = regularHome(table);
  if (!npc) return { ok: false, line: null };
  if (table.game && !table.game.isOver()) return { ok: false, line: line(npc, 'busy', "There's a game on. Wait your turn.") };
  // just beaten by you: not again, not yet
  if ((table._practice?.sore?.get(player.id) || 0) > Date.now()) return { ok: false, line: line(npc, 'sore', "No. I don't want to play you right now.") };
  const P = table._practice ||= { game: null, nextMove: 0, nextLore: Date.now() + rand(LORE_MS), refused: new Set(), sitting: false };
  (P.invited ||= new Map()).set(player.id, Date.now() + 10 * 60_000);
  P.refused.delete(player.id);
  // in the room: sat down in the chair opposite theirs at once
  if (player.current_zone === table.zoneId && table.seatedIndex(player.id) < 0) {
    const chair = getZoneFurniture(table.zoneId).find((f) => f.flags?.game_table_id === table.id && f.flags?.seat_idx != null && f.id !== p.chair);
    if (chair) {
      const r = await table.joinTable(player, Number(chair.flags.seat_idx));
      if (r?.ok) setPosture(player, 'sitting', { sittingOn: chair.name });
    }
  }
  // not in the room with the board: they go to it, and so must you
  if (table.seatedIndex(chessBotId(npc.id)) < 0 && npc.zone_id !== table.zoneId && table.seatedIndex(player.id) >= 0) {
    await table.summonBot(npc).catch(() => null);
  }
  const away = player.current_zone !== table.zoneId;
  return { ok: true, line: line(npc, away ? 'challengedAway' : 'challenged', away ? "Board's in the other room. Go and sit down." : "Sit down, then. You can have white.") };
}

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
  // who plays which side, so the Room Stage lets its player pick up their own men (gl/room-chess-play.js)
  const side = (c) => (table.game ? g.seats.find((s) => s.color === c)?.playerId ?? null : null);
  return {
    board: boardString(g.position), turn: g.turn, white: side('w'), black: side('b'), over: g.isOver(),
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

// ── how they take a result ────────────────────────────────────────────────────────────────────
// Beaten at their own board, the regular is angry for a while and likes you less (`practice.sore`, warmth lost, 12
// by default); beating you cheers them up. Their words are `chess_lines.lost` and `chess_lines.won`.
const SORE_MS = 15 * 60_000;
on('chess.finished', ({ table, result, seats }) => {
  const p = practiceOf(table);
  if (!p || !result || !Array.isArray(seats)) return;
  const botId = chessBotId(p.npc), me = seats.find((s) => s.playerId === botId);
  const npc = world.npcs.get(p.npc);
  if (!me || !npc) return;
  const them = seats.filter((s) => !s.isBot).map((s) => getLivePlayer(s.playerId)).filter(Boolean);
  if (!result.winnerColor) return; // a draw: nothing to say
  if (result.winnerColor === me.color) {
    setNpcMood(npc, 'smug', { i: 0.7, secs: 300 });
    say(table, npc, line(npc, 'won', 'Good game. Mostly for me.'));
    return;
  }
  setNpcMood(npc, 'angry', { i: 0.9, secs: SORE_MS / 1000, force: true });
  const P = table._practice ||= { game: null, nextMove: 0, nextLore: Date.now() + rand(LORE_MS), refused: new Set(), sitting: false };
  for (const pl of them) {
    adjustRelation(pl, npc.id, { warmth: -(Number(p.sore) || 12), reason: 'chess:beat' });
    (P.sore ||= new Map()).set(pl.id, Date.now() + SORE_MS);
  }
  say(table, npc, line(npc, 'lost', "Fine. Fine. That's fine."));
});

// ── talking through a game ────────────────────────────────────────────────────────────────────
// While they play somebody, the regular says what they think of the move just made: the position scored from their
// side before and after it (bot-chess.js evaluate, centipawns), and what the move was. A big swing their way off your
// move is your blunder; a big swing against them off yours is a good move of yours; their own capture, a check either
// way, and being well up or well down each have their own lines (`chess_lines.<key>`). They don't talk every move: at
// most one line in COMMENT_GAP_MS, and the quiet stretches are random. Their mood follows how it's going.
const COMMENT_GAP_MS = 14_000;
const SWING = 220, WAY_UP = 350;
on('chess.moved', ({ table, playerId, move, before, after }) => {
  const p = practiceOf(table);
  if (!p || !table.game || !move || !before || !after) return;
  const botId = chessBotId(p.npc), me = table.game.seatByPlayer(botId);
  const npc = world.npcs.get(p.npc);
  if (!me || !npc || table.game.isOver()) return;
  const sign = me.color === 'w' ? 1 : -1;
  const was = quickEval(before) * sign, now = quickEval(after) * sign, swing = now - was;
  const mine = playerId === botId;
  const check = inCheck(after, after.turn);
  // what happened, most telling first
  let key = null;
  if (!mine && swing >= SWING) key = 'yourBlunder';
  else if (!mine && swing <= -SWING) key = 'yourGoodMove';
  else if (check) key = mine ? 'giveCheck' : 'inCheck';
  else if (mine && move.captured) key = 'myCapture';
  else if (!mine && move.captured) key = 'lostPiece';
  else if (now >= WAY_UP) key = 'winning';
  else if (now <= -WAY_UP) key = 'losing';
  if (!key) return;
  // the mood follows the board, said or not
  if (now >= WAY_UP) setNpcMood(npc, 'smug', { i: 0.6, secs: 120 });
  else if (now <= -WAY_UP) setNpcMood(npc, 'annoyed', { i: 0.7, secs: 120 });
  const P = table._practice ||= { game: null, nextMove: 0, nextLore: Date.now() + rand(LORE_MS), refused: new Set(), sitting: false };
  const t = Date.now();
  const loud = key === 'yourBlunder' || key === 'yourGoodMove' || check;
  if (t < (P.saidAt || 0) + COMMENT_GAP_MS) return;
  if (!loud && Math.random() < 0.45) return;
  const said = line(npc, key, null);
  if (!said) return;
  P.saidAt = t;
  say(table, npc, said);
});

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
      if ((P.sore?.get(s.playerId) || 0) > now) {
        P.refused.add(s.playerId);
        say(table, npc, line(npc, 'sore', "No. I don't want to play you right now."));
        continue;
      }
      const pl = getLivePlayer(s.playerId);
      const asked = (P.invited?.get(s.playerId) || 0) > now;
      if (pl && (asked || relationAtLeast(getRelation(pl, npc.id), p.tier || 'known'))) {
        P.invited?.delete(s.playerId);
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
