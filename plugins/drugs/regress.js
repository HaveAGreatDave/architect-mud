// Drugs plugin regression suite — run by tests/regress.js (never loaded in production).
//
// Covers the pharmacokinetic laws in server/engine/drugs.js. These are engine laws,
// but this plugin owns the verbs that deliver a dose (use/inject), so the coverage
// lives with it. Assertions run against the pure `_test` surface — no DB, no clock.
import { _test as T, getDrugCache, drugForItem, isDrugItem } from '../../server/engine/drugs.js';
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
  check("a different class doesn't cross-load",
    T.classBurden([{ drug_id: 'drug_alcohol', doses_in_system: 6, tolerance: 0 }], 'x', 'stimulant') === 0);
  check('the same class does cross-load',
    T.classBurden([{ drug_id: 'drug_alcohol', doses_in_system: 4, tolerance: 0 }], 'x', 'depressant') === 0.5);
  check('the drug being taken is excluded from its own cross-load',
    T.classBurden([{ drug_id: 'drug_alcohol', doses_in_system: 4, tolerance: 0 }], 'drug_alcohol', 'depressant') === 0);
  check('tolerance in the other drug lightens its contribution',
    T.classBurden([{ drug_id: 'drug_alcohol', doses_in_system: 4, tolerance_lethal: 1 }], 'x', 'depressant')
      < T.classBurden([{ drug_id: 'drug_alcohol', doses_in_system: 4, tolerance_lethal: 0 }], 'x', 'depressant'));
  check("...and it's the LETHAL tolerance that lightens it, not the felt one",
    T.classBurden([{ drug_id: 'drug_alcohol', doses_in_system: 4, tolerance: 1 }], 'x', 'depressant')
      === T.classBurden([{ drug_id: 'drug_alcohol', doses_in_system: 4, tolerance: 0 }], 'x', 'depressant'));

  // --- class membership cuts both ways ---------------------------------------
  const NOW = 1_700_000_000;
  const vet = [{ drug_id: 'drug_blacktar', tolerance: 1, last_used_at: NOW, doses_in_system: 0 }];
  check('a same-class veteran carries half their tolerance across',
    T.crossTolerance(vet, 'drug_grey', 'depressant', NOW) === T.CROSS_TOLERANCE);
  check("cross-tolerance doesn't leak between classes",
    T.crossTolerance(vet, 'drug_grey', 'stimulant', NOW) === 0);
  check('cross-tolerance excludes the drug being taken',
    T.crossTolerance(vet, 'drug_blacktar', 'depressant', NOW) === 0);
  check('an unclassed drug gets no cross-tolerance',
    T.crossTolerance(vet, 'drug_grey', undefined, NOW) === 0);

  const freshCousin = [{ drug_id: 'drug_grey', last_used_at: NOW, tolerance: 0, doses_in_system: 1 }];
  const goneCousin  = [{ drug_id: 'drug_grey', last_used_at: NOW - 99999, tolerance: 0, doses_in_system: 0 }];
  check('a fresh cousin holds most of the withdrawal off',
    T.substitutionRelief(freshCousin, 'drug_blacktar', 'depressant', NOW) === T.SUBSTITUTION_FLOOR);
  check('a worn-off cousin holds none of it off',
    T.substitutionRelief(goneCousin, 'drug_blacktar', 'depressant', NOW) === 1);
  check("substitution doesn't cross classes",
    T.substitutionRelief(freshCousin, 'drug_blacktar', 'stimulant', NOW) === 1);
  check("substitution is never total — a cousin isn't the drug you want",
    T.SUBSTITUTION_FLOOR > 0 && T.SUBSTITUTION_FLOOR < 1);
  check('a deep habit bites harder than a shallow one',
    T.WD_DEPTH_FLOOR > 0 && T.WD_DEPTH_FLOOR < 1);

  // --- uppers vs. the fatigue clock ------------------------------------------
  // The bender law: a habit doesn't just dull the high, it stops the drug holding
  // your eyes open. Without this the third day of a bender was the CHEAPEST one.
  const { stimulantPotency, isWired, getDrugCache } = await import('../../server/engine/drugs.js');
  const onStim = pot => ({ activeDrugs: [{ drugId: 'drug_redline', potency: pot }] });
  check('a fresh dose drives the fatigue clock at full strength',
    stimulantPotency(onStim(1)) === 1);
  check('...and a saturated habit barely holds your eyes open',
    stimulantPotency(onStim(0.3)) === 0.3);
  check("a depressant doesn't read as wired",
    stimulantPotency({ activeDrugs: [{ drugId: 'drug_alcohol', potency: 1 }] }) === 0);
  check('isWired still answers the sleep command as a yes/no',
    isWired(onStim(0.3)) === true && isWired({ activeDrugs: [] }) === false);
  check('the strongest active upper is the one driving',
    stimulantPotency({ activeDrugs: [{ drugId: 'drug_buzz', potency: 0.2 }, { drugId: 'drug_redline', potency: 0.9 }] }) === 0.9);

  // Tolerance has to OUTLIVE a bender to police it: shedding a full habit must
  // take longer than the gap between doses, or a nightly user never accumulates.
  const stimTol = ['drug_redline', 'drug_coldfire', 'drug_overclock', 'drug_buzz']
    .map(id => getDrugCache()[id]?.effects?.tolerance)
    .filter(Boolean);
  check("every upper has a tolerance block — one without it's a free bender",
    stimTol.length === 4, `${stimTol.length}/4`);
  check('...and sheds it over days, not the hour it used to take',
    stimTol.every(t => t.recovery_per_sec && t.recovery_per_sec * 3600 < 0.05),
    stimTol.map(t => t.recovery_per_sec).join(' '));
  // The DEFAULT is what every other drug inherits, and it was one game hour —
  // fast enough that tolerance may as well not have existed. Days, not hours.
  check('an undeclared tolerance still takes days of game time to shed',
    T.TOLERANCE_RECOVERY_PER_SEC * 3600 * 24 < 0.5, T.TOLERANCE_RECOVERY_PER_SEC);
  check('...and dependency outlasts the tolerance that was keeping you alive',
    T.ADDICTION_RECOVERY_PER_SEC < T.TOLERANCE_RECOVERY_PER_SEC);

  // --- differential tolerance: the gap that kills a veteran ------------------
  // One scalar used to dull the high AND raise the ceiling in lockstep, which made
  // a habit pure upside. These pin the two halves apart.
  const TOL = { gain_per_dose: 0.2, recovery_per_sec: 1 / 3600 };
  const habit = { tolerance: 0.8, tolerance_lethal: 0.8 };
  check('lethal tolerance builds slower than the high fades',
    T.LETHAL_TOLERANCE_GAIN_RATIO < 1 && T.LETHAL_TOLERANCE_GAIN_RATIO > 0);
  check("...and fades slower too, so quitting doesn't instantly strip your ceiling",
    T.LETHAL_TOLERANCE_RECOVERY_RATIO < 1 && T.LETHAL_TOLERANCE_RECOVERY_RATIO > 0);
  check('a clean stretch burns the felt tolerance faster than the lethal one', (() => {
    const d = T.decayTolerances(habit, TOL, 1800);
    return d.felt < d.lethal;
  })(), JSON.stringify(T.decayTolerances(habit, TOL, 1800)));
  check('neither half goes negative, however long you stay clean', (() => {
    const d = T.decayTolerances(habit, TOL, 99_999_999);
    return d.felt === 0 && d.lethal === 0;
  })());
  check('a fresh row starts level — no free ceiling for a new user', (() => {
    const d = T.decayTolerances({}, TOL, 0);
    return d.felt === 0 && d.lethal === 0;
  })());
  check('the overdose ceiling now rides the LETHAL half, not the felt one', (() => {
    // A veteran who has been clean a while: the high is gone, the protection is not.
    const veteran = T.decayTolerances({ tolerance: 1, tolerance_lethal: 1 }, TOL, 1800);
    return T.odCeiling(3, veteran.lethal) > T.odCeiling(3, veteran.felt);
  })());
  check('a drug can declare it has no lethal tolerance at all (psychedelics)', (() => {
    const d = T.decayTolerances({ tolerance: 0.5, tolerance_lethal: 0 }, TOL, 0);
    return d.lethal === 0 && T.odCeiling(3, d.lethal) === 3;
  })());

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
  check("a drug with no flags bag doesn't throw", T.resolveRoute('inject', {}).onset === 1);

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
  check("0.40 doesn't hook a clean player", stillAddicted(0.4, false) === false);
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

  // --- the mirror: what a drug does to your view of yourself ---------------
  const other = F.mirror({ note: 'Their pupils are blown black.', tripping: true }, false);
  check('another player still gets the bystander line', other === 'Their pupils are blown black.', other);
  check('a tripping self gets a trip line', F.SELF_LINES.tripping.includes(F.mirror({ tripping: true }, true)));
  check('a stimulant self reads as a stimulant', F.selfKey({ drugClass: 'stimulant' }) === 'stimulant');
  check('a depressant self reads as a depressant', F.selfKey({ drugClass: 'depressant' }) === 'depressant');
  check('hallucination outranks class', F.selfKey({ drugClass: 'stimulant', tripping: true }) === 'tripping');
  check('an unclassed drug falls back rather than crashing', F.selfKey({}) === 'other');

  // --- the item index -------------------------------------------------------
  // "Is this item a drug?" is asked per item on the witness path and once per
  // `use`, and the drugs table is already in memory — so the answer must be
  // synchronous and must agree exactly with the row the join used to return.
  const withItem = Object.values(getDrugCache()).filter(d => d.item_id);
  check('the world has drugs that sit on items at all', withItem.length > 0, String(withItem.length));
  if (withItem.length) {
    const d = withItem[0];
    check('an item carrying a drug resolves to its row', drugForItem(d.item_id)?.id === d.id, d.item_id);
    check('and reads as a drug', isDrugItem(d.item_id) === true);
    check('every drug with an item_id is reachable by it',
      withItem.every(x => drugForItem(x.item_id)?.id === x.id));
  }
  check("an item nothing was authored on isn't a drug", isDrugItem('item_not_a_drug_at_all') === false);
  check("a missing item id isn't a drug, and doesn't throw",
    isDrugItem(null) === false && isDrugItem(undefined) === false);
}
