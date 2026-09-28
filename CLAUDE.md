# CLAUDE.md: Architect MUD

## What this is

A post-singularity browser MUD in the HellMOO tradition: text-driven, real-time, brutal and funny. Node.js server with raw WebSockets, vanilla JS clients (one HTML/JS file per client plus a sibling `styles.css`), PostgreSQL on Neon. No build step, no ORM, no framework.

## Names

- **THOMAS** (The Hypermedia Online Multiplayer Adventure System) is the client and engine: `client/`, `server/engine/`, the dev panel, the plugin loader and the CODEX pipeline. Someone could build a different MUD on it.
- **Architect** is the game built on THOMAS: the world in Postgres and under `content/` (Coldwater, the Basin, the orders, the prose).
- **GLASS** (Geometry, Lights, Aircraft, Streets & Structures) is the 3D renderer in `client/game/js/panels/windshield.js`. Geometry records itself as affine `[a·fh + b·h + c]` data through `SHAPE_SINK`. `tools/modelshop` is its model editor, as `tools/studio` is the map editor.
- **SIREN** (Sources, Index, Resonance, Envelopes & Noise) is the audio synth in `client/shared/audio-engine.js`: `buildLayer` and what feeds it. A cue is an array of layers, each a carrier oscillator and/or noise with an ADSR, a biquad, optional drive and up to two FM operators in series. Around it: a 32-voice pool with priority stealing, the tracker, the sampler, a generated-IR reverb and four buses.
- **ORACLE** (Orthography, Resonance, Accent, Cadence, Lexicon & Emphasis) is the formant speech synth in the same file: a glottal `PeriodicWave` through four formants and a nasal antiformant, a noise path for fricatives and bursts, a 27k-word lexicon over letter-to-sound rules, RP/GA accents, and falling/rising prosody. It voices broadcasts, the Architect, the library and Read Aloud. The dev panel's Voice Lab tab tunes it.

THOMAS is the platform, GLASS draws it, SIREN sounds it, ORACLE speaks it, Architect is the game.

## Things that trip people up

- Engine vs. content is the THOMAS/Architect split. Hardcoding Coldwater content into an engine or client file is something a second game would have to undo.
- ORACLE doesn't use `buildLayer`. It shares `driveCurve`, the noise buffer and the buses and builds its own node graph, so an FM feature added to SIREN doesn't reach the voice, and vice versa.
- None of these names is an identifier, so grepping for them misleads. "THOMAS" appears only in the dev panel boot splash (`client/devpanel/index.html`, `client/devpanel/js/bootstrap.js`), where it names the platform, not the panel. SIREN and ORACLE appear only in file headers, and "siren" also matches ~26 unrelated hits (emergency siren, dive siren, cockpit warnings). Search the synth by `buildLayer`, `layer.fm`, `voices`; the voice by `Speech`, `pronounceWord`, `PH`, `voiceFromName`.

## Key Docs

Entries marked **(as built)** describe what actually ships and outrank design intent.

**Start here**

- [README.md](README.md): deploy, player commands, world overview, what's built and what's next
- [docs/architecture.md](docs/architecture.md): stack, repo structure, DB schema, persistence and read tiers. Read the tiers before adding any `query()` to a hot path
- [docs/design.md](docs/design.md): design intent for combat, survival, ideology, economy and housing. A `systems-*.md` doc wins any disagreement
- [docs/story.md](docs/story.md): the tone authority; read before writing player-facing prose. Its Factions table is superseded; the roster is [systems-ideologies.md](docs/systems-ideologies.md)
- [docs/reference/house-voice.md](docs/reference/house-voice.md): the house voice, modelled on Fallout. Techniques, target lengths per surface, what not to do and worked examples. Read with story.md before writing any player-facing prose.

**Engine & seams**

- [docs/server.md](docs/server.md): boot, in-memory vs DB state, ticks, WS handling, and the engine hook reference (as built)
- [docs/commands.md](docs/commands.md): dispatch pipeline, SIFT/FATE target resolution, rules for SIFT in new commands
- [docs/scripting.md](docs/scripting.md): action registry, event bus, flag store, script graph runner: the mutation path all content goes through
- [docs/plugins.md](docs/plugins.md): which plugin owns each verb; plugins beat engine builtins
- [docs/plugin-standard.md](docs/plugin-standard.md): `plugin.json` schema, README convention, tick/DB-burden rules, `regress.js` shape
- [docs/proposals/engine-plugin-boundary.md](docs/proposals/engine-plugin-boundary.md): substrates/laws/registries vs systems, and the tests for where new code lives
- [docs/audits/](docs/audits/README.md): reusable audit prompts; start with [source-of-truth-audit.md](docs/audits/source-of-truth-audit.md)
- [docs/ops-usage-watch.md](docs/ops-usage-watch.md): daily free-tier budget report (`npm run ops:usage`) from the Neon and Render APIs, graded on projected pace. Read before touching anything that costs egress

**Content & authoring**

- [plugins/cooking/README.md](plugins/cooking/README.md): cooking (as built): recipes, boiling, improvised dishes, player recipes, the burner dial. A cooking fluid is an ingredient row; never add another fluid model
- [docs/reference/plain-writing.md](docs/reference/plain-writing.md): the writing standard for docs, comments, commits and READMEs. Say it once, plainly; contractions are the default
- [docs/reference/cockpit-lettering.md](docs/reference/cockpit-lettering.md): every cockpit control gets real lettering in the legend face (`client/shared/legend-font.js`); the Drake is the bar
- [docs/items.md](docs/items.md): every `items` field and which keys the engine reads. Descriptions are 300 characters or fewer
- [docs/tags.md](docs/tags.md): tag catalog, helpers, Tag→Action registry, and how to add a tag
- [docs/reference/item-facets.md](docs/reference/item-facets.md): how shop shelves and containers section their items (`server/engine/classify.js`); the stock picks the axis, and flat is a valid result
- [docs/flags-keys.md](docs/flags-keys.md): `flags` keys on zones/NPCs/furniture and their owning plugin; owner `—` means nothing reads it
- [docs/vine.md](docs/vine.md): the VINE graph editor: file roles, schemas, editor internals
- [docs/ai-behaviour.md](docs/ai-behaviour.md): VINE behaviour trees for enemies and NPCs
- [docs/npc-clothing.md](docs/npc-clothing.md): the `CLOTHING` table, injection at `apiCreateNpc`, `flags.clothing_layers`
- [docs/bsm-format.md](docs/bsm-format.md): the `.bsm` broadcast-script spec; read before editing `data/scripts/*.bsm`
- [docs/amp-format.md](docs/amp-format.md): the `.amp` audio-asset spec from the devpanel Audio tab; read before editing an audio preset
- [docs/content-pipeline.md](docs/content-pipeline.md): one JSON file per entity under `content/`, export/import/lint, CI deploy. Git is the only writer of prod content

**World & place**

- [docs/reference/glass-notes.md](docs/reference/glass-notes.md): the GLASS renderer, free camera and seat-layout notes, with every trap and the gate that checks it. Read the relevant section before touching `windshield.js`, `gl/`, a building model or a seat.

- [docs/systems-world.md](docs/systems-world.md): world state, movement, ambience, sound, spawning, minimap, scheduler (as built)
- [docs/reference/land-taxonomy.md](docs/reference/land-taxonomy.md): region vs district vs terrain vs biome. Read before touching any of them
- [docs/systems-wildlands-ground.md](docs/systems-wildlands-ground.md): the ground between regions (as built). Render and prose only; after moving a region run `npm run wildlands:bake`
- [docs/systems-terrain.md](docs/systems-terrain.md): `flags.terrain` and the Terrain Painter; drives minimap and pacing, not passability or flight (as built)
- [docs/systems-overland-void-travel.md](docs/systems-overland-void-travel.md): transient waste rooms off a region's rim via `movement.edge` and `registerTransientZone` (as built)
- [docs/reference/building-styles.md](docs/reference/building-styles.md): art direction by quarter and region. A building gets its name once; a second sign uses `$trade`
- [docs/reference/world-rendering.md](docs/reference/world-rendering.md): how a tile becomes a building in GLASS, palettes, the three tower renderers, the berth. Read before "improving a model"
- [tools/modelshop/README.md](tools/modelshop/README.md): the Modelshop (`npm run modelshop`, :5181): GLASS model inspector, editor, differ and vehicle parameters. Bind authored models by name, never by type
- [tools/studio/README.md](tools/studio/README.md): the Studio (`npm run studio`): the file-based map editor for `content/`
- [docs/reference/building-shapes.md](docs/reference/building-shapes.md): building geometry recorded via `SHAPE_SINK`, driving LOD, occlusion, shadows and CFIT collision (as built)
- [docs/proposals/coldwater-infill.md](docs/proposals/coldwater-infill.md): fourteen infill buildings (as built). Run `node scripts/content/sitecheck.mjs` before siting; an open mid-block tile is usually somebody's street access
- [docs/proposals/old-coldwater.md](docs/proposals/old-coldwater.md): the south-east slums (as built). Tents are a `mark`, never a `building_type`; 925,917 is a storm drain into the Under. Nothing there carries words, painted or lit (`SLUM_DECLINE`)
- [docs/proposals/halcyon-fields-infill.md](docs/proposals/halcyon-fields-infill.md): Halcyon Fields streets and 42 buildings (as built). A door's direction is fixed by `flags.entrance`
- [docs/zone-redesign-2026-07.md](docs/zone-redesign-2026-07.md): why zone fields have the shape they do
- [docs/lore-wildblood.md](docs/lore-wildblood.md): Wildblood canon, read before writing mutants or the Under. The Under was theirs first
- [docs/systems-wildlands.md](docs/systems-wildlands.md): the Curtain and the Wildlands. Map and wall built; systems are design; its camp section is superseded by the Scarletwastes
- [docs/proposals/scarletwastes.md](docs/proposals/scarletwastes.md): the Scarletwastes and the Thornwarren (as built). The region is uniformly `redrock` on purpose; don't scatter terrain in code
- [docs/roadmap-world-expansion.md](docs/roadmap-world-expansion.md): the road to the 100×100 Basin; its open questions are still unanswered
- [docs/devpanel-js.md](docs/devpanel-js.md): what each `client/devpanel/js/` script holds, and load order

**Systems (as built)**

- [docs/combat.md](docs/combat.md): to-hit, body parts, soak, cooldowns, enemy AI, loot; the authority on combat
- [docs/systems-survival.md](docs/systems-survival.md): hunger, radiation, drugs, buffs, sleep, statuses, and drug visuals (`client/shared/drug-fx.js`). A `phantom` hallucination must resolve to `null`
- [docs/systems-mutations.md](docs/systems-mutations.md): mutations, both phases. Contributions are derived at read time, never baked into `players.stat_*`; an effect key with no reader fails the build
- [docs/systems-nullcraft.md](docs/systems-nullcraft.md): Nullcraft, the Null's discipline (Phase 1). Trace is RAM-only; targets arrive via the `tech.targets` hook
- [docs/systems-psionics.md](docs/systems-psionics.md): Psionics, the Exodus discipline (Phases 1–2). Below Seer no output may claim a mechanism (`voice()` in `plugins/psionics/prose.js`)
- [docs/systems-mastery.md](docs/systems-mastery.md): Mastery, the Long Watch discipline. `regardOf`/`standingGreeting` are for speech only; never gate on them
- [docs/systems-weather-extreme.md](docs/systems-weather-extreme.md): severity, lethal channels, forecast band, hero events, acid rain, ion storms (as built)
- [docs/systems-economy.md](docs/systems-economy.md): credits, vendors, crafting, IP, housing
- [docs/systems-ideologies.md](docs/systems-ideologies.md): the four orders, stance and path, `ideologies`/`rep`, `org_relations`
- [docs/systems-unrest.md](docs/systems-unrest.md): faction conflict per 12×12 cell (phases 1–3). Never gets a player readout; check it at `/dev`
- [docs/systems-corps.md](docs/systems-corps.md): corps, influence and power levers (Phases 0–3 built; espionage and NPC AI are design)
- [docs/systems-flight.md](docs/systems-flight.md): aircraft, airfields, hazards, contracts, air combat, hangars. `registerCellOverlay` is render-only and must never feed `surfaceAt`
- [docs/systems-helm.md](docs/systems-helm.md): the Echelon helm chase view and `echelon_bridge` verbs
- [docs/systems-trucking.md](docs/systems-trucking.md): driving the void highway (as built). The server derives the odometer from reported position; never trust a client distance
- [docs/systems-broadcast.md](docs/systems-broadcast.md): channels, VINE scripts, hosts, camera feeds, show modes, the two sports
- [docs/systems-surveillance.md](docs/systems-surveillance.md): SPECTER spy networks and the wanted system
- [docs/systems-shopalarm.md](docs/systems-shopalarm.md): intruder alarms behind hacked shop locks (as built). The `1s` sweep alone decides whether it tripped
- [docs/systems-jail.md](docs/systems-jail.md): Holding, confiscation, the cell door, `player.respawnZone`
- [docs/systems-scavenging.md](docs/systems-scavenging.md): posture-based search, per-zone loot tables
- [docs/systems-fishing.md](docs/systems-fishing.md): cast-and-wait, reel overlay, Fishing skill
- [docs/systems-strays.md](docs/systems-strays.md): Cathode the stray cat and the `search` verb. Her 24h hide timer must be set before any `await` in the kill handler
- [docs/systems-fauna.md](docs/systems-fauna.md): the birds (as built). A flock is a pure function of its anchor tile and the wall clock
- [docs/systems-swimming.md](docs/systems-swimming.md): swimming, drowning, diving, hypothermia
- [docs/systems-mining.md](docs/systems-mining.md): deposit-working, ore tables, tool gate
- [docs/systems-jobboard.md](docs/systems-jobboard.md): rotating early-money gigs
- [docs/systems-casino.md](docs/systems-casino.md): The Lucky Bastard: `slots` and a `gametable` poker table
- [docs/systems-chess.md](docs/systems-chess.md): chess on `gametable` (as built). `move` must fall through so `move north` still walks
- [docs/systems-bounties.md](docs/systems-bounties.md): player-funded bounties paid for the head item (as built). A claim closes the row before any credit moves
- [docs/systems-atm.md](docs/systems-atm.md): ATMs: networks, fees, hacking, replenish, power
- [docs/systems-instruments.md](docs/systems-instruments.md): playable instruments (as built). Notes use the `instrument_note` route, not dispatch
- [docs/systems-procedural-audio.md](docs/systems-procedural-audio.md): generated sound: parameters+seed wire format, material tables, the `sfxDetail` tiers (as built)
- [docs/systems-senses.md](docs/systems-senses.md): smell/listen/sight hooks and their in-memory-only contract (as built)
- [docs/systems-durability.md](docs/systems-durability.md): item wear and repair (as built). `wear()` is sync; zero condition destroys the item
- [docs/systems-ascension.md](docs/systems-ascension.md): the Ascendant defection arc and the Long Watch mirror (as built). The Rite must refuse a wanted player
- [docs/systems-augments.md](docs/systems-augments.md): augments as items, installs and catalog rows (as built). Skip death corruption when the death was claimed
- [docs/systems-relationships.md](docs/systems-relationships.md): what NPCs remember about you (as built). `getRelation` is sync
- [docs/systems-hygiene.md](docs/systems-hygiene.md): filth on a body (as built). `hygieneOf` is sync and query-free
- [docs/systems-mis.md](docs/systems-mis.md): the opt-in mature layer and its two-switch consent gate (as built)
- [docs/systems-cleaning.md](docs/systems-cleaning.md): zone stains on two clocks; owned rooms keep mess a rent cycle (as built)
- [docs/systems-library.md](docs/systems-library.md): public-domain books in the tablet reader (as built). Titles must be US public domain
- [docs/systems-drinks.md](docs/systems-drinks.md): mixology and drinkware; a drink lives on the vessel's `custom_data` (as built)
- [docs/systems-faction-arcs.md](docs/systems-faction-arcs.md): the 40-slot faction quest ladder. The forty slots are never repeatable
- [docs/systems-demolition.md](docs/systems-demolition.md): breaching charges (as built). A detonation always charges a crime, so don't fail a quest on an untargeted `witnessed`
- [docs/systems-stealth.md](docs/systems-stealth.md): sneaking and knockouts (as built); combat stays to the death
- [docs/systems-dreams.md](docs/systems-dreams.md): per-player dream instances (as built). Check the wake-path table before touching anything that ends sleep
- [docs/systems-display-mode.md](docs/systems-display-mode.md): the visual/textgames/log ladder and seat keyboard ownership (as built). The middle rung's stored value is `textgames`, never `text`
- [docs/systems-accessibility.md](docs/systems-accessibility.md): `A11Y_OPTIONS`, voice input and Read Aloud (as built). Voice never auto-sends `drop`/`give`/`attack`/`buy`
- [docs/systems-posture.md](docs/systems-posture.md): the `player.posture`/`sittingOn` contract
- [docs/systems-macros.md](docs/systems-macros.md): smartbar macros and expressions. An empty list from a server that has a row is a deletion
- [docs/systems-automation.md](docs/systems-automation.md): triggers, timers, aliases, routing, speedwalk (as built). Everything runs through `runMacro()`; state triggers are edge-triggered
- [docs/systems-codex.md](docs/systems-codex.md): the cold open and the CODEX tablet app (as built). Sealed chapters never leave the server
- [docs/proposals/trading-cards.md](docs/proposals/trading-cards.md): trading cards (as built). The pack rolls at `openpack`, never at the vend
- [docs/proposals/preparation-workspace.md](docs/proposals/preparation-workspace.md): the prep HUD over cooking and synthesis. The HUD holds no logic; every action is a typeable verb

**Before touching any system, read the relevant doc section if there's one applicable to the request.**

**Before editing any player command, check [docs/plugins.md](docs/plugins.md) first**: a plugin may already own that verb, in which case the engine handler for it is dead code.

## Core architectural rules

- **Engine and content are separate.** The codebase is the engine. World content (zones, items, enemies, NPCs) lives in Postgres and is edited through the dev panel. Don't hardcode content into engine files.
- **No ORM.** Every query goes through `query()` in `server/models/db.js`.
- **Plugins for extensibility.** New behaviour hooks go in `/plugins/` unless they're genuinely core.
- **No new sparse columns on `players` or `npcs`.** Per-player scalar state goes in `player_flags` or its own feature table. Player stat columns are `stat_brawn`, `stat_reflexes`, … (not `brawn`).
- **Decide the read tier before adding a `query()`.** Prod Postgres is remote, so cost is round-trip count. Read [persistence and read tiers in docs/architecture.md](docs/architecture.md#read-tiers-where-data-lives-at-runtime) first. Hot paths (per move, swing, tick) never add awaited queries; serve them from the live player object, the world Maps or a cache. Never query in a loop (use `id = ANY($1)` or `GROUP BY`), `Promise.all` independent reads, coalesce same-row writes, and register scheduled ticks through scheduler.js idle-gated on `hasActivePlayers()`. Before caching a table, grep every writer to it; that's why `furniture` and `npcs` rows aren't cached.
- **UTF-8 without a BOM, always.** Files like `client/game/index.html` contain glyphs (`₵ ⚙ ⏻ ╱ █ ☢`). A re-save as Windows-1252 turns them into `â•±` mojibake. Check the glyphs after editing.

### Schema and content: never on boot

- **Schema** lives only in `SCHEMA_SQL` in `server/models/schema.js` (idempotent DDL). `npm run db:schema` applies it to your local DB. Prod gets it through the CODEX deploy, not a manual `db:schema`.
- **Content** is one JSON file per entity under `content/`. Build a fresh DB with `npm run db:create-local` then `npm run content:import` (applies `SCHEMA_SQL`, then loads the tree). There's no seed file and no boot-time migration; the old startup `migrate()` was removed because it rewrote content on every restart. The dev panel's `.sql` export (Power Tools → Database Backup) plus `npm run db:restore -- dump.sql` is for backups and recovery only.
- **A push to `main` is the deploy.** CI backs up prod, applies `SCHEMA_SQL`, imports content, and is regress-gated. See [docs/content-pipeline.md](docs/content-pipeline.md) and the `codex` skill.
- **To change the schema:** edit `SCHEMA_SQL`, run `npm run db:schema`, push.
- **The deploy rewrites existing rows.** The import is `INSERT … ON CONFLICT (pk) DO UPDATE SET <every file column>` ([import.mjs](scripts/content/import.mjs)); only PK-only tables use `DO NOTHING`. So removing a JSONB key from a content file removes it in prod. Write a one-shot script only when the new value can't be derived from the files (it needs state the files don't carry, or writes a table the pipeline doesn't own).
- **Running a one-shot against prod:** `node --env-file=.env.prod scripts/<name>.mjs`. `db.js` enables TLS for remote hosts, so no `NODE_ENV` is needed. Omit the flag to run locally.
- The export excludes player and runtime rows (accounts, inventory, password hashes).

## Regression testing

`npm run test:regress` ([tests/regress.js](tests/regress.js)) is the pre-deploy gate. It boots the world and all plugins (no server), checks every plugin manifest against the live registries, drives real commands through `handleCommand` with a fake player, and runs every plugin's `regress.js`.

Run it without being asked, and say so, after:

- editing the dispatch pipeline (`commands/index.js`), the plugin loader, or any engine registry or seam (actions, events, hooks, specialized actions, move gates, posture)
- adding, removing or renaming a plugin verb, or changing a `plugin.json`
- moving a system between engine and plugin
- before any push of server code, even if the change looks unrelated

Never run it on production boot.

When you add a plugin or a verb, add `plugins/<name>/regress.js` (default export `async ({ run, check, getPlayer }) => { … }`; see [plugin-standard.md](docs/plugin-standard.md)).

### Reading a run

- **The pre-push hook runs `npm run test:regress`**, `pretest:regress` included. Add a gate to [scripts/gates/manifest.mjs](scripts/gates/manifest.mjs) and the push gate gets it.
- **No trailing `N/N passed` line means the run was killed, not that a test failed.** Re-run standalone before looking for a bug.
- **A run is quiet.** A failing check prints when it fails; a passing one doesn't. Each layer and each plugin suite ends with one line of counts and CPU, and the run ends with the five slowest sections and `N/N passed`: about 200 lines in all. `npm run test:regress -- --verbose` prints every check (about 11,000 lines), and `node scripts/gates/run.mjs --verbose` prints every gate's output.
- **Don't read the exit code through a pipe.** `npm run test:regress 2>&1 | tail -4` reports `tail`'s status. Redirect instead: `npm run test:regress > /tmp/reg.txt 2>&1; echo $?`, then read the `N/N passed` line or look for a `— FAILURES (n) —` block.
- **Never run two regress suites at once.** `pretest:regress` runs `scripts/kill-orphans.js`, which kills any running `tests/regress.js`, so the second run silently kills the first.
- **`EMAXCONNSESSION`** means something is holding Neon pool connections (pool size 15), usually an orphaned `node server/index.js`. `kill-orphans.js` runs before every regress and before `npm run dev`; run it by hand with `npm run kill:orphans`. It's Windows-only, only targets this repo's entrypoints (`server/index.js`, `tests/regress.js`, `sync-commits.js`, `scripts/dev.mjs`, `tools/studio/serve.mjs`, `tools/modelshop/serve.mjs`), and never runs in production. If it can't reach the process, wait about 90 seconds.

### Checks in `pretest:regress`

`pretest:regress` is `node scripts/gates/run.mjs`: every gate in [scripts/gates/manifest.mjs](scripts/gates/manifest.mjs), run side by side, one per core up to 8. The group scripts (`shapes:smoke`, `client:smoke`, `docs:lint`, `a11y:smoke`, `voice:smoke`, `audio:smoke`) each run one group from the same list. **To add a check, add its path to its group in the manifest**, and the push gate and the group script both get it. `npm run gates:list` prints the list.

- A passing gate prints nothing. A failing one prints its whole output, and the run ends with one summary line and the five gates that cost the most CPU.
- **Every gate has a CPU budget** of 60 s, unless the manifest gives it more with a `why`, and fails by name over it. The suite has its own: 60 s of CPU per check and 30 s per plugin suite, failed as `budget: …` checks. Make the slow thing cheaper instead of raising the number. On 2026-09-28 one gate was 11 minutes of a 30-minute chain and one check was 55% of the suite, and nothing said so.
- A gate has to be safe beside any other: no database, no fixed port, no files written. One that isn't goes in a `serial` group, as `kill-orphans` (alone, first) and `check-stale --import` (alone, last) do.
- Under the DOM stub there's no WebGL, so the Mode-7 floor is a per-texel JS raster. A gate that isn't testing the floor should paint a coarse one (`tune: { pixel: 16 }` on the view, or `RENDER_TUNE.pixel`); at the default of 1 the floor was 99% of `clouds`. A `canvasResidue` caller that only reads the sinks should pass `who: false`, which skips a stack walk per face.

**[scripts/shapes/smoke.mjs](scripts/shapes/smoke.mjs)**, the first gate in `shapes:smoke`, runs every building model in `drawTypeModel` against a DOM stub, night and day, both entrance facings, and fails if one throws. It's the only automated windshield coverage (a café model once froze the sim the first time a player flew past it). It also checks that captured geometry stays affine. Run `npm run shapes:smoke` after touching any building model or mass primitive; it needs no browser, DB or network. If it fails on a missing browser API, add the API to [scripts/shapes/dom-stub.mjs](scripts/shapes/dom-stub.mjs). It proves models run, not that they look right.

**`docs:lint`** is six checks:

- `docs:links`: every doc link resolves.
- `docs:verbs`: every plugin verb is named in [docs/plugins.md](docs/plugins.md). A verb no player types (a client handshake like `readresolve`) goes in `NOT_PLAYER_TYPED` in [scripts/docs/verbs.mjs](scripts/docs/verbs.mjs), with a reason.
- [scripts/docs/lint.mjs](scripts/docs/lint.mjs): a doc's status header can't claim nothing is built ("Not Yet Built", "DESIGN ONLY") above a body of ✅/`*Built:*` markers. Compound statuses ("Phases 0–2 built; rest design") pass. When you finish a system, update the status line at the top of its doc.
- `docs:readmes` ([scripts/docs/readmes.mjs](scripts/docs/readmes.mjs)): the same status rule for `plugins/*/README.md`, plus a README can't file a verb under future work while `plugin.json` declares it. It reads headings only; prose matching produced false findings.
- `docs:hooks` ([scripts/docs/hooks.mjs](scripts/docs/hooks.mjs)): every hook fired in `server/` or `plugins/` has a row in the hook reference in [docs/server.md](docs/server.md). It scans `fireHook`, `gatherHook` and `gatherHookSync`, and matches table rows, not prose mentions.
- `docs:prose` ([scripts/docs/prose.mjs](scripts/docs/prose.mjs)): AI-prose tells. A few have no legitimate use and fail on one hit; the rest are ratcheted per file in `scripts/docs/prose-baseline.json` and fail only if a count rises. After cleaning prose up, run `npm run docs:prose -- --update`. See [plain-writing.md](docs/reference/plain-writing.md#the-gate-docsprose).

**`content:lint`** also runs before any `npm run content:import`. It fails a hand-written content file that carries a runtime column (an `excludeColumns` key such as `zones.stains`). `content:export` already strips those.

**`client:smoke`** ([scripts/client/parse-smoke.mjs](scripts/client/parse-smoke.mjs)) parses every file under `client/` (~270) with `node --check` on stdin with `--input-type=module`. Keep it that way: `node --check <path>` parses a `.js` file as CommonJS and passes files that break in the browser. The failure it exists for: client panels are large template literals, and a backtick in a comment inside one ends the string. A `` `horn` `` in `cab-view.js` once killed the whole client boot on prod. **Inside a template literal, quote identifiers with single quotes, never backticks.**

**`bigscreen:smoke`** ([scripts/client/bigscreen-smoke.mjs](scripts/client/bigscreen-smoke.mjs)) checks big-screen mode for every windshield seat; details in [docs/reference/glass-notes.md](docs/reference/glass-notes.md).

**`imports:smoke`** ([scripts/imports/smoke.mjs](scripts/imports/smoke.mjs)) checks that every named import across `server/`, `plugins/`, `client/`, `scripts/`, `tests/` and `tools/` exists as an export of its target. A missing export stops the whole module loading at link time.

- Bare, it checks the working tree. With `--ref <oid>` it checks a commit in a detached worktree, and **the pre-push hook runs it that way for every pushed oid**, because the working tree isn't what you push. It exists because a commit once imported an export that was still uncommitted: local regress passed, CI couldn't load the surveillance plugin, and content deploys stopped. Staging by file isn't enough when one change spans two files.
- Don't replace its scanner with a regex over raw source. It blanks comments, template literals and regex literals first; without that, a first version reported ten false findings out of eleven. Interpolations are scanned as ordinary code, by the one scanner.
- Only named imports are checked. To silence a line, add `// imports-ok: <reason>` (reason required). About 2 seconds over ~1,300 files.

## VINE graph workflow

Creating or updating NPC behaviour graphs, dialogue trees or enemy behaviour graphs is covered by the `mud-designer` skill (push mechanics, auth, the dialogue flat-params gotcha). Schemas are in [docs/vine.md](docs/vine.md).
