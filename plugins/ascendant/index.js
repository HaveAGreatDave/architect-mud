/**
 * Ascendant Stronghold mechanics — the campus-side systems that aren't the augment
 * mechanic itself (that's plugins/augments). Right now: The Threshold move-gate.
 *
 * The Threshold: the far-western chrome campus flaunts itself, but its inner ring
 * turns the uncleared away. The public Gate face (flags.ascension_gate) is always
 * enterable — that's where you get scanned, rejected, or recruited. Every OTHER
 * campus tile (flags.ascendant_campus) is refused to the uncleared, from either the
 * Halcyon side or the Slagworks/Curtain side. Rejection is non-lethal; breaking into
 * a run at the line reads as forcing it and draws a turret warning (the lethal
 * turret fire is a later integration — see docs/proposals/ascendant-stronghold.md).
 *
 * Cleared = an ascendant_clearance flag (granted by the reveal quest chain), OR
 * Ascendant rep ≥ Known, OR you're already chromed (the machine welcomes its own).
 */
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { getFlag } from '../../server/engine/flags.js';
import { getPlayerIdeologyRep, REP_TIERS } from '../../server/engine/ideologies.js';

const ASCENDANTS = 'ideology_ascendants';
const TIER_RANK = Object.fromEntries(REP_TIERS.map((t, i) => [t.id, i]));
const CLEAR_TIER = TIER_RANK.known; // rep tier that counts as cleared

async function isCleared(player) {
  if (!player) return false;
  if (player.chromed) return true;                              // the chromed are always welcome
  if (await getFlag('player', 'ascendant_clearance', player)) return true;
  const reps = await getPlayerIdeologyRep(player.id).catch(() => []);
  const row = reps.find(r => r.id === ASCENDANTS);
  return (TIER_RANK[row?.tier || 'unknown'] ?? 0) >= CLEAR_TIER;
}

// The move-gate. Exported for the regression harness (mock ctx).
export async function thresholdGate({ player, from, to }) {
  if (!to?.flags?.ascendant_campus) return;      // only campus tiles pay the cost
  if (to.flags?.ascension_gate) return;          // the public Gate face is open to all
  if (from?.flags?.ascendant_campus) return;     // already inside — moving around freely
  if (await isCleared(player)) return;           // cleared → pass

  if (player?.running) {
    // Rushing the line: the wardens don't just refuse, they paint you with the turrets.
    return {
      block: true,
      message: `You break into a run at the line — and the turret housings pivot as one, laying targeting light across your chest. A warden's voice, unhurried: "Do not test the Threshold, baseline." You pull up short. <span class="text-dim">(Force it and they fire. You need Ascendant clearance.)</span>`,
    };
  }
  return {
    block: true,
    message: `The Ascension Gate reads you head to foot and finds only meat. A warden turns you back without heat and without interest: "This is not for you. Withdraw." <span class="text-dim">(You need Ascendant clearance to pass.)</span>`,
  };
}
registerMoveGate(thresholdGate, 'ascendant:threshold');

// Exposed for the regression harness.
export const _test = { thresholdGate, isCleared };
