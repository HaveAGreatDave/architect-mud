/**
 * THE PURIFIER — the price of admission, and the only irreversible thing a player
 * ever chooses on purpose.
 *
 * Before the Exodus let you inside, you submit to a machine that strips every
 * mutation and every augment out of you. It is excruciating and it is not
 * optional. What you get for it is a rank, a door that opens, and the beginning of
 * the only discipline in the game that does not need wire or weapon.
 *
 * ── Why this is the best gate available ──────────────────────────────────────
 *
 * It enforces "you cannot do it all" at the FACTION level rather than inside
 * psionics. Every other order can be dabbled in; this one costs you the other two
 * body paths outright, and both of them were expensive to acquire. An Exodus is
 * PROVABLY neither Wildblood nor Ascendant, and nobody had to write a rule saying
 * you may not be both.
 *
 * It also reuses machinery that already exists rather than inventing a ritual:
 * `burnAllMutations` is the mutation half (and its own comment notes that because
 * nothing is baked, deleting the rows IS the reversal), and the augment half is
 * the same bulk delete `backup.js` already performs on a cortical restore.
 *
 * ── The rules ────────────────────────────────────────────────────────────────
 *
 * 1. WARN FIRST, PLAINLY, ONCE. This game is coy about a great many things and it
 *    must not be coy about this one. An irreversible strip of everything a player
 *    has bought is the one place ambiguity would be a betrayal rather than a
 *    tone. The first `purify` shows the bill and does nothing; the second does it.
 *
 * 2. IT HURTS FOR REAL. Damage through the ordinary path, so the injury plugin
 *    hangs a genuine wound off it, plus sanity loss and enough strain to put you
 *    on the floor. A player should remember the day they did this.
 *
 * 3. IT NEVER TAKES THE FEE AND FAILS. There is no roll. A machine that might
 *    strip your chrome and not let you in would be the single most resented
 *    object in the game, and "risk" here buys nothing the pain does not already.
 */
import { query } from '../../server/models/db.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { registerSpecializedAction } from '../../server/engine/specializedActions.js';
import { burnAllMutations } from '../../server/engine/mutations.js';
import { applyStrikeToPlayer } from '../../server/engine/combat.js';
import { adjustSanity } from '../../server/engine/condition.js';
import { knockOut } from '../../server/engine/unconscious.js';
import { applyEffect } from '../../server/engine/effects.js';
import { setFlagById } from '../../server/engine/flags.js';
import { spend } from '../../server/engine/psionics.js';

const CONFIRM_MS = 120_000;
const pending = new Map();   // playerId -> ms

/**
 * The installed-chrome roster.
 *
 * Deliberately inlined rather than imported from `plugins/augments/state.js`.
 * That module is the SOLE WRITER of `player_augments` and importing it here at
 * runtime would make psionics hard-depend on the augments plugin being loaded —
 * for a one-line Map read. The Purifier only ever CLEARS, never writes a row, so
 * the sole-writer contract is not at risk.
 */
function rosterOf(player) {
  return player?._augments instanceof Map ? player._augments : new Map();
}

/**
 * The bill, itemised.
 *
 * Counted from the live rosters rather than queried — both are hydrated at login,
 * and a player standing in front of the machine has already paid the round trip.
 */
function billFor(player) {
  return {
    mutations: player?._mutations?.size || 0,
    augments: rosterOf(player).size,
  };
}

function warning(bill) {
  const parts = [];
  if (bill.mutations) parts.push(`${bill.mutations} mutation${bill.mutations === 1 ? '' : 's'}`);
  if (bill.augments) parts.push(`${bill.augments} installed augment${bill.augments === 1 ? '' : 's'}`);
  const list = parts.length ? parts.join(' and ') : 'nothing, as it happens';

  // Plain, unembellished, and it names the exact number. No em dashes, and no
  // reassurance anywhere in it.
  return [
    '<span class="rad-warning">THE PURIFIER</span>',
    '',
    `It will take ${list} out of you. Permanently. There is no undoing it and nothing is given back.`,
    'It is going to hurt more than anything has hurt you so far.',
    '',
    '<span class="ambient">Type it again within two minutes if that is what you want.</span>',
  ].join('<br>');
}

/**
 * The machine. Furniture flagged `psi_purifier`, so content decides where it
 * stands and this file never names a room.
 */
export function registerPurifier() {
  registerSpecializedAction({
    verb: 'purify',
    requiredFlag: 'psi_purifier',
    handler: async (args, raw, player, broadcast) => {
      const bill = billFor(player);
      const armed = pending.get(player.id);

      if (!armed || Date.now() - armed > CONFIRM_MS) {
        pending.set(player.id, Date.now());
        return { type: 'output', message: warning(bill) };
      }
      pending.delete(player.id);
      return run(player, bill, broadcast);
    },
  });
}

async function run(player, bill, broadcast) {
  // ── The stripping ──────────────────────────────────────────────────────────
  //
  // Mutations first, through the engine's own bulk path so every downstream
  // recompute (grown body parts, max HP, visibility, the paper doll) happens
  // exactly as it does for a clinic treatment.
  const mutationsGone = await burnAllMutations(player);

  // The chrome. Same bulk delete `backup.js` performs on a restore, plus the live
  // roster, so nothing has to reload to notice.
  let augmentsGone = 0;
  const roster = rosterOf(player);
  if (roster.size) {
    augmentsGone = roster.size;
    roster.clear();
    player._augmentsDirty?.clear();
    try { await query('DELETE FROM player_augments WHERE player_id=$1', [player.id]); }
    catch (err) { console.error(`[purifier] augment strip failed for ${player.id}: ${err.message}`); }
  }

  // ── The price ──────────────────────────────────────────────────────────────
  if (broadcast && player.current_zone) {
    broadcast(player.current_zone, {
      type: 'zone_event', refresh: true,
      message: `${player.handle} is in the Purifier. Everyone else in the room finds something to look at.`,
    }, player.id);
  }

  sendToPlayer(player.id, { type: 'output', message: [
    '<span class="dmg-taken">It finds everything in you that was not yours to begin with, and it takes its time.</span>',
    '<span class="dmg-taken">You are aware of every separate place it is working. All of them at once.</span>',
  ].join('<br>') });

  adjustSanity(player, -20, 'the Purifier');
  applyEffect(player, 'bleeding', 60);
  // Real damage, ordinary path: the injury plugin's observers hang an actual
  // wound off this and a doctor has to see to it. Nothing here authors an injury.
  await applyStrikeToPlayer(player, { min: 10, max: 20, damageType: 'kinetic' });
  // And it puts you out. You do not walk away from this one.
  knockOut(player, { ms: 20_000 });
  // Empty. Whatever you are going to become starts from nothing.
  spend(player, 9999, 40);

  // ── What you get ───────────────────────────────────────────────────────────
  //
  // The rank is set here rather than by the Gate Keeper's dialogue, because the
  // machine is the thing that actually changed you and a flag set anywhere else
  // could drift from the body it describes.
  player._flags?.set('psi_rank', 'awakened');
  player._psionic = true;
  await setFlagById(player.id, 'psi_rank', 'awakened').catch(() => {});

  const took = [];
  if (mutationsGone) took.push(`${mutationsGone} mutation${mutationsGone === 1 ? '' : 's'}`);
  if (augmentsGone) took.push(`${augmentsGone} augment${augmentsGone === 1 ? '' : 's'}`);

  return { type: 'output', message: [
    took.length
      ? `<span class="ambient">It took ${took.join(' and ')}. You are only what you were born with now.</span>`
      : '<span class="ambient">There was nothing in you to take. It checks anyway, thoroughly.</span>',
    '',
    '<span class="hdr">AWAKENED</span>',
    '<span class="ambient">Somebody helps you up. Nobody congratulates you. (`psi` to take stock.)</span>',
  ].join('<br>') };
}

export const _test = { billFor, warning, pending, CONFIRM_MS };
