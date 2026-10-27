// Cooking — `heat <food|vessel>` at a stove (flags.stove_tier) in the room, or a
// carried portable oven (tags.portable_oven), turns raw/frozen food into
// something safe to eat. Background/lazy, no tick: see cook.js.
// Food with `tags.food_profile` gets a peak window, a burn point, handling and a
// quality band at `plate`; food without one is just raw, then cooked.
// `cook` is shared with synthesis (drug cooking); see cmdCook for the routing.
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { emit } from '../../server/engine/events.js';
import { getZoneFurniture, getZone, updateFurniture } from '../../server/engine/world.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../../server/engine/sift.js';
import { registerAction, dispatchAction, getRegisteredActions } from '../../server/engine/actions.js';
import { getZonePowerStatus } from '../../server/engine/environment.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { containerCapacity, containerContentsWeight } from '../../server/engine/commands/inventory.js';
import { tagValue, hasTag } from '../../server/engine/tags.js';
import { skillCheck, awardSkillUse, effectiveSkill } from '../../server/engine/skills.js';
import { grantSkillIp } from '../../server/engine/ip.js';
import { getItem } from '../../server/engine/items-cache.js';
import { isPluggedIn } from '../appliances/index.js';
import {
  STOVE_SPEED, PORTABLE_OVEN_SPEED, PORTABLE_OVEN_CAPACITY_G, FLUID_MEASURE_G, FLUID_DREGS_G,
  BARE_VESSEL, DEFAULT_VESSEL, cookingIpFor, SMOKER_SPEED, SMOKER_PROFILE, SKILL_WEIGHT, FOND_PROFILES, MAX_CHOP_PIECES, BUTTER_BONUS, BUTTER_PORTION, POUR_PORTION, MICROWAVE_SPEED,
  COOK_SECONDS_PER_KG, BAND_SCALE,
} from './config.js';
import { prepareCook, commitCooks, cookEnvironment, checkCooking, endSession, freeAppliance, sessionProfile, rescheduleNarration, cooksOnAppliances, forgetCook, rewetVessel, dryVessel } from './cook.js';
import { boiledFraction, waterText } from './boil.js';
import {
  MAX_LEVEL, TIER_BANDS, HEAT_ORDER, clampLevel, tierOfLevel, levelOfTier, speedOfLevel, levelText,
  ceilingLevel, burnerLevel, setBurnerLevel, apparentNow, realTimeFor, retuneSession, sessionRate, heatVerdict,
} from './heat.js';

// How long a ring stays held for a paused pan (gas off). A lapsed hold would
// declare the stove free with somebody's dinner still on it.
const PAUSED_HOLD_MS = 6 * 60 * 60 * 1000;
import { QUALITY_BANDS, PROFILES, bandIndex, profileNameFor, isModifier, isMedium, isFluid, POURABLE, needsPrep, donenessLevels, defaultDoneness, achievedDoneness } from './profiles.js';
import { evaluate } from './quality.js';
import { handle as handleInteraction } from './interact.js';
import './help.js';
import { leavesFond, makeFond, fondState, fondModifier, fondText } from './fond.js';
import { portionOf, canChop, portionName, yieldOf } from './portions.js';
import { timeline, finishAt, endStateAt, wantedTierAt } from './quality.js';
import { DISHES, signature, dishFor, dishName, composeBand, seasoningBonus, seasoningIdeal, nounFor, describeDish } from './dishes.js';
import { UNTRIED, cookbookState, learnRecipe, improveRecipe, recordAttempt, beatsRecorded, knownBonus, markRoutineIp,
         savedRecipes, saveRecipe, recipeBySignature, renameRecipe, forgetRecipe, improveSaved, slugify } from './knowledge.js';
import { recipeSignature, improvisedIp } from './improvised.js';
import { methodFor, methodNames } from './methods.js';
import { gatherHazards } from './hazards.js';
import { cmdRecipe, learnFromWrittenCard } from './recipes.js';
import { cmdShoplist, markShelf, markContainer } from './shoplist-cmd.js';
import { rewardFor, restMultiplier, restText, RESTS_WELL, REST_PEAK_MS, REST_COLD_MS, REST_MIN_MS, TASTE_TIERS, TASTE_BITE } from './config.js';
import { tasteNotes, flavourLines } from './taste.js';
import { canMarinate, prepText } from './prep.js';
import { workspaceProvider } from './workspace.js';
import { cmdKitchenStage, stageOpen, offerStage } from './stage.js';
import { KNIFE_TTL_MS, DRESS_PAR, DRESS_MAX, DRESS_TTL_MS } from './config.js';
import { matterFor, cutDifficulty } from '../../client/shared/kitchen-matter.js';
import { footprint, evenness, parseCut } from '../../client/shared/knife.js';
import { cmdWorkspace } from '../workspace/index.js';

const restPhase = cd => {
  if (!cd?.rests || !cd?.plated_at) return null;
  const age = Date.now() - cd.plated_at;
  if (age >= REST_COLD_MS) return 'cold';
  if (age >= REST_MIN_MS && age <= REST_PEAK_MS) return 'rested';
  return null;
};
import { DISCOVERY_IP, DISCOVERY_ATTEMPTS, MODIFIER_BONUS, MODIFIER_BONUS_CAP, OVER_SEASON_PENALTY, DEFAULT_SEASONING, STAGING,
         DISCOVERY_MIN_BAND, KNOWN_RECIPE_BONUS, RECIPE_MASTERY_IP, RECIPE_MASTERY_BAND } from './config.js';

// Any blade: `can_chop` is the kitchen tag, `butchering` is on every knife.
const chopTool = player => resolveInventoryItem(player, { tag: ['can_chop', 'butchering'], topLevel: true, fromNearby: true });

// Is the pan wet? The one predicate for the dry-starch gate, boil cue, fond and
// HUD. It asks about the pan, never the dish, so a medium counts.
export const hasCookingLiquid = rows => (rows || []).some(r => profileNameFor(r) === 'liquid');

// Drained pasta (`drain` stamps `cooked`) finishes in the sauce and must not
// need a wet pan, or the two-vessel method is refused.
export const needsBoiling = row => profileNameFor(row) === 'dry_starch' && !row?.custom_data?.cooked;

// Sound: cooking emits semantic `cooking.sfx` events and never a sound; the
// audio plugin owns the acoustics. Cooking only maps its profiles to materials.
const SFX_MATERIAL = {
  dense_meat: 'wet_meat',
  starchy_vegetable: 'hard_food',
  soft_vegetable: 'soft_food',
  fruit: 'soft_food',
  egg: 'soft_food',
  preserved: 'hard_food',
  liquid: 'liquid',
  fat_or_oil: 'fat',
  aromatic: 'soft_food',
  batter: 'dough',
  bread: 'bread',
  dairy: 'dairy',
};
// `tags.sound_material` is a sparse override for real outliers (a bone, a shell);
// don't author it per food.
const sfxMaterial = row => tagValue(row, 'sound_material', null) || SFX_MATERIAL[profileNameFor(row)] || 'soft_food';

// Frozen is the one state worth a sound; same environment `prepareCook` reads.
async function sfxState(row, player) {
  if (row?.custom_data?.cooked) return 'cooked';
  const env = await cookEnvironment({ ...row, id: row.inv_id ?? row.id }, player).catch(() => null);
  if (!env) return null;
  return (env.delivering ? env.tier : env.ambientTier) === 'frozen' ? 'frozen' : null;
}

const cookSfx = (player, params) =>
  emit('cooking.sfx', { zoneId: player?.current_zone, playerId: player?.id, ...params });

const nounOf = row => nounFor(row, tagValue);

// The name the player was shown: per-instance `custom_data.name` beats the catalog.
const shownName = row => row?.custom_data?.name || row?.name;

const DISH_ITEM = 'item_cooked_dish';

// ⚠ A zone can be its own fire (`flags.stove_tier`), because a transient zone can
// never hold furniture (see `waterSourceIn`). Appended, so a real stove still wins.
function stovesInZone(zoneId) {
  const out = getZoneFurniture(zoneId).filter(f => f.flags?.stove_tier);
  const z = getZone(zoneId);
  const tier = z?.flags?.stove_tier;
  if (tier) out.push({ id: `zonefire_${zoneId}`, zone_id: zoneId, name: z.name, flags: { stove_tier: tier } });
  return out;
}
// A microwave is its own appliance, not a stove tier (see MICROWAVE_* in config).
function microwavesInZone(zoneId) {
  return getZoneFurniture(zoneId).filter(f => f.flags?.microwave);
}
function labsInZone(zoneId) {
  return getZoneFurniture(zoneId).filter(f => f.flags?.crafting_station);
}

// Every "cook" surface in the room, tagged with the owning system, for SIFT.
function cookStations(zoneId) {
  return [
    ...stovesInZone(zoneId).map(f => ({ ...f, _cookKind: 'food' })),
    ...labsInZone(zoneId).map(f => ({ ...f, _cookKind: 'drug' })),
  ];
}

const hasSynthesis = () => getRegisteredActions().includes('synthesis.cook');
const toDrugs = (player, recipe, broadcast) =>
  dispatchAction({ type: 'synthesis.cook', actor: player, params: { recipe, broadcast } });
// STAGING: a busy stove already holding this vessel wins, so staggered
// ingredients can peak together. Otherwise any free one.
function findFreeStove(stoves, vesselInvId = null) {
  const now = Date.now();
  if (STAGING && vesselInvId) {
    const holding = stoves.find(f => f.flags?.vessel_id === vesselInvId);
    if (holding) return holding;
  }
  return stoves.find(f => !f.flags?.busy_until || f.flags.busy_until <= now) || null;
}

// The dial on one hob. ⚠ `stove_tier` is the ceiling that clamps the dial, not
// the setting; read heat through here, never from the tier.
export function burnerOf(stoveRow) {
  const ceilingTier = stoveRow?.flags?.stove_tier || 'low';
  const level = Math.min(burnerLevel(stoveRow.id, ceilingTier), ceilingLevel(ceilingTier));
  return { level, tier: tierOfLevel(level), speed: speedOfLevel(level), ceilingTier, ceiling: ceilingLevel(ceilingTier) };
}

// d widens the peak window, r widens the forgiving band past it.
export function vesselStats(vesselRow) {
  if (!vesselRow) return BARE_VESSEL;
  return {
    d: Number(tagValue(vesselRow, 'heat_distribution', DEFAULT_VESSEL.d)),
    r: Number(tagValue(vesselRow, 'heat_retention', DEFAULT_VESSEL.r)),
  };
}

async function vesselContents(vesselInvId) {
  const { rows } = await query(
    `SELECT pi.id AS inv_id, pi.item_id, pi.quantity, pi.custom_data, pi.container_id,
            i.name, i.weight, i.tags
       FROM player_inventory pi JOIN items i ON i.id=pi.item_id
      WHERE pi.container_id=$1 ORDER BY i.name`,
    [vesselInvId]
  );
  return rows;
}

// `cook` is shared with synthesis. Target-first: a carried cookable is food,
// anything else is a recipe. Bare `cook` with a stove and a lab gets a SIFT prompt.
async function cmdCook(args, raw, player, broadcast) {
  const nameStr = args.join(' ').trim();

  if (!nameStr) {
    const stations = cookStations(player.current_zone);
    const kinds = new Set(stations.map(s => s._cookKind));
    if (!stations.length) return { type: 'error', message: `There's nothing here to cook on.` };
    if (kinds.size > 1) {
      createSelectionState(player.id, stations, { dispatchType: 'cooking.station_choice', dispatchParam: 'target' });
      return {
        type: 'output',
        message: `Cook on which?\n${formatSelectionPage({ allCandidates: stations, visibleIndex: 0, pageSize: 5 })}`,
      };
    }
    // Bare `cook` at a stove opens the kitchen HUD (every action on it is a verb).
    if (kinds.has('drug') && hasSynthesis()) return toDrugs(player, null, broadcast);
    return (await cmdWorkspace(['kitchen'], '', player)) || { type: 'error', message: 'Cook what?' };
  }

  // `cook text`: the written HUD. Must run before station resolution or it falls
  // through to synthesis; only with a food station, so a lab keeps `cook <recipe>`.
  if (nameStr.toLowerCase() === 'text' && cookStations(player.current_zone).some(s => s._cookKind === 'food')) {
    return (await cmdWorkspace(['kitchen', 'text'], '', player)) || { type: 'error', message: 'Cook what?' };
  }

  const stations = cookStations(player.current_zone);
  if (stations.length > 1) {
    const s = siftResolve(nameStr, stations);
    if (s.type === 'match' && s.candidate._cookKind === 'drug' && hasSynthesis()) return toDrugs(player, null, broadcast);
    if (s.type === 'match' && s.candidate._cookKind === 'food') {
      return (await cmdWorkspace(['kitchen'], '', player)) || { type: 'error', message: 'Cook what?' };
    }
  }

  const carried = await resolveInventoryItem(player, { name: nameStr, tag: ['needs_cooking', 'vessel'], topLevel: true, fromNearby: true });
  if (!carried && hasSynthesis()) return toDrugs(player, nameStr, broadcast);
  return cookFood(nameStr, player, broadcast);
}

// ⚠ A ring at zero is lit, not refused: `cook` relights it at the stove's
// resting tier.
async function relight(stove) {
  const b = burnerOf(stove);
  if (b.level <= 0) await applyBurner(stove, levelOfTier(b.ceilingTier));
}

function stoveAppliance(stove) {
  let b = burnerOf(stove);
  // ⚠ A floor, not the relight (only `relight` retunes the ring): keeps speed 0,
  // an infinite cook, from ever reaching `prepareCook`.
  if (b.level <= 0) { setBurnerLevel(stove.id, levelOfTier(b.ceilingTier)); b = burnerOf(stove); }
  return {
    id: stove.id, name: stove.name, heatTier: b.tier, heatLevel: b.level,
    speed: b.speed, furnitureRow: stove,
  };
}

// Every heat source in the room, so a player can name the one they mean.
function cookAppliances(zoneId) {
  return [
    ...stovesInZone(zoneId).map(f => ({ ...f, _kind: 'stove' })),
    ...microwavesInZone(zoneId).map(f => ({ ...f, _kind: 'microwave' })),
  ];
}

async function cookFood(nameStr, player, broadcast, wantAppliance = null) {
  // "cook X in|on <appliance>": accepted only if the tail matches an appliance,
  // since `in` is also the vessel idiom; otherwise the whole string is the food.
  const split = nameStr.match(/^(.*?)\s+(?:in|on)\s+(?:the\s+)?(.+)$/i);
  if (split && !wantAppliance) {
    const here = cookAppliances(player.current_zone);
    const hit = here.length ? siftResolve(split[2].trim(), here) : null;
    if (hit?.type === 'match') return cookFood(split[1].trim(), player, broadcast, hit.candidate);
  }

  // `cook <vessel>` puts the pan and everything in it on the heat; `cook <food>`
  // puts the food straight on the stove, which works but cooks worse.
  const vessel = await resolveInventoryItem(player, { tag: 'vessel', name: nameStr, topLevel: true, fromNearby: true });
  let foods;
  // Whole pan incl. medium, kept in scope for the starch gate and boil cue.
  let contents = [];
  if (vessel) {
    contents = await vesselContents(vessel.inv_id);
    // Anything profiled cooks, except modifiers (season, never burn away) and
    // a medium (water must never reach `burnt`).
    foods = contents
      .filter(r => (hasTag(r, 'needs_cooking') || profileNameFor(r)) && !isModifier(r) && !isMedium(r));
    // An edible vessel (bread) is an ingredient; other vessels are equipment.
    if (hasTag(vessel, 'edible_vessel') && profileNameFor(vessel)) {
      foods.push({ ...vessel, container_id: null });
    }
    if (!foods.length) return { type: 'error', message: `There's nothing in the ${vessel.name} worth heating.` };

    // Prep: combining whole things needs a knife; cooking one thing alone doesn't,
    // so this gates the vessel path only.
    const prepWork = foods.filter(needsPrep);
    if (prepWork.length && !(await chopTool(player))) {
      return { type: 'error', message: `You can't do anything with ${prepWork[0].name} bare-handed. You need a knife.` };
    }
  } else {
    const foodRow = await resolveInventoryItem(player, { name: nameStr, topLevel: true });
    if (!foodRow) return { type: 'error', message: `You don't have "${nameStr}".` };
    foods = [foodRow];
  }

  // Dry starch cooks in liquid, not heat: the one profile that refuses, being
  // inedible raw. Any liquid will do; drained pasta is exempt (`needsBoiling`).
  const starch = foods.filter(needsBoiling);
  if (starch.length && !hasCookingLiquid(contents)) {
    return { type: 'error', message: vessel
      ? `Dry ${starch[0].name} in a dry ${vessel.name} will scorch, not cook. It needs liquid: <span class="text-dim">fill ${vessel.name}</span> at a tap, or put stock in it.`
      : `${starch[0].name} doesn't cook in heat, it cooks in water. It needs a pot with something wet in it.` };
  }

  const stoves = stovesInZone(player.current_zone);
  const microwaves = microwavesInZone(player.current_zone);
  let appliance = null;

  // A stove and a microwave in one room: ask via SIFT (two stoves aren't worth asking).
  if (!wantAppliance && stoves.length && microwaves.length) {
    // Selection dispatch forwards only the candidate, so the food rides on it.
    const options = cookAppliances(player.current_zone).map(f => ({ ...f, _food: nameStr }));
    createSelectionState(player.id, options, {
      dispatchType: 'cooking.appliance_choice', dispatchParam: 'target',
    });
    return {
      type: 'output',
      message: `Cook it on which?\n${formatSelectionPage({ allCandidates: options, visibleIndex: 0, pageSize: 5 })}`,
    };
  }

  if (wantAppliance) {
    const f = wantAppliance;
    if (f.flags?.busy_until && f.flags.busy_until > Date.now() && f.id !== (vessel && stoves.find(s => s.flags?.vessel_id === vessel.inv_id)?.id)) {
      return { type: 'error', message: `The ${f.name} is already in use.` };
    }
    if (f.power_draw_kw != null) {
      const powered = ['powered', 'overloaded'].includes(getZonePowerStatus(player.current_zone));
      if (!powered || !isPluggedIn(f)) {
        return { type: 'error', message: `The ${f.name} is dead. No power reaching it.` };
      }
    }
    if (f._kind !== 'microwave') await relight(f);
    appliance = f._kind === 'microwave'
      ? { id: f.id, name: f.name, heatTier: 'high', speed: MICROWAVE_SPEED, furnitureRow: f, microwave: true, runMs: f._runMs || null }
      : stoveAppliance(f);
  } else if (!stoves.length && microwaves.length) {
    const oven = microwaves.find(f => !f.flags?.busy_until || f.flags.busy_until <= Date.now());
    if (!oven) return { type: 'error', message: `The ${microwaves[0].name} is already running.` };
    if (oven.power_draw_kw != null) {
      const powered = ['powered', 'overloaded'].includes(getZonePowerStatus(player.current_zone));
      if (!powered || !isPluggedIn(oven)) {
        return { type: 'error', message: `The ${oven.name} is dead. No power reaching it.` };
      }
    }
    appliance = {
      id: oven.id, name: oven.name, heatTier: 'high', speed: MICROWAVE_SPEED,
      furnitureRow: oven, microwave: true,
    };
  } else if (stoves.length) {
    const stove = findFreeStove(stoves, vessel?.inv_id || null);
    if (!stove) return { type: 'error', message: `Every stove here is already in use.` };
    if (stove.power_draw_kw != null) {
      const powered = ['powered', 'overloaded'].includes(getZonePowerStatus(player.current_zone));
      if (!powered || !isPluggedIn(stove)) {
        return { type: 'error', message: `The ${stove.name} clicks but doesn't heat: no power reaching it.` };
      }
    }
    await relight(stove);
    appliance = stoveAppliance(stove);
  } else {
    const oven = await resolveInventoryItem(player, { tag: 'portable_oven', topLevel: true });
    if (!oven) return { type: 'error', message: `There's no stove here, and you're not carrying a portable oven.` };
    appliance = {
      id: oven.inv_id, name: oven.name, heatTier: 'low', speed: PORTABLE_OVEN_SPEED,
      capacityG: tagValue(oven, 'oven_capacity_g', PORTABLE_OVEN_CAPACITY_G),
    };
  }

  if (vessel) {
    // The vessel's own capacity applies alongside the appliance's; the tighter wins.
    const vesselCap = Number(tagValue(vessel, 'container', Infinity));
    const cap = Math.min(appliance.capacityG ?? Infinity, vesselCap);
    // Wet: read from the pan's actual contents, so the session can boil it away.
    const wet = (await vesselContents(vessel.inv_id)).some(isMedium);
    // ⚠ Staging joins a pot already boiling: inherit the earliest water clock on
    // that ring, or the newer session reports a full pot.
    const already = cooksOnAppliances([appliance.id])
      .filter(c => c.session?.vesselId === vessel.inv_id && c.session.wet)
      .map(c => c.session.wet.since);
    Object.assign(appliance, {
      vessel: vesselStats(vessel), vesselName: vessel.name, vesselId: vessel.inv_id,
      wet, ...(already.length ? { wetSince: Math.min(...already) } : {}),
    });
    if (Number.isFinite(cap)) appliance.capacityG = cap;
  }

  // The batch shares one container, so resolve the environment once.
  const sample = { ...foods[0], id: foods[0].inv_id ?? foods[0].id };
  const env = await cookEnvironment(sample, player);

  const messages = [];
  const prepared = [];
  for (const row of foods) {
    const food = { ...row, id: row.inv_id ?? row.id, player_id: player.id };
    const r = prepareCook(food, { ...appliance, profileName: profileNameFor(food) }, env);
    if (r.error) { messages.push(r.error); continue; }
    prepared.push(r);
    messages.push(r.message);
  }
  if (!prepared.length) return { type: 'error', message: messages.join('\n') };

  // A microwave with no time set runs exactly as long as the food needs.
  if (appliance.microwave && !appliance.runMs) {
    appliance.runMs = Math.max(...prepared.map(p => p.totalMs), 1000);
    for (const p of prepared) p.session.stopAt = p.session.startedAt + appliance.runMs;
  }
  await commitCooks(prepared, appliance);

  // Food meeting heat; `heat` is the burner tier.
  const loudest = prepared.map(p => p.session).find(Boolean);
  if (loudest) {
    if (appliance.microwave) {
      cookSfx(player, { action: 'microwave', intensity: 0.6, flow: 3 });
    } else {
      // A wet pan boils: read off the pan, since the medium has no session.
      const wet = loudest.profile === 'liquid' || hasCookingLiquid(contents);
      const tier = { low: 0.35, mid: 0.6, high: 0.9 }[appliance.heatTier] ?? 0.5;
      cookSfx(player, {
        action: wet ? 'boil' : 'sizzle',
        material: SFX_MATERIAL[loudest.profile] || 'wet_meat',
        heat: tier,
      });
    }
  }

  broadcast?.(player.current_zone, { type: 'zone_event', message: `${player.handle} starts cooking something.` }, player.id);
  const dial = appliance.microwave
    ? `\n<span class="text-dim">The dial is set to ${Math.round(appliance.runMs / 1000)} seconds. It starts turning.</span>`
    : '';
  // A rack pan is used in place, never moved to inventory, so say where it came from.
  const pulled = vessel?.from_nearby
    ? `<span class="text-dim">You take the ${vessel.name} down from the ${vessel.from_nearby}.</span>\n`
    : '';
  return { type: 'output', message: pulled + messages.join('\n') + dial };
}

// ── methods: `boil noodles`, `roast the shoulder` ────────────────────────────
//
// See methods.js. ⚠ Every step is a call to the function its verb calls
// (`fillVessel`, `placeInVessel`, `cookFood`, `cmdStove`). Never put cooking
// logic here, or it becomes a second cooking system. The dim trail prints the
// verbs it ran so players learn the long way round.

// ⚠ The unnamed pick is carried cookware only: `fromNearby` reaches the rack
// only when nothing is carried, which would make the rule depend on your pack.
// Naming the pan reaches the rack.
async function vesselOfKind(player, kind) {
  const all = await resolveInventoryItem(player, { tag: 'vessel', topLevel: true, all: true });
  const rows = Array.isArray(all) ? all : (all ? [all] : []);
  const ofKind = rows.filter(v => tagValue(v, 'vessel_kind', null) === kind);
  // An empty one first; never cook into somebody's sauce unasked.
  for (const v of ofKind) {
    const contents = await vesselContents(v.inv_id);
    if (!contents.length) return v;
  }
  return ofKind[0] || null;
}

async function runMethod(key, args, player, broadcast) {
  const method = methodFor(key);
  let nameStr = args.join(' ').trim();
  if (!nameStr) return { type: 'error', message: `${method.gerund} what?` };

  // "boil noodles in the stock pot": split only if the tail is real cookware,
  // so "meat in gravy" stays a food name.
  let vessel = null;
  const split = nameStr.match(/^(.*?)\s+(?:in|on)\s+(?:the\s+)?(.+)$/i);
  if (split) {
    const named = await resolveInventoryItem(player, { tag: 'vessel', name: split[2].trim(), topLevel: true, fromNearby: true });
    if (named) { vessel = named; nameStr = split[1].trim(); }
  }

  const steps = [];

  // Naming a vessel is the instruction: the food is already in it.
  let food = null;
  if (!vessel) {
    vessel = await resolveInventoryItem(player, { tag: 'vessel', name: nameStr, topLevel: true, fromNearby: true });
    if (!vessel) {
      food = await resolveInventoryItem(player, { name: nameStr, topLevel: true });
      if (!food) return { type: 'error', message: `You don't have "${nameStr}".` };
      // Grill and toast want no pan.
      if (method.vessel) {
        vessel = await vesselOfKind(player, method.vessel);
        if (!vessel) {
          return { type: 'error', message: `${method.needs}, and you haven't got one out. `
            + `<span class="text-dim">If there's one on the rack, name it: "${key} ${nameStr} in &lt;pan&gt;".</span>` };
        }
      }
    }
  } else if (nameStr) {
    food = await resolveInventoryItem(player, { name: nameStr, topLevel: true });
    // Already in the pan (a half-run method leaves it there): find it, don't refuse.
    if (!food) {
      const inside = (await vesselContents(vessel.inv_id))
        .find(r => new RegExp(nameStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(shownName(r) || ''));
      if (!inside) return { type: 'error', message: `You don't have "${nameStr}".` };
    }
  }

  // ⚠ Nothing moves until the cheap refusals (water, a stove) have run, or a
  // refused `boil` silently leaves the food in a pot. A refusal only `cook` knows
  // is reported with the setup it left. Any liquid already in counts as water.
  const needsWater = !!(method.medium && vessel)
    && !hasCookingLiquid(await vesselContents(vessel.inv_id));
  if (needsWater && !(await waterSourceIn(player.current_zone))) {
    return { type: 'error', message: method.dry };
  }
  if (!cookStations(player.current_zone).length) {
    return { type: 'error', message: `There's nothing here to cook on.` };
  }

  // Water first; it's the one ingredient a method fetches.
  if (needsWater) {
    const filled = await fillVessel([vessel.name], '', player);
    if (!filled || filled.type === 'error') return filled || { type: 'error', message: method.dry };
    steps.push(`fill ${vessel.name}`);
  }

  if (food && vessel) {
    const load = await placeInVessel(player, food, vessel);
    if (load.type === 'error') return load;
    steps.push(`stow ${shownName(food)} in ${vessel.name}`);
  }

  const target = vessel ? vessel.name : nameStr;
  const cooked = await cookFood(target, player, broadcast);
  if (cooked?.type === 'error') {
    // No rollback: report the laid-out setup instead.
    return steps.length
      ? { ...cooked, message: `${cooked.message}\n<span class="text-dim">The ${vessel.name} is laid out ready: ${steps.join(' · ')}.</span>` }
      : cooked;
  }
  steps.push(`cook ${target}`);

  // The burner is a request: a refusal is dropped. Must come after `cook`,
  // since it writes to live sessions.
  const heat = await cmdStove([method.heat], '', player);
  if (heat?.type !== 'error') steps.push(`stove ${method.heat}`);

  const head = `<span class="text-bright">${method.gerund} ${vessel ? `in the ${vessel.name}` : nameStr}.</span>`;
  const trail = steps.length
    ? `\n<span class="text-dim">The long way round: ${steps.join(' · ')}</span>`
    : '';
  return { type: cooked?.type || 'output', message: `${head}\n${cooked?.message || ''}${trail}` };
}

// One closure per method, so the handler knows its verb without reading `raw`.
const methodCommands = Object.fromEntries(
  methodNames().map(k => [k, (args, raw, player, broadcast) => runMethod(k, args, player, broadcast)]),
);

// Take it off the heat. Quality is decided here, lazily, from the session's
// timestamps and recorded acts.
async function cmdPlate(args, raw, player) {
  const nameStr = args.join(' ').trim();
  if (!nameStr) return { type: 'error', message: 'Plate what?' };

  // `plate <vessel>` makes one dish of its contents.
  const vessel = await resolveInventoryItem(player, { tag: 'vessel', name: nameStr, topLevel: true, fromNearby: true });
  if (vessel) return plateVessel(vessel, player);

  const food = await resolveInventoryItem(player, { name: nameStr, topLevel: false });
  if (!food) return { type: 'error', message: `You don't have "${nameStr}".` };

  const session = food.custom_data?.cooking;
  if (!session) return { type: 'error', message: `${food.name} isn't on the heat.` };
  const profile = sessionProfile(session);

  // Unprofiled food has no window or bands.
  if (!profile) {
    if (apparentNow(session) < finishAt(session)) return { type: 'error', message: `${food.name} isn't done yet.` };
    await freeAppliance(session);
    await endSession(food.inv_id, null);
    return { type: 'output', message: `You take ${food.name} off the heat.` };
  }

  const check = await skillCheck(player, 'cooking', profile.difficulty);
  const now = Date.now();
  // One component, so a platter never pays here.
  const plating = await platingBonus(player, 1);
  const result = evaluate(session, profile, now, check.margin + plating.bonus);
  const done = plateDoneness(session, profile, now);

  const smoked = session.smoking
    ? { profile: SMOKER_PROFILE, name: `smoked ${nounOf(food)}`, noun: `smoked ${nounOf(food)}` }
    : null;

  // A browned component stays finishable.
  const isComponent = !!food.custom_data?.crafted_quality;

  // Every taste was a mouthful, on a lone cut as on a pot.
  const bites = Number(food.custom_data?.tasted) || 0;
  const tasteYield = bites ? Math.max(0.4, 1 - bites * TASTE_BITE) : 1;

  await freeAppliance(session);
  if (!(await endSession(food.inv_id, result.band, done, smoked, isComponent,
    tasteYield !== 1 ? { yield: tasteYield } : {}))) {
    return { type: 'error', message: `${food.name} is no longer on the heat.` };
  }

  // Margin-shaped roll (grinding trivial cooks pays poorly); the flat IP pays for excelling.
  await awardSkillUse(player.id, 'cooking', check.margin);
  const { lastIpAt } = await cookbookState(player.id);
  const award = cookingIpFor(result.band, lastIpAt, now);
  if (award.ip) await grantSkillIp(player.id, 'cooking', award.ip);
  if (award.resets) await markRoutineIp(player.id, now);

  const label = result.band[0].toUpperCase() + result.band.slice(1);
  const asked = session.target || defaultDoneness(profile);
  const missed = done && asked && done !== asked ? ` You asked for ${asked}.` : '';
  const verdict = result.endState === 'burnt'
    ? `You scrape ${food.name} off the heat. Burnt.`
    : `You plate ${food.name}${done ? `, ${done}` : ''}. It's ${label}.${missed}`;
  // No plating flourish on a burnt dish.
  const flourish = (plating.note && result.endState !== 'burnt')
    ? `\n<span class="text-dim">${plating.note}</span>` : '';
  return { type: 'output', message: verdict + flourish };
}

// The doneness actually produced (not the one asked for).
// ⚠ Converts wall time to cook time inside (like quality.js), so time off the
// heat doesn't count; callers pass `Date.now()`.
function plateDoneness(session, profile, now) {
  if (!donenessLevels(profile)) return null;
  const app = apparentNow(session, now);
  const cookStart = session.startedAt + (session.thawMs || 0);
  const fraction = session.cookMs > 0 ? (app - cookStart) / session.cookMs : 1;
  return achievedDoneness(profile, fraction);
}

// A vessel becomes one dish: each ingredient scored as if alone, the dish
// composed from those bands under the template's ceiling.
async function plateVessel(vessel, player) {
  const [contents, { known, progress, lastIpAt }] = await Promise.all([
    vesselContents(vessel.inv_id),
    cookbookState(player.id),
  ]);
  const kind = tagValue(vessel, 'vessel_kind', null);
  const isBowl = kind === 'bowl';
  const isBread = kind === 'bread';
  // Cold work (bowl, bread): assembled, not heated, so scored at the RAW target.
  const coldWork = isBowl || isBread;
  const cooking = contents.filter(r => r.custom_data?.cooking);

  // Bread can be toasted: exclude anything with a session or it scores twice.
  const rawWorked = coldWork
    ? contents.filter(r => profileNameFor(r) && !isModifier(r) && !isMedium(r) && !r.custom_data?.cooking)
    : [];
  if (!cooking.length && !coldWork) return { type: 'error', message: `Nothing in the ${vessel.name} is on the heat.` };
  if (coldWork) {
    if (!rawWorked.length) {
      return { type: 'error', message: isBread
        ? `There's nothing on the ${vessel.name}. Bread on its own is just bread.`
        : `There's nothing in the ${vessel.name} to work with.` };
    }
    // A bowl needs a masher; bread needs only hands.
    if (isBowl) {
      const masher = await resolveInventoryItem(player, { tag: 'can_stir', topLevel: true, fromNearby: true });
      if (!masher) return { type: 'error', message: `You need something to mash with: a pestle, a spoon, anything.` };
    }
    // Cold work never sees heat, so its prep check lands here instead of at `cook`.
    const toChop = rawWorked.filter(needsPrep);
    if (toChop.length && !(await chopTool(player))) {
      return { type: 'error', message: `${toChop[0].name} needs chopping first, and you have no knife.` };
    }
  }

  // Modifiers are unscored but count toward the dish match and are consumed.
  const modifiers = contents.filter(r => isModifier(r));
  // ⚠ The medium stays out of `inVessel` (signature, bands, name) but is consumed.
  const medium = contents.filter(r => isMedium(r));

  // An edible vessel (bread) is scored, named off and eaten with the dish.
  const edibleVessel = hasTag(vessel, 'edible_vessel') && profileNameFor(vessel)
    ? { ...vessel, custom_data: vessel.custom_data || {} }
    : null;
  if (edibleVessel) (edibleVessel.custom_data.cooking ? cooking : rawWorked).push(edibleVessel);

  const inVessel = [...cooking, ...rawWorked, ...modifiers];
  const sig = signature(inVessel, profileNameFor);
  // Item ids too, since named dishes anchor on specific items. The fall-through
  // (authored, improvised, sandwich, slop) lives only in `dishFor`.
  const { template, key, improvised } = dishFor(sig, kind, new Set(inVessel.map(r => r.item_id)), { isBread });

  // A saved recipe matches on signature, never name.
  const savedBook = improvised ? await savedRecipes(player.id) : new Map();
  const mine = improvised ? recipeBySignature(savedBook, recipeSignature(sig, kind)) : null;

  // One skill check for the dish, not per ingredient.
  const check = await skillCheck(player, 'cooking', template.difficulty);
  const now = Date.now();
  const bands = [];
  let dishDoneness = null;
  for (const row of cooking) {
    const profile = sessionProfile(row.custom_data.cooking);
    bands.push(profile ? evaluate(row.custom_data.cooking, profile, now, check.margin).band : 'poor');
    // The dish takes the doneness of whatever has one (the meat in a stew).
    if (!dishDoneness && profile) dishDoneness = plateDoneness(row.custom_data.cooking, profile, now);
  }
  // Worked raw: the profile's raw target, unless already cooked (keeps its band).
  for (const row of rawWorked) {
    bands.push(row.custom_data?.cook_quality || PROFILES[profileNameFor(row)].targets.raw);
  }

  // Every taste comes off the yield.
  const tastes = inVessel.reduce((a, r) => a + (Number(r.custom_data?.tasted) || 0), 0);
  const dishYield = Math.max(0.4, yieldOf([...cooking, ...rawWorked]) - tastes * TASTE_BITE);
  // Seasoning: bonus up to the ideal, penalty past it, counted in portions.
  const seasoning = seasoningBonus(template, modifiers.reduce((a, r) => a + portionOf(r), 0));
  // With no timeline to score against, cold work leans on the cook's hands.
  const handWork = coldWork ? SKILL_WEIGHT * Math.max(-1, Math.min(1, check.margin / 20)) : 0;
  // Butter on heated rows pays through the session; only sessionless rows pay
  // here, so nothing is paid twice.
  const butterBonus = inVessel.some(r => r.custom_data?.buttered && !r.custom_data?.cooking) ? BUTTER_BONUS : 0;
  // Liquid lifts fond: drives both this dish's bonus and whether the pan keeps
  // fond after. The medium counts here (a fact about the pan).
  const hadLiquid = inVessel.some(r => profileNameFor(r) === 'liquid') || medium.length > 0;
  const fondBonus = fondModifier(vessel.custom_data?.fond, {
    deglazed: !!vessel.custom_data?.deglazed, hadLiquid, template,
  });
  // A component made badly caps what it can become, however well you cook it.
  const craftedCap = inVessel
    .map(r => r.custom_data?.crafted_quality)
    .filter(Boolean)
    .reduce((lo, q) => (lo === null || bandIndex(q) < bandIndex(lo) ? q : lo), null);
  const capped = craftedCap && bandIndex(craftedCap) < bandIndex(template.ceiling)
    ? { ...template, ceiling: craftedCap } : template;
  // ⚠ Plating is rewarded, never required: `plate` ends a cook, so it must
  // never need a plate.
  const plating = await platingBonus(player, inVessel.length);
  // Laid out on the Stage's pass first (`dressresolve`): only on real dishware.
  const dressed = plating.improvised ? 0 : dressBonus(vessel.custom_data?.dressed, now);
  const band = composeBand(bands, capped,
    (key ? knownBonus(known, key) : 0) + (mine ? KNOWN_RECIPE_BONUS : 0)
    + seasoning + handWork + fondBonus + butterBonus + plating.bonus + dressed);
  // The player's own recipe name wins over the generated one.
  const name = mine ? mine.name : dishName(template, inVessel, profileNameFor, tagValue);

  if (cooking.length) await freeAppliance(cooking[0].custom_data.cooking);
  // ⚠ These rows are deleted, not ended, so forget them here or their timers
  // fire into a void and `smell` reports a plated pot.
  for (const row of inVessel) forgetCook(row.inv_id);

  // One dish item for every dish; the name rides on custom_data.name.
  // An intermediate is an ingredient: not cooked, its band a ceiling downstream.
  const intermediate = template.output || null;
  const produced = intermediate ? intermediate.item : DISH_ITEM;
  // ⚠ Carry ingredient hazards onto the dish (and intermediates), or plating
  // launders them.
  const hazards = gatherHazards(inVessel);
  const stamp = intermediate
    ? { crafted_quality: band, dish: key, ...(hazards ? { hazards } : {}) }
    : {
        name, dish: key || 'unknown', cook_quality: band, cooked: true,
        // Improvised only: what `save recipe` needs later.
        ...(improvised ? { improv: recipeSignature(sig, kind), family: improvised.family, complexity: improvised.complexity } : {}),
        // Carry-over cooking derives from this alone (no temperature model).
        plated_at: now,
        ...(inVessel.some(r => RESTS_WELL.includes(profileNameFor(r))) ? { rests: true } : {}),
        // Partial portions make a smaller meal, or chopping would multiply dinners.
        ...(dishYield !== 1 ? { yield: dishYield } : {}),
        ...(dishDoneness ? { doneness: dishDoneness } : {}),
        ...(hazards ? { hazards } : {}),
      };

  // ⚠ The dish exists only if this call removed the ingredients (two platers race).
  const consumedIds = [...inVessel, ...medium].map(r => r.inv_id);
  const plated = await query(
    `WITH consumed AS (DELETE FROM player_inventory WHERE id = ANY($1) RETURNING 1)
     INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, custom_data)
     SELECT $2, $3, $4, 1, 1.0, $5::jsonb
      WHERE (SELECT count(*) FROM consumed) > 0`,
    [consumedIds, randomUUID(), player.id, produced, JSON.stringify(stamp)]
  );
  if (!plated.rowCount)
    return { type: 'error', message: `Somebody's already served what was in there.` };

  // A sear leaves fond, a sauce lifts it; one write clears and replaces.
  const searedProfile = inVessel.map(profileNameFor).find(p => FOND_PROFILES.includes(p));
  const newFond = leavesFond({
    vesselKind: kind, profiles: inVessel.map(profileNameFor), band, hadLiquid,
    microwave: cooking.some(r => r.custom_data?.cooking?.microwave),
  }) ? makeFond(searedProfile, band, now) : null;

  // An edible vessel was consumed: no pan to write to.
  if (!edibleVessel) {
    await query(
      newFond
        ? `UPDATE player_inventory SET custom_data = (COALESCE(custom_data,'{}'::jsonb) - 'deglazed' - 'dressed') || jsonb_build_object('fond', $2::jsonb) WHERE id=$1`
        : `UPDATE player_inventory SET custom_data = (COALESCE(custom_data,'{}'::jsonb) - 'fond' - 'deglazed' - 'dressed') WHERE id=$1`,
      newFond ? [vessel.inv_id, JSON.stringify(newFond)] : [vessel.inv_id]
    );
  }

  cookSfx(player, { action: 'impact', surface: 'ceramic', intensity: 0.4 });

  const lines = [];
  const label = band[0].toUpperCase() + band.slice(1);
  lines.push(intermediate
    ? `You work it together and roll it out: ${name}. ${label}, and not dinner yet.`
    : (key || improvised)
      ? `You plate it up: ${name}. It's ${label}.`
      : `You plate whatever this is. ${label}, and that's being generous.`);
  if (plating.note) lines.push(`<span class="text-dim">${plating.note}</span>`);
  if (dressed > 0) lines.push(`<span class="text-dim">${dressed >= DRESS_MAX * 0.6 ? 'It looks like somebody meant it.' : 'Laid out with some care.'}</span>`);

  // Collection path 1: discovery by repetition (DISCOVERY_ATTEMPTS good plates).
  const award = cookingIpFor(band, lastIpAt, now);
  let flatIp = award.ip;
  const bookkeeping = [];
  if (award.resets) bookkeeping.push(markRoutineIp(player.id, now));
  if (key && !known.has(key)) {
    const att = await recordAttempt(player.id, key, band, progress.get(key) || 0);
    if (att.learned) {
      flatIp += DISCOVERY_IP;
      lines.push(`That's the third time you've turned that out properly. **${template.noun}** added to your cookbook.`);
    } else if (att.counted) {
      lines.push(`You're getting the measure of this one. (${att.count}/${DISCOVERY_ATTEMPTS})`);
    } else {
      lines.push(`Nothing to be learned from a plate like that.`);
    }
  } else if (key && beatsRecorded(known.get(key), band)) {
    bookkeeping.push(improveRecipe(player.id, key, band));
    lines.push(`Best you've ever made it. Your cookbook says so.`);
  }

  // A known authored recipe cooked at the top pays a flat bonus improvisation can't.
  if (key && known.has(key) && bandIndex(band) >= bandIndex(RECIPE_MASTERY_BAND)) {
    flatIp += RECIPE_MASTERY_IP;
    lines.push(`<span class="text-dim">That's the recipe, cooked the way it's meant to go.</span>`);
  }

  // Improvised pays on complexity, always less than DISCOVERY_IP.
  if (improvised) {
    flatIp += improvisedIp(improvised.complexity, band);
    if (mine && beatsRecorded(mine.best, band)) {
      bookkeeping.push(improveSaved(player.id, mine.slug, mine, band));
      lines.push(`Best you've made your ${mine.name} yet.`);
    } else if (!mine && bandIndex(band) >= bandIndex(DISCOVERY_MIN_BAND)) {
      lines.push(`<span class="text-dim">Nothing in the book covers that. <b>save recipe as &lt;name&gt;</b> while you're holding it.</span>`);
    }
  }

  // The skill award, the flat IP and the cookbook row are mutually independent.
  bookkeeping.push(awardSkillUse(player.id, 'cooking', check.margin));
  if (flatIp) bookkeeping.push(grantSkillIp(player.id, 'cooking', flatIp));
  await Promise.all(bookkeeping);

  return { type: 'output', message: lines.join('\n') };
}

// Collection path 2: a recipe card, via the engine's tag-gated `read`.
async function readRecipeCard(args, raw, player) {
  const nameStr = args.join(' ').trim();
  const card = await resolveInventoryItem(player, { tag: 'recipe_card', name: nameStr || undefined, topLevel: true });
  if (!card) return undefined; // not ours — fall through to the other read handlers
  // A player-written card carries its recipe on custom_data; check it first.
  const written = await learnFromWrittenCard(card, player);
  if (written) return { type: 'output', message: written };

  const key = String(tagValue(card, 'recipe_card', '') || '').trim();
  // A tag naming no dish is a content bug; never report it as "already known".
  if (!key || !DISHES[key]) {
    return { type: 'output', message: `The ${card.name} is water-damaged past reading. Whatever it taught, it doesn't any more.` };
  }
  const { learned } = await learnRecipe(player.id, key);
  return {
    type: 'output',
    message: learned
      ? `You read it twice and it sticks. Added to your cookbook.`
      : `You already know this one. The card goes back in your pocket.`,
  };
}

const smokersInZone = zoneId => getZoneFurniture(zoneId).filter(f => f.flags?.smoker);

// `smoke <meat>`: raw meat to preserved meat over about an hour, with a huge window.
async function cmdCure(args, raw, player, broadcast) {
  const nameStr = args.join(' ').trim();
  if (!nameStr) return { type: 'error', message: 'Smoke what?' };

  const smokers = smokersInZone(player.current_zone);
  if (!smokers.length) return { type: 'error', message: `There's no smoker here.` };
  const smoker = smokers.find(f => !f.flags?.busy_until || f.flags.busy_until <= Date.now());
  if (!smoker) return { type: 'error', message: `The ${smokers[0].name} is already full.` };

  const food = await resolveInventoryItem(player, { name: nameStr, topLevel: true });
  if (!food) return { type: 'error', message: `You don't have "${nameStr}".` };
  const profileName = profileNameFor(food);
  if (profileName !== 'dense_meat') {
    return { type: 'error', message: `A smoker is for meat. ${food.name} would just get sooty.` };
  }
  if (food.custom_data?.smoked) return { type: 'error', message: `${food.name} has already been smoked.` };

  const row = { ...food, id: food.inv_id ?? food.id, player_id: player.id };
  const env = await cookEnvironment(row, player);
  const prepared = prepareCook(row, {
    id: smoker.id, name: smoker.name, heatTier: 'low', speed: SMOKER_SPEED,
    furnitureRow: smoker, profileName, smoking: true,
  }, env);
  if (prepared.error) return { type: 'error', message: prepared.error };

  await commitCooks([prepared], { id: smoker.id, name: smoker.name, furnitureRow: smoker });
  broadcast?.(player.current_zone, { type: 'zone_event', message: `${player.handle} loads the ${smoker.name} and lights it.` }, player.id);
  return {
    type: 'output',
    message: `You hang ${food.name} in the ${smoker.name} and get the chips smouldering. This will take hours, and it wants none of your attention.`,
  };
}

// `chop <food> [into N]`. Portions conserve mass and food; cook time scales as
// m^(2/3), so a quarter cooks in about 40% of the time.
async function cmdChop(args, raw, player) {
  const argStr = args.join(' ').trim();
  if (!argStr) return { type: 'error', message: `Chop what? Try "chop potato" or "chop potato into 4".` };

  const m = argStr.match(/^(.*?)\s+(?:into|in)\s+(\d+)$/i);
  const nameStr = (m ? m[1] : argStr).trim();
  const pieces = m ? Number(m[2]) : 2;
  if (!Number.isInteger(pieces) || pieces < 2 || pieces > MAX_CHOP_PIECES) {
    return { type: 'error', message: `You can cut something in two, three or four. Not ${pieces}.` };
  }

  if (!(await chopTool(player))) return { type: 'error', message: `You need a knife for that.` };

  const food = await resolveInventoryItem(player, { name: nameStr, topLevel: false });
  if (!food) return { type: 'error', message: `You don't have "${nameStr}".` };
  // A plated dish can be cut too; it has no profile, so match its stamp.
  const isDish = !!food.custom_data?.cook_quality || !!food.custom_data?.dish;
  if (!profileNameFor(food) && !isDish) return { type: 'error', message: `${food.name} isn't food.` };
  if (food.custom_data?.cooking) return { type: 'error', message: `Not while it's on the heat.` };
  if (!canChop(food, pieces)) {
    return { type: 'error', message: `${food.name} is already about as small as it usefully goes.` };
  }

  // ON THE STAGE'S BOARD the cut is played: the server holds the food and the
  // count, the board sends back where the strokes fell (`chopresolve`). Anywhere
  // else, and for a dish, it's the instant cut it always was.
  if (!isDish && stageOpen(player.id)) return armKnife(player, food, pieces);
  return splitFood(player, food, pieces, isDish);
}

// One row becomes `pieces` rows. `cut` is the board's verdict, stamped on every
// piece; a typed chop has none.
async function splitFood(player, food, pieces, isDish, cut = null) {
  const from = portionOf(food);
  const each = from / pieces;
  const baseName = food.custom_data?.name || food.name;
  const wholeName = baseName.replace(/^(half|a quarter of|an eighth of|1\/\d+ of)\s+(an?\s+)?/i, '');
  const pieceName = portionName({ custom_data: { portion: each } }, wholeName);

  // ⚠ Each keeps the original `quantity` (a stack of five halved is ten
  // halves), and prep is not copied (`minced` stays). A second cut keeps the
  // worse of the two evennesses: a ragged half cut cleanly is still ragged.
  const { scored, tenderised, marinated_at, tasted, cut: before, ...keep } = food.custom_data || {};
  const even = cut ? Math.min(cut.even, before?.even ?? 1) : before?.even;
  const stamp = JSON.stringify({ ...keep, portion: each, name: pieceName, ...(even != null ? { cut: { even } } : {}) });
  await query(
    `WITH cut AS (DELETE FROM player_inventory WHERE id = $1 RETURNING player_id, item_id, quantity, condition, container_id)
     INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, container_id, custom_data)
     SELECT unnest($2::text[]), player_id, item_id, quantity, condition, container_id, $3::jsonb FROM cut`,
    [food.inv_id, Array.from({ length: pieces }, () => randomUUID()), stamp]
  );
  const lostPrep = scored || tenderised || marinated_at;
  cookSfx(player, {
    action: 'chop', material: sfxMaterial(food),
    state: await sfxState(food, player), intensity: 0.4 + 0.1 * pieces,
  });

  return {
    type: 'output',
    message: isDish
      ? `You cut ${baseName} into ${pieces}. ${pieces} × ${pieceName}: the same meal, in more hands.`
      : `You cut ${baseName} into ${pieces}. ${pieces} × ${pieceName}${cut ? `, ${evenText(cut.even)}` : ', and each one will cook in a fraction of the time'}.`
        + (lostPrep ? ` The work you'd already done to it doesn't survive the knife.` : ''),
  };
}

// What the board's cut looks like, in a cook's words. Never the number.
function evenText(even) {
  if (even >= 0.95) return 'clean and even: they will all be ready together';
  if (even >= 0.8) return 'near enough even';
  if (even >= 0.6) return 'uneven: the small ones will be done first';
  return 'ragged: some of it will burn before the rest is cooked';
}

// ── The board (docs/proposals/kitchen-stage.md) ─────────────────────────────
// One cut waits per player, in RAM. A nonce ties the strokes to the cut the
// server set up, so a stale board can't cut whatever has that name now.
const knifeCuts = new Map();

function armKnife(player, food, pieces) {
  const profile = profileNameFor(food);
  const matter = matterFor(profile, tagValue(food, 'matter', null));
  const nonce = randomUUID();
  knifeCuts.set(String(player.id), { nonce, invId: food.inv_id, pieces, profile, at: Date.now() });
  return {
    type: 'knife_game',
    row: food.inv_id, nonce, pieces, name: food.custom_data?.name || food.name,
    look: { profile, matter: tagValue(food, 'matter', null), portion: food.custom_data?.portion || null },
    difficulty: cutDifficulty(matter),
  };
}

// `chopresolve <row> <nonce> <crush> <cut> ...`, or `chopresolve <row> <nonce> abort`.
// Each cut is knife.js's `at:tilt`. Not a player verb.
async function cmdChopResolve(args, raw, player) {
  const [row, nonce, crushArg, ...rest] = args;
  const key = String(player.id), pend = knifeCuts.get(key);
  if (!pend || pend.nonce !== nonce || String(pend.invId) !== String(row)) return { type: 'error', message: `That cut has gone cold. Put it back on the board.` };
  knifeCuts.delete(key);
  if (crushArg === 'abort') return { type: 'output', message: `You put the knife down.` };
  if (Date.now() - pend.at > KNIFE_TTL_MS) return { type: 'error', message: `That cut has gone cold. Put it back on the board.` };
  const cuts = rest.map(parseCut).filter(Boolean).slice(0, pend.pieces - 1);
  const { rows } = await query(
    `SELECT pi.id AS inv_id, pi.item_id, pi.quantity, pi.custom_data, i.name, i.tags, i.flags
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.id = $1 AND pi.player_id = $2`, [pend.invId, player.id]);
  const food = rows[0];
  if (!food) return { type: 'error', message: `It isn't on the board any more.` };
  if (food.custom_data?.cooking) return { type: 'error', message: `Not while it's on the heat.` };
  const matter = matterFor(pend.profile, tagValue(food, 'matter', null));
  const even = evenness(footprint(matter.form), cuts, Number(crushArg) || 0, pend.pieces);
  return splitFood(player, food, pend.pieces, false, { even });
}

// Shared preamble for every prep verb.
async function prepTarget(nameStr, player, { profile = null, needsBlade = true } = {}) {
  if (!nameStr) return { error: 'What?' };
  if (needsBlade && !(await chopTool(player))) return { error: 'You need a knife for that.' };
  const food = await resolveInventoryItem(player, { name: nameStr, topLevel: false });
  if (!food) return { error: `You don't have "${nameStr}".` };
  const p = profileNameFor(food);
  if (!p) return { error: `${food.name} isn't food.` };
  if (profile && p !== profile) return { error: `That isn't something you do to ${food.name}.` };
  if (food.custom_data?.cooking) return { error: `Not while it's on the heat.` };
  if (food.custom_data?.cooked) return { error: `Too late for that: it's already cooked.` };
  return { food, profile: p };
}

const stampPrep = (invId, patch) => query(
  `UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || $2::jsonb WHERE id=$1`,
  [invId, JSON.stringify(patch)]
);

// `score <meat>`: a wider window, but it dries faster past it.
async function cmdScore(args, raw, player) {
  const t = await prepTarget(args.join(' ').trim(), player, { profile: 'dense_meat' });
  if (t.error) return { type: 'error', message: t.error };
  if (t.food.custom_data?.scored) return { type: 'error', message: `${t.food.name} is already scored.` };
  if (t.food.custom_data?.minced) return { type: 'error', message: `There's nothing left of it to score.` };
  await stampPrep(t.food.inv_id ?? t.food.id, { scored: true });
  cookSfx(player, { action: 'chop', material: sfxMaterial(t.food), intensity: 0.3 });
  return { type: 'output', message: `You score ${t.food.name} across the fat in a diamond, a quarter inch deep. It'll take seasoning now, and heat.` };
}

// `tenderise <meat>`: faster and more forgiving, one rung off the top.
async function cmdTenderise(args, raw, player) {
  const t = await prepTarget(args.join(' ').trim(), player, { profile: 'dense_meat', needsBlade: false });
  if (t.error) return { type: 'error', message: t.error };
  if (t.food.custom_data?.tenderised) return { type: 'error', message: `${t.food.name} has taken all the beating it needs.` };
  if (t.food.custom_data?.minced) return { type: 'error', message: `It's mince. There's nothing left to tenderise.` };
  await stampPrep(t.food.inv_id ?? t.food.id, { tenderised: true });
  cookSfx(player, { action: 'impact', surface: 'wood', intensity: 0.8 });
  return { type: 'output', message: `You beat ${t.food.name} out flat and even. It'll cook fast and forgive you a lot, but it'll never be a great piece of meat again.` };
}

// `marinate <meat> in <something>`: costs time and the marinade, not quality.
async function cmdMarinate(args, raw, player) {
  const argStr = args.join(' ').trim();
  const m = argStr.match(/^(.*?)\s+in\s+(.+)$/i);
  if (!m) return { type: 'error', message: 'Marinate what, in what? (marinate <meat> in <something>)' };

  const t = await prepTarget(m[1].trim(), player, { needsBlade: false });
  if (t.error) return { type: 'error', message: t.error };
  if (!canMarinate(t.profile)) return { type: 'error', message: `Marinating ${t.food.name} would do nothing for it.` };
  if (t.food.custom_data?.marinated_at) return { type: 'error', message: `${t.food.name} is already in a marinade.` };

  const bath = await resolveInventoryItem(player, { name: m[2].trim(), topLevel: false });
  if (!bath) return { type: 'error', message: `You don't have "${m[2].trim()}".` };
  const bathProfile = profileNameFor(bath);
  if (!['liquid', 'aromatic', 'fat_or_oil', 'fruit'].includes(bathProfile)) {
    return { type: 'error', message: `${bath.name} isn't going to marinate anything.` };
  }

  await query('DELETE FROM player_inventory WHERE id=$1', [bath.inv_id ?? bath.id]);
  await stampPrep(t.food.inv_id ?? t.food.id, { marinated_at: Date.now() });
  return {
    type: 'output',
    message: `You put ${t.food.name} in the ${bath.name} and leave it. It wants hours, and it'll be worth every one of them.`,
  };
}

// `butter <bread>`: counts as the dish's fat (see `signature`) and pays BUTTER_BONUS.
async function cmdButter(args, raw, player) {
  const argStr = args.join(' ').trim();
  if (!argStr) return { type: 'error', message: `Butter what? Try "butter flatbread".` };

  const target = await resolveInventoryItem(player, { name: argStr, topLevel: false });
  if (!target) return { type: 'error', message: `You don't have "${argStr}".` };
  if (!profileNameFor(target)) return { type: 'error', message: `${target.name} isn't food.` };
  if (target.custom_data?.cooking) return { type: 'error', message: `Not while it's on the heat.` };
  if (target.custom_data?.cooked) return { type: 'error', message: `Too late: butter goes on before the heat, not after.` };
  if (target.custom_data?.buttered) return { type: 'error', message: `${target.name} is buttered enough.` };

  const butter = await resolveInventoryItem(player, { tag: 'spreadable', topLevel: false });
  if (!butter) return { type: 'error', message: `You've nothing to spread. You want butter, or something pretending to be.` };

  // Spreading takes a portion; only the last of it takes the item.
  const left = portionOf(butter) - BUTTER_PORTION;
  await (left > 1e-9
    ? query(
        `UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || jsonb_build_object('portion', $2::numeric) WHERE id=$1`,
        [butter.inv_id ?? butter.id, left])
    : query('DELETE FROM player_inventory WHERE id=$1', [butter.inv_id ?? butter.id]));
  await stampPrep(target.inv_id ?? target.id, { buttered: true });
  cookSfx(player, { action: 'scrape', surface: 'wood', intensity: 0.3, personal: true });

  return {
    type: 'output',
    message: `You spread ${butter.name} across ${target.name}, right to the edges.`
      + (left > 1e-9 ? '' : ` That was the last of it.`),
  };
}

// pour <fluid> into <pan>: one measure, landing as an ordinary ingredient row.
// see plugins/cooking/README.md#pour-jug-of-oil-into-pan
// ⚠ Must return undefined (fall through) for anything not ours: `drinks` and
// `fillable` load after cooking, so this sees every `pour` first.

// One measure in its class's units: a modifier by dose (POUR_PORTION), anything
// else by mass (FLUID_MEASURE_G). `spentAll`: less than a measure was left.
function measureOf(row, profile) {
  if (PROFILES[profile]?.modifier) return { portion: POUR_PORTION, grams: 0, spentAll: false };
  const weight = Number(row?.weight) || 0;
  if (weight <= 0) return { portion: 1, grams: 0, spentAll: true };
  const want = Math.min(FLUID_MEASURE_G / weight, portionOf(row));
  return { portion: want, grams: FLUID_MEASURE_G, spentAll: want >= portionOf(row) - 1e-9 };
}

// Unnamed pour target: the pan on the heat, else the only vessel.
async function impliedVessel(player) {
  // `commitCooks` stamps the pan id on its burner, so this is an in-memory read.
  const onHeat = stovesInZone(player.current_zone).map(f => f.flags?.vessel_id).filter(Boolean);
  const { rows } = await query(
    `SELECT pi.id AS inv_id, pi.item_id, pi.quantity, pi.custom_data, i.name, i.weight, i.tags
       FROM player_inventory pi JOIN items i ON i.id=pi.item_id
      WHERE pi.player_id=$1 AND pi.container_id IS NULL
        AND jsonb_exists(i.tags,'vessel') AND NOT jsonb_exists(i.tags,'fillable')`,
    [player.id]);
  const hot = rows.find(r => onHeat.some(id => String(id) === String(r.inv_id)));
  if (hot) return hot;
  // ⚠ One, or nothing: never guess between two idle pans.
  return rows.length === 1 ? rows[0] : null;
}

// Move fluid rows into a target, or delete them with none.
async function tipFluids(rows, targetInvId) {
  if (!rows.length) return 0;
  const ids = rows.map(r => r.inv_id ?? r.id);
  if (targetInvId) await query('UPDATE player_inventory SET container_id=$1 WHERE id = ANY($2)', [targetInvId, ids]);
  else await query('DELETE FROM player_inventory WHERE id = ANY($1)', [ids]);
  return ids.length;
}

const fluidNames = rows => [...new Set(rows.map(r => shownName(r)))].join(', ');

async function pourFat(args, raw, player) {
  const str = args.join(' ').trim();
  if (!str) return undefined;
  const m = str.match(/^(.*?)\s+(?:into|in|onto|on|over)\s+(?:the\s+)?(.+)$/i);
  const srcName = (m ? m[1] : str).trim();
  const tgtName = m ? m[2].trim() : null;

  // Tipping a pan out.
  const pan = await resolveInventoryItem(player, { tag: 'vessel', name: srcName, topLevel: true, fromNearby: true });
  if (pan && !hasTag(pan, 'fillable')) {
    return tipVessel(pan, tgtName, player);
  }

  const src = await resolveInventoryItem(player, { name: srcName, topLevel: false });
  // The gate is POURABLE: every fluid profile, not just fat.
  const srcProfile = profileNameFor(src);
  if (!src || !POURABLE.has(srcProfile)) return undefined;
  if (hasTag(src, 'fillable')) return undefined;  // a fillable bottle stays fillable's

  const vessel = tgtName
    ? await resolveInventoryItem(player, { tag: 'vessel', name: tgtName, topLevel: true, fromNearby: true })
    : await impliedVessel(player);
  if (!vessel) {
    // ⚠ A named but unresolved target falls through; only an unnamed one refuses.
    return tgtName ? undefined : { type: 'error', message: `Pour it into what? <span class="text-dim">Get a pan out, or name one: "pour ${srcName} into &lt;pan&gt;".</span>` };
  }
  if (src.custom_data?.cooking) return { type: 'error', message: `Not while it's on the heat.` };

  const contents = await vesselContents(vessel.inv_id);
  if (contents.some(r => r.custom_data?.cooking)) {
    return { type: 'error', message: `The ${vessel.name} is already going. Take it off before you add anything.` };
  }

  const dose = measureOf(src, srcProfile);
  const left = portionOf(src) - dose.portion;
  // Dregs (under FLUID_DREGS_G) go in whole rather than leave an unusable row.
  const spent = left <= 1e-9 || (dose.grams > 0 && left * (Number(src.weight) || 0) < FLUID_DREGS_G);
  await (spent
    ? query('DELETE FROM player_inventory WHERE id=$1', [src.inv_id ?? src.id])
    : query(
        `UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || jsonb_build_object('portion', $2::numeric) WHERE id=$1`,
        [src.inv_id ?? src.id, left]));

  const noun = tagValue(src, 'food_noun', null) || src.name;
  const shown = dose.spentAll ? shownName(src) : `a measure of ${noun === 'fried' ? 'oil' : noun}`;
  // ⚠ Only a weighed fluid carries a portion, and `dose.grams` is the test, never
  // `dose.portion < 1`. A modifier's measure is one whole dose (`unitsOf` reads
  // portion × stack), so a portion on it would make it a fraction of a dose.
  const carried = dose.grams > 0 ? (spent ? portionOf(src) : dose.portion) : 1;
  await query(
    `INSERT INTO player_inventory (id, player_id, item_id, quantity, container_id, custom_data)
     VALUES ($1, $2, $3, 1, $4, $5::jsonb)`,
    [randomUUID(), player.id, src.item_id, vessel.inv_id,
      JSON.stringify({ measure: true, name: shown, ...(carried < 1 ? { portion: carried } : {}) })],
  );
  cookSfx(player, { action: 'pour', material: 'liquid', flow: 0.5 });

  const over = spent ? 0 : Math.floor((left + 1e-9) / dose.portion);
  return { type: 'use', message:
    `You pour a measure of ${src.name} into the ${vessel.name}.`
    + (over > 0
      ? ` <span class="text-dim">About ${over} more in it.</span>`
      : ` <span class="text-dim">That was the last of it.</span>`) };
}

// `taste <food|vessel>`: reads seasoning and quality; detail scales with skill.
async function cmdTaste(args, raw, player) {
  const nameStr = args.join(' ').trim();
  if (!nameStr) return { type: 'error', message: 'Taste what?' };
  const skill = await effectiveSkill(player, 'cooking');

  // A vessel tastes as the dish it's becoming.
  const vessel = await resolveInventoryItem(player, { tag: 'vessel', name: nameStr, topLevel: true, fromNearby: true });
  if (vessel) {
    const contents = await vesselContents(vessel.inv_id);
    const real = contents.filter(r => profileNameFor(r));
    if (!real.length) return { type: 'error', message: `There's nothing in the ${vessel.name} to taste.` };
    const modifiers = contents.filter(r => isModifier(r));
    // `dishFor`, not `matchDish`, so improvised pans get seasoning notes too.
    const dish = dishFor(
      signature(real, profileNameFor),
      tagValue(vessel, 'vessel_kind', null),
      new Set(contents.map(r => r.item_id)),
      { isBread: hasTag(vessel, 'edible_vessel') },
    );
    const cooking = contents.find(r => r.custom_data?.cooking);
    const notes = tasteNotes({
      session: cooking?.custom_data?.cooking,
      profile: cooking ? sessionProfile(cooking.custom_data.cooking) : null,
      template: dish.slop ? null : dish.template,
      modifierCount: dish.slop ? null : modifiers.reduce((a, r) => a + portionOf(r), 0),
      skill,
    });
    // ⚠ One row only: plating sums `tasted` across the vessel.
    await noteTaste([cooking || real[0]]);
    return { type: 'output', message: `You taste from the ${vessel.name}.\n${notes.map(n => `  ${n}`).join('\n')}` };
  }

  const food = await resolveInventoryItem(player, { name: nameStr, topLevel: false });
  if (!food) return { type: 'error', message: `You don't have "${nameStr}".` };
  const session = food.custom_data?.cooking;
  if (!session) {
    const lines = flavourLines(food.custom_data || {}, restPhase(food.custom_data));
    if (!lines.length) return { type: 'error', message: `${food.name} isn't cooking, and there's nothing to learn from it.` };
    await noteTaste([food]);
    return { type: 'output', message: `You take a little of ${food.custom_data?.name || food.name}.\n  ${lines[0]}` };
  }
  const notes = tasteNotes({ session, profile: sessionProfile(session), skill });
  await noteTaste([food]);
  return { type: 'output', message: `You taste ${food.name}.\n${notes.map(n => `  ${n}`).join('\n')}` };
}

// Each taste is recorded on the row and costs TASTE_BITE of the yield at plating.
async function noteTaste(rows) {
  const ids = rows.map(r => r.inv_id ?? r.id).filter(Boolean);
  if (!ids.length) return;
  await query(
    `UPDATE player_inventory
        SET custom_data = COALESCE(custom_data,'{}'::jsonb)
            || jsonb_build_object('tasted', COALESCE((custom_data->>'tasted')::numeric, 0) + 1)
      WHERE id = ANY($1)`,
    [ids]
  );
}

// `mince <meat>`: same mass, a third of the cook time, a hard ceiling.
async function cmdMince(args, raw, player) {
  const nameStr = args.join(' ').trim();
  if (!nameStr) return { type: 'error', message: `Mince what?` };
  if (!(await chopTool(player))) return { type: 'error', message: `You need a knife for that.` };

  const food = await resolveInventoryItem(player, { name: nameStr, topLevel: false });
  if (!food) return { type: 'error', message: `You don't have "${nameStr}".` };
  if (profileNameFor(food) !== 'dense_meat') {
    return { type: 'error', message: `Mincing is for meat. ${food.name} would just be a mess.` };
  }
  if (food.custom_data?.minced) return { type: 'error', message: `${food.name} is already mince.` };
  if (food.custom_data?.cooking) return { type: 'error', message: `Not while it's on the heat.` };
  if (food.custom_data?.cooked) return { type: 'error', message: `You mince it before you cook it, not after.` };

  // Keeps its origin, so the dish still names the creature.
  const base = nounOf(food);
  const minceName = `${base} mince`;

  await query(
    `UPDATE player_inventory
        SET custom_data = COALESCE(custom_data,'{}'::jsonb) || jsonb_build_object('minced', true, 'name', $2::text, 'food_noun', $3::text)
      WHERE id=$1`,
    [food.inv_id ?? food.id, minceName, base]
  );

  return {
    type: 'output',
    message: `You work ${food.custom_data?.name || food.name} down under the blade until it's ${minceName}. It'll cook in no time, and it'll never be a steak.`,
  };
}

// `deglaze <vessel>`: needs fond and a liquid in the pan.
async function cmdDeglaze(args, raw, player) {
  const nameStr = args.join(' ').trim();
  const vessel = await resolveInventoryItem(player, { tag: 'vessel', name: nameStr || undefined, topLevel: true, fromNearby: true });
  if (!vessel) return { type: 'error', message: nameStr ? `You don't have "${nameStr}".` : `Deglaze what?` };

  const fond = vessel.custom_data?.fond;
  const state = fondState(fond);
  if (state === 'none') return { type: 'error', message: `There's nothing stuck to the ${vessel.name} worth lifting.` };
  if (state === 'residue') return { type: 'error', message: `Whatever was in the ${vessel.name} has dried on hard. That wants scouring, not deglazing.` };
  if (vessel.custom_data?.deglazed) return { type: 'error', message: `You've already lifted the ${vessel.name}.` };

  const contents = await vesselContents(vessel.inv_id);
  const wet = contents.find(r => profileNameFor(r) === 'liquid');
  if (!wet) return { type: 'error', message: `You need something wet in the ${vessel.name} to lift it with.` };

  await query(
    `UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || '{"deglazed":true}'::jsonb WHERE id=$1`,
    [vessel.inv_id]
  );
  // Composed from three cues, never a bespoke "deglaze" sound.
  cookSfx(player, { action: 'pour', material: 'liquid', flow: 0.7 });
  cookSfx(player, { action: 'sizzle', material: 'liquid', heat: 0.95 });
  cookSfx(player, { action: 'scrape', surface: 'metal', intensity: 0.6 });

  return {
    type: 'output',
    message: `You pour the ${wet.name} into the ${vessel.name} and scrape. The brown comes up off the bottom and goes into the sauce.`,
  };
}

// `scour <vessel>`: clears fond residue, which is a penalty until cleaned.
async function cmdScour(args, raw, player) {
  const nameStr = args.join(' ').trim();
  const vessel = await resolveInventoryItem(player, { tag: 'vessel', name: nameStr || undefined, topLevel: true, fromNearby: true });
  if (!vessel) return { type: 'error', message: nameStr ? `You don't have "${nameStr}".` : `Scour what?` };
  if (!vessel.custom_data?.fond) return { type: 'error', message: `The ${vessel.name} is already clean enough.` };

  await query(
    `UPDATE player_inventory SET custom_data = (custom_data - 'fond' - 'deglazed') WHERE id=$1`,
    [vessel.inv_id]
  );
  cookSfx(player, { action: 'scrape', surface: 'metal', intensity: 0.75 });
  return { type: 'output', message: `You scour the ${vessel.name} back to bare metal. It takes a while.` };
}

// `mise`: every ingredient in play, its vessel and progress. Strictly derived:
// no writes, no clock, no state of its own.
async function cmdMise(args, raw, player) {
  const { rows } = await query(
    `SELECT pi.id, pi.item_id, pi.quantity, pi.custom_data, pi.container_id,
            i.name, i.weight, i.tags
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1`,
    [player.id]
  );

  const isFood = r => !!(profileNameFor(r) || hasTag(r, 'needs_cooking') || r.custom_data?.cooking || r.custom_data?.dish);
  const vessels = rows.filter(r => hasTag(r, 'vessel'));
  const vesselIds = new Set(vessels.map(v => v.id));

  // Where each vessel is (in-memory furniture, no query).
  const appliances = [...stovesInZone(player.current_zone), ...microwavesInZone(player.current_zone)];
  const placeOf = (v) => {
    const on = appliances.find(f => f.flags?.vessel_id === v.id);
    if (on) {
      // The burner setting lives in the session's heat log, not on the stove.
      const live = cooksOnAppliances([on.id])[0];
      const heats = live?.session?.heats;
      const tier = Array.isArray(heats) && heats.length ? heats[heats.length - 1].tier : null;
      return `on the ${on.name}${tier ? `, burner ${tier}` : ''}`;
    }
    if (v.container_id) return 'stowed in your pack';
    return 'in hand';
  };

  const out = [];
  for (const v of vessels) {
    const inside = await describeVessel(v, player);
    out.push(`<span class="text-bright">${shownName(v)}</span> <span class="text-dim">${placeOf(v)}</span>`);
    out.push(inside || `  <span class="text-dim">empty</span>`);
  }

  // Ingredients not in any vessel.
  const loose = rows.filter(r => isFood(r) && !vesselIds.has(r.container_id));
  if (loose.length) {
    if (out.length) out.push('');
    out.push(`<span class="text-bright">On you</span>`);
    for (const r of loose) {
      const cd = r.custom_data || {};
      const state = cd.cooking ? checkCooking(r)?.text
        : cd.dish ? 'a finished dish'
        : cd.cooked ? 'cooked'
        : 'raw, and not in anything yet';
      const notes = [];
      if (cd.minced) notes.push('minced');
      if (cd.portion) notes.push(portionName(cd.portion));
      const prep = prepText(cd);
      if (prep) notes.push(prep);
      out.push(`  ${shownName(r)}${r.quantity > 1 ? ` x${r.quantity}` : ''}: ${state}${notes.length ? `, ${notes.join(', ')}` : ''}`);
    }
  }

  // The kitchen's dish cabinet pots (the `fromNearby` seam), non-empty only.
  const { rows: near } = await query(
    `SELECT pi.id, pi.item_id, pi.custom_data, pi.container_id, i.name, i.tags, f.name AS from_nearby
       FROM player_inventory pi
       JOIN items i ON i.id = pi.item_id
       JOIN furniture f ON f.id = pi.container_id
      WHERE f.zone_id = $1 AND f.object_type = 'container'
        AND jsonb_exists(f.flags, 'dish_cabinet')
        AND jsonb_exists(i.tags, 'vessel')`,
    [player.current_zone]
  );
  const nearLines = [];
  for (const v of near) {
    const inside = await describeVessel(v, player);
    if (!inside) continue;
    nearLines.push(`<span class="text-bright">${shownName(v)}</span> <span class="text-dim">in the ${v.from_nearby}</span>`);
    nearLines.push(inside);
  }
  if (nearLines.length) {
    if (out.length) out.push('');
    out.push(...nearLines);
  }

  if (!out.length) return { type: 'output', message: `<span class="text-dim">Nothing in play. No pans, no ingredients, nothing on the heat.</span>` };
  return { type: 'output', message: out.join('\n') };
}

// `doneness <food> <target>`: moves the peak window; settable until it opens.
async function cmdDoneness(args, raw, player) {
  const argStr = args.join(' ').trim();
  if (!argStr) return { type: 'error', message: `Cook what, and how? Try "doneness steak rare".` };

  // Longest food-name prefix wins, so "well done" and multi-word foods both work.
  const food = await resolveInventoryItem(player, { name: argStr, topLevel: false });
  let target = null, foodRow = food;
  if (!foodRow) {
    const words = argStr.split(/\s+/);
    for (let i = words.length - 1; i > 0 && !foodRow; i--) {
      const cand = await resolveInventoryItem(player, { name: words.slice(0, i).join(' '), topLevel: false });
      if (cand) { foodRow = cand; target = words.slice(i).join(' ').toLowerCase(); }
    }
  }
  if (!foodRow) return { type: 'error', message: `You don't have "${argStr}".` };

  const session = foodRow.custom_data?.cooking;
  if (!session) return { type: 'error', message: `${foodRow.name} isn't on the heat.` };
  const profile = sessionProfile(session);
  const levels = profile && donenessLevels(profile);
  if (!levels) return { type: 'error', message: `${foodRow.name} is done when it's done: there's nothing to choose.` };

  const names = levels.map(l => l.name);
  if (!target) {
    return { type: 'output', message: `${foodRow.name} is set to ${session.target || defaultDoneness(profile)}. You could ask for: ${names.join(', ')}.` };
  }
  const pick = names.find(n => n === target) || names.find(n => n.startsWith(target));
  if (!pick) return { type: 'error', message: `That's not a doneness. Try: ${names.join(', ')}.` };

  if (apparentNow(session) >= timeline(session, profile).doneAt) {
    return { type: 'error', message: `Too late: ${foodRow.name} is already past that.` };
  }

  await query(
    `UPDATE player_inventory SET custom_data = jsonb_set(custom_data, '{cooking,target}', $2::jsonb)
      WHERE id=$1 AND jsonb_exists(custom_data,'cooking')`,
    [foodRow.inv_id ?? foodRow.id, JSON.stringify(pick)]
  );
  // ⚠ The finish line moved: re-arm timers, or the old auto-burn fires mid-window.
  rescheduleNarration(foodRow.inv_id ?? foodRow.id, player.id, { ...session, target: pick }, foodRow.name);
  return { type: 'output', message: `You'll take ${foodRow.name} ${pick}.` };
}

// `stove <off|0-10|low|mid|high|up|down> [on <hob>]`. `stove_tier` is the
// ceiling. A change is logged on every live session (scored by `heatCurve`) and
// retunes its rate. See heat.js for the dial and the clock.

// Every setting resolves to a dial position 0..10; the named tiers are notches.
function parseSetting(word, current) {
  const w = String(word || '').trim().toLowerCase();
  if (!w) return null;
  if (w === 'off' || w === 'out' || w === 'zero') return 0;
  if (w === 'medium' || w === 'med') return levelOfTier('mid');
  if (w === 'max' || w === 'full') return MAX_LEVEL;
  if (HEAT_ORDER.includes(w)) return levelOfTier(w);
  if (w === 'up') return clampLevel(current + 1);
  if (w === 'down') return clampLevel(current - 1);
  if (/^\d{1,2}$/.test(w)) {
    const n = parseInt(w, 10);
    return n <= MAX_LEVEL ? n : null;
  }
  return null;
}

// The dial drawn as text, named notches marked.
function dialBar(level, ceiling) {
  let out = '';
  for (let i = 1; i <= MAX_LEVEL; i++) {
    const over = i > ceiling;
    const ch = i === level ? '█' : over ? '·' : TIER_BANDS.some(b => b.notch === i) ? '┃' : '▁';
    out += ch;
  }
  return out;
}

function stoveReadout(stove) {
  const b = burnerOf(stove);
  const capped = b.ceiling < MAX_LEVEL ? ` <span class="text-dim">(tops out at ${b.ceiling})</span>` : '';
  return `<span class="text-bright">${stove.name}</span>: ${dialBar(b.level, b.ceiling)} `
    + `<span class="text-dim">${b.level}/${MAX_LEVEL} · ${levelText(b.level)}${b.tier ? ` · ${b.tier}` : ''}</span>${capped}`;
}

// Which hob: by name, else the busy one, else the first.
// ⚠ A cold ring is a legal target: pre-setting the dial sets a cook's start speed.
function pickStove(stoves, nameStr) {
  if (nameStr) {
    const re = new RegExp(nameStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const named = stoves.find(f => re.test(f.name));
    if (named) return named;
    return null;
  }
  return stoves.find(f => f.flags?.busy_until > Date.now()) || stoves[0] || null;
}

// ⚠ Everything a ring move does, in one place: dial, live sessions, timers and
// the stove's hold. `cook`'s relight goes through here too, or a paused pan
// stays frozen under a lit burner.
async function applyBurner(stove, level) {
  setBurnerLevel(stove.id, level);
  const tier = tierOfLevel(level);

  // Each profiled session gets a heat-log mark and a new rate, relative to the
  // speed it was built at.
  const live = cooksOnAppliances([stove.id]);
  const now = Date.now();
  const touched = [];
  for (const c of live) {
    // A microwave owns its clock; an unprofiled cook has no burner log.
    if (c.session.microwave || !c.session.profile) continue;
    const base = c.session.baseSpeed || STOVE_SPEED[c.session.heatTier] || STOVE_SPEED.low;
    retuneSession(c.session, speedOfLevel(level) / base, now);
    c.session.heats = [...(c.session.heats || []), { at: now, tier: tier || 'low', level }];
    touched.push(c);
  }
  if (!touched.length) return 0;

  await query(
    `UPDATE player_inventory pi
        SET custom_data = COALESCE(pi.custom_data,'{}'::jsonb) || jsonb_build_object('cooking', v.session)
       FROM (SELECT unnest($1::text[]) AS id, unnest($2::jsonb[]) AS session) v
      WHERE pi.id = v.id`,
    [touched.map(c => c.invId), touched.map(c => JSON.stringify(c.session))]
  );
  // ⚠ Timers are in real time and the rate just changed: re-arm them, or the pan
  // burns on the old schedule.
  for (const c of touched) rescheduleNarration(c.invId, c.playerId, c.session, c.name);
  // The ring's hold moves too, or a paused pan's stove is declared free.
  const holds = touched.map(c => {
    const p = sessionProfile(c.session);
    return p ? realTimeFor(c.session, timeline(c.session, p).burnAt, now) : null;
  });
  // ⚠ A zone fire has no furniture row (see `stovesInZone`); updating it throws.
  if (!String(stove.id).startsWith('zonefire_')) {
    const hold = holds.some(h => h === null) ? now + PAUSED_HOLD_MS : Math.max(...holds, 0);
    await updateFurniture(stove.id, { flags: JSON.stringify({ ...stove.flags, busy_until: hold }) }).catch(() => {});
  }
  return touched.length;
}

async function cmdStove(args, raw, player) {
  const stoves = stovesInZone(player.current_zone);
  if (!stoves.length) return { type: 'error', message: `There's no stove here.` };

  // The setting is the first word; the rest (minus "on") names the hob.
  const rest = args.slice(1).join(' ').replace(/^(?:on|at)\s+/i, '').replace(/^the\s+/i, '').trim();

  // Bare `stove` reads the dials back.
  if (!args.length) {
    return { type: 'output', message: stoves.map(stoveReadout).join('\n') };
  }

  const stove = pickStove(stoves, rest);
  if (!stove) return { type: 'error', message: `No stove here called "${rest}".` };
  const b = burnerOf(stove);

  const want = parseSetting(args[0], b.level);
  if (want === null) {
    return { type: 'error', message: `Set the burner to what? <span class="text-dim">"stove off", "stove low", "stove 7", "stove up": anything from 0 to ${MAX_LEVEL}.</span>` };
  }

  if (want > b.ceiling) {
    return { type: 'error', message: `The ${stove.name} doesn't go that high: ${b.ceilingTier} is all it has, and that is ${b.ceiling} on the dial.` };
  }
  if (want === b.level) {
    return { type: 'output', message: `The ${stove.name} is already at ${want}, ${levelText(want)}.` };
  }

  await applyBurner(stove, want);
  cookSfx(player, { action: 'burner', intensity: want / MAX_LEVEL, state: want === 0 ? 'off' : 'on' });

  const dir = want === 0 ? `out` : want > b.level ? `up to ${want}` : `down to ${want}`;
  const head = want === 0
    ? `You turn the ${stove.name} off. <span class="text-dim">Whatever's on it stops where it is.</span>`
    : `You take the ${stove.name} ${dir}, ${levelText(want)}.`;
  return { type: 'output', message: `${head}\n${stoveReadout(stove)}` };
}

// Admin: one of every piece of cooking kit, by tag (never an id list); skips
// anything already carried.
const KIT_TAGS = ['vessel', 'can_turn', 'can_stir', 'can_chop', 'portable_oven'];

async function cmdKitchenKit(args, raw, player) {
  if (!['admin', 'dev'].includes(player.role)) return { type: 'error', message: 'Access denied.' };

  const [{ rows: kit }, { rows: held }] = await Promise.all([
    query(
      `SELECT id, name FROM items
        WHERE tags ?| $1::text[]
        ORDER BY (tags ? 'vessel') DESC, name`,
      [KIT_TAGS]
    ),
    query('SELECT DISTINCT item_id FROM player_inventory WHERE player_id=$1', [player.id]),
  ]);
  if (!kit.length) return { type: 'error', message: 'No cooking equipment exists in the item catalog.' };

  const have = new Set(held.map(r => r.item_id));
  const giving = kit.filter(k => !have.has(k.id));
  if (!giving.length) return { type: 'output', message: `You already have all ${kit.length} pieces of kit.` };

  await query(
    `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition)
     SELECT unnest($1::text[]), $2, unnest($3::text[]), 1, 1.0`,
    [giving.map(() => randomUUID()), player.id, giving.map(g => g.id)]
  );

  const skipped = kit.length - giving.length;
  return {
    type: 'output',
    message: [
      `Kitchen kit issued: ${giving.length} item${giving.length === 1 ? '' : 's'}${skipped ? ` (${skipped} already carried)` : ''}:`,
      ...giving.map(g => `  ${g.name}`),
    ].join('\n'),
  };
}

// `mix` is the drinks plugin's; it falls through to `cooking.mix_vessel` when
// its drinkware lookup misses, so a cooking vessel (a bowl) still works.
// Adding is a move, like `stow`, but reaches a cabinet bowl via `fromNearby`.
async function addToVessel(player, ingredientStr, vessel) {
  const row = await resolveInventoryItem(player, { name: ingredientStr, topLevel: true });
  if (!row) return { type: 'error', message: `You don't have "${ingredientStr}".` };
  return placeInVessel(player, row, vessel);
}

// The one set of checks for every route into a vessel (`addToVessel`, `stack`,
// methods). `stacked` stamps a timestamp, never a counter (no read-modify-write).
async function placeInVessel(player, row, vessel, { stacked = false } = {}) {
  if (row.inv_id === vessel.inv_id) return { type: 'error', message: `You can't put the ${vessel.name} in itself.` };
  if (row.custom_data?.cooking) return { type: 'error', message: `Not while it's on the heat.` };

  const cap = containerCapacity({ ...vessel, tags: vessel.tags, kind: 'item' });
  const used = await containerContentsWeight(vessel.inv_id);
  const adding = (row.weight || 0) * (row.quantity || 1);
  if (cap && used + adding > cap) {
    return { type: 'error', message: `The ${vessel.name} won't hold that too.` };
  }

  await query(
    stacked
      ? `UPDATE player_inventory
            SET container_id=$1, is_equipped=0, slot=NULL,
                custom_data = COALESCE(custom_data, '{}'::jsonb) || jsonb_build_object('stacked_at', $3::bigint)
          WHERE id=$2`
      : 'UPDATE player_inventory SET container_id=$1, is_equipped=0, slot=NULL WHERE id=$2',
    stacked ? [vessel.inv_id, row.inv_id, Date.now()] : [vessel.inv_id, row.inv_id],
  );
  cookSfx(player, { action: 'stir', material: sfxMaterial(row), intensity: 0.4 });
  const contents = await vesselContents(vessel.inv_id);
  return {
    type: 'use',
    message: `You put ${shownName(row)} in the ${vessel.name}. <span class="text-dim">${contents.length} thing${contents.length === 1 ? '' : 's'} in it now: "plate ${vessel.name}" when it's right.</span>`,
  };
}

// `stack ham on cheese`: the target may be the vessel or the top layer in one.
// see plugins/cooking/README.md#stack--building-one-the-way-youd-say-it
// ⚠ Order is display only: `stacked_at` never reaches signature, match, name or
// band, since `stow` sets no order and both routes must make the same sandwich.
async function cmdStack(args, raw, player) {
  const str = args.join(' ').trim();
  if (!str) return { type: 'error', message: `Stack what on what? <span class="text-dim">("stack cheese on bread")</span>` };

  const m = str.match(/^(.*?)\s+(?:on top of|onto|on|in)\s+(?:the\s+)?(.+)$/i);
  if (!m) return { type: 'error', message: `Stack it on what? <span class="text-dim">("stack cheese on bread")</span>` };
  const whatStr = m[1].trim();
  const ontoStr = m[2].trim();

  let vessel = await resolveInventoryItem(player, { tag: 'vessel', name: ontoStr, topLevel: true, fromNearby: true });
  if (!vessel) {
    const { rows } = await query(
      `SELECT c.id AS inv_id, c.item_id, c.quantity, c.custom_data,
              ci.name, ci.tags, ci.weight, ci.flags
         FROM player_inventory pi
         JOIN player_inventory c ON c.id = pi.container_id
         JOIN items ci ON ci.id = c.item_id
         JOIN items i  ON i.id  = pi.item_id
        WHERE pi.player_id = $1
          AND (i.name ILIKE $2 OR pi.custom_data->>'name' ILIKE $2)
          AND jsonb_exists(ci.tags, 'vessel')
        ORDER BY (pi.custom_data->>'stacked_at') DESC NULLS LAST
        LIMIT 1`,
      [player.id, `%${ontoStr}%`],
    );
    vessel = rows[0] || null;
  }
  if (!vessel) return { type: 'error', message: `There's no "${ontoStr}" here to stack anything on.` };

  // Resolved here, not via `addToVessel`, so `stack bread on ham` skips the
  // bottom slice and finds a second one.
  const all = await resolveInventoryItem(player, { name: whatStr, topLevel: true, all: true });
  const candidates = (Array.isArray(all) ? all : []).filter(r => r.inv_id !== vessel.inv_id);
  if (!candidates.length) {
    const self = (Array.isArray(all) ? all : []).length;
    return { type: 'error', message: self
      ? `The only "${whatStr}" you have is the one you're stacking on.`
      : `You don't have "${whatStr}".` };
  }

  const placed = await placeInVessel(player, candidates[0], vessel, { stacked: true });
  if (placed.type === 'error') return placed;

  const contents = await vesselContents(vessel.inv_id);
  const layers = stackOrder(contents);
  const edible = hasTag(vessel, 'edible_vessel');
  const head = `You lay ${shownName(candidates[0])} on${edible ? ` the ${vessel.name}` : `to the ${vessel.name}`}.`;
  return {
    type: 'use',
    message: `${head}\n<span class="text-dim">${edible ? 'Bottom to top' : 'In it'}: ${layers.map(shownName).join(', ')}: "plate ${vessel.name}" when it's right.</span>`,
  };
}

// Bottom to top; unstamped (`stow`ed) rows sit at the bottom.
function stackOrder(contents) {
  return [...contents].sort((a, b) =>
    (Number(a.custom_data?.stacked_at) || 0) - (Number(b.custom_data?.stacked_at) || 0));
}

registerAction({
  type: 'cooking.mix_vessel',
  handler: async ({ actor, params }) => {
    const vessel = await resolveInventoryItem(actor, { tag: 'vessel', name: params.vessel, topLevel: true, fromNearby: true });
    if (!vessel) return undefined;   // not a cooking vessel either — drinks says its piece
    return params.ingredient
      ? addToVessel(actor, params.ingredient, vessel)
      : plateVessel(vessel, actor);
  },
});

// Where the stove-or-lab pick lands. ⚠ Plugin verbs replay through an Action,
// never `{ verb }`, which only reaches engine builtins (docs/commands.md).
registerAction({
  type: 'cooking.station_choice',
  handler: async ({ actor, params }) => (params.target?._cookKind === 'drug' && hasSynthesis())
    ? toDrugs(actor, null, null)
    : (await cmdWorkspace(['kitchen'], '', actor)) || { type: 'error', message: 'Cook what?' },
});

// Where the range-or-microwave pick lands; the food rode in on the candidate.
registerAction({
  type: 'cooking.appliance_choice',
  handler: ({ actor, params, context }) => {
    const f = params.target;
    if (!f?._kind) return { type: 'error', message: 'Cook what?' };
    return cookFood(f._food || '', actor, context?.broadcast, f);
  },
});

// Plating: a bonus only, never required (see plateVessel). A platter pays more
// only from PLATTER_MIN_COMPONENTS up; below that it pays plate money.
const PLATE_BONUS = 0.35 * BAND_SCALE;
const PLATTER_BONUS = 0.6 * BAND_SCALE;
const PLATTER_MIN_COMPONENTS = 3;

// No dishware: a paper-plate line, never a nag to buy plates. ⚠ Never make the
// paper plate an item; a consumable fallback would make plates required.
const IMPROVISED_PLATING = [
  `Off a paper plate, because that's what there is.`,
  `Onto a paper plate that goes soft under it almost immediately.`,
  `A paper plate, doubled up, because one was never going to hold.`,
  `Straight onto a paper plate. It bows in the middle and you eat faster than you meant to.`,
  `A paper plate from a stack somebody else bought. There are four left.`,
];

async function platingBonus(player, componentCount = 1) {
  const improvised = () => ({
    bonus: 0,
    note: IMPROVISED_PLATING[Math.floor(Math.random() * IMPROVISED_PLATING.length)],
    improvised: true,
  });

  const dish = await resolveInventoryItem(player, {
    tag: 'dishware', topLevel: true, fromNearby: true, all: true,
  });
  const kinds = new Set((dish || []).map(r => r.tags?.dishware_kind).filter(Boolean));
  const names = new Map((dish || []).map(r => [r.tags?.dishware_kind, r.name]));
  if (!kinds.has('plate')) return improvised();

  const platter = (dish || []).find(r => /platter/i.test(r.name || ''));
  if (platter && componentCount >= PLATTER_MIN_COMPONENTS) {
    return { bonus: PLATTER_BONUS, note: `Laid out properly on the ${platter.name}.` };
  }
  return { bonus: PLATE_BONUS, note: `Served on a ${names.get('plate') || 'plate'} like a person.` };
}

export const _plating = { platingBonus, PLATE_BONUS, PLATTER_BONUS, PLATTER_MIN_COMPONENTS };

// ── Dressing the plate on the Stage's pass (docs/proposals/kitchen-stage.md) ─
// What a laid-out plate adds at `plate`. Nothing without a fresh stamp, and
// nothing for a layout at or under par.
export function dressBonus(dressed, now = Date.now()) {
  if (!dressed || !(now - Number(dressed.at) <= DRESS_TTL_MS)) return 0;
  const s = Math.max(0, Math.min(1, Number(dressed.score) || 0));
  return s <= DRESS_PAR ? 0 : DRESS_MAX * (s - DRESS_PAR) / (1 - DRESS_PAR);
}

const dressings = new Map();

// `dressplate <vessel id>`: the Stage asking to lay out a pan's contents. It
// answers with what is in the pan, in the shapes the pass draws.
async function cmdDressPlate(args, raw, player) {
  if (!stageOpen(player.id)) return { type: 'error', message: `Dress it with your eyes, then. Or just plate it.` };
  const vesselId = args[0];
  const { rows } = await query(
    `SELECT pi.id, pi.custom_data, i.tags, i.name FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1 AND (pi.id = $2 OR pi.container_id = $2)`, [player.id, vesselId]);
  const vessel = rows.find(r => String(r.id) === String(vesselId));
  const contents = rows.filter(r => String(r.id) !== String(vesselId) && profileNameFor(r) && !isMedium(r));
  if (!vessel || !contents.length) return { type: 'error', message: `There's nothing in it to lay out.` };
  const nonce = randomUUID();
  dressings.set(String(player.id), { nonce, vesselId: String(vessel.id) });
  return {
    type: 'plating_game', vessel: vessel.id, nonce,
    // Something in the pan that pours: the pass offers a line of sauce.
    sauce: contents.some(r => ['liquid', 'dairy', 'fat_or_oil'].includes(profileNameFor(r))),
    components: contents.map(r => ({ id: r.id, name: r.custom_data?.name || r.name,
      look: { profile: r.custom_data?.cooking?.profile || profileNameFor(r), matter: tagValue(r, 'matter', null), portion: r.custom_data?.portion || null },
      cook: r.custom_data?.cooking ? checkCooking(r) : null })),
  };
}

// `dressresolve <vessel id> <nonce> <score>`, or `... abort`. Not a player verb.
async function cmdDressResolve(args, raw, player) {
  const [vesselId, nonce, scoreArg] = args;
  const key = String(player.id), pend = dressings.get(key);
  if (!pend || pend.nonce !== nonce || pend.vesselId !== String(vesselId)) return { type: 'error', message: `That plate has gone cold.` };
  dressings.delete(key);
  if (scoreArg === 'abort') return { type: 'noop' };
  const score = Math.max(0, Math.min(1, Number(scoreArg) || 0));
  await query(`UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || jsonb_build_object('dressed', $3::jsonb)
                WHERE id = $1 AND player_id = $2`, [vesselId, player.id, JSON.stringify({ score, at: Date.now() })]);
  return { type: 'noop' };
}

// `drain`: takes cooking starch off the heat wherever it is in its window (drain
// short, finish in the sauce) and tips the medium. A strainer is rewarded, not
// required.
const DRAIN_PENALTY = 1;   // bands lost draining without a strainer

// ⚠ `drain` is borrowed, never owned: the ATM plugin's `drain` is a specialized
// action, reached only when this returns undefined. Claim only a named target
// that resolved to ours; once it resolves, a refusal is ours to give.
async function cmdDrain(args, raw, player) {
  const nameStr = args.join(' ').trim();
  // Bare `drain` is ours only with a vessel in reach; otherwise it's the ATM's.
  if (!nameStr) {
    const anyVessel = await resolveInventoryItem(player, { tag: 'vessel', topLevel: true, fromNearby: true });
    return anyVessel ? { type: 'error', message: `Drain what? The ${anyVessel.name}, if it's pasta you mean.` } : undefined;
  }

  const vessel = await resolveInventoryItem(player, { tag: 'vessel', name: nameStr, topLevel: true, fromNearby: true });
  const rows = vessel
    ? await vesselContents(vessel.inv_id)
    : [await resolveInventoryItem(player, { name: nameStr, topLevel: false })].filter(Boolean);
  if (!rows.length) return vessel ? { type: 'error', message: `There's nothing in the ${vessel.name}.` } : undefined;

  // Only starch on the heat is drainable.
  const wet = rows.filter(r => profileNameFor(r) === 'dry_starch' && r.custom_data?.cooking);
  if (!wet.length) {
    return { type: 'error', message: `There's nothing in there that needs draining. It's pasta and rice that come out of their water.` };
  }

  const strainer = await resolveInventoryItem(player, { tag: 'dishware', topLevel: true, fromNearby: true });
  const clean = !!strainer && (strainer.tags?.dishware_kind === 'strainer');

  // Only the medium leaves; stock is an ingredient and stays.
  const mediumRows = rows.filter(isMedium);

  const out = [];
  for (const row of wet) {
    const session = row.custom_data.cooking;
    const profile = sessionProfile(session);
    const check = await skillCheck(player, 'cooking', profile?.difficulty ?? 4);
    const now = Date.now();
    const result = evaluate(session, profile, now, check.margin);
    const done = plateDoneness(session, profile, now);

    // Drained starch stays finishable (the `stayFinishable` seam) so `plate` still resolves the meal.
    let band = result.band;
    if (!clean) {
      const i = Math.max(0, bandIndex(band) - DRAIN_PENALTY);
      band = QUALITY_BANDS[i];
    }
    await freeAppliance(session);
    await endSession(row.inv_id, band, done, null, true, { drained: true });
    out.push(`${row.name}: ${band}${done ? `, ${done}` : ''}`);
  }

  if (mediumRows.length) {
    await query('DELETE FROM player_inventory WHERE id = ANY($1)', [mediumRows.map(r => r.inv_id)]);
    if (vessel) await dryVessel(vessel.inv_id);
  }

  const how = clean
    ? `You tip the ${vessel?.name || 'pan'} into the ${strainer.name} and the water goes.`
    : `You drain it with the lid and your nerve. Some of it goes down the drain with the water.`;
  return { type: 'output', message: [
    how,
    ...out.map(l => `  ${l}`),
    `<span class="text-dim">Still finishable: get it into the sauce before it sits.</span>`,
  ].join('\n') };
}

// fill / empty. ⚠ Water in a pan is an ingredient row, never a `fluid_amount`
// scalar: every cooking reader reads contents. This runs before fillable, so it
// must fall through (undefined) for anything not cookware, drinkware included.
const WATER_ITEM = 'item_water';

// ⚠ A zone can be its own water source (`flags.water_source`), because a
// transient zone can never hold furniture. Checked first: no round trip.
async function waterSourceIn(zoneId) {
  const z = getZone(zoneId);
  if (z?.flags?.water_source) return { id: `zonewater_${zoneId}`, name: z.name };
  const f = getZoneFurniture(zoneId).find(r => Object.hasOwn(r.flags || {}, 'water_source'));
  return f ? { id: f.id, name: f.name } : null;
}

async function fillVessel(args, raw, player) {
  const nameStr = args.join(' ').replace(/\s+(?:from|at)\s+.*$/i, '').trim();
  if (!nameStr) return undefined;
  const vessel = await resolveInventoryItem(player, { tag: 'vessel', name: nameStr, topLevel: true, fromNearby: true });
  if (!vessel || hasTag(vessel, 'fillable')) return undefined;

  // Bowls and bread never see heat.
  const kind = tagValue(vessel, 'vessel_kind', null);
  if (kind === 'bowl' || kind === 'bread') {
    return { type: 'error', message: `A ${vessel.name} is for working in, not for boiling in.` };
  }

  const src = await waterSourceIn(player.current_zone);
  if (!src) return { type: 'error', message: `There's no water here to fill the ${vessel.name} from.` };

  const contents = await vesselContents(vessel.inv_id);
  if (contents.some(isMedium)) return { type: 'error', message: `The ${vessel.name} already has water in it.` };
  // ⚠ Topping up a pan on the heat is allowed: it's the answer to boiling dry.
  const live = contents.some(r => r.custom_data?.cooking);

  // Foul source, foul water: `hazards` on the row carries it through plating.
  const contam = await dispatchAction({ type: 'bodily.toiletContamination', params: { furnitureId: src.id } });
  const foul = !!(contam?.fouled || contam?.peed);

  await query(
    `INSERT INTO player_inventory (id, player_id, item_id, quantity, container_id, custom_data)
     VALUES ($1, $2, $3, 1, $4, $5::jsonb)`,
    [randomUUID(), player.id, WATER_ITEM, vessel.inv_id, JSON.stringify(foul ? { hazards: { disease_risk: true } } : {})]
  );

  cookSfx(player, { action: 'pour', material: 'liquid', flow: 0.9 });
  // Restarts the evaporation clock; deliberately does not clear a scorch.
  const topped = live ? await rewetVessel(vessel.inv_id) : 0;
  return { type: 'use', message: (foul
    ? `You fill the ${vessel.name} from the ${src.name}. <span style="color:var(--red)">The water comes out cloudy and wrong. Cooking in this won't make it clean.</span>`
    : `You fill the ${vessel.name} from the ${src.name}.`)
    + (topped ? ` <span class="text-dim">It steadies straight away.</span>` : '') };
}

// The one body of `empty <pan>` and `pour <pan> into <thing>`.
async function tipVessel(vessel, tgtName, player) {
  const contents = await vesselContents(vessel.inv_id);
  const fluids = contents.filter(isFluid);
  if (!fluids.length) return undefined;   // nothing of ours in it — fall through
  if (contents.some(r => r.custom_data?.cooking)) {
    return { type: 'error', message: `Not while it's on the heat with something cooking in it.` };
  }

  let target = null;
  if (tgtName) {
    target = await resolveInventoryItem(player, { tag: 'vessel', name: tgtName, topLevel: true, fromNearby: true });
    // ⚠ Fall through, never refuse: drinks and fillable handle these verbs after us.
    if (!target) return undefined;
    if (String(target.inv_id) === String(vessel.inv_id)) {
      return { type: 'error', message: `Into itself?` };
    }
    const cap = Number(tagValue(target, 'container', Infinity));
    if (Number.isFinite(cap)) {
      const have = await containerContentsWeight(target.inv_id);
      const adding = fluids.reduce((n, r) => n + (Number(r.weight) || 0) * (Number(r.quantity) || 1), 0);
      if (have + adding > cap) return { type: 'error', message: `The ${target.name} won't hold all that.` };
    }
  }

  await tipFluids(fluids, target?.inv_id || null);
  if (fluids.some(isMedium)) await dryVessel(vessel.inv_id);
  cookSfx(player, { action: 'pour', material: 'liquid', flow: 1 });
  const what = fluidNames(fluids);
  return { type: 'use', message: target
    ? `You pour the ${what} out of the ${vessel.name} and into the ${target.name}.`
    : `You tip the ${what} out of the ${vessel.name}.` };
}

async function emptyVessel(args, raw, player) {
  const str = args.join(' ').trim();
  if (!str) return undefined;
  const m = str.match(/^(.*?)\s+(?:into|in|onto|on|over)\s+(?:the\s+)?(.+)$/i);
  const nameStr = (m ? m[1] : str).trim();
  const vessel = await resolveInventoryItem(player, { tag: 'vessel', name: nameStr, topLevel: true, fromNearby: true });
  if (!vessel || hasTag(vessel, 'fillable')) return undefined;
  return tipVessel(vessel, m ? m[2].trim() : null, player);
}

// `cookbook [dish]`. The card renders from the same template the matcher and
// clock use, so it can't drift. An undiscovered dish shows name and blurb only.
async function cmdCookbook(args, raw, player) {
  // `cookbook text`: stripped before the dish lookup.
  const forceText = (args[0] || '').toLowerCase() === 'text';
  const q = (forceText ? args.slice(1) : args).join(' ').trim().toLowerCase();
  const { known } = await cookbookState(player.id);

  if (!q) {
    const rows = Object.entries(DISHES).map(([key, t]) => {
      const band = known.get(key);
      return band && band !== UNTRIED
        ? `  · ${t.noun} <span class="text-dim">best: ${band}</span>`
        : known.has(key) ? `  · ${t.noun}` : `  <span class="text-dim">· ${t.noun}: untried</span>`;
    });
    // A pick-one-of-N that grows with content: the list dialog's case.
    if (!forceText) {
      return {
        type: 'list_dialog',
        title: 'Cookbook',
        subtitle: `${known.size} of ${Object.keys(DISHES).length} worked out`,
        rows: Object.entries(DISHES).map(([key, t]) => ({
          group: known.has(key) ? 'Known' : 'Not yet worked out',
          label: t.noun,
          detail: known.get(key) && known.get(key) !== UNTRIED ? `best: ${known.get(key)}` : '',
          command: `cookbook ${t.noun}`,
        })).sort((a, b) => (a.group === b.group ? 0 : a.group === 'Known' ? -1 : 1)),
        footer: 'cookbook <dish> for weights, method and timing · cookbook text to read it in the log',
      };
    }
    return { type: 'output', message: [
      `<span class="text-accent">COOKBOOK</span> <span class="text-dim">(${known.size}/${Object.keys(DISHES).length} worked out)</span>`,
      '',
      ...rows,
      '',
      `<span class="text-dim">cookbook &lt;dish&gt; for weights, method and timing.</span>`,
    ].join('\n') };
  }

  const hit = Object.entries(DISHES).find(([k, t]) => k === q || t.noun.toLowerCase() === q)
           || Object.entries(DISHES).find(([k, t]) => t.noun.toLowerCase().includes(q) || k.includes(q));
  if (!hit) return { type: 'error', message: `You've never heard of a "${q}".` };
  const [key, template] = hit;
  if (!known.has(key)) {
    return { type: 'output', message: [
      `<span class="text-accent">${template.noun.toUpperCase()}</span>`,
      `<span class="text-dim">${template.blurb}</span>`,
      '',
      `<span class="text-dim">You know it exists. You don't know how to make it: nobody has shown you and you haven't worked it out. Cook something like it a few times and it'll come.</span>`,
    ].join('\n') };
  }
  // The item lookup names key items instead of printing raw ids.
  return { type: 'output', message: describeDish(key, template, COOK_SECONDS_PER_KG, id => getItem(id)) };
}

export const commands = {
  // Methods (`boil`, `fry`...). ⚠ Spread first so none can shadow a verb below.
  ...methodCommands,
  stack: cmdStack,
  layer: cmdStack,
  cook: cmdCook,
  cookbook: cmdCookbook,
  recipe: cmdRecipe,
  shoplist: cmdShoplist,
  drain: cmdDrain,
  // The appliance as the verb skips the SIFT prompt.
  microwave: async (args, raw, player, broadcast) => {
    const mws = microwavesInZone(player.current_zone);
    if (!mws.length) return { type: 'error', message: `There's no microwave here.` };

    // "microwave <food> [seconds]": the time is set up front; omitted, it runs
    // exactly as long as the food needs.
    const argStr = args.join(' ').trim();
    if (!argStr) return { type: 'error', message: `Microwave what, and for how long? ("microwave stew 40")` };
    const m = argStr.match(/^(.*?)s+(d+)s*(?:s|sec|secs|seconds)?$/i);
    const food = (m ? m[1] : argStr).trim();
    const secs = m ? Math.min(600, Math.max(1, Number(m[2]))) : null;

    return cookFood(food, player, broadcast,
      { ...mws[0], _kind: 'microwave', _runMs: secs ? secs * 1000 : null });
  },
  plate: cmdPlate,
  kitchenkit: cmdKitchenKit,
  taste: cmdTaste,
  score: cmdScore,
  tenderise: cmdTenderise,
  tenderize: cmdTenderise,
  marinate: cmdMarinate,
  chop: cmdChop,
  cut: cmdChop,
  butter: cmdButter,
  mince: cmdMince,
  cure: cmdCure,
  deglaze: cmdDeglaze,
  scour: cmdScour,
  doneness: cmdDoneness,
  mise: cmdMise,
  prep: cmdMise,
  stove: cmdStove,
  flip: (args, raw, player) => handleInteraction('flip', args, player),
  stir: (args, raw, player) => handleInteraction('stir', args, player),
  // The Kitchen Stage saying it opened or closed (stage.js), and its board
  // reporting where the strokes fell. Not player verbs.
  kitchenstage: cmdKitchenStage,
  chopresolve: cmdChopResolve,
  dressplate: cmdDressPlate,
  dressresolve: cmdDressResolve,
};

// What `examine <vessel>` adds: each ingredient's stage, the pan's fond and the
// dish it would make now. Derived only: no writes, no clock.
async function describeVessel(vesselRow, player) {
  const contents = await vesselContents(vesselRow.id);
  const lines = [];

  const cooking = contents.filter(r => r.custom_data?.cooking);
  for (const row of cooking) {
    const state = checkCooking(row);
    if (state) lines.push(`  ${shownName(row)}: ${state.text}`);
  }
  const idle = contents.filter(r => !r.custom_data?.cooking && profileNameFor(r));
  for (const row of idle) {
    const prep = prepText(row.custom_data || {});
    const state = isModifier(row) ? 'seasoning, not on the heat' : 'in, but not cooking yet';
    lines.push(`  ${shownName(row)}: ${state}${prep ? `, ${prep}` : ''}`);
  }

  // Layer order, for an edible vessel only. `stacked_at` is read here and
  // nowhere else (see `cmdStack`).
  if (hasTag(vesselRow, 'edible_vessel') && contents.length) {
    const order = stackOrder(contents);
    lines.push(`  <span class="text-dim">Bottom to top: ${vesselRow.name}, ${order.map(shownName).join(', ')}.</span>`);
  }

  const fondLine = fondText(vesselRow.custom_data?.fond);
  if (fondLine) {
    lines.push(`  <span class="text-dim">${vesselRow.custom_data?.deglazed ? 'lifted: it went into the sauce' : fondLine}</span>`);
  }

  // The dish it would make right now, never how to improve it. Via `dishFor`
  // (not `matchDish`), so it agrees with `plate`.
  if (contents.some(r => profileNameFor(r))) {
    const kind = tagValue(vesselRow, 'vessel_kind', null);
    const food = contents.filter(r => profileNameFor(r));
    const sig = signature(food, profileNameFor);
    const dish = dishFor(sig, kind, new Set(contents.map(r => r.item_id)),
      { isBread: hasTag(vesselRow, 'edible_vessel') });
    lines.push(dish.slop
      ? `  <span class="text-dim">There's something in here that isn't food. It isn't going to add up to a dish.</span>`
      : `  <span class="text-dim">As it stands, this is going to be ${dishName(dish.template, food, profileNameFor, tagValue)}.</span>`);
  }

  return lines.length ? lines.join('\n') : null;
}

// Everything on the heat in this room, whoever put it there.
// ⚠ `smell` has no cooldown: serve from `cooksOnAppliances` (RAM), never the DB.
async function kitchenSmells(zone, player) {
  const stoves = stovesInZone(zone.id).filter(f => f.flags?.busy_until);
  if (!stoves.length) return [];

  const rows = cooksOnAppliances(stoves.map(f => f.id))
    .map(c => ({ custom_data: { cooking: c.session }, name: c.name }));
  if (!rows.length) return [];

  // Skill decides precision, never whether you notice burning.
  const skill = await effectiveSkill(player, 'cooking').catch(() => 0);
  const expert = skill >= TASTE_TIERS.expert;
  const competent = skill >= TASTE_TIERS.competent;

  const out = [];
  const now = Date.now();
  for (const r of rows) {
    const session = r.custom_data?.cooking;
    const profile = sessionProfile(session);
    if (!profile) continue;
    const state = endStateAt(session, profile, now);
    const what = competent ? r.name : 'something';

    if (state === 'burnt') {
      out.push({ text: `${what} burning: acrid, and past any hope`, strength: 10, source: 'burning' });
    } else if (state === 'over') {
      out.push({ text: expert ? `${what} catching, a hard edge coming off it` : `something cooking a shade too long`, strength: 7 });
    } else if (state === 'peak') {
      out.push({ text: competent ? `${what}, and it smells exactly right` : `something cooking, and it smells good`, strength: 5 });
    } else if (competent) {
      out.push({ text: `${what} on the heat, still early`, strength: 3 });
    }
  }
  return out;
}

// What a kitchen sounds like, including through a wall. RAM only, like smells.
function kitchenSounds(zone) {
  const stoves = stovesInZone(zone.id).filter(f => f.flags?.busy_until);
  if (!stoves.length) return [];
  const live = cooksOnAppliances(stoves.map(f => f.id));
  if (!live.length) return [];

  const now = Date.now();
  const out = [];
  for (const c of live) {
    const profile = sessionProfile(c.session);
    if (!profile) continue;
    const state = endStateAt(c.session, profile, now);
    const wet = c.session.profile === 'liquid';
    if (state === 'burnt' || state === 'over') {
      out.push({ text: wet ? `something boiling hard and angry` : `fat spitting, and nobody turning it`, strength: 7, source: 'fire' });
    } else {
      out.push({ text: wet ? `a pot ticking over somewhere` : `the steady sizzle of something cooking`, strength: 5 });
    }
  }
  return out;
}

export const specializedActions = [
  { verb: 'read', requiredTag: 'recipe_card', handler: readRecipeCard },
  // Cookware only; a fillable mug stays fillable's (see fillVessel).
  { verb: 'fill', requiredTag: 'vessel', handler: fillVessel },
  { verb: 'empty', requiredTag: 'vessel', handler: emptyVessel },
  // ⚠ Sees `pour` before drinks and fillable; must hand theirs back (see pourFat).
  { verb: 'pour', requiredTag: 'food_profile', handler: pourFat },
  // Declaration-only (handler: null), so kitchen furniture advertises the HUD on
  // examine. Cooking declares it because these flags are its vocabulary; they
  // must match what `workspaceProvider` gates on (workspace.js `kitchenFurniture`).
  { verb: 'workspace', requiredFlag: 'stove_tier', handler: null },
  { verb: 'workspace', requiredFlag: 'microwave', handler: null },
  { verb: 'workspace', requiredFlag: 'dish_cabinet', handler: null },
];

// Illness chance from the stamped doneness; risk numbers live on the profile.
function donenessRisk(cd) {
  const done = cd?.doneness;
  if (!done) return 0;
  for (const profile of Object.values(PROFILES)) {
    const level = (donenessLevels(profile) || []).find(l => l.name === done);
    if (level) return level.risk || 0;
  }
  return 0;
}

export const hooks = {
  'item.checkCooking': (invRow) => checkCooking(invRow),
  'item.describeVessel': (invRow, player) => describeVessel(invRow, player),
  // Read by the engine eat path; the curves live here, not in the engine.
  'cooking.restMultiplier': (cd) => restMultiplier(cd?.plated_at, cd?.rests),
  'cooking.wellFedMs': (cd) => rewardFor(cd?.cook_quality).wellFedMs,
  'cooking.restText': (cd) => restText(cd?.plated_at, cd?.rests),
  'cooking.flavour': (cd) => flavourLines(cd, restPhase(cd)),
  'cooking.donenessRisk': (cd) => donenessRisk(cd),
  // Deliberately vague: never a band or seasoning, but always says burning.
  'zone.smells': (zone, player) => kitchenSmells(zone, player),
  'zone.sounds': (zone) => kitchenSounds(zone),
  'cooking.prepText': (cd) => prepText(cd),
  // A gather-hook, not an import, so neither plugin depends on the other.
  'workspace.provider': (player) => workspaceProvider(player),
  // The kitchen's 3-D rung (docs/proposals/kitchen-stage.md), offered at `visual` only.
  'workspace.view': (ctx) => offerStage(ctx),
  // Mark shopping-list items on shelves and in containers.
  'shop.stock': (ctx) => markShelf(ctx),
  'container.view': (ctx) => markContainer({ view: ctx.view, playerId: ctx.player?.id }),
};

// Exposed for the regression harness.
export const _test = { donenessRisk, plateDoneness, findFreeStove, stovesInZone, labsInZone, cookStations, vesselStats, vesselContents, hasCookingLiquid, needsBoiling, measureOf };
