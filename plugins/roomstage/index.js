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
// ⚠ A BUILDING'S ROOMS ARE ONE WALK (docs/proposals/building-stage.md). A room on a building's walk
// carries `spec.openings`, its doorways; walking through one sends the ordinary `move <dir>`, and
// `zone.entered` sends the next room's `room_view` with `via` instead of `room_close`. A move that's
// refused sends nothing, and the client puts you back inside the doorway.
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
import { gatherHookSync } from '../../server/engine/plugins.js';
import { world, getZone, facadeStreetTile, getZoneFurniture, getZonePlayers, getZoneNpcs, getZoneEnemies, getApartment, updateFurniture, getLivePlayer, doorOnLink, frontDoorOf } from '../../server/engine/world.js';
import { walkPlans, buildingView, placeFrom } from '../../client/shared/building-graph.js';
import { getItem } from '../../server/engine/items-cache.js';
import { primaryExits } from '../../server/engine/exits.js';
import { on, emit } from '../../server/engine/events.js';
import { createNpcLife } from './npc-life.js';
import { createActs, pocketsOf } from './acts.js';
import { isNpcAsleep, isNpcAtWork } from '../../server/engine/ai-behaviour.js';
import { npcMoodOf, onNpcMoodChange } from '../../server/engine/npc-mood.js';
import { resolve as siftResolve } from '../../server/engine/sift.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { loggedPanelsSync } from '../../server/engine/presentation.js';
import { getBirdClock, getZoneTemperature, getEnvironmentState, getZonePowerStatus, getZoneEmergencyLighting } from '../../server/engine/environment.js';
import { isDwellingZone } from '../../server/engine/zone-tags.js';
import { feelOf, feelBand } from '../../client/shared/comfort.js';
import { playerControlsApt, doorGuardsOnlyUnownedApartment, isApartmentZone, getNpcResidence } from '../../server/engine/apartments.js';
import { getLockTagPublic, lockCanHack, lockNoun, checkLockAuth } from '../../server/engine/commands/doors.js';
import { lockTypePassesWhileLocked } from '../../server/engine/locks.js';
import { lockedOnLink } from '../../server/engine/movement-gates.js';
import { exitTargets } from '../../server/engine/exits.js';
import { ownsZone } from '../../server/engine/zone-filth.js';
import { lookOfPlayer } from '../../client/shared/player-figure.js';
import { placeSpot, roomSpecOf, resolveSpot, withAnnex, annexFrame, rowDrawn, layRows, facing, pitFloorAt, doorwaysOf } from '../../client/shared/room-layout.js';
import { roomLayout, roomPath, pathLength, pathAt, seatApproach, openingInside, roomNearFree } from '../../client/shared/room-layout.js';
import { schedule } from '../../server/engine/scheduler.js';
import { zoneOwnerId } from '../../server/engine/zone-filth.js';
import { mapWindow, skyState, FLIGHT_RADIUS, skylineNear, nearbyRegions, farRoadsNear, FAR_ROAD_R, worldContactsNear, fieldsNear } from '../flight/state.js';
import { streetActors } from '../../server/engine/street-actors.js';
import { TRAFFIC } from '../../client/shared/window-sky.js';
import { floorsOf, GROUND_FLOOR } from '../elevator/floors.js';
import { shopClosedFor, shopDoorDefeated, shopPlaceName, tradingHoursLine, reopensPhrase, shutOnPresenceOnly, livesHere } from '../commerce/shopdoor.js';

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
  // a chess table carries the position on it (plugins/gametable `room.boards`, RAM)
  const boards = Object.assign({}, ...gatherHookSync('room.boards', zoneId));
  return pieces.map((p) => ({ ...p, acts: furnitureActs(rows.get(p.id)), ...(boards[p.id] ? { board: boards[p.id] } : {}) }));
}

// ── a building's rooms (docs/proposals/building-stage.md) ────────────────────────────────────────
// The rooms of a building whose entry has a Stage, laid out as one plan (client/shared/building-graph.js),
// so a room's doorways can be cut and walking through one keeps the Stage open. Built from the world
// Maps the first time a room is opened and again when the count of zones or maps changes, never on a
// move. A building whose plan has problems isn't joined up: the content gate
// (scripts/content/building-stage.mjs) fails it, and here each of its rooms stays a Stage of its own.
let plans = null, plansKey = '';
export function buildingOfRoom(zoneId) {
  const key = `${world.zones.size}|${world.maps.size}`;
  if (!plans || key !== plansKey) {
    plansKey = key;
    plans = walkPlans({ zones: world.zones, maps: world.maps.values(), specOf: (z) => specOf(z.id) });
    doorList = null;
  }
  return plans.get(zoneId) || null;
}
const clearBuildings = () => { plans = null; doorList = null; roomsKept?.clear(); };
// THE STREET DOORS of every building with a Stage, for somebody on foot outside (plugins/freelook sends them with
// the street's window): the facade's tile, the edge its door is on (`flags.entrance`), how wide the doorway is
// in metres and whether it's a pair of automatic glass doors. The street view makes such a building solid and
// lets you in at its door. Built with the plans, from RAM; a building whose facade has no entrance has no door.
let doorList = null;
const EDGES = new Set(['north', 'south', 'east', 'west']);
export function streetDoorsNear(gx, gy, r) {
  buildingOfRoom(null);
  if (!doorList) {
    doorList = [];
    for (const bld of new Set(plans.values())) {
      const entry = bld.b.entry, spec = entry && specOf(entry), f = spec ? getZone(streetDoorOf(entry)) : null;
      const edge = String(f?.flags?.entrance || '').toLowerCase();
      if (!f || !EDGES.has(edge) || !Number.isFinite(f.grid_x) || !Number.isFinite(f.grid_y)) continue;
      const o = (buildingView(bld, entry, spec, { specOf }).spec.openings || []).find((x) => x.kind === 'front' && x.to === f.id);
      if (!o) continue;
      // the building rides along unsent (not enumerable), for buildingRoomsNear
      // how the glass doors look from the street, if the building says (flags.room.street_door: glass, trim, monogram)
      // (a plain door's leaf: `leaf` its colour and `bars` a steel grille over it, as the Cherry Pit's)
      const sd = getZone(entry)?.flags?.room?.street_door, look = sd && (sd.glass || sd.trim || sd.monogram || sd.kind === 'swing' || sd.leaf || sd.bars) ? { glass: sd.glass || null, trim: sd.trim || null, monogram: sd.monogram ? String(sd.monogram).slice(0, 2) : null, ...(sd.handle === 's' ? { handle: 's' } : {}), ...(sd.leaf ? { leaf: String(sd.leaf) } : {}), ...(sd.bars ? { bars: true } : {}) } : null;
      doorList.push(Object.defineProperty({ gx: f.grid_x, gy: f.grid_y, edge, w: +Math.abs(o.b - o.a).toFixed(2), slide: !!o.slide, ...(o.swing ? { swing: true } : {}), ...(look ? { look } : {}) }, 'bld', { value: bld }));
    }
  }
  return doorList.filter((d) => Math.abs(d.gx - gx) <= r && Math.abs(d.gy - gy) <= r);
}
// THE ROOMS OF EACH BUILDING WITH A STAGE NEAR A TILE, for the street view on foot to draw inside the city
// (docs/proposals/one-world-interiors.md): each room's spec as its Stage draws it, its pieces laid out and its
// frame (frameOf). Built from the world Maps and the furniture cache, never a query, and kept per building for
// ROOMS_KEEP_MS, since it rides along with every step's window. Lift cars are left out: they move.
const ROOMS_KEEP_MS = 30000, roomsKept = new Map();
export function buildingRoomsNear(gx, gy, r) {
  const out = [], now = Date.now();
  for (const d of streetDoorsNear(gx, gy, r)) {
    const f = d.bld;
    if (!f) continue;
    let kept = roomsKept.get(f);
    if (!kept || now - kept.at > ROOMS_KEEP_MS) {
      const tile = getZone(streetDoorOf(f.b.entry)), rooms = [];
      for (const id of Object.keys(f.plan.rooms)) {
        if (f.plan.lifts?.[id]) continue;
        const spec = stageSpec(id), frame = spec && tile ? frameOf(id, tile, null) : null;
        if (!frame) continue;
        const pieces = layRows(getZoneFurniture(id), spec, { finish: spec.finish, itemOf: (x) => (x.flags?.item_id ? getItem(x.flags.item_id) : null) }).pieces;
        rooms.push({ zone: id, spec, pieces, frame });
      }
      kept = { at: now, data: { tile: { x: d.gx, y: d.gy }, rooms } };
      roomsKept.set(f, kept);
    }
    out.push(kept.data);
  }
  return out;
}

// Both rooms on one building's walk: going between them is walking across the Stage.
const sameWalk = (a, b) => { const x = buildingOfRoom(a); return !!x && x === buildingOfRoom(b); };
// A room's spec as its Stage draws it: with its building's doorways when it's on a walk, so a piece
// laid out by the rules (placeSpot's keepClear) keeps out of them. Every layout of a room's pieces
// reads this, so the server stamps, the client draws and a resident walks round the same furniture.
function stageSpec(zoneId) {
  const spec = specOf(zoneId), bld = spec && buildingOfRoom(zoneId);
  return bld ? buildingView(bld, zoneId, spec, { specOf }).spec : spec;
}
// The rooms one doorway away on a building's walk. Somebody with one of them open sees into this
// room, so they're sent its people and pieces as they change.
function nextDoor(zoneId) {
  const bld = buildingOfRoom(zoneId), out = new Set();
  if (bld) for (const d of bld.plan.doors) if (d.kind === 'door' && d.to) { if (d.from === zoneId) out.add(d.to); else if (d.to === zoneId) out.add(d.from); }
  return [...out];
}
// Everybody who sees into a room: those with it open and those next door to it.
function watchersOf(zoneId) {
  const ids = new Set(viewers.get(zoneId) || []);
  for (const z of nextDoor(zoneId)) for (const id of viewers.get(z) || []) ids.add(id);
  return ids;
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
function outlookOf(zoneId, player = null) {
  const zone = getZone(zoneId), tile = zone ? buildingOf(zone) : null;
  if (!tile) return null;
  const frame = frameOf(zoneId, tile, player);
  return { gx: tile.grid_x, gy: tile.grid_y, storey: storeyOf(zone), storeys: Number(zone.flags?.room?.storeys) || null, bearing: frame ? frame.face : bearingOf(zone), ...(frame ? { frame } : {}) };
}

// Where a room of a building's walk stands in the world (client/game/js/panels/room-view.js inBuilding): the
// entry room's front wall as seen from this room, the tile edge the street door is on, and this room's floor in
// metres. A lift car is at the height of the floor it's open on for this rider. The plan's facings are compass
// bearings, so `face` is the room's own.
function frameOf(zoneId, tile, player) {
  const bld = buildingOfRoom(zoneId), R = bld?.plan.rooms[zoneId];
  if (!R) return null;
  const entry = placeFrom(bld.plan, zoneId, bld.b.entry);
  if (!entry) return null;
  let floor = R.floor;
  const car = bld.plan.lifts?.[zoneId];
  if (car) { const parked = liftOf(player, zoneId).parked, stop = parked && car.stops.find((s) => s.zone === parked); if (stop) floor = stop.y; }
  const side = BEARING[String(tile.flags?.entrance || '').toLowerCase()] ?? bld.plan.rooms[bld.b.entry]?.face ?? 0;
  return { entry: entry.at, front: bld.plan.rooms[bld.b.entry].face, side, floor, face: R.face };
}

// The world round the building, for GLASS to draw out of the window.
function outlookPayload(zoneId, player = null) {
  const at = outlookOf(zoneId, player);
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
// A club's dancers on shift: where each pole is, as a place to stand and a way to face. A pole is in the
// stage's front half and at the runway's tip (gl/room-fittings.js stage, runway); the dancer stands a
// quarter of a metre behind it on the piece's top, looking out over it. The runway's tip goes first.
// `lift` is over the floor under her feet, which is the pit's where the runway crosses one.
function polePostsOf(pieces, spec) {
  const out = [];
  for (const p of pieces) {
    if ((p.form !== 'runway' && p.form !== 'stage') || !Array.isArray(p.spot?.at) || !Array.isArray(p.dims)) continue;
    const [fu, fv] = facing(p.spot.turn || 0), [, d, h] = p.dims, z = p.form === 'runway' ? d / 2 - 0.35 : d / 2 * 0.2;
    const at = [p.spot.at[0] + fu * (z - 0.25), p.spot.at[1] + fv * (z - 0.25)].map((x) => +x.toFixed(2));
    out.push({ at, face: [+fu.toFixed(3), +fv.toFixed(3)], lift: +(h - (spec ? pitFloorAt(spec, at[0], at[1]) : 0)).toFixed(3), first: p.form === 'runway' });
  }
  return out.sort((a, b) => b.first - a.first);
}
// Somebody whose work is behind a piece (flags.post, a furniture id: a hotel's front desk, a counter):
// on shift in their work zone, they stand half a metre behind it (or `flags.post_gap` metres: a bartender works
// closer than a clerk), facing the way it faces.
function deskPostOf(n, zoneId, pieces) {
  const id = n.flags?.post;
  if (!id || n.work_zone_id !== zoneId || !isNpcAtWork(n)) return null;
  const p = pieces.find((q) => q.id === id);
  if (!p || !Array.isArray(p.spot?.at) || !Array.isArray(p.dims)) return null;
  const gap = Number(n.flags?.post_gap), [fu, fv] = facing(p.spot.turn || 0), back = p.dims[1] / 2 + (gap > 0 && gap < 1.5 ? gap : 0.5);
  return { at: [p.spot.at[0] - fu * back, p.spot.at[1] - fv * back].map((x) => +x.toFixed(2)), face: [+fu.toFixed(3), +fv.toFixed(3)] };
}
// A dancer at work: on her work zone's floor during her shift
const dancing = (n, zoneId) => !!n.flags?.stripper && n.work_zone_id === zoneId && isNpcAtWork(n);
// What an NPC is dressed for: work on shift, bed asleep at home, home off shift, and an evening out anywhere
// that isn't somebody's flat. Nothing by day in the street's clothes.
const asleepOf = (n) => !!n._ai?.homeSleeping || isNpcAsleep(n);
const atHome = (n, zoneId) => !!n.home_zone && mainOf(n.home_zone) === mainOf(zoneId);
function occasionOf(n, zoneId, asleep = asleepOf(n)) {
  if (asleep) return atHome(n, zoneId) ? 'sleep' : null;
  if (isNpcAtWork(n)) return 'work';
  if (atHome(n, zoneId)) return 'home';
  const hour = parseInt(getEnvironmentState().time, 10);
  return (hour >= 18 || hour < 3) && !isDwellingZone(getZone(zoneId)) ? 'out' : null;
}
// The look an NPC wears. An authored one for the occasion (flags.figure_work, figure_home, figure_sleep,
// figure_out) or the temperature (figure_cold, figure_hot) goes over their own. Where there's none, `wear` says
// what the client should dress them for by its own rules (client/shared/comfort.js wearFor): the occasion, and
// the temperature band. A uniform stays on whatever the weather, and somebody whose own look is authored
// doesn't dress up for the evening unless figure_out says how.
function dressedAs(n, zoneId, asleep, feel) {
  const own = n.flags?.figure || null, occ = occasionOf(n, zoneId, asleep), over = occ ? n.flags?.['figure_' + occ] : null;
  const band = feelBand(feel), temp = band < 0 ? n.flags?.figure_cold : band > 0 ? n.flags?.figure_hot : null;
  const figure = over || temp ? { ...(own || {}), ...(over || {}), ...(temp || {}) } : own;
  const wear = {};
  if (occ && occ !== 'work' && !over && !(occ === 'out' && own?.cut)) wear.occasion = occ;
  if (band && !temp && !(occ === 'work' && over)) wear.feel = band;
  // changed at the wardrobe (npc-life.js USE_STEPS): a different top at home, counted in RAM
  if (n._outfit && occ === 'home' && !over) wear.change = n._outfit;
  return { figure, wear: wear.occasion || wear.feel || wear.change ? wear : null };
}

// Somebody who's just come in at a card table's door (plugins/gametable `entered`): their route from just inside it
// to their chair or the dealer's end, and how much of it is left, or null once they're there. Worked out once per
// arrival; a room_people goes out when the walk ends so they're sat down. RAM only.
const WALK_IN_SPEED = 1.2;
const walkIns = new Map();
function walkIn(zoneId, pieces, t) {
  const key = `${zoneId}|${t.id}|${t.entered}`;
  let r = walkIns.get(key);
  if (r === undefined) {
    r = null;
    try {
      const spec = stageSpec(zoneId), L = spec && roomLayout(spec, pieces), annex = annexOf(zoneId)?.id;
      const o = L && doorwaysOf(spec).find((x) => x.to && x.to !== annex);
      let goal = null;
      if (o && t.on) { const s = L.seats.find((q) => q.piece === t.on); if (s) goal = seatApproach(L, s, 1.2); }
      if (o && t.dealerAt) {
        const q = L.placed.find((x) => x.id === t.dealerAt);
        if (q) { const [fu, fv] = facing(q.turn), back = q.d / 2 + 0.42; goal = roomNearFree(L, q.u - fu * back, q.v - fv * back, 1); }
      }
      const from = o && goal ? openingInside(L, o).at : null, path = from && roomPath(L, from, goal);
      if (path?.length > 1) r = { path, len: pathLength(path), ms: pathLength(path) / WALK_IN_SPEED * 1000 };
    } catch { r = null; }
    walkIns.set(key, r);
    for (const k of walkIns.keys()) if (walkIns.size > 64) walkIns.delete(k);
    if (r) { const left = t.entered + r.ms - Date.now(); if (left > 0) setTimeout(() => { walkIns.delete(key); sendPeople(zoneId).catch(() => {}); }, left + 60).unref?.(); }
  }
  if (!r) return null;
  const gone = Date.now() - t.entered;
  if (gone >= r.ms) return null;
  const q = pathAt(r.path, gone / r.ms * r.len);
  return { at: q.at.map((x) => +x.toFixed(2)), route: { path: [q.at, ...r.path.slice(q.leg)], ms: Math.round(r.ms - gone) } };
}

// Somebody knocking at a locked door (plugins/gametable `door.knock`): seen from the room they're knocking from, stood
// just inside its doorway to the room they want, facing it, rapping on it. Held a few seconds past each knock.
const KNOCK_HOLD_MS = 9_000;
const knockers = new Map();   // npcId -> { to, until }
function knockPost(npcId, zoneId, pieces) {
  const k = knockers.get(npcId);
  if (!k || Date.now() > k.until) { if (k) knockers.delete(npcId); return null; }
  const spec = stageSpec(zoneId), o = spec && doorwaysOf(spec).find((x) => x.to === k.to);
  if (!o) return null;
  const L = roomLayout(spec, pieces), p = openingInside(L, o).at;
  // facing out through the doorway: the way into the room from it, turned round
  const face = o.wall === 'front' ? [0, -1] : o.wall === 'back' ? [0, 1] : o.wall === 'left' ? [-1, 0] : [1, 0];
  return { at: p.map((x) => +x.toFixed(2)), face, clip: 'knock' };
}
on('door.knock', ({ outside, inside, knockerId }) => {
  if (!viewers.size) return;
  if (knockerId && outside) knockers.set(knockerId, { to: inside, until: Date.now() + KNOCK_HOLD_MS });
  // (the knock itself is heard through plugins/audio; the room outside is sent its people, the knocker at the door)
  const z = outside && mainOf(outside);
  if (z && viewersOf(z).size) sendPeople(z).catch(() => {});
});

function peopleIn(zoneId, pieces) {
  // how the room feels (client/shared/comfort.js): everybody in it idles and dresses by it
  const feel = feelOf(getZoneTemperature(zoneId));
  const byName = new Map(), posts = polePostsOf(pieces, specOf(zoneId));
  for (const p of pieces) if (!byName.has(p.name)) byName.set(p.name, p.id);
  const out = [], annex = annexOf(zoneId);
  for (const [id, inside] of [[zoneId, false], ...(annex ? [[annex.id, true]] : [])]) {
    const mark = inside ? { annex: true } : {};
    for (const pl of getZonePlayers(id)) {
      const w = where.get(pl.id);
      // what they're doing with their hands, as acts.js has it
      const a = acts.of(pl.id);
      out.push({ id: pl.id, name: pl.handle || pl.name, posture: pl.posture || 'standing', on: pl.sittingOn ? byName.get(pl.sittingOn) || null : null, sex: pl.biological_sex, look: lookOfPlayer(pl), ...mark,
        ...(w && w.zone === zoneId ? { at: w.at, yaw: w.yaw, seat: w.seat } : {}), ...(a ? { act: a.act, hold: a.hold, beat: a.beat } : {}) });
    }
    for (const n of getZoneNpcs(id)) {
      // an animal (a pet: plugins/pets) is drawn as itself by beastsIn, not as a person
      if (npcBeastOf(n)) continue;
      const on = n.onFurniture || n.sittingOn;
      // a dancer on shift takes the next free pole, and with none left works the floor
      const dancer = !inside && !on && dancing(n, id), post = dancer ? posts.shift() : null;
      const desk = !inside && !on && !post ? deskPostOf(n, id, pieces) : null;
      const st = knockPost(n.id, id, pieces) || (post ? { at: post.at, face: post.face, lift: post.lift } : desk || life.stageOf(n, zoneId));
      // an NPC's order, when it has one, so the client can dress them as it dresses (gl/room-people.js);
      // the room already shows who they are by name, so this tells a viewer nothing the tag doesn't
      const order = typeof n.faction === 'string' && n.faction.startsWith('ideology_') ? n.faction : undefined;
      // asleep or out cold, as the room text tags them, laid somewhere; and what they idle at
      const asleep = asleepOf(n), ko = !asleep && !!n._ai?.dosedOut, dressed = dressedAs(n, zoneId, asleep, feel);
      const lay = (asleep || ko || n.posture === 'lying') && !on && !st ? restingOn(pieces, inside, new Set(out.map((o) => o.on).filter(Boolean))) : null;
      // a dancer half undressed or more (plugins/strippers peels her as the tips come in) dances hotter
      const layers = Array.isArray(n.flags?.clothing_layers) ? n.flags.clothing_layers.length : 0;
      const peel = dancer && layers ? Math.max(0, Math.min(layers, n._clothingPeeled || 0)) / layers : 0;
      const hot = peel >= 0.5 ? 'Hot' : '';
      // somebody at their post behind a bar or a counter still idles at their work there
      const manner = post ? 'pole' + hot : dancer && !asleep && !ko ? 'floor' + (hot || 'work') : (st && st !== desk) || asleep || ko ? null : mannerOf(n);
      // the mood their face shows (server/engine/npc-mood.js, client/shared/expressions.js)
      const mood = npcMoodOf(n);
      // their sex and any settled look, which the close-up figure draws them by (gl/room-people.js)
      out.push({ id: n.id, name: n.name, npc: true, posture: n.posture || 'standing', on: on ? byName.get(on) || null : null, sex: n.sex, ...(dressed.figure ? { figure: dressed.figure } : {}), ...(dressed.wear ? { wear: dressed.wear } : {}), ...(feel ? { feel } : {}), ...mark, ...(order ? { order } : {}),
        ...(asleep ? { asleep: true } : {}), ...(ko ? { out: true } : {}), ...(manner ? { manner } : {}), ...(mood ? { mood } : {}), ...(lay || {}), ...(st || {}),
          // a dancer on shift takes tips (the Stage puts a Tip button on her card), and how much she has off
          ...(dancer && n.flags?.stripper ? { tip: true, ...(peel ? { peel: Math.round(peel * 100) / 100 } : {}) } : {}) });
    }
  }
  // who's at a card table (plugins/gametable `room.tablePeople`): somebody in the room already goes onto their chair,
  // and a gambler seated from elsewhere, or a hired dealer, is added. Only pieces this room lays out.
  const ids = new Set(pieces.map((p) => p.id));
  for (const t0 of gatherHookSync('room.tablePeople', zoneId).flat()) {
    if (!t0 || (t0.on && !ids.has(t0.on)) || (t0.dealerAt && !ids.has(t0.dealerAt))) continue;
    // just come in at the door: walked from it to their place, and put there once the walk is over
    const w = t0.entered ? walkIn(zoneId, pieces, t0) : null, { entered: _e, ...t1 } = t0;
    const t = w ? { id: t1.id, name: t1.name, npc: t1.npc, sex: t1.sex, posture: 'standing', ...w } : t1;
    const have = out.find((o) => o.id === t.id);
    if (have && w) { Object.assign(have, { posture: 'standing', on: null, ...w }); delete have.manner; continue; }
    if (have) { Object.assign(have, t.on ? { posture: 'sitting', on: t.on } : { dealerAt: t.dealerAt }); delete have.at; delete have.manner; continue; }
    out.push({ ...t, ...(feel ? { feel } : {}) });
  }
  return out;
}

// The animals in a room: an enemy whose content names a fauna model (flags.fauna, "kind/id") is drawn on the Stage's
// floor from the model GLASS draws it with (client gl/room-beasts.js). One without a model isn't drawn: there's
// nothing to draw it from, and a person-shaped stand-in for a hound would be a lie. Sync and RAM-only.
function beastsIn(zoneId) {
  const out = [], annex = annexOf(zoneId);
  for (const [id, inside] of [[zoneId, false], ...(annex ? [[annex.id, true]] : [])]) {
    for (const e of getZoneEnemies(id)) {
      const fauna = e.flags?.fauna;
      if (e._dead || typeof fauna !== 'string' || !fauna.includes('/')) continue;
      out.push({ id: e.instanceId, name: e.name, fauna, ...(inside ? { annex: true } : {}) });
    }
    // and an NPC that a plugin says is an animal (a pet), drawn from what it answers with
    for (const n of getZoneNpcs(id)) {
      const b = npcBeastOf(n);
      if (b) out.push({ ...b, ...(inside ? { annex: true } : {}) });
    }
  }
  return out;
}
// Whether an NPC is an animal the stage should draw as one: the first plugin to answer `roomstage.npcBeast` with
// { id, name, cat | fauna } owns it (plugins/pets for a pet). Sync, RAM-only; null for a person.
function npcBeastOf(n) {
  if (!n?.flags?.animal) return null;
  return gatherHookSync('roomstage.npcBeast', n)[0] || null;
}
const beastSig = (zoneId) => beastsIn(zoneId).map((b) => b.id).join('|');

function controls(player, zoneId) {
  return playerControlsApt(player, getApartment(zoneId)) || ownsZone(zoneId, player?.id);
}

// ── THE LOCKS ON A ROOM'S DOORWAYS (docs/proposals/room-hololock.md) ─────────────────────────────
// A doorway the Stage cuts is a hole, so a locked door was a hole you walked into for 1.8 s before it said no.
// For each doorway whose door carries a lock, this says what the Stage needs to draw the door and its hololock:
// whether it's locked, whether it would let this player walk through (`pass`, the move gate's own answer), whether
// they could unlock it (`yours`) and whether it can be hacked. It draws and offers; `unlock`, `lock` and `hack`
// are still the verbs that do it, and the move gate still refuses the step.
// ⚠ `pass` READS lockedOnLink, THE GATE'S DRAWN HALF, so a shop an NPC locked up still lets you walk out of it.
// ⚠ AUTH IS ASYNC (a keycard is an inventory read), so this runs when a room opens and when a lock changes, never
// on a tick. The sweep below compares `lockSig`, which is RAM.
const lockDoorOf = (zoneId, o) => doorOnLink(zoneId, o.dir, o.to) || (o.kind === 'front' ? frontDoorOf(getZone(o.to)) : null);
// ⚠ EVERY DOOR, NOT ONLY A LOCKED ONE, AND `open` IS THE DOOR'S OWN `is_open`. A door in the Stage is shut until
// somebody opens it (`open door <dir>`) and stays open until somebody closes it, so the client draws exactly what
// the door row says and never opens one because you walked up to it. A doorway with no door row is an open
// archway, as before; a broken door (hp 0) is one too. The street's glass doors and a lift's are automatic
// (`slide`) and aren't in this list. A lock on a flat nobody rents is vestigial, so that door reads unlocked.
// A shop past a doorway with no door row of its own (a café up a tower) is shut by its hours alone
// (plugins/commerce shop-hours gate): it's drawn as a shut door whose hologram gives the hours.
function lockedWays(zoneId, spec) {
  const out = [];
  for (const o of doorwaysOf(spec || {})) {
    if (o.slide) continue;
    const door = lockDoorOf(zoneId, o);
    if (!door) {
      const to = getZone(o.to), shut = to && shopClosedFor(to);
      if (shut && !shopDoorDefeated(to)) out.push({ o, door: null, shop: shut });
      continue;
    }
    if (!(door.hp > 0)) continue;
    const tag = doorGuardsOnlyUnownedApartment(door) ? null : getLockTagPublic(door);
    out.push({ o, door, tag });
  }
  // THE EN-SUITE'S DOOR. It isn't one of the doorways (doorwaysOf leaves it out: it's the annex's own gap in the
  // back wall), but its door row is a lock like any other, a privacy bolt, so it's drawn and offered the same way.
  const A = spec?.annex, door = A && doorOnLink(zoneId, 'in', A.zone);
  if (door && door.hp > 0) out.push({ o: { kind: 'door', annex: true, dir: 'in', to: A.zone }, door, tag: getLockTagPublic(door) });
  return out;
}
// whether a room's Stage carries locks at all: a building's rooms, and any flat with an en-suite
const hasLocks = (zoneId, spec) => !!buildingOfRoom(zoneId) || !!spec?.annex;
// WHOSE UNIT A DOOR IS (`owner` on a lock, lettered on its hologram): the flat past the doorway, or the one you're
// stood in. The resident NPC's name, the tenant's handle, or "Vacant"; a door on no flat has none. It's what the
// room text says inside (describeApartmentStatus). The residence table is cached, so this is RAM after the first.
const unitOf = (zoneId, o) => [o.to, zoneId].find((z) => isApartmentZone(getZone(z))) || null;
async function unitOwner(zoneId, o) {
  const unit = unitOf(zoneId, o);
  if (!unit) return null;
  return (await getNpcResidence(unit))?.npc_name || getApartment(unit)?.owner_handle || 'Vacant';
}
const lockSig = (zoneId, spec) => lockedWays(zoneId, spec).map(({ o, door }) => !door ? `shop:${o.to}` : `${door.id}:${door.lock_state}:${door.is_open ? 1 : 0}:${door._autoLockedInside || ''}:${getApartment(unitOf(zoneId, o))?.owner_id || ''}`).join('|');
async function locksOf(player, zoneId, spec) {
  return Promise.all(lockedWays(zoneId, spec).map(async ({ o: way, door, tag, shop }) => {
    let o = way;
    if (shop) {
      const to = getZone(o.to), hours = tradingHoursLine(shop), mine = livesHere(player, to);
      return { to: o.to, dir: o.dir, door: `shop:${o.to}`, open: false, lock: true, shop: true, locked: !mine, yours: mine, pass: mine, hack: false,
        owner: shopPlaceName(to) || to?.name || '', hours: hours || '', reopens: shutOnPresenceOnly(shop) ? `${shop.name} isn't in yet.` : `Opens again ${reopensPhrase(shop)}.` };
    }
    // the en-suite's door is worked from whichever side you're on: from inside it's `out` to the flat
    const inside = !!o.annex && player.current_zone === o.to;
    if (inside) o = { ...o, dir: 'out', to: zoneId };
    const from = inside ? player.current_zone : zoneId;
    const open = !!door.is_open, owner = o.annex ? null : await unitOwner(zoneId, o), base = { to: o.to, dir: o.dir, door: door.id, open, ...(owner ? { owner } : {}), ...(o.annex ? { annex: true, inside } : {}) };
    if (!tag) return { ...base, lock: false, locked: false, yours: false, pass: true, hack: false };
    const locked = door.lock_state === 'locked';
    const auth = await checkLockAuth(tag, door, player), staff = ['admin', 'dev'].includes(player.role);
    const shut = locked && !!lockedOnLink(player, getZone(from), o.dir, getZone(o.to));
    // staff at a lock that doesn't know them: the card offers Override and won't let them push through, so opening
    // somebody's flat goes through `unlock` and plays the override on the hologram
    const over = locked && staff && !auth;
    return { ...base, lock: true, noun: lockNoun(tag), locked, yours: auth || staff, ...(over ? { staff: true } : {}),
      pass: !over && (!shut || (auth && lockTypePassesWhileLocked(tag.type))), hack: lockCanHack(tag) };
  }));
}
// zoneId -> the last lockSig its viewers were sent
const lockSeen = new Map();
async function sendLocks(zoneId, override = null, fx = null) {
  const set = viewersOf(zoneId);
  if (!set.size) return;
  const spec = stageSpec(zoneId);
  lockSeen.set(zoneId, lockSig(zoneId, spec));
  for (const id of set) { const p = getLivePlayer(id); if (p) sendToPlayer(id, { type: 'room_locks', zone: zoneId, locks: await locksOf(p, zoneId, spec), ...(override ? { override } : {}), ...(fx ? { fx } : {}) }); }
}
// A lock somebody worked by hand is sent at once; the sweep catches the rest (an NPC locking up, closing time, a
// rent lapsing), which write `lock_state` with no event. With no room open it's one Map.size.
const lockTouched = (door, override = false, fx = null) => {
  if (!door || !viewers.size) return;
  for (const z of new Set([door.zone_id, door.target_zone, ...exitTargets(getZone(door.zone_id), door.exit_dir)].filter(Boolean).map(mainOf))) sendLocks(z, override ? door.id : null, fx).catch(() => {});
};
// (every cue: a door opened or shut by hand, and one somebody walked through, which the engine opens for the
// step and shuts behind them)
// `override`: staff opened a lock that wasn't theirs to open, which the hologram plays as an override
// `npcPass`: a resident keyed through their own locked door with a player watching; the lock's state never
// changed, so the card is told to play it (`fx`)
on('door.sfx', ({ door, override, npcPass, cue }) => lockTouched(door, !!override, npcPass ? { door: door.id, cue } : null));
on('hololock.breached', ({ door }) => lockTouched(door));
export function lockSweep() {
  for (const z of [...lockSeen.keys()]) if (!viewers.has(z)) lockSeen.delete(z);
  for (const [zoneId, set] of viewers) {
    if (!set.size || !hasLocks(zoneId, stageSpec(zoneId))) continue;
    if (lockSig(zoneId, stageSpec(zoneId)) !== (lockSeen.get(zoneId) ?? '')) sendLocks(zoneId).catch(() => {});
  }
}
schedule('5s', () => { if (viewers.size) lockSweep(); });
// An enemy coming in, leaving or dying has no event of its own (ai-behaviour.js moves it, combat.js kills it), so
// the rooms somebody has open are compared against what was last sent. RAM only, and nothing runs with nobody looking.
const beastSeen = new Map();
schedule('2s', () => {
  if (!viewers.size) return;
  for (const zoneId of viewers.keys()) {
    if (beastSig(zoneId) !== (beastSeen.get(zoneId) ?? '')) { beastSeen.set(zoneId, beastSig(zoneId)); sendPeople(zoneId).catch(() => {}); }
  }
  for (const z of beastSeen.keys()) if (!viewers.has(z)) beastSeen.delete(z);
});

async function viewPayload(player, zoneId, spec, { stamp = true, locks = true } = {}) {
  const zone = getZone(zoneId);
  // a room in a building carries its doorways, which the client cuts and walks through, and the rooms
  // past them, furnished and with whoever's in them, which it draws through the doorways
  const bld = buildingOfRoom(zoneId);
  let building = null;
  // a lift car is open on the floor it stands at for this rider (plugins/elevator), and carries its
  // panel: every floor it really stops at, the lowest first, and which one it's at
  const lift = bld?.plan.lifts?.[zoneId] ? liftOf(player, zoneId) : null;
  if (bld) {
    ({ spec, building } = buildingView(bld, zoneId, spec, { specOf, nameOf: (id) => getZone(id)?.name || '', parked: lift?.parked || null }));
    await Promise.all(building.neighbours.map(async (n) => {
      n.pieces = await roomPieces(n.zone, stageSpec(n.zone));
      n.people = peopleIn(n.zone, n.pieces);
      // a lift car next door carries its panel too, so it's on the car's wall before you step in
      if (bld.plan.lifts?.[n.zone] && !n.lift) n.lift = liftOf(player, n.zone);
      n.power = powerOf(n.zone);
    }));
  }
  const pieces = await roomPieces(zoneId, spec, { stamp });
  // where the window looks out from, without the map: a Stage that keeps the last room's view running moves
  // it here at once, before this room's `room_outlook` comes
  const place = outlookOf(zoneId, player);
  // the locks on its doorways (locksOf); a room sent ahead goes without, since nobody's at its doors yet
  const lockable = locks && (bld || spec?.annex);
  const ways = lockable ? await locksOf(player, zoneId, spec) : [];
  if (lockable) lockSeen.set(zoneId, lockSig(zoneId, spec));
  return { type: 'room_view', zone: zoneId, here: player.current_zone, name: zone?.name || '', spec, ...(building ? { building } : {}), ...(lift ? { lift: { floors: lift.floors, at: lift.at } } : {}), hasView: !!place, ...(place ? { place } : {}), mine: !!controls(player, zoneId), you: player.id,
    pieces, people: peopleIn(zoneId, pieces), beasts: beastsIn(zoneId), tv: life.tvOf(zoneId), clock: getBirdClock(), ...(ways.length ? { locks: ways } : {}),
    // whether the mains are on (powerOf); the switch by the door is the viewer's own, kept per room on the client
    power: powerOf(zoneId),
    // what's over the glass (glassOf): a control panel's shutters and the scene on them (plugins/envcontrol)
    ...(glassOf(zoneId) ? { glass: glassOf(zoneId) } : {}),
    // water that moves (plumbingOf): a running shower, a toilet's bowl, a stream into it (plugins/bodily)
    plumbing: plumbingOf(zoneId),
    // what stands on a depot shed's lift, and this viewer's trucks to call up (plugins/trucking hoist.js)
    ...(vehiclesOf(zoneId, player) ? { vehicles: vehiclesOf(zoneId, player) } : {}),
    // what's sprayed on its walls (plugins/graffiti `room.tags`), drawn on the plaster
    ...(tagsOf(zoneId).length ? { tags: tagsOf(zoneId) } : {}),
    // as the keypad's advert goes (plugins/concealment): an owned room's is the owner's business
    keypad: pieces.some((p) => p.keypad) && (!zoneOwnerId(zoneId) || String(zoneOwnerId(zoneId)) === String(player.id)) };
}

// ⚠ THE ROOMS PAST THE NEXT DOORWAY, SENT AHEAD (`room_ahead`, after every `room_view` in a building). Walking
// through a doorway, the client used to build the next room and every room round it in the one frame the crossing
// landed in, and each person it hadn't drawn yet: 80 to 200 ms of rooms and 180 ms a person. So for each room one
// doorway away this sends what that room's own `room_view` would carry, and the client builds it before you get
// there (room-stage.js `roomAhead`). It's made by viewPayload itself, so what's baked is what the crossing asks for;
// a room whose pieces change in between is just built at the crossing, as before.
// Its own pieces aren't sent again (`room_view` gave them as a neighbour's), nor the room you're in (the client
// has it). Nothing is written (`stamp: false`) and nothing is queried: the furniture comes off the cache.
async function aheadPayload(player, view) {
  const rooms = (await Promise.all((view.building?.neighbours || []).map(async (n) => {
    const spec = specOf(n.zone);
    if (!spec) return null;
    const v = await viewPayload(player, n.zone, spec, { stamp: false, locks: false });
    // where its window looks out from, so a windowless hall can turn the view to it before you go in
    const place = outlookOf(n.zone, player);
    return { zone: n.zone, spec: v.spec, power: v.power, ...(v.lift ? { lift: v.lift } : {}), ...(place ? { place } : {}),
      neighbours: (v.building?.neighbours || []).map((x) => (x.zone === view.zone ? { zone: x.zone, name: x.name, spec: x.spec, power: powerOf(x.zone) } : x)) };
  }))).filter(Boolean);
  return rooms.length ? { type: 'room_ahead', zone: view.zone, rooms } : null;
}
// After the room itself and its outlook, so the room you're walking into is never waiting on the ones past it.
function sendAhead(player, view) {
  aheadPayload(player, view).then((m) => { if (m && viewersOf(view.zone).has(player.id)) sendToPlayer(player.id, m); })
    .catch((e) => console.error('[roomstage] ahead:', e.message));
}

// A lift car's panel for one rider: its floors and where it's parked (plugins/elevator/floors.js).
function liftOf(player, zoneId) {
  const car = getZone(zoneId), at = player?._elevatorAt;
  const parked = at && at.car === zoneId && at.zone !== zoneId ? at.zone : null;
  const floors = floorsOf(car).map((f) => ({ n: f.n, label: f.label })).sort((a, b) => a.n - b.n);
  return { floors, parked, at: parked ? at.n : GROUND_FLOOR };
}

const viewersOf = (zoneId) => viewers.get(zoneId) || new Set();
function dropViewer(playerId, zoneId) {
  const set = viewers.get(zoneId);
  if (!set) return;
  set.delete(playerId);
  if (!set.size) viewers.delete(zoneId);
}

// Another plugin changed how somebody in a room looks or what they're at (plugins/strippers, a dancer peeling or
// dressing): send the room's people again to whoever has it open. Nothing is sent when nobody has.
export function peopleChanged(zoneId) { sendPeople(zoneId).catch(() => {}); }
// Who's in the room, to everybody with it open, and to anybody next door to it (they see in).
async function sendPeople(zoneId) {
  const set = watchersOf(zoneId);
  if (!set.size) return;
  const spec = stageSpec(zoneId);
  if (!spec) return;
  const people = peopleIn(zoneId, await roomPieces(zoneId, spec));
  const beasts = beastsIn(zoneId);
  beastSeen.set(zoneId, beasts.map((b) => b.id).join('|'));
  for (const id of set) sendToPlayer(id, { type: 'room_people', zone: zoneId, people, beasts, tv: life.tvOf(zoneId) });
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
// (residents walk round the room as its Stage lays it out, doorways and all)
const life = createNpcLife({ viewers, annexOf, mainOf, specOf: stageSpec, roomPieces, sendPeople, busy, tvOn, feelOf: (zoneId) => feelOf(getZoneTemperature(zoneId)) });
// a player's act changed: the room they're in, if anybody has it open
// a MORPHEX change shows on the body at once, to everyone with the room open (client/shared/player-figure.js)
on('appearance.changed', ({ actor }) => { const z = actor?.current_zone && mainOf(actor.current_zone); if (z && watchersOf(z).size) sendPeople(z).catch(() => {}); });
const acts = createActs({ changed: (playerId) => { const z = getLivePlayer(playerId)?.current_zone; if (z && watchersOf(mainOf(z)).size) sendPeople(mainOf(z)).catch(() => {}); } });
// What everybody in a watched room is dressed for, and the band they're dressed against. When it changes (a
// shift starts, somebody goes to bed, the evening comes, the heating fails) the room's viewers get the people
// again, so the clothes change on the screen. RAM and no query: a string per watched room every 5 s.
const wearSeen = new Map();
function wearSweep() {
  for (const zoneId of wearSeen.keys()) if (!viewers.get(zoneId)?.size) wearSeen.delete(zoneId);
  for (const [zoneId, set] of viewers) {
    if (!set.size) continue;
    const annex = annexOf(zoneId), band = feelBand(feelOf(getZoneTemperature(zoneId)));
    const sig = band + '|' + [...getZoneNpcs(zoneId), ...(annex ? getZoneNpcs(annex.id) : [])].map((n) => n.id + ':' + (occasionOf(n, zoneId) || '')).sort().join();
    const was = wearSeen.get(zoneId);
    wearSeen.set(zoneId, sig);
    if (was !== undefined && was !== sig) sendPeople(zoneId).catch(() => {});
  }
}
schedule('5s', wearSweep);
const tvMoved = (playerId) => { for (const [zoneId, set] of viewers) if (set.has(playerId)) life.tvChanged(zoneId); };
on('tv.watch', ({ playerId }) => { watching.add(playerId); tvMoved(playerId); });
on('tv.unwatch', ({ playerId }) => { watching.delete(playerId); tvMoved(playerId); });
on('tv.poweroff', ({ playerId }) => { watching.delete(playerId); tvMoved(playerId); });
schedule('5s', () => life.tick());
on('npc.home.scene', (e) => life.scene(e));
// a face changes as soon as the mood does
onNpcMoodChange((n) => { const z = n.zoneId ?? n.zone_id; if (z && watchersOf(mainOf(z)).size) sendPeople(mainOf(z)).catch(() => {}); });
on('npc.ritual', (e) => life.ritual(e));
on('npc.banter.start', (e) => life.talkStart(e));
on('npc.banter.end', (e) => life.talkEnd(e));
// home talk (plugins/ambient-life/home-talk.js): a gesture per line, and what they do about how it went
on('npc.talk.line', (e) => life.talkLine(e));
on('npc.talk.after', (e) => life.afterTalk(e));

// ── room ────────────────────────────────────────────────────────────────────────────────────────
async function cmdRoom(args, raw, player) {
  const zoneId = mainOf(player.current_zone), a0 = String(args[0] || '').toLowerCase();
  // On a street tile there's no Stage: the room button opens the street on foot in GLASS instead
  // (plugins/freelook answers `roomstage.onfoot`), and the same verb shuts it.
  const spec = specOf(zoneId);
  if (!spec && onStreet(player)) {
    if (loggedPanelsSync(player)) return { type: 'error', message: 'The 3-D view needs the Visual or Text Games display mode.' };
    emit('roomstage.onfoot', { player, zone: player.current_zone, close: a0 === 'close' || a0 === 'leave' });
    return { type: 'noop' };
  }
  if (a0 === 'close' || a0 === 'leave') {
    dropViewer(player.id, zoneId);
    sendToPlayer(player.id, { type: 'room_close' });
    return { type: 'noop' };
  }
  if (!spec) return { type: 'error', message: "There's no walking round this place in 3-D. Flats and furnished rooms have it." };
  if (loggedPanelsSync(player)) return { type: 'error', message: 'The 3-D room needs the Visual or Text Games display mode. Everything in it is in the room text.' };
  let set = viewers.get(zoneId);
  if (!set) viewers.set(zoneId, (set = new Set()));
  set.add(player.id);
  await life.settleIn(zoneId);
  const view = await viewPayload(player, zoneId, spec);
  sendToPlayer(player.id, view);
  const outlook = outlookPayload(zoneId, player);
  if (outlook) sendToPlayer(player.id, outlook);
  sendAhead(player, view);
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
  const spec = stageSpec(zoneId);
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
// open is sent the piece again, told it's gone, or (no `id`: a whole room boxed) sent them all. So is
// anybody next door to it, who sees it through the doorway.
on('furniture.changed', ({ zoneId, id, gone }) => {
  (async () => {
    const main = mainOf(zoneId), spec = stageSpec(main);
    if (!spec) return;
    const pieces = await roomPieces(main, spec, { stamp: true });
    const set = watchersOf(main);
    if (!set.size) return;
    const piece = id && !gone ? pieces.find((p) => p.id === id) : null;
    const msg = !id ? { pieces } : piece ? { piece } : { id, gone: true };
    for (const pid of set) sendToPlayer(pid, { type: 'room_piece', zone: main, ...msg });
  })().catch((e) => console.error('[roomstage] furniture.changed:', e.message));
});

// ⚠ WHAT'S OVER THE GLASS: shutters a room's control panel has lowered and the scene they show (plugins/envcontrol
// `room.glass`, a sync gather, so it's RAM). `room_view` carries it, and a change is sent to whoever has the room open.
const glassOf = (zoneId) => gatherHookSync('room.glass', zoneId)[0] || null;
on('room.glassChanged', ({ zoneId, glass }) => {
  const main = mainOf(zoneId);
  for (const pid of viewersOf(main)) sendToPlayer(pid, { type: 'room_glass', zone: main, glass });
});

// ⚠ THE LIGHTS GO WITH THE MAINS (server/engine/environment.js). A room's lights are on unless its zone is on the grid and
// the grid is down ('offline'): then 'low' if it keeps emergency lighting, else 'off'. 'powered' and 'overloaded' are on,
// and so is a room with no power_zones row (getZonePowerStatus answers 'unpowered' for it) or one the sim hasn't reached
// yet: a room nobody wired is lit as it always was. Two Map reads, so it's safe on every view. A change is sent to
// whoever has a room of that building open, since the rooms next door are drawn lit or dark too.
function powerOf(zoneId) {
  if (getZonePowerStatus(zoneId) !== 'offline') return 'on';
  return getZoneEmergencyLighting(zoneId) ? 'low' : 'off';
}
on('zone.power.changed', ({ zoneId, prevStatus, status }) => {
  if ((prevStatus === 'offline') === (status === 'offline') || !viewers.size) return;
  const bld = buildingOfRoom(zoneId), power = powerOf(zoneId);
  for (const [z, set] of viewers) {
    if (z !== zoneId && (!bld || buildingOfRoom(z) !== bld)) continue;
    for (const pid of set) sendToPlayer(pid, { type: 'room_power', zone: zoneId, power });
  }
});

// ⚠ WATER THAT MOVES: a running shower, a toilet's bowl and a stream into it (plugins/bodily `room.plumbing`, a sync
// gather, so it's RAM), keyed by furniture id, for the flat and its en-suite together. `room_view` carries it, and a
// change is sent to whoever has the room open as `room_plumbing`.
function plumbingOf(zoneId) {
  const annex = annexOf(zoneId), out = {};
  for (const id of [zoneId, ...(annex ? [annex.id] : [])]) Object.assign(out, ...gatherHookSync('room.plumbing', id));
  return out;
}
on('room.plumbingChanged', ({ zoneId }) => {
  const main = mainOf(zoneId), set = watchersOf(main);
  if (!set.size) return;
  const plumbing = plumbingOf(main);
  for (const pid of set) sendToPlayer(pid, { type: 'room_plumbing', zone: main, plumbing });
});

// ⚠ THE POSITION ON A CHESS TABLE (plugins/gametable `room.boards`): `room_view` carries it on the table's piece, and
// each move is sent to whoever has the room open as `room_board`, so the client redraws that piece and nothing else.
on('room.boardChanged', ({ zoneId }) => {
  const main = mainOf(zoneId), set = viewersOf(main);
  if (!set.size) return;
  for (const [piece, board] of Object.entries(Object.assign({}, ...gatherHookSync('room.boards', zoneId)))) {
    for (const pid of set) sendToPlayer(pid, { type: 'room_board', zone: main, piece, board });
  }
  // and the people again when who's at a card table changed: somebody sat in, got up, a dealer came or went
  const sig = gatherHookSync('room.tablePeople', zoneId).flat().filter(Boolean).map((t) => `${t.id}@${t.on || t.dealerAt}`).join('|');
  if (tableSeen.get(zoneId) !== sig) { tableSeen.set(zoneId, sig); sendPeople(main).catch(() => {}); }
});
const tableSeen = new Map();

// ⚠ PAINT ON THE WALLS: a tag sprayed on the room's own wall, or its en-suite's (plugins/graffiti `room.tags`, a sync
// gather, so it's RAM). `room_view` carries them, and a tag going up or coming down is sent to whoever has the room
// open as `room_tags`, the whole list. A street wall's tag is GLASS's (`wall.tags`) and never reaches a room.
function tagsOf(zoneId) {
  const annex = annexOf(zoneId);
  return [zoneId, ...(annex ? [annex.id] : [])].flatMap((id) => gatherHookSync('room.tags', id).flat()).filter((t) => t && t.t);
}
function tagsChanged({ zoneId, targetZoneId }) {
  if (!zoneId || (targetZoneId && targetZoneId !== zoneId)) return;
  const main = mainOf(zoneId), set = viewersOf(main);
  if (!set.size) return;
  const tags = tagsOf(main);
  for (const pid of set) sendToPlayer(pid, { type: 'room_tags', zone: main, tags });
}
on('graffiti.tagged', tagsChanged);
on('graffiti.removed', tagsChanged);

// ⚠ WHAT STANDS ON THE FLOOR: a truck on a depot shed's lift (plugins/trucking `room.vehicles`, a sync gather, so
// it's RAM). It's per viewer (your own trucks are the ones you can call up), so a change is gathered for each.
const vehiclesOf = (zoneId, player) => gatherHookSync('room.vehicles', zoneId, player)[0] || null;
on('room.vehiclesChanged', ({ zoneId }) => {
  const main = mainOf(zoneId);
  for (const pid of viewersOf(main)) { const p = getLivePlayer(pid); if (p) sendToPlayer(pid, { type: 'room_vehicles', zone: main, vehicles: vehiclesOf(main, p) }); }
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
// a tile of the world map, where `room` opens the street on foot
function onStreet(player) { const z = getZone(player.current_zone); return z?.map_id === 'map_world' && !z.flags?.is_building; }
function tellAvail(player, force = false) {
  const on = (!!specOf(mainOf(player.current_zone)) || onStreet(player)) && !loggedPanelsSync(player);
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
    if (viewersOf(main).has(actor.id)) {
      sendToPlayer(actor.id, { type: 'room_here', zone: main, here: zone });
      // the en-suite's door is worked from the side you're on now
      const p = getLivePlayer(actor.id), spec = stageSpec(main);
      if (p && spec?.annex) locksOf(p, main, spec).then((locks) => sendToPlayer(actor.id, { type: 'room_locks', zone: main, locks })).catch(() => {});
    }
    sendPeople(main).catch(() => {});
    return;
  }
  // Through a doorway to the next room of the same building: the Stage stays open on the room you're
  // in now, and `via` tells the client which doorway you came through, so it stands you inside it.
  if (was && viewersOf(was).has(actor.id) && sameWalk(was, main)) {
    dropViewer(actor.id, was);
    where.delete(actor.id);
    crossInto(actor.id, main, was).catch((e) => console.error('[roomstage] crossing:', e.message));
    sendPeople(was).catch(() => {});
    return;
  }
  // Out of the street door (building-stage.md step 5): the street, on foot, in GLASS (plugins/freelook
  // answers `roomstage.street`), and the Stage stays up until that view is drawn
  const facade = was && viewersOf(was).has(actor.id) && getZone(zone)?.map_id === 'map_world' && buildingOfRoom(was) ? streetDoorOf(was, zone) : null;
  if (facade) {
    dropViewer(actor.id, was);
    where.delete(actor.id);
    sendToPlayer(actor.id, { type: 'room_close', street: true });
    emit('roomstage.street', { player: getLivePlayer(actor.id) || actor, from: was, zone, facade });
    sendPeople(was).catch(() => {});
    return;
  }
  // In off the street on foot, into a building drawn as a Stage: it opens stood in its street door
  const walker = getLivePlayer(actor.id);
  if (walker?._onFoot && from && getZone(from)?.map_id === 'map_world' && buildingOfRoom(main) && specOf(main)) {
    walker._onFoot = false;
    emit('roomstage.indoors', { player: walker, zone: main });
    crossInto(actor.id, main, streetDoorOf(main) || from).catch((e) => console.error('[roomstage] in off the street:', e.message));
    if (was) sendPeople(was).catch(() => {});
    return;
  }
  if (was && viewersOf(was).has(actor.id)) { dropViewer(actor.id, was); sendToPlayer(actor.id, { type: 'room_close' }); }
  where.delete(actor.id);
  if (was) sendPeople(was).catch(() => {});
  sendPeople(main).catch(() => {});
});
// The car has settled on a floor: whoever rode it, with its Stage open, sees its doors open there.
// ⚠ A RIDE IS BAKED BEFORE IT ARRIVES. As the doors shut (plugins/elevator `elevator.boarded`), the car as it will
// stand open on the floor it's going to, and the rooms past its doors, go to the rider as a `room_ahead` with
// `ride`: the client builds them during the ride, so the doors open on a floor that's already made and stepping out
// costs nothing. Built for a stand-in rider parked there; nothing is written.
on('elevator.boarded', ({ player, car, zone, n }) => {
  (async () => {
    const p = getLivePlayer(player.id), spec = specOf(car);
    if (!p || !spec || !viewersOf(car).has(p.id)) return;
    const there = Object.create(p);
    there._elevatorAt = { n, zone, car };
    const view = await viewPayload(there, car, spec, { stamp: false, locks: false });
    // the view out of the window first, set at the floor it's going to: the lobby's street is up and lined up
    // with its glass before the doors part, not moved there as they do
    const o = outlookPayload(car, there);
    if (o) sendToPlayer(p.id, o);
    const m = await aheadPayload(there, view);
    if (viewersOf(car).has(p.id) && p.current_zone === car) sendToPlayer(p.id, { ...(m || { type: 'room_ahead', zone: car, rooms: [] }), ride: true, spec: view.spec, ...(view.lift ? { lift: view.lift } : {}), next: view.building?.neighbours || [] });
  })().catch((e) => console.error('[roomstage] ride ahead:', e.message));
});
on('elevator.parked', ({ player, car, zone }) => {
  if (!player?.id || !viewersOf(car).has(player.id)) return;
  (async () => { const p = getLivePlayer(player.id), spec = specOf(car); if (!p || !spec) return; const view = await viewPayload(p, car, spec); sendToPlayer(p.id, { ...view, via: zone, ride: true }); const o = outlookPayload(car, p); if (o) sendToPlayer(p.id, o); sendAhead(p, view); })()
    .catch((e) => console.error('[roomstage] lift:', e.message));
});
// The Stage in a building's entry room asks for the street outside ahead of time (client room-stage.js): the
// doorstep it would walk out onto, for plugins/freelook to send as a view to build hidden. Nothing moves anybody.
on('roomstage.warm', ({ playerId }) => {
  const p = getLivePlayer(playerId), room = p ? mainOf(p.current_zone) : null, bld = room ? buildingOfRoom(room) : null;
  if (!bld || !viewersOf(room).has(p.id)) return;
  // from the room with the street door, or from anywhere else on the walk (a lift on its way down): the building's
  // entry room is where its street door is
  const facade = streetDoorOf(room) || streetDoorOf(bld.b.entry), f = facade ? getZone(facade) : null, zone = f ? facadeStreetTile(f) : null;
  if (zone) emit('roomstage.streetwarm', { player: p, zone, facade });
});
// A room's street door: the facade its exit opens onto. Walking out never stands you on it (the
// engine's facade pass-through puts you on its street tile), so with `street` given it's the facade
// that tile is in front of.
function streetDoorOf(roomId, street = null) {
  for (const id of Object.values(getZone(roomId)?.exits || {}).flat()) {
    const f = getZone(id);
    if (f?.map_id !== 'map_world') continue;
    if (!street || id === street || facadeStreetTile(f) === street) return id;
  }
  return null;
}
async function crossInto(playerId, zoneId, via) {
  const p = getLivePlayer(playerId), spec = specOf(zoneId);
  if (!p || !spec || loggedPanelsSync(p)) { sendToPlayer(playerId, { type: 'room_close' }); return; }
  let set = viewers.get(zoneId);
  if (!set) viewers.set(zoneId, (set = new Set()));
  set.add(playerId);
  await life.settleIn(zoneId);
  const view = await viewPayload(p, zoneId, spec);
  sendToPlayer(playerId, { ...view, via });
  const outlook = outlookPayload(zoneId, p);
  if (outlook) sendToPlayer(playerId, outlook);
  sendAhead(p, view);
  sendPeople(zoneId).catch(() => {});
}
on('posture.changed', ({ player }) => { if (player?.current_zone) sendPeople(mainOf(player.current_zone)).catch(() => {}); });
on('player.logout', ({ id }) => {
  if (!id) return;
  for (const [zoneId, set] of [...viewers]) if (set.has(id)) { dropViewer(id, zoneId); sendPeople(zoneId).catch(() => {}); }
  where.delete(id); lastPos.delete(id); told.delete(id); acts.forget(id);
});

// What a player is doing with their hands (acts.js): their own first-person ritual says so as it goes, and a dose
// taken from the log plays its route once. Everybody else with the room open sees it.
on('room.act', (msg) => acts.fromClient(msg));
on('player.drugUsed', (e) => acts.fromDose(e));
// The Pockets list: what they carry that the room can take in first person, asked for on a click
on('room.pockets', ({ playerId }) => {
  pocketsOf(playerId).then((items) => sendToPlayer(playerId, { type: 'room_pockets', items }))
    .catch((e) => console.error('[roomstage] pockets:', e.message));
});

export const commands = { room: cmdRoom, arrange: cmdArrange };

export const _test = { acts, powerOf, occasionOf, dressedAs, wearSweep, buildingOfRoom, clearBuildings, stageSpec, nextDoor, watchersOf, tellAvail, told, life, watching, viewers, where, roomPieces, specOf, viewPayload, aheadPayload, locksOf, lockSweep, peopleIn, beastsIn, resolveSpot, parseArrange, annexOf, mainOf, outlookOf, outlookPayload, skyTick };
