# Library — public-domain books as a readable system (as built)

Eight complete public-domain books, readable anywhere from the tablet, narrated
aloud in RP with the spoken line highlighted, and glossed for archaic vocabulary.

Not to be confused with **CODEX** ([systems-codex.md](systems-codex.md)), which is
the game's own backstory. CODEX is authored lore that unlocks a chapter at a time;
the Library is real literature, unlocked all at once, and is texture rather than
plot.

## Why the books are on the tablet and not in your hands

A book you carry only gets read where you found it. A book on the tablet gets read
waiting out a storm, sitting in a cell, riding a lift — which is when people
actually read. So the physical shelf is the *acquisition point* and the tablet is
the reader.

## Copyright — the rule, not a footnote

**Every title must be public domain IN THE UNITED STATES.** The server is
US-hosted, so that is the bar regardless of where a player sits.

Orwell's *1984* is deliberately **absent**. It is PD in the UK, EU, Canada and
Australia (Orwell died 1950, life+70), but US copyright runs 95 years from
publication — so it is protected in the US **until 2045**. *Brave New World*
(1932) fails the same test. "It's old" is not the test and neither is "it's PD
where I live"; check the title's US status on Project Gutenberg before adding it.

## The shelf

| Book | Author | Year | Chapters |
|---|---|---|---|
| A Modest Proposal | Swift | 1729 | 1 |
| Candide | Voltaire | 1759 | 31 |
| Confessions of an English Opium-Eater | De Quincey | 1821 | 5 |
| The Island of Doctor Moreau | Wells | 1896 | 22 |
| The Iron Heel | London | 1908 | 26 |
| The Machine Stops | Forster | 1909 | 3 |
| The Scarlet Plague | London | 1912 | 6 |
| We | Zamyatin (Zilboorg tr., 1924) | 1924 | 41 |

## Read tier — the load-bearing constraint

**`books` is `readTier: 'cold'` and is never boot-loaded.** This is not
descriptive; it is the reason the feature is affordable. A deploy already
cold-reloads the world from Neon at ~36MB and that cap has been hit before
(July 2026). The books are ~1.7MB of raw text.

Three rules follow, and breaking any one of them silently undoes it:

- The shelf and cover screens select **named metadata columns only** — never
  `chapters`. `jsonb_array_length(chapters)` gets the chapter count without
  materialising the text. A lazy `SELECT *` here drags a megabyte into a screen
  that shows six lines.
- A page turn pulls **one chapter, by index, inside Postgres**.
- Nothing caches the text in Node.

### The `::int` cast

```sql
chapters->($2::int)->>'text'     -- correct
chapters->$2->>'text'            -- silently returns NULL, always
```

A bound parameter arrives as **text**, and `jsonb -> text` is a **key** lookup,
not an array index. Without the cast every chapter of every book reads blank,
with no error. Regress asserts both the working form and that the uncast form is
still the trap it is documented as.

### Storage cost (measured)

| | |
|---|---|
| Raw text | 1.69 MB |
| Stored (pglz, automatic) | 0.95 MB — 1.83× |
| Shelf query | ~4 ms |
| One chapter | ~4 ms |
| Added to the boot reload | **zero** |

Further compression was measured and rejected: deflate+32KB shared dictionary
reaches 2.53×, brotli-11 per chapter 2.81× (0.60MB), whole-corpus brotli 3.25×.
Getting under 0.5% of the database would need **7×**, which lossless compression
does not do on natural-language prose. Moving to per-chapter brotli `bytea` rows
would save ~0.35MB *and* avoid de-TOASTing a whole book to read one chapter —
worth doing for the latter if ever, not the former.

## Content pipeline

Texts are **fetched, not hand-authored** — they are bulk data with a known
upstream. [`scripts/content/fetch-books.mjs`](../scripts/content/fetch-books.mjs)
pulls from Project Gutenberg (or Wikisource where Gutenberg has no US copy) and
writes `content/books/*.json`. Idempotent: re-running rewrites the same files.
Commit the result; the repo stores the outcome, the script keeps it reproducible.

Gotchas the script encodes, each of which cost a wrong shipment once:

- **Verify the ID by title+author** before trusting it. Gutenberg #61765 is *The
  Pleistocene of North America*, not *The Machine Stops* — caught only because a
  12k-word novella came back at 239k words.
- **The Machine Stops is not on Gutenberg US at all** and comes from Wikisource
  as three subpages. Its absence there is a sourcing gap, not a rights one.
- Gutenberg plain text is **CRLF**, so chapter patterns must anchor `\r?$`.
- Chapter headings vary wildly: `CHAPTER I.` (Iron Heel), a bare roman numeral
  alone on its line (Scarlet Plague, Candide), `Record One` (We), roman + period
  + a **not-reliably-capitalised** title (Moreau — an all-caps character class
  silently dropped three chapters).
- The licence header/footer is stripped by marker, and the script **throws**
  rather than shipping boilerplate as chapter one.

## Narration

Uses the same formant synth as the TV (`AudioEngine.speak`/`cancelSpeech`), gated
on the **same TV-voice setting** — mute the televisions and a novel will not start
talking at you.

The synth has **no completion callback**: TV drives it by pushing a line whenever
one arrives and passing a `budget` so the voice fits the window. A book has no
such external clock, so narration keeps its own — sentences are estimated from
word count and the next is scheduled off a timer. Sentences over 220 characters
split again on commas so a Victorian clause-pile is not one 40-second sprint.

**Highlighting.** `narrateSplit()` is the single place a chapter is cut into
utterances. The renderer wraps each piece in a span carrying its index and the
narrator walks the *same* array, so span N is always utterance N. Two separate
splits would desynchronise the moment either regex changed. The highlight is a
background tint (survives every theme) and scrolls `block: 'nearest'` — `center`
would yank the page every sentence.

**Minimize.** An explicit Minimize closes the shell and keeps reading, via a flag
`close()` consumes. **Any other teardown stops narration** — the X, a disconnect,
a page turn. A pill (book, sentence progress, stop) appears bottom-centre; its CSS
lives in `client/game/styles.css`, *not* the tablet's injected style block, because
that block is scoped to the overlay and dies exactly when the pill is needed.

### RP accent

The dictionary is CMUDICT (General American), so an accent is a **transform over
the phoneme run**, not a second dictionary. `speak(text, { accent: 'rp' })` does
the three things that carry the impression:

1. **Non-rhotic** — `/R/` dropped unless a vowel follows. *father*, *harder* lose
   it; *red*, *very* keep it.
2. **NURSE without r-colour** — `ER` is rhotic by way of a very low F3 (1690 Hz);
   a low F3 is what the ear reads as American rhoticity. New `ERR` phoneme, F3
   raised to 2350. A real `PH` entry, not a remap — no existing vowel has those
   formants.
3. **TRAP–BATH** — `/AE/` backs to `/AA/` before the fricatives and nasal clusters
   that trigger the split: *bath*, *path*, *laugh*, *dance*.

`estimateDuration` runs on the **accented** run, so fit-to-window timing accounts
for dropped r's. Only the Library passes `accent`; every other voice is unchanged.

Not attempted: linking-r across word boundaries, and RP's LOT rounding
(`AA`→`AO` in *hot/not*) — applying that generally would wreck *father* and
*palm*, and doing it properly needs lexical sets CMUDICT does not carry.

### Per-book pronunciation

CMUDICT is 25k words of General American and knows none of Zamyatin's Russian,
Voltaire's French or De Quincey's Latin — they fall through to the letter-guesser
and come out mangled. `books.pronunciation` is a per-book ARPAbet map
(`{ "cunegonde": "K UW N EH G AO N D" }`), passed as `speak(..., { lex })` and
consulted **before** the built-in dict and CMUDICT.

`_lex` is module-scoped rather than threaded through every call because the whole
text→phoneme pass is synchronous: `speak()` sets it, converts, and clears it in a
`finally` before yielding, so two voices can never see each other's lexicon. The
reader captures the lexicon when narration **starts**, not at speak time —
narration outlives a minimize, by which point the panel payload is gone.

## Glossary

The books are **never rewritten.** Modernising the prose would cost a ~300k-word
rewrite and lose the voice that makes them worth shelving. The text stands as
written and the reader annotates it: archaic words get a dotted underline, tap for
one line of plain English.

Scope rule: **gloss what a reader would stop at, not everything old-fashioned.**
`phthisis` and `assignat` earn a line; "thrice" earns nothing. The set includes
the words that mean something *else* now — *want* = lack, *sensible* = aware,
*ejaculated* = exclaimed.

- `glossary` is `readTier: 'boot'` and cached in memory — it is small (90 terms,
  78 aliases, 64 kB) unlike the books it annotates, so page turns are query-free.
- Only terms **occurring in the current chapter** travel to the client. Matching
  is one pass over the chapter's own word set, not 170 passes over the chapter.
- Wrapping runs **after** escaping and matches only letter runs, so it cannot land
  inside an entity or invent a tag, and it sits *inside* the narration spans so
  glossing and highlighting coexist.
- Authored by [`scripts/content/build-glossary.mjs`](../scripts/content/build-glossary.mjs),
  which rewrites the directory cleanly so a removed term loses its file (and
  therefore its prod row).

## The app arrives, it does not ship

A tablet pre-loaded with eight novels is a menu item. A tablet that grows a
Library app the first time you put it in a brass slot in the back of the Hall of
Records is something that happened to you.

`plugins/library` exists only for that: `scan` at furniture tagged
`lending_terminal` sets the `library_unlocked` player flag, which is the sole
thing `library-app.js`'s `visible` gate checks. Before that the app is **not on
the home screen at all**. The first scan prints an intro covering narration,
minimize, the gloss layer and per-book bookmarks; later scans are a gentle no-op.
Examining a terminal teaches the verb once via the `teachVerb` shimmer.

The whole catalogue opens at once — Marrowby is not a man who rations.

## Where it lives

- **The Lending Library** (`zone_records_library`) — north off The Stacks, inside
  the **Hall of Records**. Deliberately a room in an existing building, not a new
  facade: it therefore needs no map icon, no terrain exits, no facade-entrance
  alignment and no power wiring, inheriting `always_lit` from its siblings.
- **Silas Marrowby** — the librarian. Reviews all three original titles in his
  chitchat.
- Progress is a **player flag** per book (`book_pos_<id>`), not a new table.

## Files

| Path | Role |
|---|---|
| `plugins/tablet/library-app.js` | The reader: shelf, contents, page, gloss, bookmark |
| `plugins/library/` | The unlock: `scan`, the intro, the `lending_terminal` tag |
| `scripts/content/fetch-books.mjs` | Text acquisition (Gutenberg/Wikisource) + lexicons |
| `scripts/content/build-glossary.mjs` | Glossary term authoring |
| `client/shared/audio-engine.js` | `applyAccent`, `ERR` phoneme, `lexLook` |
| `client/game/js/panels/tablet-os.js` | Narration, highlighting, minimize pill, gloss render |
