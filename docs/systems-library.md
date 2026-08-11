# Library — public-domain books as a readable system (as built)

Nine complete public-domain books, readable anywhere — from the tablet, narrated
aloud in RP with the spoken line highlighted and glossed for archaic vocabulary,
or by typing.

**Two readers, one shelf.** Both call [plugins/library/books.js](../plugins/library/books.js)
and share the `book_pos_<id>` bookmark, so a book put down on the tablet is picked
up by `read` on the same chapter. Until the typed reader existed
(`library`/`read`/`page`/`chapter`/`contents`) the plugin exported no commands at
all and every book in the game was reachable only by tapping — the whole content
set was invisible to a player who didn't use the tablet.

The typed reader adds exactly one concept the tablet doesn't have: a **page**
(`book_page_<id>`, its flag alone). The tablet scrolls a whole chapter inside a
panel; the log can't, and a novel chapter pushed to the scrollback in one go is
thousands of words nobody can navigate — so `page` serves ~1400 characters broken
at a paragraph, **never mid-sentence**. Teaching the tablet about pages would only
make the two readers disagree about where you are inside a chapter.

Not to be confused with **CODEX** ([systems-codex.md](systems-codex.md)), which is
the game's own backstory. CODEX is authored lore that unlocks a chapter at a time;
the Library is real literature, unlocked all at once, and is texture rather than
plot.

## Why the books are on the tablet and not in your hands

A book you carry only gets read where you found it. A book on the tablet gets read
waiting out a storm, sitting in a cell, riding a lift — which is when people
actually read. So the physical shelf is the *acquisition point* and the tablet is
the reader.

That reasoning is about the BOOK not being a carried object; it was never an
argument for the tablet being the only interface, and for a while it was quietly
doing duty as one. The typed reader is the same books, the same anywhere, without
the panel.

## Copyright — the rule, not a footnote

**Every title must be public domain IN THE UNITED STATES.** The server is
US-hosted, so that is the bar regardless of where a player sits.

**The rule is about REAL literature, and the in-universe comics are the other case.**
Four titles on the shelf were written for this game (`book_comic_*` — The Meter Reader,
Sister Steel, Captain Quorum, The Grievance). Nothing about them needs clearing, because
nobody else owns them; they exist because the world already referenced comics it had never
written. They are authored the same way as everything else — `content/books/*.json`,
chapters, the same two readers — and they carry an in-universe `author`/`year` with a
`source` line that says plainly that they are fiction, so the provenance field can never be
mistaken for a Gutenberg citation later. **Adding another original is free; adding another
real book is the thing that needs checking.**

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
| Confessions of an English Opium-Eater | De Quincey | 1821 | 6 |
| The Island of Doctor Moreau | Wells | 1896 | 22 |
| The Iron Heel | London | 1908 | 26 |
| The Machine Stops | Forster | 1909 | 3 |
| The Scarlet Plague | London | 1912 | 6 |
| The Sleeper Awakes | Wells | 1910 | 26 |
| We | Zamyatin (Zilboorg tr., 1924) | 1924 | 41 |
| *The Meter Reader #1: The Reading* | Aldous & Sable | 2039 | 3 |
| *Sister Steel #1: Tempered* | Ilse Marek | 2041 | 3 |
| *Captain Quorum and the Motion to Adjourn* | Civic Morale Directorate | 2027 | 2 |
| *The Grievance #1: Form 9* | anonymous | 2058 | 1 |

The italicised four are **in-universe originals**, not literature — see the copyright note
above. Physical copies are sold by Emmett Sloat at Mint Condition on Ironside Street, and
two of them have (bad) film adaptations you can rent off his back-room wall; the scans on
the tablet are free to everybody, which is a thing he will tell you about himself before
you can ask.

## The longbox — comics are a second shelf, not a section of the first

`books.kind` is `'book'` or `'comic'`, and it decides which of **two screens** a title
appears on: the cloth-and-foil shelf, or the longbox (bagged, boarded, face-out, sorted by
cover date). A column rather than a `book_comic_*` id convention, because the fifth comic
must not have to be *named* a certain way to be findable.

The split is **presentation only, and one thing must never inherit it**: `read <title>`
matches across **both** shelves (`allTitles()`), because typing is not a presentation and a
player should not have to know that Sister Steel is filed as a comic before they can open
it. `library`/`longbox` are two listings; `read` is one door. Every list read takes the kind
as an argument rather than fetching everything and filtering in Node — a comic leaking onto
the literature shelf is exactly the bug the column exists to prevent, and Node-side
filtering is how it would come back.

Why separate at all: sorted by year among Voltaire and Wells, the four comics were
invisible, and they are a different object anyway — bought for pennies out of a bin, read in
one sitting, and physically nothing like a bound novel.

### They were panel scripts, and that was the real problem

Until 2026-08-11 a comic's text was a **panel script with a critic talking over it**:

```
PANEL THREE. Close on the man. Nine lines.
CAPTION: I DO NOT GO AWAY.
```

plus a third voice appraising the object — *"which is the whole joke and the whole point"*,
*"the one people argue about"*, *"it is used exactly four times in forty pages"*. Three
registers braided together, of which one settled every question before the reader got
there. It read as a **description of a comic** rather than as one.

They are now prose, with the stage directions gone and the critic gone, and the
presentation moved to where presentation belongs — the reader. Scene-setting survived
untouched (*"wallpaper in a pattern that was chosen by somebody who is dead"*); it was
always prose, it was just sitting under a panel number. Captain Quorum keeps a stiffer
voice on purpose: it is a Civic Morale Directorate propaganda comic, so the house style
**is** the joke.

### The markup — one parser, three consumers

A comic chapter is prose with four kinds of paragraph in it, marked at the head:

| Marker | Is |
|---|---|
| `> line` | a caption — the narrator's own voice, boxed |
| `NAME: line` | a balloon; consecutive lines are one exchange, one block |
| `~SOUND~` | lettering, at size, in the gutter |
| `---` | a page turn: air on both sides |
| anything else | the panel itself |

`comicBlocks()` / `comicPlain()` in [books.js](../plugins/library/books.js) are the **only**
parser. Three things consume it and each needs a different thing from it, which is why it
can only be written once:

- the tablet's comic reader draws furniture from the blocks (`renderComicBody`),
- the **typed reader renders `comicPlain`** — the log cannot draw a caption box, and a
  caption arriving as `> I do not go away` is markup printed at a player. Every paginating
  caller goes through `pagesOf()` so the strip happens exactly once and `page` cannot walk
  off the end of a chapter the renderer thinks is longer,
- **Read Aloud speaks the words and none of the marks.**

### Narration: the renderer returns its own parts

`renderComicBody` returns the HTML **and** the narration array from a single walk, and
`narrateStart` is handed that exact array (it accepts a pre-split parts array — the same
seam CODEX uses). CODEX keeps `renderCodexBody` and `codexNarrationParts` in sync by hand
and documents why re-splitting a rejoined string is not lossless; here one walk emits both,
so **span N is the text of utterance N by construction**. Re-splitting `detail.body` instead
would shift every index and light the wrong balloon for the rest of the chapter.

A balloon's speaker rides **inside** the spoken span. With one narrator voice, dropping the
name is how a listener loses track of who is talking.

## Read tier — the load-bearing constraint

**`books` is `readTier: 'cold'` and is never boot-loaded.** This is not
descriptive; it is the reason the feature is affordable. A deploy already
cold-reloads the world from Neon at ~36MB and that cap has been hit before
(July 2026). The books are ~2.3MB of raw text.

Three rules follow, and breaking any one of them silently undoes it:

- The shelf and cover screens select **named metadata columns only** — never
  `chapters`. `jsonb_array_length(chapters)` gets the chapter count without
  materialising the text. A lazy `SELECT *` here drags a megabyte into a screen
  that shows six lines.
- A page turn pulls **one chapter, by index, inside Postgres**.
- The contents page measures each chapter's **length** inside Postgres and sends
  only the integer (rendered as a reading estimate). It is built with
  `jsonb_array_elements … WITH ORDINALITY`, **not** `jsonb_path_query_array(chapters,
  '$[*].title')` — a path query silently SKIPS any element missing the key, so one
  untitled chapter would shorten the array and shift every index after it, sending
  taps to the wrong chapter with nothing to show it had.
- Nothing caches the text in Node.

### Chapter splitting is per-book, and it is easy to under-split

`scripts/content/fetch-books.mjs` carries a `splitOn` regex per title. A heading
the regex doesn't know is not an error — the text before the first match becomes
one **"Front Matter"** blob, so the missing sections simply never appear on the
contents page. De Quincey shipped that way: `TO THE READER` and `PRELIMINARY
CONFESSIONS` (a third of the book, and the part everyone quotes) were buried in an
80KB front-matter section, and the contents ran from the title straight to PART II.
**After changing a `splitOn`, read the chapter titles back** — a chapter count that
looks plausible is not evidence the split is right.

### Routing: a contents tap arrives as the CONTENTS screen

The client resends the screen you are currently on plus the tile's id as params
(`wireBody`'s `data-open-item`), so tapping chapter 3 sends
`tabletnav library contents "<bookId> 2"`. `buildScreen` matches a trailing index
and forwards to the reader. Without that it fell through to the cover branch and
looked up a book called `"<bookId> 2"` — **"No such book." for every chapter of
every book on the shelf**, which is what shipped until 2026-07-29. Regress now
drives the tap itself, not just the contents page.

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
| Raw text | 2.29 MB |
| Stored (pglz, automatic) | 1.19 MB — 1.93× |
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
- **A title can exist twice under two names.** Wells revised *When the Sleeper
  Wakes* (1899, #775) into *The Sleeper Awakes* (1910, #12163); both are US public
  domain and they differ in the places that matter. We shelve the 1910 text.
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

### What the synth models (and what it doesn't)

Shared with the TV, so this applies to every formant voice in the game. All of it
lives in the `Speech` IIFE in `client/shared/audio-engine.js`.

- **Formant loci.** Place of articulation is heard almost entirely in the way a
  consonant *bends the formants of the vowel next to it*, not in its own noise.
  Every obstruent carries a locus (`lf`) — labial `F2≈1000`, alveolar `≈1750`,
  velar `≈2000` with the F2/F3 velar pinch — that the formants glide to during
  its closure. Without this, a noise-only obstruent has no place cue at all and
  *bat / that / cat* all arrive as the same word.
- **Nasal antiformants.** A nasal's side branch *subtracts* a band. That zero
  (`az`: M 1000, N 1800, NG 2900, rendered as a peaking filter at −22 dB on the
  voiced path only) is the sole thing separating the three murmurs. Vowels
  touching a nasal get a weaker −7 dB version, because the velum is slow.
- **Voice-onset time.** `asp` gives voiceless stops 55–70 ms of aspiration after
  the burst and voiced ones ~10 ms plus a low voice bar through the closure.
  The gap *is* the P/B contrast; burst frequency barely matters.
- **A real glottal source.** The folds don't emit a sawtooth, they emit a pulse
  with a hard slam shut, and that closure discontinuity is what puts energy into
  the harmonics a formant filter needs. `glottalWave()` builds the Rosenberg
  pulse, differentiates it (the lips radiate the *derivative* of glottal flow —
  free +6 dB/octave) and DFTs it into a `PeriodicWave`. One 512-point DFT per
  distinct voice, cached; at runtime it's the same single oscillator as before.
  **Open quotient** — how much of the cycle the folds are apart — is the voice
  knob, 0.48 pressed and bright to 0.78 breathy and soft. It sits in the same
  PRNG slot the old saw/square pick did, so adding it didn't rename every
  existing narrator's voice.
- **Constant bandwidth, not constant Q.** Q per formant index meant bandwidth
  scaled with centre frequency — a 270 Hz F1 got a 38 Hz band and a 730 Hz F1
  got 104 Hz, so high vowels rang and low ones smeared. Q is now derived per
  phoneme as `f/BW` over `F_BW = [90,130,200,280]`, clamped to 3–16. The clamp
  earns its place: the physically correct Q for a 2290 Hz F2 is over 20, and a
  bandpass that sharp whistles on a source with no breath noise to fill between
  the harmonics. Nasalised sounds get their resonances damped 1.8× wider.
- **Lexical stress, from the dictionary.** `formant-cmudict.js` now carries stress
  digits (see below), and `cmuLook` normalises them into the run itself: primary
  stress becomes a `'*'` marker before the vowel, and `AH0` — CMUdict's schwa —
  becomes the `AX` phone. Other 0-stress vowels **keep their quality** and lose
  only length and loudness, because the vowel in *happy* is reduced in stress but
  not in colour. The marker has no `PH` entry, so everything that walks the run
  already skips it; only the lookaheads in `applyAccent` needed teaching.
  - The **spelling guesser is still there** as the fallback for proper nouns and
    world coinages: a function-word list, suffix rules (`-ation`/`-ity`/`-ic`
    pull stress a fixed count back from the end) and weak prefixes.
  - **Weak forms are per-vowel, not "everything becomes schwa".** English weakens
    each vowel to a specific target, and the high vowels do *not* travel all the way
    to the centre: `/uː/` → `/ʊ/`, `/iː/` → `/ɪ/`, everything else → schwa. Mapping
    the lot to `AX` turned *you are* into "yuh er" — further than even fast speech
    goes, and it reads as a mumble rather than as connected speech. `IY` and `UW` are
    out of `CENTRALISES` for the same reason: they keep their colour when unstressed
    (*happy*, *into*), so flattening them gives "happuh".
  - **Function words are deaccented at the phrase level** — no dictionary can do
    this, since CMUdict lists words in citation form and gives *you* a primary
    stress. This is most of what makes *of the* sound spoken rather than spelled.
  - **Nothing reduces at a phrase edge.** The last word before a pause keeps its
    full form whatever it is, or the line trails into a mumble exactly where the
    listener is waiting for the point. *look at me* ends on a full /miː/.
  - The hand `DICT` and per-book `lex` entries may carry their own `'*'` and `AX`;
    an entry that does is authoritative and never sees the guesser. Worth using —
    initialisms stress the last letter (dee-em-**VEE**) and the guesser can't know.
- **Prosody.** Declination, per-vowel lilt keyed to real stress, pre-boundary
  lengthening (1.22× on the last sound before a pause), and a **terminal rise on
  `?`** with declination flattened to 45 % for the whole phrase.
- **Aperiodic jitter + shimmer.** One LFO on F0 is *vibrato*, which reads as a
  synthesiser holding a note. Two at 9 Hz and 6.3 Hz beat and never repeat inside
  a phrase; shimmer (5.1 Hz on master gain) is the amplitude half.
- **Dark vs clear /l/, and unreleased stops.** `L` carries a second formant triple
  (`df`) used unless a vowel follows — *well*, *full*, *milk*, *people* all take
  the dark one, F2 down at 850 Hz. A stop before a pause or another stop skips its
  burst entirely, because English doesn't release those and bursting all of them
  is an audible synthetic tic.

> **Rate.** Reduction shortens unstressed syllables, and a human who reduces doesn't
> talk *faster* — the stressed syllables take the time back — so one compensation
> constant (`speed × 0.85` in `speak`) sets the average pace and leaves the contrast
> intact. **Lower is slower**; raise toward 0.9 if it drags. Measured at 65–77 ms/char
> across the voice range, inside the range of ordinary human speech.
>
> It was 0.75 and audibly sluggish, for two compounding reasons worth remembering:
> `estimateDuration` ignored the stress/pre-boundary/aspiration factors and so
> **under-reported** the real length (which is what let broadcast lines land on top
> of the voice), and the pause branch divided by `speed` a second time when `dur` was
> already speed-adjusted — so pauses scaled as 1/speed², and dragging `speed` down to
> ~1.0 silently inflated every inter-word gap by ~75 %. Both are fixed, and
> `estimateDuration` now mirrors the scheduling loop. Broadcast's `nodeHoldMs` is
> fitted to this number — **re-measure both together** if durations are retuned.

> **Pronunciation of common words.** Two faults, now fixed, that came from opposite
> directions. **Contractions were not in the dictionary subset at all**, so every one
> fell through to the letter-guesser, which has no idea what an apostrophe means:
> *they're* came out with a voiceless TH as "thee-r", *don't* as "dahnt", *i'm* as
> "im", *you're* as "yowr", *there's* as "ther-rez". 56 are now carried explicitly.
> And `deaccent` flattens *every* vowel in a function word — right for "of" and
> "the", destructive for anything longer, so *into* became "uhn-tuh" and *about*
> went flat. It now applies to **monosyllables only**; a polysyllabic function word
> keeps the internal stress the dictionary already gives it. The `FUNC` list was
> also too broad: negation, locatives, wh-words, demonstratives and particles all
> carry stress in normal speech, and *not* reducing to "nuht" is far more audible
> than any function word left unreduced.

> **Names are the letter-guesser's worst case, and the `y` rule was wrong.** `y` has
> **four** jobs and `g2p` knew two: the consonant `/j/` initially (*yes*), `/i/`
> word-finally (*city*, *happy*), and medially it splits the way every other English
> vowel does — **open** syllable (one consonant then a vowel) `/aɪ/` as in *cyborg*,
> *tyrant*, *style*; **closed** (cluster or word end) `/ɪ/` as in *cyd*, *gym*,
> *myth*, *crypt*. Guessing `IY` medially turned **Cyd** into "Seed". Ordinary words
> hide this completely because the dictionary covers them — it surfaces *only* on
> names and coinages, which is exactly where an error repeats forever. Sweeping the
> recurring cast through the guesser also caught `echelon` ("etch-a-lon" — it's
> French-derived `/ʃ/`), `kiyo` (pure noise), `bijou`, `merrin` and `solenne`; all
> now carry hand-`DICT` entries with explicit stress, along with `auggie` (spoken 236
> times in the `.bsm` corpus and rendered "aw-jye") and `vigo`.
>
> **6.1 % of broadcast word tokens miss the dictionary and reach the guesser**, and
> they are overwhelmingly names — which is why an error there repeats all night
> rather than passing once. **When you add a named NPC or place, run it through the
> guesser and listen**; CMUdict has none of them and never will. The voice lab's
> phoneme readout is the fastest check.
>
> One trap inside `g2p` worth knowing: **`'aeiou'.includes('')` is `true`**, so every
> lookahead past the end of a word reads as a vowel unless guarded. That is what made
> *cyd*, *gym* and *myth* look like open syllables; `isV` now rejects the empty
> string. Any new rule doing `at(i+n)` arithmetic has the same hazard.

> **Shouting is three cases, not two.** The first version had only "this word is
> emphatic" and "ignore", and put a wholly-capitalised line in the ignore bucket so
> title cards wouldn't be screamed. That meant a line which is nothing *but* a
> shout — `FUCK!` — got no emphasis at all and came out shorter and quieter than
> ordinary speech. Exactly backwards. Now: **mixed case** → the caps words are
> emphatic; **all caps and short** (≤20 letters) → the whole line is a shout, every
> word emphatic and driven harder still (`shoutLine`: the vowel is *held*, not
> merely accented); **all caps and long** → a banner, nobody is yelling it.

> **Released final stops.** The unreleased-stop rule fired on a stop followed by a
> pause *or another stop*, which is catastrophic in a final cluster: in *architect*
> (… `EH K T`) the K was unreleased because T follows, then T was unreleased because
> the pause follows — so the whole "ct" became silence with no burst anywhere and the
> word ended after "archite". A stop is now unreleased **only when another stop's
> closure masks it**. A stop with nothing but silence in front of it has no formant
> transition to identify it, so taking its burst away leaves literally nothing.
> Phrase-final releases are softened (0.4× aspiration) so they don't pop.

> **Stop allophones — clusters.** Aspiration was applied to every voiceless stop
> regardless of context, which is wrong in two common cases. **After `/s/` a stop is
> unaspirated** — *stop*, *sky*, *street* have nothing like the puff of *top*, *key*,
> *treat*; one of the most reliable rules in English phonology, and we were
> aspirating all of them. **Before a liquid or glide** the aspiration isn't a neutral
> puff either: the liquid is devoiced and the turbulence takes the shape of *its*
> constriction, so `/tr/` is one fricated gesture rather than t + breath + r. The
> noise is retuned to the liquid's own F2 and the formant transition starts during
> the release. A full 60 ms of 1800 Hz noise between them is what turned *intrusive*
> into "in-t'huh-rusive" — the dictionary entry was correct all along, so this was a
> rendering fault, not a lookup one.

> **Double-counting is the recurring failure mode here — check for it first.** Three
> separate bugs turned out to be the same mistake: modelling something twice that the
> engine was already doing once.
>
> - **Undershoot.** `setTargetAtTime` *already* undershoots — at a 22 ms time constant
>   a 45 ms vowel physically cannot reach its target, which is precisely the
>   phenomenon Lindblom describes. Applying an explicit blend on top undershot
>   everything twice: the schwa in *some* spent its entire life near the `/s/` locus
>   at F2 ≈ 1500 and the word came out **"sim"**. The glide is the primary model;
>   `TUNING.undershoot` (0.2, was 0.65) is a small correction on top.
> - **Schwa duration.** `AX` *is* the reduced vowel — it exists because the dictionary
>   said the syllable is weak — so applying the unstressed 0.8× on top left it at
>   45 ms with no time to reach anything. Now exempt.
> - **Weak forms.** Mapping every function-word vowel to schwa (see above) is the
>   same error in the vowel-quality domain.
>
> And the **stale-filter** family, of which there are now three known instances: a
> filter whose *gain* is scheduled but whose *frequency* is not keeps whatever the
> last phoneme left it at. Breath noise played through the `/s/` band; the nasal zero
> notched nasalised vowels at an arbitrary frequency; `nbp.Q` was assigned rather than
> scheduled. **If a filter parameter is set anywhere, set all of them, at the same
> time value.**

> **Undershoot — the coarticulation model.** Everything else here renders each
> phoneme at its *canonical* target. Real speech doesn't get there: a short
> unstressed vowel wedged between two consonants runs out of time and lands
> somewhere between its own target and the constrictions either side. That's
> Lindblom's undershoot, and it is the systematic difference between a correct
> sequence of phonemes and connected speech — a 60 ms schwa was previously hitting
> exactly the same formants as a 160 ms stressed vowel. The blend is exponential in
> duration (τ ≈ 75 ms), and **stressed vowels resist it**, because speakers
> hyperarticulate precisely where the information is. It is context-dependent by
> construction: the same schwa moves its F2 *up* between alveolars and *down*
> between labials.

> **Pre-voiced lengthening.** An English vowel runs ~1.5× longer before a voiced
> consonant than a voiceless one, and that ratio — not the final consonant's own
> voicing, which is often barely produced — is the primary cue separating *bad* from
> *bat* and *seed* from *seat*. Modelling the consonant's voicing without the vowel
> length that actually carries it left those pairs almost on top of each other.
> Mirrored in `estimateDuration`, and it nets out across the corpus (the lengthen
> and shorten are symmetric) so the broadcast hold is unaffected.

> **Declination resets per phrase.** Pitch drifting down as breath runs out happens
> over a *phrase*, not over however much text arrived in one message, and a speaker
> re-pitches at every full stop. Taking the fraction from the start of the whole line
> meant a long broadcast line sagged monotonically from first word to last and had
> nowhere left to go by the end — exactly where the long ones needed it. The run is
> split at `__` and each phrase gets its own declination.

> **Authored emphasis.** Scripts were already writing it and the synth was throwing
> it away: **11 % of spoken `.bsm` lines** carry an ALL-CAPS word — *"it is GONE!"*,
> *"slides into THIRD!"*, *"welcome to DEADBALL"* — and `pronounceWord` lowercased
> the token. A caps word now becomes an emphatic accent: a second marker `!` beside
> the ordinary `*`, carrying roughly twice the pitch movement, 1.28× duration, more
> gain and a brighter source tilt. Two guards: a line that is **predominantly caps**
> is shouted rather than emphatic and gets none (measured over its letters, so a
> title card is exempt), and a deaccented function word can still take emphasis.
> Spoken initialisms like `DMV` do pick up a little extra weight — a far smaller
> error than losing every real emphasis in the corpus.

> **Continuation rise.** A comma is not a full stop, so it no longer produces the
> same pause. `_C` (continuation, 180 ms) is distinct from `__` (terminal, 230 ms),
> and the vowel before a `_C` lifts instead of falling. Without it a list read as a
> run of separate little sentences, because every clause got the terminal fall.

> **Phrase-final creak.** English speakers routinely drop into vocal fry on the last
> syllable of a statement — pitch falls off a cliff and the pulses go irregular. A
> synth that ends every sentence on a clean tone sounds like it is reading a list of
> them. Applied only to falling terminals (never questions, which end lifted), as
> both a pitch drop and a jitter increase, since a steady low tone is a hum and not
> creak. `TUNING.creak = 0` disables it.

> **Formant amplitudes are cascade-derived.** A real vocal tract is a *cascade* —
> one tube whose poles all shape the same signal — so the height of each formant
> falls out of where the others sit. This is a **parallel** bank, the only shape Web
> Audio can automate, and a parallel bank has to be *told* those amplitudes. It was
> told a fixed `[1, 0.72, 0.42, 0.16]` for every vowel, which is right for none:
> when F1 and F2 sit close (back vowels) their skirts reinforce, and when they're
> far apart (`/iy/`) they don't. So rather than convert the architecture, the gains
> are derived the way Klatt's parallel branch does — evaluate the all-pole cascade
> transfer function at each formant, ~16 flops per phoneme.
>
> **They are rescaled, not applied raw**, and that distinction matters. Raw, the
> cascade puts F3 ~26 dB under F1 where the tuned bank had 7.5 dB. That isn't wrong
> physics, it's double-counting: the glottal source already carries its own
> −12 dB/octave, `tilt` takes more off the top and `presence` puts some back, so the
> bank's absolute calibration was tuned by ear against all three. What was missing
> was the vowel-to-vowel *variation*, not the overall balance. `CASCADE_FIT`
> rescales each index to preserve the tuned average (measured across the whole vowel
> inventory) while keeping the variation around it — front vowels now get a strong
> F3 (0.7–0.8), back vowels go dark (0.06–0.13), and `/er/` gets the strong low F3
> that defines it. The clamp applies *after* the rescale, or it would flatten the
> very variation this exists to produce.

> **Noise shaping — keep the peak, lose the spill.** A single bandpass is 2-pole, so
> its skirts fall at only 6 dB/octave and every fricative sprays energy right across
> the spectrum either side of the band that identifies it. That spill is what reads
> as hiss, and it carries **no phonetic information** — place of articulation lives
> in the peak. A second identical bandpass in series doubles the skirt slope while
> leaving the peak exactly where it was, because Web Audio normalises a bandpass to
> unity gain at its centre frequency, so two in series are still unity there.
> Measured on the `/s/` band (6 kHz, Q 2.5): **0.0 dB change at the peak**, −10.7 dB
> at 10 kHz, −19.9 dB at 16 kHz. Intelligibility is untouched by construction. A
> 9 kHz lowpass then removes the "air" above where English fricatives carry any
> contrast at all. `setNoiseBand()` drives both bandpasses so they can never drift
> apart and stop describing the same band.

> **Breath is now per-voice, not per-everyone.** It was `r()*0.02` — a uniform roll,
> so *nobody* drew zero and the entire cast whispered a little all the time, which
> matters because breath is the only noise that runs continuously. Two thirds of
> voices now get none at all and the rest get slightly more, which is both quieter
> overall and more distinguishing: breathiness now actually marks a voice out.

> **Pink noise, not white.** White noise has equal energy per Hz — which is
> ever-increasing energy per *octave*, far brighter than anything a throat makes,
> and it was what remained making the fricatives hiss once their levels came down.
> Speech gets its **own** buffer (pinking the shared `getNoiseBuffer()` would
> re-voice every SFX in the game) normalised by **RMS** to just under white's, so
> the tuned `ng` levels carry over and this is purely a change of colour. It is
> deliberately not peak-limited: pink from this filter is heavy-tailed, clamping to
> ±1 hit 4.5 % of samples, and rescaling by the loudest sample cost ~5 dB — neither
> is needed, since `noiseG` scales it to 0.11–0.24 long before the bus.

> **Transition rate is per-articulator.** A single 22 ms formant glide was wrong at
> both ends. The tongue leaves a stop or fricative constriction fast (12 ms), and
> moves through a glide slowly — a slow formant transition is the entire acoustic
> definition of `/w/ /y/ /r/`, so at 22 ms they stopped being glides and became
> short vowels. `tc` supplies it per phoneme. Diphthongs also hold their nucleus to
> 62 % and then glide quickly, rather than sliding linearly from halfway.

> **Effort, not just volume.** Two small things that stop stress reading as a gain
> knob. **Spectral tilt tracks stress** — a raised voice closes the folds harder and
> the source spectrum tilts *up*, so the tilt filter moves 4600 ↔ 6400 Hz with the
> accent. And **intrinsic F0**: high vowels sit slightly higher in pitch because the
> raised tongue body pulls on the larynx. It correlates inversely with F1, so it's
> derived from the formant target rather than tabled. Plus microprosody — F0 starts
> low after a voiced obstruent and high after a voiceless one.

> **Sibilance.** Three things were stacking into a constant hiss. The worst was a
> bug: breath noise is switched on during every vowel but never stated its own band,
> so it played through whatever the last fricative left behind — after any `/s/` that
> meant 6.5 kHz at Q 6, a narrow high hiss sustained *underneath every following
> vowel*. It now sets its own low, broad band (1400 Hz, Q 0.7), which is what breath
> actually is. Second, `presence` was a high **shelf** at 2.6 kHz — a shelf never
> comes back down, so it was lifting the 6–8 kHz sibilant band by the full +5.5 dB;
> it's now a wide peak at 3 kHz (+4 dB, Q 0.9), same clarity, no hiss. Third, every
> fricative shared one flat noise gain of 0.3, so `/s/` and `/ʃ/` shouted — they now
> carry a per-phoneme `ng` and sit *below* the weak fricatives, because this synth
> has none of the masking a real voice provides. `nq` came down with it: Q 6 at
> 6.5 kHz is a ~1 kHz-wide whistle, where real `/s/` is broadband hiss above ~4 kHz.

> **`/h/` is the following vowel, devoiced.** It has no constriction of its own — the
> turbulence is at the glottis while the tract is already in position for whatever
> comes next, which is why the `/h/` of *he* and of *who* are acoustically different
> sounds. A fixed 1500 Hz band made every one of them the same neutral puff. The noise
> is now shaped on the coming vowel's F2 and the formants start moving there during
> the `/h/`, so the vowel is in place when voicing arrives instead of sliding in after.

> **Polysyllabic shortening.** A syllable gets shorter as the word around it gets
> longer — the vowel in *cat* is measurably longer than the same vowel in
> *catamaran*. English compresses to stop word duration growing linearly with
> syllable count, and its absence made long words ponderous in a way no per-phoneme
> tuning could fix, because the fault was at word scale. Counted by lookahead once per
> word; 1 syllable 1.00, 2 → 0.94, 3 → 0.89, 4 → 0.85, flattening out as it does in
> real speech. Applied to vowels only — consonants are far less compressible.

> **Coarticulation crosses a word juncture.** `prevP`/`prevCode` are deliberately
> *not* reset at `_`, so the first vowel of each word keeps its left-hand context
> instead of being shaped only by what follows it. English coarticulates straight
> through a word boundary (*this year*, *did you*). A real phrase break does reset
> them, because there the articulators genuinely come to rest.

> **Syllable amplitude envelope.** A real syllable rises to a peak and falls away;
> one flat gain target for the whole vowel is a plateau, and a run of plateaus is the
> organ-like quality that survives even when every formant is correct. Each vowel now
> decays through its back half so it has a shape rather than a level.

> **A word boundary is a juncture, not a pause.** The `_` gap used to zero `voiced`
> like any other pause, opening a 40 ms hole between **every single word** — 8.5 per
> line across the corpus, which is precisely the word-by-word robot artifact.
> Connected speech doesn't do that: *the cat sat* is continuously voiced throughout
> and only a phrase boundary gets real silence. `_` now relaxes the voice to 0.45
> rather than cutting it, and the formants keep gliding through toward the next word.
> `_C` and `__` still go properly quiet.

> **Two pauses.** Connected speech doesn't stop between words; only phrase boundaries
> get real silence. A single 120 ms gap after every word was most of what made this
> read as dictation, so `_` (word gap) is now 40 ms and `__` (punctuation) is 210 ms.
> Pre-boundary lengthening keys off `__` alone — keyed off *any* pause it stretched
> the last sound of every word in the line.

Still not modelled: F5 movement, polysyllabic shortening and rhythm beyond
pre-boundary lengthening, emphasis or emotion, whisper/creak, and more than one
accent. Only one utterance plays at a time by design — `live` is a single flat
array and the broadcast pacing contract assumes one speaker.

### Connected-speech transforms

Applied over the finished run like `applyAccent`, because each depends on a
segment's **neighbours** rather than on the word it came from — and two of them
reach across word boundaries, which only became meaningful once a juncture stopped
being a silence.

- **Flapping** (`applyFlap`) — GA only. `/t/` or `/d/` between a vowel and an
  *unstressed* vowel becomes a voiced tap (`DX`): *better* → "bedder", *city* →
  "ciddy", *water* → "wodder". Blocked before a stressed vowel, so *atomic* and
  *attack* keep their `/t/`. **Skipped for RP** — the Library reads in RP, the
  network in GA. Its absence is a large part of why a GA dictionary read straight
  sounds stilted.
- **Nasal place assimilation** (`applyAssimilation`) — a nasal takes the place of
  the consonant after it, across a word boundary as readily as inside one: *in
  case* → `/ŋ/`, *ten past* → `/m/`, *in bed* → `/m/`. Nobody articulates those
  `/n/`s. Junctures are transparent to it; a real phrase break is not.
- **Devoicing** — an unstressed vowel trapped between two voiceless obstruents is
  partly whispered (*potato*, *support*, *suppose*). Voicing drops to 0.35 and
  breath fills in, so the syllable is still there but isn't *sung*. Fully voicing it
  is a small constant over-articulation — the sound of a machine pronouncing every
  letter it was handed.

### Voice smoke test — the gate

[`scripts/voice/smoke.mjs`](../scripts/voice/smoke.mjs), wired into
`pretest:regress` beside `shapes:smoke` and for exactly the same reason: before it
existed, **the only thing that ever checked a pronunciation was a person listening
to a broadcast and noticing**. Every defect in this system surfaced that way —
*intrusive*, *architect*, *some*, *Cyd* — meaning each one shipped, aired, and was
caught by luck.

It loads the engine headlessly (`audio-engine.js` is dual-mode and attaches to
`globalThis` when `window` is absent; `_phonemesFor` and `_estimateDuration` are
pure and touch no `AudioContext`), so it needs no browser, DB or network and runs in
about a second. It asserts **substrings** of each run rather than whole runs, so a
case fails on the contrast it exists for and not on unrelated tuning.

**It caught two real bugs on its first run**, which is the argument for it: the
suffix rules were guessing *truncated stems* (so `cypher` was guessed as `cyph`+er,
whose `y` had nothing after the digraph to open its syllable), and `ER` was emitting
its own `r` twice. Both had been shipping silently.

### The voice lab — tuning by ear

[`client/devpanel/voice-lab.html`](../client/devpanel/voice-lab.html). Every number
in the synth was reached by measurement plus a guess at how the guess would *sound*,
and measurement cannot settle the second half. The tunables are gathered in one live
object (`TUNING`, exported as `AudioEngine.voiceTuning`) and read at `speak()` time,
so the lab turns them with sliders and the next line spoken picks it up.

Twelve knobs — `rate`, `breath`, `sibilance`, `friction`, `aspiration`,
`presenceDb`, the three `tilt*` brightnesses, `emphasis`, `creak`, `lineGapMs` —
plus a phoneme readout (via the read-only `AudioEngine._phonemesFor` debug hook)
that shows stress, emphasis and pause types for the line you are about to hear.
Preset lines exercise the awkward cases: emphasis, questions, comma chains, nasals,
sibilants. Nothing persists — "Copy values" emits only what you changed.

Two cautions. `rate` is coupled: broadcast's `nodeHoldMs` is *fitted* to it, so
moving it far means refitting the hold or lines land on top of the voice. And
`lineGapMs` lives here rather than in `tv.js` precisely so there is one pacing
number, not two in different files quietly disagreeing.

### Rebuilding the dictionary

[`scripts/content/build-formant-dict.mjs`](../scripts/content/build-formant-dict.mjs)
regenerates `client/shared/formant-cmudict.js` from upstream CMUdict. Same rule as
`fetch-books.mjs`: bulk data with a known upstream, so the repo stores the result
and the derivation stays reproducible.

- **The word list is preserved exactly.** Upstream is ~126k base entries; the
  shipped subset is 25,787 curated words, and the whole file goes to every client
  on load. The script re-looks-up the *same* words rather than re-choosing them,
  and refuses to write if it kept under 98 % of them. The one deliberate addition is an explicit **contractions** list: the original subset had almost none, so every one of them fell through to the letter-guesser, which has no idea what an apostrophe means.
- Vowel tokens carry their stress digit, so the token set grew 39 → 69 while the
  blob stayed the same *length* — still one character per phone. 409 kB, +1 kB.
- CMUdict is redistributed under its BSD-style licence; the attribution is written
  into the generated file's header and must stay there.

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

- `glossary` is `readTier: 'boot'` and cached in memory — it is small (155 terms,
  133 aliases) unlike the books it annotates, so page turns are query-free.
- The term list came from a **corpus sweep**, not from reading: word frequencies
  across all nine books, minus anything in the bundled 25k common-word list
  (`formant-cmudict.js` doubles as the frequency filter), minus inflections of
  words already glossed. That leaves ~650 candidates, and the scope rule above
  decides which of them halt a sentence. 127 of the 155 terms fire somewhere in
  the corpus, 1,813 hits in all; the 28 that never fire are authored terms kept
  because a ninth book would want them.
- Only terms **occurring in the current chapter** travel to the client. Matching
  is one pass over the chapter's own word set, not 170 passes over the chapter.
- Wrapping runs **after** escaping and matches only letter runs, so it cannot land
  inside an entity or invent a tag, and it sits *inside* the narration spans so
  glossing and highlighting coexist.
- Authored by [`scripts/content/build-glossary.mjs`](../scripts/content/build-glossary.mjs),
  which rewrites the directory cleanly so a removed term loses its file (and
  therefore its prod row).

## The app arrives, it does not ship

A tablet pre-loaded with nine novels is a menu item. A tablet that grows a
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
| `client/game/js/panels/tablet-os.js` | `view:'library'` — `renderLibraryShelf` / `Cover` / `Contents` + the `.tos-lib-*` CSS; the page itself is `.tos-book` |
| `plugins/library/` | The unlock: `scan`, the intro, the `lending_terminal` tag |
| `scripts/content/fetch-books.mjs` | Text acquisition (Gutenberg/Wikisource) + lexicons |
| `scripts/content/build-glossary.mjs` | Glossary term authoring |
| `scripts/content/build-formant-dict.mjs` | Regenerates the stressed CMUdict subset |
| `client/devpanel/voice-lab.html` | Voice lab — live tuning + phoneme readout |
| `scripts/voice/smoke.mjs` | Voice smoke test — runs in pretest:regress |
| `client/shared/formant-cmudict.js` | GENERATED — 25,787 words with stress, one char per phone |
| `client/shared/audio-engine.js` | `applyAccent`, `ERR` phoneme, `lexLook` |
| `client/game/js/panels/tablet-os.js` | Narration, highlighting, minimize pill, gloss render |
