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
import { getZoneFurniture } from '../../server/engine/world.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../../server/engine/sift.js';
import { registerAction, dispatchAction, getRegisteredActions } from '../../server/engine/actions.js';
import { getZonePowerStatus } from '../../server/engine/environment.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { tagValue, hasTag } from '../../server/engine/tags.js';
import { skillCheck, awardSkillUse } from '../../server/engine/skills.js';
import { grantSkillIp } from '../../server/engine/ip.js';
import { isPluggedIn } from '../appliances/index.js';
import {
  STOVE_SPEED, PORTABLE_OVEN_SPEED, PORTABLE_OVEN_CAPACITY_G,
  BARE_VESSEL, DEFAULT_VESSEL, cookingIpFor, SMOKER_SPEED, SMOKER_PROFILE, SKILL_WEIGHT, FOND_PROFILES, MAX_CHOP_PIECES,
} from './config.js';
import { prepareCook, commitCooks, cookEnvironment, checkCooking, endSession, freeAppliance, sessionProfile } from './cook.js';
import { PROFILES, bandIndex, profileNameFor, isModifier, needsPrep, donenessLevels, defaultDoneness, achievedDoneness } from './profiles.js';
import { evaluate } from './quality.js';
import { handle as handleInteraction } from './interact.js';
import './help.js';
import { leavesFond, makeFond, fondState, fondModifier, fondText } from './fond.js';
import { portionOf, canChop, portionName, yieldOf } from './portions.js';
import { timeline } from './quality.js';
import { signature, matchDish, dishName, composeBand, seasoningBonus, seasoningIdeal, nounFor, UNKNOWN_DISH } from './dishes.js';
import { cookbookState, learnRecipe, improveRecipe, recordAttempt, beatsRecorded, knownBonus, markRoutineIp } from './knowledge.js';
import { rewardFor, restMultiplier, restText, RESTS_WELL } from './config.js';
import { DISCOVERY_IP, DISCOVERY_ATTEMPTS, MODIFIER_BONUS, MODIFIER_BONUS_CAP, OVER_SEASON_PENALTY, DEFAULT_SEASONING, STAGING } from './config.js';

// Any blade will do. `can_chop` is the kitchen-specific tag; `butchering` is
// what every knife in the game already carries, so all three existing blades
// work without a content edit.
const chopTool = player => resolveInventoryItem(player, { tag: ['can_chop', 'butchering'], topLevel: true });

const nounOf = row => nounFor(row, tagValue);

const DISH_ITEM = 'item_cooked_dish';

function stovesInZone(zoneId) {
  return getZoneFurniture(zoneId).filter(f => f.flags?.stove_tier);
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
    return kinds.has('drug') && hasSynthesis()
      ? toDrugs(player, null, broadcast)
      : { type: 'error', message: 'Cook what?' };
  }

  // Named a station directly ("cook on the range" / "cook stove")? Honour it.
  const stations = cookStations(player.current_zone);
  if (stations.length > 1) {
    const s = siftResolve(nameStr, stations);
    if (s.type === 'match' && s.candidate._cookKind === 'drug' && hasSynthesis()) return toDrugs(player, null, broadcast);
    if (s.type === 'match' && s.candidate._cookKind === 'food') return { type: 'error', message: 'Cook what?' };
  }

  // Carrying something by that name that can actually be cooked → it's food.
  const carried = await resolveInventoryItem(player, { name: nameStr, tag: ['needs_cooking', 'vessel'], topLevel: true });
  if (!carried && hasSynthesis()) return toDrugs(player, nameStr, broadcast);
  return cookFood(nameStr, player, broadcast);
}

async function cookFood(nameStr, player, broadcast) {
  // `cook <vessel>` puts the pan and everything in it on the heat; `cook <food>`
  // puts the food straight on the stove, which works but cooks worse.
  const vessel = await resolveInventoryItem(player, { tag: 'vessel', name: nameStr, topLevel: true });
  let foods;
  if (vessel) {
    // Anything profiled counts as an ingredient, whether or not it strictly
    // needs cooking — a tomato belongs on the heat. MODIFIERS are the exception:
    // fat and aromatics season the dish and never take a session of their own,
    // so they can't burn away to nothing while the main is still cooking.
    foods = (await vesselContents(vessel.inv_id))
      .filter(r => (hasTag(r, 'needs_cooking') || profileNameFor(r)) && !isModifier(r));
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
  let appliance = null;

  if (stoves.length) {
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
  await commitCooks(prepared, appliance);

  broadcast?.(player.current_zone, { type: 'zone_event', message: `${player.handle} starts cooking something.` }, player.id);
  return { type: 'output', message: messages.join('\n') };
}

// Take it off the heat. This is where quality is decided — lazily, from the
// session's timestamps and the acts recorded against it, at the moment the
// player chose to stop. Nothing was simulated to get here.
async function cmdPlate(args, raw, player) {
  const nameStr = args.join(' ').trim();
  if (!nameStr) return { type: 'error', message: 'Plate what?' };

  // `plate <vessel>` resolves everything in it into one dish; `plate <food>`
  // keeps the original single-item behaviour below.
  const vessel = await resolveInventoryItem(player, { tag: 'vessel', name: nameStr, topLevel: true });
  if (vessel) return plateVessel(vessel, player);

  const food = await resolveInventoryItem(player, { name: nameStr, topLevel: false });
  if (!food) return { type: 'error', message: `You don't have "${nameStr}".` };

  const session = food.custom_data?.cooking;
  if (!session) return { type: 'error', message: `${food.name} isn't on the heat.` };
  const profile = sessionProfile(session);

  // Unprofiled food has no window and no bands — pulling it early just means it
  // isn't cooked yet, which the eat path already handles on its own.
  if (!profile) {
    if (Date.now() < session.doneAt) return { type: 'error', message: `${food.name} isn't done yet.` };
    await freeAppliance(session);
    await endSession(food.inv_id, null);
    return { type: 'output', message: `You take ${food.name} off the heat.` };
  }

  const check = await skillCheck(player, 'cooking', profile.difficulty);
  const now = Date.now();
  const result = evaluate(session, profile, now, check.margin);
  const done = plateDoneness(session, profile, now);

  // A smoke transforms what it produces; an ordinary cook just grades it.
  const smoked = session.smoking
    ? { profile: SMOKER_PROFILE, name: `smoked ${nounOf(food)}`, noun: `smoked ${nounOf(food)}` }
    : null;

  // Browning a component is a STEP, not the meal — it stays finishable so it
  // can go on to be the thing it was made for.
  const isComponent = !!food.custom_data?.crafted_quality;

  await freeAppliance(session);
  if (!(await endSession(food.inv_id, result.band, done, smoked, isComponent))) {
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
  return { type: 'output', message: verdict };
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
  const cooking = contents.filter(r => r.custom_data?.cooking);

  // A BOWL is worked, not cooked. Its ingredients never take a session, so they
  // are scored at their RAW target instead of off a timeline — which is why the
  // dips lean on things that are excellent raw, and why a mashing tool is the
  // gate rather than heat.
  const rawWorked = isBowl ? contents.filter(r => profileNameFor(r) && !isModifier(r)) : [];
  if (!cooking.length && !isBowl) return { type: 'error', message: `Nothing in the ${vessel.name} is on the heat.` };
  if (isBowl) {
    if (!rawWorked.length) return { type: 'error', message: `There's nothing in the ${vessel.name} to work with.` };
    const masher = await resolveInventoryItem(player, { tag: 'can_stir', topLevel: true });
    if (!masher) return { type: 'error', message: `You need something to mash with — a pestle, a spoon, anything.` };
    // A bowl never sees heat, so its prep check lands here instead of at `cook`.
    const toChop = rawWorked.filter(needsPrep);
    if (toChop.length && !(await chopTool(player))) {
      return { type: 'error', message: `${toChop[0].name} needs chopping first, and you have no knife.` };
    }
  }

  // Modifiers sit in the vessel unscored — they season what's cooking rather
  // than cooking alongside it. They still count toward the dish MATCH (a sear
  // genuinely requires fat) and are still consumed.
  const modifiers = contents.filter(r => isModifier(r));

  const inVessel = [...cooking, ...rawWorked, ...modifiers];
  const sig = signature(inVessel, profileNameFor);
  // Named dishes anchor on a specific item id (ramen noodles, jerk paste), so
  // the matcher needs to know what's actually in the pot, not just its classes.
  const hit = matchDish(sig, kind, new Set(inVessel.map(r => r.item_id)));
  const template = hit?.template || UNKNOWN_DISH;
  const key = hit?.key || null;

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
  const dishYield = yieldOf([...cooking, ...rawWorked]);
  // Seasoning counts in portions as well: half a bulb of garlic is half a bulb.
  const seasoning = seasoningBonus(template, modifiers.reduce((a, r) => a + portionOf(r), 0));
  // With no timeline to score against, a bowl leans on the cook's hands instead.
  const handWork = isBowl ? SKILL_WEIGHT * Math.max(-1, Math.min(1, check.margin / 20)) : 0;
  // What the pan itself brings: a lifted sear pays, dried-on residue costs.
  const fondBonus = fondModifier(vessel.custom_data?.fond, { deglazed: !!vessel.custom_data?.deglazed });
  // A component made badly caps what it can become, however well you cook it.
  const craftedCap = inVessel
    .map(r => r.custom_data?.crafted_quality)
    .filter(Boolean)
    .reduce((lo, q) => (lo === null || bandIndex(q) < bandIndex(lo) ? q : lo), null);
  const capped = craftedCap && bandIndex(craftedCap) < bandIndex(template.ceiling)
    ? { ...template, ceiling: craftedCap } : template;
  const band = composeBand(bands, capped, (key ? knownBonus(known, key) : 0) + seasoning + handWork + fondBonus);
  const name = dishName(template, inVessel, profileNameFor, tagValue);

  if (cooking.length) await freeAppliance(cooking[0].custom_data.cooking);

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
    vesselKind: kind, profiles: inVessel.map(profileNameFor), band,
    hadLiquid: inVessel.some(r => profileNameFor(r) === 'liquid'),
  }) ? makeFond(searedProfile, band, now) : null;

  await query(
    newFond
      ? `UPDATE player_inventory SET custom_data = (COALESCE(custom_data,'{}'::jsonb) - 'deglazed') || jsonb_build_object('fond', $2::jsonb) WHERE id=$1`
      : `UPDATE player_inventory SET custom_data = (COALESCE(custom_data,'{}'::jsonb) - 'fond' - 'deglazed') WHERE id=$1`,
    newFond ? [vessel.inv_id, JSON.stringify(newFond)] : [vessel.inv_id]
  );

  const lines = [];
  const label = band[0].toUpperCase() + band.slice(1);
  lines.push(intermediate
    ? `You work it together and roll it out: ${name}. ${label} — and not dinner yet.`
    : key
      ? `You plate it up: ${name}. It's ${label}.`
      : `You plate whatever this is. ${label}, and that's being generous.`);

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
  const key = String(tagValue(card, 'recipe_card', '') || '').trim();
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
// what the whole fed you. What you gain is TIME — cook duration scales with
// weight, so a quartered potato finishes in a quarter of the time. Chopping is
// how you make a slow ingredient land alongside a fast one, which is the other
// half of staging and the reason to carry a knife past the prep gate.
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
  if (!profileNameFor(food)) return { type: 'error', message: `${food.name} isn't food.` };
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
  const stamp = i => JSON.stringify({ ...(food.custom_data || {}), portion: each, name: pieceName });
  await query(
    `WITH cut AS (DELETE FROM player_inventory WHERE id = $1 RETURNING player_id, item_id, condition, container_id)
     INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, container_id, custom_data)
     SELECT unnest($2::text[]), player_id, item_id, 1, condition, container_id, $3::jsonb FROM cut`,
    [food.inv_id, Array.from({ length: pieces }, () => randomUUID()), stamp()]
  );

  return {
    type: 'output',
    message: `You cut ${baseName} into ${pieces}. ${pieces} × ${pieceName}, and each one will cook in a fraction of the time.`,
  };
}

// `deglaze <vessel>` — lift the browned bottom into the liquid. Needs fond in
// the pan and something wet in it to lift with. This is the one action that
// makes a second cook depend on the first, and it's worth more than any single
// seasoning: a sauce built on a sear is a different sauce.
async function cmdDeglaze(args, raw, player) {
  const nameStr = args.join(' ').trim();
  const vessel = await resolveInventoryItem(player, { tag: 'vessel', name: nameStr || undefined, topLevel: true });
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
  return {
    type: 'output',
    message: `You pour the ${wet.name} into the ${vessel.name} and scrape. The brown comes up off the bottom and goes into the sauce.`,
  };
}

// `scour <vessel>` — the other half of fond: residue you didn't lift is a
// penalty until it's cleaned off. Somebody has to do the washing up.
async function cmdScour(args, raw, player) {
  const nameStr = args.join(' ').trim();
  const vessel = await resolveInventoryItem(player, { tag: 'vessel', name: nameStr || undefined, topLevel: true });
  if (!vessel) return { type: 'error', message: nameStr ? `You don't have "${nameStr}".` : `Scour what?` };
  if (!vessel.custom_data?.fond) return { type: 'error', message: `The ${vessel.name} is already clean enough.` };

  await query(
    `UPDATE player_inventory SET custom_data = (custom_data - 'fond' - 'deglazed') WHERE id=$1`,
    [vessel.inv_id]
  );
  return { type: 'output', message: `You scour the ${vessel.name} back to bare metal. It takes a while.` };
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

// Where the stove-or-lab pick lands. Plugin verbs must replay through an Action,
// never `{ verb }` — that route only reaches engine builtins (docs/commands.md).
registerAction({
  type: 'cooking.station_choice',
  handler: ({ actor, params }) => (params.target?._cookKind === 'drug' && hasSynthesis())
    ? toDrugs(actor, null, null)
    : { type: 'error', message: 'Cook what?' },
});

export const commands = {
  cook: cmdCook,
  plate: cmdPlate,
  kitchenkit: cmdKitchenKit,
  chop: cmdChop,
  cure: cmdCure,
  deglaze: cmdDeglaze,
  scour: cmdScour,
  doneness: cmdDoneness,
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
    if (state) lines.push(`  ${row.name} — ${state.text}`);
  }
  const idle = contents.filter(r => !r.custom_data?.cooking && profileNameFor(r));
  for (const row of idle) {
    lines.push(`  ${row.name} — ${isModifier(row) ? 'seasoning, not on the heat' : 'in, but not cooking yet'}`);
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
  'cooking.donenessRisk': (cd) => donenessRisk(cd),
};

// Exposed for the regression harness.
export const _test = { donenessRisk, plateDoneness, findFreeStove, stovesInZone, labsInZone, cookStations, vesselStats, vesselContents };
