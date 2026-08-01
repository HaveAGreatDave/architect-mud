/**
 * The elevator's floor table, in a module with NO side effects.
 *
 * index.js registers input matchers and commands on import; GPS only wants to
 * ask "what floor button reaches this zone?" when it plots a route through a
 * car. Importing index.js for that would drag the whole plugin's registration
 * into the route planner's import graph, so the table lives here and both sides
 * import it.
 */
import { getZone } from '../../server/engine/world.js';
import { exitTargets } from '../../server/engine/exits.js';

// The car nominally rests at the lobby — call that Floor 1 for counter purposes.
export const GROUND_FLOOR = 1;

export function isElevator(zone) {
  return !!zone?.flags?.elevator;
}

// Floor list off a zone, cleaned + sorted top-to-bottom (highest floor first, the
// way a real elevator panel reads). Tolerates a missing/garbled flag.
//
// The ground floor is implicit: every car returns to its lobby (the `out` exit)
// as Floor 1, injected here so the panel always offers a way down without the
// content repeating it — the ride down runs the same timed board→arrive→chime
// path as any other floor. Skipped if the content already defines a floor there.
export function floorsOf(zone) {
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

// Which button on this car's panel reaches `targetZoneId`, or null if none does.
// The whole reason GPS needs this: the car's raw exits say every floor is `up`,
// which is exactly the input the car refuses (see matchElevatorDir) — the button
// number is the only routable handle on a floor.
export function floorFor(car, targetZoneId) {
  if (!isElevator(car) || !targetZoneId) return null;
  return floorsOf(car).find((f) => f.zone === targetZoneId) || null;
}
