# Findings — Doc correctness & concision audit, 2026-07

Prompt: [doc-correctness-concision-audit.md](doc-correctness-concision-audit.md).
Each verdict is checked against code at the cited `file:line` — nothing here is from memory.

## Batch 1 — `commands.md`, `scripting.md`, `plugins.md`, `plugin-standard.md`

All four classify as **as-built**: every claim is checkable against the engine or a plugin manifest.

---

### `docs/commands.md`

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| The dispatch chain is the 7 listed steps | **Incomplete** — three substrate gates also swallow commands: sigil strip, blackout, insane | `server/engine/commands/index.js:107` (sigil), `:115` (blackout), `:189` (insane, `sleep`/`rest` exempt) | Fixed — replaced the "no per-verb special cases" history sentence with the gate list |
| Ambiguous picks replay via `{dispatchType, dispatchParam}` or `{verb}` — two routes | **Incomplete** — a third route exists: `moveDirection` + the candidate's zone id calls `cmdMove` directly | `server/engine/commands/index.js:130-136`, set at `movement.js:382` | Fixed — added the movement-picker route |
| `world.js` owns examine targeting | **Ownership drift** — the interactions plugin registers `examine` and wins dispatch; it returns `undefined` for entity targets so `world.js` still runs | `plugins/interactions/plugin.json:9`, `plugins/interactions/index.js:677`, `server/engine/commands/world.js:678` | Fixed — noted the fall-through in the table |
| Domain table covers where targeting happens | **Incomplete** — `doors.js` (`doors.hack`) and `movement.js` (move picker) both create selection state and were absent | `server/engine/commands/doors.js:384`, `movement.js:382` | Fixed — two rows added |
| Alias pre-pass: `ALIAS_DEFAULTS`, DB-overridable, only pure synonyms | Correct | `server/engine/commands/aliases.js:20-59,68-82` | — |
| SIFT score bands (100 / 90–99 / 70–88 / 40–69 / 10–38), 8-point ambiguity gate, same-name silent pick | Correct | `server/engine/sift.js:20-33,105-112` | — |
| Selection state: 60 s TTL, pageSize 5, number/next/prev/cancel | Correct (`exit` is also accepted) | `server/engine/sift.js:156-157,193-213` | — |
| `COMBAT_VERBS` = attack/hit/strike/shoot/kill/k/a; FATE tiebreakers last-attacked then lowest instanceId | Correct | `server/engine/sift.js:39-50,135` | — |
| `matchAll` = all candidates >0, no ambiguity gate | Correct | `server/engine/sift.js:118-129` | — |
| `drop all` → confirm `drop __allconfirm`; `drop all <filter>` → `matchAll` | Correct | `server/engine/commands/inventory.js:310-319,335` | — |
| Complex-arg exception: `give` errors on ambiguous | Correct (both the player and NPC recipient paths) | `server/engine/commands/inventory.js:387,397` | — |
| Plugin replay Actions (`thievery.steal`, `commerce.*`, `bodily.*`, `gps.navigate`, `ATTACK`) exist | Correct | `plugins/thievery/index.js:74`, `plugins/commerce/index.js:59,89`, `plugins/bodily/index.js:605`, `plugins/gps/index.js:177`, `plugins/weapon/index.js:228` | — |

**Concision** — 150 → 155 lines. Cut: narrative history (the retired cosmetic-machine pre-intercept /
MIS-regex aside). Net growth is the four correctness additions; the doc is otherwise contract-dense
and nothing else qualified for the knife. Code blocks preserved verbatim.

---

### `docs/scripting.md`

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| Built-in actions are "registered across `graph.js` and `flags.js`" | **Wrong** — `actions.js` itself registers seven more (TAKE, DROP, GIVE, EQUIP, UNEQUIP, MOVE, EXAMINE-stub), none of them listed. An agent reading only this table would re-register `DROP` and clobber the inventory path | `server/engine/actions.js:65,85,99,112,125,144,152` | Fixed — rows added, source line corrected |
| Flag rows are `(key, value, updated_at)` | **Wrong column names** — they are `flag_key`, `flag_value`, `updated_at` (+ `player_id` on the player table) | `server/engine/flags.js:33-56` | Fixed |
| Known events table | **Incomplete** — built-in actions also emit `item.taken`, `item.given`, `item.equipped`, `item.unequipped` | `server/engine/actions.js:79,105,117,130` | Fixed — four rows added |
| `registerAction`/`dispatchAction` signatures, `requiredTag` rejects a target lacking the tag, validate-then-handler | Correct | `server/engine/actions.js:27-55` | — |
| Every listed graph.js/flags.js action exists and does what's claimed | Correct | `server/engine/graph.js:148,178,206,228,239,250,262,282,290,298,307,315,325`; `flags.js:103,114` | — |
| Events are fire-and-forget, subscriber errors isolated, rejections caught | Correct | `server/engine/events.js:15-29` | — |
| Flag API shapes, `op` set (default)/unset/eq/neq/gt/lt, `evalConditions` ANDs and returns true when empty | Correct | `server/engine/flags.js:27-98` | — |
| Scripts run to completion up to 100 steps, nest 10 deep, `wait` is non-blocking | Correct | `server/engine/graph.js:35,50,99-110` | — |
| Node type table (`action`/`setflag`/`condition`+`branch`/`say`/`script`/`wait`) | Correct — `condition` also accepts a singular `node.condition` | `server/engine/graph.js:63-114` | — |
| Dialogue is walked by `handleDialogue` in `server/index.js`, not `graph.js` | Correct | `server/index.js:1052` | — |
| ADR links 0001/0002/0004 resolve | Correct | `docs/adr/` | — |

**Concision** — 173 → 183 lines. No cuts earned: the doc is contract tables, API shapes and SSOT
statements throughout, with no history, changelog or restated code. Growth is entirely the three
correctness fixes above plus the `world_flags` cache gotcha (Flag 2). **This doc was already tight;
only its tables were stale.**

---

### `docs/plugins.md`

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| **augments** is "Step 1 — soak/backup effects await the step-2 engine seams" | **Wrong / stale status** — all three seams are wired and shipped: armor-contributor soak, `player.chromed` + `burnAllMutations`, and the whole cortical-backup death loop with `backup`/`assurance` verbs and a `player_backups` table | `plugins/augments/index.js:9-17,26-27,270,306,339`; `plugins/augments/plugin.json` commands | Fixed — status corrected, verbs + owned table added |
| **consort** has "no player verbs" (`—`) | **Wrong** — the manifest declares `beckon`, `dismiss`, `pour`, and it also hooks `player.say` | `plugins/consort/plugin.json` | Fixed |
| Catalogue covers every loaded plugin | **Index drift** — `aa-sites` (loaded, `zone.describeRoom` hook, flight AA repair loop) had no row | `plugins/aa-sites/plugin.json` | Fixed — row added |
| "`plugins/onboarding/` exists but has no `plugin.json`" | **Ghost reference** — the directory no longer exists | `ls plugins/` (absent) | Fixed — line deleted |
| swimming and sanity rows | **Malformed** — 3 cells instead of 4, so the engine-surface text rendered in the *Player verbs* column | `docs/plugins.md` table | Fixed — empty verbs cell restored |
| Dispatch order 1–5, plugins beat builtins, shadowed builtin is dead code | Correct | `server/engine/commands/index.js:194-207` | — |
| Loader warns on plugin↔plugin verb collisions and prints an ℹ line for shadowed builtins | Correct | `server/engine/plugins.js:123,163-168` | — |
| Load order filesystem-alphabetical unless `after:`; `critical:true` aborts boot; weapon is critical; gametable declares `after:["broadcast","interactions"]` | Correct | `server/engine/plugins.js:74-93,148`; `plugins/weapon/plugin.json:4`; `plugins/gametable/plugin.json:5` | — |
| `getRegisteredCommands()` lists runtime verbs | Correct | `server/engine/plugins.js:255` | — |
| Every file/script path cited in the catalogue exists (~60 backticked `.js`/`.mjs` paths, incl. all `scripts/` seeds, panel files, `plugins/gametable/text-mode.js`, `server/engine/phantoms.js`, `tools/economy-report`) | Correct — all resolve | scripted existence sweep over the doc | — |
| Every markdown doc link resolves | Correct | link sweep | — |
| Doc verb columns vs. manifests | Mostly correct. Undocumented verbs remain in rows that abbreviate deliberately (`surveillance` "…", `flight` "+ *resolve silents"): `gametable evict/text/visual`, `mis finger`, `synthesis unseal/reclaim`, `voidwalking ready`, `dev-tools makeitrain/testaccolade` | respective `plugins/*/plugin.json` | Left as-is (rows are explicitly elided) — see Flag 3 |

**Concision** — 158 → 153 lines (cells shortened well beyond the line delta; ~74 KB doc). Cut classes
applied: narrative history (retired `use` pre-intercept; drugwar's retired turf tick; checkpoint's
"replaces govgate + perimeter"; smuggle's retired `smuggle:checkpoint` gate; pinch's dead-key story —
kept the live dot-stripping gotcha), per-instance changelog (work's dated `work_xp_gate` removal and
its rationale essay), one-off bug story (accolades' `shadowBlur` freeze — collapsed to the constraint
it imposes). Contracts, flag keys, table ownership and cross-plugin seams left untouched. Line count
stayed flat because the verb columns grew back out (Flag 3) as the prose came down.

---

### `docs/plugin-standard.md`

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| `client.js` — "client module (optional — deferred; not loaded yet, see rework plan §8)" | **Ghost** — no plugin has a `client.js`, the loader never looks for one, and no "rework plan" doc exists in the repo | `server/engine/plugins.js:95-140`; no `plugins/*/client.js` | Fixed — row deleted |
| `index.js` exports "hooks / commands / actions / routeHandler" | **Drifted** — the loader reads `hooks`, `commands`, `routeHandler` and `specializedActions`; `actions` is not a wired export | `server/engine/plugins.js:99-105,138-143` | Fixed |
| Manifest schema is complete | **Incomplete and load-bearing** — `objectGatedCommands` is enforced by the regression harness (a mis-declared verb fails the gate) and was undocumented; 10+ plugins use it | `tests/regress.js:150-180`; e.g. `plugins/bodily/plugin.json` | Fixed — field documented with its enforcement rule |
| "Every plugin has a `README.md`" / README "(required)" | **Wrong** — 31 of 97 plugins have one, and the doc's own later paragraph explains why that's fine | `ls plugins/*/README.md` | Fixed — stated as the convention it is |
| `after` / `critical` behave as described | Correct | `server/engine/plugins.js:84-93,148` | — |
| `dataSchema` is documentation only; content export needs a `REGISTRY` entry in `content-registry.js`; `CONTENT_TABLES` derives from it | Correct | `server/models/content-registry.js:67,302`; `server/api/backup.routes.js` | — |
| Register ticks through `scheduler.js`; idle-gate automatic; opt out with `{ runWhenEmpty: true }` | Correct | `server/engine/scheduler.js:24,52-58` | — |
| Read-tiers link + anchor resolve | Correct | `docs/architecture.md:377` | — |
| `regress.js` default-exports `async ({ run, check, getPlayer })`; harness sweeps manifests then runs per-plugin suites | Correct | `tests/regress.js:16,72-86` | — |

**Concision** — 182 → 184 lines. Cut classes: narrative history (the "2026 architecture rework" /
"added in the engine/plugin boundary work (2026-07)" framing, the dated lag-audit attribution),
aspiration in an as-built doc ("a future pass may have the loader read them directly", "missing
READMEs are generated on demand"). Net +2 because `objectGatedCommands` had to be added.

---

## Flagged — all four resolved in-session (2026-07-24)

1. **`runGraph` + `wait` was broken for direct callers — a real code bug, now fixed.** A `wait` node's
   resume calls `runNodeChain(ctx.graph, …)` (`server/engine/graph.js:105`), but `runGraph` never put
   the graph on its own ctx — only `runScriptById` and `EXECUTE_SCRIPT` did. The documented call
   `runGraph(graph, { actor, broadcast, depth: 0 })` therefore silently dropped every node after the
   first `wait`. **Fixed:** `runGraph` now sets `graph` on the ctx it walks with
   (`server/engine/graph.js:57`), so no caller has to know. Regress: 1584/1584.
2. **`world_flags` process-lifetime cache is now documented** (`scripting.md`, Flags section). The
   runtime write funnel is clean — every world-scope write goes through `setFlag`/`clearFlag`
   (`plugins/jobboard/index.js:164,377,384`, `broadcast/index.js:4423`, `vale-apology/index.js:66`,
   `yacht/index.js:63`). The leak is out-of-process writers the funnel can't see:
   `scripts/add-jobboard-content.js:271` and `scripts/reach-jobboard.mjs:260` both `DELETE FROM
   world_flags` from their own node process, so a running server keeps serving the cached rotation
   snapshot. Stale *cleared* flags are the nastier direction — `op:'set'` gates stay true forever.
3. **plugins.md verb columns are now exhaustive.** `surveillance` (was "…") and `flight` (was
   "+ *resolve silents") are complete and grouped; the same sweep closed five more rows it had
   hidden: `gametable evict/text/visual`, `mis finger`, `synthesis unseal/reclaim` (+ dev
   `cooktest/splicetest`), `voidwalking ready`, `dev-tools makeitrain/testaccolade`. It also caught a
   **ghost verb**: flight's row listed `recover`, which does not exist — `plugins/flight/hazards.js:112`
   states outright that a stall is recovered by flying, not by a verb. The row now says so.
   A machine check (manifest `commands[]` vs. each doc row) is green across all 97 plugins.
4. **SIFT's quoted-literal mode documented** in commands.md — `"exact name"` bypasses fuzzy scoring
   and the ambiguity prompt entirely, in both `resolve` and `matchAll` (`server/engine/sift.js:84-99`).

One rendering defect fixed alongside: the **broadcast** row's `air play|stop|skip|…` verb string used
unescaped pipes, which split that row into 15 table cells. Every catalogue row now renders 4.

## Batch summary

The most dangerous stale claim was **plugins.md's "augments … Step 1 — soak/backup effects await the
step-2 engine seams"**: an entire shipped subsystem (the cortical-backup death loop, two verbs, a
table, three engine seams incl. an armor contributor and a mutation-trigger bail) was documented as
unbuilt, in the one doc agents are told to consult *before editing any player command*. Anyone
extending augments would have rebuilt it. Runner-up is scripting.md's built-in action table omitting
the seven actions `actions.js` registers — the same shape of error, with `DROP`/`TAKE` collision risk.

Two structural lessons for the next batch. First, **the machine-checkable sweeps paid for themselves**:
comparing `plugin.json` manifests against the doc's verb column found the consort and augments drift
in seconds, and a link/path existence sweep cleared ~60 references at once — worth running first on
any doc with a catalogue (`flags-keys.md`, `devpanel-js.md`, `items.md`). Second, **status stamps
inside catalogue cells are where rot hides**, not in prose sections — phrases like "Step 1", "pending",
"await the step-N seams" buried mid-cell. I'd reorder the next batch to put `flags-keys.md` and
`items.md` first (both are pure field/key registries, fully sweepable) ahead of the narrative
`systems-*.md` docs.

---

## Batch 2 — `temp/qa-audit-2026-06.md`, `zone-redesign-2026-07.md`, `zone-cutover-runbook.md`

All three classify as **findings log / point-in-time**. Their findings are frozen records and were not
rewritten; the audit questions are fix-status accuracy and each doc's own retirement condition. Two of
the three carry an explicit self-delete or self-trim condition, and **both conditions are now met**.

The fact that governs all three: the **358-zone `map_world` they describe was retired on 2026-07-11**
(`c1f964e5`, "delete the legacy overworld (740 files)") and replaced by the district world — 5,785 zone
files today, 5,439 of them on `map_world`. Every zone count, shortlist and named zone in the two zone
docs is measured against a world that no longer exists.

---

### `docs/zone-cutover-runbook.md`

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| "Prod still has the old columns and old data … prod behaves identically until you push" | **Wrong / stale status, and the dangerous one** — the push happened. The four `DROP COLUMN IF EXISTS` lines shipped 2026-07-10 and are on `origin/main`, so CI has applied them to prod | `server/models/schema.js:70-73`; `git log -S` → `e3e1b1b8` (2026-07-10); `origin/main` = `dd2360e2` (2026-07-24) | Fixed — status stamp now reads EXECUTED, with the shipping commit |
| Step 2 "Commit + push (this IS the deploy)" is pending | **Stale** — executed; content tree carries none of the four keys | `grep '"is_safe_zone"\|"radiation_level"\|"pvp_enabled"\|"danger_rating"' content/` → no files | Folded into the status stamp |
| Curation shortlist = 218 former safe zones | **Ghost target** — those zones were deleted 2026-07-11 | `c1f964e5`; `zone_deep_deepmaw`/`zone_deep_gasp` now appear only in these two docs | Noted in the status stamp; step text left frozen |
| Sanity walk: "Walk into the Redline … `☢ RAD:40+`" | **Ghost target** — no Redline street zone survives; only `zone_aa_redline_bunker` | `content/zones/` sweep for `Redline` | Noted in the status stamp |
| `scripts/migrate-zone-columns-to-tags.mjs` exists | Correct | `scripts/migrate-zone-columns-to-tags.mjs` | — |
| Maps → "Paint Safe Zones" now paints the `sanctuary` tag via the atomic single-tag PATCH | Correct | `client/devpanel/js/panels/maps.js:614,627-639`; route at `server/api/routes.js:296` | — |
| Five named stale one-shot seeds still INSERT dropped columns | Correct — all five present and still referencing them | `scripts/seed-hangar-interiors.js`, `seed-surveillance-vendor.js`, `seed-furniture-store.js`, `seed-clothing-store.js`, `seed-wanted-police.js` | — |

**Concision** — 56 → 59 lines, then **deleted** (Flag 4): the corrected stamp confirmed the doc's own
delete condition was met, so the fix and the retirement landed in the same pass. The five stale one-shot
seeds it listed were carried into `zone-redesign-2026-07.md` Outstanding §3 before deletion.

---

### `docs/zone-redesign-2026-07.md`

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| "All work is **local-only** until the prod runbook is executed" | **Wrong / stale status** — shipped 2026-07-10 | `e3e1b1b8`; `server/models/schema.js:70-73` | Fixed — header states shipped, plus the 2026-07-11 world swap |
| Outstanding 1: prod rollout pending | **Stale** — done | as above | Fixed — item removed |
| Outstanding 4: review `zone_deep_deepmaw` / `zone_deep_gasp` | **Ghost** — neither zone exists; the ids survive only in these two docs | `content/zones/` sweep | Fixed — item removed |
| Outstanding 2: sanctuary curation, "the runbook prints the 218-zone shortlist" | **Half stale** — the work is genuinely still open, the shortlist is not. 10 zones carry `sanctuary`, all inside two buildings (`zone_lw_*`, `zone_solenne_*`); no street hub has one | `content/zones/*.json` grep `"sanctuary"` → 10 files | Fixed — item kept, shortlist pointer corrected, current state stated |
| Outstanding 3: "triage the 112 lint gaps" | **Stale measurement** — 112 was measured on the retired `map_world`; the tool still exists, the district world is unmeasured | `tools/zone-planner/lint.mjs`; `c1f964e5` | Fixed — reworded to a re-run, count no longer asserted |
| Outstanding 5: stale one-shot seeds | Correct | five scripts verified present | — |
| `server/engine/zone-tags.js`: `getZoneRadiation` (0–100 tag), `isSanctuary` (tag only) | Correct | `server/engine/zone-tags.js:11-13,21-23` | — |
| Sanctuary registers through the protection substrate as `engine:sanctuary` | Correct | `tests/regress.js:766` asserts the provider is registered | — |
| `danger.js`: `zoneDanger` precedence tag → sanctuary → cached inference; cache field `zone._dangerInferred`; radiation floors at 25/40 | Correct | `server/engine/danger.js`; asserted at `tests/regress.js:847-859` | — |
| Facade seam: `isEnterableFacade`, one `cmdMove` seam `resolveFacadeTransit`, `resolveLanding()` wraps direct landings, `out` → `flags.world_exit_zone` | Correct | `server/engine/commands/movement.js:307,405`; `resolveLanding`/`isEnterableFacade` exported from `world.js` (`tests/regress.js:872-890`); tag documented `client/shared/tagCatalog.js:300,309` | — |
| Minimap: server BFS `depth=8` / `WIN=4` | Correct | `server/engine/world.js:839,870` | — |
| Minimap: "client `R=4` in `minimap.js`", `▣` facades / `◆` sanctuary | Correct, with drift — the file is now `client/game/js/panels/minimap.js` and `R=4` is level 0 of a zoom ladder, not the only window | `client/game/js/panels/minimap.js:23,641-642` | Left frozen (accurate as of 2026-07-09; bare filename, not a path claim) |
| `PATCH /zones/:id/tag` (server-side jsonb merge) | Correct | `server/api/routes.js:296` | — |
| Every other cited path exists (`scripts/normalize-zone-flags.mjs`, `scripts/content/lint.mjs`, `client/devpanel/js/panels/zones.js`, `client/shared/tagCatalog.js`, `tools/zone-planner/{apply,lint}.mjs`) | Correct — all resolve | Glob sweep | — |
| Doc-trail links (7) resolve | Correct | link sweep | — |

**Concision** — 131 → 132 lines. The only cuts were the two dead Outstanding items, which the doc's own
header authorized trimming once the cutover shipped; the "what was built" and "decisions & discoveries"
sections are contract-dense (SSOT statements, precedence rules, the seam list) and were left untouched.
Net +1 is the corrected header. Glyphs (`⚔ ⛨ ⇒ × ▣ ◆ ↔ ☢`) verified intact.

**Note on the frozen numbers.** The `is_safe_zone` 218/358 (61%) discovery, the `733/733` and `743/743`
regress counts and the "112 street pairs" are left exactly as written — they are the measurements that
justify the decisions, and the header now says which world they were taken in.

---

### `docs/temp/qa-audit-2026-06.md`

The doc states its own status once, globally — "**No code was changed.**" — which was true of the audit
and still is. There is no per-item fix status to correct, so the real question is whether the premise
survives. It largely does not: I spot-checked 17 of the 35 findings against current code and **12 are
resolved**. Retiring the doc is the user's call (Flag 1); nothing in the findings was rewritten.

**Correctness** — 17 findings re-checked. Still-live first.

| # | Finding | Verdict | Evidence |
|---|---|---|---|
| 1 | Admin token is unsigned base64, role self-asserted | **STILL LIVE — byte-identical code** | `server/api/routes.js:83` (`makeToken`), `:122-130` (`verifyToken` decodes and returns the embedded role), `:131-137` (`requireDev`/`requireAdmin` trust it) |
| 2 | XSS: `innerHTML` on server-built HTML carrying player text | **STILL LIVE in shape** — `appendHtml` still assigns `innerHTML`; `say` still interpolates the raw handle. `escapeHtml` now has two callers, neither on this path | `client/game/js/render.js:27-31`; `server/engine/commands/social.js:77`; `client/shared/dom.js` used only by `panels/minimap.js`, `panels/mediadeck.js` |
| 10 | Money+item mutations non-atomic | **STILL LIVE** — `getClient()` still has one non-seed caller | `server/models/db.js:94`; only `server/api/routes.js:1507` |
| 23 | Legacy `player_skills.rank` column | **Partly live** — column still declared, but its only reader (#6) is gone, so it is now purely vestigial | `server/models/schema.js:49` (`rank`), `:641` (`trained`) |
| 3 | `handlePlayerDeath` re-entrancy | **Fixed** — `player._dying` guard, with a comment naming this exact failure | `server/engine/gameLoop.js:493-498` |
| 4 | Armour soak only recomputed at login | **Fixed** — `recomputeEquipped` fetches once and feeds soak + insulation "at every equip/unequip/undress/login" | `server/engine/commands/inventory.js:124-131` |
| 5 | Client drops `output`/`rent`/`lock`/`upgrade`/`pick_*` | **Fixed** for every enumerated type. The structural gap survives: still no default branch | `client/game/js/dispatch.js:277-283,593`; `:1035-1044` |
| 6 | `recipes` reads dead `rank` | **Obsolete** — now selects `skill_id, ip` | `plugins/crafting/index.js:5` |
| 7 | `visibly_mutated`/`origin_fragment` absent from `livePlayer` | **Fixed** — both copied in | `server/index.js:742,744` |
| 8 | Firearms/explosives never trained (skill remap) | **Fixed** — the weapon's own `weapon_skill` is used; families are now `blades`/`clubs`/`firearms`/`science` | `server/engine/combat.js:379,646,710`; `client/shared/tagSupertags.js:31-43` |
| 9 | Apartment locks don't gate entry | **Fixed** — a registered `engine:door-lock` move gate with credential auth | `server/engine/commands/movement.js:48-70` |
| 16 | Status-effect framework inert (`applyEffect` had zero callers) | **Fixed** — wired across engine and plugins | `server/engine/gameLoop.js:1060`; `plugins/bodily/index.js:759,823`; `plugins/swimming/index.js:197`; `plugins/weightbench/index.js:161` |
| 17 | Corpse system disconnected (`createCorpse` zero callers) | **Fixed** | `server/engine/gameLoop.js:447`; `plugins/weapon/index.js:55`; `server/engine/world.js:1105` |
| 18 | Drug decay never runs | **Fixed** — `tickDrugDecayAll` runs on the minute tick | `server/engine/gameLoop.js:406`; `server/engine/drugs.js:854` |
| 19 | `factions` command missing | **Superseded** — factions were reworked into ideologies, which has the command and a client handler | `client/game/js/dispatch.js:393`; `docs/systems-ideologies.md` |
| 24 | `minuteTick` counter never read | **Obsolete** — now drives a 10-minute sub-cadence | `server/engine/gameLoop.js:371,381` |
| 32 | `examine` branches on legacy `is_light` | **Fixed in that file** — `commands/world.js` reads `light_type` only. `is_light` survives as a writer in `plugins/dev-tools/index.js:116` and a dev-panel badge | `server/engine/commands/world.js:480,977`; `client/devpanel/js/panels/furniture.js:2` |
| — | Link `[combat-and-stats-plan.md](combat-and-stats-plan.md)` (#35) | **Ghost** — the doc does not exist anywhere in the repo | Glob `**/combat-and-stats-plan.md` → no match |
| — | Scope section cites `server/models/migrate.js` / `seed.js` as un-audited surfaces | **Ghost** — both files are gone; `schema.js` is the schema SSOT and there is no checked-in seed | Glob `server/models/{migrate,seed}.js` → no files. Left frozen: the same paths are the cited evidence for findings 6/22/23, and rewriting them would rewrite the findings |

**Concision** — 320 → 320 lines (one ghost link removed inline), then **deleted** (Flag 1). No concision
cuts were ever appropriate: every category the knife would reach for (the narrative of what was found,
the per-item stories) *was* the document. The verdict table above is now the only record of its three
still-live findings.

---

### Flagged — dispositions recorded 2026-07-24

1. **`temp/qa-audit-2026-06.md` — RETIRED (deleted).** 12 of the 17 findings I re-checked were resolved;
   as it stood it read as 320 lines of confidently-cited live defects, ~70% of which would have sent an
   agent to "fix" working code (#3's guard, #4's recompute, #17's corpses). The three still-live findings
   are preserved in the table above with fresh `file:line` citations, which is now their only record.
   `docs/temp/` is empty.
2. **The forgeable admin token (#1) stays open — LEAVE, by decision.** Not fixed, not re-filed. Anyone can
   mint `base64("x:admin:" + Date.now())` and get full content-write, smite, teleport and role-assignment
   access (`server/api/routes.js:83,122-137`). Recorded here because the deleted doc was its only home.
3. **#2 (XSS) and #10 (non-atomic money+item) stay open — LEAVE, by decision.** Verified live at the
   citations in the table above.
4. **`zone-cutover-runbook.md` — DELETED.** Its self-delete condition was met and verified. The one fact
   worth keeping travelled into `zone-redesign-2026-07.md`: the five stale one-shot seeds are now listed
   inline in its Outstanding §3 rather than by reference to a file that no longer exists.
5. **Step 1 of the runbook did run against prod** (user confirmation, 2026-07-24 — not repo-verifiable;
   no one-shot run is recorded in git). So the legacy `radiation_level`/`danger_rating` values were
   converted before the push dropped the columns, not discarded. Moot in effect — those zones were
   deleted the next day — but the ×10 radiation rescale did land on prod content rather than being lost.
6. **Sanctuary curation — expanded below, and it is worse than a curation gap.** See the next section.
7. **Both index defects — FIXED.** (a) The dead QA-audit link is gone from
   `docs/reference/plugin-architecture-analysis.md:7`. (b) `findings-2026-07-docs.md` is now listed in
   `docs/audits/README.md` under Findings logs. None of the batch-2 docs belonged in CLAUDE.md's
   key-docs list, so no correction was owed there. *Adjacent defect left alone, per Surgical Changes:*
   the same "See also" line in `plugin-architecture-analysis.md` links `combat.md`,
   `systems-survival.md`, `systems-economy.md` and `systems-world.md` as siblings, but that doc lives in
   `docs/reference/` and those four live in `docs/` — four more broken links, pre-existing and unrelated
   to this batch. One-line fix (`../`) whenever you want it.

---

### Flag 6 expanded — the sanctuary gap

Asked to expand this, and it turned out not to be a documentation item at all. **The curation pass that
Decision 1 promised was never performed, and the consequence lands on the respawn point.**

What is actually tagged, verified against content:

| | Count | Where |
|---|---|---|
| `sanctuary` zones | **10** | All interiors on two interior maps: `map_int_longwatch` (`zone_lw_entry` "The Threshold", commons, bunkroom, ops, quartermaster) and `map_int_solenne` (lobby, elevator, residences, gym, sky deck) |
| `sanctuary` tiles on `map_world` | **0** of 5,439 | — |
| `allow_sleep` zones | **2** | `zone_lw_bunk`, `zone_mq_precinct_holding` |
| `is_apartment` zones | 116 | the practical sleep surface (see below) |

**The sharp end: `zone_start` — the Coldwater Clone Facility, where every character is born and where
every death respawns them — carries neither tag.** Its flags are `building_name`, `building_type`,
`intro_lore`, `is_building`, `is_interior`, `scavenging_table_id`, `world_exit_zone` — no `sanctuary`
(`content/zones/zone_start.json`; respawn re-enters it per `plugins/accolades/catalog.js:29,37`, and it is
the `players.current_zone`/`anchor_zone` default at `server/models/schema.js:37-38`).

Because `sanctuary` is the *only* thing that publishes zone protection through the substrate
(`server/engine/world.js:57` → `engine:sanctuary`) and the *only* thing that suppresses hostile spawns
(`world.js:450` at template load, `world.js:1093` per tick), an untagged `zone_start` means the respawn
point is a legal PvP kill box that enemies may spawn into. A player killed there respawns there. That is
a one-tag fix and it should precede any broader pass.

The full list of what the tag gates, so a curation pass knows what it is granting — one bundle, six
consumers:

| Consumer | Site |
|---|---|
| Combat protection (the substrate provider) | `server/engine/world.js:57` |
| Safe-rate sleep | `server/engine/apartments.js:704` |
| Hostile-spawn suppression | `server/engine/world.js:450`, `:1093` |
| AI safe-flee target | `server/engine/ai-behaviour.js:1176` |
| Danger floored to `safe` | `server/engine/danger.js:64` |
| `⛨ SANCTUARY` chip + `◆` minimap marker | `server/engine/commands/describe.js:514`; `world.js:908,945` |

**Sleep is less starved than the 10 suggests**, which is why this went unnoticed: `getSleepEligibility`
(`server/engine/apartments.js:683-721`) grants safe-zone-rate rest in *any unowned apartment unit* — an
unrented unit is always unlocked, so its lock never bars sleep — and there are 116 apartment zones. The
newer `allow_sleep` tag (`server/engine/zone-tags.js:29`, added for the Precinct 9 holding cell) grants
rest *without* the protection bundle. So the sleep half of the promise quietly healed itself through
housing; the **protection** half did not, and no one noticed because sleeping worked.

Recorded in `zone-redesign-2026-07.md` Outstanding §1. Two open questions for you: **is an unprotected
spawn point intentional** (a "the basin owes you nothing" reading, which the zone's own intro lore
supports), and **should the 116 unowned-apartment sleep surface stay** — it is a real carve-out that
Decision 1's "sleep requires an owned apartment or a curated sanctuary" framing does not mention.

### Batch summary

The most dangerous stale claim in this batch was `zone-cutover-runbook.md`'s "**Prod still has the old
columns and old data … prod behaves identically until you push**." That sentence sat above a copy-paste
command block for a destructive prod migration whose step-ordering warning ("run step 1 before pushing,
or the DROPs discard the legacy data") had already been resolved by a push 14 days earlier. An operator
trusting it would have run a migration against a schema whose columns are gone, chasing data that no
longer exists in a world that no longer exists — and the doc's own review lists would have sent them
looking for `zone_deep_gasp` and the Redline. Frozen-record docs turn out to rot in a specific way: not
in the findings, which age honestly, but in the **status stamp and the imperative sections** — the
header that says "pending" and the numbered steps that say "do this now."

That suggests one change to the remaining order. The audit's own C1 grouping treats "retirement
candidates" as a low-stakes cleanup batch, and for the two zone docs it nearly was — their contracts all
still hold (`zone-tags.js`, `danger.js`, the facade seam, the minimap window), which is a real result
worth stating plainly. But `qa-audit-2026-06.md` is the opposite case: **nothing in it is verifiable
without re-checking 35 findings against live code**, and that check is what surfaced a still-live
Critical security hole. Any remaining doc that asserts defects or unbuilt status in bulk deserves the
same treatment, so I'd promote `docs/audits/findings-2026-07.md` and `findings-2026-07-content-shape.md`
ahead of the narrative `systems-*.md` docs — same shape, same rot risk, and the same chance of finding
something still live.

**Outcome:** both retirement candidates deleted, `zone-redesign-2026-07.md` kept and corrected, two index
links fixed. The batch's most valuable output was not a doc edit — it was Flag 6, where checking a
one-line "curation still owed" note against content found an **unprotected respawn point**. Verifying a
frozen doc's leftovers is how you find the thing nobody is looking at.

---

## Batch 3 — `bsm-format.md`, `systems-broadcast.md`

Both classify as **as-built**: `bsm-format.md` is the spec for `compileBsm()` and the broadcast
runner's line-library assemblers; `systems-broadcast.md` is the runtime/schema/client doc. Every claim
is checkable.

---

### `docs/bsm-format.md`

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| Weather token doc: unknown tokens "recorded in `_debug.unknownTokens`" | **Ghost field** — no such key. `_debug` is `{unknownDirectives, nodeTypes, unresolvedSpeakers}`; the runner `console.warn`s instead | `client/devpanel/js/bsm-compiler.js:9`; `plugins/broadcast/index.js:799` | Fixed — replaced with the actual warn |
| §7 Ad-libs: `adlib` / `adlib.grim` / `adlib.chipper` are weather pool keys | **Dead contract** — `assembleWeatherGraph` never reads any `adlib*` key; the section's own footer admitted it ("reserves them for future… does not yet inject them") | `plugins/broadcast/index.js:775-796` (full beat list, no adlib) | Fixed — §7 deleted, the aspirational footer deleted, and the `adlib.grim` block dropped from the worked example so nobody copies a dead pool |
| `SPEAKER:` resolves via `::actors` aliases, else `npc_<label>` | **Drifted** — an implicit-alias step sits between: a label matching a declared `@actor`'s humanized id / first word / last word resolves to that actor (only when unambiguous). Without it an author writes needless `@alias` lines or expects a duplicate placeholder NPC | `client/devpanel/js/bsm-compiler.js:38-52,364` | Fixed — documented in `::actors` and the SPEAKER row |
| `::teams` — "the runner picks **two** at random per airing" | **Drifted** — it is a deterministic league round-robin keyed to the global game slot (daily team order, rolling window, per-slot home/away flip, BYE skip) | `plugins/broadcast/index.js:1064-1100` | Fixed — pool description + the "Repeatable" table row + the section intro |
| `getSportsGraph(item, cycle)`, "re-rolls when the loop cycle advances" | **Drifted** — `getSportsGraph(script, slot, override)`, keyed to `sportsSlotIndex()` | `plugins/broadcast/index.js:1698`, called at `:2446-2449` | Fixed |
| `::asset` produces `{ id, name, type: 'ascii', content }` | **Drifted** — `type` is `'svg'` when content starts with `<svg`, else `'ascii'` | `client/devpanel/js/bsm-compiler.js:176` | Fixed |
| `CAM <n>` label is `"CAM n — rest"` | **Drifted** — the em-dash join runs between all three parts: `"CAM — n — rest"` | `client/devpanel/js/bsm-compiler.js:283` | Fixed |
| `isDirectiveLine` prefix list | **Incomplete** — `LOWER_THIRD` missing; speaker pattern given as `^[A-Za-z][A-Za-z0-9_]*:\s*$`, actual allows Title-Case continuation words | `client/devpanel/js/bsm-compiler.js:91,100-104` | Fixed — both |
| `@type` known values omit `morning` | **Stale status** — `morning` ships and has its own section in this file | `client/devpanel/js/bsm-compiler.js:513`; doc §Morning Shows | Fixed — value + anchor added |
| `weatherScript: { pools, host }` | **Incomplete** — also carries `title` (from `@titlecard`); same for the stored `weather_pools` shape | `client/devpanel/js/bsm-compiler.js:475` | Fixed (both places) |
| `sportsScript: { sport, announcer, teams, players, pools }` | **Incomplete** — also `title` and `airSlots` (the `@airtime` contract the same section documents) | `client/devpanel/js/bsm-compiler.js:481` | Fixed |
| `newsScript: { anchors, reporters, announcer, pools, title }` | **Incomplete** — also `theme`; `@theme` was undocumented for news despite the assembler folding it onto the title card | `client/devpanel/js/bsm-compiler.js:488`; `plugins/broadcast/index.js:1790` | Fixed — field added + a `@theme` row in the news header table |
| Weather assembly: forecast days get `temp.<band>` "(optional)" | **Drifted** — temperature is voiced for today only; the day loop emits `ahead` → `sky` → `warn` and nothing else | `plugins/broadcast/index.js:786-791` | Fixed |
| Wind/humidity voiced "when worth a mention (e.g. wind ≥ `windy`)" | **Drifted** — `calm` is also voiced; `breezy` is the only silent band | `plugins/broadcast/index.js:781` | Fixed |
| Missing `sky.<type>` falls back to "Conditions: {weather}, {temp}." | **Drifted** — two distinct fallbacks, today vs forecast day, both worded differently | `plugins/broadcast/index.js:778,788` | Fixed — exact strings |
| Compiler returns one `*Script` "plus" field per type | **Misleading** — all five envelopes are always returned; the importer picks by `meta.type` | `client/devpanel/js/bsm-compiler.js:517` | Fixed — one line under Output Shape |
| `interview.<tag>` is the persona signature pool | Correct (the *compiler's* comment saying `interview.a.<tag>` is the stale one — code, not doc) | `plugins/broadcast/index.js:1965` | — |
| `::guests` line format `Name \| Title \| theme_song \| tag`, matched-quote strip | Correct | `client/devpanel/js/bsm-compiler.js:229` | — |
| `@airtime` → `Math.floor(h/3) % 8` in-game 3 h block; league runs 8 games/in-game-day | Correct | `client/devpanel/js/bsm-compiler.js:155`; `plugins/broadcast/index.js:1012,1015` | — |
| Node layout: `bsm_<n>`, 5-col grid `x=80+col*220`, `y=80+row*160`, `bsm_0` is `start` | Correct | `client/devpanel/js/bsm-compiler.js:70-85` | — |
| talkshow / morning script shapes; both add their cast to `npcIds` | Correct | `client/devpanel/js/bsm-compiler.js:495-515` | — |
| `sportsSimGame` deals 9 + a pitcher per side, `SPORTS_DEFAULT_NAMES` backs a thin pool | Correct | `plugins/broadcast/index.js:1117-1125` | — |
| Score-bug payload is sport-agnostic; client draws diamond/outs only when present | Correct | `client/game/js/panels/tv.js:517` (`_applyScorebug`) | — |
| Import entry points `bcImportBsm` / `_bcCommImportBsm`; zone remap via `_bcZoneRemap` | Correct | `client/devpanel/js/panels/broadcast.js:901,2086,1465` | — |

**Concision** — 916 → 918 lines. Cut classes applied: **aspiration inside an as-built doc** (the ad-lib
section and its "future runner enhancement" footer). Nothing else qualified: this file is a field-table
spec, and every remaining paragraph is a contract, a fallback rule, or a copy-paste-usable script. Net
growth is entirely the eleven correctness additions. Glyphs (`♪ ⚠ ·`) and all worked examples preserved
verbatim.

---

### `docs/systems-broadcast.md`

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| `startBroadcastTick()` — `setInterval(broadcastTick, 5000)`; "`broadcastTick()` — Every 5 seconds" | **Stale by 5×**, and self-contradicted by the doc's own Operational Notes ("Tick cadence: 1 second") | `plugins/broadcast/index.js:3969` (`BROADCAST_TICK_MS = 1000`), `:7123` | Fixed — both places now name the constant |
| `getCurrentMessage(channelId, nowMs)` | **Drifted** — takes the runtime `state` object, and the tick reaches it through `_resolveTickMessage`, which gives a pirated/loaded deck first refusal | `plugins/broadcast/index.js:2403,2883-2886` | Fixed |
| dispatch.js `broadcast` handler routes to one global panel (`isTvOpen() && getTvActiveChannelId()`) | **Drifted** — the pasted block was the pre-fan-out version, and the prose 30 lines below already said it fans out via `tvViewsForChannel`. The block also dropped `speak`, `duration`, `hasGameday`, `programName` | `client/game/js/dispatch.js:245-258` | Fixed — block replaced with the current handler |
| `#tv-tuner-slider`: range input 0…(highest channel + 2), dragging calls `tvTunerInput(val)` | **Ghost element** — no slider exists; tuning is `[data-tv="tune-down"]`/`"tune-up"` around the knob. The CRT *sweeps* the dial through static, the tablet snaps — a deliberate difference the doc didn't record | `client/game/index.html:1552-1562`; `client/game/js/panels/tv.js:918-936,973` | Fixed — section rewritten; the panel diagram's `[slider]` replaced |
| Furniture **Tag** Contract — `broadcast_receiver` / `broadcast_device_type` listed as tags | **Namespace/ownership drift** — both are furniture **flags**; only `tv` is a tag (the `use` `requiredTag`). The split is a live trap: `use/tv` gates on the tag, `doUseTv` then queries the flag | `plugins/broadcast/index.js:594,603,5907`; `docs/flags-keys.md:129` | Fixed — table relabelled per-key, `tuned_channel`/`media_deck` added, the tag-vs-flag gap called out |
| "Device type is read from the `broadcast_device_type` tag on the furniture item" | Same drift | `plugins/broadcast/index.js:603` | Fixed |
| `playback_mode` note: "the runtime branches only on scripted/weather/sports" | **Stale status** — `getCurrentMessage` also branches on `news`, `talkshow`, `morning`, all shipped; and it pointed at a section since renamed to "Live-Assembled Shows" | `plugins/broadcast/index.js:2434-2486` | Fixed |
| `media_cameras.permissions JSONB` | **Drifted** — `TEXT DEFAULT 'public'` | `server/models/schema.js:1112` | Fixed |
| `schedule_mode TEXT — 'loop' \| …` | **Incomplete** — `'daily'` is the other value and it changes what `start_time` means (seconds from in-game midnight) | `server/models/schema.js:1143`; `plugins/broadcast/index.js:2425-2428` | Fixed |
| Title-card/theme sync applies "when a `news`/`talkshow` script declares both `@title` and `@theme`" | **Ghost directive** — the header is `@titlecard`; `morning` does it too | `client/devpanel/js/bsm-compiler.js:156`; `plugins/broadcast/index.js:1790` | Fixed |
| Player Commands table is the plugin's verb list | **Incomplete** — omits `pirate`, `pirateresolve`, `air`, `airemergency`, `endemergency`, all owned by this plugin | `plugins/broadcast/plugin.json:5`; `plugins/broadcast/index.js:5888-5902` | Fixed — one line + link to `plugins.md`, which owns that index, rather than duplicating it |
| `appendTvMessage(text, style, duration)` | **Drifted** — fourth arg `hasGameday` | `client/game/js/panels/tv.js:1061,1451` | Fixed |
| `loadChannelRuntimes()` state object (JS block + a "this has drifted" blockquote) | **Self-declared stale** | `plugins/broadcast/index.js:413` | Fixed — restated-code block replaced by the field list + a `file:line` pointer |
| Seven `media_*` tables, `media_deck_units` included | Correct | `server/models/schema.js:1042,1064,1079,1089,1102,1124,1200` | — |
| `weather_pools` / `sports_pools` / `news_pools` / `talkshow_pools` / `morning_pools` JSONB columns | Correct | `server/models/schema.js:1149-1157` | — |
| Walker node-type table (21 types incl. `show_overlay`/`clear_overlay`/`break`/`inject_news`) | Correct — every documented type has a `case` | `plugins/broadcast/index.js:4226-4510` | — |
| 50-hop cycle guard | Correct | `plugins/broadcast/index.js:4221` | — |
| Show-delay card state machine, `_absentCastNames`, recovery on empty | Correct | `plugins/broadcast/index.js:2927` | — |
| `broadcast-bridge.js` — viewer checker + three more registered pairs | Correct | `server/engine/broadcast-bridge.js` (whole file) | — |
| `AMBIENT_LINE_EVERY_MS = 30000` ambient throttle, speech-only leak | Correct | `plugins/broadcast/index.js:1658,3100` | — |
| `_deckCache` 10 s TTL invalidated on load/eject; `CASSETTE_NAME_COLLISION` → 409 | Correct | `plugins/broadcast/index.js:2662,2651,5281` | — |
| `tabletTuners` separate from `tvWatchers`; tablet pass reuses `tickResults` | Correct | `plugins/broadcast/index.js:3241` (`_tabletBroadcastPass`) | — |
| CRT shutoff keyframes (0/10/28/100 %, 0.55 s) and 1.1 s knob spin | Correct, exactly as written | `client/game/styles.css:8798-8819` | — |
| `LOCK_RANGE = 0.25`, `MAX_TV_HISTORY = 200`, the six `--tv-*` theme vars, five `data-theme` presets | Correct | `client/game/js/panels/tv.js:58-62,368-373`; `client/game/styles.css:7391-7422` | — |
| All 30 API routes in the table | Correct — every `resource`/`sub` in the table resolves | `plugins/broadcast/index.js:6003,6224,6231,6290,6415,6450,6681,7109` and the shared dispatcher arms | — |
| Dev panel: five sub-tabs, `_bcSuiteData`/`bcSuiteRefresh`, 3-step BSM import, Vector editor at 960 px | Correct | `client/devpanel/js/panels/broadcast.js:56,127,945,1469,1714`; `client/devpanel/js/panels/broadcast-graphics.js:91-93,193` | — |

**Concision** — 695 → 691 lines. Cut classes applied: **restated code that admitted its own drift** (the
`loadChannelRuntimes` JS block + its "this has drifted" blockquote → field list + `file:line`);
**narrative history** (the "`bsm-compiler.js` no longer discards the theme name… it used to fold into an
ambient `say` node" bullet); **triple-stated facts** (the Operational Notes re-statements of the SVG
`innerHTML`-is-safe rule and the off-air-fires-once rule, both already stated in their own sections —
kept the bodies, kept only the 640×360 figure). The Dev Panel walkthrough was left intact: it is the
only description of that editor and it verified clean.

**Flagged**

All four were raised for a decision and all four were approved; the resolutions are recorded here.

1. **Code bug — `TECH_DIFFICULTIES <n>` never parsed its argument.**
   `client/devpanel/js/bsm-compiler.js:245` did `parseFloat(ln.slice(19))`, but `'TECH_DIFFICULTIES '`
   is 18 characters, so the first digit was eaten: `TECH_DIFFICULTIES 30` → `"0"` → `0` → fell through
   to `|| 10`, and `TECH_DIFFICULTIES 2.5` → `".5"` → **0.5 s**, a card that flashes past. Every
   authored duration was either the default or silently wrong.
   **Resolved — `slice(19)` → `slice(18)`.** Verified by running the real `compileBsm` over
   `TECH_DIFFICULTIES 30 / 7 / 2.5 / x` → `[30, 7, 2.5, 10]` (non-numeric still defaults to 10).
2. **CLAUDE.md index drift.** `docs/bsm-format.md` was **absent** from the key-docs list entirely,
   despite being the authoring spec for five shipped broadcast formats and the file `bsm-compiler.js`
   cites by name in three comments; the `systems-broadcast.md` hook stopped at "dynamic news, VINE
   graph scripts, NPC hosts, camera feeds" and never mentioned the line-library shows.
   **Resolved — `bsm-format.md` added to the index, broadcast hook extended.**
3. **`docs/plugins.md:96` carried the same 5-second tick claim.**
   **Resolved — now "broadcast tick every 1 s (`BROADCAST_TICK_MS`)".**
4. **`data/scripts/doomcast.bsm:336-340` authored a `::lines adlib.grim` pool nothing reads.**
   **Resolved — stripped.** The file still compiles: `@type weather`, 47 pools, no `adlib*` key,
   zero `unknownDirectives`.

### Batch summary

The most dangerous stale claim was `bsm-format.md`'s **ad-lib pool section** — a fully specified pool
vocabulary (`adlib`, `adlib.grim`, `adlib.chipper`), with a worked example, for a key
`assembleWeatherGraph` has never once read. That is the expensive class the prompt names: an author
writes lines against it, the file imports clean, the pools land in `weather_pools`, and nothing ever
airs them — no error, no warning, just silence where the character was supposed to be. The doc even
contained its own refutation two sections later, which is how these survive: the disclaimer reads as a
roadmap note rather than as "this section is fiction." Runner-up is the `#tv-tuner-slider` ghost, where
the doc described a UI control that no longer exists *and* missed the deliberate CRT-sweeps /
tablet-snaps split that replaced it.

No change to the next batch's order. The pattern worth carrying forward is narrower than a reordering:
in **line-library docs the compiler and the runner are two separate sources of truth**, and they drift
apart independently — `compileBsm` happily emits `adlib` pools into the envelope, and the assembler
simply never looks. So for any doc describing an authored-content format, verify against the
*consumer*, not just the parser. Every one of this batch's four dead-or-drifted content contracts
(adlib, forecast-day `temp`, `calm` wind, the team round-robin) was invisible from the compiler side
and fell out only from reading the assembler.

---

## Batch 4 — `architecture.md`, `server.md`, `content-pipeline.md`, `flags-keys.md`

All four classify as **as-built**: every claim is checkable against the engine, the schema, the
content tree or the deploy workflow.

Two machine sweeps did most of the work and are worth reusing: (a) diffing `flags-keys.md`'s zone
table against `tagCatalog.js`'s `scope:'zone'` entries — the catalog is the *validated* SSOT, so any
delta is drift by definition; (b) enumerating `fireHook(`/`emitHook(` call sites across `server/` to
get the real hook set, which is what exposed two ghost hooks documented in both docs.

---

### `docs/architecture.md`

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| Hook table lists `player.enterZone` and `combat.hit` | **Ghost hooks — the batch's worst find.** Neither name is fired anywhere in the repo. A plugin subscribing to either loads clean, declares clean, and never runs | full `fireHook`/`emitHook` sweep over `server/` (26 hooks, neither present); zone entry is an **Event**, `emit('zone.entered', …)` at `commands/movement.js:441` | Fixed — architecture.md's hook table replaced by a pointer to server.md, which now carries the complete corrected table |
| `server/engine/lockAuthHandlers.js` — "Auth handlers wired by the doors plugin" | **Ghost file** — does not exist; lock types register from the plugins themselves via `registerLockType` | no such file; `plugins/doors/index.js:20,43,70,98`, `strippers/index.js:267`, `yacht/index.js:150` | Fixed — row deleted, `scheduler.js` (a real engine seam, previously unlisted) put in its place |
| "Ghost mode — no invisible/invulnerable admin walk-through mode" (under *Not built*) | **Stale status, self-contradicted** — the doc's own repo tree lists `commands/ghost.js` 130 lines earlier | `server/engine/commands/ghost.js`; WS types `auth_ghost`/`ghost_command`/`ghost_jump`/`ghost_refresh` at `server/index.js:318-321` | Fixed — removed from *Not built* |
| "Quest editor in the dev panel UI … no visual editor tab in `devpanel/index.html` yet" | **Stale status** — the tab is wired and the panel authors the `quests` table | `client/devpanel/index.html:84` (Quests nav item), `:412` (script tag); `client/devpanel/js/panels/quests.js` | Fixed — removed from *Not built* |
| `player_corpses` "expire after 10 minutes" | **Wrong by 6x** | `server/engine/gameLoop.js:421` (`Date.now() + 60 * 60 * 1000`) | Fixed |
| Environment: "**Five ticks** run independently of `gameLoop.js`'s own timers" | **Drifted twice** — there are three real cadences, all on the *shared* `scheduler.js`; the 30 m/24 h ticks are fired by the 1-minute driver on **game**-minute boundaries so they track the game-speed knob | `server/engine/environment.js:422-430` ("tick30m/tick24h are no longer registered on the real '30m'/'24h' cadences"), `:870-871` | Fixed |
| Open question: "`gameLoop.js` and `environment.js` run independent `setInterval` schedulers with nothing coordinating them — a unified scheduler is the prerequisite for…" | **Stale** — the unified scheduler exists, owns the idle gate, jitters cadence phase and spreads same-cadence subscribers | `server/engine/scheduler.js:52-90`; `gameLoop.js:49-58`, `environment.js:430,434,450` | Fixed — question removed |
| `environment.init` payload | **Incomplete** — omits `registerWeatherEventStep`, `registerWeatherEventTrigger`, `registerWeatherRegionRefresh` | `server/engine/environment.js:361` | Fixed (in server.md's table) |
| Dev panel "Accessible only to accounts with `role: dev`/`admin`" | **Drifted** — `builder` and `designer` too | `server/api/routes.js:132` | Fixed |
| Player client / dev panel are "single file" | **Drifted** — both are `index.html` + `styles.css` + a `js/` module tree (12 + `panels/`, and 8 + `panels/`) | `client/game/js/`, `client/devpanel/js/`; `docs/devpanel-js.md` documents the split | Fixed |
| Lesson: "`db.js` imports `'dotenv/config'` at the very top" | **Drifted mechanism** — it imports `dotenv` and walks up from cwd to the nearest `.env`, because a git worktree never receives the git-ignored `.env` | `server/models/db.js:1,12-23` | Fixed — lesson kept, mechanism corrected |
| "~80 plugins" (x2), "~80 tables" | **Drifted counts** — 97 and 113 | 97 dirs under `plugins/`; 113 `CREATE TABLE IF NOT EXISTS` in `server/models/schema.js` | Fixed |
| Dev-panel module list is the tab inventory | **Incomplete** — ~35 panel modules exist vs. 8 listed; `devpanel-js.md` owns this | `client/devpanel/js/panels/` (35 files) | Fixed — one line saying the list is structural, pointing at the owner doc |
| Persistence tiers: `_posDirty`/`flushDirtyPositions`, `_resDirty`/`flushDirtyResources`, invariants 1–6 | Correct | `commands/movement.js:574-576,618`; `combat.js:567-591` | — |
| Read tiers: items-cache write-through, furniture/npcs funnels, `readTier` regress-enforced | Correct | `items-cache.js:31,34`; `world.js:594,605,616,628,633` (furniture), `:422,430` (npcs); 54 `readTier` entries in `content-registry.js` | — |
| Generator types are `city_plant`/`junction_box`/`player`; "there is **no** `building` type" | Correct for the sim (the schema's vestigial `DEFAULT 'building'` is never branched on) | `environment.js:1247,1265,1368,2442-2467` | — |
| `apiBuildApartmentBlock` still exists server-side but is unsurfaced | Correct | `server/api/routes.js:359,2866` | — |
| Core schema table/column list, TEXT-UUID PKs, boolean→INTEGER, Neon branch prune, deferrable FKs | Correct | `server/models/schema.js:22-46,410-419,457-466,745-830` | — |

**Concision** — 565 → 545 lines. Cut classes: **narrative history** (the SQLite-vs-Postgres origin
story; the "content used to live in `seed.js`, then a `.sql` export" parenthetical; the dev panel
"previously had no settings screen"; the furniture-funnel "the earlier design had each caller
hand-write a JS mirror…" paragraph, collapsed to the one-sentence rule that still binds);
**aspiration in an as-built doc** (darkness "flagged as a possible future extension" — the Open
Question already carries it); **redundant scaffolding** ("it's worth calling out explicitly here
since nothing previously documented this"); **duplicate source of truth** (the hook table → a
pointer; the dated 2026-07 lag-audit attributions x2). Every tier table, invariant list, SQL block
and cache-safety rule preserved verbatim; `file:line` citations added where prose named a symbol.

---

### `docs/server.md`

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| Tick table row: "`cleanCorpses` \| 30 seconds \| Expires lootable player corpse objects from memory (**they never hit the DB**)" | **Wrong three ways** — no such function exists anywhere in the repo; corpses *are* persisted; and they are reloaded at boot | no match for `cleanCorpses` in `server/` or `plugins/`; `gameLoop.js:431` (`INSERT INTO player_corpses`, comment "Persist corpse so it survives server restart"); `world.js:294` reloads them | Fixed — row deleted, persistence stated correctly |
| Tick table is the game loop | **Incomplete** — five registered ticks absent (`stormTick` 5 s, `restRegenTick` 15 s, `npcBanterTick` 30 s, `npcWanderTick` 1 m, `flushDirtyPositions` 1 m), as is the `environment.dayRollover`-driven pair | `gameLoop.js:48-64` | Fixed — table completed, plus the raw-`setInterval`-needs-its-own-idle-gate note |
| Environment ticks are "not coordinated with `gameLoop.js`, they share the same DB pool and fire independently" | **Drifted** — same scheduler, same idle gate; 30 m/24 h are game-clock-driven | `environment.js:422-430,841-871`; `scheduler.js:52-90` | Fixed |
| Hook table lists `player.enterZone` and `combat.hit` | **Ghost hooks** (see architecture.md above) | full hook sweep | Fixed — removed, with an explicit note that a name absent from the table is not a hook |
| Hook table covers the engine's hooks | **Incomplete** — 13 rows for 26 hooks. Missing: `player.respawnZone`, `zone.introLore`, `zone.furniturePanel`, `visibility.perceive`, `movement.edge`, `movement.arriveMessage`, `npc.talk`, `speech.transform`, `player.say`, `player.appearanceNotes`, `player.appearanceMisNotes`, `furniture.describe`, `forcefield.gate`, `drug.used`, `drug.overdose`, `player.create`, `player.login`, `environment.recalculateForecast`, `environment.scheduleForecastDay`, `environment.weatherFieldSync` | firing sites enumerated across `server/` — every row now carries its `file:line` | Fixed — table completed; server.md is now the hook SSOT |
| Hook "Fired by" column says `commands.js` (x3) | **Ghost path** — there is no `server/engine/commands.js`; it is `commands/index.js` + per-domain files | `server/engine/commands/` | Fixed — each row names its actual firing file:line |
| `handleCommand()` "in `commands.js`", "before the built-in **switch statement**" | Same ghost path; and the builtin layer is a dispatch pipeline, not a switch | `commands/index.js`; see `commands.md` | Fixed |
| `broadcast(zoneId, message, excludePlayerId, targetPlayerId)` | **Drifted** — six params (`excludePlayerId2`, `excludeSet`) | `server/index.js:99-106` | Fixed |
| WS message table (5 types) | **Incomplete** — ~25 types; four families absent (shop, ghost, panel, TV/deck) | `server/index.js:308-380` | Fixed — one line naming the families rather than 20 rows |
| `world` object literal (7 Maps) | **Drifted** — 16 entries now, including the `furniture`/`npcs`/`doors`/`orgs`/`maps`/`regions` caches whose write funnels are mandatory | `server/engine/world.js` (`const world = {…}`) | Fixed — block updated, with a pointer to the read-tier funnel rule |
| Boot sequence steps 1–8 | Correct as far as it goes, **incomplete** — omits `loadItems()` (the items-cache tier), `reloadCrimes`/`reloadAliases`/`loadBanterLibrary`, and the two boot reconciles | `server/index.js:1268-1345` | Fixed |
| "Three extension points" | **Incomplete** — the loader wires four (input matchers) plus `specializedActions` | `server/engine/plugins.js:5-13,99-105` | Fixed |
| `fireHook` last-non-undefined-return-wins; `fireCommand`/`fireRoutes` run ahead of builtins | Correct | `plugins.js:175,199,235` | — |
| Enemy instance HP never persisted | Correct — only the template row is dev-panel editable | `server/api/routes.js:1796` is the only `UPDATE enemies` | — |
| Dev panel is REST-only, `dev`/`admin`/`builder`/`designer` | Correct | `server/api/routes.js:132` | — |
| Keepalive pings `/health` every 10 min, never touches the DB | Correct | `server/keepalive.js:29,32,44` | — |

**Concision** — 189 → 223 lines. Cut classes: **triple-stated facts** (the closing "Boot Sequence
Summary" ASCII block restated the numbered list at the top — deleted, keeping the one sentence that
wasn't a restatement). Everything else is net growth from the correctness work, almost all of it the
completed hook table. This doc was the batch's least accurate and is now its densest.

---

### `docs/content-pipeline.md`

The batch's cleanest doc: the pipeline contract, the deletion model, the FK/deferrable rules and the
egress/debounce reasoning all verified correct against the scripts and the workflow. Only gaps.

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| Command list (`export`/`import`/`lint`/`status`/`dangling`) is the pipeline surface | **Incomplete** — `content:seed-runtime` is missing, and it is load-bearing on a fresh DB: `excludeColumns` keeps runtime state out of files, so `npcs.vendor_stock` starts `'[]'` and **every shop is empty** until the first in-game daily tick | `package.json:28`; `scripts/content/seed-runtime.mjs:1-26` (auto-invoked for local targets, manual on prod) | Fixed — entry added |
| "The pre-push hook lints content and skips local regress for content-only pushes" | **Incomplete** — omits the content-**deletion** guard, the one destructive content op, which blocks a push deleting files your DB never imported | `scripts/git-hooks/pre-push:50-62`; `scripts/content/guard-deletions.mjs` | Fixed |
| "The post-merge hook imports pulled content" | **Incomplete** — GUI git clients skip hooks, so `check-stale.mjs` re-runs the guarded import from `predev`/`pretest:regress` | `package.json:7,11`; `scripts/content/check-stale.mjs:13-15,72-74` | Fixed |
| "`render.yaml`'s `buildFilter` **mirrors** this on the Render side" | **Drifted / misleading** — it is the *complement*: `ignoredPaths` excludes `content/**`, so a content push never triggers a Render build. Content reaches the live server because the workflow's deploy hook **bypasses** `buildFilter` | `render.yaml:15-21` and its own comment | Fixed |
| `systems-world.md#the-district-a-generated-slice-of-map_world` | **Broken anchor** — the heading's em dash renders as a double hyphen (`…district--a-generated…`) | `docs/systems-world.md:284` | Fixed by deletion (the dated paragraph carrying it was a changelog cut) |
| Deploy debounce: 2-hourly `schedule`, `[deploy]` commit token, `workflow_dispatch`, skip when HEAD is already live | Correct, exactly as written | `.github/workflows/deploy-content.yml:46-48,100-138` | — |
| Prune all but newest 5 `predeploy-*` branches before snapshotting; `continue-on-error` | Correct | `deploy-content.yml:157-163` | — |
| Drift comparison runs inside Postgres via a temp table so only mismatch keys leave Neon | Correct | `scripts/content/import.mjs:78,106-109` | — |
| Import marker `content_pipeline.last_imported_sha` in `server_settings`; deletion pass is git-diff-driven and logs every deletion; missing marker skips loudly | Correct | `scripts/content/import.mjs:14`; `check-stale.mjs:3`; `guard-deletions.mjs:12` | — |
| `furniture.origin` CHECK-constrained mixed table; `furn_<8-hex>` export skip + delete refusal as defence-in-depth | Correct | `server/models/schema.js:287-290`; `scripts/content/lib.mjs:188-215`; `scripts/backfill-furniture-origin.mjs` | — |
| `CONTENT_READONLY` gates ahead of all HTTP dispatch incl. plugin routes; gameplay (WS) unaffected | Correct | `server/api/routes.js:140-141,185`; `render.yaml` env block | — |
| `zone_exit_overrides` merged over authored exits at world load | Correct | `server/engine/world.js:321-338` | — |
| Deploy-lessons block (deferrable FKs, `CREATE TABLE IF NOT EXISTS` can't fix drift, the SCHEMA_SQL-comment tripwire, git-wins reconcile, `40P01` retry) | Correct and still binding | `schema.js` FK-swap block; `deploy-content.yml` | — |

**Concision** — 277 → 284 lines. Cut classes: **per-instance changelog** (the "As of 2026-07-11 …
888-zone district … airfield relocation" paragraph in the status blockquote — that is git's job, and
it carried the broken anchor). Net growth is the three gap fixes. The Deploy-lessons section was
left intact deliberately: each entry is a live trap for the next person adding a content table with
children, not a bug story.

---

### `docs/flags-keys.md`

**Correctness** — a registry doc, so completeness *is* correctness. It stated its own contract
("When you add a new flag key, add a row here") and was materially behind on all three tables.

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| The `zones.flags` table is the zone-key registry | **32 keys behind the catalog it says is authoritative** — including `entrance`, the *authored* facade↔interior door SSOT that exists precisely so terrain painting can't relocate a door; plus `icon`, `region_id`, `rent_cost`, `floors`, `underwater`, `water_temp_c`, `vessel`, `heading`, and the aircraft-cabin, Echelon and Ascendant clusters | diff of `tagCatalog.js` `scope:'zone'` (104 keys) against the doc; readers verified individually — e.g. `world.js:176` (`buildingEntranceDir`), `world.js:252` + `flight/snapshot.js:18,32,34` (`icon`), `apartments.js` (`rent_cost`), `flight/state.js:171` | Fixed — all 32 added; re-run of the diff now reports 0 missing |
| `requires_demolition` (furniture) — "only `demolition`-tagged items damage it" | **Dead contract, and the dangerous kind** — nothing reads the flag. Demolition gating comes from a hardcoded type table, so setting the flag gates *nothing* and the author believes the unit is protected | `commands/infrastructure.js:23-25` (`DEVICE_SPECS`), `:56` (`spec.requiresDemolition`); the key's only appearance elsewhere is a one-shot writer, `server/models/temp/setup-destructible-power.js:112` | Fixed — marked no-reader, real mechanism cited |
| `essential` (npcs) — "cannot be killed" | **Ghost key** — no reader; unkillability is `no_attack` alone. An NPC flagged `essential` is killable | `combat.js:704-706` is the only unkillability seam; no `flags.essential` read anywhere | Fixed — marked no-reader, pointing at `no_attack` |
| `faction_guard` (npcs), owner "factions" | **Ghost key + ghost plugin** — `plugins/factions/` does not exist (reworked into `ideologies`) and nothing reads the key, though content NPCs still carry it | no `plugins/factions/`; zero code references | Fixed — marked no-reader |
| `gov_checkpoint` (zones), owner "govgate" | **Ghost key + ghost plugin** — no `plugins/govgate/`; no reader. `gov_enclave` survives only as a *value* of `checkpoint_cfg.insideFlag`, i.e. the gate is generic, not special-cased | `plugins/checkpoint/index.js:17,41`; `gov_checkpoint` appears only in `tagCatalog.js` | Fixed — both rows corrected |
| `curtain` / `perimeter_gate` / `glacis`, owner "perimeter (wildlands)" | **Ownership drift** — no `plugins/perimeter/`. The engine whitelists these into the map payload and the flight renderer draws the wall | `world.js:928-929`, `commands/movement.js:778-779`, `plugins/flight/state.js:574,583,642`, `snapshot.js:32,38-39`, `client/game/js/panels/minimap.js:750` | Fixed |
| `aa_bunker` (zones), "value = the owning `aa_sites.id`" | **No reader** — the repair loop finds its engineer by the NPC's `flags.aa_engineer` instead | `plugins/aa-sites/index.js:58-61`; `aa_bunker` appears only in `tagCatalog.js:288` | Fixed — marked no-reader |
| `prologue_chair` (furniture) | **No reader** — only the sibling `prologue_holosign` is consumed (as a `use` `requiredTag`) | `plugins/prologue/index.js:183` | Fixed — row split |
| `npcs.flags` / `furniture.flags` tables are complete | **Incomplete** — 9 npc and 8 furniture keys live in content with verified readers and no row: `aa_engineer`, `bouncer`, `bouncer_eject_zone`, `consort`, `devoted_to`, `haunt_zone`, `no_banter`; `emergency_deck`, `tuned_channel`, `restock_items`, `teleporter`/`teleport_target`, `vends`/`vend_line`/`vend_cooldown_s`, `fuel_source`, `woven` | `aa-sites/index.js:61`, `strippers/index.js:284,321`, `consort/index.js:8,73`, `ai-behaviour.js:1157-1159`, `npc-banter.js:74`; `broadcast/index.js:5862,594`, `consort/index.js:1350`, `yacht/index.js:667,691`, `vending/index.js:4-6,24,46`, `fillable/index.js:42`, `describe.js:148,495` | Fixed — rows added |
| Zone flags are catalog-validated; `PATCH /zones/:id/tag` and `content/zones/*.json` lint reject uncatalogued keys | Correct | `client/shared/tagCatalog.js`; `server/api/routes.js:296`; `scripts/content/lint.mjs` | — |
| `scripts/report-flag-keys.mjs` exists | Correct | file present | — |
| `radiation` 0–100 with 25/40 danger floors; `sanctuary` replaced `is_safe_zone`; `allow_sleep`; `hide_exits`; `rest_multiplier`; `terrain` + `roadConnector` | Correct | `zone-tags.js:11-13,21-23,29`; `danger.js`; `describe.js:75-80`; `gameLoop.js` `restRegenTick`; `world.js:240` | — |
| Remaining ~120 documented keys have readers | Correct — swept individually | per-key grep over `server/ plugins/ client/ tools/` | — |

**Concision** — 163 → 213 lines. **No cuts were available and none were made**: the file is three
tables of one-line contracts with a 12-line header, and every row is a key→owner→meaning mapping.
All growth is the 49 missing keys plus six no-reader corrections. One header sentence was added to
define the `—` owner convention, so a no-reader key reads as a warning rather than an omission.

Glyphs verified intact after saving (`⌖ ☢ ₵ ⛨ —`); all four files re-checked as UTF-8, no BOM, no
mojibake.

---

### Flagged — decisions for you

1. **`content-pipeline.md`'s "Cutover runbook" section (28 lines) is an executed one-time
   migration.** Its own status blockquote says it is "kept for reference only", and its step 6
   lists files that were `git rm`'d in the cutover. By the audit's own rules this is narrative
   history and would go — but the doc explicitly declares it retained, and overturning an author's
   stated decision is your call, not mine. **Delete, or keep?**
2. **`flags-keys.md`'s `work_fence_blacklist` row is in the wrong table.** It sits in `zones.flags`
   but the key cell self-labels it `(player)` — it is a `player_flags` key, and this doc's stated
   scope is the three JSONB tag bags. It is the only player flag in the file, so there is nowhere
   correct to move it without adding a section (out of scope: "no restructuring"). Leave it,
   or add a `player_flags` section in a later pass?
3. **Two live `flags::text LIKE '%"key"%'` queries — a code smell architecture.md explicitly
   forbids.** `plugins/broadcast/index.js:5862` (`emergency_deck`) and `plugins/yacht/index.js:681`
   (`teleporter`) both do exactly what the read-tier rule names as a bug: "It casts every row's
   JSONB to text (unindexable full scan) and matches keys *and* values alike." Both target
   `furniture`, which is now a boot-loaded Map, so both could filter the Map instead. Not fixed —
   this is a docs audit. **File it?**
4. **`plugins/audio/index.js` mentions `combat.hit`**, one of the two ghost hooks. I did not read
   far enough to tell whether it is a dead subscription or an unrelated string — `sfxByName('combat_hit')`
   sits on an adjacent line and is a *sound* id, so it may well be innocent. Worth a two-minute look
   by someone who knows the audio plugin: if it *is* a hook subscription, that plugin has a handler
   that has never fired.
5. **I could not positively verify one "Not built" entry.** "Multi-builder conflict detection /
   presence indicators" I left standing on absence of evidence rather than proof — the only honest
   verdict I can give it.

### Batch summary

The most dangerous stale claim was the pair of **ghost hooks, `player.enterZone` and `combat.hit`,
documented in both `architecture.md` and `server.md`** — the two docs an agent reads before writing
a plugin, agreeing with each other about an extension point that does not exist. `player.enterZone`
is the worse of the two, because a real seam sits right beside it under a different name and a
different mechanism: `zone.entered` is an **Event**, not a hook, and the two registries have
separate APIs. An agent would write `hooks: { 'player.enterZone': … }`, watch it load with no
warning (the loader validates nothing about hook names), and ship a feature that never fires.
Runner-up is `flags-keys.md`'s **`requires_demolition`**, the same shape one layer down: a
documented protection flag that protects nothing, because the real gate is a hardcoded
`DEVICE_SPECS` table.

The lesson for the remaining batches sharpens batch 3's. Batch 3 found that a compiler and its
consumer drift apart independently; batch 4 found the same fault line between **a registry and its
enforcement**. `flags-keys.md` was 32 keys behind `tagCatalog.js` *even though the catalog is
validated at write time* — validation guarantees that code and content agree, and guarantees nothing
whatsoever about the doc. So wherever a doc mirrors a machine-readable registry (`tagCatalog.js`,
`content-registry.js`, `plugin.json` manifests, `CADENCE_MS`), diff the two mechanically before
reading a word of prose; it is seconds of work and it produced 49 of this batch's rows. And where
the registry has *no* enforcement — the `npcs`/`furniture` bags, which the doc's own header admits
are "documented-not-validated" — expect ghosts, because a typo'd or abandoned key there is inert
forever and nothing will ever complain. That is exactly where `essential`, `faction_guard`,
`prologue_chair` and `requires_demolition` were hiding.

No reordering needed for what remains. But `content-pipeline.md` earns a note of the opposite kind:
it is the only doc in four batches whose every mechanism claim held on first check. Its
distinguishing habit is that it documents *reasons* ("`expires_at` alone was not enough", "the
transaction pooler breaks `SET CONSTRAINTS ALL DEFERRED`") rather than restating behaviour — and
reasons don't rot the way inventories do. All three defects it did have were **omissions of things
added later**, never wrong statements. A doc that explains why is a doc that ages well.

---

## Batch 5 — `devpanel-js.md`, `vine.md`, `ai-behaviour.md`

All three classify as **as-built** (devpanel-js.md and ai-behaviour.md are named as such in the
audit brief; vine.md documents a shipped editor and its schemas, and every claim in it is checkable
against `client/devpanel/js/vine/`). So every claim below was verified against code, not recalled.

### `ai-behaviour.md`

#### Correctness

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| Stored `behaviour_graph` is `{ _start, nodes:{id:{type,data}}, edges:[{fromNode,fromPort,toNode}] }` | **Wrong — inverted.** That is the *runtime* shape. The stored shape carries connections inline per node (`next`/`ifTrue`/`ifFalse`/`branch_N`/the four vendor ports) with params flat, and `normalizeGraph` **discards any `edges` array it finds** while building its own from the inline keys | `server/engine/ai-behaviour.js:520-553`, `_normalized` guard at `:526` | Rewrote the section: stored shape first with a worked example, recognised connection keys listed, the discard behaviour called out |
| "ticked once per second by `tickEntityAI`" / "called each second for every live enemy and NPC" | **Wrong for NPCs.** Enemies tick at 1 s (raw `setInterval(tick, 1000)`); NPCs tick from `npcWanderTick`, scheduled at **`1m`** | `server/engine/gameLoop.js:48` + `:161`; `gameLoop.js:55` + `:1243` | Added a per-kind tick-rate note to the header and dropped "each second" from the Tick section |
| `TELEPORT` "persists `zone_id` to DB for NPCs" | **Wrong.** `moveEntity` accepts a `query` param and never uses it; `TELEPORT` doesn't even pass one. All AI positions are RAM-only | `ai-behaviour.js:297-510` (no `query` call anywhere in the body); `TELEPORT` at `:980`; corroborated by `gameLoop.js:1226` "Position is RAM-only" | Row rewritten to say not persisted; folded into Known Limitations |
| `GO_TO_WORK` "If scheduled (`IS_BROADCAST_SCHEDULED`) … No-ops otherwise" | **Wrong.** The action checks no schedule at all — it walks unless already at the work zone. Scheduling is `CHECK_WORK`/`CHECK_VENDOR_WORK`'s job | `ai-behaviour.js:988-1030` | Rewrote the row, incl. the destination fallback chain and the `arrive_by` hold |
| Separate `GO_TO_WORK (old)` row, "superseded by the parameterless `GO_TO_WORK`" | **Ghost.** One `case 'GO_TO_WORK'` handles both param sets; the editor still offers `zone_id`/`arrive_by`/`depart_early_minutes` | `ai-behaviour.js:990`; `client/devpanel/js/vine/vine-schema-ai.js:110-114` | Row deleted, params merged into the single `GO_TO_WORK` row |
| Default studio graph is `start → HAVE_LIFE → GO_TO_WORK → AT_WORK → wait(30) → loop` | **Wrong.** Actual: `start → have_life → go_to_work → at_work → go_home → wait(60) → start`. No `loop` node, 60 s not 30, and a `GO_HOME` step the doc omits | `ai-behaviour.js:1537-1549` | Corrected; also added the three sibling builders (vendor / unemployed / aggressive-enemy) and `ensureBehaviourGraph`'s skip rules, which the doc never mentioned |
| "PATROL's walk mode and FLEE both use BFS" | **Wrong for FLEE.** FLEE picks from `neighborZoneIds(zone)` — immediate exits, no routing. Same for ROAM | `ai-behaviour.js:847`, `:909` | Replaced with the actual list of routed actions |
| `findPath(startId, targetId, { maxDistance = 60 })` | **Incomplete.** Signature also takes `roads` and `avoid`; and `ai-behaviour.js` shadows the import so NPCs path with `roads: true` and enemies don't | `server/engine/pathfinding.js:37`; shadow at `ai-behaviour.js:254-258` | Signature corrected, shadow documented |
| Known limitation: "NPC movement … is not broadcast to nearby players, unlike enemies" | **Stale.** Both branches of `moveEntity` broadcast `arriveMsg`/`departMsg`, and the NPC branch adds door/elevator/shop flavour | enemy branch `ai-behaviour.js:417-418`; NPC branch `:430-431` | Item deleted |
| Known limitation: "World-scope flags in `FLAG_SET`/`FLAG_SET`" | Accurate but self-contradicting typo (should be `SET_FLAG`/`FLAG_SET`) | `ai-behaviour.js:1079-1085`, `:634-637` | Fixed |
| Condition table complete | **Missing `TARGETABLE_IN_ZONE`** — and it's the one an aggro gate should use, since it honours `ignores_admins`/`attacks_npcs`/`attacks_enemies` | `ai-behaviour.js:608-616` | Row added |
| Action table complete | **Missing `ROAM`, `CHECK_WORK`, `TALKSHOW_APPEAR`, `TALKSHOW_HIDE`** (the last two drive the broadcast plugin's shipped guest graph and are exercised by its regress) | `ai-behaviour.js:888`, `:1033`, `:1428`, `:1449`; `plugins/broadcast/regress.js:287` | Four rows added |
| Blackboard shape | Missing `_roamNextAt`, `_fleeNextAt` | `ai-behaviour.js:234-235` | Added |
| Tick "returns immediately if `ai.waitUntil`…" | Incomplete: four earlier bailouts (`ai.alarm`, `ai.dosedOut`, `ai.shopPaused`, no-zone) are the seam plugins use to take an NPC over, and were undocumented | `ai-behaviour.js:1654-1671` | Added as step 1; also documented port-string action results |
| Plugin node registry: sync-condition contract, async-action ctx, `getRegisteredAINodes()`; broadcast plugin registers `CHANNEL_HAS_VIEWERS`/`IS_BROADCAST_SCHEDULED`/`AT_WORK_ZONE`/`BROADCAST_SAY` | **Correct** | `ai-behaviour.js:566-581`; `plugins/broadcast/index.js:3605-3614` | None |
| `FLEE` roll: `flee_skill + 2d8−2d8` vs difficulty 6, fail keeps aggro | **Correct**, but omits that the roll is skipped entirely when a player is pressing the attack (`moveEntity` owns the contest) | `ai-behaviour.js:855-866` | Added the bypass; trimmed the row's narrative tail |
| `AT_HOME_LIFE` posture contract (`setPosture(entity,'lying',{sittingOn})`, floor fallback, 15 %/tick, wake 1 h before shift else 07:00) | **Correct** — except the random home *activities* come from the passive ticker in `tickEntityAI`, not this node | `:1257-1298`; passive block `:1673-1690`; wake fallback `:167-170` | Ownership corrected, row tightened |
| `enemies.behaviour_graph` / `npcs.behaviour_graph` JSONB | **Correct** | `server/models/schema.js:163`, `:185` | None |
| `getZonesInRadius` returns `Map<zoneId,distance>`, used by CALL_BACKUP | **Correct** (param is `maxHops`, not `radius`) | `pathfinding.js:149-165` | Signature aligned |

#### Concision

216 → 230 lines. Net growth, because the corrections carried more contract than the wrong claims
did (four missing node types, three missing default-graph builders, the two-shapes graph format).
Cuts applied: **aspiration in an as-built doc** (the "vendor nodes are slated to move … Phase 3"
pointer — the proposal exists and says so itself); **narrative tail** on the FLEE row ("weak early
enemies routinely botch the escape while nimbler ones slip away reliably"); **triple-stated fact**
(the studio graph's per-cycle prose restating its own table).

### `vine.md`

#### Correctness

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| "`_vsPendingOpen` was set by `vineGoToFamily` — consumed once, to land directly on a family's existing list" | **Ghost.** No such identifier exists anywhere in the repo. `renderVineSuite` unconditionally resets to the front page | `grep -r _vsPendingOpen` → no hits; `client/devpanel/js/panels/vine-suite.js:127-132` | Claim removed |
| Family tab click "navigates to the VINE Suite panel opened straight into that family's existing list" | **Wrong.** `vineGoToFamily` reopens the family's last-open record via `vineJumpTo`, else raises `vsHostPicker` — a popup **over** the editor. It never navigates panels. Clicking the *active* tab also opens that picker | `vine-suite.js:376-398`, `:408` | Section rewritten |
| "VINE is split into four layers" over a 6-row table | **Wrong count, and the table omits 3 of the 5 schema files** (`ai`, `quest`, `broadcast`) that the doc itself documents further down | `ls client/devpanel/js/vine/` → 9 files; load order `client/devpanel/index.html:383-391` | Reframed as engine + one schema per use case; all 9 listed |
| "full list of action types" (16 entries) | **Stale.** Missing `ADJUST_REPUTATION`, `ADJUST_STANCE`, `ADJUST_PATH` — the ideologies actions | `vine-action-types.js:96-125` | Three added; also noted that AI nodes come from a *separate* catalogue |
| Quest runtime: "the `START_QUEST`/`ADVANCE`/`COMPLETE`/`TURN_IN` actions the VINE action picker lists" | **Wrong for `ADVANCE`.** It's a real quests-plugin action and a recognised quest-jump trigger, but it is not in `VineActionTypes`, so the picker never offers it | absent from `vine-action-types.js`; action at `plugins/quests/index.js:593`; jump list `vine-schema-dialogue.js:62` | Qualified |
| Broadcast schema node table (12 types) | **Stale — 8+ types missing** (`npc_action`, `tech_difficulties`, `title_card`, `music`, `overlay`, `show_overlay`, `clear_overlay`, `credits`). **Duplicate source of truth**: `systems-broadcast.md` carries the same table, complete, with air-time semantics | `vine-schema-broadcast.js:108-358`; owner table at `docs/systems-broadcast.md:208-223` | Table replaced by one line + link to the owner; conversion helpers and the conditions list (which the owner doesn't carry) kept |
| "AI Schema additions — two entries were added … `CHANNEL_HAS_VIEWERS`, `BROADCAST_SAY`" | **Stale + narrative.** The AI catalogues now hold 17 conditions / 25 actions. Duplicate of `ai-behaviour.md`'s catalogue | `vine-schema-ai.js:45-125` | Replaced with the conversion-helper contract (which `ai-behaviour.md` does *not* own) + a link |
| Auto-layout: 320 px columns, 180 px rows, origin 40/60, 3 forward + 3 backward barycenter sweeps, back-edge DFS, Kahn longest-path | **Correct in every particular** — but there is now a second **Layout Vertical** button the doc doesn't mention | `vine-core.js:342-457`; button at `:104` | Vertical mode added in one line |
| Controls table | Correct; omits that a plain (non-Ctrl) wheel pans | `vine-core.js:170-180` | Row amended |
| `VineEditor` API (`load`/`save`/`destroy`/`on('change')`/`on('nodeSelect')`), `save()` → `{nodes,edges,_view}` | **Correct** | `vine-core.js:726-761` | None |
| Internal layout + z-index table (canvas 2 / svg 1, drag 4/3), 280 px props panel | **Correct** | `vine-core.js:39-73` | None |
| `vineIdentity` colour table (dialogue `--accent2`, behaviour `--accent3`, script `--cyan`, quest `--accent`, broadcast `#226644`) | **Correct, all five** | the five `vineIdentity` literals, e.g. `vine-schema-broadcast.js:415` | None |
| Script schema node types + colours (6 rows) | **Correct, all six** | `vine-schema-script.js:51-130` | None |
| `VINE_KINDS` field list; `vineJumpTo` saves straight to the canonical route; `vineJumpToQuest` shim | **Correct** | `vine-suite.js:44-98`, `:334`, `:367` | None |
| GPS_TO: gps plugin, `params.zone`, no-ops at destination, `npc_claude_merrin` uses it | **Correct** | `plugins/gps/index.js:195`; `plugins/gps/regress.js:281`; `content/npcs/npc_claude_merrin.json:279` | None |
| "Adding a New Schema" 4 steps (script tag after `vine-core.js`) | **Correct** | `client/devpanel/index.html:386-391` | None |

#### Concision

467 → 462 lines. Cut classes: **duplicate source of truth** (the broadcast node table → owner link;
the AI catalogue → owner link — together ~30 lines of restated registry that had already drifted,
which is exactly the failure mode duplication produces); **narrative history** ("Two entries *were
added*"); **stale scaffolding** (the `_vsPendingOpen` hand-off mechanism). The line count barely
moves because the front-page/master-list and vertical-layout corrections added back what the
dedupe removed.

### `devpanel-js.md`

#### Correctness

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| `world-editor.js` | **Missing entirely** — 459 lines, a live panel (`world`, "World Map"), absent from both the file index and the `PANELS` list | `client/devpanel/js/panels/world-editor.js`; `PANELS.world` at `core/panels.js:264-273`; loaded at `client/devpanel/index.html:416` | Entry added; `world` added to the `PANELS` list |
| `table.js` holds `renderZonesTable`/`filterZones`/`zToggle`/`_zonesExpanded` | **Wrong file.** All four live in `panels/zones.js`; `table.js` only carries a comment pointing there | `panels/zones.js:47`, `:315`, `:327`; `core/table.js:62` | Bullet removed from `table.js` (replaced by the one-line "a panel can replace `renderTable` wholesale" rule) |
| Zones accordion tiers: "exterior zone (BFS from `zone_start`) → buildings → floors by `grid_z` → rooms" | **Wrong.** Now district-first: `districtKeyFor` (flags override → id prefix → `danger` default) → buildings, then named exteriors, then one collapsed Terrain-tiles fold; interiors nest via the exit graph. Plus a region-scoping dropdown the doc never mentions | `panels/zones.js:33-60` | Rewritten under `zones.js`, where it belongs |
| `auth.js` holds `launchPlayerClient()` / `showPlayButton()` | **Wrong file** — both are in `panels/worldstate.js`, where the doc *also* (correctly) lists them | `panels/worldstate.js:177-182`; `core/auth.js` has neither | Removed from `auth.js`; noted its real load-order constraint (after `panels.js`) |
| `BUILTIN_THEME_VALUES` = 7 named themes | **Wrong.** It's derived — `[...LIGHT_THEMES, ...DARK_THEMES].map(([v]) => v)`, 33 ids, kept in lockstep with `client/shared/settings.js` | `ui/settings.js:53-66` | Replaced the frozen list with the derivation + the lockstep constraint |
| `broadcast.js`: `openBroadcastModal(rec,isNew)`, `_broadcastEditTarget`, `_broadcastMessages`; "table of broadcasts" | **Three ghosts + wrong shape.** None of the three identifiers exist; the panel is a sidebar + edit canvas, and the real state is `_bcSelected` / `_bcCards` / `_bcChannels` / `_bcSuiteTab` | `grep -r` → no hits; `panels/broadcast.js:161-170`, `:182-202` | Corrected |
| `vine-suite.js`: `vsRenderIndex()` | **Ghost.** Actual: `vsRenderRoot` / `vsRenderMasterList` / `vsRenderExisting` | `grep -r vsRenderIndex` → no hits; `panels/vine-suite.js:134`, `:175` | Corrected — and the whole entry, a **duplicate of vine.md's VINE Suite section**, collapsed to an entry-point list + link |
| `modal.js` = modal + toast + settings overlay | **Incomplete.** Also owns `dpConfirm`/`dpPrompt`/`dpAlert` (the themed replacements for native dialogs) and `dpFloatAnchor` | `ui/modal.js:68-121`, `:175` | Added |
| `dashboard.js` documented twice, with different text | Duplicate section | doc lines 91-92 and 345-346 (pre-edit) | Second occurrence deleted |
| `panels.js` "must load after all `panels/*` and `ui/*`" | **Correct** — `core/panels.js` is third from last, before only `auth.js` and `bootstrap.js` | `client/devpanel/index.html:442-446` | None |
| `STAGED_ENTITY_TYPES` path→type map (incl. `/scavenging-tables` → `scavenging_table`), `getEntityType`, `directAPI` bypass | **Correct** | `core/api.js:1-28` | None |
| `#edit-actions-top` + `.js-save-btn`/`.js-delete-btn` dual save bar | **Correct** | `core/table.js:127`, `:167`, `:185` | None |
| staging.js function set; `exportDatabaseDump` | **Correct** | `core/staging.js:4-190` | None |
| aliases: `directAPI` `POST`/`DELETE /command-aliases`, engine defaults in `server/engine/commands/aliases.js` | **Correct** | `panels/aliases.js:51`, `:59`; file exists | None |
| emergency: `PUT /crimes/:id` partial (stars clamped 0–5, enable toggle) | **Correct** | `panels/emergency.js:264`, `:291` | None |
| broadcast save route `/broadcast/broadcasts/:id`; scavenging via `flags.scavenging_table_id`; `.amp` export; `compileBsm(text)`; `escHtml2`/`escHtml3` collision-avoidance | **All correct** | `panels/broadcast.js:826`; `panels/zones.js:394`; `panels/audio.js:563`; `bsm-compiler.js:4`; `panels/broadcast-channel.js`, `panels/broadcast-themes.js` | None |
| ~35 further named functions/constants spot-checked across `zones`, `maps`, `power`, `bank`, `emergency`, `validator`, `tags`, `audio`, `sounds`, `players`, `timeweather`, `worldstate`, `gossip` | **All exist, in the stated files** | batch `grep -rl` sweep | None |

**Index drift:** none. CLAUDE.md's one-line hooks for all three docs still describe them accurately,
and none of the three moved or renamed.

#### Concision

382 → 381 lines. Cut classes: **duplicate source of truth** (the `vine-suite.js` entry, ~9 lines
restating vine.md; the `renderZonesTable` bullet stated in two sections); **triple-stated fact**
(the second `dashboard.js` section); **narrative history** ("the standalone Crimes panel was
removed", "not a per-row checkbox" — both describing what the UI *used to* be). Offset by the
`world-editor.js` entry, which is new coverage of an existing file rather than new prose.

### Flagged

1. **`moveEntity` takes a `query` parameter it never uses** (`ai-behaviour.js:297`). Every call site
   dutifully threads `query` through — `TELEPORT` is the one that doesn't, which is what made me
   check. The dead param is what let the doc's "persists `zone_id` to DB for NPCs" claim survive: it
   *looks* like persistence is wired. **Question:** was NPC position persistence deliberately dropped
   (gameLoop's respawn path says "Position is RAM-only" as though it were), or did it rot? If
   deliberate, the param should go; if not, that's a bug. I changed only the doc.
2. **The VINE AI editor offers `FLEE` a `max_distance` param the engine ignores**
   (`vine-schema-ai.js:79` vs `ai-behaviour.js:843-882`, which reads no params at all). An author can
   set it, save it, and get nothing. I documented the mismatch in the FLEE row rather than silently
   dropping it. **Question:** delete the param from the schema, or implement it?
3. **Two `GO_TO_WORK` behaviours behind one action type.** With `zone_id` + `arrive_by` it holds
   until a computed commute window; with neither it leaves immediately. Both are live (the vendor
   default graph uses the parameterless form; the editor defaults `arrive_by` to 20). I documented
   both. **Question:** is the timed form still wanted, or is it the vestige the old doc's
   "superseded" line thought it was?
4. **`vine-core.js` toolbar advertises Ctrl+0 / Ctrl+− / Ctrl+= in its tooltips** (`:98-100`) but
   `_onKey` (`:251-269`) binds only Delete/Backspace, Ctrl+Z, Ctrl+Y, Ctrl+A. The doc's Controls
   table never claimed those shortcuts, so nothing to fix in docs — flagging because the tooltips
   lie to users.

### Batch summary

The most dangerous stale claim in this batch is **`ai-behaviour.md`'s graph-format block**, which
documented the *runtime* shape as the *stored* shape. An agent authoring a behaviour graph by hand —
exactly what the VINE-workflow section of CLAUDE.md tells it to do, then PATCH straight to the DB —
would emit `edges: [{fromNode, fromPort, toNode}]`, and `normalizeGraph` would rebuild the edge list
from inline node keys that aren't there, silently producing a graph whose every node is unreachable.
No error, no warning: the entity just ticks `_start` and stops. The tick-rate error is the same
shape of harm one level up (an NPC graph tuned as if it ran 60× more often than it does), and the
two compound — a hand-authored NPC graph would fail slowly *and* silently.

The pattern across all three docs differs from batch 4's. Batch 4's ghosts came from docs mirroring
a registry and falling behind. **This batch's came from docs describing a data shape on the wrong
side of a conversion boundary.** `normalizeGraph`, `fromAiGraph`/`toAiGraph`,
`fromDialogueTree`/`toDialogueTree`, `fromQuest`/`toQuest` — every one of these has a stored shape
and an in-memory shape, and every doc that got one wrong got it wrong by documenting the shape it
happened to read in the runtime rather than the one an author has to write. Wherever a doc shows a
JSON block, the first question is *which side of the converter is this?* — and the answer belongs in
the prose, not left to inference.

Next-batch order needs no change. One structural note for whatever covers `systems-broadcast.md`
again: `vine.md` and `ai-behaviour.md` were each duplicating a node catalogue a systems doc already
owned, and in both cases the *copy* was the one that drifted (8 broadcast node types missing; an AI
catalogue described as "two entries" when it holds 42). I collapsed both to links. Where this shape
recurs, the copy is always the one to cut — the owner is the doc that gets updated when the code
changes, because it's the one whose subject *is* the code.

---

## Batch 6 — `proposals/` ship-status sweep (22 files, 4,600 lines)

All 22 classify as **proposal / vision**. Per the audit prompt these are not checkable against
code and were not read for content — the only correctness question is the **status stamp**, so
this batch is one verdict per file plus a stamp. No prose was rewritten toward the
implementation, and **no concision cuts were made** (a proposal's argument is its whole value).

**Verdict tally:** 8 stamps were already correct · 9 were stale (7 understating what shipped,
2 overstating) · 2 whole premises are obsolete · 3 docs had no status line at all.

### Correctness — stale stamps (fixed)

| Doc | Old stamp | Verdict | Evidence | Action |
|---|---|---|---|---|
| `ascendant-stronghold.md` | "design only — not built" | **SHIPPED** — campus *and* augment system | `plugins/ascendant/plugin.json`, `plugins/ascendant/index.js:1-8` (Threshold move-gate), `plugins/augments/plugin.json` (4 verbs, 3 tables, `player.respawnZone` hook), `content/zones/zone_asc_spire_{concourse,gallery,sanctum}.json`, `content/maps/map_int_asc_*`, 8 × `content/augments/` | Fixed — stamped BUILT with the shipping surface |
| `yards.md` | "SPEC — not yet built" | **SHIPPED** | 81 × `content/zones/zone_yard*`, `npc_yardmaster{,_barlow}` + `npc_yard_teamster`, pooled Logistics Store `plugins/corps/ventures.js:149-163`, verb `plugins/corps/index.js:1072` | Fixed — stamped BUILT |
| `leviathan-flying-base.md` | "no code written yet" | **Phases 1–2 SHIPPED** | `content/maps/map_aircraft_leviathan.json`, `zone_leviathan_{cabin,flightdeck,galley,hold}`, `plugins/flight/charter.js:397-401` (`isWalkableCabin`/`boardCabin`), `plugins/flight/index.js:307-341` (`take controls`/`handoff`) | Fixed — Phases 1–2 BUILT, 3–5 still design |
| `flight-overhaul.md` | "Proposed / not built" | **SHIPPED, all four phases** | `client/game/js/panels/flight-model.js`, `plugins/flight/state.js:923-952` (reconcile), `plugins/flight/biomes.js`, `client/game/js/panels/cockpit.js:2117,2211` (heli cyclic), `client/game/js/panels/engine-audio.js` | Fixed — stamped BUILT, pointed at the as-built doc |
| `proposals/systems-flight.md` | "design exploration, not yet committed to build" | **SHIPPED** (then overhauled) | `plugins/flight/` (14 modules); `docs/systems-flight.md:1-6` is the as-built source | Fixed — stamped BUILT + named the filename collision inline |
| `the-under.md` | "Phase 1 … is the current deliverable"; deep chain "BUILT, uncommitted" | **Phase 1 + Dredge chain SHIPPED and committed** | 117 × `content/zones/zone_under_*`, `quest_down_the_drain` + `quest_under_{salvage,deepcuts,apex}`, `npc_dredge.json`, 4 × `enemy_sewer_*`, `scav_sewer` + `scav_deep` | Fixed — top stamp, section heading, and "uncommitted" → "committed" |
| `corporate-assets.md` | console UI / placed venture / warehouse listed as pending | **Three of the pending items shipped** | `client/game/js/panels/corp-console.js:1-6`, `flags.claimable_asset` on `zone_{casino,clinic,fence,gunshop,chemsupply}_interior.json`, warehouse now backs the Logistics Store (`plugins/corps/ventures.js:149-163`) | Fixed — moved the three to shipped; `security_office`/`front_office` remain honest stubs (`ventures.js:49-50`) |
| `legacy-world-decommission.md` | "Plan, not built" | **EXECUTED** | zero `zone_nc_*`/`zone_gov_*`/`zone_up_*` in `content/zones/`; `plugins/checkpoint/plugin.json` — "the gov-quarter recipe is dormant for the North City rebuild" | Fixed — stamped EXECUTED |
| `coldwater-expansion.md` | "nothing is built" (top) **and** "Phase 1 BUILT & LIVE" (`:94`) | **ABANDONED — superseded**, and the two stamps contradicted each other | zero zones matching `zone_slums`/`zone_civ_*`/`zone_waste_*`/`zone_deep_*`; surface is the 888-tile `zone_district_*` grid | Stamped ABANDONED, then **doc deleted** on the user's call (see Flagged #3) |

### Correctness — no status line at all (stamps added)

| Doc | Verdict | Evidence | Action |
|---|---|---|---|
| `neon-migration.md` | **SHIPPED** | `package.json:42` (`@neondatabase/serverless`), `.github/workflows/deploy-content.yml:5,12,32-37` (Neon branch snapshots + instant restore); no Supabase reference in either | Stamped SHIPPED |
| `egress-remediation-phase4b-cameras.md` | **SHIPPED** | buffer is RAM: `class CameraBuffer` `plugins/surveillance/index.js:606`, `cameraBuffers` Map `:633`; no per-capture write remains | Stamped SHIPPED |
| `egress-remediation-phase7-8-idle-activity.md` | **SHIPPED, and generalised past the proposal** | `hasActivePlayers()` `server/engine/world.js:1013` (~25 call sites), but `server/engine/scheduler.js:56-60` now idle-gates **every** callback by default with `{runWhenEmpty:true}` as the opt-out | Stamped SHIPPED + redirected the reader to scheduler.js |

### Correctness — obsolete premise (stamped; retirement is the user's call — see Flagged)

| Doc | Verdict | Evidence | Action |
|---|---|---|---|
| `under-gate-and-map-readability.md` | **MOSTLY OBSOLETE** — A's target zones deleted; B's ASCII-connector minimap replaced | no `zone_gov_*`/`zone_nc_*`/`zone_up_vellum`; minimap rebuilt on terrain fills + districts + arteries (`client/game/js/panels/minimap.js:97,681,693`) | Stamped MOSTLY OBSOLETE, then **doc deleted** on the user's call (see Flagged #4) |
| `interior-pass.md` | Status ("REPLANNED, not built") **correct**; its world snapshot is stale | 149 zones carry `flags.is_building`, not 18 — growth came from Yards/Ascendant/Reach, not this pass: no tenement block, no waterfront cluster in `content/zones/` | Fixed — one note under the audit heading; phase table untouched |

### Correct as-is — no edit (8)

| Doc | Stamp | Verified against |
|---|---|---|
| `broadcast-piracy.md` | Phases 1–4 built, 5 pending | `plugins/broadcast/index.js:2688-2764` (`pirate_*` deck flags, queue/crawl/live-mode); `:4793` "proxy until corp ownership exists" ⇒ Phase 5 genuinely pending |
| `engine-plugin-boundary.md` | Phases 0–2 built, Phase 3 partial | `server/engine/protection.js` exists ✓; both named deferrals are still deferred — no `plugins/housing/`, vendor-life nodes still in `server/engine/ai-behaviour.js:657,988,1246` |
| `flight-unified-model.md` | Ships 1–2 built, Ship 3 pending | `plugins/flight/state.js:923-952` (reconcile/`stalledState`) ✓; `BANDS`/`BAND_LABEL`/`BAND_BURN` still at `:29-31` ⇒ the vocab tidy is genuinely pending |
| `systems-flight-pvp.md` | Phases A–C built, D design | `plugins/flight/combat.js:139,152-159,205-223` (RWR, lock gate, `fireMissile`, flares) |
| `steady-work.md` | Both archetypes built | `plugins/work/plugin.json` (13 verbs), `plugins/work/courier.js:12-15` (contraband parcel), `plugins/tablet/quests-app.js:26,30` (`Steady Work` tile) |
| `void-arrival-checkpoint.md` | PLAN, awaiting approval | premise still exactly true: `leaveCrossing` still lands you on the dest tile (`plugins/voidwalking/index.js:635-648`), dests unchanged at `:68-69`; `zone_exodus_waypoint` still absent from `content/`, as the doc says |
| `north-city-under-rebuild.md` | Deferred / not built | no `zone_gov_*`/`zone_nc_*`; `plugins/checkpoint/plugin.json` holds the dormant gov recipe waiting on exactly this |
| `wildblood-stronghold.md` | Design, 2026-07-17 | no Thornwarren zones in `content/zones/`; the in-city Breakers cell it references does exist |

**Concision** — 4,600 → 4,684 lines; **zero cut classes applied**. This batch was a status sweep by
instruction, and proposals are the one class where the narrative *is* the payload. All growth
(+112/−28) is status stamps carrying `file:line` evidence. Glyphs verified after saving: no
mojibake, every file still UTF-8/ASCII without BOM.

### Flagged

1. **`CLAUDE.md:48` calls the corporation system "(design, not built)"** — but `plugins/corps/`
   ships ventures, the pooled Logistics Store, and a full console UI, and this batch's
   `corporate-assets.md` documents Phase A as built. The line points at `docs/systems-corps.md`,
   which is **outside this batch**, so I did not edit the index rather than guess at that doc's own
   stamp. **RESOLVED 2026-07-24 — user said fix.** `docs/systems-corps.md:1-4` self-reports "Phases
   0–2 built; Phase 3 war/raids + destabilization built 2026-07-18; espionage, NPC corp AI, and the
   Architect reactive layer remain design" — the doc wins, so `CLAUDE.md`'s hook now says that and
   links `proposals/corporate-assets.md` for the venture/asset half.
2. **Two docs are named `systems-flight.md`** — `docs/systems-flight.md` (as-built) and
   `docs/proposals/systems-flight.md` (original locked design). `flight-overhaul.md:9-11` has to
   link both and disambiguate them in prose. Renaming is out of scope for this audit.
   **Question:** rename the proposal (e.g. `flight-original-design.md`) and fix the inbound links,
   or keep the collision and rely on the stamp I added?
3. **`coldwater-expansion.md` is dead weight — retire it?** Its build plan is superseded, its
   Phase 1 content deleted, and it anchors **6 SVGs + 2 generators + 2 HTML maps** (~290 KB of
   sibling assets) for a map that no longer exists.
   **RESOLVED 2026-07-24 — user said delete. DOC DELETED; ASSETS KEPT.** The `coldwater-style_*.svg`
   lens set and `coldwater-basin-map.html` are cited as the *live* map artefacts by
   `docs/roadmap-world-expansion.md:11-13` — a citation Batch 3 of this audit added to replace a
   ghost `roadmap-world-map.svg` — so deleting them would have re-created the ghost it just fixed.
   The one inbound link to the deleted doc (`proposals/systems-flight.md:521`) was rewritten to
   point at `legacy-world-decommission.md`. Two files are now genuinely orphaned and could go in a
   follow-up: `coldwater-expansion-map.svg` + `coldwater-expansion-map.gen.mjs` (nothing references
   them). Separately, `coldwater-styles.gen.mjs:1` imports `./mapdata.mjs`, **which does not exist**
   — that generator has been unrunnable for some time, independent of this deletion.
4. **`under-gate-and-map-readability.md` — retire?** Workstream A's world is gone, B is superseded
   by the current minimap, D's successor is live. Nothing in it is actionable.
   **RESOLVED 2026-07-24 — user said delete. DELETED.** No inbound links existed anywhere in the
   repo; nothing else needed fixing.
5. **`the-under.md` carried "BUILT, uncommitted" for ~12 days.** The content is committed now
   (`content/quests/quest_under_apex.json`, last touched by `dc3d9382`), so the stamp was safe to
   correct — but "built, uncommitted" is a state a doc cannot verify about itself. **Question:**
   worth a convention that uncommitted work never gets a doc stamp?

### Batch summary

The most dangerous stale claim is **`ascendant-stronghold.md`'s "design only — not built."** An
agent asked to build the machine path would have read that stamp and started implementing augments
— and `plugins/augments/` already owns `augment`/`augments`/`backup`/`assurance`, three tables, and
the cortical-backup respawn hook. Stale-*understating* stamps are the expensive direction: an
overstated stamp gets caught the moment you grep for the code, but an understated one reads as
permission to build something twice. Seven of the nine stale stamps here failed that way, and every
one was on a doc nobody reopened after the build landed — the stamp gets written when the doc is
written, and never again.

Two structural notes. First, **proposals go stale silently because nothing points at them**: only
`engine-plugin-boundary.md` appears in CLAUDE.md's index, so the other 21 have no reader who would
notice. If ship-status stamps are to stay true, reopening the proposal has to be part of finishing
the build — the `codex` skill's exit gate is the natural place. Second, **`coldwater-expansion.md`
and `under-gate-and-map-readability.md` are both downstream of one event**: the 2026-07-11
legacy-overworld decommission invalidated every doc written against `map_world` zone names. Batch
order should change on that basis — whatever batch covers `docs/systems-world.md` and
`docs/reference/land-taxonomy.md` should run next and check that same seam, because those are
as-built docs, where a surviving `zone_nc_*`-era claim is a bug rather than a stale plan.

---

## Batch 6 — `items.md`, `tags.md`, `reference/land-taxonomy.md`, `systems-terrain.md`

Classification: `items.md`, `tags.md` and `systems-terrain.md` are **as-built**. `reference/land-taxonomy.md`
sits in `reference/` but is *not* a proposal — it makes only checkable SSOT/ownership claims, so it was
audited as as-built.

---

### `docs/items.md`

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| "There is no carry cap — it's surfaced in the `inventory` listing for information" | **Wrong** — there is a hard cap, enforced as a move gate: `carryCapacity()` = 14kg + 1kg/Brawn, and `engine:encumbrance` blocks the step when over | `server/engine/commands/inventory.js:237`, `server/engine/commands/movement.js:76-83` | Fixed — replaced with the cap formula and the "enforced at movement, not at pickup" contract |
| Legacy columns "are migrated into `tags` by `migrate.js`… dropped in a separate later commit… until then they still exist but are unused" | **Wrong twice** — `server/models/migrate.js` does not exist, and the behavioral columns *were* dropped in 2026-07 | no `server/models/migrate.js`; `server/models/schema.js:122-135` (items CREATE has only `id/name/description/type/weight/value/flags`), `:679` adds `tags` | Fixed — blockquote rewritten to what actually survives |
| "no `type`/`subtype` routing" | **Partly wrong** — `subtype` is gone, but `type` is still an authored column (dev-panel Category dropdown) and is read at one runtime site | `server/api/routes.js:1828,1836` (writes `type`), `server/engine/vendor.js:53` (`type === 'furniture'`), `client/devpanel/js/panels/items.js:272` | Fixed — added a `type` row to the `items` table and narrowed the claim to `subtype` |
| "Nothing here requires a deploy" | **Stale** — under CODEX, prod content is git; a dev-panel edit reaches prod only via `content:export` + push, and prod refuses HTTP content writes | `server/api/routes.js:140-141,185` (`CONTENT_READONLY`), `docs/content-pipeline.md` | Fixed — points at the CODEX pipeline |
| `shape` table lists `text/flag/int/enum/range/hot/statmap` | **Incomplete** — the catalog also uses `list` (6 tags, e.g. `covers`) and `number` (4 tags) | `server/engine/tags.js:92` (`case 'list'`), catalog sweep: 121 flag / 34 text / 17 int / 10 enum / 6 list / 6 statmap / 4 number / 1 range / 1 hot | Fixed — two rows added |
| "`scope` is `class` … or `instance`" | **Incomplete** — `furniture` (9 tags) and `zone` (104 tags) are also scopes | `client/shared/tagCatalog.js` scope sweep; `server/engine/zone-tags.js:11,21` | Fixed — all four listed, with a note that only two concern items |
| `laced_drug` shape "drug id"; `laced_potency` "number"; `use_message` "string" | **Drifted** — catalog shapes are `text`, `int`, `text` | `client/shared/tagCatalog.js` (`laced_drug: text`, `laced_potency: int`, `use_message: text`) | Fixed |
| `armor_soak` is the **only** armor mechanism; flat `armor` int removed | Correct — no `armor` key in the catalog; `recomputeArmor` reads `armor_soak` only | `client/shared/tagCatalog.js` (no `armor`), `server/engine/commands/inventory.js:78-96` | — |
| Equip-eligibility = presence of `slot`, not `weapon` | Correct | `server/engine/commands/inventory.js:82-84` | — |
| Container storage: `player_inventory.container_id`, `AND container_id IS NULL` guard, contents travel with the container | Correct | `server/models/schema.js:146`, `server/engine/commands/inventory.js:273,286` | — |
| Contained items weigh 75% | Correct | `server/engine/commands/inventory.js:262` | — |
| By-id verbs `opencontainer`/`closecontainer`/`stowid`/`pullid`; text verbs `stow` (alias `put`) / `pull` / `look in` | Correct (`throw` is also an alias of `stow`) | `server/engine/commands/inventory.js:1189-1192`, `aliases.js:40-41` | — |
| Furniture containers default to 60000g | Correct | `server/engine/commands/inventory.js:824` | — |
| Rummage broadcast throttled to once per 30s per player; open/close always fire | Correct | `server/engine/commands/inventory.js:20-22,892-917` | — |
| Two `withArticle()` helpers with different casing rules | Correct | `server/engine/commands/inventory.js:224` (case-preserving) vs `world.js:169` | — |
| `container_error` / `container_view.notify` render into `#container-notify` | Correct | `client/game/index.html:1396`, `client/game/js/panels/container.js:29,79` | — |
| Weight displayed `g` under 1000, else `kg` | Correct | `server/engine/commands/inventory.js:216-220` | — |
| Dev-panel item list flags soak-less armor "⚠ no soak" | Correct | `client/devpanel/js/panels/items.js:150` | — |
| `drugs` table fields + `player_drug_state.doses_in_system` | Correct | `server/models/schema.js` (`drugs`, `player_drug_state`) | — |
| `server/models/temp/normalize-name-case.js` exists | Correct — but cut as narrative history (see below) | file present | — |

**Concision** — 245 → 250 lines. Cut classes applied: *narrative history* (the `normalize-name-case.js`
blockquote — the prose-case rule above it is the decision that still binds; how legacy rows got there is
git's business). The doc **grew** on net: the carry-cap correction, the `type` column row and the two
missing shapes are all contract material, and this doc was already tight — there was nothing else to trade
away. A doc getting longer is the right outcome when the only deletions available were of true statements.

**Flagged**

1. **Possible code bug — `text`-shaped tags can't be saved from the dev panel.** `itemTagWidget` renders a
   `text` tag as a raw-string textarea (`client/devpanel/js/panels/items.js:9`), but `readItemTag` sends
   every non-flag/int/enum/range/hot shape through `JSON.parse` (`:85`). `description` dodges this (it has
   its own field, `:280,294`), but `use_message`, `laced_drug` and the other `text` tags would throw
   `"<Label>: invalid JSON"` on save unless the author types a JSON-quoted string. **Question:** should the
   `text` case get its own branch returning `inputs[0].value` verbatim, or is quoting the intended authoring
   convention? Not fixed — this is a docs audit.
2. **`items.description` — read by whom?** `schema.js:124-126` asserts "vendor lists read description", and
   I repeated that in the doc on the strength of that comment. I did not find the read site. **Question:**
   is the `description` column genuinely still read, or is that schema comment itself stale and the column
   fully inert?

---

### `docs/tags.md`

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| Status header: "**Legacy columns were never dropped.** Phase 5 didn't happen: `is_stackable`, `is_unique`, `is_quest_item`, etc. still exist in `schema.js`" | **Wrong** — they were dropped in 2026-07; the items CREATE no longer names any of them | `server/models/schema.js:122-135` | Fixed — header rewritten to what survives (`description`/`type`/`flags`) |
| Implementation Order step 5 "**Drop legacy columns** — _not done._" | **Wrong** — same as above | `server/models/schema.js:122-135` | Section cut (shipped-plan changelog) |
| Status header: "content is restored from dev-panel `.sql` dumps. There is no checked-in `seed.js`" | **Stale** — CODEX (git) is the content path; the `.sql` dump is the escape hatch | `CLAUDE.md` Core Architectural Rules, `docs/content-pipeline.md` | Fixed — header no longer restates the content-pipeline rule at all |
| Name-collision: "`armor` is purely the integer damage-reduction tag" | **Wrong** — no `armor` tag exists; protection is the `armor_soak` statmap | no `armor` key in `client/shared/tagCatalog.js`; `server/engine/commands/inventory.js:88-92` | Fixed |
| Taxonomy table row `armor` \| int \| `effects.armor` | **Wrong** (same) — and the whole table duplicated `items.md`'s class-tag table while disagreeing with it | as above | Fixed — table cut, replaced by one line + link to `items.md § Class Tags`; the `fillable` storage contract (the one row not covered there) kept as prose |
| Engine cutover: "`recomputeArmor` sums `tags.armor`" | **Wrong** — it reads `armor_soak` and fans it across `covers` slots | `server/engine/commands/inventory.js:78-96` | Section cut (restated code + shipped plan) |
| `tagCatalog.js` exports "plus helpers `tagTargets(def)` / `tagAppliesTo(def, surface)`" | **Drifted** — those live in the sibling `client/shared/tagHelpers.js`; the catalog file explicitly says so | `client/shared/tagHelpers.js:14,23`; `client/shared/tagCatalog.js:485` (the "live in the sibling" note) | Fixed — called out as a separate file |
| `scope:'class'\|'instance'\|'furniture'` | **Incomplete** — `zone` is a fourth scope (and the header's own Zone-scope note contradicts this line) | `client/shared/tagCatalog.js` scope sweep (104 `zone` entries) | Fixed |
| `shape` is one of `text\|flag\|int\|enum\|range\|hot\|statmap` | **Incomplete** — `list` and `number` also | `server/engine/tags.js:92` | Fixed |
| "run `scripts/migrate-furniture-capability-tags.js` once to backfill the flags" | **Ghost** — no such file | `scripts/` listing | Fixed — sentence dropped; the transition-`OR` half is verified and kept |
| Furniture capability reads still use a transition `OR` | Correct | `plugins/bodily/index.js:35,873`, `plugins/cosmetic-machine/index.js:46`, `server/engine/commands/doors.js:221` | Kept, with `file:line` |
| Dev panel: "Rewrite `itemEditForm` and `saveItem` in `client/devpanel/index.html` (~1439–1489)… script tag ~line 158" | **Ghost/drifted** — `index.html` is 448 lines; the editor moved to `client/devpanel/js/panels/items.js:259,291`; the script tag is at `index.html:392` | as cited | Section cut (shipped implementation plan); the real path added to Critical Files |
| API: "the item INSERT still names the legacy columns — see `routes.js:1328`" | **Wrong** — the INSERT is `(id,name,type,weight,value,tags)` at `routes.js:1828` | `server/api/routes.js:1825-1841` | Fixed — rewritten with the real column list and the `validateTags` gate |
| Verification: "No automated test harness exists" | **Wrong** — `npm run test:regress` is the pre-deploy gate | `tests/regress.js`, `CLAUDE.md` | Section cut (one-time cutover checklist) |
| Write-time validation: `validateTags` in `server/engine/tags.js`, enforced in `itemTagsFor`; `content:lint` mirrors it; drift check `scripts/report-tag-keys.mjs` | Correct | `server/engine/tags.js:63`, `server/api/routes.js:1811-1823`, `scripts/report-tag-keys.mjs` | — |
| Zone scope: `zone-tags.js` `getZoneRadiation`/`isSanctuary`, `danger.js` `zoneDanger`, legacy zone columns dropped | Correct | `server/engine/zone-tags.js:11,21`, `server/engine/danger.js:60`, `server/models/schema.js:70-73` | — |
| Capability-gate rule; `hack_device` in all three sites; `contraband` honoured by jail | Correct | `server/engine/commands/doors.js:330`, `plugins/atm/index.js:18`, `plugins/jail/index.js:88` | — |
| Supertags: dev-panel-only template, `tagSupertags.js`, `GET`/`PUT /tag-supertags`, `ownTags` strips `__super`/`__own` | Correct | `client/shared/tagSupertags.js`, `server/engine/supertags.js`, `server/engine/tags.js:17-23` | — |
| ADR-0003 link resolves | Correct | `docs/adr/0003-tag-mechanism-unification.md` | — |

**Concision** — 224 → 146 lines (−35%). Cut classes applied: *duplicate source of truth* (the taxonomy
table — `items.md` owns the per-tag reference, and the copy was the one that drifted), *shipped
implementation plan / restated code* (Engine cutover, Dev panel, Schema, Implementation Order — four
sections describing a 2026-06 cutover as future work), *narrative history* (the Context section's
present-tense description of the pre-cutover 11-column world, and the "Decisions locked with the user"
list), *per-instance changelog* (three dated "Converged (2026-07)" / "was extended (2026-07)" paragraphs
collapsed into one worked example that keeps the live gotchas), *aspiration in an as-built doc* (the manual
Verification checklist). Preserved verbatim: the Pipe Wrench JSON block, the capability-gate rule and
litmus test, the `object_type` boundary, the supertag semantics, and the `?`-operator SQL trap.

**Flagged**

3. **The doc's frame is now wrong for its content.** `tags.md` was written as a design proposal and still
   opens with a status blockquote apologising for divergences; what's left after this pass is a reference.
   Retitling or re-framing it is a structural change, so I left it. **Question:** worth a follow-up to make
   it read as a reference from line 1, or is the status header still earning its keep?

---

### `docs/reference/land-taxonomy.md`

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| Terrain is "**not passability** (open water needs a `boat`-tag item via a separate gate)" | **Wrong** — the water move gate was removed; entering water is a swim, and a `boat`-tagged item only makes the crossing dry/free | `server/engine/commands/movement.js:85-89` ("there is deliberately no engine:water move gate anymore"), `plugins/swimming/index.js:67-74,137` | Fixed |
| Region SSOT = `regions` table (`id/name/base_terrain/grid_z`) + `zones.flags.region_id` | Correct | `server/models/schema.js` (`regions` CREATE) | — |
| Regions loaded into RAM at boot as `world.regions`, `getRegion`/`getAllRegions`, refreshed on `reloadMaps` | Correct | `server/engine/world.js:28,92-98,104` | — |
| Staged as `region_create` / `region_move` | Correct | `client/devpanel/js/core/staging.js:134`, `server/api/staging.routes.js:151` | — |
| District SSOT = `server/engine/districts.js` `districtFor(zone)`, keyed off zone-id prefix via `DISTRICT_PREFIX`, `flags.district` override, `hazard` fallback for lethal | Correct | `server/engine/districts.js:26,41,220-228` | — |
| Biome = `plugins/flight/biomes.js` `biomeOf`, honours `flags.terrain` via `TERRAIN_BIOME`, render-only | Correct | `plugins/flight/biomes.js:18,30,39,52-55` | — |
| Danger = `server/engine/danger.js` `zoneDanger(zone)` | Correct | `server/engine/danger.js:60` | — |
| `flags.water` exists on nothing; test with `zoneTerrain(zone)==='water'` | Correct | `server/engine/world.js:209-216` | Kept, collapsed to 4 lines + link |
| `flags.planner` / `bp_district` read by nothing at runtime | Correct — only `tools/zone-planner` references it | `tools/zone-planner/` | — |
| Zone PKs still read `zone_district_*` and must not be parsed for region/district | Correct | `server/engine/districts.js:223-228` (the prefix parsed is the *first* id segment, not the literal `district`) | — |

**Concision** — 105 → 99 lines. Cut classes applied: *one-off bug story* (the eight-line `flags.water`
duplicate-marker narrative — the trap is live because the `zoneTerrain` fallback still exists, so it
collapses to a rule plus a link to the doc that owns terrain), *duplicate source of truth* (same passage;
`systems-terrain.md` owns it and now carries the full version), *narrative history* (the intro's "caused
real confusion and a rename", and the rename blockquote trimmed to the scale fact that still binds).
Everything else in this doc is SSOT statements and confusion-traps — it earns its space almost line for
line.

---

### `docs/systems-terrain.md`

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| "passability is still governed by the separate `flags.water` boolean" | **Wrong, and self-contradicting** — the very next section says `flags.water` is on no zone, and there is no water move gate at all | `server/engine/world.js:209-214`, `server/engine/commands/movement.js:85-89` | Fixed — replaced with the swim path + the one gate that does exist (encumbrance) |
| `TERRAIN_TYPES` table = 14 canonical values | **Incomplete** — `dirt_road` (`#7d6236`) is a 15th palette entry, and it auto-tiles with `road` via `isRoadTerrain` | `client/devpanel/js/panels/maps.js:1028`, `server/engine/world.js:239` | Fixed — row added; the `TERRAIN_BIOME` "road is intentionally absent" note extended to `dirt_road` |
| `TERRAIN_TYPES` at `maps.js:994` | **Stale line** — `:1026` | `client/devpanel/js/panels/maps.js:1026` | Fixed |
| `zoneTerrain` at `world.js:222`; runway inference at "line 251" | **Stale lines** — `:204` and `:217` | `server/engine/world.js:204,217` | Fixed |
| `terrain` emitted at `world.js:880` and `movement.js:736` | **Stale lines** — `:921` (inside `getMinimapData`, which starts `:839`) and `:773` | `server/engine/world.js:921`, `server/engine/commands/movement.js:773` | Fixed |
| Terrain block "~`:989`"; `toggleTerrainMode` `:1014`; `terrainPanelHtml` `:1192`; `mapZoneTerrain` `:1025`; `toggleMoveBuildingMode` `:1224` | **Stale lines** — `:1026`, `:1093`, `:1521`, `:1108`, `:1616` | `client/devpanel/js/panels/maps.js` at each | Fixed (and `toggleNewBuildingMode` `:1698` added, previously unnumbered) |
| `apiMoveBuilding` at `routes.js:906` | **Stale line** — `:1153` | `server/api/routes.js:1153` | Fixed |
| `TOS_TERRAIN_FILL` `:2768`; `.mm-dock` `~:2555` | **Stale lines** — `:3517` and `:2816` | `client/game/js/panels/tablet-os.js:3517`, `client/game/styles.css:2816` | Fixed |
| `installRegionPlant` in `environment.js` | Correct (line added: `:2530`) | `server/engine/environment.js:2530` | — |
| Runways aren't a `flags.terrain` value; `RUNWAY_KEYS` writes `flags.runway` + `flags.icon`; `runwayFor()` reads it | Correct | `client/devpanel/js/panels/maps.js:1048-1052`, `plugins/flight/state.js:327` | — |
| The four wildlands surfaces are the only terrains keeping their marker glyph | Correct — `GLYPH_TERRAIN` is exactly `{scrub, redrock, ash, marsh}` | `client/game/js/panels/minimap.js:870` | — |
| `TERRAIN_BIOME` mapping list (incl. `marsh→badlands`, `road` absent) | Correct | `plugins/flight/biomes.js:30-37` | — |
| `districtBiome()` checks `TERRAIN_BIOME[flags.terrain]` **first** | Correct | `plugins/flight/biomes.js:55` | — |
| `park_feature` rides the flight cell as `pf`, live stream and baked snapshot | Correct | `plugins/flight/state.js:687`, `plugins/flight/snapshot.js:43` | — |
| Baked snapshot: `flightsim-world.json`, `POST /maps/flight-snapshot`, `scripts/snapshot-flight-world.mjs`, shared builder `plugins/flight/snapshot.js` | Correct | files present; `server/api/routes.js:284` | — |
| New Building: `templateForType`/`GENERIC` in `tools/lib/building-templates.mjs`; `authorUtilityRoom` in `tools/lib/utility-room.mjs`; `BUILDING_TYPE_ICON` | Correct | `tools/lib/building-templates.mjs:178,189`, `tools/lib/utility-room.mjs:117`, `server/engine/world.js:138` | — |

**Concision** — 199 → 196 lines. Cut classes applied: *per-instance changelog* (the "Commit `37805fd1`
painted concrete across 37 cells" paragraph, and the inline commit hashes `28315361` / `b3a184ac`),
*narrative history* ("the old interleaved 110px/16px gap-connector template is gone" — the live fact is the
current grid plus the untyped-tile fallback; "this changed with the wildlands/park work"). Net change is
small because most of what was cut was replaced by the corrected water section and the `dirt_road` row.

---

## Batch summary

The most dangerous stale claim in this batch is **`items.md`'s "There is no carry cap."** Every other error
here misdirects a reader; this one actively invites a bug. An agent adding an inventory-granting system —
loot drops, quest rewards, a vendor bulk-buy — reads that line, skips any weight check, and ships something
that can silently strand a player: the items go in fine (there is no acquisition gate, which is exactly what
makes the claim feel true), and then `engine:encumbrance` refuses every subsequent move with no way out but
`drop`. The claim is *locally* observable as true and *globally* false, which is the worst combination a doc
can offer. Its near-neighbour is `systems-terrain.md`'s "passability is still governed by the separate
`flags.water` boolean" — a gate that does not exist, naming a flag that is on no row, contradicted eight
lines later in its own document.

The pattern across this batch is distinct from batches 4 and 5. Those failed at doc-to-registry mirroring
and at conversion boundaries. **This batch failed at removal.** Every serious error is a doc describing
something that was *taken away*: the flat `armor` tag, the legacy item columns, `migrate.js`, the water move
gate, `flags.water`, the furniture-backfill script, the pre-split `index.html` editor. Additions get
documented because someone is proud of them; removals get documented only if the person deleting thinks to
grep the docs. `tags.md` is the extreme case — it spent a whole status blockquote insisting the legacy
columns were *never dropped*, which was a correction that later became the error. **A doc's confident
negative claims age worse than its positive ones**, because the code that would contradict them is code that
no longer exists and therefore can't be grepped for. Worth a specific habit: when deleting a column, a gate,
or a tag, grep `docs/` for its name before the commit — not after.

Line-count note: `tags.md` lost 35% and `items.md` gained five lines. That asymmetry is the point. `tags.md`
was a shipped design plan still narrating itself; `items.md` was already a tight reference that was simply
missing contract rows. Cutting for its own sake would have made `items.md` worse.

Next-batch order needs no change. One flag for whoever picks up `combat.md`: `items.md` and `tags.md` both
defer the armor story to it (`armor_soak` is "the only armor mechanism; the old flat `armor` int was
removed"), so `combat.md` is now the sole owner of that claim — worth checking it actually carries it.

---

## Batch 6 — `systems-overland-void-travel.md`, `systems-surveillance.md`, `systems-world.md`, `systems-survival.md`

All four classify as **as-built** (`systems-*.md`). The void doc is a hybrid — a workshopped design
carrying **BUILT** stamps — but the plugin shipped and is on `main`, so every stamped claim is
checkable and the unstamped prose is the design intent behind shipped code, not a proposal.

---

### `docs/systems-overland-void-travel.md`

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| Per-player state is four `player_flags`: `crossing_route` / `crossing_window` / `crossing_node` / a salt | **Ghost keys** — none of `crossing_route`, `crossing_node`, `crossing_heading` exist. The real set is five: `crossing_void`, `crossing_window`, `crossing_origin`, `crossing_instance`, `crossing_room` | `plugins/voidwalking/index.js:401`, `:415-419` | Fixed — corrected in the generator section, the DB-cost table, and the engine-work list |
| Relog re-derives your room "from the seed + `crossing_node`" | **Drifted** — relog re-derives the *instance* from `crossing_instance` and replaces you at `crossing_room` | `plugins/voidwalking/index.js:36`, `:689` | Fixed |
| "Net-new engine work (honest scope) — this is the part that does **not** exist yet" | **Stale status, inverted** — 7 of the 8 items are shipped; only the flight off-world read and the party extras are not | `plugins/voidwalking/plugin.json:5-6`, `server/engine/world.js:777-809` | Fixed — section retitled and collapsed to the two live contracts plus an honest not-built list |
| Adjacency graph is authored in the World Editor, with "the departure-gate tile per edge" | **Contradicts the doc's own BUILT text** — `VOIDS` is a plugin-side config keyed by `flags.region_id`; there is no gate tile and no World Editor mode | `plugins/voidwalking/index.js:63-82`, `:110` | Fixed — the stale scoping item deleted (the BUILT paragraph already states the real model) |
| Tablet chat "loses signal in the void" — written as unbuilt design | **Stale status** — built client-side: `showNoSignal` dead-app sheet, roaming reception pocket, tile flicker, and a Journey Map replacing the bigmap | `client/game/js/panels/tablet-os.js:2190-2207`, `:3399-3437` | Fixed — split into BUILT (signal loss) and not-built (the radio item) |
| `TILES_PER_ROOM` 90, `MIN_ROOMS` 5, `MAX_ROOMS` 15 | Correct | `plugins/voidwalking/index.js:152-154,166` | — |
| `ENCOUNTER_CHANCE` 0.45, detour 0.7 | Correct — a third tier exists, `HARD_ENCOUNTER_CHANCE` 0.85 for a seeded hard node | `plugins/voidwalking/index.js:230-232` | Fixed — hard node added |
| Void rooms carry `flags.lawless`; traces keyed by `(void_key, window, room_salt)` on `flags.void_salt` | Correct | `plugins/voidwalking/index.js:215,224`, `traces.js:7`, `server/models/schema.js:426-440` | — |
| `movement.edge` hook; `isMapRim` resolves the neighbouring coordinate | Correct | `plugins/voidwalking/plugin.json:6`, `index.js:110-126` | — |
| `registerTransientZone` / `removeTransientZone` / `isTransientZone` exported from `world.js` | Correct | `server/engine/world.js:777,802,809`, marker Set at `:29` | — |
| No entry verb; `voidwalk` serves only `cancel`/`say` | Correct — the plugin's own file header (`index.js:11`) still describes `voidwalk [heading]` as "the explicit verb"; that comment is the stale one, not the doc | `plugins/voidwalking/index.js:553-556`, `plugin.json:4` | — (flagged below) |
| Commands are `voidwalk`/`scrawl`/`sift`/`frontier` | **Incomplete** — `ready` is also registered; the muster is a ready-check every cohort member must pass | `plugins/voidwalking/plugin.json:5`, `index.js:463,544` | Fixed |

**Concision** — 674 to 633 lines. Cuts: per-instance changelogs (every `Regress NNNN/NNNN` count and
`branch void-travel` / `Slice N` label — that's git, and the branch is merged); narrative history (the
doc's own "the header below said DESIGN ONLY … corrected 2026-07-21" preamble; the salvage-rebalance
before/after table, keeping the shipped numbers and collapsing the two balance lessons into rules that
still bind); triple-stated facts (the eight-item scoping list restated what the BUILT stamps already
said — collapsed to the transient-zone and minimap contracts, which are stated nowhere else); and an
aspirational build-order suggestion for work already done.

---

### `docs/systems-surveillance.md`

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| Recording "banks a frame per 5s tick into `recording_buffer` (capped at `storage_limit`)" | **Contradicts the doc's own schema block**, which correctly calls both columns dead. The live buffer is in-memory `CameraBuffer`, capped by the `camera_buffer_lines` tunable (25) | `plugins/surveillance/index.js:644-646`; the only `recording_buffer` readers are broadcast's `media_cameras` (`plugins/broadcast/index.js:2554,4615`) | Fixed |
| Hub panel is `client/game/js/panels/surveillancehub.js` + `#shub-panel` markup | **Ghost file** — deleted; the doc says so 100 lines later but the design section still asserted it | file absent from `client/game/js/panels/`; the doc's own 2026-07-10 block | Fixed — superseded design section cut |
| "Circuit Breach minigame (`circuithack.js`, currently cosmetic-only)" | **Stale status** — wired for real in phase 4, as the same doc states below | the doc's own phase-4 text; `client/game/js/panels/circuithack.js` present | Fixed — cut |
| `CLIP` to `CHIP` exports the buffer to a `security_clips` row **and** an `item_datachip_<id>` | **Superseded** — `clip` writes the reel and `physicalizeClip` mints the chip under the possession model, stated correctly in the 2026-07-10 block | the doc's 2026-07-10 note; `plugins/surveillance/index.js` `physicalizeClip` | Fixed — cut the stale bullets, kept the current model |
| Crime registry ships "~31 crime keys" | **Off by one, and for an interesting reason** — 31 entries but only **30 distinct keys**: `public_intoxication` is declared twice | `server/engine/crimes.js:21` and `:38` | Fixed to 30 (the duplicate itself is flagged below) |
| `recording_buffer`/`storage_limit` on `security_devices` are dead columns | Correct | no reader anywhere; every grep hit is `media_cameras` | — |
| Sticky-cam TTL is 24 **game** hours, converted at point of use | Correct | `plugins/surveillance/index.js:49-51`, sweep `schedule('10m')` at `:2199` | — |
| Wanted constants: `DECAY_MS` 60000 (÷3 in a safehouse), `HUNT_RANDOM` 0.35, `APPREHEND_MAX` 3.5, `HEAT_MAX` 100 / `HEAT_PER_STAR` 8 / `HEAT_DECAY_PER_TICK` 0.35 / `HEAT_IGNITE_STARS` 3 | Correct | `plugins/surveillance/index.js:1104,1130,1273-1276,1395,2028` | — |
| Witness constants: `CAM_CATCH_BASE` 0.2 to `CAM_CATCH_MAX` 0.9 over `CAM_CATCH_RAMP_MS` 30s, `COP_CATCH` 0.9, `BYSTANDER_REPORT` 0.12, `camera_effectiveness` 0.5 | Correct | `plugins/surveillance/index.js:1736-1748,1780-1781` | — |
| Visibility ladder: `CAM_VIS_STEP` 0.18, `CAM_VIS_FLOOR` 0.10 | Correct | `plugins/surveillance/index.js:1759-1765` | — |
| `security_networks`/`security_devices`/`security_clips` in `SCHEMA_SQL`; the five seed scripts exist | Correct | `server/models/schema.js:1242,1251,1274`; `scripts/seed-surveillance-{gear,vendor,crafting}.js`, `scripts/seed-wanted-police.js` | — |

**Concision** — 497 to 442 lines. Cuts: three superseded design sections (Hub / Recording-to-datachip /
Counterplay) that the shipped-subsystem list and the 2026-07-10 note already own, and whose stale
copies were the ones asserting deleted files; a "Suggested additions" block of aspiration inside an
as-built doc (the one item that shipped — the dead-man tamper ping — is already documented in
subsystem 4); a "Resolved forks" closing summary restating the decision tables above it; and the
"phased build / shipped" scaffolding (the phase framing is history — the contracts inside it are not,
and were kept verbatim).

---

### `docs/systems-world.md`

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| "`cleanCorpses` (every 30s) expires corpses past their `expiresAt`" | **Ghost function plus wrong mechanism.** No `cleanCorpses` exists. `dailyMaintenance` deletes *every* corpse once per game-day; the 1-hour `expiresAt` that `createCorpse` stamps is read by nothing | `server/engine/gameLoop.js:421` (stamp), `:1270-1277` (wholesale delete), `:63` (`environment.dayRollover`) | Fixed — and the doc contradicted itself, since its own environment section already credited `dailyMaintenance` |
| `getMinimapData(centerZoneId, depth=4)` BFSes up to 4 hops | **Drifted** — signature is `(centerZoneId, depth = 8, viewer = null)`; every call site passes 8 | `server/engine/world.js:839`; callers at `server/index.js:909`, `server/engine/commands/movement.js:608` | Fixed |
| `MAP_WINDOW_HALF = 7` | **Wrong value** — 5 | `server/engine/commands/movement.js:685` | Fixed |
| Channel history "stored in `channel_history` table"; API is `saveChannelMessage` / `getChannelHistory(channelId)` | **Ghost table plus ghost function.** Table is `channel_messages`; the writer is the module-private `storeChannelMessage`; `getChannelHistory` takes a `player`, not a channel id | `server/engine/channels.js:22,126-148,152` | Fixed |
| Built-in channels are `#system` and `#arcnet` | **Incomplete** — a third, `#corp:<orgId>`, is membership-derived and deliberately outside `CHANNEL_DEFS`; adding a channel like it needs a `startsWith` branch, not a registry entry | `server/engine/channels.js:7-9,47-48,53,60-67` | Fixed — row added plus the how-to-extend note |
| Hololock hack gate is "carrying a hacking device (`item_hack_deck`)" | **Drifted** — the gate is the `hack_device` **capability tag**, any item; the lockout is 5 *game* minutes | `server/engine/commands/doors.js:325-334,404,473` | Fixed |
| `world = { zones, players, enemies, npcs, corpses, spawnTimers, apartments }` | **Incomplete** — nine more Maps (`doors`, `orgs`, `orgMembers`, `zoneControl`, `orgAssets`, `orgVentures`, `maps`, `furniture`, `regions`) plus the `transientZones` **Set** | `server/engine/world.js:12-30` | Fixed |
| Scheduler cadences are `10s, 15s, 30s, 45s, 1m, 5m, 30m, 24h` | **Incomplete** — `1s, 4s, 5s, 6s, 10m, 1h` also exist | `server/engine/scheduler.js:31-46` | Fixed |
| Scheduler section describes registration but not idle-gating | **Missing contract** — every callback is skipped while `hasActivePlayers()` is false; `{ runWhenEmpty: true }` is the opt-out. An agent adding a raw `setInterval` plus `query()` defeats Neon scale-to-zero | `server/engine/scheduler.js:22-24,56-60` | Fixed — added |
| `dropWords` validates one random pass and returns a different one | **Still true** — a live trap | `server/engine/sounds.js:58` vs `:61-62` | Kept (one line) |
| `sounds` table is authored but never read to emit; window `visibility_transmission` has no consumer | Correct — `sounds` reads are dev-panel CRUD only; `visibility_transmission` appears only in schema/routes/devpanel/content | `server/api/routes.js:3235-3236`, `:3060-3085`; `server/models/schema.js:342` | — |
| `ambientTick` 45s, ~40% of populated zones; `tickSpawns` 10s | Correct | `server/engine/gameLoop.js:50,53,629` | — |
| Exits accessors (`exitTargets`/`allExits`/`neighborZoneIds`/`primaryExits`/`addExit`/`removeExit`) | Correct | `server/engine/exits.js:20,29,43,55,69,78` | — |
| `MAX_CATCHUP_DAYS` 30; HVAC 20C at 2.0C/min; `INDOOR_PASSIVE_CONDUCTION` 0.01; `VISIBILITY_DIM` 0.35; `K_TEMP` 4; muffle 0.12 / 2 / 0.45 / 0.5 | Correct | `server/engine/environment.js:44,150-154,180,1905-1907`; `plugins/weather/index.js:231`; `plugins/audio/index.js:833` | — |
| `LW_TRUSTED_REP` 500; `BUILDING_TYPE_ICON` in world.js plus `BLDG_TYPE_3D` in windshield.js; zone-planner on 5178 | Correct | `plugins/doors/index.js:69`; `server/engine/world.js:138`, `client/game/js/panels/windshield.js:2815`; `tools/zone-planner/serve.mjs:26` | — |

**Concision** — 425 to 431 lines. This doc was already tight; the correctness repairs (the world-state
block, the channel table, the scheduler gate) added more than the cuts removed. Cuts applied: one bug
story ("the old set checked values that didn't exist"), one changelog parenthetical ("the old flat
rate"), and the seven-line before/after account of the pre-2026-07-21 temperature roll — collapsed to
the one sentence of rationale that still binds ("the autocorrelation is the point").

---

### `docs/systems-survival.md`

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| Radiation accrues **on zone entry** via `commands/movement.js`, `floor(radiation x 0.1)` | **Removed from the code entirely.** Exposure is now positional: `irradiatedGround` (a `radiation` tag > 0, *or* a `flags.void_crossing` room) trickles **+1 every 10 min** and suspends decay | `server/engine/commands/movement.js:502-504` (explicit "no longer accrues on movement"), `server/engine/gameLoop.js:363-394` | Fixed — bullet rewritten |
| Bodily: "Natural decay: -1 digestive / -2 hydration per minute" | **Wrong** — there is no natural decay, by design; only relief or the >110 overflow valve lowers the load | `plugins/bodily/index.js:121-123` | Fixed — plus the undocumented involuntary-fart ramp from 60 |
| "Known bug: the live player object doesn't copy `visibly_mutated`, so the outcast/turret mechanic resets on reconnect" | **Fixed in code** — the login object copies it | `server/index.js:744` | Fixed — stale bug note deleted |
| Hunger/thirst decay "gated on `_tickCounter`", real minutes, "~5 hours" | **Drifted** — gated on `_thirstAccum`/`_hungerAccum` fed by game-minutes (`_gmAccum` times `getTimeScale()`); `_tickCounter` only rate-limits flavour. The hour figures are **game** hours and scale with the speed knob | `server/engine/gameLoop.js:907-913,922-930,1050` | Fixed |
| Sleep eligibility is home / sanctuary / someone's unlocked apartment / else nothing | **Incomplete** — a fourth branch, `allowsSleep(zone)` (a holding cell), grants the shallow restore with no sanctuary protection | `server/engine/apartments.js:713-718` | Fixed |
| Status effects are the four engine effects; ashfall is the "first caller"; weapon/overdose wiring "the next intended use" | **Stale** — `registerStatusEffect` is a plugin seam and four plugin effects are live (`refreshed`, `sick`, `exhausted`, `drowning`); ashfall is one caller among several | `server/engine/effects.js:16-19`; `plugins/bodily/index.js:759,823`, `plugins/weightbench/index.js:161`, `plugins/swimming/index.js:197` | Fixed |
| Body-temp tick reads `insulation` / `exposurePenalty` / `wetness` — "the three must agree" | **Incomplete** — a fourth field, `player._submerged` (swimming plugin), reroutes ambient to `waterTemperature()` and forces full wetness | `server/engine/gameLoop.js:979-989` | Fixed — one line plus a link to the doc that owns it |
| `irradiated` effect "defined but currently inert" | Correct — nothing calls `applyEffect(..., 'irradiated')` | `server/engine/effects.js:43-50`; no caller | — (wording tightened) |
| `THIRST_DECAY_INTERVAL_MIN` 3 / `HUNGER_DECAY_INTERVAL_MIN` 4; starvation -1 HP, dehydration -2 HP | Correct | `server/engine/gameLoop.js:753-754,939-940` | — |
| Body temp: `COLD_THRESHOLD` 10 / `HOT_THRESHOLD` 35, drift `0.002 x diff^1.75`, clamp 25-45, -10 HP after 5 continuous min, cold band 30-34, hot band 40-42 | Correct | `server/engine/gameLoop.js:994-1046` | — |
| Sleep restores 18/15/50 (home) and 8/5/35 (shallow); `SLEEP_MAX_MINUTES` 30 | Correct | `server/engine/apartments.js:312-313,320,886` | — |
| Mutations: `tick.minute` hook, `radiation >= 40` gate, 5%/min roll; turret 6-14 dmg on an 8s cooldown, floored | Correct | `plugins/mutations/index.js:20-22`, `server/engine/mutations.js:35-42`, `server/engine/commands/describe.js:578-587` | — |
| Sanity bands 25-49 / below 25 / at-or-below 0, with hysteresis at 10 | Correct | `plugins/sanity/index.js:39-41,206-208` | — |
| Clothing wetness: `gets_wet` tag, `baseDryRate` 3 indoors / 2 outdoors, thresholds 25/50/75/100 | Correct | `plugins/clothing-wetness/index.js:63,84-91` | — |

**Concision** — 358 to 359 lines. Essentially flat: this doc's bulk is contract-and-why (the drug
ledger, the polydrug ceiling, the relapse law) and earns its space. Cuts were three narrative-history
clauses inside otherwise-load-bearing bullets ("not the old flat -1/min step"; the
`sanity_regen_per_sec` bug story, kept as the forward-facing rule "never route them through
`applyMods`"), plus the stale `visibly_mutated` bug box. The correctness rewrites (radiation, status
effects) added back what the cuts removed.

---

### Index

`systems-overland-void-travel.md` was **absent from CLAUDE.md's key-docs list entirely**, despite
`plugins/voidwalking/` being shipped and owning two engine seams (`movement.edge`, the transient-zone
substrate) an agent can trip over without ever reading the doc. Added, positioned after the
surveillance entry. The three other batch docs' index hooks were checked against the docs and are
accurate; `docs/audits/README.md` already indexes this findings file. No other index drift.

---

### Flagged — decisions needed

1. **Duplicate crime key (code bug).** `server/engine/crimes.js` declares `public_intoxication` twice —
   `:21` and `:38`. The second silently overwrites the first, so the richer definition (label "Visibly
   wrecked in public", plus the deliberate "charges at most once every few minutes however long you
   stay out there" semantics) is dead and the terse `:38` entry is what ships. Both are
   `stars: 0.5, witness: 'any'`, so nothing is *currently* mis-charged — but the surviving row is the
   one nobody meant to keep. **Question: delete `:38` and keep the richer `:21`?** I have not touched
   code.
2. **Corpses ignore their own TTL (code bug, previously filed).** `createCorpse` stamps
   `expiresAt = now + 1h` (`server/engine/gameLoop.js:421`) and nothing ever reads it; corpses persist
   until `dailyMaintenance` wipes them wholesale at the game-day rollover. At `time_scale` 3 that is up
   to ~8 real hours of corpses, and the DB row carries a column that lies. This is item 1 of
   `findings-2026-07.md`'s remaining list and is still open. **Question: restore a per-corpse sweep, or
   drop `expires_at` and document the daily wipe as the intended law?** The doc now describes actual
   behaviour either way.
3. **Stale file-header comment in the voidwalking plugin.** `plugins/voidwalking/index.js:11` still says
   "`voidwalk [heading]` — the explicit verb, from anywhere in a void-region", contradicting `:553-556`
   and `plugin.json:4`, which correctly state there is no entry verb. Docs-only audit, so I left the
   comment alone. **Question: correct it on the next code touch?**
4. **`systems-surveillance.md`'s "Confirmed decisions (2026-07-01 review)" table.** It is decision
   history, which the concision rules cut on sight — but every row is a policy that still binds
   (deploy-anywhere, no no-plant flag, all three counterplay modes, both hub deliveries), stated more
   compactly than prose would. I kept it. **Question: right call, or should the still-binding rows fold
   into the pillars list and the table go?**
5. **The void doc's `[[project_*]]` wiki-links.** Eleven of them (`[[project_wildlands_curtain]]`,
   `[[project_the_reach]]`, `[[project_tablet_chat_app]]`, and others) resolve to nothing in this repo
   — they look like links into an external vault. They are consistent with several other docs, so I did
   not touch them, but they are unresolvable ghosts to an agent reading only the repo.
   **Question: deliberate external-vault convention, or convert them in a later batch?**

---

## Batch 6 summary

The single most dangerous stale claim is **`systems-survival.md`'s radiation model**. The doc described
exposure as a one-shot `floor(radiation x 0.1)` hit on zone *entry*, applied in `commands/movement.js`.
That code is gone — `movement.js:502-504` says so in as many words — and the model inverted: exposure
is now *positional and continuous* (`irradiatedGround`, +1 per 10 minutes, decay suspended while you
stand on hot ground). The two models disagree about the thing content authors actually tune. Under the
documented one, a `radiation: 30` tile costs 3 RAD to walk through and nothing to camp in, so an author
making a rad zone bite would raise the tag. Under the real one, that tile is *unbounded* — it trickles
to 100 and holds you there — and raising the tag changes nothing about the rate, only the danger chip.
An agent balancing a hot zone against this doc would tune the wrong lever in the wrong direction, and
the failure stays invisible until a player parks in a hot room and mutates.

A pattern worth naming, because it produced four of this batch's worst findings: **the docs were right
about the mechanism and wrong about the trigger.** Radiation still exists — it moved from
entry-triggered to presence-triggered. Corpse cleanup still exists — it moved from a per-corpse sweep
to a wholesale daily wipe. Bodily load still drains — except it doesn't, and never did. The hololock
still needs a deck — but the gate moved from an item id to a capability tag. In every case the doc's
*noun* survived and its *verb* changed, which is exactly the drift a reader skims past: the paragraph
still looks correct because the subject is still there. Wherever a doc says "on X, do Y", the check
that pays is grepping for the firing site, not the constant.

Next-batch order needs no change, but one adjacency is now worth pulling forward. This batch corrected
the `hack_device` gate in `systems-world.md` and found `docs/tags.md:110` already announcing that
convergence — so `tags.md` was right and the systems doc lagged. Where a capability-tag conversion has
happened, `tags.md` is the doc that knows; anything re-stating a gate should be checked against it
rather than against the code twice. Both `systems-atm.md` (still naming `item_hack_deck` at `:121` and
`:138`) and `systems-jail.md` (`:129`, `:168`) carry the same now-stale id and belong in a batch
together.

---

## Batch 7 — flight docs: `systems-flight.md`, `reference/world-rendering.md`, `reference/Cockpit_Design_Reference.md`, the four `reference/*_Implementation.md`

Classification: `systems-flight.md` and `world-rendering.md` are **as-built** (every claim
checkable). `Cockpit_Design_Reference.md` and the four `*_Implementation.md` are
**author-direction** — only their ship-status is auditable, and the prose specs were left alone.

---

### `docs/systems-flight.md`

**Correctness** — wrong claims first.

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| Takeoff/landing are interactive server-authoritative minigame decks (`flight_takeoff`→`takeoffresolve`, `flight_land`→`landresolve`, VTOL collective+cyclic deck) | **Dead path.** `cmdTakeoff` returns "no command needed" for any continuous craft, and *all nine* airframes are continuous — no player can reach these decks | `plugins/flight/index.js:688`; `plugins/flight/state.js:93` (`CONTINUOUS_TYPES` = all 9); `index.js:1363-1366` ("No banded/server-side flight model any more") | Fixed — section replaced with the continuous client-sim/server-reconcile contract; decks demoted to a flagged legacy note |
| Real-time tick loop *is* the flight model (advance → burn → thermal → starve) | **Drifted.** The model is the 60 fps client integrator; `flightTick` owns fuel/hazards/noise/persistence only, and `reconcile` clamps client telemetry | `client/game/js/panels/flight-model.js`; `plugins/flight/state.js:928` (`reconcile`); `index.js:819-823` | Fixed |
| Six airfields (Threshold 0,0 · Coldwater −2,0 · Marshalling 7,−1 · Slagworks −8,0 · Redline −5,−6 · Smuggler's Slip 4,−3) | **Four exist**, on the relocated ~900 grid. Marshalling/Slagworks/Redline/Smuggler's Slip are gone; Buzzard Field and the Echelon pad are new | `content/zones/zone_district_893_909.json`, `zone_district_925_903.json`, `zone_echelon_exterior.json`, `zone_the_reach_870_1958.json` | Fixed — table rebuilt with real `airfield_id` + zone id + coords |
| Contracts draw from an authored in-code table `JOB_TYPES` | **Ghost.** `JOB_TYPES` no longer exists; archetypes are `quests` rows with `quest_type='flight_template'` | `plugins/flight/contracts.js:42`; `scripts/migrate-flight-job-types.js:1-6`; no `JOB_TYPES` anywhere in `plugins/` | Fixed (twice — also in the `KITS` comparison) |
| Charter fare is charged at `embark`; cancelling pre-embark refunds "`ch.paid`, normally 0" | **Inverted.** The fare is charged at *booking* | `plugins/flight/charter.js:287-288, 303-305, 317-319` | Fixed |
| `charter <ride>` offers a numbered airport list; map-click pushes `flight_pick_dest` | **Ghost message type.** `flight_pick_dest` exists nowhere in the repo. `charter` pushes `charter_open` (a dialog); the dialog sends `charterbook <destZoneId> [any]` | `plugins/flight/charter.js:277, 285-289, 729`; `client/game/js/dispatch.js:662`; grep `flight_pick_dest` → 0 hits | Fixed |
| Charter lists passenger-capable aircraft (seats ≥ 2) at 10× the hourly rate | **Drifted.** Fixed Mule (airfield) vs Dragonfly (`any`); fare = `90 + 6×dist`, ×2 for anywhere, rounded to 5c | `plugins/flight/charter.js:54-55, 74-78, 298` | Fixed |
| Unclaimed charter expires in **2 min** | **Wrong value** — `HELD_EXPIRY_MS` = 30 min | `plugins/flight/charter.js:51` | Fixed |
| Three charter pilots, one per field (Doyle @ Coldwater, Soto @ Marshalling, Kessler @ Smuggler's Slip) | **Four pilots, and three of them share one field.** Doyle/Soto/Kessler all carry `charter_pilot.field = zone_district_925_903`; Wren Halloran works the Echelon | `content/npcs/npc_charter_{doyle,soto,kessler,echelon}.json` (`flags.charter_pilot`); `plugins/flight/charter.js:63-68` | Fixed (see Flagged #1 — the sharing is a live bug) |
| Eight aircraft types seeded | **Nine** — the Viper (swarm airframe, referenced later in the same doc) was missing | `content/aircraft_types/` (9 files); `plugins/flight/state.js:93` | Fixed |
| Three ground AA sites (Redline/Wastes/Slagworks) | **Four** — `aa_clone_guard` added | `content/aa_sites/` | Fixed |
| Illegal jobs at lawless fields "Slagworks, Redline, Smuggler's Slip" | **Only Buzzard Field** carries `airfield_lawless` | `content/zones/zone_the_reach_870_1958.json` | Fixed |
| `BREAKUP_MS` ≈ 1.9 s | **3.4 s** | `client/game/js/panels/cockpit.js:3269` | Fixed |
| `extZoom` floor lowered to 0.30 | **0.15** (the code comment records the later `0.30→0.15` change) | `client/game/js/panels/windshield.js:492` | Fixed |
| "the server's own `MSL_STAGGER_MS` (120 ms)" | **Name is client-side only**; the server uses a bare `i * 120` | `client/game/js/panels/cockpit.js:1110`; `plugins/flight/combat.js:250` | Fixed |
| Content lives in `scripts/seed-flight.js` / `scripts/seed-hangar-interiors.js` (all 6 fields); Go-live = `db:schema` + `node scripts/seed-flight.js` + "stand in The Marshalling Yard" | **Retired path.** Flight content is CODEX (`content/aircraft_types/`, `content/aa_sites/`, `content/zones/`); `seed-hangar-interiors.js` still names six pre-relocation zone ids that no longer exist (`zone_yard_marshalling`, `zone_slag_gate`, `zone_waste_scald`, `zone_dock_slip`) | `scripts/seed-hangar-interiors.js:19-26` vs `content/zones/`; CLAUDE.md content-pipeline rule | Fixed — Go-live + Files sections cut, content pointers redirected |
| Verb list is `board`/`startup`/`throttle`/`heading`/`climb`/`dive`/`takeoff`/`land`/`refuel` | **~15% of the surface.** The manifest declares ~80 verbs (`checkride`, `nav`, `circle`, `landat`, `divert`, `taxi`, `takecontrols`/`handoff`, `jettison`, `freightlicense`, `loadout`, `paintset`, `sell`, `cancelrental`, …) | `plugins/flight/plugin.json:5-13` | Fixed — points at the manifest as SSOT rather than restating it |
| "There is **no cabin `zones` row**" | **Has an exception now.** The Leviathan's interior is authored content that occupants walk on foot | `plugins/flight/state.js:1077-1093` (`WALKABLE_CABINS`, `isCabinZone`); `content/zones/zone_leviathan_{cabin,flightdeck,galley,hold}.json` | Fixed — the no-*runtime*-rows rule kept, the walkable-cabin carve-out added |
| Plugin layout enumerates every module | **Two missing:** `checkride.js`, `snapshot.js` | `plugins/flight/` listing | Fixed |
| Verb-collision routers | **Incomplete** — `after` also lists `interactions` and `quests`; `look` and `sell` also collide | `plugins/flight/plugin.json:38`; `plugins/interactions/plugin.json`, `plugins/gametable/plugin.json`, `plugins/commerce/plugin.json` | Fixed |
| `state.reconcile`, `effStats`, `surfaceAt`, `fieldFor`, `vtolOnlyField`, `syncPilots`, `boardPilot`, `charterParkedAt`, `breakOffAttackers`, `overflyNoise`, `checkAirspace`, `groundStop`, `applyAirDamage`, `shearRoll`, `contactsNear`, `tickMissiles` | Correct | all resolve in `plugins/flight/*.js` | — |
| `GUN_DMG` / `MISSILE_PK` / `FLARE_DEFEAT` / `SWARM_*` / `GROUND_SWARM_*` / `TUNE_DIAL_MAX` all live in `state.js` | Correct | `plugins/flight/state.js:46-83` | — |
| `PEDALS_HTML`/`wirePedal`/`fsimFrame`, `beginCrashBreakup`/`stepCrashBreakup`, `shedPartFor`/`shedVert`, `surfaceBreakup`, `launchShots`/`stepShots`/`drawMissiles`, `chinGun`, `missileRippleFx`/`gunFx`, `computeAxesClient`, `mountHud` | Correct | `client/game/js/panels/{cockpit,windshield,engine-audio,hangar-bay}.js` | — |
| `szFac` floor 0.46; `orbRcam = orbR * (1 + topFrac*1.4)` | Correct | `windshield.js:491, 513` | — |
| Piloting skill (tech, Reflexes+Brains); `aircraft`/`aircraft_types` in `SCHEMA_SQL`; `aircraft_types.engines`; `GET /flight/debug`; `.testfly`; parachute-gated bail; `GROUND_STOP_SEVERITY = 0.7` vs `WIND_MOVE_SEVERITY` | Correct | `server/engine/skills.js:25`; `server/models/schema.js:1705,1724,1734`; `plugins/flight/index.js:1924,1612,676-679`; `hazards.js:32`; `server/engine/commands/movement.js:28` | — |

**Concision** — 550 → 495 lines. Classes applied: per-instance changelog (four commit SHAs as
section headings, the "Chase-camera & button polish" bullet list, the whole "Files" section);
narrative history (the pre-2026-07-20 `airfield_rental` parenthetical, "previously boost was a
strict-loss no-op", the "Five Yards pairs were resolved" framing); triple-stated facts (the "What
Phase A gives you" + "Live content" pair restated a table two paragraphs above and contradicted it;
"The glass cockpit" restated the instrument list a third time); aspiration in an as-built doc (the
"Still lighter / follow-on" roadmap — the blueprint owns it); stale scaffolding (Go-live steps).
Phase-labelled headings ("Phase B —", "Phase D —") were relabelled by system, since the phases no
longer distinguish anything. Glyphs verified after save: UTF-8, no BOM, all preserved.

---

### `docs/reference/world-rendering.md`

Nearly clean — 48 of 52 named symbols resolve exactly as documented, including all three "tower"
renderers, the whole `draw3DBoxAt`/`drawFacetDrum`/`drawBarrelRoof` primitive set, the
`bakeSignText`/`drawSurfaceText` rule, `decoDepth`/`DECO_LIFT`, the `NAMED_MODELS` roster and the
runway-vs-helipad switch. Four defects:

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| Queue decorations at `ON_TOP` (−∞) for glows/lights (stated 3×) | **Ghost identifier** — `ON_TOP` exists nowhere in `client/`, and the advice contradicts the `decoDepth` bullet directly above it | grep `ON_TOP` in `client/` → 0 hits; `windshield.js:3135` (`decoDepth`) | Fixed — every `ON_TOP` reference replaced with `decoDepth` |
| Airfield ID + distance tags are drawn by `drawFieldMarker` | **Ghost function** — the tags are drawn inline off `v.airports` on the heading tape | grep `drawFieldMarker` → 0 hits; `windshield.js:1642-1676` | Fixed — cited the real site; the billboard/surface rule itself is correct |
| Cell payload carries `icon` | **Wrong key.** `icon` is the *zone flag* the server reads; the payload key is `rd` (road-piece connector). `ft`, `flr` and `danger` were also undocumented | `plugins/flight/state.js:687` (the `row.push`), `:669-679` | Fixed — payload list corrected, `state.js:687` cited as SSOT |
| Dev server sends JS `Cache-Control: no-cache`, so "a correct browser never shows stale JS" | **Drifted.** Only `.html` is `no-cache`; JS/CSS get `public, max-age=60` | `server/index.js:254` | Fixed — the up-to-60s window is now stated before the exotic causes |
| `mapWindow` radius 36; ATC tower built into `case 'hangar'`; `drawATCTower` lives in `aircraft3d.js` | Correct | `plugins/flight/state.js:593`; `windshield.js:301`; `aircraft3d.js:2258` | — |

**Concision** — 274 → 276 lines (net +2: the correctness fixes to the payload list and the cache
gotcha cost more than the cuts saved). Classes applied: one-off bug story collapsed to its live trap
(the shared-face-queue and decoration-depth paragraphs each carried a past-tense "used to / was"
narration; both now state the rule and the failure mode in the present); dated changelog framing
removed from the twin audit while keeping the model names, which are contract.

---

### `docs/reference/Cockpit_Design_Reference.md` — author direction

Prose specs untouched. Two status defects:

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| "Save the supplied image at that path so the link below resolves" | Already saved | `docs/reference/cockpit-ref-diamond-da42.png` | Fixed |
| "Today the Mayfly cockpit shows digital IAS/ALT/VS/HDG boxes + a small ADI", and the mapping table's ⚠️/❌ rows for VSI/HSI, tapes, master caution, switch rows | **Understated by a full PFD.** `paintPFD` draws a banking attitude ball with a ±30° pitch ladder, airspeed/altitude tapes with Vr/Vne/Vs0 marks, a VSI bar, a heading box and a slip/skid ball; `paintGauges` draws the annunciator tiles and gear/flap state; flap detents and PANEL/LIGHTS switches exist | `cockpit.js:4186-4230` (`paintPFD`), `:4349` (`paintGauges`), `:1049-1051` (flap detents), `:2450` (LIGHTS), `:3752` (gear state) | Fixed — status stamp added at the top; mapping table rewritten row by row. Genuinely outstanding: roll scale arc, HSI/compass strip, MFD engine strip, breaker texture, guarded master |

**Concision** — 169 → 170 lines. No cuts: this is a vision doc, and its prose is the deliverable.

---

### The four `reference/*_Implementation.md` — author direction

None carried a status stamp; all four are substantially shipped, and one made a claim about its own
structure that was never true.

| Doc | Ship status | Evidence | Action |
|---|---|---|---|
| `Flight_Implementation.md` | **Shipped** — all 8 milestones. "Remove separate phases. Fly entirely from cockpit" is exactly what `CONTINUOUS_TYPES` did | `plugins/flight/state.js:93`; `index.js:688, 819-823` | Stamp added |
| `Rendering_Implementation.md` | **Shipped** — Mode-7 world, biomes, building archetypes, terrain, roads, airport surfaces | `client/game/js/panels/windshield.js`; `plugins/flight/biomes.js` | Stamp added + pointer to the as-built `world-rendering.md` |
| `Sound_Implementation.md` | **Mostly shipped** — per-class FM beds, starter→catch→idle arc, slipstream, `groundFx`/`gearFx`/`flapWhir`/`stallHorn`, weather beds. Not built: surface-dependent rolling variants, icing/electrical texture | `client/game/js/panels/engine-audio.js:42-50, 372-392, 471-522, 712` | Stamp added |
| `Weather_Implementation.md` | **Half shipped, and the half that matters is missing.** Visuals + the severity tax exist; `flight-model.js` takes **no wind vector at all**, so crosswind drift, gusts-as-force, turbulence-as-force, icing, density altitude, wind shear, thermals and microbursts are unbuilt, as is the "one atmosphere field" architecture | grep `wind`/`gust`/`turb`/`icing`/`shear`/`microburst` in `flight-model.js` → no wind input (comments only); `plugins/flight/hazards.js` (`getZoneSeverity` buffeting); `index.js:676-679` (`GROUND_STOP_SEVERITY`) | Stamp added |
| `Weather_Implementation.md`: "see the 'as-built' notes below each section" | **Ghost self-reference** — there are no such notes | the doc itself | Fixed — replaced with the single status block |

**Concision** — Flight 67→73, Rendering 56→62, Sound 55→63, Weather 162→172. All growth is status
stamps; the direction prose is untouched by design.

---

### Index drift

| Line | Verdict | Action |
|---|---|---|
| CLAUDE.md:22 (`systems-flight.md` hook) — "aircraft, airfields, hazards … (as built)" | Silent on the one thing an agent most needs to know before touching flight: there is only one flight model now | Fixed — hook names the four airfields and the continuous-only model, and warns the minigame decks are unreachable legacy |
| CLAUDE.md:24 (`world-rendering.md` hook) | Every symbol in it verified (`drawWorldObjects`, `modelFor`, `drawTypeModel`, `NAMED_MODELS`, `TYPE_MODEL`, `draw3DBoxAt`, `WALL_COL`, `ty_*`, the three tower renderers, ATC-in-`hangar`) | Left alone — correct |
| `Cockpit_Design_Reference.md` + the four `*_Implementation.md` are in no index | They are linked from `systems-flight.md`'s header, but appear nowhere in CLAUDE.md's key-docs list | **Flagged #4** — adding five vision docs to a key-docs index is a judgment call, not a mechanical fix |

---

### Flagged — decisions needed

1. **Code bug: two of the three Coldwater charter pilots are unreachable.** `pilotForField` is a
   bare `.find()` on the field id with no shift filter (`plugins/flight/charter.js:98-100`), but
   Doyle (`shift_start` 0), Soto (8) and Kessler (16) all carry
   `charter_pilot.field = zone_district_925_903`. The first match in `getNpcsByFlag` order wins
   every lookup, so Coldwater's charter desk reads as closed for 16 hours a day and Soto/Kessler
   never take a booking. The doc's "each pilot works one field" design is what the code assumes.
   **Question:** should `pilotForField` prefer the on-shift pilot, or should the three be
   redistributed back across fields as content? (Not fixed — this audit does not touch code.)
2. **`scripts/seed-flight.js` and `scripts/seed-hangar-interiors.js` are dead.** Both target the
   pre-relocation zone ids (`zone_yard_marshalling`, `zone_slag_gate`, `zone_waste_scald`,
   `zone_dock_slip`) and both predate the CODEX cutover. I removed the doc's pointers to them.
   **Question:** delete the scripts, or keep them as a record of the original seeding?
3. **Four of the six documented airfields no longer exist, and nothing announced it.**
   `scripts/phase6-relocate-flight.mjs` moved the world; no flight doc was updated. The lawless-job
   economy, the charter shift roster and the AA-site placement were all written against the old
   roster. **Question:** were Marshalling / Slagworks / Redline / Smuggler's Slip intentionally
   dropped, or are they pending re-placement on the new grid? If pending, the contracts section's
   "honest vs lawless field" split is currently a one-field system and worth a note.
4. **Index: should the five author-direction reference docs join CLAUDE.md's key-docs list?**
   They are reachable only through `systems-flight.md`'s header. Batch 6 found the same failure mode
   for proposals — unindexed docs go stale because nobody reopens them.
5. **The legacy minigame decks are a large block of unreachable client + server code**
   (`flight_takeoff`/`flight_land`/`takeoffresolve`/`landresolve`/`openVtolLift` and their dispatch
   routes). I documented them as unreachable rather than deleting the doc text entirely, since
   `flight-unified-model.md` lists "Ship 3 (optional vocab tidy)" as pending. **Question:** is Ship
   3 the deletion pass, or is the legacy path deliberately retained?

### Batch summary

The most dangerous stale claim is **"Takeoff & landing are interactive, server-authoritative"** — a
detailed, confident, ~40-line specification of two minigame decks and a VTOL deck that no player can
reach, because `cmdTakeoff` bounces every continuous craft (`index.js:688`) and all nine airframes
are continuous (`state.js:93`). It is the worst shape a doc error can take: not a missing fact but a
*fully-specified wrong one*, complete with message types, token handshake and fail modes. An agent
asked to "fix the landing flare" would have found `landresolve`, edited it, tested nothing, and
shipped a change to dead code. The banded model was replaced in `flight-overhaul.md`, unified in
`flight-unified-model.md`, and the as-built doc was never told — the proposals carried the news and
the doc that agents actually read did not.

The cross-cutting lesson is the same one Batch 6 found from the other side: **`systems-flight.md`
went stale in exactly the places where a proposal shipped.** Every major defect here — the model,
the airfield roster, the charter flow, `JOB_TYPES` — traces to a landed change whose implementation
log lives in `proposals/` while the as-built doc kept the pre-change text. The `codex` exit gate
already reopens the proposal; it should reopen the as-built doc in the same step.
`world-rendering.md`, by contrast, was already correct and tight — its four defects were all
identifier-level, and it needed no structural work.

Batch order should change: **`docs/systems-helm.md` next.** It reuses `paintWindshield` and
`surfaceBreakup` from the same renderer, is described in CLAUDE.md as a "flight-renderer-reuse chase
cam", and its `flags.airfield_*` neighbour (the Echelon pad) is one of the two airfields that
*replaced* the four this batch found missing — so it sits directly on the relocation seam and on the
renderer contract this batch just corrected.

---

## Batch 8 — C3 · Intent & background: `design.md`, `story.md`, `roadmap-world-expansion.md`, `reference/hellmoo-combat-reference.md`, `reference/plugin-architecture-analysis.md`

C3 · Intent & background. All five classify as **proposal / vision / author-direction**, so the
correctness question is the **status stamp**, not conformance to the implementation. Nothing was
"corrected toward the code": design intent was left standing wherever it was still intent. What got
fixed is where a doc asserts a *fact about the build* — "As Built", "not yet built", "currently only
one exists", "nothing here is built", an open question the engine has since answered.

One fact governs the batch and lands in three of the five docs: **the world was built.** `map_world`
spans **93 × 100 grid cells holding 5,439 outdoor zones** (measured over `content/zones/*.json`,
2026-07-24), after the district world replaced the legacy 358-zone overworld on 2026-07-11.

---

### `docs/design.md`

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| **"Map Shape (As Built)"** — a nine-tile hub-and-spoke city: The Threshold + 8 safe tiles, Franchise Strip → Embassy Hotel, Rust Quarter West → Static Wood → Coldwater Power Station | **Wrong, and it says "As Built"** — Franchise Strip, Rust Quarter West, Static Wood and Coldwater Power Station return **0** zone files each; the map is 93×100 / 5,439 outdoor zones | `content/zones/` name sweep (4 × 0 hits); grid extents computed over 5,439 `map_id:"map_world"` files; `c1f964e5` (2026-07-11 overworld delete) | Fixed — section restamped with the measured scale and pointed at `land-taxonomy.md` / the roadmap; the design intent ("legibility over sprawl") kept |
| "Darkness is atmosphere, not (yet) a threat … it doesn't currently hide exits, items, or enemies" | **Wrong** — `LIGHT_GATE` hides items at `gloomy`; items, hostiles, corpses, other players and furniture at `dark`; NPCs too at `murk`. Exits/destinations survive every level | `server/engine/commands/describe.js:328-335` (gate table), `:409-490` (consumers) | Fixed — replaced with the actual ladder, incl. the exits-always-visible guarantee |
| "A building generator (installable per-building, also **fuel-free**)" | **Wrong** — only `city_plant` and `junction_box` are fuel-free. Player generators burn fuel; storms fault units offline with a recovery window; a destroyed unit stays dark | `server/models/schema.js:751-755` (`fuel_remaining`/`fuel_burn_rate`); `server/engine/environment.js:1230-1245` | Fixed |
| "ATMs are a **per-zone flag** … Currently only one exists (the starting hub)" | **Drifted contract + stale count** — an ATM is **furniture** carrying an `atm` flag paired with an `atm_units` row; 2 exist in content | `plugins/atm/index.js:66` (`jsonb_exists(f.flags,'atm')`); `docs/flags-keys.md:170`; `content/furniture/` sweep → 2 | Fixed — corrected, with a link to `systems-atm.md` |
| Renting: "there's currently **no rent decay or repossession**, so it's a one-time purchase" | **Wrong / stale status** — recurring game-calendar rent, bank-first then carried, **auto-eviction** on failure to pay | `server/engine/gameLoop.js:1307-1380` (`rentCollectionTick`); `server/models/schema.js:471` | Fixed |
| "**The four** ideologies" | **Incomplete, not wrong** — four canonical is correct; nine `ideology_*` files exist because five are **gated expansion previews** (`flags.expansion: true`) that the lean scorer skips. design.md never mentioned the gated set | `server/engine/ideologies.js:76,89-93`; nine `content/orgs/ideology_*.json` | Fixed — the canonical/expansion split stated, with `systems-ideologies.md` named as roster owner |
| "distinguished … by a **future** *authority* axis" | **Stale status** — the predicted axis shipped as `flags.authority` (`architect` / `human`); the Prometheans are the exact `redeem · machine` case the sentence hypothesised, and are the *only* cell needing it — the nine orders fill all 8 `{stance, path}` cells with that one duplicated | `content/orgs/ideology_prometheans.json`; `server/engine/ideologies.js:47-52,65-70` | Fixed — reworded from prediction to outcome, incl. the activation recipe |
| "see the **model history** below" | **Ghost cross-reference** — no such section exists in the doc | `grep -i "model history" docs/design.md` → the pointer only | Fixed — clause deleted |
| Skill Categories list (4 categories enumerated by name) | **Incomplete** — combat/social/arcane match exactly; survival omits Butchering, Fishing, Swimming, Mining and tech omits Chemistry, Piloting | `server/engine/skills.js:6-31` | Fixed — collapsed to the five category names + a pointer to `SKILLS` as SSOT (duplicate-source-of-truth rule) |
| Mutation example "**+2 PER**, unsettling to NPCs (**-CHA**)" | **Drifted stat names, self-contradicting** — the doc's own stat table two sections up lists `senses` and states "There is **no charisma stat**" | `docs/design.md` Stats table; `server/engine/skills.js` `stat_senses` | Fixed — "+2 senses", `-CHA` dropped |
| Open question: apartment **upkeep** | **Answered** — see rent tick above | `gameLoop.js:1307` | Removed |
| Open question: **crew/guild-shared** apartments, "currently single-owner only" | **Answered** — `owner_type='org'`, controlled by any member with `MANAGE_HQ` | `server/engine/apartments.js:443-450` | Removed |
| Open question: should **darkness** gate gameplay | **Answered** — it does | `describe.js:328-335` | Removed |
| Open question: should a building **generator run out / fail** (storm damage, sabotage) | **Answered — all three named mechanisms ship** — fuel burn, severe-weather faults, and ghost sabotage (`drainZonePower`) | `environment.js:1230-1245`, `:3161` | Removed |
| Open question: do **crafting stations degrade** | **Still open** — a station is a quality tier (`none`/`refined`/`pristine`) worth a flat +0/+2/+4 margin; no condition, no upkeep | `server/engine/crafting.js:95` | Kept, with the current state stated |
| Open question: **player-run shops** | **Half answered** — a *corp* can claim a storefront business that takes a live cut of vendor sales; a solo player still cannot | `plugins/corps/ventures.js:1-9,37-46` | Kept, narrowed to "individual players" |
| Open question: **PvP flagging in mid-tier zones** | **Still open, premise changed** — `pvp_enabled` was dropped; protection is now all-or-nothing via the `sanctuary` tag through the protection substrate | `server/models/schema.js:70-73` (dropped); `server/engine/world.js:57` | Kept, with the current state stated |
| Starting credits = **20** carried | Correct | `server/models/schema.js:39` | — |
| Sanity is a real meter with hallucination + a zero state | Correct | `server/models/schema.js:32-33`; `plugins/sanity/plugin.json` | — |
| Six stats, no charisma; `brawn/reflexes/endurance/brains/cool/senses` | Correct | `server/engine/skills.js` `stat_*` | — |
| Security skill gates `pick`; `upgrade lock` is a credit sink | Correct | `server/engine/apartments.js:628` | — |

**Concision** — 325 → 325 lines. Cut classes applied: **narrative history** (the cooldown tuning's
"slower than an early draft that played faster than HellMOO itself"; the Reg-the-barkeep sentence
about vendor discounts predating the credit economy; the apartments "Why this design" opener
re-litigating a retired open question — the binding rationale kept as one sentence);
**duplicate source of truth** (the skill roster → one line + `skills.js`); **redundant scaffolding**
(a doubled `---` rule). Flat net because the eight status corrections grew back what the knife took.
Glyphs (`→ ↔ ·`) verified intact.

---

### `docs/story.md`

The oldest doc in the repo (2026-06-20) and — with one exception — the one that aged best. Theme,
tone, the Architect's characterisation and the five core themes are author-direction that no code
can falsify, and none of it was touched.

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| **Factions (Seed Concepts)** — Custodians / Breakers / Archivists / Franchise / Glitch, as a roster with power bases and beliefs | **Superseded as mechanics** — none exists as an org. They were reworked into the ideologies; the names survive only as world texture (a "Custodian Enforcer" is an *enemy*, not a faction) | `content/orgs/` holds nine `ideology_*.json` and no seed faction; `content/enemies/` has `Custodian Enforcer`; `docs/systems-ideologies.md:3` | Fixed — a blockquote stamp above the table saying so. **Table left verbatim** — it is the authored seed, and `roadmap-world-expansion.md` §6 still hangs its territory model on it |
| Coldwater Power Station "has kept the streetlights on since before The Handoff" | **Name drift only; the lore holds** — the zone is `zone_coldwater_turbine_hall`, "Coldwater Power **Plant** — Turbine Hall", and it really is the `city_plant` power source | `content/zones/zone_coldwater_turbine_hall.json`; `content/power_zones/zone_coldwater_turbine_hall.json` (`source_type: city_plant`) | Fixed — name only |
| Open question: "Are there **non-human entities** (mutants, AI-bodied creatures, cyborgs) as major NPC types?" | **Answered — all three** — Architect Scout Drone, Arbiter-Class Enforcement Unit, bloated mutant, plus the mutations and augments systems | `content/enemies/` (39 files); `plugins/augments/`, `plugins/mutations/` | Removed |
| Open question: Architect acting directly / main quest vs sandbox / nostalgia era | **Still open** — no main quest exists; the nostalgia era is still unpicked (it is also `roadmap` Decision 18, unanswered) | `plugins/quests/` is a system, not a mainline | Kept |

**Concision** — 97 → 102 lines. **No cuts earned.** This is a 97-line theme bible with no history
section, no changelog, no restated code and no aspiration-inside-as-built (it is not an as-built
doc). Every paragraph is either tone direction or a worked example of it. Growth is entirely the
faction stamp. **Already tight; only its faction table was stale.**

---

### `docs/roadmap-world-expansion.md`

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| **"Status: … Nothing here is built."** | **Wrong, and the most dangerous line in the batch** — the §0 target is *reached*: 93 × 100 cells, 5,439 outdoor zones | grid extents over `content/zones/*.json`; 5,439 files at `map_id:"map_world"` | Fixed — restamped; the header now says the canvas is built, that the phases below never mapped onto how it shipped, and which sections remain useful |
| **Companion: `roadmap-world-map.svg`** (cited twice — header, and §12 "the SVG is the north star") | **Ghost file** — does not exist anywhere in the repo | `find . -name "roadmap-world-map*"` → no match; `docs/svg/` holds five unrelated files | Fixed — replaced with the live artefacts (`proposals/coldwater-basin-map.html`, `proposals/coldwater-style_*.svg`) |
| §2 "Where We Are Today" — The Threshold, eight safe tiles, Franchise Strip, Embassy Hotel, Rust Quarter West, Static Wood, Coldwater Power Station, Marquee District | **Every named zone deleted** | `content/zones/` name sweep; `c1f964e5` | Fixed — historical stamp above the section; **the section text left frozen** (it is a point-in-time record) |
| Phase 0: "Bulk zone authoring — direct-DB + `/world/reload` … (reference: MUD Content Build — a MEMORY.md outside the repo)" | **Ghost link + superseded method** — no `MEMORY.md` exists at the repo root, and direct-DB authoring was retired by the CODEX pipeline | `find -maxdepth 2 -name MEMORY.md` → no match; `docs/content-pipeline.md`; CLAUDE.md core rule | Fixed — bullet restated as superseded, pointed at `content-pipeline.md` |
| Phase 0: "Region metadata — a `region` tag on zones" (and **Decision 17**, recommending it) | **Built** — `regions` table + `flags.region_id`, with `climate_bias` feeding the weather sampler. Danger/ambience did *not* follow it | `server/models/schema.js:98-108`; `docs/reference/land-taxonomy.md` | Fixed — bullet and Decision 17 both marked RESOLVED, with the caveat about what didn't follow |
| §12: "**Content lives in Postgres**, authored via the dev panel / bulk-DB flow" and "each wave ending in … a dev-panel DB export" | **Wrong, and it contradicts CLAUDE.md** — content lives in git as one JSON file per entity; the `.sql` export is an escape hatch, not the flow | CLAUDE.md Core Architectural Rules; `docs/content-pipeline.md` | Fixed — both bullets, with the old wording preserved inline so the change is legible |
| §9: "Named destinations & **`go`** — already supported ([systems-world.md])" | **Ghost verb-behaviour** — `go` is a pure alias for `move` and takes a *direction*. Named-destination travel is the `gps` plugin | `server/engine/commands/aliases.js:28` (`go: 'move'`); `plugins/gps/plugin.json:6` (`gps`/`run`/`walk`) | Fixed |
| §9: "the current **5×5** ASCII minimap" | **Drifted** — server BFS runs `depth=8` over a `WIN=4` window, and the client gained a zoom ladder | `server/engine/world.js:839,870` | Fixed |
| §1: "Realistic authored surface content is more like **600–1,500** distinct outdoor rooms" | **Overshot 3.6×** — 5,439 ship, ~55 % of the grid; generated district fill is what made it affordable | zone sweep | Fixed — annotated rather than rewritten (the estimate was right about *authoring* cost) |
| **Decision 12** — long-distance travel, recommending anchor fast-travel | **Answered differently** — (D) vehicles shipped (player aircraft), plus on-foot region crossings and `gps` autopilot. No anchor-unlock fast travel exists | `docs/systems-flight.md`; `docs/systems-overland-void-travel.md` (header: **STATUS: BUILT**); `plugins/gps/` | Fixed — stamped inline and in the summary table |
| **Decision 19** — non-human NPC types | **Answered — A + B + C** | as story.md above | Fixed — stamped inline and in the summary table |
| Phase 3: "Corps/orgs system … Phase 0 engine already built" | Correct — and `zone_control` (the influence table Decision 9 describes) exists | `server/models/schema.js:1518-1526`; `plugins/corps/index.js:654,692` | — |
| §1: exits (JSONB) are the movement SSOT; the grid only positions tiles; interiors are child maps | Correct | `docs/systems-world.md`; `map_id` spread (5,439 `map_world` + 30+ `map_int_*`) | — |
| §10: weather field samples over `map_world` by grid coords and already scales | Correct | `server/engine/environment.js:1854` | — |
| Decisions 1–11, 13–16, 18, 20 | **Genuinely unanswered** — no inline answers were ever recorded | doc body | Left alone |

**Concision** — 427 → 444 lines. **Deliberately no concision pass**, per the fix-vs-flag rule: this
doc's whole premise is now questionable (see Flag 1), and cutting 200 lines out of a document that
may be retired wastes the work and destroys the record either way. Growth is entirely status stamps
and ghost repairs. Glyphs (`× → ·`) verified intact.

---

### `docs/reference/hellmoo-combat-reference.md`

A reverse-engineering reference for an **external** codebase. Nothing in it is checkable against
this engine, and it correctly says so in its second sentence. It carried **no status stamp at all**,
which is the only thing a doc of this class can be wrong about — §6 ("What to keep vs. simplify for
Architect") posed live design choices that were all decided over a year of combat work, with no
record here of how they went.

**Correctness**

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| §6's keep/simplify choices are open questions | **Stale status — all resolved.** The 2d9 margin check was **rejected** (Architect uses a 2d8 − 2d8 opposed swing); drug-as-everything was **split**; per-body-part hits, learn-by-doing IP and typed soak were **kept**; `threat_rating` was **not** adopted | `server/engine/skills.js:52,62`; `server/engine/effects.js` vs `server/engine/drugs.js`; `server/engine/combat.js:253,331-344`; `grep threat_rating` → no hits | Fixed — status stamp added naming `combat.md` as the live doc and recording each outcome |
| "A full parse … lives in `Downloads/hellmoo_analysis/`" | **Unverifiable** — an off-repo path on the author's machine, not a repo artefact | not in the tree | Fixed — reworded to say it was local and may be gone |
| Everything else (MOO object numbers, verb formulas, the `$name` table, the `random(100)` body-part tuning gotcha) | **Not checkable, and correctly so** — this describes `hellcore.db`, not this repo | — | Untouched |

**Concision** — 296 → 304 lines. **No cuts earned.** Every section is a formula, a property table or
a `$name` registry; the one prose passage (§6) is the decision record the stamp now dates. Growth is
the stamp. **A clean, tight doc — its only defect was having no date on its opinions.**

---

### `docs/reference/plugin-architecture-analysis.md`

**Superseded.** [proposals/engine-plugin-boundary.md](../proposals/engine-plugin-boundary.md)
(2026-07-02) is a later, deeper audit of the same question — substrates/laws/registries vs. systems,
with a phase-by-phase implementation log — and it is the doc CLAUDE.md points at for "read before
deciding where new code lives." This file is not indexed anywhere, which is now correct.

**Correctness** — §6's nine-item "active roadmap", re-checked. Open items first.

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 5 | Unify drug/mutation stat effects through `effects.js` | **STILL OPEN** — `drugs.js` keeps its own local `applyEffects`, separate from the engine's `applyEffect` | `server/engine/drugs.js:583`; `server/engine/effects.js` |
| 7 | Dev-panel UI registration | **STILL OPEN** — no registry exists; every panel is a hand edit | no `registerDevPanelTab` / panel registry anywhere in `client/devpanel/` |
| 8 | Power-grid plugin (simulation out of `environment.js`) | **STILL OPEN** — `simulatePowerNetwork` is still core | `server/engine/environment.js:1217` |
| 1 | `economy.js` consolidation ("a correctness risk today") | **DONE** | `server/engine/economy.js`; `adjustCredits` consumed at `server/engine/apartments.js:5,478,628` |
| 2 | Player lifecycle hooks | **DONE** | `server/api/routes.js:496` (`player.create`), `:523` (`player.login`); `server/index.js:424` emits `player.logout` |
| 3 | Lighting plugin | **DONE** | `plugins/lighting/` |
| 4 | Crafting plugin | **DONE** | `plugins/crafting/` |
| 6 | Drugs plugin | **DONE** | `plugins/drugs/plugin.json` (`use`/`inject` specialized actions + `habits`) |
| 9 | `inventory.js` consolidation | **DONE** | `server/engine/inventory.js` |
| — | §6 "Phase 4 greenfield … **none started**" | **Stale** — quests, NPC/enemy AI, vehicles and scripting all ship. Only **world events** is genuinely untouched: `world_events` still has no reader but a cascade delete | `plugins/quests/`, `server/engine/ai-behaviour.js`, `plugins/flight/`, `server/engine/graph.js`; `world_events` referenced only at `server/api/routes.js:1617` and `plugins/zone-validator/index.js:226` |
| — | §5 Phase 0: "Delete the dead root-level `api/routes.js`" | **DONE** | file absent |
| — | "See also" links to `combat.md` / `systems-survival.md` / `systems-economy.md` / `systems-world.md` | **Four broken links** — the doc lives in `docs/reference/`, the targets in `docs/` (pre-existing; deferred by batch 2 as out-of-batch, in scope now) | link sweep |
| — | §1 coupling survey, §3 stays-in-core reasoning | **Still reads true** — `world.js` and `db.js` are still the shared substrate; the 1 s combat tick is still the performance-justified core exception | `server/engine/gameLoop.js` |

Action: status stamp rewritten to SUPERSEDED, with the six-done / three-open split and the greenfield
correction recorded inline; the four `../` links fixed.

**Concision** — 251 → 269 lines. **No cuts earned below the header.** §2's candidate matrix and §4's
API-gap list are the historical record of a decision that already happened — rewriting them would
rewrite the analysis, and deleting them leaves the supersession unexplained. Growth is the stamp.

---

### Flagged — dispositions recorded 2026-07-24 (user: "proceed as you think is best")

**Outcome: 1 kept, 2 resolved by relocation, 3 withdrawn as my own error, 4 and 5 done. No doc
deleted.** Details under each flag; the original wording is preserved so the reasoning is auditable.

- **1 — KEEP.** Retiring the roadmap would destroy 16 genuinely unanswered design decisions and the
  band/landmark/tone thinking, to save nothing; the corrected status stamp already stops it
  misleading anyone. Answering the 16 decisions is design work, not audit work, and stays yours.
- **2 — RESOLVED by relocation, not deletion.** The three still-open items now live in
  `proposals/engine-plugin-boundary.md`'s new **inherited-backlog** block (with fresh `file:line`
  citations), and `plugin-architecture-analysis.md` points there. The superseded doc survives as the
  historical survey, but nothing actionable depends on anyone reading it any more — which was the
  real risk. Deleting it can now happen any time at zero cost.
- **3 — WITHDRAWN.** I was wrong; see the struck flag below.
- **4 — DONE.** `story.md` now has a CLAUDE.md key-docs line, framed as the tone authority to read
  before writing player-facing prose, with the superseded faction table called out inline.
- **5 — DONE, at design altitude.** The `Output Variability` stub is completed as the four-rung
  ladder it always implied (critical / success / failure / catastrophic failure, with the station as
  a shift up the ladder rather than a change to it) and cites `crafting.js` rather than transcribing
  it.

### Flags as originally raised

1. **`roadmap-world-expansion.md` — retire, or answer it?** Its premise is spent: the 100×100 canvas
   it plans toward exists, and it was built by a different route than the six phases describe. What
   remains valuable is genuinely valuable — §3's band model, §5's landmark list, §7's content-per-band
   menu, §11's tone guardrails, and **16 of 20 decisions that were never answered** (density, danger
   gradient shape, mid-band PvP, territory mechanics, fog-of-war, nostalgia era…). Three options:
   (a) keep as-is with the corrected stamp; (b) answer the 16 decisions inline and let it become the
   world design doc it was trying to be; (c) retire it, and move the still-live thinking into
   `land-taxonomy.md` + a design.md section. **Question: which?** I've left it fully readable under
   (a) so any of the three stays cheap.
2. **`reference/plugin-architecture-analysis.md` — retire?** `engine-plugin-boundary.md` covers the
   same question better and is the indexed one. Against deletion: its §1 coupling survey and §2
   candidate matrix are the only record of *why* the boundary work started, and the three open items
   (#5, #7, #8) have no other home — `engine-plugin-boundary.md`'s log doesn't carry them.
   **Question: delete it and move those three items into `engine-plugin-boundary.md`, or keep it as
   the stamped historical survey?** Deleting a doc is your call, so I only stamped it.
3. ~~**`systems-ideologies.md` says "four canonical ideologies"; nine `ideology_*` orgs ship.**~~
   **WITHDRAWN — not a defect; my own fix was the defective one.** `systems-ideologies.md` already
   documents this exactly right ("The four canonical ideologies … Plus **5 gated expansion orders**
   (`flags.expansion: true`, preview-only, never win the lean)"), and the engine agrees —
   `server/engine/ideologies.js:76` skips `ideo.expansion` in the lean scorer, with the activation
   recipe in a comment at `:89-93`. CLAUDE.md's "4 canonical orders" is likewise correct. The wrong
   text was **my** first pass at design.md, which said "nine ship today" and flattened a deliberate
   canonical/preview gate into a raw count — the exact "correcting an intent doc toward a file
   listing" error this audit is supposed to avoid. Corrected in place; the table row above is
   restated. Worth recording because the model turns out to be tidier than any doc says: the nine
   orders fill **all eight `{stance, path}` cells**, with `redeem · machine` doubled and split by
   `authority` (Ascendants = architect, Prometheans = human).
4. **Four in-scope docs are absent from CLAUDE.md's key-docs list** — `story.md`,
   `roadmap-world-expansion.md`, and both `reference/` files. `plugin-architecture-analysis.md` and
   the HellMOO reference are correctly absent (superseded / external). But **`story.md` has no index
   entry anywhere**, and it is the tone authority every piece of written content should be checked
   against. **Question: add a key-docs line for `story.md`?** Adding entries changes CLAUDE.md's
   structure, so I fixed only the existing `design.md` line rather than growing the list.
5. **`design.md`'s "Output Variability" section is a stub** — it promises "different results based on
   the skill roll" and then lists exactly one outcome ("Critical success (rare): double output").
   `crafting.js` resolves a margin into quality tiers. Not a stale claim, just an unfinished
   paragraph; **left alone** because completing it means writing design, not auditing it.

### Batch summary

The most dangerous stale claim is **`roadmap-world-expansion.md`'s "Nothing here is built."** — a
flat negative, in a status stamp, about **5,439 shipped outdoor zones**. An agent handed this doc
would answer twenty multiple-choice questions and start Phase 0 tooling for a world that reached the
document's own §0 target. Runner-up is the same fact from the other end: **`design.md`'s "Map Shape
(As Built)"**, which described a nine-tile city in which every named zone has been deleted — worse in
one respect, because the "(As Built)" label is an explicit claim of ground truth and CLAUDE.md sends
readers to `design.md` first. Both were written truthfully and rotted in place; neither was ever
wrong when written.

The pattern in this class is distinct from the earlier batches. Batch 4's ghosts came from docs
mirroring a registry and falling behind; batch 5's from documenting the wrong side of a conversion
boundary. **Intent docs rot at their tense.** Every defect fixed here was a verb: "is not yet
built", "currently only one exists", "nothing here is built", "a *future* authority axis", "doesn't
*currently* hide items". The nouns were fine — the design thinking in all five docs is still good,
and almost none of it was deleted. What failed is that a design doc has no mechanism to notice when
the engine answers one of its questions, and four of `design.md`'s eight open questions had been
answered by shipped code (rent + eviction, corp-held apartments, darkness gating, generator failure)
with the questions still sitting there inviting someone to go build them a second time.

Two notes for the remaining order. First, **the "open questions" section of any intent doc should be
checked before its body** — it is the highest-density rot in the class, and it is cheap: eight greps
answered eight questions in `design.md`. Second, this batch produced **no code-bug findings**, which
is itself the result: unlike batch 2, verifying an intent doc's leftovers surfaced nothing live,
because intent docs don't assert defects. That argues for keeping C3 late rather than promoting it —
the audit's own ordering was right here. Leave the remaining order unchanged.

### Flag resolutions — `items.md` / `tags.md` / `land-taxonomy.md` / `systems-terrain.md` batch

All three flags were resolved by the user in-session.

1. **`text`-shaped tags couldn't be saved from the dev panel — FIXED (code).** `readItemTag`
   ([items.js:85](../../client/devpanel/js/panels/items.js)) now has its own `case 'text'`: raw prose is
   returned verbatim, and a JSON object/array still parses for the text tags holding structured config.
   `statmap`/`list`/`number` keep the strict `JSON.parse` + "invalid JSON" error. This centralized a rule
   `readZoneTag` ([zones.js:445](../../client/devpanel/js/panels/zones.js)) had already worked around
   locally, so that duplicate `text` branch was removed — two copies of one rule is the drift class this
   audit exists to catch. Verified in the live dev panel: `use_message` with prose and `laced_drug`
   (`drug_alcohol`) now round-trip as strings instead of throwing; a text tag holding `{"a":1}` still
   yields an object; `armor_soak` still parses and still errors on bad JSON; zone `text`/`list` reads
   unchanged. No console errors. (`test:regress` doesn't load client JS, so it can't cover this.)

2. **`items.description` — the flag's premise was wrong, and the doc is now more precise.** The column is
   **not** inert: vendor buy stock and sell inventory both resolve
   `item.tags?.description ?? item.description ?? ''`
   ([vendor.js:118,266](../../server/engine/vendor.js)). The tag wins; the column shows through only on a
   row that never got one. `items.md`'s blockquote now states the fallback chain explicitly and says to
   author the tag, not the column. The `schema.js:124` comment was accurate all along.

3. **`tags.md` reframed as a reference — DONE.** The apologetic "Status (as built) … corrected where the
   build diverged" blockquote is gone. The doc now opens by saying what tags *are*, where each Entity's bag
   lives (`items.tags` vs `flags`, unified by `tagsOf`), and which two bags are catalog-validated on write
   vs. the two that are only documented — with the add-to-the-catalog-first rule stated as a rule rather
   than as a dated 2026-07 note. The duplicated "the rule the whole system rests on" sentence in Tag Model
   was cut (it now lives in the intro), per triple-stated-facts.
