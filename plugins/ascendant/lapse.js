/**
 * Lapsing — the door out of the Ascendants, before the door locks.
 *
 * ── LAPSE IS A TRANSACTION. RENOUNCE IS A DEFECTION. ────────────────────────
 * Both take chrome back, which is why the distinction has to be made somewhere
 * on purpose rather than left to the prose. It is scope and permanence, not
 * severity:
 *
 *                    LAPSE (before the rite)      RENOUNCE (after)
 *   chrome           only what THEY gated         everything they gave you
 *   standing         back to neutral              the permanent −200 floor
 *   flag             `asc_lapsed`, clearable      `asc_traitor`, never cleared
 *   coming back      yes, from the bottom         never
 *
 * A player who lapses has bought a lesson. A player who renounces has burned a
 * life. (Renounce is not built — see docs/systems-faction-arcs.md.)
 *
 * ── "WHAT THEY FITTED" IS `rep_gate`, AND THAT IS NOT A SHORTCUT ────────────
 * Nothing records which clinic installed a given piece, and adding a column to
 * find out would be storing a fact the catalog already implies. A piece with a
 * `rep_gate` above `unknown` is one you could ONLY have been sold by standing
 * with this order — that IS the sense in which it is theirs. The two ungated
 * pieces in the catalog are the back-alley ones anybody can get, and those are
 * yours and stay in you.
 *
 * ⚠ The repossession is deliberately NOT death-corruption. `death.js` corrupts
 * chrome so nobody farms it off corpses; this hands it back to the people who
 * sold it. Neither should ever call the other.
 */
import { query } from '../../server/models/db.js';
import { registerAction } from '../../server/engine/actions.js';
import { adjustReputation, getReputation } from '../../server/engine/ideologies.js';
import { setFlag, clearFlag } from '../../server/engine/flags.js';
import { sendToPlayer } from '../../server/engine/messaging.js';

const ORDER = 'ideology_ascendants';

/** Installed pieces this order gated — i.e. the ones only they could have sold you. */
async function gatedRoster(playerId) {
  const { rows } = await query(
    `SELECT pa.augment_id, a.name
       FROM player_augments pa JOIN augments a ON a.id = pa.augment_id
      WHERE pa.player_id = $1 AND COALESCE(a.rep_gate, 'unknown') <> 'unknown'`,
    [playerId],
  );
  return rows;
}

/**
 * What lapsing would cost, without doing it. The scene shows the player this
 * BEFORE they answer — an exit whose price you only learn afterwards is a trap,
 * and this one is meant to be a decision.
 */
export async function lapseQuote(player) {
  const taken = await gatedRoster(player.id);
  const { rows } = await query(
    'SELECT restores_remaining FROM player_backups WHERE player_id=$1', [player.id],
  );
  return {
    augments: taken,
    restores: Number(rows[0]?.restores_remaining) || 0,
  };
}

export async function lapse(player) {
  const quote = await lapseQuote(player);

  // 1. The hardware goes home. No salvage row and no corpse: this is a
  //    repossession by people with the keys, not a body coming apart.
  if (quote.augments.length) {
    await query(
      'DELETE FROM player_augments WHERE player_id=$1 AND augment_id = ANY($2)',
      [player.id, quote.augments.map(a => a.augment_id)],
    );
    const { hydrateAugments, recomputeEquipped } = await import('../augments/state.js')
      .catch(() => ({}));
    if (hydrateAugments) { await hydrateAugments(player); await recomputeEquipped?.(player); }
  }

  // 2. The cover ends, because the cover is the thing that ended. `copy_fidelity`
  //    is left exactly where it is — it is a fact about the body you are in, not
  //    a service anybody is withdrawing.
  await query(
    'UPDATE player_backups SET restores_remaining = 0 WHERE player_id = $1', [player.id],
  ).catch(() => {});

  // 3. Standing back to neutral — not to the floor. They are not angry.
  //    ⚠ `getReputation` returns a NUMBER, not a row. Reading `.value` off it
  //    yields undefined, which nets to a −0 adjust and silently leaves the
  //    player at Inner Circle with an order they just walked out on.
  const current = Number(await getReputation(player.id, ORDER).catch(() => 0)) || 0;
  if (current !== 0) await adjustReputation(player.id, ORDER, -current, 'lapsed');

  // 4. The arc resets rather than freezing. Coming back means starting at the
  //    bottom and paying again, which is the whole reason this is the cheap exit.
  await setFlag('player', 'asc_lapsed', 'done', player);
  for (const f of ['asc_arc', 'asc_intent', 'asc_invited', 'asc_contracts']) {
    await clearFlag('player', f, player).catch(() => {});
  }

  const lines = [];
  if (quote.augments.length) {
    lines.push(`<span class="text-red">Returned:</span> ${quote.augments.map(a => a.name).join(', ')}.`);
  }
  if (quote.restores) {
    lines.push(`<span class="text-red">Cover closed:</span> ${quote.restores} prepaid restore${quote.restores === 1 ? '' : 's'} written off.`);
  }
  lines.push('<span class="msg-system">The account is closed. Nobody raises their voice about it.</span>');
  sendToPlayer(player.id, { type: 'output', message: lines.join('\n') });

  return { lapsed: true, ...quote };
}

// Cross-plugin seam: the slot-7 scene offers this as a dialogue action, so the
// exit is something a person says to you rather than a verb you find in a list.
registerAction({
  type: 'ASC_LAPSE',
  handler: async ({ actor }) => (actor?.id ? lapse(actor) : { lapsed: false }),
});

// ⚠ THE PRICE IS SHOWN BEFORE THE ANSWER IS TAKEN. An exit whose cost you only
// learn afterwards is a trap, and this one is meant to be a decision — so the
// scene names the pieces off the LIVE roster rather than off authored prose that
// would go stale the first time somebody edited the catalog.
registerAction({
  type: 'ASC_LAPSE_QUOTE',
  handler: async ({ actor }) => {
    if (!actor?.id) return { quoted: false };
    const q = await lapseQuote(actor);
    const bits = [];
    if (q.augments.length) bits.push(`they would take back: <b>${q.augments.map(a => a.name).join(', ')}</b>`);
    else bits.push("they have fitted you with nothing, so there's nothing to take back");
    if (q.restores) bits.push(`<b>${q.restores}</b> prepaid restore${q.restores === 1 ? '' : 's'} would be written off`);
    sendToPlayer(actor.id, {
      type: 'output',
      message: `<span class="msg-system">You do the sum he isn't doing for you: ${bits.join('; ')}.</span>`,
    });
    return { quoted: true, ...q };
  },
});

export const _test = { gatedRoster, lapseQuote, lapse };
