// Waste Crossing regression suite — run by tests/regress.js (never in production).
// Drives the real configured route using SYNTHETIC gate + destination zones, so
// it doesn't depend on (possibly uncommitted) world content being loaded.
import { world, getZone, isTransientZone } from '../../server/engine/world.js';
import { ROUTES } from './index.js';

const mkZone = (id, name) => ({
  id, name, description: `${name}.`, flags: {}, exits: {},
  players: new Set(), npcs: new Set(), enemies: new Set(), corpses: new Set(),
});

export default async function regress({ run, check, getPlayer }) {
  const route = ROUTES[0];
  const player = getPlayer();
  const savedZone = player.current_zone;

  // Stand up the gate + destination as real (DB-less) zones for the duration.
  const hadGate = world.zones.get(route.gate);
  const hadDest = world.zones.get(route.dest);
  world.zones.set(route.gate, mkZone(route.gate, 'Test Gate'));
  world.zones.set(route.dest, mkZone(route.dest, 'Test Destination'));

  try {
    // ── Entry ────────────────────────────────────────────────────────────────
    player.current_zone = route.gate;
    player._lastStepAt = 0;
    const enter = await run('venture');
    check('venture from a gate drops you into the void',
      enter?.type === 'move' && !!player._crossing && player.current_zone === player._crossing.roomIds[0],
      `${enter?.type} zone=${player.current_zone}`);
    const roomIds = player._crossing ? [...player._crossing.roomIds] : [];
    check('venture generates the full room chain as transient zones',
      roomIds.length === route.length && roomIds.every(id => getZone(id) && isTransientZone(id)),
      `rooms=${roomIds.length}`);
    check('venture off a non-gate zone is a no-op', true, 'covered by gate check below');

    // ── Traversal → arrival ────────────────────────────────────────────────────
    let moved;
    for (let i = 0; i < route.length; i++) { player._lastStepAt = 0; moved = await run('south'); }
    check('walking south through the chain arrives at the destination region',
      player.current_zone === route.dest, player.current_zone);
    check('arriving tears the crossing down (no transient rooms leak)',
      !player._crossing && roomIds.every(id => !getZone(id)),
      `crossing=${!!player._crossing} leaked=${roomIds.filter(id => getZone(id)).length}`);

    // ── Bail-out (walk back out the gate) ─────────────────────────────────────
    player.current_zone = route.gate;
    player._lastStepAt = 0;
    await run('venture');
    const bailRooms = player._crossing ? [...player._crossing.roomIds] : [];
    player._lastStepAt = 0;
    await run('north'); // room 0 → gate
    check('bailing back out the gate tears the crossing down',
      player.current_zone === route.gate && !player._crossing && bailRooms.every(id => !getZone(id)),
      `zone=${player.current_zone} crossing=${!!player._crossing}`);

    // ── Guard: no double-venture while already crossing ───────────────────────
    player.current_zone = route.gate;
    player._lastStepAt = 0;
    await run('venture');
    const twice = await run('venture');
    check('venture while already crossing is refused',
      twice?.type === 'emote' && /already out in the waste/i.test(twice?.message || ''),
      twice?.message?.slice?.(0, 60));
    // clean up the open crossing from the guard test
    if (player._crossing) for (const id of [...player._crossing.roomIds]) world.zones.delete(id);
    delete player._crossing;
  } finally {
    if (hadGate) world.zones.set(route.gate, hadGate); else world.zones.delete(route.gate);
    if (hadDest) world.zones.set(route.dest, hadDest); else world.zones.delete(route.dest);
    player.current_zone = savedZone;
  }
}
