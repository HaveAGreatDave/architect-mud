// The parts of automation.js that must be provably right, with no DOM and no
// imports, so they can be tested headlessly (scripts/client/automation-smoke.mjs).
//
// These are here BECAUSE they are the dangerous half. A trigger fires commands,
// commands produce lines, and lines fire triggers; the difference between that
// being a feature and being an attack on your own server is entirely in this
// file. Reviewing it carefully is not the same as testing it, and "I read it and
// it looked right" is how a loop ships.

// A sliding-window budget. `allow()` records an attempt and returns false once
// more than `max` have happened inside `windowMs`.
//
// A WINDOW, not an interval counter: a counter reset every ten seconds lets 24
// fires land at 9.9s and 24 more at 10.1s, which is 48 in a fifth of a second and
// exactly the burst this exists to catch.
export function makeBudget({ max, windowMs, now = () => Date.now() } = {}) {
  let hits = [];
  return {
    allow() {
      const t = now();
      hits = hits.filter(x => t - x < windowMs);
      if (hits.length >= max) return false;
      hits.push(t);
      return true;
    },
    reset() { hits = []; },
    get size() { return hits.length; },
  };
}

// Substitute `$0`–`$9` from a match into a script string.
//
// ⚠ An absent group becomes '' and never the literal `$3`. A command assembled
// from an optional group that did not participate must not be sent to the server
// with a dollar sign in it — the server would answer "Unknown command" and the
// player would have no idea which of their triggers did it.
//
// Only single digits, deliberately: `$10` is `$1` followed by a `0`, which is
// what every client in this genre does, and supporting two digits would make
// `$1` ambiguous in any script that ends a capture next to a number.
export function applyCaptures(cmds, match) {
  return String(cmds).replace(/\$([0-9])/g, (_, d) => String(match?.[Number(d)] ?? ''));
}

// Compile one trigger/alias row into something with a `.test(line)` that returns
// a match array or null.
//
// ⚠ A regex that does not compile marks the row BROKEN rather than throwing. This
// runs inside the log's append path; an exception here takes the whole log down,
// on every line, until a reload — and a player writing an unbalanced bracket is
// not a rare event.
export function compileRow(row) {
  if (!row || !row.pattern) return null;
  const extra = splitGag(row.cmds);
  if (!row.regex) {
    const needle = String(row.pattern).toLowerCase();
    if (!needle) return null;
    return { ...row, ...extra, test: (s) => (String(s).toLowerCase().includes(needle) ? [String(s)] : null) };
  }
  try {
    const re = new RegExp(row.pattern, 'i');
    return { ...row, ...extra, test: (s) => String(s).match(re) };
  } catch {
    return { ...row, ...extra, broken: true, test: () => null };
  }
}

// `gag` is resolved HERE, at compile, into a boolean plus the script with the gag
// segment removed — never discovered while the script runs.
//
// ⚠ That is the whole design of it. Hiding a line has to be decided before the
// line is mounted, and the runner is async: a `gag` found three segments into a
// script that has already awaited a `delay` would be deciding to hide something
// the player read two seconds ago. So gagging is a property of the TRIGGER, and
// writing it as a segment is only how you say so.
//
// `gagOnly` (a trigger that gags and does nothing else) matters because such a
// trigger fires no commands and therefore cannot loop — so it is exempt from the
// re-entrancy guard and the fire budget. Without that exemption you could not gag
// the output of your own triggers, which is a large part of what gagging is for.
export function splitGag(cmds) {
  const segs = String(cmds || '').split(/[;\n]/).map(s => s.trim()).filter(Boolean);
  const gag = segs.some(s => /^gag$/i.test(s));
  if (!gag) return { gag: false, gagOnly: false, cmds };
  const rest = segs.filter(s => !/^gag$/i.test(s));
  return { gag: true, gagOnly: rest.length === 0, cmds: rest.join(';') };
}
