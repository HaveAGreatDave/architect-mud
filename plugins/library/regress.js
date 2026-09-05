// Library plugin regression — the typed reader (`library`/`read`/`page`/
// `chapter`/`contents`) and the pure helpers behind it.
//
// What's load-bearing here is the GATE and the FALL-THROUGH, not the prose:
// `read` is a shared specialized action, so a library that answers for a title it
// only half-recognised would swallow `read charge sheet` in a jail cell. Every
// no-match path must return undefined, and every locked path must not leak that
// the shelf exists.
//
// The harness's fake player has no `books` rows to read, so this asserts routing,
// gating and the pure functions rather than real prose.
import { matchBook, paginate, comicBlocks, comicPlain, PAGE_CHARS } from './books.js';
import { _test } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  const player = getPlayer();

  // ── matchBook: the fall-through contract ───────────────────────────────────
  const BOOKS = [
    { id: 'book_machine_stops', title: 'The Machine Stops' },
    { id: 'book_we', title: 'We' },
    { id: 'book_frankenstein', title: 'Frankenstein' },
  ];
  check('matchBook finds an exact title', matchBook(BOOKS, 'The Machine Stops')?.id === 'book_machine_stops');
  check('...ignoring a leading article', matchBook(BOOKS, 'machine stops')?.id === 'book_machine_stops');
  check('...and matches on the id the tablet passes', matchBook(BOOKS, 'book_we')?.id === 'book_we');
  check('...case-insensitively', matchBook(BOOKS, 'FRANKENSTEIN')?.id === 'book_frankenstein');
  // The important direction: anything that isn't a book must be undefined, or the
  // other five `read` handlers never get their turn.
  check('matchBook returns undefined for another plugin\'s target',
    matchBook(BOOKS, 'charge sheet') === undefined, 'library would swallow read charge sheet');
  check('...and for the job board', matchBook(BOOKS, 'job board') === undefined);
  check('...and for an empty argument', matchBook(BOOKS, '') === undefined);
  check('...and for whitespace', matchBook(BOOKS, '   ') === undefined);
  // A bare article must not fuzzy-match. This caught a real bug: `the` is three
  // characters, so it skipped the `includes` length guard and went straight into
  // the PREFIX branch, where it happily matched "The Machine Stops" — `read the`
  // in a jail cell would have opened a novel instead of the charge sheet.
  check("a bare article doesn't fuzzy-match", matchBook(BOOKS, 'the') === undefined,
    JSON.stringify(matchBook(BOOKS, 'the')?.id));
  check('...nor any sub-4-character fragment', matchBook(BOOKS, 'fra') === undefined);
  // …while a real short TITLE still opens, because exact matches skip the floor.
  check('a genuinely two-letter title still opens', matchBook(BOOKS, 'We')?.id === 'book_we');
  check('a long-enough fragment still works', matchBook(BOOKS, 'franken')?.id === 'book_frankenstein');

  // ── paginate ───────────────────────────────────────────────────────────────
  const para = (n) => `Paragraph ${n} ${'x'.repeat(300)}`;
  const pages = paginate(Array.from({ length: 12 }, (_, i) => para(i)).join('\n\n'));
  check('paginate splits a long chapter into pages', pages.length > 1, `pages=${pages.length}`);
  check('...never breaking a paragraph across two of them',
    pages.flat().length === 12, `paras=${pages.flat().length}`);
  check('...keeping each page near the budget',
    pages.every(p => p.join('').length <= PAGE_CHARS || p.length === 1),
    JSON.stringify(pages.map(p => p.join('').length)));
  // A paragraph longer than a whole page is its own page rather than being sawn
  // in half — better one long page than a sentence cut mid-clause.
  const huge = paginate('y'.repeat(PAGE_CHARS * 3));
  check('an over-long paragraph becomes its own page', huge.length === 1 && huge[0].length === 1);
  check('an empty chapter still renders something', paginate('').length === 1);
  check('...and never undefined', Array.isArray(paginate(null)[0]));

  // ── The comic markup ───────────────────────────────────────────────────────
  // One parser, three consumers (the tablet's comic reader, the typed reader,
  // Read Aloud). What matters is that a marker NEVER survives into prose and that
  // the block order is the reading order, because the narration highlight is
  // numbered off exactly this walk.
  const CX = [
    "> I don't go away.",
    'He stays where he is.',
    'CLERK: The form has been superseded.\nMAN: Then I will wait.',
    '~CLACK~',
    '---',
    'The corridor. Empty.',
  ].join('\n\n');
  const blocks = comicBlocks(CX);
  check('comicBlocks keeps reading order',
    blocks.map(b => b.kind).join(',') === 'caption,panel,balloons,sfx,turn,panel',
    blocks.map(b => b.kind).join(','));
  check('...a caption loses its marker', blocks[0].text === "I don't go away.", blocks[0].text);
  check('...an exchange is ONE block with two lines', blocks[2].lines?.length === 2);
  check('...and keeps who is speaking',
    blocks[2].lines[0].speaker === 'CLERK' && blocks[2].lines[1].speaker === 'MAN',
    JSON.stringify(blocks[2].lines));
  check('...sfx loses its tildes', blocks[3].text === 'CLACK', blocks[3].text);

  // The load-bearing one: the log rung renders comicPlain, so a marker leaking
  // through here is markup printed at a player who cannot see any furniture.
  const plain = comicPlain(CX);
  check('comicPlain leaves no marker behind',
    !plain.split('\n').some(l => /^[>~]|^-{3,}/.test(l)), JSON.stringify(plain).slice(0, 160));
  check('...but keeps the speaker, which is dialogue and not markup',
    /CLERK: The form/.test(plain), plain.slice(0, 120));
  check('...and keeps every word of the captions', /I don't go away\./.test(plain));
  // A prose book must be untouched by any of this — comicBlocks is only ever
  // reached through kind='comic', and a plain paragraph is a panel, not a caption.
  const prose = comicBlocks('It was a bright cold day in April.');
  check('ordinary prose parses as one panel and nothing else',
    prose.length === 1 && prose[0].kind === 'panel', JSON.stringify(prose));

  // ── The gate ───────────────────────────────────────────────────────────────
  // The fake player has never scanned a terminal, so every front door is shut.
  // `library` says so in words (it's a verb you typed on purpose); `read` must
  // stay SILENT and fall through, because a locked player shouldn't learn the
  // shelf exists from a verb aimed at something else.
  delete player._flags;
  let r = await run('library');
  check('library is refused before you have scanned a terminal',
    r?.type === 'error' && /scan/i.test(r?.message || ''), JSON.stringify(r)?.slice(0, 140));
  check('...and the refusal points at the terminal, not the app',
    !/tablet.*library app/i.test(r?.message || ''), r?.message);

  r = await run('page');
  check('page is refused while locked', r?.type === 'error', JSON.stringify(r)?.slice(0, 120));
  r = await run('contents');
  check('contents is refused while locked', r?.type === 'error', JSON.stringify(r)?.slice(0, 120));
  r = await run('chapter 2');
  check('chapter is refused while locked', r?.type === 'error', JSON.stringify(r)?.slice(0, 120));
  r = await run('longbox');
  check('longbox is refused while locked', r?.type === 'error', JSON.stringify(r)?.slice(0, 120));

  // `read <something that is not a book>` must not be answered by this plugin at
  // all — the dispatcher should carry on to the built-in reader and report an
  // ordinary "you don't see that", never a library error.
  r = await run("read some object that's definitely not a book");
  check('read falls through for a non-book rather than erroring as the library',
    !/shelf|hall of records|scan/i.test(r?.message || ''), JSON.stringify(r)?.slice(0, 160));

  check('the unlock flag is still the one the tablet app gates on',
    _test.UNLOCK_FLAG === 'library_unlocked', _test.UNLOCK_FLAG);
}
