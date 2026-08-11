// Waste Crossing regression suite — run by tests/regress.js (never in production).
// Drives the real configured void using SYNTHETIC gate + destination zones, so it
// doesn't depend on (possibly uncommitted) world content being loaded.
import { world, getZone, isTransientZone, setLivePlayer, removeLivePlayer,
  addPlayerToZone, removePlayerFromZone, getEnemyInstance, removeEnemyInstance, getMinimapData } from '../../server/engine/world.js';
import { query } from '../../server/models/db.js';
import { getItem } from '../../server/engine/items-cache.js';
import { VOIDS, _test, commands } from './index.js';
import { _test as traces } from './traces.js';

const GATE = 'zone_regress_voidgate';
const NONVOID = 'zone_regress_nonvoid';
const NEIGHBOUR = 'zone_regress_voidneighbour';
const FILLER = 'zone_regress_voidfill';
const WATER = 'zone_regress_voidwater';
const FILLERS = [[2001, 1999], [2001, 2001], [2002, 2000]]; // box NEIGHBOUR in on n/s/e
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
  const fixtureIds = [GATE, NONVOID, NEIGHBOUR, WATER, REACH, EXODUS, ...FILLERS.map((_, i) => `${FILLER}${i}`)];
  for (const id of fixtureIds) prev.set(id, world.zones.get(id));
  // Parked at 2000+ — well clear of real map_world content (x 863-955, y 896-995),
  // so the isMapRim scan sees genuine emptiness around GATE. Offsets from GATE are
  // what set limb length, so they're preserved verbatim from the old 900,900 origin.
  world.zones.set(GATE, mkZone(GATE, 'Test Gate', { map_id: 'map_world', flags: { region_id: VOIDKEY }, grid_x: 2000, grid_y: 2000 }));
  world.zones.set(NONVOID, mkZone(NONVOID, 'Nowhere', { map_id: 'map_world', grid_x: 2100, grid_y: 2000 })); // no region_id → not a void gate
  world.zones.set(REACH, mkZone(REACH, 'The Reach', { map_id: 'map_world', grid_x: 2000, grid_y: 2630 }));   // 630 tiles → total 7
  world.zones.set(EXODUS, mkZone(EXODUS, 'Exodus', { map_id: 'map_world', grid_x: 2450, grid_y: 2000 }));     // 450 tiles → total 5
  // A real neighbour east of GATE with no exit joining them: the 483-case that used
  // to open the muster and must now stay an ordinary wall. Boxed in on its other
  // three sides by fillers so it is genuinely INLAND — a tile with no rim at all.
  world.zones.set(NEIGHBOUR, mkZone(NEIGHBOUR, 'Next Door', { map_id: 'map_world', flags: { region_id: VOIDKEY }, grid_x: 2001, grid_y: 2000 }));
  // Open water on the map's edge: 109 real rim tiles are basin (the whole y=896 row),
  // and you don't walk into the waste off a tile you're swimming in.
  world.zones.set(WATER, mkZone(WATER, 'Open Basin', { map_id: 'map_world', flags: { region_id: VOIDKEY, terrain: 'water' }, grid_x: 2000, grid_y: 2005 }));
  // The rim test asks the DERIVED `liquid` property, not the paint (the build
  // resolves terrain water ⇒ liquid). A synthetic tile is never built, so the
  // fixture supplies the row the build would have written — otherwise the basin
  // reads as solid ground and grows a rim it must not have.
  const prevRender = new Map();
  const derive = (id, props) => { prevRender.set(id, world.render.get(id)); world.render.set(id, { zone_id: id, spec: {}, props }); };
  derive(WATER, { liquid: true, swimmable: true, routable: false, buildable: false });
  FILLERS.forEach(([fx, fy], i) =>
    world.zones.set(`${FILLER}${i}`, mkZone(`${FILLER}${i}`, 'Filler', { map_id: 'map_world', flags: { region_id: VOIDKEY }, grid_x: fx, grid_y: fy })));

  // The rim index is coordinate-cached with a TTL; the fixtures above were injected
  // after any earlier build, so force a rebuild or NEIGHBOUR reads as empty space.
  _test.invalidateRimIndex();

  const wipe = () => {
    for (const c of _test.crossings.values()) for (const id of c.roomSet) world.zones.delete(id);
    _test.crossings.clear();
    delete player._crossing;
  };

  _test.setEncounters(false); // keep movement/traversal tests deterministic
  // Pin the seed window. Layout, detours, hard nodes and the big-score room are all
  // seeded off (voidKey, window), and the live window is the real-world WEEK — so an
  // untouched tree would walk a different waste every Monday and this gate could go
  // red on nobody's change. A fixed window makes every seeded choice below reproducible.
  _test.setWindow(2900);
  // Solo helper: step off the rim to open the muster, then `ready` (all ready → launch).
  const launch = async () => { player._lastStepAt = 0; await run('north'); return run('ready'); };
  try {
    // ── The muster: stepping off the rim opens staging; ready launches ─────────
    player.current_zone = GATE; player._lastStepAt = 0;
    const stage = await run('north'); // (2000,1999) holds no tile → the rim
    check('stepping off the rim opens the muster overlay instead of launching',
      stage?.type === 'voidwalk_staging' && !player._crossing, `${stage?.type} crossing=${!!player._crossing}`);
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
    check('walking off the edge opens the muster', walked?.type === 'voidwalk_staging' && !player._crossing, `${walked?.type}`);
    await run('ready');
    check('readying from the walk-off muster launches the crossing',
      !!player._crossing && player.current_zone === _test.crossings.get(player._crossing.instanceId).entry, `zone=${player.current_zone}`);
    wipe();
    // Any rim direction opens the muster (not just one).
    player.current_zone = GATE; player._lastStepAt = 0;
    const west = await run('west'); // (1999,2000) holds no tile → also the rim
    check('any rim direction of a void-region opens the muster', west?.type === 'voidwalk_staging' && !player._crossing, `${west?.type}`);
    await run('voidwalk cancel'); // close the muster before the next case

    // The rim is missing TILES, not missing exits. GATE has a real neighbour east
    // with no exit joining them — that must stay an ordinary wall, or every facade
    // and water margin in the world becomes a void gate.
    player.current_zone = GATE; player._lastStepAt = 0;
    const notRim = await run('east');
    check('an unexited neighbour is a wall, not the rim',
      notRim?.type === 'error' && /no exit/i.test(notRim?.message || ''), `${notRim?.type}: ${notRim?.message}`);

    // `voidwalk` is no longer an entry point — walking out of the world is the only way in.
    player.current_zone = GATE; player._lastStepAt = 0;
    const verb = await run('voidwalk');
    check('the voidwalk verb no longer opens the muster',
      verb?.type !== 'voidwalk_staging' && !player._crossing && !_test.stagings.size, `${verb?.type}`);

    // ── The rim announces itself before you can walk off it ───────────────────
    const rimLine = await _test.describeRim(getZone(GATE));
    check('a rim tile says where the ground runs out',
      /ground runs out/.test(rimLine || '') && /north, south and west/.test(rimLine || ''), rimLine?.slice(0, 90));
    check('the rim line names only open directions (east holds a real neighbour)',
      !/east/.test(rimLine || ''), rimLine?.slice(0, 90));
    check('an inland tile gets no rim line at all',
      await _test.describeRim(getZone(NEIGHBOUR)) === undefined, `${await _test.describeRim(getZone(NEIGHBOUR))}`);
    check('a rim with no void behind it says nothing', await _test.describeRim(getZone(NONVOID)) === undefined, 'nonvoid');
    check('a coordless interior gets no rim line', await _test.describeRim({ id: 'x', map_id: 'map_interior_x' }) === undefined, 'interior');
    check('open water has no rim in any direction', _test.rimDirs(getZone(WATER)).length === 0, `${_test.rimDirs(getZone(WATER))}`);
    check('a water edge gets no rim line', await _test.describeRim(getZone(WATER)) === undefined, 'water');
    player.current_zone = WATER; player._lastStepAt = 0;
    const sea = await run('north'); // nothing north of it, but it is basin — not the waste
    check('walking off a water edge is a wall, not the void',
      sea?.type === 'error' && /no exit/i.test(sea?.message || ''), `${sea?.type}: ${sea?.message}`);

    // Off the rim in a NON-void region is a plain wall.
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
      await run('north'); // leader steps off the rim → musters leader + Bob (Bob follows, co-present)
      check('the muster stages the whole party', _test.stagings.get(_test.playerStaging.get(player.id))?.members.length === 2, JSON.stringify([..._test.stagings.values()].map(s => s.members)));
      await run('voidwalk say hold up'); // leader posts to the private party comms
      const pstg = _test.stagings.get(_test.playerStaging.get(player.id));
      check('voidwalk say posts a line to the muster comms, tagged to the sender',
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
    // Three distinct un-salvaged rooms are needed below (good roll, repeat, bad roll,
    // unforced roll). Assert the fixture rather than indexing off the end — a seed that
    // shrank the spine used to surface as an undefined-zone crash halfway down the suite.
    check('a crossing has enough plain spine rooms to test salvage', spineRooms.length >= 3, `spine=${spineRooms.length}`);
    player.current_zone = spineRooms[0];
    _test.setSalvage(1); // force a good roll
    const got = await run('loot');
    check('salvage yields loot on a good roll', /item-grant|pocket/i.test(got?.message || ''), got?.message?.slice(0, 60));
    const again = await run('loot');
    check('a room can only be salvaged once per crossing', /already picked/i.test(again?.message || ''), again?.message?.slice(0, 50));
    player.current_zone = spineRooms[1];
    _test.setSalvage(0); // force a bad roll
    const dud = await run('loot');
    check('a bad roll comes up empty', /grit|disappointment/i.test(dud?.message || ''), dud?.message?.slice(0, 50));
    check('the void loot table is tiered (staples → rare)', _test.LOOT[1].diff < _test.LOOT[2].diff && _test.LOOT[2].diff < _test.LOOT[3].diff, JSON.stringify(Object.keys(_test.LOOT)));
    // Every entry is [itemId, maxQty] against a REAL item — a typo here is a silent
    // no-op grant (the INSERT is .catch()'d), i.e. a dig that yields nothing forever.
    const bad = [];
    for (const [tier, t] of Object.entries(_test.LOOT))
      for (const e of t.items) {
        if (!Array.isArray(e) || typeof e[0] !== 'string' || !(e[1] >= 1)) { bad.push(`t${tier}:${JSON.stringify(e)}`); continue; }
        if (!getItem(e[0])) bad.push(`t${tier}:${e[0]} (no such item)`);
      }
    check('every loot entry is [realItemId, maxQty>=1]', bad.length === 0, bad.join(', '));
    check('the small/medium band is wide', _test.LOOT[1].items.length >= 8 && _test.LOOT[2].items.length >= 10,
      `t1=${_test.LOOT[1].items.length} t2=${_test.LOOT[2].items.length}`);
    // A near-miss pays out rubbish rather than nothing (forced rolls stay hard).
    _test.setSalvage(null);
    player.current_zone = spineRooms[2];
    const near = await run('loot');
    check('an unforced dig returns a dud or a grant, never a crash',
      /grit|item-grant/i.test(near?.message || ''), near?.message?.slice(0, 60));
    player.current_zone = savedZone; delete player._crossing;
    const noSalv = await run('loot');
    check('loot outside the void falls through to engine corpse looting', /corpse/i.test(noSalv?.message || ''), noSalv?.message?.slice(0, 40));

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
    const loot = await run('loot');
    check('looting a corpse strips its pack', /strip|Kaz/i.test(loot?.message || '') && /item-grant/.test(loot?.message || ''), loot?.message?.slice(0, 70));
    check('a looted corpse-pack is claimed (async first-come)',
      traces.getTraces(pc.voidKey, pc.window, packSalt).find(t => t.kind === 'corpse')?.claimed === true, 'not claimed');
    const loot2 = await run('loot'); // claimed → falls through to ambient scav, not another strip
    check('a claimed corpse cannot be stripped twice', !/strip/i.test(loot2?.message || ''), loot2?.message?.slice(0, 50));
    wipe();

    // ── Slice 5b: the weekly big score (claimed globally, first-come) ─────────
    player.current_zone = GATE; player._lastStepAt = 0;
    await launch();
    const gc = _test.crossings.get(player._crossing.instanceId);
    const bsRoom = [...gc.roomSet].find(id => getZone(id).flags.void_salt === bsSalt);
    player.current_zone = bsRoom;
    const bs = await run('loot');
    check('the big score is claimable', /prize|wreck/i.test(bs?.message || '') && /item-grant/.test(bs?.message || ''), bs?.message?.slice(0, 70));
    check('claiming the big score records a global claim',
      traces.getTraces(gc.voidKey, gc.window, bsSalt).some(t => t.kind === 'bigscore_claim'), 'no claim');
    wipe();
    // A later crosser (fresh instance, same window/salt) finds it already gone.
    player.current_zone = GATE; player._lastStepAt = 0;
    await launch();
    const gc2 = _test.crossings.get(player._crossing.instanceId);
    player.current_zone = [...gc2.roomSet].find(id => getZone(id).flags.void_salt === bsSalt);
    const bs2 = await run('loot');
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

    // ── The road home ────────────────────────────────────────────────────────
    // The void used to be one-way: only Coldwater had a VOIDS entry, so every region you could
    // reach was somewhere you could not leave by road. Terminus made it a real trap — its pad is
    // `vtol_only, charter: false`, so a trucker who drove there was stranded unless they already
    // owned an aircraft. Anything reachable has to be leavable, and the return has to be the SAME
    // distance, or the tank that got you there cannot get you back.
    for (const v of Object.values(VOIDS)) {
      for (const d of v.dests) {
        const to = d.region;
        check(`the ${d.heading} limb lands on a zone that exists`, !!getZone(d.dest), d.dest);
        check(`${d.heading} is not a one-way trip — it has a road out`, !!VOIDS[to], to);
      }
    }
    for (const [from, v] of Object.entries(VOIDS)) {
      for (const d of v.dests) {
        const to = d.region;
        const back = VOIDS[to]?.dests?.find(b => b.region === from);
        check(`${from} → ${d.heading} has a matching leg back`, !!back, `${from} -> ${to}`);
        if (back) check(`…and the way home is as long as the way out`, back.length === d.length,
          `out ${d.length}, back ${back.length}`);
      }
    }
  } finally {
    _test.setEncounters(true);
    _test.setSalvage(null);
    _test.setWindow(null);
    await query(`DELETE FROM void_traces WHERE void_key='${VOIDKEY}'`).catch(() => {});
    await query('DELETE FROM player_inventory WHERE player_id=$1', [player.id]).catch(() => {});
    wipe();
    for (const [id, z] of prev) { if (z) world.zones.set(id, z); else world.zones.delete(id); }
    for (const [id, r] of prevRender) { if (r) world.render.set(id, r); else world.render.delete(id); }
    player.current_zone = savedZone;
  }
}
