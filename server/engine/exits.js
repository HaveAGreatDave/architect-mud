// Zone-exit accessor — the single place the polymorphic exit value is normalized.
//
// A zone's exits are stored as a direction-keyed map. The value for a direction
// is EITHER a plain zone-id string (the common single-exit case) OR an array of
// zone-id strings when a direction has two or more exits sharing it (e.g. two
// "north" exits to different zones, disambiguated at runtime by destination name
// via resolveNamedDestination). Storage stays backward compatible: existing zones
// with string values keep working untouched, and a direction only becomes an
// array when a second exit is added to it.
//
// Every reader routes through these helpers so the string|array split lives in
// one file. Do not read `zone.exits[dir]` raw elsewhere — that reintroduces the
// split-source bug class (a reader assuming a string where another wrote an array).

const DIR_ORDER = ['north', 'south', 'east', 'west', 'up', 'down', 'in', 'out'];

// All destination zone-ids for one direction, always as an array (0, 1, or many).
export function exitTargets(zone, dir) {
  const v = zone?.exits?.[dir];
  if (v == null) return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v];
}

// Every exit as a flat [{ dir, target }] list, expanding array-valued directions.
// Directions are emitted in canonical order; multiple exits on one direction keep
// their stored order. Replaces every `Object.entries(zone.exits)` iteration.
export function allExits(zone) {
  const exits = zone?.exits || {};
  const out = [];
  const dirs = Object.keys(exits).sort((a, b) => {
    const ia = DIR_ORDER.indexOf(a), ib = DIR_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  for (const dir of dirs) {
    for (const target of exitTargets(zone, dir)) out.push({ dir, target });
  }
  return out;
}

// Flat list of every destination zone-id. Replaces `Object.values(zone.exits)`.
export function neighborZoneIds(zone) {
  return allExits(zone).map((e) => e.target);
}

// Does this zone have any exit in the given direction?
export function hasExit(zone, dir) {
  return exitTargets(zone, dir).length > 0;
}

// Flattened dir→single-id map (first target per direction). Used at the client
// boundary (minimap / grid drawing), which is spatial and can only place one cell
// per cardinal direction. The secondary exit stays reachable by name.
export function primaryExits(zone) {
  const out = {};
  for (const dir of Object.keys(zone?.exits || {})) {
    const targets = exitTargets(zone, dir);
    if (targets.length) out[dir] = targets[0];
  }
  return out;
}

// ── Mutation helpers (canonical shape rule) ─────────────────────────────────
// Operate on a plain exits object and return it. A direction collapses to a bare
// string when it holds one target, and expands to an array at two or more — so
// single-exit zones never grow an array and stay byte-identical to legacy data.

export function addExit(exits, dir, target) {
  const e = exits || {};
  const current = exitTargets({ exits: e }, dir);
  if (current.includes(target)) return e;
  const next = [...current, target];
  e[dir] = next.length === 1 ? next[0] : next;
  return e;
}

export function removeExit(exits, dir, target) {
  const e = exits || {};
  const next = exitTargets({ exits: e }, dir).filter((t) => t !== target);
  if (next.length === 0) delete e[dir];
  else e[dir] = next.length === 1 ? next[0] : next;
  return e;
}
