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
//  3. The edge of the road is a law, not a wall. Off the pavement is slow and expensive; past the
//     corridor you are bogged — stalled, penalised in time, and put back on the shoulder facing
//     the right way. There is no geometry you can hit.
//
// PHASE 1 IS BOBTAIL. No trailer, no gears, no freight, no yard. The question this phase exists to
// answer is whether a quarter of an hour of changing country with a city coming out of the haze is
// worth doing on its own. Everything else is downstream of that answer.

import { getZone, getAllZones, getMinimapData, addPlayerToZone, removePlayerFromZone, getLivePlayer } from '../../server/engine/world.js';
import { saveDrivingState, restoreDrivingState } from './resume.js';
// The damage model. `condition` is still the headline number every older reader uses; these four
// components are what it is now DERIVED from. See damage.js for why the weakest link and not a mean.
import { applyDamage, impactSplit, IMPACT_AREAS, damageOf, overall, PARTS, PART_LABELS, partBand } from './damage.js';
import { describeZone } from '../../server/engine/commands/describe.js';
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
import { fleetOf, truckAt, getTruck, buyTruck, sellTruck, persistTruck, resaleValue, truckType, TRUCK_TYPES,
  setCondition, saveTruckData, setFuel, recoverTruckTo } from './fleet.js';
import { TUNE_PARAMS, KITS, BANDS, bandOf, tuneRange, clampTune, installedKits, effTruckParams,
  repairCost, FIELD_CAP, sanitizePaint, paintCost, FLASHES, startTrouble, wearForImpact, burnMul,
  BREAKDOWNS, fixOdds, FIX_GRACE_TILES, isTerminal, FIX_MIN_FAB, SPARES_ITEM } from './rig.js';
import { skillCheck, effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { crossingChain, crossingDest, crossingInfo, voidGateOf, launchCrossing, VOIDS } from '../voidwalking/index.js';
import { routeOptions, aimedDest, destByWord } from './routes.js';
import { surfaceAt } from '../flight/state.js';
import { rigs, rigOf, mountRig, dismountRig, reconcileTruck, crossToNode, driveToZone, flushZone,
  joinCorridor, leaveCorridor, unbog, pushCab, cabContext, surfaceUnder, truckContactsNear,
  announceBreak, switchLimb, atOrBeforeFork, cbLine, markWreck } from './state.js';
import { corridorPos, corridorAt, TILES_PER_ROOM } from './corridor.js';
import { hitcherAt } from './hitchers.js';
import { runScale, afterDrive, customsAnswer, pendingCustoms, scaleAt, releaseImpound } from './scale.js';
import { registerAction } from '../../server/engine/actions.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { TRAILER_TYPES, trailerType, trailersAt, trailersOf, getTrailer, trailerOnTruck,
  buyTrailer, hitchTrailer, dropTrailer, saveLoad, canDrop, declaredKg, actualKg, stashKg, setTrailerCondition } from './trailers.js';

const say = (msg) => ({ type: 'emote', message: msg });

// Below this, a contact is a scrape and nobody calls anybody. Above it, you have demolished part of
// a street at the wheel of several tonnes, and in a city that is witnessed.
const RECKLESS_MPH = 22;

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

  // ROLL OUT THROUGH THE DOOR. You are standing in a garage bay, and a garage bay has no road in
  // it — the tile is a building and buildings are solid. So the truck is mounted on the APRON: the
  // hardstand the bay names as its yard, one door away, which is where the rig has been standing
  // all along. `driveToZone` walks the player out with it, so the room you are in when the
  // windscreen appears is the road, exactly as it would be if you had opened the door and climbed
  // up. Mounting inside the shed instead was the alternative, and it would have put a forty-tonne
  // truck in a room with no grid coordinates and no surface under it.
  const stood = getZone(player.current_zone);
  const bay = depotAt(stood);
  const yardId = bay ? yardIdOf(stood, bay) : null;
  const here = bay ? (getZone(yardId) || stood) : stood;
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
  const owned = await truckAt(player.id, zonesHere);
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
  if (startTrouble(owned.condition)) {
    sendToPlayer(player.id, { type: 'emote', message: '<span class="text-amber">It turns over, and over, and does not catch. You wait. You try it again and it goes, in a cloud of something that should not be blue.</span>' });
  }

  const rig = mountRig(player, { x: here.grid_x, y: here.grid_y, heading: 180, depot: here.id });
  rig.zoneId = here.id;
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
  setPosture(player, 'driving');
  // Out of the shed and onto the apron, and the room description that comes with it. Done AFTER
  // the rig exists so the move gate sees a driver rather than a pedestrian walking out of a door.
  // ⚠ `bay` IS NOT "YOU WERE INDOORS". It only means the tile you are standing on carries the
  // depot flag, and the legacy shape puts that flag straight on a piece of hardstand — so a yard
  // with no shed at all satisfies it. What the roller door needs to know is whether the truck had
  // to be walked OUT of somewhere, which is exactly this move happening.
  const fromShed = !!(bay && yardId && yardId !== player.current_zone);
  if (fromShed) driveToZone(player, rig, yardId);

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
  return say(`<span class="text-green">You haul yourself up into the cab and pull the door to. The diesel catches on the second turn, and the whole frame starts to shake.${rollUp} ${depot.name ? `${depot.name}'s` : 'The yard'} gate is open, and the road runs south.</span>`);
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
function depotAt(zone) {
  const f = zone?.flags?.truck_depot;
  if (!f) return null;
  return typeof f === 'object' ? f : { name: zone.name };
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
const yardIdOf = (zone, depot) => depot?.yard || zone?.id || null;
const depotZonesOf = (zone, depot) => [zone?.id, depot?.yard].filter(Boolean);
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
    if (d?.yard) _yardIndex.set(d.yard, { zone: z, depot: d });
  }
  return _yardIndex;
}
export const resetDepotIndex = () => { _yardIndex = null; };
const bayForYard = (zoneId) => (zoneId ? yardIndex().get(zoneId) || null : null);

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

  return await depotPanel(player, bay, depot, 'fleet');
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

// What a full tank costs. One number, because diesel is diesel — the interesting variable in this
// system is the DISTANCE between pumps, not the price at them.
const FUEL_FULL = 380;

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
async function depotPanel(player, hereIn, depotIn, tab = 'fleet') {
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
  const pumpHere = !!(yard.flags?.truck_fuel || bay.flags?.truck_fuel || yard.flags?.building_type === 'fuel_yard');
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
        resale: resaleValue(t.type, t.odometer, t.condition),
        impound: t.impound_fee || 0,
        // ── the bench half ──
        condition: +(t.condition ?? 1).toFixed(3), band: band.key, bandLabel: band.label, bandText: band.text,
        tune: { gearing: 0, boost: 0, suspension: 0, brakes: 0, ...(cd.tune || {}) },
        kits, paint: cd.paint || null,
        repairField: repairCost(t.type, t.condition ?? 1, false),
        repairShop: repairCost(t.type, t.condition ?? 1, true),
        canField: (t.condition ?? 1) < FIELD_CAP,
        paintPrice: paintCost(t.type),
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
    // The bench's catalogues, sent once with the panel exactly as the hangar sends its paint and
    // tune catalogues: the client renders the dials it is told about and invents none.
    tuneParams: Object.entries(TUNE_PARAMS).map(([id, p]) => ({ id, label: p.label, lo: p.lo, hi: p.hi, desc: p.desc })),
    tuneRange: tuneRange(fab, []),
    kitCatalog: Object.entries(KITS).map(([id, k]) => ({ id, ...k, afford: (player.credits || 0) >= k.price })),
    flashes: FLASHES,
    fuelHere: pumpHere,
    board: boardFor(here.id),
    quotes: quotes.map((q) => {
      const oq = other?.q?.[q.key];
      return { ...q, thereBid: oq?.bid ?? null, thereAge: oq ? day - (other.day || day) : null,
        canAfford: Math.floor((player.credits || 0) / q.ask), holds: capacityFor(q.key, deckKg) };
    }),
    thereName: other ? regionLabel(other.region) : null,
  };
  if (await prefersLoggedPanelsOrDefault(player)) return say(textDepot(payload));
  return payload;
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
        + `${t.hereNow ? '' : ` · <span class="text-dim">tow it home for ${t.recall}₵ (yard recall ${t.id})</span>`}`
        + ` · <span class="text-dim">sells for ${t.resale}₵ (yard sell ${t.id})</span>`).join('\n')
    : '  <span class="text-dim">You own nothing with wheels on it.</span>';
  const stock = p.stock.map(t =>
    `  <b>${t.name}</b> — <span class="item-grant">${t.price}₵</span> · ${t.kg} kg deck · ${t.tank} tiles a tank · ${t.top} mph`
    + `${t.afford ? '' : ' <span class="text-dim">(cannot afford)</span>'}\n    <span class="text-dim">${t.blurb}</span>`
    + `\n    <span class="text-dim">yard buy ${t.id}</span>`).join('\n');
  return `<b>${p.depot} — yard</b>  <span class="text-dim">(${p.credits}₵)</span>\n\n<b>YOUR FLEET</b>\n${fleet}\n\n<b>FOR SALE</b>\n${stock}`;
}

async function yardBuy(player, here, depot, typeId, plate) {
  const key = (typeId || '').toLowerCase();
  // TRAILERS ARE BOUGHT ON THE SAME LINE. A second verb for the second half of a rig would be a
  // second place to look for one purchase; the dealer's fence has trucks on it and boxes behind it.
  const trl = trailerType(key);
  if (trl) return yardBuyTrailer(player, here, trl);
  const type = truckType(key);
  if (!type) {
    return say(`No such truck. <span class="text-dim">trucks: ${TRUCK_TYPES.map(t => t.id).join(', ')} · trailers: ${TRAILER_TYPES.map(t => t.id).join(', ')}</span>`);
  }
  if ((player.credits || 0) < type.price) {
    return say(`The ${type.name} is ${type.price}₵ and you have ${player.credits || 0}₵.`);
  }
  // One truck per depot, so `drive` never has to ask which. Owning several is fine; parking two in
  // the same yard is not, and saying so is cheaper than a disambiguation prompt on every mount.
  const depotZones = depotZonesOf(here, depot);
  if (await truckAt(player.id, depotZones)) {
    return say('You already have a truck parked in this yard. Move it or sell it before you buy another.');
  }
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
async function yardBuyTrailer(player, here, t) {
  if ((player.credits || 0) < t.price) return say(`${cap(t.name)} is ${t.price}₵ and you have ${player.credits || 0}₵.`);
  player.credits -= t.price;
  await buyTrailer(player.id, t.id, here.id);
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await repush(player, 'buy');
  return say(`<span class="item-grant">Bought: ${t.name}. ${t.price}₵.</span>\n`
    + `<span class="text-dim">${t.rated} kg rated, ${t.kg} kg empty. It is standing in the yard — ${teachVerb('hitch')} to back under it.</span>`);
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
  const value = resaleValue(t.type, t.odometer, t.condition);
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
  const truck = idArg ? await getTruck(idArg, player.id) : await truckAt(player.id, depotZonesOf(bay, depot));
  if (!truck) return say(idArg ? "That isn't one of yours." : 'You have nothing parked here to work on.');
  if (rigOf(player)?.truckId === truck.id) return say('Climb down first — nobody works on a truck they are sitting in.');
  const cd = truck.custom_data || {};

  if (sub === 'repair') return await rigRepair(player, truck, cd, rest[0], rest[1] || (PARTS.includes((rest[0]||'').toLowerCase()) ? rest[0] : null));
  if (sub === 'tune') return await rigTune(player, truck, cd, rest);
  if (sub === 'kit') return await rigKit(player, truck, cd, rest[0]);
  if (sub === 'paint') return await rigPaint(player, truck, cd, rest);
  if (sub === 'fuel') return await rigFuel(player, truck, bay, depot);
  if (sub === 'name') return await rigName(player, truck, rest.join(' '));
  return say('<span class="text-dim">rig repair [shop] [engine|wheels|body] | rig spares [n] | rig tune &lt;gearing&gt; &lt;boost&gt; &lt;suspension&gt; &lt;brakes&gt; | rig kit &lt;id&gt; | rig paint &lt;base&gt; &lt;trim&gt; &lt;flash&gt; | rig fuel | rig name &lt;plate&gt;</span>');
}

// The counter. Cheap, heavy, and the thing everybody decides they do not need on the way out of the
// yard — which is the whole design of it. One box is one roadside attempt (`fix` spends it whether
// the repair takes or not), so carrying two is a real answer to a bad night and carrying six is a
// tonne of steel you are paying to accelerate for four hundred miles.
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
  const cost = repairCost(truck.type, cond, pro);
  if ((player.credits || 0) < cost) {
    return say(`That is ${cost}₵ of parts and labour and you have ${player.credits || 0}₵.`);
  }
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
  const cost = Math.max(1, Math.ceil(repairCost(truck.type, at, pro) / PARTS.length));
  if ((player.credits || 0) < cost) return say(`That is ${cost}₵ of parts and labour and you have ${player.credits || 0}₵.`);
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

// A truck wears a colour, a flash down the flank and a name on the door — deliberately thinner
// than an aircraft's livery, because the door name is the plate the fleet already stores and a
// second copy of it here would be two answers to one question.
async function rigPaint(player, truck, cd, args) {
  const [base, trim, flash, chrome] = args;
  const next = sanitizePaint({ base, trim, flash, chrome: chrome == null ? undefined : chrome !== '0' }, cd.paint || {});
  const cost = paintCost(truck.type);
  const changed = JSON.stringify(next) !== JSON.stringify(cd.paint || {});
  if (!changed) { await repush(player, 'bench'); return { type: 'noop' }; }
  if ((player.credits || 0) < cost) return say(`A respray on something that size is ${cost}₵ and you have ${player.credits || 0}₵.`);
  player.credits -= cost;
  cd.paint = next;
  await saveTruckData(truck.id, player.id, cd);
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await repush(player, 'bench');
  return say(`<span class="item-grant">Resprayed — ${cost}₵. It comes out of the booth still smelling of it.</span>`);
}

// Filling a PARKED truck. `fuel` (the older verb) fills the one you are sitting in, out on the
// road; this is the same act at a depot with the keys in your pocket, and it is the button the
// panel shows next to the gauge.
async function rigFuel(player, truck, bay, depot) {
  const yard = getZone(yardIdOf(bay, depot));
  const pump = !!(yard?.flags?.truck_fuel || bay?.flags?.truck_fuel || yard?.flags?.building_type === 'fuel_yard');
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
  return await depotPanel(player, here, depot, 'market');
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
  const rig = rigOf(player);
  if (!rig) return say('You are not driving anything.');
  const here = getZone(rig.zoneId || player.current_zone);
  const pump = here?.flags?.building_type === 'fuel_yard' || here?.flags?.truck_fuel
    || (rig.leg === 'corridor' && nearRoadsideFuel(rig));
  if (!pump) return say('No pump here.');
  const need = 1 - rig.fuel;
  if (need < 0.02) return say('She is already full.');
  const cost = Math.round(need * FUEL_FULL);
  if ((player.credits || 0) < cost) return say(`A full tank runs ${cost}₵ and you have ${player.credits || 0}₵.`);
  player.credits -= cost;
  rig.fuel = 1;
  rig.dry = false; rig.dryTold = false; rig.warnedLow = false;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  pushCab(rig);
  return say(`<span class="item-grant">Tanks filled. ${cost}₵.</span>`);
}
// Out on the corridor the fuel stop is a roadside structure rather than a zone — the generator
// already places `fuel_yard` mileposts, so standing on one is the pump.
function nearRoadsideFuel(rig) {
  const c = corridorAt(rig.route, Math.round(rig.x), Math.round(rig.y));
  return c?.flags?.building_type === 'fuel_yard';
}

// ── park ─────────────────────────────────────────────────────────────────────
// Get out, wherever you are. Legal on the corridor and slightly reckless — the rig is still there
// when you come back, unless something found it first.
async function cmdPark(args, raw, player) {
  const rig = rigOf(player);
  if (!rig) return say('You are not driving anything.');
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
  await persistTruck(rig);
  setPosture(player, 'standing');
  sendToPlayer(player.id, { type: 'truck_sim_close' });
  const zone = getZone(player.current_zone);
  return {
    type: 'emote',
    message: `<span class="text-amber">You set the brake, kill the engine, and drop down onto the dirt. The silence out here is enormous.</span>${zone ? `\n\n${await describeZone(zone, player)}` : ''}`,
  };
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

  const r = reconcileTruck(rig, { s: n[0], t: n[1], hdg: n[2], spd: n[3], x: n[4], y: n[5] });

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
    if (!zone) { await cmdPark([], '', player); return { type: 'noop' }; }
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

// `cb` — the one control the radio has. On by default, because a channel you have to discover is
// a channel nobody hears, and off in one word for a driver who would rather have the road.
async function cmdCb(args, raw, player) {
  const rig = rigOf(player);
  if (!rig) return say('You are not driving anything.');
  rig.cbOff = !rig.cbOff;
  return say(rig.cbOff
    ? '<span class="text-dim">You turn the squelch all the way up and the cab goes quiet.</span>'
    : '<span class="text-dim">You bring the CB back up. Somewhere out in the dark, several people are already mid-argument.</span>');
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
async function cmdHorn(args, raw, player) {
  const rig = rigOf(player);
  let typeId = rig?.typeId || null;
  let name = null;
  if (!typeId) {
    const zone = getZone(player.current_zone);
    const depot = depotAt(zone);
    if (!depot) return say('There is nothing here with a horn on it.');
    const truck = await truckAt(player.id, depotZonesOf(zone, depot));
    if (!truck) return say('You have nothing parked here to lean into.');
    typeId = truck.type_id; name = truck.name || truck.type?.name;
  }
  // Everyone else in the room, including the sound. Excluding the player is deliberate: their own
  // copy rides back on the emote below, so nobody hears it twice.
  sendToZone(player.current_zone, { type: 'truck_horn', typeId }, player.id);
  sendToZone(player.current_zone, { type: 'emote', message:
    `<span class="text-amber">An air horn goes off somewhere very close to you.</span>` }, player.id);
  sendToPlayer(player.id, { type: 'truck_horn', typeId });
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
  if (!info) { await cmdPark([], '', player); return res || { type: 'noop' }; }

  // WHICH WAY. This used to be `dests[0]` — the first row of the table, forever — which quietly
  // made half the map unreachable by road: Terminus is designed as a truck destination (it is
  // deliberately beyond the range of the two cheapest rigs, so the fleet ladder doubles as a map
  // gate) and no truck could ever be pointed at it. The aim comes from the LOAD first, because a
  // contracted run already knows where it is going and asking twice would be ceremony; then from
  // whatever the driver set with `route`; then, only if neither exists, the first limb.
  const destKey = aimedDest(info, rig)?.key || info.dests?.[0]?.key;
  const chain = destKey ? crossingChain(player._crossing.instanceId, destKey) : [];
  if (!chain.length) { await cmdPark([], '', player); return res || { type: 'noop' }; }

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
  if (!dest || dest.grid_x == null) { await cmdPark([], '', player); return; }

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
async function describeDepot(zone) {
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
    return `<span class="ambient">The hardstand outside ${bay.depot.name || bay.zone.name} — swept concrete, `
      + `scored with the arcs of everything that has ever backed onto it, and wide enough to turn something with a `
      + `box behind it. The office and the bays are through the roller door; the road is the road.</span>`;
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
  // (plugins/flight/index.js describeAirfield): the same shape, the same click-to-examine, so a
  // yard full of trucks reads like a ramp full of aircraft because it IS the same fact.
  const { rows } = await query(
    'SELECT name, type_id FROM trucks WHERE depot_zone = $1 ORDER BY created_at LIMIT 5', [zone.id]
  ).catch(() => ({ rows: [] }));
  if (rows.length) {
    const names = rows.map(r => {
      const t = truckType(r.type_id);
      const label = r.name || t?.name || 'a truck';
      return `<span class="action-link" data-action="cmd" data-cmd="examine ${label}" title="look it over">${label}</span>`;
    });
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    line += `\n<span class="furniture-label">Parked up:</span> <span class="text-dim">${list}.</span>`;
  }

  // STANDING TRAILERS. The whole of phase 2.9 is that a dropped box is a thing in a place, and a
  // thing in a place that the room does not mention is a thing nobody will ever find again. Loaded
  // ones say so, because "there is a trailer here with freight still on it" is the sentence the
  // entire drop-and-come-back loop exists to produce.
  const standing = await trailersAt(zone.id);
  if (standing.length) {
    const list = standing.slice(0, 6).map(t =>
      `<span class="action-link" data-action="cmd" data-cmd="hitch ${t.id}" title="back under it">${t.name}</span>`
      + (t.cargo ? ` <span class="text-dim">(loaded)</span>` : '')).join(', ');
    line += `\n<span class="furniture-label">On their legs:</span> <span class="text-dim">${list}.</span>`;
  }
  return line;
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
    if (from && depotAt(getZone(from))) sendToPlayer(actor.id, { type: 'truck_depot_close' });
  } catch (e) { console.error('[trucking] depot auto-open:', e.message); }
});

// A driver who dies, logs out, or otherwise stops being a driver leaves no rig behind in RAM.
// (The crossing itself is voidwalking's to clean up; this is only the steering wheel.)
// LOGGING OUT IN THE CAB IS NOT LOSING THE TRUCK. This used to be a bare `rigs.delete(id)`, which
// is correct as cleanup and wrong as consequence: a dropped socket in the middle of the waste ended
// the haul, and the haul is the game. `saveDrivingState` writes ONE record and then deletes the rig
// itself, so the cleanup still happens on every path. See resume.js for what is and is not stored.
on('player.logout', ({ id }) => { saveDrivingState(id).catch(() => rigs.delete(id)); });
// …and back in. Nothing here can strand a login: every failure inside returns false and leaves the
// player standing exactly where the ordinary login put them.
on('player.login', async ({ id }) => {
  const player = getLivePlayer(id);
  if (player) await restoreDrivingState(player, { mountOnCrossing }).catch(() => {});
});
on('player.death', ({ id }) => { if (rigs.has(id)) { rigs.delete(id); sendToPlayer(id, { type: 'truck_sim_close' }); } });

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
  const here = getZone(player.current_zone);
  const standing = await trailersAt(here?.id);
  if (!standing.length) return say('Nothing standing here to back under. Trailers are bought and left at yards — see the <b>yard</b>.');

  const want = args.length
    ? standing.find(t => t.id === args[0] || t.name.toLowerCase().includes(args.join(' ').toLowerCase()))
    : standing.find(t => t.ownerId === player.id) || standing[0];
  if (!want) return say(`Nothing here by that name. Standing in the yard: ${standing.map(t => t.name).join(', ')}.`);

  // Somebody else's box is somebody else's box. This is the one place trucking says no on grounds
  // of ownership rather than physics, and it is deliberate — an unattended trailer being takeable
  // would make the whole "leave it and come back" loop a coin-flip rather than a plan.
  if (want.ownerId && want.ownerId !== player.id) return say(`${cap(want.name)} is not yours. The pin is locked and the plate has somebody else's number on it.`);

  const got = await hitchTrailer(want.id, rig.truckId, here.id);
  if (!got) return say('You line up on it and somebody else pulls out from under you. Gone.');
  rig.trailer = got;
  if (got.cargo) rig.cargo = got.cargo;     // what was on it is still on it
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
  await dropTrailer(t.id, here.id);
  rig.trailer = null; rig.cargo = null;
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
  trucksync: cmdTruckSync,
  truckevent: cmdTruckEvent,
};

export const hooks = {
  'zone.describeRoom': describeDepot,
  // Flight asks 'who else is out there'; trucking answers with its moving rigs. A gather hook so
  // the dependency stays one-way — flight has never heard of trucking and does not need to.
  'vehicle.contacts': (x, y, range) => truckContactsNear(x, y, range),
};

export const _test = { boardFor, allDepots, allDocks, dockAt, depotAt, describeDepot, LOADS, RECKLESS_MPH };

console.log('[trucking] Plugin loaded.');
