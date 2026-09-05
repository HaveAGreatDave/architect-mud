/**
 * Senses — Blind Fighting.
 *
 * The Long Watch's answer to enhanced-sense mutants: not new organs, but
 * extraordinary use of the ones everybody already has. A veteran does not see in
 * the dark. They have simply stopped needing to look.
 *
 * ⚠ THIS IS NOT A `visibility.perceive` CONTRIBUTOR, and both the system doc and
 * the proposal said it would be. It cannot be, and the reason is worth keeping:
 *
 *   `fireHook` hands EVERY handler the same original arguments and keeps the
 *   LAST non-undefined answer. `plugins/flashlight` already answers that hook,
 *   and 'flashlight' sorts before 'mastery', so mastery answers last and wins.
 *   In a dark room, a player holding a lit torch AND carrying this discipline
 *   would get flashlight's `clear` computed first, then mastery's shift of the
 *   RAW `dark` — and the second answer would replace the first. The torch would
 *   stop working because its owner got good at fighting. Returning `undefined`
 *   when we have no opinion (which is what the doc's own ⚠ prescribed) does not
 *   help: in a dark room this discipline HAS an opinion, and it still stomps.
 *
 * So it rides the swing seam mastery already owns, on the one number that
 * actually matters — the to-hit penalty darkness applies to a swing. That
 * composes by construction: the engine hands the ctx the PERCEIVED penalty, so a
 * torch has already shrunk it and this can only ever give back a share of
 * whatever is left. Two systems, one number, no double-counting, and no ordering
 * to get wrong.
 *
 * ⚠ AND IT IS NOT A PASSIVE, which is the rule the whole system is built on. It
 * cannot add anything: it can only return some of what the dark took. In a lit
 * room the penalty is 0 and this contributes exactly 0 — a flat `hitMod` would
 * have been a permanent bonus wearing a situational costume.
 */
import { effectiveRank } from './purity.js';

// Below this the discipline has been named but not learned. Every other rung in
// mastery starts at 20 for the same reason: a rank-1 anything that already works
// makes the ladder decorative.
export const BLIND_MIN_RANK = 20;

// ⚠ NEVER 1.0. A veteran fights well in the dark; nobody fights as well in the
// dark as in the light, and a discipline that erased the penalty entirely would
// delete darkness as a thing the game does — along with every light source, the
// flashlight plugin, and the reason to carry one.
export const BLIND_MAX_GIVEBACK = 0.8;

/** The share of the darkness penalty this body can shrug off. 0 when untrained. */
export function blindFightingGiveback(player) {
  const rank = effectiveRank(player, 'senses');
  if (rank < BLIND_MIN_RANK) return 0;
  return Math.min(BLIND_MAX_GIVEBACK, (rank - BLIND_MIN_RANK) / 100);
}

/**
 * Give back part of an outgoing swing's darkness penalty, in place.
 *
 * SYNC BY CONTRACT — this runs inside the swing seam, which may not await, may
 * not query and may not send. It reads one hydrated number and does arithmetic.
 *
 * @returns {number} how much penalty was cancelled (>= 0), for prose and tests
 */
export function applyBlindFighting(player, ctx) {
  const dark = Number(ctx?.darkness) || 0;
  // A lit room, or an engine that did not hand us one. Nothing to give back, and
  // nothing to invent — see the passive rule above.
  if (dark >= 0) return 0;
  const share = blindFightingGiveback(player);
  if (!share) return 0;
  const given = -dark * share;
  // ⚠ Clamped at 0 on the way back in. The margin clamps too, so this is belt
  // and braces, but a contributor that could push `darkness` positive would be
  // handing out a to-hit BONUS for the room being dark.
  ctx.darkness = Math.min(0, dark + given);
  return given;
}

/**
 * The line, said at most once per opponent.
 *
 * ⚠ Once, deliberately. The tier lines in reads.js are governed by the same rule
 * and for the same reason: a system whose whole fiction is that it does not look
 * supernatural cannot narrate itself on every exchange. Said once, it reads as a
 * character noticing something about themselves. Said every swing, it is a
 * status effect with prose attached.
 *
 * One field, overwritten rather than accumulated, so there is nothing to leak.
 */
export function blindFightingLine(player, enemy) {
  const key = enemy?.instanceId || enemy?.id || null;
  if (!key || player._blindSaid === key) return null;
  player._blindSaid = key;
  return '\n<span class="text-dim">You have stopped trying to see it, and you\'re hitting it more often.</span>';
}

export const _test = { BLIND_MIN_RANK, BLIND_MAX_GIVEBACK };
