# cards — trading cards, minting, packs

**Built 2026-07-30.** Design write-up: [docs/proposals/trading-cards.md](../../docs/proposals/trading-cards.md).

A card is a **frozen snapshot of somebody**. Three subject types share one shell:

| Subject | How it exists | Rarity from |
|---|---|---|
| **player** | `mint` at a `flags.card_mint` terminal, ₵2,500, 7-day cooldown | best tier in the loadout (`tierIndex`) |
| **npc** | struck from `npcs` when a series opens | role — runs a shop, has a faction; `flags.card_rarity` overrides |
| **enemy** | struck from `enemies` when a series opens | **spawn scarcity** (`zone_spawns.spawn_weight` / `max_count`) |

## Why only players mint

The card system deliberately does **not** follow anybody around — tracking every player's kit for a
collectible would be a hot-path cost. So a player walks to a terminal and hands the system the
moment: this body, this loadout, these numbers, this thing they just said. The fee and the cooldown
are the price of that snapshot. An NPC or enemy row **is** static content, so those cards are struck
unattended and can never go stale.

## The rule that shapes the code

**Budgets, not truncation.** Every text region has a hard character cap and `builder.js` never
trims: it emits ranked clauses and stops at the first that would cross. An omitted clause is
invisible; a truncated one is a bug the player can see. `regress.js` tests this directly — a 900-char
enemy description must yield `null`, never a slice.

Caps: handle 16 · epithet 28 · last seen 440 · own words 150 · quote 90.

**The face is a photograph, and the card is written like a description of one.** Three rules follow
from that and all three are load-bearing:

- **A camera cannot see under a coat.** Covered layers never reach the prose — the shirt under the
  jacket and the underwear under the trousers are simply not in frame. They still count toward power
  and rarity, which are the record rather than the picture.
- **What you are armed with is a POSE, not a kit line.** `poseFor()` keys off the `weapon_skill` tag
  every weapon already carries, so a new weapon poses correctly with nothing authored, and a clawed
  hand poses in place of an empty one. Empty hands are a pose too — there is no "no weapon" case.
- **Chrome, mutation, mastery and psionics are woven into one sentence**, never printed as four
  labelled rows. ⚠ **Psionics only appears at Seer and above** — below that nothing in the game may
  state the mechanism (`docs/systems-psionics.md`), and a printed card is the most permanent
  statement there is. The Seer line claims nothing and is about the photograph, not the person.

**Two paragraphs, no headings.** The regions used to announce themselves ("Last seen", "In their own
words") and that is what made the face read as a form rather than as writing.

**The record replaces the manifest.** What sat under the prose was the kit list — a second, duller
copy of the sentence just read. It is now the half a photograph genuinely cannot show: lifetime XP,
top three skills, the order they lean toward (or *Unaligned*), their corp tag if they have one, and
the kill count — printed at zero on purpose, because "0 kills" on a trading card is a fact about
somebody. Gathered once by `gatherDossier()` in `index.js`; the builder stays pure and fetches
nothing. ⚠ Every cross-system module it needs is imported **at call time** — hoisting them to static
imports reorders engine initialisation ahead of the world map and takes the prologue skyline, the
tablet map, voidwalking and trucking down with it, in failures that never mention cards.

The **quote is never edited to fit**. Candidates are walked newest-first and the first that fits
wins; nothing qualifying prints `— said nothing worth printing —`. Chitchat is third-person stage
direction, so the picker lifts speech out of quotes and skips lines that are pure action, and it
rejects `$token` combat cries outright (a card is printed once and never re-rendered against a scene).

**Condition is spoken, not labelled**: a Battered coat is "gone thin at the shoulders". The band name
lives in `spec.conditions` on the back, never on the face.

**Field marks are LIFTED, never invented.** A real trading card carries a physical line (HT/WT/BATS),
and there are no physical columns on `npcs` or `enemies` — so the obvious move is to roll a height
from the id. That is the trap: an authored description reading "a vast slab of a man" beside a rolled
5'4" is a card arguing with itself, and the player believes the sentence, not the stat. Instead
`fieldMarks()` reads the author's own description and prints back the physical vocabulary already in
it — *tall · scarred · chromed*. A card therefore can never contradict its subject, an unauthored NPC
simply gets no marks line (an omitted region is invisible, per the budget rule), and a writer who adds
"one milky eye" gets it on the card for free. Coverage on live content is ~56% of NPCs and ~89% of
enemies. An enemy leads with `combatMarks()` — its physique *is* its stat line, so 80 HP and no dodge
prints "takes a beating · slow, and knows it" before the numbers appear underneath.

Two things the mark table is careful about, both regress-tested: **no false positives** (it matches
`pierced`, never `pierc\w*`, because "piercing gaze" is everywhere in the roster and a false mark is
worse than a missing one), and **no gendered wording** — the table can't see who it's about. Wear
adjectives (*filthy*, *grimy*) rank **last** precisely because half of Coldwater is described that
way, and ranking them early would win the four-mark budget on every card and crowd out the chrome arm.

Cards struck before marks existed get them from a one-shot: `node scripts/rederive-card-marks.mjs`
(converging, safe to re-run, merges rather than replaces so hand-edited text survives).

## Verbs

| Verb | Where | What |
|---|---|---|
| `mint` | `flags.card_mint` furniture | previews free, `mint confirm` charges and strikes |
| `buypack` / `sleeve` | `flags.vends_packs` furniture | opens the machine; `buypack confirm [coil]` buys (e.g. `buypack confirm B2`) |
| `openpack` / `tear` | anywhere you're carrying a sleeve | consumes one sleeve, **rolls**, reveals |
| `cards` | anywhere | your shelf; `cards <name>` reads one in full |
| `scrap` | `flags.card_mint` furniture | eats duplicates at ₵25 each |

Packs: sleeve **size is rolled** (4/5/6/7, plus a 1% nine-card mis-cut). Every card but the last
rolls against the pool; the last excludes Common, so every sleeve holds at least an Uncommon. Cards
are sorted **worst-to-best** before display — the pull builds and the hit lands last. A rank the pool
can't fill steps down to the best available, except the hit slot, which steps **up** so the guarantee
stays true on a young pool.

## Buying and opening are two acts

`buypack` does **not** transact. It returns `cardmach_panel` and the client opens the machine's face
(`client/game/js/panels/cardpack.js`) — a **vending cabinet** branded **ARCHITECT DRAFT** (never "the Mint";
minting is a player striking their own card at a terminal, and the machine doesn't sell that).
The brand is **one name in three places** — the item (`Architect Draft sleeve`), the fixture
(`Architect Draft card machine`), and the panel's marquee — so the sleeve in your pocket, the thing
in the room list and the cabinet you're standing at all say the same word. It is
deliberately not the shared minigame CRT chassis: a lit marquee, product on coils behind glass, no
scanlines (there is no tube in it), an odds board drawn from the **live pool**, your balance, and a
delivery flap that takes the hit when a sleeve drops. Clicking the machine in the room list opens this face directly (`flags.click_cmd`), so
`examine` no longer redraws the cabinet in the log — it leaves one line and the way in. Its buttons send the ordinary verbs (`buypack confirm`,
`openpack`); nothing in the panel decides anything, so a typed command and a clicked button take the
identical server path.

**Nine coils, and you pick one** (`machine.js`). Each coil `A1`–`C3` holds its own stock, shows it as
a visible stack, and can run out. The honest framing — printed on the cabinet — is that **the coil
picks your object, not your odds**: sealed sleeves are identical and the roll still happens at the
tear. Stock is **derived** from a hash of (machine id, game date, coil) with only the day's sales held
in RAM, so it needs no DB write per purchase and restocks as the date rolls with no tick. An empty
coil refuses before any money moves; a bare `buypack confirm` takes the fullest coil. The vend then
runs the hardware in four stages — coil turn → caught by the paddle → belt → chute and flap — measured
off the live layout, one sound per stage.

₵250 buys a **`card_foil_sleeve` item** into your inventory. It is an ordinary item — carryable,
droppable, giftable, storable — and it **holds no result**.

**The machine offers to tear it for you, and only offers.** The moment the sleeve lands in the tray
the panel's TEAR button takes the primary style and the vend's log line carries a clickable
`openpack` — a player who bought by typing never sees the cabinet's buttons, so the offer has to
exist in both places. It stays an offer: nothing auto-opens, the panel doesn't close itself, and
buying a second sleeve is one click away where it always was. Carrying a sealed sleeve out of the
room is the whole reason the roll happens at the tear.

**The coil decides the sleeve; the pool decides the faces.** Each sleeve on a coil has a **seed**
fixed when it was loaded, derived from (process salt, machine, game date, coil, depth) and stored on
the sleeve's own inventory row — one integer, not a card list, because `mulberry32(seed)` rebuilds the
identical sleeve at tear time through the `rand` argument every roller already took. So a player's
physical choice genuinely determines the result: the third sleeve down B2 is a specific sleeve.

The seed **never leaves the server**, so a sealed sleeve still can't be read or traded with known
contents; and the seed fixes only the **ranks**, with the live pool at tear time filling the faces, so
a sleeve still can't go stale in your coat. The reveal prints the coil it came off — the one thread
between a choice and an outcome, and the seed of every superstition about a particular column.

**Hot runs.** ~1 sleeve in 12 (`HOT_CHANCE`) rolls with **triple weight on epic and legendary**
(`HOT_RANK_WEIGHT`): epic-or-better goes from 6.4% to 16.8% of cards dealt, legendary 1.3% → 3.4%.
Derived from the sleeve's seed on a **separate stream**, so asking whether it's hot doesn't perturb
the roll. **Invisible until the tear** — a spottable hot sleeve is just the sleeve everybody buys, and
the coil choice would collapse into "take the gold one". It announces itself between the tear and the
first card, where it retunes expectations instead of being a footnote.

Everything else about the split still holds:
an unopened sleeve
cannot be datamined, cannot be traded with known contents, and cannot go stale against a pool that
grew while it sat in your coat. It also means the moment is *chosen* rather than a side effect of
paying, which is the only reason the reveal is worth animating at all.

## The reveal

`cardpack_open` carries the whole outcome — every card's rarity, dupe flag, and its **server-rendered
face** (the same `renderCard()` the shelf uses, so the card you flip and the card you read later can
never drift). The client owns pacing and presentation and **decides nothing**. This matters more here
than in most panels: a reveal is the one place a player would be quickest to suspect the animation of
picking the outcome, and it can't — the cards were rolled and granted before the first frame drew.

One table (`RARITY` in `cardpack.js`) drives colour, ray count, screen flash, shake, the pre-flip
**hold** and the **dwell**, one row per rank. Reading straight down it is how you check the
ladder hasn't gone ragged, which is the easiest thing to break by tuning a single case. A Common gets
a dry paper tick and nothing else — deliberately, because if a Common got confetti a Legendary would
have nothing left to be. `hold` is also literally the SFX riser: `cards-flip-legendary` spends its
first 440ms climbing, so a legendary's hold lands the chord on the same frame as the face.

**The card waits for you.** `AUTO_MS` is a flat **15 seconds** for every rank, and a click takes it
early. It used to auto-advance after the rank's own dwell — under a second and a half on a Common —
which meant the pacing decided how long you were allowed to look at your own card and a player who
wanted to *read* one had to race it. A visible bar counts the wait down, so moving on always reads as
a choice made or declined. `dwell` survives as the **shimmer budget**, not a timer.

**The shimmer.** After the flip, the card's own regions light in reading order — name, rank line,
field marks, each block, the power number — one at a time, each with a band of light raked across it
and a tick pitched up a pentatonic scale. It selects the classes `renderCard()` already emits, so a
card that grows a new block gets shimmered for free, and the tick is a *generated* synth def rather
than a catalogue cue: one shape, transposed, which stays in tune however many blocks a card has.

**Escalation past Rare.** Epic and up add a slow rotating **corona** that outlives the burst (the
burst says something happened; the corona says it is still happening), and a prismatic holo wash on
the face. Legendary and Architect add falling **dust**. Each card clears the previous card's lingering
effects first — otherwise a Common inherits a Legendary's corona and the ladder stops meaning anything.

**The tear** got the same treatment: the seam burns as it runs, then the pack gives up its contents
with a shock ring, a flash and a stage kick, so it reads as *opened* rather than as having disappeared.

**The summary is browsable.** Every card in the end wall is clickable and opens that card full-size
with a Back button. The reveal moves at its own pace and a player will always miss one; this is where
they go back and actually read it, without leaving the overlay or typing anything. The detail view
deliberately gets **no flip, no rays, no sound ladder** — the reveal is the moment, and re-running the
cinematic on demand would cheapen the first one.

A **player card** adds a banner and a sting *on top of* its rarity cue, never instead of it — somebody
real is the rarest thing the system can hand you regardless of rank.

Sounds live in the shared catalog (`client/shared/sfx-catalog.js`, group `cards`), so they're
dev-panel tunable and DB-overridable like every other interface cue.

**The text log always lands alongside the overlay.** Closing the reveal mid-flip, or running an old
client that doesn't know the message type, costs the player nothing but the show.

## The Binder (tablet app)

`plugins/tablet/binder-app.js` — the collection as a collection, which the `cards` verb can't be: a
scrolling list answers "what have I got" and never "what shape is this". Every rank is a shelf with a
completion bar, your cards drawn as tiles (dupe count, field marks) and **the gaps drawn as empty
sleeves**. Tap any card to read its full face — the same server-rendered markup the reveal uses.

Two contracts worth not undoing, both regress-tested:

- **The denominator is real**, unlike the Accolades file next door. That app hides its total on
  purpose (naming an unearned joke spoils it); a card set is the opposite — "31 of 214" *is* the
  feature, and a collection without visible completion is just a pile. Completion counts the
  **rollable** set only (`pool_weight > 0`), because the Architect rank never rolls and including it
  would put 100% permanently out of reach.
- **Gaps are counted, never named.** An empty slot is the ache the system runs on; an empty slot with
  a name on it is a shopping list, and it would leak the roster of everyone who has minted.

Cold path: two reads, only when the app is opened. No tick, no cache.

## Admin

- Dev panel → **🎴 Cards**: list, edit rarity/pool weight/text blocks with live character counters,
  preview, re-derive from source, strike a series, issue an Architect card.
- `strikeSeries(n)` is **idempotent** — already-carded subjects are skipped, so it is safe to re-run
  after adding content.
- **Architect** is the admin-only rank: `pool_weight` 0, so it never rolls and never appears in a
  pack. It only enters circulation by being traded.

## Cost

No tick. No hot-path query. The pack pool is cached in memory behind one writer (`invalidatePool()`
on every insert/edit). `cards`/`card_holdings` are `runtime`/`player` class in the content registry —
they never export, because `strikeSeries()` rebuilds the content-derived half on any database.
