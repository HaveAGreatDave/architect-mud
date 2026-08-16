// Speedwalk — `3n2e` is north north north east east.
//
// Pure and import-free so the smoke can cover it, because the whole feature is
// one judgement call and getting it wrong eats a real verb.
//
// ⚠ THE TRAP: THE OBVIOUS TEST MATCHES `use`.
//
// The natural rule is "the whole line is only direction letters and digits". The
// direction letters are n s e w u d — and `use` is spelled entirely from that
// set. So is `sew`, `wed`, `dune`, `sun`, `dens`. A naive speedwalk expander
// silently turns `use` into up-south-east and the player has no idea why their
// command stopped working.
//
// The fix is that A SPEEDWALK MUST CONTAIN AT LEAST ONE DIGIT. `3n` walks, `nnn`
// does not, and `use` is left alone because it has no number in it. Losing the
// digitless form is a real cost and the right trade: `nnn` is three keystrokes
// either way, and `use` is a verb people type constantly.
//
// Note this is a much smaller feature here than in a client without a map.
// Architect has GPS routing and auto-walk, which solve "get me there" properly;
// this only covers a route you already know and want to type.

// Two-letter directions must be tried before one-letter ones, or `ne` reads as
// `n` followed by a stranded `e`.
const DIRS = ['ne', 'nw', 'se', 'sw', 'n', 's', 'e', 'w', 'u', 'd'];

const LONG = {
  n: 'north', s: 'south', e: 'east', w: 'west', u: 'up', d: 'down',
  ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
};

// A cap on the expansion, not on the syntax. `99n` is almost always a typo, and
// the honest response to a typo is to do nothing rather than to walk somebody
// across the map. Refusing means the line falls through to the server, which
// answers `Unknown command` — visible, and undoable.
const MAX_STEPS = 40;

/**
 * Expand a speedwalk into a `;`-joined command chain, or return null when the
 * line is not one. Null is the common case and must stay cheap.
 *
 * @param {string} line
 * @returns {string|null}
 */
export function expandSpeedwalk(line) {
  const s = String(line || '').trim().toLowerCase();
  if (!s || /\s/.test(s)) return null;       // speedwalks are one word
  if (!/[0-9]/.test(s)) return null;         // ⚠ the `use` guard — see the header
  if (!/^[0-9nsewud]+$/.test(s)) return null;

  const out = [];
  let i = 0;
  while (i < s.length) {
    // Leading count, defaulting to 1 (`3n2e` and `3ne` both parse).
    let digits = '';
    while (i < s.length && s[i] >= '0' && s[i] <= '9') { digits += s[i]; i++; }
    const count = digits === '' ? 1 : Number(digits);
    // A zero count is meaningless and almost certainly a typo for something else.
    if (digits !== '' && count === 0) return null;
    const dir = DIRS.find(d => s.startsWith(d, i));
    if (!dir) return null;                   // a digit with no direction after it
    i += dir.length;
    if (out.length + count > MAX_STEPS) return null;
    for (let k = 0; k < count; k++) out.push(LONG[dir]);
  }
  if (!out.length) return null;
  return out.join(';');
}
