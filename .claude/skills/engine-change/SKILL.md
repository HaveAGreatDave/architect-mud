---
name: engine-change
description: Add or change a substrate or law in the Architect MUD engine — shared state that multiple systems read, or a rule that holds no matter who touched it. Use when a change belongs in server/engine/ rather than a plugin or the DB: a new vital/cooldown/protection-style substrate, a new movement/damage/death-style law, or wiring a plugin into the engine through a mutation API or gate. This is the highest-risk layer (the posture-bug class) — it gates hard, builds behind a mutation API, and ends with a mandatory source-of-truth audit.
---

# Engine Change

You are changing the **most dangerous layer** in Architect MUD — the substrates and laws that every other
system reads. A mistake here is the posture/HP-regen bug class: two halves silently disagreeing on a field,
code that looks correct in isolation but runs the wrong half at runtime. So this skill gates hard, builds
behind an engine-owned mutation API, and ends with a **mandatory** source-of-truth audit — not just the
regression harness.

**Do not skip to editing `server/engine/`.** Work the phases in order.

## Read before touching anything

- [.claude/skills/_shared/change-gate.md](../_shared/change-gate.md) — the gate (Phase 0 below).
- [docs/proposals/engine-plugin-boundary.md](../../../docs/proposals/engine-plugin-boundary.md) — the substrate/law/registry model, §2 (litmus) and the **"what deliberately stays"** list. Load-bearing.
- [docs/audits/source-of-truth-audit.md](../../../docs/audits/source-of-truth-audit.md) — the mandatory Phase-4 audit.
- The relevant `docs/systems-*.md` — the contract table you'll be updating.
- CLAUDE.md — no ORM, **no startup migrations**, engine ≠ content, UTF-8.

---

## Phase 0 — The gate (HARD STOP)

Run [the change gate](../_shared/change-gate.md) and answer the litmus tests out loud. This skill only
proceeds when the verdict is **substrate** or **law**. If it's a system/verb → stop, that's `plugin-builder`.
If it's content → stop, that's `mud-designer`. If it's a tunable → it's a constant, not an engine change.

**The over-extraction trap is the specific danger here.** Before adding *anything* to the engine, confirm
it's genuinely shared (substrate) or universal (law) — not a leaf you're anchoring because it feels "core."
And before *extracting* something out of the engine, confirm it's a leaf, not a hub: if the engine would
still need to call it every tick through a provider callback, it's a hub — leave it. Extract leaves; anchor
hubs.

If uncertain, **ask** rather than guess — this is the layer where a wrong call is expensive.

---

## Phase 1 — Which engine thing am I building?

The engine owns exactly three kinds of thing. Pick one deliberately.

### A. A substrate (shared mutable state)

State that multiple unrelated systems read/write. **Never let plugins raw-poke the field** — give it an
engine-owned mutation API, the way `statmods.js` (the gold-standard reversible stat-delta ledger) works.
Model your API on the existing ones:

- [server/engine/posture.js](../../../server/engine/posture.js) — `getPosture`/`setPosture`/`forceStand`, **mutates the live player object in place** (never clone-and-replace via `setLivePlayer` — the game loop holds direct references; a replaced object silently orphans them), emits `posture.changed` on every transition.
- [server/engine/protection.js](../../../server/engine/protection.js) — `registerProtectionProvider`/`getZoneProtection`, a **sync-by-contract provider chain**: systems that produce the state register a provider; laws that consume it call the getter and never know the source. First provider to claim wins; a throwing provider is skipped, not fatal.

Rules for a new substrate:
- **One writer path.** All mutation goes through the API; grep-verify no other file writes the field directly.
- **Emit an event on change** if reactions need to be push-driven (`posture.changed` model).
- **Decide sync vs async by the hot path.** If a law reads it every tick/swing, the provider/getter must be synchronous and read caches, never the DB (see protection.js's contract note).
- **Document the field contract** in the relevant `docs/systems-*.md` — name, shape, who writes, who reads. This is the artifact that prevents the split-system bug.

### B. A law (a rule over a substrate)

A rule that holds regardless of which system caused the state. **A law never names a system** (no
`if (scavenging)`); it only reads substrates. Where a veto/effect seam already exists, register through it
rather than editing a core handler inline:

- **Movement:** `registerMoveGate(fn, owner)` — ordered veto chain that runs before any move mutation (encumbrance, door/lock register here). Returns `{block, message}` or passes. Post-move reactions ride the `zone.entered` event.
- **AI nodes:** `registerAICondition(type, fn)` / `registerAIAction(type, fn)` — the VINE switch falls through to these.
- **Status effects:** `registerStatusEffect({name, label, onTick})`.
- **Protection-gated interactions:** consult `getZoneProtection(zoneId)` (attack/loot/steal/shove already do) — a new hostile interaction reads the same law, so a future protection source (corp territory, wards) lights it up for free.

If **no seam exists** for the law you need, that's a bigger change: you may be adding a new veto point to a
core flow. Prefer building the seam (a `registerXGate` in the style of `movement-gates.js`) so the engine
registers *its own* law through the same mechanism plugins would — that's what makes laws testable and
listable instead of privileged inline checks. Flag this to the user; it's an architecture-level decision.

### C. A registry / seam (a new coupling channel)

A new way for systems to meet (a new gate registry, event, hook, provider-injection point). This is how you
*unblock* a plugin that currently can't express what it needs. Mirror an existing registry's shape
(`movement-gates.js`, `protection.js`, `specializedActions.js`). Adding the seam and adding the first user
are two separate, independently-shippable steps — do the seam with zero behavior change first.

---

## Phase 2 — Build

1. **Match the exemplar exactly.** Copy the shape of the closest existing substrate/law/registry — signature, sync-vs-async contract, in-place-vs-replace, error handling (a throwing provider is skipped and logged, never fatal). Don't invent a new convention.
2. **Convert existing writers.** If you're formalizing a field that plugins currently raw-poke, convert every writer to the new API in the same change and grep-verify none remain. A half-converted substrate is worse than none — it's a guaranteed split.
3. **All DB access through `query()`** in `server/models/db.js`. No ORM.
4. **Constants → `tunables.js`**, not baked into the law.
5. **UTF-8, no BOM** on any file with glyphs.
6. **Update the contract doc.** Add/edit the field-contract table in the relevant `docs/systems-*.md`, and if you added a registry, note it in the boundary doc's registry list and [docs/plugins.md](../../../docs/plugins.md) seam references.

---

## Phase 3 — Schema (only if the substrate needs persistence — deliberate, never on boot)

Most substrates live in memory (posture, protection). If yours needs a table:

- Add idempotent DDL to `SCHEMA_SQL` in `server/models/schema.js`, **and** run a deliberate one-shot against production. **Never add a boot-time migration** — boot stays deliberate. Apply with `npm run db:schema`.
- The dev-panel export reuses `SCHEMA_SQL`, so backups stay in sync automatically.

---

## Phase 4 — Verify: source-of-truth audit THEN regression (both mandatory)

Engine changes get a heavier gate than plugins because the failure is silent.

1. **Run the source-of-truth audit** for the affected subsystem — [docs/audits/source-of-truth-audit.md](../../../docs/audits/source-of-truth-audit.md), scoped to the one substrate/law you touched (not the whole game). Work its checklist: grep every read and write of the field across **both** `server/engine/` and `plugins/`; confirm writer field name == reader field name == doc'd field name; find any field written-but-never-read or read-but-never-written. **Prove a suspected dead/split path at runtime** (WS client or a temporary log), don't infer it. This is the step that catches the posture-bug class — do not skip it.
2. **Run `npm run test:regress`** — the pre-deploy gate. It drives the dispatch pipeline, posture substrate, and move-gate chain end-to-end through `handleCommand`, plus every plugin's suite. If your change is in a law that gates movement or a substrate a plugin reads, a break here is exactly what you want to catch.
3. **Add/extend coverage** for the new law or substrate. A move gate → drive a blocked and an allowed move through the harness. A substrate other systems read → assert the reaction fires when you mutate it. Put the assertions where the harness already exercises that seam.
4. **Report both results** — audit findings (or "clean") + the regress count. Treat either failing as blocking.
5. **Kill any background server you started.** The harness shares the Supabase pool (pool_size 15); orphaned `node server/index.js` processes exhaust it (`EMAXCONNSESSION`) and time out real users. Player stat columns are `stat_brawn`/`stat_reflexes`/… (not `brawn`).

---

## Hard-won gotchas

- **In-place vs. clone-and-replace.** The game loop holds direct references to live player objects while it ticks. A substrate that replaces the object (`setLivePlayer`) instead of mutating in place silently orphans those references — the loop keeps ticking the old object. Posture mutates in place for exactly this reason.
- **Sync-by-contract means sync.** A provider/getter on a hot path (every swing, every tick) must read caches, never `await` the DB. If you need DB data, cache it on write and read the cache here.
- **A law that names a system isn't a law.** The moment you write `if (player.scavenging)` in a law, you've recreated the O(N²) special-case coupling the whole boundary exists to kill. Read the substrate, not the system.
- **Adding to the engine is the default-wrong instinct.** The boundary doc's anti-goal is over-extraction; the mirror risk is over-anchoring. Both are the same mistake — putting code on the wrong side of the line. When it's close, the leaf test decides, and the tie goes to "keep it out of the engine."
- **The audit is not optional ceremony.** Every silent split-source bug this project has hit would have been caught by grepping reads-vs-writes of the field before shipping. Two minutes of grep beats a runtime ghost.
