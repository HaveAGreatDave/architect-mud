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
import {
  TICK_MS, FUEL_RESERVE_FRAC, BANDS, BAND_LABEL, BAND_BURN, DIRS, DIR_ALIASES,
  liveAircraft, surfaceAt, bounds, loadAircraft, pilotOf, persist, reap, effStats,
  pushHud, out, detach, takeoffDifficulty, landDifficulty,
  parkAt, crash, setHeading, getZone, getLivePlayer, sendToZone, sendToPlayer, setPosture,
} from './state.js';
import { rollHazards, commands as hazardCommands } from './hazards.js';
import { commands as acquisitionCommands, refuelAt } from './acquisition.js';
import { commands as combatCommands, tickCombat } from './combat.js';
import { commands as contractCommands, checkContractDelivery } from './contracts.js';
import { commands as hangarCommands } from './hangars.js';

// Verb-collision routers (see plugin.json `after`): flight wins `board`/`refuel`
// and delegates to the prior owner by context.
import { commands as gametableCommands } from '../gametable/index.js';
import { commands as generatorCommands } from '../generator/index.js';

// ── Boarding ──────────────────────────────────────────────────────────────────
async function findParkedHere(zoneId, nameArg) {
  const { rows } = await query('SELECT id, name, type_id, is_wreck, owner_id, hangar_id, rental FROM aircraft WHERE parked_zone_id=$1', [zoneId]);
  const flyable = rows.filter(r => !r.is_wreck);
  if (!flyable.length) return null;
  if (nameArg) return flyable.find(r => (r.name || '').toLowerCase().includes(nameArg) || r.id.includes(nameArg)) || null;
  return flyable[0];
}

async function cmdBoard(args, raw, player, broadcast) {
  if (player.aircraftId) return { type: 'emote', message: "You're already aboard." };
  const found = await findParkedHere(player.current_zone, args.join(' ').trim().toLowerCase());
  if (!found) return gametableCommands.board(args, raw, player, broadcast);   // poker board

  if (player.combatTargetId || player.pvpTargetId || player.npcCombatTargetId)
    return { type: 'emote', message: "Not while you're fighting for your life." };
  if ((player.posture || 'standing') !== 'standing')
    return { type: 'emote', message: 'You need to be on your feet to climb aboard.' };

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
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} climbs into the ${live.type.name}.` }, player.id);
  pushHud(live);
  const hint = seat === 'pilot'
    ? "You settle into the pilot's seat. <span class=\"text-dim\">startup</span>, set a <span class=\"text-dim\">throttle</span>, then <span class=\"text-dim\">takeoff</span>."
    : 'You strap into a passenger seat and wait on the pilot.';
  return { type: 'emote', message: `You climb aboard the ${live.type.name}. ${hint}` };
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
  if (live.row.engine_on) return { type: 'emote', message: "The engine's already spun up." };
  if (live.row.fuel <= 0) return { type: 'emote', message: 'Dry tank. Nothing to burn — you\'ll need to refuel.' };
  const chk = await skillCheck(player, 'piloting', Math.max(2, takeoffDifficulty(live) - 3));
  if (!chk.success) {
    live.row.engine_temp = Math.min(140, live.row.engine_temp + 8);
    return { type: 'emote', message: 'The engine coughs, catches, and dies. You reset the switches to try again.' };
  }
  live.row.engine_on = 1;
  await persist(live);
  pushHud(live);
  await awardSkillUse(player.id, 'piloting', 0);
  broadcast(player.current_zone, { type: 'zone_event', message: `The ${live.type.name} shudders and its engine spins up to a howl.` }, player.id);
  return { type: 'emote', message: '<span class="text-cyan">The engine catches and settles into a steady roar.</span> You have the controls.' };
}

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
  const d = DIR_ALIASES[(args[0] || '').toLowerCase()] || (args[0] || '').toLowerCase();
  if (!DIRS[d]) return { type: 'emote', message: 'Heading where? (n, s, e, w, ne, nw, se, sw)' };
  setHeading(live, d); live.hover = false; pushHud(live);
  return { type: 'emote', message: `Coming around to ${d.toUpperCase()}.` };
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
  if (live.row.throttle < 40) return { type: 'emote', message: 'You need more throttle to get airborne — push it past 40%.' };

  const token = randomUUID();
  live.pending = { kind: 'takeoff', token };
  const isVtol = live.type.takeoff_mode === 'vtol';
  sendToPlayer(player.id, {
    type: 'flight_takeoff', token, vtol: isVtol,
    skill: await effectiveSkill(player, 'piloting'), difficulty: takeoffDifficulty(live), deviceName: live.type.name,
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
    type: 'flight_land', token, emergency,
    skill: await effectiveSkill(player, 'piloting'), difficulty: landDifficulty(live, emergency), deviceName: field.name,
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

// ── The airborne tick loop ────────────────────────────────────────────────────
let ticking = false;
async function flightTick() {
  if (ticking) return;
  ticking = true;
  try {
    for (const live of [...liveAircraft.values()]) {
      if (!live.row.airborne || live.pending) continue;
      const a = live.row, eff = effStats(live);

      // 1. Advance (hover holds station).
      const step = live.hover ? 0 : Math.round(eff.cruise * (a.throttle / 100));
      if (step > 0) {
        const [dx, dy] = DIRS[a.heading] || [0, 0];
        const b = bounds();
        a.grid_x = Math.max(b.minx, Math.min(b.maxx, a.grid_x + dx * step));
        a.grid_y = Math.max(b.miny, Math.min(b.maxy, a.grid_y + dy * step));
      }
      // 2. Burn.
      a.fuel = Math.max(0, a.fuel - eff.burn * (0.15 + (a.throttle / 100)) * (BAND_BURN[a.altitude_band] || 1));
      // 3. Thermal (tuning biases it hotter).
      const target = 20 + a.throttle * 1.1 + eff.heatBias;
      a.engine_temp += (target - a.engine_temp) * 0.3;
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
      // 6. Emit HUD + engine noise below.
      pushHud(live);
      const below = surfaceAt(a.grid_x, a.grid_y);
      if (below && a.altitude_band === 'low' && Math.random() < 0.5)
        sendToZone(below.id, { type: 'zone_event', message: `An aircraft passes low overhead with a hammering drone.` });
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

export const commands = {
  board: cmdBoard, disembark: cmdDisembark, deplane: cmdDisembark,
  startup: cmdStartup, shutdown: cmdShutdown, throttle: cmdThrottle,
  heading: cmdHeading, climb: cmdClimb, dive: cmdDive,
  takeoff: cmdTakeoff, land: cmdLand, refuel: cmdRefuel,
  takeoffresolve: cmdTakeoffResolve, landresolve: cmdLandResolve,
  ...hazardCommands, ...acquisitionCommands, ...combatCommands, ...contractCommands, ...hangarCommands,
};

export const _test = { surfaceAt, takeoffDifficulty, landDifficulty, DIRS, liveAircraft };

console.log('[flight] Plugin loaded.');
