// Flight plugin regression suite — run by tests/regress.js (never loaded in
// production). The fake player is on the ground with no aircraft, so we exercise
// the gated no-mutation paths (never boards, never mutates a real row) plus the
// pure overlay/coord helpers.
import { _test } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();

  // ── Pure helpers ────────────────────────────────────────────────────────────
  check('DIRS has all 8 compass steps', Object.keys(_test.DIRS).length === 8, Object.keys(_test.DIRS).join(','));
  check('surfaceAt off the map is open air (null)', _test.surfaceAt(9999, 9999) === null);
  // Difficulty scales with damage; a damaged craft is harder to land.
  const clean = { type: { handling: -1 }, row: { damage: 0 } };
  const hurt = { type: { handling: -1 }, row: { damage: 0.5 } };
  check('landDifficulty rises with damage', _test.landDifficulty(hurt, false) > _test.landDifficulty(clean, false));
  check('emergency landing is harder', _test.landDifficulty(clean, true) > _test.landDifficulty(clean, false));

  // ── Command gating (fake player is grounded, aboard nothing) ─────────────────
  const savedPosture = p.posture, savedCombat = p.npcCombatTargetId, savedAc = p.aircraftId;
  p.posture = 'standing'; p.npcCombatTargetId = null; delete p.aircraftId; delete p.seat;

  // With no aircraft parked here, `board` delegates to gametable's poker board
  // (flight wins the verb by load order, then routes by context).
  let r = await run('board');
  check('board with no craft here delegates to poker board', /no active hand|not.*seat|table/i.test(r?.message || ''), r?.message);

  r = await run('startup');
  check('startup while not aboard is blocked', /not aboard/i.test(r?.message || ''), r?.message);

  r = await run('throttle 50');
  check('throttle while not aboard is blocked', /not aboard/i.test(r?.message || ''), r?.message);

  r = await run('takeoff');
  check('takeoff while not aboard is blocked', /not aboard/i.test(r?.message || ''), r?.message);

  r = await run('disembark');
  check('disembark while not aboard reports it', /not aboard anything/i.test(r?.message || ''), r?.message);

  // ── Resolvers are silent no-ops without an armed, matching minigame ──────────
  r = await run('takeoffresolve bogus-token 1');
  check('takeoffresolve without a pending takeoff is a no-op', r?.type === 'noop', r?.type);
  r = await run('landresolve bogus-token 1');
  check('landresolve without a pending landing is a no-op', r?.type === 'noop', r?.type);

  p.posture = savedPosture; p.npcCombatTargetId = savedCombat;
  if (savedAc) p.aircraftId = savedAc; else { delete p.aircraftId; delete p.seat; }
}
