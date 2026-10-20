# Findings: code efficiency and LOC (2026-10-19)

**Status: batches in progress.** Each section below carries its own status. The sweep is a point-in-time report; line numbers are as of commit `da04aa7a3`.

Three read-only sweeps asked where the lines are, which of them are dead, what's copied, and what we do a slow way out of habit. The baseline is about 775k lines of tracked code in 1,694 files (`content/` excluded). `client/game` is 282k of that, `server/engine` 50k, `client/shared` 43k and the `scripts/shapes` gates 41k.

## The short version

- **Live code is already pruned.** Functions with no caller add up to about 520 lines, and nothing is commented out. Most of the size is real.
- **The bulk is three things.**
  - **Comments:** `windshield.js` is 47% comment lines (27.8k), and cab-view, trucking and aircraft3d are 40–46%.
  - **CSS kept in JS strings:** about 890 KB across the client.
  - **One-shot scripts that already ran:** about 20k lines.
- **Duplication is small helpers copied by hand**, not big blocks. Repeated 4-line runs inside the giant files are rare (windshield 114 lines, broadcast 141).
- **Splitting the god files mostly moves lines.** It buys readability, not fewer lines. The real savings are the helpers and fixtures described below.

## Comments and performance

The server parses each file once at boot, so comments cost nothing there. The client has no build step, so every comment ships to the browser. `windshield.js` is 4.19 MB raw. The server brotli/gzip-compresses and caches static files (`server/index.js:280`), and comments compress well, so the extra cost is a few hundred KB on a cold load plus a little parse time on a phone. Once the file is cached, the cost is zero, and comments never affect frame rate. The real cost is reading: every edit reads about twice the tokens of the code.

**Policy (decided 2026-10-19):**

- Delete history, changelog narration and comments that repeat the code.
- Move long explanations into the matching doc, keeping each fact once.
- Keep a one-line why or trap at the line, with a `see docs/...` pointer where the detail went.

## Bugs found on the way

| Finding | Where | Status |
|---|---|---|
| `draw curtains` answered "Unknown command." to anyone who isn't awakened. Psionics' `cmdDraw` returned an error instead of `undefined`, so the engine's curtain alias never ran. (`reach` and `press` have no engine verb behind them, so their error is right.) | `plugins/psionics/index.js:165-178`, `server/engine/commands/housing.js:95` | fixed `c0acdd34f`, with a regress check |
| Void rooms never use `walkTerrain`. `mkRoom` takes a `pt` for it but rolls terrain with `pick(rng, VOID_TERRAINS)`, so `WALK_TERRAIN` (cliff to plateau, water to sand) never applies, though [systems-wildlands-ground.md](../systems-wildlands-ground.md) says it does. Wiring it in re-rolls every void room's terrain, so it needs a decision. | `plugins/voidwalking/index.js:371-389` | open: decision |
| `use <furniture>` and about 20 other command paths `SELECT` from `furniture`, although it's a boot-loaded Map with a write funnel. That's one round trip per command. CLAUDE.md said furniture wasn't cached; fixed. | `commands/inventory.js:562` and others; see batch 4 | doc fixed; code open |

## Dead code

| Finding | Where | LOC | Status |
|---|---|---|---|
| World-builder one-shots already run (`oneshots-pending.bat:30-34` says their files are committed) | `scripts/build-{scarletwastes,terminus,terminus-npcs,thornwarren-people,thornwarren-npcs,deadwater,deadwater-npcs,ascendant-npcs,ascendant-stronghold}.mjs`, `bake-terminus-markers`, `demote-thornwarren-shells` | ~6,460 | open |
| Content generators already run | `scripts/content/`: dreams-drug/sleep expansions, halcyon batches 6–10, drug-arcs, coldwater-palais, author-codex-dialogue, prose-trim-asides, build-glossary, build-sewer-grid, old-coldwater-gaslight and about 12 smaller ones | ~6,200 | open |
| Unlinked sandbox pages | `tools/sandbox/`: rink-2d-vs-3d, splice-lab-test, canopy-glass-lab, flight-sim-test, tv-fx-test, tv-flatscreen-test | ~4,070 | open |
| Old backfills | `server/models/temp/`: backfill-npc-{clothing,schedules,sex}, normalize-name-case, drop-craft-time | ~440 | open |
| Strays | `tmp-cmp-derive.mjs`, `scratch2.cjs`, `docs/proposals/*.gen.mjs` | ~400 | open |
| Functions with no caller (a rescan found 51 that no code names anywhere) | `_bcCommEditor`, `cloneBroadcast` (devpanel broadcast.js), `truckPane`, `availableRoster`, `veLeftClick`/`veRightClick`, `mayflyRoom`, `isIdeologyHostile`, `unschedule`, `registerRoutes`, five `tv.js:2136-2145` wrappers, ~40 small ones | ~450 | 41 removed (about 400 lines). Kept `walkTerrain`, which is unwired rather than dead (see Bugs), and the documented API ones: `unschedule`, `registerRoutes`, `getRegisteredConditionShapes`, `applyTopicalToAll`, `tellPlayerAboutCache`, `vineJumpToQuest`, `setInteriorPose`, the `tv.js` panel wrappers |
| Superseded body-warmth copy | `server/engine/gameLoop.js:1556-1568` `metabolicWarmth` | 13 | removed |
| Unreachable engine `follow` (the interactions plugin always answers) | `server/engine/commands/movement.js:922-934` | ~15 | removed |

**Kept on purpose:**

- The low-confidence seeds that help text still names (`seed-dealer`, `seed-synthesis`, `seed-banter`, `setup-destructible-power`, `seed-drugs`).
- `rename-admin` and `reset-chars`, which npm runs.
- The six sandbox pages the docs cite.
- The hand-run diagnostics: `scripts/docs/{build-dialogue-review,place-names,dialogue-integrity,dialogue-audit}`, `scripts/client/bootpayload`, `scripts/lint/dupkeys`, `scripts/{set-climate,keycard-census,report-flag-keys,report-tag-keys,glide-polar}`.

**Not dead:**

- **GLASS 1.** It's a Settings choice and the fallback when GLASS 2 fails. GLASS 2 also fills its buffers through the same 2-D painters and `glass/models/*`, so only about 500–1,500 scattered lines are GLASS-1-only, with no block worth cutting.
- **RENDER_TUNE.** All 325 keys are read. None of the 50 keys removed in `224e9f6d9` is still referenced.
- **The engine handlers plugins shadow,** apart from `follow` and `draw`. The plugins return `undefined` on purpose to fall through.

## Duplication

| Pattern | Count | Shared home | Est. saving | Status |
|---|---|---|---|---|
| HTML escape | 36 client, 3 server, plus inline `replace(/&/g…` (62 client, 13 server). Several skip `"`, so they're unsafe in attributes. | `client/shared/dom.js:5`, `server/engine/html.js:7` | ~120 lines | game client: 21 copies that already escaped `"` now import the shared one. Open: the copies that skip `"` or feed a later regex (markup, dialogue, whisper, tv, gameday), the devpanel (classic scripts, no import), the server three |
| Seeded RNG and hashes | FNV basis ×41, mulberry32 ×32, sin-hash ×48. Trucking has the same pair 4 times; diamond/ redeclares an exported `hashStr` 7 times. | none (`plugins/cards/builder.js:752` exports one) | ~150 | server: 8 copies (4 trucking, voidwalking, weather, consort, news-generator) now import `server/engine/rng.js`, each proven to give identical draws. Open: the client copies; `cards/builder` and `broadcast/rng` seed differently and stay |
| clamp / lerp | 43 / 27 local copies. 11 interior-* files define lerp beside an imported clamp. | `server/engine/util.js:14`, `client/shared/interior-kit.js:68` | ~200 | `lerp` exported from interior-kit; the 11 interior copies removed. Open: the other client copies |
| pick / cap / randInt | 4 pick, 4 cap and 1 randInt copies of `util`, plus 193 inline `arr[Math.floor(Math.random()*arr.length)]` | `server/engine/util.js` | small | open |
| `pickWeighted`, `resolveCorpse`, `decayed` | 4 / 3 / 3 identical bodies | `zone-stock.js:17`, `commands/combat.js:16`, `nullcraft.js:83` | ~45 | done: `pickWeighted` and `decayed` in `server/engine/util.js`, `resolveCorpse` in `world.js`. Shove keeps its own `resolveCorpse`, which differs |
| Plugin message wrappers | `out` ×9, `say` ×5, `sys` ×6, `dim` ×7 | none; `plugins/flight/state.js:2477` exports one, which is the wrong home | ~40, more if span literals follow | open |
| Hand-rolled panel drag | 7 copies, which miss the `touch-action:none` fix | `makeDraggable` in `client/game/js/panels/confirm.js:34`; `.dp-float-panel` | ~150 | open |
| Seat helpers | `hotAt` ×4 (cockpit, cab-view, boat-view, podracer-view), `revKick` ×2. podracer-view.js is a fork of boat-view.js: 11 matching functions. | none | ~250 | proposal |
| Content scripts walk the tree by hand | 17 scripts re-implement read and write-back | `scripts/content/lib.mjs` (`readContentTree`, `canonicalJson`) | ~300 | proposal |
| Regress fixtures | 190 hand teleports, 138 `try/finally` restores, `mkZone` ×5, 71 hand inventory inserts, 252 `JSON.stringify(out)` checks | `tests/regress.js:6851` passes only `{ run, check, getPlayer }` | 600–1,000 | `mkZone` open; `fx` object a proposal |
| glbench boilerplate | canvas setup ×39; 189 hand RENDER_TUNE save/restores over 50 `finally` blocks | none | ~500 | open |
| styles.css | 89 rules repeat an identical body under another selector. 42 class names match nothing in client/, plugins/ or server/, not even as a prefix. | | ~300 + dead rules | open |
| Small client copies | `themeColor` ×2 (the uncached one calls `getComputedStyle` every draw); `embossText` ×2; `formatWeight` ×3 | `minimap-assets.js:123`, `coliseum.js:217` | small | open |

## CSS kept in JS strings

| File | Function | Size |
|---|---|---|
| tablet-os.js | `ensureStyles` (lines 220–3762) | 335 KB |
| cockpit.js | `ensureHudStyles`, `ensureFlightSimStyles` | 132 KB |
| cab-view.js | `ensureCabStyles` (5059–6371) | 100 KB |
| hangar-bay.js | | 56 KB |
| cardpack.js | | 41 KB |
| truck-depot.js | | 39 KB |

Only cab-view's string interpolates anything (`${TOUCH_MQ}`).

**Status: done for every block over 75 lines.** 8,821 lines left the JS for 15 sibling `.css` files (`tablet-os.js` 918 KB to 591 KB, `cockpit.js` 592 KB to 461 KB, `cab-view.js` 460 KB to 362 KB). Each was checked to be the same text the template produced, apart from indentation.

- **How it loads:** a `<link>` would apply a frame late, so the first open would lay out unstyled. Instead each module `await`s `loadCss` (`client/shared/dom.js`) when it loads, and `ensure*Styles` still injects the text synchronously on open. All these modules load lazily, so the fetch rides the load the opener already waits for.
- **cab-view:** its sheet carries `__TOUCH_MQ__`, swapped for `TOUCH_MQ` on inject, so the media query keeps one definition.
- **Gates:** `bigscreen-smoke` and `a11y:smoke` read the sibling sheets too.
- **Left in JS:** blocks under 75 lines, and windshield.js's styles, which interpolate live values.
- **Still open:** styles.css grouping and dead rules.

## Database habits (cold and warm paths)

These are open.

- Queries inside loops:
  - `plugins/flight/contracts.js:711,766,790,890`: one UPDATE per drop.
  - `plugins/consort/hire.js:367-404`: one UPDATE per member.
  - `server/engine/graph.js:463`: one inventory decrement per row.
  - `plugins/broadcast/index.js:11207,11432`: one query per neighbour direction.
- `server/engine/crafting.js:127` reads `items` for a name that `items-cache` already holds.
- 223 `SELECT *` sites. Most are single rows. `server/api/routes.js:1437,1887` return whole tables.

## Splits (proposals)

**Status: proposal.** Ranked by payoff over effort. None of these saves lines; they make the files readable.

1. **aircraft3d.js along its builders,** behind a re-export facade (windshield imports about 15 names from it). It has only 4 module `let`s. The seams are aircraft 400–2219, rotor/prop FX 2220–3439, `buildBoat` 3440–4611, `buildTruck` 4612–5782, wreck and canopy art 5783–6965, scenes 6966–9092. The station loop is pasted 3 times (1664, 1959, 3213).
2. **windshield Step 5's easy parts:** `RENDER_TUNE` (196–2108, no state) and the props tail (53757–58975). The rule still holds: nothing may read a windshield value at load.
3. **`Speech` out of audio-engine.js** (3112–6237, half the file) into its own module. It needs only `ensureContext`, `busFor` and the resonator bank.
4. **Data out of logic files.** npc-personality.js is about 2,000 of its 2,207 lines data (`DEFAULTS` 1,551, `HOME_ACTIVITIES` 239, `CLOTHING` 216). Others: flight-model `TYPES` 553, birds `SPECIES` 484, audio-rack `RACK_DRAW` 428.
5. **What [audit-followups-2026-10.md](../proposals/audit-followups-2026-10.md) §5–6 already proposes:** routes.js as a table, the broadcast peel, the tablet-os view map, the `drawWorldObjects` frame state. The big closures (`openCab` 2,878 lines, `openFlightSim` 1,666, `fsimFrameBody` 1,232) need the same state-object treatment before they can move.

## Batches

| # | Batch | Status |
|---|---|---|
| 0 | This doc; the stale furniture lines in CLAUDE.md and db-burden-audit.md | done |
| 1 | The `draw` bug | done `c0acdd34f` |
| 2 | Delete one-shots, sandbox pages and strays | open |
| 3 | Dead functions | done |
| 4 | Furniture reads from RAM | open |
| 5 | Shared helpers | part done (escaper, lerp, RNG, three server helpers); message wrappers, `mkZone`, drag copies open |
| 6 | CSS out of JS strings; styles.css grouping and dead rules | CSS moved; styles.css open |
| 7 | glbench helpers | proposal: 65 canvas setups differ in id, holder and size, so each needs hand work and a bench re-run |
| 8 | Comment trim | checker landed (`scripts/lint/comment-only.mjs`); the trim itself is three proposed sessions |
