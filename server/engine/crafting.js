/**
 * Crafting system — deep simulation.
 * Material quality + tool skill + fabrication skill all affect output.
 *
 * Recipes live in the `recipes` table (dev-panel editable) and are cached
 * in memory here, mirroring how world.js caches zones — read the cache on
 * every craft attempt, refresh it whenever the dev panel publishes a change.
 */
import { query } from '../models/db.js';
import { awardSkillUse, skillCheck } from './skills.js';

// Quality tiers: numeric 0–4, stored as text in item flags
export const QUALITY_TIERS = {
  scrap:           { label: 'Scrap',           multiplier: 0.5,  color: 'item-rarity-common' },
  common:          { label: 'Common',          multiplier: 1.0,  color: 'item-rarity-common' },
  refined:         { label: 'Refined',         multiplier: 1.5,  color: 'item-rarity-uncommon' },
  pristine:        { label: 'Pristine',        multiplier: 2.0,  color: 'item-rarity-rare' },
  architect_grade: { label: 'Architect-Grade', multiplier: 3.0,  color: 'item-rarity-very_rare' },
};

// In-memory recipe cache. DB is the source of truth; this is just fast read access.
let RECIPE_CACHE = {};

export async function loadRecipes() {
  const { rows } = await query('SELECT * FROM recipes');
  const cache = {};
  for (const r of rows) {
    cache[r.id] = {
      id: r.id, name: r.name, description: r.description, category: r.category,
      requires_station: r.requires_station,
      skill_req: r.skill_req || {},
      ingredients: r.ingredients || [],
      base_output: r.base_output,
      skill_id: r.skill_id,
      base_difficulty: r.base_difficulty,
    };
  }
  RECIPE_CACHE = cache;
  return cache;
}

export function getRecipeCache() { return RECIPE_CACHE; }

// Resolve a recipe by its player-facing name (case-insensitive). Recipe IDs
// are an internal detail and never shown to players — they craft by name.
export function findRecipeByName(name) {
  const wanted = (name || '').trim().toLowerCase();
  if (!wanted) return null;
  return Object.values(RECIPE_CACHE).find(r => (r.name || '').toLowerCase() === wanted) || null;
}

/**
 * Attempt to craft a recipe.
 * Returns { success, message, output?, critical? }
 */
export async function attemptCraft(player, recipeId, stationQuality = 'none') {
  const recipe = RECIPE_CACHE[recipeId];
  if (!recipe) return { success: false, message: 'Unknown recipe.' };

  // Check skill requirements
  const { rows: skillRows } = await query(
    'SELECT skill_id, trained FROM player_skills WHERE player_id = $1', [player.id]
  );
  const playerSkills = {};
  for (const r of skillRows) playerSkills[r.skill_id] = r.trained || 0;

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

  const critical = Math.random() < 0.05 + (playerSkills[recipe.skill_id] || 0) * 0.005;
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

  await awardSkillUse(player.id, recipe.skill_id, skillResult.margin);

  // Insert output item — stacks onto an existing pile of the same item at
  // the same quality tier (a pristine craft and a scrap craft of the same
  // item are NOT the same stack; quality is part of what's being matched).
  const { randomUUID } = await import('crypto');
  const outputQty = recipe.base_output.quantity * (critical ? 2 : 1);
  const customData = { quality: outputQuality };

  const { rows: outputItemRows } = await query('SELECT tags FROM items WHERE id=$1', [recipe.base_output.item_id]);
  const outputIsStackable = outputItemRows[0]?.tags?.stackable;

  let existingStack = [];
  if (outputIsStackable) {
    const result = await query(
      `SELECT id, quantity FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND is_equipped=0 AND custom_data=$3`,
      [player.id, recipe.base_output.item_id, JSON.stringify(customData)]
    );
    existingStack = result.rows;
  }

  if (existingStack.length) {
    await query('UPDATE player_inventory SET quantity = quantity + $1 WHERE id = $2', [outputQty, existingStack[0].id]);
  } else {
    await query(
      'INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, custom_data) VALUES ($1, $2, $3, $4, $5, $6)',
      [randomUUID(), player.id, recipe.base_output.item_id, outputQty, 1.0, JSON.stringify(customData)]
    );
  }

  const critMsg = critical ? ' CRITICAL CRAFT — double output! ' : '';
  return {
    success: true,
    critical,
    outputQuality,
    message: `${critMsg}You craft ${outputQty}x ${recipe.name} [${QUALITY_TIERS[outputQuality].label}].`,
    item_id: recipe.base_output.item_id,
    quantity: outputQty,
  };
}

export function getAvailableRecipes(playerSkills = {}) {
  return Object.values(RECIPE_CACHE).filter(recipe => {
    for (const [skillId, minRank] of Object.entries(recipe.skill_req || {})) {
      if ((playerSkills[skillId] || 0) < minRank) return false;
    }
    return true;
  });
}
