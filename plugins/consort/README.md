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

### Appearance

Generated deterministically from a seed string (xmur3 + mulberry32 — `Math.random`
is unusable here by construction). Independent axes: build (8 per sex), height,
hair colour/length/style, eyes, skin, mouth, grooming, scent, voice, age band, an
optional distinguishing mark (60%), an optional chrome mod (25%). Two consorts of
the same archetype and build still read as different people. The whole look is
regenerable from one `seed` column, which is why the ledger schema is so small.

## B.L.I.S.S. — the ordering app

**B**onded **L**ive-**I**n **I**ntimacy **S**ubscription **S**ervice
([bliss-app.js](bliss-app.js)). A tablet app, **MIS-gated** — the tile does not
exist on the home screen without MIS on, so nobody who hasn't opted in is ever
advertised at.

- **The register** — six seeded placements. Each shows every physical
  characteristic, how the placement describes *themselves*, and the daily rate.
- **Reroll** — regenerate the whole catalogue, on a **10-minute cooldown**. That
  cooldown is the only scarcity mechanism; without it you'd spin until a Ghost
  fell out. State is two `player_flags` (a generation counter + a timestamp) and
  the roster itself is never stored — it's regenerated from
  `<playerId>:<generation>` every time the screen is built.
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

A 15s tick reads the live room each consort is in:

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
| [bliss-app.js](bliss-app.js) | the MIS-gated tablet app |

Client rendering for the app lives in `client/game/js/panels/tablet-os.js`
(`renderBlissListings` / `renderBlissDetail` / `renderBlissArrangement`).

## State

Arousal, mood caps, scene bookkeeping and absence timers are **in-memory**
(reset on restart) — none of it warrants a persisted flag. The only durable state
is the `player_consorts` ledger and the two roster `player_flags`.
