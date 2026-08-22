// Waste Crossing regression suite — run by tests/regress.js (never in production).
// Drives the real configured void using SYNTHETIC gate + destination zones, so it
// doesn't depend on (possibly uncommitted) world content being loaded.
import { world, getZone, isTransientZone, setLivePlayer, removeLivePlayer,
  addPlayerToZone, removePlayerFromZone, getEnemyInstance, removeEnemyInstance, getMinimapData, getZoneEnemies, getAllZones } from '../../server/engine/world.js';
import { emit } from '../../server/engine/events.js';
import { query } from '../../server/models/db.js';
import { getItem } from '../../server/engine/items-cache.js';
import { VOIDS, _test, commands, crossingChain } from './index.js';
import { _test as traces } from './traces.js';
import { VOID_TERRAINS, CUT_TERRAINS, GROUND, FEATURES, featureFor, _test as _flavour } from './flavour.js';

// A local deterministic generator for the flavour probes below. Deliberately NOT the plugin's own
// mulberry32: these cases test the tables, not the seeding, and reaching into index.js internals to
// test a sibling module would couple them for no gain.
const probeRng = (n) => { let a = (n * 0x9E3779B1) >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

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
  // ── VOID COUNTRY: the flavour tables are content, and content can be wrong ──
  // These cost nothing to run and catch the three ways this file breaks silently: ground with no
  // words written for it, a feature whose `kind` nothing will ever read, and the em dash.
  {
    for (const t of VOID_TERRAINS.concat(CUT_TERRAINS)) {
      const g = GROUND[t];
      check(`void ground "${t}" has names and descriptions`,
        !!g && g.names?.length >= 3 && g.descs?.length >= 3,
        `names=${g?.names?.length} descs=${g?.descs?.length}`);
    }
    const ids = FEATURES.map(f => f.id);
    check('every void highlight is well formed',
      FEATURES.every(f => f.id && f.name && f.desc && _flavour.KINDS.includes(f.kind)),
      FEATURES.filter(f => !(f.id && f.name && f.desc && _flavour.KINDS.includes(f.kind))).map(f => f.id || f.name).join(','));
    check('void highlight ids are unique', new Set(ids).size === ids.length);
    // A `terrains` list naming ground nobody wrote words for is a feature that can never appear.
    const known = new Set(VOID_TERRAINS.concat(CUT_TERRAINS));
    const orphan = FEATURES.filter(f => f.terrains && f.terrains.some(t => !known.has(t)));
    check('no highlight is gated to ground that does not exist', orphan.length === 0,
      orphan.map(f => `${f.id}:${f.terrains}`).join(' '));
    // Every KIND must be reachable, or it is a contract nothing can ever satisfy.
    for (const k of _flavour.KINDS) {
      check(`the "${k}" highlight kind has at least one entry`, FEATURES.some(f => f.kind === k));
    }

    // ⚠ THE EM DASH IS THE ARCHITECT'S AND THE ASCENDANTS' (docs/story.md). It is a voice marker
    // rather than punctuation, and it only reads as one if nothing else in the world uses it. The
    // waste has no opinions and nobody out there is talking, so none of this prose may carry one.
    // Checked rather than trusted, because it is exactly the kind of rule that erodes one edit at a
    // time and nothing else in the suite would ever notice.
    const prose = [
      ...Object.values(GROUND).flatMap(g => [...g.names, ...g.descs]),
      ...FEATURES.flatMap(f => [f.name, f.desc]),
    ];
    const dashed = prose.filter(s => /[—–]| - | -- /.test(s));
    check('no void prose uses an em dash (it belongs to the Architect)', dashed.length === 0,
      dashed.slice(0, 3).join(' | '));

    // The roll that says "something is here" must never be spent on nothing: an unwritten kind for
    // this ground falls through to a marker rather than returning null after the chance passed.
    let fired = 0, nulls = 0;
    for (let i = 0; i < 4000; i++) {
      const r = featureFor(probeRng(i + 1), VOID_TERRAINS[i % VOID_TERRAINS.length]);
      if (r === null) continue;
      fired++;
      if (!r.id) nulls++;
    }
    check('featureFor never fires onto an empty highlight', fired > 0 && nulls === 0, `fired=${fired} empty=${nulls}`);

    // ── A HIGHLIGHT'S MECHANICS ARE ORDINARY ZONE TAGS ────────────────────────
    // Nothing here teaches the void a mechanic. A rad pocket sets `radiation` and the engine's own
    // getZoneRadiation charges for it; a spring sets `water_source` and cooking's `fill` reads it.
    // ⚠ SO AN UNKNOWN KEY IS A TYPO THAT WILL NEVER FIRE AND NEVER COMPLAIN — which is the whole
    // failure mode this catches, since a highlight with a misspelt flag looks completely correct.
    const MECHANICAL = new Set(['radiation', 'water_source', 'stove_tier']);
    const badFlag = FEATURES.filter(f => f.flags && Object.keys(f.flags).some(k => !MECHANICAL.has(k)));
    check('every highlight flag is a key something reads', badFlag.length === 0,
      badFlag.map(f => `${f.id}:${Object.keys(f.flags)}`).join(' '));
    // Each kind that claims a capability must actually carry it, or the prose promises what the
    // mechanics do not deliver.
    for (const [kind, key] of [['water', 'water_source']]) {
      const missing = FEATURES.filter(f => f.kind === kind && !f.flags?.[key]);
      check(`every "${kind}" highlight carries ${key}`, missing.length === 0, missing.map(f => f.id).join(' '));
    }
    check('a rad pocket carries real radiation',
      (FEATURES.find(f => f.id === 'hazard_rad')?.flags?.radiation || 0) > 0);
  }

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
    // The whole braid, on purpose: this is a test of the ROUTE's shape, and the limbs hang four hops
    // past the threshold the player is standing on, so under windowing they are correctly not made yet.
    _test.materialiseAll(c);
    const fork = `${c.id}_t${c.plan.trunkLen - 1}`;
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
    for (let i = 0; i < c2.plan.trunkLen - 1; i++) { player._lastStepAt = 0; await run('south'); } // to the fork
    check('you can walk the shared trunk to the fork', player.current_zone === `${c2.id}_t${c2.plan.trunkLen - 1}`, player.current_zone);
    player._lastStepAt = 0; await run('east'); // divert toward Exodus
    const exodusLimbLen = _test.totalLength(vdef.dests[1], getZone(GATE), getZone(EXODUS)) - c2.plan.trunkLen;
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

    // ── THE PLAN IS THE ROUTE; THE WINDOW IS WHAT EXISTS ──────────────────────
    // Everything below asks the PLAN, deliberately. A route-level guarantee ("this heading offers a
    // gamble") is about the crossing, not about which twenty yards of it happen to be made right now,
    // and testing it through `getZone` would have quietly become a test of the window instead. That
    // is the exact mistake the split exists to make impossible, so the suite has to model it too.
    check('nothing is materialised that is not on the plan',
      [...bc.roomSet].every(id => bc.plan.all.has(id)));
    check('every materialised detour is a planned detour',
      [...bc.detourSet].every(id => bc.plan.detourIds.has(id)),
      `live=${bc.detourSet.size} plan=${bc.plan.detourIds.size}`);

    // ⚠ THE WINDOW IS BOUNDED, AND THAT IS THE WHOLE POINT. If this ever equals the plan again,
    // windowing has silently regressed to eager and the 282-room crossing is back to building itself
    // in full the moment somebody steps off the rim.
    check('the window holds only part of the route', bc.roomSet.size < bc.plan.all.size,
      `live=${bc.roomSet.size} plan=${bc.plan.all.size}`);
    check('the threshold room is made', bc.roomSet.has(bc.entry));

    // ── THE TRAIL IS SOMEWHERE ────────────────────────────────────────────────
    // A crossing room had no position at all until the trail went on the map. It has one now, taken
    // from the anchored road between the same two gates, so the walker's route and the driver's are
    // the same journey rather than two derivations that would drift.
    {
      const placed = [...bc.plan.rooms.values()].filter(r => r.pt);
      check('the plan lays its rooms on the ground', placed.length > 0,
        `${placed.length}/${bc.plan.rooms.size}`);
      const z = getZone(bc.entry);
      check('a materialised room carries its coordinates',
        z && Number.isInteger(z.grid_x) && Number.isInteger(z.grid_y), `${z?.grid_x},${z?.grid_y}`);

      // ⚠ AND IT IS STILL NOT PLACED GROUND. This is the line the whole overlay rests on: the world
      // sweep excludes transient zones by the MARKER, not by missing coordinates, so a room having a
      // grid_x cannot put it into `surfaceAt`, `regionGates` or voidwalking's own rim index. If this
      // ever fails, every road mouth and the entire map rim have moved.
      check('…and is still invisible to the placed-ground sweep',
        !getAllZones().some(w => w.id === bc.entry));
      check('…and keeps a non-world map id', z?.map_id !== 'map_world', z?.map_id);

      // ── THE CAMPS ARE ON THE WALK, NOT JUST ON THE ROAD ────────────────────
      // The corridor names the band a driver crosses; these are the rooms a WALKER stands in. Both
      // read one geometry (`trailOffsetAt` / `isWaysideAt`), so the camp a trucker pulls over at and
      // the camp somebody is sleeping in are the same place rather than two things with one name.
      {
        const camps = [...bc.plan.rooms.values()].filter(r => r.wayside);
        check('a long crossing passes wayside camps', camps.length > 0,
          `${camps.length} of ${bc.plan.rooms.size}`);
        if (camps.length) {
          const cid = [...bc.plan.rooms.entries()].find(([, r]) => r.wayside)[0];
          const cz = _test.materialise(bc, cid);
          check('a wayside room is the camp', cz?.name === 'A Wayside Camp', cz?.name);
          // ⚠ The barrel and the fire are the ORDINARY tags, which is the whole reason `fill` and the
          // cooking heat check work out here without either being taught about the void.
          check('…and carries water and warmth as ordinary tags',
            cz?.flags?.water_source === true && (cz?.flags?.stove_tier || 0) > 0,
            JSON.stringify({ w: cz?.flags?.water_source, f: cz?.flags?.stove_tier }));
          // A camp is derived, so a rolled highlight must never be sitting on top of it.
          check('…and no rolled highlight sits on top of it', !cz?.flags?.void_feature, cz?.flags?.void_feature);
          // It is relief, not safety: the waste does not stop being lawless because there are tents.
          check('…and it is still lawless ground', cz?.flags?.lawless === true);
        }
      }

      // Consecutive rooms are neighbours on the ground, not scattered along it.
      const a = getZone(bc.plan.trunk[0]), b = getZone(bc.plan.trunk[1]);
      if (a?.grid_x != null && b?.grid_x != null) {
        const step = Math.hypot(b.grid_x - a.grid_x, b.grid_y - a.grid_y);
        check('one room of walking is about one tile of ground', step >= 0.5 && step <= 3, step.toFixed(2));
      }
    }
    // ⚠ AND THE ROOM AHEAD IS ALWAYS MADE. Movement resolves against a zone that must already exist,
    // so every exit out of an occupied room has to be materialised before the step is taken. A skirt
    // of one is the minimum; anything less is a walker stepping into a room that was never built.
    for (const to of Object.values(bc.plan.rooms.get(bc.entry).exits)) {
      if (!bc.plan.rooms.has(to)) continue;                     // the origin tile: real ground
      check('every exit out of the threshold leads somewhere that exists', bc.roomSet.has(to), to);
    }

    // ⚠ crossingChain is THE LONG HAUL's odometer→room mapping and reads the plan rather than parsing
    // ids back out of the materialised set. It must be the trunk followed by one limb, in order, with
    // no detours on it, over the WHOLE route including the part nobody has walked to.
    for (const d of bc.dests) {
      const chain = crossingChain(bc.id, d.key);
      check(`the ${d.key} chain is trunk + limb in order`,
        chain.length === bc.plan.trunk.length + bc.plan.limbs[d.key].length
        && chain[0] === bc.entry
        && chain.every(id => !bc.plan.detourIds.has(id)),
        `len=${chain.length} trunk=${bc.plan.trunk.length} limb=${bc.plan.limbs[d.key].length}`);
      check(`the ${d.key} chain ends at the room that exits to the region`,
        bc.plan.rooms.get(chain[chain.length - 1])?.exits?.south === d.dest,
        `${chain[chain.length - 1]} -> ${bc.plan.rooms.get(chain[chain.length - 1])?.exits?.south}`);
      check(`the ${d.key} chain is entirely on the plan`, chain.every(id => bc.plan.all.has(id)));
    }

    check('a crossing has at least one risk-for-loot detour', bc.plan.detourIds.size >= 1,
      `detours=${bc.plan.detourIds.size}`);
    const detourId = [...bc.plan.detourIds][0];
    const spineId = bc.plan.rooms.get(detourId)?.spine;
    check('a detour hangs off a spine room (west) and exits back (east)',
      !!spineId && bc.plan.rooms.get(spineId)?.exits?.west === detourId
      && bc.plan.rooms.get(detourId)?.exits?.east === spineId,
      `detour=${detourId} spine=${spineId}`);

    // ── RESTING, AND WHAT IT COSTS ─────────────────────────────────────────────
    // Nothing out here heals you, so a respite site grants a heal-over-time rather than the void
    // suppressing a regen that does not exist. What is defended is the PRICE: water, always, and a
    // fresh ambush roll every time — because a rest that got safer the more you did it would turn a
    // cleared room into a hotel.
    {
      const rc = _test.materialiseAll(_test.crossings.get(player._crossing.instanceId));
      const campId = [...rc.plan.rooms.entries()].find(([, r]) => r.wayside)?.[0];
      _test.setEncounters(false);           // the ambush is rolled separately below
      if (campId) {
        player.current_zone = campId;
        player.hp = Math.max(1, Math.floor(player.hp_max * 0.5));
        player.thirst = 90;
        player.healOverTime = [];
        const before = player.thirst;
        const r1 = await run('camp');
        check('resting at a camp is allowed', !/error/i.test(r1?.type || ''), r1?.message?.slice(0, 60));
        check('…and grants a heal over time', (player.healOverTime?.length || 0) > 0);
        check('…paid for in water', player.thirst < before, `${before} → ${player.thirst}`);

        // ⚠ TOO DRY TO REST. Sitting still without water is a slower version of the same problem, and
        // the refusal has to come before the cost rather than after it.
        player.thirst = 3;
        const dry = await run('camp');
        check('…and refused outright when there is no water left in you',
          dry?.type === 'error' && player.thirst === 3, `${dry?.type} thirst=${player.thirst}`);
      }
      // Nowhere to rest is a refusal, not a free heal.
      const plain = [...rc.roomSet].find(id => !getZone(id)?.flags?.void_wayside
        && !['respite', 'shelter'].includes(getZone(id)?.flags?.void_feature_kind));
      if (plain) {
        player.current_zone = plain;
        player.thirst = 90;
        const r2 = await run('camp');
        check('open ground is nowhere to rest', r2?.type === 'error', r2?.message?.slice(0, 50));
      }
      _test.setEncounters(false);
    }

    // ── FLAGGING A TRUCK DOWN ──────────────────────────────────────────────────
    // The social half of the crossing: a walker asks, and a driver decides. What is defended here is
    // that a beacon EXPIRES (a permanent one turns every camp into a taxi rank) and that it is matched
    // to a driver by COORDINATE — two people in the same gap are in different transient rooms, because
    // a crossing is instanced, so position is the only thing they can ever have in common.
    {
      const now = Date.now();
      _test.clearBeacon('probe_a'); _test.clearBeacon('probe_b');
      check('nothing is flagged to begin with', _test.beaconsNear(0, 0, 500, now).length === 0);

      // Drive the store directly: the verb needs a live crossing and a camp underfoot, and what is
      // being tested here is the beacon, not the way in.
      _test.beacons.set('probe_a', { until: now + 60_000, at: now, x: 100, y: 100, zoneId: 'z', handle: 'Walker A' });
      _test.beacons.set('probe_b', { until: now - 1, at: now - 60_000, x: 101, y: 100, zoneId: 'z', handle: 'Walker B' });

      const near = _test.beaconsNear(100, 100, 20, now);
      check('a live beacon is seen from the road', near.length === 1 && near[0].playerId === 'probe_a',
        near.map(b => b.playerId).join(','));
      check('…and an expired one is not', !near.some(b => b.playerId === 'probe_b'));
      // ⚠ EXPIRY IS AT READ, NOT ON A TICK. Nothing about a beacon is worth a timer, so the prune
      // happens where it is asked for — which also means a stale one can never outlive being looked at.
      check('…and reading it prunes the expired one', !_test.beacons.has('probe_b'));

      check('a beacon out of range is not seen', _test.beaconsNear(400, 400, 20, now).length === 0);
      check('…and range is a real distance, not a room', _test.beaconsNear(112, 100, 20, now).length === 1);
      const far = _test.beaconsNear(100, 100, 20, now)[0];
      check('…and it reports how far off it is', far && far.dist === 0, String(far?.dist));

      _test.clearBeacon('probe_a');
      check('a cleared beacon is gone', _test.beaconsNear(100, 100, 20, now).length === 0);
    }

    // ── A CUT IS FINDABLE ──────────────────────────────────────────────────────
    // The branch is a real `east` exit, so the WORD appeared in the room and nothing said what was
    // down it or what it was worth. A choice nobody can see is not a choice, and this was the only
    // genuinely new decision in a crossing.
    {
      const campWithCut = [...bc.plan.rooms.entries()].find(([, r]) => r.cutSaves && r.exits?.east);
      check('some camp offers a way across', !!campWithCut,
        [...bc.plan.rooms.values()].filter(r => r.kind === 'cut').length + ' cut rooms');
      if (campWithCut) {
        const [cid, cr] = campWithCut;
        const line = await _test.describeVoidRoom(getZone(cid) || { id: cid });
        check('…and the room says so', /path goes off east/i.test(line || ''), (line || '').slice(0, 60));
        check('…with what it saves, in tiles', new RegExp(`${cr.cutSaves} tiles`).test(line || ''),
          `expected ${cr.cutSaves}`);
        // ⚠ AND NEVER WHETHER IT IS PASSABLE. Finding the face by walking to it is the whole of what a
        // cut risks; a hint here would refund the gamble before it was taken.
        check('…and never whether it is walkable', !/pitch|sheer|blocked|cliff/i.test(line || ''));
      }
    }

    // ⚠ A PITCH IS ONE ROLL PER CUT, NOT PER ROOM. At 12% per room a 30-room cut was walkable end to
    // end 2% of the time — so nearly every shortcut a player weighed up and chose was a wasted walk,
    // and "sometimes it refuses you" meant "always". This pins the shape: at most one face per cut.
    {
      const withPitch = [...bc.plan.rooms.values()].filter(r => r.kind === 'cut' && r.pitch);
      const byCut = new Map();
      for (const [id, r] of bc.plan.rooms) {
        if (r.kind !== 'cut') continue;
        const key = id.replace(/_\d+$/, '');
        byCut.set(key, (byCut.get(key) || 0) + (r.pitch ? 1 : 0));
      }
      check('no cut carries more than one pitch', [...byCut.values()].every(n => n <= 1),
        [...byCut.entries()].map(([k, n]) => `${k}:${n}`).join(' '));
      check('…and a pitch is a minority of cuts, not all of them',
        withPitch.length <= byCut.size, `${withPitch.length} pitches over ${byCut.size} cuts`);
    }

    // ── A DRIVER IS CARRIED PAST WHAT A WALKER WALKS INTO ─────────────────────
    // Rolling down the road is not exposure: hijackers work a stopped cab and getting out puts you on
    // foot, but a moving rig meets nothing. That used to be done by pre-marking `_crossing.seen` from
    // trucking's crossToNode, which skipped the roll and SPENT it in the same move, so ground you had
    // driven was quiet for the rest of the crossing. At one room per tile that would make a lift
    // launder every tile it covered, so the rule is an explicit `mounted` flag on the event now.
    {
      const drive = _test.materialiseAll(bc).plan.limbs[bc.dests[0].key][1];
      const before = new Set(player._crossing.seen);
      _test.setEncounters(true);
      emit('zone.entered', { actor: player, zone: drive, mounted: true });
      check('a mounted traveller rolls no encounter', getZoneEnemies(drive).length === 0);
      check('…and does not spend the room\'s roll either',
        !player._crossing.seen.has(drive) || before.has(drive),
        `seen=${player._crossing.seen.has(drive)}`);
      _test.setEncounters(false);
    }

    // ── EVERY DECLARED HEADING GETS A GAMBLE ──────────────────────────────────
    // Until 2026-08-21 detours needed an INTERIOR TRUNK room, so Coldwater (trunk 4) was the only
    // void in the game with any: the Reach, Deadwater and the Scarletwastes run a trunk of 2 and
    // Terminus a trunk of 1, and four fifths of the game's crossings had no detour at all with
    // nothing to say so. The guarantee is PER ROUTE rather than per instance, because off a
    // multi-limb fork one heading carrying the only gamble means the other two walk dry, which is
    // the same bug one level down.
    for (const d of bc.dests) {
      const limb = bc.plan.limbs[d.key];
      const route = [...bc.plan.trunk, ...limb];
      const gambles = route.filter(id => bc.plan.detourIds.has(bc.plan.rooms.get(id)?.exits?.west));
      check(`the ${d.key} route offers at least one detour`, gambles.length >= 1,
        `limb=${limb.length} gambles=${gambles.length}`);

      // ⚠ AND NEVER OFF A LIMB'S FIRST ROOM. That room spends one lateral exit, OPPOSITE[d.dir], on
      // the way back to the fork, so for an `east` limb it is `west` itself. A detour written there
      // would overwrite the only path back and read to the player as a gamble rather than as the
      // dead end it is.
      const head = bc.plan.rooms.get(limb[0]);
      check(`the ${d.key} limb keeps its way back (no detour on room 0)`,
        !!head && !bc.plan.detourIds.has(head.exits?.west),
        `west=${head?.exits?.west}`);
    }
    // The minimap payload must flag void rooms so the client swaps to crossing mode.
    // ⚠ The detour has to be MADE for this: getMinimapData walks exits from a real zone, so a planned
    // room that is currently outside the window is correctly invisible to it. Materialising on purpose
    // keeps this a test of the minimap payload rather than an accidental test of the window radius.
    _test.materialiseAll(bc);
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
    // ⚠ THE SAMPLE HAD TO GROW WITH THE DENSITY FLIP, AND THE ASSERTION GOT BETTER FOR IT.
    // Hard nodes were ~1 in 5 ROOMS across a walk of eight, so sixty probes was generous. They are
    // ~1 in 50 TILES now (0.22 → 0.02, or the 282-tile haul would carry sixty-two of them and
    // "bad ground" would stop meaning anything), and sixty probes of a 2% event comes back empty
    // more often than not. So this pins the RATE rather than merely that both outcomes occur —
    // which is what it was reaching for all along.
    const N = 2000;
    const hs = Array.from({ length: N }, (_, i) => _test.isHardNode('region_coldwater', 5, `probe${i}`));
    const hardRate = hs.filter(Boolean).length / N;
    check('hard nodes are a seeded minority of tiles',
      hs.some(Boolean) && hs.some(x => !x) && hardRate > 0.005 && hardRate < 0.06,
      `rate=${hardRate.toFixed(4)} over ${N}`);
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
    const lc = _test.materialiseAll(_test.crossings.get(player._crossing.instanceId));
    const lcBig = _test.bigScoreSalt(lc.voidKey, lc.window, lc.plan.trunkLen);
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
    const pc = _test.materialiseAll(_test.crossings.get(player._crossing.instanceId));
    const bsSalt = _test.bigScoreSalt(pc.voidKey, pc.window, pc.plan.trunkLen);
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
    const gc = _test.materialiseAll(_test.crossings.get(player._crossing.instanceId));
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
    const gc2 = _test.materialiseAll(_test.crossings.get(player._crossing.instanceId));
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
    // ── `march`: the traversal verb ──────────────────────────────────────────
    //
    // The tick is driven by hand rather than by the scheduler, and `_lastStepAt` is cleared before
    // each one: the pacing plugin's move gate vetoes SILENTLY (cmdMove returns null), so back-to-back
    // ticks in a test would stall the walk instead of failing it, which is exactly the shape of red
    // that looks like a march bug and is not one.
    {
      const M = _test.march;
      const savedThirst = player.thirst;
      const marchTick = async () => { player._lastStepAt = 0; await M.tick(); };

      wipe();
      player.current_zone = GATE;
      M.runs.clear();
      const nowhere = await run('march');
      check('march is refused when you are not on a crossing', nowhere?.type === 'error' && !M.runs.size, `${nowhere?.type}`);

      await launch();
      const mc = _test.materialiseAll(_test.crossings.get(player._crossing.instanceId));
      player.thirst = 100;

      const started = await run('march');
      check('march starts a run on the trail', started?.type === 'emote' && M.runs.has(player.id), `${started?.type} runs=${M.runs.size}`);

      // One tile per tick, and it is the ORDINARY move — the player is genuinely in the next room.
      const before = player.current_zone;
      await marchTick();
      check('a march tick walks exactly one tile', player.current_zone === getZone(before)?.exits?.south,
        `${before} -> ${player.current_zone}`);

      // ⚠ RE-ARM BEFORE EVERY CASE BELOW. A tick can legitimately have halted the march (that is the
      // whole point of it), so asserting "still running" against a run left over from the previous
      // case tests nothing on a good day and fails on a seeded one.
      // It also stands the player back on the threshold, which is the one room in the plan that is
      // guaranteed plain (no highlight roll, no encounter roll) and always has a way on.
      const arm = async () => {
        _test.materialiseAll(mc);
        player.current_zone = mc.plan.trunk[0];
        M.runs.clear();
        await run('march');
      };

      // A silent command is the CLIENT talking (the tablet map re-nav fires on every single move).
      // If this cancels, a march dies on its first tile for anybody with the map open.
      await arm();
      emit('player.command', { player, cmd: 'look', silent: true });
      check('a silent client command does not stop a march', M.runs.has(player.id));
      emit('player.command', { player, cmd: 'look', silent: false });
      check('a command the player typed stops a march', !M.runs.has(player.id));

      // `stop` is what the verb's own prompt points at, and it must report itself.
      await arm();
      const stopped = [];
      emit('player.stop', { player, stopped });
      check('the unified stop ends a march and says so', !M.runs.has(player.id) && stopped.includes('walking'), stopped.join(','));

      // ⚠ A BRANCH IS READ OFF THE PLAN, NEVER OFF THE ZONE'S EXITS. A limb's first room carries a
      // lateral exit back to the fork (OPPOSITE of the fork direction, which for an east limb IS
      // west), so an exits-based test would halt a march at the head of every limb in the game.
      // ⚠ RE-MATERIALISE FIRST. These probes stand the player in a room chosen off the PLAN, and the
      // window only makes rooms near somebody — the ticks above have since walked on and evicted
      // them. Without this the zone is null and every case below fails as "the ground stops making
      // sense", which is a true statement about the test and nothing at all about the march.
      {
        _test.materialiseAll(mc);
        const eastKey = mc.dests[1].key;
        const head = mc.plan.limbs[eastKey][0];
        const hz = getZone(head);
        check('a limb head really does carry a lateral exit back to the fork', !!hz?.exits?.west, JSON.stringify(hz?.exits));
        const wasZone = player.current_zone;
        player.current_zone = head;
        check('…and a march does not treat that as a branch', M.haltReason(mc, player) === null,
          String(M.haltReason(mc, player)));
        player.current_zone = wasZone;
      }

      // Scenery is not a decision (KIND_WEIGHTS puts marker at 34% of all features).
      {
        _test.materialiseAll(mc);
        const probe = mc.plan.limbs[mc.dests[0].key][2];
        const pz = getZone(probe);
        const wasFlags = { ...pz.flags };
        const wasZone = player.current_zone;
        player.current_zone = probe;
        pz.flags.void_feature_kind = 'marker';
        check('a marker highlight does not halt a march', M.haltReason(mc, player) === null);
        for (const kind of [...M.ACTIONABLE_KINDS]) {
          pz.flags.void_feature_kind = kind;
          check(`a "${kind}" highlight halts a march`, typeof M.haltReason(mc, player) === 'string', kind);
        }
        pz.flags = wasFlags;
        player.current_zone = wasZone;
      }

      // ⚠ THE FORK, AND THE TRAP IT CARRIES. The obvious reading is that the fork stops a march for
      // free because the trunk loop never writes it a `south`. It is wrong, and this is the case that
      // proved it: each limb hangs off the fork in ITS OWN direction, and Coldwater's first
      // destination heads south — so the fork DOES have a forward exit, and a march that trusted the
      // exits would have walked the player onto a heading nobody chose. Both halves are asserted, in
      // this order, so the day somebody "simplifies" the identity check back to an exit test the
      // first line here tells them why they cannot.
      {
        _test.materialiseAll(mc);
        const fork = mc.plan.fork;
        const wasZone = player.current_zone;
        player.current_zone = fork;
        check('the fork carries a limb SOUTH — it is not stopped by having no way on',
          !!getZone(fork)?.exits?.south, JSON.stringify(getZone(fork)?.exits));
        const why = M.haltReason(mc, player);
        check('…and a march halts there anyway, naming the headings',
          typeof why === 'string' && why.includes(mc.dests[0].heading), String(why));
        const refused = await run('march');
        check('and march refuses to start at the fork', refused?.type === 'error', `${refused?.type}`);
        player.current_zone = wasZone;
      }

      // ⚠ THIRST HALTS ARE GATES YOU CROSS, NOT A LEVEL YOU ARE AT. A flat "stop below 40" would
      // halt every single tile for the rest of a crossing — the verb would stop working exactly
      // where a player most wants it.
      {
        _test.materialiseAll(mc);
        player.current_zone = mc.plan.trunk[0];   // the threshold: plain ground, and it always has a way on
        M.runs.clear();
        player.thirst = 100;
        await run('march');
        check('a full canteen arms every thirst gate', M.runs.get(player.id)?.gates?.length === M.THIRST_GATES.length,
          JSON.stringify(M.runs.get(player.id)?.gates));
        player.thirst = 35;
        await marchTick();
        check('crossing a thirst gate halts the march', !M.runs.has(player.id), `thirst=${player.thirst}`);

        _test.materialiseAll(mc);
        player.current_zone = mc.plan.trunk[0];
        M.runs.clear();
        player.thirst = 35;
        await run('march');
        // The gate is the assertion, not a second tick: whether the NEXT tile happens to hold a
        // highlight is the seed's business, and a case that depends on it is a flake waiting to
        // happen. That a march keeps walking is proved by the one-tile case above.
        check('setting off already dry does not arm a gate you are past',
          M.runs.has(player.id) && !M.runs.get(player.id).gates.includes(40),
          JSON.stringify(M.runs.get(player.id)?.gates));
      }

      // A crossing torn down under somebody's feet takes the march with it.
      _test.materialiseAll(mc);
      player.current_zone = mc.plan.trunk[0];
      M.runs.clear();
      await run('march');
      emit('crossing.ended', { instanceId: player._crossing.instanceId, rooms: [], origin: GATE, voidKey: VOIDKEY });
      check('a crossing ending ends every march on it', !M.runs.has(player.id));

      M.runs.clear();
      player.thirst = savedThirst;
      wipe();
    }

  } finally {
    _test.march.runs.clear();
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
