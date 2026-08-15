// User-defined variables for the macro language.
//
// The `$values` a macro could already read ($hp, $credits, $zone…) are LIVE READS
// of the player — a fixed table in smartbar-macros.js that asks the game a
// question. What was missing is the other half: somewhere a script can put
// something and find it again. Without it a macro cannot count, cannot remember
// where it started, and cannot tell its second run from its first.
//
// Deliberately a flat string store with no types and no scoping. A variable is a
// name and a piece of text; comparisons coerce to a number at the point of
// comparison, exactly as the existing `$hp > 40` path already does. Scopes,
// types and lifetimes are what you add when scripts get big, and the ceiling on
// how big a script gets here is a textarea in a modal.
//
// Persisted, per-browser: `set warmup 1` should still be true tomorrow, and the
// alternative — losing your counters on refresh — makes the feature useless for
// the thing people actually want it for, which is remembering across sessions.
// Deliberately NOT synced to the account like macros are: a variable is state
// mid-script, and having two machines fight over a counter is worse than each
// keeping its own.
const KEY = 'architect_macro_vars';

// A name is [a-z_][a-z0-9_]* and is matched case-insensitively, same shape as the
// built-in $values it shares a namespace with. Digits are excluded from the FIRST
// character on purpose: `$1`–`$9` are trigger/alias captures, and a user variable
// called `1` would silently shadow one.
export const VAR_NAME_RE = /^[a-z_][a-z0-9_]*$/i;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  } catch { return {}; }
}

function save(obj) {
  try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch { /* quota */ }
}

export function allVars() { return load(); }

export function getVar(name) {
  const v = load()[String(name).toLowerCase()];
  return v === undefined ? null : v;
}

// Returns false when the name is not one, so callers can say so rather than
// writing a variable nothing will ever be able to read back.
export function setVar(name, value) {
  const key = String(name).toLowerCase();
  if (!VAR_NAME_RE.test(key)) return false;
  const obj = load();
  obj[key] = String(value);
  save(obj);
  return true;
}

export function unsetVar(name) {
  const obj = load();
  const key = String(name).toLowerCase();
  if (!(key in obj)) return false;
  delete obj[key];
  save(obj);
  return true;
}

export function clearVars() { save({}); }
