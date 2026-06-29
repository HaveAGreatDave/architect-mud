# Audit Prompt — Naming & Registry Harmony

A reusable prompt for finding **inconsistency across the string-keyed registries** that hold the game
together. Architect runs on a handful of registries where a **string** is the contract between an emitter
and a consumer who never reference each other directly:

| Registry | Key | Emitter side | Consumer side | Doc |
|---|---|---|---|---|
| **Event bus** | event name | `emit('enemy.killed', …)` | `on('enemy.killed', …)` | [scripting.md](../scripting.md) |
| **Action registry** | action type | `dispatchAction({type:'ATTACK'})` | `registerAction('ATTACK', …)` | [scripting.md](../scripting.md), [ADR-0001](../adr/) |
| **Tag catalog** | tag name | `TAG_CATALOG` / editor | `hasTag/tagValue` in engine | [tags.md](../tags.md) |
| **WS protocol** | message `type` | server `send({type})` | client `handlers[type]` | [client-server-protocol-audit.md](client-server-protocol-audit.md) |
| **Flag store** | flag key | `setFlag(k,v)` | `getFlag(k)` / `evalConditions` | [scripting.md](../scripting.md) |
| **Channels / ticks** | channel & cadence | `subscribe`/`broadcast`, scheduler cadence | listeners | [systems-world.md](../systems-world.md) |

Two distinct problems live here:

1. **Typo-class drift** — emitter and consumer use *almost* the same string (`enemy.killed` vs
   `enemyKilled`, `quest.completed` vs `quest.complete`). The link silently never fires. This is the
   source-of-truth bug ([source-of-truth-audit.md](source-of-truth-audit.md)) with a string key instead
   of a struct field.
2. **Convention drift** — the strings *work*, but they don't agree on a **format**, so the system is
   harder to reason about and easier to typo next time. The WS protocol already mixes flat snake_case
   (`zone_event`, `combat_incoming`) with dotted namespaces (`environment.clockTick`). Events lean
   dotted (`enemy.killed`); actions lean SHOUTING (`ATTACK`, `START_QUEST`); tags lean lowercase. Each
   registry has a *de facto* convention; this audit makes it *de jure* and flags the outliers.

## How to run

Two modes — run whichever the moment calls for:

- **Harmony mode (typo hunt):** scope to **one registry** and diff emitters against consumers. Find the
  string that's emitted but never consumed (or vice versa). This catches live dead links.
- **Convention mode (standardization):** scope to **one registry or across all of them** and establish
  the naming rule, then list every key that violates it. This is documentation + cleanup, not bug-fixing
  — so it's lower-risk but needs care, because renaming a string key is a breaking change that must be
  done on **both** sides (and in any DB content that references it) at once.

---

## Prompt

> You are auditing the Architect MUD codebase for **naming consistency and dead links across its
> string-keyed registries**. The registries and their emit/consume verbs are tabulated in
> [naming-registry-harmony-audit.md](naming-registry-harmony-audit.md); read [scripting.md](../scripting.md)
> (event bus `on`/`emit`, action registry `registerAction`/`dispatchAction`, flag store) and
> [tags.md](../tags.md) first.
>
> Audit scope: **<REGISTRY + MODE, e.g. "event bus — harmony mode" or "all registries — convention mode">**.
>
> **Harmony mode** — find dead links:
> 1. Grep every **emit** of a key in scope: `emit('<name>'`, `dispatchAction({ type: '<X>'` /
>    `{ action: '<X>'`, `setFlag('<k>'`, server `send({ type: '<t>'`, `TAG_CATALOG` entries.
> 2. Grep every **consume**: `on('<name>'`, `registerAction('<X>'`, `getFlag('<k>'` /
>    `evalConditions`, client `handlers['<t>']`, engine `hasTag/tagValue('<tag>'`.
> 3. Build two sets and diff. **Emitted-but-never-consumed** = a fired event/action/message nobody
>    listens to (dead emit, or a typo'd consumer). **Consumed-but-never-emitted** = a listener that never
>    runs (dead handler, or a typo'd emitter). Remember content in the DB can emit too — dialogue/script
>    graphs reference action types and event names that aren't grep-able in code; note where a key's
>    "missing half" might live in content (per [combat-flow-paths.md](combat-flow-paths.md)'s ATTACK note).
> 4. For each suspected dead link, **prove it**: temporary log at the emit and the consume site, exercise
>    the path over the WebSocket, show the listener fires or doesn't. Don't infer.
>
> **Convention mode** — impose harmony:
> 1. For the registry in scope, list every key and infer the **de facto** convention (casing, separator,
>    namespacing): events `lowerdot.case`? actions `SHOUTING_CASE`? tags `lower_snake`? message types
>    `snake_case` except dotted subsystem feeds?
> 2. State the rule explicitly and list every key that **violates** it.
> 3. For each violation, propose the canonical name and enumerate **every site** that must change
>    together — emitter, consumer, docs, and any DB content (dialogue trees, script graphs, tag values)
>    that hardcodes the old string. A rename that misses one site creates a *new* dead link, so the
>    change-set must be complete or not attempted.
>
> **Report** (both modes), per finding: registry · key · the two sides · dead-link vs convention-violation
> · proof (harmony) or full rename change-set incl. content (convention) · which doc records the
> convention. Keep it surgical (CLAUDE.md). Do not rename working keys casually — a string key is a
> public contract; renames are breaking and must be all-sites-at-once.

---

## Standardization this audit should push toward

Lock a convention per registry and record it (in [scripting.md](../scripting.md) for events/actions/flags,
[tags.md](../tags.md) for tags, [client-server-protocol-audit.md](client-server-protocol-audit.md) for
message types). A reasonable target, matching the de-facto leanings already present:

- **Events:** `lowerdomain.verbPast` — `enemy.killed`, `quest.completed`, `zone.entered`.
- **Actions:** `SHOUTING_SNAKE` — `ATTACK`, `START_QUEST`, `TURN_IN`.
- **Tags:** `lower_snake` — `edible`, `armor_slot`.
- **WS message types:** `snake_case`; reserve dotted namespaces (`environment.*`) for continuous
  subsystem feeds, flat for one-shot replies. Decide and apply — this is the one with active drift.
- **Flags:** `lower_snake` with an optional `domain:` prefix for scoped flags.

The point isn't the specific choices — it's that **each registry has one rule, written down, with no
outliers**, so the next emit/consume pair is typo-proof by pattern.

## Checklist (quick manual version)

- [ ] Pick a registry + mode (harmony=typo hunt, convention=standardize).
- [ ] Harmony: grep all emits, grep all consumes, diff the two string sets.
- [ ] Emitted-but-unconsumed / consumed-but-unemitted? — and could the missing half live in DB content?
- [ ] Prove one dead link live (logs at both sites) before changing code.
- [ ] Convention: state the rule, list violators, write the *complete* all-sites rename set incl. content.
- [ ] Record the per-registry convention in the owning doc.
