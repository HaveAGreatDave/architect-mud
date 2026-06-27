/**
 * Engine-side supertag helpers. The supertag registry is shared content
 * (client/shared/tagSupertags.js); we import it for its side effect (it assigns
 * globalThis.TAG_SUPERTAGS) and read it from there. The dev-panel PUT route keeps
 * the global in sync after edits.
 *
 * Supertags are flattened onto an item's stored `tags` at write time so the
 * engine's existing reads (SQL gates and tagsOf()) need no special casing. Two
 * bookkeeping keys record provenance so items can be re-materialized when a
 * supertag changes:
 *   __super : array of applied supertag keys
 *   __own   : the item's own authored tags (always win over supertag members)
 */
import '../../client/shared/tagSupertags.js';

export const SUPER_KEY = '__super';
export const OWN_KEY = '__own';

// The item's own authored tags. Pre-supertag items have no __own bag; their whole
// tags object is authored (minus any bookkeeping keys, which won't be present).
export function ownTags(tags) {
  const t = tags && typeof tags === 'object' ? tags : {};
  if (t[OWN_KEY] && typeof t[OWN_KEY] === 'object') return { ...t[OWN_KEY] };
  const own = { ...t };
  delete own[SUPER_KEY];
  delete own[OWN_KEY];
  return own;
}

// The supertag keys applied to an item.
export function superKeys(tags) {
  const v = tags && typeof tags === 'object' ? tags[SUPER_KEY] : null;
  return Array.isArray(v) ? v.slice() : [];
}

/**
 * Build the stored tags object from authored tags + applied supertag keys.
 * Effective = each supertag's members merged in order, then own tags on top.
 * With no supertags applied, returns flat authored tags (no bookkeeping keys) —
 * identical to the pre-supertag format, so nothing migrates.
 */
export function materializeItemTags(own, keys, registry = globalThis.TAG_SUPERTAGS || {}) {
  const ownClean = own && typeof own === 'object' ? { ...own } : {};
  delete ownClean[SUPER_KEY];
  delete ownClean[OWN_KEY];
  const validKeys = (Array.isArray(keys) ? keys : []).filter(k => registry[k]);
  if (!validKeys.length) return ownClean;
  const eff = {};
  for (const k of validKeys) Object.assign(eff, registry[k].members || {});
  Object.assign(eff, ownClean);
  eff[SUPER_KEY] = validKeys;
  eff[OWN_KEY] = ownClean;
  return eff;
}
