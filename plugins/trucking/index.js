// THE LONG HAUL — driving the void.
//
// The road between regions, as something you drive rather than something you endure. A crossing
// that used to be a hard walk becomes a rig, a corridor, and about a quarter of an hour of country.
//
// THREE RULES SHAPE THIS PLUGIN, and every one of them is a decision NOT to build something:
//
//  1. The corridor synthesises ZONES, never render cells. `corridorAt` returns the same shape
//     `surfaceAt` returns, and plugins/flight/state.js mapWindow derives it — so road auto-tiling,
//     lane markings, biome, buildings and fog all come from the one place that already knows how.
//     (snapshot.js kept its own copy of that derivation and drifted twice. Once is a lesson.)
//
//  2. The drive IS the crossing. `player.current_zone` stays the void room the whole way; the
//     odometer crossing a node boundary walks the player one room down the spine and emits
//     `zone.entered`, which is exactly what a footstep does. So encounters, ghost-traces, hard
//     nodes, detours and teardown are TRIGGERED here and implemented nowhere here. A trucker who
//     breaks down finishes the crossing on foot at a cost of zero extra code.
//
//  3. The edge of the road is a law, not a wall. You may drive off it: open country is passable,
//     slow, and murder on tyres — the reason to stay on the tarmac is the BILL, never a refusal.
//     Four times the paved half-width out there is no ground left to synthesise, and only there do
//     you bog: stalled, penalised in time, and put back on the shoulder facing the right way.
//     There is no geometry you can hit.
//
// PHASE 1 IS BOBTAIL. No trailer, no gears, no freight, no yard. The question this phase exists to
// answer is whether a quarter of an hour of changing country with a city coming out of the haze is
// worth doing on its own. Everything else is downstream of that answer.

import { getZone, getAllZones, getMinimapData, addPlayerToZone, removePlayerFromZone, getLivePlayer } from '../../server/engine/world.js';
import { saveDrivingState, restoreDrivingState } from './resume.js';
// The damage model. `condition` is still the headline number every older reader uses; these four
// components are what it is now DERIVED from. See damage.js for why the weakest link and not a mean.
import { applyDamage, impactSplit, grindSplit, IMPACT_AREAS, damageOf, overall, PARTS, PART_LABELS, partBand,
  isBroken, isCosmetic, PART_ITEMS, PART_SHARE, COSMETIC_MUL, BROKEN_AT } from './damage.js';
import { grimeOf, grimeBand, washCost } from './filth.js';
import { FITTINGS, FIT_IDS, SLOTS, installedFits, fitInSlot, fitSuffix, priceFor } from './fittings.js';
import { sendToPlayer, sendToZone, teachVerb } from '../../server/engine/messaging.js';
import { on, emit } from '../../server/engine/events.js';
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { setPosture } from '../../server/engine/posture.js';
import { query } from '../../server/models/db.js';
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
  sanitizeCustomTrim, isTrimHex, CUSTOM_COL } from './rig.js';
import { stockTrim } from '../../client/shared/cab-trim.js';
import { skillCheck, effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { crossingChain, crossingDest, crossingInfo, voidGateOf, launchCrossing, VOIDS,
  registerCrossingDistance, registerCrossingPoints, registerTrailCuts, beaconsNear } from '../voidwalking/index.js';
import { pushRoadWindow } from './mmroad.js';
import { registerZoneReloadHook } from '../../server/engine/world.js';
import { registerCellOverlay } from '../flight/state.js';
import { worldRoadProvider } from './roadnet.js';

// THE RIM GATES ARE DERIVED FROM TILE POSITIONS, so an editor moving a region's tiles moves the
// mouths of its roads — and `regionGates` memoises per region for the life of the process. Left
// alone, the highway would go on anchoring itself to where the gate used to be: the road would
// still be built, still be drivable, and still be wrong, with nothing anywhere saying so.
//
// ⚠ CLEARED WHOLESALE RATHER THAN PER REGION. A gate is a RIM tile — its identity depends on a
// neighbour being absent — so editing one tile can create or destroy a gate in a region that tile
// does not belong to. Clearing one region's entry would be precise about the wrong thing.
// ⚠ THE ROAD NETWORK RIDES THIS AND IS NOT LISTED HERE. `roadnet.js` holds every road in the world,
// all of it anchored on these gates, and it keys its memo on `gateGeneration()` — which this bumps.
// Adding a second call would read as the thing keeping them in step, and it is not: a caller that
// clears gates without going through here (regress does, mid-suite) would still be covered.
registerZoneReloadHook(() => _clearGateCache());

// ── THE HIGHWAY, FOR EVERYBODY WHO IS NOT DRIVING IT ─────────────────────────
//
// The corridor has been anchored in real world coordinates since the frame change, and until now
// the only thing that ever looked at it was the cab of the truck on it. So the flight sim rendered
// the same journey as nothing at all — `kind: 'air'` for 282 tiles of tarmac — and `truckContactsNear`
// had to drop corridor rigs on the honest grounds that "the corridor is not in anybody's world
// window". It is now.
//
// Pushed rather than pulled: flight cannot import this plugin (trucking imports flight/state.js, so
// the edge only runs one way), and it does not need to — it takes a cell provider and asks it what
// is at a tile. Same seam the cab has always used, one caller wider.
//
// ⚠ REGISTERED AS A RENDER PROVIDER, NEVER AS PLACED GROUND. See the ⚠ on `registerCellOverlay` and
// on roadnet.js: `regionGates` derives the mouths this road hangs off by testing that the world
// STOPS beside them, so synthesised ground under `surfaceAt` would delete the gates, the rim and
// the void's only entrance in one move.
registerCellOverlay(worldRoadProvider());

// HOW LONG A CROSSING IS, ANSWERED BY THE THING THAT BUILDS IT. voidwalking decides how many rooms
// a limb gets, and until now it divided a real distance by the UNANCHORED per-room constant (90) —
// so every crossing in the game came out under the minimum and every destination carried a
// hand-written `length` to correct it. It now asks for the distance instead, and this is the
// answer: the same `gatePair` the road itself anchors on, so the room count and the geometry
// cannot disagree about how far it is.
//
// ⚠ AND IT IS SYMMETRIC, which the hand-written numbers only were by careful copying. A return leg
// is the same crossing read backwards, and `gatePair` picks the same two mouths whichever end you
// ask from — so out and back derive the same length by construction rather than by both being
// edited at the same time.
// WHERE A CROSSING'S ROOMS ARE, IN WORLD TILES — the other half of the same seam.
//
// A void room had no position at all until the trail went on the map, and the geometry that could
// give it one lives here: the anchored road between two real gates. The walker's route and the
// driver's are the same journey, so they come off the same polyline rather than off two derivations
// that would drift the moment either was tuned.
//
// A LIST goes out and a LIST comes back: the road is built once per limb, and `corridorPos` never
// leaves this plugin. Each request carries its own lateral offset, so the trail beside the road and a
// detour swinging wider off it are one call.
//
// ⚠ NULL RATHER THAN A GUESS, AND NULL IS SAFE. A leg with no buildable road returns nothing and
// those rooms simply stay placeless, which is exactly how every void room behaved before this
// existed. Coordinates enrich a crossing; they are never a requirement of one.
// ⚠ THE TRAIL IS SEEDED ON THE UNORDERED PAIR, so a crossing and its return are the same footpath.
// Two directions deriving two different sets of shortcuts would mean the way back was not the way you
// came, which is the one thing a trail cannot be.
const trailKey = (a, b) => [a, b].sort().join('|');

// The trail between two regions: built once from the anchored road, cached per (pair, window) because
// every room of a crossing asks about it and the road underneath is static between deploys.
let _trailCache = null;
function trailBetween(voidKey, region, window) {
  const key = `${trailKey(voidKey, region)}|${window}`;
  if (_trailCache?.key === key) return _trailCache.trail;
  const pair = gatePair(voidKey, region);
  if (!pair) return null;
  // ⚠ THE ROAD IS BUILT ON THE GATE DISTANCE, NOT ON THE ROOM COUNT, AND THAT BREAKS A CYCLE. The
  // room count comes from the TRAIL's length, the trail comes from the road, and the road takes a
  // node count — so asking the room count for it would be circular. Anchored, `nodes` only sets the
  // trunk FRACTION and a runaway cap; the geometry is the two gates. So the honest input is the
  // distance between them.
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

// The cuts hanging off that spine: for each, where it leaves and rejoins (as spine distances), how
// long it is, what it saves, and whether it is walkable this week.
//
// ⚠ EXISTING AND BEING OPEN ARE DIFFERENT QUESTIONS. The chord is geometry — it is there every week,
// because the mesa is there every week. Whether it can be walked is seeded per window. Conflating the
// two is what made the WEEK decide whether a player got a shortcut, instead of the player deciding
// whether to take one.
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

registerCrossingDistance((fromRegion, toRegion) => {
  const pair = gatePair(fromRegion, toRegion);
  return pair ? Math.hypot(pair.to.x - pair.from.x, pair.to.y - pair.from.y) : 0;
});
import { routeOptions, aimedDest, destByWord } from './routes.js';
import { surfaceAt } from '../flight/state.js';
import { rigs, rigOf, mountRig, dismountRig, reconcileTruck, crossToNode, driveToZone, flushZone,
  joinCorridor, leaveCorridor, unbog, pushCab, cabContext, surfaceUnder, truckContactsNear,
  announceBreak, switchLimb, atOrBeforeFork, cbLine, passSign, passHitcher, markWreck, pumpAt, pumpClamp, FUEL_FULL,
  gatePair, rigLocked, tryDoorBoard, doorBoardLine,
  _clearGateCache, networkRoute,
  ridingRigOf, seatsFree, boardPassenger, alightPassenger } from './state.js';
import { corridorPos, corridorAt, TILES_PER_ROOM, sOfNode, wreckNear, trailFor, trailPos } from './corridor.js';
// The bench — `rig` and the parts counter. It imports a handful of yard helpers back from this file;
// see the header of bench.js for why that edge is allowed to run both ways inside one plugin.
import { cmdRig, sparesInHand, spendSpares, truckStockTrim, sanitizeTrimResolved } from './bench.js';
import { cbStatus, cbTune, cbPower, cbSpeaker, cbTransmit } from './cb.js';
import { tickHijackers, playerHijack } from './hijack.js';
import { collideTrucks, narrateCollision } from './collide.js';
import './bunk.js';   // registers the sleeper cab as a place you can sleep — see the file header
import './hvac.js';   // registers the cab as a climate-controlled box while the engine runs
import { schedule } from '../../server/engine/scheduler.js';
import { hitcherAt } from './hitchers.js';
import { runScale, afterDrive, customsAnswer, pendingCustoms, scaleAt, releaseImpound } from './scale.js';
import { registerAction } from '../../server/engine/actions.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { TRAILER_TYPES, trailerType, trailersAt, trailersOf, getTrailer, trailerOnTruck,
  buyTrailer, hitchTrailer, dropTrailer, saveLoad, canDrop, declaredKg, actualKg, stashKg, setTrailerCondition,
  hitchReach, posed, refreshStanding, stockPose, findStockPose, standStock, paintTrailer, boxColour,
  sellTrailer, trailerResale } from './trailers.js';

export const say = (msg) => ({ type: 'emote', message: msg });

// Below this, a contact is a scrape and nobody calls anybody. Above it, you have demolished part of
// a street at the wheel of several tonnes, and in a city that is witnessed.
//
// ⚠ IT IS A FRACTION OF THE SPEED RANGE, NOT A NUMBER, so it moves when the range does. 22 was
// about 42% of a Courier's top end; after the ceiling doubled it would have been 21%, which turns
// 'you were going far too fast for a street' into 'you were moving'. Doubled with it.
const RECKLESS_MPH = 44;

// The derelict's cold start. Named because TWO rungs spend it now (the text rung as it pulls out,
// the visual rung the first time the ignition comes back true through telemetry), and a line of
// prose written down twice is a line that drifts.
// How often the ROOM is told about a horn, however many times the cord is pulled. The sound has no
// cooldown at all and must not get one — see cmdHorn.
const HORN_SAY_MS = 60_000;
const HARD_START_LINE = '<span class="text-amber">It turns over, and over, and does not catch. You wait. You try it again and it goes, in a cloud of something that should not be blue.</span>';

// ── drive ────────────────────────────────────────────────────────────────────
// Get in the rig. A haul STARTS AT A DEPOT and ends at one: you pull out of the yard, drive the
// city streets to the edge of the map, cross the waste, and roll into a yard on the far side. The
// gate is the depot, not the crossing — the crossing is something you drive to.
//
// Phase 1 issues a rig on the spot rather than modelling ownership. What a depot IS lives in
// content (`flags.truck_depot`), never in this file — the engine/content split.
// EVERY WAY INTO A CAB HYDRATES THE RIG FROM THE TRUCK ROW THROUGH HERE, and that is the whole
// reason it is a function. There are three mount paths — the depot (`cmdDrive`), the crossing
// (`mountOnCrossing`) and the reconnect (`resume.js`) — and `mountRig` deliberately builds a bare,
// synchronous, BOBTAIL rig, because it is shared with the regress fakes and must not query. Which
// means every path has to put the truck back on afterwards, and a path that forgets hands the
// driver somebody else's generic rig wearing their truck's name.
//
// ⚠ THE HITCH IS WHAT THE DATABASE SAYS IT IS. `park` never unhitches — only `dropTrailer` clears
// `towed_by` — so a trailer parked on the back keeps pointing at this tractor and holds no
// `parked_zone`, which also means it is in no yard. Re-reading it here is what makes it visible
// again; NOT re-reading it is not a lost trailer, it is an invisible one, and the driver cannot
// tell those apart. Do not replace this with a remembered id — a remembered id is a second copy
// of a fact the row already holds, and it goes stale the moment somebody else takes the box.
async function hydrateFromTruck(rig, owned) {
  rig.truckId = owned.id;
  rig.typeId = owned.type_id;
  rig.type = owned.type;
  rig.cd = owned.custom_data || {};
  // The component bag first, and the headline number derived from it — never the other way round.
  rig.dmg = damageOf({ cd: rig.cd, condition: owned.condition });
  rig.condition = overall(rig.dmg);
  // The dirt comes back with the truck. It is READ off the bag and never derived from anything —
  // unlike `dmg`, which falls back to `condition` for a truck that predates components, a truck
  // that predates this is genuinely clean, because nothing had been dirtying it.
  rig.grime = grimeOf(rig.cd);
  rig.params = effTruckParams(owned.type_id, rig.cd, rig.condition, rig.dmg);
  rig.burnMul = burnMul(rig.cd);           // a hard turbo drinks; the aux tank is on `params.tank`
  rig.fuel = owned.fuel ?? 1;
  rig.travelled = 0;
  // `|| null` because `shape()` returns undefined for no row, and `mountRig` declares this field
  // null — a rig whose bobtail state is spelled two different ways is a rig two readers can
  // disagree about.
  rig.trailer = (await trailerOnTruck(owned.id)) || null;
  // The load rides with the box: cargo lives on the TRAILER row, so a restored trailer that
  // dropped its freight would be a quieter version of the same bug.
  if (rig.trailer?.cargo) rig.cargo = rig.trailer.cargo;
  return rig;
}
async function cmdDrive(args, raw, player) {
  if (rigOf(player)) return say('You are already behind the wheel.');

  // Already out in the waste on foot? Then there is a rig at the roadhead, as before — somebody
  // who walked out and thought better of it shouldn't have to walk back for a truck.
  if (player._crossing) return mountOnCrossing(player);

  // ── YOU START INSIDE THE SHED, AND YOU DRIVE OUT OF IT ─────────────────────
  // This used to mount on the APRON and walk you out, and the reasoning was sound as far as it
  // went: a bay is a room at grid 0,0 with no surface under it, and a building is solid, so there
  // was nowhere inside to put a forty-tonne truck. What that bought was a rig that teleported
  // through its own wall — the door was a sentence in the log and the first frame was already on
  // the road.
  //
  // Both halves of the objection turn out to be answered by things that already exist:
  //
  //   • the bay has no coordinates, but its FACADE does. The building's own tile is a real piece of
  //     world you can stand a truck on; standing on it IS standing inside the shed, and the drawing
  //     pass already excuses a tile carrying `bt` from the own-tile skip (windshield.js), so the
  //     shed is drawn around you rather than vanishing because you are on it.
  //   • buildings are solid, but `groundObstructionAt` has always had exactly one hole in it: a
  //     tile marked `bay` is not solid to a truck. That mark is derived from `flags.vehicle_bay`
  //     and, until now, NOT ONE ZONE IN THE WORLD AUTHORED IT — the mechanism for driving into a
  //     shed was built, commented, and never given any content. The five depot facades carry it now.
  //
  // So the whole change is: mount on the door tile, face the way out, and let the player drive.
  // Nothing is exempted from collision — the walls either side of you are as solid as they ever
  // were, and the bay tile is open because it is authored open. Aim badly and you hit the shed.
  const stood = getZone(player.current_zone);
  const bay = depotAt(stood);
  const yardId = bay ? yardIdOf(stood, bay) : null;
  // THE DOOR TILE — the shed as the WORLD has it, which is the building you are standing inside.
  // The bay itself is a room at grid 0,0 with no surface under it, so it can never be the thing a
  // truck sits on; its `world_exit_zone` is the facade, and the facade is a real tile with real
  // coordinates that happens to have a building on it. That tile is where the rig has been parked
  // all along, and it is now where you get into it.
  // `mountSpot` is the whole decision, and it lives up by the depot helpers so regress can hold it
  // to account without buying a truck first.
  const spot = mountSpot(stood);
  const door = spot?.fromShed ? spot.zone : null;
  const here = spot ? spot.zone : stood;
  const depot = bay || depotAt(here) || bayForYard(stood?.id)?.depot;
  if (!depot) {
    return say("There's nothing to drive here. Rigs run out of the freight yards — find a depot with a truck in it.");
  }
  if (here.grid_x == null) return say('There is no road out of this yard.');

  // OWNERSHIP IS THE GATE. Phase 1 handed anybody a free rig because the question then was whether
  // the DRIVE was worth doing. It is — so the question now is whether the run is worth OWNING, and
  // that only bites if the truck cost you something you could have spent elsewhere.
  // The bay AND its apron: a truck you left standing outside the door is a truck at this depot.
  const zonesHere = bay ? depotZonesOf(stood, bay) : depotZonesOf(here, depot);
  const parked = await trucksAt(player.id, zonesHere);
  // WHICH ONE. `drive` takes the plate, the model or the id — and takes nothing at all when there
  // is only one truck in the yard, which is the case this verb spends most of its life in. The
  // panel's CLIMB IN button carries the id of the truck on the turntable, so clicking is never
  // ambiguous however many are standing behind it.
  const want = (args || []).join(' ').trim();
  const owned = pickParked(parked, want);
  if (!owned && parked.length) return whichTruckLine('drive', parked, want);
  if (!owned) {
    const mine = await fleetOf(player.id);
    const elsewhere = mine.find(t => t.depot_zone && !zonesHere.includes(t.depot_zone));
    if (elsewhere) {
      const z = getZone(elsewhere.depot_zone);
      return say(`Your ${elsewhere.type.name} is parked at ${z ? (depotAt(z)?.name || z.name) : 'another yard'}, not here.`);
    }
    return say(`You don't own a truck. There's a dealer's line at the fence — see the ${teachVerb('yard', 'yard')}.`);
  }

  // IMPOUNDED. The truck is right there and it is not yours to take — which is the whole of what an
  // impound lot is. Paying is `drive` again, so there is no verb to discover: the thing you were
  // already trying to do tells you the price and then does it.
  if (owned.impound_fee) {
    const paid = await releaseImpound(player, owned);
    if (paid && !paid.released) return paid;      // could not afford it — the truck stays put
    if (paid) sendToPlayer(player.id, paid);
  }

  // A DERELICT ARGUES ABOUT IT FIRST. Never a refusal — a truck that simply will not start strands
  // a player at a yard with their money tied up in it and nothing to do, which is a punishment with
  // no play in it. It is a delay and a noise, and it is the last warning before the bench.
  //
  // ⚠ THE ROLL IS AT THE MOUNT; THE LINE WAITS FOR THE KEY. It used to fire here, which was honest
  // while mounting started the engine and is a lie now that it does not — a truck that has not been
  // started cannot be turning over. So the outcome is stashed on the rig and spent by whichever
  // rung actually starts it: the text rung a few lines down, where pulling out IS the start, or the
  // visual rung's first catch (see cmdTruckSync, which already learns the ignition from telemetry).
  const hardStart = startTrouble(owned.condition);

  // ⚠ WHERE IT STANDS AND WHERE IT LIVES ARE TWO DIFFERENT ANSWERS, and only the first one moved.
  // `x`/`y` are the door tile now, because that is where the truck physically is. `depot` is the
  // bookkeeping — which yard this rig belongs to, what `park` writes and what every ownership
  // lookup matches on — and it stays the YARD exactly as before. Passing the door tile here would
  // have quietly re-homed the truck to a zone no `depotZonesOf` pair contains, and the symptom
  // would have been "you don't own a truck here" while sitting in it.
  // ⚠ `spot?.heading`, not `spot.heading`. `mountSpot` can still answer null — a depot authored
  // somewhere this cannot resolve — and `standStock` below has ALWAYS written it as an optional
  // chain with a default. The two lines disagreed about whether the same value could be missing,
  // and this was the one that threw.
  const rig = mountRig(player, { x: here.grid_x, y: here.grid_y, heading: spot?.heading ?? 180, depot: yardId || here.id });
  rig.zoneId = here.id;
  rig._hardStart = hardStart;      // spent by whichever rung actually turns the key — see above
  // ⚠ AND ANYTHING WITHOUT A PLACE GETS ONE FIRST. A box with no pose is on every list in the game
  // and on no picture in it, so the yard walks it out onto the hardstand before the standing set is
  // read — see standStock. Nothing to move is the ordinary case and costs one query.
  // ⚠ THE BAY, NOT `here`. `here` is the DOOR TILE by this point (see the ⚠ above), and the box
  // with no place is usually sitting in the room behind it — which is the one zone in the set that
  // has no coordinates and so could never have been drawn from.
  // …and BOTH tiles come from `depotFrom` rather than from `yardId`, which is null whenever you are
  // stood on the apron rather than in the shed — the case where you are looking straight at the
  // empty hardstand the box should be standing on.
  const yardCtx = depotFrom(stood?.id);
  await standStock(yardCtx?.bay || null, standPlaces(yardCtx?.bay, depot), spot?.heading ?? 180);
  // WHATEVER IS STANDING AT THIS DEPOT, so it is drawn from the first frame. Both tiles, because
  // you mount on the DOOR and the stock stands on the HARDSTAND — one refresh meant a driver
  // starting the engine looked out at an empty yard until the wheels crossed the boundary.
  await Promise.all([...new Set([here.id, yardId].filter(Boolean))].map(z => refreshStanding(z)));
  // WHAT YOU BOUGHT IS WHAT YOU DRIVE — see hydrateFromTruck. It is a function rather than a block
  // here because the CROSSING mount needs the identical thing and used to do none of it.
  await hydrateFromTruck(rig, owned);

  // UNLOCKED BY GETTING IN, because you have the key — a lock the owner has to spend a verb on is a
  // lock that is only ever an obstacle to the person it belongs to. `park` sets it again on the way
  // out, so the stored state is simply "is anybody in it".
  rig.locked = false;
  setPosture(player, 'driving');
  // ⚠ THIS MOVES YOU INTO THE SHED, NOT OUT OF IT, and that inversion is the whole feature. It used
  // to walk the player to the apron so the first frame was already on the road; now it puts them on
  // the door tile — inside the building, engine running, nose pointed at the daylight — and the
  // drive out is something the player does with the throttle. `driveToZone` is still the mover for
  // the same reason it always was: it runs AFTER the rig exists, so the move gate sees a driver
  // rather than a pedestrian walking out of a door.
  //
  // `fromShed` still means "the truck had to be got out of somewhere", which is what the roller
  // door narrates; it is just that now the door is in front of you rather than behind you. A driver
  // who left the rig on the apron and typed `drive` from there is already outside and gets no door.
  const fromShed = !!(bay && here === door && door.id !== player.current_zone);
  if (fromShed) driveToZone(player, rig, door.id);
  else if (bay && yardId && yardId !== player.current_zone) driveToZone(player, rig, yardId);

  // THE MINIGAME AXIS (docs/systems-display-mode.md). Delete the cab and the player is not reading
  // less, they are STUCK — they cannot make the run at all — so this is `prefersTextMinigames`,
  // not `prefersLoggedPanels`. A text driver gets a real drive that the server runs, using the
  // same `stepTruck` and the same transitions; see textdrive.js.
  if (await prefersTextMinigamesOrDefault(player)) {
    // HAND THE PANE BACK. The visual rung closes the depot implicitly — `truck_sim` is a pane owner
    // and the client's handler closes the depot before opening the cab. This rung sends no payload
    // at all, so without this the depot panel sits over the whole run: the rig is mounted, `drive`
    // answers "already behind the wheel", and the player is looking at a shop window they cannot
    // leave. A text driver's road is the LOG, so the pane must be given back to the room.
    sendToPlayer(player.id, { type: 'truck_depot_close' });
    // A TEXT DRIVER HAS NO IGNITION, so pulling out is the start — the rung's own prose has always
    // said the diesel catches, and there is no switch anywhere on it to disagree with. Set before
    // the narration so the cold-start line below tells the truth.
    rig.engineOn = true;
    if (rig._hardStart) { rig._hardStart = false; sendToPlayer(player.id, { type: 'emote', message: HARD_START_LINE }); }
    const dest = rig.cargo?.to || defaultRunTarget(here);
    startTextDrive(player, rig, { arrive, leaveTheMap });
    setTextTarget(player.id, dest);
    // The roller door, at this rung, is a SENTENCE — the same beat the cab plays as a cinematic.
    // Whichever rung you are on, the run starts with the shed opening in front of you.
    const doorLine = fromShed
      ? ' The roller door grinds up in front of you, a bar of daylight at a time, and the yard is out there waiting.'
      : '';
    return say(`<span class="text-green">You haul yourself up into the cab. The diesel catches on the second turn and the whole frame starts to shake.${doorLine}</span>\n<span class="text-dim">She holds the road; the box is yours. <b>revs up</b> / <b>revs down</b> to shift, <b>boot</b>, <b>cruise</b>, <b>coast</b>, <b>brake</b>, <b>jake</b> on a descent. <b>park</b> to pull over, <b>haul</b> and <b>market</b> at a yard.</span>`);
  }

  // ⚠ THE TYPE GOES AFTER THE SPREAD. `cabContext` carries its own `type: 'truck_ctx'` (it is the
  // per-tick push), so writing the type FIRST let the spread overwrite it — the mount message went
  // out as an ordinary context update, the client's `truck_ctx` handler saw no cab open, returned
  // on its first line, and the windscreen never appeared. No error, no console line, nothing: you
  // were mounted, you were on the apron, and `drive` answered "you are already behind the wheel".
  // OUT THROUGH THE ROLLER DOOR. `fromBay` is the one fact the cab cannot work out for itself:
  // whether you turned the key INSIDE a shed or standing on the hardstand. The rig is on the apron
  // either way — a bay is a building and buildings have no grid coordinates to put a truck on — so
  // the shed is drawn in the CAB rather than in the world: an interior, a door, and a bar of
  // daylight widening across the hood until the glass is the yard. It costs the world model
  // nothing and it is the difference between a run that begins and a run that is simply on.
  sendToPlayer(player.id, { ...cabContext(rig, { mounted: true, fromBay: fromShed ? (depot.name || 'the shed') : null }), type: 'truck_sim' });
  const rollUp = fromShed
    ? ` The roller door grinds up in front of you, a bar of daylight at a time.`
    : '';
  return say(`<span class="text-green">You haul yourself up into the cab and pull the door to. It is cold in here and nothing is running — the key is in the barrel where you left it.${rollUp} ${depot.name ? `${depot.name}'s` : 'The yard'} gate is open, and the road runs south.</span>`
    + `
<span class="text-dim">Turn the key — <b>K</b>, or the barrel on the shelf — and hold it until she catches.</span>`);
}

// Where a text run heads when the deck is empty: the nearest depot in ANOTHER region, which means
// off the rim and across the waste. A driver with no load who wants to go somewhere is going to
// the other town, and making them say so would be ceremony.
function defaultRunTarget(here) {
  const other = allDepots().find(d => d.flags?.region_id !== here.flags?.region_id);
  if (other) return { target: other.id, wantsRim: true };
  const local = allDepots().find(d => d.id !== here.id);
  return { target: local?.id || here.id, wantsRim: false };
}

// A depot is any zone carrying `flags.truck_depot`. Content decides which; this only reads it.
//
// ⚠ THE FLAG IS AN OBJECT WITH A `yard`, AND NOTHING ELSE IS A DEPOT. There used to be two more
// shapes accepted here — a bare STRING, and an object with no `yard` — and between them they meant
// a depot could be a flag sitting on an open piece of hardstand with no building anywhere near it.
// That is not a lenient reader, it is a second depot design, and it shipped: two of the five depots
// were built that way and drew NO BUILDING AT ALL, because the renderer only extrudes a tile with a
// `building_type` and there was no tile to give one to. You stood in a yard, typed `drive`, and
// pulled out of bare ground.
//
// Both are gone, and the regress suite now asserts every authored depot resolves a real yard tile
// with grid coordinates — so the shape is a build failure rather than a silent second world.
function depotAt(zone) {
  const f = zone?.flags?.truck_depot;
  if (!f || typeof f !== 'object' || !f.yard) return null;
  return f;
}

// ── WHICH ONE OF YOURS ───────────────────────────────────────────────────────
// A yard used to hold at most one truck of yours, and the buy refused a second on the stated
// grounds that saying so was cheaper than a disambiguation prompt on every mount. It was — right
// up until owning a FLEET became the point. A yard is where a fleet lives; a rule that scattered
// six trucks across six towns so that `drive` never had to ask a question was the tail wagging the
// truck, and it made "own several" mean "own several, somewhere else".
//
// So the prompt exists now, and it is deliberately only ever a prompt: with one truck standing
// here NOTHING asks anything, which is the case every player who owns one truck is in forever.
// `want` is whatever the player typed after the verb — an id (what the panel's buttons carry),
// the plate they painted on the door, or any part of the model name. Ids first, because an id is
// exact and a plate is a thing somebody can call "hauler".
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
// The refusal, and it is a MENU rather than a complaint: every line is the command that picks that
// truck, because the rule this file is built on is that anything you can click you can type. A
// plate is offered when there is one, since that is what a driver actually calls it.
// `byId` is for the bench, where the plate is not a legal way to say it (see the ⚠ in rigBench):
// the truck is still NAMED in the label, because that is what the driver calls it, and only the
// command on the end of the line changes.
export function whichTruckLine(verb, list, want, byId = false) {
  const rows = list.map(t => {
    const label = t.name ? `<b>${t.name}</b> <span class="text-dim">(${t.type.name})</span>` : `<b>${t.type.name}</b>`;
    const arg = byId || !t.name ? t.id : t.name.toLowerCase();
    return `  ${label} — <span class="text-dim">${verb} ${arg}</span>`;
  }).join('\n');
  return say((want ? `Nothing of yours here answers to "${want}".` : `You have ${list.length} parked here. Which one?`) + `\n${rows}`);
}

// ── A DEPOT IS A BUILDING YOU WALK INTO ──────────────────────────────────────
// The depot used to be a flag on a piece of STREET, so the whole shop — a dealer's line, a freight
// board, a commodities exchange — bloomed over the road because you crossed a particular kerb.
// Nothing else in the game does that: a shop is a shop you go inside, and the hangar this system
// was modelled on has been a walk-in interior since the day it was written.
//
// So `flags.truck_depot` now belongs on the INSIDE of a garage, and it carries one more key:
//
//   flags.truck_depot = { name, yard: '<zone id>' }
//
// `yard` is the hardstand outside the roller door — a real, drivable street tile with grid
// coordinates. It is the ONE fact the bay cannot derive, because a building's own tile is solid
// (buildings are solid, and that is a law of this system: docs/systems-trucking.md) and a truck
// cannot be mounted on a zone that has no road under it.
//
// Everything downstream reads these two helpers rather than a zone id, which is what let the
// change stay small: a truck parked in the bay and a truck parked on the apron are one truck at
// one depot, and every lookup asks for the PAIR.
// ⚠ NO FALLBACK TO THE ZONE'S OWN ID. It used to read `depot?.yard || zone?.id`, which is what made
// the legacy shape work at all: a depot with no yard quietly became its own yard. On a real bay that
// silently mounts a forty-tonne truck inside a building — a tile with no grid coordinates and no
// surface under it — and the failure surfaces somewhere far away as a rig that cannot move. `yard`
// is the one fact a bay genuinely cannot derive, so a depot without one is unauthored, not flexible.
export const yardIdOf = (zone, depot) => depot?.yard || null;
// WHERE A BOX STANDS AT THIS DEPOT, and it is the SHED rather than the apron. The shed paints
// TRAILER down one side of its floor and numbered tractor stalls down the other; stock left
// outside made a liar of its own markings, and put the one thing you have to line up on out of
// frame the moment you climbed in — a driver mounts INSIDE the shed, facing the door.
//
// The bay itself is a room at grid 0,0, so the tile that is physically the shed is its facade —
// the same `world_exit_zone` a truck is parked on. A depot with no drivable shed (the legacy
// one-tile shape, and the fixtures) falls back to the apron, which is what every one of them did
// before there was a shed to stand anything in.
// …and it is a LIST, in preference order, because the shed holds two boxes and a fleet is bigger
// than two. Under the roof in the painted bays first; then the apron, in a rank along the fence.
// Both are the depot's own zones, so `hitch` reaches either without widening its search.
function standPlaces(bay, depot) {
  const shed = bay?.flags?.world_exit_zone ? getZone(bay.flags.world_exit_zone) : null;
  const yard = getZone(yardIdOf(bay, depot));
  const out = [];
  if (shed && shed.grid_x != null) out.push({ zone: shed, bays: true });
  if (yard && yard.grid_x != null && yard.id !== shed?.id) out.push({ zone: yard, bays: false });
  return out;
}
// ── WHERE A RIG IS STANDING WHEN YOU CLIMB INTO IT ───────────────────────────
// Pulled out of `cmdDrive` so it can be ASSERTED rather than trusted. It was four lines inline,
// which meant the one thing worth pinning — that you start inside the shed facing the way out, and
// not back on the apron — was reachable only by buying a truck and driving it, and so was pinned
// nowhere. A refactor could have quietly put the player back outside and nothing would have gone
// red. Pure: takes the zone you are standing in, returns the tile to mount on, which way to point,
// and whether a roller door is in front of you.
const OUT_HEADING = { north: 0, east: 90, south: 180, west: 270 };
export function mountSpot(stood) {
  // ⚠ ANY OF THE DEPOT'S THREE TILES, NOT JUST THE BAY — and asking `depotAt` alone is what made
  // `drive` do nothing after you parked.
  //
  // `depotAt` is true of the BAY and of nothing else. Walk into a depot and you are standing in the
  // bay, so this resolved and everything worked. But `park` leaves you on the APRON (the truck goes
  // under the roof; the driver climbs down where they stopped), so `stood` was the hardstand, this
  // returned null — and the caller then read `spot.heading` off it and threw. The panel came up
  // with a live 'Take it out' button on it, you pressed it, and nothing happened at all, because
  // the command died before it could even refuse.
  //
  // It is the same widening `depotZonesOf` already had to take, for the same reason and with the
  // ⚠ above it saying so: a depot is a PLACE of three tiles, and every question about it has to be
  // answerable from whichever of them you happen to be on. `depotFrom` is that lookup, and using it
  // here means parking and walking in now put you in exactly the same seat.
  const ctx = depotFrom(stood?.id);
  if (!ctx) return null;
  const { bay, depot } = ctx;
  const door = bay?.flags?.world_exit_zone ? getZone(bay.flags.world_exit_zone) : null;
  // A bay with a facade puts you INSIDE it. Anything else — a depot authored straight onto a road
  // tile, which is what the test fixtures are — mounts where it always did.
  if (door && door.grid_x != null) {
    const heading = OUT_HEADING[door.flags?.entrance];
    return { zone: door, heading: heading != null ? heading : 180, fromShed: true, depot };
  }
  const yard = getZone(yardIdOf(bay, depot));
  return { zone: (yard && yard.grid_x != null) ? yard : stood, heading: 180, fromShed: false, depot };
}
// ⚠ A DEPOT IS THREE TILES AND THIS USED TO NAME TWO OF THEM — the one you are standing on, and
// the depot's own `yard`. Standing IN the bay that was [bay, apron] and everything worked. Standing
// on the APRON it was [apron, apron]: the bay was not in the set at all, and `park` stores a truck
// in the BAY (see parkRig — a rig belongs under the roof, not on a public street). So parking at a
// yard and then trying to drive away from the hardstand answered "Your Ostrek Courier is parked at
// Kessler Street Yard, not here" while you were standing in Kessler Street Yard looking at it.
//
// The set is now the whole PLACE, whichever of its tiles you hand it: the shed, its facade — the
// door tile a driver mounts on, which `yardIndex` has resolved to its depot since the walk-in
// rebuild — and the hardstand outside. Every ownership lookup, the bench, the pump and the horn ask
// through here, so all of them agree about what "here" means for the price of one function.
export const depotZonesOf = (zone, depot) => {
  const bay = depotAt(zone) ? zone : (bayForYard(zone?.id)?.zone || null);
  const d = depot || depotAt(bay);
  return [...new Set([zone?.id, bay?.id, d?.yard, bay?.flags?.world_exit_zone].filter(Boolean))];
};
// The bay a yard tile belongs to — the reverse lookup, for prose on the apron and for `park`.
// MEMOISED, because the caller is `zone.describeRoom`: this answers a question asked every time
// anybody looks at any room in the game, and a full `getAllZones()` sweep per look is exactly the
// kind of quiet per-move cost the read-tier rules exist to keep out. The world's zones are static
// between reloads, so the index is built once and dropped when the world is.
let _yardIndex = null;
function yardIndex() {
  if (_yardIndex) return _yardIndex;
  _yardIndex = new Map();
  for (const z of getAllZones()) {
    const d = depotAt(z);
    if (!d?.yard) continue;
    _yardIndex.set(d.yard, { zone: z, depot: d });
    // ⚠ THE DOOR TILE IS A PLACE PLAYERS STAND NOW, so it has to resolve to its depot like the
    // apron does. `drive` mounts the rig on the facade, inside the shed — and every depot verb
    // (`hitch`, `haul`, `market`, `yard`) reaches its depot through this index, so without the
    // facade in it a driver sitting in the bay with the engine running was, as far as all of them
    // were concerned, nowhere near a depot at all. One more key, same object: the shed, its door
    // and its hardstand are three tiles and one place.
    if (z.flags?.world_exit_zone) _yardIndex.set(z.flags.world_exit_zone, { zone: z, depot: d });
  }
  return _yardIndex;
}
export const resetDepotIndex = () => { _yardIndex = null; };
const bayForYard = (zoneId) => (zoneId ? yardIndex().get(zoneId) || null : null);
// The depot reachable from a zone id, from ANY of its three tiles — the same answer `depotHere`
// gives a player, without needing one. Exported through _test so the reachability can be asserted.
function depotFrom(zoneId) {
  const z = getZone(zoneId);
  const direct = depotAt(z);
  if (direct) return { bay: z, depot: direct, yard: getZone(yardIdOf(z, direct)) || z };
  const via = bayForYard(zoneId);
  if (via) return { bay: via.zone, depot: via.depot, yard: getZone(via.depot.yard) || z };
  return null;
}
// ── THE DOOR TO THE BUNKROOM ─────────────────────────────────────────────────
// `flags.truck_bunkroom` has been authored on all five depot bunkrooms since they were built and
// read by absolutely nothing — the "owner —" case docs/flags-keys.md exists to record. This is the
// reader, and the flag is now load-bearing.
//
// ⚠ DERIVED FROM THE EXITS, never from a table of directions. Four of the five bunkrooms are north
// of their shed and the Last Load's is east of it, so a constant would have been right four times
// out of five and wrong in the one place nobody would have re-checked. It is also what makes a
// sixth depot work with no code at all: author the flag, hang the door, and the button is there.
function bunkFrom(zone) {
  for (const [dir, id] of Object.entries(zone?.exits || {})) {
    const z = getZone(id);
    if (z?.flags?.truck_bunkroom) return { dir, id, name: z.name };
  }
  return null;
}

// EVERY PILE OF BOXES ONE DEPOT OWNS. A trailer sits in exactly one zone and a truck can only stand
// in two of the three, so `hitch` has to search the set rather than the tile — see the ⚠ in cmdHitch
// for what that cost. Factored out so the verb and the regress case cannot drift apart.
function hitchZones(zoneId) {
  const ctx = depotFrom(zoneId);
  if (!ctx) return [zoneId].filter(Boolean);
  return [...new Set([zoneId, ctx.bay?.id, ctx.yard?.id, ctx.bay?.flags?.world_exit_zone].filter(Boolean))];
}

// The legacy path: mount on a crossing you are already walking. Unchanged behaviour, moved aside so
// `drive` reads as the depot verb it now is.
async function mountOnCrossing(player) {
  const live = player._crossing;
  const info = crossingInfo(live.instanceId);
  if (!info) return say('The road will not resolve. Try the crossing on foot.');
  const destKey = info.dests?.[0]?.key;
  if (!destKey) return say('The road out of here goes nowhere anyone has charted.');
  const chain = crossingChain(live.instanceId, destKey);
  if (!chain.length) return say('The road will not resolve. Try the crossing on foot.');

  // ⚠ YOUR TRUCK, IF YOUR TRUCK IS THE ONE STANDING HERE. This path is named for the legacy case —
  // a rig left at the roadhead with the keys in it — and it built that fiction unconditionally: a
  // bare `mountRig` with no truck id, no type, no damage, no fuel and, the symptom that surfaced
  // it, NO TRAILER. So a driver who stopped out on the void road, climbed down and climbed back up
  // got a generic tractor and an empty fifth wheel, while their own box sat in the database still
  // correctly believing it was hitched to a truck nobody was driving.
  //
  // `drive` reaches this branch BEFORE the depot path (see its first lines), so the depot path's
  // restore could never run out here. Parking mid-crossing writes the void room as the truck's
  // `depot_zone` — a healthy rig stops exactly where you left it, and only a broken or dry one is
  // handed to a recovery yard — so the truck that belongs to this driver in this room is exactly
  // what `trucksAt` answers, and hydrating from it restores all of the above at once.
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
  sendToPlayer(player.id, { ...cabContext(rig, { mounted: true }), type: 'truck_sim' });   // type AFTER the spread — see cmdDrive
  // Two different sentences, because they are two different events: getting back into YOUR truck
  // out on the road is not finding one abandoned at the roadhead with the keys in it.
  return say(mine
    ? `<span class="text-green">You climb back up into the ${mine.name || 'cab'}, and the diesel catches on the second turn.</span>`
      + (rig.trailer ? ` <span class="text-dim">The ${rig.trailer.name} is still on the pin behind you.</span>` : '')
    : '<span class="text-green">There is a rig at the roadhead with the keys still in it. You climb up, and the diesel catches on the second turn.</span>');
}

// ── haul ─────────────────────────────────────────────────────────────────────
// The job board. A depot offers loads bound for the OTHER depots it knows about, seeded per depot
// per game-day so the board is the same for everyone that day and doesn't reroll on a re-read.
// This is deliberately not the flight contracts board: those price by air distance and bind to an
// aircraft. What is borrowed is the SHAPE — archetypes rolled into concrete instances, paid on
// delivery — not the code, because a truck's economics are weight and road miles, not fuel burn
// and rental meters.
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
  // PHASE 4 — THE CITY IS A DESTINATION, not just the road to the rim.
  //
  // Until now a board could only send you to another YARD, and there are three of those in the
  // world, two of which are across the waste. So the city was a corridor: you drove through it to
  // get to the edge of the map and you never had a reason to go anywhere IN it.
  //
  // A loading dock is a business that takes deliveries — `flags.loading_dock`, content-authored
  // exactly as a depot is, on the drivable street tile outside a building. Docks in THIS REGION are
  // mixed into the board beside the crossings, which does three things at once:
  //
  //   • it makes the city a map you navigate rather than a strip you traverse,
  //   • it gives the fleet ladder a bottom rung — a local run pays little, needs no crossing, and
  //     is affordable in a Barrow with a flatbed, which is the whole entry kit,
  //   • and it means `market` is no longer the only thing to do with a truck you cannot yet afford
  //     to take across the waste.
  //
  // Nothing about delivery changed to allow it: `deliver` already keys on a ZONE ID, so a dock is a
  // destination for free. That is the payoff for having written it that way.
  const here = getZone(zoneId);
  const docks = allDocks().filter(d => d.flags?.region_id === here?.flags?.region_id);
  const dests = [...allDepots().filter(d => d.id !== zoneId), ...docks];
  if (!dests.length) return [];
  // ONE SLOT IS ALWAYS A CROSSING, if a crossing is possible at all.
  //
  // Adding docks nearly broke the system by accident: there are six of them in Coldwater against
  // one other depot, so a seeded four-slot board came up ALL LOCAL and a player standing in the
  // yard was never offered the run across the waste. The waste run is the game; being shown it has
  // to be a certainty rather than a dice roll, or a whole day's board can quietly hide the thing
  // the whole system is for. (Caught by the regress suite, which could no longer find a crossing to
  // take — the failure and the bug were the same fact.)
  const far = dests.filter(d => d.flags?.region_id !== here?.flags?.region_id);
  const out = [];
  for (let i = 0; i < 4; i++) {
    const l = LOADS[Math.floor(rng() * LOADS.length) % LOADS.length];
    const pool = (i === 0 && far.length) ? far : dests;
    const to = pool[Math.floor(rng() * pool.length) % pool.length];
    // Long hauls pay more, and a load that crosses the waste pays a great deal more — the risk is
    // real and the alternative (a short in-town run) has to stay the safe, boring option.
    const crosses = to.flags?.region_id !== getZone(zoneId)?.flags?.region_id;
    // The board names the YARD, not the street it stands on — a bill of lading says "The Last
    // Load", not "The Reach 871,1958".
    // A LOCAL RUN PAYS LOCAL MONEY, and deliberately not much. It is the bottom rung: safe, dull,
    // and the thing you do while you save up for a box big enough to make the crossing worth it. If
    // in-town work paid well nobody would ever cross the waste, and the waste is the game.
    const local = !!dockAt(to);
    out.push({ i, name: l.name, kg: l.kg, to: to.id, toName: dockAt(to)?.name || depotAt(to)?.name || to.name,
      pay: Math.round(l.pay * (crosses ? 2.6 : local ? 0.35 : 1)), crosses, local,
      // The bill of lading names the STREET for a dock, because that is how you find it — a depot
      // is a place everybody knows and a dock is an address.
      where: local ? to.name : null });
  }
  return out;
}
// A DEPOT, TO EVERYTHING THAT ISN'T THE SHOP, IS ITS YARD. Freight boards, delivery checks, the
// text driver's default target and the crossing all want somewhere a TRUCK can be, and since the
// depot moved indoors that is never the room with the flag in it — a bay has no grid coordinates
// and no road under it. So this resolves each bay to its apron and returns THAT, which is why
// nothing downstream of it needed changing when the shop went inside.
function allDepots() {
  const out = [];
  for (const z of getAllZones()) {
    const d = depotAt(z);
    if (!d) continue;
    const yard = d.yard ? getZone(d.yard) : z;
    if (yard?.grid_x != null && !yard.flags?.is_interior) out.push(yard);
  }
  return out;
}
// A dock is any zone carrying `flags.loading_dock`. Content decides which; this only reads it —
// the same engine/content split as `truck_depot`.
function allDocks() {
  return getAllZones().filter(z => z.flags?.loading_dock && z.grid_x != null);
}
function dockAt(zone) {
  const f = zone?.flags?.loading_dock;
  if (!f) return null;
  return typeof f === 'object' ? f : { name: zone.name };
}

// ── WHAT IS BEING LOADED, AND IT IS NOT ALWAYS A RIG YOU ARE SITTING IN ──────
//
// `haul` and `market buy` both used to open with `if (!rig) return 'get in a truck first'`, where
// `rig` is a MOUNTED rig — a live object that exists only between `drive` and `park`. A truck
// standing in the bay with a box on the pin is not one, however many trailers you own.
//
// Which made the freight board and the exchange unusable from the one place they are displayed.
// The depot panel opens when you walk into a yard ON FOOT, which is exactly when there is no
// mounted rig; and mounting CLOSES it (`drive` sends truck_depot_close — the cab and the depot are
// both pane owners). So the surface that showed you the board could only be seen in the state where
// every one of its buttons refused, and the state where they worked was the one where the board was
// not on screen. Every button was a legal verb string aimed at a player who could not be looking at
// it. The verbs were right; the question they asked was wrong.
//
// So the question is now "what is there to load HERE", and a truck standing in front of you is a
// real answer. That is also the model the rest of the depot already uses — `rig repair` works on a
// parked truck and REFUSES one you are sitting in ("Climb down first") — so before this the two
// halves of the same building disagreed about where a driver was supposed to be standing.
//
// ⚠ THE LOAD LIVES ON THE TRAILER ROW, WHICH IS WHY THIS IS POSSIBLE AT ALL. `rig.cargo` is a RAM
// copy hydrated at mount (`hydrateFromTruck`: a restored trailer brings its freight back with it),
// so writing the box's own row IS loading the truck — the next person to turn the key finds it on
// there. There is no second store to keep in step and nothing to flush.
async function loadDeck(player) {
  // Behind the wheel: exactly what it always was, unchanged, and it stays first — a driver sitting
  // in a rig is unambiguous and must never be asked which truck they mean.
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
  // A BOX IS WHAT MAKES A TRUCK A CANDIDATE, so the disambiguation is over the trucks that can
  // actually take a load rather than over everything you happen to own — being asked to choose
  // between two rigs when only one of them has a trailer on it is a question with one answer.
  const withBox = [];
  for (const t of parked) {
    const tr = await trailerOnTruck(t.id);
    if (tr) withBox.push({ truck: t, trailer: tr });
  }
  if (!withBox.length) {
    return { err: say(`Every truck in this yard is bobtail — there is nothing behind one to put it on. <b>${teachVerb('hitch', 'hitch')}</b> a trailer first.`) };
  }
  if (withBox.length > 1) {
    return { err: say('More than one rig here is hitched up. Take the one you mean out yourself — '
      + `<span class="text-dim">${withBox.map(w => `drive ${w.truck.id}`).join(' · ')}</span>`) };
  }
  const { truck, trailer } = withBox[0];
  return { mounted: false, truck, trailer, cargo: trailer.cargo, label: truck.name || truck.type.name };
}

// The one write. Mounted, it is the RAM field the drive reads and the cab paints; parked, it is the
// trailer's own row — which is the same place the mounted path's copy came from and will be flushed
// back to, so the two rungs cannot disagree about what is on the deck.
// ⚠ AND IT RE-PUSHES ONTO THE TAB THE CLICK CAME FROM. It always said 'freight', which is right for
// `haul` and wrong for `market buy` — buying a load on the Exchange threw the panel onto the
// freight board, so the one screen that could have shown you the goods you just bought was the one
// screen the purchase navigated away from.
async function setDeckCargo(player, deck, cargo, tab = 'freight') {
  if (deck.mounted) {
    deck.rig.cargo = cargo;
    // ⚠ AND THE BOX ROW TOO, WHEN THERE IS ONE. Cargo is the trailer's, and a load taken at a bench
    // that lived only in RAM would be gone if the server restarted before the driver parked.
    if (deck.rig.trailer) {
      deck.rig.trailer.cargo = cargo;
      await saveLoad(deck.rig.trailer.id, cargo, deck.rig.trailer.stash);
    }
    pushCab(deck.rig);
    return;
  }
  deck.trailer.cargo = cargo;
  await saveLoad(deck.trailer.id, cargo, deck.trailer.stash);
  // The panel is the surface this was clicked on, so it is the surface that has to show the result
  // — the same rule every other bench commit follows (see the note on `repush`).
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
      `  <b>${b.i + 1}.</b> ${b.name} — <b>${b.kg} kg</b> to <b>${b.toName}</b>${b.crosses ? ' <span class="text-amber">(across the waste)</span>' : b.local ? ` <span class="text-dim">(in town — ${b.where})</span>` : ''} · <span class="item-grant">${b.pay}₵</span>`);
    return { type: 'emote', message: `<b>${here.name} — freight board</b>\n${lines.join('\n')}\n<span class="text-dim">haul &lt;number&gt; to take one.</span>` };
  }
  const job = board[pick - 1];
  if (!job) return say('No such load on the board.');
  // WHAT IS THERE TO LOAD — a rig you are sitting in, or a hitched truck standing in this yard.
  // See the note on `loadDeck`: this used to demand a mounted rig, which is the one state you
  // cannot be in while looking at the board.
  const deck = await loadDeck(player);
  if (deck.err) return deck.err;
  if (!deck.trailer) return say(`You are bobtail — there is nothing behind you to put it on. <b>${teachVerb('hitch', 'hitch')}</b> a trailer first.`);
  if (deck.cargo) return say(`Already loaded: ${deck.cargo.name}${deck.cargo.toName ? `, for ${deck.cargo.toName}` : ''}.`);
  // ⚠ AND THE BOX HAS TO TAKE IT. The mounted path never checked, because there was no way to be
  // holding a contract the trailer could not carry — you took it in the cab of the truck that was
  // going to pull it. On foot you can be standing at a board with a small box on the pin, so the
  // rating is asked here rather than discovered at a weighbridge two regions away.
  if (deck.trailer.ratedKg && job.kg > deck.trailer.ratedKg) {
    return say(`${job.kg} kg on a box rated for ${deck.trailer.ratedKg}. It will not go on.`);
  }
  await setDeckCargo(player, deck, { ...job });
  return say(`<span class="item-grant">Loaded: ${job.name}. ${job.kg} kg, bound for ${job.toName}. ${job.pay}₵ on delivery.</span>`
    + (deck.mounted ? '' : ` <span class="text-dim">It is on the ${deck.label}, waiting for you to take it out.</span>`));
}

// Paid on arrival, at the depot the load names. The credit is the only DB write on the whole haul
// besides the coalesced zone flush — everything else lived in RAM.
async function deliver(player, rig) {
  const job = rig.cargo;
  if (!job) return { type: 'noop' };
  rig.cargo = null;
  rig.speed = 0;
  player.credits = (player.credits || 0) + job.pay;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  pushCab(rig, { stopped: true });
  sendToPlayer(player.id, {
    type: 'emote',
    message: `<span class="item-grant">Backed onto the dock at ${job.toName}. Somebody signs for ${job.name} without looking up, and <b>${job.pay}₵</b> lands in your account.</span>`,
  });
  return { type: 'noop' };
}

// ── yard ─────────────────────────────────────────────────────────────────────
// The fleet view: what you own, and what the dealer has along the fence. Shaped on the hangar bay
// (plugins/flight/hangars.js buildCards) but RETURNED rather than pushed, like the cards machine —
// there is no race against a player who walked off mid-await.
async function cmdYard(args, raw, player) {
  const { bay, depot } = depotHere(player);
  if (!depot) return say('No yard here.');
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'buy') return await yardBuy(player, bay, depot, args[1], args.slice(2).join(' '));
  // ⚠ ONE VERB FOR BOTH, AND IT DECIDES BY WHAT THE ID NAMES. `yard sell` was trucks only, so a
  // trailer was a thing you could buy and never get rid of — and the box is the piece of kit you
  // are most likely to buy wrong, because the whole choice is a capacity number you have not run
  // yet. A second verb would have been a second thing to discover for the same act.
  if (sub === 'sell') return await yardSell(player, bay, depot, args[1]);
  // Fetching one home is the third thing a yard does with a truck, so it sits with buying and selling.
  if (sub === 'recall' || sub === 'fetch' || sub === 'tow') return await yardRecall(player, bay, args[1]);
  // …and painting a box, which is a different job from painting the cab that pulls it and is priced
  // as one. It lives on `yard` rather than on `rig` because `rig` takes a TRUCK and every one of
  // its eight named fields is a surface a box has not got: a trailer is one colour, once.
  if (sub === 'paint') return await yardPaintTrailer(player, bay, depot, args[1], args[2]);

  return await depotPanel(player, bay, depot, 'fleet', sub === 'text');
}

// The depot the player is at, from EITHER side of the roller door. Every depot verb goes through
// this rather than through `depotAt(current_zone)` — a driver who parked on the apron and a walker
// standing in the bay are both at the depot, and making them find the exact tile that carries the
// flag is the sort of invisible precondition that reads as a broken verb.
export function depotHere(player) {
  const here = getZone(player.current_zone);
  const direct = depotAt(here);
  if (direct) return { bay: here, depot: direct, yard: getZone(yardIdOf(here, direct)) || here };
  const via = bayForYard(here?.id);
  if (via) return { bay: via.zone, depot: via.depot, yard: here };
  return { bay: here, depot: null, yard: here };
}

// RE-PUSH AFTER EVERY MUTATION, and this is the fix for the oldest complaint about this screen:
// buying a truck WORKED and looked as though it had not. `yardBuy` charged you, wrote the row and
// returned a line of prose — while the panel sitting over the top of it still showed the same
// dealer card with the same Buy button, an empty fleet tab and a stale credit balance. The hangar
// has never had that problem because every one of its bench commands ends in `pushHangarBay`.
// Nothing here may end in a bare `say()` if it changed the world.
export async function repush(player, tab = 'fleet') {
  const { bay, depot } = depotHere(player);
  if (!depot) return;
  const panel = await depotPanel(player, bay, depot, tab);
  if (panel && panel.type === 'truck_depot') sendToPlayer(player.id, panel);
}

// THE FOUR BARS THE BENCH DRAWS, and they are derived from the drive's own parameter set rather
// than from a second table of marketing numbers. That is the whole point of routing every knob
// through `effTruckParams`: a bar that moves when a dial turns is promising the wheel, and the
// wheel is handed the same object. Each is normalised 0..1 against the fleet's own spread.
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

// ── The depot panel ──────────────────────────────────────────────────────────
// ONE screen for the whole yard: your fleet, the dealer's line, the freight board and the exchange.
//
// It was two panels behind two verbs, which was wrong twice over. A depot is one PLACE and the
// choice a player is making there is a single one — what do I drive, and what do I put in it —
// so splitting it across `yard` and `market` made them compare two screens to answer one question.
// And flight already had the answer: the hangar bay is one panel, and it OPENS WHEN YOU WALK IN
// (plugins/flight/index.js, on `zone.entered` where the zone is a hangar_interior) rather than
// waiting to be typed at. A depot is a hangar with the roof off; it behaves the same way now.
//
// The verbs survive as entry points, exactly as `hangar` does — walking in is the discovery path,
// typing is the deliberate one, and both land on the same screen.
async function depotPanel(player, hereIn, depotIn, tab = 'fleet', forceText = false) {
  // WHERE THE PANEL IS OPENED FROM IS NOT WHERE THE MARKET IS. A depot is two zones now — the bay
  // you are standing in and the apron outside its door — and every economic question (which region
  // is this, what is the freight board here) is a question about the PLACE, so it is answered from
  // whichever of the two carries the coordinates. The bay is the one with the panel in it; the yard
  // is the one with the road.
  const bay = depotAt(hereIn) ? hereIn : (bayForYard(hereIn?.id)?.zone || hereIn);
  const depot = depotIn || depotAt(bay);
  const yard = getZone(yardIdOf(bay, depot)) || bay;
  const here = yard.grid_x != null ? yard : bay;
  const zonesHere = depotZonesOf(bay, depot);
  // ⚠ BEFORE ANYTHING IS READ. Opening a yard is the other cold moment a box without a place can be
  // given one, and it has to happen ahead of `trailersOf` below or the panel lists this trailer as
  // being in a zone the write is about to change. See standStock for why a depot must not contain a
  // trailer that is nowhere.
  await standStock(bay, standPlaces(bay, depot), mountSpot(bay)?.heading ?? 180);
  const region = here.flags?.region_id;
  const day = marketDay();
  const mine = await fleetOf(player.id);
  const rig = rigOf(player);
  // Three reads the bench needs, and they go out TOGETHER rather than one after another — this
  // panel already makes four round trips against a remote Postgres and the auto-open path fires
  // from a footstep. (docs/architecture.md, read tiers: Promise.all independent reads.)
  const [fab, myTrailers] = await Promise.all([
    effectiveSkill(player, 'fabrication'),
    trailersOf(player.id),
  ]);
  const towedIds = new Set(myTrailers.filter(t => t.towedBy).map(t => t.towedBy));
  // ── WHAT THERE IS TO LOAD, WHICH IS NOT THE SAME QUESTION AS "ARE YOU DRIVING" ──
  // The board's buttons were gated on `driving`, and this panel opens when you walk into the yard
  // ON FOOT — so every one of them was greyed out on the only screen that shows them, and mounting
  // (which would ungrey them) closes the panel. See `loadDeck`: the verbs now load a hitched truck
  // standing here, and this is the same answer computed for the same panel so the button and the
  // verb agree about whether there is anywhere to put a load.
  //
  // It is derived from rows already in hand — `mine` and `myTrailers` are both fetched above — so
  // the honest answer costs no extra round trip.
  const hitchedHere = rig?.trailer ? null
    : mine.filter(t => zonesHere.includes(t.depot_zone) && towedIds.has(t.id));
  const panelTrailer = rig?.trailer
    || (hitchedHere?.length === 1 ? myTrailers.find(tr => tr.towedBy === hitchedHere[0].id) : null);
  const canLoad = !!panelTrailer;
  // Why not, in the words the verb would use — a disabled button that explains itself is the whole
  // reason this is a string rather than a boolean.
  const loadWhy = canLoad ? null
    : !mine.some(t => zonesHere.includes(t.depot_zone)) ? 'Nothing of yours is standing here'
    : hitchedHere && hitchedHere.length > 1 ? 'More than one rig here is hitched up — take the one you mean out yourself'
    : 'Every truck in this yard is bobtail — hitch a trailer first';
  // WHAT THE DECK HOLDS IS THE TRAILER'S RATING, not the truck's mass. It used to be the truck's,
  // because there was no trailer to ask — which meant buying a bigger tractor bought you capacity
  // it does not actually have. The truck pulls; the box carries.
  // ⚠ IT IS DECLARED AFTER `panelTrailer`, not up with the other reads. It used to sit above the
  // Promise.all, and moving the resolve below it left this reading a `const` in its temporal dead
  // zone — which is not a wrong number, it is a throw, and it took the whole plugin's suite down
  // with one line. If you move either, move both.
  const deckKg = panelTrailer?.ratedKg || rig?.type?.kg || DEFAULT_TRAILER_KG;
  // A pump is a property of the PLACE, and the place is two zones — a depot that keeps diesel
  // keeps it on the apron, which is the tile with the road on it.
  const pumpHere = pumpAt({ leg: 'city', zoneId: yard.id }) || pumpAt({ leg: 'city', zoneId: bay.id });
  const quotes = quotesFor(region, day);
  await rememberMarket(player, region, day, quotes);
  const seen = await recallMarkets(player);
  const otherEntry = Object.entries(seen).find(([r]) => r !== region);
  const other = otherEntry ? { region: otherEntry[0], ...otherEntry[1] } : null;

  const payload = {
    type: 'truck_depot',
    tab,
    depot: depot.name || here.name,
    region, regionName: regionLabel(region),
    credits: player.credits || 0,
    here: here.id,
    driving: !!rig,
    // …and whether anything here can TAKE a load, which is what the board's buttons are gated on
    // now. `driving` stays because other parts of the panel legitimately ask it (the cab handoff,
    // the fuel gauge); it just is not the question freight was asking.
    canLoad, loadWhy,
    fuel: rig ? +rig.fuel.toFixed(2) : null,
    deckKg,
    // The load itself comes off whichever deck this panel is talking about — the rig you are in, or
    // the box on the truck standing here. On foot this was always null, so the Sell button could
    // not appear for a load that was demonstrably sitting in the yard.
    cargo: (() => {
      const c = rig?.cargo || (rig ? null : panelTrailer?.cargo);
      // `slot` is the BOARD ROW this contract came off, so the freight screen can mark the one it
      // is already carrying instead of offering to take it again. It travels with the load because
      // the load is a copy of the job (`{ ...job }` in cmdHaul) — nothing new is stored for it.
      // ⚠ A board index means something different at every yard, which is why the client matches on
      // the name and the destination TOO rather than on this alone.
      return c ? { kind: c.kind, name: c.name, qty: c.qty || null, slot: c.i ?? null,
        kg: c.kg, to: c.toName || null, paid: c.unitPaid || null } : null;
    })(),
    // The two zones, so the client can say which side of the door it is showing and the log rung
    // can name the road you would roll out onto.
    bay: bay.id, yard: yard.id, yardName: yard.name, inBay: player.current_zone === bay.id,
    // ── AND THE THIRD ROOM, WHICH THIS PANEL NEVER MENTIONED ───────────────────
    // Every depot has a bunkroom off the shed and nothing on the screen said so, which made it a
    // room you found by trying directions at a wall. It is a button now.
    //
    // ⚠ THE DIRECTION IS MEASURED FROM WHERE THE PLAYER IS STANDING, not from the bay, because the
    // button sends a real movement command (rule 2 — every button here is something you could have
    // typed) and a direction that is right for the shed is a wall from the apron. On the apron the
    // door is still reported, with `here: false`, so the chip can go dim and SAY where it is rather
    // than vanishing — the same "a disabled button that explains itself" the freight tab uses.
    bunk: (() => {
      const inRoom = bunkFrom(getZone(player.current_zone));
      if (inRoom) return { ...inRoom, here: true };
      const viaBay = bunkFrom(bay);
      return viaBay ? { ...viaBay, here: false } : null;
    })(),
    fab,                                    // the hand doing the work — it sets how far the dials go
    // ── THE COSMETIC CATALOGUE, ONCE ───────────────────────────────────────────
    // Static data — twenty rows that never change — sent at the PAYLOAD level rather than per
    // truck, because a fleet of six would otherwise carry six identical copies of it. It is here
    // rather than duplicated in the client for the reason every other catalogue in this system is:
    // the price the panel prints has to be the price the verb charges, and the descriptions are
    // written once, in the file that owns them.
    fitCat: { slots: SLOTS, items: FIT_IDS.map((id) => ({ id, ...FITTINGS[id] })) },
    fleet: mine.map(t => {
      const cd = t.custom_data || {};
      const kits = installedKits(cd);
      const band = bandOf(t.condition ?? 1);
      const towed = towedIds.has(t.id);
      return {
        id: t.id, name: t.name || t.type.name, type: t.type.name, typeId: t.type_id,
        // What the 3D floor and the wireframes draw: the mesh key, trailer included when there is
        // one on the pin. The panel never decides this — a rig with a box is a different silhouette
        // and that is a fact about the truck, not a presentation choice.
        // …AND WHAT IS BOLTED TO IT. Same suffix, same grammar, same one channel — so the rig on
        // the depot floor is the rig out of the windscreen without the panel knowing what a
        // fitting is.
        variant: `${t.type_id}${towed ? '+t' : ''}${fitSuffix(cd)}`,
        kg: t.type.kg, tank: t.type.tank, top: t.type.topSpeed, price: t.type.price,
        fuel: +(t.fuel ?? 1).toFixed(2), odometer: Math.round(t.odometer || 0),
        hereNow: zonesHere.includes(t.depot_zone),
        whereName: zonesHere.includes(t.depot_zone) ? null : depotNameOf(t.depot_zone),
        // What the low-loader wants for bringing it home, impound included. Sent as a FACT for the
        // same reason every other price on this screen is: the button prints what the verb charges.
        recall: zonesHere.includes(t.depot_zone) ? 0 : towFee(t.type, t.depot_zone, bay.id) + (t.impound_fee || 0),
        resale: resaleValue(t.type, t.odometer, t.condition, damageOf({ cd, condition: t.condition })),
        impound: t.impound_fee || 0,
        // ── the bench half ──
        condition: +(t.condition ?? 1).toFixed(3), band: band.key, bandLabel: band.label, bandText: band.text,
        tune: { gearing: 0, boost: 0, suspension: 0, brakes: 0, ...(cd.tune || {}) },
        // ⚠ NORMALISED ON READ, NEVER MIGRATED ON WRITE. A truck painted before the model widened
        // carries {base, trim, flash, chrome} and nothing else, and every reader downstream — the
        // panel's four pickers, the renderer's hardware and box colours — would find undefined
        // where a colour should be. Reading through sanitizePaint fills them from the defaults,
        // which by construction reproduce exactly what that truck has always been drawn as, so no
        // row has to be rewritten and nothing changes colour on the day this ships.
        kits, paint: sanitizePaint({}, cd.paint || {}),
        // THE INSIDE OF THE PAINT JOB, resolved rather than raw. A truck nobody has retrimmed
        // stores null and WEARS its tier's stock interior, so a panel handed the raw value would
        // draw an unpainted dash and tick no swatch — the trim tab would open on a truck that,
        // according to it, has no interior. Resolving here is the same decision the paint above
        // makes for the same reason, and it is the one place that knows the tier.
        trim: { ...truckStockTrim(t), ...sanitizeTrimResolved(cd.trim) },
        trimPrice: trimCost(t.type),
        // HOW DIRTY, AND WHAT THE HOSE WANTS FOR IT. The live rig's number wins when this is the
        // truck somebody is sitting in, because the row's copy is only as fresh as the last park
        // and a driver who pulls into their own yard filthy must not be quoted for a clean truck.
        grime: +(rig?.truckId === t.id ? (rig.grime ?? 0) : grimeOf(cd)).toFixed(3),
        grimeBand: grimeBand(rig?.truckId === t.id ? (rig.grime ?? 0) : grimeOf(cd)).key,
        grimeLabel: grimeBand(rig?.truckId === t.id ? (rig.grime ?? 0) : grimeOf(cd)).label,
        grimeText: grimeBand(rig?.truckId === t.id ? (rig.grime ?? 0) : grimeOf(cd)).line,
        washPrice: washCost(rig?.truckId === t.id ? (rig.grime ?? 0) : grimeOf(cd)),
        // THE COSMETIC SHELF, as data the panel renders and never decides. Prices come through
        // `priceFor`, so a fitting already in this truck's drawer shows as free on the button for
        // the same reason the verb charges nothing for it — one answer, two surfaces.
        fits: installedFits(cd),
        fitPrices: Object.fromEntries(FIT_IDS.map((id) => [id, priceFor(cd, id)])),
        repairField: repairCost(t.type, t.condition ?? 1, false),
        repairShop: repairCost(t.type, t.condition ?? 1, true),
        canField: (t.condition ?? 1) < FIELD_CAP,
        // ⚠ THE PRICE OF THE PAINT IN FRONT OF YOU, not of the paint on the truck. The finish
        // moves the fee, so a bench that quoted the fitted job would show one number and charge
        // another the moment somebody chose flake — see paintCost. Base price too, because the
        // panel re-quotes locally while a dial is being turned and must not invent the scale.
        paintPrice: paintCost(t.type, cd.paint || PAINT_DEFAULT),
        paintBase: paintCost(t.type, { finish: 'gloss' }),
        refuel: Math.round((1 - (t.fuel ?? 1)) * FUEL_FULL),
        // The performance the panel graphs. Derived through the SAME function the drive uses, so a
        // bar that moves when you turn a dial is promising exactly what the wheel will deliver.
        stats: axesFor(t.type_id, cd, t.condition ?? 1),
      };
    }),
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
    // ── THE BOXES YOU OWN ──────────────────────────────────────────────────────
    // ⚠ THIS LIST EXISTED AND WAS NEVER SENT. `myTrailers` was read purely to work out which of
    // your TRUCKS had something on the pin, and the rows themselves went in the bin — so a player
    // who bought a reefer got a receipt, a box standing on the hardstand, and no screen anywhere
    // that admitted it existed. It was findable only by climbing into a cab and looking out of the
    // window at it, or by typing `hitch` at a thing you had to take on faith.
    //
    // A trailer is an owned vehicle exactly as a truck is — a row, an owner, a place — so it gets
    // the same three facts: what it is, where it is, and what is on it. `where` is resolved here
    // rather than on the client for the same reason `whereName` is on a truck: the depot names
    // live in zone flags and the panel has never seen them.
    trailers: myTrailers.map(t => ({
      id: t.id, name: t.name, kg: t.kg, ratedKg: t.ratedKg,
      // The same three condition fields a TRUCK row carries, and for the same reason: this screen
      // renders what it is told and invents nothing, so a box that only sent the band KEY forced the
      // panel to keep its own table of labels — a second copy of BANDS, on the client, drifting.
      ...(() => { const b = bandOf(t.condition ?? 1);
        return { condition: +(t.condition ?? 1).toFixed(3), band: b.key, bandLabel: b.label, bandText: b.text }; })(),
      towedBy: t.towedBy || null,
      hereNow: !t.towedBy && zonesHere.includes(t.parkedZone),
      // ⚠ AND WHETHER IT CAN BE SOLD, which is not the same question as `hereNow`. A box on your own
      // fifth wheel, in the yard you are standing in, is as much 'here' as one on the concrete — the
      // pin is not a reason to make somebody type two verbs to do one thing. Selling it drops it
      // first, which is the SAME drop `unhitch` performs, so the two stores can never disagree.
      canSell: !t.cargo && !t.stash
        && ((!t.towedBy && zonesHere.includes(t.parkedZone))
          || (t.towedBy && t.towedBy === rig?.truckId && !rig?.cargo
            && (zonesHere.includes(rig?.zoneId) || zonesHere.includes(rig?.fromDepot)))),
      where: t.towedBy ? 'hitched' : (zonesHere.includes(t.parkedZone) ? 'here' : depotNameOf(t.parkedZone)),
      cargo: t.cargo ? { name: t.cargo.name, kg: t.cargo.kg } : null,
      // ⚠ AND WHETHER IT IS CARRYING ANYTHING AT ALL, which is not the same question as `cargo`.
      // A box holds a declared load and a STASH, and the sale refuses either — but the stash is
      // the whole point of the stash, so the panel is told that the box is not empty and
      // deliberately not told what is in it. Without this the Sell button is offered on a loaded
      // box and then refused, which is the one thing the toolbar rule on this screen forbids: a
      // button that is present and refuses is worse than one that is absent and explains itself.
      loaded: !!(t.cargo || t.stash),
      // What colour it is, so the yard floor draws a fleet rather than a row of black slabs. One
      // field, because a box is one colour — see boxLivery.
      colour: boxColour(t),
      // What a dealer would give you, sent as a FACT for the same reason every other price on this
      // screen is: the button prints exactly what the verb pays.
      resale: trailerResale(t),
    })),
    // The bench's catalogues, sent once with the panel exactly as the hangar sends its paint and
    // tune catalogues: the client renders the dials it is told about and invents none.
    tuneParams: Object.entries(TUNE_PARAMS).map(([id, p]) => ({ id, label: p.label, lo: p.lo, hi: p.hi, desc: p.desc })),
    tuneRange: tuneRange(fab, []),
    kitCatalog: Object.entries(KITS).map(([id, k]) => ({ id, ...k, afford: (player.credits || 0) >= k.price })),
    flashes: FLASHES, finishes: FINISHES, arts: ARTS, paintPresets: PAINT_PRESETS, paintDefault: PAINT_DEFAULT,
    // ── THE INTERIOR CATALOGUE, AND WHY IT CARRIES COLOURS ─────────────────────
    // Same rule as every other catalogue on this screen: the client renders what it is told and
    // invents nothing. What is new is that these rows carry the actual swatch colours, because the
    // trim tab PREVIEWS a dashboard rather than listing seven words — and a preview whose colours
    // were guessed on the client is a preview that promises a cab the renderer will not draw.
    // Lifted straight off the shared vocabulary (client/shared/cab-trim.js) the renderer itself
    // reads, so there is no second copy of any of it anywhere.
    dashMaterials: Object.entries(DASH_MATERIALS).map(([id, m]) => ({ id, label: m.label, blurb: m.blurb, gloss: m.gloss })),
    dashColourways: Object.entries(DASH_COLOURWAYS).map(([id, c]) => ({
      id, label: c.label, stock: !!c.stock,
      dash: c.dash, hdr: c.hdr, face: c.face, needle: c.needle, glow: c.glow, ring: c.ring, lip: c.lip,
    })),
    // ⚠ THERE IS NO 'dashCustom' ROW HERE, AND THAT IS DELIBERATE. Every other catalogue on this
    // screen is the server's because the client must not invent a vocabulary — but a mixed
    // interior is not a vocabulary, it is a DERIVATION, and the bench previews it while the player
    // is still dragging the well. A server-sent preview could only ever show the last committed
    // mix, which is the one thing they are not looking at. So the panel runs customColourway out
    // of client/shared/cab-trim.js — the same function this file's renderer resolves the cab
    // through — and the two cannot drift because there is only one of it.
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
  // `yard text` / `market text` forces the written depot at any rung (the
  // `shop text` shape). Checked on the caller's behalf via payload.forceText.
  if (forceText) return say(textDepot(payload));
  if (await prefersLoggedPanelsOrDefault(player)) return depotDialogPayload(payload);
  return payload;
}

/**
 * The depot as a generic list-dialog payload (client/game/js/panels/listdialog.js).
 *
 * Four sections of one question — what I own, what is for sale, what needs hauling,
 * what the exchange pays — which is exactly what the grouped list is for. Reads the
 * SAME payload `textDepot` does, so the dialog and the prose cannot disagree.
 *
 * Every command here is one a player could type, which is what makes the rows
 * safe to convert: `yard recall`, `yard sell`, `yard buy`, `haul`, `market buy`
 * are all real verbs and none is invented for the dialog.
 */
function depotDialogPayload(p) {
  const rows = [];
  for (const t of p.fleet || []) {
    const cmds = [{ label: `Sell (${t.resale}₵)`, command: `yard sell ${t.id}` }];
    if (!t.hereNow) cmds.unshift({ label: `Tow home (${t.recall}₵)`, command: `yard recall ${t.id}` });
    rows.push({
      group: 'Your fleet',
      label: `${t.name} (${t.type})`,
      detail: `${t.kg}kg · fuel ${Math.round(t.fuel * 100)}% · ${t.odometer} tiles · ${t.hereNow ? 'here' : `at ${t.whereName}`}`,
      commands: cmds,
    });
  }
  if (!(p.fleet || []).length) rows.push({ group: 'Your fleet', label: 'You own nothing with wheels on it.' });

  for (const t of p.stock || []) {
    rows.push({
      group: 'For sale',
      label: t.name,
      detail: `${t.price}₵ · ${t.kg}kg · ${t.tank} tiles a tank · ${t.top}mph${t.afford ? '' : ' · cannot afford'}`,
      commands: t.afford ? [{ label: 'Buy', command: `yard buy ${t.id}` }] : [],
    });
  }
  // A LOADED DECK TAKES THE BUTTON OFF THE ROW HERE TOO, exactly as it dims it on the panel — the
  // unaffordable-stock rows above already establish that a row with no command is how this dialog
  // says "not this one". An offer the verb is certain to refuse is the same defect at every rung.
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
    title: `${p.depot} — yard`,
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
// The log rung reads the identical facts as prose. The panel is a skin; this is the record.
function textYard(p) {
  const fleet = p.fleet.length
    ? p.fleet.map(t => `  <b>${t.name}</b> (${t.type}) · ${t.kg} kg deck · fuel ${Math.round(t.fuel * 100)}% · ${t.odometer} tiles`
        + `${t.hereNow ? ' · <span class="text-green">here</span>' : ` · <span class="text-dim">at ${t.whereName}</span>`}`
        + `${t.hereNow ? ` · <span class="text-dim">take it out (drive ${t.id})</span>` : ''}`
        + `${t.hereNow ? '' : ` · <span class="text-dim">tow it home for ${t.recall}₵ (yard recall ${t.id})</span>`}`
        + ` · <span class="text-dim">sells for ${t.resale}₵ (yard sell ${t.id})</span>`).join('\n')
    : '  <span class="text-dim">You own nothing with wheels on it.</span>';
  const stock = p.stock.map(t =>
    `  <b>${t.name}</b> — <span class="item-grant">${t.price}₵</span> · ${t.kg} kg deck · ${t.tank} tiles a tank · ${t.top} mph`
    + `${t.afford ? '' : ' <span class="text-dim">(cannot afford)</span>'}\n    <span class="text-dim">${t.blurb}</span>`
    + `\n    <span class="text-dim">yard buy ${t.id}</span>`).join('\n');
  // THE BOXES, ON THE RECORD. A trailer you own was invisible on BOTH rungs of the display
  // ladder, because it was never in the payload at all — so a bought reefer existed in the
  // database, on the hardstand and nowhere a player could read. It was findable only by climbing
  // into a cab and looking out of the window at it. This is the log rung's copy of the same list
  // the panel draws; a trailer is an owned vehicle exactly as a truck is.
  const boxes = (p.trailers || []).length
    ? p.trailers.map(t => `  <b>${t.name}</b> · ${t.ratedKg} kg rated`
        + `${t.towedBy ? ' · <span class="text-dim">on the pin</span>'
            : t.hereNow ? ' · <span class="text-green">standing here</span>' : ` · <span class="text-dim">at ${t.where}</span>`}`
        + `${t.cargo ? ` · <span class="text-dim">loaded: ${t.cargo.name}</span>` : ''}`
        + `${t.hereNow ? ' · <span class="text-dim">back under it (hitch)</span>' : ''}`).join('\n')
    : null;
  return `<b>${p.depot} — yard</b>  <span class="text-dim">(${p.credits}₵)</span>\n\n<b>YOUR FLEET</b>\n${fleet}`
    + (boxes ? `\n\n<b>YOUR BOXES</b>\n${boxes}` : '')
    + `\n\n<b>FOR SALE</b>\n${stock}`;
}

async function yardBuy(player, here, depot, typeId, plate) {
  const key = (typeId || '').toLowerCase();
  // TRAILERS ARE BOUGHT ON THE SAME LINE. A second verb for the second half of a rig would be a
  // second place to look for one purchase; the dealer's fence has trucks on it and boxes behind it.
  const trl = trailerType(key);
  if (trl) return yardBuyTrailer(player, here, depot, trl);
  const type = truckType(key);
  if (!type) {
    return say(`No such truck. <span class="text-dim">trucks: ${TRUCK_TYPES.map(t => t.id).join(', ')} · trailers: ${TRAILER_TYPES.map(t => t.id).join(', ')}</span>`);
  }
  if ((player.credits || 0) < type.price) {
    return say(`The ${type.name} is ${type.price}₵ and you have ${player.credits || 0}₵.`);
  }
  // A YARD HOLDS AS MANY OF YOURS AS YOU CAN PAY FOR. It used to hold exactly one, and refused the
  // second with "move it or sell it" — a rule that bought `drive` an unambiguous target and cost
  // the player the only place a fleet can actually BE. A haulier with four trucks keeps them in one
  // yard; keeping them in four towns is not an interesting logistics puzzle, it is a chore with a
  // tow bill attached. The ambiguity that rule was avoiding is answered where it arises now, by
  // `pickParked` and one prompt (see above), and only ever when there is something to be ambiguous
  // about.
  player.credits -= type.price;
  // It is bought INTO THE BAY, not onto the street: a truck you just paid for is inside, under a
  // roof, and `drive` is what brings it out. (The row's zone is the bay's, which is also what makes
  // the garage floor able to show it standing next to the rest of your fleet.)
  await buyTruck(player.id, key, here.id, plate);
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await repush(player, 'fleet');
  return say(`<span class="item-grant">Bought: the ${type.name}${plate ? ` — "${plate}"` : ''}. ${type.price}₵.</span>\n`
    + `<span class="text-dim">${type.kg} kg of deck and ${type.tank} tiles to a tank. ${teachVerb('drive')} when you're ready.</span>`);
}

// A trailer is bought STANDING IN THE YARD, not attached — which is the honest shape of the thing
// and also teaches `hitch` by making it necessary. There is no one-per-yard rule the way there is
// for trucks: a yard full of your own boxes is a perfectly sensible thing to own.
//
// ⚠ IT IS STOOD OUTSIDE, ON THE HARDSTAND, AT A POSE. It used to be parked in the BAY with no pose
// at all, and that made it the one trailer in the game that could not be seen: a bay is a building
// interior with no grid coordinates, and `trailersNear` draws only posed rows. The cab's air knob
// lit and named a box that was nowhere on the picture, and `hitch` — which waves an unposed row
// through — coupled to it from across the yard. Both were correct and neither looked it.
//
// So a bought box goes where a bought truck cannot: out on the apron, in the open, nose to the
// road. From that moment it is an ordinary dropped trailer and the manoeuvre is the same one.
// `hitchZones` already reached the yard, so nothing about finding it changed.
async function yardBuyTrailer(player, here, depot, t) {
  if ((player.credits || 0) < t.price) return say(`${cap(t.name)} is ${t.price}₵ and you have ${player.credits || 0}₵.`);
  // The hardstand, and the way OUT of the shed — the same heading `drive` points the truck at, from
  // the same facade `entrance`, so the box stands the way the traffic runs rather than at an angle
  // somebody typed. A depot with no drivable yard (the legacy one-tile shape, and the fixtures)
  // falls back to the old behaviour: parked where you stand, unposed, hitchable anywhere.
  // ⚠ THE FIRST FREE BAY, NEVER THE NTH ONE COUNTED. Placing at `trailersAt(zone).length` is right
  // exactly once: sell a box and the next purchase is stood at that index again, inside the one
  // already there — and two trailers in one spot is two trailers under one pin.
  const places = standPlaces(here, depot);
  const standing = [];
  for (const pl of places) for (const t of await trailersAt(pl.zone.id)) if (posed(t)) standing.push({ x: t.x, y: t.y });
  const pose = places.length ? findStockPose(places, mountSpot(here)?.heading ?? 180, standing) : null;
  const outside = pose ? getZone(pose.zoneId) : null;
  // ⚠ AND IT COMES OUT OF THE SHED IN YOUR COLOURS. A box you have just bought is yours, and the
  // cheapest way to say so is the one a real yard uses: it gets sprayed to match the cab that is
  // going to pull it. The stamp is taken ONCE, here, from the truck you keep at this depot — not
  // read live off the tractor, because then a box would change colour every time you repainted a
  // cab or hooked a different one to it, and the whole point of the colour is that it belongs to
  // the BOX. Repainting it afterwards is its own job: `yard paint`.
  const mine = await trucksAt(player.id, depotZonesOf(here, depot));
  const stamp = sanitizePaint({}, (mine[0]?.custom_data || {}).paint || {}).base;
  player.credits -= t.price;
  await buyTrailer(player.id, t.id, outside?.id || here.id, pose, stamp);
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  // It is standing there NOW, so it is drawn from the next frame rather than from the next time
  // somebody happens to arrive in the zone — a driver already sitting in the cab is the commonest
  // way this is bought.
  if (outside) await refreshStanding(outside.id);
  await repush(player, 'buy');
  return say(`<span class="item-grant">Bought: ${t.name}. ${t.price}₵.</span>\n`
    + `<span class="text-dim">${t.rated} kg rated, ${t.kg} kg empty. ${outside
      ? `A yard hand walks it out and drops the legs on the hardstand, nose to the road — ${teachVerb('hitch')} once you have backed under it.`
      : `It is standing in the yard — ${teachVerb('hitch')} to back under it.`}</span>`);
}

// Selling a box. Priced off the list and its condition (trailerResale), refused while it is
// loaded or on a pin, and it has to be STANDING HERE — the same three tests the truck sale makes,
// for the same reason: a dealer buys a thing he can walk round.
async function yardSellTrailer(player, here, depot, id) {
  const zones = hitchZones(here?.id);
  let box = null;
  for (const z of zones) for (const t of await trailersAt(z)) if (t.id === id && t.ownerId === player.id) box = t;
  // ⚠ …OR THE ONE ON YOUR OWN PIN. A hitched box is not findable by `trailersAt` — it has no
  // `parked_zone` at all while it is being towed — so a driver sitting in the yard with the thing
  // they want to sell hooked up behind them got 'it isn't standing in this yard'. It is: it is on
  // the truck, and the truck is here. The drop below is the same one `unhitch` does.
  const rig = rigOf(player);
  const towed = !box && rig?.trailer && rig.trailer.id === id && rig.trailer.ownerId === player.id
    && (zones.includes(rig.zoneId) || zones.includes(rig.fromDepot)) ? rig.trailer : null;
  if (towed && rig.cargo) return say(`There is still a load on it. <span class="text-dim">Deliver or dump it before you sell the ${towed.name}.</span>`);
  box = box || towed;
  if (!box) return say("That isn't yours, or it isn't standing in this yard.");
  if (box.cargo || box.stash) return say(`There is still a load on it. <span class="text-dim">Empty the ${box.name} first.</span>`);
  const value = trailerResale(box);
  // Unhook it first, so the row is a parked box for the instant before it stops existing — and the
  // live rig stops believing it has one. Doing it the other way round leaves a rig towing a trailer
  // that has been deleted, which every consumer of `rig.trailer` would then answer questions about.
  if (towed) {
    await dropTrailer(box.id, here?.id || rig.zoneId, null);
    rig.trailer = null;
  }
  if (!await sellTrailer(box.id, player.id)) return say('Somebody is towing it.');
  player.credits = (player.credits || 0) + value;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await Promise.all(zones.map(z => refreshStanding(z)));   // it stops being on the glass now, not on the next arrival
  await repush(player, 'fleet');
  return say(`<span class="item-grant">Sold ${box.name} for ${value}₵.</span> <span class="text-dim">${towed ? 'They pull the pin, walk it off your fifth wheel and drag it round the back.' : 'A yard hand hooks it up and drags it round the back.'}</span>`);
}

// ── yard paint ───────────────────────────────────────────────────────────────
// A box, one colour, for a flat fee. Deliberately NOT `rig paint` with a trailer id in it: that
// verb takes eight named surfaces and a trailer has one, so half its grammar would be refusals.
//
// ⚠ THE BOX HAS TO BE HERE. Not because a spray gun is fussy about geography, but because the
// alternative is repainting something you cannot see from a menu — the same rule `hitch` follows,
// and the reason both of them search the depot's own zones rather than the tile you happen to be
// standing on.
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
  if (!await paintTrailer(box.id, player.id, c)) return say('That box is not yours to paint.');
  player.credits -= BOX_PAINT_FEE;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  // It is standing there NOW, so it changes colour on the glass rather than the next time somebody
  // happens to arrive in the zone — see the same call in yardBuyTrailer.
  await Promise.all(zones.map(z => refreshStanding(z)));
  await repush(player, 'fleet');
  return say(`<span class="item-grant">Painted — ${BOX_PAINT_FEE}₵.</span> <span class="text-dim">${box.name}, and the overspray is on the concrete for a week.</span>`);
}

// ── Recovery: getting a truck home you did not drive home ────────────────────
// A rig lives at the last yard it was parked at, and a driver who crossed the waste, sold a load
// and caught a lift back has their truck two regions away with no way to reach it except the
// journey it was supposed to save them. That is not a hard choice, it is an errand with a known
// answer, so the yard will fetch it — for a price that is deliberately worse than driving.
//
// THE FEE IS THE DISTANCE, and it is derived rather than authored: a flat call-out plus a rate per
// tile of the straight line between where it sits and where you are standing, scaled by what the
// machine is worth (a low-loader for a Continental is not a low-loader for a Barrow). A tow across
// the basin costs real money; a tow from the yard down the road costs the call-out and no more.
//
// An impounded rig comes home too, and its lot fee rides on the same bill — you are paying somebody
// to go and get it out, which is exactly what the impound wanted. `recoverTruckTo` clears the fee
// in the same guarded statement that moves it, so a double click cannot pay for two tows.
const TOW_CALLOUT = 200;
const TOW_PER_TILE = 2.2;
// ⚠ A RECOVERY CAN NEVER COST MORE THAN A FRACTION OF THE TRUCK, and that is a correctness
// invariant rather than a kindness. The distance term below reads coordinates off content rows,
// and content can always grow a row whose coordinates are not where the thing is — which is
// exactly the bug this cap was written after: every depot BAY is an interior at grid 0,0, so a
// recall measured from a shed to a hardstand at 871,1958 billed 2,143 tiles of low-loader and
// quoted 10,038₵ to fetch a truck that costs 1,300₵ new. `towGrid` fixes the measurement; this
// makes that CLASS of mistake unable to produce an absurd bill again even if a measurement goes
// wrong somewhere nobody is looking.
const TOW_MAX_FRAC = 0.40;

// WHERE A ZONE ACTUALLY IS, for the purpose of sending a low-loader to it.
//
// A depot bay is INDOORS. It has no map coordinates of its own and never did — `grid_x` is 0 on
// every one of the 324 interiors in the world, which is not a position, it is the absence of one.
// Measuring straight off the row produced two opposite wrong answers depending on which end was
// the shed: a shed-to-shed recall across two regions billed ZERO tiles, and a shed-to-hardstand
// recall billed the distance from the origin of the coordinate space to the far side of the map.
//
// The hardstand outside the bay door is the tile a recovery driver genuinely drives to, and the
// depot flag already names it (`truck_depot.yard`), so the fix is to ask the bay where its yard is
// rather than to invent a coordinate for a room that has none. Returns null when there is honestly
// no answer — a transient waste node has no row at all — and the caller bills a nominal distance
// for that rather than guessing at a long haul.
function towGrid(zoneId) {
  const z = getZone(zoneId);
  if (!z) return null;
  const yard = depotAt(z)?.yard ? getZone(depotAt(z).yard) : null;
  for (const cand of [z, yard]) {
    // 0,0 IS NOT A PLACE. The mapped world starts at grid_x 726, so a zero pair is always an
    // interior's unset column and never a tile anybody could stand a truck on.
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
  // Divided by 5,000 rather than 9,000 because the fleet's list prices came down. The point of the
  // term is the SPREAD across the ladder — a low-loader for a Continental is not a low-loader for a
  // Barrow — so the divisor tracks the top of the ladder rather than sitting at an absolute number
  // the ladder has since moved out from under.
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
  player.credits = (player.credits || 0) - fee;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await repush(player, 'fleet');
  return say(`<span class="text-green">A low-loader goes out for it.</span> <span class="text-dim">Some hours later the ${t.type.name} comes off the ramps `
    + `into the yard, filthy, with a chain mark on the bumper nobody wants to talk about.</span> <span class="item-loss">-${fee}₵</span>`);
}

async function yardSell(player, here, depot, id) {
  if (!id) return say('Sell which? <span class="text-dim">yard sell &lt;id&gt;</span>');
  const t = await getTruck(id, player.id);
  // Not a truck of yours — try the boxes standing in this yard before refusing. Ids are exact and
  // a trailer's is unmistakable, so this can never take a sale you meant for a tractor.
  if (!t) return await yardSellTrailer(player, here, depot, id);
  if (!depotZonesOf(here, depotAt(here)).includes(t.depot_zone)) return say(`It's parked at ${depotNameOf(t.depot_zone)}. Bring it here first.`);
  if (rigOf(player)?.truckId === t.id) return say("You're sitting in it.");
  // The bodywork is in the price — see resaleValue. A dealer looks at the thing.
  const value = resaleValue(t.type, t.odometer, t.condition, damageOf({ condition: t.condition, custom_data: t.custom_data }));
  // ⚠ THE BOX COMES OFF THE PIN BEFORE THE TRACTOR STOPS EXISTING, and this is not politeness about
  // where a trailer ends up — it is the only thing standing between a sale and an unreachable row.
  // `sellTruck` is a bare DELETE and `towed_by` is plain TEXT with no foreign key, so a truck sold
  // with a box on it left that box pointing at an id nothing will ever answer to: no `parked_zone`,
  // so it is standing in no yard and `trailersAt` cannot see it; `towed_by` set, so `hitchTrailer`,
  // `sellTrailer` and BOTH branches of `yardSellTrailer` refuse it. Not a lost trailer — an
  // unreachable one, which the panel goes on listing as 'on the pin' behind a tractor the owner
  // sold weeks ago. Three of those were sitting in the database when this was found.
  //
  // It is the same drop `unhitch` does, into the depot the truck was standing in, and a NULL pose
  // is deliberate: the dealer took the truck, so there is no cab to take a heading from, and
  // `standStock` walks a placeless box onto the hardstand the next time anybody opens this yard.
  // The load stays on it — dropping a trailer has never emptied it, and a sale that binned somebody
  // else's freight would be a worse bug than the one this fixes.
  const onPin = await trailerOnTruck(t.id);
  if (onPin) await dropTrailer(onPin.id, t.depot_zone, null);
  await sellTruck(t.id, player.id);
  player.credits = (player.credits || 0) + value;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  // It is standing here NOW — the same argument the trailer sale makes two functions up. Without
  // this the box arrives on the glass whenever somebody next happens to walk into the zone.
  if (onPin) await Promise.all(hitchZones(here?.id).map(z => refreshStanding(z)));
  await repush(player, 'fleet');
  return say(`<span class="item-grant">Sold the ${t.type.name} for ${value}₵.</span> <span class="text-dim">Somebody drives it away without looking back at you.</span>`
    + (onPin ? ` <span class="text-dim">They pull the pin first and leave ${onPin.name} standing on its legs in the yard.</span>` : ''));
}

// ── rig: the bench → bench.js ────────────────────────────────────────────────
// `rig` and its eleven subcommands, and the parts/spares counter that used to sit two hundred lines
// further down beside `fix`. See the header of bench.js for why it left: a shop counter and a
// four-times-a-second telemetry reconciler are two jobs with different tempos and different blast
// radii, and neither should have to be read past to reach the other.

// ── market ───────────────────────────────────────────────────────────────────
// The trade layer, and the only place in the system where you can lose money. `haul` is wages —
// somebody pays you a fixed fee to move their box. This is your own capital on your own guess.
//
// Buying and selling live under `market` as subcommands rather than as `buy`/`sell`, which the
// vendor and storefront plugins already own. That is a naming constraint, but it reads better
// anyway: you go to the market, and then you do something at it.
async function cmdMarket(args, raw, player) {
  const rig = rigOf(player);
  const here = getZone(rig?.zoneId || player.current_zone);
  const depot = depotAt(here);
  if (!depot) return say('No exchange here. The yards keep the boards.');
  const region = here.flags?.region_id;
  const sub = (args[0] || '').toLowerCase();

  if (sub === 'buy') return await marketBuy(player, rig, here, region, args[1], args[2]);
  if (sub === 'sell') return await marketSell(player, rig, here, region);

  // THE PANEL AXIS. A price list is a surface you only READ — delete it and you are not stuck, you
  // just have to remember numbers — so this is `prefersLoggedPanels`, the bottom rung only. A
  // `textgames` player who wants to drive by typing still gets the screen.
  //
  // Both verbs land on the SAME depot panel, opened on its own tab. `yard` and `market` are two
  // questions about one place, and answering them on two screens made a player compare panels to
  // decide one thing.
  return await depotPanel(player, here, depot, 'market', (args?.[0] || '').toLowerCase() === 'text');
}

// The board and the exchange, as prose — the log rung's half of the same facts.
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
    ? p.board.map(b => `  <b>${b.i + 1}.</b> ${b.name} — <b>${b.kg} kg</b> to <b>${b.toName}</b>${b.crosses ? ' <span class="text-amber">(across the waste)</span>' : b.local ? ` <span class="text-dim">(in town — ${b.where})</span>` : ''} · <span class="item-grant">${b.pay}₵</span>`).join('\n')
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
  // Same resolve as the freight board, for the same reason — the exchange is on the same panel, in
  // the same building, and refused for the same wrong question. See `loadDeck`.
  const deck = await loadDeck(player);
  if (deck.err) return deck.err;
  if (!deck.trailer) return say(`Nowhere to put it — you are bobtail. <b>${teachVerb('hitch', 'hitch')}</b> a trailer first.`);
  if (deck.cargo) return say(`The deck is full: ${deck.cargo.name}.`);
  // Match on the key or on a word of the display name, but never on an EMPTY argument — a bare
  // `market buy` must ask what, not silently pick whichever commodity happens to sort first.
  const named = (good || '').toLowerCase().trim();
  if (!named) return say('Buy what? <span class="text-dim">market buy &lt;good&gt; [qty|full]</span>');
  const key = Object.keys(COMMODITIES).find(k => k === named || COMMODITIES[k].name.includes(named));
  if (!key) return say(`Nobody here trades "${good}".`);
  const c = COMMODITIES[key];
  const day = marketDay();
  const unit = askPrice(key, region, day);
  // Two ceilings, and the tighter one wins: what the trailer holds, and what you can pay for.
  // Capital is the real constraint early and weight is the real constraint late — which is the
  // whole ladder (see the balance note in market.js).
  const byMoney = Math.floor((player.credits || 0) / unit);
  // The deck is the TRUCK's, so what you can buy depends on what you drove here in.
  // WHAT THE DECK HOLDS IS THE TRAILER'S RATING, not the truck's mass. It used to be the truck's,
  // because there was no trailer to ask — which meant buying a bigger tractor bought you capacity
  // it does not actually have. The truck pulls; the box carries.
  // …AND IT IS THE DECK WE RESOLVED, not the mounted rig. On foot there is no `rig` at all, so the
  // old expression fell all the way through to DEFAULT_TRAILER_KG and quoted every player the same
  // capacity regardless of the box actually standing in front of them.
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
  player.credits -= cost;
  await setDeckCargo(player, deck, { kind: 'goods', key, name: c.name, qty, kg: qty * c.kg, unitPaid: unit }, 'market');
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  return say(`<span class="item-grant">Loaded ${qty} × ${c.name} at ${unit}₵ — <b>${cost}₵</b> gone. ${qty * c.kg} kg on the deck.</span>`);
}

async function marketSell(player, rig, here, region) {
  const deck = await loadDeck(player);
  if (deck.err) return deck.err;
  if (!deck.cargo) return say('Nothing on the deck.');
  if (deck.cargo.kind !== 'goods') return say(`That load is contracted to ${deck.cargo.toName} — it isn't yours to sell.`);
  const day = marketDay();
  const unit = bidPrice(deck.cargo.key, region, day);
  const take = deck.cargo.qty * unit;
  const spent = deck.cargo.qty * deck.cargo.unitPaid;
  const profit = take - spent;
  player.credits = (player.credits || 0) + take;
  const sold = deck.cargo;
  await setDeckCargo(player, deck, null, 'market');
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  const verdict = profit > 0
    ? `<span class="item-grant">Cleared <b>${profit}₵</b> on the run.</span>`
    : profit === 0 ? '<span class="text-dim">You broke exactly even. All that road for nothing.</span>'
    : `<span class="text-amber">You are <b>${-profit}₵</b> down. Somebody got there first, or you did.</span>`;
  return say(`Sold ${sold.qty} × ${sold.name} at ${unit}₵ — ${take}₵ in. ${verdict}`);
}

// Remembered boards, one player_flag. Written only when you READ a market (rare, deliberate), never
// on a tick — a market you have not visited is one you do not know, and that is the point.
async function rememberMarket(player, region, day, quotes) {
  if (!region) return;
  const seen = await recallMarkets(player);
  seen[region] = { day, q: Object.fromEntries(quotes.map(q => [q.key, { ask: q.ask, bid: q.bid }])) };
  await setFlag('player', 'truck_markets', JSON.stringify(seen), player).catch(() => {});
}
async function recallMarkets(player) {
  try { return JSON.parse((await getFlag('player', 'truck_markets', player)) || '{}'); } catch { return {}; }
}

// ── refuel ───────────────────────────────────────────────────────────────────
// At a fuel yard, or at any depot that keeps a pump. Priced off what you actually take.
async function cmdRefuelTruck(args, raw, player) {
  if (!rigOf(player)) return await pumpParked(player, (args || []).join(' ').trim());
  // The typed verb is the whole-tank case, which is what typing it has always meant. It is the same
  // commit the handle sends, asked for everything — so there is one place that moves fuel and money.
  return pumpFuel(player, 1, { typed: true });
}

// ── STANDING AT THE PUMP, ON YOUR OWN FEET ───────────────────────────────────
// The other half of `fuel`, and the half that was missing. Everything above assumes a driver in a
// cab, because that is where the handle is; but a forecourt is a place you PARK, and the moment
// somebody does they are out of the sim and standing on the apron next to a nozzle. Before this,
// that player was told "You are not driving anything" by the one verb the pump's own examine line
// offers them (see plugins/fuelstation) — a room advertising an action it then refuses.
//
// `rig fuel` is not the answer to it either: that is the DEPOT bench, and it refuses anywhere there
// is no depot, which is every forecourt in the world. A pump is not a workshop. You do not need a
// bay or a fitter to put diesel in a tank; you need a pump and a truck standing at it.
//
// So this asks the same two questions the cab path asks, of the same two functions, and moves money
// with the same clamp: `pumpAt` decides whether this tile sells diesel (the zone-only call shape
// `rigFuel` already uses), and `pumpClamp` decides how much a given balance buys. Nothing here is a
// second opinion about either — the day somebody retunes FUEL_FULL or adds a pump flag, this path
// changes with the rest of them.
async function pumpParked(player, want = '') {
  if (!pumpAt({ leg: 'city', zoneId: player.current_zone })) return say('You are not driving anything.');
  const parked = await trucksAt(player.id, player.current_zone);
  const truck = pickParked(parked, want);
  if (!truck && parked.length) return whichTruckLine('fuel', parked, want);
  if (!truck) return say('You are not driving anything, and nothing of yours is standing at these pumps.');

  const room = 1 - (truck.fuel ?? 1);
  if (room < 0.02) return say('She is already full.');
  const { take, cost } = pumpClamp(player.credits, truck.fuel ?? 1, room);
  if (take < 0.01) return say(`You cannot cover so much as a splash. Diesel is ${FUEL_FULL}₵ a tank.`);

  // Fuel first, money second, exactly as the cab path does it: a failed write must never bill for a
  // fill that did not happen.
  await setFuel(truck.id, player.id, Math.min(1, (truck.fuel ?? 1) + take));
  player.credits -= cost;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await repush(player, 'fleet');

  const pct = Math.round(Math.min(1, (truck.fuel ?? 1) + take) * 100);
  return say(pct >= 100
    ? `<span class="item-grant">You walk the nozzle over, brace it in the filler and let it run. Tanks filled. ${cost}₵.</span>`
    : `<span class="item-grant">The handle clicks off. ${cost}₵, and she is at ${pct}%.</span>`);
}

// ── The handle ───────────────────────────────────────────────────────────────
// `truckpump <fraction>` — the dash handle's commit, and the only thing the cab is trusted to say
// is HOW LONG IT HELD THE TRIGGER. Everything that decides money is re-derived here: whether there
// is a pump, how much room is in the tank, and what the driver can pay.
//
// WHY A COMMIT RATHER THAN A SERVER-SIDE POUR. The obvious build is an interval that adds fuel and
// charges credits every 200ms while the trigger is down. That is a per-player timer, a second place
// fuel changes outside the drive loop, and a teardown case for every way a session can end mid-pour
// (logout, park, breakdown, the road ending under you). The cab already simulates continuously and
// reports what it did — this is that same contract, and it costs one round trip instead of thirty.
//
// AND IT IS NOT AN EXPLOIT SURFACE, which is the question worth asking of any client-reported
// number. The worst a lying client can send is 1 — a full tank, instantly, at the full price the
// verb has always charged for exactly that. There is nothing to gain by lying because the ceiling
// is the honest transaction.
async function cmdTruckPump(args, raw, player) {
  return pumpFuel(player, Number(args[0]), { typed: false });
}

async function pumpFuel(player, want, { typed }) {
  const rig = rigOf(player);
  if (!rig) return typed ? say('You are not driving anything.') : { type: 'none' };
  if (!pumpAt(rig, player.current_zone)) return say('No pump here.');
  const room = 1 - rig.fuel;
  if (room < 0.02) return say('She is already full.');

  // THE AFFORDABILITY CAP IS A CLAMP, NEVER A REFUSAL. A driver with 90₵ standing at a pump gets
  // 90₵ of diesel — the handle clicks off when the money runs out, exactly as it does at a real
  // pump — because refusing the whole transaction for being short is how you strand somebody who
  // had enough to get to the next town. (The typed verb asks for a full tank, so this is the line
  // that turns `fuel` into "fill it as far as I can afford" rather than an error message.)
  const { take, cost } = pumpClamp(player.credits, rig.fuel, Number.isFinite(want) ? want : room);
  if (take < 0.01) return say(`You cannot cover so much as a splash. Diesel is ${FUEL_FULL}₵ a tank.`);

  player.credits -= cost;
  rig.fuel = Math.min(1, rig.fuel + take);
  rig.dry = false; rig.dryTold = false; rig.warnedLow = false;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  // `extra` forces the push past the once-a-second floor: the gauge has to move on the same beat
  // the credits do, or the driver watches their money go and their needle sit still.
  pushCab(rig, { pumped: true });
  const pct = Math.round(rig.fuel * 100);
  return say(rig.fuel >= 0.995
    ? `<span class="item-grant">Tanks filled. ${cost}₵.</span>`
    : `<span class="item-grant">The handle clicks off. ${cost}₵ — she is at ${pct}%.</span>`);
}

// ── park ─────────────────────────────────────────────────────────────────────
// Get out, wherever you are. Legal on the corridor and slightly reckless — the rig is still there
// when you come back, unless something found it first.
// ⚠ THIS VERB HAS A SECOND CALLER AND IT IS THE ROAD ITSELF. Arrival, a finished crossing and a
// destination with nowhere to put you all call `cmdPark` to get the player out of the cab, and none
// of those is a driver deciding anything — so the engine gate below belongs to the TYPED path only.
// `forcedPark` is that path: same landing, no refusal, and nothing can strand a player in a sim
// whose road has ended because their key happened to be on.
// What counts as stopped. Not zero: the client reports a float and a truck settling on its lifters
// reports a whisper of it, so an exact test would refuse a rig that has visibly stopped moving.
const PARK_STOPPED_MPH = 0.6;
// How far out the rig must have been before the near end of the road becomes an exit. See the ⚠ on
// the retreat test: a rig joins at s = 0, so without this the gate is a door you fall through.
const RETREAT_ARM = 2;
export async function forcedPark(player) { return parkRig(player, true); }
async function cmdPark(args, raw, player) { return parkRig(player, false); }
async function parkRig(player, forced) {
  const rig = rigOf(player);
  if (!rig) return say('You are not driving anything.');
  // ── THE ONLY THING THAT STOPS YOU GETTING OUT IS MOTION ────────────────────
  // This used to refuse a running engine, on the reasoning that parking is a sequence — brake, key,
  // door — and a driver should perform all three. It was wrong twice over, and both showed up as
  // the same symptom: pulling the park brake in the cab did nothing and said nothing.
  //
  //  · THE KNOB ALREADY IS THE SEQUENCE. Setting the spring brakes on a stationary truck is the
  //    last thing you do before climbing down and there is no other reason to touch it, so the cab
  //    sends `park` off that one action (see setPark in cab-view.js). Refusing it for the key
  //    meant the driver's ONE deliberate get-out gesture was answered with a lecture, every time.
  //  · AND IT WAS A RUNG GATE WEARING A REALISM COSTUME. A text-rung driver has no ignition at
  //    all, so the check had to be exempted for them — which is the tell that it was never a fact
  //    about trucks, only about which panel you happened to be using.
  //
  // So the gate is MOTION and nothing else: a rig that is completely stopped can be got out of,
  // from either rung, with the key in whatever position it is in. Turning it off is then part of
  // parking rather than a prerequisite for it — you do not leave one running, and the sim is
  // closing anyway, so the state is set here instead of demanded of the driver.
  if (!forced && (rig.speed || 0) > PARK_STOPPED_MPH) {
    return say('Not while it is still rolling. Bring it to a stand first, then set the brakes.');
  }
  // ── ⚠ A DRIVER IS NEVER LEFT IN THE VOID WITH A TRUCK THAT STILL RUNS ──────
  // This used to be `rig.leg !== 'city' && (broken || dry || s > 2)`, which made ANY deliberate
  // stop out on the road an abandonment: the truck went to the recovery lot, a wreck was marked,
  // and the driver was left standing on foot in a TRANSIENT void room with the sim closed behind
  // them. It reads as being dumped, because it is — and it fired on the ordinary act of stopping,
  // which a driver does for a dozen legitimate reasons.
  //
  // Abandonment is now what the word means: you are walking away because you CANNOT drive it.
  //
  // ⚠ AND STOPPING OUT THERE ON PURPOSE IS NOT ABANDONMENT EITHER. For a while a healthy rig
  // mid-crossing was turned round by this verb (`retreat`, below) and driven back to the gate,
  // which was safe and was not what anybody meant by `park`: you cannot get out and look at
  // something, and the ONE case the road was built to allow — climb down, walk, climb back up —
  // could not be reached. `mountOnCrossing` has always been able to put you back in your own cab
  // out here, trailer and all; nothing could get you out of it in the first place.
  //
  // So park means park, everywhere. A healthy rig stopped on the corridor falls through to the
  // ordinary landing below: the void room becomes its `depot_zone`, `drive` finds it there, and
  // `retreat` keeps its OTHER caller — driving back to s = 0 under your own power still leaves
  // the corridor at the gate you came in by, which is the honest way to change your mind.
  //
  // What the void room cannot do is outlive the crossing, so see `recoverTrucksFrom`: when the
  // instance tears down with a truck still parked in it, that truck goes to the recovery lot on
  // the same impound path a breakdown uses. Nothing is ever lost out there, it just gets expensive.

  rig.engineOn = false;   // the key, turned for you — the last step of the sequence, not a gate on it
  dismountRig(player.id);
  // The text tick self-heals (it drops any run whose rig has gone), but stopping it here means the
  // road doesn't narrate one more line after you've already climbed down.
  stopTextDrive(player.id);
  // Both flushes happen HERE and nowhere on the hot path: the town you drove through, and the fuel
  // and lifetime tiles the truck accumulated doing it.
  await flushZone(player, rig);
  // PARKING AT A DEPOT PUTS IT INSIDE. You stop on the apron — that is where the road is — but the
  // truck belongs to the bay, and storing the apron's zone id instead would leave a 16,500₵ rig
  // standing on a public street in the fiction and missing from the garage floor in the panel.
  const home = bayForYard(rig.zoneId);
  if (home) rig.zoneId = home.zone.id;
  // WALKING AWAY FROM IT OUT THERE. Climbing down mid-crossing wrote the void ROOM as the truck's
  // depot — and those rooms are transient, so the instance was torn down behind you and a rig
  // you owned was parked at an id with nothing on the other side of it. It could not be found,
  // driven, sold or repaired.
  //
  // So the road hands it to a recovery yard instead: the truck goes back to the depot it left and
  // wants a fee to come out, which is the `impound_fee` path the scale house already owns and
  // `drive` already knows how to settle. Nothing new is invented to charge you — abandonment and
  // confiscation end in the same lot, which is exactly right, and priced off the truck because
  // what you are paying for is somebody going and getting it.
  const abandoned = rig.leg !== 'city' && (rig.broken || rig.dry);
  if (abandoned) {
    rig.zoneId = rig.fromDepot || null;
    const fee = Math.max(250, Math.round((rig.type?.price || 4000) * 0.05));
    if (rig.truckId) await query('UPDATE trucks SET impound_fee = $1 WHERE id = $2', [fee, rig.truckId]).catch(() => {});
    // And the road remembers. See markWreck: this is where the roadside wrecks come from — every
    // one of them is a haul somebody did not finish, and yours is now one of them.
    markWreck(rig, player);
    sendToPlayer(player.id, { type: 'emote', message:
      `<span class="text-amber">You leave it on the shoulder with the flashers going and start walking. Somebody will come out for it eventually.</span>\n`
      + `<span class="text-dim">Recovery to ${depotNameOf(rig.fromDepot) || 'the yard'}: <b>${fee}₵</b>, payable when you next go to drive it.</span>` });
  }
  // ── STOPPING ON THE SHOULDER, ON PURPOSE ─────────────────────────────────────
  // A healthy rig left out on the corridor. The void room below becomes its `depot_zone`, which is
  // what `mountOnCrossing` reads to give you back YOUR cab with YOUR box on the pin.
  //
  // ⚠ AND THE ROOM IS TRANSIENT, so the truck needs to name somewhere real to be dragged to when
  // the crossing ends without it. That anchor is written HERE and only here, because this is the
  // one moment both facts are in hand: which truck, and which depot it set out from. Without it
  // `recoverTrucksFrom` has a truck and no idea where it belongs — the row would have to be swept
  // to a default yard, which is how somebody's rig ends up on the other side of the waste.
  const roadside = !abandoned && rig.leg !== 'city' && !!rig.instanceId;
  if (roadside && rig.truckId) {
    const home = rig.fromDepot || crossingInfo(rig.instanceId)?.originZone || null;
    if (home) await query(
      `UPDATE trucks SET custom_data = jsonb_set(COALESCE(custom_data,'{}'::jsonb), '{void_home}', to_jsonb($1::text), true)
        WHERE id = $2`, [home, rig.truckId]).catch(() => {});
    sendToPlayer(player.id, { type: 'emote', message:
      `<span class="text-amber">You set the brakes, kill the lights and drop down onto the hardpan. The engine ticks as it cools.</span>\n`
      + `<span class="text-dim">She will be here when you get back. <b>drive</b> to climb up again — but if you walk out of the waste without her, somebody will have to come and fetch her.</span>` });
  }
  // AND YOU LOCK IT. The last thing in the sequence, and the state that says this truck was LEFT
  // rather than merely stopped — persisted in the same flush below, so it is still locked tomorrow.
  // Every park locks, including a forced one: nobody walks away from a rig on the shoulder and
  // leaves the door swinging, and the abandonment line above is already about a truck you would
  // very much like to still be there.
  rig.locked = true;
  await persistTruck(rig);
  setPosture(player, 'standing');
  sendToPlayer(player.id, { type: 'truck_sim_close' });
  // AND THE ROOM COMES BACK. The cab owns the area-pane while you are driving, so `paneFreeForRoom`
  // is false for as long as it is open — which meant a room description composed HERE, in the same
  // reply, was thrown away by the client and the pane sat on whatever it had before the drive.
  // `force_look` is the seam for exactly this: it lands after the close above, so the pane is free
  // by the time the re-asked `look` comes back, and the log rung gets its copy for free.
  sendToPlayer(player.id, { type: 'force_look' });
  // AND IF YOU PARKED IT AT A YARD, THE YARD OPENS. Walking into a depot has always thrown the
  // screen up (see the `zone.entered` handler below) and climbing down inside one did not — which
  // is backwards, because the end of a haul is the moment you have the most to do: a load to
  // deliver, a tank to fill, a bill at the bench. The reason it never fired is that no zone was
  // ENTERED; the panel is skipped while driving, and parking is the moment that stops being true.
  //
  // Mirrors the hook exactly rather than calling `repush`, because it has to answer for BOTH rungs:
  // `depotPanel` hands the log rung prose, and prose is a message rather than a panel.
  // `depotHere` because you stop on the APRON — the bay is where the truck is stored, not where
  // the driver is standing.
  if (!abandoned) {
    const { bay: pBay, depot: pDepot } = depotHere(player);
    if (pDepot) {
      const panel = await depotPanel(player, pBay, pDepot, 'fleet');
      if (panel) sendToPlayer(player.id, panel.type === 'emote' ? { type: 'output', message: panel.message } : panel);
    }
  }
  // The prose finally matches the mechanic: the brake is set and the engine is already off, because
  // this verb refused to run until it was. Only the door is left to do.
  return say('<span class="text-amber">You set the brake, drop down onto the dirt and lock her up behind you. The silence out here is enormous.</span>');
}

// ── trucksync ────────────────────────────────────────────────────────────────
// The hot path. Packed numerics, ~4×/s, one per driving player. NEVER AWAITS A QUERY. Not on the
// ordinary frame and not on a node boundary either — `crossToNode` moves the player between void
// rooms in RAM and marks `zoneDirty` for the coalesced flush, exactly as `driveToZone` does between
// city tiles.
//
// ⚠ THIS COMMENT USED TO SAY THE OPPOSITE, AND IT WAS LOAD-BEARING WRONG. It read "a node crossing
// does [await a query] … and node crossings happen once every couple of minutes, not every frame."
// Both halves were true when a void room was ~90 tiles and stopped being true on the same day: a
// room is a TILE now, so a boundary is crossed roughly once a SECOND at road speed, and it was that
// arithmetic — 15 writes a crossing becoming 282, several a second — that forced the write out of
// crossToNode in the first place. The fix shipped and the comment describing it did not, which is
// the failure mode this whole file is otherwise careful about: a stale note on the hottest function
// in the plugin gets trusted instead of read.
//   packed: s t hdg spd x y
async function cmdTruckSync(args, raw, player) {
  const rig = rigOf(player);
  if (!rig) return { type: 'noop' };
  const n = args.map(Number);
  if (n.length < 6 || n.slice(0, 6).some(Number.isNaN)) return { type: 'noop' };
  // ── THE LAMPS ──────────────────────────────────────────────────────────────
  // A seventh packed slot, and it is deliberately OPTIONAL: an older client sends six numbers and
  // must keep working, so a missing slot means 'lamps as they have always been' rather than 'all
  // lamps off'. Headlights default ON for exactly the reason the rocker does — that is the
  // behaviour that shipped, and a client that cannot tell us is not a client driving dark.
  //
  // RAM ONLY. This is per-frame state about the outside of a truck; it is read by
  // `truckContactsNear` on the same tick and by nothing else, ever. There is no column, no flag and
  // no flush — the persistence tiers in docs/architecture.md are explicit that per-tick state does
  // not go near the database, and a lamp is the purest example of one.
  const lamps = Number.isFinite(n[6]) ? (n[6] | 0) : 1;
  rig.headlights = !!(lamps & 1);
  rig.braking = !!(lamps & 2);

  // ⚠ READ BEFORE THE RECONCILE, because the reconcile is what changes it. A truck now mounts COLD
  // (state.js), so the first time the ignition comes back true is the driver turning the key — and
  // that is where a derelict's argument about starting belongs. No new event and no new packet: the
  // telemetry has carried the ignition bit all along, this only notices the edge.
  const wasRunning = !!rig.engineOn;

  const r = reconcileTruck(rig, { s: n[0], t: n[1], hdg: n[2], spd: n[3], x: n[4], y: n[5] });

  if (!wasRunning && rig.engineOn && rig._hardStart) {
    rig._hardStart = false;
    sendToPlayer(player.id, { type: 'emote', message: HARD_START_LINE });
  }

  // Out of diesel, and the low-fuel light. ANNOUNCED, NOT SHORT-CIRCUITED: an early return here
  // skipped every arrival, delivery and node crossing below it, so a rig that ran dry one tile
  // from the dock could never finish the haul at all. Running dry stops the truck MOVING (the
  // speed clamp in reconcileTruck does that); it must not stop the handler thinking.
  if (rig.dry && !rig.dryTold) {
    rig.dryTold = true;
    sendToPlayer(player.id, { type: 'emote', message: '<span class="text-amber">The engine coughs twice, catches once more out of spite, and dies. The gauge has been on the pin for a while and you knew it. Wherever this is, this is where you are.</span>' });
  }
  if (rig.warnLow) {
    rig.warnLow = false;
    sendToPlayer(player.id, { type: 'emote', message: '<span class="text-amber">A light comes on that you have been waiting for. Low fuel.</span>' });
  }
  announceBreak(player, rig);
  passSign(player, rig);
  // …and the person standing on it. Beside the boards rather than on the node crossing, because
  // that is the placement the warning needs: a call about somebody eighteen miles up is a fact
  // about the ODOMETER, and the odometer only moves here. See passHitcher for why it is swept.
  passHitcher(player, rig);

  // ── YOU TOOK THE OTHER ROAD ────────────────────────────────────────────────
  // Steering onto the far limb is a real decision about where this load is going, so it is SAID.
  // A junction you can take with the wheel and that changes your destination silently is worse than
  // one you cannot take at all: the first time a driver would find out is at the wrong town, with a
  // tank they budgeted for somewhere else. The detection is in reconcileTruck (see the ⚠ there);
  // this only reports it, and deliberately names the verb too — turning back is the same wheel.
  if (r.tookFork) {
    sendToPlayer(player.id, {
      type: 'emote',
      message: `<span class="text-amber">The wheels find the other road and stay on it. You are on the ${r.tookFork.name} limb now.</span>`
        + ` <span class="text-dim">Steer back across if that was not what you meant — or ${teachVerb('route', 'route')} to see what each one costs you.</span>`,
    });
  }

  // ── TWO TRUCKS IN THE SAME PLACE ──────────────────────────────────────────
  // Detected HERE, on the frame that just moved the rig, and that placement is the whole of why it
  // costs nothing: no tick, no new client message, no new command, no round trip. The position it
  // tests was already reported and already reconciled a line above; the only new work is a distance
  // check against the handful of other live rigs, which is a few subtractions.
  //
  // Everything downstream is lazy in the same way the rest of this system is: the damage lands in
  // RAM on both rigs and rides home in the coalesced write that already carries fuel and the
  // odometer (`park`), and a per-pair cooldown in collide.js means one contact is one event no
  // matter how many frames the two bodies take to separate.
  if (r.city) {
    for (const hit of collideTrucks(rig, [...rigs.values()])) {
      narrateCollision(rig, hit);
      narrateCollision(hit.other, hit);
      // The other driver's cab is corrected too, or their client goes on believing it is where it
      // was and drives back into you next frame. `pushCab` with an `extra` is the existing "the
      // server has something to SAY" path, which bypasses the once-a-tile throttle exactly once.
      pushCab(hit.other, { collided: true });
      pushCab(rig, { collided: true });
    }
  }

  // ── City leg ──
  if (r.city) {
    // Off the end of the world: this is the rim, and the rim is where the highway starts. Driving
    // off the map in a truck launches the crossing exactly as walking off it does — the same
    // `launchCrossing`, the same muster-less path a walker takes once they've readied.
    if (r.bogged) return await leaveTheMap(player, rig);
    if (r.moved) {
      const zone = driveToZone(player, rig, r.zone);
      // THE SCALE. A weighbridge is a tile you drive onto, so it hangs off the drive rather than off
      // the move gate — a driver never walks. Shared with the text rung; see scale.js afterDrive.
      await afterDrive(player, rig, zone);
      if (zone) sendToPlayer(player.id, { type: 'zone_event', message: `<span class="text-dim">— ${zone.name} —</span>` });
      // Rolled into a depot with a load that belongs there? That's a delivery.
      if (rig.cargo && r.zone === rig.cargo.to) return await deliver(player, rig);
    }
    pushCab(rig);
    return { type: 'noop' };
  }

  if (r.bogged && !rig.bogged) {
    rig.bogged = true;
    unbog(rig);
    pushCab(rig, { bogged: true });
    sendToPlayer(player.id, { type: 'emote', message: '<span class="text-amber">The wheels go soft, then bite nothing at all. You are off the road and into the deep stuff — it takes a long, ugly while to get her back onto the gravel, and the tank is lighter for it.</span>' });
    return { type: 'noop' };
  }
  // Arrival is checked on EVERY frame, not only when the node index changes. The last room is the
  // one you spend the final stretch of road in, so by definition the node has stopped moving by
  // the time you reach the end of it — hanging arrival off `moved` meant the haul completed and
  // then simply never ended, with the driver parked at the far edge of the world.
  if (rig.s >= rig.route.L - 1) { await arrive(player, rig); return { type: 'noop' }; }
  // ── AND THE SAME TEST AT THE OTHER END ───────────────────────────────────────
  // Backtracking means `s` can now be driven back down to zero, and zero is a real place: the rim
  // tile you left. Without this the road simply stopped being road under you and the rig sat at
  // the gate with nowhere to go — the far end had an exit and the near end had a wall, which is
  // exactly the asymmetry the reverse work exists to remove. A walker has always been able to turn
  // round and step back out of trunk room 0; this is the same door, wide enough for a truck.
  //
  // ⚠ IT HAS TO BE ARMED, AND FORGETTING THAT MADE THE ROAD UNUSABLE. A rig JOINS the corridor at
  // s = 0 — that is what `joinCorridor` sets — so an unguarded test at the near end fired on the
  // first telemetry frame of every haul and bounced the driver straight back off the road they had
  // just pulled onto. Arriving somewhere is only meaningful if you left, so the exit does not
  // exist until the rig has actually got out onto the road. Two tiles, the same threshold `park`
  // uses to decide a rig has been abandoned out here rather than merely stopped at the gate.
  if (rig.s <= 0.5 && (rig.sMax || 0) > RETREAT_ARM) { await retreat(player, rig); return { type: 'noop' }; }

  // ── SOMEBODY IS STANDING ON THE ROAD AHEAD ─────────────────────────────────
  // A walker at a camp with their arm out (voidwalking's `flag`). ⚠ ONCE PER DRIVER PER WALKER, and
  // only with room to react: a rig reconciles four times a second, so an alert that fired on
  // proximity alone would repeat until you were past, and one that fired when you were level with
  // them would not be an alert at all. Far enough out that slowing is a choice.
  if (rig.leg === 'corridor' && Number.isFinite(rig.x)) {
    for (const b of beaconsNear(rig.x, rig.y, BEACON_SEE_TILES)) {
      rig.sawFlag = rig.sawFlag || new Set();
      if (rig.sawFlag.has(b.playerId)) continue;
      rig.sawFlag.add(b.playerId);
      sendToPlayer(player.id, { type: 'emote', message:
        `<span class="text-amber">Somebody is standing at the side of the road up ahead with an arm out.</span>`
        + `\n<span class="text-dim">${b.handle}, about ${Math.max(1, Math.round(b.dist / 3))} mile${Math.round(b.dist / 3) === 1 ? '' : 's'} on. `
        + `Slow down and they can climb up; keep going and they will not hold it against you out loud.</span>` });
    }
  }

  if (r.moved) {
    const zone = await crossToNode(player, rig, r.node);
    if (!zone) { await forcedPark(player); return { type: 'noop' }; }
    // (SOMEBODY ON THE SHOULDER used to be announced here, once, at the moment the boundary went
    // under the wheels. It is `passHitcher` now — same principle, three calls and a distance in
    // each, because being told about a thing you cannot yet stop for is not being told in advance.)
    // THE JUNCTION, ANNOUNCED. The last trunk room is where the two roads part, and a fork you
    // only find out about by having already taken one side of it is not a decision. Same principle
    // as the scale house and the hitchhiker: this whole phase is about choices made in advance.
    if (rig.trunk && r.node === rig.trunk - 1) {
      const info = crossingInfo(rig.instanceId);
      const others = (info?.dests || []).filter(d => d.key !== rig.destKey);
      if (others.length) {
        sendToPlayer(player.id, {
          type: 'emote',
          message: '<span class="text-amber">A junction, of sorts: the graded road splits around a stand of dead pylons and both halves go on being road.</span>'
            + ` <span class="text-dim">You are on the ${(info.dests.find(d => d.key === rig.destKey)?.heading) || 'far'} side of it. `
            + `${others.map(d => `<b>${d.heading}</b>`).join(', ')} the other way — ${teachVerb('route', 'route')} while you are still on it.</span>`,
        });
      }
    }
    cbLine(player, rig);
    // The room's own arrival prose goes to the log, so the drive reads in the transcript exactly
    // as the walk does — one of the display-mode contracts (docs/systems-display-mode.md): if a
    // system's record doesn't reach the log, that rung isn't done for it.
    sendToPlayer(player.id, {
      type: 'zone_event',
      message: `<span class="text-dim">— ${zone.name} —</span>`,
      minimap: getMinimapData(zone.id, 8, player),
    });
    pushCab(rig);
    return { type: 'noop' };
  }
  // ── SOMEBODY TRIES THE DOOR ────────────────────────────────────────────────
  // Every frame rather than only on a node crossing, because the whole event is about STANDING
  // STILL — a driver who stopped for a smoke in the middle of a stretch crossed no boundary and
  // would never have been asked. The gates are all in tryDoorBoard (state.js) so the text rung runs
  // the identical law; this is the reporting half.
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

// `cb` — the radio. On by default, because a channel you have to discover is a channel nobody
// hears, and off in one word for a driver who would rather have the road.
//
// ⚠ THE PARSE ORDER IS THE WHOLE DESIGN OF THIS VERB. Everything that is not one of the four
// literal controls is TREATED AS SPEECH, because the commonest thing anybody does with a CB is
// talk into it and a radio whose default action is a settings change would be absurd. The cost is
// that `cb off` can never be said out loud on the air, which is a fair trade for `cb on` meaning
// what it says; the four reserved words are listed in the status line so nobody has to guess.
async function cmdCb(args, raw, player) {
  const rig = rigOf(player);
  if (!rig) return say('You are not driving anything.');
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

// ── The air horn ─────────────────────────────────────────────────────────────
// Two chrome trumpets sit on the roof of every rig in the fleet. They were scenery until this verb
// existed, and scenery on the one machine the whole system is built around is worse than nothing:
// it is a promise the game does not keep.
//
// THE HORN IS HEARD BY THE ROOM, NOT BY YOU. That is the entire point of a horn and it is the only
// thing this function really does — the player gets the line about pulling the cord, and everyone
// standing in the zone gets the noise and a line of their own. A horn only you can hear is a
// keypress, and there is no reason for it to be a verb at all.
//
// IT WORKS IN BOTH PLACES A TRUCK EXISTS. Behind the wheel it is the rig you are driving; standing
// in a yard it is the one parked there, because reaching up into an open cab and pulling the cord
// is a thing people do, and because the walkaround now puts you at arm's length from the door.
// `horn [seconds]` — how long the driver held the cord, so the yard hears a toot or a long lean on
// it. ⚠ CLAMPED HERE, not trusted from the client: the cab is the only thing that sends a number and
// a client is not the authority on how long a noise everybody else has to listen to goes on for.
// An argument-less `horn` (any other caller, an older client, somebody typing it) is unchanged.
const HORN_MAX = 4;
async function cmdHorn(args, raw, player) {
  const held = Number(args?.[0]);
  const secs = Number.isFinite(held) ? Math.max(0.15, Math.min(HORN_MAX, held)) : null;
  const rig = rigOf(player);
  let typeId = rig?.typeId || null;
  let name = null;
  if (!typeId) {
    const zone = getZone(player.current_zone);
    const depot = depotAt(zone);
    if (!depot) return say('There is nothing here with a horn on it.');
    // ANY OF THEM WILL DO. This is the one caller that does not care which truck it got: a horn is a
    // noise the yard hears, and nobody standing in it could tell you which of your cabs it came out
    // of. Asking "which one?" for a sound effect would be a prompt charging rent for nothing.
    const truck = (await trucksAt(player.id, depotZonesOf(zone, depot)))[0];
    if (!truck) return say('You have nothing parked here to lean into.');
    typeId = truck.type_id; name = truck.name || truck.type?.name;
  }
  // Everyone else in the room, including the sound. Excluding the player is deliberate: their own
  // copy rides back on the emote below, so nobody hears it twice.
  //
  // ⚠ THE SOUND EVERY TIME; THE SENTENCE ONCE A MINUTE. These are two different kinds of thing and
  // they were sharing a cooldown of none. A horn is MEANT to be leaned on — three quick blasts is a
  // thing drivers do and every one of them should be audible — but three lines of identical prose
  // in everybody's log is not a horn, it is spam, and the fourth is what makes somebody scroll past
  // the sentence that mattered. So the packet is unthrottled and the PROSE is on a per-player 60s
  // gate, kept in RAM on the live rig (or on the player, for somebody honking a parked truck):
  // nothing about a noise deserves a DB write.
  sendToZone(player.current_zone, { type: 'truck_horn', typeId, secs }, player.id);
  const holder = rig || player;
  const now = Date.now();
  const sayIt = !holder._hornSaidAt || now - holder._hornSaidAt > HORN_SAY_MS;
  if (sayIt) {
    holder._hornSaidAt = now;
    sendToZone(player.current_zone, { type: 'emote', message:
      `<span class="text-amber">An air horn goes off somewhere very close to you${secs && secs > 1.6 ? ', and goes on going off' : ''}.</span>` }, player.id);
  }
  // ⚠ NOT to the driver when they held it themselves: the cab has been sounding its own horn since
  // the moment the cord moved (see hornDown), and a second copy arriving on the way back is the
  // same blast twice, a few hundred milliseconds apart. An argument-less `horn` — anybody who typed
  // it, any other caller — still gets its sound from here, because nothing local played one.
  if (secs == null) sendToPlayer(player.id, { type: 'truck_horn', typeId });
  // ⚠ AND THE DRIVER'S OWN LINE IS ON THE SAME GATE, which is the half that actually matters: the
  // room sees one line an hour from somebody else's truck, and the driver sees one per pull of
  // their own. Their SOUND already played locally before this ever reached the server (see hornDown
  // in cab-view), so a suppressed line is a horn that sounds and does not narrate — which is what a
  // horn does. Silence, not a refusal: nothing has gone wrong and there is nothing to say about it.
  if (!sayIt) return { type: 'noop' };
  return say(rig
    ? '<span class="text-amber">You pull the cord. Two notes, a long way apart, and the sound of them goes out across everything.</span>'
    : `<span class="text-amber">You reach up into the cab of ${name ? `<b>${name}</b>` : 'it'} and pull the cord. The yard rings with it.</span>`);
}

// ── Breakdowns ───────────────────────────────────────────────────────────────
// `fix` — the roadside attempt. See the four rules in rig.js: this buys DISTANCE, never health,
// and it cannot fail forever (each attempt raises the odds of the next). It is deliberately not
// the bench's `rig repair`: no money changes hands, nothing is ordered, and the truck is exactly
// as worn out at the end of it as it was at the start.
async function cmdFix(args, raw, player) {
  const rig = rigOf(player);
  if (!rig) return say('You are not driving anything.');
  if (!rig.broken) {
    return say(rig.dry
      ? 'There is nothing wrong with it that a tank of diesel would not solve.'
      : 'Nothing on it is broken. Wear is a bench job — see <span class="text-dim">rig repair</span>.');
  }
  const b = BREAKDOWNS[rig.broken.kind] || BREAKDOWNS.hose;

  // THE TERMINAL GATE. A rig at the bottom of the condition bar is not broken, it is finished, and
  // there is nothing in a toolbox that answers that. This is the one refusal in the whole system
  // that does not offer another attempt — it offers the tow instead, which is the point.
  if (isTerminal(rig.condition)) {
    return say('<span class="text-amber">You get the panel up and stand looking at it for a while.</span>\n'
      + '<span class="text-dim">There is nothing here to fix. It is not one thing that has gone — it is everything, all at '
      + `once, the way it always is in the end. You are not driving this out. <b>${teachVerb('tow', 'tow')}</b> is the number to call.</span>`);
  }

  // THE PARTS. `fix` used to need nothing at all and came good by the fourth attempt for anybody,
  // which made a breakdown a delay rather than a decision. The decision now happens hours earlier,
  // at a depot, when you either bought a box of spares or told yourself you would be fine.
  const spares = await sparesInHand(player);
  if (!spares) {
    return say(`<span class="text-amber">You know exactly what ${b.label} needs. You do not have it.</span>\n`
      + `<span class="text-dim">A box of truck spares is a depot counter and a few credits, and it is the difference between `
      + `this and a tow. <b>${teachVerb('tow', 'tow')}</b>, then.</span>`);
  }
  const fab = await effectiveSkill(player, 'fabrication');
  if (fab < FIX_MIN_FAB) {
    return say('<span class="text-amber">You have the part in your hand and no idea which end of it goes where.</span>\n'
      + `<span class="text-dim">This is a job for somebody who has done it before. <b>${teachVerb('tow', 'tow')}</b>.</span>`);
  }
  const odds = fixOdds(fab, rig.broken.attempts);
  rig.broken.attempts++;
  // THE PART IS SPENT ON THE ATTEMPT, NOT ON THE SUCCESS. You cut the hose to length before you
  // find out whether it holds, and a system where failure costs nothing is a system where you
  // simply retry until it works — which is what this replaced.
  await spendSpares(spares);
  if (Math.random() >= odds) {
    await awardSkillUse(player.id, 'fabrication', 0);
    return say(`<span class="text-amber">You get at ${b.label} with what is in the box, and it beats you. `
      + `You are dirtier, the light is worse, and it is still broken.</span> <span class="text-dim">Again, then.</span>`);
  }
  // FIXED, FOR A WHILE. The grace window is the whole design: it is why you limp to a town instead
  // of living out here with a spanner, and it is why the bench still exists.
  rig.broken = null;
  rig.fixGrace = FIX_GRACE_TILES;
  await awardSkillUse(player.id, 'fabrication', 2);
  pushCab(rig, { fixed: true });
  return say(`<span class="item-grant">${b.fixed}</span>\n`
    + `<span class="text-dim">It will hold for a while. It is not repaired — that is a bench and a bill, and the bar on it has not moved.</span>`);
}

// ── parts, spares and `rig strip` → bench.js ─────────────────────────────────
// They went with the counter that sells them. `fix` above still SPENDS a spares box, and imports
// `sparesInHand`/`spendSpares` back for it — the roadside is where one gets used, the yard is where
// one gets bought, and there is exactly one definition of what a box is.

// ── tow ──────────────────────────────────────────────────────────────────────
// THE WAY OUT, AND THE ONLY ONE THAT COSTS MONEY. Everything else in this system can be answered
// with time, a spanner or a walk; this is what a driver reaches for when the truck is genuinely
// finished, and it is deliberately expensive, because the whole of the condition bar means nothing
// if the bottom of it is cheap.
//
// TWO OUTCOMES, and the second one is why this can never strand anybody:
//
//   PAID     — a low-loader comes out, the rig goes back to the depot it started from, and you go
//              with it. The truck is still wrecked; a tow is transport, not a repair. That bill is
//              the bench's, and it is waiting for you.
//   UNPAID   — the recovery firm takes it anyway and holds it against the fee. That is an IMPOUND,
//              which this system already has and already knows how to release: `drive` pays the
//              lot and hands the truck back, so there is no new verb, no new state, and no way to
//              end up with a truck that exists nowhere. You still get carried home. You are broke
//              and on foot and your truck is behind a fence, which is a hole to dig out of rather
//              than a dead end — and it is the honest price of driving a rig into the ground.
//
// Reusing the impound path is the entire reason this is short. The alternative — a debt column, a
// bespoke "recovered" state, a second release verb — would have been three new pieces of state to
// answer a question `impound_fee` already answers.
async function cmdTow(args, raw, player) {
  const rig = rigOf(player);
  if (!rig) return say('You are not driving anything, so there is nothing out here to come and get.');
  if (!rig.broken && !rig.dry && !isTerminal(rig.condition)) {
    return say('It is going. Whatever you think is wrong with it, a recovery driver is going to charge you to '
      + 'tell you the same thing. <span class="text-dim">If you have simply had enough, <b>park</b>.</span>');
  }
  const truck = rig.truckId ? await getTruck(rig.truckId, player.id) : null;
  if (!truck) return say('There is no paperwork on this thing. Nobody is coming out for it.');

  // Home is the depot it belongs to. Not the nearest one — a recovery firm takes a truck to the
  // yard whose name is on the movement order, which is the yard you set out from.
  const homeId = truck.depot_zone || rig.fromDepot || rig.zoneId;
  const fee = towFee(truck.type, rig.zoneId || homeId, homeId);
  const canPay = (player.credits || 0) >= fee;

  // The truck comes off the road either way, and that is one statement rather than two branches:
  // where it ends up is the same, only who owns the debt changes.
  await query(
    'UPDATE trucks SET depot_zone=$1, impound_fee = COALESCE(impound_fee,0) + $2 WHERE id=$3 AND owner_id=$4',
    [homeId, canPay ? 0 : fee, truck.id, player.id]
  ).catch(() => {});
  if (canPay) {
    player.credits = (player.credits || 0) - fee;
    await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
    sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  }

  // The load is dropped with the truck, not carried by a man in a cab — a recovery driver is not
  // going to hand-ball somebody else's freight into the back of their pickup.
  const lostLoad = rig.cargo ? ' The load goes back to the yard on the same ramps, and the contract on it is dead.' : '';
  rig.cargo = null;

  // Down off the road, on `park`'s own machinery — the truck's home is written above, so the rig's
  // own zone is set to match before the flush, and everything else (the text run, the fuel and
  // odometer flush, the posture, closing the pane) is the sequence park already established.
  rig.zoneId = bayForYard(homeId)?.zone.id || homeId;
  dismountRig(player.id);
  stopTextDrive(player.id);
  await flushZone(player, rig);
  // The road remembers this one too. A recovered rig left a wreck on the shoulder exactly as an
  // abandoned one does — it is the same truck, in the same place, for the same reason.
  if (rig.leg !== 'city') markWreck(rig, player);
  await persistTruck(rig);
  setPosture(player, 'standing');
  // YOU GET THE RIDE, and that is the whole difference between this and `park`. Walking away leaves
  // you where you stood; a tow is a thing you are IN, so the player travels with the truck.
  const homeZone = getZone(rig.zoneId) || getZone(homeId);
  if (homeZone && homeZone.id !== player.current_zone) {
    removePlayerFromZone(player.current_zone, player.id);
    player.current_zone = homeZone.id;
    addPlayerToZone(homeZone.id, player.id);
    await query('UPDATE players SET current_zone=$1 WHERE id=$2', [homeZone.id, player.id]).catch(() => {});
  }
  sendToPlayer(player.id, { type: 'truck_sim_close' });
  // Same as `park`: the cab holds the area-pane until the close above lands, so the room has to be
  // re-asked afterwards rather than composed here. More so on this path — you RODE somewhere, and
  // the pane would otherwise still be showing the last room you stood in before the drive.
  sendToPlayer(player.id, { type: 'force_look' });

  return say(canPay
    ? `<span class="text-amber">You make the call and then you sit on the step for a long time.</span>\n`
      + `<span class="text-dim">The low-loader that turns up is older than your truck and considerably better maintained. `
      + `You ride back in the passenger seat with your boots on the dash, and nobody says anything the whole way.${lostLoad} `
      + `The ${truck.type.name} is at ${depotNameOf(homeId)}, and it is going to need a bench.</span> <span class="item-loss">-${fee}₵</span>`
    : `<span class="text-amber">You make the call. The recovery driver looks at your account, then at the truck, then at you.</span>\n`
      + `<span class="text-dim">They take it anyway — that is the part people forget about recovery firms — and they keep it. `
      + `${fee}₵ is what it costs to see it again, and it is sitting behind their fence at ${depotNameOf(homeId)} until you have it.${lostLoad} `
      + `They drop you at the gate. It is a long way to anywhere from there.</span>`);
}

// ── truckevent ───────────────────────────────────────────────────────────────
// Discrete transitions, mirroring plugins/flight cmdFlightEvent. Kept off the sync route so the
// hot path stays a pure numeric frame.
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

  // A MISSED SHIFT. Same split of responsibility as the collision below: the CLIENT owns the
  // gearbox (the whole box is client-side — flight-model.js — and always has been), so it is the
  // only thing that can know a shift was fluffed; the server owns what it costs. There is nothing
  // to clamp here because there is no number to lie about — a grind is a grind — so the defence is
  // a RATE LIMIT instead: a shift takes about a second even done badly, so anything faster than
  // that is not a driver and is dropped. It never narrates. The bar is the message, and a line in
  // the log every time somebody fluffs a change would be the most irritating text in the game.
  if (ev === 'grind') {
    const now = Date.now();
    if (rig._lastGrindAt && now - rig._lastGrindAt < 900) return { type: 'noop' };
    rig._lastGrindAt = now;
    // Under load it is worse, and that is the one distinction worth drawing: grinding a bobtail
    // box is careless, grinding one with forty tonnes behind it is expensive. Same arithmetic the
    // rest of this file uses for weight — the trailer and its load against the tractor's own mass.
    const laden = 1 + Math.min(2, ((rig.trailer?.kg || 0) + (rig.cargo?.kg || 0)) / 20000);
    applyDamage(rig, grindSplit(laden));
    return { type: 'noop' };
  }

  // Building collision. The CLIENT owns the geometry and asserts the hit — exactly the split the
  // flight sim already uses for CFIT (`flightevent crash|clip`), and for the same reason: the
  // server has no footprint data at all and shipping it there to re-validate would double the
  // geometry for no gain. What the server owns is the CONSEQUENCE, and it clamps the one number
  // the client could lie about — the speed it claims to have hit at.
  if (ev === 'bump' || ev === 'crash') {
    const mph = Math.max(0, Math.min(70, Number(args[1]) || 0));
    rig.speed = 0;
    // ONE INCIDENT, ONE LINE. The client rebounds off geometry and rate-limits its own reports, but
    // a driver working along a row of shopfronts can still land several inside a few seconds, and
    // the log is the thing that suffers. This is the server's own floor under that: below it the
    // impact still WEARS the rig — the bill is real either way — it simply does not narrate.
    const now = Date.now();
    const quiet = rig._lastImpactAt && now - rig._lastImpactAt < 8000;
    rig._lastImpactAt = now;
    // The rig wears what it hit. In RAM like every other wear on this path, clamped off the same
    // server-side speed the crime code trusts — so a client cannot claim a gentle nudge to save
    // itself a repair bill any more than it can claim a gentle nudge to dodge the police.
    // WHERE IT LANDS, not just how much. `wearForImpact` still owns the total (and still clamps
    // off the server's own speed, so a client cannot claim a gentle nudge to save itself a bill);
    // `impactSplit` decides which components eat it, off the area the client observed. A rear
    // impact with a box on the back is the trailer's, not the tractor's — which is the whole
    // reason the trailer has its own bar.
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

    // NO CHARGE FOR HITTING A BUILDING. This used to raise `vandalism` through the witnessed-crime
    // system whenever a city-leg impact cleared RECKLESS_MPH, and the reasoning was sound in the
    // abstract — you have destroyed somebody's property in the street, which is what that charge is
    // for. In practice it was the one consequence in the whole sim that nobody could consent to:
    // the corridor is narrow, the buildings ARE the corridor walls, and the collision probe is a
    // geometric sweep with no notion of intent, so an ordinary bend taken slightly wide put stars
    // on a driver who was doing the job correctly. A wanted level you acquire by steering is not a
    // crime system, it is a tax on the render distance.
    //
    // The truck still pays: it wears (above), the load still spoils (below), and the rebound costs
    // you every mile an hour you had. Damage to the rig is the consequence, and it is enough of one.
    // (If deliberate ramming ever needs charging, that wants a test for INTENT — repeated impacts
    // on the same structure, at speed, off-route — not a speed threshold on an accident.)
    const inTown = rig.leg === 'city';

    // The load takes it. A trailer full of somebody else's freight that has just been through a
    // wall is worth less than it was, and the contract pays on what arrives.
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
          ? `\n<span class="text-dim">People are coming out to look at it. Nobody has a slate out — they have seen worse done to that wall.</span>`
          : ''),
    };
  }
  return { type: 'noop' };
}

// ── The rim: city → corridor ─────────────────────────────────────────────────
// Driving off the edge of the world. This is the same event walking off it is, so it goes through
// voidwalking's own `launchCrossing` rather than a truck-shaped copy of it: the crossing is
// created, the five player_flags are written, the entry room is entered, and the ghost-trace cache
// is warmed. The truck then lays its road over whatever chain that produced.
async function leaveTheMap(player, rig, broadcast) {
  const from = getZone(rig.zoneId || player.current_zone);
  const gate = voidGateOf(from);
  if (!gate) {
    // The map ran out but there is no void behind this edge — back onto the last real tile.
    const back = surfaceAt(Math.round(rig.x), Math.round(rig.y)) ? null : from;
    if (back && back.grid_x != null) { rig.x = back.grid_x; rig.y = back.grid_y; }
    rig.speed = 0;
    pushCab(rig, { stopped: true });
    sendToPlayer(player.id, { type: 'emote', message: '<span class="text-amber">The road simply stops. Past the last of the hardtop there is nothing anybody has built a way through.</span>' });
    return { type: 'noop' };
  }

  await flushZone(player, rig);                 // the drive through town is committed here, once
  const res = await launchCrossing(player, gate, broadcast, null);
  const info = player._crossing && crossingInfo(player._crossing.instanceId);
  if (!info) { await forcedPark(player); return res || { type: 'noop' }; }

  // WHICH WAY. This used to be `dests[0]` — the first row of the table, forever — which quietly
  // made half the map unreachable by road: Terminus is designed as a truck destination (it is
  // deliberately beyond the range of the two cheapest rigs, so the fleet ladder doubles as a map
  // gate) and no truck could ever be pointed at it. The aim comes from the LOAD first, because a
  // contracted run already knows where it is going and asking twice would be ceremony; then from
  // whatever the driver set with `route`; then, only if neither exists, the first limb.
  const destKey = aimedDest(info, rig)?.key || info.dests?.[0]?.key;
  const chain = destKey ? crossingChain(player._crossing.instanceId, destKey) : [];
  if (!chain.length) { await forcedPark(player); return res || { type: 'noop' }; }

  joinCorridor(rig, { instanceId: player._crossing.instanceId, destKey, voidKey: info.voidKey,
    window: info.window, chain, dest: crossingDest(player._crossing.instanceId, destKey),
    trunk: info.trunk });
  rig.zoneId = player.current_zone;
  pushCab(rig, { joined: true });
  // …and the sidebar's road window with it. `zone.entered` only fires on a NODE BOUNDARY, so
  // without this the map stays on the city street you left until you have driven a full room —
  // which is exactly the stretch where somebody looks at it to see what they have driven into.
  pushRoadWindow(player);
  const aimed = info.dests?.find(d => d.key === destKey);
  sendToPlayer(player.id, {
    type: 'emote',
    message: '<span class="text-amber">The last streetlight goes by and the hardtop gives way to something graded rather than built. The map ends. The road, for whatever it is worth out here, does not.</span>'
      + (aimed ? `\n<span class="text-dim">Running for ${aimed.heading}.${(info.dests?.length || 0) > 1 ? ` The fork is ${info.trunk} rooms out — ${teachVerb('route', 'route')} until you take it.` : ''}</span>` : ''),
  });
  return { type: 'noop' };
}

// ── The fork ─────────────────────────────────────────────────────────────────
// Which limb this rig is pointed down. The LOAD outranks the driver's own aim deliberately: a
// contracted haul is a promise with a destination on it, and quietly driving it somewhere else
// because a `route` from an hour ago is still set would be the system lying about what it is
// doing. A free rig obeys the aim; a rig with neither takes the first limb, as it always did.
// `aimedDest` and `destByWord` moved to routes.js — the GPS screen needs them too, and two
// copies of "which fork is this rig pointed at" is exactly the drift this whole module exists
// to prevent. Imported above.
// `route` — where this rig is going, and the one verb that changes it.
//
// It answers in two different worlds and deliberately reads as one thing in both: standing in a
// yard it sets the aim for a crossing you have not started, and out on the trunk it TAKES THE
// OTHER LIMB, because both limbs are already built and the trunk tarmac is the same road either
// way (see switchLimb). Past the junction it refuses, and says why — a fork you can take from
// forty tiles down the wrong limb is not a junction, it is a menu.
async function cmdRoute(args, raw, player) {
  const rig = rigOf(player);
  if (!rig) return say('You are not driving anything.');
  const opts = routeOptions(rig, { zoneId: player.current_zone, forkAhead: atOrBeforeFork(rig) });
  if (!opts) return say('There is one road out of here and you are on it.');
  const onRoad = opts.onRoad;
  const info = onRoad && rig.instanceId ? crossingInfo(rig.instanceId) : null;
  const dests = (info?.dests || VOIDS[getZone(player.current_zone)?.flags?.region_id]?.dests || []);

  const want = args.join(' ');
  if (!want) {
    // The rows are routeOptions', not this function's — the same rows the GPS screen paints, so the
    // verb and the dash can never tell a driver two different things about the same fork.
    const lines = opts.dests.map((d) => {
      const mark = d.current ? '<span class="text-green">▸</span>' : ' ';
      const reach = d.reach === 'ok' ? ''
        : d.reach === 'thin' ? ' <span class="text-amber">— further than your tank, one way</span>'
        : ' <span class="text-red">— well past your range</span>';
      return `${mark} <b>${d.heading}</b> <span class="text-dim">(${d.key}) — ${d.miles} miles${reach}</span>`;
    });
    const how = onRoad
      ? (opts.forkAhead ? `<span class="text-dim">The fork is still ahead. <b>route &lt;name&gt;</b> to take the other one.</span>`
        : `<span class="text-dim">The fork is behind you. This is the road you are on now.</span>`)
      : `<span class="text-dim"><b>route &lt;name&gt;</b> to set it before you leave the map. A contracted load overrides it — the run goes where the paperwork says.</span>`;
    return say(`<span class="text-green">Out of ${opts.origin || 'here'}, the road forks toward:</span>\n${lines.join('\n')}\n${how}`);
  }

  const pick = destByWord(dests, want);
  if (!pick) return say(`Nothing out here goes to "${want}".`);
  if (!onRoad) {
    rig.aim = pick.key;
    return say(`<span class="text-green">You settle on ${pick.heading}.</span> <span class="text-dim">Take the rim and the road will do the rest.</span>`);
  }
  if (pick.key === rig.destKey) return say(`You are already on the ${pick.heading} road.`);
  if (!atOrBeforeFork(rig)) {
    return say(`<span class="text-amber">The fork is a long way behind you. There is no cutting across out here — the only way onto the ${pick.heading} road is back the way you came.</span>`);
  }
  const chain = crossingChain(rig.instanceId, pick.key);
  if (!chain.length) return say('That limb is not there. Something has gone wrong with the crossing.');
  switchLimb(rig, { destKey: pick.key, chain, dest: crossingDest(rig.instanceId, pick.key) });
  rig.aim = pick.key;
  pushCab(rig, { rerouted: true });
  return say(`<span class="text-green">You take the other one.</span> <span class="text-dim">The road bends away east of where you were going and the country ahead stops looking familiar. Running for ${pick.heading}.</span>`);
}

// Roll off the end of the corridor and into the destination region. The crossing's own
// `zone.entered` handler sees a room outside its roomSet and tears the instance down — the same
// path a walker takes when they step out the far side.
// You do NOT dismount here. Coming off the highway puts you on the destination region's real
// tiles, still driving — the last mile into a yard is part of the haul, and a delivery only counts
// when the rig is standing in the depot that ordered it.
// ── TURNING ROUND AND GOING HOME ─────────────────────────────────────────────
// `arrive`'s mirror, and deliberately its near-twin rather than a shared helper with two modes:
// the two differ in the zone they land on, the prose, and the fact that coming back is not a
// delivery, and a single function taking a direction flag would be three `if`s wearing a hat.
//
// The origin is read from the crossing rather than remembered on the rig, because the crossing is
// what actually knows — `originZone` is the tile the trunk's first room exits back into, which is
// the same tile a walker reappears on. Landing anywhere else would mean a truck and a pedestrian
// leaving the same waste by the same road and coming out in two different places.
async function retreat(player, rig) {
  const info = rig.instanceId ? crossingInfo(rig.instanceId) : null;
  const home = info && getZone(info.originZone);
  // No origin tile to land on is the one case that cannot be narrated, so it takes `park`'s own
  // fail-safe: you end up out of the cab and on your feet rather than in a sim with no world.
  if (!home || home.grid_x == null) { await forcedPark(player); return; }

  removePlayerFromZone(player.id, player.current_zone);
  addPlayerToZone(player.id, home.id);
  player.current_zone = home.id;
  // Outside the crossing's roomSet, so voidwalking tears the instance down on this event exactly
  // as it does for an arrival — a run you abandoned is still a run that ended.
  emit('zone.entered', { actor: player, zone: home.id });
  await query('UPDATE players SET current_zone=$1 WHERE id=$2', [home.id, player.id]).catch(() => {});

  leaveCorridor(rig, home.grid_x, home.grid_y, rig.heading);
  rig.zoneId = home.id; rig.zoneDirty = false;
  pushCab(rig, { arrived: true });
  // THE LOAD IS STILL ON THE DECK AND THE CONTRACT IS STILL LIVE. Coming back is not a failure
  // state and must not be charged as one — you have burned the diesel and lost the time, which is
  // punishment enough for changing your mind, and the run is still there to be driven again.
  sendToPlayer(player.id, {
    type: 'emote',
    message: '<span class="text-amber">The waste lets go of you and the gate comes back up out of the haze, from the wrong side. You are where you started, with less fuel and a day you will not get back.</span>'
      + (rig.cargo ? `\n<span class="text-dim">${rig.cargo.name} still on the deck, still bound for ${rig.cargo.toName}.</span>` : ''),
  });
  // A text run was aiming at somewhere on the far side; that target is meaningless now, and a rung
  // that kept driving would simply turn straight round and set off again.
  if (isTextDriving(player.id)) stopTextDrive(player.id);
}

async function arrive(player, rig) {
  const dest = rig.dest && getZone(rig.dest);
  if (!dest || dest.grid_x == null) { await forcedPark(player); return; }

  removePlayerFromZone(player.id, player.current_zone);
  addPlayerToZone(player.id, dest.id);
  player.current_zone = dest.id;
  // The destination is OUTSIDE the crossing's roomSet, so voidwalking's own `zone.entered`
  // handler sees it and tears the instance down — the identical path a walker takes out the far
  // side. Nothing here knows how a crossing ends, and that is the point.
  emit('zone.entered', { actor: player, zone: dest.id });
  await query('UPDATE players SET current_zone=$1 WHERE id=$2', [dest.id, player.id]).catch(() => {});

  leaveCorridor(rig, dest.grid_x, dest.grid_y, rig.heading);
  rig.zoneId = dest.id; rig.zoneDirty = false;
  pushCab(rig, { arrived: true });
  sendToPlayer(player.id, {
    type: 'emote',
    message: `<span class="text-green">The haze thins, and there it is — low buildings, a water tower, lights that somebody pays for. The wheels find hardtop again.</span>${rig.cargo ? `\n<span class="text-dim">${rig.cargo.name} still on the deck, bound for ${rig.cargo.toName}.</span>` : ''}`,
  });
  if (rig.cargo && dest.id === rig.cargo.to) await deliver(player, rig);

  // A text run has to be told where to go next. Coming off the highway lands you at the region's
  // gate tile, which is not usually the yard — the last mile in is still part of the haul, and a
  // driver who is being driven should not be abandoned on the apron.
  if (isTextDriving(player.id)) {
    const to = rig.cargo?.to || allDepots().find(d => d.flags?.region_id === dest.flags?.region_id)?.id;
    if (to && to !== dest.id) setTextTarget(player.id, { target: to, wantsRim: false });
    else stopTextDrive(player.id);
  }
}

// ── Discovery ────────────────────────────────────────────────────────────────
// A system nobody can find is a system nobody has. Before this hook the ONLY route into the whole
// of THE LONG HAUL was typing `drive` blind while standing on one of three specific street tiles —
// no prose mentioned it, no furniture offered it, and `help` is hand-maintained so a plugin verb
// never appears there on its own.
//
// So the yard says what it is. `zone.describeRoom` is the same seam voidwalking's rim warning uses
// (`describeRim`), and the verbs carry `teachVerb` shimmers per the house convention: the first
// mention of a verb anywhere is a click-to-run link, not a word you have to notice and retype.
async function describeDepot(zone, player) {
  // THE SCALE ANNOUNCES ITSELF, and that is load-bearing rather than decorative. The entire design
  // is "a decision you make BEFORE the inspection you know is coming" — a weighbridge you cannot
  // see ahead of you is a dice roll, and a dice roll is not a system. It reads from a tile away in
  // the cab too, because the plates are drawn on the road.
  const scale = scaleAt(zone);
  if (scale) {
    return `<span class="ambient">The plates of ${scale.name} are set into the road here, and the board over the booth is lit. `
      + `Anything crossing with a box behind it goes over them.</span>`;
  }

  // A DOCK SAYS IT IS ONE. The board sends you to a street name, so the street has to confirm you
  // found it — otherwise a local run is a guess, and the point of city driving is that it is
  // navigation rather than a guess.
  const dock = dockAt(zone);
  if (dock) {
    return `<span class="ambient">A loading bay is cut into the frontage here — a lipped concrete apron at trailer height, `
      + `with ${dock.name} stencilled on the roller door and a bell push nobody has ever answered quickly.</span>`;
  }

  // THE APRON. The street outside a depot has to say the depot is there, or moving the shop indoors
  // would have hidden the entire system behind a door nobody has a reason to open. This is the one
  // sentence that replaces the whole panel that used to blow open here.
  const bay = bayForYard(zone?.id);
  if (bay && !depotAt(zone)) {
    // …AND WHAT IS STANDING ON IT. The apron is where stock is stood and where a driver drops a box,
    // so this is now the tile the "On their legs" line matters most on — without it the hardstand
    // described itself as empty concrete while a trailer sat on it.
    return `<span class="ambient">The hardstand outside ${bay.depot.name || bay.zone.name} — swept concrete, `
      + `scored with the arcs of everything that has ever backed onto it, and wide enough to turn something with a `
      + `box behind it. The office and the bays are through the roller door; the road is the road.</span>`
      + await standingLine(zone.id);
  }

  const depot = depotAt(zone);
  if (!depot) return undefined;
  let line = `<span class="ambient">Trucks stand nose-out along the fence with chalk prices on their screens, and `
    + `somebody has bolted a board beside them with paper on it that is actually fresh. `
    + `You could look over the ${teachVerb('yard', 'yard')}, read what needs ${teachVerb('haul', 'haul')}ing, `
    + `or see what the ${teachVerb('market', 'market')} is paying today. `
    + `With a rig of your own you could ${teachVerb('drive')}.</span>`;

  // PLAYER-OWNED RIGS PARKED HERE. The `trucks` table has carried `depot_zone` since the day it was
  // written and nothing showed it — a truck existed to its owner and to nobody else, which for a
  // 16,500₵ object standing in a public yard is simply wrong. Modelled on flight's "On the ramp:"
  // (plugins/flight/index.js describeAirfield): the same shape, so a yard full of trucks reads like
  // a ramp full of aircraft because it IS the same fact.
  //
  // ⚠ THE CLICK IS `drive`, NOT `examine`, AND THAT IS A FIX RATHER THAN A PREFERENCE. The line was
  // copied off the ramp complete with `examine <name>` — but flight SHADOWS the examine verb so a
  // parked aircraft resolves by name (see craftActionMenu), and nothing here does: a truck is not
  // an item, an NPC or a piece of furniture, so SIFT cannot see one and every click on a parked rig
  // answered "You don't see \"orlov continental\" here." A dead link is worse than no link, and the
  // trailer line two functions down already had the right answer — it sends `hitch <id>`, the verb
  // you actually want. So this sends `drive <id>`: click the truck, get in the truck.
  //
  // Somebody ELSE's rig is named and not linked. It is still in the room — a 16,500₵ object in a
  // public yard is a fact about the place — but offering a stranger a button that can only refuse
  // is an affordance that lies.
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

// STANDING TRAILERS. The whole of phase 2.9 is that a dropped box is a thing in a place, and a
// thing in a place that the room does not mention is a thing nobody will ever find again. Loaded
// ones say so, because "there is a trailer here with freight still on it" is the sentence the
// entire drop-and-come-back loop exists to produce.
//
// Factored out because it is now needed on TWO tiles — the bay, and the hardstand outside it where
// stock is stood and boxes are dropped. Returns '' rather than undefined so it appends cleanly.
async function standingLine(zoneId) {
  const standing = await trailersAt(zoneId);
  if (!standing.length) return '';
  const list = standing.slice(0, 6).map(t =>
    `<span class="action-link" data-action="cmd" data-cmd="hitch ${t.id}" title="back under it">${t.name}</span>`
    + (t.cargo ? ` <span class="text-dim">(loaded)</span>` : '')).join(', ');
  return `\n<span class="furniture-label">On their legs:</span> <span class="text-dim">${list}.</span>`;
}

// You cannot walk while you are driving. Without this the two systems disagree about where you
// are: an ordinary `south` steps you down the spine while the rig's odometer still says otherwise,
// and the next node crossing yanks you back. `park` is the answer, and the message says so —
// a gate that blocks without naming its own escape hatch is just a bug with prose.
registerMoveGate(({ player }) => {
  if (!player || !rigs.has(player.id)) return undefined;
  return { block: true, message: "You're behind the wheel — you'd have to <b>park</b> and climb down first." };
}, 'trucking');

// WALK IN AND THE YARD OPENS. Exactly what flight does for a hangar interior (plugins/flight
// index.js, the `zone.entered` handler on `hangar_interior`) and for the same reason: a place whose
// whole purpose is a set of choices should present them, not wait to be typed at. Walking back out
// closes it. The verbs survive as the deliberate way in; this is the discovered one.
//
// Skipped while DRIVING — rolling through a depot on the way somewhere should not throw a shop
// window over the windscreen.
on('zone.entered', async ({ actor, zone: zoneId, from }) => {
  try {
    if (!actor) return;
    // ── THE SIDEBAR MAP'S HIGHWAY ──────────────────────────────────────────────
    // Every step in the void and every node boundary the odometer crosses come through here, which
    // is exactly the cadence this wants: one packet per room, not one per tick. `pushRoadWindow`
    // is a no-op for anyone not on a crossing, so the ordinary case — a step down a city street —
    // costs one function call and sends nothing.
    //
    // ⚠ AND IT IS OUTSIDE THE DEPOT BRANCH BELOW, which returns early. Put inside it, the clear
    // would not fire for a driver who walked off a crossing straight into a yard — and a stale
    // highway under the depot panel is the exact failure this is here to prevent.
    try { pushRoadWindow(actor); } catch (e) { console.error('[trucking] mmroad:', e.message); }
    const zone = getZone(zoneId);
    const depot = depotAt(zone);
    if (depot && !rigs.has(actor.id)) {
      const panel = await depotPanel(actor, zone, depot, 'fleet');
      // The log rung gets prose, and prose is a message rather than a panel.
      sendToPlayer(actor.id, panel.type === 'emote' ? { type: 'output', message: panel.message } : panel);
      return;
    }
    // ⚠ AND WALKING OUT CLOSES IT — FROM ANY OF THE THREE TILES. This asked `depotAt(from)`, which
    // is only ever true of the BAY, so leaving from the apron or the facade left the shop window
    // hanging over the road: you parked (which now opens the yard), stepped out onto the hardstand,
    // walked off up the street, and the depot went with you. `depotFrom` is the same reachability
    // `depotHere` gives a player, and it answers for the whole place.
    //
    // …and only when you have actually LEFT it. Stepping from the bay to its own apron is walking
    // about inside one depot, and closing the panel there would make the roller door a wall.
    const leftDepot = from ? depotFrom(from) : null;
    if (leftDepot && !depotFrom(zoneId)) sendToPlayer(actor.id, { type: 'truck_depot_close' });
  } catch (e) { console.error('[trucking] depot auto-open:', e.message); }
});

// A driver who dies, logs out, or otherwise stops being a driver leaves no rig behind in RAM.
// (The crossing itself is voidwalking's to clean up; this is only the steering wheel.)
// LOGGING OUT IN THE CAB IS NOT LOSING THE TRUCK. This used to be a bare `rigs.delete(id)`, which
// is correct as cleanup and wrong as consequence: a dropped socket in the middle of the waste ended
// the haul, and the haul is the game. `saveDrivingState` writes ONE record and then deletes the rig
// itself, so the cleanup still happens on every path. See resume.js for what is and is not stored.
// A dive bomber winding up overhead, heard from the cab. The flight plugin cannot reach a driver
// through the room pane — a rig on the city leg is standing in a zone but the driver is looking
// at a windshield, and on the corridor leg there is no real zone at all — so it announces raw
// world coords and each vehicle system answers for its own. City leg only: the corridor is a
// synthetic highway across the void and its coordinates are not world tiles, so a distance
// comparison there would be comparing two different grids and would fire at random.
on('vehicle.diveSiren', ({ gx, gy, reach, name }) => {
  for (const rig of rigs.values()) {
    if (rig.leg !== 'city') continue;
    if (Math.max(Math.abs(rig.x - gx), Math.abs(rig.y - gy)) > (reach || 6)) continue;
    sendToPlayer(rig.playerId, { type: 'emote', message: `<span class="text-amber">⚠ A siren winds up somewhere above the cab — a ${name || 'dive bomber'}, coming down.</span>` });
  }
});

on('player.logout', ({ id }) => { saveDrivingState(id).catch(() => rigs.delete(id)); });
// …and back in. Nothing here can strand a login: every failure inside returns false and leaves the
// player standing exactly where the ordinary login put them.
on('player.login', async ({ id }) => {
  const player = getLivePlayer(id);
  if (player) await restoreDrivingState(player, { mountOnCrossing }).catch(() => {});
});
// `player.death` emits `{ player, killer, cause, ... }` — NOT `{ id }` like the two handlers above.
// Destructuring `id` here silently made this a no-op on every death path, which left the cab mounted
// over a player who had already been moved to their respawn zone: a black windshield you cannot leave.
on('player.death', ({ player }) => {
  const id = player?.id;
  if (id && rigs.has(id)) { rigs.delete(id); sendToPlayer(id, { type: 'truck_sim_close' }); }
});

// ── The fifth wheel ──────────────────────────────────────────────────────────
// `hitch` and `unhitch` are the only two verbs in this plugin that ask the PHYSICS whether they are
// allowed, rather than deciding for themselves — `canHitch` is a speed and an angle, and the model
// already knows both. That is deliberate: a docking rule enforced in a verb and a docking rule
// enforced in the sim would be two rules, and the one the player feels is the sim's.
//
// Phase 2.9: A TRAILER IS A ROW, not a boolean. You drop it and it stays dropped, in a zone that
// will still exist tomorrow, with whatever is on it still on it — and somebody else can walk up to
// it. See trailers.js for the two rules that shape that (the DB enforces one-per-truck; a transient
// void room can never hold one).
async function cmdHitch(args, raw, player) {
  const say = (message) => ({ type: 'emote', message });
  const rig = rigOf(player);
  if (!rig) return say('You would need to be in a truck. <b>drive</b>.');
  if (rig.trailer) return say(`Already hitched: ${rig.trailer.name}.`);
  if (Math.abs(rig.speed) > HITCH_MPH) return say('Not at this speed. Stop first — the pin will not find the plate with the truck rolling.');
  // ⚠ A DEPOT IS THREE ZONES AND A TRAILER ONLY EVER SITS IN ONE OF THEM. This read the single tile
  // under your wheels, and that made a bought trailer unreachable on every real depot in the game:
  // `yard buy` parks it in the BAY (with the trucks, under the roof — see yardBuyTrailer), while a
  // truck can only ever be standing on the DOOR tile or the apron, because you cannot drive in a
  // room with no road in it. Bay ≠ door ≠ yard, so `hitch` answered "nothing standing here" from
  // the only positions it is possible to ask from.
  //
  // It survived because the regress fixture is a single road tile that is its own bay AND its own
  // yard, which collapses all three and makes the case pass — the same fixture-shaped blind spot
  // that hid the legacy depot shape. The suite now buys and hitches at a REAL depot too.
  //
  // Widened to the depot's own zone set, which is the rule `drive` and the ownership lookups have
  // always used: the shed and the hardstand outside it are one place. This is deliberately NOT a
  // relaxation of where you have to BE — `hitchReach` still runs, so a POSED trailer (one somebody
  // dropped) still has to be under the fifth wheel to half a tile. All this changes is which pile
  // of boxes the verb is allowed to look at.
  const here = getZone(player.current_zone);
  const standing = (await Promise.all(hitchZones(here?.id).map(z => trailersAt(z)))).flat();
  if (!standing.length) return say('Nothing standing here to back under. Trailers are bought and left at yards — see the <b>yard</b>.');

  // ⚠ A BARE `hitch` TAKES THE NEAREST ONE IN REACH, NOT THE OLDEST ROW. A yard holds as many of
  // your own boxes as you have paid for, standing a few feet apart, and picking the first row meant
  // backing under one trailer and coupling to another — or, worse, being refused for a box on the
  // far side of the apron while sitting square under the one you meant. Falls back to the old
  // choice when nothing is in reach at all, so the "line it up on it" answers still come from a
  // sensible box rather than from nothing.
  const mine = standing.filter(t => !t.ownerId || t.ownerId === player.id);
  const pool = mine.length ? mine : standing;
  const gap = (t) => (posed(t) ? Math.hypot((rig.x ?? 0) - t.x, (rig.y ?? 0) - t.y) : 99);
  const nearest = pool.filter(t => hitchReach(rig, t).ok).sort((a, b) => gap(a) - gap(b))[0];
  const want = args.length
    ? standing.find(t => t.id === args[0] || t.name.toLowerCase().includes(args.join(' ').toLowerCase()))
    : nearest || pool[0];
  if (!want) return say(`Nothing here by that name. Standing in the yard: ${standing.map(t => t.name).join(', ')}.`);

  // Somebody else's box is somebody else's box. This is the one place trucking says no on grounds
  // of ownership rather than physics, and it is deliberate — an unattended trailer being takeable
  // would make the whole "leave it and come back" loop a coin-flip rather than a plan.
  if (want.ownerId && want.ownerId !== player.id) return say(`${cap(want.name)} is not yours. The pin is locked and the plate has somebody else's number on it.`);

  // ── YOU HAVE TO BACK UNDER IT ─────────────────────────────────────────────
  // A trailer now stands at a POSE rather than merely in a room, so hitching stopped being a menu
  // choice and became a manoeuvre: get the fifth wheel under the pin, square-ish, at a crawl. The
  // rule lives in trailers.js so the cab's HITCH button can light itself off the same test the verb
  // enforces — a button that offers something the verb then refuses is worse than no button.
  const reach = hitchReach(rig, want);
  if (!reach.ok) {
    if (reach.why === 'far') return say(`${cap(want.name)} is standing ${reach.d < 1.2 ? 'just' : ''} too far off to couple. Line the truck up on it and back under.`);
    if (reach.why === 'angle') return say(`You are across it, not under it. Straighten up on ${want.name} and try again.`);
    // The flank. A separate answer from 'far' because the driver is not far away at all — they are
    // beside the box, which looks close and is the one place the pin can never be.
    if (reach.why === 'across') return say(`You are alongside ${want.name}, not on its pin. The fifth wheel has to come up its centreline — pull round and back onto the nose.`);
    return say('Not at this speed. Stop first — the pin will not find the plate with the truck rolling.');
  }

  // ⚠ THE GUARD IS THE TRAILER'S OWN ZONE, NOT THE ONE UNDER YOUR WHEELS. `hitchTrailer` writes
  // `WHERE parked_zone = $3`, which is what makes two drivers going for the same box a race the
  // database settles rather than the server. It was handed `here.id` — fine while the only findable
  // trailers were on the tile you stood on, and a silent no-op the moment the search widened to the
  // bay: the row would match nothing, and the honest "somebody pulled out from under you" line
  // would fire every single time for a box standing in the shed with nobody near it.
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
  if (!rig?.trailer) return say('You are bobtail already.');
  if (Math.abs(rig.speed) > HITCH_MPH) return say('Stop the truck first.');
  const here = getZone(player.current_zone);
  // The whole of rule 2. A dropped trailer must stand somewhere that is still there tomorrow, and
  // a transient void room is not — it goes when the crossing ends, and a trailer in one would be a
  // row pointing at nothing. On the corridor that is a no, and it says why.
  if (!canDrop(here)) {
    return say('Not out here. There is nothing to leave it standing ON — the waste closes behind you, and a trailer you drop in it is a trailer you have thrown away. Get it to a yard, or to a street.');
  }
  const t = rig.trailer, hadLoad = !!rig.cargo;
  // The load STAYS ON IT — that is the point of a trailer being a thing rather than a state.
  await saveLoad(t.id, rig.cargo || null, t.stash || null);
  // WHERE YOU LEFT IT: the tractor's own pose at the moment the pin came out, so the box stands
  // exactly where it was dropped and the next driver has to line up on it.
  await dropTrailer(t.id, here.id, { x: rig.x, y: rig.y, heading: rig.heading });
  rig.trailer = null; rig.cargo = null;
  await refreshStanding(here.id);           // …and now it IS standing there, at the pose above
  pushCab(rig);
  return say(`Legs down, pin out, air lines off. You pull forward and ${t.name} stands there without you${hadLoad ? ', load and all' : ''}. The truck feels like a different animal.`);
}
export const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

// ── stash / unstash ──────────────────────────────────────────────────────────
// What makes the scale house a DECISION rather than a tax. Something goes in the trailer that is
// not on the paper, and from then on the weighbridge is a thing you have to think about — which is
// the entire design in one verb pair.
//
// It is deliberately NOT a smuggling skill check. Putting a crate behind a false bulkhead always
// works; what it does is add weight, and weight is the thing the scale can see. There is no roll
// here because there is nothing to roll for — see scale.js.
//
// Note it uses `resolveInventoryItem`, so it reads exactly like every other "do a thing with an
// item you are carrying" verb in the game and answers a SIFT prompt when the name is ambiguous.
async function cmdStash(args, raw, player) {
  const rig = rigOf(player);
  if (!rig) return say('Not in a truck.');
  if (!rig.trailer) return say('There is nothing behind you to hide it in. <b>hitch</b> a trailer first.');
  if (!args.length) {
    const on = rig.trailer.stash || [];
    if (!on.length) return say('Nothing behind the bulkhead. <span class="text-dim">stash &lt;something&gt;</span>');
    return say(`Behind the bulkhead: ${on.map(s => `${s.name} <span class="text-dim">(${s.kg} kg)</span>`).join(', ')}. `
      + `<span class="text-amber">${stashKg(rig.trailer)} kg that is not on your paper.</span>`);
  }
  const hit = await resolveInventoryItem(player, { name: args.join(' ') });
  if (!hit) return say("You aren't carrying that.");
  if (hit.type) return hit;                                  // a SIFT disambiguation prompt — pass it through
  // WEIGHT IS THE WHOLE POINT, so it comes off the item's own `weight` and is never invented. An
  // item with no weight is a light one, not a free one — 5 kg keeps the scale honest about the fact
  // that you did put something in there.
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

// Taking it back out. There is no roll here either — the risk was always the scale, and a driver who
// thinks better of it a mile short of the weighbridge has made exactly the play the system is for.
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

// ── pickup / dropoff ─────────────────────────────────────────────────────────
// Somebody on the shoulder. See hitchers.js for why these are seeded facts rather than NPC rows,
// and for the fugitive, who is the point.
async function cmdPickup(args, raw, player) {
  const rig = rigOf(player);
  if (!rig) return say('Not in a truck.');
  if (rig.leg !== 'corridor') return say('There is nobody out here on foot. This is a city.');
  if (rig.rider) return say(`${cap(rig.rider.look)} is already in the sleeper.`);
  const who = rig.hitchDone?.has(rig.node) ? null : hitcherAt(rig.route, rig.node, rig.chain?.length || 1);
  if (!who) return say('Nobody on this stretch. Just the road.');
  if (Math.abs(rig.speed) > 6) return say('Not at this speed. They step back from the wash and you are past them.');

  // WHERE they ride is the decision, and it is only offered for the one it matters for. Everybody
  // else takes the seat, because for everybody else there is nothing to hide.
  const where = (args[0] || '').toLowerCase();
  if (who.id === 'fugitive' && !['sleeper', 'trailer', 'cab'].includes(where)) {
    return say(`${cap(who.look)}.\n\n${who.line}\n\n`
      + `<span class="text-dim">They mean the wall behind you, and they mean the box. `
      + `<b>pickup sleeper</b> — fast, and anyone who looks in the cab finds them. `
      + `<b>pickup trailer</b> — nobody looks, and they weigh what a person weighs.</span>`);
  }
  const inTrailer = where === 'trailer';
  if (inTrailer && !rig.trailer) return say('There is no box back there to put anybody in.');

  // ⚠ THE STRETCH IS SPENT, AND IT HAS TO BE RECORDED SOMEWHERE. 'hitcherAt' is a pure function of
  // the route and the node — that is its whole design, and it is what makes everybody driving this
  // road this week meet the same person. It also means it goes on answering with them forever. Drop
  // somebody off where you found them and they are instantly standing on the shoulder again with
  // their hand out, which is the one reading of this system that is plainly a bug.
  //
  // Per-RIG and in memory only, deliberately: the seeded fact is that a person is on that stretch,
  // and the fact that YOU have already dealt with them is not a fact about the road. A second
  // driver still meets them, and so do you next week, when the window rolls and the seed changes.
  (rig.hitchDone || (rig.hitchDone = new Set())).add(rig.node);
  rig.rider = { ...who, inTrailer, boarded: rig.node };
  // FORCED, not throttled. 'pushCab' with no 'extra' is skipped while the centre tile is unchanged,
  // and a pickup happens at a standstill by definition — so without this the figure went on standing
  // on the shoulder and the alert went on offering a PICK UP button for somebody already in the seat.
  const boarded = { boarded: true };
  if (inTrailer) {
    // THE LINKAGE. A person is eighty kilos, and the weighbridge does not care what the eighty
    // kilos is for. Riding back there makes them contraband in the only sense the scale understands.
    const list = [...(rig.trailer.stash || []), { itemId: null, name: 'somebody who is not on the paper', kg: 80 }];
    rig.trailer.stash = list;
    await saveLoad(rig.trailer.id, rig.cargo || null, list);
  }
  pushCab(rig, boarded);
  return say(`<span class="text-green">You pull up and ${inTrailer ? 'walk back to open the doors' : 'lean over and shove the passenger door open'}.</span>\n\n`
    + `${cap(who.look)}. ${who.line}\n\n`
    + (inTrailer
      ? `<span class="text-amber">They climb up into the dark and you shut them in. The trailer is eighty kilos heavier than your paper says.</span>`
      : `<span class="text-dim">They put their bag between their feet and do not say much after that.</span>`));
}

async function cmdDropoff(args, raw, player) {
  const rig = rigOf(player);
  if (!rig?.rider) return say('Nobody riding with you.');
  if (Math.abs(rig.speed) > 6) return say('Stop the truck first.');
  const who = rig.rider;
  rig.rider = null;

  // Taking the weight back out again — which is the whole play the system exists to allow: letting
  // somebody out a mile short of the scale is a real, unscripted decision, and it is free.
  if (who.inTrailer && rig.trailer) {
    const list = (rig.trailer.stash || []).filter(s => s.itemId !== null || s.kg !== 80);
    rig.trailer.stash = list;
    await saveLoad(rig.trailer.id, rig.cargo || null, list);
  }

  // What they were worth, paid at the moment they get out, because none of it is knowable before.
  let extra = '';
  if (who.id === 'mechanic') {
    if (rig.dry) { rig.fuel = Math.max(rig.fuel, 0.18); rig.dry = false; extra = `<span class="item-grant">She spends twenty minutes under the tank with a length of hose and gets you enough to be going on with. You are not walking after all.</span>`; }
    else extra = `<span class="text-dim">"Nothing wrong with it. Keep it that way."</span>`;
  } else if (who.id === 'local') {
    rig.fuel = Math.min(1, rig.fuel + 0.12);
    extra = `<span class="item-grant">He takes you off the road at a place you would have driven straight past, and you come back onto it a good way further along with more in the tank than the distance says you should have.</span>`;
  } else if (who.id === 'chancer') {
    const purse = 120 + Math.round((rig.travelled || 0) / 4);
    player.credits = (player.credits || 0) + purse;
    await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
    sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
    extra = `<span class="item-grant">They count it out on the seat before they go. ${purse}₵.</span>`;
  } else if (who.id === 'fugitive') {
    const purse = 400;
    player.credits = (player.credits || 0) + purse;
    await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
    sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
    extra = `<span class="item-grant">They put ${purse}₵ on the seat, and they are gone off the shoulder before you have picked it up.</span>`;
  }
  pushCab(rig, { boarded: false });
  return say(`They get down and shut the door.\n\n${extra}`);
}

// ── lock / unlock ────────────────────────────────────────────────────────────
//
// ⚠ THESE ARE ENGINE BUILTINS AND PLUGINS BEAT BUILTINS. `lock` and `unlock` belong to
// server/engine/commands/doors.js, and a plugin that registers a verb wins outright — so claiming
// them naively would silently take the door lock away from every apartment, shop shutter, cell and
// hatch in the game, for everyone, forever. That is the exact trap the chess plugin's `move` note
// warns about, and it fails in a way nobody would connect back to trucking.
//
// So the router is NARROW and it FALLS THROUGH: returning `undefined` hands the input back to the
// engine, which then runs the ordinary door command as though nothing here existed. It only keeps
// the verb when the answer is unambiguous — you are behind the wheel of a truck, and you either said
// nothing after it or named the cab. `lock apartment` while sitting in a rig parked in your own
// garage still locks the apartment.
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
  // Written through immediately rather than coalesced into the park flush. This is a deliberate,
  // infrequent act — not per-tick state — and the whole value of the latch is that it is still where
  // you left it next time you climb up. A lock that forgot itself on a disconnect would be worse
  // than no lock, because you would believe in it.
  if (rig.truckId) await saveTruckData(rig.truckId, player.id, rig.cd);
  pushCab(rig, { latch: want });
  return say(want
    ? '<span class="text-dim">You reach across and put both latches down. Whatever is out there stays out there.</span>'
    : '<span class="text-dim">The latches come up. The doors will open from outside now — either side.</span>');
}

// ── the galley ───────────────────────────────────────────────────────────────
//
// WHAT IS IN THE CAB THAT YOU COULD EAT. A haul is long, hunger and thirst run the whole time, and
// the only surface that could answer "what have I got" was the tablet — which means stopping,
// leaving the glass, and coming back. A driver was starving to death inside a working truck with
// food in the bunk, which is not a difficulty curve, it is a missing door.
//
// THE RULE THIS FOLLOWS IS THE PREPARATION HUD'S, and deliberately: the panel holds no gameplay
// logic and every row it draws is a VERB STRING a player could have typed. 'eat sandwich' is what
// the button sends and 'eat sandwich' is what a keyboard sends; there is no cab-only eating path,
// no cab-only restore, and nothing here re-derives whether a thing is edible — that is the item's
// tags and the ordinary consume path's business, exactly as it is everywhere else.
//
// ⚠ AND IT IS ANSWERED ON DEMAND, NEVER ON THE PUSH. 'cabContext' runs several times a second on
// the drive; putting an inventory join in it would be a remote round trip per push, on the hottest
// path this plugin owns. So this is a verb: one query, when a driver opens the flap, and never
// again until they open it again. The vitals themselves cost nothing at all — hunger and thirst
// are already on the live player object and already reach the client on every 'player_update', so
// the bars and the warning band on the glass are drawn from what the client had anyway.
async function cmdGalley(args, raw, player) {
  const { rows } = await query(
    `SELECT pi.id, pi.quantity, i.name, i.tags
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1 AND pi.container_id IS NULL
        AND (jsonb_exists(i.tags, 'consumable') OR jsonb_exists(i.tags, 'drinkable'))
      ORDER BY i.name`,
    [player.id]
  );
  // WHICH VERB EACH ROW WANTS. 'drink' for anything that restores thirst more than it restores
  // hunger, 'eat' otherwise — the same reading a player makes looking at a bottle, and it is only
  // ever a LABEL: both verbs route into the identical consume path, so a mislabelled row costs a
  // word and never a mechanic.
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
  // The LOG gets the same answer, because a surface a player cannot reach is not the only rung —
  // display-mode's rule is that the record reaches the log at every rung or the rung is not done.
  if (!items.length) return say('You go through the bunk and the door pockets. Nothing to eat, nothing to drink.');
  return say(`<span class="text-dim">In the cab:</span>
`
    + items.map(i => `  <b>${i.verb} ${i.name}</b>${i.qty > 1 ? ` <span class="text-dim">×${i.qty}</span>` : ''}`).join('\n'));
}

// ── customs ──────────────────────────────────────────────────────────────────
// One verb, three answers, and each is a real trade rather than a better and worse version of the
// same thing. See scale.js for what each one costs.
//
// TRUCKING DOES NOT OWN THE VERB, and must not. `customs` is already the FLIGHT plugin's — it is
// what you type at the Reach's air customs desk — and `customs` is one player-facing concept, not
// two. Two plugins claiming it would be a coin-flip decided by load order.
//
// So this is an ACTION, and flight's own handler dispatches it when its desk is holding nothing of
// yours. That is exactly the seam `SMUGGLE_RAW_SCAN` already established: the checkpoint plugin
// runs a drug scan through smuggle's economy without importing smuggle, and here flight answers a
// scale-house question without importing trucking. Neither direction of dependency is created.
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

// ── The box, on the text rung ────────────────────────────────────────────────
// Phase 2.5. These are the typed half of the SAME controls the cab puts under a key and a button:
// `revs up` is the `.` key, `boot` is A, `brake` is Z, `jake` is C. One model, three input surfaces.
//
// It is `revs` and `boot`, not `gear` and `throttle`, because the FLIGHT plugin already owns both
// of those words — `gear` is landing gear — and two plugins claiming one verb is a coin-flip
// decided by load order. The regress manifest sweep is what catches that class of collision.
function cmdTextDrive(what) {
  return (args, raw, player) => textDriveCommand(player.id, what, args[0]) || say('Not while you are out of the truck.');
}

// ── `ride` / `hop` — getting into somebody else's truck ──────────────────────
//
// The passenger half of the cab. An aircraft has carried people since charter; a truck could not
// carry anyone at all, which meant the only way two people crossed the void together was to walk it.
//
// ⚠ THE TRUCK HAS TO BE STOPPED, AND THAT IS THE WHOLE SAFETY MODEL RATHER THAN A COURTESY. The rig
// is a client-simulated object reconciled four times a second; boarding one mid-move would put a
// second player's `current_zone` under a position that is already stale. Stopped is also what the
// hijacker gate reads (`hijack.js`, STOPPED_MPH), so a cab is boardable by a stranger under exactly
// the conditions it is workable by one, which is the honest version of getting into a truck.
const RIDE_STOPPED_MPH = 1;

// How close a rig has to be, out in the waste, to be a truck you could walk up to.
const REACH_TILES = 6;
// How far ahead a driver sees an arm out. Generous on purpose: at road speed a rig covers a lot of
// ground between the alert and the place, and an alert you cannot act on is just noise.
const BEACON_SEE_TILES = 45;

// Every rig you could get into from here. `rigs` is keyed by driver, so this is the only way to ask
// "what is standing here" without the caller knowing that.
//
// ⚠ SAME ROOM, OR NEAR ENOUGH BY COORDINATE — and the second half is not a convenience. A crossing is
// INSTANCED: two people in the same gap are in different transient rooms with different ids, so a
// walker and a driver who are plainly looking at each other share no zone and never will. Position is
// the only thing they have in common out there, which is exactly why the trail carries coordinates.
// In a city both tests agree, because a street is one room for everybody.
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
    // Never across a map boundary: a rig on the world grid is not reachable from inside a building
    // that happens to sit on the same coordinates.
    if (rz.map_id !== here.map_id) continue;
    const d = Math.hypot(rz.grid_x - hx, rz.grid_y - hy);
    if (d <= REACH_TILES) out.push({ rig, driver: drv, dist: d });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

async function cmdRide(args, raw, player) {
  if (rigOf(player)) return { type: 'error', message: 'You are driving. `park` first if you want somebody else to.' };
  if (ridingRigOf(player)) return { type: 'error', message: 'You are already riding. `hop` to get down.' };

  const here = rigsInReach(player);
  if (!here.length) return { type: 'error', message: 'There is no truck here to ride in.' };

  const want = args.join(' ').trim().toLowerCase();
  const pick = want
    ? here.find(({ driver }) => driver.handle?.toLowerCase().includes(want))
    : (here.length === 1 ? here[0] : null);
  if (!pick && want) return { type: 'error', message: `Nobody called "${args.join(' ')}" is sitting in a truck here.` };
  // ⚠ NEVER GUESS BETWEEN TWO CABS. Climbing into the wrong stranger's truck is not a thing to
  // resolve by picking the first one in a Map.
  if (!pick) return { type: 'error', message: `Which one? ${here.map(({ driver }) => driver.handle).join(', ')}.` };

  const { rig, driver } = pick;
  if (Math.abs(rig.speed || 0) > RIDE_STOPPED_MPH)
    return { type: 'error', message: `${driver.handle} is still rolling. You would have to be quicker than that.` };
  if (seatsFree(rig) <= 0)
    return { type: 'error', message: `There is no room in the cab.${rig.rider ? ' Somebody is already in the sleeper.' : ''}` };

  boardPassenger(rig, player);
  sendToPlayer(driver.id, { type: 'emote',
    message: `<span class="text-green">${player.handle} pulls the door open and swings up into the cab.</span>` });
  sendToZone(player.current_zone, { type: 'zone_event',
    message: `${player.handle} climbs up into ${driver.handle}'s cab.` }, player.id);
  return { type: 'emote',
    message: `<span class="text-green">You haul yourself up into ${driver.handle}'s cab and pull the door shut.</span>`
      + `\n<span class="text-dim">You are along for the ride. ${teachVerb('hop', 'hop')} to get down wherever they stop.</span>` };
}

async function cmdHop(args, raw, player) {
  const rig = ridingRigOf(player);
  if (!rig) return undefined;   // not riding: fall through, so the word is free for anything else
  const driver = getLivePlayer(rig.playerId);
  // ⚠ MOVING OR NOT, YOU CAN ALWAYS GET OUT. Refusing would make a passenger the only person in the
  // game who can be held somewhere against their will by another player, and no amount of narration
  // makes that a feature. Stepping down at speed simply costs you.
  const rolling = Math.abs(rig.speed || 0) > RIDE_STOPPED_MPH;
  alightPassenger(player);
  if (driver) sendToPlayer(driver.id, { type: 'emote',
    message: rolling
      ? `<span class="text-amber">${player.handle} gets the door open and goes out of it while you are still moving.</span>`
      : `<span class="text-dim">${player.handle} drops down out of the cab.</span>` });
  return { type: 'emote', message: rolling
    ? '<span class="text-amber">You get the door open, pick your moment, and it is still a worse landing than you wanted.</span>'
    : '<span class="text-green">You drop down out of the cab.</span>' };
}

export const commands = {
  drive: cmdDrive,
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
  haul: cmdHaul,
  market: cmdMarket,
  yard: cmdYard,
  rig: cmdRig,
  fuel: cmdRefuelTruck,
  truckpump: cmdTruckPump,
  trucksync: cmdTruckSync,
  truckevent: cmdTruckEvent,
  galley: cmdGalley,
  // ⚠ ROUTERS, NOT HANDLERS. Both fall through to the engine door commands unless you are
  // actually behind a wheel — see cabLatchRouter.
  lock: cabLatchRouter(true),
  unlock: cabLatchRouter(false),
};

export const hooks = {
  'zone.describeRoom': describeDepot,
  // DIESEL'S PRICE, ANSWERED BY THE THING THAT CHARGES IT. A forecourt price board asks the room
  // what it sells; trucking is the only system that knows what a tank costs, so it says so here
  // rather than letting a sign keep a second copy of `FUEL_FULL` that retuning would not update.
  // A tile with no pump on it answers nothing, which is how a board in a bar stays blank.
  // `each` is the PYLON's number, and it is derived here rather than by the sign for the same
  // reason `price` is: a board out by the road quotes a retail rate per pump-unit, and only this
  // file knows what a unit of diesel is. Trucking bills a tank as a fraction (`t.fuel` is 0..1), so
  // the retail unit is one percent of a tank — `FUEL_FULL / 100`, which is what a driver taking
  // half a tank is charged fifty of. One constant, two presentations, no second copy to retune.
  'fuel.prices': (zone) => pumpAt({ leg: 'city', zoneId: zone?.id })
    ? { grade: 'DIESEL', unit: 'tank', price: FUEL_FULL, each: FUEL_FULL / 100, note: 'a full tank, any rig — the pylon prices it by the percent' }
    : null,
  // Flight asks 'who else is out there'; trucking answers with its moving rigs. A gather hook so
  // the dependency stays one-way — flight has never heard of trucking and does not need to.
  'vehicle.contacts': (x, y, range) => truckContactsNear(x, y, range),
  // ONE VERB, TWO SYSTEMS. `hijack` belongs to surveillance (breaching a camera) and plugin verbs
  // are first-come, so trucking cannot register it and must not try. Surveillance instead gathers
  // this hook when the name you typed is not a device it can find, and whoever claims the target
  // runs the attempt — so "break into the thing you named" keeps meaning one thing, nobody learns
  // a second word for it, and neither plugin imports the other. Returning null is a real answer:
  // it means "not mine", and the verb goes back to its own error.
  'hijack.target': (player, nameHint) => playerHijack(player, nameHint),
};

// ── NOTHING IS LOST OUT THERE, IT JUST GETS EXPENSIVE ────────────────────────
// A truck parked on the corridor holds a TRANSIENT void room as its `depot_zone`, and that room
// stops existing the moment the last member walks out of the crossing. Left alone that is a rig
// which cannot be found, driven, sold or repaired: the row is intact and points at nothing.
//
// So the road drags it home. This is deliberately the SAME landing a breakdown gets (`parkRig`'s
// abandonment branch) rather than a second idea about lost trucks — the yard it set out from, an
// impound fee to get it out, settled by the `drive` path that already knows how to bill one.
// Where "the yard it set out from" comes from is `custom_data.void_home`, written at the moment
// of parking because that is the only moment anybody knows it; a truck that somehow has none
// falls back to the crossing's own origin tile.
//
// ⚠ THE FEE IS ONLY EVER SET, NEVER RAISED, and "already impounded" is `NULLIF(…, 0)` rather than
// `IS NULL`. The recovery write clears a lot by setting the fee to ZERO (fleet.js `recoverTruck`)
// and every reader here tests it for truthiness — `if (owned.impound_fee)`, `t.impound_fee || 0` —
// so 0 and NULL are the same state and a plain COALESCE would preserve the 0 and never charge at
// all. Two sweeps reaching the same truck is not hypothetical: the teardown fires when the
// crossing ends, and the boot sweep fires on every restart.
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
  // The count of trucks actually RESCUED, not of rows looked at — a truck with nowhere to be put
  // is skipped above, and reporting it as moved would make the log say the opposite of the truth.
  return moved;
}

// The crossing ended with somebody's rig still standing in it. Fired before the rooms are
// unregistered — see the ⚠ in voidwalking's teardownInstance.
on('crossing.ended', async ({ rooms, origin }) => {
  const n = await recoverTrucksFrom(rooms, origin).catch(() => 0);
  if (n) console.log(`[trucking] recovered ${n} truck(s) from a crossing that ended.`);
});

// AND THE RESTART CASE, WHICH THE EVENT CANNOT COVER. Crossings live in RAM, so a server that
// comes back up has none — every truck still holding a void room is dangling by definition, and
// no teardown will ever fire for it. Void rooms are the only ids shaped `xing_…` (see
// voidwalking's `xing_${leader.id}_${_seq}`), which makes this a single indexed prefix scan rather
// than a walk of the fleet. Deferred one tick so the plugin finishes loading first; failure here
// must never be the thing between the server and booting.
setTimeout(async () => {
  const { rows } = await query(`SELECT DISTINCT depot_zone FROM trucks WHERE depot_zone LIKE 'xing\\_%'`)
    .catch(() => ({ rows: [] }));
  if (!rows.length) return;
  const n = await recoverTrucksFrom(rows.map(r => r.depot_zone), null).catch(() => 0);
  if (n) console.log(`[trucking] recovered ${n} truck(s) stranded in void rooms by a restart.`);
}, 0);

// Hijackers try the door of any STOPPED cab they are standing next to. Scheduled rather than run
// off a movement event because the thing it watches for is a truck that is NOT moving — there is no
// event for "still here", and the whole mechanic is about time passing while you sit. Idle-gated by
// default (schedule's own behaviour) and it returns immediately when nobody is in a rig, which on
// this server is almost always.
schedule('5s', () => tickHijackers());

export const _test = { boardFor, allDepots, mountSpot, depotFrom, bunkFrom, hitchZones, allDocks, dockAt, depotAt, depotZonesOf, describeDepot, LOADS, RECKLESS_MPH, hydrateFromTruck, recoverTrucksFrom };

console.log('[trucking] Plugin loaded.');
