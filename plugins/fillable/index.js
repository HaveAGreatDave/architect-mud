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
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { applyThirst } from '../../server/engine/bodily.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { registerFluidResolver } from '../../server/engine/topical.js';
import { getZoneFurniture } from '../../server/engine/world.js';

// Thirst restored per fluid unit, keyed by fluid type. Only water exists today.
const FLUID_RATES = { water: 1 };

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
           - 'fluid_amount' - 'fluid_type' - 'contaminated' WHERE id=$1`, [invId]);
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
  if (!fuelSrc.length && !waterSrc.length)
    return { type:'error', message:`There's nothing here to fill the ${c.name} from.` };

  const amount = c.custom_data?.fluid_amount || 0;
  const held = c.custom_data?.fluid_type;

  // A non-empty container can only take on more of the same fluid, and only
  // where that fluid is on tap. Otherwise you have to empty it first.
  let fluidType, srcName;
  if (amount > 0 && held) {
    if (held === 'fuel' && fuelSrc.length) { fluidType = 'fuel'; srcName = fuelSrc[0].name; }
    else if (held === 'water' && waterSrc.length) { fluidType = 'water'; srcName = waterSrc[0].name; }
    else return { type:'error', message:`The ${c.name} already holds ${held}. Empty it first.` };
  } else {
    // Empty: fill from whatever's here; a fuel pump wins if both are present.
    if (fuelSrc.length) { fluidType = 'fuel'; srcName = fuelSrc[0].name; }
    else { fluidType = 'water'; srcName = waterSrc[0].name; }
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
  const unit = fluidType === 'fuel' ? Number(fuelSrc[0]?.flags?.fuel_source) || 0 : 0;
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
    [JSON.stringify({ fluid_amount: cap, fluid_type: fluidType, contaminated }), invId]);

  // The money moves AFTER the fluid, so a failed write cannot bill for a fill that did not happen.
  if (charged > 0) {
    player.credits -= charged;
    await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  }

  const flavour = fluidType === 'fuel'
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

async function drink(args, raw, player) {
  const name = args.join(' ').replace(/^(from|at)\s+/i, '').trim();
  const c = await resolveContainer(player, name);
  if (!c) return undefined; // fall through (e.g. to water-source furniture)
  if (holdsDrink(c)) return undefined;  // a poured drink is the drinks plugin's cup

  const amount = c.custom_data?.fluid_amount || 0;
  if (amount <= 0) return { type:'error', message:`The ${c.name} is empty.` };

  if ((c.custom_data?.fluid_type || 'water') === 'fuel')
    return { type:'error', message:`The ${c.name} is full of fuel — you're not that desperate.` };

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
    await query(`UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) - 'fluid_amount' - 'fluid_type' - 'contaminated' WHERE id=$1`,
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

async function empty(args, raw, player) {
  const c = await resolveContainer(player, args.join(' ').trim());
  if (!c) return undefined; // fall through
  if (holdsDrink(c)) return undefined;  // tipping a poured drink out is drinks' business

  if ((c.custom_data?.fluid_amount || 0) <= 0)
    return { type:'error', message:`The ${c.name} is already empty.` };

  await query(`UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) - 'fluid_amount' - 'fluid_type' - 'contaminated' WHERE id=$1`,
    [c.inv_id]);
  return { type:'use', message:`You empty the ${c.name} onto the ground.` };
}

export const specializedActions = [
  { verb: 'fill', requiredTag: 'fillable', handler: fill },
  { verb: 'empty', requiredTag: 'fillable', handler: empty },
  { verb: 'drink', requiredTag: 'fillable', handler: drink },
];
