# Architecture Audits — Index

Reusable prompts for **challenging the design** at its seams. Each audit targets one *interplay space* —
a boundary where two halves of the system have to agree but nothing enforces it — and gives you a prompt
you can paste to an agent (or work by hand) to stress-test that boundary again later. They exist because
the bug class they hunt is **silent**: the code looks correct in isolation; the defect only appears when
you cross-reference the two sides.

The first audit ([source-of-truth-audit.md](source-of-truth-audit.md)) found a real, shipped bug (the
posture/HP-regen break). The rest generalize that success to the other seams.

## The seams, and which audit challenges each

| Seam (interplay space) | Failure mode it hides | Audit |
|---|---|---|
| **Engine ↔ Plugin** | duplicate/split source of truth; dead engine handler shadowed by a plugin | [source-of-truth-audit.md](source-of-truth-audit.md) |
| **Combat dispatch layers** | redundant indirection across plugin/action/builtin (flagged, structural) | [combat-flow-paths.md](combat-flow-paths.md) |
| **Server ↔ Client (WebSocket)** | message type emitted but unhandled (silent drop); handler never emitted (dead UI); payload shape drift | [client-server-protocol-audit.md](client-server-protocol-audit.md) |
| **Content (DB) ↔ Engine** | authored field never read (dead content); engine read never authorable (ghost read); tag-catalog drift | [content-engine-field-audit.md](content-engine-field-audit.md) |
| **Presentation ↔ everything** | inline CSS/markup taxing every file read; glyph mojibake; eroded styles.css contract | [ui-presentation-standard-audit.md](ui-presentation-standard-audit.md) |
| **String-keyed registries** | typo'd emit/consume key (dead link); inconsistent naming convention across registries | [naming-registry-harmony-audit.md](naming-registry-harmony-audit.md) |
| **Capability ↔ Item** | a "you need a ⟨tool⟩" gate hardcodes one item id instead of reading a tag, so a correctly-tagged second item is silently rejected | [capability-tag-vs-itemid-audit.md](capability-tag-vs-itemid-audit.md) |
| **Verb ↔ Affordance** | an object-gated verb (works only near a specific furniture/item/NPC) never advertises itself on that object's `examine`, so the player can't discover it — invisible content | [affordance-discoverability-audit.md](affordance-discoverability-audit.md) |
| **Runtime code ↔ remote DB** | hot paths stacking awaited round trips; queries in loops; ungated always-on ticks; caches without a write funnel — no error, just aggregate latency and pool starvation | [db-burden-audit.md](db-burden-audit.md) |
| **Docs ↔ code** | a doc claim that drifted from the code (ghost path, renamed field, "as built" for something unbuilt) — nothing executes a doc, so it silently mis-briefs every future reader; plus prose that taxes every context load without changing a decision | [doc-correctness-concision-audit.md](doc-correctness-concision-audit.md) |

## Not a prompt — an executable audit

The **map audit** is the odd one out: instead of a prompt you paste, it's a skill with a
deterministic linter behind it. The seam is **tile data ↔ the systems that read it** — a building
whose authored door side disagrees with its exits, a facade you can walk through the wall of, a
terrain flag that contradicts its own description. Same silent bug class, but the map is ~5,400
tiles, so the checks had to become a script rather than a reading exercise.

- **Skill:** `.claude/skills/map-audit/` — say "audit the map", or run
  `node .claude/skills/map-audit/scripts/audit-map.mjs` (needs a local DB at HEAD; it
  reads the resolved world, and refuses to run against a stale one)
- **Criteria:** [`.claude/skills/map-audit/rules.md`](../../.claude/skills/map-audit/rules.md)
- **Decisions:** [map-audit-decisions.json](map-audit-decisions.json) — accepted exceptions, so a
  deliberate call ("no loot in open water") never gets re-flagged. Human-authored only.

Two flavors live here:

- **Bug-class audits** (source-of-truth, protocol, content↔engine, registry harmony-mode) hunt a *silent
  defect*. The non-negotiable step is **prove it at runtime** before changing code.
- **Standardization audits** (UI presentation, registry convention-mode) enforce a *coding practice*
  whose payoff is readability and token cost. The non-negotiable step is **surgical migration** — move,
  don't redesign — and, for UI, a before/after visual diff.

## Findings logs

Point-in-time reports from running these audits, tagged with fix status (the audits above
are *reusable prompts*; these are the *results* of a sweep):

- [findings-2026-07.md](findings-2026-07.md) — nine-area sweep (NPC/AI · Broadcast · Vendor ·
  Combat · Survival · Economy · World · UI/CSS · Dev-panel↔REST). ~20 fixes applied; open
  items and recommended order at the end. Scavenging not yet covered.
- [findings-2026-07-content-shape.md](findings-2026-07-content-shape.md) — content↔engine shape &
  export-coverage sweep triggered by the `quests` bug. Two seams: `CONTENT_TABLES` allowlist gaps
  (whole subsystems — broadcast, audio, flight, surveillance — silently absent from the seed) and
  authored-vs-read JSON shape mismatches (dialogue params, drug overdose lethality, mutation stat
  keys). Findings only, most not yet fixed; FK-ordering hazards flagged.
- [findings-2026-07-docs.md](findings-2026-07-docs.md) — doc correctness & concision sweep
  ([prompt](doc-correctness-concision-audit.md)), batched by doc. Every verdict carries a
  `file:line`. Batch 1 fixed the dispatch/registry contract docs; batch 2 retired two
  point-in-time docs and found the still-live forgeable admin token.

## How to use one

1. Pick the seam that matches what you're about to touch (or what feels under-examined).
2. Open that audit, copy the **Prompt** block, fill in the `<SCOPE>` placeholder with **one** subsystem /
   file / registry — never "the whole game." The cross-referencing *is* the work; focus is what makes it
   reliable.
3. Hand it to an agent or work the checklist yourself.
4. Honor the audit's non-negotiable: prove silent bugs at runtime; keep standardization migrations
   surgical and visually verified.

## Writing a new audit (meta)

When you find a new interplay space worth re-challenging, add an audit here. Keep the house style — it's
what made these reusable:

- **Name the seam and the bug class in the first paragraph.** Say *why it's silent* (no error, no log) —
  that's the whole reason a dedicated audit beats "just review the code."
- **Ground it in this repo.** Cite real files and line numbers, and one concrete instance that already
  exists (the posture bug, the `player_update` shape drift, the 134 inline styles). Abstract advice gets
  ignored; "here is the actual drift, at this line" gets fixed. This grounding is what made the first
  audit land.
- **Three sections, every time:** an intro narrative of the seam → a paste-ready **Prompt** with a
  `<SCOPE>` placeholder → a quick-manual **Checklist**. Optionally a **Standardization** section stating
  the convention to converge on.
- **Insist on scope-of-one and proof.** Every audit says: scope to one subsystem, and prove findings at
  runtime (or, for UI, with a visual diff) before editing.
- **Respect CLAUDE.md.** Surgical changes only; no boot-time migrations; pick ONE source of truth; UTF-8
  glyph integrity.
- **Register it** in the table above, and consider adding it to the CLAUDE.md key-docs list if it earns a
  permanent place.

### Candidate seams not yet covered (backlog)

Spaces an audit could be written for when they start to bite:

- **Dev-panel client ↔ REST API** — `client/devpanel/js/core/api.js` fetch calls vs `server/api/*.routes.js`
  handlers: routes called but unimplemented, or implemented but uncalled; request/response shape drift.
  (The WS-protocol audit's sibling on the HTTP seam.)
- **VINE editor schemas ↔ graph runner** — `client/devpanel/js/vine/vine-schema-*.js` node/action types
  vs what `server/engine/graph.js` + the AI behaviour runner actually execute. A node type authorable in
  the editor but unhandled by the runner is a content trap.
- **Scheduler cadences ↔ subscribers** — every `ticks`/cadence declared (plugin.json, scheduler) vs who
  actually runs on each tick; orphan cadences and unsubscribed ticks.
- **Error/feedback consistency** — `type:'error'` is emitted 195+ times across the server with ad-hoc
  messages; an audit could standardize player-facing error phrasing and the error payload shape.
