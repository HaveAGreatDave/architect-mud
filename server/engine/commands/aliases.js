/**
 * Verb aliases — shortcut terms that rewrite the first word of a command to a
 * canonical verb before dispatch (e.g. `scav` → `scavenge`). Aliases are
 * invisible to players by design; the rewritten verb then flows through the
 * normal pipeline (input matchers, plugins, specialized actions, builtins).
 *
 * Source-of-truth pattern (mirrors crimes/tunables): ship sensible defaults here
 * so a fresh DB works before any rows are authored, and let DB rows in
 * `command_aliases` add or override entries. The dev panel reads getAliasList()
 * (defaults merged with DB) and writes rows back.
 */
import { query } from '../../models/db.js';

// alias → canonical verb. These ship with the engine; DB rows override by alias.
// Only pure abbreviations belong here — each target is an independently
// dispatchable verb, and the abbreviation isn't a specialized/plugin verb (which
// would change its pipeline precedence). Context-layered synonyms (eat/use,
// open/close, get/take, …) stay as engine builtins on purpose so tag-gated
// specialized handlers still win over them.
export const ALIAS_DEFAULTS = {
  scav: 'scavenge',
  // Movement
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
  u: 'up',
  d: 'down',
  // Look / examine
  l: 'look',
  ex: 'examine',
  x: 'examine',
  // Inventory
  i: 'inventory',
  inv: 'inventory',
  // Info screens
  st: 'stats',
  '?': 'help',
  // Misc
  tp: 'teleport',
  t: 'whisper',
};

let overrides = {}; // alias → verb (from DB)
let merged = { ...ALIAS_DEFAULTS };

function rebuild() {
  merged = { ...ALIAS_DEFAULTS, ...overrides };
}

export async function reloadAliases() {
  try {
    const { rows } = await query('SELECT alias, verb FROM command_aliases');
    overrides = {};
    for (const r of rows) overrides[r.alias] = r.verb;
  } catch {
    overrides = {}; // table not present yet — defaults stand
  }
  rebuild();
}

// Canonical verb for a typed first word, or undefined if it isn't an alias.
export function getAlias(word) {
  return merged[word];
}

// Defaults merged with DB overrides — the shape the dev panel renders/edits.
export function getAliasList() {
  const keys = new Set([...Object.keys(ALIAS_DEFAULTS), ...Object.keys(overrides)]);
  return [...keys].sort().map(alias => ({
    alias,
    verb: merged[alias],
    is_default: !(alias in overrides),
  }));
}
