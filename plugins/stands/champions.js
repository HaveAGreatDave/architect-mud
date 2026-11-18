// plugins/stands/champions.js
//
// THE LAST CHAMPION AND THE CUP'S ROLL, for a stadium's Cup room. A piece with `flags.champion_display: '<sport>'`
// shows the club that won that sport's last final: its crest and colours, lit (client gl/room-stadium.js). Nobody has
// won yet, and it stands dark and blank. A piece with `flags.cup_rolls: '<sport>'` is the Cup itself, and carries
// every winner to be engraved on it, oldest first (client gl/room-cup.js): the club, the season and the year.
//
// ⚠ RAM, FILLED ONCE. The winners per sport are read at boot from `sportsleague.getFinals` (one cached read a
// league) and kept up by the `sports.champion` event each crowning. The piece's state rides `room.pieceState`,
// which is sync, so nothing here queries when a room is drawn.

import { dispatchAction } from '../../server/engine/actions.js';
import { emit, on } from '../../server/engine/events.js';
import { getZoneFurniture } from '../../server/engine/world.js';
import { sportsClubIdentity } from '../broadcast/index.js';

const SPORTS = ['hockey', 'baseball'];
const last = new Map();      // sport -> { name, season, runnerUp }
const rolls = new Map();     // sport -> [{ name, season, year }], oldest first
const shownIn = new Set();   // zones whose display has been drawn, to send again on a crowning
// three barrels of a hundred, as many as a Cup grows (shared/cup-design.js MAX_BARRELS)
const ROLLS_KEPT = 300;

// the year of a season's 'YYYY-MM', or null for a season with no date
const yearOf = (month) => (/^\d{4}-\d{2}$/.test(month || '') && month !== '0000-00' ? Number(month.slice(0, 4)) : null);

export async function loadChampions() {
  await Promise.all(SPORTS.map(async (sport) => {
    const r = await dispatchAction({ type: 'sportsleague.getFinals', params: { sport } }).catch(() => null);
    const won = Array.isArray(r?.finals) ? r.finals.filter((f) => f.winner) : [];
    if (won.length && !last.has(sport)) last.set(sport, { name: won[0].winner, season: won[0].seasonNo || null, runnerUp: won[0].loser || null });
    if (!rolls.has(sport)) rolls.set(sport, won.map((f) => ({ name: f.winner, season: f.seasonNo || null, year: yearOf(f.month) })).reverse());
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
// Every winner of a sport's Cup, oldest first: [{ name, season, year }]
export const rollsOf = (sport) => rolls.get(sport) || [];

// A club as its banner draws it (`flags.club_banner: { sport, club }`): the name, colours and crest from the
// broadcast's club identities, or null for a club that has none.
export function clubOf(sport, name) {
  if (typeof name !== 'string' || !name) return null;
  const id = sportsClubIdentity(sport || 'baseball', name);
  return id ? { name, colours: id.colours || [], ...(id.crest ? { crest: id.crest } : {}) } : null;
}

// room.pieceState: { [pieceId]: { champ } } for every display in the room, `champ` null leaving it dark,
// { [pieceId]: { rolls } } for every Cup, and { [pieceId]: { club } } for every club's banner.
export function championPieces(zoneId) {
  let out = null;
  for (const f of getZoneFurniture(zoneId)) {
    const sport = f.flags?.champion_display, cup = f.flags?.cup_rolls, banner = f.flags?.club_banner;
    if (banner && typeof banner === 'object') { const club = clubOf(banner.sport, banner.club); if (club) (out ||= {})[f.id] = { club }; }
    if (typeof sport === 'string') { shownIn.add(zoneId); (out ||= {})[f.id] = { champ: championOf(sport), sport }; }
    if (typeof cup === 'string') { shownIn.add(zoneId); (out ||= {})[f.id] = { ...(out?.[f.id] || {}), rolls: rollsOf(cup) }; }
  }
  return out;
}

on('sports.champion', ({ sport, champion, runnerUp, seasonNo, month }) => {
  if (!sport || !champion) return;
  last.set(sport, { name: champion, season: seasonNo || null, runnerUp: runnerUp || null });
  const list = rolls.get(sport) || [];
  if (!list.some((r) => r.season && r.season === seasonNo)) rolls.set(sport, [...list, { name: champion, season: seasonNo || null, year: yearOf(month) }].slice(-ROLLS_KEPT));
  for (const zoneId of shownIn) for (const f of getZoneFurniture(zoneId)) if (f.flags?.champion_display === sport || f.flags?.cup_rolls === sport) emit('furniture.changed', { zoneId, id: f.id });
});

export const _test = { last, rolls, championOf, championPieces, rollsOf, clubOf };
