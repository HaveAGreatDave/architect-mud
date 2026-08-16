/**
 * The cortical-backup loop — the Ascendant "death is a billing problem" economy.
 *
 * Buy prepaid restores at Halcyon, re-scan your pattern at the Vats, and a
 * non-jailed death prints you a new body instead of dropping you in the civic
 * clone queue.
 *
 * THE PATTERN IS WHO YOU ARE, NEVER WHAT YOU HAD.
 *
 * This file used to snapshot your inventory and roll it back on death. Two
 * things were wrong with that, one mechanical and one worse.
 *
 * The mechanical one: a snapshot remembers what you HAD, so it could re-create
 * an item you had since given away. Back up holding a thing, hand the thing to
 * an alt, die, and the thing exists twice. It also suppressed the corpse
 * entirely, so a paid-up player's killer got nothing and their carried credits
 * were never converted to a chip — death, for the insured, simply didn't happen.
 *
 * The worse one: "you get your bag back" is a logistics convenience. It is not
 * an identity, and it is not what this faction is selling. Nothing about it
 * reads as premium; it reads as a receipt.
 *
 * So the restore no longer touches player_inventory AT ALL. An Ascendant dies
 * like anybody else — corpse on the floor, bag and credit chip lootable. What
 * money buys is the BODY. The old body's chrome corrupts for real (see
 * death.js, which now runs on this path too) and lands on the corpse as scrap;
 * the vats then re-print the roster into the new body from a pattern captured
 * at the moment of death (see reprint.js).
 *
 * That capture-at-death is what makes it unexploitable. The re-print can only
 * put back what was in you when you died, so an augment you had removed to an
 * item and sold is simply not in the pattern to print. Nothing is created that
 * did not exist a second earlier, and the original is provably scrap in the room.
 */
import { query } from '../../server/models/db.js';
import { world } from '../../server/engine/world.js';
import { getFlag } from '../../server/engine/flags.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { hasAugment } from './state.js';

export const CORTICAL = 'aug_cortical_backup';
export const RESTORE_PRICE = 2500;

/**
 * The re-scan fee. Deliberately an order of magnitude under a restore, because
 * this is the part you are meant to do OFTEN — the recurring ritual is the
 * product, not the one-time ₵6000 implant. Price it like a restore and players
 * scan once and never again, which is exactly the shape we're moving away from.
 */
export const RESCAN_PRICE = 900;

/** Fidelity: how good a copy you still are. See reprint.js for where it falls. */
export const FIDELITY_MAX = 100;
export const FIDELITY_FLOOR = 35;      // a copy of a copy of a copy still walks
export const FIDELITY_LOSS = 6;        // per restore
export const FIDELITY_RESCAN_GAIN = 25; // per re-scan — 2 scans undo 8 deaths

export async function getBackup(playerId) {
  const { rows } = await query(
    'SELECT snapshot, restores_remaining, saved_at, pattern_at, copy_fidelity FROM player_backups WHERE player_id=$1',
    [playerId],
  );
  return rows[0] || null;
}

/** Sync — reads the hydrated roster, not the DB. */
export function hasCortical(player) {
  return hasAugment(player, CORTICAL);
}

/**
 * `backup` — re-scan your pattern at the Vats Registry.
 *
 * NOT a snapshot of your possessions any more (see the header). This registers
 * that there IS a current pattern of you on file, and refreshes its fidelity —
 * which is the thing degrading every time you come back through a tank.
 */
export async function cmdBackup(args, raw, player) {
  const zone = world.zones.get(player.current_zone);
  if (!zone?.flags?.ascendant_registry) {
    return { type: 'error', message: 'You can only commit a backup at the Vats Registry.' };
  }
  if (!hasCortical(player)) {
    return { type: 'error', message: 'The Registry construct regards you flatly. "No cortical backup on file. There is nothing of you to save." Install the Cortical Backup augment first.' };
  }
  if ((player.credits || 0) < RESCAN_PRICE) {
    return { type: 'error', message: `A fresh scan is ₵${RESCAN_PRICE}. Your account doesn't cover it.` };
  }

  const existing = await getBackup(player.id);
  const restores = existing?.restores_remaining || 0;
  const before = Number(existing?.copy_fidelity ?? FIDELITY_MAX);
  const after = Math.min(FIDELITY_MAX, before + FIDELITY_RESCAN_GAIN);

  // Flavour only — the roster a restore actually prints is captured at death.
  const { rows: augRows } = await query(
    'SELECT augment_id FROM player_augments WHERE player_id=$1', [player.id],
  );

  await adjustCredits(player, -RESCAN_PRICE, undefined, 'augment:rescan');
  await query(
    `INSERT INTO player_backups (player_id, snapshot, restores_remaining, saved_at, pattern_at, copy_fidelity)
       VALUES ($1, $2, $3, EXTRACT(EPOCH FROM NOW()), EXTRACT(EPOCH FROM NOW()), $4)
     ON CONFLICT (player_id) DO UPDATE
       SET snapshot = EXCLUDED.snapshot, saved_at = EXCLUDED.saved_at,
           pattern_at = EXCLUDED.pattern_at, copy_fidelity = EXCLUDED.copy_fidelity`,
    [player.id, JSON.stringify({ chrome_at_scan: augRows.length, fidelity_at_scan: after }), restores, after],
  );
  player._copyFidelity = after;   // the read point is sync — RAM must agree now

  const gained = after - before;
  const fidNote = gained > 0
    ? `\n<span style="opacity:.8">Pattern fidelity ${before}% → <b>${after}%</b>. The drift is combed out.</span>`
    : `\n<span style="opacity:.8">Pattern fidelity holding at ${after}%. Nothing to correct.</span>`;
  const chromeNote = augRows.length
    ? `\n<span style="opacity:.8">${augRows.length} piece${augRows.length === 1 ? '' : 's'} of chrome noted in the scan.</span>`
    : '';
  const paid = restores > 0
    ? `\n<span style="opacity:.8">Restores on account: ${restores}.</span>`
    : `\n<span class="outcast-warning">No restores on account. A pattern with nothing to spend it on is just a photograph. Buy a policy at Halcyon.</span>`;
  return { type: 'output', message: `The tanks hum. For a moment you are two places at once, and then only here again — a fresh reading of you laid down over the old one.${fidNote}${chromeNote}${paid}\n<span class="player-update-credits">₵${player.credits}</span>` };
}

/** `assurance [buy n]` — the secret Halcyon front. */
export async function cmdAssurance(args, raw, player) {
  const zone = world.zones.get(player.current_zone);
  if (!zone?.flags?.assurance_policy) {
    return { type: 'error', message: 'There is no assurance desk here.' };
  }
  const backup = await getBackup(player.id);
  const restores = backup?.restores_remaining || 0;
  const fidelity = Number(backup?.copy_fidelity ?? FIDELITY_MAX);
  const sub = (args[0] || '').toLowerCase();

  if (sub !== 'buy') {
    const fidLine = backup?.pattern_at
      ? `Pattern fidelity: <b>${fidelity}%</b>${fidelity < FIDELITY_MAX ? `  <span style="opacity:.7">(re-scan at the Registry to correct)</span>` : ''}\n`
      : `Pattern on file: <span class="text-red">none</span>  <span style="opacity:.7">(scan at the Registry — a policy alone restores nothing)</span>\n`;
    return { type: 'output', message:
      `<span class="skills-header">HALCYON ASSURANCE — CORTICAL POLICY</span>\n\n`
      + `"Death, sir, is a billing problem — and your account can be paid up."\n\n`
      + `Prepaid restores on file: <b>${restores}</b>\n`
      + fidLine
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
 * The respawn hook — a CLAIM, and nothing else.
 *
 * ⚠ THIS FUNCTION SPENDS NOTHING AND WRITES NOTHING, DELIBERATELY.
 *
 * fireHook keeps the LAST non-undefined return, and plugins load in directory
 * order, so `augments` runs before `jail`. The old version decremented a
 * restore here — which meant a player whose death jail went on to claim had
 * already been charged ₵2500 for a restore that never happened, with no
 * rollback anywhere. Every write now lives in reprint.js, which runs off
 * `player.death` AFTER the engine has picked a winner and can check whether it
 * was us (see the `__ascendantRestore` tag below).
 */
export async function onRespawnZone(player, killer) {
  let wanted = parseFloat(await getFlag('player', 'wanted', player) || '0') || 0;
  try {
    const r = await dispatchAction({ type: 'WANTED_PEAK', actor: player });
    if (typeof r?.peak === 'number') wanted = Math.max(wanted, r.peak);
  } catch { /* surveillance not loaded — fall back to the flag */ }
  if (Math.floor(wanted) >= 1) return undefined;

  // Gate on pattern_at, not on `snapshot`: buying a policy inserts a row with no
  // scan on it, and a policy alone must not be restorable.
  const backup = await getBackup(player.id);
  if (!backup?.pattern_at || (backup.restores_remaining || 0) < 1) return undefined;

  const vatHall = [...world.zones.values()].find(z => z.flags?.ascendant_vats);
  if (!vatHall) return undefined;

  return {
    zone: vatHall.id,
    // NOT custody. The cops take the body; the Ascendants take the pattern and
    // leave the body exactly where it fell, for whoever wants it.
    custody: false,
    __ascendantRestore: true,
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
 * person rather than processed by a machine.
 *
 * ⚠ NOBODY IN THIS SEQUENCE MENTIONS WHAT YOU LOST. Your bag is on a corpse
 * across town and the staff here would no more raise that than a good hotel
 * would ask where your luggage went. The silence is the characterisation.
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

export function scheduleAscendantEmergence(player, { left, chrome, fidelity, artifacts = [] }) {
  const send = (message) => sendToPlayer(player.id, { type: 'output', message });

  setTimeout(() => {
    send(`<span class="clone-vat-message">Warmth first. That is not how the other kind goes. The tank is blood-hot and someone has a hand flat between your shoulder blades, steadying you through the part where the lungs remember. A voice you do not know says your name correctly, including the part most people get wrong.</span>`);
  }, ASC_BEAT_1);

  setTimeout(() => {
    // The chrome line is the honest one: it was destroyed and this is new
    // hardware, printed to your spec. Saying so is better than implying the old
    // pieces came through, because the player can go and look at the scrap.
    send(`<span class="clone-vat-message">They walk you out rather than standing you up. Towels that have been warmed. A robe. Somewhere behind you a tank is already being drained and made ready for the next member, and nobody mentions it, the way nobody mentions the plumbing in a good hotel.${chrome ? ` Your hardware was laid in while you were still coming up — ${chrome} piece${chrome === 1 ? '' : 's'}, cut new to the old measurements, still warm from the bed.` : ''}</span>`);
  }, ASC_BEAT_2);

  setTimeout(() => {
    // No invoice. That absence is the luxury and it is doing the most work in the
    // whole sequence — the free vat's joke is that it prints you a bill and eats
    // it; the expensive one's is that the question never comes up in the room.
    const artifactNote = artifacts.length
      ? `\n\n<span class="outcast-warning">${artifacts.map(a => a.self).join(' ')}</span>`
      : '';
    send(`<span class="clone-vat-message">Clothes are waiting folded on a chair — not yours, but your size, and better than yours. Nobody presents a bill. Nobody mentions money at all. That was settled at Halcyon long before today, by a version of you who had the leisure to plan for this, and the entire architecture of the morning exists to keep you from having to think about it now.${artifactNote}\n\n<span style="opacity:.8">A card is left beside the chair, face down. ${left} restore${left === 1 ? '' : 's'} remaining on account. Pattern fidelity ${fidelity}%.</span></span>`);
  }, ASC_BEAT_3);
}
