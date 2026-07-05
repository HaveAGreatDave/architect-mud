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
  sendToZone, sendToPlayer, getLivePlayer, surfaceAt, setPosture, forceStand, bearingDeg, degToCardinal, effStats,
  fieldFor as fieldOf,
} from './state.js';

const CHARTER_MULT = 10;
const SHIFT_HOURS = 8;
const AUTO_DISEMBARK_MS = 20000;
const BOARD_TIMEOUT_MS = 120000; // the pilot waits this long on the ramp for you to embark
const CHARTER_TICK_MS = 2500;
const CRUISE_TILES = 2;          // tiles/tick the NPC covers
// The chair a pilot sits on inside the walk-in hangar. Must match the furniture
// `name` seeded by scripts/seed-hangar-interiors.js.
export const DESK_CHAIR = 'the flight-ops desk chair';

// Charter aircraft are ephemeral (they despawn on delivery). Clear any that a
// crash/restart orphaned in the table so we never board a pilotless ghost.
query("DELETE FROM aircraft WHERE (custom_data->>'charter')='true'").catch(() => {});

// aircraftId -> { typeId, class, pilotId, pilotName, playerId, homeField, homeName,
//   phase:'choosing'|'enroute'|'arrived', destZone, destName, fx, fy, tx, ty,
//   destOptions?, anyTile, disembarkAt }
export const activeCharters = new Map();
export const flightLog = [];     // { at, player, pilot, from, to, status }
function log(entry) { flightLog.unshift({ at: Date.now(), ...entry }); if (flightLog.length > 40) flightLog.length = 40; }

const nowHour = () => getEnvironmentState().hour ?? 0;

// ── Pilots ────────────────────────────────────────────────────────────────────
// A pilot is looked up by their ASSIGNED field (flags), not their current
// location — so we can tell you "closed, back at 0800" even while they're off at
// home or out on a run.
function pilotForField(fieldZoneId) {
  return getNpcsByFlag('charter_pilot').find(n => n.flags.charter_pilot.field === fieldZoneId) || null;
}
function onShift(pilot, hour = nowHour()) {
  return withinShift(pilot.flags.charter_pilot.shift_start, hour);
}

// ── Pure lifecycle cores (content-independent; unit-tested in regress.js) ──────
// Is `hour` inside an 8-hour shift starting at `shiftStart`? Wraps past midnight.
export function withinShift(shiftStart, hour, shiftHours = SHIFT_HOURS) {
  return ((hour - (shiftStart ?? 0) + 24) % 24) < shiftHours;
}
// Where a pilot belongs right now: away on a run → home; readying on the ramp
// (boarding/choosing) → the field tile with the aircraft; free & on-shift → the
// desk inside the walk-in hangar (or the field tile if none is built); else home.
export function pilotTarget({ busyPhase = null, onShift = false, interior = null, field, home }) {
  if (busyPhase) return (busyPhase === 'enroute' || busyPhase === 'returning') ? home : field;
  return onShift ? (interior || field) : home;
}
// One autoflight step from (fx,fy) toward (tx,ty); snaps to the target once within
// `cruise` tiles. Returns the new position, whether it arrived, and the distance.
export function stepToward(fx, fy, tx, ty, cruise) {
  const dx = tx - fx, dy = ty - fy, d = Math.hypot(dx, dy);
  if (d <= cruise || d === 0) return { arrived: true, fx: tx, fy: ty, d };
  return { arrived: false, fx: fx + (dx / d) * cruise, fy: fy + (dy / d) * cruise, d };
}
function shiftLabel(pilot) {
  const s = pilot.flags.charter_pilot.shift_start ?? 0;
  const p = (h) => String(h % 24).padStart(2, '0') + '00';
  return `${p(s)}–${p(s + SHIFT_HOURS)}`;
}
function pilotBusy(pilotId) { for (const c of activeCharters.values()) if (c.pilotId === pilotId) return c; return null; }
// The walk-in hangar interior for a pilot's field, if one has been built.
function hangarInteriorOf(cp) { return getZone(cp.field)?.flags?.hangar_interior_zone || null; }
// "At work" = out on a flight, OR present at their field — either sitting at the
// desk inside the walk-in hangar OR standing on the ramp tile itself.
function inHangar(pilot) {
  const cp = pilot.flags.charter_pilot;
  const interior = hangarInteriorOf(cp);
  return pilot.zone_id === cp.field || (!!interior && pilot.zone_id === interior);
}
function atWork(pilot) { return !!pilotBusy(pilot.id) || inHangar(pilot); }
function available(pilot) { return inHangar(pilot) && !pilotBusy(pilot.id); }

const pilotById = (id) => getNpcsByFlag('charter_pilot').find(n => n.id === id) || null;

// The pilot climbs aboard for the flight as a real occupant that rides along:
// pulled out of the world (no zone) and frozen from the AI (`_aboard`, honoured by
// the engine game loop) until they set the aircraft back down.
function boardPilot(live, pilot) {
  if (!pilot || pilot._aboard) return;
  live.occupants.add(pilot.id);
  pilot._aboard = live.row.id;
  getZone(pilot.zone_id)?.npcs.delete(pilot.id);
  pilot.zone_id = null;
  forceStand(pilot, 'charter.board');   // up out of the desk chair, into the cockpit
}
// The pilot gets out at `toZone` (the home field) and rejoins the world; syncPilots
// then walks them back to the hangar desk.
function disembarkPilot(pilot, toZone) {
  if (!pilot?._aboard) return;
  liveAircraft.get(pilot._aboard)?.occupants.delete(pilot.id);
  delete pilot._aboard;
  moveNpcToZone(pilot.id, toZone);
}

// ── Presence: clock pilots in/out of the hangar with their shift ──────────────
// On shift + free → sitting at the desk inside the walk-in hangar (falls back to
// the ramp tile if no interior is built). Boarding/choosing → out on the ramp with
// the readied aircraft. Out on a flight → away/home. Off shift + not flying → home.
// A flight that overruns the shift keeps them "at work" (flying) until they land;
// the next sync then sends them home (off the clock).
function syncPilots() {
  for (const pilot of getNpcsByFlag('charter_pilot')) {
    if (pilot._aboard) continue;   // riding along on a run — leave them in the cockpit
    const cp = pilot.flags.charter_pilot;
    const home = pilot.home_zone || 'zone_residential_lobby';
    const interior = hangarInteriorOf(cp);
    const busy = pilotBusy(pilot.id);
    const target = pilotTarget({ busyPhase: busy?.phase || null, onShift: onShift(pilot), interior, field: cp.field, home });
    if (target === interior) {
      // At the desk: relocate if needed, then make sure they're seated. (moveNpcToZone
      // never touches posture, so a pilot seeded straight into the interior still needs
      // the sit set here.)
      if (pilot.zone_id !== target) moveNpcToZone(pilot.id, target);
      if (pilot.posture !== 'sitting') setPosture(pilot, 'sitting', { sittingOn: DESK_CHAIR });
    } else if (pilot.zone_id !== target) {
      // Anywhere else (ramp / home): stand them up as they arrive so they never turn
      // up "sitting" on a chair that isn't there.
      moveNpcToZone(pilot.id, target);
      forceStand(pilot, 'charter.shift');
    }
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
export const charterCost = (t) => Math.max(200, Math.round((t.price_rent_hourly || 100) * CHARTER_MULT));

// ── charter ───────────────────────────────────────────────────────────────────
export async function cmdCharter(args, raw, player) {
  const field = fieldOf(player);
  if (!field || !field.flags.airfield_charter) return { type: 'emote', message: "There's no charter desk here." };
  if (player.aircraftId) return { type: 'emote', message: "You're already aboard something — disembark first." };

  const pilot = pilotForField(field.id);
  if (!pilot) return { type: 'emote', message: 'No charter pilot works out of this field.' };
  const busy = pilotBusy(pilot.id);
  if (busy) {
    if (busy.chartererId === player.id)
      return { type: 'emote', message: busy.phase === 'boarding'
        ? "You've already got a charter waiting on the ramp — <b>embark</b> it, or type <b>cancel</b> to call it off (no charge)."
        : "You're already booked on a charter. Type <b>cancel</b> if you've changed your mind." };
    if (busy.phase === 'boarding' || busy.phase === 'choosing')
      return { type: 'emote', message: `${pilot.name} is readying a charter for someone else — wait your turn.` };
    return { type: 'emote', message: `${pilot.name} is out on a run to ${busy.destName}. Wait for them to get back.` };
  }
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

  // Generate the chartered aircraft, parked on the ramp, and put the pilot in it.
  // You are NOT aboard yet — the pilot readies the machine and waves you to embark.
  const acId = `aircraft_charter_${randomUUID().slice(0, 10)}`;
  await query(
    `INSERT INTO aircraft (id,type_id,name,owner_id,map_id,grid_x,grid_y,altitude_band,heading,parked_zone_id,fuel,engine_temp,rental,custom_data)
     VALUES ($1,$2,$3,NULL,'map_world',$4,$5,'ground','0',$6,999,20,1,'{"charter":true}')`,
    [acId, t.id, `${pilot.name}'s ${t.name}`, field.grid_x, field.grid_y, field.id]
  );
  const live = await loadAircraft(acId);
  live.charter = true;

  const anyTile = t.id === 'ac_dragonfly';
  const ch = {
    aircraftId: acId, typeId: t.id, class: t.class, pilotId: pilot.id, pilotName: pilot.name,
    chartererId: player.id, playerId: null, paid: 0,
    homeField: field.id, homeName: field.flags.airfield_name || field.name,
    phase: 'boarding', anyTile, fx: field.grid_x, fy: field.grid_y,
    boardExpiry: Date.now() + BOARD_TIMEOUT_MS,
  };
  activeCharters.set(acId, ch);
  sendToZone(field.id, { type: 'zone_event', message: `${pilot.name} climbs into ${t.name} and runs the avionics up.`, refresh: true }, player.id);
  log({ player: player.handle, pilot: pilot.name, from: ch.homeName, to: '(awaiting)', status: 'boarding' });
  // If the player chartered from inside the walk-in hangar, the plane is out on the
  // ramp — send them out to embark.
  const inside = !!getZone(player.current_zone)?.flags?.hangar_interior;
  const embarkHint = inside
    ? `Step <b>out</b> to the ramp and <b>embark</b> when you're ready.`
    : `<b>embark</b> when you are and tell me where we're going.`;
  return { type: 'output', message: `<span class="text-green">${pilot.name} swings the <b>${t.name}</b> out onto the ramp, climbs into the cockpit, and leans out the hatch: "She's fuelled and ready — ${embarkHint}"</span>\n<span class="text-dim">She's held for you — no charge until takeoff. Back out any time for free: type <b>cancel</b>, or just walk away.</span>` };
}

// Is a chartered aircraft parked here waiting for its passenger to board?
export function charterParkedAt(zoneId) {
  for (const ch of activeCharters.values()) if (ch.phase === 'boarding' && ch.homeField === zoneId) return ch;
  return null;
}

// Board a waiting charter as a passenger. Gated on the pilot actually being in it —
// without the assigned pilot the aircraft is locked and unusable. Called by the
// engine's `embark`/`board` handler (index.cmdBoard).
export async function embarkCharter(player, ch) {
  const live = liveAircraft.get(ch.aircraftId);
  if (!live) { activeCharters.delete(ch.aircraftId); return { type: 'emote', message: 'That charter aircraft is gone.' }; }
  if (player.aircraftId) return { type: 'emote', message: "You're already aboard something — disembark first." };
  // Reserved: only the player who chartered it may board.
  if (ch.chartererId && ch.chartererId !== player.id)
    return { type: 'emote', message: `That charter is held for ${getLivePlayer(ch.chartererId)?.handle || 'someone else'} — the pilot waves you off. Type <b>charter</b> to book your own.` };

  // Lock: a charter aircraft is dead metal without its pilot aboard.
  const pilot = getNpcsByFlag('charter_pilot').find(n => n.id === ch.pilotId);
  if (!pilot || !inHangar(pilot))
    return { type: 'emote', message: `The ${live.type.name} is locked up tight and dark — ${ch.pilotName || 'the pilot'} isn't in it. Without a pilot, you're not taking it anywhere.` };

  live.occupants.add(player.id);
  player.aircraftId = ch.aircraftId;
  player.seat = 'passenger';
  ch.playerId = player.id;
  ch.phase = 'choosing';
  pushHud(live);
  sendToZone(ch.homeField, { type: 'zone_event', message: `${player.handle} climbs aboard ${ch.pilotName}'s ${live.type.name}.` }, player.id);

  if (ch.anyTile) {
    const tiles = getAllZones()
      .filter(z => z.map_id === 'map_world' && (z.grid_z == null || z.grid_z === 0) && z.grid_x != null)
      .map(z => ({ ...z, is_current: z.id === ch.homeField }));
    return { type: 'flight_pick_dest', message: `<span class="text-green">You settle into the cabin and pull the harness on. ${ch.pilotName}: "Anywhere you like — click a spot on the map, or name a place (<b>flyto &lt;place&gt;</b>)."</span>\n<span class="text-dim">Not charged until takeoff — <b>cancel</b> for free until then.</span>`, tiles };
  }
  const fields = await airfieldList(ch.homeField);
  ch.destOptions = fields;
  const lines = fields.map((f, i) => `  <b>[${i + 1}]</b> ${f.name} <span class="text-dim">(${f.dist} out)</span> · <span class="action-link" data-action="cmd" data-cmd="flyto ${i + 1}">go</span>`);
  return { type: 'output', message: `<span class="text-green">You settle into the cabin and pull the harness on. ${ch.pilotName}: "Where to?"</span>\n${lines.join('\n')}\nType <b>flyto &lt;n&gt;</b>. <span class="text-dim">Not charged until takeoff — <b>cancel</b> for free until then.</span>` };
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
  ch.paid = cost;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);

  const live = liveAircraft.get(ch.aircraftId);
  ch.destZone = dest.id; ch.destName = dest.flags?.airfield_name || dest.name;
  ch.tx = dest.grid_x; ch.ty = dest.grid_y;
  ch.phase = 'enroute';
  live.row.airborne = 1; live.row.altitude_band = 'low'; live.row.parked_zone_id = null; live.row.throttle = 75;
  live.row.heading = String(Math.round(bearingDeg(ch.fx, ch.fy, ch.tx, ch.ty)));
  live.fx = ch.fx; live.fy = ch.fy;
  // Passenger leaves the ground; the pilot climbs aboard and flies it.
  const p = getLivePlayer(player.id);
  if (p) { getZone(p.current_zone)?.players.delete(p.id); setPosture(p, 'flying'); }
  boardPilot(live, pilotById(ch.pilotId));
  await persist(live);
  pushHud(live);
  // The pilot flies it — and calls the actions out loud. Staggered so it reads
  // like a real departure (guarded: the charter may end before they fire).
  const say = (line) => { const l = liveAircraft.get(ch.aircraftId); if (l) toOccupants(l, `<span class="text-cyan">${ch.pilotName}: "${line}"</span>`); };
  say('Doors closed, avionics up. Sit back and enjoy the ride.');
  setTimeout(() => say('Throttle set — one hundred percent. Rolling.'), 1600);
  setTimeout(() => say('V1 &mdash; rotate. Positive rate, gear up.'), 3400);
  setTimeout(() => say(`Levelling off for ${ch.destName}. Straight line from here.`), 5200);
  sendToZone(ch.homeField, { type: 'zone_event', message: `${ch.pilotName} climbs into ${rows[0].name}, taxis out and lifts off — turning toward ${ch.destName} with ${player.handle} aboard.`, refresh: true }, player.id);
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

      // Waiting on the ramp for a passenger to board.
      if (ch.phase === 'boarding') {
        // The charterer walked off (or logged off) without boarding → free cancel.
        const charterer = getLivePlayer(ch.chartererId);
        if (!charterer || fieldOf(charterer)?.id !== ch.homeField) {
          out(ch.chartererId, '<span class="text-dim">You leave the charter behind — cancelled, no charge.</span>');
          sendToZone(ch.homeField, { type: 'zone_event', message: `${ch.pilotName} shuts the ${live.type.name} back down — the fare never showed.`, refresh: true });
          await cancelCharter(ch, null);
        } else if (Date.now() >= ch.boardExpiry) {
          out(ch.chartererId, '<span class="text-dim">The pilot gave up waiting — charter cancelled, no charge.</span>');
          sendToZone(ch.homeField, { type: 'zone_event', message: `${ch.pilotName} gives up waiting, shuts the ${live.type.name} down and climbs out.`, refresh: true });
          await cancelCharter(ch, null);
        }
        continue;
      }
      // Abandoned before choosing (passenger bailed on the ground) → scrub it.
      if (ch.phase === 'choosing') { if (!live.occupants.size) await cancelCharter(ch, null); continue; }

      if (ch.phase === 'enroute' || ch.phase === 'returning') {
        const silent = ch.phase === 'returning';   // deadhead home = no chatter
        const step = stepToward(live.fx, live.fy, ch.tx, ch.ty, CRUISE_TILES);
        live.fx = step.fx; live.fy = step.fy;
        if (step.arrived) {
          live.row.grid_x = ch.tx; live.row.grid_y = ch.ty;
          if (silent) { await finishReturn(ch, live); } else { await arrive(ch, live); }
          continue;
        }
        live.row.grid_x = Math.round(live.fx); live.row.grid_y = Math.round(live.fy);
        live.row.heading = String(Math.round(bearingDeg(live.fx, live.fy, ch.tx, ch.ty)));
        if (!silent) {
          const below = surfaceAt(live.row.grid_x, live.row.grid_y);
          if (Math.random() < 0.5) toOccupants(live, `<span class="text-dim">${below ? 'Below: ' + below.name + '.' : 'Open ground slides past below.'} ${Math.max(1, Math.round(step.d))} out.</span>`);
        }
        pushHud(live);
      } else if (ch.phase === 'arrived') {
        if (!live.occupants.size || Date.now() >= ch.disembarkAt) await dropoffReturn(ch, live);
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

// Drop the passenger at the destination, then deadhead the aircraft back to its
// home hangar (silently — the pilot flies the whole return leg unseen). The pilot
// stays "out" (busy) until the aircraft is home, then frees up.
async function dropoffReturn(ch, live) {
  for (const pid of [...live.occupants]) {
    if (pid === ch.pilotId) continue;   // the pilot flies the return leg — stays aboard
    const p = getLivePlayer(pid);
    detach(p || { id: pid, aircraftId: ch.aircraftId });
    if (p) { p.current_zone = ch.destZone; getZone(ch.destZone)?.players.add(pid); out(pid, `<span class="text-dim">You climb down at ${ch.destName}. ${ch.pilotName} gives you a nod and starts buttoning up to head back.</span>`); }
  }
  log({ player: getLivePlayer(ch.playerId)?.handle || '?', pilot: ch.pilotName, from: ch.homeName, to: ch.destName, status: 'delivered' });
  // Deadhead home.
  const home = getZone(ch.homeField);
  ch.phase = 'returning';
  ch.tx = home?.grid_x ?? live.row.grid_x; ch.ty = home?.grid_y ?? live.row.grid_y;
  live.fx = live.row.grid_x; live.fy = live.row.grid_y;
  live.row.airborne = 1; live.row.altitude_band = 'low'; live.row.parked_zone_id = null; live.row.throttle = 75;
  live.row.heading = String(Math.round(bearingDeg(live.fx, live.fy, ch.tx, ch.ty)));
  await persist(live);
}

async function finishReturn(ch, live) {
  disembarkPilot(pilotById(ch.pilotId), ch.homeField);   // pilot gets out at the home field
  liveAircraft.delete(ch.aircraftId);
  activeCharters.delete(ch.aircraftId);
  await query('DELETE FROM aircraft WHERE id=$1', [ch.aircraftId]).catch(() => {});
  sendToZone(ch.homeField, { type: 'zone_event', message: `${ch.pilotName}'s aircraft settles back onto the pad; ${ch.pilotName} climbs down and heads back inside.`, refresh: true });
}

async function cancelCharter(ch, msg) {
  const live = liveAircraft.get(ch.aircraftId);
  disembarkPilot(pilotById(ch.pilotId), ch.homeField);   // if they'd already boarded, get them out
  // Refund anything already taken (the fare is only charged at takeoff, so this is
  // normally 0 for a pre-flight cancel — but refund whatever was paid, to be safe).
  if (ch.paid > 0) {
    const payee = getLivePlayer(ch.playerId || ch.chartererId);
    if (payee) {
      payee.credits = (payee.credits || 0) + ch.paid;
      await query('UPDATE players SET credits=$1 WHERE id=$2', [payee.credits, payee.id]).catch(() => {});
      sendToPlayer(payee.id, { type: 'player_update', player: { credits: payee.credits } });
    }
    ch.paid = 0;
  }
  if (live) for (const pid of [...live.occupants]) { if (pid === ch.pilotId) continue; const p = getLivePlayer(pid); detach(p || { id: pid, aircraftId: ch.aircraftId }); if (p && msg) out(pid, `<span class="text-dim">${msg}</span>`); }
  liveAircraft.delete(ch.aircraftId);
  activeCharters.delete(ch.aircraftId);
  await query('DELETE FROM aircraft WHERE id=$1', [ch.aircraftId]).catch(() => {});
}

// `cancel` — back out of your own charter for free before takeoff, whether you're
// the charterer still waiting to board or the passenger who's boarded but not yet
// flown. Refunds anything taken (0 in the normal flow — the fare isn't charged
// until takeoff). Falls through when you've nothing of yours to cancel.
export async function cmdCancel(args, raw, player) {
  for (const ch of activeCharters.values()) {
    const asCharterer = ch.phase === 'boarding' && ch.chartererId === player.id;
    const asPassenger = ch.phase === 'choosing' && ch.playerId === player.id;
    if (!asCharterer && !asPassenger) continue;
    const refund = ch.paid || 0;
    const name = ch.pilotName;
    await cancelCharter(ch, null);
    return {
      type: 'emote',
      message: refund > 0
        ? `Charter called off — <b>${refund}c</b> refunded. No harm done.`
        : `Charter called off — no charge. ${name} shrugs and shuts it down.`,
      ...(refund > 0 ? { player_update: { credits: player.credits } } : {}),
    };
  }
  return undefined;   // nothing of yours to cancel → let another handler take `cancel`
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

export const commands = { charter: cmdCharter, flyto: cmdFlyTo, cancel: cmdCancel };
