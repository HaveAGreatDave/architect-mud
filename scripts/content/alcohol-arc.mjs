/**
 * Alcohol gets the arc every other drug already had.
 *
 * `drug_alcohol` was the only row in the game with nothing authored in any
 * column: no `phases`, no `peak_mods`, no phase messages, no `tolerance`, no
 * `withdrawal`, and `addiction_chance: 0`. Twenty-four drugs have a full
 * come-up/peak/comedown and twenty-six have a five-beat withdrawal, and the
 * substance every bar in Coldwater serves had none of it. drugs.js even names
 * alcohol in a comment as one of the rows that "carry no `phases` block, so they
 * never create an activeDrugs entry at all".
 *
 * THE SPLIT THIS PASS IS BUILT ON. Alcohol has two clocks and they are not the
 * same clock, which is why the arc could not simply be authored on top of what
 * was already there:
 *
 *   the BAC meter (plugins/intoxication) owns HOW DRUNK YOU ARE. It sums doses,
 *   decays, and drives slurring, staggering, blackouts and the band stat block.
 *   It is the right shape for drunkenness and the wrong shape for an arc,
 *   because it is a scalar with no memory of where on the curve you are.
 *
 *   the drug row owns THE ARC AROUND IT — the minutes before the drink arrives,
 *   the warmth once it does, and the hour afterwards.
 *
 * So nothing here restates impairment. `peak_mods` deliberately carries no stat
 * the BAC bands already move (cool, reflexes, brains, endurance are all theirs),
 * or a drinker would be debuffed twice from two places for one drink.
 *
 * ⚠ THE HANGOVER IS NOT THE NEGATIVE OF THE HIGH. `comedown_scale` accepts a
 * negative number and `scaleMods` multiplies, so `comedown_scale: -0.6` really
 * does invert `peak_mods` and really does look like a free hangover. It is a
 * trap twice over: it flips EVERY key, so a peak that dulls you hands back
 * `stat_brains: +1` in the morning, and an inverted `*_regen_per_sec` drip is
 * capped by the engine on the way up (at `<stat>_max`) and floored only at zero
 * on the way down, which turns a modest regen into an unbounded bleed. Hence
 * `phases.comedown_mods`, added alongside this pass: the comedown says what it
 * does instead of being derived from what the peak did.
 *
 * ⚠ `duration_seconds` IS NOT COSMETIC. `tickDrugDecayAll` only sheds doses once
 * `active_until < now`, so lengthening the window also stops the body clearing
 * alcohol for that whole span — which is what makes overdose reachable. Going
 * 240 → 1800 without touching the ceiling would have made four rust whiskeys
 * inside half an hour lethal, so `overdose_threshold` moves with it (8 → 14).
 * Never move one of these two without the other.
 *
 * ⚠ KNOWN LIMIT, LEFT ALONE DELIBERATELY. The hangover is scaled by `potency`,
 * which is one dose's strength, so twelve drinks and one drink produce the same
 * comedown. Making it cumulative means the phase engine reading the BAC meter,
 * which is a coupling worth more thought than a content pass should spend.
 *
 * The withdrawal half is NOT here. It lives in `withdrawal-stages.mjs` with the
 * other twenty-six, under that file's prose law.
 *
 *   node scripts/content/alcohol-arc.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const FILE = path.join(process.cwd(), 'content', 'drugs', 'drug_alcohol.json');
const CHECK = process.argv.includes('--check');

// Stats the BAC bands already own (plugins/intoxication BAND_MODS). Authoring
// any of these here would debuff a drinker twice for one drink.
const BAND_OWNED = ['stat_cool', 'stat_reflexes', 'stat_brains', 'stat_endurance'];

// plugins/intoxication DECAY_PER_TICK / TICK_SECONDS. Restated rather than
// imported because this is a content script and the plugin is a live module,
// but the intoxication regress asserts the two against each other so they
// cannot drift apart without a red.
const METER_DECAY_PER_SEC = 0.15 / 4;

// ONE number with two readers, because they are one fact. The BAC meter uses it
// as the absorption window and the phase arc uses it as the come-up, so the
// moment the meter tops out is the moment the peak line fires. Authored as two
// numbers they drift, and the drug tells you the warmth has arrived eleven
// minutes after you were visibly drunk.
const ABSORB_SECONDS = 240;

const ARC = {
  // 30 min in the system. Doses stop clearing until this passes, so it is the
  // binge window as much as it is the duration. See the ⚠ above.
  duration_seconds: 1800,
  // Raised with the window. A rust whiskey is 2 doses, so a lethal binge is now
  // about seven of them inside half an hour rather than four.
  overdose_threshold: 14,
  // A social drinker never reaches ADDICT_LATCH (0.5). Roughly five heavy
  // sessions inside the decay window does.
  addiction_chance: 0.12,

  flags: {
    // How long a drink takes to reach the meter. Read by plugins/intoxication;
    // 0 or absent lands the dose whole, which is what every other alcoholic row
    // and every test still does.
    //
    // ⚠ THE WINDOW IS BOUNDED BY THE DECAY RATE, and the first draft of this
    // file was not. The meter sheds DECAY_PER_TICK (0.15 per 4s = 0.0375/sec)
    // the whole time a dose is arriving, so a dose that arrives more slowly than
    // that is eaten on the way in and THE METER NEVER MOVES. At the honest
    // real-world figure of fifteen minutes, 22 points spread over 900s arrive at
    // 0.0244/sec against 0.0375/sec of decay: a drink would have done nothing at
    // all, for anybody, with no error anywhere. See ABSORPTION_RISES below.
    absorb_seconds: ABSORB_SECONDS,
    // ...and raised so the DESTINATION is unchanged. A drink used to put 22
    // points on the meter the instant it was swallowed; 31 arriving over 240s
    // against 0.0375/sec of decay peaks at 22.0. The lag is what is new. How
    // drunk a drink gets you is exactly what it was.
    intox_per_dose: 31,
  },

  phases: {
    // The come-up IS the absorption window. See ABSORB_SECONDS.
    comeup_seconds: ABSORB_SECONDS,
    peak_seconds: 1200,
    comedown_seconds: 3600,  // the hangover, and the longest phase on purpose
    comeup_scale: 0.3,
    // Full strength: `comedown_mods` is its own statement, not a fraction of the
    // peak, so there is nothing here to scale down.
    comedown_scale: 1,

    comeup_message: '<span class="msg-system">It goes down warm, and then does nothing at all, which is the first thing it does.</span>',
    peak_message: '<span class="msg-system">The warmth catches up with you all at once. The room is friendly. Your opinions are excellent.</span>',
    comedown_message: '<span class="msg-system">Somewhere in the last while your mouth turned to paper and the lights got louder.</span>',
    end_message: '<span class="msg-system">It finishes with you, and leaves you tired in a way that sleeping has already failed to fix.</span>',

    // The anxiolytic half, and nothing else. Everything a drinker can feel in
    // their hands or their judgement belongs to the BAC bands.
    peak_mods: {
      sanity_regen_per_sec: 0.015,
    },

    // The morning. Flat ledger mods, so they reverse exactly when the entry
    // expires, plus a small sanity bleed for the dread. About -14 sanity across
    // a full hour, floored at 0 by the engine.
    comedown_mods: {
      stat_brains: -2,
      stat_cool: -2,
      stat_endurance: -2,
      stat_reflexes: -1,
      sanity_regen_per_sec: -0.004,
    },
  },

  tolerance: {
    gain_per_dose: 0.03,
    max_reduction: 0.55,
    // Slower to shed than the 72-game-hour default: a drinker holds a tolerance.
    recovery_per_sec: 0.0000023,
    // THE ALCOHOL POINT. Felt tolerance climbs a long way and the dose that
    // stops your breathing barely moves, so a veteran drinker closes the gap
    // between "enough to feel it" and "enough to kill me" over a career. 0.15
    // against a 0.4 default is the whole differential-tolerance law aimed at the
    // substance it was written about.
    lethal_gain_ratio: 0.15,
  },
};

// ─── apply ───────────────────────────────────────────────────────────────────
const problems = [];
const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));

d.duration_seconds = ARC.duration_seconds;
d.overdose_threshold = ARC.overdose_threshold;
d.addiction_chance = ARC.addiction_chance;
d.flags = { ...(d.flags || {}), ...ARC.flags };
d.effects = { ...(d.effects || {}), phases: ARC.phases, tolerance: ARC.tolerance };

// ─── the invariants this pass exists to hold ─────────────────────────────────
const ph = d.effects.phases;

for (const k of Object.keys(ph.peak_mods || {})) {
  if (BAND_OWNED.includes(k)) problems.push(`peak_mods.${k} is already moved by the BAC bands — a drinker would be debuffed twice`);
}
if ((ph.comedown_scale ?? 1) < 0) {
  problems.push('negative comedown_scale inverts the whole peak block, drips included — author comedown_mods instead');
}
if (!ph.comedown_mods) {
  problems.push('no comedown_mods, so the hangover is only a scaled copy of the peak');
}
// A drip is per SECOND and the phase tick runs at 1 Hz, so a value that reads
// small is worth 60x itself a minute. Anything past this is an accident.
for (const [block, mods] of [['peak_mods', ph.peak_mods], ['comedown_mods', ph.comedown_mods]]) {
  for (const [k, v] of Object.entries(mods || {})) {
    if (/_regen_per_sec$/.test(k) && Math.abs(v) > 0.05) {
      problems.push(`${block}.${k} = ${v}/sec is ${(v * 60).toFixed(1)}/min — almost certainly a misplaced decimal`);
    }
  }
}
// The two that must move together.
if (d.duration_seconds > 600 && d.overdose_threshold < 12) {
  problems.push(`duration_seconds ${d.duration_seconds} holds doses in the system, but overdose_threshold is only ${d.overdose_threshold}`);
}
// Withdrawal is authored elsewhere, but it can only fire if this row can latch.
if (!(d.addiction_chance > 0)) {
  problems.push('addiction_chance is 0, so dependency can never latch and the withdrawal block can never fire');
}
// The two clocks must agree, or the prose contradicts the meter.
if (Number(d.flags.absorb_seconds) !== ph.comeup_seconds) {
  problems.push(`the come-up (${ph.comeup_seconds}s) and the absorption window (${d.flags.absorb_seconds}s) disagree, `
    + 'so the peak line fires at a different moment from the peak');
}
// ABSORPTION_RISES — the one that nearly shipped. A dose arriving slower than
// the meter decays is eaten on the way in, and a drink does nothing at all with
// nothing anywhere to say why.
const absorb = Number(d.flags.absorb_seconds) || 0;
const per = Number(d.flags.intox_per_dose) || 0;
if (absorb > 0) {
  const arriveRate = per / absorb;
  if (arriveRate <= METER_DECAY_PER_SEC) {
    problems.push(`a dose arrives at ${arriveRate.toFixed(4)}/sec against ${METER_DECAY_PER_SEC}/sec of decay, `
      + `so the meter would never move: shorten absorb_seconds or raise intox_per_dose`);
  }
  // Where one drink actually peaks, which is the number the tuning is FOR.
  const peak = per - METER_DECAY_PER_SEC * absorb;
  if (peak < 15 || peak > 30) {
    problems.push(`one drink peaks at ${peak.toFixed(1)} on a 0-100 meter, which is not the ~22 the bands were drawn around`);
  }
}

for (const p of problems) console.error('  ! ' + p);
if (!problems.length && !CHECK) fs.writeFileSync(FILE, canonicalJson(d), 'utf8');

const total = ph.comeup_seconds + ph.peak_seconds + ph.comedown_seconds;
const peakOf = (Number(d.flags.intox_per_dose) || 0) - METER_DECAY_PER_SEC * (Number(d.flags.absorb_seconds) || 0);
console.log(`${CHECK ? '[check] ' : ''}Alcohol arc: ${ph.comeup_seconds}s up / ${ph.peak_seconds}s peak / ${ph.comedown_seconds}s down (${(total / 60).toFixed(0)} min), `
  + `${d.duration_seconds}s in system, OD at ${d.overdose_threshold}, addiction ${d.addiction_chance}.`);
console.log(`  One drink: ${d.flags.intox_per_dose} points arriving over ${d.flags.absorb_seconds}s, peaking at ${peakOf.toFixed(1)} on the meter.`);
if (problems.length) { console.error(`${problems.length} problem(s).`); process.exit(1); }
