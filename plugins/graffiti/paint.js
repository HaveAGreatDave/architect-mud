/**
 * Graffiti paint — the per-letter style model, and the only thing that turns it
 * into HTML.
 *
 * The rule that shapes this whole file: STYLE IS DATA, NEVER MARKUP. A player's
 * tag lands in a stranger's room description, which the client renders as HTML,
 * so the tag text keeps its existing contract exactly — escaped on the way in,
 * stored escaped (index.js `esc`). Colour and weight ride ALONGSIDE it as a list
 * of runs, and a run can only ever hold a validated `#rrggbb` and a four-bit
 * flag. There is no markup to parse, so there is no markup to get wrong: the
 * worst a hostile payload can do is ask for a colour that isn't a colour, and
 * that run is simply dropped.
 *
 * Runs, not per-character entries, because "the whole thing in acid green" is
 * the common case and it should cost one object rather than forty-eight. They
 * are stored as JSONB and are the same shape on a wall and in a saved spray.
 *
 * The index trap, and why the renderer looks the way it does: `esc` changes the
 * LENGTH of the string ('<' becomes '&lt;'), but a run counts CHARACTERS THE
 * PLAYER TYPED. So the renderer never indexes the escaped string — it splits it
 * back into one unit per original character (an entity counts as one), which is
 * the same trick the chat rainbow uses in client/game/js/markup.js.
 */

export const F_BOLD = 1;
export const F_ITALIC = 2;
export const F_UNDER = 4;
export const F_STRIKE = 8;
export const F_MASK = F_BOLD | F_ITALIC | F_UNDER | F_STRIKE;

// A run per character is the worst case and it's already the cap on the text
// itself, so anything longer is a malformed payload rather than an ambitious tag.
const MAX_RUNS = 64;

const HEX = /^#[0-9a-f]{6}$/i;

/** A colour, or null. The only gate between a payload and a style attribute. */
export function safeColor(raw) {
  const c = String(raw ?? '').trim().toLowerCase();
  return HEX.test(c) ? c : null;
}

/**
 * Coerce whatever arrived into runs that describe exactly `len` characters.
 *
 * Short runs are padded with an unstyled tail and long ones are clipped, so the
 * renderer never has to think about a mismatch — a run list can always be walked
 * straight down the string. Returns [] when nothing is actually styled, which is
 * the signal to render the plain path (and to store no style at all).
 */
export function normalizeRuns(raw, len) {
  const out = [];
  let used = 0;
  if (Array.isArray(raw)) {
    for (const r of raw.slice(0, MAX_RUNS)) {
      if (used >= len) break;
      const n = Math.min(Math.max(1, Math.floor(Number(r?.n) || 0)), len - used);
      if (!n) continue;
      out.push({ n, c: safeColor(r?.c), f: (Math.floor(Number(r?.f) || 0) & F_MASK) });
      used += n;
    }
  }
  if (used < len) out.push({ n: len - used, c: null, f: 0 });
  return out.some(r => r.c || r.f) ? out : [];
}

/** Merge neighbouring runs that look identical — a tidy-up, not a correctness fix. */
export function coalesceRuns(runs) {
  const out = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && last.c === r.c && last.f === r.f) last.n += r.n;
    else out.push({ ...r });
  }
  return out;
}

/**
 * Split an ALREADY-ESCAPED string into one unit per original character, so a run
 * index means what the player meant by it. `esc` only ever emits &amp; &lt; &gt;,
 * but the pattern accepts any entity so a future escape can't silently break the
 * alignment and start slicing entities in half.
 */
export function escapedChars(escapedText) {
  return String(escapedText ?? '').match(/&[a-z]+;|&#\d+;|[\s\S]/gi) || [];
}

const OPEN = [
  [F_BOLD, '<b>', '</b>'],
  [F_ITALIC, '<i>', '</i>'],
  [F_UNDER, '<u>', '</u>'],
  [F_STRIKE, '<s>', '</s>'],
];

/**
 * Escaped text + runs → HTML. Sync, allocation-light, and called from the
 * room-description path, which runs on every `look` in the game.
 *
 * With no runs it returns the escaped text untouched — so an unstyled tag costs
 * exactly what it cost before any of this existed.
 */
export function renderStyled(escapedText, runs) {
  const list = Array.isArray(runs) ? runs : [];
  if (!list.length) return String(escapedText ?? '');
  const chars = escapedChars(escapedText);
  let i = 0, html = '';
  for (const r of coalesceRuns(list)) {
    const slice = chars.slice(i, i + r.n).join('');
    i += r.n;
    if (!slice) continue;
    let piece = slice;
    for (const [bit, open, close] of OPEN) if (r.f & bit) piece = open + piece + close;
    html += r.c ? `<span style="color:${r.c}">${piece}</span>` : piece;
  }
  if (i < chars.length) html += chars.slice(i).join('');   // belt and braces
  return html;
}

/**
 * The wire format between the spray-can dialog and the verb: base64 of
 * `{ t: <text the player typed>, r: <runs> }`.
 *
 * Base64 because a command is a single whitespace-split STRING and a tag is
 * allowed spaces, quotes and punctuation; anything hand-rolled would need an
 * escape convention of its own, which is the exact class of bug this system is
 * built to avoid. Returns null on anything malformed — a broken payload is not
 * a half-applied tag.
 */
export function decodePayload(b64) {
  try {
    const json = Buffer.from(String(b64 || ''), 'base64').toString('utf8');
    const obj = JSON.parse(json);
    if (!obj || typeof obj !== 'object') return null;
    // Control characters and newlines out: a tag is one line on a wall.
    const text = String(obj.t ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim();
    if (!text) return null;
    const name = String(obj.n ?? '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 24);
    return { text, runs: Array.isArray(obj.r) ? obj.r : [], name };
  } catch { return null; }
}
