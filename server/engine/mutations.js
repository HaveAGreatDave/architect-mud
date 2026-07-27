/**
 * Mutation system — HellMOO-style. Triggered by sustained radiation exposure.
 * Mutations are permanent and dev-panel editable, cached in memory like
 * recipes/drugs. Polarity can be positive, negative, or mixed — staying
 * unmutated has its own benefit: visibly mutated players are treated as
 * outcasts in Custodian-aligned zones (hostility text, then turrets).
 */
import { query } from '../models/db.js';
import { maxHpForEndurance } from './ip.js';

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
  // Chrome can't mutate — flesh and machine are the two divergent paths, and
  // installing an augment closes the flesh one. `player.chromed` is a memory flag
  // maintained by plugins/augments (set on install, cleared when the last augment
  // is pulled). The first install also burns off any mutations already carried.
  if (player.chromed) return null;
  if ((player.radiation || 0) < 40) return null;

  // Roll BEFORE the read, not after. This is a 5% event checked once a minute for
  // every irradiated player, and the query below tells us nothing unless the roll
  // lands — so asking the database first meant 19 out of every 20 round trips
  // existed purely to be discarded. The outcomes are identical either way: a
  // player with no eligible mutations returns null regardless of the roll, and
  // the roll is independent of what the query returns.
  if (Math.random() > 0.05) return null;

  const { rows } = await query('SELECT mutation_id FROM player_mutations WHERE player_id=$1', [player.id]);
  const existingIds = rows.map(r => r.mutation_id);

  const eligible = Object.values(MUTATION_CACHE).filter(m =>
    player.radiation >= m.radiation_threshold && !existingIds.includes(m.id)
  );
  if (!eligible.length) return null;

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

    // Endurance changes shift max HP; mirror the delta onto current HP, clamped.
    const endDelta = mutation.stat_modifiers.stat_endurance;
    if (endDelta) {
      const newHpMax = maxHpForEndurance(player.stat_endurance);
      const { rows: hpRows } = await query(
        `UPDATE players SET hp_max=$1, hp=GREATEST(1,LEAST(hp+$2,$1)) WHERE id=$3 RETURNING hp, hp_max`,
        [newHpMax, endDelta * 2, player.id]
      );
      player.hp = hpRows[0].hp;
      player.hp_max = hpRows[0].hp_max;
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

// Burn off every mutation the player carries — reversing each mutation's
// stat_modifiers (the inverse of grantMutation) and clearing visibly_mutated.
// This is the deliberate flesh→machine conversion the chrome-doctor performs on
// the first augment install; it only ever happens on a choice at the clinic,
// never a random rad-mugging. Returns the count burned. Owned by the engine
// (mutation substrate); called by plugins/augments.
export async function burnAllMutations(player) {
  const mutations = await getPlayerMutations(player.id);
  if (!mutations.length) return 0;
  const totals = {};
  for (const m of mutations) {
    for (const [stat, delta] of Object.entries(m.stat_modifiers || {})) {
      totals[stat] = (totals[stat] || 0) - delta;   // reverse the grant
    }
  }
  const entries = Object.entries(totals);
  if (entries.length) {
    const sets = [];
    const vals = [];
    let i = 1;
    for (const [stat, delta] of entries) { sets.push(`${stat} = ${stat} + $${i++}`); vals.push(delta); }
    vals.push(player.id);
    await query(`UPDATE players SET ${sets.join(', ')} WHERE id = $${i}`, vals);
    for (const [stat, delta] of entries) if (player[stat] !== undefined) player[stat] += delta;

    // Endurance drop shrinks max HP — mirror grantMutation's HP handling.
    if (totals.stat_endurance) {
      const newHpMax = maxHpForEndurance(player.stat_endurance);
      const { rows } = await query(
        `UPDATE players SET hp_max=$1, hp=GREATEST(1,LEAST(hp,$1)) WHERE id=$2 RETURNING hp, hp_max`,
        [newHpMax, player.id]
      );
      player.hp = rows[0].hp;
      player.hp_max = rows[0].hp_max;
    }
  }
  await query('DELETE FROM player_mutations WHERE player_id=$1', [player.id]);
  await query('UPDATE players SET visibly_mutated=0 WHERE id=$1', [player.id]);
  player.visibly_mutated = 0;
  return mutations.length;
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
