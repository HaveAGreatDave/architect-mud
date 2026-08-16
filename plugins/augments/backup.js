/**
 * The cortical-backup loop — the Ascendant "death is a billing problem" economy.
 *
 * Buy prepaid restores at Halcyon, snapshot yourself at the Vats, and a
 * non-jailed death rolls you back to that snapshot instead of the clone vat.
 *
 * THE SNAPSHOT NOW CARRIES THE AUGMENT ROSTER, and it has to. Death corrupts
 * installed chrome (see death.js); a restore that rebuilt your coat and not your
 * spine would leave the most expensive thing you own as the one thing the policy
 * doesn't cover, which is the wrong joke for this faction entirely. The restore
 * is the advertised counter-play to corruption — that is what you are paying for.
 */
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { world } from '../../server/engine/world.js';
import { getFlag } from '../../server/engine/flags.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { recomputeEquipped } from '../../server/engine/commands/inventory.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { hydrateAugments, hasAugment } from './state.js';

export const CORTICAL = 'aug_cortical_backup';
export const RESTORE_PRICE = 2500;

export async function getBackup(playerId) {
  const { rows } = await query(
    'SELECT snapshot, restores_remaining, saved_at FROM player_backups WHERE player_id=$1', [playerId]
  );
  return rows[0] || null;
}

/** Sync — reads the hydrated roster, not the DB. */
export function hasCortical(player) {
  return hasAugment(player, CORTICAL);
}

/**
 * `backup` — snapshot yourself at the Vats Registry. Captures the perishable
 * state a restore rolls back to: inventory, credits, and the chrome in you.
 */
export async function cmdBackup(args, raw, player) {
  const zone = world.zones.get(player.current_zone);
  if (!zone?.flags?.ascendant_registry) {
    return { type: 'error', message: 'You can only commit a backup at the Vats Registry.' };
  }
  if (!hasCortical(player)) {
    return { type: 'error', message: 'The Registry construct regards you flatly. "No cortical backup on file. There is nothing of you to save." Install the Cortical Backup augment first.' };
  }
  const { rows } = await query(
    'SELECT item_id, quantity, condition, is_equipped, slot, custom_data, container_id, id FROM player_inventory WHERE player_id=$1',
    [player.id]
  );
  const { rows: augRows } = await query(
    `SELECT augment_id, slot, condition, calibration, install_quality, overclock_level, custom_data
       FROM player_augments WHERE player_id=$1`,
    [player.id]
  );
  const snapshot = {
    // NO CREDITS, DELIBERATELY. A balance is not a thing that was in the tank.
    // Rolling it back both ways was the one part of the restore that could MINT:
    // back up rich, move the money somewhere death doesn't reach (the bank is
    // untouched by death, and so is another player's pocket), then die and have
    // the old balance handed back on top of it. It also charged the opposite way
    // for nothing — a good week's earnings deleted because you last stood at the
    // Registry before you had them. The restore skips the corpse entirely, so
    // carried credits are never dropped or zeroed on this path: leaving them
    // alone is both the honest number and the safe one.
    inventory: rows.map(r => ({
      old_id: r.id, item_id: r.item_id, quantity: r.quantity, condition: r.condition,
      is_equipped: r.is_equipped, slot: r.slot, custom_data: r.custom_data || {}, container_id: r.container_id,
    })),
    augments: augRows.map(r => ({
      augment_id: r.augment_id, slot: r.slot, condition: r.condition, calibration: r.calibration,
      install_quality: r.install_quality, overclock_level: r.overclock_level, custom_data: r.custom_data || {},
    })),
  };
  const existing = await getBackup(player.id);
  const restores = existing?.restores_remaining || 0;
  await query(
    `INSERT INTO player_backups (player_id, snapshot, restores_remaining, saved_at)
       VALUES ($1, $2, $3, EXTRACT(EPOCH FROM NOW()))
     ON CONFLICT (player_id) DO UPDATE SET snapshot = EXCLUDED.snapshot, saved_at = EXCLUDED.saved_at`,
    [player.id, JSON.stringify(snapshot), restores]
  );
  const chromeNote = augRows.length
    ? `\n<span style="opacity:.8">${augRows.length} piece${augRows.length === 1 ? '' : 's'} of chrome recorded, calibration and all.</span>`
    : '';
  const paid = restores > 0
    ? `\n<span style="opacity:.8">Restores on account: ${restores}.</span>`
    : `\n<span class="outcast-warning">No restores on account. A backup with nothing to spend it on is just a photograph. Buy a policy at Halcyon.</span>`;
  return { type: 'output', message: `The tanks hum. For a moment you are two places at once, and then only here again — a copy of you laid down in cold storage.${chromeNote}${paid}` };
}

/** `assurance [buy n]` — the secret Halcyon front. */
export async function cmdAssurance(args, raw, player) {
  const zone = world.zones.get(player.current_zone);
  if (!zone?.flags?.assurance_policy) {
    return { type: 'error', message: 'There is no assurance desk here.' };
  }
  const backup = await getBackup(player.id);
  const restores = backup?.restores_remaining || 0;
  const sub = (args[0] || '').toLowerCase();

  if (sub !== 'buy') {
    return { type: 'output', message:
      `<span class="skills-header">HALCYON ASSURANCE — CORTICAL POLICY</span>\n\n`
      + `"Death, sir, is a billing problem — and your account can be paid up."\n\n`
      + `Prepaid restores on file: <b>${restores}</b>\n`
      + `Price per restore: ₵${RESTORE_PRICE}\n\n`
      + `<span style="opacity:.7">assurance buy [n] — purchase restores. Requires a cortical backup on file.</span>` };
  }

  if (!hasCortical(player)) {
    return { type: 'error', message: 'The adjuster checks a screen and shakes their head, almost kindly. "We can only insure what can be restored. You have no cortical backup. Speak to the Ascendants about that first." — a slip they don\'t seem to notice making.' };
  }
  const n = Math.max(1, Math.min(20, parseInt(args[1], 10) || 1));
  const cost = n * RESTORE_PRICE;
  if ((player.credits || 0) < cost) {
    return { type: 'error', message: `${n} restore${n > 1 ? 's' : ''} costs ₵${cost}. Your account doesn't cover it.` };
  }
  await adjustCredits(player, -cost, undefined, 'augment:assurance');
  await query(
    `INSERT INTO player_backups (player_id, restores_remaining, saved_at)
       VALUES ($1, $2, EXTRACT(EPOCH FROM NOW()))
     ON CONFLICT (player_id) DO UPDATE SET restores_remaining = player_backups.restores_remaining + $2`,
    [player.id, n]
  );
  const after = restores + n;
  return { type: 'output', message: `The adjuster's stylus moves. ₵${cost} clears. "You're covered for ${n} more, then. ${after} on account." Behind them, a screen shows a calm closed eye — the Halcyon seal, or something older wearing it.\n<span class="player-update-credits">₵${player.credits}</span>` };
}

/**
 * The respawn hook. Yields (returns undefined) whenever the player would be
 * booked, so jail's own hook claims the death first — a wanted death goes to
 * Holding even for the backed-up.
 *
 * Returning anything truthy marks the death CLAIMED, which is what stops death.js
 * corrupting the roster this function is about to rebuild.
 */
export async function onRespawnZone(player, killer) {
  let wanted = parseFloat(await getFlag('player', 'wanted', player) || '0') || 0;
  try {
    const r = await dispatchAction({ type: 'WANTED_PEAK', actor: player });
    if (typeof r?.peak === 'number') wanted = Math.max(wanted, r.peak);
  } catch { /* surveillance not loaded — fall back to the flag */ }
  if (Math.floor(wanted) >= 1) return undefined;

  const backup = await getBackup(player.id);
  if (!backup || !backup.snapshot || (backup.restores_remaining || 0) < 1) return undefined;

  const vatHall = [...world.zones.values()].find(z => z.flags?.ascendant_vats);
  if (!vatHall) return undefined;

  await query('UPDATE player_backups SET restores_remaining = restores_remaining - 1 WHERE player_id=$1', [player.id]);
  const snap = backup.snapshot;
  // Credits are deliberately untouched — see the snapshot comment in cmdBackup.
  // (Old snapshots still carry a `credits` key; it is ignored rather than
  // migrated, which is the whole fix.)

  await query('DELETE FROM player_inventory WHERE player_id=$1', [player.id]);
  const items = Array.isArray(snap.inventory) ? snap.inventory : [];
  const idMap = new Map();
  for (const it of items) idMap.set(it.old_id, randomUUID());
  for (const it of items) {
    await query(
      `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, is_equipped, slot, custom_data, container_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [idMap.get(it.old_id), player.id, it.item_id, it.quantity ?? 1, it.condition ?? 1.0,
       it.is_equipped ?? 0, it.slot ?? null, JSON.stringify(it.custom_data || {}),
       it.container_id ? (idMap.get(it.container_id) || null) : null]
    );
  }

  // The chrome, exactly as it was: condition, calibration, the botched-fitting
  // ceiling and all. A snapshot that quietly gave you a clean install back would
  // make dying the cheapest way to fix a bad one.
  const augs = Array.isArray(snap.augments) ? snap.augments : [];
  await query('DELETE FROM player_augments WHERE player_id=$1', [player.id]);
  for (const a of augs) {
    await query(
      `INSERT INTO player_augments
         (player_id, augment_id, slot, condition, calibration, install_quality, overclock_level, custom_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (player_id, augment_id) DO NOTHING`,
      [player.id, a.augment_id, a.slot ?? null, a.condition ?? 1, a.calibration ?? 100,
       a.install_quality || 'sound', a.overclock_level ?? 0, JSON.stringify(a.custom_data || {})]
    );
  }
  await hydrateAugments(player);      // the roster in RAM must agree with the rows
  await recomputeEquipped(player);    // restored gear + chrome drive soak again

  const left = Math.max(0, (backup.restores_remaining || 1) - 1);
  scheduleAscendantEmergence(player, { left, chrome: augs.length });
  return {
    zone: vatHall.id,
    skipOutfit: true,
    message: `<span class="clone-vat-message">You are told, gently and from very close by, that you are all right, before you have worked out that you were not.</span>`,
  };
}

/**
 * The premium emergence.
 *
 * WHY THIS EXISTS. The free Architect vat has a whole staged sequence: the shock
 * of consciousness, the meat reporting in, an industrial gantry dressing you
 * "with the tenderness of an industrial press", and an invoice stamped
 * COMPLIMENTARY. The paid Ascendant restore had ONE LINE. So the expensive path
 * was the plainer one, and the thing the player had spent thousands on was the
 * thing that got less. That is backwards, and no balance number fixes it.
 *
 * The contrast is the whole point, and it is drawn in what is ABSENT: no gantry,
 * no invoice, no stamp, nobody telling you what it cost. You are attended by a
 * person rather than processed by a machine, and your own clothes are already on
 * you because somebody put them there while you were not present.
 *
 * Em dashes are deliberate here and correct: they belong to the Architect and to
 * Ascendant voices, and nowhere else (docs/story.md). This is the one part of
 * the death loop that gets to use them.
 *
 * Beats are timed to sit just inside the free vat's own cadence, so a player who
 * has died both ways feels the paid one moving faster and minding them more.
 */
const ASC_BEAT_1 = 2600;
const ASC_BEAT_2 = 7200;
const ASC_BEAT_3 = 13000;

function scheduleAscendantEmergence(player, { left, chrome }) {
  const send = (message) => sendToPlayer(player.id, { type: 'output', message });

  setTimeout(() => {
    send(`<span class="clone-vat-message">Warmth first. That is not how the other kind goes. The tank is blood-hot and someone has a hand flat between your shoulder blades, steadying you through the part where the lungs remember. A voice you do not know says your name correctly, including the part most people get wrong.</span>`);
  }, ASC_BEAT_1);

  setTimeout(() => {
    send(`<span class="clone-vat-message">They walk you out rather than standing you up. Towels that have been warmed. A robe. Somewhere behind you a tank is already being drained and made ready for the next member, and nobody mentions it, the way nobody mentions the plumbing in a good hotel.${chrome ? ` Your hardware came back with you, condition and calibration and all, and a technician is checking it over without being asked to.` : ''}</span>`);
  }, ASC_BEAT_2);

  setTimeout(() => {
    // No invoice. That absence is the luxury and it is doing the most work in the
    // whole sequence — the free vat's joke is that it prints you a bill and eats
    // it; the expensive one's is that the question never comes up in the room.
    send(`<span class="clone-vat-message">Your own clothes, laundered, are waiting folded on a chair. Nobody presents a bill. Nobody mentions money at all. That was settled at Halcyon long before today, by a version of you who had the leisure to plan for this, and the entire architecture of the morning exists to keep you from having to think about it now.\n\n<span style="opacity:.8">A card is left beside the chair, face down. ${left} restore${left === 1 ? '' : 's'} remaining on account.</span></span>`);
  }, ASC_BEAT_3);
}
