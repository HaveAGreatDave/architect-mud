// plugins/roomstage/index.js
//
// THE ROOM STAGE, server side: a room you can walk round in first person (docs/proposals/room-stage.md,
// docs/proposals/home-stage.md). `room` opens it; the client builds the room from one payload,
// `room_view`, and draws it in GLASS (client/game/js/panels/room-stage.js).
//
// ⚠ THE STAGE DECIDES NOTHING. Every gesture on it sends a verb a player could type (`sit sofa`,
// `lie sleep pod`, `watch tv`, `open fridge`, `stand`), so the room text, the text rung and the log
// rung lose nothing. What this plugin owns is the picture's state: where each piece stands, and
// where each person in the room is standing.
//
// ⚠ WHERE A PIECE STANDS IS SERVER STATE. A player's piece has `flags.spot` stamped the moment it
// lands in a room (`furniture.changed`, fired by `place` and by a vendor's delivery), worked out by
// client/shared/room-layout.js placeSpot, the same rules the client lays the room out by. An
// authored piece is never written to (git is the only writer of content); its spot is worked out
// the same way every time, before any player piece, so it never moves.
//
// ⚠ POSITIONS ARE RAM AND ARRIVE WHEN THEY SETTLE. The client sends `room_pos` when you stop walking
// or sit, not every step, so a walk round the room is a few messages; this relays them to whoever
// else has the room open and writes nothing. A restart forgets them, and everybody starts at the door.
//
// Which rooms have a Stage: a flat (an apartment zone) at FLAT_ROOM's size, or any zone carrying
// `flags.room` ({ w, d, h } in metres). Everyone in the room may open it, the tenant or a visitor.

import { getZone, getZoneFurniture, getZonePlayers, getZoneNpcs, getApartment, updateFurniture } from '../../server/engine/world.js';
import { getItem } from '../../server/engine/items-cache.js';
import { on } from '../../server/engine/events.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { loggedPanelsSync } from '../../server/engine/presentation.js';
import { getBirdClock } from '../../server/engine/environment.js';
import { playerControlsApt } from '../../server/engine/apartments.js';
import { ownsZone } from '../../server/engine/zone-filth.js';
import { archetypeOf, formOf, dimsOf, placeSpot, roomSpecOf, resolveSpot } from '../../client/shared/room-layout.js';

// zoneId -> Set of player ids with the Stage open there
const viewers = new Map();
// playerId -> { zone, at: [u, v], yaw, seat }: where they last settled, in the room's metres
const where = new Map();
// playerId -> last room_pos time, so a client can't flood the relay
const lastPos = new Map();
const POS_MS = 150;

// The furniture rows a room's Stage draws: what stands on its floor. Posters, terminals, generators
// and the like have their own verbs and no shape here yet; a dead drop is hidden on purpose.
const DRAWN = new Set(['furniture', 'container']);
const drawn = (f) => DRAWN.has(f.object_type) && !f.flags?.dead_drop && !f.flags?.hidden;

export function specOf(zoneId) {
  const zone = getZone(zoneId);
  return zone ? roomSpecOf(zone.flags, !!getApartment(zoneId)) : null;
}

// How a row looks: its archetype and form from its own flags (a placed piece carries its item's) and
// the weight of the item it came from, and a wear from what it cost unless `flags.look.wear` says.
function lookOf(f) {
  const item = f.flags?.item_id ? getItem(f.flags.item_id) : null;
  const grams = Number(item?.weight) || 0, arche = archetypeOf(f.flags || {}, grams);
  const price = Number(f.price ?? item?.value) || 0;
  const wear = Number.isFinite(f.flags?.look?.wear) ? f.flags.look.wear : price <= 60 ? 0.7 : price <= 200 ? 0.4 : price <= 600 ? 0.15 : 0;
  return { arche, form: formOf(arche, f.flags || {}, grams), dims: dimsOf(arche, grams, f.flags || {}), crt: f.flags?.tv_skin === 'crt', wear, seed: hash(f.flags?.item_id || f.name || f.id) };
}
function hash(s) { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }

// The room's pieces with their spots. Authored rows first, by id, worked out fresh every time; then
// player rows, each with the spot it was stamped with, or one worked out now (and, with `stamp`,
// written to the row so it stays there).
export async function roomPieces(zoneId, spec, { stamp = false } = {}) {
  const rows = getZoneFurniture(zoneId).filter(drawn);
  const authored = rows.filter((f) => f.origin !== 'player').sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const player = rows.filter((f) => f.origin === 'player').sort((a, b) => String(a.created_at || a.id).localeCompare(String(b.created_at || b.id)));
  const out = [], writes = [];
  const add = (f, spot) => out.push({ id: f.id, name: f.name, ...lookOf(f), spot, verbs: Array.isArray(f.flags?.interactions) ? f.flags.interactions : [], container: f.object_type === 'container' });
  const fresh = (f) => {
    const L = lookOf(f);
    return placeSpot(spec, out, L.arche, L.dims, { crt: L.crt }) || { at: [0, +(spec.d / 2).toFixed(2)], turn: 0 };
  };
  for (const f of authored) add(f, fresh(f));
  for (const f of player.filter((x) => x.flags?.spot)) add(f, f.flags.spot);
  for (const f of player.filter((x) => !x.flags?.spot)) {
    const spot = fresh(f);
    add(f, spot);
    if (stamp) writes.push(updateFurniture(f.id, { flags: JSON.stringify({ ...f.flags, spot }) }));
  }
  if (writes.length) await Promise.all(writes);
  return out;
}

// Everyone in the room, players and NPCs: where they settled (players who've opened the Stage),
// their posture and the piece they're on. A body nobody has placed is the client's to stand by the
// door or put on its piece.
function peopleIn(zoneId, pieces) {
  const byName = new Map();
  for (const p of pieces) if (!byName.has(p.name)) byName.set(p.name, p.id);
  const out = [];
  for (const pl of getZonePlayers(zoneId)) {
    const w = where.get(pl.id);
    out.push({ id: pl.id, name: pl.handle || pl.name, posture: pl.posture || 'standing', on: pl.sittingOn ? byName.get(pl.sittingOn) || null : null,
      ...(w && w.zone === zoneId ? { at: w.at, yaw: w.yaw, seat: w.seat } : {}) });
  }
  for (const n of getZoneNpcs(zoneId)) {
    const on = n.onFurniture || n.sittingOn;
    out.push({ id: n.id, name: n.name, npc: true, posture: n.posture || 'standing', on: on ? byName.get(on) || null : null });
  }
  return out;
}

function controls(player, zoneId) {
  return playerControlsApt(player, getApartment(zoneId)) || ownsZone(zoneId, player?.id);
}

async function viewPayload(player, zoneId, spec) {
  const pieces = await roomPieces(zoneId, spec, { stamp: true });
  const zone = getZone(zoneId);
  return { type: 'room_view', zone: zoneId, name: zone?.name || '', spec, mine: !!controls(player, zoneId), you: player.id,
    pieces, people: peopleIn(zoneId, pieces), clock: getBirdClock() };
}

const viewersOf = (zoneId) => viewers.get(zoneId) || new Set();
function dropViewer(playerId, zoneId) {
  const set = viewers.get(zoneId);
  if (!set) return;
  set.delete(playerId);
  if (!set.size) viewers.delete(zoneId);
}

// Who's in the room, to everybody with it open.
async function sendPeople(zoneId) {
  const set = viewers.get(zoneId);
  if (!set?.size) return;
  const spec = specOf(zoneId);
  if (!spec) return;
  const people = peopleIn(zoneId, await roomPieces(zoneId, spec));
  for (const id of set) sendToPlayer(id, { type: 'room_people', zone: zoneId, people });
}

// ── room ────────────────────────────────────────────────────────────────────────────────────────
async function cmdRoom(args, raw, player) {
  const zoneId = player.current_zone, a0 = String(args[0] || '').toLowerCase();
  if (a0 === 'close' || a0 === 'leave') {
    dropViewer(player.id, zoneId);
    sendToPlayer(player.id, { type: 'room_close' });
    return { type: 'noop' };
  }
  const spec = specOf(zoneId);
  if (!spec) return { type: 'error', message: "There's no walking round this place in 3-D. Flats and furnished rooms have it." };
  if (loggedPanelsSync(player)) return { type: 'error', message: 'The 3-D room needs the Visual or Text Games display mode. Everything in it is in the room text.' };
  let set = viewers.get(zoneId);
  if (!set) viewers.set(zoneId, (set = new Set()));
  set.add(player.id);
  sendToPlayer(player.id, await viewPayload(player, zoneId, spec));
  return { type: 'noop' };
}

// A piece placed, taken or boxed. A new player piece gets its spot now, and whoever has the room
// open is sent the piece again, told it's gone, or (no `id`: a whole room boxed) sent them all.
on('furniture.changed', ({ zoneId, id, gone }) => {
  (async () => {
    const spec = specOf(zoneId);
    if (!spec) return;
    const pieces = await roomPieces(zoneId, spec, { stamp: true });
    const set = viewers.get(zoneId);
    if (!set?.size) return;
    const piece = id && !gone ? pieces.find((p) => p.id === id) : null;
    const msg = !id ? { pieces } : piece ? { piece } : { id, gone: true };
    for (const pid of set) sendToPlayer(pid, { type: 'room_piece', zone: zoneId, ...msg });
  })().catch((e) => console.error('[roomstage] furniture.changed:', e.message));
});

// Somebody settled: where they stand now, sent on to everybody else with the room open. `seat` is
// which seat of the layout they took, so two people on one sofa sit side by side.
on('room.pos', ({ playerId, at, yaw, seat }) => {
  const now = Date.now();
  if (now - (lastPos.get(playerId) || 0) < POS_MS) return;
  lastPos.set(playerId, now);
  const zoneId = [...viewers].find(([, s]) => s.has(playerId))?.[0];
  const spec = zoneId && specOf(zoneId);
  if (!spec || !Array.isArray(at) || at.length !== 2 || !at.every(Number.isFinite)) return;
  const u = Math.max(-spec.w / 2, Math.min(spec.w / 2, at[0])), v = Math.max(0, Math.min(spec.d, at[1]));
  where.set(playerId, { zone: zoneId, at: [+u.toFixed(2), +v.toFixed(2)], yaw: Number.isFinite(yaw) ? +yaw.toFixed(3) : 0, seat: Number.isInteger(seat) ? seat : null });
  sendPeople(zoneId).catch(() => {});
});

// Walking out closes your Stage and tells both rooms who's in them now.
// (An NPC walking in or out changes who's there too.)
on('zone.entered', ({ actor, zone, from }) => {
  if (!actor?.id) return;
  if (from && viewersOf(from).has(actor.id)) { dropViewer(actor.id, from); sendToPlayer(actor.id, { type: 'room_close' }); }
  where.delete(actor.id);
  if (from) sendPeople(from).catch(() => {});
  sendPeople(zone).catch(() => {});
});
on('posture.changed', ({ player }) => { if (player?.current_zone) sendPeople(player.current_zone).catch(() => {}); });
on('player.logout', ({ id }) => {
  if (!id) return;
  for (const [zoneId, set] of [...viewers]) if (set.has(id)) { dropViewer(id, zoneId); sendPeople(zoneId).catch(() => {}); }
  where.delete(id); lastPos.delete(id);
});

export const commands = { room: cmdRoom };

export const _test = { viewers, where, roomPieces, specOf, viewPayload, peopleIn, resolveSpot };
