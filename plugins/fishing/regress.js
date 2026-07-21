// Fishing plugin regression suite — run by tests/regress.js (never loaded in
// production). The fake player stands in a zone with no fishing water and holds
// no rod, so we exercise the gated no-mutation paths (nothing is ever caught)
// plus the pure weighted-pick helper.
import { _test } from './index.js';
import { world } from '../../server/engine/world.js';

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
  for (const id of [W, BANK, INLAND, SPECIAL]) prevFish.set(id, world.zones.get(id));
  world.zones.set(W,       mk(W,       4000, 4000, { terrain: 'water' }));
  world.zones.set(BANK,    mk(BANK,    4000, 4001, {}));                       // due south of the water
  world.zones.set(INLAND,  mk(INLAND,  4000, 4003, {}));                       // two tiles off — dry
  world.zones.set(SPECIAL, mk(SPECIAL, 4001, 4000, { fishing_table_id: 'fish_echelon_basin' })); // east of the water
  _test.invalidateWaterIndex();
  try {
    check('a tile bordering water fishes the default table',
      _test.fishingTableFor(world.zones.get(BANK)) === _test.DEFAULT_FISHING_TABLE,
      `${_test.fishingTableFor(world.zones.get(BANK))}`);
    check('an inland tile cannot be fished',
      _test.fishingTableFor(world.zones.get(INLAND)) === null, `${_test.fishingTableFor(world.zones.get(INLAND))}`);
    check('an authored fishing_table_id WINS over the default',
      _test.fishingTableFor(world.zones.get(SPECIAL)) === 'fish_echelon_basin',
      `${_test.fishingTableFor(world.zones.get(SPECIAL))}`);
    check('you cannot fish while standing in the water itself',
      _test.fishingTableFor(world.zones.get(W)) === null, `${_test.fishingTableFor(world.zones.get(W))}`);
    check('a coordless interior without a table cannot be fished',
      _test.fishingTableFor({ id: 'x', flags: {} }) === null);
    check('bordersWater is orthogonal only', _test.bordersWater(world.zones.get(BANK)) === true
      && _test.bordersWater(world.zones.get(INLAND)) === false);
  } finally {
    for (const [id, z] of prevFish) { if (z) world.zones.set(id, z); else world.zones.delete(id); }
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

  // ── Command gating (no fishable water in the fake player's zone) ─────────────
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

  p.posture = savedPosture; p.npcCombatTargetId = savedCombat;
  delete p.fishState;
}
