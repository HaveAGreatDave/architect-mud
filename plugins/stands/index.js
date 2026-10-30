// plugins/stands/index.js
//
// STANDS — a seat at the game, in the park it's being played in.
//
// A room carrying `flags.stands` is a place you buy a seat: `{ sport, sections: [{ id, name,
// price, eye, note }] }`. `eye` is where the seat puts your head in the 3-D view's own frame
// (feet: the rink's sheet for hockey, the field's for baseball; see client/game/js/panels/
// stands.js), so the seat chart the client draws is laid out from the same numbers the camera
// stands on, and a section can't sit on the chart somewhere its view isn't.
//
// ⚠ A SEAT IS A RECEIVER. The game you watch from the stands is the broadcast's game, the one
// the sim has already decided, so a seat tunes the player to the channel carrying it through the
// same per-player path as the Tablet TV (`tablet_tv.watch`). Nothing here plays hockey. One
// consequence: a player with the Tablet TV open on another channel loses it while seated, since
// a player is one portable receiver. Leaving puts nothing back.
//
// ⚠ A TICKET IS FOR A SECTION, NOT A SEAT. A section is a block of seats round its `eye` (the
// best one): `across` seats a row, `pitch` feet apart, and `rows` rows, each `row: [back, up]`
// feet behind and above the one in front (seatsOf). A buyer gets the free seat nearest that eye,
// so the first in has the front row's middle and a friend who buys after sits beside them. Who is
// where comes from the seated map in RAM; nothing is written.
//
// ⚠ THE TICKET IS PAID ONCE PER SEAT. Taking a seat charges its price; moving to another
// section is a new ticket. Leaving the room leaves the seat.

import { getZone, getZoneFurniture } from '../../server/engine/world.js';
import { sendToPlayer, teachVerb } from '../../server/engine/messaging.js';
import { loggedPanelsSync } from '../../server/engine/presentation.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { emit, on } from '../../server/engine/events.js';
import { liveSportsChannel } from '../broadcast/index.js';
import { getWeatherFieldSnapshot } from '../../server/engine/environment.js';

// playerId -> { zoneId, section, seat, channelId }
const seated = new Map();

// The day's weather cells for an open-air park to draw overhead (gl/ballpark.js). Sent once when
// the seat opens and again only when the field itself changes (weather.field, weather.event): the
// cells drift at a fixed speed all day, so the client moves them itself between copies. Every cell,
// not a crop round the park, because a cell out of reach now drifts over later. Query-free.
function skyField(sport) {
  if (sport !== 'baseball') return null;
  const snap = getWeatherFieldSnapshot();
  if (!snap || !snap.bounds || !snap.systems?.length) return null;
  return {
    tick: 30, bounds: snap.bounds, baseCloud: snap.baseCloud || 0,
    cells: snap.systems.map((c) => ({ x: +c.x.toFixed(2), y: +c.y.toFixed(2), r: +c.radius.toFixed(2), vx: +c.vx.toFixed(4), vy: +c.vy.toFixed(4), type: c.type, intensity: +c.intensity.toFixed(3) })),
  };
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The room's stands, when it has any worth sitting in.
export function standsOf(zone) {
  const s = zone?.flags?.stands;
  if (!s || (s.sport !== 'hockey' && s.sport !== 'baseball') || !Array.isArray(s.sections)) return null;
  const sections = s.sections.filter((c) => c && c.id && Array.isArray(c.eye) && c.eye.length === 3 && c.eye.every(Number.isFinite));
  return sections.length ? { sport: s.sport, sections } : null;
}

// A section by its id, or by the first word of its name a player is likely to type.
export function findSection(stands, word) {
  const w = String(word || '').toLowerCase().trim();
  if (!w) return null;
  return stands.sections.find((c) => c.id === w)
    || stands.sections.find((c) => String(c.name || '').toLowerCase() === w)
    || stands.sections.find((c) => String(c.name || '').toLowerCase().split(/\W+/).includes(w))
    || null;
}

// The field's middle in each frame, in its two ground axes, which the rows step away from.
const FRAME = {
  hockey: { ground: [0, 1], up: 2, mid: [100, 42.5], row: [2.7, 1.4] },
  baseball: { ground: [0, 2], up: 1, mid: [0, 60], row: [2.7, 1.3] },
};
const SEAT_DEFAULTS = { across: 7, rows: 3, pitch: 2 };

// A section's seats, nearest its eye first: [{ eye, row, number }], row 0 the front. Cached by
// the section object, which is replaced whenever the zone is.
const seatCache = new WeakMap();
export function seatsOf(sport, section) {
  const hit = seatCache.get(section);
  if (hit) return hit;
  const F = FRAME[sport], [ga, gb] = F.ground, e = section.eye;
  const across = Math.max(1, (section.across ?? SEAT_DEFAULTS.across) | 0), rows = Math.max(1, (section.rows ?? SEAT_DEFAULTS.rows) | 0);
  const pitch = Number(section.pitch) || SEAT_DEFAULTS.pitch, [back, up] = Array.isArray(section.row) ? section.row : F.row;
  let ox = e[ga] - F.mid[0], oz = e[gb] - F.mid[1];
  const l = Math.hypot(ox, oz) || 1; ox /= l; oz /= l;
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < across; c++) {
      const side = c - (across - 1) / 2, p = e.slice();
      p[ga] += ox * back * r - oz * pitch * side;
      p[gb] += oz * back * r + ox * pitch * side;
      p[F.up] += up * r;
      out.push({ eye: p.map((v) => Math.round(v * 100) / 100), row: r, number: c + 1, d: Math.hypot(back * r, pitch * side) });
    }
  }
  out.sort((a, b) => a.d - b.d || a.row - b.row || a.number - b.number);
  seatCache.set(section, out);
  return out;
}

// The seats somebody's in, in this room's section, other than `exceptId`.
function takenIn(zoneId, sectionId, exceptId) {
  const t = new Set();
  for (const [pid, s] of seated) if (pid !== exceptId && s.zoneId === zoneId && s.section === sectionId) t.add(s.seat);
  return t;
}
// The free seat nearest the section's eye, as its index into seatsOf, or -1 when it's full.
export function freeSeat(zoneId, sport, section, exceptId) {
  const taken = takenIn(zoneId, section.id, exceptId), seats = seatsOf(sport, section);
  for (let i = 0; i < seats.length; i++) if (!taken.has(i)) return i;
  return -1;
}
const ROW = (r) => String.fromCharCode(65 + r);

function chartPayload(zone, stands, player) {
  return {
    type: 'stands_chart', sport: stands.sport, venue: zone.flags?.building_name || zone.name,
    live: !!liveSportsChannel(stands.sport), credits: player.credits | 0,
    seated: seated.get(player.id)?.section || null,
    sections: stands.sections.map((c) => ({ id: c.id, name: c.name || c.id, price: c.price | 0, eye: c.eye, note: c.note || '',
      free: seatsOf(stands.sport, c).length - takenIn(zone.id, c.id, player.id).size })),
  };
}

function chartText(zone, stands, player) {
  const rows = stands.sections.map((c) => `  <b>${esc(c.name || c.id)}</b> · ₵${c.price | 0}${c.note ? ` · ${esc(c.note)}` : ''}`);
  const live = liveSportsChannel(stands.sport);
  return `<span class="msg-system">${esc(zone.flags?.building_name || zone.name)}: the seats.<br>${rows.join('<br>')}<br>`
    + `${live ? `${teachVerb('stands')} &lt;section&gt; buys one.` : 'No game on right now.'} You have ₵${player.credits | 0}.</span>`;
}

function leave(player, quiet = false) {
  const s = seated.get(player.id);
  if (!s) return false;
  seated.delete(player.id);
  emit('tablet_tv.unwatch', { playerId: player.id });
  sendToPlayer(player.id, { type: 'stands_close' });
  if (!quiet) sendToPlayer(player.id, { type: 'output', message: '<span class="msg-system">You get up out of your seat.</span>' });
  return true;
}

async function cmdStands(args, raw, player) {
  const zone = getZone(player.current_zone), stands = standsOf(zone);
  const a0 = String(args[0] || '').toLowerCase();
  if (a0 === 'leave' || a0 === 'up' || a0 === 'off') {
    return leave(player) ? { type: 'noop' } : { type: 'error', message: "You aren't sitting anywhere." };
  }
  if (!stands) return { type: 'error', message: 'There are no seats to buy here.' };
  if (!a0) {
    // the log rung has no panels: the list in the log is the chart
    if (!loggedPanelsSync(player)) sendToPlayer(player.id, chartPayload(zone, stands, player));
    return { type: 'output', message: chartText(zone, stands, player) };
  }
  const section = findSection(stands, args.join(' '));
  if (!section) return { type: 'error', message: `There's no section called "${esc(args.join(' '))}". ${teachVerb('stands')} shows the chart.` };
  const channelId = liveSportsChannel(stands.sport);
  if (!channelId) return { type: 'error', message: 'No game on right now. The seats are empty.' };
  const was = seated.get(player.id);
  if (was && was.section === section.id && was.zoneId === zone.id) return { type: 'error', message: `You're already in ${esc(section.name)}.` };
  return takeSeat(player, zone, stands, section, channelId);
}

// Sits the player in a free seat of `section` and opens the view from it. `chair` is a chair in
// the room (flags.stands_section) rather than a ticket: no charge, and standing up leaves it.
async function takeSeat(player, zone, stands, section, channelId, { chair = false } = {}) {
  const seat = freeSeat(zone.id, stands.sport, section, player.id);
  if (seat < 0) return { type: 'error', message: `${esc(section.name)} is sold out. ${teachVerb('stands')} shows what's left.` };
  const where = seatsOf(stands.sport, section)[seat];
  const price = chair ? 0 : section.price | 0;
  if (price > 0 && !(await adjustCredits(player, -price, undefined, 'stands'))) {
    return { type: 'error', message: `A seat in ${esc(section.name)} is ₵${price}. You have ₵${player.credits | 0}.` };
  }
  seated.set(player.id, { zoneId: zone.id, section: section.id, seat, channelId, chair });
  emit('tablet_tv.watch', { playerId: player.id, channelId });
  // the log rung gets the game as log lines through the same receiver, and no picture
  if (!loggedPanelsSync(player)) sendToPlayer(player.id, { type: 'stands_open', sport: stands.sport, channelId, field: skyField(stands.sport), venue: zone.flags?.building_name || zone.name,
    section: { id: section.id, name: section.name || section.id, eye: where.eye, seat: `Row ${ROW(where.row)}, seat ${where.number}`, ...(section.room ? { room: section.room } : {}) } });
  if (chair) return { type: 'output', message: `<span class="msg-system">You take chair ${where.number} in row ${ROW(where.row)}, and the game is in front of you. ${teachVerb('stand')} gets you up.</span>` };
  const moved = seat > 0 ? ' The best seat in it is taken, so the usher puts you in the nearest one free.' : '';
  return { type: 'output', message: `<span class="msg-system">₵${price} for a seat in <b>${esc(section.name)}</b>: row ${ROW(where.row)}, seat ${where.number}.${moved} You sit down. ${teachVerb('stands leave')} gets you up.</span>` };
}

// A big screen (`flags.stands_screen` on furniture) shows the room's sport, or the one the flag
// names, from the broadcast's own cameras in 3-D: the seat's view with no seat under the camera.
// A screen in a box's suite (`flags.stands_room`, the zone whose section carries the `room`) opens
// the suite instead, on the sofa in front of it, where the screen shows the game and the glass the
// park; the client's big-screen button is the plain picture.
function watchScreen(player, screen) {
  const zone = getZone(player.current_zone);
  const box = screen.flags.stands_room && standsOf(getZone(screen.flags.stands_room));
  const suite = box && box.sport === 'baseball' && box.sections.find((c) => c.room);
  if (suite) {
    const channelId = liveSportsChannel('baseball');
    if (!channelId) return { type: 'output', message: `<span class="msg-system">${esc(screen.name)} shows the park empty under the lights. No game on right now.</span>` };
    leave(player, true);
    seated.set(player.id, { zoneId: zone.id, section: null, seat: -1, channelId, screen: true });
    emit('tablet_tv.watch', { playerId: player.id, channelId });
    if (!loggedPanelsSync(player)) sendToPlayer(player.id, { type: 'stands_open', sport: 'baseball', channelId, field: skyField('baseball'), venue: zone.flags?.building_name || zone.name,
      section: { id: suite.id, name: suite.name || suite.id, room: suite.room, spot: 'sofa' } });
    return { type: 'output', message: `<span class="msg-system">You sit down on the sofa in front of ${esc(screen.name)}. The game's on it, and through the glass. ${teachVerb('stands leave')} gets you up.</span>` };
  }
  const sport = standsOf(zone)?.sport || (screen.flags.stands_screen === 'hockey' ? 'hockey' : 'baseball');
  const channelId = liveSportsChannel(sport);
  if (!channelId) return { type: 'output', message: `<span class="msg-system">${esc(screen.name)} shows the park empty under the lights. No game on right now.</span>` };
  leave(player, true);
  seated.set(player.id, { zoneId: zone.id, section: null, seat: -1, channelId, screen: true });
  emit('tablet_tv.watch', { playerId: player.id, channelId });
  if (!loggedPanelsSync(player)) sendToPlayer(player.id, { type: 'stands_open', sport, channelId, screen: true, field: skyField(sport), venue: zone.flags?.building_name || zone.name,
    section: { id: 'screen', name: String(screen.name).replace(/^the /i, '') } });
  return { type: 'output', message: `<span class="msg-system">You watch ${esc(screen.name)}. ${teachVerb('stands leave')} looks away.</span>` };
}

// Sitting in a box chair (`flags.stands_section` on furniture) takes a seat in that section for
// nothing; getting up out of it leaves.
async function onPosture({ player, to }) {
  if (!player) return;
  if (to !== 'sitting') { if (seated.get(player.id)?.chair) leave(player, true); return; }
  const zone = getZone(player.current_zone), stands = standsOf(zone);
  if (!stands) return;
  const chair = getZoneFurniture(zone.id).find((f) => f.flags?.stands_section && f.name === player.sittingOn);
  const section = chair && findSection(stands, chair.flags.stands_section);
  if (!section) return;
  const channelId = liveSportsChannel(stands.sport);
  if (!channelId) { sendToPlayer(player.id, { type: 'output', message: '<span class="msg-system">No game on right now. The field is empty under the lights.</span>' }); return; }
  const r = await takeSeat(player, zone, stands, section, channelId, { chair: true });
  sendToPlayer(player.id, { type: 'output', message: r.message });
}
on('posture.changed', (p) => { onPosture(p).catch((e) => console.error('[stands] posture:', e.message)); });

// Walking out of the room is getting up.
on('zone.entered', ({ actor, zone }) => {
  const s = actor && seated.get(actor.id);
  if (s && s.zoneId !== zone) leave(actor, true);
});
on('player.logout', ({ id }) => { if (id) seated.delete(id); });

// A fresh copy of the sky to whoever's in an open-air park's seats, when the cells are reseeded
// or moved or a weather event changes the cloud
function resendSky() {
  for (const [id, s] of seated) {
    const field = skyField(standsOf(getZone(s.zoneId))?.sport);
    if (field) sendToPlayer(id, { type: 'stands_sky', field });
  }
}
on('weather.field', resendSky);
on('weather.event', resendSky);

export const commands = { stands: cmdStands };

// A ticket machine (`flags.ticket_machine` on furniture in a stands room) is the
// same chart behind a thing you can walk up to: `use ticket machine` is `stands`.
// Tag-gated so examining it advertises `use`; undefined falls through to the
// inventory `use` builtin when the target isn't a machine here.
export const specializedActions = [{
  verb: 'use',
  requiredTag: 'ticket_machine',
  handler: async (args, raw, player) => {
    const word = args.join(' ').toLowerCase().trim();
    if (!word) return undefined;
    const machine = getZoneFurniture(player.current_zone).find(f => f.flags?.ticket_machine
      && [f.name, ...(f.flags.aliases || [])].some(n => String(n).toLowerCase().includes(word)));
    if (!machine) return undefined;
    return cmdStands([], raw, player);
  },
}, {
  verb: 'use',
  requiredTag: 'stands_screen',
  handler: async (args, raw, player) => screenNamed(player, args),
}];

// The big screen in the room that `args` names (`watch tv`, `use the big screen`), watched.
// `watch` belongs to interactions (and broadcast), which ask here first through the `watch.furniture` hook.
function screenNamed(player, args) {
  const word = args.join(' ').toLowerCase().replace(/^(the|at|on)\s+/, '').trim();
  if (!word) return undefined;
  const screen = getZoneFurniture(player.current_zone).find(f => f.flags?.stands_screen
    && [f.name, ...(f.flags.aliases || [])].some(n => String(n).toLowerCase().includes(word)));
  return screen ? watchScreen(player, screen) : undefined;
}
export const hooks = { 'watch.furniture': ({ player, args }) => screenNamed(player, args || []) };

export const _test = { seated, leave, chartPayload, cmdStands, watchScreen, onPosture };
