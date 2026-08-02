# Trading Cards — Mint, Packs & Rarity (BUILT 2026-07-30)

> **Status: BUILT.** Shipped as [`plugins/cards/`](../../plugins/cards/README.md) — the `cards` /
> `card_holdings` tables, the `mint` / `cards` / `buypack` / `sleeve` / `openpack` / `tear` / `scrap`
> verbs, the dev-panel **🎴 Cards** tab, and 19 machines in world content. The machine is an
> ATM-style terminal panel and the sleeve is a real inventory item opened by a fullscreen reveal
> cinematic, both in `client/game/js/panels/cardpack.js` — see **§5b** for why buying and opening are
> two separate acts. This document is the design rationale and stays authoritative on
> *why*; the plugin README is the quick reference.
>
> It answers the adopt/drop question left open in [systems-cards.md](../systems-cards.md) — the
> answer was **adopt**. The portrait renderer (`client/game/js/card-render.js`) is untouched and
> still unwired: **portrait is one of two faces a card can wear**, and the text face is the one that
> ships, because an enemy has no silhouette and a text card can say what a tint cannot.
>
> **Still open:** the portrait face is not wired to the card view; there is no tablet app (the shelf
> reads through the `cards` verb); trading a card between players goes through no bespoke path yet.

A card is a **snapshot of somebody on a specific night** — their body, what they were wearing, what
they'd written about themselves, and something they said. It is minted for money, it goes into a
global pool, and other players pull it out of a vending machine in a foil sleeve.

The loop, in one line: **mint your card → your card enters the pool → somebody buys a pack → they
get you.**

Three kinds of somebody: **a player, an NPC, or an enemy.** One card shell, one budget system, one
rarity ladder — see §2.

---

## 1. The load-bearing rule: budgets, not truncation

The mockups that led here cut a quote off mid-word. That can never happen on a physical object, and
a card that ellipses is a card that looks broken. So:

**Every text region on a card has a hard character budget, and the builder never truncates. It omits
whole clauses in priority order until the remainder fits.**

An omitted clause is invisible — the sentence still reads as English. A truncated clause is a bug
the player can see. This is the same instinct as `firstSentence()` in `commands/describe.js`: take
whole units or none.

### The card template and its budgets

Fixed 5:7 card, one type scale, no auto-shrink (auto-shrink is how you get one card in the binder
set in 9px). Budgets are measured in characters at the region's set size and were derived by filling
each region with `M` at the widest weight.

| Region | Budget | Source | Over budget → |
|---|---:|---|---|
| Handle | **16** | `players.handle` | Handles are already capped shorter at signup; a legacy over-16 handle blocks mint with a clear reason |
| Epithet | **28** | `players.archetype` + origin tag | Drop the origin tag, then the epithet entirely |
| **LAST SEEN** | **340** | body + equipped, prose | Clause ladder, below |
| In their own words | **150** | `players.origin_fragment` | Whole sentences from the start until the next would exceed; if sentence 1 alone is over, the region renders empty |
| Overheard | **90** | captured `say` | Never trimmed — an over-90 line is simply not eligible; the mint looks further back |
| Footer | fixed | date / zone / seed | Zone name over 24 chars falls back to its district |

`origin_fragment` is already `slice(0, 200)` at the API (`routes.js:2746`). We do **not** lower that —
the field is used in `examine` too. The card takes whole sentences up to 150 and stops.

### The LAST SEEN clause ladder

The prose is assembled from ranked clauses. Emit in order, keeping a running count; the first clause
that would cross 340 ends the paragraph, and every clause after it is skipped too (skipping *around*
a clause reorders the sentence and reads worse than stopping).

1. **Body** — `physicalDescription()`, minus the closing period.
2. **Mutation tell** — folded into the body clause as `— and something about him that isn't quite human anymore`.
3. **Torso + head**, outermost first, tinted by tier.
4. **Condition damage** on any piece at Battered or worse, spoken (`gone thin at the shoulders`,
   `split through at the knuckles`) — never the band name. The word "Battered" belongs on the back.
5. **Legs + feet.**
6. **Weapon**, as its own short sentence.
7. **Covered layers** (`over a patched kevlar vest`).
8. **Accessories**, as a trailing clause.

Ranks 1 and 3 are mandatory: a card that can't afford them is not mintable, which in practice means
a naked player with an 80-character handle-adjacent build string. That case gets its own copy
(`Nothing on. Nothing to report.`) rather than an error.

**Condition is spoken, tier is a tint.** Both are drawn from live data (`player_inventory.condition`,
`tierIndex(value, armor)`) and both are **frozen at mint**. This is what makes an early card worth
keeping: you cannot re-mint your way back to the night the gloves were still good.

### The quote

The **Overheard** line is the player's most recent `say` **in the mint zone, within the last 30
minutes, at or under 90 characters, no command-looking text**. The mint walks backwards through
eligible lines and takes the first that fits. If nothing qualifies the region renders its silence
copy — `— said nothing worth printing —` — which is itself a fine card.

Two quotes, two jobs, and they must not be conflated: *In their own words* is `.describe`, who they
say they are. *Overheard* is something they actually said out loud. The second is what makes the
card feel like a moment instead of a record.

---

## 2. Three subject types

A card's subject is a **player**, an **NPC**, or an **enemy**. They share the card shell, the
budgets, the rarity ladder and the pool — a sleeve mixes all three. What differs is only where each
region's text is sourced. Keeping one shell is what stops this becoming three designs.

| Region | Player | NPC | Enemy |
|---|---|---|---|
| Handle (16) | `players.handle` | `npcs.name` | `enemies.name` |
| Epithet (28) | `archetype` | `npcs.faction` + district | `enemies.faction` or `behavior` |
| **Last seen** (340) | body + equipped, prose | `npcs.description` + `flags.clothing_layers` | `enemies.description` |
| In their own words (150) | `origin_fragment` (`.describe`) | `flags.card_note`, else first `chitchat` | `enemies.death_message`, reframed as what it leaves behind |
| Overheard (90) | last qualifying `say` | `flags.card_quote`, else a `banter` turn, else `chitchat` | a `flags.battle_cries` line |
| Power | `deriveCard(items).power` | flat by faction | from `hp_max`, `hit`/`dodge`, weapon components |

**NPCs are auto-derived.** Every NPC in the world is a card without anybody authoring one: the row
already carries `description`, `flags.clothing_layers`, `chitchat` and `banter`. Named NPCs who
deserve better get three optional overrides on the NPC row — `flags.card_quote`, `flags.card_note`,
`flags.card_rarity` — so authoring effort goes only where it shows. An NPC with none of them still
produces a perfectly readable Common.

Reuse, don't rebuild. `npcClothingLine()` and `nakedDescLine()` (`server/engine/commands/world.js:83-103`)
already phrase an NPC's outfit; the card wants the **whole `flags.clothing_layers` array** rather
than just the outermost garment, so it reads the array and borrows the phrasing. The examine branches
to match for tone are enemy `world.js:853-862` and NPC `world.js:863-875`. Note `npcs.banter` is
**arrays of turns**, not flat strings — a quote picker has to reach into a turn.

**An enemy card is a different kind of object, deliberately.** No `.describe`, because a rot-hound
has never written anything about itself. Its *In their own words* slot instead carries the
`death_message` reframed as what it leaves behind, and *Overheard* takes a `battle_cries` line — so
the enemy card reads as a **field guide entry**, and the shelf has two registers on it rather than
one. The back face swaps the six `stat_*` bars for combat numbers: `hp_max`, `hit`, `dodge`, weapon
damage components (`schema.js:738-743`; the combat fallback is `combat.js:813`), and butcher yield.

**Enemy cards are packs-only.** No kill-drop. Everything in the set arrives through one funnel, which
keeps the pool the single thing to balance and keeps a sleeve worth opening.

---

## 3. Rarity

Six ranks. For a player, five are **derived from the loadout** at mint — the same `tierIndex` roll the
portrait renderer already does, so chasing an impressive kit to mint a better card is the natural
flex loop. The sixth cannot be rolled at all.

| Rank | Roll | Pool weight | Notes |
|---|---|---:|---|
| Common | `deriveCard.tier` 0 | 58% | |
| Uncommon | 1 | 25% | |
| Rare | 2 | 12% | |
| Epic | 3 | 4% | |
| Legendary | 4 | 1% | Needs a legendary-tier piece carried at mint |
| **Architect** | — | **0%** | **Admin-issued only. Never rolls, never appears in a pack's random slot.** |

**Architect** is the special rank, named for the game. It is issued by an admin command
(`@cardgrant <handle>`) and is the only way a card exists that the mint didn't sell. Use it for
event prizes, contributor cards, and the handful of staff cards that ought to exist. Visually it is
the one rank that breaks the frame: the foil border animates, and the serial reads `№ A-07` rather
than a series number. Because its pool weight is zero, an Architect card only ever enters circulation
by being **traded** — which is exactly the scarcity you want.

Rarity is stored on the card row, not recomputed. A rebalance of `tierIndex` must never restat
somebody's shelf.

### Rarity for the other two subjects

Neither an NPC nor an enemy has a loadout to roll, so each needs its own ladder:

- **NPC — rank by role**, set explicitly in `flags.card_rarity` and defaulting to Common so an
  unauthored NPC still works. A background drunk is Common; a shopkeeper Uncommon; a named vendor or
  quest-giver Rare; a faction head Epic. Legendary is reserved for the handful of people the world
  is actually about.
- **Enemy — rank by spawn scarcity**, derived rather than authored. `zone_spawns.spawn_weight` and
  `max_count` are the only rarity signal the codebase has: **there is no boss, elite, tier or level
  flag anywhere** (grepped; zero hits). So something spawning everywhere at weight 100 is Common,
  and a `max_count = 1` single-zone spawn is Legendary. This falls out of existing content with no
  authoring pass, and it has the right instinct built in — the thing you rarely meet is the thing
  worth pulling.

---

## 4. Minting

Minting is a **player** action about **themselves**. There is no verb that points at a target: you
cannot mint another player, an NPC, or an enemy.

**And that asymmetry is the reason minting exists at all.** The card system does not follow a player
around. It has no idea what you're wearing right now, what your stats are today, or what condition
your gloves are in — and deliberately so, since watching every player's kit would be a hot-path cost
for a collectible. So a player has to **walk to a terminal and hand the system the moment**: this
body, this loadout, these numbers, this sentence I just said. The fee and the cooldown are the price
of that snapshot.

An NPC or an enemy needs no such thing. Their rows *are* static content — a rot-hound's description
and stats are the same today as they were at series open — so the system can strike those cards
unattended (§5) and they never go stale. Nothing living is being captured, so nothing has to be
handed over.

**Where.** A `card_mint` terminal — furniture, one per major district, plus the Coldwater Mint proper.
Not a bare verb: standing somewhere specific is what makes the footer's zone line mean anything.

**Verb.** `mint` at the terminal. It runs a **preview first** — the full card, rendered, with any
region that came up empty called out — then asks for confirmation. Nobody should pay and *then*
discover their quote didn't qualify.

**Cost.** ₵2,500 flat. Not tier-scaled: scaling the fee would tax exactly the players whose cards the
pool most wants.

**Cooldown.** 7 days per player. This is the pool's only real defence against one person minting
forty near-identical cards, and it doubles as the reason a card is dated.

**What it does.**
1. Freezes the spec: `{owner, body, item_ids[], conditions[], seed, minted_at, zone_id, rarity, power}`
   plus the three text captures (`last_seen`, `origin`, `overheard`) **as rendered strings**. The
   strings are stored, not re-derived — an item renamed in content two months later must not silently
   rewrite an old card.
2. Grants the minter a copy of their own card, always.
3. Adds the card to the **pool** at its rarity weight.

**Series.** Cards are numbered within a series (`№ 0041`). A series closes on a date and a new one
opens; pack machines stock the current series plus a thinning tail of the last.

---

## 5. Packs and the machines

**The machine.** `flags.vends`-style dispenser furniture, reusing the existing
[vending](../../plugins/vending/) plugin's shape — but packs are not a flat item id, so this needs a
sibling gate (`flags.vends_packs: <series>`). Coldwater kitsch: hand-lettered sign, one row
permanently sold out.

**Machines need power, like everything else.** Author each one with `power_draw_kw: 0.4` and
`flags.plugged_in`, which is all the [appliances](../../plugins/appliances/) plugin needs — it treats
`power_draw_kw != null` as "pluggable" (`plugins/appliances/index.js:27`), respects
`flags.plugged_in !== false` (`:22-24`), and the vending plugin already refuses to dispense from an
unplugged unit. The draw sums into the zone's grid load (`server/engine/environment.js:570-586`), so
a machine in a browned-out district is **dark and useless** — which is exactly the texture we want.
A blackout should take the card machines with it.

### Where they go

| Kind | Count | Placement |
|---|---:|---|
| **Mint terminal** | 4–6 | Institutional only. Prestige is the point — you go *to* the Mint. |
| **Pack machine** | 10–15 | High-traffic public interiors, and one street plaza. |

**Mint terminals** — `zone_citadel_hall` (Citadel Financial's Marble Hall, already the ATM's home and
the obvious flagship), `zone_citadel_gallery` (Safe Deposit Gallery), `zone_records_reading` (the
Paper Tomb's Reading Room — a card *is* a record), `zone_ward_permits` (Office of Permitted
Suffering, for the joke of queueing to be issued yourself), and `zone_casino_interior` (The Neon Vig,
the one disreputable mint). Optionally `zone_citadel_vault` as an ultra-rare fifth.

**Pack machines** — `zone_kessel_shop` (Bodega Vu), `zone_mq_grocery` (Ration Nine), `zone_mq_amp_shop`
(Ohm Sweet Ohm), `zone_halcyon_concourse` (Halcyon Arcade), `zone_casino_interior`,
`zone_clinic_interior` (Mercy Row) and `zone_meltwater_clinic` (Co-Pay & Pray) for the waiting rooms,
`zone_mq_pigeon_bar` (The Dead Pigeon), `zone_bld_899_1171_lobby` (the Saloon Floor, by the job
board), `zone_meridian_lobby` and `zone_yards_tenement_lobby` (apartment lobbies), `zone_hangar_outskirts`
(Coldwater Regional), `zone_mq_precinct_lobby` (the precinct, which is very funny), and
`zone_district_910_911` — the plaza that already proves a street vend site works with
`furn_newsstand_plaza`.

`zone_embassy_floor2` already holds `furn_floor2_vending`, a **dead** snack machine. Leave it dead
and put a card machine beside it: a working one next to a corpse is better world-building than
refurbishing the corpse.

### The interface

Vending is text-only today, and the vending README calls out the discovery gap itself: `flags.vends`
is a flag-value gate and the machine has to cue itself in prose. A card machine deserves better.

**As built, the window opens on `examine` — it is not in the room description.** It shipped on
`zone.furniturePanel`, welded into the room prose with gametable's poker-chair panel as the model,
and that was the wrong seam for this object. A poker table collapses four furniture rows into one
control and earns its space; a vending machine is a thing you walk up to, and a block of cabinet art
in every look at every shop that owns one is clutter the player can't dismiss. So the machine lists
as ordinary furniture, and **`furniture.describe`** renders the machine's line when you examine it.
Unpowered, that block renders dark with the glass reflecting the room back: visibly present and
visibly useless, rather than silently absent.

**Revised again: the click opens the panel, and the log stopped drawing the cabinet.** Even scoped to
examine, the lit product window was a second drawing of a machine whose real face is the panel — and
the click, being an ordinary furniture click, sent `examine` and printed that second drawing instead
of opening the first. So the piece carries **`flags.click_cmd: buypack`** (`card_mint` → `mint`),
a generic engine seam in `describe.js`: any furniture may name the command its own click sends. It is
content-authored, so the engine learns no plugin's flags, and the verb still runs through the ordinary
dispatcher. Powered `examine` now leaves one line and the USE control; the product window lives in the
panel alone.

The control sends its verb through `data-action="cmd" data-cmd="buypack"`. The first cut used
`data-action="buypack" data-target=""`, and the empty target was fatal — `handleActionLinkClick`
bails on `!action || !target`, so the sole control the panel advertised was the one route that could
never fire. Discovery is no longer panel-only either: `buypack`/`mint`/`scrap` are registered as
**declaration-only specialized actions** under `requiredFlag`, so examine's Actions row and the
mobile smart bar list them like any other affordance.

**You never ask for anything.** There is no verb that requests a subject type, a rarity, or a named
card. You buy a sleeve and the sleeve decides. This is not a shop with a catalogue — the whole
pleasure of the object is that somebody else's card falls out of it.

**The pack.** ₵250 for a **foil sleeve**. How many cards is itself part of the pull:

| Sleeve | Chance |
|---|---:|
| 4 cards — a short one | 22% |
| 5 cards — standard | 48% |
| 6 cards | 22% |
| 7 cards — a fat sleeve | 7% |
| **9 cards — a mis-cut** | **1%** |

Randomising the count is cheap and it does real work: the moment the sleeve tears open you already
know whether this is an ordinary one, before a single card has been read. The 1% mis-cut is the
Coldwater Mint being exactly as well-run as everything else in the city.

**Every card but the last** rolls against the pool at the weights above. **The last card is the hit:**
rolled with Common excluded and the remainder renormalised, so every sleeve contains at least an
Uncommon regardless of how long it is. That guarantee is the single most important number in the
design — a pack that can be all commons is a pack nobody buys twice.

**Reveal in ascending rarity.** The sleeve's cards are sorted worst-to-best before they're shown, one
at a time. So a pull always builds, the hit always lands last, and a sleeve that's mostly commons
still has a shape to it. It also means a long sleeve isn't automatically a good sleeve — seven
commons and an uncommon is a slow, funny disappointment, which is a real outcome worth having.

### 5a-bis. The Binder, field marks, and the reveal *(as built)*

Three later additions, documented in full in [plugins/cards/README.md](../../plugins/cards/README.md):

- **Field marks** — the physical line every card now carries, **lifted from the subject's own
  description rather than invented**, so a card can never contradict the prose it was built from.
  Enemies lead with their combat shape. Backfill for already-struck cards:
  `node scripts/rederive-card-marks.mjs`.
- **The Binder** (`plugins/tablet/binder-app.js`) — the collection as shelves with real completion
  denominators and **anonymous** empty slots.
- **The reveal** — a flat 15-second wait per card instead of a rarity-length auto-advance, a
  sequential shimmer over the card's own regions, corona/dust tiers above Rare, and a browsable
  summary where every card opens full-size.

### 5b. Buying and opening are two acts *(as built, revised)*

The first cut charged and revealed in one breath off a bare `buypack`. It no longer does, and the
split is load-bearing in three places:

**The machine is a cabinet you stand at.** `buypack` returns `cardmach_panel` and the client opens the
machine's face (`client/game/js/panels/cardpack.js`). It is a **vending cabinet and not the shared
minigame CRT chassis** — the one device in the game that isn't a screen you read but a box you buy
something out of, so it gets a lit marquee, product on coils behind real glass, physical pushbuttons
and a delivery flap, and it gets **no scanlines**, because there is no tube in it and a scanline over
a shelf of merchandise reads as a bug. It carries an odds board drawn from the **live pool** (a rank
nobody has minted shows as a flat nub rather than an advertised chance that cannot pay out), your
balance, and a tray that lights when you're carrying unopened sleeves. The cabinet is branded **FOIL
PLAY**, never the Mint: minting is what a player does to themselves at a terminal, and a machine that
borrowed the word would be advertising a service it doesn't sell. Opening it costs nothing — it is
the thing you read the price off. Its buttons send the ordinary verbs, so a typed command and a
clicked button take the identical server path and the panel decides nothing.

**You pick the coil** (`plugins/cards/machine.js`). Nine coils, `A1`–`C3`, each with its own stock,
each able to run out; the panel draws the stack behind the glass so a coil two from empty *looks*
different from a full one, and `buypack confirm B2` is the same act from the keyboard. The rule that
keeps this honest: **the coil picks your object, not your odds** — every sealed sleeve is identical
and the roll still happens at the tear, so choosing is the physical choice a real machine offers and
nothing more. That sentence is printed on the cabinet rather than left for a player to discover by
testing it in an evening. An empty coil refuses **before** money moves, and a typed `buypack confirm`
with no code falls back to the fullest coil, so the verb never fails for want of a choice.

Stock is **derived, not stored**: a hash of (machine id, game date, coil) gives the base layout, and
only the day's *sales* live in RAM. So it is stateless, identical for every player at the same machine
on the same day, self-restocking as the date rolls with no tick to run it, and it adds **no DB write
per purchase** — which is the write the persistence tiers exist to refuse. A restart forgetting that
a stranger emptied B2 an hour ago is the correct amount of memory for a vending machine.

**The vend is a mechanism, not a fade.** Coil turns → the sleeve tips off it → it is **caught** by a
sprung paddle that parks under the coil you chose → a **belt** carries it across the deck → it goes
down the **chute**, the flap bangs and the cabinet shudders. Every position is measured off the live
layout and driven through the Web Animations API rather than baked into a keyframe, so it works at any
cabinet size and always starts at the coil the player actually pressed. Four stages, four sounds
(`cards-coil` / `cards-catch` / `cards-belt` / `cards-chute`), sequenced rather than mixed. It runs
**only on the server's vend message**, so it is a report of what happened and never a promise: a
refused buy shows nothing moving. `prefers-reduced-motion` skips the journey and keeps the report.

**The sleeve is an item.** ₵250 buys a `card_foil_sleeve` row into your inventory — carryable,
droppable, giftable, storable, and holding **no result**.

**The coil decides the sleeve; the pool decides the faces** *(revised — this replaces the original
"the roll happens at `openpack`, never at the vend")*. The first rule was written when every coil was
the same coil, and it made the pick decorative: if contents are decided at the tear, a player's
physical choice provably cannot matter. Now each sleeve on a coil has a **seed** fixed when it was
loaded — the third sleeve down B2 is a specific sleeve, and taking it gets you what was in it. The
seed is derived from (process salt, machine, game date, coil, depth) and rides on the sleeve's
inventory row, so it survives a restart, a trade, and a month in a coat pocket. It costs **one
integer**, not a stored card list, because every roller in `builder.js` already took a `rand`
function: `mulberry32(seed)` rebuilds the identical sleeve at tear time.

What the original rule was protecting is still protected, which is why the change is safe:

| Property | How it survives |
|---|---|
| A sealed sleeve can't be datamined | The seed never leaves the server and is never in a payload. |
| It can't be traded with known contents | Nobody — including its owner — can see what's in it until it's torn. |
| It can't go stale | The seed fixes the **ranks**; the **live pool at tear time** fills the faces, so a month-old legendary can pay out somebody who minted yesterday. |
| The moment is still chosen | `openpack` is still a separate act on an item you carry. |

The process **salt** is what stops the mapping being recomputable from public content ids — without
it a player could scout every machine in the city. Re-salting on restart only ever changes sleeves
nobody has bought; a bought sleeve carries its own seed and is immune.

The reveal prints the **coil it came off**, which is the only thread tying an outcome back to a
choice — and the seed of every superstition a player will ever form about a particular column. That
folklore is the point of letting them choose.

**Hot runs.** About **one sleeve in twelve** (`HOT_CHANCE = 0.08`) comes off the line with triple
weight on epic and legendary (`HOT_RANK_WEIGHT`), everything else untouched. Measured over 20k
sleeves that moves epic-or-better from **6.4% to 16.8%** of cards dealt, and legendary from **1.3% to
3.4%**. Hotness is derived from the sleeve's own seed on a **separate stream** (the golden-ratio
constant), so asking whether a sleeve is hot never perturbs the sleeve it rolls — there is a regress
case on exactly that. It is **invisible until the tear**: a hot sleeve you could spot behind the glass
would simply be the sleeve everybody buys, and the coil choice would collapse into "take the gold
one". So the sealed pack looks ordinary, the gold is *under* the foil, and the run announces itself in
the gap between the tear and the first card — where it retunes your expectation of everything about
to be dealt. After the cards it would be a footnote.

The older reasoning, which still holds for everything except *when* the roll is fixed:
An unopened sleeve cannot be
datamined, cannot be traded with known contents, and cannot go stale against a pool that grew while
it sat in your coat. It also makes the moment *chosen* rather than a side effect of paying — which is
the only reason the reveal is worth animating at all.

**The opening.** The animation is the product. Sequence:

1. The sealed sleeve sits on screen, foil sheen raking across it, seam scored. **You** tear it.
2. It **tears** — a foil rip that climbs, the top strip spins off, flecks scatter.
3. Cards arrive **one at a time**, worst first, face down on the Mint's house back — shared by every
   card in the game, which is what makes the flip mean anything: until it turns you know nothing.
4. Each card holds, then flips. **The hold is the tell** — a Common barely has one; a Legendary sits
   on a riser for the better part of half a second before turning. By the third card a player is
   reading the *rhythm* rather than the text.
5. Rank drives colour, ray burst, screen flash, shake and dwell off one row of the `RARITY` table.
   A Common gets a dry paper tick and nothing else, deliberately: if a Common got confetti, a
   Legendary would have nothing left to be.
6. A **player card** adds a banner and a sting *on top of* its rarity cue, never instead of it —
   somebody real is the rarest thing the system can hand you regardless of rank.
7. Anything already on your shelf stamps **DUPE** and its scrap value, so the good news and the bad
   news arrive in the same motion.
8. A summary lays the whole sleeve out with the best pull named, the scrap total, and — if you're
   carrying another sleeve — a button to tear that one too.

Cards **auto-advance** on a rank-scaled dwell, so a player can watch a whole sleeve without touching
anything; any click or Space skips ahead, and SKIP jumps straight to the summary. A player buying
their fortieth sleeve must not be held hostage by their own ritual. Under `prefers-reduced-motion`
every animation collapses to ~0, still in ascending order, because the *order* is information and
only the motion is decoration.

**The client decides nothing.** `cardpack_open` carries every card's rarity, dupe flag and its
**server-rendered face** — the same `renderCard()` the shelf uses, so the card you flip and the card
you read later can never drift apart. This matters more here than in most panels: a reveal is the one
place a player would be quickest to suspect the animation of picking the outcome, and it can't, since
the cards were rolled and granted before the first frame drew. The plain text log lands alongside the
overlay too, so closing it mid-flip loses nothing but the show.

Sounds live in the shared catalog (`client/shared/sfx-catalog.js`, group `cards`) — dev-panel tunable
and DB-overridable like every other interface cue, and built as an **escalating ladder** where each
rung adds a layer rather than swapping to a different sound, so the ear knows you've hit something
before you can read the card.

A sleeve mixes subject types freely: NPCs, enemies and players all come out of the same pool, and
which kind you get is never a knob anybody turns.

**Seeding the pool — the set starts full.** This is what the NPC and enemy subjects are really for.
When a series opens, the system strikes a card for **every eligible NPC and enemy in world content**,
auto-derived from their rows. So on day one the pool holds a few hundred cards, a new player's first
sleeve has faces and monsters they recognise, and a completionist has something to chase before a
single player has minted. Player cards then accumulate into that pool over the life of the series.

Eligibility is deliberately loose — anything with a `description` qualifies — because the budget
ladder means a thin row simply produces a shorter card rather than a broken one. The exclusions are
narrow: dev/test rows, spawned-instance duplicates, and anything flagged `flags.card_exclude`.

**Duplicates.** A dupe is not a loss. It stacks (`qty`) and can be **scrapped** at the mint for ₵25,
or three dupes traded up for one roll at the next rank. Scrapping is what keeps a shelf legible.

**Trading.** Cards go through the existing [trade](../systems-economy.md) plugin as ordinary
tradeable objects. No bespoke market.

---

## 6. Storage

Two tables. No new `players` columns (see [architecture.md](../architecture.md) persistence tiers).

```sql
CREATE TABLE IF NOT EXISTS cards (
  id           SERIAL PRIMARY KEY,
  series       INTEGER NOT NULL,
  serial       INTEGER NOT NULL,          -- № within series
  subject_type TEXT NOT NULL,             -- 'player' | 'npc' | 'enemy'
  subject_ref  TEXT NOT NULL,             -- players.id | npcs.id | enemies.id, per type
  body         TEXT,                      -- silhouette; NULL for enemies (no portrait face)
  spec         JSONB NOT NULL,            -- item_ids, conditions, seed, power
  text_blocks  JSONB NOT NULL,            -- {last_seen, origin, overheard} as rendered
  rarity       TEXT NOT NULL,             -- common…legendary | architect
  minted_at    TIMESTAMPTZ NOT NULL,
  zone_id      INTEGER,
  pool_weight  REAL NOT NULL DEFAULT 0,   -- 0 = never packs (architect)
  UNIQUE (series, serial)
);

CREATE TABLE IF NOT EXISTS card_holdings (
  player_id  INTEGER NOT NULL,
  card_id    INTEGER NOT NULL REFERENCES cards(id),
  qty        INTEGER NOT NULL DEFAULT 1,
  first_got  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_id, card_id)
);
```

**Read tier: cold.** Nothing here touches a hot path. The pool weights are the only thing a pack
pull needs and they are small enough to cache at boot behind the same write funnel the item cache
uses — one table, one writer (the mint).

**What exports and what doesn't.** NPC and enemy cards are struck from world content and are
reproducible from it, so they export through CODEX like any other content. **Player cards and all of
`card_holdings` are runtime rows** and must never export — same category as accounts and inventory.
Getting this backwards commits somebody's shelf to git.

---

## 7. Where the code lives

A **plugin** (`plugins/cards/`), per the [engine-plugin-boundary](engine-plugin-boundary.md) litmus:
it owns verbs (`mint`, `cards`, `scrap`), its own tables, and a tablet app. Nothing about it is a
substrate other systems build on. Follow [plugin-builder](../../.claude/skills); add
`plugins/cards/regress.js` covering the budget ladder specifically — a clause ladder that silently
starts truncating is exactly the regression a text card cannot survive, and it must be tested against
all three subject types (an enemy row with a 900-character description is the case that breaks it).

The renderer stays where it is. `card-render.js` becomes the **portrait face**; the text face is
DOM. One stored spec, two faces, and the player flips between them. Enemies have no portrait face —
there is no silhouette for a rot-hound — so an enemy card is text-only, which is itself an argument
for the text face being the primary one.

---

## 8. Authoring — the dev-panel Cards tab

Everything a human needs to touch lives in one new dev-panel tab, following the existing panel
contract (`docs/devpanel-js.md` for the load-order rule):

- `client/devpanel/js/panels/cards.js` — new panel.
- `client/devpanel/js/core/panels.js` — a `cards:` entry in the `PANELS` registry, same shape as
  `enemies:` / `npcs:`.
- `client/devpanel/index.html` — one `<script>` tag with the other entity panels.
- `server/api/routes.js` — `GET/POST/DELETE /cards` plus the two actions below.

| Control | Why it has to exist |
|---|---|
| List: subject type, rarity, series, №, pool weight | The only way to see the set as a set |
| Edit rarity + pool weight | Rarity is stored, never recomputed — a mis-ranked card is only fixable here |
| Edit the three text blocks | Blocks are stored as rendered strings; a bad auto-derived quote has no other repair path |
| **Preview** — both faces, with per-region character counts | The budget system is the design's central claim; an author needs to see 331/340 |
| **Re-derive from source** | Rebuilds the blocks from the NPC/enemy row when content changed after the card was struck |
| **Strike series** | Sweeps world content and cuts the NPC + enemy cards for a new series |
| Issue an **Architect** card | The admin-only rank needs a UI; a chat command is the fallback |

The character counters are the important part: they make the budget ladder visible at authoring time
rather than at the moment a player pulls a broken card out of a machine.

This tab edits **cards**, not subjects. The NPC overrides (`flags.card_quote`, `flags.card_note`,
`flags.card_rarity`) stay on the NPC row and are edited in the existing **NPCs** panel — one home per
entity, no split-brain over who owns an NPC's fields.

## 9. Open questions

- **Does a card show a live player's *current* kit anywhere?** Recommended no — the whole design is
  frozen. But an "and today…" line on the tablet view is tempting and cheap.
- **Do the dead get minted?** A death-mint (`in memoriam`, black frame) is very much this game's
  humour, but it hands a griefer a collectible. Parked.
- **Series cadence.** Monthly is probably too fast for the player count; quarterly leaves a series
  feeling closed. Needs a real number before ship.
