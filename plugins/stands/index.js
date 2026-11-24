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
// ⚠ A TICKET IS A SEAT AT ONE GAME, AND YOU CARRY IT (tickets.js). A section is a block of seats
// round its `eye` (the best one): `across` seats a row, `pitch` feet apart, and `rows` rows, each
// `row: [back, up]` feet behind and above the one in front (seatsOf). A buyer gets the unsold seat
// nearest that eye, so the first in has the front row's middle and a friend who buys after sits
// beside them. A ticket is bought at a box office (`flags.ticket_window` on a piece), a seat door
// (`flags.seat_door`) or the seat itself (`stands <section>`, which buys one for the game on now and
// sits you on it), and `stands ticket <id>` sits you on one you hold, walking you through the door
// first when you're outside. Sitting tears the stub. Leaving the room leaves the seat, and the torn
// stub gets you back to it for that game.
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
import { liveSportsChannel, channelLabel, startSportsRerun, stopSportsRerun, venueRoofOf } from '../broadcast/index.js';
import { getWeatherFieldSnapshot } from '../../server/engine/environment.js';
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { cmdMove } from '../../server/engine/commands/movement.js';
import { getItem } from '../../server/engine/items-cache.js';
import { query } from '../../server/models/db.js';
import { isStaff } from '../admin/index.js';
import { isStackable } from '../../server/engine/tags.js';
import { giveItemById } from '../../server/engine/inventory.js';
import { world } from '../../server/engine/world.js';
import { liveSportsSlot, sportsGamesAhead } from '../broadcast/index.js';
import { GAMES_AHEAD, soldIn, ticketsOf, ticketFor, ticketById, issue, confirm, tear, seatLabel, forgetBefore } from './tickets.js';
import { championPieces } from './champions.js';
import { crewStage, crewVehicles } from './crew.js';
import { regularStage } from './regulars.js';

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
  return sections.length ? { sport: s.sport, sections, menu: Array.isArray(s.menu) ? s.menu : [] } : null;
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
      free: seatsOf(stands.sport, c).length - (c.boxId ? passesFor(c.boxId, player.id) : unsoldTaken(zone.id, stands.sport, c, liveSportsSlot(stands.sport), player.id).size) })),
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
  stopSportsRerun(player.id);
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
  if (a0 === 'order') return orderAtSeat(player, args[1]);
  if (a0 === 'ticket' || a0 === 'tickets') return sitOnTicket(player, args[1], broadcast);
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
  // a seat is a ticket: the one you hold for this section tonight, or one bought here and now
  const own = standsOf(zone), slot = liveSportsSlot(own.sport);
  let t = slot != null ? ticketFor(player.id, zone.id, slot, section.id) : null;
  let bought = '';
  if (!t) {
    const game = sportsGamesAhead(own.sport, 1)[0];
    if (!game?.now) return { type: 'error', message: 'No game on right now. The seats are empty.' };
    const r = await sellTicket(player, zone, own, section, game);
    if (r.error) return { type: 'error', message: r.error };
    t = r.ticket; bought = `₵${r.price} for a ticket. `;
  }
  return seatOnTicket(player, zone, own, section, t, channelId, bought);
}

// ── Tickets (tickets.js) ────────────────────────────────────────────────────────
// The seats taken in a section for a game: sold on a ticket, or somebody sat in one.
function unsoldTaken(zoneId, sport, section, slot, exceptId) {
  const t = slot != null ? soldIn(zoneId, slot, section.id) : new Set();
  for (const i of takenIn(zoneId, section.id, exceptId)) t.add(i);
  return t;
}
const pad2 = (n) => String(Math.floor(n)).padStart(2, '0');
// When a game is, as a stub has it: "on now", "today at 20:00", "tomorrow at 15:00"
export function whenOf(g) {
  if (g.now) return 'on now';
  const at = `${pad2(g.hour)}:${pad2((g.hour % 1) * 60)}`;
  return g.days === 0 ? `today at ${at}` : g.days === 1 ? `tomorrow at ${at}` : `in ${g.days} days at ${at}`;
}
const gameName = (g) => `${g.away} at ${g.home}${g.final ? ', the final' : ''}`;
// Sells the unsold seat nearest `section`'s eye for game `g` (sportsGamesAhead): { ticket, price } or { error }.
async function sellTicket(player, venue, stands, section, g) {
  const seats = seatsOf(stands.sport, section), taken = unsoldTaken(venue.id, stands.sport, section, g.slot, null);
  const i = seats.findIndex((_, k) => !taken.has(k));
  if (i < 0) return { error: `${esc(section.name)} is sold out for ${esc(gameName(g))}.` };
  const price = section.price | 0;
  if (price > 0 && !(await adjustCredits(player, -price, undefined, 'stands'))) return { error: `A ticket in ${esc(section.name)} is ₵${price}. You have ₵${player.credits | 0}.` };
  const where = seats[i];
  forgetBefore(g.slot - 2);
  const ticket = await issue(player.id, { venue: venue.id, slot: g.slot, sport: stands.sport, section: section.id, name: section.name || section.id, i, row: ROW(where.row), seat: where.number,
    game: gameName(g), when: whenOf(g), torn: false });
  sendTickets(player);
  return { ticket, price };
}
// Sits the player on ticket `t` (already theirs, and for the game on now) in `zone`, tearing the stub.
async function seatOnTicket(player, zone, stands, section, t, channelId, bought = '') {
  const r = await takeSeat(player, zone, stands, section, channelId, { ticket: t });
  if (r.type === 'error') return r;
  const torn = t.torn;
  if (!torn) { await tear(player.id, t); sendTickets(player); }
  const line = `${bought}You ${torn ? 'show the usher your torn stub' : 'hand the usher your ticket and he tears it'}: ${esc(section.name)}, Row ${t.row}, Seat ${t.seat}. You sit down. ${teachVerb('stands leave')} gets you up.`;
  return { type: 'output', message: `<span class="msg-system">${line}</span>` };
}
// `stands ticket [id]`: bare, your tickets; with one, sat on it. From outside its stands (at a seat door, say)
// you're walked through the door that leads there first, as fetchInSuite walks you to the bar.
async function sitOnTicket(player, id, broadcast) {
  const mine = ticketsOf(player.id);
  if (!id) {
    if (!mine.length) return { type: 'output', message: '<span class="msg-system">You have no tickets.</span>' };
    const rows = mine.map((t, k) => `  <b>${k + 1}</b>. ${esc(seatLabel(t))} · ${esc(t.game)}, ${esc(t.when)}${t.torn ? ' · torn' : ''}`);
    return { type: 'output', message: `<span class="msg-system">Your tickets:<br>${rows.join('<br>')}<br>${teachVerb('stands ticket')} and the ticket's number sits you on it.</span>` };
  }
  // a row id from the Stage's card, or the ticket's number in that list
  let t = ticketById(player.id, id) || (/^\d{1,2}$/.test(String(id)) ? mine[parseInt(id, 10) - 1] : null) || null;
  if (!t) return { type: 'error', message: "You don't have that ticket." };
  t = await confirm(player.id, t);
  if (!t) { sendTickets(player); return { type: 'error', message: "You don't have that ticket on you." }; }
  const venue = getZone(t.venue), stands = standsOf(venue), section = stands && findSection(stands, t.section);
  if (!section) return { type: 'error', message: "Those seats aren't there any more." };
  const slot = liveSportsSlot(stands.sport), channelId = liveSportsChannel(stands.sport);
  if (slot == null || !channelId) return { type: 'error', message: `That's for ${esc(t.game)}, ${esc(t.when)}. No game on right now.` };
  if (t.slot !== slot) return { type: 'error', message: t.slot < slot ? `That stub is from ${esc(t.game)}. That game's been and gone.` : `That's for ${esc(t.game)}, ${esc(t.when)}. Not this one.` };
  const was = seated.get(player.id);
  if (was && was.zoneId === venue.id && was.seat === t.i && was.section === section.id) return { type: 'error', message: "You're already in that seat." };
  if (player.current_zone !== venue.id) {
    const here = getZone(player.current_zone);
    const exit = Object.entries(here?.exits || {}).find(([, to]) => (typeof to === 'string' ? to : to?.zone || to?.to) === venue.id);
    if (!exit) return { type: 'error', message: `That's a seat in ${esc(venue.flags?.building_name || venue.name)}. You'll have to go there.` };
    const r = await cmdMove(exit[0], player, broadcast);
    if (player.current_zone !== venue.id) return r || { type: 'error', message: "You can't get through." };
  }
  return seatOnTicket(player, venue, stands, section, t, channelId);
}

// What a room sells tickets at: its seat doors and ticket windows, each with the stands it sells and their
// sections. `flags.seat_door` is { stands, sections, label }; `flags.ticket_window` is { stands, staffed } and
// sells every section.
export function sellersIn(zoneId) {
  const out = [];
  for (const f of getZoneFurniture(zoneId)) {
    const d = f.flags?.seat_door || f.flags?.ticket_window;
    const venue = d?.stands && getZone(d.stands), stands = venue && standsOf(venue);
    if (!stands) continue;
    const want = f.flags.seat_door && Array.isArray(d.sections) ? d.sections : null;
    const sections = want ? stands.sections.filter((c) => want.includes(c.id)) : stands.sections;
    if (sections.length) out.push({ piece: f, venue, stands, sections, door: !!f.flags.seat_door });
  }
  return out;
}
const calledBy = (f, words) => [f.name, ...(Array.isArray(f.flags?.aliases) ? f.flags.aliases : [])].some((n) => String(n).toLowerCase() === words || String(n).toLowerCase().includes(words));
// `buyticket [where] [section@slot | section [n]]`: bare at a seller, its picker (`stands_menu` with `buy`),
// which sends the section and the game back. Typed, a section's name and the game's number from the list.
async function cmdBuyTicket(args, raw, player) {
  const words = args.map((a) => String(a).toLowerCase());
  const pickAt = words.findIndex((w) => /^[a-z0-9_]+@\d+$/.test(w));
  const pick = pickAt >= 0 ? words.splice(pickAt, 1)[0] : null;
  const all = sellersIn(player.current_zone);
  if (!all.length) return { type: 'error', message: 'There are no tickets sold here.' };
  // the seller the first words name (`buyticket upper tier door`), else the first one here; the rest is the section
  let seller = null, rest = words;
  for (let n = words.length; n > 0 && !seller; n--) {
    const w = words.slice(0, n).join(' ');
    seller = all.find((s) => calledBy(s.piece, w)) || null;
    if (seller) rest = words.slice(n);
  }
  seller ||= all[0];
  const shut = sellerShut(seller.piece);
  if (shut) return { type: 'error', message: shut };
  const games = sportsGamesAhead(seller.stands.sport, GAMES_AHEAD);
  if (!games.length) return { type: 'error', message: 'There are no games coming up.' };
  let section = null, game = null;
  if (pick) {
    const [sid, slot] = pick.split('@');
    section = seller.sections.find((c) => c.id === sid) || null;
    game = games.find((g) => g.slot === Number(slot)) || null;
    if (!section || !game) return { type: 'error', message: "Those seats aren't on sale here any more." };
  } else if (rest.length) {
    const n = /^\d+$/.test(rest[rest.length - 1]) ? parseInt(rest.pop(), 10) : 1;
    section = findSection({ sections: seller.sections }, rest.join(' '));
    game = games[n - 1] || null;
    if (!section) return { type: 'error', message: `They don't sell "${esc(rest.join(' '))}" here. ${teachVerb('buyticket')} shows what they do.` };
    if (!game) return { type: 'error', message: `There are only ${games.length} games on sale.` };
  }
  if (!section) {
    if (loggedPanelsSync(player)) {
      const lines = games.map((g, k) => `  <b>${k + 1}</b>. ${esc(gameName(g))}, ${esc(whenOf(g))}`);
      const secs = seller.sections.map((c) => `  <b>${esc(c.name || c.id)}</b> · ₵${c.price | 0}${c.note ? ` · ${esc(c.note)}` : ''}`);
      return { type: 'output', message: `<span class="msg-system">${esc(seller.piece.name)}. The games:<br>${lines.join('<br>')}<br>The seats:<br>${secs.join('<br>')}<br>${teachVerb('buyticket')} &lt;section&gt; [game] buys one. You have ₵${player.credits | 0}.</span>` };
    }
    const label = (g) => `${g.now ? 'On now' : whenOf(g).replace(/^./, (c) => c.toUpperCase())}: ${gameName(g)}`;
    const items = games.flatMap((g) => seller.sections.map((c) => {
      const left = seatsOf(seller.stands.sport, c).length - unsoldTaken(seller.venue.id, seller.stands.sport, c, g.slot, null).size;
      return { id: `${c.id}@${g.slot}`, name: c.name || c.id, description: left > 0 ? `${c.note ? `${c.note}. ` : ''}${left} left` : 'Sold out', price: c.price | 0, group: label(g) };
    }));
    sendToPlayer(player.id, { type: 'stands_menu', target: seller.piece.name, name: seller.piece.name, description: 'A seat at one game. The ticket says which, and you can hold as many as you like.',
      buy: `buyticket ${String(seller.piece.name).toLowerCase()}`, credits: player.credits | 0, groups: games.map(label), items });
    return { type: 'noop' };
  }
  const r = await sellTicket(player, seller.venue, seller.stands, section, game);
  if (r.error) return { type: 'error', message: r.error };
  const t = r.ticket;
  const sit = game.now ? ` ${teachVerb(`stands ticket ${t.id}`)} sits you on it.` : '';
  return { type: 'output', message: `<span class="msg-system">₵${r.price} for a ticket to ${esc(t.game)}, ${esc(t.when)}: ${esc(seatLabel(t))}. It goes in your pocket.${sit}</span>` };
}
// A window that needs somebody behind it (`flags.ticket_window.staffed`) is shut while nobody's posted at it.
function sellerShut(piece) {
  if (!piece.flags?.ticket_window?.staffed) return null;
  const zone = world.zones.get(piece.zone_id);
  const there = [...(zone?.npcs || [])].map((id) => world.npcs.get(id)).some((n) => n && !n._dead && n.flags?.post === piece.id);
  return there ? null : `Nobody's at ${esc(piece.name)}. The grille is down.`;
}
// Your tickets as the Room Stage shows them on a seat door's card (`room_tickets`, and `tickets` on `room_view`):
// every one for a game that hasn't been, `now` on those for the game on now
export function ticketsView(playerId) {
  const out = [];
  for (const t of ticketsOf(playerId)) {
    const sport = getZone(t.venue)?.flags?.stands?.sport, live = sport ? liveSportsSlot(sport) : null;
    if (live != null && t.slot < live) continue;
    out.push({ id: t.id, venue: t.venue, section: t.section, label: seatLabel(t), game: t.game, when: t.when, torn: !!t.torn, now: t.slot === live, cmd: `stands ticket ${t.id}` });
  }
  return out;
}
function sendTickets(player) { if (!loggedPanelsSync(player)) sendToPlayer(player.id, { type: 'room_tickets', tickets: ticketsView(player.id) }); }

// `stands fetch <thing> [item]`: the suite's 3-D view clicking its bar, buffet or the smokes on the
// table. The suite is one room on screen but two in the world (the box at the glass and the lounge
// behind it, one `flags.ticketed` box), so a thing in the other room is walked to first, which
// keeps the seat (zone.entered below). Bare, it answers with what the thing keeps in stock
// (`flags.restock_items`) as a menu (`stands_menu`); with an item id, it takes one, as
// `take <item> from <thing>` would. Everything in a box is on the house.
// How the suite's hands hold a thing off the menu (client stands-hands.js): a glass you keep, a drug
// you smoke, a mixer or spirit you pour into the glass, a drink, something to eat. Null is no ritual.
export function heldAs(it) {
  const t = it.tags || {};
  if (t.drinkware) return 'glass';
  if (t.drug) return 'smoke';
  if (t.drink_profile) return 'pour';
  if (t.food_profile === 'liquid' || t.hydrating) return 'drink';
  if (t.restore_hunger) return 'eat';
  return null;
}
// The lighter you light a smoke with in first person (stands-hands.js lighterStyle): the look off the
// best lighter you carry (item tags.lighter, highest `rank` first), or null for the plain chrome
// zippo everybody has. Lighters are collectable; a lighter is only ever a look, it never gates a smoke.
// One query, asked only when something is handed to you, never per beat.
export async function lighterOf(playerId) {
  const { rows } = await query(`SELECT item_id FROM player_inventory WHERE player_id=$1`, [playerId]).catch(() => ({ rows: [] }));
  let best = null;
  for (const r of rows) {
    const L = getItem(r.item_id)?.tags?.lighter;
    if (L && typeof L === 'object' && (!best || (L.rank | 0) > (best.rank | 0))) best = L;
  }
  return best;
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
    const lighter = stock.some(([, it]) => heldAs(it) === 'smoke') ? await lighterOf(player.id) : null;
    sendToPlayer(player.id, { type: 'stands_menu', target: want, name: thing.name, description: thing.description || '',
      items: stock.map(([id, it]) => ({ id, name: it.name, description: it.tags?.description || it.description || '', kind: heldAs(it), drinkable: !!it.tags?.consumable, ...(lighter && heldAs(it) === 'smoke' ? { lighter } : {}) })) });
    return { type: 'noop' };
  }
  const it = stock.find(([id]) => id === itemId)?.[1];
  if (!it) return { type: 'error', message: `There's none of that at ${esc(thing?.name || want)}.` };
  const { handleCommand } = await import('../../server/engine/commands/index.js');
  return handleCommand(`take ${it.name} from ${want}`, player, broadcast);
}

// `stands order [item]`: the concessions, ordered from the cupholder on your armrest. The room's
// stands carry the menu (`flags.stands.menu`, [{ item, price, group? }]). Bare, it answers with the
// whole menu (`stands_menu`, target 'order'), each item filed under food, drinks, cigarettes or
// cigars; with an item id, it pays and a runner brings it. A box has its own bar and buffet, so the
// concessions don't come up there.
export const CONCESSION_GROUPS = ['food', 'drinks', 'cigarettes', 'cigars'];
export function concessionGroup(it, given) {
  if (CONCESSION_GROUPS.includes(given)) return given;
  if (it.tags?.drug) return /cigar(?!ette)/i.test(it.name || '') ? 'cigars' : 'cigarettes';
  return it.tags?.restore_hunger && !it.tags?.hydrating ? 'food' : 'drinks';
}
// how a seat holds what it buys: as a box holds it, but a drinkable mixer (a can of cola) is just drunk
const seatKind = (it) => { const held = heldAs(it); return held === 'pour' && it.tags?.consumable ? 'drink' : held; };
async function orderAtSeat(player, itemId) {
  const s = seated.get(player.id);
  if (!s || s.suite) return { type: 'error', message: s ? "Help yourself. It's all on the house up here." : "You aren't in a seat." };
  const menu = (standsOf(getZone(s.zoneId))?.menu || []).map((m) => ({ ...m, it: getItem(m.item) })).filter((m) => m.it)
    .map((m) => ({ ...m, group: concessionGroup(m.it, m.group) }));
  if (!menu.length) return { type: 'error', message: 'Nothing is for sale in this section.' };
  if (!itemId) {
    if (loggedPanelsSync(player)) {
      const line = CONCESSION_GROUPS.map((g) => [g, menu.filter((m) => m.group === g)]).filter(([, l]) => l.length)
        .map(([g, l]) => `${g[0].toUpperCase()}${g.slice(1)}: ${l.map((m) => `${esc(m.it.name)} ₵${m.price | 0}`).join(', ')}.`).join(' ');
      return { type: 'output', message: `${line} ${teachVerb('stands order')} and the item's id buys one.` };
    }
    sendToPlayer(player.id, { type: 'stands_menu', target: 'order', name: 'Concessions', description: 'Order from your seat and a runner brings it up.',
      groups: CONCESSION_GROUPS, credits: player.credits | 0,
      items: menu.map((m) => ({ id: m.item, name: m.it.name, description: m.it.tags?.description || '', price: m.price | 0, group: m.group, kind: seatKind(m.it), drinkable: !!m.it.tags?.consumable })) });
    return { type: 'noop' };
  }
  const m = menu.find((x) => x.item === String(itemId));
  if (!m) return { type: 'error', message: "That isn't on the menu." };
  const price = m.price | 0;
  if (price > 0 && !(await adjustCredits(player, -price, undefined, 'stands'))) return { type: 'error', message: `That's ₵${price}. You have ₵${player.credits | 0}.` };
  await giveItemById(player.id, m.item, 1, { stack: isStackable(m.it) });
  // and into your hands in the seat's view, held as a box's bar stock is
  const kind = seatKind(m.it);
  if (kind && !loggedPanelsSync(player)) sendToPlayer(player.id, { type: 'stands_hand', item: { id: m.item, name: m.it.name, kind, drinkable: !!m.it.tags?.consumable, ...(kind === 'smoke' ? { lighter: await lighterOf(player.id) } : {}) } });
  return { type: 'output', message: `<span class="msg-system">You pay ₵${price}, and a runner comes up the steps with your ${esc(m.it.name)}.</span>` };
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
  if (!box || from?.flags?.ticketed === box || hasPass(player, box) || isStaff(player)) return;
  const section = standsOf(getZone(box))?.sections[0];
  return { block: true, message: `An usher stops you. ${esc(section?.name || 'The box')} is ticket holders only: ₵${section?.price | 0}, and the ticket machine sells them.` };
}, 'stands:box');

// What a box's suite shows: the ballgame through the glass and on its screen; with no ballgame on,
// the park empty under the lights and the hockey on the screen (`tv`), or, with no hockey either,
// a rerun of the last ballgame (`rerun`, broadcast startSportsRerun: this player's alone, from the
// top). The suite opens either way, which is how staff, who can walk in any time, see it between games.
function suiteChannels(player) {
  const channelId = liveSportsChannel('baseball');
  if (channelId) return { channelId, tv: null };
  const tv = liveSportsChannel('hockey');
  if (tv) return { channelId: null, tv };
  const rerun = player ? startSportsRerun(player.id, 'baseball') : null;
  return { channelId: null, tv: rerun, rerun: !!rerun };
}

// Sits the player in a free seat of `section` and opens the view from it. `chair` is a chair in
// the room (flags.stands_section) rather than a ticket: no charge, and standing up leaves it.
async function takeSeat(player, zone, stands, section, channelId, { chair = false, tv = null, rerun = false, ticket = null } = {}) {
  // a ticket is its own seat, whoever's in the one beside it
  const seat = ticket ? ticket.i : freeSeat(zone.id, stands.sport, section, player.id);
  if (seat < 0) return { type: 'error', message: `${esc(section.name)} is sold out. ${teachVerb('stands')} shows what's left.` };
  const where = seatsOf(stands.sport, section)[seat];
  const price = chair || ticket || hasPass(player, zone.id) ? 0 : section.price | 0;
  if (price > 0 && !(await adjustCredits(player, -price, undefined, 'stands'))) {
    return { type: 'error', message: `A seat in ${esc(section.name)} is ₵${price}. You have ₵${player.credits | 0}.` };
  }
  const tuned = channelId || (rerun ? null : tv);
  seated.set(player.id, { zoneId: zone.id, section: section.id, seat, channelId, tuned, chair, suite: !!section.room, ...(ticket ? { ticket: ticket.id } : {}) });
  if (tuned) emit('tablet_tv.watch', { playerId: player.id, channelId: tuned });
  // the log rung gets the game as log lines through the same receiver, and no picture
  if (!loggedPanelsSync(player)) sendToPlayer(player.id, { type: 'stands_open', sport: stands.sport, channelId, tvChannelId: tv, ...(rerun ? { rerun: true } : {}), station: channelId ? channelLabel(channelId) : '', field: skyField(stands.sport), venue: zone.flags?.building_name || zone.name, roof: stands.sport === 'baseball' ? venueRoofOf(zone.flags?.building_name) : null,
    section: { id: section.id, name: section.name || section.id, eye: where.eye, seat: `Row ${ROW(where.row)}, seat ${where.number}`, ...(section.room ? { room: section.room } : {}) } });
  if (chair && !channelId) return { type: 'output', message: `<span class="msg-system">You take chair ${where.number} in row ${ROW(where.row)}. The field's empty under the lights${rerun ? ", and the last game's on the screen again" : tv ? ', and the hockey is on the screen' : ''}. ${teachVerb('stand')} gets you up.</span>` };
  if (chair) return { type: 'output', message: `<span class="msg-system">You take chair ${where.number} in row ${ROW(where.row)}, and the game is in front of you. ${teachVerb('stand')} gets you up.</span>` };
  // a ticket's line is the caller's (seatOnTicket): it knows whether the stub was torn just now
  if (ticket) return { type: 'output', message: '' };
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
    leave(player, true);
    const { channelId, tv, rerun } = suiteChannels(player);
    const tuned = channelId || (rerun ? null : tv);
    seated.set(player.id, { zoneId: zone.id, section: null, seat: -1, channelId, tuned, screen: true, suite: true });
    if (tuned) emit('tablet_tv.watch', { playerId: player.id, channelId: tuned });
    if (!loggedPanelsSync(player)) sendToPlayer(player.id, { type: 'stands_open', sport: 'baseball', channelId, tvChannelId: tv, ...(rerun ? { rerun: true } : {}), station: channelId ? channelLabel(channelId) : '', field: skyField('baseball'), venue: zone.flags?.building_name || zone.name, roof: venueRoofOf(zone.flags?.building_name),
      section: { id: suite.id, name: suite.name || suite.id, room: suite.room, spot: 'sofa' } });
    const on = channelId ? "The game's on it, and through the glass." : rerun ? "The last game's on it again, and the field through the glass is empty under the lights." : tv ? "The hockey's on it, and the field through the glass is empty under the lights." : "There's no game on it, and the field through the glass is empty under the lights.";
    return { type: 'output', message: `<span class="msg-system">You sit down on the sofa in front of ${esc(screen.name)}. ${on} ${teachVerb('stands leave')} gets you up.</span>` };
  }
  const sport = standsOf(zone)?.sport || (screen.flags.stands_screen === 'hockey' ? 'hockey' : 'baseball');
  const channelId = liveSportsChannel(sport);
  if (!channelId) return { type: 'output', message: `<span class="msg-system">${esc(screen.name)} shows the park empty under the lights. No game on right now.</span>` };
  leave(player, true);
  seated.set(player.id, { zoneId: zone.id, section: null, seat: -1, channelId, tuned: channelId, screen: true });
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
  const { channelId, tv, rerun } = section.room ? suiteChannels(player) : { channelId: liveSportsChannel(stands.sport), tv: null };
  if (!channelId && !section.room) { sendToPlayer(player.id, { type: 'output', message: '<span class="msg-system">No game on right now. The field is empty under the lights.</span>' }); return; }
  const r = await takeSeat(player, zone, stands, section, channelId, { chair: true, tv, rerun });
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
  const { channelId, tv, rerun } = suiteChannels(player);
  const r = await takeSeat(player, zone, stands, section, channelId, { chair: true, tv, rerun });
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
// A seat and the Tablet TV share one tuner, so shutting the tablet's TV dropped the seat's game too:
// the park stood still until the tablet was opened again. Getting up clears `seated` first, so this
// only answers a tablet going off under somebody still sitting. Broadcast loads first (a dependency),
// so its delete has already run.
on('tablet_tv.unwatch', ({ playerId }) => {
  const tuned = seated.get(playerId)?.tuned;
  if (tuned) emit('tablet_tv.watch', { playerId, channelId: tuned });
});

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

export const commands = { stands: cmdStands, buyticket: cmdBuyTicket };

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
export const hooks = {
  'watch.furniture': ({ player, args }) => screenNamed(player, args || []),
  // a Cup room's display of the last champion (champions.js)
  'room.pieceState': (zoneId) => championPieces(zoneId),
  // the ice crew's machine in its bay, and the crew themselves through a break (crew.js)
  'room.vehicles': (zoneId) => crewVehicles(zoneId),
  // ...and a regular in their own seat on a night they've come (regulars.js)
  'room.npcStage': (n, zoneId, pieces) => crewStage(n, zoneId, pieces) ?? regularStage(n, zoneId),
  // your tickets, for a seat door's card, in a room that sells them; and the game's channel, in a room at the rink
  'room.viewer': (zoneId, player) => {
    if (!player) return null;
    const out = {};
    if (sellersIn(zoneId).length) out.tickets = ticketsView(player.id);
    const sport = rinkSportOf(zoneId), ch = sport && liveSportsChannel(sport);
    if (ch) out.rink = { channelId: ch, sport };
    return Object.keys(out).length ? out : null;
  },
};

// A ROOM AT THE RINK (`flags.room.rink` on the zone, drawn by the client's room-rink.js) is drawn over the live game,
// and its openings onto the ice are the ice; so is a room one door off one, which sees the ice through it. Like a seat
// it's a receiver: walking into the room tunes you to the game's channel, as the Tablet TV would be, and walking out
// of the rink's rooms lets it go, unless a seat has you.
const ownRink = (z) => { const r = z?.flags?.room?.rink; return r && Array.isArray(r.at) ? (typeof r.sport === 'string' ? r.sport : 'hockey') : null; };
const rinkSportOf = (zoneId) => {
  const z = getZone(zoneId), own = ownRink(z);
  if (own || !z?.exits) return own;
  for (const t of Object.values(z.exits)) { const s = typeof t === 'string' ? ownRink(getZone(t)) : null; if (s) return s; }
  return null;
};
const atRink = new Map();   // playerId -> the zone whose rink tuned them
on('zone.entered', ({ actor, zone }) => {
  if (!actor?.id || !world.players.has(actor.id)) return;
  const sport = rinkSportOf(zone), ch = sport && liveSportsChannel(sport);
  const was = atRink.get(actor.id);
  if (was && was !== zone) { atRink.delete(actor.id); if (!ch && !seated.has(actor.id)) emit('tablet_tv.unwatch', { playerId: actor.id }); }
  if (ch && !seated.has(actor.id)) { const again = !!was; atRink.set(actor.id, zone); if (!again) emit('tablet_tv.watch', { playerId: actor.id, channelId: ch }); }
});
on('player.logout', ({ id }) => { if (id) atRink.delete(id); });

export const _test = { seated, passes, buyPass, leave, chartPayload, cmdStands, watchScreen, onPosture, suiteChannels, cmdBuyTicket, sitOnTicket, sellTicket, ticketsView, sellersIn, whenOf };
