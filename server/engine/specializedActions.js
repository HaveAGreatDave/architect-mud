/**
 * Specialized-action registry — verb-first, tag-gated (plan decision #5, ADR-0003).
 *
 * A plugin registers `{ verb, requiredTag?, handler }`. At dispatch, the command
 * pre-pass fires every handler registered for a typed verb; each handler resolves
 * its own target and returns a result, or `undefined` to fall through (so the old
 * built-in handler stays as a fallback until a domain is fully ported).
 *
 * Read in reverse, the same registry yields the verbs available on a given Entity
 * (by its Tags) — powering `examine` action hints and, later, clickable UI.
 */
import { hasTag } from './tags.js';

// verb -> [{ requiredTag, handler, pluginName }]
const registry = new Map();

export function registerSpecializedAction({ verb, requiredTag, handler, pluginName }) {
  if (!verb || typeof handler !== 'function') throw new Error('registerSpecializedAction: verb and handler required');
  if (!registry.has(verb)) registry.set(verb, []);
  registry.get(verb).push({ requiredTag, handler, pluginName });
}

// Fire the handlers registered for a verb, in registration order. Returns the
// first non-undefined result, or undefined if none handled it (fall through to
// the built-in handler). Handlers self-resolve their target and self-gate.
export async function fireSpecializedAction(verb, args, raw, player, broadcast) {
  const entries = registry.get(verb);
  if (!entries?.length) return undefined;
  for (const { handler } of entries) {
    const result = await handler(args, raw, player, broadcast);
    if (result !== undefined) return result;
  }
  return undefined;
}

// Reverse lookup: the tag-gated verbs available on this Entity, by its Tags.
// Generic (no-requiredTag) verbs are always-on and intentionally omitted here —
// this list is the Entity-specific action hints for examine / clickable UI.
export function availableActions(entity) {
  const verbs = [];
  for (const [verb, entries] of registry) {
    if (entries.some(e => e.requiredTag && hasTag(entity, e.requiredTag))) verbs.push(verb);
  }
  return verbs;
}

export function getRegisteredSpecializedActions() {
  const out = {};
  for (const [verb, entries] of registry) out[verb] = entries.map(e => ({ requiredTag: e.requiredTag, pluginName: e.pluginName }));
  return out;
}
