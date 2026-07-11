// Flight plugin — the verb + tick-loop wiring hub. Shared state lives in
// state.js; the systems live in their own modules (hazards / combat / contracts /
// hangars / acquisition) and this file composes them. Full design:
// docs/systems-flight.md (as-built) and docs/proposals/systems-flight.md.
//
// The aircraft is a first-class object that owns its occupant set (no cabin zone;
// the cockpit HUD is synthesized). The sky is a computed overlay over map_world
// coords. Flight is a `flying` posture tick loop; takeoff/landing are interactive
// server-authoritative minigames. See state.js for the shared substrate.

import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { effectiveSkill, awardSkillUse, skillCheck } from '../../server/engine/skills.js';
import { grantSkillIp } from '../../server/engine/ip.js';
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { registerInputMatcher } from '../../server/engine/plugins.js';
import { on } from '../../server/engine/events.js';
import { getTimeScale } from '../../server/engine/gametime.js';
import { dispatchAction, registerAction } from '../../server/engine/actions.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../../server/engine/sift.js';
import { getZoneEnemies, getZoneNpcs } from '../../server/engine/world.js';
import {
  TICK_MS, FUEL_RESERVE_FRAC, BANDS, BAND_LABEL, BAND_BURN, DIRS, DIR_ALIASES,
  liveAircraft, surfaceAt, bounds, loadAircraft, pilotOf, persist, reap, effStats,
  pushHud, out, toOccupants, detach, takeoffDifficulty, landDifficulty,
  parkAt, crash, setHeading, getZone, getLivePlayer, sendToZone, sendToZoneExcept, sendToPlayer, setPosture,
  advance, initFloat, initEngines, enginesAllStable, engineCount, syncEngineTemp,
  ENGINE_IDLE, ENGINE_STABLE_BAND, toDeg, degToCardinal, bearingDeg, groundTheme,
  isContinuous, reconcile, pushContext, contextPayload, bandFromAltitude, effLoadout,
  RENTAL_BILL_MS, rentalOpFee, fieldFor, nearestAirfield, runwayFor,
} from './state.js';
import { describeExterior, rampColorWord, conspicuousnessMult } from './livery.js';
import { districtBiome } from './biomes.js';
import { rollHazards, commands as hazardCommands } from './hazards.js';
import { commands as acquisitionCommands, refuelAt, refuelParked, fieldStocks } from './acquisition.js';
import { commands as combatCommands, tickCombat, relayContacts } from './combat.js';
import { commands as contractCommands, checkContractDelivery, checkCargoDropDelivery, waitingDropAt, ensureFenceDrops, ensureFreightDrops, isFreightLicensed } from './contracts.js';
import { commands as hangarCommands, pushHangarBay } from './hangars.js';
import { commands as charterCommands, charterDebug, charterParkedAt, embarkCharter, activeCharters } from './charter.js';

// Verb-collision routers (see plugin.json `after`): flight wins `board`/`refuel`
// and delegates to the prior owner by context.
import { commands as gametableCommands } from '../gametable/index.js';
import { commands as generatorCommands } from '../generator/index.js';
import { commands as interactionsCommands } from '../interactions/index.js';

// ── Boarding under fire ───────────────────────────────────────────────────────
// Getting into the cockpit mid-fight is a scramble: a Reflexes check (harder the
// more things are on you). Succeed and you slam the hatch — every enemy/NPC loses
// its lock on you and combat breaks off.
function roll2d8() { return Math.floor(Math.random() * 8) + 1 + Math.floor(Math.random() * 8) + 1; }
function attackersOf(player) {
  const zoneId = player.current_zone;
  return {
    enemies: getZoneEnemies(zoneId).filter(e => e && e.targetId === player.id),
    npcs: getZoneNpcs(zoneId).filter(n => n && n._combatTargetId === player.id),
  };
}
function countAttackers(player) {
  const a = attackersOf(player);
  return a.enemies.length + a.npcs.length + (player.pvpTargetId ? 1 : 0);
}
function reflexCheck(player, difficulty) {
  return ((player.stat_reflexes || 0) - difficulty) + (roll2d8() - roll2d8()) >= 0;
}
function breakOffAttackers(player) {
  const { enemies, npcs } = attackersOf(player);
  for (const e of enemies) { e.targetId = null; e.aggroedAt = null; }
  for (const n of npcs) { n._combatTargetId = null; }
  player.combatTargetId = null; player.npcCombatTargetId = null; player.pvpTargetId = null;
  player.disengagedUntil = Date.now() + 6000;
  return enemies.length + npcs.length;
}

// ── Boarding ──────────────────────────────────────────────────────────────────
// Every flyable (non-wreck, non-charter) aircraft parked here, named for SIFT —
// `name` falls back to the type name so "embark mule" matches an unlettered craft.
async function parkedPool(zoneId) {
  const { rows } = await query(
    `SELECT a.id, a.name, a.type_id, a.is_wreck, a.owner_id, a.hangar_id, a.rental, a.custom_data, t.name tname
     FROM aircraft a JOIN aircraft_types t ON t.id=a.type_id WHERE a.parked_zone_id=$1`, [zoneId]);
  return rows.filter(r => !r.is_wreck && r.custom_data?.charter !== true)
    .map(r => ({ ...r, name: r.name || r.tname }));
}

// Resolve which parked craft `embark`/`board` means: bare (no name arg) with
// exactly one candidate auto-picks it; otherwise SIFT scores the name against the
// pool, prompting a disambiguation page (replayed via the `flight.board` Action)
// when more than one is a close match.
async function resolveBoard(zoneId, nameArg) {
  const pool = await parkedPool(zoneId);
  if (!pool.length) return { none: true };
  if (!nameArg) return pool.length === 1 ? { found: pool[0] } : { ambiguous: pool };
  const r = siftResolve(nameArg, pool);
  if (r.type === 'match') return { found: r.candidate };
  if (r.type === 'ambiguous') return { ambiguous: r.candidates };
  return { none: true };
}

async function cmdBoard(args, raw, player, broadcast) {
  if (player.aircraftId) return { type: 'emote', message: "You're already aboard." };

  // Aircraft sit on the ramp, but you BOARD from inside the walk-in hangar (less
  // ambiguity). From the hangar office, reach the aircraft parked on the linked ramp;
  // standing on the ramp of a field that HAS a hangar, you're pointed inside instead.
  const here = getZone(player.current_zone);
  let parkZoneId = player.current_zone;
  if (here?.flags?.hangar_interior && here.flags.hangar_ramp) {
    parkZoneId = here.flags.hangar_ramp;
  } else if (here?.flags?.airfield_id && here.flags.hangar_interior_zone) {
    const verb = (raw || '').trim().toLowerCase().split(/\s+/)[0];
    if (verb === 'board') return gametableCommands.board(args, raw, player, broadcast);
    return { type: 'emote', message: 'Aircraft are boarded from inside the hangar office — head <span class="action-link" data-action="cmd" data-cmd="in">in</span>.' };
  }

  // A chartered aircraft parked on the ramp → board as a passenger (the NPC pilot
  // flies it). Only the player who chartered it may board; anyone else falls through
  // to normal boarding (the reserved charter stays invisible to them).
  const parkedCharter = charterParkedAt(parkZoneId);
  if (parkedCharter && (!parkedCharter.chartererId || parkedCharter.chartererId === player.id)) {
    if ((player.posture || 'standing') !== 'standing')
      return { type: 'emote', message: 'You need to be on your feet to climb aboard.' };
    return embarkCharter(player, parkedCharter);
  }

  const { found, ambiguous, none } = await resolveBoard(parkZoneId, args.join(' ').trim().toLowerCase());
  if (ambiguous) {
    createSelectionState(player.id, ambiguous, { dispatchType: 'flight.board', dispatchParam: 'target' });
    return { type: 'output', message: formatSelectionPage({ allCandidates: ambiguous, visibleIndex: 0, pageSize: 5 }) };
  }
  if (none || !found) {
    // `embark` is aircraft-only; the `board` backup still delegates to poker's
    // community-board when there's no aircraft here.
    const verb = (raw || '').trim().toLowerCase().split(/\s+/)[0];
    if (verb === 'board') return gametableCommands.board(args, raw, player, broadcast);
    return { type: 'emote', message: "There's no aircraft here to embark." };
  }
  return boardFound(found, player, broadcast);
}

// The actual boarding — shared by the direct-match path above and the SIFT
// disambiguation replay (registerAction('flight.board') below).
async function boardFound(found, player, broadcast) {
  if ((player.posture || 'standing') !== 'standing')
    return { type: 'emote', message: 'You need to be on your feet to climb aboard.' };

  // Boarding under fire — a Reflexes check, harder the more attackers are on you.
  const inCombat = !!(player.combatTargetId || player.pvpTargetId || player.npcCombatTargetId);
  if (inCombat) {
    const diff = 4 + Math.max(0, countAttackers(player) - 1);
    if (!reflexCheck(player, diff)) {
      broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} lunges for the cockpit but is beaten back into the fight.` }, player.id);
      return { type: 'emote', message: '<span class="text-amber">You break for the cockpit — but they\'re all over you and drive you back. Try again.</span>' };
    }
  }

  // Parked security: a craft locked in a hangar is off-limits to non-owners; an
  // owned craft on an open ramp CAN be stolen — but that's grand theft (heat).
  const owned = found.owner_id && found.owner_id !== player.id && !found.rental;
  if (found.hangar_id && found.owner_id !== player.id)
    return { type: 'emote', message: 'That aircraft is locked away in someone else\'s hangar.' };
  if (owned) {
    await dispatchAction({ type: 'WANTED_RAISE', actor: player, params: { amount: 3, reason: 'stealing an aircraft' } });
    broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} breaks into a parked aircraft that isn't theirs.` }, player.id);
  }

  const live = await loadAircraft(found.id);
  if (!live) return { type: 'error', message: 'That aircraft is in no state to fly.' };
  const seat = pilotOf(live) ? 'passenger' : 'pilot';
  if (seat === 'passenger' && live.occupants.size >= effLoadout(live.row, live.type).seats)
    return { type: 'emote', message: `The ${live.type.name} is full${live.row.custom_data?.loadout ? ' — it\'s rigged for freight' : ''}.` };

  live.occupants.add(player.id);
  player.aircraftId = found.id;
  player.seat = seat;
  if (seat === 'pilot') live.pilotId = player.id;
  // Made it in under fire — slam the hatch and everything on you loses its lock.
  let broke = 0;
  if (inCombat) {
    broke = breakOffAttackers(player);
    broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} throws themselves into the ${live.type.name} and hauls the hatch shut.` }, player.id);
  } else {
    broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} climbs into the ${live.type.name}.` }, player.id);
  }
  // A pilot flies the live cockpit sim; everyone else (passengers on any craft, and legacy
  // craft occupants) rides the cabin-window HUD — they look out a window, nothing to fly.
  if (seat === 'pilot' && isContinuous(live)) sendFlightSim(player, live); else pushHud(live);
  // Refresh the cabin-occupancy readout on a seated pilot when a rider joins.
  if (seat !== 'pilot' && isContinuous(live)) pushContext(live);
  const hint = seat !== 'pilot'
    ? 'You strap into a passenger seat and wait on the pilot.'
    : isContinuous(live)
      ? "You drop into the seat. <b>Flip the ENGINE switch</b>, ease the <b>THROTTLE</b> up, and <b>pull back</b> on the yoke as she comes alive to fly her off."
      : "You settle into the pilot's seat. <span class=\"text-dim\">startup</span>, set a <span class=\"text-dim\">throttle</span>, then <span class=\"text-dim\">takeoff</span>.";
  const scramble = inCombat
    ? `<span class="text-green">You throw yourself aboard and slam the hatch — ${broke ? 'they lose you' : 'the fight breaks off'}.</span> `
    : '';
  // A standing cargo drop at this field only comes up for the pilot, and only
  // once there's actually one waiting here — see contracts.js `waitingDropAt`.
  // `ensureFenceDrops` is a cheap no-op for anyone who hasn't unlocked the fence's
  // air-cargo branch; for those who have, it tops their pallet pool back up first.
  let drop = null;
  if (seat === 'pilot') { await ensureFenceDrops(player); await ensureFreightDrops(player, player.current_zone); drop = await waitingDropAt(player.current_zone, player.id); }
  const cargoHint = drop
    ? drop.kind === 'fence'
      ? `\n<span class="text-cyan">📦 A sealed shipment is waiting on the ramp — <span class="action-link" data-action="cmd" data-cmd="loadcargo">load it</span> and fly it home.</span>`
      : `\n<span class="text-cyan">📦 ${drop.label} (${drop.weight_kg}kg) is waiting on the ramp — <span class="action-link" data-action="cmd" data-cmd="loadcargo">load it</span> and fly it home for ${drop.reward}c.</span>`
    : '';
  // Nudge unlicensed pilots toward the licence that turns those standing loads on.
  const licenseHint = (seat === 'pilot' && !drop && !(await isFreightLicensed(player)))
    ? `\n<span class="text-dim">An air-freight licence (<b>freightlicense</b>) puts standing cargo loads on the ramp wherever you board.</span>`
    : '';
  return { type: 'emote', message: `${scramble}You climb aboard the ${live.type.name}. ${hint}${cargoHint}${licenseHint}` };
}

async function cmdDisembark(args, raw, player, broadcast) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live) return { type: 'emote', message: "You're not aboard anything." };
  if (live.row.airborne) return { type: 'emote', message: "You can't step out — you're in the air." };
  const name = live.type.name;
  detach(player);
  // A remaining pilot's cabin readout updates as riders leave.
  if (liveAircraft.has(live.row.id) && isContinuous(live)) pushContext(live);
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} climbs down out of the ${name}.` }, player.id);
  return { type: 'emote', message: `You climb down out of the ${name}.` };
}

// ── Engine / throttle ─────────────────────────────────────────────────────────
export function requirePilot(player) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live) return { err: { type: 'emote', message: "You're not aboard an aircraft." } };
  if (player.seat !== 'pilot') return { err: { type: 'emote', message: "You're not in the pilot's seat." } };
  return { live };
}

async function cmdStartup(args, raw, player, broadcast) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (isContinuous(live)) return { type: 'emote', message: 'Flip the <b>ENGINE</b> switch on the cockpit panel.' };
  if (live.row.airborne) return { type: 'emote', message: "The engine's already running — you're flying it." };
  if (live.row.engine_on && enginesAllStable(live)) return { type: 'emote', message: 'Engines are lit and stable.' };
  if (live.row.engine_on && live.runup) return { type: 'emote', message: 'Already running up — watch the gauges settle.' };
  if (live.row.fuel <= 0) return { type: 'emote', message: 'Dry tank. Nothing to burn — you\'ll need to refuel.' };
  const chk = await skillCheck(player, 'piloting', Math.max(2, takeoffDifficulty(live) - 3));
  if (!chk.success) {
    return { type: 'emote', message: 'A starter cartridge misfires — the engine coughs and dies. Reset and try again.' };
  }
  // Begin a live run-up: engines spin and warm toward their stable idle band.
  live.row.engine_on = 1;
  live.runup = true;
  initEngines(live);
  live.engines.forEach((e, i) => { e.spoolAt = i * 1.2; e.t = 0; });  // stagger multi-engine starts
  await persist(live);
  pushHud(live);
  await awardSkillUse(player.id, 'piloting', 0);
  const n = engineCount(live);
  broadcast(player.current_zone, { type: 'zone_event', message: `The ${live.type.name} whines and its ${n > 1 ? n + ' engines' : 'engine'} spin up.` }, player.id);
  return { type: 'emote', message: `<span class="text-cyan">Starter engaged — ${n > 1 ? 'all ' + n + ' engines' : 'the engine'} spooling up.</span> Watch the temps climb and <b>settle to green</b> before you roll — a cold engine can fail on takeoff.` };
}

// Run-up ticker (1s) — warms each engine toward its stable idle band; announces
// when the whole plant is green. Faster than the flight tick so the gauges live.
async function runupTick() {
  for (const live of liveAircraft.values()) {
    if (!live.runup || !live.engines) continue;
    let allStable = true;
    for (const e of live.engines) {
      e.t = (e.t || 0) + 1;
      if (e.t < (e.spoolAt || 0)) { allStable = false; continue; }   // not yet cranking
      e.temp += (ENGINE_IDLE - e.temp) * 0.28 + (Math.random() - 0.5) * 3;
      if (Math.abs(e.temp - ENGINE_IDLE) <= ENGINE_STABLE_BAND) { e.stableFor = (e.stableFor || 0) + 1; }
      else e.stableFor = 0;
      e.stable = (e.stableFor || 0) >= 3;
      if (!e.stable) allStable = false;
    }
    syncEngineTemp(live);
    if (allStable) {
      live.runup = false;
      await persist(live);
      toOccupants(live, '<span class="text-green">All engines stable and in the green. Cleared to roll — <b>throttle</b> up and <b>takeoff</b>.</span>');
    }
    pushHud(live);
  }
}
setInterval(() => runupTick().catch(e => console.error('[flight] runup error:', e.message)), 1000);

async function cmdShutdown(args, raw, player, broadcast) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (live.row.airborne) return { type: 'emote', message: 'You are NOT shutting the engine down up here.' };
  if (!live.row.engine_on) return { type: 'emote', message: "The engine's already cold." };
  live.row.engine_on = 0; live.row.throttle = 0;
  await persist(live); pushHud(live);
  return { type: 'emote', message: 'You kill the engine. It winds down to a tick and then silence.' };
}

async function cmdThrottle(args, raw, player) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (!live.row.engine_on) return { type: 'emote', message: 'The engine is off. Nothing to throttle.' };
  const n = parseInt(args[0], 10);
  if (Number.isNaN(n)) return { type: 'emote', message: 'Throttle to what? Try `throttle 0`–`throttle 100`.' };
  live.row.throttle = Math.max(0, Math.min(100, n));
  pushHud(live);
  return { type: 'emote', message: `Throttle set to ${live.row.throttle}%.` };
}

// ── Heading / altitude ────────────────────────────────────────────────────────
async function cmdHeading(args, raw, player) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (!live.row.airborne) return { type: 'emote', message: 'Set a heading once you\'re in the air.' };
  const arg = (args[0] || '').toLowerCase();
  const card = DIR_ALIASES[arg] || arg;
  let deg;
  if (DIRS[card]) deg = toDeg(card);
  else if (/^\d{1,3}$/.test(arg)) deg = ((parseInt(arg, 10) % 360) + 360) % 360;
  else return { type: 'emote', message: 'Heading where? A compass point (n, se, …) or a bearing (`heading 247`).' };
  setHeading(live, deg); live.hover = false; pushHud(live);
  return { type: 'emote', message: `Coming around to <b>${String(deg).padStart(3, '0')}°</b> (${degToCardinal(deg).toUpperCase()}).` };
}

async function cmdClimb(args, raw, player) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (!live.row.airborne) return { type: 'emote', message: 'You need to be airborne to climb.' };
  const cur = BANDS.indexOf(live.row.altitude_band), ceil = effStats(live).ceiling;
  if (cur >= ceil) return { type: 'emote', message: `The ${live.type.name} won't climb past ${BAND_LABEL[BANDS[ceil]]}.` };
  const chk = await skillCheck(player, 'piloting', 4 + effStats(live).handling);
  live.row.fuel = Math.max(0, live.row.fuel - 0.5);
  if (!chk.success) return { type: 'emote', message: 'You haul back on the stick but the climb mushes out — try again.' };
  live.row.altitude_band = BANDS[cur + 1];
  await awardSkillUse(player.id, 'piloting', 0); pushHud(live);
  return { type: 'emote', message: `<span class="text-cyan">You climb to ${BAND_LABEL[live.row.altitude_band]}.</span>` };
}

async function cmdDive(args, raw, player) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (!live.row.airborne) return { type: 'emote', message: 'You need to be airborne to descend.' };
  const cur = BANDS.indexOf(live.row.altitude_band);
  if (cur <= 1) return { type: 'emote', message: "You're as low as you fly without landing. Try `land`." };
  live.row.altitude_band = BANDS[cur - 1]; pushHud(live);
  return { type: 'emote', message: `You nose down to ${BAND_LABEL[live.row.altitude_band]}.` };
}

// ── Takeoff / land (minigames) ────────────────────────────────────────────────
async function cmdTakeoff(args, raw, player, broadcast) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (isContinuous(live)) return { type: 'emote', message: 'No command needed — <b>throttle up</b> in the cockpit and ease back on the yoke as she comes alive to fly her off.' };
  if (live.row.airborne) return { type: 'emote', message: "You're already flying." };
  if (!live.row.engine_on) return { type: 'emote', message: 'Spin the engine up first — `startup`.' };
  const zone = getZone(live.row.parked_zone_id);
  if (!zone?.flags?.airfield_id) return { type: 'emote', message: 'You can only take off from an airfield.' };
  if (live.row.fuel < effStats(live).fuelCap * FUEL_RESERVE_FRAC)
    return { type: 'emote', message: 'Not enough fuel to safely take off. Refuel first.' };
  if (effStats(live).overweight)
    return { type: 'emote', message: `Overloaded — ${effStats(live).cargo}kg is over max takeoff weight. She won't fly. Shed cargo.` };

  // Throttle is now set during the takeoff run itself (the departure deck), not
  // as a precondition — you fly it off the runway.

  const token = randomUUID();
  live.pending = { kind: 'takeoff', token };
  const isVtol = live.type.takeoff_mode === 'vtol';
  sendToPlayer(player.id, {
    type: 'flight_takeoff', token, vtol: isVtol,
    skill: await effectiveSkill(player, 'piloting'), difficulty: takeoffDifficulty(live), deviceName: live.type.name,
    airport: groundTheme(zone),
  });
  broadcast(live.row.parked_zone_id, { type: 'zone_event', message: `The ${live.type.name} runs up its engine and ${isVtol ? 'lifts on its rotors' : 'begins its takeoff roll'}.` }, player.id);
  return { type: 'emote', message: isVtol
    ? '<span class="text-cyan">Pulling pitch — hold it steady and lift off.</span>'
    : '<span class="text-cyan">Rolling for takeoff — hold it straight and rotate.</span>' };
}

async function cmdLand(args, raw, player, broadcast) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (isContinuous(live)) return { type: 'emote', message: 'No command needed — line her up on a runway and fly her down; brake to a stop and cut the <b>ENGINE</b> to taxi in and park.' };
  if (!live.row.airborne) return { type: 'emote', message: "You're already on the ground." };
  if (live.row.altitude_band !== 'low') return { type: 'emote', message: 'Descend to LOW over a field before you land — `dive`.' };
  const below = surfaceAt(live.row.grid_x, live.row.grid_y);
  const isVtol = live.type.takeoff_mode === 'vtol';
  // VTOL can set down on any cleared (built) cell; others need an airfield.
  const field = below?.flags?.airfield_id ? below : (isVtol && below ? below : null);
  if (!field) return { type: 'emote', message: isVtol ? 'Nothing below you but open air — find ground to set down on.' : 'There\'s no airfield below you. Find one before you set down.' };

  const emergency = live.row.fuel <= 0 || !!live.hazard;
  const token = randomUUID();
  live.pending = { kind: 'land', token, fieldZoneId: field.id, emergency };
  sendToPlayer(player.id, {
    type: 'flight_land', token, emergency, vtol: isVtol,
    skill: await effectiveSkill(player, 'piloting'), difficulty: landDifficulty(live, emergency), deviceName: field.name,
    airport: groundTheme(field),
  });
  return { type: 'emote', message: emergency
    ? '<span class="text-red">DEAD STICK — you get one pass. Fly the glideslope down.</span>'
    : '<span class="text-cyan">On approach. Fly the glideslope down and flare.</span>' };
}

async function cmdRefuel(args, raw, player, broadcast) {
  if (!player.aircraftId) {
    // Not aboard: `refuel <name>` off the room examine-menu tops off that parked owned
    // craft at the field. Anything that doesn't name a craft on the ramp → generator refuel.
    const m = await matchCraftHere(args, player);
    if (m && m.owner_id === player.id) return refuelParked(player, m.id);
    return generatorCommands.refuel(args, raw, player, broadcast);
  }
  const res = await refuelAt(args, raw, player);
  // The continuous cockpit only gets fuel pushes while airborne — sync it now so a
  // ground refuel actually reaches the client (clears dead-stick, restores thrust).
  const live = liveAircraft.get(player.aircraftId);
  if (live && isContinuous(live)) pushContext(live);
  return res;
}

// ── Resolvers ─────────────────────────────────────────────────────────────────
async function cmdTakeoffResolve(args, raw, player) {
  const token = args[0], won = args[1] === '1';
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live || player.seat !== 'pilot' || live.pending?.kind !== 'takeoff' || live.pending.token !== token) return { type: 'noop' };
  live.pending = null;
  if (live.row.airborne) return { type: 'noop' };
  if (!won) {
    live.row.engine_temp = Math.min(160, live.row.engine_temp + 12);
    out(player.id, '<span class="text-red">You run out of strip and haul back to a stop, engine screaming. Aborted.</span>');
    pushHud(live); return { type: 'noop' };
  }
  live.row.airborne = 1; live.row.altitude_band = 'low'; live.row.parked_zone_id = null; live.starving = false;
  live.runup = false;
  if (live.row.throttle < 50) live.row.throttle = 70;   // climb-out power (the deck flew it off; keep it flying)
  initFloat(live);
  // Rolled before the engines settled? They'll run hot and rough for a while, and
  // may fail outright (hazards.rollHazards reads coldStart).
  live.coldStart = enginesAllStable(live) ? 0 : 8;
  if (live.coldStart) toOccupants(live, '<span class="text-amber">You firewall it with the temps still swinging — the engine note is rough. This was a gamble.</span>');
  for (const pid of live.occupants) {
    const p = getLivePlayer(pid); if (!p) continue;
    getZone(p.current_zone)?.players.delete(pid);
    setPosture(p, 'flying');
  }
  await persist(live); pushHud(live);
  await awardSkillUse(player.id, 'piloting', Math.max(0, (await effectiveSkill(player, 'piloting')) - takeoffDifficulty(live)));
  out(player.id, '<span class="text-green">Wheels up. You claw into the sky and the ground drops away below you.</span>');
  return { type: 'noop' };
}

async function cmdLandResolve(args, raw, player, broadcast) {
  const token = args[0], won = args[1] === '1';
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live || player.seat !== 'pilot' || live.pending?.kind !== 'land' || live.pending.token !== token) return { type: 'noop' };
  const { fieldZoneId, emergency } = live.pending;
  live.pending = null;
  if (!live.row.airborne) return { type: 'noop' };
  if (won) {
    await parkAt(live, fieldZoneId);
    out(player.id, '<span class="text-green">You grease it on. Wheels down, throttle back — you\'re on the ground.</span>');
    await awardSkillUse(player.id, 'piloting', Math.max(0, (await effectiveSkill(player, 'piloting')) - landDifficulty(live, emergency)));
    await checkContractDelivery(player, live, fieldZoneId);
    await checkCargoDropDelivery(player, live, fieldZoneId);
    return { type: 'noop' };
  }
  live.row.damage = Math.min(1, live.row.damage + (emergency ? 0.5 : 0.35));
  if (live.row.damage >= 1) { await crash(live, 'crash'); return { type: 'noop' }; }
  await parkAt(live, fieldZoneId);
  out(player.id, '<span class="text-red">You slam it down hard — something in the airframe screams and gives. But you\'re down.</span>');
  broadcast(fieldZoneId, { type: 'zone_event', message: `The ${live.type.name} thumps down onto the field hard enough to bounce.`, refresh: true }, player.id);
  return { type: 'noop' };
}

// ── Continuous flight (client-sim + server-reconcile) ─────────────────────────
// The Mayfly (and, later, every generalized type) flies a continuous 60fps client
// physics loop. The client streams state via `flightsync` and reports the discrete
// transitions (wheels-up / touchdown / crash) via `flightevent`. The server clamps
// the reported state to a sane envelope, owns fuel + all world consequences, and
// pushes the world context back each tick. See docs/proposals/flight-overhaul.md.

// Graded-landing → piloting IP (mirrors the client report card's fpm→A+…F- bands): A- or
// better = 3, B+ through C- = 2, D through F- = 1. A crash never sends `land`, so it earns 0.
const LANDING_IP = { 'A+': 3, 'A': 3, 'A-': 3, 'B+': 2, 'B': 2, 'B-': 2, 'C+': 2, 'C': 2, 'C-': 2, 'D': 1, 'F-': 1 };
// Only a real flight (≥5 min airborne) earns landing IP — stops circuits-and-bumps farming.
const LANDING_IP_MIN_MS = 5 * 60 * 1000;

// Open the continuous cockpit on the client (parked, ready to fly). Sent on board —
// the whole flight is flown from the cockpit UI (engine switch, throttle, yoke); no
// startup/takeoff commands.
function sendFlightSim(player, live) {
  const zone = getZone(live.row.parked_zone_id);
  const ctx = contextPayload(live);
  sendToPlayer(player.id, {
    type: 'flight_sim',
    craftType: live.type.id.replace(/^ac_/, ''),
    craftClass: live.type.class,
    deviceName: live.type.name,
    airport: groundTheme(zone),
    gx: live.row.grid_x, gy: live.row.grid_y, heading: toDeg(live.row.heading),
    runway: runwayFor(zone), // real departure runway from the map's centreline tiles (null = VTOL pad / no strip)
    engineOn: !!live.row.engine_on,
    registration: String(live.row.name || live.type.name || 'MAYFLY').toUpperCase(),
    owner: (live.row.rental || !live.row.owner_id) ? 'RENTED'
      : (live.row.owner_id === player.id ? String(player.name || player.username || 'OWNER').toUpperCase() : 'PRIVATE'),
    fuel: ctx.fuel, fuelCap: ctx.fuelCap, map: ctx.map, sky: ctx.sky, biomeBelow: ctx.biomeBelow, minimap: ctx.minimap, fields: ctx.fields,
    engines: ctx.engines, seats: ctx.seats, occupants: ctx.occupants,   // gauge count + cabin-occupancy readout
    // Per-airframe capabilities the continuous cockpit adapts to (Phase 3): the Mule,
    // Reaper + Leviathan have retractable gear (only the fixed-gear Mayfly stays down);
    // hardpoints arm the weapons; cargo enables jettison.
    gearRetract: ['prop', 'gunship', 'heavy'].includes(live.type.class),
    hardpoints: live.type.hardpoints || 0,
    cargoCap: live.type.cargo_capacity || 0, cargoKg: ctx.cargo,
  });
}

async function cmdFlightSync(args, raw, player) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live || player.seat !== 'pilot' || !isContinuous(live)) return { type: 'noop' };
  // packed: gx gy alt ias hdg thr vs onground stalled [bank pitch]
  const n = args.map(Number);
  if (n.length < 9 || n.some(Number.isNaN)) return { type: 'noop' };
  reconcile(live, { gx: n[0], gy: n[1], alt: n[2], ias: n[3], hdg: n[4], thr: n[5], vs: n[6], onGround: n[7] === 1, stalled: n[8] === 1, bank: n[9], pitch: n[10] });
  // While rolling out on the ground over an airfield, remember it — the shutdown `land`
  // parks here even if the roll drifts a tile off the runway before the engine's cut.
  if (n[7] === 1) { const b = surfaceAt(live.row.grid_x, live.row.grid_y); if (b?.flags?.airfield_id) live.rolloutField = b.id; }
  // Event-driven air-to-air contact relay: this craft just moved, so refresh its own
  // traffic picture and push its fresh position to nearby pilots (Phase A: see-only).
  if (live.row.airborne && !live.cont?.onGround) relayContacts(live);
  return { type: 'noop' };
}

// Tow an off-strip landing home. The craft set down away from a field but under the
// crash threshold, so she's fine — the hangar dispatches a recovery crew, parks her at
// the field she flew out of (or the nearest one), and bills the pilot a retrieval fee
// scaled to the airframe's value. Short on credits? We garnish what you have — the
// aircraft still comes back; consider the rest a debt to your dignity.
async function retrieveOffField(live, player) {
  const spot = surfaceAt(live.row.grid_x, live.row.grid_y);
  const home = (live.homeField && getZone(live.homeField)?.flags?.airfield_id)
    ? { id: live.homeField, name: getZone(live.homeField).flags.airfield_name || getZone(live.homeField).name }
    : nearestAirfield(live.row.grid_x, live.row.grid_y);
  const fee = Math.max(120, Math.round((live.type.price_buy || 400) * 0.05));
  const paid = Math.min(player.credits || 0, fee);
  player.credits = Math.max(0, (player.credits || 0) - fee);
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  const where = spot?.name || 'open country';
  // No airfield in the world to tow to (shouldn't happen) — just leave her parked where she sits.
  const dest = home?.id || spot?.id || live.row.parked_zone_id;
  await parkAt(live, dest);
  out(player.id, `<span class="text-amber">You set the ${live.type.name} down clean, but this is no airstrip — you've put down in ${where}.</span> ` +
    `<span class="item-grant">A hangar recovery crew tows her back to ${home?.name || 'the field'} and hands you the bill: <b>${fee}c</b> for the retrieval${paid < fee ? ` (only ${paid}c of it covered — the rest is owed)` : ''}.</span>`);
}

async function cmdFlightEvent(args, raw, player, broadcast) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live || player.seat !== 'pilot' || !isContinuous(live)) return { type: 'noop' };
  const ev = (args[0] || '').toLowerCase();

  if (ev === 'takeoff') {
    if (live.row.airborne) return { type: 'noop' };
    const zone = getZone(live.row.parked_zone_id);
    // Remember where she left from, so an off-strip landing can be towed home to a field
    // the player actually uses (falls back to the nearest airfield if this is ever lost).
    if (zone?.flags?.airfield_id) live.homeField = zone.id;
    live.row.airborne = 1; live.row.parked_zone_id = null; live.starving = false; live.runup = false; live.rolloutField = null;
    if (!live.flightStartMs) live.flightStartMs = Date.now();   // trip clock for landing-IP eligibility (persists across touch-and-goes)
    initFloat(live);
    for (const pid of live.occupants) {
      const p = getLivePlayer(pid); if (!p) continue;
      getZone(p.current_zone)?.players.delete(pid);
      setPosture(p, 'flying');
    }
    await persist(live);
    if (zone) broadcast(zone.id, { type: 'zone_event', message: `The ${live.type.name} lifts off and climbs away.` }, player.id);
    await awardSkillUse(player.id, 'piloting', 0);
    out(player.id, '<span class="text-green">Wheels up — you claw into the sky.</span>');
    return { type: 'noop' };
  }

  if (ev === 'land') {
    if (!live.row.airborne) return { type: 'noop' };
    let field = surfaceAt(live.row.grid_x, live.row.grid_y);
    // A long roll-out can drift the plane a tile off the runway before you shut down —
    // fall back to the airfield we actually touched down on (recorded while grounded over it).
    if (!field?.flags?.airfield_id && live.rolloutField) field = getZone(live.rolloutField);
    // Fixed-wing sets down on a real airfield; a VTOL (the Dragonfly) can flare onto any
    // cleared surface tile below it.
    const isVtol = live.type.takeoff_mode === 'vtol';
    // Open water is no place to set her down — nothing in the fleet has floats, so ditching
    // in the bay is a crash, not a courtesy tow. Catch it by BIOME as well as the `flags.water`
    // gate, so a bay tile that only reads as water via its district still ditches you. An
    // airfield tile is never water, so this only bites off-strip.
    if (field && !field.flags?.airfield_id && (field.flags?.water || districtBiome(field) === 'water')) { await crash(live, 'ditched'); return { type: 'noop' }; }
    // Graded-landing IP: a clean touchdown teaches piloting. The client reports the grade it
    // showed the pilot (`land <grade> <fpm>`); award it here for any survivable set-down (a
    // crash lands on the `crash` path with 0), but only once the trip has been ≥5 min airborne.
    // `field` is truthy for both a real airfield and an off-strip tow; a void/water landing
    // (field falsy / water) crashed above and never reaches here.
    if (field) {
      const grade = String(args[1] || '').toUpperCase();
      const fpm = Math.round(Number(args[2]) || 0);
      const flewMs = Date.now() - (live.flightStartMs || Date.now());
      live.flightStartMs = null;   // trip over — a re-takeoff starts a fresh clock
      const ip = LANDING_IP[grade] || 0;
      if (ip > 0 && flewMs >= LANDING_IP_MIN_MS) {
        const res = await grantSkillIp(player.id, 'piloting', ip);
        out(player.id, `<span class="ip-gain">Landing grade ${grade} (${fpm} fpm) — +${res.awarded} IP · Piloting${res.leveledUp ? ` — skill rises to level ${res.level}` : ''}</span>`);
      } else if (ip > 0) {
        out(player.id, `<span class="text-dim">Landing grade ${grade} (${fpm} fpm) — no IP earned (flight under 5 min).</span>`);
      }
    }
    if (field?.flags?.airfield_id || (isVtol && field)) {
      await parkAt(live, field.id);
      await awardSkillUse(player.id, 'piloting', 0);
      await checkContractDelivery(player, live, field.id);
      await checkCargoDropDelivery(player, live, field.id);
      // Everyone climbs out onto the tile where she settled (parkAt set their zone to it).
      // At a real airfield the client opens straight into the hangar bay; off-field — a VTOL
      // that flared onto any surface — they're simply put down where they landed and can walk
      // away, then `embark` the parked craft again to lift back off.
      for (const pid of [...live.occupants]) { const p = getLivePlayer(pid); if (p) detach(p); }
      return { type: 'noop' };
    }
    // Off-strip, but she made it down in one piece: the client only sends `land` for a
    // survivable touchdown (a sink >600 fpm reports `crash hardlanding` instead). So a
    // fixed-wing that put down in a field/street doesn't die — the hangar sends a crew to
    // tow her back and bills you for the retrieval. Nothing solid below at all (open water/
    // the void off the map edge) is still a crash — there's nowhere to set down.
    if (field) { await retrieveOffField(live, player); return { type: 'noop' }; }
    await crash(live, 'offfield');
    return { type: 'noop' };
  }

  if (ev === 'crash') {
    if (!liveAircraft.has(live.row.id)) return { type: 'noop' };
    await crash(live, (args[1] || 'crash').slice(0, 24));
    return { type: 'noop' };
  }

  // A glancing building clip (survivable CFIT hit reported by the sim): real hull damage,
  // and if it tips her past the edge she goes down as a controlled-flight-into-terrain loss.
  if (ev === 'clip') {
    if (!live.row.airborne) return { type: 'noop' };
    live.row.damage = Math.min(1, (live.row.damage || 0) + 0.2);
    out(player.id, '<span class="text-amber">You clip a rooftop — the airframe shudders and something tears.</span>');
    if (live.row.damage >= 1) { await crash(live, 'cfit'); return { type: 'noop' }; }
    await persist(live);
    pushHud(live);
    return { type: 'noop' };
  }

  // Engine master switch (the on-panel replacement for `startup`).
  if (ev === 'engineon') { live.row.engine_on = 1; await persist(live); pushContext(live); return { type: 'noop' }; }
  if (ev === 'engineoff') { if (!live.row.airborne) { live.row.engine_on = 0; live.row.throttle = 0; await persist(live); } return { type: 'noop' }; }
  return { type: 'noop' };
}

// ── No-fly airspace enforcement ───────────────────────────────────────────────
async function checkAirspace(live) {
  const below = surfaceAt(live.row.grid_x, live.row.grid_y);
  const restricted = below?.flags?.airspace_restricted;
  if (!restricted) { live.noflyStage = 0; return; }
  const pilot = pilotOf(live);
  if (!pilot) return;
  live.noflyStage = (live.noflyStage || 0) + 1;
  if (live.noflyStage === 1) {
    out(pilot.id, '<span class="text-amber">⚠ TOWER: You are entering RESTRICTED AIRSPACE. Come about and leave now.</span>');
  } else if (live.noflyStage === 2 && !live.noflyRaised) {
    live.noflyRaised = true;
    await dispatchAction({ type: 'WANTED_RAISE', actor: pilot, params: { amount: 2, reason: 'violating restricted airspace' } });
    out(pilot.id, '<span class="text-red">TOWER: You are now a hostile contact. Interceptors are being vectored to you.</span>');
    sendToZone(below.id, { type: 'zone_event', message: 'Police interceptors scramble skyward with a rising howl.' });
  }
}

// ── Engine noise → the ground ─────────────────────────────────────────────────
// Each class has its own signature; loudness scales with the type's noise rating,
// engine count and size, and is cut hard by altitude (high = quiet) and helped by
// speed. That loudness becomes a reach radius over the tile grid: nearby ground
// zones hear an identified pass, farther ones a fainter directional rumble.
const CLASS_SOUND = {
  ultralight: { near: 'buzzes past low overhead like an angry wasp',            far: 'the thin two-stroke whine of an ultralight' },
  heli:       { near: 'clatters low overhead, rotors thudding the air flat',    far: 'the flat thudding of rotor blades' },
  prop:       { near: 'drones past low overhead, prop clawing the air',         far: 'the steady drone of a piston aircraft' },
  heavy:      { near: 'thunders past low overhead, the ground trembling',       far: 'a deep, building roar' },
  gunship:    { near: 'screams past low and fast — you feel it in your chest',  far: 'a hard, fast howl closing in' },
  wreck:      { near: 'sputters past low overhead trailing a thread of smoke',  far: 'a rough, misfiring engine somewhere aloft' },
};
function classSound(cls) { return CLASS_SOUND[cls] || CLASS_SOUND.prop; }

// Reach in tiles (0 = inaudible from the ground).
function noiseReach(live) {
  const t = live.type, a = live.row;
  let loud = (t.noise || 2) + Math.max(0, (t.engines || 1) - 1) * 0.4 + ((t.max_takeoff_weight || 0) > 800 ? 1 : 0);
  loud += (a.throttle - 50) / 60;                       // firewalled = louder; idling = quieter
  loud *= conspicuousnessMult(live);                    // paint: dark/matte/camo hides, bright/gloss/hazard shouts
  if (a.altitude_band === 'high') return 0;             // too high to hear
  if (a.altitude_band === 'cruise') loud -= 2;          // muffled by altitude
  return Math.max(0, Math.min(4, Math.round(loud)));
}

function overflyNoise(live) {
  const a = live.row, t = live.type;
  const reach = noiseReach(live);
  if (reach <= 0) return;
  const snd = classSound(t.class), hdg = degToCardinal(toDeg(a.heading)).toUpperCase();
  for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) {
    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    if (dist > reach) continue;
    const cell = surfaceAt(a.grid_x + dx, a.grid_y + dy);
    if (!cell) continue;
    if (Math.random() > Math.max(0.08, 0.55 - dist * 0.16)) continue;   // thins with distance → not spammy
    let msg;
    if (dist === 0) msg = `<span class="text-dim">A <b>${t.name}</b> ${snd.near}, heading ${hdg}.</span>`;
    else {
      const from = degToCardinal(bearingDeg(a.grid_x + dx, a.grid_y + dy, a.grid_x, a.grid_y)).toUpperCase();
      msg = `<span class="text-dim">You hear ${snd.far} to the ${from}${dist >= reach ? ', distant' : ''}.</span>`;
    }
    // Exclude our own occupants: they share a stale ground zone but are aloft — they
    // must never hear the noise their own aircraft is making below them.
    sendToZoneExcept(cell.id, { type: 'zone_event', message: msg }, live.occupants);
    if (dist === 0 && a.altitude_band === 'low') groundReact(live, cell.id, reach);
  }
}

// Ground threats notice a loud, low pass: hostiles snarl and the aggressive ones
// throw up small-arms fire (a lighter cousin of the AA in combat.js).
async function groundReact(live, zoneId, loud) {
  const enemies = getZoneEnemies(zoneId);
  if (!enemies.length) return;
  const hostiles = enemies.filter(e => e && (e.behavior === 'aggressive' || e.behavior === 'defensive'));
  if (!hostiles.length) return;
  const e = hostiles[Math.floor(Math.random() * hostiles.length)];
  sendToZoneExcept(zoneId, { type: 'zone_event', message: `${e.name} snaps its head up, tracking the aircraft overhead.` }, live.occupants);
  // Aggressive things take a potshot; louder/lower = a fatter, easier target.
  if (e.behavior === 'aggressive' && Math.random() < 0.15 + loud * 0.05) {
    live.row.damage = Math.min(1, live.row.damage + 0.05);
    toOccupants(live, `<span class="text-amber">Ground fire from below cracks off the hull — hull ${Math.round((1 - live.row.damage) * 100)}%.</span>`);
    sendToZoneExcept(zoneId, { type: 'zone_event', message: `${e.name} looses a burst of fire up at the passing aircraft.` }, live.occupants);
    if (live.row.damage >= 1) await crash(live, 'groundfire');
  }
}

// ── The airborne tick loop ────────────────────────────────────────────────────
let ticking = false;
// The rental meter: a self-flown rental (rental=1, owner_id=the renter) racks up an
// operating fee every RENTAL_BILL_MS of FLIGHT time — gas + upkeep bundled, so the renter
// never pays at the pump or for repairs. Only ticks while airborne; parked time is free.
async function billRental(live) {
  if (!live.row.rental || !live.row.airborne) return;
  live.rentalMs = (live.rentalMs || 0) + TICK_MS;
  if (live.rentalMs < RENTAL_BILL_MS) return;
  live.rentalMs -= RENTAL_BILL_MS;
  const renter = getLivePlayer(live.row.owner_id);
  if (!renter) return;   // renter offline — skip this window (no debt modelled)
  const fee = rentalOpFee(live.type);
  const pay = Math.min(fee, renter.credits || 0);
  renter.credits = (renter.credits || 0) - pay;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [renter.credits, renter.id]);
  sendToPlayer(renter.id, { type: 'player_update', credits: renter.credits });
  out(renter.id, `<span class="text-amber">⏱ Rental meter: <b>${fee}c</b> for the last half-hour aloft (gas &amp; upkeep).${pay < fee ? ' <span class="text-red">You couldn\'t cover it — the desk will settle up when you return her.</span>' : ''} Balance ${renter.credits}c.</span>`);
}

// Fuel endurance is calibrated in GAME time, not real time: the per-type tanks are
// sized so a full tank lasts a fixed number of *real* minutes at the x3 baseline
// game speed (Mayfly 10, Mule 20, Leviathan 30, Reaper 10 — full-throttle cruise).
// The tank is really a game-world quantity, so the burn scales with the live game
// speed: run the world faster and the fuel drains proportionally faster in real
// time (a leg still covers the same span of game-time). Baseline x3 ⇒ factor 1.
const BASELINE_TIMESCALE = 3;
function fuelBurnScale() { return (getTimeScale() || BASELINE_TIMESCALE) / BASELINE_TIMESCALE; }

async function flightTick() {
  if (ticking) return;
  ticking = true;
  try {
    for (const live of [...liveAircraft.values()]) {
      if (live.charter) continue;   // NPC-flown charters are driven by charter.js, not the physics tick
      await billRental(live);       // self-flown rentals: the airborne operating meter (gas + upkeep)

      // Continuous craft (the Mayfly slice): the client owns motion/attitude, so we
      // don't advance or run the deck hazards here — we burn fuel authoritatively,
      // run the world consequences off the last reported position, and push context.
      if (isContinuous(live)) {
        if (!live.row.airborne || live.pending) continue;   // taxi/roll is client-side until wheels-up
        const a = live.row, eff = effStats(live);
        // After touchdown the client keeps the sim open and rolls out on the ground
        // (airborne stays 1 until it shuts down or lifts off again). Skip the airborne
        // consequences — fuel burn, airspace/combat, overfly noise — while it's grounded;
        // a taxiing plane mustn't "buzz past overhead" or trip no-fly rules.
        const grounded = !!live.cont?.onGround;
        if (!grounded) {
          a.fuel = Math.max(0, a.fuel - eff.burn * (0.15 + (a.throttle / 100)) * (BAND_BURN[a.altitude_band] || 1) * fuelBurnScale());
          if (a.fuel <= 0 && !live.starving) { live.starving = true; toOccupants(live, '<span class="text-red">⚠ ENGINE OUT — the tank\'s dry. Dead stick. Get it down.</span>'); }
          await checkAirspace(live);
          if (!liveAircraft.has(live.row.id)) continue;
          await tickCombat(live);
          if (!liveAircraft.has(live.row.id)) continue;
          overflyNoise(live);
          if (!liveAircraft.has(live.row.id)) continue;
        }
        // While airborne the pilot is in the AIRCRAFT, not the field — keep them out
        // of the zone's player set so room ambience/banter/vendor chatter doesn't leak
        // into the cockpit. (Belt-and-suspenders against anything re-adding them.)
        for (const pid of live.occupants) { const p = getLivePlayer(pid); if (p) getZone(p.current_zone)?.players.delete(pid); }
        pushContext(live);
        // Passengers ride the cabin-window HUD (not the pilot's live sim) — refresh it each
        // tick so their out-the-window scenery keeps pace with the flight.
        for (const pid of live.occupants) { const p = getLivePlayer(pid); if (p && p.seat !== 'pilot') { pushHud(live); break; } }
        if (++live.persistCtr % 4 === 0) await persist(live);
        continue;
      }

      if (!live.row.airborne || live.pending) continue;
      const a = live.row, eff = effStats(live);

      // 1. Advance along the true heading (sub-tile float accumulation).
      advance(live, live.hover ? 0 : eff.cruise * (a.throttle / 100));
      // 2. Burn.
      a.fuel = Math.max(0, a.fuel - eff.burn * (0.15 + (a.throttle / 100)) * (BAND_BURN[a.altitude_band] || 1) * fuelBurnScale());
      // 3. Thermal — per engine (a cold-started plant runs hotter and rougher).
      const target = 20 + a.throttle * 1.1 + eff.heatBias + (live.coldStart > 0 ? 22 : 0);
      if (live.engines?.length) {
        for (const e of live.engines) e.temp += (target + (e.seed % 2 ? 4 : -4) - e.temp) * 0.3;
        syncEngineTemp(live);
      } else { a.engine_temp += (target - a.engine_temp) * 0.3; }
      // 4. Starvation → dead stick, then crash.
      if (a.fuel <= 0) {
        if (!live.starving) { live.starving = true; for (const pid of live.occupants) out(pid, '<span class="text-red">⚠ ENGINE OUT — the tank\'s dry. Dead stick. Get it down NOW.</span>'); }
        else { await crash(live, 'fuel'); continue; }
      }
      // 5. Hazards + airspace + combat.
      await rollHazards(live);
      if (!liveAircraft.has(live.row.id)) continue;   // hazard may have crashed it
      await checkAirspace(live);
      await tickCombat(live);
      if (!liveAircraft.has(live.row.id)) continue;
      // 6. Emit HUD + propagate engine noise to the ground (identified passes,
      //    directional rumble, and ground-threat reactions).
      pushHud(live);
      overflyNoise(live);
      if (!liveAircraft.has(live.row.id)) continue;   // ground fire may have downed it
      if (++live.persistCtr % 4 === 0) await persist(live);
    }
  } finally { ticking = false; }
}
setInterval(() => flightTick().catch(e => console.error('[flight] tick error:', e.message)), TICK_MS);

// ── Delete one aircraft instance for good ─────────────────────────────────────
// The shared teardown used by the dev-panel DELETE route AND the wreck-maintenance
// sweep: detach any live occupant, drop it from in-memory flight/charter state (so no
// player's aircraftId is left dangling), then remove the row. Returns the DB rowCount.
async function deleteAircraft(id) {
  const live = liveAircraft.get(id);
  if (live) {
    for (const pid of [...live.occupants]) {
      const p = getLivePlayer(pid);
      if (p) detach(p);
    }
    liveAircraft.delete(id);
  }
  activeCharters.delete(id);   // in case a ghost charter row still pointed at it
  const { rowCount } = await query('DELETE FROM aircraft WHERE id=$1', [id]);
  return rowCount;
}

// ── Wreck-maintenance sweep ───────────────────────────────────────────────────
// A crash drops a salvageable wreck row on the tile it hit. Those are meant to be
// picked over (salvage/rebuild), but otherwise they linger forever and clutter the
// map. This periodic sweep clears wrecks that have sat untouched past WRECK_TTL_MS,
// leaving players a window to salvage first. Legacy wrecks with no crash timestamp are
// stamped on first pass (given the full window) rather than all vanishing at once.
const WRECK_TTL_MS = 20 * 60 * 1000;    // untouched wreck lifespan before auto-clear
const WRECK_SWEEP_MS = 5 * 60 * 1000;   // how often the sweep runs
async function wreckSweep() {
  const { rows } = await query("SELECT id, custom_data FROM aircraft WHERE is_wreck=1");
  const now = Date.now();
  for (const r of rows) {
    if (liveAircraft.has(r.id)) continue;   // mid-interaction in memory — leave it
    const at = r.custom_data?.crashed_at;
    if (!at) {
      await query("UPDATE aircraft SET custom_data = jsonb_set(custom_data, '{crashed_at}', to_jsonb($1::bigint)) WHERE id=$2", [now, r.id]);
      continue;
    }
    if (now - at >= WRECK_TTL_MS) await deleteAircraft(r.id);
  }
}
setInterval(() => wreckSweep().catch(e => console.error('[flight] wreck sweep error:', e.message)), WRECK_SWEEP_MS);

// ── Move gate: can't walk while aboard ────────────────────────────────────────
registerMoveGate(({ player }) => {
  if (player.aircraftId) {
    const live = liveAircraft.get(player.aircraftId);
    return { block: true, message: live?.row.airborne ? "You can't walk out of the sky." : "You're strapped into a cockpit — `disembark` first." };
  }
  return undefined;
}, 'flight');

// ── Cardinal-while-airborne → set heading (else fall through to the ground mover)
registerInputMatcher(/^(n|s|e|w|ne|nw|se|sw|north|south|east|west|northeast|northwest|southeast|southwest)$/i,
  async (args, raw, player) => {
    const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
    if (!live || !live.row.airborne || player.seat !== 'pilot') return undefined;
    const d = DIR_ALIASES[raw.toLowerCase()] || raw.toLowerCase();
    setHeading(live, d); live.hover = false; pushHud(live);
    return { type: 'emote', message: `Coming around to ${d.toUpperCase()}.` };
  }, 'flight');

// SIFT disambiguation replay for `embark`/`board` (docs/commands.md — plugin verbs
// can't reach the builtin replay path, so ambiguous picks go through an Action).
registerAction({
  type: 'flight.board',
  handler: ({ actor, params, context }) => boardFound(params.target, actor, context.broadcast),
});

// ── Airfield / hangar services ────────────────────────────────────────────────
// A clickable command link, and the shared "Services:" line built from a field's
// flags — used identically on the exterior ramp and inside the walk-in hangar so
// the two can't drift.
const svcLink = (cmd, label) => `<span class="action-link" data-action="cmd" data-cmd="${cmd}" title="${label}">${label}</span>`;
function serviceBits(field) {
  const f = field.flags || {};
  const bits = [svcLink('hangar', 'hangar')];
  const stocks = fieldStocks(field);
  if (stocks.length) bits.push(`${svcLink('refuel', 'refuel')} <span class="text-dim">(${stocks.join('/')})</span>`);
  if (f.airfield_dealer) bits.push(svcLink('buy', 'buy'));
  if (f.airfield_charter) bits.push(svcLink('rent', 'rent'), svcLink('charter', 'charter'));
  return `<span class="furniture-label">Services:</span> ${bits.join('   ·   ')}`;
}

// Inside a walk-in hangar: the same services (they resolve to the ramp via fieldFor),
// a way `out` to the ramp, the charter pilot when one's on shift — and this is where
// you BOARD: the `embark` link reaches the aircraft parked on the linked ramp.
async function describeHangarInterior(zone) {
  const ramp = getZone(zone.flags.hangar_ramp);
  if (!ramp) return `<span class="furniture-label">Hangar:</span> ${svcLink('out', 'out')} <span class="text-dim">back out to the ramp</span>`;
  let line = `${serviceBits(ramp)}\n<span class="furniture-label">Ramp:</span> ${svcLink('out', 'out')} <span class="text-dim">step back out onto the ramp</span>`;
  line += `\n<span class="furniture-label">Hangar bay:</span> ${svcLink('hangar', 'hangar')} <span class="text-dim">walk the floor — your aircraft up close in 3D; charter, buy/rent, maintenance</span>`;
  // Board straight from the office — the aircraft on the linked ramp are in reach.
  const { rows } = await query(
    "SELECT name FROM aircraft WHERE parked_zone_id=$1 AND is_wreck=0 AND (custom_data->>'charter') IS DISTINCT FROM 'true' LIMIT 1",
    [ramp.id]
  ).catch(() => ({ rows: [] }));
  if (rows.length) {
    const craftLink = `<span class="action-link" data-action="cmd" data-cmd="examine ${rows[0].name}" title="its actions — embark / refuel / maintenance">an aircraft is parked outside</span>`;
    line += `\n<span class="furniture-label">On the ramp:</span> ${svcLink('embark', 'embark')} <span class="text-dim">${craftLink} — board it from here</span> · ${svcLink('loadout', 'loadout')} <span class="text-dim">(seats ⇄ cargo)</span>`;
  }
  const ch = charterParkedAt(ramp.id);
  if (ch) {
    const who = getLivePlayer(ch.chartererId)?.handle;
    line += `\n<span class="furniture-label">Charter waiting:</span> ${svcLink('embark', 'embark')} <span class="text-dim">${ch.pilotName}'s aircraft is on the ramp${who ? `, held for ${who}` : ''}</span>`;
  }
  const pilot = getZoneNpcs(zone.id).find(n => n?.flags?.charter_pilot);
  if (pilot) line += `\n<span class="text-dim">${pilot.name} sits at the ops desk, feet up, a mug going cold on the console.</span>`;
  return line;
}

// Fires unconditionally per zone (unlike zone.furniturePanel, which only fires
// when the zone has furniture rows) — several airfields have none, so this is
// the only reliable way to surface "there's a hangar here" at every field.
async function describeAirfield(zone) {
  if (zone?.flags?.hangar_interior) return await describeHangarInterior(zone);
  if (!zone?.flags?.airfield_id) return undefined;
  const f = zone.flags;
  let line = serviceBits(zone);
  // If this field has a walk-in hangar, boarding is done INSIDE it (less ambiguity) —
  // point players in through the bay doors; the embark links live in the office.
  if (f.hangar_interior_zone) {
    line += `\n<span class="furniture-label">${svcLink('in', 'Hangar')}:</span> <span class="text-dim">desk, tools, the charter pilot — and where you board your aircraft; through the bay doors</span>`;
    return line;
  }
  // No walk-in hangar here → board straight off the ramp. Name each craft by its
  // livery colour so the paint reads at a glance; `examine` gives the full look.
  const { rows } = await query(
    "SELECT a.name, a.custom_data, t.name tname FROM aircraft a JOIN aircraft_types t ON t.id=a.type_id WHERE a.parked_zone_id=$1 AND a.is_wreck=0 AND (a.custom_data->>'charter') IS DISTINCT FROM 'true' ORDER BY a.name LIMIT 4",
    [zone.id]
  ).catch(() => ({ rows: [] }));
  if (rows.length) {
    // Each craft name is a click → `examine <name>`, which opens its action menu
    // (embark / refuel / maintenance + cargo) rather than just a static description.
    const names = rows.map(r => { const c = rampColorWord(r.custom_data?.livery); return `<span class="action-link" data-action="cmd" data-cmd="examine ${r.name}" title="look it over — embark / refuel / maintenance">a ${c ? c + ' ' : ''}${r.tname}</span>`; });
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    line += `\n<span class="furniture-label">On the ramp:</span> ${svcLink('embark', 'embark')} <span class="text-dim">${list} parked here — click one for its actions</span>`;
  }
  // A chartered aircraft waiting for its passenger — held for whoever chartered it.
  const ch = charterParkedAt(zone.id);
  if (ch) {
    const who = getLivePlayer(ch.chartererId)?.handle;
    line += `\n<span class="furniture-label">Charter waiting:</span> ${svcLink('embark', 'embark')} <span class="text-dim">${ch.pilotName}'s aircraft is on the ramp${who ? `, held for ${who}` : ''}</span>`;
  }
  return line;
}

// Walking into a walk-in hangar drops you straight at the ops desk — auto-open the
// bay panel instead of making them type `hangar`. Walking back out (to anywhere,
// not just the ramp) closes it client-side; re-entering re-opens fresh.
on('zone.entered', async ({ actor, zone: zoneId, from }) => {
  if (getZone(zoneId)?.flags?.hangar_interior) { await pushHangarBay(actor); return; }
  if (from && getZone(from)?.flags?.hangar_interior) sendToPlayer(actor.id, { type: 'hangar_close' });
});

// Reconnect resume — a hard refresh (or any dropped connection) tears down the
// in-memory live player entirely (server/index.js's ws `close` handler), which
// loses `player.aircraftId`/`seat` even though the aircraft's own `occupants` set
// (and, for whoever was flying it, `live.pilotId` — the durable seat marker that
// survives exactly this teardown) still lists them as aboard. The fresh login
// snapshot would otherwise show whatever their stale pre-flight zone renders as.
// Re-attach + push the SAME panel they'd get boarding fresh — the continuous
// cockpit for a reconnecting pilot on a continuous airframe, the cabin-window HUD
// for everyone else — the instant they log back in. Mounting either replaces the
// area pane outright, so it overrides the plain look/whatever already went out
// ahead of this.
// A death from any cause (combat, radiation, seppuku, ...) while aboard leaves
// `player.aircraftId` dangling — death teleports to the respawn zone without
// firing `zone.entered`, so the usual disembark path never runs. Detach so the
// aircraft's occupant set and the player's flying posture don't stay stale.
on('player.death', ({ player }) => {
  if (player.aircraftId) detach(player);
});

on('player.login', ({ id }) => {
  const player = getLivePlayer(id);
  if (!player) return;
  // Any aircraft (owner/rental-flown, or an NPC-piloted charter) that still lists
  // this player as aboard. `live.pilotId` is null on a charter (an NPC flies it),
  // so a charter passenger correctly falls to the `else` (cabin-window HUD) below.
  for (const live of liveAircraft.values()) {
    if (!live.occupants.has(id)) continue;
    const seat = live.pilotId === id ? 'pilot' : 'passenger';
    player.aircraftId = live.row.id;
    player.seat = seat;
    getZone(player.current_zone)?.players.delete(id);
    setPosture(player, 'flying');
    if (seat === 'pilot' && isContinuous(live)) sendFlightSim(player, live);
    else pushHud(live);
    return;
  }
});

// ── Admin: free test-fly any aircraft from a field ────────────────────────────
async function cmdTestFly(args, raw, player) {
  if (!['admin', 'dev'].includes(player.role)) return { type: 'error', message: 'Access denied.' };
  if (player.aircraftId) return { type: 'emote', message: 'Disembark first.' };
  // The hangar counts as its field: conjure from inside the walk-in hangar too,
  // resolving the exterior ramp via fieldFor. Standing in the hangar spawns her "in
  // the garage" — you `taxi` her out onto the runway before she'll fly (see cmdTaxi).
  const zone = getZone(player.current_zone);
  const field = fieldFor(player);
  if (!field) return { type: 'emote', message: 'Stand at an airfield (or in its hangar) to conjure a test aircraft.' };
  const inHangar = !!zone?.flags?.hangar_interior;
  const wanted = (args[0] || '').toLowerCase();
  const { rows } = await query("SELECT id, name, fuel_capacity FROM aircraft_types WHERE (id=$1 OR lower(name)=$1) AND class <> 'wreck'", [wanted]);
  if (!rows.length) {
    const all = await query("SELECT id FROM aircraft_types WHERE class <> 'wreck' ORDER BY price_buy");
    return { type: 'output', message: `Usage: <b>.testfly &lt;type&gt;</b>. Types: ${all.rows.map(r => r.id.replace('ac_', '')).join(', ')}` };
  }
  const t = rows[0];
  // She always sits on the map_world grid at the ramp's coords; parked_zone_id is the
  // garage (interior) when conjured inside, else the ramp — that's what gates takeoff.
  const parkZone = inHangar ? zone.id : field.id;
  const id = `aircraft_test_${player.id.slice(0, 6)}_${randomUUID().slice(0, 6)}`;
  await query(
    `INSERT INTO aircraft (id,type_id,name,owner_id,map_id,grid_x,grid_y,altitude_band,parked_zone_id,fuel,engine_temp,rental)
     VALUES ($1,$2,$3,$4,'map_world',$5,$6,'ground',$7,$8,20,0)`,
    [id, t.id, `TEST ${t.name}`, player.id, field.grid_x, field.grid_y, parkZone, t.fuel_capacity]
  );
  const live = await loadAircraft(id);
  live.occupants.add(player.id); player.aircraftId = id; player.seat = 'pilot'; live.pilotId = player.id;
  if (inHangar) {
    // In the garage: no cockpit yet — she has to be taxied out onto the runway first.
    return { type: 'emote', message: `<span class="text-green">[TEST] A free <b>${t.name}</b>, full tank, waits in the hangar with you at the controls. <b>taxi</b> her out of the garage onto the runway before you fly. It's yours — scrap it when done.</span>` };
  }
  if (isContinuous(live)) sendFlightSim(player, live); else pushHud(live);
  const how = isContinuous(live)
    ? 'flip the <b>ENGINE</b> switch, throttle up, and pull back as she comes alive'
    : 'startup · throttle · takeoff';
  return { type: 'emote', message: `<span class="text-green">[TEST] A free <b>${t.name}</b>, full tank, and you're in the pilot's seat. ${how}. It's yours — scrap it when done.</span>` };
}

// Taxi a craft out of the walk-in hangar (the "garage") onto the exterior ramp (the
// runway) — the gate between sitting in the garage and flying. Only meaningful when
// she's parked inside a hangar interior; out on the ramp already there's nothing to
// taxi out of. Rolling her out is what starts the cockpit and clears her to take off.
async function cmdTaxi(args, raw, player, broadcast) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (live.row.airborne) return { type: 'emote', message: "You're already flying." };
  const here = getZone(live.row.parked_zone_id);
  const ramp = here?.flags?.hangar_interior ? getZone(here.flags.hangar_ramp) : null;
  if (!ramp) return { type: 'emote', message: "She's already out on the ramp — nothing to taxi out of." };

  // Roll her out: park on the ramp at its map_world coords, and walk the crew out with her.
  live.row.parked_zone_id = ramp.id;
  live.row.grid_x = ramp.grid_x; live.row.grid_y = ramp.grid_y;
  for (const pid of live.occupants) {
    const p = getLivePlayer(pid); if (!p) continue;
    getZone(p.current_zone)?.players.delete(pid);
    p.current_zone = ramp.id;
    ramp.players?.add(pid);
  }
  await persist(live);
  broadcast(ramp.id, { type: 'zone_event', message: `A ${live.type.name} noses out of the hangar and onto the ramp.`, refresh: true }, player.id);

  // On the runway now — bring the cockpit alive.
  const pilot = pilotOf(live) || player;
  if (isContinuous(live)) sendFlightSim(pilot, live); else pushHud(live);
  const how = isContinuous(live)
    ? 'Flip the <b>ENGINE</b> switch, throttle up, and pull back as she comes alive.'
    : '<span class="text-dim">startup · throttle · takeoff</span>.';
  return { type: 'emote', message: `<span class="text-green">You ease her out of the garage and onto the runway. ${how}</span>` };
}

// ── flight / status — a text readout of the aircraft you're aboard ─────────────
async function cmdFlightStatus(args, raw, player) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live) return { type: 'emote', message: "You're not aboard an aircraft." };
  const a = live.row, eff = effStats(live), deg = toDeg(a.heading);
  const loc = a.airborne ? (surfaceAt(a.grid_x, a.grid_y)?.name || 'open air') : (getZone(a.parked_zone_id)?.name || '—');
  const cap = Math.round(eff.fuelCap) || 1, fuel = Math.round(a.fuel);
  const lines = [
    `<span class="text-cyan">${live.type.name} "${a.name || live.type.name}" — ${player.seat === 'passenger' ? 'PASSENGER' : a.airborne ? 'AIRBORNE' : 'on the ground'}</span>`,
    `Position: <b>${loc}</b> (${a.grid_x}, ${a.grid_y})` + (a.airborne ? ` · ALT ${BAND_LABEL[a.altitude_band] || a.altitude_band} · HDG <b>${String(deg).padStart(3, '0')}°</b> ${degToCardinal(deg).toUpperCase()} · ${Math.round(eff.cruise * (a.throttle / 100) * 84)}kt` : ''),
    `Fuel: <b>${fuel}/${cap}</b> (${Math.round(fuel / cap * 100)}% ${live.type.fuel_type}) · Hull: <b>${Math.round((1 - a.damage) * 100)}%</b> · Throttle: ${a.throttle}%`,
  ];
  if (eff.cargo) lines.push(`Cargo: ${eff.cargo}/${eff.maxTOW}kg${eff.overweight ? ' <span class="text-red">⚠ OVERWEIGHT</span>' : ''}`);
  if (live.type.hardpoints) lines.push(`Weapons: <b>${a.weapons_hot ? 'ARMED' : 'safe'}</b> (${live.type.hardpoints} hardpoints)`);
  return { type: 'output', message: lines.join('\n') };
}

// Room examine of a parked aircraft. Flight shadows `examine` (owned by interactions)
// and `look` (owned by gametable); on anything that ISN'T naming a craft on the ramp
// here we DELEGATE to that prior owner (never just return undefined — that would skip
// them and drop straight to the engine, killing `examine surroundings` / the poker
// table view). The description reads the livery live, so it reflects a repaint at once.
// The parked craft on this field named by the args (or any, for a generic word) — the
// full row + type fields the examine-menu / refuel-by-name both read.
async function matchCraftHere(args, player) {
  const arg = args.join(' ').toLowerCase().trim();
  if (!arg) return null;
  const field = fieldFor(player);
  if (!field) return null;
  const { rows } = await query(
    `SELECT a.id, a.name, a.owner_id, a.rental, a.custom_data, a.fuel,
            t.name tname, t.fuel_capacity, t.fuel_type, t.cargo_capacity, t.seats
       FROM aircraft a JOIN aircraft_types t ON t.id=a.type_id
      WHERE a.parked_zone_id=$1 AND a.is_wreck=0 AND (a.custom_data->>'charter') IS DISTINCT FROM 'true'`,
    [field.id]);
  const generic = ['aircraft', 'plane', 'craft', 'jet', 'chopper', 'heli'].includes(arg);
  return rows.find(r => generic || (r.name || '').toLowerCase().includes(arg) || (r.tname || '').toLowerCase().includes(arg)) || null;
}

// One cargo slot ≈ this many kg of hold — turns each craft's kg capacity into a
// per-plane number of slots for the examine-menu cargo readout.
const CARGO_SLOT_KG = 60;
// The click-menu appended under a parked craft's examine: embark for anyone; refuel +
// maintenance for the owner; and a cargo readout drawn as one pip per slot the plane has.
function craftActionMenu(m, player) {
  const owned = m.owner_id === player.id;
  const nm = m.name || m.tname;
  const links = [`<span class="action-link" data-action="cmd" data-cmd="embark ${nm}">embark</span>`];
  if (owned) {
    const cap = Math.round(m.fuel_capacity || 1), pct = Math.max(0, Math.round((m.fuel || 0) / cap * 100));
    links.push(`<span class="action-link" data-action="cmd" data-cmd="refuel ${nm}">refuel</span> <span class="text-dim">(${pct}% ${m.fuel_type})</span>`);
    links.push(`<span class="action-link" data-action="cmd" data-cmd="hangar" title="hangar bay — maintenance">maintenance</span>`);
  }
  let out = `\n<span class="furniture-label">Actions:</span> ${links.join('   ·   ')}`;
  const capKg = m.cargo_capacity || 0;
  if (capKg > 0) {
    const slots = Math.max(1, Math.round(capKg / CARGO_SLOT_KG));
    const loadKg = Math.max(0, Math.round(m.custom_data?.cargoWeight || 0));
    const filled = Math.min(slots, Math.round(loadKg / CARGO_SLOT_KG));
    const pips = '▮'.repeat(filled) + '▯'.repeat(Math.max(0, slots - filled));
    out += `\n<span class="furniture-label">Cargo:</span> <span class="text-cyan">${pips}</span> <span class="text-dim">${loadKg}/${capKg}kg · ${slots} slot${slots > 1 ? 's' : ''}</span>`;
  } else {
    out += `\n<span class="furniture-label">Cargo:</span> <span class="text-dim">no hold · ${m.seats} seat${m.seats > 1 ? 's' : ''}</span>`;
  }
  return out;
}
async function cmdExamineCraft(args, raw, player, broadcast) {
  const m = await matchCraftHere(args, player);
  if (m) return { type: 'examine', message: describeExterior(m.custom_data?.livery, m.tname, m.name) + craftActionMenu(m, player) };
  return interactionsCommands.examine(args, raw, player, broadcast);   // prior owner → engine
}
async function cmdLookCraft(args, raw, player, broadcast) {
  const m = await matchCraftHere(args, player);
  if (m) return { type: 'examine', message: describeExterior(m.custom_data?.livery, m.tname, m.name) + craftActionMenu(m, player) };
  return gametableCommands.look(args, raw, player, broadcast);         // prior owner → engine
}

export const commands = {
  examine: cmdExamineCraft, look: cmdLookCraft,
  embark: cmdBoard, board: cmdBoard, disembark: cmdDisembark, deplane: cmdDisembark, testfly: cmdTestFly, taxi: cmdTaxi,
  flight: cmdFlightStatus, fs: cmdFlightStatus,
  startup: cmdStartup, shutdown: cmdShutdown, throttle: cmdThrottle,
  heading: cmdHeading, climb: cmdClimb, dive: cmdDive,
  takeoff: cmdTakeoff, land: cmdLand, refuel: cmdRefuel,
  takeoffresolve: cmdTakeoffResolve, landresolve: cmdLandResolve,
  flightsync: cmdFlightSync, flightevent: cmdFlightEvent,
  ...hazardCommands, ...acquisitionCommands, ...combatCommands, ...contractCommands, ...hangarCommands, ...charterCommands,
};

export const hooks = {
  'zone.describeRoom': describeAirfield,
};

// ── Dev-panel routes ────────────────────────────────────────────────────────
// GET /flight/debug — charter pilot status + flight log.
// GET /flight/aircraft — every aircraft row (owned/rental/test/charter/wreck),
//   for the dev panel's cleanup table. DELETE /flight/aircraft/:id removes one —
//   this is the ONLY way to delete an aircraft instance (test-flight conjures and
//   player buy/rent purchases otherwise just accumulate forever). Deleting one
//   that's currently airborne/occupied first detaches any rider and clears it out
//   of the live in-memory state, so it can't leave a player's aircraftId dangling.
function devOk(auth) { return auth && ['dev', 'admin', 'builder', 'designer'].includes(auth.role); }
const AIRCRAFT_KIND = (r) => {
  if (r.id.startsWith('aircraft_test_')) return 'test';
  if (r.id.startsWith('aircraft_charter_') || r.custom_data?.charter) return 'charter';
  if (r.is_wreck) return 'wreck';
  if (r.rental) return 'rental';
  return r.owner_id ? 'owned' : 'stock';
};
export const routeHandler = async (path, method, body, auth) => {
  if (!path.startsWith('/flight')) return null;
  if (method !== 'GET' && !devOk(auth)) return { status: 403, body: { error: 'Dev access required' } };
  const parts = path.split('/').filter(Boolean);
  if (parts[1] === 'debug' && method === 'GET') return { status: 200, body: await charterDebug() };

  if (parts[1] === 'aircraft') {
    const id = parts[2];
    if (!id && method === 'GET') {
      const { rows } = await query(`
        SELECT a.id, a.name, a.type_id, t.name AS type_name, t.class,
               a.owner_id, p.handle AS owner_handle,
               a.parked_zone_id, z.name AS zone_name,
               a.is_wreck, a.rental, a.damage, a.fuel, a.custom_data
        FROM aircraft a
        LEFT JOIN aircraft_types t ON t.id = a.type_id
        LEFT JOIN players p ON p.id = a.owner_id
        LEFT JOIN zones z ON z.id = a.parked_zone_id
        ORDER BY a.id`);
      return { status: 200, body: rows.map(r => ({ ...r, kind: AIRCRAFT_KIND(r), live: liveAircraft.has(r.id) })) };
    }
    if (id && method === 'DELETE') {
      const rowCount = await deleteAircraft(id);
      return rowCount ? { status: 200, body: { ok: true } } : { status: 404, body: { error: 'No such aircraft.' } };
    }
  }
  return null;
};

export const _test = { surfaceAt, takeoffDifficulty, landDifficulty, DIRS, liveAircraft, noiseReach, isContinuous, bandFromAltitude };

console.log('[flight] Plugin loaded.');
