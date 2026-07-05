/**
 * Bodily substrate — stains and digestion loads. This is deliberately ALL that
 * remains engine-side of the bodily system: stains are written by multiple
 * systems (bodily, mis, butchering) and rendered by describe/appearance, and
 * the digestion loads are read by drugs, inventory, fillable, and water. The
 * pressure simulation and the pee/poop/flush verbs live in plugins/bodily/
 * (Phase 2, docs/proposals/engine-plugin-boundary.md).
 */
import { query } from '../models/db.js';
import { world } from './world.js';

// How much load consuming food/drink adds. Scales with restore value. Tuned so
// that, with no passive decay, steady eating/drinking builds a genuine urge:
// bladder ~every 4h, bowel ~every 8h (eating +25 hunger adds ~17 load, drinking
// +25 thirst adds ~25). See plugins/bodily/index.js tickBodily.
export function foodLoad(restoreHunger)  { return (restoreHunger || 0) * 0.7; }
export function drinkLoad(restoreThirst) { return (restoreThirst || 0) * 1.0; }

// Apply a drink's thirst restore in-memory: bump the thirst meter (capped at 100)
// and the bladder load. Shared by item consumption (cmdUse) and furniture water
// sources so both stay in sync. Caller is responsible for persisting.
export function applyThirst(player, amount) {
  player.thirst = Math.min(100, (player.thirst || 0) + amount);
  player.hydration_load = Math.min(120, (player.hydration_load || 0) + drinkLoad(amount));
}

export async function stainClothing(player, slots, type) {
  const contamination = player.clothing_contamination || {};
  for (const slot of slots) contamination[slot] = type;
  player.clothing_contamination = contamination;
  await query('UPDATE players SET clothing_contamination=$1 WHERE id=$2',
    [JSON.stringify(contamination), player.id]);
}

export async function stainZone(zoneId, type) {
  const zone = world.zones.get(zoneId);
  if (!zone) return;
  zone.stains = zone.stains || {};
  zone.stains[type] = (zone.stains[type] || 0) + 1;
  await query('UPDATE zones SET stains=$1 WHERE id=$2', [JSON.stringify(zone.stains), zoneId]);
}

// A named body part maps to whichever equip slot would actually cover it, so
// aiming at "face" or "chest" checks the same slot a hat/shirt occupies.
const PART_TO_SLOT = {
  face: 'head', hair: 'head', head: 'head', scalp: 'head',
  chest: 'torso', torso: 'torso', back: 'torso', stomach: 'torso', belly: 'torso',
  hands: 'hands', arms: 'hands', arm: 'hands',
  legs: 'legs', leg: 'legs', thighs: 'legs', groin: 'legs', crotch: 'legs',
  feet: 'feet', foot: 'feet', shoes: 'feet',
};

// Stain a specific body part on a player target: soaks the garment covering it
// if one's worn there, otherwise leaves a visible residue note on bare skin
// (rendered like ejaculate_state — see appearance.js). Always leaves a mark
// somewhere on the target, never a no-op.
export async function stainCreatureBodyPart(target, type, part) {
  const label = (part || 'body').toLowerCase();
  const slot = PART_TO_SLOT[label];
  if (slot) {
    const { rows } = await query(
      `SELECT 1 FROM player_inventory WHERE player_id=$1 AND is_equipped=1 AND slot=$2 LIMIT 1`,
      [target.id, slot]
    );
    if (rows.length) {
      await stainClothing(target, [slot], type);
      return;
    }
  }
  if (!target.appearance_data) target.appearance_data = {};
  target.appearance_data.soiled_state = { type, locations: [label] };
  await query('UPDATE players SET appearance_data=$1 WHERE id=$2',
    [JSON.stringify(target.appearance_data), target.id]);
}
