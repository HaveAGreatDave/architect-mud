/**
 * Engine-side tag helpers. The tag catalog is the shared single source of
 * truth (client/shared/tagCatalog.js); we import it for its side effect (it
 * assigns globalThis.TAG_CATALOG) and read it from there.
 */
import '../../client/shared/tagCatalog.js';

export const TAG_CATALOG = globalThis.TAG_CATALOG;

// The tag bag of any Entity. Items keep their tags in the `tags` JSONB column;
// enemies/NPCs/furniture/zones store the same kind of behavior markers in their
// legacy `flags` JSONB column. Reading both here lets the tag mechanism (and the
// specialized-action registry) treat every Entity uniformly. (ADR-0003)
export function tagsOf(entity) {
  const bag = entity?.tags || entity?.flags;
  if (!bag) return {};
  // Furniture stores its interactable verbs as a `flags.interactions` array
  // (e.g. ['switch','sit']). Surface each entry as a present tag so furniture is
  // tag-driven like every other Entity and the specialized-action registry can
  // gate on it (e.g. requiredTag:'switch').
  if (Array.isArray(bag.interactions)) {
    const merged = { ...bag };
    for (const ix of bag.interactions) merged[ix] = true;
    return merged;
  }
  return bag;
}

// Class tags live on the item template (items.tags) or an entity's flags bag.
export function hasTag(item, name) {
  const tags = tagsOf(item);
  return Object.prototype.hasOwnProperty.call(tags, name);
}

export function tagValue(item, name, fallback = undefined) {
  const tags = tagsOf(item);
  if (Object.prototype.hasOwnProperty.call(tags, name)) return tags[name];
  return fallback;
}

// Instance flags are presence-only, stored in player_inventory.custom_data.
export function hasFlag(invRow, name) {
  return invRow?.custom_data?.[name] === true;
}
