// Crafting — recipe display, and a TIMED craft.
//
// `craft` is not instant. Starting one puts you in `posture === 'crafting'` with
// a companion `player.craftState = { recipeId, name, completeAt }`, and the
// engine's activity-tick substrate resolves it when the clock runs out. Posture
// is the authoritative flag, which is the whole point: every engine force-stand
// interruption (moving, attacking, being attacked, dying) aborts the craft for
// free, with no interruption plumbing of its own.
//
// The duration is DERIVED from the recipe, never authored — see craftSeconds()
// in server/engine/crafting.js for why, and for what happened to the old
// `recipes.craft_time` column.
import { query } from '../../server/models/db.js';
import {
  getAvailableRecipes,
  attemptCraft,
  findRecipeByName,
  checkCraftReady,
  craftSeconds,
} from '../../server/engine/crafting.js';
import { registerActivity } from '../../server/engine/activity-tick.js';
import { getLivePlayer } from '../../server/engine/world.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { getPosture, setPosture } from '../../server/engine/posture.js';
import { on } from '../../server/engine/events.js';

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

// Clear the craft and hide the client countdown bar.
function clearCraft(player, tellMsg) {
  const cur = getLivePlayer(player.id) || player;
  delete cur.craftState;
  if (getPosture(cur) === 'crafting') setPosture(cur, 'standing');
  sendToPlayer(player.id, { type: 'progress', action: 'craft', done: true });
  if (tellMsg) sendToPlayer(player.id, { type: 'emote', message: tellMsg });
}

async function cmdCraft(args, raw, player) {
  const wanted = args.join(' ').trim();
  if (!wanted) return { type:'error', message:'Craft what? Use RECIPES to see available recipes.' };
  const recipe = findRecipeByName(wanted);
  if (!recipe) return { type:'error', message:'Unknown recipe.' };

  if (player.craftState) return { type:'emote', message:'You\'re already in the middle of something.' };
  if (getPosture(player) !== 'standing')
    return { type:'emote', message:'You need to be on your feet to craft.' };
  if (player.combatTargetId || player.pvpTargetId || player.npcCombatTargetId)
    return { type:'error', message:'You\'re too busy fighting for delicate work.' };

  // Refuse up front on skill/station/ingredients — nobody should wait out a
  // 23-second craft to be told they were never skilled enough. The resolve
  // re-checks, so this is a courtesy, not the authority.
  const ready = await checkCraftReady(player, recipe.id);
  if (!ready.ok) return { type:'error', message:ready.message };

  const ms = craftSeconds(recipe) * 1000;
  setPosture(player, 'crafting');
  player.craftState = { recipeId: recipe.id, name: recipe.name, completeAt: Date.now() + ms };
  sendToZone(
    player.current_zone,
    { type:'zone_event', message:`${player.handle} sets to work on something.` },
    player.id,
  );
  // `progressMs` tells the client to append an inline countdown bar to this
  // line; `progress done` (from clearCraft) strips it.
  return { type:'emote', message:`You set to work on ${recipe.name}.`, progressMs: ms };
}

registerActivity({
  posture: 'crafting',
  stateKey: 'craftState',
  onTick: async (player, st, nowMs) => {
    if (nowMs < st.completeAt) return;
    // Clear BEFORE resolving: attemptCraft awaits, and leaving the state in
    // place across those awaits would let the next sweep resolve it twice.
    clearCraft(player);
    const result = await attemptCraft(player, st.recipeId);
    sendToPlayer(player.id, {
      type: result.success ? 'craft' : 'error',
      message: result.message,
    });
  },
  // Posture was cleared out from under us (moved / attacked / stood / died).
  // Nothing has been consumed at this point — the craft simply never happened.
  onAbandon: (player) => clearCraft(player, 'You set your work aside, unfinished.'),
});

// The unified STOP command halts a craft like any other repeating action.
on('player.stop', ({ player, stopped }) => {
  if (getPosture(player) !== 'crafting') return;
  clearCraft(player); // the stop command prints the line, via `stopped`
  stopped.push('crafting');
});

export const commands = { craft: cmdCraft, recipes: cmdRecipes };
