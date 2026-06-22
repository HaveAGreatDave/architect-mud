import { query } from '../../server/models/db.js';
import { getAvailableRecipes, attemptCraft } from '../../server/engine/crafting.js';

async function cmdRecipes(args, raw, player) {
  const { rows: skillRows } = await query('SELECT skill_id, rank FROM player_skills WHERE player_id = $1', [player.id]);
  const skills = {};
  for (const r of skillRows) skills[r.skill_id] = r.rank;
  const available = getAvailableRecipes(skills);
  if (!available.length) return { type:'recipes', message:'You don\'t know any recipes yet.' };
  let msg = '<span class="skills-header">KNOWN RECIPES</span>\n\n';
  const byCategory = {};
  for (const r of available) { if (!byCategory[r.category]) byCategory[r.category]=[]; byCategory[r.category].push(r); }
  for (const [cat, recipes] of Object.entries(byCategory)) {
    msg += `<span class="skill-category">${cat.toUpperCase()}</span>\n`;
    for (const r of recipes) {
      const station = r.requires_station ? ` [needs: ${r.requires_station.replace(/_/g,' ')}]` : '';
      msg += `  <span class="exits-label">${r.id}</span> — ${r.name}${station}\n    ${r.description}\n`;
    }
    msg += '\n';
  }
  msg += 'Use: <span class="equipped">craft &lt;recipe_id&gt;</span>';
  return { type:'recipes', message:msg };
}

async function cmdCraft(args, raw, player) {
  const recipeId = args.join('_');
  if (!recipeId) return { type:'error', message:'Craft what? Use RECIPES to see available recipes.' };
  const result = await attemptCraft(player, recipeId);
  return { type:result.success ? 'craft' : 'error', message:result.message };
}

export const commands = { craft: cmdCraft, recipes: cmdRecipes };
