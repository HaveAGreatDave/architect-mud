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
import { gatherHook, gatherHookSync } from '../../server/engine/plugins.js';
import { world, getZone, getRegion, facadeStreetTile, getZoneFurniture, getFurnitureById, getZonePlayers, getZoneNpcs, getZoneEnemies, getApartment, updateFurniture, updateFurnitureWhere, insertFurniture, deleteFurnitureWhere, getLivePlayer, doorOnLink, frontDoorOf, getMap, moveNpcToZone } from '../../server/engine/world.js';
import { walkPlans, buildingView, placeFrom, streetDoorAt } from '../../client/shared/building-graph.js';
import { streetDoorKind, streetDoorLook } from '../../client/shared/street-door.js';
import { npcFigure } from '../../client/shared/figure-text.js';
import { getItem, getItemCache } from '../../server/engine/items-cache.js';
import { primaryExits } from '../../server/engine/exits.js';
import { on, emit } from '../../server/engine/events.js';
import { createNpcLife } from './npc-life.js';
import { createActs } from './acts.js';
import { cmdRoomPack } from './pack.js';
import { isNpcAsleep, isNpcAtWork, registerLifeDriver, walkNpcToward } from '../../server/engine/ai-behaviour.js';
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
import { exitTargets, allExits } from '../../server/engine/exits.js';
import { ownsZone } from '../../server/engine/zone-filth.js';
import { lookOfPlayer } from '../../client/shared/player-figure.js';
import { placeSpot, roomSpecOf, resolveSpot, withAnnex, annexFrame, rowDrawn, coverOf, layRows, facing, pitFloorAt, doorwaysOf, spotFits, rowLook, parseLayout } from '../../client/shared/room-layout.js';
import { randomUUID } from 'crypto';
import { isStaff } from '../admin/index.js';
import { isLocalUrl } from '../../scripts/content/lib.mjs';
import { syncEntityFile } from '../../server/api/content-sync.js';
import { query } from '../../server/models/db.js';
import { furnitureInteractions, furnitureObjectType, authoredFurnitureRow } from '../../client/shared/furniture-row.js';
import { roomLayout, roomPath, pathLength, pathAt, seatApproach, openingInside, roomNearFree } from '../../client/shared/room-layout.js';
import { schedule } from '../../server/engine/scheduler.js';
import { zoneOwnerId } from '../../server/engine/zone-filth.js';
import { mapWindow, skyState, FLIGHT_RADIUS, skylineNear, nearbyRegions, farRoadsNear, FAR_ROAD_R, worldContactsNear, fieldsNear } from '../flight/state.js';
import { streetActors } from '../../server/engine/street-actors.js';
import { TRAFFIC } from '../../client/shared/window-sky.js';
import { floorsOf, GROUND_FLOOR } from '../elevator/floors.js';
import { shopClosedFor, shopDoorDefeated, shopPlaceName, tradingHoursLine, reopensPhrase, shutOnPresenceOnly, livesHere } from '../commerce/shopdoor.js';
import { fillOf, noteView, warm } from './fill.js';
import { loadPlants, plantsOf, plantPieces, isPlantId, savePlants, loadRugs, rugMovable, rugOf, rugPiece, isRugId, saveRug } from './plants.js';
import { loadDecor, decorOf, decorPieces, isDecorId, saveDecor, dropDecor, saveDecorOverrides } from './decor-pieces.js';

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
  // the room's potted plants come out of its decor and are sent as pieces you can move (plants.js)
  if (spec.decor?.plants) { spec.pots = plantsOf(zoneId, spec.decor.plants); spec.decor = { ...spec.decor }; delete spec.decor.plants; }
  // …and so does a rug with a place of its own (plants.js rugOf); the decor then lays none
  if (rugMovable(spec.decor?.rug)) { spec.rug = rugOf(zoneId, spec.decor.rug); spec.decor = { ...spec.decor, rug: false }; }
  // …and so does every other object in it: a picture, a sign, a standard lamp, a heap of rubbish (decor-pieces.js)
  if (spec.decor) { const d = decorOf(zoneId, spec.decor); if (d.list.length) { spec.decor = d.decor; spec.decorPieces = d.list; } }
  const annex = annexOf(zoneId);
  return annex ? withAnnex(spec, annex.id, annex.name) : spec;
}

// One room's pieces with their spots, laid out by layRows (client/shared/room-layout.js). With
// `stamp`, a player's piece that has no spot yet has the one it was given written to its row.
async function piecesOf(zoneId, spec, { stamp, annex, finish }) {
  // the plants are pieces now (plants.js), but a new piece laid out by the rules still keeps off them
  const laySpec = spec.pots?.length && !annex ? { ...spec, decor: { ...spec.decor, plants: spec.pots } } : spec;
  const { pieces, stamps } = layRows(getZoneFurniture(zoneId), laySpec, { annex, finish, itemOf: (f) => (f.flags?.item_id ? getItem(f.flags.item_id) : null) });
  if (stamp && stamps.length) await Promise.all(stamps.map(({ row, spot }) => updateFurniture(row.id, { flags: JSON.stringify({ ...row.flags, spot }) })));
  const rows = new Map(getZoneFurniture(zoneId).map((f) => [f.id, f]));
  // a chess table carries the position on it (plugins/gametable `room.boards`, RAM)
  const boards = Object.assign({}, ...gatherHookSync('room.boards', zoneId));
  // `fill`: how full a container is drawn, 0 to 3 (fill.js, RAM); left off until it's known
  warm(fillWarmed);
  const fillsOf = (p) => { const f = p.container ? fillOf(p.id) : null; return f == null ? {} : { fill: f }; };
  // what a plugin says a piece is showing now (`room.pieceState`, sync, RAM): { [pieceId]: { ...fields } }, laid over
  // the piece as it's drawn, as a pet's bowls carry how full they are (plugins/pets). A plugin that changes one emits
  // furniture.changed with the piece's id, and it's sent again
  const shown = Object.assign({}, ...gatherHookSync('room.pieceState', zoneId));
  // `placed`: a player's piece, which the room's owner may move (`arrange`); an authored one never moves
  const pressing = pressingIn(zoneId, pieces);
  return pieces.map((p) => ({ ...p, ...(pressing.has(p.id) ? { racked: false } : {}), acts: coverOf(rows.get(p.id)) ? [] : furnitureActs(rows.get(p.id)), ...(rows.get(p.id)?.origin === 'player' ? { placed: true } : {}), ...(boards[p.id] ? { board: boards[p.id] } : {}), ...fillsOf(p), ...(shown[p.id] || {}) }));
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
const clearBuildings = () => { plans = null; doorList = null; roomsKept?.clear(); cards.clear(); };
// WHERE A BUILDING IS, for the loading veil going in (client glass-veil.js `place`): its name, the street its door is
// on, the region, and the start of its facade's own description, cut at a sentence. From RAM, kept per facade with
// the plans.
const cards = new Map(), CARD_BLURB = 200;
export function entryCard(facadeId) {
  if (!facadeId) return null;
  if (cards.has(facadeId)) return cards.get(facadeId);
  const f = getZone(facadeId);
  let card = null;
  if (f) {
    const street = getZone(facadeStreetTile(f))?.name || '', region = getRegion(f.flags?.region_id)?.name || '';
    const text = String(f.description || '').replace(/\s+/g, ' ').trim();
    let blurb = '';
    for (const s of text.match(/[^.!?]+[.!?]+["')\]]*\s*/g) || []) { if (blurb && (blurb + s).length > CARD_BLURB) break; blurb += s; }
    blurb = blurb.trim();
    if (blurb.length > CARD_BLURB) blurb = blurb.slice(0, CARD_BLURB).replace(/\s+\S*$/, '') + '...';
    card = { name: f.flags?.building_name || f.name || '', ...(street && street !== f.name ? { street } : {}), ...(region ? { region } : {}), ...(blurb ? { blurb } : {}) };
  }
  cards.set(facadeId, card);
  return card;
}
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
      // what kind of door it is and how it looks from the street, as the entry room's flags.room.street_door says
      // (client/shared/street-door.js: the kinds, and every look key with what it does)
      const sd = getZone(entry)?.flags?.room?.street_door, look = streetDoorLook(sd);
      const kind = sd ? streetDoorKind(sd) : o.slide ? (o.swing ? 'swing' : 'sliding') : 'plain';
      const card = entryCard(f.id);
      doorList.push(Object.defineProperty({ gx: f.grid_x, gy: f.grid_y, edge, w: +Math.abs(o.b - o.a).toFixed(2), kind, slide: !!o.slide, ...(o.swing ? { swing: true } : {}), ...(look ? { look } : {}), ...(card ? { place: card } : {}) }, 'bld', { value: bld }));
      Object.defineProperty(doorList[doorList.length - 1], 'fid', { value: f.id });   // the facade, for its lock (plugins/freelook)
    }
  }
  return doorList.filter((d) => Math.abs(d.gx - gx) <= r && Math.abs(d.gy - gy) <= r);
}
// THE ROOMS OF EACH BUILDING WITH A STAGE NEAR A TILE, for the street view on foot to draw inside the city
// (docs/proposals/one-world-interiors.md): each room's spec as its Stage draws it, its pieces laid out and its
// frame (frameOf). Built from the world Maps and the furniture cache, never a query, and kept per building for
// ROOMS_KEEP_MS, since it rides along with every step's window. A lift car moves, so it goes once for every landing it
// stops at, placed at that floor and open onto it (`key` the car and the landing, `stop` the landing), and GLASS takes
// the copy at the landing the car's at (one-world phase E).
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
        const car = f.plan.lifts?.[id];
        if (car) {
          // the ground floor's copy first (parked null, open onto the lobby): without it the lobby's lift doors had
          // nothing behind them in GLASS, and stepping in took the lowest upper floor's copy instead
          const ground = car.ground ? [{ zone: car.ground, ground: true }] : [];
          for (const stop of [...ground, ...(car.stops || [])]) {
            // a stand-in rider with the car parked at this stop, as the ride ahead's (elevator.boarded) is
            const there = stop.ground ? null : { _elevatorAt: { car: id, zone: stop.zone } };
            const spec = specOf(id) ? buildingView(f, id, specOf(id), { specOf, parked: stop.ground ? null : stop.zone }).spec : null, frame = spec && tile ? frameOf(id, tile, there) : null;
            if (!frame) continue;
            const pieces = layRows(getZoneFurniture(id), spec, { finish: spec.finish, itemOf: (x) => (x.flags?.item_id ? getItem(x.flags.item_id) : null) }).pieces;
            rooms.push({ zone: id, key: id + '@' + stop.zone, stop: stop.zone, spec, pieces, frame });
          }
          continue;
        }
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
  // A VESSEL (flags.vessel on the facade: the Echelon). She has no street door and she doesn't stay on her tile: she
  // swings at anchor, sails and rides the swell. So her rooms go with where each stands in her own frame (`vessel`:
  // `sx` metres to starboard and `fz` forward of her middle, its compass `face` off her bow, its `floor` over her main
  // deck, which is `deck` metres over the water), and the view puts them on her hull every frame (freelook-view.js
  // owVesselTick). Her plan's middle is `flags.vessel_plan.fz` forward (scripts/content/echelon-fit.mjs writes it).
  for (const bld of new Set(plans?.values() || [])) {
    const f = getZone(bld.b.facade);
    if (!f?.flags?.vessel || !Number.isFinite(f.grid_x) || !Number.isFinite(f.grid_y) || Math.abs(f.grid_x - gx) > r || Math.abs(f.grid_y - gy) > r) continue;
    let kept = roomsKept.get(bld);
    if (!kept || now - kept.at > ROOMS_KEEP_MS) {
      const vp = f.flags.vessel_plan || {}, fz0 = Number(vp.fz) || 0, deck = Number(vp.deck_m) || 0, rooms = [];
      for (const id of Object.keys(bld.plan.rooms)) {
        const spec = stageSpec(id), R = bld.plan.rooms[id];
        if (!spec || !R) continue;
        const pieces = layRows(getZoneFurniture(id), spec, { finish: spec.finish, itemOf: (x) => (x.flags?.item_id ? getItem(x.flags.item_id) : null) }).pieces;
        rooms.push({ zone: id, spec, pieces, frame: { vessel: { sx: R.at[0], fz: +(R.at[1] + fz0).toFixed(3), face: R.face, floor: R.floor, deck } } });
      }
      kept = { at: now, rooms };
      roomsKept.set(bld, kept);
    }
    // the tile she's on now, not the one she was on when her rooms were laid out
    out.push({ tile: { x: f.grid_x, y: f.grid_y }, vessel: true, rooms: kept.rooms });
  }
  return out;
}

// A PLACE (docs/proposals/the-inbetween.md): rooms with no building and no street, walked in GLASS on their own patch of
// empty ground far from any region (PLACE_AT), the prologue's first. A map is a place when its entry room says so
// (`flags.room.place`). Its rooms go as a vessel's do, where each stands in its plan's frame, so the rooms of the walk
// stand on one line through their doorways; the client places them once and never moves them (room-interiors.js).
export const PLACE_AT = Object.freeze({ gx: 200, gy: 200 });
export function isPlace(zoneId) {
  const z = getZone(mainOf(zoneId)), bld = z ? buildingOfRoom(z.id) : null;
  return !!(bld && getZone(bld.b.entry)?.flags?.room?.place);
}
export function placeRooms(zoneId) {
  const bld = isPlace(zoneId) ? buildingOfRoom(mainOf(zoneId)) : null;
  if (!bld) return null;
  let kept = roomsKept.get(bld);
  if (!kept || Date.now() - kept.at > ROOMS_KEEP_MS) {
    const rooms = [];
    for (const id of Object.keys(bld.plan.rooms)) {
      const spec = stageSpec(id), R = bld.plan.rooms[id];
      if (!spec || !R) continue;
      const pieces = layRows(getZoneFurniture(id), spec, { finish: spec.finish, itemOf: (x) => (x.flags?.item_id ? getItem(x.flags.item_id) : null) }).pieces;
      rooms.push({ zone: id, spec, pieces, frame: { vessel: { sx: R.at[0], fz: R.at[1], face: R.face, floor: R.floor, deck: 0 } } });
    }
    kept = { at: Date.now(), rooms };
    roomsKept.set(bld, kept);
  }
  return { tile: { x: PLACE_AT.gx, y: PLACE_AT.gy }, vessel: true, place: true, rooms: kept.rooms };
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
// The rooms one doorway (or one flight of stairs) away on a building's walk. Somebody with one of them open sees into this
// room, so they're sent its people and pieces as they change.
function nextDoor(zoneId) {
  const bld = buildingOfRoom(zoneId), out = new Set();
  // (and a floor up or down a flight: you see up and down the well)
  if (bld) for (const d of bld.plan.doors) if ((d.kind === 'door' || (d.kind === 'stairs' && d.flight)) && d.to) { if (d.from === zoneId) out.add(d.to); else if (d.to === zoneId) out.add(d.from); }
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
  const out = [...await piecesOf(zoneId, spec, { stamp, annex: false, finish: spec.finish }), ...plantPieces(spec.pots || [], true), ...(spec.rug ? [rugPiece(spec.rug, true)] : []), ...decorPieces(spec.decorPieces || [], true)];
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
  // `along`: a street door off its tile's middle along the street (room-view.js anchorOf), the Solenne's on its block's
  const along = Number(getZone(bld.b.entry)?.flags?.room?.street_door?.along) || 0;
  return { entry: entry.at, front: bld.plan.rooms[bld.b.entry].face, side, floor, face: R.face, door: streetDoorAt(bld.plan, bld.b.entry), ...(along ? { along } : {}) };
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
  // undressed for bed and not in it yet (server/engine/ai-behaviour.js AT_HOME_LIFE `_undressed`)
  if (n._undressed && atHome(n, zoneId)) return 'sleep';
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
  const own = npcFigure(n), occ = occasionOf(n, zoneId, asleep), over = occ ? n.flags?.['figure_' + occ] : null;
  const band = feelBand(feel), temp = band < 0 ? n.flags?.figure_cold : band > 0 ? n.flags?.figure_hot : null;
  const figure = over || temp ? { ...(own || {}), ...(over || {}), ...(temp || {}) } : own;
  const wear = {};
  if (occ && occ !== 'work' && !over && !(occ === 'out' && own?.cut)) wear.occasion = occ;
  if (band && !temp && !(occ === 'work' && over)) wear.feel = band;
  // changed at the wardrobe (npc-life.js USE_STEPS): a different top at home, counted in RAM
  if (n._outfit && occ === 'home' && !over) wear.change = n._outfit;
  // under the shower (ambient-life home-life.js): stripped to a vest and shorts, whatever the look or the weather
  if (n._showering) return { figure: own, wear: { occasion: 'bath' } };
  // on a trip to the beach (plugins/beach, RAM only), there and back: flat sandals, whoever they are
  if (n._beach) wear.beach = 1;
  return { figure, wear: wear.occasion || wear.feel || wear.change || wear.beach ? wear : null };
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

// Somebody knocking at a shut door (plugins/gametable `door.knock`): seen from the room they're knocking from, stood
// just inside its doorway to the room they want, facing it. They rap for KNOCK_HOLD_MS after each knock, then stand
// there waiting until the next one (the event's `waitMs`), and go back to their own life once they give up.
const KNOCK_HOLD_MS = 7_000;   // one loop of actor3d's 'knock' clip
const knockers = new Map();   // npcId -> { to, at, until }
function knockPost(npcId, zoneId, pieces) {
  const k = knockers.get(npcId), now = Date.now();
  if (!k || now > k.until) { if (k) knockers.delete(npcId); return null; }
  const spec = stageSpec(zoneId), o = spec && doorwaysOf(spec).find((x) => x.to === k.to);
  if (!o) return null;
  const L = roomLayout(spec, pieces), p = openingInside(L, o).at;
  // facing out through the doorway: the way into the room from it, turned round
  const face = o.wall === 'front' ? [0, -1] : o.wall === 'back' ? [0, 1] : o.wall === 'left' ? [-1, 0] : [1, 0];
  return { at: p.map((x) => +x.toFixed(2)), face, ...(now - k.at < KNOCK_HOLD_MS ? { clip: 'knock' } : {}) };
}
on('door.knock', ({ outside, inside, knockerId, waitMs }) => {
  if (!viewers.size) return;
  const now = Date.now();
  if (knockerId && outside) knockers.set(knockerId, { to: inside, at: now, until: now + Math.max(KNOCK_HOLD_MS, waitMs || 0) });
  // (the knock itself is heard through plugins/audio; the room outside is sent its people, the knocker at the door)
  const z = outside && mainOf(outside);
  if (z && viewersOf(z).size) sendPeople(z).catch(() => {});
  // and again once the rap's done, so they stand and wait rather than rapping on a loop till the next knock
  if (z) setTimeout(() => { if (viewersOf(z).size) sendPeople(z).catch(() => {}); }, KNOCK_HOLD_MS + 100).unref?.();
});

// A player mid-set on a press bench (plugins/weightbench: posture 'working_out' on the `lift` station, sittingOn the
// bench's name): the bench as laid out, or null.
function pressOf(pl, pieces) {
  if (pl.posture !== 'working_out' || pl.workoutState?.station !== 'lift') return null;
  return pieces.find((q) => q.name === pl.sittingOn && q.form === 'pressbench') || null;
}
// The press benches somebody's pressing on in a room, by piece id: a player mid-set or a resident on the bench's job
// (npc-life.js 'press'). Their bar is in their hands, so the bench is sent with its hooks empty (`racked: false`).
function pressingIn(zoneId, pieces) {
  const ids = new Set();
  for (const pl of getZonePlayers(zoneId)) { const q = pressOf(pl, pieces); if (q) ids.add(q.id); }
  for (const l of life.lives.values()) if (l.main === zoneId && l.kind === 'press' && l.on != null && !l.route) ids.add(l.on);
  return ids;
}
const pressSeen = new Map();
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
      // on a press bench mid-set (plugins/weightbench `lift`): lying on it, pressing, with the bench's own plates
      const press = pressOf(pl, pieces);
      out.push({ id: pl.id, name: pl.handle || pl.name, posture: press ? 'lying' : pl.posture || 'standing', on: press ? press.id : pl.sittingOn ? byName.get(pl.sittingOn) || null : null, ...(press ? { clip: 'liePress', ...(press.dress === 'concrete' ? { bar: 'concrete' } : {}) } : {}), sex: pl.biological_sex, look: lookOfPlayer(pl), ...mark,
        ...(w && w.zone === zoneId ? { at: w.at, yaw: w.yaw, seat: w.seat } : {}), ...(a ? { act: a.act, hold: a.hold, beat: a.beat } : {}) });
    }
    for (const n of getZoneNpcs(id)) {
      // an animal (a pet: plugins/pets) is drawn as itself by beastsIn, not as a person
      if (npcBeastOf(n)) continue;
      // a plugin that has them doing something of its own here says where (`room.npcStage`, sync): the ice crew at a
      // break (plugins/stands crew.js), friends at a party (plugins/outings scenes.js). `hide` leaves them out; anything else is laid over what's worked out below
      const staged = gatherHookSync('room.npcStage', n, id, pieces, specOf(zoneId))[0] || null;
      if (staged?.hide) continue;
      const on = n.onFurniture || n.sittingOn;
      // a dancer on shift takes the next free pole, and with none left works the floor
      const dancer = !inside && !on && dancing(n, id), post = dancer ? posts.shift() : null;
      // (a plugin that seats them on a piece, or walks them a route, places them itself: a spot behind their post as
      // well stood the ice crew up inside the stool they were sat on)
      const placed = !!(staged?.on || staged?.at);
      const desk = !inside && !on && !post && !placed ? deskPostOf(n, id, pieces) : null;
      const st = placed ? null : knockPost(n.id, id, pieces) || (post ? { at: post.at, face: post.face, lift: post.lift } : desk || life.stageOf(n, zoneId));
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
      // who may touch them with the mouse, and whether somebody is now (`room.npcTouch`, sync: plugins/consort life.js)
      const touch = gatherHookSync('room.npcTouch', n)[0] || null;
      // their sex and any settled look, which the close-up figure draws them by (gl/room-people.js)
      out.push({ id: n.id, name: n.name, npc: true, posture: n.posture || 'standing', on: on ? byName.get(on) || null : null, sex: n.sex, ...(dressed.figure ? { figure: dressed.figure } : {}), ...(dressed.wear ? { wear: dressed.wear } : {}), ...(feel ? { feel } : {}), ...mark, ...(order ? { order } : {}),
        ...(asleep ? { asleep: true } : {}), ...(ko ? { out: true } : {}), ...(manner ? { manner } : {}), ...(mood ? { mood } : {}), ...(touch || {}), ...(lay || {}), ...(st || {}),
          // a dancer on shift takes tips (the Stage puts a Tip button on her card), and how much she has off
          ...(st?.clip === 'liePress' && st.on && pieces.find((q) => q.id === st.on)?.dress === 'concrete' ? { bar: 'concrete' } : {}),
          ...(dancer && n.flags?.stripper ? { tip: true, ...(peel ? { peel: Math.round(peel * 100) / 100 } : {}) } : {}), ...(staged ? { ...staged, manner: undefined } : {}) });
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
  return clubFloor(out);
}
// A dancer and her crowd (plugins/strippers calls tipped()): whoever handed her a note in the last few seconds holds
// it out and she comes down for it, turned to them; and everybody else in the room who isn't working keeps an eye on
// the nearest dancer, an NPC among them idling as a punter does (actor3d.js ACTOR_IDLES.punter). RAM only.
const TIP_TAKE_MS = 3400, TIP_GIVE_MS = 2600;
function clubFloor(out) {
  const now = Date.now(), dancers = out.filter((o) => o.tip && Array.isArray(o.at));
  if (!dancers.length) return out;
  for (const d of dancers) {
    const tip = world.npcs.get(d.id)?._tipped;
    if (!tip || now - tip.at > TIP_TAKE_MS) continue;
    Object.assign(d, { clip: 'tipTake', beat: tip.n });
    const by = out.find((o) => o.id === tip.by);
    if (by && Array.isArray(by.at)) {
      const du = by.at[0] - d.at[0], dv = by.at[1] - d.at[1], m = Math.hypot(du, dv);
      if (m > 0.1) d.face = [+(du / m).toFixed(3), +(dv / m).toFixed(3)];
    }
  }
  for (const o of out) {
    if (o.tip || o.annex || o.asleep || o.out) continue;
    const gave = o.npc ? world.npcs.get(o.id)?._tipGave : null;
    if (gave && now - gave.at < TIP_GIVE_MS) Object.assign(o, { clip: o.on ? 'sitTipOffer' : 'tipOffer', beat: gave.n });
    // somebody at work (behind the bar, on the door) watches the room, not the stage
    if (o.manner && o.manner !== 'punter') continue;
    if (o.npc && !o.clip && !o.manner) o.manner = 'punter';
    let best = null, bd = Infinity;
    for (const d of dancers) { const q = Array.isArray(o.at) ? Math.hypot(d.at[0] - o.at[0], d.at[1] - o.at[1]) : 0; if (q < bd) { bd = q; best = d; } }
    if (best) o.watch = [best.at[0], best.at[1], +((best.lift || 0) + 1.25).toFixed(2)];
  }
  return out;
}
// A tip just handed over (plugins/strippers): the dancer comes down for it and the giver holds it out, a player by
// their act and an NPC by a mark on them, and the room is sent again once she's back up so the clips end on time.
export function tipped(zoneId, dancer, giver) {
  if (!dancer) return;
  const now = Date.now();
  dancer._tipped = { at: now, by: giver?.id, n: (dancer._tipped?.n || 0) + 1 };
  if (giver?.npc) giver.npc._tipGave = { at: now, n: (giver.npc._tipGave?.n || 0) + 1 };
  else if (giver?.id) acts.play(giver.id, 'tip', null, TIP_GIVE_MS);
  const z = mainOf(zoneId);
  if (!z || !watchersOf(z).size) return;
  sendPeople(z).catch(() => {});
  setTimeout(() => { if (watchersOf(z).size) sendPeople(z).catch(() => {}); }, TIP_TAKE_MS + 150).unref?.();
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
// a pet's beat (plugins/pets: greeting somebody at the door, being stroked) goes out at once, not on the next sweep
on('pet.beat', ({ zoneId }) => {
  const z = zoneId && mainOf(zoneId);
  if (z && watchersOf(z).size) sendPeople(z).catch(() => {});
});
schedule('2s', () => {
  if (!viewers.size) return;
  for (const zoneId of viewers.keys()) {
    if (beastSig(zoneId) !== (beastSeen.get(zoneId) ?? '')) { beastSeen.set(zoneId, beastSig(zoneId)); sendPeople(zoneId).catch(() => {}); }
  }
  for (const z of beastSeen.keys()) if (!viewers.has(z)) beastSeen.delete(z);
});

// Whether a room's set is on: a resident watching it (npc-life.js), or a venue's sets (`flags.tv_public`: a concourse's,
// a bar's), which are on whenever anybody's in the room to see them
const setOn = (zoneId) => life.tvOf(zoneId) || getZoneFurniture(zoneId).some((f) => f.flags?.tv_public === true);
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
      // from a lift car, the landing's own locks: its doors and keypads are drawn before the car's doors part,
      // not when you step out onto it
      if (lift && locks && hasLocks(n.zone, stageSpec(n.zone))) {
        const ways = await locksOf(player, n.zone, stageSpec(n.zone));
        if (ways.length) n.locks = ways;
      }
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
  // the building it's in, for the loading veil (entryCard): its street door's facade, or the facade its map hangs off
  const card = entryCard(bld ? streetDoorOf(bld.b.entry) : (streetDoorOf(zoneId) || getMap(zone?.map_id)?.parent_zone_id));
  return { type: 'room_view', zone: zoneId, here: player.current_zone, name: zone?.name || '', spec, ...(building ? { building } : {}), ...(card ? { entry: card } : {}), ...(lift ? { lift: { floors: lift.floors, at: lift.at, ...(lift.parked ? { parked: lift.parked } : {}), ...(lift.brand ? { brand: lift.brand } : {}) } } : {}), hasView: !!place, ...(place ? { place } : {}), mine: !!controls(player, zoneId), ...(adminHere(player) ? { admin: true } : {}), you: player.id,
    pieces, people: peopleIn(zoneId, pieces), beasts: beastsIn(zoneId), tv: setOn(zoneId), clock: getBirdClock(), ...(ways.length ? { locks: ways } : {}),
    // whether the mains are on (powerOf); the switch by the door is the viewer's own, kept per room on the client
    power: powerOf(zoneId),
    // what's over the glass (glassOf): a control panel's shutters and the scene on them (plugins/envcontrol)
    ...(glassOf(zoneId) ? { glass: glassOf(zoneId) } : {}),
    // water that moves (plumbingOf): a running shower, a toilet's bowl, a stream into it (plugins/bodily)
    plumbing: plumbingOf(zoneId),
    // what stands on a depot shed's lift, and this viewer's trucks to call up (plugins/trucking hoist.js)
    ...(vehiclesOf(zoneId, player) ? { vehicles: vehiclesOf(zoneId, player) } : {}),
    // what a plugin has for this viewer in this room (`room.viewer`, sync): the tickets you hold, at a seat door (plugins/stands)
    ...Object.assign({}, ...gatherHookSync('room.viewer', zoneId, player)),
    // what's sprayed on its walls (plugins/graffiti `room.tags`), drawn on the plaster
    ...(tagsOf(zoneId).length ? { tags: tagsOf(zoneId) } : {}),
    // paper on its walls that hangs as a run (plugins/posters `room.sheets`), joined once the run's whole
    ...(sheetsOf(zoneId).length ? { sheets: sheetsOf(zoneId) } : {}),
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
  // the building's name for the plate over the panel (`flags.building_name` on the car), if it has one
  const brand = typeof car?.flags?.building_name === 'string' ? car.flags.building_name : '';
  return { floors, parked, at: parked ? at.n : GROUND_FLOOR, ...(brand ? { brand } : {}) };
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
// WHO'S JUST WALKED OUT OR IN, by an exit (a player's step, an NPC's `npc.moved`): `gone` and `came` ride with the
// room's people for a few seconds, so the client walks a leaver to the doorway they took and through it, the door
// opening for them and shutting behind, and walks somebody in from the doorway they came by. Without it they
// were dropped from one room and dropped into the next. A jump (a teleport, a death, logging out) isn't noted, so
// they still just go. RAM only, and only for a room somebody can see.
const MOVE_MS = 4_000;
const moves = new Map();   // main zone -> Map(id -> { gone: to } | { came: from }, with t)
function noteMove(id, from, to) {
  const a = from && mainOf(from), b = to && mainOf(to), t = Date.now();
  if (!id || !a || !b || a === b) return false;
  const put = (z, rec) => {
    if (!watchersOf(z).size) return;
    let m = moves.get(z);
    if (!m) moves.set(z, (m = new Map()));
    m.set(id, { ...rec, t });
    for (const [k, r] of m) if (t - r.t > MOVE_MS) m.delete(k);
  };
  put(a, { gone: to });
  put(b, { came: from });
  return true;
}
function movesOf(zoneId) {
  const m = moves.get(zoneId);
  if (!m) return null;
  const now = Date.now(), gone = [], came = [];
  for (const [id, r] of m) {
    if (now - r.t > MOVE_MS) m.delete(id);
    else if (r.gone) gone.push({ id, to: r.gone });
    else came.push({ id, from: r.came });
  }
  if (!m.size) moves.delete(zoneId);
  return gone.length || came.length ? { gone, came } : null;
}
// whether somebody went from one zone to the other by an exit, and didn't jump
const walkedBy = (from, to) => !!from && !!to && allExits(getZone(from)).some((e) => e.target === to);
// A plugin moved somebody in a room without moving them between zones (plugins/stands crew.js: the ice crew
// climbing onto the machine): its people again, to whoever has it open
on('room.peopleChanged', ({ zoneId }) => {
  const z = zoneId && mainOf(zoneId);
  if (z && watchersOf(z).size) sendPeople(z).catch(() => {});
});
on('npc.moved', ({ npc, from, to }) => {
  if (!viewers.size || !npc?.id || !noteMove(npc.id, from, to)) return;
  for (const z of new Set([from, to].map(mainOf))) if (watchersOf(z).size) sendPeople(z).catch(() => {});
});

// Who's in the room, to everybody with it open, and to anybody next door to it (they see in).
async function sendPeople(zoneId) {
  const set = watchersOf(zoneId);
  if (!set.size) return;
  const spec = stageSpec(zoneId);
  if (!spec) return;
  const pieces = await roomPieces(zoneId, spec), people = peopleIn(zoneId, pieces);
  const beasts = beastsIn(zoneId), moved = movesOf(zoneId);
  // a bar lifted off its hooks or put back: the bench is sent again
  const pk = [...pressingIn(zoneId, pieces)].sort().join('|');
  if ((pressSeen.get(zoneId) || '') !== pk) { pressSeen.set(zoneId, pk); emit('furniture.changed', { zoneId }); }
  beastSeen.set(zoneId, beasts.map((b) => b.id).join('|'));
  for (const id of set) sendToPlayer(id, { type: 'room_people', zone: zoneId, people, beasts, tv: setOn(zoneId), ...(moved || {}) });
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
const life = createNpcLife({ viewers, annexOf, mainOf, specOf: stageSpec, roomPieces, sendPeople, busy, tvOn, feelOf: (zoneId) => feelOf(getZoneTemperature(zoneId)), whereOf: (id) => where.get(id) || null });
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
on('npc.bathroom', (e) => { life.bathroom(e).catch((err) => console.error('[roomstage] bathroom:', err.message)); });
// a face changes as soon as the mood does
onNpcMoodChange((n) => { const z = n.zoneId ?? n.zone_id; if (z && watchersOf(mainOf(z)).size) sendPeople(mainOf(z)).catch(() => {}); });
on('npc.ritual', (e) => life.ritual(e));
on('npc.panic', (e) => { if (e?.npc) life.panic(e); });
on('npc.banter.start', (e) => life.talkStart(e));
on('npc.banter.end', (e) => life.talkEnd(e));
// home talk (plugins/ambient-life/home-talk.js): a gesture per line, and what they do about how it went
on('npc.talk.line', (e) => life.talkLine(e));
on('npc.talk.after', (e) => life.afterTalk(e));

// A vatdrop's NPC: held in the vat while the Stage plays the cycle, then, dressed, walked out of the facility and
// back to where they died, the same road-graph walk as any commute. VAT_DONE_MS is VAT_CYCLE.done in
// panels/room-vatcycle.js, when the body steps out. RAM only; a walk that sticks or runs long just lets go.
const VAT_DONE_MS = 16600, VAT_WALK_LIMIT_MS = 10 * 60_000;
const vatWalks = new Map();
registerLifeDriver((npc, { broadcast, query, ai }) => {
  const w = vatWalks.get(npc.id);
  if (!w) return false;
  const now = Date.now();
  if (npc._dead) { vatWalks.delete(npc.id); return false; }
  if (now < w.out) return true;
  const r = now - w.out > VAT_WALK_LIMIT_MS ? 'stuck' : walkNpcToward(npc, w.home, broadcast, query);
  if (r === 'moving') return true;
  vatWalks.delete(npc.id);
  if (ai) { ai.patrolPath = []; ai.patrolTarget = null; }
  return false;
});

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
  // `room vatdrop` (staff, a local server; the Stage's Vat test button): a random NPC from anywhere else in the world
  // dies there and is reprinted here, down a tube into a release vat, so the vat cycle can be watched on somebody
  if (a0 === 'vatdrop') {
    if (!adminHere(player)) return { type: 'error', message: 'The vat test is for staff, on a local server.' };
    if (!spec) return { type: 'error', message: 'There are no vats here.' };
    const L = roomLayout(spec, await roomPieces(zoneId, spec));
    if (!L.placed.some((p) => p.form === 'vat' && p.state === 'release')) return { type: 'error', message: 'There are no release vats here.' };
    const pool = [...world.npcs.values()].filter((n) => n && !n._dead && n.zone_id && mainOf(n.zone_id) !== zoneId && !npcBeastOf(n) && !n.flags?.animal);
    if (!pool.length) return { type: 'error', message: 'Nobody out there to reprint.' };
    const n = pool[Math.floor(Math.random() * pool.length)], from = getZone(n.zone_id)?.name || 'somewhere';
    vatWalks.set(n.id, { home: n.zone_id, out: Date.now() + VAT_DONE_MS });
    moveNpcToZone(n.id, zoneId);
    emit('vat.emerging', { actor: n, zone: zoneId, t0: Date.now(), npc: true });
    return { type: 'output', message: `<span class="clone-vat-message">${n.name} dies in ${from}. The trunk overhead thumps, and something starts down a tube.</span>` };
  }
  if (a0 === 'close' || a0 === 'leave') {
    dropViewer(player.id, zoneId);
    sendToPlayer(player.id, { type: 'room_close' });
    return { type: 'noop' };
  }
  if (!spec) return { type: 'error', message: "There's no walking round this place in 3-D. Flats and furnished rooms have it." };
  if (loggedPanelsSync(player)) return { type: 'error', message: 'The 3-D room needs the Visual or Text Games display mode. Everything in it is in the room text.' };
  // `room world` (the room button on a desktop): the 3-D world itself, the room drawn inside the city (one-world,
  // docs/proposals/one-world-interiors.md). The street view goes up at the building's own door first (plugins/freelook
  // answers `roomstage.worldin`), and the room's view after it carries `world`, so the client waits for that view
  // to take it, as walking in off the street does. A room it doesn't take still opens as the Room Stage.
  let worldIn = false;
  // a place has no street and no tile: its own patch of ground (plugins/freelook answers `roomstage.placein`)
  if (a0 === 'world' && isPlace(zoneId)) { emit('roomstage.placein', { player, zone: zoneId }); worldIn = true; }
  else if (a0 === 'world') {
    // a vessel has no street: the view goes up over her own tile (buildingRoomsNear sends her rooms)
    const facade = getMap(getZone(zoneId)?.map_id)?.parent_zone_id, fz = facade ? getZone(facade) : null, street = fz ? (fz.flags?.vessel ? facade : facadeStreetTile(fz)) : null;
    if (street && buildingOfRoom(zoneId)) { emit('roomstage.worldin', { player, zone: street, facade }); worldIn = true; }
  }
  let set = viewers.get(zoneId);
  if (!set) viewers.set(zoneId, (set = new Set()));
  set.add(player.id);
  await life.settleIn(zoneId);
  const view = await viewPayload(player, zoneId, spec);
  if (worldIn) view.world = true;
  sendToPlayer(player.id, view);
  const outlook = outlookPayload(zoneId, player);
  if (outlook) sendToPlayer(player.id, outlook);
  sendAhead(player, view);
  return { type: 'noop' };
}

// Another plugin opening a room's 3-D view for somebody, as if they'd pressed the room button (`world` for the desktop's
// GLASS, which a phone takes as the Stage): the prologue does it as the cold open ends (plugins/prologue beginArrival).
on('roomstage.open', ({ player, world }) => {
  const p = player?.id ? getLivePlayer(player.id) : null;
  if (p) cmdRoom(world ? ['world'] : [], '', p).catch((e) => console.error('[roomstage] open:', e.message));
});

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
  if (args[0] === 'layout') return arrangeLayout(raw, player, broadcast);
  if (args[0] === 'catalog') return arrangeCatalog(player);
  if (args[0] === 'sheets') return arrangeSheetStock(player);
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

// ── arrange layout <id>@<spot> … ──────────────────────────────────────────────────────────────────
// The arrange mode's Save (client/game/js/panels/room-arrange.js): every piece the owner moved, at once. A spot is
// `<wall>:<along>` with its back to that wall, or `<u>,<v>,<turn>` out in the room, in metres and quarter turns.
// ⚠ ONE WRITE FOR THE WHOLE LAYOUT. The draft lives on the client while they drag; nothing is sent until Save, and
// then this checks every moved piece against the room as it would stand afterwards (spotFits, placeSpot's own
// rules) and writes all of them in one UPDATE, or none. Then one furniture.changed sends the room's pieces again.
// `room_arranged` tells the arrange mode how it went, so it can close or point at what didn't fit.
//
// ⚠ THE ADMIN MODE: STAFF, ON A LOCAL DATABASE ONLY (adminHere). Staff set rooms up for content: any room with a Stage,
// every piece in it (authored ones too), anywhere in the room whether or not it fits by the rules, `+<item>@<spot>`
// to add a furniture item from the catalog (`arrange catalog`) and `-<id>` to take a piece out. What it adds is an
// authored row, and every authored row it touches is mirrored to its content/furniture file (syncEntityFile, the dev
// panel's own writer), so the room goes to prod through git like any other content. On prod it's never offered:
// content there is git's alone.
const LAYOUT_MAX = 80;
export const adminHere = (player) => isStaff(player) && isLocalUrl(process.env.DATABASE_URL);
let syncFiles = true;   // regress turns the content-file mirror off, so a run writes nothing in content/
// A player's layouts are a query each, so a client sending them in a loop is held to one every LAYOUT_GAP_MS. Only a
// layout that would write is held: a refusal costs nothing. RAM only; staff on a local server aren't held.
const LAYOUT_GAP_MS = 4000, lastLayout = new Map();
// Staff taking a room's decor out (adminHere only): plants (`plant:<i>`), the rug and the decor objects
// (`decor:<key>:<i>`) come out of flags.room.decor on the zone, its row and the live zone both, and the zone's
// content file is rewritten, so it goes to prod through git. Plants keep where they were last put; a decor object's
// override is re-keyed past the gap (decor-pieces.js dropDecor). Returns whether a file was written.
async function dropRoomDecor(main, ids) {
  const zone = getZone(main), room = zone?.flags?.room;
  if (!room?.decor) return false;
  let decor = { ...room.decor };
  const plants = ids.filter(isPlantId).map((id) => +id.slice(6));
  if (plants.length) {
    const pots = plantsOf(main, decor.plants).filter((_, i) => !plants.includes(i));
    if (pots.length) decor.plants = pots; else delete decor.plants;
    await savePlants(main, pots);
  }
  if (ids.some(isRugId)) decor.rug = false;
  const objs = ids.filter(isDecorId);
  if (objs.length) { const r = dropDecor(main, decor, objs); decor = r.decor; await saveDecorOverrides(main, r.moved); }
  zone.flags = { ...zone.flags, room: { ...room, decor } };
  await query('UPDATE zones SET flags = $1::jsonb WHERE id = $2', [JSON.stringify(zone.flags), main]);
  if (!syncFiles) return false;
  await syncEntityFile('zones', main).catch((e) => console.warn('[roomstage] content file', main, e.message));
  return true;
}
async function arrangeLayout(raw, player, broadcast) {
  const zoneId = player.current_zone, main = mainOf(zoneId), admin = adminHere(player);
  const tell = (ok, message, bad = []) => { sendToPlayer(player.id, { type: 'room_arranged', zone: main, ok, message, bad }); return { type: ok ? 'output' : 'error', message }; };
  const spec = stageSpec(main);
  if (!spec) return tell(false, 'You can only arrange furniture in a flat or a furnished room.');
  if (!admin && !controls(player, main)) return tell(false, "This isn't your place to rearrange.");
  const words = String(raw || '').trim().split(/\s+/).slice(2);
  // paper on the walls rides in the same Save: `sheet:<id>@<spot>` moves a hung sheet, `sheet+<inv>@<spot>` hangs one
  // the player carries (arrangeSheets below); the rest is furniture
  const sheetOps = parseSheetOps(words.filter((w) => w.startsWith('sheet')));
  if (!sheetOps) return tell(false, "That layout didn't make sense. Nothing moved.");
  const all = parseLayout(words.filter((w) => !w.startsWith('sheet')), LAYOUT_MAX);
  if (!all) return tell(false, "That layout didn't make sense. Nothing moved.");
  if (!all.length && !sheetOps.length) return tell(true, 'Nothing to move.');
  if (!all.length) {
    const r = await arrangeSheets(sheetOps, player, main, admin);
    if (!r.ok) return tell(false, r.message, r.bad);
    broadcast?.(zoneId, { type: 'zone_event', message: `${player.handle} rearranges the posters.` }, player.id);
    return tell(true, r.message);
  }
  if (sheetOps.length) {
    const r = await arrangeSheets(sheetOps, player, main, admin, { check: true });
    if (!r.ok) return tell(false, r.message, r.bad);
  }
  const adds = all.filter((m) => m.add), removes = all.filter((m) => m.remove), moves = all.filter((m) => !m.add && !m.remove);
  if (!admin && (adds.length || removes.length)) return tell(false, 'Adding and removing pieces is for staff, on a local server. Nothing moved.');
  const rows = new Map(getZoneFurniture(main).filter(drawn).map((f) => [f.id, f]));
  const pieces = (await roomPieces(main, spec)).filter((p) => !p.annex);
  const byId = new Map(pieces.map((p) => [p.id, p]));
  for (const m of [...moves, ...removes]) {
    // a potted plant (plants.js): moved, never taken out
    // staff take decor out as they do furniture (dropRoomDecor below); an owner only moves it
    if ((isPlantId(m.id) || isRugId(m.id) || isDecorId(m.id)) && m.remove && admin) { if (!byId.has(m.id)) return tell(false, "Something you took out isn't there any more. Nothing moved.", [m.id]); continue; }
    if (isPlantId(m.id)) { if (m.remove || !byId.has(m.id)) return tell(false, "The plants stay; you can only move them. Nothing moved.", [m.id]); continue; }
    if (isRugId(m.id)) { if (m.remove || !byId.has(m.id)) return tell(false, "The rug stays; you can only move it. Nothing moved.", [m.id]); continue; }
    if (isDecorId(m.id)) { if (m.remove || !byId.has(m.id)) return tell(false, `The ${byId.get(m.id)?.name || 'decor'} stays; you can only move it. Nothing moved.`, [m.id]); continue; }
    const row = rows.get(m.id);
    if (!row || !byId.has(m.id)) return tell(false, "Something you moved isn't there any more. Nothing moved.", [m.id]);
    if (admin) continue;
    if (row.origin !== 'player') return tell(false, `The ${row.name} is fixed in place. Nothing moved.`, [m.id]);
    if (occupied(row, main) && JSON.stringify(m.spot) !== JSON.stringify(row.flags?.spot)) return tell(false, `Someone's using the ${row.name}. Nothing moved.`, [m.id]);
  }
  const items = adds.map((m) => getItem(m.item));
  const noItem = adds.find((m, i) => items[i]?.type !== 'furniture');
  if (noItem) return tell(false, `There's no furniture item "${noItem.item}". Nothing moved.`);
  // the room as it would stand, then each moved piece checked against the pieces that stayed put (staff place freely).
  // Pieces moved together keep their own shape (chairs tucked under a table overlap it), so they aren't checked
  // against each other: the client's arrange mode moves a group the same way (room-arrange.js moveHeld)
  if (!admin) {
    const moved = new Set(moves.map((m) => m.id));
    const after = pieces.map((p) => { const m = moves.find((x) => x.id === p.id); return m ? { ...p, spot: m.spot } : p; });
    const bad = moves.filter((m) => { const p = after.find((x) => x.id === m.id); return !spotFits(spec, after.filter((x) => x !== p && !moved.has(x.id)), p, m.spot, { byHand: true }); });
    if (bad.length) {
      const names = [...new Set(bad.map((m) => byId.get(m.id).name))];
      return tell(false, `There's no room for the ${names.slice(0, 3).join(', the ')} where you put ${names.length > 1 ? 'them' : 'it'}. Nothing moved.`, bad.map((m) => m.id));
    }
  }
  if (!admin) {
    const now = Date.now();
    if (now - (lastLayout.get(player.id) || 0) < LAYOUT_GAP_MS) return tell(false, 'Give it a moment before you save again. Nothing moved.');
    lastLayout.set(player.id, now);
  }
  const touched = [];
  const plantMoves = moves.filter((m) => isPlantId(m.id));
  if (plantMoves.length) {
    const pots = (spec.pots || []).map((c) => c.slice());
    for (const m of plantMoves) { const i = +m.id.slice(6), p = byId.get(m.id), q = resolveSpot(spec, m.spot, p.dims); if (pots[i]) pots[i] = [q.u, q.v, pots[i][2] || 1]; }
    await savePlants(main, pots);
  }
  const rugMove = moves.find((m) => isRugId(m.id));
  if (rugMove) { const q = resolveSpot(spec, rugMove.spot, byId.get('rug').dims); await saveRug(main, q.u, q.v, q.turn); }
  const decorMoves = moves.filter((m) => isDecorId(m.id));
  if (decorMoves.length) await saveDecor(main, decorMoves);
  const furnMoves = moves.filter((m) => !isPlantId(m.id) && !isRugId(m.id) && !isDecorId(m.id));
  if (furnMoves.length) {
    const spots = Object.fromEntries(furnMoves.map((m) => [m.id, m.spot]));
    const saved = await updateFurnitureWhere(
      `UPDATE furniture SET flags = jsonb_set(COALESCE(flags, '{}'::jsonb), '{spot}', ($1::jsonb) -> id) WHERE id = ANY($2::text[]) AND zone_id = $3${admin ? '' : " AND origin = 'player'"}`,
      [JSON.stringify(spots), furnMoves.map((m) => m.id), main]);
    if (saved.length !== furnMoves.length) console.warn(`[roomstage] arrange layout wrote ${saved.length} of ${furnMoves.length} pieces in ${main}`);
    touched.push(...saved.filter((r) => r.origin === 'authored').map((r) => r.id));
  }
  const decorOut = removes.filter((m) => isPlantId(m.id) || isRugId(m.id) || isDecorId(m.id)).map((m) => m.id);
  const furnOut = removes.filter((m) => !decorOut.includes(m.id));
  if (furnOut.length) {
    await deleteFurnitureWhere('DELETE FROM furniture WHERE id = ANY($1::text[]) AND zone_id = $2', [furnOut.map((m) => m.id), main]);
    touched.push(...furnOut.filter((m) => rows.get(m.id)?.origin === 'authored').map((m) => m.id));
  }
  const zoneFile = decorOut.length ? await dropRoomDecor(main, decorOut) : false;
  for (const [i, m] of adds.entries()) {
    const row = authoredFurnitureRow(items[i], main, m.spot, randomUUID().slice(0, 4));
    await insertFurniture({ ...row, flags: JSON.stringify(row.flags) });
    touched.push(row.id);
  }
  if (admin && syncFiles) for (const id of touched) await syncEntityFile('furniture', id).catch((e) => console.warn('[roomstage] content file', id, e.message));
  if (sheetOps.length) await arrangeSheets(sheetOps, player, main, admin);
  emit('furniture.changed', { zoneId: main });
  broadcast?.(zoneId, { type: 'zone_event', message: `${player.handle} rearranges the furniture.` }, player.id);
  const files = (admin && syncFiles && touched.length ? ` ${touched.length} content file${touched.length > 1 ? 's' : ''} written under content/furniture.` : '') + (zoneFile ? ` content/zones/${main}.json written.` : '');
  const what = [moves.length && `${moves.length} moved`, adds.length && `${adds.length} added`, removes.length && `${removes.length} removed`].filter(Boolean).join(', ');
  return tell(true, (all.length === 1 && moves.length === 1 ? `You move the ${byId.get(moves[0].id).name}.` : `You rearrange the room: ${what}.`) + files);
}

// ── paper on the walls in the arrange mode ────────────────────────────────────────────────────────
// A sheet (`room.sheets`) is a furniture row a plugin hangs as a run; where the run goes is `flags.sheet_spot`
// `{ wall, along? }` on its rows (along in the room's units; none, the clearest stretch of that wall). The arrange mode drags a
// run along the walls and sends `sheet:<id>@<wall>[:<along>]` for each of its sheets, and hangs a carried one from its
// Posters menu (`arrange sheets`, the `room.sheetStock` gather) as `sheet+<inv>@<spot>`, which the plugin that owns
// the roll does (`room.sheetHang`). The stage only checks the wall is one of the room's and the row is a sheet.
const SHEET_WALL = new Set(['left', 'right', 'front', 'back']);
function parseSheetOps(words) {
  const out = [];
  for (const w of words) {
    const m = /^sheet([:+])([\w:.-]{1,80})@(left|right|front|back)(?::(-?\d+(?:\.\d+)?))?$/.exec(w);
    if (!m) return null;
    const spot = { wall: m[3], ...(m[4] != null ? { along: Math.round(Number(m[4]) * 100) / 100 } : {}) };
    out.push(m[1] === '+' ? { inv: m[2], spot } : { id: m[2], spot });
  }
  return out.length > 14 ? null : out;
}
// `check`: say whether they'd all go, writing nothing. Otherwise do them: one write per moved sheet (a run is seven at
// most), then each carried roll hung by its plugin.
async function arrangeSheets(ops, player, main, admin, { check = false } = {}) {
  const spec = stageSpec(main);
  const hung = new Set(sheetsOf(main).map((s) => s.id)), rows = new Map(getZoneFurniture(main).map((f) => [f.id, f]));
  for (const op of ops) {
    if (op.spot.wall && Array.isArray(spec?.glass) && spec.glass.includes(op.spot.wall)) return { ok: false, message: "Paper won't stick to glass. Nothing moved.", bad: [op.id || op.inv] };
    if (op.inv) continue;
    const f = rows.get(op.id);
    if (!f || !hung.has(op.id)) return { ok: false, message: "A poster you moved isn't there any more. Nothing moved.", bad: [op.id] };
    if (!admin && f.origin !== 'player') return { ok: false, message: `The ${f.name} is pasted down for good. Nothing moved.`, bad: [op.id] };
  }
  if (check) return { ok: true };
  let moved = 0, put = 0;
  for (const op of ops.filter((o) => o.id)) {
    const f = rows.get(op.id);
    if (JSON.stringify(f.flags?.sheet_spot || null) === JSON.stringify(op.spot)) continue;
    await updateFurniture(f.id, { flags: JSON.stringify({ ...(f.flags || {}), sheet_spot: op.spot }) });
    moved++;
  }
  for (const op of ops.filter((o) => o.inv)) {
    const done = await gatherHook('room.sheetHang', { player, zoneId: main, inv: op.inv, spot: op.spot });
    if (done.some(Boolean)) put++;
  }
  if (moved) emit('room.sheetsChanged', { zoneId: main });
  const what = [put && `${put} poster${put > 1 ? 's' : ''} put up`, moved && 'the posters moved'].filter(Boolean).join(', ');
  return { ok: true, message: what ? `You rearrange the walls: ${what}.` : 'The posters stay where they are.' };
}
// The Posters menu: what this player carries that would hang as a sheet. Sent once when the menu opens.
async function arrangeSheetStock(player) {
  if (!controls(player, mainOf(player.current_zone)) && !adminHere(player)) return { type: 'error', message: "This isn't your place to rearrange." };
  const items = (await gatherHook('room.sheetStock', player)).flat().filter((s) => s && s.inv && s.set);
  sendToPlayer(player.id, { type: 'room_sheet_stock', items });
  return { type: 'noop' };
}

// ── arrange catalog ───────────────────────────────────────────────────────────────────────────────
// The admin mode's menu: every furniture item, with how it's drawn (rowLook), so the client can lay a new piece out
// before it exists. Staff on a local database only; sent once when the menu opens, never with the room.
function arrangeCatalog(player) {
  if (!adminHere(player)) return { type: 'error', message: 'The furniture catalog is for staff, on a local server.' };
  const items = [];
  for (const item of getItemCache().values()) {
    if (item.type !== 'furniture') continue;
    const flags = { ...(item.flags || {}), item_id: item.id }, row = { id: item.id, name: item.name, object_type: furnitureObjectType(flags), flags, price: item.value };
    if (!rowDrawn(row)) continue;
    items.push({ id: item.id, name: item.name, value: item.value ?? null, ...rowLook(row, item), verbs: furnitureInteractions(item), container: row.object_type === 'container' });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  sendToPlayer(player.id, { type: 'room_catalog', items });
  return { type: 'noop' };
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

// ⚠ A BOX FILLING UP OR EMPTYING (fill.js). The engine's `container.view` counts the box on every open, put and take,
// and a piece whose level moved is sent again to whoever sees into its room, as a moved piece is: the piece alone,
// or the room's pieces when more than one moved (the warm landing). Nothing is read to do it.
function sendFills(ids) {
  const rooms = new Map();
  for (const id of ids) {
    const f = getFurnitureById(id), main = f ? mainOf(f.zone_id) : null;
    if (main && watchersOf(main).size) rooms.set(main, [...(rooms.get(main) || []), id]);
  }
  for (const [main, list] of rooms) {
    const spec = stageSpec(main);
    if (!spec) continue;
    roomPieces(main, spec).then((pieces) => {
      const one = list.length === 1 ? pieces.find((p) => p.id === list[0]) : null;
      if (list.length === 1 && !one) return;
      for (const pid of watchersOf(main)) sendToPlayer(pid, { type: 'room_piece', zone: main, ...(one ? { piece: one } : { pieces }) });
    }).catch((e) => console.error('[roomstage] fill:', e.message));
  }
}
function fillWarmed(ids) { sendFills(ids.filter((id) => fillOf(id) != null)); }

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

// ⚠ SHEETS ON THE WALLS: paper hung as a run, edge to edge in slot order (plugins/posters `room.sheets`, a sync gather,
// so it's RAM). `room_view` carries them, and one going up or coming down is sent to whoever has the room open as
// `room_sheets`, the whole list. With every slot of a run hung, the client plays the join (panels/room-sheets.js).
const sheetsOf = (zoneId) => gatherHookSync('room.sheets', zoneId).flat().filter((s) => s && s.set && Number.isInteger(s.slot));
on('room.sheetsChanged', ({ zoneId }) => {
  if (!zoneId) return;
  const main = mainOf(zoneId), set = viewersOf(main);
  if (!set.size) return;
  const sheets = sheetsOf(main);
  for (const pid of set) sendToPlayer(pid, { type: 'room_sheets', zone: main, sheets });
});

// ⚠ WHAT STANDS ON THE FLOOR: a truck on a depot shed's lift (plugins/trucking `room.vehicles`, a sync gather, so
// it's RAM). It's per viewer (your own trucks are the ones you can call up), so a change is gathered for each.
const vehiclesOf = (zoneId, player) => gatherHookSync('room.vehicles', zoneId, player)[0] || null;
on('room.vehiclesChanged', ({ zoneId }) => {
  const main = mainOf(zoneId);
  for (const pid of viewersOf(main)) { const p = getLivePlayer(pid); if (p) sendToPlayer(pid, { type: 'room_vehicles', zone: main, vehicles: vehiclesOf(main, p) }); }
});
// Called one of yours out from the counter (server/engine/vehicle-stand.js `callUp`): the room opens round you, so
// you're stood in it as the vehicle comes out and can walk up to it. Already open, the change above is enough.
on('vehicle.calledUp', ({ player, zoneId }) => {
  const main = mainOf(zoneId);
  if (!player || viewersOf(main).has(player.id) || !specOf(main) || loggedPanelsSync(player)) return;
  cmdRoom([], 'room', player).catch(() => {});
});

// A body reprinted in a room with release vats (the Vat Hall; the engine's `vat.emerging`): one of them, in turn, is
// the one it comes down to. They're stood just out of its front, where they'll be when the picture hands them back,
// and everybody with the room open is told which vat and when, so the Stage plays it (panels/room-vatcycle.js). RAM only.
// A vat is taken from its cue's t0 until its glass has shut again (VAT_CYCLE.close's end in panels/room-vatcycle.js).
// A body goes to the first vat that's free, in the room's order; with all of them taken it waits for the first to free.
const VAT_BUSY_MS = 19600;
const bayFree = new Map();   // main zone -> Map(piece id -> when it's free, ms)
on('vat.emerging', async ({ actor, zone, t0, npc = false }) => {
  try {
    const main = zone && mainOf(zone), spec = main && stageSpec(main);
    if (!actor?.id || !spec) return;
    const L = roomLayout(spec, await roomPieces(main, spec));
    const bays = L.placed.filter((p) => p.form === 'vat' && p.state === 'release');
    if (!bays.length) return;
    const now = t0 || Date.now(), free = bayFree.get(main) || new Map();
    bayFree.set(main, free);
    const p = bays.find((b) => (free.get(b.id) || 0) <= now) || bays.reduce((a, b) => ((free.get(b.id) || 0) < (free.get(a.id) || 0) ? b : a));
    const start = Math.max(now, free.get(p.id) || 0);
    free.set(p.id, start + VAT_BUSY_MS);
    const [fu, fv] = facing(p.turn), o = L.world(p.u, p.v, 0), f = L.world(p.u + fu, p.v + fv, 0);
    where.set(actor.id, { zone: main, at: [+(p.u + fu).toFixed(2), +(p.v + fv).toFixed(2)], yaw: +Math.atan2(f[0] - o[0], f[2] - o[2]).toFixed(3), seat: null });
    const cue = { type: 'room_vat', zone: main, who: actor.id, piece: p.id, t0: start };
    // the room opens round somebody who plays with the panels, so they wake in the vat; the log and text rungs keep
    // the words alone
    if (!npc && !viewersOf(main).has(actor.id) && !loggedPanelsSync(actor)) await cmdRoom([], 'room', actor).catch(() => {});
    const send = () => {
      for (const id of new Set([...watchersOf(main), ...(npc ? [] : [actor.id])])) sendToPlayer(id, cue);
      sendPeople(main).catch(() => {});
    };
    // every vat taken: this body waits its turn for the first one to free
    const wait = start - Date.now();
    if (wait > 50) setTimeout(send, wait).unref?.(); else send();
  } catch (e) { console.warn('[roomstage] vat.emerging:', e?.message); }
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
  // a step through a doorway: whoever's watching either room sees them walk out of one and into the other
  if (was && was !== main && walkedBy(from, zone)) noteMove(actor.id, from, zone);
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
  // a room with two ways out to the street (a boatshed's water door) has the one onto its own building's facade first
  const own = getMap(getZone(roomId)?.map_id)?.parent_zone_id;
  const out = Object.values(getZone(roomId)?.exits || {}).flat();
  for (const id of own && out.includes(own) ? [own, ...out.filter((x) => x !== own)] : out) {
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
  where.delete(id); lastPos.delete(id); told.delete(id); acts.forget(id); lastLayout.delete(id);
});

// What a player is doing with their hands (acts.js): their own first-person ritual says so as it goes, and a dose
// taken from the log plays its route once. Everybody else with the room open sees it.
on('room.act', (msg) => acts.fromClient(msg));
on('player.drugUsed', (e) => acts.fromDose(e));

// `roompack`: the Pack, ROOM's inventory and paper doll (pack.js)
export const commands = { room: cmdRoom, arrange: cmdArrange, roompack: cmdRoomPack };

await loadRugs().catch((e) => console.error(`[roomstage] room rugs failed to load: ${e.message}`));
await loadDecor().catch((e) => console.error(`[roomstage] room decor failed to load: ${e.message}`));
await loadPlants().catch((e) => console.error(`[roomstage] room plants failed to load: ${e.message}`));

// a box's count on every open, put and take (fill.js); the view is only read, never changed
export const hooks = {
  // what an NPC is dressed for now, so the examine line names what the Stage draws them in (commands/world.js)
  'npc.dressedFor': (n) => (n?._showering ? 'bath' : n?.zone_id ? occasionOf(n, n.zone_id) : null),
  'container.view': ({ view }) => { const moved = noteView(view); if (moved.length) sendFills(moved); },
};

export const _test = { setSyncFiles: (on) => { syncFiles = !!on; }, adminHere, noteMove, movesOf, acts,powerOf, occasionOf, dressedAs, wearSweep, buildingOfRoom, clearBuildings, stageSpec, nextDoor, watchersOf, tellAvail, told, life, watching, viewers, where, roomPieces, specOf, viewPayload, aheadPayload, locksOf, lockSweep, peopleIn, beastsIn, resolveSpot, parseArrange, annexOf, mainOf, outlookOf, outlookPayload, skyTick };
