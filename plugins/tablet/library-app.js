// Tablet OS — Library app. Public-domain books, readable anywhere.
//
// The point of putting these on the tablet rather than in an item you carry is
// that a book is something you dip into in odd moments — waiting out a storm,
// sitting in a cell, riding a lift. Tie it to a physical object and it only ever
// gets read where you found it.
//
// READ-TIER (docs/architecture.md) — this is the whole design constraint. These
// texts are hundreds of KB each; `We` alone is ~390KB. A deploy already
// cold-reloads the world from Neon at ~36MB and that cap has been hit before, so:
//
//   * `books` is registered readTier 'cold' and is NOT loaded at boot.
//   * The shelf/list screens read id/title/author/blurb ONLY — never `chapters`.
//     That's why the list query names its columns instead of SELECT *; a lazy
//     star here would drag a megabyte of prose into a screen that shows six lines.
//   * A page turn pulls ONE chapter, by index, out of the JSONB in Postgres
//     (`chapters->$2`) rather than fetching the array and slicing it in Node.
//
// Progress is a player_flag, not a new table (CLAUDE.md: no new sparse per-player
// columns/tables for scalar state). One flag holds the bookmark; owning a book is
// implied by having opened it, which keeps the shelf honest without a join.
import { query } from '../../server/models/db.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { registerTabletApp, normScreen } from './registry.js';

const BOOKMARK = (bookId) => `book_pos_${bookId}`;

// ── Reads ───────────────────────────────────────────────────────────────────

// Metadata only. jsonb_array_length reads the chapter COUNT without ever
// materialising the chapters themselves — the difference between a 2KB response
// and a 1MB one.
async function shelf() {
  const { rows } = await query(
    `SELECT id, title, author, year, blurb, jsonb_array_length(chapters) AS chapters
       FROM books ORDER BY year, title`
  );
  return rows;
}

async function bookMeta(bookId) {
  const { rows } = await query(
    `SELECT id, title, author, year, blurb, source, pronunciation,
            jsonb_array_length(chapters) AS chapters
       FROM books WHERE id=$1`, [bookId]
  );
  return rows[0] || null;
}

// One chapter, pulled by index inside Postgres.
async function chapter(bookId, idx) {
  // The ::int cast is load-bearing. A bound parameter arrives as text, and
  // `jsonb -> text` is a KEY lookup, not an array index — without the cast this
  // silently returns NULL for every chapter of every book.
  const { rows } = await query(
    `SELECT chapters->($2::int)->>'title' AS title, chapters->($2::int)->>'text' AS text
       FROM books WHERE id=$1`, [bookId, idx]
  );
  return rows[0]?.text ? rows[0] : null;
}

async function chapterTitles(bookId) {
  const { rows } = await query(
    `SELECT jsonb_path_query_array(chapters, '$[*].title') AS titles FROM books WHERE id=$1`,
    [bookId]
  );
  return rows[0]?.titles || [];
}

// ── Glossary ────────────────────────────────────────────────────────────────
// Small enough to hold in RAM (a few hundred one-line rows), unlike the books it
// annotates — so it loads once on the first reader page and every page turn
// after that is a pure in-memory scan with no query.
let _gloss = null;   // Map: lowercased term/alias -> { term, gloss }

async function loadGlossary() {
  if (_gloss) return _gloss;
  const m = new Map();
  try {
    const { rows } = await query('SELECT term, gloss, aliases FROM glossary');
    for (const r of rows) {
      m.set(r.term.toLowerCase(), { term: r.term, gloss: r.gloss });
      for (const a of (r.aliases || [])) m.set(String(a).toLowerCase(), { term: r.term, gloss: r.gloss });
    }
  } catch { /* table not applied yet — the reader just renders unglossed */ }
  _gloss = m;
  return m;
}

// Only the terms that actually occur in THIS chapter travel to the client. The
// full glossary is small, but sending 170 entries to gloss four words would be
// most of the payload — and the client has to scan for matches anyway, so it may
// as well scan a list that's already been narrowed.
async function glossFor(text) {
  const g = await loadGlossary();
  if (!g.size) return null;
  const out = {};
  // One pass over the chapter's own word set, rather than 170 passes over the
  // chapter — the chapter is the big thing here, so it gets read once.
  for (const w of new Set(String(text).toLowerCase().match(/[a-z][a-z'-]*/g) || [])) {
    const hit = g.get(w);
    if (hit) out[w] = hit.gloss;
  }
  return Object.keys(out).length ? out : null;
}

async function bookmarkOf(player, bookId) {
  const v = await getFlag('player', BOOKMARK(bookId), player);
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// ── Screens ─────────────────────────────────────────────────────────────────

async function buildHome(player) {
  const books = await shelf();
  return { count: books.length };
}

async function buildScreen(player, screenId, params) {
  const screen = normScreen(screenId);
  const arg = (params || '').trim();

  // `read <bookId> <chapterIndex>` — the page view.
  if (screen === 'read' && arg) {
    const [bookId, idxRaw] = arg.split(/\s+/);
    const meta = await bookMeta(bookId);
    if (!meta) return { view: 'error', message: 'No such book.' };
    const total = meta.chapters || 0;
    let idx = parseInt(idxRaw, 10);
    if (!Number.isFinite(idx)) idx = await bookmarkOf(player, bookId);
    idx = Math.max(0, Math.min(idx, total - 1));

    const ch = await chapter(bookId, idx);
    if (!ch) return { view: 'error', message: 'That page is missing.' };

    // Remember where they got to. One write per page turn — a player action, not
    // a tick, so this is nowhere near a hot path.
    await setFlag('player', BOOKMARK(bookId), String(idx), player);

    const actions = [];
    if (idx > 0) actions.push({ id: `prev:${bookId}:${idx}`, label: '‹ Back' });
    if (idx < total - 1) actions.push({ id: `next:${bookId}:${idx}`, label: 'Next ›' });
    actions.push({ id: `contents:${bookId}`, label: 'Contents' });

    return {
      view: 'detail',
      // Turns on the client's Read Aloud bar and makes it render the prose as
      // per-sentence spans so the narrator can highlight what it's speaking.
      // Only the READER sets this — a cover page or a contents list has nothing
      // worth narrating, and a Read Aloud button there would just be noise.
      narratable: true,
      // Archaic vocabulary occurring in THIS chapter, as { word: gloss }. The
      // books are never rewritten — modernising the prose would cost a 300k-word
      // rewrite and lose the voice that makes them worth shelving — so the text
      // stands as written and the reader annotates it instead.
      glossary: await glossFor(ch.text),
      // ARPAbet overrides for this book's proper nouns and loanwords — CMUDICT is
      // General American and mangles them otherwise. Tiny (a dozen entries), and
      // per-book so Candide's French can't leak into Forster.
      lex: meta.pronunciation && Object.keys(meta.pronunciation).length ? meta.pronunciation : null,
      breadcrumb: [meta.title, ch.title || `Chapter ${idx + 1}`],
      detail: {
        name: ch.title || `Chapter ${idx + 1}`,
        desc: `${meta.title} · ${meta.author} · ${idx + 1} of ${total}`,
        body: ch.text,
        rows: [],
      },
      actions,
    };
  }

  // `contents <bookId>` — the chapter list.
  if (screen === 'contents' && arg) {
    const meta = await bookMeta(arg);
    if (!meta) return { view: 'error', message: 'No such book.' };
    const titles = await chapterTitles(arg);
    const at = await bookmarkOf(player, arg);
    return {
      view: 'list',
      breadcrumb: [meta.title, 'Contents'],
      items: titles.map((t, i) => ({
        id: `${arg} ${i}`,
        label: `${i + 1}. ${t || `Chapter ${i + 1}`}`,
        sub: i === at ? 'Where you left off' : undefined,
      })),
    };
  }

  // A single book's cover page.
  if (arg) {
    const meta = await bookMeta(arg);
    if (!meta) return { view: 'error', message: 'No such book.' };
    const at = await bookmarkOf(player, arg);
    return {
      view: 'detail',
      breadcrumb: [meta.title],
      detail: {
        name: meta.title,
        desc: `${meta.author} · ${meta.year}`,
        body: meta.blurb,
        rows: [
          { label: 'Chapters', value: String(meta.chapters) },
          { label: 'Bookmark', value: at > 0 ? `Chapter ${at + 1}` : 'Not started' },
          { label: 'Provenance', value: meta.source || 'Unknown' },
        ],
      },
      actions: [
        { id: `read:${meta.id}`, label: at > 0 ? 'Continue' : 'Read' },
        { id: `contents:${meta.id}`, label: 'Contents' },
      ],
    };
  }

  const books = await shelf();
  if (!books.length) {
    return { view: 'error', message: 'The shelf is empty. Somebody burned everything again.' };
  }
  return {
    view: 'list',
    breadcrumb: [],
    items: books.map(b => ({
      id: b.id,
      label: b.title,
      sub: `${b.author} · ${b.year} · ${b.chapters} chapters`,
    })),
  };
}

async function handleAction(player, actionId, params) {
  const [verb, bookId, idxRaw] = String(actionId || '').split(':');
  const idx = parseInt(idxRaw, 10);

  if (verb === 'next') return buildScreen(player, 'read', `${bookId} ${idx + 1}`);
  if (verb === 'prev') return buildScreen(player, 'read', `${bookId} ${Math.max(0, idx - 1)}`);
  if (verb === 'contents') return buildScreen(player, 'contents', bookId);
  if (verb === 'read') return buildScreen(player, 'read', `${bookId}`);

  return buildScreen(player, null, params || '');
}

// The app stays off the home screen until the player has actually found the
// library and scanned something (plugins/library sets the flag at the terminal).
// A tablet that ships with a full public-domain bookshelf pre-installed tells you
// nothing; one that gains a Library app the moment an old man hands you a book is
// a thing that happened to you.
export const UNLOCK_FLAG = 'library_unlocked';

async function visible(player) {
  return !!(await getFlag('player', UNLOCK_FLAG, player));
}

registerTabletApp({
  id: 'library', name: 'Library', icon: '📖', category: 'Media',
  visible, buildHome, buildScreen, handleAction,
});
