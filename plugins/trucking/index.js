// THE LONG HAUL: driving the void between regions.
// Three rules (the corridor synthesises zones, never render cells; the drive IS the crossing; the
// road's edge is a law, not a wall): see docs/systems-trucking.md#the-four-rules

import { getZone, getAllZones, getMinimapData, addPlayerToZone, removePlayerFromZone, getLivePlayer } from '../../server/engine/world.js';
import { saveDrivingState, restoreDrivingState } from './resume.js';
import { cap } from '../../server/engine/util.js';
import { applyDamage, impactSplit, grindSplit, IMPACT_AREAS, damageOf, overall, PARTS, PART_LABELS, partBand,
  isBroken, isCosmetic, PART_ITEMS, PART_SHARE, COSMETIC_MUL, BROKEN_AT } from './damage.js';
import { grimeOf, grimeBand, washCost } from './filth.js';
import { FITTINGS, FIT_IDS, SLOTS, installedFits, fitInSlot, fitSuffix, priceFor } from './fittings.js';
import { TRINKETS, TRINKET_IDS, CAB_SLOTS, installedTrinkets, trinketPrice } from '../../client/shared/cab-trinkets.js';
import { sendToPlayer, sendToZone, teachVerb } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { setPosture } from '../../server/engine/posture.js';
import { query } from '../../server/models/db.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { noteFreshVehicle, takeFreshVehicle } from '../../server/engine/fresh-vehicle.js';
import { randomUUID } from 'crypto';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { prefersTextMinigamesOrDefault, prefersLoggedPanelsOrDefault } from '../../server/engine/presentation.js';
import { startTextDrive, stopTextDrive, setTextTarget, isTextDriving, textDriveCommand } from './textdrive.js';
import { COMMODITIES, quotesFor, askPrice, bidPrice, capacityFor, marketDay, DEFAULT_TRAILER_KG } from './market.js';
import { TYPES, HITCH_MPH } from '../../client/game/js/panels/flight-model.js';
import { fleetOf, trucksAt, getTruck, buyTruck, sellTruck, persistTruck, resaleValue, truckType, TRUCK_TYPES,
  setCondition, saveTruckData, setFuel, recoverTruckTo } from './fleet.js';
import { TUNE_PARAMS, KITS, BANDS, bandOf, tuneRange, clampTune, installedKits, effTruckParams,
  repairCost, FIELD_CAP, sanitizePaint, paintCost, FLASHES, FINISHES, ARTS, PAINT_PRESETS, PAINT_DEFAULT, presetPaint, startTrouble, wearForImpact, burnMul,
  BREAKDOWNS, fixOdds, FIX_GRACE_TILES, isTerminal, FIX_MIN_FAB, SPARES_ITEM,
  DASH_MATERIALS, DASH_COLOURWAYS, sanitizeTrim, isDashMaterial, isDashColourway, trimCost,
  sanitizeCustomTrim, isTrimHex, CUSTOM_COL, paintOf, factoryPaint } from './rig.js';
import { stockTrim } from '../../client/shared/cab-trim.js';
import { skillCheck, effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { crossingChain, crossingDest, crossingInfo, voidGateOf, launchCrossing, VOIDS,
  registerCrossingDistance, registerGateFilter, registerCrossingPoints, registerTrailCuts, beaconsNear } from '../voidwalking/index.js';
import { pushRoadWindow } from './mmroad.js';
import { cmdRoadTest, roadTestTick, roadTestPark, roadTestImpact, isLicensedDriver, unlicensedLine } from './roadtest.js';
import { registerDepotBrief } from './onboard.js';
import { rentStock, rentFee, makeRental, activeRental, reclaimRental, sweepRentals, rentalExpired, isRental,
  rentalLeft, fmtLeft, RENT_TERM_MS } from './rental.js';
import { stampIfMissing, serviceSheet, hornCatalogue, hornPrice, hornOf } from './service.js';
import { registerZoneReloadHook } from '../../server/engine/world.js';
import { registerCellOverlay, registerFarRoads } from '../flight/state.js';
import { worldRoadProvider, roadsNear } from './roadnet.js';

// Rim gates derive from tile positions and are memoised, so a zone reload must clear them.
// ⚠ Cleared wholesale: editing one tile can create or destroy a gate in a neighbouring region.
// roadnet.js keys its memo on gateGeneration(), which this bumps.
registerZoneReloadHook(() => _clearGateCache());

// The highway for everybody not driving it. Pushed, because flight can't import this plugin.
// ⚠ A render provider, never placed ground: ground under surfaceAt would delete the rim gates.
registerCellOverlay(worldRoadProvider());
// The same road beyond the 36-tile overlay window, as geometry. Must not reach surfaceAt either.
registerFarRoads((x, y, radius) => roadsNear(x, y, radius));

// Crossing length, room positions and trail cuts all come off the same gatePair the road anchors
// on, so room count and geometry can't disagree. gatePair is symmetric, so out and back match.
// ⚠ Null rather than a guess: a leg with no buildable road leaves its rooms placeless, which is safe.
// ⚠ The trail is seeded on the unordered pair, so a crossing and its return are the same footpath.
const trailKey = (a, b) => [a, b].sort().join('|');

// Cached per (pair, window): every room asks, and the road is static between deploys.
let _trailCache = null;
function trailBetween(voidKey, region, window) {
  const key = `${trailKey(voidKey, region)}|${window}`;
  if (_trailCache?.key === key) return _trailCache.trail;
  const pair = gatePair(voidKey, region);
  if (!pair) return null;
  // ⚠ Built on the gate distance, not the room count: the room count derives from the trail (cycle).
  const gd = Math.max(1, Math.round(Math.hypot(pair.to.x - pair.from.x, pair.to.y - pair.from.y)));
  const route = networkRoute(voidKey, region, window, gd);
  if (!route?.legs?.length) return null;
  const trail = trailFor(route, trailKey(voidKey, region), window);
  _trailCache = { key, trail };
  return trail;
}

// Where each room of the crossing stands, in world tiles, plus whether it is a camp. `reqs` is a list
// of distances along the SPINE — a room's index, because a room is a tile.
registerCrossingPoints((voidKey, dest, window, reqs) => {
  if (!dest?.region || !Array.isArray(reqs) || !reqs.length) return null;
  const trail = trailBetween(voidKey, dest.region, window);
  if (!trail) return null;
  return reqs.map((d) => trailPos(trail, d));
});

// The cuts off the spine. ⚠ A cut existing (geometry) and being open (seeded per window) differ.
registerTrailCuts((voidKey, dest, window) => {
  const trail = dest?.region ? trailBetween(voidKey, dest.region, window) : null;
  if (!trail?.cuts?.length) return [];
  return trail.cuts.map((c) => ({
    fromD: c.fromD, toD: c.toD, len: c.len, saves: c.saves, open: c.open,
    pts: (() => {
      const n = Math.max(1, Math.round(c.len));
      const out = [];
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        out.push({ x: c.a.x + (c.b.x - c.a.x) * t, y: c.a.y + (c.b.y - c.a.y) * t });
      }
      return out;
    })(),
  }));
});

// A walker is only offered the roads that leave from the entrance they stepped off at.
registerGateFilter((regionKey, x, y, dests) => destsFromGate(regionKey, x, y, dests));

registerCrossingDistance((fromRegion, toRegion) => {
  const pair = gatePair(fromRegion, toRegion);
  return pair ? Math.hypot(pair.to.x - pair.from.x, pair.to.y - pair.from.y) : 0;
});
import { routeOptions, aimedDest, destByWord } from './routes.js';
import { surfaceAt } from '../flight/state.js';
import { rigs, rigOf, mountRig, dismountRig, reconcileTruck, crossToNode, driveToZone, flushZone,
  joinCorridor, landOn, unbog, pushCab, cabContext, surfaceUnder, truckContactsNear,
  announceBreak, switchLimb, atOrBeforeFork, cbLine, passSign, passPlaza, passHitcher, markWreck, pumpAt, pumpClamp, FUEL_FULL,
  gatePair, destsFromGate, rigLocked, tryDoorBoard, doorBoardLine,
  _clearGateCache, networkRoute,
  ridingRigOf, seatsFree, boardPassenger, alightPassenger,
  truckElecDead, crewedRigs } from './state.js';
import { corridorPos, corridorAt, TILES_PER_ROOM, sOfNode, wreckNear, trailFor, trailPos } from './corridor.js';
// bench.js imports yard helpers back from this file; see its header.
import { cmdRig, sparesInHand, spendSpares, truckStockTrim, sanitizeTrimResolved } from './bench.js';
import { cbStatus, cbTune, cbPower, cbSpeaker, cbTransmit } from './cb.js';
import { tickHijackers, playerHijack } from './hijack.js';
import { collideTrucks, narrateCollision } from './collide.js';
import './bunk.js';   // registers the sleeper cab as a place you can sleep — see the file header
import './hvac.js';   // registers the cab as a climate-controlled box while the engine runs
import { schedule } from '../../server/engine/scheduler.js';
import { hitcherAt } from './hitchers.js';
import { runScale, afterDrive, customsAnswer, pendingCustoms, scaleAt, releaseImpound } from './scale.js';
import { tryDeck, plazaHere, weighHere } from './plaza.js';
import { lockTick } from './lock.js';
import { registerAction, dispatchAction } from '../../server/engine/actions.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { TRAILER_TYPES, trailerType, trailersAt, trailersOf, getTrailer, trailerOnTruck,
  buyTrailer, hitchTrailer, dropTrailer, saveLoad, canDrop, declaredKg, actualKg, stashKg, setTrailerCondition,
  hitchReach, posed, refreshStanding, stockPose, findStockPose, standStock, paintTrailer, boxColour,
  sellTrailer, trailerResale } from './trailers.js';

export const say = (msg) => ({ type: 'emote', message: msg });

// Above this, a contact is reckless and witnessed in a city.
// ⚠ A fraction of the speed range, not a fixed number: rescale it if the range changes.
const RECKLESS_MPH = 44;

// How often the room hears about a horn. The sound itself must never get a cooldown (see cmdHorn).
const HORN_SAY_MS = 60_000;
const HARD_START_LINE = '<span class="text-amber">It turns over, and over, and doesn\'t catch. You wait. You try it again and it goes, in a cloud of something that shouldn\'t be blue.</span>';

// ── drive ──
// Every mount path (cmdDrive, mountOnCrossing, resume.js) must hydrate the rig from the truck row
// here: mountRig builds a bare bobtail rig because regress fakes share it and it must not query.
// ⚠ The hitch is what the DB says: re-read trailerOnTruck, never a remembered id (it goes stale).
export async function hydrateFromTruck(rig, owned) {
  rig.truckId = owned.id;
  rig.typeId = owned.type_id;
  rig.type = owned.type;
  rig.cd = owned.custom_data || {};
  // The component bag first, and the headline number derived from it, never the other way round.
  rig.dmg = damageOf({ cd: rig.cd, condition: owned.condition });
  rig.condition = overall(rig.dmg);
  // Grime is read off the bag, never derived: a truck older than filth is genuinely clean.
  rig.grime = grimeOf(rig.cd);
  // The odometer goes in so servicing wear (service.js) matches what the bench quotes.
  rig.params = effTruckParams(owned.type_id, rig.cd, rig.condition, rig.dmg, owned.odometer ?? 0);
  rig.burnMul = burnMul(rig.cd);           // a hard turbo drinks; the aux tank is on `params.tank`
  rig.fuel = owned.fuel ?? 1;
  rig.travelled = 0;
  // `|| null`: mountRig declares this null, and bobtail must be spelled one way.
  rig.trailer = (await trailerOnTruck(owned.id)) || null;
  // Cargo lives on the trailer row, so it rides with the box.
  if (rig.trailer?.cargo) rig.cargo = rig.trailer.cargo;
  return rig;
}
async function cmdDrive(args, raw, player) {
  if (rigOf(player)) return say("You're already behind the wheel.");

  // Licence gate. Sits above the crossing branch and the ownership check; see isLicensedDriver.
  if (!await isLicensedDriver(player, { fleetOf })) return unlicensedLine();

  // Already out in the waste on foot? Then there is a rig at the roadhead, as before — somebody
  // who walked out and thought better of it shouldn't have to walk back for a truck.
  if (player._crossing) return mountOnCrossing(player);

  // You mount on the shed's facade tile (flags.vehicle_bay opens it to a truck) and drive out.
  // Nothing is exempted from collision: see docs/systems-trucking.md#the-shed-you-start-in
  const stood = getZone(player.current_zone);
  const bay = depotAt(stood);
  const yardId = bay ? yardIdOf(stood, bay) : null;
  // The bay is a room at grid 0,0; its facade is the real tile the rig stands on. mountSpot decides.
  const spot = mountSpot(stood);
  const door = spot?.fromShed ? spot.zone : null;
  const here = spot ? spot.zone : stood;
  const depot = bay || depotAt(here) || bayForYard(stood?.id)?.depot;
  if (!depot) {
    return say("There's nothing to drive here. Rigs run out of the freight yards: find a depot with a truck in it.");
  }
  if (here.grid_x == null) return say("There's no road out of this yard.");

  // Ownership is the gate. The bay and its apron both count as this depot.
  const zonesHere = bay ? depotZonesOf(stood, bay) : depotZonesOf(here, depot);
  const parked = await trucksAt(player.id, zonesHere);
  // Takes plate, model or id; nothing when only one truck is in the yard.
  const want = (args || []).join(' ').trim();
  const owned = pickParked(parked, want);
  if (!owned && parked.length) return whichTruckLine('drive', parked, want);
  // An expired hire goes back the moment you reach for the keys (rental.js's lazy clock).
  if (owned && rentalExpired(owned)) {
    await reclaimRental(owned.id, player.id);
    await repush(player);
    return say(`<span class="text-amber">The desk has the keys to the ${owned.type.name} back on their hook before you reach it. The hire ran out.</span>`
      + ` <span class="text-dim">Another is a click away on the yard's hire line.</span>`);
  }
  // Service baseline for a truck that never had one: one write at first mount, none after.
  if (owned) {
    const stamped = stampIfMissing(owned.custom_data || {}, owned.odometer);
    if (stamped) {
      owned.custom_data = stamped;
      await query(`UPDATE trucks SET custom_data = jsonb_set(COALESCE(custom_data,'{}'::jsonb), '{svc}', $1::jsonb, true) WHERE id = $2`,
        [JSON.stringify(stamped.svc), owned.id]).catch(() => {});
    }
  }
  if (!owned) {
    const mine = await fleetOf(player.id);
    const elsewhere = mine.find(t => t.depot_zone && !zonesHere.includes(t.depot_zone));
    if (elsewhere) {
      const z = getZone(elsewhere.depot_zone);
      return say(`Your ${elsewhere.type.name} is parked at ${z ? (depotAt(z)?.name || z.name) : 'another yard'}, not here.`);
    }
    return say(`You don't own a truck. There's a dealer's line at the fence: see the ${teachVerb('yard', 'yard')}.`);
  }

  // Impounded: paying is just `drive` again.
  if (owned.impound_fee) {
    const paid = await releaseImpound(player, owned);
    if (paid && !paid.released) return paid;      // could not afford it — the truck stays put
    if (paid) sendToPlayer(player.id, paid);
  }

  // A derelict argues first: a delay, never a refusal. ⚠ Rolled at the mount, spent by whichever rung
  // actually turns the key (the text rung below, or the visual rung's first catch in cmdTruckSync).
  const hardStart = startTrouble(owned.condition);

  // ⚠ Where it stands (x/y, the door tile) and where it lives (`depot`, the yard) differ: passing the
  // door tile as depot would re-home the truck to a zone no depotZonesOf set contains.
  // ⚠ `spot?.heading`: mountSpot can answer null.
  const rig = mountRig(player, { x: here.grid_x, y: here.grid_y, heading: spot?.heading ?? 180, depot: yardId || here.id });
  rig.zoneId = here.id;
  rig._hardStart = hardStart;      // spent by whichever rung actually turns the key
  // ⚠ Anything without a pose gets one first (see standStock). Use the bay, not `here` (the door
  // tile), and depotFrom, not yardId (null on the apron).
  const yardCtx = depotFrom(stood?.id);
  await standStock(yardCtx?.bay || null, standPlaces(yardCtx?.bay, depot), spot?.heading ?? 180);
  // Refresh both tiles: you mount on the door and the stock stands on the hardstand.
  await Promise.all([...new Set([here.id, yardId].filter(Boolean))].map(z => refreshStanding(z)));
  // What you bought is what you drive: see hydrateFromTruck.
  await hydrateFromTruck(rig, owned);

  // Unlocked by getting in; `park` locks it again, so the stored state is "is anybody in it".
  rig.locked = false;
  setPosture(player, 'driving');
  // ⚠ This moves you onto the door tile, inside the shed; driving out is the player's job.
  // driveToZone runs after the rig exists so the move gate sees a driver, not a pedestrian.
  // `fromShed` means the roller door is narrated; a driver already on the apron gets no door.
  const fromShed = !!(bay && here === door && door.id !== player.current_zone);
  if (fromShed) driveToZone(player, rig, door.id);
  else if (bay && yardId && yardId !== player.current_zone) driveToZone(player, rig, yardId);

  // The minigame axis (docs/systems-display-mode.md): without the cab a player can't run at all, so
  // this is prefersTextMinigames. The server drives a text rig with the same stepTruck; see textdrive.js.
  if (await prefersTextMinigamesOrDefault(player)) {
    // Hand the pane back: this rung sends no truck_sim, so without this the depot panel stays up.
    sendToPlayer(player.id, { type: 'truck_depot_close' });
    // A text driver has no ignition, so pulling out is the start. Set before the cold-start line.
    rig.engineOn = true;
    if (rig._hardStart) { rig._hardStart = false; sendToPlayer(player.id, { type: 'emote', message: HARD_START_LINE }); }
    const dest = rig.cargo?.to || defaultRunTarget(here);
    startTextDrive(player, rig, { arrive, leaveTheMap });
    setTextTarget(player.id, dest);
    // The roller door, at this rung, is a sentence.
    const doorLine = fromShed
      ? ' The roller door grinds up in front of you, a bar of daylight at a time, and the yard is out there waiting.'
      : '';
    return say(`<span class="text-green">You haul yourself up into the cab. The diesel catches on the second turn and the whole frame starts to shake.${doorLine}</span>\n<span class="text-dim">She holds the road; the box is yours. <b>revs up</b> / <b>revs down</b> to shift, <b>boot</b>, <b>cruise</b>, <b>coast</b>, <b>brake</b>, <b>jake</b> on a descent. <b>park</b> to pull over, <b>haul</b> and <b>market</b> at a yard.</span>`);
  }

  // ⚠ The type goes after the spread: cabContext carries its own `type: 'truck_ctx'`, and if it wins
  // the client never opens the cab (silently). `fromBay` tells the cab to draw the roller door.
  sendToPlayer(player.id, { ...cabContext(rig, { mounted: true, fromBay: fromShed ? (depot.name || 'the shed') : null }), type: 'truck_sim' });
  // The bench comes to the cab as an overlay; `_svc` latches it so baySvcTick closes it when the
  // truck leaves the shed. Only in a shed with a roller door.
  if (fromShed || baySvcFor(rig)) {
    rig._svc = true;
    await pushBayService(player, { spawn: true });
  }
  const rollUp = fromShed
    ? ` The roller door grinds up in front of you, a bar of daylight at a time.`
    : '';
  return say(`<span class="text-green">You haul yourself up into the cab and pull the door to. It's cold in here and nothing is running: the key is in the barrel where you left it.${rollUp} ${depot.name ? `${depot.name}'s` : 'The yard'} gate is open, and the road runs south.</span>`
    + `
<span class="text-dim">Turn the key (<b>K</b>, or the barrel on the shelf) and hold it until she catches.</span>`);
}

// Mount one particular truck through the ordinary `drive` path (the road test's school rig).
export const mountTruckById = (player, id) => cmdDrive([id], id, player);

// Where a text run heads when the deck is empty: the nearest depot in another region.
function defaultRunTarget(here) {
  const other = allDepots().find(d => d.flags?.region_id !== here.flags?.region_id);
  if (other) return { target: other.id, wantsRim: true };
  const local = allDepots().find(d => d.id !== here.id);
  return { target: local?.id || here.id, wantsRim: false };
}

// A depot is any zone carrying `flags.truck_depot`. Content decides which; this only reads it.
// ⚠ The flag must be an object with a `yard`; nothing else is a depot. Regress asserts every
// authored depot resolves a real yard tile.
function depotAt(zone) {
  const f = zone?.flags?.truck_depot;
  if (!f || typeof f !== 'object' || !f.yard) return null;
  return f;
}

// ── Which one of yours ──
// With one truck here nothing asks. `want` is an id (what panel buttons carry), a plate, or part
// of the model name. Ids first, because an id is exact.
function pickParked(list, want) {
  if (!want) return list.length === 1 ? list[0] : null;
  const w = String(want).trim().toLowerCase();
  if (!w) return list.length === 1 ? list[0] : null;
  return list.find(t => t.id.toLowerCase() === w)
    || list.find(t => (t.name || '').toLowerCase() === w)
    || list.find(t => (t.name || '').toLowerCase().includes(w))
    || list.find(t => t.type_id.toLowerCase() === w)
    || list.find(t => t.type.name.toLowerCase().includes(w))
    || null;
}
// The refusal is a menu: every line is the command that picks that truck.
// `byId` is for the bench, where a plate isn't a legal way to say it (see rigBench).
export function whichTruckLine(verb, list, want, byId = false) {
  const rows = list.map(t => {
    const label = t.name ? `<b>${t.name}</b> <span class="text-dim">(${t.type.name})</span>` : `<b>${t.type.name}</b>`;
    const arg = byId || !t.name ? t.id : t.name.toLowerCase();
    return `  ${label}: <span class="text-dim">${verb} ${arg}</span>`;
  }).join('\n');
  return say((want ? `Nothing of yours here answers to "${want}".` : `You have ${list.length} parked here. Which one?`) + `\n${rows}`);
}

// ── A depot is a building you walk into ──
// flags.truck_depot = { name, yard: '<zone id>' } lives on the bay interior; `yard` is the drivable
// hardstand outside, the one fact a bay can't derive. Lookups ask for the whole set of depot tiles.
// see docs/systems-trucking.md#a-depot-is-a-building-you-walk-into-2026-08-11
// ⚠ No fallback to the zone's own id: that would mount a truck inside a building with no surface.
export const yardIdOf = (zone, depot) => depot?.yard || null;
// Where stock stands at this depot, in preference order: the shed (the bay's facade tile, with
// painted bays), then the apron. Fixtures and one-tile depots fall back to the apron.
function standPlaces(bay, depot) {
  const shed = bay?.flags?.world_exit_zone ? getZone(bay.flags.world_exit_zone) : null;
  const yard = getZone(yardIdOf(bay, depot));
  const out = [];
  if (shed && shed.grid_x != null) out.push({ zone: shed, bays: true });
  if (yard && yard.grid_x != null && yard.id !== shed?.id) out.push({ zone: yard, bays: false });
  return out;
}
// ── Where a rig stands when you climb in ──
// Pure, and pulled out of cmdDrive so regress can assert you start in the shed facing out.
const OUT_HEADING = { north: 0, east: 90, south: 180, west: 270 };
export function mountSpot(stood) {
  // ⚠ Any of the depot's three tiles, not just the bay: `park` leaves you on the apron, and
  // depotAt alone made `drive` do nothing after parking.
  const ctx = depotFrom(stood?.id);
  if (!ctx) return null;
  const { bay, depot } = ctx;
  const door = bay?.flags?.world_exit_zone ? getZone(bay.flags.world_exit_zone) : null;
  // A bay with a facade puts you inside it. Anything else (test fixtures) mounts on the yard.
  if (door && door.grid_x != null) {
    const heading = OUT_HEADING[door.flags?.entrance];
    return { zone: door, heading: heading != null ? heading : 180, fromShed: true, depot };
  }
  const yard = getZone(yardIdOf(bay, depot));
  return { zone: (yard && yard.grid_x != null) ? yard : stood, heading: 180, fromShed: false, depot };
}
// ⚠ A depot is three tiles (bay, its facade door tile, the apron), whichever one you hand it.
// `park` stores a truck in the bay, so a set missing the bay breaks driving away from the apron.
// Every ownership lookup, the bench, the pump and the horn ask through here.
export const depotZonesOf = (zone, depot) => {
  const bay = depotAt(zone) ? zone : (bayForYard(zone?.id)?.zone || null);
  const d = depot || depotAt(bay);
  return [...new Set([zone?.id, bay?.id, d?.yard, bay?.flags?.world_exit_zone].filter(Boolean))];
};
// The bay a yard tile belongs to. Memoised: zone.describeRoom calls this on every look; zones are
// static between reloads.
let _yardIndex = null;
function yardIndex() {
  if (_yardIndex) return _yardIndex;
  _yardIndex = new Map();
  for (const z of getAllZones()) {
    const d = depotAt(z);
    if (!d?.yard) continue;
    _yardIndex.set(d.yard, { zone: z, depot: d });
    // ⚠ The door tile resolves to its depot too: `drive` mounts there and every depot verb asks here.
    if (z.flags?.world_exit_zone) _yardIndex.set(z.flags.world_exit_zone, { zone: z, depot: d });
  }
  return _yardIndex;
}
const bayForYard = (zoneId) => (zoneId ? yardIndex().get(zoneId) || null : null);
// The depot reachable from any of its three tiles. Exported through _test.
function depotFrom(zoneId) {
  const z = getZone(zoneId);
  const direct = depotAt(z);
  if (direct) return { bay: z, depot: direct, yard: getZone(yardIdOf(z, direct)) || z };
  const via = bayForYard(zoneId);
  if (via) return { bay: via.zone, depot: via.depot, yard: getZone(via.depot.yard) || z };
  return null;
}
// ── The door to the bunkroom ──
// ⚠ Derived from the exits, never a table of directions: one bunkroom sits east, the rest north.
function bunkFrom(zone) {
  for (const [dir, id] of Object.entries(zone?.exits || {})) {
    const z = getZone(id);
    if (z?.flags?.truck_bunkroom) return { dir, id, name: z.name };
  }
  return null;
}

// Every zone one depot holds boxes in, so `hitch` searches the set (see cmdHitch).
function hitchZones(zoneId) {
  const ctx = depotFrom(zoneId);
  if (!ctx) return [zoneId].filter(Boolean);
  return [...new Set([zoneId, ctx.bay?.id, ctx.yard?.id, ctx.bay?.flags?.world_exit_zone].filter(Boolean))];
}

// Mount on a crossing you are already walking.
async function mountOnCrossing(player) {
  const live = player._crossing;
  const info = crossingInfo(live.instanceId);
  if (!info) return say("The road won't resolve. Try the crossing on foot.");
  const destKey = info.dests?.[0]?.key;
  if (!destKey) return say('The road out of here goes nowhere anyone has charted.');
  const chain = crossingChain(live.instanceId, destKey);
  if (!chain.length) return say("The road won't resolve. Try the crossing on foot.");

  // ⚠ Your truck, if it's the one standing here: parking mid-crossing writes the void room as the
  // truck's depot_zone, so trucksAt finds it. Without hydrating, you'd get a generic rig and no trailer.
  const rig = mountRig(player, { x: 0, y: 0 });
  const mine = (await trucksAt(player.id, player.current_zone).catch(() => []))[0];
  if (mine) { await hydrateFromTruck(rig, mine); rig.zoneId = player.current_zone; }
  joinCorridor(rig, { instanceId: live.instanceId, destKey, voidKey: info.voidKey,
    window: info.window, chain, dest: crossingDest(live.instanceId, destKey) });
  // Line the rig up on the room the player is actually standing in, not the roadhead.
  const at = chain.indexOf(player.current_zone);
  if (at > 0) {
    rig.node = at;
    rig.s = sOfNode(rig.route, at);
    const p = corridorPos(rig.route, rig.s, 0);
    rig.x = p.x; rig.y = p.y; rig.heading = p.heading;
  }
  setPosture(player, 'driving');
  pushRoadWindow(player);   // see the note at the other join — a boundary event is a room too late
  sendToPlayer(player.id, { ...cabContext(rig, { mounted: true }), type: 'truck_sim' });   // type AFTER the spread: see cmdDrive
  return say(mine
    ? `<span class="text-green">You climb back up into the ${mine.name || 'cab'}, and the diesel catches on the second turn.</span>`
      + (rig.trailer ? ` <span class="text-dim">The ${rig.trailer.name} is still on the pin behind you.</span>` : '')
    : '<span class="text-green">There\'s a rig at the roadhead with the keys still in it. You climb up, and the diesel catches on the second turn.</span>');
}

// ── haul ──
// The job board: loads to other depots and local docks, seeded per depot per game-day so everyone
// sees the same board and a re-read can't reroll it.
const LOADS = [
  { name: 'a pallet of ration bricks', kg: 900, pay: 260 },
  { name: 'drum stock, sealed', kg: 1800, pay: 420 },
  { name: 'a reefer of protein', kg: 2400, pay: 560 },
  { name: 'machine parts, crated', kg: 1400, pay: 380 },
  { name: 'scrap alloy, baled', kg: 3200, pay: 640 },
  { name: 'medical consumables', kg: 600, pay: 300 },
];
function boardFor(zoneId) {
  // Seeded on (depot, game-day) — stateless, so a restart can't reroll somebody's board mid-run.
  const day = Math.floor(Date.now() / 86400000);
  let h = 2166136261 >>> 0;
  for (const ch of `${zoneId}|${day}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const rng = () => { h = (h + 0x6D2B79F5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  // Local loading docks (`flags.loading_dock`, content-authored) mix in beside the crossings.
  // see docs/systems-trucking.md#city-driving--the-city-as-a-destination
  const here = getZone(zoneId);
  const docks = allDocks().filter(d => d.flags?.region_id === here?.flags?.region_id);
  const dests = [...allDepots().filter(d => d.id !== zoneId), ...docks];
  if (!dests.length) return [];
  // ⚠ One slot is always a crossing if one is possible: docks outnumber depots, and a seeded board
  // could otherwise come up all local and hide the waste run.
  const far = dests.filter(d => d.flags?.region_id !== here?.flags?.region_id);
  // ⚠ And one slot is always a local run (the mirror case). A check on the seeded DRAW flakes by
  // date, because the seed re-rolls at midnight; pin what has to be there instead of rolling for it.
  const near = dests.filter(d => !!dockAt(d));
  const out = [];
  for (let i = 0; i < 4; i++) {
    const l = LOADS[Math.floor(rng() * LOADS.length) % LOADS.length];
    const pool = (i === 0 && far.length) ? far : (i === 1 && near.length) ? near : dests;
    const to = pool[Math.floor(rng() * pool.length) % pool.length];
    // Crossing the waste pays a great deal more; a local run stays the safe, dull bottom rung.
    const crosses = to.flags?.region_id !== getZone(zoneId)?.flags?.region_id;
    const local = !!dockAt(to);
    out.push({ i, name: l.name, kg: l.kg, to: to.id, toName: dockAt(to)?.name || depotAt(to)?.name || to.name,
      pay: Math.round(l.pay * (crosses ? 2.6 : local ? 0.35 : 1)), crosses, local,
      // A dock is named by its street, because a dock is an address.
      where: local ? to.name : null });
  }
  return out;
}
// A depot, to everything but the shop, is its yard: freight boards, delivery checks, the text
// driver's target and the crossing all want a tile a truck can stand on.
// ⚠ An impound pound carries the same flag but is excluded: freight must never go there, and the
// fuel rule (every depot sells diesel) would oblige it to run a pump.
function allDepots() {
  const out = [];
  for (const z of getAllZones()) {
    const d = depotAt(z);
    if (!d || z.flags?.impound_pound) continue;
    const yard = d.yard ? getZone(d.yard) : z;
    if (yard?.grid_x != null && !yard.flags?.is_interior) out.push(yard);
  }
  return out;
}
// A dock is any zone carrying `flags.loading_dock`. Content decides which.
function allDocks() {
  return getAllZones().filter(z => z.flags?.loading_dock && z.grid_x != null);
}
function dockAt(zone) {
  const f = zone?.flags?.loading_dock;
  if (!f) return null;
  return typeof f === 'object' ? f : { name: zone.name };
}

// ── What's being loaded: a mounted rig, or a hitched truck standing in this yard ──
// The depot panel is only on screen on foot (mounting closes it), so the board's verbs must work
// on a parked truck. ⚠ The load lives on the trailer row (rig.cargo is a RAM copy hydrated at
// mount), so writing the box's row IS loading the truck.
async function loadDeck(player) {
  // Behind the wheel stays first: a driver in a rig must never be asked which truck they mean.
  const rig = rigOf(player);
  if (rig) {
    return { mounted: true, rig, trailer: rig.trailer, cargo: rig.cargo, label: rig.type?.name || 'the truck' };
  }
  const { bay, depot } = depotHere(player);
  if (!depot) return { err: say('No yard here.') };
  const parked = await trucksAt(player.id, depotZonesOf(bay, depot));
  if (!parked.length) {
    return { err: say('Nothing of yours is standing here to load.') };
  }
  // Only trucks with a box on are candidates for the disambiguation.
  const withBox = [];
  for (const t of parked) {
    const tr = await trailerOnTruck(t.id);
    if (tr) withBox.push({ truck: t, trailer: tr });
  }
  if (!withBox.length) {
    return { err: say(`Every truck in this yard is bobtail: there's nothing behind one to put it on. <b>${teachVerb('hitch', 'hitch')}</b> a trailer first.`) };
  }
  if (withBox.length > 1) {
    return { err: say('More than one rig here is hitched up. Take the one you mean out yourself: '
      + `<span class="text-dim">${withBox.map(w => `drive ${w.truck.id}`).join(' · ')}</span>`) };
  }
  const { truck, trailer } = withBox[0];
  return { mounted: false, truck, trailer, cargo: trailer.cargo, label: truck.name || truck.type.name };
}

// The one write: the RAM field when mounted, the trailer row when parked.
// ⚠ Re-pushes onto the tab the click came from (`market buy` must stay on the exchange).
async function setDeckCargo(player, deck, cargo, tab = 'freight') {
  if (deck.mounted) {
    deck.rig.cargo = cargo;
    // ⚠ And the box row too: cargo only in RAM would be lost to a restart before parking.
    if (deck.rig.trailer) {
      deck.rig.trailer.cargo = cargo;
      await saveLoad(deck.rig.trailer.id, cargo, deck.rig.trailer.stash);
    }
    pushCab(deck.rig);
    return;
  }
  deck.trailer.cargo = cargo;
  await saveLoad(deck.trailer.id, cargo, deck.trailer.stash);
  await repush(player, tab);
}

async function cmdHaul(args, raw, player) {
  const here = getZone(player.current_zone);
  if (!depotAt(here)) return say('No freight office here. The yards keep the boards.');
  const board = boardFor(here.id);
  if (!board.length) return say('The board is empty. Nowhere to run to from here.');
  const pick = args[0] ? parseInt(args[0], 10) : NaN;
  if (Number.isNaN(pick)) {
    const lines = board.map(b =>
      `  <b>${b.i + 1}.</b> ${b.name}: <b>${b.kg} kg</b> to <b>${b.toName}</b>${b.crosses ? ' <span class="text-amber">(across the waste)</span>' : b.local ? ` <span class="text-dim">(in town, ${b.where})</span>` : ''} · <span class="item-grant">${b.pay}₵</span>`);
    return { type: 'emote', message: `<b>${here.name}: freight board</b>\n${lines.join('\n')}\n<span class="text-dim">haul &lt;number&gt; to take one.</span>` };
  }
  const job = board[pick - 1];
  if (!job) return say('No such load on the board.');
  // A rig you're in, or a hitched truck standing here: see loadDeck.
  const deck = await loadDeck(player);
  if (deck.err) return deck.err;
  if (!deck.trailer) return say(`You're bobtail: there's nothing behind you to put it on. <b>${teachVerb('hitch', 'hitch')}</b> a trailer first.`);
  if (deck.cargo) return say(`Already loaded: ${deck.cargo.name}${deck.cargo.toName ? `, for ${deck.cargo.toName}` : ''}.`);
  // ⚠ The box has to take it. On foot you can hold a contract the trailer can't carry.
  if (deck.trailer.ratedKg && job.kg > deck.trailer.ratedKg) {
    return say(`${job.kg} kg on a box rated for ${deck.trailer.ratedKg}. It won't go on.`);
  }
  await setDeckCargo(player, deck, { ...job });
  return say(`<span class="item-grant">Loaded: ${job.name}. ${job.kg} kg, bound for ${job.toName}. ${job.pay}₵ on delivery.</span>`
    + (deck.mounted ? '' : ` <span class="text-dim">It's on the ${deck.label}, waiting for you to take it out.</span>`));
}

// Paid on arrival at the depot the load names.
async function deliver(player, rig) {
  const job = rig.cargo;
  if (!job) return { type: 'noop' };
  rig.cargo = null;
  rig.speed = 0;
  await adjustCredits(player, job.pay, undefined, 'trucking:delivery');
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  pushCab(rig, { stopped: true });
  sendToPlayer(player.id, {
    type: 'emote',
    message: `<span class="item-grant">Backed onto the dock at ${job.toName}. Somebody signs for ${job.name} without looking up, and <b>${job.pay}₵</b> lands in your account.</span>`,
  });
  return { type: 'noop' };
}

// ── yard ──
// The fleet view. Returned rather than pushed, so there's no race with a player who walked off.
async function cmdYard(args, raw, player) {
  const { bay, depot } = depotHere(player);
  if (!depot) return say('No yard here.');
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'buy') return await yardBuy(player, bay, depot, args[1], args.slice(2).join(' '));
  // One verb sells trucks and trailers; it decides by what the id names.
  if (sub === 'sell') return await yardSell(player, bay, depot, args[1]);
  // Fetching one home is the third thing a yard does with a truck, so it sits with buying and selling.
  if (sub === 'recall' || sub === 'fetch' || sub === 'tow') return await yardRecall(player, bay, args[1]);
  // Painting a box lives on `yard`, not `rig`: `rig` takes a truck, and a trailer is one colour.
  if (sub === 'paint') return await yardPaintTrailer(player, bay, depot, args[1], args[2]);
  // The hire desk (rental.js): the second way to have a truck, beside buying one.
  if (sub === 'rent' || sub === 'hire') return await yardRent(player, bay, depot, args[1]);
  if (sub === 'return' || sub === 'handback') return await yardReturn(player, bay, depot, args[1]);

  return await depotPanel(player, bay, depot, 'fleet', sub === 'text');
}

// ── yard rent: the hire desk ──
// The same licence gate `drive` applies.
async function yardRent(player, bay, depot, typeArg) {
  const key = (typeArg || '').toLowerCase();
  if (!key) {
    const lines = rentStock(player.credits || 0).map((t) => `  <b>${t.name}</b> <span class="text-dim">(${t.id}): ${t.fee}₵ for ${t.hours} hours · ${t.kg} kg of deck</span>`);
    return say(`<span class="text-cyan">THE HIRE LINE: ${depot.name || 'the yard'}</span>\n${lines.join('\n')}\n<span class="text-dim">yard rent &lt;truck&gt;. One at a time, back at any yard, and it goes back on its own when the time is up.</span>`);
  }
  const type = truckType(key) || TRUCK_TYPES.find((t) => t.name.toLowerCase().includes(key));
  if (!type) return say(`Nothing on the hire line called that. <span class="text-dim">${TRUCK_TYPES.map((t) => t.id).join(', ')}</span>`);
  if (!await isLicensedDriver(player, { fleetOf })) return unlicensedLine();
  await sweepRentals(player.id, rigOf(player)?.truckId || null);
  const have = await activeRental(player.id);
  if (have) return say(`You already have the ${have.type.name} out on hire. <span class="text-dim">Hand it back first: ${teachVerb('yard return', 'yard return')}.</span>`);
  const fee = rentFee(type);
  if ((player.credits || 0) < fee) return say(`The ${type.name} is ${fee}₵ for the day and you have ${player.credits || 0}₵.`);
  if (!(await adjustCredits(player, -fee, undefined, 'trucking:rental'))) return say(`That's ${fee}₵ and you have ${player.credits || 0}₵.`);
  const hired = await makeRental(player.id, type.id, bay.id, fee);
  noteFreshVehicle(player.id, hired?.id);
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await repush(player, 'fleet');
  return say(`<span class="item-grant">Hired: the ${type.name}, for ${RENT_TERM_MS / 3600000} hours. ${fee}₵.</span>\n`
    + `<span class="text-dim">It's in the shed with a full tank. Bring it back to any yard; if the time runs out it goes back on its own the next time it stops. ${teachVerb('drive')} when you're ready.</span>`);
}

// ── yard return: handing a hire back early ──
// At any yard (one-way runs must work). No refund: you hired the time, not the miles.
async function yardReturn(player, bay, depot, idArg) {
  const rig = rigOf(player);
  const fleet = await fleetOf(player.id);
  const zonesHere = depotZonesOf(bay, depot);
  const hires = fleet.filter((t) => isRental(t) && (zonesHere.includes(t.depot_zone) || t.id === rig?.truckId));
  const t = idArg ? hires.find((h) => h.id === idArg) : hires[0];
  if (!t) return say("You haven't got a hire truck standing here to hand back.");
  if (rig?.truckId === t.id) return say(`Park it first: ${teachVerb('park')}, then hand the keys over.`);
  await reclaimRental(t.id, player.id);
  await repush(player, 'fleet');
  return say(`<span class="item-grant">You hand the keys for the ${t.type.name} across the counter. The desk checks the fuel gauge, writes something down and does not look up.</span>`);
}

// ── The bench in the cab ──
// The shed a mounted rig is standing in, or null — a city leg, on a facade with a roller door.
export function baySvcFor(rig) {
  if (!rig || rig.leg !== 'city') return null;
  const z = getZone(rig.zoneId);
  if (!z?.flags?.vehicle_bay) return null;
  const ctx = depotFrom(z.id);
  return ctx ? { door: z, ...ctx } : null;
}

/**
 * The depot panel, pushed into the cab as the service overlay. ⚠ The same payload, not a second
 * one: `service` only tells the client where to put it.
 */
export async function pushBayService(player, { spawn = false, tab = 'bench' } = {}) {
  const rig = rigOf(player);
  const ctx = baySvcFor(rig);
  if (!ctx) return;
  const panel = await depotPanel(player, ctx.bay, ctx.depot, tab);
  if (panel && panel.type === 'truck_depot') {
    sendToPlayer(player.id, { ...panel, service: true, spawn, serviceId: rig.truckId });
  }
}

// ⚠ Sync, on the four-times-a-second path. The overlay push fires on a transition and is never
// awaited, so a slow panel build can't hold the drive.
function baySvcTick(player, rig) {
  const inBay = !!baySvcFor(rig);
  if (rig._svc && !inBay) { rig._svc = false; sendToPlayer(player.id, { type: 'truck_service_close' }); return; }
  if (!rig._svc && inBay && Math.abs(rig.speed || 0) < 1) {
    rig._svc = true;
    pushBayService(player).catch(() => {});
  }
}

// The depot the player is at, from either side of the roller door. Every depot verb uses this.
export function depotHere(player) {
  const here = getZone(player.current_zone);
  const direct = depotAt(here);
  if (direct) return { bay: here, depot: direct, yard: getZone(yardIdOf(here, direct)) || here };
  const via = bayForYard(here?.id);
  if (via) return { bay: via.zone, depot: via.depot, yard: here };
  return { bay: here, depot: null, yard: here };
}

// Re-push after every mutation: nothing here may end in a bare `say()` if it changed the world,
// or the panel keeps showing stale cards and credits.
export async function repush(player, tab = 'fleet') {
  // A driver sitting in the shed gets the overlay in the cab, not a yard screen the cab would drop.
  const rig = rigOf(player);
  if (rig && rig._svc && baySvcFor(rig)) return pushBayService(player, { tab });
  const { bay, depot } = depotHere(player);
  if (!depot) return;
  const panel = await depotPanel(player, bay, depot, tab);
  if (panel && panel.type === 'truck_depot') sendToPlayer(player.id, panel);
}

// The bench's bars, derived from effTruckParams (the same object the drive uses), each normalised
// 0..1 against the fleet's spread.
function axesFor(typeId, cd, condition) {
  const p = effTruckParams(typeId, cd, condition, damageOf({ cd, condition }));
  const n = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return {
    pull:  +n(p.thrustMax / p.mass, 1.5, 4.6).toFixed(2),      // grunt per tonne — what drags a full box uphill
    speed: +n(p.topSpeed, 50, 80).toFixed(2),
    stop:  +n(p.brake, 4.0, 9.5).toFixed(2),
    turn:  +n(1 / p.wheelbase, 1.0, 2.4).toFixed(2),
    range: +n(p.tank, 800, 2700).toFixed(2),
  };
}
// The bars with each dial at either end of its range, so the panel can preview a change. Pure.
function tuneEnds(typeId, cd, condition, range) {
  const tune = cd.tune || {};
  return Object.fromEntries(Object.keys(TUNE_PARAMS).map((k) => [k, {
    lo: axesFor(typeId, { ...cd, tune: { ...tune, [k]: -range } }, condition),
    hi: axesFor(typeId, { ...cd, tune: { ...tune, [k]: range } }, condition),
  }]));
}

// ── The depot panel ──
// One screen for the whole yard (fleet, dealer, freight board, exchange). Opens when you walk in,
// like the hangar; the verbs are entry points to the same screen.
async function depotPanel(player, hereIn, depotIn, tab = 'fleet', forceText = false) {
  // Market questions are about the place, so they're answered from whichever tile has coordinates.
  const bay = depotAt(hereIn) ? hereIn : (bayForYard(hereIn?.id)?.zone || hereIn);
  const depot = depotIn || depotAt(bay);
  const yard = getZone(yardIdOf(bay, depot)) || bay;
  const here = yard.grid_x != null ? yard : bay;
  const zonesHere = depotZonesOf(bay, depot);
  // ⚠ Before anything is read: standStock may move a trailer, and trailersOf below must see it.
  await standStock(bay, standPlaces(bay, depot), mountSpot(bay)?.heading ?? 180);
  const region = here.flags?.region_id;
  const day = marketDay();
  // An expired hire is swept before the hand is dealt. Not the one being driven.
  const wentBack = await sweepRentals(player.id, rigOf(player)?.truckId || null);
  if (wentBack.length) {
    sendToPlayer(player.id, { type: 'emote', message: `<span class="text-dim">The hire desk has taken back the ${wentBack.join(' and the ')}: the time ran out.</span>` });
  }
  const mine = await fleetOf(player.id);
  const rig = rigOf(player);
  // Independent reads go out together (read tiers: Promise.all). This opens from a footstep.
  const [fab, myTrailers] = await Promise.all([
    effectiveSkill(player, 'fabrication'),
    trailersOf(player.id),
  ]);
  const towedIds = new Set(myTrailers.filter(t => t.towedBy).map(t => t.towedBy));
  // ── What there is to load (not the same as "are you driving") ──
  // The same answer as loadDeck, from rows already in hand, so the button and the verb agree.
  const hitchedHere = rig?.trailer ? null
    : mine.filter(t => zonesHere.includes(t.depot_zone) && towedIds.has(t.id));
  const panelTrailer = rig?.trailer
    || (hitchedHere?.length === 1 ? myTrailers.find(tr => tr.towedBy === hitchedHere[0].id) : null);
  const canLoad = !!panelTrailer;
  // Why not, in the verb's words: a disabled button that explains itself.
  const loadWhy = canLoad ? null
    : !mine.some(t => zonesHere.includes(t.depot_zone)) ? 'Nothing of yours is standing here'
    : hitchedHere && hitchedHere.length > 1 ? 'More than one rig here is hitched up: take the one you mean out yourself'
    : 'Every truck in this yard is bobtail: hitch a trailer first';
  // ── The pin ──
  // ⚠ Runs the verb's own reach test (hitchReach): a button the verb then refuses is worse than
  // none, so a refusal travels as `why`. No extra round trip.
  const hitchState = (() => {
    if (!rig) return null;                                   // the verb needs a cab under you
    if (rig.trailer) return { verb: 'unhitch', name: rig.trailer.name };
    const standing = myTrailers.filter(t => !t.towedBy && zonesHere.includes(t.parkedZone));
    if (!standing.length) return null;
    // Nearest first, so a refusal describes the box the driver is going for (as cmdHitch does).
    const gap = (t) => (posed(t) ? Math.hypot((rig.x ?? 0) - t.x, (rig.y ?? 0) - t.y) : 99);
    const reach = standing.map(t => ({ t, r: hitchReach(rig, t) })).sort((a, b) => gap(a.t) - gap(b.t));
    const got = reach.find(e => e.r.ok);
    if (got) return { verb: 'hitch', id: got.t.id, name: got.t.name };
    const { t, r } = reach[0];
    return { verb: 'hitch', id: null, name: t.name,
      why: r.why === 'angle' ? `You're across ${t.name}, not under it: straighten up`
        : r.why === 'across' ? `You're alongside ${t.name}, not on its pin: back onto the nose`
        : r.why === 'fast' ? 'Stop the truck first'
        : `Line the truck up on ${t.name} and back under` };
  })();
  // The deck holds the trailer's rating, not the truck's mass: the truck pulls, the box carries.
  // ⚠ Declared after `panelTrailer` (TDZ throw otherwise). If you move either, move both.
  const deckKg = panelTrailer?.ratedKg || rig?.type?.kg || DEFAULT_TRAILER_KG;
  // A depot that keeps diesel keeps it on the apron.
  const pumpHere = pumpAt({ leg: 'city', zoneId: yard.id }) || pumpAt({ leg: 'city', zoneId: bay.id });
  const quotes = quotesFor(region, day);
  await rememberMarket(player, region, day, quotes);
  const seen = await recallMarkets(player);
  const otherEntry = Object.entries(seen).find(([r]) => r !== region);
  const other = otherEntry ? { region: otherEntry[0], ...otherEntry[1] } : null;

  const payload = {
    type: 'truck_depot',
    tab,
    // The truck just bought or hired here, which the counter offers to seat you in (depot-shell readyHtml).
    fresh: forceText ? null : takeFreshVehicle(player.id),
    depot: depot.name || here.name,
    region, regionName: regionLabel(region),
    credits: player.credits || 0,
    here: here.id,
    driving: !!rig,
    // Whether anything here can take a load; the board's buttons gate on this, not `driving`.
    canLoad, loadWhy,
    // Which truck you're in: the pin belongs to the rig under you.
    drivingId: rig?.truckId || null,
    // Which way the pin goes, if it goes at all — see `hitchState` above.
    hitchState,
    fuel: rig ? +rig.fuel.toFixed(2) : null,
    deckKg,
    // The load comes off whichever deck this panel is about: the rig you're in, or the box here.
    cargo: (() => {
      const c = rig?.cargo || (rig ? null : panelTrailer?.cargo);
      // `slot` is the board row this contract came off. ⚠ A board index differs per yard, so the
      // client also matches on name and destination.
      return c ? { kind: c.kind, name: c.name, qty: c.qty || null, slot: c.i ?? null,
        kg: c.kg, to: c.toName || null, paid: c.unitPaid || null } : null;
    })(),
    bay: bay.id, yard: yard.id, yardName: yard.name, inBay: player.current_zone === bay.id,
    // The bunkroom door. ⚠ The direction is measured from where the player stands (the button
    // sends a real move); on the apron it's reported with `here: false` so the chip can explain.
    bunk: (() => {
      const inRoom = bunkFrom(getZone(player.current_zone));
      if (inRoom) return { ...inRoom, here: true };
      const viaBay = bunkFrom(bay);
      return viaBay ? { ...viaBay, here: false } : null;
    })(),
    fab,                                    // the hand doing the work — it sets how far the dials go
    // Static cosmetic catalogues, sent once per payload rather than per truck, so the panel's price
    // is the verb's price.
    fitCat: { slots: SLOTS, items: FIT_IDS.map((id) => ({ id, ...FITTINGS[id] })) },
    cabCat: { slots: CAB_SLOTS, items: TRINKET_IDS.map((id) => ({ id, ...TRINKETS[id] })) },
    fleet: mine.map(t => {
      const cd = t.custom_data || {};
      const kits = installedKits(cd);
      const band = bandOf(t.condition ?? 1);
      const towed = towedIds.has(t.id);
      return {
        id: t.id, name: t.name || t.type.name, type: t.type.name, typeId: t.type_id,
        // The mesh key (+t for a trailer, plus the fittings suffix). A fact about the truck, never
        // decided by the panel.
        variant: `${t.type_id}${towed ? '+t' : ''}${fitSuffix(cd)}`,
        kg: t.type.kg, tank: t.type.tank, top: t.type.topSpeed, price: t.type.price,
        fuel: +(t.fuel ?? 1).toFixed(2), odometer: Math.round(t.odometer || 0),
        hereNow: zonesHere.includes(t.depot_zone),
        whereName: zonesHere.includes(t.depot_zone) ? null : depotNameOf(t.depot_zone),
        // The low-loader's fee home, impound included: the button prints what the verb charges.
        recall: zonesHere.includes(t.depot_zone) ? 0 : towFee(t.type, t.depot_zone, bay.id) + (t.impound_fee || 0),
        resale: resaleValue(t.type, t.odometer, t.condition, damageOf({ cd, condition: t.condition })),
        impound: t.impound_fee || 0,
        // ── the bench half ──
        condition: +(t.condition ?? 1).toFixed(3), band: band.key, bandLabel: band.label, bandText: band.text,
        tune: { gearing: 0, boost: 0, suspension: 0, brakes: 0, ...(cd.tune || {}) },
        // ⚠ Normalised on read, never migrated on write: sanitizePaint fills older rows' missing
        // colours with defaults that reproduce how they've always been drawn.
        kits, paint: paintOf(cd, t.type_id),
        // Trim resolved, not raw: an untrimmed truck stores null and wears its tier's stock interior.
        trim: { ...truckStockTrim(t), ...sanitizeTrimResolved(cd.trim) },
        trimPrice: trimCost(t.type),
        // The live rig's grime wins for the truck being driven: the row is only as fresh as the last park.
        grime: +(rig?.truckId === t.id ? (rig.grime ?? 0) : grimeOf(cd)).toFixed(3),
        grimeBand: grimeBand(rig?.truckId === t.id ? (rig.grime ?? 0) : grimeOf(cd)).key,
        grimeLabel: grimeBand(rig?.truckId === t.id ? (rig.grime ?? 0) : grimeOf(cd)).label,
        grimeText: grimeBand(rig?.truckId === t.id ? (rig.grime ?? 0) : grimeOf(cd)).line,
        washPrice: washCost(rig?.truckId === t.id ? (rig.grime ?? 0) : grimeOf(cd)),
        // Prices through priceFor, so a fitting already in the drawer shows free, as the verb charges.
        fits: installedFits(cd),
        fitPrices: Object.fromEntries(FIT_IDS.map((id) => [id, priceFor(cd, id)])),
        // Same for the cab trinkets, through trinketPrice.
        cab: installedTrinkets(cd),
        cabPrices: Object.fromEntries(TRINKET_IDS.map((id) => [id, trinketPrice(cd, id)])),
        repairField: repairCost(t.type, t.condition ?? 1, false),
        repairShop: repairCost(t.type, t.condition ?? 1, true),
        canField: (t.condition ?? 1) < FIELD_CAP,
        // ⚠ The price of the paint in front of you, not the paint on the truck (finish moves the fee;
        // see paintCost). paintBase lets the panel re-quote while a dial turns.
        paintPrice: paintCost(t.type, paintOf(cd, t.type_id)),
        paintBase: paintCost(t.type, { finish: 'gloss' }),
        refuel: Math.round((1 - (t.fuel ?? 1)) * FUEL_FULL),
        // Derived through the same function the drive uses.
        stats: axesFor(t.type_id, cd, t.condition ?? 1),
        // And with each unfitted kit, and each dial at either end. A hire takes neither.
        kitStats: isRental(t) ? null : Object.fromEntries(Object.keys(KITS).filter((k) => !kits.includes(k))
          .map((k) => [k, axesFor(t.type_id, { ...cd, kits: [...kits, k] }, t.condition ?? 1)])),
        tuneEnds: isRental(t) ? null : tuneEnds(t.type_id, cd, t.condition ?? 1, tuneRange(fab, [])),
        // ── the card half ──
        // A hire and its time left, as facts; the client works out no term.
        rental: isRental(t) ? { left: rentalLeft(t), leftText: fmtLeft(rentalLeft(t)), fee: t.custom_data.rental.fee } : null,
        driving: rig?.truckId === t.id,
        // ── the service half ── against the live rig's odometer when it's the one under you.
        svc: serviceSheet(t.type, cd, (t.odometer || 0) + (rig?.truckId === t.id ? (rig.travelled || 0) : 0)),
        horn: hornOf(cd) || 'stock',
        hornPrices: Object.fromEntries(hornCatalogue().map((h) => [h.id, hornPrice(cd, h.id)])),
      };
    }),
    // The hire line. See rental.js.
    rentStock: rentStock(player.credits || 0),
    hasRental: mine.some((t) => isRental(t)),
    hornCat: hornCatalogue(),
    stock: TRUCK_TYPES.map(t => ({
      id: t.id, name: t.name, tier: t.tier, price: t.price, blurb: t.blurb,
      variant: t.id, kg: t.kg, tank: t.tank, top: t.topSpeed,
      stats: axesFor(t.id, {}, 1),
      afford: (player.credits || 0) >= t.price,
    })),
    trailerStock: TRAILER_TYPES.map(t => ({
      id: t.id, name: t.name, price: t.price, rated: t.rated, kg: t.kg,
      afford: (player.credits || 0) >= t.price,
    })),
    // ── The boxes you own ──
    // A trailer is an owned vehicle like a truck: what it is, where it is, what's on it.
    // `where` is resolved here because depot names live in zone flags.
    trailers: myTrailers.map(t => ({
      id: t.id, name: t.name, kg: t.kg, ratedKg: t.ratedKg,
      // The same three condition fields a truck row carries, so the client keeps no copy of BANDS.
      ...(() => { const b = bandOf(t.condition ?? 1);
        return { condition: +(t.condition ?? 1).toFixed(3), band: b.key, bandLabel: b.label, bandText: b.text }; })(),
      towedBy: t.towedBy || null,
      hereNow: !t.towedBy && zonesHere.includes(t.parkedZone),
      // ⚠ Sellable differs from `hereNow`: a box on your own pin in this yard can be sold too
      // (the sale performs the same drop as `unhitch`).
      canSell: !t.cargo && !t.stash
        && ((!t.towedBy && zonesHere.includes(t.parkedZone))
          || (t.towedBy && t.towedBy === rig?.truckId && !rig?.cargo
            && (zonesHere.includes(rig?.zoneId) || zonesHere.includes(rig?.fromDepot)))),
      where: t.towedBy ? 'hitched' : (zonesHere.includes(t.parkedZone) ? 'here' : depotNameOf(t.parkedZone)),
      cargo: t.cargo ? { name: t.cargo.name, kg: t.cargo.kg } : null,
      // ⚠ Carrying anything at all, stash included, without saying what. Without it Sell is offered
      // on a loaded box and then refused.
      loaded: !!(t.cargo || t.stash),
      // One colour, because a box is one colour: see boxLivery.
      colour: boxColour(t),
      // Resale as a fact: the button prints what the verb pays.
      resale: trailerResale(t),
    })),
    // The bench's catalogues: the client renders the dials it is told about and invents none.
    tuneParams: Object.entries(TUNE_PARAMS).map(([id, p]) => ({ id, label: p.label, lo: p.lo, hi: p.hi, desc: p.desc })),
    tuneRange: tuneRange(fab, []),
    kitCatalog: Object.entries(KITS).map(([id, k]) => ({ id, ...k, afford: (player.credits || 0) >= k.price })),
    flashes: FLASHES, finishes: FINISHES, arts: ARTS, paintPresets: PAINT_PRESETS, paintDefault: PAINT_DEFAULT,
    // Each type's factory paint, so the hire line draws trucks in their own colours.
    paintFactory: Object.fromEntries(TRUCK_TYPES.map(t => [t.id, factoryPaint(t.id)])),
    // ── The interior catalogue ──
    // Rows carry real swatch colours (from client/shared/cab-trim.js) so the trim tab's preview
    // matches what the renderer draws.
    dashMaterials: Object.entries(DASH_MATERIALS).map(([id, m]) => ({ id, label: m.label, blurb: m.blurb, gloss: m.gloss })),
    dashColourways: Object.entries(DASH_COLOURWAYS).map(([id, c]) => ({
      id, label: c.label, stock: !!c.stock,
      dash: c.dash, hdr: c.hdr, face: c.face, needle: c.needle, glow: c.glow, ring: c.ring, lip: c.lip,
    })),
    // ⚠ No 'dashCustom' row, deliberately: a mixed interior is a derivation the client previews live
    // with customColourway from client/shared/cab-trim.js, the one copy of it.
    finishMul: Object.fromEntries(FINISHES.map(f => [f.id, +(paintCost({ price: 100000 }, f) / paintCost({ price: 100000 }, { finish: 'gloss' })).toFixed(3)])),
    fuelHere: pumpHere,
    board: boardFor(here.id),
    quotes: quotes.map((q) => {
      const oq = other?.q?.[q.key];
      return { ...q, thereBid: oq?.bid ?? null, thereAge: oq ? day - (other.day || day) : null,
        canAfford: Math.floor((player.credits || 0) / q.ask), holds: capacityFor(q.key, deckKg) };
    }),
    thereName: other ? regionLabel(other.region) : null,
  };
  // `yard text` / `market text` forces the written depot at any rung.
  if (forceText) return say(textDepot(payload));
  if (await prefersLoggedPanelsOrDefault(player)) return depotDialogPayload(payload);
  return payload;
}

/**
 * The depot as a list-dialog payload (client/game/js/panels/listdialog.js). Reads the same payload
 * textDepot does, and every command is a real verb.
 */
function depotDialogPayload(p) {
  const rows = [];
  for (const t of p.fleet || []) {
    const cmds = t.rental ? [{ label: 'Hand it back', command: `yard return ${t.id}` }]
      : [{ label: `Sell (${t.resale}₵)`, command: `yard sell ${t.id}` }];
    if (t.hereNow) cmds.unshift({ label: 'Climb in', command: `drive ${t.id}` });
    if (!t.hereNow) cmds.unshift({ label: `Tow home (${t.recall}₵)`, command: `yard recall ${t.id}` });
    rows.push({
      group: 'Your fleet',
      label: `${t.name} (${t.type})${t.rental ? ` · HIRED, ${t.rental.leftText}` : ''}`,
      detail: `${t.kg}kg · fuel ${Math.round(t.fuel * 100)}% · ${t.odometer} tiles · ${t.hereNow ? 'here' : `at ${t.whereName}`}`,
      commands: cmds,
    });
  }
  if (!(p.fleet || []).length) rows.push({ group: 'Your fleet', label: 'You own nothing with wheels on it.' });

  for (const t of p.rentStock || []) {
    rows.push({
      group: 'For hire',
      label: t.name,
      detail: `${t.fee}₵ for ${t.hours} hours · ${t.kg}kg · ${t.top}mph${p.hasRental ? ' · one out already' : t.afford ? '' : " · can't afford"}`,
      commands: t.afford && !p.hasRental ? [{ label: 'Hire', command: `yard rent ${t.id}` }] : [],
    });
  }

  for (const t of p.stock || []) {
    rows.push({
      group: 'For sale',
      label: t.name,
      detail: `${t.price}₵ · ${t.kg}kg · ${t.tank} tiles a tank · ${t.top}mph${t.afford ? '' : " · can't afford"}`,
      commands: t.afford ? [{ label: 'Buy', command: `yard buy ${t.id}` }] : [],
    });
  }
  // A loaded deck takes the Haul button off the row, as it dims it on the panel.
  const deckFull = !!p.cargo;
  for (const b of p.board || []) {
    const mine = deckFull && p.cargo.slot === b.i && p.cargo.name === b.name && p.cargo.to === b.toName;
    rows.push({
      group: 'Freight board',
      label: b.name,
      detail: `${b.kg}kg to ${b.toName} · ${b.pay}₵${b.crosses ? ' · across the waste' : b.local ? ` · in town, ${b.where}` : ''}`
        + (mine ? ' · ON YOUR DECK' : deckFull ? ' · deck full' : ''),
      commands: deckFull ? [] : [{ label: 'Haul', command: `haul ${b.i + 1}` }],
    });
  }
  if (!(p.board || []).length) rows.push({ group: 'Freight board', label: 'Nothing on the board today.' });

  for (const q of p.quotes || []) {
    const there = q.thereBid == null ? '' : ` · ${q.thereBid}₵ in ${p.thereName}`;
    rows.push({
      group: 'Exchange',
      label: q.name,
      detail: `buy ${q.ask}₵ · sell ${q.bid}₵ · ${q.kg}kg${there}${deckFull ? ' · deck full' : ''}`,
      // Buy goes with a full deck; Sell stays, because Sell is what you do about one.
      commands: [...(deckFull ? [] : [{ label: 'Buy', command: `market buy ${q.name}` }]),
        { label: 'Sell', command: `market sell ${q.name}` }],
    });
  }

  const hold = p.cargo
    ? (p.cargo.kind === 'goods'
        ? `On the deck: ${p.cargo.qty} × ${p.cargo.name} (${p.cargo.kg}kg), cost ${p.cargo.paid}₵/unit`
        : `On the deck: ${p.cargo.name}, contracted to ${p.cargo.to}`)
    : null;
  return {
    type: 'list_dialog',
    title: `${p.depot}: yard`,
    subtitle: `${p.credits}₵`,
    rows,
    footer: [hold, 'yard text to read it in the log'].filter(Boolean).join(' · '),
  };
}

// The log rung reads the identical facts as prose. The panel is a skin; this is the record.
function textDepot(p) {
  return `${textYard(p)}\n\n${textBoardAndMarket(p)}`;
}
function depotNameOf(zoneId) {
  const z = zoneId && getZone(zoneId);
  return z ? (depotAt(z)?.name || z.name) : 'somewhere else';
}
function textYard(p) {
  const fleet = p.fleet.length
    ? p.fleet.map(t => `  <b>${t.name}</b> (${t.type})${t.rental ? ` · <span class="text-cyan">HIRED, ${t.rental.leftText}</span>` : ''} · ${t.kg} kg deck · fuel ${Math.round(t.fuel * 100)}% · ${t.odometer} tiles`
        + `${t.hereNow ? ' · <span class="text-green">here</span>' : ` · <span class="text-dim">at ${t.whereName}</span>`}`
        + `${t.hereNow ? ` · <span class="text-dim">take it out (drive ${t.id})</span>` : ''}`
        + `${t.hereNow ? '' : ` · <span class="text-dim">tow it home for ${t.recall}₵ (yard recall ${t.id})</span>`}`
        + (t.rental ? ` · <span class="text-dim">hand it back (yard return ${t.id})</span>` : ` · <span class="text-dim">sells for ${t.resale}₵ (yard sell ${t.id})</span>`)).join('\n')
    : '  <span class="text-dim">You own nothing with wheels on it.</span>';
  const stock = p.stock.map(t =>
    `  <b>${t.name}</b>: <span class="item-grant">${t.price}₵</span> · ${t.kg} kg deck · ${t.tank} tiles a tank · ${t.top} mph`
    + `${t.afford ? '' : ' <span class="text-dim">(can\'t afford)</span>'}\n    <span class="text-dim">${t.blurb}</span>`
    + `\n    <span class="text-dim">yard buy ${t.id}</span>`).join('\n');
  // The boxes, on the record: the log rung's copy of the panel's trailer list.
  const boxes = (p.trailers || []).length
    ? p.trailers.map(t => `  <b>${t.name}</b> · ${t.ratedKg} kg rated`
        + `${t.towedBy ? ' · <span class="text-dim">on the pin</span>'
            : t.hereNow ? ' · <span class="text-green">standing here</span>' : ` · <span class="text-dim">at ${t.where}</span>`}`
        + `${t.cargo ? ` · <span class="text-dim">loaded: ${t.cargo.name}</span>` : ''}`
        + `${t.hereNow ? ' · <span class="text-dim">back under it (hitch)</span>' : ''}`).join('\n')
    : null;
  return `<b>${p.depot}: yard</b>  <span class="text-dim">(${p.credits}₵)</span>\n\n<b>YOUR FLEET</b>\n${fleet}`
    + (boxes ? `\n\n<b>YOUR BOXES</b>\n${boxes}` : '')
    + `\n\n<b>FOR SALE</b>\n${stock}`
    + `\n\n<b>FOR HIRE</b>${p.hasRental ? ' <span class="text-dim">(one out already)</span>' : ''}\n`
    + (p.rentStock || []).map(t => `  <b>${t.name}</b>: <span class="item-grant">${t.fee}₵</span> for ${t.hours} hours · ${t.kg} kg deck <span class="text-dim">(yard rent ${t.id})</span>`).join('\n');
}

async function yardBuy(player, here, depot, typeId, plate) {
  const key = (typeId || '').toLowerCase();
  // Trailers are bought on the same line.
  const trl = trailerType(key);
  if (trl) return yardBuyTrailer(player, here, depot, trl);
  const type = truckType(key);
  if (!type) {
    return say(`No such truck. <span class="text-dim">trucks: ${TRUCK_TYPES.map(t => t.id).join(', ')} · trailers: ${TRAILER_TYPES.map(t => t.id).join(', ')}</span>`);
  }
  if ((player.credits || 0) < type.price) {
    return say(`The ${type.name} is ${type.price}₵ and you have ${player.credits || 0}₵.`);
  }
  // A yard holds as many of yours as you can pay for; pickParked settles the ambiguity.
  if (!(await adjustCredits(player, -type.price, undefined, 'trucking:buy-truck'))) return say(`That's ${type.price}₵ and you have ${player.credits || 0}₵.`);
  // Bought into the bay, not onto the street; `drive` brings it out.
  const bought = await buyTruck(player.id, key, here.id, plate);
  noteFreshVehicle(player.id, bought?.id);
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await repush(player, 'fleet');
  return say(`<span class="item-grant">Bought: the ${type.name}${plate ? `, "${plate}"` : ''}. ${type.price}₵.</span>\n`
    + `<span class="text-dim">${type.kg} kg of deck and ${type.tank} tiles to a tank. ${teachVerb('drive')} when you're ready.</span>`);
}

// A trailer is bought standing in the yard, not attached, which teaches `hitch`.
// ⚠ It stands outside on the hardstand at a pose: an unposed box in the bay can't be drawn
// (trailersNear draws only posed rows) yet `hitch` would couple to it from across the yard.
async function yardBuyTrailer(player, here, depot, t) {
  if ((player.credits || 0) < t.price) return say(`${cap(t.name)} is ${t.price}₵ and you have ${player.credits || 0}₵.`);
  // Posed on the hardstand facing out of the shed; one-tile depots and fixtures fall back to unposed.
  // ⚠ The first free bay, never the Nth counted: after a sale, index N lands on an existing box.
  const places = standPlaces(here, depot);
  const standing = [];
  for (const pl of places) for (const t of await trailersAt(pl.zone.id)) if (posed(t)) standing.push({ x: t.x, y: t.y });
  const pose = places.length ? findStockPose(places, mountSpot(here)?.heading ?? 180, standing) : null;
  const outside = pose ? getZone(pose.zoneId) : null;
  // ⚠ Sprayed once, at purchase, to match the truck you keep here. Never read live off the tractor:
  // the colour belongs to the box. Repainting is `yard paint`.
  const mine = await trucksAt(player.id, depotZonesOf(here, depot));
  const stamp = paintOf(mine[0]?.custom_data, mine[0]?.type_id).base;
  if (!(await adjustCredits(player, -t.price, undefined, 'trucking:buy-trailer'))) return say(`That's ${t.price}₵ and you have ${player.credits || 0}₵.`);
  await buyTrailer(player.id, t.id, outside?.id || here.id, pose, stamp);
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  // Refresh now so a driver already in the cab sees it next frame.
  if (outside) await refreshStanding(outside.id);
  await repush(player, 'buy');
  return say(`<span class="item-grant">Bought: ${t.name}. ${t.price}₵.</span>\n`
    + `<span class="text-dim">${t.rated} kg rated, ${t.kg} kg empty. ${outside
      ? `A yard hand walks it out and drops the legs on the hardstand, nose to the road: ${teachVerb('hitch')} once you have backed under it.`
      : `It's standing in the yard: ${teachVerb('hitch')} to back under it.`}</span>`);
}

// Selling a box: priced by trailerResale, refused while loaded, and it has to be here.
async function yardSellTrailer(player, here, depot, id) {
  const zones = hitchZones(here?.id);
  let box = null;
  for (const z of zones) for (const t of await trailersAt(z)) if (t.id === id && t.ownerId === player.id) box = t;
  // ⚠ Or the one on your own pin: a towed box has no parked_zone, so trailersAt can't find it.
  const rig = rigOf(player);
  const towed = !box && rig?.trailer && rig.trailer.id === id && rig.trailer.ownerId === player.id
    && (zones.includes(rig.zoneId) || zones.includes(rig.fromDepot)) ? rig.trailer : null;
  if (towed && rig.cargo) return say(`There's still a load on it. <span class="text-dim">Deliver or dump it before you sell the ${towed.name}.</span>`);
  box = box || towed;
  if (!box) return say("That isn't yours, or it isn't standing in this yard.");
  if (box.cargo || box.stash) return say(`There's still a load on it. <span class="text-dim">Empty the ${box.name} first.</span>`);
  const value = trailerResale(box);
  // Unhook first, so no live rig is left towing a deleted trailer.
  if (towed) {
    await dropTrailer(box.id, here?.id || rig.zoneId, null);
    rig.trailer = null;
  }
  if (!await sellTrailer(box.id, player.id)) return say('Somebody is towing it.');
  await adjustCredits(player, value, undefined, 'trucking:sell-trailer');
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await Promise.all(zones.map(z => refreshStanding(z)));   // it stops being on the glass now, not on the next arrival
  await repush(player, 'fleet');
  return say(`<span class="item-grant">Sold ${box.name} for ${value}₵.</span> <span class="text-dim">${towed ? 'They pull the pin, walk it off your fifth wheel and drag it round the back.' : 'A yard hand hooks it up and drags it round the back.'}</span>`);
}

// ── yard paint ──
// A box, one colour, flat fee (not `rig paint`, which takes eight surfaces).
// ⚠ The box has to be here, as with `hitch`.
const BOX_PAINT_FEE = 340;
async function yardPaintTrailer(player, bay, depot, want, colour) {
  const here = getZone(yardIdOf(bay, depot)) || bay;
  const zones = hitchZones(bay?.id || here.id);
  const mine = [];
  for (const z of zones) for (const t of await trailersAt(z)) if (t.ownerId === player.id) mine.push(t);
  if (!mine.length) return say('You have no box standing in this yard.');
  const w = String(want || '').toLowerCase();
  const box = w ? (mine.find(t => t.id.toLowerCase() === w) || mine.find(t => (t.name || '').toLowerCase().includes(w))) : (mine.length === 1 ? mine[0] : null);
  if (!box) {
    return say(`Which box? ` + mine.map(t => `<span class="action-link" data-action="cmd" data-cmd="yard paint ${t.id} ${colour || ''}">${t.name}</span>`).join(', '));
  }
  const c = String(colour || '').trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(c)) return say(`A colour, like <span class="text-dim">#8e0f18</span>. <span class="text-dim">yard paint ${box.id} #8e0f18</span>`);
  if ((player.credits || 0) < BOX_PAINT_FEE) return say(`Painting a box is ${BOX_PAINT_FEE}₵ and you have ${player.credits || 0}₵.`);
  if (!await paintTrailer(box.id, player.id, c)) return say("That box isn't yours to paint.");
  if (!(await adjustCredits(player, -BOX_PAINT_FEE, undefined, 'trucking:box-paint'))) return say(`That's ${BOX_PAINT_FEE}₵ and you have ${player.credits || 0}₵.`);
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  // Refresh now, as yardBuyTrailer does.
  await Promise.all(zones.map(z => refreshStanding(z)));
  await repush(player, 'fleet');
  return say(`<span class="item-grant">Painted: ${BOX_PAINT_FEE}₵.</span> <span class="text-dim">${box.name}, and the overspray is on the concrete for a week.</span>`);
}

// ── Recovery: getting a truck home you didn't drive home ──
// The fee is a call-out plus a rate per tile of straight line, scaled by what the truck is worth;
// deliberately worse than driving. An impound fee rides on the same bill, and recoverTruckTo clears
// it in the same guarded statement, so a double click can't pay for two tows.
const TOW_CALLOUT = 200;
const TOW_PER_TILE = 2.2;
// ⚠ A recovery never costs more than this fraction of the truck: a correctness cap against a bad
// coordinate in content (a bay at grid 0,0 once billed 10,038₵ for a 1,300₵ truck).
const TOW_MAX_FRAC = 0.40;

// Where a zone is, for a low-loader. A depot bay is an interior with no coordinates, so ask it for
// its yard. Null when there's no answer (a transient waste node); the caller bills a nominal run.
function towGrid(zoneId) {
  const z = getZone(zoneId);
  if (!z) return null;
  const yard = depotAt(z)?.yard ? getZone(depotAt(z).yard) : null;
  for (const cand of [z, yard]) {
    // 0,0 is not a place: it's an interior's unset column (the mapped world starts at grid_x 726).
    if (cand && cand.grid_x != null && cand.grid_y != null && !(cand.grid_x === 0 && cand.grid_y === 0)) {
      return { x: cand.grid_x, y: cand.grid_y };
    }
  }
  return null;
}

function towFee(type, fromZoneId, toZoneId) {
  const a = towGrid(fromZoneId), b = towGrid(toZoneId);
  const tiles = (a && b) ? Math.hypot(a.x - b.x, a.y - b.y)
    : 40;                                             // unknown ground (a transient waste node) — bill a nominal call-out run
  // The divisor tracks the top of the fleet's price ladder; the term is the spread across it.
  const heft = 0.6 + 0.4 * Math.min(2, (type?.price || 6000) / 5000);
  const fee = Math.round((TOW_CALLOUT + tiles * TOW_PER_TILE) * heft);
  return Math.max(1, Math.min(fee, Math.round((type?.price || 6000) * TOW_MAX_FRAC)));
}

async function yardRecall(player, here, id) {
  if (!id) return say('Fetch which? <span class="text-dim">yard recall &lt;id&gt;</span>');
  const t = await getTruck(id, player.id);
  if (!t) return say("That isn't yours.");
  const zonesHere = depotZonesOf(here, depotAt(here));
  if (zonesHere.includes(t.depot_zone)) return say(`The ${t.type.name} is already standing here.`);
  if (rigOf(player)?.truckId === t.id) return say("You're sitting in it.");
  const fee = towFee(t.type, t.depot_zone, here.id) + (t.impound_fee || 0);
  if ((player.credits || 0) < fee) {
    return say(`Recovery from ${depotNameOf(t.depot_zone)} is <b>${fee}₵</b>${t.impound_fee ? ` (${t.impound_fee}₵ of that is the lot's)` : ''}. `
      + `<span class="text-dim">You have ${player.credits || 0}₵.</span>`);
  }
  const moved = await recoverTruckTo(t.id, player.id, t.depot_zone, here.id);
  if (!moved) return say('Somebody has already moved it.');
  await adjustCredits(player, -fee, undefined, 'trucking:recover');
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await repush(player, 'fleet');
  return say(`<span class="text-green">A low-loader goes out for it.</span> <span class="text-dim">Some hours later the ${t.type.name} comes off the ramps `
    + `into the yard, filthy, with a chain mark on the bumper nobody wants to talk about.</span> <span class="item-loss">-${fee}₵</span>`);
}

async function yardSell(player, here, depot, id) {
  if (!id) return say('Sell which? <span class="text-dim">yard sell &lt;id&gt;</span>');
  const t = await getTruck(id, player.id);
  // Not a truck of yours: try the boxes here. Ids are exact, so this can't misfire.
  if (!t) return await yardSellTrailer(player, here, depot, id);
  if (!depotZonesOf(here, depotAt(here)).includes(t.depot_zone)) return say(`It's parked at ${depotNameOf(t.depot_zone)}. Bring it here first.`);
  if (rigOf(player)?.truckId === t.id) return say("You're sitting in it.");
  if (isRental(t)) return say(`It's a hire truck: it isn't yours to sell. ${teachVerb('yard return', 'yard return')} hands it back.`);
  // The bodywork is in the price: see resaleValue.
  const value = resaleValue(t.type, t.odometer, t.condition, damageOf({ condition: t.condition, custom_data: t.custom_data }));
  // ⚠ The box comes off the pin before the tractor is deleted. towed_by has no foreign key, so a box
  // left on a sold truck is unreachable (no parked_zone, and every hitch/sell path refuses it).
  // Same drop as `unhitch`; a null pose lets standStock place it later, and the load stays on.
  const onPin = await trailerOnTruck(t.id);
  if (onPin) await dropTrailer(onPin.id, t.depot_zone, null);
  await sellTruck(t.id, player.id);
  await adjustCredits(player, value, undefined, 'trucking:sell-truck');
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  // Refresh now, as the trailer sale does.
  if (onPin) await Promise.all(hitchZones(here?.id).map(z => refreshStanding(z)));
  await repush(player, 'fleet');
  return say(`<span class="item-grant">Sold the ${t.type.name} for ${value}₵.</span> <span class="text-dim">Somebody drives it away without looking back at you.</span>`
    + (onPin ? ` <span class="text-dim">They pull the pin first and leave ${onPin.name} standing on its legs in the yard.</span>` : ''));
}

// ── rig: the bench lives in bench.js ──

// ── market ──
// Your own capital on your own guess (`haul` is wages). Buy/sell are subcommands because the
// vendor and storefront plugins own `buy`/`sell`.
async function cmdMarket(args, raw, player) {
  const rig = rigOf(player);
  const here = getZone(rig?.zoneId || player.current_zone);
  const depot = depotAt(here);
  if (!depot) return say('No exchange here. The yards keep the boards.');
  const region = here.flags?.region_id;
  const sub = (args[0] || '').toLowerCase();

  if (sub === 'buy') return await marketBuy(player, rig, here, region, args[1], args[2]);
  if (sub === 'sell') return await marketSell(player, rig, here, region);

  // The panel axis: a price list is only read, so this is prefersLoggedPanels. Both verbs land on
  // the same depot panel.
  return await depotPanel(player, here, depot, 'market', (args?.[0] || '').toLowerCase() === 'text');
}

// The board and the exchange, as prose: the log rung's half of the same facts.
function textBoardAndMarket(p) {
  const rows = p.quotes.map((q) => {
    const gain = q.thereBid == null ? null : q.thereBid - q.ask;
    let hint = '';
    if (q.thereBid != null) {
      hint = gain > 0 ? ` <span class="item-grant">→ ${q.thereBid}₵ in ${p.thereName} (+${gain}/unit)</span>`
                      : ` <span class="text-dim">→ ${q.thereBid}₵ in ${p.thereName}</span>`;
      if (q.thereAge) hint += ` <span class="text-dim">(${q.thereAge}d old)</span>`;
    }
    return `  ${q.name.padEnd(18)} <b>${String(q.ask).padStart(4)}₵</b> buy · <b>${String(q.bid).padStart(4)}₵</b> sell · ${String(q.kg).padStart(3)}kg${hint}`;
  });
  const board = p.board.length
    ? p.board.map(b => `  <b>${b.i + 1}.</b> ${b.name}: <b>${b.kg} kg</b> to <b>${b.toName}</b>${b.crosses ? ' <span class="text-amber">(across the waste)</span>' : b.local ? ` <span class="text-dim">(in town, ${b.where})</span>` : ''} · <span class="item-grant">${b.pay}₵</span>`).join('\n')
    : '  <span class="text-dim">Nothing on the board today.</span>';
  const hold = p.cargo
    ? (p.cargo.kind === 'goods'
        ? `\n<span class="text-amber">On the deck: ${p.cargo.qty} × ${p.cargo.name} (${p.cargo.kg} kg), cost ${p.cargo.paid}₵/unit.</span>`
        : `\n<span class="text-dim">On the deck: ${p.cargo.name}, contracted to ${p.cargo.to}.</span>`)
    : '';
  return `<b>FREIGHT BOARD</b>\n${board}\n\n<b>EXCHANGE</b>\n${rows.join('\n')}${hold}\n`
    + '<span class="text-dim">haul &lt;n&gt; · market buy &lt;good&gt; [qty|full] · market sell · yard buy &lt;type&gt;</span>';
}

const REGION_LABEL = { region_coldwater: 'Coldwater', region_the_reach: 'The Reach', region_deadwater: 'Deadwater' };
const regionLabel = (r) => REGION_LABEL[r] || (r || '').replace(/^region_/, '').replace(/_/g, ' ');

async function marketBuy(player, rig, here, region, good, qtyArg) {
  // Same resolve as the freight board: see loadDeck.
  const deck = await loadDeck(player);
  if (deck.err) return deck.err;
  if (!deck.trailer) return say(`Nowhere to put it: you're bobtail. <b>${teachVerb('hitch', 'hitch')}</b> a trailer first.`);
  if (deck.cargo) return say(`The deck is full: ${deck.cargo.name}.`);
  // Never match on an empty argument: a bare `market buy` must ask what.
  const named = (good || '').toLowerCase().trim();
  if (!named) return say('Buy what? <span class="text-dim">market buy &lt;good&gt; [qty|full]</span>');
  const key = Object.keys(COMMODITIES).find(k => k === named || COMMODITIES[k].name.includes(named));
  if (!key) return say(`Nobody here trades "${good}".`);
  const c = COMMODITIES[key];
  const day = marketDay();
  const unit = askPrice(key, region, day);
  // Two ceilings, the tighter wins: what the trailer holds and what you can pay for.
  const byMoney = Math.floor((player.credits || 0) / unit);
  // The deck's capacity is the resolved trailer's rating, not the truck's mass and not the mounted rig.
  const deckKg = deck.trailer?.ratedKg || deck.rig?.type?.kg || deck.truck?.type?.kg || DEFAULT_TRAILER_KG;
  const max = Math.min(capacityFor(key, deckKg), byMoney);
  if (max < 1) return say(`${c.name} is ${unit}₵ a unit and you have ${player.credits || 0}₵.`);
  const asked = /^full$/i.test(qtyArg || '') || !qtyArg ? max : Math.max(1, parseInt(qtyArg, 10) || 0);
  const qty = Math.min(asked, max);
  if (asked > max) {
    return say(qty === byMoney
      ? `You can afford ${byMoney} at ${unit}₵. <span class="text-dim">market buy ${key} ${byMoney}</span>`
      : `The trailer takes ${capacityFor(key, deckKg)} of those. <span class="text-dim">market buy ${key} full</span>`);
  }
  const cost = qty * unit;
  if (!(await adjustCredits(player, -cost, undefined, 'trucking:market-buy'))) return say(`That's ${cost}₵ and you have ${player.credits || 0}₵.`);
  await setDeckCargo(player, deck, { kind: 'goods', key, name: c.name, qty, kg: qty * c.kg, unitPaid: unit }, 'market');
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  return say(`<span class="item-grant">Loaded ${qty} × ${c.name} at ${unit}₵: <b>${cost}₵</b> gone. ${qty * c.kg} kg on the deck.</span>`);
}

async function marketSell(player, rig, here, region) {
  const deck = await loadDeck(player);
  if (deck.err) return deck.err;
  if (!deck.cargo) return say('Nothing on the deck.');
  if (deck.cargo.kind !== 'goods') return say(`That load is contracted to ${deck.cargo.toName}: it isn't yours to sell.`);
  const day = marketDay();
  const unit = bidPrice(deck.cargo.key, region, day);
  const take = deck.cargo.qty * unit;
  const spent = deck.cargo.qty * deck.cargo.unitPaid;
  const profit = take - spent;
  await adjustCredits(player, take, undefined, 'trucking:market-sell');
  const sold = deck.cargo;
  await setDeckCargo(player, deck, null, 'market');
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  const verdict = profit > 0
    ? `<span class="item-grant">Cleared <b>${profit}₵</b> on the run.</span>`
    : profit === 0 ? '<span class="text-dim">You broke exactly even. All that road for nothing.</span>'
    : `<span class="text-amber">You are <b>${-profit}₵</b> down. Somebody got there first, or you did.</span>`;
  return say(`Sold ${sold.qty} × ${sold.name} at ${unit}₵: ${take}₵ in. ${verdict}`);
}

// Remembered boards, one player_flag. Written only when you read a market, never on a tick.
async function rememberMarket(player, region, day, quotes) {
  if (!region) return;
  const seen = await recallMarkets(player);
  seen[region] = { day, q: Object.fromEntries(quotes.map(q => [q.key, { ask: q.ask, bid: q.bid }])) };
  await setFlag('player', 'truck_markets', JSON.stringify(seen), player).catch(() => {});
}
async function recallMarkets(player) {
  try { return JSON.parse((await getFlag('player', 'truck_markets', player)) || '{}'); } catch { return {}; }
}

// ── refuel ──
// ⚠ `fuel` is also what you say to a boat, and this plugin owns the word (a plugin verb silently
// beats others). The boat answer is dispatched by name (BOAT_FUEL) so neither plugin imports the
// other. ⚠ A null means "not about boats", which is what makes it safe to ask first.
async function tryBoatFuel(player, want) {
  const r = await dispatchAction({ type: 'BOAT_FUEL', actor: player, params: { want } });
  if (!r || (r.type === 'error' && /^Unknown action/.test(r.message || ''))) return null;
  return r;
}

async function cmdRefuelTruck(args, raw, player) {
  if (!rigOf(player)) {
    const boat = await tryBoatFuel(player, (args || []).join(' ').trim());
    if (boat) return boat;
    return await pumpParked(player, (args || []).join(' ').trim());
  }
  // The typed verb is the whole-tank case, through the same commit the handle sends.
  return pumpFuel(player, 1, { typed: true });
}

// ── Standing at the pump, on foot ──
// A forecourt is a place you park, and the pump's examine line offers `fuel`. Uses the same pumpAt
// and pumpClamp as the cab path, so a retune of either reaches this too.
async function pumpParked(player, want = '') {
  if (!pumpAt({ leg: 'city', zoneId: player.current_zone })) return say("You aren't driving anything.");
  const parked = await trucksAt(player.id, player.current_zone);
  const truck = pickParked(parked, want);
  if (!truck && parked.length) return whichTruckLine('fuel', parked, want);
  if (!truck) return say("You aren't driving anything, and nothing of yours is standing at these pumps.");

  const room = 1 - (truck.fuel ?? 1);
  if (room < 0.02) return say('She is already full.');
  const { take, cost } = pumpClamp(player.credits, truck.fuel ?? 1, room);
  if (take < 0.01) return say(`You can't cover so much as a splash. Diesel is ${FUEL_FULL}₵ a tank.`);

  // Fuel first, money second: a failed write must never bill for a fill that didn't happen.
  await setFuel(truck.id, player.id, Math.min(1, (truck.fuel ?? 1) + take));
  await adjustCredits(player, -cost, undefined, 'trucking:fuel');
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await repush(player, 'fleet');

  const pct = Math.round(Math.min(1, (truck.fuel ?? 1) + take) * 100);
  return say(pct >= 100
    ? `<span class="item-grant">You walk the nozzle over, brace it in the filler and let it run. Tanks filled. ${cost}₵.</span>`
    : `<span class="item-grant">The handle clicks off. ${cost}₵, and she is at ${pct}%.</span>`);
}

// ── The handle ──
// `truckpump <fraction>`: the cab reports only how long the trigger was held; money is re-derived
// here. A commit rather than a server-side pour (no per-player timer). Not an exploit surface: the
// most a lying client can send is 1, a full tank at full price.
async function cmdTruckPump(args, raw, player) {
  return pumpFuel(player, Number(args[0]), { typed: false });
}

async function pumpFuel(player, want, { typed }) {
  const rig = rigOf(player);
  if (!rig) return typed ? say("You aren't driving anything.") : { type: 'none' };
  if (!pumpAt(rig, player.current_zone)) return say('No pump here.');
  const room = 1 - rig.fuel;
  if (room < 0.02) return say('She is already full.');

  // The affordability cap is a clamp, never a refusal: short money buys what it can.
  const { take, cost } = pumpClamp(player.credits, rig.fuel, Number.isFinite(want) ? want : room);
  if (take < 0.01) return say(`You can't cover so much as a splash. Diesel is ${FUEL_FULL}₵ a tank.`);

  if (!(await adjustCredits(player, -cost, undefined, 'trucking:fuel'))) return say(`That's ${cost}₵ and you have ${player.credits || 0}₵.`);
  rig.fuel = Math.min(1, rig.fuel + take);
  rig.dry = false; rig.dryTold = false; rig.warnedLow = false;
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  // `extra` forces the push past the once-a-second floor so the gauge moves with the credits.
  pushCab(rig, { pumped: true });
  const pct = Math.round(rig.fuel * 100);
  return say(rig.fuel >= 0.995
    ? `<span class="item-grant">Tanks filled. ${cost}₵.</span>`
    : `<span class="item-grant">The handle clicks off. ${cost}₵: she is at ${pct}%.</span>`);
}

// ── park ──
// ⚠ The road itself is a second caller (arrival, a finished crossing): `forcedPark` lands the same
// way with no refusal, so nobody is stranded in a sim whose road has ended.
// What counts as stopped. Not zero: a settling truck reports a whisper of speed.
const PARK_STOPPED_MPH = 0.6;
// How far out the rig must have been before the near end of the road is an exit (see retreat).
const RETREAT_ARM = 2;
export async function forcedPark(player) { return parkRig(player, true); }
async function cmdPark(args, raw, player) { return parkRig(player, false); }
async function parkRig(player, forced) {
  const rig = rigOf(player);
  if (!rig) return say("You aren't driving anything.");
  // The only thing that stops you getting out is motion. The cab's park brake sends `park`, and a
  // text-rung driver has no ignition, so the key is turned for you rather than demanded.
  if (!forced && (rig.speed || 0) > PARK_STOPPED_MPH) {
    return say("Not while it's still rolling. Bring it to a stand first, then set the brakes.");
  }
  // ⚠ Stopping on the corridor on purpose isn't abandonment: the void room becomes the truck's
  // depot_zone and mountOnCrossing puts you back in. Abandonment is only a broken or dry rig.
  // When the instance tears down with a truck in it, recoverTrucksFrom sends it to the recovery lot.

  // ⚠ Before the dismount: the lesson's last stage is judged on where the truck stopped.
  await roadTestPark(player, rig);
  rig.engineOn = false;   // the key, turned for you — the last step of the sequence, not a gate on it
  dismountRig(player.id);
  // The text tick self-heals, but stopping it here saves one more narrated line.
  stopTextDrive(player.id);
  // Both flushes happen here and nowhere on the hot path.
  await flushZone(player, rig);
  // Parking at a depot puts it inside: the truck belongs to the bay, not the apron.
  const home = bayForYard(rig.zoneId);
  if (home) rig.zoneId = home.zone.id;
  // Walking away from a broken or dry rig out there: the void room is transient, so it goes back to
  // the depot it left on the impound_fee path that `drive` already settles.
  const abandoned = rig.leg !== 'city' && (rig.broken || rig.dry);
  if (abandoned) {
    rig.zoneId = rig.fromDepot || null;
    const fee = Math.max(250, Math.round((rig.type?.price || 4000) * 0.05));
    if (rig.truckId) await query('UPDATE trucks SET impound_fee = $1 WHERE id = $2', [fee, rig.truckId]).catch(() => {});
    // And the road remembers: see markWreck.
    markWreck(rig, player);
    sendToPlayer(player.id, { type: 'emote', message:
      `<span class="text-amber">You leave it on the shoulder with the flashers going and start walking. Somebody will come out for it eventually.</span>\n`
      + `<span class="text-dim">Recovery to ${depotNameOf(rig.fromDepot) || 'the yard'}: <b>${fee}₵</b>, payable when you next go to drive it.</span>` });
  }
  // ── Stopping on the shoulder, on purpose ──
  // ⚠ The room is transient, so write `void_home` here (the one moment we know both the truck and
  // the depot it left), or recoverTrucksFrom has nowhere real to drag it.
  const roadside = !abandoned && rig.leg !== 'city' && !!rig.instanceId;
  if (roadside && rig.truckId) {
    const home = rig.fromDepot || crossingInfo(rig.instanceId)?.originZone || null;
    if (home) await query(
      `UPDATE trucks SET custom_data = jsonb_set(COALESCE(custom_data,'{}'::jsonb), '{void_home}', to_jsonb($1::text), true)
        WHERE id = $2`, [home, rig.truckId]).catch(() => {});
    sendToPlayer(player.id, { type: 'emote', message:
      `<span class="text-amber">You set the brakes, kill the lights and drop down onto the hardpan. The engine ticks as it cools.</span>\n`
      + `<span class="text-dim">She will be here when you get back. <b>drive</b> to climb up again, but if you walk out of the waste without her, somebody will have to come and fetch her.</span>` });
  }
  // And you lock it, every park including a forced one. Persisted in the flush below.
  rig.locked = true;
  await persistTruck(rig);
  setPosture(player, 'standing');
  sendToPlayer(player.id, { type: 'truck_sim_close' });
  // The cab owns the area pane while driving, so a room description in this reply would be dropped;
  // force_look lands after the close.
  sendToPlayer(player.id, { type: 'force_look' });
  // Parking at a yard opens the yard, mirroring the zone.entered hook for both rungs (the log rung
  // gets prose). depotHere, because you stop on the apron.
  if (!abandoned) {
    const { bay: pBay, depot: pDepot } = depotHere(player);
    if (pDepot) {
      const panel = await depotPanel(player, pBay, pDepot, 'fleet');
      if (panel) sendToPlayer(player.id, panel.type === 'emote' ? { type: 'output', message: panel.message } : panel);
    }
  }
  return say('<span class="text-amber">You set the brake, drop down onto the dirt and lock her up behind you. The silence out here is enormous.</span>');
}

// ── trucksync ──
// The hot path: packed numerics, ~4×/s per driving player. Never awaits a query, node boundaries
// included: a room is a tile, so crossToNode moves the player in RAM and marks zoneDirty.
//   packed: s t hdg spd x y
async function cmdTruckSync(args, raw, player) {
  const rig = rigOf(player);
  if (!rig) return { type: 'noop' };
  const n = args.map(Number);
  if (n.length < 6 || n.slice(0, 6).some(Number.isNaN)) return { type: 'noop' };
  // ── The lamps ── an optional seventh slot: missing means headlights on (older clients send six).
  // RAM only, per-frame; read by truckContactsNear and nothing else.
  const lamps = Number.isFinite(n[6]) ? (n[6] | 0) : 1;
  rig.headlights = !!(lamps & 1);
  rig.braking = !!(lamps & 2);

  // ⚠ Read before the reconcile, which changes it: the first ignition edge is where a derelict's
  // hard start is spent.
  const wasRunning = !!rig.engineOn;

  const r = reconcileTruck(rig, { s: n[0], t: n[1], hdg: n[2], spd: n[3], x: n[4], y: n[5] });

  if (!wasRunning && rig.engineOn && rig._hardStart) {
    rig._hardStart = false;
    sendToPlayer(player.id, { type: 'emote', message: HARD_START_LINE });
  }

  // Out of diesel, and the low-fuel light. ⚠ Announced, never an early return: that skipped arrival
  // and delivery. reconcileTruck's speed clamp is what stops a dry truck moving.
  if (rig.dry && !rig.dryTold) {
    rig.dryTold = true;
    sendToPlayer(player.id, { type: 'emote', message: '<span class="text-amber">The engine coughs twice, catches once more out of spite, and dies. The gauge has been on the pin for a while and you knew it. Wherever this is, this is where you are.</span>' });
  }
  if (rig.warnLow) {
    rig.warnLow = false;
    sendToPlayer(player.id, { type: 'emote', message: '<span class="text-amber">A light comes on that you have been waiting for. Low fuel.</span>' });
  }
  announceBreak(player, rig);
  // The lesson. Sync and cheap by contract: on the four-times-a-second path, it may never await.
  roadTestTick(player, rig);
  passSign(player, rig);
  // The inspection plaza: swept off the odometer, sync, free on a road with no plaza.
  passPlaza(player, rig);
  // ...and the hitcher on the road ahead. See passHitcher for why it's swept.
  passHitcher(player, rig);

  // ── You took the other road ──
  // A destination change by steering must be said. Detection is in reconcileTruck.
  if (r.tookFork) {
    sendToPlayer(player.id, {
      type: 'emote',
      message: `<span class="text-amber">The wheels find the other road and stay on it. You're on the ${r.tookFork.name} limb now.</span>`
        + ` <span class="text-dim">Steer back across if that wasn't what you meant, or ${teachVerb('route', 'route')} to see what each one costs you.</span>`,
    });
  }

  // ── Two trucks in the same place ──
  // Detected here on the frame that moved the rig, so it costs a few subtractions. Damage lands in
  // RAM and rides home with the park write; collide.js's per-pair cooldown makes one contact one event.
  if (r.city) {
    for (const hit of collideTrucks(rig, [...rigs.values()])) {
      narrateCollision(rig, hit);
      narrateCollision(hit.other, hit);
      // Correct the other driver's cab too, or their client drives back into you next frame.
      pushCab(hit.other, { collided: true });
      pushCab(rig, { collided: true });
    }
  }

  // ── City leg ──
  if (r.city) {
    // Off the end of the world: driving off the rim launches the crossing as walking off does.
    if (r.bogged) return await leaveTheMap(player, rig);
    let lockZone = null, lockPrev = null;
    if (r.moved) {
      lockPrev = getZone(player.current_zone);
      const zone = driveToZone(player, rig, r.zone);
      lockZone = zone;
      // The scale hangs off the drive, not the move gate. Shared with the text rung; see scale.js.
      await afterDrive(player, rig, zone);
      if (zone) sendToPlayer(player.id, { type: 'zone_event', message: `<span class="text-dim">(${zone.name})</span>` });
      // Rolled into a depot with a load that belongs there? That's a delivery.
      if (rig.cargo && r.zone === rig.cargo.to) return await deliver(player, rig);
    }
    // The South Lock: every frame, because it asks you to stop in it. See lock.js.
    if (rig._lock || lockZone) await lockTick(player, rig, lockZone || getZone(rig.zoneId), lockPrev);
    // The shed's overlay comes up when you stop in it and goes when you roll out of it.
    baySvcTick(player, rig);
    if (rig._lockPush) {
      const red = rig._lockPush === 'red';
      rig._lockPush = null;
      pushCab(rig, { lockAlarm: red ? 1 : 0 });
    } else pushCab(rig);
    return { type: 'noop' };
  }

  // ── The plates ── be on the deck, and be stopped. tryDeck's sync guard makes its awaits rare.
  await tryDeck(player, rig);
  if (r.bogged && !rig.bogged) {
    rig.bogged = true;
    unbog(rig);
    pushCab(rig, { bogged: true });
    sendToPlayer(player.id, { type: 'emote', message: '<span class="text-amber">The wheels go soft, then bite nothing at all. You\'re off the road and into the deep stuff: it takes a long, ugly while to get her back onto the gravel, and the tank is lighter for it.</span>' });
    return { type: 'noop' };
  }
  // ⚠ Arrival is checked every frame, not only on `moved`: the node stops changing in the last room.
  if (rig.s >= rig.route.L - 1) { await arrive(player, rig); return { type: 'noop' }; }
  // ── And the same test at the near end ── backing to s = 0 leaves by the gate you came in.
  // ⚠ It has to be armed: a rig joins at s = 0, so an unguarded test bounces every haul off the road.
  if (rig.s <= 0.5 && (rig.sMax || 0) > RETREAT_ARM) { await retreat(player, rig); return { type: 'noop' }; }

  // ── Somebody on the road ahead ── a walker's `flag`. ⚠ Once per driver per walker, and far enough
  // out that slowing is a choice.
  if (rig.leg === 'corridor' && Number.isFinite(rig.x)) {
    for (const b of beaconsNear(rig.x, rig.y, BEACON_SEE_TILES)) {
      rig.sawFlag = rig.sawFlag || new Set();
      if (rig.sawFlag.has(b.playerId)) continue;
      rig.sawFlag.add(b.playerId);
      sendToPlayer(player.id, { type: 'emote', message:
        `<span class="text-amber">Somebody is standing at the side of the road up ahead with an arm out.</span>`
        + `\n<span class="text-dim">${b.handle}, about ${Math.max(1, Math.round(b.dist / 3))} mile${Math.round(b.dist / 3) === 1 ? '' : 's'} on. `
        + `Slow down and they can climb up; keep going and they won't hold it against you out loud.</span>` });
    }
  }

  if (r.moved) {
    const zone = await crossToNode(player, rig, r.node);
    if (!zone) { await forcedPark(player); return { type: 'noop' }; }
    // The junction, announced from the last trunk room, before you've taken a side.
    if (rig.trunk && r.node === rig.trunk - 1) {
      const info = crossingInfo(rig.instanceId);
      const others = (info?.dests || []).filter(d => d.key !== rig.destKey);
      if (others.length) {
        sendToPlayer(player.id, {
          type: 'emote',
          message: '<span class="text-amber">A junction, of sorts: the graded road splits around a stand of dead pylons and both halves go on being road.</span>'
            + ` <span class="text-dim">You're on the ${(info.dests.find(d => d.key === rig.destKey)?.heading) || 'far'} side of it. `
            + `${others.map(d => `<b>${d.heading}</b>`).join(', ')} the other way: ${teachVerb('route', 'route')} while you're still on it.</span>`,
        });
      }
    }
    cbLine(player, rig);
    // Arrival prose goes to the log, so the drive reads in the transcript as the walk does
    // (docs/systems-display-mode.md).
    sendToPlayer(player.id, {
      type: 'zone_event',
      message: `<span class="text-dim">(${zone.name})</span>`,
      minimap: getMinimapData(zone.id, 8, player),
    });
    pushCab(rig);
    return { type: 'noop' };
  }
  // ── Somebody tries the door ── every frame, because it's about standing still. The law is in
  // tryDoorBoard (state.js) so the text rung runs the same one.
  {
    const near = rig.hitchDone?.has(rig.node) ? null : hitcherAt(rig.route, rig.node, rig.chain?.length || 1);
    const got = rig.leg === 'corridor' ? tryDoorBoard(rig, near) : null;
    if (got) {
      sendToPlayer(player.id, { type: 'emote', message: doorBoardLine(got) });
      pushCab(rig, { boarded: true });
      return { type: 'noop' };
    }
  }
  pushCab(rig);
  return { type: 'noop' };
}

// `cb`: the radio, on by default.
// ⚠ The parse order is the design: anything that isn't one of the four literal controls is speech.
async function cmdCb(args, raw, player) {
  const rig = rigOf(player);
  if (!rig) return say("You aren't driving anything.");
  // A cooked set answers nothing at all, gated here so no handler reports an audience it can't reach.
  if (truckElecDead(rig)) return say('You reach for the set. Dark face, dead mic, no hiss: it took the pulse with the rest of the dash.');
  const rest = String(raw || '').replace(/^\S+\s*/, '').trim();
  if (!rest) return cbStatus(player, rig);

  const first = args[0]?.toLowerCase();
  if (args.length === 1) {
    if (first === 'on') return cbPower(player, rig, true);
    if (first === 'off') return cbPower(player, rig, false);
    if (first === 'speaker') return cbSpeaker(player, rig);
    if (/^\d{1,2}$/.test(first)) return cbTune(player, rig, first);
  }
  if (args.length === 2 && first === 'speaker' && /^(on|off)$/.test(args[1]?.toLowerCase())) {
    return cbSpeaker(player, rig, args[1].toLowerCase() === 'on');
  }
  return cbTransmit(player, rig, rest);
}

// ── weigh: pulling onto the plates ──
// The text rung can't steer onto the deck, so without this a lit plaza would be a trap for it.
// ⚠ The same law: weighHere is what the deck itself calls. ⚠ Pulling in ends a text run (you stop).
async function cmdWeigh(args, raw, player) {
  const rig = rigOf(player);
  if (!rig) return say("You're not behind a wheel.");
  const p = plazaHere(rig);
  if (!p) {
    const ahead = (rig.route?.plazas || []).find((q) => q.s0 > (rig.s || 0));
    return say(ahead
      ? `There's nothing to weigh on here. <span class="text-dim">${ahead.name} is ${milesOf(ahead.s0 - rig.s)} miles up the road.</span>`
      : "There's nothing to weigh on here.");
  }
  if (!p.open) return say(`The plates at ${p.name} are dark and the arch is cold. Nobody's weighing anything tonight.`);
  if (rig._plaza?.weighed) return say(`You've already been over the plates at ${p.name}. The barrier is up and the lane out is that way.`);
  if (isTextDriving(player.id)) {
    stopTextDrive(player.id);
    sendToPlayer(player.id, { type: 'emote', message:
      '<span class="ambient">You come off the throttle, take the ramp with the lights running away under the mirrors, and bring it to a stand on the plates.</span>' });
  } else if ((rig.speed || 0) > 3) {
    return say("Not at this speed. Get it onto the apron and <b>stop</b> on the plates.");
  }
  await weighHere(player, rig, p);
  return { type: 'ok' };
}

// ── The air horn ──
// Heard by the room, not just you; works in the cab or reaching into a truck parked in the yard.
// `horn [seconds]` is how long the cord was held. ⚠ Clamped here, never trusted from the client.
const HORN_MAX = 4;
async function cmdHorn(args, raw, player) {
  const held = Number(args?.[0]);
  const secs = Number.isFinite(held) ? Math.max(0.15, Math.min(HORN_MAX, held)) : null;
  const rig = rigOf(player);
  let typeId = rig?.typeId || null;
  let name = null;
  // Which horn is on the roof (client/shared/truck-horns.js) rides the packet.
  let horn = rig ? hornOf(rig.cd) : null;
  if (!typeId) {
    const zone = getZone(player.current_zone);
    const depot = depotAt(zone);
    if (!depot) return say("There's nothing here with a horn on it.");
    // Any of them will do: nobody can tell which cab a horn came out of.
    const truck = (await trucksAt(player.id, depotZonesOf(zone, depot)))[0];
    if (!truck) return say('You have nothing parked here to lean into.');
    typeId = truck.type_id; name = truck.name || truck.type?.name;
    horn = hornOf(truck.custom_data);
  }
  // Everyone else in the room gets the sound; the player's copy comes back separately.
  // ⚠ The sound every time, the sentence once a minute (RAM gate on the rig or player, no DB write).
  sendToZone(player.current_zone, { type: 'truck_horn', typeId, secs, horn }, player.id);
  const holder = rig || player;
  const now = Date.now();
  const sayIt = !holder._hornSaidAt || now - holder._hornSaidAt > HORN_SAY_MS;
  if (sayIt) {
    holder._hornSaidAt = now;
    sendToZone(player.current_zone, { type: 'emote', message:
      `<span class="text-amber">An air horn goes off somewhere very close to you${secs && secs > 1.6 ? ', and goes on going off' : ''}.</span>` }, player.id);
  }
  // ⚠ Not to the driver when they held it: the cab already played it (hornDown). An argument-less
  // `horn` still gets its sound from here.
  if (secs == null) sendToPlayer(player.id, { type: 'truck_horn', typeId, horn });
  // ⚠ The driver's own line is on the same 60s gate: a suppressed line is silence, not a refusal.
  if (!sayIt) return { type: 'noop' };
  return say(rig
    ? '<span class="text-amber">You pull the cord. Two notes, a long way apart, and the sound of them goes out across everything.</span>'
    : `<span class="text-amber">You reach up into the cab of ${name ? `<b>${name}</b>` : 'it'} and pull the cord. The yard rings with it.</span>`);
}

// ── Breakdowns ──
// `fix`, the roadside attempt: see the rules in rig.js. It buys distance, never health, and each
// attempt raises the odds of the next. No money changes hands.
async function cmdFix(args, raw, player) {
  const rig = rigOf(player);
  if (!rig) return say("You aren't driving anything.");
  if (!rig.broken) {
    return say(rig.dry
      ? "There's nothing wrong with it that a tank of diesel wouldn't solve."
      : 'Nothing on it\'s broken. Wear is a bench job: see <span class="text-dim">rig repair</span>.');
  }
  const b = BREAKDOWNS[rig.broken.kind] || BREAKDOWNS.hose;

  // The terminal gate: the one refusal that offers the tow instead of another attempt.
  if (isTerminal(rig.condition)) {
    return say('<span class="text-amber">You get the panel up and stand looking at it for a while.</span>\n'
      + '<span class="text-dim">There\'s nothing here to fix. It isn\'t one thing that has gone: it\'s everything, all at '
      + `once, the way it always is in the end. You aren't driving this out. <b>${teachVerb('tow', 'tow')}</b> is the number to call.</span>`);
  }

  // The parts: the decision is made hours earlier, at a depot counter.
  const spares = await sparesInHand(player);
  if (!spares) {
    return say(`<span class="text-amber">You know exactly what ${b.label} needs. You don't have it.</span>\n`
      + `<span class="text-dim">A box of truck spares is a depot counter and a few credits, and it's the difference between `
      + `this and a tow. <b>${teachVerb('tow', 'tow')}</b>, then.</span>`);
  }
  const fab = await effectiveSkill(player, 'fabrication');
  if (fab < FIX_MIN_FAB) {
    return say('<span class="text-amber">You have the part in your hand and no idea which end of it goes where.</span>\n'
      + `<span class="text-dim">This is a job for somebody who has done it before. <b>${teachVerb('tow', 'tow')}</b>.</span>`);
  }
  const odds = fixOdds(fab, rig.broken.attempts);
  rig.broken.attempts++;
  // The part is spent on the attempt, not the success, or you'd just retry until it works.
  await spendSpares(spares);
  if (Math.random() >= odds) {
    await awardSkillUse(player.id, 'fabrication', 0);
    return say(`<span class="text-amber">You get at ${b.label} with what's in the box, and it beats you. `
      + `You're dirtier, the light is worse, and it's still broken.</span> <span class="text-dim">Again, then.</span>`);
  }
  // Fixed for a while: the grace window is why you limp to a town and the bench still exists.
  rig.broken = null;
  rig.fixGrace = FIX_GRACE_TILES;
  await awardSkillUse(player.id, 'fabrication', 2);
  pushCab(rig, { fixed: true });
  return say(`<span class="item-grant">${b.fixed}</span>\n`
    + `<span class="text-dim">It'll hold for a while. It isn't repaired: that's a bench and a bill, and the bar on it hasn't moved.</span>`);
}

// ── parts, spares and `rig strip` live in bench.js ── (`fix` imports sparesInHand/spendSpares back)

// ── tow ──
// The way out, and the only one that costs money. Paid: a low-loader takes the rig (still wrecked)
// and you home to its depot. Unpaid: the firm takes it anyway as an impound, which `drive` already
// releases, so nobody is ever stranded and no new state is needed.
async function cmdTow(args, raw, player) {
  const rig = rigOf(player);
  // ⚠ `tow` is also what you say about a boat: dispatched by name (BOAT_TOW), as with `fuel`.
  if (!rig) {
    const boat = await dispatchAction({ type: 'BOAT_TOW', actor: player, params: { want: (args || []).join(' ').trim() } });
    if (boat && !(boat.type === 'error' && /^Unknown action/.test(boat.message || ''))) return boat;
    return say("You aren't driving anything, so there's nothing out here to come and get.");
  }
  if (!rig.broken && !rig.dry && !isTerminal(rig.condition)) {
    return say("It's going. Whatever you think is wrong with it, a recovery driver is going to charge you to "
      + 'tell you the same thing. <span class="text-dim">If you have simply had enough, <b>park</b>.</span>');
  }
  const truck = rig.truckId ? await getTruck(rig.truckId, player.id) : null;
  if (!truck) return say("There's no paperwork on this thing. Nobody is coming out for it.");

  // Home is the depot it belongs to, not the nearest one.
  const homeId = truck.depot_zone || rig.fromDepot || rig.zoneId;
  const fee = towFee(truck.type, rig.zoneId || homeId, homeId);
  const canPay = (player.credits || 0) >= fee;

  // One statement for both: only who owns the debt changes.
  await query(
    'UPDATE trucks SET depot_zone=$1, impound_fee = COALESCE(impound_fee,0) + $2 WHERE id=$3 AND owner_id=$4',
    [homeId, canPay ? 0 : fee, truck.id, player.id]
  ).catch(() => {});
  if (canPay) {
    await adjustCredits(player, -fee, undefined, 'trucking:tow');
    sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  }

  // The load goes back with the truck, and its contract dies.
  const lostLoad = rig.cargo ? " The load goes back to the yard on the same ramps, and the contract on it is dead." : '';
  rig.cargo = null;

  // Down off the road on park's own machinery, with the zone set to match before the flush.
  rig.zoneId = bayForYard(homeId)?.zone.id || homeId;
  dismountRig(player.id);
  stopTextDrive(player.id);
  await flushZone(player, rig);
  // A recovered rig leaves a wreck on the shoulder, as an abandoned one does.
  if (rig.leg !== 'city') markWreck(rig, player);
  await persistTruck(rig);
  setPosture(player, 'standing');
  // You get the ride: that's the difference from `park`.
  const homeZone = getZone(rig.zoneId) || getZone(homeId);
  if (homeZone && homeZone.id !== player.current_zone) {
    removePlayerFromZone(player.current_zone, player.id);
    player.current_zone = homeZone.id;
    addPlayerToZone(homeZone.id, player.id);
    await query('UPDATE players SET current_zone=$1 WHERE id=$2', [homeZone.id, player.id]).catch(() => {});
  }
  sendToPlayer(player.id, { type: 'truck_sim_close' });
  // Same as park: the room must be re-asked after the close lands.
  sendToPlayer(player.id, { type: 'force_look' });

  return say(canPay
    ? `<span class="text-amber">You make the call and then you sit on the step for a long time.</span>\n`
      + `<span class="text-dim">The low-loader that turns up is older than your truck and considerably better maintained. `
      + `You ride back in the passenger seat with your boots on the dash, and nobody says anything the whole way.${lostLoad} `
      + `The ${truck.type.name} is at ${depotNameOf(homeId)}, and it's going to need a bench.</span> <span class="item-loss">-${fee}₵</span>`
    : `<span class="text-amber">You make the call. The recovery driver looks at your account, then at the truck, then at you.</span>\n`
      + `<span class="text-dim">They take it anyway: that's the part people forget about recovery firms, and they keep it. `
      + `${fee}₵ is what it costs to see it again, and it's sitting behind their fence at ${depotNameOf(homeId)} until you have it.${lostLoad} `
      + `They drop you at the gate. It's a long way to anywhere from there.</span>`);
}

// ── truckevent ──
// Discrete transitions (like flight's cmdFlightEvent), kept off the sync route.
async function cmdTruckEvent(args, raw, player) {
  const rig = rigOf(player);
  if (!rig) return { type: 'noop' };
  const ev = (args[0] || '').toLowerCase();
  if (ev === 'pulloff') {
    rig.speed = 0;
    pushCab(rig, { stopped: true });
    return say('You drift onto the gravel and let her roll to a stop. Ticking metal, and a lot of sky.');
  }
  if (ev === 'arrive') { await arrive(player, rig); return { type: 'noop' }; }

  // A missed shift: the client owns the gearbox, the server owns the cost. Nothing to clamp, so the
  // defence is a rate limit (a shift takes about a second). It never narrates.
  if (ev === 'grind') {
    const now = Date.now();
    if (rig._lastGrindAt && now - rig._lastGrindAt < 900) return { type: 'noop' };
    rig._lastGrindAt = now;
    // Worse under load: the trailer and its load against 20 t.
    const laden = 1 + Math.min(2, ((rig.trailer?.kg || 0) + (rig.cargo?.kg || 0)) / 20000);
    applyDamage(rig, grindSplit(laden));
    return { type: 'noop' };
  }

  // Building collision: the client owns the geometry and asserts the hit (as flight's CFIT does);
  // the server owns the consequence and clamps the claimed speed.
  if (ev === 'bump' || ev === 'crash') {
    const mph = Math.max(0, Math.min(70, Number(args[1]) || 0));
    // A school rig with a corner knocked off it. Remembered, never punished: see roadtest.js.
    roadTestImpact(player.id);
    rig.speed = 0;
    // One incident, one line: below this floor the impact still wears the rig but doesn't narrate.
    const now = Date.now();
    const quiet = rig._lastImpactAt && now - rig._lastImpactAt < 8000;
    rig._lastImpactAt = now;
    // wearForImpact owns the total off the clamped speed; impactSplit decides which components eat
    // it. A rear impact with a box on is the trailer's.
    const area = IMPACT_AREAS.includes(args[2]) ? args[2] : 'front';
    const total = wearForImpact(ev === 'bump' ? mph * 0.25 : mph);
    if (area === 'rear' && rig.trailer) {
      // You reversed a trailer into something. The tractor barely felt it; the box did.
      rig.trailer.condition = Math.max(0, (rig.trailer.condition ?? 1) - total * 0.8);
      await setTrailerCondition(rig.trailer.id, rig.trailer.condition).catch(() => {});
      applyDamage(rig, impactSplit(total * 0.2, 'rear'));
    } else {
      applyDamage(rig, impactSplit(total, area));
    }
    if (ev === 'bump') {
      pushCab(rig, { stopped: true });
      if (quiet) return { type: 'noop' };
      return say('You nose into it at walking pace. Something plastic gives, somewhere behind you.');
    }
    pushCab(rig, { stopped: true });

    // No crime charge for hitting a building: an ordinary wide bend would put stars on a driver doing
    // the job right. If ramming ever needs charging, test for intent, not a speed threshold.
    const inTown = rig.leg === 'city';

    // The load takes it: the contract pays on what arrives.
    let spoiled = '';
    if (rig.cargo && mph >= RECKLESS_MPH) {
      const lost = Math.min(rig.cargo.pay || 0, Math.round((rig.cargo.pay || 0) * (mph / 120)));
      if (lost > 0) { rig.cargo.pay = (rig.cargo.pay || 0) - lost; spoiled = ` <span class="text-amber">The load is worth ${lost}₵ less than it was.</span>`; }
    }

    if (quiet && !spoiled) return { type: 'noop' };
    return {
      type: 'emote',
      message: `<span class="text-amber">You put ${mph} mph of loaded truck into a building. The world goes sideways, the load shifts with a bang like a dropped piano, and the rig comes back off it hard.</span>`
        + spoiled
        + (inTown && mph >= RECKLESS_MPH
          ? `\n<span class="text-dim">People are coming out to look at it. Nobody has a slate out: they have seen worse done to that wall.</span>`
          : ''),
    };
  }
  return { type: 'noop' };
}

// ── The rim: city to corridor ──
// Driving off the edge is the same event as walking off it, so it goes through voidwalking's
// launchCrossing; the truck lays its road over the chain that produced.
async function leaveTheMap(player, rig, broadcast) {
  const from = getZone(rig.zoneId || player.current_zone);
  const gate = voidGateOf(from);
  if (!gate) {
    // The map ran out but there is no void behind this edge — back onto the last real tile.
    const back = surfaceAt(Math.round(rig.x), Math.round(rig.y)) ? null : from;
    if (back && back.grid_x != null) { rig.x = back.grid_x; rig.y = back.grid_y; }
    rig.speed = 0;
    pushCab(rig, { stopped: true });
    sendToPlayer(player.id, { type: 'emote', message: '<span class="text-amber">The road simply stops. Past the last of the hardtop there\'s nothing anybody has built a way through.</span>' });
    return { type: 'noop' };
  }

  await flushZone(player, rig);                 // the drive through town is committed here, once
  const res = await launchCrossing(player, gate, broadcast, null);
  const info = player._crossing && crossingInfo(player._crossing.instanceId);
  if (!info) { await forcedPark(player); return res || { type: 'noop' }; }

  // Which way: the load's destination first, then the driver's `route`, then the first limb.
  const destKey = aimedDest(info, rig)?.key || info.dests?.[0]?.key;
  const chain = destKey ? crossingChain(player._crossing.instanceId, destKey) : [];
  if (!chain.length) { await forcedPark(player); return res || { type: 'noop' }; }

  joinCorridor(rig, { instanceId: player._crossing.instanceId, destKey, voidKey: info.voidKey,
    window: info.window, chain, dest: crossingDest(player._crossing.instanceId, destKey),
    trunk: info.trunk });
  rig.zoneId = player.current_zone;
  pushCab(rig, { joined: true });
  // ...and the sidebar's road window: zone.entered only fires on a node boundary.
  pushRoadWindow(player);
  const aimed = info.dests?.find(d => d.key === destKey);
  sendToPlayer(player.id, {
    type: 'emote',
    message: '<span class="text-amber">The last streetlight goes by and the hardtop gives way to something graded rather than built. The map ends. The road, for whatever it\'s worth out here, does not.</span>'
      + (aimed ? `\n<span class="text-dim">Running for ${aimed.heading}.${(info.dests?.length || 0) > 1 ? ` The fork is ${info.trunk} rooms out: ${teachVerb('route', 'route')} until you take it.` : ''}</span>` : ''),
  });
  return { type: 'noop' };
}

// ── The fork ──
// The load outranks the driver's own aim: a contracted haul goes where the paperwork says.
// aimedDest and destByWord live in routes.js, shared with the GPS screen.
// `route`: sets the aim in a yard; on the trunk it takes the other limb (see switchLimb); past the
// junction it refuses.
async function cmdRoute(args, raw, player) {
  const rig = rigOf(player);
  if (!rig) return say("You aren't driving anything.");
  // The nav head is cooked. ⚠ Refused, not degraded: a plot missing range would get driven anyway.
  if (truckElecDead(rig)) return say('The nav head is black glass. Whatever it knew about the roads out of here, it isn\'t saying.');
  const opts = routeOptions(rig, { zoneId: player.current_zone, forkAhead: atOrBeforeFork(rig) });
  if (!opts) return say("There's one road out of here and you're on it.");
  const onRoad = opts.onRoad;
  const info = onRoad && rig.instanceId ? crossingInfo(rig.instanceId) : null;
  const dests = (info?.dests || VOIDS[getZone(player.current_zone)?.flags?.region_id]?.dests || []);

  const want = args.join(' ');
  if (!want) {
    // The rows are routeOptions', the same rows the GPS screen paints.
    const lines = opts.dests.map((d) => {
      const mark = d.current ? '<span class="text-green">▸</span>' : ' ';
      const reach = d.reach === 'ok' ? ''
        : d.reach === 'thin' ? ' <span class="text-amber">· further than your tank, one way</span>'
        : ' <span class="text-red">· well past your range</span>';
      return `${mark} <b>${d.heading}</b> <span class="text-dim">(${d.key})${d.num ? `, Route ${d.num}` : ''}, ${d.miles} miles${reach}</span>`;
    });
    const how = onRoad
      ? (opts.forkAhead ? `<span class="text-dim">The fork is still ahead. <b>route &lt;name&gt;</b> to take the other one.</span>`
        : `<span class="text-dim">The fork is behind you. This is the road you're on now.</span>`)
      : `<span class="text-dim"><b>route &lt;name&gt;</b> to set it before you leave the map. A contracted load overrides it: the run goes where the paperwork says.</span>`;
    return say(`<span class="text-green">Out of ${opts.origin || 'here'}, the road forks toward:</span>\n${lines.join('\n')}\n${how}`);
  }

  const pick = destByWord(dests, want);
  if (!pick) return say(`Nothing out here goes to "${want}".`);
  if (!onRoad) {
    rig.aim = pick.key;
    return say(`<span class="text-green">You settle on ${pick.heading}.</span> <span class="text-dim">Take the rim and the road will do the rest.</span>`);
  }
  if (pick.key === rig.destKey) return say(`You're already on the ${pick.heading} road.`);
  if (!atOrBeforeFork(rig)) {
    return say(`<span class="text-amber">The fork is a long way behind you. There's no cutting across out here: the only way onto the ${pick.heading} road is back the way you came.</span>`);
  }
  const chain = crossingChain(rig.instanceId, pick.key);
  if (!chain.length) return say("That limb isn't there. Something has gone wrong with the crossing.");
  switchLimb(rig, { destKey: pick.key, chain, dest: crossingDest(rig.instanceId, pick.key) });
  rig.aim = pick.key;
  pushCab(rig, { rerouted: true });
  return say(`<span class="text-green">You take the other one.</span> <span class="text-dim">The road bends away east of where you were going and the country ahead stops looking familiar. Running for ${pick.heading}.</span>`);
}

// ── Turning round and going home ──
// arrive's mirror, deliberately a near-twin rather than one function with a direction flag.
// Lands on the crossing's originZone, the same tile a walker reappears on.
async function retreat(player, rig) {
  const info = rig.instanceId ? crossingInfo(rig.instanceId) : null;
  const home = info && getZone(info.originZone);
  // No origin tile: park's fail-safe, out of the cab rather than in a sim with no world.
  if (!home || home.grid_x == null) { await forcedPark(player); return; }

  // Outside the roomSet, so voidwalking tears the instance down on the event landOn fires.
  await landOn(player, rig, home);
  pushCab(rig, { arrived: true });
  // The load and contract stay live: coming back isn't charged as a failure.
  sendToPlayer(player.id, {
    type: 'emote',
    message: '<span class="text-amber">The waste lets go of you and the gate comes back up out of the haze, from the wrong side. You\'re where you started, with less fuel and a day you won\'t get back.</span>'
      + (rig.cargo ? `\n<span class="text-dim">${rig.cargo.name} still on the deck, still bound for ${rig.cargo.toName}.</span>` : ''),
  });
  // The text run's far-side target is meaningless now.
  if (isTextDriving(player.id)) stopTextDrive(player.id);
}

async function arrive(player, rig) {
  const dest = rig.dest && getZone(rig.dest);
  if (!dest || dest.grid_x == null) { await forcedPark(player); return; }

  // Outside the crossing's roomSet, so voidwalking's zone.entered handler tears the instance down.
  // You don't dismount: the last mile into a yard is part of the haul.
  await landOn(player, rig, dest);
  pushCab(rig, { arrived: true });
  sendToPlayer(player.id, {
    type: 'emote',
    message: `<span class="text-green">The haze thins, and there it is: low buildings, a water tower, lights that somebody pays for. The wheels find hardtop again.</span>${rig.cargo ? `\n<span class="text-dim">${rig.cargo.name} still on the deck, bound for ${rig.cargo.toName}.</span>` : ''}`,
  });
  if (rig.cargo && dest.id === rig.cargo.to) await deliver(player, rig);

  // A text run is retargeted at the yard: the gate tile is rarely the depot.
  if (isTextDriving(player.id)) {
    const to = rig.cargo?.to || allDepots().find(d => d.flags?.region_id === dest.flags?.region_id)?.id;
    if (to && to !== dest.id) setTextTarget(player.id, { target: to, wantsRim: false });
    else stopTextDrive(player.id);
  }
}

// ── Discovery ──
// The yard says what it is, through zone.describeRoom, with teachVerb shimmers on first mention.
async function describeDepot(zone, player) {
  // The scale announces itself: the design is a decision made before an inspection you see coming.
  const scale = scaleAt(zone);
  if (scale) {
    return `<span class="ambient">The plates of ${scale.name} are set into the road here, and the board over the booth is lit. `
      + `Anything crossing with a box behind it goes over them.</span>`;
  }

  // A dock confirms you found the street the board named.
  const dock = dockAt(zone);
  if (dock) {
    return `<span class="ambient">A loading bay is cut into the frontage here: a lipped concrete apron at trailer height, `
      + `with ${dock.name} stencilled on the roller door and a bell push nobody has ever answered quickly.</span>`;
  }

  // The apron has to say the depot is there, or the system hides behind a door.
  const bay = bayForYard(zone?.id);
  if (bay && !depotAt(zone)) {
    // ...and what's standing on it.
    return `<span class="ambient">The hardstand outside ${bay.depot.name || bay.zone.name}: swept concrete, `
      + `scored with the arcs of everything that has ever backed onto it, and wide enough to turn something with a `
      + `box behind it. The office and the bays are through the roller door; the road is the road.</span>`
      + await standingLine(zone.id);
  }

  const depot = depotAt(zone);
  if (!depot) return undefined;
  let line = `<span class="ambient">Trucks stand nose-out along the fence with chalk prices on their screens, and `
    + `somebody has bolted a board beside them with paper on it that's actually fresh. `
    + `You could look over the ${teachVerb('yard', 'yard')}, read what needs ${teachVerb('haul', 'haul')}ing, `
    + `or see what the ${teachVerb('market', 'market')} is paying today. `
    + `With a rig of your own you could ${teachVerb('drive')}.</span>`;

  // Player-owned rigs parked here, like flight's "On the ramp:".
  // ⚠ The click is `drive <id>`, not `examine`: SIFT can't see a truck, so examine was a dead link.
  // Somebody else's rig is named but not linked.
  const { rows } = await query(
    'SELECT id, name, type_id, owner_id FROM trucks WHERE depot_zone = $1 ORDER BY created_at LIMIT 5', [zone.id]
  ).catch(() => ({ rows: [] }));
  if (rows.length) {
    const names = rows.map(r => {
      const t = truckType(r.type_id);
      const label = r.name || t?.name || 'a truck';
      return player && r.owner_id === player.id
        ? `<span class="action-link" data-action="cmd" data-cmd="drive ${r.id}" title="climb in">${label}</span>`
        : `<span class="text-dim">${label}</span>`;
    });
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    line += `\n<span class="furniture-label">Parked up:</span> <span class="text-dim">${list}.</span>`;
  }

  line += await standingLine(zone.id);
  return line;
}

// Standing trailers, loaded ones flagged. Used on the bay and the hardstand. Returns '' so it appends.
async function standingLine(zoneId) {
  const standing = await trailersAt(zoneId);
  if (!standing.length) return '';
  const list = standing.slice(0, 6).map(t =>
    `<span class="action-link" data-action="cmd" data-cmd="hitch ${t.id}" title="back under it">${t.name}</span>`
    + (t.cargo ? ` <span class="text-dim">(loaded)</span>` : '')).join(', ');
  return `\n<span class="furniture-label">On their legs:</span> <span class="text-dim">${list}.</span>`;
}

// You can't walk while driving, or the spine and the odometer disagree about where you are.
registerMoveGate(({ player }) => {
  if (!player || !rigs.has(player.id)) return undefined;
  return { block: true, message: "You're behind the wheel: you'd have to <b>park</b> and climb down first." };
}, 'trucking');

// Walk in and the yard opens (as flight does for a hangar). Skipped while driving.
on('zone.entered', async ({ actor, zone: zoneId, from }) => {
  try {
    if (!actor) return;
    // The sidebar map's highway, one packet per room; a no-op off a crossing.
    // ⚠ Outside the depot branch below, which returns early.
    try { pushRoadWindow(actor); } catch (e) { console.error('[trucking] mmroad:', e.message); }
    const zone = getZone(zoneId);
    const depot = depotAt(zone);
    if (depot && !rigs.has(actor.id)) {
      const panel = await depotPanel(actor, zone, depot, 'fleet');
      // The log rung gets prose, and prose is a message rather than a panel.
      sendToPlayer(actor.id, panel.type === 'emote' ? { type: 'output', message: panel.message } : panel);
      return;
    }
    // ⚠ Walking out closes it, from any of the three tiles, and only when you've left the depot
    // (bay to apron is still inside).
    const leftDepot = from ? depotFrom(from) : null;
    if (leftDepot && !depotFrom(zoneId)) sendToPlayer(actor.id, { type: 'truck_depot_close' });
  } catch (e) { console.error('[trucking] depot auto-open:', e.message); }
});

// The first time you stand in one, a briefing (see onboard.js). Registered after the handler above
// so it lands under the panel. ⚠ `depotIn` is the bay only, not the three tiles.
registerDepotBrief({
  depotIn: (id) => { const z = getZone(id); const d = depotAt(z); return d ? { bay: z, depot: d } : null; },
  isDriving: (id) => rigs.has(id),
});

// A driver who dies or logs out leaves no rig in RAM. Logging out in the cab isn't losing the truck:
// saveDrivingState stores one record and deletes the rig (see resume.js).
// A dive bomber overhead, heard from the cab. City leg only: corridor coordinates aren't world tiles.
on('vehicle.diveSiren', ({ gx, gy, reach, name }) => {
  for (const rig of rigs.values()) {
    if (rig.leg !== 'city') continue;
    if (Math.max(Math.abs(rig.x - gx), Math.abs(rig.y - gy)) > (reach || 6)) continue;
    sendToPlayer(rig.playerId, { type: 'emote', message: `<span class="text-amber">⚠ A siren winds up somewhere above the cab: a ${name || 'dive bomber'}, coming down.</span>` });
  }
});

on('player.logout', ({ id }) => { saveDrivingState(id).catch(() => rigs.delete(id)); });
// ...and back in. Every failure leaves the player where the ordinary login put them.
on('player.login', async ({ id }) => {
  const player = getLivePlayer(id);
  if (player) await restoreDrivingState(player, { mountOnCrossing }).catch(() => {});
});
// ⚠ `player.death` emits `{ player, ... }`, not `{ id }`: destructuring `id` silently no-ops.
on('player.death', ({ player }) => {
  const id = player?.id;
  if (id && rigs.has(id)) { rigs.delete(id); sendToPlayer(id, { type: 'truck_sim_close' }); }
});

// ── The fifth wheel ──
// hitch/unhitch ask the physics (speed and angle), so there's one docking rule. A trailer is a row
// that stays where it's dropped; see trailers.js for its two rules.
async function cmdHitch(args, raw, player) {
  const say = (message) => ({ type: 'emote', message });
  const rig = rigOf(player);
  if (!rig) return say('You would need to be in a truck. <b>drive</b>.');
  if (rig.trailer) return say(`Already hitched: ${rig.trailer.name}.`);
  if (Math.abs(rig.speed) > HITCH_MPH) return say("Not at this speed. Stop first: the pin won't find the plate with the truck rolling.");
  // ⚠ A depot is three zones and a trailer sits in one of them, so search the depot's whole set
  // (regress buys and hitches at a real depot, not just the one-tile fixture). hitchReach still
  // decides whether you're under the pin.
  const here = getZone(player.current_zone);
  const standing = (await Promise.all(hitchZones(here?.id).map(z => trailersAt(z)))).flat();
  if (!standing.length) return say('Nothing standing here to back under. Trailers are bought and left at yards: see the <b>yard</b>.');

  // ⚠ A bare `hitch` takes the nearest box in reach, not the oldest row.
  const mine = standing.filter(t => !t.ownerId || t.ownerId === player.id);
  const pool = mine.length ? mine : standing;
  const gap = (t) => (posed(t) ? Math.hypot((rig.x ?? 0) - t.x, (rig.y ?? 0) - t.y) : 99);
  const nearest = pool.filter(t => hitchReach(rig, t).ok).sort((a, b) => gap(a) - gap(b))[0];
  const want = args.length
    ? standing.find(t => t.id === args[0] || t.name.toLowerCase().includes(args.join(' ').toLowerCase()))
    : nearest || pool[0];
  if (!want) return say(`Nothing here by that name. Standing in the yard: ${standing.map(t => t.name).join(', ')}.`);

  // Somebody else's box is somebody else's: the one ownership refusal in trucking.
  if (want.ownerId && want.ownerId !== player.id) return say(`${cap(want.name)} isn't yours. The pin is locked and the plate has somebody else's number on it.`);

  // ── You have to back under it ── the rule lives in trailers.js so the cab's HITCH button matches.
  const reach = hitchReach(rig, want);
  if (!reach.ok) {
    if (reach.why === 'far') return say(`${cap(want.name)} is standing ${reach.d < 1.2 ? 'just' : ''} too far off to couple. Line the truck up on it and back under.`);
    if (reach.why === 'angle') return say(`You're across it, not under it. Straighten up on ${want.name} and try again.`);
    // The flank: beside the box, the one place the pin can never be.
    if (reach.why === 'across') return say(`You're alongside ${want.name}, not on its pin. The fifth wheel has to come up its centreline: pull round and back onto the nose.`);
    return say("Not at this speed. Stop first: the pin won't find the plate with the truck rolling.");
  }

  // ⚠ The guard is the trailer's own zone (WHERE parked_zone = $3), which lets the DB settle a race.
  // Passing the tile under your wheels silently matches nothing for a box in the shed.
  const got = await hitchTrailer(want.id, rig.truckId, want.parkedZone);
  if (!got) return say('You line up on it and somebody else pulls out from under you. Gone.');
  rig.trailer = got;
  if (got.cargo) rig.cargo = got.cargo;     // what was on it is still on it
  await refreshStanding(here.id);           // it is no longer standing there, so it stops being drawn there
  pushCab(rig);
  return say(`<span class="item-grant">You back the fifth wheel under the pin and it takes with a bang you feel in your teeth. Air lines on, legs up. ${cap(got.name)} is behind you.${got.cargo ? ` Still loaded: ${got.cargo.name}.` : ''}</span>`);
}
async function cmdUnhitch(args, raw, player) {
  const say = (message) => ({ type: 'emote', message });
  const rig = rigOf(player);
  if (!rig?.trailer) return say("You're bobtail already.");
  if (Math.abs(rig.speed) > HITCH_MPH) return say('Stop the truck first.');
  const here = getZone(player.current_zone);
  // A dropped trailer must stand somewhere that exists tomorrow; a transient void room doesn't.
  if (!canDrop(here)) {
    return say("Not out here. There's nothing to leave it standing ON: the waste closes behind you, and a trailer you drop in it is a trailer you have thrown away. Get it to a yard, or to a street.");
  }
  const t = rig.trailer, hadLoad = !!rig.cargo;
  // The load stays on it.
  await saveLoad(t.id, rig.cargo || null, t.stash || null);
  // Where you left it: the tractor's pose when the pin came out.
  await dropTrailer(t.id, here.id, { x: rig.x, y: rig.y, heading: rig.heading });
  rig.trailer = null; rig.cargo = null;
  await refreshStanding(here.id);           // …and now it IS standing there, at the pose above
  pushCab(rig);
  return say(`Legs down, pin out, air lines off. You pull forward and ${t.name} stands there without you${hadLoad ? ', load and all' : ''}. The truck feels like a different animal.`);
}

// ── stash / unstash ──
// What makes the scale a decision. No roll: it always works and adds weight, which the scale can
// see (see scale.js). Uses resolveInventoryItem, so it answers SIFT prompts.
async function cmdStash(args, raw, player) {
  const rig = rigOf(player);
  if (!rig) return say('Not in a truck.');
  if (!rig.trailer) return say("There's nothing behind you to hide it in. <b>hitch</b> a trailer first.");
  if (!args.length) {
    const on = rig.trailer.stash || [];
    if (!on.length) return say('Nothing behind the bulkhead. <span class="text-dim">stash &lt;something&gt;</span>');
    return say(`Behind the bulkhead: ${on.map(s => `${s.name} <span class="text-dim">(${s.kg} kg)</span>`).join(', ')}. `
      + `<span class="text-amber">${stashKg(rig.trailer)} kg that isn't on your paper.</span>`);
  }
  const hit = await resolveInventoryItem(player, { name: args.join(' ') });
  if (!hit) return say("You aren't carrying that.");
  if (hit.type) return hit;                                  // a SIFT disambiguation prompt — pass it through
  // Weight comes off the item's own `weight`; an item with none counts as 5 kg, never free.
  const kg = Math.max(1, Math.round(Number(hit.weight) || 5));
  const list = [...(rig.trailer.stash || []), { itemId: hit.item_id, name: hit.name, kg }];
  rig.trailer.stash = list;
  await saveLoad(rig.trailer.id, rig.cargo || null, list);
  if (hit.quantity > 1) await query('UPDATE player_inventory SET quantity = quantity - 1 WHERE id = $1', [hit.inv_id]);
  else await query('DELETE FROM player_inventory WHERE id = $1', [hit.inv_id]);
  pushCab(rig);
  return say(`<span class="text-dim">You get the bulkhead panel off, put ${hit.name} behind it, and put the panel back. `
    + `Nobody looking at the deck would know.</span>\n`
    + `<span class="text-amber">The trailer now weighs ${stashKg(rig.trailer)} kg more than your paper says it does.</span>`);
}

// Taking it back out. No roll: the risk was always the scale.
async function cmdUnstash(args, raw, player) {
  const rig = rigOf(player);
  if (!rig?.trailer) return say('Nothing behind you to unpack.');
  const list = rig.trailer.stash || [];
  if (!list.length) return say('The bulkhead is empty.');
  const want = args.length
    ? list.findIndex(s => s.name.toLowerCase().includes(args.join(' ').toLowerCase()))
    : list.length - 1;
  if (want < 0) return say(`Nothing back there by that name. <span class="text-dim">${list.map(s => s.name).join(', ')}</span>`);
  const [got] = list.splice(want, 1);
  rig.trailer.stash = list;
  await saveLoad(rig.trailer.id, rig.cargo || null, list);
  await query(
    `INSERT INTO player_inventory (player_id, item_id, quantity) VALUES ($1,$2,1)`,
    [player.id, got.itemId]).catch(() => {});
  pushCab(rig);
  return say(`You get the panel off and take ${got.name} back. `
    + (list.length
      ? `<span class="text-dim">${stashKg(rig.trailer)} kg still back there.</span>`
      : `<span class="text-dim">The trailer weighs what your paper says it weighs again.</span>`));
}

// ── pickup / dropoff ──
// Somebody on the shoulder. See hitchers.js for why these are seeded facts, not NPC rows.
async function cmdPickup(args, raw, player) {
  const rig = rigOf(player);
  if (!rig) return say('Not in a truck.');
  if (rig.leg !== 'corridor') return say("There's nobody out here on foot. This is a city.");
  if (rig.rider) return say(`${cap(rig.rider.look)} is already in the sleeper.`);
  const who = rig.hitchDone?.has(rig.node) ? null : hitcherAt(rig.route, rig.node, rig.chain?.length || 1);
  if (!who) return say('Nobody on this stretch. Just the road.');
  if (Math.abs(rig.speed) > 6) return say("Not at this speed. They step back from the wash and you're past them.");

  // Where they ride is only offered for the fugitive.
  const where = (args[0] || '').toLowerCase();
  if (who.id === 'fugitive' && !['sleeper', 'trailer', 'cab'].includes(where)) {
    return say(`${cap(who.look)}.\n\n${who.line}\n\n`
      + `<span class="text-dim">They mean the wall behind you, and they mean the box. `
      + `<b>pickup sleeper</b>: fast, and anyone who looks in the cab finds them. `
      + `<b>pickup trailer</b>: nobody looks, and they weigh what a person weighs.</span>`);
  }
  const inTrailer = where === 'trailer';
  if (inTrailer && !rig.trailer) return say("There's no box back there to put anybody in.");

  // ⚠ The stretch is spent: hitcherAt is a pure function of route and node, so without this a
  // dropped-off hitcher is instantly back on the shoulder. Per rig, in RAM only.
  (rig.hitchDone || (rig.hitchDone = new Set())).add(rig.node);
  rig.rider = { ...who, inTrailer, boarded: rig.node };
  // Forced, not throttled: pushCab with no `extra` is skipped at a standstill.
  const boarded = { boarded: true };
  if (inTrailer) {
    // A person is 80 kg the scale can see.
    const list = [...(rig.trailer.stash || []), { itemId: null, name: "somebody who isn't on the paper", kg: 80 }];
    rig.trailer.stash = list;
    await saveLoad(rig.trailer.id, rig.cargo || null, list);
  }
  pushCab(rig, boarded);
  return say(`<span class="text-green">You pull up and ${inTrailer ? 'walk back to open the doors' : 'lean over and shove the passenger door open'}.</span>\n\n`
    + `${cap(who.look)}. ${who.line}\n\n`
    + (inTrailer
      ? `<span class="text-amber">They climb up into the dark and you shut them in. The trailer is eighty kilos heavier than your paper says.</span>`
      : `<span class="text-dim">They put their bag between their feet and don't say much after that.</span>`));
}

async function cmdDropoff(args, raw, player) {
  const rig = rigOf(player);
  if (!rig?.rider) return say('Nobody riding with you.');
  if (Math.abs(rig.speed) > 6) return say('Stop the truck first.');
  const who = rig.rider;
  rig.rider = null;

  // Taking the weight back out: letting somebody out short of the scale is free.
  if (who.inTrailer && rig.trailer) {
    const list = (rig.trailer.stash || []).filter(s => s.itemId !== null || s.kg !== 80);
    rig.trailer.stash = list;
    await saveLoad(rig.trailer.id, rig.cargo || null, list);
  }

  // What they were worth, paid as they get out.
  let extra = '';
  if (who.id === 'mechanic') {
    if (rig.dry) { rig.fuel = Math.max(rig.fuel, 0.18); rig.dry = false; extra = `<span class="item-grant">She spends twenty minutes under the tank with a length of hose and gets you enough to be going on with. You aren't walking after all.</span>`; }
    else extra = `<span class="text-dim">"Nothing wrong with it. Keep it that way."</span>`;
  } else if (who.id === 'local') {
    rig.fuel = Math.min(1, rig.fuel + 0.12);
    extra = `<span class="item-grant">He takes you off the road at a place you would have driven straight past, and you come back onto it a good way further along with more in the tank than the distance says you should have.</span>`;
  } else if (who.id === 'chancer') {
    const purse = 120 + Math.round((rig.travelled || 0) / 4);
    await adjustCredits(player, purse, undefined, 'trucking:hitcher');
    sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
    extra = `<span class="item-grant">They count it out on the seat before they go. ${purse}₵.</span>`;
  } else if (who.id === 'fugitive') {
    const purse = 400;
    await adjustCredits(player, purse, undefined, 'trucking:hitcher');
    sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
    extra = `<span class="item-grant">They put ${purse}₵ on the seat, and they're gone off the shoulder before you have picked it up.</span>`;
  }
  pushCab(rig, { boarded: false });
  return say(`They get down and shut the door.\n\n${extra}`);
}

// ── lock / unlock ──
// ⚠ These are engine builtins (commands/doors.js) and plugins beat builtins, so the router is
// narrow and falls through (returns undefined) unless you're driving and named nothing or the cab.
const CAB_WORDS = ['cab', 'door', 'doors', 'truck', 'rig'];
function cabLatchRouter(want) {
  return async (args, raw, player) => {
    const rig = rigOf(player);
    if (!rig) return undefined;                                  // not driving — it is a door
    const what = (args[0] || '').toLowerCase();
    if (what && !CAB_WORDS.includes(what)) return undefined;     // named something else — it is that
    return setLatch(player, rig, want);
  };
}
async function setLatch(player, rig, want) {
  if (rigLocked(rig) === want) {
    return say(want
      ? 'The latches are already down.'
      : 'The doors are already open.');
  }
  rig.cd = rig.cd || {};
  rig.cd.locked = want;
  // Written through immediately, not coalesced: the latch must survive a disconnect.
  if (rig.truckId) await saveTruckData(rig.truckId, player.id, rig.cd);
  pushCab(rig, { latch: want });
  return say(want
    ? '<span class="text-dim">You reach across and put both latches down. Whatever is out there stays out there.</span>'
    : '<span class="text-dim">The latches come up. The doors will open from outside now, either side.</span>');
}

// ── the galley ──
// What's in the cab you could eat. Follows the preparation HUD's rule: every row is a verb string
// (`eat sandwich`), no cab-only path. ⚠ Answered on demand, never on the cabContext push (that runs
// several times a second); hunger and thirst already reach the client on player_update.
async function cmdGalley(args, raw, player) {
  const { rows } = await query(
    `SELECT pi.id, pi.quantity, i.name, i.tags
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1 AND pi.container_id IS NULL
        AND (jsonb_exists(i.tags, 'consumable') OR jsonb_exists(i.tags, 'drinkable'))
      ORDER BY i.name`,
    [player.id]
  );
  // Drink if it restores more thirst than hunger. Only a label: both verbs share the consume path.
  const items = rows.map(r => {
    const t = r.tags || {};
    const food = Number(t.restore_hunger) || 0, water = Number(t.restore_thirst) || 0;
    return {
      id: r.id, name: r.name, qty: r.quantity || 1,
      verb: water > food ? 'drink' : 'eat',
      food, water,
    };
  });
  sendToPlayer(player.id, {
    type: 'truck_galley',
    items,
    hunger: player.hunger, thirst: player.thirst,
  });
  // The log gets the same answer (display-mode rule).
  if (!items.length) return say('You go through the bunk and the door pockets. Nothing to eat, nothing to drink.');
  return say(`<span class="text-dim">In the cab:</span>
`
    + items.map(i => `  <b>${i.verb} ${i.name}</b>${i.qty > 1 ? ` <span class="text-dim">×${i.qty}</span>` : ''}`).join('\n'));
}

// ── customs ──
// One verb, three answers (see scale.js). Trucking must not own `customs`: flight does. Flight's
// handler dispatches this action when its desk holds nothing of yours, so neither imports the other.
registerAction({
  type: 'TRUCK_CUSTOMS',
  handler: async ({ actor, params }) => {
    if (!pendingCustoms(actor.id)) return { handled: false };
    const what = String(params?.choice || '').toLowerCase();
    if (!['open', 'bribe', 'bolt'].includes(what)) {
      return { handled: true, type: 'emote', message: '<span class="text-dim">customs open · customs bribe · customs bolt</span>' };
    }
    const r = await customsAnswer(actor, rigOf(actor), what);
    return r ? { handled: true, ...r } : { handled: false };
  },
});

// ── The box, on the text rung ──
// Typed versions of the cab's controls (`revs up` is `.`, `boot` A, `brake` Z, `jake` C).
// `revs`/`boot`, not `gear`/`throttle`: flight owns those words.
function cmdTextDrive(what) {
  return (args, raw, player) => textDriveCommand(player.id, what, args[0]) || say("Not while you're out of the truck.");
}

// ── ride / hop: getting into somebody else's truck ──
// ⚠ The truck has to be stopped: that's the safety model (a moving rig's position is already stale).
// Same condition the hijacker gate reads (hijack.js, STOPPED_MPH).
const RIDE_STOPPED_MPH = 1;

// How close a rig has to be, out in the waste, to be a truck you could walk up to.
const REACH_TILES = 6;
// How far ahead a driver sees an arm out: generous, so the alert can be acted on.
const BEACON_SEE_TILES = 45;

// Every rig you could get into from here. ⚠ Same room or near by coordinate: crossings are instanced,
// so a walker and a driver out there share no zone, only position.
function rigsInReach(player) {
  const here = getZone(player.current_zone);
  const hx = here?.grid_x, hy = here?.grid_y;
  const out = [];
  for (const rig of rigs.values()) {
    const drv = getLivePlayer(rig.playerId);
    if (!drv) continue;
    if (rig.zoneId === player.current_zone) { out.push({ rig, driver: drv, dist: 0 }); continue; }
    if (hx == null || hy == null) continue;
    const rz = getZone(rig.zoneId);
    if (rz?.grid_x == null || rz.grid_y == null) continue;
    // Never across a map boundary.
    if (rz.map_id !== here.map_id) continue;
    const d = Math.hypot(rz.grid_x - hx, rz.grid_y - hy);
    if (d <= REACH_TILES) out.push({ rig, driver: drv, dist: d });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

async function cmdRide(args, raw, player) {
  if (rigOf(player)) return { type: 'error', message: "You're driving. `park` first if you want somebody else to." };
  if (ridingRigOf(player)) return { type: 'error', message: "You're already riding. `hop` to get down." };

  const here = rigsInReach(player);
  if (!here.length) return { type: 'error', message: "There's no truck here to ride in." };

  const want = args.join(' ').trim().toLowerCase();
  const pick = want
    ? here.find(({ driver }) => driver.handle?.toLowerCase().includes(want))
    : (here.length === 1 ? here[0] : null);
  if (!pick && want) return { type: 'error', message: `Nobody called "${args.join(' ')}" is sitting in a truck here.` };
  // ⚠ Never guess between two cabs.
  if (!pick) return { type: 'error', message: `Which one? ${here.map(({ driver }) => driver.handle).join(', ')}.` };

  const { rig, driver } = pick;
  if (Math.abs(rig.speed || 0) > RIDE_STOPPED_MPH)
    return { type: 'error', message: `${driver.handle} is still rolling. You would have to be quicker than that.` };
  if (seatsFree(rig) <= 0)
    return { type: 'error', message: `There's no room in the cab.${rig.rider ? ' Somebody is already in the sleeper.' : ''}` };

  boardPassenger(rig, player);
  sendToPlayer(driver.id, { type: 'emote',
    message: `<span class="text-green">${player.handle} pulls the door open and swings up into the cab.</span>` });
  sendToZone(player.current_zone, { type: 'zone_event',
    message: `${player.handle} climbs up into ${driver.handle}'s cab.` }, player.id);
  return { type: 'emote',
    message: `<span class="text-green">You haul yourself up into ${driver.handle}'s cab and pull the door shut.</span>`
      + `\n<span class="text-dim">You're along for the ride. ${teachVerb('hop', 'hop')} to get down wherever they stop.</span>` };
}

async function cmdHop(args, raw, player) {
  const rig = ridingRigOf(player);
  if (!rig) return undefined;   // not riding: fall through, so the word is free for anything else
  const driver = getLivePlayer(rig.playerId);
  // ⚠ Moving or not, you can always get out; at speed it just costs you.
  const rolling = Math.abs(rig.speed || 0) > RIDE_STOPPED_MPH;
  alightPassenger(player);
  if (driver) sendToPlayer(driver.id, { type: 'emote',
    message: rolling
      ? `<span class="text-amber">${player.handle} gets the door open and goes out of it while you're still moving.</span>`
      : `<span class="text-dim">${player.handle} drops down out of the cab.</span>` });
  return { type: 'emote', message: rolling
    ? '<span class="text-amber">You get the door open, pick your moment, and it\'s still a worse landing than you wanted.</span>'
    : '<span class="text-green">You drop down out of the cab.</span>' };
}

export const commands = {
  drive: cmdDrive,
  // `deps` handed in so roadtest.js never imports back into this file.
  roadtest: (args, raw, player) => cmdRoadTest(args, raw, player, { depotHere, mount: mountTruckById, isDriving: (id) => rigs.has(id) }),
  ride: cmdRide,
  hop: cmdHop,
  revs: cmdTextDrive('gear'),
  jake: cmdTextDrive('jake'),
  coast: cmdTextDrive('coast'),
  boot: cmdTextDrive('throttle'),
  brake: cmdTextDrive('brake'),
  cruise: cmdTextDrive('cruise'),
  hitch: cmdHitch,
  unhitch: cmdUnhitch,
  stash: cmdStash,
  unstash: cmdUnstash,
  pickup: cmdPickup,
  dropoff: cmdDropoff,
  park: cmdPark,
  fix: cmdFix,
  tow: cmdTow,
  cb: cmdCb,
  horn: cmdHorn,
  honk: cmdHorn,   // both, because half the people who want this will type the other one
  route: cmdRoute,
  weigh: cmdWeigh,
  haul: cmdHaul,
  market: cmdMarket,
  yard: cmdYard,
  rig: cmdRig,
  fuel: cmdRefuelTruck,
  truckpump: cmdTruckPump,
  trucksync: cmdTruckSync,
  truckevent: cmdTruckEvent,
  galley: cmdGalley,
  // ⚠ Routers, not handlers: they fall through to the engine door commands (see cabLatchRouter).
  lock: cabLatchRouter(true),
  unlock: cabLatchRouter(false),
};

export const hooks = {
  'zone.describeRoom': describeDepot,
  // Diesel's price from the system that charges it, so a sign never keeps its own FUEL_FULL. A tile
  // with no pump answers nothing. `each` is one percent of a tank (t.fuel is 0..1).
  'fuel.prices': (zone) => pumpAt({ leg: 'city', zoneId: zone?.id })
    ? { grade: 'DIESEL', unit: 'tank', price: FUEL_FULL, each: FUEL_FULL / 100, note: 'a full tank, any rig, the pylon prices it by the percent' }
    : null,
  // Flight asks who else is out there; a gather hook keeps the dependency one-way.
  'vehicle.contacts': (x, y, range) => truckContactsNear(x, y, range),
  // Every crewed rig and how to reach its electronics (the EMP pulse). Each entry carries its own
  // `knockOut`, so weather never learns what a truck is. See state.js crewedRigs.
  'vehicle.crewed': () => crewedRigs(),
  // `hijack` belongs to surveillance; it gathers this hook when the name isn't a device. Null means
  // "not mine".
  'hijack.target': (player, nameHint) => playerHijack(player, nameHint),
};

// ── Nothing is lost out there, it just gets expensive ──
// A truck parked on the corridor holds a transient void room; when the crossing ends it goes to
// `custom_data.void_home` (or the crossing's origin) with an impound fee, as a breakdown does.
// ⚠ The fee is only set, never raised: `NULLIF(…, 0)` because recovery clears the fee to 0 and
// readers treat 0 and NULL alike. Teardown and the boot sweep can both reach the same truck.
async function recoverTrucksFrom(rooms, origin) {
  if (!rooms?.length) return 0;
  const { rows } = await query(
    `SELECT id, type_id, custom_data->>'void_home' AS void_home FROM trucks WHERE depot_zone = ANY($1)`,
    [rooms]).catch(() => ({ rows: [] }));
  let moved = 0;
  for (const t of rows) {
    const home = t.void_home || origin || null;
    if (!home) continue;   // nowhere real to put it: leave the row alone rather than guess a yard
    const fee = Math.max(250, Math.round((truckType(t.type_id)?.price || 4000) * 0.05));
    const { rowCount } = await query(
      `UPDATE trucks SET depot_zone = $1, impound_fee = COALESCE(NULLIF(impound_fee, 0), $2) WHERE id = $3`,
      [home, fee, t.id]).catch(() => ({ rowCount: 0 }));
    moved += rowCount || 0;
  }
  // Trucks actually rescued, not rows looked at.
  return moved;
}

// Fired before the rooms are unregistered: see voidwalking's teardownInstance.
on('crossing.ended', async ({ rooms, origin }) => {
  const n = await recoverTrucksFrom(rooms, origin).catch(() => 0);
  if (n) console.log(`[trucking] recovered ${n} truck(s) from a crossing that ended.`);
});

// The restart case: crossings live in RAM, so any truck still in an `xing_…` room is dangling.
// Deferred a tick; failure must never block boot.
setTimeout(async () => {
  const { rows } = await query(`SELECT DISTINCT depot_zone FROM trucks WHERE depot_zone LIKE 'xing\\_%'`)
    .catch(() => ({ rows: [] }));
  if (!rows.length) return;
  const n = await recoverTrucksFrom(rows.map(r => r.depot_zone), null).catch(() => 0);
  if (n) console.log(`[trucking] recovered ${n} truck(s) stranded in void rooms by a restart.`);
}, 0);

// Hijackers try the door of any stopped cab. Scheduled, because it watches for a truck NOT moving.
// Idle-gated by schedule.
schedule('5s', () => tickHijackers());

export const _test = { boardFor, allDepots, mountSpot, depotFrom, bunkFrom, hitchZones, allDocks, dockAt, depotAt, depotZonesOf, describeDepot, LOADS, RECKLESS_MPH, hydrateFromTruck, recoverTrucksFrom };

console.log('[trucking] Plugin loaded.');
