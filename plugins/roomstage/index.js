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
// client/shared/room-layout.js placeSpot, the same rules the client lays the room out by. After
// that only `arrange` moves it. An authored piece is never written to (git is the only writer of
// content); its spot is worked out the same way every time, before any player piece, so it never moves.
//
// ⚠ POSITIONS ARE RAM AND ARRIVE WHEN THEY SETTLE. The client sends `room_pos` when you stop walking
// or sit, not every step, so a walk round the room is a few messages; this relays them to whoever
// else has the room open and writes nothing. A restart forgets them, and everybody starts at the door.
//
// Which rooms have a Stage: a flat (`flags.is_apartment`, let or vacant) at FLAT_ROOM's size, or any zone
// carrying `flags.room` ({ w, d, h } in metres). Either way a room big enough is a studio (studioPlan). Everyone in the room may open it, the tenant or a visitor.
// An `is_dwelling` zone is not a flat: a bunkroom or a cistern has no kitchen or balcony, so it needs its own `flags.room`.
//
// ⚠ A FLAT AND ITS EN-SUITE ARE ONE STAGE. The room you reach by `in` from a flat, whose `out` comes
// back and whose parent is the flat, is drawn behind the flat's back wall (`withAnnex`). Everything is
// keyed on the flat (`mainOf`): walking through the door sends the ordinary `in`, the server moves the
// player as it always does, and `zone.entered` keeps the Stage open and says `room_here`.
//
// ⚠ THE OUTLOOK IS WORLD DATA, SENT ONCE. `room_outlook` follows `room_view` with the map window round
// the building and where in it the flat is (the tile, its storey, the way its front wall faces), so
// the client can point GLASS out of the window. It's the freelook payload and costs what that costs,
// so it goes once per open and never on a tick.
//
// ⚠ THE SKY GOES ON A TICK, AND ONLY THE SKY. `room_sky` is the weather at the tile and who's really flying
// past, a few numbers, every 5 s while somebody has a room open. It's RAM and no query, and with no room
// open the tick is one Map.size. The scheduled flights past the window aren't in it: they're a pure function
// of the clock (client/shared/window-sky.js), so nothing has to send them.

import { furnitureActs } from '../../server/engine/furnitureActions.js';
import { getZone, getZoneFurniture, getZonePlayers, getZoneNpcs, getApartment, updateFurniture, getLivePlayer } from '../../server/engine/world.js';
import { getItem } from '../../server/engine/items-cache.js';
import { primaryExits } from '../../server/engine/exits.js';
import { on, emit } from '../../server/engine/events.js';
import { createNpcLife } from './npc-life.js';
import { isNpcAsleep, isNpcAtWork } from '../../server/engine/ai-behaviour.js';
import { resolve as siftResolve } from '../../server/engine/sift.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { loggedPanelsSync } from '../../server/engine/presentation.js';
import { getBirdClock } from '../../server/engine/environment.js';
import { playerControlsApt } from '../../server/engine/apartments.js';
import { ownsZone } from '../../server/engine/zone-filth.js';
import { placeSpot, roomSpecOf, resolveSpot, withAnnex, annexFrame, rowDrawn, layRows } from '../../client/shared/room-layout.js';
import { schedule } from '../../server/engine/scheduler.js';
import { zoneOwnerId } from '../../server/engine/zone-filth.js';
import { mapWindow, skyState, FLIGHT_RADIUS, skylineNear, nearbyRegions, farRoadsNear, FAR_ROAD_R, worldContactsNear, fieldsNear } from '../flight/state.js';
import { streetActors } from '../../server/engine/street-actors.js';
import { TRAFFIC } from '../../client/shared/window-sky.js';

// zoneId -> Set of player ids with the Stage open there
const viewers = new Map();
// playerId -> { zone, at: [u, v], yaw, seat }: where they last settled, in the room's metres
const where = new Map();
// playerId -> last room_pos time, so a client can't flood the relay
const lastPos = new Map();
const POS_MS = 150;

// The furniture rows a room's Stage draws are `rowDrawn`'s (client/shared/room-layout.js).
const drawn = rowDrawn;

// The en-suite off a flat: the zone `in` reaches, whose `out` comes back and whose parent is the
// flat. Anything else behind an `in` (a lift, a stairwell) is somewhere else.
export function annexOf(zoneId) {
  const zone = getZone(zoneId), id = zone ? primaryExits(zone).in : null, inner = id ? getZone(id) : null;
  return inner && primaryExits(inner).out === zoneId && inner.parent_zone === zoneId ? inner : null;
}
// The room a zone's Stage is keyed on: the flat, from its en-suite as from itself.
export function mainOf(zoneId) {
  const parent = getZone(zoneId)?.parent_zone;
  return parent && annexOf(parent)?.id === zoneId ? parent : zoneId;
}

export function specOf(zoneId) {
  const zone = getZone(zoneId);
  const mark = zone ? parseInt(zone.marker, 10) : NaN;
  // a flat is the zone's own flag: an `apartments` row only exists once somebody has rented it, and a
  // vacant flat has a Stage too
  const spec = zone ? roomSpecOf(zone.flags, !!(zone.flags?.is_apartment || getApartment(zoneId)), { storey: Number.isFinite(mark) ? mark : null }) : null;
  if (!spec) return null;
  const annex = annexOf(zoneId);
  return annex ? withAnnex(spec, annex.id, annex.name) : spec;
}

// One room's pieces with their spots, laid out by layRows (client/shared/room-layout.js). With
// `stamp`, a player's piece that has no spot yet has the one it was given written to its row.
async function piecesOf(zoneId, spec, { stamp, annex, finish }) {
  const { pieces, stamps } = layRows(getZoneFurniture(zoneId), spec, { annex, finish, itemOf: (f) => (f.flags?.item_id ? getItem(f.flags.item_id) : null) });
  if (stamp && stamps.length) await Promise.all(stamps.map(({ row, spot }) => updateFurniture(row.id, { flags: JSON.stringify({ ...row.flags, spot }) })));
  const rows = new Map(getZoneFurniture(zoneId).map((f) => [f.id, f]));
  return pieces.map((p) => ({ ...p, acts: furnitureActs(rows.get(p.id)) }));
}

// The pieces of a flat, and of its en-suite when it has one. A piece in the en-suite carries `annex`
// and its spot is in the en-suite's own frame.
export async function roomPieces(zoneId, spec, { stamp = false } = {}) {
  const out = await piecesOf(zoneId, spec, { stamp, annex: false, finish: spec.finish });
  if (!spec.annex) return out;
  const A = annexFrame(spec);
  return [...out, ...await piecesOf(spec.annex.zone, A.spec, { stamp, annex: true, finish: spec.annex.finish })];
}

// Which way the flat looks: the door to the landing is in the back wall, so the front wall faces away
// from it. `flags.room.face` says otherwise when the door doesn't.
const BEARING = { north: 0, northeast: 45, east: 90, southeast: 135, south: 180, southwest: 225, west: 270, northwest: 315 };
function bearingOf(zone) {
  const own = Number(zone.flags?.room?.face);
  if (Number.isFinite(own)) return ((own % 360) + 360) % 360;
  for (const dir of Object.keys(primaryExits(zone))) if (BEARING[dir] !== undefined) return (BEARING[dir] + 180) % 360;
  return 0;
}

// The tile a room's building stands on, walking up its parents. An interior zone carries grid 0,0 to
// mean unset, so the test is the map, never the numbers.
function buildingOf(zone) {
  let z = zone;
  for (let hop = 0; hop < 4 && z; hop++) {
    if (z.map_id === 'map_world') return z;
    z = z.parent_zone ? getZone(z.parent_zone) : null;
  }
  return null;
}

// How far up the building a flat is: `flags.room.storey`, else the number on its floor's marker, else
// the first floor. `storeys` is how many it has when the content says.
function storeyOf(zone) {
  const own = Number(zone.flags?.room?.storey), mark = parseInt(zone.marker, 10);
  return Number.isFinite(own) ? own : Number.isFinite(mark) && mark > 0 ? mark : 1;
}

// Where the window looks out from: the tile, the storey and the bearing of the front wall.
function outlookOf(zoneId) {
  const zone = getZone(zoneId), tile = zone ? buildingOf(zone) : null;
  if (!tile) return null;
  return { gx: tile.grid_x, gy: tile.grid_y, storey: storeyOf(zone), storeys: Number(zone.flags?.room?.storeys) || null, bearing: bearingOf(zone) };
}

// The world round the building, for GLASS to draw out of the window.
function outlookPayload(zoneId) {
  const at = outlookOf(zoneId);
  if (!at) return null;
  return { type: 'room_outlook', zone: zoneId, ...at, map: mapWindow({ grid_x: at.gx, grid_y: at.gy }, FLIGHT_RADIUS),
    skyline: skylineNear(at.gx, at.gy, FLIGHT_RADIUS), sky: skyState(at.gx, at.gy), roads: farRoadsNear(at.gx, at.gy, FAR_ROAD_R), regions: nearbyRegions(at.gx, at.gy),
    fields: fieldsNear(at.gx, at.gy, TRAFFIC.routeRange), contacts: pilotsNear(at), actors: streetActors(at.gx, at.gy, FLIGHT_RADIUS) };
}

// Everything really moving past the window, in the contact shape every GLASS view draws: aircraft, boats, trucks.
const pilotsNear = (at) => worldContactsNear(at.gx, at.gy, TRAFFIC.range);

// Every 5 s, what's past each open room's windows: who's flying, and every sixth beat the weather. A
// room with nobody flying past hears only the weather, and a room that just lost its last pilot is told.
const SKY_EVERY = 6;
let skyBeat = 0;
const flewPast = new Set();
export function skyTick() {
  if (!viewers.size) return;
  const weather = ++skyBeat % SKY_EVERY === 0;
  for (const [zoneId, set] of viewers) {
    const at = set.size ? outlookOf(zoneId) : null;
    if (!at) continue;
    const contacts = pilotsNear(at), had = flewPast.has(zoneId);
    if (contacts.length) flewPast.add(zoneId); else flewPast.delete(zoneId);
    const people = skyBeat % 3 === 0;
    if (!weather && !people && !contacts.length && !had) continue;
    const msg = { type: 'room_sky', zone: zoneId, contacts };
    // the people on the pavement ride every third beat: an NPC steps a tile every 15 s, and the client walks them
    if (people) msg.actors = streetActors(at.gx, at.gy, FLIGHT_RADIUS);
    if (weather) {
      const s = skyState(at.gx, at.gy);
      Object.assign(msg, { weather: s.weather, wind: s.wind, windDir: s.field?.wind?.dir, here: s.here, event: s.event, field: s.field });
    }
    const send = globalThis.__roomSkySink || sendToPlayer;   // the suite listens here (regress.js)
    for (const id of set) send(id, msg);
  }
}
schedule('5s', skyTick);

// Where somebody asleep, out cold or laid down by the engine lies when nothing has put them on a piece: a bed,
// else a sofa, else a chair to slump in, one body a piece. The room text says "(sleeping)" or "(lying down)",
// and without this the Stage stood them by the door.
const LIE_ON = ['bed', 'sofa'], SIT_ON = ['seat', 'bench', 'sofa'];
function restingOn(pieces, inside, taken) {
  for (const arches of [LIE_ON, SIT_ON]) for (const a of arches) {
    const p = pieces.find((q) => q.arche === a && !!q.annex === inside && !taken.has(q.id));
    if (p) return { posture: arches === LIE_ON ? 'lying' : 'sitting', on: p.id };
  }
  return null;
}
// What an NPC idles at, by the work they do (gl/room-people.js, actor3d.js ACTOR_IDLES): behind a bar or a shop
// counter while they're at work, on guard, or living rough. Nothing the text doesn't already say about them.
const MANNER = { bartender: 'bar', vendor: 'shop', clerk: 'shop', dealer: 'shop', travelling_vendor: 'shop', guard: 'guard', police: 'guard', mercenary: 'guard', thug: 'guard', vagrant: 'rough', lowlife: 'rough' };
function mannerOf(n) {
  const m = MANNER[n.flags?.personality] || (n.npc_type === 'vendor' ? 'shop' : null);
  return m === 'bar' || m === 'shop' ? (isNpcAtWork(n) ? m : null) : m;
}

// Everyone in the room, players and NPCs: where they settled (players who've opened the Stage),
// their posture and the piece they're on. A body nobody has placed is the client's to stand by the
// door or put on its piece.
function peopleIn(zoneId, pieces) {
  const byName = new Map();
  for (const p of pieces) if (!byName.has(p.name)) byName.set(p.name, p.id);
  const out = [], annex = annexOf(zoneId);
  for (const [id, inside] of [[zoneId, false], ...(annex ? [[annex.id, true]] : [])]) {
    const mark = inside ? { annex: true } : {};
    for (const pl of getZonePlayers(id)) {
      const w = where.get(pl.id);
      out.push({ id: pl.id, name: pl.handle || pl.name, posture: pl.posture || 'standing', on: pl.sittingOn ? byName.get(pl.sittingOn) || null : null, sex: pl.biological_sex, ...mark,
        ...(w && w.zone === zoneId ? { at: w.at, yaw: w.yaw, seat: w.seat } : {}) });
    }
    for (const n of getZoneNpcs(id)) {
      const on = n.onFurniture || n.sittingOn, st = life.stageOf(n, zoneId);
      // an NPC's order, when it has one, so the client can dress them as it dresses (gl/room-people.js);
      // the room already shows who they are by name, so this tells a viewer nothing the tag doesn't
      const order = typeof n.faction === 'string' && n.faction.startsWith('ideology_') ? n.faction : undefined;
      // asleep or out cold, as the room text tags them, laid somewhere; and what they idle at
      const asleep = !!n._ai?.homeSleeping || isNpcAsleep(n), ko = !asleep && !!n._ai?.dosedOut;
      const lay = (asleep || ko || n.posture === 'lying') && !on && !st ? restingOn(pieces, inside, new Set(out.map((o) => o.on).filter(Boolean))) : null;
      const manner = st || asleep || ko ? null : mannerOf(n);
      // their sex and any settled look, which the close-up figure draws them by (gl/room-people.js)
      out.push({ id: n.id, name: n.name, npc: true, posture: n.posture || 'standing', on: on ? byName.get(on) || null : null, sex: n.sex, ...(n.flags?.figure ? { figure: n.flags.figure } : {}), ...mark, ...(order ? { order } : {}),
        ...(asleep ? { asleep: true } : {}), ...(ko ? { out: true } : {}), ...(manner ? { manner } : {}), ...(lay || {}), ...(st || {}) });
    }
  }
  return out;
}

function controls(player, zoneId) {
  return playerControlsApt(player, getApartment(zoneId)) || ownsZone(zoneId, player?.id);
}

async function viewPayload(player, zoneId, spec) {
  const pieces = await roomPieces(zoneId, spec, { stamp: true });
  const zone = getZone(zoneId);
  return { type: 'room_view', zone: zoneId, here: player.current_zone, name: zone?.name || '', spec, hasView: !!outlookOf(zoneId), mine: !!controls(player, zoneId), you: player.id,
    pieces, people: peopleIn(zoneId, pieces), tv: life.tvOf(zoneId), clock: getBirdClock(),
    // as the keypad's advert goes (plugins/concealment): an owned room's is the owner's business
    keypad: pieces.some((p) => p.keypad) && (!zoneOwnerId(zoneId) || String(zoneOwnerId(zoneId)) === String(player.id)) };
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
  for (const id of set) sendToPlayer(id, { type: 'room_people', zone: zoneId, people, tv: life.tvOf(zoneId) });
}

// Which seats and pieces somebody's already on, so a resident doesn't sit on them.
function busy(zoneId, pieces) {
  const seats = new Set(), held = new Set();
  for (const p of peopleIn(zoneId, pieces)) { if (Number.isInteger(p.seat)) seats.add(p.seat); else if (p.on) held.add(p.on); }
  for (const l of life.lives.values()) if (l.main === zoneId && Number.isInteger(l.job?.seat)) seats.add(l.job.seat);
  return { seats, pieces: held };
}
// Residents going about their flat while it's open (npc-life.js).
const watching = new Set();
const tvOn = (zoneId) => [...viewersOf(zoneId)].some((id) => watching.has(id));
const life = createNpcLife({ viewers, annexOf, mainOf, specOf, roomPieces, sendPeople, busy, tvOn });
const tvMoved = (playerId) => { for (const [zoneId, set] of viewers) if (set.has(playerId)) life.tvChanged(zoneId); };
on('tv.watch', ({ playerId }) => { watching.add(playerId); tvMoved(playerId); });
on('tv.unwatch', ({ playerId }) => { watching.delete(playerId); tvMoved(playerId); });
on('tv.poweroff', ({ playerId }) => { watching.delete(playerId); tvMoved(playerId); });
schedule('5s', () => life.tick());
on('npc.home.scene', (e) => life.scene(e));
on('npc.ritual', (e) => life.ritual(e));
on('npc.banter.start', (e) => life.talkStart(e));
on('npc.banter.end', (e) => life.talkEnd(e));

// ── room ────────────────────────────────────────────────────────────────────────────────────────
async function cmdRoom(args, raw, player) {
  const zoneId = mainOf(player.current_zone), a0 = String(args[0] || '').toLowerCase();
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
  await life.settleIn(zoneId);
  sendToPlayer(player.id, await viewPayload(player, zoneId, spec));
  const outlook = outlookPayload(zoneId);
  if (outlook) sendToPlayer(player.id, outlook);
  return { type: 'noop' };
}

// ── arrange <piece> [wall] ──────────────────────────────────────────────────────────────────────
// Moves one player piece to another wall, or with no wall back to the spot `place` would pick now.
// The new spot comes from placeSpot over the room without the piece, so the door's way in, the
// window and every other piece stay clear. One updateFurniture write, then furniture.changed sends
// the piece to whoever has the Stage open. The room text doesn't change, so this works at every rung.
const WALLS = { left: 'left', right: 'right', front: 'front', back: 'back', window: 'front', door: 'back' };
const WALL_NAME = { left: 'the left wall', right: 'the right wall', front: 'the window wall', back: 'the door wall' };
const FILLER = /^(against|to|by|on|onto|at|under|beside|next|the)$/;

function parseArrange(args) {
  const words = args.join(' ').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.at(-1) === 'wall') words.pop();
  let wall = null;
  if (words.length > 1 && WALLS[words.at(-1)]) {
    wall = WALLS[words.pop()];
    while (words.length > 1 && FILLER.test(words.at(-1))) words.pop();
  }
  return { target: words.join(' ').replace(/^(the|a|an|my)\s+/, '').trim(), wall };
}

// Someone sitting or lying on it, a player or an NPC (as furnishing's take checks).
function occupied(f, zoneId) {
  if (getZonePlayers(zoneId).some((p) => (p.posture === 'sitting' || p.posture === 'lying') && p.sittingOn === f.name)) return true;
  return getZoneNpcs(zoneId).some((n) => n.onFurniture === f.name || (n.posture === 'sitting' && n.sittingOn === f.name));
}

async function cmdArrange(args, raw, player, broadcast) {
  const zoneId = player.current_zone;
  const { target, wall } = parseArrange(args);
  if (!target) return { type: 'output', message: 'Arrange what? `arrange <piece> <wall>`, where the wall is left, right, window or door. Leave the wall off to put it back where it goes.' };
  const spec = specOf(zoneId);
  if (!spec) return { type: 'error', message: 'You can only arrange furniture in a flat or a furnished room.' };
  if (!controls(player, zoneId)) return { type: 'error', message: "This isn't your place to rearrange." };

  const r = siftResolve(target, getZoneFurniture(zoneId).filter(drawn));
  if (r.type === 'none') return { type: 'error', message: `There's no "${target}" in here to move.` };
  if (r.type === 'ambiguous') return { type: 'error', message: `Which one? ${[...new Set(r.candidates.map((c) => c.name))].join(', ')}.` };
  const row = r.candidate;
  if (row.origin !== 'player') return { type: 'error', message: "It's fixed in place." };
  if (occupied(row, zoneId)) return { type: 'error', message: `Someone's using the ${row.name}.` };

  const pieces = await roomPieces(zoneId, spec);
  const me = pieces.find((p) => p.id === row.id);
  if (!me) return { type: 'error', message: `The ${row.name} isn't there any more.` };
  if (wall && me.spot?.wall === wall) return { type: 'error', message: `The ${row.name} is already against ${WALL_NAME[wall]}.` };
  const spot = placeSpot(spec, pieces.filter((p) => p.id !== row.id && !p.annex), me.arche, me.dims, { crt: me.crt, form: me.form, wall });
  if (!spot) return { type: 'error', message: wall ? `There's no room for the ${row.name} against that wall.` : `There's no room for the ${row.name} anywhere else in here.` };
  if (JSON.stringify(spot) === JSON.stringify(me.spot)) return { type: 'error', message: `The ${row.name} is already where it goes.` };

  const saved = await updateFurniture(row.id, { flags: JSON.stringify({ ...row.flags, spot }) });
  if (!saved) return { type: 'error', message: `The ${row.name} isn't there any more.` };
  emit('furniture.changed', { zoneId, id: row.id });
  const where = spot.wall ? `against ${WALL_NAME[spot.wall]}` : 'out into the room';
  broadcast?.(zoneId, { type: 'zone_event', message: `${player.handle} moves the ${row.name} ${where}.` }, player.id);
  return { type: 'output', message: wall ? `You move the ${row.name} ${where}.` : `You put the ${row.name} back ${where}.` };
}

// A piece placed, taken or boxed. A new player piece gets its spot now, and whoever has the room
// open is sent the piece again, told it's gone, or (no `id`: a whole room boxed) sent them all.
on('furniture.changed', ({ zoneId, id, gone }) => {
  (async () => {
    const main = mainOf(zoneId), spec = specOf(main);
    if (!spec) return;
    const pieces = await roomPieces(main, spec, { stamp: true });
    const set = viewers.get(main);
    if (!set?.size) return;
    const piece = id && !gone ? pieces.find((p) => p.id === id) : null;
    const msg = !id ? { pieces } : piece ? { piece } : { id, gone: true };
    for (const pid of set) sendToPlayer(pid, { type: 'room_piece', zone: main, ...msg });
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
  const ring = spec.balcony?.wrap ? spec.balcony : null;
  const u = Math.max(ring ? ring.u[0] : -spec.w / 2, Math.min(ring ? ring.u[1] : spec.w / 2, at[0])), v = Math.max(spec.balcony ? -spec.balcony.d - 0.14 : 0, Math.min(ring ? ring.wrap + ring.d : spec.annex ? annexFrame(spec).v0 + spec.annex.d : spec.d, at[1]));
  where.set(playerId, { zone: zoneId, at: [+u.toFixed(2), +v.toFixed(2)], yaw: Number.isFinite(yaw) ? +yaw.toFixed(3) : 0, seat: Number.isInteger(seat) ? seat : null });
  sendPeople(zoneId).catch(() => {});
});

// Whether the room you're in has a Stage, for the d-pad's room button. RAM only, and sent when the
// answer changes rather than on every step, so a walk down a street sends nothing.
const told = new Map();
function tellAvail(player, force = false) {
  const on = !!specOf(mainOf(player.current_zone)) && !loggedPanelsSync(player);
  if (!force && told.get(player.id) === on) return;
  told.set(player.id, on);
  sendToPlayer(player.id, { type: 'room_avail', on });
}
on('player.login', ({ id }) => { const p = id ? getLivePlayer(id) : null; if (p?.current_zone) tellAvail(p, true); });

// Walking out closes your Stage and tells both rooms who's in them now.
// (An NPC walking in or out changes who's there too.)
// Going between a flat and its en-suite is walking across the same Stage, so it stays open and the
// client is told which side of the door it's on; where they stood is kept, since it's still true.
on('zone.entered', ({ actor, zone, from }) => {
  if (!actor?.id) return;
  if (getLivePlayer(actor.id)) tellAvail({ ...actor, current_zone: zone });
  const main = mainOf(zone), was = from ? mainOf(from) : null;
  if (was && was === main) {
    if (viewersOf(main).has(actor.id)) sendToPlayer(actor.id, { type: 'room_here', zone: main, here: zone });
    sendPeople(main).catch(() => {});
    return;
  }
  if (was && viewersOf(was).has(actor.id)) { dropViewer(actor.id, was); sendToPlayer(actor.id, { type: 'room_close' }); }
  where.delete(actor.id);
  if (was) sendPeople(was).catch(() => {});
  sendPeople(main).catch(() => {});
});
on('posture.changed', ({ player }) => { if (player?.current_zone) sendPeople(mainOf(player.current_zone)).catch(() => {}); });
on('player.logout', ({ id }) => {
  if (!id) return;
  for (const [zoneId, set] of [...viewers]) if (set.has(id)) { dropViewer(id, zoneId); sendPeople(zoneId).catch(() => {}); }
  where.delete(id); lastPos.delete(id); told.delete(id);
});

export const commands = { room: cmdRoom, arrange: cmdArrange };

export const _test = { tellAvail, told, life, watching, viewers, where, roomPieces, specOf, viewPayload, peopleIn, resolveSpot, parseArrange, annexOf, mainOf, outlookOf, outlookPayload, skyTick };
