// Tablet OS — Crafting app. A browser + launcher over the existing crafting and
// synthesis systems; it owns no crafting logic of its own. It lists the recipes
// you can make, routes you (GPS + auto-walk) to a required crafting bench, and —
// once you're at the bench (or the recipe needs none) — hands off to the REAL
// flow by firing the same `craft`/`cook`/`splice`/`roll` command a player would
// type. The cook minigame and splice designer open exactly as they do from the
// command line; nothing is reimplemented here.
//
// What shows up:
//   • Drug recipes (raw→processed cook) — KNOWN once you've done that drug at
//     least once (player_drug_state.times_used). Always listed thereafter; the
//     Cook button only enables when you hold the ingredients AND stand at a chem
//     lab. (Where the raws come from is deliberately never spelled out here.)
//   • Non-drug recipes — known the usual way: your skill meets the requirement.
//   • Rolling (joints / cigarettes) — the one drug craft that needs no lab; shows
//     when you carry the loose leaf.
//   • Splice Designer — master synthesis; shown when your Chemistry qualifies,
//     routing you to a chem lab.
//
// Bench rule: a bench is shown ONLY when a recipe specifies a station (all cooks
// need a chem lab). Rolling and stationless recipes read "No bench".
import { query } from '../../server/models/db.js';
import { getZone } from '../../server/engine/world.js';
import { findPath } from '../../server/engine/pathfinding.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getRecipeCache } from '../../server/engine/crafting.js';
import { skillStatBonus, effectiveSkill } from '../../server/engine/skills.js';
import { registerTabletApp } from './registry.js';

const SPLICE_MIN_SKILL = 6; // mirrors plugins/synthesis SPLICE_MIN_SKILL

// Loose-leaf → smokeable, mirroring plugins/rolling ROLLABLE (content item ids).
const ROLL = {
  cannabis: { loose: 'item_loose_cannabis', product: 'item_joint', label: 'Roll Joints', many: 'joints' },
  tobacco: { loose: 'item_loose_tobacco', product: 'item_cigarettes', label: 'Roll Cigarettes', many: 'cigarettes' },
};

// Player skill LEVELS (ip/100), matching cmdRecipes / cmdCook.
async function skillLevels(playerId) {
  const { rows } = await query('SELECT skill_id, ip FROM player_skills WHERE player_id=$1', [playerId]);
  const levels = {};
  for (const r of rows) levels[r.skill_id] = Math.floor((r.ip || 0) / 100);
  return levels;
}

// How many of each item the player holds (unequipped counts toward crafting).
async function inventoryCounts(playerId, itemIds) {
  if (!itemIds.length) return {};
  const { rows } = await query(
    'SELECT item_id, SUM(quantity) AS qty FROM player_inventory WHERE player_id=$1 AND item_id=ANY($2) GROUP BY item_id',
    [playerId, itemIds]
  );
  const have = {};
  for (const r of rows) have[r.item_id] = Number(r.qty) || 0;
  return have;
}

async function itemNames(ids) {
  if (!ids.length) return {};
  const { rows } = await query('SELECT id, name FROM items WHERE id=ANY($1)', [ids]);
  const by = {};
  for (const r of rows) by[r.id] = r.name;
  return by;
}

// Item ids that ARE drugs, and the subset the player has consumed at least once.
async function drugSets(playerId) {
  const [{ rows: all }, { rows: used }] = await Promise.all([
    query('SELECT item_id FROM drugs WHERE item_id IS NOT NULL'),
    query(`SELECT d.item_id FROM player_drug_state ps JOIN drugs d ON d.id=ps.drug_id
           WHERE ps.player_id=$1 AND ps.times_used>=1 AND d.item_id IS NOT NULL`, [playerId]),
  ]);
  return { drugItems: new Set(all.map(r => r.item_id)), consumed: new Set(used.map(r => r.item_id)) };
}

// Is there a bench of this station type in the given zone?
async function zoneHasStation(zoneId, station) {
  const { rows } = await query(
    `SELECT 1 FROM furniture WHERE zone_id=$1 AND flags->>'crafting_station'=$2 LIMIT 1`,
    [zoneId, station]
  );
  return rows.length > 0;
}

// Nearest reachable zone holding this station type → { zoneId, name, hops, path } | null.
async function nearestBench(player, station) {
  const { rows } = await query(
    `SELECT DISTINCT zone_id FROM furniture WHERE flags->>'crafting_station'=$1`,
    [station]
  );
  if (rows.some(r => r.zone_id === player.current_zone)) {
    const z = getZone(player.current_zone);
    return { zoneId: player.current_zone, name: z?.name || player.current_zone, hops: 0, path: [player.current_zone] };
  }
  let best = null;
  for (const { zone_id } of rows) {
    if (!getZone(zone_id)) continue;
    const path = findPath(player.current_zone, zone_id);
    if (path && path.length >= 2 && (!best || path.length < best.path.length)) {
      best = { zoneId: zone_id, name: getZone(zone_id).name || zone_id, hops: path.length - 1, path };
    }
  }
  return best;
}

function meetsSkill(recipe, levels, player) {
  for (const [sid, min] of Object.entries(recipe.skill_req || {})) {
    if ((levels[sid] || 0) + skillStatBonus(player, sid) < min) return false;
  }
  return true;
}

function isMissing(recipe, have) {
  return (recipe.ingredients || []).some(ing => ing.quantity > 0 && (have[ing.item_id] || 0) < ing.quantity);
}

// The recipes this player "knows": drug cooks unlock by having done the drug;
// everything else by meeting the skill requirement.
async function knownRecipes(player, levels, drugs) {
  return Object.values(getRecipeCache()).filter(r => {
    const out = r.base_output?.item_id;
    if (out && drugs.drugItems.has(out)) return drugs.consumed.has(out); // drug recipe → consumption-gated
    return meetsSkill(r, levels, player);
  }).sort((a, b) => (a.category || '').localeCompare(b.category || '') || (a.name || '').localeCompare(b.name || ''));
}

// ── Screens ──────────────────────────────────────────────────────────────────

async function buildScreen(player, screenId, params) {
  const id = (params || '').trim();
  const [levels, drugs] = await Promise.all([skillLevels(player.id), drugSets(player.id)]);

  // DETAIL
  if (id) {
    if (id === '_splice') return spliceDetail(player);
    if (id.startsWith('_roll_')) return rollingDetail(player, id.slice('_roll_'.length));
    const recipe = (await knownRecipes(player, levels, drugs)).find(r => r.id === id);
    if (!recipe) return { view: 'error', message: 'You no longer know that recipe.' };
    return recipeDetail(player, recipe, levels);
  }

  // ROOT — flat list.
  const recipes = await knownRecipes(player, levels, drugs);

  const allIds = new Set([ROLL.cannabis.loose, ROLL.tobacco.loose]);
  for (const r of recipes) {
    if (r.base_output?.item_id) allIds.add(r.base_output.item_id);
    for (const ing of (r.ingredients || [])) if (ing.item_id) allIds.add(ing.item_id);
  }
  const have = await inventoryCounts(player.id, [...allIds]);

  // Batch "am I at this station?" over the distinct required stations.
  const stations = [...new Set(recipes.map(r => r.requires_station).filter(Boolean))];
  const hereStation = {};
  for (const s of stations) hereStation[s] = await zoneHasStation(player.current_zone, s);

  const items = recipes.map(r => {
    const atBench = !r.requires_station || hereStation[r.requires_station];
    const badge = (r.requires_station && !atBench) ? 'bench' : (isMissing(r, have) ? 'missing' : 'ready');
    const status = badge === 'bench' ? 'Needs bench' : badge === 'missing' ? 'Missing materials' : 'Ready';
    const bench = r.requires_station ? ` · ${r.requires_station.replace(/_/g, ' ')}` : '';
    return { id: r.id, label: r.name, sub: `${r.category || 'misc'}${bench} — ${status}`, badge };
  });

  // Rolling — surfaced only while you carry the loose leaf (no lab needed).
  for (const [kind, t] of Object.entries(ROLL)) {
    const g = have[t.loose] || 0;
    if (g > 0) items.push({ id: `_roll_${kind}`, label: t.label, sub: `${g}g loose ${kind} → ${t.many} — Ready`, badge: 'ready' });
  }

  // Splice — master-tier chemistry, shown when you qualify by skill (routes to a lab).
  if (await effectiveSkill(player, 'chemistry') >= SPLICE_MIN_SKILL) {
    items.unshift({ id: '_splice', label: '⚗ Splice Designer', sub: 'Master synthesis · blend drug effects', badge: 'ready' });
  }

  return { view: 'list', breadcrumb: ['Crafting'], items };
}

async function recipeDetail(player, recipe, levels) {
  const ids = [];
  if (recipe.base_output?.item_id) ids.push(recipe.base_output.item_id);
  for (const ing of (recipe.ingredients || [])) if (ing.item_id) ids.push(ing.item_id);
  const [names, have] = await Promise.all([itemNames(ids), inventoryCounts(player.id, ids)]);

  const isCook = recipe.skill_id === 'chemistry';
  const station = recipe.requires_station || null;
  const atBench = station ? await zoneHasStation(player.current_zone, station) : true;
  const skillOk = meetsSkill(recipe, levels, player);
  const missing = isMissing(recipe, have);

  const reqRank = recipe.skill_req?.[recipe.skill_id];
  const rows = [
    { label: 'Skill', value: `${(recipe.skill_id || '?').replace(/_/g, ' ')}${reqRank ? ` (rank ${reqRank})` : ''}` },
    { label: 'Output', value: `${recipe.base_output?.quantity || 1}× ${names[recipe.base_output?.item_id] || recipe.base_output?.item_id || '?'}` },
    { label: 'Method', value: isCook ? 'Cook (minigame)' : 'Craft' },
    { label: 'Bench', value: station
        ? `${station.replace(/_/g, ' ')}${atBench ? ' — you are here ✓' : ' — travel required'}`
        : 'No bench — craft anywhere' },
  ];
  for (const ing of (recipe.ingredients || [])) {
    if (!ing.quantity) continue;
    const h = have[ing.item_id] || 0;
    rows.push({ label: names[ing.item_id] || ing.item_id, value: `${h}/${ing.quantity} ${h >= ing.quantity ? '✓' : '✗'}` });
  }

  // Craft/cook gating, in priority order: skill → travel → materials → go.
  const actions = [];
  if (!skillOk) {
    actions.push({ id: 'craft', label: `Needs ${(recipe.skill_id || 'skill').replace(/_/g, ' ')} rank ${reqRank || '?'}`, disabled: true });
  } else if (station && !atBench) {
    const bench = await nearestBench(player, station);
    if (bench) actions.push({ id: 'route', label: `Route to ${bench.name}${bench.hops ? ` (${bench.hops})` : ''}` });
    else actions.push({ id: 'route', label: 'No known bench', disabled: true });
  } else if (missing) {
    actions.push({ id: 'craft', label: 'Missing materials', disabled: true });
  } else {
    actions.push({ id: 'craft', label: isCook ? 'Cook' : 'Craft', launch: `${isCook ? 'cook' : 'craft'} ${recipe.name}` });
  }

  return {
    view: 'detail',
    breadcrumb: ['Crafting', recipe.name],
    detail: { id: recipe.id, name: recipe.name, desc: recipe.description || '', rows },
    actions,
  };
}

async function rollingDetail(player, kind) {
  const t = ROLL[kind];
  if (!t) return { view: 'error', message: 'Nothing to roll.' };
  const [names, have] = await Promise.all([itemNames([t.loose, t.product]), inventoryCounts(player.id, [t.loose])]);
  const g = have[t.loose] || 0;
  const rows = [
    { label: 'Method', value: 'Rolling' },
    { label: 'Bench', value: 'No bench — craft anywhere' },
    { label: 'Output', value: `${names[t.product] || t.product} (1 per gram)` },
    { label: names[t.loose] || t.loose, value: `${g}g on hand` },
  ];
  const actions = g > 0
    ? [{ id: 'craft', label: `Roll ${g}`, launch: `roll all ${kind}` }]
    : [{ id: 'craft', label: 'No loose leaf', disabled: true }];
  return {
    view: 'detail',
    breadcrumb: ['Crafting', t.label],
    detail: { id: `_roll_${kind}`, name: t.label, desc: `Roll loose ${kind} into ${t.many}. No lab needed.`, rows },
    actions,
  };
}

async function spliceDetail(player) {
  const station = 'chem_lab';
  const atBench = await zoneHasStation(player.current_zone, station);
  const rows = [
    { label: 'Skill', value: `chemistry (${SPLICE_MIN_SKILL}+)` },
    { label: 'Method', value: 'Splice designer (minigame)' },
    { label: 'Bench', value: `chem lab${atBench ? ' — you are here ✓' : ' — travel required'}` },
    { label: 'Needs', value: 'Two or more different processed drugs on hand' },
  ];
  const actions = [];
  if (atBench) actions.push({ id: 'craft', label: 'Open Splice Lab', launch: 'splice' });
  else {
    const bench = await nearestBench(player, station);
    if (bench) actions.push({ id: 'route', label: `Route to ${bench.name}${bench.hops ? ` (${bench.hops})` : ''}` });
    else actions.push({ id: 'route', label: 'No known lab', disabled: true });
  }
  return {
    view: 'detail',
    breadcrumb: ['Crafting', 'Splice'],
    detail: {
      id: '_splice', name: '⚗ Splice Designer',
      desc: "Break two or three drugs down to their effect-blocks and graft them into a new compound. Master's work — it needs a real chem lab.",
      rows,
    },
    actions,
  };
}

// ── Actions ──────────────────────────────────────────────────────────────────
// `craft` is launched client-side (the button carries a `launch` command that
// closes the tablet and fires the real verb). Only `route` is handled here: plot
// a GPS path to the nearest bench and flag it to auto-walk, then stay on the
// recipe so the button flips to Cook once the player arrives and re-opens it.
async function handleAction(player, actionId, params) {
  const id = (params || '').trim();
  if (actionId === 'route') {
    const station = id === '_splice' ? 'chem_lab' : (getRecipeCache()[id]?.requires_station || null);
    if (station) {
      const bench = await nearestBench(player, station);
      if (bench && bench.path && bench.path.length >= 2) {
        const dest = getZone(bench.zoneId);
        sendToPlayer(player.id, {
          type: 'gps_route',
          message: `GPS locked: ${dest?.name || bench.zoneId} — auto-walking to the bench.`,
          path: bench.path,
          autostart: true,
        });
      }
    }
    return buildScreen(player, null, id);
  }
  return buildScreen(player, null, id);
}

registerTabletApp({
  id: 'crafting', name: 'Crafting', icon: '⚙', category: 'General',
  buildScreen, handleAction,
});
