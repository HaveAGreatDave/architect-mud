// Fishing plugin regression suite — run by tests/regress.js (never loaded in
// production). The fake player stands in a zone with no fishing water and holds
// no rod, so we exercise the gated no-mutation paths (nothing is ever caught)
// plus the pure weighted-pick helper.
import { _test } from './index.js';
import { world } from '../../server/engine/world.js';
import { getItem } from '../../server/engine/items-cache.js';
import { computeSellUnitPrice } from '../../server/engine/vendor.js';
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { emit } from '../../server/engine/events.js';
import { _test as boatT, boatTick, settleBoatBite, endBoatFishing } from './boat.js';
import { rigs } from '../powerboat/index.js';
import { aboard } from '../powerboat/yard.js';
import { _test as holdT } from '../powerboat/hold.js';
import * as R from '../../client/shared/boatfish-rules.js';
import { SPECIES, fishNear, keenness } from '../../client/shared/fish.js';
import { SEA_TILE_M } from '../../client/shared/sea-swell.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();

  // ── Where you can fish (fishingTableFor) ───────────────────────────────────
  // Synthetic tiles parked at 4000+, clear of real world content: one open-water
  // tile, a bank beside it, an inland tile, and a bank that already carries its
  // own authored table.
  const W = 'zone_regress_fish_water', BANK = 'zone_regress_fish_bank',
        INLAND = 'zone_regress_fish_inland', SPECIAL = 'zone_regress_fish_special';
  const mk = (id, x, y, flags) => ({ id, name: id, description: '', exits: {}, flags,
    map_id: 'map_world', grid_x: x, grid_y: y,
    players: new Set(), npcs: new Set(), enemies: new Set(), corpses: new Set() });
  const prevFish = new Map();
  const prevRender = new Map();
  for (const id of [W, BANK, INLAND, SPECIAL]) {
    prevFish.set(id, world.zones.get(id));
    prevRender.set(id, world.render.get(id));
  }
  world.zones.set(W,       mk(W,       4000, 4000, { terrain: 'water' }));
  world.zones.set(BANK,    mk(BANK,    4000, 4001, {}));                       // due south of the water
  world.zones.set(INLAND,  mk(INLAND,  4000, 4003, {}));                       // two tiles off — dry
  world.zones.set(SPECIAL, mk(SPECIAL, 4001, 4000, { fishing_table_id: 'fish_echelon_basin' })); // east of the water
  // Gameplay properties live on the DERIVED row, not on the flags — fishing asks
  // `propsOf(id).liquid`, which the build resolves from the terrain preset. A
  // synthetic tile is not built, so the fixture must supply what the build would:
  // inject the row it would have produced. Without this the water tile reads as
  // dry land and every assertion below quietly inverts.
  const derive = (id, props) => world.render.set(id, { zone_id: id, spec: {}, props });
  derive(W,       { liquid: true, swimmable: true, routable: false, buildable: false }); // the water
  derive(BANK,    { ...({ liquid: false, swimmable: false, routable: true, buildable: true }) });
  derive(INLAND,  { liquid: false, swimmable: false, routable: true, buildable: true });
  derive(SPECIAL, { liquid: false, swimmable: false, routable: true, buildable: true });
  _test.invalidateWaterIndex();
  try {
    check('a tile bordering water fishes the default table',
      _test.fishingTableFor(world.zones.get(BANK)) === _test.DEFAULT_FISHING_TABLE,
      `${_test.fishingTableFor(world.zones.get(BANK))}`);
    check("an inland tile can't be fished",
      _test.fishingTableFor(world.zones.get(INLAND)) === null, `${_test.fishingTableFor(world.zones.get(INLAND))}`);
    check('an authored fishing_table_id WINS over the default',
      _test.fishingTableFor(world.zones.get(SPECIAL)) === 'fish_echelon_basin',
      `${_test.fishingTableFor(world.zones.get(SPECIAL))}`);
    check("you can't fish while standing in the water itself",
      _test.fishingTableFor(world.zones.get(W)) === null, `${_test.fishingTableFor(world.zones.get(W))}`);
    check("a coordless interior without a table can't be fished",
      _test.fishingTableFor({ id: 'x', flags: {} }) === null);
    check('bordersWater is orthogonal only', _test.bordersWater(world.zones.get(BANK)) === true
      && _test.bordersWater(world.zones.get(INLAND)) === false);
  } finally {
    for (const [id, z] of prevFish) { if (z) world.zones.set(id, z); else world.zones.delete(id); }
    for (const [id, r] of prevRender) { if (r) world.render.set(id, r); else world.render.delete(id); }
    _test.invalidateWaterIndex();
  }

  // ── Weighted pick (pure) — always returns an entry, respects weights ────────
  const entries = [{ id: 'a', weight: 1 }, { id: 'b', weight: 50 }];
  check('pickWeighted returns an entry', !!_test.pickWeighted(entries));
  let bHits = 0;
  for (let i = 0; i < 200; i++) if (_test.pickWeighted(entries).id === 'b') bHits++;
  check('pickWeighted honors weight (heavy entry dominates)', bHits > 150, `b=${bHits}/200`);

  // ── Cast target pick (pure) — depth (power) + off-line specials (angle) ──────
  // Pool: a shallow common, a deep prize, and an off-line monster hook.
  const castPool = [
    { kind: 'catch', item_id: 'shallow', difficulty: 3, weight: 5 },
    { kind: 'catch', item_id: 'deep', difficulty: 11, weight: 5 },
    { kind: 'monster', enemyTemplateId: 'mon', difficulty: 9, weight: 3 },
  ];
  check('pickCastTarget returns a pool entry', castPool.includes(_test.pickCastTarget(castPool, 0.5, 0.5)));
  let deepOnDeep = 0, deepOnShallow = 0, monOffAxis = 0, monStraight = 0;
  for (let i = 0; i < 400; i++) {
    if (_test.pickCastTarget(castPool, 0.95, 0.5).item_id === 'deep') deepOnDeep++;
    if (_test.pickCastTarget(castPool, 0.05, 0.5).item_id === 'deep') deepOnShallow++;
    if (_test.pickCastTarget(castPool, 0.5, 1.0).kind === 'monster') monOffAxis++;
    if (_test.pickCastTarget(castPool, 0.5, 0.5).kind === 'monster') monStraight++;
  }
  check('deep casts favour the deep prize over shallow casts', deepOnDeep > deepOnShallow, `deep=${deepOnDeep} shallow=${deepOnShallow}`);
  check('off-line casts favour the monster hook over straight casts', monOffAxis > monStraight, `off=${monOffAxis} straight=${monStraight}`);

  // ── Command gating ─────────────────────────────────────────────────────────
  // Stand on a KNOWN-dry synthetic tile rather than trusting wherever the harness
  // happened to put us. Since "any bank fishes" (55e97090) merely BORDERING water
  // makes a zone fishable, and the harness picks its zone by scanning the zone map
  // — whose order differs between a fresh CI import and a long-lived dev DB — the
  // "no water" assertion below was passing locally and failing in CI on luck of
  // the draw. Parked at 4100+, clear of both real content and the fixtures above.
  const DRY = 'zone_regress_fish_dry';
  const prevDry = world.zones.get(DRY);
  const savedZone = p.current_zone;
  world.zones.set(DRY, mk(DRY, 4100, 4100, {}));
  _test.invalidateWaterIndex();
  p.current_zone = DRY;

  const savedPosture = p.posture, savedCombat = p.npcCombatTargetId;

  p.posture = 'standing';
  p.npcCombatTargetId = 'enemy_x';
  let r = await run('fish');
  check('fish blocked mid-combat', /busy|fighting/i.test(r?.message || ''), r?.message);

  p.npcCombatTargetId = null;
  p.posture = 'sitting';
  r = await run('fish');
  check('fish blocked when not standing', /on your feet/i.test(r?.message || ''), r?.message);

  p.posture = 'standing';
  r = await run('fish');
  check('fish with no water reports it', /no water/i.test(r?.message || ''), r?.message);

  p.posture = 'fishing';
  r = await run('fish');
  check('fish blocked while already fishing', /already fishing/i.test(r?.message || ''), r?.message);

  // ── Cast / resolve with no armed bite are silent no-ops (anti-spoof) ────────
  r = await run('fishcast zone_x 0.9 0.5 bogus-token');
  check('fishcast without a pending bite is a no-op', r?.type === 'noop', r?.type);
  r = await run('fishresolve zone_x 1 bogus-token');
  check('fishresolve without a pending bite is a no-op', r?.type === 'noop', r?.type);

  // ── The log rung settles cast AND reel on the server ───────────────────────
  // A resolve that arrives at the cast stage is refused: that refusal is why the
  // log rung's old auto-resolve never landed a fish. settleLogBite must move the
  // bite to the fight stage first. The fake player holds no rod, so a resolve
  // that gets past the stage guard stops fishing with "rod's gone" — which is
  // only reachable once the stage is right.
  const armBite = () => {
    p.posture = 'fishing';
    p.fishState = { zoneId: DRY, streak: 0, lastAttempt: 0,
      pending: { pool: [{ kind: 'monster', name: 'regress eel', difficulty: 5, weight: 1 }], token: 'regress-tok', armedAt: Date.now(), phase: 'cast' } };
  };
  armBite();
  r = await run(`fishresolve ${DRY} 1 regress-tok`);
  check('a resolve at the cast stage is refused', r?.type === 'noop' && p.posture === 'fishing' && !!p.fishState?.pending, `${r?.type} ${p.posture}`);
  armBite();
  await _test.settleLogBite(p, DRY, 'regress-tok');
  check('the log rung settles a bite through the fight stage', p.posture !== 'fishing' && !p.fishState, `${p.posture} ${JSON.stringify(p.fishState?.pending?.phase)}`);

  p.posture = savedPosture; p.npcCombatTargetId = savedCombat;
  p.current_zone = savedZone;
  if (prevDry) world.zones.set(DRY, prevDry); else world.zones.delete(DRY);
  _test.invalidateWaterIndex();
  delete p.fishState;

  // ── Selling the catch (the Codfather's weigh-in) ──────────────────────────
  // A `fish_buyer` pays the specialist 70% for anything tagged `raw_fish`; everyone else 40%.
  check('a fish buyer pays the specialist rate', computeSellUnitPrice(100, 0, 0, { fishBuyer: true }) === 70,
    String(computeSellUnitPrice(100, 0, 0, { fishBuyer: true })));
  check('anyone else pays the ordinary rate for a fish', computeSellUnitPrice(100, 0, 0, {}) === 40);
  // Every catch on the two fishing tables carries the tag, or the fishmonger pays the ordinary rate.
  const untagged = ['item_fresh_catch', 'item_sludge_carp', 'item_razorgill', 'item_irontooth_bass',
    'item_ashen_pike', 'item_coldwater_sturgeon', 'item_glass_eel'].filter((id) => !getItem(id)?.tags?.raw_fish);
  check('every catch is tagged raw_fish', !untagged.length, untagged.join(', '));
  // ── The boat reel (boat.js) ────────────────────────────────────────────────
  await boatSuite({ run, check, p });
}

// A fake anchored rig: a Keel Mk 1 (`skiff`, a 40 kg box) lying to an anchor at a far-off point.
// The clock, the water and the messages are boat.js's seams, so the run is the same every time:
// the water is either fishless or uniform rock at twelve metres, and the clock is fixed.
async function boatSuite({ run, check, p }) {
  const pid = p.id, BOAT = `boat_regress_fish_${process.pid}`;
  const A = { x: 6000, y: 6000, at: Date.now() };
  const ROCK = { depth: 12, shore: 6, floor: 'rock', wreck: 0 };
  const EMPTY = { depth: 12, shore: 6, floor: 'none', wreck: 0 };
  let water = EMPTY;
  let clock = 1_900_000_000_000;
  const sent = [];
  const last = (phase) => [...sent].reverse().find((m) => m.phase === phase);
  const env = { hour: 12, doy: 100, weather: 'clear', rough: 0 };
  boatT.seam.now = () => clock;
  boatT.seam.habitat = () => water;
  boatT.seam.floor = () => 12;
  boatT.seam.tap = (id, m) => { if (id === pid) sent.push(m); };
  const rodRow = () => query('INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1, $2, $3, 1, 1.0)', [randomUUID(), pid, 'item_fishing_rod']);
  const holdRows = async () => (await query('SELECT count(*)::int AS n FROM boat_hold WHERE boat_id = $1', [BOAT])).rows[0].n;
  const saved = { posture: p.posture, zone: p.current_zone };
  const realRandom = Math.random;
  const rig = { playerId: pid, boatId: BOAT, typeId: 'skiff', name: 'Regress', heading: 0, x: A.x, y: A.y, speed: 0, pedal: 0, anchored: null };
  // A fish on the line without going through the water, for the strike and fight checks.
  const st = () => p.fishState;
  const craftBite = (beats) => {
    const s = st();
    s.phase = 'bite';
    s.lure = { x: A.x + 2, y: A.y, depth: 5, floor: 12, lineM: 14, at: clock };
    s.bite = { schoolId: 'regress_school', i: 0, sp: 'irontooth_bass', kg: 3, difficulty: 6, beats, biteAt: clock, hit: 0, x: A.x + 2, y: A.y, depth: 5 };
  };
  const craftFight = ({ kg = 3, ago = 600_000 } = {}) => {
    const s = st();
    s.phase = 'fight';
    s.fight = { schoolId: 'regress_school', i: 0, sp: 'irontooth_bass', kg, difficulty: 6, beats: 1, lineM: 20, startAt: clock - ago, settled: false, x: A.x + 2, y: A.y, depth: 5 };
  };
  try {
    Map.prototype.set.call(aboard, pid, BOAT);   // straight onto the map: the seat's flag write is not under test
    rigs.set(pid, rig);
    p.posture = 'standing';
    p.combatTargetId = p.pvpTargetId = p.npcCombatTargetId = null;

    let r = await run('fish');
    check('boat: fish aboard with the anchor up is refused', /Drop the anchor first/.test(r?.message || '') && p.posture !== 'fishing', r?.message);

    rig.anchored = A;
    rig.typeId = 'hydro';   // no rod holders
    r = await run('fish');
    check('boat: fish with no rod, on a hull with no rod holders, is refused', /need a fishing rod/i.test(r?.message || '') && p.posture !== 'fishing', r?.message);
    rig.typeId = 'skiff';
    r = await run('fish');
    check('boat: fish with no rod on the skiff uses the boat\'s own rod', p.posture === 'fishing' && st()?.boatRod === true && /out of the holder/.test(r?.message || ''), `${p.posture} ${r?.message}`);
    endBoatFishing(p, null);

    await rodRow();
    emit('inventory.changed', { actor: p });
    r = await run('fish');
    const open = last('open');
    check('boat: fish at anchor with a rod opens the reel', p.posture === 'fishing' && st()?.mode === 'boat' && !!open, `${p.posture} ${JSON.stringify(st()?.mode)} ${r?.message}`);
    check('boat: open carries the anchor point, reach and box', open?.ax === A.x && open?.ay === A.y && open?.castM === boatT.CAST_DEFAULT_M && open?.holdCap === 40 && open?.holdKg === 0 && !!open?.env && Number.isFinite(open?.serverNow),
      JSON.stringify(open));
    const tok = open?.token;
    st().env = env;

    // ── The cast: from the anchor, clamped to the rod's reach ────────────────
    let n0 = sent.length;
    await run(`fishcast boat 90 500 bogus-token`);
    check('boat: a cast with a dead token does nothing', sent.length === n0);
    // A reported position far off is ignored: the cast is from the anchor.
    rig.x = A.x + 50;
    await run(`fishcast boat 90 500 ${tok}`);
    let lure = last('lure');
    check('boat: the cast is clamped to the rod\'s reach', lure?.lineM === boatT.CAST_DEFAULT_M, JSON.stringify(lure));
    check('boat: the lure lands off the anchor point, not the reported position, along the bearing',
      Math.abs(lure?.lx - (A.x + boatT.CAST_DEFAULT_M / SEA_TILE_M)) < 0.01 && Math.abs(lure?.ly - A.y) < 0.01, JSON.stringify(lure));
    rig.x = A.x;
    await run(`fishcast boat 0 1 ${tok}`);
    lure = last('lure');
    check('boat: a short cast is lengthened to CAST_MIN_M', lure?.lineM === R.CAST_MIN_M && Math.abs(lure?.ly - (A.y - R.CAST_MIN_M / SEA_TILE_M)) < 0.01, JSON.stringify(lure));
    r = await run('fish 90 20');
    check('boat: `fish <bearing> <metres>` casts', /twenty metres off the starboard beam/.test(r?.message || '') && last('lure')?.lineM === 20, r?.message);

    // ── Twitches: in towards the boat, rate-limited, sinking between ─────────
    clock += 5000;
    await run(`fishtwitch ${tok}`);
    let tw = last('twitch');
    check('boat: a twitch draws the lure TWITCH_M in', tw?.lineM === 20 - R.TWITCH_M && Math.abs(tw?.lx - (A.x + (20 - R.TWITCH_M) / SEA_TILE_M)) < 0.01, JSON.stringify(tw));
    check('boat: the lure sank while it sat, less the lift', Math.abs(tw?.depthM - (5 * R.SINK_MPS - R.TWITCH_LIFT_M)) < 0.02, JSON.stringify(tw));
    n0 = sent.length;
    clock += R.TWITCH_MIN_MS - 40;
    await run(`fishtwitch ${tok}`);
    check('boat: a tap inside TWITCH_MIN_MS counts as the same tap', sent.length === n0 && st()?.lure?.lineM === 20 - R.TWITCH_M, `${sent.length - n0} sent, line ${st()?.lure?.lineM}`);
    boatT.settle(st(), clock + 100_000);
    check('boat: the lure sinks no deeper than the floor', Math.abs(st().lure.depth - (12 - 0.2)) < 1e-6, String(st().lure.depth));

    // ── Reeled at REEL_IN_M ───────────────────────────────────────────────────
    await run(`fishcast boat 0 7 ${tok}`);
    for (let k = 0; k < 7; k++) { clock += 400; await run(`fishtwitch ${tok}`); }
    check('boat: the line reels itself in at REEL_IN_M', !!last('reeled') && st()?.phase === 'aim' && !st()?.lure, `${st()?.phase}`);
    await run(`fishcast boat 0 20 ${tok}`);
    await run(`fishtwitch ${tok} reel`);
    check('boat: `reel` winds the line in on demand', st()?.phase === 'aim' && !st()?.lure, `${st()?.phase}`);

    // ── A bite after on-tempo twitches near a fish ────────────────────────────
    // Slow fish first, cast a metre and a half past one so the lure is drawn in over it. A few
    // candidates in turn, because a fish can turn away; the clock is fixed, so the run is the same.
    water = ROCK;
    const toward = (f, past) => {
      const dx = f.x - 0.5 - A.x, dy = f.y - 0.5 - A.y, m = Math.hypot(dx, dy) * SEA_TILE_M;
      return { bear: Math.atan2(dx, -dy) * 180 / Math.PI, m: m + past };
    };
    const targets = [];
    for (let dt = 4000; dt <= 19000 && targets.length < 6; dt += 500) {
      const sink = Math.min(12 - 0.2, R.SINK_MPS * dt / 1000);
      for (const f of fishNear(A.x + 0.5, A.y + 0.5, 22 / SEA_TILE_M, clock + dt, env, boatT.seam.habitat)) {
        const sp = SPECIES[f.school.sp], c = toward(f, 1.5);
        if (sp.bait || sp.speed > 0.6 || keenness(sp, env) < 0.6 || c.m < 10 || c.m > 24 || Math.abs(f.depth - sink) > 0.6) continue;
        if (targets.some((t) => t.f.school.id === f.school.id)) continue;
        targets.push({ f, dt, ...c });
        break;
      }
    }
    check('boat: the rock water holds a fish within reach to cast at', targets.length > 0);
    for (const target of targets) {
      await run(`fishcast boat ${target.bear.toFixed(3)} ${target.m.toFixed(3)} ${tok}`);
      clock += target.dt;
      const tempo = R.tempoOf(target.f.school.sp);
      for (let k = 0; k < 8 && st()?.phase === 'line'; k++) { await run(`fishtwitch ${tok}`); clock += tempo; }
      if (st()?.phase === 'bite') break;
      clock += 60_000;
    }
    const b = last('bite');
    check('boat: on-tempo twitches near a fish bring a bite', st()?.phase === 'bite' && !!b && b.beats === R.beatCount(st().bite.kg, st().bite.difficulty) && b.biteAt === st().bite.biteAt,
      `${st()?.phase} ${JSON.stringify(b)}`);
    check('boat: twitches report the fish following the lure', sent.some((m) => m.phase === 'twitch' && m.follow?.length));

    // ── The beats: judged in and out of the window ────────────────────────────
    craftBite(3);
    let times = R.beatTimes(3);
    for (let i = 0; i < 3; i++) {
      clock = st().bite.biteAt + times[i] + 60;
      await run(`fishstrike ${i} ${clock} ${tok}`);
    }
    let fight = last('fight');
    check('boat: every beat hit in its window starts the fight', st()?.phase === 'fight' && fight?.kg === 3 && fight?.species === 'irontooth_bass' && fight?.fight === SPECIES.irontooth_bass.fight,
      `${st()?.phase} ${JSON.stringify(fight)}`);

    craftBite(2);
    times = R.beatTimes(2);
    clock = st().bite.biteAt + times[0] + R.BEAT_WINDOW_MS + R.LATENCY_SLACK_MS + 60;
    await run(`fishstrike 0 ${clock} ${tok}`);
    check('boat: a strike outside the window spits the hook', last('spat')?.reason === 'miss' && st()?.phase === 'aim', JSON.stringify(last('spat')));
    check('boat: a missed strike scares the school off the lure', (st()?.spooked?.regress_school || 0) > clock);

    craftBite(2);
    clock = st().bite.biteAt + times[1];
    await run(`fishstrike 1 ${clock} ${tok}`);
    check('boat: a beat struck out of order spits the hook', st()?.phase === 'aim');

    craftBite(1);
    clock = st().bite.biteAt + R.beatTimes(1)[0] + R.BEAT_WINDOW_MS + R.LATENCY_SLACK_MS * 2 + 10;
    const sp0 = sent.filter((m) => m.phase === 'spat').length;
    boatTick(p, st());
    check('boat: a beat never struck is spat on the tick', sent.filter((m) => m.phase === 'spat').length === sp0 + 1 && st()?.phase === 'aim');

    // ── Landing ───────────────────────────────────────────────────────────────
    craftFight({ ago: 10 });
    await run(`fishresolve boat 1 ${tok}`);
    check('boat: a win faster than minFightMs is refused', last('lost')?.snapped === false && (await holdRows()) === 0 && st()?.phase === 'aim', JSON.stringify(last('lost')));

    craftFight({ kg: 3 });
    await run(`fishresolve boat 1 ${tok}`);
    const landed = last('landed');
    check('boat: a won fight lands a row in the box', (await holdRows()) === 1 && landed?.kg === 3 && landed?.holdKg === 3 && landed?.holdCap === 40 && landed?.thinned?.regress_school === 1,
      JSON.stringify(landed));
    const row = (await query('SELECT * FROM boat_hold WHERE boat_id = $1', [BOAT])).rows[0];
    check('boat: the row carries the item, species, weight and depth', row?.item_id === SPECIES.irontooth_bass.item && row?.species === 'irontooth_bass' && Number(row?.kg) === 3 && Number(row?.depth_m) === 5 && !!row?.caught_at,
      JSON.stringify(row));

    holdT.mirror(BOAT, 39);
    craftFight({ kg: 3 });
    await run(`fishresolve boat 1 ${tok}`);
    check('boat: a win with no room in the box is let go', !!last('full') && (await holdRows()) === 1, JSON.stringify(last('full')));
    holdT.mirror(BOAT, 3);

    // ── The log rung settles strike and fight with one check ──────────────────
    craftBite(2);
    const before = sent.length;
    await settleBoatBite(p, st());
    const settled = sent.slice(before);
    check('boat: the log rung settles the bite without a fight board', !settled.some((m) => m.phase === 'fight') && settled.some((m) => ['landed', 'lost', 'full'].includes(m.phase)),
      settled.map((m) => m.phase).join(','));
    if (p.posture !== 'fishing') { await rodRow(); emit('inventory.changed', { actor: p }); await run('fish'); st().env = env; }

    // ── A lost fight can snap the rod ─────────────────────────────────────────
    // At condition 0: maybeSnapRod's damage goes through repairItem, which clamps a negative
    // fraction to 0, so a rod above Broken is never worn down by a snap (a shore bug as well).
    await query('UPDATE player_inventory SET condition = 0 WHERE player_id = $1 AND item_id = $2', [pid, 'item_fishing_rod']);
    craftFight();
    Math.random = () => 0;
    try { await run(`fishresolve boat 0 ${st().token}`); } finally { Math.random = realRandom; }
    check('boat: a lost fight can snap a spent rod, and the reel closes', last('lost')?.snapped === true && p.posture !== 'fishing' && sent[sent.length - 1]?.phase === 'close',
      `${JSON.stringify(last('lost'))} ${p.posture}`);

    // ── Weighing anchor closes the reel ───────────────────────────────────────
    await rodRow();
    emit('inventory.changed', { actor: p });
    await run('fish');
    check('boat: the reel opens again with a new rod', p.posture === 'fishing');
    rig.anchored = null;
    boatTick(p, st());
    check('boat: weighing anchor closes the reel', p.posture !== 'fishing' && !p.fishState && sent[sent.length - 1]?.phase === 'close');
  } finally {
    Math.random = realRandom;
    for (const k of ['now', 'habitat', 'floor', 'tap']) boatT.seam[k] = null;
    boatT.taken.delete('regress_school');
    holdT.holdKg.delete(BOAT);
    rigs.delete(pid);
    Map.prototype.delete.call(aboard, pid);
    delete p.fishState;
    p.posture = saved.posture === 'fishing' ? 'standing' : (saved.posture || 'standing');
    p.current_zone = saved.zone;
    await query('DELETE FROM boat_hold WHERE boat_id = $1', [BOAT]).catch(() => {});
    await query('DELETE FROM player_inventory WHERE player_id = $1 AND item_id = $2', [pid, 'item_fishing_rod']).catch(() => {});
    emit('inventory.changed', { actor: p });
  }

  // ── Shore `fish` is untouched once you're out of the boat ───────────────────
  const r = await run('fish');
  check('boat: off the boat, `fish` is the shore verb again', !/anchor/i.test(r?.message || '') && p.posture !== 'fishing', r?.message);
}
