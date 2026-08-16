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
// Persisted: `set warmup 1` should still be true tomorrow, and losing your
// counters on refresh makes the feature useless for the thing people want it for.
//
// ⚠ These DO follow the account (configsync.js, key `vars`). When variables
// shipped, this comment said the opposite — the argument being that a variable is
// state mid-script and two machines fighting over a counter is worse than each
// keeping its own. That was the wrong call and is reversed here deliberately.
// Under last-writer-wins nobody "fights": the loser is a counter that gets reset,
// which is the same thing a browser refresh already did and which no script
// depends on across a session boundary. Against that, half a player's setup
// following them and the other half not is the confusing outcome, and the whole
// point of the sync layer is that the client's setup goes where the player goes.
import { markConfigDirty } from './configsync.js';

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
  markConfigDirty('vars');
}

// Adopting the account's copy — not through save(), which would mark the key
// dirty and push the server's own object back at it. See configsync.js.
export function replaceVars(obj) {
  const next = (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* quota */ }
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
