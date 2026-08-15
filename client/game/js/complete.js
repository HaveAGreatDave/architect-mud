// Tab completion for the command box.
//
// The oldest convenience in this genre and the one that decides whether typing at
// a text game is pleasant or a spelling test. Two vocabularies, picked by where
// the caret is:
//
//   • FIRST TOKEN → verbs. Sent once per session by the server (`verbs` route),
//     assembled there from the live registries — builtins, plugin commands,
//     specialized actions, aliases. Never a list kept here: a client-side copy of
//     the verb table goes stale silently, and the symptom is Tab quietly failing
//     to complete a verb that works perfectly when you type it out.
//
//   • ANYTHING AFTER IT → the live nouns of the room you are standing in
//     (vocabulary.js — the same list voice input matches against).
//
// Three rules.
//
//   1. NEVER INVENT. No matches means nothing happens — not a beep, not a guess,
//      not the closest thing. Same rule dictation runs on, and for the same
//      reason: a guess that lands on a real verb runs it.
//
//   2. COMMON PREFIX FIRST, THEN CYCLE. The first Tab extends as far as every
//      candidate agrees, which is free and is what a reader expects from a shell.
//      Only once there is nothing left to agree on does further tabbing walk the
//      candidates one at a time (Shift+Tab walks back).
//
//   3. THE CYCLE IS ABANDONED THE MOMENT THE LINE CHANGES. Typing anything, or
//      moving the caret, throws the candidate list away — a stale cycle is how you
//      end up replacing a word you already finished with a completion of the word
//      you had before it.
import { liveNouns } from './vocabulary.js';

// Verbs the server told us about. Empty until the `verbs` reply lands, and empty
// is a perfectly good state: verb completion simply does nothing for the first
// moment of a session, which nobody notices, and no fallback list is kept for it.
let VERBS = [];
export function setVerbs(list) { VERBS = Array.isArray(list) ? list : []; }

// ── The candidate cycle ─────────────────────────────────────────────────────
let cycle = null;   // { matches, idx, start, end, line }

export function resetCompletion() { cycle = null; }

// The token the caret sits in, as [start, end) offsets into the line. A caret at
// the very end of the line is inside the last token; a caret after a space starts
// a new, empty one (so `get ` + Tab offers everything in the room).
function tokenAt(line, caret) {
  let start = caret;
  while (start > 0 && !/\s/.test(line[start - 1])) start--;
  let end = caret;
  while (end < line.length && !/\s/.test(line[end])) end++;
  return [start, end];
}

// How far every candidate agrees, starting from what was typed. Returns the
// typed prefix itself when they diverge immediately.
function commonPrefix(matches) {
  let out = matches[0];
  for (const m of matches.slice(1)) {
    let i = 0;
    while (i < out.length && i < m.length && out[i].toLowerCase() === m[i].toLowerCase()) i++;
    out = out.slice(0, i);
  }
  return out;
}

function candidates(line, start) {
  const typed = line.slice(start).split(/\s/)[0].toLowerCase();
  // The first token of the line is a verb; everything else names a thing. Note
  // this is the FIRST TOKEN, not "no spaces yet" — leading spaces are still a verb
  // position, which is what makes a stray space before a command harmless.
  const isVerb = line.slice(0, start).trim() === '';
  const pool = isVerb ? VERBS : liveNouns();
  const seen = new Set();
  const out = [];
  for (const c of pool) {
    const s = String(c || '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (!key.startsWith(typed) || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  // Shortest first: `take` should be reachable before `takeoff`, and a two-letter
  // exit before the item whose name happens to start the same way.
  return out.sort((a, b) => a.length - b.length || a.localeCompare(b));
}

function put(input, start, end, text) {
  const line = input.value;
  input.value = line.slice(0, start) + text + line.slice(end);
  const caret = start + text.length;
  input.setSelectionRange(caret, caret);
  return caret;
}

/**
 * Handle a Tab press in the command box. Returns true if it completed anything —
 * the caller only preventDefault()s then, so Tab still moves focus out of an empty
 * box and the keyboard is never trapped in it (see docs/systems-accessibility.md).
 *
 * @param {HTMLInputElement} input
 * @param {boolean} back  Shift held — walk the cycle backwards.
 */
export function completeInput(input, back = false) {
  const caret = input.selectionStart ?? input.value.length;
  // Rule 3: any edit or caret move since the last Tab retires the cycle.
  if (cycle && (cycle.line !== input.value || caret !== cycle.caret)) cycle = null;

  if (cycle) {
    const n = cycle.matches.length;
    cycle.idx = (cycle.idx + (back ? -1 : 1) + n) % n;
    const pick = cycle.matches[cycle.idx];
    cycle.caret = put(input, cycle.start, cycle.end, pick);
    cycle.end = cycle.start + pick.length;
    cycle.line = input.value;
    return true;
  }

  const [start, end] = tokenAt(input.value, caret);
  const matches = candidates(input.value, start);
  if (!matches.length) return false;                                  // rule 1

  const typed = input.value.slice(start, end);
  const prefix = commonPrefix(matches);
  // Rule 2: extend to the agreed prefix if that actually adds anything, and only
  // arm the cycle when it doesn't. A single match is just finished outright.
  if (matches.length === 1) {
    put(input, start, end, matches[0]);
    return true;
  }
  if (prefix.length > typed.length) {
    put(input, start, end, prefix);
    return true;
  }
  const pick = matches[back ? matches.length - 1 : 0];
  const newCaret = put(input, start, end, pick);
  cycle = {
    matches,
    idx: back ? matches.length - 1 : 0,
    start,
    end: start + pick.length,
    line: input.value,
    caret: newCaret,
  };
  return true;
}
