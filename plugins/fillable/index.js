/**
 * Fillable container plugin — FILL / DRINK / EMPTY as tag-gated specialized
 * actions for items carrying the `fillable` capacity tag (canteens, bottles,
 * jugs). A fillable container holds a fluid amount and a fluid type in its
 * instance custom_data (player_inventory.custom_data); absent/0 means empty.
 *
 * The container's capacity is a neutral fluid volume. How a fluid converts to
 * thirst is a property of the *fluid* (FLUID_RATES below), applied at drink
 * time — so a future fluid can restore a different amount per unit without
 * touching the container.
 *
 * Each handler self-resolves its target item and returns undefined to fall
 * through (same contract as the water plugin's drinkFrom). For DRINK this means
 * `drink <canteen>` lands here while bare `drink` / `drink from sink` falls
 * through to the water plugin's water_source furniture handler.
 */
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { tagValue } from '../../server/engine/tags.js';
import { resolveInventoryItem, burnCharge } from '../../server/engine/inventory.js';
import { applyThirst } from '../../server/engine/bodily.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { registerFluidResolver } from '../../server/engine/topical.js';
import { getZoneFurniture } from '../../server/engine/world.js';
import { useDrug, getDrugCache, drugForItem } from '../../server/engine/drugs.js';

// Thirst restored per fluid unit, keyed by fluid type. Only water exists today.
const FLUID_RATES = { water: 1 };

// -- A DRUG IS A FLUID, AND THE CARRIER IS NOT THE CARGO ---------------------
//
// Two different things had to stay separable here. `fluid_type` is the CARRIER
// -- what is physically in the can -- and `drug_id` is the CARGO dissolved in
// it. Neat product bottled at strength is carrier `drug`; a tab dropped into a
// canteen leaves the carrier as `water` and adds the cargo. Collapsing them
// into one field (`fluid_type: 'drug_blotter'`) would make dosed water
// indistinguishable from a bottle of solvent, and every thirst, stain and
// wetting question downstream would have to learn drug ids to answer.
//
// The topical resolver above already read this shape (`drug: cd.drug_id`) long
// before anything could produce it -- dousing somebody in product was the first
// consumer. Drinking it is the second, and it needed no new schema.
const DRUG_CARRIER = 'drug';

// Fluid units that make one full-strength dose. Drinking less doses you
// proportionally rather than not at all, because a mouthful of something is not
// nothing -- and a big enough swallow carries more than one dose, which is how a
// jerry can of neat product is dangerous rather than merely large.
const DRUG_DOSE_UNITS = 4;

// Neat product carries no water, so it slakes nothing. Dosed WATER still slakes
// at the water rate -- the carrier answers that question, which is the whole
// reason the two fields are separate.
FLUID_RATES[DRUG_CARRIER] = 0;

const drugName = id => getDrugCache()[id]?.name || 'something';

// What separates the two nouns. `into` and `in` both read naturally, and `to`
// is accepted for pour alone -- `dissolve tab to canteen` is not English, and
// letting it through would only widen what a mistyped line can silently do.
const POUR_SPLIT = /\s+(?:into|in|to)\s+/i;
const DISSOLVE_SPLIT = /\s+(?:into|in)\s+/i;

// Emptying a container must clear the CARGO as well as the carrier. Left behind,
// a stale `drug_id` would sit in the row and re-dose the next person to fill it
// from a tap -- the failure mode looks like water that is inexplicably laced.
const CLEAR = "- 'fluid_amount' - 'fluid_type' - 'contaminated' - 'drug_id' - 'potency'";

// ── What's in the can, for anything that wants to throw it ──────────────────
//
// The topical substrate ("a liquid landing on a body") must not learn that a
// canteen keeps its contents under `fluid_amount`/`fluid_type` while a cocktail
// glass keeps them somewhere else entirely. So the plugin that OWNS the schema
// answers the question — this is the same rule as the effect registry, pointed
// at the container instead of the consequence.
//
// A dousing is a POUR: the potency is how much is actually in there, so a
// mouthful in the bottom of a canteen is a splash and a full jug is a soaking.
// `contaminated` is the one branch worth making here, because the fluid the
// world calls "water" and the fluid a fill from a bad tap gives you are not the
// same thing to land on somebody.
const DOUSE_UNITS = 12;   // fluid units that make a full-strength dousing
registerFluidResolver((item) => {
  const cd = item?.custom_data;
  const amount = Number(cd?.fluid_amount) || 0;
  if (amount <= 0) return null;
  if (cd?.drink) return null;                 // the vessel invariant: not ours
  const type = cd.fluid_type || 'water';
  const fluid = (type === 'water' && cd.contaminated) ? 'dirty_water' : type;
  return {
    fluid,
    potency: Math.min(1, amount / DOUSE_UNITS),
    label: fluid === 'dirty_water' ? 'filthy water' : type,
    // What's DISSOLVED in it, if anything — the carrier and the cargo are two
    // different questions. A canteen stamped with a `drug_id` (a product cut
    // into solvent) doses whoever it lands on at whatever fraction actually
    // crosses their skin; a canteen of water carries nothing and this is null.
    drug: cd.drug_id || null,
    potencyMult: Number(cd.potency) || 1,
    empty: async (invId) => {
      await query(
        `UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb)
           ${CLEAR} WHERE id=$1`, [invId]);
    },
  };
});

// Resolve a named fillable container in the player's top-level inventory.
async function resolveContainer(player, name) {
  if (!name) return null;
  return resolveInventoryItem(player, { tag: 'fillable', name });
}

/**
 * THE VESSEL INVARIANT. Drinkware (mugs, glasses, shakers) is `fillable` too —
 * a mug you can fill at a sink is the same mug you brew into — so a vessel
 * holding a finished drink reaches these handlers as well. It must not: this
 * plugin knows only about plain fluid volume and would treat a negroni as an
 * empty cup, or pour water into one.
 *
 * The drinks plugin registers `drink` FIRST (specialized actions fire in
 * registration order, which is alphabetical, and `drinks` < `fillable`), so in
 * practice it already claims these. This is the belt to that braces: it does not
 * depend on load order, and a folder rename can't quietly break it.
 */
const holdsDrink = c => !!c?.custom_data?.drink;

async function fill(args, raw, player) {
  const name = args.join(' ').replace(/\s+from\s+.*$/i, '').trim();
  const c = await resolveContainer(player, name);
  if (!c) return undefined; // fall through
  if (holdsDrink(c)) return { type:'error', message:`The ${c.name} already has a drink in it. Finish it or tip it out first.` };

  // A zone can carry either kind of tap. A fuel pump dispenses 'fuel', a sink /
  // fountain dispenses 'water' — the fluid a fill produces is the source's, not
  // the container's.
  // Both taps come off the in-memory room furniture — this was two round trips
  // on every `fill`, to ask what is standing in a room the process already knows.
  const here = getZoneFurniture(player.current_zone);
  const fuelSrc = here.filter(f => f.flags && 'fuel_source' in f.flags).slice(0, 1);
  const waterSrc = here.filter(f => f.flags && 'water_source' in f.flags).slice(0, 1);

  // A THIRD TAP. `drug_source` holds the drug id it dispenses rather than a bare
  // flag, because unlike fuel and water there is no single substance a drug tap
  // could be assumed to give -- a still and a chem bench in the same room are two
  // different products, and the furniture is the only thing that knows which.
  // Price rides on its own key (`drug_price`) for that reason: the value slot is
  // already spoken for by the id, and overloading it would make an unpriced tap
  // indistinguishable from a free one that dispenses the drug called '0'.
  const drugSrc = here.filter(f => f.flags && getDrugCache()[f.flags.drug_source]).slice(0, 1);

  if (!fuelSrc.length && !waterSrc.length && !drugSrc.length)
    return { type:'error', message:`There's nothing here to fill the ${c.name} from.` };

  const amount = c.custom_data?.fluid_amount || 0;
  const held = c.custom_data?.fluid_type;

  // A non-empty container can only take on more of the same fluid, and only
  // where that fluid is on tap. Otherwise you have to empty it first.
  let fluidType, srcName, drugId = null;
  if (amount > 0 && held) {
    if (held === 'fuel' && fuelSrc.length) { fluidType = 'fuel'; srcName = fuelSrc[0].name; }
    else if (held === 'water' && waterSrc.length) { fluidType = 'water'; srcName = waterSrc[0].name; }
    // Topping up product only works from a tap running THE SAME product. Two
    // drugs in one can is a compound nobody mixed, and the splice bench is where
    // that is supposed to be decided.
    else if (held === DRUG_CARRIER && drugSrc.length && drugSrc[0].flags.drug_source === c.custom_data?.drug_id) {
      fluidType = DRUG_CARRIER; srcName = drugSrc[0].name; drugId = c.custom_data.drug_id;
    }
    else return { type:'error', message:`The ${c.name} already holds ${held === DRUG_CARRIER ? drugName(c.custom_data?.drug_id) : held}. Empty it first.` };
  } else {
    // Empty: fill from whatever's here. A fuel pump wins if both are present,
    // and a drug tap loses to both -- the accident you can afford is a can of
    // water, not a can of product you did not mean to be carrying.
    if (fuelSrc.length) { fluidType = 'fuel'; srcName = fuelSrc[0].name; }
    else if (waterSrc.length) { fluidType = 'water'; srcName = waterSrc[0].name; }
    else { fluidType = DRUG_CARRIER; srcName = drugSrc[0].name; drugId = drugSrc[0].flags.drug_source; }
  }

  const cap = tagValue(c, 'fillable', 0);

  // ── A PUMP IS A BUSINESS; A TAP IS NOT ──────────────────────────────────────
  //
  // `fuel_source` may carry a price in ₵ per fluid unit. A bare flag (the shape every fuel source
  // in the game had before forecourts existed) is 0 and free, so nothing that already worked
  // starts charging — the price is opt-in per piece of furniture, authored on the pump.
  //
  // Water is deliberately never priced. A tap you have to pay for is a different design decision
  // from a pump you have to pay for, and it is not one this line gets to make quietly.
  const unit = fluidType === 'fuel' ? Number(fuelSrc[0]?.flags?.fuel_source) || 0
    : fluidType === DRUG_CARRIER ? Number(drugSrc[0]?.flags?.drug_price) || 0
    : 0;
  let charged = 0;
  if (unit > 0) {
    charged = Math.ceil(cap * unit);
    if ((player.credits || 0) < charged)
      return { type: 'error', message: `Filling the ${c.name} is ${charged}₵ and you have ${player.credits || 0}₵.` };
  }

  // Water drawn from a fouled/peed toilet is foul — tag it so drinking it later
  // sickens, instead of the fouling silently vanishing into a clean canteen.
  let contaminated = false;
  if (fluidType === 'water' && waterSrc.length) {
    const contam = await dispatchAction({ type: 'bodily.toiletContamination', params: { furnitureId: waterSrc[0].id } });
    contaminated = !!(contam?.fouled || contam?.peed);
  }

  // Filling makes the unit non-empty (unique). If it's part of a stack of
  // empties, split one off so only that unit gets filled.
  let invId = c.inv_id;
  if (c.quantity > 1) {
    await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [c.inv_id]);
    invId = randomUUID();
    await query('INSERT INTO player_inventory (id,player_id,item_id,quantity,is_equipped) VALUES ($1,$2,$3,1,0)',
      [invId, player.id, c.item_id]);
  }
  await query(`UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || $1::jsonb WHERE id=$2`,
    [JSON.stringify({ fluid_amount: cap, fluid_type: fluidType, contaminated, ...(drugId ? { drug_id: drugId } : {}) }), invId]);

  // The money moves AFTER the fluid, so a failed write cannot bill for a fill that did not happen.
  if (charged > 0) {
    player.credits -= charged;
    await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  }

  const flavour = fluidType === DRUG_CARRIER
    ? `It fills to the neck with ${drugName(drugId)}, neat and undiluted.${charged > 0 ? ` <span class="text-dim">(${charged}₵)</span>` : ''}`
    : fluidType === 'fuel'
    ? `Fuel sloshes to the brim, reeking of hydrocarbons.${charged > 0 ? ` <span class="text-dim">(${charged}₵)</span>` : ''}`
    : contaminated
    ? `<span style="color:var(--red)">It fills with cloudy, foul-smelling water. You shouldn't drink this.</span>`
    : `It's full of water.`;
  return {
    type: 'use',
    message: `You fill the ${c.name} from the ${srcName}. ${flavour}`,
    ...(charged > 0 ? { player_update: { credits: player.credits } } : {}),
  };
}

async function drink(args, raw, player, context) {
  const name = args.join(' ').replace(/^(from|at)\s+/i, '').trim();
  const c = await resolveContainer(player, name);
  if (!c) return undefined; // fall through (e.g. to water-source furniture)
  if (holdsDrink(c)) return undefined;  // a poured drink is the drinks plugin's cup

  const amount = c.custom_data?.fluid_amount || 0;
  if (amount <= 0) return { type:'error', message:`The ${c.name} is empty.` };

  if ((c.custom_data?.fluid_type || 'water') === 'fuel')
    return { type:'error', message:`The ${c.name} is full of fuel — you're not that desperate.` };

  // -- DRINKING THE CARGO ----------------------------------------------------
  //
  // Thirst is the wrong gate for a dosed container: nobody drinks laced water
  // because they are thirsty, and refusing a full canteen of product to a
  // hydrated player would make the whole route unreachable at the exact moment
  // it matters. So a container carrying a `drug_id` takes its own path, doses
  // through the ORDINARY useDrug on the existing `drink` route, and hands the
  // thirst question back to the carrier -- water still hydrates, neat product
  // does not, and neither branch had to be told which drug it was carrying.
  const cargo = c.custom_data?.drug_id;
  if (cargo) return drinkDosed(c, cargo, player, context);

  const thirstMissing = 100 - (player.thirst || 0);
  if (thirstMissing <= 0) return { type:'error', message:`You're not thirsty.` };

  const type = c.custom_data?.fluid_type || 'water';
  const rate = FLUID_RATES[type] ?? 1;
  const fluidUsed = Math.min(amount, Math.ceil(thirstMissing / rate));
  const thirstGain = Math.min(thirstMissing, fluidUsed * rate);

  applyThirst(player, thirstGain);
  await query('UPDATE players SET thirst=$1, hydration_load=$2 WHERE id=$3',
    [player.thirst, player.hydration_load || 0, player.id]);

  const remaining = amount - fluidUsed;
  if (remaining <= 0) {
    await query(`UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) ${CLEAR} WHERE id=$1`,
      [c.inv_id]);
  } else {
    await query(`UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || $1::jsonb WHERE id=$2`,
      [JSON.stringify({ fluid_amount: remaining }), c.inv_id]);
  }

  // Foul water (filled from a fouled toilet) still slakes thirst, but makes you
  // sick — bodily owns the sickness effect + flavour.
  if (c.custom_data?.contaminated) {
    const foul = await dispatchAction({ type: 'bodily.drinkContaminated', actor: player, params: { fouled: true } });
    return {
      type:'use',
      message:`You drink from the ${c.name}. (+${thirstGain} Thirst) ${foul.message}`,
      player_update:{ thirst: player.thirst },
    };
  }

  return {
    type:'use',
    message:`You drink from the ${c.name}. (+${thirstGain} Thirst)`,
    player_update:{ thirst: player.thirst },
  };
}

/**
 * Swallow from a container whose fluid carries a drug.
 *
 * The dose is the VOLUME you actually took, not the fact that you took any: a
 * sip off the top is a fraction of a dose and a long pull off a full can is more
 * than one. That is the only thing this function decides. Everything else --
 * onset, tolerance, overdose weight, the come-up prose, addiction -- belongs to
 * useDrug and is not reimplemented here, which is why a drink of laced water and
 * a swallowed tab of the same drug land in the same state row.
 */
async function drinkDosed(c, drugId, player, context) {
  const amount = c.custom_data?.fluid_amount || 0;
  const carrier = c.custom_data?.fluid_type || 'water';

  // How much goes down in one go. Capped at a dose and a half of neat product --
  // you can empty the can, but it takes more than one swallow to do it, and the
  // cap is what stops a jerry can being an instant lethal overdose off one verb.
  const pull = Math.min(amount, Math.ceil(DRUG_DOSE_UNITS * 1.5));
  const fraction = pull / DRUG_DOSE_UNITS;

  // Batch strength (custom_data.potency, stamped by synthesis) rides on top of
  // the volume, exactly as it does when the same product is swallowed as a pill.
  const potencyMult = fraction * (Number(c.custom_data?.potency) || 1);

  const res = await useDrug(player, drugId, context?.broadcast, { route: 'drink', potencyMult });
  if (!res.success) return { type: 'error', message: res.message };

  // A dosed WATER still hydrates -- the carrier answers the thirst question. Neat
  // product is FLUID_RATES[DRUG_CARRIER] = 0, so this contributes nothing without
  // needing a branch that names the carrier.
  const rate = FLUID_RATES[carrier] ?? 0;
  const thirstMissing = 100 - (player.thirst || 0);
  const thirstGain = Math.min(thirstMissing, pull * rate);
  if (thirstGain > 0) {
    applyThirst(player, thirstGain);
    await query('UPDATE players SET thirst=$1, hydration_load=$2 WHERE id=$3',
      [player.thirst, player.hydration_load || 0, player.id]);
  }

  const remaining = amount - pull;
  if (remaining <= 0) {
    await query(`UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) ${CLEAR} WHERE id=$1`, [c.inv_id]);
  } else {
    await query(`UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || $1::jsonb WHERE id=$2`,
      [JSON.stringify({ fluid_amount: remaining }), c.inv_id]);
  }

  return {
    type: 'use',
    message: `You drink from the ${c.name}.${res.message ? ' ' + res.message : ''}${thirstGain > 0 ? ` (+${thirstGain} Thirst)` : ''}`,
    ...(thirstGain > 0 ? { player_update: { thirst: player.thirst } } : {}),
  };
}

// -- pour (transfer) ---------------------------------------------------------
//
// `pour <a> into <b>` moves fluid between two plain containers. `drinks` claims
// this verb first for DRINKWARE (decanting a cocktail is its business and works
// in servings, not units), so this only ever sees the containers it owns.
//
// The rule is the same one `fill` enforces: a container takes on more of what it
// already holds, or it must be empty. Mixing two fluids by pouring would be a
// second, quieter way to make a compound nobody mixed -- and it is the obvious
// way to launder neat product into a canteen of water without the solubility
// step below ever being consulted.
async function pour(args, raw, player) {
  const line = args.join(' ').trim();
  const m = line.split(POUR_SPLIT);
  const from = await resolveContainer(player, (m[0] || '').trim());
  if (!from) return undefined;                     // fall through
  if (holdsDrink(from)) return undefined;          // a poured drink is drinks' business
  if (m.length < 2 || !m[1].trim())
    return { type: 'error', message: `Pour the ${from.name} into what?` };

  const to = await resolveContainer(player, m[1].trim());
  if (!to) return { type: 'error', message: `You aren't carrying a ${m[1].trim()} to pour into.` };
  if (to.inv_id === from.inv_id) return { type: 'error', message: `You can't pour the ${from.name} into itself.` };
  if (holdsDrink(to)) return { type: 'error', message: `The ${to.name} already has a drink in it.` };

  const have = from.custom_data?.fluid_amount || 0;
  if (have <= 0) return { type: 'error', message: `The ${from.name} is empty.` };

  const srcType = from.custom_data?.fluid_type || 'water';
  const srcDrug = from.custom_data?.drug_id || null;
  const dstAmount = to.custom_data?.fluid_amount || 0;
  if (dstAmount > 0) {
    const dstType = to.custom_data?.fluid_type || 'water';
    const dstDrug = to.custom_data?.drug_id || null;
    if (dstType !== srcType || dstDrug !== srcDrug)
      return { type: 'error', message: `The ${to.name} already holds something else. Empty it first.` };
  }

  const room = tagValue(to, 'fillable', 0) - dstAmount;
  if (room <= 0) return { type: 'error', message: `The ${to.name} is already full.` };
  const moved = Math.min(have, room);

  const carried = {
    fluid_amount: dstAmount + moved,
    fluid_type: srcType,
    contaminated: !!(from.custom_data?.contaminated || to.custom_data?.contaminated),
    ...(srcDrug ? { drug_id: srcDrug } : {}),
    ...(from.custom_data?.potency ? { potency: from.custom_data.potency } : {}),
  };
  await query(`UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || $1::jsonb WHERE id=$2`,
    [JSON.stringify(carried), to.inv_id]);

  const left = have - moved;
  if (left <= 0) {
    await query(`UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) ${CLEAR} WHERE id=$1`, [from.inv_id]);
  } else {
    await query(`UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || $1::jsonb WHERE id=$2`,
      [JSON.stringify({ fluid_amount: left }), from.inv_id]);
  }

  const what = srcDrug ? drugName(srcDrug) : srcType;
  return { type: 'use', message: `You pour ${moved} of ${what} from the ${from.name} into the ${to.name}.${left > 0 ? '' : ` The ${from.name} is empty.`}` };
}

// -- dissolve ----------------------------------------------------------------
//
// The other half of "a drug is a fluid": a drug that is NOT one can still end up
// in a container, because it goes into solution. This is the only path that
// turns a solid dose into a fluid one, and it is gated on the item rather than
// the drug -- `soluble` is a property of the physical thing you are holding, and
// a tab of blotter dissolves where a lit cigarette does not.
//
// It writes the CARGO and leaves the CARRIER alone: the water stays water, which
// is what makes a laced canteen indistinguishable from a clean one until somebody
// drinks it. That is the point of the verb.
async function dissolve(args, raw, player) {
  const line = args.join(' ').trim();
  const m = line.split(DISSOLVE_SPLIT);
  const drugItem = await resolveInventoryItem(player, { tag: 'soluble', name: (m[0] || '').trim() });
  if (!drugItem) return undefined;   // fall through

  if (m.length < 2 || !m[1].trim())
    return { type: 'error', message: `Dissolve the ${drugItem.name} in what?` };
  const c = await resolveContainer(player, m[1].trim());
  if (!c) return { type: 'error', message: `You aren't carrying a ${m[1].trim()}.` };
  if (holdsDrink(c)) return { type: 'error', message: `The ${c.name} already has a drink in it.` };

  const amount = c.custom_data?.fluid_amount || 0;
  if (amount <= 0) return { type: 'error', message: `The ${c.name} is empty. Put something in it first.` };
  if (c.custom_data?.drug_id)
    return { type: 'error', message: `There's already something dissolved in the ${c.name}.` };

  // Solubility is per-solvent. Water dissolves what water dissolves; a can of
  // fuel is not a drink and never becomes one, so it is refused here rather than
  // being allowed to hold a dose nobody could ever take.
  const carrier = c.custom_data?.fluid_type || 'water';
  if (carrier !== 'water')
    return { type: 'error', message: `The ${drugItem.name} won't go into ${carrier}.` };

  const drugId = drugForItem(drugItem.item_id);
  if (!drugId) return { type: 'error', message: `The ${drugItem.name} isn't going to dissolve into anything useful.` };

  const patch = {
    drug_id: drugId,
    ...(drugItem.custom_data?.potency ? { potency: drugItem.custom_data.potency } : {}),
  };
  await query(`UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || $1::jsonb WHERE id=$2`,
    [JSON.stringify(patch), c.inv_id]);

  // The solid is spent. A charged pack (a strip of tabs) burns one charge; a
  // single is destroyed. burnCharge owns that bookkeeping -- this must not learn
  // it, or a pack of ten would vanish whole the first time one went in a canteen.
  const itemTags = typeof drugItem.tags === 'string'
    ? (() => { try { return JSON.parse(drugItem.tags); } catch { return {}; } })()
    : (drugItem.tags || {});
  const burn = await burnCharge(drugItem, itemTags);
  if (!burn.charged) {
    if ((drugItem.quantity || 1) > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [drugItem.inv_id]);
    else await query('DELETE FROM player_inventory WHERE id=$1', [drugItem.inv_id]);
  }

  return {
    type: 'use',
    message: `You drop the ${drugItem.name} into the ${c.name} and swirl it. It goes into solution and leaves the water looking exactly like water.`,
  };
}

async function empty(args, raw, player) {
  const c = await resolveContainer(player, args.join(' ').trim());
  if (!c) return undefined; // fall through
  if (holdsDrink(c)) return undefined;  // tipping a poured drink out is drinks' business

  if ((c.custom_data?.fluid_amount || 0) <= 0)
    return { type:'error', message:`The ${c.name} is already empty.` };

  await query(`UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) ${CLEAR} WHERE id=$1`,
    [c.inv_id]);
  return { type:'use', message:`You empty the ${c.name} onto the ground.` };
}

export const specializedActions = [
  { verb: 'fill', requiredTag: 'fillable', handler: fill },
  { verb: 'pour', requiredTag: 'fillable', handler: pour },
  { verb: 'dissolve', requiredTag: 'soluble', handler: dissolve },
  { verb: 'empty', requiredTag: 'fillable', handler: empty },
  { verb: 'drink', requiredTag: 'fillable', handler: drink },
];
