/**
 * The re-print — what an Ascendant restore actually buys.
 *
 * The old body's chrome is gone. Genuinely gone: death.js corrupted it on the
 * way past and the wreckage is on a corpse across town, where anybody can pick
 * it up and confirm it. What happens here is that the vats MANUFACTURE the
 * roster again, cut to the measurements the pattern remembers.
 *
 * WHY THAT DISTINCTION IS THE WHOLE DESIGN. A restore that "saved" your chrome
 * would be a rollback, and a rollback is a mint: rollbacks can put back things
 * you no longer own. This can't. The pattern it prints from is captured off the
 * LIVE roster at the moment of death (see captureRoster, and the ordering in
 * index.js), so an augment you had removed to an item and sold last week is
 * simply not in it. Nothing is created that did not exist a second earlier.
 *
 * ⚠ THIS IS THE ONLY PLACE A RESTORE IS EVER SPENT. It used to be spent in the
 * respawn hook, which runs BEFORE the engine has decided whose override wins —
 * so a death jail went on to claim had already burned ₵2500 of somebody's
 * policy, with no rollback anywhere. The spend is now one guarded statement
 * whose WHERE clause is its own rollback.
 */
import { query } from '../../server/models/db.js';
import { recomputeEquipped } from '../../server/engine/commands/inventory.js';
import { hydrateAugments, rosterOf } from './state.js';
import { artifactsBetween } from './artifacts.js';
import { setFull } from './power.js';
import {
  scheduleAscendantEmergence, FIDELITY_MAX, FIDELITY_FLOOR, FIDELITY_LOSS,
} from './backup.js';

/**
 * Freeze the roster as it stands. Called BEFORE corruption runs.
 *
 * ⚠ THE CLONE IS NOT OPTIONAL. corruptOnDeath mutates this same Map in place
 * (it deletes from it as it corrupts), so handing the live records forward
 * yields an empty pattern and a player who wakes up with nothing — a failure
 * that looks like the restore silently not firing rather than like an aliasing
 * bug, which is how it would survive review.
 */
export function captureRoster(player) {
  return [...rosterOf(player).values()].map(rec => ({
    augment_id: rec.augment_id,
    slot: rec.slot ?? null,
    condition: rec.condition ?? 1,
    calibration: rec.calibration ?? 100,
    install_quality: rec.install_quality || 'sound',
    overclock_level: rec.overclock_level ?? 0,
    custom_data: { ...(rec.custom_data || {}) },
  }));
}

/**
 * Print the new body. Returns null when nothing was spent (no policy left, or
 * somebody beat us to the row), in which case the player takes the ordinary
 * Ascendant vat exit with no chrome — which is a real outcome, not an error.
 */
export async function reprintClone(player, pattern, corpseId = null) {
  // The spend and the fidelity hit in ONE statement, guarded on the balance it
  // is about to decrement. If two deaths race, exactly one of them finds
  // restores_remaining >= 1 and the other returns no row and prints nothing.
  const { rows } = await query(
    `UPDATE player_backups
        SET restores_remaining = restores_remaining - 1,
            copy_fidelity = GREATEST($2::int, copy_fidelity - $3::int)
      WHERE player_id = $1 AND restores_remaining >= 1
      RETURNING restores_remaining, copy_fidelity`,
    [player.id, FIDELITY_FLOOR, FIDELITY_LOSS],
  );
  if (!rows.length) return null;

  const left = Number(rows[0].restores_remaining) || 0;
  const fidelity = Number(rows[0].copy_fidelity ?? FIDELITY_MAX);
  const before = Math.min(FIDELITY_MAX, fidelity + FIDELITY_LOSS);

  // Fresh hardware, old measurements. Condition, calibration and a botched
  // fitting all carry: the vats copy what the pattern says you were running,
  // and a print that quietly handed back a clean install would make dying the
  // cheapest way to fix a bad one.
  //
  // overclock_level does NOT carry. A new piece comes off the bed at spec;
  // winding it back up is a thing you choose, every time.
  await query('DELETE FROM player_augments WHERE player_id=$1', [player.id]);
  for (const a of pattern || []) {
    await query(
      `INSERT INTO player_augments
         (player_id, augment_id, slot, condition, calibration, install_quality, overclock_level, custom_data)
       VALUES ($1,$2,$3,$4,$5,$6,0,$7)
       ON CONFLICT (player_id, augment_id) DO NOTHING`,
      [player.id, a.augment_id, a.slot ?? null, a.condition ?? 1, a.calibration ?? 100,
       a.install_quality || 'sound', JSON.stringify(a.custom_data || {})],
    );
  }
  await hydrateAugments(player);      // the roster in RAM must agree with the rows
  await recomputeEquipped(player);    // re-printed chrome drives soak again
  setFull(player);                    // you come off the bed charged — that is the point of coming HERE

  // The read point (augScale) is sync by contract, so RAM is the source of
  // truth for the cap and the column is only its backing store.
  player._copyFidelity = fidelity;

  const gained = artifactsBetween(before, fidelity);
  scheduleAscendantEmergence(player, {
    left, fidelity, chrome: (pattern || []).length, artifacts: gained,
  });
  return { left, fidelity, chrome: (pattern || []).length, artifacts: gained };
}
