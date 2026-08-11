// The books data layer — owned by the library plugin, read by two front ends:
// the tablet's LIBRARY app (plugins/tablet/library-app.js) and the `read`/`page`
// verbs in this plugin's index.js.
//
// It lives here rather than in the tablet app because the tablet is a VIEW. Until
// now every one of these reads was private to library-app.js, which is why there
// was no way to read a book by typing — the whole content set was reachable only
// by tapping. Moving the queries down here is what let the verbs exist at all;
// the app keeps calling the same functions and behaves identically.
//
// READ-TIER (docs/architecture.md) — the whole design constraint, unchanged:
//
//   * `books` is registered readTier 'cold' and is NOT loaded at boot. These texts
//     are hundreds of KB each (`We` alone is ~390KB) against a ~36MB cold-reload
//     budget that has been hit before.
//   * Shelf/list reads name their columns and never touch `chapters`. A lazy
//     SELECT * here drags a megabyte of prose into a screen showing six lines.
//   * A page turn pulls ONE chapter, by index, inside Postgres.
//
// Progress is a player_flag, not a table (CLAUDE.md: no new sparse per-player
// state). The bookmark key is shared by both front ends on purpose — put a book
// down on the tablet, pick it up by typing, and you're on the same chapter.
import { query } from '../../server/models/db.js';
import { getFlag, getFlagsByPrefix } from '../../server/engine/flags.js';

export const BOOKMARK = (bookId) => `book_pos_${bookId}`;

// Metadata only. jsonb_array_length reads the chapter COUNT without ever
// materialising the chapters themselves — the difference between a 2KB response
// and a 1MB one.
// `kind` is the shelf a title sits on. The two shelves are read by two different
// screens (the cloth-and-foil shelf and the longbox), so every list read takes it
// as an argument rather than returning everything and letting the caller filter —
// a comic that leaks onto the literature shelf is the exact bug this column
// exists to prevent, and filtering in Node is how it would happen.
export async function shelf(kind = 'book') {
  const { rows } = await query(
    `SELECT id, title, author, year, blurb, kind, jsonb_array_length(chapters) AS chapters
       FROM books WHERE kind=$1 ORDER BY year, title`, [kind]
  );
  return rows;
}

// The comics, in reading order. Same query, named separately because the callers
// read better for it and because the longbox may yet grow its own ordering (issue
// number within a series) that the shelf must not inherit.
export async function longbox() {
  return shelf('comic');
}

// Every title on both shelves. Used ONLY by the typed reader's matcher, which has
// to resolve `read sister steel` without the player having said which shelf it is
// on — the split is a presentation decision and typing is not a presentation.
export async function allTitles() {
  const { rows } = await query(
    `SELECT id, title, author, year, blurb, kind, jsonb_array_length(chapters) AS chapters
       FROM books ORDER BY year, title`
  );
  return rows;
}

export async function bookMeta(bookId) {
  const { rows } = await query(
    `SELECT id, title, author, year, blurb, source, pronunciation, kind,
            jsonb_array_length(chapters) AS chapters
       FROM books WHERE id=$1`, [bookId]
  );
  return rows[0] || null;
}

// One chapter, pulled by index inside Postgres.
export async function chapter(bookId, idx) {
  // The ::int cast is load-bearing. A bound parameter arrives as text, and
  // `jsonb -> text` is a KEY lookup, not an array index — without the cast this
  // silently returns NULL for every chapter of every book.
  const { rows } = await query(
    `SELECT chapters->($2::int)->>'title' AS title, chapters->($2::int)->>'text' AS text
       FROM books WHERE id=$1`, [bookId, idx]
  );
  return rows[0]?.text ? rows[0] : null;
}

// The table of contents: title + LENGTH of each chapter, never the prose. The
// length is measured inside Postgres and only the integer travels, so a contents
// page for `We` costs a couple of KB rather than 390.
//
// Built with WITH ORDINALITY rather than jsonb_path_query_array($[*].title): a path
// query SKIPS any element missing the key, so one untitled chapter would silently
// shorten the array and shift every index after it — the contents page would then
// send you to the wrong chapter with nothing to indicate it had.
export async function chapterToc(bookId) {
  const { rows } = await query(
    `SELECT COALESCE((
       SELECT jsonb_agg(jsonb_build_object('title', c->>'title', 'len', length(c->>'text')) ORDER BY i)
         FROM jsonb_array_elements(chapters) WITH ORDINALITY AS t(c, i)
     ), '[]'::jsonb) AS toc
       FROM books WHERE id=$1`,
    [bookId]
  );
  return rows[0]?.toc || [];
}

export async function bookmarkOf(player, bookId) {
  const v = await getFlag('player', BOOKMARK(bookId), player);
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// Every bookmark in one read — one prefix scan, and zero round trips for a
// hydrated player, which is what makes a shelf that shows progress on all eight
// spines cost the same as one that shows none.
export async function bookmarks(player) {
  const m = await getFlagsByPrefix(player, 'book_pos_');
  const out = new Map();
  for (const [k, v] of m) {
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n >= 0) out.set(k.slice('book_pos_'.length), n);
  }
  return out;
}

// Resolve what somebody typed to a book on the shelf. Id first (that's what the
// tablet's own buttons pass), then an exact title, then a leading-word match, then
// anything containing it — so `read machine stops` and `read we` both land, and
// `read the` matches nothing rather than the first book on the shelf.
//
// Returns undefined for no match, which is what lets `read` stay a well-behaved
// specialized action: a `read charge sheet` in a jail cell must fall THROUGH to
// the jail plugin, not be swallowed by a library that half-recognised it.
export function matchBook(books, raw) {
  const q = String(raw || '').trim().toLowerCase();
  if (!q) return undefined;
  const norm = s => String(s || '').toLowerCase();
  const bare = s => s.replace(/^(the|a|an)\s+/, '');

  // Exact forms always win, and only they may be short — `We` is a real title and
  // has to open on two letters.
  const exact = books.find(b => norm(b.id) === q)
    || books.find(b => norm(b.title) === q)
    || books.find(b => bare(norm(b.title)) === bare(q));
  if (exact) return exact;

  // Everything below is a GUESS, so it needs enough to go on. Four characters is
  // the floor for both, and the article is stripped before measuring: without
  // that, `read the` is three letters of pure stop-word that happily prefix-match
  // "The Machine Stops" and open a novel instead of the charge sheet the player
  // was reaching for. A guess this cheap must lose to the other `read` handlers.
  const q2 = bare(q);
  if (q2.length < 4) return undefined;
  return books.find(b => bare(norm(b.title)).startsWith(q2))
    || books.find(b => bare(norm(b.title)).includes(q2));
}

// ── The comic markup ─────────────────────────────────────────────────────────
// A comic chapter is prose with four kinds of paragraph in it, marked at the head
// of the paragraph. The markers are deliberately the smallest thing that could
// work, and there is exactly ONE parser for them, here, because there are three
// consumers: the tablet's comic reader (which draws furniture), the typed reader
// (which must show none of it), and Read Aloud (which must speak the words and
// none of the marks).
//
//   > line      caption box — the narrator's own voice, boxed
//   NAME: line  a balloon, one speaker, consecutive lines are one exchange
//   ~SOUND~     lettering, sitting in the gutter at size
//   ---         a page turn: air above and below
//   anything    the panel itself, as prose
//
// The old files were panel SCRIPTS ("PANEL ONE. A door.") plus a critic talking
// over the top of them. This format carries the same three registers minus the
// stage directions and minus the critic — see docs/systems-library.md.
const SFX_RE = /^~(.+)~$/;

export function comicBlocks(text) {
  const out = [];
  for (const para of String(text || '').split(/\n\s*\n/)) {
    const p = para.trim();
    if (!p) continue;
    if (/^-{3,}$/.test(p)) { out.push({ kind: 'turn' }); continue; }
    const sfx = p.match(SFX_RE);
    if (sfx) { out.push({ kind: 'sfx', text: sfx[1].trim() }); continue; }
    if (p.startsWith('>')) {
      // A caption may run to several lines; they are one box, not three.
      out.push({ kind: 'caption', text: p.split('\n').map(l => l.replace(/^>\s?/, '').trim()).join(' ') });
      continue;
    }
    // Balloons. Each LINE is its own balloon so an exchange alternates, but they
    // arrive as one paragraph so the renderer can group them into one beat.
    const lines = p.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.every(l => /^[A-Z][A-Z .'’-]{1,28}:\s/.test(l))) {
      out.push({
        kind: 'balloons',
        lines: lines.map(l => {
          const i = l.indexOf(':');
          return { speaker: l.slice(0, i).trim(), text: l.slice(i + 1).trim() };
        }),
      });
      continue;
    }
    out.push({ kind: 'panel', text: p.replace(/\n/g, ' ') });
  }
  return out;
}

// The same chapter with every mark removed, for the log and for anything generic
// that gets handed a body. A speaker keeps their name (that is dialogue, not
// markup); a caption and a sound effect simply become their own words.
export function comicPlain(text) {
  return comicBlocks(text).map(b => {
    if (b.kind === 'turn') return '· · ·';
    if (b.kind === 'balloons') return b.lines.map(l => `${l.speaker}: ${l.text}`).join('\n');
    return b.text;
  }).join('\n\n');
}

// ── Pagination, for the typed reader only ────────────────────────────────────
// The tablet scrolls a whole chapter in a panel; the log can't. A chapter here is
// a real novel chapter, so printing one would be thousands of words in one push —
// past the point where a scrollback is usable and, for a screen reader, an
// unstoppable wall. So the typed reader serves a PAGE.
//
// Split on blank lines and fill up to PAGE_CHARS, never breaking a paragraph:
// prose is not a fixed-width medium and a page that ends mid-sentence reads as a
// bug. A single paragraph longer than the budget is its own page rather than
// being cut — better one long page than a sentence sawn in half.
export const PAGE_CHARS = 1400;

export function paginate(text) {
  const paras = String(text || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const pages = [];
  let cur = [];
  let len = 0;
  for (const p of paras) {
    if (cur.length && len + p.length > PAGE_CHARS) { pages.push(cur); cur = []; len = 0; }
    cur.push(p);
    len += p.length;
  }
  if (cur.length) pages.push(cur);
  return pages.length ? pages : [['(This page is blank.)']];
}
