// Waste Crossing regression suite — run by tests/regress.js (never in production).
// Drives the real configured void using SYNTHETIC gate + destination zones, so it
// doesn't depend on (possibly uncommitted) world content being loaded.
import { world, getZone, isTransientZone, setLivePlayer, removeLivePlayer,
  addPlayerToZone, removePlayerFromZone, getEnemyInstance, removeEnemyInstance, getMinimapData } from '../../server/engine/world.js';
import { query } from '../../server/models/db.js';
import { VOIDS, _test, commands } from './index.js';
import { _test as traces } from './traces.js';

const GATE = 'zone_regress_voidgate';
const NONVOID = 'zone_regress_nonvoid';
const VOIDKEY = 'region_coldwater';
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
  for (const id of [GATE, NONVOID, REACH, EXODUS]) prev.set(id, world.zones.get(id));
  world.zones.set(GATE, mkZone(GATE, 'Test Gate', { flags: { region_id: VOIDKEY }, grid_x: 900, grid_y: 900 }));
  world.zones.set(NONVOID, mkZone(NONVOID, 'Nowhere', { grid_x: 900, grid_y: 900 })); // no region_id → not a void gate
  world.zones.set(REACH, mkZone(REACH, 'The Reach', { grid_x: 900, grid_y: 1530 }));   // 630 tiles → total 7
  world.zones.set(EXODUS, mkZone(EXODUS, 'Exodus', { grid_x: 1350, grid_y: 900 }));     // 450 tiles → total 5

  const wipe = () => {
    for (const c of _test.crossings.values()) for (const id of c.roomSet) world.zones.delete(id);
    _test.crossings.clear();
    delete player._crossing;
  };

  _test.setEncounters(false); // keep movement/traversal tests deterministic
  // Solo helper: journey opens the muster, then `ready` (all ready → launch).
  const launch = async () => { await run('journey'); return run('ready'); };
  try {
    // ── The muster: journey opens staging; ready launches ──────────────────────
    player.current_zone = GATE; player._lastStepAt = 0;
    const stage = await run('journey');
    check('journey opens the muster overlay instead of launching',
      stage?.type === 'journey_staging' && !player._crossing, `${stage?.type} crossing=${!!player._crossing}`);
    check('the muster carries kit + party + lore', Array.isArray(stage?.inventory) && Array.isArray(stage?.party) && !!stage?.lore && stage?.solo === true, `party=${stage?.party?.length}`);
    await run('ready'); // solo → all ready → launch
    const c = _test.crossings.get(player._crossing?.instanceId);
    check('readying up launches the crossing onto the trunk',
      !!c && player.current_zone === c.entry, `zone=${player.current_zone}`);

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
    await launch();
    const c2 = _test.crossings.get(player._crossing.instanceId);
    for (let i = 0; i < vdef.trunk - 1; i++) { player._lastStepAt = 0; await run('south'); } // to the fork
    check('you can walk the shared trunk to the fork', player.current_zone === `${c2.id}_t${vdef.trunk - 1}`, player.current_zone);
    player._lastStepAt = 0; await run('east'); // divert toward Exodus
    const exodusLimbLen = _test.totalLength(vdef.dests[1], getZone(GATE), getZone(EXODUS)) - vdef.trunk;
    for (let i = 0; i < exodusLimbLen; i++) { player._lastStepAt = 0; await run('south'); }
    check('diverting east at the fork reaches Exodus (the other region)', player.current_zone === EXODUS, player.current_zone);
    wipe();

    // ── Walk off the map (movement.edge hook) → opens the muster ──────────────
    player.current_zone = GATE; player._lastStepAt = 0;
    const walked = await run('south'); // no south exit → edge hook opens the muster
    check('walking off the edge opens the muster', walked?.type === 'journey_staging' && !player._crossing, `${walked?.type}`);
    await run('ready');
    check('readying from the walk-off muster launches the crossing',
      !!player._crossing && player.current_zone === _test.crossings.get(player._crossing.instanceId).entry, `zone=${player.current_zone}`);
    wipe();
    // Any unexited edge of a void-region opens the muster (not just one direction).
    player.current_zone = GATE; player._lastStepAt = 0;
    const north = await run('north'); // GATE has no north exit either → still the void
    check('any edge of a void-region opens the muster', north?.type === 'journey_staging' && !player._crossing, `${north?.type}`);
    await run('journey cancel'); // close the muster before the next case
    // Off the map in a NON-void region is a plain wall.
    player.current_zone = NONVOID; player._lastStepAt = 0;
    const wall = await run('north');
    check('walking off a non-void region is still a wall', wall?.type === 'error' && /no exit/i.test(wall?.message || ''), `${wall?.type}: ${wall?.message}`);

    // ── Branching: risk-for-loot detour off the trunk ─────────────────────────
    player.current_zone = GATE; player._lastStepAt = 0;
    await launch();
    const bc = _test.crossings.get(player._crossing.instanceId);
    check('a crossing has at least one risk-for-loot detour', bc.detourSet.size >= 1, `detours=${bc.detourSet.size}`);
    const detourId = [...bc.detourSet][0];
    const spineWithDetour = [...bc.roomSet].find(id => getZone(id)?.exits?.west === detourId);
    check('a detour hangs off a trunk room (west) and exits back (east)',
      isTransientZone(detourId) && !!spineWithDetour && getZone(detourId)?.exits?.east === spineWithDetour,
      `detour=${detourId} trunk=${spineWithDetour}`);
    // The minimap payload must flag void rooms so the client swaps to crossing mode.
    const mmNodes = getMinimapData(bc.entry, 8, player);
    const mmEntry = mmNodes.find(n => n.id === bc.entry);
    const mmDetour = mmNodes.find(n => n.id === detourId);
    check('minimap nodes flag void rooms (crossing mode) — trunk + detour',
      mmEntry?.void_crossing === true && mmDetour?.void_crossing === true && mmDetour?.void_detour === true,
      `entry=${JSON.stringify([mmEntry?.void_crossing, mmEntry?.void_detour])} detour=${JSON.stringify([mmDetour?.void_crossing, mmDetour?.void_detour])}`);
    // Hard nodes surface on the minimap payload so the client can mark bad ground.
    const spineRoom = [...bc.roomSet].find(id => id !== bc.entry && !bc.detourSet.has(id));
    getZone(spineRoom).flags.void_hard = true;
    const mmHard = getMinimapData(bc.entry, 8, player).find(n => n.id === spineRoom);
    check('minimap surfaces hard nodes (void_hard)', mmHard?.void_hard === true, `void_hard=${mmHard?.void_hard}`);
    delete getZone(spineRoom).flags.void_hard;
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
      await run('journey'); // musters leader + Bob (Bob follows, co-present)
      check('the muster stages the whole party', _test.stagings.get(_test.playerStaging.get(player.id))?.members.length === 2, JSON.stringify([..._test.stagings.values()].map(s => s.members)));
      await run('journey say hold up'); // leader posts to the private party comms
      const pstg = _test.stagings.get(_test.playerStaging.get(player.id));
      check('journey say posts a line to the muster comms, tagged to the sender',
        pstg?.chat?.length === 1 && pstg.chat[0].pid === player.id && pstg.chat[0].message === 'hold up', JSON.stringify(pstg?.chat));
      await run('ready'); // leader readies — party still holding on Bob
      check('a party muster holds until ALL are ready', !player._crossing, `crossing=${!!player._crossing}`);
      await commands.ready([], 'ready', bob, () => {}); // Bob readies → all ready → launch
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
    await launch();
    const ec = _test.crossings.get(player._crossing.instanceId);
    const foeRoom = [...ec.roomSet].find(id => id !== ec.entry);
    const inst = _test.spawnFoe(ec, foeRoom);
    check('an encounter spawns a real enemy into the room',
      !!inst && !!getEnemyInstance(inst.instanceId) && getZone(foeRoom).enemies.has(inst.instanceId) && ec.enemies.has(inst.instanceId), `inst=${inst?.instanceId}`);
    // The pack scales to the party (capped): solo→1, 4→2, big party→MAX.
    const set = (n) => ({ members: new Set(Array.from({ length: n }, (_, i) => `m${i}`)) });
    check('the encounter pack scales to the party, capped',
      _test.foesFor(set(1)) === 1 && _test.foesFor(set(4)) === 2 && _test.foesFor(set(20)) === _test.MAX_VOID_FOES,
      `1→${_test.foesFor(set(1))} 4→${_test.foesFor(set(4))} 20→${_test.foesFor(set(20))}`);
    // Hard nodes: seeded (a minority of rooms), and spawn one past the cap.
    const hs = Array.from({ length: 60 }, (_, i) => _test.isHardNode('region_coldwater', 5, `probe${i}`));
    check('hard nodes are a seeded minority of rooms',
      hs.some(Boolean) && hs.some(x => !x) && hs.filter(Boolean).length < 30, `hard=${hs.filter(Boolean).length}/60`);
    check('the hard-foe roster loads (tougher tier)', _test.hardFoePool().length > 0, `hard=${_test.hardFoePool().length}`);
    const hardRoom = [...ec.roomSet].filter(id => id !== ec.entry && id !== foeRoom)[0];
    getZone(hardRoom).flags.void_hard = true;
    _test.spawnFoe(ec, hardRoom);
    check('a hard node spawns one past the party cap',
      getZone(hardRoom).enemies.size === _test.foesFor(ec) + 1,
      `${getZone(hardRoom).enemies.size} vs ${_test.foesFor(ec) + 1}`);
    _test.teardownInstance(ec);
    check('tearing down an instance despawns its foes', !getEnemyInstance(inst.instanceId) && !_test.crossings.has(ec.id),
      `enemyGone=${!getEnemyInstance(inst?.instanceId)} instanceGone=${!_test.crossings.has(ec.id)}`);
    delete player._crossing;

    // ── Foes bar the way forward: south is sealed until the room is cleared ─────
    player.current_zone = GATE; player._lastStepAt = 0;
    await launch();
    const gk = _test.crossings.get(player._crossing.instanceId);
    player.current_zone = gk.entry; player._lastStepAt = 0;
    const barFoe = _test.spawnFoe(gk, gk.entry);
    player._lastStepAt = 0;
    const barred = await run('south');
    check('a live foe bars the way forward (south) in the void',
      !!barFoe && player.current_zone === gk.entry, `zone=${player.current_zone} msg=${barred?.message?.slice(0, 40)}`);
    removeEnemyInstance(barFoe.instanceId); // clear the foe (as a kill would)
    player._lastStepAt = 0;
    await run('south');
    check('clearing the foe opens the way forward again', player.current_zone !== gk.entry, `zone=${player.current_zone}`);
    wipe();

    // ── Ghost-traces (Slice 3): scrawls + corpses, cached per (void, window) ──
    player.current_zone = GATE; player._lastStepAt = 0;
    await launch();
    const tc = _test.crossings.get(player._crossing.instanceId);
    const scrawlSalt = getZone(tc.entry).flags.void_salt;
    const sres = await run('scrawl running low');
    check('scrawl leaves a ≤4-char note at the room (cached)',
      /RUNN/.test(sres?.message || '') && traces.getTraces(tc.voidKey, tc.window, scrawlSalt).some(t => t.kind === 'scrawl' && t.note === 'RUNN'),
      `msg=${sres?.message?.slice(0, 40)} cache=${JSON.stringify(traces.getTraces(tc.voidKey, tc.window, scrawlSalt))}`);

    // Dying in the void leaves a corpse trace at that room AND cleans up the crossing.
    const deathRoom = [...tc.roomSet].find(id => id !== tc.entry);
    const deathSalt = getZone(deathRoom).flags.void_salt;
    player.current_zone = deathRoom;
    await _test.handleDeath({ player, deathZone: deathRoom, cause: { label: 'Killed by a rad-mutant' } });
    check('dying in the void leaves a corpse trace at that room',
      traces.getTraces(tc.voidKey, tc.window, deathSalt).some(t => t.kind === 'corpse' && t.handle === player.handle), 'no corpse');
    check('death cleans up the dangling crossing (respawn is not a cmdMove)',
      !player._crossing && !_test.crossings.has(tc.id), `crossing=${!!player._crossing} instance=${_test.crossings.has(tc.id)}`);

    // Outside the void, scrawl is a gentle no-op.
    player.current_zone = savedZone;
    const noScrawl = await run('scrawl HELP');
    check('scrawl outside the void is a gentle no-op', /nothing out here/i.test(noScrawl?.message || ''), noScrawl?.message?.slice(0, 40));

    // ── Salvage (Slice 5): scavenge a void room, once, Scavenging-gated ───────
    player.current_zone = GATE; player._lastStepAt = 0;
    await launch();
    const lc = _test.crossings.get(player._crossing.instanceId);
    const lcBig = _test.bigScoreSalt(lc.voidKey, lc.window, VOIDS[lc.voidKey].trunk);
    const spineRooms = [...lc.roomSet].filter(id => id !== lc.entry && !lc.detourSet.has(id) && getZone(id).flags.void_salt !== lcBig);
    player.current_zone = spineRooms[0];
    _test.setSalvage(1); // force a good roll
    const got = await run('sift');
    check('salvage yields loot on a good roll', /item-grant|pocket/i.test(got?.message || ''), got?.message?.slice(0, 60));
    const again = await run('sift');
    check('a room can only be salvaged once per crossing', /already picked/i.test(again?.message || ''), again?.message?.slice(0, 50));
    player.current_zone = spineRooms[1];
    _test.setSalvage(0); // force a bad roll
    const dud = await run('sift');
    check('a bad roll comes up empty', /grit|disappointment/i.test(dud?.message || ''), dud?.message?.slice(0, 50));
    check('the void loot table is tiered (staples → rare)', _test.LOOT[1].diff < _test.LOOT[2].diff && _test.LOOT[2].diff < _test.LOOT[3].diff, JSON.stringify(Object.keys(_test.LOOT)));
    player.current_zone = savedZone; delete player._crossing;
    const noSalv = await run('sift');
    check('salvage outside the void is a gentle no-op', /nothing out here/i.test(noSalv?.message || ''), noSalv?.message?.slice(0, 40));

    // ── Slice 5b: corpse-packs (loot the dead, first-come) ────────────────────
    _test.setSalvage(1);
    player.current_zone = GATE; player._lastStepAt = 0;
    await launch();
    const pc = _test.crossings.get(player._crossing.instanceId);
    const bsSalt = _test.bigScoreSalt(pc.voidKey, pc.window, VOIDS[pc.voidKey].trunk);
    const packRoom = [...pc.roomSet].find(id => /reach|exodus/.test(getZone(id).flags.void_salt)); // a limb room (not the trunk big-score)
    const packSalt = getZone(packRoom).flags.void_salt;
    await traces.addTrace(pc.voidKey, pc.window, packSalt, 'corpse', 'Kaz', 'killed by a rad-mutant', ['item_water_bottle', 'item_scrap_metal']);
    player.current_zone = packRoom;
    const loot = await run('sift');
    check('sifting a corpse strips its pack', /strip|Kaz/i.test(loot?.message || '') && /item-grant/.test(loot?.message || ''), loot?.message?.slice(0, 70));
    check('a looted corpse-pack is claimed (async first-come)',
      traces.getTraces(pc.voidKey, pc.window, packSalt).find(t => t.kind === 'corpse')?.claimed === true, 'not claimed');
    const loot2 = await run('sift'); // claimed → falls through to ambient scav, not another strip
    check('a claimed corpse cannot be stripped twice', !/strip/i.test(loot2?.message || ''), loot2?.message?.slice(0, 50));
    wipe();

    // ── Slice 5b: the weekly big score (claimed globally, first-come) ─────────
    player.current_zone = GATE; player._lastStepAt = 0;
    await launch();
    const gc = _test.crossings.get(player._crossing.instanceId);
    const bsRoom = [...gc.roomSet].find(id => getZone(id).flags.void_salt === bsSalt);
    player.current_zone = bsRoom;
    const bs = await run('sift');
    check('the big score is claimable', /prize|wreck/i.test(bs?.message || '') && /item-grant/.test(bs?.message || ''), bs?.message?.slice(0, 70));
    check('claiming the big score records a global claim',
      traces.getTraces(gc.voidKey, gc.window, bsSalt).some(t => t.kind === 'bigscore_claim'), 'no claim');
    wipe();
    // A later crosser (fresh instance, same window/salt) finds it already gone.
    player.current_zone = GATE; player._lastStepAt = 0;
    await launch();
    const gc2 = _test.crossings.get(player._crossing.instanceId);
    player.current_zone = [...gc2.roomSet].find(id => getZone(id).flags.void_salt === bsSalt);
    const bs2 = await run('sift');
    check('the big score is gone for the next crosser (claimed globally)', !/the prize this stretch/i.test(bs2?.message || ''), bs2?.message?.slice(0, 60));
    wipe();

    // ── Slice 6: the frontier map (fogged discovery) ──────────────────────────
    await query("DELETE FROM player_flags WHERE player_id=$1 AND flag_key='frontier_log'", [player.id]).catch(() => {});
    player.current_zone = NONVOID; delete player._crossing;
    const noGate = await run('frontier');
    check('frontier outside a void-region says so', /no way to strike out|frontier region/i.test(noGate?.message || ''), noGate?.message?.slice(0, 40));
    player.current_zone = GATE;
    const read = await run('frontier');
    check('frontier at a gate reads out the reachable regions', /The Reach/.test(read?.message || '') && /Exodus/.test(read?.message || ''), read?.message?.slice(0, 60));
    const fv = await _test.frontierView(player);
    check('reading a gate charts its routes (fogged discovery)',
      !!fv['Coldwater'] && fv['Coldwater'].some(r => r.heading === 'The Reach' && r.state === 'charted'), JSON.stringify(fv));
    await _test.markSurvived(player, VOIDKEY, 'reach');
    const fv2 = await _test.frontierView(player);
    check('surviving a crossing upgrades the route to survived',
      fv2['Coldwater']?.some(r => r.heading === 'The Reach' && r.state === 'survived'), JSON.stringify(fv2));
    await query("DELETE FROM player_flags WHERE player_id=$1 AND flag_key='frontier_log'", [player.id]).catch(() => {});
  } finally {
    _test.setEncounters(true);
    _test.setSalvage(null);
    await query(`DELETE FROM void_traces WHERE void_key='${VOIDKEY}'`).catch(() => {});
    await query('DELETE FROM player_inventory WHERE player_id=$1', [player.id]).catch(() => {});
    wipe();
    for (const [id, z] of prev) { if (z) world.zones.set(id, z); else world.zones.delete(id); }
    player.current_zone = savedZone;
  }
}
