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

Caps: handle 16 · epithet 28 · last seen 340 · own words 150 · quote 90.

The **quote is never edited to fit**. Candidates are walked newest-first and the first that fits
wins; nothing qualifying prints `— said nothing worth printing —`. Chitchat is third-person stage
direction, so the picker lifts speech out of quotes and skips lines that are pure action, and it
rejects `$token` combat cries outright (a card is printed once and never re-rendered against a scene).

**Condition is spoken, not labelled**: a Battered coat is "gone thin at the shoulders". The band name
lives in the manifest on the back.

## Verbs

| Verb | Where | What |
|---|---|---|
| `mint` | `flags.card_mint` furniture | previews free, `mint confirm` charges and strikes |
| `buypack` / `sleeve` | `flags.vends_packs` furniture | opens the machine terminal; `buypack confirm` buys |
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
(`client/game/js/panels/cardpack.js`) — an ATM-shaped terminal on the shared minigame chassis, with a
lit product window, an odds board drawn from the **live pool**, your balance, and a tray that lights
when you're carrying unopened sleeves. Its buttons send the ordinary verbs (`buypack confirm`,
`openpack`); nothing in the panel decides anything, so a typed command and a clicked button take the
identical server path.

₵250 buys a **`card_foil_sleeve` item** into your inventory. It is an ordinary item — carryable,
droppable, giftable, storable — and it **holds no result**.

**The roll happens at `openpack`, never at the vend.** That is what makes an unopened sleeve honest:
it cannot be datamined, cannot be traded with known contents, and cannot go stale against a pool that
grew while it sat in your coat. It also means the moment is *chosen* rather than a side effect of
paying, which is the only reason the reveal is worth animating at all.

## The reveal

`cardpack_open` carries the whole outcome — every card's rarity, dupe flag, and its **server-rendered
face** (the same `renderCard()` the shelf uses, so the card you flip and the card you read later can
never drift). The client owns pacing and presentation and **decides nothing**. This matters more here
than in most panels: a reveal is the one place a player would be quickest to suspect the animation of
picking the outcome, and it can't — the cards were rolled and granted before the first frame drew.

One table (`RARITY` in `cardpack.js`) drives colour, ray count, screen flash, shake, the pre-flip
**hold** and the post-flip **dwell**, one row per rank. Reading straight down it is how you check the
ladder hasn't gone ragged, which is the easiest thing to break by tuning a single case. A Common gets
a dry paper tick and nothing else — deliberately, because if a Common got confetti a Legendary would
have nothing left to be. `hold` is also literally the SFX riser: `cards-flip-legendary` spends its
first 440ms climbing, so a legendary's 460ms hold lands the chord on the same frame as the face.

A **player card** adds a banner and a sting *on top of* its rarity cue, never instead of it — somebody
real is the rarest thing the system can hand you regardless of rank.

Sounds live in the shared catalog (`client/shared/sfx-catalog.js`, group `cards`), so they're
dev-panel tunable and DB-overridable like every other interface cue.

**The text log always lands alongside the overlay.** Closing the reveal mid-flip, or running an old
client that doesn't know the message type, costs the player nothing but the show.

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
