// WANTED POSTER — the one builder. Everything that shows a bounty anywhere in
// the game comes out of this file: the board, the `bounty` verb, the tablet app
// and the client panel all render THE SAME `buildPoster()` object.
//
// THE RULE THIS MODULE EXISTS TO ENFORCE: the poster is TEXT, and the panel is a
// skin over it. Not "the panel is the poster and the log gets a summary" — that
// is how a system ends up with a `log`-rung player who cannot read the thing the
// whole feature is about. `posterLines()` is the record; `poster.js` on the
// client draws the same lines on paper. If they ever disagree, the text wins.
// (docs/systems-display-mode.md, "Suppress, or re-render?" — this is the
// SUPPRESS shape, because the record always reaches the log.)
//
// The second rule, borrowed wholesale from plugins/cards/builder.js: WE NEVER
// TRUNCATE. A region emits whole clauses in priority order and stops at the
// first one that would cross its budget. A poster is a printed object; a printed
// object does not end mid-word with an ellipsis where the reason used to be.

// Character budgets, per region. A real sheet is a fixed size and the printer
// does not get to make it bigger because the crime was interesting.
export const BUDGET = { handle: 20, note: 120, marks: 74, epithet: 28 };

// Poster width in characters. 46 is the widest that still wraps inside the
// smartbar-narrowed log on a phone without the frame going ragged, which is the
// constraint that actually decides it — a frame that breaks is worse than a
// narrow one.
export const WIDTH = 46;

// ── the reward, spoken as well as printed ─────────────────────────────────────
// WCAG 1.4.1 in spirit rather than letter: the size of a bounty must not be
// carried by type size or colour alone. Every poster prints the numeral AND a
// band word, so "₵12,000" and "a fortune" arrive together and a player who
// cannot see the big red number still knows this is the dangerous one.
const BANDS = [
  [50_000, 'a fortune'],
  [20_000, 'life-changing'],
  [8_000, 'serious money'],
  [3_000, 'worth the trouble'],
  [1_000, 'worth a look'],
  [0, 'pocket change'],
];
export function rewardBand(amount) {
  const n = Number(amount) || 0;
  for (const [floor, word] of BANDS) if (n >= floor) return word;
  return 'pocket change';
}

export const money = (n) => '₵' + Number(n || 0).toLocaleString('en-US');

// ── how long is left, in words ────────────────────────────────────────────────
// Always relative and always coarse. A poster nailed to a wall does not have a
// second hand on it, and "expires in 4d 02:11:57" invites people to camp the
// last minute rather than to go and do something about it.
export function timeLeft(expiresAt, now = Date.now()) {
  const ms = Number(expiresAt) - now;
  if (ms <= 0) return 'expired';
  const days = ms / 86_400_000;
  if (days >= 2) return `${Math.floor(days)} days left`;
  const hours = ms / 3_600_000;
  if (hours >= 2) return `${Math.floor(hours)} hours left`;
  const mins = Math.ceil(ms / 60_000);
  return mins <= 1 ? 'minutes left' : `${mins} minutes left`;
}

// ── the charge line ───────────────────────────────────────────────────────────
// A bounty has no legal basis whatsoever, so the sheet cannot print a crime. It
// prints what the backer WROTE, and when the backer wrote nothing it prints the
// house's own boilerplate — which is deliberately incurious, because the whole
// business model is not asking.
const NO_REASON = [
  'NO REASON GIVEN. NONE REQUIRED.',
  'THE PARTY CONCERNED DECLINED TO ELABORATE.',
  'REASON WITHHELD AT THE REQUEST OF THE PAYING PARTY.',
  'FILED WITHOUT COMMENT.',
];
// Keyed off the id rather than rolled, so re-reading the same poster does not
// quietly reprint itself with a different reason every time you look at it.
export function chargeLine(bounty) {
  const note = String(bounty.note || '').trim();
  if (note) return whole(note.toUpperCase(), BUDGET.note) || NO_REASON[0];
  let h = 0;
  const id = String(bounty.id || '');
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return NO_REASON[h % NO_REASON.length];
}

// Whole words from the start, never a cut one — the cards rule, applied to a
// single clause instead of a sentence ladder.
function whole(text, budget) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  if (t.length <= budget) return t;
  const cut = t.slice(0, budget + 1);
  const at = cut.lastIndexOf(' ');
  return at > 0 ? t.slice(0, at) : '';
}

// ── the sheet ─────────────────────────────────────────────────────────────────
// Nailed up, so it is drawn with the nail holes in it. Nothing here is decided
// by the client.
//
// `viewer` is optional and changes exactly two things: whether the backer is
// named (they paid to be anonymous, and the target may have paid to know), and
// whether the sheet carries the "this is you" banner. It never changes the
// reward, the deadline or the terms — a poster two people read differently
// about the MONEY would be a poster nobody could trust.
export function buildPoster(bounty, { viewer = null, unmaskedFor = null } = {}) {
  const amount = Number(bounty.amount) || 0;
  const isTarget = viewer && String(viewer) === String(bounty.target_id);
  const isBacker = viewer && String(viewer) === String(bounty.backer_id);
  const unmasked = isBacker
    || (unmaskedFor != null ? !!unmaskedFor : listOf(bounty.unmasked_by).includes(String(viewer)));

  return {
    id: bounty.id,
    target: whole(bounty.target_handle, BUDGET.handle) || bounty.target_handle,
    targetId: bounty.target_id,
    amount,
    reward: money(amount),
    band: rewardBand(amount),
    charge: chargeLine(bounty),
    // The backer is a NAME or the word the house uses instead of one. Never null
    // and never an empty string, because every consumer would then invent its own
    // placeholder and they would not match.
    // Sized to fit the sheet's POSTED BY row whole. A placeholder long enough to
    // be truncated there would be the one region on the poster that visibly
    // breaks the never-cut rule, on every single sheet, forever.
    backer: unmasked ? bounty.backer_handle : 'A PARTY WHO PAID NOT TO SIGN',
    backerKnown: !!unmasked,
    status: bounty.status || 'open',
    expiresAt: Number(bounty.expires_at) || 0,
    deadline: timeLeft(bounty.expires_at),
    postedAt: Number(bounty.posted_at) || 0,
    isTarget: !!isTarget,
    isBacker: !!isBacker,
    claimedBy: bounty.claimed_handle || null,
  };
}

export function listOf(v) {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') { try { return listOf(JSON.parse(v)); } catch { return []; } }
  return [];
}

// ── the sheet, as characters ──────────────────────────────────────────────────
// Deliberately monospace-framed rather than styled with markup: this is the
// version that goes in the log, gets read aloud, and gets pasted into chat. The
// frame survives all three. The client panel re-draws it on paper; it does not
// re-word it.
//
// ⚠ Every line is padded to WIDTH so the right-hand rule stays vertical in a
// proportional typeface too — a player on the Accessibility page's `readable`
// font gets a slightly wobbly frame instead of a shredded one.
export function posterLines(p) {
  const rule = '─'.repeat(WIDTH - 2);
  const out = [];
  const row = (s = '') => out.push('│' + pad(s, WIDTH - 2) + '│');
  const mid = (s = '') => out.push('│' + centre(s, WIDTH - 2) + '│');

  out.push('┌' + rule + '┐');
  mid('✱   W A N T E D   ✱');
  mid('BY PRIVATE CONTRACT');
  out.push('├' + rule + '┤');
  mid(p.target.toUpperCase());
  mid('— ALIVE IS NOT REQUIRED —');
  out.push('├' + rule + '┤');
  mid(`REWARD  ${p.reward}`);
  mid(`(${p.band})`);
  out.push('├' + rule + '┤');
  for (const l of wrap(p.charge, WIDTH - 4)) row(' ' + l);
  out.push('├' + rule + '┤');
  row(` POSTED BY  ${trim(p.backer, WIDTH - 15)}`);
  row(` TERMS      head in hand, at a board`);
  row(` CLOSES     ${p.deadline}`);
  if (p.status !== 'open') {
    out.push('├' + rule + '┤');
    mid(p.status === 'claimed'
      ? `▓▓ COLLECTED${p.claimedBy ? ' BY ' + p.claimedBy.toUpperCase() : ''} ▓▓`
      : `▓▓ ${p.status.toUpperCase()} ▓▓`);
  }
  out.push('└' + rule + '┘');
  return out;
}

// One condensed row for a list of many. The board can hold a dozen sheets and
// twelve full posters is not a board, it is a wall — so a list prints rows and
// a single poster prints the sheet.
export function posterRow(p) {
  const mark = p.isTarget ? '►' : ' ';   // NOT colour alone: a glyph as well
  return `${mark} ${trim(p.target, 18).padEnd(18)} ${p.reward.padStart(10)}  ${p.deadline}`;
}

const trim = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const pad = (s, n) => trim(s, n).padEnd(n);
function centre(s, n) {
  const t = trim(s, n);
  const left = Math.max(0, Math.floor((n - t.length) / 2));
  return ' '.repeat(left) + t + ' '.repeat(Math.max(0, n - left - t.length));
}
function wrap(text, n) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if (cur.length + 1 + w.length > n) { lines.push(cur); cur = w; } else cur += ' ' + w;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

// The whole sheet as one log-safe block. `<pre>`-free on purpose: the log's own
// markup pipeline handles newlines, and a <pre> would opt out of the type scale
// (docs/systems-display-mode.md — every font-size in the client is rem now, and
// a poster nobody can enlarge is a poster for people who did not need help).
export function posterBlock(p) {
  return `<span class="wanted-sheet">${posterLines(p).map(escHtml).join('\n')}</span>`;
}

// Full HTML escape, not escAttr. escAttr covers & and " (it exists for attribute
// interpolation) and leaves `<` alone — fine in an attribute, and an injection
// point in body text. A handle is player-supplied and lands in both.
export function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
