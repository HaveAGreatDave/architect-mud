// Drugs plugin regression suite — run by tests/regress.js (never loaded in production).
//
// Covers the pharmacokinetic laws in server/engine/drugs.js. These are engine laws,
// but this plugin owns the verbs that deliver a dose (use/inject), so the coverage
// lives with it. Assertions run against the pure `_test` surface — no DB, no clock.
import { _test as T, getDrugCache, drugForItem, isDrugItem, clearActiveDrugState, tickDrugs } from '../../server/engine/drugs.js';
import { _test as F } from './index.js';
import { query } from '../../server/models/db.js';

export default async function regress({ run, check, getPlayer }) {
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
  // ⚠ DERIVED, never restated. These were four hard-coded numbers, and retuning
  // ONE drug's overdose_threshold in content turned the law-check below red while
  // the law itself was untouched — a test asserting a content value rather than
  // the rule it illustrates. Read the ceilings from the same cache the engine
  // reads and the arithmetic follows whatever the rows say.
  const ceilOf = (id) => getDrugCache()[id]?.overdose_threshold ?? 3;
  const CEIL = {
    alcohol: ceilOf('drug_alcohol'), blacktar: ceilOf('drug_blacktar'),
    lull: ceilOf('drug_lull'), grey: ceilOf('drug_grey'),
  };
  const share = (n, ceil) => n / ceil;
  // "half a skinful" is half of alcohol's own ceiling, whatever that is today.
  const halfSkinful = CEIL.alcohol / 2;
  check('a lone drug at its ceiling is still an overdose (old law intact)',
    share(CEIL.blacktar, CEIL.blacktar) >= 1);
  check('a lone drug under its ceiling is still safe',
    share(CEIL.blacktar - 1, CEIL.blacktar) < 1);
  check('half a skinful plus half a ceiling of tar reaches the limit',
    share(halfSkinful, CEIL.alcohol) + share(CEIL.blacktar / 2, CEIL.blacktar) >= 1);
  check('two drinks plus one bag of tar does NOT',
    share(2, CEIL.alcohol) + share(1, CEIL.blacktar) < 1, `ceil=${CEIL.alcohol}`);
  check('booze + benzo + morphine stacks to the limit',
    share(halfSkinful, CEIL.alcohol) + share(CEIL.lull / 2, CEIL.lull) + share(CEIL.grey / 2, CEIL.grey) >= 1);
  check('an unclassed drug contributes nothing to anyone', T.classBurden(
    [{ drug_id: 'drug_psilocybin', doses_in_system: 5, tolerance: 0 }], 'x', 'depressant') === 0);
  check("a different class doesn't cross-load",
    T.classBurden([{ drug_id: 'drug_alcohol', doses_in_system: 6, tolerance: 0 }], 'x', 'stimulant') === 0);
  check('the same class does cross-load',
    T.classBurden([{ drug_id: 'drug_alcohol', doses_in_system: 4, tolerance: 0 }], 'x', 'depressant')
      === share(4, CEIL.alcohol), `ceil=${CEIL.alcohol}`);
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
  // ⚠ Do NOT re-destructure `getDrugCache` here. A `const` of that name anywhere
  // in this function puts EVERY reference to it in the function's temporal dead
  // zone, including the ones above this line — which reads as
  // "Cannot access 'getDrugCache' before initialization" from a call site that
  // looks entirely innocent. It is already imported at the top of the file.
  const { stimulantPotency, isWired } = await import('../../server/engine/drugs.js');
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

  // --- death clears the habit, not the tolerance ----------------------------
  // The body that carried the addiction is the thing the vat replaced, so a clone
  // must not wake up owing withdrawal to a bender it never went on. Tolerance is
  // deliberately left standing: shedding it would make dying a way to reset dose
  // costs. Driven against a real row rather than asserted about the SQL string,
  // because the column list in that UPDATE is the thing that can silently drift.
  {
    const pid = getPlayer().id;
    const DID = 'drug_regress_habit';
    await query(
      'INSERT INTO player_drug_state (player_id, drug_id, active_until, doses_in_system, times_used, is_addicted, last_used_at, tolerance, addiction)'
      + " VALUES ($1,$2,$3,4,9,1,$4,0.7,0.9)"
      + ' ON CONFLICT (player_id, drug_id) DO UPDATE SET is_addicted=1, addiction=0.9, tolerance=0.7, doses_in_system=4, active_until=EXCLUDED.active_until',
      [pid, DID, Date.now() + 600000, Math.floor(Date.now() / 1000)]);
    await clearActiveDrugState(getPlayer());
    const { rows } = await query('SELECT * FROM player_drug_state WHERE player_id=$1 AND drug_id=$2', [pid, DID]);
    const row = rows[0];
    check('death leaves the drug row in place', !!row);
    check('death releases the dependency latch', Number(row?.is_addicted) === 0, String(row?.is_addicted));
    check('death zeroes accumulated addiction', Number(row?.addiction) === 0, String(row?.addiction));
    check('death still clears doses in system', Number(row?.doses_in_system) === 0, String(row?.doses_in_system));
    check('death does NOT reset tolerance', Number(row?.tolerance) > 0.6, String(row?.tolerance));
    await query('DELETE FROM player_drug_state WHERE player_id=$1 AND drug_id=$2', [pid, DID]);
  }

  // --- comedown_mods: a hangover is not the negative of the high -------------
  //
  // A comedown used to be expressible ONLY as a scaled copy of `peak_mods`, so
  // the one way to author a different one was a negative `comedown_scale`. That
  // inverts every key at once, including a `*_regen_per_sec` drip — and a drip
  // the engine caps at `<stat>_max` going up is floored only at zero coming
  // down, which turns a small regen into an unbounded bleed. These pin both
  // halves: the new block wins in the comedown, and a drug without one behaves
  // exactly as it did before.
  {
    const p2 = getPlayer();
    const baseCool = p2.stat_cool || 0;
    const baseBrains = p2.stat_brains || 0;
    const at = (key) => p2.activeDrugs.find(a => a.drugId === key);
    const PH = {
      comeup_seconds: 1, peak_seconds: 1, comedown_seconds: 600,
      comeup_scale: 1, comedown_scale: 1,
      peak_mods: { stat_cool: 4 },
      comedown_mods: { stat_brains: -3 },
    };

    T.startPhasedDrug(p2, { name: 'regress tipple' }, PH, 1, 'drug_regress_phase');
    check('the come-up applies the peak block', (p2.stat_cool || 0) === baseCool + 4, `cool=${p2.stat_cool} base=${baseCool}`);

    // Drop the entry into its comedown window and advance one tick.
    at('drug_regress_phase').startedAt = Date.now() - 3000;
    tickDrugs(p2);
    check('the comedown applies comedown_mods', (p2.stat_brains || 0) === baseBrains - 3, `brains=${p2.stat_brains} base=${baseBrains}`);
    check('and drops the peak block rather than scaling it', (p2.stat_cool || 0) === baseCool, `cool=${p2.stat_cool} base=${baseCool}`);

    // Ride it out: the ledger must reverse exactly, or a hangover is permanent.
    at('drug_regress_phase').startedAt = Date.now() - 999000;
    tickDrugs(p2);
    check('expiry reverses the comedown exactly', (p2.stat_brains || 0) === baseBrains && (p2.stat_cool || 0) === baseCool,
      `brains=${p2.stat_brains} cool=${p2.stat_cool}`);
    check('and the entry is gone', !p2.activeDrugs.some(a => a.drugId === 'drug_regress_phase'));

    // The legacy path: no comedown_mods, so the comedown is still a scaled peak.
    const LEGACY = { ...PH, comedown_mods: undefined, comedown_scale: 0.5 };
    T.startPhasedDrug(p2, { name: 'regress legacy' }, LEGACY, 1, 'drug_regress_legacy');
    at('drug_regress_legacy').startedAt = Date.now() - 3000;
    tickDrugs(p2);
    check('a drug with no comedown_mods still scales its peak block',
      (p2.stat_cool || 0) === baseCool + 2, `cool=${p2.stat_cool} base=${baseCool}`);
    at('drug_regress_legacy').startedAt = Date.now() - 999000;
    tickDrugs(p2);
    check('legacy comedown reverses too', (p2.stat_cool || 0) === baseCool, `cool=${p2.stat_cool}`);

    // Leave the shared fake player exactly as found.
    p2.activeDrugs = [];
  }

  // --- alcohol is authored at all -------------------------------------------
  //
  // It was the only drug row in the game with nothing in any column, which is
  // invisible until somebody goes looking. These fail if that is ever reverted.
  {
    const al = getDrugCache()['drug_alcohol'];
    const ph = al?.effects?.phases;
    check('alcohol has a phase arc', !!ph && ph.peak_seconds > 0, String(!!ph));
    check('alcohol authors its comedown rather than inverting its peak',
      !!ph?.comedown_mods && (ph.comedown_scale ?? 1) >= 0, `scale=${ph?.comedown_scale}`);
    check('alcohol can latch dependency, so its withdrawal can fire',
      Number(al?.addiction_chance) > 0 && !!al?.effects?.withdrawal?.mods, String(al?.addiction_chance));
    check('alcohol withdrawal speaks on all five beats',
      Object.keys(al?.effects?.withdrawal?.stages || {}).length === 5);
    // The two that must move together — see scripts/content/alcohol-arc.mjs.
    check('a long clearance window is paid for with a higher ceiling',
      !(al?.duration_seconds > 600) || al?.overdose_threshold >= 12,
      `dur=${al?.duration_seconds} od=${al?.overdose_threshold}`);
    // The BAC bands already move these; authoring them here debuffs twice.
    const clash = Object.keys(ph?.peak_mods || {})
      .filter(k => ['stat_cool', 'stat_reflexes', 'stat_brains', 'stat_endurance'].includes(k));
    check('alcohol leaves impairment to the BAC bands', clash.length === 0, clash.join(','));
  }

  // --- the corpus, not one drug ---------------------------------------------
  //
  // Three faults that are each INVISIBLE in the file they live in and only show
  // up when you hold all 39 rows side by side. scripts/content/drug-audit.mjs is
  // the readable version of this; these are the ones worth failing a build over.
  {
    const all = Object.values(getDrugCache());
    // The splice carrier composes its effects onto the inventory item, and the
    // two loose-leaf rows are raw material rather than a dose.
    const EXEMPT = new Set(['drug_compound', 'drug_loose_tobacco', 'drug_loose_cannabis']);
    const dosed = all.filter(d => !EXEMPT.has(d.id));

    // 1. A row that can hook you and then do nothing. The withdrawal tick is
    //    gated on wd.mods, so without them is_addicted latches for ever with no
    //    debuff, no line and no way to clear it.
    const hooksAndDoesNothing = all
      .filter(d => (d.addiction_chance || 0) > 0 && !d.effects?.withdrawal?.mods)
      .map(d => d.id);
    check('no drug can hook a player and then do nothing',
      hooksAndDoesNothing.length === 0, hooksAndDoesNothing.join(', '));

    // 2. A mod key nothing reads. applyMods does player[key] = (player[key]||0)+n
    //    for whatever it is handed, so a misspelt stat neither throws nor warns —
    //    it invents a field on the live player that no reader has heard of.
    //    drug_toluene carried stat_smarts in two blocks and it never once landed.
    const STATS = ['stat_brawn', 'stat_reflexes', 'stat_endurance', 'stat_brains', 'stat_cool', 'stat_senses'];
    const CAPS = ['hp_max', 'sanity_max', 'stamina_max'];
    const DRIPS = ['hp', 'sanity', 'stamina', 'radiation'];
    const readable = k => STATS.includes(k) || CAPS.includes(k)
      || (/_regen_per_sec$/.test(k) && DRIPS.includes(k.replace(/_regen_per_sec$/, '')));
    const deadKeys = [];
    for (const d of all) {
      const e = d.effects || {};
      for (const [blk, mods] of [['peak', e.phases?.peak_mods], ['comedown', e.phases?.comedown_mods], ['wd', e.withdrawal?.mods]]) {
        for (const k of Object.keys(mods || {})) if (!readable(k)) deadKeys.push(`${d.id}/${blk}.${k}`);
      }
    }
    check('every drug mod key is a field something actually reads', deadKeys.length === 0, deadKeys.join(', '));

    // 3. ⚠ A DRIP'S TWO DIRECTIONS ARE NOT SYMMETRIC. tickDrugs clamps a regen at
    //    <stat>_max going UP, so +3 hp/sec just refills fast and stops; going DOWN
    //    it is floored only at ZERO, so the same magnitude has a whole 100-point
    //    bar to eat. drug_overclock shipped sanity_regen_per_sec: -1 against a
    //    150s peak — one dose emptied a full sanity bar in a hundred seconds —
    //    authored at the same magnitude as four harmless POSITIVE sanity regens.
    const hotDrips = [];
    for (const d of all) {
      const e = d.effects || {};
      for (const [blk, mods] of [['peak', e.phases?.peak_mods], ['comedown', e.phases?.comedown_mods], ['wd', e.withdrawal?.mods]]) {
        for (const [k, v] of Object.entries(mods || {})) {
          if (!/_regen_per_sec$/.test(k)) continue;
          if (v < 0 && Math.abs(v) > 0.2) hotDrips.push(`${d.id}/${blk}.${k}=${v}`);
        }
      }
    }
    check('no negative drip is steep enough to empty a bar in a single phase',
      hotDrips.length === 0, hotDrips.join(', '));

    // 4. A phases block with no peak_mods runs the arc, fires every authored
    //    message, and does nothing to the player. drug_grey_ampoule did this for
    //    fifteen minutes at a stretch.
    const silentArcs = dosed.filter(d => d.effects?.phases && !Object.keys(d.effects.phases.peak_mods || {}).length).map(d => d.id);
    check('no drug runs a phase arc that does nothing', silentArcs.length === 0, silentArcs.join(', '));

    // 5. The come-up must not finish before the deferred instant hit lands, or
    //    the peak line prints before the arrival line. Two rows had this.
    const outOfOrder = dosed.filter(d => {
      const e = d.effects || {};
      return e.phases?.comeup_seconds != null && (e.onset_seconds || 0) > e.phases.comeup_seconds;
    }).map(d => `${d.id} (comeup ${d.effects.phases.comeup_seconds} < onset ${d.effects.onset_seconds})`);
    check('no drug peaks before it has finished arriving', outOfOrder.length === 0, outOfOrder.join(', '));

    // 6. Every dosed row has a shape over time. Nine hallucinogens ran rich timed
    //    trips while leaving every stat untouched — you could be unplugged from
    //    your own body and still shoot straight.
    const noArc = dosed.filter(d => !d.effects?.phases).map(d => d.id);
    check('every dosed drug has a phase arc', noArc.length === 0, noArc.join(', '));
  }
}
