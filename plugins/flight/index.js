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
import { getZoneEnemies, getZoneNpcs, removePlayerFromZone } from '../../server/engine/world.js';
import { schedule } from '../../server/engine/scheduler.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import {
  TICK_MS, FUEL_RESERVE_FRAC, BANDS, BAND_LABEL, BAND_BURN, DIRS, DIR_ALIASES,
  liveAircraft, surfaceAt, bounds, loadAircraft, pilotOf, persist, reap, effStats,
  pushHud, out, toOccupants, detach, takeoffDifficulty, landDifficulty,
  parkAt, crash, setHeading, getZone, getLivePlayer, sendToZone, sendToZoneExcept, sendToPlayer, setPosture,
  initFloat, initEngines, enginesAllStable, engineCount, syncEngineTemp,
  ENGINE_IDLE, ENGINE_STABLE_BAND, toDeg, degToCardinal, bearingDeg, groundTheme,
  isContinuous, reconcile, pushContext, contextPayload, bandFromAltitude, effLoadout,
  RENTAL_BILL_MS, rentalOpFee, fieldFor, nearestAirfield, listAirfields, runwayFor, airfieldForRunway, yachtFieldNear, isGroundRolling,
  isWalkableCabin, isCabinZone, boardCabin, lookPayload, pushWindowTo, closeHud,
} from './state.js';
import { describeExterior, rampColorWord, conspicuousnessMult, normalizeLivery } from './livery.js';
import { districtBiome } from './biomes.js';
import { rollHazards, commands as hazardCommands } from './hazards.js';
import { commands as acquisitionCommands, refuelAt, refuelParked, fieldStocks } from './acquisition.js';
import { commands as combatCommands, tickCombat, relayContacts } from './combat.js';
import { commands as contractCommands, checkContractDelivery, checkCargoDropDelivery, waitingDropAt, ensureFenceDrops, ensureFreightDrops, isFreightLicensed } from './contracts.js';
import { commands as hangarCommands, pushHangarBay } from './hangars.js';
import { commands as charterCommands, charterDebug, charterParkedAt, embarkCharter, activeCharters, chaseCont, stepToward, CRUISE_TILES } from './charter.js';
import { isPilotLicensed, beginCheckride, evaluateCheckride, checkrideEvent, getCheckrideState, hasActiveCheckride } from './checkride.js';
import { registerTabletApp } from '../tablet/registry.js';

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
  // Keep a parked craft glued to its ramp: re-snap its tile to the parking zone's CURRENT coords at
  // board time. For the Echelon this means an aircraft on her helipad always launches from wherever
  // she is NOW — even if she sailed, or the server restarted, since it parked. Her exterior tile and
  // the aircraft's tile are persisted through separate paths (a world-flag vs the aircraft row) and
  // can otherwise drift apart; the parking zone is the single source of truth, so re-anchor to it.
  const park = getZone(live.row.parked_zone_id);
  if (park && park.grid_x != null && (live.row.grid_x !== park.grid_x || live.row.grid_y !== park.grid_y)) {
    live.row.grid_x = park.grid_x; live.row.grid_y = park.grid_y; live.fx = park.grid_x; live.fy = park.grid_y;
    await persist(live).catch(() => {});
  }
  const seat = pilotOf(live) ? 'passenger' : 'pilot';
  if (seat === 'passenger' && live.occupants.size >= effLoadout(live.row, live.type).seats)
    return { type: 'emote', message: `The ${live.type.name} is full${live.row.custom_data?.loadout ? ' — it\'s rigged for freight' : ''}.` };

  // Pilot licence gate — you can't take the pilot seat of ANY aircraft unrated. The
  // one exception is your own checkride loaner (marked custom_data.checkride === your
  // id), so you can re-board it to retry the landing. Passengers/charter are ungated.
  const isLoaner = found.custom_data?.checkride === player.id;
  if (seat === 'pilot' && !isLoaner && !(await isPilotLicensed(player)))
    return { type: 'emote', message: '<span class="text-amber">You\'re not rated to fly. See the flight examiner at Coldwater Regional (its hangar office) for a checkride.</span>' };

  live.occupants.add(player.id);
  player.aircraftId = found.id;
  player.seat = seat;
  if (seat === 'pilot') live.pilotId = player.id;
  // Re-link the in-progress checkride to this fresh live object on a loaner re-board,
  // so the cockpit resumes showing the current stage instruction.
  if (isLoaner) { live.checkridePilotId = player.id; live.checkride = getCheckrideState(player.id); }
  // Made it in under fire — slam the hatch and everything on you loses its lock.
  let broke = 0;
  if (inCombat) {
    broke = breakOffAttackers(player);
    broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} throws themselves into the ${live.type.name} and hauls the hatch shut.` }, player.id);
  } else {
    broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} climbs into the ${live.type.name}.` }, player.id);
  }
  // Walkable cabin (the Leviathan): a passenger boards into the real interior rooms and
  // walks them on foot, instead of the synthesized cabin-window HUD. The pilot (an NPC on
  // a charter, or a player who takes the controls) still flies the cockpit sim — untouched.
  if (seat !== 'pilot' && isWalkableCabin(live)) {
    const look = await boardCabin(player, live);
    if (isContinuous(live)) pushContext(live);   // refresh a seated pilot's cabin-occupancy readout
    const climb = `<span class="text-green">You climb aboard the ${live.type.name} and step into the cabin.</span>`;
    if (look) { look.message = `${climb}\n${look.message}`; return look; }
    return { type: 'emote', message: climb };
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
  // A continuous heli sets down off-field without sending a `land` event — the client
  // keeps the sim "flying" so the pilot can lift straight off again, so the server still
  // marks it airborne even while it's sitting on the ground. Commit the set-down HERE,
  // on climb-out: park it on the tile it's actually on, so you step out where you landed
  // rather than back at the field you took off from (parkAt moves everyone's current_zone).
  if (live.row.airborne && player.seat === 'pilot' && isContinuous(live) && live.cont?.onGround) {
    const spot = surfaceAt(live.row.grid_x, live.row.grid_y);
    if (spot && !spot.flags?.water && districtBiome(spot) !== 'water') await parkAt(live, spot.id);
  }
  if (live.row.airborne) return { type: 'emote', message: "You can't step out — you're in the air." };
  const name = live.type.name;
  const wasWalkable = isWalkableCabin(live);
  detach(player);   // for a walkable cabin, this also steps the player out onto the parked ramp
  // A remaining pilot's cabin readout updates as riders leave.
  if (liveAircraft.has(live.row.id) && isContinuous(live)) pushContext(live);
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} climbs down out of the ${name}.` }, player.id);
  // Climbed out inside a walk-in hangar (a charter set you down here, or you taxied
  // your own craft in) → drop straight onto the hangar floor, same as walking in.
  const inHangarBay = getZone(player.current_zone)?.flags?.hangar_interior;
  if (inHangarBay) await pushHangarBay(player);
  // Walkable cabin: detach relocated us onto the ramp — render that room so the client
  // leaves the cabin cleanly (there was no cockpit HUD whose close would trigger it).
  if (wasWalkable && !inHangarBay) {
    const look = await lookPayload(player);
    if (look) { look.message = `<span class="text-dim">You climb down out of the ${name}.</span>\n${look.message}`; return look; }
  }
  return { type: 'emote', message: `You climb down out of the ${name}.` };
}

// ── Cabin window — look out at the moving world from a walkable cabin ──────────
// Opens the through-hull passenger view (the same windshield a charter passenger
// rides) as an overlay over the cabin room; a second `window` (or `window close`)
// turns back to the room. Only from a windowed cabin room aboard a walkable craft.
async function cmdWindow(args, raw, player) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live || !isWalkableCabin(live)) return { type: 'emote', message: "There's no window here to look out of." };
  const zone = getZone(player.current_zone);
  if (!isCabinZone(zone, live)) return { type: 'emote', message: "You're not in the cabin." };
  const closing = /^(close|shut|off|away)$/i.test((args[0] || '').trim());
  if (player.cabinWindowOpen || closing) {
    player.cabinWindowOpen = false;
    closeHud(player.id);   // client drops the overlay and re-renders the cabin room
    return { type: 'emote', message: 'You turn back from the window into the cabin.' };
  }
  if (!zone?.flags?.cabin_window) return { type: 'emote', message: "There's no window in here — try the main cabin or the flight deck." };
  player.cabinWindowOpen = true;
  pushWindowTo(live, player);   // pushHud then keeps it live each tick while open
  return { type: 'noop' };
}
// Walking to another room (or stepping off) closes any open window overlay — the move
// renders the new room, and pushHud should stop feeding the now-stale window.
on('zone.entered', ({ actor }) => { if (actor?.cabinWindowOpen) actor.cabinWindowOpen = false; });

// ── Flight-deck control: take the controls / hand off (walkable base) ──────────
// The keystone of a walkable flying base (the Leviathan). A base is BOARDED into its
// cabin and walked on foot; you fly her by stepping up to the flight deck and taking
// the controls (into the real cockpit sim), and step back out with `handoff`. Mirrors
// the Echelon's "take the helm": control is gated to the one room that holds the seat.
async function cmdTakeControls(args, raw, player) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live) return { type: 'emote', message: "You're not aboard anything." };
  if (!isWalkableCabin(live)) return { type: 'emote', message: 'There are no controls to take here.' };
  if (player.seat === 'pilot') return { type: 'emote', message: 'You already have the controls.' };
  const zone = getZone(player.current_zone);
  if (!zone?.flags?.flightdeck || !isCabinZone(zone, live))
    return { type: 'emote', message: 'You have to be up at the <b>flight deck</b> to take the controls.' };
  const other = pilotOf(live);
  if (other) return { type: 'emote', message: `${getLivePlayer(other)?.handle || 'Someone'} already has the controls — they'd have to <b>handoff</b> first.` };
  if (live.crew) return { type: 'emote', message: `The crew have the controls until they set her down at ${live.crew.destName}.` };
  if (!(await isPilotLicensed(player)))
    return { type: 'emote', message: '<span class="text-amber">You\'re not rated to fly. See the flight examiner at Coldwater Regional (its hangar office) for a checkride.</span>' };
  // Take the seat: step out of the flight-deck room (you're flying her now, not walking
  // it) and into the cockpit sim. She stays parked until you fly her off the deck.
  removePlayerFromZone(player.id, zone.id);
  player.seat = 'pilot'; live.pilotId = player.id; player.cabinWindowOpen = false;
  sendFlightSim(player, live);
  if (isContinuous(live)) pushContext(live);   // refresh the cabin-occupancy readout for anyone still walking aft
  sendToZoneExcept(zone.id, player.id, { type: 'zone_event', message: `${player.handle} drops into the pilot's seat and takes the controls.`, refresh: true });
  return { type: 'noop' };
}

// The counterpart: leave the seat and step back into the walkable cabin. On the ground
// only for now — leaving the controls AIRBORNE (to an NPC pilot who keeps her flying) is
// a later slice, so here you set her down first.
async function cmdHandoff(args, raw, player) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live) return { type: 'emote', message: "You're not aboard anything." };
  if (!isWalkableCabin(live)) return { type: 'emote', message: "There's nothing to hand off here." };
  if (player.seat !== 'pilot') return { type: 'emote', message: "You don't have the controls." };
  // Mid-air hand-off: the crew take over and fly her to the nearest field, setting her down
  // there, while you go walk the cabin. (Dispatching the crew to ANY charted destination waits
  // on the NAV console; for now it's the nearest field.) On the ground it's just a straight
  // step out of the seat — the base sits parked as a landmark.
  let handedToCrew = null;
  if (live.row.airborne) {
    const nd = live.navDest;
    if (nd?.loiter) {
      // Charted a bare tile → the crew hold a gentle orbit over it until fuel forces a divert.
      live.crew = { mode: 'loiter', phase: 'ingress', loiterX: nd.tx, loiterY: nd.ty, name: nd.name || `${nd.tx},${nd.ty}`, tx: nd.tx, ty: nd.ty, theta: 0 };
      handedToCrew = `a holding orbit over ${live.crew.name}`;
    } else {
      // Charted a field (or nothing → nearest): run straight there and set down.
      const target = navTarget(live);
      if (!target) return { type: 'emote', message: "There's no field within reach for the crew to make — you'll have to set her down yourself." };
      live.crew = { mode: 'field', destZone: target.id, destName: target.name, tx: target.tx, ty: target.ty };
      handedToCrew = target.name;
    }
    live.fx = live.row.grid_x; live.fy = live.row.grid_y;
    delete live._contHdg; delete live._contPitch; live._contAlt = live.cont?.altitude ?? 480;
    chaseCont(live);   // seed the moving-world attitude the cabin windows read
  }
  live.pilotId = null; player.seat = 'passenger';
  closeHud(player.id);
  const look = await boardCabin(player, live);
  if (isContinuous(live)) pushContext(live);
  if (handedToCrew) toOccupants(live, `<span class="text-cyan">The crew take the controls. "We'll bring her into ${handedToCrew} — make yourself at home."</span>`);
  const msg = handedToCrew
    ? `<span class="text-dim">You hand the controls to the crew and step back into the cabin — they're taking her into ${handedToCrew}.</span>`
    : '<span class="text-dim">You ease back from the controls and leave the seat. She\'s yours to walk.</span>';
  if (look) { look.message = `${msg}\n${look.message}`; return look; }
  return { type: 'emote', message: msg };
}

// The crew's destination: a NAV-charted airfield if one is set, else the nearest field.
// Returns { id, name, tx, ty } (grid coords resolved) or null if there's no field at all.
function navTarget(live) {
  if (live.navDest) {
    const z = getZone(live.navDest.destZone);
    return { id: live.navDest.destZone, name: live.navDest.destName, tx: live.navDest.tx ?? z?.grid_x, ty: live.navDest.ty ?? z?.grid_y };
  }
  const near = nearestAirfield(live.row.grid_x, live.row.grid_y);
  if (!near) return null;
  const z = getZone(near.id);
  return { id: near.id, name: near.name, tx: z?.grid_x, ty: z?.grid_y };
}

// ── NAV console: chart the crew's course from the flight deck ──────────────────
// `nav` lists the airfields (distance in tiles) the crew can make; `nav <field>` charts one;
// `nav clear` drops it. A charted course is where a mid-air `handoff` sends the crew — and if
// they're already flying it retargets them in place. Flight-deck only (that's where the console is).
async function cmdNav(args, raw, player) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live) return { type: 'emote', message: "You're not aboard anything." };
  if (!isWalkableCabin(live)) return { type: 'emote', message: "There's no NAV console here." };
  const arg = args.join(' ').trim().toLowerCase();
  if (/^(clear|off|cancel|none)$/.test(arg)) {
    if (!live.navDest) return { type: 'emote', message: 'No course is charted.' };
    const was = live.navDest.name; delete live.navDest;
    return { type: 'emote', message: `Course to ${was} cleared — a hand-off now defaults to the nearest field.` };
  }
  // `nav loiter <x> <y>` — chart a bare tile the crew will circle (also how the DEADHEAD map's
  // tap-empty-space sets a hold point). Fuel-aware: the crew orbit it until they must divert.
  const lm = arg.match(/^loiter\s+(-?\d+)\s+(-?\d+)$/);
  if (lm) {
    const tx = +lm[1], ty = +lm[2];
    live.navDest = { loiter: true, tx, ty, name: `${tx},${ty}` };
    if (live.crew) {   // already flying → bring the crew around to hold it now
      live.crew = { mode: 'loiter', phase: 'ingress', loiterX: tx, loiterY: ty, name: `${tx},${ty}`, tx, ty, theta: 0 };
      toOccupants(live, `<span class="text-cyan">The crew come around for a holding orbit over ${tx},${ty}.</span>`);
      return { type: 'emote', message: `<span class="text-green">Loiter point set at <b>${tx},${ty}</b> — the crew are bringing her around.</span>` };
    }
    return { type: 'emote', message: `<span class="text-green">Loiter point set at <b>${tx},${ty}</b>.</span> <span class="text-dim">Hand off and the crew orbit it until fuel forces a divert to land.</span>` };
  }
  const fields = listAirfields().filter(f => f.id !== live.row.parked_zone_id);
  const cheb = (f) => Math.max(Math.abs(f.gx - (live.row.grid_x || 0)), Math.abs(f.gy - (live.row.grid_y || 0)));
  if (!arg) {
    if (!fields.length) return { type: 'emote', message: 'No airfields on the charts.' };
    const cur = live.navDest ? `\n<span class="text-cyan">Charted: <b>${live.navDest.name}</b> — <span class="action-link" data-action="cmd" data-cmd="nav clear">clear</span></span>` : '';
    const rows = fields.sort((a, b) => cheb(a) - cheb(b)).map(f =>
      `<span class="furniture-label">${cheb(f)}</span> <span class="action-link" data-action="cmd" data-cmd="nav ${f.id}" title="chart a course">${f.name}</span>`);
    return { type: 'output', message: `<span class="text-dim">NAV — chart the crew's destination (distance in tiles):</span>\n${rows.join('\n')}${cur}` };
  }
  const dest = fields.find(f => f.id.toLowerCase() === arg || f.name.toLowerCase() === arg)
    || fields.find(f => f.name.toLowerCase().includes(arg) || f.id.toLowerCase().includes(arg));
  if (!dest) return { type: 'emote', message: `No airfield matches "${args.join(' ')}". Type <b>nav</b> for the list.` };
  live.navDest = { destZone: dest.id, destName: dest.name, tx: dest.gx, ty: dest.gy };
  if (live.crew) {   // already handed off and flying → bring them around to the new course now
    live.crew.destZone = dest.id; live.crew.destName = dest.name; live.crew.tx = dest.gx; live.crew.ty = dest.gy;
    toOccupants(live, `<span class="text-cyan">The crew adjust course — now inbound to ${dest.name}.</span>`);
    return { type: 'emote', message: `<span class="text-green">Course reset for <b>${dest.name}</b> — the crew are bringing her around.</span>` };
  }
  return { type: 'emote', message: `<span class="text-green">Course charted for <b>${dest.name}</b>.</span> <span class="text-dim">Hand off (<b>handoff</b>) and the crew will take her there.</span>` };
}

// ── Crew autopilot: fly a handed-off base, hold or land it, burning fuel as she goes ──
// Engaged by a mid-air `handoff` (live.crew). Two modes:
//   field  — run straight to a charted airfield and set her down.
//   loiter — fly to a chosen tile and circle it in a GENTLE, cruise-speed orbit, burning fuel,
//            until only bingo fuel remains to reach the nearest field and land — then divert
//            there and set down ("brings her home"). Occupants stay aboard the whole time.
// Uses charter's stepToward + chaseCont for the cabin-window attitude.
const CREW_ORBIT_R = 2.5;        // loiter radius (tiles) — a wide, lazy circle, not a tight turn
const CREW_RESERVE_TICKS = 6;    // fuel margin kept on top of the run-to-field estimate
function crewBurn(live) { return effStats(live).burn || live.type.fuel_burn_base || 2; }   // fuel per crew tick

// Fuel the crew needs to reach `field` from the current tile and land (with a margin).
function crewDivertFuel(live, field) {
  if (!field) return Infinity;
  const z = getZone(field.id);
  const d = Math.max(Math.abs((z?.grid_x ?? 0) - (live.row.grid_x || 0)), Math.abs((z?.grid_y ?? 0) - (live.row.grid_y || 0)));
  return (d / CRUISE_TILES + CREW_RESERVE_TICKS) * crewBurn(live);
}

// Set the base down where she's arrived — PARK in place (occupants stay aboard, unlike a charter).
async function crewLand(live, destZone, destName) {
  const z = getZone(destZone);
  if (z) { live.row.grid_x = z.grid_x; live.row.grid_y = z.grid_y; live.fx = z.grid_x; live.fy = z.grid_y; const rw = runwayFor(z); if (rw) live.row.heading = String(rw.hdg); }
  live.row.airborne = 0; live.row.altitude_band = 'ground'; live.row.parked_zone_id = destZone; live.row.throttle = 0; live.cont = null;
  delete live.crew;
  await persist(live);
  pushHud(live);
  toOccupants(live, `<span class="text-green">A gentle thump — the crew bring her home at ${destName}. Step up to the flight deck to <b>takecontrols</b> again, or <b>disembark</b>.</span>`);
}

// One crew-autopilot tick for one base. Exported (via _test) so the regress can drive it.
async function crewStep(live) {
  const c = live.crew; if (!c) return;
  live.row.fuel = Math.max(0, (live.row.fuel || 0) - crewBurn(live));   // every tick burns fuel — the point of the divert

  if (c.mode === 'loiter' && c.phase === 'loiter') {
    const near = nearestAirfield(live.row.grid_x, live.row.grid_y);
    if (!near || live.row.fuel <= crewDivertFuel(live, near)) {
      c.phase = 'divert';
      const z = getZone(near?.id);
      c.destZone = near?.id; c.destName = near?.name || 'the nearest field';
      c.tx = z?.grid_x ?? c.loiterX; c.ty = z?.grid_y ?? c.loiterY;
      toOccupants(live, `<span class="text-cyan">The crew break off the orbit — down to divert fuel. Bringing her into ${c.destName} to set down.</span>`);
      // fall through to the transit leg below
    } else {
      // Gentle cruise-speed orbit: advance a small arc so tangential speed ≈ cruise (dθ = v / R).
      c.theta = (c.theta || 0) + CRUISE_TILES / CREW_ORBIT_R;
      live.fx = c.loiterX + Math.cos(c.theta) * CREW_ORBIT_R;
      live.fy = c.loiterY + Math.sin(c.theta) * CREW_ORBIT_R;
      live.row.grid_x = Math.round(live.fx); live.row.grid_y = Math.round(live.fy);
      live.row.heading = String((Math.round(c.theta * 180 / Math.PI + 90) % 360 + 360) % 360);   // nose on the tangent
      chaseCont(live, 999);
      pushHud(live);
      return;
    }
  }
  // Transit leg: ingress toward the loiter tile, or run in to a field (charted or divert).
  const step = stepToward(live.fx, live.fy, c.tx, c.ty, CRUISE_TILES);
  live.fx = step.fx; live.fy = step.fy;
  live.row.grid_x = Math.round(live.fx); live.row.grid_y = Math.round(live.fy);
  live.row.heading = String(Math.round(bearingDeg(live.fx, live.fy, c.tx, c.ty)));
  if (step.arrived) {
    if (c.mode === 'loiter' && c.phase === 'ingress') {
      c.phase = 'loiter'; c.theta = 0;
      toOccupants(live, `<span class="text-cyan">The crew settle into a wide, lazy orbit over ${c.name}. "We'll hold here till the fuel says otherwise."</span>`);
      chaseCont(live, 999); pushHud(live);
    } else {
      await crewLand(live, c.destZone, c.destName);
    }
  } else {
    chaseCont(live, step.d); pushHud(live);
  }
}

async function crewTick() {
  for (const live of [...liveAircraft.values()].filter(l => l.crew)) {
    try { await crewStep(live); } catch (e) { console.error('[flight] crew step error:', e.message); }
  }
}
setInterval(() => crewTick().catch(e => console.error('[flight] crew tick error:', e.message)), 2500);

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

// The hangar-bay panel names its craft by real id (`refuel <id>`); a typed command
// never does, so this is invisible to players — an id-shaped first token routes
// straight to refuelParked (the client re-fetches the bay to refresh the fuel bar).
const REFUEL_CRAFT_ID = /^(?:aircraft_[a-z0-9_]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

async function cmdRefuel(args, raw, player, broadcast) {
  if (!player.aircraftId) {
    // Not aboard: `refuel <id|name>` off the room examine-menu / hangar bay tops off
    // that parked owned craft at the field. Anything else → generator refuel.
    if (REFUEL_CRAFT_ID.test(args[0] || '')) return refuelParked(player, args[0]);
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
  live.lastSync = Date.now();   // fresh unattended-recovery clock at wheels-up
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
    livery: normalizeLivery(live.row.custom_data),   // paint-bay scheme the external chase model renders in
    deviceName: live.type.name,
    airport: groundTheme(zone),
    gx: live.row.grid_x, gy: live.row.grid_y, heading: toDeg(live.row.heading),
    runway: runwayFor(zone), // real departure runway from the map's centreline tiles (null = VTOL pad / no strip)
    engineOn: !!live.row.engine_on,
    registration: String(live.row.name || live.type.name || 'MAYFLY').toUpperCase(),
    rented: !!live.row.rental,
    // Registered owner on the cockpit certificate: a rental names the hangar/operator it's from
    // (stamped into custom_data.operator at the rental desk; falls back to the field it's parked
    // at). An owned craft names you; anyone else's reads PRIVATE; a stock/wreck reads UNREGISTERED.
    owner: live.row.rental
      ? String(live.row.custom_data?.operator || zone?.flags?.airfield_name || zone?.name || 'RENTAL FLEET').toUpperCase()
      : (!live.row.owner_id ? 'UNREGISTERED'
        : (live.row.owner_id === player.id ? String(player.name || player.username || 'OWNER').toUpperCase() : 'PRIVATE')),
    fuel: ctx.fuel, fuelCap: ctx.fuelCap, map: ctx.map, sky: ctx.sky, biomeBelow: ctx.biomeBelow, minimap: ctx.minimap, fields: ctx.fields,
    checkride: ctx.checkride,   // guided-checkride state carried on the initial cockpit open
    engines: ctx.engines, seats: ctx.seats, occupants: ctx.occupants,   // gauge count + cabin-occupancy readout
    // Per-airframe capabilities the continuous cockpit adapts to (Phase 3): the Mule,
    // Reaper + Leviathan have retractable gear (only the fixed-gear Mayfly stays down);
    // hardpoints arm the weapons; cargo enables jettison.
    gearRetract: ['prop', 'gunship', 'heavy'].includes(live.type.class),
    hardpoints: live.type.hardpoints || 0,
    sprayer: !!(live.type.data && live.type.data.spray),   // ag-plane crop-duster (Locust): shows the SPRAY control
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
  if (live.checkride) evaluateCheckride(live);   // guided-checkride stage progression off the fresh telemetry
  live.lastSync = Date.now();   // the pilot is actively flying — reset the unattended-recovery clock
  // While rolling out on the ground over an airfield, remember it — the shutdown `land`
  // parks here even if the roll drifts a tile off the runway before the engine's cut.
  if (n[7] === 1) { const b = surfaceAt(live.row.grid_x, live.row.grid_y); if (b?.flags?.airfield_id) live.rolloutField = b.id; }
  // Event-driven contact relay: this craft just moved, so refresh its own traffic picture and push
  // its fresh position to nearby pilots. Fires when airborne OR rolling under power on the deck
  // (taxi / takeoff roll / landing rollout), so other pilots see the whole ground movement — not a
  // craft that teleports from parked to airborne.
  if ((live.row.airborne && !live.cont?.onGround) || isGroundRolling(live)) relayContacts(live);
  return { type: 'noop' };
}

// Tow an off-strip landing in. The craft set down away from a field but under the
// crash threshold, so she's fine — the hangar dispatches a recovery crew, parks her at
// the nearest airfield to where she came down, and bills the pilot a retrieval fee
// scaled to the airframe's value. Short on credits? We garnish what you have — the
// aircraft still comes back; consider the rest a debt to your dignity.
async function retrieveOffField(live, player, { abort = false } = {}) {
  const spot = surfaceAt(live.row.grid_x, live.row.grid_y);
  const home = nearestAirfield(live.row.grid_x, live.row.grid_y);
  const fee = Math.max(120, Math.round((live.type.price_buy || 400) * 0.05));
  const paid = Math.min(player.credits || 0, fee);
  player.credits = Math.max(0, (player.credits || 0) - fee);
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  const where = spot?.name || 'open country';
  // No airfield in the world to tow to (shouldn't happen) — just leave her parked where she sits.
  const dest = home?.id || spot?.id || live.row.parked_zone_id;
  await parkAt(live, dest);
  const lead = abort
    ? `<span class="text-amber">You break off the flight — a mayday call, and you're out.</span> `
    : `<span class="text-amber">You set the ${live.type.name} down clean, but this is no airstrip — you've put down in ${where}.</span> `;
  out(player.id, lead +
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
    live.lastSync = Date.now();   // fresh unattended-recovery clock at wheels-up
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
    if (live.checkride) await checkrideEvent(live, 'takeoff', args, player);
    return { type: 'noop' };
  }

  if (ev === 'land') {
    if (!live.row.airborne) return { type: 'noop' };
    // Authoritative touchdown tile from the client (args[3],[4]) — a deck landing reports the Echelon's
    // own tile, a field landing its touchdown tile. Set it BEFORE resolving the field so this never
    // races the separate `flightsync` message: the ws handler runs a player's commands concurrently, so
    // without this `land` could read the stale airborne position and tow/ditch the craft off the yacht
    // (why a deck-landed heli only *sometimes* made it into her hangar). Omitted ⇒ use live position.
    const lx = Number(args[3]), ly = Number(args[4]);
    // Snap the touchdown tile to the integer grid before the surface lookup: `grid_x/grid_y`
    // are the rounded tile (reconcile's contract), but the client reports a sub-tile float
    // (F.pos.x.toFixed(2)). `surfaceAt` keys the coord index by integer tile, so a float here
    // misses every cell and `field` comes back null — which silently kills the runway→airfield
    // resolve below (`airfieldForRunway` never sees its runway tile). At Coldwater the rollout
    // over the on-centreline airfield tile masked it via `rolloutField`; at Buzzard Field, whose
    // hangar sits BESIDE the strip, nothing masked it, so a clean landing read as off-field and
    // augered the pilot back to the Coldwater clone vats. Keep fx/fy as the smooth sub-tile pos.
    if (Number.isFinite(lx) && Number.isFinite(ly)) { live.row.grid_x = Math.round(lx); live.row.grid_y = Math.round(ly); live.fx = lx; live.fy = ly; }
    let field = surfaceAt(live.row.grid_x, live.row.grid_y);
    // A long roll-out can drift the plane a tile off the runway before you shut down —
    // fall back to the airfield we actually touched down on (recorded while grounded over it).
    if (!field?.flags?.airfield_id && live.rolloutField) field = getZone(live.rolloutField);
    // Touched down on a runway tile whose airfield_id lives on an adjacent ramp tile (the
    // strip and the hangar aren't the same tile, as at Buzzard Field) — resolve to the field
    // the runway serves so it parks here instead of towing home off-strip.
    if (!field?.flags?.airfield_id && field?.flags?.runway) field = airfieldForRunway(field) || field;
    // Fixed-wing sets down on a real airfield; a VTOL (the Dragonfly) can flare onto any
    // cleared surface tile below it. STOL craft (the Reaper) are rated for rough-field ops
    // too, so like a VTOL they simply put down where they landed instead of being towed home.
    const isVtol = live.type.takeoff_mode === 'vtol';
    const offstripRated = isVtol || live.type.takeoff_mode === 'stol';
    // A VTOL setting down alongside the Echelon lands on her helipad — she's a small, moving
    // target, so a set-down within a tile of her snaps to the pad instead of ditching in the
    // Basin. Resolve this BEFORE the water check below so an approach over open water still lands.
    if (isVtol) { const yf = yachtFieldNear(live.row.grid_x, live.row.grid_y); if (yf) field = yf; }
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
    if (field?.flags?.airfield_id || (offstripRated && field)) {
      // Grade the checkride landing while the pilot's still aboard (a pass issues the
      // licence; a miss leaves the loaner parked for a retry). crDone → the loaner is a
      // free trainer that's served its purpose, so scrap it after everyone climbs out.
      let crDone = false;
      if (live.checkride) {
        const grade = String(args[1] || '').toUpperCase();
        const fpm = Math.round(Number(args[2]) || 0);
        crDone = await checkrideEvent(live, 'land', [grade, fpm, field.id], player);
      }
      await parkAt(live, field.id);
      await awardSkillUse(player.id, 'piloting', 0);
      await checkContractDelivery(player, live, field.id);
      await checkCargoDropDelivery(player, live, field.id);
      // Everyone climbs out onto the tile where she settled (parkAt set their zone to it).
      // At a real airfield the client opens straight into the hangar bay; off-field — a VTOL
      // or STOL rated for rough fields — they're simply put down where they landed and can walk
      // away, then `embark` the parked craft again to lift back off.
      for (const pid of [...live.occupants]) { const p = getLivePlayer(pid); if (p) detach(p); }
      if (crDone) await deleteAircraft(live.row.id);
      return { type: 'noop' };
    }
    // Off-strip, but she made it down in one piece: the client only sends `land` for a
    // survivable touchdown (a sink >600 fpm reports `crash hardlanding` instead). So a
    // fixed-wing that put down in a field/street doesn't die — the hangar sends a crew to
    // tow her back and bills you for the retrieval. Nothing solid below at all (open water/
    // the void off the map edge) is still a crash — there's nowhere to set down.
    //
    // Rough-field-rated craft (VTOL/STOL) are the exception: a survivable flare onto UNAUTHORED
    // ground (field null) is still a good landing, not a plunge off the world's edge. This is the
    // common case out at a frontier strip like Buzzard Field, where the tiled scrub is a small
    // island — flaring a tile wide of it left the coord index with no surface below and augered
    // the pilot in, respawning them clear back at the Coldwater clone vats. Tow them to the
    // nearest field (Buzzard Field itself, so they end up in its hangar) instead of killing them.
    if (field || offstripRated) {
      await retrieveOffField(live, player);
      // retrieveOffField parks the craft + relocates everyone via parkAt, but (like the abort
      // path) we still have to climb them OUT — otherwise the pilot is left welded into a parked
      // aircraft (aircraftId set, cockpit HUD live) and the player.login hook re-seats them on
      // every reconnect. This is the common Reach case: a tile wide of Buzzard's island strip.
      for (const pid of [...live.occupants]) { const p = getLivePlayer(pid); if (p) detach(p); }
      return { type: 'noop' };
    }
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

  // Abort — the pilot bails out of the flight from anywhere (airborne or a stuck ground state).
  // A hangar recovery crew tows the craft back to a field and bills the retrieval fee (same as
  // an off-strip tow), then everyone climbs out on the ground. Never a crash — she comes back.
  if (ev === 'abort') {
    await retrieveOffField(live, player, { abort: true });
    for (const pid of [...live.occupants]) { const p = getLivePlayer(pid); if (p) detach(p); }
    return { type: 'noop' };
  }

  // A checkride ring fly-through, reported by the client (which owns the plane's
  // world position). The state machine advances to the next gate / the landing stage.
  if (ev === 'gate') { if (live.checkride) await checkrideEvent(live, 'gate', args, player); return { type: 'noop' }; }

  // Engine master switch (the on-panel replacement for `startup`).
  if (ev === 'engineon') { live.row.engine_on = 1; await persist(live); pushContext(live); if (live.checkride) await checkrideEvent(live, 'engineon', args, player); return { type: 'noop' }; }
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

// Reach in tiles (0 = inaudible from the ground). Only the LOW band produces an
// identified, sound-carried pass — cruise/high are handled by the sight channel.
function noiseReach(live) {
  const t = live.type, a = live.row;
  let loud = (t.noise || 2) + Math.max(0, (t.engines || 1) - 1) * 0.4 + ((t.max_takeoff_weight || 0) > 800 ? 1 : 0);
  loud += (a.throttle - 50) / 60;                       // firewalled = louder; idling = quieter
  loud *= conspicuousnessMult(live);                    // paint: dark/matte/camo hides, bright/gloss/hazard shouts
  if (a.altitude_band !== 'low') return 0;              // only a low pass is loud enough to identify
  return Math.max(0, Math.min(4, Math.round(loud)));
}

// Ground-observer airspeed readout (knots). Continuous craft report true IAS;
// discrete craft derive it from cruise × throttle (the 84 kt/tile scale the charter uses).
function overflySpeed(live) {
  if (isContinuous(live)) return Math.max(0, Math.round(live.cont?.airspeed || 0));
  return Math.round(effStats(live).cruise * (live.row.throttle / 100) * 84);
}
function speedWord(kt) {
  if (kt < 70) return 'crawling';
  if (kt < 150) return 'at a steady clip';
  if (kt < 240) return 'moving fast';
  return 'screaming past';
}

// Anti-spam: a given ground zone catches at most one overhead line per this window,
// no matter how many ticks a craft loiters or circles over it. The physics tick runs
// every few seconds for flight itself; this gate is what keeps the sky from chattering.
const SKY_COOLDOWN_MS = 45000;
const skyLastSeen = new Map();   // zoneId → last overhead-line timestamp
function skyReady(zoneId) {
  const now = Date.now();
  if (now - (skyLastSeen.get(zoneId) || 0) < SKY_COOLDOWN_MS) return false;
  skyLastSeen.set(zoneId, now);
  return true;
}
// Overhead lines land in the client's sky banner (pinned at the top of the room pane,
// auto-fading) rather than the scrollback — excluding our own occupants, who are aloft.
function emitSky(live, zoneId, message) {
  sendToZoneExcept(zoneId, { type: 'sky', message }, live.occupants);
}

// Dispatch by altitude: LOW = a detailed, identified, sound-carried pass (type +
// heading + speed, plus a directional rumble to neighbours and ground reactions);
// CRUISE/HIGH = a brief, non-identifying visual sighting directly below.
function overflyNoise(live) {
  if (live.row.altitude_band === 'low') return overflyLow(live);
  return overflySight(live);
}

function overflyLow(live) {
  const a = live.row, t = live.type;
  const reach = noiseReach(live);
  if (reach <= 0) return;
  const snd = classSound(t.class), hdg = degToCardinal(toDeg(a.heading)).toUpperCase();
  for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) {
    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    if (dist > reach) continue;
    const cell = surfaceAt(a.grid_x + dx, a.grid_y + dy);
    if (!cell) continue;
    // Ground reactions (enemies looking up / potshots) track every low pass; the
    // player-facing line is rate-limited per zone so a loitering craft can't spam it.
    if (dist === 0) groundReact(live, cell.id, reach);
    if (!skyReady(cell.id)) continue;
    if (dist === 0) {
      const kt = overflySpeed(live);
      emitSky(live, cell.id, `A <b>${t.name}</b> ${snd.near}, heading ${hdg} — ${speedWord(kt)} (~${kt} kt).`);
    } else {
      const from = degToCardinal(bearingDeg(a.grid_x + dx, a.grid_y + dy, a.grid_x, a.grid_y)).toUpperCase();
      emitSky(live, cell.id, `You hear ${snd.far} to the ${from}${dist >= reach ? ', distant' : ''}.`);
    }
  }
}

// The sighting text follows the light: by day a shape or a distant speck, at dawn/dusk
// it catches the low sun, at night you see only its blinking nav lights.
function sightLine(high, hdg, phase) {
  const dark = phase === 'night';
  const golden = phase === 'dawn' || phase === 'dusk';
  if (high) {
    if (dark)   return `Navigation lights blink across the sky, high overhead, tracking ${hdg}.`;
    if (golden) return `An aircraft catches the low sun — a bright fleck crossing high overhead, heading ${hdg}.`;
    return `A distant aircraft crosses high overhead, heading ${hdg}.`;
  }
  if (dark)   return `An aircraft passes overhead, running lights winking, heading ${hdg}.`;
  if (golden) return `An aircraft passes overhead, its underside lit gold by the low sun, heading ${hdg}.`;
  return `An aircraft passes overhead, heading ${hdg}.`;
}

// A cruise/high pass: too far up to identify or hear the engine — the ground just
// catches a shape crossing overhead. One brief sighting over the tiles it's above.
function overflySight(live) {
  const a = live.row;
  const high = a.altitude_band === 'high';
  const reach = 1;
  const hdg = degToCardinal(toDeg(a.heading)).toUpperCase();
  const msg = sightLine(high, hdg, getEnvironmentState().timePhase);
  for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) {
    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    if (dist > reach) continue;
    const cell = surfaceAt(a.grid_x + dx, a.grid_y + dy);
    if (!cell) continue;
    if (!skyReady(cell.id)) continue;   // rate-limited per zone — no every-tick spam
    emitSky(live, cell.id, msg);
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

const AUTO_RETURN_MS = 10 * 60 * 1000;   // an unattended airborne craft is flown back to a hangar after 10 real minutes

// A hangar crew recovers an ABANDONED airborne craft: park her at the field she launched from
// (else the nearest airfield), setting anyone still aboard down in the hangar, and clear any
// offline crew association so she's boardable fresh. Mirrors the off-field tow, minus the fee.
async function autoReturn(live) {
  const homeZone = (live.homeField && getZone(live.homeField)?.flags?.airfield_id) ? live.homeField : null;
  const near = nearestAirfield(live.row.grid_x, live.row.grid_y);
  const dest = homeZone || near?.id || live.row.parked_zone_id;
  if (!dest) return;   // nowhere to send her (no airfield in the world) — leave her be
  toOccupants(live, '<span class="text-amber">⏱ Left unattended aloft — a hangar recovery crew flies her back and puts her away.</span>');
  await parkAt(live, dest);
  for (const pid of [...live.occupants]) { if (!getLivePlayer(pid)) live.occupants.delete(pid); }
  if (live.pilotId && !getLivePlayer(live.pilotId)) live.pilotId = null;
  live.lastSync = Date.now();
}

async function flightTick() {
  if (ticking) return;
  ticking = true;
  try {
    for (const live of [...liveAircraft.values()]) {
      if (live.charter) continue;   // NPC-flown charters are driven by charter.js, not the physics tick
      // Recover an airborne craft left UNATTENDED: if the pilot's cockpit hasn't synced (tab
      // closed / disconnected / abandoned) for AUTO_RETURN_MS, a hangar crew flies her home — so
      // ghost aircraft don't linger aloft forever. Parked craft (airborne 0) are exempt.
      if (live.row.airborne) {
        if (!live.lastSync) live.lastSync = Date.now();
        else if (Date.now() - live.lastSync > AUTO_RETURN_MS) { await autoReturn(live); continue; }
      }
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
          // Stall consequences (authoritative). A BRIEF stall is free — nose down, unload, and the
          // energy model flies again; that IS the recovery, no verb. But a SUSTAINED stall (a held
          // mush or a spin you refuse to break) stresses the airframe past a short grace window and
          // bleeds hull; carry it into the ground and it's already the emergent terrain crash below.
          if (live.cont?.stalled) {
            live.stallTicks = (live.stallTicks || 0) + 1;
            if (live.stallTicks >= 2) {   // ~6s unbroken at TICK_MS=3s — a real, held stall, not a flick
              a.damage = Math.min(1, a.damage + 0.05);
              if (live.stallTicks === 2) toOccupants(live, '<span class="text-amber">⚠ Held in the stall — the airframe groans under the load. Nose down, unload, power up.</span>');
              if (a.damage >= 1) { await crash(live, 'stall'); continue; }
            }
          } else live.stallTicks = 0;
          // Thermal — engine temp tracks throttle (+ a cold-start bias), per engine. Without it a
          // continuous craft would never run hot, so the overheat→fire hazard below could never arm.
          const target = 20 + a.throttle * 1.1 + eff.heatBias + (live.coldStart > 0 ? 22 : 0);
          if (live.engines?.length) {
            for (const e of live.engines) e.temp += (target + (e.seed % 2 ? 4 : -4) - e.temp) * 0.3;
            syncEngineTemp(live);
          } else { a.engine_temp += (target - a.engine_temp) * 0.3; }
          // Deck hazards — cold-start fire, weather buffeting, bird strike, overheat fire, and the
          // escalation of any persistent one. (Stalls are the energy model's own, handled above.)
          await rollHazards(live);
          if (!liveAircraft.has(live.row.id)) continue;   // a hazard may have crashed it
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

      // No banded/server-side flight model any more — EVERY aircraft_type is continuous
      // (client-sim + reconcile; the tick above is the whole model). A craft reaching here is a
      // content error (a type missing from CONTINUOUS_TYPES); skip it rather than run a physics
      // model that no longer exists. See docs/proposals/flight-unified-model.md.
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
  // Reap abandoned checkride loaners: a free trainer whose ride has ended (passed,
  // crashed, or the player walked off and the in-memory state is gone) and that no one
  // is currently sitting in. A ride still in progress keeps its Map entry, so its parked
  // loaner survives for a re-board.
  const { rows: loaners } = await query("SELECT id, owner_id FROM aircraft WHERE id LIKE 'aircraft_checkride_%'");
  for (const l of loaners) {
    if (liveAircraft.has(l.id) || hasActiveCheckride(l.owner_id)) continue;
    await deleteAircraft(l.id);
  }
}
schedule('5m', () => wreckSweep().catch(e => console.error('[flight] wreck sweep error:', e.message)));

// ── Move gate: can't walk while aboard — EXCEPT within a walkable cabin ────────
// A cockpit-sim occupant is strapped in and blocked. But a walkable-cabin craft
// (the Leviathan) has real interior rooms: its occupants walk freely between them.
// Any exit that would leave the aircraft is still blocked — the door is sealed while
// airborne and opens on landing (deplane handled by the charter/land flow).
registerMoveGate(({ player, from, to }) => {
  if (!player.aircraftId) return undefined;
  const live = liveAircraft.get(player.aircraftId);
  if (live && isCabinZone(from, live) && isCabinZone(to, live)) return undefined;   // walk the cabin
  return { block: true, message: live?.row.airborne ? "You can't walk out of the sky." : "You're strapped in — `disembark` first." };
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
const svcLink = (cmd, label) => `<span class="action-link cmd-link" data-action="cmd" data-cmd="${cmd}" title="${label}">${label}</span>`;
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
  // Walkable-base flight deck (the Leviathan): the seat that flies the whole ship.
  if (zone?.flags?.flightdeck)
    return `<span class="furniture-label">Controls:</span> ${svcLink('takecontrols', 'take the controls')} <span class="text-dim">— drop into the seat and fly her; step back out with <b>handoff</b> once she's down</span>`
      + `\n<span class="furniture-label">NAV console:</span> ${svcLink('nav', 'chart a course')} <span class="text-dim">— set where the crew fly her when you <b>handoff</b> in the air (also on the <b>DEADHEAD</b> tablet app)</span>`;
  if (!zone?.flags?.airfield_id) return undefined;
  const f = zone.flags;
  let line = serviceBits(zone);
  // A prominent, dedicated line for the 3D hangar bay so the look scene has an
  // obvious call-to-action to open it (matches the walk-in interior's line) — the
  // terse `hangar` link in the Services row is easy to miss.
  line += `\n<span class="furniture-label">Hangar bay:</span> ${svcLink('hangar', 'Open Hangar Bay')} <span class="text-dim">your aircraft up close in 3D — charter, buy/rent, maintenance</span>`;
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

// Storm lightning → the flight sim. The engine's stormTick is the SINGLE strike
// authority; each located strike is relayed to any airborne aircraft close enough
// to render it as a bolt out the canopy, so pilots see the SAME lightning the
// ground does. View push only — the flash + rare kill are the engine's.
const LIGHTNING_VIEW_DIST2 = 70 * 70;   // tiles² — just past the client's bolt cull
on('weather.lightningStrike', ({ gx, gy, intensity }) => {
  for (const live of liveAircraft.values()) {
    if (!live.row.airborne) continue;
    const dx = (live.row.grid_x || 0) - gx, dy = (live.row.grid_y || 0) - gy;
    if (dx * dx + dy * dy > LIGHTNING_VIEW_DIST2) continue;
    for (const pid of live.occupants) sendToPlayer(pid, { type: 'lightning_strike', gx, gy, intensity });
  }
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

// ── Checkride: conjure the free loaner Mayfly and start the ride ───────────────
// Shared by the examiner NPC's START_CHECKRIDE dialogue action and the `.checkride`
// admin command. Spawns a throwaway full-tank Mayfly on the Coldwater Regional ramp
// (marked custom_data.checkride so the boarding gate + cleanup key on it), seats the
// player as pilot, opens the cockpit, and hands off to the checkride state machine.
const CHECKRIDE_FIELD = 'zone_district_925_903';   // Coldwater Regional runway (fixed-wing)
async function startCheckrideRide(player) {
  if (player.aircraftId) return { type: 'emote', message: 'Climb out of what you\'re in first.' };
  if (hasActiveCheckride(player.id)) return { type: 'emote', message: 'Your trainer\'s already on the ramp — <b>embark</b> it to pick up where you left off.' };
  const field = getZone(CHECKRIDE_FIELD);
  if (!field) return { type: 'emote', message: 'The examiner can\'t raise the tower right now. Try again shortly.' };
  const { rows } = await query("SELECT fuel_capacity FROM aircraft_types WHERE id='ac_mayfly'");
  const fuelCap = rows[0]?.fuel_capacity || 40;
  const id = `aircraft_checkride_${player.id.slice(0, 6)}_${randomUUID().slice(0, 6)}`;
  await query(
    `INSERT INTO aircraft (id,type_id,name,owner_id,map_id,grid_x,grid_y,altitude_band,parked_zone_id,fuel,engine_temp,rental,custom_data)
     VALUES ($1,'ac_mayfly',$2,$3,'map_world',$4,$5,'ground',$6,$7,20,1,$8)`,
    [id, 'TRAINER Mayfly', player.id, field.grid_x, field.grid_y, field.id, fuelCap, JSON.stringify({ checkride: player.id })]
  );
  const live = await loadAircraft(id);
  live.occupants.add(player.id); player.aircraftId = id; player.seat = 'pilot'; live.pilotId = player.id;
  live.checkridePilotId = player.id;
  sendFlightSim(player, live);
  beginCheckride(player, live);
  return { type: 'emote', message: '<span class="text-green">The examiner walks you out to a trainer Mayfly on the ramp and drops into the seat beside you. "Right — let\'s see if you can fly. Follow my calls."</span>' };
}

// The examiner NPC dispatches this from its dialogue tree (`{ action: "START_CHECKRIDE" }`).
registerAction({
  type: 'START_CHECKRIDE',
  handler: async ({ actor }) => {
    const res = await startCheckrideRide(actor);
    if (res?.message) out(actor.id, res.message);
    return { type: 'ok' };
  },
});

// Take the checkride. Player-facing entry point (alongside the examiner NPC dialogue and
// the hangar-bay charter tile): any unrated pilot can start the ride here. Admins are
// auto-licensed but may still run it to exercise the flow.
async function cmdCheckride(args, raw, player) {
  return startCheckrideRide(player);
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

// ── Admin: rewind to the departure hangar (test tool) ─────────────────────────
// Sets the craft straight back down at the field she launched from (else the nearest
// airfield) with the pilot still aboard — no flying. Fired by the cockpit's admin ⏪
// button; the client then closes the sim and reopens the hangar bay. Dev/admin only.
async function cmdAirHome(args, raw, player) {
  if (!devOk(player)) return { type: 'error', message: 'Access denied.' };
  const { live, err } = requirePilot(player); if (err) return err;
  const homeZone = (live.homeField && getZone(live.homeField)?.flags?.airfield_id) ? live.homeField : null;
  const dest = homeZone || nearestAirfield(live.row.grid_x, live.row.grid_y)?.id || live.row.parked_zone_id;
  if (!dest) return { type: 'emote', message: 'No hangar to rewind to.' };
  await parkAt(live, dest);
  detach(player);   // climb out cleanly at the hangar (clears aircraftId/posture) so you can re-fly or manage her
  return { type: 'emote', message: `<span class="text-cyan">⏪ REWIND — ${live.type.name} set back down at ${getZone(dest)?.name || 'the hangar'}.</span>` };
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

// ── DEADHEAD — the Leviathan crew-dispatch Tablet app ─────────────────────────
// A portable NAV console + status board for a walkable flying base: see where she is,
// chart the crew's course on a map, hand off / take the controls. Registered on the Tablet
// OS registry (kept HERE so all the flight state + verbs stay in the flight plugin).
const _stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '');
function buildDeadhead(player) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live || !isWalkableCabin(live)) return { view: 'deadhead', deadhead: { aboard: false } };
  const gx = live.row.grid_x || 0, gy = live.row.grid_y || 0;
  const fields = listAirfields().map(f => ({ id: f.id, name: f.name, gx: f.gx, gy: f.gy, dist: Math.max(Math.abs(f.gx - gx), Math.abs(f.gy - gy)) }));
  let status;
  if (live.crew) {
    const c = live.crew;
    if (c.mode === 'loiter') status = { state: 'crew', text:
      c.phase === 'loiter' ? `Holding — a lazy orbit over ${c.name}.`
      : c.phase === 'divert' ? `Bingo fuel — diverting to ${c.destName} to set down.`
      : `Crew inbound to hold over ${c.name}.` };
    else status = { state: 'crew', text: `The crew have her — inbound to ${c.destName}.` };
  } else if (live.row.airborne) status = { state: 'flying', text: pilotOf(live) === player.id ? 'You have the controls.' : 'In the air.' };
  else status = { state: 'parked', text: `Parked${getZone(live.row.parked_zone_id)?.name ? ' at ' + getZone(live.row.parked_zone_id).name : ''}.` };
  return { view: 'deadhead', deadhead: {
    aboard: true, name: live.type.name, gx, gy, fields, status,
    charted: live.navDest ? (live.navDest.loiter
      ? { loiter: true, tx: live.navDest.tx, ty: live.navDest.ty, name: live.navDest.name }
      : { id: live.navDest.destZone, name: live.navDest.destName }) : null,
    fuel: Math.round((live.row.fuel || 0) / (effStats(live).fuelCap || live.type.fuel_capacity || 1) * 100),
    seat: player.seat === 'pilot' ? 'pilot' : 'cabin',
    atDeck: !!getZone(player.current_zone)?.flags?.flightdeck,
    airborne: !!live.row.airborne, crew: !!live.crew,
  } };
}
registerTabletApp({
  id: 'deadhead', name: 'DEADHEAD', icon: '✈', category: 'General',
  buildScreen(player) { return buildDeadhead(player); },
  async handleAction(player, actionId, params) {
    if (actionId === 'chart' && params) { await cmdNav([params], `nav ${params}`, player); return buildDeadhead(player); }
    if (actionId === 'loiter' && params) { const [gx, gy] = params.split(/\s+/); await cmdNav(['loiter', gx, gy], `nav loiter ${gx} ${gy}`, player); return buildDeadhead(player); }
    if (actionId === 'clear') { await cmdNav(['clear'], 'nav clear', player); return buildDeadhead(player); }
    if (actionId === 'take') { const r = await cmdTakeControls([], 'takecontrols', player); if (r?.type === 'noop') return { type: 'tablet_close' }; return { ...buildDeadhead(player), notice: _stripTags(r?.message) }; }
    if (actionId === 'hand') { const r = await cmdHandoff([], 'handoff', player); return { ...buildDeadhead(player), notice: _stripTags(r?.message) }; }
    return buildDeadhead(player);
  },
});

export const commands = {
  examine: cmdExamineCraft, look: cmdLookCraft,
  embark: cmdBoard, board: cmdBoard, disembark: cmdDisembark, deplane: cmdDisembark, window: cmdWindow, testfly: cmdTestFly, taxi: cmdTaxi,
  takecontrols: cmdTakeControls, controls: cmdTakeControls, handoff: cmdHandoff, standdown: cmdHandoff, nav: cmdNav,
  flight: cmdFlightStatus, fs: cmdFlightStatus,
  startup: cmdStartup, shutdown: cmdShutdown, throttle: cmdThrottle,
  heading: cmdHeading, climb: cmdClimb, dive: cmdDive,
  takeoff: cmdTakeoff, land: cmdLand, refuel: cmdRefuel,
  takeoffresolve: cmdTakeoffResolve, landresolve: cmdLandResolve,
  flightsync: cmdFlightSync, flightevent: cmdFlightEvent, airhome: cmdAirHome,
  checkride: cmdCheckride,
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

export const _test = { surfaceAt, takeoffDifficulty, landDifficulty, DIRS, liveAircraft, noiseReach, isContinuous, bandFromAltitude, crewStep, crewDivertFuel };

console.log('[flight] Plugin loaded.');
