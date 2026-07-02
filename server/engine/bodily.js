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

// How much load consuming food/drink adds.
// Scales with restore value: eating something with +25 hunger adds ~12 load.
export function foodLoad(restoreHunger)  { return (restoreHunger || 0) * 0.5; }
export function drinkLoad(restoreThirst) { return (restoreThirst || 0) * 0.6; }

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
