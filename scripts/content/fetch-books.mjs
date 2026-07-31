// fetch-books — pull the public-domain library texts from Project Gutenberg and
// write them into content/books/*.json.
//
//   node scripts/content/fetch-books.mjs            # all titles
//   node scripts/content/fetch-books.mjs machine    # just the one whose id matches
//
// WHY A SCRIPT AND NOT HAND-AUTHORED CONTENT: these are ~100k-word texts. They are
// bulk data with a known upstream, not authored prose, so the repo stores the
// RESULT (committed, deterministic, reviewable) while the fetch stays reproducible.
// Run it once, eyeball the diff, commit the JSON. It is idempotent — re-running
// rewrites the same files from the same sources.
//
// COPYRIGHT: every title here is public domain IN THE UNITED STATES, which is the
// bar that matters because the server is US-hosted. Orwell's 1984 is deliberately
// ABSENT — it is PD in the UK/EU/Canada/Australia but remains under US copyright
// until 2045. Do not add a title without checking its US status on Gutenberg
// first; "it's old" is not the test, and neither is "it's PD where I live".
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'content', 'books');

// Per-book narrator lexicons, in ARPAbet — the phoneme set the formant synth and
// CMUDICT both speak. CMUDICT is 25k words of General American, so anything
// foreign or classical falls through to the letter-guesser and comes out wrong;
// these are the words each book actually repeats often enough for that to grate.
// Keys must be lowercase and stripped of punctuation, matching pronounceWord().
const LEXICONS = {
  book_we: {
    'zamiatin': 'Z AA M Y AA T IH N', 'zamyatin': 'Z AA M Y AA T IH N',
    'benefactor': 'B EH N AH F AE K T ER',
    'mephi': 'M EH F IY', 'integral': 'IH N T AH G R AH L',
    'taylor': 'T EY L ER', 'auditorium': 'AO D IH T AO R IY AH M',
  },
  book_candide: {
    'candide': 'K AA N D IY D', 'pangloss': 'P AE N G L AO S',
    'cunegonde': 'K UW N EH G AO N D', 'cunegund': 'K UW N EH G AH N D',
    'westphalia': 'W EH S T F EY L IY AH', 'thunder': 'TH AH N D ER',
    'eldorado': 'EH L D AO R AA D OW', 'cacambo': 'K AH K AA M B OW',
    'martin': 'M AA R T IH N', 'paquette': 'P AA K EH T',
    'voltaire': 'V OW L T EH R', 'seraglio': 'S ER AA L Y OW',
    'janissary': 'JH AE N IH S EH R IY', 'auto': 'AO T OW',
  },
  book_opium_eater: {
    'quincey': 'K W IH N S IY', 'laudanum': 'L AO D AH N AH M',
    'phthisis': 'TH AY S IH S', 'paregoric': 'P AE R AH G AO R IH K',
    'malay': 'M AH L EY', 'oxford': 'AA K S F ER D',
    'ann': 'AE N', 'opium': 'OW P IY AH M',
  },
  book_moreau: {
    'moreau': 'M AO R OW', 'montgomery': 'M AH N T G AH M ER IY',
    'prendick': 'P R EH N D IH K', 'puma': 'P Y UW M AH',
    'ipecacuanha': 'IH P AH K AE K Y UW AA N AH',
  },
  book_iron_heel: {
    'everhard': 'EH V ER HH AA R D', 'avis': 'EY V IH S',
    'philomath': 'F IH L AH M AE TH', 'oligarch': 'AA L IH G AA R K',
    'wickson': 'W IH K S AH N',
  },
  book_sleeper_awakes: {
    'isbister': 'IH Z B IH S T ER', 'ostrog': 'AA S T R AO G',
    'wotton': 'W AA T AH N', 'aeronaut': 'EH R AH N AO T',
    'aeronauts': 'EH R AH N AO T S', 'eadhamite': 'IY D AH M AY T',
    'phonograph': 'F OW N AH G R AE F',
  },
  book_machine_stops: {
    'vashti': 'V AE SH T IY', 'kuno': 'K UW N OW',
    'euphrates': 'Y UW F R EY T IY Z',
  },
};

const BOOKS = [
  {
    id: 'book_machine_stops',
    // NOT on Project Gutenberg US — its search returns nothing for this title, so
    // it comes from Wikisource instead, which carries it as three subpages. The
    // story itself (published 1909) is comfortably US public domain; Gutenberg's
    // absence is a sourcing gap, not a rights one.
    wikisource: ['The Machine Stops/Chapter I', 'The Machine Stops/Chapter II', 'The Machine Stops/Chapter III'],
    chapterTitles: ['The Air-Ship', 'The Mending Apparatus', 'The Homeless'],
    title: 'The Machine Stops',
    author: 'E. M. Forster',
    year: 1909,
    source: 'English Wikisource — first published 1909, public domain in the United States.',
    blurb: 'A pre-Collapse novella about people who lived alone in little rooms, spoke only through screens, and were kept alive by a Machine they had stopped being able to repair. Reads less like fiction every year.',
  },
  {
    id: 'book_we',
    gutenbergId: 61963,
    title: 'We',
    author: 'Yevgeny Zamyatin',
    year: 1924,
    source: 'Project Gutenberg #61963, Gregory Zilboorg translation (1924) — public domain in the United States.',
    blurb: 'Smuggled out of somewhere that no longer exists, in a translation older than the Collapse. A citizen of a glass city, numbered rather than named, starts keeping a journal and ruins his life with it. Every dystopia you have ever heard of is downstream of this one.',
    splitOn: /^\s*Record\s+(?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve|Thirteen|Fourteen|Fifteen|Sixteen|Seventeen|Eighteen|Nineteen|Twenty|Thirty|Forty)[^\n]*$/gim,
  },
  {
    id: 'book_iron_heel',
    gutenbergId: 1164,
    title: 'The Iron Heel',
    author: 'Jack London',
    year: 1908,
    source: 'Project Gutenberg #1164 — public domain in the United States.',
    blurb: 'An account, allegedly recovered centuries after the fact, of the years an oligarchy of combined trusts stopped pretending to be anything else and put its boot on the neck of everyone below it. Circulated quietly. Read it and you will start recognising people.',
    // Headings carry a trailing period ("CHAPTER I."), and the volume also opens
    // with a table of contents listing "I. MY EAGLE" — matching only the CHAPTER
    // form keeps the contents page out of the chapter list.
    splitOn: /^\s*CHAPTER\s+[IVXLC]+\.?\s*$/gim,
  },
  {
    id: 'book_sleeper_awakes',
    // The 1910 revision, which is the text Wells wanted; the 1899 serial "When the
    // Sleeper Wakes" is Gutenberg #775 and is a different book in the places that
    // matter. Both are US public domain.
    gutenbergId: 12163,
    title: 'The Sleeper Awakes',
    author: 'H. G. Wells',
    year: 1910,
    source: 'Project Gutenberg #12163, the 1910 revised text — public domain in the United States.',
    blurb: 'A man lies down with insomnia and gets up two centuries later to find that his money kept compounding the whole time, and that he now legally owns most of the world. Everyone wants to explain the arrangement to him. Nobody wants to hand it over. On what it costs to be the figurehead of your own fortune.',
    // Headings are a bare "CHAPTER I" on its own line with the chapter title on the
    // line after — the title stays in the body, exactly as it does for The Iron
    // Heel. A prose line ("the Isbister of the last chapter") does not anchor.
    splitOn: /^\s*CHAPTER\s+[IVXLC]+\.?\s*$/gim,
  },

  // ── HellMOO-adjacent shelf ────────────────────────────────────────────────
  // Same US-public-domain bar as above. These lean brutal-and-funny rather than
  // straight dystopian, which is the register the game actually writes in.
  {
    id: 'book_modest_proposal',
    gutenbergId: 1080,
    title: 'A Modest Proposal',
    author: 'Jonathan Swift',
    year: 1729,
    source: 'Project Gutenberg #1080 — public domain in the United States.',
    blurb: 'Nine pages in which a reasonable man, in a reasonable voice, proposes eating the children of the poor as sound fiscal policy, and never once breaks character. Every atrocity you have ever heard justified on a balance sheet is in here, written before anyone had the machines to do it properly.',
    // Very short and undivided — chapterize falls back to one section, correctly.
    splitOn: /^\s*CHAPTER\s+[IVXLC]+\.?\s*$/gim,
  },
  {
    id: 'book_scarlet_plague',
    gutenbergId: 21970,
    title: 'The Scarlet Plague',
    author: 'Jack London',
    year: 1912,
    source: 'Project Gutenberg #21970 — public domain in the United States.',
    blurb: 'An old man on a beach tries to explain civilisation to his grandchildren, who are feral, bored, and not convinced any of it happened. Sixty years after a plague took everything in a fortnight. The most familiar thing on this shelf.',
    // Chapters are a bare roman numeral alone on its line — no "CHAPTER" word.
    // \r is explicit: Gutenberg's plain text is CRLF, so a trailing $ alone
    // won't anchor.
    splitOn: /^[ \t]*[IVXLC]+\.?[ \t]*\r?$/gm,
  },
  {
    id: 'book_moreau',
    gutenbergId: 159,
    title: 'The Island of Doctor Moreau',
    author: 'H. G. Wells',
    year: 1896,
    source: 'Project Gutenberg #159 — public domain in the United States.',
    blurb: 'A man washes up on an island where a surgeon has been making people out of animals, and the people keep quietly going back. On the difficulty of staying what you were made into. Read it if you have ever taken a dose you were not sure about.',
    // Roman numeral, period, then the title — which is NOT reliably all-caps, so
    // an all-caps character class silently dropped three chapters.
    splitOn: /^[ \t]*[IVXLC]+\.[ \t]+\S.*\r?$/gm,
  },
  {
    id: 'book_candide',
    gutenbergId: 19942,
    title: 'Candide',
    author: 'Voltaire',
    year: 1759,
    source: 'Project Gutenberg #19942 — public domain in the United States.',
    blurb: 'A relentlessly optimistic young man is flogged, conscripted, shipwrecked, robbed, and disembowelled by circumstance across three continents, while his tutor explains that this is the best of all possible worlds. Funny in the way this place is funny — because the alternative is worse.',
    // Same bare-numeral form. The word CHAPTER appears only in the contents table
    // and a transcriber's note, so matching on it finds front matter, not chapters.
    splitOn: /^[ \t]*[IVXLC]+\.?[ \t]*\r?$/gm,
  },
  {
    id: 'book_opium_eater',
    gutenbergId: 2040,
    title: 'Confessions of an English Opium-Eater',
    author: 'Thomas De Quincey',
    year: 1821,
    source: 'Project Gutenberg #2040 — public domain in the United States.',
    blurb: 'The first drug memoir, and still one of the few honest ones: the pleasures described at length and without apology, then the bill, described the same way. He is not sorry and he is not well.',
    // TO THE READER and PRELIMINARY CONFESSIONS are load-bearing entries, not front
    // matter: the Preliminary Confessions alone are a third of the book (the Oxford
    // Street/Ann chapters everyone actually quotes). Without them here the split
    // swallowed both into one 80KB "Front Matter" blob and the contents page went
    // straight from the title to PART II, so two real sections had no way in.
    splitOn: /^\s*(?:TO\s+THE\s+READER|PRELIMINARY\s+CONFESSIONS|PART\s+[IVX]+|THE\s+PLEASURES\s+OF\s+OPIUM|INTRODUCTION\s+TO\s+THE\s+PAINS\s+OF\s+OPIUM|THE\s+PAINS\s+OF\s+OPIUM)\s*\.?\s*$/gim,
  },
];

// Wikisource's plain-text extract, one subpage at a time.
async function fetchWikisource(titles) {
  const out = [];
  for (const t of titles) {
    const u = 'https://en.wikisource.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json&titles=' + encodeURIComponent(t);
    const res = await fetch(u, { headers: { 'User-Agent': 'architect-mud/content-fetch' } });
    if (!res.ok) throw new Error(`wikisource ${t}: HTTP ${res.status}`);
    const page = Object.values((await res.json()).query.pages)[0];
    if (page.missing !== undefined || !page.extract) throw new Error(`wikisource ${t}: no text`);
    // The extract keeps wikitext section headings ("== The Air Ship =="). We
    // already carry the chapter title in its own field, so strip them rather than
    // printing the title twice at the top of every chapter.
    out.push(page.extract.replace(/^\s*==+\s*[^=\n]+\s*==+\s*$/gm, '').trim());
  }
  return out;
}

// Gutenberg's plain-text mirror. The .txt.utf-8 form is the stable one.
const url = (id) => `https://www.gutenberg.org/files/${id}/${id}-0.txt`;
const altUrl = (id) => `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`;

async function fetchText(gid) {
  for (const u of [url(gid), altUrl(gid)]) {
    try {
      const res = await fetch(u, { headers: { 'User-Agent': 'architect-mud/content-fetch' } });
      if (res.ok) return await res.text();
    } catch { /* try the next mirror */ }
  }
  throw new Error(`could not fetch Gutenberg #${gid}`);
}

// Strip Gutenberg's licence header/footer. The markers are stable and have been
// for twenty years; if they ever move, this throws rather than silently shipping
// the boilerplate as chapter one.
function stripBoilerplate(raw, gid) {
  const start = raw.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i);
  const end = raw.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`#${gid}: Gutenberg markers not found — refusing to ship boilerplate`);
  }
  return raw.slice(raw.indexOf('\n', start) + 1, end).trim();
}

function chapterize(body, splitOn, title) {
  const re = new RegExp(splitOn.source, splitOn.flags.includes('g') ? splitOn.flags : splitOn.flags + 'g');
  const heads = [...body.matchAll(re)];
  if (heads.length < 2) {
    // Not an error — a short work legitimately has no internal divisions. One
    // chapter is still perfectly readable, just a longer scroll.
    return [{ title, text: body }];
  }
  const out = [];
  // Anything before the first heading is front matter (dedication, epigraph) —
  // keep it as its own leading section rather than silently dropping it.
  const pre = body.slice(0, heads[0].index).trim();
  if (pre.length > 400) out.push({ title: 'Front Matter', text: pre });
  heads.forEach((h, i) => {
    const from = h.index;
    const to = i + 1 < heads.length ? heads[i + 1].index : body.length;
    const chunk = body.slice(from, to).trim();
    const [head, ...rest] = chunk.split('\n');
    out.push({ title: head.trim().replace(/\s+/g, ' '), text: rest.join('\n').trim() });
  });
  return out;
}

async function main() {
  const filter = (process.argv[2] || '').toLowerCase();
  const targets = filter ? BOOKS.filter(b => b.id.includes(filter)) : BOOKS;
  if (!targets.length) {
    console.error(`No book matches "${filter}". Known: ${BOOKS.map(b => b.id).join(', ')}`);
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });

  for (const b of targets) {
    process.stdout.write(`  ${b.title} … `);
    let chapters, words;
    if (b.wikisource) {
      const parts = await fetchWikisource(b.wikisource);
      chapters = parts.map((text, i) => ({ title: b.chapterTitles?.[i] || `Chapter ${i + 1}`, text }));
      words = parts.join(' ').split(/\s+/).length;
    } else {
      const raw = await fetchText(b.gutenbergId);
      const body = stripBoilerplate(raw, b.gutenbergId);
      chapters = chapterize(body, b.splitOn, b.title);
      words = body.split(/\s+/).length;
    }
    const row = {
      id: b.id, title: b.title, author: b.author, year: b.year,
      blurb: b.blurb, source: b.source, chapters,
      pronunciation: LEXICONS[b.id] || {},
    };
    // Sorted keys + trailing newline: matches what content:export emits, so the
    // first export after this doesn't produce a spurious reformat diff.
    await writeFile(join(OUT, `${b.id}.json`), JSON.stringify(row, null, 2) + '\n', 'utf8');
    console.log(`${chapters.length} chapter(s), ~${Math.round(words / 1000)}k words`);
  }
  console.log('\nNow: npm run content:import, then commit content/books/.');
}

await main();
