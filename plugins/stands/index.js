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
//
// ⚠ A BOX IS A TICKETED ROOM. A room with `flags.ticketed` (the box's stands zone) is shut to
// anybody without a pass for that box; a room with `flags.box_office` sells the pass with
// `stands`, at the box section's price. The pass is for today's game: it lapses when no game is
// on or after PASS_MS, and it lives in RAM, so a restart loses it. With a pass the box's chairs
// and screen cost nothing more.

import { getZone, getZoneFurniture } from '../../server/engine/world.js';
import { sendToPlayer, teachVerb } from '../../server/engine/messaging.js';
import { loggedPanelsSync } from '../../server/engine/presentation.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { emit, on } from '../../server/engine/events.js';
import { liveSportsChannel, channelLabel } from '../broadcast/index.js';
import { getWeatherFieldSnapshot } from '../../server/engine/environment.js';
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { cmdMove } from '../../server/engine/commands/movement.js';
import { getItem } from '../../server/engine/items-cache.js';

// playerId -> { zoneId, section, seat, channelId }
const seated = new Map();
// playerId -> { box, channelId, until }: a pass into a ticketed box
const passes = new Map();
const PASS_MS = 4 * 3600e3;

export function hasPass(player, box) {
  const p = passes.get(player.id);
  if (!p || p.box !== box) return false;
  const stands = standsOf(getZone(box));
  if (Date.now() > p.until || !stands || liveSportsChannel(stands.sport) !== p.channelId) { passes.delete(player.id); return false; }
  return true;
}

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

// What a room sells: its own sections, then the sections of the box its `flags.box_office` names,
// each marked with `boxId` (a ticket into that box, not a seat here). Null when it sells nothing.
function forSale(zone) {
  const own = standsOf(zone), boxId = zone?.flags?.box_office, box = boxId && standsOf(getZone(boxId));
  const sport = own?.sport || box?.sport;
  if (!sport) return null;
  return { sport, sections: [...(own?.sections || []), ...(box && box.sport === sport ? box.sections.map((c) => ({ ...c, boxId })) : [])] };
}
// Tickets into a box not held by `exceptId`.
const passesFor = (box, exceptId) => [...passes].filter(([pid, p]) => pid !== exceptId && p.box === box && Date.now() <= p.until).length;

function chartPayload(zone, stands, player) {
  const mineId = seated.get(player.id)?.section || null;
  return {
    type: 'stands_chart', sport: stands.sport, venue: zone.flags?.building_name || zone.name,
    live: !!liveSportsChannel(stands.sport), credits: player.credits | 0,
    seated: mineId,
    sections: stands.sections.map((c) => ({ id: c.id, name: c.name || c.id, price: c.price | 0, eye: c.eye, note: c.note || '',
      ...(c.boxId ? { box: true, held: hasPass(player, c.boxId) } : {}),
      free: seatsOf(stands.sport, c).length - (c.boxId ? passesFor(c.boxId, player.id) : takenIn(zone.id, c.id, player.id).size) })),
  };
}

function chartText(zone, stands, player) {
  const rows = stands.sections.map((c) => `  <b>${esc(c.name || c.id)}</b> · ₵${c.price | 0}${c.boxId ? ' · a ticket into the box' : ''}${c.note ? ` · ${esc(c.note)}` : ''}`);
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

async function cmdStands(args, raw, player, broadcast) {
  const zone = getZone(player.current_zone), stands = forSale(zone);
  const a0 = String(args[0] || '').toLowerCase();
  if (a0 === 'leave' || a0 === 'up' || a0 === 'off') {
    return leave(player) ? { type: 'noop' } : { type: 'error', message: "You aren't sitting anywhere." };
  }
  if (a0 === 'fetch') return fetchInSuite(player, args.slice(1).join(' '), broadcast);
  if (!stands) return { type: 'error', message: 'There are no seats to buy here.' };
  if (!a0) {
    // the log rung has no panels: the list in the log is the chart
    if (!loggedPanelsSync(player)) sendToPlayer(player.id, chartPayload(zone, stands, player));
    return { type: 'output', message: chartText(zone, stands, player) };
  }
  const section = findSection(stands, args.join(' '));
  if (!section) return { type: 'error', message: `There's no section called "${esc(args.join(' '))}". ${teachVerb('stands')} shows the chart.` };
  if (section.boxId) return buyPass(player, section.boxId);
  const channelId = liveSportsChannel(stands.sport);
  if (!channelId) return { type: 'error', message: 'No game on right now. The seats are empty.' };
  const was = seated.get(player.id);
  if (was && was.section === section.id && was.zoneId === zone.id) return { type: 'error', message: `You're already in ${esc(section.name)}.` };
  return takeSeat(player, zone, standsOf(zone), section, channelId);
}

// `stands fetch <thing> [item]`: the suite's 3-D view clicking its bar, buffet or the smokes on the
// table. The suite is one room on screen but two in the world (the box at the glass and the lounge
// behind it, one `flags.ticketed` box), so a thing in the other room is walked to first, which
// keeps the seat (zone.entered below). Bare, it answers with what the thing keeps in stock
// (`flags.restock_items`) as a menu (`stands_menu`); with an item id, it takes one, as
// `take <item> from <thing>` would. Everything in a box is on the house.
// How the suite's hands hold a thing off the menu (client stands-hands.js): a glass you keep, a drug
// you smoke, a mixer or spirit you pour into the glass, a drink, something to eat. Null is no ritual.
function heldAs(it) {
  const t = it.tags || {};
  if (t.drinkware) return 'glass';
  if (t.drug) return 'smoke';
  if (t.drink_profile) return 'pour';
  if (t.food_profile === 'liquid' || t.hydrating) return 'drink';
  if (t.restore_hunger) return 'eat';
  return null;
}
const sameBox = (a, b) => !!a?.flags?.ticketed && a.flags.ticketed === b?.flags?.ticketed;
const furnitureCalled = (zoneId, want) => getZoneFurniture(zoneId).find((f) => String(f.name || '').toLowerCase().includes(want) || (f.flags?.aliases || []).some((a) => String(a).toLowerCase() === want));
async function fetchInSuite(player, what, broadcast) {
  const words = String(what || '').trim().toLowerCase().split(/\s+/);
  const itemId = words[words.length - 1]?.startsWith('item_') ? words.pop() : null;
  const want = words.join(' ');
  if (!want || !seated.get(player.id)?.suite) return { type: 'error', message: "You aren't in a box." };
  const zone = getZone(player.current_zone);
  if (!furnitureCalled(zone.id, want)) {
    const exit = Object.entries(zone.exits || {}).find(([, to]) => { const id = typeof to === 'string' ? to : to?.zone || to?.to; return sameBox(zone, getZone(id)) && furnitureCalled(id, want); });
    if (!exit) return { type: 'error', message: `There's no ${esc(want)} in here.` };
    const r = await cmdMove(exit[0], player, broadcast);
    if (player.current_zone === zone.id) return r || { type: 'error', message: "You can't get over there." };
  }
  const thing = furnitureCalled(player.current_zone, want);
  const stock = (thing?.flags?.restock_items || []).map((id) => [id, getItem(id)]).filter(([, it]) => it);
  if (!itemId) {
    if (!stock.length || loggedPanelsSync(player)) {
      const { handleCommand } = await import('../../server/engine/commands/index.js');
      return handleCommand(`open ${want}`, player, broadcast);
    }
    sendToPlayer(player.id, { type: 'stands_menu', target: want, name: thing.name, description: thing.description || '',
      items: stock.map(([id, it]) => ({ id, name: it.name, description: it.tags?.description || it.description || '', kind: heldAs(it), drinkable: !!it.tags?.consumable })) });
    return { type: 'noop' };
  }
  const it = stock.find(([id]) => id === itemId)?.[1];
  if (!it) return { type: 'error', message: `There's none of that at ${esc(thing?.name || want)}.` };
  const { handleCommand } = await import('../../server/engine/commands/index.js');
  return handleCommand(`take ${it.name} from ${want}`, player, broadcast);
}

// A pass into the ticketed box `boxId`, sold at its section's price.
async function buyPass(player, boxId) {
  const box = getZone(boxId), stands = standsOf(box), section = stands?.sections[0];
  if (!section) return { type: 'error', message: 'There are no seats to buy here.' };
  const name = esc(section.name || box.name), price = section.price | 0;
  if (hasPass(player, boxId)) return { type: 'error', message: `You already have a ticket for ${name}.` };
  const channelId = liveSportsChannel(stands.sport);
  if (!channelId) return { type: 'error', message: `No game on right now. ${name} is shut.` };
  if (price > 0 && !(await adjustCredits(player, -price, undefined, 'stands'))) {
    return { type: 'error', message: `A ticket for ${name} is ₵${price}. You have ₵${player.credits | 0}.` };
  }
  passes.set(player.id, { box: boxId, channelId, until: Date.now() + PASS_MS });
  return { type: 'output', message: `<span class="msg-system">₵${price} for a ticket to <b>${name}</b>, good for today's game. The usher lets you through.</span>` };
}

// Nobody walks into a ticketed room without a pass; moving between two rooms of the same box is free.
registerMoveGate(({ player, from, to }) => {
  const box = to?.flags?.ticketed;
  if (!box || from?.flags?.ticketed === box || hasPass(player, box)) return;
  const section = standsOf(getZone(box))?.sections[0];
  return { block: true, message: `An usher stops you. ${esc(section?.name || 'The box')} is ticket holders only: ₵${section?.price | 0}, and the ticket machine sells them.` };
}, 'stands:box');

// Sits the player in a free seat of `section` and opens the view from it. `chair` is a chair in
// the room (flags.stands_section) rather than a ticket: no charge, and standing up leaves it.
async function takeSeat(player, zone, stands, section, channelId, { chair = false } = {}) {
  const seat = freeSeat(zone.id, stands.sport, section, player.id);
  if (seat < 0) return { type: 'error', message: `${esc(section.name)} is sold out. ${teachVerb('stands')} shows what's left.` };
  const where = seatsOf(stands.sport, section)[seat];
  const price = chair || hasPass(player, zone.id) ? 0 : section.price | 0;
  if (price > 0 && !(await adjustCredits(player, -price, undefined, 'stands'))) {
    return { type: 'error', message: `A seat in ${esc(section.name)} is ₵${price}. You have ₵${player.credits | 0}.` };
  }
  seated.set(player.id, { zoneId: zone.id, section: section.id, seat, channelId, chair, suite: !!section.room });
  emit('tablet_tv.watch', { playerId: player.id, channelId });
  // the log rung gets the game as log lines through the same receiver, and no picture
  if (!loggedPanelsSync(player)) sendToPlayer(player.id, { type: 'stands_open', sport: stands.sport, channelId, station: channelLabel(channelId), field: skyField(stands.sport), venue: zone.flags?.building_name || zone.name,
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
    seated.set(player.id, { zoneId: zone.id, section: null, seat: -1, channelId, screen: true, suite: true });
    emit('tablet_tv.watch', { playerId: player.id, channelId });
    if (!loggedPanelsSync(player)) sendToPlayer(player.id, { type: 'stands_open', sport: 'baseball', channelId, station: channelLabel(channelId), field: skyField('baseball'), venue: zone.flags?.building_name || zone.name,
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

// Walking into a box's suite (a section with a `room`) puts you in one of its chairs and opens the
// suite in 3-D, so nobody has to find a chair first. The suite's lounge (a screen carrying
// `flags.stands_room`) opens it on the sofa, as watching the screen does.
async function enterSuite(player, zone) {
  if (seated.get(player.id)?.zoneId === zone.id) return;
  const screen = getZoneFurniture(zone.id).find((f) => f.flags?.stands_room);
  if (screen) { sendToPlayer(player.id, { type: 'output', message: watchScreen(player, screen).message }); return; }
  const stands = standsOf(zone), section = stands?.sections.find((c) => c.room);
  if (!section) return;
  const channelId = liveSportsChannel(stands.sport);
  if (!channelId) { sendToPlayer(player.id, { type: 'output', message: '<span class="msg-system">No game on right now. The field is empty under the lights.</span>' }); return; }
  const r = await takeSeat(player, zone, stands, section, channelId, { chair: true });
  sendToPlayer(player.id, { type: 'output', message: r.message });
}

// Walking out of the room is getting up.
on('zone.entered', ({ actor, zone }) => {
  const s = actor && seated.get(actor.id);
  const z = actor && getZone(zone);
  // the suite's two rooms are one room on screen: crossing between them keeps the seat
  if (s && s.zoneId !== zone && s.suite && sameBox(getZone(s.zoneId), z)) { s.zoneId = zone; return; }
  if (s && s.zoneId !== zone) leave(actor, true);
  if (z) enterSuite(actor, z).catch((e) => console.error('[stands] suite:', e.message));
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

export const _test = { seated, passes, buyPass, leave, chartPayload, cmdStands, watchScreen, onPosture };
