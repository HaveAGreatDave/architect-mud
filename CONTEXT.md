# Architect MUD

The shared vocabulary of the Architect MUD engine. This glossary fixes the terms introduced by the
2026 architecture rework (the Action/Event/Tag core model) so that code, docs, and the dev panel all
mean the same thing by the same word. It is a glossary only — not a spec. See
`docs/architecture.md` for how the engine is built and `docs/adr/` for why.

## Language

### The core model

**Action**:
A server-validated, structured intent that *mutates state* (`{type, actor, params, context}`), routed
by the Action Dispatcher to the owning handler, which emits Events on success. The single canonical
mutation path. _Avoid_: "operation", lowercase "action" for the concept.

**Command**:
Raw player-typed text. One *Source* of intent — parsed into an Action (when it mutates) or handled
directly (when read-only). _Avoid_: using "command" and "Action" interchangeably.

**Source**:
Anything that produces Actions: the Command parser, a Dialogue node, a Script step, or NPC AI. Every
Source funnels through the same Action Dispatcher.

**Hook**:
A *request/response* extension point (`fireHook`). The caller uses the return value ("give me a value
/ transform this", e.g. `zone.describeRoom`). _Avoid_: calling a Hook an "event".

**Event**:
A *fire-and-forget* notification (`emit`/`on`). Past-tense name, fan-out to subscribers, return value
ignored, errors isolated, order-independent ("this happened", e.g. `item.given`). _Avoid_: "signal",
"message", calling an Event a "hook".

### Objects

**Tag**:
A catalog-defined marker on an Entity, optionally data-bearing, that plugins register behavior or
specialized Actions against (e.g. `edible`, `container`, `lockable`). _Avoid_: "flag" (see Flagged
ambiguities), "component" as a separate concept — in this codebase a Tag *is* the component.

**Entity**:
Any in-world object with a Tag bag: items, furniture, doors, enemies, NPCs, zones. Structured domain
data (`body_parts`, `dialogue_tree`, `loot_table`, `exits`) stays in typed columns, not Tags.

**Generic Action**:
An object-agnostic Action owned by core, always available (`TAKE`, `DROP`, `GIVE`, `EQUIP`, `MOVE`,
`EXAMINE`).

**Specialized Action**:
A Tag-gated Action registered by a plugin (`{verb, requiredTag, handler}`). Available only on Entities
carrying the required Tag.

### Orchestration

**Script**:
A reusable graph asset whose steps dispatch Actions, branch, wait, or set Flags. Runtime-executed,
visually authored. Scripts call Actions only — never mutate state directly. _Avoid_: "macro".

**Flag**:
A persisted key/value state entry, player-scoped or world-scoped, read by Conditions in Dialogue,
Scripts, and Quests. _Avoid_: confusing with the legacy `flags` JSONB column (see below).

**Quest**:
A goal with objectives advanced by subscribing to Events, tracked per player. Ships as a plugin.

## Relationships

- A **Command** is parsed into an **Action**; so are **Dialogue** nodes, **Script** steps, and NPC AI (all **Sources**).
- An **Action** mutates state, then emits one or more **Events**.
- A **Hook** returns a value to its caller; an **Event** does not.
- A **Tag** on an **Entity** may register a **Specialized Action**; **Generic Actions** need no Tag.
- A **Script** is a graph of steps that dispatch **Actions** and read/write **Flags**.
- A **Quest** advances by subscribing to **Events** and reads **Flags** for conditions.

## Example dialogue

> **Dev:** "When a player types `give pie to bob`, is that a Command or an Action?"
> **Architect:** "Both, in sequence. The *Command* is the text. The parser turns it into a `GIVE` *Action*,
> which is the same Action a Dialogue node or a Script would dispatch. One mutation path, four Sources."
>
> **Dev:** "And the Quest plugin watches for that?"
> **Architect:** "It subscribes to the `item.given` *Event* the `GIVE` Action emits. The give-code never
> mentions quests — that's the whole point of Events being fire-and-forget."

## Flagged ambiguities

- **`flags` (column) vs Flag (primitive).** The legacy `flags` JSONB on enemies/NPCs/zones is being folded
  into the **Tag** system (it was always a tag bag by another name). The *new* **Flag** is unrelated:
  persisted conditional state in `player_flags`/`world_flags`. Resolved: JSONB `flags` → **Tags**;
  conditional state → **Flag**. Do not let the two meanings cross.
- **"action" overloaded.** The `interactions` plugin calls itself an "action layer" (emotes/posture) and
  the rework introduces **Action** (the mutation primitive). Resolved: capital-A **Action** always means
  the dispatch primitive; the social verbs are just Commands/Specialized Actions like any other.
- **Hook vs Event.** Today the code calls *everything* a "hook". Resolved: request/response = **Hook**;
  fire-and-forget = **Event**. Notification-style hooks (`tick.minute`, `player.death`, `zone.*`) migrate
  to **Events** during the port.
