// Frostbite regression suite — run by tests/regress.js (never loaded in production).
// No verbs; this is a per-minute meter. So the suite pins the staging rules and the
// exposure maths, which is where the design decisions actually live.
import { _test, frostbiteReport, treatFrostbite, clearFrostbite } from './index.js';
import { getRegisteredStatusEffects, applyEffect, effectStatBonus } from '../../server/engine/effects.js';

export default async function regress({ check }) {
  const { STAGES, stageFor, ONSET_C, THAW_C, THAW_PER_MIN, ACCRUAL_PER_DEGREE, COVERED_FLOOR } = _test;

  // ── Staging ─────────────────────────────────────────────────────────────────
  check('a clean body has no stage', stageFor(0) === null, String(stageFor(0)));
  check('below the first threshold is still nothing', stageFor(24) === null, String(stageFor(24)));
  check('25 is frostnip', stageFor(25)?.name === 'frostnip', stageFor(25)?.name);
  check('60 is frostbite', stageFor(60)?.name === 'frostbite', stageFor(60)?.name);
  check('90 is deep frostbite', stageFor(90)?.name === 'deep_frostbite', stageFor(90)?.name);
  check('the meter caps out in the worst stage', stageFor(100)?.name === 'deep_frostbite', stageFor(100)?.name);
  check('stages get strictly worse for reflexes',
    STAGES.every((s, i) => i === 0 || s.ref > STAGES[i - 1].ref), STAGES.map(s => s.ref).join(','));

  // Every stage must be a REGISTERED effect, or the penalty silently does nothing.
  const registered = getRegisteredStatusEffects();
  check('every stage registers a status effect',
    STAGES.every(s => registered.includes(s.name)), STAGES.map(s => s.name).join(','));

  // The penalty has to actually reach the stat pipeline — a registry entry nobody nets in is
  // just a label. Deep frostbite and the core cold penalty are different injuries and stack.
  {
    const p = { statuses: [] };
    applyEffect(p, 'deep_frostbite', 60);
    check('a frostbite stage really subtracts reflexes',
      effectStatBonus(p, 'stat_reflexes') === -3, String(effectStatBonus(p, 'stat_reflexes')));
  }

  // ── Exposure maths ──────────────────────────────────────────────────────────
  // The rule that matters: covering up SLOWS frostbite, it does not switch it off. A hat
  // being a checkbox that makes the hazard vanish is the failure mode being guarded against.
  const rate = (skin, exposure) =>
    (ONSET_C - skin) * ACCRUAL_PER_DEGREE * (COVERED_FLOOR + (1 - COVERED_FLOOR) * exposure);
  check('bare extremities freeze faster than covered ones', rate(-20, 1) > rate(-20, 0), `${rate(-20, 1)} > ${rate(-20, 0)}`);
  check('fully covered is slow, never immune', rate(-20, 0) > 0, String(rate(-20, 0)));
  check('deeper cold accrues faster', rate(-30, 1) > rate(-20, 1), `${rate(-30, 1)} > ${rate(-20, 1)}`);
  check('onset is below freezing, not at it (skin is warmer than the air)', ONSET_C < 0, String(ONSET_C));
  check("thaw threshold sits above onset so the meter can't chatter", THAW_C > ONSET_C, `${THAW_C} > ${ONSET_C}`);

  // Time to the first stage in genuinely dangerous cold — the number that decides whether the
  // system is felt at all. Bare hands at −20°C should nip in well under half an hour.
  const minsToNip = 25 / rate(-20, 1);
  check('bare hands at -20C nip inside half an hour', minsToNip > 5 && minsToNip < 30, `${minsToNip.toFixed(0)} min`);
  // ── Permanence, and the two things that undo it ─────────────────────────────
  // Frostnip and frostbite are circulation injuries and they go away. DEEP frostbite is
  // tissue death: it does not warm up and come back. That asymmetry is the whole system —
  // it turns the cold from a timer you wait out into a thing you get treated for, and it is
  // the only permanent injury in the game.
  const body = (meter, floor = 0) => ({ id: 'regress-frost', statuses: [], _frostbite: meter, _frostbiteFloor: floor });

  check('a clean body reports nothing', frostbiteReport(body(0)) === null, 'null');
  check('a nipped body reports the stage', frostbiteReport(body(30))?.stage === 'frostnip', frostbiteReport(body(30))?.stage);
  check("a reversible case isn't flagged permanent", frostbiteReport(body(30)).permanent === false, 'reversible');
  check('a deep case with a latched floor IS permanent', frostbiteReport(body(95, 90)).permanent === true, 'permanent');

  // A FIELD KIT buys back the use of your hands, never the hands. Same bargain the injury
  // system strikes — floor 1 means it can never clear outright.
  {
    const p = body(95, 90);
    const moved = await treatFrostbite(p, { steps: 2, floor: 1 });
    check('a trauma kit walks a deep case back', moved && p._frostbite < 95, `${moved?.from} -> ${moved?.to}`);
    check('…but never clears it outright (floor 1)', frostbiteReport(p) !== null, frostbiteReport(p)?.stage);
    check('…and it brings the FLOOR down with it, or the next thaw drags it back',
      p._frostbiteFloor <= p._frostbite, `floor ${p._frostbiteFloor} <= meter ${p._frostbite}`);
    const again = await treatFrostbite(p, { steps: 2, floor: 1 });
    check('a second kit on an already-floored case does nothing', again === null, String(again));
  }
  {
    const p = body(0);
    check('a kit on an unfrozen body is a no-op', (await treatFrostbite(p, { steps: 1, floor: 1 })) === null, 'no-op');
  }

  // THE CLINIC is the only thing that makes you whole — floor and all.
  {
    const p = body(95, 90);
    applyEffect(p, 'deep_frostbite', 180);
    const had = await clearFrostbite(p);
    check('the clinic clears frostbite outright', frostbiteReport(p) === null, String(frostbiteReport(p)));
    check('the clinic clears the permanent FLOOR too', p._frostbiteFloor === 0, String(p._frostbiteFloor));
    check('the clinic reports what it treated (so it can be billed for)', had?.stage === 'deep_frostbite', had?.stage);
    check('and the status penalty is lifted with it',
      effectStatBonus(p, 'stat_reflexes') === 0, String(effectStatBonus(p, 'stat_reflexes')));
    check('clearing an already-clean body is a no-op', (await clearFrostbite(p)) === null, 'no-op');
  }

  // Thawing respects the floor — this is the line that makes the injury permanent, so it is
  // asserted as arithmetic rather than trusted to the tick.
  const thawStep = (meter, floor) => Math.max(floor, meter - THAW_PER_MIN);
  check('a floored case still thaws down TO its floor', thawStep(95, 90) === 95 - THAW_PER_MIN, String(thawStep(95, 90)));
  check('…and then stops dead there, however long it stays warm',
    thawStep(90.2, 90) === 90 && thawStep(90, 90) === 90, `${thawStep(90.2, 90)} / ${thawStep(90, 90)}`);
  check('an unfloored case thaws all the way to zero',
    Math.max(0, 0.2 - THAW_PER_MIN) === 0, 'thaws clean');
  // …and a reversible case still takes a serious, memorable stretch of warmth to walk off.
  check('a full meter takes a long thaw', 90 / THAW_PER_MIN > 120, `${(90 / THAW_PER_MIN).toFixed(0)} min`);
}
