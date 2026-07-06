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
import { getZone, getMinimapData, addPlayerToZone, removePlayerFromZone } from '../../server/engine/world.js';
import { describeZone } from '../../server/engine/commands/describe.js';
import { emit } from '../../server/engine/events.js';
import { query } from '../../server/models/db.js';

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

// Move the player out of the car and into the chosen floor, with elevator flavour.
// Mirrors the engine TELEPORT action's bookkeeping (occupancy sets, DB, zone.entered)
// so every system that reacts to a move stays consistent.
async function ride(player, floor, broadcast) {
  const from = player.current_zone;
  const target = getZone(floor.zone);
  if (!target) return { type: 'error', message: 'That floor is out of service.' };

  removePlayerFromZone(player.id, from);
  broadcast(from, { type: 'zone_event', message: `The elevator doors slide shut, taking ${player.handle} away.`, refresh: true }, player.id);

  addPlayerToZone(player.id, floor.zone);
  player.current_zone = floor.zone;
  player.combatTargetId = null;
  await query('UPDATE players SET current_zone=$1 WHERE id=$2', [floor.zone, player.id]);

  broadcast(floor.zone, { type: 'zone_event', message: `The elevator chimes and ${player.handle} steps out onto Floor ${floor.n}.`, refresh: true }, player.id);
  emit('zone.entered', { actor: player, zone: floor.zone, from });

  return {
    type: 'move',
    message: await describeZone(target, player),
    zone: floor.zone,
    narration: `→ The elevator hums to Floor ${floor.n}. The doors open on ${target.name}.`,
    minimap: getMinimapData(floor.zone),
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
  return ride(player, floor, broadcast);
}

export const hooks = {
  'zone.describeRoom': describeRoom,
};

export const commands = {
  floor: cmdFloor,
};

export const _test = { floorsOf, buildPanel, isElevator, describeRoom };

console.log('[elevator] Plugin loaded.');
