/**
 * Mutation system — HellMOO-style. Triggered by sustained radiation exposure.
 * Mutations are permanent and dev-panel editable, cached in memory like
 * recipes/drugs. Polarity can be positive, negative, or mixed — staying
 * unmutated has its own benefit: visibly mutated players are treated as
 * outcasts in Custodian-aligned zones (hostility text, then turrets).
 */
import { query } from '../models/db.js';

let MUTATION_CACHE = {};

export async function loadMutations() {
  const { rows } = await query('SELECT * FROM mutations');
  const cache = {};
  for (const m of rows) cache[m.id] = m;
  MUTATION_CACHE = cache;
  return cache;
}

export function getMutationCache() { return MUTATION_CACHE; }

export async function checkMutationTrigger(player) {
  if ((player.radiation || 0) < 40) return null;

  const { rows } = await query('SELECT mutation_id FROM player_mutations WHERE player_id=$1', [player.id]);
  const existingIds = rows.map(r => r.mutation_id);

  const eligible = Object.values(MUTATION_CACHE).filter(m =>
    player.radiation >= m.radiation_threshold && !existingIds.includes(m.id)
  );
  if (!eligible.length) return null;
  if (Math.random() > 0.05) return null;

  const mutation = eligible[Math.floor(Math.random() * eligible.length)];
  await grantMutation(player, mutation);
  return mutation;
}

export async function grantMutation(player, mutation) {
  const statUpdates = [];
  const vals = [];
  let i = 1;
  for (const [stat, delta] of Object.entries(mutation.stat_modifiers || {})) {
    statUpdates.push(`${stat} = ${stat} + $${i++}`);
    vals.push(delta);
  }
  if (statUpdates.length) {
    vals.push(player.id);
    await query(`UPDATE players SET ${statUpdates.join(', ')} WHERE id = $${i}`, vals);
    for (const [stat, delta] of Object.entries(mutation.stat_modifiers || {})) {
      if (player[stat] !== undefined) player[stat] += delta;
    }
  }

  await query(
    `INSERT INTO player_mutations (player_id, mutation_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [player.id, mutation.id]
  );

  // If this (or any prior) mutation is visible, the player is now flagged
  // visibly_mutated — drives the Custodian outcast mechanic. Once visible,
  // always visible (you don't un-notice someone's extra eye).
  if (mutation.visible) {
    await query('UPDATE players SET visibly_mutated=1 WHERE id=$1', [player.id]);
    player.visibly_mutated = 1;
  }
}

export async function getPlayerMutations(playerId) {
  const { rows } = await query('SELECT mutation_id FROM player_mutations WHERE player_id=$1', [playerId]);
  return rows.map(r => MUTATION_CACHE[r.mutation_id]).filter(Boolean);
}

// Custodian-aligned safe zones treat visibly mutated players as outcasts:
// hostility text on entry/look, escalating to actual turret attacks if the
// zone is flagged for it. Staying unmutated keeps full access to these areas.
export function getCustodianOutcastResponse(zone, player) {
  if (!player.visibly_mutated) return null;
  const flags = zone.flags || {};
  if (!flags.custodian_controlled) return null;

  if (flags.has_turrets) {
    return {
      hostile: true,
      message: `\n<span class="turret-warning">⚠ AUTOMATED TURRET: "MUTATION SIGNATURE DETECTED. DEVIATION FROM BASELINE. NON-COMPLIANT."</span>`,
    };
  }
  return {
    hostile: false,
    message: `\n<span class="outcast-warning">Custodian staff eye you and step back. One mutters into a radio. You are not welcome here, and everyone has made sure you know it.</span>`,
  };
}
