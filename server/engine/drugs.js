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

let DRUG_CACHE = {};

// peak_mods keys ending in this are per-second "drip" regen, not flat buffs.
const REGEN_RE = /_regen_per_sec$/;

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
  const potencyMult = Math.max(0.1, Number(opts.potencyMult) || 1);

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
  const phases = eff.phases;
  const tol = eff.tolerance || {};
  const wd = eff.withdrawal || {};
  // Effects object exposed to hallucination hooks (so the trip plugin reads the
  // composed hallucination, not the empty carrier's).
  const drugForHooks = opts.inlineEffects ? { ...drug, effects: eff, name: displayName } : drug;

  const now = Math.floor(Date.now() / 1000);
  const { rows } = await query('SELECT * FROM player_drug_state WHERE player_id=$1 AND drug_id=$2', [player.id, drugId]);
  const state = rows[0];
  const lastUsed = state?.last_used_at || now;
  const elapsed = Math.max(0, now - lastUsed);

  // Tolerance: lazy recovery since last use, then gain this dose.
  // Potency is locked to tolerance BEFORE this dose's gain is added.
  const recPerSec = tol.recovery_per_sec ?? (1 / 3600);
  let tolerance = Math.max(0, Math.min(1, (state?.tolerance || 0) - recPerSec * elapsed));
  const potency = Math.max(0, 1 - tolerance * (tol.max_reduction ?? 0.7));
  tolerance = Math.min(1, tolerance + (tol.gain_per_dose ?? 0));

  // A stronger (synthesized) dose counts for more in the system — higher potency
  // means fewer doses to overdose.
  const doseInc = Math.max(1, Math.round(potencyMult), extraDoseWeight);
  // Combined potency drives phased-buff magnitude and hallucination intensity.
  const effPotency = potency * potencyMult;

  const dosesInSystem = (state?.doses_in_system || 0) + doseInc;
  const timesUsed = (state?.times_used || 0) + 1;
  const overdosed = dosesInSystem >= odThreshold;

  // Addiction: lazy decay since last use, then accumulate this dose.
  const addRec = wd.addiction_recovery_per_sec ?? (1 / 86400);
  let addiction = Math.max(0, (state?.addiction || 0) - addRec * elapsed);
  addiction = Math.min(1, addiction + (wd.addiction_per_dose ?? drug.addiction_chance ?? 0));
  let justAddicted = false;
  let isAddicted = state?.is_addicted ? true : false;
  if (!isAddicted && addiction >= 0.5) { isAddicted = true; justAddicted = true; }

  await query(
    `INSERT INTO player_drug_state (player_id, drug_id, active_until, doses_in_system, times_used, is_addicted, last_used_at, tolerance, addiction)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (player_id, drug_id) DO UPDATE SET active_until=$3, doses_in_system=$4, times_used=$5, is_addicted=$6, last_used_at=$7, tolerance=$8, addiction=$9`,
    [player.id, drugId, now + durationSeconds, dosesInSystem, timesUsed, isAddicted ? 1 : 0, now, tolerance, addiction]
  );

  // Re-dosing clears any active withdrawal for this drug.
  reverseMods(player, `withdrawal:${drugId}`);
  player._withdrawalActive?.delete(drugId);

  // Consumption happened — flag it for the crime/wanted system. Legal drugs
  // (coffee, beer: drug.flags.legal) draw no police attention; controlled
  // substances do, but only if a camera actually catches it (raiseCrime gates).
  emit('player.drugUsed', { player, drug, potency: effPotency, illegal: !drug.flags?.legal, zoneId: player.current_zone });

  let message = `You take ${displayName}. ${(opts.inlineEffects ? '' : drug.description) || ''}`.trim();

  // Diuretic factor (effects.diuretic): how the substance shifts water balance.
  // 1 = neutral (water). >1 diuretic (beer, coffee, stims) — pulls water into the
  // bladder and dehydrates. <1 antidiuretic (opioids) — retention. Applied in
  // applyEffects. Structured & flat effects both keep it at the effects top level.
  const dv = Number(eff.diuretic);
  const diuretic = dv > 0 ? dv : 1;

  // --- Overdose --------------------------------------------------------------
  if (overdosed) {
    // Cancel any active buff + trip for this drug.
    reverseMods(player, `drug:${drugId}`);
    if (player.activeDrugs) player.activeDrugs = player.activeDrugs.filter(a => a.drugId !== drugId);
    fireHook('drug.overdose', { player, drug: drugForHooks, broadcast }).catch(() => {});

    if (eff.overdose?.lethal) {
      const odMsg = eff.overdose.message || "You've taken too much. Everything stops.";
      return { success: true, overdose_death: true, message: `${message}\n<span class="overdose-warning">⚠ ${odMsg}</span>` };
    }
    // Non-lethal overdose: burst of penalty (legacy behaviour + new overdose.mods).
    const odEffects = drug.withdrawal_effects?.overdose || eff.overdose?.mods || {};
    return applyEffects(player, { ...scaleInstant(instant, potencyMult), ...odEffects, overdose: true }, `${message}\n<span class="overdose-warning">⚠ You've taken too much, too fast. Your body revolts.</span>`, diuretic);
  }

  if (justAddicted) {
    message += `\n<span class="addiction-warning">Something in you just changed. You'll want this again.</span>`;
  }

  // --- Instant block (existing path) -----------------------------------------
  const result = applyEffects(player, scaleInstant(instant, potencyMult), message, diuretic);
  if (potencyMult >= 1.25) result.message += `\n<span class="msg-system">This batch is strong. It hits harder than it should.</span>`;

  // --- Phased effects --------------------------------------------------------
  if (phases) {
    startPhasedDrug(player, drugForHooks, phases, effPotency);
    if (phases.comeup_message) result.message += `\n${phases.comeup_message}`;
  }

  // --- Hallucination ---------------------------------------------------------
  if (eff.hallucination) {
    fireHook('drug.used', { player, drug: drugForHooks, potency: effPotency, broadcast }).catch(() => {});
  }

  return result;
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
    query(`UPDATE players SET ${sets} WHERE id=$${vals.length}`, vals).catch(() => {});
  }

  return { success: true, message, effects, player_update: statUpdates, overdose: !!effects.overdose };
}

// --- Phased effect engine ----------------------------------------------------

// Register a phased drug on the player and apply its come-up buffs immediately.
// Re-dosing the same drug restarts its curve (only one buff-set per drug).
function startPhasedDrug(player, drug, phases, potency) {
  player.activeDrugs = player.activeDrugs || [];
  player.activeDrugs = player.activeDrugs.filter(a => a.drugId !== drug.id);

  const entry = {
    drugId: drug.id, name: drug.name, startedAt: Date.now(), phase: 'comeup',
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
  applyMods(player, `drug:${drug.id}`, scaleMods(buffModsOf(entry.peak_mods), entry.comeup_scale * potency));
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

// Apply / clear withdrawal debuffs for a player's addicted drugs. Withdrawal
// bites once elapsed-since-last-use exceeds onset_seconds; re-dosing (in
// useDrug) reverses it. Addiction itself decays over time so sobriety is
// reachable without re-dosing. Returns message strings for broadcast.
export async function tickWithdrawal(player) {
  const messages = [];
  const now = Math.floor(Date.now() / 1000);
  const { rows } = await query(
    'SELECT * FROM player_drug_state WHERE player_id=$1 AND (addiction >= 0.5 OR is_addicted = 1)',
    [player.id]
  );
  if (!rows.length) return messages;
  if (!player._withdrawalActive) player._withdrawalActive = new Set();

  for (const state of rows) {
    const drug = DRUG_CACHE[state.drug_id];
    if (!drug) continue;
    const wd = drug.effects?.withdrawal || {};
    const onset = wd.onset_seconds ?? 3600;
    const addRec = wd.addiction_recovery_per_sec ?? (1 / 86400);
    const elapsed = Math.max(0, now - (state.last_used_at || now));
    const source = `withdrawal:${state.drug_id}`;

    // Decay addiction over time; persist so sobriety sticks.
    const newAddiction = Math.max(0, (state.addiction || 0) - addRec * 60);
    const stillAddicted = newAddiction >= 0.5;
    if (newAddiction !== state.addiction || (!stillAddicted && state.is_addicted)) {
      query('UPDATE player_drug_state SET addiction=$1, is_addicted=$2 WHERE player_id=$3 AND drug_id=$4',
        [newAddiction, stillAddicted ? 1 : 0, player.id, state.drug_id]).catch(() => {});
    }

    if (stillAddicted && elapsed > onset && wd.mods) {
      applyMods(player, source, wd.mods);
      if (!player._withdrawalActive.has(state.drug_id)) {
        player._withdrawalActive.add(state.drug_id);
        if (wd.message) messages.push(`<span class="withdrawal-warning">${wd.message}</span>`);
      }
    } else if (player._withdrawalActive.has(state.drug_id)) {
      reverseMods(player, source);
      player._withdrawalActive.delete(state.drug_id);
    }
  }

  return messages;
}

export async function tickDrugDecay(playerId) {
  const now = Math.floor(Date.now() / 1000);
  await query(
    `UPDATE player_drug_state SET doses_in_system = GREATEST(0, doses_in_system - 1)
     WHERE player_id=$1 AND active_until < $2 AND doses_in_system > 0`,
    [playerId, now]
  );
}

export async function getPlayerDrugState(playerId) {
  const { rows } = await query('SELECT * FROM player_drug_state WHERE player_id=$1', [playerId]);
  return rows;
}
