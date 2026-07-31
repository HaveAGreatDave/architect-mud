// Impairment substrate — "what is currently making this body worse at things".
//
// The engine already had FOUR unrelated ways to be diminished, each hardcoded at
// its own site: condition.js's stat penalties (cold, hunger, thirst, fatigue),
// the stamina-regen multiplier chain in gameLoop's restRegenTick, the stance
// to-hit modifier, and the run-mode stamina toll. A system that wants to slow a
// player down had nowhere to say so without editing all four.
//
// This is that seam. A provider answers "how is this player diminished right
// now"; the four sites ask, and never learn who is doing it. Injuries are the
// first provider; a mutation, a curse, a heavy exosuit or a bad drug comedown
// would all register the same way.
//
//   registerImpairmentProvider(player => ({ statPenalties: { stat_brains: 1 } }), 'injury')
//
// SYNCHRONOUS AND QUERY-FREE BY CONTRACT. Every one of the four consumers sits on
// a hot path — per-swing, per-move, per-15s-tick across all players. Providers
// read caches, never the DB. Same rule as protection.js next door.
//
// A provider returns any subset of:
//   statPenalties        { stat_brawn: 1, … }  points SUBTRACTED (positive = worse),
//                                              matching condition.js's own convention
//   staminaRegenMult     0..1, multiplied into the regen chain
//   hitMod               added to the to-hit margin (negative = worse)
//   runBlocked           a string reason, or null — refuses run mode outright
//   moveStaminaExtra     extra stamina charged per step taken
//   notes                [{ label, detail }] for the Vitals "presenting" rail

const providers = [];

export function registerImpairmentProvider(provider, owner = 'plugin') {
  if (typeof provider !== 'function') throw new Error('registerImpairmentProvider: function required');
  providers.push({ provider, owner });
}

const EMPTY = Object.freeze({
  statPenalties: Object.freeze({}),
  staminaRegenMult: 1,
  hitMod: 0,
  runBlocked: null,
  moveStaminaExtra: 0,
  notes: Object.freeze([]),
});

/**
 * Everything currently diminishing this player, merged across providers.
 *
 * Fast path matters: with no providers registered (or none with anything to say)
 * this returns a frozen shared object and allocates nothing, so the four call
 * sites cost a function call and a property read when nobody is impaired — which
 * is the overwhelmingly common case.
 */
export function impairmentOf(player) {
  if (!providers.length || !player) return EMPTY;

  let out = null;
  for (const { provider, owner } of providers) {
    let r;
    try {
      r = provider(player);
    } catch (e) {
      console.error(`[impairment:${owner}] provider error: ${e.message}`);
      continue;
    }
    if (!r) continue;

    out = out || { statPenalties: {}, staminaRegenMult: 1, hitMod: 0, runBlocked: null, moveStaminaExtra: 0, notes: [] };

    for (const [stat, pts] of Object.entries(r.statPenalties || {})) {
      out.statPenalties[stat] = (out.statPenalties[stat] || 0) + (Number(pts) || 0);
    }
    // Multipliers compound rather than take the worst — two independent reasons
    // your body won't recover should be worse than either alone.
    if (r.staminaRegenMult != null) out.staminaRegenMult *= Math.max(0, Number(r.staminaRegenMult) || 0);
    out.hitMod += Number(r.hitMod) || 0;
    out.moveStaminaExtra += Number(r.moveStaminaExtra) || 0;
    // First provider to refuse running wins the message — they're all true, and
    // one reason is more readable than a list of them.
    if (!out.runBlocked && r.runBlocked) out.runBlocked = String(r.runBlocked);
    if (Array.isArray(r.notes) && r.notes.length) out.notes.push(...r.notes);
  }
  return out || EMPTY;
}

/** Points subtracted from one stat by impairment. The condition.js hot path. */
export function impairmentStatPenalty(player, stat) {
  if (!providers.length) return 0;
  return impairmentOf(player).statPenalties[stat] || 0;
}

export function getRegisteredImpairmentProviders() { return providers.map(p => p.owner); }
