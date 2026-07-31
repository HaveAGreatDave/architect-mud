/**
 * Crafting system — deep simulation.
 * Material quality + tool skill + fabrication skill all affect output.
 *
 * Recipes live in the `recipes` table (dev-panel editable) and are cached
 * in memory here, mirroring how world.js caches zones — read the cache on
 * every craft attempt, refresh it whenever the dev panel publishes a change.
 */
import { query, withTransaction } from '../models/db.js';
import { awardSkillUse, skillCheck, skillStatBonus } from './skills.js';
import { isStackable } from './tags.js';

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
 * How long a craft takes, in seconds.
 *
 * DERIVED, never authored. The `recipes.craft_time` column existed for years and
 * 35 of 36 recipes still carried its default of 3 — a per-recipe number with no
 * mechanical effect never gets tuned. So the duration comes out of the fields
 * authors DO maintain, and every recipe gets a sensible time for free.
 *
 * Deliberately NOT derived from the output item's `value`, which is the trick
 * durability uses for its condition capacity. Value tracks what a thing SELLS
 * for, not what it takes to make: measured across the recipe table, difficulty
 * and value correlate at r=0.04 (a Feed Spoofer worth 1400 is difficulty 6; a
 * dose of Amyls worth 25 is difficulty 10). It is the wrong axis here.
 *
 * The three inputs, in order of how much they matter:
 *   base_difficulty — the spine. Genuinely authored, spread 2..12.
 *   skill_req       — a gated recipe is more involved than an open one.
 *   bulk            — ingredient units beyond one each; separates a Scrap Vest
 *                     (five units of scrap) from a two-part Relay Node.
 *
 * Lands the current table in a 6..23 s band: a Field Bandage is near-instant,
 * an Architect Signal Decoder pins you in place long enough to matter.
 */
export function craftSeconds(recipe) {
  if (!recipe) return 0;
  const ingredients = recipe.ingredients || [];
  const bulk = ingredients.reduce((sum, ing) => sum + (ing.quantity || 1), 0) - ingredients.length;
  const skillReq = Math.max(0, ...Object.values(recipe.skill_req || {}).map(Number).filter(Number.isFinite));
  const seconds = 3
    + (Number(recipe.base_difficulty) || 0) * 1.5
    + (Number.isFinite(skillReq) ? skillReq : 0) * 1.0
    + Math.max(0, bulk) * 0.5;
  return Math.max(1, Math.round(seconds));
}

/**
 * Everything `attemptCraft` checks BEFORE it rolls or writes anything: skill
 * ranks, the station, and the ingredients on hand.
 *
 * Split out so a timed craft can refuse up front — being told after a 23-second
 * wait that you were never skilled enough would be a bad joke. `attemptCraft`
 * calls it too and re-checks at resolve time, so nothing is trusted across the
 * wait: a player who drops or sells the parts mid-craft fails at the end, and
 * the resolve is still the only thing that consumes anything.
 *
 * Returns { ok, message?, recipe?, toConsume?, playerSkills? }.
 */
export async function checkCraftReady(player, recipeId, stationQuality = 'none') {
  const recipe = RECIPE_CACHE[recipeId];
  if (!recipe) return { ok: false, message: 'Unknown recipe.' };

  // Check skill requirements
  const { rows: skillRows } = await query(
    'SELECT skill_id, ip FROM player_skills WHERE player_id = $1', [player.id]
  );
  const playerSkills = {};
  for (const r of skillRows) playerSkills[r.skill_id] = Math.floor((r.ip || 0) / 100);

  for (const [skillId, minRank] of Object.entries(recipe.skill_req || {})) {
    if ((playerSkills[skillId] || 0) + skillStatBonus(player, skillId) < minRank) {
      const skillName = skillId.replace(/_/g, ' ');
      return { ok: false, message: `You need ${skillName} rank ${minRank} to craft this.` };
    }
  }

  // Check station requirement
  if (recipe.requires_station && stationQuality === 'none') {
    return { ok: false, message: `This recipe requires a ${recipe.requires_station.replace(/_/g, ' ')}.` };
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
      return { ok: false, message: `You need ${ing.quantity}x ${itemName}.` };
    }
    toConsume.push({ invId: found.id, quantity: ing.quantity, currentQty: found.quantity });
  }

  return { ok: true, recipe, toConsume, playerSkills };
}

/**
 * Attempt to craft a recipe.
 * Returns { success, message, output?, critical? }
 */
export async function attemptCraft(player, recipeId, stationQuality = 'none') {
  const ready = await checkCraftReady(player, recipeId, stationQuality);
  if (!ready.ok) return { success: false, message: ready.message };
  const { recipe, toConsume, playerSkills } = ready;

  // Roll the craft
  const skillResult = await skillCheck(player, recipe.skill_id, recipe.base_difficulty);
  const stationBonus = stationQuality === 'refined' ? 2 : stationQuality === 'pristine' ? 4 : 0;
  const finalMargin = skillResult.margin + stationBonus;

  const critical = Math.random() < 0.05 + (playerSkills[recipe.skill_id] || 0) * 0.005;
  const catastrophicFail = !skillResult.success && finalMargin < -4;

  if (catastrophicFail) {
    // Consume ingredients anyway — all-or-nothing so a partial consume can't
    // eat some materials and spare others.
    await withTransaction(async (q) => {
      for (const c of toConsume) {
        if (c.currentQty <= c.quantity) {
          await q('DELETE FROM player_inventory WHERE id = $1', [c.invId]);
        } else {
          await q('UPDATE player_inventory SET quantity = quantity - $1 WHERE id = $2', [c.quantity, c.invId]);
        }
      }
    });
    return { success: false, message: `You catastrophically fail to craft ${recipe.name}. The ingredients are ruined.` };
  }

  if (!skillResult.success) {
    return { success: false, message: `You fail to craft ${recipe.name}. Your materials are intact — try again.` };
  }

  // Prep output details (pure work + reads) before the write transaction.
  const { randomUUID } = await import('crypto');
  const outputQty = recipe.base_output.quantity * (critical ? 2 : 1);

  const { rows: outputItemRows } = await query('SELECT tags FROM items WHERE id=$1', [recipe.base_output.item_id]);
  const outputIsStackable = outputItemRows[0] ? isStackable(outputItemRows[0]) : false;

  // Consume ingredients and produce the output atomically — a mid-craft failure
  // must never eat the materials without yielding the result (or vice versa).
  await withTransaction(async (q) => {
    for (const c of toConsume) {
      if (c.currentQty <= c.quantity) {
        await q('DELETE FROM player_inventory WHERE id = $1', [c.invId]);
      } else {
        await q('UPDATE player_inventory SET quantity = quantity - $1 WHERE id = $2', [c.quantity, c.invId]);
      }
    }

    let existingStack = [];
    if (outputIsStackable) {
      const result = await q(
        `SELECT id, quantity FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND is_equipped=0`,
        [player.id, recipe.base_output.item_id]
      );
      existingStack = result.rows;
    }

    if (existingStack.length) {
      await q('UPDATE player_inventory SET quantity = quantity + $1 WHERE id = $2', [outputQty, existingStack[0].id]);
    } else {
      await q(
        'INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1, $2, $3, $4, $5)',
        [randomUUID(), player.id, recipe.base_output.item_id, outputQty, 1.0]
      );
    }
  });

  await awardSkillUse(player.id, recipe.skill_id, skillResult.margin);

  const critMsg = critical ? ' CRITICAL CRAFT — double output! ' : '';
  return {
    success: true,
    critical,
    message: `${critMsg}You craft ${outputQty}x ${recipe.name}.`,
    item_id: recipe.base_output.item_id,
    quantity: outputQty,
  };
}

export function getAvailableRecipes(player, playerSkills = {}) {
  return Object.values(RECIPE_CACHE).filter(recipe => {
    for (const [skillId, minRank] of Object.entries(recipe.skill_req || {})) {
      if ((playerSkills[skillId] || 0) + skillStatBonus(player, skillId) < minRank) return false;
    }
    return true;
  });
}
