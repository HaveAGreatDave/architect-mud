// Drugs plugin regression suite — run by tests/regress.js (never loaded in production).
//
// Covers the pharmacokinetic laws in server/engine/drugs.js. These are engine laws,
// but this plugin owns the verbs that deliver a dose (use/inject), so the coverage
// lives with it. Assertions run against the pure `_test` surface — no DB, no clock.
import { _test as T } from '../../server/engine/drugs.js';

export default async function regress({ run, check }) {
  // --- verb routing --------------------------------------------------------
  // `inject` must resolve as its own route, not collapse back into `use`.
  let r = await run('inject nothingxyz');
  check('inject falls through when nothing drug-like matches',
    !/route/i.test(r?.message || ''), r?.message);

  // --- route of administration ---------------------------------------------
  const injectable = { flags: { injectable: true } };
  const smokeable = { flags: { smokeable: true } };
  const plain = { flags: {} };

  check('inject accelerates an injectable drug', T.resolveRoute('inject', injectable).onset === 0.15);
  check('inject on a non-injectable degrades to neutral', T.resolveRoute('inject', plain).onset === 1);
  check('smoke hits harder on a smokeable', T.resolveRoute('smoke', smokeable).intensity === 1.15);
  check('eat slows the come-up', T.resolveRoute('eat', plain).onset === 3);
  // Back-compat: every pre-existing caller passed no route at all.
  check('an absent route is neutral', T.resolveRoute(undefined, injectable).intensity === 1);
  check('an unknown route is neutral', T.resolveRoute('snort', injectable).onset === 1);
  check('a drug with no flags bag does not throw', T.resolveRoute('inject', {}).onset === 1);

  // --- relapse: the overdose ceiling rides on tolerance ---------------------
  // The whole point: a habit dose survivable at peak tolerance kills once clean.
  check('clean user sits at the authored base', T.odCeiling(2, 0) === 2);
  check('full tolerance buys headroom', T.odCeiling(2, 1) === 5);
  check('a 4-dose habit survives at peak tolerance', 4 < T.odCeiling(2, 1));
  check('the same habit is lethal after getting clean', 4 >= T.odCeiling(2, 0));
  check('ceiling never falls below one dose', T.odCeiling(0, 0) >= 1);

  // --- withdrawal severity arc ---------------------------------------------
  const sev = (s) => T.withdrawalSeverity(s, {});
  check('no withdrawal before onset', sev(0) === 0);
  check('opens at the floor rather than full blast', sev(1) > 0 && sev(1) < 0.3);
  check('climbs through the ramp', sev(900) > sev(60));
  check('reaches full severity at peak', sev(3000) === 1);
  check('tapers after the peak', sev(1800 + 7200 + 10800) < 1);
  check('never sinks below the floor while addicted', sev(999999) === 0.25);
  check('a per-drug ramp override is honoured', T.withdrawalSeverity(60, { ramp_seconds: 60 }) === 1);
  // Scaled mods stay signed and reproduce the authored block at full severity.
  const mods = { hp_max: -25, stat_cool: -4 };
  check('peak severity reproduces the authored mods', T.scaleMods(mods, 1).hp_max === -25);
  check('floor severity is milder than peak', T.scaleMods(mods, 0.25).hp_max > T.scaleMods(mods, 1).hp_max);

  // --- addiction hysteresis -------------------------------------------------
  const stillAddicted = (a, wasAddicted) => a >= (wasAddicted ? T.ADDICT_RELEASE : T.ADDICT_LATCH);
  check('latch sits above release', T.ADDICT_LATCH > T.ADDICT_RELEASE);
  check('0.40 does not hook a clean player', stillAddicted(0.4, false) === false);
  check('0.40 keeps an addicted player hooked', stillAddicted(0.4, true) === true);
  check('0.29 finally releases', stillAddicted(0.29, true) === false);

  // --- dose clearance half-life --------------------------------------------
  // Must terminate: an integer column decaying by a fraction could otherwise stall.
  let doses = 12, steps = 0;
  while (doses > 0 && steps < 200) { doses = T.clearanceStep(doses); steps++; }
  check('a heavy dose load always clears to zero', doses === 0);
  check('clearance is faster when more is in the system',
    (12 - T.clearanceStep(12)) > (4 - T.clearanceStep(4)));
  check('a trace of one dose clears', T.clearanceStep(1) === 0);
}
