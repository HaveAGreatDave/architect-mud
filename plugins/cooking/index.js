// Cooking — `heat <food|vessel>` at a stove (flags.stove_tier) in the room, or a
// carried portable oven (tags.portable_oven), turns raw/frozen food into
// something safe to eat. Background/lazy, no tick — see cook.js.
//
// Food carrying `tags.food_profile` cooks with depth on top of that: a peak
// window it can be pulled in, a burn point past it, handling that matters
// (`flip`/`stir`), and a quality band stamped when you `plate` it. Food without
// a profile behaves exactly as it always has — raw, then cooked, and that's all.
//
// Verb note: `cook` already belongs to the synthesis plugin (drug-cooking
// minigames) — `heat` avoids that collision entirely.
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { emit } from '../../server/engine/events.js';
import { getZoneFurniture } from '../../server/engine/world.js';
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
  STOVE_SPEED, PORTABLE_OVEN_SPEED, PORTABLE_OVEN_CAPACITY_G,
  BARE_VESSEL, DEFAULT_VESSEL, cookingIpFor, SMOKER_SPEED, SMOKER_PROFILE, SKILL_WEIGHT, FOND_PROFILES, MAX_CHOP_PIECES, BUTTER_BONUS, BUTTER_PORTION, MICROWAVE_SPEED,
  COOK_SECONDS_PER_KG, BAND_SCALE,
} from './config.js';
import { prepareCook, commitCooks, cookEnvironment, checkCooking, endSession, freeAppliance, sessionProfile, rescheduleNarration, cooksOnAppliances, forgetCook } from './cook.js';
import { QUALITY_BANDS, PROFILES, bandIndex, profileNameFor, isModifier, needsPrep, donenessLevels, defaultDoneness, achievedDoneness } from './profiles.js';
import { evaluate } from './quality.js';
import { handle as handleInteraction } from './interact.js';
import './help.js';
import { leavesFond, makeFond, fondState, fondModifier, fondText } from './fond.js';
import { portionOf, canChop, portionName, yieldOf } from './portions.js';
import { timeline, finishAt, endStateAt } from './quality.js';
import { DISHES, signature, matchDish, dishName, composeBand, seasoningBonus, seasoningIdeal, nounFor, UNKNOWN_DISH, GENERIC_SANDWICH, describeDish } from './dishes.js';
import { UNTRIED, cookbookState, learnRecipe, improveRecipe, recordAttempt, beatsRecorded, knownBonus, markRoutineIp,
         savedRecipes, saveRecipe, recipeBySignature, renameRecipe, forgetRecipe, improveSaved, slugify } from './knowledge.js';
import { inferDish, recipeSignature, improvisedIp } from './improvised.js';
import { cmdRecipe, learnFromWrittenCard } from './recipes.js';
import { cmdShoplist, markShelf, markContainer } from './shoplist-cmd.js';
import { rewardFor, restMultiplier, restText, RESTS_WELL, REST_PEAK_MS, REST_COLD_MS, REST_MIN_MS, TASTE_TIERS, TASTE_BITE } from './config.js';
import { tasteNotes, flavourLines } from './taste.js';
import { canMarinate, prepText } from './prep.js';
import { workspaceProvider } from './workspace.js';
import { cmdWorkspace } from '../workspace/index.js';

// Which phase of resting a plate is in, for the flavour line on eating.
const restPhase = cd => {
  if (!cd?.rests || !cd?.plated_at) return null;
  const age = Date.now() - cd.plated_at;
  if (age >= REST_COLD_MS) return 'cold';
  if (age >= REST_MIN_MS && age <= REST_PEAK_MS) return 'rested';
  return null;
};
import { DISCOVERY_IP, DISCOVERY_ATTEMPTS, MODIFIER_BONUS, MODIFIER_BONUS_CAP, OVER_SEASON_PENALTY, DEFAULT_SEASONING, STAGING,
         DISCOVERY_MIN_BAND, KNOWN_RECIPE_BONUS, RECIPE_MASTERY_IP, RECIPE_MASTERY_BAND } from './config.js';

// Any blade will do. `can_chop` is the kitchen-specific tag; `butchering` is
// what every knife in the game already carries, so all three existing blades
// work without a content edit.
const chopTool = player => resolveInventoryItem(player, { tag: ['can_chop', 'butchering'], topLevel: true, fromNearby: true });

// ── Sound ────────────────────────────────────────────────────────────────────
//
// Cooking emits SEMANTIC audio events and never a sound. It says "a chop landed
// on something wet at this intensity"; the audio plugin owns every acoustic
// decision from there. That separation is the point — the same vocabulary can be
// emitted by smithing or repair later and get sound for free, and this plugin
// never grows a table of per-food noises.
//
// The one thing cooking DOES own is the translation from its own profile
// catalog to the shared material vocabulary, because the profiles are its own.
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
// An item may override its class with `tags.material` — the SPARSE escape hatch.
// Authoring acoustic properties onto all 85 food items would be 425 hand-tuned
// numbers to express differences nobody can hear (a carrot and a potato chop
// identically at any resolution a game client reproduces). The class is right
// almost always; the override exists for the handful of genuine outliers — a
// bone in a haunch, a husk, a shell — and costs nothing when absent.
const sfxMaterial = row => tagValue(row, 'sound_material', null) || SFX_MATERIAL[profileNameFor(row)] || 'soft_food';

// Frozen is the one STATE worth knowing about, and the game already tracks it:
// `prepareCook` reads the same thermal environment to decide thaw time. A cut
// straight out of a freezer goes under the knife like wood, and that is a
// difference a player would actually hear.
async function sfxState(row, player) {
  if (row?.custom_data?.cooked) return 'cooked';
  const env = await cookEnvironment({ ...row, id: row.inv_id ?? row.id }, player).catch(() => null);
  if (!env) return null;
  return (env.delivering ? env.tier : env.ambientTier) === 'frozen' ? 'frozen' : null;
}

const cookSfx = (player, params) =>
  emit('cooking.sfx', { zoneId: player?.current_zone, playerId: player?.id, ...params });

const nounOf = row => nounFor(row, tagValue);

// The name the PLAYER has been shown. A per-instance `custom_data.name` is what
// `inventory` prints — butchered "feral dog meat", a minced cut — so anything
// reading the catalog name back at them is naming a different thing.
const shownName = row => row?.custom_data?.name || row?.name;

const DISH_ITEM = 'item_cooked_dish';

function stovesInZone(zoneId) {
  return getZoneFurniture(zoneId).filter(f => f.flags?.stove_tier);
}
// A microwave is its own appliance, not a stove tier — it has no heat setting to
// ride and produces a fundamentally different result (see MICROWAVE_* in config).
function microwavesInZone(zoneId) {
  return getZoneFurniture(zoneId).filter(f => f.flags?.microwave);
}
function labsInZone(zoneId) {
  return getZoneFurniture(zoneId).filter(f => f.flags?.crafting_station);
}

// Every surface in the room you could plausibly mean by "cook", tagged with
// which system owns it. SIFT scores these by name like any other candidate set —
// the furniture rows already carry `name`, which is all it needs.
function cookStations(zoneId) {
  return [
    ...stovesInZone(zoneId).map(f => ({ ...f, _cookKind: 'food' })),
    ...labsInZone(zoneId).map(f => ({ ...f, _cookKind: 'drug' })),
  ];
}

const hasSynthesis = () => getRegisteredActions().includes('synthesis.cook');
const toDrugs = (player, recipe, broadcast) =>
  dispatchAction({ type: 'synthesis.cook', actor: player, params: { recipe, broadcast } });
// The burner for this cook. STAGING: a stove already holding THIS vessel is the
// right answer even though it's busy — that's what lets a slow broth and a fast
// leaf be started minutes apart and still peak together. Otherwise, any free one.
function findFreeStove(stoves, vesselInvId = null) {
  const now = Date.now();
  if (STAGING && vesselInvId) {
    const holding = stoves.find(f => f.flags?.vessel_id === vesselInvId);
    if (holding) return holding;
  }
  return stoves.find(f => !f.flags?.busy_until || f.flags.busy_until <= now) || null;
}

// A vessel's thermal character, as two scalars. Not a simulation — one number
// widens the peak window, the other widens the forgiving band past it.
export function vesselStats(vesselRow) {
  if (!vesselRow) return BARE_VESSEL;
  return {
    d: Number(tagValue(vesselRow, 'heat_distribution', DEFAULT_VESSEL.d)),
    r: Number(tagValue(vesselRow, 'heat_retention', DEFAULT_VESSEL.r)),
  };
}

// Everything sitting inside a carried vessel, as resolved rows.
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

// `cook` is shared with the drug-synthesis system. Routing is target-first: if
// what you named is a cookable thing you're carrying, it's food. Otherwise it's
// a recipe, and synthesis says so far better than we could. The only genuinely
// ambiguous input is a bare `cook` in a room with both a stove and a lab — and
// that's the one case that earns a SIFT prompt.
async function cmdCook(args, raw, player, broadcast) {
  const nameStr = args.join(' ').trim();

  if (!nameStr) {
    const stations = cookStations(player.current_zone);
    const kinds = new Set(stations.map(s => s._cookKind));
    if (!stations.length) return { type: 'error', message: `There's nothing here to cook on.` };
    if (kinds.size > 1) {
      // A stove and a chem lab in the same room. Ask which, the same way every
      // other ambiguous target in the game asks.
      createSelectionState(player.id, stations, { dispatchType: 'cooking.station_choice', dispatchParam: 'target' });
      return {
        type: 'output',
        message: `Cook on which?\n${formatSelectionPage({ allCandidates: stations, visibleIndex: 0, pageSize: 5 })}`,
      };
    }
    // A bare `cook` at a stove is a request to SEE the kitchen, not a mis-typed
    // command: "Cook what?" answered a question nobody was asking. The HUD lists
    // what's out, what's stored and what's on the heat, and every action on it is
    // a verb you could have typed — so this is a shortcut, not a second surface.
    if (kinds.has('drug') && hasSynthesis()) return toDrugs(player, null, broadcast);
    return (await cmdWorkspace(['kitchen'], '', player)) || { type: 'error', message: 'Cook what?' };
  }

  // Named a station directly ("cook on the range" / "cook stove")? Honour it.
  const stations = cookStations(player.current_zone);
  if (stations.length > 1) {
    const s = siftResolve(nameStr, stations);
    if (s.type === 'match' && s.candidate._cookKind === 'drug' && hasSynthesis()) return toDrugs(player, null, broadcast);
    if (s.type === 'match' && s.candidate._cookKind === 'food') {
      return (await cmdWorkspace(['kitchen'], '', player)) || { type: 'error', message: 'Cook what?' };
    }
  }

  // Carrying something by that name that can actually be cooked → it's food.
  const carried = await resolveInventoryItem(player, { name: nameStr, tag: ['needs_cooking', 'vessel'], topLevel: true, fromNearby: true });
  if (!carried && hasSynthesis()) return toDrugs(player, nameStr, broadcast);
  return cookFood(nameStr, player, broadcast);
}

// Every heat source in the room, and what each one is. Used to let a player SAY
// which one they meant — a kitchen with a range and a microwave in it should not
// silently pick for you, because the two produce genuinely different meals.
function cookAppliances(zoneId) {
  return [
    ...stovesInZone(zoneId).map(f => ({ ...f, _kind: 'stove' })),
    ...microwavesInZone(zoneId).map(f => ({ ...f, _kind: 'microwave' })),
  ];
}

async function cookFood(nameStr, player, broadcast, wantAppliance = null) {
  // "cook X in|on <appliance>" — the player naming the device.
  //
  // Resolved against the appliances FIRST and only accepted if it actually
  // matches one, because `in` is already the vessel idiom ("stow steak in pan")
  // and "cook pan" has to keep meaning the pan. If the tail isn't an appliance,
  // the whole string stays the food name and nothing changes.
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
  if (vessel) {
    // Anything profiled counts as an ingredient, whether or not it strictly
    // needs cooking — a tomato belongs on the heat. MODIFIERS are the exception:
    // fat and aromatics season the dish and never take a session of their own,
    // so they can't burn away to nothing while the main is still cooking.
    foods = (await vesselContents(vessel.inv_id))
      .filter(r => (hasTag(r, 'needs_cooking') || profileNameFor(r)) && !isModifier(r));
    // An EDIBLE vessel goes on the heat as an ingredient of its own dish — you
    // toast the bread, not just what's on it. Every other vessel is equipment
    // and stays out of the scoring.
    if (hasTag(vessel, 'edible_vessel') && profileNameFor(vessel)) {
      foods.push({ ...vessel, container_id: null });
    }
    if (!foods.length) return { type: 'error', message: `There's nothing in the ${vessel.name} worth heating.` };

    // PREP. Combining whole things — a cut, a root, a bulb, a fruit — means
    // cutting them down first. Cooking ONE thing on its own doesn't (you're not
    // dicing a steak to sear it), which is why this gates the vessel path only.
    const prepWork = foods.filter(needsPrep);
    if (prepWork.length && !(await chopTool(player))) {
      return { type: 'error', message: `You can't do anything with ${prepWork[0].name} bare-handed. You need a knife.` };
    }
  } else {
    const foodRow = await resolveInventoryItem(player, { name: nameStr, topLevel: true });
    if (!foodRow) return { type: 'error', message: `You don't have "${nameStr}".` };
    foods = [foodRow];
  }

  const stoves = stovesInZone(player.current_zone);
  const microwaves = microwavesInZone(player.current_zone);
  let appliance = null;

  // TWO KINDS OF HEAT IN ONE ROOM is an ambiguous target, and the game already
  // has one answer for those: SIFT. Same prompt, same numbered list, same replay
  // through an Action that every other ambiguous pick in the game uses — rather
  // than silently choosing and mentioning the other one in a hint nobody reads.
  //
  // Only when the KINDS differ. Two stoves is not a question worth asking; a
  // range and a microwave produce genuinely different meals, so it is.
  if (!wantAppliance && stoves.length && microwaves.length) {
    // The engine's selection dispatch forwards only the chosen CANDIDATE, so the
    // food rides on the candidates themselves rather than needing a new seam.
    const options = cookAppliances(player.current_zone).map(f => ({ ...f, _food: nameStr }));
    createSelectionState(player.id, options, {
      dispatchType: 'cooking.appliance_choice', dispatchParam: 'target',
    });
    return {
      type: 'output',
      message: `Cook it on which?\n${formatSelectionPage({ allCandidates: options, visibleIndex: 0, pageSize: 5 })}`,
    };
  }

  // The player named one. Honour it — including choosing the microwave in a
  // kitchen that has a perfectly good range, which is a legitimate thing to want
  // when you are reheating something and do not care.
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
    appliance = f._kind === 'microwave'
      ? { id: f.id, name: f.name, heatTier: 'high', speed: MICROWAVE_SPEED, furnitureRow: f, microwave: true, runMs: f._runMs || null }
      : { id: f.id, name: f.name, heatTier: f.flags.stove_tier,
          speed: STOVE_SPEED[f.flags.stove_tier] || STOVE_SPEED.low, furnitureRow: f };
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
        return { type: 'error', message: `The ${stove.name} clicks but doesn't heat — no power reaching it.` };
      }
    }
    appliance = {
      id: stove.id, name: stove.name, heatTier: stove.flags.stove_tier,
      speed: STOVE_SPEED[stove.flags.stove_tier] || STOVE_SPEED.low, furnitureRow: stove,
    };
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
    Object.assign(appliance, { vessel: vesselStats(vessel), vesselName: vessel.name, vesselId: vessel.inv_id });
    if (Number.isFinite(cap)) appliance.capacityG = cap;
  }

  // Everything going on the heat together shares a container by construction —
  // they're all in the same vessel, or all uncontained — so the thermal
  // environment is resolved ONCE for the batch, not once per ingredient.
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

  // A microwave with no time set runs exactly as long as the food needs, so the
  // default is the correct answer — the dial is an option for the impatient
  // rather than a trap for someone who hasn't learned it yet.
  if (appliance.microwave && !appliance.runMs) {
    appliance.runMs = Math.max(...prepared.map(p => p.totalMs), 1000);
    for (const p of prepared) p.session.stopAt = p.session.startedAt + appliance.runMs;
  }
  await commitCooks(prepared, appliance);

  // Food meeting heat. A liquid goes on to boil; everything else spits. The
  // heat parameter is the burner tier, so a hotplate and a range sound different
  // without anyone authoring two cues.
  const loudest = prepared.map(p => p.session).find(Boolean);
  if (loudest) {
    if (appliance.microwave) {
      // A microwave doesn't sizzle — it hums and goes round. Three revolutions
      // reads as "it's running" without pretending to loop for the whole cook.
      cookSfx(player, { action: 'microwave', intensity: 0.6, flow: 3 });
    } else {
      const wet = loudest.profile === 'liquid';
      const tier = { low: 0.35, mid: 0.6, high: 0.9 }[appliance.heatTier] ?? 0.5;
      cookSfx(player, {
        action: wet ? 'boil' : 'sizzle',
        material: SFX_MATERIAL[loudest.profile] || 'wet_meat',
        heat: tier,
      });
    }
  }

  broadcast?.(player.current_zone, { type: 'zone_event', message: `${player.handle} starts cooking something.` }, player.id);
  // The dial is the microwave's only readout, and the number you set is the
  // whole decision — so say it back.
  const dial = appliance.microwave
    ? `\n<span class="text-dim">The dial is set to ${Math.round(appliance.runMs / 1000)} seconds. It starts turning.</span>`
    : '';
  // Say it when the pan came off the rack rather than out of your pack. The
  // vessel is used IN PLACE and never moves into inventory, so without this line
  // a pot would appear to cook itself out of nowhere.
  const pulled = vessel?.from_nearby
    ? `<span class="text-dim">You take the ${vessel.name} down from the ${vessel.from_nearby}.</span>\n`
    : '';
  return { type: 'output', message: pulled + messages.join('\n') + dial };
}

// Take it off the heat. This is where quality is decided — lazily, from the
// session's timestamps and the acts recorded against it, at the moment the
// player chose to stop. Nothing was simulated to get here.
async function cmdPlate(args, raw, player) {
  const nameStr = args.join(' ').trim();
  if (!nameStr) return { type: 'error', message: 'Plate what?' };

  // `plate <vessel>` resolves everything in it into one dish; `plate <food>`
  // keeps the original single-item behaviour below.
  const vessel = await resolveInventoryItem(player, { tag: 'vessel', name: nameStr, topLevel: true, fromNearby: true });
  if (vessel) return plateVessel(vessel, player);

  const food = await resolveInventoryItem(player, { name: nameStr, topLevel: false });
  if (!food) return { type: 'error', message: `You don't have "${nameStr}".` };

  const session = food.custom_data?.cooking;
  if (!session) return { type: 'error', message: `${food.name} isn't on the heat.` };
  const profile = sessionProfile(session);

  // Unprofiled food has no window and no bands — pulling it early just means it
  // isn't cooked yet, which the eat path already handles on its own.
  if (!profile) {
    if (Date.now() < finishAt(session)) return { type: 'error', message: `${food.name} isn't done yet.` };
    await freeAppliance(session);
    await endSession(food.inv_id, null);
    return { type: 'output', message: `You take ${food.name} off the heat.` };
  }

  const check = await skillCheck(player, 'cooking', profile.difficulty);
  const now = Date.now();
  // A lone cut plates onto a plate too. One component, so a platter never pays
  // here — a single steak on a serving platter is not presentation.
  const plating = await platingBonus(player, 1);
  const result = evaluate(session, profile, now, check.margin + plating.bonus);
  const done = plateDoneness(session, profile, now);

  // A smoke transforms what it produces; an ordinary cook just grades it.
  const smoked = session.smoking
    ? { profile: SMOKER_PROFILE, name: `smoked ${nounOf(food)}`, noun: `smoked ${nounOf(food)}` }
    : null;

  // Browning a component is a STEP, not the meal — it stays finishable so it
  // can go on to be the thing it was made for.
  const isComponent = !!food.custom_data?.crafted_quality;

  // Every taste was a mouthful, on a lone cut exactly as much as on a pot. The
  // vessel path has always charged for it; without this the bite is free the
  // moment you're cooking one thing, which is most of the time.
  const bites = Number(food.custom_data?.tasted) || 0;
  const tasteYield = bites ? Math.max(0.4, 1 - bites * TASTE_BITE) : 1;

  await freeAppliance(session);
  if (!(await endSession(food.inv_id, result.band, done, smoked, isComponent,
    tasteYield !== 1 ? { yield: tasteYield } : {}))) {
    return { type: 'error', message: `${food.name} is no longer on the heat.` };
  }

  // The per-use roll is the main award and is margin-shaped, so grinding the
  // same trivial cook has poor odds by construction. The flat bonus is the only
  // thing that pays for actually excelling.
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
  // Burnt is burnt. Nothing about a nice plate rescues it, and saying otherwise
  // over a ruined pan would read as the game taking the piss.
  const flourish = (plating.note && result.endState !== 'burnt')
    ? `\n<span class="text-dim">${plating.note}</span>` : '';
  return { type: 'output', message: verdict + flourish };
}

// The doneness a cook actually produced — how far through the cook it was pulled,
// mapped to the nearest level. Truth, not intention: aim for rare, wander off,
// and the food records that you made it well done.
function plateDoneness(session, profile, now) {
  if (!donenessLevels(profile)) return null;
  const cookStart = session.startedAt + (session.thawMs || 0);
  const fraction = session.cookMs > 0 ? (now - cookStart) / session.cookMs : 1;
  return achievedDoneness(profile, fraction);
}

// Turn a vessel of cooked ingredients into one dish. Each ingredient is scored
// exactly as it would be alone — same timeline, same ceiling — and the dish
// composes from those bands. Cooking well is still the thing that matters; the
// combination only decides what you end up holding and how high the lid is.
async function plateVessel(vessel, player) {
  // Independent reads, so they go together — the cookbook doesn't depend on
  // what's in the pan, and what's in the pan doesn't depend on the cookbook.
  const [contents, { known, progress, lastIpAt }] = await Promise.all([
    vesselContents(vessel.inv_id),
    cookbookState(player.id),
  ]);
  const kind = tagValue(vessel, 'vessel_kind', null);
  const isBowl = kind === 'bowl';
  const isBread = kind === 'bread';
  // COLD WORK: a vessel whose contents are assembled rather than heated. A bowl
  // is mashed, bread is stacked; neither ever takes a cook session, so their
  // ingredients are scored at their RAW target instead of off a timeline. That's
  // why the dips lean on things that are excellent raw — and why a sandwich made
  // of good ingredients is a good sandwich without a stove in the room.
  const coldWork = isBowl || isBread;
  const cooking = contents.filter(r => r.custom_data?.cooking);

  // Bread, unlike a bowl, CAN go on the heat — a toasted sandwich is a real
  // thing. So anything already carrying a session is excluded here or it would
  // be scored twice: once off its timeline and once at its raw target.
  const rawWorked = coldWork
    ? contents.filter(r => profileNameFor(r) && !isModifier(r) && !r.custom_data?.cooking)
    : [];
  if (!cooking.length && !coldWork) return { type: 'error', message: `Nothing in the ${vessel.name} is on the heat.` };
  if (coldWork) {
    if (!rawWorked.length) {
      return { type: 'error', message: isBread
        ? `There's nothing on the ${vessel.name}. Bread on its own is just bread.`
        : `There's nothing in the ${vessel.name} to work with.` };
    }
    // A bowl needs something to mash WITH. Bread needs nothing but hands —
    // requiring a tool to build a sandwich would be the kind of realism that
    // makes a game worse.
    if (isBowl) {
      const masher = await resolveInventoryItem(player, { tag: 'can_stir', topLevel: true, fromNearby: true });
      if (!masher) return { type: 'error', message: `You need something to mash with — a pestle, a spoon, anything.` };
    }
    // Cold work never sees heat, so its prep check lands here instead of at `cook`.
    const toChop = rawWorked.filter(needsPrep);
    if (toChop.length && !(await chopTool(player))) {
      return { type: 'error', message: `${toChop[0].name} needs chopping first, and you have no knife.` };
    }
  }

  // Modifiers sit in the vessel unscored — they season what's cooking rather
  // than cooking alongside it. They still count toward the dish MATCH (a sear
  // genuinely requires fat) and are still consumed.
  const modifiers = contents.filter(r => isModifier(r));

  // An EDIBLE VESSEL is part of what it makes. Bread is the only one: a sandwich
  // is not "fillings served in a bread container", it IS the bread, and the
  // bread has to be scored, named off, and eaten with the rest. Every other
  // vessel is equipment and survives the meal.
  const edibleVessel = hasTag(vessel, 'edible_vessel') && profileNameFor(vessel)
    ? { ...vessel, custom_data: vessel.custom_data || {} }
    : null;
  // Toasted, it's scored off its own timeline like any other cooked ingredient;
  // cold, it's scored at its raw target — which for bread is `good`, because
  // bread arrives baked.
  if (edibleVessel) (edibleVessel.custom_data.cooking ? cooking : rawWorked).push(edibleVessel);

  const inVessel = [...cooking, ...rawWorked, ...modifiers];
  const sig = signature(inVessel, profileNameFor);
  // Named dishes anchor on a specific item id (ramen noodles, jerk paste), so
  // the matcher needs to know what's actually in the pot, not just its classes.
  const hit = matchDish(sig, kind, new Set(inVessel.map(r => r.item_id)));
  // Bread never makes slop. Anything sensible between two slices is a real
  // sandwich named off its contents, so an unmatched bread vessel falls to the
  // generic template rather than to UNKNOWN_DISH — and because that template has
  // no key, making one teaches the cookbook nothing.
  // No recipe claims it. That used to mean "a mess" for every vessel but bread,
  // where GENERIC_SANDWICH had already proved the better answer: anything
  // sensible between two slices is a real thing and should be called what it is.
  // `inferDish` generalises that — food makes a DISH, non-food makes a mess — so
  // slop is now the answer only for a pan with something inedible in it.
  //
  // An improvised dish is capped below an authored one (superb, never
  // masterful), which is what keeps the cookbook worth filling.
  const improvised = hit ? null : (isBread ? null : inferDish(sig, kind));
  const template = hit?.template || improvised || (isBread ? GENERIC_SANDWICH : UNKNOWN_DISH);
  const key = hit?.key || null;

  // Have they written this exact pan down themselves? Matched on SIGNATURE, not
  // on name — a player may call it anything, and does. A saved recipe pays the
  // same small nudge a catalog one does: knowing what you're making helps.
  const savedBook = improvised ? await savedRecipes(player.id) : new Map();
  const mine = improvised ? recipeBySignature(savedBook, recipeSignature(sig, kind)) : null;

  // One skill check for the dish, not one per ingredient — you cooked a meal,
  // not five things that happened to share a pan.
  const check = await skillCheck(player, 'cooking', template.difficulty);
  const now = Date.now();
  const bands = [];
  let dishDoneness = null;
  for (const row of cooking) {
    const profile = sessionProfile(row.custom_data.cooking);
    // An unprofiled thing in the pot contributes nothing but its presence; it
    // can't be scored, so it drags the dish to the floor rather than skewing it.
    bands.push(profile ? evaluate(row.custom_data.cooking, profile, now, check.margin).band : 'poor');
    // A dish takes the doneness of whatever in it HAS one — the meat in a stew.
    // That's what decides whether eating it is a risk.
    if (!dishDoneness && profile) dishDoneness = plateDoneness(row.custom_data.cooking, profile, now);
  }
  // Worked-raw ingredients score at their profile's raw target — the ceiling for
  // food that was never heated. A tomato is excellent raw; a potato is poor,
  // which is exactly why no dip asks for one.
  // ...unless it was ALREADY cooked, in which case it keeps the band it earned.
  // That's what makes a paste of cooked pulses work where raw ones would be
  // chalk, and it turns yesterday's leftovers into today's dip.
  for (const row of rawWorked) {
    bands.push(row.custom_data?.cook_quality || PROFILES[profileNameFor(row)].targets.raw);
  }

  // Seasoning: bonus up to the dish ideal, penalty for every one past it.
  // Every taste was a mouthful. It comes off what is left.
  const tastes = inVessel.reduce((a, r) => a + (Number(r.custom_data?.tasted) || 0), 0);
  const dishYield = Math.max(0.4, yieldOf([...cooking, ...rawWorked]) - tastes * TASTE_BITE);
  // Seasoning counts in portions as well: half a bulb of garlic is half a bulb.
  const seasoning = seasoningBonus(template, modifiers.reduce((a, r) => a + portionOf(r), 0));
  // With no timeline to score against, cold work leans on the cook's hands.
  const handWork = coldWork ? SKILL_WEIGHT * Math.max(-1, Math.min(1, check.margin / 20)) : 0;
  // Butter pays through the session for anything that went on the heat. A cold
  // sandwich has no session, so it collects here instead — buttered bread is
  // better bread whether or not a pan was ever involved. Only rows WITHOUT a
  // session count, so nothing is paid twice.
  const butterBonus = inVessel.some(r => r.custom_data?.buttered && !r.custom_data?.cooking) ? BUTTER_BONUS : 0;
  // What the pan itself brings. Liquid in the pan lifts fond on its own, so the
  // same fact drives both what this dish collects and whether the pan keeps
  // anything afterwards — worked out once, here.
  const hadLiquid = inVessel.some(r => profileNameFor(r) === 'liquid');
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
  // PLATING. Rewarded, never required — the same trade the colander makes for
  // draining and soap makes for a rinse. `plate` has never needed a plate and
  // still doesn't: you can always take food off the heat with your hands, and
  // gating the one verb that ENDS a cook behind an object you might not own
  // would be a way to strand somebody with a burning pan. Owning real dishware
  // just makes the same dish read better, which is what plating is.
  const plating = await platingBonus(player, inVessel.length);
  const band = composeBand(bands, capped,
    (key ? knownBonus(known, key) : 0) + (mine ? KNOWN_RECIPE_BONUS : 0)
    + seasoning + handWork + fondBonus + butterBonus + plating.bonus);
  // Your own name for it wins over the generated one. That IS the reward for
  // writing a recipe down: the game starts calling your invention what you call
  // it, for you and for anybody you taught.
  const name = mine ? mine.name : dishName(template, inVessel, profileNameFor, tagValue);

  if (cooking.length) await freeAppliance(cooking[0].custom_data.cooking);
  // These rows are about to be DELETED rather than have their sessions ended,
  // so nothing else will ever clean up after them. Without this their narration
  // timers fire into a void and they linger in the live-cook registry, which
  // would leave `smell` reporting a pot that was plated ten minutes ago.
  for (const row of inVessel) forgetCook(row.inv_id);

  // Consume the ingredients and hand back one dish in a single statement. The
  // bespoke name rides on custom_data.name, which the inventory renderer
  // already prefers over the items row — which is why 22 dishes need exactly
  // one content item.
  // An INTERMEDIATE produces an ingredient, not a meal: it isn't marked cooked
  // (it still has to be), and the band it earned rides along as a ceiling on
  // whatever it eventually goes into.
  const intermediate = template.output || null;
  const produced = intermediate ? intermediate.item : DISH_ITEM;
  const stamp = intermediate
    ? { crafted_quality: band, dish: key }
    : {
        name, dish: key || 'unknown', cook_quality: band, cooked: true,
        // What an improvised dish carries so it can be written down later: the
        // signature is its identity, the family is what to call it if the player
        // doesn't. Absent on every catalog dish, so nothing that predates this
        // changed.
        ...(improvised ? { improv: recipeSignature(sig, kind), family: improvised.family, complexity: improvised.complexity } : {}),
        // When it hit the plate. Carry-over cooking is derived from this and
        // nothing else — the one timestamp that replaces a temperature model.
        plated_at: now,
        ...(inVessel.some(r => RESTS_WELL.includes(profileNameFor(r))) ? { rests: true } : {}),
        // Half an onion satisfies "one soft vegetable" — recipe quantities are
        // coarse — but the meal that comes out is smaller. Without this,
        // chopping would be a way to make four dinners out of one.
        ...(dishYield !== 1 ? { yield: dishYield } : {}),
        ...(dishDoneness ? { doneness: dishDoneness } : {}),
      };

  await query(
    `WITH consumed AS (DELETE FROM player_inventory WHERE id = ANY($1) RETURNING 1)
     INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, custom_data)
     SELECT $2, $3, $4, 1, 1.0, $5::jsonb`,
    [inVessel.map(r => r.inv_id), randomUUID(), player.id, produced, JSON.stringify(stamp)]
  );

  // Does the pan keep anything? A sear leaves fond; a sauce lifts it and leaves
  // nothing. Either way the vessel's old state is spent, so this one write both
  // clears what was there and records what replaces it.
  const searedProfile = inVessel.map(profileNameFor).find(p => FOND_PROFILES.includes(p));
  const newFond = leavesFond({
    vesselKind: kind, profiles: inVessel.map(profileNameFor), band, hadLiquid,
    microwave: cooking.some(r => r.custom_data?.cooking?.microwave),
  }) ? makeFond(searedProfile, band, now) : null;

  // An edible vessel was just eaten by its own dish — there's no pan left to
  // record anything against.
  if (!edibleVessel) {
    await query(
      newFond
        ? `UPDATE player_inventory SET custom_data = (COALESCE(custom_data,'{}'::jsonb) - 'deglazed') || jsonb_build_object('fond', $2::jsonb) WHERE id=$1`
        : `UPDATE player_inventory SET custom_data = (COALESCE(custom_data,'{}'::jsonb) - 'fond' - 'deglazed') WHERE id=$1`,
      newFond ? [vessel.inv_id, JSON.stringify(newFond)] : [vessel.inv_id]
    );
  }

  cookSfx(player, { action: 'impact', surface: 'ceramic', intensity: 0.4 });

  const lines = [];
  const label = band[0].toUpperCase() + band.slice(1);
  lines.push(intermediate
    ? `You work it together and roll it out: ${name}. ${label} — and not dinner yet.`
    : (key || improvised)
      ? `You plate it up: ${name}. It's ${label}.`
      : `You plate whatever this is. ${label}, and that's being generous.`);
  // Say it when real dishware earned something. Silence when you have none —
  // nobody needs a nag about the plates they don't own.
  if (plating.note) lines.push(`<span class="text-dim">${plating.note}</span>`);

  // Collection path 1 — discovery by REPETITION. One good plate proves nothing;
  // turning the same combination out well DISCOVERY_ATTEMPTS times is what
  // writes it down. A cook below DISCOVERY_MIN_BAND teaches you nothing.
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

  // FOLLOWING A REAL RECIPE, WELL, IS THE BEST-PAID THING IN THE KITCHEN.
  //
  // Improvisation now reaches `superb`, which is close enough to the top that
  // the catalog needed something improvisation can't have. Two things: the last
  // rung — only an authored recipe can be plated `masterful` — and this, a flat
  // bonus for executing one you actually know at the top of the ladder.
  if (key && known.has(key) && bandIndex(band) >= bandIndex(RECIPE_MASTERY_BAND)) {
    flatIp += RECIPE_MASTERY_IP;
    lines.push(`<span class="text-dim">That's the recipe, cooked the way it's meant to go.</span>`);
  }

  // Improvised: pays on complexity, and always less than DISCOVERY_IP. Inventing
  // is worth something; working out a real recipe is worth more.
  if (improvised) {
    flatIp += improvisedIp(improvised.complexity, band);
    if (mine && beatsRecorded(mine.best, band)) {
      bookkeeping.push(improveSaved(player.id, mine.slug, mine, band));
      lines.push(`Best you've made your ${mine.name} yet.`);
    } else if (!mine && bandIndex(band) >= bandIndex(DISCOVERY_MIN_BAND)) {
      // The nudge, once, at the moment it's worth taking: you made something
      // good that no recipe covers, and it's yours if you write it down.
      lines.push(`<span class="text-dim">Nothing in the book covers that. <b>save recipe as &lt;name&gt;</b> while you're holding it.</span>`);
    }
  }

  // The skill award, the flat IP and the cookbook row are mutually independent.
  bookkeeping.push(awardSkillUse(player.id, 'cooking', check.margin));
  if (flatIp) bookkeeping.push(grantSkillIp(player.id, 'cooking', flatIp));
  await Promise.all(bookkeeping);

  return { type: 'output', message: lines.join('\n') };
}

// Collection path 2 — a recipe card you found or bought. `read` is the engine's
// tag-gated verb, so this needs no verb of its own (docs/commands.md).
async function readRecipeCard(args, raw, player) {
  const nameStr = args.join(' ').trim();
  const card = await resolveInventoryItem(player, { tag: 'recipe_card', name: nameStr || undefined, topLevel: true });
  if (!card) return undefined; // not ours — fall through to the other read handlers
  // A card a PLAYER wrote carries its recipe on custom_data rather than naming a
  // catalog key, so it's checked first — the same blank item is every recipe
  // anybody ever invents, exactly as one `item_cooked_dish` is every dish.
  const written = await learnFromWrittenCard(card, player);
  if (written) return { type: 'output', message: written };

  const key = String(tagValue(card, 'recipe_card', '') || '').trim();
  // A card whose tag names no real dish is a content bug, and "you already know
  // this one" is the worst possible way to report it — it reads as working.
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

// `smoke <meat>` — the long game. A smoker turns raw meat into PRESERVED meat:
// it keeps without a fridge, it slots into every preserved recipe, and it takes
// the better part of an hour. Enormous window, so it's the one cook you can
// genuinely start and walk away from.
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

// `chop <food> [into N]` — cut one ingredient into N portions.
//
// Portions conserve: four quarters weigh what the whole weighed and feed you
// what the whole fed you. What you gain is TIME — cook duration scales as
// m^(2/3), so a quartered potato finishes in about 40% of the time (not 25%:
// heat still has to reach the middle of what's left). Chopping is how you make a
// slow ingredient land alongside a fast one, which is the other half of staging
// and the reason to carry a knife past the prep gate.
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
  // A FINISHED DISH can be cut too — that's what halving a sandwich is, and it's
  // the reason `cut` exists as a word. A plated dish has no `food_profile` (it's
  // one item id for the whole catalog), so it's recognised by its stamp instead.
  const isDish = !!food.custom_data?.cook_quality || !!food.custom_data?.dish;
  if (!profileNameFor(food) && !isDish) return { type: 'error', message: `${food.name} isn't food.` };
  if (food.custom_data?.cooking) return { type: 'error', message: `Not while it's on the heat.` };
  if (!canChop(food, pieces)) {
    return { type: 'error', message: `${food.name} is already about as small as it usefully goes.` };
  }

  const from = portionOf(food);
  const each = from / pieces;
  const baseName = food.custom_data?.name || food.name;
  const wholeName = baseName.replace(/^(half|a quarter of|an eighth of|1\/\d+ of)\s+(an?\s+)?/i, '');
  const pieceName = portionName({ custom_data: { portion: each } }, wholeName);

  // One row becomes `pieces` rows, each carrying its fraction. The original is
  // consumed by the split, so nothing is created and nothing is lost.
  //
  // Two things the split must NOT do. It must not drop the stack: a row of five
  // potatoes cut in half is ten halves, so each new row keeps the original
  // `quantity` and the mass balances. And it must not copy PREP — a knife
  // doesn't multiply a marinade. Everything you paid time or a second item for
  // comes off the pieces; `minced` stays, because that's what the thing IS.
  const { scored, tenderised, marinated_at, tasted, ...keep } = food.custom_data || {};
  const stamp = JSON.stringify({ ...keep, portion: each, name: pieceName });
  await query(
    `WITH cut AS (DELETE FROM player_inventory WHERE id = $1 RETURNING player_id, item_id, quantity, condition, container_id)
     INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, container_id, custom_data)
     SELECT unnest($2::text[]), player_id, item_id, quantity, condition, container_id, $3::jsonb FROM cut`,
    [food.inv_id, Array.from({ length: pieces }, () => randomUUID()), stamp]
  );
  const lostPrep = scored || tenderised || marinated_at;
  // A blade landing on a board. More pieces means a faster, harder worked cut —
  // and something frozen solid goes under the knife like wood.
  cookSfx(player, {
    action: 'chop', material: sfxMaterial(food),
    state: await sfxState(food, player), intensity: 0.4 + 0.1 * pieces,
  });

  return {
    type: 'output',
    // A raw ingredient is cut to change how it COOKS; a finished dish is cut to
    // share it or to save half for later. Same arithmetic, entirely different
    // reason, so it shouldn't be told the halves will cook faster.
    message: isDish
      ? `You cut ${baseName} into ${pieces}. ${pieces} × ${pieceName} — the same meal, in more hands.`
      : `You cut ${baseName} into ${pieces}. ${pieces} × ${pieceName}, and each one will cook in a fraction of the time.`
        + (lostPrep ? ` The work you'd already done to it doesn't survive the knife.` : ''),
  };
}

// Shared preamble for every prep verb: a knife in hand, a real ingredient, and
// nothing already on the heat.
async function prepTarget(nameStr, player, { profile = null, needsBlade = true } = {}) {
  if (!nameStr) return { error: 'What?' };
  if (needsBlade && !(await chopTool(player))) return { error: 'You need a knife for that.' };
  const food = await resolveInventoryItem(player, { name: nameStr, topLevel: false });
  if (!food) return { error: `You don't have "${nameStr}".` };
  const p = profileNameFor(food);
  if (!p) return { error: `${food.name} isn't food.` };
  if (profile && p !== profile) return { error: `That isn't something you do to ${food.name}.` };
  if (food.custom_data?.cooking) return { error: `Not while it's on the heat.` };
  if (food.custom_data?.cooked) return { error: `Too late for that — it's already cooked.` };
  return { food, profile: p };
}

const stampPrep = (invId, patch) => query(
  `UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || $2::jsonb WHERE id=$1`,
  [invId, JSON.stringify(patch)]
);

// `score <meat>` — cut the fat cap in a diamond. The heat gets in, the seasoning
// gets in, and so does the way out for the moisture: a wider window, but it
// dries faster once you're past it.
async function cmdScore(args, raw, player) {
  const t = await prepTarget(args.join(' ').trim(), player, { profile: 'dense_meat' });
  if (t.error) return { type: 'error', message: t.error };
  if (t.food.custom_data?.scored) return { type: 'error', message: `${t.food.name} is already scored.` };
  if (t.food.custom_data?.minced) return { type: 'error', message: `There's nothing left of it to score.` };
  await stampPrep(t.food.inv_id ?? t.food.id, { scored: true });
  cookSfx(player, { action: 'chop', material: sfxMaterial(t.food), intensity: 0.3 });
  return { type: 'output', message: `You score ${t.food.name} across the fat in a diamond, a quarter inch deep. It will take seasoning now, and heat.` };
}

// `tenderise <meat>` — beat it flat. Mince's gentler cousin: faster and far
// more forgiving, at the cost of one rung off the top.
async function cmdTenderise(args, raw, player) {
  const t = await prepTarget(args.join(' ').trim(), player, { profile: 'dense_meat', needsBlade: false });
  if (t.error) return { type: 'error', message: t.error };
  if (t.food.custom_data?.tenderised) return { type: 'error', message: `${t.food.name} has taken all the beating it needs.` };
  if (t.food.custom_data?.minced) return { type: 'error', message: `It's mince. There's nothing left to tenderise.` };
  await stampPrep(t.food.inv_id ?? t.food.id, { tenderised: true });
  cookSfx(player, { action: 'impact', surface: 'wood', intensity: 0.8 });
  return { type: 'output', message: `You beat ${t.food.name} out flat and even. It'll cook fast and forgive you a lot — but it'll never be a great piece of meat again.` };
}

// `marinate <meat> in <something>` — the one prep that costs TIME rather than
// quality. Left long enough it's the largest single gain available before heat.
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

  // The marinade is used up. That's the cost you pay up front; the rest is time.
  await query('DELETE FROM player_inventory WHERE id=$1', [bath.inv_id ?? bath.id]);
  await stampPrep(t.food.inv_id ?? t.food.id, { marinated_at: Date.now() });
  return {
    type: 'output',
    message: `You put ${t.food.name} in the ${bath.name} and leave it. It wants hours, and it will be worth every one of them.`,
  };
}

// `butter <bread>` — the one prep that is also an ingredient.
//
// Buttering counts as the dish's fat (see `signature`), so buttered bread in a
// pan is a toastie without a separate pat of butter going in — which is how
// anyone actually makes one. It also pays a small flat bonus: butter on the
// outside is the entire difference between toasted bread and a good toastie.
async function cmdButter(args, raw, player) {
  const argStr = args.join(' ').trim();
  if (!argStr) return { type: 'error', message: `Butter what? Try "butter flatbread".` };

  const target = await resolveInventoryItem(player, { name: argStr, topLevel: false });
  if (!target) return { type: 'error', message: `You don't have "${argStr}".` };
  if (!profileNameFor(target)) return { type: 'error', message: `${target.name} isn't food.` };
  if (target.custom_data?.cooking) return { type: 'error', message: `Not while it's on the heat.` };
  if (target.custom_data?.cooked) return { type: 'error', message: `Too late — butter goes on before the heat, not after.` };
  if (target.custom_data?.buttered) return { type: 'error', message: `${target.name} is buttered enough.` };

  const butter = await resolveInventoryItem(player, { tag: 'spreadable', topLevel: false });
  if (!butter) return { type: 'error', message: `You've nothing to spread. You want butter, or something pretending to be.` };

  // A block of butter does a lot of slices. Spreading takes a portion, and only
  // the last of it takes the item — the same conserving arithmetic as `chop`,
  // because a knife shouldn't create butter either.
  const left = portionOf(butter) - BUTTER_PORTION;
  await (left > 1e-9
    ? query(
        `UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || jsonb_build_object('portion', $2::numeric) WHERE id=$1`,
        [butter.inv_id ?? butter.id, left])
    : query('DELETE FROM player_inventory WHERE id=$1', [butter.inv_id ?? butter.id]));
  await stampPrep(target.inv_id ?? target.id, { buttered: true });
  // A knife dragged across bread — soft, brief, nothing metallic under it.
  cookSfx(player, { action: 'scrape', surface: 'wood', intensity: 0.3, personal: true });

  return {
    type: 'output',
    message: `You spread ${butter.name} across ${target.name}, right to the edges.`
      + (left > 1e-9 ? '' : ` That was the last of it.`),
  };
}

// `taste <food|vessel>` — the one reading that isn't visual.
//
// Everything else in this system is something you can SEE. Tasting reaches what
// looking can't: seasoning, and whether the thing is actually any good. What it
// TELLS you scales with Cooking skill — a novice learns one vague thing, an
// expert learns what's wrong and by how much. That's the first place the skill
// buys information rather than outcome.
async function cmdTaste(args, raw, player) {
  const nameStr = args.join(' ').trim();
  if (!nameStr) return { type: 'error', message: 'Taste what?' };
  const skill = await effectiveSkill(player, 'cooking');

  // A vessel tastes as the DISH it's becoming — seasoning is a property of the
  // whole pan, not of any one thing in it.
  const vessel = await resolveInventoryItem(player, { tag: 'vessel', name: nameStr, topLevel: true, fromNearby: true });
  if (vessel) {
    const contents = await vesselContents(vessel.inv_id);
    const real = contents.filter(r => profileNameFor(r));
    if (!real.length) return { type: 'error', message: `There's nothing in the ${vessel.name} to taste.` };
    const modifiers = contents.filter(r => isModifier(r));
    const hit = matchDish(signature(real, profileNameFor), tagValue(vessel, 'vessel_kind', null), new Set(contents.map(r => r.item_id)));
    const cooking = contents.find(r => r.custom_data?.cooking);
    const notes = tasteNotes({
      session: cooking?.custom_data?.cooking,
      profile: cooking ? sessionProfile(cooking.custom_data.cooking) : null,
      template: hit?.template || null,
      modifierCount: hit ? modifiers.reduce((a, r) => a + portionOf(r), 0) : null,
      skill,
    });
    // A spoonful out of the pan is ONE mouthful, however many things are in it.
    // The bite is recorded against a single row — plating sums `tasted` across
    // the whole vessel, so stamping every ingredient would charge a five-item
    // stew five times for one taste.
    await noteTaste([cooking || real[0]]);
    return { type: 'output', message: `You taste from the ${vessel.name}.\n${notes.map(n => `  ${n}`).join('\n')}` };
  }

  const food = await resolveInventoryItem(player, { name: nameStr, topLevel: false });
  if (!food) return { type: 'error', message: `You don't have "${nameStr}".` };
  const session = food.custom_data?.cooking;
  if (!session) {
    // Not cooking — if it's a finished plate, tasting is just eating a bit of it.
    const lines = flavourLines(food.custom_data || {}, restPhase(food.custom_data));
    if (!lines.length) return { type: 'error', message: `${food.name} isn't cooking, and there's nothing to learn from it.` };
    await noteTaste([food]);
    return { type: 'output', message: `You take a little of ${food.custom_data?.name || food.name}.\n  ${lines[0]}` };
  }
  const notes = tasteNotes({ session, profile: sessionProfile(session), skill });
  await noteTaste([food]);
  return { type: 'output', message: `You taste ${food.name}.\n${notes.map(n => `  ${n}`).join('\n')}` };
}

// Every taste is a mouthful you don't get back. Recorded on the row so the
// finished dish yields a little less — never enough to matter once, always
// enough that tasting ten times costs you a meal.
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

// `mince <meat>` — work it down to nothing with the knife.
//
// The opposite trade to `chop`. Chopping makes a thing smaller, so it cooks
// faster AND feeds you less. Mincing destroys the structure instead: same mass,
// same nourishment, a third of the cook time — and a hard ceiling, because
// there is no crust on mince and no rare middle to aim for.
//
// It's also the answer to "I butchered a dog three streets back and the meat is
// a whole haunch": mince keeps its origin, so what you get is dog mince and
// what you cook is a dog stew.
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

  // Keeps its origin: butchered meat stays what it came off, so a dish made
  // from it still names the creature.
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

// `deglaze <vessel>` — lift the browned bottom into the liquid. Needs fond in
// the pan and something wet in it to lift with. This is the one action that
// makes a second cook depend on the first, and it's worth more than any single
// seasoning: a sauce built on a sear is a different sauce.
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
  // The one place several generators genuinely layer: liquid hitting hot metal
  // is a pour, an immediate flare of sizzle and a scrape — not a bespoke
  // "deglaze" sound. Composition instead of a new asset is the whole idea.
  cookSfx(player, { action: 'pour', material: 'liquid', flow: 0.7 });
  cookSfx(player, { action: 'sizzle', material: 'liquid', heat: 0.95 });
  cookSfx(player, { action: 'scrape', surface: 'metal', intensity: 0.6 });

  return {
    type: 'output',
    message: `You pour the ${wet.name} into the ${vessel.name} and scrape. The brown comes up off the bottom and goes into the sauce.`,
  };
}

// `scour <vessel>` — the other half of fond: residue you didn't lift is a
// penalty until it's cleaned off. Somebody has to do the washing up.
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

// `mise` — the whole board in one look: every ingredient you have in play, the
// vessel it's sitting in, and how far along it is.
//
// Cooking scatters its state on purpose. Prep lives on the ingredient, heat
// lives on the appliance, the dish-in-progress lives in whichever pan you
// happen to be holding, and the burner setting lives inside a session nobody
// can see. All of it was already readable — with the right examine, on the
// right object, if you remembered the object was there. Nothing here is new
// state; this is those same reads, gathered, so the answer to "what am I
// actually doing" costs one command instead of five.
//
// Strictly DERIVED: no writes, no clock, no session of its own. Checking the
// board twenty times costs exactly what checking it once costs.
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

  // Where a vessel IS, which is the thing you most want to know and the one
  // thing no examine tells you. The appliance holding it is in-memory furniture,
  // so this costs nothing.
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
    out.push(`<span class="text-bright">${shownName(v)}</span> <span class="text-dim">— ${placeOf(v)}</span>`);
    out.push(inside || `  <span class="text-dim">empty</span>`);
  }

  // Ingredients that aren't in anything yet. This is the half of the board the
  // game never showed: a minced cut in your pack looked identical to a whole one
  // everywhere except its name.
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
      out.push(`  ${shownName(r)}${r.quantity > 1 ? ` x${r.quantity}` : ''} — ${state}${notes.length ? `, ${notes.join(', ')}` : ''}`);
    }
  }

  // A kitchen's own pots, via the same `fromNearby` seam the cooking verbs use:
  // a pan you left on the counter is still your problem. Only ones with
  // something in them — an empty cabinet is not news.
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
    nearLines.push(`<span class="text-bright">${shownName(v)}</span> <span class="text-dim">— in the ${v.from_nearby}</span>`);
    nearLines.push(inside);
  }
  if (nearLines.length) {
    if (out.length) out.push('');
    out.push(...nearLines);
  }

  if (!out.length) return { type: 'output', message: `<span class="text-dim">Nothing in play. No pans, no ingredients, nothing on the heat.</span>` };
  return { type: 'output', message: out.join('\n') };
}

// `doneness <food> <target>` — say how you want it. Moves the peak window along
// the cook, so rare opens (and closes) earlier than well done. Settable any time
// before your window opens; after that the food has already passed the point.
async function cmdDoneness(args, raw, player) {
  const argStr = args.join(' ').trim();
  if (!argStr) return { type: 'error', message: `Cook what, and how? Try "doneness steak rare".` };

  // Longest-suffix match, so multi-word levels ("well done") and multi-word food
  // names both work without a separator.
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
  if (!levels) return { type: 'error', message: `${foodRow.name} is done when it's done — there's nothing to choose.` };

  const names = levels.map(l => l.name);
  if (!target) {
    return { type: 'output', message: `${foodRow.name} is set to ${session.target || defaultDoneness(profile)}. You could ask for: ${names.join(', ')}.` };
  }
  const pick = names.find(n => n === target) || names.find(n => n.startsWith(target));
  if (!pick) return { type: 'error', message: `That's not a doneness. Try: ${names.join(', ')}.` };

  if (Date.now() >= timeline(session, profile).doneAt) {
    return { type: 'error', message: `Too late — ${foodRow.name} is already past that.` };
  }

  await query(
    `UPDATE player_inventory SET custom_data = jsonb_set(custom_data, '{cooking,target}', $2::jsonb)
      WHERE id=$1 AND jsonb_exists(custom_data,'cooking')`,
    [foodRow.inv_id ?? foodRow.id, JSON.stringify(pick)]
  );
  // The finish line just moved, so every timer hung off it is stale — including
  // the burn-off. Without this, asking for `well done` leaves an auto-burn armed
  // against the old target, and it fires while the steak is still in its window.
  rescheduleNarration(foodRow.inv_id ?? foodRow.id, player.id, { ...session, target: pick }, foodRow.name);
  return { type: 'output', message: `You'll take ${foodRow.name} ${pick}.` };
}

// `stove <low|mid|high>` — ride the burner. A stove's `stove_tier` is its
// CEILING, not its only setting: a high-end range can be turned down, a cheap
// hotplate can't be turned up. The change is appended to every live session on
// that stove, and profiles with a `heatCurve` are scored on the resulting log.
const HEAT_ORDER = ['low', 'mid', 'high'];

async function cmdStove(args, raw, player) {
  const want = (args[0] || '').toLowerCase();
  if (!HEAT_ORDER.includes(want)) {
    return { type: 'error', message: `Set the burner to what? Try "stove low", "stove mid" or "stove high".` };
  }

  const stoves = stovesInZone(player.current_zone).filter(f => f.flags?.busy_until > Date.now());
  if (!stoves.length) return { type: 'error', message: `You've got nothing on the heat here.` };
  const stove = stoves[0];

  const ceiling = stove.flags.stove_tier || 'low';
  if (HEAT_ORDER.indexOf(want) > HEAT_ORDER.indexOf(ceiling)) {
    return { type: 'error', message: `The ${stove.name} doesn't go that high — ${ceiling} is all it has.` };
  }

  // Append the change to every profiled session sitting on this burner. One
  // statement: the burner log is a jsonb array on each row's session.
  const { rows } = await query(
    `UPDATE player_inventory
        SET custom_data = jsonb_set(custom_data, '{cooking,heats}',
              COALESCE(custom_data->'cooking'->'heats', '[]'::jsonb) || $3::jsonb)
      WHERE player_id = $1
        AND custom_data->'cooking'->>'applianceId' = $2
        AND jsonb_exists(custom_data->'cooking', 'profile')
      RETURNING id`,
    [player.id, stove.id, JSON.stringify([{ at: Date.now(), tier: want }])]
  );
  if (!rows.length) return { type: 'error', message: `Nothing on the ${stove.name} cares what the burner's doing.` };

  const verb = { low: 'down to a bare simmer', mid: 'to a steady middle', high: 'up hard' }[want];
  return { type: 'output', message: `You take the ${stove.name} ${verb}.` };
}

// Admin: put one of every piece of cooking equipment in your pack. Driven by
// TAGS, not a hardcoded id list — a vessel or utensil authored next month is
// included the day it lands, with no edit here. Skips anything you already
// carry, so it's safe to run twice.
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
      `Kitchen kit issued — ${giving.length} item${giving.length === 1 ? '' : 's'}${skipped ? ` (${skipped} already carried)` : ''}:`,
      ...giving.map(g => `  ${g.name}`),
    ].join('\n'),
  };
}

// `mix` belongs to the drinks plugin, and it should: mixology is what the verb
// is for. But a MIXING BOWL is ours — it's a `vessel`, never `drinkware` — so
// "mix mustard into bowl" hit drinks' drinkware lookup, missed, and answered
// "You don't have a bowl", which is both wrong and unhelpable-with.
//
// A bowl is the one vessel you never heat: bowl dishes are mashed, mixed and
// seasoned (see dishes.js), which makes `mix` the most natural verb in the game
// for it and its absence a real gap. So drinks falls through to this Action when
// its own lookup misses. Target-first routing, exactly like `cook` handing a
// recipe to synthesis — the verb stays with the plugin whose thing it is, and
// the vessel decides which one that is.
//
// Adding is a MOVE into the vessel, not a copy: the same thing `stow` does, done
// here because a bowl sitting in the kitchen's dish cabinet is resolved in place
// (`fromNearby`) and `stow` can only reach what you're carrying.
async function addToVessel(player, ingredientStr, vessel) {
  const row = await resolveInventoryItem(player, { name: ingredientStr, topLevel: true });
  if (!row) return { type: 'error', message: `You don't have "${ingredientStr}".` };
  if (row.inv_id === vessel.inv_id) return { type: 'error', message: `You can't put the ${vessel.name} in itself.` };
  if (row.custom_data?.cooking) return { type: 'error', message: `Not while it's on the heat.` };

  const cap = containerCapacity({ ...vessel, tags: vessel.tags, kind: 'item' });
  const used = await containerContentsWeight(vessel.inv_id);
  const adding = (row.weight || 0) * (row.quantity || 1);
  if (cap && used + adding > cap) {
    return { type: 'error', message: `The ${vessel.name} won't hold that too.` };
  }

  await query('UPDATE player_inventory SET container_id=$1, is_equipped=0, slot=NULL WHERE id=$2', [vessel.inv_id, row.inv_id]);
  cookSfx(player, { action: 'stir', material: sfxMaterial(row), intensity: 0.4 });
  const contents = await vesselContents(vessel.inv_id);
  return {
    type: 'use',
    message: `You put ${shownName(row)} in the ${vessel.name}. <span class="text-dim">${contents.length} thing${contents.length === 1 ? '' : 's'} in it now — "plate ${vessel.name}" when it's right.</span>`,
  };
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

// Where the stove-or-lab pick lands. Plugin verbs must replay through an Action,
// never `{ verb }` — that route only reaches engine builtins (docs/commands.md).
registerAction({
  type: 'cooking.station_choice',
  // Same landing as a bare `cook` in a food-only room: picking the stove out of
  // the list is still a request to see the kitchen.
  handler: async ({ actor, params }) => (params.target?._cookKind === 'drug' && hasSynthesis())
    ? toDrugs(actor, null, null)
    : (await cmdWorkspace(['kitchen'], '', actor)) || { type: 'error', message: 'Cook what?' },
});

// Where the range-or-microwave pick lands. The food rode in on the candidate,
// so this just re-enters the cook with the appliance the player chose.
registerAction({
  type: 'cooking.appliance_choice',
  handler: ({ actor, params, context }) => {
    const f = params.target;
    if (!f?._kind) return { type: 'error', message: 'Cook what?' };
    return cookFood(f._food || '', actor, context?.broadcast, f);
  },
});

// ── plating ──────────────────────────────────────────────────────────────────
//
// What a real plate is worth. Nothing about `plate` requires one — it is the
// verb that ends a cook, and gating that behind an object would leave a player
// with no dishware standing over a burning pan with no way to stop. So this is
// a bonus and only ever a bonus.
//
// A PLATTER pays more, but only for a dish with enough in it to be worth
// arranging: putting one fried egg on a serving platter is not presentation,
// it's a joke, so a big plate on a small dish quietly falls back to plate money.
const PLATE_BONUS = 0.35 * BAND_SCALE;
const PLATTER_BONUS = 0.6 * BAND_SCALE;
const PLATTER_MIN_COMPONENTS = 3;

// The fallback is not nothing — it's a paper plate off a stack somebody left in
// the drawer. Owning no crockery is a fact about the character, and saying so is
// characterisation; the line the player would resent is the one that TELLS THEM
// TO GO BUY A PLATE, so none of these do. There's no `item_paper_plate` and
// there deliberately isn't one: making the fallback consumable would make plates
// required by the back door, which is the exact thing we're avoiding.
//
// Rotated so it doesn't read as a system message on the tenth meal.
const IMPROVISED_PLATING = [
  `Off a paper plate, because that is what there is.`,
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

// ── drain ────────────────────────────────────────────────────────────────────
//
// The verb the penne recipe was already telling you to use. Draining is the one
// act in cooking that is about taking something OUT rather than putting it in,
// and it only exists because `dry_starch` does: pasta and rice are the only
// things in the game cooked IN water that then have to leave it.
//
// Two things happen. The starch comes off the heat wherever it is in its window
// — which is the whole point, because "drain it short of done and finish it in
// the sauce" is a real technique and this is how you perform it. And a strainer
// makes it clean; without one you do it with the pan lid and lose some.
//
// The colander is REWARDED, NOT REQUIRED — the same trade the mop makes in
// cleaning and soap makes in rinsing. Needing a specific object to perform an
// obvious act is how a system stops being usable.
const DRAIN_PENALTY = 1;   // bands lost doing it with the lid and your nerve

async function cmdDrain(args, raw, player) {
  const nameStr = args.join(' ').trim();
  if (!nameStr) return { type: 'error', message: `Drain what?` };

  const vessel = await resolveInventoryItem(player, { tag: 'vessel', name: nameStr, topLevel: true, fromNearby: true });
  const rows = vessel
    ? await vesselContents(vessel.inv_id)
    : [await resolveInventoryItem(player, { name: nameStr, topLevel: false })].filter(Boolean);
  if (!rows.length) return { type: 'error', message: vessel ? `There's nothing in the ${vessel.name}.` : `You don't have "${nameStr}".` };

  // Only wet starch is drainable. Draining a steak is not a thing, and saying so
  // plainly teaches the profile better than a generic refusal would.
  const wet = rows.filter(r => profileNameFor(r) === 'dry_starch' && r.custom_data?.cooking);
  if (!wet.length) {
    return { type: 'error', message: `There's nothing in there that needs draining. It's pasta and rice that come out of their water.` };
  }

  const strainer = await resolveInventoryItem(player, { tag: 'dishware', topLevel: true, fromNearby: true });
  const clean = !!strainer && (strainer.tags?.dishware_kind === 'strainer');

  const out = [];
  for (const row of wet) {
    const session = row.custom_data.cooking;
    const profile = sessionProfile(session);
    const check = await skillCheck(player, 'cooking', profile?.difficulty ?? 4);
    const now = Date.now();
    const result = evaluate(session, profile, now, check.margin);
    const done = plateDoneness(session, profile, now);

    // Drained starch stays FINISHABLE: it is not a finished dish, it is a
    // component on its way into a sauce. That's the same `stayFinishable` seam
    // a browned component already uses, so `plate` still resolves the meal.
    let band = result.band;
    if (!clean) {
      const i = Math.max(0, bandIndex(band) - DRAIN_PENALTY);
      band = QUALITY_BANDS[i];
    }
    await freeAppliance(session);
    await endSession(row.inv_id, band, done, null, true, { drained: true });
    out.push(`${row.name} — ${band}${done ? `, ${done}` : ''}`);
  }

  const how = clean
    ? `You tip the ${vessel?.name || 'pan'} into the ${strainer.name} and the water goes.`
    : `You drain it with the lid and your nerve. Some of it goes down the drain with the water.`;
  return { type: 'output', message: [
    how,
    ...out.map(l => `  ${l}`),
    `<span class="text-dim">Still finishable — get it into the sauce before it sits.</span>`,
  ].join('\n') };
}

// ── cookbook ─────────────────────────────────────────────────────────────────
//
// `cookbook` lists what you've worked out; `cookbook <dish>` prints the card.
// The card is rendered from the SAME template the matcher and the clock use —
// weights from each profile's unitWeight, timing from its cook rate, method
// from its turns/heat/doneness — so it can never drift from what actually
// happens in the pan.
//
// A dish you have NOT discovered still shows its name and blurb (you know a
// stew exists) but not its measures. Working those out is the game.
async function cmdCookbook(args, raw, player) {
  const q = args.join(' ').trim().toLowerCase();
  const { known } = await cookbookState(player.id);

  if (!q) {
    const rows = Object.entries(DISHES).map(([key, t]) => {
      const band = known.get(key);
      return band && band !== UNTRIED
        ? `  · ${t.noun} <span class="text-dim">— best: ${band}</span>`
        : known.has(key) ? `  · ${t.noun}` : `  <span class="text-dim">· ${t.noun} — untried</span>`;
    });
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
      `<span class="text-dim">You know it exists. You don't know how to make it — nobody has shown you and you haven't worked it out. Cook something like it a few times and it'll come.</span>`,
    ].join('\n') };
  }
    // The item-name lookup lets the card name its key bottles rather than
  // printing raw ids at anybody.
  return { type: 'output', message: describeDish(key, template, COOK_SECONDS_PER_KG, id => getItem(id)) };
}

export const commands = {
  cook: cmdCook,
  cookbook: cmdCookbook,
  recipe: cmdRecipe,
  shoplist: cmdShoplist,
  drain: cmdDrain,
  // Naming the appliance as the VERB. Skips the SIFT prompt entirely, which is
  // what you want when you already know you're reheating something.
  microwave: async (args, raw, player, broadcast) => {
    const mws = microwavesInZone(player.current_zone);
    if (!mws.length) return { type: 'error', message: `There's no microwave here.` };

    // "microwave <food> [seconds]" — you SET THE TIME, like a real one. That's
    // the whole skill of the appliance: you commit up front and the machine
    // stops when the dial says so, so guessing short leaves it cold and
    // guessing long leaves it rubber. Omit it and it runs to a sensible default.
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
  // `cut` is the same act. Nobody "chops" a sandwich in half.
  cut: cmdChop,
  butter: cmdButter,
  mince: cmdMince,
  cure: cmdCure,
  deglaze: cmdDeglaze,
  scour: cmdScour,
  doneness: cmdDoneness,
  mise: cmdMise,
  // Nobody who hasn't worked a kitchen says "mise". Both words reach it.
  prep: cmdMise,
  stove: cmdStove,
  flip: (args, raw, player) => handleInteraction('flip', args, player),
  stir: (args, raw, player) => handleInteraction('stir', args, player),
};
// What `examine <vessel>` adds on top of the plain contents list: the stage each
// ingredient is at, what the pan itself is carrying, and what the whole lot is
// currently going to become. Every line is DERIVED — no writes, no clock — so
// checking the pan twenty times costs exactly what checking it once costs.
async function describeVessel(vesselRow, player) {
  const contents = await vesselContents(vesselRow.id);
  const lines = [];

  const cooking = contents.filter(r => r.custom_data?.cooking);
  for (const row of cooking) {
    const state = checkCooking(row);
    if (state) lines.push(`  ${shownName(row)} — ${state.text}`);
  }
  const idle = contents.filter(r => !r.custom_data?.cooking && profileNameFor(r));
  for (const row of idle) {
    const prep = prepText(row.custom_data || {});
    const state = isModifier(row) ? 'seasoning, not on the heat' : 'in, but not cooking yet';
    lines.push(`  ${shownName(row)} — ${state}${prep ? `, ${prep}` : ''}`);
  }

  const fondLine = fondText(vesselRow.custom_data?.fond);
  if (fondLine) {
    lines.push(`  <span class="text-dim">${vesselRow.custom_data?.deglazed ? 'lifted — it went into the sauce' : fondLine}</span>`);
  }

  // What it's on its way to being. Says the dish it would make RIGHT NOW, never
  // how to improve it — the same rule the stage prose follows.
  if (contents.some(r => profileNameFor(r))) {
    const kind = tagValue(vesselRow, 'vessel_kind', null);
    const sig = signature(contents.filter(r => profileNameFor(r)), profileNameFor);
    const hit = matchDish(sig, kind, new Set(contents.map(r => r.item_id)));
    lines.push(hit
      ? `  <span class="text-dim">As it stands, this is going to be ${dishName(hit.template, contents.filter(r => profileNameFor(r)), profileNameFor, tagValue)}.</span>`
      : `  <span class="text-dim">Nothing about this adds up to a dish yet.</span>`);
  }

  return lines.length ? lines.join('\n') : null;
}

// Everything on the heat in this room, whoever put it there.
//
// Served entirely from `cooksOnAppliances` — the in-memory registry cook.js
// keeps of every live session. `smell` has no cooldown, so this path must not
// touch the DB: the query this replaced scanned all of player_inventory on a
// jsonb predicate with no index behind it, once per sniff, over a remote
// connection. Now it costs a Map walk.
async function kitchenSmells(zone, player) {
  const stoves = stovesInZone(zone.id).filter(f => f.flags?.busy_until);
  if (!stoves.length) return [];

  const rows = cooksOnAppliances(stoves.map(f => f.id))
    .map(c => ({ custom_data: { cooking: c.session }, name: c.name }));
  if (!rows.length) return [];

  // Skill decides PRECISION, never whether you notice at all. Anyone can smell
  // burning; a good cook can smell which thing is burning and roughly how far
  // gone it is. That's the same rule taste follows.
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
      out.push({ text: `${what} burning — acrid, and past any hope`, strength: 10, source: 'burning' });
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

// What a kitchen sounds like from here — including through a wall, which is the
// whole point of hearing. A cook you can't see and can't smell is still a cook
// you can hear, and "something is spitting fat next door" is the kind of thing
// that tells you a room is occupied before you open the door.
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
    // A liquid mutters; everything else spits. Past its peak, anything on a
    // burner starts making the noise that means "come back".
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
];

// The chance that eating this makes you ill, from the doneness stamped on it.
// The engine eat-path fires this; the risk numbers live on the profile, so a
// food class can be retuned without touching engine code.
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
  // Spent by the engine eat path. The curves live here so a band can be
  // retuned without touching engine code.
  'cooking.restMultiplier': (cd) => restMultiplier(cd?.plated_at, cd?.rests),
  'cooking.wellFedMs': (cd) => rewardFor(cd?.cook_quality).wellFedMs,
  'cooking.restText': (cd) => restText(cd?.plated_at, cd?.rests),
  'cooking.flavour': (cd) => flavourLines(cd, restPhase(cd)),
  'cooking.donenessRisk': (cd) => donenessRisk(cd),
  // What the ROOM smells of. This is the one cooking readout that works on food
  // you neither hold nor own: examine needs you to name a thing, taste needs it
  // in your hand, and neither reaches the pan somebody else left on the far
  // burner. Deliberately vague — it never reports a band or a seasoning level,
  // because those are what the senses that cost you something are for. What it
  // does tell you, always, is that something is burning.
  'zone.smells': (zone, player) => kitchenSmells(zone, player),
  // A kitchen is loud. This is the cheapest possible contributor — the registry
  // is already in memory for the smell path, and a pan that's past its peak is
  // audibly different from one that hasn't started.
  'zone.sounds': (zone) => kitchenSounds(zone),
  // Prep state on an ingredient that hasn't hit the heat yet — the read side of
  // score/tenderise/marinate.
  'cooking.prepText': (cd) => prepText(cd),
  // The kitchen half of the Preparation Workspace HUD. A gather-hook rather
  // than an import so neither plugin depends on the other loading — pull
  // plugins/workspace and cooking is unchanged; pull cooking and the HUD simply
  // finds no provider in a kitchen. See workspace.js.
  'workspace.provider': (player) => workspaceProvider(player),
  // Mark shop stock that's on your shopping list. A list you have to hold up
  // against the shelf yourself is only half a list.
  'shop.stock': (ctx) => markShelf(ctx),
  // ...and the same mark on a container's contents, so a shop's cases and cases
  // and your own fridge answer the list too.
  'container.view': (ctx) => markContainer({ view: ctx.view, playerId: ctx.player?.id }),
};

// Exposed for the regression harness.
export const _test = { donenessRisk, plateDoneness, findFreeStove, stovesInZone, labsInZone, cookStations, vesselStats, vesselContents };
