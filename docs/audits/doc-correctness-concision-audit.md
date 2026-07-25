# Audit Prompt — Docs: Correctness & Concision

A reusable prompt for sweeping `docs/` (plus `README.md` and the CLAUDE.md key-docs index) for
**claims that are no longer true** and **words that no longer earn their place**. The seam is
**doc ↔ code**, and the bug class is silent for a reason unique to docs: *nothing executes them*.
A stale `docs/systems-*.md` never throws — it just quietly mis-briefs every future agent and every
future you, and each wrong line costs a re-read and a wrong assumption before the code corrects it.

The second half — concision — matters for the same reason. These docs are read into context on almost
every task. A 900-line doc that could be 300 taxes every session that touches its subsystem. But the
*structure* of the docset is good (one `systems-*.md` per system, `reference/` for background,
`proposals/` for unbuilt, `audits/` for reusable prompts, `adr/` for decisions). **This audit fixes
content, never layout.** No new docs, no reorganizing, no renaming files, no merging docs.

Two verified instances of what this hunts, both live today:

- `docs/reference/Flight_Implementation.md` opens with *"Before beginning, read all relevant project
  documentation…"* — it is an **authoring prompt**, not a reference doc, filed as one (along with three
  CamelCase siblings) next to the as-built [systems-flight.md](../systems-flight.md).
- `docs/proposals/systems-flight.md` and `docs/systems-flight.md` share a filename. One is
  "design exploration, not yet committed to build"; the other is 550 lines of shipped behaviour.
  A grep for `systems-flight` returns both, with no signal which is authoritative.

---

## How to run

**Do not run this over all of `docs/` in one pass.** ~20k lines across ~95 files is exactly how a
sweep turns into rambling. Run **pass 0** once to get a batch order, then run the **Prompt** below
once per batch, one batch per agent/session.

### Pass 0 — triage (cheap, no edits)

List every `.md` under `docs/` plus `README.md`, and for each record: line count · last-touched
(`git log -1 --format=%ad -- <file>`) · does CLAUDE.md's key-docs list name it · does it claim
"as built" / "pending" / "proposal".

Then measure the **drift gap** — the signal that actually orders the work. For each as-built doc,
count code commits to the paths it describes *since the doc's own last touch*:

```bash
d=$(git log -1 --format=%ad --date=short -- docs/commands.md)
git log --oneline --since="$d" -- server/engine/commands/ | wc -l
```

Map each doc to **specific** paths — `server/` or `client/` as a path returns the whole repo's commit
count and tells you nothing (it scored `amp-format.md`, a static JSON format spec, at 482). Then group
into batches of 3–6 **related** docs and order by drift gap, highest first. Output the batch table;
edit nothing.

The gap is what separates the two halves of this audit: a doc with a **high** gap is a *correctness*
target (its code moved on without it), while a **fat doc with a zero gap** is a *concision* target
(faithfully maintained per-feature, which is exactly how a doc reaches 916 lines). Batch those
separately — they need different work and different session lengths.

---

## Current batch plan — pass 0 run 2026-07-24

Point-in-time; re-run pass 0 for a later sweep. Tick these off as they land.

**Phase A — correctness** (code cross-referencing; one batch per session)

- [ ] **A1 · Dispatch & scripting core** — `commands.md` (gap **67**) · `scripting.md` (gap 10, oldest
  as-built) · `plugins.md` · `plugin-standard.md` — 659 lines. **Start here:** worst drift-per-line in
  the repo, and CLAUDE.md points every agent at these before they edit a verb, so an error here
  propagates into code. Verified: no ghost file paths in `commands.md`, so the drift is contract-level
  (names, ownership) — budget grep time.
- [ ] **A2 · Runtime & persistence substrate** — `architecture.md` (15) · `server.md` (8) ·
  `content-pipeline.md` (12) · `flags-keys.md` (8) — 1,189 lines. The tier rules everything defers to;
  `flags-keys.md` is a registry that rots silently as plugins add keys.
- [ ] **A3 · Dev panel & VINE** — `devpanel-js.md` (gap **22**) · `vine.md` · `ai-behaviour.md` —
  1,065 lines. `devpanel-js.md` is a *file-map* doc, the class that rots fastest (verified: no missing
  paths, so check function-location claims). Expect this to surface the "VINE schemas ↔ graph runner"
  seam listed as uncovered in [README.md](README.md) — flag it, don't fix it.
- [ ] **A4 · Authored-field shapes** — `items.md` · `tags.md` · `reference/land-taxonomy.md` ·
  `systems-terrain.md` — 770 lines. [findings-2026-07-content-shape.md](findings-2026-07-content-shape.md)
  is a known-bad baseline to check against.

**Phase B — concision** (all last touched 2026-07-21 with 0–2 code commits since; verification near-free)

- [ ] **B1 · Broadcast** — `bsm-format.md` (**916**) · `systems-broadcast.md` (695) — 1,611 lines, the
  biggest single win. Caveat: `bsm-format.md` is a **format spec**, and specs legitimately run long —
  field tables earn their space. Aim the cutting at `systems-broadcast.md`'s narrative and any restated
  code, not the tables.
- [ ] **B2 · Flight cluster** — `systems-flight.md` · `reference/world-rendering.md` ·
  `Cockpit_Design_Reference.md` · the four `reference/*_Implementation.md` — 1,333 lines. Both grounding
  instances above live here, so class discipline matters most: the `*_Implementation.md` files are author
  **vision** — status-stamp them, never correct them toward the code.
- [ ] **B3 · Big systems** — `systems-overland-void-travel.md` (674) · `systems-surveillance.md` ·
  `systems-world.md` · `systems-survival.md` — 1,954 lines. Index-drift finding to fix here:
  `systems-overland-void-travel.md` **and** `systems-wildlands.md` are absent from CLAUDE.md's
  key-docs list entirely.

**Phase C — status stamps** (cheap, mechanical)

- [ ] **C1 · Retirement candidates & findings logs** — `temp/qa-audit-2026-06.md` ·
  `zone-redesign-2026-07.md` + `zone-cutover-runbook.md` (carries its own self-delete condition) ·
  both `findings-2026-07*.md` — 856 lines. Output is status verdicts plus **the user's** delete calls.
- [ ] **C2 · Proposals ship-status sweep** — 22 files, ~4,600 lines. Do **not** read for content: one
  verdict per file (shipped / abandoned / pending), then stamp. Near-certainly shipped:
  `neon-migration`, both `egress-remediation-*`, `legacy-world-decommission`.
  `proposals/systems-flight.md` is the duplicate-filename case.
- [ ] **C3 · Intent & background** — `design.md` (its "open design questions" are the stale surface) ·
  `story.md` (oldest doc, 2026-06-20) · `roadmap-world-expansion.md` ·
  `reference/hellmoo-combat-reference.md` · `reference/plugin-architecture-analysis.md` (check whether
  [proposals/engine-plugin-boundary.md](../proposals/engine-plugin-boundary.md) superseded it) —
  1,396 lines. Status-stamp only; not checkable against code.

**Recommended order:** A1 → C1 → B1 → A2 → A3 → B2 → A4 → B3 → C2 → C3. A1 first for
highest-consequence drift; C1 next because it's cheap and surfaces delete decisions early; B1 third to
bank the context-cost win before the slow batches. To feel the savings sooner, B1 → A1 → C1 costs only
leaving the dispatch drift live longer.

### Deliberately not batched

1. **Fresh, zero-gap docs** — `combat.md`, `systems-posture.md`, `plugins.md` (outside A1's
   cross-reference role). Nothing to find.
2. **The tail of ~20 small systems docs under 250 lines** — `systems-atm` · `casino` · `jail` ·
   `economy` · `mining` · `jobboard` · `fishing` · `scavenging` · `macros` · `helm` · `swimming` ·
   `ideologies` · `cards` · `corps` · `npc-clothing` · `weather-extreme`. Mostly 2026-07-21 or later
   and already tight. Sweep each **opportunistically when feature work touches that system** — never
   schedule them. Scheduling the tail is how a finite sweep becomes an endless one.

---

## Prompt

> You are auditing the Architect MUD documentation for **correctness** (claims that no longer match
> the code) and **concision** (prose that no longer earns its context cost). Read
> [CLAUDE.md](../../CLAUDE.md) first — its Core Architectural Rules and Working Agreements bind you,
> especially *Surgical Changes* and UTF-8 glyph integrity.
>
> Audit scope: **<NAME 3–6 RELATED DOCS, e.g. "docs/systems-flight.md + docs/reference/*_Implementation.md
> + docs/proposals/systems-flight.md">**. Nothing outside that list gets edited.
>
> ### 1. Classify each doc first
>
> Its class decides what "correct" even means:
>
> - **As-built** (`systems-*.md`, `architecture.md`, `commands.md`, `plugins.md`, `server.md`,
>   `items.md`, `tags.md`, `flags-keys.md`, `scripting.md`, `combat.md`, `devpanel-js.md`,
>   `content-pipeline.md`, `README.md`) — every claim is checkable against code. Wrong claims are bugs.
> - **Proposal / vision / author-direction** (`proposals/`, most of `reference/`) — describes intent,
>   *not* checkable against code. Do **not** "correct" these toward the implementation. The only
>   correctness question is the **status stamp**: did it ship, get abandoned, or is it still pending?
> - **Findings log / point-in-time** (`audits/findings-*.md`, `temp/`, dated docs like
>   `zone-redesign-2026-07.md`) — frozen records. Do not rewrite the findings. The only questions are
>   whether each item's fix-status is still accurate and whether the doc announced its own retirement
>   condition (some do, e.g. "delete this runbook once executed").
> - **Reusable prompt** (`audits/*-audit.md`) and **ADR** (`adr/`) — leave alone unless in scope.
>
> ### 2. Correctness pass — verify, never recall
>
> For each as-built doc, extract its **checkable claims** and check each one. Grep or read the code;
> never rely on memory of this codebase. Cite `file:line` for every verdict. The claim classes:
>
> - **Ghost references** — a named file, path, directory, script, npm command, table, column,
>   `flags.*` key, or doc link that no longer exists. (`Glob`/`Grep` each.)
> - **Drifted contracts** — a documented field name, function name, verb, message `type`, action name,
>   event name, or JSON shape that the code spells differently or no longer reads. This is the
>   expensive class: it's what makes an agent write code against a field nothing reads.
> - **Stale status** — "as built" for something unbuilt, "pending"/"not yet built" for something
>   shipped, or a "next steps" list already done. Check the code, not the git log's optimism.
> - **Ownership drift** — the doc says the engine owns a mechanic that a plugin now owns (or vice
>   versa). Cross-check [plugins.md](../plugins.md)'s command-precedence rule.
> - **Duplicate source of truth** — the same contract stated in two docs, now disagreeing. Pick the
>   doc that owns it, and in the other leave **one line and a link**, not a summary.
> - **Index drift** — CLAUDE.md's key-docs list and [audits/README.md](README.md)'s table: entries
>   pointing at moved/renamed docs, one-line hooks asserting a status the doc contradicts, and in-scope
>   docs missing from the index entirely. Note that CLAUDE.md's hooks *restate* build status — when it
>   disagrees with the doc, the doc wins and CLAUDE.md's line gets corrected.
>
> ### 3. Concision pass — cut by rule, not by taste
>
> The test for every paragraph: **would an agent about to change this subsystem make a worse decision
> without it?** If no, it goes. Do not paraphrase, soften, or "tighten" prose you could delete.
>
> **Earns its space:** contracts and field tables · which module owns what · SSOT statements · gotchas
> and the *why* behind a non-obvious choice · sequencing/ordering requirements · the seams where two
> halves must agree · a worked example where the shape is genuinely hard to infer.
>
> **Cut on sight:**
> - **Narrative history** — how the system evolved, what it looked like before, what was tried and
>   abandoned. Keep only a decision's *rationale*, one sentence, where the decision still binds.
> - **Per-instance changelogs** — dated "fixed X on Y" entries inside a systems doc. That's git.
> - **One-off bug stories** — unless the bug's *shape* is a live trap for the next reader, in which
>   case it collapses to one sentence in a gotchas list.
> - **Restated code** — prose walking a function line by line, or a code block copied wholesale.
>   Replace with `file:line` and what it guarantees.
> - **Aspiration inside an as-built doc** — "eventually", "we could", "would be nice". Either it's a
>   proposal (move nothing — just delete; the proposal exists or it doesn't) or it's noise.
> - **Redundant scaffolding** — restated CLAUDE.md rules, table-of-contents on a 200-line doc,
>   preambles that describe what the doc is about to describe, closing summaries.
> - **Triple-stated facts** — the same claim in intro, body, and summary → keep the body.
>
> Preserve verbatim: code blocks that are copy-paste-usable, SQL/JSON schemas, tables, glyphs
> (`₵ ⚙ ⏻ ╱ █ ☢` — UTF-8 without BOM; check them after saving), and any `file:line` citation.
>
> ### 4. Fix vs. flag — the rule that keeps this surgical
>
> **Fix directly** (edit the doc): ghost references, drifted names you verified, stale status stamps,
> index lines, and every concision cut above.
>
> **Flag, do not fix** (report only, with the question you'd ask): a doc claim that reveals a *code*
> bug (never fix code in a docs audit — file it) · a contract you can't verify either way · a doc whose
> whole premise looks obsolete (deleting or retiring a doc is the user's call, always) · anything
> needing a new doc or a structural move · a proposal whose ship-status you can't determine.
>
> ### 5. Report
>
> Append to `docs/audits/findings-<YYYY-MM>-docs.md` (create it on the first batch), one section per
> doc in the batch:
>
> - **Correctness**: table of `claim · verdict · evidence (file:line) · action`. Wrong claims first.
> - **Concision**: line count before → after, and the cut classes applied (not a diff — the classes).
> - **Flagged**: numbered, each with the decision needed from the user.
>
> Then a one-paragraph batch summary: the single most dangerous stale claim found, and whether the
> next batch order should change based on what you learned. If a doc was already correct and tight,
> say so in one line — a clean doc is a real result, and padding the report to look productive is the
> exact failure mode this audit exists to fix.
>
> Constraints, non-negotiable: no new docs · no renaming or moving files · no restructuring a doc's
> section order · no editing code · no touching docs outside the named batch · every correctness
> verdict carries a `file:line`.

---

## Checklist (quick manual version)

- [ ] Pass 0 done: batch table by `lines × staleness-risk`, related docs grouped.
- [ ] Each doc classified (as-built / proposal / findings-log / prompt) — class picked *before* judging it.
- [ ] Every named path, script, table, column, `flags.*` key `Glob`/`Grep`-verified to exist.
- [ ] Every documented field/verb/action/event/message-`type` matched against the code that reads it.
- [ ] Every "as built" / "pending" / "next steps" claim checked against the code.
- [ ] Duplicate contracts reduced to one owner + a link.
- [ ] CLAUDE.md key-docs hooks and audits/README table reconciled with the docs themselves.
- [ ] Concision cuts made **by the listed classes** — nothing merely reworded.
- [ ] Glyphs intact, UTF-8 no BOM, code blocks/schemas/tables untouched.
- [ ] Code bugs, doc retirements, and structural moves **flagged**, not done.
- [ ] Findings appended with `file:line` evidence and before→after line counts.
