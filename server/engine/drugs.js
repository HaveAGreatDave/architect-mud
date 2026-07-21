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
 *   hallucination — { mode, intensity, palette, duration_seconds, events, dreamzone_id }
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
    const ceiling = Math.max(1, Math.round((other.overdose_threshold ?? 3) * (1 + (r.tolerance || 0) * OD_TOLERANCE_BONUS)));
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
  const recPerSec = tol.recovery_per_sec ?? (1 / 3600);
  let tolerance = Math.max(0, Math.min(1, (state?.tolerance || 0) - recPerSec * elapsed * getTimeScale()));
  const potency = Math.max(0, 1 - tolerance * (tol.max_reduction ?? 0.7));
  // Relapse law: the overdose ceiling rides on the tolerance carried into this dose
  // (pre-gain, post-decay), so the same habit dose that was routine at peak tolerance
  // becomes lethal once time clean has burned that tolerance off.
  const effOdThreshold = Math.max(1, Math.round(odThreshold * (1 + tolerance * OD_TOLERANCE_BONUS)));
  tolerance = Math.min(1, tolerance + (tol.gain_per_dose ?? 0));

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
  const addRec = wd.addiction_recovery_per_sec ?? (1 / 86400);
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
    `INSERT INTO player_drug_state (player_id, drug_id, active_until, doses_in_system, times_used, is_addicted, last_used_at, tolerance, addiction, effects)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (player_id, drug_id) DO UPDATE SET active_until=$3, doses_in_system=$4, times_used=$5, is_addicted=$6, last_used_at=$7, tolerance=$8, addiction=$9, effects=$10`,
    [player.id, stateKey, now + durationSeconds, dosesInSystem, timesUsed, isAddicted ? 1 : 0, now, tolerance, addiction,
     opts.inlineEffects ? JSON.stringify(eff) : null]
  );

  // Re-dosing clears any active withdrawal for this drug.
  reverseMods(player, `withdrawal:${stateKey}`);
  player._withdrawalActive?.delete(stateKey);

  // Consumption happened — flag it for the crime/wanted system. Legal drugs
  // (coffee, beer: drug.flags.legal) draw no police attention; controlled
  // substances do, but only if a camera actually catches it (raiseCrime gates).
  emit('player.drugUsed', { player, drug, potency: effPotency, illegal: !drug.flags?.legal, zoneId: player.current_zone });

  // `opts.takeLine` lets a caller supply the consumption sentence (e.g. the
  // consume plugin's substance-appropriate "You drain the last of the beer…"),
  // replacing the generic "You take X." + description. Drinks/smokes read better
  // as an act than as a flat "take".
  let message = opts.takeLine != null
    ? opts.takeLine
    : `You take ${displayName}. ${(opts.inlineEffects ? '' : drug.description) || ''}`.trim();

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
    fireHook('drug.overdose', { player, drug: drugForHooks, broadcast }).catch(e => console.error('[drugs] drug.overdose hook failed:', e.message));

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

  message += addictedLine + mixLine;

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
function applyWithdrawal(player, states, now, writes) {
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
    const addRec = wd.addiction_recovery_per_sec ?? (1 / 86400);
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
      const severity = withdrawalSeverity(elapsed - onset, wd);
      const scaled = scaleMods(buffModsOf(wd.mods), severity);
      const sig = JSON.stringify(scaled);
      if (player._withdrawalActive.get(state.drug_id) !== sig) {
        applyMods(player, source, scaled);
        const first = !player._withdrawalActive.has(state.drug_id);
        player._withdrawalActive.set(state.drug_id, sig);
        if (first && wd.message) messages.push(`<span class="withdrawal-warning">${wd.message}</span>`);
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

  const { rows } = await query(
    'SELECT * FROM player_drug_state WHERE player_id = ANY($1) AND (addiction >= $2 OR is_addicted = 1)',
    [players.map(p => p.id), ADDICT_LATCH]
  );
  if (!rows.length) return out;

  const byPlayer = new Map();
  for (const r of rows) {
    if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, []);
    byPlayer.get(r.player_id).push(r);
  }

  const writes = { playerIds: [], drugIds: [], addiction: [], addicted: [] };
  for (const player of players) {
    const states = byPlayer.get(player.id);
    if (!states) continue;
    const messages = applyWithdrawal(player, states, now, writes);
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
  ROUTES, ADDICT_LATCH, ADDICT_RELEASE, OD_TOLERANCE_BONUS, DOSE_CLEARANCE_FRACTION,
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
    const tolerance = Math.max(0, Math.min(1,
      (s.tolerance || 0) - (tol.recovery_per_sec ?? (1 / 3600)) * elapsed * getTimeScale()));
    const addiction = Math.max(0,
      (s.addiction || 0) - (wd.addiction_recovery_per_sec ?? (1 / 86400)) * elapsed * getTimeScale());
    const addicted = addiction >= (s.is_addicted ? ADDICT_RELEASE : ADDICT_LATCH);
    const onset = wd.onset_seconds ?? 3600;
    const biting = addicted && elapsed > onset && !!wd.mods;

    return {
      drugId: s.drug_id,
      name: drug?.name || String(s.drug_id).replace(/^drug_/, '').replace(/:.*$/, ' compound'),
      timesUsed: s.times_used,
      tolerance,
      addicted,
      sinceLastUse: elapsed,
      // 0 when not biting; otherwise the live point on the ramp→peak→taper arc.
      withdrawalSeverity: biting ? withdrawalSeverity(elapsed - onset, wd) : 0,
      // Seconds of grace left before it starts asking (0 if already biting or clean).
      withdrawalIn: addicted && !biting && wd.mods ? Math.max(0, onset - elapsed) : 0,
      dosesInSystem: s.doses_in_system || 0,
      odCeiling: Math.max(1, Math.round((drug?.overdose_threshold ?? 3) * (1 + tolerance * OD_TOLERANCE_BONUS))),
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
  player._withdrawalActive?.clear?.();
}
