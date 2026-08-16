/**
 * Death corruption — why nobody farms chrome off corpses.
 *
 * Installed hardware is keyed to a living nervous system. When that stops, the
 * chrome does not politely wait to be unbolted: it corrupts. What is left is a
 * ruined lump worth its scrap and nothing else.
 *
 * THE RULE THIS EXISTS FOR. Without it, an expensive augment is a reason to hunt
 * players rather than a reason to be one, and every fight in the game becomes a
 * chrome harvest. With it, the only way to get chrome is to buy it.
 *
 * GRADED, NOT TOTAL. Each augment rolls independently, weighted by how beaten up
 * it already was. Total corruption would mean two bad deaths cost a player five
 * figures AND close the flesh path forever (see `chromed_ever`), which is a
 * punishment out of proportion to the problem being solved — the problem is
 * looting, and a graded roll solves that just as completely.
 *
 * THE ORDERING TRAP, stated once because it is the thing that will break:
 * corruption is skipped ONLY when somebody took literal CUSTODY of the body.
 * Today that is jail and nothing else — the cops confiscate gear, they don't
 * take your spine, and there is no corpse left in the room to salvage onto.
 *
 * ⚠ IT USED TO BE SKIPPED ON `claimed` TOO, AND THAT INVERTED. A cortical
 * restore claims the death without taking the body, and it now WANTS this to
 * run: the Ascendant fiction is that the old chrome dies with the old torso and
 * the vats print new hardware to the same measurements. If corruption were
 * skipped here, the restore would be handing back the ORIGINAL pieces, which is
 * a rollback — and a rollback can put back a thing the player no longer owns.
 * The wreckage landing on their corpse is what makes the re-print honest: the
 * originals are provably scrap, in a room, where anyone can go and look.
 *
 * Ordering is owned by the single player.death subscriber in index.js, which
 * captures the roster before calling this and prints from the capture after.
 */
import { query } from '../../server/models/db.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { catalog, rosterOf } from './state.js';
import { giveItemRow } from './install.js';

/**
 * How likely a given augment is to survive. Chrome in good order sometimes
 * comes through; chrome that was already failing never does.
 */
export function survivalChance(condition) {
  const c = Math.max(0, Math.min(1, Number(condition ?? 1)));
  return 0.35 * c;      // pristine ≈ 1 in 3; battered much worse; dead never
}

/**
 * Corrupt what death took. Called from the respawn path AFTER the corpse exists,
 * and only when nothing else claimed the death.
 *
 * `corpseId` is the inventory owner the salvage lands on — the whole point is
 * that somebody CAN loot the wreckage, just not anything that still works.
 * With no corpse (a death that left no body) the salvage is simply lost.
 */
export async function corruptOnDeath(player, corpseId = null) {
  const roster = rosterOf(player);
  if (!roster.size) return { corrupted: [], survived: [] };
  const cache = await catalog();

  const corrupted = [];
  const survived = [];
  for (const rec of [...roster.values()]) {
    const aug = cache[rec.augment_id];
    if (!aug) continue;
    if (Math.random() < survivalChance(rec.condition)) { survived.push(aug); continue; }
    corrupted.push({ aug, rec });
  }
  if (!corrupted.length) return { corrupted, survived };

  const ids = corrupted.map(c => c.rec.augment_id);
  await query('DELETE FROM player_augments WHERE player_id=$1 AND augment_id = ANY($2)', [player.id, ids]);
  for (const id of ids) {
    roster.delete(id);
    player._augmentsDirty?.delete(id);
    player._augHeat?.delete(id);
    player._augWearPending?.delete(id);
  }

  // The wreckage. Scrap and repair stock — the salvage item's own tags carry
  // `no_install`, so nothing here can ever be fitted to anybody.
  if (corpseId) {
    for (const { aug, rec } of corrupted) {
      if (!aug.salvage_item_id) continue;
      await giveItemRow(corpseId, aug.salvage_item_id, {
        condition: Math.max(0.05, 0.2 * Number(rec.condition ?? 1)),
        customData: { ruined: true, from_augment: aug.id },
      });
    }
  }

  const names = corrupted.map(c => c.aug.name).join(', ');
  sendToPlayer(player.id, { type: 'output', message:
    `<span class="text-red">Your chrome did not come out of that with you.</span> `
    + `${names} corrupted when the body stopped — keyed hardware is keyed to something that was still running. `
    + (survived.length ? `<span style="opacity:.8">${survived.map(a => a.name).join(', ')} held.</span>` : '') });

  return { corrupted: corrupted.map(c => c.aug), survived };
}
