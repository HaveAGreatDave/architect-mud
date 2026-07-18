/**
 * Elevator plugin.
 *
 * A building can hoist its floors onto separate z-levels and connect them with a
 * single elevator car instead of a stairwell hub. The car is an ordinary interior
 * zone carrying two flags:
 *
 *   flags.elevator        = true
 *   flags.elevator_floors = [ { n: 54, zone: "zone_...", label: "Executive Suite" }, ... ]
 *
 * `n` is the DISPLAY floor number the panel shows and the player types (`floor 54`);
 * it is deliberately decoupled from the destination zone's real grid_z — that's how
 * a tower reads as "Floor 54" while only using a handful of actual z-levels.
 *
 * Two surfaces:
 *   - `floor <n>` (command) — while standing in the car, rides to that floor's zone
 *     (a flavoured teleport, mirroring the engine TELEPORT action). Bare `floor`
 *     reprints the directory.
 *   - `zone.describeRoom` hook — renders the clickable floor directory into the car's
 *     room description, so LOOK always shows the buttons.
 *
 * The car still needs real up-exits to each floor for graph connectivity (NPC
 * pathfinding, the zone-connectivity validator) — the content wires those; this
 * plugin only adds the numbered, teleporting convenience layer on top.
 */
import { getZone, getMinimapData, addPlayerToZone, removePlayerFromZone, getAllLivePlayers } from '../../server/engine/world.js';
import { describeZone } from '../../server/engine/commands/describe.js';
import { emit, on } from '../../server/engine/events.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { query } from '../../server/models/db.js';

const sys = (s) => `<span class="msg-system">${s}</span>`;

// The car nominally rests at the lobby — call that Floor 1 for counter purposes.
const GROUND_FLOOR = 1;

// A ride shouldn't be instant, but it also shouldn't feel like a loading screen.
// Time scales with how far the car climbs: a quick hop to the gym, a long haul to
// the penthouse. Clamped so nothing feels broken at either extreme.
function travelMs(targetN) {
  const floors = Math.abs(targetN - GROUND_FLOOR);
  return Math.min(5000, Math.max(1600, 900 + floors * 95));
}

// Floor list off a zone, cleaned + sorted top-to-bottom (highest floor first, the
// way a real elevator panel reads). Tolerates a missing/garbled flag.
function floorsOf(zone) {
  const raw = zone?.flags?.elevator_floors;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f) => f && f.zone && Number.isFinite(Number(f.n)))
    .map((f) => ({ n: Number(f.n), zone: f.zone, label: f.label || getZone(f.zone)?.name || f.zone }))
    .sort((a, b) => b.n - a.n);
}

function isElevator(zone) {
  return !!zone?.flags?.elevator;
}

// The clickable floor directory. Each button sends `floor <n>` verbatim.
function buildPanel(floors) {
  if (!floors.length) return '';
  const lines = floors.map(
    (f) => `  <span class="action-link" data-raw-cmd="floor ${f.n}" data-label="floor ${f.n}">[${String(f.n).padStart(2, ' ')}]</span> ${f.label}`
  );
  return [
    '<span class="accent">▣ FLOOR SELECT</span> — say <b>floor &lt;number&gt;</b> or tap a button:',
    ...lines,
  ].join('\n');
}

// zone.describeRoom hook — appends the directory when the room is an elevator car.
function describeRoom(zone) {
  if (!isElevator(zone)) return;
  return buildPanel(floorsOf(zone));
}

// Tear down an in-progress ride's timers. Safe to call twice.
function clearRide(player) {
  if (!player?._elevator) return;
  for (const t of player._elevator.timers) clearTimeout(t);
  player._elevator = null;
}

// The doors have closed and the car is climbing — the player is committed. When the
// timer fires we perform the real move (occupancy sets, DB, zone.entered), mirroring
// the engine TELEPORT action's bookkeeping so every system that reacts stays
// consistent, then push the room to the rider's socket.
async function arrive(player, ride) {
  // A manual step-out, death, or logout cancels the ride and nulls _elevator; if
  // anything moved the player off the car mid-flight, don't yank them back.
  if (player._elevator !== ride || player.current_zone !== ride.carZone) return;
  const { floor } = ride;
  const target = getZone(floor.zone);
  player._elevator = null;

  if (!target) {
    sendToPlayer(player.id, { type: 'error', message: 'The car shudders to a halt — that floor is out of service. The doors reopen on where you started.' });
    return;
  }

  const from = ride.carZone;
  removePlayerFromZone(player.id, from);
  sendToZone(from, { type: 'zone_event', message: `The elevator doors seal and the car carries ${player.handle} away.`, refresh: true }, player.id);

  addPlayerToZone(player.id, floor.zone);
  player.current_zone = floor.zone;
  player.combatTargetId = null;
  await query('UPDATE players SET current_zone=$1 WHERE id=$2', [floor.zone, player.id]);

  sendToZone(floor.zone, { type: 'zone_event', message: `The elevator chimes and ${player.handle} steps out onto Floor ${floor.n}.`, refresh: true }, player.id);
  emit('zone.entered', { actor: player, zone: floor.zone, from });

  sendToPlayer(player.id, {
    type: 'move',
    message: await describeZone(target, player),
    zone: floor.zone,
    narration: `<span class="msg-system">▣</span> A soft chime. The doors part on <b>Floor ${floor.n}</b> — ${target.name}.`,
    minimap: getMinimapData(floor.zone, 8, player),
  });
}

// Seal the doors and start the car moving. Returns an immediate "doors closing"
// acknowledgement; the counter climbs on a timer and arrival lands later.
function board(player, floor) {
  const carZone = player.current_zone;
  const dur = travelMs(floor.n);
  const rising = floor.n >= GROUND_FLOOR;
  const ride = { floor, carZone, timers: [] };

  // Two intermediate counter ticks — the floor number sliding by behind the doors.
  const ticks = [0.42, 0.76];
  ticks.forEach((frac) => {
    const passing = Math.round(GROUND_FLOOR + (floor.n - GROUND_FLOOR) * frac);
    ride.timers.push(setTimeout(() => {
      if (player._elevator === ride) sendToPlayer(player.id, { type: 'output', message: sys(`      ${rising ? '▲' : '▼'} ${passing}`) });
    }, Math.round(dur * frac)));
  });
  ride.timers.push(setTimeout(() => { arrive(player, ride).catch(() => {}); }, dur));

  player._elevator = ride;
  return {
    type: 'output',
    message: sys(`The doors glide shut. The car ${rising ? 'rises' : 'descends'} toward <b>Floor ${floor.n}</b>${floor.label ? ` — ${floor.label}` : ''}…`),
  };
}

async function cmdFloor(args, raw, player, broadcast) {
  const zone = getZone(player.current_zone);
  if (!isElevator(zone)) {
    return { type: 'error', message: "There's no elevator here. Find one and step inside first." };
  }
  const floors = floorsOf(zone);
  if (!floors.length) {
    return { type: 'error', message: 'The floor panel is dark — this elevator goes nowhere.' };
  }
  if (player._elevator) {
    return { type: 'error', message: 'The car is already moving. Wait for it to settle.' };
  }

  const arg = (args[0] || '').trim();
  if (!arg) {
    return { type: 'output', message: buildPanel(floors) };
  }

  const n = Number(arg.replace(/[^\d-]/g, ''));
  const floor = floors.find((f) => f.n === n);
  if (!floor) {
    const valid = floors.map((f) => f.n).join(', ');
    return { type: 'error', message: `No Floor ${arg} on this panel. Try: ${valid}.` };
  }
  if (floor.zone === player.current_zone) {
    return { type: 'error', message: `You're already at the elevator on Floor ${floor.n}.` };
  }
  return board(player, floor);
}

// A ride is fragile in-flight: if the player forces their way out of the car,
// dies, or drops, drop the pending arrival so the timer can't teleport a corpse
// (or a logged-out ghost) across town. zone.entered fires on any move including
// the elevator's own arrival, so only cancel when they're no longer in the car.
on('zone.entered', ({ actor }) => { if (actor?._elevator && actor.current_zone !== actor._elevator.carZone) clearRide(actor); });
on('player.death',  ({ player }) => clearRide(player));
on('player.logout', ({ id })     => clearRide(getAllLivePlayers().find(p => p.id === id)));

export const hooks = {
  'zone.describeRoom': describeRoom,
};

export const commands = {
  floor: cmdFloor,
};

export const _test = { floorsOf, buildPanel, isElevator, describeRoom };

console.log('[elevator] Plugin loaded.');
