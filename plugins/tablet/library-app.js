// Tablet OS — Library app. Public-domain books, readable anywhere.
//
// The point of putting these on the tablet rather than in an item you carry is
// that a book is something you dip into in odd moments — waiting out a storm,
// sitting in a cell, riding a lift. Tie it to a physical object and it only ever
// gets read where you found it.
//
// The READS ALL LIVE IN plugins/library/books.js now — the library plugin owns
// its own data and this app is a view over it, the same way the Kit screen is a
// view over the engine's inventory commands. That move is what made `read`/`page`
// typeable at all (they were unreachable without a tablet). The read-tier rules,
// the `chapters->($2::int)` cast and the bookmark-key contract are documented
// there; nothing about this app's behaviour changed.
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { query } from '../../server/models/db.js';
import { shelf, bookMeta, chapter, chapterToc, bookmarkOf, bookmarks, BOOKMARK }
  from '../library/books.js';
import { registerTabletApp, normScreen } from './registry.js';

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

// ── Screens ─────────────────────────────────────────────────────────────────

async function buildHome(player) {
  const books = await shelf();
  return { count: books.length };
}

// The screens this app answers to. Anything else arriving as a screenId is not a
// screen at all — see the belt-and-braces in buildScreen.
const SCREENS = new Set(['read', 'contents', 'library']);

async function buildScreen(player, screenId, params) {
  const screen = normScreen(screenId);
  let arg = (params || '').trim();

  // Belt to the breadcrumb's braces. A book id can reach us in the SCREEN slot
  // rather than the params slot, depending on what the caller had in its
  // breadcrumb — and a book that opens or doesn't depending on which screen you
  // came from is the worst kind of bug to chase. If the screen isn't one of ours
  // and no params came with it, treat it as the book it plainly is. Uses the RAW
  // screenId, never the normalized one: normScreen turns underscores into spaces
  // and would mangle `book_the_machine_stops` into something no lookup matches.
  const raw = String(screenId || '').trim();
  if (raw && !arg && !SCREENS.has(screen)) arg = raw;

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

  // `contents <bookId> <chapterIndex>` — a tap on a contents entry. The client
  // resends the screen it is currently ON as the screen token and the tile's id as
  // params (see wireBody's data-open-item), so a chapter tapped from the contents
  // page arrives here as the CONTENTS screen carrying "<bookId> <idx>". Without
  // this it fell into the branch below and looked up a book called
  // "book_opium_eater 3" — "No such book." for every chapter in the shelf.
  if (screen === 'contents' && /\s\d+$/.test(arg)) {
    return buildScreen(player, 'read', arg);
  }

  // `contents <bookId>` — the chapter list, set as a table of contents: leaders
  // running out to a length, the bookmark called out, and everything before it
  // marked read. A plain list said "1. PART II" and nothing else.
  if (screen === 'contents' && arg) {
    const meta = await bookMeta(arg);
    if (!meta) return { view: 'error', message: 'No such book.' };
    const toc = await chapterToc(arg);
    const at = await bookmarkOf(player, arg);
    return {
      view: 'library',
      libKind: 'contents',
      breadcrumb: [meta.title, 'Contents'],
      book: { id: meta.id, title: meta.title, author: meta.author, year: meta.year },
      at,
      // `mins` is a reading estimate, not a word count — a chapter is a commitment
      // of time, and that's the number that decides whether you start it now.
      chapters: toc.map((c, i) => ({
        id: `${arg} ${i}`,
        title: c.title || `Chapter ${i + 1}`,
        mins: Math.max(1, Math.round((c.len || 0) / 5.6 / 220)),
      })),
    };
  }

  // A single book's cover page.
  if (arg) {
    const meta = await bookMeta(arg);
    if (!meta) return { view: 'error', message: 'No such book.' };
    const at = await bookmarkOf(player, arg);
    return {
      view: 'library',
      libKind: 'cover',
      breadcrumb: [meta.title],
      book: {
        id: meta.id, title: meta.title, author: meta.author, year: meta.year,
        blurb: meta.blurb, source: meta.source, chapters: meta.chapters, at,
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
  const marks = await bookmarks(player);
  return {
    view: 'library',
    libKind: 'shelf',
    // NOT empty, and that is load-bearing. The client builds a tile's nav from the
    // LAST BREADCRUMB entry (`currentScreen`, see wireBody), so an empty breadcrumb
    // sends `tabletnav library <bookId>` with no screen — the book id lands in
    // screenId, params arrives empty, no branch above matches, and the shelf
    // renders again. Tapping a book did nothing, and looked like a dead app.
    breadcrumb: ['Library'],
    books: books.map(b => ({ ...b, at: marks.get(b.id) || 0 })),
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
