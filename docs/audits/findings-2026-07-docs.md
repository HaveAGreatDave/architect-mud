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
