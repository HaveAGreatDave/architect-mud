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
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { registerInputMatcher } from '../../server/engine/plugins.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { getZoneEnemies, getZoneNpcs } from '../../server/engine/world.js';
import {
  TICK_MS, FUEL_RESERVE_FRAC, BANDS, BAND_LABEL, BAND_BURN, DIRS, DIR_ALIASES,
  liveAircraft, surfaceAt, bounds, loadAircraft, pilotOf, persist, reap, effStats,
  pushHud, out, toOccupants, detach, takeoffDifficulty, landDifficulty,
  parkAt, crash, setHeading, getZone, getLivePlayer, sendToZone, sendToPlayer, setPosture,
  advance, initFloat, initEngines, enginesAllStable, engineCount, syncEngineTemp,
  ENGINE_IDLE, ENGINE_STABLE_BAND, toDeg, degToCardinal, bearingDeg, groundTheme,
} from './state.js';
import { rollHazards, commands as hazardCommands } from './hazards.js';
import { commands as acquisitionCommands, refuelAt, fieldStocks } from './acquisition.js';
import { commands as combatCommands, tickCombat } from './combat.js';
import { commands as contractCommands, checkContractDelivery } from './contracts.js';
import { commands as hangarCommands } from './hangars.js';
import { commands as charterCommands, charterDebug, charterParkedAt, embarkCharter } from './charter.js';

// Verb-collision routers (see plugin.json `after`): flight wins `board`/`refuel`
// and delegates to the prior owner by context.
import { commands as gametableCommands } from '../gametable/index.js';
import { commands as generatorCommands } from '../generator/index.js';

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
async function findParkedHere(zoneId, nameArg) {
  const { rows } = await query('SELECT id, name, type_id, is_wreck, owner_id, hangar_id, rental, custom_data FROM aircraft WHERE parked_zone_id=$1', [zoneId]);
  // Charter craft are the NPC pilot's — never boardable as a normal aircraft.
  const flyable = rows.filter(r => !r.is_wreck && (r.custom_data?.charter !== true));
  if (!flyable.length) return null;
  if (nameArg) return flyable.find(r => (r.name || '').toLowerCase().includes(nameArg) || r.id.includes(nameArg)) || null;
  return flyable[0];
}

async function cmdBoard(args, raw, player, broadcast) {
  if (player.aircraftId) return { type: 'emote', message: "You're already aboard." };

  // A chartered aircraft parked here → board as a passenger (the NPC pilot flies
  // it). Only the player who chartered it may board; anyone else falls through to
  // normal boarding (the reserved charter stays invisible to them).
  const parkedCharter = charterParkedAt(player.current_zone);
  if (parkedCharter && (!parkedCharter.chartererId || parkedCharter.chartererId === player.id)) {
    if ((player.posture || 'standing') !== 'standing')
      return { type: 'emote', message: 'You need to be on your feet to climb aboard.' };
    return embarkCharter(player, parkedCharter);
  }

  const found = await findParkedHere(player.current_zone, args.join(' ').trim().toLowerCase());
  if (!found) {
    // `embark` is aircraft-only; the `board` backup still delegates to poker's
    // community-board when there's no aircraft here.
    const verb = (raw || '').trim().toLowerCase().split(/\s+/)[0];
    if (verb === 'board') return gametableCommands.board(args, raw, player, broadcast);
    return { type: 'emote', message: "There's no aircraft here to embark." };
  }

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
  if (seat === 'passenger' && live.occupants.size >= (live.type.seats || 1))
    return { type: 'emote', message: `The ${live.type.name} is full.` };

  live.occupants.add(player.id);
  player.aircraftId = found.id;
  player.seat = seat;
  // Made it in under fire — slam the hatch and everything on you loses its lock.
  let broke = 0;
  if (inCombat) {
    broke = breakOffAttackers(player);
    broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} throws themselves into the ${live.type.name} and hauls the hatch shut.` }, player.id);
  } else {
    broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} climbs into the ${live.type.name}.` }, player.id);
  }
  pushHud(live);
  const hint = seat === 'pilot'
    ? "You settle into the pilot's seat. <span class=\"text-dim\">startup</span>, set a <span class=\"text-dim\">throttle</span>, then <span class=\"text-dim\">takeoff</span>."
    : 'You strap into a passenger seat and wait on the pilot.';
  const scramble = inCombat
    ? `<span class="text-green">You throw yourself aboard and slam the hatch — ${broke ? 'they lose you' : 'the fight breaks off'}.</span> `
    : '';
  return { type: 'emote', message: `${scramble}You climb aboard the ${live.type.name}. ${hint}` };
}

async function cmdDisembark(args, raw, player, broadcast) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live) return { type: 'emote', message: "You're not aboard anything." };
  if (live.row.airborne) return { type: 'emote', message: "You can't step out — you're in the air." };
  const name = live.type.name;
  detach(player);
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
  if (!player.aircraftId) return generatorCommands.refuel(args, raw, player, broadcast);   // generator refuel
  return refuelAt(args, raw, player);
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
    return { type: 'noop' };
  }
  live.row.damage = Math.min(1, live.row.damage + (emergency ? 0.5 : 0.35));
  if (live.row.damage >= 1) { await crash(live, 'crash'); return { type: 'noop' }; }
  await parkAt(live, fieldZoneId);
  out(player.id, '<span class="text-red">You slam it down hard — something in the airframe screams and gives. But you\'re down.</span>');
  broadcast(fieldZoneId, { type: 'zone_event', message: `The ${live.type.name} thumps down onto the field hard enough to bounce.`, refresh: true }, player.id);
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
    sendToZone(cell.id, { type: 'zone_event', message: msg });
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
  sendToZone(zoneId, { type: 'zone_event', message: `${e.name} snaps its head up, tracking the aircraft overhead.` });
  // Aggressive things take a potshot; louder/lower = a fatter, easier target.
  if (e.behavior === 'aggressive' && Math.random() < 0.15 + loud * 0.05) {
    live.row.damage = Math.min(1, live.row.damage + 0.05);
    toOccupants(live, `<span class="text-amber">Ground fire from below cracks off the hull — hull ${Math.round((1 - live.row.damage) * 100)}%.</span>`);
    sendToZone(zoneId, { type: 'zone_event', message: `${e.name} looses a burst of fire up at the passing aircraft.` });
    if (live.row.damage >= 1) await crash(live, 'groundfire');
  }
}

// ── The airborne tick loop ────────────────────────────────────────────────────
let ticking = false;
async function flightTick() {
  if (ticking) return;
  ticking = true;
  try {
    for (const live of [...liveAircraft.values()]) {
      if (live.charter) continue;   // NPC-flown charters are driven by charter.js, not the physics tick
      if (!live.row.airborne || live.pending) continue;
      const a = live.row, eff = effStats(live);

      // 1. Advance along the true heading (sub-tile float accumulation).
      advance(live, live.hover ? 0 : eff.cruise * (a.throttle / 100));
      // 2. Burn.
      a.fuel = Math.max(0, a.fuel - eff.burn * (0.15 + (a.throttle / 100)) * (BAND_BURN[a.altitude_band] || 1));
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

// Inside a walk-in hangar: the same services (they resolve to the ramp via
// fieldFor), a way `out` to the aircraft on the ramp, and — when one's on shift —
// the charter pilot at their desk. Embarking always happens outside on the ramp.
function describeHangarInterior(zone) {
  const ramp = getZone(zone.flags.hangar_ramp);
  if (!ramp) return `<span class="furniture-label">Hangar:</span> ${svcLink('out', 'out')} <span class="text-dim">back out to the ramp</span>`;
  let line = `${serviceBits(ramp)}\n<span class="furniture-label">Ramp:</span> ${svcLink('out', 'out')} <span class="text-dim">step out to the aircraft on the ramp (embark there)</span>`;
  const pilot = getZoneNpcs(zone.id).find(n => n?.flags?.charter_pilot);
  if (pilot) line += `\n<span class="text-dim">${pilot.name} sits at the ops desk, feet up, a mug going cold on the console.</span>`;
  return line;
}

// Fires unconditionally per zone (unlike zone.furniturePanel, which only fires
// when the zone has furniture rows) — several airfields have none, so this is
// the only reliable way to surface "there's a hangar here" at every field.
async function describeAirfield(zone) {
  if (zone?.flags?.hangar_interior) return describeHangarInterior(zone);
  if (!zone?.flags?.airfield_id) return undefined;
  const f = zone.flags;
  let line = serviceBits(zone);
  // The walk-in hangar entrance, if this field has one.
  if (f.hangar_interior_zone) line += `\n<span class="furniture-label">Hangar:</span> ${svcLink('in', 'step inside')} <span class="text-dim">the hangar office — desk, tools, the charter pilot — is through the bay doors</span>`;
  // If there's a boardable aircraft parked here, offer a one-click embark.
  const { rows } = await query(
    "SELECT name FROM aircraft WHERE parked_zone_id=$1 AND is_wreck=0 AND (custom_data->>'charter') IS DISTINCT FROM 'true' LIMIT 1",
    [zone.id]
  ).catch(() => ({ rows: [] }));
  if (rows.length) line += `\n<span class="furniture-label">On the ramp:</span> ${svcLink('embark', 'embark')} <span class="text-dim">an aircraft is parked here</span>`;
  // A chartered aircraft waiting for its passenger — held for whoever chartered it.
  const ch = charterParkedAt(zone.id);
  if (ch) {
    const who = getLivePlayer(ch.chartererId)?.handle;
    line += `\n<span class="furniture-label">Charter waiting:</span> ${svcLink('embark', 'embark')} <span class="text-dim">${ch.pilotName}'s aircraft is on the ramp${who ? `, held for ${who}` : ''}</span>`;
  }
  return line;
}

// ── Admin: free test-fly any aircraft from a field ────────────────────────────
async function cmdTestFly(args, raw, player) {
  if (!['admin', 'dev'].includes(player.role)) return { type: 'error', message: 'Access denied.' };
  if (player.aircraftId) return { type: 'emote', message: 'Disembark first.' };
  const zone = getZone(player.current_zone);
  if (!zone?.flags?.airfield_id) return { type: 'emote', message: 'Stand at an airfield to conjure a test aircraft.' };
  const wanted = (args[0] || '').toLowerCase();
  const { rows } = await query("SELECT id, name, fuel_capacity FROM aircraft_types WHERE (id=$1 OR lower(name)=$1) AND class <> 'wreck'", [wanted]);
  if (!rows.length) {
    const all = await query("SELECT id FROM aircraft_types WHERE class <> 'wreck' ORDER BY price_buy");
    return { type: 'output', message: `Usage: <b>.testfly &lt;type&gt;</b>. Types: ${all.rows.map(r => r.id.replace('ac_', '')).join(', ')}` };
  }
  const t = rows[0];
  const id = `aircraft_test_${player.id.slice(0, 6)}_${randomUUID().slice(0, 6)}`;
  await query(
    `INSERT INTO aircraft (id,type_id,name,owner_id,map_id,grid_x,grid_y,altitude_band,parked_zone_id,fuel,engine_temp,rental)
     VALUES ($1,$2,$3,$4,'map_world',$5,$6,'ground',$7,$8,20,0)`,
    [id, t.id, `TEST ${t.name}`, player.id, zone.grid_x, zone.grid_y, zone.id, t.fuel_capacity]
  );
  const live = await loadAircraft(id);
  live.occupants.add(player.id); player.aircraftId = id; player.seat = 'pilot';
  pushHud(live);
  return { type: 'emote', message: `<span class="text-green">[TEST] A free <b>${t.name}</b>, full tank, and you're in the pilot's seat. startup · throttle · takeoff. It's yours — scrap it when done.</span>` };
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

export const commands = {
  embark: cmdBoard, board: cmdBoard, disembark: cmdDisembark, deplane: cmdDisembark, testfly: cmdTestFly,
  flight: cmdFlightStatus, fs: cmdFlightStatus,
  startup: cmdStartup, shutdown: cmdShutdown, throttle: cmdThrottle,
  heading: cmdHeading, climb: cmdClimb, dive: cmdDive,
  takeoff: cmdTakeoff, land: cmdLand, refuel: cmdRefuel,
  takeoffresolve: cmdTakeoffResolve, landresolve: cmdLandResolve,
  ...hazardCommands, ...acquisitionCommands, ...combatCommands, ...contractCommands, ...hangarCommands, ...charterCommands,
};

export const hooks = {
  'zone.describeRoom': describeAirfield,
};

// ── Dev-panel debug route (GET /flight/debug) — charter pilot status + flight log
export const routeHandler = async (path, method, body, auth) => {
  if (!path.startsWith('/flight')) return null;
  const parts = path.split('/').filter(Boolean);
  if (parts[1] === 'debug' && method === 'GET') return { status: 200, body: await charterDebug() };
  return null;
};

export const _test = { surfaceAt, takeoffDifficulty, landDifficulty, DIRS, liveAircraft, noiseReach };

console.log('[flight] Plugin loaded.');
