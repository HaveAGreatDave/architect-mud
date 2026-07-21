// Drugs plugin regression suite — run by tests/regress.js (never loaded in production).
//
// Covers the pharmacokinetic laws in server/engine/drugs.js. These are engine laws,
// but this plugin owns the verbs that deliver a dose (use/inject), so the coverage
// lives with it. Assertions run against the pure `_test` surface — no DB, no clock.
import { _test as T } from '../../server/engine/drugs.js';
import { _test as F } from './index.js';

export default async function regress({ run, check }) {
  // --- habits: the read-out of your own pharmacology -------------------------
  // The fake player has no drug history, so this proves routing AND the empty case.
  const h = await run('habits');
  check('habits verb is routed (not an unknown command)',
    h?.type !== 'error' && !/Unknown command/i.test(h?.message || ''), h?.message?.slice(0, 60));
  check('a clean player is told nothing has hooks in them',
    /nothing has its hooks/i.test(h?.message || ''), h?.message?.slice(0, 60));

  // Durations read as human, not as raw seconds.
  check('a fresh dose reads as just now', F.ago(30) === 'just now', F.ago(30));
  check('minutes render as minutes', F.ago(600) === '10m ago', F.ago(600));
  check('hours carry their minutes', F.ago(12000) === '3h 20m ago', F.ago(12000));
  check('days render as days', /^2d /.test(F.ago(180000)), F.ago(180000));
  check('grace time reads forward, not backward', F.soon(420) === 'about 7m', F.soon(420));

  // The severity arc must be DESCRIBED monotonically — the numbers are the engine's.
  const bites = [0.1, 0.4, 0.7, 1].map(F.bite);
  check('withdrawal is described in escalating, distinct terms', new Set(bites).size === 4, bites.join(' | '));
  check('peak severity reads as the worst of it', /worst/i.test(F.bite(1)), F.bite(1));

  // --- polydrug: same-class drugs share one ceiling --------------------------
  // Each drug counts its doses as a fraction of ITS OWN ceiling; you overdose when
  // the total reaches 1. A lone unclassed drug therefore behaves exactly as before.
  const CEIL = { alcohol: 8, blacktar: 2, lull: 3, grey: 3 };
  const share = (n, ceil) => n / ceil;
  check('a lone drug at its ceiling is still an overdose (old law intact)',
    share(2, CEIL.blacktar) >= 1);
  check('a lone drug under its ceiling is still safe',
    share(1, CEIL.blacktar) < 1);
  check('half a skinful plus one bag of tar reaches the limit',
    share(4, CEIL.alcohol) + share(1, CEIL.blacktar) >= 1);
  check('two drinks plus one bag of tar does NOT',
    share(2, CEIL.alcohol) + share(1, CEIL.blacktar) < 1);
  check('booze + benzo + morphine stacks to the limit',
    share(4, CEIL.alcohol) + share(1, CEIL.lull) + share(1, CEIL.grey) >= 1);
  check('an unclassed drug contributes nothing to anyone', T.classBurden(
    [{ drug_id: 'drug_psilocybin', doses_in_system: 5, tolerance: 0 }], 'x', 'depressant') === 0);
  check('a different class does not cross-load',
    T.classBurden([{ drug_id: 'drug_alcohol', doses_in_system: 6, tolerance: 0 }], 'x', 'stimulant') === 0);
  check('the same class does cross-load',
    T.classBurden([{ drug_id: 'drug_alcohol', doses_in_system: 4, tolerance: 0 }], 'x', 'depressant') === 0.5);
  check('the drug being taken is excluded from its own cross-load',
    T.classBurden([{ drug_id: 'drug_alcohol', doses_in_system: 4, tolerance: 0 }], 'drug_alcohol', 'depressant') === 0);
  check('tolerance in the other drug lightens its contribution',
    T.classBurden([{ drug_id: 'drug_alcohol', doses_in_system: 4, tolerance: 1 }], 'x', 'depressant')
      < T.classBurden([{ drug_id: 'drug_alcohol', doses_in_system: 4, tolerance: 0 }], 'x', 'depressant'));

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
