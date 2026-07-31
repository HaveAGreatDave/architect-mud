/**
 * Token interpolation for authored graphs.
 *
 * `${dotted.path}` inside any string is resolved against a params object. Used by
 * the Script runtime (graph.js — trigger params + event payload) and by the
 * Dialogue walker (dialogue.js — npc/player/zone), so both speak the same
 * authoring language. Lives in its own module because dialogue must not import
 * the script runtime.
 *
 * Two deliberate rules:
 *   - An unresolved token is left VERBATIM, not blanked. A typo'd `${vnue}`
 *     shows up as itself in a flag key instead of silently collapsing two
 *     instances onto one shared counter.
 *   - A token resolving to a NON-SCALAR is also left verbatim. `${event.actor}`
 *     is the live player object; nobody wants that stringified into a flag key.
 *
 * Params are referenced, never copied — this runs on zone.entered.
 */

const TOKEN = /\$\{([\w.]+)\}/g;

export function tokenValue(path, params) {
  let cur = params;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  const t = typeof cur;
  return (t === 'string' || t === 'number' || t === 'boolean') ? String(cur) : undefined;
}

export function interp(value, params) {
  if (!params || typeof value !== 'string' || !value.includes('${')) return value;
  return value.replace(TOKEN, (m, path) => tokenValue(path, params) ?? m);
}

/** Deep-interpolate strings at any depth in an object/array (action params). */
export function interpDeep(value, params) {
  if (typeof value === 'string') return interp(value, params);
  if (Array.isArray(value)) return value.map(v => interpDeep(v, params));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpDeep(v, params);
    return out;
  }
  return value;
}
