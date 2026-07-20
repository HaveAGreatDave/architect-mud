// Waste Crossing regression suite — run by tests/regress.js (never in production).
// Drives the real configured route using SYNTHETIC gate + destination zones, so
// it doesn't depend on (possibly uncommitted) world content being loaded.
import { world, getZone, isTransientZone, setLivePlayer, removeLivePlayer,
  addPlayerToZone, removePlayerFromZone, getEnemyInstance } from '../../server/engine/world.js';
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
  // Give the endpoints grid coords so the room count is derived from the distance
  // between them (630 tiles → 630/90 = 7 rooms, within [MIN,MAX]).
  world.zones.set(GATE, mkZone(GATE, 'Test Gate', { flags: { void_gate: ROUTE_KEY, void_dir: 'south' }, grid_x: 900, grid_y: 900 }));
  world.zones.set(dest, mkZone(dest, 'Test Destination', { grid_x: 900, grid_y: 1530 }));
  const L = _test.crossingLength(route, world.zones.get(GATE), world.zones.get(dest));

  const wipe = () => {
    for (const c of _test.crossings.values()) for (const id of c.roomIds) world.zones.delete(id);
    _test.crossings.clear();
    delete player._crossing;
  };

  _test.setEncounters(false); // keep the movement/traversal tests deterministic (no random spawns)
  try {
    // ── Solo entry via `venture` ───────────────────────────────────────────────
    player.current_zone = GATE; player._lastStepAt = 0;
    const enter = await run('venture');
    check('venture drops you into a void instance',
      enter?.type === 'move' && !!player._crossing && player.current_zone === roomsOf(player)[0],
      `${enter?.type} zone=${player.current_zone}`);
    const roomIds = roomsOf(player);
    check('the instance holds a distance-derived room chain as transient zones',
      roomIds.length === L && L === 7 && roomIds.every(id => getZone(id) && isTransientZone(id)),
      `rooms=${roomIds.length} expected=${L}`);

    // Distance scaling: near → MIN, far → MAX (clamped), mid → proportional.
    const cl = _test.crossingLength;
    const near = cl(route, { grid_x: 0, grid_y: 0 }, { grid_x: 0, grid_y: 50 });
    const far = cl(route, { grid_x: 0, grid_y: 0 }, { grid_x: 0, grid_y: 99999 });
    const mid = cl(route, { grid_x: 0, grid_y: 0 }, { grid_x: 0, grid_y: 900 });
    check('crossing length scales with distance and clamps',
      near === _test.MIN_ROOMS && far === _test.MAX_ROOMS && mid > near && mid < far,
      `near=${near} mid=${mid} far=${far} [${_test.MIN_ROOMS}..${_test.MAX_ROOMS}]`);

    // ── Traversal → arrival (solo) ─────────────────────────────────────────────
    for (let i = 0; i < L; i++) { player._lastStepAt = 0; await run('south'); }
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

    // ── Branching: risk-for-loot detours ──────────────────────────────────────
    player.current_zone = GATE; player._lastStepAt = 0;
    await run('venture');
    const bc = _test.crossings.get(player._crossing.instanceId);
    check('a crossing has at least one risk-for-loot detour', bc.detourIds.size >= 1, `detours=${bc.detourIds.size}`);
    const detourId = [...bc.detourIds][0];
    const spineWithDetour = bc.roomIds.find(id => getZone(id)?.exits?.west === detourId);
    check('a detour hangs off a spine room (west) and exits back (east)',
      isTransientZone(detourId) && !!spineWithDetour && getZone(detourId)?.exits?.east === spineWithDetour,
      `detour=${detourId} spine=${spineWithDetour}`);
    const spineIdx = bc.roomIds.indexOf(spineWithDetour);
    for (let i = 0; i < spineIdx; i++) { player._lastStepAt = 0; await run('south'); }
    player._lastStepAt = 0; await run('west');
    check('walking west enters the detour (no progress)',
      player.current_zone === detourId && player._crossing.node === spineIdx, `zone=${player.current_zone} node=${player._crossing.node}`);
    player._lastStepAt = 0; await run('east');
    check('walking east returns to the spine, still crossing',
      player.current_zone === spineWithDetour && !!player._crossing, `zone=${player.current_zone}`);
    const bRooms = [...bc.roomIds, ...bc.detourIds];
    _test.teardownInstance(bc);
    check('teardown removes detour rooms too (no leak)', bRooms.every(id => !getZone(id)), `leaked=${bRooms.filter(id => getZone(id)).length}`);
    delete player._crossing;

    // ── Encounters: a real foe spawns and is cleaned up on teardown ────────────
    await _test.loadFoes();
    check('the void foe roster loads from the enemies table', _test.foePool().length > 0, `foes=${_test.foePool().length}`);
    player.current_zone = GATE; player._lastStepAt = 0;
    await run('venture');
    const ec = _test.crossings.get(player._crossing.instanceId);
    const foeRoom = ec.roomIds[1];
    const inst = _test.spawnFoe(ec, foeRoom);
    check('an encounter spawns a real enemy into the room',
      !!inst && !!getEnemyInstance(inst.instanceId) && getZone(foeRoom).enemies.has(inst.instanceId) && ec.enemies.has(inst.instanceId),
      `inst=${inst?.instanceId}`);
    check('a room already holding a foe does not stack another', _test.spawnFoe(ec, foeRoom) === null, 'stacked');
    _test.teardownInstance(ec);
    check('tearing down an instance despawns its foes', !getEnemyInstance(inst.instanceId) && !_test.crossings.has(ec.id),
      `enemyGone=${!getEnemyInstance(inst?.instanceId)} instanceGone=${!_test.crossings.has(ec.id)}`);
    delete player._crossing;
  } finally {
    _test.setEncounters(true);
    if (hadGate) world.zones.set(GATE, hadGate); else world.zones.delete(GATE);
    if (hadDest) world.zones.set(dest, hadDest); else world.zones.delete(dest);
    player.current_zone = savedZone;
  }
}
