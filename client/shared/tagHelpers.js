/**
 * Tag applicability helpers — kept separate from tagCatalog.js because that file
 * is regenerated verbatim from JSON whenever the Tags screen saves the catalog
 * (apiPutTagCatalog), which would wipe any functions defined alongside it.
 *
 * Dual-mode like tagCatalog.js: loads as a browser global for the dev panel and
 * is importable from Node.
 *
 * `targets` (optional array on a catalog entry) controls which dev-panel editors
 * offer a tag. When absent, applicability is derived from `scope`:
 *   class → item, furniture → furniture, instance → neither (runtime-only).
 */
(function (global) {
  function tagTargets(def) {
    if (!def) return [];
    if (Array.isArray(def.targets) && def.targets.length) return def.targets;
    if (def.scope === 'furniture') return ['furniture'];
    if (def.scope === 'instance') return [];
    return ['item'];
  }
  // surface is 'item' or 'furniture'.
  function tagAppliesTo(def, surface) {
    if (!def) return false;
    if (def.scope === 'instance') return false; // instance flags are never builder-attached
    return tagTargets(def).includes(surface);
  }
  global.tagTargets = tagTargets;
  global.tagAppliesTo = tagAppliesTo;
})(typeof window !== 'undefined' ? window : globalThis);
