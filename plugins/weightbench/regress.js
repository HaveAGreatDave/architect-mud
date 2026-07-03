// Weight bench plugin regression suite — run by tests/regress.js (never loaded
// in production). The fake player stands in a zone with no bench, so we exercise
// the gated no-mutation paths (no real Brawn is granted) plus the pure rep curve.
import { _test } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();

  // ── Rep cost curve (pure) — rises with Brawn, never below base ─────────────
  check('reps at brawn 0 == base', _test.repsForBrawn(0) === _test.REPS_BASE);
  check('reps rise with brawn', _test.repsForBrawn(5) > _test.repsForBrawn(1));
  check('reps step is per-level', _test.repsForBrawn(2) - _test.repsForBrawn(1) === _test.REPS_PER_LEVEL);

  // ── Command gating (no bench in the fake player's zone) ────────────────────
  const savedPosture = p.posture, savedBrawn = p.stat_brawn, savedCombat = p.npcCombatTargetId;

  p.posture = 'standing';
  p.npcCombatTargetId = 'enemy_x';
  let r = await run('lift');
  check('lift blocked mid-combat', /fighting/i.test(r?.message || ''), r?.message);

  p.npcCombatTargetId = null;
  r = await run('lift');
  check('lift with no bench reports it', /weight bench/i.test(r?.message || ''), r?.message);

  p.posture = savedPosture; p.stat_brawn = savedBrawn; p.npcCombatTargetId = savedCombat;
}
