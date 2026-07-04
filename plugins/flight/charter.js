// Flight — NPC-pilot charters. Instead of renting a plane you fly yourself, a
// charter is a *ride*: an on-duty charter pilot (a `charter_pilot` NPC stationed
// at a hangar) flies you, as a passenger, to a destination of your choice. The
// pilot does everything — takeoff, routing, obstacle avoidance, landing; you have
// no controls. On arrival they set you down and tell you to disembark; if you
// don't within 20s they put you out anyway and turn back for base.
//
// Pilots work staggered 8-hour shifts (three of them cover the day across three
// fields). A field with no on-duty pilot is closed; a pilot already out on a run
// means you wait for their return. Charters cost 10× the aircraft's hourly rate
// and are limited to aircraft with passenger seats — except the VTOL Dragonfly,
// which can set you down on ANY exterior tile, not just an airfield.

import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getZoneNpcs, getAllZones, getNpcsByFlag, moveNpcToZone } from '../../server/engine/world.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import {
  getZone, liveAircraft, loadAircraft, persist, detach, out, toOccupants, pushHud,
  sendToZone, getLivePlayer, surfaceAt, setPosture, bearingDeg, degToCardinal, effStats,
} from './state.js';

const CHARTER_MULT = 10;
const SHIFT_HOURS = 8;
const AUTO_DISEMBARK_MS = 20000;
const CHARTER_TICK_MS = 2500;
const CRUISE_TILES = 2;          // tiles/tick the NPC covers

// aircraftId -> { typeId, class, pilotId, pilotName, playerId, homeField, homeName,
//   phase:'choosing'|'enroute'|'arrived', destZone, destName, fx, fy, tx, ty,
//   destOptions?, anyTile, disembarkAt }
export const activeCharters = new Map();
export const flightLog = [];     // { at, player, pilot, from, to, status }
function log(entry) { flightLog.unshift({ at: Date.now(), ...entry }); if (flightLog.length > 40) flightLog.length = 40; }

const nowHour = () => getEnvironmentState().hour ?? 0;
function fieldOf(player) { const z = getZone(player.current_zone); return z?.flags?.airfield_id ? z : null; }

// ── Pilots ────────────────────────────────────────────────────────────────────
// A pilot is looked up by their ASSIGNED field (flags), not their current
// location — so we can tell you "closed, back at 0800" even while they're off at
// home or out on a run.
function pilotForField(fieldZoneId) {
  return getNpcsByFlag('charter_pilot').find(n => n.flags.charter_pilot.field === fieldZoneId) || null;
}
function onShift(pilot, hour = nowHour()) {
  const start = pilot.flags.charter_pilot.shift_start ?? 0;
  return ((hour - start + 24) % 24) < SHIFT_HOURS;
}
function shiftLabel(pilot) {
  const s = pilot.flags.charter_pilot.shift_start ?? 0;
  const p = (h) => String(h % 24).padStart(2, '0') + '00';
  return `${p(s)}–${p(s + SHIFT_HOURS)}`;
}
function pilotBusy(pilotId) { for (const c of activeCharters.values()) if (c.pilotId === pilotId) return c; return null; }
// "At work" = physically in their hangar, OR out on a flight. Present-in-hangar
// (their zone_id === their field) is the on-duty-and-available signal.
function inHangar(pilot) { return pilot.zone_id === pilot.flags.charter_pilot.field; }
function atWork(pilot) { return !!pilotBusy(pilot.id) || inHangar(pilot); }
function available(pilot) { return inHangar(pilot) && !pilotBusy(pilot.id); }

// ── Presence: clock pilots in/out of the hangar with their shift ──────────────
// On shift + free → in the hangar. Out on a flight → not in the hangar. Off shift
// + not flying → home. A flight that overruns the shift keeps them "at work"
// (flying) until they land; the next sync then sends them home (off the clock).
function syncPilots() {
  for (const pilot of getNpcsByFlag('charter_pilot')) {
    const cp = pilot.flags.charter_pilot;
    const home = pilot.home_zone || 'zone_residential_lobby';
    if (pilotBusy(pilot.id)) { if (pilot.zone_id !== home) moveNpcToZone(pilot.id, home); continue; } // out flying
    const target = onShift(pilot) ? cp.field : home;
    if (pilot.zone_id !== target) moveNpcToZone(pilot.id, target);
  }
}

// The other field currently staffed (so a closed desk can point you somewhere).
function openDeskElsewhere(exceptField) {
  for (const p of getNpcsByFlag('charter_pilot')) {
    if (p.flags.charter_pilot.field === exceptField) continue;
    if (available(p)) { const z = getZone(p.flags.charter_pilot.field); return { field: z?.flags?.airfield_name || z?.name || p.flags.charter_pilot.field, pilot: p.name }; }
  }
  return null;
}

async function paxTypes() {
  const { rows } = await query("SELECT id, name, class, seats, price_rent_hourly FROM aircraft_types WHERE class <> 'wreck' AND seats >= 2 ORDER BY price_rent_hourly");
  return rows;
}
const charterCost = (t) => Math.max(200, Math.round((t.price_rent_hourly || 100) * CHARTER_MULT));

// ── charter ───────────────────────────────────────────────────────────────────
export async function cmdCharter(args, raw, player) {
  const field = fieldOf(player);
  if (!field || !field.flags.airfield_charter) return { type: 'emote', message: "There's no charter desk here." };
  if (player.aircraftId) return { type: 'emote', message: "You're already aboard something — disembark first." };

  const pilot = pilotForField(field.id);
  if (!pilot) return { type: 'emote', message: 'No charter pilot works out of this field.' };
  const busy = pilotBusy(pilot.id);
  if (busy) return { type: 'emote', message: `${pilot.name} is out on a run to ${busy.destName}. Wait for them to get back.` };
  if (!inHangar(pilot)) {   // off the clock and gone home
    const other = openDeskElsewhere(field.id);
    return { type: 'output', message: `<span class="text-amber">The charter desk is closed — ${pilot.name} flies the ${shiftLabel(pilot)} shift and isn't here.</span>` +
      (other ? `\nOn duty right now: <b>${other.pilot}</b> at <b>${other.field}</b>.` : '') };
  }

  const types = await paxTypes();
  const wanted = (args[0] || '').toLowerCase();
  if (!wanted) {
    const lines = types.map(t => `· <b>${t.name}</b> <span class="text-dim">(${t.class}, ${t.seats - 1} pax)</span> — <span class="text-green">${charterCost(t)}c</span>${t.id === 'ac_dragonfly' ? ' <span class="text-cyan">· sets down anywhere</span>' : ''} · <span class="action-link" data-action="cmd" data-cmd="charter ${t.id}">charter</span>`);
    return { type: 'output', message: `<span class="text-cyan">${pilot.name}:</span> "Where you headed? Pick your ride — I'll fly it."\n${lines.join('\n')}` };
  }
  const t = types.find(x => x.id === wanted || x.name.toLowerCase() === wanted || x.id.endsWith(wanted));
  if (!t) return { type: 'emote', message: `${pilot.name} doesn't fly a "${wanted}". Type <b>charter</b> for the list.` };

  // Board as a passenger; the pilot has the controls. (Payment is on departure.)
  const acId = `aircraft_charter_${randomUUID().slice(0, 10)}`;
  await query(
    `INSERT INTO aircraft (id,type_id,name,owner_id,map_id,grid_x,grid_y,altitude_band,heading,parked_zone_id,fuel,engine_temp,rental,custom_data)
     VALUES ($1,$2,$3,NULL,'map_world',$4,$5,'ground','0',$6,999,20,1,'{"charter":true}')`,
    [acId, t.id, `${pilot.name}'s ${t.name}`, field.grid_x, field.grid_y, field.id]
  );
  const live = await loadAircraft(acId);
  live.charter = true;
  live.occupants.add(player.id);
  player.aircraftId = acId;
  player.seat = 'passenger';

  const anyTile = t.id === 'ac_dragonfly';
  const ch = {
    aircraftId: acId, typeId: t.id, class: t.class, pilotId: pilot.id, pilotName: pilot.name,
    playerId: player.id, homeField: field.id, homeName: field.flags.airfield_name || field.name,
    phase: 'choosing', anyTile, fx: field.grid_x, fy: field.grid_y,
  };
  activeCharters.set(acId, ch);
  pushHud(live);

  if (anyTile) {
    const tiles = getAllZones()
      .filter(z => z.map_id === 'map_world' && (z.grid_z == null || z.grid_z === 0) && z.grid_x != null)
      .map(z => ({ ...z, is_current: z.id === field.id }));
    return { type: 'flight_pick_dest', message: `<span class="text-green">You climb into ${pilot.name}'s Dragonfly. "Anywhere you like — click a spot on the map, or tell me a place (<b>flyto &lt;place&gt;</b>)."</span>`, tiles };
  }
  const fields = await airfieldList(field.id);
  ch.destOptions = fields;
  const lines = fields.map((f, i) => `  <b>[${i + 1}]</b> ${f.name} <span class="text-dim">(${f.dist} out)</span> · <span class="action-link" data-action="cmd" data-cmd="flyto ${i + 1}">go</span>`);
  return { type: 'output', message: `<span class="text-green">You climb aboard. ${pilot.name}: "Where to?"</span>\n${lines.join('\n')}\nType <b>flyto &lt;n&gt;</b>.` };
}

async function airfieldList(exceptZone) {
  const origin = getZone(exceptZone);
  const out = [];
  for (const z of getAllZones()) {
    if (z.id === exceptZone || z.map_id !== 'map_world' || !z.flags?.airfield_id || z.grid_x == null) continue;
    out.push({ id: z.id, name: z.flags.airfield_name || z.name, dist: Math.max(Math.abs(z.grid_x - origin.grid_x), Math.abs(z.grid_y - origin.grid_y)) });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

// ── flyto ─────────────────────────────────────────────────────────────────────
export async function cmdFlyTo(args, raw, player) {
  const ch = player.aircraftId ? activeCharters.get(player.aircraftId) : null;
  if (!ch || ch.phase !== 'choosing') return { type: 'emote', message: "You're not waiting on a charter destination." };

  let dest = null;
  if (ch.destOptions) {
    const i = parseInt(args[0], 10);
    dest = ch.destOptions[i - 1];
    if (dest) dest = getZone(dest.id);
  } else {
    // Dragonfly: a zone id/name from the map click, or "x y" coords.
    const a0 = (args[0] || '');
    if (/^-?\d+$/.test(a0) && /^-?\d+$/.test(args[1] || '')) {
      const cell = surfaceAt(parseInt(a0, 10), parseInt(args[1], 10));
      dest = cell ? getZone(cell.id) : null;
    } else {
      const key = args.join(' ').toLowerCase();
      dest = getZone(a0) || getAllZones().find(z => z.map_id === 'map_world' && z.grid_x != null && (z.name || '').toLowerCase() === key) || null;
    }
  }
  if (!dest || dest.map_id !== 'map_world' || dest.grid_x == null)
    return { type: 'emote', message: 'That\'s not a place they can set down. Pick another.' };
  if (dest.id === ch.homeField) return { type: 'emote', message: "You're already here." };
  if (!ch.anyTile && !dest.flags?.airfield_id) return { type: 'emote', message: 'This aircraft needs a proper airfield to land.' };

  const { rows } = await query('SELECT price_rent_hourly, name FROM aircraft_types WHERE id=$1', [ch.typeId]);
  const cost = charterCost(rows[0]);
  if ((player.credits || 0) < cost) {
    // Can't pay — the pilot waves you back off. Cancel cleanly.
    await cancelCharter(ch, 'You climb back down — you can\'t cover the fare.');
    return { type: 'emote', message: `That run is <b>${cost}c</b> — you're short. ${ch.pilotName} shrugs you off the aircraft.` };
  }
  player.credits -= cost;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);

  const live = liveAircraft.get(ch.aircraftId);
  ch.destZone = dest.id; ch.destName = dest.flags?.airfield_name || dest.name;
  ch.tx = dest.grid_x; ch.ty = dest.grid_y;
  ch.phase = 'enroute';
  live.row.airborne = 1; live.row.altitude_band = 'low'; live.row.parked_zone_id = null; live.row.throttle = 75;
  live.row.heading = String(Math.round(bearingDeg(ch.fx, ch.fy, ch.tx, ch.ty)));
  live.fx = ch.fx; live.fy = ch.fy;
  // Passenger leaves the ground.
  const p = getLivePlayer(player.id);
  if (p) { getZone(p.current_zone)?.players.delete(p.id); setPosture(p, 'flying'); }
  await persist(live);
  pushHud(live);
  toOccupants(live, `<span class="text-cyan">${ch.pilotName} runs it up and lifts off. "${ch.destName}, straight line. Sit back."</span>`);
  sendToZone(ch.homeField, { type: 'zone_event', message: `${rows[0].name} lifts off and turns out toward ${ch.destName}.` });
  log({ player: player.handle, pilot: ch.pilotName, from: ch.homeName, to: ch.destName, status: 'en route' });
  return { type: 'noop' };
}

// ── The charter autoflight tick ───────────────────────────────────────────────
let ticking = false;
async function charterTick() {
  if (ticking) return; ticking = true;
  try {
    syncPilots();   // clock pilots in/out of their hangars with their shifts
    for (const ch of [...activeCharters.values()]) {
      const live = liveAircraft.get(ch.aircraftId);
      if (!live) { activeCharters.delete(ch.aircraftId); continue; }

      // Abandoned before choosing (passenger bailed on the ground) → scrub it.
      if (ch.phase === 'choosing') { if (!live.occupants.size) await cancelCharter(ch, null); continue; }

      if (ch.phase === 'enroute') {
        const dx = ch.tx - live.fx, dy = ch.ty - live.fy, d = Math.hypot(dx, dy);
        if (d <= CRUISE_TILES) { live.fx = ch.tx; live.fy = ch.ty; await arrive(ch, live); continue; }
        live.fx += (dx / d) * CRUISE_TILES; live.fy += (dy / d) * CRUISE_TILES;
        live.row.grid_x = Math.round(live.fx); live.row.grid_y = Math.round(live.fy);
        live.row.heading = String(Math.round(bearingDeg(live.fx, live.fy, ch.tx, ch.ty)));
        const below = surfaceAt(live.row.grid_x, live.row.grid_y);
        if (Math.random() < 0.5) toOccupants(live, `<span class="text-dim">${below ? 'Below: ' + below.name + '.' : 'Open ground slides past below.'} ${Math.max(1, Math.round(d))} out.</span>`);
        pushHud(live);
      } else if (ch.phase === 'arrived') {
        if (!live.occupants.size || Date.now() >= ch.disembarkAt) await completeCharter(ch, live);
      }
    }
  } finally { ticking = false; }
}
setInterval(() => charterTick().catch(e => console.error('[flight/charter] tick error:', e.message)), CHARTER_TICK_MS);

async function arrive(ch, live) {
  ch.phase = 'arrived'; ch.disembarkAt = Date.now() + AUTO_DISEMBARK_MS;
  live.row.airborne = 0; live.row.altitude_band = 'ground'; live.row.throttle = 0; live.row.parked_zone_id = ch.destZone;
  await persist(live);
  pushHud(live);
  toOccupants(live, `<span class="text-green">${ch.pilotName} flares and sets you down. "Here we are — <b>${ch.destName}</b>. <b>disembark</b> when you're ready — I'm not waiting all day."</span>`);
  sendToZone(ch.destZone, { type: 'zone_event', message: `An aircraft settles onto the ground.`, refresh: true });
  log({ player: getLivePlayer(ch.playerId)?.handle || '?', pilot: ch.pilotName, from: ch.homeName, to: ch.destName, status: 'arrived' });
}

async function completeCharter(ch, live) {
  // Put out anyone still aboard at the destination.
  for (const pid of [...live.occupants]) {
    const p = getLivePlayer(pid);
    detach(p || { id: pid, aircraftId: ch.aircraftId });
    if (p) { p.current_zone = ch.destZone; getZone(ch.destZone)?.players.add(pid); out(pid, `<span class="text-dim">You climb down at ${ch.destName}. ${ch.pilotName} gives you a nod, lifts off, and turns back for ${ch.homeName}.</span>`); }
  }
  liveAircraft.delete(ch.aircraftId);
  activeCharters.delete(ch.aircraftId);
  await query('DELETE FROM aircraft WHERE id=$1', [ch.aircraftId]).catch(() => {});
  log({ player: getLivePlayer(ch.playerId)?.handle || '?', pilot: ch.pilotName, from: ch.homeName, to: ch.destName, status: 'delivered' });
}

async function cancelCharter(ch, msg) {
  const live = liveAircraft.get(ch.aircraftId);
  if (live) for (const pid of [...live.occupants]) { const p = getLivePlayer(pid); detach(p || { id: pid, aircraftId: ch.aircraftId }); if (p && msg) out(pid, `<span class="text-dim">${msg}</span>`); }
  liveAircraft.delete(ch.aircraftId);
  activeCharters.delete(ch.aircraftId);
  await query('DELETE FROM aircraft WHERE id=$1', [ch.aircraftId]).catch(() => {});
}

// ── Devpanel debug data ───────────────────────────────────────────────────────
export async function charterDebug() {
  const hour = nowHour();
  const pilots = getNpcsByFlag('charter_pilot').map(n => {
    const start = n.flags.charter_pilot.shift_start ?? 0;
    const field = getZone(n.flags.charter_pilot.field);
    const busy = pilotBusy(n.id);
    const status = busy ? `FLYING → ${busy.destName}`
      : inHangar(n) ? 'ON DUTY (in hangar)'
      : onShift(n) ? 'DUE IN' : 'OFF SHIFT (home)';
    return {
      name: n.name, field: field?.flags?.airfield_name || n.flags.charter_pilot.field,
      shift: `${String(start).padStart(2, '0')}00–${String((start + SHIFT_HOURS) % 24).padStart(2, '0')}00`,
      status,
    };
  });
  return { hour, pilots, log: flightLog.slice(0, 40) };
}

// True while a player is a non-controlling charter passenger.
export function isCharterPassenger(player) {
  return !!(player.aircraftId && activeCharters.has(player.aircraftId) && player.seat === 'passenger');
}

export const commands = { charter: cmdCharter, flyto: cmdFlyTo };
