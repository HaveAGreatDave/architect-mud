// Phase 3 — what a wound actually costs you.
//
// The part owns the penalty (docs/proposals/injury-system.md §2). Seven rules,
// derived entirely from which part is hurt and how badly; nothing per-weapon,
// per-enemy or per-item is ever authored. The damage TYPE has no say here by
// design — it decided how likely and how bad, and its job ended there. Keep it
// that way or this becomes a 35-cell matrix nobody can balance.
//
// Published through `server/engine/impairment.js`, so the four consumers (stat
// penalties, stamina regen, to-hit, run mode) never learn injuries exist.
//
// SYNC AND QUERY-FREE. impairmentOf runs per-swing, per-move and per-15s-tick.
import { HURT, MAIMED, PART_LABELS } from './tables.js';

// Lateralization earns its keep here: one bad leg slows you, two ruined legs are
// a categorically worse state. That escalation is a COUNT, not an eighth rule.
const LEGS = ['left_leg', 'right_leg'];
const ARMS = ['left_arm', 'right_arm'];

// Torso: a body busy mending itself has less to give back.
const TORSO_REGEN = { [HURT]: 0.6, [MAIMED]: 0.3 };
// Arms: each wounded arm degrades the swing. They stack, because two ruined arms
// should be worse than one, and there is no reason to special-case it.
const ARM_HIT = { [HURT]: -2, [MAIMED]: -5 };
// Legs and feet: stamina per step. Never a movement block — see the note in
// movement.js. A player who cannot move has nothing to do but wait.
const LEG_STEP_COST = { [HURT]: 1, [MAIMED]: 3 };

/**
 * The impairment provider. `sev(part)` is injected rather than imported so this
 * file stays pure and trivially testable, and so it cannot accidentally reach
 * for anything async.
 */
export function buildImpairment(player, sev) {
  const head = sev('head');
  const torso = sev('torso');
  const legs = LEGS.map(sev);
  const feet = sev('feet');
  const arms = ARMS.map(sev);

  const worstLeg = Math.max(...legs, feet);
  const bothLegsMaimed = legs.every(s => s >= MAIMED);
  if (!head && !torso && !worstLeg && !arms.some(Boolean)) return null;

  const statPenalties = {};
  const notes = [];
  let staminaRegenMult = 1;
  let hitMod = 0;
  let runBlocked = null;
  let moveStaminaExtra = 0;

  // HEAD — the stat wound. Brains first; Cool only once it's serious, because
  // losing your composure to a head injury is a different, worse thing than
  // being slow to think.
  if (head >= HURT) {
    statPenalties.stat_brains = head >= MAIMED ? 2 : 1;
    if (head >= MAIMED) {
      statPenalties.stat_cool = 1;
      notes.push({ label: 'Head trauma', detail: "Thinking is slow and your hands aren't steady." });
    }
  }

  // TORSO — recovery, not damage. It makes a wound the reason you can't get your
  // wind back, which is felt everywhere without penalising anything directly.
  if (torso >= HURT) {
    staminaRegenMult = TORSO_REGEN[Math.min(torso, MAIMED)] ?? 1;
    notes.push({
      label: 'Torso injury',
      detail: torso >= MAIMED ? 'Every breath is short. You recover very slowly.' : 'Breathing hurts. You recover slowly.',
    });
  }

  // ARMS — the swing.
  arms.forEach((s, i) => {
    if (s >= HURT) hitMod += ARM_HIT[Math.min(s, MAIMED)] ?? 0;
  });
  if (hitMod < 0) {
    const which = ARMS.filter((_, i) => arms[i] >= HURT).map(p => PART_LABELS[p]).join(' and ');
    notes.push({ label: 'Arm injury', detail: `Your ${which} won't do what you ask of it. Everything you swing goes wide.` });
  }

  // LEGS AND FEET — the ones you feel walking around town, which is most of the
  // time. Hurt costs stamina; Maimed refuses the run outright.
  if (worstLeg >= HURT) {
    moveStaminaExtra = LEG_STEP_COST[Math.min(worstLeg, MAIMED)] ?? 0;
    if (worstLeg >= MAIMED) {
      runBlocked = bothLegsMaimed
        ? "Both your legs are ruined. You aren't running anywhere — it's all you can do to stay upright."
        : 'Your leg gives out the moment you try to push off it. Walking is the best you have.';
      // Two ruined legs: worse than the sum, and the one place the count matters.
      if (bothLegsMaimed) moveStaminaExtra += 3;
    }
    notes.push({
      label: bothLegsMaimed ? 'Both legs ruined' : worstLeg >= MAIMED ? 'Leg ruined' : 'Leg injury',
      detail: worstLeg >= MAIMED
        ? "You can't run, and every step costs you."
        : "You're limping. Moving takes more out of you than it should.",
    });
  }

  return { statPenalties, staminaRegenMult, hitMod, runBlocked, moveStaminaExtra, notes };
}
