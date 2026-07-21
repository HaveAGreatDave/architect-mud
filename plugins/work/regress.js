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

  // ── No XP gate (removed 2026-07-21) — a fresh clone can take a shift ───────
  // Steady work is the safe, indoor, repeatable earner; gating it behind proof
  // you'd survived the dangerous ones was backwards, and lifetime XP was a
  // currency the quest chain never paid into.
  p.posture = 'standing'; p.npcCombatTargetId = null; delete p.shiftState;
  p.total_xp = 0;
  let r = await run('work');
  check('work is open at zero XP (no gate)',
    r?.type === 'output' && !/lifetime XP/i.test(r?.message || ''), r?.message?.slice(0, 80));
  r = await run('clock in');
  check('clock in at zero XP fails on the venue, not the gate',
    /no work to clock into/i.test(r?.message || ''), r?.message);

  // ── No venue underfoot ─────────────────────────────────────────────────────
  p.total_xp = 5000;
  r = await run('clock in');
  check('clock in with no venue is refused', /no work to clock into/i.test(r?.message || ''), r?.message);
  r = await run('work');
  check('work lists venues or reports none', r?.type === 'output', r?.type);

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

  // ── Courier archetype (read-only command paths + pure logic; no DB writes,
  //    since the fake player isn't a real players row — mirrors the shift tests) ──
  const C = _test.courier;
  check('CLASSES cover clean/sketchy/hot', ['clean', 'sketchy', 'hot'].every(k => C.CLASSES[k]?.itemId));
  check('hot pays more than clean (payMult)', C.CLASSES.hot.payMult > C.CLASSES.clean.payMult);
  check('sketchy+hot are contraband, clean is not',
    C.CLASSES.sketchy.contraband && C.CLASSES.hot.contraband && !C.CLASSES.clean.contraband);
  check('cheb is Chebyshev distance', C.cheb(0, 0, 3, 1) === 3 && C.cheb(2, 5, 2, 5) === 0);

  C.generateBoard();
  const jobs = C.courierBoard();
  check('courier board generates specs from the live world', Array.isArray(jobs));
  if (jobs.length) {
    const j = jobs[0];
    check('a board spec is well-formed', !!j.id && !!j.dropoffZone && j.payout > 0 && j.dist > 0, JSON.stringify(j));
    check('board spec class is clean or sketchy (never hot)', j.class === 'clean' || j.class === 'sketchy');
  }
  check('candidateZones finds placed named tiles', C.candidateZones().length > 0);
  const synthRun = { deadlineAt: Date.now() + 60_000 };
  check('minsLeft counts down a live run', C.minsLeft(synthRun) > 0 && !C.expired(synthRun));
  check('expired run reads as expired', C.expired({ deadlineAt: Date.now() - 1000 }));

  // Read-only command paths (activeRun is a SELECT; no run for the fake player).
  p.posture = 'standing'; delete p.shiftState; p.total_xp = 5000;
  check('activeRun is null with no parcel carried', (await C.activeRun(p)) === null);
  r = await run('courier');
  check('courier lists the board', r?.type === 'output', r?.type);
  r = await run('deliver');
  check('deliver with no run is a gentle no-op', /not carrying a run/i.test(r?.message || ''), r?.message);
  r = await run('crack');
  check('crack with nothing sealed is a gentle no-op', /nothing sealed/i.test(r?.message || ''), r?.message);
  p.total_xp = 0;
  r = await run('courier');
  check('courier is open at zero XP (no gate)',
    r?.type === 'output' && !/lifetime XP/i.test(r?.message || ''), r?.message?.slice(0, 80));

  // ── Cleanup — never leave the fake player clocked in (the tick would pay out) ─
  delete p.shiftState;
  p.posture = saved.posture; p.total_xp = saved.xp; p.npcCombatTargetId = saved.combat;
  if (saved.shift) p.shiftState = saved.shift;
}
