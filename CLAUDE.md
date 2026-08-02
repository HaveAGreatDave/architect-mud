# CLAUDE.md — Architect MUD

## What This Is

Post-singularity browser MUD in the HellMOO tradition. Text-driven, real-time, brutal, and funny. Node.js server with raw WebSockets, vanilla JS frontends (one HTML/JS file per client plus a sibling `styles.css`), PostgreSQL via Neon. No build step, no ORM, no framework.

## Key Docs

Entries marked **(as built)** describe what actually ships and outrank design intent.

**Start here**

- [README.md](README.md) — deploy, player commands, world overview, what's built and what's next
- [docs/architecture.md](docs/architecture.md) — stack, repo structure, DB schema; **persistence tiers + read tiers — read before adding any `query()` to a hot path**
- [docs/design.md](docs/design.md) — design intent for combat/survival/ideology/economy/housing. **Intent, not as-built** — a `systems-*.md` doc wins any disagreement
- [docs/story.md](docs/story.md) — **the tone authority.** Read before writing any player-facing prose (rooms, dialogue, death messages, broadcast copy). Its Factions table is superseded lore-texture, not a roster — see [systems-ideologies.md](docs/systems-ideologies.md)

**Engine & seams**

- [docs/server.md](docs/server.md) — boot sequence, in-memory vs. DB state, tick scheduling, WS handling, **and the authoritative engine hook reference** (as built)
- [docs/commands.md](docs/commands.md) — dispatch pipeline, SIFT/FATE target resolution, rules for using SIFT in new commands
- [docs/scripting.md](docs/scripting.md) — action registry, event bus, flag store, script graph runner; the mutation path all content flows through
- [docs/plugins.md](docs/plugins.md) — **plugin index**: which plugin owns each verb, and the precedence rule (plugins beat engine builtins)
- [docs/plugin-standard.md](docs/plugin-standard.md) — the `plugin.json` manifest schema, README convention, tick/DB-burden rules, `regress.js` shape
- [docs/proposals/engine-plugin-boundary.md](docs/proposals/engine-plugin-boundary.md) — substrates/laws/registries vs. systems + the litmus tests. Read before deciding where new code lives
- [docs/audits/](docs/audits/README.md) — reusable prompts that challenge the design at its silent seams; start at the [index](docs/audits/README.md), the seminal one is [source-of-truth-audit.md](docs/audits/source-of-truth-audit.md)

**Content & authoring**

- [plugins/cooking/README.md](plugins/cooking/README.md) — **cooking, as built**, and the doc to read before touching a dish. Beyond the 47-recipe catalog it now holds two rules worth knowing before you change anything: **improvised dishes** (`improvised.js`) mean an unmatched pan is named off a family table rather than becoming slop — *food makes a dish, non-food makes a mess* — capped at `superb` so **`masterful` stays the authored catalog's alone**; and **player recipes** (`recipes.js`) are identified by their SIGNATURE, never their name, which is why renaming is free, one combination can only be saved once, and seasoning isn't part of the identity. Shared as a tradeable card or by `recipe teach`, author travelling with it either way. Also the **shopping list** (`shoplist`), whose rule is that it **stores what you want, never what you have** — every tick is derived from inventory at read time, so nothing fires on acquisition and it can't go stale; entries are ingredient CLASSES, which is what lets the `shop.stock` hook mark whatever a vendor happens to stock that satisfies one
- [docs/items.md](docs/items.md) — every `items` field, which JSON keys the engine actually reads, the working armor format
- [docs/tags.md](docs/tags.md) — the tag catalog/helpers/Tag→Action registry, and how to add a tag cleanly (property vs. behavior)
- [docs/reference/item-facets.md](docs/reference/item-facets.md) — **how a list of items sections itself**: shop shelf sections and container compartments are one question with one answer (`server/engine/classify.js`). The rule that shapes it: **categories are derived and the STOCK picks the axis, never the author** — a grocer sections by storage and a gunsmith by type with nothing configured, because an axis that doesn't partition the actual list scores zero and loses. Read the four scoring rejections before tuning it (each prevents a list that's worse than flat), the **nothing-is-ever-lost** contract, and `storage_tier` — the one authored tag, because nothing in a fillet's tags says it's sold frozen rather than fresh. A list that doesn't partition usefully **stays flat, and that's a success**
- [docs/flags-keys.md](docs/flags-keys.md) — `flags` keys across zones/NPCs/furniture and which plugin owns each; **owner `—` means nothing reads that key** (item tags live in `client/shared/tagCatalog.js`)
- [docs/vine.md](docs/vine.md) — the VINE graph editor: file roles, schemas (dialogue/script/AI/broadcast/quest), editor internals
- [docs/ai-behaviour.md](docs/ai-behaviour.md) — VINE behaviour trees for enemies/NPCs: node types, condition/action catalogue, blackboard, pathfinding
- [docs/npc-clothing.md](docs/npc-clothing.md) — the `CLOTHING` personality table, auto-injection at `apiCreateNpc`, the `flags.clothing_layers` model
- [docs/bsm-format.md](docs/bsm-format.md) — the `.bsm` broadcast-script spec as parsed by `compileBsm()`. Read before authoring or changing any `data/scripts/*.bsm`
- [docs/amp-format.md](docs/amp-format.md) — the `.amp` audio-asset spec (the devpanel Audio tab's export): instruments, songs, sfx, ambient, samples. The sibling of `bsm-format` for sound — read before authoring or changing an audio preset
- [docs/content-pipeline.md](docs/content-pipeline.md) — one JSON file per entity under `content/`, export/import/lint, the CI deploy. **Cutover done 2026-07-08** — git is the sole writer of prod content

**World & place**

- [docs/systems-world.md](docs/systems-world.md) — world state, movement, ambience, sound propagation, spawning, minimap, scheduler, tunables (as built)
- [docs/reference/land-taxonomy.md](docs/reference/land-taxonomy.md) — region vs district vs terrain vs biome, one SSOT each. **Read before touching anything "district"/"region"/"terrain"**
- [docs/systems-terrain.md](docs/systems-terrain.md) — `flags.terrain` ground-surface SSOT + the dev-panel Terrain Painter; drives minimap/tablet/pacing, **not passability, not flight** (as built)
- [docs/systems-overland-void-travel.md](docs/systems-overland-void-travel.md) — transient (non-DB) waste rooms off a region's rim: the `movement.edge` seam + `registerTransientZone`. Read before touching transient zones or the map rim (as built)
- [docs/reference/world-rendering.md](docs/reference/world-rendering.md) — how a DB tile becomes a building out the cockpit; palettes, decoration helpers, the **three separate "tower" renderers**. Read before "improving a model"
- [tools/studio/README.md](tools/studio/README.md) — **the Studio** (`npm run studio`): the file-authoring map editor. Edits `content/` with no DB in the process, draws from the build's derive pass, generates its forms from the field catalog
- [docs/reference/building-shapes.md](docs/reference/building-shapes.md) — **building geometry as data**: the model arms record themselves (`SHAPE_SINK`) rather than being rewritten, so the flight sim's own shapes now drive distance LOD, occlusion culling, ground shadows, per-point CFIT collision and the cold open's skyline. Read before touching a building model, the CFIT sweep or the flythrough — and for the `hwRaw` pre-clamp rule, the solved-not-assumed `[a·fh + b·h + c]` basis, and the `yaw` trap (as built)
- [docs/zone-redesign-2026-07.md](docs/zone-redesign-2026-07.md) — the record of the 2026-07-09 zone re-imagining: what changed, why, and what's left. Read when a zone field's *shape* looks odd — this is where the reasoning behind it was written down
- [docs/systems-wildlands.md](docs/systems-wildlands.md) — the Curtain and the Wildlands beyond the South Gate. **Compound status: the map + wall are BUILT content; the systems on top of them are still design**
- [docs/roadmap-world-expansion.md](docs/roadmap-world-expansion.md) — the road to the 100×100 Coldwater Basin. **The canvas is built; the open questions in it were never answered** — read before a large world-expansion push so they get decided rather than re-discovered
- [docs/devpanel-js.md](docs/devpanel-js.md) — what each script in `client/devpanel/js/` holds, and the load-order contract

**Systems (as built)**

- [docs/combat.md](docs/combat.md) — to-hit, body parts, typed soak, cooldowns, enemy AI, loot; the authoritative source on combat
- [docs/systems-survival.md](docs/systems-survival.md) — hunger/thirst, radiation, mutations, drugs, buffs, sleep, status-effect framework
- [docs/systems-weather-extreme.md](docs/systems-weather-extreme.md) — severity scalar, gear-gated-lethal channels, no indoor safe haven, ⚠ forecast band, named hero events — **all built, steps 1–7d, acid rain and the EMP/ion storm included** (as built)
- [docs/systems-economy.md](docs/systems-economy.md) — credits/banking, vendors, crafting, IP/stat-raising, housing
- [docs/systems-ideologies.md](docs/systems-ideologies.md) — the reworked factions: 4 orders on a stance axis + path, rep/stance/path actions, the `ideologies`/`rep` command, `org_relations`
- [docs/systems-corps.md](docs/systems-corps.md) — corp = faction + owner + treasury + members + territory; influence tug-of-war, five power levers (Phases 0–3 built; espionage + NPC corp AI still design; venture half in [proposals/corporate-assets.md](docs/proposals/corporate-assets.md))
- [docs/systems-flight.md](docs/systems-flight.md) — aircraft, airfields, hazards, contracts, air combat, hangars. **One model only:** the continuous client-sim/server-reconcile loop; the old banded model and its minigame decks are unreachable legacy code
- [docs/systems-helm.md](docs/systems-helm.md) — the Echelon helm chase view + deck-cam cinematic, `echelon_bridge`-gated verbs (tablet mount pending)
- [docs/systems-broadcast.md](docs/systems-broadcast.md) — channels, playlists, VINE scripts, NPC hosts, camera feeds, **plus the five live-assembled show modes** and the **two-sport pipeline** (Deadball baseball + Cluster Puck hockey): the `@sport` registry, the `narrate` seam, one league per sport, and the rink sub-screen
- [docs/systems-surveillance.md](docs/systems-surveillance.md) — SPECTER player spy networks + the witnessed-crime wanted system
- [docs/systems-jail.md](docs/systems-jail.md) — downed-while-wanted → Holding, gear confiscation + evidence locker, hackable cell door; the `player.respawnZone` seam
- [docs/systems-scavenging.md](docs/systems-scavenging.md) — posture-based perpetual search, per-zone loot tables, the 2D8−2D8 check
- [docs/systems-fishing.md](docs/systems-fishing.md) — posture-based cast-and-wait + client reel overlay, Fishing skill, rod gate; reuses the scavenging table schema
- [docs/systems-swimming.md](docs/systems-swimming.md) — swimmable water, stamina-scaled strokes, drowning, diving on a breath timer, soak→hypothermia (boat boarding + underwater content pending)
- [docs/systems-mining.md](docs/systems-mining.md) — posture-based deposit-working, per-zone ore tables, tool gate
- [docs/systems-jobboard.md](docs/systems-jobboard.md) — rotating legal early-money gigs over the quests plugin, greeter gate
- [docs/systems-casino.md](docs/systems-casino.md) — The Neon Vig: the self-contained `slots` plugin + a poker table reusing `gametable`
- [docs/systems-chess.md](docs/systems-chess.md) — **chess, as built**: full legal rules (perft-verified) on a 2-seat table in the same `gametable` plugin, which is what forced the real split — `TableBase` holds the seat/spectator/host-NPC/persistence half that any table game needs, `GameTable` keeps every line of poker lifecycle, and `game_types` finally *decides* something instead of being stored and ignored. The board is an **isometric 3/4 neon set rendered server-side in CSS** (the pieces counter-rotate so they stand up off the tilted plane; the shadow deliberately doesn't), and selection is two-step and server-side so the client never computes legality. Read the **`move` fall-through rule** before touching that verb (`move north` must never be eaten), the **0x88 note** (index 0 is a8, so White advances toward *lower* indices), and the **`startFen` trap** in the repetition counter. Lives in Material Advantage, floor 18 of the Solenne (as built)
- [docs/systems-atm.md](docs/systems-atm.md) — ATM furniture: networks, fee/limit/faction logic, hacking, replenish tick, power dependency
- [docs/systems-procedural-audio.md](docs/systems-procedural-audio.md) — sound generated from action+material+intensity rather than per-thing assets: the shared generator, the **parameters+seed wire format**, the material/surface tables and where to tune them (as built)
- [docs/systems-senses.md](docs/systems-senses.md) — smell/listen/sight as an engine substrate: the `zone.smells`/`zone.sounds` gather hooks and their **in-memory-only contributor contract**, acuity from stat/status/gear, overload, and why touch was left out (as built)
- [docs/systems-durability.md](docs/systems-durability.md) — **gear wearing out and being repaired**: `player_inventory.condition` as the item's HP bar, capacity **derived from `value`** (zero per-item authoring), five bands where the top two are mechanically free. Wear accrues **on use, never on the clock**, in memory on the combat hot path (**`wear()` is sync by contract**), flushed coalesced. Zero condition DESTROYS the item, so the Failing band + a fatigue warning on examine are load-bearing. Each repair makes an item likelier to break outright; a masterful hand repair REINFORCES — tougher and fatigue forgiven, which a bench can never do. Repair is a shared `repair` specialized action: field (capped at Battered) vs bench (an NPC flagged `repairman`, priced off `relationHelp`) (as built)
- [docs/systems-relationships.md](docs/systems-relationships.md) — **what an NPC remembers about you**: the `player_npc_relations` substrate (familiarity/warmth → a six-rung tier ladder), hydrated once at login and read from memory thereafter (**zero runtime queries — `getRelation` is sync by contract**), lazy time-decay with no tick. VINE-authorable via the `{ relation: 'known' }` condition shape + `RELATION_ADJUST`; **`text_by_relation` falls back to a node's ordinary text**, so an NPC with no authoring behaves exactly as before (as built)
- [docs/systems-hygiene.md](docs/systems-hygiene.md) — **filth on a body** as an engine substrate: the contaminant→smell table for anything already written by bodily/combat/mis, a runtime `_sweat` meter, and `hygiene_washed_at` grime. **Sync and query-free by contract** (`hygieneOf` is called from the smell pass and from reaction paths). The zone-stain half lives in `commands/world.js`; this is the body half, and `ejaculate` is `misOnly` so a non-opted nose never smells it (as built)
- [docs/systems-mis.md](docs/systems-mis.md) — **the opt-in mature layer**: the two-switch consent gate (server setting AND player flag — off means every verb answers `Unknown command`, so an unopted player never learns the surface exists), the `sexuality` table where **`None` is a real answer and unset never defaults to male**, horniness tiers → climax (+10 sanity, a genuine sanity valve) with 5-minute-idle decay flushed in one statement, and the 8s ongoing-act loop whose every beat re-validates — **leaving the room ends it**. NPC arousal is in-memory only and NPCs remember nothing (not wired to `player_npc_relations`) (as built)
- [docs/systems-cleaning.md](docs/systems-cleaning.md) — **filth on a floor**, the counterpart to hygiene's filth-on-a-body: zone stains now run on **two clocks**, where unowned space is swept nightly as before but a room a player OWNS keeps its mess for a full rent cycle — which is what makes a mop worth carrying. The `zone-filth.js` substrate is sync/query-free (stains are RAM-authoritative), ownership is **contributed by plugins, never assumed** (the engine must not import storefront), and the 7-day cadence is **stateless** — derived from the game date, so a restart can't reset everyone's mess (as built)
- [docs/systems-library.md](docs/systems-library.md) — **nine public-domain books as a readable system**: the tablet reader, RP narration with the spoken line highlighted, minimize-and-keep-reading, and a tap-to-gloss vocabulary layer over prose that is **never rewritten**. **Read the copyright rule before adding a title** — the bar is US public domain (which is why *1984* is absent until 2045). `books` is `readTier: cold` and never boot-loaded, which is the whole reason the feature is affordable; note the `chapters->($2::int)` cast, without which every chapter silently reads blank. Not to be confused with [systems-codex.md](docs/systems-codex.md) (as built)
- [docs/systems-drinks.md](docs/systems-drinks.md) — **mixology, drinkware and the dish cabinet**: a finished drink lives on the vessel's `custom_data`, never as a new item row, because the whole point of a mug is that you keep it. Recipes match on ingredient PROFILES (pours, never grams) exactly as `dishes.js` does, with two deliberate differences — `vessels` is a LIST, and `medium` profiles (water, ice) fill a glass without scoring it. **Alcohol is DERIVED from `abv` × pours and lands on the ordinary `drug_alcohol` path**, so a mixed drink and a bottled one get drunk identically, and a zero derivation applies no drug at all. Hot drinks are appliance-gated on `flags.brew_tier`; cooling is derived from `hot_at`, never ticked. Also: **the `fromNearby` seam** — one opt-in option on `resolveInventoryItem` that lets a kitchen hold its own pots (as built)
- [docs/systems-stealth.md](docs/systems-stealth.md) — **sneaking, and knocking people out**. The rule that shapes it: **combat is to the death and stays that way** — a random KO mid-fight would be invisible (auto-attack finishes an unconscious body a tick later) and would make every fight ambiguous, so a knockout is *always* something somebody chose. Stealth is **borrowed, not built** — the notice roll is assembled from `senses`, `getZoneVisibility`, `impairment` and `posture`, and is **per observer**, so one person can miss you while another doesn't. An out-cold body is **killable where it lies** (reusing the dreams mind/body split), which is why finishing one is charged as `execution` at 5★ while the cosh itself is a 2★ camera-only crime. Police at ≥4★ now **take you alive** rather than killing you — the one route that used to skip jail entirely (as built)
- [docs/systems-dreams.md](docs/systems-dreams.md) — **two systems that share the word**: the per-sleep **dreamscape** (3–4 generated transient rooms, private per player, dissolved on waking) and the **drug dreamzones** (3 authored, permanent, *shared*). The load-bearing split is `current_zone` = where your mind is vs `zone.players` = where your body is — the sleeping body stays in the room, lootable and killable, while the mind is elsewhere. Read the **wake-path table** before touching anything that ends sleep (a missed path leaks zones and strands the player), the **`DREAM_VERBS` allowlist** before widening what works in a dream (`drop` in a room about to be deleted orphans the item forever), and **`persistableZone`** before writing `players.current_zone` anywhere (as built)
- [docs/systems-display-mode.md](docs/systems-display-mode.md) — **the three-rung Display Mode ladder**: one ordered player preference (visual / textgames / log) covering every system that has both a graphical presentation and a written one. Two predicates that deliberately share no words — `prefersTextMinigames` (surfaces you ACT through) vs `prefersLoggedPanels` (surfaces you only READ) — picked by asking **"if I delete this surface, is the player stuck?"**. Read the **migration trap** before touching the stored values (the middle rung is `textgames`, never `text`, because the old flag used `text` to mean today's `log`), the **tri-state** rule (never-chosen ≠ visual, which is what keeps poker's `textTable` default alive), and the **tick rule** (latch at an entry moment, never call a predicate from a tick). Also holds the ARIA contract: `#output` is the ONE live region, the pane is aria-hidden at the bottom rung, and the room description reaches the log there — if a system's record doesn't reach the log, that rung isn't done for it (as built)
- [docs/systems-posture.md](docs/systems-posture.md) — the `player.posture`/`sittingOn` contract, HP regen, stand-up triggers (split engine+plugin)
- [docs/systems-macros.md](docs/systems-macros.md) — smartbar macros: `;`-chained scripts, `$values`, if/else, macro-calls-macro (client-only localStorage)
- [docs/systems-codex.md](docs/systems-codex.md) — **the game's backstory as a system**: the 30-second cold open a first login plays *before* the prologue speaks (the prologue holds all arrival prose until the client echoes `introdone`), and the tablet **CODEX** app that holds the full text. CODEX is a shelf of *typed* sections — two lore volumes plus the former standalone Ideology app, now its `orders` section with an unchanged payload. Chapters unlock one player flag at a time; a sealed chapter's prose **never leaves the server**, and `CODEX_UNLOCK` is the intended authoring route (an NPC explains a thing, you get the chapter about it). Not to be confused with the CODEX deploy pipeline (as built)
- [docs/proposals/trading-cards.md](docs/proposals/trading-cards.md) — **trading cards, as built** (`plugins/cards/`): a frozen snapshot of somebody, in three subject types on one shell — a **player** who minted themselves at a terminal, plus the **NPC** and **enemy** cards struck from world content when a series opens. **Only players mint, and that asymmetry is the justification**: the system deliberately doesn't follow anybody around, so you hand it the moment. Read the **budgets-not-truncation** rule before touching any text region (clauses are omitted whole, never trimmed), and the **spoken condition** convention (a Battered coat is "gone thin at the shoulders"; the band name lives on the back). Packs come from powered `flags.vends_packs` machines with a rolled sleeve size and a no-all-commons guarantee. **Buying and opening are two acts** (§5b): the machine is an ATM-style terminal panel, ₵900 buys a `card_foil_sleeve` ITEM that holds no result, and the **roll happens at `openpack`, never at the vend** — which is what makes an unopened sleeve untradeable-with-known-contents and un-stale. The reveal is a fullscreen cinematic in `client/game/js/panels/cardpack.js` whose one `RARITY` table drives the whole ladder; read the **client decides nothing** rule before touching it (as built)
- [docs/proposals/preparation-workspace.md](docs/proposals/preparation-workspace.md) — **all six phases built**: a floating text HUD over the cooking simulation. A domain-agnostic `plugins/workspace/` fed by the `workspace.provider` gather-hook plus **two providers** — `kitchen` (`plugins/cooking/workspace.js`) and `chembench` (`plugins/synthesis/workspace.js`), the second added with **no change to the workspace plugin or its client panel**, which is the seam proved rather than asserted. The rule that shapes it: **the HUD holds no gameplay logic — every action is a verb string a player could have typed**, which is why the payload ships literal commands rather than opaque ids and a regress case sweeps every one against the live verb registries. Provider gates are **coarse on purpose** — the HUD proposes, the verb decides; re-deriving a verb's real preconditions in the provider is the duplicate implementation this whole layer exists to avoid. The **Recipe Assistant scores only recipes the player KNOWS** — listing the undiscovered half with exact shortfalls is the ingredient checklist the Cookbook app deliberately refuses to be, and it would kill discovery. Read the **reservation** section before adding any soft-lock: nothing in the game locks an inventory row (trade explicitly refuses escrow), so `prepare <recipe>` is a re-validating plan, not a claim — it walks ordinary commands, stops on the first failure, never answers a SIFT prompt, and **stops at a loaded vessel without cooking**, because heat is where the skill is
- [docs/systems-cards.md](docs/systems-cards.md) — the **portrait** renderer for the same cards: per-piece vector art on a body silhouette, `{body,item_ids,seed}` stored rather than an image. **Still unwired** — the text face is what ships, and an enemy card can never use this one. Not debt; a second face the card view could grow

**Before touching any system, read the relevant doc section if there's one applicable to the request.**

**Before editing any player command, check [docs/plugins.md](docs/plugins.md) first** — a plugin may already own that verb, in which case the engine handler for it is dead code.

## Core Architectural Rules

- **Engine vs. content are separate.** The codebase is the engine. World content (zones, items, enemies, NPCs) lives in Postgres and is edited through the dev panel. Don't hardcode content into engine files.
- **No ORM.** All queries go through the single `query()` helper in `server/models/db.js`. Keep it that way.
- **No startup migrations. Schema and content are managed deliberately, never on boot.**
    - **Schema** is the single source of truth in `server/models/schema.js` (`SCHEMA_SQL`, idempotent DDL). `npm run db:schema` applies it to your **local** dev DB. Production gets it through the CODEX deploy (below), not a manual `db:schema` against prod.
    - **Content lives in git (CODEX pipeline).** World content is one JSON file per entity under `content/`, and a **fresh database is built with `npm run db:create-local` (empty DB) → `npm run content:import`** (which applies `SCHEMA_SQL`, then loads the content tree). There is no checked-in `seed.js`/`seed.sql` and no boot-time content rewriting (the old startup `migrate()` was removed precisely because it disrupted dev by mutating content on every restart). The dev-panel `.sql` export (`/dev` → Power Tools → _Database Backup_) + `npm run db:restore -- dump.sql` remains as a **self-contained-SQL escape hatch** (backups, recovery), not the primary seed path.
    - **CODEX is the deploy path (git as source of truth).** World content lives as one JSON file per entity under `content/`; a push to `main` is the deploy — CI applies the full `SCHEMA_SQL` ahead of the additive content, backs prod up first, and is regress-gated. So idempotent schema DDL (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, deferrable-constraint swaps) **and** new content both reach prod through a normal push. See [docs/content-pipeline.md](docs/content-pipeline.md) and the `codex` skill for the authoritative flow.
    - **To change the schema:** edit `SCHEMA_SQL` (idempotent), apply locally with `npm run db:schema`, and ship to prod via the CODEX deploy (push to `main`). Never an auto-run boot migration. **Reserve manual one-shot scripts for _data transformations_** — backfilling or rewriting _existing_ rows (e.g. moving data between columns). The additive deploy (`INSERT … ON CONFLICT DO NOTHING`) can never touch existing rows, so those are the only thing it doesn't cover.
    - **Running a one-shot against prod:** `node --env-file=.env.prod scripts/<name>.mjs` (the git-ignored `.env.prod` holds the prod `DATABASE_URL`). `db.js` enables SSL by **host** — remote ⇒ TLS, localhost ⇒ none — so this needs no `NODE_ENV` juggling and any `query()`-based script works against prod this way. Omit the flag to go back to local.
    - The export deliberately excludes player/runtime rows (accounts, inventory, password hashes); it carries schema + world content only.
- **Plugins for extensibility.** New behavior hooks belong in `/plugins/`, not in engine files, unless they're genuinely core.
- **No new sparse columns on `players` (or `npcs`).** New per-player scalar state goes in `player_flags` or its own feature table — never another `players` column. Same for per-tick/derived state: check the persistence tiers in [docs/architecture.md](docs/architecture.md#persistence-tiers-when-to-write-the-db) before adding a runtime DB write.
- **Every `query()` is a remote round trip — decide the read tier before adding one.** Prod Postgres is remote; latency lives in round-trip _count_, not query cost. Check the [read tiers in docs/architecture.md](docs/architecture.md#read-tiers-where-data-lives-at-runtime) before a new feature reads the DB: hot paths (per-move/per-swing/per-tick) never add awaited queries — serve them from the live player object, the world Maps, or a cache tier; never query in a loop (`id = ANY($1)` / `GROUP BY`); `Promise.all` independent reads; coalesce same-row writes; idle-gate scheduled ticks on `hasActivePlayers()` and register them via scheduler.js. **A cache is only as safe as its write funnel — grep every writer before caching a table** (why `furniture` and `npcs` rows are deliberately uncached).
- **UTF-8, always.** Several files (especially `client/game/index.html`) use Unicode glyphs and box-drawing chars (`₵ ⚙ ⏻ ╱ █ ☢`). When editing, preserve UTF-8 without a BOM — never let a tool re-save as Windows-1252 or it double-encodes everything into `â•±â•²` mojibake. After editing such files, sanity-check that the glyphs are still intact.

## Regression Testing — run it, and recommend it

`npm run test:regress` ([tests/regress.js](tests/regress.js)) is the pre-deploy gate. It boots the
world + all plugins (no server), sweeps every plugin manifest against the live registries (declared
commands/hooks actually wired), then drives real commands end-to-end through `handleCommand` with a
fake player — dispatch order, posture, move gates — plus every plugin's own `regress.js` suite.

**Run it without being asked** after any of these, and say so in your summary:

- editing the dispatch pipeline (`commands/index.js`), plugin loader, or any engine registry/seam
  (actions, events, hooks, specialized actions, move gates, posture)
- adding/removing/renaming a plugin verb, or changing a `plugin.json`
- extracting or relocating a system (engine↔plugin moves)
- **before any deploy/push of server code** — recommend it even for changes that look unrelated

Never wire it into production boot (same principle as no startup migrations — boot stays deliberate).

**When you add a plugin or a verb, add a `plugins/<name>/regress.js`** (default-export
`async ({ run, check, getPlayer }) => { … }`; see [plugin-standard.md](docs/plugin-standard.md)).
Test code lives with the plugin and never loads in production.

Caveats: it shares the Neon session pool (pool_size 15) — if it dies with `EMAXCONNSESSION`,
an orphaned local `node server/index.js` is holding pool connections. A `pretest:regress` hook runs
`scripts/kill-orphans.js` to sweep these automatically before every regress run (and `predev` does
the same before `npm run dev`); run it by hand any time with `npm run kill:orphans`. It's Windows-only,
scoped to this repo's own entrypoints (`server/index.js`, `tests/regress.js`, `sync-commits.js`,
`scripts/dev.mjs`, `tools/studio/serve.mjs`), and
never runs in production (`npm start` has no pre-hook). If a sweep can't reach it, wait ~90 s. Player
stat columns are `stat_brawn`/`stat_reflexes`/… (not `brawn`).

`pretest:regress` also runs **`docs:lint`** ([scripts/docs/lint.mjs](scripts/docs/lint.mjs)), which fails
when a doc's **status header contradicts its own body** — a header asserting nothing is built
("Not Yet Built", "Nothing here is implemented", "DESIGN ONLY") sitting above a body full of ✅/`*Built:*`
markers. This exists because on 2026-07-27 an audit reported five shipped systems as outstanding work,
every error traced to a stale status line; `systems-weather-extreme.md` was titled "Design — Not Yet Built"
above a roadmap complete through step 7d. **A compound status is fine and is NOT flagged** — "Phases 0–2
built; rest design" or "STATUS: BUILT (design intent below)" pass, because mixed status is the normal case
for a living system. When you finish a system, update the line at the TOP of its doc, not just the roadmap
at the bottom.

`pretest:regress` also runs **`content:lint`** (and a `precontent:import` hook runs it before any
`npm run content:import`), so a hand-authored content file carrying a runtime column — an
`excludeColumns` key like `zones.stains` — fails locally instead of surviving to the CI deploy gate.
Both mirror the CI order (lint → import → regress). `content:export` already strips those columns, so
only hand-written files can trip this.

`pretest:regress` also runs **`shapes:smoke`** ([scripts/shapes/smoke.mjs](scripts/shapes/smoke.mjs)),
which executes all ~83 flight-sim building models in `drawTypeModel` (`client/game/js/panels/windshield.js`)
against a DOM stub — night and day, both entrance facings — and fails if any of them throws. This is
the ONLY automated coverage the windshield has. It exists because the only thing that ever ran a
building model was a player flying past that particular building: the Battery Acid Coffee Co. roaster
passed a palette KEY where `drawFacetDrum` wants a style FUNCTION, and it froze the whole sim mid-frame
the first time that cafe came into view. It also gates the shape-capture data (geometry must stay
affine in the footprint/height arguments). **Run it after touching any building model or mass
primitive**; it needs no browser, DB or network and takes about a second. If it fails on a browser API
rather than a real bug, add that API to [scripts/shapes/dom-stub.mjs](scripts/shapes/dom-stub.mjs).
It proves models RUN, not that they look right — there is no pixel comparison.

## VINE Graph Workflow

Creating or updating an NPC behaviour graph, dialogue tree, or enemy behaviour graph is covered by
the `mud-designer` skill (push mechanics, auth, the dialogue flat-params gotcha); schemas live in
[docs/vine.md](docs/vine.md).
