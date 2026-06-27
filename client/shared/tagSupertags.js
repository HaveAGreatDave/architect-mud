/**
 * Item Supertag Registry — reusable bundles of tags ("classes" of items).
 *
 * A supertag groups a set of catalog tags (with values) under one name, e.g. a
 * "weapon" supertag carrying { weapon:true, slot:"weapon_hand", ... } so every
 * weapon is configured consistently. Applying a supertag to an item is a *live
 * reference*: the supertag's member tags are flattened onto the item's stored
 * `tags` (so the engine's SQL gates and tagsOf() read them with no special
 * casing), and editing the supertag re-materializes every item that references
 * it. The item's own authored tags always win over supertag-supplied ones.
 *
 * Dual-mode by design, exactly like tagCatalog.js: the dev panel loads this as a
 * classic <script>, while the Node engine imports it for its side effect. Both
 * land on `globalThis.TAG_SUPERTAGS`.
 *
 * Each entry: { label, group, help, members } where `members` is a map of
 * catalog-tag-name -> value (`true` for flag-shaped tags), the same shape an
 * item's `tags` object uses.
 */
(function (global) {
  const TAG_SUPERTAGS = {};

  global.TAG_SUPERTAGS = TAG_SUPERTAGS;
})(typeof window !== 'undefined' ? window : globalThis);
