// Livery sets: the read side of content/liveries/ (baked into ./liveries.js).
//
// A set is a whole look for one model: exterior paint, interior and nameplate. A model's `default`
// set is what it wears before anyone paints it, which is how a new aircraft stops coming out grey.
// A set with an `unlock` flag is only offered to a player who has that flag set.
//
// Sync and query-free: the table is a module of literals, and the unlock test is handed in by the
// caller (the server reads the player's hydrated flags).
import { LIVERIES } from './liveries.js';
import { ANY_MODEL } from './livery-schema.js';

/** Every set offered on this model: its own (default first), then the generic ones. */
export function liveriesFor(kind, model) {
  const own = LIVERIES.filter((l) => l.kind === kind && l.model === model);
  return [...own, ...LIVERIES.filter((l) => l.kind === kind && l.model === ANY_MODEL)];
}

/** The set a model wears when nobody has painted it, or null if it has none. */
export function defaultLivery(kind, model) {
  return LIVERIES.find((l) => l.kind === kind && l.model === model && l.default) || null;
}

/** One set by id, looked up on its model and then among the generic ones. */
export function liveryById(kind, model, id) {
  const want = String(id || '').toLowerCase();
  return liveriesFor(kind, model).find((l) => l.id === want) || null;
}

/** The unlock flags this model's sets name, so a caller can read them in one go. */
export function unlockKeysFor(kind, model) {
  return [...new Set(liveriesFor(kind, model).map((l) => l.unlock).filter(Boolean))];
}

/** Sets a player may pick: `has(flagKey)` answers whether an unlock is set. */
export function unlockedLiveries(kind, model, has) {
  return liveriesFor(kind, model).filter((l) => !l.unlock || has(l.unlock));
}
