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
// `row.channel` restricts a trigger to one message class — `loot`, `say`,
// `combat-incoming`. This is the local answer to what other clients call a COLOUR
// trigger: this client has no ANSI and never will, it has ~30 semantic classes,
// and matching the meaning directly beats matching a colour somebody chose to
// stand for it. An empty pattern with a channel matches every line on it.
// `row.lines > 1` makes it a MULTI-LINE row: the text handed to `test` is that
// many recent lines joined with newlines, and the regex is compiled with the
// dotAll flag so `.` spans the joins. Without dotAll every multi-line pattern
// would have to be written with `[\s\S]`, which is the sort of thing that makes
// people decide the feature does not work.
//
// ⚠ The CHANNEL of a multi-line row is tested against the channel of the LAST
// line in the window — the one that just arrived. Requiring every line in the
// window to share a channel would make `@say` multi-line patterns impossible the
// moment anything interleaved, which in a busy room is always.
export function compileRow(row) {
  if (!row) return null;
  const channel = row.channel ? String(row.channel).toLowerCase() : null;
  if (!row.pattern && !channel) return null;
  const extra = splitGag(row.cmds);
  const lines = Math.max(1, Math.min(10, Number(row.lines) || 1));
  const onChannel = (cls) => !channel || String(cls || '').toLowerCase() === channel;

  if (!row.pattern) {
    return { ...row, ...extra, channel, lines, test: (s, cls) => (onChannel(cls) ? [String(s)] : null) };
  }
  if (!row.regex) {
    const needle = String(row.pattern).toLowerCase();
    if (!needle) return null;
    return {
      ...row, ...extra, channel, lines,
      test: (s, cls) => (onChannel(cls) && String(s).toLowerCase().includes(needle) ? [String(s)] : null),
    };
  }
  try {
    const re = new RegExp(row.pattern, lines > 1 ? 'is' : 'i');
    return { ...row, ...extra, channel, lines, test: (s, cls) => (onChannel(cls) ? String(s).match(re) : null) };
  } catch {
    return { ...row, ...extra, channel, lines, broken: true, test: () => null };
  }
}

// `@loot rest of the pattern` → { channel: 'loot', pattern: 'rest of the pattern' }
//
// `@` leads because it is not a regex metacharacter and effectively never starts
// a line of game prose — unlike `:`, which was the obvious separator and appears
// in half the room descriptions in the game ("You see: a rusted pipe").
export function splitChannel(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^@([a-z][a-z0-9-]*)\s*([\s\S]*)$/i);
  if (!m) return { channel: null, rest: s };
  return { channel: m[1].toLowerCase(), rest: m[2].trim() };
}

// `#combat rest of the pattern` → { group: 'combat', rest: '…' }
//
// A group is a switch over a SET of rows: `trigger off #combat` disables all of
// them at once and `trigger on #combat` brings them back. Without it the only
// units are one row and all rows, and anybody with twenty triggers wants the
// middle. `#` for the same reason `@` was chosen for channels — not a regex
// metacharacter, and it does not begin a line of prose.
//
// Prefixes may be combined and in either order: `@combat #fight /pattern/`.
export function splitGroup(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^#([a-z][a-z0-9-]*)\s*([\s\S]*)$/i);
  if (!m) return { group: null, rest: s };
  return { group: m[1].toLowerCase(), rest: m[2].trim() };
}

// Peel both prefixes off, whichever order they were written in.
export function splitPrefixes(raw) {
  let rest = String(raw || '').trim();
  let channel = null, group = null;
  for (let i = 0; i < 2; i++) {
    const c = splitChannel(rest);
    if (c.channel) { channel = c.channel; rest = c.rest; continue; }
    const g = splitGroup(rest);
    if (g.group) { group = g.group; rest = g.rest; continue; }
    break;
  }
  return { channel, group, rest };
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
