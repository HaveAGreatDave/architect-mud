/**
 * STRAIN — the bill, and it is always paid in blood.
 *
 * ── The rule this file exists to enforce ─────────────────────────────────────
 *
 * THE MIND IS DOING SOMETHING THE BODY WAS NOT BUILT TO SUPPORT, SO THE BODY PAYS.
 *
 * Every other discipline in the game has a cost you can budget: an augment draws
 * power, a mutation is a trade, nullcraft leaves a trace that decays. Psionics is
 * the one where the cost lands on the practitioner's own tissue, and that is not
 * decoration. It is the only thing bounding compulsion (a long control window is
 * bought with a seizure), the only thing stopping a psion holding a forcefield
 * forever, and the reason a psion is a devastating fifth member of a crew and a
 * bad person to be alone.
 *
 * ── Backlash reuses systems that already hurt ────────────────────────────────
 *
 * Nothing here invents a punishment. Bleeding is the shipped status effect.
 * Failing sight is a negative acuity contribution, which senses.js already
 * supports (`gearDamp` proves it). A seizure is `knockOut`, the same call the cosh
 * makes, which means an out-cold psion is killable where they lie by anything in
 * the game that can kill a sleeping body. And Overload takes REAL DAMAGE through
 * `applyStrikeToPlayer`, so the injury plugin's damage observers hang an actual
 * wound off it with no import from here at all.
 *
 * That last one is the important one. Reaching into the injury plugin to author a
 * head wound would be a second implementation of something the damage path
 * already does correctly; taking damage the normal way gets the part roll, the
 * typed soak, the injury, the announcement and the treatment requirement for free.
 */
import { applyEffect, registerStatusEffect } from '../../server/engine/effects.js';
import { applyStrikeToPlayer } from '../../server/engine/combat.js';
import { knockOut } from '../../server/engine/unconscious.js';
import { adjustSanity } from '../../server/engine/condition.js';
import { addPhantom } from '../../server/engine/phantoms.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { strainBandOf, strainOf } from '../../server/engine/psionics.js';
import { strainSelfLine, strainRoomLine } from './prose.js';

/**
 * The two status effects backlash applies.
 *
 * Registered here, next to the thing that causes them, rather than in the engine
 * — the convention `plugins/mutations/organs.js` set when it registered
 * `envenomed` beside the organ that injects it.
 *
 * `psi_backlash` carries the stat penalties AND the negative sight acuity, so a
 * strained psion is measurably worse at everything without any consumer of stats
 * or senses needing to know psionics exists. That is the whole argument for
 * putting it on the shipped effect framework instead of in a bespoke check.
 */
export function registerStrainEffects() {
  registerStatusEffect({
    name: 'psi_backlash',
    label: 'Strained',
    stats: { stat_reflexes: -1, stat_brains: -1, stat_cool: -1 },
    acuity: { sight: -2 },
    // No HP cost — the penalties and the failing sight ARE the cost, the same
    // shape as `sense_overload`. Bleeding is applied alongside as its own effect
    // rather than duplicated here, so a nosebleed stops the way any bleed stops.
    onTick: () => undefined,
  });

  registerStatusEffect({
    name: 'psi_seizure',
    label: 'Seizing',
    stats: { stat_reflexes: -3, stat_brawn: -2 },
    onTick: () => undefined,
  });
}

/**
 * Resolve what this much strain does to a body. Called after every spend.
 *
 * Returns the band so callers can decide whether to narrate a success at all — a
 * player who just seized does not also need to be told their psychometry worked.
 *
 * `broadcast` is required rather than optional on purpose: the strain ladder is
 * also the DENIABILITY ladder, and a backlash nobody in the room sees is a
 * backlash that has failed at half its job. See prose.js.
 */
export async function resolveStrain(player, broadcast) {
  const band = strainBandOf(player);
  if (band === 'low') return band;

  const self = strainSelfLine(player);
  const room = strainRoomLine(player);
  if (self) sendToPlayer(player.id, { type: 'output', message: `<span class="dmg-taken">${self}</span>` });
  if (room && broadcast && player.current_zone) {
    broadcast(player.current_zone, { type: 'zone_event', message: room, refresh: true }, player.id);
  }

  if (band === 'moderate') {
    // A nosebleed. Real bleeding, on the shipped effect, so it shows up in vitals
    // and stops the way any other bleed stops.
    applyEffect(player, 'bleeding', 20);
    applyEffect(player, 'psi_backlash', 60);
    return band;
  }

  if (band === 'high') {
    applyEffect(player, 'bleeding', 40);
    applyEffect(player, 'psi_backlash', 120);
    adjustSanity(player, -3, 'psionic strain');
    return band;
  }

  // ── Critical and Overload: you go down ─────────────────────────────────────
  //
  // knockOut rather than a stun, deliberately. An out-cold body is killable where
  // it lies (the same seam the cosh uses), which is exactly the stake a psion
  // should be playing for when they decide to push one more time in a fight. This
  // is the moment the discipline is genuinely dangerous to its owner.
  applyEffect(player, 'psi_seizure', 30);
  applyEffect(player, 'bleeding', 60);
  adjustSanity(player, band === 'overload' ? -12 : -6, 'psionic backlash');
  knockOut(player, { ms: band === 'overload' ? 30_000 : 15_000 });

  // Something comes back with you. addPhantom is global, so trip's existing
  // look/attack/talk intercepts work on this with no new code anywhere.
  addPhantom(player.id, {
    id: `psi_after_${player.id}`,
    name: 'a shape at the edge of the room',
    kind: 'object',
    description: 'It is standing where the light does not reach, and it has been waiting for you to notice.',
    looks: ['It does not get any clearer for being looked at.'],
    says: ['...'],
    zone: player.current_zone,
    hp: 1, hp_max: 1,
  });

  if (band === 'overload') {
    // Real damage, through the ordinary path, so the injury plugin's damage
    // observers hang an actual wound off it. Nothing here authors an injury; the
    // damage does it, exactly as a bullet would.
    await applyStrikeToPlayer(player, { min: 6, max: 14, damageType: 'energy' });
  }

  return band;
}

/** Regress/HUD seam. */
export function strainSummary(player) {
  return { strain: Math.round(strainOf(player)), band: strainBandOf(player) };
}
