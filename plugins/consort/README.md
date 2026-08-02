# consort

**Purpose** — Kept companions, for anybody. A consort is any NPC with
`flags.consort = true` and `flags.devoted_to = <handle>`; they live in a private
space their keeper holds, come out when called, and run a whole inner life off a
15s tick. Forked in spirit from [strippers](../strippers/), but the tip/heat
economy is gone: a consort is on a retainer, and what makes them undress is
**arousal**, and arousal comes from exactly one person.

This used to be two hand-written women on one man's yacht. It is now a system;
Roxy and Jolie are simply its first pairing.

## The three things a consort is

| | Where it lives | What it decides |
|---|---|---|
| **Archetype** | `flags.consort_archetype` → [archetypes.js](archetypes.js) | who they are — every spoken line |
| **Appearance** | an appearance **seed** → [appearance.js](appearance.js) | what they look like, and what they peel |
| **Name** | `npcs.name` / the ledger row | nothing at all, deliberately |

That last row is the important one. Nothing resolves a voice, an entrance, or a
scene by NAME any more. The old code looked up the literal strings `"roxy"` and
`"bijou"`, so the moment a consort was renamed she silently dropped to a generic
fallback voice and half her scenes became unreachable — which is exactly what
happened when the NPC-name-uniqueness pass renamed Bijou to Jolie (`Bijou Pace`
already existed). Archetype indirection is what makes randomly-named generated
consorts possible at all.

### Archetypes (12)

`strategist` · `romantic` · `feral` · `devout` · `brat` · `ghost` · `wit` ·
`scholar` · `ice` · `starlet` · `soldier` · `stray`

Every one carries the same complete set of pools — `devotedTame/Hot`,
`arousedTame/Hot`, `shy`, `worried`, `missShort/Long`, `pourTame/Hot`,
`talkKeeper/Shy`, and four `entrances`. A missing pool is a bug, not a fallback;
regress asserts the shape. Each also carries a `tier` (drives price) and
`selfDescribes` — how they'd describe themselves, which is what B.L.I.S.S. shows
instead of the clinical label. The player never sees the archetype key.

### Both sexes

Consorts are male or female, so **no line hardcodes a pronoun**. Pools are
written with tokens — `{they} {them} {their} {theirs} {themself}`, capitalised
`{They}/{Their}`, plus `{person}`/`{kid}` and a small verb-agreement table —
resolved per-consort by `renderLine()`. Garments are never named inline either;
they come from the appearance's layer list, so a male consort peels a shirt where
a female one peels a slip. Regress renders every pool for both sexes and fails on
any unresolved `{token}`.

`§` renders as the speaker's name. `§other` renders as another consort present in
the room — lines carrying it are **filtered out** when they're alone, which is how
a beat written for two degrades gracefully for a solo placement.

### What a listing actually tells you

Three things, in this order, because that's the order they matter in:

1. **Temperament** ([archetypes.js](archetypes.js) `TEMPERAMENT`) — four trait
   chips, then `warmth` / `wants` / **`warned`**. Every one of the twelve carries
   a written **downside**, and that pair is the point: a register where every
   entry is upside is a register nobody reads twice, and the twelve ways this can
   go wrong is the genuinely useful information. It never prints the archetype key.
2. **In their own words** — three real lines pulled from the pools they will
   actually speak from once placed (`voiceSamples`), rendered for their sex and
   name, `§other` lines filtered out. **Nothing is written twice for the
   catalogue: the sample is the product.** Deterministic per listing, because an
   entry that reworded itself on every glance would read as a different person.
3. **Appearance, then the specification** — the ordinary physical card, then the
   explicit one.

### Appearance

Generated deterministically from a seed string (xmur3 + mulberry32 — `Math.random`
is unusable here by construction). Independent axes: build (8 per sex), height,
hair colour/length/style, eyes, skin, mouth, grooming, scent, voice, age band, an
optional distinguishing mark (60%), an optional chrome mod (25%). Two consorts of
the same archetype and build still read as different people. The whole look is
regenerable from one `seed` column, which is why the ledger schema is so small.

**The anatomy is itemised too** — bust/chest, nipples, waist, hips, thighs, body
hair, and genitals with size — because B.L.I.S.S. is selling a body and has no
shame about presenting a specification. Two rules hold it:

- **It never reaches `describeAppearance()`.** That function is the NPC
  `description` that `examine` prints in a room to whoever is standing there, and
  a stranger walking past a consort is not owed their measurements. Anatomy lives
  in `intimateCard()`, assembled only by the MIS-gated app. Regress sweeps 200
  seeded bodies to prove nothing leaks.
- **It is rolled LAST.** Appending axes at the end of `generateAppearance` cannot
  shift any draw above it, so every consort generated before anatomy existed still
  looks exactly the same. **A seed is a promise.**

The male and female tables are separate rather than one table with a pronoun swap
— they describe different bodies, and a mirrored line reads as a mirrored line.

## B.L.I.S.S. — the ordering app

**B**onded **L**ive-**I**n **I**ntimacy **S**ubscription **S**ervice
([bliss-app.js](bliss-app.js)). A tablet app, **MIS-gated** — the tile does not
exist on the home screen without MIS on, so nobody who hasn't opted in is ever
advertised at.

- **The register** — six seeded placements, **shelved by sex** (Women / Men /
  Matched pairs). Each shows every physical characteristic, the explicit
  specification, the temperament, how the placement describes *themselves*, and
  the daily rate.
- **An even split, by plan.** The sex of a single used to be a coin off the seed,
  which is how a register comes out five women and one man — and the answer to
  that was a refresh. So the register is built to a **balance plan**: half and
  half, the odd slot going either way, then shuffled so the order still reads as
  incidental. Everything else about a placement is still seeded; only *how many
  of each* is decided.
- **Pairings are rare, and now actually are.** The old per-slot 18% put a pair on
  roughly two registers in three. It's rolled **once per register** (16%) and
  capped at one.
- **Reroll** — regenerate the whole catalogue, once a **game day**. That cooldown
  is the only scarcity mechanism, and at ten minutes it wasn't one: a patient
  player could spin until the exact placement they wanted fell out, which made the
  seeded catalogue decorative. It's a *game* day resolved through the world's time
  scale (`realSecondsFor`), derived on read rather than frozen at import, so a
  runtime time-scale change is honoured. State is two `player_flags` (a generation
  counter + a timestamp) and the roster itself is never stored — it's regenerated
  from `<playerId>:<generation>` every time the screen is built.
- **Placement** — delivered to any **private space you hold**: an apartment you
  control, premises you own, or any zone authored with
  `flags.private_billet_owner = <handle>` (the content-driven escape hatch that
  lets a bespoke space qualify without this plugin knowing what a yacht is).
  No private address, no placement.
- **Your arrangement** — what you keep, today's rate, tenure, and release.

### Price

`BASE 900 + 420/archetype-tier + 260/build-tier`, ±12% seeded wobble, rounded to
25c. A **pairing** is priced off its own tier ×2.35 — it's one indivisible product
with one indivisible bill, not two singles.

**Loyalty**: −1.5%/day kept, floored at 55% of base. They *want* to stay, and the
Syndicate would rather bill a small amount forever than a large amount once. The
app projects the curve at 7/21/45/90 days at the point of sale, so the discount is
legible up front rather than a surprise a fortnight later.

### Billing

Per **game** day on `environment.dayRollover` — the same calendar apartment rent
and shop mortgages run on. Drafted **bank → pocket**. A pairing bills and fails as
one unit. Two consecutive misses and the Syndicate collects them, with a scene:
they are not a subscription that lapses quietly, whatever the app implies.

## Pairings

Two archetypes placed and released **together**, at a premium — the rare high end
of the register, and the **only** consorts that run two-hander scenes with each
other. A solo consort reacts to whoever else is in the room through the generic
co-presence beats instead.

`strategist_romantic` (*A Matched Pair* — Cyd's Roxy & Jolie, the template) ·
`feral_devout` (*The Odd Couple*) · `wit_ice` (*The Double Act*) ·
`soldier_stray` (*The Rescue*) · `starlet_ghost` (*The Double Exposure*)

### They'll turn to each other when they're warm enough

Two consorts in the same room, **both** at `MUTUAL_AT` (70) or above, and their
attention sometimes lands on each other rather than on the keeper. This is its own
branch ahead of the keeper acts, on a deliberately **lower** threshold than
`FELLATIO_AT` (84) — it's where a warm evening goes before it peaks, not after.

Three pools cover all four combinations — `MUTUAL_FF`, `MUTUAL_MM`, and a shared
`MUTUAL_MIXED` written with the **woman as `A`**; `mutualFor()` reorders the cast to
match so no line has to hedge about who's doing what. Same `[who, tame, hot]` shape
as the keeper acts, played through `playKeeperScene` so it's MIS-tiered turn by
turn.

Two differences from the keeper acts, both deliberate:

- **The keeper's sex is irrelevant** — he isn't in the scene. He only needs to be
  watching, and MIS decides what he sees. (He still accrues arousal from it.)
- **Paired or not.** A pairing brings a history to it; two colleagues left aroused
  in the same room don't need one.

Still gated on a private room (`!strangerHere`) and the shared `SCENE_GAP_MS`
cooldown, so it stays an event rather than a loop.

### Non-paired consorts still react to each other

Two consorts kept by the same person who were *never written for each other* don't
get the two-hander threads — those assume a shared history these two don't have —
but they aren't furniture either. `CO_PRESENCE` is the basic register: sizing each
other up, working out the pecking order, the small courtesies and small
territorialities of two people in the same job.

It is keyed by **both** sexes, speaker first — `ff` / `fm` / `mf` / `mm` — so a
woman reacting to a man and a man reacting to a woman are genuinely different
writing, not a mirror (regress asserts `fm !== mf`). Entries are `[tame, hot]`,
MIS-tiered like everything else, and every line must name the other consort.

Fires on an eligible spoken beat at `CO_PRESENCE_CHANCE` (0.3), and only when the
room is private — in front of a stranger the `shy` register wins. `arePaired()`
is the switch: share a `consort_pairing` key and you get the threads, otherwise
this.

Note these lines never assume the **keeper's** sex — the keeper is a player.
Regress enforces that too.

`pairIn()` resolves a pair by matching the two archetypes present against the
PAIRINGS registry and taking its member order, so a thread written for `A` always
lands on the same personality whichever way round the two were spawned — and it
never parses the pairing key, which may be a registry name (authored) or a uuid
(a B.L.I.S.S. placement).

## They ask you things, and they wait for the answer

The "settle it" beat proved a shape: play a line, hand the room back, and let the
`player.say` hook read whatever the keeper says next. That one needs a **pairing**.
[questions.js](questions.js) is the solo version, and it is the main thing a
consort does with their mouth when nobody is undressing.

A consort asks something — are you staying tonight, what did you actually do out
there today, is there anything you're afraid of, do you do the arithmetic on what
I cost you — and then the room goes quiet. The keeper answers with `say`. The
reply is classified into a branch and they react to **that answer**, not to a
generic acknowledgement.

Four rules hold the pool together:

- **Written for any consort.** Every line is pronoun-tokenised and no line assumes
  the KEEPER's sex — the keeper is a player. Archetype doesn't gate a question;
  the same words land differently from an Ice than from a Brat, and that's enough.
- **The classifier is generous and never guesses hard.** Anything unreadable is a
  `dodge`, and every question has a **written dodge reaction** — a non-answer is a
  real answer here, not a parse failure. Silence has its own `timeout` reaction.
- **A branch can be worth arousal.** `mood` is what the answer bought; a couple of
  answers are *negative*, which is the point of asking at all.
- **Not MIS-gated, and gated below `AROUSED_AT`.** This is the clothed half of the
  relationship. It plays in the cabin and out on the deck alike.

One question at a time per keeper (`pendingQuestion` is keyed by keeper, so two
consorts can't both be waiting on one answer), on `QUESTION_GAP_MS` (12 min), and
a consort works through the entire pool before repeating any of it.

### ...and half of them read the room

`DYNAMIC_QUESTIONS` are the ones they only ask **because of something they can
see**: the hour on the clock, the state you walked in in, the weather you walked
in out of, the stars on you, what's left in the account, how long they've been
here. Same shape as a static question with two differences — `applies(ctx)` gates
it, and `ask(ctx)` (and any reaction line) may be a **function of the context**,
so the question quotes the actual number back at you: *"You're walking around on
about 42 percent of yourself. Who did that?"*

- **The context is built from live memory only** — the player object, the world
  maps, the in-memory wanted runtime, the consort's own ledger row. **Nothing
  here queries**; it's assembled on a 15s tick and the read-tier rule is not
  negotiable. Every lookup is individually guarded, so a question that can't be
  built is a question that doesn't get asked, never a thrown tick. Surveillance is
  reached by the usual lazy dynamic import; until it resolves, `stars` is 0 and
  the heat question simply doesn't apply.
- **The context is snapshotted at ASK time** and carried on the pending question,
  so a reaction that quotes a number quotes the number that was asked about.
- **Dynamic beats static 75% of the time** when the state supports one — a
  question about the blood on you is worth more than a question about the weather
  in general — and each repeats on its own 45-minute cooldown rather than joining
  the static rotation, because the state that provokes them comes and goes.

Regress asserts that a loaded context makes every one of them available and that a
**calm** one — healthy, clean, fed, solvent, sober, alone, mild afternoon —
provokes **none** of them.

## Absence — they notice you were gone

The gap between the keeper leaving the room and coming back is measured in **real**
time (it's about the player's absence, not the game clock). Two bands —
`ABSENCE_SHORT_MS` (2h) and `ABSENCE_LONG_MS` (20h) — arm a `missShort`/`missLong`
greeting that replaces the ordinary devotion pool on the **first** warm beat after
the return. It lands once, then clears; leaving re-arms it, so every return is its
own reunion. Every archetype has a written line for each band, and they are
markedly different conversations.

## Why a consort is not an `npcs` row

She (or he) is a **live-only NPC**, spawned into `world.npcs` from a
`player_consorts` row at boot and on order, dropped out of it on release. That's
the same law [storefront](../storefront/)'s hired staff follow, for the same
reason: `npcs` is a **content-class** table owned by git, so a consort written
there would export into the content tree and land on every other database as a
phantom stranger with somebody else's name on her.

Nothing in the engine minds an NPC with no DB row — the one write path that could
touch it (gameLoop's hp sync) is an `UPDATE` matching zero rows — and
`content:export` reads the `npcs` **table**, never `world.npcs`, so a roster can't
leak into a commit.

`player_consorts` is classified `class: 'player'` in the content registry.

## The tick (unchanged model, wider cast)

A 15s tick reads the live room each consort is in. **The pacing is deliberately
slow** — spoken beats are ~3 minutes apart at a minimum and most eligible ticks
pass in silence, scenes sit on a 15-minute room cooldown, arousal takes the better
part of four minutes of undisturbed company to peak, and an activity out on deck
holds for 5–12 minutes. Consorts are meant to be *company*, not a ticker.

- **Alone with their keeper** → arousal climbs toward a per-session `moodCap`
  (rolled fresh each time they warm from cold, so they don't strip every single
  time). They peel `flags.clothing_layers` a piece at a time, murmur devotion,
  and — peaked, MIS on, keeper male — run their signature acts.
- **A stranger present** → the mood dies. Arousal cools, they cover back up one
  layer per tick, and go shy.
- **Keeper hurt** (< 50% hp) → the seduction stops entirely and they tend him.
- **No witness** → nothing (same rule as the banter engine).

Beckoned out of their room they instead live a life keyed to the area
(`areaProfile` off zone flags): sun deck, view, helipad, or generic cabin idles,
holding one activity for minutes at a time.

Nudity and explicit beats are MIS-gated throughout (`tieredZoneLine`). The mis
plugin's `strip` verb still bares them on command; this plugin honours
`_forcedNude` and holds a force-stripped consort bare.

### The signature acts are a full sex matrix

The acts are the one place a pronoun swap isn't enough — the threads describe
bodies. So `KEEPER_ACTS` is indexed **`[keeper sex][consort sex]`**, four thread
sets per act, resolved through `actSoloFor()` / `actDuoFor()`. Never index
`act.solo` / `act.duo` directly.

**The keeper is a player, and players are male or female.** The original code
carried a `maleOnly: true` flag on every act and gated the tick on
`keeper.biological_sex === 'male'` — a fossil from when this plugin served exactly
one man. What it actually did was give every female player who kept a consort *no
signature acts at all*: the auto path never fired and a commanded act answered with
a brush-off. That flag is gone, and the keeper's sex now **selects** which half of
the matrix plays rather than gating the feature. `keeperSexOf()` treats anything
not explicitly female as male, so pre-existing keepers are on exactly the threads
they were before.

Act keys are the **role, not the anatomy** — `oral`, `ride`, `hand` — because the
same request means different things depending on who's asking. Player-facing verbs
map onto those keys in `DIRECT_ACT`, so `suck`, `lick` and `eat` are all `oral` and
resolve correctly either way round. (`lick`/`eat` are safe additions because the
matcher is name-prefixed: bare `eat` still belongs to the food verb — regress
checks that.)

Duo threads describe both bodies at once, so `actDuoFor()` returns a set **only for
a same-sex pair**. A mixed-sex pairing (perfectly legal — the roster rolls each
member's sex independently) degrades to a solo scene rather than play mismatched
prose.

Regress asserts all four combinations exist for every act, that a female keeper
never falls through to male-keeper prose, that no male-consort thread contains
female anatomy, that the new prose isn't a copy-paste of the old, that the
`maleOnly` flag has not come back, and that every act is commandable by a female
keeper as well as a male one.

## Commands / hooks

- **`beckon [name]`** / **`dismiss [name]`** — keeper-only.
- **`pour [name] [drink]`** — from any bar furniture in the room.
- **Direct address** — `vesper suck me`, `calla ride me`, `sable handjob`,
  `wren pour me a whiskey`. A narrow name-prefixed input matcher that never
  shadows the other multi-word verbs (`eat out …`, `jerk off on …`).
- Hooks: `npc.talk` (opens a real dialogue tree for the keeper, deflects to
  everyone else), `furniture.describe`, `player.say` (the "settle it" answer).

## Files

| File | Holds |
|---|---|
| [index.js](index.js) | the tick, scenes, verbs, hooks — the live behaviour |
| [archetypes.js](archetypes.js) | the 12 personalities, pronoun renderer, pairings |
| [appearance.js](appearance.js) | seeded RNG, builds, feature pools, the listing card |
| [roster.js](roster.js) | catalogue generation, pricing, loyalty, reroll cooldown |
| [hire.js](hire.js) | ledger, spawn/despawn, private spaces, daily billing |
| [questions.js](questions.js) | the questions they ask you, and how they take each answer |
| [bliss-app.js](bliss-app.js) | the MIS-gated tablet app |

Client rendering for the app lives in `client/game/js/panels/tablet-os.js`
(`renderBlissListings` / `renderBlissDetail` / `renderBlissArrangement`).

## State

Arousal, mood caps, scene bookkeeping and absence timers are **in-memory**
(reset on restart) — none of it warrants a persisted flag. The only durable state
is the `player_consorts` ledger and the two roster `player_flags`.
