// plugins/stands/regulars.js
//
// A REGULAR IN THEIR OWN SEAT. An NPC with `flags.regular` goes to a game some nights and sits in a seat of
// their own: in the stands room from when their sport's game comes on the air until it goes off, then home.
// Venue-agnostic: nothing here names a building or a person.
//
//   flags.regular = { sport, stands, seat, every?, club?, say? }
//   - `sport`: whose games ('baseball'); `stands`: the stands zone; `seat`: the piece they sit in there;
//   - `every`: they come to one game in this many (4 by default), picked off the game's slot and their id, so
//     the same nights every time and on every server;
//   - always to the season's opener (sportsSeasonOpener), and to the final only when `club` is in it;
//   - `say`: { arrive, leave } lines for the stands, `{name}` their name (plain ones here otherwise).
//
// ⚠ RAM AND THE CLOCK, as the ice crew (crew.js): a scheduler tick idle-gated on players reads the live game
// (sportsGamesAhead) and moves the NPC in RAM. Nothing is written. A restart mid-game puts them home, and the
// next tick takes them back to the game.

import { world, moveNpcToZone } from '../../server/engine/world.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { emit } from '../../server/engine/events.js';
import { schedule } from '../../server/engine/scheduler.js';
import { sportsGamesAhead, sportsSeasonOpener } from '../broadcast/index.js';

const SAY = {
  arrive: '{name} comes down the steps, shakes a few hands on the way and sits in his seat behind home plate.',
  leave: '{name} gets up, buttons his jacket and makes his way out.',
};

// murmur3's finaliser over the slot and the id, so neighbouring slots don't fall together
function mix(h) { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; }
function hashOf(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return mix(h); }

// Whether a regular comes to the game `g` ({ slot, away, home, final }). Pure.
export function attends(r, id, g, opener = false) {
  if (!g) return false;
  if (g.final) return !!r.club && (g.away === r.club || g.home === r.club);
  if (opener) return true;
  const every = Math.max(1, Math.round(Number(r.every) || 4));
  return hashOf(`${id}|${g.slot}`) % every === 0;
}

let regs = null, regsN = -1;
function regulars() {
  if (regsN !== world.npcs.size) { regs = [...world.npcs.values()].filter((n) => n?.flags?.regular?.stands && n.flags.regular.seat); regsN = world.npcs.size; }
  return regs;
}
const there = new Set();   // ids at a game now
function line(n, key, zoneId) {
  const s = String(n.flags.regular.say?.[key] || SAY[key]).replace(/\{name\}/g, n.name || 'Somebody');
  sendToZone(zoneId, { type: 'zone_event', message: s });
}
function move(n, to) { const from = n.zone_id; if (from !== to && moveNpcToZone(n.id, to)) emit('npc.moved', { npc: n, from, to }); }

// One step for every regular. `gameOf` and `openerOf` are for the regress, which stages a game.
export function regularsTick(gameOf = (sport) => sportsGamesAhead(sport, 1)[0], openerOf = sportsSeasonOpener) {
  for (const n of regulars()) {
    if (n._dead) continue;
    const r = n.flags.regular, sport = r.sport || 'baseball', g = gameOf(sport);
    const live = g?.now ? g : null, go = !!live && attends(r, n.id, live, openerOf(sport, live.slot));
    if (go && !there.has(n.id)) {
      there.add(n.id);
      move(n, r.stands); line(n, 'arrive', r.stands);
      emit('room.peopleChanged', { zoneId: r.stands });
    } else if (!go && there.has(n.id)) {
      there.delete(n.id);
      line(n, 'leave', r.stands);
      if (n.home_zone) move(n, n.home_zone);
      emit('room.peopleChanged', { zoneId: r.stands });
    }
  }
}
schedule('10s', () => regularsTick());

// Where a regular is drawn in the stands (`room.npcStage`): in their seat. Null when it isn't theirs to say.
export function regularStage(n, zoneId) {
  const r = n?.flags?.regular;
  if (!r || zoneId !== r.stands || !there.has(n.id)) return null;
  return { posture: 'sitting', on: r.seat };
}

export const _test = { attends, regularsTick, regularStage, there, reset: () => { there.clear(); regsN = -1; } };
