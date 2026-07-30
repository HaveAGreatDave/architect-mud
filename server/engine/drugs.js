/**
 * Drug system — dev-panel editable substances with phased effects
 * (come-up / peak / comedown), tolerance, addiction/withdrawal, lethal
 * overdose, and hallucination hooks. Mirrors the recipes caching pattern:
 * DB is source of truth, cached in memory at boot.
 *
 * The `effects` JSONB is one schema with all sub-blocks optional:
 *   instant       — one-shot stat deltas (existing behaviour)
 *   phases        — { comeup_seconds, peak_seconds, comedown_seconds,
 *                     comeup_scale, comedown_scale, peak_mods, *_message }
 *   tolerance     — { gain_per_dose, recovery_per_sec, max_reduction }
 *   withdrawal    — { onset_seconds, mods, message, addiction_per_dose,
 *                     addiction_recovery_per_sec }
 *   overdose      — { lethal, message, mods }
 *   hallucination — { mode, intensity, palette, duration_seconds, events }
 *                     mode 'dreamzone' takes the MIND out of the room into a
 *                     private generated dreamscape (the body stays put). It
 *                     names no destination: the authored, SHARED dreamzones and
 *                     their `dreamzone_id` are retired, because two people on
 *                     the same drug used to meet inside the hallucination.
 *
 * Back-compat: a drug whose `effects` has none of the structured keys above
 * is treated as a flat `instant` block, so pre-existing drugs run untouched.
 */
import { query } from '../models/db.js';
import { foodLoad, drinkLoad } from './bodily.js';
import { applyMods, reverseMods } from './statmods.js';
import { fireHook } from './plugins.js';
import { emit } from './events.js';
import { getTimeScale } from './gametime.js';
import { STIM_FATIGUE_RELIEF, STIM_FATIGUE_INTEREST } from './condition.js';
import { sendToPlayer } from './messaging.js';

let DRUG_CACHE = {};

// peak_mods keys ending in this are per-second "drip" regen, not flat buffs.
const REGEN_RE = /_regen_per_sec$/;

// --- pharmacokinetic laws ----------------------------------------------------
// These are curve shapes over the drug substrate, not combat knobs, so they live
// here as named constants alongside DIURETIC_* rather than in combat_config.

// Tolerance raises the body's ceiling: a seasoned user survives a dose that would
// stop a clean heart. The corollary is the point — abstinence burns tolerance away,
// so the habit dose you walked away from is the one that kills you on the way back.
const OD_TOLERANCE_BONUS = 1.5;      // +150% overdose headroom at full tolerance

// ── What you know about a compound, and how you found out ────────────────────
//
// Knowledge is earned by CONSEQUENCE, not by a use counter. Reading "you have
// taken this 6 times, here is its overdose ceiling" is a database telling you a
// number; learning that ceiling because you went past it and your body revolted
// is the game teaching you something. So each fact has exactly one way in, and
// it is the experience that fact describes:
//
//   FELT       you took it and lived — what it feels like, the prose you saw
//   EFFECTS    you rode a full peak — what it actually does to you
//   DURATION   you rode one out to the end — how long it holds you
//   OVERDOSE   you took too much — where the ceiling is
//   ADDICTION  it got its hooks in — that it can
//   WITHDRAWAL you came off it badly — what that costs
//
// Stored as a bitmask on player_drug_state.known_facts, which is already the
// per-player-per-drug table. Never decays: you do not un-learn what a bad night
// taught you.
export const DRUG_FACTS = {
  FELT:       1,
  EFFECTS:    2,
  DURATION:   4,
  OVERDOSE:   8,
  ADDICTION: 16,
  WITHDRAWAL:32,
};

/**
 * Record that this player now knows `bit` about `drugId`.
 *
 * Fire-and-forget and idempotent — a bitwise OR, so re-learning is a no-op and
 * two ticks racing cannot lose a fact. Never awaited on a hot path: knowing
 * something a second late costs nothing, and a failed write must not interrupt
 * a drug tick.
 */
export function learnDrugFact(playerId, drugId, bit) {
  if (!playerId || !drugId || !bit) return;
  query(
    `UPDATE player_drug_state SET known_facts = COALESCE(known_facts,0) | $3
       WHERE player_id=$1 AND drug_id=$2 AND (COALESCE(known_facts,0) & $3) = 0`,
    [playerId, drugId, bit]
  ).catch(() => {});
}

// How fast an UNDECLARED tolerance burns off, per second of GAME time (every
// caller multiplies elapsed real time by getTimeScale()).
//
// This was `1/3600` — a full tolerance shed in one game hour — which quietly made
// tolerance meaningless for every drug that didn't override it: you could never
// hold one long enough to feel the dulled high, and the relapse law (the habit
// dose that kills you once you're clean) had nothing to take away because you
// were clean again by morning. Real tolerance is a days-to-weeks phenomenon.
//
// Scaled rather than literal: three GAME days to shed a full habit puts it on the
// same axis as the fatigue curve (FATIGUE_FULL_HOURS = 72), which is the longest
// span the body simulation asks a player to think in. A night off the stuff makes
// a real dent; a week clean puts you back to a lethal first dose. Drugs that
// should shed faster say so on their own row — the uppers do, at ~1 game day,
// because a stimulant habit is supposed to be reachable inside one bender.
const TOLERANCE_RECOVERY_PER_SEC = 1 / (72 * 3600);

// Dependency outlasts tolerance — that gap is the trap. Twice the span, so a
// player whose tolerance has burned off (and whose ceiling has dropped with it)
// is still being pulled back toward the dose that will now kill them.
const ADDICTION_RECOVERY_PER_SEC = 1 / (144 * 3600);

// DIFFERENTIAL TOLERANCE — the thing that actually kills long-term users.
//
// Tolerance was one number doing two jobs: it dulled the high AND raised the
// overdose ceiling, in lockstep. That made a habit pure upside — less effect, but
// proportionally more headroom — so the safe play was to build one and stay there.
//
// Real tolerance is differential. You stop feeling the euphoria fairly quickly;
// your brainstem never stops caring, so tolerance to respiratory depression builds
// slowly and never fully. The user chases the high they remember while the dose
// that stops their breathing has barely moved, and the margin between "enough to
// feel it" and "enough to kill me" closes over a career.
//
// So `tolerance` is now the FELT one (drives potency) and `tolerance_lethal` the
// one that raises the ceiling. It gains at a FRACTION of the felt rate and fades
// at a fraction of the felt rate — slow in, slow out, which is what makes a deep
// habit precarious rather than comfortable, and what makes the relapse law bite
// from both ends.
//
// Per-drug override: `tolerance.lethal_gain_ratio` / `tolerance.lethal_recovery_ratio`.
// A psychedelic that can't stop your breathing should set the gain ratio to 0 —
// it has no meaningful lethal tolerance, which is also true of the real ones.
const LETHAL_TOLERANCE_GAIN_RATIO = 0.4;      // lethal tolerance builds at 40% of felt
const LETHAL_TOLERANCE_RECOVERY_RATIO = 0.5;  // ...and fades at 50% of felt's rate

/** The pair of tolerances a row currently carries, both lazily decayed. */
function decayTolerances(row, tol, elapsedSec) {
  const rec = tol?.recovery_per_sec ?? TOLERANCE_RECOVERY_PER_SEC;
  const shed = rec * elapsedSec * getTimeScale();
  const felt = Math.max(0, Math.min(1, (row?.tolerance || 0) - shed));
  const lethal = Math.max(0, Math.min(1, (row?.tolerance_lethal || 0)
    - shed * (tol?.lethal_recovery_ratio ?? LETHAL_TOLERANCE_RECOVERY_RATIO)));
  return { felt, lethal };
}

// Route of administration. `onset` scales the come-up delay; `intensity` scales the
// felt strength AND the dose's weight against the overdose ceiling. `requires` gates
// the accelerated routes on a drug flag, so a drug nobody marked injectable falls
// back to neutral — unflagged content behaves exactly as it does today.
// `requires` lists the flags that make a route plausible — ANY one is enough.
// Smoking covers both tobacco (`smokeable`, owned by the smoking plugin) and
// cannabis (`cannabis`, owned by the cannabis plugin): they burn the same way,
// even though different plugins own their behaviour.
const ROUTES = {
  inject: { onset: 0.15, intensity: 1.30, requires: ['injectable'] },
  smoke:  { onset: 0.35, intensity: 1.15, requires: ['smokeable', 'cannabis'] },
  drink:  { onset: 1.50, intensity: 0.90 },
  eat:    { onset: 3.00, intensity: 0.80 },
  use:    { onset: 1,    intensity: 1 },
};
const NEUTRAL_ROUTE = ROUTES.use;

// Doses clear on a half-life rather than a flat -1/min step: the body sheds a
// fraction of what's still in it, so a heavy load falls fast and a trace lingers.
const DOSE_CLEARANCE_FRACTION = 0.25;

// Withdrawal severity arc — ramps in, holds at peak, then tapers to a floor it
// never drops below while still addicted. Seconds measured from the onset point.
const WD_RAMP_SECONDS  = 1800;       // 30 min climbing to full severity
const WD_PEAK_SECONDS  = 7200;       // 2 h held at the worst of it
const WD_TAPER_SECONDS = 21600;      // 6 h easing back down
const WD_FLOOR = 0.25;               // the ache never fully leaves until you're clean

// Addiction hysteresis: it takes more to acquire dependency than to keep it, so the
// latch and the release sit at different heights. Equal thresholds made a player
// hovering at the line flicker in and out of addiction every tick.
const ADDICT_LATCH = 0.5;
const ADDICT_RELEASE = 0.3;

// Polydrug load. Drugs of the same pharmacological class (`flags.drug_class`)
// depress — or drive — the same system, so they share a ceiling. Booze plus an
// opioid plus a benzo is the classic real-world death, and without this it was
// SAFER than three of any one of them, because each overdosed on its own private
// counter.
//
// Every same-class drug contributes its doses as a fraction of ITS OWN ceiling,
// and you overdose when the total reaches 1. For a lone unclassed drug that
// reduces to exactly `doses >= threshold` — the old law, untouched — so untagged
// content behaves precisely as it did before. Half a skinful (4 of alcohol's 8)
// plus one bag of tar (1 of blacktar's 2) is 1.0, and that is the whole point.
const CLASS_BURDEN_LIMIT = 1;

// Class membership cuts three more ways, all of them things the same shared
// receptors would actually do:
//
//   SUBSTITUTION — any drug in the class takes the edge off the class's
//   withdrawal, which is the entire reason methadone exists and the reason a
//   sick addict takes whatever is nearest instead of holding out. It never fully
//   relieves: a cousin is not the drug you want.
//
//   CROSS-TOLERANCE — a career opioid user does not feel their first gelcap of
//   synthetic morphine like a virgin would. Half credit, and it feeds BOTH the
//   dulled high and the raised ceiling, so class membership protects as well as
//   endangers. Without this, sharing an overdose ceiling would be purely punitive.
//
//   DEPTH — how hard withdrawal bites should depend on how deep the habit got,
//   not only on how long it has been. A two-pack smoker and someone at 0.95
//   addiction had identical arcs.
const SUBSTITUTION_FLOOR = 0.35;   // a fresh cousin dose leaves 35% of the bite
const CROSS_TOLERANCE = 0.5;       // half of a same-class drug's tolerance carries
const WD_DEPTH_FLOOR = 0.6;        // severity multiplier at the addiction latch

// How much of the class's withdrawal a recently-taken cousin is holding off.
// 1 = no relief. Decays back to 1 as the cousin's own active window runs out.
function substitutionRelief(rows, excludeKey, drugClass, now) {
  if (!drugClass) return 1;
  let best = 1;
  for (const r of rows) {
    if (r.drug_id === excludeKey) continue;
    const other = DRUG_CACHE[r.drug_id];
    if (!other || other.flags?.drug_class !== drugClass) continue;
    const since = now - (r.last_used_at || 0);
    const window = other.duration_seconds || 300;
    if (since < 0 || since >= window) continue;                  // worn off — no help
    const relief = SUBSTITUTION_FLOOR + (1 - SUBSTITUTION_FLOOR) * (since / window);
    if (relief < best) best = relief;
  }
  return best;
}

// The strongest same-class tolerance a player carries, at CROSS_TOLERANCE credit.
// Returns BOTH halves: a career opioid user meets a new synthetic with a dulled
// high AND some of the raised ceiling, and the two travel at their own rates.
// `which` selects a half for the callers that only want one.
function crossTolerance(rows, excludeKey, drugClass, now, which = 'felt') {
  if (!drugClass) return 0;
  let best = 0;
  for (const r of rows) {
    if (r.drug_id === excludeKey) continue;
    const other = DRUG_CACHE[r.drug_id];
    if (!other || other.flags?.drug_class !== drugClass) continue;
    // Decay it the same lazy way its own row would be decayed on use.
    const elapsed = Math.max(0, now - (r.last_used_at || now));
    const tol = decayTolerances(r, other.effects?.tolerance, elapsed)[which];
    if (tol > best) best = tol;
  }
  return best * CROSS_TOLERANCE;
}

// What a bystander can SEE. 27 of 30 drugs were completely invisible — you could
// be mid-trip on a deliriant, pupils like dinner plates, and look entirely normal
// to everyone in the room. Drugs in a MUD are social; half the point is other
// people clocking that you are a mess.
//
// A drug shows only if it is the kind of thing that WOULD show: it declares a
// class, it makes you hallucinate, or it authors its own line. That deliberately
// leaves coffee and a cigarette invisible (nobody can see your caffeine), and
// leaves the joint's red eyes and the drink in your hand to the cannabis and
// consume plugins, which already narrate them.
const VISIBLE_BY_CLASS = {
  stimulant:  'Their jaw is working at nothing, and their eyes are open a size too wide.',
  depressant: 'Their eyelids keep sliding shut, and they surface a beat late from every sentence.',
};
const VISIBLE_TRIPPING = 'Their pupils are blown black, and they keep tracking something that is not there.';

// The line a given drug would put on your face, or null if nothing would show.
function appearanceNoteFor(drug) {
  const eff = drug?.effects || {};
  return eff.appearance_note
    || (eff.hallucination ? VISIBLE_TRIPPING : null)
    || VISIBLE_BY_CLASS[drug?.flags?.drug_class]
    || null;
}

// Returns { note, illegal, name } while a visible dose is still working, else null.
// Read by the drugs plugin (examine) and by surveillance (public intoxication), so
// the mirror and the law can never disagree about who looks off their head.
//
// Stamped at dose time rather than derived from `activeDrugs`: five drugs — ether,
// k-hole, threshold, voidwalk and alcohol — carry no `phases` block, so they never
// create an activeDrugs entry at all and would have stayed invisible no matter how
// wrecked they left you.
export function visibleIntoxication(player) {
  const v = player?._visibleDrug;
  if (!v || Date.now() >= v.until) return null;
  return v;
}

// Is the player currently running on something that would keep them awake?
// Exported so the sleep command can ask the drug system a question instead of
// growing its own opinion about pharmacology.
export function isWired(player) {
  return stimulantPotency(player) > 0;
}

// ...and HOW HARD it's driving them, 0 when nothing is. Potency is already
// `1 − tolerance × max_reduction`, so this is the seam through which tolerance
// reaches the fatigue clock: a habit doesn't just dull the high, it stops the
// drug holding your eyes open. Without it a saturated user got a barely-there
// buff and the FULL night of wakefulness, which is the wrong way round — the
// third day of a bender is supposed to be the expensive one.
export function stimulantPotency(player) {
  let best = 0;
  for (const a of player?.activeDrugs || []) {
    if (DRUG_CACHE[String(a.drugId).replace(/:.*$/, '')]?.flags?.drug_class !== 'stimulant') continue;
    best = Math.max(best, Number(a.potency) || 0);
  }
  return best;
}

// What the player's OTHER same-class drugs are already doing to them; the caller
// adds the share of the dose being taken. Each row counts against the ceiling of
// its own drug, tolerance included — a seasoned drinker's beers weigh less.
function classBurden(rows, excludeKey, drugClass) {
  if (!drugClass) return 0;
  let burden = 0;
  for (const r of rows) {
    if (r.drug_id === excludeKey) continue;
    const other = DRUG_CACHE[r.drug_id];
    if (!other || other.flags?.drug_class !== drugClass) continue;
    const doses = r.doses_in_system || 0;
    if (!doses) continue;
    // The cousin's own ceiling, off its LETHAL tolerance — this is a question about
    // what the body survives, not about what it still feels, so the felt half would
    // be the wrong number here in exactly the way it was wrong in odCeiling.
    const ceiling = Math.max(1, Math.round((other.overdose_threshold ?? 3) * (1 + (r.tolerance_lethal || 0) * OD_TOLERANCE_BONUS)));
    burden += doses / ceiling;
  }
  return burden;
}

// Resolve a consumption route to its multipliers. An unknown route, or an
// accelerated route the drug doesn't support, degrades to neutral.
function resolveRoute(routeName, drug) {
  const r = ROUTES[routeName];
  if (!r) return NEUTRAL_ROUTE;
  if (r.requires && !r.requires.some(f => drug?.flags?.[f])) return NEUTRAL_ROUTE;
  return r;
}

// Withdrawal severity in [WD_FLOOR, 1] as a function of time since withdrawal
// began biting. Per-drug overrides ride the withdrawal block.
function withdrawalSeverity(sinceOnset, wd) {
  if (sinceOnset <= 0) return 0;
  const ramp  = wd.ramp_seconds  ?? WD_RAMP_SECONDS;
  const peak  = wd.peak_seconds  ?? WD_PEAK_SECONDS;
  const taper = wd.taper_seconds ?? WD_TAPER_SECONDS;
  if (sinceOnset < ramp) return WD_FLOOR + (1 - WD_FLOOR) * (sinceOnset / ramp);
  if (sinceOnset < ramp + peak) return 1;
  const t = Math.min(1, (sinceOnset - ramp - peak) / Math.max(1, taper));
  return 1 - (1 - WD_FLOOR) * t;
}

export async function loadDrugs() {
  const { rows } = await query('SELECT * FROM drugs');
  const cache = {};
  for (const d of rows) cache[d.id] = d;
  DRUG_CACHE = cache;
  return cache;
}

export function getDrugCache() { return DRUG_CACHE; }

// --- effects-block helpers ---------------------------------------------------

const STRUCTURED_KEYS = ['instant', 'phases', 'hallucination', 'tolerance', 'withdrawal', 'overdose'];
function isStructured(eff) { return STRUCTURED_KEYS.some(k => k in eff); }

function buffModsOf(peakMods) {
  const o = {};
  for (const k in peakMods) if (!REGEN_RE.test(k)) o[k] = peakMods[k];
  return o;
}
function dripModsOf(peakMods) {
  const o = {};
  for (const k in peakMods) if (REGEN_RE.test(k)) o[k] = peakMods[k];
  return o;
}
function scaleMods(mods, factor) {
  const o = {};
  for (const k in mods) { const v = Math.round((mods[k] || 0) * factor); if (v) o[k] = v; }
  return o;
}

// Scale an instant-effects block by a multiplier (synthesis potency), preserving
// sign. Non-numeric keys pass through untouched.
function scaleInstant(instant, mult) {
  if (mult === 1) return instant;
  const o = {};
  for (const k in instant) {
    const v = instant[k];
    o[k] = typeof v === 'number' ? Math.round(v * mult) : v;
  }
  return o;
}

// --- consumption -------------------------------------------------------------

export async function useDrug(player, drugId, broadcast, opts = {}) {
  const drug = DRUG_CACHE[drugId];
  if (!drug) return { success: false, message: 'Unknown substance.' };

  // Synthesis potency: a cooked drug carries a strength multiplier (custom_data.
  // potency) that scales its effects AND its overdose weight. 1 = stock strength.
  const potencyMult = Math.min(3, Math.max(0.1, Number(opts.potencyMult) || 1)); // clamp both ends — a stray custom_data.potency can't scale effects without limit

  // Route of administration (opts.route — the verb that delivered the dose). It
  // rides on top of batch potency: `intensityMult` is what the body actually gets,
  // while `potencyMult` stays pure batch strength so the "this batch is strong"
  // tell still reports the cook, not the needle.
  const route = resolveRoute(opts.route, drug);
  const intensityMult = Math.min(3, Math.max(0.1, potencyMult * route.intensity));

  // Inline drug: a spliced compound carries its whole composed effects blob on
  // the inventory item (custom_data.effects) rather than a DB drugs row. When
  // present it overrides the carrier drug's effects/name/thresholds. `doseWeight`
  // is the overload penalty — a busy compound counts as extra doses.
  const eff = opts.inlineEffects || drug.effects || {};
  const displayName = opts.displayName || drug.name;
  const odThreshold = opts.overdoseThreshold ?? drug.overdose_threshold ?? 3;
  const durationSeconds = opts.durationSeconds ?? drug.duration_seconds ?? 300;
  const extraDoseWeight = Math.max(0, Math.round(Number(opts.doseWeight) || 0));

  const structured = isStructured(eff);
  const instant = structured ? (eff.instant || {}) : eff;
  // Timed drinks (the consume plugin) credit the drink's thirst restore
  // incrementally — a slice per sip — then land the dose with this flag set so
  // the final swallow doesn't re-apply the whole thirst on top. Cloned, never
  // mutated, so the shared drug-cache row stays intact. The diuretic water-shift
  // still bites at finish (it's dehydration, not the restore).
  const instantEff = (opts.skipThirstRestore && instant && instant.thirst != null)
    ? (() => { const { thirst, ...rest } = instant; return rest; })()
    : instant;
  const phases = eff.phases;
  const tol = eff.tolerance || {};
  const wd = eff.withdrawal || {};
  // Effects object exposed to hallucination hooks (so the trip plugin reads the
  // composed hallucination, not the empty carrier's).
  const drugForHooks = opts.inlineEffects ? { ...drug, effects: eff, name: displayName } : drug;

  // Identity for per-drug state and for the reversible-mod ledger. Normally the
  // drug id — but every spliced compound rides the SAME carrier row
  // (drug_compound), so without a distinct key their doses, tolerance and buffs
  // would all pool: three doses of one compound could overdose you on the first
  // dose of an unrelated one, and dosing B would cancel A's buffs.
  const stateKey = opts.stateKey || drugId;

  const now = Math.floor(Date.now() / 1000);
  // The player's WHOLE drug state, not just this drug's row — the polydrug law
  // needs to see what else is already in them. Same single round trip either way.
  const { rows } = await query('SELECT * FROM player_drug_state WHERE player_id=$1', [player.id]);
  const state = rows.find(r => r.drug_id === stateKey);
  const lastUsed = state?.last_used_at || now;
  const elapsed = Math.max(0, now - lastUsed);

  // Tolerance: lazy recovery since last use, then gain this dose.
  // Potency is locked to tolerance BEFORE this dose's gain is added.
  // Recovery rates are authored per real-world second at 1× — scale the elapsed
  // span by the game-speed knob so tolerance/addiction fade over game time.
  let { felt: tolerance, lethal: toleranceLethal } = decayTolerances(state, tol, elapsed);
  // Cross-tolerance: a career opioid user does not meet their first gelcap of
  // synthetic morphine like a virgin. Only the DERIVED numbers below use this —
  // the drug's own stored tolerance is what gets written back, so a cousin habit
  // is never laundered into this drug's row.
  const effTolerance = Math.max(tolerance,
    crossTolerance(rows, stateKey, drug.flags?.drug_class, now, 'felt'));
  const effToleranceLethal = Math.max(toleranceLethal,
    crossTolerance(rows, stateKey, drug.flags?.drug_class, now, 'lethal'));
  const potency = Math.max(0, 1 - effTolerance * (tol.max_reduction ?? 0.7));
  // Relapse law: the overdose ceiling rides on the LETHAL tolerance carried into
  // this dose (pre-gain, post-decay), so the same habit dose that was routine at
  // peak tolerance becomes lethal once time clean has burned it off. Reading the
  // lethal half rather than the felt one is what makes a deep habit dangerous
  // instead of comfortable: the high fades faster than the protection does not.
  const effOdThreshold = Math.max(1, Math.round(odThreshold * (1 + effToleranceLethal * OD_TOLERANCE_BONUS)));
  const feltGain = tol.gain_per_dose ?? 0;
  tolerance = Math.min(1, tolerance + feltGain);
  toleranceLethal = Math.min(1, toleranceLethal
    + feltGain * (tol.lethal_gain_ratio ?? LETHAL_TOLERANCE_GAIN_RATIO));

  // A stronger dose counts for more in the system — higher potency, or a route that
  // delivers it harder, means fewer doses to overdose.
  const doseInc = Math.max(1, Math.round(intensityMult), extraDoseWeight);
  // Combined potency drives phased-buff magnitude and hallucination intensity.
  const effPotency = potency * intensityMult;

  const dosesInSystem = (state?.doses_in_system || 0) + doseInc;
  const timesUsed = (state?.times_used || 0) + 1;

  // Polydrug law: this dose's share of its own ceiling, plus whatever the other
  // drugs of the same class are already contributing. Unclassed drugs carry no
  // cross-load, so `burden >= 1` is identical to the old `doses >= threshold`.
  const drugClass = drug.flags?.drug_class;
  const crossBurden = classBurden(rows, stateKey, drugClass);
  const burden = (dosesInSystem / effOdThreshold) + crossBurden;
  const overdosed = burden >= CLASS_BURDEN_LIMIT;

  // Addiction: lazy decay since last use, then accumulate this dose.
  const addRec = wd.addiction_recovery_per_sec ?? ADDICTION_RECOVERY_PER_SEC;
  let addiction = Math.max(0, (state?.addiction || 0) - addRec * elapsed * getTimeScale());
  addiction = Math.min(1, addiction + (wd.addiction_per_dose ?? drug.addiction_chance ?? 0));
  let justAddicted = false;
  let isAddicted = state?.is_addicted ? true : false;
  // Hysteresis: dependency latches at the higher mark and only releases at the lower
  // one (see applyWithdrawal), so hovering near the line can't flicker you in and out.
  if (!isAddicted && addiction >= ADDICT_LATCH) { isAddicted = true; justAddicted = true; }

  // An inline compound has no `drugs` row, so stash its composed effects on the
  // state row — otherwise the withdrawal tick has nothing to resolve and a player
  // can latch is_addicted forever with no debuff and no message.
  await query(
    `INSERT INTO player_drug_state (player_id, drug_id, active_until, doses_in_system, times_used, is_addicted, last_used_at, tolerance, addiction, effects, tolerance_lethal)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (player_id, drug_id) DO UPDATE SET active_until=$3, doses_in_system=$4, times_used=$5, is_addicted=$6, last_used_at=$7, tolerance=$8, addiction=$9, effects=$10, tolerance_lethal=$11`,
    [player.id, stateKey, now + durationSeconds, dosesInSystem, timesUsed, isAddicted ? 1 : 0, now, tolerance, addiction,
     opts.inlineEffects ? JSON.stringify(eff) : null, toleranceLethal]
  );

  // You have taken it and you are still here: you know what it feels like.
  // Everything past this has to be earned the hard way.
  learnDrugFact(player.id, stateKey, DRUG_FACTS.FELT);
  if (overdosed) learnDrugFact(player.id, stateKey, DRUG_FACTS.OVERDOSE);
  if (justAddicted) learnDrugFact(player.id, stateKey, DRUG_FACTS.ADDICTION);

  // Re-dosing clears any active withdrawal for this drug.
  reverseMods(player, `withdrawal:${stateKey}`);
  player._withdrawalActive?.delete(stateKey);

  // Substitution: if this dose is easing a DIFFERENT drug's withdrawal — a cousin
  // in the same class — say so. The relief itself is applied by the withdrawal
  // tick (which recomputes severity); this is the moment the player feels it.
  const substituting = drug.flags?.drug_class && [...(player._withdrawalActive?.keys() || [])]
    .some(k => DRUG_CACHE[k]?.flags?.drug_class === drug.flags.drug_class);

  // Consumption happened — flag it for the crime/wanted system. Legal drugs
  // (coffee, beer: drug.flags.legal) draw no police attention; controlled
  // substances do, but only if a camera actually catches it (raiseCrime gates).
  emit('player.drugUsed', { player, drug, potency: effPotency, illegal: !drug.flags?.legal, zoneId: player.current_zone });

  // `opts.takeLine` lets a caller supply the consumption sentence (e.g. the
  // consume plugin's substance-appropriate "You drain the last of the beer…"),
  // replacing the generic "You take X." + description. Drinks/smokes read better
  // as an act than as a flat "take".
  // The ACT, not a generic "take": a cigarette is smoked, coffee is sipped, dust is
  // snorted, a gelcap is swallowed. Authored per drug as `effects.take_line` (with a
  // {name} token). Injecting overrides whatever the default act is — the needle is
  // its own verb — and only when the drug actually supports it, since resolveRoute
  // has already degraded `inject` to neutral for anything not flagged injectable.
  const actLine = route === ROUTES.inject
    ? `You find a vein and push ${displayName} into your blood.`
    // A spliced compound's inline blob carries no take_line, so fall back to the
    // carrier drug's — otherwise the authored line would be dead for every splice.
    : (() => {
        const authored = eff.take_line || drug.effects?.take_line;
        return authored ? String(authored).replace(/\{name\}/g, displayName) : `You take ${displayName}.`;
      })();
  let message = opts.takeLine != null
    ? opts.takeLine
    : `${actLine} ${(opts.inlineEffects ? '' : drug.description) || ''}`.trim();

  // Diuretic factor (effects.diuretic): how the substance shifts water balance.
  // 1 = neutral (water). >1 diuretic (beer, coffee, stims) — pulls water into the
  // bladder and dehydrates. <1 antidiuretic (opioids) — retention. Applied in
  // applyEffects. Structured & flat effects both keep it at the effects top level.
  const dv = Number(eff.diuretic);
  const diuretic = dv > 0 ? dv : 1;

  // Onset (effects.onset_seconds): how long the dose takes to hit. 0 = instant
  // (today's behaviour — a snap, for cocaine-types). >0 defers the instant block
  // AND the hallucination trigger to land after N seconds, so most drugs "come on"
  // instead of snapping. The come-up ramp of a *buff* lives in phases (comeup_scale);
  // onset is the deferral of the one-shot instant hit + trip. Not applied to
  // overdose (too-much-too-fast hits now, regardless).
  // Route stretches or collapses the come-up: a needle lands almost at once, a
  // swallowed dose takes its time getting through the gut.
  const onset = Math.max(0, (Number(eff.onset_seconds) || 0) * route.onset);

  // Crossing the line is the only news that matters, but it still has to be
  // delivered — the overdose branch below returns early, and this is the sole
  // surface for it, so a dose that both hooks you AND overdoses you would
  // otherwise never tell you that you're now addicted.
  const addictedLine = justAddicted
    ? `\n<span class="addiction-warning">Something in you just changed. You'll want this again.</span>`
    : '';

  // Stamp what a bystander can see, before the overdose branch — someone who has
  // just taken far too much is the most obviously wrecked person in the room.
  const shows = appearanceNoteFor(drug);
  if (shows) {
    player._visibleDrug = {
      note: shows, illegal: !drug.flags?.legal, name: displayName,
      until: Date.now() + durationSeconds * 1000,
    };
  }

  // A death you couldn't see coming is a bug, not difficulty. When the mix is
  // what did it — this dose alone was survivable — say so, both on the way down
  // and while there's still time to stop.
  const mixKilled = crossBurden > 0 && (dosesInSystem / effOdThreshold) < CLASS_BURDEN_LIMIT;
  const mixLine = crossBurden > 0
    ? `\n<span class="overdose-warning">It is landing on top of something that pulls the same way.</span>`
    : '';

  // --- Overdose --------------------------------------------------------------
  if (overdosed) {
    // Cancel any active buff + trip for this drug.
    reverseMods(player, `drug:${stateKey}`);
    if (player.activeDrugs) player.activeDrugs = player.activeDrugs.filter(a => a.drugId !== stateKey);
    // ...and any dose of it still waiting to land. Without this, a non-lethal OD on
    // an onset drug still gets hit by the deferred instant it just cancelled.
    if (player.pendingOnsets) player.pendingOnsets = player.pendingOnsets.filter(o => o.stateKey !== stateKey);
    // `lethal` matters to subscribers: a survivable overdose should drop you
    // unconscious, but doing that to someone the very next line kills is pointless.
    fireHook('drug.overdose', { player, drug: drugForHooks, broadcast, lethal: !!eff.overdose?.lethal })
      .catch(e => console.error('[drugs] drug.overdose hook failed:', e.message));

    // Name the mix when the mix is what did it — dying to arithmetic you were
    // never shown is a bug, not difficulty.
    const cause = mixKilled
      ? `\n<span class="overdose-warning">On its own it would have been survivable. On top of what was already in you, it is not.</span>`
      : '';

    if (eff.overdose?.lethal) {
      const odMsg = eff.overdose.message || "You've taken too much. Everything stops.";
      return { success: true, overdose_death: true, message: `${message}${addictedLine}\n<span class="overdose-warning">⚠ ${odMsg}</span>${cause}` };
    }
    // Non-lethal overdose: burst of penalty (legacy behaviour + new overdose.mods).
    const odEffects = eff.overdose?.mods || drug.withdrawal_effects?.overdose || {}; // structured editor (effects.overdose.mods) is canonical; withdrawal_effects.overdose is legacy fallback
    // skipInstant still applies here: a laced carrier already granted its own
    // restores, so replaying the drug's instant block on top would make overdosing
    // on a drugged drink a way to FEED yourself.
    const odInstant = opts.skipInstant ? {} : scaleInstant(instantEff, effPotency);
    return applyEffects(player, { ...odInstant, ...odEffects, overdose: true }, `${message}${addictedLine}\n<span class="overdose-warning">⚠ You've taken too much, too fast. Your body revolts.</span>${cause}`, diuretic);
  }

  const substituteLine = substituting
    ? `\n<span class="withdrawal-warning">It is not what you are actually craving, but the shakes ease off anyway.</span>`
    : '';
  message += addictedLine + mixLine + substituteLine;

  // --- Instant block ---------------------------------------------------------
  // effPotency, not intensityMult: tolerance has to blunt the one-shot hit as well
  // as the phased buffs, or `tolerance.max_reduction` (authored on 24 of 29 drugs)
  // is dead weight for every instant-only drug — the 200th dose of ether would land
  // exactly as hard as the first.
  const scaledInstant = scaleInstant(instantEff, effPotency);
  let result;
  if (opts.skipInstant) {
    // A laced carrier (a drink/food that applies this drug via tags.laced_drug)
    // provides its OWN restores on the item, so skip the drug's instant resource
    // block — but still run its systemic effects: the meter (via the player.drugUsed
    // event already emitted above), overdose, phases, and hallucination.
    result = { success: true, message, effects: {}, player_update: {}, overdose: false };
    if (eff.hallucination) {
      fireHook('drug.used', { player, drug: drugForHooks, potency: effPotency, broadcast }).catch(e => console.error('[drugs] drug.used hook failed (no trip):', e.message));
    }
  } else if (onset > 0) {
    // Defer the hit: the instant block + hallucination land after `onset` seconds
    // via tickOnsets. Nothing changes on the player yet, so player_update is empty.
    result = { success: true, message, effects: scaledInstant, player_update: {}, overdose: false };
    player.pendingOnsets = player.pendingOnsets || [];
    player.pendingOnsets.push({
      stateKey,                        // so an overdose can purge this drug's un-landed hits
      landAt: Date.now() + onset * 1000,
      deltas: scaledInstant,
      diuretic,
      halluc: eff.hallucination ? { potency: effPotency } : null,
      drug: drugForHooks,
      broadcast,
      landMessage: eff.onset_message || null,
    });
    if (eff.comeon_message) result.message += `\n${eff.comeon_message}`;
  } else {
    result = applyEffects(player, scaledInstant, message, diuretic);
    if (eff.hallucination) {
      fireHook('drug.used', { player, drug: drugForHooks, potency: effPotency, broadcast }).catch(e => console.error('[drugs] drug.used hook failed (no trip):', e.message));
    }
  }
  if (potencyMult >= 1.25) result.message += `\n<span class="msg-system">This batch is strong. It hits harder than it should.</span>`;

  // --- Phased effects --------------------------------------------------------
  if (phases) {
    startPhasedDrug(player, drugForHooks, phases, effPotency, stateKey);
    // Timed-consumption callers (the consume plugin) narrate the whole physical
    // act themselves and suppress the come-up line, which would otherwise read as
    // "you light up" AFTER a 15-second smoke has already finished.
    if (phases.comeup_message && !opts.suppressComeupMessage) result.message += `\n${phases.comeup_message}`;
  }

  return result;
}

// Called once per second from the game loop, alongside tickDrugs. Lands any
// deferred (onset_seconds) instant hits whose timer has elapsed: applies the
// stat block, fires the held-back hallucination hook, pushes the resource change
// to the client, and returns the land message (if any) for broadcast.
export function tickOnsets(player) {
  const messages = [];
  if (!player.pendingOnsets?.length) return messages;
  const now = Date.now();
  player.pendingOnsets = player.pendingOnsets.filter(o => {
    if (now < o.landAt) return true;
    const r = applyEffects(player, o.deltas, '', o.diuretic);
    if (Object.keys(r.player_update).length) sendToPlayer(player.id, { type: 'player_update', ...r.player_update });
    if (o.halluc) fireHook('drug.used', { player, drug: o.drug, potency: o.halluc.potency, broadcast: o.broadcast }).catch(e => console.error('[drugs] delayed drug.used hook failed (no trip):', e.message));
    if (o.landMessage) messages.push(o.landMessage);
    return false;
  });
  return messages;
}

// A diuretic factor of `d` pulls (d-1) worth of these into the bladder / out of
// hydration per dose, on top of anything drunk. Antidiuretics (d<1) run negative:
// bladder eases, thirst is retained.
const DIURETIC_PRESSURE = 10;    // hydration_load added per +1.0 of diuretic factor
const DIURETIC_DEHYDRATION = 5;  // thirst removed per +1.0 of diuretic factor

function applyEffects(player, effects, message, diuretic = 1) {
  const statUpdates = {};
  if (effects.hp) statUpdates.hp = Math.max(0, Math.min(player.hp_max, player.hp + effects.hp));
  if (effects.sanity) statUpdates.sanity = Math.max(0, Math.min(player.sanity_max, player.sanity + effects.sanity));
  if (effects.hunger) {
    statUpdates.hunger = Math.max(0, Math.min(100, player.hunger + effects.hunger));
    if (effects.hunger > 0) statUpdates.digestive_load = Math.min(120, (player.digestive_load || 0) + foodLoad(effects.hunger));
  }
  if (effects.thirst) {
    statUpdates.thirst = Math.max(0, Math.min(100, player.thirst + effects.thirst));
    if (effects.thirst > 0) statUpdates.hydration_load = Math.min(120, (player.hydration_load || 0) + drinkLoad(effects.thirst));
  }
  // Diuretic water shift — independent of whether the dose carried any fluid, so
  // it bites on stims/pills as well as drinks. pull>0 fills the bladder and
  // dehydrates; pull<0 (antidiuretic) does the reverse.
  if (diuretic !== 1) {
    const pull = diuretic - 1;
    const hl0 = statUpdates.hydration_load ?? (player.hydration_load || 0);
    statUpdates.hydration_load = Math.max(0, Math.min(120, hl0 + pull * DIURETIC_PRESSURE));
    const th0 = statUpdates.thirst ?? player.thirst;
    statUpdates.thirst = Math.max(0, Math.min(100, th0 - Math.round(pull * DIURETIC_DEHYDRATION)));
  }
  if (effects.radiation) statUpdates.radiation = Math.max(0, Math.min(100, (player.radiation||0) + effects.radiation));
  if (effects.horniness_increase) {
    statUpdates.horniness = Math.min(120, (player.horniness || 0) + effects.horniness_increase);
  }

  for (const [k, v] of Object.entries(statUpdates)) player[k] = v;

  const statFields = Object.keys(statUpdates);
  if (statFields.length) {
    const sets = statFields.map((f, i) => `${f}=$${i + 1}`).join(',');
    const vals = statFields.map(f => statUpdates[f]);
    vals.push(player.id);
    query(`UPDATE players SET ${sets} WHERE id=$${vals.length}`, vals).catch(e => console.error('[drugs] failed to persist dose effects for', player.id, e.message));
  }

  return { success: true, message, effects, player_update: statUpdates, overdose: !!effects.overdose };
}

// --- Phased effect engine ----------------------------------------------------

// Register a phased drug on the player and apply its come-up buffs immediately.
// Re-dosing the same drug restarts its curve (only one buff-set per drug).
// `stateKey` is the ledger identity (see useDrug) — the drug id for normal drugs,
// but per-recipe for spliced compounds, which all share one carrier drug row and
// would otherwise cancel each other's buffs.
function startPhasedDrug(player, drug, phases, potency, stateKey) {
  player.activeDrugs = player.activeDrugs || [];
  player.activeDrugs = player.activeDrugs.filter(a => a.drugId !== stateKey);

  const entry = {
    drugId: stateKey, name: drug.name, startedAt: Date.now(), phase: 'comeup',
    comeupMs: (phases.comeup_seconds || 0) * 1000,
    peakMs: (phases.peak_seconds || 0) * 1000,
    comedownMs: (phases.comedown_seconds || 0) * 1000,
    potency,
    peak_mods: phases.peak_mods || {},
    comeup_scale: phases.comeup_scale ?? 1,
    comedown_scale: phases.comedown_scale ?? 1,
    messages: { peak: phases.peak_message, comedown: phases.comedown_message, end: phases.end_message },
    tickAcc: {},
  };
  applyMods(player, `drug:${stateKey}`, scaleMods(buffModsOf(entry.peak_mods), entry.comeup_scale * potency));
  player.activeDrugs.push(entry);
}

// Called once per second from the game loop. Advances each active drug through
// its phases, applies drip regen, reverses buffs cleanly on expiry. Returns
// message strings for broadcast.
export function tickDrugs(player) {
  const messages = [];
  if (!player.activeDrugs?.length) return messages;
  const now = Date.now();

  player.activeDrugs = player.activeDrugs.filter(entry => {
    const elapsed = now - entry.startedAt;
    const total = entry.comeupMs + entry.peakMs + entry.comedownMs;
    const source = `drug:${entry.drugId}`;

    if (elapsed >= total) {
      reverseMods(player, source);
      if (entry.messages.end) messages.push(entry.messages.end);
      // You rode it all the way out, so you now know how long it holds you.
      // Someone who tops up before the end never finds out.
      learnDrugFact(player.id, entry.drugId, DRUG_FACTS.DURATION);
      return false;
    }

    let phase, scale;
    if (elapsed < entry.comeupMs) { phase = 'comeup'; scale = entry.comeup_scale; }
    else if (elapsed < entry.comeupMs + entry.peakMs) { phase = 'peak'; scale = 1; }
    else { phase = 'comedown'; scale = entry.comedown_scale; }

    if (phase !== entry.phase) {
      entry.phase = phase;
      applyMods(player, source, scaleMods(buffModsOf(entry.peak_mods), scale * entry.potency));
      const m = phase === 'peak' ? entry.messages.peak : phase === 'comedown' ? entry.messages.comedown : null;
      if (m) messages.push(m);
      // A full peak is where the compound actually shows you what it does — the
      // come-up is scaled down and the comedown is it leaving. Reach the peak and
      // the stat effects stop being a mystery.
      if (phase === 'peak') learnDrugFact(player.id, entry.drugId, DRUG_FACTS.EFFECTS);
    }

    // Drip regen (sanity_regen_per_sec, hp_regen_per_sec, ...).
    const drip = dripModsOf(entry.peak_mods);
    for (const k in drip) {
      const base = k.replace(REGEN_RE, '');
      entry.tickAcc[k] = (entry.tickAcc[k] || 0) + drip[k] * scale * entry.potency;
      const whole = Math.trunc(entry.tickAcc[k]);
      if (whole !== 0) {
        entry.tickAcc[k] -= whole;
        const capKey = base + '_max';
        const maxVal = typeof player[capKey] === 'number' ? player[capKey] : (base === 'radiation' ? 100 : undefined);
        let nv = (player[base] || 0) + whole;
        nv = Math.max(0, maxVal !== undefined ? Math.min(maxVal, nv) : nv);
        player[base] = nv;
      }
    }
    return true;
  });

  // UPPERS AND THE FATIGUE CLOCK. See condition.js for the shape: while wired the
  // clock runs backwards at STIM_FATIGUE_RELIEF, every millisecond of that is
  // banked, and the bank is emptied with interest the moment nothing is holding
  // you up any more. The filter above has already dropped expired entries, so
  // isWired here reads the state the player is in AFTER this tick resolved.
  //
  // In memory only, deliberately: a bender doesn't survive a logout because
  // logging out sleeps you (server/index.js), which would have cleared the debt
  // anyway. One rule, not two.
  // This is the ONE-SECOND loop, so the relief is measured off elapsed real time
  // rather than assumed per call — clamped so a stalled or resumed loop can't
  // hand a player an hour of free wakefulness in a single tick.
  const lastAt = player._stimClockAt || now;
  player._stimClockAt = now;
  const dt = Math.max(0, Math.min(5000, now - lastAt));

  const wiredAt = stimulantPotency(player);
  if (wiredAt > 0) {
    const before = Number(player.last_slept_at) || now;
    player.last_slept_at = Math.min(now, before + dt * STIM_FATIGUE_RELIEF * wiredAt);
    player._fatigueDebtMs = (player._fatigueDebtMs || 0) + (player.last_slept_at - before);
  } else if (player._fatigueDebtMs > 0) {
    // The crash. Everything the drug held off, plus what it cost to hold it off.
    player.last_slept_at = (Number(player.last_slept_at) || now) - player._fatigueDebtMs * STIM_FATIGUE_INTEREST;
    player._fatigueDebtMs = 0;
    messages.push('<span class="msg-system">Whatever was holding you upright lets go, and the whole night arrives at once.</span>');
  }

  return messages;
}

// --- Withdrawal (minute cadence) --------------------------------------------

// Bleed (or restore) a `*_regen_per_sec` withdrawal rate over one minute-tick.
// Clamped to the stat's own cap and floored at 0 — withdrawal grinds you down, it
// never kills outright; starvation and the drugs themselves do that.
const WITHDRAWAL_TICK_SECONDS = 60;
function applyWithdrawalDrip(player, drip, severity) {
  for (const k in drip) {
    const base = k.replace(REGEN_RE, '');
    const delta = Math.round(drip[k] * severity * WITHDRAWAL_TICK_SECONDS);
    if (!delta) continue;
    const capKey = base + '_max';
    const cap = typeof player[capKey] === 'number' ? player[capKey] : (base === 'radiation' ? 100 : undefined);
    let v = (player[base] || 0) + delta;
    v = Math.max(0, cap !== undefined ? Math.min(cap, v) : v);
    player[base] = v;
  }
}

// Apply / clear withdrawal debuffs for ONE player, given their already-fetched
// drug-state rows. Withdrawal bites once elapsed-since-last-use exceeds
// onset_seconds; re-dosing (in useDrug) reverses it. Addiction itself decays over
// time so sobriety is reachable without re-dosing. Pure in-memory apart from the
// addiction-decay writes, which it appends to `writes` for the caller to batch.
// Returns message strings for broadcast.
function applyWithdrawal(player, states, now, writes, allRows = states) {
  const messages = [];
  // drugId -> the mod block currently applied, so a severity that hasn't moved
  // doesn't churn the ledger through a reverse-and-reapply every single minute.
  if (!player._withdrawalActive) player._withdrawalActive = new Map();

  for (const state of states) {
    // Normal drugs resolve from the cache; spliced compounds have no drugs row, so
    // they fall back to the composed blob stashed on the state row at use time.
    // Without that fallback a compound could latch is_addicted forever with no
    // debuff and no message — an invisible, unclearable flag.
    const eff = DRUG_CACHE[state.drug_id]?.effects || state.effects;
    if (!eff) continue;
    const wd = eff.withdrawal || {};
    const onset = wd.onset_seconds ?? 3600;
    const addRec = wd.addiction_recovery_per_sec ?? ADDICTION_RECOVERY_PER_SEC;
    const elapsed = Math.max(0, now - (state.last_used_at || now));
    const source = `withdrawal:${state.drug_id}`;

    // Decay addiction over time; persist so sobriety sticks. Per-minute decay,
    // scaled by the game-speed knob so it tracks the sped-up day.
    const newAddiction = Math.max(0, (state.addiction || 0) - addRec * 60 * getTimeScale());
    // Hysteresis: an already-dependent player holds on down to the lower release
    // mark, so recovery has to be earned well past the line that hooked them.
    const stillAddicted = newAddiction >= (state.is_addicted ? ADDICT_RELEASE : ADDICT_LATCH);
    if (newAddiction !== state.addiction || (!stillAddicted && state.is_addicted)) {
      writes.playerIds.push(player.id);
      writes.drugIds.push(state.drug_id);
      writes.addiction.push(newAddiction);
      writes.addicted.push(stillAddicted ? 1 : 0);
    }

    if (stillAddicted && elapsed > onset && wd.mods) {
      // Withdrawal ramps in, peaks, then tapers to a floor — a shape you can feel
      // rather than a flat debuff that snaps on the moment the clock passes onset.
      // Then two things bend that curve:
      //   depth  — how deep the habit got, not just how long it has been. A casual
      //            user at the latch and a 0.95 addict used to suffer identically.
      //   relief — a same-class drug taken recently is holding some of it off.
      const drugClass = DRUG_CACHE[state.drug_id]?.flags?.drug_class;
      const depth = WD_DEPTH_FLOOR + (1 - WD_DEPTH_FLOOR)
        * Math.min(1, Math.max(0, (newAddiction - ADDICT_RELEASE) / (1 - ADDICT_RELEASE)));
      const relief = substitutionRelief(allRows, state.drug_id, drugClass, now);
      const severity = withdrawalSeverity(elapsed - onset, wd) * depth * relief;
      const scaled = scaleMods(buffModsOf(wd.mods), severity);
      const sig = JSON.stringify(scaled);
      if (player._withdrawalActive.get(state.drug_id) !== sig) {
        applyMods(player, source, scaled);
        const first = !player._withdrawalActive.has(state.drug_id);
        player._withdrawalActive.set(state.drug_id, sig);
        if (first && wd.message) messages.push(`<span class="withdrawal-warning">${wd.message}</span>`);
        // Withdrawal has actually started biting — mods applied, not merely a
        // clock passing onset. You now know what coming off this costs, and
        // that is knowledge nobody could have handed you.
        if (first) learnDrugFact(player.id, state.drug_id, DRUG_FACTS.WITHDRAWAL);
      }
      // `*_regen_per_sec` keys are a per-second drip, not a ledger buff. The phases
      // engine has always honoured them; withdrawal silently dropped them into
      // applyMods, which wrote a nonexistent `sanity_regen_per_sec` field nobody
      // reads — so an authored withdrawal bleed did nothing at all. This tick is
      // per-minute, so a per-second rate is worth 60 of itself.
      applyWithdrawalDrip(player, dripModsOf(wd.mods), severity);
    } else if (player._withdrawalActive.has(state.drug_id)) {
      reverseMods(player, source);
      player._withdrawalActive.delete(state.drug_id);
    }
  }

  return messages;
}

// Run withdrawal for every live player on ONE read and ONE write, instead of a
// query per player per minute. This rides the shared minute tick and Postgres is
// remote in prod, so the cost is round-trip COUNT, not query weight — a loop of
// per-player calls is N sequential round trips for the same work. Returns
// Map<playerId, messages[]>; players with nothing to say are absent.
export async function tickWithdrawalAll(players) {
  const out = new Map();
  if (!players?.length) return out;
  const now = Math.floor(Date.now() / 1000);

  // ALL rows, not just the addicted ones: substitution relief has to see a cousin
  // drug the player took and isn't hooked on. Same single round trip either way.
  const { rows } = await query(
    'SELECT * FROM player_drug_state WHERE player_id = ANY($1)',
    [players.map(p => p.id)]
  );
  if (!rows.length) return out;

  const byPlayer = new Map();
  for (const r of rows) {
    if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, []);
    byPlayer.get(r.player_id).push(r);
  }

  const writes = { playerIds: [], drugIds: [], addiction: [], addicted: [] };
  for (const player of players) {
    const allRows = byPlayer.get(player.id);
    if (!allRows) continue;
    // The addiction filter that used to live in the WHERE clause.
    const states = allRows.filter(r => (r.addiction || 0) >= ADDICT_LATCH || r.is_addicted);
    if (!states.length) continue;
    const messages = applyWithdrawal(player, states, now, writes, allRows);
    if (messages.length) out.set(player.id, messages);
  }

  // Coalesce every player's addiction-decay row into a single UPDATE.
  if (writes.playerIds.length) {
    query(
      `UPDATE player_drug_state AS s
          SET addiction = v.addiction, is_addicted = v.is_addicted
         FROM (SELECT * FROM unnest($1::text[], $2::text[], $3::real[], $4::int[])
                 AS t(player_id, drug_id, addiction, is_addicted)) v
        WHERE s.player_id = v.player_id AND s.drug_id = v.drug_id`,
      [writes.playerIds, writes.drugIds, writes.addiction, writes.addicted]
    ).catch(e => console.error('[drugs] batched addiction-decay write failed for', writes.playerIds.length, 'rows:', e.message));
  }

  return out;
}

// Clear doses on a half-life rather than a flat -1/min: the body sheds a fraction
// of whatever is still in it, so a heavy load drops away fast and the last trace
// lingers. CEIL keeps it terminating on an integer column (a load of 1 always
// clears) instead of asymptotically stalling above zero.
//
// Batched across the whole player set on purpose: this runs on the shared minute
// tick, and Postgres is remote in prod, so latency lives in round-trip COUNT. One
// statement for everyone costs the same as one for a single player — per-player
// calls in a loop cost N sequential round trips. See the read tiers in
// docs/architecture.md.
export async function tickDrugDecayAll(playerIds) {
  if (!playerIds?.length) return;
  const now = Math.floor(Date.now() / 1000);
  await query(
    `UPDATE player_drug_state
        SET doses_in_system = GREATEST(0, doses_in_system - CEIL(doses_in_system * $3::numeric)::int)
      WHERE player_id = ANY($1) AND active_until < $2 AND doses_in_system > 0`,
    [playerIds, now, DOSE_CLEARANCE_FRACTION]
  );
}

// Pure-law surface for the regression harness (the `_test` convention used by
// plugins/consume). Exported for assertions only — nothing in the game reads this.
export const _test = {
  resolveRoute, withdrawalSeverity, scaleMods, classBurden, CLASS_BURDEN_LIMIT,
  crossTolerance, substitutionRelief, CROSS_TOLERANCE, SUBSTITUTION_FLOOR, WD_DEPTH_FLOOR,
  ROUTES, ADDICT_LATCH, ADDICT_RELEASE, OD_TOLERANCE_BONUS, DOSE_CLEARANCE_FRACTION,
  TOLERANCE_RECOVERY_PER_SEC, ADDICTION_RECOVERY_PER_SEC,
  decayTolerances, LETHAL_TOLERANCE_GAIN_RATIO, LETHAL_TOLERANCE_RECOVERY_RATIO,
  odCeiling: (base, tolerance) => Math.max(1, Math.round(base * (1 + tolerance * OD_TOLERANCE_BONUS))),
  clearanceStep: (doses) => Math.max(0, doses - Math.ceil(doses * DOSE_CLEARANCE_FRACTION)),
};

// Everything the player has a history with, with the derived numbers already
// worked out — decayed tolerance/addiction, whether dependency currently holds,
// how hard withdrawal is biting, and where the overdose ceiling now sits.
//
// This lives here, not in the plugin, because every value is produced by the SAME
// constants and curve functions the ticks use. A verb that recomputed the decay
// or the severity arc itself would be a second source of truth for the laws, and
// would drift the first time one was tuned. Callers format; they never compute.
// One query, player-invoked — not a hot path.
export async function getDrugStatus(player) {
  const now = Math.floor(Date.now() / 1000);
  const { rows } = await query(
    'SELECT * FROM player_drug_state WHERE player_id=$1 AND times_used > 0 ORDER BY last_used_at DESC NULLS LAST',
    [player.id]
  );

  return rows.map(s => {
    const drug = DRUG_CACHE[s.drug_id];
    const eff = drug?.effects || s.effects || {};   // compounds carry their blob on the row
    const wd = eff.withdrawal || {};
    const tol = eff.tolerance || {};
    const elapsed = Math.max(0, now - (s.last_used_at || now));

    // Same lazy decay useDrug and the withdrawal tick apply.
    const { felt: tolerance, lethal: toleranceLethal } = decayTolerances(s, tol, elapsed);
    const addiction = Math.max(0,
      (s.addiction || 0) - (wd.addiction_recovery_per_sec ?? ADDICTION_RECOVERY_PER_SEC) * elapsed * getTimeScale());
    const addicted = addiction >= (s.is_addicted ? ADDICT_RELEASE : ADDICT_LATCH);
    const onset = wd.onset_seconds ?? 3600;
    const biting = addicted && elapsed > onset && !!wd.mods;

    // What this player has EARNED the right to be told, and the facts themselves.
    // Gating happens here rather than in the client so an unlearned number never
    // leaves the server — a payload you could read in devtools is not a secret.
    const known = s.known_facts || 0;
    const phases = eff.phases || {};
    const learned = {
      mask: known,
      effects: (known & DRUG_FACTS.EFFECTS) ? (phases.peak_mods || {}) : null,
      durationSeconds: (known & DRUG_FACTS.DURATION) ? (drug?.duration_seconds ?? null) : null,
      overdoseCeiling: (known & DRUG_FACTS.OVERDOSE)
        ? Math.max(1, Math.round((drug?.overdose_threshold ?? 3) * (1 + toleranceLethal * OD_TOLERANCE_BONUS)))
        : null,
      addictive: (known & DRUG_FACTS.ADDICTION) ? true : null,
      withdrawal: (known & DRUG_FACTS.WITHDRAWAL) ? (wd.message || 'It takes something back.') : null,
    };

    return {
      drugId: s.drug_id,
      name: drug?.name || String(s.drug_id).replace(/^drug_/, '').replace(/:.*$/, ' compound'),
      learned,
      timesUsed: s.times_used,
      tolerance,
      addicted,
      sinceLastUse: elapsed,
      // 0 when not biting; otherwise the live point on the ramp→peak→taper arc,
      // bent by habit depth and by any same-class drug currently holding it off —
      // the identical arithmetic the tick uses, or the read-out would lie.
      withdrawalSeverity: biting
        ? withdrawalSeverity(elapsed - onset, wd)
          * (WD_DEPTH_FLOOR + (1 - WD_DEPTH_FLOOR)
             * Math.min(1, Math.max(0, (addiction - ADDICT_RELEASE) / (1 - ADDICT_RELEASE))))
          * substitutionRelief(rows, s.drug_id, drug?.flags?.drug_class, now)
        : 0,
      // Is a cousin drug currently taking the edge off?
      substituted: substitutionRelief(rows, s.drug_id, drug?.flags?.drug_class, now) < 1,
      // Seconds of grace left before it starts asking (0 if already biting or clean).
      withdrawalIn: addicted && !biting && wd.mods ? Math.max(0, onset - elapsed) : 0,
      dosesInSystem: s.doses_in_system || 0,
      odCeiling: Math.max(1, Math.round((drug?.overdose_threshold ?? 3) * (1 + toleranceLethal * OD_TOLERANCE_BONUS))),
      toleranceLethal,
      // THE MARGIN — how far the felt tolerance has outrun the lethal one. This is
      // the whole mechanic made legible, and it has to be, because a habit that
      // silently narrows the gap between "enough to feel it" and "enough to kill
      // me" is a trap rather than a system. 0 = the two are level (or the drug has
      // no lethal tolerance at all, like the psychedelics); climbing = you now need
      // more than your body has learned to survive.
      toleranceGap: Math.max(0, tolerance - toleranceLethal),
    };
  });
}

export async function getPlayerDrugState(playerId) {
  const { rows } = await query('SELECT * FROM player_drug_state WHERE player_id=$1', [playerId]);
  return rows;
}

// Wipe the player's ACTIVE drug state on death: reverse every timed drug/withdrawal
// buff (so the body resets to true base — no full-heal to a buffed cap, no free HP
// loss on comedown), drop phased drugs, and clear doses-in-system + active windows
// (so a respawn isn't left one dose from an instant re-overdose). Tolerance and
// addiction persist — they're long-term, not an active-body state that a fresh clone
// would shed. In-memory reversal is synchronous; the DB clear fires async.
export function clearActiveDrugState(player) {
  clearActiveDrugBuffs(player);
  query('UPDATE player_drug_state SET doses_in_system=0, active_until=0 WHERE player_id=$1', [player.id])
    .catch(err => console.error('[drugs] failed to clear doses on death for', player.id, err.message));
}

// Drop the MEMORY half of active drug state — ledger buffs, phased drugs and
// un-landed onsets — without touching the DB.
//
// This is the logout/session-replacement path. `activeDrugs` and `pendingOnsets`
// live only in memory while doses and tolerance are persisted, so a disconnect
// mid-dose otherwise leaves buffs applied to an object that is about to be saved.
// Deliberately does NOT clear doses_in_system: that would make logging out a free
// way to shed overdose risk. The dose still counts; only its unfinished effects go.
export function clearActiveDrugBuffs(player) {
  if (!player) return;
  for (const source of Object.keys(player._modLedger || {}))
    if (/^(drug|withdrawal):/.test(source)) reverseMods(player, source);
  player.activeDrugs = [];
  player.pendingOnsets = [];
  player._visibleDrug = null;      // a fresh clone doesn't wear the last one's pupils
  player._withdrawalActive?.clear?.();
  // Banked stimulant relief dies with the body/session too. tickDrugs returns
  // early when activeDrugs is empty, so a debt left behind here would sit unpaid
  // until the player's next dose and then land on them for a bender they don't
  // remember — the crash has to belong to the run that borrowed it.
  player._fatigueDebtMs = 0;
  player._stimClockAt = 0;
}
