// Waste Crossing regression suite — run by tests/regress.js (never in production).
// Drives the real configured route using SYNTHETIC gate + destination zones, so
// it doesn't depend on (possibly uncommitted) world content being loaded.
import { world, getZone, isTransientZone } from '../../server/engine/world.js';
import { ROUTES } from './index.js';

const ROUTE_KEY = 'reach';
const GATE = 'zone_regress_voidgate';
const mkZone = (id, name, extra = {}) => ({
  id, name, description: `${name}.`, flags: {}, exits: {},
  players: new Set(), npcs: new Set(), enemies: new Set(), corpses: new Set(), ...extra,
});

export default async function regress({ run, check, getPlayer }) {
  const route = ROUTES[ROUTE_KEY];
  const player = getPlayer();
  const savedZone = player.current_zone;
  const dest = route.dest;

  // A synthetic edge tile flagged as a void gate (no south exit → walking south
  // is walking off the map), plus the destination region as a real DB-less zone.
  const hadGate = world.zones.get(GATE);
  const hadDest = world.zones.get(dest);
  world.zones.set(GATE, mkZone(GATE, 'Test Gate', { flags: { void_gate: ROUTE_KEY, void_dir: 'south' } }));
  world.zones.set(dest, mkZone(dest, 'Test Destination'));

  const cleanCrossing = () => {
    if (player._crossing) for (const id of [...player._crossing.roomIds]) world.zones.delete(id);
    delete player._crossing;
  };

  try {
    // ── Entry via the `venture` verb ───────────────────────────────────────────
    player.current_zone = GATE;
    player._lastStepAt = 0;
    const enter = await run('venture');
    check('venture from a gate drops you into the void',
      enter?.type === 'move' && !!player._crossing && player.current_zone === player._crossing.roomIds[0],
      `${enter?.type} zone=${player.current_zone}`);
    const roomIds = player._crossing ? [...player._crossing.roomIds] : [];
    check('venture generates the full room chain as transient zones',
      roomIds.length === route.length && roomIds.every(id => getZone(id) && isTransientZone(id)),
      `rooms=${roomIds.length}`);

    // ── Traversal → arrival ────────────────────────────────────────────────────
    for (let i = 0; i < route.length; i++) { player._lastStepAt = 0; await run('south'); }
    check('walking south through the chain arrives at the destination region',
      player.current_zone === dest, player.current_zone);
    check('arriving tears the crossing down (no transient rooms leak)',
      !player._crossing && roomIds.every(id => !getZone(id)),
      `crossing=${!!player._crossing} leaked=${roomIds.filter(id => getZone(id)).length}`);

    // ── Entry by WALKING OFF THE MAP (movement.edge hook) ─────────────────────
    player.current_zone = GATE;
    player._lastStepAt = 0;
    const walked = await run('south'); // no south exit → edge hook launches the crossing
    check('walking off the edge into the void launches the crossing',
      walked?.type === 'move' && !!player._crossing && player.current_zone === player._crossing.roomIds[0],
      `${walked?.type} zone=${player.current_zone}`);
    // Walking a non-void direction off the same tile is still a plain wall.
    player.current_zone = GATE; cleanCrossing(); player._lastStepAt = 0;
    const wallEast = await run('east');
    check('walking a non-void direction off the gate is still a wall',
      wallEast?.type === 'error' && /no exit/i.test(wallEast?.message || ''),
      `${wallEast?.type}: ${wallEast?.message}`);

    // ── Bail-out (walk back out to the origin tile) ───────────────────────────
    player.current_zone = GATE; player._lastStepAt = 0;
    await run('venture');
    const bailRooms = player._crossing ? [...player._crossing.roomIds] : [];
    player._lastStepAt = 0;
    await run('north'); // room 0 → origin (the gate)
    check('bailing back out tears the crossing down',
      player.current_zone === GATE && !player._crossing && bailRooms.every(id => !getZone(id)),
      `zone=${player.current_zone} crossing=${!!player._crossing}`);

    // ── Guard: no double-venture while already crossing ───────────────────────
    player.current_zone = GATE; player._lastStepAt = 0;
    await run('venture');
    const twice = await run('venture');
    check('venture while already crossing is refused',
      twice?.type === 'emote' && /already out in the waste/i.test(twice?.message || ''),
      twice?.message?.slice?.(0, 60));
    cleanCrossing();
  } finally {
    if (hadGate) world.zones.set(GATE, hadGate); else world.zones.delete(GATE);
    if (hadDest) world.zones.set(dest, hadDest); else world.zones.delete(dest);
    player.current_zone = savedZone;
  }
}
