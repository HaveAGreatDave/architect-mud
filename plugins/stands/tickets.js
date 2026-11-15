// plugins/stands/tickets.js
//
// TICKETS: a seat at one game, as a thing you carry (docs/proposals/coliseum-seats.md, S5).
//
// A ticket is an `item_seat_ticket` row whose custom_data.seat_ticket names the game and the seat:
// `{ venue, slot, section, name, i, row, seat, game, when, torn }`. `venue` is the stands zone it's
// for, `slot` the broadcast slot of its game, `i` the seat's index into seatsOf (index.js) and
// `row`/`seat` how the stub reads it ("Row C, Seat 7"). It's bought at a box office, a seat door or
// the seat itself (index.js), for the game on now or one of the next few, and you can hold several.
// Sitting on it tears the stub (`torn`), which stays in your bag: a torn stub still gets you back to
// your own seat for that game, and after it it's a souvenir.
//
// ⚠ A SEAT IS SOLD ONCE PER GAME, OUT OF RAM. `sold` is every seat sold since boot, plus every seat
// on a ticket an online player holds (read once at login, one query). Nothing is queried on a move,
// a look or a sit; the one read on a sit (`confirm`) is a click, and it checks the stub is still
// yours, since a stub can be dropped or handed over without this hearing of it. A restart forgets a
// seat held by somebody offline, so it can be sold twice; the second buyer sits, and so does the
// first, side by side in the one seat. That's the cost of not keeping a table for it.

import { query } from '../../server/models/db.js';
import { giveItemById, patchInventoryCustomData } from '../../server/engine/inventory.js';
import { on } from '../../server/engine/events.js';

export const TICKET_ITEM = 'item_seat_ticket';
// how many games ahead a counter sells, counting the one on now
export const GAMES_AHEAD = 4;

const held = new Map();   // playerId -> Map(rowId -> ticket)
const sold = new Map();   // `${venue}|${slot}` -> Set of seat keys `${section}|${i}`
const gameKey = (venue, slot) => `${venue}|${slot}`;
const seatKey = (section, i) => `${section}|${i}`;

const cdOf = (row) => (typeof row?.custom_data === 'string' ? (() => { try { return JSON.parse(row.custom_data); } catch { return {}; } })() : row?.custom_data || {});
function ticketOf(row) {
  const t = cdOf(row).seat_ticket;
  if (!t || typeof t !== 'object' || !t.venue || !Number.isFinite(Number(t.slot)) || !t.section || !Number.isInteger(t.i)) return null;
  return { ...t, id: row.id, slot: Number(t.slot) };
}
function mark(t) {
  const k = gameKey(t.venue, t.slot);
  if (!sold.has(k)) sold.set(k, new Set());
  sold.get(k).add(seatKey(t.section, t.i));
}
// Games long gone take no room: drop every sold set older than `slot` (the oldest a counter still sells).
export function forgetBefore(slot) {
  for (const k of sold.keys()) if (Number(k.split('|').pop()) < slot) sold.delete(k);
}

// The seats sold in one section for one game, as indices into seatsOf.
export function soldIn(venue, slot, section) {
  const out = new Set(), s = sold.get(gameKey(venue, slot));
  if (!s) return out;
  const pre = `${section}|`;
  for (const k of s) if (k.startsWith(pre)) out.add(Number(k.slice(pre.length)));
  return out;
}

// A player's tickets, the soonest game first.
export function ticketsOf(playerId) {
  const m = held.get(playerId);
  return m ? [...m.values()].sort((a, b) => a.slot - b.slot || String(a.name).localeCompare(String(b.name)) || a.i - b.i) : [];
}
// The ticket of theirs for this game in this venue (in `section` if one is named), or null.
export const ticketFor = (playerId, venue, slot, section = null) => ticketsOf(playerId).find((t) => t.venue === venue && t.slot === slot && (!section || t.section === section)) || null;
export const ticketById = (playerId, id) => held.get(playerId)?.get(String(id)) || null;

// One read at login: every stub they carry (not those in a bag of theirs; a stub you want to use is in your hand).
export async function loadTickets(playerId) {
  const { rows } = await query('SELECT id, custom_data FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL', [playerId, TICKET_ITEM]).catch(() => ({ rows: [] }));
  const m = new Map();
  for (const r of rows) { const t = ticketOf(r); if (t) { m.set(String(r.id), t); mark(t); } }
  held.set(playerId, m);
  return ticketsOf(playerId);
}

// Writes the stub to their bag and keeps it. `t` is the seat_ticket record without the row id.
export async function issue(playerId, t) {
  const { id } = await giveItemById(playerId, TICKET_ITEM, 1, { stack: false, customData: { seat_ticket: t } });
  const out = { ...t, id: String(id) };
  if (!held.has(playerId)) held.set(playerId, new Map());
  held.get(playerId).set(out.id, out);
  mark(out);
  return out;
}

// Is the stub still theirs, and still in their hand? The one read on a sit. Drops it from RAM when it isn't.
export async function confirm(playerId, t) {
  const { rows } = await query('SELECT id, custom_data FROM player_inventory WHERE id=$1 AND player_id=$2 AND container_id IS NULL', [t.id, playerId]).catch(() => ({ rows: [] }));
  const now = rows[0] && ticketOf(rows[0]);
  if (!now) { held.get(playerId)?.delete(String(t.id)); return null; }
  held.get(playerId)?.set(String(t.id), now);
  return now;
}

// Tears the stub: it stays in the bag, marked.
export async function tear(playerId, t) {
  if (t.torn) return t;
  await patchInventoryCustomData([[t.id, { seat_ticket: { ...stripId(t), torn: true } }]]);
  const out = { ...t, torn: true };
  held.get(playerId)?.set(String(t.id), out);
  return out;
}
const stripId = ({ id: _id, ...rest }) => rest;

// How a stub reads, on a card and in the log: "Centre Lower, Row C, Seat 7".
export const seatLabel = (t) => `${t.name || t.section}, Row ${t.row}, Seat ${t.seat}`;

on('player.login', ({ id }) => { if (id) loadTickets(id).catch((e) => console.error('[stands] tickets:', e.message)); });
on('player.logout', ({ id }) => { if (id) held.delete(id); });

export const _test = { held, sold, ticketOf };
