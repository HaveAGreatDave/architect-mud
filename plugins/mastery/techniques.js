/**
 * Techniques and stances — what Composure and discipline actually buy.
 *
 * THE RULE: a technique is something you DO, at a moment, and it can fail. It is
 * never a number that is quietly true about you. The instant one becomes a
 * passive it is a mutation you cannot see, and the entire premise of the Long
 * Watch has gone with it.
 *
 * Two shapes, and they are not the same thing:
 *
 *   TECHNIQUE — armed now, consumed by the next relevant swing. The `pow` model
 *               (plugins/weapon): set a field, let the engine consume it once.
 *   STANCE    — held, costs stamina, ends on four explicit edges, and does
 *               something continuous while it lasts.
 *
 * WHY STANCES DO NOT TOUCH `player.soak`: that map is a CACHE, rebuilt on equip
 * and login. A timed brace written into it would need invalidating on every path
 * that can end a stance, and one missed path leaves a player armoured forever —
 * the worst failure available to a system whose whole premise is that it grants
 * no permanent passive. So a stance is read at the moment the blow lands, via
 * the swing seam's `soakBonus`, and the cache is never touched at all.
 */
import { effectiveRank } from './purity.js';

// ── stances ─────────────────────────────────────────────────────────────────

export const STANCES = Object.freeze({
  iron_body: {
    id: 'iron_body',
    name: 'Iron Body',
    discipline: 'body',
    rank: 25,
    durationMs: 60000,
    staminaPerTick: 3,
    // Soak added to every incoming impact while it holds. Scales with rank, so
    // this is the one place discipline reads as a number — but only while you
    // are actively spending stamina to hold it.
    soak: p => 1 + Math.floor(effectiveRank(p, 'body') / 30),
    enter: 'You set your feet and let the breath go out of you. Everything gets heavier, including you.',
    leave: 'You let the brace go. Air comes back.',
    broken: 'The hit goes through the brace and takes it with it.',
  },
  rooted: {
    id: 'rooted',
    name: 'Rooted Stance',
    discipline: 'body',
    rank: 40,
    durationMs: 90000,
    staminaPerTick: 2,
    soak: () => 0,
    // The cost IS the point. A stance that only gave would not be a stance.
    immobile: true,
    enter: 'You plant yourself. You are not going anywhere, and neither is anyone who tries to move you.',
    leave: 'You come off the root and your weight is yours again.',
    broken: 'Something lands hard enough to break the root.',
  },
});

export function stanceFor(id) { return STANCES[String(id || '').toLowerCase()] || null; }

export function knownStances(player) {
  return Object.values(STANCES).filter(s => effectiveRank(player, s.discipline) >= s.rank);
}

/** The live stance, or null. LAZY EXPIRY — checked on every read, so a stance
 *  that has run out contributes nothing even if no tick has been near it. */
export function activeStance(player, now = Date.now()) {
  const st = player?._stance;
  if (!st) return null;
  if (now >= st.expiresAt) { player._stance = null; return null; }
  return st;
}

export function stanceSoak(player, now = Date.now()) {
  const st = activeStance(player, now);
  if (!st) return 0;
  const def = stanceFor(st.name);
  return def ? def.soak(player) : 0;
}

export function endStance(player, why = 'drop') {
  const st = player?._stance;
  if (!st) return null;
  player._stance = null;
  const def = stanceFor(st.name);
  return def ? (why === 'broken' ? def.broken : def.leave) : null;
}

// ── techniques ──────────────────────────────────────────────────────────────
//
// Each is armed by a verb and consumed by ONE swing. `kind` says which
// direction of swing consumes it, so a defensive technique cannot be eaten by
// your own attack.

export const TECHNIQUES = Object.freeze({
  slip: {
    id: 'slip',
    name: 'Slip',
    discipline: 'movement',
    rank: 25,
    composure: 1,
    kind: 'incoming',
    // A stated outcome, not a to-hit penalty — see the swing seam docs. As a big
    // negative hitMod this would silently fail against a high-`hit` enemy, which
    // is the exact opposite of what the technique is for.
    apply: (ctx, roll) => {
      if (!roll.success) return null;
      ctx.negate = true;
      ctx.negateLine = `${ctx.enemy.name} swings where you were. You are already not there.`;
      return 'slipped';
    },
    fail: 'You move early. It follows you.',
    arm: 'You stop watching the weapon and start watching the shoulder.',
  },
  perfect_timing: {
    id: 'perfect_timing',
    name: 'Perfect Timing',
    discipline: 'combat',
    rank: 60,
    composure: 3,
    kind: 'incoming',
    apply: (ctx, roll) => {
      if (!roll.success) return null;
      ctx.negate = true;
      ctx.negateLine = `<span class="crit-tag">PERFECT TIMING.</span> You step inside the arc. It passes behind you, and you are already moving.`;
      // The counter goes down the ORDINARY swing path — the engine's own power
      // flag — so soak, body parts, crits, injury and loot-on-death all apply.
      // Never write enemy.hp from here.
      ctx.player._powQueued = true;
      return 'timed';
    },
    fail: 'You commit to the read, and the read is wrong. It lands.',
    arm: 'You breathe out and stop reacting. You are waiting for one specific thing.',
  },
  ghost_step: {
    id: 'ghost_step',
    name: 'Ghost Step',
    discipline: 'movement',
    rank: 45,
    composure: 2,
    kind: 'outgoing',
    apply: (ctx, roll) => {
      if (!roll.success) return null;
      ctx.hitMod += 4;
      ctx.critBonus += 2;
      return 'inside';
    },
    fail: 'You go for the gap and it closes.',
    arm: 'You stop circling and pick a line through.',
  },
});

export function techniqueFor(id) { return TECHNIQUES[String(id || '').toLowerCase()] || null; }

export function knownTechniques(player) {
  return Object.values(TECHNIQUES).filter(t => effectiveRank(player, t.discipline) >= t.rank);
}

/**
 * The roll. A technique CAN FAIL, and failing is what stops it being a passive
 * with extra steps — the difficulty rises with the target and falls with the
 * discipline behind it.
 */
export function attemptRoll(player, technique, enemy) {
  const rank = effectiveRank(player, technique.discipline);
  const threat = (enemy?.hit ?? 1) + (enemy?.dodge ?? 1);
  // 2d8−2d8, the same symmetric swing every other contest in the game uses.
  const swing = (1 + Math.floor(Math.random() * 8)) + (1 + Math.floor(Math.random() * 8))
              - (1 + Math.floor(Math.random() * 8)) - (1 + Math.floor(Math.random() * 8));
  const margin = Math.floor(rank / 8) - threat + swing;
  return { success: margin >= 0, margin };
}

export const _test = { STANCES, TECHNIQUES, attemptRoll };
