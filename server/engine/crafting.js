/**
 * Crafting system — deep simulation.
 * Material quality + tool skill + fabrication skill all affect output.
 */
import { query } from '../models/db.js';
import { awardSkillXp, skillCheck } from './skills.js';

// Quality tiers: numeric 0–4, stored as text in item flags
export const QUALITY_TIERS = {
  scrap:           { label: 'Scrap',           multiplier: 0.5,  color: 'item-rarity-common' },
  common:          { label: 'Common',          multiplier: 1.0,  color: 'item-rarity-common' },
  refined:         { label: 'Refined',         multiplier: 1.5,  color: 'item-rarity-uncommon' },
  pristine:        { label: 'Pristine',        multiplier: 2.0,  color: 'item-rarity-rare' },
  architect_grade: { label: 'Architect-Grade', multiplier: 3.0,  color: 'item-rarity-very_rare' },
};

// All recipes. Each has required items (with quality minimums), tool requirements, skill reqs, and output.
export const RECIPES = {
  'recipe_pipe_weapon': {
    id: 'recipe_pipe_weapon',
    name: 'Pipe Wrench',
    description: 'Combine scrap metal into a crude but effective blunt weapon.',
    category: 'weapons',
    requires_station: null,
    skill_req: { fabrication: 0 },
    ingredients: [
      { item_id: 'item_scrap_metal', quantity: 3, min_quality: 'scrap' },
    ],
    base_output: { item_id: 'item_pipe_wrench', quantity: 1 },
    skill_id: 'fabrication',
    base_difficulty: 3,
  },
  'recipe_bandage': {
    id: 'recipe_bandage',
    name: 'Field Bandage',
    description: 'Tear cloth into bandages. Requires nothing but desperation.',
    category: 'medicine',
    requires_station: null,
    skill_req: { medicine: 0 },
    ingredients: [
      { item_id: 'item_scrap_metal', quantity: 0 }, // placeholder — in real game: cloth
    ],
    base_output: { item_id: 'item_bandage', quantity: 2 },
    skill_id: 'medicine',
    base_difficulty: 2,
  },
  'recipe_rad_pills_crude': {
    id: 'recipe_rad_pills_crude',
    name: 'Crude RadAway',
    description: 'Improvised radiation treatment. Effective. Unpleasant.',
    category: 'medicine',
    requires_station: 'chemistry_set',
    skill_req: { medicine: 3, fabrication: 1 },
    ingredients: [
      { item_id: 'item_mutant_gland', quantity: 1, min_quality: 'common' },
    ],
    base_output: { item_id: 'item_rad_pills', quantity: 2 },
    skill_id: 'medicine',
    base_difficulty: 6,
  },
  'recipe_scrap_armor': {
    id: 'recipe_scrap_armor',
    name: 'Scrap Vest',
    description: 'Layer metal sheeting over salvaged clothing. Crude but it absorbs hits.',
    category: 'armor',
    requires_station: null,
    skill_req: { fabrication: 1 },
    ingredients: [
      { item_id: 'item_scrap_metal', quantity: 5, min_quality: 'scrap' },
    ],
    base_output: { item_id: 'item_scrap_armor', quantity: 1 },
    skill_id: 'fabrication',
    base_difficulty: 4,
  },
  'recipe_glitch_decoder': {
    id: 'recipe_glitch_decoder',
    name: 'Architect Signal Decoder',
    description: 'Assembles a device that can interpret Architect data fragments. Requires high skill and rare parts.',
    category: 'tech',
    requires_station: 'architect_terminal',
    skill_req: { hacking: 5, electronics: 4 },
    ingredients: [
      { item_id: 'item_drone_core', quantity: 1, min_quality: 'common' },
      { item_id: 'item_architect_fragment', quantity: 1, min_quality: 'common' },
    ],
    base_output: { item_id: 'item_signal_decoder', quantity: 1 },
    skill_id: 'hacking',
    base_difficulty: 10,
  },
};

/**
 * Attempt to craft a recipe.
 * Returns { success, message, output?, critical? }
 */
export async function attemptCraft(player, recipeId, stationQuality = 'none') {
  const recipe = RECIPES[recipeId];
  if (!recipe) return { success: false, message: 'Unknown recipe.' };

  // Check skill requirements
  const { rows: skillRows } = await query(
    'SELECT skill_id, rank FROM player_skills WHERE player_id = $1', [player.id]
  );
  const playerSkills = {};
  for (const r of skillRows) playerSkills[r.skill_id] = r.rank;

  for (const [skillId, minRank] of Object.entries(recipe.skill_req || {})) {
    if ((playerSkills[skillId] || 0) < minRank) {
      const skillName = skillId.replace(/_/g, ' ');
      return { success: false, message: `You need ${skillName} rank ${minRank} to craft this.` };
    }
  }

  // Check station requirement
  if (recipe.requires_station && stationQuality === 'none') {
    return { success: false, message: `This recipe requires a ${recipe.requires_station.replace(/_/g, ' ')}.` };
  }

  // Check ingredients
  const { rows: inventory } = await query(
    `SELECT pi.*, i.name, i.flags FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id
     WHERE pi.player_id = $1`,
    [player.id]
  );

  const toConsume = [];
  for (const ing of recipe.ingredients) {
    if (ing.quantity === 0) continue; // optional/placeholder
    const found = inventory.find(inv =>
      inv.item_id === ing.item_id && inv.quantity >= ing.quantity
    );
    if (!found) {
      const { rows: itemRows } = await query('SELECT name FROM items WHERE id = $1', [ing.item_id]);
      const itemName = itemRows[0]?.name || ing.item_id;
      return { success: false, message: `You need ${ing.quantity}x ${itemName}.` };
    }
    toConsume.push({ invId: found.id, quantity: ing.quantity, currentQty: found.quantity });
  }

  // Roll the craft
  const skillResult = await skillCheck(player, recipe.skill_id, recipe.base_difficulty);
  const stationBonus = stationQuality === 'refined' ? 2 : stationQuality === 'pristine' ? 4 : 0;
  const finalMargin = skillResult.margin + stationBonus;

  const critical = Math.random() < 0.05 + (playerSkills[recipe.skill_id] || 0) * 0.01;
  const catastrophicFail = !skillResult.success && finalMargin < -4;

  if (catastrophicFail) {
    // Consume ingredients anyway
    for (const c of toConsume) {
      if (c.currentQty <= c.quantity) {
        await query('DELETE FROM player_inventory WHERE id = $1', [c.invId]);
      } else {
        await query('UPDATE player_inventory SET quantity = quantity - $1 WHERE id = $2', [c.quantity, c.invId]);
      }
    }
    return { success: false, message: `You catastrophically fail to craft ${recipe.name}. The ingredients are ruined.` };
  }

  if (!skillResult.success) {
    return { success: false, message: `You fail to craft ${recipe.name}. Your materials are intact — try again.` };
  }

  // Consume ingredients
  for (const c of toConsume) {
    if (c.currentQty <= c.quantity) {
      await query('DELETE FROM player_inventory WHERE id = $1', [c.invId]);
    } else {
      await query('UPDATE player_inventory SET quantity = quantity - $1 WHERE id = $2', [c.quantity, c.invId]);
    }
  }

  // Determine output quality based on margin
  let outputQuality = 'common';
  if (finalMargin >= 6) outputQuality = 'pristine';
  else if (finalMargin >= 3) outputQuality = 'refined';
  else if (finalMargin < 0) outputQuality = 'scrap';
  if (critical) outputQuality = 'pristine'; // crits always pristine

  // Award XP
  const xpGain = recipe.base_difficulty * 5 + (skillResult.success ? 10 : 0);
  await awardSkillXp(player.id, recipe.skill_id, xpGain);

  // Insert output item
  const { randomUUID } = await import('crypto');
  const outputQty = recipe.base_output.quantity * (critical ? 2 : 1);
  await query(
    'INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, custom_data) VALUES ($1, $2, $3, $4, $5, $6)',
    [randomUUID(), player.id, recipe.base_output.item_id, outputQty, 1.0, JSON.stringify({ quality: outputQuality })]
  );

  const critMsg = critical ? ' CRITICAL CRAFT — double output! ' : '';
  return {
    success: true,
    critical,
    outputQuality,
    message: `${critMsg}You craft ${outputQty}x ${recipe.name} [${QUALITY_TIERS[outputQuality].label}]. (+${xpGain} fabrication XP)`,
    item_id: recipe.base_output.item_id,
    quantity: outputQty,
  };
}

export function getAvailableRecipes(playerSkills = {}) {
  return Object.values(RECIPES).filter(recipe => {
    for (const [skillId, minRank] of Object.entries(recipe.skill_req || {})) {
      if ((playerSkills[skillId] || 0) < minRank) return false;
    }
    return true;
  });
}
