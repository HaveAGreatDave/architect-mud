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
import { applyThirst } from '../../server/engine/bodily.js';

// Thirst restored per fluid unit, keyed by fluid type. Only water exists today.
const FLUID_RATES = { water: 1 };

// Resolve a named fillable container in the player's top-level inventory.
async function resolveContainer(player, name) {
  if (!name) return null;
  const { rows } = await query(
    `SELECT pi.id, pi.item_id, pi.quantity, pi.custom_data, i.name, i.tags
     FROM player_inventory pi JOIN items i ON i.id = pi.item_id
     WHERE pi.player_id=$1 AND pi.container_id IS NULL
       AND jsonb_exists(i.tags,'fillable') AND i.name ILIKE $2 LIMIT 1`,
    [player.id, `%${name}%`]);
  return rows[0] || null;
}

async function fill(args, raw, player) {
  const name = args.join(' ').replace(/\s+from\s+.*$/i, '').trim();
  const c = await resolveContainer(player, name);
  if (!c) return undefined; // fall through

  // Require a water source in the zone (blind to what the furniture is).
  const { rows: src } = await query(
    `SELECT name FROM furniture WHERE zone_id=$1 AND jsonb_exists(flags,'water_source') LIMIT 1`,
    [player.current_zone]);
  if (!src.length) return { type:'error', message:`There's no water source here to fill the ${c.name} from.` };

  const amount = c.custom_data?.fluid_amount || 0;
  const type = c.custom_data?.fluid_type;
  if (amount > 0 && type && type !== 'water')
    return { type:'error', message:`The ${c.name} already holds ${type}. Empty it first.` };

  const cap = tagValue(c, 'fillable', 0);

  // Filling makes the unit non-empty (unique). If it's part of a stack of
  // empties, split one off so only that unit gets filled.
  let invId = c.id;
  if (c.quantity > 1) {
    await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [c.id]);
    invId = randomUUID();
    await query('INSERT INTO player_inventory (id,player_id,item_id,quantity,is_equipped) VALUES ($1,$2,$3,1,0)',
      [invId, player.id, c.item_id]);
  }
  await query(`UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || $1::jsonb WHERE id=$2`,
    [JSON.stringify({ fluid_amount: cap, fluid_type: 'water' }), invId]);

  return { type:'use', message:`You fill the ${c.name} from the ${src[0].name}. It's full of water.` };
}

async function drink(args, raw, player) {
  const name = args.join(' ').replace(/^(from|at)\s+/i, '').trim();
  const c = await resolveContainer(player, name);
  if (!c) return undefined; // fall through (e.g. to water-source furniture)

  const amount = c.custom_data?.fluid_amount || 0;
  if (amount <= 0) return { type:'error', message:`The ${c.name} is empty.` };

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
    await query(`UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) - 'fluid_amount' - 'fluid_type' WHERE id=$1`,
      [c.id]);
  } else {
    await query(`UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || $1::jsonb WHERE id=$2`,
      [JSON.stringify({ fluid_amount: remaining }), c.id]);
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

  if ((c.custom_data?.fluid_amount || 0) <= 0)
    return { type:'error', message:`The ${c.name} is already empty.` };

  await query(`UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) - 'fluid_amount' - 'fluid_type' WHERE id=$1`,
    [c.id]);
  return { type:'use', message:`You empty the ${c.name} onto the ground.` };
}

export const specializedActions = [
  { verb: 'fill', requiredTag: 'fillable', handler: fill },
  { verb: 'empty', requiredTag: 'fillable', handler: empty },
  { verb: 'drink', requiredTag: 'fillable', handler: drink },
];
