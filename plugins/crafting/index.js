import { query } from '../../server/models/db.js';
import { getAvailableRecipes, attemptCraft, findRecipeByName } from '../../server/engine/crafting.js';

async function cmdRecipes(args, raw, player) {
  const { rows: skillRows } = await query('SELECT skill_id, ip FROM player_skills WHERE player_id = $1', [player.id]);
  const skills = {};
  for (const r of skillRows) skills[r.skill_id] = Math.floor((r.ip || 0) / 100);
  const available = getAvailableRecipes(player, skills);
  if (!available.length) return { type:'recipes', recipes:[] };

  // Resolve item names for outputs + ingredients in a single query.
  const itemIds = new Set();
  for (const r of available) {
    if (r.base_output?.item_id) itemIds.add(r.base_output.item_id);
    for (const ing of (r.ingredients || [])) if (ing.item_id) itemIds.add(ing.item_id);
  }
  const idList = [...itemIds];
  const nameById = {};
  if (idList.length) {
    const { rows: itemRows } = await query('SELECT id, name FROM items WHERE id = ANY($1)', [idList]);
    for (const it of itemRows) nameById[it.id] = it.name;
  }

  // How many of each ingredient the player currently holds.
  const haveByItem = {};
  if (idList.length) {
    const { rows: invRows } = await query(
      'SELECT item_id, SUM(quantity) AS qty FROM player_inventory WHERE player_id = $1 AND item_id = ANY($2) GROUP BY item_id',
      [player.id, idList]
    );
    for (const r of invRows) haveByItem[r.item_id] = Number(r.qty) || 0;
  }

  const recipes = available.map(r => {
    const ingredients = (r.ingredients || [])
      .filter(ing => ing.quantity > 0)
      .map(ing => ({
        name: nameById[ing.item_id] || ing.item_id,
        need: ing.quantity,
        have: haveByItem[ing.item_id] || 0,
      }));
    let craftable = true;
    let reason = null;
    if (r.requires_station) {
      craftable = false;
      reason = `needs ${r.requires_station.replace(/_/g, ' ')}`;
    } else {
      const missing = ingredients.find(ing => ing.have < ing.need);
      if (missing) { craftable = false; reason = `missing ${missing.name}`; }
    }
    return {
      name: r.name,
      description: r.description,
      skill_id: r.skill_id,
      category: r.category,
      station: r.requires_station || null,
      output: { name: nameById[r.base_output?.item_id] || r.base_output?.item_id, quantity: r.base_output?.quantity || 1 },
      ingredients,
      craftable,
      reason,
    };
  });
  return { type:'recipes', recipes };
}

async function cmdCraft(args, raw, player) {
  const wanted = args.join(' ').trim();
  if (!wanted) return { type:'error', message:'Craft what? Use RECIPES to see available recipes.' };
  const recipe = findRecipeByName(wanted);
  if (!recipe) return { type:'error', message:'Unknown recipe.' };
  const result = await attemptCraft(player, recipe.id);
  return { type:result.success ? 'craft' : 'error', message:result.message };
}

export const commands = { craft: cmdCraft, recipes: cmdRecipes };
