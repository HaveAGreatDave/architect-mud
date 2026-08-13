/**
 * Composure — the Long Watch's overclock, made of nothing but skill.
 *
 * The Ascendants push a machine past spec and it overheats. The Wildblood drink
 * something and their flesh answers. The Long Watch stay calm, and calm is the
 * resource.
 *
 * RUNTIME ONLY. No column, no table, never hydrated, never flushed, and it
 * decays to nothing out of combat. That is not an optimisation — a resource you
 * can log in already holding is a passive bonus wearing a resource's clothes,
 * which is the one thing this whole system may not contain.
 *
 * You earn it by fighting WELL, not by fighting long: a defence that cost you
 * nothing, a blow your guard ate, a read that clicked into place. Flailing pays
 * nothing at all.
 */
import { effectiveRank } from './purity.js';

// Base of 4, and Will buys headroom. Small numbers on purpose — every spend
// should be a decision, and a pool of twenty is a rhythm rather than a choice.
const BASE_CAP = 4;

// Out of combat it bleeds away on the 10s tick.
const IDLE_DECAY = 1;

export function composureCap(player) {
  return BASE_CAP + Math.floor(effectiveRank(player, 'will') / 12);
}

export function getComposure(player) {
  if (!player) return 0;
  return Math.max(0, Math.min(composureCap(player), player._composure || 0));
}

/** SYNC. Called from the swing seam. */
export function awardComposure(player, n, reason = null) {
  if (!player || n <= 0) return 0;
  const before = getComposure(player);
  const after = Math.min(composureCap(player), before + n);
  player._composure = after;
  if (after > before) player._composureReason = reason;
  return after - before;
}

/** SYNC. Returns false and spends NOTHING when it cannot pay in full. */
export function spendComposure(player, n) {
  if (getComposure(player) < n) return false;
  player._composure = getComposure(player) - n;
  return true;
}

export function decayComposure(player) {
  const cur = getComposure(player);
  if (cur <= 0) return 0;
  player._composure = Math.max(0, cur - IDLE_DECAY);
  return cur - player._composure;
}

export function clearComposure(player) { if (player) player._composure = 0; }

/** How it reads on the sheet — a count of held breaths, never a number bar. */
export function composureLine(player) {
  const c = getComposure(player);
  if (c <= 0) return '<span class="text-dim">You are not composed.</span>';
  return `<span class="crit-tag">${'◆'.repeat(c)}</span> <span class="text-dim">composed</span>`;
}

export const _test = { BASE_CAP, IDLE_DECAY };
