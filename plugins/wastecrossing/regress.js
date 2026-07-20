// Waste Crossing regression suite — run by tests/regress.js (never in production).
// Drives the real configured void using SYNTHETIC gate + destination zones, so it
// doesn't depend on (possibly uncommitted) world content being loaded.
import { world, getZone, isTransientZone, setLivePlayer, removeLivePlayer,
  addPlayerToZone, removePlayerFromZone, getEnemyInstance } from '../../server/engine/world.js';
import { VOIDS, _test } from './index.js';

const GATE = 'zone_regress_voidgate';
const VOIDKEY = 'southern_waste';
const mkZone = (id, name, extra = {}) => ({
  id, name, description: `${name}.`, flags: {}, exits: {},
  players: new Set(), npcs: new Set(), enemies: new Set(), corpses: new Set(), ...extra,
});

export default async function regress({ run, check, getPlayer }) {
  const vdef = VOIDS[VOIDKEY];
  const REACH = vdef.dests[0].dest;   // south limb
  const EXODUS = vdef.dests[1].dest;  // east limb
  const player = getPlayer();
  const savedZone = player.current_zone;

  const prev = new Map();
  for (const id of [GATE, REACH, EXODUS]) prev.set(id, world.zones.get(id));
  world.zones.set(GATE, mkZone(GATE, 'Test Gate', { flags: { void_gate: VOIDKEY, void_dir: 'south' }, grid_x: 900, grid_y: 900 }));
  world.zones.set(REACH, mkZone(REACH, 'The Reach', { grid_x: 900, grid_y: 1530 }));   // 630 tiles → total 7
  world.zones.set(EXODUS, mkZone(EXODUS, 'Exodus', { grid_x: 1350, grid_y: 900 }));     // 450 tiles → total 5

  const wipe = () => {
    for (const c of _test.crossings.values()) for (const id of c.roomSet) world.zones.delete(id);
    _test.crossings.clear();
    delete player._crossing;
  };

  _test.setEncounters(false); // keep movement/traversal tests deterministic
  try {
    // ── Entry drops you onto the shared trunk ──────────────────────────────────
    player.current_zone = GATE; player._lastStepAt = 0;
    const enter = await run('venture');
    const c = _test.crossings.get(player._crossing?.instanceId);
    check('venture drops you into the void trunk',
      enter?.type === 'move' && !!c && player.current_zone === c.entry, `${enter?.type} zone=${player.current_zone}`);

    // ── The braid: the trunk forks toward BOTH regions ────────────────────────
    const fork = `${c.id}_t${vdef.trunk - 1}`;
    const reachLimb = getZone(fork)?.exits?.[vdef.dests[0].dir]; // south
    const exodusLimb = getZone(fork)?.exits?.[vdef.dests[1].dir]; // east
    check('the shared trunk forks toward both regions',
      !!reachLimb && !!exodusLimb && reachLimb !== exodusLimb && isTransientZone(reachLimb) && isTransientZone(exodusLimb),
      `reach=${reachLimb} exodus=${exodusLimb}`);
    check('both regions are live destinations of the void', c.destSet.has(REACH) && c.destSet.has(EXODUS),
      `dests=${[...c.destSet].join(',')}`);

    // ── Hold your heading: trunk-then-south-limb reaches The Reach ─────────────
    const totalReach = _test.totalLength(vdef.dests[0], getZone(GATE), getZone(REACH));
    for (let i = 0; i < totalReach; i++) { player._lastStepAt = 0; await run('south'); }
    check('walking the trunk then the south limb arrives at The Reach', player.current_zone === REACH, player.current_zone);
    check('arriving tears the instance down', !player._crossing && !_test.crossings.has(c.id),
      `crossing=${!!player._crossing} instance=${_test.crossings.has(c.id)}`);

    // ── Divert at the fork: east limb reaches Exodus instead ──────────────────
    player.current_zone = GATE; player._lastStepAt = 0;
    await run('venture');
    const c2 = _test.crossings.get(player._crossing.instanceId);
    for (let i = 0; i < vdef.trunk - 1; i++) { player._lastStepAt = 0; await run('south'); } // to the fork
    check('you can walk the shared trunk to the fork', player.current_zone === `${c2.id}_t${vdef.trunk - 1}`, player.current_zone);
    player._lastStepAt = 0; await run('east'); // divert toward Exodus
    const exodusLimbLen = _test.totalLength(vdef.dests[1], getZone(GATE), getZone(EXODUS)) - vdef.trunk;
    for (let i = 0; i < exodusLimbLen; i++) { player._lastStepAt = 0; await run('south'); }
    check('diverting east at the fork reaches Exodus (the other region)', player.current_zone === EXODUS, player.current_zone);
    wipe();

    // ── Walk off the map (movement.edge hook) ─────────────────────────────────
    player.current_zone = GATE; player._lastStepAt = 0;
    const walked = await run('south'); // no south exit on the gate → edge hook launches
    check('walking off the edge launches the crossing',
      walked?.type === 'move' && !!player._crossing && player.current_zone === _test.crossings.get(player._crossing.instanceId).entry,
      `${walked?.type} zone=${player.current_zone}`);
    wipe();
    player.current_zone = GATE; player._lastStepAt = 0;
    const wall = await run('north'); // not the void direction
    check('a non-void direction off the gate is still a wall', wall?.type === 'error' && /no exit/i.test(wall?.message || ''), `${wall?.type}: ${wall?.message}`);

    // ── Branching: risk-for-loot detour off the trunk ─────────────────────────
    player.current_zone = GATE; player._lastStepAt = 0;
    await run('venture');
    const bc = _test.crossings.get(player._crossing.instanceId);
    check('a crossing has at least one risk-for-loot detour', bc.detourSet.size >= 1, `detours=${bc.detourSet.size}`);
    const detourId = [...bc.detourSet][0];
    const spineWithDetour = [...bc.roomSet].find(id => getZone(id)?.exits?.west === detourId);
    check('a detour hangs off a trunk room (west) and exits back (east)',
      isTransientZone(detourId) && !!spineWithDetour && getZone(detourId)?.exits?.east === spineWithDetour,
      `detour=${detourId} trunk=${spineWithDetour}`);
    const bRooms = [...bc.roomSet];
    _test.teardownInstance(bc);
    check('teardown removes trunk + limbs + detours (no leak)', bRooms.every(id => !getZone(id)), `leaked=${bRooms.filter(id => getZone(id)).length}`);
    delete player._crossing;

    // ── PARTY crossing: a follower shares the leader's instance ────────────────
    const BOB = 'p_wc_bob';
    const bob = { id: BOB, handle: 'Bob', current_zone: GATE, following: player.id };
    setLivePlayer(BOB, bob); addPlayerToZone(BOB, GATE);
    try {
      player.current_zone = GATE; player._lastStepAt = 0;
      await run('venture');
      check('a co-present follower is pulled into the SAME instance',
        !!bob._crossing && bob._crossing.instanceId === player._crossing.instanceId, `bob=${bob._crossing?.instanceId} leader=${player._crossing?.instanceId}`);
      check('the follower lands on the trunk entry with the leader',
        bob.current_zone === _test.crossings.get(player._crossing.instanceId).entry, `bob@${bob.current_zone}`);
    } finally {
      removePlayerFromZone(BOB, bob.current_zone); removeLivePlayer(BOB); wipe();
    }

    // ── Encounters: a real foe spawns and is cleaned up on teardown ────────────
    await _test.loadFoes();
    check('the void foe roster loads from the enemies table', _test.foePool().length > 0, `foes=${_test.foePool().length}`);
    player.current_zone = GATE; player._lastStepAt = 0;
    await run('venture');
    const ec = _test.crossings.get(player._crossing.instanceId);
    const foeRoom = [...ec.roomSet].find(id => id !== ec.entry);
    const inst = _test.spawnFoe(ec, foeRoom);
    check('an encounter spawns a real enemy into the room',
      !!inst && !!getEnemyInstance(inst.instanceId) && getZone(foeRoom).enemies.has(inst.instanceId) && ec.enemies.has(inst.instanceId), `inst=${inst?.instanceId}`);
    _test.teardownInstance(ec);
    check('tearing down an instance despawns its foes', !getEnemyInstance(inst.instanceId) && !_test.crossings.has(ec.id),
      `enemyGone=${!getEnemyInstance(inst?.instanceId)} instanceGone=${!_test.crossings.has(ec.id)}`);
    delete player._crossing;
  } finally {
    _test.setEncounters(true);
    wipe();
    for (const [id, z] of prev) { if (z) world.zones.set(id, z); else world.zones.delete(id); }
    player.current_zone = savedZone;
  }
}
