// Flight — NPC-pilot charters. Instead of renting a plane you fly yourself, a
// charter is a *ride*: an on-duty charter pilot (a `charter_pilot` NPC stationed
// at a hangar) flies you, as a passenger, to a destination of your choice. The
// pilot does everything — takeoff, routing, obstacle avoidance, landing; you have
// no controls. On arrival they set you down and tell you to disembark; if you
// don't within 20s they put you out anyway and turn back for base.
//
// Flow (all from inside the hangar): `charter` lists rides → `charter <ride>` picks
// a destination (airfield list, or a map-click "anywhere" for the VTOL Dragonfly) →
// `charter <ride> <dest>` books it: the pilot taxis the machine up to the hangar
// door, fuelled and bound for your destination, and waits. `embark` is the trigger
// — fare's charged, doors close, she taxis out, rolls and rotates (the departing→
// enroute beat in the tick), and flies you there. `cancel` backs out free until you
// embark.
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
  fieldFor as fieldOf, inHangarInterior,
} from './state.js';

const CHARTER_MULT = 10;
const SHIFT_HOURS = 8;
const AUTO_DISEMBARK_MS = 20000;
const BOARD_TIMEOUT_MS = 120000; // the pilot waits this long at the hangar for you to embark
const TAXI_MS = 4500;            // taxi-out beat between embark and rotate (the "rolls, rotates" moment)
const CHARTER_TICK_MS = 2500;
// Tiles/tick the NPC covers. The world map is small (~11 tiles between the farthest
// fields), so a "realistic" cruise speed used to cover it in 2-3 ticks — takeoff,
// one glimpse of sky, landing, all inside ~10s. Charters are a scenic ride, not a
// teleport: this is deliberately slow (~0.12 tiles/sec) so even the shortest hop
// between adjacent fields runs a proper couple of dozen seconds of narrated flight.
const CRUISE_TILES = 0.3;
const CHARTER_ALT = 480;         // nominal 'low'-band cruise height for the synthesized attitude
// The chair a pilot sits on inside the walk-in hangar. Must match the furniture
// `name` seeded by scripts/seed-hangar-interiors.js.
export const DESK_CHAIR = 'the flight-ops desk chair';

// Charter aircraft are ephemeral (they despawn on delivery). Clear any that a
// crash/restart orphaned in the table so we never board a pilotless ghost.
query("DELETE FROM aircraft WHERE (custom_data->>'charter')='true'").catch(() => {});

// aircraftId -> { typeId, class, pilotId, pilotName, chartererId, playerId, homeField,
//   homeName, phase:'boarding'|'departing'|'enroute'|'arrived'|'returning',
//   destZone, destName, fx, fy, tx, ty, anyTile, fare, paid, boardExpiry, rollAt,
//   disembarkAt }
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
  // The charter desk (and the pilot) are INSIDE the hangar — book it there, not on the ramp.
  if (field.flags.hangar_interior_zone && !inHangarInterior(player))
    return { type: 'emote', message: 'The charter desk is inside the hangar — step <b>in</b> off the ramp to book a flight.' };
  if (player.aircraftId) return { type: 'emote', message: "You're already aboard something — disembark first." };

  const pilot = pilotForField(field.id);
  if (!pilot) return { type: 'emote', message: 'No charter pilot works out of this field.' };
  const busy = pilotBusy(pilot.id);
  if (busy) {
    if (busy.chartererId === player.id)
      return { type: 'emote', message: busy.phase === 'boarding'
        ? "Your charter's already fuelled and waiting at the hangar — <b>embark</b> to go, or <b>cancel</b> to call it off (no charge)."
        : "You're already booked on a charter. Type <b>cancel</b> if you've changed your mind." };
    if (busy.phase === 'boarding' || busy.phase === 'departing')
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
  const anyTile = t.id === 'ac_dragonfly';

  // Destination is chosen up front, at the desk. No destination yet → offer the list
  // (or the "anywhere" map-picker for the VTOL Dragonfly); the choice re-invokes this
  // command as `charter <ride> <dest>`.
  const destArg = args.slice(1);
  if (!destArg.length) {
    if (anyTile) {
      const tiles = getAllZones()
        .filter(z => z.map_id === 'map_world' && (z.grid_z == null || z.grid_z === 0) && z.grid_x != null)
        .map(z => ({ ...z, is_current: z.id === field.id }));
      return { type: 'flight_pick_dest', cmd: `charter ${t.id}`, tiles,
        message: `<span class="text-green">${pilot.name}: "The ${t.name}'ll set you down anywhere. Click a spot on the map, or name a place — <b>charter ${t.id} &lt;place&gt;</b>."</span>` };
    }
    const fields = await airfieldList(field.id);
    if (!fields.length) return { type: 'emote', message: `${pilot.name}: "Nowhere else to fly you from here right now."` };
    const lines = fields.map((f, i) => `  <b>[${i + 1}]</b> ${f.name} <span class="text-dim">(${f.dist} out)</span> · <span class="action-link" data-action="cmd" data-cmd="charter ${t.id} ${i + 1}">go</span>`);
    return { type: 'output', message: `<span class="text-green">${pilot.name}: "Where to in the ${t.name}?"</span>\n${lines.join('\n')}\nType <b>charter ${t.id} &lt;n&gt;</b>. <span class="text-dim">${charterCost(t)}c, charged when you embark.</span>` };
  }

  const { dest, err } = await resolveDest(field, anyTile, destArg);
  if (err) return err;

  // Book it: generate the chartered aircraft (staged on the ramp, narratively taxied
  // up to the hangar door), pilot in it, bound for the chosen destination. You are NOT
  // aboard yet and NOT charged yet — `embark` is the trigger for both.
  const acId = `aircraft_charter_${randomUUID().slice(0, 10)}`;
  await query(
    `INSERT INTO aircraft (id,type_id,name,owner_id,map_id,grid_x,grid_y,altitude_band,heading,parked_zone_id,fuel,engine_temp,rental,custom_data)
     VALUES ($1,$2,$3,NULL,'map_world',$4,$5,'ground','0',$6,999,20,1,'{"charter":true}')`,
    [acId, t.id, `${pilot.name}'s ${t.name}`, field.grid_x, field.grid_y, field.id]
  );
  const live = await loadAircraft(acId);
  live.charter = true;

  const destName = dest.flags?.airfield_name || dest.name;
  const ch = {
    aircraftId: acId, typeId: t.id, class: t.class, pilotId: pilot.id, pilotName: pilot.name,
    chartererId: player.id, playerId: null, paid: 0, fare: charterCost(t),
    homeField: field.id, homeName: field.flags.airfield_name || field.name,
    phase: 'boarding', anyTile, fx: field.grid_x, fy: field.grid_y,
    destZone: dest.id, destName, tx: dest.grid_x, ty: dest.grid_y,
    boardExpiry: Date.now() + BOARD_TIMEOUT_MS,
  };
  activeCharters.set(acId, ch);
  sendToZone(field.id, { type: 'zone_event', message: `${pilot.name} runs ${t.name} up and taxis it over to the hangar.`, refresh: true }, player.id);
  log({ player: player.handle, pilot: pilot.name, from: ch.homeName, to: destName, status: 'boarding' });
  return { type: 'output', message: `<span class="text-green">${pilot.name} taxis the <b>${t.name}</b> up to the hangar door, fuelled and bound for <b>${destName}</b>, and leans out the hatch: "Climb aboard when you're set — <b>embark</b> and we'll roll."</span>\n<span class="text-dim">${ch.fare}c, charged when you embark. Back out free until then: <b>cancel</b>, or just walk away.</span>` };
}

// Resolve a destination argument at booking time. Non-VTOL rides land only at
// airfields (pick by list index, id, or name); the Dragonfly takes any map tile
// (a "x y" from the map click, or a zone id/name).
async function resolveDest(field, anyTile, args) {
  const a0 = (args[0] || '');
  let dest = null;
  if (!anyTile) {
    const fields = await airfieldList(field.id);
    if (/^\d+$/.test(a0)) { const f = fields[parseInt(a0, 10) - 1]; dest = f ? getZone(f.id) : null; }
    else { const key = args.join(' ').toLowerCase(); const m = fields.find(f => f.id.toLowerCase() === a0.toLowerCase() || f.name.toLowerCase() === key || f.name.toLowerCase().includes(key)); dest = m ? getZone(m.id) : null; }
  } else if (/^-?\d+$/.test(a0) && /^-?\d+$/.test(args[1] || '')) {
    const cell = surfaceAt(parseInt(a0, 10), parseInt(args[1], 10));
    dest = cell ? getZone(cell.id) : null;
  } else {
    const key = args.join(' ').toLowerCase();
    dest = getZone(a0) || getAllZones().find(z => z.map_id === 'map_world' && z.grid_x != null && (z.name || '').toLowerCase() === key) || null;
  }
  if (!dest || dest.map_id !== 'map_world' || dest.grid_x == null) return { err: { type: 'emote', message: "That's not a place they can set down. Pick another." } };
  if (dest.id === field.id) return { err: { type: 'emote', message: "You're already here." } };
  if (!anyTile && !dest.flags?.airfield_id) return { err: { type: 'emote', message: 'That aircraft needs a proper airfield to land. Pick an airfield.' } };
  return { dest };
}

// Is a chartered aircraft parked here waiting for its passenger to board?
export function charterParkedAt(zoneId) {
  for (const ch of activeCharters.values()) if (ch.phase === 'boarding' && ch.homeField === zoneId) return ch;
  return null;
}

// Board a waiting charter — and GO. The destination is already set (chosen at the
// desk), so embarking IS the departure: the fare is charged here, the pilot climbs
// in, doors close, and she taxis out to roll (the departing→enroute beat fires in the
// tick after TAXI_MS). Gated on the pilot actually being in it — without the assigned
// pilot the aircraft is locked. Called by the engine's `embark`/`board` handler.
export async function embarkCharter(player, ch) {
  const live = liveAircraft.get(ch.aircraftId);
  if (!live) { activeCharters.delete(ch.aircraftId); return { type: 'emote', message: 'That charter aircraft is gone.' }; }
  if (player.aircraftId) return { type: 'emote', message: "You're already aboard something — disembark first." };
  if (ch.phase !== 'boarding') return { type: 'emote', message: `${ch.pilotName}'s charter is already underway.` };
  // Reserved: only the player who chartered it may board.
  if (ch.chartererId && ch.chartererId !== player.id)
    return { type: 'emote', message: `That charter is held for ${getLivePlayer(ch.chartererId)?.handle || 'someone else'} — the pilot waves you off. Type <b>charter</b> to book your own.` };

  // Lock: a charter aircraft is dead metal without its pilot aboard.
  const pilot = getNpcsByFlag('charter_pilot').find(n => n.id === ch.pilotId);
  if (!pilot || !inHangar(pilot))
    return { type: 'emote', message: `The ${live.type.name} is locked up tight and dark — ${ch.pilotName || 'the pilot'} isn't in it. Without a pilot, you're not taking it anywhere.` };

  // Fare is due now — this is the takeoff commit.
  const cost = ch.fare ?? 200;
  if ((player.credits || 0) < cost)
    return { type: 'emote', message: `That run to ${ch.destName} is <b>${cost}c</b> — you're short. ${ch.pilotName} won't roll without the fare (type <b>cancel</b> to call it off).` };
  player.credits -= cost;
  ch.paid = cost;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);

  // Aboard as passenger; the pilot climbs in. She stays on the ground taxiing until
  // the tick rotates her at ch.rollAt.
  live.occupants.add(player.id);
  player.aircraftId = ch.aircraftId;
  player.seat = 'passenger';
  ch.playerId = player.id;
  ch.phase = 'departing';
  ch.rollAt = Date.now() + TAXI_MS;
  live.row.throttle = 15; live.row.airborne = 0; live.row.altitude_band = 'ground';
  live.row.heading = String(Math.round(bearingDeg(ch.fx, ch.fy, ch.tx, ch.ty)));
  live.fx = ch.fx; live.fy = ch.fy; live.cont = null;
  const p = getLivePlayer(player.id);
  if (p) { getZone(p.current_zone)?.players.delete(p.id); setPosture(p, 'flying'); }
  boardPilot(live, pilot);
  await persist(live);
  pushHud(live);
  toOccupants(live, `<span class="text-green">You climb into the cabin and pull the harness on. ${ch.pilotName}: "Doors closed, avionics up — cleared to taxi. Sit back, ${ch.destName} coming up."</span>`);
  sendToZone(ch.homeField, { type: 'zone_event', message: `${ch.pilotName}'s ${live.type.name} taxis out of the hangar toward the active, ${player.handle} aboard.`, refresh: true }, player.id);
  log({ player: player.handle, pilot: ch.pilotName, from: ch.homeName, to: ch.destName, status: 'departing' });
  return { type: 'noop', player_update: { credits: player.credits } };
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

// Synthesize the continuous attitude (live.cont) the new flight model reads, so a
// charter — flown by the coarse autopilot, not a client sim — shows real height,
// speed and attitude on other pilots' air-to-air displays instead of sitting at
// ground level, wings-level. Bank eases out of how hard this leg is turning (a
// straight leg flies wings-level). Altitude ramps: nose-up climb-out off the field,
// hold cruise, nose-down sink on short final — with vs/pitch following the ramp.
// `remaining` is tiles to the destination (Infinity right after takeoff). Seed a
// leg with live._contAlt = 0 so it climbs from the deck. Call each airborne tick.
function chaseCont(live, remaining = Infinity) {
  const hdg = Number(live.row.heading) || 0;
  const prevHdg = live._contHdg ?? hdg;
  const turn = ((hdg - prevHdg + 540) % 360) - 180;   // signed shortest-arc turn since last tick
  live._contHdg = hdg;

  // Altitude ramp: climb toward cruise, sink to the deck once on short final.
  const targetAlt = remaining <= 5 ? 0 : CHARTER_ALT;
  const prevAlt = live._contAlt ?? 0;
  const STEP = 140;   // ft of altitude change per tick
  const alt = prevAlt < targetAlt ? Math.min(targetAlt, prevAlt + STEP)
            : prevAlt > targetAlt ? Math.max(targetAlt, prevAlt - STEP) : targetAlt;
  const dAlt = alt - prevAlt;
  live._contAlt = alt;
  const vs = Math.max(-2000, Math.min(2000, Math.round(dAlt * (60 / (CHARTER_TICK_MS / 1000)))));

  const cruise = effStats(live).cruise || 3;
  live.cont = {
    altitude: alt,
    airspeed: Math.round(cruise * (live.row.throttle / 100) * 84),
    vs,
    pitch: dAlt > 5 ? 7 : dAlt < -5 ? -5 : 0,
    bank: Math.max(-25, Math.min(25, turn * 1.5)),
    onGround: false, stalled: false,
  };
}

// Idle small-talk the charter pilot makes to their passenger on the cruise. A mix of
// canned patter and a few lines read off the actual flight — the weather, the hour,
// where you're headed, what's crawling past below — so a ride feels like a ride with a
// real, faintly worn-down human at the yoke. Returns a line; avoids the last one back-to-back.
const PILOT_PATTER = [
  "She flies straight enough, long as you don't ask too much of her.",
  "Twelve years on this run. Could fly it with my eyes shut. Some days I do.",
  "In-flight service is in the seat pocket. It's a warm can. That's the service.",
  "Don't mind the rattle. She's rattled the whole time I've owned her.",
  "Quiet up here — that's the thing about it. Down there it's never quiet.",
  "I don't ask what's in the bags, you don't tell me. That's how we stay friends.",
  "Insurance on this bird lapsed around the same time yours probably did.",
  "You'd be amazed what folks leave in the back. Or maybe you wouldn't.",
  "Harness stays on. Not for the bumps — for the part where I have to lose somebody.",
];

function pilotChatter(ch, live, below) {
  const pool = [...PILOT_PATTER];
  try {
    const env = getEnvironmentState();
    const w = (env.currentWeatherType || env.weatherType || '').toLowerCase();
    const h = env.hour ?? 12;
    if (/rain|storm|acid/.test(w)) pool.push("Weather's turning. Nothing this bird hasn't flown through uglier.");
    if (/ash|smoke|fog|haze/.test(w)) pool.push("Can't see a damn thing out there. Good news is, neither can anyone aiming up at us.");
    if (h >= 21 || h < 5) pool.push("Nice at night, isn't it? Dark hides how bad it all got.");
    else pool.push("Clear enough today. Can almost see all the way to somewhere better.");
  } catch {}
  if (below?.name) pool.push(`That's ${below.name} sliding past under us. Wouldn't set down there for money. Well — not for this money.`);
  if (ch.destName) pool.push(`${ch.destName}, you said. Bold. None of my business.`);
  let i = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && pool[i] === ch._lastChat) i = (i + 1) % pool.length;
  ch._lastChat = pool[i];
  return pool[i];
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

      // Staged at the hangar, waiting for the charterer to embark.
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
      // Taxiing out after embark — hold on the ground until rollAt, then rotate away.
      if (ch.phase === 'departing') {
        if (Date.now() < ch.rollAt) { pushHud(live); continue; }
        ch.phase = 'enroute';
        live.row.airborne = 1; live.row.altitude_band = 'low'; live.row.parked_zone_id = null; live.row.throttle = 75;
        live.fx = ch.fx; live.fy = ch.fy;
        live.row.heading = String(Math.round(bearingDeg(ch.fx, ch.fy, ch.tx, ch.ty)));
        delete live._contHdg; live._contAlt = 0; chaseCont(live);   // climb out from the deck, wings-level off the mark
        await persist(live);
        pushHud(live);
        toOccupants(live, `<span class="text-cyan">${ch.pilotName}: "Throttle up — rolling. V1, rotate. Positive rate, gear up. Straight line to ${ch.destName}."</span>`);
        sendToZone(ch.homeField, { type: 'zone_event', message: `${ch.pilotName}'s ${live.type.name} rolls down the strip, rotates and climbs away toward ${ch.destName}.`, refresh: true });
        log({ player: getLivePlayer(ch.playerId)?.handle || '?', pilot: ch.pilotName, from: ch.homeName, to: ch.destName, status: 'en route' });
        continue;
      }

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
        chaseCont(live, step.d);   // keep the air-to-air attitude in step with the leg (sink on short final)
        if (!silent) {
          const below = surfaceAt(live.row.grid_x, live.row.grid_y);
          const roll = Math.random();
          if (roll < 0.34) toOccupants(live, `<span class="text-cyan">${ch.pilotName}: "${pilotChatter(ch, live, below)}"</span>`);
          else if (roll < 0.68) toOccupants(live, `<span class="text-dim">${below ? 'Below: ' + below.name + '.' : 'Open ground slides past below.'} ${Math.max(1, Math.round(step.d))} out.</span>`);
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
  live.cont = null;   // down — no airborne attitude to relay to other pilots
  // Land the PASSENGER's location the moment wheels touch down — mirrors what
  // parkAt() does for a self-flown landing. `disembark` is then just the "climb out
  // of the parked aircraft" flavour text; without this the player's current_zone
  // stayed pinned at the home field until the 20s auto-eject timeout caught up.
  for (const pid of live.occupants) {
    if (pid === ch.pilotId) continue;
    const p = getLivePlayer(pid);
    if (!p) continue;
    if (p.posture === 'flying') forceStand(p, 'charter.arrive');
    p.current_zone = ch.destZone;
    getZone(ch.destZone)?.players.add(pid);
  }
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
  delete live._contHdg; live._contAlt = 0; chaseCont(live);   // deadhead leg: climb out from the deck
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

// `cancel` — back out of your own charter for free before you embark (the fare isn't
// charged until then). Once you've embarked she's rolling, so there's nothing to
// cancel. Falls through when you've nothing of yours to cancel.
export async function cmdCancel(args, raw, player) {
  for (const ch of activeCharters.values()) {
    if (!(ch.phase === 'boarding' && ch.chartererId === player.id)) continue;
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

export const commands = { charter: cmdCharter, cancel: cmdCancel };
