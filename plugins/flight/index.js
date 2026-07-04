// Flight plugin — Phase A vertical slice (docs/systems-flight.md, proposal in
// docs/proposals/systems-flight.md).
//
// The aircraft is a first-class object that owns its occupant set at runtime —
// there is NO cabin `zones` row (that would violate "content is deliberate,
// never created at runtime"). "Being aboard" is player state: player.aircraftId
// + player.seat. The cockpit the player sees is SYNTHESIZED from the live
// aircraft object and pushed as a `cockpit_update` HUD payload, not from a zone.
//
// The sky is a COMPUTED OVERLAY: an airborne craft carries its own
// (grid_x, grid_y, altitude_band, heading); the "view below" is synthesized from
// the surface zone at the same coord on map_world. Empty cells read as open air.
//
// The machine feel is a `flying` posture tick loop modeled on the fishing /
// scavenging posture loops: every few seconds each airborne craft advances,
// burns fuel, and re-pushes its gauges. Takeoff and landing are interactive
// minigames (the rolling-takeoff bar / the glideslope channel) armed like the
// fishing reel — the client renders them, but the server is authoritative: it
// arms with an anti-spoof token and validates on `takeoffresolve`/`landresolve`.
//
// Aircraft-type templates + airfield flags are CONTENT (aircraft_types table +
// zones.flags.airfield_id), seeded by scripts/seed-flight.js — never hardcoded.

import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getZone, getAllZones, getLivePlayer } from '../../server/engine/world.js';
import { effectiveSkill, awardSkillUse, skillCheck } from '../../server/engine/skills.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { setPosture, forceStand } from '../../server/engine/posture.js';
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { registerInputMatcher } from '../../server/engine/plugins.js';
import { handlePlayerDeath } from '../../server/engine/gameLoop.js';
// Verb-collision routers: flight wins `board` (over gametable's poker board) and
// `refuel` (over generator's) by declaring `after` in the manifest, then delegates
// to the prior owner by context — the same delegation pattern gametable's `watch`
// router uses. Loaded first (via `after`), so these are already module-cached.
import { commands as gametableCommands } from '../gametable/index.js';
import { commands as generatorCommands } from '../generator/index.js';

const TICK_MS = 3000;              // airborne tick cadence — the "machine" heartbeat
const FUEL_RESERVE_FRAC = 0.10;    // must have at least this much tank to take off
const BINGO_FRAC = 0.20;           // low-fuel warning threshold
const REFUEL_PRICE_PER_UNIT = 2;   // credits per tank-unit at a fuelling field
const BANDS = ['ground', 'low', 'cruise', 'high'];
const BAND_LABEL = { ground: 'GND', low: 'LOW', cruise: 'CRUISE', high: 'HIGH' };
// Higher band = thinner air = a little more burn, but overflies ground obstacles.
const BAND_BURN = { ground: 1, low: 1, cruise: 1.25, high: 1.6 };

const DIRS = {
  n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0],
  ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1],
};
const DIR_ALIASES = { north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw' };

// ── Surface coord index (the computed-overlay lookup) ─────────────────────────
// Cache map_world zones by "x,y". Zones never move, so a lazy cache is safe; it
// rebuilds if the world reloaded and grew/shrank.
let _coordIndex = null;
let _bounds = null;
function buildCoordIndex() {
  const idx = new Map();
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const z of getAllZones()) {
    if (z.map_id !== 'map_world' || z.grid_x == null || z.grid_y == null) continue;
    idx.set(`${z.grid_x},${z.grid_y}`, { id: z.id, name: z.name, flags: z.flags || {} });
    minx = Math.min(minx, z.grid_x); maxx = Math.max(maxx, z.grid_x);
    miny = Math.min(miny, z.grid_y); maxy = Math.max(maxy, z.grid_y);
  }
  _coordIndex = idx;
  _bounds = Number.isFinite(minx) ? { minx, maxx, miny, maxy } : { minx: 0, maxx: 0, miny: 0, maxy: 0 };
}
function surfaceAt(x, y) {
  if (!_coordIndex) buildCoordIndex();
  return _coordIndex.get(`${x},${y}`) || null;   // null = open air (no obstacle)
}
function bounds() { if (!_bounds) buildCoordIndex(); return _bounds; }

// ── Live aircraft registry (in-memory; the aircraft owns its occupant set) ────
const liveAircraft = new Map();   // id -> { row, occupants:Set<pid>, pending, starving, persistCtr }

async function loadAircraft(id) {
  if (liveAircraft.has(id)) return liveAircraft.get(id);
  const { rows } = await query('SELECT * FROM aircraft WHERE id=$1', [id]);
  if (!rows.length) return null;
  const { rows: tRows } = await query('SELECT * FROM aircraft_types WHERE id=$1', [rows[0].type_id]);
  if (!tRows.length) return null;
  const live = { row: rows[0], type: tRows[0], occupants: new Set(), pending: null, starving: false, persistCtr: 0 };
  liveAircraft.set(id, live);
  return live;
}

function pilotOf(live) {
  for (const pid of live.occupants) {
    const p = getLivePlayer(pid);
    if (p && p.seat === 'pilot') return p;
  }
  return null;
}

async function persist(live) {
  const a = live.row;
  await query(
    `UPDATE aircraft SET grid_x=$1, grid_y=$2, altitude_band=$3, heading=$4, parked_zone_id=$5,
       fuel=$6, throttle=$7, engine_temp=$8, damage=$9, airborne=$10, engine_on=$11, is_wreck=$12 WHERE id=$13`,
    [a.grid_x, a.grid_y, a.altitude_band, a.heading, a.parked_zone_id, a.fuel, a.throttle,
     a.engine_temp, a.damage, a.airborne, a.engine_on, a.is_wreck, a.id]
  );
}

// Maybe drop an idle parked craft from memory once everyone has left it.
function reap(live) {
  if (!live.occupants.size && !live.row.airborne) liveAircraft.delete(live.row.id);
}

// A 5×5 moving-map window around the craft (north-up). Each cell reports whether
// it's the craft, built land (a surface zone), or open air — the client renders
// the scrolling nav display from this.
function mapWindow(a) {
  const rows = [];
  for (let dy = -2; dy <= 2; dy++) {
    const row = [];
    for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dy === 0) { row.push({ kind: 'craft' }); continue; }
      const cell = surfaceAt(a.grid_x + dx, a.grid_y + dy);
      row.push({ kind: cell ? 'land' : 'air' });
    }
    rows.push(row);
  }
  return rows;
}

// ── HUD payload (synthesized cockpit state, pushed to occupants) ──────────────
function gaugePayload(live) {
  const a = live.row, t = live.type;
  const cap = t.fuel_capacity || 1;
  const below = a.airborne ? surfaceAt(a.grid_x, a.grid_y) : null;
  const fuelPct = Math.max(0, Math.round((a.fuel / cap) * 100));
  let warn = null;
  if (a.fuel <= 0) warn = 'STARVATION';
  else if (a.fuel <= cap * BINGO_FRAC) warn = 'BINGO';
  return {
    craft: t.name, tail: a.name || t.name, class: t.class,
    band: a.altitude_band, bandLabel: BAND_LABEL[a.altitude_band] || a.altitude_band,
    bandIndex: BANDS.indexOf(a.altitude_band), ceiling: Math.min(3, t.altitude_ceiling || 2),
    heading: (a.heading || 'n').toLowerCase(),
    throttle: a.throttle, spd: a.airborne ? Math.round(t.cruise_speed * (a.throttle / 100) * 84) : 0,
    fuel: Math.round(a.fuel), fuelPct, fuelCap: Math.round(cap),
    temp: Math.round(a.engine_temp), tempMax: 160,
    hullPct: Math.max(0, Math.round((1 - a.damage) * 100)),
    x: a.grid_x, y: a.grid_y, surface: a.airborne ? (below ? below.name : 'open air') : null,
    airborne: !!a.airborne, engineOn: !!a.engine_on, warn, fuelType: t.fuel_type,
    map: a.airborne ? mapWindow(a) : null,
  };
}
function pushHud(live) {
  const payload = gaugePayload(live);
  for (const pid of live.occupants) {
    const p = getLivePlayer(pid);
    if (!p) continue;
    sendToPlayer(pid, { type: 'cockpit_update', state: { ...payload, seat: p.seat } });
  }
}
function closeHud(pid) { sendToPlayer(pid, { type: 'cockpit_close' }); }
function out(pid, message) { sendToPlayer(pid, { type: 'output', message }); }

// ── Detach a player from a craft (shared by disembark / crash) ────────────────
function detach(player, { restore = true } = {}) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (live) live.occupants.delete(player.id);
  if (player.posture === 'flying') forceStand(player, 'flight.detach');
  delete player.aircraftId;
  delete player.seat;
  if (restore) closeHud(player.id);
  if (live) reap(live);
}

// ── Difficulty helpers ────────────────────────────────────────────────────────
function takeoffDifficulty(live) {
  return Math.round(4 + (live.type.handling || 0) + (live.row.damage || 0) * 6);
}
function landDifficulty(live, emergency) {
  return Math.round(5 + (live.type.handling || 0) + (live.row.damage || 0) * 6 + (emergency ? 4 : 0));
}

// ── Verbs: preflight / boarding ───────────────────────────────────────────────
async function findParkedHere(zoneId, nameArg) {
  const { rows } = await query(
    'SELECT id, name, type_id, is_wreck FROM aircraft WHERE parked_zone_id=$1',
    [zoneId]
  );
  const flyable = rows.filter(r => !r.is_wreck);
  if (!flyable.length) return null;
  if (nameArg) {
    const hit = flyable.find(r => (r.name || '').toLowerCase().includes(nameArg) || r.id.includes(nameArg));
    return hit || null;
  }
  return flyable[0];
}

async function cmdBoard(args, raw, player, broadcast) {
  if (player.aircraftId) return { type: 'emote', message: "You're already aboard." };

  // No aircraft parked here → this is a poker "board" (community cards). Delegate
  // to gametable, which flight shadows by load order.
  const found = await findParkedHere(player.current_zone, args.join(' ').trim().toLowerCase());
  if (!found) return gametableCommands.board(args, raw, player, broadcast);

  if (player.combatTargetId || player.pvpTargetId || player.npcCombatTargetId)
    return { type: 'emote', message: "Not while you're fighting for your life." };
  if ((player.posture || 'standing') !== 'standing')
    return { type: 'emote', message: 'You need to be on your feet to climb aboard.' };

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
    ? "You settle into the pilot's seat. <span class=\"text-dim\">startup</span> the engine, set a <span class=\"text-dim\">throttle</span>, then <span class=\"text-dim\">takeoff</span>."
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

// ── Verbs: engine / throttle ──────────────────────────────────────────────────
function requirePilot(player) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live) return { err: { type: 'emote', message: "You're not aboard an aircraft." } };
  if (player.seat !== 'pilot') return { err: { type: 'emote', message: "You're not in the pilot's seat." } };
  return { live };
}

async function cmdStartup(args, raw, player, broadcast) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (live.row.airborne) return { type: 'emote', message: "The engine's already running — you're flying it." };
  if (live.row.engine_on) return { type: 'emote', message: "The engine's already spun up." };
  if (live.row.fuel <= 0) return { type: 'emote', message: "Dry tank. Nothing to burn — you'll need to refuel." };
  const chk = await skillCheck(player, 'piloting', Math.max(2, takeoffDifficulty(live) - 3));
  if (!chk.success) {
    live.row.engine_temp = Math.min(140, live.row.engine_temp + 8);
    return { type: 'emote', message: 'The engine coughs, catches, and dies. You reset the switches and get ready to try again.' };
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
  if (live.row.airborne) return { type: 'emote', message: "You are NOT shutting the engine down up here." };
  if (!live.row.engine_on) return { type: 'emote', message: "The engine's already cold." };
  live.row.engine_on = 0;
  live.row.throttle = 0;
  await persist(live);
  pushHud(live);
  return { type: 'emote', message: 'You kill the engine. It winds down to a tick and then silence.' };
}

async function cmdThrottle(args, raw, player, broadcast) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (!live.row.engine_on) return { type: 'emote', message: 'The engine is off. Nothing to throttle.' };
  const n = parseInt(args[0], 10);
  if (Number.isNaN(n)) return { type: 'emote', message: 'Throttle to what? Try `throttle 0`–`throttle 100`.' };
  live.row.throttle = Math.max(0, Math.min(100, n));
  pushHud(live);
  return { type: 'emote', message: `Throttle set to ${live.row.throttle}%.` };
}

// ── Verbs: heading / altitude (airborne) ──────────────────────────────────────
function setHeading(live, dir) { live.row.heading = dir; }

async function cmdHeading(args, raw, player, broadcast) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (!live.row.airborne) return { type: 'emote', message: 'Set a heading once you\'re in the air.' };
  const d = DIR_ALIASES[(args[0] || '').toLowerCase()] || (args[0] || '').toLowerCase();
  if (!DIRS[d]) return { type: 'emote', message: 'Heading where? (n, s, e, w, ne, nw, se, sw)' };
  setHeading(live, d);
  pushHud(live);
  return { type: 'emote', message: `Coming around to ${d.toUpperCase()}.` };
}

async function cmdClimb(args, raw, player, broadcast) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (!live.row.airborne) return { type: 'emote', message: 'You need to be airborne to climb.' };
  const cur = BANDS.indexOf(live.row.altitude_band);
  const ceil = Math.min(3, live.type.altitude_ceiling || 2);
  if (cur >= ceil) return { type: 'emote', message: `The ${live.type.name} won't climb past ${BAND_LABEL[BANDS[ceil]]}.` };
  const chk = await skillCheck(player, 'piloting', 4 + (live.type.handling || 0));
  live.row.fuel = Math.max(0, live.row.fuel - 0.5);
  if (!chk.success) return { type: 'emote', message: 'You haul back on the stick but the climb mushes out — try again.' };
  live.row.altitude_band = BANDS[cur + 1];
  await awardSkillUse(player.id, 'piloting', 0);
  pushHud(live);
  return { type: 'emote', message: `<span class="text-cyan">You climb to ${BAND_LABEL[live.row.altitude_band]}.</span>` };
}

async function cmdDive(args, raw, player, broadcast) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (!live.row.airborne) return { type: 'emote', message: 'You need to be airborne to descend.' };
  const cur = BANDS.indexOf(live.row.altitude_band);
  if (cur <= 1) return { type: 'emote', message: "You're as low as you fly without landing. Try `land`." };
  live.row.altitude_band = BANDS[cur - 1];
  pushHud(live);
  return { type: 'emote', message: `You nose down to ${BAND_LABEL[live.row.altitude_band]}.` };
}

// ── Verbs: takeoff / land (interactive minigames) ─────────────────────────────
async function cmdTakeoff(args, raw, player, broadcast) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (live.row.airborne) return { type: 'emote', message: "You're already flying." };
  if (!live.row.engine_on) return { type: 'emote', message: 'Spin the engine up first — `startup`.' };
  const zone = getZone(live.row.parked_zone_id);
  if (!zone?.flags?.airfield_id) return { type: 'emote', message: 'You can only take off from an airfield.' };
  if (live.row.fuel < live.type.fuel_capacity * FUEL_RESERVE_FRAC)
    return { type: 'emote', message: 'Not enough fuel to safely take off. Refuel first.' };
  if (live.row.throttle < 40) return { type: 'emote', message: 'You need more throttle to get airborne — push it up past 40%.' };

  const token = randomUUID();
  live.pending = { kind: 'takeoff', token };
  sendToPlayer(player.id, {
    type: 'flight_takeoff', token,
    skill: await effectiveSkill(player, 'piloting'),
    difficulty: takeoffDifficulty(live),
    deviceName: live.type.name,
  });
  broadcast(live.row.parked_zone_id, { type: 'zone_event', message: `The ${live.type.name} runs up its engine and begins its takeoff roll.` }, player.id);
  return { type: 'emote', message: '<span class="text-cyan">Rolling for takeoff — hold it straight and rotate.</span>' };
}

async function cmdLand(args, raw, player, broadcast) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (!live.row.airborne) return { type: 'emote', message: "You're already on the ground." };
  if (live.row.altitude_band !== 'low') return { type: 'emote', message: 'Descend to LOW over a field before you try to land — `dive`.' };
  const below = surfaceAt(live.row.grid_x, live.row.grid_y);
  const field = below?.flags?.airfield_id ? below : null;
  if (!field) return { type: 'emote', message: 'There\'s no airfield below you. Find one before you set down.' };

  const emergency = live.row.fuel <= 0;
  const token = randomUUID();
  live.pending = { kind: 'land', token, fieldZoneId: field.id, emergency };
  sendToPlayer(player.id, {
    type: 'flight_land', token, emergency,
    skill: await effectiveSkill(player, 'piloting'),
    difficulty: landDifficulty(live, emergency),
    deviceName: field.name,
  });
  return { type: 'emote', message: emergency
    ? '<span class="text-red">DEAD STICK — you get one pass. Fly the glideslope down.</span>'
    : '<span class="text-cyan">On approach. Fly the glideslope down and flare.</span>' };
}

async function cmdRefuel(args, raw, player, broadcast) {
  // Not aboard an aircraft → this is a generator refuel. Delegate to generator,
  // which flight shadows by load order.
  if (!player.aircraftId) return generatorCommands.refuel(args, raw, player, broadcast);
  const { live, err } = requirePilot(player); if (err) return err;
  if (live.row.airborne) return { type: 'emote', message: "You can't refuel in the air." };
  const zone = getZone(live.row.parked_zone_id);
  if (!zone?.flags?.airfield_fuel) return { type: 'emote', message: 'No fuel service at this field.' };
  const cap = live.type.fuel_capacity;
  const need = cap - live.row.fuel;
  if (need <= 0.5) return { type: 'emote', message: 'The tank is already full.' };
  const want = args[0] ? Math.min(need, Math.max(0, parseInt(args[0], 10) || 0)) : need;
  const cost = Math.ceil(want * REFUEL_PRICE_PER_UNIT);
  if ((player.credits || 0) < cost) return { type: 'emote', message: `Fuel runs ${REFUEL_PRICE_PER_UNIT}c/unit — you can't cover ${cost}c.` };
  player.credits -= cost;
  live.row.fuel = Math.min(cap, live.row.fuel + want);
  live.starving = false;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  await persist(live);
  pushHud(live);
  return { type: 'output', message: `You pump ${Math.round(want)} units of ${live.type.fuel_type} for ${cost}c. Tank: ${Math.round(live.row.fuel)}/${Math.round(cap)}.`,
    player_update: { credits: player.credits } };
}

// ── Resolvers (silent; the minigame overlay reports its outcome) ──────────────
async function cmdTakeoffResolve(args, raw, player, broadcast) {
  const token = args[0]; const won = args[1] === '1';
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live || player.seat !== 'pilot' || live.pending?.kind !== 'takeoff' || live.pending.token !== token)
    return { type: 'noop' };
  live.pending = null;
  if (live.row.airborne) return { type: 'noop' };

  if (!won) {
    live.row.engine_temp = Math.min(160, live.row.engine_temp + 12);
    out(player.id, '<span class="text-red">You run out of strip and haul back to a stop, engine screaming. Aborted.</span>');
    pushHud(live);
    return { type: 'noop' };
  }
  live.row.airborne = 1;
  live.row.altitude_band = 'low';
  live.row.parked_zone_id = null;
  live.starving = false;
  // Everyone aboard leaves the ground — drop them from the field's occupancy so
  // they aren't rendered "standing" on the strip while they're in the air. Their
  // current_zone stays as a fallback anchor; movement/look are gated meanwhile.
  for (const pid of live.occupants) {
    const p = getLivePlayer(pid);
    if (!p) continue;
    getZone(p.current_zone)?.players.delete(pid);
    if (p.seat !== 'pilot') setPosture(p, 'flying');
  }
  setPosture(player, 'flying');
  await persist(live);
  pushHud(live);
  await awardSkillUse(player.id, 'piloting', Math.max(0, (await effectiveSkill(player, 'piloting')) - takeoffDifficulty(live)));
  out(player.id, '<span class="text-green">Wheels up. You claw into the sky and the ground drops away below you.</span>');
  return { type: 'noop' };
}

async function cmdLandResolve(args, raw, player, broadcast) {
  const token = args[0]; const won = args[1] === '1';
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live || player.seat !== 'pilot' || live.pending?.kind !== 'land' || live.pending.token !== token)
    return { type: 'noop' };
  const { fieldZoneId, emergency } = live.pending;
  live.pending = null;
  if (!live.row.airborne) return { type: 'noop' };

  if (won) {
    await parkAt(live, fieldZoneId);
    out(player.id, '<span class="text-green">You grease it on. Wheels down, throttle back — you\'re on the ground.</span>');
    await awardSkillUse(player.id, 'piloting', Math.max(0, (await effectiveSkill(player, 'piloting')) - landDifficulty(live, emergency)));
    return { type: 'noop' };
  }

  // Botched approach: a hard arrival. Damage may finish the craft → crash.
  live.row.damage = Math.min(1, live.row.damage + (emergency ? 0.5 : 0.35));
  if (live.row.damage >= 1) { await crash(live, broadcast); return { type: 'noop' }; }
  await parkAt(live, fieldZoneId);
  out(player.id, '<span class="text-red">You slam it down hard — something in the airframe screams and gives. But you\'re down.</span>');
  broadcast(fieldZoneId, { type: 'zone_event', message: `The ${live.type.name} thumps down onto the field hard enough to bounce.`, refresh: true }, player.id);
  return { type: 'noop' };
}

// Bring a craft to rest at an airfield zone; restore its occupants to the ground.
async function parkAt(live, zoneId) {
  const surface = surfaceAt(live.row.grid_x, live.row.grid_y);
  const z = getZone(zoneId);
  if (z) { live.row.grid_x = z.grid_x; live.row.grid_y = z.grid_y; }
  else if (surface) { /* keep coords */ }
  live.row.airborne = 0;
  live.row.altitude_band = 'ground';
  live.row.throttle = 0;
  live.row.parked_zone_id = zoneId;
  live.starving = false;
  for (const pid of live.occupants) {
    const p = getLivePlayer(pid);
    if (!p) continue;
    if (p.posture === 'flying') forceStand(p, 'flight.land');
    p.current_zone = zoneId;
    getZone(zoneId)?.players.add(pid);
    closeHud(pid);
    sendToPlayer(pid, { type: 'output', message: `<span class="text-dim">You are down at ${z?.name || 'the field'}.</span>` });
  }
  await persist(live);
}

// Turn the craft into a salvageable wreck at the surface cell below and kill
// everyone aboard (lethal per normal death rules).
async function crash(live, broadcast) {
  const surface = surfaceAt(live.row.grid_x, live.row.grid_y);
  const wreckZone = surface?.id || live.row.parked_zone_id || 'zone_start';
  live.row.airborne = 0;
  live.row.is_wreck = 1;
  live.row.damage = 1;
  live.row.engine_on = 0;
  live.row.throttle = 0;
  live.row.altitude_band = 'ground';
  live.row.parked_zone_id = wreckZone;
  await persist(live);
  sendToZone(wreckZone, { type: 'zone_event', message: `<span class="text-red">A ${live.type.name} screams down out of the sky and craters into the ground in a fireball.</span>`, refresh: true });
  const doomed = [...live.occupants];
  for (const pid of doomed) {
    const p = getLivePlayer(pid);
    if (!p) continue;
    detach(p, { restore: true });
    p.current_zone = wreckZone;
    out(pid, '<span class="text-red">The ground comes up to meet you. There is a noise, and then there is nothing.</span>');
    await handlePlayerDeath(p, null, { type: 'crash', label: 'Died in an aircraft crash' });
  }
  liveAircraft.delete(live.row.id);
}

// ── The airborne tick loop ────────────────────────────────────────────────────
let ticking = false;
async function flightTick() {
  if (ticking) return;
  ticking = true;
  try {
    for (const live of [...liveAircraft.values()]) {
      if (!live.row.airborne) continue;
      if (live.pending) continue;   // paused on a landing/takeoff minigame
      const a = live.row, t = live.type;

      // 1. Advance along heading at throttle.
      const step = Math.round(t.cruise_speed * (a.throttle / 100));
      if (step > 0) {
        const [dx, dy] = DIRS[a.heading] || [0, 0];
        const b = bounds();
        a.grid_x = Math.max(b.minx, Math.min(b.maxx, a.grid_x + dx * step));
        a.grid_y = Math.max(b.miny, Math.min(b.maxy, a.grid_y + dy * step));
      }

      // 2. Burn fuel (idle sips; throttle + altitude drink).
      const burn = t.fuel_burn_base * (0.15 + (a.throttle / 100)) * (BAND_BURN[a.altitude_band] || 1);
      a.fuel = Math.max(0, a.fuel - burn);

      // 3. Thermal drift toward a throttle-set target.
      const target = 20 + a.throttle * 1.1;
      a.engine_temp += (target - a.engine_temp) * 0.3;

      // 4. Fuel starvation → dead-stick, then crash if not landed by next tick.
      if (a.fuel <= 0) {
        if (!live.starving) {
          live.starving = true;
          for (const pid of live.occupants) out(pid, '<span class="text-red">⚠ ENGINE OUT — the tank\'s dry. Dead stick. Get it down NOW.</span>');
        } else {
          await crash(live, sendToZone);
          continue;
        }
      }

      // 5. Emit: HUD to occupants + engine noise to the surface below.
      pushHud(live);
      const below = surfaceAt(a.grid_x, a.grid_y);
      if (below && a.altitude_band === 'low' && Math.random() < 0.5)
        sendToZone(below.id, { type: 'zone_event', message: `An aircraft passes low overhead with a hammering drone.` });

      if (++live.persistCtr % 4 === 0) await persist(live);
    }
  } finally {
    ticking = false;
  }
}
setInterval(() => flightTick().catch(e => console.error('[flight] tick error:', e.message)), TICK_MS);

// ── Move gate: you can't walk while aboard an aircraft (airborne or parked). ───
registerMoveGate(({ player }) => {
  if (player.aircraftId) {
    const live = liveAircraft.get(player.aircraftId);
    return { block: true, message: live?.row.airborne ? "You can't walk out of the sky." : "You're strapped into a cockpit — `disembark` first." };
  }
  return undefined;
}, 'flight');

// ── Cardinal-while-airborne: intercept bare direction verbs ONLY when the pilot
// is flying; otherwise return undefined so the input falls through to the normal
// ground mover (dispatch treats undefined as "not handled").
registerInputMatcher(/^(n|s|e|w|ne|nw|se|sw|north|south|east|west|northeast|northwest|southeast|southwest)$/i,
  async (args, raw, player, broadcast) => {
    const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
    if (!live || !live.row.airborne || player.seat !== 'pilot') return undefined;
    const d = DIR_ALIASES[raw.toLowerCase()] || raw.toLowerCase();
    setHeading(live, d);
    pushHud(live);
    return { type: 'emote', message: `Coming around to ${d.toUpperCase()}.` };
  }, 'flight');

// Clean detach if a plugin/engine force-stands the pilot out of 'flying' while
// parked isn't possible, but a disconnect handler may end their session — the
// aircraft object persists; nothing to do here beyond leaving the row parked.

export const commands = {
  board: cmdBoard,
  disembark: cmdDisembark,
  deplane: cmdDisembark,
  startup: cmdStartup,
  shutdown: cmdShutdown,
  throttle: cmdThrottle,
  heading: cmdHeading,
  climb: cmdClimb,
  dive: cmdDive,
  takeoff: cmdTakeoff,
  land: cmdLand,
  refuel: cmdRefuel,
  takeoffresolve: cmdTakeoffResolve,
  landresolve: cmdLandResolve,
};

// Pure helpers + internals exposed for the regression suite (never used in prod).
export const _test = { surfaceAt, takeoffDifficulty, landDifficulty, DIRS, liveAircraft, buildCoordIndex };

console.log('[flight] Plugin loaded.');
