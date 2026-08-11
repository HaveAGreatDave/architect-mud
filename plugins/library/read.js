// The typed reader — `library`, `read`, `page`, `chapter`, `contents`.
//
// Until this existed, every book in the game was reachable only by tapping the
// tablet's LIBRARY app: `plugins/library/index.js` exported no commands at all, so
// a player who couldn't or didn't use the tablet had no way to read a word. The
// books were never the problem — the app was simply the only door.
//
// This is the second door, and it is the same room: both front ends call
// books.js, and both keep the bookmark in the SAME `book_pos_<id>` flag. Put a
// book down on the tablet, pick it up by typing, and you are on the page you
// stopped at. That shared key is the whole point — two readers over one shelf,
// not two libraries.
//
// What's different is pagination. The tablet scrolls a chapter inside a panel; the
// log can't, and a novel chapter pushed to the scrollback in one go is thousands
// of words nobody can navigate (and, for a screen reader, an unstoppable wall). So
// the typed reader serves a PAGE at a time and remembers which one, in
// `book_page_<id>`. That flag is this reader's alone: the tablet has no concept of
// a page, and teaching it one would mean the two readers disagreeing about where
// you are inside a chapter.
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { shelf, longbox, allTitles, bookMeta, chapter, chapterToc, bookmarkOf,
  bookmarks, matchBook, paginate, comicPlain, BOOKMARK } from './books.js';

export const UNLOCK_FLAG = 'library_unlocked';
const READING = 'book_reading';                       // which book the verbs act on
const PAGE_AT = (bookId) => `book_page_${bookId}`;    // page within the current chapter

const unlocked = async (player) => !!(await getFlag('player', UNLOCK_FLAG, player));

const link = (cmd, label) =>
  `<span class="action-link" data-action="cmd" data-cmd="${cmd}">${label || cmd}</span>`;

const locked = {
  type: 'error',
  message: "You don't have anything to read on. The Hall of Records lends — find their terminal and <b>scan</b> it.",
};

// ── State ────────────────────────────────────────────────────────────────────

async function currentBook(player) {
  const id = await getFlag('player', READING, player);
  return id ? bookMeta(String(id)) : null;
}

async function pageAt(player, bookId) {
  const n = parseInt(await getFlag('player', PAGE_AT(bookId), player), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// Pagination has to be asked the same question everywhere, or `page` walks off
// the end of a chapter the renderer thinks is longer. Every caller goes through
// here so the comic strip happens exactly once.
function pagesOf(meta, ch) {
  return paginate(meta?.kind === 'comic' ? comicPlain(ch?.text || '') : (ch?.text || ''));
}

// One place that opens a book AT a chapter and page, so `read`, `page` and
// `chapter` can't drift on what "where you are" means. Clamps rather than errors:
// a bookmark can outlive an edited book, and being bounced to the last real page
// beats "that page is missing" on a book you were halfway through.
async function renderPage(player, meta, chIdx, pgIdx) {
  const total = meta.chapters || 0;
  const ci = Math.max(0, Math.min(chIdx, total - 1));
  const ch = await chapter(meta.id, ci);
  if (!ch) return { type: 'error', message: 'That page is missing.' };

  // The markers are furniture for a screen that can draw furniture; the log
  // can't, and a caption arriving as "> I do not go away" is markup leaking into
  // prose. pagesOf strips it, and every caller goes through pagesOf.
  const pages = pagesOf(meta, ch);
  const pi = Math.max(0, Math.min(pgIdx, pages.length - 1));

  await setFlag('player', READING, meta.id, player);
  await setFlag('player', BOOKMARK(meta.id), String(ci), player);
  await setFlag('player', PAGE_AT(meta.id), String(pi), player);

  const chTitle = ch.title || `Chapter ${ci + 1}`;
  const head = `<span class="text-cyan">${meta.title}</span> <span class="text-dim">— ${chTitle}`
    + ` · page ${pi + 1} of ${pages.length}`
    + (total > 1 ? ` · chapter ${ci + 1} of ${total}` : '') + `</span>`;

  // The prose, paragraph-spaced. Deliberately unstyled: these texts are not
  // rewritten (see systems-library.md) and the log should not be either.
  const body = pages[pi].join('\n\n');

  // Where you can go from here, as ordinary verbs the player could have typed —
  // and the last page of the last chapter offers nothing but the shelf, which is
  // how finishing a book feels like finishing it.
  const nav = [];
  const lastPage = pi >= pages.length - 1;
  const lastChapter = ci >= total - 1;
  if (!lastPage || !lastChapter) nav.push(link('page', 'page ›'));
  if (pi > 0 || ci > 0) nav.push(link('page back', '‹ back'));
  if (total > 1) nav.push(link('contents', 'contents'));
  nav.push(link('library', 'shelf'));

  const foot = lastPage && lastChapter
    ? `<span class="ambient">You have reached the end of ${meta.title}.</span>\n${nav.join(' <span class="text-dim">·</span> ')}`
    : nav.join(' <span class="text-dim">·</span> ');

  return { type: 'output', message: `${head}\n\n${body}\n\n${foot}` };
}

// ── library / books — the shelf ──────────────────────────────────────────────

export async function cmdLibrary(args, raw, player) {
  if (!await unlocked(player)) return locked;
  const books = await shelf();
  if (!books.length) {
    return { type: 'output', message: 'The shelf is empty. Somebody burned everything again.' };
  }
  const marks = await bookmarks(player);
  const reading = await getFlag('player', READING, player);

  const lines = books.map(b => {
    const at = marks.get(b.id) || 0;
    // Progress in chapters, not a percentage: a percentage of a book you haven't
    // read is a number about the book, not about you.
    const where = at > 0
      ? `<span class="text-dim"> — chapter ${at + 1} of ${b.chapters}</span>`
      : '';
    const mark = String(reading) === b.id ? '<span class="text-cyan">▸</span> ' : '  ';
    return `${mark}${link(`read ${b.title}`, b.title)} <span class="text-dim">· ${b.author}, ${b.year}</span>${where}`;
  });

  return {
    type: 'output',
    message: [
      `<span class="text-cyan">THE SHELF</span> <span class="text-dim">(${books.length} titles)</span>`,
      ...lines,
      `<span class="text-dim">${link('read <title>', 'read &lt;title&gt;')} to open one · ${link('page', 'page')} turns the page · ${link('longbox', 'longbox')} for the comics</span>`,
    ].join('\n'),
  };
}

// ── longbox — the other shelf ────────────────────────────────────────────────
// The comics come off the main list entirely rather than sitting at the bottom
// of it under a heading. Two listings is the honest shape: they are read
// differently, they are bought differently, and a player looking for Sister
// Steel is not browsing literature. `read <title>` still crosses the split, so
// nothing is harder to reach for having been separated.
export async function cmdLongbox(args, raw, player) {
  if (!await unlocked(player)) return locked;
  const comics = await longbox();
  if (!comics.length) {
    return { type: 'output', message: 'The longbox is empty. Sloat will be furious.' };
  }
  const marks = await bookmarks(player);
  const reading = await getFlag('player', READING, player);

  const lines = comics.map(b => {
    const at = marks.get(b.id) || 0;
    const where = at > 0 && b.chapters > 1
      ? `<span class="text-dim"> — part ${at + 1} of ${b.chapters}</span>`
      : (at > 0 ? '<span class="text-dim"> — started</span>' : '');
    const mark = String(reading) === b.id ? '<span class="text-cyan">▸</span> ' : '  ';
    return `${mark}${link(`read ${b.title}`, b.title)} <span class="text-dim">· ${b.author}, ${b.year}</span>${where}`;
  });

  return {
    type: 'output',
    message: [
      `<span class="text-cyan">THE LONGBOX</span> <span class="text-dim">(${comics.length} issue${comics.length === 1 ? '' : 's'})</span>`,
      ...lines,
      `<span class="text-dim">${link('read <title>', 'read &lt;title&gt;')} to open one · ${link('library', 'library')} for the books</span>`,
    ].join('\n'),
  };
}

// ── read <book> — a specialized action, self-gating ──────────────────────────
// `read` is shared with the bulletin board, the charge sheet, the job board, a
// recipe card and the prologue's notes, all of which self-gate the same way. So
// this must return undefined for anything that isn't plainly a book on the shelf,
// or `read charge sheet` in a cell would be swallowed by a library that half
// recognised the word. Locked players fall through too — before you have scanned
// a terminal the feature does not exist for you, which is also why the app is
// hidden rather than greyed out.
export async function cmdRead(args, raw, player) {
  const arg = (args || []).join(' ').trim();
  if (!arg) return undefined;                       // bare `read` belongs to somebody else
  if (!await unlocked(player)) return undefined;

  // BOTH shelves. The longbox is a presentation split, and typing is not a
  // presentation: `read sister steel` must work without the player first knowing
  // that Sister Steel is filed as a comic.
  const books = await allTitles();
  const hit = matchBook(books, arg);
  if (!hit) return undefined;

  const meta = await bookMeta(hit.id);
  const at = await bookmarkOf(player, hit.id);
  const pg = await pageAt(player, hit.id);
  // Continuing mid-chapter is the default; the flags remember both halves.
  return renderPage(player, meta, at, pg);
}

// ── page [next|back|<n>] ─────────────────────────────────────────────────────

export async function cmdPage(args, raw, player) {
  if (!await unlocked(player)) return locked;
  const meta = await currentBook(player);
  if (!meta) {
    return { type: 'error', message: `You have no book open. ${link('library', 'library')} shows the shelf.` };
  }

  const a = (args[0] || 'next').toLowerCase();
  const ci = await bookmarkOf(player, meta.id);
  const pi = await pageAt(player, meta.id);
  const ch = await chapter(meta.id, ci);
  const pages = pagesOf(meta, ch);

  const explicit = parseInt(a, 10);
  if (Number.isFinite(explicit)) return renderPage(player, meta, ci, explicit - 1);

  if (a === 'back' || a === 'prev' || a === 'previous') {
    // Walking back off the top of a chapter lands on the LAST page of the one
    // before, not its first — going back should undo the page turn that got you
    // here, whichever kind of turn it was.
    if (pi > 0) return renderPage(player, meta, ci, pi - 1);
    if (ci <= 0) return { type: 'output', message: `<span class="text-dim">You are at the beginning of ${meta.title}.</span>` };
    const prev = await chapter(meta.id, ci - 1);
    return renderPage(player, meta, ci - 1, pagesOf(meta, prev).length - 1);
  }

  if (pi < pages.length - 1) return renderPage(player, meta, ci, pi + 1);
  if (ci < (meta.chapters || 0) - 1) return renderPage(player, meta, ci + 1, 0);
  return { type: 'output', message: `<span class="ambient">That was the last page of ${meta.title}.</span>` };
}

// ── chapter [<n>|next|back] ──────────────────────────────────────────────────

export async function cmdChapter(args, raw, player) {
  if (!await unlocked(player)) return locked;
  const meta = await currentBook(player);
  if (!meta) {
    return { type: 'error', message: `You have no book open. ${link('library', 'library')} shows the shelf.` };
  }
  const total = meta.chapters || 0;
  const ci = await bookmarkOf(player, meta.id);
  const a = (args[0] || '').toLowerCase();

  if (!a) return { type: 'output', message: `<span class="text-dim">You are in chapter ${ci + 1} of ${total}. ${link('contents', 'contents')} lists them.</span>` };

  const n = parseInt(a, 10);
  const target = Number.isFinite(n) ? n - 1
    : (a === 'next') ? ci + 1
      : (a === 'back' || a === 'prev') ? ci - 1
        : NaN;
  if (!Number.isFinite(target)) return { type: 'error', message: 'Try "chapter 3", "chapter next", or "chapter back".' };
  if (target < 0 || target >= total) return { type: 'error', message: `${meta.title} has ${total} chapter${total === 1 ? '' : 's'}.` };
  return renderPage(player, meta, target, 0);
}

// ── contents [book] ──────────────────────────────────────────────────────────

export async function cmdContents(args, raw, player) {
  if (!await unlocked(player)) return locked;
  const arg = (args || []).join(' ').trim();
  let meta = null;
  if (arg) {
    const hit = matchBook(await allTitles(), arg);
    if (!hit) return { type: 'error', message: `No book by that name. ${link('library', 'library')} shows the shelf.` };
    meta = await bookMeta(hit.id);
  } else {
    meta = await currentBook(player);
    if (!meta) return { type: 'error', message: `You have no book open. ${link('library', 'library')} shows the shelf.` };
  }

  const toc = await chapterToc(meta.id);
  const at = String(await getFlag('player', READING, player)) === meta.id
    ? await bookmarkOf(player, meta.id) : -1;

  const lines = toc.map((c, i) => {
    // A reading estimate, not a word count — a chapter is a commitment of time,
    // and that's the number that decides whether you start it now. Same formula
    // the tablet's contents page uses.
    const mins = Math.max(1, Math.round((c.len || 0) / 5.6 / 220));
    const here = i === at ? '<span class="text-cyan">▸</span>' : (at > i ? '<span class="text-dim">✓</span>' : ' ');
    return `${here} ${link(`chapter ${i + 1}`, String(i + 1).padStart(2))} ${c.title || `Chapter ${i + 1}`} <span class="text-dim">· ${mins} min</span>`;
  });

  return {
    type: 'output',
    message: [
      `<span class="text-cyan">${meta.title}</span> <span class="text-dim">— ${meta.author}, ${meta.year}</span>`,
      ...lines,
    ].join('\n'),
  };
}
