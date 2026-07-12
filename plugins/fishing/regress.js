// Fishing plugin regression suite — run by tests/regress.js (never loaded in
// production). The fake player stands in a zone with no fishing water and holds
// no rod, so we exercise the gated no-mutation paths (nothing is ever caught)
// plus the pure weighted-pick helper.
import { _test } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();

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
