// server/engine/statmods.js
//
// Reversible additive stat-modifier ledger. Buffs/debuffs (from drugs,
// withdrawal, and anything else timed) add deltas to a player's live stat
// fields WITHOUT ever baking those deltas into the base value: every applied
// delta is remembered under a named source and reversed by the identical
// amount when the source ends.
//
// Only MAX/derived stats belong here (hp_max, sanity_max, stamina_max,
// stat_*). Current-stat one-shot deltas (hp/sanity right now) are applied
// directly by the caller and never tracked — a stim's burned HP is not
// refunded when it wears off.
//
// The ledger lives only in memory (player._modLedger), like every other timed
// buff (healOverTime, wellFedUntil). It never touches the DB, so a buffed
// value can never be persisted as base — the source of R1 in the plan.
//
// Usage:
//   applyMods(player, 'drug:redline', { stat_brawn: 3, hp_max: 20 });
//   reverseMods(player, 'drug:redline');

// Fields whose current-value counterpart must be clamped down when the cap drops.
const CAP_TO_CURRENT = {
  hp_max: 'hp',
  sanity_max: 'sanity',
  stamina_max: 'stamina',
};

// Apply (or replace) a named set of additive modifiers.
// If the source already has mods applied, they are reversed first so calling
// apply again with new values is always a clean replace (used on phase change).
export function applyMods(player, source, mods) {
  if (!mods || typeof mods !== 'object') return;
  if (player._modLedger?.[source]) reverseMods(player, source);
  if (!player._modLedger) player._modLedger = {};

  const applied = {};
  for (const [key, delta] of Object.entries(mods)) {
    const n = Number(delta);
    if (!n) continue;
    player[key] = (player[key] || 0) + n;
    applied[key] = n;
  }
  player._modLedger[source] = applied;
}

// Reverse a named set of modifiers, restoring the base values exactly.
export function reverseMods(player, source) {
  const applied = player._modLedger?.[source];
  if (!applied) return;

  for (const [key, delta] of Object.entries(applied)) {
    player[key] = (player[key] || 0) - delta;
    // Dropping a cap must pull the current value under it, or comedown could
    // leave e.g. hp > hp_max.
    const currentKey = CAP_TO_CURRENT[key];
    if (currentKey && typeof player[currentKey] === 'number') {
      player[currentKey] = Math.min(player[currentKey], player[key]);
    }
  }
  delete player._modLedger[source];
}

// Whether a source currently has mods applied.
export function hasMods(player, source) {
  return !!player._modLedger?.[source];
}
