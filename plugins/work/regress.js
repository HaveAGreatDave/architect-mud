// Steady Work regression suite — run by tests/regress.js (never loaded in
// production). The fake player stands in an ordinary zone with no work_venue
// flag, so the command paths exercise the gate + the no-venue guards, and the
// pure helpers + resolveEvent are driven directly.
import { _test } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  const saved = { posture: p.posture, xp: p.total_xp, combat: p.npcCombatTargetId, shift: p.shiftState };

  // ── Pure helpers ────────────────────────────────────────────────────────────
  check('tipFor scales with satisfaction', _test.tipFor(100) > _test.tipFor(70));
  check('tipFor floors at low satisfaction', _test.tipFor(40) === 0 && _test.tipFor(20) === 0);
  p.stat_reflexes = 7;
  check('statValue reads a stat field', _test.statValue(p, 'reflexes') === 7);
  check('statValue best-of pair', _test.statValue({ stat_brawn: 2, stat_cool: 9 }, 'brawn|cool') === 9);
  check('statValue missing stat defaults', _test.statValue({}, 'cool') === 3);
  check('statCheck returns a boolean', typeof _test.statCheck(p, 'reflexes', 5) === 'boolean');

  // ── XP gate ───────────────────────────────────────────────────────────────
  p.posture = 'standing'; p.npcCombatTargetId = null; delete p.shiftState;
  p.total_xp = 0;
  let r = await run('work');
  check('work locked below XP gate', /lifetime XP|proven/i.test(r?.message || ''), r?.message);
  r = await run('clock in');
  check('clock in locked below XP gate', /lifetime XP|proven/i.test(r?.message || ''), r?.message);

  // ── Above the gate, but no venue here ───────────────────────────────────────
  p.total_xp = 5000;
  r = await run('clock in');
  check('clock in with no venue is refused', /no work to clock into/i.test(r?.message || ''), r?.message);
  r = await run('work');
  check('work above gate lists venues or reports none', r?.type === 'output', r?.type);

  // ── Event verbs off-shift are gentle no-ops ─────────────────────────────────
  r = await run('serve');
  check('serve off-shift says not on a shift', /not on a shift/i.test(r?.message || ''), r?.message);

  // ── resolveEvent: wrong verb vs right verb (driven directly) ────────────────
  p.posture = 'working';
  p.shiftState = {
    zoneId: p.current_zone, venue: { wage: 65, role: 'line server' },
    startedAt: Date.now(), endsAt: Date.now() + 3_600_000,
    satisfaction: 70, pending: { verb: 'serve', stat: 'reflexes', difficulty: 5, nailed: 'NAILED', botched: 'BOTCHED' },
    queue: [], lastRoll: Date.now(), rushDone: true, rushAt: Infinity,
  };
  r = _test.resolveEvent(p, 'bill');
  check('resolveEvent rejects the wrong verb', /serve it|read the room/i.test(r?.message || ''), r?.message);
  check('resolveEvent leaves the event live on a wrong verb', p.shiftState.pending?.verb === 'serve');

  const satBefore = p.shiftState.satisfaction;
  r = _test.resolveEvent(p, 'serve');
  check('resolveEvent consumes the event on the right verb', p.shiftState.pending === null);
  check('resolveEvent moves satisfaction', p.shiftState.satisfaction !== satBefore, `sat ${satBefore}→${p.shiftState.satisfaction}`);

  // ── Cleanup — never leave the fake player clocked in (the tick would pay out) ─
  delete p.shiftState;
  p.posture = saved.posture; p.total_xp = saved.xp; p.npcCombatTargetId = saved.combat;
  if (saved.shift) p.shiftState = saved.shift;
}
