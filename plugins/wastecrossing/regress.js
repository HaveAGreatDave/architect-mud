// Waste Crossing regression suite — run by tests/regress.js (never in production).
// Drives the real configured route using SYNTHETIC gate + destination zones, so
// it doesn't depend on (possibly uncommitted) world content being loaded.
import { world, getZone, isTransientZone, setLivePlayer, removeLivePlayer,
  addPlayerToZone, removePlayerFromZone } from '../../server/engine/world.js';
import { ROUTES, _test } from './index.js';

const ROUTE_KEY = 'reach';
const GATE = 'zone_regress_voidgate';
const mkZone = (id, name, extra = {}) => ({
  id, name, description: `${name}.`, flags: {}, exits: {},
  players: new Set(), npcs: new Set(), enemies: new Set(), corpses: new Set(), ...extra,
});
const roomsOf = (player) => {
  const c = player._crossing && _test.crossings.get(player._crossing.instanceId);
  return c ? [...c.roomIds] : [];
};

export default async function regress({ run, check, getPlayer }) {
  const route = ROUTES[ROUTE_KEY];
  const player = getPlayer();
  const savedZone = player.current_zone;
  const dest = route.dest;

  const hadGate = world.zones.get(GATE);
  const hadDest = world.zones.get(dest);
  world.zones.set(GATE, mkZone(GATE, 'Test Gate', { flags: { void_gate: ROUTE_KEY, void_dir: 'south' } }));
  world.zones.set(dest, mkZone(dest, 'Test Destination'));

  const wipe = () => {
    for (const c of _test.crossings.values()) for (const id of c.roomIds) world.zones.delete(id);
    _test.crossings.clear();
    delete player._crossing;
  };

  try {
    // ── Solo entry via `venture` ───────────────────────────────────────────────
    player.current_zone = GATE; player._lastStepAt = 0;
    const enter = await run('venture');
    check('venture drops you into a void instance',
      enter?.type === 'move' && !!player._crossing && player.current_zone === roomsOf(player)[0],
      `${enter?.type} zone=${player.current_zone}`);
    const roomIds = roomsOf(player);
    check('the instance holds the full room chain as transient zones',
      roomIds.length === route.length && roomIds.every(id => getZone(id) && isTransientZone(id)),
      `rooms=${roomIds.length}`);

    // ── Traversal → arrival (solo) ─────────────────────────────────────────────
    for (let i = 0; i < route.length; i++) { player._lastStepAt = 0; await run('south'); }
    check('walking south arrives at the destination region',
      player.current_zone === dest, player.current_zone);
    check('the last member leaving tears the instance down (no leak)',
      !player._crossing && roomIds.every(id => !getZone(id)) && _test.crossings.size === 0,
      `crossing=${!!player._crossing} leaked=${roomIds.filter(id => getZone(id)).length} instances=${_test.crossings.size}`);

    // ── Walk off the map (movement.edge hook) ─────────────────────────────────
    player.current_zone = GATE; player._lastStepAt = 0;
    const walked = await run('south'); // no south exit → edge hook launches the crossing
    check('walking off the edge launches the crossing',
      walked?.type === 'move' && !!player._crossing && player.current_zone === roomsOf(player)[0],
      `${walked?.type} zone=${player.current_zone}`);
    wipe();
    player.current_zone = GATE; player._lastStepAt = 0;
    const wallEast = await run('east');
    check('a non-void direction off the gate is still a wall',
      wallEast?.type === 'error' && /no exit/i.test(wallEast?.message || ''),
      `${wallEast?.type}: ${wallEast?.message}`);

    // ── Double-venture guard ───────────────────────────────────────────────────
    player.current_zone = GATE; player._lastStepAt = 0;
    await run('venture');
    const twice = await run('venture');
    check('venture while already crossing is refused',
      twice?.type === 'emote' && /already out in the waste/i.test(twice?.message || ''),
      twice?.message?.slice?.(0, 60));
    wipe();

    // ── PARTY crossing: a follower shares the leader's instance ────────────────
    const BOB = 'p_wc_bob', CHAR = 'p_wc_charlie';
    const bob = { id: BOB, handle: 'Bob', current_zone: GATE, following: player.id };
    const charlie = { id: CHAR, handle: 'Charlie', current_zone: GATE, following: null };
    setLivePlayer(BOB, bob); addPlayerToZone(BOB, GATE);
    setLivePlayer(CHAR, charlie); addPlayerToZone(CHAR, GATE);
    try {
      player.current_zone = GATE; player._lastStepAt = 0;
      await run('venture'); // player is the leader; Bob follows, Charlie doesn't
      check('a co-present follower is pulled into the SAME instance',
        !!bob._crossing && !!player._crossing && bob._crossing.instanceId === player._crossing.instanceId,
        `bob=${bob._crossing?.instanceId} leader=${player._crossing?.instanceId}`);
      check('the follower lands in room 0 alongside the leader',
        bob.current_zone === roomsOf(player)[0], `bob@${bob.current_zone}`);
      check('a non-follower is NOT dragged into the void',
        !charlie._crossing && charlie.current_zone === GATE, `charlie@${charlie.current_zone} crossing=${!!charlie._crossing}`);
      const inst = _test.crossings.get(player._crossing.instanceId);
      check('both leader and follower are counted in the instance',
        inst && inst.members.has(player.id) && inst.members.has(BOB) && !inst.members.has(CHAR),
        `members=${inst ? [...inst.members].join(',') : 'none'}`);
    } finally {
      removePlayerFromZone(BOB, bob.current_zone); removeLivePlayer(BOB);
      removePlayerFromZone(CHAR, charlie.current_zone); removeLivePlayer(CHAR);
      wipe();
    }
  } finally {
    if (hadGate) world.zones.set(GATE, hadGate); else world.zones.delete(GATE);
    if (hadDest) world.zones.set(dest, hadDest); else world.zones.delete(dest);
    player.current_zone = savedZone;
  }
}
