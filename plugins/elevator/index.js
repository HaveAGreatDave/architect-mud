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
 * Riding does NOT move you. `floor <n>` sends the car; when it settles you are
 * still in the car with the doors standing open on that floor (remembered per
 * rider in `_elevatorAt`), and `out` is the step onto it. That's what a real lift
 * feels like, and it's why `out` lights up on the d-pad: the panel renders a real
 * `exit-link` for the open doors, which the client reads to highlight the button.
 *
 * Two surfaces:
 *   - `floor <n>` (command) — while standing in the car, sends the car to that
 *     floor. Bare `floor` reprints the directory.
 *   - `zone.describeRoom` hook — renders the clickable floor directory into the car's
 *     room description, so LOOK always shows the buttons.
 *
 * The car still needs real up-exits to each floor for graph connectivity (NPC
 * pathfinding, the zone-connectivity validator) — the content wires those; this
 * plugin only adds the numbered, teleporting convenience layer on top.
 */
import { getZone, getMinimapData, addPlayerToZone, removePlayerFromZone, getAllLivePlayers } from '../../server/engine/world.js';
import { exitTargets, allExits } from '../../server/engine/exits.js';
import { cmdMove } from '../../server/engine/commands/movement.js';
import { runMoveGates } from '../../server/engine/movement-gates.js';
import { describeZone } from '../../server/engine/commands/describe.js';
import { emit, on } from '../../server/engine/events.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { registerInputMatcher } from '../../server/engine/plugins.js';
import { query } from '../../server/models/db.js';

const sys = (s) => `<span class="msg-system">${s}</span>`;

// The arrival chime — the classic two-note elevator "bing-bong" (a descending
// major third, E5→C5), played to the rider's own socket when the doors open on
// their floor. A self-contained synth def (like the audio plugin's inline vat /
// ghost cues), so it needs no DB row: the client's `audio_sfx` handler feeds it
// straight to AudioEngine.playSfx.
const SFX_ELEVATOR_CHIME = {
  id: 'sfx_elevator_chime', name: 'sfx_elevator_chime', category: 'sfx', priority: 6,
  config: {
    duration: 1.1,
    layers: [
      // "bing" — E5, with a soft octave shimmer on top.
      { waveform: 'sine', freq: 659.25, adsr: { a: 0.004, d: 0.18, s: 0.25, r: 0.5 }, gain: 0.5 },
      { waveform: 'triangle', freq: 1318.5, adsr: { a: 0.003, d: 0.12, s: 0.1, r: 0.4 }, gain: 0.12 },
      // "bong" — C5, a beat later.
      { waveform: 'sine', freq: 523.25, delay: 0.3, adsr: { a: 0.004, d: 0.2, s: 0.3, r: 0.6 }, gain: 0.5 },
      { waveform: 'triangle', freq: 1046.5, delay: 0.3, adsr: { a: 0.003, d: 0.14, s: 0.12, r: 0.5 }, gain: 0.12 },
    ],
  },
};

// The car nominally rests at the lobby — call that Floor 1 for counter purposes.
const GROUND_FLOOR = 1;

// A ride shouldn't be instant, but it also shouldn't feel like a loading screen.
// Time scales with how far the car climbs: a quick hop to the gym, a long haul to
// the penthouse. Clamped so nothing feels broken at either extreme.
function travelMs(fromN, targetN) {
  const floors = Math.abs(targetN - fromN);
  return Math.min(5000, Math.max(1600, 900 + floors * 95));
}

// Which floor the car is sitting on for this rider. The car is a single zone, so
// the only thing that knows we came down from 44 is the last ride we took —
// remembered in `_elevatorAt` and dropped as soon as the player walks off that
// floor (see the zone.entered listener below).
function currentFloor(player) {
  return player?._elevatorAt?.n ?? GROUND_FLOOR;
}

// Floor list off a zone, cleaned + sorted top-to-bottom (highest floor first, the
// way a real elevator panel reads). Tolerates a missing/garbled flag.
//
// The ground floor is implicit: every car returns to its lobby (the `out` exit)
// as Floor 1, injected here so the panel always offers a way down without the
// content repeating it — the ride down runs the same timed board→arrive→chime
// path as any other floor. Skipped if the content already defines a floor there.
function floorsOf(zone) {
  const raw = zone?.flags?.elevator_floors;
  const list = Array.isArray(raw)
    ? raw
        .filter((f) => f && f.zone && Number.isFinite(Number(f.n)))
        .map((f) => ({ n: Number(f.n), zone: f.zone, label: f.label || getZone(f.zone)?.name || f.zone }))
    : [];
  if (!list.some((f) => f.n === GROUND_FLOOR)) {
    const lobbyId = exitTargets(zone, 'out')[0];
    if (lobbyId && getZone(lobbyId)) list.push({ n: GROUND_FLOOR, zone: lobbyId, label: 'Ground Floor — Lobby' });
  }
  return list.sort((a, b) => b.n - a.n);
}

function isElevator(zone) {
  return !!zone?.flags?.elevator;
}

// The clickable floor directory. Each button sends `floor <n>` verbatim.
//
// `at` (optional) is the floor the car is currently parked on for this rider —
// it gets a ▶ marker and, above the list, the doors-open line carrying a real
// exit-link. That link is what lights `out` on the client d-pad (render.js reads
// `.action-link.exit-link[data-target]` out of the room text), which matters here
// because the car sets `hide_exits` and so has no engine exit row of its own.
function buildPanel(floors, at = null) {
  if (!floors.length) return '';
  const lines = floors.map(
    (f) => `${at && f.n === at.n ? '<span class="accent">▶</span>' : ' '} <span class="action-link" data-raw-cmd="floor ${f.n}" data-label="floor ${f.n}">[${String(f.n).padStart(2, ' ')}]</span> ${f.label}`
  );
  const head = ['<span class="accent">▣ FLOOR SELECT</span> — say <b>floor &lt;number&gt;</b> or tap a button:'];
  if (at) {
    head.unshift(
      `<span class="accent">▣ The doors stand open on ${at.n === GROUND_FLOOR ? 'the lobby' : `Floor ${at.n}`}</span> — ` +
      `<span class="dir-tag">[Out]</span> <span class="action-link exit-link" data-action="go" data-target="out"` +
      ` data-dest="${String(at.label || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" title="Step out into ${String(at.label || 'the hall').replace(/"/g, '&quot;')}">${at.label || 'Out'}</span>\n`
    );
  }
  return [...head, ...lines].join('\n');
}

// Where this rider's car is parked, as a panel entry — only while they're still
// standing in that car (the memory also survives stepping onto the floor).
function parkedAt(zone, player) {
  const at = player?._elevatorAt;
  if (!at || at.car !== zone.id || at.zone === zone.id) return null;
  if (!getZone(at.zone)) return null;
  return { n: at.n, zone: at.zone, label: at.label || getZone(at.zone).name };
}

// What `out` opens onto right now: the floor the car was ridden to, or — before
// any ride — the car's authored `out` target (its lobby, Floor 1). A car is never
// between floors while it's standing still, so the doors are ALWAYS open on
// something and the panel always offers the step out.
function doorsOpenAt(zone, player) {
  const parked = parkedAt(zone, player);
  if (parked) return parked;
  const lobbyId = exitTargets(zone, 'out')[0];
  const lobby = lobbyId && getZone(lobbyId);
  if (!lobby) return null;
  return { n: GROUND_FLOOR, zone: lobbyId, label: lobby.name, viaExit: true };
}

// zone.describeRoom hook — appends the directory when the room is an elevator car.
function describeRoom(zone, player) {
  if (!isElevator(zone)) return;
  return buildPanel(floorsOf(zone), doorsOpenAt(zone, player));
}

// Tear down an in-progress ride's timers. Safe to call twice.
function clearRide(player) {
  if (!player?._elevator) return;
  for (const t of player._elevator.timers) clearTimeout(t);
  player._elevator = null;
}

// The doors have closed and the car is climbing — the player is committed. When the
// timer fires the car SETTLES: the rider stays in the car with the doors open on
// their floor, and only `out` puts them on it. Nothing moves here, so there's no
// occupancy/DB bookkeeping — just the parked-floor memory, the chime, and a fresh
// room push so the panel (and the client d-pad's `out`) shows the open doors.
async function arrive(player, ride) {
  // A manual step-out, death, or logout cancels the ride and nulls _elevator; if
  // anything moved the player off the car mid-flight, don't keep working.
  if (player._elevator !== ride || player.current_zone !== ride.carZone) return;
  const { floor } = ride;
  const target = getZone(floor.zone);
  player._elevator = null;

  if (!target) {
    sendToPlayer(player.id, { type: 'error', message: 'The car shudders to a halt — that floor is out of service. The doors reopen on where you started.' });
    return;
  }

  const car = getZone(ride.carZone);
  player._elevatorAt = { n: floor.n, zone: floor.zone, car: ride.carZone, label: floor.label || target.name };

  // Anyone standing on that floor sees the car arrive.
  sendToZone(floor.zone, { type: 'zone_event', message: 'The elevator settles and its doors slide open.' });

  // The chime the flavour text describes — an actual bing-bong to the rider as
  // the doors open on their floor.
  sendToPlayer(player.id, { type: 'audio_sfx', def: SFX_ELEVATOR_CHIME });

  sendToPlayer(player.id, {
    type: 'look',
    message: await describeZone(car, player),
    zone: ride.carZone,
    minimap: getMinimapData(ride.carZone, 8, player),
  });
  sendToPlayer(player.id, {
    type: 'output',
    message: sys(`▣ A soft chime. The doors part on <b>Floor ${floor.n}</b> — ${target.name}. Step <b>out</b> to leave the car.`),
  });
}

// `out` while parked on a floor — the actual step off the car. Prefers the real
// exit (so doors, gates, ambience and the room broadcasts all behave like any
// walked step); falls back to the teleport bookkeeping when the content never
// wired a direct exit from the car to that floor.
async function stepOut(player, at, broadcast) {
  const car = getZone(player.current_zone);
  const dest = getZone(at.zone);
  if (!dest) return { type: 'error', message: 'The doors grind against nothing. That floor is out of service.' };

  const dir = allExits(car).find((e) => e.target === at.zone)?.dir;
  if (dir) {
    // bypassEncumbrance for the same reason the panel does: stepping through open
    // doors isn't the walk the pacing/load laws are about.
    return await cmdMove(dir, player, broadcast, { targetZoneId: at.zone, bypassEncumbrance: true });
  }

  const from = car.id;
  removePlayerFromZone(player.id, from);
  sendToZone(from, { type: 'zone_event', message: `${player.handle} steps out of the car.`, refresh: true }, player.id);
  addPlayerToZone(player.id, at.zone);
  player.current_zone = at.zone;
  player.combatTargetId = null;
  await query('UPDATE players SET current_zone=$1 WHERE id=$2', [at.zone, player.id]);
  sendToZone(at.zone, { type: 'zone_event', message: `The elevator chimes and ${player.handle} steps out onto Floor ${at.n}.`, refresh: true }, player.id);
  emit('zone.entered', { actor: player, zone: at.zone, from });

  return {
    type: 'move',
    message: await describeZone(dest, player),
    zone: at.zone,
    narration: `<span class="msg-system">▣</span> You step out onto <b>Floor ${at.n}</b> — ${dest.name}.`,
    minimap: getMinimapData(at.zone, 8, player),
  };
}

// Seal the doors and start the car moving. Returns an immediate "doors closing"
// acknowledgement; the counter climbs on a timer and arrival lands later.
function board(player, floor) {
  const carZone = player.current_zone;
  const fromN = currentFloor(player);
  const dur = travelMs(fromN, floor.n);
  const rising = floor.n > fromN;
  const ride = { floor, carZone, timers: [] };

  // Two intermediate counter ticks — the floor number sliding by behind the doors.
  const ticks = [0.42, 0.76];
  ticks.forEach((frac) => {
    const passing = Math.round(fromN + (floor.n - fromN) * frac);
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

  const at = doorsOpenAt(zone, player);
  const arg = (args[0] || '').trim();
  if (!arg) {
    return { type: 'output', message: buildPanel(floors, at) };
  }

  const n = Number(arg.replace(/[^\d-]/g, ''));
  const floor = floors.find((f) => f.n === n);
  if (!floor) {
    const valid = floors.map((f) => f.n).join(', ');
    return { type: 'error', message: `No Floor ${arg} on this panel. Try: ${valid}.` };
  }
  if (at && at.n === floor.n) {
    return { type: 'error', message: `The doors are already open on ${floor.n === GROUND_FLOOR ? 'the lobby' : `Floor ${floor.n}`}. Step <b>out</b>.` };
  }
  // A ride is a teleport, so it would otherwise skip every law a walked step
  // obeys — including the residents-only gate on a private amenity floor. Run
  // the same chain here, refusing at the panel rather than the doorway.
  // bypassEncumbrance marks this a system move: the pacing cadence and load
  // laws are about walking and have no business queuing an elevator ride.
  const target = getZone(floor.zone);
  const gate = target && await runMoveGates({ player, from: zone, to: target, direction: 'up', door: null, opts: { bypassEncumbrance: true } });
  if (gate?.block) return gate.silent ? null : { type: 'error', message: gate.message };
  return board(player, floor);
}

// ── Input matchers (run before movement routing) ────────────────────────────
// Two conveniences that only bite inside a car; anywhere else they return
// undefined so the input falls straight through to its normal handling.

// Bare number typed in a car → ride to that floor, exactly as `floor <n>` would
// ("enter the number only"). Outside a car, a stray number stays "unknown
// command" as before.
async function matchBareFloor(_args, raw, player, broadcast) {
  if (!isElevator(getZone(player.current_zone))) return undefined;
  const n = raw.trim();
  return cmdFloor([n], `floor ${n}`, player, broadcast);
}

// up / down inside a car don't cabin-move it — the timed ride is the ONLY way
// between floors (the real up-exits still exist for NPC pathfinding, but the
// player never rides them raw). Reprint the panel and point them at the number.
function matchElevatorDir(_args, _raw, player, _broadcast) {
  const zone = getZone(player.current_zone);
  if (!isElevator(zone)) return undefined;      // normal movement everywhere else
  const floors = floorsOf(zone);
  if (!floors.length) return undefined;
  return { type: 'output', message: `The car only moves to a floor you choose. Enter a number:\n${buildPanel(floors, doorsOpenAt(zone, player))}` };
}

// `out` inside a car — the doors only open on the floor the car is parked on, so
// this leaves you THERE rather than on the car's authored `out` exit (the lobby).
// Parked at the lobby (or never ridden), it falls through to that ordinary exit.
async function matchElevatorOut(_args, _raw, player, broadcast) {
  const zone = getZone(player.current_zone);
  if (!isElevator(zone)) return undefined;
  if (player._elevator) return { type: 'error', message: 'The car is still moving. Wait for the doors.' };
  const at = doorsOpenAt(zone, player);
  // Parked at the lobby, `out` IS the car's authored exit — fall through and let
  // ordinary movement handle it (the panel still drew the link, so the d-pad lit).
  if (!at || at.viaExit) return undefined;
  return await stepOut(player, at, broadcast);
}

registerInputMatcher(/^\d+$/, matchBareFloor, 'elevator');
registerInputMatcher(/^(up|down)$/i, matchElevatorDir, 'elevator');
registerInputMatcher(/^(out|exit)$/i, matchElevatorOut, 'elevator');

// A ride is fragile in-flight: if the player forces their way out of the car,
// dies, or drops, drop the pending arrival so the timer can't teleport a corpse
// (or a logged-out ghost) across town. zone.entered fires on any move including
// the elevator's own arrival, so only cancel when they're no longer in the car.
on('zone.entered', ({ actor }) => { if (actor?._elevator && actor.current_zone !== actor._elevator.carZone) clearRide(actor); });
// The remembered floor only holds while the player is still on it (or back in the
// car); wander off and the car is no longer theirs to be parked anywhere but the
// lobby.
on('zone.entered', ({ actor }) => {
  const at = actor?._elevatorAt;
  if (at && actor.current_zone !== at.zone && actor.current_zone !== at.car) actor._elevatorAt = null;
});
on('player.death',  ({ player }) => clearRide(player));
on('player.logout', ({ id })     => clearRide(getAllLivePlayers().find(p => p.id === id)));

export const hooks = {
  'zone.describeRoom': describeRoom,
};

export const commands = {
  floor: cmdFloor,
};

export const _test = { floorsOf, buildPanel, isElevator, describeRoom, matchBareFloor, matchElevatorDir, matchElevatorOut, parkedAt };

console.log('[elevator] Plugin loaded.');
