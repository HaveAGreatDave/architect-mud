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
  let bag = entity?.tags || entity?.flags;
  if (!bag) return {};
  // Items with supertags carry bookkeeping keys (__super / __own) alongside their
  // flattened effective tags. Hide them so they never surface as phantom tags.
  if (bag.__super || bag.__own) {
    bag = { ...bag };
    delete bag.__super;
    delete bag.__own;
  }
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

// Items stack by default; the `unique` tag opts an item out of stacking.
export function isStackable(item) {
  return !hasTag(item, 'unique');
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

// Write-time validation of an item tag bag against the catalog. The engine
// gates behavior on tag names — a typo'd key is silently inert forever, so
// writes must fail loudly instead. Returns { ok, unknown, badShape }.
// Carve-outs: supertag bookkeeping (__super/__own, stripped by ownTags anyway)
// and parameterized families containing ':' (e.g. door lock:* tags).
export function validateTags(bag) {
  const unknown = [];
  const badShape = [];
  for (const [key, value] of Object.entries(bag || {})) {
    if (key === '__super' || key === '__own' || key.includes(':')) continue;
    if (key.startsWith('bait_')) continue; // open-ended bait sub-tag family (fishing)
    const def = TAG_CATALOG[key];
    if (!def) { unknown.push(key); continue; }
    switch (def.shape) {
      case 'flag':
        // false is tolerated (legacy rows carry it) but reads as PRESENT to
        // hasTag — presence is the signal, not the boolean.
        if (typeof value !== 'boolean' && value !== 1) badShape.push(`${key} (flag: expected true)`);
        break;
      case 'int':
        if (!Number.isFinite(Number(value))) badShape.push(`${key} (int: got ${JSON.stringify(value)})`);
        break;
      case 'enum':
        if (Array.isArray(def.options) && !def.options.includes(value)) badShape.push(`${key} (enum: "${value}" not in ${def.options.join('/')})`);
        break;
      case 'range':
        if (typeof value !== 'object' || value === null || !Number.isFinite(Number(value.min)) || !Number.isFinite(Number(value.max))) badShape.push(`${key} (range: expected {min,max})`);
        break;
      case 'statmap':
        if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.values(value).some(v => !Number.isFinite(Number(v)))) badShape.push(`${key} (statmap: expected {key:number,...})`);
        break;
      case 'hot':
        if (typeof value !== 'object' || value === null || !Number.isFinite(Number(value.amount)) || !Number.isFinite(Number(value.duration_seconds))) badShape.push(`${key} (hot: expected {amount,duration_seconds})`);
        break;
      case 'list':
        if (!Array.isArray(value)) badShape.push(`${key} (list: expected array)`);
        break;
      // 'text' and unrecognized shapes: any value accepted
    }
  }
  return { ok: unknown.length === 0 && badShape.length === 0, unknown, badShape };
}
