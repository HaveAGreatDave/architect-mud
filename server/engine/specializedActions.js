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

// `handler: null` registers a *declaration-only* entry: the verb stays an ordinary
// command-map verb owned by the plugin, and the row exists purely so the reverse
// lookup below can advertise it on the objects that gate it. That's the seam for
// the large class of verbs gated on a plain flag (`scrub` at a police_terminal)
// rather than a Tag — they were previously invisible to examine.
export function registerSpecializedAction({ verb, requiredTag, requiredFlag, handler, pluginName }) {
  if (!verb) throw new Error('registerSpecializedAction: verb required');
  if (handler !== null && typeof handler !== 'function') throw new Error(`registerSpecializedAction: "${verb}" handler must be a function, or null for a declaration-only entry`);
  if (handler === null && !requiredTag && !requiredFlag) throw new Error(`registerSpecializedAction: declaration-only "${verb}" needs a requiredTag or requiredFlag to be discoverable`);
  if (!registry.has(verb)) registry.set(verb, []);
  registry.get(verb).push({ requiredTag, requiredFlag, handler, pluginName });
}

// Fire the handlers registered for a verb, in registration order. Returns the
// first non-undefined result, or undefined if none handled it (fall through to
// the built-in handler). Handlers self-resolve their target and self-gate.
export async function fireSpecializedAction(verb, args, raw, player, broadcast) {
  const entries = registry.get(verb);
  if (!entries?.length) return undefined;
  for (const { handler } of entries) {
    if (!handler) continue; // declaration-only entry — the plugin's own command handles it
    const result = await handler(args, raw, player, broadcast);
    if (result !== undefined) return result;
  }
  return undefined;
}

// Reverse lookup: the verbs this Entity gates open, by its Tags or its flags.
// Generic (ungated) verbs are always-on and intentionally omitted here — this
// list is the Entity-specific action hints for examine / clickable UI.
export function availableActions(entity) {
  const flags = entity?.flags || {};
  const verbs = [];
  for (const [verb, entries] of registry) {
    const open = entries.some(e =>
      (e.requiredTag && hasTag(entity, e.requiredTag)) ||
      (e.requiredFlag && flags[e.requiredFlag])
    );
    if (open) verbs.push(verb);
  }
  return verbs;
}

export function getRegisteredSpecializedActions() {
  const out = {};
  for (const [verb, entries] of registry) out[verb] = entries.map(e => ({ requiredTag: e.requiredTag, requiredFlag: e.requiredFlag, pluginName: e.pluginName }));
  return out;
}
