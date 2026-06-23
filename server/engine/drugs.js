/**
 * Drug system — dev-panel editable substances with timed effects,
 * addiction risk, and overdose consequences. Mirrors the recipes
 * caching pattern: DB is source of truth, cached in memory at boot.
 */
import { query } from '../models/db.js';

let DRUG_CACHE = {};

export async function loadDrugs() {
  const { rows } = await query('SELECT * FROM drugs');
  const cache = {};
  for (const d of rows) cache[d.id] = d;
  DRUG_CACHE = cache;
  return cache;
}

export function getDrugCache() { return DRUG_CACHE; }

export async function useDrug(player, drugId) {
  const drug = DRUG_CACHE[drugId];
  if (!drug) return { success: false, message: 'Unknown substance.' };

  const { rows } = await query('SELECT * FROM player_drug_state WHERE player_id=$1 AND drug_id=$2', [player.id, drugId]);
  const state = rows[0];
  const now = Math.floor(Date.now() / 1000);
  const dosesInSystem = (state?.doses_in_system || 0) + 1;
  const timesUsed = (state?.times_used || 0) + 1;

  const overdosed = dosesInSystem >= (drug.overdose_threshold || 3);

  let justAddicted = false;
  let isAddicted = state?.is_addicted || false;
  if (!isAddicted && Math.random() < (drug.addiction_chance || 0)) {
    isAddicted = true;
    justAddicted = true;
  }

  await query(
    `INSERT INTO player_drug_state (player_id, drug_id, active_until, doses_in_system, times_used, is_addicted, last_used_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (player_id, drug_id) DO UPDATE SET active_until=$3, doses_in_system=$4, times_used=$5, is_addicted=$6, last_used_at=$7`,
    [player.id, drugId, now + (drug.duration_seconds || 300), dosesInSystem, timesUsed, isAddicted ? 1 : 0, now]
  );

  let message = `You take ${drug.name}. ${drug.description || ''}`.trim();
  const effects = drug.effects || {};

  if (overdosed) {
    const odEffects = drug.withdrawal_effects?.overdose || {};
    return applyEffects(player, { ...effects, ...odEffects, overdose: true }, `${message}\n<span class="overdose-warning">⚠ You've taken too much, too fast. Your body revolts.</span>`);
  }

  if (justAddicted) {
    message += `\n<span class="addiction-warning">Something in you just changed. You'll want this again.</span>`;
  }

  return applyEffects(player, effects, message);
}

function applyEffects(player, effects, message) {
  const statUpdates = {};
  if (effects.hp) statUpdates.hp = Math.max(0, Math.min(player.hp_max, player.hp + effects.hp));
  if (effects.sanity) statUpdates.sanity = Math.max(0, Math.min(player.sanity_max, player.sanity + effects.sanity));
  if (effects.hunger) statUpdates.hunger = Math.max(0, Math.min(100, player.hunger + effects.hunger));
  if (effects.thirst) statUpdates.thirst = Math.max(0, Math.min(100, player.thirst + effects.thirst));
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
