/**
 * PROSE — the deniability law, in one place so it can be enforced.
 *
 * ── Why this is a file and not forty template strings ────────────────────────
 *
 * The setting's position on psionics is load-bearing and fragile. Codex chapter
 * XIV ("The Quiet Frequency") deliberately refuses to confirm that any of this is
 * real: it is "the Basin's favourite joke, third only to insurance and the
 * weather", documented only as strangers reporting identical dreams. The Terminus
 * proposal's authoring rule is blunter — "the moment a thing is stated it becomes
 * a mechanic and stops being unnerving".
 *
 * Building fifty psychic verbs threatens to confirm the whole thing on day one.
 * The decision taken instead is that DENIABILITY IS THE PROGRESSION:
 *
 *   Rank <= adept   Nothing you do has a visible cause. Output describes what a
 *                   sharp, lucky, unusually observant person might have noticed.
 *                   No line may claim a mechanism. A failure reads as nothing
 *                   happening, NEVER as a power that failed.
 *
 *   Rank >= seer    The prose is allowed to be impossible, and bystanders react.
 *                   This is the payoff and it should land hard, because it is the
 *                   only thing in the game that ever confirms that chapter.
 *
 * A law spread across forty call sites is a wish. A law that is one function with
 * a regress case is a law. Every player-facing line this plugin produces goes
 * through `voice()`, and regress asserts that no low-rank line contains a word
 * from the CAUSAL vocabulary.
 *
 * ── The other rule ───────────────────────────────────────────────────────────
 *
 * NO EM DASHES. They belong to the Architect and the Ascendants; docs/story.md
 * calls it a voice marker rather than punctuation, and the Terminus proposal
 * restates it specifically for Exodus dialogue. Enforced here too, because this
 * is the one funnel.
 */
import { rankAtLeast } from '../../server/engine/psionics-abilities.js';
import { psiRank, strainBandOf } from '../../server/engine/psionics.js';

/**
 * Words that assert a mechanism. Below Seer, none of these may appear in output.
 *
 * This list is deliberately about CAUSAL CLAIMS rather than about the word
 * "psionics" — banning the jargon alone would still permit "you sense their fear",
 * which is exactly the sentence that turns an unnerving moment into a stat readout.
 * The test is: does the line tell the player WHY they know something?
 */
export const CAUSAL_WORDS = [
  'psionic', 'psionics', 'psychic', 'telepath', 'telepathy', 'telekinesis',
  'telekinetic', 'psychometry', 'precognition', 'biokinesis', 'ergokinesis',
  'aegis', 'resonance', 'mind-read', 'your power', 'your mind reaches',
  'you sense', 'you perceive', 'you feel their', 'the vision', 'your gift',
];

const OPEN_RANK = 'seer';

/** Is this player far enough along that the game may say the impossible out loud? */
export function speaksPlainly(player) {
  return rankAtLeast(psiRank(player), OPEN_RANK);
}

/**
 * The one funnel. Everything player-facing in this plugin goes through it.
 *
 * `low` is what a deniable rank is told; `high` is the impossible version. A caller
 * that supplies only one line is saying the line is safe at every rank, and that
 * claim is checked here rather than trusted.
 */
export function voice(player, { low, high }) {
  const line = speaksPlainly(player) ? (high || low) : (low || high);
  return scrub(line, speaksPlainly(player));
}

/**
 * Strip the two things that must never ship, and say so loudly in dev.
 *
 * Throwing would be worse than fixing: a bad line should not take a player's
 * command down. But a silent fix is how the law rots, so this warns, and regress
 * asserts the warning never fires for any registered ability's copy.
 */
export function scrub(line, plainly = false) {
  if (!line) return '';
  let out = String(line);

  // The em dash is not ours. Replace rather than warn-only, because a stray one is
  // a voice bug the player can see immediately.
  if (out.includes('—')) {
    out = out.replace(/\s*—\s*/g, ', ');
  }

  if (!plainly) {
    const lower = out.toLowerCase();
    for (const w of CAUSAL_WORDS) {
      if (lower.includes(w)) {
        console.warn(`[psionics/prose] causal claim in a low-rank line: "${w}" in "${out}"`);
        break;
      }
    }
  }
  return out;
}

/** Regress seam: does this line violate the low-rank law? */
export function violatesLowRank(line) {
  if (!line) return null;
  const lower = String(line).toLowerCase();
  if (String(line).includes('—')) return 'em dash';
  for (const w of CAUSAL_WORDS) if (lower.includes(w)) return w;
  return null;
}

// ── The strain ladder, spoken ────────────────────────────────────────────────
//
// The body pays, and the room watches it happen. These are broadcast, not private,
// because the backlash ladder and the deniability ladder are THE SAME LADDER: a
// nosebleed in a bar is nothing, and a man convulsing with blood coming out of his
// ears while a door he never touched swings open cannot be explained away by
// anybody present. The tell is the point.

const STRAIN_SELF = {
  low:      null,
  moderate: "Something warm runs over your lip. Your hands won't quite hold still.",
  high:     'Your ears are wet. The room has gone soft at the edges and the light in it hurts.',
  critical: 'Your legs stop belonging to you.',
  overload: 'Everything goes white, and then nothing at all.',
};

const STRAIN_ROOM = {
  low:      null,
  moderate: '{name} wipes a nosebleed on the back of a hand.',
  high:     'There\'s blood at {name}\'s ears, and {name} is squinting at nothing.',
  critical: '{name} goes down hard and starts convulsing.',
  overload: "{name} drops like a cut rope and doesn't move.",
};

export function strainSelfLine(player) {
  return STRAIN_SELF[strainBandOf(player)] || null;
}

export function strainRoomLine(player) {
  const t = STRAIN_ROOM[strainBandOf(player)];
  return t ? t.replace(/\{name\}/g, player.handle || 'Someone') : null;
}
