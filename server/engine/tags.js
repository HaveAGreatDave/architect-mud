/**
 * Engine-side tag helpers. The tag catalog is the shared single source of
 * truth (client/shared/tagCatalog.js); we import it for its side effect (it
 * assigns globalThis.TAG_CATALOG) and read it from there.
 */
import '../../client/shared/tagCatalog.js';

export const TAG_CATALOG = globalThis.TAG_CATALOG;

// Class tags live on the item template (items.tags JSONB).
export function hasTag(item, name) {
  const tags = item?.tags;
  return !!tags && Object.prototype.hasOwnProperty.call(tags, name);
}

export function tagValue(item, name, fallback = undefined) {
  const tags = item?.tags;
  if (tags && Object.prototype.hasOwnProperty.call(tags, name)) return tags[name];
  return fallback;
}

// Instance flags are presence-only, stored in player_inventory.custom_data.
export function hasFlag(invRow, name) {
  return invRow?.custom_data?.[name] === true;
}
