// plugins/stands/champions.js
//
// THE LAST CHAMPION, for a stadium's Cup room. A piece with `flags.champion_display: '<sport>'` shows the
// club that won that sport's last final: its crest and colours, lit (client gl/room-stadium.js). Nobody has
// won yet, and it stands dark and blank.
//
// ⚠ RAM, FILLED ONCE. The winner per sport is read at boot from `sportsleague.getHistory` (one cached read a
// league) and kept up by the `sports.champion` event each crowning. The piece's state rides `room.pieceState`,
// which is sync, so nothing here queries when a room is drawn.

import { dispatchAction } from '../../server/engine/actions.js';
import { emit, on } from '../../server/engine/events.js';
import { getZoneFurniture } from '../../server/engine/world.js';
import { sportsClubIdentity } from '../broadcast/index.js';

const SPORTS = ['hockey', 'baseball'];
const last = new Map();      // sport -> { name, season, runnerUp }
const shownIn = new Set();   // zones whose display has been drawn, to send again on a crowning

export async function loadChampions() {
  await Promise.all(SPORTS.map(async (sport) => {
    const r = await dispatchAction({ type: 'sportsleague.getHistory', params: { sport } }).catch(() => null);
    const s = Array.isArray(r?.seasons) ? r.seasons.find((x) => x.champion) : null;
    if (s && !last.has(sport)) last.set(sport, { name: s.champion, season: s.seasonNo || null, runnerUp: s.runnerUp || null });
  }));
}
setTimeout(() => { loadChampions().catch((e) => console.error('[stands] champions:', e.message)); }, 12000);

// The champion as the display draws it: the club's name, colours and crest, or null when nobody has won.
export function championOf(sport) {
  const c = last.get(sport);
  if (!c) return null;
  const id = sportsClubIdentity(sport, c.name);
  return { name: c.name, season: c.season, colours: id?.colours || [], ...(id?.crest ? { crest: id.crest } : {}) };
}

// room.pieceState: { [pieceId]: { champ } } for every display in the room; `champ` null leaves it dark.
export function championPieces(zoneId) {
  let out = null;
  for (const f of getZoneFurniture(zoneId)) {
    const sport = f.flags?.champion_display;
    if (typeof sport !== 'string') continue;
    shownIn.add(zoneId);
    (out ||= {})[f.id] = { champ: championOf(sport), sport };
  }
  return out;
}

on('sports.champion', ({ sport, champion, runnerUp, seasonNo }) => {
  if (!sport || !champion) return;
  last.set(sport, { name: champion, season: seasonNo || null, runnerUp: runnerUp || null });
  for (const zoneId of shownIn) for (const f of getZoneFurniture(zoneId)) if (f.flags?.champion_display === sport) emit('furniture.changed', { zoneId, id: f.id });
});

export const _test = { last, championOf, championPieces };
