/**
 * Mutation system — triggered by high radiation exposure.
 * Mutations are permanent (unless treated). Mix of buffs and drawbacks.
 */
import { query } from '../models/db.js';
import { randomUUID } from 'crypto';

export const MUTATIONS = {
  extra_eye: {
    id: 'extra_eye',
    name: 'Extra Eye',
    description: 'A third eye has opened on the back of your skull. You see things people don\'t.',
    stat_modifiers: { stat_agi: 1 },
    perception_bonus: 2,
    drawbacks: ['NPCs find you unsettling (-1 CHA in dialogue)'],
    rarity: 'uncommon',
    radiation_threshold: 60,
  },
  necrotic_hand: {
    id: 'necrotic_hand',
    name: 'Necrotic Hand',
    description: 'One hand has darkened and hardened. Melee attacks cause bleeding. You can\'t wear gloves.',
    stat_modifiers: {},
    combat_bonus: { status_on_hit: 'bleeding', chance: 0.3 },
    drawbacks: ['Cannot equip gloves'],
    rarity: 'uncommon',
    radiation_threshold: 50,
  },
  static_mind: {
    id: 'static_mind',
    name: 'Static Mind',
    description: 'Your thoughts are a white noise channel. Partial immunity to sanity loss. Architect signals are louder.',
    stat_modifiers: { stat_wil: 2 },
    sanity_drain_reduction: 0.5,
    architect_attunement: true,
    drawbacks: ['Occasional intrusive Architect messages'],
    rarity: 'rare',
    radiation_threshold: 70,
  },
  iron_stomach: {
    id: 'iron_stomach',
    name: 'Iron Stomach',
    description: 'You can eat almost anything. Food poisoning is no longer a concern. What is a concern is what you now find appetizing.',
    stat_modifiers: { stat_end: 1 },
    food_poison_immunity: true,
    can_eat_raw: true,
    drawbacks: ['You occasionally eye things that should not be food'],
    rarity: 'common',
    radiation_threshold: 40,
  },
  rad_absorption: {
    id: 'rad_absorption',
    name: 'Rad Absorption',
    description: 'Your body has learned to metabolize radiation instead of being destroyed by it. Slowly.',
    stat_modifiers: { stat_end: 2 },
    rad_resistance: 0.3,
    drawbacks: ['You glow faintly in the dark. Stealth checks are harder.'],
    rarity: 'rare',
    radiation_threshold: 80,
  },
  bone_spur: {
    id: 'bone_spur',
    name: 'Bone Spurs',
    description: 'Calcified projections have erupted through your knuckles. Unarmed attacks deal more damage and cause bleeding.',
    stat_modifiers: { stat_str: 1 },
    unarmed_damage_bonus: 3,
    unarmed_bleed_chance: 0.25,
    drawbacks: ['Gloves don\'t fit. Handshakes are awkward.'],
    rarity: 'uncommon',
    radiation_threshold: 55,
  },
};

/**
 * Check if a player should gain a mutation based on radiation level.
 * Called periodically from the game loop.
 */
export async function checkMutationTrigger(player) {
  if ((player.radiation || 0) < 40) return null;

  // Get existing mutations
  const { rows } = await query(
    `SELECT custom_data FROM player_inventory WHERE player_id = $1 AND item_id LIKE 'mutation_%'`,
    [player.id]
  );
  const existingMutationIds = rows.map(r => {
    try { return JSON.parse(r.custom_data)?.mutation_id; } catch { return null; }
  }).filter(Boolean);

  // Find eligible mutations not yet acquired
  const eligible = Object.values(MUTATIONS).filter(m =>
    player.radiation >= m.radiation_threshold && !existingMutationIds.includes(m.id)
  );

  if (!eligible.length) return null;

  // 5% chance per check to gain a mutation
  if (Math.random() > 0.05) return null;

  const mutation = eligible[Math.floor(Math.random() * eligible.length)];
  await grantMutation(player, mutation);
  return mutation;
}

export async function grantMutation(player, mutation) {
  // Apply stat modifiers
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
    for (const [stat, delta] of Object.entries(mutation.stat_modifiers)) {
      if (player[stat] !== undefined) player[stat] += delta;
    }
  }

  // Record mutation as a special inventory item
  await query(
    `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, custom_data)
     VALUES ($1, $2, $3, 1, 1.0, $4)`,
    [randomUUID(), player.id, `mutation_${mutation.id}`, JSON.stringify({ mutation_id: mutation.id, acquired_at: Date.now() })]
  );
}

export async function getPlayerMutations(playerId) {
  const { rows } = await query(
    `SELECT custom_data FROM player_inventory WHERE player_id = $1 AND item_id LIKE 'mutation_%'`,
    [playerId]
  );
  return rows.map(r => {
    try {
      const data = JSON.parse(r.custom_data);
      return MUTATIONS[data.mutation_id] || null;
    } catch { return null; }
  }).filter(Boolean);
}
