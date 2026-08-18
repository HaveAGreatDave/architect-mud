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
import { crossingChain, crossingDest, crossingInfo, voidGateOf, launchCrossing, VOIDS } from '../voidwalking/index.js';
import { routeOptions, aimedDest, destByWord } from './routes.js';
import { surfaceAt } from '../flight/state.js';
import { rigs, rigOf, mountRig, dismountRig, reconcileTruck, crossToNode, driveToZone, flushZone,
  joinCorridor, leaveCorridor, unbog, pushCab, cabContext, surfaceUnder, truckContactsNear,
  announceBreak, switchLimb, atOrBeforeFork, cbLine, markWreck, pumpAt, pumpClamp, FUEL_FULL } from './state.js';
import { corridorPos, corridorAt, TILES_PER_ROOM, wreckNear } from './corridor.js';
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
  hitchReach, posed, refreshStanding, stockPose, standStock, paintTrailer, boxColour } from './trailers.js';

const say = (msg) => ({ type: 'emote', message: msg });

// Below this, a contact is a scrape and nobody calls anybody. Above it, you have demolished part of
// a street at the wheel of several tonnes, and in a city that is witnessed.
const RECKLESS_MPH = 22;

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
  const rig = mountRig(player, { x: here.grid_x, y: here.grid_y, heading: spot.heading, depot: yardId || here.id });
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
  await standStock(yardCtx?.bay || null, yardCtx?.yard || getZone(yardId), spot?.heading ?? 180);
  // WHATEVER IS STANDING AT THIS DEPOT, so it is drawn from the first frame. Both tiles, because
  // you mount on the DOOR and the stock stands on the HARDSTAND — one refresh meant a driver
  // starting the engine looked out at an empty yard until the wheels crossed the boundary.
  await Promise.all([...new Set([here.id, yardId].filter(Boolean))].map(z => refreshStanding(z)));
  rig.truckId = owned.id;
  rig.typeId = owned.type_id;
  // WHAT YOU BOUGHT IS WHAT YOU DRIVE. `rig.params` is the tuned, kitted, worn parameter set from
  // rig.js, and it is what the cab is handed — the client used to hardcode TYPES.hauler, so every
  // truck in the game drove exactly like the 4,200₵ Courier and the fleet ladder bought a price tag
  // and a silhouette and nothing else.
  rig.type = owned.type;
  rig.cd = owned.custom_data || {};
  rig.condition = owned.condition ?? 1;
  rig.dmg = damageOf({ cd: rig.cd, condition: owned.condition });
  rig.condition = overall(rig.dmg);
  rig.params = effTruckParams(owned.type_id, rig.cd, rig.condition, rig.dmg);
  rig.burnMul = burnMul(rig.cd);           // a hard turbo drinks; the aux tank is on `params.tank`
  rig.fuel = owned.fuel ?? 1;
  rig.travelled = 0;
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
function whichTruckLine(verb, list, want, byId = false) {
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
const yardIdOf = (zone, depot) => depot?.yard || null;
// ── WHERE A RIG IS STANDING WHEN YOU CLIMB INTO IT ───────────────────────────
// Pulled out of `cmdDrive` so it can be ASSERTED rather than trusted. It was four lines inline,
// which meant the one thing worth pinning — that you start inside the shed facing the way out, and
// not back on the apron — was reachable only by buying a truck and driving it, and so was pinned
// nowhere. A refactor could have quietly put the player back outside and nothing would have gone
// red. Pure: takes the zone you are standing in, returns the tile to mount on, which way to point,
// and whether a roller door is in front of you.
const OUT_HEADING = { north: 0, east: 90, south: 180, west: 270 };
export function mountSpot(stood) {
  const depot = depotAt(stood);
  if (!depot) return null;
  const door = stood.flags?.world_exit_zone ? getZone(stood.flags.world_exit_zone) : null;
  // A bay with a facade puts you INSIDE it. Anything else — a depot authored straight onto a road
  // tile, which is what the test fixtures are — mounts where it always did.
  if (door && door.grid_x != null) {
    const heading = OUT_HEADING[door.flags?.entrance];
    return { zone: door, heading: heading != null ? heading : 180, fromShed: true, depot };
  }
  const yard = getZone(yardIdOf(stood, depot));
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
const depotZonesOf = (zone, depot) => {
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
function mountOnCrossing(player) {
  const live = player._crossing;
  const info = crossingInfo(live.instanceId);
  if (!info) return say('The road will not resolve. Try the crossing on foot.');
  const destKey = info.dests?.[0]?.key;
  if (!destKey) return say('The road out of here goes nowhere anyone has charted.');
  const chain = crossingChain(live.instanceId, destKey);
  if (!chain.length) return say('The road will not resolve. Try the crossing on foot.');

  const rig = mountRig(player, { x: 0, y: 0 });
  joinCorridor(rig, { instanceId: live.instanceId, destKey, voidKey: info.voidKey,
    window: info.window, chain, dest: crossingDest(live.instanceId, destKey) });
  // Line the rig up on the room the player is actually standing in, not the roadhead.
  const at = chain.indexOf(player.current_zone);
  if (at > 0) {
    rig.node = at;
    rig.s = at * TILES_PER_ROOM;
    const p = corridorPos(rig.route, rig.s, 0);
    rig.x = p.x; rig.y = p.y; rig.heading = p.heading;
  }
  setPosture(player, 'driving');
  sendToPlayer(player.id, { ...cabContext(rig, { mounted: true }), type: 'truck_sim' });   // type AFTER the spread — see cmdDrive
  return say('<span class="text-green">There is a rig at the roadhead with the keys still in it. You climb up, and the diesel catches on the second turn.</span>');
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

async function cmdHaul(args, raw, player) {
  const here = getZone(player.current_zone);
  if (!depotAt(here)) return say('No freight office here. The yards keep the boards.');
  const board = boardFor(here.id);
  if (!board.length) return say('The board is empty. Nowhere to run to from here.');
  const rig = rigOf(player);

  const pick = args[0] ? parseInt(args[0], 10) : NaN;
  if (Number.isNaN(pick)) {
    const lines = board.map(b =>
      `  <b>${b.i + 1}.</b> ${b.name} — <b>${b.kg} kg</b> to <b>${b.toName}</b>${b.crosses ? ' <span class="text-amber">(across the waste)</span>' : b.local ? ` <span class="text-dim">(in town — ${b.where})</span>` : ''} · <span class="item-grant">${b.pay}₵</span>`);
    return { type: 'emote', message: `<b>${here.name} — freight board</b>\n${lines.join('\n')}\n<span class="text-dim">haul &lt;number&gt; to take one.</span>` };
  }
  const job = board[pick - 1];
  if (!job) return say('No such load on the board.');
  if (!rig) return say('Get in a truck first — <b>drive</b>.');
  if (!rig.trailer) return say('You are bobtail — there is nothing behind you to put it on. <b>hitch</b> a trailer first.');
  if (rig.cargo) return say(`You're already loaded: ${rig.cargo.name}, for ${rig.cargo.toName}.`);
  rig.cargo = { ...job };
  pushCab(rig);
  return say(`<span class="item-grant">Loaded: ${job.name}. ${job.kg} kg, bound for ${job.toName}. ${job.pay}₵ on delivery.</span>`);
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
  if (sub === 'sell') return await yardSell(player, bay, args[1]);
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
function depotHere(player) {
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
async function repush(player, tab = 'fleet') {
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
  await standStock(bay, yard, mountSpot(bay)?.heading ?? 180);
  const region = here.flags?.region_id;
  const day = marketDay();
  const mine = await fleetOf(player.id);
  const rig = rigOf(player);
  // WHAT THE DECK HOLDS IS THE TRAILER'S RATING, not the truck's mass. It used to be the truck's,
  // because there was no trailer to ask — which meant buying a bigger tractor bought you capacity
  // it does not actually have. The truck pulls; the box carries.
  const deckKg = rig?.trailer?.ratedKg || rig?.type?.kg || DEFAULT_TRAILER_KG;
  // Three reads the bench needs, and they go out TOGETHER rather than one after another — this
  // panel already makes four round trips against a remote Postgres and the auto-open path fires
  // from a footstep. (docs/architecture.md, read tiers: Promise.all independent reads.)
  const [fab, myTrailers] = await Promise.all([
    effectiveSkill(player, 'fabrication'),
    trailersOf(player.id),
  ]);
  const towedIds = new Set(myTrailers.filter(t => t.towedBy).map(t => t.towedBy));
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
    fuel: rig ? +rig.fuel.toFixed(2) : null,
    deckKg,
    cargo: rig?.cargo
      ? { kind: rig.cargo.kind, name: rig.cargo.name, qty: rig.cargo.qty || null,
          kg: rig.cargo.kg, to: rig.cargo.toName || null, paid: rig.cargo.unitPaid || null }
      : null,
    // The two zones, so the client can say which side of the door it is showing and the log rung
    // can name the road you would roll out onto.
    bay: bay.id, yard: yard.id, yardName: yard.name, inBay: player.current_zone === bay.id,
    fab,                                    // the hand doing the work — it sets how far the dials go
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
        variant: `${t.type_id}${towed ? '+t' : ''}`,
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
      condition: +(t.condition ?? 1).toFixed(3), band: bandOf(t.condition ?? 1).key,
      towedBy: t.towedBy || null,
      hereNow: !t.towedBy && zonesHere.includes(t.parkedZone),
      where: t.towedBy ? 'hitched' : (zonesHere.includes(t.parkedZone) ? 'here' : depotNameOf(t.parkedZone)),
      cargo: t.cargo ? { name: t.cargo.name, kg: t.cargo.kg } : null,
      // What colour it is, so the yard floor draws a fleet rather than a row of black slabs. One
      // field, because a box is one colour — see boxLivery.
      colour: boxColour(t),
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
  for (const b of p.board || []) {
    rows.push({
      group: 'Freight board',
      label: b.name,
      detail: `${b.kg}kg to ${b.toName} · ${b.pay}₵${b.crosses ? ' · across the waste' : b.local ? ` · in town, ${b.where}` : ''}`,
      commands: [{ label: 'Haul', command: `haul ${b.i + 1}` }],
    });
  }
  if (!(p.board || []).length) rows.push({ group: 'Freight board', label: 'Nothing on the board today.' });

  for (const q of p.quotes || []) {
    const there = q.thereBid == null ? '' : ` · ${q.thereBid}₵ in ${p.thereName}`;
    rows.push({
      group: 'Exchange',
      label: q.name,
      detail: `buy ${q.ask}₵ · sell ${q.bid}₵ · ${q.kg}kg${there}`,
      commands: [{ label: 'Buy', command: `market buy ${q.name}` },
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
  const yard = getZone(yardIdOf(here, depot));
  const outside = yard && yard.grid_x != null ? yard : null;
  const pose = outside
    ? stockPose(outside.grid_x, outside.grid_y, mountSpot(here)?.heading ?? 180, (await trailersAt(outside.id)).length)
    : null;
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
const TOW_CALLOUT = 260;
function towFee(type, fromZoneId, toZoneId) {
  const a = getZone(fromZoneId), b = getZone(toZoneId);
  const tiles = (a && b && a.grid_x != null && b.grid_x != null)
    ? Math.hypot((a.grid_x - b.grid_x), (a.grid_y - b.grid_y))
    : 40;                                             // unknown ground (a transient waste node) — bill the long haul
  const heft = 0.6 + 0.4 * Math.min(2, (type?.price || 6000) / 9000);
  return Math.round((TOW_CALLOUT + tiles * 7) * heft);
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

async function yardSell(player, here, id) {
  if (!id) return say('Sell which? <span class="text-dim">yard sell &lt;id&gt;</span>');
  const t = await getTruck(id, player.id);
  if (!t) return say("That isn't yours.");
  if (!depotZonesOf(here, depotAt(here)).includes(t.depot_zone)) return say(`It's parked at ${depotNameOf(t.depot_zone)}. Bring it here first.`);
  if (rigOf(player)?.truckId === t.id) return say("You're sitting in it.");
  // The bodywork is in the price — see resaleValue. A dealer looks at the thing.
  const value = resaleValue(t.type, t.odometer, t.condition, damageOf({ condition: t.condition, custom_data: t.custom_data }));
  await sellTruck(t.id, player.id);
  player.credits = (player.credits || 0) + value;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await repush(player, 'fleet');
  return say(`<span class="item-grant">Sold the ${t.type.name} for ${value}₵.</span> <span class="text-dim">Somebody drives it away without looking back at you.</span>`);
}

// ── rig: the bench ───────────────────────────────────────────────────────────
// Repair, tune, kit, paint and pump, behind ONE verb with subcommands rather than five verbs.
// That is not tidiness: `repair`, `tune`, `modify` and `paintset` are all already owned — by the
// engine's gear repair, by broadcast, and by flight — and a sixth claimant on `repair` would be a
// dispatch-order puzzle for anybody who ever stood in a hangar holding a broken coat. `rig` is a
// word this system owns outright, and every button on the bench sends one of these strings.
//
// EVERY SUBCOMMAND ENDS AT THE PANEL. See `repush` — a bench command that changes a truck and
// leaves the screen showing the old numbers is the bug this whole pass exists to kill.
async function cmdRig(args, raw, player) {
  const sub = (args[0] || '').toLowerCase();
  const { bay, depot } = depotHere(player);
  if (!depot) return say('You would need to be at a depot. The benches are in the yards.');
  const rest = args.slice(1);

  // SPARES ARE SOLD BEFORE THE TRUCK IS RESOLVED, and that is not an ordering accident. Every other
  // subcommand is work done ON a machine and rightly refuses without one parked here; a box of
  // spares is stock off a shelf, and needing a truck present to buy the thing you buy so you can
  // rescue a truck that is NOT present would be exactly backwards.
  if (sub === 'spares') return await rigSpares(player, rest[0]);

  // Which truck. The panel always names it explicitly (its buttons carry the id as the first token
  // after the subcommand), and a player typing never does — so an unnamed one means "the one
  // standing here", which at a depot is unambiguous by the one-truck-per-yard rule.
  const idArg = rest[0] && /^truck_[0-9a-f]+$/i.test(rest[0]) ? rest.shift() : null;
  // ⚠ AN ID, NEVER A NAME, and that is not an oversight. Everything after the subcommand here is
  // an ARGUMENT — `rig paint red`, `rig trim walnut` — so a truck picked by plate would be a plate
  // competing with a colourway for the same token, and the loser is somebody who called their truck
  // Walnut. The panel always sends the id; a player with two trucks in one yard gets the menu below
  // and every line of it is typable.
  const parked = idArg ? [] : await trucksAt(player.id, depotZonesOf(bay, depot));
  const truck = idArg ? await getTruck(idArg, player.id) : (parked.length === 1 ? parked[0] : null);
  if (!truck && parked.length > 1) return whichTruckLine(`rig ${sub}`, parked, null, true);
  if (!truck) return say(idArg ? "That isn't one of yours." : 'You have nothing parked here to work on.');
  if (rigOf(player)?.truckId === truck.id) return say('Climb down first — nobody works on a truck they are sitting in.');
  const cd = truck.custom_data || {};

  if (sub === 'strip') return await rigStrip(player);
  if (sub === 'parts') return await rigParts(player, rest[0]);
  if (sub === 'repair') return await rigRepair(player, truck, cd, rest[0], rest[1] || (PARTS.includes((rest[0]||'').toLowerCase()) ? rest[0] : null));
  if (sub === 'tune') return await rigTune(player, truck, cd, rest);
  if (sub === 'kit') return await rigKit(player, truck, cd, rest[0]);
  if (sub === 'paint') return await rigPaint(player, truck, cd, rest);
  if (sub === 'trim' || sub === 'interior') return await rigTrim(player, truck, cd, rest);
  if (sub === 'fuel') return await rigFuel(player, truck, bay, depot);
  if (sub === 'name') return await rigName(player, truck, rest.join(' '));
  return say('<span class="text-dim">rig repair [shop] [engine|wheels|body] | rig strip | rig parts &lt;engine|wheels|body&gt; | rig spares [n] | rig tune &lt;gearing&gt; &lt;boost&gt; &lt;suspension&gt; &lt;brakes&gt; | rig kit &lt;id&gt; | rig paint [preset &lt;name&gt;|base=… trim=… hw=… deck=… bright=… glow=… glass=… flash=… finish=… art=…] | rig trim [&lt;material&gt;] [&lt;colourway&gt;|panel=… needle=… glow=…] | rig fuel | rig name &lt;plate&gt;</span>');
}

// The counter. Cheap, heavy, and the thing everybody decides they do not need on the way out of the
// yard — which is the whole design of it. One box is one roadside attempt (`fix` spends it whether
// the repair takes or not), so carrying two is a real answer to a bad night and carrying six is a
// tonne of steel you are paying to accelerate for four hundred miles.
// ── THE PARTS COUNTER ────────────────────────────────────────────────────────
// Where a failed component comes from. Deliberately the same shelf as the spares box rather than a
// new surface: a yard is one counter, and a driver who knows to buy spares should not have to
// discover a second verb to buy an engine.
//
// ⚠ AN ENGINE IS NOT PUT IN YOUR POCKETS. It is craned onto the ground where you are standing, and
// that is the entire point of the carry rule (see PART_ITEMS): the heavy one is a fact about WHERE
// YOU ARE. Buying one at a yard four hundred miles from your dead truck is money spent on a crate
// sitting in the wrong town, which is a mistake the game should absolutely let you make.
const PART_PRICE = { engine: 2600, wheels: 780, body: 240 };
async function rigParts(player, what) {
  const part = PARTS.find((p) => p === String(what || '').toLowerCase());
  if (!part) {
    return say('<span class="text-dim">Parts on the shelf: '
      + PARTS.map((p) => `<b>${p}</b> ${PART_PRICE[p]}₵`).join(' · ')
      + '. <span class="text-dim">rig parts &lt;engine|wheels|body&gt;</span></span>');
  }
  const spec = PART_ITEMS[part], cost = PART_PRICE[part];
  if ((player.credits || 0) < cost) return say(`${cap(spec.label)} is <b>${cost}₵</b>. <span class="text-dim">You have ${player.credits || 0}₵.</span>`);
  player.credits -= cost;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  const owner = spec.carry ? player.id : GROUND(player.current_zone);
  const { rows } = await query('SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 LIMIT 1', [owner, spec.item]);
  if (rows[0]) await query('UPDATE player_inventory SET quantity = quantity + 1 WHERE id=$1', [rows[0].id]);
  else await query('INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,1,1.0)',
    [`inv_${randomUUID().slice(0, 12)}`, owner, spec.item]);
  return say(spec.carry
    ? `<span class="item-grant">${cap(spec.label)}, ${cost}₵. It goes in the cab and you will feel it on every hill.</span>`
    : `<span class="item-grant">${cap(spec.label)}, ${cost}₵.</span>
<span class="text-dim">The yard crane swings it down onto the hardstand beside you. It stays where it lands — an engine is not luggage.</span>`);
}

const SPARES_PRICE = 140;
async function rigSpares(player, nArg) {
  const n = Math.max(1, Math.min(6, parseInt(nArg, 10) || 1));
  const cost = SPARES_PRICE * n;
  if ((player.credits || 0) < cost) {
    return say(`A box of spares is <b>${SPARES_PRICE}₵</b>. <span class="text-dim">You have ${player.credits || 0}₵.</span>`);
  }
  player.credits -= cost;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  const have = await sparesInHand(player);
  if (have) await query('UPDATE player_inventory SET quantity = quantity + $1 WHERE id=$2', [n, have.id]);
  else {
    await query(
      'INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,$4,1.0)',
      [`inv_${randomUUID().slice(0, 12)}`, player.id, SPARES_ITEM, n]
    );
  }
  return say(`<span class="item-grant">${n === 1 ? 'A box' : `${n} boxes`} of truck spares.</span>\n`
    + `<span class="text-dim">The man behind the counter does not ask where you are going. `
    + `One box is one go at it on the shoulder, and it is spent whether the repair takes or not.</span> `
    + `<span class="item-loss">-${cost}₵</span>`);
}

// TWO WAYS TO FIX A TRUCK, and the difference between them is certainty, not just price. A shop
// does it properly and charges for that. Your own hands are cheaper, botchable, and — the real
// constraint — cannot take a rig past Worked, because there is a limit to what gets done on a
// concrete floor with the toolbox that lives behind the seat.
// ── WHAT A FAILED COMPONENT NEEDS, AND WHERE IT HAS TO BE ────────────────────
// Credits buy labour. They do not buy a camshaft. Below `BROKEN_AT` a component has FAILED and the
// repair needs the real thing, which is a supply problem rather than a money one — and the shape of
// that problem is different for each part on purpose (see PART_ITEMS in damage.js): a wheel set and
// a stack of panels are freight you can carry, so being ready is something you did at the depot,
// while an engine is a crate on a pallet that has to already be in the room with you.
//
// Returns null when nothing is missing, or the refusal to print. The refusal always says WHAT and
// WHERE, because "you need a part" with no noun in it is the most annoying sentence a game can say.
const GROUND = (zoneId) => `_ground_${zoneId}`;   // mirrors inventory.js's own groundOwner — an item on the floor is a row owned by the room
async function partsMissing(player, dmg, parts) {
  const need = parts.filter((p) => isBroken(dmg[p]));
  if (!need.length) return null;
  for (const p of need) {
    const spec = PART_ITEMS[p];
    if (!spec) continue;
    const have = spec.carry
      ? await query('SELECT 1 FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND quantity>0 LIMIT 1', [player.id, spec.item])
      // ⚠ THE GROUND IS AN INVENTORY, not a table of its own: an item lying in a room is a
      // `player_inventory` row owned by the zone's synthetic ground owner (see inventory.js
      // dropToGround). Anything looking for "is it in this room" has to ask the same way, or it
      // will be looking in a table that does not exist.
      : await query('SELECT 1 FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND quantity>0 LIMIT 1', [GROUND(player.current_zone), spec.item]);
    if (have.rows.length) continue;
    return say(`<span class="text-amber">The ${PART_LABELS[p].label.toLowerCase()} has not worn out, it has FAILED.</span>
`
      + `<span class="text-dim">No hours and no money fix that — it needs ${spec.label}`
      + (spec.carry ? ', and you are not carrying any. ' : ', and there is not one standing here. An engine goes where a forklift puts it. ')
      + `Yards sell them.</span>`);
  }
  return null;
}

// Which parts a repair CONSUMES, spent once the work is done rather than when it is offered — the
// opposite of the field `fix`, and deliberately so: a bench job with a fitter and a hoist is not a
// gamble on a shoulder in the rain, so the part goes in and stays in.
async function consumeParts(player, dmg, parts) {
  for (const p of parts) {
    if (!isBroken(dmg[p])) continue;
    const spec = PART_ITEMS[p];
    if (!spec) continue;
    if (spec.carry) {
      await query(`UPDATE player_inventory SET quantity = quantity - 1
                    WHERE player_id=$1 AND item_id=$2 AND quantity>0`, [player.id, spec.item]).catch(() => {});
      await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND quantity<=0', [player.id, spec.item]).catch(() => {});
    } else {
      await query(`UPDATE player_inventory SET quantity = quantity - 1
                    WHERE player_id=$1 AND item_id=$2 AND quantity>0`, [GROUND(player.current_zone), spec.item]).catch(() => {});
      await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND quantity<=0', [GROUND(player.current_zone), spec.item]).catch(() => {});
    }
  }
}

// The bill for ONE component. Its own share of the whole-truck price (an engine is half the money
// in a truck and a panel is not), and a third of that again if the damage never got past a
// scratch — beating a dent out and respraying it is an afternoon, not a rebuild.
function partCost(type, dmg, part, pro) {
  const at = dmg[part];
  const whole = repairCost(type, at, pro);
  return Math.max(1, Math.ceil(whole * (PART_SHARE[part] ?? 1 / PARTS.length) * (isCosmetic(at) ? COSMETIC_MUL : 1)));
}

async function rigRepair(player, truck, cd, mode, part) {
  const pro = /^(shop|pay|pro|full|bench)$/.test((mode || '').toLowerCase());
  // ONE COMPONENT, OR THE WHOLE TRUCK. `rig repair shop engine` fixes the engine and charges for
  // the engine; `rig repair shop` fixes everything, as it always has. The targeted form is the
  // whole reason the component model is worth having at a bench: a driver who has ruined the
  // wheels on gravel and left the engine alone should be able to pay for wheels, and the old
  // single bar could not express that bill. The default staying whole-truck matters just as much —
  // nobody should have to learn a parts vocabulary to keep a truck on the road.
  const dmg = damageOf({ cd, condition: truck.condition });
  const target = PARTS.includes((part || '').toLowerCase()) ? part.toLowerCase() : null;
  if (target) return await rigRepairPart(player, truck, cd, dmg, target, pro);
  const cond = truck.condition ?? 1;
  if (cond >= 0.995) return say(`The ${truck.type.name} is as good as it gets.`);
  if (!pro && cond >= FIELD_CAP) return say(`Nothing you can do to it with hand tools — it is already past what a field repair reaches. <span class="text-dim">rig repair shop</span>`);
  // THE WHOLE TRUCK, IF NOTHING ON IT HAS ACTUALLY FAILED. That is the rule the parts economy
  // hangs on: an ordinary tired rig is one bill and one visit, exactly as it always was, and it is
  // only a component that has GONE which turns the job into finding the thing itself.
  const blocked = await partsMissing(player, dmg, PARTS);
  if (blocked) return blocked;
  const cost = PARTS.reduce((n, p) => n + partCost(truck.type, dmg, p, pro), 0);
  if ((player.credits || 0) < cost) {
    return say(`That is ${cost}₵ of parts and labour and you have ${player.credits || 0}₵.`);
  }
  await consumeParts(player, dmg, PARTS);
  player.credits -= cost;
  let to, note = '';
  if (pro) {
    to = 1;
  } else {
    const chk = await skillCheck(player, 'fabrication', 5);
    // A botch does not waste the money — it gets you PART of the way, which is the honest outcome
    // of a job half-understood and keeps a low-skill player's repair worth doing.
    to = Math.min(FIELD_CAP, cond + (FIELD_CAP - cond) * (chk.success ? 1 : 0.55));
    await awardSkillUse(player.id, 'fabrication', chk.margin);
    if (!chk.success) note = ' <span class="text-amber">(Some of it beat you.)</span>';
  }
  // A WHOLE-TRUCK REPAIR LIFTS EVERY COMPONENT TO THE SAME PLACE, and then the headline number is
  // re-derived from them rather than written on its own. Writing `condition` directly here — which
  // is what this did before components existed — would have left the bag untouched underneath it,
  // so the next flush from a drive would recompute `overall` off the old parts and silently undo
  // the repair the player had just paid for.
  for (const p of PARTS) dmg[p] = Math.max(dmg[p], to);
  cd.dmg = dmg;
  await saveTruckData(truck.id, player.id, cd);
  await setCondition(truck.id, player.id, overall(dmg));
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await repush(player, 'bench');
  const band = bandOf(overall(dmg));
  return say(`<span class="item-grant">${pro ? "The depot's fitters take it in and give it back right" : 'You get under it yourself'} — ${cost}₵. `
    + `${truck.type.name}: <b>${band.label}</b> (${Math.round(overall(dmg) * 100)}%).</span>${note}`);
}

// One component. Priced off the SHARE of the truck a whole repair would have cost — a third of the
// tractor each — so three targeted repairs come to the same money as one whole one and there is no
// arbitrage either way. The field cap and the skill check are the same ones; there is deliberately
// no separate difficulty per part, because "wheels are easier than an engine" is a rule nobody
// could learn from the outside and it would only ever read as inconsistency.
async function rigRepairPart(player, truck, cd, dmg, part, pro) {
  const label = PART_LABELS[part].label;
  const at = dmg[part];
  if (at >= 0.995) return say(`The ${label.toLowerCase()} is as good as it gets.`);
  if (!pro && at >= FIELD_CAP) {
    return say(`Nothing you can do to the ${label.toLowerCase()} with hand tools. <span class="text-dim">rig repair shop ${part}</span>`);
  }
  const blocked = await partsMissing(player, dmg, [part]);
  if (blocked) return blocked;
  const cost = partCost(truck.type, dmg, part, pro);
  if ((player.credits || 0) < cost) return say(`That is ${cost}₵ of parts and labour and you have ${player.credits || 0}₵.`);
  await consumeParts(player, dmg, [part]);
  player.credits -= cost;
  let to, note = '';
  if (pro) to = 1;
  else {
    const chk = await skillCheck(player, 'fabrication', 5);
    to = Math.min(FIELD_CAP, at + (FIELD_CAP - at) * (chk.success ? 1 : 0.55));
    await awardSkillUse(player.id, 'fabrication', chk.margin);
    if (!chk.success) note = ' <span class="text-amber">(Some of it beat you.)</span>';
  }
  dmg[part] = Math.max(dmg[part], to);
  cd.dmg = dmg;
  await saveTruckData(truck.id, player.id, cd);
  await setCondition(truck.id, player.id, overall(dmg));
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await repush(player, 'bench');
  return say(`<span class="item-grant">${pro ? 'The fitters have it out and back in' : 'You do the ' + label.toLowerCase() + ' yourself'} — ${cost}₵. `
    + `<b>${label}: ${partBand(to).label}</b> (${Math.round(to * 100)}%).</span>${note}\n`
    + `<span class="text-dim">Truck overall: ${bandOf(overall(dmg)).label}.</span>`);
}

// The dials. All four commit at once, exactly as flight's `tuneset` does, because they are read
// against each other — a gearing change you make without seeing what it did to the pull is a
// change you make twice.
async function rigTune(player, truck, cd, vals) {
  const fab = await effectiveSkill(player, 'fabrication');
  const range = tuneRange(fab, installedKits(cd));
  const keys = Object.keys(TUNE_PARAMS);
  const next = {};
  keys.forEach((k, i) => { next[k] = clampTune(vals[i], range) ?? 0; });
  cd.tune = next;
  if (!await saveTruckData(truck.id, player.id, cd)) return say('That truck will not take a setting.');
  await awardSkillUse(player.id, 'fabrication', 0);
  await repush(player, 'bench');
  const capped = keys.some(k => Math.abs(next[k]) >= range);
  return say(`<span class="item-grant">Dialled in: ${keys.map(k => `${TUNE_PARAMS[k].label} ${next[k] > 0 ? '+' : ''}${next[k]}`).join(', ')}.</span>`
    + (capped ? ' <span class="text-dim">That is as far as your hands and your gear will take it — a workshop instrument set would go further.</span>' : ''));
}

async function rigKit(player, truck, cd, kitId) {
  const kit = KITS[(kitId || '').toLowerCase()];
  if (!kit) return say(`No such kit. <span class="text-dim">${Object.keys(KITS).join(', ')}</span>`);
  const fitted = installedKits(cd);
  if (fitted.includes(kitId)) return say(`The ${kit.name} is already on it.`);
  if ((player.credits || 0) < kit.price) return say(`The ${kit.name} is ${kit.price}₵ and you have ${player.credits || 0}₵.`);
  player.credits -= kit.price;
  cd.kits = [...fitted, kitId.toLowerCase()];
  await saveTruckData(truck.id, player.id, cd);
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await awardSkillUse(player.id, 'fabrication', 0);
  await repush(player, 'bench');
  return say(`<span class="item-grant">Fitted: ${kit.name}. ${kit.price}₵.</span> <span class="text-dim">${kit.desc}</span>`);
}

// A truck wears four colours, a paint job over them, a finish coat and a picture on the door — the
// name on the door is still the plate the fleet already stores, and a second copy of it here would
// be two answers to one question. The catalogue lives in rig.js; this is the till.
//
// ── THE GRAMMAR IS NAMED, AND IT HAD TO BECOME NAMED ─────────────────────────
// This was four positional arguments, which is fine for four and unusable for eight — nobody is
// going to remember that the seventh slot is the door art. `rigTrim` below already solved the same
// problem by making its arguments order-free, and its comment says why: a player should not have to
// remember which slot is which for a choice they make twice in a career.
//
// ⚠ BUT NOT THE SAME SOLUTION, because the trick `rig trim` uses does not work here. It infers a
// bare word's meaning from which catalogue it appears in, which is only safe while the catalogues
// are disjoint — and these are not: `candy` is a paint job AND a finish coat, `flames` is door art
// while `flame` is a paint job. So the keys are written down (`finish=candy`), and the OLD
// positional form is still accepted exactly as it was, because it is what every macro and every
// line of anyone's notes already says.
async function rigPaint(player, truck, cd, args) {
  const prev = cd.paint || {};
  const patch = {};
  const loose = [];
  for (const raw of args) {
    const tok = String(raw || '');
    const eq = tok.indexOf('=');
    if (eq > 0) { patch[tok.slice(0, eq).toLowerCase()] = tok.slice(eq + 1); continue; }
    loose.push(tok);
  }
  // `rig paint <id> preset <name>` — the whole scheme in one word. The panel's one-click swatches
  // are this verb, which is the rule the depot is built on: anything you can click you can type.
  if (loose[0] && loose[0].toLowerCase() === 'preset') {
    const p = presetPaint(loose[1], prev);
    if (!p) return say(`<span class="text-dim">Schemes: ${PAINT_PRESETS.map(r => r.id).join(', ')}.</span>`);
    Object.assign(patch, p);
    loose.length = 0;
  }
  // The legacy positional form, untouched: base, trim, flash, chrome.
  const [lb, lt, lf, lc] = loose;
  if (lb !== undefined && patch.base === undefined) patch.base = lb;
  if (lt !== undefined && patch.trim === undefined) patch.trim = lt;
  if (lf !== undefined && patch.flash === undefined) patch.flash = lf;
  if (lc !== undefined && patch.chrome === undefined) patch.chrome = lc;
  if (patch.chrome !== undefined) patch.chrome = patch.chrome !== '0' && patch.chrome !== 'off' && patch.chrome !== false;
  if (!args.length) {
    const list = (rows) => rows.map(r => r.id).join(', ');
    return say('<span class="text-dim">rig paint &lt;id&gt; base=#rrggbb trim=#rrggbb hw=#rrggbb deck=#rrggbb '
      + 'bright=#rrggbb glow=#rrggbb glass=#rrggbb '
      + 'flash=&lt;job&gt; finish=&lt;coat&gt; art=&lt;door&gt; chrome=0|1 — or <b>rig paint &lt;id&gt; preset &lt;name&gt;</b>.\n'
      + `Jobs: ${list(FLASHES)}.\nCoats: ${list(FINISHES)}.\nDoor: ${list(ARTS)}.\nSchemes: ${list(PAINT_PRESETS)}.</span>`);
  }
  const next = sanitizePaint(patch, prev);
  const cost = paintCost(truck.type, next);
  const changed = JSON.stringify(next) !== JSON.stringify(sanitizePaint({}, prev));
  if (!changed) { await repush(player, 'bench'); return { type: 'noop' }; }
  if ((player.credits || 0) < cost) return say(`A respray on something that size is ${cost}₵ and you have ${player.credits || 0}₵.`);
  player.credits -= cost;
  cd.paint = next;
  await saveTruckData(truck.id, player.id, cd);
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await repush(player, 'bench');
  return say(`<span class="item-grant">Resprayed — ${cost}₵.</span> <span class="text-dim">${(FINISHES.find(f => f.id === next.finish) || {}).label || 'Gloss'}, and it comes out of the booth still smelling of it.</span>`);
}

// ── rig trim ─────────────────────────────────────────────────────────────────
// The inside of the respray. `rig trim` with no arguments is the catalogue; with one or two it is
// the job. Order-free on purpose — a material and a colourway cannot be confused for each other,
// so `rig trim walnut wood` and `rig trim wood walnut` are the same sentence and both work. The
// alternative is a positional grammar that makes a player remember which slot is which for a
// choice they make about twice in a career.
//
// ── AND ONE OF THE COLOURWAYS IS YOURS ───────────────────────────────────────
// `panel=#4a1f2e needle=#ffd489 glow=#c07a34` mixes one instead of picking one, and those three
// picks are all a colourway needs — see the ⚠ in client/shared/cab-trim.js for why it is three and
// not fourteen. NAMED arguments, where the swatches are bare words, for the reason `rig paint`'s
// are: a bare hex says nothing about which of the three it is, and three positional colours is a
// grammar nobody can hold. Naming any of them implies the custom colourway, so nobody has to say
// both, and an unnamed one falls back to the mix already stored — which is what makes "same again,
// but a green needle" one argument rather than three.
//
// ⚠ AND IT IS STILL ONE JOB AT ONE PRICE. Mixing is not a premium: the bench charges for the
// retrim, and what it costs to spray a dashboard does not depend on whether the colour came off a
// card. A surcharge here would be the panel charging for the absence of a limitation.
async function rigTrim(player, truck, cd, args) {
  const mats = Object.entries(DASH_MATERIALS), cols = Object.entries(DASH_COLOURWAYS);
  const now = sanitizeTrim(cd.trim || {}, {});
  const cost = trimCost(truck.type);
  const want = {};
  const mix = {};
  for (const a of args) {
    const k = String(a || '').toLowerCase();
    const kv = /^(panel|needle|glow)=(.+)$/.exec(k);
    if (kv) {
      if (!isTrimHex(kv[2])) return say(`<b>${kv[1]}</b> wants a colour like <span class="text-dim">#4a1f2e</span>, not <b>${kv[2].replace(/[<>]/g, '').slice(0, 16)}</b>.`);
      mix[kv[1]] = kv[2]; want.col = CUSTOM_COL;
    } else if (isDashMaterial(k)) want.mat = k;
    else if (isDashColourway(k)) want.col = k;
    else if (k === CUSTOM_COL) {   // refit a mix already stored — the way back after trying a swatch
      if (!now.cust) return say('You have not mixed one yet. <span class="text-dim">rig trim panel=#4a1f2e needle=#ffd489 glow=#c07a34</span>');
      want.col = CUSTOM_COL;
    } else if (k) return say(`No such trim: <b>${k.replace(/[<>]/g, '')}</b>. Try <span class="text-dim">rig trim</span> on its own for the book.`);
  }
  if (want.col === CUSTOM_COL) {
    const c = sanitizeCustomTrim(mix, now.cust || {});
    if (!c) return say('A mixed interior needs all three: <span class="text-dim">panel</span>, <span class="text-dim">needle</span> and <span class="text-dim">glow</span>.');
    want.cust = c;
  }
  if (!args.length) {
    // The catalogue. It says what the truck is wearing NOW as well as what is on offer, because
    // "which of these am I looking at" is the first question anybody asks at a swatch book.
    const line = (k, label, blurb, on) =>
      `  <span class="action-link" data-action="cmd" data-cmd="rig trim ${k}">${on ? '<b>' : ''}${k}${on ? '</b>' : ''}</span>`
      + ` — ${label}${blurb ? `<span class="text-dim">, ${blurb}</span>` : ''}${on ? ' <span class="text-dim">(fitted)</span>' : ''}`;
    return say(`<b>Interior trim</b> <span class="text-dim">— ${cost}₵ a job, however much of it you change.</span>\n`
      + `<span class="text-dim">Material:</span>\n`
      + mats.map(([k, m]) => line(k, m.label, m.blurb, k === (now.mat || truckStockTrim(truck).mat))).join('\n')
      + `\n<span class="text-dim">Colourway:</span>\n`
      + cols.map(([k, c]) => line(k, c.label, '', k === (now.col || truckStockTrim(truck).col))).join('\n')
      + (now.cust ? '\n' + line(CUSTOM_COL, 'your own mix', `${now.cust.panel} panel, ${now.cust.needle} needle, ${now.cust.glow} glow`, now.col === CUSTOM_COL) : '')
      + `\n<span class="text-dim">Or mix one: </span><span class="action-link" data-action="cmd" data-cmd="rig trim panel=#4a1f2e needle=#ffd489 glow=#c07a34">panel, needle and glow, in hex</span>`
      + `\n<span class="text-dim">The bench does not sell instruments. What is in the binnacle came with the truck.</span>`);
  }
  const next = sanitizeTrim({ ...now, ...want }, now);
  if (JSON.stringify(next) === JSON.stringify(now)) { await repush(player, 'bench'); return { type: 'noop' }; }
  if ((player.credits || 0) < cost) return say(`Retrimming a cab is ${cost}₵ and you have ${player.credits || 0}₵.`);
  player.credits -= cost;
  cd.trim = next;
  await saveTruckData(truck.id, player.id, cd);
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await repush(player, 'bench');
  const said = [next.mat && DASH_MATERIALS[next.mat]?.label,
    next.col === CUSTOM_COL ? 'your own mix' : next.col && DASH_COLOURWAYS[next.col]?.label].filter(Boolean).join(', ');
  return say(`<span class="item-grant">Retrimmed — ${cost}₵.</span> ${said}. It smells of glue and it will for a week.`);
}
// What the truck LEFT THE FACTORY IN, for the catalogue's "fitted" marks. One mapping, in the
// shared file the renderer reads — a second copy here would drift the first time a stock interior
// was recoloured, and the symptom would be the swatch book ticking the wrong row.
const truckStockTrim = (truck) => stockTrim(truck?.type?.tier ?? 1);
// A stored trim with its nulls DROPPED, so it can be spread over the stock row without a null
// wiping the factory answer back out. `sanitizeTrim` deliberately returns null for a key nobody
// has bought — that is right for storage and wrong for a merge.
const sanitizeTrimResolved = (raw) => {
  const t = sanitizeTrim(raw || {}, {});
  const out = {};
  if (t.mat) out.mat = t.mat;
  if (t.col) out.col = t.col;
  // The three picks travel with it whether or not the mix is the one FITTED — the panel needs them
  // to fill its wells with what this driver last chose rather than with a default nobody picked.
  if (t.cust) out.cust = t.cust;
  return out;
};

// Filling a PARKED truck. `fuel` (the older verb) fills the one you are sitting in, out on the
// road; this is the same act at a depot with the keys in your pocket, and it is the button the
// panel shows next to the gauge.
async function rigFuel(player, truck, bay, depot) {
  const yard = getZone(yardIdOf(bay, depot));
  const pump = pumpAt({ leg: 'city', zoneId: yard?.id }) || pumpAt({ leg: 'city', zoneId: bay?.id });
  if (!pump) return say('This yard keeps no diesel. You would have to run it to a pump.');
  const need = 1 - (truck.fuel ?? 1);
  if (need < 0.02) return say('It is already full.');
  const cost = Math.round(need * FUEL_FULL);
  if ((player.credits || 0) < cost) return say(`Filling it is ${cost}₵ and you have ${player.credits || 0}₵.`);
  player.credits -= cost;
  await setFuel(truck.id, player.id, 1);
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await repush(player, 'fleet');
  return say(`<span class="item-grant">Tanks filled. ${cost}₵.</span>`);
}

async function rigName(player, truck, plate) {
  const clean = String(plate || '').replace(/[<>]/g, '').trim().slice(0, 28);
  if (!clean) return say('Call it what?');
  await query('UPDATE trucks SET name=$1 WHERE id=$2 AND owner_id=$3', [clean, truck.id, player.id]).catch(() => {});
  await repush(player, 'fleet');
  return say(`<span class="item-grant">Signwritten: <b>${clean}</b>.</span>`);
}

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
  if (!rig) return say('Nothing to load it into — get in a truck first.');
  if (!rig.trailer) return say('Nowhere to put it — you are bobtail. <b>hitch</b> a trailer first.');
  if (rig.cargo) return say(`The deck is full: ${rig.cargo.name}.`);
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
  const deckKg = rig?.trailer?.ratedKg || rig?.type?.kg || DEFAULT_TRAILER_KG;
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
  rig.cargo = { kind: 'goods', key, name: c.name, qty, kg: qty * c.kg, unitPaid: unit };
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  pushCab(rig);
  return say(`<span class="item-grant">Loaded ${qty} × ${c.name} at ${unit}₵ — <b>${cost}₵</b> gone. ${qty * c.kg} kg on the deck.</span>`);
}

async function marketSell(player, rig, here, region) {
  if (!rig?.cargo) return say('Nothing on the deck.');
  if (rig.cargo.kind !== 'goods') return say(`That load is contracted to ${rig.cargo.toName} — it isn't yours to sell.`);
  const day = marketDay();
  const unit = bidPrice(rig.cargo.key, region, day);
  const take = rig.cargo.qty * unit;
  const spent = rig.cargo.qty * rig.cargo.unitPaid;
  const profit = take - spent;
  player.credits = (player.credits || 0) + take;
  const sold = rig.cargo;
  rig.cargo = null;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  pushCab(rig);
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
  rig.engineOn = false;   // the key, turned for you — the last step of the sequence, not a gate on it
  dismountRig(player.id);
  // The text tick self-heals (it drops any run whose rig has gone), but stopping it here means the
  // road doesn't narrate one more line after you've already climbed down.
  stopTextDrive(player.id);
  // Both flushes happen HERE and nowhere on the hot path: the town you drove through, and the fuel
  // and lifetime tiles the truck accumulated doing it.
  await flushZone(player, rig);
  // PARKING AT A DEPOT PUTS IT INSIDE. You stop on the apron — that is where the road is — but the
  // truck belongs to the bay, and storing the apron's zone id instead would leave a 31,000₵ rig
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
  const abandoned = rig.leg !== 'city' && (rig.broken || rig.dry || rig.s > 2);
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
// The hot path. Packed numerics, ~4×/s, one per driving player. Never awaits a query on the
// ordinary frame — a node crossing does (it writes current_zone), and node crossings happen once
// every couple of minutes, not every frame.
//   packed: s t hdg spd x y
async function cmdTruckSync(args, raw, player) {
  const rig = rigOf(player);
  if (!rig) return { type: 'noop' };
  const n = args.map(Number);
  if (n.length < 6 || n.some(Number.isNaN)) return { type: 'noop' };

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

  if (r.moved) {
    const zone = await crossToNode(player, rig, r.node);
    if (!zone) { await forcedPark(player); return { type: 'noop' }; }
    // SOMEBODY ON THE SHOULDER. Announced on the node crossing, because a hitchhiker you were never
    // told about is a verb nobody types. Same reason the scale announces itself: this whole phase is
    // decisions taken in advance, and you cannot decide about a thing you did not see.
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
    const who = hitcherAt(rig.route, r.node, rig.chain?.length || 1);
    if (who && !rig.rider) {
      sendToPlayer(player.id, {
        type: 'emote',
        message: `<span class="text-amber">Ahead on the shoulder: ${who.look}. A hand comes up as you close.</span>`
          + ` <span class="text-dim">${teachVerb('pickup', 'pickup')} if you are stopping.</span>`,
      });
    }
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

// ── `rig strip` — the road as a supply line ──────────────────────────────────
// ⚠ IT IS A `rig` SUBCOMMAND, NOT A VERB, and that is not a style choice: `strip` belongs to the
// mis plugin (taking your clothes off), plugin verbs are first-come, and registering a second one
// would have silently shadowed a consent-gated verb with a truck command. The regress caught it.
// Every other bench-and-counter job is already `rig <something>`, so this is where it belonged.
// A dead truck by the roadside is somebody's whole evening, and until now it was scenery with a
// name on it. Stripping one is the second way parts enter the world (the yard counter is the
// first, fabrication the third), and it is the only one that costs no credits at all — what it
// costs is that you are standing outside your cab, in the waste, at a hulk, which is precisely
// where the things that live out here would like you to be.
//
// TWO RULES, and both fall out of what a wreck IS rather than from balance:
//
//  1. YOU CANNOT TAKE AN ENGINE OFF ONE. Not because a wreck has no engine — it obviously does —
//     but because an engine cannot be carried and the corridor is a transient room that ceases to
//     exist when the crossing ends. A crated engine dropped out here is freight you have thrown
//     away, which is the same rule that stops you dropping a TRAILER in the void (trailers.js rule
//     2). The road gives you the parts a person can lift and nothing else, and that keeps the
//     worst failure in the game a problem about towns.
//
//  2. A HULK IS STRIPPED ONCE. It is marked on the wreck itself, which is shared world state, so
//     the second driver past finds it picked over — the same wreck, the same place, the same
//     history, and nothing left on it. A per-player flag would have let ten drivers each take a
//     full set of wheels off one truck.
const STRIP_YIELD = [
  { item: 'item_wheel_set', label: 'a set of lifter housings off the drive bogie', diff: 9 },
  { item: 'item_body_panel', label: 'enough sound panel to patch a cab', diff: 4 },
  { item: 'item_scrap_metal', label: 'an armful of scrap', diff: 0, qty: 3 },
];
async function rigStrip(player) {
  const rig = rigOf(player);
  if (!rig) return say('You would need to be out here in a truck.');
  if (Math.abs(rig.speed) > HITCH_MPH) return say('Not at this speed. Stop alongside it first.');
  if (rig.leg !== 'corridor' || !rig.route) return say('Nothing out here to strip. Wrecks are a road thing.');
  const w = wreckNear(rig.route, rig.s);
  if (!w) return say('There is nothing beside you but ground. <span class="text-dim">The radio tells you about wrecks before you reach them.</span>');
  if (w.stripped) {
    return say('<span class="text-dim">Somebody has been through it already. The housings are gone, the panels are gone, and what is left is the shape of a truck with nothing in it.</span>');
  }
  const chk = await skillCheck(player, 'fabrication', 6);
  await awardSkillUse(player.id, 'fabrication', chk.margin);
  // WHAT COMES OFF IT is decided by how well you know what you are looking at. A good hand takes
  // the housings; a bad one takes panel and scrap and tells themselves it was worth stopping.
  const fab = await effectiveSkill(player, 'fabrication');
  const got = STRIP_YIELD.find((y) => fab >= y.diff && (y.diff === 0 || chk.success)) || STRIP_YIELD[STRIP_YIELD.length - 1];
  w.stripped = true;
  const qty = got.qty || 1;
  const { rows } = await query('SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 LIMIT 1', [player.id, got.item]);
  if (rows[0]) await query('UPDATE player_inventory SET quantity = quantity + $1 WHERE id=$2', [qty, rows[0].id]);
  else await query('INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,$4,1.0)',
    [`inv_${randomUUID().slice(0, 12)}`, player.id, got.item, qty]);
  return say(`<span class="item-grant">You get the cover off and take ${got.label}.</span>
`
    + `<span class="text-dim">${w.who ? `Whatever happened to ${w.who} out here, it is not going to happen to their gearbox as well.` : 'Nobody is coming back for the rest of it.'}</span>`);
}

// Resolved by ITEM ID rather than by name or tag. A tag would be the house preference, but a tag
// exists to let CONTENT decide which things behave a certain way, and there is exactly one thing
// here: a box of spares for a truck. Inventing a vocabulary entry for a set of size one is how tag
// catalogues get to two hundred entries nobody can remember.
async function sparesInHand(player) {
  const { rows } = await query(
    `SELECT id, quantity FROM player_inventory
      WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL AND quantity > 0 LIMIT 1`,
    [player.id, SPARES_ITEM]
  ).catch(() => ({ rows: [] }));
  return rows[0] || null;
}
async function spendSpares(row) {
  if (row.quantity > 1) await query('UPDATE player_inventory SET quantity = quantity - 1 WHERE id=$1', [row.id]);
  else await query('DELETE FROM player_inventory WHERE id=$1', [row.id]);
}

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
      return `${mark} <b>${d.heading}</b> <span class="text-dim">(${d.key}) — ${d.tiles} tiles${reach}</span>`;
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
  // 31,000₵ object standing in a public yard is simply wrong. Modelled on flight's "On the ramp:"
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
  // Somebody ELSE's rig is named and not linked. It is still in the room — a 31,000₵ object in a
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
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

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
  const who = hitcherAt(rig.route, rig.node, rig.chain?.length || 1);
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

  rig.rider = { ...who, inTrailer, boarded: rig.node };
  if (inTrailer) {
    // THE LINKAGE. A person is eighty kilos, and the weighbridge does not care what the eighty
    // kilos is for. Riding back there makes them contraband in the only sense the scale understands.
    const list = [...(rig.trailer.stash || []), { itemId: null, name: 'somebody who is not on the paper', kg: 80 }];
    rig.trailer.stash = list;
    await saveLoad(rig.trailer.id, rig.cargo || null, list);
  }
  pushCab(rig);
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
  pushCab(rig);
  return say(`They get down and shut the door.\n\n${extra}`);
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

export const commands = {
  drive: cmdDrive,
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

// Hijackers try the door of any STOPPED cab they are standing next to. Scheduled rather than run
// off a movement event because the thing it watches for is a truck that is NOT moving — there is no
// event for "still here", and the whole mechanic is about time passing while you sit. Idle-gated by
// default (schedule's own behaviour) and it returns immediately when nobody is in a rig, which on
// this server is almost always.
schedule('5s', () => tickHijackers());

export const _test = { boardFor, allDepots, mountSpot, depotFrom, hitchZones, allDocks, dockAt, depotAt, depotZonesOf, describeDepot, LOADS, RECKLESS_MPH };

console.log('[trucking] Plugin loaded.');
